/**
 * AnkiConnect adapter for selective lesson/practice export.
 *
 * AnkiConnect runs beside desktop Anki (default http://127.0.0.1:8765), not inside LearnHarness.
 * Every request uses the modern nested `params` envelope. SourceId gives idempotent saves: a second
 * save of the same question updates its note instead of creating a duplicate.
 */
import { z } from "zod";
import { ankiOptionEligible } from "../core/anki-export.ts";
import type { AnkiSaveInput } from "../core/contracts/anki.ts";
import { ANKI_TEMPLATE_VERSION, BACK, CSS, FRONT } from "./anki-card-template.ts";
import { renderAnkiMarkdown } from "./anki-markdown.tsx";

export const ANKI_MODEL = "LearnHarness Practice";
export const ANKI_DECK = "LearnHarness";
const FIELDS = ["Question", "Options", "Answer", "Solution", "Source", "SourceId", "Mode", "Targets"] as const;

export const ankiSaveSchema = z.object({
	sourceId: z.string().trim().min(3).max(500),
	kind: z.enum(["lesson", "practice"]),
	question: z.string().trim().min(1).max(100_000),
	options: z.array(z.string().trim().min(1).max(10_000)).max(20).default([]),
	distractors: z.array(z.string().trim().min(1).max(10_000)).max(100).default([]),
	answer: z.string().trim().min(1).max(100_000),
	correctAnswers: z.array(z.string().trim().min(1).max(10_000)).max(20).default([]),
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

function escapeHtml(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Keep model-authored content as safe plain HTML, not executable card markup. */
export function plainHtml(text: string): string {
	return escapeHtml(text).replace(/\r\n?/g, "\n").replace(/\n/g, "<br>");
}

function optionKey(text: string): string {
	return text.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function nearDuplicate(a: string, b: string): boolean {
	const left = optionKey(a);
	const right = optionKey(b);
	if (left === right) return true;
	const [short, long] = left.length <= right.length ? [left, right] : [right, left];
	return short.length >= 2 && long.includes(short);
}

/** One model supplies the option list and correct labels for every renderer. */
export function optionModel(input: AnkiSaveInput): { v: 1; options: string[]; correct: string[]; multi: boolean; optionHtml: Record<string, string> } {
	const correct: string[] = [];
	for (const answer of input.correctAnswers.length ? input.correctAnswers : [input.answer]) {
		const text = answer.trim();
		if (text && !correct.some((existing) => optionKey(existing) === optionKey(text))) correct.push(text);
	}
	const correctKeys = new Set(correct.map(optionKey));
	const options: string[] = [];
	const add = (label: string, isCorrect: boolean) => {
		const text = label.trim();
		if (!text || options.some((option) => optionKey(option) === optionKey(text))) return;
		if (!isCorrect && (correctKeys.has(optionKey(text)) || options.some((option) => nearDuplicate(option, text)))) return;
		options.push(text);
	};
	for (const option of input.options) add(option, correctKeys.has(optionKey(option)));
	// Free-form answers become MC only when the correct answer itself is concise.
	const canGenerate = correct.every(ankiOptionEligible);
	if (input.options.length > 0 || canGenerate) {
		for (const answer of correct) add(answer, true);
	}
	if (canGenerate) {
		for (const candidate of input.distractors) {
			if (options.length >= 4) break;
			add(candidate, false);
		}
	}
	const optionHtml = Object.fromEntries(options.map((label) => [label, renderAnkiMarkdown(label)]));
	return { v: 1, options, correct, multi: correct.length > 1 && options.length > 1, optionHtml };
}

export function optionsData(input: AnkiSaveInput): string {
	return JSON.stringify(optionModel(input))
		.replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026")
		.replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

export function noteFields(input: AnkiSaveInput): Record<(typeof FIELDS)[number], string> {
	return {
		Question: renderAnkiMarkdown(input.question),
		Options: optionsData(input),
		Answer: renderAnkiMarkdown(input.answer),
		Solution: renderAnkiMarkdown(input.solution),
		Source: plainHtml(input.source),
		SourceId: input.sourceId, // hidden identity field: preserve the exact searchable value
		Mode: plainHtml(input.mode ?? input.kind),
		Targets: plainHtml(input.targets.join(", ")),
	};
}

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
			return;
		}
		const templates = await ankiCall<Record<string, { Front: string; Back: string }>>("modelTemplates", { modelName: ANKI_MODEL }, endpoint);
		const styling = await ankiCall<{ css: string }>("modelStyling", { modelName: ANKI_MODEL }, endpoint);
		const current = templates["Question → Answer"];
		let templateUpdated = false;
		let stylingUpdated = false;
		try {
			if (!current?.Front.includes(ANKI_TEMPLATE_VERSION)) {
				await ankiCall("updateModelTemplates", {
					model: { name: ANKI_MODEL, templates: { "Question → Answer": { Front: FRONT, Back: BACK } } },
				}, endpoint);
				templateUpdated = true;
			}
			if (!styling.css.includes(ANKI_TEMPLATE_VERSION)) {
				await ankiCall("updateModelStyling", { model: { name: ANKI_MODEL, css: CSS } }, endpoint);
				stylingUpdated = true;
			}
		} catch (error) {
			const rollbacks: Promise<unknown>[] = [];
			if (templateUpdated && current) {
				rollbacks.push(ankiCall("updateModelTemplates", {
					model: { name: ANKI_MODEL, templates: { "Question → Answer": current } },
				}, endpoint));
			}
			if (stylingUpdated) {
				rollbacks.push(ankiCall("updateModelStyling", { model: { name: ANKI_MODEL, css: styling.css } }, endpoint));
			}
			await Promise.allSettled(rollbacks);
			throw error;
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
