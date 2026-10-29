import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { POST } from "../app/api/anki/save/route.ts";

describe("Anki save route validation", () => {
	it("rejects malformed JSON", async () => {
		const response = await POST(new Request("http://test/api/anki/save", {
			method: "POST", headers: { "Content-Type": "application/json" }, body: "{bad",
		}));
		assert.equal(response.status, 400);
	});

	it("rejects a snapshot without a correct answer before contacting Anki", async () => {
		const response = await POST(new Request("http://test/api/anki/save", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ sourceId: "learnharness:x:y", kind: "lesson", question: "Q", source: "x", options: [], targets: [] }),
		}));
		assert.equal(response.status, 400);
		const body = await response.json();
		assert.equal(body.error, "Invalid question snapshot");
	});

	it("rejects cross-site browser writes before parsing or contacting Anki", async () => {
		const response = await POST(new Request("http://test/api/anki/save", {
			method: "POST",
			headers: { "Content-Type": "application/json", Origin: "https://attacker.example", "Sec-Fetch-Site": "cross-site" },
			body: "{}",
		}));
		assert.equal(response.status, 403);
	});

	it("requires JSON content type to prevent simple cross-site form posts", async () => {
		const response = await POST(new Request("http://test/api/anki/save", {
			method: "POST", headers: { "Content-Type": "text/plain" }, body: "{}",
		}));
		assert.equal(response.status, 415);
	});

	it("accepts the public browser origin through a reverse proxy", async () => {
		const response = await POST(new Request("http://internal:3000/api/anki/save", {
			method: "POST",
			headers: {
				"Content-Type": "application/json; charset=utf-8",
				Origin: "https://learn.example",
				Host: "learn.example",
				"Sec-Fetch-Site": "same-origin",
			},
			body: "{}",
		}));
		assert.equal(response.status, 400, "origin passed; schema validation then rejects the empty body");
	});

	it("ignores a spoofed X-Forwarded-Host", async () => {
		const response = await POST(new Request("http://internal:3000/api/anki/save", {
			method: "POST",
			headers: {
				"Content-Type": "application/json", Origin: "https://attacker.example",
				Host: "internal:3000", "X-Forwarded-Host": "attacker.example",
			},
			body: "{}",
		}));
		assert.equal(response.status, 403);
	});

	it("rejects a direct scheme mismatch", async () => {
		const response = await POST(new Request("http://test/api/anki/save", {
			method: "POST",
			headers: { "Content-Type": "application/json", Origin: "https://test", Host: "test" },
			body: "{}",
		}));
		assert.equal(response.status, 403);
	});

	it("supports an explicitly configured public origin when a proxy rewrites Host", async () => {
		const previous = process.env.ANKI_PUBLIC_ORIGIN;
		process.env.ANKI_PUBLIC_ORIGIN = "https://learn.example";
		try {
			const response = await POST(new Request("http://internal:3000/api/anki/save", {
				method: "POST",
				headers: { "Content-Type": "application/json", Origin: "https://learn.example", Host: "internal:3000" },
				body: "{}",
			}));
			assert.equal(response.status, 400);
		} finally {
			if (previous === undefined) delete process.env.ANKI_PUBLIC_ORIGIN;
			else process.env.ANKI_PUBLIC_ORIGIN = previous;
		}
	});

	it("rejects a mismatched Origin even without Sec-Fetch-Site", async () => {
		const response = await POST(new Request("http://test/api/anki/save", {
			method: "POST",
			headers: { "Content-Type": "application/json", Origin: "https://attacker.example", Host: "test" },
			body: "{}",
		}));
		assert.equal(response.status, 403);
	});
});
