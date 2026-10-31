import type { AnkiQuestionBank, AnkiSaveInput } from "./contracts/anki.ts";
import type { QuestionAnswerData } from "./question-core.ts";

export type AnkiAutoSaveKind = "correct" | "incorrect";
export type AnkiAutoSaveSettings = Record<AnkiAutoSaveKind, boolean>;
export const DEFAULT_ANKI_AUTO_SAVE: AnkiAutoSaveSettings = { correct: false, incorrect: false };

export function ankiAutoSaveSettings(value: unknown): AnkiAutoSaveSettings {
	const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
	return { correct: record.correct === true, incorrect: record.incorrect === true };
}

export function lessonSnapshot({
	chatId, toolCallId, question, options, answer, solution = "", mode, correctAnswers, distractors = [],
}: {
	chatId?: string; toolCallId: string; question: string; options: string[]; answer: string; solution?: string; mode?: string;
	correctAnswers?: string[]; distractors?: string[];
}): AnkiSaveInput | null {
	if (!question.trim() || !answer.trim()) return null;
	return {
		sourceId: `learnharness:${chatId ?? "question"}:${toolCallId}`,
		kind: "lesson",
		question,
		options,
		distractors,
		answer,
		correctAnswers: correctAnswers?.length ? correctAnswers : [answer],
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
	const correctLabels = answer.kind === "quiz"
		? (answer.correctIndices ?? []).map((index) => answer.options?.find((option) => option.index === index)?.label)
			.filter((label): label is string => Boolean(label))
		: answer.kind === "explain" && answer.committed ? [answer.committed] : [];
	const correct = correctLabels.join(" | ");
	return lessonSnapshot({
		chatId,
		toolCallId,
		question: answer.questionText + detailsOf(input),
		options,
		answer: correct,
		correctAnswers: correctLabels,
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
	distractors: string[] = [],
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
		distractors,
		answer: solution,
		correctAnswers: [solution],
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

interface AnkiBankPart {
	type: string;
	toolCallId?: string;
	input?: unknown;
	output?: unknown;
}

function normalized(value: string): string {
	return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function nearDuplicate(a: string, b: string): boolean {
	const left = normalized(a);
	const right = normalized(b);
	if (left === right) return true;
	const [short, long] = left.length <= right.length ? [left, right] : [right, left];
	return short.length >= 2 && long.includes(short);
}

/** Multiple choice is useful only for concise answers. Long solutions remain free recall. */
export function ankiOptionEligible(value: string): boolean {
	const text = value.trim();
	return text.length > 0 && text.length <= 180 && !/[\r\n]/.test(text);
}

function quizAnswers(input: Record<string, unknown>): string[] {
	const options = Array.isArray(input.options) ? input.options as Array<{ label?: unknown; value?: unknown }> : [];
	const raw = Array.isArray(input.correctAnswer) ? input.correctAnswer : [input.correctAnswer];
	return raw.filter((value): value is string => typeof value === "string").map((value) => {
		const option = options.find((candidate) => candidate.value === value || candidate.label === value);
		return typeof option?.label === "string" ? option.label : value;
	});
}

function answeredAnswers(output: Record<string, unknown>): string[] {
	if (output.kind === "explain" && typeof output.committed === "string") return [output.committed];
	const options = Array.isArray(output.options) ? output.options as Array<{ index?: unknown; label?: unknown }> : [];
	const indices = Array.isArray(output.correctIndices) ? output.correctIndices : [];
	return indices.map((index) => options.find((option) => option.index === index)?.label)
		.filter((label): label is string => typeof label === "string");
}

/** Build distractor candidates from the actual session record, never invented answer text. */
export function ankiQuestionBank(messages: readonly { parts: AnkiBankPart[] }[], chatId?: string): AnkiQuestionBank {
	const bank: AnkiQuestionBank = [];
	const seen = new Set<string>();
	let index = 0;
	for (const message of messages) {
		for (const part of message.parts) {
			const practice = part.type === "tool-problem";
			const lesson = ["tool-quiz", "tool-probe", "tool-recall", "tool-explain"].includes(part.type);
			if ((!practice && !lesson) || !part.toolCallId) continue;
			const input = (part.input ?? {}) as Record<string, unknown>;
			const output = (part.output ?? {}) as Record<string, unknown>;
			let answers = (practice ? [input.modelSolution] : quizAnswers(input))
				.filter((answer): answer is string => typeof answer === "string");
			if (answers.length === 0 && !practice) answers = answeredAnswers(output);
			const mode = typeof input.mode === "string" ? input.mode : practice ? "practice" : part.type.slice("tool-".length);
			const targets = Array.isArray(input.target) ? input.target.filter((target): target is string => typeof target === "string") : [];
			const sourceId = `learnharness:${chatId ?? (practice ? "practice" : "question")}:${part.toolCallId}`;
			for (const answer of answers) {
				if (!ankiOptionEligible(answer)) continue;
				const key = `${sourceId}\0${normalized(answer)}`;
				if (seen.has(key)) continue;
				seen.add(key);
				bank.push({ answer: answer.trim(), sourceId, mode, targets, index: index++ });
			}
		}
	}
	return bank;
}

function lessonPartSnapshot(part: AnkiBankPart, chatId?: string): AnkiSaveInput | null {
	if (!part.toolCallId) return null;
	const input = (part.input ?? {}) as Record<string, unknown>;
	const output = (part.output ?? {}) as QuestionAnswerData;
	if (output && typeof output.kind === "string" && typeof output.questionText === "string" && !output.dismissed) {
		return answeredLessonSnapshot(output, input, chatId, part.toolCallId);
	}
	const answers = quizAnswers(input);
	if (answers.length === 0 || typeof input.question !== "string") return null;
	const options = Array.isArray(input.options)
		? (input.options as Array<{ label?: unknown }>).map((option) => option.label).filter((label): label is string => typeof label === "string")
		: [];
	return lessonSnapshot({
		chatId,
		toolCallId: part.toolCallId,
		question: input.question + detailsOf(input),
		options,
		answer: answers.join(" | "),
		correctAnswers: answers,
		solution: typeof input.explanation === "string" ? input.explanation : "",
		mode: typeof input.type === "string" ? input.type : part.type.slice("tool-".length),
	});
}

/** Every eligible item in one session, deduplicated by its stable source identity. */
export function ankiSessionSnapshots(messages: readonly { parts: AnkiBankPart[] }[], chatId?: string): AnkiSaveInput[] {
	const bank = ankiQuestionBank(messages, chatId);
	const snapshots: AnkiSaveInput[] = [];
	const seen = new Set<string>();
	for (const message of messages) {
		for (const part of message.parts) {
			const snapshot = part.type === "tool-problem"
				? part.toolCallId ? practiceSnapshot((part.input ?? {}) as AnkiPracticeInput, chatId, part.toolCallId) : null
				: lessonPartSnapshot(part, chatId);
			if (!snapshot || seen.has(snapshot.sourceId)) continue;
			seen.add(snapshot.sourceId);
			snapshots.push(snapshot);
		}
	}
	return snapshots.map((snapshot) => withAnkiDistractors(snapshot, bank)!);
}

/** Same-target and same-mode answers rank first; the current question and its correct labels are excluded. */
export function ankiDistractors(bank: AnkiQuestionBank, snapshot: AnkiSaveInput): string[] {
	const correct = (snapshot.correctAnswers.length ? snapshot.correctAnswers : [snapshot.answer]).map(normalized);
	const targets = new Set(snapshot.targets);
	const selected: string[] = [];
	const ranked = bank
		.filter((candidate) => candidate.sourceId !== snapshot.sourceId)
		.map((candidate) => ({
			candidate,
			score: candidate.targets.filter((target) => targets.has(target)).length * 10 + (candidate.mode === snapshot.mode ? 3 : 0),
		}))
		.sort((a, b) => b.score - a.score || a.candidate.index - b.candidate.index);
	for (const { candidate } of ranked) {
		if (correct.some((answer) => nearDuplicate(answer, candidate.answer))) continue;
		if (selected.some((answer) => nearDuplicate(answer, candidate.answer))) continue;
		selected.push(candidate.answer);
	}
	return selected;
}

export function withAnkiDistractors(snapshot: AnkiSaveInput | null, bank: AnkiQuestionBank): AnkiSaveInput | null {
	return snapshot ? { ...snapshot, distractors: ankiDistractors(bank, snapshot) } : null;
}
