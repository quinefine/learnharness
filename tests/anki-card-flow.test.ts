import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACK, CSS, FRONT } from "../src/server/anki-card-template.ts";
import { noteFields, type AnkiSaveInput } from "../src/server/anki-connect.ts";

const CHROME = process.env.CHROME_BIN ?? "/opt/hermes/tools/chromium-1208/chrome-linux/chrome";
const hasChrome = existsSync(CHROME);

const base: AnkiSaveInput = {
	sourceId: "learnharness:chat-1:quiz-1", kind: "lesson", question: "Which connector is a dependency?",
	options: ["Solid line", "Dashed arrow", "Hollow triangle", "Object slot"], distractors: [],
	answer: "Dashed arrow", correctAnswers: ["Dashed arrow"], solution: "A dependency is a temporary use.",
	source: "chat-1", mode: "quiz", targets: [],
};

function fill(template: string, input: AnkiSaveInput, optionsOverride?: string): string {
	const fields = noteFields(input);
	return template
		.replaceAll("{{Question}}", fields.Question)
		.replaceAll("{{Options}}", optionsOverride ?? fields.Options)
		.replaceAll("{{SourceId}}", fields.SourceId)
		.replaceAll("{{Answer}}", fields.Answer)
		.replaceAll("{{Solution}}", fields.Solution)
		.replaceAll("{{Mode}}", fields.Mode)
		.replaceAll("{{Source}}", fields.Source)
		.replaceAll("{{#Options}}", "").replaceAll("{{/Options}}", "")
		.replaceAll("{{#Solution}}", "").replaceAll("{{/Solution}}", "");
}

function runFlow(name: string, input: AnkiSaveInput, flow: string, optionsOverride?: string, updatedInput?: AnkiSaveInput): Record<string, unknown> {
	const front = fill(FRONT, input, optionsOverride);
	const back = fill(BACK, input, optionsOverride);
	const updatedFront = fill(FRONT, updatedInput ?? input, optionsOverride);
	const frontJs = JSON.stringify(front).replace(/</g, "\\u003c");
	const backJs = JSON.stringify(back).replace(/</g, "\\u003c");
	const updatedFrontJs = JSON.stringify(updatedFront).replace(/</g, "\\u003c");
	const html = `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body><script>${name === "ios" ? "Object.defineProperty(navigator,'userAgent',{value:'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15'});" : ""}</script>${front}<script>
	const FRONT=${frontJs};const BACK=${backJs};const UPDATED_FRONT=${updatedFrontJs};
	window.flips=0;if(${JSON.stringify(name)}!=="ios")window.pycmd=(command)=>{if(command==="ans")window.flips++;};
	function render(html){document.body.innerHTML=html;document.querySelectorAll('script:not([type="application/json"])').forEach(old=>{const s=document.createElement('script');s.textContent=old.textContent;document.body.appendChild(s);});}
	const options=()=>Array.from(document.querySelectorAll('.lh-option'));
	const order=()=>options().map(el=>el.querySelector('.lh-option-text').textContent);
	function finish(extra){const result={flips:window.flips,...extra};document.body.setAttribute('data-result',JSON.stringify(result));}
	${flow}
	</script></body></html>`;
	const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "lh-anki-"));
	const file = join(dir, `${name}.html`);
	writeFileSync(file, html);
	const output = execFileSync(CHROME, ["--headless=new", "--no-sandbox", "--disable-gpu", "--dump-dom", "--virtual-time-budget=1500", `file://${file}`], {
		encoding: "utf8", timeout: 30_000, maxBuffer: 10 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"],
	});
	const match = output.match(/data-result="([^"]+)"/);
	assert.ok(match, `browser flow ${name} did not report a result`);
	return JSON.parse(match![1]!.replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
}

