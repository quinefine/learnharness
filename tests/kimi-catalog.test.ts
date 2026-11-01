import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { withKimiCodingCatalog } from "../src/agent/kimi-catalog.ts";
import { piEngineForSpec, piModels } from "../src/agent/models.ts";

describe("Kimi Coding catalog", () => {
	it("advertises K3.1 Pro and Highspeed with the working endpoint and required thinking", () => {
		const original = builtinProviders().find((provider) => provider.id === "kimi-coding");
		assert.ok(original);
		const provider = withKimiCodingCatalog(original);
		const models = provider.getModels();
		for (const id of ["k3.1-pro", "k3.1-pro-highspeed"]) {
			const model = models.find((candidate) => candidate.id === id);
			assert.ok(model, `${id} is advertised`);
			assert.equal(model.provider, "kimi-coding");
			assert.equal(model.baseUrl, "https://api.kimi.com/coding/v1");
			assert.equal(model.contextWindow, 1_048_576);
			assert.deepEqual(model.input, ["text", "image"]);
			assert.deepEqual(getSupportedThinkingLevels(model), ["low", "high", "max"], "thinking cannot be disabled");
		}
		assert.deepEqual(provider.getAllModels?.().map((model) => model.id), models.map((model) => model.id));
		assert.equal(original.getModels().some((model) => model.id === "k3.1-pro"), false, "the patch does not mutate the built-in catalog");
	});

	it("exposes the existing kimi-for-coding id as K2.8 Preview", () => {
		const original = builtinProviders().find((provider) => provider.id === "kimi-coding");
		assert.ok(original);
		const model = withKimiCodingCatalog(original).getModels().find((candidate) => candidate.id === "kimi-for-coding");
		assert.equal(model?.name, "Kimi K2.8 Preview");
	});

	it("resolves K3.1 Pro through the production engine factory", () => {
		const model = piModels().getModel("kimi-coding", "k3.1-pro");
		assert.ok(model);
		const engine = piEngineForSpec({ provider: "kimi-coding", id: "k3.1-pro" });
		assert.equal(engine.model.id, "k3.1-pro");
		assert.equal(engine.level, "low", "the default order lands on a supported non-off level");
	});
});
