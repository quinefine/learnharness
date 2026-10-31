import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { saveToAnki, ankiCall } from "../src/server/anki-connect.ts";
import { POST } from "../app/api/anki/save/route.ts";

/** Opt-in real integration. Start desktop Anki + AnkiConnect, then run:
 *   ANKI_LIVE=1 npx tsx --test tests/anki-live.test.ts
 * Use a disposable profile for development. Default test runs skip this file.
 */
const enabled = process.env.ANKI_LIVE === "1";

describe("live AnkiConnect", { skip: !enabled }, () => {
	it("creates then updates one real note, and accepts the HTTP route", async () => {
		const sourceId = `learnharness:live:${Date.now()}`;
		const input = {
			sourceId, kind: "practice" as const, question: "Why is 2 < 3?", options: ["Smaller", "Larger"], distractors: [],
			answer: "Smaller", correctAnswers: ["Smaller"], solution: "Compare the integers.", source: "live-test", mode: "recall", targets: ["n_1"],
		};
		const first = await saveToAnki(input);
		const second = await saveToAnki({ ...input, solution: "Updated solution." });
		assert.equal(first.updated, false);
		assert.equal(second.updated, true);
		assert.equal(first.noteId, second.noteId);
		const ids = await ankiCall<number[]>("findNotes", { query: `SourceId:"${sourceId}"` });
		assert.equal(ids.length, 1);
		const info = await ankiCall<Array<{ fields: Record<string, { value: string }> }>>("notesInfo", { notes: ids });
		assert.ok(info[0]!.fields.Solution!.value.includes("<p>Updated solution.</p>"));
		const optionModel = JSON.parse(info[0]!.fields.Options!.value);
		assert.deepEqual(optionModel.correct, ["Smaller"]);
		assert.ok(optionModel.options.includes("Larger"));
		const templates = await ankiCall<Record<string, { Front: string }>>("modelTemplates", { modelName: "LearnHarness Practice" });
		assert.ok(templates["Question → Answer"]!.Front.includes("lh-mc-v4"), "the real note type upgraded to the interactive renderer");
		const styling = await ankiCall<{ css: string }>("modelStyling", { modelName: "LearnHarness Practice" });
		assert.ok(styling.css.includes("data:font/woff2;base64,"), "KaTeX fonts are embedded in the note type");
		assert.ok(styling.css.includes('[data-streamdown="code-block-body"]'));
		assert.ok(styling.css.includes('.block{display:block}'));
		const cardIds = await ankiCall<number[]>("findCards", { query: `SourceId:"${sourceId}"` });
		const rendered = await ankiCall<Array<{ question: string; answer: string }>>("cardsInfo", { cards: cardIds });
		assert.ok(rendered[0]!.question.includes('data-side="front"'));
		assert.ok(rendered[0]!.answer.includes('data-side="back"'));
		assert.ok(rendered[0]!.question.includes("lh-options-data"));

		const response = await POST(new Request("http://test/api/anki/save", {
			method: "POST", headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ ...input, sourceId: sourceId + ":route", kind: "lesson" }),
		}));
		assert.equal(response.status, 200);
		const body = await response.json();
		assert.equal(body.ok, true);
	});

	it("deduplicates special-character and concurrent real saves", async () => {
		const sourceId = `learnharness:live:${Date.now()}:folder\\chat:"odd"`;
		const input = {
			sourceId, kind: "lesson" as const, question: "Concurrent identity test", options: [], distractors: [],
			answer: "One note", correctAnswers: ["One note"], solution: "", source: "live-test", mode: "check", targets: [],
		};
		const [first, second] = await Promise.all([saveToAnki(input), saveToAnki(input)]);
		assert.equal(first.updated, false);
		assert.equal(second.updated, true);
		assert.equal(first.noteId, second.noteId);
		const ids = await ankiCall<number[]>("findNotes", { query: 'deck:"LearnHarness" tag:learnharness' });
		const info = await ankiCall<Array<{ noteId: number; fields: Record<string, { value: string }> }>>("notesInfo", { notes: ids });
		assert.equal(info.filter((note) => note.fields.SourceId?.value === sourceId).length, 1);
	});

	it("renders bold, fenced code, and texttt in the real Anki reviewer HTML", async () => {
		const tex = String.fromCharCode(92);
		const sourceId = `learnharness:live:format:${Date.now()}`;
		await saveToAnki({
			sourceId, kind: "lesson",
			question: 'Game **has** Players. [Reference](https://example.com)\n![pixel](https://host.example/track.png)\n```csharp\nclass Hand { private List<Card> cards; }\nclass Deck { }\n```\n```mermaid\ngraph TD; A-->B;\n```',
			options: [], distractors: [], answer: "Association", correctAnswers: ["Association"],
			solution: `Use $${tex}texttt{Card}$.`, source: "live-test", mode: "check", targets: [],
		});
		const cards = await ankiCall<number[]>("findCards", { query: `SourceId:"${sourceId}"` });
		const [card] = await ankiCall<Array<{ question: string; answer: string }>>("cardsInfo", { cards });
		assert.ok(card!.question.includes('<strong data-streamdown="strong">has</strong>'));
		assert.ok(card!.question.includes('data-streamdown="code-block"'));
		assert.ok(card!.question.includes('<a href="https://example.com/" target="_blank" rel="noreferrer noopener">Reference</a>'));
		assert.ok(!card!.question.includes("<img"));
		assert.ok(!card!.question.includes("host.example"));
		assert.ok(card!.question.includes('data-streamdown="mermaid-source"'));
		assert.ok(!card!.question.includes('aria-busy="true"'));
		assert.ok(!card!.question.includes("```"));
		assert.ok(card!.answer.includes('<span class="katex">'));
		assert.ok(card!.answer.includes("mord texttt"));
	});
});
