import { createHighlighterCoreSync, getTokenStyleObject, stringifyTokenStyle, type HighlighterCore, type ThemedToken } from "@shikijs/core";
import { createJavaScriptRegexEngine } from "@shikijs/engine-javascript";
import c from "@shikijs/langs/c";
import cpp from "@shikijs/langs/cpp";
import csharp from "@shikijs/langs/csharp";
import css from "@shikijs/langs/css";
import diff from "@shikijs/langs/diff";
import dockerfile from "@shikijs/langs/dockerfile";
import go from "@shikijs/langs/go";
import haskell from "@shikijs/langs/haskell";
import html from "@shikijs/langs/html";
import ini from "@shikijs/langs/ini";
import java from "@shikijs/langs/java";
import javascript from "@shikijs/langs/javascript";
import json from "@shikijs/langs/json";
import jsx from "@shikijs/langs/jsx";
import kotlin from "@shikijs/langs/kotlin";
import latex from "@shikijs/langs/latex";
import lua from "@shikijs/langs/lua";
import markdown from "@shikijs/langs/markdown";
import perl from "@shikijs/langs/perl";
import php from "@shikijs/langs/php";
import powershell from "@shikijs/langs/powershell";
import python from "@shikijs/langs/python";
import r from "@shikijs/langs/r";
import ruby from "@shikijs/langs/ruby";
import rust from "@shikijs/langs/rust";
import scala from "@shikijs/langs/scala";
import shell from "@shikijs/langs/shell";
import sql from "@shikijs/langs/sql";
import swift from "@shikijs/langs/swift";
import toml from "@shikijs/langs/toml";
import tsx from "@shikijs/langs/tsx";
import typescript from "@shikijs/langs/typescript";
import xml from "@shikijs/langs/xml";
import yaml from "@shikijs/langs/yaml";
import githubDark from "@shikijs/themes/github-dark";

export type AnkiCodeToken = Pick<ThemedToken, "content" | "color" | "bgColor" | "fontStyle">;

let highlighter: HighlighterCore | undefined;

function getHighlighter(): HighlighterCore {
	highlighter ??= createHighlighterCoreSync({
		engine: createJavaScriptRegexEngine({ forgiving: true }),
		themes: [githubDark],
		langs: [
			...c, ...cpp, ...csharp, ...css, ...diff, ...dockerfile, ...go, ...haskell, ...html, ...ini,
			...java, ...javascript, ...json, ...jsx, ...kotlin, ...latex, ...lua, ...markdown, ...perl, ...php,
			...powershell, ...python, ...r, ...ruby, ...rust, ...scala, ...shell, ...sql, ...swift, ...toml,
			...tsx, ...typescript, ...xml, ...yaml,
		],
		langAlias: { "c++": "cpp", md: "markdown", shellscript: "shell", tex: "latex", yml: "yaml", zsh: "shell" },
		warnings: false,
	});
	return highlighter;
}

function plainTokens(source: string): AnkiCodeToken[][] {
	return source.split("\n").map((line) => [{ content: line }]);
}

export function highlightAnkiCode(source: string, language: string): AnkiCodeToken[][] {
	const normalized = language.trim().toLowerCase();
	if (!normalized || ["text", "txt", "plain", "plaintext"].includes(normalized)) return plainTokens(source);
	try {
		return getHighlighter().codeToTokens(source, { lang: normalized, theme: "github-dark" }).tokens
			.map((line) => line.map((token) => ({
				content: token.content,
				color: token.color,
				bgColor: token.bgColor,
				fontStyle: token.fontStyle,
			})));
	} catch {
		return plainTokens(source);
	}
}

export function ankiTokenStyle(token: AnkiCodeToken): string {
	return stringifyTokenStyle(getTokenStyleObject(token));
}
