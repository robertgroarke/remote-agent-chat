(()=>{var Wf=Object.create;var Zu=Object.defineProperty;var zf=Object.getOwnPropertyDescriptor;var Vf=Object.getOwnPropertyNames;var Kf=Object.getPrototypeOf,Yf=Object.prototype.hasOwnProperty;var Xf=(e,t)=>()=>(t||e((t={exports:{}}).exports,t),t.exports);var Qf=(e,t,n,s)=>{if(t&&typeof t=="object"||typeof t=="function")for(let a of Vf(t))!Yf.call(e,a)&&a!==n&&Zu(e,a,{get:()=>t[a],
enumerable:!(s=zf(t,a))||s.enumerable});return e};var Jf=(e,t,n)=>(n=e!=null?Wf(Kf(e)):{},Qf(t||!e||!e.__esModule?Zu(n,"default",{value:e,enumerable:!0}):n,e));var rm=Xf((Hy,am)=>{"use strict";var Qp=new Set(["codex","codex_cli","codex-desktop"]),b_=new Set(["thinking","generatin\
g","reading_files","running_command","applying_patch","working"]),v_=new Set(["active","in_progress","in-progress","work\
ing","running"]),y_=new Set(["pending","queued","todo","not_started","not-started"]),Jp=new Set(["completed","complete",
"done","passed","success","succeeded"]),k_=new Set([...Jp,"cancelled","canceled","failed","skipped"]),w_=new Set(["","ac\
tive","idle","ready","thinking","generating","working","busy","connected"]),Zp=240,N_=32,S_=48,C_=/^(?=.*\d)(?:(?:\d+)\s*d\s*)?(?:(?:\d+)\s*h\s*)?(?:(?:\d+)\s*m\s*)?(?:(?:\d+)\s*s)?$/i,
x_=/^[+-]?\d+\s*[dhms]\b/i,A_=/^(?:just now|today|yesterday|(?:\d+|an?|one)\s+(?:seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?)\s+ago)$/i,
R_=/^(?:pursuing goal|paused goal|goal (?:paused|blocked|usage limited|rate limited|limited|budget limited|achieved|cancelled|canceled|stopped|failed)|idle|ready|connected|awaiting live update)$/i,
M_=/^(?:no (?:recent message|current work|data|activity)(?: reported)?|unavailable|unknown|not available)$/i,T_=/^(?:remote agent chat|(?:antigravity|claude(?: code)?|cline|codex|continue|cursor|gemini|roo code)\s+(?:harness|workspace))$/i,
Yp=Object.freeze({active:"active",running:"active",working:"active",pursuing:"active",pursuing_goal:"active",paused:"pau\
sed",pause:"paused",paused_goal:"paused",blocked:"blocked",goal_blocked:"blocked",needs_attention:"blocked",waiting_for_user:"\
blocked",usagelimited:"usageLimited",usage_limited:"usageLimited",goal_usage_limited:"usageLimited",rate_limited:"usageL\
imited",goal_rate_limited:"usageLimited",budgetlimited:"budgetLimited",budget_limited:"budgetLimited",goal_limited:"budg\
etLimited",goal_budget_limited:"budgetLimited",complete:"complete",completed:"complete",achieved:"complete",goal_achieved:"\
complete",cancelled:"cancelled",canceled:"cancelled",stopped:"cancelled",goal_cancelled:"cancelled",goal_canceled:"cance\
lled",goal_stopped:"cancelled",failed:"failed",failure:"failed",goal_failed:"failed"});function em(e){return String(e||"").
trim().toLowerCase()}function tm(e,t){return t&&typeof t.goal_lifecycle=="boolean"?t.goal_lifecycle:Qp.has(em(e))}function Gi(e){
if(typeof e=="number"&&Number.isFinite(e)&&e>0)return e;let t=Date.parse(String(e||""));return Number.isFinite(t)?t:0}function es(...e){
for(let t of e){let n=Gi(t);if(n)return new Date(n).toISOString()}return null}function $_(e){return/(?:\bbearer\s+[a-z0-9._~+/=-]{8,}|\b(?:api[_ -]?key|password|passwd|secret|access[_ -]?token|refresh[_ -]?token)\s*[:=]\s*\S+|\bsk-[a-z0-9_-]{8,})/i.
test(e)}function nm(e){let t=String(e??"").replace(/\s+/g," ").trim();return t?C_.test(t)?"duration_only":x_.test(t)?"du\
ration_malformed":A_.test(t)?"age_only":R_.test(t)?"status_only":M_.test(t)?"placeholder_only":T_.test(t)?"surface_label\
_only":"":"empty"}function Zt(e,t=Zp){if(typeof e!="string"&&typeof e!="number")return"";let n=String(e).replace(/[\u0000-\u001f\u007f]+/g,
" ").replace(/```[\s\S]*?```/g," ").replace(/\s+/g," ").trim();return!n||$_(n)||nm(n)||/^[{[]\s*["']?[\w.-]+["']?\s*:/.test(
n)||/^(?:powershell|pwsh|cmd(?:\.exe)?|bash|sh|zsh|fish)\s+-/i.test(n)?"":(n=n.replace(/^(?:[-*•]\s+|#{1,6}\s+)/,"").trim(),
n.slice(0,t).trim())}function sm(e){let t=String(e||"").trim().replace(/([a-z0-9])([A-Z])/g,"$1_$2").toLowerCase().replace(
/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"");return t&&(Yp[t]||Yp[t.replace(/_/g,"")])||"unknown"}function Tl(e){for(let t of[
e?.state,e?.status,e?.raw_state,e?.native_state]){let n=sm(t);if(n!=="unknown")return n}return"unknown"}function Hi(e){return String(
e?.state||e?.status||"").trim().toLowerCase()}function Xp(e){return Zt(e?.subject||e?.text||e?.content||e?.description||
e?.label)}function $l(e,t){let n=Number(t),s=Number(e);return!Number.isInteger(n)||n<=0||!Number.isInteger(s)||s<0?null:
{completed:Math.min(s,n),total:n}}function E_(e){let t=Number(e?.progress_percent??e?.percent_complete??e?.percent??e?.progress);
return Number.isFinite(t)?Math.max(0,Math.min(100,t<=1?t*100:t)):null}function Ui(e,t={}){if(!e||typeof e!="object")return null;
let n=String(e.kind||"").trim().toLowerCase().replace(/[^a-z_]/g,"").slice(0,24);if(!n||n==="goal"&&t.goalCapable===!1)return null;
let s=Zt(e.label,N_),a=Zt(e.text),i=Zt(e.source,S_).replace(/\s+/g,"_").toLowerCase();if(!s||!a||!i)return null;let c=n===
"goal"?Tl(e):"unknown";if(n==="goal"&&c==="unknown")return null;let d=$l(e.completed,e.total),f=Number(e.percent);return{
kind:n,label:s,text:a,source:i,updated_at:es(e.updated_at)||null,...d||{},...Number.isFinite(f)?{percent:Math.max(0,Math.
min(100,f))}:{},...n==="goal"?{state:c}:e.state?{state:Zt(e.state,32).toLowerCase()}:{},...e.diagnostic_reason?{diagnostic_reason:String(
e.diagnostic_reason).slice(0,64)}:{}}}function L_(e){let t=Array.isArray(e)?e:[];for(let n=t.length-1;n>=0;n-=1){let s=t[n];
if(String(s?.role||"").toLowerCase()!=="user")continue;let a=Zt(s?.content||s?.text);if(a)return{text:a,updated_at:es(s?.
timestamp,s?.created_at,s?.ts,s?.server_ts)}}return null}function Ml(e,t){let n=em(e);return n==="claude"||n==="claude_c\
li"||n==="claude-desktop"?t>1?"Tasks":"Task":["antigravity","antigravity_panel","antigravity-v2","gemini","continue","co\
ntinue_yolo","roo_code","cline"].includes(n)?"Task":t>1?"Tasks":"Plan"}function q_(e,t){let n=t?.task_list,s=Array.isArray(
n?.tasks)?n.tasks:[],a=s.filter(h=>Xp(h));if(a.length>0){let h=a.find(x=>v_.has(Hi(x))),b=a.find(x=>y_.has(Hi(x))),N=h||
b;if(N){let x=Number(n.total),S=Number.isInteger(x)&&x>0?x:s.length,R=Number(n.completed),u=Number.isInteger(R)&&R>=0?R:
s.filter(v=>Jp.has(Hi(v))).length;return{kind:"plan",label:Ml(e,S),text:Xp(N),source:"task_list",updated_at:es(N.updated_at,
N.updatedAt,n.updated_at,t.updated_at),...$l(u,S)}}}let i=t?.step,c=Hi(i),d=typeof i=="object"?i?.text||i?.content||i?.description||
i?.label||i?.name:i,f=Zt(d);return f&&!k_.has(c)?{kind:"plan",label:Ml(e,1),text:f,source:"step",updated_at:es(i?.updated_at,
i?.updatedAt,t.updated_at)}:null}function P_(e){let t=e?.current;if(!t||typeof t!="object")return null;let n=Zt(t.label||
t.title||t.name);if(!n)return null;let s=String(t.kind||"").trim().toLowerCase(),a=["response","thinking","generating","\
message"].includes(s);return{kind:a?"response":"activity",label:a?"Current response":"Current activity",text:n,source:s?
`current_${s}`:"current",updated_at:es(t.updated_at,t.since,e.updated_at)}}function I_(e,t){let n=t?.context_card;if(!n||
typeof n!="object")return null;let s=Zt(n.task||n.title||n.mode||n.label||n.text);return s?{kind:"task",label:Ml(e,1),text:s,
source:"context_card",updated_at:es(n.updated_at,t.updated_at)}:null}function O_(e){let t=typeof e=="string"?{text:e}:e,
n=Zt(t?.text||t?.content);return n?{kind:"request",label:"Request",text:n,source:"latest_user_request",updated_at:es(t?.
updated_at,t?.timestamp,t?.created_at)}:null}function D_(e){let t=Zt(e?.label,160);return!t||w_.has(t.toLowerCase())?null:
{kind:"activity",label:"Current activity",text:t,source:"activity_label",updated_at:es(e?.updated_at,e?.started_at,e?.since)}}
function j_(e,t){if(!t||!e?.goal||typeof e.goal!="object")return null;let n=e.goal,s=Zt(n.objective||n.text);if(!s)return null;
let a=Tl(n);if(a==="unknown")return null;let i=$l(n.completed,n.total),c=E_(n);return{kind:"goal",label:"Goal",text:s,source:"\
goal",updated_at:es(n.updated_at,n.observed_at,e.updated_at),...i||{},...c==null?{}:{percent:c},state:a}}function B_(e,t){
if(!e)return t;if(!t)return e;let n=Gi(e.updated_at);return Gi(t.updated_at)>n&&n>0?t:e}function F_(e={}){let t=e.activity&&
typeof e.activity=="object"?e.activity:{},n=tm(e.agentType,e.capabilities);if(e.preferProvided!==!1){let N=Ui(t.work_context,
{goalCapable:n});if(N)return N}let s=j_(t,n);if(s)return Ui(s,{goalCapable:n});let a=q_(e.agentType,t),i=P_(t),c=I_(e.agentType,
t),d=O_(e.latestUserRequest),f=D_(t),h=b_.has(String(t.kind||"").toLowerCase()),b=a||c;return h&&i&&(b=B_(b,i)),b||(b=i||
c||d||f),!b&&d&&(b=d),b||(b={kind:"empty",label:"Current work",text:"Current work unavailable",source:"none",updated_at:es(
t.updated_at),diagnostic_reason:"no_authoritative_work_context"}),Ui(b,{goalCapable:n})}am.exports={CODEX_GOAL_AGENT_TYPES:Qp,
MAX_CONTEXT_TEXT:Zp,boundedDisplayText:Zt,coherentGoalState:Tl,goalLifecycleSupported:tm,latestUserRequestFromMessages:L_,
normalizeFleetWorkContext:Ui,normalizeGoalState:sm,projectFleetWorkContext:F_,rejectedDisplayTextReason:nm,timestampMs:Gi}});var Zf=new Set(["js","jsx","ts","tsx","py","json","md","css","html","htm","sh","bash","yaml","yml","txt","env","csv","xm\
l","sql","go","rs","java","c","cpp","h","hpp","rb","php","swift","kt","scala","r","m","tf","toml","ini","cfg","conf","lo\
g","gitignore","dockerfile","makefile","vue","svelte","graphql","gql"]),eg={js:"javascript",jsx:"jsx",ts:"typescript",tsx:"\
tsx",py:"python",rb:"ruby",sh:"bash",bash:"bash",rs:"rust",kt:"kotlin",tf:"hcl",md:"markdown",yml:"yaml",yaml:"yaml",graphql:"\
graphql",gql:"graphql"};function hr(e){let t=e.split(".").pop().toLowerCase();return eg[t]||t}function td(e){let t=e.split(
".").pop().toLowerCase();return Zf.has(t)}var ed={claude:"Claude Code",claude_cli:"Claude Code CLI",codex:"Codex",codex_cli:"\
Codex CLI",cursor_cli:"Cursor CLI",gemini:"Gemini",continue:"Continue",continue_yolo:"Continue YOLO",roo_code:"Roo Code",
cline:"Cline",antigravity:"Antigravity",antigravity_panel:"Antigravity Chat","codex-desktop":"Codex Desktop",cursor:"Cur\
sor","claude-desktop":"Claude Desktop"},tg=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function nd(e,t){if(e&&typeof e=="object"){let f=ed[e.agent_type]||e.display_name||e.agent_type||"Agent",h=e.workspace_name||
e.window_title||"";return h?f+" \u2014 "+h:f}let n=t||e;if(typeof n!="string")return"Agent";if(tg.test(n))return"Agent S\
ession";let s=n.split("-"),a=s[0],i=s[1]||"",c=s[2]||"",d=i?" (win "+i+c+")":"";return(ed[a]||a)+d}function je(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}function mn(e){return je(String(
e)).replace(/"/g,"&quot;")}function vr(e){return/^[A-Za-z]:\\/.test(e)||e.includes("\\")||e.includes("/")||/^[.~]\//.test(
e)}function ng(e){let t=0,n=0;return e.split(`
`).forEach(s=>{/^\+\+\+|^---|^@@/.test(s)||(s.startsWith("+")&&t++,s.startsWith("-")&&n++)}),{adds:t,dels:n}}function sg(e){
return/\b(edit|edited|patch|diff|apply_patch|write)\b/i.test(String(e||""))}function ag(e){let t=String(e||"").replace(/\r\n?/g,
`
`).split(`
`).map(n=>n.trimEnd());for(let n of t)if(n){if(/^(diff --git|index )/.test(n)||/^@@/.test(n)||/^---[ \t]/.test(n)||/^\+\+\+[ \t]/.
test(n))return!0;if(/^[+\- ]/.test(n)){let s=n.slice(1).trim();if(!s||/^[\d\s()+\-]+$/.test(s))continue;return!0}}return!1}function rg(e){let t=(e||"").toLowerCase();return t.includes("bash")||t.includes("run")||t.includes("command")||t.includes(
"execute")?"dot-bash":t.includes("read")?"dot-read":t.includes("edit")||t.includes("write")||t.includes("patch")?"dot-wr\
ite":t.includes("search")||t.includes("grep")||t.includes("find")||t.includes("glob")?"dot-search":t.includes("browser")||
t.includes("web")||t.includes("fetch")?"dot-browser":"dot-default"}function rd(e){let t=String(e||"").split(`
`),n=[],s=[],a=null,i=!1;function c(){let f=s.join(`
`).trim();f&&n.push({type:"markdown",content:f}),s=[]}function d(){if(!a)return;let f=a.lines.join(`
`).trimEnd();n.push({type:"tool",name:a.name,content:f}),a=null}return t.forEach(f=>{let h=/^```/.test(f.trim()),b=i?null:
f.match(/^\[([^\]\n]+)\]\s*$/),N=i?null:f.match(/^(Ran .+|Read .+|Edited file|Edit .+|Analyzed .+|Search(?:ed)? .+|Bash .+)\s*$/),
x=!i&&f.match(/^(\d+\s+lines?(?:\s+of\s+output)?)$/i);if(b){if(b[1].trim()==="end"){d();return}c(),d(),a={name:b[1].trim(),
lines:[]};return}if(x){c(),d(),a={name:x[1].trim(),lines:[]};return}if(N){c(),d(),a={name:N[1].trim(),lines:[]};return}a?
a.lines.push(f):s.push(f),h&&(i=!i)}),c(),d(),n.length>0?n:[{type:"markdown",content:String(e||"")}]}function zc(e){if(!e)
return!1;let t=String(e).replace(/\r\n?/g,`
`);if(/^(diff --git|index )/m.test(t)||/^@@/m.test(t)||/^---[ \t]/m.test(t)&&/^\+\+\+[ \t]/m.test(t))return!0;let s=t.split(
`
`).map(f=>f.trimEnd()).filter(Boolean);if(s.length<4)return!1;let a=s.filter(f=>/^[+-](?![-+]{2})/.test(f)).length,i=s.filter(
f=>/^\+(?!\+\+ )/.test(f)).length,c=s.filter(f=>/^-(?!-- )/.test(f)).length,d=s.filter(f=>/^ /.test(f)).length;return a>=
3&&i>=1&&c>=1&&d>=1}function od(e){let t=e.match(/^\+\+\+[ \t]+(?:[ab]\/)?(.+?)(?:\t.*)?$/m);if(t){let s=t[1].trim();if(s&&
s!=="/dev/null")return s}let n=e.match(/^---[ \t]+(?:[ab]\/)?(.+?)(?:\t.*)?$/m);if(n){let s=n[1].trim();if(s&&s!=="/dev/\
null")return s}return null}var sd=300;function og(e,t){if(e.length>sd||t.length>sd)return null;let n=e.length,s=t.length,
a=Array.from({length:n+1},()=>new Int32Array(s+1));for(let f=1;f<=n;f++)for(let h=1;h<=s;h++)a[f][h]=e[f-1]===t[h-1]?a[f-
1][h-1]+1:Math.max(a[f-1][h],a[f][h-1]);let i=[],c=n,d=s;for(;c>0||d>0;)c>0&&d>0&&e[c-1]===t[d-1]?(i.unshift({type:"eq"}),
c--,d--):d>0&&(c===0||a[c][d-1]>=a[c-1][d])?(i.unshift({type:"ins"}),d--):(i.unshift({type:"del"}),c--);return i}function ig(e){
let t=[],n=0,s=null;for(let a of e)a.type==="del"?(s===null&&(s=n),n++):a.type==="eq"&&(s!==null&&(t.push({start:s,end:n}),
s=null),n++);return s!==null&&t.push({start:s,end:n}),t}function cg(e){let t=[],n=0,s=null;for(let a of e)a.type==="ins"?
(s===null&&(s=n),n++):a.type==="eq"&&(s!==null&&(t.push({start:s,end:n}),s=null),n++);return s!==null&&t.push({start:s,end:n}),
t}function ad(e,t,n){if(!t||!t.length)return e;let s="",a=0,i=0,c=!1,d=0;for(;d<e.length;)if(e[d]==="<"){c&&(s+="</mark>",
c=!1);let f=e.indexOf(">",d);if(f===-1){s+=e[d++];continue}s+=e.slice(d,f+1),d=f+1,i<t.length&&a>=t[i].start&&a<t[i].end&&
(s+=`<mark class="${n}">`,c=!0)}else{if(c&&a>=t[i].end&&(s+="</mark>",c=!1,i++),!c&&i<t.length&&a>=t[i].start&&(s+=`<mar\
k class="${n}">`,c=!0),e[d]==="&"){let f=e.indexOf(";",d+1),h=f!==-1&&f-d<=8?f+1:d+1;s+=e.slice(d,h),d=h}else s+=e[d++];
a++}return c&&(s+="</mark>"),s}function id(e){let t=cd(e);return t.length>0&&t[t.length-1].trim()===""&&t.pop(),t.map((n,s)=>`\
<span class="code-line"><span class="code-line-num">${s+1}</span>${n}</span>`).join("")}var lg=/[A-Za-z]:\\[^\n"'`<>]+?\.[A-Za-z0-9._-]+(?:\s+\((?:Lines?|Line)\s+\d+(?:-\d+)?\))?|(?:\.{1,2}[\\/])?(?:[A-Za-z0-9_.-]+[\\/])+[A-Za-z0-9_.-]+\.[A-Za-z0-9._-]+(?:\s+\((?:Lines?|Line)\s+\d+(?:-\d+)?\))?/g;
function ug(e){let t=String(e||""),n="",s=0;for(let a of t.matchAll(lg)){let i=a[0],c=a.index||0,d=c+i.length,f=c>0?t[c-
1]:"",h=d<t.length?t[d]:"",b=(!f||/[\s([{"'`]/.test(f))&&(!h||/[\s)\]},"'`:;]/.test(h)),N=i.trim();!b||!vr(N)||(n+=je(t.
slice(s,c)),n+=`<button class="inline-file-ref tool-open-file" type="button" title="Open file preview" data-open-path="${mn(
N)}" data-copy-path="${mn(N)}">${je(N)}</button>`,s=d)}return n+=je(t.slice(s)),n||"&nbsp;"}function dg(e){let t=String(
e||"").replace(/\r\n/g,`
`).split(`
`);return t.length>0&&t[t.length-1]===""&&t.pop(),t.map((n,s)=>`<span class="code-line"><span class="code-line-num">${s+
1}</span>${ug(n)}</span>`).join("")}function Gc(e,t){return`<span class="diff-gutter"><span class="diff-gutter-num diff-\
gutter-old">${e??""}</span><span class="diff-gutter-num diff-gutter-new">${t??""}</span></span>`}function _r(e){return`<\
span class="diff-gutter"><span class="diff-gutter-num">${e??""}</span></span>`}function pg(e){let t=0,n=0;for(let s of e)
if(s.type==="hunk"){let a=s.raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);a&&(t=parseInt(a[1],10)-1,n=parseInt(a[2],
10)-1),s.oldLine=null,s.newLine=null}else s.type==="add"?(s.oldLine=null,s.newLine=++n):s.type==="del"?(s.oldLine=++t,s.
newLine=null):s.type==="ctx"?(s.oldLine=++t,s.newLine=++n):(s.oldLine=null,s.newLine=null)}function mg(e,t,n){let s=[],a=d=>n.
has(d)?n.get(d):t&&t[d]!=null?t[d]:je(e[d].raw.startsWith("+")||e[d].raw.startsWith("-")||e[d].raw.startsWith(" ")?e[d].
raw.slice(1):e[d].raw),i=d=>t&&t[d]!=null?" diff-hl":"",c=0;for(;c<e.length;){let d=e[c];if(d.type==="meta"){let S=`<spa\
n class="diff-meta">${je(d.raw)}</span>`;s.push({type:"both",html:S}),c++;continue}if(d.type==="hunk"){let S=`<span clas\
s="diff-hunk">${je(d.raw)}</span>`;s.push({type:"both",html:S}),c++;continue}if(d.type==="ctx"){s.push({type:"ctx",content:a(
c),hlCls:i(c),oldLine:d.oldLine,newLine:d.newLine}),c++;continue}let f=c;for(;f<e.length&&e[f].type==="del";)f++;let h=f;
for(;h<e.length&&e[h].type==="add";)h++;let b=f-c,N=h-f,x=Math.min(b,N);for(let S=0;S<x;S++)s.push({type:"pair",delContent:a(
c+S),delHlCls:i(c+S),addContent:a(f+S),addHlCls:i(f+S),delOldLine:e[c+S].oldLine,addNewLine:e[f+S].newLine});for(let S=x;S<
b;S++)s.push({type:"del",content:a(c+S),hlCls:i(c+S),oldLine:e[c+S].oldLine});for(let S=x;S<N;S++)s.push({type:"add",content:a(
f+S),hlCls:i(f+S),newLine:e[f+S].newLine});c=h>c?h:c+1}return s}function fg(e){let t=[],n=[];for(let s of e)s.type==="bo\
th"?(t.push(s.html),n.push(s.html)):s.type==="ctx"?(t.push(`<span class="diff-ctx${s.hlCls}">${_r(s.oldLine)}${s.content}\
</span>`),n.push(`<span class="diff-ctx${s.hlCls}">${_r(s.newLine)}${s.content}</span>`)):s.type==="pair"?(t.push(`<span\
 class="diff-del${s.delHlCls}">${_r(s.delOldLine)}${s.delContent}</span>`),n.push(`<span class="diff-add${s.addHlCls}">${_r(
s.addNewLine)}${s.addContent}</span>`)):s.type==="del"?(t.push(`<span class="diff-del${s.hlCls}">${_r(s.oldLine)}${s.content}\
</span>`),n.push('<span class="diff-empty"></span>')):s.type==="add"&&(t.push('<span class="diff-empty"></span>'),n.push(
`<span class="diff-add${s.hlCls}">${_r(s.newLine)}${s.content}</span>`));return`<div class="diff-split"><div class="diff\
-split-col diff-split-old"><code class="hljs diff-code">${t.join("")}</code></div><div class="diff-split-col diff-split-\
new"><code class="hljs diff-code">${n.join("")}</code></div></div>`}function cd(e){let t=[],n="",s=[],a=0;for(;a<e.length;)
if(e[a]===`
`)t.push(n+"</span>".repeat(s.length)),n=s.map(i=>`<span class="${i}">`).join(""),a++;else if(e[a]==="<")if(e.startsWith(
"</span>",a))s.pop(),n+="</span>",a+=7;else if(e.startsWith("<span",a)){let i=e.indexOf(">",a);if(i===-1){n+=e[a++];continue}
let c=e.slice(a,i+1),d=c.match(/class="([^"]*)"/);s.push(d?d[1]:""),n+=c,a=i+1}else n+=e[a++];else n+=e[a++];return(n||s.
length)&&t.push(n+"</span>".repeat(s.length)),t}function ld(e,t){let n=(()=>{if(!t||typeof hljs>"u")return null;if(hljs.
getLanguage(t))return t;let u=t.split(".").pop().toLowerCase();return hljs.getLanguage(u)?u:null})(),a=e.split(`
`).map(u=>/^\+\+\+|^---/.test(u)?{type:"meta",raw:u}:/^@@/.test(u)?{type:"hunk",raw:u}:u.startsWith("+")?{type:"add",raw:u}:
u.startsWith("-")?{type:"del",raw:u}:{type:"ctx",raw:u});pg(a);let i=null;if(n)try{let u=a.map(g=>g.type==="meta"||g.type===
"hunk"?"":g.raw.startsWith("+")||g.raw.startsWith("-")||g.raw.startsWith(" ")?g.raw.slice(1):g.raw),v=hljs.highlight(u.join(
`
`),{language:n});i=cd(v.value)}catch{i=null}let c=new Map;for(let u=0;u<a.length;){if(a[u].type!=="del"){u++;continue}let v=u;
for(;v<a.length&&a[v].type==="del";)v++;let g=v;for(;g<a.length&&a[g].type==="add";)g++;let w=v-u,y=g-v;if(w===y&&w>0)for(let E=0;E<
w;E++){let T=u+E,H=v+E,K=a[T].raw.slice(1),te=a[H].raw.slice(1),ne=og(K,te);if(!ne)continue;let oe=ne.filter(J=>J.type===
"eq").length,G=Math.max(K.length,te.length);if(G>0&&oe/G<.15)continue;let de=i&&i[T]!=null?i[T]:je(K),Ne=i&&i[H]!=null?i[H]:
je(te);c.set(T,ad(de,ig(ne),"diff-word-del")),c.set(H,ad(Ne,cg(ne),"diff-word-add"))}u=g>u?g:u+1}let d=0,f=0,h=0,b=!1,N=a.
map((u,v)=>{if(u.type==="meta")return`<span class="diff-meta">${je(u.raw)}</span>`;if(u.type==="hunk")return b=!0,h++,`<\
span class="diff-hunk diff-hunk-btn" data-hunk-id="${h}" role="button" tabindex="0" title="Toggle context lines">${je(u.
raw)}</span>`;let g=u.raw.startsWith("+")||u.raw.startsWith("-")||u.raw.startsWith(" ")?u.raw.slice(1):u.raw,w=c.has(v)?
c.get(v):i&&i[v]!=null?i[v]:je(g),y=i&&i[v]!=null?" diff-hl":"",E=h>0?` data-hunk-ctx="${h}"`:"";return u.type==="add"?(d++,
`<span class="diff-add${y}"${E}>${Gc(null,u.newLine)}${w}</span>`):u.type==="del"?(f++,`<span class="diff-del${y}"${E}>${Gc(
u.oldLine,null)}${w}</span>`):`<span class="diff-ctx${y}"${E}>${Gc(u.oldLine,u.newLine)}${w}</span>`}),x=d||f?`<span cla\
ss="diff-stat-add">+${d}</span><span class="diff-stat-del">-${f}</span>`:"",S=mg(a,i,c),R=fg(S);return{body:N.join(""),stats:x,
splitHtml:R,hasHunks:b}}var ud='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke\
-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3"/><path d="M1\
6 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3"/><line x1="12" y1="3" x2="12" y2="21"/></svg>',gg='<svg width="14" height="14" \
viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><c\
ircle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',hg='<svg class="copy-icon" width="14" \
height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoi\
n="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9\
a2 2 0 0 1 2 2v1"></path></svg>',_g='<svg class="check-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stro\
ke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:none"><polyline point\
s="20 6 9 17 4 12"></polyline></svg>';var dd=new marked.Renderer;dd.code=function(e,t){let n=typeof e=="object"?e.text||e.raw||"":e||"",a=(typeof e=="object"?
e.lang||"":t||"").split(/\s/)[0].toLowerCase()||"text",i=a==="diff"||a==="patch"||zc(n),c=!i&&(a==="text"||a==="markdown"),
d,f="",h="",b="",N=null;if(i){h=od(n)||"";let H=h?hr(h):null;N=ld(n,H),d=N.body,f=N.stats,b=N.splitHtml||""}else if(c)d=
dg(n);else try{d=hljs.getLanguage(a)?hljs.highlight(n,{language:a}).value:hljs.highlightAuto(n).value}catch{d=je(n)}let x=n;
!i&&!c&&(d=id(d));let S=i||a==="text"?"":a,R=h?`<button class="diff-filepath" title="Open file preview" data-copy-path="${mn(
h)}" data-open-path="${mn(h)}">${je(h)}</button>`:"",u=b?`<button class="diff-split-toggle" title="Toggle side-by-side v\
iew">${ud}</button>`:"",v=i&&N&&N.hasHunks?'<button class="diff-ctx-collapse-all" title="Collapse/expand all context lin\
es">Context</button>':"",g=!1,w="",y=typeof localStorage<"u"&&localStorage.getItem("codeblock_wrap_pref")==="1",E=`<butt\
on class="code-wrap-toggle${y?" active":""}" title="${y?"Disable word wrap":"Enable word wrap"}">${y?"No Wrap":"Wrap"}</\
button>`,T=i?"":` data-raw="${mn(x)}"`;return`<div class="code-block${i?" diff-block":""}${g?" code-collapsible":""}${y?
" code-wrap":""}" data-diff-mode="unified">
    <div class="code-header">
      <span class="code-lang">${S}</span>
      ${R}
      <span class="diff-stats">${f}</span>
      ${v}
      ${u}
      ${w}
      ${E}
      <button class="code-search-btn" title="Search in block">${gg}</button>
      <button class="code-copy" title="Copy code">${hg}${_g}<span class="copy-label">Copy</span></button>
    </div>
    <div class="code-search-bar" hidden>
      <input class="code-search-input" type="text" placeholder="Search\u2026" aria-label="Search in code block">
      <span class="code-search-count"></span>
      <button class="code-search-prev" title="Previous match">&#8593;</button>
      <button class="code-search-next" title="Next match">&#8595;</button>
      <button class="code-search-close" title="Close search">&#10005;</button>
    </div>
    <pre><code class="hljs${i?" diff-code":""}"${T}>${d}</code></pre>
    ${b}
  </div>`};marked.use({renderer:dd,breaks:!0,gfm:!0});function bg(e,t){let n=(e||"").toLowerCase();if(n==="bash"||n==="r\
un"||n==="execute"||n==="shell"){let a=t.find(i=>i.trim());return a?a.trim().substring(0,80):""}let s=t.find(a=>a.trim());
return s&&vr(s.trim())?s.trim():s?s.trim().substring(0,60):""}function vg(e,t,n){let s=String(t||"").replace(/\n+$/,"").
split(`
`),a=s.find(oe=>oe.trim()),i=a&&vr(a.trim())?a.trim():"",c=(oe,G="")=>{let de=String(oe||"").trim();if(!de)return"";let Ne=[
"tool-path",G,vr(de)?"tool-open-file":""].filter(Boolean).join(" ");return vr(de)?`<button class="${Ne}" type="button" t\
itle="Open file preview" data-open-path="${mn(de)}" data-copy-path="${mn(de)}">${je(de)}</button>`:`<span class="${Ne}">${je(
de)}</span>`},d=s.filter((oe,G,de)=>!(G===de.length-1&&de[G]==="")).length,f=/^\d+\s+lines?(?:\s+of\s+output)?$/i.test(e.
trim()),h=s.some(oe=>oe.trim()),b=f&&d===0||!h,x=/^Bash\b/i.test(e.trim())&&s.every(oe=>{let G=oe.trim();return!G||/^\$\s+/.
test(G)}),S=!h,R=s.join(`
`),u=ng(t),v=zc(t)||sg(e)&&(u.adds||u.dels),g=v&&od(t)||i,w=v&&g?hr(g):null,y=(()=>{if(!v)return R;let oe=R,G=oe.match(/```(?:diff|patch)?\s*\n([\s\S]*?)```\s*$/m);
G&&(oe=G[1]);let de=oe.split(`
`),Ne=0;for(;Ne<de.length;){let J=de[Ne];if(J.startsWith("+")||J.startsWith("-")||J.startsWith("@@")||J.startsWith(" "))
break;Ne++}return de.slice(Ne).join(`
`)})(),E=v&&ag(y),T=E?ld(y,w):null,H=u.adds||u.dels?`<span class="tool-stat-add">+${u.adds}</span><span class="tool-stat\
-del">-${u.dels}</span>`:"",K=v?(()=>{for(let oe of s){let G=oe.trim();if(G&&!G.startsWith("```")&&!G.startsWith("+")&&!G.
startsWith("-")&&!G.startsWith("@@")&&!G.startsWith(" "))return G}return""})():"",te=S&&!g?K||bg(e,s):K||"",ne=!b&&(E||!v);
return`<section class="tool-section${S?" collapsed":""}" data-tool-index="${n}">
    <button class="tool-toggle" type="button" aria-expanded="${S?"false":"true"}">
      <span class="tool-chevron">${ne?S?"\u25B8":"\u25BE":""}</span>
      <span class="tool-dot ${rg(e)}">\u25CF</span>
      <span class="tool-toggle-main">
        ${(()=>{let oe=e.indexOf(" ");if(oe>0){let G=e.substring(0,oe),de=e.substring(oe+1).trim();return`<span class="t\
ool-name">${je(G)}</span>${c(de)}`}return`<span class="tool-name">${je(e)}</span>`})()}
        ${g?c(g,"tool-path-secondary"):""}
        ${te?`<span class="tool-preview">${je(te)}</span>`:""}
      </span>
      <span class="tool-toggle-side">
        ${H}
        ${f&&d>0?`<span class="tool-line-count">${d} lines</span>`:""}
      </span>
    </button>
    ${ne?`<div class="tool-body"${S?" hidden":""}>
      ${E?`<div class="code-block diff-block tool-diff-block" data-diff-mode="unified">
            <div class="code-header">
              <span class="code-lang"></span>
              ${g?`<button class="diff-filepath" title="Open file preview" data-copy-path="${mn(g)}" data-open-path="${mn(
g)}">${je(g)}</button>`:""}
              <span class="diff-stats">${T?.stats||""}</span>
              ${T?.hasHunks?'<button class="diff-ctx-collapse-all" title="Collapse/expand all context lines">Context</bu\
tton>':""}
              ${T?.splitHtml?`<button class="diff-split-toggle" title="Toggle side-by-side view">${ud}</button>`:""}
            </div>
            <pre><code class="hljs diff-code">${T?.body||""}</code></pre>
            ${T?.splitHtml||""}
          </div>`:(()=>{let oe=pd(R);if(oe)return md(oe,n+"_b");let G=R.trim();return G.startsWith("```")?`<div class="t\
ool-body-md">${marked.parse(G)}</div>`:`<pre class="tool-body-pre"><code>${je(R)}</code></pre>`})()}
    </div>`:""}
  </section>`}var yg=/^IN\n\n?```([^\n]*)\n([\s\S]*?)\n```\n\n?OUT(?:\n\n?```([^\n]*)\n([\s\S]*?)\n```)?[\s]*$/,kg=/^IN\n([\s\S]*?)(?:\nOUT\n([\s\S]*))?$/;
function pd(e){if(!e)return null;let t=e.replace(/\r\n/g,`
`);if(!t.startsWith(`IN
`))return null;let n=t.match(yg);if(n)return{inLang:n[1]||"",inText:n[2]||"",outLang:n[3]||"",outText:n[4]||""};let s=t.
match(kg);return s?{inLang:"",inText:(s[1]||"").trim(),outLang:"",outText:(s[2]||"").trim()}:null}function md(e,t){let n=(e.
inText||"").trimEnd().split(`
`),s=(e.outText||"").trimEnd().split(`
`),a=(c,d)=>{let f=je(d.join(`
`)),h=d.length===0||d.length===1&&!d[0].trim()?'<span class="tool-io-empty">(no output)</span>':"";return`<div class="to\
ol-io-row">
      <span class="tool-io-label">${c}</span>
      <div class="tool-io-content">${h||`<code class="tool-io-code">${f}</code>`}</div>
    </div>`},i=s.length===0||s.length===1&&!s[0].trim();return`<div class="tool-io-block" data-tool-index="${t}">${a("IN",
n)}${i?"":a("OUT",s)}</div>`}function wg(e){let t=String(e||"").replace(/\r\n/g,`
`);if(!t.trim())return null;let n=t.split(`
`),s=/^\s*(\d+)\s+file(?:\(s\)|s?)\s+changed(?:\s+in\s+this\s+conversation)?/i,a=n.findIndex(g=>s.test(g));if(a===-1)return null;
let i=n[a].trim(),c=i.match(s);if(!c)return null;let d=g=>{let w=String(g||"").match(/\+(\d+)\s+(?:\u00c2\u00b7|·|-|\s)\s*-?(\d+)/);
return w?{adds:Number(w[1])||0,dels:Number(w[2])||0}:null},f=d(i),h=null,b=[],N="",x=a;for(let g=a+1;g<n.length;g++){let w=n[g].
trim();if(!w)continue;if(!f){let te=d(w);if(te){f=te,x=g;continue}}let y=w.match(/^\+(\d+)$/);if(y){h=Number(y[1])||0,x=
g;continue}let E=w.match(/^-(\d+)$/);if(E&&h!=null&&!f){f={adds:h,dels:Number(E[1])||0},h=null,x=g;continue}let T=w.match(
/^\+(\d+)\s+(?:\u00c2\u00b7|·|-|\s)\s*-?(\d+)$/);if(T&&N){b.push({filepath:N,adds:Number(T[1])||0,dels:Number(T[2])||0}),
N="",x=g;continue}let H=w.match(/^(.+?)\s+\+(\d+)\s+(?:\u00c2\u00b7|·|-|\s)\s*-?(\d+)(?:\s+.*)?$/);if(!H){if(vr(w)){N=w,
x=g;continue}break}let K=H[1].trim();if(!K||/^\+?\d+$/.test(K))break;b.push({filepath:K,adds:Number(H[2])||0,dels:Number(
H[3])||0}),N="",x=g}if(b.length===0)return null;let S=f?.adds??b.reduce((g,w)=>g+w.adds,0),R=f?.dels??b.reduce((g,w)=>g+
w.dels,0),u=n.slice(0,a).join(`
`).replace(/\s+$/g,""),v=n.slice(x+1).join(`
`).replace(/^\s+/g,"");return{count:Number(c[1])||b.length,title:i.replace(/\s+\+\d+.*$/,"").trim(),adds:S,dels:R,entries:b,
beforeText:u,afterText:v}}function Ng(e,t){let n=e.entries.map(s=>`<div class="file-changes-item">
      <span class="file-changes-path">${je(s.filepath)}</span>
      <span class="file-changes-stats"><span class="diff-stat-add">+${s.adds}</span><span class="diff-stat-del">-${s.dels}\
</span></span>
    </div>`).join("");return`<section class="file-changes-section" data-file-changes-index="${t}">
    <button class="file-changes-toggle" type="button" aria-expanded="true">
      <span class="file-changes-chevron">v</span>
      <span class="file-changes-icon">files</span>
      <span class="file-changes-title">${je(e.title||`${e.count} file(s) changed`)}</span>
      <span class="file-changes-summary">
        <span class="diff-stat-add">+${e.adds}</span>
        <span class="diff-stat-del">-${e.dels}</span>
      </span>
    </button>
    ${e.entries.length?`<div class="file-changes-list">${n}</div>`:""}
  </section>`}function Sg(e,t){let n;try{n=JSON.parse(e)}catch{return null}if(!n||!Array.isArray(n.items)||!n.items.length)
return null;let s=n.title||"Subagents",a=n.items.map((i,c)=>{let d=String(i.status||"unknown").toLowerCase(),f=d==="runn\
ing"?'<span class="subagent-spinner" aria-hidden="true"></span>':d==="done"?'<span class="subagent-icon subagent-icon-do\
ne" aria-hidden="true">&#10003;</span>':d==="failed"?'<span class="subagent-icon subagent-icon-fail" aria-hidden="true">\
&#10007;</span>':'<span class="subagent-icon subagent-icon-unknown" aria-hidden="true">&#9679;</span>',h=String(i.prompt||
"").trim(),b=String(i.stats||"").trim(),N=Array.isArray(i.tool_calls)?i.tool_calls.filter(Boolean):[],x=N.length?`<ul cl\
ass="subagent-calls">${N.map(S=>`<li><code>${je(S)}</code></li>`).join("")}</ul>`:"";return`<li class="subagent-item sub\
agent-status-${je(d)}">
      <div class="subagent-row">${f}<div class="subagent-prompt" title="${je(h)}">${je(h)}</div></div>
      ${b?`<div class="subagent-stats">${je(b)}</div>`:""}
      ${x}
    </li>`}).join("");return`<section class="subagents-section" data-subagents-index="${t}">
    <div class="subagents-header"><span class="subagents-icon" aria-hidden="true">&#9783;</span><span class="subagents-t\
itle">${je(s)}</span></div>
    <ul class="subagents-list">${a}</ul>
  </section>`}function Cg(e){let t=String(e||"").match(/^Task Completed\s*\n+([\s\S]*?)\s*$/);return t?{content:t[1].replace(
/HAS_CHANGES\s*$/i,"").trimEnd(),wrap:!0}:{content:e,wrap:!1}}function xg(e){return`<section class="task-completed-secti\
on">
    <div class="task-completed-header">
      <span class="task-completed-icon" aria-hidden="true">&#10003;</span>
      <span class="task-completed-title">Task Completed</span>
    </div>
    <div class="task-completed-body">${e}</div>
  </section>`}function Ag(e){let t=[],n=/^~~~subagents\s*\n([\s\S]*?)\n~~~\s*$/gm;return{content:String(e||"").replace(n,
(a,i)=>{let c=Sg(i,t.length)||"";return t.push(c),`\0SUBAGENTS_BLOCK_${t.length-1}\0`}),blocks:t}}function Rg(e){let{content:t,
wrap:n}=Cg(e);e=t;let{content:s,blocks:a}=Ag(e);e=s;let c=rd(e).map((b,N)=>{try{if(b.type==="tool")return vg(b.name,b.content,
N);let x=pd(b.content);if(x)return md(x,N);let S=wg(b.content);if(S){let R=Ng(S,N),u=(S.beforeText||"").trim()?marked.parse(
S.beforeText):"",v=(S.afterText||"").trim()?marked.parse(S.afterText):"";return u+R+v}return(b.content||"").trim()?marked.
parse(b.content||""):""}catch(x){return'<pre style="color:var(--red,#f26d78);font-size:11px">[render error: '+je(String(
x))+"]</pre><pre>"+je(b.content||"")+"</pre>"}}).join("");a.length&&(c=c.replace(/\s*SUBAGENTS_BLOCK_(\d+)\s*/g,(b,N)=>a[Number(
N)]||""));let d=document.createElement("div");typeof DOMPurify<"u"?d.innerHTML=DOMPurify.sanitize(c,{ADD_DATA_URI_TAGS:[
"img"],ALLOW_DATA_ATTR:!0}):d.textContent=c;let h=Array.from(d.querySelectorAll(".diff-block")).map((b,N)=>{let x=b.querySelector(
".diff-filepath");if(!x)return null;let S=x.textContent.trim();if(!S)return null;let R=b.querySelector(".diff-stat-add, \
.tool-stat-add"),u=b.querySelector(".diff-stat-del, .tool-stat-del"),v=R&&parseInt(R.textContent,10)||0,g=u&&parseInt(u.
textContent,10)||0;return b.id=`diff-file-${N}`,{filepath:S,adds:v,dels:g,id:`diff-file-${N}`}}).filter(Boolean);if(h.length>=
2){let b=h.reduce((u,v)=>u+v.adds,0),N=h.reduce((u,v)=>u+v.dels,0),x=h.map(u=>{let v=u.filepath.split(/[/\\]/).pop();return`\
<a class="diff-summary-chip" data-target="${mn(u.id)}" href="#${mn(u.id)}" title="${mn(u.filepath)}"><span class="diff-s\
ummary-name">${je(v)}</span><span class="diff-stat-add">+${u.adds}</span><span class="diff-stat-del">-${u.dels}</span></\
a>`}).join(""),S=`<span class="diff-summary-totals"><span class="diff-summary-count">${h.length} files</span><span class\
="diff-stat-add">+${b}</span><span class="diff-stat-del">-${N}</span></span>`,R=document.createElement("div");R.className=
"diff-summary-bar",R.innerHTML=x+S,d.insertBefore(R,d.firstChild)}return n?xg(d.innerHTML):d.innerHTML}function Mg(e){let t=[],
n=0,s=document.createTreeWalker(e,NodeFilter.SHOW_TEXT,null),a;for(;a=s.nextNode();){if(a.parentElement&&a.parentElement.
classList.contains("code-line-num"))continue;let i=a.nodeValue.length;t.push({node:a,start:n,end:n+i}),n+=i}return{text:t.
map(i=>i.node.nodeValue).join(""),ranges:t}}function hi(e){if(!e)return;let t=e.querySelector("code");if(!t)return;t.querySelectorAll(
"mark.code-search-mark").forEach(s=>{let a=s.parentNode;a&&(a.replaceChild(document.createTextNode(s.textContent),s),a.normalize())});
let n=e.querySelector(".code-search-count");n&&(n.textContent=""),delete e._searchState}function Tg(e){if(!e)return;hi(e);
let t=e.querySelector(".code-search-input"),n=t?t.value:"";if(!n)return;let s=e.querySelector("code");if(!s)return;let{text:a,
ranges:i}=Mg(s),c=a.toLowerCase(),d=n.toLowerCase(),f=[],h=0;for(;h<a.length;){let x=c.indexOf(d,h);if(x===-1)break;f.push(
x),h=x+n.length}if(!f.length){let x=e.querySelector(".code-search-count");x&&(x.textContent="0 / 0");return}let b=[];for(let x=f.
length-1;x>=0;x--){let S=f[x],R=S+n.length,u=i.filter(v=>v.end>S&&v.start<R);for(let v=u.length-1;v>=0;v--){let g=u[v],w=Math.
max(0,S-g.start),y=Math.min(g.node.nodeValue.length,R-g.start),E=g.node,T=E.nodeValue,H=document.createElement("mark");H.
className="code-search-mark",H.textContent=T.slice(w,y);let K=E.parentNode;y<T.length&&K.insertBefore(document.createTextNode(
T.slice(y)),E.nextSibling),K.insertBefore(H,y<T.length?E.nextSibling.previousSibling:E.nextSibling),w>0?E.nodeValue=T.slice(
0,w):K.removeChild(E),b.unshift(H)}}e._searchState={marks:b,current:0};let N=e.querySelector(".code-search-count");N&&(N.
textContent=b.length?`1 / ${b.length}`:"0 / 0"),b.length&&(b[0].classList.add("current"),b[0].scrollIntoView({block:"nea\
rest"}))}function gi(e,t){if(!e||!e._searchState)return;let{marks:n}=e._searchState;if(!n.length)return;n[e._searchState.
current].classList.remove("current"),e._searchState.current=(e._searchState.current+t+n.length)%n.length;let s=n[e._searchState.
current];s.classList.add("current"),s.scrollIntoView({block:"nearest"});let a=e.querySelector(".code-search-count");a&&(a.
textContent=`${e._searchState.current+1} / ${n.length}`)}function $g(e){let t=[],n=0;for(;n<e.length;)(n===0||e[n-1]===`\

`)&&e[n]==="`"&&e[n+1]==="`"&&e[n+2]==="`"?(t.push(n),n+=3):n++;if(t.length%2===0)return null;let s=t[t.length-1],a=e.slice(
s+3),i=a.indexOf(`
`);if(i===-1)return{lang:"text",code:""};let d=a.slice(0,i).trim().split(/\s/)[0].toLowerCase()||"text",f=a.slice(i+1);return{
lang:d,code:f}}var br=new Map,mo=null,zs=new Map,Wc=0,Eg=256,Lg=8*1024*1024;function qg(e){let t=String(e||""),n=2166136261;
for(let s=0;s<t.length;s+=1)n^=t.charCodeAt(s),n=Math.imul(n,16777619);return(n>>>0).toString(36)}function Pg(e,t){let n=e?.
closest?.(".message")||e;if(!n||typeof IntersectionObserver>"u")return t(),()=>{};mo||(mo=new IntersectionObserver(a=>{for(let i of a){
if(!i.isIntersecting)continue;let c=br.get(i.target);if(c){br.delete(i.target),mo.unobserve(i.target);for(let d of c)d()}}},
{root:null,rootMargin:"35% 0px",threshold:0}));let s=br.get(n);return s||(s=new Set,br.set(n,s),mo.observe(n)),s.add(t),
()=>{let a=br.get(n);a&&(a.delete(t),!(a.size>0)&&(br.delete(n),mo?.unobserve(n)))}}function Ig(e,t){let n=String(e||""),
s=`${t||"content"}${n.length}${qg(n)}`,a=zs.get(s);if(a&&a.content===n)return zs.delete(s),zs.set(s,a),a.html;let i=Rg(
n),c=typeof DOMPurify<"u"?DOMPurify.sanitize(i,{ADD_DATA_URI_TAGS:["img"],ALLOW_DATA_ATTR:!0}):i,d=(n.length+c.length)*2;
for(zs.set(s,{content:n,html:c,bytes:d}),Wc+=d;zs.size>Eg||Wc>Lg;){let f=zs.keys().next().value,h=zs.get(f);zs.delete(f),
Wc-=h?.bytes||0}return c}function yr({content:e,monospace:t=!1,onOpenPath:n=null,autoExpandLongCodeBlocks:s=!1,deferUntilVisible:a=!1,
cacheIdentity:i=""}){let c=React.useRef(null),d=React.useRef(null),f=React.useRef(n),[h,b]=React.useState(!a);return f.current=
n,React.useEffect(()=>{if(!a){b(!0);return}if(!h)return Pg(c.current,()=>b(!0))},[a,h]),React.useEffect(()=>{if(!c.current||
!h||e===d.current)return;let N=d.current;if(N!==null&&e.startsWith(N)){let u=$g(e);if(u&&!zc(u.code)){let v=c.current.querySelectorAll(
".code-block:not(.diff-block)"),w=(v.length>0?v[v.length-1]:null)?.querySelector(":scope > pre"),y=w?.querySelector("cod\
e");if(y){let E=w.scrollTop,T;try{T=typeof hljs<"u"&&hljs.getLanguage(u.lang)?hljs.highlight(u.code,{language:u.lang}).value:
je(u.code)}catch{T=je(u.code)}y.innerHTML=id(T),y.dataset.raw=u.code,w.scrollTop=E,d.current=e;return}}}let x={toolCollapsed:{},
fileChangesCollapsed:{},codeScroll:[],ctxHidden:{},ctxCollapseActive:{}};d.current!==null&&(c.current.querySelectorAll("\
.tool-section[data-tool-index]").forEach(u=>{x.toolCollapsed[u.dataset.toolIndex]=u.classList.contains("collapsed")}),c.
current.querySelectorAll(".file-changes-section[data-file-changes-index]").forEach(u=>{x.fileChangesCollapsed[u.dataset.
fileChangesIndex]=u.classList.contains("collapsed")}),c.current.querySelectorAll(".code-block pre").forEach((u,v)=>{x.codeScroll[v]=
u.scrollTop}),c.current.querySelectorAll(".diff-block, .tool-diff-block").forEach((u,v)=>{u.querySelectorAll(".diff-hunk\
-btn").forEach(w=>{x.ctxHidden[`${v}:${w.dataset.hunkId}`]=w.classList.contains("diff-hunk-ctx-collapsed")});let g=u.querySelector(
".diff-ctx-collapse-all");g&&(x.ctxCollapseActive[v]=g.classList.contains("active"))})),d.current=e,c.current.innerHTML=
Ig(e,i),c.current.querySelectorAll(".tool-section[data-tool-index]").forEach(u=>{let v=u.dataset.toolIndex;if(!(v in x.toolCollapsed))
return;let g=x.toolCollapsed[v],w=u.classList.contains("collapsed");if(g!==w){u.classList.toggle("collapsed",g);let y=u.
querySelector(".tool-body"),E=u.querySelector(".tool-chevron"),T=u.querySelector(".tool-toggle");y&&(y.hidden=g),E&&(E.textContent=
g?"\u25B8":"\u25BE"),T&&T.setAttribute("aria-expanded",g?"false":"true")}}),c.current.querySelectorAll(".file-changes-se\
ction[data-file-changes-index]").forEach(u=>{let v=u.dataset.fileChangesIndex;if(!(v in x.fileChangesCollapsed))return;let g=x.
fileChangesCollapsed[v],w=u.classList.contains("collapsed");if(g!==w){u.classList.toggle("collapsed",g);let y=u.querySelector(
".file-changes-list"),E=u.querySelector(".file-changes-chevron"),T=u.querySelector(".file-changes-toggle");y&&(y.hidden=
g),E&&(E.textContent=g?">":"v"),T&&T.setAttribute("aria-expanded",g?"false":"true")}}),c.current.querySelectorAll(".diff\
-block, .tool-diff-block").forEach((u,v)=>{let g=u.querySelector("code");if(g&&(u.querySelectorAll(".diff-hunk-btn").forEach(
w=>{let y=`${v}:${w.dataset.hunkId}`;!(y in x.ctxHidden)||!x.ctxHidden[y]||(g.querySelectorAll(`[data-hunk-ctx="${w.dataset.
hunkId}"].diff-ctx`).forEach(E=>E.classList.add("diff-ctx-hidden")),w.classList.add("diff-hunk-ctx-collapsed"))}),x.ctxCollapseActive[v])){
let w=u.querySelector(".diff-ctx-collapse-all");w&&w.classList.add("active")}}),c.current.querySelectorAll(".code-copy").
forEach(u=>{u.onclick=()=>{let v=u.closest(".code-block").querySelector("code"),g=v.dataset.raw!==void 0?v.dataset.raw:v.
textContent;navigator.clipboard.writeText(g).then(()=>{u.querySelector(".copy-icon").style.display="none",u.querySelector(
".check-icon").style.display="",u.querySelector(".copy-label").textContent="Copied",u.classList.add("copied"),setTimeout(
()=>{u.querySelector(".copy-icon").style.display="",u.querySelector(".check-icon").style.display="none",u.querySelector(
".copy-label").textContent="Copy",u.classList.remove("copied")},2e3)}).catch(()=>{})}}),c.current.querySelectorAll(".too\
l-toggle").forEach(u=>{u.onclick=()=>{let v=u.closest(".tool-section"),g=v?.querySelector(".tool-body"),w=u.querySelector(
".tool-chevron"),y=v.classList.toggle("collapsed");g&&(g.hidden=y),w&&(w.textContent=y?"\u25B8":"\u25BE"),u.setAttribute(
"aria-expanded",y?"false":"true")}}),c.current.querySelectorAll(".file-changes-toggle").forEach(u=>{u.onclick=()=>{let v=u.
closest(".file-changes-section"),g=v?.querySelector(".file-changes-list"),w=u.querySelector(".file-changes-chevron"),y=v.
classList.toggle("collapsed");g&&(g.hidden=y),w&&(w.textContent=y?">":"v"),u.setAttribute("aria-expanded",y?"false":"tru\
e")}}),c.current.querySelectorAll(".tool-io-more-btn").forEach(u=>{u.onclick=()=>{let v=u.closest(".tool-io-preview"),g=v?.
nextElementSibling;!v||!g||(v.hidden=!0,g.hidden=!1)}}),c.current.querySelectorAll(".tool-io-collapse-btn").forEach(u=>{
u.onclick=()=>{let v=u.closest(".tool-io-full"),g=v?.previousElementSibling;!v||!g||(v.hidden=!0,g.hidden=!1)}}),c.current.
querySelectorAll(".diff-summary-chip").forEach(u=>{u.onclick=v=>{v.preventDefault();let g=u.dataset.target,w=g&&c.current.
querySelector(`#${CSS.escape(g)}`);w&&(w.scrollIntoView({behavior:"smooth",block:"nearest"}),c.current.querySelectorAll(
".diff-summary-chip").forEach(y=>y.classList.remove("active")),u.classList.add("active"))}}),c.current.querySelectorAll(
".diff-split-toggle").forEach(u=>{u.onclick=()=>{let v=u.closest(".diff-block");if(!v)return;let g=v.querySelector(":sco\
pe > pre"),w=v.querySelector(".diff-split"),E=!(v.dataset.diffMode==="split");v.dataset.diffMode=E?"split":"unified",u.classList.
toggle("active",E),u.title=E?"Toggle unified view":"Toggle side-by-side view"}}),c.current.querySelectorAll(".diff-filep\
ath[data-copy-path], .tool-open-file[data-open-path], .inline-file-ref[data-open-path]").forEach(u=>{u.onclick=v=>{v.stopPropagation();
let g=u.dataset.openPath||u.dataset.copyPath,w=f.current;if(g&&typeof w=="function"){v.preventDefault(),w(g);return}u.dataset.
copyPath&&navigator.clipboard.writeText(g).then(()=>{let y=u.textContent;u.textContent="Copied!",u.classList.add("diff-f\
ilepath-copied"),setTimeout(()=>{u.textContent=y,u.classList.remove("diff-filepath-copied")},1500)}).catch(()=>{})}}),c.
current.querySelectorAll(".code-expand-toggle").forEach(u=>{u.onclick=()=>{let v=u.closest(".code-block");if(!v)return;let g=v.
classList.toggle("code-expanded");u.textContent=g?"Collapse":"Expand",u.title=g?"Collapse block":"Expand block",g||v.scrollIntoView(
{behavior:"smooth",block:"nearest"})}}),s&&c.current.querySelectorAll(".code-collapsible").forEach(u=>{u.classList.add("\
code-expanded");let v=u.querySelector(".code-expand-toggle");v&&(v.textContent="Collapse",v.title="Collapse block")}),c.
current.querySelectorAll(".code-wrap-toggle").forEach(u=>{u.onclick=()=>{let v=localStorage.getItem("codeblock_wrap_pref")!==
"1";localStorage.setItem("codeblock_wrap_pref",v?"1":"0"),c.current.querySelectorAll(".code-block").forEach(g=>{g.classList.
toggle("code-wrap",v);let w=g.querySelector(".code-wrap-toggle");w&&(w.textContent=v?"No Wrap":"Wrap",w.title=v?"Disable\
 word wrap":"Enable word wrap",w.classList.toggle("active",v))})}}),c.current.querySelectorAll(".code-search-btn").forEach(
u=>{u.onclick=()=>{let v=u.closest(".code-block");if(!v)return;let g=v.querySelector(".code-search-bar"),w=v.querySelector(
".code-search-input");if(!g)return;!g.hidden?(hi(v),g.hidden=!0,u.classList.remove("active")):(g.hidden=!1,u.classList.add(
"active"),w&&w.focus())}}),c.current.querySelectorAll(".code-search-input").forEach(u=>{u.oninput=()=>Tg(u.closest(".cod\
e-block")),u.onkeydown=v=>{let g=u.closest(".code-block");v.key==="Enter"&&(v.shiftKey?gi(g,-1):gi(g,1),v.preventDefault()),
v.key==="Escape"&&(hi(g),g.querySelector(".code-search-bar").hidden=!0,g.querySelector(".code-search-btn").classList.remove(
"active"))}}),c.current.querySelectorAll(".code-search-next").forEach(u=>{u.onclick=()=>gi(u.closest(".code-block"),1)}),
c.current.querySelectorAll(".code-search-prev").forEach(u=>{u.onclick=()=>gi(u.closest(".code-block"),-1)}),c.current.querySelectorAll(
".code-search-close").forEach(u=>{u.onclick=()=>{let v=u.closest(".code-block");hi(v),v.querySelector(".code-search-bar").
hidden=!0,v.querySelector(".code-search-btn").classList.remove("active")}}),c.current.querySelectorAll(".diff-hunk-btn").
forEach(u=>{u.onclick=v=>{v.stopPropagation();let g=u.dataset.hunkId,w=u.closest("code");if(!w)return;let y=w.querySelectorAll(
`[data-hunk-ctx="${g}"].diff-ctx`),E=y.length>0&&y[0].classList.contains("diff-ctx-hidden");y.forEach(T=>T.classList.toggle(
"diff-ctx-hidden",!E)),u.classList.toggle("diff-hunk-ctx-collapsed",!E)},u.onkeydown=v=>{(v.key==="Enter"||v.key===" ")&&
(v.preventDefault(),u.click())}}),c.current.querySelectorAll(".diff-ctx-collapse-all").forEach(u=>{u.onclick=()=>{let v=u.
closest(".diff-block, .tool-diff-block");if(!v)return;let g=v.querySelector("code");if(!g)return;let w=g.querySelectorAll(
".diff-ctx"),E=Array.from(w).some(T=>!T.classList.contains("diff-ctx-hidden"));w.forEach(T=>T.classList.toggle("diff-ctx\
-hidden",E)),g.querySelectorAll(".diff-hunk-btn").forEach(T=>T.classList.toggle("diff-hunk-ctx-collapsed",E)),u.classList.
toggle("active",E),u.title=E?"Expand all context lines":"Collapse all context lines"}}),c.current.querySelectorAll(".too\
l-show-all").forEach(u=>{u.onclick=()=>{let g=u.closest(".tool-body")?.querySelector("code"),w=u.closest(".tool-section");
if(!g||!w)return;let y=Number(w.dataset.toolIndex||"-1"),E=rd(e||"")[y];!E||E.type!=="tool"||(g.textContent=E.content||"",
u.remove())}}),x.codeScroll.length&&c.current.querySelectorAll(".code-block pre").forEach((u,v)=>{v<x.codeScroll.length&&
x.codeScroll[v]>0&&(u.scrollTop=x.codeScroll[v])});let S=null,R=c.current.querySelector(".diff-summary-bar");if(R&&typeof IntersectionObserver<
"u"){let u=Array.from(c.current.querySelectorAll(".diff-block[id]"));if(u.length>=2){let v=null,g=c.current.parentElement;
for(;g&&g!==document.body;){let y=window.getComputedStyle(g);if(y.overflowY==="auto"||y.overflowY==="scroll"||y.overflow===
"auto"||y.overflow==="scroll"){v=g;break}g=g.parentElement}let w=new IntersectionObserver(y=>{y.forEach(E=>{if(!E.isIntersecting)
return;let T=E.target.id;R.querySelectorAll(".diff-summary-chip").forEach(H=>{H.classList.toggle("active",H.dataset.target===
T)})})},{root:v,threshold:.1});u.forEach(y=>w.observe(y)),S=()=>w.disconnect()}}return()=>{S&&S()}},[e,s,i,h]),React.createElement(
"div",{className:`message-body${t?" monospace-body":""}`,ref:c,"data-rich-content-ready":h?"true":"false"})}function Vc(e,t=null,n=Date.now()){return{sessionId:e,messageId:null,blockIndex:0,seq:-1,content:"",open:!0,startedAtMs:n,
clientMessageId:t}}function fd(e,t,n=!1){if(!e||String(e.content||"").length>0||n)return!1;let s=String(t?.kind||"idle").
toLowerCase();return["idle","waiting_for_user","completed","done","failed","error","interrupted"].includes(s)}function gd(e,t,n=Date.
now()){let s=t?.session_id||t?.session||"",a=t?.message_id||"",i=Number(t?.block_index),c=Number(t?.seq);return!s||!a||!Number.
isSafeInteger(i)||i<0||!Number.isSafeInteger(c)||c<0?{accepted:!1,code:"invalid_identity",stream:e||null}:t.op==="block_\
open"?c!==0?{accepted:!1,code:"invalid_open_sequence",stream:e||null}:{accepted:!0,stream:{...Vc(s,e?.clientMessageId||null,
e?.startedAtMs||n),messageId:a,blockIndex:i,seq:c}}:!e||e.messageId!==a||e.blockIndex!==i||!e.open?{accepted:!1,code:"st\
ream_not_open",stream:e||null}:c!==e.seq+1?{accepted:!1,code:"sequence_gap",stream:e}:t.op==="append"?typeof t.append!="\
string"||t.append.length===0?{accepted:!1,code:"invalid_append",stream:e}:{accepted:!0,stream:{...e,seq:c,content:`${e.content||
""}${t.append}`}}:t.op==="block_close"?{accepted:!0,stream:{...e,seq:c,open:!1}}:{accepted:!1,code:"invalid_operation",stream:e}}function Qn(e){if(e==null||e==="")return null;let t=null;if(typeof e=="number"||typeof e=="string"&&/^\d+(?:\.\d+)?$/.test(
e.trim())){let s=Number(e);Number.isFinite(s)&&s>0&&(t=s>1e12?s:s*1e3)}else{let s=Date.parse(String(e));Number.isFinite(
s)&&s>0&&(t=s)}if(!Number.isFinite(t)||t<=0)return null;let n=new Date(t);return Number.isNaN(n.getTime())?null:{epoch_ms:n.
getTime(),epoch_seconds:n.getTime()/1e3,iso:n.toISOString()}}function kr(e){return!e||typeof e!="object"?null:Qn(e.created_at)||
Qn(e.timestamp)||Qn(e.ts)||null}function wr(e){if(!e||typeof e!="object")return e;let t=kr(e);return!t||e.timestamp===t.
iso&&e.timestamp_ms===t.epoch_ms&&Number(e.ts)===t.epoch_seconds?e:{...e,ts:t.epoch_seconds,timestamp:t.iso,timestamp_ms:t.
epoch_ms}}function _d(e){if(!Array.isArray(e))return[];let t=!1,n=e.map(s=>{let a=wr(s);return a!==s&&(t=!0),a});return t?
n:e}function hd(e,t){return new Intl.DateTimeFormat("en-US-u-ca-gregory",{year:"numeric",...t?{timeZone:t}:{}}).format(e)}
function Kc(e,t=new Date,n=void 0,s=void 0){let a=e&&typeof e=="object"&&Number.isFinite(e.epoch_ms)?e:Qn(e);if(!a)return"";
let i=new Date(a.epoch_ms),c={...hd(i,s)===hd(t,s)?{}:{year:"numeric"},month:"short",day:"numeric",hour:"numeric",minute:"\
2-digit",...s?{timeZone:s}:{}};return new Intl.DateTimeFormat(n,c).format(i)}function bd(e,t=void 0,n=void 0){let s=e&&typeof e==
"object"&&Number.isFinite(e.epoch_ms)?e:Qn(e);return s?`${new Intl.DateTimeFormat(t,{dateStyle:"full",timeStyle:"long",...n?
{timeZone:n}:{}}).format(new Date(s.epoch_ms))} (${s.iso})`:""}function vd(){let e=new Map,t=2048,n="";return{reset(s=""){let a=String(s||"");a!==n&&(n=a,e.clear())},accept(s,a){let i=Number(
s?.state_seq);if(!Number.isSafeInteger(i)||i<0)return!0;let c=String(s?.state_epoch||n||"legacy");if(n&&c!==n)return!1;n||
(n=c);let d=String(a||s?.type||"state"),f=e.get(d);if(f?.epoch===c&&i<=f.seq)return!1;for(e.has(d)&&e.delete(d),e.set(d,
{epoch:c,seq:i});e.size>t;)e.delete(e.keys().next().value);return!0},size(){return e.size}}}var _i=/(?:!\[[^\]]*\]\([^)]*\)|\[File:\s*[^\]]+\]|\b(?:image|screenshot|screen\s*shot|capture)[\w .()[\]-]*\.(?:png|jpe?g|gif|webp|bmp|svg)\b)/gi,
bi=/(?:[A-Za-z]:[\\/]|\\\\[^\\/\s]+[\\/]|\/(?:Users|home|mnt|var|tmp|etc|opt|workspace|workspaces)\/)[^\s"'`<>)]{2,}/gi,
Og=/^(?=.*\d)(?:(?:\d+)\s*d\s*)?(?:(?:\d+)\s*h\s*)?(?:(?:\d+)\s*m\s*)?(?:(?:\d+)\s*s)?$/i,Dg=/^[+-]?\d+\s*[dhms]\b/i,jg=/^(?:just now|today|yesterday|(?:\d+|an?|one)\s+(?:seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?)\s+ago)$/i,
Bg=/^(?:pursuing goal|paused goal|goal (?:paused|blocked|usage limited|rate limited|limited|budget limited|achieved|cancelled|canceled|stopped|failed)|idle|ready|connected|awaiting live update)$/i,
Fg=/^(?:no (?:recent message|current work|data|activity)(?: reported)?|unavailable|unknown|not available)$/i,Hg=/^(?:(?:antigravity|claude(?: code)?|cline|codex|continue|cursor|gemini|roo code)\s+(?:harness|workspace))$/i,
yd=new Set(["agent","agentmanager","agentsession","antigravity","antigravitychat","antigravityv2","claude","claudecli","\
claudecode","claudecodecli","claudedesktop","cline","codex","codexcli","codexdesktop","connected","connectedsession","co\
ntinue","continueyolo","cursor","cursoragent","cursorcli","cursoride","gemini","geminicodeassist","newchat","newconversa\
tion","other","proceed","resume","roocode","session","unknown","attachment","file","image","screenshot","disregardthatla\
stmessage","ignorethatlastmessage"]);function Nr(e){return typeof e=="string"?e:Array.isArray(e)?e.map(Nr).filter(Boolean).
join(`
`):!e||typeof e!="object"?"":Nr(e.text||e.content||e.markdown||e.value||"")}function Yc(){_i.lastIndex=0,bi.lastIndex=0}
function Ug(e){let t=Nr(e).replace(/\s+/g," ").trim();return t?Og.test(t)?"duration_only":Dg.test(t)?"duration_malformed":
jg.test(t)?"age_only":Bg.test(t)?"status_only":Fg.test(t)?"placeholder_only":Hg.test(t)?"surface_label_only":"":"empty"}
function Vs(e){let t=Nr(e).replace(/\s+/g," ").trim();if(!t||Ug(t)||/^\[(?:attachment|file|image|screenshot)(?:\s*:[^\]]*)?\]$/i.
test(t)||/^new\s+(?:antigravity|claude|codex|continue|cursor|gemini|roo)(?:\s+(?:agent|chat|cli|code|desktop|ide|panel))*\s+(?:chat|conversation|session|thread)$/i.
test(t))return!0;let n=_i.test(t)||bi.test(t);if(Yc(),n){let a=t.replace(_i," ").replace(bi," ").replace(/\b(?:read|open|view|inspect|check|review|show|load|attach|attached|upload|uploaded|file|image|screenshot)\b/gi,
" ").replace(/[^a-z0-9]+/gi,"").trim();if(Yc(),a.length<12)return!0}let s=t.toLowerCase().replace(/[^a-z0-9]+/g,"").replace(
/^remoteagent(?:chat)?/,"");return s?yd.has(s)?!0:(s=s.replace(/(?:new|production|session|chat|smoke|test|probe|verification|fixture|extension|ext|ide|app|panel|pane)$/g,
""),yd.has(s)):!/[\p{L}\p{N}]/u.test(t)}function Nd(e){let t=Nr(e);if(!t)return"";let n=t.replace(/<goal_context>[\s\S]*?<\/goal_context>/gi,
" ").replace(/```[\s\S]*?```/g," ").replace(_i," ").replace(bi," ").replace(/<[^>\n]{1,120}>/g," ").replace(/`([^`]+)`/g,
"$1").replace(/^\s*(?:user|assistant|codex|claude|tool result)\s*[:\-]\s*/i,"").replace(/\s+/g," ").trim();return Yc(),!n||
Vs(n)||/^(?:thinking|working|tool result|tool:|exit code|wall time|read|open|view|inspect|check|review|show|load|attach|attached|uploaded|file|image|screenshot)\b/i.
test(n)&&n.split(/\s+/).length<=4||/^[^\p{L}\p{N}]+$/u.test(n)?"":n.slice(0,80).trim()}function Gg(e){let t=Array.isArray(
e)?e:[];for(let n of t){if(String(n?.role||"").toLowerCase()!=="user")continue;let s=Nd(n?.content||n?.content_blocks);if(s)
return s}return""}var kd=Object.freeze({fallback:0,route:.5,message:1,summary:2,custom:3,native:4}),Wg=Object.freeze(["c\
odex_desktop_active_thread_title","cursor_agent_title","native_chat_title","session_title","thread_title","conversation_\
title","title","display_title","summary","chat_title","chat_title_source","thread_name","conversation_name","custom_disp\
lay_name","is_new_chat_draft","is_list_view"]);function wd(e){return Nr(e).replace(/\s+/g," ").trim()}function Sd(e){return!e||
typeof e!="object"?{}:Object.fromEntries(Wg.filter(t=>Object.prototype.hasOwnProperty.call(e,t)).map(t=>[t,e[t]]))}function Xc(e,t="",n=[],s=""){
let a=e&&typeof e=="object"?e:{},c=[["codex_desktop_active_thread_title",a.codex_desktop_active_thread_title],["cursor_a\
gent_title",a.cursor_agent_title],["native_chat_title",a.native_chat_title],["session_title",a.session_title],["thread_t\
itle",a.thread_title],["conversation_title",a.conversation_title],["title",a.title],["display_title",a.display_title],["\
chat_title",a.chat_title_source==="summary"?"":a.chat_title],["thread_name",a.thread_name],["conversation_name",a.conversation_name]].
map(([N,x])=>({field:N,title:wd(x)})).find(N=>N.title&&!Vs(N.title));if(c)return{title:c.title.slice(0,80).trim(),source:"\
native",field:c.field};let d=wd(t);if(d&&!Vs(d))return{title:d.slice(0,80).trim(),source:"custom",field:"custom_display_\
name"};let h=[["chat_title",a.chat_title_source==="summary"?a.chat_title:""],["summary",a.summary],["derived_message_tit\
le",s]].map(([N,x])=>({field:N,title:Nd(x)})).find(N=>N.title);if(h)return{title:h.title,source:"summary",field:h.field};
let b=Gg(n);return b?{title:b,source:"message",field:"first_meaningful_user_message"}:{title:"New chat",source:"fallback",
field:"new_chat"}}function Cd(e,t){if(!e?.title)return t;if(!t?.title)return e;let n=kd[e.source]??0;return(kd[t.source]??
0)>=n?t:e}function xd(e,t="",n=[],s=""){return Xc(e,t,n,s).title}var zg=/(?:\bbearer\s+[a-z0-9._~+/=-]{8,}|\b(?:api[_ -]?key|password|passwd|secret|access[_ -]?token|refresh[_ -]?token)\s*[:=]\s*\S+|\bsk-[a-z0-9_-]{8,})/i,
Vg=/(?:[A-Za-z]:[\\/]|\\\\[^\\/\s]+[\\/]|\/(?:Users|home|mnt|var|tmp|etc|opt|workspace|workspaces)\/)[^\s"'<>)]{2,}/i;function Kg(e){
let t=0;for(let n of String(e||"")){let s=n.codePointAt(0);t+=s<=127?1:s<=2047?2:s<=65535?3:4}return t}function $n(e,t=96){
if(typeof e!="string"&&typeof e!="number")return"";let n=String(e).replace(/[\u0000-\u001f\u007f]+/g," ").replace(/\s+/g,
" ").trim();return!n||zg.test(n)||Vg.test(n)?"":n.slice(0,t).trim()}function vi(e){if(e==null||e==="")return null;let t=typeof e==
"number"&&Number.isFinite(e)?e:NaN,n=Number.isFinite(t)?t>0&&t<1e12?t*1e3:t:Date.parse(String(e));return Number.isFinite(
n)&&n>0?new Date(n).toISOString():null}function Yg(e){let t=String(e||"").trim().toLowerCase().replace(/[^a-z]/g,"");return{
active:"active",paused:"paused",blocked:"blocked",usagelimited:"usageLimited",ratelimited:"usageLimited",budgetlimited:"\
budgetLimited",complete:"complete",completed:"complete",cancelled:"cancelled",canceled:"cancelled",failed:"failed",idle:"\
idle",working:"working"}[t]||null}function Qc(e){if(!e||typeof e!="object"||Number(e.schema_version)!==1)return null;let t={
schema_version:1,parser_version:$n(e.parser_version,32)||"fleet-summary-v1",session_key:$n(e.session_key,40),session_generation:Math.
max(1,Number(e.session_generation)||1),thread_key:$n(e.thread_key,40),thread_generation:Math.max(1,Number(e.thread_generation)||
1),producer_seq:Math.max(0,Number(e.producer_seq)||0),summary_seq:Math.max(0,Number(e.summary_seq)||0),title:$n(e.title,
80)||null,title_source:$n(e.title_source,24)||null,title_confidence:["authoritative","derived","unknown"].includes(e.title_confidence)?
e.title_confidence:"unknown",latest_user_request:$n(e.latest_user_request)||null,latest_user_request_at:vi(e.latest_user_request_at),
current_work:$n(e.current_work)||null,current_work_source:$n(e.current_work_source,32)||null,current_work_kind:$n(e.current_work_kind,
24)||null,current_work_state:Yg(e.current_work_state),current_work_at:vi(e.current_work_at),last_role:["user","assistant"].
includes(e.last_role)?e.last_role:null,last_message_at:vi(e.last_message_at),last_snippet:$n(e.last_snippet)||null,message_count:Math.
max(0,Number(e.message_count)||0),user_count:Math.max(0,Number(e.user_count)||0),assistant_count:Math.max(0,Number(e.assistant_count)||
0),other_count:Math.max(0,Number(e.other_count)||0),role_imbalance:["balanced","assistant_without_user","user_without_as\
sistant"].includes(e.role_imbalance)?e.role_imbalance:"balanced",rejected_candidate_reason:$n(e.rejected_candidate_reason,
48)||null,fresh_at:vi(e.fresh_at)};return!t.session_key||!t.thread_key||Kg(JSON.stringify(t))>1024?null:t}function Ad(e){
return e?.title_confidence==="authoritative"?3:e?.title_confidence==="derived"?2:e?.title?1:0}function Rd(e,t){let n=Qc(
e),s=Qc(t);if(!s)return{summary:n,accepted:!1,changed:!1,reason:"invalid"};if(!n)return{summary:{...s,summary_seq:Math.max(
1,s.summary_seq)},accepted:!0,changed:!0,reason:"initial"};if(s.session_generation<n.session_generation)return{summary:n,
accepted:!1,changed:!1,reason:"older_session_generation"};if(s.session_generation===n.session_generation&&s.session_key!==
n.session_key)return{summary:n,accepted:!1,changed:!1,reason:"session_identity_mismatch"};if(s.session_generation===n.session_generation&&
s.thread_generation<n.thread_generation)return{summary:n,accepted:!1,changed:!1,reason:"older_thread_generation"};if(s.session_generation===
n.session_generation&&s.thread_generation===n.thread_generation&&s.thread_key!==n.thread_key)return{summary:n,accepted:!1,
changed:!1,reason:"thread_identity_mismatch"};let a=s.session_generation>n.session_generation||s.thread_generation>n.thread_generation,
i=s.producer_seq>n.producer_seq||s.producer_seq===n.producer_seq&&s.summary_seq>n.summary_seq;if(!a&&!i)return{summary:n,
accepted:!1,changed:!1,reason:"replayed_or_out_of_order"};let c=a?{...s}:{...n,...s};if(!a){(!s.title||Ad(s)<Ad(n))&&(c.
title=n.title,c.title_source=n.title_source,c.title_confidence=n.title_confidence);for(let f of["latest_user_request","l\
atest_user_request_at","current_work","current_work_source","current_work_kind","current_work_state","current_work_at","\
last_role","last_message_at","last_snippet","fresh_at"])(s[f]==null||s[f]==="")&&(c[f]=n[f]);for(let f of["message_count",
"user_count","assistant_count","other_count"])c[f]=Math.max(n[f]||0,s[f]||0)}c.summary_seq=Math.max(n.summary_seq||0,s.summary_seq||
0);let d=JSON.stringify(n)!==JSON.stringify(c);return{summary:d?c:n,accepted:!0,changed:d,reason:d?"upgraded":"unchanged"}}
function Md(e){let t=Qc(e);if(!t)return{};let n=t.current_work?{kind:t.current_work_kind||"activity",label:t.current_work_kind===
"goal"?"Goal":t.current_work_kind==="request"?"Request":"Current work",text:t.current_work,source:t.current_work_source||
"fleet_summary",updated_at:t.current_work_at,...t.current_work_state?{state:t.current_work_state}:{}}:null;return{fleet_summary:t,
...t.title?{chat_title:t.title,chat_title_source:t.title_source}:{},...t.latest_user_request?{last_user_request:{text:t.
latest_user_request,updated_at:t.latest_user_request_at}}:{},...t.last_snippet?{last_snippet:t.last_snippet,last_message_at:t.
last_message_at}:{},...n?{fleet_work_context:n}:{}}}var Td=new Set(["__proto__","constructor","prototype"]);function $d(e){return typeof e=="string"?e:e?.session_id||e?.id||
""}function fn(e,t){if(Object.is(e,t))return!0;if(e==null||t==null||typeof e!=typeof t||typeof e!="object")return!1;if(Array.
isArray(e)||Array.isArray(t)){if(!Array.isArray(e)||!Array.isArray(t)||e.length!==t.length)return!1;for(let a=0;a<e.length;a+=
1)if(!fn(e[a],t[a]))return!1;return!0}let n=Object.keys(e),s=Object.keys(t);if(n.length!==s.length)return!1;for(let a of n)
if(!Object.prototype.hasOwnProperty.call(t,a)||!fn(e[a],t[a]))return!1;return!0}function yi(e=[]){let t=[],n=[],s=Object.
create(null),a=Object.create(null);for(let i of Array.isArray(e)?e:[]){let c=$d(i);if(!c||Object.prototype.hasOwnProperty.
call(s,c))continue;a[c]=t.length,n.push(c);let d=Zc(null,i);s[c]=d,t.push(d)}return{byId:s,indexById:a,order:n,list:t}}function Jc(e){
return e?.is_new_chat_draft===!0}function Zc(e,t){if(!t||typeof t!="object")return t;if(Jc(t)){let i={...t};for(let c of[
"fleet_summary","fleet_work_context","last_user_request","last_snippet","last_message_at"])delete i[c];return i}let n=Rd(
e?.fleet_summary,t.fleet_summary).summary;if(!n)return t;let s=Md(n),a={...t,...s};return s.fleet_work_context&&a.activity&&
typeof a.activity=="object"&&!a.activity.work_context&&(a.activity={...a.activity,work_context:s.fleet_work_context}),a}
function Ed(e,t){return!e||typeof e!="object"||!t||typeof t!="object"||Jc(t)||Vs(e.chat_title)||!Vs(t.chat_title)?t:{...t,
chat_title:e.chat_title,chat_title_source:e.chat_title_source||t.chat_title_source||null}}function fo(e,t){let n=e?.byId?
e:yi(),s=Array.isArray(t)?t:[],a=[],i=[],c=Object.create(null),d=Object.create(null),f=s.length!==n.list.length;for(let h of s){
let b=$d(h);if(!b||Object.prototype.hasOwnProperty.call(c,b))continue;let N=n.byId[b],x=Ed(N,Zc(N,h)),S=N!==void 0&&fn(N,
x)?N:x;d[b]=a.length,i.push(b),c[b]=S,a.push(S),(!Object.is(S,N)||n.order[a.length-1]!==b)&&(f=!0)}return(a.length!==s.length||
a.length!==n.list.length)&&(f=!0),f?{byId:c,indexById:d,order:i,list:a}:n}function Ld(e,t){let n=e?.byId?e:yi(),s=t?.session_id||
t?.session||"";if(!s||!Object.prototype.hasOwnProperty.call(n.byId,s))return n;let a=n.byId[s],i=a&&typeof a=="object"?a:
{session_id:s},c=t?.patch&&typeof t.patch=="object"?t.patch:{},d=Array.isArray(t?.removed_fields)?t.removed_fields:[],f=Jc(
c),h=!f&&!Vs(i.chat_title)&&(!Object.prototype.hasOwnProperty.call(c,"chat_title")||Vs(c.chat_title)),b=i;for(let[R,u]of Object.
entries(c))Td.has(R)||R==="session_id"||R==="id"||h&&(R==="chat_title"||R==="chat_title_source")||fn(b[R],u)||(b===i&&(b=
{...i}),b[R]=u);for(let R of d)typeof R!="string"||Td.has(R)||R==="session_id"||R==="id"||h&&(R==="chat_title"||R==="cha\
t_title_source")||Object.prototype.hasOwnProperty.call(b,R)&&(b===i&&(b={...i}),delete b[R]);if(f&&!Object.prototype.hasOwnProperty.
call(c,"chat_title")&&(b===i&&(b={...i}),b.chat_title=null,b.chat_title_source=null),b=Ed(i,Zc(i,b)),fn(b,i))return n;b.
session_id=s;let N=n.indexById[s],x=n.list.slice();x[N]=b;let S=Object.assign(Object.create(null),n.byId);return S[s]=b,
{byId:S,indexById:n.indexById,order:n.order,list:x}}var qd=10,ut=new Map,go=new Map,Xg=Object.freeze([]);function ho(e){return String(e||"").trim()}function Pd(e){let t=ho(e);if(!t||!ut.has(t))return null;let n=ut.get(t);return ut.delete(t),ut.set(t,n),n}function Id(e){
let t=ho(e);return t&&ut.get(t)||Xg}function Od(e,t){let n=ho(e);if(!n||typeof t!="function")return()=>{};let s=go.get(n)||
new Set;return s.add(t),go.set(n,s),()=>{let a=go.get(n);a&&(a.delete(t),a.size===0&&go.delete(n))}}function el(e){let t=go.
get(e);t&&[...t].forEach(n=>n())}function Dd(e,t,n=qd){let s=ho(e);if(!s||!Array.isArray(t))return[];let a=_d(t),i=ut.get(s);ut.delete(s),ut.set(s,a);let c=[],
d=Math.max(1,Number(n)||qd);for(;ut.size>d;){let f=ut.keys().next().value;ut.delete(f),c.push(f)}return i!==a&&el(s),c.forEach(
el),c}function jd(e){let t=ho(e);return!t||!ut.has(t)?!1:(ut.delete(t),el(t),!0)}function Qg(){return Object.fromEntries(
[...ut.entries()])}function Bd(e){let t=Qg(),n=typeof e=="function"?e(t):e;if(!n||n===t||typeof n!="object")return t;let s=new Set(
Object.keys(n));return Object.keys(t).forEach(a=>{s.has(a)||jd(a)}),Object.entries(n).forEach(([a,i])=>{Array.isArray(i)&&
t[a]!==i&&Dd(a,i)}),n}var tl=new Proxy({},{get(e,t){if(typeof t=="string")return ut.get(t)},ownKeys(){return[...ut.keys()]},
getOwnPropertyDescriptor(e,t){if(typeof t=="string"&&ut.has(t))return{configurable:!0,enumerable:!0,value:ut.get(t)}},set(e,t,n){
return typeof t!="string"||!Array.isArray(n)?!1:(Dd(t,n),!0)},deleteProperty(e,t){return typeof t=="string"?jd(t):!1}});var Jg=new Set(["thinking","generating","reading_files","running_command","applying_patch","working"]),Zg=new Set(["wait\
ing_for_user","needs_attention","blocked","rate_limited","usage_limited","budget_limited","failed","error"]),eh=new Set(
["blocked","usagelimited","budgetlimited","failed"]),th=new Set(["complete","completed","cancelled","canceled"]),Fd=new Set(
["starting","running_turn","checkpoint_pending_continuation","verifying"]),nh=new Set(["waiting_for_user","blocked_limit\
ed"]),sh=new Set(["paused","completed_cancelled_failed","unknown_disconnected"]),nl=15e3;function ah(e){return String(e?.
goal?.state||e?.goal?.status||"").trim().toLowerCase().replace(/[^a-z]/g,"")}function Hd(e){let t=e?.goal,n=e?.goal_run;
return!t||!n||n.schema_version!==1||!n.run_id||!n.goal_fingerprint||!Number.isFinite(Number(n.goal_generation))||String(
n.goal_fingerprint)!==String(t.fingerprint||"")||Number(n.goal_generation)!==Math.max(1,Number(t.generation)||1)?null:n}
function va(e){if(typeof e=="number"&&Number.isFinite(e))return e;let t=Date.parse(String(e||""));return Number.isFinite(
t)?t:0}function Ni(e){return Math.max(va(e?.transport?.client_received_at_ms),va(e?.transport?.relay_forwarded_at_ms),va(
e?.observed_at),va(e?.updatedAt),va(e?.updated_at))}function ki(e,t={}){if(t.connected===!1||String(t.health||"").toLowerCase()===
"disconnected"||t.fresh===!1)return!1;if(t.requireFreshness!==!0)return!0;let n=Ni(e);if(!n)return!1;let s=Number.isFinite(
Number(t.nowMs))?Number(t.nowMs):Date.now(),a=Math.max(1e3,Number(t.freshnessMs)||nl);return s-n<=a}function Si(e,t=!1,n={}){
let s=String(e?.kind||"").trim().toLowerCase(),a=ah(e),i=Hd(e),c=String(i?.lifecycle||"").trim().toLowerCase();if(t||Zg.
has(s)||nh.has(c))return"needs_attention";let d=e?.generating===!0||Jg.has(s);return i?.lease_active===!0&&i.owner_state===
"confirmed"&&Fd.has(c)&&d&&ki(e,n)?"working_goal":eh.has(a)?"needs_attention":i&&c==="unknown_disconnected"?"stale":i&&sh.
has(c)||th.has(a)?"idle":i?.lease_active===!0&&Fd.has(c)?"working_goal":i&&a==="active"||a==="active"?ki(e,n)?"between_g\
oal_turns":"stale":s==="idle"&&a!=="active"?"idle":ki(e,n)?d?"working":"idle":"stale"}function Ci(e,t={}){let n=Hd(e),s=String(
n?.lifecycle||"").trim().toLowerCase();return!n||n.lease_active!==!0?"":s==="checkpoint_pending_continuation"?"Waiting f\
or next goal turn":s==="verifying"||t.connected===!1||String(t.health||"").toLowerCase()==="disconnected"?"Reconnecting":
s==="starting"?"Starting goal":s==="running_turn"?"Working":"Goal loop active"}function Ud(e){return e==="working_goal"?
"Working on goal":e==="working"?"Working":e==="between_goal_turns"?"Between goal turns":e==="needs_attention"?"Needs att\
ention":e==="stale"?"Stale":"Idle"}function ya(e){return e==="working_goal"||e==="working"}function Gd(e,t=null,n=Date.now()){
if(!e||typeof e!="object")return 0;let s=Math.max(0,Number(e.time_used_seconds??e.timeUsedSeconds??0)||0),a=va(e.updated_at||
e.updatedAt),i=String(e.state||e.status||"").toLowerCase()==="active",c=t&&t.lease_active!==!0?va(t.lease_observed_at||t.
observed_at):Number(n),d=c>0?Math.min(Number(n)||c,c):a,f=i&&a>0?Math.max(0,Math.floor((d-a)/1e3)):0;return Math.floor(s+
f)}function wi(e){let t=Number(e);return Number.isFinite(t)&&t>0?t:null}function Wd(e,t=Date.now()){if(!e||typeof e!="ob\
ject")return null;let n=wi(e.proxy_emitted_at_ms),s=wi(e.relay_received_at_ms),a=wi(e.relay_forwarded_at_ms),i=wi(t)||Date.
now();return{proxy_emitted_at_ms:n,relay_received_at_ms:s,relay_forwarded_at_ms:a,client_received_at_ms:i,latency_ms:n==
null?null:Math.max(0,i-n)}}function zd(e,t=Date.now()){let n=Number(e?.transport?.latency_ms);if(Number.isFinite(n))return`${Math.
round(n)} ms`;let s=Ni(e);if(!s)return"Awaiting live update";let a=Math.max(0,Number(t)-s);return a<1e3?"Observed just n\
ow":a<6e4?`Observed ${Math.floor(a/1e3)}s ago`:a<36e5?`Observed ${Math.floor(a/6e4)}m ago`:`Observed ${Math.floor(a/36e5)}\
h ago`}var rh=Object.freeze(["goal_completed","goal_attention","provider_usage_threshold"]),oh=new Set(rh),Vd=Object.freeze({goal_completed:"\
goal_completed",goal_attention:"goal_attention",provider_usage_threshold:"provider_usage_warning"}),Yd="remote-agent-cha\
t:semantic-notifications:v1",ih="remote-agent-chat:semantic-notification-claim:v1:",Xd=256,ch=10080*60*1e3;function xi(e){
if(!e||typeof e!="object"||e.type!=="semantic_notification")return null;let t=String(e.event_type||"").trim(),n=String(e.
dedupe_key||"").trim(),s=String(e.session_id||e.session||"").trim();if(!oh.has(t)||!n||!s)return null;let a=String(e.category||
Vd[t]).trim();return a!==Vd[t]?null:{...e,type:"semantic_notification",event_type:t,category:a,dedupe_key:n,session_id:s,
session:s,title:String(e.title||"").trim()||(t==="goal_completed"?"Goal completed":t==="provider_usage_threshold"?"Provi\
der usage warning":"Goal needs attention"),body:String(e.body||"").trim(),created_at:e.created_at||new Date().toISOString()}}
function al(e,t,n=100){let s=new Map;return[...Array.isArray(e)?e:[],...Array.isArray(t)?t:[t]].map(xi).filter(Boolean).
forEach(a=>s.set(a.dedupe_key,a)),[...s.values()].slice(-Math.max(1,Number(n)||100))}function Qd(e,t={}){let n=xi(e);return!!n&&
t?.[n.category]===!0}function sl(e,t){try{let n=JSON.parse(e?.getItem(Yd)||"{}");return Object.fromEntries(Object.entries(
n||{}).filter(([,s])=>Number(s)>t-ch).slice(-Xd))}catch{return{}}}function Kd(e,t,n){let s=sl(e,n);if(s[t])return!1;s[t]=
n;let a=Object.entries(s).slice(-Xd);try{e?.setItem(Yd,JSON.stringify(Object.fromEntries(a)))}catch{}return!0}function lh(e){
return new Promise(t=>setTimeout(t,e))}async function uh(e,t,n){if(!e)return!0;if(sl(e,n)[t])return!1;let s=`${ih}${encodeURIComponent(
t).slice(0,320)}`,a=`${n}:${Math.random().toString(36).slice(2)}`;try{if(e.setItem(s,JSON.stringify({token:a,at:n})),await lh(
20),JSON.parse(e.getItem(s)||"{}").token!==a||!Kd(e,t,n))return!1;let c=sl(e,n)[t]===n;return c&&e.removeItem(s),c}catch{
return Kd(e,t,n)}}async function Jd(e,{storage:t=typeof localStorage<"u"?localStorage:null,locks:n=typeof navigator<"u"?
navigator.locks:null,now:s=()=>Date.now()}={}){let a=xi(e);if(!a)return!1;let i=()=>uh(t,a.dedupe_key,s());return n?.request?
n.request(`rac-semantic:${a.dedupe_key}`,{mode:"exclusive"},i):i()}async function ka(e,t,{channel:n="web-in-app",reasonCode:s="",
clientId:a="web-app"}={}){let i=xi(e);if(!i||!["claimed","displayed","suppressed"].includes(t)||typeof fetch!="function")
return!1;try{return(await fetch("/api/notifications/semantic-receipts",{method:"POST",credentials:"same-origin",keepalive:!0,
headers:{"Content-Type":"application/json"},body:JSON.stringify({dedupe_key:i.dedupe_key,stage:t,channel:n,...s?{reason_code:s}:
{},client_id:a})})).ok}catch{return!1}}function Zd(e,t,n=""){if(!t)return"";let s=e||{};return n&&(s[n]||[]).some(a=>a?._cid===t)?n:Object.keys(s).find(a=>(s[a]||
[]).some(i=>i?._cid===t))||""}function ep(e,t,n,s){if(!t||!n||typeof s!="function")return e;let a=e?.[n]||[],i=!1,c=a.map(
d=>{if(d?._cid!==t)return d;let f=s(d);return f!==d&&(i=!0),f});return i?{...e,[n]:c}:e}function dh(e){let t=Number(e);return!Number.isSafeInteger(t)||t<=0?0:t}function ph(e){return String(e?.navigation_session_id||
e?.session_id||e?.session||"")}function tp(e={}){let t=Math.max(1,Number(e.maxEntries)||512),n=new Map;function s(a,i){for(n.
delete(a),n.set(a,i);n.size>t;)n.delete(n.keys().next().value)}return{accept(a){let i=ph(a),c=dh(a?.navigation_epoch);if(!i||
!c)return!0;let d=n.get(i)||0;return c<d?!1:(s(i,c),!0)},latest(a){return n.get(String(a||""))||0},get size(){return n.size}}}var mh=new Set(["user","assistant","tool","tool_result","permission","permission_prompt","question","question_prompt","e\
rror","system"]);function ct(e){return typeof e=="string"?e:String(e?.session_id||e?.id||"")}function fh(e){let t=String(
e||"").trim().toLowerCase().replace(/[\s-]+/g,"_");return mh.has(t)?t==="permission_prompt"?"permission":t==="question_p\
rompt"?"question":t:null}function gh(e){let t=String(e||"").trim();return!t||t.length>256||/[\u0000-\u001f\u007f]/.test(
t)?null:t}function hh(e){let t=String(e||"").trim().toLowerCase().replace(/[\s-]+/g,"_");return!t||t.length>64||/[^a-z0-9_.:/]/.
test(t)?null:t}function _h(e){if(typeof e=="number"||typeof e=="string"&&/^\d+(?:\.\d+)?$/.test(e.trim())){let n=Number(
e);return!Number.isFinite(n)||n<=0?null:n>1e12?n:n*1e3}if(typeof e!="string"||!e.trim())return null;let t=Date.parse(e);
return Number.isFinite(t)&&t>0?t:null}function Sr(e){if(!e||typeof e!="object")return null;let t=e.latest_visible_message&&
typeof e.latest_visible_message=="object"?e.latest_visible_message:null,n=gh(t?.id??t?.message_id??e.last_message_id),s=_h(
t?.at??t?.timestamp??e.last_message_at),a=fh(t?.kind??e.last_message_kind),i=hh(t?.source??e.last_message_source);return!n||
!s||!a||!i?null:Object.freeze({id:n,at:new Date(s).toISOString(),atMs:s,kind:a,source:i})}function ol(e){let t=Sr(e);return t?
{latest_visible_message:{id:t.id,at:t.at,kind:t.kind,source:t.source},last_message_id:t.id,last_message_at:t.at,last_message_kind:t.
kind,last_message_source:t.source}:{}}function bh(e,t){let n=Sr(e),s=Sr(t);if(n&&!s)return-1;if(!n&&s)return 1;if(!n&&!s)
return ct(e).localeCompare(ct(t));if(n.atMs!==s.atMs)return s.atMs-n.atMs;let a=s.id.localeCompare(n.id);return a!==0?a:
ct(e).localeCompare(ct(t))}function vh(e){return(Array.isArray(e)?e:[]).filter(t=>!!ct(t)&&!!Sr(t)).slice().sort(bh)}function rl(e){
return e instanceof Set?e:!e||typeof e[Symbol.iterator]!="function"?new Set:new Set(Array.from(e,t=>String(t||"")))}function np(e,t={}){
let n=rl(t.workingSessionIds),s=rl(t.pinnedSessionIds),a=new Map([...s].map((w,y)=>[w,y])),i=rl(t.excludedSessionIds),c=Number.
isSafeInteger(t.limit)&&t.limit>=0?t.limit:5,d=new Set,f=[];for(let w of Array.isArray(e)?e:[]){let y=ct(w);!y||d.has(y)||
i.has(y)||(d.add(y),f.push(w))}let h=f.filter(w=>n.has(ct(w))),b=f.filter(w=>!n.has(ct(w))),N=vh(b).slice(0,c),x=new Set(
N.map(ct)),S=b.filter(w=>!x.has(ct(w))),R=S.filter(w=>s.has(ct(w))).sort((w,y)=>a.get(ct(w))-a.get(ct(y))),u=new Set(R.map(
ct)),v=S.filter(w=>!u.has(ct(w))),g=Object.fromEntries([...h.map(w=>[ct(w),"working"]),...N.map(w=>[ct(w),"recent"]),...R.
map(w=>[ct(w),"pinned"]),...v.map(w=>[ct(w),"workspace"])]);return{working:h,recent:N,pinned:R,remaining:v,ownership:g}}var Cr=Object.freeze({live:6e4,"1m":6e4,"5m":3e5,"15m":9e5,since_open:1/0}),yh=Object.freeze({cpu_total_percent:["cpu","\
totalPercent"],cpu_user_percent:["cpu","userPercent"],cpu_privileged_percent:["cpu","privilegedPercent"],memory_used_percent:[
"memory","usedPercent"],memory_commit_percent:["memory","commitPercent"],disk_read_bps:["disk","readBps"],disk_write_bps:[
"disk","writeBps"],disk_read_iops:["disk","readIops"],disk_write_iops:["disk","writeIops"],network_receive_bps:["network",
"receiveBps"],network_send_bps:["network","sendBps"],network_receive_pps:["network","receivePps"],network_send_pps:["net\
work","sendPps"]});function nt(e,t=0){let n=Number(e);return Number.isFinite(n)?n:t}function St(e){if(e==null||e==="")return null;
let t=Number(e);return Number.isFinite(t)&&t>=0?t:null}function _e(e){return Math.max(0,nt(e))}function Gt(e){return Math.
max(0,Math.min(100,nt(e)))}function Ai(e){let t=String(e??"0");return/^\d+$/.test(t)?t:"0"}function _o(e){let t=Date.parse(
String(e||""));return Number.isFinite(t)?t:0}function kh(e,t){let n=Math.max(0,Math.round(nt(e?.pid))),s=e?.start_time?String(
e.start_time):"",a=String(e?.stable_key||`${n||"process"}:${s||t}`),i=String(e?.attribution_level||(e?.attributed?"runti\
me":"unattributed"));return{key:a,stableKey:a,parentKey:e?.parent_key?String(e.parent_key):"",pid:n,parentPid:Math.max(0,
Math.round(nt(e?.parent_pid))),startTime:s,name:String(e?.name||"Process"),status:String(e?.status||"running"),attributed:e?.
attributed===!0,attributionLevel:i,attributionReason:String(e?.attribution_reason||"No proved agent relationship"),ownedSessionId:e?.
owned_session_id?String(e.owned_session_id):"",agentLabel:e?.agent_label?String(e.agent_label):"",agentTypes:Array.isArray(
e?.agent_types)?e.agent_types.map(String):[],workspaceLabel:e?.workspace_label?String(e.workspace_label):"",sessionCount:Math.
max(0,Math.round(nt(e?.session_count))),cpuPercent:Gt(e?.cpu_host_percent??e?.cpu_percent),cpuHostPercent:Gt(e?.cpu_host_percent??
e?.cpu_percent),cpuCoreEquivalent:_e(e?.cpu_core_equivalent??e?.cpu_percent),memoryBytes:_e(e?.memory_bytes),privateBytes:_e(
e?.private_bytes??e?.memory_bytes),commitBytes:_e(e?.commit_bytes??e?.private_bytes),ioReadBps:_e(e?.io_read_bps),ioWriteBps:_e(
e?.io_write_bps),ioReadOps:_e(e?.io_read_ops),ioWriteOps:_e(e?.io_write_ops),threadCount:Math.max(0,Math.round(nt(e?.thread_count))),
handleCount:Math.max(0,Math.round(nt(e?.handle_count))),uptimeSeconds:e?.uptime_seconds==null?null:_e(e.uptime_seconds),
childCount:Math.max(0,Math.round(nt(e?.child_count))),selectedAs:Array.isArray(e?.selected_as)?e.selected_as.map(String):
[],selectedParentPresent:e?.selected_parent_present!==!1,counterTotals:{ioReadBytes:Ai(e?.counter_totals?.io_read_bytes),
ioWriteBytes:Ai(e?.counter_totals?.io_write_bytes),ioReadOperations:Ai(e?.counter_totals?.io_read_operations),ioWriteOperations:Ai(
e?.counter_totals?.io_write_operations)}}}function wh(e,t){return{id:String(e?.id||`disk-${t}`),label:String(e?.label||`\
Disk ${t+1}`),kind:String(e?.kind||"unknown"),readBps:_e(e?.read_bps),writeBps:_e(e?.write_bps),readIops:_e(e?.read_iops),
writeIops:_e(e?.write_iops),busyPercent:Gt(e?.busy_percent),readLatencyMs:_e(e?.read_latency_ms),writeLatencyMs:_e(e?.write_latency_ms),
queueLength:_e(e?.queue_length),capacityBytes:_e(e?.capacity_bytes),freeBytes:_e(e?.free_bytes),freePercent:Gt(e?.free_percent),
available:e?.available!==!1}}function Nh(e,t){return{id:String(e?.id||`adapter-${t}`),label:String(e?.label||`Adapter ${t+
1}`),kind:String(e?.kind||"unknown"),physicalDefault:e?.physical_default===!0,receiveBps:_e(e?.receive_bps),sendBps:_e(e?.
send_bps),receivePps:_e(e?.receive_pps),sendPps:_e(e?.send_pps),linkSpeedBps:_e(e?.link_speed_bps),utilizationPercent:Gt(
e?.utilization_percent),receiveErrors:_e(e?.receive_errors),sendErrors:_e(e?.send_errors),receiveDiscards:_e(e?.receive_discards),
sendDiscards:_e(e?.send_discards),available:e?.available!==!1}}function rp(e){if(!e||typeof e!="object")return{available:!1,
status:"waiting",schemaVersion:0,source:"",capturedAt:"",capturedAtMs:0,sampleSequence:0,sampleIntervalMs:0,droppedGapCount:0,
machineLabel:"",system:null,processes:[],attributedProcesses:[],sampling:null,privacy:null,capabilities:null,error:null,
lastGoodCapturedAt:"",lastGoodCapturedAtMs:0};let t=e.system&&typeof e.system=="object"?e.system:null,n=t?.cpu&&typeof t.
cpu=="object"?t.cpu:{},s=t?.memory&&typeof t.memory=="object"?t.memory:{},a=t?.disk&&typeof t.disk=="object"?t.disk:{},i=t?.
network&&typeof t.network=="object"?t.network:{},c=t?{cpuPercent:Gt(n.total_percent??t.cpu_percent),cpu:{totalPercent:Gt(
n.total_percent??t.cpu_percent),userPercent:Gt(n.user_percent),privilegedPercent:Gt(n.privileged_percent),idlePercent:Gt(
n.idle_percent),queueLength:_e(n.queue_length),frequencyMhz:_e(n.current_frequency_mhz),logicalCoreCount:Math.max(0,Math.
round(nt(n.logical_core_count))),physicalCoreCount:Math.max(0,Math.round(nt(n.physical_core_count))),perLogical:Array.isArray(
n.per_logical)?n.per_logical:[]},memory:{totalBytes:_e(s.total_bytes),usedBytes:_e(s.used_bytes),availableBytes:_e(s.available_bytes),
usedPercent:Gt(s.used_percent),cacheBytes:_e(s.cache_bytes),commitBytes:_e(s.commit_bytes),commitLimitBytes:_e(s.commit_limit_bytes),
commitPeakBytes:_e(s.commit_peak_bytes),commitPercent:Gt(s.commit_percent),pagedPoolBytes:_e(s.paged_pool_bytes),nonpagedPoolBytes:_e(
s.nonpaged_pool_bytes),pagefileUsedBytes:_e(s.pagefile_used_bytes),pagesPerSec:_e(s.pages_per_sec),faultsPerSec:_e(s.faults_per_sec)},
disk:{readBps:_e(a.read_bps),writeBps:_e(a.write_bps),busyPercent:Gt(a.busy_percent),readIops:_e(a.read_iops),writeIops:_e(
a.write_iops),readLatencyMs:_e(a.read_latency_ms),writeLatencyMs:_e(a.write_latency_ms),transferLatencyMs:_e(a.transfer_latency_ms),
queueLength:_e(a.queue_length)},disks:(Array.isArray(t.disks)?t.disks:[]).map(wh),network:{receiveBps:_e(i.receive_bps),
sendBps:_e(i.send_bps),receivePps:_e(i.receive_pps),sendPps:_e(i.send_pps),utilizationPercent:Gt(i.utilization_percent),
outputQueueLength:_e(i.output_queue_length),receiveErrors:_e(i.receive_errors),sendErrors:_e(i.send_errors),receiveDiscards:_e(
i.receive_discards),sendDiscards:_e(i.send_discards),tcpRetransmitsPerSec:_e(i.tcp_retransmits_per_sec)},networkAdapters:(Array.
isArray(t.network_adapters)?t.network_adapters:[]).map(Nh),processCount:Math.max(0,Math.round(nt(t.process_count))),threadCount:Math.
max(0,Math.round(nt(t.thread_count))),handleCount:Math.max(0,Math.round(nt(t.handle_count))),uptimeSeconds:_e(t.uptime_seconds)}:
null,d=(Array.isArray(e.processes)?e.processes:[]).map(kh).sort((b,N)=>Number(N.attributed)-Number(b.attributed)||N.cpuHostPercent-
b.cpuHostPercent||N.memoryBytes-b.memoryBytes||b.pid-N.pid),f=e.captured_at?String(e.captured_at):"",h=e.last_good_captured_at?
String(e.last_good_captured_at):"";return{available:e.status==="fresh"&&!!c,status:String(e.status||"unavailable"),schemaVersion:Math.
max(0,Math.round(nt(e.schema_version))),source:String(e.source||""),capturedAt:f,capturedAtMs:_o(f),sampleSequence:Math.
max(0,Math.round(nt(e.sample_sequence))),sampleIntervalMs:Math.max(0,Math.round(nt(e.sample_interval_ms))),droppedGapCount:Math.
max(0,Math.round(nt(e.dropped_gap_count))),machineLabel:e.machine_label?String(e.machine_label):"",system:c,processes:d,
attributedProcesses:d.filter(b=>b.attributed),sampling:e.sampling&&typeof e.sampling=="object"?e.sampling:null,privacy:e.
privacy&&typeof e.privacy=="object"?e.privacy:null,capabilities:e.capabilities&&typeof e.capabilities=="object"?e.capabilities:
null,error:e.error&&typeof e.error=="object"?e.error:null,lastGoodCapturedAt:h,lastGoodCapturedAtMs:_o(h)}}function il(e,t=0){
let n=e.filter(Number.isFinite).sort((a,i)=>a-i);if(!n.length)return t;let s=Math.floor(n.length/2);return n.length%2?n[s]:
(n[s-1]+n[s])/2}function Ri(e){let t=Math.max(Number.EPSILON,Number(e)||0),n=10**Math.floor(Math.log10(t)),s=t/n;return(s<=
1?1:s<=2?2:s<=2.5?2.5:s<=5?5:10)*n}function Mi(e){if(!e||typeof e!="object")return null;let t=Number(e.sample_sequence);
if(!Number.isSafeInteger(t)||t<1)return null;let n=e.frame_kind==="system"?e:e.system||{},s=n.cpu||{},a=n.memory||{},i=n.
disk||{},c=n.network||{};return{sampleSequence:t,capturedAt:String(e.captured_at||""),capturedAtMs:_o(e.captured_at),monotonicMs:_e(
e.monotonic_ms),sampleIntervalMs:_e(e.sample_interval_ms),droppedGapCount:Math.max(0,Math.round(nt(e.dropped_gap_count))),
status:String(e.status||"unavailable"),cpu:{totalPercent:St(s.total_percent??n.cpu_percent),userPercent:St(s.user_percent),
privilegedPercent:St(s.privileged_percent)},memory:{usedPercent:St(a.used_percent),commitPercent:St(a.commit_percent)},disk:{
readBps:St(i.read_bps),writeBps:St(i.write_bps),readIops:St(i.read_iops),writeIops:St(i.write_iops)},network:{receiveBps:St(
c.receive_bps),sendBps:St(c.send_bps),receivePps:St(c.receive_pps),sendPps:St(c.send_pps)}}}function xr(e,t={}){let n=Array.
isArray(e)?e:[],s=new Map,a=0,i=0,c=0;for(let Q of n){let U=Number(Q?.sample_sequence);!Number.isSafeInteger(U)||U<1||(U<
c&&(i+=1),c=Math.max(c,U),s.has(U)?a+=1:s.set(U,Q))}let f=[...s.values()].sort((Q,U)=>Q.sample_sequence-U.sample_sequence).
map(Q=>({frame:Q,point:Mi(Q)})).filter(Q=>Q.point),h=f.find(Q=>Q.point.capturedAtMs>0&&Q.point.monotonicMs>0)||null,b=f.
map(Q=>{let U=h&&Q.point.monotonicMs>0?h.point.capturedAtMs+Q.point.monotonicMs-h.point.monotonicMs:0;return{...Q,chartTimeMs:U>
0?U:Q.point.capturedAtMs}}),N=[];for(let Q=1;Q<b.length;Q+=1){let U=b[Q].chartTimeMs-b[Q-1].chartTimeMs;U>0&&U<=1e4&&N.push(
U)}let x=b.map(Q=>Q.point.sampleIntervalMs).filter(Q=>Q>0),S=Math.max(1,Math.round(il(N,il(x,1e3))||1e3)),R=Math.max(2500,
S*2.5),u=[],v=[],g=0,w=0,y=0,E=0,T=0,H=0;for(let Q of b){let U={...Q,chartTimeMs:Q.chartTimeMs+H};if(!(U.chartTimeMs>0)){
g+=1;continue}let V=u.at(-1),ie=!1;if(V&&U.point.monotonicMs>0&&V.point.monotonicMs>0&&U.point.monotonicMs<V.point.monotonicMs){
let re=U.point.capturedAtMs-V.point.capturedAtMs,$=re>0&&re<=1e4?re:S,z=V.chartTimeMs+Math.max(1,$);H+=z-U.chartTimeMs,U.
chartTimeMs=z,ie=!0,T+=1}if(V&&U.chartTimeMs<=V.chartTimeMs){U.chartTimeMs===V.chartTimeMs?w+=1:y+=1;continue}let I=U.point.
status!=="fresh",W=I?"unavailable":"";if(V){let re=U.chartTimeMs-V.chartTimeMs,$=U.point.sampleSequence-V.point.sampleSequence,
z=U.point.droppedGapCount-V.point.droppedGapCount;if(($!==1||z>0||re>R)&&(I=!0,W=$!==1||z>0?"dropped":"cadence"),ie)E+=1,
I=!0,W="clock_discontinuity";else if(U.point.monotonicMs>0&&V.point.monotonicMs>0&&U.point.capturedAtMs>0&&V.point.capturedAtMs>
0){let fe=U.point.capturedAtMs-V.point.capturedAtMs,we=U.point.monotonicMs-V.point.monotonicMs;Math.abs(fe-we)>Math.max(
5e3,S*2)&&(E+=1,I=!0,W="clock_discontinuity")}I&&v.push({startMs:V.chartTimeMs,endMs:U.chartTimeMs,reason:W,previousSequence:V.
point.sampleSequence,nextSequence:U.point.sampleSequence})}u.push({...U,gapBefore:I,gapReason:W})}let K=Number.isFinite(
Number(t.nowMs))?Number(t.nowMs):Date.now(),te=u.at(-1)||null,ne=te?Math.max(0,K-te.chartTimeMs):1/0,oe=Math.max(2500,S*
2),G=Math.max(oe*4,1e4),de="waiting";t.paused?de="paused":t.connected===!1||t.subscriptionStatus==="reconnecting"?de="re\
connecting":te?te.point.status!=="fresh"?de="unavailable":ne>G?de="stale":ne>oe?de="delayed":de="live":de=t.error?"unava\
ilable":"waiting",te&&ne>oe&&!t.paused&&v.push({startMs:te.chartTimeMs,endMs:K,reason:de,previousSequence:te.point.sampleSequence,
nextSequence:null});let Ne=u.length>1?u.at(-1).chartTimeMs-u[0].chartTimeMs:0,J=te&&!t.paused?Math.max(te.chartTimeMs,K):
te?.chartTimeMs||0,ve=u.length?Math.max(0,J-u[0].chartTimeMs):0,ge=u.length?Math.max(1,Math.floor(ve/S)+1):0,Z=u.length?
Math.max(0,u.at(-1).point.droppedGapCount-u[0].point.droppedGapCount):0;return{frames:u.map(Q=>({...Q.frame,chart_time_ms:Q.
chartTimeMs,gap_before:Q.gapBefore,gap_reason:Q.gapReason})),points:u.map(Q=>({...Q.point,chartTimeMs:Q.chartTimeMs,gapBefore:Q.
gapBefore,gapReason:Q.gapReason})),gaps:v,status:de,cadenceMs:S,staleAfterMs:oe,latestAgeMs:ne,nowMs:K,startMs:u[0]?.chartTimeMs||
0,endMs:u.at(-1)?.chartTimeMs||0,elapsedMs:Ne,expectedCount:ge,receivedCount:n.length,validCount:u.filter(Q=>Q.point.status===
"fresh").length,droppedCount:Math.max(Z,Math.max(0,ge-u.length)),gapCount:v.length,duplicateCount:a+w,outOfOrderCount:i+
y,invalidTimestampCount:g,clockDiscontinuityCount:E,monotonicResetCount:T}}function sp(e,t,n){let s=e.map(a=>({capturedAtMs:a.
capturedAtMs,value:t==="cpu"?a.cpu.totalPercent:a.memory.usedPercent})).filter(a=>a.capturedAtMs>0&&a.value!==null);return s.
length<2||s.at(-1).capturedAtMs-s[0].capturedAtMs<15e3?!1:s.every(a=>a.value>=n)}function ap(e,t){return sp(e,t,95)?"cri\
tical":sp(e,t,85)?"warning":"normal"}function op(e,t={}){let n=Ys([],e,60),s=n.map(Mi).filter(Boolean),a=s.at(-1)||null,
i=Number.isFinite(Number(t.nowMs))?Number(t.nowMs):Date.now(),c=t.connected!==!1,d=String(t.subscriptionStatus||""),f=a?.
cpu.totalPercent??null,h=a?.memory.usedPercent??null,b=a?.status==="fresh"&&f!==null&&h!==null,N=a?.capturedAtMs>0?Math.
max(0,i-a.capturedAtMs):1/0,x=Math.max(1e3,a?.sampleIntervalMs||1e3),S=Math.max(2500,x*2),R="waiting";!c||d==="reconnect\
ing"?R="reconnecting":b?N>S?R="stale":R="live":R=t.error?"unavailable":"waiting";let u=a?.capturedAtMs?a.capturedAtMs-15e3:
1/0,v=s.filter(H=>H.capturedAtMs>=u),g=b?ap(v,"cpu"):"normal",w=b?ap(v,"memory"):"normal",y=R==="live"&&(g==="critical"||
w==="critical")?"critical":R==="live"&&(g==="warning"||w==="warning")?"warning":R,E=n.at(-1)||null,T=E?.frame_kind==="sy\
stem"?E:E?.system||null;return{status:R,attention:y,point:a,frames:n,cpuPercent:f,memoryPercent:h,cpuLevel:g,memoryLevel:w,
ageMs:N,ageSeconds:Number.isFinite(N)?Math.max(0,Math.round(N/1e3)):null,staleAfterMs:S,sampleSequence:a?.sampleSequence||
0,capturedAt:a?.capturedAt||"",memoryUsedBytes:St(T?.memory?.used_bytes),memoryTotalBytes:St(T?.memory?.total_bytes)}}function Ys(e,t,n=900){
let s=new Map;[...Array.isArray(e)?e:[],...Array.isArray(t)?t:[t]].forEach(i=>{let c=Number(i?.sample_sequence);!Number.
isSafeInteger(c)||c<1||s.has(c)||s.set(c,i)});let a=Math.max(1,Math.min(900,Number(n)||900));return[...s.entries()].sort(
(i,c)=>i[0]-c[0]).slice(-a).map(([,i])=>i)}function Ks(e,t){let n=e?.sampleSequence?e:Mi(e),s=yh[t];return!n||!s?null:St(
s.reduce((a,i)=>a?.[i],n))}function cl(e,t){let n=(Array.isArray(e)?e:[]).map(w=>({frame:w,point:w?.sampleSequence?w:Mi(
w),value:Ks(w,t),timeMs:Number(w?.chartTimeMs??w?.chart_time_ms)||_o(w?.capturedAt??w?.captured_at),gapBefore:w?.gapBefore===
!0||w?.gap_before===!0})).filter(w=>w.point&&w.value!==null&&w.timeMs>0).sort((w,y)=>w.timeMs-y.timeMs||w.point.sampleSequence-
y.point.sampleSequence);if(!n.length)return{current:null,min:null,average:null,sampleAverage:null,timeWeightedAverage:null,
averageMethod:"none",max:null,p95:null,provisionalP95:null,p95Ready:!1,peakSequence:null,count:0,elapsedMs:0,cadenceMs:0,
gapCount:0};let s=n.map(w=>w.value),a=[...s].sort((w,y)=>w-y),i=n.reduce((w,y)=>y.value>w.value?y:w,n[0]),c=s.reduce((w,y)=>w+
y,0)/s.length,d=n.slice(1).map((w,y)=>w.timeMs-n[y].timeMs).filter(w=>w>0),f=Math.max(0,Math.round(il(d,0))),h=Math.max(
2500,f*2.5),b=0,N=0,x=0;for(let w=1;w<n.length;w+=1){let y=n[w-1],E=n[w],T=E.timeMs-y.timeMs;if(E.gapBefore||T>h){x+=1;continue}
b+=(y.value+E.value)/2*T,N+=T}let S=N>0?b/N:c,R=d.length?Math.min(...d):0,u=d.length?Math.max(...d):0,v=R>0&&u/R>1.2,g=a[Math.
max(0,Math.ceil(a.length*.95)-1)];return{current:s.at(-1),min:Math.min(...s),average:v?S:c,sampleAverage:c,timeWeightedAverage:S,
averageMethod:v?"time-weighted":"sample",max:Math.max(...s),p95:s.length>=20?g:null,provisionalP95:g,p95Ready:s.length>=
20,peakSequence:i.point.sampleSequence,count:s.length,elapsedMs:n.length>1?n.at(-1).timeMs-n[0].timeMs:0,cadenceMs:f,gapCount:x}}function ip(e,t,n=240){let a=xr(e,{nowMs:Number.MAX_SAFE_INTEGER,paused:!0}).points;if(!a.length)return[];let i=Math.max(
1,Math.round(Number(n)||240)),c=a.length<=i?1:Math.ceil(a.length/i),d=[];for(let f=0;f<a.length;f+=c){let h=a.slice(f,f+
c),b=cl(h,t);d.push({startSequence:h[0].sampleSequence,endSequence:h.at(-1).sampleSequence,capturedAtStartMs:h[0].chartTimeMs,
capturedAtEndMs:h.at(-1).chartTimeMs,chartTimeMs:h.at(-1).chartTimeMs,current:b.current,min:b.min,average:b.average,max:b.
max,first:Ks(h[0],t),last:Ks(h.at(-1),t),p95:b.p95,provisionalP95:b.provisionalP95,peakSequence:b.peakSequence,count:b.count,
gap:h.some(N=>N.gapBefore)})}return d}function cp(e,t="live",n={}){let s=Number.isFinite(Number(n.nowMs))?Number(n.nowMs):
Date.now(),i=xr(e,{...n,nowMs:s}).frames,c=Cr[t]??Cr.live;return!i.length||c===1/0?i:i.filter(d=>Number(d.chart_time_ms)>=
s-c&&Number(d.chart_time_ms)<=s)}function ll(e,t=0,n={}){if(n.percent)return{maximum:100,minimum:0,step:25,ticks:[0,25,50,
75,100]};let s=Math.max(0,Number(e)||0),a=Math.max(0,Number(t)||0);if(a>0&&s<=a*.95&&s>=a*.65){let h=Ri(a/4),b=Math.max(
2,Math.round(a/h)+1);return{maximum:a,minimum:0,step:h,ticks:Array.from({length:b},(N,x)=>Math.min(a,h*x))}}let i=Math.max(
1,s*1.1),c=Ri(i/4),d=Math.ceil(i/c)*c,f=Math.round(d/c)+1;return f<4&&(c=Ri(i/3),d=Math.ceil(i/c)*c,f=Math.round(d/c)+1),
f>6&&(c=Ri(i/5),d=Math.ceil(i/c)*c,f=Math.round(d/c)+1),{maximum:d,minimum:0,step:c,ticks:Array.from({length:Math.max(2,
f)},(h,b)=>Math.min(d,c*b))}}function lp(e,t,n=5){let s=Number(e),a=Number(t),i=Math.max(2,Math.min(6,Math.round(Number(
n)||5)));return!Number.isFinite(s)||!Number.isFinite(a)||a<=s?[]:Array.from({length:i},(c,d)=>{let f=s+(a-s)*d/(i-1),h=new Date(
f),b=new Date(s).toDateString()!==new Date(a).toDateString();return{timeMs:f,fraction:d/(i-1),label:h.toLocaleString([],
b?{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}:{hour:"2-digit",minute:"2-digit",second:"2-digit"}),accessibleLabel:h.
toLocaleString([],{year:"numeric",month:"long",day:"numeric",hour:"2-digit",minute:"2-digit",second:"2-digit",timeZoneName:"\
short"})}})}function ul(e,t,n){let s=Number(e?.chartTimeMs??e?.chart_time_ms)||_o(e?.capturedAt??e?.captured_at),a=Number(
t),i=Number(n);return!(s>0)||!Number.isFinite(a)||!Number.isFinite(i)||i<=a?0:Math.max(0,Math.min(1,(s-a)/(i-a)))}function Jn(e){let t=_e(e);if(t<1024)return`${Math.round(t)} B`;let n=["KiB","MiB","GiB","TiB"],s=t/1024,a=0;for(;s>=1024&&
a<n.length-1;)s/=1024,a+=1;let i=s>=100?0:s>=10?1:2;return`${s.toFixed(i)} ${n[a]}`}function Zn(e){return`${Jn(e)}/s`}function up(e){
return e==null?"\u2014":`${nt(e).toFixed(nt(e)>=10?1:2)}%`}function dl(e,t=Date.now()){let n=Date.parse(e||"");if(!Number.
isFinite(n))return"Waiting for local sample";let s=Math.max(0,Math.round((t-n)/1e3));return s<2?"Updated now":s<60?`Upda\
ted ${s}s ago`:`Updated ${Math.floor(s/60)}m ago`}function pl(e){let t=typeof e=="number"?e:Date.parse(String(e||""));return Number.
isFinite(t)?new Date(t).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"}):"Unknown time"}function ml(e){
let t=typeof e=="number"?e:Date.parse(String(e||""));return Number.isFinite(t)?new Date(t).toLocaleString([],{year:"nume\
ric",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit",second:"2-digit",timeZoneName:"short"}):"Unknown date a\
nd time"}var dp=Object.freeze({unavailable:6,auth_required:5,rate_limited:4,stale:3,refreshing:2,fresh:1});function Qs(e){let t=Number(
e);return Number.isFinite(t)?Math.max(0,t):null}function gt(e){let t=Number(e);return Number.isFinite(t)?t:null}function gn(e){
if(!e||typeof e!="object"||e.amount==null||e.amount==="")return null;let t=gt(e.amount);return t==null?null:{amount:t,currency:String(
e.currency||"USD"),sourceField:String(e.source_field||""),semantics:String(e.semantics||""),directlyReported:e.directly_reported===
!0}}function Sh(e){if(!e||typeof e!="object")return null;let t=e.pool_classification&&typeof e.pool_classification=="obj\
ect"?{status:String(e.pool_classification.classification_status||""),firstParty:gn(e.pool_classification.first_party),thirdParty:gn(
e.pool_classification.third_party),unclassified:gn(e.pool_classification.unclassified),warning:String(e.pool_classification.
warning||"")}:null;return{semanticsVersion:Number(e.semantics_version)||0,source:String(e.source||""),observedAt:String(
e.observed_at||""),accountScope:String(e.account_scope||""),extraUsageEnabled:e.extra_usage_enabled===!0,prepaidBalance:gn(
e.prepaid_balance),extraUsageSpend:gn(e.extra_usage_spend),extraUsageCap:gn(e.extra_usage_cap),reportedSpend:gn(e.reported_spend),
includedSpend:gn(e.included_spend),bonusSpend:gn(e.bonus_spend),planLimit:gn(e.plan_limit),allowanceRemaining:gn(e.allowance_remaining),
reconciliationDelta:gn(e.reconciliation_delta),poolClassification:t,resetsAt:String(e.resets_at||""),disclaimer:String(e.
disclaimer||"")}}function Ch(e){if(!e||typeof e!="object")return null;let t=(Array.isArray(e.request_receipts)?e.request_receipts:
[]).map(n=>({receiptId:String(n?.receipt_id||""),model:String(n?.model||""),surface:String(n?.surface||""),capturedAt:String(
n?.captured_at||""),promptTokens:gt(n?.prompt_tokens),responseTokens:gt(n?.response_tokens),tokensPerSecond:gt(n?.tokens_per_second),
totalDurationNs:gt(n?.total_duration_ns),loadDurationNs:gt(n?.load_duration_ns),promptEvalDurationNs:gt(n?.prompt_eval_duration_ns),
evalDurationNs:gt(n?.eval_duration_ns)})).filter(n=>n.receiptId&&n.model&&n.surface);return{status:String(e.status||""),
endpointScope:String(e.endpoint_scope||""),installedModelsCount:Math.max(0,Number(e.installed_models_count)||0),loadedModelsCount:Math.
max(0,Number(e.loaded_models_count)||0),loadedModels:(Array.isArray(e.loaded_models)?e.loaded_models:[]).map(n=>({name:String(
n?.name||"Unnamed local model"),sizeBytes:Math.max(0,Number(n?.size_bytes)||0),sizeVramBytes:Math.max(0,Number(n?.size_vram_bytes)||
0),contextLength:Math.max(0,Number(n?.context_length)||0),expiresAt:String(n?.expires_at||"")})),promptTokens:gt(e.prompt_tokens),
responseTokens:gt(e.response_tokens),tokensPerSecond:gt(e.tokens_per_second),totalDurationNs:gt(e.total_duration_ns),loadDurationNs:gt(
e.load_duration_ns),promptEvalDurationNs:gt(e.prompt_eval_duration_ns),evalDurationNs:gt(e.eval_duration_ns),observedRequestCount:Math.
max(0,Number(e.observed_request_count)||0),requestReceipts:t,latestRequest:t.at(-1)||null,telemetryStatus:String(e.telemetry_status||
""),telemetryReason:String(e.telemetry_reason||"")}}function xh(e){return!e||typeof e!="object"?null:{subscriptionState:[
"active","none","unavailable"].includes(e.subscription_state)?e.subscription_state:"unavailable",source:String(e.source||
""),capturedAt:String(e.captured_at||""),autoReloadEnabled:typeof e.auto_reload_enabled=="boolean"?e.auto_reload_enabled:
null,error:e.error&&typeof e.error=="object"?{code:String(e.error.code||""),message:String(e.error.message||"")}:null,sourceReceipt:e.
source_receipt&&typeof e.source_receipt=="object"?{...e.source_receipt}:null}}function Ah(e){if(!e||typeof e!="object")return null;
let t=["slow","steady","racing","burning"].includes(e.category)?e.category:"",n=Qs(e.expected_used_percent);if(!t||n==null)
return null;let s=e.budget_percent&&typeof e.budget_percent=="object"?Object.fromEntries(["now","next_hour","next_five_h\
ours","today"].map(a=>[a,Qs(e.budget_percent[a])??0])):null;return{stage:String(e.stage||""),category:t,expectedUsedPercent:n,
actualUsedPercent:Qs(e.actual_used_percent),deltaPercent:gt(e.delta_percent),projectedUsedPercent:Qs(e.projected_used_at_reset_percent),
exhaustionAt:e.exhaustion_at?String(e.exhaustion_at):"",willLastToReset:e.will_last_to_reset===!0,budgets:s}}function Rh(e,t){
let n=Qs(e?.used_percent),s=String(e?.status||(n==null?"unavailable":"available"));if(n==null&&s!=="unavailable")return null;
let a=Qs(e?.thresholds?.warning_percent)??75,i=Math.max(a,Qs(e?.thresholds?.critical_percent)??90),c={id:String(e?.id||`\
window-${t+1}`),label:String(e?.label||"Usage"),scope:e?.scope?String(e.scope):"",modelScope:e?.model_scope&&typeof e.model_scope==
"object"?{id:String(e.model_scope.id||""),label:String(e.model_scope.label||"")}:null,usedPercent:n,remainingPercent:gt(
e?.remaining_percent)??(n==null?null:100-n),visualPercent:Qs(e?.visual_percent)??(n==null?null:Math.min(100,n)),durationMinutes:Number.
isFinite(Number(e?.duration_minutes))?Number(e.duration_minutes):null,startsAt:e?.starts_at?String(e.starts_at):"",resetsAt:e?.
resets_at?String(e.resets_at):"",resetDescription:e?.reset_description?String(e.reset_description):"",windowKind:e?.window_kind?
String(e.window_kind):"",source:e?.source?String(e.source):"",provenance:e?.provenance?String(e.provenance):"",freshnessStatus:e?.
freshness_status?String(e.freshness_status):"",status:s,error:e?.error&&typeof e.error=="object"?e.error:null,thresholds:{
warningPercent:a,criticalPercent:i},pace:Ah(e?.pace)};return c.tone=n==null?"unavailable":n>=i||n>=100?"critical":n>=a?"\
warning":"ok",c}function Mh(e){if(e?.status==="auth_required"||e?.status==="unavailable")return"unavailable";if(e?.status===
"rate_limited")return"stale";let t=new Set((e?.windows||[]).map(s=>s.tone)),n=Math.max(-1,...(e?.windows||[]).map(s=>s.usedPercent??
-1));return t.has("critical")?"critical":t.has("warning")?"warning":e?.status==="stale"?"stale":e?.status==="fresh"&&e?.
localRuntime?.status==="running"||n>=0?"ok":"unknown"}function Th(e,t){let n=(Array.isArray(e?.windows)?e.windows:[]).map(
Rh).filter(Boolean).sort((a,i)=>i.usedPercent-a.usedPercent||a.label.localeCompare(i.label)),s={key:`${e?.provider_id||"\
provider"}:${e?.account_fingerprint||t}:${e?.quota_domain||"quota"}`,providerId:String(e?.provider_id||"unknown"),providerName:String(
e?.provider_name||"Provider"),quotaDomain:String(e?.quota_domain||""),dashboardUrl:e?.dashboard_url?String(e.dashboard_url):
"",accountFingerprint:String(e?.account_fingerprint||""),accountLabel:String(e?.account_label||"Local account"),plan:e?.
plan?String(e.plan):"",source:e?.source?String(e.source):"",sourceHistory:Array.isArray(e?.source_history)?e.source_history:
[],status:String(e?.status||"unavailable"),capturedAt:e?.captured_at?String(e.captured_at):"",staleAfter:e?.stale_after?
String(e.stale_after):"",nextRefreshAt:e?.next_refresh_at?String(e.next_refresh_at):"",cadenceClass:e?.cadence_class?String(
e.cadence_class):"",refreshIntervalMs:Math.max(0,Number(e?.refresh_interval_ms)||0),fastRefreshIntervalMs:Math.max(0,Number(
e?.fast_refresh_interval_ms)||0),idleRefreshIntervalMs:Math.max(0,Number(e?.idle_refresh_interval_ms)||0),watchBoostActive:e?.
watch_boost_active===!0,lastAttemptAt:e?.last_attempt_at?String(e.last_attempt_at):"",lastSuccessAt:e?.last_success_at?String(
e.last_success_at):"",consecutiveMisses:Math.max(0,Number(e?.consecutive_misses)||0),staleReason:e?.stale_reason?String(
e.stale_reason):"",manualRefreshAllowedAt:e?.manual_refresh_allowed_at?String(e.manual_refresh_allowed_at):"",lastGoodCapturedAt:e?.
last_good_captured_at?String(e.last_good_captured_at):"",windows:n,credits:e?.credits&&typeof e.credits=="object"?e.credits:
null,financials:Sh(e?.financials),localRuntime:Ch(e?.local_runtime),cloudUsage:xh(e?.cloud_usage),resetCredits:e?.reset_credits&&
typeof e.reset_credits=="object"?e.reset_credits:null,error:e?.error&&typeof e.error=="object"?e.error:null,requestCount:Math.
max(0,Number(e?.request_count)||0),latencyMs:Number.isFinite(Number(e?.latency_ms))?Number(e.latency_ms):null,sessionCount:Math.
max(0,Number(e?.session_count)||0),harnessTypes:Array.isArray(e?.mapped_harness_types)?e.mapped_harness_types.map(String).
sort():[]};return s.tone=Mh(s),s.maximumUsedPercent=n.length>0?Math.max(...n.map(a=>a.usedPercent)):null,s}function fl(e){
let t=Array.isArray(e?.snapshots)?e.snapshots:[],n=new Map;t.map(Th).forEach(S=>{let R=n.get(S.key),u=Date.parse(R?.capturedAt||
"")||0,v=Date.parse(S.capturedAt||"")||0;(!R||v>=u)&&n.set(S.key,S)});let s=[...n.values()].sort((S,R)=>(dp[R.status]||0)-
(dp[S.status]||0)||(R.maximumUsedPercent??-1)-(S.maximumUsedPercent??-1)||S.providerName.localeCompare(R.providerName)||
S.accountLabel.localeCompare(R.accountLabel)),a=new Set(s.map(S=>S.providerId)),i=s.filter(S=>S.windows.length>0||S.credits||
S.resetCredits||S.financials||S.localRuntime||S.cloudUsage).length,c=s.filter(S=>["warning","critical"].includes(S.tone)&&
S.maximumUsedPercent<100).length,d=s.filter(S=>S.maximumUsedPercent>=100).length,f=Number(e?.generation)||0,h=e?.in_flight===
!0,b=s.filter(S=>S.status==="fresh").length,N=s.filter(S=>S.status==="stale").length,x=h?"refreshing":f===0&&s.length===
0?"not-started":s.length===0||b===s.length?"ready":b>0?"partial":N>0?"stale":"unavailable";return{schemaVersion:Number(e?.
schema_version)||0,generation:f,generatedAt:e?.generated_at?String(e.generated_at):"",pollIntervalMs:Math.max(0,Number(e?.
poll_interval_ms)||0),cadenceMode:e?.cadence_mode==="watching"?"watching":"idle",inFlight:h,collectionState:x,summaryAuthoritative:f>
0||s.length>0,estimatedCost:$h(e?.estimated_cost),entries:s,summary:{providers:a.size,accounts:s.length,reporting:i,nearLimit:c,
exhausted:d}}}function gl(e,t){if(!t||typeof t!="object")return e;if(!e||typeof e!="object")return t;let n=Math.max(0,Number(
e.generation)||0),s=Math.max(0,Number(t.generation)||0);if(s<n)return e;let a=Array.isArray(e.snapshots)?e.snapshots:[],
i=Array.isArray(t.snapshots)?t.snapshots:[];return s===n&&a.length>0&&i.length===0?t.in_flight===!0&&e.in_flight!==!0?{...e,
in_flight:!0}:e:t}function Xs(e){return Array.isArray(e)?e.filter(t=>t&&typeof t=="object").map(t=>({...t})):[]}function bo(e){
if(e==null||e==="")return null;let t=Number(e);return Number.isFinite(t)?Math.max(0,t):null}function $h(e){return!e||typeof e!=
"object"?null:{schemaVersion:Number(e.schema_version)||0,catalogVersion:String(e.catalog_version||""),label:String(e.label||
"Local estimated API-equivalent cost"),status:String(e.status||"unavailable"),generatedAt:e.generated_at?String(e.generated_at):
"",range:e.range&&typeof e.range=="object"?e.range:{days:365,since:"",until:""},tokens:{input:bo(e.tokens?.input),cached:bo(
e.tokens?.cached),output:bo(e.tokens?.output)},costUsd:bo(e.cost_usd),records:bo(e.records),byProvider:Xs(e.by_provider),
byModel:Xs(e.by_model),byProject:Xs(e.by_project),byDay:Xs(e.by_day),bySpeed:Xs(e.by_speed),dailyBreakdown:Xs(e.daily_breakdown),
unknownModels:Xs(e.unknown_models),scan:e.scan&&typeof e.scan=="object"?e.scan:{},reasonCode:String(e.reason_code||""),reasonPath:String(
e.reason_path||""),lastGoodGeneratedAt:e.last_good_generated_at?String(e.last_good_generated_at):"",detail:e.detail&&typeof e.
detail=="object"?{totalRows:Math.max(0,Number(e.detail.total_rows)||0),inlineRows:Math.max(0,Number(e.detail.inline_rows)||
0),pageSize:Math.max(0,Number(e.detail.page_size)||0),nextCursor:e.detail.next_cursor==null?"":String(e.detail.next_cursor),
truncated:e.detail.truncated===!0,collections:Xs(e.detail.collections)}:null}}function Ar(e,t,n,s){e.has(t)||e.set(t,Object.
fromEntries(s.map(i=>[i,n[i]])));let a=e.get(t);a.input=(Number(a.input)||0)+(Number(n.input)||0),a.cached=(Number(a.cached)||
0)+(Number(n.cached)||0),a.output=(Number(a.output)||0)+(Number(n.output)||0),a.cost_usd=(Number(a.cost_usd)||0)+(Number(
n.cost_usd)||0),a.records=(Number(a.records)||0)+(Number(n.records)||0)}function pp(e,t={}){if(!e)return null;let n=Math.
max(1,Math.min(365,Number(t.days)||1)),s=Date.parse(`${e.range?.until||new Date().toISOString().slice(0,10)}T00:00:00.00\
0Z`),a=s-(n-1)*24*60*60*1e3,i=e.dailyBreakdown.filter(h=>{let b=Date.parse(`${h.day}T00:00:00.000Z`);return Number.isFinite(
b)&&b>=a&&b<=s&&(!t.project||h.project===t.project)&&(!t.providerId||h.provider_id===t.providerId)}),c={provider:new Map,
model:new Map,project:new Map,day:new Map,speed:new Map},d={input:0,cached:0,output:0,cost_usd:0,records:0};i.forEach(h=>{
Ar(new Map([["total",d]]),"total",h,[]),Ar(c.provider,h.provider_id,h,["provider_id"]),Ar(c.model,`${h.provider_id}|${h.
model}`,h,["provider_id","model"]),Ar(c.project,`${h.provider_id}|${h.project}`,h,["provider_id","project"]),Ar(c.day,h.
day,h,["day"]),Ar(c.speed,h.speed,h,["speed"])});let f=h=>[...h.values()].map(b=>({...b,cost_usd:Number((b.cost_usd||0).
toFixed(8))}));return{days:n,tokens:{input:d.input,cached:d.cached,output:d.output},costUsd:Number(d.cost_usd.toFixed(8)),
records:d.records,byProvider:f(c.provider),byModel:f(c.model),byProject:f(c.project),byDay:f(c.day),bySpeed:f(c.speed)}}
function Jt(e){let t=Number(e);return Number.isFinite(t)?`${Number.isInteger(t)?t:t.toFixed(2).replace(/0+$/,"").replace(
/\.$/,"")}%`:"Unavailable"}function vo(e){let t=Number(e);return!Number.isFinite(t)||t<0?"Unavailable":t<1e6?`${Math.round(
t/1e3)} us`:t<1e9?`${(t/1e6).toFixed(1).replace(/\.0$/,"")} ms`:`${(t/1e9).toFixed(2).replace(/0+$/,"").replace(/\.$/,"")}\
 s`}function mp(e){let t=Number(e);return!Number.isFinite(t)||t<0?"Unavailable":`${t.toFixed(2).replace(/0+$/,"").replace(
/\.$/,"")} tokens/s`}function Na(e,t=Date.now()){let n=Date.parse(e||"");if(!Number.isFinite(n))return"Not yet refreshed";
let s=Math.max(0,Math.floor((t-n)/1e3));if(s<10)return"Updated just now";if(s<60)return`Updated ${s}s ago`;let a=Math.floor(
s/60);return a<60?`Updated ${a}m ago`:`Updated ${Math.floor(a/60)}h ${a%60}m ago`}function Sa(e,t=Date.now()){let n=Date.
parse(e||"");if(!Number.isFinite(n))return e?String(e):"";let s=Math.max(0,Math.floor((n-t)/1e3)),a=Math.floor(s/60),i=s<
60?`${s}s`:a<60?`${a}m`:`${Math.floor(a/60)}h ${a%60}m`,c=new Date(n).toLocaleString([],{month:"short",day:"numeric",hour:"\
numeric",minute:"2-digit"});return`in ${i} (${c})`}function hl(e){if(!e||typeof e!="object")return"";if(e.unlimited===!0)
return"Unlimited credits";let t=e.balance!=null&&e.balance!==""&&Number.isFinite(Number(e.balance));if(e.unit&&t)return`${e.
balance} ${e.unit}`;let n=e.currency==="USD"?"$":e.currency?`${e.currency} `:"";return t?`${n}${Number(e.balance).toFixed(
2)} balance`:""}function wa(e){return!e||e.amount==null||e.amount===""||!Number.isFinite(Number(e.amount))?"Not reported":
`${e.currency==="USD"?"$":e.currency?`${e.currency} `:""}${Number(e.amount).toFixed(2)}`}function _l(e){if(!e)return[];let t=[];
return e.prepaidBalance&&t.push({id:"prepaid-balance",label:"Available prepaid balance",value:wa(e.prepaidBalance)}),e.extraUsageSpend&&
t.push({id:"extra-spend",label:"Extra-usage spend",value:wa(e.extraUsageSpend)}),e.extraUsageCap&&t.push({id:"extra-cap",
label:"Extra-usage cap",value:wa(e.extraUsageCap)}),!e.extraUsageEnabled&&(e.extraUsageSpend||e.extraUsageCap)&&t.push({
id:"extra-status",label:"Extra usage",value:"Disabled"}),e.reportedSpend&&t.push({id:"reported-spend",label:"Provider-re\
ported spend",value:wa(e.reportedSpend)}),e.includedSpend&&t.push({id:"included-spend",label:"Included spend bucket",value:wa(
e.includedSpend)}),e.bonusSpend&&t.push({id:"bonus-spend",label:"Bonus spend bucket",value:wa(e.bonusSpend)}),e.planLimit&&
t.push({id:"plan-limit",label:"Reported plan limit",value:wa(e.planLimit)}),e.reportedSpend&&!e.allowanceRemaining&&t.push(
{id:"allowance-remaining",label:"Available allowance",value:"Not reported by provider"}),e.poolClassification?.status===
"unavailable"&&t.push({id:"pool-classification",label:"First/third-party pools",value:e.poolClassification.warning||"Not\
 reported by provider"}),t}var{useState:Re,useEffect:bl,useRef:xe,useCallback:Pt}=React;var hp=1024*1024,Eh=15e3,_p=3,Lh=new Set(["history_chunk_throttled","history_chunk_duplicate_cursor","history_waiter_cap\
acity","history_request_capacity","throttled"]),qh=15e3,Ph=Object.freeze({queued:1e4,accepted:3e4,launch_accepted:3e4,delivered:3e4,
steered:3e4}),bp=[250,500,1e3,2e3,3e3],$i=512,Ih=new Set(["history","history_snapshot","history_chunk","transcript_resyn\
c_required","chat_list"]);function ys(e,t,n,s=$i){let a={...e||{}};Object.prototype.hasOwnProperty.call(a,t)&&delete a[t],
a[t]=n;let i=Object.keys(a),c=i.length-Math.max(1,Number(s)||$i);for(let d=0;d<c;d+=1)delete a[i[d]];return a}function Oh(e){
let n=(e instanceof Map?[...e.values()]:Object.values(e||{})).filter(a=>a&&typeof a=="object"),s=n.filter(a=>a.aggregateOnly!==
!0).length;return{active:n.length>0,aggregateOnly:s===0,consumerCount:n.length,detailConsumerCount:s}}function Js(e,t){let n=Object.
entries(t||{});if(!n.length)return e;let s=!1,a={...e};return n.forEach(([i,c])=>{Object.is(e[i],c)||fn(e[i]??null,c??null)||
(a[i]=c,s=!0)}),s?a:e}function Dh(e,t,n){return(e==="history_snapshot"||e==="history")&&!t?.partial&&(!t?.mode||t.mode===
"full")?!1:!!(t?.partial||t?.mode==="tail"||n?.mode==="chunked"||n?.partial)}function Ei(e){return e?e.source_message_id?
`source${e.source_message_id}`:e.native_source_id?`native${e.native_source_id}`:e.id!=null?`id${e.id}`:e.server_message_id!=
null?`server${e.server_message_id}`:e.sequence!=null&&e.ts!=null?`seq${e.sequence}${e.ts}${e.role||""}`:e.client_message_id?
`client${e.client_message_id}`:e.client_msg_id?`client${e.client_msg_id}`:"":""}function jh(e,t){if(!e||!t)return!1;let n=Ei(
e),s=Ei(t);return n&&s?n===s:e.role===t.role&&String(e.content||"")===String(t.content||"")}function vp(e,t){let n=Array.
isArray(e)?e:[],s=(Array.isArray(t)?t:[]).filter(i=>i?._optimistic&&i?._cid);if(s.length===0)return n;let a=[...n];return s.
forEach(i=>{let c=a.findIndex(d=>d?.role==="user"&&(d.client_message_id===i._cid||d.client_msg_id===i._cid||String(d.content||
"")===String(i.content||"")));if(c>=0){let d=a[c]?.status;a[c]={...a[c],_cid:i._cid,_optimistic:!0,_delivered:i._delivered||
a[c]._delivered||d==="delivered"||d==="agent_started",_agentStarted:i._agentStarted||a[c]._agentStarted||d==="agent_star\
ted",_sendError:d==="failed"?a[c].failure_code||i._sendError||"Send failed":i._sendError||null}}else a.push(i)}),a}function yp(e,t){
let n=Array.isArray(e)?e:[],s=Array.isArray(t)?t:[];if(!n.length)return s;if(!s.length)return n;let a=Math.min(n.length,
s.length);for(let i=a;i>=1;i--){let c=!0;for(let d=0;d<i;d++)if(!jh(n[n.length-i+d],s[d])){c=!1;break}if(c)return i===s.
length?n:[...n,...s.slice(i)]}return null}function yo(e){let t=Array.isArray(e)?e:[],n=s=>{let a=String(s?.content||"");
return/\*\*(?:Claude Code|Codex|Cursor) CLI is waiting for a native transcript\.\*\*/i.test(a)&&/placeholder will be replaced with the real CLI chat history/i.
test(a)};return!t.some(n)||!t.some(s=>!n(s))?t:t.filter(s=>!n(s))}function wp(e,t){let n=e?.agent_type||e?.agentType||"";
if(n!=="codex_cli"&&n!=="cursor_cli"||!Array.isArray(t)||t.length!==1)return!1;let s=t[0];return s?.role!=="assistant"?!1:
/\*\*(?:Codex|Cursor) CLI is waiting for a native transcript\.\*\*/.test(String(s.content||""))}function kp(e,t={}){let n={},
s={},a={};return(e||[]).forEach(i=>{if(!i||typeof i!="object"||!i.session_id||!i.activity)return;let c=i.activity.kind||
"working",d=i.activity.label||(c==="idle"?"":"Working");n[i.session_id]={kind:c,label:d,updatedAt:i.activity.updated_at||
null,observed_at:i.activity.observed_at||t[i.session_id]?.observed_at||null,startedAt:i.activity.started_at||null,interruptHint:i.
activity.interrupt_hint||"",goal:i.activity.goal||null,goal_run:i.activity.goal_run||null,thinking:i.activity.thinking||
null,current:i.activity.current||null,step:i.activity.step||null,usage:i.activity.usage||null,task_list:i.activity.task_list||
null,context_card:i.activity.context_card||null,thinkingContent:i.activity.thinking?.text||i.activity.thinkingContent||"",
transport:i.activity.transport||t[i.session_id]?.transport||null},s[i.session_id]=i.activity.thinking?.text||i.activity.
thinkingContent||"",a[i.session_id]=["thinking","generating","running_command","applying_patch","reading_files","working"].
includes(c)?d:!1}),{activities:n,thinkingContent:s,thinking:a}}function Np(){let[e,t]=Re(()=>yi()),n=e.list,s=Pt(r=>{t(m=>{
let k=typeof r=="function"?r(m.list):r;return fo(m,k)})},[]),a=tl,i=Bd,[c,d]=Re({}),[f,h]=Re({}),[b,N]=Re(!1),[x,S]=Re({
state:"connecting",rttMs:null,lastAckAt:null}),[R,u]=Re({}),[v,g]=Re({}),[w,y]=Re({}),[E,T]=Re({}),[H,K]=Re({}),[te,ne]=Re(
{}),[oe,G]=Re({}),[de,Ne]=Re([]),[J,ve]=Re({}),[ge,Z]=Re(null),[he,Q]=Re({}),[U,V]=Re({}),[ie,I]=Re({}),[W,re]=Re([]),[$,
z]=Re({}),[fe,we]=Re({}),[ye,Ce]=Re({}),[Te,Le]=Re({}),[At,le]=Re({}),[De,j]=Re({}),[se,Se]=Re({}),[Fe,ht]=Re({}),[en,O]=Re(
{}),[dt,Wt]=Re({}),[qn,Pn]=Re({}),[In,$a]=Re([]),[Lr,Ea]=Re([]),[ta,ns]=Re(null),[La,qa]=Re(null),[ec,To]=Re(null),[On,$o]=Re(
null),[qr,Pa]=Re(null),[na,Ia]=Re(null),[sa,Rt]=Re(null),[Eo,_n]=Re(null),[Pr,ss]=Re([]),[tc,ws]=Re([]),[nc,aa]=Re({id:"",
status:"idle",aggregateOnly:!0,resumed:!1,consumerCount:0,detailConsumerCount:0}),[sc,ra]=Re({}),[ac,Lo]=Re([]),bn=xe({}),
as=xe({}),zt=xe({}),Ns=xe({}),Ir=xe({}),pt=xe({}),Ss=xe({}),_t=xe({}),p=xe(null),Oa=xe(""),Da=xe([]),Or=xe(0),qo=xe(0),rs=xe(
null),oa=xe(null),vn=xe(null),Dn=xe(null),Po=xe(0),bt=xe(1e4),ja=xe(3e4),os=xe([]),jn=xe(null),Ba=xe(null),Ot=xe(vd()),ia=xe(
tp()),Io=xe(0),yn=xe({}),is=xe(0),Cs=xe({}),tt=xe({}),Ye=xe({}),vt=xe({}),ca=xe({}),Fa=xe(!1),kn=xe(new Map),wn=xe(null),
mt=xe({}),yt=xe(null),tn=xe(new Map),Mt=xe(new Map),lt=xe({active:!1,aggregateOnly:!0,consumerCount:0,detailConsumerCount:0}),
Ke=xe(""),Ha=xe(!0),Tt=xe(""),Ua=xe(0),cs=xe({system:"",detail:""}),Dt=xe({system:0,detail:0}),Nn=xe({system:0,detail:0});
function st(r){return!!Pd(r)}function Oo(r,m,k=null){if(mt.current={...mt.current,[r]:m},tn.current.set(r,{stream:m,streamTrace:k}),
yt.current!=null)return;let q=typeof requestAnimationFrame=="function"?requestAnimationFrame:l=>setTimeout(l,16);yt.current=
q(()=>{yt.current=null;let l=[...tn.current.entries()];tn.current.clear(),l.length&&(ra(C=>{let L={...C};return l.forEach(
([B,ee])=>{L[B]=ee.stream}),L}),l.forEach(([C,L])=>{L.streamTrace&&Vr({stream_trace:L.streamTrace},C)}))})}function Do(r,m=null){
if(!r||mt.current[r]?.open)return;let q=Vc(r,m);mt.current={...mt.current,[r]:q},ra(l=>({...l,[r]:q}))}function Ga(r){if(!r||
!mt.current[r])return;let m={...mt.current};delete m[r],mt.current=m,tn.current.delete(r),ra(k=>{if(!k[r])return k;let q={
...k};return delete q[r],q})}function rc(){mt.current={},tn.current.clear(),ra({})}function jo(){let r=wn.current;wn.current=
null,r&&(r.kind==="idle"&&typeof cancelIdleCallback=="function"?cancelIdleCallback(r.id):clearTimeout(r.id))}function Bo(){
if(wn.current||kn.current.size===0)return;let r=()=>{wn.current=null;let m=kn.current.entries().next();if(m.done)return;
let[k,q]=m.value;kn.current.delete(k),Ba.current?.(q),Bo()};typeof requestIdleCallback=="function"?wn.current={kind:"idl\
e",id:requestIdleCallback(r,{timeout:250})}:wn.current={kind:"timer",id:setTimeout(r,32)}}function Wa(){requestAnimationFrame(
()=>requestAnimationFrame(()=>{Fa.current=!0,Bo()}))}let ke=Pt(r=>{p.current?.readyState===WebSocket.OPEN&&p.current.send(
JSON.stringify(r))},[]),xs=Pt((r=!1,m=null)=>{let k=`provider-usage-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
return $o({requestId:k,status:"requested",provider_id:m||null}),ke({type:"provider_usage_refresh",protocol_version:1,force:r===
!0,...m?{provider_id:m}:{},request_id:k}),k},[ke]),ls=Pt(r=>{ke({type:"provider_usage_watch",protocol_version:1,active:r===
!0})},[ke]),la=Pt(()=>{let r=`provider-reset-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return Pa({requestId:r,
status:"requested"}),ke({type:"provider_usage_reset_credit_consume",protocol_version:1,request_id:r,approved:!0}),r},[ke]),
Dr=Pt((r={})=>{let m=`provider-cost-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,k={days:Math.max(1,Math.min(
365,Number(r.days)||365)),providerId:r.providerId?String(r.providerId):"",project:r.project?String(r.project):"",cursor:/^\d+$/.
test(String(r.cursor??"0"))?String(r.cursor??"0"):"0",pageSize:Math.max(1,Math.min(256,Number(r.pageSize)||256))};return Ia(
{requestId:m,status:"loading",query:k,detail:null,error:null}),ke({type:"provider_usage_cost_detail_request",protocol_version:1,
request_id:m,days:k.days,provider_id:k.providerId||null,project:k.project||null,cursor:k.cursor,page_size:k.pageSize}),m},
[ke]),za=Pt((r=!1)=>{let m=`host-resource-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return _n(null),ke({type:"\
host_resource_refresh",protocol_version:1,force:r===!0,aggregate_only:lt.current.aggregateOnly===!0,request_id:m}),m},[ke]),
nn=Pt(()=>{Rt(null),_n(null),ss([]),ws([]),Dt.current={system:0,detail:0},Nn.current={system:0,detail:0}},[]),$t=Pt((r,m="")=>{
let k=`host-resource-subscribe-${Date.now()}-${++Ua.current}`;return Tt.current=k,_n(null),aa(q=>({...q,status:m?"reconn\
ecting":"subscribing",aggregateOnly:r===!0})),ke({type:"host_resource_subscribe",protocol_version:1,request_id:k,...m?{resume_subscription_id:m}:
{},aggregate_only:r===!0}),k},[ke]),As=Pt((r,m=0)=>{let k=r==="detail"?"detail":"system",q=Ke.current;if(!q)return null;
let l=`host-resource-history-${k}-${Date.now()}-${++Ua.current}`;return cs.current[k]=l,ke({type:"host_resource_history_\
request",protocol_version:1,request_id:l,subscription_id:q,stream:k,after_sequence:Math.max(0,Math.round(Number(m)||0)),
max_points:k==="detail"?8:64}),l},[ke]),Sn=Pt(()=>{let r=lt.current,m=Oh(Mt.current);lt.current=m;let k=Ke.current;return m.
active?(aa(q=>({...q,aggregateOnly:m.aggregateOnly,consumerCount:m.consumerCount,detailConsumerCount:m.detailConsumerCount})),
r.active?(r.aggregateOnly===m.aggregateOnly||(m.aggregateOnly&&(ss(q=>Ys([],q,60)),ws([]),Rt(null),cs.current.detail="",
Dt.current.detail=0,Nn.current.detail=0),k&&$t(m.aggregateOnly,k)),k||null):(nn(),$t(m.aggregateOnly,""),null)):(Ke.current=
"",Tt.current="",cs.current={system:"",detail:""},Ha.current=!0,k&&ke({type:"host_resource_unsubscribe",protocol_version:1,
request_id:`host-resource-unsubscribe-${Date.now()}-${++Ua.current}`,subscription_id:k}),nn(),aa({id:"",status:"idle",aggregateOnly:!0,
resumed:!1,consumerCount:0,detailConsumerCount:0}),null)},[nn,ke,$t]),Fo=Pt((r=!1,m="dashboard")=>{let k=String(m||"dash\
board").trim().slice(0,64)||"dashboard",q=r===!0;return Mt.current.get(k)?.aggregateOnly===q?Ke.current||null:(Mt.current.
set(k,{aggregateOnly:q}),Sn())},[Sn]),Va=Pt((r="dashboard")=>{let m=String(r||"dashboard").trim().slice(0,64)||"dashboar\
d";return Mt.current.delete(m)?Sn():Ke.current||null},[Sn]),Bn=Pt(r=>{let m=[...new Set((Array.isArray(r)?r:[]).filter(k=>typeof k==
"string"&&k.length>0))].sort().slice(0,128);m.length===Da.current.length&&m.every((k,q)=>k===Da.current[q])||(Da.current=
m,p.current?.readyState===WebSocket.OPEN&&p.current.send(JSON.stringify({type:"subscribe",protocol_version:1,request_id:`\
web-sub-${Date.now()}-${++Or.current}`,sessions:m})))},[]);function ua(){oa.current&&clearInterval(oa.current),vn.current&&
clearTimeout(vn.current),oa.current=null,vn.current=null,Dn.current=null}function Fn(r=p.current){if(!r||r.readyState!==
WebSocket.OPEN||Dn.current)return;let m=`web-hb-${Date.now()}-${++Po.current}`,k=Date.now();Dn.current={requestId:m,sentAt:k},
r.send(JSON.stringify({type:"heartbeat",protocol_version:1,request_id:m,client_ts:new Date(k).toISOString()})),vn.current=
setTimeout(()=>{if(Dn.current?.requestId===m){Dn.current=null,vn.current=null,S({state:"stale",rttMs:null,lastAckAt:null});
try{r.close()}catch{}}},ja.current)}function Ho(r,m=p.current){ua(),bt.current=Math.max(1e3,Number(r?.heartbeat_interval_ms)||
1e4),ja.current=Math.max(bt.current*2,Number(r?.heartbeat_timeout_ms)||3e4),Fn(m),oa.current=setInterval(()=>Fn(m),bt.current)}
function da(r){let m=Dn.current;if(!m||m.requestId!==r.request_id)return;vn.current&&clearTimeout(vn.current),vn.current=
null,Dn.current=null;let k=Math.max(0,Date.now()-m.sentAt),q=k<=500?"healthy":k<=2e3?"slow":"poor";S({state:q,rttMs:k,lastAckAt:Date.
now()})}function jt(r){let m=as.current[r];m&&clearTimeout(m),delete as.current[r]}function ft(r,m){if(r){if(!Object.prototype.
hasOwnProperty.call(zt.current,r)&&Object.keys(zt.current).length>=$i){let k=Object.keys(zt.current)[0];jt(k),delete Ns.
current[k]}zt.current=ys(zt.current,r,m),ne(k=>ys(k,r,m))}}function Vt(r,m){!r||!m||(Ns.current=ys(Ns.current,r,m))}function us(r,m,k){
r&&i(q=>{let l=Zd(q,r,m||Ns.current[r]||"");return l?(Vt(r,l),ep(q,r,l,k)):q})}function Et(r,m,k=""){r&&zt.current[r]!==
"agent_started"&&(jt(r),ft(r,"failed"),us(r,k,q=>({...q,_sendError:m||"Send failed"})))}function at(r,m,k){jt(r);let q=Ph[m];
q&&(as.current[r]=setTimeout(()=>{delete as.current[r],zt.current[r]===m&&Et(r,k)},q))}bl(()=>{_t.current=ie},[ie]),bl(()=>{
Ir.current=he},[he]);function oc(r,m){return`${r}:${m}`}function ds(r,m){!Object.prototype.hasOwnProperty.call(pt.current,
r)&&Object.keys(pt.current).length>=$i&&Rs(Object.keys(pt.current)[0]),pt.current=ys(pt.current,r,m),O(pt.current)}function Rs(r){
let m=Ss.current[r];m&&clearTimeout(m),delete Ss.current[r]}function Ms(r,m){let k=pt.current[r];if(!k||!["pending","awa\
iting_config"].includes(k.status))return;Rs(r);let l={..._t.current[k.sessionId]||{},[k.configKey]:k.previousValue};_t.current=
{..._t.current,[k.sessionId]:l},I(C=>({...C,[k.sessionId]:{...C[k.sessionId]||{},[k.configKey]:k.previousValue}})),ds(r,
{...k,status:"failed",error:m||"Control change failed and was rolled back.",completedAt:Date.now()})}function Kt(r,m,k,q,l,C){
let L=oc(r,m);Rs(L);let B=_t.current[r]||{},ee={sessionId:r,field:m,configKey:k,requestId:C,previousValue:B[k],requestedValue:q,
status:"pending",error:null,startedAt:Date.now()},Y={...B,[k]:q};return _t.current={..._t.current,[r]:Y},I(be=>({...be,[r]:{
...be[r]||{},[k]:q}})),ds(L,ee),Ss.current[L]=setTimeout(()=>Ms(L,"Timed out waiting for the agent to confirm this setti\
ng."),qh),ke({...l,session_id:r,request_id:C}),C}function Lt(r,m){Object.entries(pt.current).forEach(([k,q])=>{q.sessionId!==
r||!["pending","awaiting_config"].includes(q.status)||Object.prototype.hasOwnProperty.call(m,q.configKey)&&m[q.configKey]===
q.requestedValue&&(Rs(k),ds(k,{...q,status:"ok",error:null,completedAt:Date.now()}))})}let Yt=Pt(()=>{jo(),Fa.current=!1,
kn.current.clear();let r=location.protocol==="https:"?"wss":"ws",m=new WebSocket(`${r}://${location.host}/client-ws`);p.
current=m,m.onopen=()=>{qo.current=0,N(!0),S({state:"connecting",rttMs:null,lastAckAt:null}),m.send(JSON.stringify({type:"\
subscribe",protocol_version:1,request_id:`web-sub-${Date.now()}-${++Or.current}`,sessions:Da.current})),lt.current.active&&
$t(lt.current.aggregateOnly,Ke.current)},m.onclose=()=>{if(ua(),Object.entries(pt.current).forEach(([l,C])=>{["pending",
"awaiting_config"].includes(C?.status)&&Ms(l,"Connection changed before the native setting was confirmed. Retry after re\
connecting.")}),Object.values(tt.current).forEach(l=>clearTimeout(l)),tt.current={},Object.keys(Ye.current).forEach(l=>{
Ye.current[l]={...Ye.current[l]||{},inFlight:!1}}),h({}),rc(),N(!1),S({state:"offline",rttMs:null,lastAckAt:null}),lt.current.
active&&aa(l=>({...l,status:"reconnecting"})),p.current!==m)return;let k=qo.current++,q=bp[Math.min(k,bp.length-1)];rs.current=
setTimeout(()=>{rs.current=null,Yt()},q)},m.onmessage=k=>{let q;try{q=JSON.parse(k.data)}catch{return}q.stream_trace&&typeof q.
stream_trace=="object"&&(q.stream_trace={...q.stream_trace,browser_received_at_ms:Date.now()}),Ba.current(q)}},[ke,$t]);
bl(()=>(Yt(),()=>{rs.current&&clearTimeout(rs.current),ua(),Object.values(as.current).forEach(m=>clearTimeout(m)),as.current=
{},Object.values(Ss.current).forEach(m=>clearTimeout(m)),Ss.current={},jo(),yt.current!=null&&(typeof cancelAnimationFrame==
"function"?cancelAnimationFrame(yt.current):clearTimeout(yt.current),yt.current=null),tn.current.clear();let r=p.current;
p.current=null;try{r?.close()}catch{}}),[Yt]);function sn(r){let m=kp(r);T(k=>Js(k,kp(r,k).activities)),y(k=>Js(k,m.thinkingContent)),
g(k=>Js(k,m.thinking))}function Uo(r){let m=new Set((r||[]).map(l=>l&&typeof l=="object"?l.session_id:l).filter(Boolean)),
k=l=>{let C=!1,L={...l};return Object.keys(L).forEach(B=>{m.has(B)||(delete L[B],C=!0)}),C?L:l};Object.keys(bn.current).
forEach(l=>{m.has(l)||(clearTimeout(bn.current[l]),delete bn.current[l])}),[yn,Cs,Ye,vt,ca].forEach(l=>{Object.keys(l.current).
forEach(C=>{m.has(C)||delete l.current[C]})}),Object.keys(mt.current).forEach(l=>{m.has(l)||delete mt.current[l]});for(let l of tn.
current.keys())m.has(l)||tn.current.delete(l);Object.keys(tt.current).forEach(l=>{m.has(l)||(clearTimeout(tt.current[l]),
delete tt.current[l])});let q=!1;Object.entries(pt.current).forEach(([l,C])=>{m.has(C?.sessionId)||(Rs(l),delete pt.current[l],
q=!0)}),q&&O({...pt.current}),T(k),y(k),g(k),d(k),h(k),u(k),K(k),G(k),Q(k),V(k),I(k),z(k),we(k),Ce(k),Le(k),le(k),j(k),Se(
k),Wt(k),ra(k),Pn(l=>{let C=!1,L={...l};return Object.keys(L).forEach(B=>{let ee=B.indexOf(":"),Y=ee>=0?B.slice(0,ee):B;
m.has(Y)||(delete L[B],C=!0)}),C?L:l})}function Ts(r){let m={};(r||[]).forEach(k=>{!k||typeof k!="object"||!k.session_id||
typeof k.auto_approve_permissions=="boolean"&&(m[k.session_id]={auto_approve_permissions:k.auto_approve_permissions})}),
Object.keys(m).length>0&&I(k=>{let q=!1,l={...k};return Object.entries(m).forEach(([C,L])=>{let B={...l[C]||{},...L};fn(
l[C]||{},B)||(l[C]=B,q=!0)}),q?l:k})}function Xt(r){let m={};(r||[]).forEach(k=>{!k||typeof k!="object"||!k.session_id||
Array.isArray(k.chat_list)&&(m[k.session_id]=k.chat_list)}),z(k=>Js(k,m))}function Bt(r){let m={};(r||[]).forEach(k=>{!k||
typeof k!="object"||!k.session_id||k.status&&(m[k.session_id]=k.status)}),K(k=>Js(k,m))}function $s(r,m={}){let k=typeof r==
"string"?r:r?.session_id;if(!k||p.current?.readyState!==WebSocket.OPEN)return;let q=`hist-${Date.now()}-${++Io.current}`;
yn.current[k]=q;let l=Math.max(0,Math.floor(Number(m.afterSequence??m.after_sequence)||0)),C=l>0?"delta":m.full?"full":"\
tail";h(ee=>({...ee,[k]:{mode:C,requestedAt:Date.now(),requestId:q}}));let L={type:l>0?"history_request":"get_history",session:k,
session_id:k,request_id:q};l>0&&(L.after_sequence=l);let B=Number(m.limit||m.tailLimit||0);l<=0&&Number.isFinite(B)&&B>0&&
!m.full&&(L.limit=Math.floor(B),L.tail=!0),m.full&&(L.full=!0),ke(L)}function ps(r,m={}){let k=typeof r=="string"?r:r?.session_id;
if(!k||p.current?.readyState!==WebSocket.OPEN)return;let q=m.mode==="older"?"older":m.mode==="around"?"around":"tail",l=m.
source||"relay_sqlite",C=q==="around"||q==="tail"&&m.replace!==!1,L=m.beforeOffset??m.before_offset??null,B=m.beforeId??
m.before_id??null,ee=m.aroundId??m.around_id??null,Y=`${q}${l}${L??""}${B??""}${ee??""}`,be=Ye.current[k]||{},pe=Date.
now();if(be.inFlight&&q!=="around"||q==="older"&&be.lastRequestSig===Y&&pe-Number(be.lastRequestAt||0)<1500)return;let qe=`\
histchunk-${Date.now()}-${++is.current}`,We=Math.max(256*1024,Math.min(16*1024*1024,Number(m.chunkBytes||m.chunk_bytes||
hp)||hp));if(q!=="older"){let $e=Number(m.retryAttempt||0)>0?be.baselineMessageKeys:null,He=Array.isArray($e)?$e:(a[k]||
[]).map(kt).filter(Boolean);clearTimeout(tt.current[k]),Ye.current[k]={source:l,chunkBytes:We,limit:m.limit||null,inFlight:!0,
mode:q,replace:C,baselineMessageKeys:He,beforeOffset:L,beforeId:B,aroundId:ee,userInitiated:m.userInitiated===!0||m.user_initiated===
!0,retryAttempt:Number(m.retryAttempt||0),lastRequestSig:Y,lastRequestAt:pe}}else Ye.current[k]={...Ye.current[k]||{},source:l,
chunkBytes:We,limit:m.limit||Ye.current[k]?.limit||null,inFlight:!0,mode:q,beforeOffset:L,beforeId:B,aroundId:ee,userInitiated:m.
userInitiated===!0||m.user_initiated===!0,retryAttempt:Number(m.retryAttempt||0),lastRequestSig:Y,lastRequestAt:pe};Cs.current[k]=
qe,d($e=>{if(!$e[k]?.error)return $e;let He={...$e[k]};return delete He.error,{...$e,[k]:He}}),h($e=>({...$e,[k]:{mode:q,
kind:"chunked",requestedAt:Date.now(),requestId:qe}}));let Ue={type:"history_chunk_request",session:k,session_id:k,request_id:qe,
mode:q,source:l,replace:C,chunk_bytes:We},Ze=Number(m.limit||m.tailLimit||0);Number.isFinite(Ze)&&Ze>0&&(Ue.limit=Math.floor(
Ze)),(m.userInitiated||m.user_initiated)&&(Ue.user_initiated=!0),q==="older"&&L!=null&&(Ue.before_offset=L),q==="older"&&
B!=null&&(Ue.before_id=B),q==="around"&&ee!=null&&(Ue.around_id=ee),ke(Ue),tt.current[k]=setTimeout(()=>{if(delete tt.current[k],
Cs.current[k]!==qe)return;let $e=Ye.current[k]||{};if(!$e.inFlight)return;if(Ye.current[k]={...$e,inFlight:!1},jn.current!==
k){h(Be=>{if(Be[k]?.requestId!==qe)return Be;let rt={...Be};return delete rt[k],rt});return}let He=Number(m.retryAttempt||
0);if(He<_p&&jn.current===k&&p.current?.readyState===WebSocket.OPEN){ps(k,{...m,mode:q,source:l,beforeOffset:L,beforeId:B,
chunkBytes:We,retryAttempt:He+1});return}h(Be=>{if(Be[k]?.requestId!==qe)return Be;let rt={...Be};return delete rt[k],rt}),
d(Be=>({...Be,[k]:{...Be[k]||{},error:"Transcript history request timed out. Retry to load the latest messages."}}))},Eh)}
function kt(r){if(!r)return"";if(r.source_message_id)return`source${r.source_message_id}`;if(r.native_source_id)return`\
native${r.native_source_id}`;if(r.id!=null)return`id${r.id}`;if(r.server_message_id!=null)return`server${r.server_message_id}`;
if(r.sequence!=null&&r.ts!=null)return`seq${r.sequence}${r.ts}${r.role||""}`;if(r.client_msg_id)return`client${r.client_msg_id}`;
let m=Array.isArray(r.content_blocks)?JSON.stringify(r.content_blocks):"";return`${r.role||""}${r.content||""}${m}`}function ms(r,m,k){
let q=Array.isArray(r)?r:[],l=Array.isArray(m)?m:[];if(k==="older"){let Y=new Set(q.map(kt)),be=[];return l.forEach(pe=>{
let qe=kt(pe);Y.has(qe)||(Y.add(qe),be.push(pe))}),be.length?[...be,...q]:q}let C=yp(q,l);if(C)return C;let L=new Set(q.
map(kt)),B=[...q],ee=0;return l.forEach(Y=>{let be=kt(Y);L.has(be)||(L.add(be),B.push(Y),ee++)}),ee?B:q}function jr(r,m){
let k=Array.isArray(r)?r:[],q=Array.isArray(m)?m:[];if(!k.length)return q;if(!q.length)return k;let l=yp(k,q);if(l)return l;
let C=new Set(k.map(kt)),L=[...k],B=0;return q.forEach(ee=>{let Y=kt(ee);C.has(Y)||(C.add(Y),L.push(ee),B++)}),B?L:k}function Ka(r,m,k,q){
let l=Array.isArray(r)?r:[],C=Array.isArray(m)?m:[],L=new Set(Array.isArray(k?.baselineMessageKeys)?k.baselineMessageKeys:
[]);if((k?.source==="native"||q==="codex_cli_jsonl"||q==="cursor_cli_jsonl")&&L.size>C.length)return l;let ee=l.filter(Y=>{
let be=kt(Y);return be&&!L.has(be)});return ee.length===0?C:ms(C,ee,"tail")}function Es(r){return!r||typeof r!="object"?
!1:["codex","codex-desktop","cursor","codex_cli","cursor_cli","roo_code","cline"].includes(r.agent_type)}function pa(r){
r&&(i(m=>({...m,[r]:[]})),G(m=>({...m,[r]:[]})),g(m=>({...m,[r]:!1})),y(m=>({...m,[r]:""})),T(m=>({...m,[r]:!1})),d(m=>({
...m,[r]:null})),h(m=>{if(!m[r])return m;let k={...m};return delete k[r],k}))}function Br(r,m,k,q={}){let l=`prompt-${Date.
now()}-${Math.random().toString(36).slice(2,7)}`,C=typeof q.instruction=="string"?q.instruction.trim():"",L=Ir.current[r],
B=L?.type==="question_prompt",ee=q.action==="cancel"?"cancel":"answer",Y=k||(ee==="cancel"?"question_cancel":Array.isArray(
q.answers)?"question_answers":C?"alternate_instruction":null);Q(be=>be[r]?{...be,[r]:{...be[r],submitting_choice_id:Y,request_id:l,
error:null}}:be),ke(B?{type:"question_response",session_id:r,prompt_id:m,generation:L.generation,action:ee,...ee==="answ\
er"?{answers:q.answers||[]}:{},request_id:l}:{type:"permission_response",session_id:r,prompt_id:m,...k?{choice_id:k}:{},
...Array.isArray(q.answers)?{answers:q.answers}:{},...C?{instruction:C}:{},request_id:l})}function Go(r,m,k,q){let l=`er\
rprompt-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;V(C=>C[r]?{...C,[r]:{...C[r],submitting_action_id:k,request_id:l,
error:null}}:C),ke({type:"error_prompt_action",session_id:r,prompt_id:m,action_id:k,request_id:l,...k==="open_native_win\
dow"?{operator_user_gesture:q?.isTrusted===!0}:{}})}function Fr(r,m={}){let k=`interrupt-${Date.now()}-${Math.random().toString(
36).slice(2,7)}`;return ke({type:"agent_interrupt",session_id:r,request_id:k,connection_id:Oa.current,session_generation:Math.
max(0,Number(m.sessionGeneration)||0),turn_generation:Math.max(0,Number(m.turnGeneration)||0)}),k}function Ya(r,m,k,q={}){
let l=String(q.requestId||"").trim()||`goal-${m}-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return ke({type:"\
agent_goal_control",session_id:r,request_id:l,action:m,connection_id:Oa.current,session_generation:Math.max(0,Number(q.sessionGeneration)||
0),goal_generation:Math.max(0,Number(k?.generation)||0),goal_transition_seq:Math.max(0,Number(k?.transition_seq)||0),goal_fingerprint:String(
k?.fingerprint||"")}),l}function fs(r){let m=`cfg-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;ke({type:"agen\
t_config_request",session_id:r,request_id:m})}function Hn(r,m){let k=`model-${Date.now()}-${Math.random().toString(36).slice(
2,7)}`,l=(_t.current[r]||{}).config_semantics==="observed_and_next_send"?"next_send_model_id":"model_id";return Kt(r,"mo\
del",l,m,{type:"agent_set_model",model_id:m},k)}function Ls(r,m){let k=`effort-${Date.now()}-${Math.random().toString(36).
slice(2,7)}`,l=(_t.current[r]||{}).config_semantics==="observed_and_next_send"?"next_send_effort":"effort";return Kt(r,"\
effort",l,m,{type:"agent_set_effort",effort:m},k)}function Un(r,m){let k=`perm-${Date.now()}-${Math.random().toString(36).
slice(2,7)}`;return Kt(r,"permission_mode","permission_mode",m,{type:"agent_set_permission_mode",mode:m},k)}function qs(r,m){
let k=`autoperm-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return Kt(r,"auto_approve_permissions","auto_app\
rove_permissions",!!m,{type:"agent_set_auto_approve_permissions",enabled:!!m},k)}function Cn(r,m){let k=`mode-${Date.now()}\
-${Math.random().toString(36).slice(2,7)}`,q=Object.prototype.hasOwnProperty.call(_t.current[r]||{},"conversation_mode")?
"conversation_mode":"mode";return Kt(r,"mode",q,m,{type:"agent_set_mode",mode:m},k)}function gs(r,{model_id:m,effort:k,speed:q,
access_mode:l,permission_profile:C,confirm_bypass:L,workspace_mode:B}){let ee=`codex-cfg-${Date.now()}-${Math.random().toString(
36).slice(2,7)}`,Y=_t.current[r]||{},be=[["model","model_id",m],["effort","effort",k],["speed","speed",q],["access_mode",
"permission_mode",l],["workspace_mode","workspace_mode",B],["permission_profile","permission_profile",C]],[pe,qe,We]=be.
find(([,,Ue])=>Ue!=null)||["codex_config","model_id",m];return Kt(r,pe,qe,We,{type:"set_codex_config",model_id:m,effort:k,
speed:q,access_mode:l,permission_profile:C,confirm_bypass:L,workspace_mode:B,source_revision:Y.source_revision},ee)}function xn(r){
let m=`new-thread-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return pa(r),ke({type:"new_thread",session_id:r,
request_id:m}),m}function Ps(r){let m=`panel-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return ke({type:"op\
en_panel",session_id:r,request_id:m}),m}function an(r,m){let k=`native-${Date.now()}-${Math.random().toString(36).slice(
2,7)}`;return ke({type:"open_native_window",session_id:r,request_id:k,operator_user_gesture:m?.isTrusted===!0}),k}function hs(r){
let m=`chatlist-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return ke({type:"chat_list",session_id:r,request_id:m}),
m}function Gn(r,m){let k=`switch-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return ke({type:"switch_chat",session_id:r,
chat_id:m,request_id:k}),k}function Je(r){let m=`newchat-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return ke(
{type:"new_chat",session_id:r,request_id:m}),m}function Xa(r){let m=`threads-${Date.now()}-${Math.random().toString(36).
slice(2,7)}`;return ke({type:"thread_list",session_id:r,request_id:m}),m}function rn(r,m){let k=`swthread-${Date.now()}-${Math.
random().toString(36).slice(2,7)}`;return pa(r),ke({type:"switch_thread",session_id:r,thread_id:m,request_id:k}),k}function Wo(r){
let m=`term-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return ke({type:"terminal_output",session_id:r,request_id:m}),
m}function ic(r,m){let k=`termin-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return ke({type:"terminal_input",
session_id:r,request_id:k,text:m}),k}function Hr(r){let m=`diff-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
return ke({type:"file_changes",session_id:r,request_id:m}),m}function Ur(r,m,k){let q=`filechg-${Date.now()}-${Math.random().
toString(36).slice(2,7)}`;return ke({type:"file_change_response",session_id:r,change_id:m,action:k,request_id:q}),q}function ma(r,m){
let k=`dir-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return ke({type:"list_directory",session_id:r,request_id:k,
path:m||"."}),k}function Qa(r,m){let k=`file-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return ke({type:"re\
ad_file",session_id:r,request_id:k,path:m}),k}function Gr(r){let m=`skills-${Date.now()}-${Math.random().toString(36).slice(
2,7)}`;return ke({type:"skill_list",session_id:r,request_id:m}),m}function zo(r){let m=`automation-${Date.now()}-${Math.
random().toString(36).slice(2,7)}`;return ke({type:"automation_view_action",session_id:r,request_id:m}),m}function cc(r,m,k,q){
let l=`attach-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return ke({type:"send_attachment",session_id:r,request_id:l,
data:m,mime_type:k,filename:q}),l}function Vo(r,m){let k=`swws-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return Kt(
r,"workspace","file_access_scope",m,{type:"switch_workspace",folder_path:m},k)}function Wr(r){let m=`branches-${Date.now()}\
-${Math.random().toString(36).slice(2,7)}`;return ke({type:"branch_list",session_id:r,request_id:m}),m}function Ja(r,m){
let k=`swbranch-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return ke({type:"switch_branch",session_id:r,branch_name:m,
request_id:k}),k}function lc(r,m){let k=`newbranch-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return ke({type:"\
create_branch",session_id:r,branch_name:m,request_id:k}),k}function Ft(r,m,k={}){let q=`launch-${Date.now()}-${Math.random().
toString(36).slice(2,7)}`;return ve(l=>ys(l,q,{status:"launching",agentType:r})),ke({type:"launch_session",agent_type:r,
workspace_path:m||void 0,model_id:k.model_id||void 0,permission_mode:k.permission_mode||void 0,effort:k.effort||void 0,request_id:q}),
q}function uc(r,m,k,q={}){let l=`resume-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return ve(C=>ys(C,l,{status:"\
launching",agentType:m})),ke({type:"resume_session",source_session:r,agent_type:m||"claude",workspace_path:k||void 0,cli_session_id:q.
cli_session_id||void 0,model_id:q.model_id||void 0,permission_mode:q.permission_mode||void 0,request_id:l}),l}function An(r,m){
ke(m?{type:"dismiss_session",session:r}:{type:"close_session",session:r})}function dc(r,m,k=""){let q=k||`cmsg-${Date.now()}\
-${Math.random().toString(36).slice(2,8)}`;Vt(q,r);let l=k?(tl[r]||[]).find(L=>L._cid===q):null,C=kr(l)?.iso||new Date().
toISOString();return i(L=>{let B=L[r]||[],ee=k&&B.some(Y=>Y._cid===q);return{...L,[r]:ee?B.map(Y=>Y._cid===q?{...Y,content:m,
_optimistic:!0,_delivered:!1,_agentStarted:!1,_sendError:null}:Y):[...B,wr({role:"user",content:m,_cid:q,_optimistic:!0,
created_at:C})]}}),p.current?.readyState===WebSocket.OPEN?(ft(q,"queued"),at(q,"queued","Timed out waiting for relay acc\
eptance."),ke({type:"send",session:r,content:m,client_message_id:q,created_at:C})):os.current.length<20?(os.current=[...os.
current.filter(L=>L.cid!==q),{session:r,content:m,cid:q,created_at:C}],jt(q),ft(q,"offline_queued")):(ft(q,"queued"),Et(
q,"Offline send queue is full. Reconnect or retry after another message sends.")),q}function Is(){let r=p.current;if(!r||
r.readyState!==WebSocket.OPEN||os.current.length===0)return;let m=os.current;os.current=[],m.forEach(k=>{Vt(k.cid,k.session),
ft(k.cid,"queued"),at(k.cid,"queued","Timed out waiting for relay acceptance after reconnect."),r.send(JSON.stringify({type:"\
send",session:k.session,content:k.content,client_message_id:k.cid,created_at:k.created_at}))})}function Ko(r,m,k,q){let l={
type:"steer",session_id:r,client_message_id:m,content:k};q!=null&&(l.native_index=q),ke(l),m&&m.startsWith("native-")&&G(
C=>({...C,[r]:(C[r]||[]).filter(L=>L.cid!==m)}))}function pc(r,m){jt(m),delete zt.current[m],delete Ns.current[m],ke({type:"\
discard_queued",session_id:r,client_message_id:m}),G(k=>({...k,[r]:(k[r]||[]).filter(q=>q.cid!==m)})),ne(k=>{let q={...k};
return delete q[m],q}),i(k=>{let q=k[r]||[];return{...k,[r]:q.filter(l=>l._cid!==m)}})}function Yo(r,m,k){G(q=>({...q,[r]:(q[r]||
[]).map(l=>l.cid===m?{...l,content:k,content_blocks:(l.content_blocks||[]).map(C=>C?.type==="queued_message"?{...C,content:k}:
C)}:l)})),i(q=>{let l=q[r]||[];return{...q,[r]:l.map(C=>C._cid===m?{...C,content:k}:C)}}),ke({type:"edit_queued",session_id:r,
client_message_id:m,content:k})}function Za(r){r?.id&&Ne(m=>{let k=m.filter(q=>q.id!==r.id);return["completed","cancelle\
d"].includes(r.state)?k:[r,...k]})}async function zr(){let r=await fetch("/api/scheduled-sends",{credentials:"same-origi\
n"});if(!r.ok)throw new Error(`Could not load scheduled sends (${r.status})`);let m=await r.json();return Ne((m.scheduled_sends||
[]).filter(k=>!["completed","cancelled"].includes(k.state))),m.scheduled_sends||[]}async function Xo(r,m,k,q=null){let l=await fetch(
"/api/scheduled-sends",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify(
{session_id:r,content:m,trigger_kind:k,...k==="at"?{deliver_at:q}:{}})}),C=await l.json().catch(()=>({}));if(!l.ok)throw new Error(
C.error||`Could not schedule message (${l.status})`);return Za(C.scheduled_send),C.scheduled_send}async function Qo(r){let m=await fetch(
`/api/scheduled-sends/${encodeURIComponent(r)}`,{method:"DELETE",credentials:"same-origin"}),k=await m.json().catch(()=>({}));
if(!m.ok)throw new Error(k.error||`Could not cancel scheduled message (${m.status})`);return Za(k.scheduled_send),k.scheduled_send}
function Vr(r,m){if(!r?.stream_trace||typeof window>"u")return;let k={...r.stream_trace,session_id:m||r.session||r.session_id||
""},q=window.requestAnimationFrame||(l=>window.setTimeout(l,16));q(()=>q(()=>{let l=Array.isArray(window.__RAC_STREAM_TRACES__)?
window.__RAC_STREAM_TRACES__:[];l.push({...k,browser_paint_at_ms:Date.now()}),l.length>500&&l.splice(0,l.length-500),window.
__RAC_STREAM_TRACES__=l}))}function Os(r){let m=r.type;if(!ia.current.accept(r)||m==="navigation_started")return;m==="co\
nnection_ack"&&(Ot.current.reset(r.state_epoch),Oa.current=String(r.connection_id||""));let k=r.session||r.session_id||"",
q=m==="session_list"||m==="session_snapshot"||m==="proxy_session_snapshot"?"session_list":(m==="status"||m==="proxy_stat\
us"||m==="session_status"||m==="session_summary"||m==="session_patch")&&k?`status:${k}`:"";if(!(q&&!Ot.current.accept(r,
q))){if(m==="heartbeat_ack"){da(r);return}if(m==="provider_usage_snapshot"){r.snapshot&&typeof r.snapshot=="object"&&To(
l=>gl(l,r.snapshot));return}if(m==="provider_usage_threshold"){let l=new Set(Array.isArray(r.affected_session_ids)?r.affected_session_ids.
map(String):[]);l.size>0&&s(C=>C.map(L=>{let B=typeof L=="string"?L:L?.session_id;return l.has(B)?{...typeof L=="object"?
L:{},session_id:B,percent_used:Number.isFinite(Number(r.percent_used))?Number(r.percent_used):null,rate_limit_active:r.hard_limited===
!0,rate_limited_until:r.reset_hint||"unknown",usage_limit_provider:r.provider_id||null,usage_limit_window:r.window_label||
r.window_id||null}:L}));return}if(m==="provider_usage_refresh_receipt"){$o(l=>!l||!r.request_id||l.requestId===r.request_id?
{requestId:r.request_id||l?.requestId||"",status:r.status||"error",...r}:l);return}if(m==="provider_usage_reset_credit_r\
eceipt"){Pa(l=>l?.requestId&&r.request_id!==l.requestId?l:{requestId:r.request_id,status:r.status||"error",outcome:r.outcome||
null,availableCount:r.reset_credits_available,error:r.code||null});return}if(m==="provider_usage_cost_detail"){Ia(l=>l?.
requestId===r.request_id?{...l,status:"ready",detail:r.detail,error:null}:l);return}if(m==="provider_usage_cost_detail_e\
rror"){Ia(l=>l?.requestId===r.request_id?{...l,status:"error",error:r.code||"cost_detail_failed"}:l);return}if(m==="host\
_resource_snapshot"){r.snapshot&&typeof r.snapshot=="object"&&(Rt(r.snapshot),_n(null));return}if(m==="host_resource_sub\
scription_ack"){if(!lt.current.active||r.request_id!==Tt.current||typeof r.subscription_id!="string")return;let l=Ke.current,
C=r.subscription_id,L=r.resumed===!0&&l===C,B=r.aggregate_only===!0,ee=l===C&&Ha.current!==B;Ke.current=C,Ha.current=B,Tt.
current="",L?ee&&B&&(ss(Y=>Ys([],Y,60)),ws([]),Rt(null),cs.current.detail="",Dt.current.detail=0,Nn.current.detail=0):(ss(
[]),ws([]),Rt(null),Dt.current={system:0,detail:0},Nn.current={system:0,detail:0}),aa({id:C,status:"live",aggregateOnly:B,
resumed:L,consumerCount:lt.current.consumerCount,detailConsumerCount:lt.current.detailConsumerCount}),As("system",L?Dt.current.
system:0),B||As("detail",L?Dt.current.detail:0),lt.current.aggregateOnly!==B&&$t(lt.current.aggregateOnly,C);return}if(m===
"host_resource_history_chunk"){let l=r.chunk,C=l?.stream==="detail"?"detail":l?.stream==="system"?"system":"";if(!C||r.subscription_id!==
Ke.current||r.request_id!==cs.current[C])return;let L=Array.isArray(l.points)?l.points:[];if(C==="system"){let ee=lt.current.
aggregateOnly?60:900;ss(Y=>Ys(Y,L,ee))}else{if(lt.current.aggregateOnly)return;ws(Y=>Ys(Y,L,180));let ee=L.filter(Y=>Y&&
typeof Y=="object").sort((Y,be)=>Number(Y.sample_sequence||0)-Number(be.sample_sequence||0)).at(-1);ee&&Rt(ee)}let B=Math.
max(Dt.current[C],Math.round(Number(l.next_sequence)||0));Dt.current[C]=B,cs.current[C]="",l.done!==!0&&As(C,B);return}if(m===
"host_resource_live"){let l=r.point,C=Number(l?.sample_sequence);if(r.subscription_id!==Ke.current||!Number.isSafeInteger(
C)||C<=Nn.current.system)return;Nn.current.system=C,Dt.current.system=Math.max(Dt.current.system,C);let L=lt.current.aggregateOnly?
60:900;ss(B=>Ys(B,l,L)),_n(null);return}if(m==="host_resource_detail"){if(lt.current.aggregateOnly)return;let l=r.snapshot,
C=Number(l?.sample_sequence);if(r.subscription_id!==Ke.current||!Number.isSafeInteger(C)||C<=Nn.current.detail)return;Nn.
current.detail=C,Dt.current.detail=Math.max(Dt.current.detail,C),ws(L=>Ys(L,l,180)),Rt(l),_n(null);return}if(m==="host_r\
esource_unsubscribed")return r.subscription_id&&r.subscription_id!==Ke.current,void 0;if(m==="host_resource_error"){_n({
code:r.code||"unavailable",message:r.message||"Windows host metrics are unavailable."});return}if(m==="semantic_notifica\
tion"){Lo(l=>al(l,r));return}if(!Fa.current&&!r.request_id&&Ih.has(m)){let l=r.session||r.session_id||"global",C=m==="hi\
story_chunk"?r.source||"native":"";for(kn.current.set(`${m}:${l}:${C}`,r);kn.current.size>256;)kn.current.delete(kn.current.
keys().next().value);return}if(m==="session_list"){Uo(r.sessions||[]),t(l=>fo(l,r.sessions||[])),sn(r.sessions||[]),Ts(r.
sessions||[]),Xt(r.sessions||[]),Bt(r.sessions||[]),(r.sessions||[]).forEach(l=>{let C=l&&typeof l=="object"?l.session_id:
l,L=Es(l);l&&typeof l=="object"&&l.is_list_view&&!L&&C&&i(B=>B[C]&&B[C].length>0?{...B,[C]:[]}:B)}),Array.isArray(r.workspaces)&&
re(l=>fn(l,r.workspaces)?l:r.workspaces);return}if(m==="session_snapshot"||m==="proxy_session_snapshot"){Uo(r.sessions||
[]),t(l=>fo(l,r.sessions||[])),sn(r.sessions||[]),Ts(r.sessions||[]),Xt(r.sessions||[]),Bt(r.sessions||[]),(r.sessions||
[]).forEach(l=>{let C=l&&typeof l=="object"?l.session_id:l,L=Es(l);l&&typeof l=="object"&&l.is_list_view&&!L&&C&&i(B=>B[C]&&
B[C].length>0?{...B,[C]:[]}:B)});return}if(m==="connection_ack"){if(Ho(r),Array.isArray(r.semantic_notifications)&&Lo(l=>al(
l,r.semantic_notifications)),Is(),zr().catch(()=>{}),$a(Array.isArray(r.duplicate_proxy_alarms)?r.duplicate_proxy_alarms:
[]),Ea(Array.isArray(r.nightly_validation_failures)?r.nightly_validation_failures:[]),ns(r.latest_app_update_validation||
null),qa(r.revalidation_program_health||null),r.provider_usage&&typeof r.provider_usage=="object"&&To(l=>gl(l,r.provider_usage)),
r.sessions&&r.sessions.length>0&&(t(l=>fo(l,r.sessions)),sn(r.sessions),Ts(r.sessions),Xt(r.sessions),Bt(r.sessions),r.sessions.
forEach(l=>{let C=Es(l);if(l&&typeof l=="object"&&l.is_list_view&&!C){let L=l.session_id;L&&i(B=>B[L]&&B[L].length>0?{...B,
[L]:[]}:B)}})),Array.isArray(r.workspaces)&&re(l=>fn(l,r.workspaces)?l:r.workspaces),r.session_health){let l={};Object.entries(
r.session_health).forEach(([C,L])=>{l[C]=typeof L=="object"?L.health:L}),K(C=>Js(C,l))}r.agent_configs&&typeof r.agent_configs==
"object"&&I(l=>({...l,...r.agent_configs}));{let l={};[...r.open_prompts||[],...r.open_question_prompts||[]].forEach(C=>{
let L=C.session_id||C.session;L&&(l[L]={...C,received_at:Date.now()})}),Q(l)}{let l={};(r.open_error_prompts||[]).forEach(
C=>{let L=C.session_id||C.session;L&&(l[L]={...C,received_at:Date.now()})}),V(l)}Wa();return}if(m==="session_patch"){let l=r.
session||r.session_id;if(!l)return;t(B=>Ld(B,r));let C=r.patch&&typeof r.patch=="object"?r.patch:{},L={session_id:l,...C};
C.activity&&sn([L]),(C.model_id!==void 0||C.permission_mode!==void 0||C.capabilities!==void 0)&&Ts([L]),C.chat_list&&Xt(
[L]),C.status&&Bt([L]);return}if(m==="session_health"){let l=r.session||r.session_id;l&&K(C=>({...C,[l]:r.health}));return}
if(m==="scheduled_send_status"){Za(r.scheduled_send);return}if(m==="session_summary"){let l=r.session||r.session_id;if(!l)
return;if(s(C=>C.map(L=>(typeof L=="string"?L:L?.session_id)!==l?L:{...typeof L=="object"?L:{},session_id:l,...r.status?
{status:r.status}:{},...r.activity?{activity:r.activity}:{},...r.goal?{goal:r.goal}:{},...r.fleet_summary?{fleet_summary:r.
fleet_summary}:{},...r.fleet_work_context?{fleet_work_context:r.fleet_work_context}:{},...r.last_user_request?{last_user_request:r.
last_user_request}:{},...r.last_snippet!=null?{last_snippet:r.last_snippet}:{},...ol(r),...Sd(r)})),r.status&&K(C=>({...C,
[l]:r.status})),r.activity){let C=String(r.activity.kind||"idle").toLowerCase();Os({type:"status",session:l,activity:r.activity,
activity_trace:r.activity_trace,thinking:["thinking","generating","running_command","applying_patch","reading_files","wo\
rking"].includes(C),label:r.activity.label||""})}Number(r.unread_delta)>0&&l!==jn.current&&u(C=>({...C,[l]:(C[l]||0)+Number(
r.unread_delta)}));return}if(m==="message_delta"){let l=r.session_id||r.session;if(!l)return;let C=gd(mt.current[l]||null,
r);if(!C.accepted)return;Oo(l,C.stream,r.stream_trace||null);return}if(m==="transcript_resync_required"){let l=r.session_id||
r.session;if(!l||l!==jn.current)return;let C=Ye.current[l]||{};Ye.current[l]={...C,inFlight:!1},clearTimeout(tt.current[l]),
delete tt.current[l],ps(l,{mode:"tail",source:"relay_sqlite",replace:!0});return}if(m==="history"||m==="history_snapshot"){
let l=r.session||r.session_id;if(!l||r.request_id&&yn.current[l]&&yn.current[l]!==r.request_id)return;let C=n.find(pe=>(typeof pe==
"object"?pe.session_id:pe)===l),L=Es(C);if(C&&typeof C=="object"&&C.is_list_view&&r.messages?.length>0&&!L){h(pe=>{if(!pe[l])
return pe;let qe={...pe};return delete qe[l],qe});return}!r.partial&&(!r.mode||r.mode==="full")&&Ga(l);let B=r.messages||
[],ee=c[l]||null,Y=!!ca.current[l]&&B.length>0,be=!Y&&Dh(m,r,ee);i(pe=>{let qe=be?jr(pe[l],B):B,We=yo(vp(qe,pe[l]));return We===
pe[l]?pe:{...pe,[l]:We}}),d(pe=>{let qe={...be?pe[l]||{}:{},partial:!!r.partial||!!(be&&pe[l]?.partial),loaded:be?Math.max(
Number(pe[l]?.loaded||0),Number(r.loaded_messages??B.length)||B.length,(a[l]||[]).length):Number(r.loaded_messages??B.length)||
B.length,total:Number(r.total_messages??pe[l]?.total??B.length)||B.length,limit:r.limit||null,mode:be?pe[l]?.mode||"chun\
ked":r.mode||(r.partial?"tail":"full")};return fn(pe[l]||null,qe)?pe:{...pe,[l]:qe}}),h(pe=>{if(!pe[l])return pe;let qe={
...pe};return delete qe[l],qe}),Y&&delete ca.current[l];return}if(m==="history_chunk"){let l=r.session||r.session_id;if(!l)
return;let C=Ye.current[l]||{},L=r.mode!=="older"&&C.mode==="tail"&&(r.source||"relay_sqlite")===(C.source||"relay_sqlit\
e");if(r.request_id&&Cs.current[l]&&Cs.current[l]!==r.request_id&&!L)return;if(r.error&&(!Array.isArray(r.messages)||r.messages.
length===0)){let $e=String(r.error?.code||""),He=Number(C.retryAttempt||0);if(Lh.has($e)&&He<_p){let Be=Number(r.error?.
retry_after_ms??r.retry_after_ms),rt=Number.isFinite(Be)&&Be>0?Be:1500,Ht=Math.max(25,Math.min(250,Math.floor(rt*.05)));
clearTimeout(tt.current[l]),Ye.current[l]={...C,inFlight:!1,recovering:!0},d(Kr=>{let Yr={...Kr[l]||{},refreshing:!0};return delete Yr.
error,{...Kr,[l]:Yr}}),tt.current[l]=setTimeout(()=>{delete tt.current[l],!(jn.current!==l||p.current?.readyState!==WebSocket.
OPEN)&&ps(l,{mode:C.mode,source:C.source,replace:C.replace,beforeOffset:C.beforeOffset,beforeId:C.beforeId,aroundId:C.aroundId,
userInitiated:C.userInitiated,limit:C.limit,chunkBytes:C.chunkBytes,retryAttempt:He+1})},Math.ceil(rt)+Ht);return}h(Be=>{
if(!Be[l])return Be;let rt={...Be};return delete rt[l],rt}),Ye.current[l]={...Ye.current[l]||{},inFlight:!1},clearTimeout(
tt.current[l]),delete tt.current[l],d(Be=>({...Be,[l]:{...Be[l]||{},error:String(r.error?.message||r.error||"Transcript \
history could not be loaded.")}}));return}let B=r.mode==="older"?"older":r.mode==="around"?"around":"tail",ee=r.cursor||
{},Y=ee.next_before_offset??null,be=ee.next_before_id??null,pe=!!(r.partial&&(Y!=null||be!=null)),qe=Array.isArray(r.messages)?
r.messages:[],We=B==="around"||B==="tail"&&r.replace===!0,Ze=(We?qe:ms(a[l],qe,B)).length;i($e=>{let He=yo(vp(We?Ka($e[l],
qe,C,r.source):ms($e[l],qe,B),$e[l]));return He===$e[l]?$e:{...$e,[l]:He}}),d($e=>{let He={...$e[l]||{},partial:pe,loaded:We?
Number(r.loaded_messages??Ze)||Ze:Math.max(Number($e[l]?.loaded||0),Number(r.loaded_messages||0),Ze),total:Number(r.total_messages||
$e[l]?.total||Ze)||Ze,limit:null,mode:"chunked",source:r.source||"native",cursor:ee,bytes_total:ee.total_bytes||0,refreshing:!1};
return delete He.error,fn($e[l]||null,He)?$e:{...$e,[l]:He}}),h($e=>{if(!$e[l])return $e;let He={...$e};return delete He[l],
He}),Ye.current[l]={...Ye.current[l]||{},inFlight:!1,nextBeforeOffset:Y,nextBeforeId:be},clearTimeout(tt.current[l]),delete tt.
current[l];return}if(m==="history_delta"){let l=r.session||r.session_id;if(!l||r.request_id&&yn.current[l]&&yn.current[l]!==
r.request_id)return;let L=(Array.isArray(r.messages)?r.messages:Array.isArray(r.events)?r.events:[]).map(ee=>ee?.message||
ee).filter(Boolean),B=ms(a[l],L,"tail");i(ee=>{let Y=yo(ms(ee[l],L,"tail"));return Y===ee[l]?ee:{...ee,[l]:Y}}),d(ee=>{let Y=ee[l]||
{},be=Math.max(Number(Y.loaded||0),B.length),pe=Math.max(Number(r.total_messages||0),Number(Y.total||0),be);return{...ee,
[l]:{...Y,loaded:be,total:pe,last_sequence:Number(r.last_sequence||Y.last_sequence||0),mode:Y.mode||"chunked"}}}),h(ee=>{
if(ee[l]?.requestId!==r.request_id)return ee;let Y={...ee};return delete Y[l],Y});return}if(m==="status"||m==="proxy_sta\
tus"||m==="session_status"){let l=r.session||r.session_id;if(!l)return;let C=r.activity?.kind||"",L=r.thinking||["thinki\
ng","generating","running_command","applying_patch","reading_files","working"].includes(C);fd(mt.current[l],r.activity||
(L?null:{kind:"idle"}),L)&&Ga(l);let B=r.label||r.activity?.label||(C==="idle"?"":"Thinking"),ee=L||r.activity?{kind:r.activity?.
kind||(L?"thinking":"working"),label:B,updatedAt:r.activity?.updated_at||null,observed_at:r.activity?.observed_at||null,
startedAt:r.activity?.started_at||null,interruptHint:r.activity?.interrupt_hint||"",goal:r.activity?.goal||null,goal_run:r.
activity?.goal_run||null,thinking:r.activity?.thinking||null,current:r.activity?.current||null,step:r.activity?.step||null,
usage:r.activity?.usage||null,task_list:r.activity?.task_list||null,context_card:r.activity?.context_card||null,thinkingContent:r.
activity?.thinking?.text||r.activity?.thinkingContent||"",transport:Wd(r.activity_trace)}:!1;if(L){clearTimeout(bn.current[l]),
g(be=>Object.is(be[l],B)?be:{...be,[l]:B}),T(be=>Js(be,{[l]:ee}));let Y=r.activity?.thinking?.text??r.thinking_content??
r.activity?.thinkingContent;Y!=null&&y(be=>Object.is(be[l],Y)?be:{...be,[l]:Y})}else C==="idle"?(clearTimeout(bn.current[l]),
g(Y=>Y[l]===!1?Y:{...Y,[l]:!1}),T(Y=>{let be=ee;return Object.is(Y[l],be)?Y:{...Y,[l]:be}}),y(Y=>Y[l]===""?Y:{...Y,[l]:""})):
r.activity?.goal||r.activity?.task_list||r.activity?.step||r.activity?.usage?(clearTimeout(bn.current[l]),g(Y=>Y[l]===!1?
Y:{...Y,[l]:!1}),T(Y=>Js(Y,{[l]:ee}))):(clearTimeout(bn.current[l]),bn.current[l]=setTimeout(()=>{g(Y=>Y[l]===!1?Y:{...Y,
[l]:!1}),T(Y=>Y[l]===!1?Y:{...Y,[l]:!1}),y(Y=>Y[l]===""?Y:{...Y,[l]:""})},4e3));Vr(r,l);return}if(m==="permission_prompt"){
let l=r.session_id||r.session;l&&Q(C=>({...C,[l]:{...r,received_at:Date.now()}}));return}if(m==="question_prompt"){let l=r.
session_id||r.session;l&&Q(C=>{let L=C[l],B=L?.prompt_id===r.prompt_id&&L?.generation===r.generation;return{...C,[l]:{...B?
L:{},...r,received_at:B?L.received_at:Date.now(),...r.lifecycle==="submitting"?{submitting_choice_id:L?.submitting_choice_id||
"question_answers"}:{}}}});return}if(m==="question_prompt_state"){let l=r.session_id||r.session;l&&r.lifecycle==="failed"?
Q(C=>{let L=C[l],B=L?.prompt_id===r.prompt_id&&L?.generation===r.generation;return L&&!B?C:{...C,[l]:{...B?L:{},...r,type:"\
question_prompt",received_at:B?L.received_at:Date.now(),submitting_choice_id:null}}}):l&&!["open","submitting"].includes(
r.lifecycle)&&Q(C=>{let L=C[l];if(L?.prompt_id!==r.prompt_id||L?.generation!==r.generation)return C;let{[l]:B,...ee}=C;return ee});
return}if(m==="permission_prompt_expired"){let l=r.session_id||r.session;l&&Q(C=>{let{[l]:L,...B}=C;return B});return}if(m===
"session_error_prompt"){let l=r.session_id||r.session;l&&V(C=>({...C,[l]:{...r,received_at:Date.now()}}));return}if(m===
"session_error_prompt_cleared"){let l=r.session_id||r.session;l&&V(C=>{let{[l]:L,...B}=C;return B});return}if(m==="chat_\
list"){let l=r.session_id||r.session;l&&z(C=>({...C,[l]:r.chats||[]}));return}if(m==="branch_list"){let l=r.session_id||
r.session;l&&le(C=>({...C,[l]:{branches:r.branches||[],current:r.current||""}}));return}if(m==="thread_list"){let l=r.session_id||
r.session;if(l){let C=r.threads||[],L=C.find(Y=>Y?.active),B=String(L?.cache_key||""),ee=vt.current[l]||"";B&&ee&&B!==ee&&
(ca.current[l]=B,pa(l)),B&&(vt.current[l]=B),we(Y=>({...Y,[l]:C}))}return}if(m==="duplicate_proxy_alarm"){$a(Array.isArray(
r.duplicate_sessions)?r.duplicate_sessions:[]);return}if(m==="nightly_validation_status"){Ea(Array.isArray(r.failures)?r.
failures:[]),r.revalidation_program_health&&qa(r.revalidation_program_health);return}if(m==="app_update_validation_statu\
s"){ns(r.validation||null);return}if(m==="harness_revalidation_status"){qa(r.program_health||null);return}if(m==="skill_\
list"){let l=r.session_id||r.session;l&&j(C=>({...C,[l]:{installed:r.installed||[],recommended:r.recommended||[]}}));return}
if(m==="codex_automation_view"){let l=r.session_id||r.session;l&&Se(C=>({...C,[l]:r.view||null}));return}if(m==="termina\
l_output"){let l=r.session_id||r.session;l&&Ce(C=>({...C,[l]:r.entries||[]}));return}if(m==="file_changes"){let l=r.session_id||
r.session;l&&Le(C=>({...C,[l]:r.entries||[]}));return}if(m==="directory_listing"){let l=r.session_id||r.session;l&&Wt(C=>({
...C,[l]:{path:r.path,entries:r.entries||[]}}));return}if(m==="file_content"){let l=r.session_id||r.session;l&&Pn(C=>ys(
C,`${l}:${r.path}`,{path:r.path,content:r.content,truncated:r.truncated}));return}if(m==="agent_config"){let l=r.session_id||
r.session;if(!l)return;Lt(l,r),I(C=>{let L=C[l]||{},B={...L,...r};return(!Array.isArray(r.available_models)||r.available_models.
length===0)&&Array.isArray(L.available_models)&&L.available_models.length>0&&(B.available_models=L.available_models),Object.
values(pt.current).forEach(ee=>{ee.sessionId!==l||!["pending","awaiting_config"].includes(ee.status)||(B[ee.configKey]=ee.
requestedValue)}),_t.current={..._t.current,[l]:B},{...C,[l]:B}});return}if(m==="agent_control_result"){let l=r.session_id||
r.session;if(r.request_id){ht(L=>ys(L,r.request_id,{...r,received_at:Date.now()}));let C=Object.entries(pt.current).find(
([,L])=>L.requestId===r.request_id&&L.sessionId===l&&["pending","awaiting_config"].includes(L.status));if(C){let[L,B]=C;
r.result==="failed"?Ms(L,r.error?.message||r.error||"The agent rejected this setting."):r.result==="ok"&&(ds(L,{...B,status:"\
awaiting_config"}),l&&fs(l))}}l&&r.result==="ok"&&r.command==="new_thread"&&pa(l),l&&r.result==="ok"&&["new_thread","swi\
tch_thread"].includes(r.command)&&Xa(l),l&&r.result==="ok"&&r.command==="switch_chat"&&hs(l),["permission_response","que\
stion_response"].includes(r.command)&&l&&(r.result==="ok"?Q(C=>{if(C[l]?.request_id!==r.request_id)return C;let{[l]:L,...B}=C;
return B}):r.result==="failed"&&Q(C=>C[l]?.request_id===r.request_id?{...C,[l]:{...C[l],submitting_choice_id:null,error:r.
error?.message||"Permission response failed"}}:C)),r.command==="error_prompt_action"&&l&&r.result==="failed"&&V(C=>C[l]?
{...C,[l]:{...C[l],submitting_action_id:null,error:r.error?.message||"Error prompt action failed"}}:C),r.command==="file\
_change_response"&&l&&r.result==="ok"&&Hr(l);return}if(m==="message_accepted"){let l=r.client_message_id,C=r.session_id||
r.session;l&&C&&Vt(l,C);let L=["accepted","delivered","agent_started","failed"].includes(r.status)?r.status:"accepted",B=L===
"accepted"&&r.launch_accepted_at?"launch_accepted":L;if(l&&B==="failed"){Et(l,r.failure_code||"Send failed",C);return}let ee=l?
zt.current[l]:null;l&&!["busy_queued","steered","launch_accepted","delivered","agent_started"].includes(ee)&&(ft(l,B),B===
"accepted"?at(l,"accepted","Relay accepted the message, but native delivery timed out."):B==="launch_accepted"?at(l,"lau\
nch_accepted","The native launch was accepted, but no native user turn was observed."):B==="delivered"?at(l,"delivered",
"Message reached the agent, but agent activity did not start in time."):jt(l)),l&&us(l,C,Y=>wr({...Y,...r.created_at!=null?
{created_at:r.created_at}:{},...r.timestamp!=null?{timestamp:r.timestamp}:{},...r.ts!=null?{ts:r.ts}:{},...r.launch_accepted_at!=
null?{_launchAcceptedAt:r.launch_accepted_at}:{},_delivered:B==="delivered"||B==="agent_started",_agentStarted:B==="agen\
t_started",_sendError:null}));return}if(m==="proxy_send_result"&&r.result==="launch_accepted"){let l=r.client_message_id,
C=r.session_id||r.session;l&&C&&Vt(l,C),l&&!["delivered","agent_started"].includes(zt.current[l])&&(ft(l,"launch_accepte\
d"),at(l,"launch_accepted","The native launch was accepted, but no native user turn was observed."),us(l,C,L=>({...L,_launchAcceptedAt:r.
accepted_at||new Date().toISOString(),_sendError:null})));return}if(m==="message_delivered"||m==="proxy_send_result"&&r.
result==="delivered"){let l=r.client_message_id,C=r.session_id||r.session;l&&C&&Vt(l,C),l&&zt.current[l]!=="agent_starte\
d"&&(ft(l,"delivered"),at(l,"delivered","Message reached the agent, but agent activity did not start in time.")),l&&us(l,
C,L=>({...L,_delivered:!0,_sendError:null}));return}if(m==="agent_started"){let l=r.client_message_id,C=r.session_id||r.
session;l&&C&&Vt(l,C),l&&(jt(l),ft(l,"agent_started")),C&&Do(C,l||null),l&&us(l,C,L=>({...L,_delivered:!0,_agentStarted:!0,
_sendError:null}));return}if(m==="message_failed"||m==="proxy_send_result"&&r.result==="failed"){let l=r.client_message_id,
C=r.session_id||r.session;if(C&&Ga(C),l){let L=r.reason||r.message||r.error?.message||"Send failed";Et(l,L,C)}return}if(m===
"message_queued"){let l=r.client_message_id,C=r.session_id||r.session;if(l){let L=Array.isArray(r.content_blocks)?r.content_blocks:
[],B=L.find(ee=>ee?.type==="queued_message");jt(l),ft(l,"busy_queued"),C&&G(ee=>({...ee,[C]:[...ee[C]||[],{cid:l,content:B?.
content??r.content,content_blocks:L,queuedAt:r.queued_at}]}))}return}if(m==="queue_delivered"){let l=r.client_message_id,
C=r.session_id||r.session;l&&(ft(l,"accepted"),at(l,"accepted","Queued message left the relay, but native delivery timed\
 out."),C&&G(L=>({...L,[C]:(L[C]||[]).filter(B=>B.cid!==l)})));return}if(m==="steer_result"){let l=r.client_message_id,C=r.
session_id||r.session;l&&(r.result==="ok"?(ft(l,"steered"),at(l,"steered","Message was steered, but agent activity did n\
ot start in time.")):Et(l,r.error?.message||r.error||"The desktop proxy rejected the message.",C),C&&G(L=>({...L,[C]:(L[C]||
[]).filter(B=>B.cid!==l)})));return}if(m==="native_queue"){let l=r.session_id||r.session,C=r.items||[];l&&G(L=>{let B=(L[l]||
[]).filter(Y=>Y.cid&&Y.cid.startsWith("cmsg-")),ee=C.map((Y,be)=>({cid:`native-${be}`,content:Y.content_blocks?.find(pe=>pe?.
type==="queued_message")?.content??Y.text,content_blocks:Array.isArray(Y.content_blocks)?Y.content_blocks:[],native:!0,nativeIndex:Y.
index,status:Y.state||"queued"}));return{...L,[l]:[...B,...ee]}});return}if(m==="rate_limit_active"){let l=r.session_id||
r.session,C=r.percent_used??null,L=C==null||C>=100;l&&s(B=>B.map(ee=>(typeof ee=="string"?ee:ee?.session_id)===l?{...typeof ee==
"object"?ee:{},session_id:l,rate_limited_until:r.retry_after_hint||(L?"unknown":null),rate_limit_active:L,percent_used:C}:
ee));return}if(m==="rate_limit_cleared"){let l=r.session_id||r.session;l&&s(C=>C.map(L=>(typeof L=="string"?L:L?.session_id)===
l?{...typeof L=="object"?L:{},session_id:l,rate_limited_until:null,rate_limit_active:!1,percent_used:null}:L));return}if(m!==
"session_launching"){if(m==="session_launch_ack"){let l=r.request_id,C=r.session_id||r.session;l&&ve(L=>{let{[l]:B,...ee}=L;
return ee}),C&&Z(C);return}if(m==="session_launch_failed"){let l=r.request_id,C=r.reason||r.error||"Launch failed";l&&ve(
L=>ys(L,l,{...L[l],status:"failed",error:C}));return}if(m==="session_closed"){let l=r.session||r.session_id;l&&s(C=>C.filter(
L=>(typeof L=="string"?L:L?.session_id)!==l));return}if(m==="message"||m==="proxy_message"||m==="message_event"){let l=r.
session||r.session_id||r.message?.session_id,C=r.role||r.message?.role,L=r.content||r.message?.content,B=Array.isArray(r.
content_blocks)?r.content_blocks:Array.isArray(r.message?.content_blocks)?r.message.content_blocks:null,ee=r.client_message_id||
r.message?.client_message_id||null,Y=r.status||r.message?.status||null,be=Y==="delivered"||Y==="agent_started";if(!l||!C||
!L)return;C==="assistant"&&Ga(l);let pe=wr({role:C,content:L,...B?{content_blocks:B}:{},...r.source_message_id?{source_message_id:r.
source_message_id}:{},...r.native_source_id?{native_source_id:r.native_source_id}:{},...r.source_cursor?{source_cursor:r.
source_cursor}:{},...r.source?{source:r.source}:{},...r.server_message_id!=null?{server_message_id:r.server_message_id}:
{},...ee?{client_message_id:ee}:{},...Y?{status:Y}:{},...r.sequence!=null?{sequence:r.sequence}:{},...r.created_at!=null?
{created_at:r.created_at}:{},...r.timestamp!=null?{timestamp:r.timestamp}:{},...r.ts!=null?{ts:r.ts}:{}});i(We=>{let Ue=We[l]||
[];if(C==="user"){let $e=Ue.findIndex(He=>He._optimistic&&(ee&&He._cid===ee||!ee&&He.content===L));if($e>=0){let He=[...Ue],
Be=Ue[$e];return He[$e]=wr({...Be,role:C,content:L,...B?{content_blocks:B}:{},...pe.source_message_id?{source_message_id:pe.
source_message_id}:{},...pe.native_source_id?{native_source_id:pe.native_source_id}:{},...pe.source_cursor?{source_cursor:pe.
source_cursor}:{},...pe.source?{source:pe.source}:{},...pe.server_message_id!=null?{server_message_id:pe.server_message_id}:
{},...pe.client_message_id?{client_message_id:pe.client_message_id}:{},...pe.status?{status:pe.status}:{},...pe.sequence!=
null?{sequence:pe.sequence}:{},...pe.created_at!=null?{created_at:pe.created_at}:{},...pe.timestamp!=null?{timestamp:pe.
timestamp}:{},...pe.ts!=null?{ts:pe.ts}:{},_delivered:Be._delivered||be,_agentStarted:Be._agentStarted||Y==="agent_start\
ed",_cid:Be._cid,_optimistic:Be._optimistic}),{...We,[l]:yo(He)}}}let Ze=Ei(pe);return Ue.some($e=>Ze?Ei($e)===Ze:$e.role===
C&&$e.content===L)?We:{...We,[l]:yo([...Ue,{...pe,...C==="user"&&ee?{_cid:ee}:{},_delivered:C==="user"&&be,_agentStarted:C===
"user"&&Y==="agent_started"}])}}),C==="assistant"&&l!==jn.current&&u(We=>({...We,[l]:(We[l]||0)+1}));let qe=ol(r);Object.
keys(qe).length>0&&s(We=>We.map(Ue=>(typeof Ue=="string"?Ue:Ue?.session_id)===l?{...typeof Ue=="object"?Ue:{},session_id:l,
...qe}:Ue));return}}}}return Ba.current=Os,{sessions:n,messages:a,provisionalStreams:sc,historyMeta:c,historyLoading:f,connected:b,
connectionHealth:x,unread:R,setUnread:u,thinking:v,thinkingContent:w,activities:E,health:H,deliveryStates:te,launchStates:J,
justLaunched:ge,setJustLaunched:Z,permissionPrompts:he,respondToPrompt:Br,errorPrompts:U,respondToErrorPrompt:Go,interruptSession:Fr,
controlGoal:Ya,agentConfigs:ie,configControlStates:en,requestAgentConfig:fs,setAgentModel:Hn,setAgentEffort:Ls,setAgentPermissionMode:Un,
setAutoApprovePermissions:qs,setAntigravityMode:Cn,setCodexConfig:gs,newThread:xn,openPanel:Ps,openNativeWindow:an,requestChatList:hs,
switchChat:Gn,newChat:Je,chatLists:$,requestThreadList:Xa,switchThread:rn,threadLists:fe,switchWorkspace:Vo,requestTerminalOutput:Wo,
sendTerminalInput:ic,terminalOutputs:ye,requestFileChanges:Hr,respondToFileChange:Ur,fileChanges:Te,sendAttachment:cc,send:ke,
sendToSession:dc,steerMessage:Ko,discardQueuedMessage:pc,editQueuedMessage:Yo,queuedMessages:oe,scheduledSends:de,scheduleSend:Xo,
cancelScheduledSend:Qo,refreshScheduledSends:zr,launchSession:Ft,resumeSession:uc,closeSession:An,activeSessionRef:jn,restoreCachedTranscript:st,
setSessionSubscriptions:Bn,workspaces:W,branchLists:At,requestBranchList:Wr,switchBranch:Ja,createBranch:lc,skillLists:De,
requestSkillList:Gr,automationViews:se,showCodexAutomation:zo,controlResults:Fe,directoryListings:dt,requestDirectoryListing:ma,
fileContents:qn,requestFileContent:Qa,requestHistory:$s,requestHistoryChunk:ps,duplicateProxyAlarms:In,nightlyValidationFailures:Lr,
latestAppUpdateValidation:ta,revalidationProgramHealth:La,providerUsage:ec,providerUsageRefreshReceipt:On,requestProviderUsageRefresh:xs,
setProviderUsageWatching:ls,providerUsageResetReceipt:qr,consumeProviderUsageResetCredit:la,providerUsageCostDetail:na,requestProviderUsageCostDetail:Dr,
hostResources:sa,hostResourceError:Eo,hostResourceHistory:Pr,hostResourceDetails:tc,hostResourceSubscription:nc,subscribeHostResources:Fo,
unsubscribeHostResources:Va,requestHostResourceRefresh:za,clearHostResources:nn,semanticNotifications:ac}}function Bh(e){return typeof e=="string"?e:e?.session_id||e?.id||""}function Sp(e){let t=Number(e?.pin_order);return Number.
isSafeInteger(t)&&t>0?t:0}function Fh(e){return e?.pinned===!0||Sp(e)>0}function Cp(e,t={}){let n=[],s=[];for(let a of Array.
isArray(e)?e:[]){let i=Bh(a),c=i?t[i]:null;Fh(c)?n.push({session:a,id:i,order:Sp(c)}):s.push(a)}return n.sort((a,i)=>(a.
order||Number.MAX_SAFE_INTEGER)-(i.order||Number.MAX_SAFE_INTEGER)||a.id.localeCompare(i.id)),{pinned:n.map(a=>a.session),
unpinned:s}}var yl="remote-agent-chat:group-aliases:v1",Pi=Object.freeze({"^remoteagent":"Remote Agent Chat"}),Hh=new Set(["thinking",
"generating","running_command","applying_patch","reading_files","working"]),Uh=new Set(["validator","test","fixture","pr\
obe","e2e","throwaway"]),Gh=[/(?:^|\/)cursor-test(?:\/|$)/i,/(?:^|\/)remote-agent-(?=[^/]*(?:-(?:test|fixture|probe|e2e|validator|validation|throwaway|switch-anchor)(?:-|\/|$)))[^/]+(?:\/|$)/i,
/(?:^|\/)rac-(?=[^/]*(?:-(?:test|fixture|probe|e2e|validator|validation|throwaway)(?:-|\/|$)))[^/]+(?:\/|$)/i,/(?:^|\/)reply-with-exactly-rac-[^/]*(?:\/|$)/i];
function En(e){return typeof e=="string"?e:e?.session_id||e?.id||""}function kl(e){if(!e||typeof e!="object"||e.is_test_session===
!1)return!1;if(e.is_test_session===!0||e.is_test_session===1||e.is_test_session==="true"||e.validator_session===!0||Uh.has(
String(e.session_kind||e.session_class||"").trim().toLowerCase()))return!0;let t=String(e.workspace_path||e.project_root||
"").trim().replace(/\\/g,"/").replace(/\/+$/g,"").toLowerCase();if(Gh.some(s=>s.test(t)))return!0;let n=[e.workspace_name,
e.display_name,e.window_title,e.chat_title].filter(Boolean).join("/").toLowerCase();return/(?:^|[\s/_-])(?:validator|fixture|throwaway)(?:$|[\s/_-])/i.
test(n)}function Ca(e){if(typeof e=="number"&&Number.isFinite(e))return e;let t=Date.parse(String(e||""));return Number.
isFinite(t)?t:0}function Wh(e){return(Array.isArray(e)?e:[]).reduce((t,n)=>Math.max(t,Ca(n?.ts??n?.timestamp??n?.created_at??
n?.updated_at)),0)}function Rp(e,t={}){let n=En(e),s=t.activities?.[n]||(typeof e=="object"?e.activity:null)||{kind:"idl\
e"},i=!!t.thinking?.[n]&&!s.generating?{...s,kind:Hh.has(String(s.kind||"").toLowerCase())?s.kind:"thinking",generating:!0}:
s,c=!!t.pendingPrompts?.[n]||!!t.errorPrompts?.[n]||typeof e=="object"&&e.rate_limit_active===!0;return Si(i,c,{connected:t.
connected,health:t.health?.[n]||t.healthMap?.[n],nowMs:t.nowMs,freshnessMs:t.freshnessMs,requireFreshness:t.requireFreshness===
!0})}function Mp(e,t={}){let n=[],s=[],a={};for(let i of Array.isArray(e)?e:[]){let c=En(i);if(!c)continue;let d=Rp(i,t);
a[c]=d,(ya(d)?n:s).push(i)}return{working:n,nonWorking:s,states:a}}function wl(e,t={}){let n=Array.isArray(e)?e:[],s=n.map(
En).filter(Boolean);return{version:1,revision:Number(t.revision||0),sessionOrder:s,fallbackSessionById:Object.fromEntries(
n.map(a=>[En(a),a]).filter(([a])=>a))}}function Tp(e,t,n={}){let s=Array.isArray(t)?t:[],a=Object.fromEntries(s.map(x=>[
En(x),x]).filter(([x])=>x)),i=Object.keys(a),c=e?.version===1?e:wl(s,n),d=Array.isArray(c.sessionOrder)?c.sessionOrder:[];
if(!(i.length!==d.length||i.some(x=>!d.includes(x))))return{ledger:c,sessions:d.map(x=>a[x]||c.fallbackSessionById?.[x]).
filter(Boolean),structuralChanged:!1,deferred:!1};if(n.freezeStructure)return{ledger:c,sessions:d.map(x=>a[x]||c.fallbackSessionById?.[x]).
filter(Boolean),structuralChanged:!0,deferred:!0};let h=new Set(i),b=d.filter(x=>h.has(x));for(let x of i)b.includes(x)||
b.push(x);let N={version:1,revision:Number(c.revision||0)+1,sessionOrder:b,fallbackSessionById:Object.fromEntries(b.map(
x=>[x,a[x]||c.fallbackSessionById?.[x]]).filter(([,x])=>!!x))};return{ledger:N,sessions:b.map(x=>a[x]||N.fallbackSessionById[x]).
filter(Boolean),structuralChanged:!0,deferred:!1}}function zh(e,t={}){let n=En(e),s=t.activities?.[n]||(typeof e=="objec\
t"?e.activity:null)||null,a=Rp(e,t),i=a==="needs_attention",c=ya(a),d=Math.max(Ca(t.lastMessageAt?.[n]),Wh(t.messages?.[n])),
f=Math.max(Ca(s?.updatedAt??s?.updated_at),Ca(s?.startedAt??s?.started_at),Ca(typeof e=="object"?e.last_message_at:null),
Ca(typeof e=="object"?e.last_seen_at:null),Ca(typeof e=="object"?e.created_at:null));return{id:n,tier:i?2:c&&t.rankWorking!==
!1?1:0,recency:d||f}}function $p(e,t={}){let n=new Map((t.previousGroupOrder||[]).map((d,f)=>[d,f])),s=new Map((t.previousSessionOrder||
[]).map((d,f)=>[d,f])),a=(d,f)=>n.has(d)?n.get(d):n.size+f,i=(d,f)=>s.has(d)?s.get(d):s.size+f,c=(Array.isArray(e)?e:[]).
map((d,f)=>{let h=(d.sessions||[]).map((b,N)=>({session:b,sessionIndex:N,...zh(b,t)})).sort((b,N)=>N.tier-b.tier||N.recency-
b.recency||i(b.id,b.sessionIndex)-i(N.id,N.sessionIndex)||b.id.localeCompare(N.id));return{group:{...d,sessions:h.map(b=>b.
session)},groupIndex:f,tier:h.reduce((b,N)=>Math.max(b,N.tier),0),recency:h.reduce((b,N)=>Math.max(b,N.recency),0)}});return c.
sort((d,f)=>f.tier-d.tier||f.recency-d.recency||a(d.group.key,d.groupIndex)-a(f.group.key,f.groupIndex)||d.group.key.localeCompare(
f.group.key)),c.map(d=>d.group)}function Ep(e){return{groupOrder:(e||[]).map(t=>t.key),sessionOrder:(e||[]).flatMap(t=>(t.
sessions||[]).map(En))}}function Lp(e){return(e||[]).flatMap(t=>(t.sessions||[]).map(n=>`${t.key}:${En(n)}`)).sort().join(
"|")}function vl(e){return String(e?.key||"unscoped")}function Ii(e){let t={},n={},s={};for(let a of e||[]){let i=vl(a);
s[i]={...a,sessions:[]};for(let c of a.sessions||[]){let d=En(c);d&&(t[d]=c,n[d]=i)}}return{sessionById:t,groupBySession:n,
groupMeta:s}}function Vh(e){return{groupOrder:[...e?.groupOrder||[]],sessionOrder:[...e?.sessionOrder||[]]}}function Kh(e,t){
return(e?.groupOrder||[]).join("|")===(t?.groupOrder||[]).join("|")&&(e?.sessionOrder||[]).join("|")===(t?.sessionOrder||
[]).join("|")}function Yh(e,t={},n=null){return Ep($p(e,{...t,previousGroupOrder:n?.groupOrder||t.previousGroupOrder,previousSessionOrder:n?.
sessionOrder||t.previousSessionOrder}))}function ko(e,t={}){let n=$p(e,t),s=Ii(n),a=Ep(n);return{version:1,revision:Number(
t.revision||0),groupOrder:a.groupOrder,sessionOrder:a.sessionOrder,historicalGroupOrder:a.groupOrder,historicalSessionOrder:a.
sessionOrder,historicalGroupBySession:s.groupBySession,groupBySession:s.groupBySession,groupMeta:s.groupMeta,fallbackSessionById:s.
sessionById,sourceMembership:Lp(e)}}function Li(e,t){let n=Ii(t),s=new Map((e?.groupOrder||[]).map(a=>[a,[]]));for(let a of e?.
sessionOrder||[]){let i=e.groupBySession?.[a];if(!i||!s.has(i))continue;let c=n.sessionById[a]||e.fallbackSessionById?.[a];
c&&s.get(i).push(c)}return(e?.groupOrder||[]).map(a=>({...n.groupMeta[a]||e.groupMeta?.[a]||{key:a},key:a,sessions:s.get(
a)||[]})).filter(a=>a.sessions.length>0)}function xp(e,t,n={}){let s=Yh(t,n,e);if(!Kh(Vh(e),s))return!0;let a=Ii(t);return Object.
entries(a.groupBySession).some(([i,c])=>e.groupBySession?.[i]!==c)}function qp(e,t,n={}){let s=e?.version===1?e:ko(t,n),
a=Lp(t);if((s.sessionOrder||[]).length===0&&a){let v=ko(t,{...n,revision:Number(s.revision||0)+1});return{ledger:v,groups:Li(
v,t),orderChanged:!1,structuralChanged:!0,deferred:!1}}if(a===s.sourceMembership)return{ledger:s,groups:Li(s,t),orderChanged:xp(
s,t,n),structuralChanged:!1,deferred:!1};if(n.freezeStructure)return{ledger:s,groups:Li(s,t),orderChanged:!0,structuralChanged:!0,
deferred:!0};let i=Ii(t),c=new Set(Object.keys(i.sessionById)),d=[...s.historicalSessionOrder||s.sessionOrder||[]],f=[...s.
historicalGroupOrder||s.groupOrder||[]],h={...s.historicalGroupBySession||s.groupBySession||{}};for(let v of t||[]){let g=vl(
v);f.includes(g)||f.push(g);for(let w of v.sessions||[]){let y=En(w);y&&!d.includes(y)&&(d.push(y),h[y]=g)}}let b={},N=[],
x=[],S={...s.groupMeta||{}},R={};for(let v of d)c.has(v)&&(N.push(v),b[v]=s.groupBySession?.[v]||h[v]||i.groupBySession[v],
R[v]=i.sessionById[v]);for(let v of t||[]){let g=vl(v);for(let w of v.sessions||[]){let y=En(w);!y||b[y]||(N.push(y),b[y]=
g,R[y]=w,S[g]={...v,sessions:[]})}}for(let v of f)N.some(g=>b[g]===v)&&x.push(v);for(let v of N){let g=b[v];x.includes(g)||
x.push(g)}let u={version:1,revision:Number(s.revision||0)+1,groupOrder:x,sessionOrder:N,historicalGroupOrder:f,historicalSessionOrder:d,
historicalGroupBySession:h,groupBySession:b,groupMeta:S,fallbackSessionById:R,sourceMembership:a};return{ledger:u,groups:Li(
u,t),orderChanged:xp(u,t,n),structuralChanged:!0,deferred:!1}}function Pp(e,t,n={}){return ko(t,{...n,previousGroupOrder:e?.
groupOrder,previousSessionOrder:e?.sessionOrder,revision:Number(e?.revision||0)+1})}function qi(e){let t=String(e||"").trim().
replace(/\\/g,"/").replace(/\/+$/,"");return!t||t.toLowerCase()==="unknown"||!/^(?:[A-Za-z]:\/|\/\/|\/)/.test(t)?null:{key:t.
toLowerCase(),path:t}}function Ip(e){return String(e||"").replace(/\\/g,"/").replace(/\/+$/,"").split("/").filter(Boolean).
pop()||"Unscoped"}function Xh(e,t){return e===t||e.startsWith(`${t}/`)}function Qh(e){return Ip(e).toLowerCase().replace(
/[^a-z0-9]+/g,"")}function Ap(e){return`alias:${String(e||"").trim().toLowerCase().replace(/[^a-z0-9]+/g,"-")}`}function Oi(e){
let t=e&&typeof e=="object"&&!Array.isArray(e)?e:{};return Object.fromEntries(Object.entries({...Pi,...t}).filter(([n,s])=>String(
n).trim()&&String(s).trim()).map(([n,s])=>[String(n).trim(),String(s).trim()]))}function Jh(e,t,n){let s=t&&typeof t=="o\
bject"&&(t.group_alias||t.project_group)||null;if(typeof s=="string"&&s.trim()){let i=s.trim();return{key:Ap(i),title:i}}
if(!e)return null;let a=Qh(e.path);for(let[i,c]of Object.entries(Oi(n)))try{if(new RegExp(i,"i").test(a))return{key:Ap(c),
title:c}}catch{}return null}function Nl(e,t={},n=Pi){let s=Array.isArray(e)?e:[],a=s.map(d=>qi(d&&typeof d=="object"?d.project_root:
null)).filter(Boolean).sort((d,f)=>f.key.length-d.key.length),i=[],c=new Map;for(let d of s){let f=typeof d=="string"?d:
d?.session_id||d?.id,h=f?t[f]:null,b=qi(d&&typeof d=="object"?d.project_root:null),N=qi(d&&typeof d=="object"?d.workspace_path:
null)||qi(h?.file_access_scope),x=!b&&N?a.find(g=>Xh(N.key,g.key)):null,S=b||x||N,R=Jh(S,d,n),u=R?.key||S?.key||"unscope\
d",v=c.get(u);v||(v={key:u,label:R?.title||(S?Ip(S.path):"Unscoped"),path:S?.path||null,sessions:[]},c.set(u,v),i.push(v)),
v.sessions.push(d)}return i}var Zh=new Set(["claude","claude_cli","claude-desktop","codex","codex_cli","codex-desktop","cursor","cursor_cli","gemini",
"continue","continue_yolo","roo_code","cline","antigravity","antigravity_panel","antigravity-v2"]);function Op(e,t={},n="\
unknown",s=!0){let a=typeof e=="string"?e:String(e?.session_id||e?.id||""),i=String(typeof e=="object"?e?.agent_type||t?.
agent_type||"":t?.agent_type||""),c=t?.capabilities||{};return!!a&&!!s&&Zh.has(i)&&n!=="disconnected"&&e?.disconnected!==
!0&&e?.is_list_view!==!0&&c.send!==!1&&c.send_message!==!1&&c.message_send!==!1}function Dp(e,t=()=>!0){let n=Array.isArray(
e?.session_ids)?e.session_ids:[],s=[...new Set(n.map(d=>String(d||"").trim()).filter(Boolean))],a=typeof e?.content=="st\
ring"?e.content.trim():"";if(s.length<1||s.length>20)return{ok:!1,error:"Select between 1 and 20 sessions"};if(!a||a.length>
65536)return{ok:!1,error:"Prompt must contain 1-65536 characters"};let i=`SEND TO ${s.length} SESSIONS`;if(e?.confirmation!==
i)return{ok:!1,error:"Broadcast confirmation does not match the selected session count"};let c=s.filter(d=>!t(d));return c.
length?{ok:!1,error:"One or more selected sessions cannot receive messages",unsupported:c}:{ok:!0,sessionIds:s,content:a,
confirmation:i}}function jp(e){return Object.fromEntries(e.map(t=>[t,{status:"queued",error:null}]))}var{useEffect:Bp,useLayoutEffect:e_,useRef:Di,useState:Sl}=React,xa=12,Fp=10,Cl=360,Hp=210,t_=450;function n_(e,t,n){return Math.
min(Math.max(e,t),Math.max(t,n))}function s_(e){return`title-disclosure-${String(e||"title").replace(/[^a-z0-9_-]+/gi,"-")}`}
function ji({title:e,disclosureKey:t,kind:n="title",wrapperClassName:s,triggerClassName:a,disclosureClassName:i,triggerLabel:c,
triggerTag:d="button"}){let f=Di(null),h=Di(null),b=Di(null),N=Di({focused:!1,hovered:!1,latched:!1}),[x,S]=Sl(!1),[R,u]=Sl(
!1),[v,g]=Sl(null),w=s_(`${n}-${t}`),y=d;function E(){let G=N.current;S(G.focused||G.hovered||G.latched)}function T({restoreFocus:G=!1}={}){
N.current={focused:!1,hovered:!1,latched:!1},u(!1),g(null),S(!1),G&&f.current?.focus({preventScroll:!0})}function H(){N.
current.latched=!0,u(!0),S(!0)}function K(){b.current&&(clearTimeout(b.current),b.current=null)}Bp(()=>()=>K(),[]),Bp(()=>{
if(!x||!R)return;let G=de=>{f.current?.contains(de.target)||h.current?.contains(de.target)||T()};return document.addEventListener(
"pointerdown",G,!0),()=>document.removeEventListener("pointerdown",G,!0)},[x,R]),e_(()=>{if(!x)return;let G=null,de=()=>{
G=null;let J=f.current,ve=h.current;if(!J||!ve)return;let ge=J.getBoundingClientRect();if(ge.bottom<=0||ge.top>=window.innerHeight||
ge.right<=0||ge.left>=window.innerWidth){T();return}let Z=window.innerWidth,he=window.innerHeight,Q=document.querySelector(
".sidebar")?.getBoundingClientRect(),U=window.matchMedia?.("(pointer: coarse)")?.matches===!0||Z<=640,V=Math.max(ge.right,
Q?.right||ge.right),ie=Z-V-Fp-xa,I=ve.getBoundingClientRect().height;if(!U&&ie>=Hp){let W=Math.min(Cl,ie),re=n_(ge.top,xa,
he-I-xa);g({mode:"right",left:V+Fp,top:re,width:W});return}g({mode:"sheet",bottom:xa,left:xa,width:Math.min(Cl,Z-xa*2)})},
Ne=()=>{G===null&&(G=requestAnimationFrame(de))};return Ne(),window.addEventListener("resize",Ne),document.addEventListener(
"scroll",Ne,!0),()=>{G!==null&&cancelAnimationFrame(G),window.removeEventListener("resize",Ne),document.removeEventListener(
"scroll",Ne,!0)}},[x,e]);let te={ref:f,className:a,role:d==="button"?void 0:"button",type:d==="button"?"button":void 0,tabIndex:d===
"button"?void 0:0,"aria-label":c,"aria-describedby":x?w:void 0,"aria-expanded":x,onPointerEnter:G=>{G.pointerType&&G.pointerType!==
"mouse"&&G.pointerType!=="pen"||(N.current.hovered=!0,E())},onPointerLeave:G=>{G.pointerType&&G.pointerType!=="mouse"&&G.
pointerType!=="pen"||(N.current.hovered=!1,E())},onPointerDown:G=>{G.pointerType==="touch"&&(K(),b.current=setTimeout(()=>{
b.current=null,H()},t_))},onPointerUp:K,onPointerCancel:K,onFocus:()=>{N.current.focused=!0,E()},onBlur:()=>{N.current.focused=
!1,E()},onClick:G=>{G.stopPropagation(),H()},onContextMenu:G=>{G.preventDefault(),G.stopPropagation(),H()},onKeyDown:G=>{
if(G.key==="Escape"){G.preventDefault(),T({restoreFocus:!0});return}d!=="button"&&(G.key==="Enter"||G.key===" ")&&(G.preventDefault(),
H())}},ne=v||{mode:"measuring",left:-1e4,top:xa,width:Cl},oe=x&&ReactDOM.createPortal(React.createElement("div",{ref:h,id:w,
className:`title-disclosure-portal ${i||""}`.trim(),role:"tooltip","data-title-disclosure-for":t,"data-title-disclosure-\
kind":n,"data-placement":ne.mode,style:{left:`${ne.left}px`,top:ne.top==null?"auto":`${ne.top}px`,bottom:ne.bottom==null?
"auto":`${ne.bottom}px`,width:ne.mode==="sheet"?`${ne.width}px`:"max-content",maxWidth:`${ne.width}px`,minWidth:`${Math.
min(Hp,ne.width)}px`}},e),document.body);return React.createElement("div",{className:s},React.createElement(y,{...te},e),
oe)}var xl=Object.freeze([{command:"/goal resume",action:"resume",detail:"Resume the current Codex goal through native goal \
control."},{command:"/goal pause",action:"pause",detail:"Pause the current Codex goal through native goal control."}]);function Up(e,t={}){
let s=(typeof e=="string"?e:"").trim(),a=Math.max(0,Number(t.attachmentCount)||0);if(!s||a>0||/[\r\n]/.test(s))return{kind:"\
chat",text:s};let i=s.toLowerCase(),c=xl.find(d=>d.command===i);return c?{kind:"goal_control",action:c.action,command:c.
command,text:s}:/^\/goal(?:\s|$)/i.test(s)?{kind:"unsupported_goal_control",command:s,text:s}:{kind:"chat",text:s}}function Gp(e,t){
let n=String(t||"").trim().toLowerCase();return e==="resume"&&n==="active"?"Already active":e==="pause"&&n==="paused"?"A\
lready paused":""}var Wp={schema_version:1,asset_set_version:"2026-07-16.1",retrieved_date:"2026-07-16",policy:{purpose:"First-party provi\
der identification in Remote Agent Chat usage surfaces.",brand_use:"Identification only; no endorsement is implied. Prov\
ider marks remain subject to each owner's brand and trademark terms and are not relicensed by this repository.",network:"\
Applications render only vendored files. No provider mark is hotlinked at runtime.",svg_safety:"Every SVG is reduced to \
static svg/path geometry with local fill colors; scripts, event handlers, foreign objects, entities, CSS imports, URLs, \
and external references are forbidden."},providers:[{provider_id:"openai-codex",accessible_name:"OpenAI",owner:"OpenAI",
brand_use_note:"OpenAI blossom used only to identify the OpenAI account card; follow https://openai.com/brand/.",source:{
kind:"installed_store_signed_app",page_url:"https://openai.com/brand/",package_identity:"OpenAI.Codex_26.707.12708.0_x64\
__2p2nqsd0c76g0",package_version:"26.707.12708.0",signature_kind:"Store",asset_root:"ms-appx:///assets/"},render:{web:{light:"\
openai-light.png",dark:"openai-dark.png"},android:{light:"openai-light.png",dark:"openai-dark.png"},monochrome:"native b\
lack/white package variants"},files:[{file:"openai-light.png",media_type:"image/png",sha256:"b45359d98553406d60c45e699cb\
e80de6fe733d51661a317ca37b41632b58823",source_member:"Square44x44Logo.targetsize-256_altform-lightunplated.png",source_sha256:"\
b45359d98553406d60c45e699cbe80de6fe733d51661a317ca37b41632b58823",transformations:["renamed only"]},{file:"openai-dark.p\
ng",media_type:"image/png",sha256:"2b001fb1f4e7d76e4d459c2ad8f9739e963ffc1c2137abcfffe8da3ee7775f7c",source_member:"Squa\
re44x44Logo.targetsize-256_altform-unplated.png",source_sha256:"2b001fb1f4e7d76e4d459c2ad8f9739e963ffc1c2137abcfffe8da3e\
e7775f7c",transformations:["renamed only"]}]},{provider_id:"anthropic-claude",accessible_name:"Anthropic Claude",owner:"\
Anthropic PBC",brand_use_note:"Claude Spark used only to identify the Anthropic Claude account card; sourced from Anthro\
pic's press kit.",source:{kind:"official_press_kit",page_url:"https://www.anthropic.com/news",artifact_url:"https://www-\
cdn.anthropic.com/ae59ca4ca194dac9c9dc3bc78c5829468cb0e8af.zip",artifact_sha256:"c68ac92df86c825f95177e24016fcc9a8863a3f\
d4ca344fe6f0700b2c1e07151"},render:{web:{light:"claude-color.svg",dark:"claude-color.svg"},android:{light:"claude-color.\
png",dark:"claude-color.png"},monochrome:"official clay mark retained on a neutral contrasting tile"},files:[{file:"clau\
de-color.svg",media_type:"image/svg+xml",sha256:"81fb40bb68c868b8037258a29c76f53e8eaba92398f43af48b92dbca5cf7d60a",source_member:"\
Anthropic media resources/Anthropic logos/Claude logos/3 Claude Spark/SVG/Claude Spark - Clay.svg",source_sha256:"6d53db\
4be375e899c937c26cf16684a80d6e869b1928d72b37748bef2560e219",transformations:["removed width and height attributes","norm\
alized static svg/path markup and LF line endings"]},{file:"claude-color.png",media_type:"image/png",sha256:"c7d8415b1ed\
ba67e5337d3684b480b563826f07be9e28e10ccc14bf92037ef6d",source_member:"Anthropic media resources/Anthropic logos/Claude l\
ogos/3 Claude Spark/PNG/Claude Spark - Clay.png",source_sha256:"c7d8415b1edba67e5337d3684b480b563826f07be9e28e10ccc14bf9\
2037ef6d",transformations:["renamed only"]}]},{provider_id:"cursor",accessible_name:"Cursor",owner:"Anysphere, Inc.",brand_use_note:"\
Cursor cube used only to identify the Cursor account card; sourced from Cursor's official brand kit.",source:{kind:"offi\
cial_brand_kit",page_url:"https://cursor.com/brand",artifact_url:"https://ptht05hbb1ssoooe.public.blob.vercel-storage.co\
m/assets/brand/cursor-brand-assets.zip",artifact_sha256:"97488a7751914e60f9ff532bc33810cdeaebddc017548abe6ca2bc29bbc3928"},
render:{web:{light:"cursor-light.svg",dark:"cursor-dark.svg"},android:{light:"cursor-light.png",dark:"cursor-dark.png"},
monochrome:"official light/dark 2D cube variants",color:"cursor-color.png"},files:[{file:"cursor-light.svg",media_type:"\
image/svg+xml",sha256:"6d5234e1254f3e9ccf1c46830441ee25c9c2a161fa044704117772b88a716664",source_member:"General Logos/Cu\
be/SVG/CUBE_2D_LIGHT.svg",source_sha256:"c483c02f78eb2619778fdd959e72a9adfac4844854472cd2653d4cbfd60e4d71",transformations:[
"removed generator metadata and defs/style wrapper","inlined the official fill color","normalized LF line endings"]},{file:"\
cursor-dark.svg",media_type:"image/svg+xml",sha256:"b4dd8a8c36a951016100100ca34c90c2a5381fce1230b1d0773e0d67a0f6e248",source_member:"\
General Logos/Cube/SVG/CUBE_2D_DARK.svg",source_sha256:"cd0e3e5d8991a4cdd4577f8896cd063105207665165c73e25a1ff918dd367eb7",
transformations:["removed generator metadata and defs/style wrapper","inlined the official fill color","normalized LF li\
ne endings"]},{file:"cursor-light.png",media_type:"image/png",sha256:"c61776321cea03d00860d5059029397a9b60e95e5c1f36f1b3\
bafe5a3a59c545",source_member:"General Logos/Cube/PNG/CUBE_2D_LIGHT.png",source_sha256:"c61776321cea03d00860d5059029397a\
9b60e95e5c1f36f1b3bafe5a3a59c545",transformations:["renamed only"]},{file:"cursor-dark.png",media_type:"image/png",sha256:"\
944f2b64bcb4b9603edb8721cf669d496ddc408d91c4a8ff471b650e4fb272b5",source_member:"General Logos/Cube/PNG/CUBE_2D_DARK.png",
source_sha256:"944f2b64bcb4b9603edb8721cf669d496ddc408d91c4a8ff471b650e4fb272b5",transformations:["renamed only"]},{file:"\
cursor-color.png",media_type:"image/png",sha256:"292696a0da45723f501c5c7546b30433cbd79070fc552682492a000e6ad7202b",source_member:"\
General Logos/Cube/PNG/CUBE_25D.png",source_sha256:"292696a0da45723f501c5c7546b30433cbd79070fc552682492a000e6ad7202b",transformations:[
"renamed only"]}]},{provider_id:"google-antigravity",accessible_name:"Google Antigravity",owner:"Google LLC",brand_use_note:"\
Antigravity icon used only to identify the Google Antigravity account card; sourced from the official press-assets page.",
source:{kind:"official_press_assets",page_url:"https://antigravity.google/press",artifact_urls:{color:"https://antigravi\
ty.google/assets/image/brand/antigravity-icon__full-color.png",light:"https://antigravity.google/assets/image/brand/anti\
gravity-icon__one-color.png",dark:"https://antigravity.google/assets/image/brand/antigravity-icon__white.png"}},render:{
web:{light:"antigravity-color.png",dark:"antigravity-color.png"},android:{light:"antigravity-color.png",dark:"antigravit\
y-color.png"},monochrome:{light:"antigravity-light.png",dark:"antigravity-dark.png"}},files:[{file:"antigravity-color.pn\
g",media_type:"image/png",sha256:"e0cd08ccd10cd8d08ccf0ba449823ee88495825c0841619618100d3ab089f51e",source_sha256:"e0cd0\
8ccd10cd8d08ccf0ba449823ee88495825c0841619618100d3ab089f51e",transformations:["renamed only"]},{file:"antigravity-light.\
png",media_type:"image/png",sha256:"00b50e4f0243cd07dcf536cf36bb2cf071c3e0445a99ca9afcb90142f870cc01",source_sha256:"00b\
50e4f0243cd07dcf536cf36bb2cf071c3e0445a99ca9afcb90142f870cc01",transformations:["renamed only"]},{file:"antigravity-dark\
.png",media_type:"image/png",sha256:"b65fac00147e2402dcef1d7730ad0feec6611c6ed5c5cb2ead64ad7609190405",source_sha256:"b6\
5fac00147e2402dcef1d7730ad0feec6611c6ed5c5cb2ead64ad7609190405",transformations:["renamed only"]}]},{provider_id:"ollama\
-local",accessible_name:"Ollama",owner:"Ollama",brand_use_note:"Ollama llama used only to identify the local Ollama runt\
ime card; source-code licensing does not imply trademark permission.",source:{kind:"official_first_party_site_asset",page_url:"\
https://ollama.com/",artifact_url:"https://ollama.com/public/ollama.png"},render:{web:{light:"ollama-light.png",dark:"ol\
lama-light.png",dark_tint:"CSS invert(1)"},android:{light:"ollama-light.png",dark:"ollama-light.png",dark_tint:"#ffffff"},
monochrome:"official black raster with deterministic white theme tint"},files:[{file:"ollama-light.png",media_type:"imag\
e/png",sha256:"5c5528504c307d34af504f39bc4e7007d2f6f31ee00dab699cc91584d1af8aca",source_sha256:"5c5528504c307d34af504f39\
bc4e7007d2f6f31ee00dab699cc91584d1af8aca",transformations:["renamed only","white dark-theme treatment is applied at rend\
er time without modifying source pixels"]}]}]};var r_=Object.freeze(Object.fromEntries(Wp.providers.map(e=>[e.provider_id,Object.freeze({accessibleName:e.accessible_name,
light:`/provider-assets/${e.render.web.light}`,dark:`/provider-assets/${e.render.web.dark}`,darkTint:e.render.web.dark_tint||
""})])));function o_(e){return r_[String(e||"")]||null}function Bi({providerId:e,providerName:t}){let n=o_(e),[s,a]=React.
useState(!1);React.useEffect(()=>a(!1),[e]);let i=n?.accessibleName||String(t||"Unknown provider");return!n||s?React.createElement(
"span",{className:"usage-dashboard-provider-mark usage-dashboard-provider-mark-fallback","data-provider-mark-id":e,role:"\
img","aria-label":`${i} provider mark unavailable`},React.createElement("span",{"aria-hidden":"true"},i)):React.createElement(
"span",{className:"usage-dashboard-provider-mark","data-provider-mark-id":e,role:"img","aria-label":`${i} provider mark`},
React.createElement("img",{className:"usage-dashboard-provider-mark-image usage-dashboard-provider-mark-light",src:n.light,
alt:"","aria-hidden":"true",onError:()=>a(!0)}),React.createElement("img",{className:`usage-dashboard-provider-mark-imag\
e usage-dashboard-provider-mark-dark${n.darkTint?" usage-dashboard-provider-mark-tinted":""}`,src:n.dark,alt:"","aria-hi\
dden":"true",onError:()=>a(!0)}))}var i_=Object.freeze({codex:"openai-codex","codex-desktop":"openai-codex",codex_cli:"openai-codex",codex_vscode:"openai-\
codex",claude:"anthropic-claude","claude-desktop":"anthropic-claude",claude_cli:"anthropic-claude",claude_code:"anthropi\
c-claude",cursor:"cursor",cursor_cli:"cursor",antigravity:"google-antigravity",antigravity_panel:"google-antigravity","a\
ntigravity-v2":"google-antigravity",gemini:"google-antigravity",ollama:"ollama-local"}),c_=Object.freeze({"openai-codex":"\
OpenAI Codex","anthropic-claude":"Anthropic Claude",cursor:"Cursor","google-antigravity":"Google Antigravity","ollama-lo\
cal":"Ollama"});function Ct(e,t=160){return String(e??"").replace(/\s+/g," ").trim().slice(0,t)}function Fi(e){return Ct(
e).toLowerCase().replace(/[^a-z0-9]+/g,"")}function wo(e){let t=Number(e);return Number.isFinite(t)?t:null}function l_(e,t){
return Ct(e?.agent_type||e?.agentType||t?.agent_type||t?.agentType,80)}function Vp(e,t){return Ct(e?.usage_billing_provider_id||
e?.billing_provider_id||e?.provider_usage?.provider_id||t?.usage_billing_provider_id||t?.billing_provider_id,80)}function u_(e,t){
return Ct(e?.usage_account_fingerprint||e?.provider_account_fingerprint||e?.provider_usage?.account_fingerprint||t?.usage_account_fingerprint,
96)}function d_(e,t){return Ct(e?.usage_quota_domain||e?.provider_quota_domain||e?.provider_usage?.quota_domain||t?.usage_quota_domain,
120)}function p_(e,t){let n=Ct(t?.observed_model_id||t?.model_id||t?.selected_model_id||t?.model||e?.observed_model_id||
e?.model_id||e?.selected_model_id||e?.model,160),s=Ct(t?.observed_model_label||t?.model_label||e?.model_label||n,160);return{
id:n,label:s}}function m_(e,t,n){let s=Ct(n?.model_vendor||t?.model_vendor,80);if(s)return s;let a=`${e.id} ${e.label}`.
toLowerCase();return/claude|anthropic/.test(a)?"Anthropic":/gemini|google/.test(a)?"Google":/gpt|codex|openai|\bo[1345](?:\b|-)/.
test(a)?"OpenAI":/ollama|qwen|gemma|llama|mistral/.test(a)?"Ollama/runtime-defined":e.id?"Unknown model vendor":"Not rep\
orted"}function f_(e,t){let n=Ct(e?.usage_runtime_kind||e?.ollama_runtime_kind||e?.model_runtime_kind||t?.usage_runtime_kind||
t?.ollama_runtime_kind||t?.model_runtime_kind,32).toLowerCase();return n==="local"||n==="cloud"?n:""}function g_(e,t){if(!e.
id||!t)return!1;let n=[Fi(e.id),Fi(e.label)].filter(Boolean),s=[Fi(t.id),Fi(t.label)].filter(Boolean);return s.length===
0?!1:s.some(a=>n.some(i=>i===a||i.includes(a)||a.includes(i)))}function Al(e){let t=wo(e?.remainingPercent);if(t!=null)return t;
let n=wo(e?.usedPercent);return n==null?null:100-n}function zp(e,t){let n=Al(e),s=Al(t);if(n!=null&&s!=null&&n!==s)return n-
s;if(n!=null)return-1;if(s!=null)return 1;let a=wo(e?.durationMinutes),i=wo(t?.durationMinutes);return a!=null&&i!=null&&
a!==i?a-i:Ct(e?.label).localeCompare(Ct(t?.label))}function h_(e,t,n){let s=l_(e,t),a=p_(e,t),i=Vp(e,t)||i_[s]||"";return{
supported:!!i,state:i?"unavailable":"unsupported",tone:"unavailable",message:i?"Usage account unavailable":"No provider \
usage mapping",billingProviderId:i,billingProviderName:c_[i]||i||"Provider",providerMarkId:i,harnessSurface:s,modelId:a.
id,modelLabel:a.label,modelVendor:m_(a,e,t),accountFingerprint:"",accountLabel:"",quotaDomain:"",plan:"",mappingConfidence:"\
unavailable",generation:Number(n?.generation)||0,capturedAt:"",staleAfter:"",freshness:Ct(n?.collectionState||"unavailab\
le",40),source:"",error:null,applicableWindows:[],headerWindows:[],credits:null,financials:null,cloudUsage:null,localRuntime:null,
runtimeKind:i==="ollama-local"?f_(e,t):""}}function __(e,t,n,s){let a=Array.isArray(s?.entries)?s.entries:[],i=u_(t,n),c=d_(
t,n),d=e.billingProviderId?a.filter(f=>f?.providerId===e.billingProviderId):a.filter(f=>Array.isArray(f?.harnessTypes)&&
f.harnessTypes.includes(e.harnessSurface));return i&&(d=d.filter(f=>f?.accountFingerprint===i)),c&&(d=d.filter(f=>f?.quotaDomain===
c)),d.length===1?{entry:d[0],confidence:i||c?"explicit_account":Vp(t,n)?"explicit_provider":"unique_provider_account"}:d.
length>1?{entry:null,confidence:"ambiguous",candidates:d}:{entry:null,confidence:i||c?"linked_account_unavailable":"unav\
ailable",candidates:d}}function Kp(e,t,n,s=Date.now()){let a=h_(e,t,n);if(!a.supported)return a;let i=__(a,e,t,n);if(!i.
entry)return{...a,state:i.confidence==="ambiguous"?"ambiguous":"unavailable",message:i.confidence==="ambiguous"?"Usage a\
ccount ambiguous":"Usage account unavailable",mappingConfidence:i.confidence};let c=i.entry,d=Date.parse(c.staleAfter||""),
h=Number.isFinite(d)&&d<=s&&c.status==="fresh"?"stale":Ct(c.status||"unavailable",40),b={id:a.modelId,label:a.modelLabel},
N=Array.isArray(c.windows)?c.windows.filter(E=>E&&E.usedPercent!=null):[],x=N.filter(E=>E.modelScope&&g_(b,E.modelScope)).
sort(zp),S=N.filter(E=>!E.modelScope).sort(zp),R=[...x,...S],u=x.length>0?[x[0],S[0]].filter(Boolean):S.slice(0,2),v=a.runtimeKind;
if(a.billingProviderId==="ollama-local"){if(!v)return{...a,billingProviderName:c.providerName||a.billingProviderName,accountFingerprint:c.
accountFingerprint,accountLabel:c.accountLabel,quotaDomain:c.quotaDomain,plan:c.plan,mappingConfidence:i.confidence,capturedAt:c.
capturedAt,staleAfter:c.staleAfter,freshness:h,source:c.source,state:"ambiguous",message:"Ollama runtime unavailable",cloudUsage:c.
cloudUsage,localRuntime:c.localRuntime};if(v==="local")return{...a,billingProviderName:c.providerName||a.billingProviderName,
accountFingerprint:c.accountFingerprint,accountLabel:c.accountLabel,quotaDomain:c.quotaDomain,plan:c.plan,mappingConfidence:i.
confidence,capturedAt:c.capturedAt,staleAfter:c.staleAfter,freshness:h,source:c.source,state:c.localRuntime?"local":"una\
vailable",tone:c.localRuntime?"local":"unavailable",message:c.localRuntime?"Local \xB7 no plan limit":"Local runtime tel\
emetry unavailable",localRuntime:c.localRuntime,cloudUsage:c.cloudUsage}}let g=new Set(u.map(E=>E.tone)),w=g.has("critic\
al")?"critical":g.has("warning")?"warning":h==="stale"?"stale":u.length>0?"ok":"unavailable",y=h==="auth_required"||h===
"unavailable"?"unavailable":h==="stale"||h==="rate_limited"?"stale":u.some(E=>Number(E.usedPercent)>=100)?"exhausted":u.
length>0?"ready":"unavailable";return{...a,state:y,tone:y==="exhausted"?"critical":w,message:u.length>0?"":"Applicable u\
sage windows unavailable",billingProviderName:c.providerName||a.billingProviderName,accountFingerprint:c.accountFingerprint,
accountLabel:c.accountLabel,quotaDomain:c.quotaDomain,plan:c.plan,mappingConfidence:i.confidence,capturedAt:c.capturedAt,
staleAfter:c.staleAfter,freshness:h,source:c.source,error:c.error,applicableWindows:R,headerWindows:u,credits:c.credits,
financials:c.financials,cloudUsage:c.cloudUsage,localRuntime:c.localRuntime}}function Rl(e){let t=Ct(e?.label||"Usage",60),
n=Al(e);return{label:t,usedPercent:wo(e?.usedPercent),remainingPercent:n,compactValue:n==null?"Unavailable":`${Math.max(
0,Math.round(n))}% left`,reset:Ct(e?.resetDescription||e?.resetsAt,120),tone:Ct(e?.tone||"unavailable",24)}}var Lm=Jf(rm()),{goalLifecycleSupported:U_,latestUserRequestFromMessages:G_,projectFleetWorkContext:W_}=Lm.default,{useState:ce,
useRef:Ae,useEffect:Me,useLayoutEffect:Ma}=React,om="remote-agent-chat:drafts:v1",im="remote-agent-chat:show-test-sessio\
ns:v1",z_=120,V_=500,K_=160,Y_=256*1024,cm=Object.freeze([]),X_=[...xl,{command:"/plan",detail:"Outline the implementati\
on approach and major steps."},{command:"/review",detail:"Review the current changes for bugs, regressions, and missing \
tests."},{command:"/fix",detail:"Implement or repair the current issue."},{command:"/summarize",detail:"Summarize the cu\
rrent state and important changes."}],Ln={claude:{name:"Claude Code",color:"#cc785c",abbr:"CC",logo:"/logo-claude-in-ag.\
svg"},claude_cli:{name:"Claude Code CLI",color:"#d97757",abbr:"CLI",logo:"/logo-claude-in-ag.svg"},"claude-desktop":{name:"\
Claude Desktop",color:"#cc785c",abbr:"CD",logo:"/logo-claude-in-ag.svg"},codex:{name:"Codex",color:"#10a37f",abbr:"CX",logo:"\
/logo-codex-in-ag.svg"},codex_cli:{name:"Codex CLI",color:"#10a37f",abbr:"CLI",logo:"/logo-codex.svg"},"codex-desktop":{
name:"Codex Desktop",color:"#10a37f",abbr:"CX",logo:"/logo-codex.svg"},cursor:{name:"Cursor",color:"#7AA2F7",abbr:"CR",logo:"\
/logo-cursor.svg"},cursor_cli:{name:"Cursor CLI",color:"#7c6cf0",abbr:"CLI",logo:"/logo-cursor.svg"},gemini:{name:"Gemin\
i",color:"#4285f4",abbr:"GC",logo:"/logo-gemini-in-ag.svg"},continue:{name:"Continue",color:"#d29922",abbr:"CN",logo:"/l\
ogo-continue.png"},continue_yolo:{name:"Continue YOLO",color:"#f59e0b",abbr:"CY",logo:"/logo-continue.png"},roo_code:{name:"\
Roo Code",color:"#06b6d4",abbr:"RC",logo:"/logo-continue.png"},cline:{name:"Cline",color:"#6366f1",abbr:"CL",logo:"/logo\
-cline.svg"},antigravity:{name:"Antigravity",color:"#a855f7",abbr:"AG",logo:"/logo-antigravity.svg"},antigravity_panel:{
name:"Antigravity Chat",color:"#a855f7",abbr:"AC",logo:"/logo-antigravity.svg"},"antigravity-v2":{name:"Antigravity v2",
color:"#7c3aed",abbr:"A2",logo:null}},jl={name:"Agent",color:"#8b949e",abbr:"AG"};function Bl(e){return e==="continue"||
e==="continue_yolo"}function Co(e){return e==="cline"||e==="roo_code"}function Q_(e){return e==="codex"||e==="codex-desktop"}function J_(e){return e==="codex_cli"||e==="cursor_cli"?K_:Q_(e)?
V_:z_}function ae(e,t=""){return typeof e=="string"?e:e==null?t:String(e)}function It(e){if(typeof e=="string")return e;
if(Array.isArray(e))return e.map(t=>typeof t=="string"?t:!t||typeof t!="object"?"":typeof t.text=="string"?t.text:typeof t.
content=="string"?t.content:typeof t.url=="string"?t.url:typeof t.image_url=="string"?t.image_url:"").filter(Boolean).join(
" ");if(e&&typeof e=="object"){if(typeof e.text=="string")return e.text;if(typeof e.content=="string")return e.content;if(typeof e.
url=="string")return e.url;if(typeof e.image_url=="string")return e.image_url;try{return JSON.stringify(e)}catch{return""}}
return""}function qm(e){let t=typeof e=="string"?e:ae(e),n=2166136261;for(let s=0;s<t.length;s++)n^=t.charCodeAt(s),n=Math.
imul(n,16777619);return(n>>>0).toString(36)}function Kl(e,t=0){if(!e||typeof e!="object")return`empty:${t}`;if(e._cid)return`\
cid:${e._cid}`;if(e.source_message_id)return`source:${e.source_message_id}`;if(e.native_source_id)return`native:${e.native_source_id}`;
if(e.id!=null)return`id:${e.id}`;if(e.server_message_id!=null)return`server:${e.server_message_id}`;if(e.client_msg_id)return`\
client:${e.client_msg_id}`;if(e.sequence!=null)return`seq:${e.sequence}`;let n=It(e.content)||Mo(e.content_blocks),s=Array.
isArray(e.content_blocks)?JSON.stringify(e.content_blocks):"";return["body",e.role||"",e.ts||"",qm(`${n}
${s}`)].join(":")}function Z_(e){let t=It(e?.content)||Mo(e?.content_blocks),n=Array.isArray(e?.content_blocks)?JSON.stringify(
e.content_blocks):"";return qm(`${t}
${n}`)}function eb(e){return e?.role==="user"?"user":Er(e?.content_blocks)[0]?.type||"markdown"}function El(e){return(Array.
isArray(e)?e:[]).map((n,s)=>Kl(n,s))}function hn(e,t){if(!e)return;let n=e.style.scrollBehavior;e.style.scrollBehavior="\
auto",e.scrollTop=t,requestAnimationFrame(()=>{e.style.scrollBehavior==="auto"&&(e.style.scrollBehavior=n)})}function tb(e){
let t=It(e),n=t.match(/^\[File: ([^\]]+?) [→\u2192] ([A-Za-z]:\\.+?\\uploads\\([^\\\]]+))\]$/);if(!n)return t;let[,s,,
a]=n;return/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(s)?`![${s}](/uploads/${a})`:t}function nb(e){return It(e).trim().length>
0}function Er(e){return Array.isArray(e)?e.filter(t=>t&&typeof t=="object").map(t=>{let n=ae(t.type||"markdown").toLowerCase();
if(n==="code"){let s=ae(t.language||t.lang||"").trim(),a=It(t.content||t.text||t.markdown||"");return{...t,type:"markdow\
n",content:`\`\`\`${s}
${a}
\`\`\``}}return n==="file_change"?{...t,type:"file_changes"}:n==="tool"?{...t,type:"tool_call"}:n==="tool_output"||n==="\
result"?{...t,type:"tool_result"}:n==="thought"?{...t,type:"thinking"}:n==="task_list"?{...t,type:"plan"}:n==="queue"||n===
"queued"?{...t,type:"queued_message"}:n==="banner"||n==="notification"?{...t,type:"notice"}:n==="worked"||n==="activity"?
{...t,type:"status"}:t}):[]}function Pm(e){if(!e||typeof e!="object")return"";let t=[e.workdir?`cwd: ${e.workdir}`:null,
e.command?`$ ${e.command}`:null,e.stdout||null,e.stderr?`stderr:
${e.stderr}`:null,e.exit_code!=null?`exit code: ${e.exit_code}`:null].filter(Boolean);if(t.length)return t.join(`

`);if(Array.isArray(e.files)&&e.files.length>0){let n=e.files.map(s=>[s.path||s.file||"",s.added!=null?`+${s.added}`:"",
s.removed!=null?`-${s.removed}`:""].filter(Boolean).join(" ")).filter(Boolean).join(`
`);return[e.content||e.text||e.markdown||"",n].filter(Boolean).join(`

`)}if(Array.isArray(e.tasks)&&e.tasks.length>0){let n=e.tasks.map(s=>{let a=ae(s?.text||s?.step||s?.title).trim(),i=ae(s?.
state||s?.status||"pending").trim();return a?`[${i}] ${a}`:""}).filter(Boolean).join(`
`);return[e.content||"",n].filter(Boolean).join(`
`)}return e.content||e.text||e.markdown||e.title||e.label||""}function sb(e){return e?nb(e.content)?!0:Er(e.content_blocks).
some(t=>It(Pm(t)).trim().length>0):!1}function Mo(e){return Er(e).map(t=>It(Pm(t))).filter(Boolean).join(`

`)}function Zs({actions:e}){return!Array.isArray(e)||e.length===0?null:React.createElement("div",{className:"content-blo\
ck-actions"},e.map((t,n)=>React.createElement("span",{key:t.id||n,className:`content-block-action-label${t.unsupported?"\
 unsupported":""}`,title:t.unsupported?"This Codex control is visible in the source app but is not currently available f\
rom the web UI.":void 0},t.label||t.id||"Action")))}var ab=512,Ta=new Map;function rb(e,t){if(e)for(Ta.delete(e),Ta.set(
e,t);Ta.size>ab;)Ta.delete(Ta.keys().next().value)}function Aa({className:e,summary:t,children:n,stateKey:s="",defaultOpen:a=!0}){
let[i,c]=React.useState(()=>s&&Ta.has(s)?Ta.get(s):a),d=React.useCallback(f=>{let h=f.currentTarget.open;c(h),rb(s,h)},[
s]);return React.createElement("details",{className:e,open:i,onToggle:d},React.createElement("summary",null,t),n)}function ob(e){
let t=ae(e).trim().match(/^(Edited\s+\d+\s+files?)(?:\s+(\+\d+))?(?:\s+(-\d+))?$/i);return t?{label:t[1],additions:t[2]||
"",deletions:t[3]||""}:null}function ib({blocks:e,monospace:t,autoExpandLongCodeBlocks:n,onOpenPath:s,agentType:a,richContentEager:i=!0,
richContentCacheIdentity:c=""}){let d=Er(e);if(d.length===0)return null;let f=ae(a).toLowerCase()==="cursor",h=ae(a).toLowerCase()===
"claude",b=ae(a).toLowerCase()==="codex",N=ae(a).toLowerCase()==="codex-desktop",x=ae(a).toLowerCase()==="antigravity-v2";
function S(u){let v=[u.workdir?`cwd: ${u.workdir}`:null,u.command?`$ ${u.command}`:null,u.stdout||null,u.stderr?`stderr:\

${u.stderr}`:null,u.exit_code!=null?`exit code: ${u.exit_code}`:null].filter(Boolean);return v.length?v.join(`

`):It(u.content||u.text||u.markdown||"")}function R(u,v){return React.createElement(yr,{content:u,monospace:t,autoExpandLongCodeBlocks:n,
onOpenPath:s,deferUntilVisible:!i,cacheIdentity:`${c}:block:${v}`})}return React.createElement("div",{className:`content\
-blocks${f?" content-blocks-cursor":""}`},d.map((u,v)=>{let g=ae(u.type||"markdown").toLowerCase(),w=ae(u.title||u.label||
u.summary||g),y=S(u);if(g==="status")return React.createElement("div",{key:v,className:"content-block content-block-stat\
us-chip",title:w},w||"Status");if(g==="thinking"){let E=!y||ae(y).replace(/\s+/g," ").trim()===w;if(b){let T=y&&!E?y:w&&
w.toLowerCase()!=="thinking"?w:"";return T?React.createElement("div",{key:v,className:"content-block content-block-think\
ing-native"},R(T,v)):null}return N&&E?React.createElement("div",{key:v,className:"content-block content-block-thinking-c\
odex-desktop"},React.createElement("span",null,w||"Worked"),React.createElement("span",{className:"content-block-thinkin\
g-codex-desktop-chevron","aria-hidden":"true"},"\u2304")):N?React.createElement(Aa,{key:v,stateKey:`${c}:disclosure:${v}`,
className:"content-block content-block-thinking-codex-desktop",summary:w||"Worked"},R(y,v)):f&&E?React.createElement("di\
v",{key:v,className:"content-block content-block-status-chip thinking",title:w},w||"Thinking"):React.createElement(Aa,{key:v,
stateKey:`${c}:disclosure:${v}`,className:"content-block content-block-thinking",summary:w||"Thinking"},y&&!E&&R(y,v))}if(g===
"tool_call"||g==="tool_result"){let E=!y||ae(y).replace(/\s+/g," ").trim()===w;return f&&E?React.createElement("div",{key:v,
className:"content-block content-block-status-chip tool",title:w},w||"Tool"):React.createElement(Aa,{key:v,stateKey:`${c}\
:disclosure:${v}`,className:`content-block content-block-${g==="tool_result"?"tool-result":"tool"}`,summary:React.createElement(
React.Fragment,null,React.createElement("span",null,w||(g==="tool_result"?"Tool result":"Tool")),u.status&&React.createElement(
"span",{className:`content-block-status ${ae(u.status).toLowerCase()}`},u.status))},y&&React.createElement("pre",{className:"\
content-block-pre"},y),React.createElement(Zs,{actions:u.actions}))}if(g==="terminal"){if(h){let E=(w||"Bash").match(/^(\S+)(?:\s+([\s\S]*))?$/),
T=E?.[1]||"Bash",H=E?.[2]||"",K=ae(u.status||"running").toLowerCase();return React.createElement("div",{key:v,className:"\
content-block content-block-terminal-claude",role:"group","aria-label":w||"Bash command"},React.createElement("div",{className:"\
content-block-terminal-claude-header"},React.createElement("span",{className:`content-block-terminal-claude-dot ${K}`,"a\
ria-hidden":"true"}),React.createElement("strong",null,T),H&&React.createElement("span",null,H)),React.createElement("di\
v",{className:"content-block-terminal-claude-body"},u.command&&React.createElement("div",{className:"content-block-termi\
nal-claude-row"},React.createElement("span",null,"IN"),React.createElement("pre",null,u.command)),u.stdout&&React.createElement(
"div",{className:"content-block-terminal-claude-row"},React.createElement("span",null,"OUT"),React.createElement("pre",null,
u.stdout)),u.stderr&&React.createElement("div",{className:"content-block-terminal-claude-row error"},React.createElement(
"span",null,"ERR"),React.createElement("pre",null,u.stderr))),React.createElement(Zs,{actions:u.actions}))}return N?React.
createElement(Aa,{key:v,stateKey:`${c}:disclosure:${v}`,className:"content-block content-block-terminal-codex-desktop",summary:React.
createElement("span",null,"Ran commands")},y&&React.createElement("pre",{className:"content-block-pre"},y),React.createElement(
Zs,{actions:u.actions})):React.createElement(Aa,{key:v,stateKey:`${c}:disclosure:${v}`,className:"content-block content-\
block-terminal",summary:React.createElement(React.Fragment,null,React.createElement("span",null,w||"Terminal"),u.exit_code!=
null&&React.createElement("span",{className:"content-block-status"},"exit ",u.exit_code))},y&&React.createElement("pre",
{className:"content-block-pre"},y),React.createElement(Zs,{actions:u.actions}))}if(g==="file_changes"){let E=ob(w);if(!!(f&&
E&&!y&&(!Array.isArray(u.files)||u.files.length===0)&&(!Array.isArray(u.actions)||u.actions.length===0)))return React.createElement(
"div",{key:v,className:"content-block content-block-file-change content-block-file-change-cursor-summary"},React.createElement(
"span",null,E.label),E.additions&&React.createElement("span",{className:"content-block-add"},E.additions),E.deletions&&React.
createElement("span",{className:"content-block-del"},E.deletions));let H=[u.files_changed!=null?`${u.files_changed} file\
s`:null,u.additions!=null?`+${u.additions}`:null,u.deletions!=null?`-${u.deletions}`:null].filter(Boolean).join(" ");return React.
createElement(Aa,{key:v,stateKey:`${c}:disclosure:${v}`,className:"content-block content-block-file-change",summary:React.
createElement(React.Fragment,null,React.createElement("span",null,w||"File changes",H?` ${H}`:""),u.status&&React.createElement(
"span",{className:`content-block-status ${ae(u.status).toLowerCase()}`},u.status))},Array.isArray(u.files)&&u.files.length>
0&&React.createElement("div",{className:"content-block-file-list"},u.files.map((K,te)=>React.createElement("div",{className:"\
content-block-file-row",key:K.path||te},React.createElement("span",{className:"content-block-file-path"},K.path||"file"),
K.added!=null&&React.createElement("span",{className:"content-block-add"},"+",K.added),K.removed!=null&&React.createElement(
"span",{className:"content-block-del"},"-",K.removed)))),y&&R(y,v),React.createElement(Zs,{actions:u.actions}))}if(g==="\
artifact")return React.createElement("div",{key:v,className:"content-block content-block-artifact"},React.createElement(
"div",{className:"content-block-title"},w||"Artifact"),y&&R(y,v));if(g==="plan"){let E=Array.isArray(u.tasks)?u.tasks:[];
return React.createElement("div",{key:v,className:"content-block content-block-plan"},React.createElement("div",{className:"\
content-block-title"},w||"Plan"),E.length>0&&React.createElement("ol",{className:"content-block-plan-list"},E.map((T,H)=>{
let K=ae(T?.state||T?.status||"pending").toLowerCase();return React.createElement("li",{key:T.id||H,className:`content-b\
lock-plan-item ${K}`},React.createElement("span",{className:"content-block-plan-marker","aria-hidden":"true"},K==="compl\
eted"?"\u2713":K==="in_progress"?"\u2022":"\u25CB"),React.createElement("span",null,T.text||T.step||T.title||""))})),y&&
!E.length&&R(y,v))}return g==="queued_message"?React.createElement("div",{key:v,className:"content-block content-block-q\
ueued-message"},React.createElement("span",{className:"content-block-queued-label"},w||"Queued message"),y&&React.createElement(
"span",{className:"content-block-queued-body"},y)):g==="notice"?React.createElement("div",{key:v,className:`content-bloc\
k content-block-notice ${ae(u.tone||u.status||"info").toLowerCase()}`},React.createElement("div",{className:"content-blo\
ck-title"},w||"Notice"),y&&R(y,v),React.createElement(Zs,{actions:u.actions})):g==="error"&&x?React.createElement(Aa,{key:v,
stateKey:`${c}:disclosure:${v}`,className:"content-block content-block-error content-block-error-antigravity-v2",defaultOpen:!1,
summary:React.createElement(React.Fragment,null,React.createElement("span",{className:"content-block-error-antigravity-v\
2-label"},w||"Error"),y&&React.createElement("span",{className:"content-block-error-antigravity-v2-message"},y))},React.
createElement(Zs,{actions:u.actions})):g==="prompt"||g==="error"?React.createElement("div",{key:v,className:`content-blo\
ck content-block-${g}`},React.createElement("div",{className:"content-block-title"},w||g),y&&R(y,v),React.createElement(
Zs,{actions:u.actions})):React.createElement("div",{key:v,className:"content-block content-block-markdown"},R(y||w,v))}))}
function Ll(e){let t=It(e).trim();return!(!t||t.length<4||/^[\s*._|`~•·▌]+$/.test(t)||!/[A-Za-z0-9]/.test(t))}function Qi({
message:e=null,instant:t=null}){let n=t==null?kr(e):Qn(t);if(!n)return React.createElement("span",{className:"message-ti\
mestamp message-timestamp-unknown","aria-label":"Sent time unknown",title:"Sent time unknown"},"Time unknown");let s=bd(
n);return React.createElement("time",{className:"message-timestamp",dateTime:n.iso,title:s,"aria-label":`Sent ${s}`},Kc(
n))}function cb(e){return typeof e=="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.
test(e)}function lm(e){if(!e)return jl;let t=e.split("-")[0].toLowerCase();return Ln[t]||jl}function Ra(e){let t=ae(e).toLowerCase();
return t?t.includes("roo code")||t.includes("roo_code")||t.includes("roo-cline")?"roo_code":t.includes("cline")||t.includes(
"claude-dev")?"cline":t.includes("continue yolo")||t.includes("continue_yolo")?"continue_yolo":t.includes("continue")?"c\
ontinue":t.includes("codex cli")||t.includes("codex_cli")?"codex_cli":t.includes("codex desktop")?"codex-desktop":t.includes(
"cursor cli")||t.includes("cursor_cli")?"cursor_cli":/\bcursor\b/.test(t)||t==="cursor"||t.includes("cursor ide")?"curso\
r":t.includes("codex")?"codex":t.includes("claude code")||t.includes("claude")?"claude":t.includes("antigravity chat")||
t.includes("antigravity_panel")?"antigravity_panel":t.includes("antigravity-v2")||t.includes("antigravity v2")?"antigrav\
ity-v2":null:null}function um(e){if(e&&typeof e=="object"){let t=e.agent_type;return Ln[t]?t:Ra(e.display_name)||Ra(e.agent_type)||
Ra(e.session_title)||Ra(e.window_title)||Ra(e.chat_title)||Ra(e.session_id)}if(typeof e=="string"){let t=e.split("-")[0].
toLowerCase();return Ln[t]?t:Ra(e)}return null}function Ee(e){return typeof e=="string"?e:e?.session_id}function $r(e,t){
if(e&&typeof e=="object"){let s=um(e);return Ln[s]||lm(e.session_id)}let n=um(e);return Ln[n]||lm(e)}function Tr(e,t,n){
if(e&&typeof e=="object"){let i=yb(e,n),c=n?.file_access_scope?n.file_access_scope.replace(/\\/g,"/").split("/").filter(
Boolean).pop():null,d=e.agent_type==="antigravity_panel"&&e.panel_title?` / ${e.panel_title}`:"",f=(i?.label||e.workspace_name||
c||e.window_title||e.workspace_path||t||"Session")+d;return e.chat_title&&!f.includes("/")?`${f} / ${e.chat_title}`:f}let s=t||
e;return typeof s!="string"?"Session":cb(s)?"Connected session":s.split("-").slice(1).join("-")||s}function Im(e){let t=ae(
e).replace(/\\/g,"/").replace(/\/+$/,"").trim();return t?t.split("/").filter(Boolean).pop()||t:""}function Zi(e){return ae(
e).replace(/\\/g,"/").replace(/\/+$/,"").trim()}function Om(e){let t=Zi(e);return/^[A-Za-z]:\//.test(t)||t.startsWith("/\
/")||t.startsWith("/")}function lb(e){let t=Zi(e).toLowerCase();return/^[a-z]:\/users\/[^/]+$/.test(t)||/^[a-z]:\/users\/[^/]+\/documents$/.
test(t)||/^\/users\/[^/]+$/.test(t)||/^\/users\/[^/]+\/documents$/.test(t)||/^\/home\/[^/]+$/.test(t)}function ub(e){let t=Zi(
e),n=t.match(/^[A-Za-z]:\/Users\/([^/]+)(?:\/|$)/i);if(n)return n[1];let s=t.match(/^\/(?:Users|home)\/([^/]+)(?:\/|$)/i);
return s?s[1]:""}function db(e,t){let n=ub(t);return!!n&&ae(e).trim().toLowerCase()===n.toLowerCase()}function Yl(e){return ae(
e).replace(/\s+\(Workspace\)$/i,"").replace(/\s+-\s+(?:Visual Studio Code|Code|Cursor|Antigravity)(?:\s*\[[^\]]+\]|\s+(?:Administrator|Admin))?$/i,
"").trim()}function Dm(e){let t=ae(e).trim();return/^(?:Visual Studio Code|Code|Cursor|Antigravity)(?:\s*\[[^\]]+\]|\s+(?:Administrator|Admin))?$/i.
test(t)}function pb(e){return/\s+-\s+(?:Visual Studio Code|Code|Cursor|Antigravity)(?:\s*\[[^\]]+\]|\s+(?:Administrator|Admin))?\s*$/i.
test(ae(e))}function jm(e){let t=ae(e).trim();if(!t)return[];let n=t.split(/\s+-\s+/).map(s=>Yl(s)).filter(Boolean);for(;n.
length&&Dm(n[n.length-1]);)n.pop();return n}var mb=/\b(?:image|screenshot|screen\s*shot|capture)[\w .()[\]-]*\.(?:png|jpe?g|gif|webp|bmp|svg)(?:\b|[\s._-]*\d{2,}(?:\s*[x\u00d7]\s*\d{2,})?|[\s._-]*[a-z0-9]{3,})/i,
fb=/(?:[A-Za-z]:[\\/]|\\\\[^\\/\s]+[\\/]|\/(?:Users|home|mnt|var|tmp|etc|opt|workspace|workspaces)\/)[^\s"'`<>)]{2,}/i,Bm=new Set(
["agent","agent manager","agent session","antigravity","antigravity chat","antigravity v2","claude","claude code","codex",
"codex cli","codex desktop","connected session","other","session","unknown"]),gb=new Set(Array.from(Bm,e=>e.replace(/[^a-z0-9]+/g,
"")));function Fm(e){let t=Yl(e);if(!t)return"";let n=Im(t),s=/[-_]/.test(n),a=n.replace(/[-_]+/g," ");return(s||!/\s/.test(
n))&&(a=a.replace(/([a-z])([A-Z])/g,"$1 $2")),a.replace(/\s+/g," ").trim()}function hb(e){let t=Fm(e).toLowerCase();if(!t||
/^window\s+\d+$/.test(t)||Dm(t)||Bm.has(t))return!0;let n=t.replace(/[^a-z0-9]+/g,"");return gb.has(n)}function _b(e,t){
return ae(e).toLowerCase()===ae(t).toLowerCase()}function Xl(e,t){let n=Fm(e);return hb(n)?null:{label:n,key:ae(t||n).replace(
/\\/g,"/").replace(/\/+$/,"").toLowerCase()}}function dm(e){let t=Zi(e);return!t||!Om(t)||lb(t)?null:Xl(Im(t),t)}function pm(e){
let t=jm(e);return t.length<2?null:Xl(t[t.length-1],t[t.length-1])}function bb(e){let t=ae(e);if(pb(t))return null;let n=Yl(
e);return!n||Om(n)||jm(n).length>=2?null:Xl(n,n)}function vb(e){let t=ae(e).toLowerCase().trim();return[t,t.replace(/\s+/g,
"-"),t.replace(/\s+/g,"")].filter(Boolean)}function mm(e,t=[]){let n=e.map(a=>ae(a).toLowerCase()).filter(Boolean),s=[...t].
sort((a,i)=>i.label.length-a.label.length);for(let a of s){let i=vb(a.label);if(n.some(c=>i.some(d=>d&&c.includes(d))))return a}
return null}function yb(e,t,n=[]){if(!e||typeof e!="object")return null;let s=mm([e.window_title,e.workspace_name,e.chat_title,
e.session_title],n),a=[dm(e.workspace_path),dm(t?.file_access_scope),s,pm(e.window_title),pm(e.workspace_name),db(e.workspace_name,
e.workspace_path)?null:bb(e.workspace_name)].filter(Boolean);if(a.length>0){let d=a[0];return n.find(f=>_b(f.label,d.label))||
d}let i=[e.chat_title,e.session_title,e.title,e.display_title,e.window_title,e.workspace_name].map(d=>ae(d).toLowerCase()).
filter(Boolean),c=mm(i,n);return c||null}function kb(e){return It(e).replace(/!\[[^\]]*\]\((?:data:image\/[^)]+|\/uploads\/[^)]+|[^)]*\.(?:png|jpe?g|gif|webp|bmp|svg))\)/gi,
" ").replace(/\[File:\s*[^\]]+\]/gi," ").replace(fb," ").replace(mb," ").replace(/<goal_context>[\s\S]*?<\/goal_context>/gi,
" ").replace(/<[^>\n]{1,80}>/g," ").replace(/```[\s\S]*?```/g," ").replace(/`([^`]+)`/g,"$1").replace(/^\s*(?:user|assistant|codex|claude|tool result)\s*[:\-]\s*/i,
"").replace(/\s+/g," ").trim()}function xo(e,t,n,s=[]){return xd(e,e&&typeof e=="object"?e.custom_display_name:"",s)}function fm(e){
if(!e||typeof e!="object")return null;if(e.workspace_path)return ae(e.workspace_path).toLowerCase();let t=ae(e.workspace_name||
e.window_title||"");return t&&t.split(" / ")[0].trim().toLowerCase()||null}function wb(e,t){let n=Ee(t),s=fm(t);return s&&
(e||[]).find(a=>a&&typeof a=="object"&&a.agent_type==="antigravity_panel"&&Ee(a)!==n&&fm(a)===s)||null}function Nb(e){return!e||
typeof e!="object"?"":[e.panel_title||null,e.panel_model||null,e.panel_mode||null].filter(Boolean).join(" \xB7 ")}function Sb(e){return e==="claude"?"claude-document":e==="codex_cli"?"codex-terminal":e==="cursor"?"cursor-cards":e==="c\
odex-desktop"||e==="codex"?"codex-thread":"unified-flow"}function gm(e){return e==="codex_cli"?"codex-cli":e==="codex"||
e==="codex-desktop"?"codex":e==="claude"||e==="claude_cli"?"claude":e==="cursor"||e==="cursor_cli"?"cursor":"default"}function Cb(e,t){
let n=ae(e).toLowerCase().replace(/\s+/g," ").trim(),s=ae(t).toLowerCase().replace(/\s+/g," ").trim();if(!s)return 0;let a=n.
indexOf(s);if(a>=0)return 2e3-Math.min(a,500)-Math.max(0,n.length-s.length)*.01;let i=0,c=0,d=-1;for(let f of s){if(f===
" ")continue;let h=n.indexOf(f,c);if(h<0)return Number.NEGATIVE_INFINITY;i+=d<0?Math.max(0,80-h):Math.max(1,24-(h-d-1)*3),
(h===0||/[\s/\\_.:-]/.test(n[h-1]))&&(i+=35),d=h,c=h+1}return i}function xb(e,t){let n=ae(t).toLowerCase().trim().split(
/\s+/).filter(Boolean);return n.length===0?[...e]:e.map((s,a)=>{let i=n.reduce((c,d)=>{let f=Array.isArray(s.searchFields)&&
s.searchFields.length?s.searchFields:[s.searchText],h=Math.max(...f.map(b=>Cb(b,d)));return Number.isFinite(c)&&Number.isFinite(
h)?c+h:Number.NEGATIVE_INFINITY},0);return{item:s,sidebarIndex:a,score:i}}).filter(s=>Number.isFinite(s.score)).sort((s,a)=>+!!a.
item.working-+!!s.item.working||a.score-s.score||s.sidebarIndex-a.sidebarIndex).map(s=>s.item)}function Fl(e){return e instanceof
Element?!!e.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]'):!1}function Ab(e,t){if(!e||!t||
e.sessionId!==t.sessionId)return 0;let n=Math.max(0,Number(t.messageCount||0)-Number(e.messageCount||0)),s=!!t.provisionalId&&
(t.provisionalId!==e.provisionalId||Number(t.provisionalLength||0)>Number(e.provisionalLength||0));return n+(s&&n===0?1:
0)}function Rb(e,t,n=!1){let[s,a]=React.useState(()=>ko(e,t)),i=React.useMemo(()=>qp(s,e,{...t,freezeStructure:n}),[s,e,
t,n]);React.useEffect(()=>{i.ledger!==s&&a(i.ledger)},[s,i]);let c=React.useCallback(()=>{a(d=>Pp(d,e,t))},[e,t]);return{
groups:i.groups,orderChanged:i.orderChanged,sortNow:c,revision:i.ledger.revision}}function hm(e){return!e||typeof e!="ob\
ject"?"":e.visible_pane_visible?[e.visible_pane_title||null,e.visible_pane_location==="right"?"Right Pane":null].filter(
Boolean).join(" \xB7 "):Nb(e)}function Hm(e){let t=ae(e);return t?t.replace(/^Gemini\s+/i,"G ").replace(/^Claude\s+/i,"").
replace(/\s*\(Thinking\)\s*/i,"").replace(/\s*\(Medium\)\s*/i,"").replace(/\s+/g," ").trim():""}function Um(e,t=3){return!Array.
isArray(e)||e.length===0?"":e.slice(0,t).map(n=>{let s=n?.percent_used;if(s==null)return null;let a=Hm(n?.model);return a?
`${a} ${s}%`:null}).filter(Boolean).join(" \xB7 ")}function ql(e){return e?Ln[e]?.name||e:""}function Ro(e){let t=ae(e).
trim();if(!t)return"";if(!/^\d{4}-\d{2}-\d{2}T/.test(t))return t;let n=new Date(t);return Number.isNaN(n.getTime())?t:n.
toLocaleString([],{weekday:"short",hour:"numeric",minute:"2-digit"})}function Mb({session:e,config:t,providerUsage:n,onOpenUsage:s}){
let[a,i]=React.useState(!1),[c,d]=React.useState(Date.now()),f=React.useRef(null),h=React.useRef(null),b=React.useMemo(()=>fl(
n),[n]),N=React.useMemo(()=>Kp(e,t,b,c),[e,t,b,c]),x=N.headerWindows.map(Rl);if(React.useEffect(()=>{if(!a)return;d(Date.
now());let g=setInterval(()=>d(Date.now()),3e4);return()=>clearInterval(g)},[a]),React.useEffect(()=>{if(!a)return;let g=(E=!1)=>{
i(!1),E&&requestAnimationFrame(()=>f.current?.focus({preventScroll:!0}))},w=E=>{f.current?.contains(E.target)||h.current?.
contains(E.target)||g(!1)},y=E=>{E.key==="Escape"&&(E.preventDefault(),g(!0))};return document.addEventListener("pointer\
down",w),document.addEventListener("keydown",y),requestAnimationFrame(()=>h.current?.querySelector("button")?.focus({preventScroll:!0})),
()=>{document.removeEventListener("pointerdown",w),document.removeEventListener("keydown",y)}},[a]),!N.supported)return null;
let S=N.state==="local"?"Local":N.state==="exhausted"?"Limit":x[0]?.compactValue||"Usage ?",R=hl(N.credits),u=_l(N.financials),
v=()=>{i(!1),s()};return React.createElement("div",{className:`session-usage-mini tone-${N.tone} state-${N.state}`,"data\
-testid":"session-usage-mini"},React.createElement("button",{ref:f,type:"button",className:"session-usage-mini-trigger",
"aria-expanded":a,"aria-controls":"session-usage-popover",title:`${N.billingProviderName}: ${S}`,onClick:()=>i(g=>!g)},React.
createElement(Bi,{providerId:N.providerMarkId,providerName:N.billingProviderName}),React.createElement("span",{className:"\
session-usage-mini-rows"},N.state==="local"?React.createElement("span",{className:"session-usage-mini-row"},React.createElement(
"strong",null,"Local"),React.createElement("em",null,"no plan limit")):x.length>0?x.map((g,w)=>React.createElement("span",
{className:`session-usage-mini-row ${g.tone}`,key:`${g.label}:${w}`},React.createElement("strong",null,g.label),React.createElement(
"em",null,g.compactValue),React.createElement("i",{"aria-hidden":"true"},React.createElement("b",{style:{width:`${Math.max(
0,Math.min(100,Number(g.usedPercent)||0))}%`}})))):React.createElement("span",{className:"session-usage-mini-row unavail\
able"},React.createElement("strong",null,"Usage"),React.createElement("em",null,N.state==="ambiguous"?"ambiguous":"unava\
ilable"))),React.createElement("span",{className:"session-usage-mini-compact"},S)),a&&React.createElement("div",{ref:h,id:"\
session-usage-popover",className:"session-usage-popover",role:"dialog","aria-modal":"false","aria-label":"Session usage \
details"},React.createElement("div",{className:"session-usage-popover-heading"},React.createElement(Bi,{providerId:N.providerMarkId,
providerName:N.billingProviderName}),React.createElement("span",null,React.createElement("strong",null,N.billingProviderName),
React.createElement("small",null,N.plan||N.message||"Usage details")),React.createElement("button",{type:"button",onClick:()=>{
i(!1),f.current?.focus({preventScroll:!0})},"aria-label":"Close usage details"},"\xD7")),React.createElement("dl",{className:"\
session-usage-popover-meta"},React.createElement("div",null,React.createElement("dt",null,"Billing provider"),React.createElement(
"dd",null,N.billingProviderName)),React.createElement("div",null,React.createElement("dt",null,"Model vendor"),React.createElement(
"dd",null,N.modelVendor)),React.createElement("div",null,React.createElement("dt",null,"Current model"),React.createElement(
"dd",null,N.modelLabel||N.modelId||"Not reported")),React.createElement("div",null,React.createElement("dt",null,"Accoun\
t"),React.createElement("dd",null,N.accountLabel||(N.state==="ambiguous"?"Ambiguous":"Unavailable"))),React.createElement(
"div",null,React.createElement("dt",null,"Quota domain"),React.createElement("dd",null,N.quotaDomain||"Unavailable")),React.
createElement("div",null,React.createElement("dt",null,"Mapping"),React.createElement("dd",null,N.mappingConfidence.replace(
/_/g," ")))),N.state==="local"?React.createElement("div",{className:"session-usage-popover-state local"},React.createElement(
"strong",null,"Local \xB7 no plan limit"),React.createElement("span",null,N.localRuntime?.loadedModelsCount??0," loaded \
model(s)")):N.applicableWindows.length>0?React.createElement("div",{className:"session-usage-popover-windows"},N.applicableWindows.
map((g,w)=>{let y=Rl(g);return React.createElement("div",{className:`session-usage-popover-window ${y.tone}`,key:`${g.id}\
:${w}`},React.createElement("span",null,React.createElement("strong",null,y.label),React.createElement("em",null,y.usedPercent==
null?"Usage unavailable":`${Jt(y.usedPercent)} used \xB7 ${y.compactValue}`)),React.createElement("i",{"aria-hidden":"tr\
ue"},React.createElement("b",{style:{width:`${Math.max(0,Math.min(100,Number(y.usedPercent)||0))}%`}})),React.createElement(
"small",null,y.reset?`Resets ${Sa(y.reset,c)}`:"Reset not reported",g.modelScope?.label?` \xB7 ${g.modelScope.label}`:""))})):
React.createElement("div",{className:`session-usage-popover-state ${N.state}`},React.createElement("strong",null,N.message),
React.createElement("span",null,"No percentage or $0 value is inferred.")),(R||u.length>0)&&React.createElement("div",{className:"\
session-usage-popover-financial"},React.createElement("strong",null,"Credits / overage"),R&&React.createElement("span",null,
R),u.map(g=>React.createElement("span",{key:g.id},g.label,": ",g.value))),React.createElement("div",{className:"session-\
usage-popover-source"},React.createElement("span",null,N.source||"Source unavailable"," \xB7 ",Na(N.capturedAt,c)),React.
createElement("span",null,"Generation ",N.generation," \xB7 ",N.freshness)),React.createElement("button",{type:"button",
className:"session-usage-open-dashboard",onClick:v},"Open Usage & limits")))}function Gm(e){return!e||typeof e!="object"?
"":ae(e.host_label||(e.host_type==="vscode"?"VS Code":e.host_type==="antigravity_ide"?"Antigravity IDE":""))}var Tb={healthy:"\
#3fb950",degraded:"#d29922",disconnected:"#f85149"},_m={thinking:{icon:"\u25CC",tone:"thinking"},generating:{icon:"\u2726",
tone:"thinking"},reading_files:{icon:"\u229E",tone:"info"},running_command:{icon:">",tone:"info"},applying_patch:{icon:"\
\u0394",tone:"info"},waiting_for_user:{icon:"?",tone:"idle"},idle:{icon:"\xB7",tone:"idle"},working:{icon:"\u2022",tone:"\
info"}};function Ao({agentType:e,compact:t=!1,animate:n=!0}){let s=String(e||"default").toLowerCase(),a=n?"":" static";return s===
"claude"||s==="claude_cli"?React.createElement("span",{className:`native-activity-spinner claude${t?" compact":""}${a}`},
n?React.createElement(Wb,null):React.createElement("span",{className:"claude-spinner-icon"},Xi[0])):s==="codex"||s==="co\
dex-desktop"||s==="codex_cli"?React.createElement("span",{className:`native-activity-spinner codex${t?" compact":""}${a}`,
"aria-label":"Working"},"\u25CC"):s==="cursor"?React.createElement("span",{className:`native-activity-spinner cursor${t?
" compact":""}${a}`,"aria-label":"Generating"},React.createElement("i",null),React.createElement("i",null),React.createElement(
"i",null)):React.createElement("span",{className:`native-activity-spinner generic${t?" compact":""}${a}`},React.createElement(
"i",null))}function $b({msg:e,deliveryStates:t,onSteer:n,onRetry:s}){if(e._optimistic){let a=t[e._cid]||"queued";if(a===
"offline_queued")return React.createElement("span",{className:"delivery offline-queued",title:"Queued until relay reconn\
ects","aria-label":"Queued offline"},"offline");if(a==="queued")return React.createElement("span",{className:"delivery q\
ueued",title:"Sending\u2026","aria-label":"Sending to relay"},"\xB7\xB7\xB7");if(a==="busy_queued")return React.createElement(
"span",{className:"delivery busy-queued",title:"Agent is busy \u2014 message queued","aria-label":"Queued while agent is\
 busy"},React.createElement("span",{className:"queued-label"},"queued"),n&&React.createElement("button",{className:"stee\
r-btn",onClick:i=>{i.stopPropagation(),n(e._cid,e.content)},title:"Inject into agent's context now"},"Steer \u25B8"));if(a===
"steered")return React.createElement("span",{className:"delivery steered",title:"Injected into agent context","aria-labe\
l":"Steered into agent context"},"\u2933");if(a==="accepted")return React.createElement("span",{className:"delivery acce\
pted",title:"Received by relay","aria-label":"Relay accepted; native receipt pending"},"\u2713");if(a==="launch_accepted")
return React.createElement("span",{className:"delivery launch-accepted",title:"Native launch accepted; user-turn receipt\
 pending","aria-label":"Native launch accepted; user-turn receipt pending"},"\u2197");if(a==="delivered")return React.createElement(
"span",{className:"delivery delivered",title:"Native user turn observed","aria-label":"Native user turn delivered"},"\u2713\u2713");
if(a==="agent_started")return React.createElement("span",{className:"delivery agent-started",title:"Agent started workin\
g","aria-label":"Agent started working"},"\u25B6");if(a==="failed")return React.createElement("span",{className:"deliver\
y failed",title:e._sendError||"Failed \u2014 agent may be offline","aria-label":`Send failed: ${e._sendError||"agent may\
 be offline"}`},React.createElement("span",{"aria-hidden":"true"},"\u2715"),s&&React.createElement("button",{type:"butto\
n",className:"delivery-retry",onClick:i=>{i.stopPropagation(),s(e)}},"Retry"))}return e._agentStarted||e.status==="agent\
_started"?React.createElement("span",{className:"delivery agent-started",title:"Agent started working","aria-label":"Age\
nt started working"},"\u25B6"):e._delivered||e.status==="delivered"?React.createElement("span",{className:"delivery deli\
vered",title:"Native user turn observed","aria-label":"Native user turn delivered"},"\u2713\u2713"):e.status==="failed"?
React.createElement("span",{className:"delivery failed",title:e.failure_code||"Send failed","aria-label":`Send failed: ${e.
failure_code||"unknown failure"}`},"\u2715"):e._launchAcceptedAt||e.launch_accepted_at?React.createElement("span",{className:"\
delivery launch-accepted",title:"Native launch accepted; user-turn receipt pending","aria-label":"Native launch accepted\
; user-turn receipt pending"},"\u2197"):e.status==="accepted"?React.createElement("span",{className:"delivery accepted",
title:"Received by relay; native receipt pending","aria-label":"Relay accepted; native receipt pending"},"\u2713"):React.
createElement("span",{className:"delivery recorded",title:"Recorded \u2014 native delivery receipt unknown","aria-label":"\
Recorded; native delivery receipt unknown"},"Recorded")}function Eb(e,t=!1){let[n,s]=React.useState(()=>wl(e)),a=React.useMemo(
()=>Tp(n,e,{freezeStructure:t}),[n,e,t]);return React.useEffect(()=>{a.ledger!==n&&s(a.ledger)},[n,a]),{sessions:a.sessions,
revision:a.ledger.revision,deferred:a.deferred}}function Lb(e,t){let[n,s]=React.useState(Date.now());return React.useEffect(
()=>{let a=Date.now(),c=[...Object.values(e||{}),...Array.isArray(t)?t.map(f=>f?.activity):[]].reduce((f,h)=>{let b=Ni(h),
N=b?b+nl:0;return N<=a?f:f===0?N:Math.min(f,N)},0);if(!c)return;let d=setTimeout(()=>s(Date.now()),Math.max(25,c-a+25));
return()=>clearTimeout(d)},[e,t,n]),n}function qb({stream:e,activeAgent:t,monospace:n}){let s=Ae(null),a=Ae("");return Ma(
()=>{let i=s.current;if(!i)return;let c=String(e?.content||""),d=a.current;if(c.startsWith(d)){let f=c.slice(d.length);f&&
i.appendChild(document.createTextNode(f))}else i.textContent=c;a.current=c},[e?.content]),React.createElement("div",{className:`\
message assistant live-draft provisional-stream${n?" monospace":""}`,"data-message-id":e?.messageId||"awaiting-first-del\
ta","data-message-role":"assistant","data-message-timestamp":Qn(e?.startedAtMs)?.iso||void 0,"data-stream-open":e?.open?
"true":"false"},React.createElement("div",{className:"assistant-gutter"},React.createElement("div",{className:"agent-bad\
ge transcript-agent-badge",style:{color:t.color,borderColor:t.color+"55",background:t.color+"18"}},t.logo?React.createElement(
"img",{src:t.logo,alt:t.abbr,className:"agent-badge-logo"}):t.abbr)),React.createElement("div",{className:"assistant-con\
tent"},React.createElement("div",{className:"message-role"},React.createElement("span",{className:"message-role-label"},
t.name),React.createElement(Qi,{instant:e?.startedAtMs})),React.createElement("div",{className:"provisional-stream-text",
ref:s}),e?.open&&React.createElement("span",{className:"provisional-stream-caret","aria-label":"Streaming response"})))}
function Pb({msg:e,messageKey:t,activeAgent:n,assistantMonospace:s,autoExpandLongCodeBlocks:a,onOpenPath:i,agentType:c,preview:d,
fileContents:f,onClosePreview:h,deliveryState:b,onSteer:N,onRetry:x,richContentEager:S,searchMatch:R=!1}){let u=It(e.content)||
Mo(e.content_blocks),v=tb(e.content),g=kr(e),w=e.role!=="user"&&Er(e.content_blocks).length>0,y=e.source_message_id||e.native_source_id||
"",E=Z_(e),T=eb(e);if(e.role==="user"){let H=e._cid?{[e._cid]:b}:{};return React.createElement("div",{className:`message\
 user transcript-virtual-row${e._optimistic&&b==="failed"?" failed":""}${R?" search-match":""}`,"data-message-key":t,"da\
ta-message-id":e.id||void 0,"data-message-role":"user","data-message-block-type":T,"data-message-content-hash":E,"data-m\
essage-source-id":y||void 0,"data-message-timestamp":g?.iso||"unknown"},React.createElement("div",{className:"user-gutte\
r"},React.createElement("div",{className:"user-glyph"})),React.createElement("div",{className:"user-content"},React.createElement(
"div",{className:"message-role"},React.createElement("span",{className:"message-role-label"},"You"),React.createElement(
Qi,{message:e}),React.createElement($b,{msg:e,deliveryStates:H,onSteer:N,onRetry:x})),/!\[[^\]]*\]\((?:data:|\/uploads\/)/.
test(v)?React.createElement("div",{className:"user-text"},React.createElement(yr,{content:v,deferUntilVisible:!S,cacheIdentity:`${t}\
:user`})):React.createElement("div",{className:"user-text"},u)))}return React.createElement("div",{className:`message as\
sistant transcript-virtual-row${s?" monospace":""}${R?" search-match":""}`,"data-message-key":t,"data-message-id":e.id||
void 0,"data-message-role":"assistant","data-message-block-type":T,"data-message-content-hash":E,"data-message-source-id":y||
void 0,"data-message-timestamp":g?.iso||"unknown"},React.createElement("div",{className:"assistant-gutter"},React.createElement(
"div",{className:"agent-badge transcript-agent-badge",style:{color:n.color,borderColor:n.color+"55",background:n.color+"\
18"}},n.logo?React.createElement("img",{src:n.logo,alt:n.abbr,className:"agent-badge-logo"}):n.abbr)),React.createElement(
"div",{className:"assistant-content"},React.createElement("div",{className:"message-role"},React.createElement("span",{className:"\
message-role-label"},n.name),React.createElement(Qi,{message:e})),w?React.createElement(ib,{blocks:e.content_blocks,monospace:s,
autoExpandLongCodeBlocks:a,onOpenPath:H=>i(t,H),agentType:c,richContentEager:S,richContentCacheIdentity:t}):React.createElement(
yr,{content:It(e.content),monospace:s,autoExpandLongCodeBlocks:a,onOpenPath:H=>i(t,H),deferUntilVisible:!S,cacheIdentity:`${t}\
:assistant`}),d&&React.createElement(wv,{sessionId:d.sessionId,filePath:d.path,fileContents:f,onClose:h})))}function bm(e){
return e?`${e.sessionId}${e.messageKey}${e.path}`:""}function Hl(e){return[e?.name,e?.color,e?.abbr,e?.logo||""].join(
"")}function Ib(e,t){return e.msg===t.msg&&e.messageKey===t.messageKey&&e.assistantMonospace===t.assistantMonospace&&e.
autoExpandLongCodeBlocks===t.autoExpandLongCodeBlocks&&e.agentType===t.agentType&&Hl(e.activeAgent)===Hl(t.activeAgent)&&
bm(e.preview)===bm(t.preview)&&e.fileContents===t.fileContents&&e.deliveryState===t.deliveryState&&e.onRetry===t.onRetry&&
e.richContentEager===t.richContentEager&&e.searchMatch===t.searchMatch}var Ob=React.memo(Pb,Ib),Db=100,Wi=1200,ks=32;function vm(e){
let t=It(e?.content)||Mo(e?.content_blocks),n=Math.max(1,ae(t).split(`
`).length);if(e?.role==="user")return Math.min(180,40+Math.max(0,n-1)*18);let s=Math.ceil(ae(t).length/100),a=Er(e?.content_blocks).
length*28;return Math.min(420,68+Math.max(n,s)*18+a)}function Pl(e,t){let n=0,s=Math.max(0,e.length-1);for(;n<s;){let a=Math.
floor((n+s)/2);e[a]<=t?n=a+1:s=a}return Math.max(0,n-1)}function jb({index:e,messageKey:t,onMeasure:n,children:s}){let a=React.
useRef(null);return React.useLayoutEffect(()=>{let i=a.current;if(!i)return;let c=()=>n(e,t,i.getBoundingClientRect().height);
if(c(),typeof ResizeObserver>"u")return;let d=new ResizeObserver(c);return d.observe(i),()=>d.disconnect()},[e,t,n]),React.
createElement("div",{className:"transcript-window-row","data-window-index":e,ref:a},s)}function Bb({messages:e,containerRef:t,
sessionId:n,routeActive:s}){let a=s&&e.length>Db,i=React.useRef(a);i.current=a;let c=React.useRef(new Map),d=React.useRef(
n);d.current!==n&&(c.current.clear(),d.current=n);let f=React.useRef([0]),h=React.useRef(null),b=React.useRef(null),N=React.
useRef(0),x=React.useRef(0),S=React.useRef({sessionId:null,keys:[],prefix:[0]}),R=React.useRef(0),u=React.useRef(0),v=React.
useRef(null),g=React.useRef(null),w=React.useRef(0),y=React.useRef(0),[E,T]=React.useState(0),[H,K]=React.useState({sessionId:null,
start:0,end:0}),te=React.useMemo(()=>e.map((U,V)=>`${n||""}${Kl(U,V)}`),[e,n]),ne=React.useMemo(()=>{let U=new Array(e.
length+1);U[0]=0;for(let V=0;V<e.length;V+=1){let ie=c.current.get(te[V]);U[V+1]=U[V]+(ie||vm(e[V]))}return U},[e,te,E]);
f.current=ne;let oe=React.useCallback(()=>{if(b.current)return;let U=t.current;if(!a||!U)return;let V=U.getBoundingClientRect(),
ie=V.top,I=Array.from(U.querySelectorAll(".transcript-window-row[data-window-index]")),W=I.find($=>{let z=$.getBoundingClientRect();
return z.top>=ie&&z.top<V.bottom})||I.find($=>$.getBoundingClientRect().bottom>ie)||I[0];if(!W)return;let re=Number(W.dataset.
windowIndex);!Number.isInteger(re)||!te[re]||(h.current={sessionId:n,key:te[re],viewportOffset:W.getBoundingClientRect().
top-ie})},[t,a,te,n]),G=React.useCallback(()=>{v.current=null,g.current=null,w.current&&clearTimeout(w.current),w.current=
0},[]),de=React.useCallback(()=>{let U=t.current;if(!a||!U)return;let V=b.current;if(V?.sessionId===n){let Te=te.indexOf(
V.key);if(Te>=0){K(Le=>Le.sessionId===n&&Le.start===Te&&Le.end===Math.min(e.length,Te+ks)?Le:{sessionId:n,start:Te,end:Math.
min(e.length,Te+ks)});return}}oe();let ie=f.current,I=Math.max(0,U.scrollTop-Wi),W=U.scrollTop+U.clientHeight+Wi,re=Math.
max(0,Pl(ie,I)-1),$=Math.min(e.length,Pl(ie,W)+2),z=$>=e.length?Math.max(0,e.length-ks):re,fe=$,we=g.current,ye=we?te.indexOf(
we):v.current;ye>=0&&(v.current=ye);let Ce=ye;Number.isInteger(Ce)&&Ce>=0&&Ce<e.length&&(z=Math.min(z,Math.max(0,Ce-ks)),
fe=Math.max(fe,Math.min(e.length,Ce+ks+1))),React.startTransition(()=>{K(Te=>Te.sessionId===n&&Te.start===z&&Te.end===fe?
Te:{sessionId:n,start:z,end:fe})})},[oe,t,a,te,e.length,n]);React.useLayoutEffect(()=>{let U=S.current;if(S.current={sessionId:n,
keys:te,prefix:ne},!a||U.sessionId!==n||!U.keys.length){b.current?.routeRestore||(b.current=null),N.current&&clearTimeout(
N.current),N.current=0,oe();return}let V=h.current;if(!V||V.sessionId!==n||!V.key)return;let ie=U.keys.indexOf(V.key),I=te.
indexOf(V.key);if(ie<0||I<0||ie===I)return;let W=t.current;if(!W)return;let re=U.prefix[ie]||0,$=ne[I]||0;b.current={sessionId:n,
key:V.key,viewportOffset:V.viewportOffset},v.current=I,g.current=V.key,N.current&&clearTimeout(N.current),N.current=setTimeout(
()=>{b.current=null,N.current=0,G(),oe()},1500),K({sessionId:n,start:I,end:Math.min(e.length,I+ks)}),hn(W,Math.max(0,W.scrollTop+
$-re))},[oe,t,a,te,e.length,ne,G,n]),React.useLayoutEffect(()=>{let U=b.current;if(!U||U.sessionId!==n)return;let V=te.indexOf(
U.key);if(V<H.start||V>=H.end)return;let ie=t.current,I=ie?.querySelector(`.transcript-window-row[data-window-index="${V}\
"]`);if(!ie||!I)return;if(U.atBottom){hn(ie,ie.scrollHeight),h.current=U;return}let re=I.getBoundingClientRect().top-ie.
getBoundingClientRect().top-U.viewportOffset;Math.abs(re)>=.5&&hn(ie,Math.max(0,ie.scrollTop+re)),h.current=U},[t,a,te,ne,
H,n]),React.useLayoutEffect(()=>{let U=b.current;if(!a||!U?.routeRestore)return;let V=!0,ie=()=>{if(!V)return;let I=b.current,
W=t.current;if(!I?.routeRestore||I.sessionId!==n||!W)return;let re=te.indexOf(I.key),$=re>=0?W.querySelector(`.transcrip\
t-window-row[data-window-index="${re}"]`):null;if($)if(I.atBottom)hn(W,W.scrollHeight);else{let fe=$.getBoundingClientRect().
top-W.getBoundingClientRect().top-I.viewportOffset;Math.abs(fe)>=.5&&hn(W,Math.max(0,W.scrollTop+fe))}x.current=requestAnimationFrame(
ie)};return ie(),N.current&&clearTimeout(N.current),N.current=setTimeout(()=>{b.current=null,N.current=0,x.current&&cancelAnimationFrame(
x.current),x.current=0,G(),oe()},1500),()=>{V=!1,x.current&&cancelAnimationFrame(x.current),x.current=0}},[oe,t,a,te,G,n]),
React.useLayoutEffect(()=>{if(!a){G();return}let U=t.current;if(!U)return;de();let V=()=>{oe();let ie=g.current,I=ie?te.
indexOf(ie):v.current;I>=0&&(v.current=I);let W=I,re=f.current;if(Number.isInteger(W)&&W>=0&&W<e.length){let $=re[W]||0,
z=re[W+1]||$,fe=U.scrollTop,we=fe+U.clientHeight;(z<fe-Wi||$>we+Wi)&&G()}u.current||(u.current=requestAnimationFrame(()=>{
u.current=0,de()}))};return U.addEventListener("scroll",V,{passive:!0}),()=>{U.removeEventListener("scroll",V),u.current&&
cancelAnimationFrame(u.current),u.current=0}},[oe,a,s,n,te,e.length,de,G]),React.useLayoutEffect(()=>{a&&de()},[a,ne,de]);
let Ne=React.useCallback((U,V,ie)=>{if(!i.current)return;let I=Math.max(1,Math.ceil(ie)),W=c.current.get(V)||vm(e[U]);if(Math.
abs(I-W)<1)return;c.current.set(V,I);let re=t.current,$=re?Pl(f.current,re.scrollTop):0;U<$&&(y.current+=I-W),!R.current&&
(R.current=requestAnimationFrame(()=>{if(R.current=0,!i.current){y.current=0;return}let z=t.current,fe=y.current;y.current=
0,z&&Math.abs(fe)>=1&&hn(z,Math.max(0,z.scrollTop+fe)),T(we=>we+1)}))},[t,e]);React.useLayoutEffect(()=>{a||!R.current||
(cancelAnimationFrame(R.current),R.current=0,y.current=0)},[a]),React.useEffect(()=>()=>{R.current&&cancelAnimationFrame(
R.current),u.current&&cancelAnimationFrame(u.current),w.current&&clearTimeout(w.current),N.current&&clearTimeout(N.current),
x.current&&cancelAnimationFrame(x.current)},[]);let J=React.useCallback((U,V="center")=>{let ie=t.current,I=f.current;if(!ie||
U<0||U>=e.length)return!1;v.current=U,g.current=te[U]||null,w.current&&clearTimeout(w.current),w.current=setTimeout(()=>{
G()},1500);let W=I[U]||0,re=I[U+1]||W,$=V==="start"?W:V==="end"?re-ie.clientHeight:W-Math.max(0,(ie.clientHeight-(re-W))/
2);hn(ie,Math.max(0,$));let z=Math.max(0,U-ks),fe=Math.min(e.length,U+ks+1);return K({sessionId:n,start:z,end:fe}),!0},[
t,te,e.length,G,n]),ve=React.useCallback(()=>{oe();let U=h.current;if(!U||U.sessionId!==n)return!1;let V=te.indexOf(U.key);
return V<0?!1:(v.current=V,g.current=U.key,!0)},[oe,te,n]),ge=React.useCallback(()=>{let U=t.current;if(!a||!U)return!1;
oe();let V=h.current;if(!V||V.sessionId!==n||!V.key)return!1;let ie=te.indexOf(V.key);return ie<0?!1:(b.current={...V,routeRestore:!0,
atBottom:U.scrollHeight-U.scrollTop-U.clientHeight<80},v.current=ie,g.current=V.key,!0)},[oe,t,a,te,n]),Z=React.useCallback(
()=>b.current?.routeRestore?(b.current=null,N.current&&clearTimeout(N.current),N.current=0,x.current&&cancelAnimationFrame(
x.current),x.current=0,G(),oe(),!0):!1,[oe,G]),he=0,Q=e.length;return a&&(H.sessionId===n&&H.end>H.start?(he=H.start,Q=H.
end):he=Math.max(0,e.length-ks)),{enabled:a,start:he,end:Q,totalHeight:ne[ne.length-1]||0,topSpacerHeight:a&&ne[he]||0,bottomSpacerHeight:a?
ne[ne.length-1]-(ne[Q]||0):0,onMeasure:Ne,scrollToIndex:J,prepareForPrepend:ve,prepareForRouteChange:ge,cancelRouteRestore:Z}}
function Fb({qm:e,onSteer:t,onDiscard:n,onEdit:s}){let[a,i]=React.useState(!1),[c,d]=React.useState(!1),[f,h]=React.useState(
e.content),b=React.useRef(null);return React.useEffect(()=>{if(!a)return;let N=x=>{b.current&&!b.current.contains(x.target)&&
i(!1)};return document.addEventListener("mousedown",N),()=>document.removeEventListener("mousedown",N)},[a]),c?React.createElement(
"div",{className:"queued-item editing"},React.createElement("textarea",{className:"queued-edit-input",value:f,onChange:N=>h(
N.target.value),onKeyDown:N=>{N.key==="Enter"&&!N.shiftKey&&(N.preventDefault(),s(f),d(!1)),N.key==="Escape"&&d(!1)},rows:2,
autoFocus:!0}),React.createElement("button",{className:"steer-btn",onClick:()=>{s(f),d(!1)}},"Save"),React.createElement(
"button",{className:"queued-trash-btn",onClick:()=>d(!1),title:"Cancel"},"\u2715")):e.native?React.createElement("div",{
className:"queued-item native"},React.createElement("span",{className:"queued-item-text"},e.content),e.status&&e.status!==
"queued"&&React.createElement("span",{className:`queued-item-status ${e.status}`},e.status),React.createElement("div",{className:"\
queued-actions"},React.createElement("button",{className:"steer-btn",onClick:t,title:"Click Steer in Codex"},"Steer \u25B8"),
React.createElement("button",{className:"queued-trash-btn",onClick:n,title:"Delete queued message"},"\u{1F5D1}"))):React.
createElement("div",{className:"queued-item"},React.createElement("span",{className:"queued-item-text"},e.content),React.
createElement("div",{className:"queued-actions"},React.createElement("button",{className:"steer-btn",onClick:t,title:"Se\
nd to agent now"},"Steer \u25B8"),React.createElement("button",{className:"queued-trash-btn",onClick:n,title:"Discard me\
ssage"},"\u{1F5D1}"),React.createElement("div",{className:"queued-menu-wrap",ref:b},React.createElement("button",{className:"\
queued-more-btn",onClick:()=>i(!a),title:"More options"},"\xB7\xB7\xB7"),a&&React.createElement("div",{className:"queued\
-dropdown"},React.createElement("button",{onClick:()=>{i(!1),h(e.content),d(!0)}},"\u270F Edit message"),React.createElement(
"button",{onClick:()=>{i(!1),n()}},"\u{1F5D1} Discard")))))}function Hb({session:e,health:t,unread:n,isThinking:s,isActive:a,
agentConfig:i,activity:c,sessionMessages:d,hasBlockingPrompt:f,blockingPromptLabel:h,muted:b,pinned:N,workspaceLabel:x,recentMessageAt:S,
menuOpen:R,onMenuToggle:u,onSelect:v,onClose:g,onManage:w,onPinChange:y,onAutomations:E,showAutomationsActive:T,onSkills:H,
showSkillsActive:K}){let te=Ee(e),ne=$r(e,i),oe=Tr(e,te,i),G=xo(e,te,i,d),de=[G,oe||ne.name].filter(Boolean).join(" - "),
Ne=Tb[t]||"#444c56",J=e?.rate_limited_until||null,ve=e?.rate_limit_active===!0,ge=e?.percent_used,Z=e?.agent_type==="ant\
igravity"||e?.agent_type==="antigravity_panel",he=Z?Um(e?.antigravity_quota_models,3):"",Q=Ci(c,{health:t}),U=s?Q||c?.label||
"Working":null,V=Gm(e),ie=x?`${ne.name} / ${x}`:ne.name,I=S?Qn(S):null;return React.createElement("div",{className:`sess\
ion-card${a?" active":""}${ve?" rate-limited":""}${N?" pinned":""}`,"data-session-id":te,"data-last-message-at":I?.iso||
void 0,onClick:v,onKeyDown:W=>{W.target!==W.currentTarget||!["Enter"," "].includes(W.key)||(W.preventDefault(),v())},tabIndex:0,
"aria-label":`${G}. ${oe||ne.name}`,title:de||te},React.createElement("div",{className:"session-card-badge-wrap"},React.
createElement("div",{className:"agent-badge",style:{color:ne.color,borderColor:ne.color+"55",background:ne.color+"18"}},
ne.logo?React.createElement("img",{src:ne.logo,alt:ne.abbr,className:"agent-badge-logo"}):ne.abbr),React.createElement("\
div",{className:"session-card-health",style:{background:Ne},title:t||"unknown"}),b&&React.createElement("span",{className:"\
session-card-muted",title:"Notifications muted","aria-label":"Notifications muted"},"M"),N&&React.createElement("button",
{type:"button",className:"session-card-pin-toggle",title:`Unpin ${G}`,"aria-label":`Unpin ${G}`,"aria-pressed":"true",onClick:W=>{
W.preventDefault(),W.stopPropagation(),y?.(!1)}},React.createElement("span",{"aria-hidden":"true"},"\u{1F4CC}")),React.createElement(
"span",{className:"session-card-attention-slot"},f&&React.createElement("span",{className:"session-card-perm-badge",title:h||
"Action required"},"\u26A0"),!f&&ve&&React.createElement("span",{className:"session-card-perm-badge",title:"Usage limite\
d"},"\u23F3"),!f&&!ve&&s&&React.createElement("span",{className:"session-card-native-status",title:U||"Thinking\u2026"},
React.createElement(Ao,{agentType:e?.agent_type,compact:!0,animate:!1})),!s&&!f&&!ve&&n>0&&React.createElement("span",{className:"\
session-card-badge"},n>99?"99+":n))),React.createElement("div",{className:"session-card-body"},React.createElement(ji,{title:G,
disclosureKey:te,kind:"session",wrapperClassName:"session-title-details",triggerClassName:"session-card-name",disclosureClassName:"\
session-title-disclosure",triggerLabel:`Show full title: ${G}`,triggerTag:"div"}),React.createElement("div",{className:`\
session-card-sub${f?" perm-active":""}${I?" has-recent-message":""}`},React.createElement("span",{className:"session-car\
d-sub-context"},f?`${ie} \xB7 ${h||"Action required"}`:ve?`${ie} \xB7 \u23F3 Usage limited${J&&J!=="unknown"?` \xB7 resets ${Ro(
J)}`:" \xB7 reset unknown"}`:he?`${ie} \xB7 ${he}`:Z&&ge!=null?`${ie} \xB7 \u{1F4CA} ${ge}% used${J&&J!=="unknown"?` \xB7 ${J}`:
""}`:ge>=75?`${ie} \xB7 \u{1F4CA} ${ge}% used${J&&J!=="unknown"?` \xB7 resets ${Ro(J)}`:""}`:U?`${ie} \xB7 ${U}`:V?`${ie}\
 \xB7 ${V}`:ie),I&&React.createElement(React.Fragment,null,React.createElement("span",{"aria-hidden":"true"}," \xB7 "),React.
createElement("time",{dateTime:I.iso},Kc(I))))),React.createElement("div",{className:"session-card-right"},React.createElement(
"details",{className:"session-card-menu",open:R,onToggle:W=>u?.(W.currentTarget.open),onClick:W=>W.stopPropagation()},React.
createElement("summary",{className:"session-card-manage",title:"Session actions","aria-label":`Session actions for ${G}`},
"\u22EF"),React.createElement("div",{className:"session-card-menu-popover",role:"menu","aria-label":`Actions for ${G}`},
React.createElement("button",{role:"menuitem",onClick:()=>y?.(!N)},N?"Unpin chat":"Pin chat"),React.createElement("butto\
n",{role:"menuitem",onClick:()=>w&&w()},"Manage session"),E&&React.createElement("button",{role:"menuitem",className:T?"\
active":"",onClick:()=>E()},"Automations"),H&&React.createElement("button",{role:"menuitem",className:K?"active":"",onClick:()=>H()},
"Skills"),React.createElement("button",{role:"menuitem",className:"danger",onClick:()=>g&&g()},"Close session")))))}function ym(e){
let t=Array.isArray(e)?e:[];if(!t.length)return"0";let n=t[0],s=t[t.length-1];return[t.length,n?.role||"",ae(n?.content).
slice(0,120),s?.role||"",ae(s?.content).slice(0,120)].join("")}function km(e){return e?[e.model_id||"",e.effort||"",e.permission_mode||
"",e.file_access_scope||""].join(""):""}function wm(e){return e?[e.kind||"",e.label||"",e.goal?.status||"",e.goal?.label||
"",e.goal_run?.lifecycle||"",e.goal_run?.lease_active===!0?"leased":"released",e.goal_run?.transition_id||""].join(""):
""}function Ub(e,t){return e.session===t.session&&e.health===t.health&&e.unread===t.unread&&e.isThinking===t.isThinking&&
e.isActive===t.isActive&&e.hasBlockingPrompt===t.hasBlockingPrompt&&e.blockingPromptLabel===t.blockingPromptLabel&&e.muted===
t.muted&&e.pinned===t.pinned&&e.workspaceLabel===t.workspaceLabel&&e.recentMessageAt===t.recentMessageAt&&e.menuOpen===t.
menuOpen&&e.showAutomationsActive===t.showAutomationsActive&&e.showSkillsActive===t.showSkillsActive&&km(e.agentConfig)===
km(t.agentConfig)&&wm(e.activity)===wm(t.activity)&&ym(e.sessionMessages)===ym(t.sessionMessages)}var Gb=React.memo(Hb,Ub),
Nm=["\xB7","\u2722","*","\u2736","\u273B","\u273D"],Xi=[...Nm,...[...Nm].reverse()];function Wb(){let[e,t]=React.useState(
0),[n,s]=React.useState(()=>typeof window<"u"&&typeof window.matchMedia=="function"&&window.matchMedia("(prefers-reduced\
-motion: reduce)").matches);return React.useEffect(()=>{if(typeof window>"u"||typeof window.matchMedia!="function")return;
let a=window.matchMedia("(prefers-reduced-motion: reduce)"),i=c=>s(c.matches);return s(a.matches),a.addEventListener?.("\
change",i),()=>a.removeEventListener?.("change",i)},[]),React.useEffect(()=>{if(n){t(0);return}let a=Xi.length*3,i=setInterval(
()=>{if(a-=1,a<=0){clearInterval(i),t(0);return}t(c=>(c+1)%Xi.length)},120);return()=>clearInterval(i)},[n]),React.createElement(
"span",{className:"claude-spinner-icon"},Xi[e])}function Sm(e,t){let n=e?new Date(e).getTime():0;if(!Number.isFinite(n)||
n<=0)return"";let s=Math.max(0,Math.floor((t-n)/1e3));return Ql(s,{includeSeconds:!0})}function Ql(e,{includeSeconds:t=!1}={}){
if(e=Math.max(0,Math.floor(Number(e)||0)),e<60)return`${e}s`;let n=Math.floor(e/60),s=e%60;if(n<60)return t?`${n}m ${String(
s).padStart(2,"0")}s`:`${n}m`;let a=Math.floor(n/60),i=n%60;return a>=24?`${Math.floor(a/24)}d ${String(a%24).padStart(2,
"0")}h ${String(i).padStart(2,"0")}m${t?` ${String(s).padStart(2,"0")}s`:""}`:`${a}h ${String(i).padStart(2,"0")}m${t?` ${String(
s).padStart(2,"0")}s`:""}`}function Wm(e,t,n=null){return e?Ql(Gd(e,n,t),{includeSeconds:!0}):""}function zb({activity:e,
thinkingText:t,agentType:n,pinned:s=!1}){let a=e?.kind||"working",i=_m[a]||_m.working,c=e?.goal||null,d=i.tone==="thinki\
ng"||i.tone==="info",h=(c?.state||c?.status)==="active"&&(!e?.goal_run||e.goal_run.lease_active===!0),b=!!(e?.thinking||
e?.current),N=String(t||e?.thinkingContent||"").trim(),x=n==="claude"||n==="claude_cli",S=e?.thinking||(!b&&(a==="thinki\
ng"||x)?{text:N,since:e?.startedAt||e?.updatedAt||null}:null),R=e?.current||(!b&&!S&&d?{kind:a==="running_command"?"tool":
"answer",label:e?.label||(a==="running_command"?"Running command":"Working"),partial:N,since:e?.startedAt||e?.updatedAt||
null}:null),u=e?.step||null,v=e?.usage||null,[g,w]=React.useState(Date.now()),y=S?S.since||e?.startedAt||e?.updatedAt:null,
E=R?R.since||e?.startedAt||e?.updatedAt:null,T=de=>!!de&&Number.isFinite(new Date(de).getTime()),H=h&&T(c?.updated_at)||
T(y)||T(E);React.useEffect(()=>{if(!H)return;let de=setInterval(()=>w(Date.now()),1e3);return()=>clearInterval(de)},[H,c?.
updated_at,y,E]);let K=e?.interruptHint||e?.interrupt_hint||"",te=c?Wm(c,g,e?.goal_run):"",ne=String(c?.text||c?.objective||
"").trim(),oe=S?Sm(y,g):"",G=R?Sm(E,g):"";return!c&&!S&&!R&&!u&&!v?null:React.createElement("div",{className:`live-statu\
s-stack${s?" pinned":""}`,"data-testid":"live-status-stack"},R&&React.createElement("div",{className:`live-current-statu\
s ${R.kind||"answer"}`,"data-live-channel":"current"},React.createElement("div",{className:"live-current-tool-heading"},
R.kind==="tool"?React.createElement("span",{className:"live-status-icon"},"\u25B6"):React.createElement(Ao,{agentType:n,
compact:!0}),React.createElement("span",{className:"live-status-label"},R.label||(R.kind==="tool"?"Running tool":"Workin\
g")),React.createElement("span",{className:"live-status-meta"},[G,K].filter(Boolean).join(" \xB7 "))),R.partial&&(R.kind===
"tool"?React.createElement("pre",{className:"live-current-output"},R.partial):React.createElement("p",{className:"live-c\
urrent-narration"},R.partial))),S&&React.createElement("div",{className:"live-thinking-row","data-live-channel":"thinkin\
g"},React.createElement("div",{className:"live-thinking-heading"},React.createElement(Ao,{agentType:n}),React.createElement(
"span",{className:"live-status-label"},S.label||e?.label||"Thinking"),oe&&React.createElement("span",{className:"live-st\
atus-meta"},oe)),S.text&&React.createElement("div",{className:"live-thinking-text"},S.text)),u&&React.createElement("div",
{className:"live-step-wrap","data-live-channel":"step"},React.createElement("div",{className:"live-step-chip",title:u.text||
""},u.state==="in_progress"?React.createElement(Ao,{agentType:n,compact:!0}):React.createElement("span",null,"\u25CC"),React.
createElement("span",null,"Step ",u.current||1," / ",u.total||1),(u.added!=null||u.deleted!=null)&&React.createElement("\
span",{className:"live-step-diff"},"\xB7 +",u.added||0," \u2212",u.deleted||0))),c&&React.createElement("details",{className:"\
live-goal-row","data-live-channel":"goal"},React.createElement("summary",{title:ne},React.createElement("span",{className:"\
live-status-icon"},"\u26F3"),React.createElement("span",{className:"live-status-label"},c.label||"Pursuing goal"),React.
createElement("span",{className:"live-goal-objective"},ne||"Active goal"),React.createElement("span",{className:"live-st\
atus-meta"},te||c.state||c.status||"active")),ne&&React.createElement("div",{className:"live-goal-expanded"},ne)),v&&React.
createElement("div",{className:"live-usage-banner","data-live-channel":"usage",role:"status"},React.createElement("div",
{className:"live-usage-title"},v.title||"Usage limit reached"),React.createElement("div",{className:"live-usage-detail"},
v.detail||(v.resets_at?`Your rate limit resets at ${v.resets_at}.`:"Usage is currently exhausted."))))}function Vb({taskList:e,
sessionId:t}){let n=e?.content_blocks?.find(x=>x?.type==="plan"),s=n?{...e,...n}:e;if(!s||!s.tasks||s.tasks.length===0)return null;
let a=t?`remote-agent-chat:task-list-collapsed:${t}`:null,i=!1,[c,d]=React.useState(()=>{if(!a)return i;let x=localStorage.
getItem(a);return x==null?i:x==="1"});React.useEffect(()=>{if(!a){d(i);return}let x=localStorage.getItem(a);d(x==null?i:
x==="1")},[a,i]);let f=()=>{d(x=>{let S=!x;return a&&localStorage.setItem(a,S?"1":"0"),S})},h={completed:"\u2713",in_progress:"\
\u25CC",pending:"\u25CB"},b={completed:"done",in_progress:"active",pending:""},N=s.tasks.find(x=>x.state==="in_progress");
return React.createElement("div",{className:`codex-task-list${c?" collapsed":""}`},React.createElement("button",{type:"b\
utton",className:"codex-task-header",onClick:f,"aria-expanded":!c,title:c?"Expand task list":"Collapse task list"},React.
createElement("span",{className:"codex-task-chevron"},c?"\u25B8":"\u25BE"),React.createElement("span",{className:"codex-\
task-count"},s.completed,"/",s.total," tasks"),c&&N?.text&&React.createElement("span",{className:"codex-task-active-summ\
ary"},N.text)),!c&&React.createElement("div",{className:"codex-task-items"},s.tasks.map((x,S)=>React.createElement("div",
{key:S,className:`codex-task-item ${b[x.state]||""}`},React.createElement("span",{className:"codex-task-icon"},h[x.state]||
"\u25CB"),React.createElement("span",{className:"codex-task-text"},x.text)))))}function Kb({card:e,tone:t="cline"}){if(!e)
return null;let n=Number.isFinite(Number(e.percent_used))?Math.max(0,Math.min(100,Number(e.percent_used))):null,s=ae(e.title||
"Current context"),a=ae(e.subtitle||""),i=ae(e.detail||""),c=ae(e.label||e.usage_label||"");return React.createElement("\
div",{className:`cline-context-card ${t}-context-card`},React.createElement("div",{className:"cline-context-header"},React.
createElement("div",{className:"cline-context-copy"},React.createElement("div",{className:"cline-context-title"},s),a&&React.
createElement("div",{className:"cline-context-subtitle"},a),i&&React.createElement("div",{className:"cline-context-detai\
l"},i)),c&&React.createElement("div",{className:"cline-context-usage"},c)),n!=null&&React.createElement("div",{className:"\
cline-context-meter",title:`${e.percent_used}% of context window used`},React.createElement("div",{className:"cline-cont\
ext-meter-fill",style:{width:`${n}%`}})))}function ts(e,t){return e?.choice_id||e?.id||e?.value||`choice-${t}`}function No(e,t){
return e?.label||e?.title||e?.text||e?.name||ts(e,t)}function Jl(e,t){let n=new Set(Array.isArray(t)?t:[t]);return(Array.
isArray(e?.content_blocks)?e.content_blocks:[]).find(s=>n.has(s?.type))||null}function Cm(e){return Jl(e,"prompt")?.content||
e?.prompt_text||e?.message||e?.text||"Agent requires permission to continue."}function zm(e){let t=Math.max(0,Math.ceil(
e/1e3)),n=Math.floor(t/60),s=t%60;return`${n}:${String(s).padStart(2,"0")}`}function Yb(e,t){return e?.deadline_at?t<=0?
"Native deadline elapsed \xB7 awaiting receipt":`${e.auto_resolution_policy==="native"?"Native auto-resolution in":"Resp\
onse deadline in"} ${zm(t)}`:""}function Xb({prompt:e,sessionId:t,agentType:n,onRespond:s,onDismissFocus:a}){let[i,c]=React.
useState(Date.now()),[d,f]=React.useState({}),[h,b]=React.useState({}),[N,x]=React.useState({}),[S,R]=React.useState(""),
[u,v]=React.useState(null),[g,w]=React.useState(!1);React.useEffect(()=>{let I=setInterval(()=>c(Date.now()),500);return()=>clearInterval(
I)},[]),React.useEffect(()=>{f({}),b({}),x({}),R(""),v(null),w(!1)},[e?.prompt_id]);let y=Math.max(0,Number(e?.timeout_ms)||
0),E=Number(e?.received_at)||Date.now(),T=Date.parse(e?.deadline_at||""),H=e?.type==="question_prompt"&&Number.isFinite(
T),K=H?Math.max(0,T-i):y>0?Math.max(0,y-(i-E)):0,te=Array.isArray(e?.choices)?e.choices:[],ne=e?.submitting_choice_id||null,
oe=e?.type==="question_prompt"&&e?.lifecycle!=="open",G=e?.default_choice||null,de=(e?.kind==="question"||e?.type==="que\
stion_prompt")&&Array.isArray(e?.questions)?e.questions.filter(I=>I&&typeof I=="object"):[],Ne=de.length>0,J=n==="claude"&&
!Ne,ve=ae(e?.command).trim(),ge=ae(e?.title).trim()||(ve?"Allow this action?":Cm(e)),Z=ae(e?.description).trim(),he=J&&e?.
alternate_instruction_supported===!0,Q=de.flatMap(I=>(Array.isArray(I.choices)?I.choices:[]).map((W,re)=>({question:I,choiceId:ts(
W,re)}))).slice(0,9),U=(I,W)=>{f(re=>{let $=Array.isArray(re[I.question_id])?re[I.question_id]:[],z=I.multi_select?$.includes(
W)?$.filter(fe=>fe!==W):[...$,W]:[W];return{...re,[I.question_id]:z}})},V=de.every(I=>{let W=Array.isArray(I.choices)?I.
choices:[];if(I.answer_mode==="text"||W.length===0)return I.required===!1||ae(N[I.question_id]).trim().length>0;let re=d[I.
question_id]||[];return re.length===0?!1:re.every($=>!W.find((fe,we)=>ts(fe,we)===$)?.requires_text||ae(h[`${I.question_id}\
:${$}`]).trim())}),ie=()=>{if(!V||ne||oe)return;let I=de.map(W=>{let re=Array.isArray(W.choices)?W.choices:[];if(W.answer_mode===
"text"||re.length===0)return{question_id:W.question_id,text:ae(N[W.question_id]).trim()};let $=d[W.question_id]||[],z=re.
find((ye,Ce)=>ye.requires_text&&$.includes(ts(ye,Ce))),fe=z?re.indexOf(z):-1,we=z?ts(z,fe):null;return{question_id:W.question_id,
choice_ids:$,...we?{other_text:ae(h[`${W.question_id}:${we}`]).trim()}:{}}});s(t,e.prompt_id,null,{answers:I})};return React.
useEffect(()=>{let I=W=>{let re=W.target?.closest?.(".permission-card"),$=W.target?.matches?.(".input-area textarea"),z=W.
target===document.body||W.target===document.documentElement;if(!re&&!$&&!z||oe&&W.key!=="Escape")return;if(W.key==="Esca\
pe"){if(W.preventDefault(),Ne&&e?.type==="question_prompt"&&e?.cancel_supported===!0&&!ne&&!oe){s(t,e.prompt_id,null,{action:"\
cancel"});return}let Te=J?te.find((Le,At)=>/^(?:reject|deny|cancel|block|not now|no)\b/i.test(No(Le,At).replace(/^\d+\s+/,
""))):null;if(Te&&!ne){s(t,e.prompt_id,ts(Te,te.indexOf(Te)));return}w(!0),a?.();return}if(g)return;let fe=Fl(W.target),
we=W.key==="Enter"&&W.target?.closest?.(".permission-other-input");if(W.key==="Enter"&&!W.shiftKey&&W.target?.closest?.(
".permission-alternate-input")){W.preventDefault();let Te=S.trim();Te&&!ne&&s(t,e.prompt_id,null,{instruction:Te});return}
if(ne||fe&&!we&&!$)return;if(/^[1-9]$/.test(W.key)){let Te=Number(W.key)-1;if(W.preventDefault(),Ne){let Le=Q[Te];Le&&U(
Le.question,Le.choiceId)}else{let Le=te[Te];Le&&v(ts(Le,Te))}return}if(W.key!=="Enter")return;if(Ne){V&&(W.preventDefault(),
ie());return}let Ce=u||G;Ce&&te.some((Te,Le)=>ts(Te,Le)===Ce)&&(W.preventDefault(),s(t,e.prompt_id,Ce))};return window.addEventListener(
"keydown",I),()=>window.removeEventListener("keydown",I)},[S,te,J,G,oe,g,u,a,s,e?.prompt_id,V,d,h,N,t,Q,Ne,ne]),React.createElement(
"div",{className:"permission-overlay"},React.createElement("div",{className:`permission-card${J?" permission-card-claude":
""}`,role:"dialog","aria-modal":"false","aria-label":J?"Claude Code permission prompt":"Permission or question prompt",onPointerDown:()=>w(
!1)},J?React.createElement(React.Fragment,null,React.createElement("div",{className:"permission-title permission-title-c\
laude"},ge),ve&&React.createElement("pre",{className:"permission-command-claude"},ve),Z&&React.createElement("div",{className:"\
permission-body permission-body-claude"},Z)):React.createElement(React.Fragment,null,React.createElement("div",{className:"\
permission-eyebrow"},Ne?"Question":"Permission Required"),React.createElement("div",{className:"permission-title"},Ne?ae(
e?.title,"Answer the native question"):`Agent Paused In ${t?Tr(t,t):"Active Session"}`),!Ne&&React.createElement("div",{
className:"permission-body"},Cm(e)),React.createElement("div",{className:"permission-meta"},H&&React.createElement("span",
{className:"permission-timer"},Yb(e,K)),!H&&y>0&&React.createElement("span",{className:"permission-timer"},"Auto-choice \
in ",zm(K)),G&&React.createElement("span",{className:"permission-default"},"Default: ",G))),e?.error&&React.createElement(
"div",{className:"permission-error"},e.error),React.createElement("div",{className:`permission-actions${Ne?" permission-\
question-list":""}`},Ne?de.map((I,W)=>React.createElement("fieldset",{className:"permission-question",key:I.question_id||
W},React.createElement("legend",null,ae(I.header||I.label,`Question ${W+1}`)),ae(I.message).trim()&&React.createElement(
"div",{className:"permission-question-message"},ae(I.message)),React.createElement("div",{className:"permission-question\
-options"},I.answer_mode==="text"||!Array.isArray(I.choices)||I.choices.length===0?React.createElement("input",{className:"\
permission-question-text-input",type:I.secret===!0?"password":"text",value:N[I.question_id]||"",maxLength:2e3,disabled:!!ne||
oe,autoComplete:"off",spellCheck:I.secret===!0?"false":void 0,placeholder:I.secret===!0?"Enter private answer":"Enter an\
swer","aria-label":`${ae(I.header||I.label,`Question ${W+1}`)} answer`,onChange:re=>x($=>({...$,[I.question_id]:re.target.
value}))}):I.choices.map((re,$)=>{let z=ts(re,$),fe=(d[I.question_id]||[]).includes(z),we=`${I.question_id}:${z}`;return React.
createElement("div",{className:"permission-question-option",key:z},React.createElement("button",{type:"button",className:`\
permission-action${fe?" selected":""}`,role:I.multi_select?"checkbox":"radio","aria-checked":fe,disabled:!!ne||oe,"aria-\
keyshortcuts":Q.findIndex(ye=>ye.question===I&&ye.choiceId===z)>=0?String(Q.findIndex(ye=>ye.question===I&&ye.choiceId===
z)+1):void 0,onClick:()=>U(I,z)},Q.findIndex(ye=>ye.question===I&&ye.choiceId===z)>=0&&React.createElement("kbd",{className:"\
permission-key-hint"},Q.findIndex(ye=>ye.question===I&&ye.choiceId===z)+1),React.createElement("span",{className:"permis\
sion-choice-marker","aria-hidden":"true"},I.multi_select?fe?"\u2713":"\u25A1":fe?"\u25CF":"\u25CB"),React.createElement(
"span",{className:"permission-choice-copy"},React.createElement("span",null,No(re,$)),ae(re?.description).trim()&&React.
createElement("span",{className:"permission-action-desc"},ae(re.description)))),fe&&re.requires_text&&React.createElement(
"input",{className:"permission-other-input",type:I.secret===!0?"password":"text",value:h[we]||"",maxLength:2e3,disabled:!!ne||
oe,autoComplete:"off",spellCheck:I.secret===!0?"false":void 0,placeholder:"Enter another answer","aria-label":`${No(re,$)}\
 answer`,onChange:ye=>b(Ce=>({...Ce,[we]:ye.target.value}))}))})))):te.map((I,W)=>{let re=ts(I,W),$=ne===re,z=G&&G===re,
fe=u===re,we=J&&!u&&!G&&W===0,ye=J?No(I,W).replace(new RegExp(`^${W+1}\\s+`),""):No(I,W),Ce=J?ae(I?.destination).trim():
"",Te=Ce&&ye.endsWith(Ce)?ye.slice(0,-Ce.length):ye;return React.createElement("button",{key:re,className:`permission-ac\
tion${z?" default":""}${fe||we?" selected":""}${$?" pending":""}`,disabled:!!ne,"aria-pressed":fe||we,"aria-keyshortcuts":W<
9?String(W+1):void 0,onClick:()=>s(t,e.prompt_id,re)},W<9&&React.createElement("kbd",{className:"permission-key-hint"},ae(
I?.shortcut,String(W+1))),React.createElement("span",null,Te,Ce&&React.createElement("span",{className:"permission-choic\
e-destination-claude"},Ce)),ae(I?.description).trim()&&React.createElement("span",{className:"permission-action-desc"},ae(
I.description)),$&&React.createElement("span",{className:"permission-action-state"},"Sending..."))})),he&&React.createElement(
"textarea",{className:"permission-alternate-input",rows:"1",maxLength:2e3,value:S,disabled:!!ne,placeholder:ae(e?.alternate_instruction_placeholder,
"Tell Claude what to do instead"),"aria-label":"Tell Claude what to do instead",onChange:I=>R(I.target.value)}),Ne&&React.
createElement("div",{className:"permission-question-footer"},React.createElement("button",{type:"button",className:"perm\
ission-question-submit",disabled:!V||!!ne||oe,onClick:ie},ne?"Sending...":ae(e.submit_label,"Submit answers")),e?.type===
"question_prompt"&&e?.cancel_supported===!0&&React.createElement("button",{type:"button",className:"permission-question-\
cancel",disabled:!!ne||oe,onClick:()=>s(t,e.prompt_id,null,{action:"cancel"})},"Cancel")),React.createElement("div",{className:"\
permission-keyboard-help"},J?ae(e?.cancel_hint,"Esc to cancel"):`1\u20139 select \xB7 Enter submit \xB7 Esc ${e?.cancel_supported===
!0?"cancel":"return to composer"}`)))}function Ji(e){return ae(e?.label,"Action")}function Mr(e){return!!e&&e.blocking!==
!1&&e.display_mode!=="inline"}function Qb({prompt:e,sessionId:t,onRespond:n}){let s=Jl(e,["error","notice"]),a=Array.isArray(
e?.actions)?e.actions:s?.actions||[],i=e?.submitting_action_id||null,c=ae(e?.error_output||s?.error_output).trim();return React.
createElement("div",{className:"permission-overlay"},React.createElement("div",{className:"permission-card error-prompt-\
card"},React.createElement("div",{className:"permission-eyebrow error-prompt-eyebrow"},"Action Required"),React.createElement(
"div",{className:"permission-title"},ae(s?.label||e?.title,"Error handling model response")),React.createElement("div",{
className:"permission-body"},ae(s?.content||e?.message,"There was an error handling the model response.")),c&&React.createElement(
"div",{className:"error-prompt-output-wrap"},React.createElement("div",{className:"error-prompt-output-label"},"Error Ou\
tput"),React.createElement("pre",{className:"error-prompt-output"},c)),e?.error&&React.createElement("div",{className:"p\
ermission-error"},e.error),React.createElement("div",{className:"permission-actions"},a.map(d=>{let f=ae(d?.action_id),h=i===
f;return React.createElement("button",{key:f||Ji(d),className:`permission-action error-prompt-action${h?" pending":""}`,
disabled:!!i,onClick:b=>n(t,e.prompt_id,f,b)},React.createElement("span",null,Ji(d)),h&&React.createElement("span",{className:"\
permission-action-state"},"Sending..."))}))))}function Jb({prompt:e,sessionId:t,onRespond:n}){let s=Jl(e,["error","notic\
e"]),a=Array.isArray(e?.actions)?e.actions:s?.actions||[],i=e?.submitting_action_id||null,c=ae(e?.error_output||s?.error_output).
trim();return React.createElement("div",{className:"inline-error-prompt"},React.createElement("div",{className:"inline-e\
rror-prompt-body"},React.createElement("div",{className:"inline-error-prompt-title"},ae(s?.label||e?.title,"Codex requir\
es attention")),React.createElement("div",{className:"inline-error-prompt-message"},ae(s?.content||e?.message,"There was\
 an error handling the model response.")),c&&React.createElement("pre",{className:"inline-error-prompt-output"},c),e?.error&&
React.createElement("div",{className:"permission-error"},e.error)),React.createElement("div",{className:"inline-error-pr\
ompt-actions"},a.map(d=>{let f=ae(d?.action_id),h=i===f;return React.createElement("button",{key:f||Ji(d),className:`per\
mission-action error-prompt-action${h?" pending":""}`,disabled:!!i,onClick:b=>n(t,e.prompt_id,f,b)},React.createElement(
"span",null,Ji(d)),h&&React.createElement("span",{className:"permission-action-state"},"Sending..."))})))}function Zb({launchStates:e,
onLaunch:t,onResume:n,onClose:s,workspaces:a,showTestSessions:i=!1}){let[c,d]=React.useState("new"),[f,h]=React.useState(
"claude"),[b,N]=React.useState(""),[x,S]=React.useState(""),[R,u]=React.useState("deepseek-v4-pro:cloud"),[v,g]=React.useState(
"gpt-5.5"),[w,y]=React.useState("grok-4.5-fast-high"),[E,T]=React.useState(null),[H,K]=React.useState([]),[te,ne]=React.
useState(!1),oe=E?e[E]:null,G=oe?.status==="launching",de=oe?.status==="failed"?oe.error:null,Ne=(a||[]).length>0;React.
useEffect(()=>{E&&!e[E]&&s()},[e,E]),React.useEffect(()=>{c==="resume"&&!te&&(ne(!0),fetch(`/api/sessions/history?limit=\
30&include_test=${i?"true":"false"}`,{credentials:"same-origin"}).then(Z=>Z.json()).then(Z=>K(Z.sessions||[])).catch(()=>K(
[])).finally(()=>ne(!1)))},[c,i]);function J(Z){if(Z.preventDefault(),G)return;let he=b==="custom"?x.trim():b,Q=f==="cla\
ude_cli"?{model_id:R.trim()||"default"}:f==="codex_cli"?{model_id:v.trim()||"gpt-5.5",permission_mode:"workspace-write",
effort:"medium"}:f==="cursor_cli"?{model_id:w.trim()||"grok-4.5-fast-high",permission_mode:"force"}:{},U=t(f,he||void 0,
Q);T(U)}function ve(Z){if(G)return;let he=Z.agent_type||f,Q=Z.workspace_path||(b==="custom"?x.trim():b)||void 0,U=n(Z.session_id,
he,Q,{cli_session_id:Z.cli_session_id||void 0,model_id:Z.model_id||void 0,permission_mode:Z.permission_mode||void 0});T(
U)}function ge(Z){if(!Z)return"";let he=Date.now()-new Date(Z).getTime(),Q=Math.floor(he/6e4);if(Q<60)return`${Q}m ago`;
let U=Math.floor(Q/60);return U<24?`${U}h ago`:`${Math.floor(U/24)}d ago`}return React.createElement("div",{className:"n\
ew-session-panel"},React.createElement("div",{className:"new-session-header"},React.createElement("span",null,c==="new"?
"New Session":"Resume Session"),React.createElement("button",{className:"new-session-close",onClick:s,title:"Cancel"},"\u2715")),
React.createElement("div",{className:"new-session-tabs"},React.createElement("button",{className:`new-session-tab${c==="\
new"?" active":""}`,onClick:()=>d("new")},"New"),React.createElement("button",{className:`new-session-tab${c==="resume"?
" active":""}`,onClick:()=>d("resume")},"Resume")),c==="new"?React.createElement("form",{className:"new-session-form",onSubmit:J},
React.createElement("div",{className:"new-session-agents"},Object.entries(Ln).map(([Z,he])=>React.createElement("button",
{key:Z,type:"button",className:`new-session-agent-btn${f===Z?" selected":""}`,style:f===Z?{borderColor:he.color,color:he.
color,background:he.color+"18"}:{},onClick:()=>h(Z)},React.createElement("span",{className:"agent-badge new-session-badg\
e",style:{color:he.color,borderColor:he.color+"55",background:he.color+"18"}},he.abbr),React.createElement("span",{className:"\
new-session-agent-name"},he.name)))),Ne?React.createElement(React.Fragment,null,React.createElement("select",{className:"\
new-session-workspace",value:b,onChange:Z=>N(Z.target.value),disabled:G},React.createElement("option",{value:""},"No wor\
kspace (default)"),a.map((Z,he)=>React.createElement("option",{key:he,value:Z.path||Z.title},Z.title)),React.createElement(
"option",{value:"custom"},"Custom path\u2026")),b==="custom"&&React.createElement("input",{className:"new-session-worksp\
ace",type:"text",placeholder:"Enter workspace path",value:x,onChange:Z=>S(Z.target.value),disabled:G,autoFocus:!0})):React.
createElement("input",{className:"new-session-workspace",type:"text",placeholder:"Workspace path (optional)",value:x,onChange:Z=>S(
Z.target.value),disabled:G}),f==="claude_cli"&&React.createElement("input",{className:"new-session-workspace",type:"text",
placeholder:"Claude CLI model, e.g. deepseek-v4-pro:cloud",value:R,onChange:Z=>u(Z.target.value),disabled:G}),f==="codex\
_cli"&&React.createElement("select",{className:"new-session-workspace",value:v,onChange:Z=>g(Z.target.value),disabled:G},
Zl.map(Z=>React.createElement("option",{key:Z.id,value:Z.id},Z.label))),f==="cursor_cli"&&React.createElement("select",{
className:"new-session-workspace",value:w,onChange:Z=>y(Z.target.value),disabled:G},eu.map(Z=>React.createElement("optio\
n",{key:Z.id,value:Z.id},Z.label))),de&&React.createElement("div",{className:"new-session-error"},de),React.createElement(
"button",{className:"new-session-submit",type:"submit",disabled:G},G?React.createElement("span",{className:"new-session-\
spinner"}):null,G?"Launching\u2026":"Launch")):React.createElement("div",{className:"new-session-form"},React.createElement(
"div",{className:"new-session-agents"},Object.entries(Ln).map(([Z,he])=>React.createElement("button",{key:Z,type:"button",
className:`new-session-agent-btn${f===Z?" selected":""}`,style:f===Z?{borderColor:he.color,color:he.color,background:he.
color+"18"}:{},onClick:()=>h(Z)},React.createElement("span",{className:"agent-badge new-session-badge",style:{color:he.color,
borderColor:he.color+"55",background:he.color+"18"}},he.abbr),React.createElement("span",{className:"new-session-agent-n\
ame"},he.name)))),de&&React.createElement("div",{className:"new-session-error"},de),te?React.createElement("div",{className:"\
session-history-loading"},React.createElement("span",{className:"new-session-spinner"})," Loading history\u2026"):H.length===
0?React.createElement("div",{className:"session-history-empty"},"No past sessions found"):React.createElement("div",{className:"\
session-history-list"},H.filter(Z=>!f||!Z.agent_type||Z.agent_type===f).map(Z=>React.createElement("button",{key:Z.session_id,
className:"session-history-item",onClick:()=>ve(Z),disabled:G},React.createElement("div",{className:"session-history-pre\
view"},Z.preview||"(empty session)"),React.createElement("div",{className:"session-history-meta"},React.createElement("s\
pan",null,Z.message_count," msg",Z.message_count!==1?"s":""),Z.agent_type&&React.createElement("span",{className:"sessio\
n-history-workspace"},Ln[Z.agent_type]?.name||Z.agent_type),Z.workspace_name&&React.createElement("span",{className:"ses\
sion-history-workspace",title:Z.workspace_path||""},Z.workspace_name),React.createElement("span",null,ge(Z.last_active_at))))))))}
var ev={claude:[{value:"default",label:"Ask before edit"},{value:"acceptEdits",label:"Edit automatically"},{value:"plan",
label:"Plan mode"},{value:"auto",label:"Auto mode"},{value:"bypassPermissions",label:"Bypass permissions"}],claude_cli:[
{value:"default",label:"Default"},{value:"acceptEdits",label:"Accept edits"},{value:"auto",label:"Auto"},{value:"bypassP\
ermissions",label:"Bypass permissions"},{value:"dontAsk",label:"Do not ask"},{value:"plan",label:"Plan"}],continue_yolo:[
{value:"ask",label:"Ask for permissions"},{value:"bypass",label:"Bypass permissions"}],roo_code:[{value:"BRRR",label:"BR\
RR"},{value:"YOLO",label:"YOLO"},{value:"Ask",label:"Ask"},{value:"Auto-approve",label:"Auto-approve"}],cline:[{value:"Y\
OLO",label:"YOLO"}],codex_cli:[{value:"read-only",label:"Read only"},{value:"workspace-write",label:"Workspace write"},{
value:"danger-full-access",label:"Full access"}],cursor_cli:[{value:"default",label:"Default"},{value:"force",label:"For\
ce (Yolo)"},{value:"plan",label:"Plan"},{value:"ask",label:"Ask"}],codex:[],gemini:[]};function Vm(e){return e==="codex_\
cli"?"workspace-write":e==="cursor_cli"?"force":e==="continue_yolo"||e==="roo_code"||e==="cline"?"ask":"default"}var Ul=[
{id:"default",label:"Auto"},{id:"claude-opus-4-6",label:"Claude Opus 4.6"},{id:"claude-sonnet-4-6",label:"Claude Sonnet \
4.6"},{id:"claude-opus-4-5",label:"Claude Opus 4.5"},{id:"claude-sonnet-4-5",label:"Claude Sonnet 4.5"},{id:"claude-haik\
u-4-5",label:"Claude Haiku 4.5"},{id:"claude-opus-4-0",label:"Claude Opus 4"},{id:"claude-sonnet-4-0",label:"Claude Sonn\
et 4"},{id:"claude-3-7-sonnet",label:"Claude 3.7 Sonnet"},{id:"claude-3-5-sonnet",label:"Claude 3.5 Sonnet"},{id:"claude\
-3-5-haiku",label:"Claude 3.5 Haiku"},{id:"deepseek-v4-pro:cloud",label:"DeepSeek V4 Pro (Ollama Cloud)"}],Zl=[{id:"gpt-\
5.6",label:"GPT-5.6"},{id:"gpt-5.6-sol",label:"GPT-5.6 Sol"},{id:"gpt-5.6-terra",label:"GPT-5.6 Terra"},{id:"gpt-5.6-lun\
a",label:"GPT-5.6 Luna"},{id:"gpt-5.5",label:"GPT-5.5"},{id:"gpt-5.4",label:"GPT-5.4"},{id:"gpt-5.4-mini",label:"GPT-5.4\
 Mini"},{id:"gpt-5.3-codex-spark",label:"GPT-5.3 Codex Spark"},{id:"gpt-5.3-codex",label:"GPT-5.3 Codex"},{id:"gpt-5.2-c\
odex",label:"GPT-5.2 Codex"},{id:"gpt-5.2",label:"GPT-5.2"},{id:"gpt-5.1-codex",label:"GPT-5.1 Codex"},{id:"gpt-5.1",label:"\
GPT-5.1"},{id:"gpt-5",label:"GPT-5"},{id:"ollama:deepseek-v4-pro:cloud",label:"DeepSeek V4 Pro (Ollama Cloud)"},{id:"oll\
ama:kimi-k2.6:cloud",label:"Kimi K2.6 (Ollama Cloud)"}],eu=[{id:"grok-4.5-fast-high",label:"Grok 4.5 Fast (High)"},{id:"\
grok-4.5-fast-xhigh",label:"Grok 4.5 Fast (XHigh)"},{id:"claude-fable-5-thinking-high",label:"Claude Fable 5 (Thinking H\
igh)"},{id:"claude-opus-4-8-thinking-high",label:"Claude Opus 4.8 (Thinking High)"},{id:"composer-2.5",label:"Composer 2\
.5"},{id:"composer-2.5-fast",label:"Composer 2.5 Fast"},{id:"gpt-5.5-high",label:"GPT-5.5 (High)"},{id:"gpt-5.3-codex",label:"\
GPT-5.3 Codex"}],tu=[{id:"Planning",label:"Planning"},{id:"Fast",label:"Fast"}],tv=[{id:"Architect",label:"Architect"},{
id:"Code",label:"Code"},{id:"Ask",label:"Ask"},{id:"Debug",label:"Debug"},{id:"Orchestrator",label:"Orchestrator"}],nv=[
{id:"Plan",label:"Plan"},{id:"Act",label:"Act"}],Km=[{id:"Gemini 3.1 Pro (High)",label:"Gemini 3.1 Pro (High)"},{id:"Gem\
ini 3.1 Pro (Low)",label:"Gemini 3.1 Pro (Low)"},{id:"Gemini 3 Flash",label:"Gemini 3 Flash"},{id:"Claude Sonnet 4.6 (Th\
inking)",label:"Claude Sonnet 4.6 (Thinking)"},{id:"Claude Opus 4.6 (Thinking)",label:"Claude Opus 4.6 (Thinking)"},{id:"\
GPT-OSS 120B (Medium)",label:"GPT-OSS 120B (Medium)"}],Ym=[{id:"Default",label:"Default"},{id:"2.5 Flash",label:"Gemini \
2.5 Flash"},{id:"2.5 Pro",label:"Gemini 2.5 Pro"},{id:"3 Flash Preview",label:"Gemini 3 Flash Preview"},{id:"3.1 Pro Pre\
view",label:"Gemini 3.1 Pro Preview"}];function xm(e,t){return Array.isArray(t?.available_models)&&t.available_models.length>
0?t.available_models.map(n=>typeof n=="string"?{id:n,label:n}:n):e==="continue_yolo"||e==="continue"||e==="roo_code"||e===
"cline"?[]:e==="claude_cli"?Ul:e==="codex_cli"?Zl:e==="cursor_cli"?eu:e==="antigravity"||e==="antigravity_panel"?Km:e===
"gemini"?Ym:Ul}function So(e,t){return Array.isArray(t?.available_modes)&&t.available_modes.length>0?t.available_modes.map(
n=>typeof n=="string"?{id:n,label:n}:n):e==="roo_code"?tv:e==="cline"?nv:e==="antigravity"||e==="antigravity_panel"?tu:[]}
function Gl(e,t){return Array.isArray(t?.available_permission_modes)&&t.available_permission_modes.length>0?t.available_permission_modes.
map(n=>typeof n=="string"?{value:n,label:n}:{value:n.id||n.value,label:n.label||n.id||n.value}).filter(n=>n.value):ev[e]||
[]}function sv(e){let t="=".repeat((4-e.length%4)%4),n=(e+t).replace(/-/g,"+").replace(/_/g,"/"),s=atob(n);return Uint8Array.
from([...s].map(a=>a.charCodeAt(0)))}var nu=Object.freeze({permission_required:!0,agent_ready:!0,turn_ready:!1,goal_completed:!1,
goal_attention:!0,provider_usage_warning:!0,agent_error:!0,session_offline:!0,rate_limit_cleared:!0,completion_sound:!1,
completion_haptic:!1}),av=Object.freeze(Object.fromEntries(Object.keys(nu).map(e=>[e,!1]))),zi=null,Am=0;function su(){if(typeof window>
"u")return null;let e=window.AudioContext||window.webkitAudioContext;return e?(zi||(zi=new e),zi.state==="suspended"&&zi.
resume().catch(()=>{}),zi):null}function Rm(e="completion"){let t=Date.now();if(t-Am<600)return!1;let n=su();if(!n||n.state!==
"running")return!1;Am=t;let s=n.createOscillator(),a=n.createGain(),i=n.currentTime;return s.type="sine",s.frequency.setValueAtTime(
e==="prompt"?740:620,i),s.frequency.exponentialRampToValueAtTime(e==="prompt"?880:760,i+.11),a.gain.setValueAtTime(1e-4,
i),a.gain.exponentialRampToValueAtTime(.035,i+.012),a.gain.exponentialRampToValueAtTime(1e-4,i+.14),s.connect(a),a.connect(
n.destination),s.start(i),s.stop(i+.15),!0}function Mm(e,t){return e!==t?!0:typeof document>"u"?!1:document.visibilityState!==
"visible"||!document.hasFocus()}function rv({onClose:e,onPreferencesChange:t}){let n=nu,[s,a]=ce(n),[i,c]=ce(!0),[d,f]=ce(
null),[h,b]=ce(""),[N,x]=ce("checking"),[S,R]=ce(!1);async function u(){c(!0),b("");try{let E=await fetch("/api/preferen\
ces/notifications",{credentials:"same-origin"}),T=await E.json().catch(()=>({}));if(!E.ok)throw new Error(T.error||"Unab\
le to load notification settings.");let H={...n,...T.preferences||{},turn_ready:!1};a(H),t?.(H)}catch(E){b(E.message||"U\
nable to load notification settings.")}finally{c(!1)}}async function v(){if(!("serviceWorker"in navigator)||!("PushManag\
er"in window)||!("Notification"in window)){x("unsupported");return}try{let T=await(await navigator.serviceWorker.ready).
pushManager.getSubscription();x(T?"enabled":Notification.permission==="denied"?"denied":"available")}catch{x("error")}}Me(
()=>{u(),v()},[]);async function g(){if(!S){R(!0),b("");try{let E=await Notification.requestPermission();if(E!=="granted"){
x(E==="denied"?"denied":"available");return}let T=await fetch("/api/push/web-config",{credentials:"same-origin"}),H=await T.
json().catch(()=>({}));if(!T.ok||!H.public_key)throw new Error(H.error||"Web Push is unavailable.");let K=await navigator.
serviceWorker.ready,te=await K.pushManager.getSubscription();te||(te=await K.pushManager.subscribe({userVisibleOnly:!0,applicationServerKey:sv(
H.public_key)}));let ne=await fetch("/api/push/web-subscription",{method:"POST",credentials:"same-origin",headers:{"Cont\
ent-Type":"application/json"},body:JSON.stringify({subscription:te.toJSON()})}),oe=await ne.json().catch(()=>({}));if(!ne.
ok)throw new Error(oe.error||"Unable to register browser notifications.");x("enabled")}catch(E){x("error"),b(E.message||
"Unable to enable browser notifications.")}finally{R(!1)}}}async function w(){if(!S){R(!0),b("");try{let T=await(await navigator.
serviceWorker.ready).pushManager.getSubscription();T&&(await fetch("/api/push/web-subscription",{method:"DELETE",credentials:"\
same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({endpoint:T.endpoint})}),await T.unsubscribe()),
x("available")}catch(E){x("error"),b(E.message||"Unable to disable browser notifications.")}finally{R(!1)}}}async function y(E){
if(d||E==="turn_ready")return;let T=s,H={...s,[E]:!s[E]};E==="completion_sound"&&H.completion_sound&&su(),a(H),f(E),b("");
try{let K=await fetch("/api/preferences/notifications",{method:"PUT",credentials:"same-origin",headers:{"Content-Type":"\
application/json"},body:JSON.stringify({preferences:H})}),te=await K.json().catch(()=>({}));if(!K.ok)throw new Error(te.
error||"Unable to save notification settings.");let ne={...n,...te.preferences||{}};a(ne),t?.(ne)}catch(K){a(T),b(K.message||
"Unable to save notification settings.")}finally{f(null)}}return React.createElement("div",{className:"settings-panel no\
tification-settings-panel"},React.createElement("div",{className:"settings-panel-header"},React.createElement("span",null,
"Notifications"),React.createElement("button",{className:"settings-panel-close",onClick:e,title:"Close"},"\u2715")),React.
createElement("div",{className:"settings-panel-body"},React.createElement("div",{className:"notification-setting-row web\
-push-setting-row"},React.createElement("span",null,React.createElement("strong",null,"Browser notifications"),React.createElement(
"small",null,N==="enabled"?"Enabled for this browser":N==="denied"?"Blocked in browser site settings":N==="unsupported"?
"Not supported by this browser":N==="checking"?"Checking browser support\u2026":"Receive notifications when this PWA is \
closed")),N==="enabled"?React.createElement("button",{type:"button",disabled:S,onClick:w},"Disable"):React.createElement(
"button",{type:"button",disabled:S||N==="checking"||N==="unsupported"||N==="denied",onClick:g},S?"Enabling\u2026":"Enabl\
e")),React.createElement("label",{className:"notification-setting-row"},React.createElement("span",null,React.createElement(
"strong",null,"Permission required"),React.createElement("small",null,"When an agent needs approval to continue")),React.
createElement("input",{type:"checkbox",checked:s.permission_required,disabled:i||!!d,onChange:()=>y("permission_required")})),
React.createElement("label",{className:"notification-setting-row"},React.createElement("span",null,React.createElement("\
strong",null,"Turn finished"),React.createElement("small",null,"Unavailable until this harness supplies an authoritative\
 native turn boundary")),React.createElement("input",{type:"checkbox",checked:!1,disabled:!0,onChange:()=>y("turn_ready")})),
React.createElement("label",{className:"notification-setting-row"},React.createElement("span",null,React.createElement("\
strong",null,"Goal completed"),React.createElement("small",null,"Only when the native goal reaches its terminal complete\
d state")),React.createElement("input",{type:"checkbox",checked:s.goal_completed,disabled:i||!!d,onChange:()=>y("goal_co\
mpleted")})),React.createElement("label",{className:"notification-setting-row"},React.createElement("span",null,React.createElement(
"strong",null,"Goal needs attention"),React.createElement("small",null,"Paused, blocked, limited, cancelled, or failed g\
oals")),React.createElement("input",{type:"checkbox",checked:s.goal_attention,disabled:i||!!d,onChange:()=>y("goal_atten\
tion")})),React.createElement("label",{className:"notification-setting-row"},React.createElement("span",null,React.createElement(
"strong",null,"Provider usage warning"),React.createElement("small",null,"At 75%, 90%, and exhaustion for each provider \
account window")),React.createElement("input",{type:"checkbox",checked:s.provider_usage_warning,disabled:i||!!d,onChange:()=>y(
"provider_usage_warning")})),React.createElement("div",{className:"settings-note"},"Active /goal loop checkpoints stay q\
uiet between turns."),React.createElement("label",{className:"notification-setting-row"},React.createElement("span",null,
React.createElement("strong",null,"Agent error or rate limit"),React.createElement("small",null,"When an agent stops and\
 needs attention")),React.createElement("input",{type:"checkbox",checked:s.agent_error,disabled:i||!!d,onChange:()=>y("a\
gent_error")})),React.createElement("label",{className:"notification-setting-row"},React.createElement("span",null,React.
createElement("strong",null,"Session offline"),React.createElement("small",null,"When an agent disconnects from the rela\
y")),React.createElement("input",{type:"checkbox",checked:s.session_offline,disabled:i||!!d,onChange:()=>y("session_offl\
ine")})),React.createElement("label",{className:"notification-setting-row"},React.createElement("span",null,React.createElement(
"strong",null,"Rate limit cleared"),React.createElement("small",null,"When a model's rate limit expires")),React.createElement(
"input",{type:"checkbox",checked:s.rate_limit_cleared,disabled:i||!!d,onChange:()=>y("rate_limit_cleared")})),React.createElement(
"label",{className:"notification-setting-row"},React.createElement("span",null,React.createElement("strong",null,"Notifi\
cation sound"),React.createElement("small",null,"Subtle cue for allowed prompts and explicit goal lifecycle events")),React.
createElement("input",{type:"checkbox",checked:s.completion_sound,disabled:i||!!d,onChange:()=>y("completion_sound")})),
i&&React.createElement("div",{className:"settings-note"},"Loading relay preferences\u2026"),!!h&&React.createElement("di\
v",{className:"notification-settings-error",role:"alert"},React.createElement("span",null,h),React.createElement("button",
{type:"button",onClick:u},"Retry")),React.createElement("div",{className:"settings-note"},"These preferences sync across\
 web and Android.")))}function ov({sessions:e,preferences:t,initialSessionId:n,onSave:s,onExport:a,onClose:i}){let c=n||
Ee(e[0])||"",[d,f]=ce(c),[h,b]=ce(""),[N,x]=ce(!1),[S,R]=ce(""),[u,v]=ce(""),g=e.find(T=>Ee(T)===d)||null,w=t[d]||{display_name:"",
archived:!1,muted:!1,pinned:!1,pin_order:0};Me(()=>{b(w.display_name||""),v("")},[d,w.display_name]),Me(()=>{n&&f(n)},[n]);
async function y(T){if(!(!d||N)){x(!0),v("");try{await s(d,T)}catch(H){v(H.message||"Unable to save session settings.")}finally{
x(!1)}}}async function E(T){if(!(!d||S)){R(T),v("");try{await a(d,T)}catch(H){v(H.message||"Unable to export session.")}finally{
R("")}}}return React.createElement("div",{className:"settings-panel session-management-panel"},React.createElement("div",
{className:"settings-panel-header"},React.createElement("span",null,"Manage sessions"),React.createElement("button",{className:"\
settings-panel-close",onClick:i,title:"Close"},"\u2715")),React.createElement("div",{className:"settings-panel-body"},e.
length===0?React.createElement("div",{className:"settings-note"},"No sessions available."):React.createElement(React.Fragment,
null,React.createElement("label",{className:"settings-row session-management-field"},React.createElement("span",{className:"\
settings-label"},"Session"),React.createElement("select",{value:d,onChange:T=>f(T.target.value)},e.map(T=>{let H=Ee(T),K=t[H]||
{},te=K.display_name||T?.display_name||T?.workspace_name||T?.name||H;return React.createElement("option",{key:H,value:H},
K.archived?"[Hidden] ":"",te)}))),g&&React.createElement(React.Fragment,null,React.createElement("label",{className:"set\
tings-row session-management-field"},React.createElement("span",{className:"settings-label"},"Custom name"),React.createElement(
"input",{value:h,maxLength:100,placeholder:g?.display_name||g?.workspace_name||g?.name||d,onChange:T=>b(T.target.value)})),
React.createElement("label",{className:"notification-setting-row"},React.createElement("span",null,React.createElement("\
strong",null,"Pin chat"),React.createElement("small",null,"Keep this chat in the operator-ordered pinned section")),React.
createElement("input",{type:"checkbox",checked:!!w.pinned,disabled:N,onChange:()=>y({pinned:!w.pinned})})),React.createElement(
"label",{className:"notification-setting-row"},React.createElement("span",null,React.createElement("strong",null,"Mute n\
otifications"),React.createElement("small",null,"Suppress push notifications for this session")),React.createElement("in\
put",{type:"checkbox",checked:!!w.muted,disabled:N,onChange:()=>y({muted:!w.muted})})),React.createElement("div",{className:"\
session-management-actions"},React.createElement("button",{disabled:N,onClick:()=>y({display_name:h})},"Save name"),React.
createElement("button",{className:w.archived?"":"danger",disabled:N,onClick:()=>y({archived:!w.archived})},w.archived?"R\
estore to sidebar":"Hide from sidebar")),React.createElement("div",{className:"session-management-actions session-export\
-actions","aria-label":"Export session"},React.createElement("button",{disabled:!!S,onClick:()=>E("markdown")},S==="mark\
down"?"Preparing\u2026":"Download Markdown"),React.createElement("button",{disabled:!!S,onClick:()=>E("json")},S==="json"?
"Preparing\u2026":"Download JSON")))),!!u&&React.createElement("div",{className:"settings-error",role:"alert"},u),React.
createElement("div",{className:"settings-note"},"Names, pinned order, hidden state, and mute settings sync across web an\
d Android.")))}function iv({sessionId:e,initialContent:t,jobs:n,onSchedule:s,onCancel:a,onCreated:i,onClose:c}){let[d,f]=ce(
t||""),[h,b]=ce("idle"),[N,x]=ce(()=>{let y=new Date(Date.now()+36e5);return new Date(y.getTime()-y.getTimezoneOffset()*
6e4).toISOString().slice(0,16)}),[S,R]=ce(""),[u,v]=ce(!1);async function g(y){y.preventDefault(),v(!0),R("");try{await s(
e,d,h,h==="at"?new Date(N).toISOString():null),i?.(),f("")}catch(E){R(E.message)}finally{v(!1)}}async function w(y){try{
await a(y)}catch(E){R(E.message)}}return React.createElement("div",{className:"settings-panel scheduled-send-panel","dat\
a-testid":"scheduled-send-panel"},React.createElement("div",{className:"settings-panel-header"},React.createElement("spa\
n",null,"Schedule message"),React.createElement("button",{className:"settings-panel-close",onClick:c,title:"Close"},"\xD7")),
React.createElement("form",{className:"settings-panel-body",onSubmit:g},React.createElement("label",{className:"settings\
-row session-management-field"},React.createElement("span",{className:"settings-label"},"Message"),React.createElement("\
textarea",{value:d,maxLength:524288,onChange:y=>f(y.target.value)})),React.createElement("label",{className:"settings-ro\
w session-management-field"},React.createElement("span",{className:"settings-label"},"Deliver"),React.createElement("sel\
ect",{value:h,onChange:y=>b(y.target.value)},React.createElement("option",{value:"idle"},"When session is next idle"),React.
createElement("option",{value:"at"},"At a specific time"))),h==="at"&&React.createElement("label",{className:"settings-r\
ow session-management-field"},React.createElement("span",{className:"settings-label"},"Local time"),React.createElement(
"input",{type:"datetime-local",value:N,onChange:y=>x(y.target.value)})),React.createElement("div",{className:"session-ma\
nagement-actions"},React.createElement("button",{type:"submit",disabled:u||!d.trim()},u?"Scheduling\u2026":"Schedule")),
!!S&&React.createElement("div",{className:"settings-error",role:"alert"},S),!!n.length&&React.createElement("div",{className:"\
scheduled-send-list"},React.createElement("strong",null,"Pending"),n.map(y=>React.createElement("div",{className:"schedu\
led-send-row",key:y.id},React.createElement("span",null,y.trigger_kind==="idle"?"Next idle":new Date(y.deliver_at).toLocaleString(),
" \xB7 ",y.content),React.createElement("button",{type:"button",onClick:()=>w(y.id),disabled:y.state!=="pending"},y.state===
"dispatching"?"Sending\u2026":"Cancel"))))))}function cv({session:e,config:t,configControlStates:n,onRequestRefresh:s,onSetModel:a,
onSetEffort:i,onSetPermissionMode:c,onSetAutoApprovePermissions:d,onSetMode:f,onSetCodexConfig:h,onSwitchWorkspace:b,onClose:N}){
let[x,S]=React.useState(!1),[R,u]=React.useState(null),v=Ee(e),g=O=>n?.[`${v}:${O}`]||null,w=O=>O&&(O.status==="pending"||
O.status==="awaiting_config"),y=g("model"),E=g("permission_mode"),T=g("effort"),H=g("auto_approve_permissions"),K=g("mod\
e"),te=g("speed"),ne=g("access_mode"),oe=g("permission_profile"),G=g("workspace"),de=[y,E,T,H,K,te,ne,oe,G].find(O=>w(O)||
O?.status==="failed"),Ne=de?w(de)?`Saving ${de.field.replace(/_/g," ")}\u2026`:de.error:null,J=e&&typeof e=="object"?e.agent_type:
null,ve=t?.capabilities||{},ge=J==="codex_cli"&&t?.config_semantics==="observed_and_next_send",Z=J==="codex",he=!Z||t?.controls_available!==
!1,Q=t?.model_id||"unknown",U=t?.next_send_model_id||"",V=e&&typeof e=="object"&&e.rate_limited_until||null,ie=Array.isArray(
e?.antigravity_quota_models)?e.antigravity_quota_models:[],I=e?.active_quota_model||null,W=t?.permission_mode||"unknown",
re=t?.conversation_mode||"unknown",$=t?.mode&&t.mode!=="unknown"?t.mode:re,z=typeof t?.auto_approve_permissions=="boolea\
n"?t.auto_approve_permissions:!!e?.auto_approve_permissions,fe=J==="codex_cli"?e?.codex_live_owner:null,we=fe?fe.state===
"confirmed"?{interactive_tui:"Interactive terminal active",proxy_app_server:"Headless RAC app-server turn active",rotator_exec:"\
Headless rotator worker active"}[fe.owner_kind]||"Live owner active":fe.state==="multiple"?"Needs attention: multiple ow\
ners":fe.state==="stale"?"Needs attention: stale owner proof":fe.state==="unavailable"?"Ownership startup is not ready":
"No live owner":"Ownership status unavailable",ye=fe?[fe.thread_id?`thread ${fe.thread_id}`:null,fe.turn_id?`turn ${fe.turn_id}`:
null,fe.root_pid?`PID ${fe.root_pid}`:null,fe.reason||null].filter(Boolean).join(" \xB7 "):"",Ce=t?.effort||null,Te=t?.next_send_effort||
"",Le=t?.file_access_scope||"unknown",At=Gl(J,t),le=So(J,t),De=J==="claude"||J==="claude_cli"?Ul:J==="codex_cli"?Zl:J===
"cursor_cli"?eu:J==="antigravity"||J==="antigravity_panel"?Km:J==="gemini"?Ym:[];t?.available_models&&Array.isArray(t.available_models)&&
t.available_models.length>0&&(De=t.available_models.map(O=>typeof O=="string"?{id:O,label:O}:O)),React.useEffect(()=>{v&&
s(v)},[v]);function j(O){!O||O===(ge?U:Q)||a(v,O)}function se(O){!O||O===W||c(v,O)}function Se(O){!O||O===(ge?Te:Ce)||i&&
i(v,O)}function Fe(O){!O||O===$||f&&f(v,O)}function ht(O){z!==!!O&&d&&d(v,!!O)}function en(O,dt=!1){if(!(!O||O===t?.permission_profile)){
if(O==="full-access"&&!dt){S(!0);return}O==="full-access"&&u(t?.permission_profile&&t.permission_profile!=="full-access"?
t.permission_profile:"auto"),S(!1),h?.({permission_profile:O,...dt?{confirm_bypass:!0}:{}})}}return React.createElement(
"div",{className:"settings-panel"},React.createElement("div",{className:"settings-panel-header"},React.createElement("sp\
an",null,"Session Settings"),React.createElement("button",{className:"settings-panel-close",onClick:N,title:"Close"},"\u2715")),
React.createElement("div",{className:"settings-panel-body"},J==="codex_cli"&&React.createElement("div",{className:"setti\
ngs-row","data-testid":"codex-live-owner-status"},React.createElement("span",{className:"settings-label"},"Live owner"),
React.createElement("span",{className:`settings-value${["multiple","stale","unavailable"].includes(fe?.state)?" error":""}`,
title:ye},we)),J==="codex_cli"&&React.createElement("div",{className:"settings-row","data-testid":"codex-headless-send-m\
ode"},React.createElement("span",{className:"settings-label"},"Remote sends"),React.createElement("span",{className:"set\
tings-value",title:t?.send_execution_detail},t?.send_execution_label||"Headless / out-of-process"),React.createElement("\
span",{className:"settings-value small"},"Interactive TUI may stay idle")),V&&React.createElement("div",{className:"sett\
ings-rl-banner"},React.createElement("span",{className:"settings-rl-icon"},"\u26A0"),React.createElement("span",{className:"\
settings-rl-text"},"Rate limited",V!=="unknown"?React.createElement(React.Fragment,null," \u2014 available after ",React.
createElement("strong",null,V)):React.createElement(React.Fragment,null," \u2014 reset time unknown"))),React.createElement(
"div",{className:"settings-row"},React.createElement("span",{className:"settings-label"},ge?"Observed model":"Model"),React.
createElement("div",{className:"settings-model-wrap"},ge?React.createElement("span",{className:`settings-value${Q==="unk\
nown"?" dim":""}`,title:t?.model_provenance?.source||"No exact native metadata observed"},Q):ve.set_model&&De.length>0?React.
createElement("select",{className:"settings-perm-select",value:Q,disabled:w(y),onChange:O=>j(O.target.value)},De.map(O=>React.
createElement("option",{key:O.id,value:O.id},O.label)),J!=="antigravity"&&J!=="gemini"&&!De.some(O=>O.id===Q)&&Q!=="unkn\
own"&&React.createElement("option",{value:Q},Q)):React.createElement("span",{className:`settings-value${Q==="unknown"?" \
dim":""}`},Q),V&&React.createElement("span",{className:"model-rl-badge",title:`Rate limited${V!=="unknown"?` \u2014 resets at\
 ${V}`:""}`},"\u26A0")),y?.status==="ok"&&React.createElement("span",{className:"settings-inline-ok"},"Saved")),ge&&ve.set_model&&
De.length>0&&React.createElement("div",{className:"settings-row"},React.createElement("span",{className:"settings-label"},
"Next send model"),React.createElement("select",{className:"settings-perm-select",value:U,disabled:w(y),onChange:O=>j(O.
target.value)},React.createElement("option",{value:"",disabled:!0},"Choose model\u2026"),De.map(O=>React.createElement("\
option",{key:O.id,value:O.id},O.label))),React.createElement("span",{className:`settings-value small${t?.next_send_model_status===
"failed"?" error":""}`},t?.next_send_model_status||"unset")),(J==="antigravity"||J==="antigravity_panel")&&ie.length>0&&
React.createElement("div",{className:"settings-row",style:{alignItems:"flex-start"}},React.createElement("span",{className:"\
settings-label"},"Quotas"),React.createElement("div",{style:{display:"flex",flexDirection:"column",gap:6,flex:1,minWidth:0}},
e?.available_ai_credits!=null&&React.createElement("span",{className:"settings-value"},"AI credits: ",e.available_ai_credits),
React.createElement("div",{style:{display:"flex",flexWrap:"wrap",gap:6}},ie.map((O,dt)=>{let Wt=O?.percent_used,qn=Hm(O?.
model),Pn=Wt>=90?"#f85149":Wt>=75?"#d29922":"#8b949e",In=!!I&&I===O?.model;return React.createElement("span",{key:O?.model||
`quota-${dt}`,className:"composer-hint",title:O?.refreshes_in?`${O.model} \xB7 resets in ${O.refreshes_in}`:O?.model||"",
style:{color:Pn,border:`1px solid ${In?Pn:"#30363d"}`,borderRadius:999,padding:"2px 8px",background:In?`${Pn}18`:"rgba(1\
10,118,129,0.08)"}},qn," ",Wt!=null?`${Wt}%`:"n/a")})))),(J==="antigravity"||J==="antigravity_panel")&&React.createElement(
"div",{className:"settings-row"},React.createElement("span",{className:"settings-label"},"Mode"),React.createElement("se\
lect",{className:"settings-perm-select",value:$==="unknown"?"Planning":$,disabled:w(K),onChange:O=>Fe(O.target.value)},tu.
map(O=>React.createElement("option",{key:O.id,value:O.id},O.label))),K?.status==="ok"&&React.createElement("span",{className:"\
settings-inline-ok"},"Saved")),Co(J)&&ve.set_mode&&le.length>0&&React.createElement("div",{className:"settings-row"},React.
createElement("span",{className:"settings-label"},"Mode"),React.createElement("select",{className:"settings-perm-select",
value:$==="unknown"?le[0].id:$,disabled:w(K),onChange:O=>Fe(O.target.value)},le.map(O=>React.createElement("option",{key:O.
id,value:O.id},O.label)),$!=="unknown"&&!le.some(O=>O.id===$)&&React.createElement("option",{value:$},$)),K?.status==="o\
k"&&React.createElement("span",{className:"settings-inline-ok"},"Saved")),(J==="claude"||J==="claude_cli"||J==="codex_cl\
i"||J==="cursor_cli"||J==="continue_yolo"||Co(J))&&React.createElement("div",{className:"settings-row"},React.createElement(
"span",{className:"settings-label"},"Permission mode"),ve.permission_mode_change&&At.length>0?React.createElement("selec\
t",{className:"settings-perm-select",value:W==="unknown"?Vm(J):W,disabled:w(E),onChange:O=>se(O.target.value)},At.map(O=>React.
createElement("option",{key:O.value,value:O.value},O.label)),!At.some(O=>O.value===W)&&W!=="unknown"&&React.createElement(
"option",{value:W},W)):React.createElement("span",{className:`settings-value${W==="unknown"?" dim":""}`},W),E?.status===
"ok"&&React.createElement("span",{className:"settings-inline-ok"},"Saved")),J==="codex_cli"&&t?.approval_policy&&React.createElement(
"div",{className:"settings-row"},React.createElement("span",{className:"settings-label"},"Approval policy"),React.createElement(
"span",{className:"settings-value"},t.approval_policy)),J==="claude"&&Ce&&Ce!=="unknown"&&React.createElement("div",{className:"\
settings-row"},React.createElement("span",{className:"settings-label"},"Effort"),React.createElement("span",{className:"\
settings-value"},((t?.available_efforts||[]).find(O=>O.id===Ce)||{}).label||Ce)),(J==="claude_cli"||J==="codex_cli"||J===
"cursor_cli")&&ve.set_effort&&(t?.available_efforts||[]).length>0&&React.createElement("div",{className:"settings-row"},
React.createElement("span",{className:"settings-label"},ge?"Observed effort":"Effort"),ge?React.createElement("span",{className:`\
settings-value${!Ce||Ce==="unknown"?" dim":""}`,title:t?.effort_provenance?.source||"No exact native metadata observed"},
Ce||"unknown"):React.createElement("select",{className:"settings-perm-select",value:Ce||"medium",disabled:w(T),onChange:O=>Se(
O.target.value)},(t.available_efforts||[]).map(O=>React.createElement("option",{key:O.id,value:O.id},O.label))),T?.status===
"ok"&&React.createElement("span",{className:"settings-inline-ok"},"Saved")),ge&&ve.set_effort&&(t?.available_efforts||[]).
length>0&&React.createElement("div",{className:"settings-row"},React.createElement("span",{className:"settings-label"},"\
Next send effort"),React.createElement("select",{className:"settings-perm-select",value:Te,disabled:w(T),onChange:O=>Se(
O.target.value)},React.createElement("option",{value:"",disabled:!0},"Choose effort\u2026"),(t.available_efforts||[]).map(
O=>React.createElement("option",{key:O.id,value:O.id},O.label))),React.createElement("span",{className:`settings-value s\
mall${t?.next_send_effort_status==="failed"?" error":""}`},t?.next_send_effort_status&&t.next_send_effort_status!=="unse\
t"?t.next_send_effort_status:"No override selected")),(J==="codex"||J==="codex-desktop")&&ve.set_codex_config&&React.createElement(
React.Fragment,null,ve.codex_model_change&&(t?.available_models||[]).length>0&&React.createElement("div",{className:"set\
tings-row"},React.createElement("span",{className:"settings-label"},Z?"Next turn model":"Model"),React.createElement("se\
lect",{className:"settings-perm-select",value:t?.model_id||"unknown",disabled:w(y)||!he,onChange:O=>{h?.({model_id:O.target.
value})}},(t?.available_models||[]).map(O=>React.createElement("option",{key:O.id,value:O.id},O.label)),t?.model_id&&!(t?.
available_models||[]).some(O=>O.id===t.model_id)&&t.model_id!=="unknown"&&React.createElement("option",{value:t.model_id},
t.model_id)),y?.status==="ok"&&React.createElement("span",{className:"settings-inline-ok"},"Saved")),ve.codex_effort_change&&
(t?.available_efforts||[]).length>0&&React.createElement("div",{className:"settings-row"},React.createElement("span",{className:"\
settings-label"},Z?"Next turn effort":"Effort"),React.createElement("select",{className:"settings-perm-select",value:(t?.
effort||"unknown").toLowerCase(),disabled:w(T)||!he,onChange:O=>{h?.({effort:O.target.value})}},(t?.available_efforts||[]).
map(O=>React.createElement("option",{key:O.id,value:O.id},O.label))),T?.status==="ok"&&React.createElement("span",{className:"\
settings-inline-ok"},"Saved")),ve.codex_permission_profile_change&&(t?.available_permission_profiles||[]).length>0&&React.
createElement("div",{className:"settings-row"},React.createElement("span",{className:"settings-label"},"Next turn permis\
sions"),React.createElement("select",{className:"settings-perm-select",value:t?.permission_profile||"unknown",disabled:w(
oe)||!he,onChange:O=>en(O.target.value)},(t?.available_permission_profiles||[]).map(O=>React.createElement("option",{key:O.
id,value:O.id},O.label))),oe?.status==="ok"&&React.createElement("span",{className:"settings-inline-ok"},"Saved")),x&&React.
createElement("div",{className:"settings-bypass-confirmation",role:"alert"},React.createElement("strong",null,"Enable By\
pass permissions?"),React.createElement("span",null,"Full access sets approval policy to Never and sandbox access to dan\
ger-full-access for this Codex conversation."),React.createElement("div",{className:"settings-bypass-actions"},React.createElement(
"button",{type:"button",onClick:()=>S(!1)},"Cancel"),React.createElement("button",{type:"button",className:"danger",onClick:()=>en(
"full-access",!0)},"Enable Full access"))),Z&&t?.bypass_permissions_active&&(R||t?.bypass_restore_profile)&&React.createElement(
"div",{className:"settings-row"},React.createElement("span",{className:"settings-label"},"Bypass permissions"),React.createElement(
"button",{type:"button",className:"settings-restore-safe",disabled:w(oe),onClick:()=>en(R||t.bypass_restore_profile)},"R\
estore previous safe permissions")),Z&&React.createElement(React.Fragment,null,React.createElement("div",{className:"set\
tings-row"},React.createElement("span",{className:"settings-label"},"Approval policy"),React.createElement("span",{className:"\
settings-value"},t?.approval_policy||"Native custom policy")),React.createElement("div",{className:"settings-row"},React.
createElement("span",{className:"settings-label"},"Access / sandbox"),React.createElement("span",{className:"settings-va\
lue"},t?.permission_mode||"Native custom access")),!he&&React.createElement("div",{className:"settings-control-unavailab\
le",role:"status"},t?.controls_unavailable_reason||"Codex controls are unavailable for this conversation.")),ve.codex_access_change&&
(t?.available_access||[]).length>0&&React.createElement("div",{className:"settings-row"},React.createElement("span",{className:"\
settings-label"},"Access"),React.createElement("select",{className:"settings-perm-select",value:t?.permission_mode||"unk\
nown",disabled:w(ne),onChange:O=>{h?.({access_mode:O.target.value})}},(t?.available_access||[]).map(O=>React.createElement(
"option",{key:O.id,value:O.id},O.label)))),ve.codex_speed_change&&(t?.available_speeds||[]).length>0&&React.createElement(
"div",{className:"settings-row"},React.createElement("span",{className:"settings-label"},"Speed"),React.createElement("s\
elect",{className:"settings-perm-select",value:(t?.speed||"standard").toLowerCase(),disabled:w(te),onChange:O=>{h?.({speed:O.
target.value})}},(t?.available_speeds||[]).map(O=>React.createElement("option",{key:O.id,value:O.id},O.label)))),J==="co\
dex-desktop"&&t?.branch&&t.branch!=="unknown"&&React.createElement("div",{className:"settings-row"},React.createElement(
"span",{className:"settings-label"},"Branch"),React.createElement("span",{className:"settings-value"},t.branch)),J==="co\
dex-desktop"&&t?.sandbox_status&&React.createElement("div",{className:"settings-row"},React.createElement("span",{className:"\
settings-label"},"Sandbox"),React.createElement("span",{className:`settings-value${t.sandbox_status.active?"":" dim"}`},
t.sandbox_status.active?"\u{1F7E2}":"\u26AA"," ",t.sandbox_status.label||(t.sandbox_status.active?"Active":"Inactive"))),
J==="codex-desktop"&&(t?.available_workspaces||[]).length>0&&React.createElement("div",{className:"settings-row"},React.
createElement("span",{className:"settings-label"},"Workspace"),React.createElement("select",{className:"settings-perm-se\
lect",value:t?.file_access_scope||"",disabled:w(G),onChange:O=>{b&&b(v,O.target.value)}},(t.available_workspaces||[]).map(
O=>React.createElement("option",{key:O.id,value:O.path||O.id},O.label)))),Ne&&React.createElement("div",{className:"sett\
ings-row"},React.createElement("span",{className:de?.status==="failed"?"settings-error":"settings-inline-ok",role:"statu\
s"},Ne))),(J==="codex"||J==="codex-desktop")&&!ve.set_codex_config&&React.createElement("div",{className:"settings-row"},
React.createElement("span",{className:"settings-label"},"Access"),React.createElement("span",{className:`settings-value${W===
"unknown"?" dim":""}`},W)),Bl(J)&&t?.mode&&t.mode!=="unknown"&&React.createElement("div",{className:"settings-row"},React.
createElement("span",{className:"settings-label"},"Mode"),React.createElement("span",{className:"settings-value"},t.mode)),
ve.auto_approve_permissions_toggle&&React.createElement("div",{className:"settings-row settings-row-checkbox"},React.createElement(
"span",{className:"settings-label"},"Tool Prompts"),React.createElement("label",{className:"settings-checkbox"},React.createElement(
"input",{type:"checkbox",checked:z,disabled:w(H),onChange:O=>ht(O.target.checked)}),React.createElement("span",null,"Aut\
o-approve permission prompts")),H?.status==="ok"&&React.createElement("span",{className:"settings-inline-ok"},"Saved")),
(()=>{let O=Le!=="unknown"?Le:e?.workspace_name||e?.window_title||null;return React.createElement("div",{className:"sett\
ings-row"},React.createElement("span",{className:"settings-label"},"Workspace"),React.createElement("span",{className:`s\
ettings-value small${O?"":" dim"}`,title:O||""},O?Le!=="unknown"&&O.split(/[\\/]/).pop()||O:"\u2014"))})(),Ne&&!(J==="co\
dex"||J==="codex-desktop")&&React.createElement("div",{className:de?.status==="failed"?"settings-error":"settings-inline\
-ok",role:"status"},Ne)),React.createElement("div",{className:"settings-panel-footer"},React.createElement("button",{className:"\
settings-refresh",onClick:()=>{v&&s(v)}},"\u21BB Refresh")))}function lv({chats:e,sessionId:t,onSwitch:n,onNew:s,onClose:a}){
return React.createElement("div",{className:"chat-list-panel"},React.createElement("div",{className:"chat-list-header"},
React.createElement("span",{className:"chat-list-title"},"Conversations"),React.createElement("button",{className:"chat-\
list-new-btn",onClick:s,title:"New conversation"},"+"),React.createElement("button",{className:"chat-list-close-btn",onClick:a,
title:"Close"},"\u2715")),React.createElement("div",{className:"chat-list-body"},!e||e.length===0?React.createElement("d\
iv",{className:"chat-list-empty"},"No conversations found"):e.map((i,c)=>React.createElement("button",{key:i.id||c,className:`\
chat-list-item${i.active?" active":""}`,onClick:()=>n(i.id),title:i.title},React.createElement("span",{className:"chat-l\
ist-item-title"},i.title),i.active&&React.createElement("span",{className:"chat-list-item-active"},"\u25CF")))))}function Il({
items:e,onNavigate:t,onNew:n,onClose:s,embedded:a=!1,loading:i=!1}){let c=Array.isArray(e)?e:[],d=c.filter(g=>g?.kind===
"nav"),f=c.filter(g=>g?.kind==="project"),h=c.filter(g=>!g?.kind||g.kind==="chat"),b=c.filter(g=>g?.kind==="see_all"),N=[],
x=new Map;f.forEach(g=>{let w=g.project_index!=null?`idx:${g.project_index}`:`name:${g.project||g.title||"Project"}`;x.has(
w)||(N.push(w),x.set(w,g.title||g.project||"Project"))}),h.forEach(g=>{let w=g.project_index!=null?`idx:${g.project_index}`:
`name:${g.project||"Other"}`;x.has(w)||(N.push(w),x.set(w,g.project||"Other"))});let S=h.filter(g=>g.project_index==null&&
!g.project);function R(g){return g==="new_conversation"?"New Conversation":g==="conversation_history"?"Conversation Hist\
ory":g==="scheduled_tasks"?"Scheduled Tasks":"Agent Manager"}function u(g,w){return React.createElement("button",{key:g.
id||w,className:`agv2-chat-item${g.active?" active":""}`,type:"button",onClick:()=>t(g.id),title:g.title||"Untitled"},React.
createElement("span",{className:"agv2-chat-title"},g.title||"Untitled"),g.age&&React.createElement("span",{className:"ag\
v2-chat-age"},g.age),g.active&&React.createElement("span",{className:"agv2-chat-active"},"\u25CF"))}let v=React.createElement(
React.Fragment,null,React.createElement("div",{className:"agv2-nav-actions"},(d.length?d:[{id:"__agv2:new_conversation",
action:"new_conversation"},{id:"__agv2:conversation_history",action:"conversation_history"},{id:"__agv2:scheduled_tasks",
action:"scheduled_tasks"}]).map(g=>React.createElement("button",{key:g.id||g.action,className:`agv2-nav-action ${g.action||
""}`,type:"button",onClick:()=>g.action==="new_conversation"?n():t(g.id)},React.createElement("span",{className:"agv2-na\
v-action-icon"},g.action==="new_conversation"?"+":g.action==="scheduled_tasks"?"\u25F7":"\u21BA"),React.createElement("s\
pan",null,g.title||R(g.action))))),React.createElement("div",{className:"agv2-project-list"},N.length===0&&S.length===0?
React.createElement("div",{className:"chat-list-empty"},i?"Loading conversations...":"No projects or conversations found"):
React.createElement(React.Fragment,null,N.map(g=>{let w=x.get(g)||"Project",y=h.filter(T=>(T.project_index!=null?`idx:${T.
project_index}`:`name:${T.project||"Other"}`)===g),E=b.filter(T=>(T.project_index!=null?`idx:${T.project_index}`:`name:${T.
project||"Other"}`)===g);return React.createElement("section",{className:"agv2-project-section",key:g},React.createElement(
"div",{className:"agv2-project-header"},React.createElement("span",{className:"agv2-project-icon"},"\u2302"),React.createElement(
"span",{className:"agv2-project-title"},w)),React.createElement("div",{className:"agv2-project-chats"},y.length===0?React.
createElement("div",{className:"agv2-project-empty"},"No visible conversations"):y.map(u),E.map(T=>React.createElement("\
button",{key:T.id,className:"agv2-see-all",type:"button",onClick:()=>t(T.id)},T.title||"See all"))))}),S.length>0&&React.
createElement("section",{className:"agv2-project-section"},React.createElement("div",{className:"agv2-project-header"},React.
createElement("span",{className:"agv2-project-icon"},"\u2302"),React.createElement("span",{className:"agv2-project-title"},
"Other")),React.createElement("div",{className:"agv2-project-chats"},S.map(u))))));return a?React.createElement("div",{className:"\
agv2-nav-embedded"},v):React.createElement("div",{className:"chat-list-panel agv2-nav-panel"},React.createElement("div",
{className:"chat-list-header"},React.createElement("span",{className:"chat-list-title"},"Antigravity Agent Manager"),React.
createElement("button",{className:"chat-list-new-btn",onClick:n,title:"New conversation"},"+"),React.createElement("butt\
on",{className:"chat-list-close-btn",onClick:s,title:"Close"},"\u2715")),React.createElement("div",{className:"chat-list\
-body agv2-nav-body"},v))}function uv({threads:e,sessionId:t,onSwitch:n,onNew:s,onClose:a,newLabel:i="New thread"}){return React.
createElement("div",{className:"chat-list-panel"},React.createElement("div",{className:"chat-list-header"},React.createElement(
"span",{className:"chat-list-title"},"Threads"),React.createElement("button",{className:"chat-list-new-btn",onClick:s,title:i},
"+"),React.createElement("button",{className:"chat-list-close-btn",onClick:a,title:"Close"},"\u2715")),React.createElement(
"div",{className:"chat-list-body"},!e||e.length===0?React.createElement("div",{className:"chat-list-empty"},"No threads \
found"):e.map((c,d)=>React.createElement("button",{key:c.cache_key||c.id||d,className:`chat-list-item${c.active?" active":
""}`,onClick:()=>n(c.id),title:c.title},React.createElement("span",{className:"chat-list-item-title"},c.title),c.age&&React.
createElement("span",{className:"chat-list-item-age"},c.age),c.active&&React.createElement("span",{className:"chat-list-\
item-active"},"\u25CF")))))}function dv({threads:e,activeThreadId:t,onSwitch:n,onNew:s,onOpenHistory:a,showDraftTab:i=!1,
newLabel:c="New chat"}){return React.createElement("div",{className:"thread-tabs-bar"},React.createElement("div",{className:"\
thread-tabs-scroll"},i&&React.createElement("button",{className:"thread-tab active draft",type:"button",title:c},React.createElement(
"span",{className:"thread-tab-title"},c)),(e||[]).map((d,f)=>{let h=t?d.id===t:!!d.active;return React.createElement("bu\
tton",{key:d.cache_key||d.id||f,className:`thread-tab${h?" active":""}`,type:"button",title:d.title||"Untitled",onClick:()=>n(
d.id)},React.createElement("span",{className:"thread-tab-title"},d.title||"Untitled"),d.age&&React.createElement("span",
{className:"thread-tab-age"},d.age))})),React.createElement("div",{className:"thread-tabs-actions"},React.createElement(
"button",{className:"thread-tabs-btn",type:"button",onClick:a,title:"Show all threads"},"All"),React.createElement("butt\
on",{className:"thread-tabs-btn accent",type:"button",onClick:s,title:c},"+")))}function pv({branchData:e,sessionId:t,currentBranch:n,
onSwitch:s,onCreate:a,onClose:i}){let[c,d]=React.useState(""),[f,h]=React.useState(!1),[b,N]=React.useState(""),x=e?.branches||
[],S=e?.current||n||"",R=c?x.filter(u=>u.toLowerCase().includes(c.toLowerCase())):x;return React.createElement("div",{className:"\
branch-selector-panel"},React.createElement("div",{className:"branch-selector-header"},React.createElement("span",{className:"\
branch-selector-title"},"Branches"),React.createElement("button",{className:"chat-list-close-btn",onClick:i,title:"Close"},
"\u2715")),React.createElement("div",{className:"branch-selector-search"},React.createElement("input",{type:"text",className:"\
branch-search-input",placeholder:"Search branches\u2026",value:c,onChange:u=>d(u.target.value),autoFocus:!0})),React.createElement(
"div",{className:"branch-selector-body"},R.length===0&&!f&&React.createElement("div",{className:"chat-list-empty"},"No b\
ranches found"),R.map((u,v)=>React.createElement("button",{key:u,className:`branch-item${u===S?" active":""}`,onClick:()=>{
u!==S&&s(u)},title:u},React.createElement("span",{className:"branch-item-icon"},u===S?"\u2713":""),React.createElement("\
span",{className:"branch-item-name"},u)))),React.createElement("div",{className:"branch-selector-footer"},f?React.createElement(
"form",{className:"branch-create-form",onSubmit:u=>{u.preventDefault(),b.trim()&&(a(b.trim()),h(!1),N(""))}},React.createElement(
"input",{type:"text",className:"branch-create-input",placeholder:"new-branch-name",value:b,onChange:u=>N(u.target.value),
autoFocus:!0}),React.createElement("button",{type:"submit",className:"branch-create-submit",disabled:!b.trim()},"Create"),
React.createElement("button",{type:"button",className:"branch-create-cancel",onClick:()=>{h(!1),N("")}},"\u2715")):React.
createElement("button",{className:"branch-create-btn",onClick:()=>h(!0)},"+ Create and checkout new branch")))}function mv({
entries:e,canRead:t,canInput:n,onClose:s,onRefresh:a,onSend:i,controlResults:c}){let[d,f]=ce(""),[h,b]=ce(null),N=h?c?.[h]:
null;function x(S){S.preventDefault();let R=d.trim();!R||!i||(b(i(R)),f(""))}return React.createElement("div",{className:"\
terminal-viewer"},React.createElement("div",{className:"terminal-viewer-header"},React.createElement("span",{className:"\
terminal-viewer-title"},"Terminal"),t&&React.createElement("button",{className:"terminal-viewer-refresh",onClick:a,title:"\
Refresh"},"\u21BB"),React.createElement("button",{className:"terminal-viewer-close",onClick:s,title:"Close"},"\u2715")),
t?React.createElement("div",{className:"terminal-viewer-body"},!e||e.length===0?React.createElement("div",{className:"te\
rminal-viewer-empty"},"No terminal output captured"):e.map((S,R)=>React.createElement("div",{key:R,className:"terminal-e\
ntry"},S.command&&React.createElement("div",{className:"terminal-command"},"$ ",S.command),React.createElement("pre",{className:"\
terminal-output"},S.output)))):React.createElement("div",{className:"terminal-viewer-empty"},"Terminal output is unavail\
able for this harness."),n&&React.createElement("form",{className:"terminal-input-form",onSubmit:x},React.createElement(
"input",{className:"terminal-input",type:"text",value:d,onChange:S=>f(S.target.value),placeholder:"Enter a command in th\
is session's terminal","aria-label":"Terminal command"}),React.createElement("button",{className:"terminal-input-send",type:"\
submit",disabled:!d.trim()},"Run"),h&&React.createElement("div",{className:`terminal-input-status ${N?.result||"pending"}`,
role:"status"},N?N.result==="ok"?"Command sent":`Command failed: ${N.error?.message||N.error?.code||"unknown error"}`:"C\
ommand pending\u2026")))}function fv({entries:e,onClose:t,onRefresh:n,onAccept:s,onReject:a}){let i=c=>{let d=String(c||
"").trim();return d?d.split(/\s+/).filter(Boolean).map(f=>({text:f,cls:f.startsWith("+")?"add":f.startsWith("-")?"del":"\
neutral"})):[]};return React.createElement("div",{className:"diff-viewer"},React.createElement("div",{className:"diff-vi\
ewer-header"},React.createElement("span",{className:"diff-viewer-title"},"File Changes"),React.createElement("button",{className:"\
diff-viewer-refresh",onClick:n,title:"Refresh"},"\u21BB"),React.createElement("button",{className:"diff-viewer-close",onClick:t,
title:"Close"},"\u2715")),React.createElement("div",{className:"diff-viewer-body"},!e||e.length===0?React.createElement(
"div",{className:"diff-viewer-empty"},"No file changes detected"):e.map((c,d)=>React.createElement("div",{key:d,className:"\
diff-entry"},c.file&&React.createElement("div",{className:"diff-file-header"},React.createElement("span",null,c.file||c.
path),(c.can_accept||c.can_reject)&&s&&a&&React.createElement("span",{className:"diff-file-actions"},c.can_accept&&React.
createElement("button",{type:"button",className:"diff-action-accept",onClick:()=>s(c.id||c.path)},"Accept"),c.can_reject&&
React.createElement("button",{type:"button",className:"diff-action-reject",onClick:()=>a(c.id||c.path)},"Reject"))),c.summary&&
React.createElement("div",{className:"diff-file-summary"},i(c.summary).map((f,h)=>React.createElement("span",{key:h,className:`\
diff-file-summary-chip diff-file-summary-chip-${f.cls}`},f.text))),c.content?React.createElement("pre",{className:"diff-\
content"},c.content.split(`
`).map((f,h)=>{let b=f.startsWith("+")?"diff-add":f.startsWith("-")?"diff-del":f.startsWith("@@")?"diff-hunk":"";return React.
createElement("span",{key:h,className:b},f,`
`)})):!c.summary&&React.createElement("pre",{className:"diff-content"},"No content")))))}var Ol={directory:"\u{1F4C1}",md:"\
\u{1F4C4}",txt:"\u{1F4C4}",json:"\u{1F4CB}",js:"\u{1F4DC}",jsx:"\u{1F4DC}",ts:"\u{1F4DC}",tsx:"\u{1F4DC}",py:"\u{1F40D}",
html:"\u{1F310}",css:"\u{1F3A8}",yml:"\u2699",yaml:"\u2699",toml:"\u2699",sh:"\u26A1",bat:"\u26A1",ps1:"\u26A1",env:"\u{1F512}",
lock:"\u{1F512}",png:"\u{1F5BC}",jpg:"\u{1F5BC}",gif:"\u{1F5BC}",svg:"\u{1F5BC}",default:"\u{1F4C4}"};function gv(e){if(e.
type==="directory")return Ol.directory;let t=e.name.split(".").pop().toLowerCase();return Ol[t]||Ol.default}function hv(e){
return e==null?"":e<1024?`${e} B`:e<1024*1024?`${(e/1024).toFixed(1)} KB`:`${(e/(1024*1024)).toFixed(1)} MB`}var _v=new Set(
["md","txt","json","js","jsx","ts","tsx","py","html","css","yml","yaml","toml","sh","bat","ps1","cfg","conf","ini","xml",
"csv","log","env","gitignore","dockerignore","sql","rs","go","java","c","cpp","h","hpp","rb","php","swift","kt","scala",
"r","lua","vim","zsh","bash","fish"]);function Tm(e){let t=e.split(".").pop().toLowerCase();return _v.has(t)||e.startsWith(
".")}function bv(e){return e.toLowerCase().endsWith(".md")}function vv({path:e,content:t,truncated:n,onBack:s}){let a=React.
useMemo(()=>{if(!t)return"";try{let d=marked.parse(t);return DOMPurify.sanitize(d)}catch{return`<pre>${DOMPurify.sanitize(
t)}</pre>`}},[t]),i=React.useRef(null);React.useEffect(()=>{i.current&&i.current.querySelectorAll("pre code").forEach(d=>{
hljs.highlightElement(d)})},[a]);let c=e?e.split("/").pop().split("\\").pop():"File";return React.createElement("div",{className:"\
file-viewer"},React.createElement("div",{className:"file-viewer-header"},React.createElement("button",{className:"file-v\
iewer-back",onClick:s,title:"Back to files"},"\u2190"),React.createElement("span",{className:"file-viewer-title",title:e},
c),n&&React.createElement("span",{className:"file-viewer-truncated"},"truncated")),React.createElement("div",{className:"\
file-viewer-body markdown-body",ref:i,dangerouslySetInnerHTML:{__html:a}}))}function yv({path:e,content:t,truncated:n,onBack:s}){
let a=e?e.split("/").pop().split("\\").pop():"File",i=a.split(".").pop().toLowerCase(),c=React.useMemo(()=>{if(!t)return"";
try{return i&&hljs.getLanguage(i)?hljs.highlight(t,{language:i}).value:hljs.highlightAuto(t).value}catch{return DOMPurify.
sanitize(t)}},[t,i]);return React.createElement("div",{className:"file-viewer"},React.createElement("div",{className:"fi\
le-viewer-header"},React.createElement("button",{className:"file-viewer-back",onClick:s,title:"Back to files"},"\u2190"),
React.createElement("span",{className:"file-viewer-title",title:e},a),n&&React.createElement("span",{className:"file-vie\
wer-truncated"},"truncated")),React.createElement("div",{className:"file-viewer-body"},React.createElement("pre",{className:"\
file-viewer-code"},React.createElement("code",{dangerouslySetInnerHTML:{__html:c}}))))}function kv(e,t){let n=hr(e||"text"),s=Math.max(...String(t||"").match(/`+/g)?.map(i=>i.length)||[0]),a="`".repeat(Math.
max(3,s+1));return`${a}${n}
${t||""}
${a}`}function wv({sessionId:e,filePath:t,fileContents:n,onClose:s}){let a=`${e}:${t}`,i=n[a],c=i?.content||"",d=i?.truncated||
!1,f=React.useMemo(()=>kv(t,c),[t,c]);return React.createElement("div",{className:"transcript-inline-preview"},React.createElement(
"div",{className:"transcript-inline-preview-header"},React.createElement("span",{className:"transcript-inline-preview-ti\
tle",title:t},t),d&&React.createElement("span",{className:"file-viewer-truncated"},"truncated"),React.createElement("but\
ton",{className:"transcript-inline-preview-close",onClick:s,title:"Collapse"},"Collapse")),i?React.createElement(yr,{content:f,
monospace:!0}):React.createElement("div",{className:"transcript-file-loading"},React.createElement("div",null,"Loading f\
ile preview...")))}function Nv({sessionId:e,listing:t,fileContents:n,onNavigate:s,onOpenFile:a,onClose:i,onRefresh:c,viewingFile:d,
onBackToListing:f}){if(d){let x=`${e}:${d}`,S=n[x],R=S?.content||"",u=S?.truncated||!1;return bv(d)?React.createElement(
vv,{path:d,content:R,truncated:u,onBack:f}):React.createElement(yv,{path:d,content:R,truncated:u,onBack:f})}let h=t?.entries||
[],b=t?.path||".",N=b==="."?[]:b.replace(/\\/g,"/").split("/").filter(Boolean);return React.createElement("div",{className:"\
file-browser"},React.createElement("div",{className:"file-browser-header"},React.createElement("span",{className:"file-b\
rowser-title"},"Files"),React.createElement("button",{className:"file-browser-refresh",onClick:c,title:"Refresh"},"\u21BB"),
React.createElement("button",{className:"file-browser-close",onClick:i,title:"Close"},"\u2715")),React.createElement("di\
v",{className:"file-browser-breadcrumbs"},React.createElement("button",{className:"breadcrumb-item",onClick:()=>s(".")},
"root"),N.map((x,S)=>{let R=N.slice(0,S+1).join("/");return React.createElement(React.Fragment,{key:R},React.createElement(
"span",{className:"breadcrumb-sep"},"/"),React.createElement("button",{className:"breadcrumb-item",onClick:()=>s(R)},x))})),
React.createElement("div",{className:"file-browser-body"},h.length===0?React.createElement("div",{className:"file-browse\
r-empty"},"Empty directory"):React.createElement("div",{className:"file-browser-list"},b!=="."&&React.createElement("div",
{className:"file-browser-entry",onClick:()=>{let x=N.slice(0,-1).join("/")||".";s(x)}},React.createElement("span",{className:"\
file-entry-icon"},"\u{1F4C1}"),React.createElement("span",{className:"file-entry-name"},"..")),h.map(x=>React.createElement(
"div",{key:x.name,className:`file-browser-entry${x.type==="directory"?" is-dir":""}${Tm(x.name)?" is-viewable":""}`,onClick:()=>{
if(x.type==="directory"){let S=b==="."?x.name:`${b}/${x.name}`;s(S)}else if(Tm(x.name)){let S=b==="."?x.name:`${b}/${x.name}`;
a(S)}}},React.createElement("span",{className:"file-entry-icon"},gv(x)),React.createElement("span",{className:"file-entr\
y-name"},x.name),React.createElement("span",{className:"file-entry-meta"},x.type==="file"&&hv(x.size)))))))}var Sv={daily:"\
Daily",weekdays:"Weekdays",weekly:"Weekly",custom:"Custom"},Wl={"Status reports":"\u{1F4CA}","Release prep":"\u{1F680}",
"Code quality":"\u{1F50D}",Documentation:"\u{1F4DD}",General:"\u2699"};function Cv({automation:e,onEdit:t,onRun:n,onToggle:s}){
let a=Wl[e.category]||"\u2699",i=Sv[e.schedule]||e.schedule,c=Ln[e.target_agent_type]||jl;return React.createElement("di\
v",{className:`automation-card${e.enabled?"":" disabled"}`,onClick:()=>t(e)},React.createElement("div",{className:"autom\
ation-card-icon"},a),React.createElement("div",{className:"automation-card-body"},React.createElement("div",{className:"\
automation-card-name"},e.name),e.description&&React.createElement("div",{className:"automation-card-desc"},e.description)),
React.createElement("div",{className:"automation-card-meta"},React.createElement("span",{className:"automation-card-agen\
t",style:{color:c.color},title:c.name},c.abbr),React.createElement("span",{className:"automation-card-schedule"},i," ",String(
e.cron_hour).padStart(2,"0"),":",String(e.cron_minute).padStart(2,"0"))),React.createElement("div",{className:"automatio\
n-card-actions",onClick:d=>d.stopPropagation()},React.createElement("button",{className:"automation-run-btn",title:"Run \
now",onClick:()=>n(e)},"\u25B6"),React.createElement("button",{className:`automation-toggle-btn${e.enabled?" on":""}`,title:e.
enabled?"Disable":"Enable",onClick:()=>s(e)},e.enabled?"\u25CF":"\u25CB")))}function xv({automation:e,sessions:t,onSave:n,
onDelete:s,onClose:a}){let i=!e?.id,[c,d]=ce({name:e?.name||"",description:e?.description||"",category:e?.category||"Gen\
eral",prompt:e?.prompt||"",schedule:e?.schedule||"daily",cron_hour:e?.cron_hour??9,cron_minute:e?.cron_minute??0,cron_days:e?.
cron_days||[1,2,3,4,5],target_agent_type:e?.target_agent_type||"claude",target_session:e?.target_session||"",enabled:e?.
enabled!==!1}),[f,h]=ce(!1);function b(R,u){d(v=>({...v,[R]:u}))}function N(R){d(u=>{let v=u.cron_days.includes(R)?u.cron_days.
filter(g=>g!==R):[...u.cron_days,R].sort();return{...u,cron_days:v}})}async function x(R){R.preventDefault(),!(!c.name.trim()||
!c.prompt.trim())&&(h(!0),await n({...c,target_session:c.target_session||null}),h(!1))}let S=["Sun","Mon","Tue","Wed","T\
hu","Fri","Sat"];return React.createElement("div",{className:"automation-modal-overlay",onClick:a},React.createElement("\
div",{className:"automation-modal",onClick:R=>R.stopPropagation()},React.createElement("div",{className:"automation-moda\
l-header"},React.createElement("span",null,i?"New Automation":"Edit Automation"),React.createElement("button",{className:"\
automation-modal-close",onClick:a},"\u2715")),React.createElement("form",{className:"automation-modal-form",onSubmit:x},
React.createElement("label",null,React.createElement("span",null,"Name"),React.createElement("input",{type:"text",value:c.
name,onChange:R=>b("name",R.target.value),placeholder:"e.g. Daily standup summary",required:!0})),React.createElement("l\
abel",null,React.createElement("span",null,"Description"),React.createElement("input",{type:"text",value:c.description,onChange:R=>b(
"description",R.target.value),placeholder:"Brief description (optional)"})),React.createElement("label",null,React.createElement(
"span",null,"Category"),React.createElement("select",{value:c.category,onChange:R=>b("category",R.target.value)},Object.
keys(Wl).map(R=>React.createElement("option",{key:R,value:R},Wl[R]," ",R)))),React.createElement("label",null,React.createElement(
"span",null,"Prompt"),React.createElement("textarea",{rows:4,value:c.prompt,onChange:R=>b("prompt",R.target.value),placeholder:"\
The prompt to send to the agent...",required:!0})),React.createElement("div",{className:"automation-modal-row"},React.createElement(
"label",{className:"half"},React.createElement("span",null,"Target Agent"),React.createElement("select",{value:c.target_agent_type,
onChange:R=>b("target_agent_type",R.target.value)},Object.entries(Ln).map(([R,u])=>React.createElement("option",{key:R,value:R},
u.name)))),React.createElement("label",{className:"half"},React.createElement("span",null,"Specific Session (optional)"),
React.createElement("select",{value:c.target_session,onChange:R=>b("target_session",R.target.value)},React.createElement(
"option",{value:""},"Any matching session"),(t||[]).map(R=>{let u=typeof R=="string"?R:R?.session_id,v=$r(R);return React.
createElement("option",{key:u,value:u},v.name,": ",nd(u)||u)})))),React.createElement("div",{className:"automation-modal\
-row"},React.createElement("label",{className:"third"},React.createElement("span",null,"Schedule"),React.createElement("\
select",{value:c.schedule,onChange:R=>b("schedule",R.target.value)},React.createElement("option",{value:"daily"},"Daily"),
React.createElement("option",{value:"weekdays"},"Weekdays"),React.createElement("option",{value:"weekly"},"Weekly"),React.
createElement("option",{value:"custom"},"Custom days"))),React.createElement("label",{className:"third"},React.createElement(
"span",null,"Hour"),React.createElement("input",{type:"number",min:0,max:23,value:c.cron_hour,onChange:R=>b("cron_hour",
parseInt(R.target.value)||0)})),React.createElement("label",{className:"third"},React.createElement("span",null,"Minute"),
React.createElement("input",{type:"number",min:0,max:59,value:c.cron_minute,onChange:R=>b("cron_minute",parseInt(R.target.
value)||0)}))),(c.schedule==="custom"||c.schedule==="weekly")&&React.createElement("div",{className:"automation-days-row"},
React.createElement("span",null,"Days:"),S.map((R,u)=>React.createElement("button",{key:u,type:"button",className:`autom\
ation-day-btn${c.cron_days.includes(u)?" active":""}`,onClick:()=>N(u)},R))),React.createElement("div",{className:"autom\
ation-modal-footer"},!i&&React.createElement("button",{type:"button",className:"automation-delete-btn",onClick:()=>s(e)},
"Delete"),React.createElement("div",{style:{flex:1}}),React.createElement("button",{type:"button",className:"automation-\
cancel-btn",onClick:a},"Cancel"),React.createElement("button",{type:"submit",className:"automation-save-btn",disabled:f||
!c.name.trim()||!c.prompt.trim()},f?"Saving...":i?"Create":"Save")))))}function Av({sessions:e,onBack:t}){let[n,s]=ce([]),
[a,i]=ce(!0),[c,d]=ce(null),[f,h]=ce("");function b(g){h(g),setTimeout(()=>h(""),3e3)}async function N(){try{let g=await fetch(
"/api/automations");if(!g.ok)throw new Error("Failed to fetch");let w=await g.json();s(w.automations||[])}catch{b("Faile\
d to load automations")}finally{i(!1)}}Me(()=>{N()},[]);async function x(g){let w=!c?.id,y=w?"/api/automations":`/api/au\
tomations/${c.id}`,E=w?"POST":"PUT";try{if(!(await fetch(y,{method:E,headers:{"Content-Type":"application/json"},body:JSON.
stringify(g)})).ok)throw new Error("Save failed");b(w?"Automation created":"Automation updated"),d(null),N()}catch{b("Fa\
iled to save automation")}}async function S(g){if(window.confirm(`Delete "${g.name}"?`))try{await fetch(`/api/automation\
s/${g.id}`,{method:"DELETE"}),b("Automation deleted"),d(null),N()}catch{b("Failed to delete")}}async function R(g){try{let w=await fetch(
`/api/automations/${g.id}/run`,{method:"POST"}),y=await w.json();w.ok?b(`Running "${g.name}"...`):b(y.error||"Failed to \
run")}catch{b("Failed to run automation")}}async function u(g){try{await fetch(`/api/automations/${g.id}`,{method:"PUT",
headers:{"Content-Type":"application/json"},body:JSON.stringify({enabled:!g.enabled})}),N()}catch{b("Failed to toggle")}}
let v={};for(let g of n){let w=g.category||"General";v[w]||(v[w]=[]),v[w].push(g)}return React.createElement("div",{className:"\
automations-view"},React.createElement("div",{className:"automations-header"},React.createElement("button",{className:"a\
utomations-back",onClick:t,title:"Back to sessions"},"\u2190"),React.createElement("div",{className:"automations-header-\
text"},React.createElement("h2",null,"Automations"),React.createElement("p",null,"Automate work by sending scheduled pro\
mpts to your agents.")),React.createElement("button",{className:"automations-new-btn",onClick:()=>d({})},"+ New automati\
on")),a?React.createElement("div",{className:"automations-loading"},"Loading automations..."):n.length===0?React.createElement(
"div",{className:"automations-empty"},React.createElement("div",{className:"automations-empty-icon"},"\u2699"),React.createElement(
"div",{className:"automations-empty-text"},"No automations yet"),React.createElement("div",{className:"automations-empty\
-sub"},"Create your first automation to schedule recurring prompts to your agents."),React.createElement("button",{className:"\
automations-new-btn",onClick:()=>d({})},"+ New automation")):React.createElement("div",{className:"automations-body"},Object.
entries(v).map(([g,w])=>React.createElement("div",{key:g,className:"automations-category"},React.createElement("h3",{className:"\
automations-category-title"},g),React.createElement("div",{className:"automations-card-grid"},w.map(y=>React.createElement(
Cv,{key:y.id,automation:y,onEdit:d,onRun:R,onToggle:u})))))),c!==null&&React.createElement(xv,{automation:c?.id?c:null,sessions:e,
onSave:x,onDelete:S,onClose:()=>d(null)}),f&&React.createElement("div",{className:"automations-toast"},f))}function Rv({
view:e,onShow:t}){if(!e?.visible)return null;let n=Array.isArray(e.status_rows)?e.status_rows:[],s=Array.isArray(e.detail_rows)?
e.detail_rows:[],a=e.status||n.find(i=>i.label==="Status")?.value||"";return React.createElement("aside",{className:"cod\
ex-automation-pane","aria-label":"Codex automation"},React.createElement("div",{className:"codex-automation-pane-header"},
React.createElement("div",{className:"codex-automation-pane-icon"},"o"),React.createElement("div",{className:"codex-auto\
mation-pane-title"},e.title||"Automation")),e.description&&React.createElement("div",{className:"codex-automation-pane-d\
esc"},e.description),(n.length>0||a)&&React.createElement("div",{className:"codex-automation-pane-section"},React.createElement(
"div",{className:"codex-automation-pane-section-title"},"Status"),n.length>0?n.map((i,c)=>React.createElement("div",{key:`${i.
label}-${c}`,className:"codex-automation-pane-row"},React.createElement("span",null,i.label),React.createElement("strong",
{className:i.label==="Status"&&/active/i.test(i.value)?"active":""},i.value))):React.createElement("div",{className:"cod\
ex-automation-pane-row"},React.createElement("span",null,"Status"),React.createElement("strong",null,a))),s.length>0&&React.
createElement("div",{className:"codex-automation-pane-section"},React.createElement("div",{className:"codex-automation-p\
ane-section-title"},"Details"),s.map((i,c)=>React.createElement("div",{key:`${i.label}-${c}`,className:"codex-automation\
-pane-row"},React.createElement("span",null,i.label),React.createElement("strong",null,i.value)))),e.action_label&&React.
createElement("button",{className:"codex-automation-pane-action",onClick:t},e.action_label))}function Rr(e){return new Intl.
NumberFormat([],{notation:"compact",maximumFractionDigits:1}).format(Math.max(0,Number(e)||0))}function Mv({cost:e,detailState:t,
onRequestDetail:n}){let[s,a]=React.useState(1),[i,c]=React.useState(""),d=React.useMemo(()=>pp(e,{days:s,project:i}),[e,
s,i]),f=t?.status==="ready"?t.detail:null,h=!!f&&Number(f.query?.days)===s&&String(f.query?.project||"")===i&&(!e?.generatedAt||
String(f.generated_at||"")===e.generatedAt),b=t?.status==="loading"&&Number(t.query?.days)===s&&String(t.query?.project||
"")===i&&String(t.query?.cursor||"0")==="0",N=h&&String(f.pagination?.cursor||"0")==="0",x=h?{costUsd:Math.max(0,Number(
f.summary?.cost_usd)||0),records:Math.max(0,Number(f.summary?.records)||0),tokens:{input:Math.max(0,Number(f.summary?.tokens?.
input)||0),cached:Math.max(0,Number(f.summary?.tokens?.cached)||0),output:Math.max(0,Number(f.summary?.tokens?.output)||
0)},byModel:Array.isArray(f.summary?.by_model)?f.summary.by_model:[],byDay:Array.isArray(f.summary?.by_day)?f.summary.by_day:
[]}:d;if(React.useEffect(()=>{!e?.detail?.truncated||!n||b||N||n({days:s,project:i,cursor:"0",pageSize:e.detail.pageSize||
256})},[e?.detail?.truncated,e?.detail?.pageSize,e?.generatedAt,s,i,n]),!e)return null;let S=(["ready","partial","stale"].
includes(e.status)||e.status==="scanning"&&!!e.lastGoodGeneratedAt)&&e.costUsd!=null&&e.records!=null&&e.tokens.input!=null&&
e.tokens.cached!=null&&e.tokens.output!=null,R={"not-started":["Not scanned yet","The local cost scan has not completed."],
idle:["Not scanned yet","The local cost scan has not completed."],scanning:["Scanning local history","Provider quota rem\
ains available while cost files are scanned."],error:["Cost scan unavailable","The last cost payload failed its bounded \
structural contract. Provider quota is still current."],unavailable:["Cost scan unavailable","Local cost sources are una\
vailable. Provider quota is still current."],cancelled:["Cost scan cancelled","No zero total is reported because the sca\
n did not complete."]}[e.status]||["Cost data pending","Waiting for an authoritative local cost scan."];if(!S)return React.
createElement("section",{className:"usage-cost-panel","aria-labelledby":"usage-cost-heading"},React.createElement("div",
{className:"usage-cost-heading"},React.createElement("span",null,React.createElement("h3",{id:"usage-cost-heading"},"Loc\
al estimated API-equivalent cost"),React.createElement("small",null,"Separate from subscription quota")),React.createElement(
"span",{className:`usage-cost-status ${e.status}`},e.status)),React.createElement("div",{className:"usage-cost-state",role:"\
status"},React.createElement("strong",null,R[0]),React.createElement("span",null,R[1]),e.reasonCode&&React.createElement(
"small",null,"Reason: ",e.reasonCode,e.reasonPath?` (${e.reasonPath})`:"")),React.createElement("div",{className:"usage-\
cost-scan"},Number.isFinite(Number(e.scan.files_complete))?`Incremental local JSONL scan - ${e.scan.files_complete}/${e.
scan.files_total||0} files`:"Incremental local JSONL scan has not reported file progress."));let u=[...new Set(e.byProject.
map(y=>y.project).filter(Boolean))].sort(),v=[...x?.byModel||[]].sort((y,E)=>E.cost_usd-y.cost_usd).slice(0,12),g=[...x?.
byDay||[]].sort((y,E)=>y.day.localeCompare(E.day)),w=Math.max(1e-6,...g.map(y=>Number(y.cost_usd)||0));return React.createElement(
"section",{className:"usage-cost-panel","aria-labelledby":"usage-cost-heading"},React.createElement("div",{className:"us\
age-cost-heading"},React.createElement("span",null,React.createElement("h3",{id:"usage-cost-heading"},"Local estimated A\
PI-equivalent cost"),React.createElement("small",null,"Separate from subscription quota \xB7 pricing ",e.catalogVersion||
"unavailable")),React.createElement("span",{className:`usage-cost-status ${e.status}`},e.status)),React.createElement("d\
iv",{className:"usage-cost-controls"},React.createElement("label",null,"Range",React.createElement("select",{value:s,onChange:y=>a(
Number(y.target.value))},[1,7,30,90,365].map(y=>React.createElement("option",{key:y,value:y},y===1?"Today":`${y} days`)))),
React.createElement("label",null,"Project",React.createElement("select",{value:i,onChange:y=>c(y.target.value)},React.createElement(
"option",{value:""},"All projects"),u.map(y=>React.createElement("option",{key:y,value:y},y))))),React.createElement("di\
v",{className:"usage-cost-summary"},React.createElement("span",null,React.createElement("strong",null,"$",(x?.costUsd||0).
toFixed(2)),React.createElement("small",null,"estimated cost")),React.createElement("span",null,React.createElement("str\
ong",null,Rr(x?.tokens.input)),React.createElement("small",null,"input tokens")),React.createElement("span",null,React.createElement(
"strong",null,Rr(x?.tokens.cached)),React.createElement("small",null,"cached tokens")),React.createElement("span",null,React.
createElement("strong",null,Rr(x?.tokens.output)),React.createElement("small",null,"output tokens"))),e.detail?.truncated&&
React.createElement("div",{className:"usage-cost-detail-state",role:"status"},h?`Showing detail rows ${Number(f.pagination?.
cursor||0)+1}-${Number(f.pagination?.cursor||0)+Number(f.pagination?.returned_rows||0)} of ${Number(f.pagination?.total_rows||
0)}.`:t?.status==="error"?"Cost detail is unavailable.":`Loading a bounded detail page for ${e.detail.totalRows} cost-de\
tail rows.`),React.createElement("div",{className:"usage-cost-chart",role:"img","aria-label":`${s}-day estimated cost by\
 day`},(g.length?g:[{day:"No data",cost_usd:0}]).map(y=>React.createElement("span",{key:y.day,title:`${y.day}: $${Number(
y.cost_usd).toFixed(4)}`},React.createElement("i",{style:{height:`${Math.max(3,Number(y.cost_usd)/w*100)}%`}}),React.createElement(
"small",null,y.day.slice(5))))),e.detail?.truncated&&React.createElement("details",{className:"usage-cost-detail-table"},
React.createElement("summary",null,"Cost detail rows"),t?.status==="loading"&&React.createElement("div",{className:"usag\
e-cost-detail-state"},"Loading cost detail\u2026"),t?.status==="error"&&React.createElement("div",{className:"usage-cost\
-detail-state"},"Cost detail unavailable: ",t.error),h&&React.createElement(React.Fragment,null,React.createElement("div",
{className:"usage-cost-detail-pager","aria-label":"Cost detail pagination"},React.createElement("button",{type:"button",
disabled:Number(f.pagination?.cursor||0)<=0,onClick:()=>n({days:s,project:i,cursor:String(Math.max(0,Number(f.pagination.
cursor||0)-Number(f.pagination.page_size||256))),pageSize:f.pagination.page_size||256})},"Previous"),React.createElement(
"span",null,f.pagination.returned_rows," rows \xB7 ",f.pagination.total_rows," total"),React.createElement("button",{type:"\
button",disabled:!f.pagination?.next_cursor,onClick:()=>n({days:s,project:i,cursor:f.pagination.next_cursor,pageSize:f.pagination.
page_size||256})},"Next")),React.createElement("div",{className:"usage-cost-table-wrap"},React.createElement("table",{className:"\
usage-cost-table"},React.createElement("caption",null,"Paginated local cost detail"),React.createElement("thead",null,React.
createElement("tr",null,React.createElement("th",null,"Day"),React.createElement("th",null,"Provider / model"),React.createElement(
"th",null,"Project"),React.createElement("th",null,"Speed"),React.createElement("th",null,"Cost"))),React.createElement(
"tbody",null,(f.rows||[]).map((y,E)=>React.createElement("tr",{key:`${f.pagination.cursor}:${E}`},React.createElement("t\
d",null,y.day),React.createElement("th",{scope:"row"},y.provider_id," \xB7 ",y.model),React.createElement("td",null,y.project),
React.createElement("td",null,y.speed),React.createElement("td",null,"$",Number(y.cost_usd).toFixed(4))))))))),React.createElement(
"div",{className:"usage-cost-table-wrap"},React.createElement("table",{className:"usage-cost-table"},React.createElement(
"caption",null,"Estimated cost and tokens by provider model"),React.createElement("thead",null,React.createElement("tr",
null,React.createElement("th",null,"Provider / model"),React.createElement("th",null,"Input"),React.createElement("th",null,
"Cached"),React.createElement("th",null,"Output"),React.createElement("th",null,"Cost"))),React.createElement("tbody",null,
v.map(y=>React.createElement("tr",{key:`${y.provider_id}:${y.model}`},React.createElement("th",{scope:"row"},y.provider_id===
"openai-codex"?"Codex":"Claude"," \xB7 ",y.model),React.createElement("td",null,Rr(y.input)),React.createElement("td",null,
Rr(y.cached)),React.createElement("td",null,Rr(y.output)),React.createElement("td",null,"$",Number(y.cost_usd).toFixed(4))))))),
e.unknownModels.length>0&&React.createElement("div",{className:"usage-cost-fallbacks"},React.createElement("strong",null,
"Fallback pricing"),e.unknownModels.map(y=>React.createElement("span",{key:`${y.provider_id}:${y.model}`},y.model," \u2192 ",
y.fallback))),React.createElement("div",{className:"usage-cost-scan"},"Incremental local JSONL scan \xB7 ",e.scan.files_complete||
0,"/",e.scan.files_total||0," files \xB7 ",e.records," deduplicated records"))}function Tv({usage:e,refreshReceipt:t,resetReceipt:n,
costDetail:s,onBack:a,onRefresh:i,onWatch:c,onConsumeResetCredit:d,onRequestCostDetail:f}){let h=React.useMemo(()=>fl(e),
[e]),[b,N]=React.useState(Date.now());React.useEffect(()=>{h.collectionState==="not-started"&&i(!1);let u=setInterval(()=>N(
Date.now()),3e4);return()=>clearInterval(u)},[i,h.collectionState]),React.useEffect(()=>(c(!0),()=>c(!1)),[c]);let x=u=>({
fresh:"Fresh",refreshing:"Refreshing",stale:"Stale",auth_required:"Sign in required",rate_limited:"Refresh limited",unavailable:"\
Unavailable"})[u]||"Unavailable",S=h.entries.find(u=>u.providerId==="openai-codex"&&Number(u.resetCredits?.available_count)>
0&&u.windows.some(v=>v.usedPercent>=100)),R=["requested","accepted"].includes(n?.status);return React.createElement("div",
{className:"usage-dashboard","data-testid":"usage-dashboard"},React.createElement("div",{className:"automations-header u\
sage-dashboard-header"},React.createElement("button",{className:"automations-back",onClick:a,title:"Back to sessions"},"\
\u2190"),React.createElement("div",{className:"automations-header-text"},React.createElement("h2",null,"Usage & limits"),
React.createElement("p",null,"Provider-account quotas shared by connected harnesses. Warnings start at 75% used.")),React.
createElement("button",{type:"button",className:"usage-dashboard-refresh",onClick:()=>i(!0),disabled:h.inFlight,"aria-la\
bel":"Refresh provider usage"},h.inFlight?"Refreshing\u2026":"Refresh")),h.collectionState!=="ready"&&React.createElement(
"div",{className:`usage-dashboard-collection-state ${h.collectionState}`,role:"status"},React.createElement("strong",null,
{"not-started":"Provider usage has not been collected yet",refreshing:"Refreshing provider usage",partial:"Some provider\
 usage is unavailable",stale:"Showing last-good provider usage",unavailable:"Provider usage is unavailable"}[h.collectionState]||
"Provider usage is pending"),React.createElement("span",null,"Generation ",h.generation,h.generatedAt?` \xB7 ${Na(h.generatedAt,
b)}`:"")),React.createElement("div",{className:"usage-dashboard-summary","aria-label":"Usage summary"},React.createElement(
"div",null,React.createElement("strong",null,h.summaryAuthoritative?h.summary.providers:"\u2014"),React.createElement("s\
pan",null,"providers")),React.createElement("div",null,React.createElement("strong",null,h.summaryAuthoritative?h.summary.
accounts:"\u2014"),React.createElement("span",null,"accounts")),React.createElement("div",null,React.createElement("stro\
ng",null,h.summaryAuthoritative?h.summary.reporting:"\u2014"),React.createElement("span",null,"reporting")),React.createElement(
"div",{className:h.summary.nearLimit>0?"warning":""},React.createElement("strong",null,h.summaryAuthoritative?h.summary.
nearLimit:"\u2014"),React.createElement("span",null,"near limit")),React.createElement("div",{className:h.summary.exhausted>
0?"critical":""},React.createElement("strong",null,h.summaryAuthoritative?h.summary.exhausted:"\u2014"),React.createElement(
"span",null,"exhausted"))),t&&React.createElement("div",{className:`usage-refresh-receipt ${t.status}`,role:"status"},"R\
efresh ",t.status,t.generation!=null?` \xB7 generation ${t.generation}`:""),S&&React.createElement("div",{className:"usa\
ge-reset-attention",role:"alert","data-testid":"codex-reset-credit-attention"},React.createElement("span",null,React.createElement(
"strong",null,S.resetCredits.available_count," limit reset",S.resetCredits.available_count===1?"":"s"," available \u2014 appl\
y one?"),React.createElement("small",null,"Remote Agent Chat will use Codex's native reset action only after this approv\
al.")),React.createElement("button",{type:"button",onClick:d,disabled:R},R?"Applying\u2026":"Apply one reset")),n&&!["re\
quested"].includes(n.status)&&React.createElement("div",{className:`usage-refresh-receipt ${n.status}`,role:"status","da\
ta-testid":"codex-reset-credit-receipt"},"Reset ",n.status,n.outcome?`: ${n.outcome}`:"",n.error?` (${n.error})`:""),React.
createElement(Mv,{cost:h.estimatedCost,detailState:s,onRequestDetail:f}),React.createElement("div",{className:"usage-das\
hboard-grid"},h.entries.map(u=>{let v=hl(u.credits),g=_l(u.financials),w=u.credits?.resets_at?Sa(u.credits.resets_at,b):
"",y=t?.provider_id===u.providerId?t:null,E=["requested","accepted","coalesced"].includes(y?.status);return React.createElement(
"details",{open:!0,className:`usage-dashboard-card ${u.tone}`,key:u.key,"data-provider-id":u.providerId,"data-account-fi\
ngerprint":u.accountFingerprint},React.createElement("summary",{className:"usage-dashboard-card-summary"},React.createElement(
Bi,{providerId:u.providerId,providerName:u.providerName}),React.createElement("span",{className:"usage-dashboard-card-ti\
tle"},React.createElement("strong",null,u.providerName),React.createElement("span",null,u.accountLabel,u.plan?` \xB7 ${u.
plan}`:"")),React.createElement("span",{className:`usage-dashboard-status ${u.status}`},x(u.status))),React.createElement(
"div",{className:"usage-dashboard-card-body"},React.createElement("div",{className:"usage-dashboard-card-meta"},React.createElement(
"span",null,u.sessionCount," mapped session",u.sessionCount===1?"":"s"),React.createElement("span",null,u.harnessTypes.length>
0?u.harnessTypes.join(", "):"No mapped surfaces"),React.createElement("span",null,u.status==="stale"?`Stale - ${Na(u.capturedAt,
b)}`:Na(u.capturedAt,b)),u.nextRefreshAt&&React.createElement("span",null,"Next refresh ",Sa(u.nextRefreshAt,b)),u.refreshIntervalMs>
0&&React.createElement("span",null,u.watchBoostActive?`Live cadence ${Math.round(u.refreshIntervalMs/1e3)}s`:`Idle caden\
ce ${Math.round(u.refreshIntervalMs/1e3)}s`),React.createElement("button",{type:"button",className:"usage-card-refresh",
onClick:()=>i(!0,u.providerId),disabled:E,"aria-label":`Refresh ${u.providerName} usage now`},E?"Refreshing...":"Refresh\
 now")),y&&React.createElement("div",{className:`usage-refresh-receipt ${y.status}`,role:"status"},"Refresh ",y.status,y.
code?` (${y.code})`:"",y.retry_after_ms?` - retry in ${Math.ceil(y.retry_after_ms/1e3)}s`:""),u.windows.length>0?React.createElement(
"div",{className:"usage-dashboard-windows"},u.windows.map(T=>{let H=T.tone,K=T.resetDescription||Sa(T.resetsAt,b);return React.
createElement("div",{className:`usage-dashboard-window ${H}`,key:T.id},React.createElement("div",{className:"usage-dashb\
oard-window-heading"},React.createElement("span",null,React.createElement("strong",null,T.label),T.modelScope?.label?React.
createElement("small",null,"Model: ",T.modelScope.label):T.scope&&T.scope!==T.label?React.createElement("small",null,T.scope):
null),React.createElement("span",null,React.createElement("strong",null,T.remainingPercent==null?"Unavailable":`${Jt(T.remainingPercent)}\
 left`),React.createElement("small",null,T.usedPercent==null?"No reported value":`${Jt(T.usedPercent)} used`))),T.usedPercent!=
null&&React.createElement("div",{className:"usage-dashboard-meter",role:"progressbar","aria-label":`${u.providerName} ${T.
label}`,"aria-valuetext":`${Jt(T.usedPercent)} used`,"aria-valuemin":"0","aria-valuemax":"100","aria-valuenow":Math.round(
T.visualPercent)},React.createElement("span",{style:{width:`${T.visualPercent}%`}})),React.createElement("div",{className:"\
usage-window-thresholds"},"Warning ",Jt(T.thresholds.warningPercent)," \xB7 Critical ",Jt(T.thresholds.criticalPercent)),
T.pace&&React.createElement("div",{className:`usage-pace ${T.pace.category}`},React.createElement("div",{className:"usag\
e-pace-heading"},React.createElement("span",{className:"usage-pace-category"},T.pace.category),React.createElement("span",
null,"Ideal ",Jt(T.pace.expectedUsedPercent)," \xB7 projected ",Jt(T.pace.projectedUsedPercent))),React.createElement("d\
iv",{className:"usage-pace-chart",role:"img","aria-label":`${T.label} actual ${Jt(T.usedPercent)}, ideal ${Jt(T.pace.expectedUsedPercent)}\
, projected ${Jt(T.pace.projectedUsedPercent)}`},React.createElement("span",{className:"usage-pace-actual",style:{width:`${T.
visualPercent}%`}}),React.createElement("i",{className:"usage-pace-ideal",style:{left:`${Math.min(100,T.pace.expectedUsedPercent)}\
%`}}),React.createElement("i",{className:"usage-pace-projected",style:{left:`${Math.min(100,T.pace.projectedUsedPercent)}\
%`}})),React.createElement("div",{className:"usage-pace-budgets"},Object.entries({Now:"now","+1 hour":"next_hour","+5 ho\
urs":"next_five_hours",Today:"today"}).map(([te,ne])=>React.createElement("span",{key:ne},React.createElement("small",null,
te),React.createElement("strong",null,Jt(T.pace.budgets?.[ne]||0))))),React.createElement("div",{className:"usage-pace-o\
utcome"},T.usedPercent>=100?"Quota is exhausted":T.pace.willLastToReset?"Current pace lasts to reset":`Projected exhaust\
ion ${Sa(T.pace.exhaustionAt,b)}`)),K&&React.createElement("div",{className:"usage-dashboard-reset"},"Resets ",K),React.
createElement("div",{className:"usage-window-provenance"},T.source||u.source,T.provenance?` \xB7 ${T.provenance}`:""))})):
!u.localRuntime&&!u.cloudUsage?React.createElement("div",{className:"usage-dashboard-unavailable"},u.error?.message||"Th\
is provider did not report quota windows."):null,u.cloudUsage&&u.providerId==="ollama-local"&&(u.cloudUsage.subscriptionState===
"active"?React.createElement("div",{className:"usage-dashboard-credit-row","data-testid":"ollama-cloud-usage"},React.createElement(
"span",null,React.createElement("strong",null,"Ollama Cloud"),u.windows.length," quota window",u.windows.length===1?"":"\
s",React.createElement("small",null,Na(u.cloudUsage.capturedAt,b))),React.createElement("span",null,React.createElement(
"strong",null,"Auto-reload"),u.cloudUsage.autoReloadEnabled==null?"Not reported":u.cloudUsage.autoReloadEnabled?"On":"Of\
f",React.createElement("small",null,"Extra usage balance is separate from plan quota"))):u.cloudUsage.subscriptionState===
"none"?React.createElement("div",{className:"usage-dashboard-unavailable","data-testid":"ollama-cloud-no-subscription"},
React.createElement("strong",null,"No cloud subscription")," - local models remain unlimited"):React.createElement("div",
{className:"usage-dashboard-unavailable","data-testid":"ollama-cloud-unavailable"},React.createElement("strong",null,"Cl\
oud usage unavailable")," - ",u.cloudUsage.error?.message||"Open the signed-in Ollama Usage page to expose account quota\
.")),u.localRuntime&&React.createElement("div",{className:"usage-dashboard-credit-row","data-testid":"ollama-local-runti\
me"},React.createElement("span",null,React.createElement("strong",null,"Local runtime"),u.localRuntime.loadedModelsCount,
" loaded / ",u.localRuntime.installedModelsCount," installed",React.createElement("small",null,u.localRuntime.endpointScope.
replace(/_/g," "))),React.createElement("span",null,React.createElement("strong",null,"Request telemetry"),u.localRuntime.
telemetryStatus.replace(/_/g," "),React.createElement("small",null,u.localRuntime.telemetryReason))),u.localRuntime?.latestRequest&&
React.createElement("div",{className:"usage-dashboard-credit-row","data-testid":"ollama-owned-request-metrics"},React.createElement(
"span",null,React.createElement("strong",null,"Latest owned request"),u.localRuntime.latestRequest.model,React.createElement(
"small",null,u.localRuntime.latestRequest.surface.replace(/_/g," ")," - ",Na(u.localRuntime.latestRequest.capturedAt,b))),
React.createElement("span",null,React.createElement("strong",null,"Tokens"),u.localRuntime.latestRequest.promptTokens," \
prompt - ",u.localRuntime.latestRequest.responseTokens," output",React.createElement("small",null,mp(u.localRuntime.latestRequest.
tokensPerSecond))),React.createElement("span",null,React.createElement("strong",null,"Total / load"),vo(u.localRuntime.latestRequest.
totalDurationNs)," / ",vo(u.localRuntime.latestRequest.loadDurationNs),React.createElement("small",null,"terminal respon\
se metrics")),React.createElement("span",null,React.createElement("strong",null,"Prompt / eval"),vo(u.localRuntime.latestRequest.
promptEvalDurationNs)," / ",vo(u.localRuntime.latestRequest.evalDurationNs),React.createElement("small",null,u.localRuntime.
observedRequestCount," owned receipt",u.localRuntime.observedRequestCount===1?"":"s"))),g.length>0&&React.createElement(
"div",{className:"usage-dashboard-credit-row usage-dashboard-financial-row"},g.map(T=>React.createElement("span",{key:T.
id},React.createElement("strong",null,T.label),T.value))),(v||u.resetCredits)&&React.createElement("div",{className:"usa\
ge-dashboard-credit-row"},v&&React.createElement("span",null,React.createElement("strong",null,"Credits"),v,w&&React.createElement(
"small",null,"Resets ",w)),u.resetCredits&&React.createElement("span",null,React.createElement("strong",null,"Rate-limit\
 resets"),u.resetCredits.available_count||0," available")),Array.isArray(u.resetCredits?.details)&&u.resetCredits.details.
length>0&&React.createElement("div",{className:"usage-dashboard-reset-credits"},u.resetCredits.details.map((T,H)=>React.
createElement("span",{key:`${T.title||"reset"}-${H}`},React.createElement("strong",null,T.title||`Reset credit ${H+1}`),
T.status&&React.createElement("small",null,T.status),T.expires_at&&React.createElement("small",null,"Expires ",Sa(T.expires_at,
b))))),u.error?.message&&u.windows.length>0&&React.createElement("div",{className:"usage-dashboard-stale-error"},"Last r\
efresh: ",u.error.message),React.createElement("div",{className:"usage-dashboard-source-row"},React.createElement("span",
null,"Source: ",u.source?u.source.replace(/_/g," "):"not available",u.latencyMs!=null?` \xB7 ${u.latencyMs} ms`:""),u.dashboardUrl&&
React.createElement("a",{href:u.dashboardUrl,target:"_blank",rel:"noreferrer"},"Open provider dashboard"))))}),h.entries.
length===0&&React.createElement("div",{className:"usage-dashboard-empty"},React.createElement("strong",null,h.collectionState===
"ready"?"The completed scan found no provider usage.":"Provider usage is not available yet."),React.createElement("span",
null,h.collectionState==="ready"?"Connect a supported Codex, Claude Code, Antigravity, or Cursor session, or start local\
 Ollama, then refresh.":"Quota totals remain unknown until a provider collection completes."))))}var Vi=640,Dl=220,xt=Object.
freeze({left:54,right:14,top:12,bottom:32});function ea(e){let t=Math.max(.04,Math.min(1,Number(e?.end)-Number(e?.start)||
1)),n=Math.max(0,Math.min(1-t,Number(e?.start)||0));return{start:n,end:n+t}}function $v(e,t,n,s){let a="",i=!1;return e.
forEach(c=>{let d=c[t];if(c.gap||d==null||!Number.isFinite(d)){i=!1;return}a+=`${i?"L":"M"}${n(c).toFixed(2)},${s(d).toFixed(
2)} `,i=!0}),a.trim()}function Ki({title:e,description:t,frames:n,series:s,percentScale:a=!1,viewport:i,onViewportChange:c,
crosshairSequence:d,onCrosshairChange:f,range:h="live",nowMs:b=Date.now(),paused:N=!1,subscriptionStatus:x="live"}){let S=React.
useRef(null),R=React.useRef(new Map),u=React.useRef(null),v=React.useRef(0),[g,w]=React.useState({}),[y,E]=React.useState(
{mode:"auto",fixedMax:null}),T=Vi-xt.left-xt.right,H=Dl-xt.top-xt.bottom,K=xr(n,{nowMs:b,paused:N,connected:x!=="reconne\
cting",subscriptionStatus:x}),te=K.frames,ne=ea(i),oe=Cr[h]??Cr.live,G=N&&K.endMs||b,de=oe===1/0?K.startMs||G-Cr.live:G-
oe,Ne=Math.max(1,G-de),J=de+Ne*ne.start,ve=de+Ne*ne.end,ge=te.filter(j=>Number(j.chart_time_ms)>=J&&Number(j.chart_time_ms)<=
ve),Z=s.map(j=>{let se=j.frames?xr(j.frames,{nowMs:b,paused:!0}).frames:ge,Se=j.frames?se.filter(Fe=>Number(Fe.chart_time_ms)>=
J&&Number(Fe.chart_time_ms)<=ve):se;return{...j,visibleFrames:Se,samples:ip(Se,j.metric,180)}}),he=Z.filter(j=>!g[j.key]),
Q=Math.max(0,...he.flatMap(j=>j.samples.map(se=>se.max||0))),U=ll(Q,v.current,{percent:a});!a&&y.mode==="auto"&&(v.current=
U.maximum);let V=y.mode==="fixed"&&y.fixedMax?ll(y.fixedMax,y.fixedMax,{percent:a}):U,ie=V.maximum,I=j=>xt.left+ul(j,J,ve)*
T,W=j=>xt.top+H-Math.max(0,Math.min(ie,j))/Math.max(1,ie)*H,re=ge.find(j=>j.sample_sequence===d)||ge.at(-1)||null,$=re?xt.
left+ul(re,J,ve)*T:null,z=s[0]?.format||(j=>String(j)),fe=lp(J,ve,typeof window<"u"&&window.innerWidth<=600?4:5),we=K.status[0]?.
toUpperCase()+K.status.slice(1);function ye(j){let se=S.current?.getBoundingClientRect();return se?.width?Math.max(0,Math.
min(1,(j.clientX-se.left)/se.width)):.5}function Ce(j){if(!ge.length)return 0;let se=J+(ve-J)*j;return ge.reduce((Se,Fe)=>Math.
abs(Number(Fe.chart_time_ms)-se)<Math.abs(Number(Se.chart_time_ms)-se)?Fe:Se,ge[0]).sample_sequence}function Te(j,se=.5){
let Se=ea(i),Fe=Math.max(.04,Math.min(1,(Se.end-Se.start)*j)),ht=Se.start+(Se.end-Se.start)*se;c(ea({start:ht-Fe*se,end:ht+
Fe*(1-se)}))}React.useEffect(()=>{let j=S.current;if(!j)return;let se=Se=>{Se.preventDefault(),Te(Se.deltaY>0?1.2:.8,ye(
Se))};return j.addEventListener("wheel",se,{passive:!1}),()=>j.removeEventListener("wheel",se)});function Le(j){try{j.currentTarget.
setPointerCapture?.(j.pointerId)}catch{}if(R.current.set(j.pointerId,{x:j.clientX,y:j.clientY}),f(Ce(ye(j))),R.current.size===
1)u.current={mode:"pan",pointerId:j.pointerId,startX:j.clientX,viewport:ea(i)};else if(R.current.size===2){let se=[...R.
current.values()];u.current={mode:"pinch",distance:Math.max(1,Math.abs(se[1].x-se[0].x)),center:(ye({clientX:se[0].x})+ye(
{clientX:se[1].x}))/2,viewport:ea(i)}}}function At(j){if(!R.current.has(j.pointerId)){f(Ce(ye(j)));return}R.current.set(
j.pointerId,{x:j.clientX,y:j.clientY});let se=u.current;if(se?.mode==="pinch"&&R.current.size>=2){let Se=[...R.current.values()],
Fe=Math.max(1,Math.abs(Se[1].x-Se[0].x)),ht=se.viewport.end-se.viewport.start,en=Math.max(.04,Math.min(1,ht*se.distance/
Fe)),O=se.viewport.start+ht*se.center;c(ea({start:O-en*se.center,end:O+en*(1-se.center)}));return}if(se?.mode==="pan"&&se.
pointerId===j.pointerId){let Se=S.current?.getBoundingClientRect(),Fe=se.viewport.end-se.viewport.start,ht=Se?.width?-(j.
clientX-se.startX)/Se.width*Fe:0;c(ea({start:se.viewport.start+ht,end:se.viewport.end+ht}))}}function le(j){R.current.delete(
j.pointerId);try{j.currentTarget.releasePointerCapture?.(j.pointerId)}catch{}R.current.size===0&&(u.current=null)}function De(j){
if(!ge.length)return;let se=Math.max(0,ge.findIndex(Se=>Se.sample_sequence===d));if(j.key==="ArrowLeft"||j.key==="ArrowR\
ight")if(j.preventDefault(),j.shiftKey){let Fe=(ne.end-ne.start)*(j.key==="ArrowLeft"?-.1:.1);c(ea({start:ne.start+Fe,end:ne.
end+Fe}))}else{let Se=Math.max(0,Math.min(ge.length-1,se+(j.key==="ArrowLeft"?-1:1)));f(ge[Se].sample_sequence)}else j.key===
"Home"||j.key==="End"?(j.preventDefault(),f((j.key==="Home"?ge[0]:ge.at(-1)).sample_sequence)):j.key==="+"||j.key==="="?
(j.preventDefault(),Te(.75)):j.key==="-"&&(j.preventDefault(),Te(1.25))}return React.createElement("section",{className:"\
host-resource-chart","aria-label":`${e} chart`},React.createElement("div",{className:"host-resource-chart-heading"},React.
createElement("span",null,React.createElement("strong",null,e),React.createElement("small",null,t)),!a&&React.createElement(
"button",{type:"button",onClick:()=>E(j=>j.mode==="auto"?{mode:"fixed",fixedMax:U.maximum}:{mode:"auto",fixedMax:null})},
y.mode==="auto"?"Auto scale":`Fixed ${z(y.fixedMax)}`)),React.createElement("div",{className:`host-resource-chart-qualit\
y ${K.status}`,role:"status"},React.createElement("strong",null,we),React.createElement("span",null,K.receivedCount," re\
ceived / ",K.validCount," valid / ",K.expectedCount," expected / ",K.droppedCount," dropped"),React.createElement("span",
null,Math.round(K.cadenceMs)," ms cadence"),React.createElement("span",null,K.gapCount," gap",K.gapCount===1?"":"s"),React.
createElement("span",null,K.duplicateCount," duplicate / ",K.outOfOrderCount," out of order")),React.createElement("div",
{className:"host-resource-chart-legend","aria-label":`${e} series`},Z.map((j,se)=>React.createElement("button",{type:"bu\
tton",key:j.key,"aria-pressed":!g[j.key],onClick:()=>w(Se=>({...Se,[j.key]:!Se[j.key]}))},React.createElement("i",{className:`\
marker marker-${se%3}`,style:{"--series-color":j.color}}),j.label))),React.createElement("div",{className:"host-resource\
-chart-canvas",ref:S,role:"group",tabIndex:"0","aria-label":`${e}. Drag to pan, wheel or pinch to zoom, arrow keys move \
the synchronized crosshair, shift plus arrows pan, plus and minus zoom.`,onPointerDown:Le,onPointerMove:At,onPointerUp:le,
onPointerCancel:le,onKeyDown:De},React.createElement("svg",{viewBox:`0 0 ${Vi} ${Dl}`,"aria-hidden":"true"},K.gaps.filter(
j=>j.endMs>=J&&j.startMs<=ve).map((j,se)=>{let Se=xt.left+Math.max(0,(j.startMs-J)/Math.max(1,ve-J))*T,Fe=xt.left+Math.min(
1,(j.endMs-J)/Math.max(1,ve-J))*T;return React.createElement("rect",{key:`${j.reason}-${se}`,className:"host-resource-ch\
art-gap",x:Se,y:xt.top,width:Math.max(2,Fe-Se),height:H})}),[...V.ticks].reverse().map(j=>{let se=W(j);return React.createElement(
React.Fragment,{key:j},React.createElement("line",{className:"host-resource-chart-grid",x1:xt.left,x2:Vi-xt.right,y1:se,
y2:se}),React.createElement("text",{className:"host-resource-chart-y-label",textAnchor:"end",x:xt.left-7,y:se+4},z(j)))}),
fe.map((j,se)=>{let Se=xt.left+j.fraction*T;return React.createElement("text",{key:j.timeMs,className:"host-resource-cha\
rt-x-label","aria-label":j.accessibleLabel,textAnchor:se===0?"start":se===fe.length-1?"end":"middle",x:Se,y:Dl-7},j.label)}),
he.flatMap(j=>j.samples.map(se=>se.gap||se.min==null||se.max==null?null:React.createElement("line",{key:`${j.key}-${se.endSequence}`,
className:"host-resource-chart-range",stroke:j.color,x1:I(se),x2:I(se),y1:W(se.min),y2:W(se.max)}))),he.map((j,se)=>React.
createElement("path",{key:j.key,className:`host-resource-chart-line series-${se%3}`,stroke:j.color,strokeDasharray:j.dashed||
se%3===1?"7 4":se%3===2?"2 4":void 0,d:$v(j.samples,"average",I,W)})),he.flatMap((j,se)=>j.visibleFrames.length<10?j.visibleFrames.
map(Se=>{let Fe=Ks(Se,j.metric);return Fe==null?null:React.createElement("circle",{key:`${j.key}-point-${Se.sample_sequence}`,
className:`host-resource-chart-point marker-${se%3}`,cx:I(Se),cy:W(Fe),r:"3",stroke:j.color})}):[]),$!=null&&React.createElement(
"line",{className:"host-resource-chart-crosshair",x1:$,x2:$,y1:xt.top,y2:xt.top+H})),re&&React.createElement("div",{className:`\
host-resource-chart-tooltip ${$>Vi/2?"flip":""}`,role:"status"},React.createElement("strong",null,ml(re.chart_time_ms),"\
 / seq ",re.sample_sequence),React.createElement("span",null,Math.max(0,Math.round((b-Number(re.chart_time_ms))/1e3)),"s\
 old / ",re.sample_interval_ms||K.cadenceMs," ms / ",we," / source ",re.status||"unknown"),Z.map(j=>React.createElement(
"span",{key:j.key},React.createElement("i",{style:{background:j.color}}),j.label,": ",j.format(Ks(j.visibleFrames.find(se=>se.
sample_sequence===re.sample_sequence),j.metric)))))),React.createElement("div",{className:"host-resource-chart-stats"},Z.
filter(j=>!g[j.key]).map(j=>{let se=cl(j.visibleFrames,j.metric),Se=j.visibleFrames.find(Fe=>Fe.sample_sequence===se.peakSequence);
return React.createElement("span",{key:j.key},React.createElement("strong",null,j.label),React.createElement("span",null,
"Latest-good ",j.format(se.current)),React.createElement("span",null,"Min ",j.format(se.min)),React.createElement("span",
null,"Avg ",j.format(se.average)," (",se.averageMethod,")"),React.createElement("span",null,"Max ",j.format(se.max)),React.
createElement("span",null,se.p95Ready?`p95 ${j.format(se.p95)}`:`p95 collecting (${se.count}/20)`),React.createElement("\
small",null,se.count," raw / ",Math.round(se.elapsedMs/1e3),"s / ",se.cadenceMs||K.cadenceMs," ms cadence / ",Math.max(se.
gapCount,K.gapCount)," gaps / ",we," / peak ",pl(Se?.captured_at)))})),React.createElement("details",{className:"host-re\
source-chart-data"},React.createElement("summary",null,"Accessible data table"),React.createElement("div",null,React.createElement(
"table",null,React.createElement("caption",null,"Latest ",Math.min(120,ge.length)," of ",ge.length," visible samples"),React.
createElement("thead",null,React.createElement("tr",null,React.createElement("th",null,"Time / sequence"),Z.map(j=>React.
createElement("th",{key:j.key},j.label)))),React.createElement("tbody",null,ge.slice(-120).map(j=>React.createElement("t\
r",{key:`${j.sample_sequence}:${j.chart_time_ms}`},React.createElement("th",null,ml(j.chart_time_ms)," / ",j.sample_sequence,
j.gap_before?` / gap: ${j.gap_reason}`:""),Z.map(se=>React.createElement("td",{key:se.key},se.format(Ks(se.visibleFrames.
find(Se=>Se.sample_sequence===j.sample_sequence),se.metric)))))))))))}function Ev(e,t,n,s,a){let i=t.trim().toLowerCase(),
c=S=>(!i||[S.name,S.agentLabel,S.workspaceLabel,S.pid,S.attributionReason].some(R=>String(R||"").toLowerCase().includes(
i)))&&(n==="all"||S.attributionLevel===n),d=e.filter(c),f=new Set(d.map(S=>S.stableKey)),h=(S,R)=>s==="name"?(S.agentLabel||
S.name).localeCompare(R.agentLabel||R.name)||S.pid-R.pid:s==="memory"?R.memoryBytes-S.memoryBytes||S.pid-R.pid:s==="read"?
R.ioReadBps-S.ioReadBps||S.pid-R.pid:s==="write"?R.ioWriteBps-S.ioWriteBps||S.pid-R.pid:R.cpuHostPercent-S.cpuHostPercent||
S.pid-R.pid,b=new Map;d.forEach(S=>{let R=f.has(S.parentKey)?S.parentKey:"";b.set(R,[...b.get(R)||[],S])});let N=[];function x(S,R){
(b.get(S)||[]).sort(h).forEach(u=>{N.push({process:u,depth:R}),a[u.stableKey]!==!1&&x(u.stableKey,R+1)})}return x("",0),
N}function $m(e,t,n=44,s=16){let a=(Array.isArray(e)?e:[]).map(i=>Ks(i,t)).filter(i=>i!==null);return a.length<2?"":a.map(
(i,c)=>{let d=c/(a.length-1)*n,f=s-Math.max(0,Math.min(100,i))/100*s;return`${c?"L":"M"}${d.toFixed(2)},${f.toFixed(2)}`}).
join(" ")}function Lv({connected:e,error:t,history:n,subscription:s,onOpen:a,onRefresh:i,onSubscribe:c,onUnsubscribe:d}){
let f="(min-width: 900px)",[h,b]=React.useState(()=>typeof window<"u"&&typeof window.matchMedia=="function"?window.matchMedia(
f).matches:!1),[N,x]=React.useState(Date.now());React.useEffect(()=>{if(typeof window>"u"||typeof window.matchMedia!="fu\
nction")return;let E=window.matchMedia(f),T=()=>b(E.matches);return T(),typeof E.addEventListener=="function"?E.addEventListener(
"change",T):E.addListener?.(T),()=>{typeof E.removeEventListener=="function"?E.removeEventListener("change",T):E.removeListener?.(
T)}},[]),React.useEffect(()=>{if(h)return c(!0,"global-strip"),()=>d("global-strip")},[h,c,d]),React.useEffect(()=>{if(!h)
return;let E=()=>x(Date.now()),T=setInterval(E,1e3),H=()=>{document.visibilityState==="visible"&&(E(),i(!1))};return document.
addEventListener("visibilitychange",H),()=>{clearInterval(T),document.removeEventListener("visibilitychange",H)}},[h,i]);
let S=React.useMemo(()=>op(n,{connected:e,error:!!t,nowMs:N,subscriptionStatus:s?.status}),[e,t,n,N,s?.status]);if(!h)return null;
let R=E=>(E==null?"\u2014":String(Math.round(E))).padStart(3,"\u2007"),u=E=>E==="critical"?"!!":E==="warning"?"!":"",v=S.
status==="stale"?`stale ${S.ageSeconds}s`:S.status,g=S.memoryUsedBytes!==null&&S.memoryTotalBytes!==null?`${Jn(S.memoryUsedBytes)}\
 of ${Jn(S.memoryTotalBytes)}`:"memory totals unavailable",w=S.point?`Host CPU ${S.cpuPercent?.toFixed(1)??"unknown"}%; \
memory ${S.memoryPercent?.toFixed(1)??"unknown"}% (${g}); ${v}; sample ${S.sampleSequence}`:`Host resources ${v}`,y=S.point?
`Open Host resources. CPU ${S.cpuPercent?.toFixed(1)??"unknown"} percent, ${S.cpuLevel}. RAM ${S.memoryPercent?.toFixed(
1)??"unknown"} percent, ${S.memoryLevel}. ${v}. Sample ${S.sampleSequence}.`:`Open Host resources. CPU and RAM waiting. ${v}\
.`;return React.createElement("div",{className:"global-desktop-status-rail","data-testid":"global-desktop-status-rail"},
React.createElement("button",{type:"button",className:`global-host-resource-strip ${S.attention}`,"data-testid":"global-\
host-resource-strip","data-status":S.status,"data-cpu-level":S.cpuLevel,"data-memory-level":S.memoryLevel,"data-sample-s\
equence":S.sampleSequence||"","data-sample-captured-at":S.capturedAt||"","data-cpu-percent":S.cpuPercent??"","data-memor\
y-percent":S.memoryPercent??"","data-history-count":S.frames.length,"aria-label":y,title:w,onClick:a},React.createElement(
"span",{className:`global-host-resource-metric ${S.cpuLevel}`},React.createElement("span",{className:"label"},"CPU","\xA0"),
React.createElement("span",{className:"value"},R(S.cpuPercent)),React.createElement("span",{className:"unit"},"%"),React.
createElement("span",{className:"attention-mark"},u(S.cpuLevel))),React.createElement("span",{className:"global-host-res\
ource-divider","aria-hidden":"true"},"\xB7"),React.createElement("span",{className:`global-host-resource-metric ${S.memoryLevel}`},
React.createElement("span",{className:"label"},"RAM","\xA0"),React.createElement("span",{className:"value"},R(S.memoryPercent)),
React.createElement("span",{className:"unit"},"%"),React.createElement("span",{className:"attention-mark"},u(S.memoryLevel))),
React.createElement("svg",{className:"global-host-resource-sparkline",viewBox:"0 0 44 16","aria-hidden":"true"},React.createElement(
"path",{className:"cpu",d:$m(S.frames,"cpu_total_percent")}),React.createElement("path",{className:"memory",d:$m(S.frames,
"memory_used_percent")})),React.createElement("span",{className:"global-host-resource-state"},v)))}function qv({snapshot:e,
error:t,history:n,details:s,subscription:a,onBack:i,onRefresh:c,onSubscribe:d,onUnsubscribe:f}){let h=React.useMemo(()=>rp(
e),[e]),[b,N]=React.useState(Date.now()),[x,S]=React.useState("live"),[R,u]=React.useState(null),[v,g]=React.useState(null),
[w,y]=React.useState({start:0,end:1}),[E,T]=React.useState(0),[H,K]=React.useState(!1),[te,ne]=React.useState(""),[oe,G]=React.
useState("all"),[de,Ne]=React.useState("cpu"),[J,ve]=React.useState({}),[ge,Z]=React.useState("");React.useEffect(()=>(d(
H,"dashboard"),()=>f("dashboard")),[H,d,f]),React.useEffect(()=>{let le=setInterval(()=>N(Date.now()),1e3);return()=>clearInterval(
le)},[]);let he=React.useMemo(()=>R==null?n:n.filter(le=>le.sample_sequence<=R),[n,R]),Q=R==null?b:v||b,U=React.useMemo(
()=>cp(he,x,{nowMs:Q,paused:R!=null,subscriptionStatus:a?.status,connected:a?.status!=="reconnecting",error:!!t}),[he,x,
Q,R,a?.status,t]),V=React.useMemo(()=>xr(he,{nowMs:Q,paused:R!=null,subscriptionStatus:a?.status,connected:a?.status!=="\
reconnecting",error:!!t}),[he,Q,R,a?.status,t]),ie=React.useRef("");React.useEffect(()=>{if(!["delayed","stale"].includes(
V.status)||R!=null){ie.current="";return}let le=`${V.status}:${V.points.at(-1)?.sampleSequence||0}`;ie.current!==le&&(ie.
current=le,c(!1))},[V.status,V.points,R,c]),React.useEffect(()=>{!E&&U.length&&T(U.at(-1).sample_sequence)},[E,U]);let I=h.
system,W=I?I.disk.readBps+I.disk.writeBps:0,re=I?I.network.receiveBps+I.network.sendBps:0,$=React.useMemo(()=>Ev(h.processes,
te,oe,de,J),[h.processes,te,oe,de,J]),z=h.processes.find(le=>le.stableKey===ge)||null,fe=h.lastGoodCapturedAt?dl(h.lastGoodCapturedAt,
b).replace(/^Updated\s+/i,""):"not yet available",we=React.useMemo(()=>ge?s.flatMap(le=>{let De=(le.processes||[]).find(
j=>j.stable_key===ge);return De?[{frame_kind:"system",sample_sequence:le.sample_sequence,captured_at:le.captured_at,sample_interval_ms:le.
sample_interval_ms,dropped_gap_count:le.dropped_gap_count,status:le.status,cpu:{total_percent:De.cpu_host_percent},disk:{
read_bps:De.io_read_bps,write_bps:De.io_write_bps}}]:[]}):[],[s,ge]),ye=le=>le==null?"\u2014":up(le),Ce=le=>le==null?"\u2014":
Zn(le),Te={live:"Live",delayed:"Delayed",reconnecting:"Reconnecting",paused:"Paused",stale:"Stale",waiting:"Waiting",unavailable:"\
Unavailable"}[V.status]||"Unavailable",Le=[{key:"cpu-total",metric:"cpu_total_percent",label:"Total",color:"#58a6ff",format:ye},
{key:"cpu-user",metric:"cpu_user_percent",label:"User",color:"#3fb950",format:ye},{key:"cpu-kernel",metric:"cpu_privileg\
ed_percent",label:"Kernel",color:"#d29922",format:ye},...we.length?[{key:"process-cpu",metric:"cpu_total_percent",label:`${z?.
agentLabel||z?.name||"Process"} overlay`,color:"#f778ba",format:ye,frames:we,dashed:!0}]:[]],At=[{key:"disk-read",metric:"\
disk_read_bps",label:"Read",color:"#58a6ff",format:Ce},{key:"disk-write",metric:"disk_write_bps",label:"Write",color:"#f\
0883e",format:Ce},...we.length?[{key:"process-read",metric:"disk_read_bps",label:"Process read overlay",color:"#bc8cff",
format:Ce,frames:we,dashed:!0},{key:"process-write",metric:"disk_write_bps",label:"Process write overlay",color:"#f778ba",
format:Ce,frames:we,dashed:!0}]:[]];return React.createElement("div",{className:"host-resource-dashboard","data-testid":"\
host-resource-dashboard"},React.createElement("div",{className:"automations-header host-resource-header"},React.createElement(
"button",{className:"automations-back",onClick:i,title:"Back to sessions"},"\u2190"),React.createElement("div",{className:"\
automations-header-text"},React.createElement("h2",null,"Host resources"),React.createElement("p",null,"Live, ephemeral \
Windows metrics. Process commands and executable paths never leave the proxy.")),React.createElement("button",{type:"but\
ton",className:"usage-dashboard-refresh",onClick:()=>c(!0),"aria-label":"Capture host resource detail now"},"Capture det\
ail")),React.createElement("div",{className:"host-resource-meta"},React.createElement("span",{className:`host-resource-s\
tatus ${V.status}`},Te),React.createElement("span",null,H?"Aggregate-only":h.machineLabel||"Windows host"),React.createElement(
"span",null,dl(h.capturedAt,b)),React.createElement("span",null,V.receivedCount," received / ",V.validCount," valid / ",
V.expectedCount," expected / ",V.droppedCount," dropped / ",V.gapCount," gaps / ",V.duplicateCount," dup / ",V.outOfOrderCount,
" out-of-order"),React.createElement("span",null,Math.round(V.cadenceMs)," ms cadence / seq ",h.sampleSequence||"\u2014")),
React.createElement("div",{className:"host-resource-controls","aria-label":"Host resource timeline controls"},React.createElement(
"div",{className:"host-resource-range",role:"group","aria-label":"Time range"},[["live","Live"],["1m","1m"],["5m","5m"],
["15m","15m"],["since_open","Since open"]].map(([le,De])=>React.createElement("button",{key:le,type:"button",className:x===
le?"active":"","aria-pressed":x===le,onClick:()=>{S(le),y({start:0,end:1})}},De))),React.createElement("button",{type:"b\
utton",onClick:()=>{R==null?(g(Date.now()),u(n.at(-1)?.sample_sequence||0)):(u(null),g(null))}},R==null?"Pause":"Resume"),
React.createElement("button",{type:"button",disabled:w.start===0&&w.end===1,onClick:()=>y({start:0,end:1})},"Reset zoom"),
React.createElement("label",null,React.createElement("input",{type:"checkbox",checked:H,onChange:le=>{K(le.target.checked),
Z("")}})," Aggregate-only privacy"),React.createElement("span",null,U.length," raw samples / ",Math.round(V.elapsedMs/1e3),
"s actual",R==null?"":` / paused at ${R}`)),(t||h.error)&&React.createElement("div",{className:"host-resource-error",role:"\
status"},t?.message||h.error?.message,h.error&&` Last full detail: ${fe}.`),I?React.createElement(React.Fragment,null,React.
createElement("div",{className:"host-resource-summary","aria-label":"Host resource summary"},React.createElement("div",null,
React.createElement("strong",null,Math.round(I.cpuPercent),"%"),React.createElement("span",null,"CPU"),React.createElement(
"small",null,I.cpu.logicalCoreCount||"\u2014"," logical / ",I.cpu.physicalCoreCount||"\u2014"," physical cores")),React.
createElement("div",null,React.createElement("strong",null,Math.round(I.memory.usedPercent),"%"),React.createElement("sp\
an",null,"memory"),React.createElement("small",null,Jn(I.memory.usedBytes)," / ",Jn(I.memory.totalBytes),"; commit ",Math.
round(I.memory.commitPercent),"%")),React.createElement("div",null,React.createElement("strong",null,Zn(W)),React.createElement(
"span",null,"disk I/O"),React.createElement("small",null,"Read ",Zn(I.disk.readBps)," / write ",Zn(I.disk.writeBps)," / ",
Math.round(I.disk.busyPercent),"% busy")),React.createElement("div",null,React.createElement("strong",null,Zn(re)),React.
createElement("span",null,"network I/O"),React.createElement("small",null,"Receive ",Zn(I.network.receiveBps)," / send ",
Zn(I.network.sendBps)))),React.createElement("div",{className:"host-resource-charts"},React.createElement(Ki,{title:"CPU",
description:"Total outline; User and Kernel component overlays (%)",frames:U,series:Le,percentScale:!0,viewport:w,onViewportChange:y,
crosshairSequence:E,onCrosshairChange:T,range:x,nowMs:Q,paused:R!=null,subscriptionStatus:a?.status}),React.createElement(
Ki,{title:"Memory",description:"Physical used and committed (%)",frames:U,series:[{key:"memory-used",metric:"memory_used\
_percent",label:"Physical used",color:"#bc8cff",format:ye},{key:"memory-commit",metric:"memory_commit_percent",label:"Co\
mmitted",color:"#f778ba",format:ye}],percentScale:!0,viewport:w,onViewportChange:y,crosshairSequence:E,onCrosshairChange:T,
range:x,nowMs:Q,paused:R!=null,subscriptionStatus:a?.status}),React.createElement(Ki,{title:"Disk",description:"Aggregat\
e throughput (IEC bytes/s); isolate unequal series in the legend",frames:U,series:At,viewport:w,onViewportChange:y,crosshairSequence:E,
onCrosshairChange:T,range:x,nowMs:Q,paused:R!=null,subscriptionStatus:a?.status}),React.createElement(Ki,{title:"Network",
description:"Physical-default receive and send (IEC bytes/s)",frames:U,series:[{key:"network-receive",metric:"network_re\
ceive_bps",label:"Receive",color:"#3fb950",format:Ce},{key:"network-send",metric:"network_send_bps",label:"Send",color:"\
#d29922",format:Ce}],viewport:w,onViewportChange:y,crosshairSequence:E,onCrosshairChange:T,range:x,nowMs:Q,paused:R!=null,
subscriptionStatus:a?.status})),!H&&React.createElement("section",{className:"host-resource-process-section","aria-label\
ledby":"host-resource-process-heading"},React.createElement("div",{className:"host-resource-process-heading"},React.createElement(
"span",null,React.createElement("strong",{id:"host-resource-process-heading"},"Processes"),React.createElement("small",null,
"Union of owned, top CPU, memory, read, and write. Attribution never implies unproved per-session ownership.")),React.createElement(
"span",null,h.attributedProcesses.length," attributed / ",h.processes.length," shown")),React.createElement("div",{className:"\
host-resource-process-controls"},React.createElement("label",null,"Search ",React.createElement("input",{value:te,onChange:le=>ne(
le.target.value),placeholder:"Name, PID, agent, workspace"})),React.createElement("label",null,"Attribution ",React.createElement(
"select",{value:oe,onChange:le=>G(le.target.value)},React.createElement("option",{value:"all"},"All"),React.createElement(
"option",{value:"owned"},"Owned"),React.createElement("option",{value:"runtime"},"Runtime match"),React.createElement("o\
ption",{value:"workspace-associated"},"Workspace-associated"),React.createElement("option",{value:"unattributed"},"Unatt\
ributed"))),React.createElement("label",null,"Sort ",React.createElement("select",{value:de,onChange:le=>Ne(le.target.value)},
React.createElement("option",{value:"cpu"},"CPU"),React.createElement("option",{value:"memory"},"Memory"),React.createElement(
"option",{value:"read"},"Read"),React.createElement("option",{value:"write"},"Write"),React.createElement("option",{value:"\
name"},"Name")))),z&&React.createElement("div",{className:"host-resource-process-overlay",role:"region","aria-label":`Pr\
ocess detail for ${z.agentLabel||z.name}`},React.createElement("div",null,React.createElement("strong",null,z.agentLabel||
z.name),React.createElement("span",null,z.name," / PID ",z.pid," / started ",z.startTime?pl(z.startTime):"unknown"),React.
createElement("small",null,z.attributionLevel,": ",z.attributionReason,". CPU and disk overlays use the same synchronize\
d timebase.")),React.createElement("button",{type:"button",onClick:()=>Z("")},"Remove overlay"),React.createElement("dl",
null,React.createElement("div",null,React.createElement("dt",null,"Host CPU"),React.createElement("dd",null,z.cpuHostPercent.
toFixed(1),"%")),React.createElement("div",null,React.createElement("dt",null,"Core equivalent"),React.createElement("dd",
null,z.cpuCoreEquivalent.toFixed(1),"%")),React.createElement("div",null,React.createElement("dt",null,"Working set"),React.
createElement("dd",null,Jn(z.memoryBytes))),React.createElement("div",null,React.createElement("dt",null,"Private / comm\
it"),React.createElement("dd",null,Jn(z.privateBytes)," / ",Jn(z.commitBytes))),React.createElement("div",null,React.createElement(
"dt",null,"Threads / handles"),React.createElement("dd",null,z.threadCount," / ",z.handleCount)),React.createElement("di\
v",null,React.createElement("dt",null,"I/O operations"),React.createElement("dd",null,"R ",z.ioReadOps," / W ",z.ioWriteOps)),
React.createElement("div",null,React.createElement("dt",null,"64-bit byte counters"),React.createElement("dd",null,"R ",
z.counterTotals.ioReadBytes," / W ",z.counterTotals.ioWriteBytes)),React.createElement("div",null,React.createElement("d\
t",null,"Detail samples"),React.createElement("dd",null,we.length," / 5s cadence")))),React.createElement("div",{className:"\
host-resource-process-scroll"},React.createElement("table",{className:"host-resource-process-table"},React.createElement(
"thead",null,React.createElement("tr",null,React.createElement("th",{scope:"col"},"Agent / process tree"),React.createElement(
"th",{scope:"col"},"Confidence"),React.createElement("th",{scope:"col"},"CPU host / core"),React.createElement("th",{scope:"\
col"},"Memory"),React.createElement("th",{scope:"col"},"Read"),React.createElement("th",{scope:"col"},"Write"))),React.createElement(
"tbody",null,$.map(({process:le,depth:De})=>React.createElement("tr",{key:le.stableKey,className:`${le.attributed?"attri\
buted":""} ${ge===le.stableKey?"selected":""}`,"data-agent-attributed":le.attributed?"true":"false"},React.createElement(
"td",{style:{"--process-depth":De}},le.childCount>0&&React.createElement("button",{className:"host-resource-process-expa\
nd",type:"button","aria-label":`${J[le.stableKey]===!1?"Expand":"Collapse"} ${le.name}`,"aria-expanded":J[le.stableKey]!==
!1,onClick:()=>ve(j=>({...j,[le.stableKey]:j[le.stableKey]===!1}))},J[le.stableKey]===!1?"+":"-"),React.createElement("b\
utton",{className:"host-resource-process-select",type:"button",onClick:()=>Z(le.stableKey)},React.createElement("strong",
null,le.agentLabel||le.name),React.createElement("span",null,le.agentLabel?`${le.name} / `:"","PID ",le.pid,le.workspaceLabel?
` / ${le.workspaceLabel}`:"",le.parentKey?" / child process":le.parentPid?` / parent PID ${le.parentPid} outside sample`:
""))),React.createElement("td",{"data-label":"Confidence"},React.createElement("strong",null,le.attributionLevel),React.
createElement("span",{title:le.attributionReason},le.attributionReason)),React.createElement("td",{"data-label":"CPU hos\
t / core"},le.cpuHostPercent.toFixed(1),"% / ",le.cpuCoreEquivalent.toFixed(1),"%"),React.createElement("td",{"data-labe\
l":"Memory"},Jn(le.memoryBytes)),React.createElement("td",{"data-label":"Read"},Zn(le.ioReadBps)),React.createElement("t\
d",{"data-label":"Write"},Zn(le.ioWriteBps)))))))),React.createElement("div",{className:"host-resource-privacy"},React.createElement(
"strong",null,"Privacy boundary:")," sanitized metrics cross the authenticated relay only to this requester while this v\
iew is open. The relay does not cache, persist, log, or restore them. Process command lines and executable paths remain \
local and are never transmitted. Aggregate-only mode also removes machine, device, adapter, workspace, process, and PID \
labels.")):React.createElement("div",{className:"usage-dashboard-empty host-resource-empty"},React.createElement("strong",
null,"Waiting for the Windows proxy."),React.createElement("span",null,"The subscription is ",a?.status||"starting",". G\
aps remain visible; unavailable samples are not interpolated.")))}function Pv(e){let t=Number(e?.percent);if(Number.isFinite(
t))return Math.max(0,Math.min(100,t));let n=Number(e?.completed),s=Number(e?.total);return Number.isInteger(n)&&Number.isInteger(
s)&&s>0?Math.max(0,Math.min(100,n/s*100)):null}function Iv(e,t){let n=ae(e?.last_snippet).trim();if(n)return n.replace(/\s+/g,
" ").slice(0,180);let s=Array.isArray(t)?t:[];for(let a=s.length-1;a>=0;a-=1){let i=kb(s[a]?.content||Mo(s[a]?.content_blocks));
if(i)return i.slice(0,180)}return"No recent message reported."}function Ov(e,t){if(e?.goal)return Wm(e.goal,t,e.goal_run);
let n=Date.parse(e?.startedAt||e?.started_at||e?.since||"");return Number.isFinite(n)?Ql(Math.max(0,(t-n)/1e3),{includeSeconds:!0}):
"live"}function Dv(e,t,n=20){let s=e.filter(a=>t[a]?.canReceiveBroadcast).slice(0,n);return s.length===e.length&&s.every(
(a,i)=>a===e[i])?e:s}function jv({sessions:e,activities:t,thinking:n,permissionPrompts:s,errorPrompts:a,messages:i,agentConfigs:c,
sessionAttention:d,health:f,connected:h,deliveryStates:b,stopPending:N,goalControlPending:x,onBroadcastSend:S,onInterrupt:R,
onGoalControl:u,onBack:v,onSelectSession:g}){let[w,y]=React.useState(Date.now()),[E,T]=React.useState(!1),[H,K]=React.useState(
[]),[te,ne]=React.useState(""),[oe,G]=React.useState(""),[de,Ne]=React.useState(""),[J,ve]=React.useState({});React.useEffect(
()=>{let $=setInterval(()=>y(Date.now()),1e3);return()=>clearInterval($)},[]);let ge=React.useMemo(()=>(e||[]).map($=>{let z=Ee(
$),we=Object.prototype.hasOwnProperty.call(t,z)?t[z]||{kind:"idle",label:""}:$?.activity||{kind:"idle",label:""},ye=s[z]||
(Mr(a[z])?a[z]:null),Ce=d[z]||null,Te=!!ye||$?.rate_limit_active===!0||["goal_attention","provider_usage_threshold"].includes(
Ce?.kind),Le=c[z]||{},At=$?.agent_type,De=U_(At,Le.capabilities)?we:{...we,goal:null},j=n[z]&&!De?.kind?{...De,kind:"thi\
nking"}:De,se=Si(j,Te,{connected:h,health:f[z],nowMs:w,requireFreshness:!0}),Se=se==="needs_attention",Fe=ya(se),ht=Ci(De,
{connected:h,health:f[z]}),en=$r($,Le),O=W_({agentType:At,capabilities:Le.capabilities,activity:De,latestUserRequest:$?.
last_user_request||G_(i[z]||[])}),dt=O.kind==="goal"&&De?.goal||null,Wt=String(dt?.state||dt?.status||"").toLowerCase(),
qn=Wt==="blocked",Pn=qn&&Le.capabilities?.goal_blocked_resume===!0,In=Wt==="active"?"pause":Wt==="paused"||Pn?"resume":null,
$a=qn?ae(dt?.block_reason||dt?.reason||De?.label||"Goal blocked").trim():"",Lr=["thinking","generating","running_command",
"applying_patch","reading_files","working"].includes(String(De?.kind||"").toLowerCase()),Ea=ae(De?.kind).replace(/_/g," "),
ta=Number($?.percent_used),ns=$?.rate_limited_until&&$.rate_limited_until!=="unknown"?Ro($.rate_limited_until):"",La=$?.
rate_limit_active===!0?`Usage limited${ns?` \xB7 resets ${ns}`:" \xB7 reset unknown"}`:Number.isFinite(ta)&&ta>=75?`Usag\
e ${Math.round(ta)}% used${ns?` \xB7 resets ${ns}`:""}`:"";return{id:z,session:$,agent:en,activity:De,attention:Se,working:Fe,
state:se,goal:dt,config:Le,stateLabel:$?.rate_limit_active===!0?"Usage limited":Ud(se),title:xo($,z,Le,i[z]||[]),status:ye?
ae(ye.title).trim()||"Action required":La||ht||ae(we?.label).trim()||(se==="idle"?dt?"Goal paused":"Idle":Ea||(dt?"Goal \
active":"Working")),workContext:O,progress:Pv(O),snippet:Iv($,i[z]||[]),health:f[z]||"unknown",canReceiveBroadcast:Op($,
c[z],f[z]||"unknown",h),freshness:zd(we,w),activityLatencyMs:Number.isFinite(Number(we?.transport?.latency_ms))?Math.round(
Number(we.transport.latency_ms)):null,goalAction:In,canControlGoal:!!(In&&dt?.fingerprint&&Le.capabilities?.goal_pause_resume===
!0&&Number($?.control_generation)>0),goalBlocked:qn,goalBlockedReason:$a,canInterrupt:!!(Lr&&Le.capabilities?.interrupt===
!0&&Number($?.control_generation)>0&&Number($?.turn_generation)>0)}}).filter(Boolean).sort(($,z)=>Number(z.attention)-Number(
$.attention)||Number(z.working)-Number($.working)||$.title.localeCompare(z.title)),[e,t,n,s,a,i,c,d,f,h,w]),Z=React.useMemo(
()=>ge.filter($=>E||$.state!=="idle"||$.goal),[ge,E]),he=ge.filter($=>$.state==="needs_attention").length,Q=ge.filter($=>$.
working).length,U=ge.filter($=>$.state==="working_goal").length,V=ge.filter($=>$.state==="idle").length,ie=React.useMemo(
()=>Object.fromEntries(Z.map($=>[$.id,$])),[Z]),I=`SEND TO ${H.length} SESSIONS`;React.useEffect(()=>{H.length<=20&&H.every(
$=>ie[$]?.canReceiveBroadcast)||K($=>Dv($,ie))},[ie,H]),React.useEffect(()=>{Object.keys(J).length!==0&&ve($=>{let z=!1,
fe={};return Object.entries($).forEach(([we,ye])=>{let Ce=b[ye.clientMessageId]||ye.status,Te=["offline_queued","busy_qu\
eued","steered"].includes(Ce)?"queued":Ce,Le=["queued","accepted","launch_accepted","delivered","agent_started","failed"].
includes(Te)?Te:ye.status;fe[we]=Le===ye.status?ye:{...ye,status:Le},fe[we]!==ye&&(z=!0)}),z?fe:$})},[b]);function W($){
Ne(""),K(z=>z.includes($)?z.filter(fe=>fe!==$):z.length<20?[...z,$]:z)}function re(){let $=Dp({session_ids:H,content:te,
confirmation:oe},we=>!!ie[we]?.canReceiveBroadcast);if(!$.ok){Ne($.error);return}let z=jp($.sessionIds),fe={};$.sessionIds.
forEach(we=>{let ye=S(we,$.content);fe[we]={...z[we],clientMessageId:ye,title:ie[we]?.title||we}}),ve(fe),ne(""),G(""),Ne(
"")}return React.createElement("div",{className:"fleet-view","data-testid":"fleet-view"},React.createElement("div",{className:"\
automations-header fleet-view-header"},React.createElement("button",{className:"automations-back",onClick:v,title:"Back \
to sessions"},"\u2190"),React.createElement("div",{className:"automations-header-text"},React.createElement("h2",null,"F\
leet view"),React.createElement("p",null,"Live monitoring across every active harness session."))),React.createElement("\
div",{className:"fleet-summary","aria-label":"Fleet summary"},React.createElement("div",null,React.createElement("strong",
null,ge.length),React.createElement("span",null,"sessions")),React.createElement("div",{className:Q?"working":""},React.
createElement("strong",null,Q),React.createElement("span",null,"working")),React.createElement("div",{className:U?"worki\
ng-goal":""},React.createElement("strong",null,U),React.createElement("span",null,"on goal")),React.createElement("div",
null,React.createElement("strong",null,V),React.createElement("span",null,"idle")),React.createElement("div",{className:he?
"attention":""},React.createElement("strong",null,he),React.createElement("span",null,"need attention"))),React.createElement(
"div",{className:"fleet-filter-row"},React.createElement("span",null,Q," working now"),React.createElement("button",{type:"\
button",onClick:()=>T($=>!$),"aria-pressed":E},E?"Hide idle sessions":`Show ${V} idle session${V===1?"":"s"}`)),React.createElement(
"section",{className:"fleet-broadcast","data-testid":"broadcast-send"},React.createElement("div",{className:"fleet-broad\
cast-heading"},React.createElement("div",null,React.createElement("strong",null,"Broadcast prompt"),React.createElement(
"span",null,"Select up to ",20," capable sessions.")),React.createElement("span",null,H.length," selected")),React.createElement(
"textarea",{value:te,onChange:$=>ne($.target.value),maxLength:65536,placeholder:"Prompt every selected session...","aria\
-label":"Broadcast prompt"}),React.createElement("div",{className:"fleet-broadcast-confirm"},React.createElement("label",
null,React.createElement("span",null,"Type ",React.createElement("strong",null,I)," to confirm"),React.createElement("in\
put",{value:oe,onChange:$=>G($.target.value),"aria-label":"Broadcast confirmation"})),React.createElement("button",{type:"\
button",onClick:re,disabled:!h||H.length===0||!te.trim()||oe!==I},"Send to ",H.length||0)),de&&React.createElement("div",
{className:"fleet-broadcast-error",role:"alert"},de),Object.keys(J).length>0&&React.createElement("div",{className:"flee\
t-broadcast-receipts","aria-label":"Broadcast delivery receipts"},Object.entries(J).map(([$,z])=>React.createElement("sp\
an",{key:$,className:`fleet-broadcast-receipt ${z.status}`,title:z.title},React.createElement("strong",null,z.title),React.
createElement("em",null,z.status.replace(/_/g," ")))))),Z.length===0?React.createElement("div",{className:"fleet-empty"},
React.createElement("strong",null,"Fleet is idle"),React.createElement("span",null,V," connected session",V===1?" is":"s\
 are"," idle. Show idle sessions to inspect them.")):React.createElement("div",{className:"fleet-grid"},Z.map($=>React.createElement(
"div",{role:"button",tabIndex:0,className:`fleet-card state-${$.state}${$.attention?" attention":""}${H.includes($.id)?"\
 selected":""}`,key:$.id,"data-session-id":$.id,"data-activity-state":$.state,"data-activity-lag-ms":$.activityLatencyMs??
"",onClick:()=>g($.id,$.session),onKeyDown:z=>{z.target===z.currentTarget&&(z.key==="Enter"||z.key===" ")&&g($.id,$.session)}},
React.createElement("span",{className:"fleet-card-top"},React.createElement("span",{className:"agent-badge",style:{color:$.
agent.color,borderColor:$.agent.color+"55",background:$.agent.color+"18"}},$.agent.logo?React.createElement("img",{src:$.
agent.logo,alt:"",className:"agent-badge-logo"}):$.agent.abbr),React.createElement("span",{className:"fleet-card-identit\
y"},React.createElement("strong",null,$.title),React.createElement("span",null,$.agent.name)),React.createElement("span",
{className:`fleet-health ${$.health}`,title:$.health}),React.createElement("label",{className:`fleet-select${$.canReceiveBroadcast?
"":" unavailable"}`,onClick:z=>z.stopPropagation()},React.createElement("input",{type:"checkbox",checked:H.includes($.id),
disabled:!$.canReceiveBroadcast,onChange:()=>W($.id),"aria-label":`Select ${$.title} for broadcast`}),React.createElement(
"span",null,$.canReceiveBroadcast?"Select":"Unavailable"))),React.createElement("span",{className:"fleet-card-status"},$.
working&&React.createElement(Ao,{agentType:$.session?.agent_type,compact:!0,animate:!1}),React.createElement("span",{className:`\
fleet-state-badge ${$.state}`},$.stateLabel),React.createElement("strong",null,$.status),$.working&&React.createElement(
"time",null,Ov($.activity,w))),React.createElement("span",{className:"fleet-freshness",title:"Proxy-to-Fleet delivery ti\
me"},"Activity ",$.freshness),($.canControlGoal||$.goalBlocked||$.canInterrupt)&&React.createElement("span",{className:"\
fleet-control-actions",role:"group","aria-label":`Controls for ${$.title}`,onClick:z=>z.stopPropagation()},$.canControlGoal&&
React.createElement("button",{type:"button",onClick:()=>u($.id,$.goalAction,$.goal,$.session),disabled:!h||!!x?.[$.id],"\
aria-label":`${$.goalAction==="pause"?"Pause":$.goalBlocked?"Resume blocked":"Resume"} goal for ${$.title}`,title:$.goalBlocked?
$.goalBlockedReason:void 0},x?.[$.id]?$.goalAction==="pause"?"Pausing...":"Resuming...":$.goalAction==="pause"?"Pause go\
al":$.goalBlocked?"Resume blocked goal":"Resume goal"),$.goalBlocked&&!$.canControlGoal&&React.createElement("button",{type:"\
button",disabled:!0,"aria-label":`Goal blocked for ${$.title}; resolve in the native session`,title:$.goalBlockedReason||
"No verified native unblock action is available"},"Goal blocked \xB7 native action required"),$.canInterrupt&&React.createElement(
"button",{type:"button",className:"danger",onClick:()=>R($.id,$.session),disabled:!h||!!N?.[$.id],"aria-label":`Interrup\
t turn for ${$.title}`},N?.[$.id]?"Interrupting...":"Interrupt turn")),$.session?.agent_type==="codex_cli"&&$.config?.config_semantics===
"observed_and_next_send"&&React.createElement("span",{className:"fleet-freshness",title:"Native observation and pending \
next-send override"},"Observed ",$.config.observed_model_id||"unknown"," / ",$.config.observed_effort||"unknown"," \xB7 ",
"Next ",$.config.next_send_model_id||"unset"," / ",$.config.next_send_effort||"unset"),React.createElement("span",{className:`\
fleet-work-context kind-${$.workContext.kind}`,"aria-label":`${$.workContext.label}: ${$.workContext.text}`,"data-work-c\
ontext-kind":$.workContext.kind,"data-work-context-source":$.workContext.source},React.createElement("strong",null,$.workContext.
label),React.createElement("span",null,$.workContext.text),Number.isInteger($.workContext.completed)&&Number.isInteger($.
workContext.total)?React.createElement("em",null,$.workContext.completed,"/",$.workContext.total):null),($.workContext.kind===
"goal"||$.progress!=null)&&React.createElement("span",{className:`fleet-work-meter kind-${$.workContext.kind}${$.progress==
null&&$.working?" indeterminate":""}${$.working?"":" inactive"}`,"aria-label":$.progress==null?`${$.workContext.label} ${$.
stateLabel.toLowerCase()}`:Number.isInteger($.workContext.completed)&&Number.isInteger($.workContext.total)?`${$.workContext.
label} ${$.workContext.completed} of ${$.workContext.total} complete`:`${$.workContext.label} ${Math.round($.progress)}%\
 complete`},React.createElement("span",{style:$.progress==null?void 0:{width:`${$.progress}%`}})),React.createElement("s\
pan",{className:"fleet-snippet"},$.snippet),React.createElement("span",{className:"fleet-jump","aria-label":"Open sessio\
n"},"Open session ",React.createElement("span",{className:"fleet-jump-chevron","aria-hidden":"true"},"\u203A"))))))}function Bv({
onBack:e,onOpenResult:t}){let[n,s]=React.useState(""),[a,i]=React.useState(""),[c,d]=React.useState(""),[f,h]=React.useState(
""),[b,N]=React.useState(""),[x,S]=React.useState([]),[R,u]=React.useState(!0),[v,g]=React.useState(!1),[w,y]=React.useState(
"");async function E(T){if(T?.preventDefault(),!(n.trim().length<2||v)){g(!0),y("");try{let H=new URLSearchParams({q:n.trim(),
limit:"50"});a.trim()&&H.set("project",a.trim()),c.trim()&&H.set("harness",c.trim()),f&&H.set("date_from",f),b&&H.set("d\
ate_to",b);let K=await fetch(`/api/search/messages?${H.toString()}`,{credentials:"same-origin"}),te=await K.json().catch(
()=>({}));if(!K.ok)throw new Error(te.error||"Transcript search failed.");S(Array.isArray(te.results)?te.results:[]),u(te.
index?.ready!==!1)}catch(H){S([]),y(H?.message||"Transcript search failed.")}finally{g(!1)}}}return React.createElement(
"div",{className:"transcript-search-view","data-testid":"transcript-search-view"},React.createElement("div",{className:"\
automations-header transcript-search-header"},React.createElement("button",{className:"skills-back",onClick:e,title:"Bac\
k to sessions"},"\u2190"),React.createElement("div",null,React.createElement("h2",null,"Transcript search"),React.createElement(
"p",null,"Search every relay-backed message."))),React.createElement("form",{className:"transcript-search-form",onSubmit:E},
React.createElement("label",{className:"transcript-search-query"},React.createElement("span",null,"Search text"),React.createElement(
"input",{value:n,onChange:T=>s(T.target.value),placeholder:"Words from any conversation",maxLength:200,autoFocus:!0})),React.
createElement("div",{className:"transcript-search-filters"},React.createElement("label",null,React.createElement("span",
null,"Project"),React.createElement("input",{value:a,onChange:T=>i(T.target.value),placeholder:"Exact workspace or proje\
ct",maxLength:300})),React.createElement("label",null,React.createElement("span",null,"Harness"),React.createElement("in\
put",{value:c,onChange:T=>d(T.target.value),placeholder:"e.g. codex_cli",maxLength:80})),React.createElement("label",null,
React.createElement("span",null,"From"),React.createElement("input",{type:"date",value:f,onChange:T=>h(T.target.value)})),
React.createElement("label",null,React.createElement("span",null,"To"),React.createElement("input",{type:"date",value:b,
onChange:T=>N(T.target.value)}))),React.createElement("button",{type:"submit",className:"transcript-search-submit",disabled:n.
trim().length<2||v},v?"Searching\u2026":"Search transcripts")),!R&&React.createElement("div",{className:"transcript-sear\
ch-indexing"},"Older history is still indexing; current results are partial."),w&&React.createElement("div",{className:"\
transcript-search-error",role:"alert"},w),!v&&!w&&x.length===0&&n.trim().length>=2&&React.createElement("div",{className:"\
fleet-empty"},React.createElement("strong",null,"No matches"),React.createElement("span",null,"Try fewer words or clear \
a filter.")),React.createElement("div",{className:"transcript-search-results","aria-live":"polite"},x.map(T=>React.createElement(
"button",{type:"button",className:"transcript-search-result",key:`${T.session_id}:${T.message_id}`,onClick:()=>t(T)},React.
createElement("span",{className:"transcript-search-result-top"},React.createElement("strong",null,T.workspace_name||T.project_root||
T.session_id),React.createElement("em",null,T.agent_type||"unknown"," \xB7 ",T.role)),React.createElement("span",{className:"\
transcript-search-snippet"},T.snippet||"(empty message)"),React.createElement("span",{className:"transcript-search-resul\
t-bottom"},React.createElement("time",null,T.matched_at?new Date(T.matched_at).toLocaleString():""),React.createElement(
"span",null,"Open match \u203A"))))))}function Fv({skills:e,onRefresh:t,onBack:n}){let s=e?.installed||[],a=e?.recommended||
[],i=s.length===0&&a.length===0;return React.createElement("div",{className:"skills-view"},React.createElement("div",{className:"\
skills-header"},React.createElement("button",{className:"skills-back",onClick:n,title:"Back to sessions"},"\u2190"),React.
createElement("div",{className:"skills-header-text"},React.createElement("h2",null,"Skills"),React.createElement("p",{className:"\
skills-subtitle"},"Give Codex superpowers.")),React.createElement("button",{className:"skills-refresh-btn",onClick:t,title:"\
Refresh skills"},"\u21BB")),i?React.createElement("div",{className:"skills-loading"},"Loading skills\u2026"):React.createElement(
"div",{className:"skills-body"},s.length>0&&React.createElement("div",{className:"skills-section"},React.createElement("\
h3",{className:"skills-section-title"},"Installed"),React.createElement("div",{className:"skills-card-list"},s.map((c,d)=>React.
createElement("div",{key:c.id||d,className:"skills-card"},React.createElement("div",{className:"skills-card-icon"},c.icon?
React.createElement("img",{src:c.icon,alt:"",className:"skills-card-img"}):React.createElement("span",{className:"skills\
-card-placeholder"},"\u2699")),React.createElement("div",{className:"skills-card-body"},React.createElement("div",{className:"\
skills-card-name"},c.name),c.description&&React.createElement("div",{className:"skills-card-desc"},c.description)),React.
createElement("div",{className:"skills-card-action installed"},"\u2713"))))),a.length>0&&React.createElement("div",{className:"\
skills-section"},React.createElement("h3",{className:"skills-section-title"},"Recommended"),React.createElement("div",{className:"\
skills-card-list"},a.map((c,d)=>React.createElement("div",{key:c.id||d,className:"skills-card"},React.createElement("div",
{className:"skills-card-icon"},c.icon?React.createElement("img",{src:c.icon,alt:"",className:"skills-card-img"}):React.createElement(
"span",{className:"skills-card-placeholder"},"\u2699")),React.createElement("div",{className:"skills-card-body"},React.createElement(
"div",{className:"skills-card-name"},c.name),c.description&&React.createElement("div",{className:"skills-card-desc"},c.description)),
React.createElement("div",{className:"skills-card-action available"},"+")))))))}var zl=class extends React.Component{constructor(t){
super(t),this.state={error:null}}static getDerivedStateFromError(t){return{error:t}}componentDidCatch(t,n){try{console.error(
"Agent Chat render crash",t,n),sessionStorage.setItem("agent-chat:last-render-error",JSON.stringify({message:t?.message||
String(t),stack:t?.stack||"",componentStack:n?.componentStack||"",at:new Date().toISOString()}))}catch{}}render(){return this.
state.error?React.createElement("div",{className:"app-crash"},React.createElement("div",{className:"app-crash-card"},React.
createElement("div",{className:"app-crash-title"},"Agent Chat hit a render error"),React.createElement("div",{className:"\
app-crash-body"},this.state.error?.message||"Unknown UI error"),React.createElement("div",{className:"app-crash-actions"},
React.createElement("button",{className:"app-crash-btn",onClick:()=>location.reload()},"Refresh")))):this.props.children}},
Vl=class extends React.Component{componentDidMount(){this.props.finishStructureChange(null)}getSnapshotBeforeUpdate(t){return t.
structureKey===this.props.structureKey?null:this.props.prepareStructureChange(t.placements,this.props.placements)}componentDidUpdate(t,n,s){
t.structureKey!==this.props.structureKey&&this.props.finishStructureChange(s)}render(){return this.props.children}};function Hv(){
let{sessions:e,messages:t,provisionalStreams:n,historyMeta:s,historyLoading:a,connected:i,connectionHealth:c,unread:d,setUnread:f,
thinking:h,thinkingContent:b,activities:N,health:x,deliveryStates:S,launchStates:R,justLaunched:u,setJustLaunched:v,permissionPrompts:g,
respondToPrompt:w,errorPrompts:y,respondToErrorPrompt:E,interruptSession:T,controlGoal:H,agentConfigs:K,configControlStates:te,
requestAgentConfig:ne,setAgentModel:oe,setAgentEffort:G,setAgentPermissionMode:de,setAutoApprovePermissions:Ne,setAntigravityMode:J,
setCodexConfig:ve,newThread:ge,openPanel:Z,openNativeWindow:he,requestChatList:Q,switchChat:U,newChat:V,chatLists:ie,requestThreadList:I,
switchThread:W,threadLists:re,switchWorkspace:$,requestTerminalOutput:z,sendTerminalInput:fe,terminalOutputs:we,requestFileChanges:ye,
respondToFileChange:Ce,fileChanges:Te,sendAttachment:Le,send:At,sendToSession:le,steerMessage:De,discardQueuedMessage:j,
editQueuedMessage:se,queuedMessages:Se,scheduledSends:Fe,scheduleSend:ht,cancelScheduledSend:en,launchSession:O,resumeSession:dt,
closeSession:Wt,activeSessionRef:qn,restoreCachedTranscript:Pn,setSessionSubscriptions:In,workspaces:$a,branchLists:Lr,requestBranchList:Ea,
switchBranch:ta,createBranch:ns,skillLists:La,requestSkillList:qa,automationViews:ec,showCodexAutomation:To,controlResults:On,
directoryListings:$o,requestDirectoryListing:qr,fileContents:Pa,requestFileContent:na,requestHistory:Ia,requestHistoryChunk:sa,
duplicateProxyAlarms:Rt,nightlyValidationFailures:Eo,latestAppUpdateValidation:_n,revalidationProgramHealth:Pr,providerUsage:ss,
providerUsageRefreshReceipt:tc,requestProviderUsageRefresh:ws,setProviderUsageWatching:nc,providerUsageResetReceipt:aa,consumeProviderUsageResetCredit:sc,
providerUsageCostDetail:ra,requestProviderUsageCostDetail:ac,hostResources:Lo,hostResourceError:bn,hostResourceHistory:as,
hostResourceDetails:zt,hostResourceSubscription:Ns,subscribeHostResources:Ir,unsubscribeHostResources:pt,requestHostResourceRefresh:Ss,
semanticNotifications:_t}=Np(),[p,Oa]=ce(null),Da=React.useCallback(o=>Od(p,o),[p]),Or=React.useCallback(()=>Id(p),[p]),
qo=React.useSyncExternalStore(Da,Or,Or),[rs,oa]=ce({}),[vn,Dn]=ce({}),[Po,bt]=ce(!1),[ja,os]=ce(""),[jn,Ba]=ce(""),[Ot,ia]=ce(
null),[Io,yn]=ce({}),[is,Cs]=ce(av),[tt,Ye]=ce(!1),vt=Ae(null),ca=Ae({}),Fa=Ae(!1),[kn,wn]=ce(!1),[mt,yt]=ce(!1),[tn,Mt]=ce(
!1),[lt,Ke]=ce(!1),[Ha,Tt]=ce(!1),[Ua,cs]=ce(!1),[Dt,Nn]=ce(""),[st,Oo]=ce({}),[Do,Ga]=ce(!1),[rc,jo]=ce(""),[Bo,Wa]=ce(
!1),[ke,xs]=ce(!1),[ls,la]=ce(!1),[Dr,za]=ce(""),[nn,$t]=ce(0),[As,Sn]=ce(!1),[Fo,Va]=ce(!1),[Bn,ua]=ce({}),[Fn,Ho]=ce({}),
[da,jt]=ce({}),ft=Ae(new Map),[Vt,us]=ce(null),Et=Ae({sessionId:null,expiresAt:0}),at=Ae(null),[oc,ds]=ce(!1),[Rs,Ms]=ce(
0),[Kt,Lt]=ce(!1),[Yt,sn]=ce(!0),[Uo,Ts]=ce({}),[Xt,Bt]=ce(!1),[$s,ps]=ce({}),[kt,ms]=ce({}),[jr,Ka]=ce({}),[Es,pa]=ce(!1),
[Br,Go]=ce(!1),[Fr,Ya]=ce(!1),[fs,Hn]=ce(!1),[Ls,Un]=ce(!1),[qs,Cn]=ce(!1),[gs,xn]=ce(!1),[Ps,an]=ce(!1),[hs,Gn]=ce(!1),
[Je,Xa]=ce(null),[rn,Wo]=ce(!1),[ic,Hr]=ce("."),[Ur,ma]=ce(null),[Qa,Gr]=ce(null),zo=Ae(null),[cc,Vo]=ce(0),Wr=Ae(null),
[Ja,lc]=ce(()=>{try{return localStorage.getItem("remote-agent-chat-theme")||"dark"}catch{return"dark"}}),[Ft,uc]=ce(()=>{
try{let o=JSON.parse(localStorage.getItem("remote-agent-chat:collapsed-directories:v1")||"[]");return Array.isArray(o)?Object.
fromEntries(o.map(_=>[String(_),!0])):{}}catch{return{}}}),[An,dc]=ce(()=>{try{return localStorage.getItem(im)==="1"}catch{
return!1}});Me(()=>{try{localStorage.setItem(im,An?"1":"0")}catch{}},[An]);let[Is]=ce(()=>{try{let o=JSON.parse(localStorage.
getItem(yl)||"{}");return Oi(o)}catch{return Oi(Pi)}});Me(()=>{try{localStorage.setItem(yl,JSON.stringify(Is))}catch{}},
[Is]),Me(()=>{fetch("/api/preferences/sessions",{credentials:"same-origin"}).then(o=>o.ok?o.json():Promise.reject(new Error(
"Session settings unavailable"))).then(o=>{Oo(o.preferences||{}),Ga(!0)}).catch(()=>{})},[]),Me(()=>{let o=!0;return fetch(
"/api/preferences/notifications",{credentials:"same-origin"}).then(_=>_.ok?_.json():Promise.reject(new Error("Notificati\
on settings unavailable"))).then(_=>{o&&(Cs({...nu,..._.preferences||{},turn_ready:!1}),Ye(!0))}).catch(()=>{}),()=>{o=!1}},
[]),Me(()=>{if(!is.completion_sound)return;let o=()=>su();return document.addEventListener("pointerdown",o,{once:!0}),document.
addEventListener("keydown",o,{once:!0}),()=>{document.removeEventListener("pointerdown",o),document.removeEventListener(
"keydown",o)}},[is.completion_sound]);async function Ko(o,_){let M=await fetch(`/api/preferences/sessions/${encodeURIComponent(
o)}`,{method:"PUT",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({preference:_})}),
A=await M.json().catch(()=>({}));if(!M.ok)throw new Error(A.error||"Unable to save session settings.");return Oo(F=>({...F,
[o]:A.preference})),A.preference?.archived&&p===o&&Oa(null),A.preference}async function pc(o,_){let M=await fetch(`/api/\
sessions/${encodeURIComponent(o)}/export?format=${encodeURIComponent(_)}`,{credentials:"same-origin"});if(!M.ok){let Ie=await M.
json().catch(()=>({}));throw new Error(Ie.error||"Unable to export session.")}let F=(M.headers.get("Content-Disposition")||
"").match(/filename\*=UTF-8''([^;]+)/i)?.[1],X=`session.${_==="json"?"json":"md"}`;if(F)try{X=decodeURIComponent(F)}catch{}
let ue=URL.createObjectURL(await M.blob()),me=document.createElement("a");me.href=ue,me.download=X,me.hidden=!0,document.
body.appendChild(me),me.click(),me.remove(),setTimeout(()=>URL.revokeObjectURL(ue),1e3)}Me(()=>{try{let o=Object.keys(Ft).
filter(_=>Ft[_]);localStorage.setItem("remote-agent-chat:collapsed-directories:v1",JSON.stringify(o))}catch{}},[Ft]);let Yo=React.
useCallback(o=>{uc(_=>({..._,[o]:!_[o]}))},[]),Za=Ae(De);Me(()=>{Za.current=De},[De]);let zr=React.useCallback((o,_)=>{p&&
Za.current(p,o,_)},[p]),Xo=Ae(le);Me(()=>{Xo.current=le},[le]);let Qo=React.useCallback(o=>{!p||!o?._cid||Xo.current(p,o.
content,o._cid)},[p]),Vr=Ae(na);Me(()=>{Vr.current=na},[na]);let Os=React.useMemo(()=>[...e||[]].map(o=>{let _=Ee(o),M=st[_];
return M?.display_name?typeof o=="object"?{...o,custom_display_name:M.display_name}:{session_id:_,custom_display_name:M.
display_name}:o}),[e,st]),r=React.useMemo(()=>new Set(Os.filter(kl).map(Ee)),[Os]),m=React.useMemo(()=>Os.filter(o=>!kl(
o)),[Os]),k=An?Os:m,q=React.useMemo(()=>k.filter(o=>!st[Ee(o)]?.archived),[k,st]),l=React.useMemo(()=>m.filter(o=>!st[Ee(
o)]?.archived),[m,st]),C=Lb(N,q),L=React.useMemo(()=>({activities:N,thinking:h,pendingPrompts:g,errorPrompts:Object.fromEntries(
Object.entries(y||{}).filter(([,o])=>Mr(o))),health:x,connected:i,nowMs:C,requireFreshness:!0}),[N,h,g,y,x,i,C]),{working:B,
states:ee}=React.useMemo(()=>Mp(q,L),[q,L]),Y=Ae(null),be=Ae(null),pe=Ae(null),qe=Ae(0),We=Ae(null),Ue=Ae(null),Ze=Ae(null),
[$e,He]=ce(!1),Be=React.useCallback(()=>{pe.current&&clearTimeout(pe.current),pe.current=null,He(!0)},[]),rt=React.useCallback(
(o=0)=>{pe.current&&clearTimeout(pe.current),pe.current=setTimeout(()=>{pe.current=null,He(!1)},o)},[]);React.useEffect(
()=>{let o=()=>rt(80);return window.addEventListener("pointerup",o,!0),window.addEventListener("pointercancel",o,!0),()=>{
window.removeEventListener("pointerup",o,!0),window.removeEventListener("pointercancel",o,!0),pe.current&&clearTimeout(pe.
current),Ue.current&&cancelAnimationFrame(Ue.current),Ze.current&&cancelAnimationFrame(Ze.current)}},[rt]);let{sessions:Ht}=Eb(
B,$e),Kr=React.useMemo(()=>new Set(Ht.map(Ee)),[Ht]),{pinned:Yr}=React.useMemo(()=>Cp(q,st),[q,st]),au=React.useMemo(()=>new Set(
Yr.map(Ee)),[Yr]),Jo=React.useMemo(()=>np(q,{workingSessionIds:Kr,pinnedSessionIds:au}),[q,Kr,au]),on=Jo.recent,Qm=React.
useMemo(()=>new Set(on.map(Ee)),[on]),Wn=Jo.pinned,Jm=React.useMemo(()=>Nl(Jo.remaining,K,Is),[Jo.remaining,K,Is]),er=React.
useMemo(()=>Object.fromEntries(Nl(q,K,Is).flatMap(o=>o.sessions.map(_=>[Ee(_),o.label]))),[q,K,Is]),Zm=React.useMemo(()=>({
...L,messages:t,rankWorking:!1}),[L,t]),{groups:ru,orderChanged:Zo,sortNow:ou}=Rb(Jm,Zm,$e),Rn=React.useMemo(()=>ru.filter(
o=>o.sessions.length>0),[ru]),ef=React.useMemo(()=>new Set(Rn.flatMap(o=>o.sessions.map(Ee))),[Rn]),tf=React.useCallback(
()=>{let o=Y.current,_=p?o?.querySelector(`[data-session-id="${CSS.escape(p)}"]`):null;be.current=_?{sessionId:p,top:_.getBoundingClientRect().
top}:null,ou()},[p,ou]),ot=ja.trim().toLowerCase(),iu=React.useMemo(()=>Object.fromEntries(q.map(o=>{let _=Ee(o),M=$r(o,
K[_]);return[_,[xo(o,_,K[_],t[_]||[]),Tr(o,_,K[_]),er[_]||"Unscoped",st[_]?.pinned?"Pinned":"",M.name,o?.agent_type,o?.workspace_name,
o?.workspace_path,_].filter(Boolean).join(" ").toLowerCase()]})),[q,K,t,er,st]),Ds=React.useCallback(o=>ot?o.filter(_=>(iu[Ee(
_)]||"").includes(ot)):o,[ot,iu]),tr=React.useMemo(()=>Ds(Ht),[Ds,Ht]),nr=React.useMemo(()=>Ds(on),[Ds,on]),sr=React.useMemo(
()=>Ds(Wn),[Ds,Wn]),cu=React.useMemo(()=>Rn.map(o=>({...o,sessions:Ds(o.sessions)})).filter(o=>o.sessions.length>0),[Ds,
Rn]),lu=React.useMemo(()=>[...Ht,...on,...Wn,...Rn.flatMap(o=>o.sessions)],[Ht,on,Wn,Rn]),mc=React.useMemo(()=>{let o=new Set;
return q.filter(_=>{let M=Ee(_);return!M||o.has(M)?!1:(o.add(M),!0)})},[q]),uu=React.useMemo(()=>new Set(mc.map(Ee)),[mc]),
nf=React.useMemo(()=>{let o=new Map,_=(M,A)=>{for(let F of M){let X=Ee(F);X&&!o.has(X)&&o.set(X,A)}};_(Ht,"working"),_(on,
"recent"),_(Wn,"pinned");for(let M of Rn)_(M.sessions,`workspace:${M.key}`);return o},[Ht,on,Wn,Rn]),sf=React.useMemo(()=>[
`working:${Ht.map(Ee).join(",")}`,`recent:${on.map(Ee).join(",")}`,`pinned:${Wn.map(Ee).join(",")}`,...Rn.map(o=>`${o.key}\
:${o.sessions.map(Ee).join(",")}`),`collapsed:${Object.keys(Ft).filter(o=>Ft[o]).sort().join(",")}`,`filter:${ot}`].join(
"|"),[Ht,on,Wn,Rn,Ft,ot]),js=Ae(new Map),ei=Ae(null),af=React.useCallback((o,_)=>{let M=Y.current;if(!M)return null;Ze.current&&
(cancelAnimationFrame(Ze.current),Ze.current=null),M.classList.add("sidebar-structural-transaction");let A=document.activeElement,
F=A instanceof Element?A.closest("[data-sidebar-card-host]"):null,X=M.getBoundingClientRect(),ue=Array.from(M.querySelectorAll(
"[data-session-id]")),me=A instanceof Element?A.closest("[data-session-id]"):null,Ie=ue.filter(Qe=>{let pn=Qe.getBoundingClientRect();
return pn.bottom>X.top&&pn.top<X.bottom}),it=[...me&&Ie.includes(me)?[me]:[],...Ie.filter(Qe=>Qe!==me)].map(Qe=>({sessionId:Qe.
dataset.sessionId,top:Qe.getBoundingClientRect().top})),Tn=M.scrollTop,gr=[];for(let[Qe,pn]of o){let Qt=_.get(Qe);if(!Qt||
Qt===pn)continue;let Xn=js.current.get(Qe);Xn&&gr.push(Xn)}if(gr.length>0){let Qe=ei.current;Qe||(Qe=document.createElement(
"div"),Qe.setAttribute("data-sidebar-card-pool",""),Object.assign(Qe.style,{position:"fixed",left:"-10000px",top:"-10000\
px",width:"1px",height:"1px",overflow:"hidden",pointerEvents:"none"}),document.body.appendChild(Qe),ei.current=Qe);for(let pn of gr){
let Qt=pn.closest("[data-sidebar-card-slot]");if(Qt){let Xn=pn.querySelector("[data-session-id]"),po=Xn?getComputedStyle(
Xn):null,fi=Xn?Xn.getBoundingClientRect().height+(Number.parseFloat(po?.marginTop)||0)+(Number.parseFloat(po?.marginBottom)||
0):0;Qt.style.display="block",Qt.style.height=`${fi}px`,Qt.setAttribute("data-sidebar-card-placeholder","")}Qe.appendChild(
pn)}}return F&&A?.isConnected&&document.activeElement!==A&&A.focus({preventScroll:!0}),{candidates:it,scrollTop:Tn,interactionEpoch:qe.
current,focusedElement:F?A:null,focusedHost:F,movedHostCount:gr.length}},[]),rf=React.useCallback(o=>{let _=Y.current;if(!_)
return;let M=o?.focusedElement||document.activeElement,A=o?.focusedHost||(M instanceof Element?M.closest("[data-sidebar-\
card-host]"):null),F=new Set;for(let me of _.querySelectorAll("[data-sidebar-card-slot]")){let Ie=me.getAttribute("data-\
sidebar-card-slot")||"",Oe=js.current.get(Ie);if(!(!Ie||!Oe)&&(F.add(Ie),Oe.parentElement!==me)){let Nt=A===Oe&&M?.isConnected;
me.appendChild(Oe),Nt&&document.activeElement!==M&&M.isConnected&&M.focus({preventScroll:!0})}}let X=be.current,ue=X?{candidates:[
X],scrollTop:_.scrollTop,interactionEpoch:qe.current}:o;if(ue&&ue.interactionEpoch===qe.current){let Ie=(Array.isArray(ue.
candidates)?ue.candidates:[]).map(it=>({...it,card:Array.from(_.querySelectorAll("[data-session-id]")).find(Tn=>Tn.dataset.
sessionId===it.sessionId)})).find(it=>it.card),Oe=null,Nt=null;if(Ie){let it=Ie.card.getBoundingClientRect().top-Ie.top;
Math.abs(it)>.5&&(Oe=_.scrollTop+it),Nt=Ie.sessionId}else Number.isFinite(ue.scrollTop)&&(Oe=ue.scrollTop);if(Oe!=null){
let it=Math.max(0,Math.min(Oe,Math.max(0,_.scrollHeight-_.clientHeight)));if(Math.abs(_.scrollTop-it)>.5){let Tn=_.scrollTop;
We.current={target:it},_.scrollTop=it,_.dispatchEvent(new CustomEvent("rac-sidebar-scroll-correction",{detail:{from:Tn,to:_.
scrollTop,anchorSessionId:Nt,explicitSort:!!X}})),Ue.current&&cancelAnimationFrame(Ue.current),Ue.current=requestAnimationFrame(
()=>{We.current=null,Ue.current=null})}}}be.current=null;for(let[me,Ie]of js.current)F.has(me)||uu.has(me)||(Ie.remove(),
js.current.delete(me));o?.focusedElement?.isConnected&&document.activeElement!==o.focusedElement&&o.focusedElement.focus(
{preventScroll:!0}),Ze.current=requestAnimationFrame(()=>{Ze.current=requestAnimationFrame(()=>{_.classList.remove("side\
bar-structural-transaction"),Ze.current=null})})},[uu]);Me(()=>()=>{for(let o of js.current.values())o.remove();js.current.
clear(),ei.current?.remove(),ei.current=null,be.current=null},[]);let fa=React.useCallback(o=>o.reduce((_,M)=>{let A=Ee(
M);return _.unread+=r.has(A)?0:d[A]||0,_.hasPrompt=_.hasPrompt||!!g[A]||!!Mr(y[A]),_.working=_.working||ya(ee[A]),_},{unread:0,
hasPrompt:!1,working:!1}),[r,d,g,y,ee]),Xr=React.useMemo(()=>fa(tr),[fa,tr]),ar=React.useMemo(()=>fa(nr),[fa,nr]),rr=React.
useMemo(()=>fa(sr),[fa,sr]),_s=React.useMemo(()=>lu.map(o=>{let _=Ee(o),M=$r(o,K[_]),A=xo(o,_,K[_],t[_]||[]),F=Tr(o,_,K[_]),
X=er[_]||"Unscoped",ue=[A,F,X,st[_]?.pinned?"Pinned":"",M.name,o?.agent_type,o?.workspace_name,o?.workspace_path,_].filter(
Boolean);return{id:_,session:o,groupLabel:X,title:A,subtitle:F,agentName:M.name,agentColor:M.color,working:ya(ee[_]),searchFields:ue,
searchText:ue.join(" ")}}),[lu,er,st,K,t,ee]),qt=React.useMemo(()=>xb(_s,Dr).slice(0,60),[_s,Dr]);Me(()=>{$t(o=>Math.max(
0,Math.min(o,qt.length-1)))},[qt.length]),Me(()=>{if(!ls)return;let o=requestAnimationFrame(()=>{Wr.current?.focus(),Wr.
current?.select()});return()=>cancelAnimationFrame(o)},[ls]),Me(()=>{ls&&document.getElementById(`quick-switcher-option-${nn}`)?.
scrollIntoView({block:"nearest"})},[nn,ls]),Me(()=>{let o=()=>{la(!1),za(""),$t(0),requestAnimationFrame(()=>Vn.current?.
focus())},_=A=>{A&&(Kn(A.id,A.session),bt(!1),o())},M=A=>{let F=ae(A.key).toLowerCase();if((A.metaKey||A.ctrlKey)&&!A.altKey&&
F==="p"){A.preventDefault(),Sn(!1),la(!0);return}if(ls){A.key==="Escape"?(A.preventDefault(),o()):A.key==="ArrowDown"?(A.
preventDefault(),$t(X=>qt.length?(X+1)%qt.length:0)):A.key==="ArrowUp"?(A.preventDefault(),$t(X=>qt.length?(X-1+qt.length)%
qt.length:0)):A.key==="Enter"&&qt.length>0&&(A.preventDefault(),_(qt[nn]||qt[0]));return}if(As){(A.key==="Escape"||A.key===
"?"&&!Fl(A.target))&&(A.preventDefault(),Sn(!1),requestAnimationFrame(()=>Vn.current?.focus()));return}if(A.altKey&&!A.ctrlKey&&
!A.metaKey&&(A.key==="ArrowUp"||A.key==="ArrowDown")){if(_s.length===0)return;A.preventDefault();let X=_s.findIndex(Oe=>Oe.
id===p),ue=A.key==="ArrowDown"?1:-1,me=ue>0?-1:0,Ie=(Math.max(X,me)+ue+_s.length)%_s.length;_(_s[Ie]);return}A.key==="?"&&
!A.altKey&&!A.ctrlKey&&!A.metaKey&&!Fl(A.target)&&(A.preventDefault(),Sn(!0))};return window.addEventListener("keydown",
M),()=>window.removeEventListener("keydown",M)},[p,nn,_s,ls,qt,As]);let P=React.useMemo(()=>q.find(o=>Ee(o)===p),[q,p]),
zn=p?qo:cm,wt=p&&n[p]||null,du=wp(P,zn),ti=p?N[p]:null,pu=p&&b[p]||"",fc=p&&g[p]||null,gc=p&&y[p]||null,mu=React.useMemo(
()=>{let o=ti&&typeof ti=="object"?ti:null,_=o?.goal||null,M=Array.isArray(o?.task_list?.tasks)?o.task_list.tasks.map(A=>`${A.
state||""}:${A.text||A.title||A.label||""}`).join("|"):"";return[pu,o?.kind||"",o?.label||"",o?.updatedAt||"",o?.startedAt||
"",o?.interruptHint||"",o?.thinkingContent||"",_?.status||"",_?.label||"",_?.objective||"",_?.time_used_seconds??_?.timeUsedSeconds??
"",_?.updated_at||"",M,fc?.id||fc?.request_id||"",gc?.id||gc?.request_id||"",wt?.messageId||"",wt?.content?.length||0,wt?.
open?"open":"closed"].join("")},[ti,pu,fc,gc,wt]),ni={sessionId:p,messageCount:zn.length,provisionalId:wt?.messageId||"",
provisionalLength:wt?.content?.length||0},of=Ae(null),cn=Ae(null),si=Ae(!0),ln=Ae(!0),fu=Ae(0),or=Ae(0),Qr=Ae(0),Jr=Ae(0),
hc=Ae(null),_c=Ae(null),gu=Ae(""),hu=Ae(p),Zr=Ae({sessionId:null,keys:[],scrollTop:0,scrollHeight:0,clientHeight:0,atBottom:!0}),
bc=Ae(null),eo=Ae(0),Vn=Ae(null),cf=Ae(null),vc=Ae(ni),yc=Ae(ni),to=Ae({}),ir=Ae({sessionId:null,index:0,scratch:""}),kc=Ae(
i),wc=Ae({}),_u=Ae({});vc.current=ni,Ma(()=>{hu.current=p},[p]),Me(()=>{let o=M=>{try{sessionStorage.setItem("agent-chat\
:last-window-error",JSON.stringify({message:M?.error?.message||M?.message||"Unknown window error",stack:M?.error?.stack||
"",at:new Date().toISOString()}))}catch{}},_=M=>{try{let A=M?.reason;sessionStorage.setItem("agent-chat:last-promise-err\
or",JSON.stringify({message:A?.message||ae(A,"Unhandled promise rejection"),stack:A?.stack||"",at:new Date().toISOString()}))}catch{}};
return window.addEventListener("error",o),window.addEventListener("unhandledrejection",_),()=>{window.removeEventListener(
"error",o),window.removeEventListener("unhandledrejection",_)}},[]),Me(()=>{try{let o=localStorage.getItem(om);o&&oa(JSON.
parse(o))}catch{}},[]),Me(()=>{try{localStorage.setItem(om,JSON.stringify(rs))}catch{}},[rs]),Me(()=>{try{localStorage.setItem(
"remote-agent-chat-theme",Ja)}catch{}document.documentElement.setAttribute("data-theme",Ja)},[Ja]),Me(()=>{if(!p&&q.length>
0){let o=new URLSearchParams(window.location.search).get("session"),_=o?q.find(F=>Ee(F)===o):null,M=_||q[0],A=Ee(M);A&&(Kn(
A,M),_&&window.history.replaceState({},"",window.location.pathname))}},[q,p]),Me(()=>{if(!("serviceWorker"in navigator))
return;let o=_=>{if(_.data?.type!=="push_notification_clicked")return;let M=_.data.data?.session_id,A=q.find(F=>Ee(F)===
M);M&&A&&Kn(M,A)};return navigator.serviceWorker.addEventListener("message",o),()=>navigator.serviceWorker.removeEventListener(
"message",o)},[q]),Me(()=>{if(!u)return;let o=q.find(_=>(typeof _=="string"?_:_?.session_id)===u);o&&(Kn(u,o),v(null))},
[u,q]),Me(()=>{let o=cn.current;if(!o)return;let _=null,M=()=>{fu.current=Date.now()+1200,or.current=0,Qr.current+=1,ln.
current&&(yc.current=vc.current,Ms(0))},A=Oe=>{Oe.deltaY<-1&&M()},F=Oe=>{let Nt=o.getBoundingClientRect();Oe.clientX>=Nt.
right-16&&M()},X=Oe=>{_=Oe.touches?.[0]?.clientY??null},ue=Oe=>{let Nt=Oe.touches?.[0]?.clientY??null;_!=null&&Nt!=null&&
Nt-_>4&&M()},me=Oe=>{["ArrowUp","PageUp","Home"].includes(Oe.key)&&M()},Ie=()=>{let Oe=o.scrollHeight-o.scrollTop-o.clientHeight<
80,Nt=Date.now(),it=Nt<fu.current,Tn=Nt<or.current;si.current=Oe,Oe?ln.current=!0:it&&!Tn&&(ln.current=!1,Jr.current=0),
it&&!Tn&&o.scrollTop<160&&hc.current?.(),ds(!Oe&&!ln.current),Zr.current={...Zr.current,scrollTop:o.scrollTop,scrollHeight:o.
scrollHeight,clientHeight:o.clientHeight,atBottom:Oe||ln.current}};return o.addEventListener("scroll",Ie,{passive:!0}),o.
addEventListener("wheel",A,{passive:!0}),o.addEventListener("touchstart",X,{passive:!0}),o.addEventListener("touchmove",
ue,{passive:!0}),o.addEventListener("pointerdown",F,{passive:!0}),window.addEventListener("keydown",me),()=>{o.removeEventListener(
"scroll",Ie),o.removeEventListener("wheel",A),o.removeEventListener("touchstart",X),o.removeEventListener("touchmove",ue),
o.removeEventListener("pointerdown",F),window.removeEventListener("keydown",me)}},[p]);function ai(o,_=2){let M=p,A=Qr.current+
1;Qr.current=A;let F=()=>{let me=cn.current;return!me||hu.current!==M||Qr.current!==A?!1:(or.current=Date.now()+800,ln.current=
!0,yc.current=vc.current,hn(me,me.scrollHeight),si.current=!0,ds(!1),Ms(0),Zr.current={sessionId:M,keys:o,scrollTop:me.scrollTop,
scrollHeight:me.scrollHeight,clientHeight:me.clientHeight,atBottom:!0},!0)};F();let X=Math.max(0,_),ue=()=>{X<=0||(X-=1,
F()&&requestAnimationFrame(ue))};X>0&&requestAnimationFrame(ue)}function lf(){if(!cn.current)return;let _=El(zn);Jr.current=
Date.now()+5e3,ai(_,4)}Ma(()=>{let o=cn.current;if(!o)return;let _=El(zn),M=Zr.current||{},A=M.sessionId===p,F=Array.isArray(
M.keys)?M.keys:[],X=F[0]||null,ue=F[F.length-1]||null,me=X?_.indexOf(X):-1,Ie=ue?_.indexOf(ue):-1,Oe=!!(A&&_.length===F.
length&&_.every((pn,Qt)=>pn===F[Qt])),Nt=(Number(M.scrollHeight)||0)-(Number(M.scrollTop)||0)-(Number(M.clientHeight)||0),
it=Date.now()<Jr.current,Tn=it||ln.current||M.atBottom!==!1||Nt<120,gr=!!(A&&F.length&&me>0&&Ie>=me);if(!(Oe&&!it&&!Tn))
if(!A)Gr(null),ai(_,3);else if(gr){if(ln.current=!1,Jr.current=0,o.dataset.transcriptWindowed!=="true"){let pn=o.scrollHeight-
(Number(M.scrollHeight)||0);or.current=Date.now()+500,hn(o,Math.max(0,(Number(M.scrollTop)||0)+pn));let Qt=_c.current,Xn=Qt?
Array.from(o.querySelectorAll(".message[data-message-key]")).find(po=>po.dataset.messageKey===Qt.messageKey):null;if(Xn){
let fi=Xn.getBoundingClientRect().top-Qt.viewportTop;Math.abs(fi)>=.5&&hn(o,Math.max(0,o.scrollTop+fi))}_c.current=null}}else
Tn&&ai(_,3);let Qe=o.scrollHeight-o.scrollTop-o.clientHeight<80;si.current=Qe,ds(!Qe&&!ln.current),Ms(Qe||ln.current?0:Ab(
yc.current,ni)),Zr.current={sessionId:p,keys:_,scrollTop:o.scrollTop,scrollHeight:o.scrollHeight,clientHeight:o.clientHeight,
atBottom:Qe||ln.current}},[p,zn,mu]),Me(()=>{p&&ne(p)},[p]),Me(()=>{ua(o=>{let _=Object.keys(o).filter(A=>!h[A]);if(_.length===
0)return o;let M={...o};return _.forEach(A=>delete M[A]),M})},[h]),Me(()=>{let o=Object.entries(Bn).filter(([,A])=>On[A]),
_=Object.entries(Fn).filter(([,A])=>On[A]);if(o.length>0){let A=new Set(o.map(([F])=>F));ua(F=>Object.fromEntries(Object.
entries(F).filter(([X])=>!A.has(X))))}if(_.length>0){let A=new Set(_.map(([F])=>F));Ho(F=>Object.fromEntries(Object.entries(
F).filter(([X])=>!A.has(X))));for(let[F,X]of _){let ue=ft.current.get(X);if(!ue)continue;let me=On[X];if(ft.current.delete(
X),me?.result==="ok")Bs(F,Ie=>String(Ie||"").trim().toLowerCase()===ue.command?"":Ie),jt(Ie=>({...Ie,[F]:{status:"succes\
s",requestId:X,text:ue.action==="pause"?"Goal paused":"Goal resumed"}})),Xe(ue.action==="pause"?"Goal paused":"Goal resu\
med");else{let Ie=me?.error?.message||"Native goal control did not apply.";jt(Oe=>({...Oe,[F]:{status:"failed",requestId:X,
text:`${Ie} Command retained; press Send to retry.`}}))}}}let M=[...o,..._].map(([,A])=>On[A]).find(A=>A?.result==="fail\
ed");M&&Xe(M.error?.message||(M.command==="agent_interrupt"?"Interrupt did not apply":"Goal control did not apply"))},[On,
Bn,Fn]),Me(()=>{!kc.current&&i&&Xe("Reconnected"),kc.current&&!i&&Xe("Disconnected \u2014 reconnecting..."),kc.current=i},
[i]);function Xe(o){Ba(o),setTimeout(()=>Ba(""),3e3)}function uf(o){let _=q.find(M=>Ee(M)===o);return _?xo(_,o,K[o],t[o]||
[]):o}function bu(o,_,M,A=""){vt.current&&clearTimeout(vt.current),ia({sessionId:o,kind:_,title:M,detail:A||uf(o)}),vt.current=
setTimeout(()=>{vt.current=null,ia(null)},8e3)}function vu(){vt.current&&clearTimeout(vt.current),vt.current=null,ia(null)}
Me(()=>()=>{vt.current&&clearTimeout(vt.current)},[]),Me(()=>{let o=ca.current,_=g||{},M=Object.keys(o).filter(A=>!_[A]);
M.length>0&&(yn(A=>{let F={...A};return M.forEach(X=>{F[X]?.kind==="prompt"&&delete F[X]}),F}),ia(A=>A?.kind==="prompt"&&
M.includes(A.sessionId)?null:A)),Object.entries(_).forEach(([A,F])=>{let X=F?.prompt_id||F?.request_id||F?.id||"prompt",
ue=o[A],me=ue?.prompt_id||ue?.request_id||ue?.id||null;if(X===me||(Fa.current&&is.completion_sound&&Mm(A,p)&&Rm("prompt"),
A===p))return;let Ie=F?.type==="question_prompt"||F?.kind==="question"?"Question needs an answer":"Permission needs atte\
ntion";yn(Oe=>({...Oe,[A]:{kind:"prompt",promptId:X}})),bu(A,"prompt",Ie)}),ca.current=_,Fa.current=!0},[g,p,is.completion_sound]),
Me(()=>{!p||Ot?.sessionId!==p||(vt.current&&clearTimeout(vt.current),vt.current=null,ia(null))},[p,Ot?.sessionId]),Me(()=>{
if(!tt||!Do)return;let o=!1;async function _(){for(let M of _t||[]){let A=M.session_id||M.session;if(!Qd(M,is)){ka(M,"su\
ppressed",{reasonCode:"client_preference"});continue}if(st[A]?.muted){ka(M,"suppressed",{reasonCode:"session_muted"});continue}
if(!Mm(A,p)){ka(M,"suppressed",{reasonCode:"focused_session"});continue}let F=await Jd(M);if(o)continue;if(!F){ka(M,"sup\
pressed",{reasonCode:"client_duplicate"});continue}ka(M,"claimed");let X=M.event_type;is.completion_sound&&Rm(X==="goal_\
attention"||X==="provider_usage_threshold"?"prompt":"completion"),A!==p&&yn(me=>({...me,[A]:{kind:X,dedupeKey:M.dedupe_key,
createdAt:M.created_at||new Date().toISOString()}})),bu(A,X,M.title,M.body),(typeof requestAnimationFrame=="function"?requestAnimationFrame:
me=>setTimeout(me,16))(()=>{o||ka(M,"displayed")})}}return _().catch(()=>{}),()=>{o=!0}},[_t,p,st,is,tt,Do]);function Bs(o,_){
o&&oa(M=>({...M,[o]:typeof _=="function"?_(M[o]||""):_}))}function Nc(o,_){o&&Dn(M=>{let A={...M};if(_===null)return delete A[o],
A;let F=A[o]||[];return Array.isArray(_)?A[o]=_:A[o]=[...F,_],A})}function df(o,_){o&&Dn(M=>{let A={...M},F=[...A[o]||[]];
return F.splice(_,1),F.length===0?delete A[o]:A[o]=F,A})}async function Sc(o,_,M,A){let F=await fetch("/upload",{method:"\
POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({filename:A,content:_,mimeType:M})});if(!F.ok)throw new Error(
"Upload failed");let{url:X}=await F.json();return Nc(o,{name:A,url:X,isText:!1,mimeType:M}),X}function yu(o,_,M,A){let F=Le(
o,_,M,A);return wc.current[F]={sessionId:o,filename:A,mimeType:M,base64:_,createdAt:Date.now()},Xe(`Sending image to Cod\
ex: ${A}`),F}Me(()=>{let o=Object.entries(On||{});for(let[_,M]of o){if(!_.startsWith("attach-")||_u.current[_])continue;
_u.current[_]=!0;let A=wc.current[_];if(delete wc.current[_],!!A){if(M?.result==="ok"){Xe(`Image attached to Codex: ${A.
filename}`);continue}(async()=>{try{await Sc(A.sessionId,A.base64,A.mimeType,A.filename),Xe(`Direct image attach failed \
\u2014 added ${A.filename} as a file link draft`)}catch{let F=M?.error?.message||M?.error?.code||"unknown error";Xe(`Ima\
ge attach failed: ${F}`)}})()}}},[On]);function cr(o){let _=o?.agent_type;return{limit:J_(_),..._==="codex_cli"||_==="cu\
rsor_cli"?{chunkBytes:Y_}:{}}}function Gv(o){let _=q.find(M=>Ee(M)===o);return cr(_)}function Kn(o,_){let M=qn.current===
o;Pn(o),Oa(o),qn.current=o,ir.current={sessionId:o,index:(to.current[o]||[]).length,scratch:""},f(A=>({...A,[o]:0})),yn(
A=>{if(!A[o])return A;let F={...A};return delete F[o],F}),Ot?.sessionId===o&&vu(),bt(!1),yt(!1),Lt(!1),Bt(!1),Gn(!1),M&&
setTimeout(()=>Ia(o,cr(_)),0)}function pf(o){let _=o?.session_id,M=Number(o?.message_id);if(!_||!Number.isSafeInteger(M)||
M<=0)return;let A=q.find(F=>Ee(F)===_)||{session_id:_,workspace_path:o.workspace_path||null,project_root:o.project_root||
null,workspace_name:o.workspace_name||null,agent_type:o.agent_type||null,status:"history"};ze.cancelRouteRestore(),bc.current=
null,Xa({sessionId:_,messageId:M}),Kn(_,A),Gn(!1)}async function mf(o){let _=Array.from(o.target.files||[]);if(_.length!==
0){o.target.value="";for(let M of _){if(M.size>2*1024*1024){Xe(`${M.name}: too large (max 2 MB)`);continue}if(td(M.name)&&
M.size<500*1024)await new Promise((A,F)=>{let X=new FileReader;X.onload=ue=>{Nc(p,{name:M.name,content:ue.target.result,
isText:!0}),A()},X.onerror=()=>{Xe(`Failed to read ${M.name}`),A()},X.readAsText(M)});else{wn(!0);try{await new Promise(
(A,F)=>{let X=new FileReader;X.onload=async ue=>{let me=ue.target.result.split(",")[1];(D?.capabilities||{}).send_attachment&&
M.type.startsWith("image/")?yu(p,me,M.type,M.name):(await Sc(p,me,M.type,M.name),Xe(`Uploaded: ${M.name}`)),A()},X.onerror=
()=>{Xe(`Failed to read ${M.name}`),A()},X.readAsDataURL(M)})}catch{Xe(`Upload failed: ${M.name}`)}finally{wn(!1)}}}}}async function ff(o){
let M=Array.from(o.clipboardData?.items||[]).find(ue=>ue.type.startsWith("image/"));if(!M||(o.preventDefault(),!p))return;
let A=M.getAsFile();if(!A)return;if(A.size>2*1024*1024){Xe("Image too large (max 2 MB)");return}let F=A.type==="image/jp\
eg"?"jpg":"png",X=`screenshot-${Date.now()}.${F}`;wn(!0);try{await new Promise(ue=>{let me=new FileReader;me.onload=async Ie=>{
let Oe=Ie.target.result.split(",")[1];(D?.capabilities||{}).send_attachment?yu(p,Oe,A.type,X):(await Sc(p,Oe,A.type,X),Xe(
"Screenshot attached")),ue()},me.onerror=()=>{Xe("Failed to read clipboard image"),ue()},me.readAsDataURL(A)})}catch{Xe(
"Paste upload failed")}finally{wn(!1)}}function ku(){if(Hs)return;let o=p&&rs[p]||"",_=p?vn[p]||[]:[],M=o.trim();if(!M&&
_.length===0||!p)return;let A=Up(o,{attachmentCount:_.length});if(A.kind!=="chat"){hf(A);return}let F="";if(_.length>0?(F=
_.map(ue=>{if(ue.isText){let me=hr(ue.name);return`\`${ue.name}\`
\`\`\`${me}
${ue.content}
\`\`\``}return(ue.mimeType||"").startsWith("image/")?`![${ue.name}](${ue.url})`:`[File: ${ue.name}](${ue.url})`}).join(`\


`),M&&(F+=`

${M}`)):F=M,le(p,F),M){let X=to.current[p]||[],ue=X[X.length-1]===M?X:[...X,M].slice(-100);to.current[p]=ue,ir.current={
sessionId:p,index:ue.length,scratch:""}}ps(X=>({...X,[p]:!1})),Ka(X=>({...X,[p]:Math.min(X[p]||0,(t[p]||[]).length)})),Bs(
p,""),Nc(p,null),yt(!1),Vn.current?.focus()}function Cc(){at.current&&clearTimeout(at.current),at.current=null,Et.current=
{sessionId:null,expiresAt:0},us(null)}function gf(){if(!p)return;let o=Date.now()+2500;Et.current={sessionId:p,expiresAt:o},
us(p),at.current&&clearTimeout(at.current),at.current=setTimeout(()=>{Et.current.sessionId===p&&Et.current.expiresAt===o&&
(Et.current={sessionId:null,expiresAt:0},at.current=null,us(null))},2500)}function xc(){if(!p||!h[p]||Bn[p]){Cc();return}
Cc(),Ac(p,P)}function Ac(o,_){if(!o||Bn[o])return null;let M=T(o,{sessionGeneration:_?.control_generation,turnGeneration:_?.
turn_generation});return ua(A=>({...A,[o]:M})),M}function Rc(o,_,M,A,F={}){if(!o||!M||Fn[o])return null;let X=H(o,_,M,{sessionGeneration:A?.
control_generation,requestId:F.requestId});return Ho(ue=>({...ue,[o]:X})),X}function hf(o){if(!p)return;let _=me=>{jt(Ie=>({
...Ie,[p]:{status:"failed",requestId:null,text:me}})),Xe(me),yt(!1)};if(o.kind==="unsupported_goal_control"){_("Unsuppor\
ted goal command. Use /goal resume or /goal pause.");return}if(!i){_("Goal control is offline. Command retained; reconne\
ct and press Send to retry.");return}if(Fn[p]){_("A goal control is already applying. Command retained.");return}let M=P?.
agent_type;if(!["codex","codex-desktop","codex_cli"].includes(M)||D?.capabilities?.goal_pause_resume!==!0||!Gs?.fingerprint||
Number(P?.control_generation)<=0){_("This session has no verified native goal control. Command retained.");return}let A=Gp(
o.action,Ws);if(A){Bs(p,""),jt(me=>({...me,[p]:{status:"success",requestId:null,text:A}})),Xe(A),yt(!1);return}if(o.action===
"resume"&&Ws==="blocked"&&D?.capabilities?.goal_blocked_resume!==!0){_("Blocked-goal resume is not verified for this ses\
sion. Command retained.");return}if(!(o.action==="pause"?Ws==="active":["paused","blocked"].includes(Ws))){_(`Goal state\
 is ${Ws||"unknown"}; refresh before retrying this command.`);return}let X=`goal-slash-${o.action}-${Date.now()}-${Math.
random().toString(36).slice(2,8)}`;if(ft.current.set(X,{action:o.action,command:o.command}),jt(me=>({...me,[p]:{status:"\
applying",requestId:X,text:"Validating goal, then applying native control\u2026"}})),!Rc(p,o.action,Gs,P,{requestId:X})){
ft.current.delete(X),_("Goal control could not be queued. Command retained; press Send to retry.");return}yt(!1)}Me(()=>()=>{
at.current&&clearTimeout(at.current)},[]),Me(()=>{Vt&&(Vt!==p||!h[Vt])&&Cc()},[p,h,Vt]);function _f(o){if((o.metaKey||o.
ctrlKey)&&o.key.toLowerCase()==="k"){o.preventDefault(),Vn.current?.focus();return}if(o.key==="Escape"){if(mt){yt(!1);return}
if(Hs)return;ri&&!lr&&(o.preventDefault(),Et.current.sessionId===p&&Et.current.expiresAt>=Date.now()?xc():gf());return}if(o.
key==="Enter"&&!o.shiftKey&&Et.current.sessionId===p&&Et.current.expiresAt>=Date.now()){o.preventDefault(),xc();return}let _=p?
to.current[p]||[]:[],M=ir.current,A=M.sessionId===p&&M.index>=0&&M.index<_.length;if(o.key==="ArrowUp"&&_.length>0&&(Yn===
""||A)){o.preventDefault();let F=M.sessionId===p?M:{sessionId:p,index:_.length,scratch:Yn};F.index=Math.max(0,F.index-1),
ir.current=F,Bs(p,_[F.index]);return}if(o.key==="ArrowDown"&&A){o.preventDefault();let F=Math.min(_.length,M.index+1);ir.
current={...M,index:F},Bs(p,F===_.length?M.scratch:_[F]);return}if(o.key==="Tab"&&mt&&ii.length>0){o.preventDefault(),Ju(
ii[0].command);return}o.key==="Enter"&&!o.shiftKey&&(o.preventDefault(),ku())}let ri=p?!!h[p]:!1,lr=p?!!Bn[p]:!1,Yn=p&&rs[p]||
"",Mc=p?vn[p]||[]:[],no=React.useCallback(()=>{let o=Vn.current;if(!o)return;let _=Math.max(42,Math.floor(window.innerHeight*
.4));o.style.height="auto";let M=Math.max(42,Math.min(o.scrollHeight,_));o.style.height=`${M}px`,o.style.overflowY=o.scrollHeight>
_?"auto":"hidden"},[]);Ma(()=>{no()},[p,Yn,no]),Me(()=>(window.addEventListener("resize",no),()=>window.removeEventListener(
"resize",no)),[no]);let ga=zn,wu=p&&$s[p]&&jr[p]||0,Ve=React.useMemo(()=>{let o=Math.min(wu,ga.length);return o<=0?ga:o>=
ga.length?cm:ga.slice(o)},[ga,wu]),bs=React.useMemo(()=>Ve.filter(o=>sb(o)),[Ve]),Tc=!fs&&!Ls&&!qs&&!gs&&!Ps&&!hs,ze=Bb(
{messages:bs,containerRef:cn,sessionId:p,routeActive:Tc}),Fs=React.useCallback(()=>{let o=cn.current;if(!o)return;let _=o.
scrollHeight-o.scrollTop-o.clientHeight<80;bc.current={sessionId:p,scrollTop:o.scrollTop,scrollHeight:o.scrollHeight,clientHeight:o.
clientHeight,atBottom:_},ze.prepareForRouteChange()},[p,ze.prepareForRouteChange]);Ma(()=>{if(!Tc||ze.enabled)return;let o=bc.
current;if(!cn.current||o?.sessionId!==p)return;let M=()=>{let A=cn.current;if(!A||o.sessionId!==p)return;let F=o.atBottom?
A.scrollHeight:Math.min(o.scrollTop,Math.max(0,A.scrollHeight-A.clientHeight));or.current=Date.now()+800,hn(A,F)};return M(),
eo.current=requestAnimationFrame(()=>{eo.current=0,M()}),()=>{eo.current&&cancelAnimationFrame(eo.current),eo.current=0}},
[p,Tc,ze.enabled]),Me(()=>{if(Xm)return window.__RAC_TRANSCRIPT_WINDOW__={total:bs.length,scrollToIndex:ze.scrollToIndex},
()=>{window.__RAC_TRANSCRIPT_WINDOW__?.scrollToIndex===ze.scrollToIndex&&delete window.__RAC_TRANSCRIPT_WINDOW__}},[bs.length,
ze.scrollToIndex]);let Ut=p&&g[p]||null,so=p&&y[p]||null,ao=Mr(so)?so:null,Nu=so&&!Mr(so)?so:null,Hs=Ut||ao,Wv=Ut?Ut.type===
"question_prompt"?"Question required":"Permission required":ao?ae(ao.title,"Action required"):null;Ma(()=>{let o=cn.current;
if(!o)return;let _=Ut?`${p||""}\0${Ut.prompt_id||Ut.request_id||Ut.id||"prompt"}`:"",M=gu.current;gu.current=_,_?(Qr.current+=
1,Jr.current=0,ln.current=!1,or.current=Date.now()+800,hn(o,0),si.current=o.scrollHeight-o.clientHeight<80,ds(!1),Ms(0)):
M&&ai(El(zn),3)},[p,Ut?.prompt_id,mu,zn]);let ha=p&&K[p]?.capabilities?.write_capability_gate||null,bf=!!(Yn.trim()||Mc.
length>0)&&!!p&&!kn&&!Hs&&!ha,Su=i?c?.state||"connecting":"offline",vf=c?.rttMs!=null?` \xB7 ${c.rttMs} ms`:"",Cu=Object.
entries(d).reduce((o,[_,M])=>r.has(_)?o:o+Number(M||0),0),oi=Object.keys(Io).filter(o=>o!==p&&!r.has(o)).length,xu=_n?.completed_at?
Date.now()-Date.parse(_n.completed_at):Number.POSITIVE_INFINITY,un=xu>=0&&xu<=1440*60*1e3?_n:null,ur=un?Eo.filter(o=>o.run_id!==
un.run_id):Eo,yf=Object.fromEntries((Pr?.coverage_matrix||[]).map(o=>[o.harness,o])),Au=Object.entries(Pr?.harnesses||{}).
sort(([o],[_])=>o.localeCompare(_)),ro=Rt.length>0||ur.length>0||!!un||!!ha,kf=Yn.startsWith("/")?Yn.slice(1).trim().toLowerCase():
"",ii=Yn.startsWith("/")?X_.filter(o=>o.command.slice(1).includes(kf)):[];Ma(()=>{let o=zo.current;if(!ro||!o){Vo(0);return}
let _=()=>Vo(Math.ceil(o.getBoundingClientRect().height));if(_(),typeof ResizeObserver>"u")return;let M=new ResizeObserver(
_);return M.observe(o),()=>M.disconnect()},[ro,Rt.length,ur.length,un?.run_id,ha]);let D=p&&K[p]||null,Ru=p?Object.values(
te||{}).filter(o=>o.sessionId===p):[],Mu=Ru.find(o=>o.status==="pending"||o.status==="awaiting_config")||null,ci=Ru.find(
o=>o.status==="failed")||null,dn=p&&s[p]||null,Us=p&&a[p]||null;Me(()=>{if(!p||!i||Je?.sessionId===p)return;let _=(t[p]||
[]).reduce((F,X)=>Math.max(F,Number(X?.sequence||0)),0);if(_>0){Ia(p,{afterSequence:_});return}let M=cr(P),A=P?.agent_type===
"codex_cli"||P?.agent_type==="cursor_cli"?"native":"relay_sqlite";sa(p,{...M,mode:"tail",source:A})},[p,i,P?.agent_type,
Je?.sessionId]),Me(()=>{if(!i||!Je||p!==Je.sessionId||(t[p]||[]).some(A=>String(A?.id)===String(Je.messageId)))return;let _=()=>sa(
p,{mode:"around",source:"relay_sqlite",aroundId:Je.messageId,limit:200,replace:!0,userInitiated:!0});_();let M=setTimeout(
_,600);return()=>clearTimeout(M)},[i,p,Je?.sessionId,Je?.messageId,t[p]]),Me(()=>{if(!Je||p!==Je.sessionId)return;let o=`\
[data-message-id="${Je.messageId}"]`,_=bs.findIndex(X=>String(X?.id)===String(Je.messageId));_>=0&&ze.scrollToIndex(_,"c\
enter");let M=0,A=null,F=setInterval(()=>{M++;let X=cn.current?.querySelector(o);X?(clearInterval(F),X.scrollIntoView({block:"\
center",behavior:"instant"}),A=setTimeout(()=>{Xa(ue=>ue?.sessionId===p&&String(ue?.messageId)===String(Je.messageId)?null:
ue)},5e3)):M>=40&&(clearInterval(F),Xa(null),Xe("Matched message could not be loaded"))},100);return()=>{clearInterval(F),
A&&clearTimeout(A)}},[p,Je?.sessionId,Je?.messageId,t[p],bs,ze.scrollToIndex]),Me(()=>{In(p?[p]:[])},[p,In]),Me(()=>{if(!p||
!i||!du)return;let o=cr(P);sa(p,{...o,mode:"tail",source:"native"})},[p,i,du]);let Ge=P?.agent_type==="antigravity-v2",oo=p?
ie[p]||[]:[],dr=p?Uo[p]:null,Tu=React.useMemo(()=>Ge&&dr?.id?oo.map(o=>!o?.kind||o.kind==="chat"?{...o,active:o.id===dr.
id}:o):oo,[oo,Ge,dr?.id]),$c=!!(p&&Object.prototype.hasOwnProperty.call(ie,p)),$u=Tu.filter(o=>!o?.kind||o.kind==="chat").
length,wf=!!(p&&Ge&&!rn),Ec=P?.agent_type==="antigravity"||P?.agent_type==="antigravity_panel"||P?.agent_type==="antigra\
vity-v2",Mn=P?wb(q,P):null,Eu=P?.agent_type==="codex"&&P?.visible_pane_visible?{pane_agent:P.visible_pane_agent||null,summary:hm(
P),sourceSession:P}:null,Nf=Mn?{pane_agent:Mn.panel_agent||null,summary:hm(Mn),sourceSession:Mn}:null,li=Eu||Nf,Sf=li?.summary||
"",Cf=li?.pane_agent||null,Lu=Sf||ql(Cf)||Tr(li?.sourceSession,Ee(li?.sourceSession)),qu=Lu,Lc=!!(P&&P.agent_type==="cod\
ex"&&P.visible_pane_visible&&P.visible_pane_agent==="codex"),xf=!!(P&&P.agent_type==="codex"&&P.visible_pane_visible&&P.
visible_pane_agent&&P.visible_pane_agent!=="codex"),et=$r(P||p,D),qc=p?er[p]:"",vs=P&&typeof P=="object"?P.workspace_path:
"",Pu=vs?vs.split(/[\\/]/).filter(Boolean).pop()||vs:"",Af=Pu||(qc&&qc!=="Unscoped"?qc:"")||ae(P?.workspace_name)||"Unsc\
oped",Iu=Ae(new Map),Pc=React.useMemo(()=>Ge&&dr?.title?{...P||{},native_chat_title:dr.title}:P,[P,Ge,dr?.title]),Ic=React.
useMemo(()=>{if(!p)return{title:"Agent Chat",source:"fallback",field:"no_session"};let o=Xc(Pc,Pc?.custom_display_name||
"",zn),_=Cd(Iu.current.get(p),o);return Iu.current.set(p,_),_},[p,Pc,zn]),Oc=Ic.title,ui=p?ec[p]:null,Rf=!!(et?.name==="\
Codex"&&P&&P.agent_type==="codex"&&(xf&&Mn||!Eu&&Mn&&(Mn.panel_agent==="antigravity_panel"||qu))),Ou=!!D?.capabilities?.
new_thread,Mf=P?.agent_type==="codex-desktop",Tf=P?.agent_type==="cursor",Du=Mf||Tf,Dc=Du?"New chat":"New thread",ju=P&&
typeof P=="object"?P.machine_label:"",Bu=Gm(P),Fu=React.useMemo(()=>{for(let o=Ve.length-1;o>=0;o--)if(Ve[o]?.role==="us\
er")return Ve[o];return null},[Ve]),jc=Fu?It(Fu.content).replace(/\s+/g," ").trim():"",_a=p?x[p]||P?.status||"unknown":"",
Hu=React.useCallback(o=>{let _=ae(o).replace(/\s+\((?:Lines?|Line)\s+\d+(?:-\d+)?\)\s*$/i,"").replace(/^["'`]+|["'`]+$/g,
"").trim();if(!_)return"";let M=_.replace(/\\/g,"/"),A=ae(vs).replace(/\\/g,"/").replace(/\/+$/,"");if(/^[A-Za-z]:\//.test(
M)||M.startsWith("//")){if(!A)return"";let F=M.toLowerCase(),X=A.toLowerCase();return F===X?".":F.startsWith(X+"/")?M.slice(
A.length+1):""}return M.replace(/^\.\/+/,"").replace(/^\/+/,"")},[vs]),Bc=React.useCallback((o,_)=>{if(!p)return;let M=Hu(
_);if(!M){Xe("File is outside the current workspace");return}Gr(A=>A&&A.sessionId===p&&A.messageKey===o&&A.path===M?null:
{sessionId:p,messageKey:o,path:M}),Vr.current(p,M)},[p,Hu]),Uu=React.useCallback(()=>Gr(null),[]),Pe=p?N[p]!==void 0?N[p]:
P&&typeof P=="object"?P.activity:null:null,Gs=Pe?.goal||null,Ws=String(Gs?.state||Gs?.status||"").toLowerCase(),pr=Ws===
"blocked",$f=pr&&D?.capabilities?.goal_blocked_resume===!0,io=Ws==="active"?"pause":Ws==="paused"||$f?"resume":null,Ef=pr?
ae(Gs?.block_reason||Gs?.reason||Pe?.label||"Goal blocked").trim():"",co=!!(io&&Gs?.fingerprint&&D?.capabilities?.goal_pause_resume===
!0&&Number(P?.control_generation)>0),Gu=!!(ri&&D?.capabilities?.interrupt===!0&&Number(P?.control_generation)>0&&Number(
P?.turn_generation)>0),Fc=Pe?.context_card||null,Lf=!!(p&&jc&&!((P?.agent_type==="cline"||P?.agent_type==="roo_code")&&Fc)),
lo=["claude_cli","codex_cli","cursor_cli"].includes(P?.agent_type),Wu=React.useMemo(()=>{for(let o=Ve.length-1;o>=0;o--)
if(Ve[o]?.role==="assistant")return Ve[o];return null},[Ve]),mr=p?(b[p]||"").trim():"",zu=Wu?It(Wu.content).trim():"",qf=!!(Pe&&
!Pe?.thinking&&!Pe?.current&&!Pe?.task_list&&Ll(mr)),Vu=!!(p&&!wt&&Pe&&(Pe.kind==="thinking"||Pe.kind==="generating")&&!Pe?.
thinking&&!Pe?.current&&!qf&&Ll(mr)&&(P?.agent_type==="codex"||P?.agent_type==="codex-desktop"||P?.agent_type==="cursor"||
P?.agent_type==="antigravity_panel")&&mr!==zu&&!zu.includes(mr)),Ku=!!(Pe&&(Pe?.goal||Pe?.thinking||Pe?.current||Pe?.step||
Pe?.usage||Pe?.task_list||Pe.kind!=="idle"||Ll(mr||Pe.thinkingContent||""))),di=!!(p&&dn?.partial&&Number(dn.total||0)>Number(
dn.loaded||Ve.length||0)),Yu=Number(dn?.loaded||Ve.length||0),Pf=Number(dn?.total||Yu||0);function Xu(){if(!p)return;if(!ze.
prepareForPrepend()){let _=cn.current,M=_?.getBoundingClientRect(),A=M?.top||0,F=_?Array.from(_.querySelectorAll(".messa\
ge[data-message-key]")):[],X=F.find(ue=>{let me=ue.getBoundingClientRect();return me.top>=A&&me.top<M.bottom})||F.find(ue=>ue.
getBoundingClientRect().bottom>A)||F[0]||null;_c.current=X?{messageKey:X.dataset.messageKey,viewportTop:X.getBoundingClientRect().
top}:null}let o=P?.agent_type==="codex_cli"||P?.agent_type==="cursor_cli"?"native":"relay_sqlite";sa(p,{mode:dn?.cursor?
"older":"tail",source:o,userInitiated:!0,beforeOffset:dn?.cursor?.next_before_offset,beforeId:dn?.cursor?.next_before_id,
...cr(P)})}Me(()=>(hc.current=di&&!Us?Xu:null,()=>{hc.current=null}),[p,P?.agent_type,Us,di,dn?.cursor?.next_before_offset,
dn?.cursor?.next_before_id]);function If(){if(!p)return;let o=P?.agent_type==="codex_cli"||P?.agent_type==="cursor_cli"?
"native":"relay_sqlite";sa(p,{...cr(P),mode:"tail",source:o,userInitiated:!0})}let Of=!!(p&&(Ve.length>0||Vu||wt)),Df=Hl(
et),jf=React.useMemo(()=>bs.slice(ze.start,ze.end).map((o,_)=>{let M=ze.start+_,A=Kl(o,M),F=Je?.sessionId===p&&String(o?.
id)===String(Je?.messageId),X=ze.enabled||F||M>=Math.max(0,bs.length-48),ue=Qa?.sessionId===p&&Qa?.messageKey===A?Qa:null,
me=React.createElement(Ob,{key:A,msg:o,messageKey:A,activeAgent:et,assistantMonospace:lo,autoExpandLongCodeBlocks:Ec,onOpenPath:Bc,
agentType:P?.agent_type,preview:ue,fileContents:Pa,onClosePreview:Uu,deliveryState:o._cid?S[o._cid]:null,onSteer:zr,onRetry:Qo,
richContentEager:X,searchMatch:F});return ze.enabled?React.createElement(jb,{key:A,index:M,messageKey:`${p||""}${A}`,onMeasure:ze.
onMeasure},me):me}),[bs,ze.start,ze.end,ze.enabled,ze.onMeasure,p,Je?.sessionId,Je?.messageId,Df,lo,Ec,Bc,P?.agent_type,
Qa,Pa,Uu,S,zr,Qo]),fr=D?.capabilities?.thread_list,uo=!!P?.is_new_chat_draft,Bf=!!(p&&(P?.agent_type==="codex-desktop"||
P?.agent_type==="cursor")&&fr&&(re[p]?.length>0||$s[p]||uo)&&!rn),Ff=React.useMemo(()=>{let o=[...re[p]||[]];if(o.length===
0)return o;let _=kt[p],M=_?o.findIndex(F=>F.id===_):-1,A=M>=0?M:o.findIndex(F=>F.active);if(A>0){let[F]=o.splice(A,1);o.
unshift(F)}return o},[p,re,kt]),Hf=React.useMemo(()=>{let o=kt[p],_=(re[p]||[]).find(F=>F?.active),M=_?.cache_key||_?.id,
A=$s[p]||uo?"draft":"";return`${p||"none"}:${A||o||M||"default"}`},[p,re,kt,$s,uo]),Qu=Ve.length===0;React.useEffect(()=>{
p&&fr&&Qu&&I(p)},[p,fr,Qu]),React.useEffect(()=>{if(!(p&&Ge&&i))return;Q(p);let o=[600,1800,4200].map(F=>setTimeout(()=>{
typeof document<"u"&&document.hidden||Q(p)},F)),_=()=>{typeof document<"u"&&document.hidden||Q(p)},M=setInterval(_,3e4),
A=()=>_();return typeof document<"u"&&document.addEventListener("visibilitychange",A),()=>{o.forEach(F=>clearTimeout(F)),
clearInterval(M),typeof document<"u"&&document.removeEventListener("visibilitychange",A)}},[p,Ge,i]),React.useEffect(()=>{
p&&Ge&&(sn(!0),Lt(!1))},[p,Ge]),React.useEffect(()=>{if(!(p&&Ge))return;let o=oo.find(_=>(!_?.kind||_.kind==="chat")&&_.
active);o&&Ts(_=>{let M=_[p];if(!M||M.id!==o.id&&Date.now()-(M.at||0)<15e3)return _;let A={..._};return delete A[p],A})},
[p,Ge,oo]),React.useEffect(()=>{if(!(p&&fr&&(Du||Xt)))return;I(p);let o=setInterval(()=>I(p),Xt?3e3:5e3);return()=>clearInterval(
o)},[p,P?.agent_type,fr,Xt]),React.useEffect(()=>{if(!p)return;let o=jr[p]||0,_=ga.length;o>_&&Ka(M=>({...M,[p]:_}))},[p,
jr,ga.length]),React.useEffect(()=>{!p||Ve.length===0||ps(o=>o[p]?{...o,[p]:!1}:o)},[p,Ve.length]),React.useEffect(()=>{
if(!p)return;let o=re[p]||[],_=kt[p];_&&o.some(M=>M.id===_&&M.active)&&ms(M=>{let A={...M};return delete A[p],A})},[p,re,
kt]);function pi(o=p){o&&(ps(_=>({..._,[o]:!0})),ms(_=>{let M={..._};return delete M[o],M}),Ka(_=>({..._,[o]:(t[o]||[]).
length})),Bt(!1),ge(o))}function Hc(o,_){o&&_&&(ps(M=>({...M,[o]:!1})),ms(M=>({...M,[o]:_})),Ka(M=>({...M,[o]:0})),W(o,_))}
function ba(o=p){o&&(sn(!0),Lt(!1),Ts(_=>({..._,[o]:{id:"__agv2:new_conversation",title:"New Conversation",kind:"nav",at:Date.
now()}})),V(o))}function Uc(o,_=p){if(!(_&&o))return;sn(!0),Lt(!1);let M=(ie[_]||[]).find(F=>F?.id===o),A=o==="__agv2:ne\
w_conversation"?"New Conversation":o==="__agv2:conversation_history"?"Conversation History":o==="__agv2:scheduled_tasks"?
"Scheduled Tasks":"Antigravity v2";if(Ts(F=>({...F,[_]:{id:o,title:M?.title||A,kind:M?.kind||"chat",at:Date.now()}})),o===
"__agv2:new_conversation"){ba(_);return}U(_,o)}function Uf(o){p&&(ir.current={sessionId:p,index:(to.current[p]||[]).length,
scratch:o},Bs(p,o),yt(o.startsWith("/")))}function Ju(o){if(!p)return;let M={"/plan":`${o} Outline the implementation ap\
proach and major steps.`,"/review":`${o} Review the current changes for bugs, regressions, and missing tests.`,"/fix":`${o}\
 Implement or repair the current issue.`,"/summarize":`${o} Summarize the current state and important changes.`}[o]||`${o}\
 `;Bs(p,M),yt(!1),requestAnimationFrame(()=>Vn.current?.focus())}function Gf(o,_=!1,M=""){let A=Ee(o),F=Qm.has(A)?Sr(o):
null,X=js.current.get(A);return X||(X=document.createElement("div"),X.className="sidebar-card-host",X.setAttribute("data\
-sidebar-card-host",A),js.current.set(A,X)),ReactDOM.createPortal(React.createElement(Gb,{session:o,health:x[A],unread:r.
has(A)?0:d[A]||0,isThinking:!!h[A]||!!Ci(N[A],{health:x[A]}),isActive:A===p,agentConfig:K[A]||null,activity:N[A]||null,sessionMessages:t[A]||
[],hasBlockingPrompt:!!g[A]||!!Mr(y[A]),blockingPromptLabel:g[A]?g[A].type==="question_prompt"?"Question required":"Perm\
ission required":y[A]?.title||"Action required",muted:!!st[A]?.muted,pinned:_,workspaceLabel:M,recentMessageAt:F?.at||null,
menuOpen:rc===A,onMenuToggle:ue=>jo(me=>ue?A:me===A?"":me),onPinChange:ue=>Ko(A,{pinned:ue}).catch(me=>{Xe(me?.message||
`Unable to ${ue?"pin":"unpin"} chat`)}),onSelect:()=>Kn(A,o),onManage:()=>{Nn(A),Tt(!0),Ke(!1),Mt(!1)},onClose:()=>{let ue=x[A]===
"disconnected"||!x[A],me=ue?"Remove session from the list?":`Close session "${A}"?`;window.confirm(me)&&Wt(A,ue)},onAutomations:o?.
agent_type==="codex-desktop"?()=>{fs||Fs(),Hn(ue=>!ue),Un(!1),an(!1),Cn(!1),xn(!1),bt(!1)}:void 0,showAutomationsActive:fs,
onSkills:o?.agent_type==="codex-desktop"?()=>{Ls||Fs(),Un(ue=>!ue),Hn(!1),an(!1),Cn(!1),xn(!1),bt(!1),La[A]||qa(A)}:void 0,
showSkillsActive:Ls}),X,A)}function mi(o,_=!0){let M=Ee(o);return React.createElement("div",{key:M,className:`sidebar-ca\
rd-slot${_?"":" sidebar-card-slot-filtered"}`,"data-sidebar-card-slot":M,"aria-hidden":_?void 0:"true",inert:_?void 0:""})}
return React.createElement("div",{className:`app${ro?" has-system-banner":""}`,style:ro?{"--system-banner-height":`${cc}\
px`}:void 0},ls&&React.createElement("div",{className:"quick-switcher-overlay",onMouseDown:o=>{o.target===o.currentTarget&&
(la(!1),za(""),$t(0),requestAnimationFrame(()=>Vn.current?.focus()))}},React.createElement("div",{className:"quick-switc\
her",role:"dialog","aria-modal":"true","aria-label":"Switch session"},React.createElement("div",{className:"quick-switch\
er-input-wrap"},React.createElement("span",{"aria-hidden":"true"},"\u2315"),React.createElement("input",{ref:Wr,className:"\
quick-switcher-input",value:Dr,onChange:o=>{za(o.target.value),$t(0)},placeholder:"Search sessions, projects, or harness\
es","aria-label":"Search sessions","aria-controls":"quick-switcher-results","aria-activedescendant":qt.length?`quick-swi\
tcher-option-${nn}`:void 0,autoComplete:"off",spellCheck:"false"}),React.createElement("kbd",null,"Esc")),React.createElement(
"div",{className:"quick-switcher-results",id:"quick-switcher-results",role:"listbox"},qt.length===0?React.createElement(
"div",{className:"quick-switcher-empty"},"No matching sessions"):qt.map((o,_)=>React.createElement("button",{type:"butto\
n",role:"option",id:`quick-switcher-option-${_}`,"aria-selected":_===nn,className:`quick-switcher-option${_===nn?" selec\
ted":""}${o.id===p?" active":""}`,key:o.id,onMouseEnter:()=>$t(_),onClick:()=>{Kn(o.id,o.session),bt(!1),la(!1),za(""),$t(
0),requestAnimationFrame(()=>Vn.current?.focus())}},React.createElement("span",{className:"quick-switcher-dot",style:{background:o.
agentColor}}),React.createElement("span",{className:"quick-switcher-copy"},React.createElement("span",{className:"quick-\
switcher-title"},o.title),React.createElement("span",{className:"quick-switcher-meta"},o.groupLabel," \xB7 ",o.agentName,
o.subtitle?` \xB7 ${o.subtitle}`:"")),o.id===p&&React.createElement("span",{className:"quick-switcher-current"},"Current")))),
React.createElement("div",{className:"quick-switcher-footer"},React.createElement("span",null,React.createElement("kbd",
null,"\u2191"),React.createElement("kbd",null,"\u2193")," Navigate"),React.createElement("span",null,React.createElement(
"kbd",null,"Enter")," Switch"),React.createElement("span",null,qt.length," of ",_s.length)))),As&&React.createElement("d\
iv",{className:"shortcut-help-overlay",onMouseDown:o=>{o.target===o.currentTarget&&Sn(!1)}},React.createElement("div",{className:"\
shortcut-help",role:"dialog","aria-modal":"true","aria-label":"Keyboard shortcuts"},React.createElement("div",{className:"\
shortcut-help-header"},React.createElement("strong",null,"Keyboard shortcuts"),React.createElement("button",{type:"butto\
n",onClick:()=>Sn(!1),"aria-label":"Close keyboard shortcuts"},"\xD7")),React.createElement("div",{className:"shortcut-h\
elp-list"},React.createElement("div",null,React.createElement("span",null,"Switch session"),React.createElement("kbd",null,
"Ctrl/Cmd P")),React.createElement("div",null,React.createElement("span",null,"Previous / next session"),React.createElement(
"kbd",null,"Alt \u2191 / \u2193")),React.createElement("div",null,React.createElement("span",null,"Focus composer"),React.
createElement("kbd",null,"Ctrl/Cmd K")),React.createElement("div",null,React.createElement("span",null,"Send / newline"),
React.createElement("kbd",null,"Enter / Shift Enter")),React.createElement("div",null,React.createElement("span",null,"O\
pen / close this guide"),React.createElement("kbd",null,"?"))),React.createElement("div",{className:"shortcut-help-note"},
"Shortcuts never switch or submit while you are typing unless they include Ctrl/Cmd or Alt."))),Fo&&React.createElement(
"div",{className:"shortcut-help-overlay revalidation-ledger-backdrop",role:"presentation",onMouseDown:o=>{o.target===o.currentTarget&&
Va(!1)}},React.createElement("div",{className:"revalidation-ledger",role:"dialog","aria-modal":"true","aria-label":"Harn\
ess revalidation program health"},React.createElement("div",{className:"shortcut-help-header"},React.createElement("stro\
ng",null,"Harness revalidation program"),React.createElement("button",{type:"button",onClick:()=>Va(!1),"aria-label":"Cl\
ose validation health"},"\xD7")),React.createElement("p",{className:"revalidation-ledger-summary"},"Continuous version w\
atch, nightly tier-1, and staggered weekly tier-2. Write controls fail closed after drift until the installed version pa\
sses its required tiers."),Au.length===0?React.createElement("div",{className:"revalidation-ledger-empty"},"Program heal\
th has not been published by the updated sentinel yet."):React.createElement("div",{className:"revalidation-ledger-table\
-wrap"},React.createElement("table",{className:"revalidation-ledger-table"},React.createElement("thead",null,React.createElement(
"tr",null,React.createElement("th",null,"Harness"),React.createElement("th",null,"Version"),React.createElement("th",null,
"Fixture"),React.createElement("th",null,"Tier 1"),React.createElement("th",null,"Tier 2"),React.createElement("th",null,
"Write gate"),React.createElement("th",null,"Next tier 2"))),React.createElement("tbody",null,Au.map(([o,_])=>{let M=yf[o]||
{},A=M.tier2||{},F=_.last_tier2_status||(A.mode==="gated"?"gated":"scheduled");return React.createElement("tr",{key:o},React.
createElement("th",{scope:"row"},o),React.createElement("td",null,_.installed_version||"not installed"),React.createElement(
"td",null,M.fixture?"covered":"missing"),React.createElement("td",null,M.tier1?"covered":"missing"),React.createElement(
"td",{className:`validation-state-${F}`},F),React.createElement("td",{className:`validation-state-${_.status||"pending"}`},
_.status==="pass"?"available":_.status||"pending"),React.createElement("td",null,_.next_tier2_at?new Date(_.next_tier2_at).
toLocaleString():"unscheduled"))})))))),React.createElement("div",{className:`overlay ${Po?"open":""}`,onClick:()=>bt(!1)}),
ro&&React.createElement("div",{className:`duplicate-proxy-banner${un?.status==="pass"&&Rt.length===0&&ur.length===0&&!ha?
" app-update-pass":""}`,role:un?.status==="pass"&&Rt.length===0&&ur.length===0&&!ha?"status":"alert",ref:zo},Rt.length>0&&
React.createElement(React.Fragment,null,React.createElement("strong",null,"Duplicate proxy detected."),React.createElement(
"span",null,Rt.length," session",Rt.length===1?"":"s"," claimed by multiple proxies. Stop the extra proxy to prevent con\
flicting controls.")),ur.length>0&&React.createElement(React.Fragment,null,React.createElement("strong",null,"Nightly va\
lidation failed."),React.createElement("span",null,ur.map(o=>`${o.harness} (${o.app_version})`).join(", "),". Check the \
validation ledger before using affected controls.")),un&&React.createElement(React.Fragment,null,React.createElement("st\
rong",null,un.status==="pass"?"App update validated.":"App update drift validation failed."),React.createElement("span",
null,un.harness," ",un.previous_app_version," -> ",un.app_version,". ",un.status==="pass"?"Harness controls remain avail\
able.":"A triage item was added to the maturity backlog.")),ha&&React.createElement(React.Fragment,null,React.createElement(
"strong",null,"Harness writes paused."),React.createElement("span",null,ha,". Read-only transcript access remains availa\
ble.")),Pr&&React.createElement("button",{type:"button",className:"validation-health-link",onClick:()=>Va(!0)},"View pro\
gram health")),React.createElement("div",{className:`sidebar ${Po?"open":""}`},React.createElement("div",{className:"sid\
ebar-header"},React.createElement("span",{className:"logo"},"\u232C"),React.createElement("span",{style:{flex:1}},"Agent\
 Sessions"),React.createElement("button",{className:`new-session-btn notification-settings-btn${Fo?" active":""}`,title:"\
Harness validation health","aria-label":"Harness validation health",onClick:()=>Va(!0)},"V"),React.createElement("button",
{className:`new-session-btn notification-settings-btn${As?" active":""}`,title:"Keyboard shortcuts (?)","aria-label":"Ke\
yboard shortcuts",onClick:()=>{Sn(o=>!o),la(!1)}},"?"),React.createElement("button",{className:`new-session-btn notifica\
tion-settings-btn${lt?" active":""}`,title:"Notification settings","aria-label":"Notification settings",onClick:()=>{Ke(
o=>!o),Mt(!1),Tt(!1)}},"\u2662"),React.createElement("button",{className:`new-session-btn notification-settings-btn${Ha?
" active":""}`,title:"Manage sessions","aria-label":"Manage sessions",onClick:()=>{Nn(p&&(An||!r.has(p))?p:Ee(k[0])||""),
Tt(o=>!o),Mt(!1),Ke(!1)}},"\u22EF"),React.createElement("button",{className:`new-session-btn${tn?" active":""}`,title:"N\
ew session",onClick:()=>{Mt(o=>!o),Ke(!1),Tt(!1)}},"+")),React.createElement("div",{className:"sidebar-session-search"},
React.createElement("input",{type:"search",value:ja,onChange:o=>os(o.target.value),placeholder:"Filter sessions","aria-l\
abel":"Filter sidebar sessions",autoComplete:"off",spellCheck:"false"}),ja&&React.createElement("button",{type:"button",
onClick:()=>os(""),"aria-label":"Clear sidebar filter",title:"Clear filter"},"x")),React.createElement("div",{className:`\
sidebar-order-control${Zo?" changed":""}`,"aria-hidden":!Zo,"aria-live":"polite"},React.createElement("span",null,"Order\
 changed"),React.createElement("button",{type:"button",onClick:tf,disabled:!Zo,tabIndex:Zo?0:-1},"Sort now")),lt&&React.
createElement(rv,{onClose:()=>Ke(!1),onPreferencesChange:o=>{Cs({...o,turn_ready:!1}),Ye(!0)}}),Ha&&React.createElement(
ov,{sessions:k,preferences:st,initialSessionId:Dt,onSave:Ko,onExport:pc,onClose:()=>Tt(!1)}),tn&&React.createElement(Zb,
{launchStates:R,onLaunch:(o,_,M)=>O(o,_,M),onResume:(o,_,M,A)=>dt(o,_,M,A),onClose:()=>Mt(!1),workspaces:$a,showTestSessions:An}),
React.createElement(Vl,{structureKey:sf,placements:nf,prepareStructureChange:af,finishStructureChange:rf},React.createElement(
"div",{className:"session-list",ref:Y,onPointerDown:()=>{qe.current+=1,Be()},onPointerUp:()=>rt(80),onPointerCancel:()=>rt(
80),onWheel:()=>{qe.current+=1,Be(),rt(180)},onTouchStart:()=>{qe.current+=1,Be()},onKeyDown:o=>{["ArrowUp","ArrowDown",
"PageUp","PageDown","Home","End"," "].includes(o.key)&&(qe.current+=1,Be(),rt(180))},onScroll:o=>{let _=We.current;if(_&&
Math.abs(o.currentTarget.scrollTop-_.target)<=.5){We.current=null;return}qe.current+=1,Be(),rt(180)}},q.length===0&&!tn&&
React.createElement("div",{className:"session-empty"},"No agents connected"),q.length>0&&ot&&tr.length===0&&nr.length===
0&&sr.length===0&&cu.length===0&&React.createElement("div",{className:"session-empty"},"No matching sessions"),Ht.length>
0&&React.createElement("section",{className:`session-group working-session-group${ot&&tr.length===0?" sidebar-group-filt\
ered":""}`,"aria-label":"Working now"},React.createElement("div",{className:"session-group-header"},React.createElement(
"span",{className:"working-session-group-icon","aria-hidden":"true"},"W"),React.createElement("span",{className:"session\
-group-name pinned-session-group-name"},"Working now"),React.createElement("span",{className:"session-group-status-slot"},
Xr.hasPrompt&&React.createElement("span",{className:"session-group-alert",title:"Action required"},"!"),React.createElement(
"span",{className:"session-group-working",title:"Sessions working"}),Xr.unread>0&&React.createElement("span",{className:"\
session-group-unread",title:`${Xr.unread} unread`},Xr.unread>99?"99+":Xr.unread),React.createElement("span",{className:"\
session-group-count"},tr.length))),React.createElement("div",{className:"session-group-items"},React.createElement("div",
{className:"session-group-items-inner"},Ht.map(o=>mi(o,!ot||tr.includes(o)))))),on.length>0&&React.createElement("sectio\
n",{className:`session-group recent-session-group${Ft.__recent__&&!ot?" collapsed":""}${ot&&nr.length===0?" sidebar-grou\
p-filtered":""}`,"aria-label":"Recent chats"},React.createElement("div",{className:"session-group-header"},React.createElement(
"button",{type:"button",className:"session-group-toggle",title:`${Ft.__recent__?"Expand":"Collapse"} Recent chats`,"aria\
-label":`${Ft.__recent__?"Expand":"Collapse"} Recent chats`,"aria-expanded":!Ft.__recent__||!!ot,onClick:()=>Yo("__recen\
t__")},React.createElement("span",{className:"session-group-caret","aria-hidden":"true"},Ft.__recent__&&!ot?">":"v")),React.
createElement("span",{className:"recent-session-group-icon","aria-hidden":"true"},"R"),React.createElement("span",{className:"\
session-group-name pinned-session-group-name"},"Recent chats"),React.createElement("span",{className:"session-group-stat\
us-slot"},ar.hasPrompt&&React.createElement("span",{className:"session-group-alert",title:"Action required"},"!"),ar.working&&
React.createElement("span",{className:"session-group-working",title:"Session working"}),ar.unread>0&&React.createElement(
"span",{className:"session-group-unread",title:`${ar.unread} unread`},ar.unread>99?"99+":ar.unread),React.createElement(
"span",{className:"session-group-count"},nr.length))),React.createElement("div",{className:"session-group-items"},React.
createElement("div",{className:"session-group-items-inner"},on.map(o=>mi(o,!ot||nr.includes(o)))))),Wn.length>0&&React.createElement(
"section",{className:`session-group pinned-session-group${ot&&sr.length===0?" sidebar-group-filtered":""}`,"aria-label":"\
Pinned chats"},React.createElement("div",{className:"session-group-header"},React.createElement("span",{className:"sessi\
on-group-pin-icon","aria-hidden":"true"},"\u{1F4CC}"),React.createElement("span",{className:"session-group-name pinned-s\
ession-group-name"},"Pinned chats"),React.createElement("span",{className:"session-group-status-slot"},rr.hasPrompt&&React.
createElement("span",{className:"session-group-alert",title:"Action required"},"!"),rr.working&&React.createElement("spa\
n",{className:"session-group-working",title:"Session working"}),rr.unread>0&&React.createElement("span",{className:"sess\
ion-group-unread",title:`${rr.unread} unread`},rr.unread>99?"99+":rr.unread),React.createElement("span",{className:"sess\
ion-group-count"},sr.length))),React.createElement("div",{className:"session-group-items"},React.createElement("div",{className:"\
session-group-items-inner"},Wn.map(o=>mi(o,!ot||sr.includes(o)))))),Rn.map(o=>{let _=!!Ft[o.key]&&!ot,A=cu.find(X=>X.key===
o.key)?.sessions||[],F=fa(A);return React.createElement("div",{className:`session-group${_?" collapsed":""}${ot&&A.length===
0?" sidebar-group-filtered":""}`,key:o.key},React.createElement("div",{className:"session-group-header"},React.createElement(
"button",{type:"button",className:"session-group-toggle",title:`${_?"Expand":"Collapse"} ${o.label}`,"aria-label":`${_?"\
Expand":"Collapse"} ${o.label}`,"aria-expanded":!_,onClick:()=>Yo(o.key)},React.createElement("span",{className:"session\
-group-caret","aria-hidden":"true"},_?">":"v")),React.createElement(ji,{title:o.label,disclosureKey:o.key,kind:"group",wrapperClassName:"\
session-group-title-details",triggerClassName:"session-group-name",disclosureClassName:"session-group-disclosure",triggerLabel:`\
Show full group name: ${o.label}`}),React.createElement("span",{className:"session-group-status-slot"},F.hasPrompt&&React.
createElement("span",{className:"session-group-alert",title:"Action required"},"!"),F.working&&React.createElement("span",
{className:"session-group-working",title:"Session working"}),F.unread>0&&React.createElement("span",{className:"session-\
group-unread",title:`${F.unread} unread`},F.unread>99?"99+":F.unread),React.createElement("span",{className:"session-gro\
up-count"},ot?A.length:o.sessions.length))),React.createElement("div",{className:"session-group-items","aria-hidden":_},
React.createElement("div",{className:"session-group-items-inner"},o.sessions.map(X=>mi(X,!ot||A.includes(X))))))}),mc.map(
o=>{let _=Ee(o);return Gf(o,!!st[_]?.pinned,ef.has(_)?"":er[_]||"Unscoped")}))),React.createElement("div",{className:"si\
debar-footer"},React.createElement("span",{className:`status-dot ${Su}`}),React.createElement("span",{className:"sidebar\
-footer-health"},React.createElement("span",null,i?`Relay ${Su}`:"Reconnecting\u2026"),React.createElement("span",{className:"\
sidebar-footer-rtt"},i&&vf.replace(/^\s*·\s*/,"")||"\xA0")),React.createElement("button",{type:"button",className:`side\
bar-footer-action test-session-toggle${An?" active":""}`,title:An?"Hide test sessions":`Show test sessions (${r.size})`,
"aria-label":An?"Hide test sessions":"Show test sessions","aria-pressed":An,onClick:()=>dc(o=>!o)},"T",r.size>99?"99+":r.
size||""),React.createElement("button",{type:"button",className:`sidebar-footer-action${qs?" active":""}`,title:"Usage a\
nd limits","aria-label":"Usage and limits",onClick:()=>{qs||Fs(),Cn(o=>!o),xn(!1),Hn(!1),Un(!1),Mt(!1),Ke(!1),Tt(!1),an(
!1),Gn(!1),bt(!1)}},"\u25D4"),React.createElement("button",{type:"button",className:`sidebar-footer-action host-resource\
-footer-action${gs?" active":""}`,title:"Host resources","aria-label":"Host resources",onClick:()=>{gs||Fs(),xn(o=>!o),Cn(
!1),an(!1),Hn(!1),Un(!1),Mt(!1),Ke(!1),Tt(!1),Gn(!1),bt(!1)}},"R"),React.createElement("button",{type:"button",className:`\
sidebar-footer-action fleet-footer-action${Ps?" active":""}`,title:"Fleet view","aria-label":"Fleet view",onClick:()=>{Ps||
Fs(),an(o=>!o),Cn(!1),xn(!1),Hn(!1),Un(!1),Mt(!1),Ke(!1),Tt(!1),Gn(!1),bt(!1)}},"\u25A6"),React.createElement("button",{
type:"button",className:`sidebar-footer-action transcript-search-footer-action${hs?" active":""}`,title:"Search all tran\
scripts","aria-label":"Search all transcripts",onClick:()=>{hs||Fs(),Gn(o=>!o),an(!1),Cn(!1),xn(!1),Hn(!1),Un(!1),Mt(!1),
Ke(!1),Tt(!1),bt(!1)}},"\u2315"),React.createElement("a",{href:"/agent-chat.apk",download:!0,className:"apk-download-lin\
k",title:"Download Android APK"},"\u2B07 APK"))),React.createElement("div",{className:`main${fs||Ls||qs||gs||Ps||hs?" au\
tomations-active":""}`},React.createElement(Lv,{connected:i,error:bn,history:as,subscription:Ns,onRefresh:Ss,onSubscribe:Ir,
onUnsubscribe:pt,onOpen:()=>{gs||Fs(),xn(!0),Cn(!1),an(!1),Hn(!1),Un(!1),Mt(!1),Ke(!1),Tt(!1),Gn(!1),bt(!1)}}),fs&&React.
createElement(Av,{sessions:e,onBack:()=>Hn(!1)}),Ls&&React.createElement(Fv,{skills:La[p]||null,onRefresh:()=>p&&qa(p),onBack:()=>Un(
!1)}),Ua&&p&&React.createElement(iv,{sessionId:p,initialContent:Yn,jobs:Fe.filter(o=>o.session_id===p),onSchedule:ht,onCancel:en,
onCreated:()=>Bs(p,""),onClose:()=>cs(!1)}),qs&&React.createElement(Tv,{usage:ss,refreshReceipt:tc,resetReceipt:aa,costDetail:ra,
onBack:()=>Cn(!1),onRefresh:ws,onWatch:nc,onConsumeResetCredit:sc,onRequestCostDetail:ac}),gs&&React.createElement(qv,{snapshot:Lo,
error:bn,history:as,details:zt,subscription:Ns,onBack:()=>xn(!1),onRefresh:Ss,onSubscribe:Ir,onUnsubscribe:pt}),Ps&&React.
createElement(jv,{sessions:l,activities:N,thinking:h,permissionPrompts:g,errorPrompts:y,messages:t,agentConfigs:K,sessionAttention:Io,
health:x,connected:i,deliveryStates:S,stopPending:Bn,goalControlPending:Fn,onBroadcastSend:le,onInterrupt:Ac,onGoalControl:Rc,
onBack:()=>an(!1),onSelectSession:(o,_)=>{Kn(o,_),an(!1)}}),hs&&React.createElement(Bv,{onBack:()=>Gn(!1),onOpenResult:pf}),
!fs&&!Ls&&!qs&&!gs&&!Ps&&!hs&&React.createElement(React.Fragment,null,React.createElement("div",{className:"topbar"},React.
createElement("button",{className:"hamburger",onClick:()=>bt(o=>!o)},"\u2630",Cu>0&&React.createElement("span",{className:"\
hamburger-badge"},Cu),oi>0&&React.createElement("span",{className:"hamburger-attention",title:`${oi} session${oi===1?"":
"s"} need attention`,"aria-label":`${oi} sessions need attention`},"!")),React.createElement("div",{className:"topbar-co\
ntext"},p?React.createElement(React.Fragment,null,React.createElement("div",{className:"topbar-title-row",role:"group","\
aria-label":`${et.name} chat: ${Oc}`},React.createElement("div",{className:"agent-badge topbar-agent-badge",style:{color:et.
color,borderColor:et.color+"55",background:et.color+"18"}},et.logo?React.createElement("img",{src:et.logo,alt:et.abbr,className:"\
agent-badge-logo"}):et.abbr),React.createElement("div",{className:"topbar-title-group",style:{color:et.color}},React.createElement(
"div",{className:"topbar-title-projection","data-chat-title-source":Ic.source,"data-chat-title-field":Ic.field},React.createElement(
ji,{title:Oc,disclosureKey:`topbar-${p}`,kind:"chat",wrapperClassName:"topbar-title-details",triggerClassName:"topbar-ti\
tle",disclosureClassName:"topbar-title-disclosure",triggerLabel:`Show full chat title: ${Oc}`,triggerTag:"div"})),React.
createElement("div",{className:"topbar-subtitle",title:vs||void 0},React.createElement("span",{className:"topbar-workspa\
ce-icon"},"\u2302"),Af,D?.branch&&D.branch!=="unknown"&&React.createElement("button",{className:`topbar-branch-btn${Fr?"\
 active":""}`,title:`Branch: ${D.branch}`,onClick:()=>{let o=!Fr;Ya(o),o&&Ea(p)}},React.createElement("span",{className:"\
topbar-branch-icon"},"\u2442"),D.branch)))),React.createElement("div",{className:"topbar-meta"},React.createElement("but\
ton",{className:"theme-toggle-btn",onClick:()=>lc(o=>o==="light"?"dark":"light"),title:"Toggle Light/Dark Mode"},Ja==="l\
ight"?"\u{1F319}":"\u2600\uFE0F"),React.createElement("span",{className:`context-pill topbar-relay-status ${i?"ok":"warn"}`,
title:i?"Relay connected":"Relay disconnected \u2014 reconnecting"},i?"relay live":"reconnecting"),React.createElement("\
span",{className:`context-pill topbar-proxy-health ${_a==="healthy"?"ok":_a==="degraded"?"warn":_a==="disconnected"?"err\
or":""}`,title:`Proxy: ${_a||"connecting"}`},React.createElement("span",{className:"topbar-health-dot"}),_a==="healthy"?
"live":_a==="degraded"?"degraded":_a==="disconnected"?"offline":"connecting"),ju&&React.createElement("span",{className:"\
context-pill",title:"Remote machine"},ju),Bu&&React.createElement("span",{className:"context-pill",title:"Native editor \
host"},Bu),React.createElement(Mb,{session:P,config:D,providerUsage:ss,onOpenUsage:()=>{Fs(),Cn(!0),xn(!1),an(!1)}}),(co||
pr)&&React.createElement("button",{type:"button",className:"context-pill session-control-pill goal-control",onClick:()=>co&&
Rc(p,io,Gs,P),disabled:!co||!i||!!Fn[p],"aria-label":co?`${io==="pause"?"Pause":pr?"Resume blocked":"Resume"} goal`:"Goa\
l blocked; resolve in the native session",title:pr?Ef||"No verified native unblock action is available":void 0},Fn[p]?io===
"pause"?"Pausing goal...":"Resuming goal...":io==="pause"?"Pause goal":pr?co?"Resume blocked goal":"Goal blocked \xB7 nativ\
e action required":"Resume goal"),Gu&&React.createElement("button",{type:"button",className:"context-pill session-contro\
l-pill interrupt-control",onClick:()=>Ac(p,P),disabled:!i||!!Bn[p],"aria-label":"Interrupt turn"},Bn[p]?"Interrupting...":
"Interrupt turn"),P?.agent_type==="codex"&&P?.visible_pane_visible&&React.createElement("span",{className:`context-pill ${Lc?
"ok":"warn"}`,title:Lc?"This Codex session is the visible right-hand pane":`Visible right-hand pane is ${Lu}`},Lc?"right\
 pane live":`right pane: ${ql(P.visible_pane_agent)||"other"}`),Ve.length>0&&React.createElement("span",{className:"cont\
ext-pill",title:"Messages in this session"},Ve.length," msg",Ve.length!==1?"s":""),(D?.capabilities?.chat_list||Ge)&&React.
createElement("button",{className:`context-pill chat-list-toggle${(Ge?Yt:Kt)?" active":""}`,title:Ge?`${Yt?"Hide":"Show"}\
 Agent Manager projects and conversations`:"View conversations",onClick:()=>{if(Ge){sn(_=>!_),Lt(!1),Q(p);return}let o=!Kt;
Lt(o),o&&Q(p)}},Ge?"projects":"chats"),D?.capabilities?.thread_list&&React.createElement("button",{className:`context-pi\
ll chat-list-toggle${Xt?" active":""}`,title:"View threads",onClick:()=>{let o=!Xt;Bt(o),o&&I(p)}},"threads"),(D?.capabilities?.
terminal_output||D?.capabilities?.terminal_input)&&React.createElement("button",{className:`context-pill terminal-toggle${Es?
" active":""}`,title:"Open terminal controls",onClick:()=>{let o=!Es;pa(o),o&&D?.capabilities?.terminal_output&&z(p)}},"\
terminal"),D?.capabilities?.file_changes&&React.createElement("button",{className:`context-pill diff-toggle${Br?" active":
""}`,title:"View file changes",onClick:()=>{let o=!Br;Go(o),o&&ye(p)}},"changes"),ui?.visible&&React.createElement("span",
{className:"context-pill ok",title:ui.title||"Automation"},"automation"),D?.capabilities?.file_browser&&React.createElement(
"button",{className:`context-pill files-toggle${rn?" active":""}`,title:"Browse workspace files",onClick:()=>{let o=!rn;
Wo(o),o&&(ma(null),Hr("."),qr(p,"."))}},"files"),D?.capabilities?.open_panel&&React.createElement("button",{className:"c\
ontext-pill open-panel-btn",title:"Open panel in Antigravity",onClick:()=>Z(p)},"open panel"),D?.capabilities?.native_window&&
React.createElement("button",{className:"context-pill open-panel-btn",title:`Open this ${ql(P?.agent_type)||"CLI"} sessi\
on in a native command window`,onClick:o=>he(p,o)},"native"),ri&&Pe?.label&&Pe.label!=="Generating"&&React.createElement(
"span",{className:"context-pill thinking",title:Pe.label},Pe.label.length>40?Pe.label.substring(0,40)+"\u2026":Pe.label))):
React.createElement("div",{className:"topbar-title-group"},React.createElement("div",{className:"topbar-title"},"Agent C\
hat"),React.createElement("div",{className:"topbar-subtitle"},"Select a session to inspect its transcript and status")))),
(P?.agent_type==="cline"||P?.agent_type==="roo_code")&&Fc&&React.createElement("div",{className:`cline-context-strip ${P?.
agent_type==="roo_code"?"roo-context-strip":""}`},React.createElement(Kb,{card:Fc,tone:P?.agent_type==="roo_code"?"roo":
"cline"})),Fr&&p&&D?.capabilities?.branch_list&&React.createElement(pv,{branchData:Lr[p]||null,sessionId:p,currentBranch:D?.
branch,onSwitch:o=>{ta(p,o),Ya(!1)},onCreate:o=>{ns(p,o),Ya(!1)},onClose:()=>Ya(!1)}),rn&&p&&D?.capabilities?.file_browser&&
React.createElement(Nv,{sessionId:p,listing:$o[p],fileContents:Pa,viewingFile:Ur,onNavigate:o=>{Hr(o),ma(null),qr(p,o)},
onOpenFile:o=>{ma(o),na(p,o)},onBackToListing:()=>ma(null),onRefresh:()=>{Ur?na(p,Ur):qr(p,ic)},onClose:()=>{Wo(!1),ma(null)}}),
React.createElement("div",{className:`messages-wrap${ui?.visible?" has-automation-pane":""}`,style:rn?{display:"none"}:void 0},
Bf&&React.createElement(dv,{threads:Ff,activeThreadId:kt[p]||null,showDraftTab:!!$s[p]||uo,newLabel:Dc,onSwitch:o=>Hc(p,
o),onNew:()=>pi(p),onOpenHistory:()=>{I(p),Bt(!0)}}),Lf&&React.createElement("div",{className:"last-user-banner",title:jc},
React.createElement("span",{className:"last-user-banner-icon"},"\u21B5"),React.createElement("span",{className:"last-use\
r-banner-text"},jc)),Rf&&React.createElement("div",{className:"rate-limit-overlay warning"},React.createElement("span",{
className:"rate-limit-icon"},"\u2318"),React.createElement("span",{className:"rate-limit-text"},"The visible right-hand \
pane for this workspace is showing ",React.createElement("strong",null,qu||Tr(Mn,Ee(Mn))),", not this transcript."),React.
createElement("button",{className:"context-pill",onClick:()=>Kn(Ee(Mn),Mn),title:"Switch to the live right-hand pane ses\
sion"},"View live pane")),wf&&React.createElement("div",{className:`agv2-session-nav${Yt?"":" collapsed"}`},React.createElement(
"div",{className:"agv2-session-nav-header"},React.createElement("div",{className:"agv2-session-nav-copy"},React.createElement(
"span",{className:"agv2-session-nav-title"},"Agent Manager"),React.createElement("span",{className:"agv2-session-nav-met\
a"},$u," conversation",$u===1?"":"s")),React.createElement("button",{className:"agv2-session-nav-btn",type:"button",onClick:()=>Q(
p),title:"Refresh Agent Manager conversations"},"Refresh"),React.createElement("button",{className:"agv2-session-nav-btn",
type:"button",onClick:()=>{sn(o=>!o),Q(p)},title:Yt?"Hide Agent Manager conversations":"Show Agent Manager conversations"},
Yt?"Hide":"Show")),Yt&&React.createElement(Il,{items:Tu,embedded:!0,loading:!$c,onNavigate:o=>Uc(o),onNew:()=>ba(p)})),oc&&
!Hs&&React.createElement("button",{className:"jump-to-newest",onClick:lf},Rs>0?`\u2193 ${Rs} new`:"\u2193 Jump to Newest"),
React.createElement("div",{className:`messages harness-theme harness-theme-${ae(P?.agent_type||"default").replace(/[^a-z0-9_-]/gi,
"-")}`,"data-agent-type":P?.agent_type||"default","data-layout":Sb(P?.agent_type),"data-transcript-windowed":ze.enabled?
"true":"false","data-total-message-count":bs.length,"data-window-start":ze.start,"data-window-end":ze.end,key:Hf,ref:cn},
Of&&React.createElement("div",{className:"messages-flex-spacer"}),Ut&&React.createElement(Xb,{prompt:Ut,sessionId:p,agentType:P?.
agent_type,onRespond:w,onDismissFocus:()=>Vn.current?.focus()}),ao&&!Ut&&React.createElement(Qb,{prompt:ao,sessionId:p,onRespond:E}),
(P?.rate_limit_active||P?.percent_used!=null&&P.percent_used>=75)&&React.createElement("div",{className:`rate-limit-over\
lay${P?.rate_limit_active||P?.percent_used>=90?" critical":P?.percent_used>=75?" warning":""}`},React.createElement("spa\
n",{className:"rate-limit-icon"},P?.rate_limit_active?"\u23F3":"\u{1F4CA}"),React.createElement("span",{className:"rate-\
limit-text"},P?.rate_limit_active?React.createElement(React.Fragment,null,"Rate limited",P.rate_limited_until&&P.rate_limited_until!==
"unknown"?React.createElement(React.Fragment,null," \u2014 resets ",React.createElement("strong",null,Ro(P.rate_limited_until))):
null):React.createElement(React.Fragment,null,"Used ",React.createElement("strong",null,P.percent_used,"%")," of session\
 limit",P.rate_limited_until&&P.rate_limited_until!=="unknown"?React.createElement(React.Fragment,null," \xB7 resets ",React.
createElement("strong",null,Ro(P.rate_limited_until))):null))),di&&React.createElement("div",{className:"history-tail-ba\
nner"},React.createElement("span",null,"Showing latest ",Yu.toLocaleString()," of ",Pf.toLocaleString()," messages"),React.
createElement("button",{type:"button",onClick:Xu,disabled:!!Us},Us?"Loading older messages...":"Load older messages")),p&&
Us&&Ve.length>0&&!di&&React.createElement("div",{className:"history-tail-banner history-refresh-banner",role:"status"},React.
createElement("span",null,"Refreshing latest messages...")),p&&dn?.error&&React.createElement("div",{className:"history-\
tail-banner history-error-inline",role:"alert"},React.createElement("span",null,dn.error),React.createElement("button",{
type:"button",onClick:If,disabled:!!Us},"Retry transcript")),p?Ve.length===0&&!wt&&fr&&P?.is_list_view&&re[p]?.length>0&&
!$s[p]&&!uo?React.createElement("div",{className:"thread-picker-empty"},React.createElement("div",{className:"thread-pic\
ker-header"},"Select a chat"),React.createElement("div",{className:"thread-picker-list"},re[p].map((o,_)=>React.createElement(
"button",{key:o.cache_key||o.id||_,className:`thread-picker-item${o.active?" active":""}`,onClick:()=>{Hc(p,o.id)},title:o.
title},React.createElement("span",{className:"thread-picker-title"},o.title||"Untitled"),o.age&&React.createElement("spa\
n",{className:"thread-picker-age"},o.age)))),React.createElement("button",{className:"thread-picker-new",onClick:()=>pi(
p)},"+ New Thread")):Ve.length===0&&!wt&&Ge&&P?.is_list_view?React.createElement("div",{className:"thread-picker-empty a\
gv2-picker-empty"},React.createElement("div",{className:"thread-picker-header"},"Choose a conversation or start a new on\
e"),Yt?null:ie[p]?.length>0?React.createElement(Il,{items:ie[p]||[],embedded:!0,loading:!$c,onNavigate:o=>Uc(o),onNew:()=>ba(
p)}):React.createElement("button",{className:"thread-picker-new",onClick:()=>ba(p)},"+ New Conversation")):Ve.length===0&&
!wt&&Ge&&ie[p]?.length>0?React.createElement("div",{className:"thread-picker-empty agv2-picker-empty"},React.createElement(
"div",{className:"thread-picker-header"},"Select an Antigravity project or conversation"),!Yt&&React.createElement(Il,{items:ie[p]||
[],embedded:!0,loading:!$c,onNavigate:o=>Uc(o),onNew:()=>ba(p)})):Ve.length===0&&!wt&&P?.is_list_view&&ie[p]?.length>0?React.
createElement("div",{className:"thread-picker-empty"},React.createElement("div",{className:"thread-picker-header"},"Sele\
ct a conversation or type a new message"),React.createElement("div",{className:"thread-picker-list"},ie[p].map((o,_)=>React.
createElement("button",{key:o.id||_,className:`thread-picker-item${o.active?" active":""}`,onClick:()=>U(p,o.id),title:o.
title},React.createElement("span",{className:"thread-picker-title"},o.title||"Untitled"))))):Ve.length===0&&!wt&&Us?React.
createElement("div",{className:"empty-state history-loading-state"},React.createElement("span",{className:"new-session-s\
pinner"}),React.createElement("div",null,Us.mode==="older"?"Loading older messages...":"Loading latest messages...")):Ve.
length===0&&!wt?React.createElement("div",{className:"empty-state"},React.createElement("div",{className:"icon"},"\u{1F4AC}"),
React.createElement("div",null,"No messages yet")):React.createElement(React.Fragment,null,ze.enabled&&React.createElement(
"div",{className:"transcript-window-spacer top","data-testid":"transcript-window-top-spacer",style:{height:`${ze.topSpacerHeight}\
px`}}),jf,ze.enabled&&React.createElement("div",{className:"transcript-window-spacer bottom","data-testid":"transcript-w\
indow-bottom-spacer",style:{height:`${ze.bottomSpacerHeight}px`}})):React.createElement("div",{className:"empty-state"},
React.createElement("div",{className:"icon"},"\u{1F916}"),React.createElement("div",null,"Select an agent session")),wt&&
React.createElement(qb,{stream:wt,activeAgent:et,monospace:lo}),Vu&&React.createElement("div",{className:`message assist\
ant live-draft${lo?" monospace":""}`,"data-message-role":"assistant","data-message-timestamp":Qn(Pe?.started_at||Pe?.updated_at)?.
iso||"unknown"},React.createElement("div",{className:"assistant-gutter"},React.createElement("div",{className:"agent-bad\
ge transcript-agent-badge",style:{color:et.color,borderColor:et.color+"55",background:et.color+"18"}},et.logo?React.createElement(
"img",{src:et.logo,alt:et.abbr,className:"agent-badge-logo"}):et.abbr)),React.createElement("div",{className:"assistant-\
content"},React.createElement("div",{className:"message-role"},React.createElement("span",{className:"message-role-label"},
et.name),React.createElement(Qi,{instant:Pe?.started_at||Pe?.updated_at})),React.createElement(yr,{content:mr,monospace:lo,
autoExpandLongCodeBlocks:Ec,onOpenPath:o=>Bc("live-draft",o)}))),Nu&&!Ut&&React.createElement(Jb,{prompt:Nu,sessionId:p,
onRespond:E}),React.createElement("div",{ref:of})),React.createElement(Rv,{view:ui,onShow:()=>p&&To(p)})),(Pe?.task_list||
Ku)&&!rn&&React.createElement("div",{className:"transcript-live-footer","data-testid":"transcript-live-footer"},Pe?.task_list&&
!Pe?.step&&React.createElement("div",{className:"session-tasklist-strip"},React.createElement(Vb,{taskList:Pe.task_list,
sessionId:p})),Ku&&React.createElement("div",{className:"composer-live-status-strip"},React.createElement(zb,{activity:Pe,
thinkingText:p&&b[p]||"",agentType:P?.agent_type,pinned:!0}))),Bo&&p&&React.createElement(cv,{session:P||p,config:D,configControlStates:te,
onRequestRefresh:ne,onSetModel:(o,_)=>oe(o,_),onSetEffort:(o,_)=>G(o,_),onSetPermissionMode:(o,_)=>de(o,_),onSetAutoApprovePermissions:(o,_)=>Ne(
o,_),onSetMode:(o,_)=>J&&J(o,_),onSetCodexConfig:o=>ve(p,o),onSwitchWorkspace:(o,_)=>$(o,_),onClose:()=>Wa(!1)}),!1,Kt&&
p&&D?.capabilities?.chat_list&&!Ge&&React.createElement(lv,{chats:ie[p]||[],sessionId:p,onSwitch:o=>{U(p,o),Lt(!1)},onNew:()=>{
V(p),Lt(!1)},onClose:()=>Lt(!1)}),Xt&&p&&D?.capabilities?.thread_list&&React.createElement(uv,{threads:re[p]||[],sessionId:p,
newLabel:Dc,onSwitch:o=>{Hc(p,o),Bt(!1)},onNew:()=>{pi(p),Bt(!1)},onClose:()=>Bt(!1)}),!rn&&Es&&p&&(D?.capabilities?.terminal_output||
D?.capabilities?.terminal_input)&&React.createElement(mv,{entries:we[p]||[],canRead:!!D?.capabilities?.terminal_output,canInput:!!D?.
capabilities?.terminal_input,onRefresh:()=>z(p),onSend:o=>fe(p,o),controlResults:On,onClose:()=>pa(!1)}),!rn&&Br&&p&&D?.
capabilities?.file_changes&&React.createElement(fv,{entries:Te[p]||[],onRefresh:()=>ye(p),onAccept:o=>Ce(p,o,"accept"),onReject:o=>Ce(
p,o,"reject"),onClose:()=>Go(!1)}),React.createElement("div",{className:`input-area composer-skin-${gm(P?.agent_type)}`,
"data-composer-skin":gm(P?.agent_type),style:rn?{display:"none"}:void 0},React.createElement("label",{className:`attach-\
btn ${!p||!i||Hs?"disabled":""}`,title:"Attach file"},React.createElement("svg",{width:"18",height:"18",viewBox:"0 0 24 \
24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"},React.createElement(
"path",{d:"M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-\
8.48"})),React.createElement("input",{type:"file",hidden:!0,multiple:!0,ref:cf,onChange:mf,disabled:!p||!i||!!Hs})),React.
createElement("div",{className:"input-col"},Mc.length>0&&React.createElement("div",{className:"file-chips"},Mc.map((o,_)=>React.
createElement("div",{key:_,className:"file-chip"},React.createElement("span",null,"\u{1F4C4} ",o.name,o.isText?"":" (upl\
oaded)"),React.createElement("button",{onClick:()=>df(p,_)},"\xD7")))),mt&&ii.length>0&&React.createElement("div",{className:"\
slash-menu"},ii.map(o=>React.createElement("button",{key:o.command,type:"button",className:"slash-item",onClick:()=>Ju(o.
command)},React.createElement("span",{className:"slash-command"},o.command),React.createElement("span",{className:"slash\
-detail"},o.detail)))),p&&da[p]&&React.createElement("div",{className:`goal-command-notice ${da[p].status}`,role:da[p].status===
"failed"?"alert":"status","data-request-id":da[p].requestId||void 0},React.createElement("strong",null,"Goal control"),React.
createElement("span",null,da[p].text)),p&&(Se[p]||[]).length>0&&React.createElement("div",{className:"queued-bar"},(Se[p]||
[]).map(o=>React.createElement(Fb,{key:o.cid,qm:o,onSteer:()=>De(p,o.cid,o.content,o.nativeIndex),onDiscard:()=>j(p,o.cid),
onEdit:_=>se(p,o.cid,_)}))),React.createElement("div",{className:"textarea-row"},React.createElement("textarea",{ref:Vn,
value:Yn,onChange:o=>Uf(o.target.value),onKeyDown:_f,onPaste:ff,placeholder:Hs?`Resolve the ${Ut?.type==="question_promp\
t"?"question":Ut?"permission prompt":"error prompt"} above to continue`:p?window.innerWidth<600?"Enter message\u2026":"M\
essage\u2026 (/ for commands)":"Select a session",disabled:!p||!!Hs,rows:1}),React.createElement("div",{className:"texta\
rea-btns"},p&&React.createElement("button",{className:`composer-gear-btn schedule-send-btn${Ua?" active":""}`,onClick:()=>cs(
o=>!o),title:"Schedule this message","aria-label":"Schedule message"},"\u25F7"),p&&React.createElement("button",{className:`\
composer-gear-btn${ke?" active":""}`,onClick:()=>xs(o=>!o),title:"Toggle settings"},"\u2699"),Ou&&React.createElement("b\
utton",{className:"composer-gear-btn mobile-hide",onClick:()=>pi(p),title:Dc},"\u270E"),(D?.capabilities?.chat_list||Ge)&&
React.createElement("button",{className:`composer-gear-btn mobile-hide${(Ge?Yt:Kt)?" active":""}`,onClick:()=>{if(Ge){sn(
_=>!_),Lt(!1),Q(p);return}let o=!Kt;Lt(o),o&&Q(p)},title:Ge?"Agent Manager conversations":"Chat history"},"\u2630"),D?.capabilities?.
thread_list&&React.createElement("button",{className:`composer-gear-btn mobile-hide${Xt?" active":""}`,onClick:()=>{let o=!Xt;
Bt(o),o&&I(p)},title:"Thread history"},"\u229F"),D?.capabilities?.open_panel&&React.createElement("button",{className:"c\
omposer-gear-btn mobile-hide",onClick:()=>Z(p),title:"Open panel"},"\u229E"),D?.capabilities?.native_window&&React.createElement(
"button",{className:"composer-gear-btn mobile-hide",onClick:o=>he(p,o),title:"Open native command window"},"cmd"),D?.capabilities?.
new_chat&&React.createElement("button",{className:"composer-gear-btn mobile-hide",onClick:()=>Ge?ba(p):V(p),title:Ge?"Ne\
w Antigravity conversation":"New chat"},"+"),Gu?React.createElement("button",{className:`stop-btn${lr?" pending":""}`,title:lr?
"Interrupting\u2026":"Interrupt agent",disabled:lr,onClick:xc},lr?React.createElement("span",{className:"stop-btn-spinne\
r"}):"\u25A0"):React.createElement("button",{className:"send-btn",onClick:ku,disabled:!bf,title:i?"Send":"Queue until re\
connected"},kn?"\u2026":"\u2191"))),React.createElement("div",{className:"composer-meta"},Vt===p&&ri&&!lr&&React.createElement(
"span",{className:"interrupt-confirm-inline",role:"status","aria-live":"polite"},"Press Esc again or Enter to interrupt"),
(Bl(P?.agent_type)||Co(P?.agent_type))&&D?.mode&&D.mode!=="unknown"&&React.createElement("span",{className:"composer-hin\
t",style:{color:"#d29922"}},D.mode),(Bl(P?.agent_type)||Co(P?.agent_type))&&D?.model_id&&D.model_id!=="unknown"&&React.createElement(
"span",{className:"composer-hint",style:{color:"#d29922"}},D.model_id),P?.agent_type==="codex_cli"&&D?.config_semantics===
"observed_and_next_send"&&React.createElement("span",{className:"composer-hint",style:{color:"#8b949e"}},"Observed ",D.observed_model_id||
"unknown"," / ",D.observed_effort||"unknown"," \xB7 ","Next ",D.next_send_model_id||"unset"," / ",D.next_send_effort||"u\
nset"),P?.agent_type==="antigravity-v2"&&D?.model_id&&D.model_id!=="unknown"&&React.createElement("span",{className:"com\
poser-hint",style:{color:"#8b949e"}},D.model_id),(P?.agent_type==="antigravity"||P?.agent_type==="antigravity_panel")&&(Array.
isArray(P?.antigravity_quota_models)&&P.antigravity_quota_models.length>0?React.createElement("span",{className:"compose\
r-hint",style:{color:"#8b949e"}},Um(P.antigravity_quota_models,4)):P?.percent_used!=null?React.createElement("span",{className:"\
composer-hint",style:{color:P.percent_used>=90?"#f85149":P.percent_used>=75?"#d29922":"#8b949e"}},"Quota ",P.percent_used,
"%",P?.rate_limited_until&&P.rate_limited_until!=="unknown"?` \xB7 ${P.rate_limited_until}`:""):null),React.createElement(
"span",{className:"composer-hint"},"Enter send"),React.createElement("span",{className:"composer-hint"},"Shift+Enter new\
line"),React.createElement("span",{className:"composer-hint"},"Ctrl/Cmd+K focus"),React.createElement("span",{className:"\
composer-hint"},"/ commands"),React.createElement("span",{className:"composer-hint"},"Ctrl+V image"),p&&Yn&&React.createElement(
"span",{className:"composer-hint draft-live"},"draft saved")),p&&React.createElement("div",{className:`composer-settings${ke?
" is-open":""}`},(Mu||ci)&&React.createElement("div",{className:`composer-control-state ${ci?"failed":"pending"}`,role:"\
status"},ci?ci.error:`Saving ${Mu.field.replace(/_/g," ")}\u2026`),(D?.capabilities?.set_model||P?.agent_type==="antigra\
vity"||P?.agent_type==="antigravity_panel")&&React.createElement(React.Fragment,null,P?.agent_type==="codex_cli"&&D?.config_semantics===
"observed_and_next_send"&&React.createElement("span",{className:"composer-setting-label","data-control":"observed-model"},
React.createElement("span",{className:"composer-setting-key"},"Observed model"),React.createElement("span",{className:"c\
omposer-hint"},D.observed_model_id||"unknown")),React.createElement("label",{className:"composer-setting-label","data-co\
ntrol":"model"},React.createElement("span",{className:"composer-setting-key"},P?.agent_type==="codex_cli"&&D?.config_semantics===
"observed_and_next_send"?"Next model":"Model"),React.createElement("select",{className:"composer-setting-select",value:P?.
agent_type==="codex_cli"&&D?.config_semantics==="observed_and_next_send"?D.next_send_model_id||"":D?.model_id||"default",
onChange:o=>oe(p,o.target.value)},P?.agent_type==="codex_cli"&&D?.config_semantics==="observed_and_next_send"&&React.createElement(
"option",{value:"",disabled:!0},"Choose model\u2026"),xm(P?.agent_type,D).map(o=>React.createElement("option",{key:o.id,
value:o.id},o.label)),D?.model_id&&!xm(P?.agent_type,D).some(o=>o.id===D.model_id)&&D.model_id!=="unknown"&&D.config_semantics!==
"observed_and_next_send"&&React.createElement("option",{value:D.model_id},D.model_id)),P?.agent_type==="codex_cli"&&D?.config_semantics===
"observed_and_next_send"&&React.createElement("span",{className:"composer-hint"},D.next_send_model_status||"unset"))),(P?.
agent_type==="antigravity"||P?.agent_type==="antigravity_panel")&&React.createElement("label",{className:"composer-setti\
ng-label","data-control":"mode"},React.createElement("span",{className:"composer-setting-key"},"Mode"),React.createElement(
"select",{className:"composer-setting-select",value:D?.conversation_mode||"Planning",onChange:o=>J(p,o.target.value)},tu.
map(o=>React.createElement("option",{key:o.id,value:o.id},o.label)))),(Co(P?.agent_type)||P?.agent_type==="cursor")&&D?.
capabilities?.set_mode&&So(P?.agent_type,D).length>0&&React.createElement("label",{className:"composer-setting-label","d\
ata-control":"mode"},React.createElement("span",{className:"composer-setting-key"},"Mode"),React.createElement("select",
{className:"composer-setting-select",value:D?.mode||So(P?.agent_type,D)[0]?.id||"unknown",onChange:o=>J(p,o.target.value)},
So(P?.agent_type,D).map(o=>React.createElement("option",{key:o.id,value:o.id},o.label)),D?.mode&&D.mode!=="unknown"&&!So(
P?.agent_type,D).some(o=>o.id===D.mode)&&React.createElement("option",{value:D.mode},D.mode))),D?.capabilities?.permission_mode_change&&
React.createElement("label",{className:"composer-setting-label","data-control":"permission"},React.createElement("span",
{className:"composer-setting-key"},P?.agent_type==="codex_cli"?"Access":"Permission"),React.createElement("select",{className:"\
composer-setting-select",value:D.permission_mode||Vm(P?.agent_type),onChange:o=>de(p,o.target.value),title:"Permission m\
ode"},Gl(P?.agent_type||"claude",D).map(o=>React.createElement("option",{key:o.value,value:o.value},o.label)),D.permission_mode&&
!Gl(P?.agent_type,D).some(o=>o.value===D.permission_mode)&&D.permission_mode!=="unknown"&&React.createElement("option",{
value:D.permission_mode},D.permission_mode))),(P?.agent_type==="claude_cli"||P?.agent_type==="codex_cli"||P?.agent_type===
"cursor_cli")&&D?.capabilities?.set_effort&&(D.available_efforts||[]).length>0&&React.createElement(React.Fragment,null,
P?.agent_type==="codex_cli"&&D?.config_semantics==="observed_and_next_send"&&React.createElement("span",{className:"comp\
oser-setting-label","data-control":"observed-effort"},React.createElement("span",{className:"composer-setting-key"},"Obs\
erved effort"),React.createElement("span",{className:"composer-hint"},D.observed_effort||"unknown")),React.createElement(
"label",{className:"composer-setting-label","data-control":"effort"},React.createElement("span",{className:"composer-set\
ting-key"},P?.agent_type==="codex_cli"&&D?.config_semantics==="observed_and_next_send"?"Next effort":"Effort"),React.createElement(
"select",{className:"composer-setting-select",value:P?.agent_type==="codex_cli"&&D?.config_semantics==="observed_and_nex\
t_send"?D.next_send_effort||"":D.effort||"medium",onChange:o=>G(p,o.target.value),title:`${P?.agent_type==="codex_cli"?"\
Codex":P?.agent_type==="cursor_cli"?"Cursor":"Claude"} CLI effort`},P?.agent_type==="codex_cli"&&D?.config_semantics==="\
observed_and_next_send"&&React.createElement("option",{value:"",disabled:!0},"Choose effort\u2026"),(D.available_efforts||
[]).map(o=>React.createElement("option",{key:o.id,value:o.id},o.label))),P?.agent_type==="codex_cli"&&D?.config_semantics===
"observed_and_next_send"&&React.createElement("span",{className:"composer-hint"},D.next_send_effort_status&&D.next_send_effort_status!==
"unset"?D.next_send_effort_status:"No override selected"))),D?.capabilities?.auto_approve_permissions_toggle&&React.createElement(
"label",{className:"composer-setting-toggle",title:"Automatically approve permission prompts for this session"},React.createElement(
"input",{type:"checkbox",checked:typeof D?.auto_approve_permissions=="boolean"?D.auto_approve_permissions:!!P?.auto_approve_permissions,
onChange:o=>Ne(p,o.target.checked)}),React.createElement("span",null,"Auto-approve prompts")),D?.capabilities?.set_codex_config&&
React.createElement(React.Fragment,null,D?.capabilities?.codex_model_change&&React.createElement("label",{className:"com\
poser-setting-label","data-control":"model"},React.createElement("span",{className:"composer-setting-key"},P?.agent_type===
"codex"?"Next model":"Model"),React.createElement("select",{className:"composer-setting-select",value:D.model_id||"unkno\
wn",disabled:P?.agent_type==="codex"&&D.controls_available===!1||["pending","awaiting_config"].includes(te?.[`${p}:model`]?.
status),onChange:o=>ve(p,{model_id:o.target.value}),title:P?.agent_type==="codex"?"Next-turn Codex model":"Codex Desktop\
 model"},(D.available_models||[]).map(o=>React.createElement("option",{key:o.id,value:o.id},o.label)),D.model_id&&!(D.available_models||
[]).some(o=>o.id===D.model_id)&&D.model_id!=="unknown"&&React.createElement("option",{value:D.model_id},D.model_id))),D?.
capabilities?.codex_effort_change&&React.createElement("label",{className:"composer-setting-label","data-control":"effor\
t"},React.createElement("span",{className:"composer-setting-key"},P?.agent_type==="codex"?"Next effort":"Effort"),React.
createElement("select",{className:"composer-setting-select",value:(D.effort||"unknown").toLowerCase(),disabled:P?.agent_type===
"codex"&&D.controls_available===!1||["pending","awaiting_config"].includes(te?.[`${p}:effort`]?.status),onChange:o=>ve(p,
{effort:o.target.value}),title:P?.agent_type==="codex"?"Next-turn reasoning effort":"Codex Desktop reasoning effort"},(D.
available_efforts||[]).map(o=>React.createElement("option",{key:o.id,value:o.id},o.label)))),D?.capabilities?.codex_permission_profile_change&&
React.createElement("label",{className:"composer-setting-label","data-control":"permission-profile"},React.createElement(
"span",{className:"composer-setting-key"},"Next permissions"),React.createElement("select",{className:"composer-setting-\
select",value:D.permission_profile||"unknown",disabled:D.controls_available===!1||["pending","awaiting_config"].includes(
te?.[`${p}:permission_profile`]?.status),onChange:o=>ve(p,{permission_profile:o.target.value}),title:"Next-turn native C\
odex permissions profile"},D.permission_profile==="full-access"&&React.createElement("option",{value:"full-access",disabled:!0},
"Full access"),(D.available_permission_profiles||[]).filter(o=>o.id!=="full-access").map(o=>React.createElement("option",
{key:o.id,value:o.id},o.label)))),D?.capabilities?.codex_bypass_permissions&&React.createElement("button",{type:"button",
className:"composer-desktop-action composer-bypass-action",onClick:()=>{Wa(!0),xs(!1)},title:"Review and confirm Full ac\
cess in Session Settings"},D.bypass_permissions_active?"Bypass active":"Bypass\u2026"),D?.capabilities?.codex_speed_change&&
React.createElement("label",{className:"composer-setting-label","data-control":"speed"},React.createElement("span",{className:"\
composer-setting-key"},"Speed"),React.createElement("select",{className:"composer-setting-select",value:(D.speed||"stand\
ard").toLowerCase(),onChange:o=>ve(p,{speed:o.target.value}),title:"Speed"},(D.available_speeds||[]).map(o=>React.createElement(
"option",{key:o.id,value:o.id},o.label)),D.speed&&!(D.available_speeds||[]).some(o=>o.id===D.speed)&&D.speed!=="unknown"&&
React.createElement("option",{value:D.speed},D.speed))),D?.capabilities?.codex_access_change&&React.createElement("label",
{className:"composer-setting-label","data-control":"permission"},React.createElement("span",{className:"composer-setting\
-key"},"Access"),React.createElement("select",{className:"composer-setting-select",value:D.permission_mode||"unknown",onChange:o=>ve(
p,{access_mode:o.target.value}),title:"Codex Desktop access mode"},(D.available_access||[]).map(o=>React.createElement("\
option",{key:o.id,value:o.id},o.label)),D.permission_mode&&!(D.available_access||[]).some(o=>o.id===D.permission_mode)&&
D.permission_mode!=="unknown"&&React.createElement("option",{value:D.permission_mode},D.permission_mode))),P?.agent_type===
"codex-desktop"&&(D.available_workspaces||[]).length>0&&React.createElement("select",{className:"composer-setting-select",
value:D.file_access_scope||"",onChange:o=>$(p,o.target.value),title:"Switch workspace"},(D.available_workspaces||[]).map(
o=>React.createElement("option",{key:o.id,value:o.path||o.id},o.label)))),vs&&React.createElement("span",{className:"com\
poser-workspace",title:vs},"\u2302 ",Pu||vs),React.createElement("button",{className:"composer-desktop-action",onClick:()=>{
Wa(!0),xs(!1)}},"\u2699 Session details"),React.createElement("div",{className:"composer-mobile-actions"},React.createElement(
"button",{className:"composer-mobile-action",onClick:()=>{Wa(!0),xs(!1)}},"\u2699 Session details"),Ou&&React.createElement(
"button",{className:"composer-mobile-action",onClick:()=>ge(p)},"\u270E New thread"),(D?.capabilities?.chat_list||Ge)&&React.
createElement("button",{className:"composer-mobile-action",onClick:()=>{Q(p),Ge?(sn(!0),Lt(!1)):Lt(!0),xs(!1)}},"\u2630 ",
Ge?"Projects":"Chat history"),D?.capabilities?.thread_list&&React.createElement("button",{className:"composer-mobile-act\
ion",onClick:()=>{I(p),Bt(!0),xs(!1)}},"\u229F Threads"),D?.capabilities?.open_panel&&React.createElement("button",{className:"\
composer-mobile-action",onClick:()=>Z(p)},"\u229E Open panel"),D?.capabilities?.new_chat&&React.createElement("button",{
className:"composer-mobile-action",onClick:()=>Ge?ba(p):V(p)},"+ New chat"))))))),Ot&&React.createElement("div",{className:"\
attention-toast",role:"status","aria-live":"polite"},React.createElement("span",{className:`attention-toast-icon ${Ot.kind}`,
"aria-hidden":"true"},Ot.kind==="prompt"||["goal_attention","provider_usage_threshold"].includes(Ot.kind)?"!":"\u2713"),
React.createElement("span",{className:"attention-toast-copy"},React.createElement("strong",null,Ot.title),React.createElement(
"span",null,Ot.detail)),React.createElement("button",{type:"button",onClick:()=>{let o=q.find(_=>Ee(_)===Ot.sessionId);o&&
Kn(Ot.sessionId,o),vu()}},"Jump")),React.createElement("div",{className:`toast ${jn?"visible":""}`},jn))}var Xm=(()=>{try{return new URLSearchParams(window.location.search).get("render_profile")==="1"}catch{return!1}})();function Uv(e,t,n,s,a,i){
let c=window.__RAC_RENDER_PROFILER__||(window.__RAC_RENDER_PROFILER__=[]);c.push({id:e,phase:t,route:document.querySelector(
'[data-testid="fleet-view"]')?"fleet":document.querySelector('[data-testid="usage-dashboard"]')?"usage":document.querySelector(
'[data-testid="host-resource-dashboard"]')?"host-resources":document.querySelector(".messages")?"chat":"other",actual_duration_ms:Number(
n.toFixed(3)),base_duration_ms:Number(s.toFixed(3)),start_time_ms:Number(a.toFixed(3)),commit_time_ms:Number(i.toFixed(3))}),
c.length>2e3&&c.splice(0,c.length-2e3)}var Em=React.createElement(zl,null,React.createElement(Hv,null));ReactDOM.createRoot(
document.getElementById("root")).render(Xm?React.createElement(React.Profiler,{id:"AgentChatRoot",onRender:Uv},Em):Em);"serviceWorker"in navigator&&window.addEventListener("load",function(){navigator.serviceWorker.register("/sw.js").catch(
function(e){console.warn("SW registration failed:",e)})});(window.navigator.standalone===!0||window.matchMedia("(display\
-mode: standalone)").matches)&&document.body.classList.add("pwa-standalone");})();
