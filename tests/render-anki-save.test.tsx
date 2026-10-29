import React from "react";
(globalThis as Record<string, unknown>).React = React;
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { QuestionDock } from "../components/question-dock.tsx";
import { PracticeDock } from "../components/practice-dock.tsx";

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
		assert.match(html, /data-testid="save-to-anki"/);
		assert.match(html, />Save to Anki</);
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
		assert.match(html, /data-testid="save-to-anki"/);
		assert.doesNotMatch(html, /A solid line\./, "the save control must not reveal the solution");
	});
});
