/** POST /api/anki/save — save one lesson question or practice problem through desktop AnkiConnect. */
import { ankiSaveSchema, AnkiConnectError, saveToAnki } from "@/src/server";

export const dynamic = "force-dynamic";

/** Browser writes are same-origin only. Native/server callers without Origin remain supported. */
function originAllowed(request: Request): boolean {
	const site = request.headers.get("Sec-Fetch-Site");
	if (site && site !== "same-origin" && site !== "none") return false;
	const origin = request.headers.get("Origin");
	if (!origin) return true;
	try {
		const originUrl = new URL(origin);
		const configuredOrigin = process.env.ANKI_PUBLIC_ORIGIN?.trim();
		if (configuredOrigin) return originUrl.origin === new URL(configuredOrigin).origin;
		// Host comes from the request target, not a spoofable forwarding header. If a proxy
		// rewrites Host, set ANKI_PUBLIC_ORIGIN to the deployment's trusted public origin.
		const publicHost = request.headers.get("Host") || new URL(request.url).host;
		return originUrl.host === publicHost && (originUrl.protocol === new URL(request.url).protocol || site === "same-origin");
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
