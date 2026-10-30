import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { AnkiSaveMenu } from "../components/anki-save-menu.tsx";
import { AnsweredCard } from "../components/answered-card.tsx";
import { ConcludeCard } from "../components/practice-cards.tsx";
import type { AnkiSaveInput } from "../src/core/contracts/anki.ts";

const dom = parseHTML("<html><body></body></html>");
const store = new Map<string, string>();
const localStorage = {
	getItem: (key: string) => store.get(key) ?? null,
	setItem: (key: string, value: string) => { store.set(key, value); },
	removeItem: (key: string) => { store.delete(key); },
	clear: () => store.clear(),
};
Object.assign(globalThis, {
	window: dom.window, document: dom.document, HTMLElement: dom.window.HTMLElement,
	Event: dom.window.Event, localStorage, IS_REACT_ACT_ENVIRONMENT: true,
});
let focusedElement: Element | null = null;
Object.defineProperty(dom.document, "activeElement", { configurable: true, get: () => focusedElement });
dom.window.HTMLElement.prototype.focus = function () { focusedElement = this; };

const snapshot: AnkiSaveInput = {
	sourceId: "learnharness:chat-1:quiz-1", kind: "lesson", question: "Q", options: ["A", "B"],
	distractors: [], answer: "A", correctAnswers: ["A"], solution: "Why A", source: "chat-1", mode: "quiz", targets: [],
};

function keyEvent(key: string): Event {
	const event = new dom.window.Event("keydown", { bubbles: true });
	Object.defineProperty(event, "key", { value: key });
	return event;
}

let host: HTMLDivElement;
let root: Root;
let requests: Array<{ url: string; body: unknown }>;
let fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

beforeEach(async () => {
	store.clear();
	localStorage.setItem = (key: string, value: string) => { store.set(key, value); };
	requests = [];
	fetchImpl = async () => Response.json({ ok: true, updated: false });
	globalThis.fetch = async (input, init) => {
		requests.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : null });
		return fetchImpl(input, init);
	};
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
});

afterEach(async () => {
	await act(async () => root.unmount());
	host.remove();
});

