import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	ankiAutoSaveSettings,
	ankiDistractors,
	ankiQuestionBank,
	ankiSessionSnapshots,
	answeredLessonSnapshot,
	lessonSnapshot,
	practiceAutoSaveKind,
	practiceCompletionTransition,
	practiceSnapshot,
} from "../src/core/anki-export.ts";
import type { QuestionAnswerData } from "../src/core/question-core.ts";

const answer: QuestionAnswerData = {
	kind: "quiz",
	questionText: "Which connector is a dependency?",
	options: [{ index: 1, label: "Solid" }, { index: 2, label: "Dashed" }],
	dontKnow: false,
	answers: [{ index: 2, label: "Dashed", value: "Dashed" }],
	correct: true,
	correctIndices: [2],
	explanation: "A dependency is a temporary use.",
	answeredAt: "2026-01-01T00:00:00Z",
};

describe("Anki export snapshots and preferences", () => {
	it("uses the same lesson identity for pending and retroactive saves", () => {
		const pending = lessonSnapshot({
			chatId: "chat-1", toolCallId: "quiz-1", question: answer.questionText,
			options: ["Solid", "Dashed"], answer: "Dashed", solution: answer.explanation, mode: "quiz",
		});
		const old = answeredLessonSnapshot(answer, {}, "chat-1", "quiz-1");
		assert.deepEqual(old, pending);
	});

	it("uses the problem id across active, old-problem, and concluded practice saves", () => {
		const input = { statement: "Draw the link.", modelSolution: "A solid line.", mode: "recall", target: ["n_1"] };
		const active = practiceSnapshot(input, "chat-1", "problem-1");
		const concluded = practiceSnapshot(input, "chat-1", "problem-1", "A solid line.");
		assert.deepEqual(concluded, active);
		assert.equal(active?.sourceId, "learnharness:chat-1:problem-1");
		assert.equal(active?.answer, "A solid line.");
	});

	it("builds a real session question bank and ranks same-target distractors", () => {
		const messages = [
			{ parts: [{ type: "tool-quiz", toolCallId: "q1", input: {
				question: "Connector?", options: [{ label: "Dashed arrow", value: "dashed" }], correctAnswer: "dashed",
			} }] },
			{ parts: [{ type: "tool-problem", toolCallId: "p1", input: {
				statement: "Draw a link", modelSolution: "Solid line", mode: "recall", target: ["n_1"],
			} }] },
			{ parts: [{ type: "tool-problem", toolCallId: "p2", input: {
				statement: "Draw another link", modelSolution: "Dotted line", mode: "recall", target: ["n_1"],
			} }] },
			{ parts: [{ type: "tool-explain", toolCallId: "e1", input: { question: "Long?", correctAnswer: "A long answer\nwith lines" } }] },
		];
		const bank = ankiQuestionBank(messages, "chat-1");
		assert.equal(bank.length, 3, "long solutions do not become options");
		const snapshot = practiceSnapshot({ statement: "Q", modelSolution: "Solid line", mode: "recall", target: ["n_1"] }, "chat-1", "p1")!;
		assert.deepEqual(ankiDistractors(bank, snapshot), ["Dotted line", "Dashed arrow"]);
		assert.ok(!ankiDistractors(bank, snapshot).includes("Solid line"), "the current answer is never a distractor");
		const all = ankiSessionSnapshots(messages, "chat-1");
		assert.equal(all.length, 4, "quiz, practice, and long-answer recall items export");
		assert.deepEqual(all.find((item) => item.sourceId === snapshot.sourceId)?.distractors, ["Dotted line", "Dashed arrow"]);
	});

	it("resolves legacy letter references without exporting unresolved keys as distractors", () => {
		const messages = [
			{ parts: [{ type: "tool-quiz", toolCallId: "legacy", input: {
				question: "Private?", options: [{ label: "Only inside the class" }, { label: "Same file", value: "b" }], correctAnswer: "a",
			} }] },
			{ parts: [{ type: "tool-quiz", toolCallId: "broken", input: {
				question: "Broken", options: [{ label: "First" }, { label: "Second" }], correctAnswer: "not-an-option",
			} }] },
			{ parts: [{ type: "tool-quiz", toolCallId: "explicit", input: {
				question: "Explicit", options: [{ label: "Positional" }, { label: "Explicit A", value: "a" }], correctAnswer: "a",
			} }] },
			{ parts: [{ type: "tool-quiz", toolCallId: "current", input: {
				question: "Price?", options: [{ label: "Still 10" }, { label: "Now 20" }, { label: "Undefined" }], correctAnswer: "Still 10",
			} }] },
		];
		const bank = ankiQuestionBank(messages, "chat-1");
		assert.deepEqual(bank.map((entry) => entry.answer), ["Only inside the class", "Explicit A", "Still 10"]);
		const current = ankiSessionSnapshots(messages, "chat-1").find((item) => item.sourceId.endsWith(":current"));
		assert.ok(current);
		assert.ok(!current.distractors.includes("a"));
		assert.ok(!current.distractors.includes("not-an-option"));
	});

	it("uses graded quiz labels instead of an incorrect learner submission", () => {
		const bank = ankiQuestionBank([{ parts: [{
			type: "tool-quiz", toolCallId: "graded",
			input: { question: "Pick one", options: [{ label: "Right" }, { label: "Wrong" }] },
			output: { kind: "quiz", committed: "Wrong", correctIndices: [1], options: [{ index: 1, label: "Right" }, { index: 2, label: "Wrong" }] },
		}] }]);
		assert.deepEqual(bank.map((entry) => entry.answer), ["Right"]);
	});

	it("rejects substring collisions with answers and between distractors", () => {
		const snapshot = practiceSnapshot({ statement: "Name it", modelSolution: "Solid line", target: ["n_1"] }, "chat-1", "current")!;
		const distractors = ankiDistractors([
			{ answer: "A solid line", sourceId: "other-1", mode: "practice", targets: ["n_1"], index: 0 },
			{ answer: "Dotted line", sourceId: "other-2", mode: "practice", targets: ["n_1"], index: 1 },
			{ answer: "Dotted line with arrow", sourceId: "other-3", mode: "practice", targets: ["n_1"], index: 2 },
			{ answer: "Dashed arrow", sourceId: "other-4", mode: "practice", targets: ["n_1"], index: 3 },
		], snapshot);
		assert.deepEqual(distractors, ["Dotted line", "Dashed arrow"]);
	});

	it("defaults auto-save off and parses only explicit boolean preferences", () => {
		assert.deepEqual(ankiAutoSaveSettings(null), { correct: false, incorrect: false });
		assert.deepEqual(ankiAutoSaveSettings({ correct: true, incorrect: "true" }), { correct: true, incorrect: false });
	});

	it("marks only an observed pending-to-completed practice transition", () => {
		const pending = { type: "tool-conclude", toolCallId: "c1", state: "input-available", problemCallId: "p1" };
		const old = practiceCompletionTransition(new Map(), [{ ...pending, state: "output-available" }]);
		assert.deepEqual([...old.newProblemIds], [], "historical output is not a new outcome");
		const seen = practiceCompletionTransition(new Map(), [pending]);
		const completed = practiceCompletionTransition(seen.current, [{ ...pending, state: "output-available" }]);
		assert.deepEqual([...completed.newProblemIds], ["p1"]);
	});

	it("maps only clear practice outcomes to correctness", () => {
		assert.equal(practiceAutoSaveKind("solved"), "correct");
		assert.equal(practiceAutoSaveKind("solvedWithHints"), "correct");
		assert.equal(practiceAutoSaveKind("surrendered"), "incorrect");
		assert.equal(practiceAutoSaveKind("movedOn"), null);
		assert.equal(practiceAutoSaveKind("dismissed"), null);
	});
});
