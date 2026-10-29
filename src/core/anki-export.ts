import type { AnkiSaveInput } from "./contracts/anki.ts";
import type { QuestionAnswerData } from "./question-core.ts";

export type AnkiAutoSaveKind = "correct" | "incorrect";
export type AnkiAutoSaveSettings = Record<AnkiAutoSaveKind, boolean>;
export const DEFAULT_ANKI_AUTO_SAVE: AnkiAutoSaveSettings = { correct: false, incorrect: false };

export function ankiAutoSaveSettings(value: unknown): AnkiAutoSaveSettings {
	const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
	return { correct: record.correct === true, incorrect: record.incorrect === true };
}

export function lessonSnapshot({
	chatId, toolCallId, question, options, answer, solution = "", mode,
}: {
	chatId?: string; toolCallId: string; question: string; options: string[]; answer: string; solution?: string; mode?: string;
}): AnkiSaveInput | null {
	if (!question.trim() || !answer.trim()) return null;
	return {
		sourceId: `learnharness:${chatId ?? "question"}:${toolCallId}`,
		kind: "lesson",
		question,
		options,
		answer,
		solution,
		source: chatId ?? "LearnHarness lesson",
		mode,
		targets: [],
	};
}

function detailsOf(input: unknown): string {
	if (!input || typeof input !== "object") return "";
	const details = (input as { details?: unknown }).details;
	return typeof details === "string" && details.trim() ? `\n\n${details}` : "";
}

/** Build a retroactive lesson export from the persisted answer and original tool arguments. */
export function answeredLessonSnapshot(
	answer: QuestionAnswerData,
	input: unknown,
	chatId: string | undefined,
	toolCallId: string,
): AnkiSaveInput | null {
	const options = (answer.options ?? []).map((option) => option.label);
	const correct = answer.kind === "quiz"
		? (answer.correctIndices ?? []).map((index) => answer.options?.find((option) => option.index === index)?.label)
			.filter((label): label is string => Boolean(label)).join(" | ")
		: answer.kind === "explain" ? (answer.committed ?? "") : "";
	return lessonSnapshot({
		chatId,
		toolCallId,
		question: answer.questionText + detailsOf(input),
		options,
		answer: correct,
		solution: answer.explanation ?? "",
		mode: answer.questionType ?? answer.kind,
	});
}

export interface AnkiPracticeInput {
	statement?: unknown;
	modelSolution?: unknown;
	mode?: unknown;
	target?: unknown;
}

/** The same problem identity is used by the active dock, old problem card, and conclusion. */
export function practiceSnapshot(
	input: AnkiPracticeInput,
	chatId: string | undefined,
	problemCallId: string,
	solutionOverride?: string,
): AnkiSaveInput | null {
	const statement = typeof input.statement === "string" ? input.statement.trim() : "";
	const committed = typeof input.modelSolution === "string" ? input.modelSolution : "";
	const solution = (solutionOverride ?? committed).trim();
	if (!statement || !solution) return null;
	return {
		sourceId: `learnharness:${chatId ?? "practice"}:${problemCallId}`,
		kind: "practice",
		question: statement,
		options: [],
		answer: solution,
		solution: "",
		source: chatId ?? "LearnHarness practice",
		mode: typeof input.mode === "string" ? input.mode : undefined,
		targets: Array.isArray(input.target) ? input.target.filter((target): target is string => typeof target === "string") : [],
	};
}

export function practiceAutoSaveKind(outcome: string): AnkiAutoSaveKind | null {
	if (outcome === "solved" || outcome === "solvedWithHints") return "correct";
	if (outcome === "surrendered") return "incorrect";
	return null; // moved-on and dismissed are not correctness verdicts
}

export interface AnkiConcludePart {
	type: string;
	toolCallId: string;
	state: string;
	problemCallId?: string;
}

/** Only an observed pending→completed transition is a new outcome. Historical output has no previous pending state. */
export function practiceCompletionTransition(
	previous: ReadonlyMap<string, string>,
	parts: readonly AnkiConcludePart[],
): { current: Map<string, string>; newProblemIds: Set<string> } {
	const current = new Map<string, string>();
	const newProblemIds = new Set<string>();
	for (const part of parts) {
		if (part.type !== "tool-conclude") continue;
		const prior = previous.get(part.toolCallId);
		if (prior && prior !== "output-available" && part.state === "output-available" && part.problemCallId) {
			newProblemIds.add(part.problemCallId);
		}
		current.set(part.toolCallId, part.state);
	}
	return { current, newProblemIds };
}
