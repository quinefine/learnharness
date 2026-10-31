import { cjk } from "@streamdown/cjk";
import { createMathPlugin } from "@streamdown/math";
import { toHtml } from "hast-util-to-html";
import type { Element, ElementContent, Root } from "hast";
import type { Code, Root as MdastRoot } from "mdast";
import { harden } from "rehype-harden";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified, type Processor } from "unified";
import { SKIP, visit } from "unist-util-visit";
import { repairMathForDisplay, transformMathDelimiters } from "../core/index.ts";
import { readContentSpans } from "../core/content-reader.ts";

const math = createMathPlugin({ singleDollarTextMath: true });
const sanitizeSchema = {
	...defaultSchema,
	protocols: {
		...defaultSchema.protocols,
		href: [...(defaultSchema.protocols?.href ?? []), "tel"],
	},
	attributes: {
		...defaultSchema.attributes,
		code: [...(defaultSchema.attributes?.code ?? []), "metastring"],
	},
};

function remarkCodeMeta() {
	return (tree: MdastRoot) => {
		visit(tree, "code", (node: Code) => {
			if (!node.meta) return;
			node.data = {
				...node.data,
				hProperties: { ...node.data?.hProperties, metastring: node.meta },
			};
		});
	};
}

function element(tagName: string, properties: Element["properties"] = {}, children: ElementContent[] = []): Element {
	return { type: "element", tagName, properties, children };
}

function textContent(node: Element): string {
	return node.children.map((child) => {
		if (child.type === "text") return child.value;
		if (child.type === "element") return textContent(child);
		return "";
	}).join("");
}

function className(node: Element): string {
	const value = node.properties.className;
	if (Array.isArray(value)) return value.filter((part) => typeof part === "string" || typeof part === "number").join(" ");
	return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function staticCodeBlock(node: Element): Element {
	const code = node.children.find((child): child is Element => child.type === "element" && child.tagName === "code");
	if (!code) return node;
	const source = textContent(code).replace(/\n+$/, "");
	const language = /language-([^\s]+)/.exec(className(code))?.[1] ?? "";
	if (language === "mermaid") {
		return element("pre", { "data-streamdown": "mermaid-source" }, [element("code", {}, [{ type: "text", value: source }])]);
	}
	const lines = source.split("\n").map((line) =>
		element("span", { className: ["block"] }, [{ type: "text", value: line || "\n" }]),
	);
	return element("div", { "data-language": language, "data-streamdown": "code-block" }, [
		element("div", { "data-language": language, "data-streamdown": "code-block-header" }, [
			element("span", {}, [{ type: "text", value: language }]),
		]),
		element("div", { "data-language": language, "data-streamdown": "code-block-body" }, [
			element("pre", {}, [element("code", {}, lines)]),
		]),
	]);
}

function escapeText(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function ankiStaticComponents() {
	return (tree: Root) => {
		visit(tree, "element", (node: Element, index, parent) => {
			if (node.tagName === "a") {
				node.properties.target = "_blank";
				node.properties.rel = ["noreferrer", "noopener"];
				return;
			}
			if (node.tagName === "strong") {
				node.properties = { "data-streamdown": "strong", ...node.properties };
				return;
			}
			if (node.tagName === "code" && (parent?.type !== "element" || parent.tagName !== "pre")) {
				node.properties = {
					...node.properties,
					className: ["rounded", "bg-muted", "px-1.5", "py-0.5", "font-mono", "text-sm", className(node)].filter(Boolean),
					"data-streamdown": "inline-code",
				};
				return;
			}
			if (node.tagName === "table") {
				node.properties = { ...node.properties, className: ["w-full", "border-collapse"], "data-streamdown": "table" };
				return;
			}
			if (node.tagName === "blockquote") {
				node.properties = { ...node.properties, "data-streamdown": "blockquote" };
				return;
			}
			if (typeof index !== "number" || !parent) return;
			if (node.tagName === "img") {
				const alt = typeof node.properties.alt === "string" ? node.properties.alt : "";
				parent.children[index] = element("span", { "data-streamdown": "image" }, [
					{ type: "text", value: alt ? `[Image: ${alt}]` : "" },
				]);
				return [SKIP, index + 1];
			}
			if (node.tagName === "pre") {
				parent.children[index] = staticCodeBlock(node);
				return [SKIP, index + 1];
			}
		});
		visit(tree, "text", (node, index, parent) => {
			if (typeof index !== "number" || !parent) return;
			parent.children[index] = { type: "raw", value: escapeText(node.value) } as unknown as ElementContent;
		});
	};
}

function rehypeHtml(this: Processor) {
	this.compiler = (tree) => toHtml(tree as Root, {
		allowDangerousHtml: true,
		characterReferences: { useNamedReferences: true },
	});
}

const processor = unified()
	.use(remarkParse)
	.use(cjk.remarkPluginsBefore)
	.use(remarkGfm)
	.use(remarkCodeMeta)
	.use([...cjk.remarkPluginsAfter, remarkBreaks])
	.use([math.remarkPlugin])
	.use(remarkRehype, { allowDangerousHtml: true })
	.use(rehypeRaw)
	.use(rehypeSanitize, sanitizeSchema)
	.use(harden, {
		allowedImagePrefixes: ["*"],
		allowedLinkPrefixes: ["*"],
		allowedProtocols: ["*"],
		defaultOrigin: undefined,
		allowDataImages: true,
	})
	.use([math.rehypePlugin])
	.use(ankiStaticComponents)
	.use(rehypeHtml);

function normalizeRawHtmlTags(text: string): string {
	let output = "";
	let offset = 0;
	while (offset < text.length) {
		const match = /<(?:a|img)\b/i.exec(text.slice(offset));
		if (!match) {
			output += text.slice(offset);
			break;
		}
		const start = offset + match.index;
		output += text.slice(offset, start);
		let quote = "";
		let end = start + 1;
		for (; end < text.length; end++) {
			const char = text[end]!;
			if (quote) {
				if (char === quote) quote = "";
			} else if (char === '"' || char === "'") {
				quote = char;
			} else if (char === ">") {
				break;
			}
		}
		if (end >= text.length) {
			output += text.slice(start);
			break;
		}
		const tag = text.slice(start, end + 1);
		output += tag.replace(/(\s(?:href|src)\s*=\s*)(["']?)\/\/([^\s>"']+)/gi, "$1$2https://$3");
		offset = end + 1;
	}
	return output;
}

function explicitHttpsLinks(text: string): string {
	return readContentSpans(text).map((span) => {
		if (span.kind !== "prose") return span.raw;
		return normalizeRawHtmlTags(span.raw
			.replace(/\]\(<\/\/([^>]+)>/g, "](<https://$1>")
			.replace(/\]\(\/\/([^\s)]+)/g, "](https://$1"));
	}).join("");
}

/** Server-only static HTML for Anki; no React client components are invoked. */
export function renderAnkiMarkdown(text: string): string {
	const content = transformMathDelimiters(repairMathForDisplay(explicitHttpsLinks(text)));
	return `<div class="lh-prose">${String(processor.processSync(content))}</div>`;
}
