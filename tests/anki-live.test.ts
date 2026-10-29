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
			sourceId, kind: "practice" as const, question: "Why is 2 < 3?", options: ["Smaller", "Larger"],
			answer: "Smaller", solution: "Compare the integers.", source: "live-test", mode: "recall", targets: ["n_1"],
		};
		const first = await saveToAnki(input);
		const second = await saveToAnki({ ...input, solution: "Updated solution." });
		assert.equal(first.updated, false);
		assert.equal(second.updated, true);
		assert.equal(first.noteId, second.noteId);
		const ids = await ankiCall<number[]>("findNotes", { query: `SourceId:"${sourceId}"` });
		assert.equal(ids.length, 1);
		const info = await ankiCall<Array<{ fields: Record<string, { value: string }> }>>("notesInfo", { notes: ids });
		assert.equal(info[0]!.fields.Solution!.value, "Updated solution.");

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
			sourceId, kind: "lesson" as const, question: "Concurrent identity test", options: [],
			answer: "One note", solution: "", source: "live-test", mode: "check", targets: [],
		};
		const [first, second] = await Promise.all([saveToAnki(input), saveToAnki(input)]);
		assert.equal(first.updated, false);
		assert.equal(second.updated, true);
		assert.equal(first.noteId, second.noteId);
		const ids = await ankiCall<number[]>("findNotes", { query: 'deck:"LearnHarness" tag:learnharness' });
		const info = await ankiCall<Array<{ noteId: number; fields: Record<string, { value: string }> }>>("notesInfo", { notes: ids });
		assert.equal(info.filter((note) => note.fields.SourceId?.value === sourceId).length, 1);
	});
});