describe("Anki options menu", () => {
	it("does not auto-save by default and locks synchronous double clicks", async () => {
		let release!: (response: Response) => void;
		fetchImpl = () => new Promise<Response>((resolve) => { release = resolve; });
		await act(async () => root.render(<AnkiSaveMenu snapshot={snapshot} autoSaveWhen="correct" />));
		assert.equal(requests.length, 0, "default preferences never upload");
		await act(async () => { host.querySelector<HTMLButtonElement>('[data-testid="anki-options"]')!.click(); });
		const save = document.body.querySelector<HTMLButtonElement>('[data-testid="save-to-anki"]')!;
		await act(async () => { save.click(); save.click(); });
		assert.equal(requests.length, 1, "the synchronous lock admits one request");
		assert.equal(requests[0]!.url, "/api/anki/save");
		assert.deepEqual(requests[0]!.body, snapshot);
		await act(async () => { release(Response.json({ ok: true, updated: false })); });
		assert.match(document.body.textContent!, /Saved to Anki/);
	});

	it("starts auto-saving new correct answers only after the user opts in", async () => {
		await act(async () => root.render(<AnkiSaveMenu snapshot={snapshot} autoSaveWhen="correct" />));
		assert.equal(requests.length, 0);
		await act(async () => { host.querySelector<HTMLButtonElement>('[data-testid="anki-options"]')!.click(); });
		await act(async () => { document.body.querySelector<HTMLInputElement>('[data-testid="anki-auto-correct"]')!.click(); });
		assert.equal(requests.length, 1);
	});

	it("honors a persisted incorrect-answer preference on a new outcome", async () => {
		store.set("learnharness.anki-auto-save.v1", JSON.stringify({ correct: false, incorrect: true }));
		await act(async () => root.render(<AnkiSaveMenu snapshot={snapshot} autoSaveWhen="incorrect" />));
		assert.equal(requests.length, 1);
	});

	it("auto-saves exactly once under React Strict Mode", async () => {
		store.set("learnharness.anki-auto-save.v1", JSON.stringify({ correct: true, incorrect: false }));
		await act(async () => root.render(<React.StrictMode><AnkiSaveMenu snapshot={snapshot} autoSaveWhen="correct" /></React.StrictMode>));
		assert.equal(requests.length, 1);
		await act(async () => { host.querySelector<HTMLButtonElement>('[data-testid="anki-options"]')!.click(); });
		assert.match(document.body.textContent!, /Saved to Anki/);
	});

	it("queues a new outcome that arrives during another save", async () => {
		store.set("learnharness.anki-auto-save.v1", JSON.stringify({ correct: true, incorrect: true }));
		let release!: (response: Response) => void;
		let first = true;
		fetchImpl = () => first
			? new Promise<Response>((resolve) => { release = resolve; })
			: Promise.resolve(Response.json({ ok: true, updated: true }));
		await act(async () => root.render(<AnkiSaveMenu snapshot={snapshot} autoSaveWhen="correct" />));
		assert.equal(requests.length, 1);
		first = false;
		await act(async () => root.render(<AnkiSaveMenu snapshot={snapshot} autoSaveWhen="incorrect" />));
		assert.equal(requests.length, 1, "the second outcome waits for the active request");
		await act(async () => { release(Response.json({ ok: true, updated: false })); });
		assert.equal(requests.length, 2, "completion retries the queued outcome");
	});

	it("does not show an old request's completion for a different question", async () => {
		let release!: (response: Response) => void;
		fetchImpl = () => new Promise<Response>((resolve) => { release = resolve; });
		await act(async () => root.render(<AnkiSaveMenu snapshot={snapshot} />));
		await act(async () => { host.querySelector<HTMLButtonElement>('[data-testid="anki-options"]')!.click(); });
		await act(async () => { document.body.querySelector<HTMLButtonElement>('[data-testid="save-to-anki"]')!.click(); });
		await act(async () => root.render(<AnkiSaveMenu snapshot={{ ...snapshot, sourceId: "learnharness:chat-1:quiz-2", question: "New Q" }} />));
		await act(async () => { release(Response.json({ ok: true, updated: false })); });
		assert.doesNotMatch(document.body.textContent!, /Saved to Anki|Updated in Anki/);
	});

	it("keeps the in-memory preference when storage writes fail", async () => {
		localStorage.setItem = () => { throw new Error("storage denied"); };
		await act(async () => root.render(<AnkiSaveMenu snapshot={snapshot} autoSaveWhen="correct" />));
		await act(async () => { host.querySelector<HTMLButtonElement>('[data-testid="anki-options"]')!.click(); });
		const toggle = document.body.querySelector<HTMLInputElement>('[data-testid="anki-auto-correct"]')!;
		await act(async () => { toggle.click(); });
		assert.equal(toggle.checked, true);
		assert.equal(requests.length, 1);
	});

	it("latches a practice outcome when live completion becomes eligible after mount", async () => {
		store.set("learnharness.anki-auto-save.v1", JSON.stringify({ correct: true, incorrect: false }));
		const part = {
			type: "tool-conclude", state: "output-available", toolCallId: "conclude-1", problemCallId: "problem-1",
			input: { outcome: "solved" },
			problemInput: { statement: "Practice Q", modelSolution: "Practice A", mode: "recall", target: [] },
			reveal: "Practice A",
		};
		await act(async () => root.render(<ConcludeCard part={part} chatId="chat-1" autoSaveEligible={false} />));
		assert.equal(requests.length, 0);
		await act(async () => root.render(<ConcludeCard part={part} chatId="chat-1" autoSaveEligible />));
		assert.equal(requests.length, 1);
	});

	it("does not auto-save when an old session opens, even with a preference enabled", async () => {
		store.set("learnharness.anki-auto-save.v1", JSON.stringify({ correct: true, incorrect: false }));
		const answer = {
			kind: "quiz" as const, questionText: "Old Q",
			options: [{ index: 1, label: "A" }, { index: 2, label: "B" }], dontKnow: false,
			answers: [{ index: 1, label: "A", value: "A" }], correct: true, correctIndices: [1],
			answeredAt: new Date().toISOString(),
		};
		await act(async () => root.render(<AnsweredCard answer={answer} input={{}} chatId="chat-old" toolCallId="quiz-old" autoSaveEligible={false} />));
		assert.equal(requests.length, 0);
	});

	it("resets eligibility when a card instance changes question identity", async () => {
		store.set("learnharness.anki-auto-save.v1", JSON.stringify({ correct: true, incorrect: false }));
		const answer = {
			kind: "quiz" as const, questionText: "Q",
			options: [{ index: 1, label: "A" }, { index: 2, label: "B" }], dontKnow: false,
			answers: [{ index: 1, label: "A", value: "A" }], correct: true, correctIndices: [1],
			answeredAt: new Date().toISOString(),
		};
		await act(async () => root.render(<AnsweredCard answer={answer} input={{}} chatId="chat-1" toolCallId="quiz-new" autoSaveEligible />));
		assert.equal(requests.length, 1);
		await act(async () => root.render(<AnsweredCard answer={{ ...answer, questionText: "Historical Q" }} input={{}} chatId="chat-1" toolCallId="quiz-old" autoSaveEligible={false} />));
		assert.equal(requests.length, 1, "the old card cannot inherit the new answer's eligibility");
	});

	it("exports every eligible session item from one menu action", async () => {
		const second = { ...snapshot, sourceId: "learnharness:chat-1:quiz-2", question: "Second Q" };
		await act(async () => root.render(<AnkiSaveMenu sessionSnapshots={[snapshot, second]} />));
		await act(async () => { host.querySelector<HTMLButtonElement>('[data-testid="anki-options"]')!.click(); });
		const exportButton = document.body.querySelector<HTMLButtonElement>('[data-testid="save-to-anki"]')!;
		assert.match(exportButton.textContent!, /Export all 2 items to Anki/);
		await act(async () => { exportButton.click(); });
		assert.equal(requests.length, 2);
		assert.deepEqual(requests.map((request) => (request.body as AnkiSaveInput).sourceId), [snapshot.sourceId, second.sourceId]);
		assert.match(document.body.textContent!, /Exported 2 of 2 items/);
	});

	it("moves focus into the menu, supports arrows, and restores focus on Escape", async () => {
		await act(async () => root.render(<AnkiSaveMenu snapshot={snapshot} />));
		const trigger = host.querySelector<HTMLButtonElement>('[data-testid="anki-options"]')!;
		await act(async () => { trigger.click(); });
		const save = document.body.querySelector<HTMLButtonElement>('[data-testid="save-to-anki"]')!;
		assert.equal(document.activeElement, save);
		const menu = document.body.querySelector<HTMLDivElement>('[data-testid="anki-menu"]')!;
		await act(async () => { menu.dispatchEvent(keyEvent("ArrowDown")); });
		assert.equal(document.activeElement, document.body.querySelector('[data-testid="anki-auto-correct"]'));
		await act(async () => { document.dispatchEvent(keyEvent("Escape")); });
		assert.equal(document.body.querySelector('[data-testid="anki-menu"]'), null);
		assert.equal(document.activeElement, trigger);
	});
});
