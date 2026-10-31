import React, { type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CodeBlock, Streamdown, useIsCodeFenceIncomplete, type ExtraProps } from "streamdown";
import { codeSource, mdComponents } from "../../components/md-blocks.tsx";
import { streamdownPlugins, streamdownRemend } from "../../components/ai-elements/message.tsx";
import { repairMathForDisplay, transformMathDelimiters } from "../core/index.ts";
import { readContentSpans } from "../core/content-reader.ts";

function AnkiCode(props: ComponentProps<"code"> & ExtraProps) {
	const incomplete = useIsCodeFenceIncomplete();
	const { children, className, node, ...rest } = props;
	if (!("data-block" in props)) {
		return <code className={`rounded bg-muted px-1.5 py-0.5 font-mono text-sm ${className ?? ""}`} data-streamdown="inline-code" {...rest}>{children}</code>;
	}
	const language = /language-([^\s]+)/.exec(className ?? "")?.[1] ?? "";
	const meta = (node?.properties?.metastring as string | undefined) ?? "";
	const source = codeSource(children);
	if (language === "mermaid") {
		return <pre data-streamdown="mermaid-source"><code>{source}</code></pre>;
	}
	const startMatch = /startLine=(\d+)/.exec(meta);
	const startLine = startMatch ? Number.parseInt(startMatch[1]!, 10) : undefined;
	return (
		<CodeBlock
			code={source}
			language={language}
			className={className}
			isIncomplete={incomplete}
			startLine={startLine !== undefined && startLine >= 1 ? startLine : undefined}
			lineNumbers={!/\bnoLineNumbers\b/.test(meta)}
		/>
	);
}

function AnkiLink({ children, node: _node, ...props }: ComponentProps<"a"> & ExtraProps) {
	return <a {...props} target="_blank" rel="noreferrer noopener">{children}</a>;
}

function AnkiImage({ alt, node: _node }: ComponentProps<"img"> & ExtraProps) {
	return <span data-streamdown="image">{alt ? `[Image: ${alt}]` : ""}</span>;
}

const ankiComponents = { ...mdComponents, code: AnkiCode, a: AnkiLink, img: AnkiImage };

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

/** Use LearnHarness's Markdown, code, and KaTeX pipeline, with static adapters
 * for browser-only links, images, and Mermaid. Anki never mounts React. */
export function renderAnkiMarkdown(text: string): string {
	return renderToStaticMarkup(
		<Streamdown
			className="lh-prose"
			components={ankiComponents}
			plugins={streamdownPlugins}
			remend={streamdownRemend}
		>
			{transformMathDelimiters(repairMathForDisplay(explicitHttpsLinks(text)))}
		</Streamdown>,
	);
}
