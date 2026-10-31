import { KATEX_CSS } from "./anki-katex-css.ts";

export const ANKI_TEMPLATE_VERSION = "lh-mc-v4";

export const ANKI_CARD_SCRIPT = `(function(){
var root=document.querySelector(".lh-card[data-side]");
if(!root)return;
var host=root.querySelector("[data-options]");
var dataEl=root.querySelector(".lh-options-data");
if(!host||!dataEl)return;
var model;
try{model=JSON.parse(dataEl.textContent||"null");}catch(e){model=null;}
if(!model||!Array.isArray(model.options)){
 host.textContent=dataEl.textContent||"";
 return;
}
var side=root.getAttribute("data-side")==="back"?"back":"front";
var sourceEl=root.querySelector("[data-source-id]");
var sourceId=sourceEl?sourceEl.textContent.trim():"card";
var W=window;
var questionEl=root.querySelector(".lh-question");
var signature=JSON.stringify([questionEl?questionEl.textContent:"",model.options,model.correct||[],!!model.multi]);
var storeKey="lh-mc-v4:"+sourceId+":"+signature;
function readState(){
 if(W.__lhMCV2&&W.__lhMCV2.sourceId===sourceId&&W.__lhMCV2.signature===signature)return W.__lhMCV2;
 try{var raw=sessionStorage.getItem(storeKey);if(raw){var saved=JSON.parse(raw);if(saved.signature===signature)return saved;}}catch(e){}
 return null;
}
function persist(state){
 W.__lhMCV2=state;
 try{sessionStorage.setItem(storeKey,JSON.stringify(state));}catch(e){}
}
function shuffle(items){
 var out=items.slice();
 for(var i=out.length-1;i>0;i--){var j=Math.floor(Math.random()*(i+1));var t=out[i];out[i]=out[j];out[j]=t;}
 return out;
}
var state=readState();
if(side==="front"){
 if(!state||state.sourceId!==sourceId||state.signature!==signature||state.side==="back"){
  state={sourceId:sourceId,signature:signature,options:shuffle(model.options),chosen:[],side:"front"};
 }
}else{
 if(!state||state.sourceId!==sourceId||state.signature!==signature){state={sourceId:sourceId,signature:signature,options:model.options.slice(),chosen:[],side:"back"};}
 state.side="back";
}
persist(state);
var correct=new Set();
(model.correct||[]).forEach(function(label){correct.add(key(label));});
function key(label){return label.trim().replace(/\\s+/g," ").toLocaleLowerCase();}
function flip(){
 if(typeof W.showAnswer==="function"){W.showAnswer();return;}
 if(typeof W.pycmd==="function"){W.pycmd("ans");}
}
function choose(index,allowFlip){
 if(side==="back")return;
 var at=state.chosen.indexOf(index);
 if(model.multi){
  if(at>=0)state.chosen.splice(at,1);else state.chosen.push(index);
 }else{
  state.chosen=[index];
  if(allowFlip)state.side="back";
 }
 persist(state);
 draw();
 if(allowFlip&&!model.multi)flip();
}
function submit(){
 if(side==="back")return;
 state.side="back";persist(state);draw();flip();
}
function activate(event,index,allowFlip){
 if(event.type==="click"&&event.currentTarget.__lhTouched){event.currentTarget.__lhTouched=false;return;}
 if(event.type==="touchend")event.currentTarget.__lhTouched=true;
 choose(index,allowFlip);
}
function draw(){
 host.textContent="";
 state.options.forEach(function(label,index){
  var el=document.createElement(model.multi?"button":"div");
  if(model.multi)el.type="button";
  else{el.setAttribute("role","button");el.tabIndex=0;}
  el.className="lh-option";
  el.setAttribute("data-index",String(index));
  var chosen=state.chosen.indexOf(index)>=0;
  var isCorrect=correct.has(key(label));
  if(side==="back"){
   if(isCorrect)el.classList.add("is-correct");
   if(chosen&&!isCorrect)el.classList.add("is-wrong");
   if(chosen)el.classList.add("is-chosen");
  }
  var letter=document.createElement("span");letter.className="lh-key";letter.textContent=String.fromCharCode(65+index);
  var text=document.createElement("span");text.className="lh-option-text";
  if(model.optionHtml&&Object.prototype.hasOwnProperty.call(model.optionHtml,label))text.innerHTML=model.optionHtml[label];
  else text.textContent=label;
  var mark=document.createElement("span");mark.className="lh-mark";
  if(side==="back"&&isCorrect)mark.textContent="✓";
  if(side==="back"&&chosen&&!isCorrect)mark.textContent="×";
  el.appendChild(letter);el.appendChild(text);el.appendChild(mark);
  if(side==="front"){
   var ios=/iPad|iPhone|iPod/.test(navigator.userAgent);
   el.addEventListener("click",function(event){activate(event,index,true);});
   if(ios)el.addEventListener("touchend",function(event){activate(event,index,true);});
   el.addEventListener("keydown",function(event){
    if(event.key==="Enter"||event.key===" "){event.preventDefault();choose(index,true);}
   });
  }
  host.appendChild(el);
 });
 if(side==="front"&&model.multi){
  var submitButton=document.createElement("div");
  submitButton.className="lh-submit";submitButton.setAttribute("role","button");submitButton.tabIndex=0;submitButton.textContent="Check answers";
  submitButton.addEventListener("click",function(){if(submitButton.__lhTouched){submitButton.__lhTouched=false;return;}submit();});
  if(/iPad|iPhone|iPod/.test(navigator.userAgent))submitButton.addEventListener("touchend",function(){submitButton.__lhTouched=true;submit();});
  submitButton.addEventListener("keydown",function(event){if(event.key==="Enter"||event.key===" "){event.preventDefault();submit();}});
  host.appendChild(submitButton);
 }
}
draw();
})();`;