describe("Anki interactive card flows", { skip: !hasChrome }, () => {
	it("keeps option order across repaint and marks a wrong desktop pick after one flip", () => {
		const result = runFlow("desktop", base, `
			const initial=order();render(FRONT);const repainted=order();
			const wrong=options().findIndex(el=>el.querySelector('.lh-option-text').textContent==='Solid line');
			options()[wrong].click();const flippedOrder=order();render(BACK);
			finish({stable:JSON.stringify(initial)===JSON.stringify(repainted)&&JSON.stringify(initial)===JSON.stringify(flippedOrder),
				backOrder:JSON.stringify(initial)===JSON.stringify(order()),
				wrongMarked:options()[wrong].classList.contains('is-wrong'),
				correctMarked:options().some(el=>el.classList.contains('is-correct')&&el.querySelector('.lh-option-text').textContent==='Dashed arrow'),
				question:document.querySelector('.lh-question').textContent});
		`);
		assert.equal(result.flips, 1);
		assert.equal(result.stable, true);
		assert.equal(result.backOrder, true);
		assert.equal(result.wrongMarked, true);
		assert.equal(result.correctMarked, true);
		assert.match(String(result.question), /dependency/);
	});

	it("uses one native iPhone tap and preserves the wrong mark on the back", () => {
		const result = runFlow("ios", base, `
			document.addEventListener('touchend',event=>{if(event.target.closest('a,button,input,video,summary,[contenteditable="true"],.tappable'))return;window.flips++;render(BACK);});
			const wrong=options().findIndex(el=>el.querySelector('.lh-option-text').textContent==='Solid line');
			const before=order();options()[wrong].dispatchEvent(new Event('touchend',{bubbles:true}));
			finish({backOrder:JSON.stringify(before)===JSON.stringify(order()),wrongMarked:options()[wrong].classList.contains('is-wrong')});
		`);
		assert.equal(result.flips, 1);
		assert.equal(result.backOrder, true);
		assert.equal(result.wrongMarked, true);
	});

	it("renders bold and a fenced code box without raw markers", () => {
		const tex = String.fromCharCode(92);
		const formatted = {
			...base,
			question: 'Game **has** Players. [Reference](https://example.com)\n![pixel](https://host.example/track.png)\n```csharp\nclass Hand { private List<Card> cards; }\nclass Deck { }\n```\n```mermaid\ngraph TD; A-->B;\n```',
			options: ["**Solid line**", "Dashed arrow", "Hollow triangle", "Object slot"],
			answer: "**Solid line**", correctAnswers: ["**Solid line**"],
			solution: `Use $${tex}texttt{Card}$.`,
		};
		const result = runFlow("formatting", formatted, `
			const body=document.querySelector('[data-streamdown="code-block-body"]');const pre=body.querySelector('pre');
			const rule=Array.from(document.styleSheets[0].cssRules).find(r=>r.selectorText==='.lh-card [data-streamdown="code-block-body"]');
			const bold=document.querySelector('.lh-question strong').textContent;
			const optionBold=document.querySelector('.lh-option strong').textContent;
			const code=pre.textContent;const raw=document.querySelector('.lh-question').textContent;
			const lines=pre.querySelectorAll('.block');const multiline=lines.length>1&&lines[0].getBoundingClientRect().top!==lines[1].getBoundingClientRect().top;
			const colored=pre.querySelectorAll('span[style*="color:"]').length>0;
			const numbered=pre.querySelector('.block[data-line-number="1"]')!==null;
			const fontSize=parseFloat(getComputedStyle(body).fontSize);
			const href=document.querySelector('.lh-question a').getAttribute('href');
			const images=document.querySelectorAll('.lh-question img').length;
			const mermaid=document.querySelector('[data-streamdown="mermaid-source"]').textContent;
			const spinners=document.querySelectorAll('[aria-busy="true"]').length;
			const fits=body.getBoundingClientRect().width<=document.querySelector('.lh-card').getBoundingClientRect().width;
			render(BACK);const texCode=document.querySelector('.lh-solution .katex-html').textContent;
			finish({bold,optionBold,code,raw,multiline,colored,numbered,fontSize,href,images,mermaid,spinners,overflow:rule.style.overflowX,fits,texCode});
		`);
		assert.equal(result.bold, "has");
		assert.equal(result.optionBold, "Solid line");
		assert.match(String(result.code), /class Hand/);
		assert.ok(!String(result.raw).includes("**"));
		assert.ok(!String(result.raw).includes("```"));
		assert.equal(result.multiline, true);
		assert.equal(result.colored, true);
		assert.equal(result.numbered, true);
		assert.ok(Number(result.fontSize) >= 12 && Number(result.fontSize) <= 14);
		assert.equal(result.href, "https://example.com/");
		assert.equal(result.images, 0);
		assert.match(String(result.mermaid), /graph TD/);
		assert.equal(result.spinners, 0);
		assert.equal(result.overflow, "auto");
		assert.equal(result.fits, true);
		assert.equal(result.texCode, "Card");
	});

	it("does not reuse cached choices after the note model changes", () => {
		const initial = { ...base, answer: "Solid line | Hollow triangle", correctAnswers: ["Solid line", "Hollow triangle"] };
		const updated = { ...base, question: "Updated question", options: ["New A", "New B"], answer: "New A", correctAnswers: ["New A"] };
		const result = runFlow("updated-state", initial, `
			options()[0].click();render(UPDATED_FRONT);
			finish({labels:order(),chosen:window.__lhMCV2.chosen.length});
		`, undefined, updated);
		assert.equal((result.labels as string[]).includes("New A"), true);
		assert.equal((result.labels as string[]).includes("Solid line"), false);
		assert.equal(result.chosen, 0);
	});

	it("classifies object-property answer labels by membership only", () => {
		const special = {
			...base, options: ["constructor", "toString", "__proto__", "Normal"],
			answer: "__proto__", correctAnswers: ["__proto__"],
		};
		const result = runFlow("special-labels", special, `
			const normal=options().findIndex(el=>el.querySelector('.lh-option-text').textContent==='Normal');
			options()[normal].click();render(BACK);
			finish({correct:options().filter(el=>el.classList.contains('is-correct')).map(el=>el.querySelector('.lh-option-text').textContent)});
		`);
		assert.deepEqual(result.correct, ["proto"], "Markdown formats the label, while raw __proto__ remains the correct answer");
	});

	it("renders malformed legacy option data as inert text", () => {
		const result = runFlow("legacy", base, `
			finish({images:document.querySelectorAll('[data-options] img').length,
				xss:window.__xss===1,text:document.querySelector('[data-options]').textContent});
		`, '<img src=x onerror="window.__xss=1">');
		assert.equal(result.images, 0);
		assert.equal(result.xss, false);
		assert.match(String(result.text), /img src=x/);
	});

	it("supports multi-select without flipping until submit", () => {
		const multi = { ...base, answer: "Solid line | Hollow triangle", correctAnswers: ["Solid line", "Hollow triangle"] };
		const result = runFlow("multi", multi, `
			const before=window.flips;options()[0].click();options()[2].click();const afterPicks=window.flips;
			document.querySelector('.lh-submit').click();render(BACK);
			finish({afterPicks,correctCount:document.querySelectorAll('.lh-option.is-correct').length});
		`);
		assert.equal(result.afterPicks, 0);
		assert.equal(result.flips, 1);
		assert.equal(result.correctCount, 2);
	});
});
