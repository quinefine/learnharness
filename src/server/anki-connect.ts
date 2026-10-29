/**
 * AnkiConnect adapter for selective lesson/practice export.
 *
 * AnkiConnect runs beside desktop Anki (default http://127.0.0.1:8765), not inside LearnHarness.
 * Every request uses the modern nested `params` envelope. SourceId gives idempotent saves: a second
 * save of the same question updates its note instead of creating a duplicate.
 */
import { z } from "zod";
import type { AnkiSaveInput } from "../core/contracts/anki.ts";

export const ANKI_MODEL = "LearnHarness Practice";
export const ANKI_DECK = "LearnHarness";
const FIELDS = ["Question", "Options", "Answer", "Solution", "Source", "SourceId", "Mode", "Targets"] as const;

export const ankiSaveSchema = z.object({
	sourceId: z.string().trim().min(3).max(500),
	kind: z.enum(["lesson", "practice"]),
	question: z.string().trim().min(1).max(100_000),
	options: z.array(z.string().trim().min(1).max(10_000)).max(20).default([]),
	answer: z.string().trim().min(1).max(100_000),
	solution: z.string().trim().max(100_000).default(""),
	source: z.string().trim().min(1).max(500),
	mode: z.string().trim().max(100).optional(),
	targets: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
});
export type { AnkiSaveInput } from "../core/contracts/anki.ts";
export type AnkiSaveResult = { noteId: number; updated: boolean; deck: string; model: string };

export class AnkiConnectError extends Error {
	constructor(message: string, readonly causeValue?: unknown) {
		super(message);
		this.name = "AnkiConnectError";
	}
}

/** Keep model-authored content as safe plain HTML, not executable card markup. */
export function plainHtml(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/\r\n?/g, "\n").replace(/\n/g, "<br>");
}

export function optionsHtml(options: readonly string[]): string {
	return options.map((option, i) => `<div class="lh-option"><span class="lh-key">${String.fromCharCode(65 + i)}</span> ${plainHtml(option)}</div>`).join("");
}

export function noteFields(input: AnkiSaveInput): Record<(typeof FIELDS)[number], string> {
	return {
		Question: plainHtml(input.question),
		Options: optionsHtml(input.options),
		Answer: plainHtml(input.answer),
		Solution: plainHtml(input.solution),
		Source: plainHtml(input.source),
		SourceId: input.sourceId, // hidden identity field: preserve the exact searchable value
		Mode: plainHtml(input.mode ?? input.kind),
		Targets: plainHtml(input.targets.join(", ")),
	};
}

const FRONT = `<div class="lh-question">{{Question}}</div>{{#Options}}<div class="lh-options">{{Options}}</div>{{/Options}}`;
const BACK = `{{FrontSide}}<hr><div class="lh-label">Answer</div><div class="lh-answer">{{Answer}}</div>{{#Solution}}<div class="lh-label">Solution</div><div class="lh-solution">{{Solution}}</div>{{/Solution}}<div class="lh-meta">{{Mode}} · {{Source}}</div>`;
const CSS = `.card{font-family:system-ui,sans-serif;font-size:20px;line-height:1.5;padding:20px;color:var(--fg);background:var(--bg)}.lh-question{white-space:normal}.lh-options{margin-top:1rem;display:grid;gap:.55rem}.lh-option{padding:.65rem .8rem;border:1px solid #8886;border-radius:.6rem}.lh-key{font-weight:700;margin-right:.45rem}.lh-label{margin-top:1rem;color:var(--fg-faint);font-size:.75em;text-transform:uppercase;letter-spacing:.06em}.lh-answer{font-weight:650;margin-top:.3rem}.lh-solution{margin-top:.3rem}.lh-meta{margin-top:1.4rem;color:var(--fg-faint);font-size:.72em}@media(max-width:480px){.card{font-size:18px;padding:14px}}`;

type Envelope = { result: unknown; error: string | null };

/** One transport seam; tests replace it with a local HTTP server. */
export async function ankiCall<T>(action: string, params: Record<string, unknown> = {}, endpoint = defaultEndpoint(), timeoutMs = 5000): Promise<T> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetch(endpoint, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action, version: 6, params }),
			signal: controller.signal,
		});
		if (!response.ok) throw new AnkiConnectError(`AnkiConnect returned HTTP ${response.status}`);
		const body = await response.json() as Envelope;
		if (body.error) throw new AnkiConnectError(body.error);
		return body.result as T;
	} catch (error) {
		if (error instanceof AnkiConnectError) throw error;
		throw new AnkiConnectError(`Cannot reach AnkiConnect at ${endpoint}. Open Anki with AnkiConnect enabled.`, error);
	} finally {
		clearTimeout(timer);
	}
}