const OPTIONS = `{{#Options}}<script type="application/json" class="lh-options-data">{{Options}}</script>{{/Options}}`;
const IDENTITY = `<span data-source-id hidden>{{SourceId}}</span>`;

export const FRONT = `<!-- ${ANKI_TEMPLATE_VERSION} --><main class="lh-card" data-side="front"><div class="lh-question">{{Question}}</div>${OPTIONS}${IDENTITY}<div class="lh-options" data-options></div></main><script>${ANKI_CARD_SCRIPT}</script>`;

export const BACK = `<!-- ${ANKI_TEMPLATE_VERSION} --><main class="lh-card" data-side="back"><div class="lh-question">{{Question}}</div>${OPTIONS}${IDENTITY}<div class="lh-options" data-options></div><hr><div class="lh-label">Answer</div><div class="lh-answer">{{Answer}}</div>{{#Solution}}<div class="lh-label">Solution</div><div class="lh-solution">{{Solution}}</div>{{/Solution}}<div class="lh-meta">{{Mode}} · {{Source}}</div></main><script>${ANKI_CARD_SCRIPT}</script>`;

export const CSS = KATEX_CSS + `/* ${ANKI_TEMPLATE_VERSION} */
.card{margin:0;padding:20px;background:#fff;color:#172033;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:20px;line-height:1.5}
.card.nightMode,.nightMode .card{background:#17191d;color:#e7eaf0}
.lh-card{max-width:44rem;margin:0 auto;text-align:left}
.lh-question{white-space:normal;line-height:1.55}
.lh-prose>p{margin:.45em 0}
.lh-prose [data-testid="md-copy"]{display:none}
.lh-card code{font-family:ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace;font-size:.9em}
.lh-card [data-streamdown="inline-code"]{padding:.08em .3em;border-radius:.3em;background:#eef1f5;color:#b42318;overflow-wrap:anywhere}
.lh-card [data-streamdown="code-block"]{box-sizing:border-box;max-width:100%;margin:.8rem 0;overflow:hidden;border:1px solid #2c3542;border-radius:.65rem;background:#111827;color:#e5e7eb}
.lh-card [data-streamdown="code-block-header"]{display:flex;height:auto;margin:0;padding:.35rem .8rem;color:#a9b4c3;font-size:.7em}
.lh-card [data-streamdown="code-block-body"]{box-sizing:border-box;max-width:100%;margin:0;padding:.85rem 1rem;overflow-x:auto;border:0;border-radius:0;background:transparent;line-height:1.5}
.lh-card [data-streamdown="code-block-body"] pre{margin:0;background:transparent!important;white-space:pre;tab-size:4}
.lh-card [data-streamdown="code-block-body"] code{font:inherit;white-space:inherit}
.lh-card [data-streamdown="code-block-body"] .block{display:block}
.lh-card [data-streamdown="mermaid-source"]{box-sizing:border-box;max-width:100%;margin:.8rem 0;padding:.85rem 1rem;overflow-x:auto;white-space:pre;border:1px solid #2c3542;border-radius:.65rem;background:#111827;color:#e5e7eb}
.nightMode .lh-card [data-streamdown="inline-code"]{background:#2b3038;color:#fda29b}
.nightMode .lh-card [data-streamdown="code-block"]{background:#0b0e13;border-color:#394351}
.lh-options-data,[data-source-id]{display:none}
.lh-options{margin-top:1rem;display:grid;gap:.6rem}
.lh-option{display:flex;align-items:flex-start;gap:.65rem;width:100%;min-height:44px;padding:.75rem .85rem;border:1px solid #c8cfda;border-radius:.75rem;background:#fff;color:inherit;font:inherit;line-height:1.45;text-align:left;cursor:pointer;box-sizing:border-box}
button.lh-option{appearance:none}
.lh-option:focus-visible{outline:3px solid #6b9df8;outline-offset:2px}
.lh-key{font-weight:700;flex:0 0 auto}
.lh-option-text{flex:1;min-width:0;overflow-wrap:anywhere}
.lh-option-text .lh-prose{display:contents}
.lh-option-text .lh-prose>p{display:inline;margin:0}
.lh-mark{flex:0 0 auto;font-weight:800}
.lh-option.is-correct{border-color:#2e9b62;background:#e9f7ef}
.lh-option.is-wrong{border-color:#d05757;background:#fff0f0}
.lh-submit{margin-top:.35rem;padding:.7rem .9rem;border-radius:.65rem;background:#2563eb;color:#fff;text-align:center;font-weight:650;cursor:pointer}
.lh-label{margin-top:1rem;color:#667085;font-size:.75em;text-transform:uppercase;letter-spacing:.06em}
.lh-answer{font-weight:650;margin-top:.3rem;overflow-wrap:anywhere}
.lh-solution{margin-top:.3rem;overflow-wrap:anywhere}
.lh-meta{margin-top:1.4rem;color:#667085;font-size:.72em}
.nightMode .lh-option{background:#20242a;border-color:#49515d}
.nightMode .lh-option.is-correct{background:#153b2b;border-color:#48ad76}
.nightMode .lh-option.is-wrong{background:#482326;border-color:#d56b6b}
.nightMode .lh-label,.nightMode .lh-meta{color:#a3acb9}
@media(max-width:480px){.card{font-size:18px;padding:14px}.lh-option{padding:.8rem;min-height:48px}}
`;
