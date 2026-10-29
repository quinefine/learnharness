/** POST /api/anki/save — save one lesson question or practice problem through desktop AnkiConnect. */
import { ankiSaveSchema, AnkiConnectError, saveToAnki } from "@/src/server";

export const dynamic = "force-dynamic";

/** Browser writes are same-origin only. Native/server callers without Origin remain supported. */
function originAllowed(request: Request): boolean {
	const site = request.headers.get("Sec-Fetch-Site");
	if (site === "cross-site" || (site === "same-site" && !request.headers.get("Origin"))) return false;
	const origin = request.headers.get("Origin");
	if (!origin) return true;
	try {
		return new URL(origin).origin === new URL(request.url).origin;
	} catch {
		return false;
	}
}

export async function POST(request: Request) {
	if (!originAllowed(request)) {
		return Response.json({ ok: false, error: "Cross-origin saves are not allowed" }, { status: 403 });
	}
	if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
		return Response.json({ ok: false, error: "Expected Content-Type: application/json" }, { status: 415 });
	}
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "Expected a JSON question snapshot" }, { status: 400 });
	}
	const parsed = ankiSaveSchema.safeParse(body);
	if (!parsed.success) {
		return Response.json({ error: "Invalid question snapshot", issues: parsed.error.issues }, { status: 400 });
	}
	try {
		const result = await saveToAnki(parsed.data);
		return Response.json({ ok: true, ...result });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const status = error instanceof AnkiConnectError ? 503 : 500;
		return Response.json({ ok: false, error: message }, { status });
	}
}
