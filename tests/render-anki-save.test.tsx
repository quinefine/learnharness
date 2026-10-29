import React from "react";
(globalThis as Record<string, unknown>).React = React;
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { QuestionDock } from "../components/question-dock.tsx";
import { PracticeDock } from "../components/practice-dock.tsx";
import { AnsweredCard } from "../components/answered-card.tsx";
import { ConcludeCard, ProblemCard } from "../components/practice-cards.tsx";

const quiz = {
	question: "Which connector is a dependency?",
	options: [{ label: "Solid line" }, { label: "Dashed arrow" }, { label: "Hollow triangle" }],
	correctAnswer: "Dashed arrow",
	explanation: "A dependency is a temporary use.",
};

describe("Save to Anki controls", () => {
	it("renders on a gradable lesson question", () => {
		const html = renderToStaticMarkup(
			<QuestionDock chatId="chat-uml" toolName="quiz" toolCallId="quiz-1" input={quiz}
				expanded onExpand={() => {}} onSubmit={() => {}} />,
		);
		assert.match(html, /data-testid="anki-options"/);
		assert.match(html, /aria-label="Anki options"/);
	});

	it("does not render on a preference question with no correct answer", () => {
		const html = renderToStaticMarkup(
			<QuestionDock toolName="ask_user_question" toolCallId="ask-1" input={{ question: "What next?" }}
				expanded onExpand={() => {}} onSubmit={() => {}} />,
		);
		assert.doesNotMatch(html, /data-testid="save-to-anki"/);
	});

	it("renders on practice while keeping the committed solution hidden", () => {
		const html = renderToStaticMarkup(
			<PracticeDock chatId="chat-uml" problemCallId="problem-1"
				input={{ statement: "Draw the stated link.", modelSolution: "A solid line.", mode: "recall", target: ["n_1"] }}
				expanded onExpand={() => {}} onSubmit={() => {}} />,
		);
		assert.match(html, /data-testid="anki-options"/);
		assert.doesNotMatch(html, /A solid line\./, "the save control must not reveal the solution");
	});

	it("offers retroactive save on an answered lesson card", () => {
		const answer = {
			kind: "quiz" as const, questionText: quiz.question, options: quiz.options.map((option, index) => ({ ...option, index: index + 1 })),
			dontKnow: false, answers: [{ index: 2, label: "Dashed arrow", value: "Dashed arrow" }], correct: true, correctIndices: [2],
			explanation: quiz.explanation, answeredAt: "2026-01-01T00:00:00Z",
		};
		const html = renderToStaticMarkup(<AnsweredCard answer={answer} input={quiz} chatId="chat-old" toolCallId="quiz-old" />);
		assert.match(html, /data-testid="anki-options"/);
	});

	it("offers retroactive save on old problem and conclusion cards without duplicating identity", () => {
		const problemInput = { statement: "Draw the stated link.", modelSolution: "A solid line.", mode: "recall", target: ["n_1"] };
		const problem = renderToStaticMarkup(<ProblemCard chatId="chat-old" part={{
			type: "tool-problem", state: "input-available", toolCallId: "problem-old", input: problemInput,
		}} />);
		const conclude = renderToStaticMarkup(<ConcludeCard chatId="chat-old" part={{
			type: "tool-conclude", state: "output-available", toolCallId: "conclude-old", problemCallId: "problem-old",
			input: { outcome: "solved" }, problemInput, reveal: "A solid line.",
		}} />);
		assert.match(problem, /data-testid="anki-options"/);
		assert.match(conclude, /data-testid="anki-options"/);
		const missingPoseIdentity = renderToStaticMarkup(<ConcludeCard chatId="chat-old" part={{
			type: "tool-conclude", state: "output-available", toolCallId: "conclude-legacy",
			input: { outcome: "solved" }, problemInput, reveal: "A solid line.",
		}} />);
		assert.doesNotMatch(missingPoseIdentity, /data-testid="anki-options"/);
	});
});
