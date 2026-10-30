export interface AnkiQuestionCandidate {
	answer: string;
	sourceId: string;
	mode: string;
	targets: string[];
	index: number;
}
export type AnkiQuestionBank = AnkiQuestionCandidate[];

/** A frozen lesson/practice question destined for desktop Anki. UI-safe: no server dependencies. */
export interface AnkiSaveInput {
	/** Stable identity used to update rather than duplicate the saved note. */
	sourceId: string;
	kind: "lesson" | "practice";
	question: string;
	options: string[];
	/** Candidate wrong answers drawn from other questions in the same session. */
	distractors: string[];
	answer: string;
	/** Machine-readable correct labels, including multi-select answers. */
	correctAnswers: string[];
	solution: string;
	/** Human-readable session reference shown on the back. */
	source: string;
	mode?: string;
	targets: string[];
}
