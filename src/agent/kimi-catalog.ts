import type { Api, Model, Provider } from "@earendil-works/pi-ai";

const K31_MODELS = [
	{ id: "k3.1-pro", name: "Kimi K3.1 Pro" },
	{ id: "k3.1-pro-highspeed", name: "Kimi K3.1 Pro Highspeed" },
] as const;

export function withKimiCodingCatalog(provider: Provider): Provider {
	if (provider.id !== "kimi-coding") return provider;
	const baseModels = provider.getModels();
	const k3 = baseModels.find((model) => model.id === "k3");
	if (!k3) return provider;
	const models: Model<Api>[] = baseModels.map((model) =>
		model.id === "kimi-for-coding" ? { ...model, name: "Kimi K2.8 Preview" } : model,
	);
	for (const addition of K31_MODELS) {
		if (!models.some((model) => model.id === addition.id)) models.push({ ...k3, ...addition });
	}
	return { ...provider, getModels: () => models, getAllModels: () => models };
}
