/** A frozen lesson/practice question destined for desktop Anki. UI-safe: no server dependencies. */
export interface AnkiSaveInput {
	/** Stable identity used to update rather than duplicate the saved note. */
	sourceId: string;
	kind: "lesson" | "practice";
	question: string;
	options: string[];
	answer: string;
	solution: string;
	/** Human-readable session reference shown on the back. */
	source: string;
	mode?: string;
	targets: string[];
}
