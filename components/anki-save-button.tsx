"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { AnkiSaveInput } from "@/src/core";

/** One explicit export action. No automatic uploads and no AnkiWeb sync side effect. */
export function AnkiSaveButton({ snapshot, className }: { snapshot: AnkiSaveInput; className?: string }) {
	const [state, setState] = useState<{ status: "idle" | "saving" | "saved" | "error"; message?: string }>({ status: "idle" });
	const inFlight = useRef(false);

	async function save() {
		if (inFlight.current) return; // synchronous lock: React state does not close the double-click race
		inFlight.current = true;
		setState({ status: "saving" });
		try {
			const response = await fetch("/api/anki/save", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(snapshot),
			});
			const body = await response.json() as { ok?: boolean; error?: string; updated?: boolean };
			if (!response.ok || !body.ok) throw new Error(body.error || `Save failed (${response.status})`);
			setState({ status: "saved", message: body.updated ? "Updated in Anki" : "Saved to Anki" });
		} catch (error) {
			setState({ status: "error", message: error instanceof Error ? error.message : String(error) });
		} finally {
			inFlight.current = false;
		}
	}

	return (
		<span className={className} data-testid="anki-save">
			<Button type="button" variant="outline" size="sm" data-testid="save-to-anki"
				disabled={state.status === "saving"} onClick={() => void save()}>
				{state.status === "saving" ? "Saving…" : state.status === "saved" ? "Saved to Anki" : "Save to Anki"}
			</Button>
			{state.message && <span className="ml-2 text-xs text-muted-foreground" role={state.status === "error" ? "alert" : "status"}>{state.message}</span>}
		</span>
	);
}
