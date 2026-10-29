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
});
