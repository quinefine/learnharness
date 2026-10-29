import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { saveToAnki, healthCheck, noteFields, ankiCall, AnkiConnectError, type AnkiSaveInput } from "../src/server/anki-connect.ts";

const input: AnkiSaveInput = {
	sourceId: "learnharness:chat-1:problem-1",
	kind: "practice",
	question: "Why does 2 < 3?\nGive one reason.",
	options: ["Because 2 is smaller", "Because 2 is larger"],
	answer: "Because 2 is smaller",
	solution: "Compare the integers.",
	source: "chat-1",
	mode: "recall",
	targets: ["n_1"],
};

type Call = { action: string; version: number; params: Record<string, unknown> };

async function fakeAnki(delayFindMs = 0) {
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
				case "modelNames": result = modelCreated ? ["LearnHarness Practice"] : []; break;
				case "createModel": modelCreated++; result = 1; break;
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
			assert.equal(fake.notes.get(input.sourceId)?.fields.Solution, "Updated explanation.");
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
		assert.ok(fields.Question.includes("<br>Give one reason."));
		assert.ok(fields.Options.includes("lh-key\">A</span> Because 2 is smaller"));
		assert.ok(fields.Options.includes("lh-key\">B</span> Because 2 is larger"));
		assert.equal(fields.Mode, "recall");
		assert.equal(fields.Targets, "n_1");
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