export function defaultEndpoint(): string {
	return process.env.ANKI_CONNECT_URL?.trim() || "http://127.0.0.1:8765";
}

export async function healthCheck(endpoint = defaultEndpoint()): Promise<boolean> {
	return (await ankiCall<number>("version", {}, endpoint)) >= 6;
}

const modelEnsures = new Map<string, Promise<void>>();

/** Serialize first-time setup per endpoint so concurrent saves cannot create the model twice. */
async function ensureDeckAndModel(endpoint: string): Promise<void> {
	const current = modelEnsures.get(endpoint);
	if (current) return current;
	const run = (async () => {
		await ankiCall("createDeck", { deck: ANKI_DECK }, endpoint);
		const names = await ankiCall<string[]>("modelNames", {}, endpoint);
		if (!names.includes(ANKI_MODEL)) {
			await ankiCall("createModel", {
				modelName: ANKI_MODEL,
				inOrderFields: [...FIELDS],
				css: CSS,
				cardTemplates: [{ Name: "Question → Answer", Front: FRONT, Back: BACK }],
			}, endpoint);
		}
	})();
	let tracked: Promise<void>;
	tracked = run.finally(() => {
		if (modelEnsures.get(endpoint) === tracked) modelEnsures.delete(endpoint);
	});
	modelEnsures.set(endpoint, tracked);
	return tracked;
}

function tag(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9_:-]+/g, "_").replace(/^_+|_+$/g, "") || "untagged";
}

/** Escape Anki's quoted-query syntax without changing the raw SourceId stored on the note. */
function sourceQuery(sourceId: string): string {
	return `SourceId:"${sourceId.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

async function saveToAnkiUnlocked(valid: AnkiSaveInput, endpoint: string): Promise<AnkiSaveResult> {
	await ensureDeckAndModel(endpoint);
	const fields = noteFields(valid);
	const existing = await ankiCall<number[]>("findNotes", { query: sourceQuery(valid.sourceId) }, endpoint);
	const tags = ["learnharness", `kind-${tag(valid.kind)}`, `mode-${tag(valid.mode ?? valid.kind)}`,
		...valid.targets.map((target) => `target-${tag(target)}`)];
	if (existing.length > 1) {
		throw new AnkiConnectError(`Multiple Anki notes have SourceId ${JSON.stringify(valid.sourceId)}; save stopped`);
	}
	if (existing.length === 1) {
		await ankiCall("updateNoteFields", { note: { id: existing[0], fields } }, endpoint);
		await ankiCall("updateNoteTags", { note: existing[0], tags }, endpoint);
		return { noteId: existing[0]!, updated: true, deck: ANKI_DECK, model: ANKI_MODEL };
	}
	const noteId = await ankiCall<number>("addNote", {
		note: { deckName: ANKI_DECK, modelName: ANKI_MODEL, fields, tags,
			// SourceId, not Anki's content hash, owns deduplication. Two sessions may legitimately
			// contain the same question text, while a second save of one source must update in place.
			options: { allowDuplicate: true } },
	}, endpoint);
	if (!noteId) throw new AnkiConnectError("Anki refused the note without returning an id");
	return { noteId, updated: false, deck: ANKI_DECK, model: ANKI_MODEL };
}

const sourceQueues = new Map<string, Promise<AnkiSaveResult>>();

/** Create or update one saved question. No AnkiWeb sync is triggered: desktop Anki owns that. */
export async function saveToAnki(input: AnkiSaveInput, endpoint = defaultEndpoint()): Promise<AnkiSaveResult> {
	const valid = ankiSaveSchema.parse(input);
	const key = `${endpoint}\0${valid.sourceId}`;
	const previous = sourceQueues.get(key) ?? Promise.resolve();
	const run = previous.catch(() => undefined).then(() => saveToAnkiUnlocked(valid, endpoint));
	let tracked: Promise<AnkiSaveResult>;
	tracked = run.finally(() => {
		if (sourceQueues.get(key) === tracked) sourceQueues.delete(key);
	});
	sourceQueues.set(key, tracked);
	return tracked;
}
