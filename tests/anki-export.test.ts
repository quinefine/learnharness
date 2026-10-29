import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	ankiAutoSaveSettings,
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
