import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { saveToAnki, healthCheck, noteFields, ankiCall, AnkiConnectError, type AnkiSaveInput } from "../src/server/anki-connect.ts";

const input: AnkiSaveInput = {
	sourceId: "learnharness:chat-1:problem-1",
	kind: "practice",
	question: "Why does 2 < 3?\nGive one reason.",
	options: ["Because 2 is smaller", "Because 2 is larger"],
	distractors: [],
	answer: "Because 2 is smaller",
	correctAnswers: ["Because 2 is smaller"],
	solution: "Compare the integers.",
	source: "chat-1",
	mode: "recall",
	targets: ["n_1"],
};

type Call = { action: string; version: number; params: Record<string, unknown> };

async function fakeAnki(delayFindMs = 0, existingModel = false, failStyling = false) {
	const calls: Call[] = [];
	const notes = new Map<string, { id: number; fields: Record<string, string>; tags: string[] }>();
	let modelCreated = 0;
	let nextId = 1496198395707;
	const server = http.createServer((req, res) => {
		let body = "";
		req.on("data", (chunk) => body += chunk);
		req.on("end", () => {
			const call = JSON.parse(body) as Call;
			calls.push(call);
			const p = call.params;
			let result: unknown = null;
			let error: string | null = null;
			switch (call.action) {
				case "version": result = 6; break;
				case "createDeck": result = 1; break;
				case "modelNames": result = modelCreated || existingModel ? ["LearnHarness Practice"] : []; break;
				case "createModel": modelCreated++; result = 1; break;
				case "modelTemplates": result = { "Question → Answer": { Front: "old", Back: "old" } }; break;
				case "modelStyling": result = { css: "old" }; break;
				case "updateModelTemplates": result = null; break;
				case "updateModelStyling": if (failStyling) error = "style failed"; break;
				case "findNotes": {
					const encoded = String(p.query).match(/^SourceId:"((?:\\.|[^"])*)"$/)?.[1];
					const source = encoded?.replace(/\\(["\\])/g, "$1");
					result = source && notes.has(source) ? [notes.get(source)!.id] : [];
					break;
				}
				case "addNote": {
					const note = p.note as { fields: Record<string, string>; tags: string[] };
					const id = nextId++;
					notes.set(note.fields.SourceId!, { id, fields: note.fields, tags: note.tags });
					result = id;
					break;
				}
				case "updateNoteFields": {
					const note = p.note as { id: number; fields: Record<string, string> };
					const previous = notes.get(note.fields.SourceId!);
					notes.set(note.fields.SourceId!, { id: note.id, fields: note.fields, tags: previous?.tags ?? [] });
					break;
				}
				case "updateNoteTags": {
					const note = p as { note: number; tags: string[] };
					const entry = [...notes.values()].find((candidate) => candidate.id === note.note);
					if (entry) entry.tags = note.tags;
					break;
				}
				case "boom": error = "deliberate failure"; break;
			}
			res.writeHead(200, { "Content-Type": "application/json" });
			setTimeout(() => res.end(JSON.stringify({ result, error })), call.action === "findNotes" ? delayFindMs : 0);
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("no test port");
	return { url: `http://127.0.0.1:${address.port}`, calls, notes, server,
		close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

describe("AnkiConnect save", () => {
	it("creates once and updates the same source on the second save", async () => {
		const fake = await fakeAnki();
		try {
			const first = await saveToAnki(input, fake.url);
			const second = await saveToAnki({ ...input, solution: "Updated explanation.", mode: "composition", targets: ["n_2"] }, fake.url);
			assert.equal(first.updated, false);
			assert.equal(second.updated, true);
			assert.equal(first.noteId, second.noteId);
			assert.equal(fake.notes.size, 1, "SourceId deduplicates across saves");
			assert.ok(fake.notes.get(input.sourceId)!.fields.Solution!.includes("<p>Updated explanation.</p>"));
			assert.deepEqual(fake.notes.get(input.sourceId)?.tags,
				["learnharness", "kind-practice", "mode-composition", "target-n_2"]);
			assert.equal(fake.calls.filter((c) => c.action === "createModel").length, 1);
			assert.equal(fake.calls.filter((c) => c.action === "addNote").length, 1);
			const add = fake.calls.find((c) => c.action === "addNote")!;
			assert.equal((add.params.note as { options: { allowDuplicate: boolean } }).options.allowDuplicate, true,
				"SourceId, not Anki's content hash, owns duplicate detection");
			for (const call of fake.calls) {
				assert.equal(call.version, 6);
				assert.ok(call.params && typeof call.params === "object", `${call.action} uses nested params`);
			}
		} finally {
			await fake.close();
		}
	});

	it("upgrades an existing note type to the interactive template without adding fields", async () => {
		const fake = await fakeAnki(0, true);
		try {
			await saveToAnki(input, fake.url);
			assert.equal(fake.calls.filter((call) => call.action === "createModel").length, 0);
			assert.equal(fake.calls.filter((call) => call.action === "updateModelTemplates").length, 1);
			assert.equal(fake.calls.filter((call) => call.action === "updateModelStyling").length, 1);
			const update = fake.calls.find((call) => call.action === "updateModelTemplates")!;
			const model = update.params.model as { name: string; templates: Record<string, { Front: string; Back: string }> };
			assert.equal(model.name, "LearnHarness Practice");
			assert.ok(model.templates["Question → Answer"]!.Front.includes("lh-mc-v5"));
		} finally {
			await fake.close();
		}
	});

	it("rolls back a template upgrade when the matching style update fails", async () => {
		const fake = await fakeAnki(0, true, true);
		try {
			await assert.rejects(() => saveToAnki(input, fake.url), /style failed/);
			const updates = fake.calls.filter((call) => call.action === "updateModelTemplates");
			assert.equal(updates.length, 2, "the second write restores the previous template");
			const rollback = updates[1]!.params.model as { templates: Record<string, { Front: string }> };
			assert.equal(rollback.templates["Question → Answer"]!.Front, "old");
			assert.equal(fake.notes.size, 0, "a failed upgrade does not save a partially rendered note");
		} finally {
			await fake.close();
		}
	});

	it("escapes quotes and backslashes while preserving exact SourceId identity", async () => {
		const fake = await fakeAnki();
		try {
			const special = { ...input, sourceId: 'learnharness:folder\\chat:"odd"' };
			const first = await saveToAnki(special, fake.url);
			const second = await saveToAnki(special, fake.url);
			assert.equal(first.updated, false);
			assert.equal(second.updated, true);
			assert.equal(fake.notes.size, 1);
			assert.equal(fake.notes.get(special.sourceId)?.fields.SourceId, special.sourceId);
			const query = String(fake.calls.find((call) => call.action === "findNotes")!.params.query);
			assert.ok(query.includes("folder\\\\chat"));
			assert.ok(query.includes(':\\"odd\\"'));
		} finally {
			await fake.close();
		}
	});

	it("serializes concurrent saves and first-time model setup", async () => {
		const fake = await fakeAnki(25);
		try {
			const [first, second, other] = await Promise.all([
				saveToAnki(input, fake.url),
				saveToAnki(input, fake.url),
				saveToAnki({ ...input, sourceId: input.sourceId + ":other" }, fake.url),
			]);
			assert.equal(first.updated, false);
			assert.equal(second.updated, true);
			assert.equal(first.noteId, second.noteId);
			assert.equal(other.updated, false);
			assert.equal(fake.notes.size, 2);
			assert.equal(fake.calls.filter((call) => call.action === "addNote").length, 2);
			assert.equal(fake.calls.filter((call) => call.action === "createModel").length, 1);
		} finally {
			await fake.close();
		}
	});

	it("escapes model-authored HTML and labels options without changing their order", () => {
		const fields = noteFields(input);
		assert.ok(fields.Question.includes("2 &lt; 3?"));
		assert.ok(fields.Question.includes("Give one reason."));
		const model = JSON.parse(fields.Options);
		assert.deepEqual(model.options, ["Because 2 is smaller", "Because 2 is larger"]);
		assert.deepEqual(model.correct, ["Because 2 is smaller"]);
		assert.equal(model.multi, false);
		const duplicate = JSON.parse(noteFields({ ...input, correctAnswers: ["Because 2 is smaller", " because   2 is smaller "] }).Options);
		assert.deepEqual(duplicate.correct, ["Because 2 is smaller"]);
		assert.equal(duplicate.multi, false, "duplicate correct labels do not enable multi-select");
		assert.equal(fields.Mode, "recall");
		assert.equal(fields.Targets, "n_1");
	});

	it("renders card Markdown and fenced code without allowing raw HTML", () => {
		const tex = String.fromCharCode(92);
		const fields = noteFields({
			...input,
			question: 'Game **has** Players.\n```csharp\nclass Hand { private List<Card> cards; }\n```',
			solution: `Use $${tex}texttt{Card}$ and \`List<Card>\`. <img src=x onerror="alert(1)">`,
		});
		assert.ok(fields.Question.includes('<strong data-streamdown="strong">has</strong>'));
		assert.ok(!fields.Question.includes("**has**"));
		assert.ok(fields.Question.includes('data-streamdown="code-block"'));
		assert.ok(fields.Question.includes('data-language="csharp"'));
		assert.ok(fields.Question.includes('data-line-number="1"'), "static code keeps line numbers");
		assert.ok(fields.Question.includes("color:#F97583"), "C# keywords use the GitHub Dark token colors");
		assert.ok(fields.Question.replace(/<[^>]+>/g, "").includes("List&lt;Card&gt;"), "generic type syntax stays escaped across token spans");
		assert.ok(!fields.Question.includes("```"));
		assert.ok(fields.Solution.includes('<span class="katex">'));
		assert.ok(fields.Solution.includes("mord texttt"));
		assert.ok(fields.Solution.includes('data-streamdown="inline-code"'));
		assert.ok(fields.Solution.includes("List&lt;Card&gt;"));
		assert.ok(!fields.Solution.includes("$" + tex + "texttt"));
		assert.ok(!fields.Solution.includes("<img"));
		const optionFields = noteFields({ ...input, options: ["**Bold choice**", "Plain"], answer: "**Bold choice**", correctAnswers: ["**Bold choice**"] });
		const options = JSON.parse(optionFields.Options);
		assert.ok(options.optionHtml["**Bold choice**"].includes('<strong data-streamdown="strong">Bold choice</strong>'));
	});

	it("honors fence line-number settings and falls back safely for unknown languages", () => {
		const numbered = noteFields({ ...input, question: "```csharp startLine=7\nclass Hand {}\n```" }).Question;
		assert.ok(numbered.includes('data-line-number="7"'));
		const unnumbered = noteFields({ ...input, question: "```js noLineNumbers\nconst value = 1;\n```" }).Question;
		assert.ok(!unnumbered.includes("data-line-number"));
		const fallback = noteFields({ ...input, question: "```not-a-language\n<safe>&\n```" }).Question;
		assert.ok(fallback.includes("&lt;safe&gt;&amp;"));
		assert.ok(fallback.includes('data-streamdown="code-block"'));
	});

	it("keeps links usable, blocks remote images, and preserves Mermaid source", () => {
		const fields = noteFields({
			...input,
			question: '[click](https://example.com)\n![pixel](https://host.example/track.png)\n```mermaid\ngraph TD; A-->B;\n```',
		});
		assert.ok(fields.Question.includes('<a href="https://example.com/" target="_blank" rel="noreferrer noopener">click</a>'));
		assert.ok(!fields.Question.includes("<img"));
		assert.ok(!fields.Question.includes("host.example"));
		assert.ok(fields.Question.includes('[Image: pixel]'));
		assert.ok(fields.Question.includes('data-streamdown="mermaid-source"'));
		assert.ok(fields.Question.includes("graph TD; A--&gt;B;"));
		assert.ok(!fields.Question.includes('aria-busy="true"'));
	});

	it("preserves protocol-relative link authorities", () => {
		const fields = noteFields({ ...input, question: '[root](//example.com) and [path](//example.com/a/b). [angle](<//example.com/a/b>) [angle space](<//example.com/a b>) <a href="//example.com/a/b">raw</a>. Literal: `[x](//example.com)`' });
		assert.ok(fields.Question.includes('href="https://example.com/"'));
		assert.ok(fields.Question.includes('href="https://example.com/a/b"'));
		assert.equal(fields.Question.match(/href="https:\/\/example\.com\/a\/b"/g)?.length, 3, "inline, angle, and raw HTML links preserve the host");
		assert.ok(!fields.Question.includes('href="/a/b"'));
		assert.ok(fields.Question.includes("[x](//example.com)"), "literal code is not rewritten");
		assert.ok(fields.Question.includes('href="https://example.com/a%20b"'), "angle destinations may contain spaces");
	});

	it("does not rewrite attribute-like prose or link titles", () => {
		const fields = noteFields({
			...input,
			question: 'The literal text href=//example.com stays literal. [x](https://safe.example "literal src=//example.com")',
		});
		assert.ok(fields.Question.includes("href=//example.com"));
		assert.ok(fields.Question.includes('title="literal src=//example.com"'));
		assert.ok(!fields.Question.includes("literal src=https://"));
	});

	it("handles quoted greater-than signs before and after raw href attributes", () => {
		const fields = noteFields({
			...input,
			question: '<a title="1 > 0" href="//example.com/a/b">before</a> <a href="//example.com/a/b" title="1 > 0">after</a>',
		});
		assert.equal(fields.Question.match(/href="https:\/\/example\.com\/a\/b"/g)?.length, 2);
		assert.ok(!fields.Question.includes('href="/a/b"'));
	});

	it("builds four safe options from the question bank and preserves a long-answer recall fallback", () => {
		const fields = noteFields({
			...input,
			options: [],
			distractors: ["Because 2 is larger", "Because 2 is smaller", "1 is smaller", "3 is larger", "4 is larger"],
		});
		const model = JSON.parse(fields.Options);
		assert.equal(model.options.length, 4);
		assert.deepEqual(model.correct, ["Because 2 is smaller"]);
		assert.equal(new Set(model.options).size, 4, "no duplicate or correct-answer collisions");
		assert.ok(!model.options.slice(1).includes("Because 2 is smaller"));
		const long = noteFields({ ...input, options: [], answer: "A long answer\nwith several lines", correctAnswers: ["A long answer\nwith several lines"] });
		assert.deepEqual(JSON.parse(long.Options).options, [], "long solutions stay free recall");
		const multiRecall = JSON.parse(noteFields({
			...input, options: [], answer: "First long\nanswer | Second long\nanswer", correctAnswers: ["First long\nanswer", "Second long\nanswer"],
		}).Options);
		assert.deepEqual(multiRecall.options, []);
		assert.equal(multiRecall.multi, false, "multi-answer recall does not show an empty Check answers control");
	});

	it("escapes option JSON so model text cannot close the data script", () => {
		const fields = noteFields({ ...input, options: ["</script><script>alert(1)</script>", "Safe"] });
		assert.ok(!fields.Options.includes("</script>"));
		assert.ok(fields.Options.includes("\\u003c"));
		assert.deepEqual(JSON.parse(fields.Options).options[0], "</script><script>alert(1)</script>");
	});

	it("surfaces AnkiConnect errors and checks API version 6", async () => {
		const fake = await fakeAnki();
		try {
			assert.equal(await healthCheck(fake.url), true);
			await assert.rejects(ankiCall("boom", {}, fake.url), AnkiConnectError);
		} finally {
			await fake.close();
		}
	});
});
