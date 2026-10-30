"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
	DEFAULT_ANKI_AUTO_SAVE,
	ankiAutoSaveSettings,
	type AnkiAutoSaveKind,
	type AnkiAutoSaveSettings,
	type AnkiSaveInput,
} from "@/src/core";

const STORAGE_KEY = "learnharness.anki-auto-save.v1";
const SETTINGS_EVENT = "learnharness:anki-auto-save-changed";

export function useAutoSaveSettings(): [AnkiAutoSaveSettings, (kind: AnkiAutoSaveKind) => void] {
	const [settings, setSettings] = useState(DEFAULT_ANKI_AUTO_SAVE);
	useEffect(() => {
		const read = () => {
			try {
				setSettings(ankiAutoSaveSettings(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null")));
			} catch {
				setSettings(DEFAULT_ANKI_AUTO_SAVE);
			}
		};
		read();
		window.addEventListener("storage", read);
		window.addEventListener(SETTINGS_EVENT, read);
		return () => {
			window.removeEventListener("storage", read);
			window.removeEventListener(SETTINGS_EVENT, read);
		};
	}, []);
	const toggle = (kind: AnkiAutoSaveKind) => {
		const next = { ...settings, [kind]: !settings[kind] };
		setSettings(next);
		let persisted = true;
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
		} catch {
			persisted = false; // Keep this instance's in-memory setting; do not re-read stale storage.
		}
		if (persisted) window.dispatchEvent(new Event(SETTINGS_EVENT));
	};
	return [settings, toggle];
}

/** Discreet per-item menu. Auto-save applies only when the caller supplies a new-answer outcome. */
export function AnkiSaveMenu({
	snapshot,
	sessionSnapshots,
	autoSaveWhen = null,
	itemLabel = "question",
	className,
}: {
	snapshot?: AnkiSaveInput;
	sessionSnapshots?: readonly AnkiSaveInput[];
	autoSaveWhen?: AnkiAutoSaveKind | null;
	itemLabel?: "question" | "problem";
	className?: string;
}) {
	const [open, setOpen] = useState(false);
	const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
	const [state, setState] = useState<{ status: "idle" | "saving" | "saved" | "error"; message?: string }>({ status: "idle" });
	const [requestCompletion, setRequestCompletion] = useState(0);
	const [settings, toggleSetting] = useAutoSaveSettings();
	const rootRef = useRef<HTMLDivElement | null>(null);
	const triggerRef = useRef<HTMLButtonElement | null>(null);
	const panelRef = useRef<HTMLDivElement | null>(null);
	const inFlight = useRef(false);
	const autoAttempt = useRef<string | null>(null);
	const requestGeneration = useRef(0);
	const sourceId = snapshot?.sourceId ?? "session";
	const sourceIdentity = useRef(sourceId);

	const postSnapshot = useCallback(async (item: AnkiSaveInput): Promise<boolean> => {
		const response = await fetch("/api/anki/save", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(item),
		});
		const body = await response.json() as { ok?: boolean; error?: string; updated?: boolean };
		if (!response.ok || !body.ok) throw new Error(body.error || `Save failed (${response.status})`);
		return body.updated === true;
	}, []);

	const save = useCallback(async () => {
		if (inFlight.current || !snapshot) return;
		inFlight.current = true;
		const generation = requestGeneration.current;
		setState({ status: "saving" });
		try {
			const updated = await postSnapshot(snapshot);
			if (generation === requestGeneration.current) {
				setState({ status: "saved", message: updated ? "Updated in Anki" : "Saved to Anki" });
			}
		} catch (error) {
			if (generation === requestGeneration.current) {
				setState({ status: "error", message: error instanceof Error ? error.message : String(error) });
			}
		} finally {
			inFlight.current = false;
			setRequestCompletion((value) => value + 1);
		}
	}, [postSnapshot, snapshot]);

	const exportAll = useCallback(async () => {
		if (inFlight.current || !sessionSnapshots?.length) return;
		inFlight.current = true;
		const generation = requestGeneration.current;
		let saved = 0;
		let failed = 0;
		try {
			for (let index = 0; index < sessionSnapshots.length; index++) {
				setState({ status: "saving", message: `Exporting ${index + 1} of ${sessionSnapshots.length}…` });
				try {
					await postSnapshot(sessionSnapshots[index]!);
					saved++;
				} catch {
					failed++;
				}
			}
			if (generation === requestGeneration.current) {
				setState({ status: failed ? "error" : "saved", message: `Exported ${saved} of ${sessionSnapshots.length} items${failed ? `; ${failed} failed` : ""}` });
			}
		} finally {
			inFlight.current = false;
			setRequestCompletion((value) => value + 1);
		}
	}, [postSnapshot, sessionSnapshots]);

	useEffect(() => {
		if (sourceIdentity.current === sourceId) return;
		sourceIdentity.current = sourceId;
		requestGeneration.current += 1;
		autoAttempt.current = null;
		setState({ status: "idle" });
	}, [sourceId]);

	useEffect(() => {
		if (!snapshot || !autoSaveWhen || !settings[autoSaveWhen] || inFlight.current) return;
		const attempt = `${snapshot.sourceId}:${autoSaveWhen}`;
		if (autoAttempt.current === attempt) return;
		autoAttempt.current = attempt; // one attempt per displayed outcome; manual retry remains available
		void save();
	}, [autoSaveWhen, save, settings, snapshot, requestCompletion]);

	useEffect(() => {
		if (open && anchor) panelRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
	}, [open, anchor]);

	useEffect(() => {
		if (!open) return;
		const dismiss = (restoreFocus: boolean) => {
			setOpen(false);
			if (restoreFocus) triggerRef.current?.focus();
		};
		const pointer = (event: PointerEvent) => {
			const target = event.target as Node;
			if (!rootRef.current?.contains(target) && !panelRef.current?.contains(target)) dismiss(true);
		};
		const key = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.stopPropagation();
				dismiss(true);
			}
		};
		const scroll = () => dismiss(false);
		document.addEventListener("pointerdown", pointer);
		document.addEventListener("keydown", key);
		window.addEventListener("scroll", scroll, { capture: true, passive: true });
		return () => {
			document.removeEventListener("pointerdown", pointer);
			document.removeEventListener("keydown", key);
			window.removeEventListener("scroll", scroll, { capture: true });
		};
	}, [open]);

	return (
		<div ref={rootRef} className={cn("inline-flex", className)} data-testid="anki-save">
			<Button
				ref={triggerRef}
				type="button"
				variant="ghost"
				size="icon-xs"
				data-testid="anki-options"
				aria-label="Anki options"
				title="Anki options"
				aria-expanded={open}
				onClick={() => {
					if (!open) {
						const rect = triggerRef.current?.getBoundingClientRect();
						if (rect) {
							const viewportWidth = window.innerWidth || 1024;
							setAnchor({
								top: rect.bottom + 6,
								left: Math.max(8, Math.min(rect.right - 256, viewportWidth - 264)),
							});
						}
					}
					setOpen((value) => !value);
				}}
				className={cn("text-muted-foreground/70", state.status === "saved" && "text-green-500")}
			>
				<MoreHorizontal />
			</Button>
			{open && anchor && createPortal(
				<div
					ref={panelRef}
					data-testid="anki-menu"
					role="menu"
					onKeyDown={(event) => {
						if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
						const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), input[type='checkbox']") ?? []);
						if (items.length === 0) return;
						event.preventDefault();
						const current = items.indexOf(document.activeElement as HTMLElement);
						const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
							: event.key === "ArrowDown" ? (current + 1 + items.length) % items.length
								: (current - 1 + items.length) % items.length;
						items[next]?.focus();
					}}
					style={{ position: "fixed", top: anchor.top, left: anchor.left }}
					className="z-50 w-64 max-w-[calc(100vw-1rem)] rounded-xl border bg-card p-2 text-sm shadow-lg"
				>
					<button
						type="button"
						role="menuitem"
						data-testid="save-to-anki"
						disabled={state.status === "saving" || (sessionSnapshots !== undefined && sessionSnapshots.length === 0)}
						onClick={() => void (sessionSnapshots ? exportAll() : save())}
						className="w-full rounded-lg px-3 py-2 text-left hover:bg-accent disabled:opacity-50"
					>
						{state.status === "saving" ? "Saving…" : sessionSnapshots ? `Export all ${sessionSnapshots.length} items to Anki` : `Save this ${itemLabel} to Anki`}
					</button>
					<div className="mx-2 my-2 border-t" />
					<div className="px-3 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Auto-save new answers</div>
					{(["correct", "incorrect"] as const).map((kind) => (
						<label key={kind} className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 hover:bg-accent">
							<input
								type="checkbox"
								role="menuitemcheckbox"
								aria-checked={settings[kind]}
								data-testid={`anki-auto-${kind}`}
								checked={settings[kind]}
								onChange={() => toggleSetting(kind)}
								className="size-4 accent-current"
							/>
							<span className="capitalize">{kind} answers</span>
						</label>
					))}
					{state.message && (
						<div role={state.status === "error" ? "alert" : "status"} className="px-3 pb-1 pt-2 text-xs text-muted-foreground">
							{state.message}
						</div>
					)}
				</div>,
				document.body,
			)}
		</div>
	);
}
