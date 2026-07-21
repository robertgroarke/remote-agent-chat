(()=>{var ag=Object.create;var ud=Object.defineProperty;var rg=Object.getOwnPropertyDescriptor;var og=Object.getOwnPropertyNames;var ig=Object.getPrototypeOf,cg=Object.prototype.hasOwnProperty;var lg=(e,t)=>()=>(t||e((t={exports:{}}).exports,t),t.exports);var ug=(e,t,n,s)=>{if(t&&typeof t=="object"||typeof t=="function")for(let a of og(t))!cg.call(e,a)&&a!==n&&ud(e,a,{get:()=>t[a],
enumerable:!(s=rg(t,a))||s.enumerable});return e};var dg=(e,t,n)=>(n=e!=null?ag(ig(e)):{},ug(t||!e||!e.__esModule?ud(n,"default",{value:e,enumerable:!0}):n,e));var fm=lg((ak,mm)=>{"use strict";var om=new Set(["codex","codex_cli","codex-desktop"]),L_=new Set(["thinking","generatin\
g","reading_files","running_command","applying_patch","working"]),P_=new Set(["active","in_progress","in-progress","work\
ing","running"]),q_=new Set(["pending","queued","todo","not_started","not-started"]),im=new Set(["completed","complete",
"done","passed","success","succeeded"]),I_=new Set([...im,"cancelled","canceled","failed","skipped"]),O_=new Set(["","ac\
tive","idle","ready","thinking","generating","working","busy","connected"]),cm=240,D_=32,j_=48,B_=/^(?=.*\d)(?:(?:\d+)\s*d\s*)?(?:(?:\d+)\s*h\s*)?(?:(?:\d+)\s*m\s*)?(?:(?:\d+)\s*s)?$/i,
F_=/^[+-]?\d+\s*[dhms]\b/i,H_=/^(?:just now|today|yesterday|(?:\d+|an?|one)\s+(?:seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?)\s+ago)$/i,
U_=/^(?:pursuing goal|paused goal|goal (?:paused|blocked|usage limited|rate limited|limited|budget limited|achieved|cancelled|canceled|stopped|failed)|idle|ready|connected|awaiting live update)$/i,
G_=/^(?:no (?:recent message|current work|data|activity)(?: reported)?|unavailable|unknown|not available)$/i,W_=/^(?:remote agent chat|(?:antigravity|claude(?: code)?|cline|codex|continue|cursor|gemini|roo code)\s+(?:harness|workspace))$/i,
am=Object.freeze({active:"active",running:"active",working:"active",pursuing:"active",pursuing_goal:"active",paused:"pau\
sed",pause:"paused",paused_goal:"paused",blocked:"blocked",goal_blocked:"blocked",needs_attention:"blocked",waiting_for_user:"\
blocked",usagelimited:"usageLimited",usage_limited:"usageLimited",goal_usage_limited:"usageLimited",rate_limited:"usageL\
imited",goal_rate_limited:"usageLimited",budgetlimited:"budgetLimited",budget_limited:"budgetLimited",goal_limited:"budg\
etLimited",goal_budget_limited:"budgetLimited",complete:"complete",completed:"complete",achieved:"complete",goal_achieved:"\
complete",cancelled:"cancelled",canceled:"cancelled",stopped:"cancelled",goal_cancelled:"cancelled",goal_canceled:"cance\
lled",goal_stopped:"cancelled",failed:"failed",failure:"failed",goal_failed:"failed"});function lm(e){return String(e||"").
trim().toLowerCase()}function um(e,t){return t&&typeof t.goal_lifecycle=="boolean"?t.goal_lifecycle:om.has(lm(e))}function nc(e){
if(typeof e=="number"&&Number.isFinite(e)&&e>0)return e;let t=Date.parse(String(e||""));return Number.isFinite(t)?t:0}function as(...e){
for(let t of e){let n=nc(t);if(n)return new Date(n).toISOString()}return null}function z_(e){return/(?:\bbearer\s+[a-z0-9._~+/=-]{8,}|\b(?:api[_ -]?key|password|passwd|secret|access[_ -]?token|refresh[_ -]?token)\s*[:=]\s*\S+|\bsk-[a-z0-9_-]{8,})/i.
test(e)}function dm(e){let t=String(e??"").replace(/\s+/g," ").trim();return t?B_.test(t)?"duration_only":F_.test(t)?"du\
ration_malformed":H_.test(t)?"age_only":U_.test(t)?"status_only":G_.test(t)?"placeholder_only":W_.test(t)?"surface_label\
_only":"":"empty"}function Qt(e,t=cm){if(typeof e!="string"&&typeof e!="number")return"";let n=String(e).replace(/[\u0000-\u001f\u007f]+/g,
" ").replace(/```[\s\S]*?```/g," ").replace(/\s+/g," ").trim();return!n||z_(n)||dm(n)||/^[{[]\s*["']?[\w.-]+["']?\s*:/.test(
n)||/^(?:powershell|pwsh|cmd(?:\.exe)?|bash|sh|zsh|fish)\s+-/i.test(n)?"":(n=n.replace(/^(?:[-*•]\s+|#{1,6}\s+)/,"").trim(),
n.slice(0,t).trim())}function pm(e){let t=String(e||"").trim().replace(/([a-z0-9])([A-Z])/g,"$1_$2").toLowerCase().replace(
/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"");return t&&(am[t]||am[t.replace(/_/g,"")])||"unknown"}function zl(e){for(let t of[
e?.state,e?.status,e?.raw_state,e?.native_state]){let n=pm(t);if(n!=="unknown")return n}return"unknown"}function ec(e){return String(
e?.state||e?.status||"").trim().toLowerCase()}function rm(e){return Qt(e?.subject||e?.text||e?.content||e?.description||
e?.label)}function Kl(e,t){let n=Number(t),s=Number(e);return!Number.isInteger(n)||n<=0||!Number.isInteger(s)||s<0?null:
{completed:Math.min(s,n),total:n}}function K_(e){let t=Number(e?.progress_percent??e?.percent_complete??e?.percent??e?.progress);
return Number.isFinite(t)?Math.max(0,Math.min(100,t<=1?t*100:t)):null}function tc(e,t={}){if(!e||typeof e!="object")return null;
let n=String(e.kind||"").trim().toLowerCase().replace(/[^a-z_]/g,"").slice(0,24);if(!n||n==="goal"&&t.goalCapable===!1)return null;
let s=Qt(e.label,D_),a=Qt(e.text),i=Qt(e.source,j_).replace(/\s+/g,"_").toLowerCase();if(!s||!a||!i)return null;let c=n===
"goal"?zl(e):"unknown";if(n==="goal"&&c==="unknown")return null;let u=Kl(e.completed,e.total),f=Number(e.percent);return{
kind:n,label:s,text:a,source:i,updated_at:as(e.updated_at)||null,...u||{},...Number.isFinite(f)?{percent:Math.max(0,Math.
min(100,f))}:{},...n==="goal"?{state:c}:e.state?{state:Qt(e.state,32).toLowerCase()}:{},...e.diagnostic_reason?{diagnostic_reason:String(
e.diagnostic_reason).slice(0,64)}:{}}}function V_(e){let t=Array.isArray(e)?e:[];for(let n=t.length-1;n>=0;n-=1){let s=t[n];
if(String(s?.role||"").toLowerCase()!=="user")continue;let a=Qt(s?.content||s?.text);if(a)return{text:a,updated_at:as(s?.
timestamp,s?.created_at,s?.ts,s?.server_ts)}}return null}function Wl(e,t){let n=lm(e);return n==="claude"||n==="claude_c\
li"||n==="claude-desktop"?t>1?"Tasks":"Task":["antigravity","antigravity_panel","antigravity-v2","gemini","continue","co\
ntinue_yolo","roo_code","cline"].includes(n)?"Task":t>1?"Tasks":"Plan"}function Y_(e,t){let n=t?.task_list,s=Array.isArray(
n?.tasks)?n.tasks:[],a=s.filter(b=>rm(b));if(a.length>0){let b=a.find(A=>P_.has(ec(A))),k=a.find(A=>q_.has(ec(A))),N=b||
k;if(N){let A=Number(n.total),S=Number.isInteger(A)&&A>0?A:s.length,M=Number(n.completed),d=Number.isInteger(M)&&M>=0?M:
s.filter(v=>im.has(ec(v))).length;return{kind:"plan",label:Wl(e,S),text:rm(N),source:"task_list",updated_at:as(N.updated_at,
N.updatedAt,n.updated_at,t.updated_at),...Kl(d,S)}}}let i=t?.step,c=ec(i),u=typeof i=="object"?i?.text||i?.content||i?.description||
i?.label||i?.name:i,f=Qt(u);return f&&!I_.has(c)?{kind:"plan",label:Wl(e,1),text:f,source:"step",updated_at:as(i?.updated_at,
i?.updatedAt,t.updated_at)}:null}function X_(e){let t=e?.current;if(!t||typeof t!="object")return null;let n=Qt(t.label||
t.title||t.name);if(!n)return null;let s=String(t.kind||"").trim().toLowerCase(),a=["response","thinking","generating","\
message"].includes(s);return{kind:a?"response":"activity",label:a?"Current response":"Current activity",text:n,source:s?
`current_${s}`:"current",updated_at:as(t.updated_at,t.since,e.updated_at)}}function Q_(e,t){let n=t?.context_card;if(!n||
typeof n!="object")return null;let s=Qt(n.task||n.title||n.mode||n.label||n.text);return s?{kind:"task",label:Wl(e,1),text:s,
source:"context_card",updated_at:as(n.updated_at,t.updated_at)}:null}function J_(e){let t=typeof e=="string"?{text:e}:e,
n=Qt(t?.text||t?.content);return n?{kind:"request",label:"Request",text:n,source:"latest_user_request",updated_at:as(t?.
updated_at,t?.timestamp,t?.created_at)}:null}function Z_(e){let t=Qt(e?.label,160);return!t||O_.has(t.toLowerCase())?null:
{kind:"activity",label:"Current activity",text:t,source:"activity_label",updated_at:as(e?.updated_at,e?.started_at,e?.since)}}
function eb(e,t){if(!t||!e?.goal||typeof e.goal!="object")return null;let n=e.goal,s=Qt(n.objective||n.text);if(!s)return null;
let a=zl(n);if(a==="unknown")return null;let i=Kl(n.completed,n.total),c=K_(n);return{kind:"goal",label:"Goal",text:s,source:"\
goal",updated_at:as(n.updated_at,n.observed_at,e.updated_at),...i||{},...c==null?{}:{percent:c},state:a}}function tb(e,t){
if(!e)return t;if(!t)return e;let n=nc(e.updated_at);return nc(t.updated_at)>n&&n>0?t:e}function nb(e={}){let t=e.activity&&
typeof e.activity=="object"?e.activity:{},n=um(e.agentType,e.capabilities);if(e.preferProvided!==!1){let N=tc(t.work_context,
{goalCapable:n});if(N)return N}let s=eb(t,n);if(s)return tc(s,{goalCapable:n});let a=Y_(e.agentType,t),i=X_(t),c=Q_(e.agentType,
t),u=J_(e.latestUserRequest),f=Z_(t),b=L_.has(String(t.kind||"").toLowerCase()),k=a||c;return b&&i&&(k=tb(k,i)),k||(k=i||
c||u||f),!k&&u&&(k=u),k||(k={kind:"empty",label:"Current work",text:"Current work unavailable",source:"none",updated_at:as(
t.updated_at),diagnostic_reason:"no_authoritative_work_context"}),tc(k,{goalCapable:n})}mm.exports={CODEX_GOAL_AGENT_TYPES:om,
MAX_CONTEXT_TEXT:cm,boundedDisplayText:Qt,coherentGoalState:zl,goalLifecycleSupported:um,latestUserRequestFromMessages:V_,
normalizeFleetWorkContext:tc,normalizeGoalState:pm,projectFleetWorkContext:nb,rejectedDisplayTextReason:dm,timestampMs:nc}});var pg=new Set(["js","jsx","ts","tsx","py","json","md","css","html","htm","sh","bash","yaml","yml","txt","env","csv","xm\
l","sql","go","rs","java","c","cpp","h","hpp","rb","php","swift","kt","scala","r","m","tf","toml","ini","cfg","conf","lo\
g","gitignore","dockerfile","makefile","vue","svelte","graphql","gql"]),mg={js:"javascript",jsx:"jsx",ts:"typescript",tsx:"\
tsx",py:"python",rb:"ruby",sh:"bash",bash:"bash",rs:"rust",kt:"kotlin",tf:"hcl",md:"markdown",yml:"yaml",yaml:"yaml",graphql:"\
graphql",gql:"graphql"};function xr(e){let t=e.split(".").pop().toLowerCase();return mg[t]||t}function pd(e){let t=e.split(
".").pop().toLowerCase();return pg.has(t)}var dd={claude:"Claude Code",claude_cli:"Claude Code CLI",codex:"Codex",codex_cli:"\
Codex CLI",cursor_cli:"Cursor CLI",gemini:"Gemini",continue:"Continue",continue_yolo:"Continue YOLO",roo_code:"Roo Code",
cline:"Cline",antigravity:"Antigravity",antigravity_panel:"Antigravity Chat","codex-desktop":"Codex Desktop",cursor:"Cur\
sor","claude-desktop":"Claude Desktop"},fg=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function md(e,t){if(e&&typeof e=="object"){let f=dd[e.agent_type]||e.display_name||e.agent_type||"Agent",b=e.workspace_name||
e.window_title||"";return b?f+" \u2014 "+b:f}let n=t||e;if(typeof n!="string")return"Agent";if(fg.test(n))return"Agent S\
ession";let s=n.split("-"),a=s[0],i=s[1]||"",c=s[2]||"",u=i?" (win "+i+c+")":"";return(dd[a]||a)+u}function Fe(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}function mn(e){return Fe(String(
e)).replace(/"/g,"&quot;")}function Mr(e){return/^[A-Za-z]:\\/.test(e)||e.includes("\\")||e.includes("/")||/^[.~]\//.test(
e)}function gg(e){let t=0,n=0;return e.split(`
`).forEach(s=>{/^\+\+\+|^---|^@@/.test(s)||(s.startsWith("+")&&t++,s.startsWith("-")&&n++)}),{adds:t,dels:n}}function hg(e){
return/\b(edit|edited|patch|diff|apply_patch|write)\b/i.test(String(e||""))}function _g(e){let t=String(e||"").replace(/\r\n?/g,
`
`).split(`
`).map(n=>n.trimEnd());for(let n of t)if(n){if(/^(diff --git|index )/.test(n)||/^@@/.test(n)||/^---[ \t]/.test(n)||/^\+\+\+[ \t]/.
test(n))return!0;if(/^[+\- ]/.test(n)){let s=n.slice(1).trim();if(!s||/^[\d\s()+\-]+$/.test(s))continue;return!0}}return!1}function bg(e){let t=(e||"").toLowerCase();return t.includes("bash")||t.includes("run")||t.includes("command")||t.includes(
"execute")?"dot-bash":t.includes("read")?"dot-read":t.includes("edit")||t.includes("write")||t.includes("patch")?"dot-wr\
ite":t.includes("search")||t.includes("grep")||t.includes("find")||t.includes("glob")?"dot-search":t.includes("browser")||
t.includes("web")||t.includes("fetch")?"dot-browser":"dot-default"}function hd(e){let t=String(e||"").split(`
`),n=[],s=[],a=null,i=!1;function c(){let f=s.join(`
`).trim();f&&n.push({type:"markdown",content:f}),s=[]}function u(){if(!a)return;let f=a.lines.join(`
`).trimEnd();n.push({type:"tool",name:a.name,content:f}),a=null}return t.forEach(f=>{let b=/^```/.test(f.trim()),k=i?null:
f.match(/^\[([^\]\n]+)\]\s*$/),N=i?null:f.match(/^(Ran .+|Read .+|Edited file|Edit .+|Analyzed .+|Search(?:ed)? .+|Bash .+)\s*$/),
A=!i&&f.match(/^(\d+\s+lines?(?:\s+of\s+output)?)$/i);if(k){if(k[1].trim()==="end"){u();return}c(),u(),a={name:k[1].trim(),
lines:[]};return}if(A){c(),u(),a={name:A[1].trim(),lines:[]};return}if(N){c(),u(),a={name:N[1].trim(),lines:[]};return}a?
a.lines.push(f):s.push(f),b&&(i=!i)}),c(),u(),n.length>0?n:[{type:"markdown",content:String(e||"")}]}function ol(e){if(!e)
return!1;let t=String(e).replace(/\r\n?/g,`
`);if(/^(diff --git|index )/m.test(t)||/^@@/m.test(t)||/^---[ \t]/m.test(t)&&/^\+\+\+[ \t]/m.test(t))return!0;let s=t.split(
`
`).map(f=>f.trimEnd()).filter(Boolean);if(s.length<4)return!1;let a=s.filter(f=>/^[+-](?![-+]{2})/.test(f)).length,i=s.filter(
f=>/^\+(?!\+\+ )/.test(f)).length,c=s.filter(f=>/^-(?!-- )/.test(f)).length,u=s.filter(f=>/^ /.test(f)).length;return a>=
3&&i>=1&&c>=1&&u>=1}function _d(e){let t=e.match(/^\+\+\+[ \t]+(?:[ab]\/)?(.+?)(?:\t.*)?$/m);if(t){let s=t[1].trim();if(s&&
s!=="/dev/null")return s}let n=e.match(/^---[ \t]+(?:[ab]\/)?(.+?)(?:\t.*)?$/m);if(n){let s=n[1].trim();if(s&&s!=="/dev/\
null")return s}return null}var fd=300;function vg(e,t){if(e.length>fd||t.length>fd)return null;let n=e.length,s=t.length,
a=Array.from({length:n+1},()=>new Int32Array(s+1));for(let f=1;f<=n;f++)for(let b=1;b<=s;b++)a[f][b]=e[f-1]===t[b-1]?a[f-
1][b-1]+1:Math.max(a[f-1][b],a[f][b-1]);let i=[],c=n,u=s;for(;c>0||u>0;)c>0&&u>0&&e[c-1]===t[u-1]?(i.unshift({type:"eq"}),
c--,u--):u>0&&(c===0||a[c][u-1]>=a[c-1][u])?(i.unshift({type:"ins"}),u--):(i.unshift({type:"del"}),c--);return i}function yg(e){
let t=[],n=0,s=null;for(let a of e)a.type==="del"?(s===null&&(s=n),n++):a.type==="eq"&&(s!==null&&(t.push({start:s,end:n}),
s=null),n++);return s!==null&&t.push({start:s,end:n}),t}function kg(e){let t=[],n=0,s=null;for(let a of e)a.type==="ins"?
(s===null&&(s=n),n++):a.type==="eq"&&(s!==null&&(t.push({start:s,end:n}),s=null),n++);return s!==null&&t.push({start:s,end:n}),
t}function gd(e,t,n){if(!t||!t.length)return e;let s="",a=0,i=0,c=!1,u=0;for(;u<e.length;)if(e[u]==="<"){c&&(s+="</mark>",
c=!1);let f=e.indexOf(">",u);if(f===-1){s+=e[u++];continue}s+=e.slice(u,f+1),u=f+1,i<t.length&&a>=t[i].start&&a<t[i].end&&
(s+=`<mark class="${n}">`,c=!0)}else{if(c&&a>=t[i].end&&(s+="</mark>",c=!1,i++),!c&&i<t.length&&a>=t[i].start&&(s+=`<mar\
k class="${n}">`,c=!0),e[u]==="&"){let f=e.indexOf(";",u+1),b=f!==-1&&f-u<=8?f+1:u+1;s+=e.slice(u,b),u=b}else s+=e[u++];
a++}return c&&(s+="</mark>"),s}function bd(e){let t=vd(e);return t.length>0&&t[t.length-1].trim()===""&&t.pop(),t.map((n,s)=>`\
<span class="code-line"><span class="code-line-num">${s+1}</span>${n}</span>`).join("")}var wg=/[A-Za-z]:\\[^\n"'`<>]+?\.[A-Za-z0-9._-]+(?:\s+\((?:Lines?|Line)\s+\d+(?:-\d+)?\))?|(?:\.{1,2}[\\/])?(?:[A-Za-z0-9_.-]+[\\/])+[A-Za-z0-9_.-]+\.[A-Za-z0-9._-]+(?:\s+\((?:Lines?|Line)\s+\d+(?:-\d+)?\))?/g;
function Sg(e){let t=String(e||""),n="",s=0;for(let a of t.matchAll(wg)){let i=a[0],c=a.index||0,u=c+i.length,f=c>0?t[c-
1]:"",b=u<t.length?t[u]:"",k=(!f||/[\s([{"'`]/.test(f))&&(!b||/[\s)\]},"'`:;]/.test(b)),N=i.trim();!k||!Mr(N)||(n+=Fe(t.
slice(s,c)),n+=`<button class="inline-file-ref tool-open-file" type="button" title="Open file preview" data-open-path="${mn(
N)}" data-copy-path="${mn(N)}">${Fe(N)}</button>`,s=u)}return n+=Fe(t.slice(s)),n||"&nbsp;"}function Ng(e){let t=String(
e||"").replace(/\r\n/g,`
`).split(`
`);return t.length>0&&t[t.length-1]===""&&t.pop(),t.map((n,s)=>`<span class="code-line"><span class="code-line-num">${s+
1}</span>${Sg(n)}</span>`).join("")}function al(e,t){return`<span class="diff-gutter"><span class="diff-gutter-num diff-\
gutter-old">${e??""}</span><span class="diff-gutter-num diff-gutter-new">${t??""}</span></span>`}function Ar(e){return`<\
span class="diff-gutter"><span class="diff-gutter-num">${e??""}</span></span>`}function Cg(e){let t=0,n=0;for(let s of e)
if(s.type==="hunk"){let a=s.raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);a&&(t=parseInt(a[1],10)-1,n=parseInt(a[2],
10)-1),s.oldLine=null,s.newLine=null}else s.type==="add"?(s.oldLine=null,s.newLine=++n):s.type==="del"?(s.oldLine=++t,s.
newLine=null):s.type==="ctx"?(s.oldLine=++t,s.newLine=++n):(s.oldLine=null,s.newLine=null)}function xg(e,t,n){let s=[],a=u=>n.
has(u)?n.get(u):t&&t[u]!=null?t[u]:Fe(e[u].raw.startsWith("+")||e[u].raw.startsWith("-")||e[u].raw.startsWith(" ")?e[u].
raw.slice(1):e[u].raw),i=u=>t&&t[u]!=null?" diff-hl":"",c=0;for(;c<e.length;){let u=e[c];if(u.type==="meta"){let S=`<spa\
n class="diff-meta">${Fe(u.raw)}</span>`;s.push({type:"both",html:S}),c++;continue}if(u.type==="hunk"){let S=`<span clas\
s="diff-hunk">${Fe(u.raw)}</span>`;s.push({type:"both",html:S}),c++;continue}if(u.type==="ctx"){s.push({type:"ctx",content:a(
c),hlCls:i(c),oldLine:u.oldLine,newLine:u.newLine}),c++;continue}let f=c;for(;f<e.length&&e[f].type==="del";)f++;let b=f;
for(;b<e.length&&e[b].type==="add";)b++;let k=f-c,N=b-f,A=Math.min(k,N);for(let S=0;S<A;S++)s.push({type:"pair",delContent:a(
c+S),delHlCls:i(c+S),addContent:a(f+S),addHlCls:i(f+S),delOldLine:e[c+S].oldLine,addNewLine:e[f+S].newLine});for(let S=A;S<
k;S++)s.push({type:"del",content:a(c+S),hlCls:i(c+S),oldLine:e[c+S].oldLine});for(let S=A;S<N;S++)s.push({type:"add",content:a(
f+S),hlCls:i(f+S),newLine:e[f+S].newLine});c=b>c?b:c+1}return s}function Ag(e){let t=[],n=[];for(let s of e)s.type==="bo\
th"?(t.push(s.html),n.push(s.html)):s.type==="ctx"?(t.push(`<span class="diff-ctx${s.hlCls}">${Ar(s.oldLine)}${s.content}\
</span>`),n.push(`<span class="diff-ctx${s.hlCls}">${Ar(s.newLine)}${s.content}</span>`)):s.type==="pair"?(t.push(`<span\
 class="diff-del${s.delHlCls}">${Ar(s.delOldLine)}${s.delContent}</span>`),n.push(`<span class="diff-add${s.addHlCls}">${Ar(
s.addNewLine)}${s.addContent}</span>`)):s.type==="del"?(t.push(`<span class="diff-del${s.hlCls}">${Ar(s.oldLine)}${s.content}\
</span>`),n.push('<span class="diff-empty"></span>')):s.type==="add"&&(t.push('<span class="diff-empty"></span>'),n.push(
`<span class="diff-add${s.hlCls}">${Ar(s.newLine)}${s.content}</span>`));return`<div class="diff-split"><div class="diff\
-split-col diff-split-old"><code class="hljs diff-code">${t.join("")}</code></div><div class="diff-split-col diff-split-\
new"><code class="hljs diff-code">${n.join("")}</code></div></div>`}function vd(e){let t=[],n="",s=[],a=0;for(;a<e.length;)
if(e[a]===`
`)t.push(n+"</span>".repeat(s.length)),n=s.map(i=>`<span class="${i}">`).join(""),a++;else if(e[a]==="<")if(e.startsWith(
"</span>",a))s.pop(),n+="</span>",a+=7;else if(e.startsWith("<span",a)){let i=e.indexOf(">",a);if(i===-1){n+=e[a++];continue}
let c=e.slice(a,i+1),u=c.match(/class="([^"]*)"/);s.push(u?u[1]:""),n+=c,a=i+1}else n+=e[a++];else n+=e[a++];return(n||s.
length)&&t.push(n+"</span>".repeat(s.length)),t}function yd(e,t){let n=(()=>{if(!t||typeof hljs>"u")return null;if(hljs.
getLanguage(t))return t;let d=t.split(".").pop().toLowerCase();return hljs.getLanguage(d)?d:null})(),a=e.split(`
`).map(d=>/^\+\+\+|^---/.test(d)?{type:"meta",raw:d}:/^@@/.test(d)?{type:"hunk",raw:d}:d.startsWith("+")?{type:"add",raw:d}:
d.startsWith("-")?{type:"del",raw:d}:{type:"ctx",raw:d});Cg(a);let i=null;if(n)try{let d=a.map(g=>g.type==="meta"||g.type===
"hunk"?"":g.raw.startsWith("+")||g.raw.startsWith("-")||g.raw.startsWith(" ")?g.raw.slice(1):g.raw),v=hljs.highlight(d.join(
`
`),{language:n});i=vd(v.value)}catch{i=null}let c=new Map;for(let d=0;d<a.length;){if(a[d].type!=="del"){d++;continue}let v=d;
for(;v<a.length&&a[v].type==="del";)v++;let g=v;for(;g<a.length&&a[g].type==="add";)g++;let x=v-d,w=g-v;if(x===w&&x>0)for(let E=0;E<
x;E++){let T=d+E,U=v+E,Y=a[T].raw.slice(1),re=a[U].raw.slice(1),ee=vg(Y,re);if(!ee)continue;let ae=ee.filter(X=>X.type===
"eq").length,W=Math.max(Y.length,re.length);if(W>0&&ae/W<.15)continue;let ie=i&&i[T]!=null?i[T]:Fe(Y),ge=i&&i[U]!=null?i[U]:
Fe(re);c.set(T,gd(ie,yg(ee),"diff-word-del")),c.set(U,gd(ge,kg(ee),"diff-word-add"))}d=g>d?g:d+1}let u=0,f=0,b=0,k=!1,N=a.
map((d,v)=>{if(d.type==="meta")return`<span class="diff-meta">${Fe(d.raw)}</span>`;if(d.type==="hunk")return k=!0,b++,`<\
span class="diff-hunk diff-hunk-btn" data-hunk-id="${b}" role="button" tabindex="0" title="Toggle context lines">${Fe(d.
raw)}</span>`;let g=d.raw.startsWith("+")||d.raw.startsWith("-")||d.raw.startsWith(" ")?d.raw.slice(1):d.raw,x=c.has(v)?
c.get(v):i&&i[v]!=null?i[v]:Fe(g),w=i&&i[v]!=null?" diff-hl":"",E=b>0?` data-hunk-ctx="${b}"`:"";return d.type==="add"?(u++,
`<span class="diff-add${w}"${E}>${al(null,d.newLine)}${x}</span>`):d.type==="del"?(f++,`<span class="diff-del${w}"${E}>${al(
d.oldLine,null)}${x}</span>`):`<span class="diff-ctx${w}"${E}>${al(d.oldLine,d.newLine)}${x}</span>`}),A=u||f?`<span cla\
ss="diff-stat-add">+${u}</span><span class="diff-stat-del">-${f}</span>`:"",S=xg(a,i,c),M=Ag(S);return{body:N.join(""),stats:A,
splitHtml:M,hasHunks:k}}var kd='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke\
-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3"/><path d="M1\
6 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3"/><line x1="12" y1="3" x2="12" y2="21"/></svg>',Rg='<svg width="14" height="14" \
viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><c\
ircle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',Mg='<svg class="copy-icon" width="14" \
height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoi\
n="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9\
a2 2 0 0 1 2 2v1"></path></svg>',Tg='<svg class="check-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stro\
ke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:none"><polyline point\
s="20 6 9 17 4 12"></polyline></svg>';var wd=new marked.Renderer;wd.code=function(e,t){let n=typeof e=="object"?e.text||e.raw||"":e||"",a=(typeof e=="object"?
e.lang||"":t||"").split(/\s/)[0].toLowerCase()||"text",i=a==="diff"||a==="patch"||ol(n),c=!i&&(a==="text"||a==="markdown"),
u,f="",b="",k="",N=null;if(i){b=_d(n)||"";let U=b?xr(b):null;N=yd(n,U),u=N.body,f=N.stats,k=N.splitHtml||""}else if(c)u=
Ng(n);else try{u=hljs.getLanguage(a)?hljs.highlight(n,{language:a}).value:hljs.highlightAuto(n).value}catch{u=Fe(n)}let A=n;
!i&&!c&&(u=bd(u));let S=i||a==="text"?"":a,M=b?`<button class="diff-filepath" title="Open file preview" data-copy-path="${mn(
b)}" data-open-path="${mn(b)}">${Fe(b)}</button>`:"",d=k?`<button class="diff-split-toggle" title="Toggle side-by-side v\
iew">${kd}</button>`:"",v=i&&N&&N.hasHunks?'<button class="diff-ctx-collapse-all" title="Collapse/expand all context lin\
es">Context</button>':"",g=!1,x="",w=typeof localStorage<"u"&&localStorage.getItem("codeblock_wrap_pref")==="1",E=`<butt\
on class="code-wrap-toggle${w?" active":""}" title="${w?"Disable word wrap":"Enable word wrap"}">${w?"No Wrap":"Wrap"}</\
button>`,T=i?"":` data-raw="${mn(A)}"`;return`<div class="code-block${i?" diff-block":""}${g?" code-collapsible":""}${w?
" code-wrap":""}" data-diff-mode="unified">
    <div class="code-header">
      <span class="code-lang">${S}</span>
      ${M}
      <span class="diff-stats">${f}</span>
      ${v}
      ${d}
      ${x}
      ${E}
      <button class="code-search-btn" title="Search in block">${Rg}</button>
      <button class="code-copy" title="Copy code">${Mg}${Tg}<span class="copy-label">Copy</span></button>
    </div>
    <div class="code-search-bar" hidden>
      <input class="code-search-input" type="text" placeholder="Search\u2026" aria-label="Search in code block">
      <span class="code-search-count"></span>
      <button class="code-search-prev" title="Previous match">&#8593;</button>
      <button class="code-search-next" title="Next match">&#8595;</button>
      <button class="code-search-close" title="Close search">&#10005;</button>
    </div>
    <pre><code class="hljs${i?" diff-code":""}"${T}>${u}</code></pre>
    ${k}
  </div>`};marked.use({renderer:wd,breaks:!0,gfm:!0});function $g(e,t){let n=(e||"").toLowerCase();if(n==="bash"||n==="r\
un"||n==="execute"||n==="shell"){let a=t.find(i=>i.trim());return a?a.trim().substring(0,80):""}let s=t.find(a=>a.trim());
return s&&Mr(s.trim())?s.trim():s?s.trim().substring(0,60):""}function Eg(e,t,n){let s=String(t||"").replace(/\n+$/,"").
split(`
`),a=s.find(ae=>ae.trim()),i=a&&Mr(a.trim())?a.trim():"",c=(ae,W="")=>{let ie=String(ae||"").trim();if(!ie)return"";let ge=[
"tool-path",W,Mr(ie)?"tool-open-file":""].filter(Boolean).join(" ");return Mr(ie)?`<button class="${ge}" type="button" t\
itle="Open file preview" data-open-path="${mn(ie)}" data-copy-path="${mn(ie)}">${Fe(ie)}</button>`:`<span class="${ge}">${Fe(
ie)}</span>`},u=s.filter((ae,W,ie)=>!(W===ie.length-1&&ie[W]==="")).length,f=/^\d+\s+lines?(?:\s+of\s+output)?$/i.test(e.
trim()),b=s.some(ae=>ae.trim()),k=f&&u===0||!b,A=/^Bash\b/i.test(e.trim())&&s.every(ae=>{let W=ae.trim();return!W||/^\$\s+/.
test(W)}),S=!b,M=s.join(`
`),d=gg(t),v=ol(t)||hg(e)&&(d.adds||d.dels),g=v&&_d(t)||i,x=v&&g?xr(g):null,w=(()=>{if(!v)return M;let ae=M,W=ae.match(/```(?:diff|patch)?\s*\n([\s\S]*?)```\s*$/m);
W&&(ae=W[1]);let ie=ae.split(`
`),ge=0;for(;ge<ie.length;){let X=ie[ge];if(X.startsWith("+")||X.startsWith("-")||X.startsWith("@@")||X.startsWith(" "))
break;ge++}return ie.slice(ge).join(`
`)})(),E=v&&_g(w),T=E?yd(w,x):null,U=d.adds||d.dels?`<span class="tool-stat-add">+${d.adds}</span><span class="tool-stat\
-del">-${d.dels}</span>`:"",Y=v?(()=>{for(let ae of s){let W=ae.trim();if(W&&!W.startsWith("```")&&!W.startsWith("+")&&!W.
startsWith("-")&&!W.startsWith("@@")&&!W.startsWith(" "))return W}return""})():"",re=S&&!g?Y||$g(e,s):Y||"",ee=!k&&(E||!v);
return`<section class="tool-section${S?" collapsed":""}" data-tool-index="${n}">
    <button class="tool-toggle" type="button" aria-expanded="${S?"false":"true"}">
      <span class="tool-chevron">${ee?S?"\u25B8":"\u25BE":""}</span>
      <span class="tool-dot ${bg(e)}">\u25CF</span>
      <span class="tool-toggle-main">
        ${(()=>{let ae=e.indexOf(" ");if(ae>0){let W=e.substring(0,ae),ie=e.substring(ae+1).trim();return`<span class="t\
ool-name">${Fe(W)}</span>${c(ie)}`}return`<span class="tool-name">${Fe(e)}</span>`})()}
        ${g?c(g,"tool-path-secondary"):""}
        ${re?`<span class="tool-preview">${Fe(re)}</span>`:""}
      </span>
      <span class="tool-toggle-side">
        ${U}
        ${f&&u>0?`<span class="tool-line-count">${u} lines</span>`:""}
      </span>
    </button>
    ${ee?`<div class="tool-body"${S?" hidden":""}>
      ${E?`<div class="code-block diff-block tool-diff-block" data-diff-mode="unified">
            <div class="code-header">
              <span class="code-lang"></span>
              ${g?`<button class="diff-filepath" title="Open file preview" data-copy-path="${mn(g)}" data-open-path="${mn(
g)}">${Fe(g)}</button>`:""}
              <span class="diff-stats">${T?.stats||""}</span>
              ${T?.hasHunks?'<button class="diff-ctx-collapse-all" title="Collapse/expand all context lines">Context</bu\
tton>':""}
              ${T?.splitHtml?`<button class="diff-split-toggle" title="Toggle side-by-side view">${kd}</button>`:""}
            </div>
            <pre><code class="hljs diff-code">${T?.body||""}</code></pre>
            ${T?.splitHtml||""}
          </div>`:(()=>{let ae=Sd(M);if(ae)return Nd(ae,n+"_b");let W=M.trim();return W.startsWith("```")?`<div class="t\
ool-body-md">${marked.parse(W)}</div>`:`<pre class="tool-body-pre"><code>${Fe(M)}</code></pre>`})()}
    </div>`:""}
  </section>`}var Lg=/^IN\n\n?```([^\n]*)\n([\s\S]*?)\n```\n\n?OUT(?:\n\n?```([^\n]*)\n([\s\S]*?)\n```)?[\s]*$/,Pg=/^IN\n([\s\S]*?)(?:\nOUT\n([\s\S]*))?$/;
function Sd(e){if(!e)return null;let t=e.replace(/\r\n/g,`
`);if(!t.startsWith(`IN
`))return null;let n=t.match(Lg);if(n)return{inLang:n[1]||"",inText:n[2]||"",outLang:n[3]||"",outText:n[4]||""};let s=t.
match(Pg);return s?{inLang:"",inText:(s[1]||"").trim(),outLang:"",outText:(s[2]||"").trim()}:null}function Nd(e,t){let n=(e.
inText||"").trimEnd().split(`
`),s=(e.outText||"").trimEnd().split(`
`),a=(c,u)=>{let f=Fe(u.join(`
`)),b=u.length===0||u.length===1&&!u[0].trim()?'<span class="tool-io-empty">(no output)</span>':"";return`<div class="to\
ol-io-row">
      <span class="tool-io-label">${c}</span>
      <div class="tool-io-content">${b||`<code class="tool-io-code">${f}</code>`}</div>
    </div>`},i=s.length===0||s.length===1&&!s[0].trim();return`<div class="tool-io-block" data-tool-index="${t}">${a("IN",
n)}${i?"":a("OUT",s)}</div>`}function qg(e){let t=String(e||"").replace(/\r\n/g,`
`);if(!t.trim())return null;let n=t.split(`
`),s=/^\s*(\d+)\s+file(?:\(s\)|s?)\s+changed(?:\s+in\s+this\s+conversation)?/i,a=n.findIndex(g=>s.test(g));if(a===-1)return null;
let i=n[a].trim(),c=i.match(s);if(!c)return null;let u=g=>{let x=String(g||"").match(/\+(\d+)\s+(?:\u00c2\u00b7|·|-|\s)\s*-?(\d+)/);
return x?{adds:Number(x[1])||0,dels:Number(x[2])||0}:null},f=u(i),b=null,k=[],N="",A=a;for(let g=a+1;g<n.length;g++){let x=n[g].
trim();if(!x)continue;if(!f){let re=u(x);if(re){f=re,A=g;continue}}let w=x.match(/^\+(\d+)$/);if(w){b=Number(w[1])||0,A=
g;continue}let E=x.match(/^-(\d+)$/);if(E&&b!=null&&!f){f={adds:b,dels:Number(E[1])||0},b=null,A=g;continue}let T=x.match(
/^\+(\d+)\s+(?:\u00c2\u00b7|·|-|\s)\s*-?(\d+)$/);if(T&&N){k.push({filepath:N,adds:Number(T[1])||0,dels:Number(T[2])||0}),
N="",A=g;continue}let U=x.match(/^(.+?)\s+\+(\d+)\s+(?:\u00c2\u00b7|·|-|\s)\s*-?(\d+)(?:\s+.*)?$/);if(!U){if(Mr(x)){N=x,
A=g;continue}break}let Y=U[1].trim();if(!Y||/^\+?\d+$/.test(Y))break;k.push({filepath:Y,adds:Number(U[2])||0,dels:Number(
U[3])||0}),N="",A=g}if(k.length===0)return null;let S=f?.adds??k.reduce((g,x)=>g+x.adds,0),M=f?.dels??k.reduce((g,x)=>g+
x.dels,0),d=n.slice(0,a).join(`
`).replace(/\s+$/g,""),v=n.slice(A+1).join(`
`).replace(/^\s+/g,"");return{count:Number(c[1])||k.length,title:i.replace(/\s+\+\d+.*$/,"").trim(),adds:S,dels:M,entries:k,
beforeText:d,afterText:v}}function Ig(e,t){let n=e.entries.map(s=>`<div class="file-changes-item">
      <span class="file-changes-path">${Fe(s.filepath)}</span>
      <span class="file-changes-stats"><span class="diff-stat-add">+${s.adds}</span><span class="diff-stat-del">-${s.dels}\
</span></span>
    </div>`).join("");return`<section class="file-changes-section" data-file-changes-index="${t}">
    <button class="file-changes-toggle" type="button" aria-expanded="true">
      <span class="file-changes-chevron">v</span>
      <span class="file-changes-icon">files</span>
      <span class="file-changes-title">${Fe(e.title||`${e.count} file(s) changed`)}</span>
      <span class="file-changes-summary">
        <span class="diff-stat-add">+${e.adds}</span>
        <span class="diff-stat-del">-${e.dels}</span>
      </span>
    </button>
    ${e.entries.length?`<div class="file-changes-list">${n}</div>`:""}
  </section>`}function Og(e,t){let n;try{n=JSON.parse(e)}catch{return null}if(!n||!Array.isArray(n.items)||!n.items.length)
return null;let s=n.title||"Subagents",a=n.items.map((i,c)=>{let u=String(i.status||"unknown").toLowerCase(),f=u==="runn\
ing"?'<span class="subagent-spinner" aria-hidden="true"></span>':u==="done"?'<span class="subagent-icon subagent-icon-do\
ne" aria-hidden="true">&#10003;</span>':u==="failed"?'<span class="subagent-icon subagent-icon-fail" aria-hidden="true">\
&#10007;</span>':'<span class="subagent-icon subagent-icon-unknown" aria-hidden="true">&#9679;</span>',b=String(i.prompt||
"").trim(),k=String(i.stats||"").trim(),N=Array.isArray(i.tool_calls)?i.tool_calls.filter(Boolean):[],A=N.length?`<ul cl\
ass="subagent-calls">${N.map(S=>`<li><code>${Fe(S)}</code></li>`).join("")}</ul>`:"";return`<li class="subagent-item sub\
agent-status-${Fe(u)}">
      <div class="subagent-row">${f}<div class="subagent-prompt" title="${Fe(b)}">${Fe(b)}</div></div>
      ${k?`<div class="subagent-stats">${Fe(k)}</div>`:""}
      ${A}
    </li>`}).join("");return`<section class="subagents-section" data-subagents-index="${t}">
    <div class="subagents-header"><span class="subagents-icon" aria-hidden="true">&#9783;</span><span class="subagents-t\
itle">${Fe(s)}</span></div>
    <ul class="subagents-list">${a}</ul>
  </section>`}function Dg(e){let t=String(e||"").match(/^Task Completed\s*\n+([\s\S]*?)\s*$/);return t?{content:t[1].replace(
/HAS_CHANGES\s*$/i,"").trimEnd(),wrap:!0}:{content:e,wrap:!1}}function jg(e){return`<section class="task-completed-secti\
on">
    <div class="task-completed-header">
      <span class="task-completed-icon" aria-hidden="true">&#10003;</span>
      <span class="task-completed-title">Task Completed</span>
    </div>
    <div class="task-completed-body">${e}</div>
  </section>`}function Bg(e){let t=[],n=/^~~~subagents\s*\n([\s\S]*?)\n~~~\s*$/gm;return{content:String(e||"").replace(n,
(a,i)=>{let c=Og(i,t.length)||"";return t.push(c),`\0SUBAGENTS_BLOCK_${t.length-1}\0`}),blocks:t}}function Fg(e){let{content:t,
wrap:n}=Dg(e);e=t;let{content:s,blocks:a}=Bg(e);e=s;let c=hd(e).map((k,N)=>{try{if(k.type==="tool")return Eg(k.name,k.content,
N);let A=Sd(k.content);if(A)return Nd(A,N);let S=qg(k.content);if(S){let M=Ig(S,N),d=(S.beforeText||"").trim()?marked.parse(
S.beforeText):"",v=(S.afterText||"").trim()?marked.parse(S.afterText):"";return d+M+v}return(k.content||"").trim()?marked.
parse(k.content||""):""}catch(A){return'<pre style="color:var(--red,#f26d78);font-size:11px">[render error: '+Fe(String(
A))+"]</pre><pre>"+Fe(k.content||"")+"</pre>"}}).join("");a.length&&(c=c.replace(/\s*SUBAGENTS_BLOCK_(\d+)\s*/g,(k,N)=>a[Number(
N)]||""));let u=document.createElement("div");typeof DOMPurify<"u"?u.innerHTML=DOMPurify.sanitize(c,{ADD_DATA_URI_TAGS:[
"img"],ALLOW_DATA_ATTR:!0}):u.textContent=c;let b=Array.from(u.querySelectorAll(".diff-block")).map((k,N)=>{let A=k.querySelector(
".diff-filepath");if(!A)return null;let S=A.textContent.trim();if(!S)return null;let M=k.querySelector(".diff-stat-add, \
.tool-stat-add"),d=k.querySelector(".diff-stat-del, .tool-stat-del"),v=M&&parseInt(M.textContent,10)||0,g=d&&parseInt(d.
textContent,10)||0;return k.id=`diff-file-${N}`,{filepath:S,adds:v,dels:g,id:`diff-file-${N}`}}).filter(Boolean);if(b.length>=
2){let k=b.reduce((d,v)=>d+v.adds,0),N=b.reduce((d,v)=>d+v.dels,0),A=b.map(d=>{let v=d.filepath.split(/[/\\]/).pop();return`\
<a class="diff-summary-chip" data-target="${mn(d.id)}" href="#${mn(d.id)}" title="${mn(d.filepath)}"><span class="diff-s\
ummary-name">${Fe(v)}</span><span class="diff-stat-add">+${d.adds}</span><span class="diff-stat-del">-${d.dels}</span></\
a>`}).join(""),S=`<span class="diff-summary-totals"><span class="diff-summary-count">${b.length} files</span><span class\
="diff-stat-add">+${k}</span><span class="diff-stat-del">-${N}</span></span>`,M=document.createElement("div");M.className=
"diff-summary-bar",M.innerHTML=A+S,u.insertBefore(M,u.firstChild)}return n?jg(u.innerHTML):u.innerHTML}function Hg(e){let t=[],
n=0,s=document.createTreeWalker(e,NodeFilter.SHOW_TEXT,null),a;for(;a=s.nextNode();){if(a.parentElement&&a.parentElement.
classList.contains("code-line-num"))continue;let i=a.nodeValue.length;t.push({node:a,start:n,end:n+i}),n+=i}return{text:t.
map(i=>i.node.nodeValue).join(""),ranges:t}}function Ai(e){if(!e)return;let t=e.querySelector("code");if(!t)return;t.querySelectorAll(
"mark.code-search-mark").forEach(s=>{let a=s.parentNode;a&&(a.replaceChild(document.createTextNode(s.textContent),s),a.normalize())});
let n=e.querySelector(".code-search-count");n&&(n.textContent=""),delete e._searchState}function Ug(e){if(!e)return;Ai(e);
let t=e.querySelector(".code-search-input"),n=t?t.value:"";if(!n)return;let s=e.querySelector("code");if(!s)return;let{text:a,
ranges:i}=Hg(s),c=a.toLowerCase(),u=n.toLowerCase(),f=[],b=0;for(;b<a.length;){let A=c.indexOf(u,b);if(A===-1)break;f.push(
A),b=A+n.length}if(!f.length){let A=e.querySelector(".code-search-count");A&&(A.textContent="0 / 0");return}let k=[];for(let A=f.
length-1;A>=0;A--){let S=f[A],M=S+n.length,d=i.filter(v=>v.end>S&&v.start<M);for(let v=d.length-1;v>=0;v--){let g=d[v],x=Math.
max(0,S-g.start),w=Math.min(g.node.nodeValue.length,M-g.start),E=g.node,T=E.nodeValue,U=document.createElement("mark");U.
className="code-search-mark",U.textContent=T.slice(x,w);let Y=E.parentNode;w<T.length&&Y.insertBefore(document.createTextNode(
T.slice(w)),E.nextSibling),Y.insertBefore(U,w<T.length?E.nextSibling.previousSibling:E.nextSibling),x>0?E.nodeValue=T.slice(
0,x):Y.removeChild(E),k.unshift(U)}}e._searchState={marks:k,current:0};let N=e.querySelector(".code-search-count");N&&(N.
textContent=k.length?`1 / ${k.length}`:"0 / 0"),k.length&&(k[0].classList.add("current"),k[0].scrollIntoView({block:"nea\
rest"}))}function xi(e,t){if(!e||!e._searchState)return;let{marks:n}=e._searchState;if(!n.length)return;n[e._searchState.
current].classList.remove("current"),e._searchState.current=(e._searchState.current+t+n.length)%n.length;let s=n[e._searchState.
current];s.classList.add("current"),s.scrollIntoView({block:"nearest"});let a=e.querySelector(".code-search-count");a&&(a.
textContent=`${e._searchState.current+1} / ${n.length}`)}function Gg(e){let t=[],n=0;for(;n<e.length;)(n===0||e[n-1]===`\

`)&&e[n]==="`"&&e[n+1]==="`"&&e[n+2]==="`"?(t.push(n),n+=3):n++;if(t.length%2===0)return null;let s=t[t.length-1],a=e.slice(
s+3),i=a.indexOf(`
`);if(i===-1)return{lang:"text",code:""};let u=a.slice(0,i).trim().split(/\s/)[0].toLowerCase()||"text",f=a.slice(i+1);return{
lang:u,code:f}}var Rr=new Map,xo=null,Qs=new Map,rl=0,Wg=256,zg=8*1024*1024;function Kg(e){let t=String(e||""),n=2166136261;
for(let s=0;s<t.length;s+=1)n^=t.charCodeAt(s),n=Math.imul(n,16777619);return(n>>>0).toString(36)}function Vg(e,t){let n=e?.
closest?.(".message")||e;if(!n||typeof IntersectionObserver>"u")return t(),()=>{};xo||(xo=new IntersectionObserver(a=>{for(let i of a){
if(!i.isIntersecting)continue;let c=Rr.get(i.target);if(c){Rr.delete(i.target),xo.unobserve(i.target);for(let u of c)u()}}},
{root:null,rootMargin:"35% 0px",threshold:0}));let s=Rr.get(n);return s||(s=new Set,Rr.set(n,s),xo.observe(n)),s.add(t),
()=>{let a=Rr.get(n);a&&(a.delete(t),!(a.size>0)&&(Rr.delete(n),xo?.unobserve(n)))}}function Yg(e,t){let n=String(e||""),
s=`${t||"content"}${n.length}${Kg(n)}`,a=Qs.get(s);if(a&&a.content===n)return Qs.delete(s),Qs.set(s,a),a.html;let i=Fg(
n),c=typeof DOMPurify<"u"?DOMPurify.sanitize(i,{ADD_DATA_URI_TAGS:["img"],ALLOW_DATA_ATTR:!0}):i,u=(n.length+c.length)*2;
for(Qs.set(s,{content:n,html:c,bytes:u}),rl+=u;Qs.size>Wg||rl>zg;){let f=Qs.keys().next().value,b=Qs.get(f);Qs.delete(f),
rl-=b?.bytes||0}return c}function Tr({content:e,monospace:t=!1,onOpenPath:n=null,autoExpandLongCodeBlocks:s=!1,deferUntilVisible:a=!1,
cacheIdentity:i=""}){let c=React.useRef(null),u=React.useRef(null),f=React.useRef(n),[b,k]=React.useState(!a);return f.current=
n,React.useEffect(()=>{if(!a){k(!0);return}if(!b)return Vg(c.current,()=>k(!0))},[a,b]),React.useEffect(()=>{if(!c.current||
!b||e===u.current)return;let N=u.current;if(N!==null&&e.startsWith(N)){let d=Gg(e);if(d&&!ol(d.code)){let v=c.current.querySelectorAll(
".code-block:not(.diff-block)"),x=(v.length>0?v[v.length-1]:null)?.querySelector(":scope > pre"),w=x?.querySelector("cod\
e");if(w){let E=x.scrollTop,T;try{T=typeof hljs<"u"&&hljs.getLanguage(d.lang)?hljs.highlight(d.code,{language:d.lang}).value:
Fe(d.code)}catch{T=Fe(d.code)}w.innerHTML=bd(T),w.dataset.raw=d.code,x.scrollTop=E,u.current=e;return}}}let A={toolCollapsed:{},
fileChangesCollapsed:{},codeScroll:[],ctxHidden:{},ctxCollapseActive:{}};u.current!==null&&(c.current.querySelectorAll("\
.tool-section[data-tool-index]").forEach(d=>{A.toolCollapsed[d.dataset.toolIndex]=d.classList.contains("collapsed")}),c.
current.querySelectorAll(".file-changes-section[data-file-changes-index]").forEach(d=>{A.fileChangesCollapsed[d.dataset.
fileChangesIndex]=d.classList.contains("collapsed")}),c.current.querySelectorAll(".code-block pre").forEach((d,v)=>{A.codeScroll[v]=
d.scrollTop}),c.current.querySelectorAll(".diff-block, .tool-diff-block").forEach((d,v)=>{d.querySelectorAll(".diff-hunk\
-btn").forEach(x=>{A.ctxHidden[`${v}:${x.dataset.hunkId}`]=x.classList.contains("diff-hunk-ctx-collapsed")});let g=d.querySelector(
".diff-ctx-collapse-all");g&&(A.ctxCollapseActive[v]=g.classList.contains("active"))})),u.current=e,c.current.innerHTML=
Yg(e,i),c.current.querySelectorAll(".tool-section[data-tool-index]").forEach(d=>{let v=d.dataset.toolIndex;if(!(v in A.toolCollapsed))
return;let g=A.toolCollapsed[v],x=d.classList.contains("collapsed");if(g!==x){d.classList.toggle("collapsed",g);let w=d.
querySelector(".tool-body"),E=d.querySelector(".tool-chevron"),T=d.querySelector(".tool-toggle");w&&(w.hidden=g),E&&(E.textContent=
g?"\u25B8":"\u25BE"),T&&T.setAttribute("aria-expanded",g?"false":"true")}}),c.current.querySelectorAll(".file-changes-se\
ction[data-file-changes-index]").forEach(d=>{let v=d.dataset.fileChangesIndex;if(!(v in A.fileChangesCollapsed))return;let g=A.
fileChangesCollapsed[v],x=d.classList.contains("collapsed");if(g!==x){d.classList.toggle("collapsed",g);let w=d.querySelector(
".file-changes-list"),E=d.querySelector(".file-changes-chevron"),T=d.querySelector(".file-changes-toggle");w&&(w.hidden=
g),E&&(E.textContent=g?">":"v"),T&&T.setAttribute("aria-expanded",g?"false":"true")}}),c.current.querySelectorAll(".diff\
-block, .tool-diff-block").forEach((d,v)=>{let g=d.querySelector("code");if(g&&(d.querySelectorAll(".diff-hunk-btn").forEach(
x=>{let w=`${v}:${x.dataset.hunkId}`;!(w in A.ctxHidden)||!A.ctxHidden[w]||(g.querySelectorAll(`[data-hunk-ctx="${x.dataset.
hunkId}"].diff-ctx`).forEach(E=>E.classList.add("diff-ctx-hidden")),x.classList.add("diff-hunk-ctx-collapsed"))}),A.ctxCollapseActive[v])){
let x=d.querySelector(".diff-ctx-collapse-all");x&&x.classList.add("active")}}),c.current.querySelectorAll(".code-copy").
forEach(d=>{d.onclick=()=>{let v=d.closest(".code-block").querySelector("code"),g=v.dataset.raw!==void 0?v.dataset.raw:v.
textContent;navigator.clipboard.writeText(g).then(()=>{d.querySelector(".copy-icon").style.display="none",d.querySelector(
".check-icon").style.display="",d.querySelector(".copy-label").textContent="Copied",d.classList.add("copied"),setTimeout(
()=>{d.querySelector(".copy-icon").style.display="",d.querySelector(".check-icon").style.display="none",d.querySelector(
".copy-label").textContent="Copy",d.classList.remove("copied")},2e3)}).catch(()=>{})}}),c.current.querySelectorAll(".too\
l-toggle").forEach(d=>{d.onclick=()=>{let v=d.closest(".tool-section"),g=v?.querySelector(".tool-body"),x=d.querySelector(
".tool-chevron"),w=v.classList.toggle("collapsed");g&&(g.hidden=w),x&&(x.textContent=w?"\u25B8":"\u25BE"),d.setAttribute(
"aria-expanded",w?"false":"true")}}),c.current.querySelectorAll(".file-changes-toggle").forEach(d=>{d.onclick=()=>{let v=d.
closest(".file-changes-section"),g=v?.querySelector(".file-changes-list"),x=d.querySelector(".file-changes-chevron"),w=v.
classList.toggle("collapsed");g&&(g.hidden=w),x&&(x.textContent=w?">":"v"),d.setAttribute("aria-expanded",w?"false":"tru\
e")}}),c.current.querySelectorAll(".tool-io-more-btn").forEach(d=>{d.onclick=()=>{let v=d.closest(".tool-io-preview"),g=v?.
nextElementSibling;!v||!g||(v.hidden=!0,g.hidden=!1)}}),c.current.querySelectorAll(".tool-io-collapse-btn").forEach(d=>{
d.onclick=()=>{let v=d.closest(".tool-io-full"),g=v?.previousElementSibling;!v||!g||(v.hidden=!0,g.hidden=!1)}}),c.current.
querySelectorAll(".diff-summary-chip").forEach(d=>{d.onclick=v=>{v.preventDefault();let g=d.dataset.target,x=g&&c.current.
querySelector(`#${CSS.escape(g)}`);x&&(x.scrollIntoView({behavior:"smooth",block:"nearest"}),c.current.querySelectorAll(
".diff-summary-chip").forEach(w=>w.classList.remove("active")),d.classList.add("active"))}}),c.current.querySelectorAll(
".diff-split-toggle").forEach(d=>{d.onclick=()=>{let v=d.closest(".diff-block");if(!v)return;let g=v.querySelector(":sco\
pe > pre"),x=v.querySelector(".diff-split"),E=!(v.dataset.diffMode==="split");v.dataset.diffMode=E?"split":"unified",d.classList.
toggle("active",E),d.title=E?"Toggle unified view":"Toggle side-by-side view"}}),c.current.querySelectorAll(".diff-filep\
ath[data-copy-path], .tool-open-file[data-open-path], .inline-file-ref[data-open-path]").forEach(d=>{d.onclick=v=>{v.stopPropagation();
let g=d.dataset.openPath||d.dataset.copyPath,x=f.current;if(g&&typeof x=="function"){v.preventDefault(),x(g);return}d.dataset.
copyPath&&navigator.clipboard.writeText(g).then(()=>{let w=d.textContent;d.textContent="Copied!",d.classList.add("diff-f\
ilepath-copied"),setTimeout(()=>{d.textContent=w,d.classList.remove("diff-filepath-copied")},1500)}).catch(()=>{})}}),c.
current.querySelectorAll(".code-expand-toggle").forEach(d=>{d.onclick=()=>{let v=d.closest(".code-block");if(!v)return;let g=v.
classList.toggle("code-expanded");d.textContent=g?"Collapse":"Expand",d.title=g?"Collapse block":"Expand block",g||v.scrollIntoView(
{behavior:"smooth",block:"nearest"})}}),s&&c.current.querySelectorAll(".code-collapsible").forEach(d=>{d.classList.add("\
code-expanded");let v=d.querySelector(".code-expand-toggle");v&&(v.textContent="Collapse",v.title="Collapse block")}),c.
current.querySelectorAll(".code-wrap-toggle").forEach(d=>{d.onclick=()=>{let v=localStorage.getItem("codeblock_wrap_pref")!==
"1";localStorage.setItem("codeblock_wrap_pref",v?"1":"0"),c.current.querySelectorAll(".code-block").forEach(g=>{g.classList.
toggle("code-wrap",v);let x=g.querySelector(".code-wrap-toggle");x&&(x.textContent=v?"No Wrap":"Wrap",x.title=v?"Disable\
 word wrap":"Enable word wrap",x.classList.toggle("active",v))})}}),c.current.querySelectorAll(".code-search-btn").forEach(
d=>{d.onclick=()=>{let v=d.closest(".code-block");if(!v)return;let g=v.querySelector(".code-search-bar"),x=v.querySelector(
".code-search-input");if(!g)return;!g.hidden?(Ai(v),g.hidden=!0,d.classList.remove("active")):(g.hidden=!1,d.classList.add(
"active"),x&&x.focus())}}),c.current.querySelectorAll(".code-search-input").forEach(d=>{d.oninput=()=>Ug(d.closest(".cod\
e-block")),d.onkeydown=v=>{let g=d.closest(".code-block");v.key==="Enter"&&(v.shiftKey?xi(g,-1):xi(g,1),v.preventDefault()),
v.key==="Escape"&&(Ai(g),g.querySelector(".code-search-bar").hidden=!0,g.querySelector(".code-search-btn").classList.remove(
"active"))}}),c.current.querySelectorAll(".code-search-next").forEach(d=>{d.onclick=()=>xi(d.closest(".code-block"),1)}),
c.current.querySelectorAll(".code-search-prev").forEach(d=>{d.onclick=()=>xi(d.closest(".code-block"),-1)}),c.current.querySelectorAll(
".code-search-close").forEach(d=>{d.onclick=()=>{let v=d.closest(".code-block");Ai(v),v.querySelector(".code-search-bar").
hidden=!0,v.querySelector(".code-search-btn").classList.remove("active")}}),c.current.querySelectorAll(".diff-hunk-btn").
forEach(d=>{d.onclick=v=>{v.stopPropagation();let g=d.dataset.hunkId,x=d.closest("code");if(!x)return;let w=x.querySelectorAll(
`[data-hunk-ctx="${g}"].diff-ctx`),E=w.length>0&&w[0].classList.contains("diff-ctx-hidden");w.forEach(T=>T.classList.toggle(
"diff-ctx-hidden",!E)),d.classList.toggle("diff-hunk-ctx-collapsed",!E)},d.onkeydown=v=>{(v.key==="Enter"||v.key===" ")&&
(v.preventDefault(),d.click())}}),c.current.querySelectorAll(".diff-ctx-collapse-all").forEach(d=>{d.onclick=()=>{let v=d.
closest(".diff-block, .tool-diff-block");if(!v)return;let g=v.querySelector("code");if(!g)return;let x=g.querySelectorAll(
".diff-ctx"),E=Array.from(x).some(T=>!T.classList.contains("diff-ctx-hidden"));x.forEach(T=>T.classList.toggle("diff-ctx\
-hidden",E)),g.querySelectorAll(".diff-hunk-btn").forEach(T=>T.classList.toggle("diff-hunk-ctx-collapsed",E)),d.classList.
toggle("active",E),d.title=E?"Expand all context lines":"Collapse all context lines"}}),c.current.querySelectorAll(".too\
l-show-all").forEach(d=>{d.onclick=()=>{let g=d.closest(".tool-body")?.querySelector("code"),x=d.closest(".tool-section");
if(!g||!x)return;let w=Number(x.dataset.toolIndex||"-1"),E=hd(e||"")[w];!E||E.type!=="tool"||(g.textContent=E.content||"",
d.remove())}}),A.codeScroll.length&&c.current.querySelectorAll(".code-block pre").forEach((d,v)=>{v<A.codeScroll.length&&
A.codeScroll[v]>0&&(d.scrollTop=A.codeScroll[v])});let S=null,M=c.current.querySelector(".diff-summary-bar");if(M&&typeof IntersectionObserver<
"u"){let d=Array.from(c.current.querySelectorAll(".diff-block[id]"));if(d.length>=2){let v=null,g=c.current.parentElement;
for(;g&&g!==document.body;){let w=window.getComputedStyle(g);if(w.overflowY==="auto"||w.overflowY==="scroll"||w.overflow===
"auto"||w.overflow==="scroll"){v=g;break}g=g.parentElement}let x=new IntersectionObserver(w=>{w.forEach(E=>{if(!E.isIntersecting)
return;let T=E.target.id;M.querySelectorAll(".diff-summary-chip").forEach(U=>{U.classList.toggle("active",U.dataset.target===
T)})})},{root:v,threshold:.1});d.forEach(w=>x.observe(w)),S=()=>x.disconnect()}}return()=>{S&&S()}},[e,s,i,b]),React.createElement(
"div",{className:`message-body${t?" monospace-body":""}`,ref:c,"data-rich-content-ready":b?"true":"false"})}function il(e,t=null,n=Date.now()){return{sessionId:e,messageId:null,blockIndex:0,seq:-1,content:"",open:!0,startedAtMs:n,
clientMessageId:t}}function Cd(e,t,n=!1){if(!e||String(e.content||"").length>0||n)return!1;let s=String(t?.kind||"idle").
toLowerCase();return["idle","waiting_for_user","completed","done","failed","error","interrupted"].includes(s)}function xd(e,t,n=Date.
now()){let s=t?.session_id||t?.session||"",a=t?.message_id||"",i=Number(t?.block_index),c=Number(t?.seq);return!s||!a||!Number.
isSafeInteger(i)||i<0||!Number.isSafeInteger(c)||c<0?{accepted:!1,code:"invalid_identity",stream:e||null}:t.op==="block_\
open"?c!==0?{accepted:!1,code:"invalid_open_sequence",stream:e||null}:{accepted:!0,stream:{...il(s,e?.clientMessageId||null,
e?.startedAtMs||n),messageId:a,blockIndex:i,seq:c}}:!e||e.messageId!==a||e.blockIndex!==i||!e.open?{accepted:!1,code:"st\
ream_not_open",stream:e||null}:c!==e.seq+1?{accepted:!1,code:"sequence_gap",stream:e}:t.op==="append"?typeof t.append!="\
string"||t.append.length===0?{accepted:!1,code:"invalid_append",stream:e}:{accepted:!0,stream:{...e,seq:c,content:`${e.content||
""}${t.append}`}}:t.op==="block_close"?{accepted:!0,stream:{...e,seq:c,open:!1}}:{accepted:!1,code:"invalid_operation",stream:e}}function es(e){if(e==null||e==="")return null;let t=null;if(typeof e=="number"||typeof e=="string"&&/^\d+(?:\.\d+)?$/.test(
e.trim())){let s=Number(e);Number.isFinite(s)&&s>0&&(t=s>1e12?s:s*1e3)}else{let s=Date.parse(String(e));Number.isFinite(
s)&&s>0&&(t=s)}if(!Number.isFinite(t)||t<=0)return null;let n=new Date(t);return Number.isNaN(n.getTime())?null:{epoch_ms:n.
getTime(),epoch_seconds:n.getTime()/1e3,iso:n.toISOString()}}function $r(e){return!e||typeof e!="object"?null:es(e.created_at)||
es(e.timestamp)||es(e.ts)||null}function Er(e){if(!e||typeof e!="object")return e;let t=$r(e);return!t||e.timestamp===t.
iso&&e.timestamp_ms===t.epoch_ms&&Number(e.ts)===t.epoch_seconds?e:{...e,ts:t.epoch_seconds,timestamp:t.iso,timestamp_ms:t.
epoch_ms}}function Rd(e){if(!Array.isArray(e))return[];let t=!1,n=e.map(s=>{let a=Er(s);return a!==s&&(t=!0),a});return t?
n:e}function Ad(e,t){return new Intl.DateTimeFormat("en-US-u-ca-gregory",{year:"numeric",...t?{timeZone:t}:{}}).format(e)}
function cl(e,t=new Date,n=void 0,s=void 0){let a=e&&typeof e=="object"&&Number.isFinite(e.epoch_ms)?e:es(e);if(!a)return"";
let i=new Date(a.epoch_ms),c={...Ad(i,s)===Ad(t,s)?{}:{year:"numeric"},month:"short",day:"numeric",hour:"numeric",minute:"\
2-digit",...s?{timeZone:s}:{}};return new Intl.DateTimeFormat(n,c).format(i)}function Md(e,t=void 0,n=void 0){let s=e&&typeof e==
"object"&&Number.isFinite(e.epoch_ms)?e:es(e);return s?`${new Intl.DateTimeFormat(t,{dateStyle:"full",timeStyle:"long",...n?
{timeZone:n}:{}}).format(new Date(s.epoch_ms))} (${s.iso})`:""}function Td(){let e=new Map,t=2048,n="";return{reset(s=""){let a=String(s||"");a!==n&&(n=a,e.clear())},accept(s,a){let i=Number(
s?.state_seq);if(!Number.isSafeInteger(i)||i<0)return!0;let c=String(s?.state_epoch||n||"legacy");if(n&&c!==n)return!1;n||
(n=c);let u=String(a||s?.type||"state"),f=e.get(u);if(f?.epoch===c&&i<=f.seq)return!1;for(e.has(u)&&e.delete(u),e.set(u,
{epoch:c,seq:i});e.size>t;)e.delete(e.keys().next().value);return!0},size(){return e.size}}}var Ri=/(?:!\[[^\]]*\]\([^)]*\)|\[File:\s*[^\]]+\]|\b(?:image|screenshot|screen\s*shot|capture)[\w .()[\]-]*\.(?:png|jpe?g|gif|webp|bmp|svg)\b)/gi,
Mi=/(?:[A-Za-z]:[\\/]|\\\\[^\\/\s]+[\\/]|\/(?:Users|home|mnt|var|tmp|etc|opt|workspace|workspaces)\/)[^\s"'`<>)]{2,}/gi,
Xg=/^(?=.*\d)(?:(?:\d+)\s*d\s*)?(?:(?:\d+)\s*h\s*)?(?:(?:\d+)\s*m\s*)?(?:(?:\d+)\s*s)?$/i,Qg=/^[+-]?\d+\s*[dhms]\b/i,Jg=/^(?:just now|today|yesterday|(?:\d+|an?|one)\s+(?:seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?)\s+ago)$/i,
Zg=/^(?:pursuing goal|paused goal|goal (?:paused|blocked|usage limited|rate limited|limited|budget limited|achieved|cancelled|canceled|stopped|failed)|idle|ready|connected|awaiting live update)$/i,
eh=/^(?:no (?:recent message|current work|data|activity)(?: reported)?|unavailable|unknown|not available)$/i,th=/^(?:(?:antigravity|claude(?: code)?|cline|codex|continue|cursor|gemini|roo code)\s+(?:harness|workspace))$/i,
$d=new Set(["agent","agentmanager","agentsession","antigravity","antigravitychat","antigravityv2","claude","claudecli","\
claudecode","claudecodecli","claudedesktop","cline","codex","codexcli","codexdesktop","connected","connectedsession","co\
ntinue","continueyolo","cursor","cursoragent","cursorcli","cursoride","gemini","geminicodeassist","newchat","newconversa\
tion","other","proceed","resume","roocode","session","unknown","attachment","file","image","screenshot","disregardthatla\
stmessage","ignorethatlastmessage"]);function Lr(e){return typeof e=="string"?e:Array.isArray(e)?e.map(Lr).filter(Boolean).
join(`
`):!e||typeof e!="object"?"":Lr(e.text||e.content||e.markdown||e.value||"")}function ll(){Ri.lastIndex=0,Mi.lastIndex=0}
function nh(e){let t=Lr(e).replace(/\s+/g," ").trim();return t?Xg.test(t)?"duration_only":Qg.test(t)?"duration_malformed":
Jg.test(t)?"age_only":Zg.test(t)?"status_only":eh.test(t)?"placeholder_only":th.test(t)?"surface_label_only":"":"empty"}
function Js(e){let t=Lr(e).replace(/\s+/g," ").trim();if(!t||nh(t)||/^\[(?:attachment|file|image|screenshot)(?:\s*:[^\]]*)?\]$/i.
test(t)||/^new\s+(?:antigravity|claude|codex|continue|cursor|gemini|roo)(?:\s+(?:agent|chat|cli|code|desktop|ide|panel))*\s+(?:chat|conversation|session|thread)$/i.
test(t))return!0;let n=Ri.test(t)||Mi.test(t);if(ll(),n){let a=t.replace(Ri," ").replace(Mi," ").replace(/\b(?:read|open|view|inspect|check|review|show|load|attach|attached|upload|uploaded|file|image|screenshot)\b/gi,
" ").replace(/[^a-z0-9]+/gi,"").trim();if(ll(),a.length<12)return!0}let s=t.toLowerCase().replace(/[^a-z0-9]+/g,"").replace(
/^remoteagent(?:chat)?/,"");return s?$d.has(s)?!0:(s=s.replace(/(?:new|production|session|chat|smoke|test|probe|verification|fixture|extension|ext|ide|app|panel|pane)$/g,
""),$d.has(s)):!/[\p{L}\p{N}]/u.test(t)}function Pd(e){let t=Lr(e);if(!t)return"";let n=t.replace(/<goal_context>[\s\S]*?<\/goal_context>/gi,
" ").replace(/```[\s\S]*?```/g," ").replace(Ri," ").replace(Mi," ").replace(/<[^>\n]{1,120}>/g," ").replace(/`([^`]+)`/g,
"$1").replace(/^\s*(?:user|assistant|codex|claude|tool result)\s*[:\-]\s*/i,"").replace(/\s+/g," ").trim();return ll(),!n||
Js(n)||/^(?:thinking|working|tool result|tool:|exit code|wall time|read|open|view|inspect|check|review|show|load|attach|attached|uploaded|file|image|screenshot)\b/i.
test(n)&&n.split(/\s+/).length<=4||/^[^\p{L}\p{N}]+$/u.test(n)?"":n.slice(0,80).trim()}function sh(e){let t=Array.isArray(
e)?e:[];for(let n of t){if(String(n?.role||"").toLowerCase()!=="user")continue;let s=Pd(n?.content||n?.content_blocks);if(s)
return s}return""}var Ed=Object.freeze({fallback:0,route:.5,message:1,summary:2,custom:3,native:4}),ah=Object.freeze(["c\
odex_desktop_active_thread_title","cursor_agent_title","native_chat_title","session_title","thread_title","conversation_\
title","title","display_title","summary","chat_title","chat_title_source","thread_name","conversation_name","custom_disp\
lay_name","is_new_chat_draft","is_list_view"]);function Ld(e){return Lr(e).replace(/\s+/g," ").trim()}function qd(e){return!e||
typeof e!="object"?{}:Object.fromEntries(ah.filter(t=>Object.prototype.hasOwnProperty.call(e,t)).map(t=>[t,e[t]]))}function ul(e,t="",n=[],s=""){
let a=e&&typeof e=="object"?e:{},c=[["codex_desktop_active_thread_title",a.codex_desktop_active_thread_title],["cursor_a\
gent_title",a.cursor_agent_title],["native_chat_title",a.native_chat_title],["session_title",a.session_title],["thread_t\
itle",a.thread_title],["conversation_title",a.conversation_title],["title",a.title],["display_title",a.display_title],["\
chat_title",a.chat_title_source==="summary"?"":a.chat_title],["thread_name",a.thread_name],["conversation_name",a.conversation_name]].
map(([N,A])=>({field:N,title:Ld(A)})).find(N=>N.title&&!Js(N.title));if(c)return{title:c.title.slice(0,80).trim(),source:"\
native",field:c.field};let u=Ld(t);if(u&&!Js(u))return{title:u.slice(0,80).trim(),source:"custom",field:"custom_display_\
name"};let b=[["chat_title",a.chat_title_source==="summary"?a.chat_title:""],["summary",a.summary],["derived_message_tit\
le",s]].map(([N,A])=>({field:N,title:Pd(A)})).find(N=>N.title);if(b)return{title:b.title,source:"summary",field:b.field};
let k=sh(n);return k?{title:k,source:"message",field:"first_meaningful_user_message"}:{title:"New chat",source:"fallback",
field:"new_chat"}}function Id(e,t){if(!e?.title)return t;if(!t?.title)return e;let n=Ed[e.source]??0;return(Ed[t.source]??
0)>=n?t:e}function Od(e,t="",n=[],s=""){return ul(e,t,n,s).title}var rh=/(?:\bbearer\s+[a-z0-9._~+/=-]{8,}|\b(?:api[_ -]?key|password|passwd|secret|access[_ -]?token|refresh[_ -]?token)\s*[:=]\s*\S+|\bsk-[a-z0-9_-]{8,})/i,
oh=/(?:[A-Za-z]:[\\/]|\\\\[^\\/\s]+[\\/]|\/(?:Users|home|mnt|var|tmp|etc|opt|workspace|workspaces)\/)[^\s"'<>)]{2,}/i;function ih(e){
let t=0;for(let n of String(e||"")){let s=n.codePointAt(0);t+=s<=127?1:s<=2047?2:s<=65535?3:4}return t}function Pn(e,t=96){
if(typeof e!="string"&&typeof e!="number")return"";let n=String(e).replace(/[\u0000-\u001f\u007f]+/g," ").replace(/\s+/g,
" ").trim();return!n||rh.test(n)||oh.test(n)?"":n.slice(0,t).trim()}function Ti(e){if(e==null||e==="")return null;let t=typeof e==
"number"&&Number.isFinite(e)?e:NaN,n=Number.isFinite(t)?t>0&&t<1e12?t*1e3:t:Date.parse(String(e));return Number.isFinite(
n)&&n>0?new Date(n).toISOString():null}function ch(e){let t=String(e||"").trim().toLowerCase().replace(/[^a-z]/g,"");return{
active:"active",paused:"paused",blocked:"blocked",usagelimited:"usageLimited",ratelimited:"usageLimited",budgetlimited:"\
budgetLimited",complete:"complete",completed:"complete",cancelled:"cancelled",canceled:"cancelled",failed:"failed",idle:"\
idle",working:"working"}[t]||null}function dl(e){if(!e||typeof e!="object"||Number(e.schema_version)!==1)return null;let t={
schema_version:1,parser_version:Pn(e.parser_version,32)||"fleet-summary-v1",session_key:Pn(e.session_key,40),session_generation:Math.
max(1,Number(e.session_generation)||1),thread_key:Pn(e.thread_key,40),thread_generation:Math.max(1,Number(e.thread_generation)||
1),producer_seq:Math.max(0,Number(e.producer_seq)||0),summary_seq:Math.max(0,Number(e.summary_seq)||0),title:Pn(e.title,
80)||null,title_source:Pn(e.title_source,24)||null,title_confidence:["authoritative","derived","unknown"].includes(e.title_confidence)?
e.title_confidence:"unknown",latest_user_request:Pn(e.latest_user_request)||null,latest_user_request_at:Ti(e.latest_user_request_at),
current_work:Pn(e.current_work)||null,current_work_source:Pn(e.current_work_source,32)||null,current_work_kind:Pn(e.current_work_kind,
24)||null,current_work_state:ch(e.current_work_state),current_work_at:Ti(e.current_work_at),last_role:["user","assistant"].
includes(e.last_role)?e.last_role:null,last_message_at:Ti(e.last_message_at),last_snippet:Pn(e.last_snippet)||null,message_count:Math.
max(0,Number(e.message_count)||0),user_count:Math.max(0,Number(e.user_count)||0),assistant_count:Math.max(0,Number(e.assistant_count)||
0),other_count:Math.max(0,Number(e.other_count)||0),role_imbalance:["balanced","assistant_without_user","user_without_as\
sistant"].includes(e.role_imbalance)?e.role_imbalance:"balanced",rejected_candidate_reason:Pn(e.rejected_candidate_reason,
48)||null,fresh_at:Ti(e.fresh_at)};return!t.session_key||!t.thread_key||ih(JSON.stringify(t))>1024?null:t}function Dd(e){
return e?.title_confidence==="authoritative"?3:e?.title_confidence==="derived"?2:e?.title?1:0}function jd(e,t){let n=dl(
e),s=dl(t);if(!s)return{summary:n,accepted:!1,changed:!1,reason:"invalid"};if(!n)return{summary:{...s,summary_seq:Math.max(
1,s.summary_seq)},accepted:!0,changed:!0,reason:"initial"};if(s.session_generation<n.session_generation)return{summary:n,
accepted:!1,changed:!1,reason:"older_session_generation"};if(s.session_generation===n.session_generation&&s.session_key!==
n.session_key)return{summary:n,accepted:!1,changed:!1,reason:"session_identity_mismatch"};if(s.session_generation===n.session_generation&&
s.thread_generation<n.thread_generation)return{summary:n,accepted:!1,changed:!1,reason:"older_thread_generation"};if(s.session_generation===
n.session_generation&&s.thread_generation===n.thread_generation&&s.thread_key!==n.thread_key)return{summary:n,accepted:!1,
changed:!1,reason:"thread_identity_mismatch"};let a=s.session_generation>n.session_generation||s.thread_generation>n.thread_generation,
i=s.producer_seq>n.producer_seq||s.producer_seq===n.producer_seq&&s.summary_seq>n.summary_seq;if(!a&&!i)return{summary:n,
accepted:!1,changed:!1,reason:"replayed_or_out_of_order"};let c=a?{...s}:{...n,...s};if(!a){(!s.title||Dd(s)<Dd(n))&&(c.
title=n.title,c.title_source=n.title_source,c.title_confidence=n.title_confidence);for(let f of["latest_user_request","l\
atest_user_request_at","current_work","current_work_source","current_work_kind","current_work_state","current_work_at","\
last_role","last_message_at","last_snippet","fresh_at"])(s[f]==null||s[f]==="")&&(c[f]=n[f]);for(let f of["message_count",
"user_count","assistant_count","other_count"])c[f]=Math.max(n[f]||0,s[f]||0)}c.summary_seq=Math.max(n.summary_seq||0,s.summary_seq||
0);let u=JSON.stringify(n)!==JSON.stringify(c);return{summary:u?c:n,accepted:!0,changed:u,reason:u?"upgraded":"unchanged"}}
function Bd(e){let t=dl(e);if(!t)return{};let n=t.current_work?{kind:t.current_work_kind||"activity",label:t.current_work_kind===
"goal"?"Goal":t.current_work_kind==="request"?"Request":"Current work",text:t.current_work,source:t.current_work_source||
"fleet_summary",updated_at:t.current_work_at,...t.current_work_state?{state:t.current_work_state}:{}}:null;return{fleet_summary:t,
...t.title?{chat_title:t.title,chat_title_source:t.title_source}:{},...t.latest_user_request?{last_user_request:{text:t.
latest_user_request,updated_at:t.latest_user_request_at}}:{},...t.last_snippet?{last_snippet:t.last_snippet,last_message_at:t.
last_message_at}:{},...n?{fleet_work_context:n}:{}}}var Fd=new Set(["__proto__","constructor","prototype"]);function Hd(e){return typeof e=="string"?e:e?.session_id||e?.id||
""}function Ut(e,t){if(Object.is(e,t))return!0;if(e==null||t==null||typeof e!=typeof t||typeof e!="object")return!1;if(Array.
isArray(e)||Array.isArray(t)){if(!Array.isArray(e)||!Array.isArray(t)||e.length!==t.length)return!1;for(let a=0;a<e.length;a+=
1)if(!Ut(e[a],t[a]))return!1;return!0}let n=Object.keys(e),s=Object.keys(t);if(n.length!==s.length)return!1;for(let a of n)
if(!Object.prototype.hasOwnProperty.call(t,a)||!Ut(e[a],t[a]))return!1;return!0}function $i(e=[]){let t=[],n=[],s=Object.
create(null),a=Object.create(null);for(let i of Array.isArray(e)?e:[]){let c=Hd(i);if(!c||Object.prototype.hasOwnProperty.
call(s,c))continue;a[c]=t.length,n.push(c);let u=ml(null,i);s[c]=u,t.push(u)}return{byId:s,indexById:a,order:n,list:t}}function pl(e){
return e?.is_new_chat_draft===!0}function ml(e,t){if(!t||typeof t!="object")return t;if(pl(t)){let i={...t};for(let c of[
"fleet_summary","fleet_work_context","last_user_request","last_snippet","last_message_at"])delete i[c];return i}let n=jd(
e?.fleet_summary,t.fleet_summary).summary;if(!n)return t;let s=Bd(n),a={...t,...s};return s.fleet_work_context&&a.activity&&
typeof a.activity=="object"&&!a.activity.work_context&&(a.activity={...a.activity,work_context:s.fleet_work_context}),a}
function Ud(e,t){return!e||typeof e!="object"||!t||typeof t!="object"||pl(t)||Js(e.chat_title)||!Js(t.chat_title)?t:{...t,
chat_title:e.chat_title,chat_title_source:e.chat_title_source||t.chat_title_source||null}}function Ao(e,t){let n=e?.byId?
e:$i(),s=Array.isArray(t)?t:[],a=[],i=[],c=Object.create(null),u=Object.create(null),f=s.length!==n.list.length;for(let b of s){
let k=Hd(b);if(!k||Object.prototype.hasOwnProperty.call(c,k))continue;let N=n.byId[k],A=Ud(N,ml(N,b)),S=N!==void 0&&Ut(N,
A)?N:A;u[k]=a.length,i.push(k),c[k]=S,a.push(S),(!Object.is(S,N)||n.order[a.length-1]!==k)&&(f=!0)}return(a.length!==s.length||
a.length!==n.list.length)&&(f=!0),f?{byId:c,indexById:u,order:i,list:a}:n}function Gd(e,t){let n=e?.byId?e:$i(),s=t?.session_id||
t?.session||"";if(!s||!Object.prototype.hasOwnProperty.call(n.byId,s))return n;let a=n.byId[s],i=a&&typeof a=="object"?a:
{session_id:s},c=t?.patch&&typeof t.patch=="object"?t.patch:{},u=Array.isArray(t?.removed_fields)?t.removed_fields:[],f=pl(
c),b=!f&&!Js(i.chat_title)&&(!Object.prototype.hasOwnProperty.call(c,"chat_title")||Js(c.chat_title)),k=i;for(let[M,d]of Object.
entries(c))Fd.has(M)||M==="session_id"||M==="id"||b&&(M==="chat_title"||M==="chat_title_source")||Ut(k[M],d)||(k===i&&(k=
{...i}),k[M]=d);for(let M of u)typeof M!="string"||Fd.has(M)||M==="session_id"||M==="id"||b&&(M==="chat_title"||M==="cha\
t_title_source")||Object.prototype.hasOwnProperty.call(k,M)&&(k===i&&(k={...i}),delete k[M]);if(f&&!Object.prototype.hasOwnProperty.
call(c,"chat_title")&&(k===i&&(k={...i}),k.chat_title=null,k.chat_title_source=null),k=Ud(i,ml(i,k)),Ut(k,i))return n;k.
session_id=s;let N=n.indexById[s],A=n.list.slice();A[N]=k;let S=Object.assign(Object.create(null),n.byId);return S[s]=k,
{byId:S,indexById:n.indexById,order:n.order,list:A}}var Wd=10,it=new Map,Ro=new Map,lh=Object.freeze([]);function Ea(e){return String(e||"").trim()}function uh(e){return!e||
typeof e!="object"?"":e.source_message_id?`source:${e.source_message_id}`:e.native_source_id?`native:${e.native_source_id}`:
e.id!=null?`id:${e.id}`:e.server_message_id!=null?`server:${e.server_message_id}`:e.sequence!=null?`sequence:${e.sequence}`:
e.client_message_id?`client:${e.client_message_id}`:e.client_msg_id?`client:${e.client_msg_id}`:e._cid?`client:${e._cid}`:
`content:${e.role||""}:${e.ts||""}:${String(e.content||"")}`}function dh(e,t){let n=[],s=new Map;return[...Array.isArray(
e)?e:[],...Array.isArray(t)?t:[]].forEach(a=>{let i=uh(a);if(i&&s.has(i)){let c=s.get(i);n[c]={...n[c],...a};return}i&&s.
set(i,n.length),n.push(a)}),n.sort((a,i)=>{let c=Number(a?.sequence),u=Number(i?.sequence);return Number.isFinite(c)&&Number.
isFinite(u)&&c!==u?c-u:(Number(a?.ts)||0)-(Number(i?.ts)||0)})}function zd(e){let t=Ea(e);if(!t||!it.has(t))return null;
let n=it.get(t);return it.delete(t),it.set(t,n),n}function Ei(e){let t=Ea(e);return t&&it.get(t)||lh}function Kd(e,t){let n=Ea(
e);if(!n||typeof t!="function")return()=>{};let s=Ro.get(n)||new Set;return s.add(t),Ro.set(n,s),()=>{let a=Ro.get(n);a&&
(a.delete(t),a.size===0&&Ro.delete(n))}}function fl(e){let t=Ro.get(e);t&&[...t].forEach(n=>n())}function gl(e,t,n=Wd){let s=Ea(e);if(!s||!Array.isArray(t))return[];let a=Rd(t),i=it.get(s);it.delete(s),it.set(s,a);let c=[],
u=Math.max(1,Number(n)||Wd);for(;it.size>u;){let f=it.keys().next().value;it.delete(f),c.push(f)}return i!==a&&fl(s),c.forEach(
fl),c}function hl(e){let t=Ea(e);return!t||!it.has(t)?!1:(it.delete(t),fl(t),!0)}function Vd(e,t){let n=Ea(e),s=Ea(t);if(!n||
!s||n===s)return Ei(s);let a=it.get(n)||[],i=it.get(s)||[];return a.length>0&&gl(s,dh(i,a)),hl(n),Ei(s)}function ph(){return Object.
fromEntries([...it.entries()])}function Yd(e){let t=ph(),n=typeof e=="function"?e(t):e;if(!n||n===t||typeof n!="object")
return t;let s=new Set(Object.keys(n));return Object.keys(t).forEach(a=>{s.has(a)||hl(a)}),Object.entries(n).forEach(([a,
i])=>{Array.isArray(i)&&t[a]!==i&&gl(a,i)}),n}var _l=new Proxy({},{get(e,t){if(typeof t=="string")return it.get(t)},ownKeys(){
return[...it.keys()]},getOwnPropertyDescriptor(e,t){if(typeof t=="string"&&it.has(t))return{configurable:!0,enumerable:!0,
value:it.get(t)}},set(e,t,n){return typeof t!="string"||!Array.isArray(n)?!1:(gl(t,n),!0)},deleteProperty(e,t){return typeof t==
"string"?hl(t):!1}});var mh=new Set(["thinking","generating","reading_files","running_command","applying_patch","working"]),fh=new Set(["wait\
ing_for_user","needs_attention","blocked","rate_limited","usage_limited","budget_limited","failed","error"]),gh=new Set(
["blocked","usagelimited","budgetlimited","failed"]),hh=new Set(["complete","completed","cancelled","canceled"]),Xd=new Set(
["starting","running_turn","checkpoint_pending_continuation","verifying"]),_h=new Set(["waiting_for_user","blocked_limit\
ed"]),bh=new Set(["paused","completed_cancelled_failed","unknown_disconnected"]),bl=15e3;function vh(e){return String(e?.
goal?.state||e?.goal?.status||"").trim().toLowerCase().replace(/[^a-z]/g,"")}function Qd(e){let t=e?.goal,n=e?.goal_run;
return!t||!n||n.schema_version!==1||!n.run_id||!n.goal_fingerprint||!Number.isFinite(Number(n.goal_generation))||String(
n.goal_fingerprint)!==String(t.fingerprint||"")||Number(n.goal_generation)!==Math.max(1,Number(t.generation)||1)?null:n}
function La(e){if(typeof e=="number"&&Number.isFinite(e))return e;let t=Date.parse(String(e||""));return Number.isFinite(
t)?t:0}function qi(e){return Math.max(La(e?.transport?.client_received_at_ms),La(e?.transport?.relay_forwarded_at_ms),La(
e?.observed_at),La(e?.updatedAt),La(e?.updated_at))}function Li(e,t={}){if(t.connected===!1||String(t.health||"").toLowerCase()===
"disconnected"||t.fresh===!1)return!1;if(t.requireFreshness!==!0)return!0;let n=qi(e);if(!n)return!1;let s=Number.isFinite(
Number(t.nowMs))?Number(t.nowMs):Date.now(),a=Math.max(1e3,Number(t.freshnessMs)||bl);return s-n<=a}function Ii(e,t=!1,n={}){
let s=String(e?.kind||"").trim().toLowerCase(),a=vh(e),i=Qd(e),c=String(i?.lifecycle||"").trim().toLowerCase();if(t||fh.
has(s)||_h.has(c))return"needs_attention";let u=e?.generating===!0||mh.has(s);return i?.lease_active===!0&&i.owner_state===
"confirmed"&&Xd.has(c)&&u&&Li(e,n)?"working_goal":gh.has(a)?"needs_attention":i&&c==="unknown_disconnected"?"stale":i&&bh.
has(c)||hh.has(a)?"idle":i?.lease_active===!0&&Xd.has(c)?"working_goal":i&&a==="active"||a==="active"?Li(e,n)?"between_g\
oal_turns":"stale":s==="idle"&&a!=="active"?"idle":Li(e,n)?u?"working":"idle":"stale"}function Oi(e,t={}){let n=Qd(e),s=String(
n?.lifecycle||"").trim().toLowerCase();return!n||n.lease_active!==!0?"":s==="checkpoint_pending_continuation"?"Waiting f\
or next goal turn":s==="verifying"||t.connected===!1||String(t.health||"").toLowerCase()==="disconnected"?"Reconnecting":
s==="starting"?"Starting goal":s==="running_turn"?"Working":"Goal loop active"}function Jd(e){return e==="working_goal"?
"Working on goal":e==="working"?"Working":e==="between_goal_turns"?"Between goal turns":e==="needs_attention"?"Needs att\
ention":e==="stale"?"Stale":"Idle"}function Pa(e){return e==="working_goal"||e==="working"}function Zd(e,t=null,n=Date.now()){
if(!e||typeof e!="object")return 0;let s=Math.max(0,Number(e.time_used_seconds??e.timeUsedSeconds??0)||0),a=La(e.updated_at||
e.updatedAt),i=String(e.state||e.status||"").toLowerCase()==="active",c=t&&t.lease_active!==!0?La(t.lease_observed_at||t.
observed_at):Number(n),u=c>0?Math.min(Number(n)||c,c):a,f=i&&a>0?Math.max(0,Math.floor((u-a)/1e3)):0;return Math.floor(s+
f)}function Pi(e){let t=Number(e);return Number.isFinite(t)&&t>0?t:null}function ep(e,t=Date.now()){if(!e||typeof e!="ob\
ject")return null;let n=Pi(e.proxy_emitted_at_ms),s=Pi(e.relay_received_at_ms),a=Pi(e.relay_forwarded_at_ms),i=Pi(t)||Date.
now();return{proxy_emitted_at_ms:n,relay_received_at_ms:s,relay_forwarded_at_ms:a,client_received_at_ms:i,latency_ms:n==
null?null:Math.max(0,i-n)}}function tp(e,t=Date.now()){let n=Number(e?.transport?.latency_ms);if(Number.isFinite(n))return`${Math.
round(n)} ms`;let s=qi(e);if(!s)return"Awaiting live update";let a=Math.max(0,Number(t)-s);return a<1e3?"Observed just n\
ow":a<6e4?`Observed ${Math.floor(a/1e3)}s ago`:a<36e5?`Observed ${Math.floor(a/6e4)}m ago`:`Observed ${Math.floor(a/36e5)}\
h ago`}var yh=Object.freeze(["goal_completed","goal_attention","provider_usage_threshold"]),kh=new Set(yh),np=Object.freeze({goal_completed:"\
goal_completed",goal_attention:"goal_attention",provider_usage_threshold:"provider_usage_warning"}),ap="remote-agent-cha\
t:semantic-notifications:v1",wh="remote-agent-chat:semantic-notification-claim:v1:",rp=256,Sh=10080*60*1e3;function Di(e){
if(!e||typeof e!="object"||e.type!=="semantic_notification")return null;let t=String(e.event_type||"").trim(),n=String(e.
dedupe_key||"").trim(),s=String(e.session_id||e.session||"").trim();if(!kh.has(t)||!n||!s)return null;let a=String(e.category||
np[t]).trim();return a!==np[t]?null:{...e,type:"semantic_notification",event_type:t,category:a,dedupe_key:n,session_id:s,
session:s,title:String(e.title||"").trim()||(t==="goal_completed"?"Goal completed":t==="provider_usage_threshold"?"Provi\
der usage warning":"Goal needs attention"),body:String(e.body||"").trim(),created_at:e.created_at||new Date().toISOString()}}
function yl(e,t,n=100){let s=new Map;return[...Array.isArray(e)?e:[],...Array.isArray(t)?t:[t]].map(Di).filter(Boolean).
forEach(a=>s.set(a.dedupe_key,a)),[...s.values()].slice(-Math.max(1,Number(n)||100))}function op(e,t={}){let n=Di(e);return!!n&&
t?.[n.category]===!0}function vl(e,t){try{let n=JSON.parse(e?.getItem(ap)||"{}");return Object.fromEntries(Object.entries(
n||{}).filter(([,s])=>Number(s)>t-Sh).slice(-rp))}catch{return{}}}function sp(e,t,n){let s=vl(e,n);if(s[t])return!1;s[t]=
n;let a=Object.entries(s).slice(-rp);try{e?.setItem(ap,JSON.stringify(Object.fromEntries(a)))}catch{}return!0}function Nh(e){
return new Promise(t=>setTimeout(t,e))}async function Ch(e,t,n){if(!e)return!0;if(vl(e,n)[t])return!1;let s=`${wh}${encodeURIComponent(
t).slice(0,320)}`,a=`${n}:${Math.random().toString(36).slice(2)}`;try{if(e.setItem(s,JSON.stringify({token:a,at:n})),await Nh(
20),JSON.parse(e.getItem(s)||"{}").token!==a||!sp(e,t,n))return!1;let c=vl(e,n)[t]===n;return c&&e.removeItem(s),c}catch{
return sp(e,t,n)}}async function ip(e,{storage:t=typeof localStorage<"u"?localStorage:null,locks:n=typeof navigator<"u"?
navigator.locks:null,now:s=()=>Date.now()}={}){let a=Di(e);if(!a)return!1;let i=()=>Ch(t,a.dedupe_key,s());return n?.request?
n.request(`rac-semantic:${a.dedupe_key}`,{mode:"exclusive"},i):i()}async function qa(e,t,{channel:n="web-in-app",reasonCode:s="",
clientId:a="web-app"}={}){let i=Di(e);if(!i||!["claimed","displayed","suppressed"].includes(t)||typeof fetch!="function")
return!1;try{return(await fetch("/api/notifications/semantic-receipts",{method:"POST",credentials:"same-origin",keepalive:!0,
headers:{"Content-Type":"application/json"},body:JSON.stringify({dedupe_key:i.dedupe_key,stage:t,channel:n,...s?{reason_code:s}:
{},client_id:a})})).ok}catch{return!1}}function cp(e,t,n=""){if(!t)return"";let s=e||{};return n&&(s[n]||[]).some(a=>a?._cid===t)?n:Object.keys(s).find(a=>(s[a]||
[]).some(i=>i?._cid===t))||""}function lp(e,t,n,s){if(!t||!n||typeof s!="function")return e;let a=e?.[n]||[],i=!1,c=a.map(
u=>{if(u?._cid!==t)return u;let f=s(u);return f!==u&&(i=!0),f});return i?{...e,[n]:c}:e}function xh(e){let t=Number(e);return!Number.isSafeInteger(t)||t<=0?0:t}function Ah(e){return String(e?.navigation_session_id||
e?.session_id||e?.session||"")}function up(e={}){let t=Math.max(1,Number(e.maxEntries)||512),n=new Map;function s(a,i){for(n.
delete(a),n.set(a,i);n.size>t;)n.delete(n.keys().next().value)}return{accept(a){let i=Ah(a),c=xh(a?.navigation_epoch);if(!i||
!c)return!0;let u=n.get(i)||0;return c<u?!1:(s(i,c),!0)},latest(a){return n.get(String(a||""))||0},get size(){return n.size}}}var Rh=new Set(["user","assistant","tool","tool_result","permission","permission_prompt","question","question_prompt","e\
rror","system"]);function ft(e){return typeof e=="string"?e:String(e?.session_id||e?.id||"")}function Mh(e){let t=String(
e||"").trim().toLowerCase().replace(/[\s-]+/g,"_");return Rh.has(t)?t==="permission_prompt"?"permission":t==="question_p\
rompt"?"question":t:null}function Th(e){let t=String(e||"").trim();return!t||t.length>256||/[\u0000-\u001f\u007f]/.test(
t)?null:t}function $h(e){let t=String(e||"").trim().toLowerCase().replace(/[\s-]+/g,"_");return!t||t.length>64||/[^a-z0-9_.:/]/.
test(t)?null:t}function Eh(e){if(typeof e=="number"||typeof e=="string"&&/^\d+(?:\.\d+)?$/.test(e.trim())){let n=Number(
e);return!Number.isFinite(n)||n<=0?null:n>1e12?n:n*1e3}if(typeof e!="string"||!e.trim())return null;let t=Date.parse(e);
return Number.isFinite(t)&&t>0?t:null}function Pr(e){if(!e||typeof e!="object")return null;let t=e.latest_visible_message&&
typeof e.latest_visible_message=="object"?e.latest_visible_message:null,n=Th(t?.id??t?.message_id??e.last_message_id),s=Eh(
t?.at??t?.timestamp??e.last_message_at),a=Mh(t?.kind??e.last_message_kind),i=$h(t?.source??e.last_message_source);return!n||
!s||!a||!i?null:Object.freeze({id:n,at:new Date(s).toISOString(),atMs:s,kind:a,source:i})}function wl(e){let t=Pr(e);return t?
{latest_visible_message:{id:t.id,at:t.at,kind:t.kind,source:t.source},last_message_id:t.id,last_message_at:t.at,last_message_kind:t.
kind,last_message_source:t.source}:{}}function Lh(e,t){let n=Pr(e),s=Pr(t);if(n&&!s)return-1;if(!n&&s)return 1;if(!n&&!s)
return ft(e).localeCompare(ft(t));if(n.atMs!==s.atMs)return s.atMs-n.atMs;let a=s.id.localeCompare(n.id);return a!==0?a:
ft(e).localeCompare(ft(t))}function Ph(e){return(Array.isArray(e)?e:[]).filter(t=>!!ft(t)&&!!Pr(t)).slice().sort(Lh)}function kl(e){
return e instanceof Set?e:!e||typeof e[Symbol.iterator]!="function"?new Set:new Set(Array.from(e,t=>String(t||"")))}function dp(e,t={}){
let n=kl(t.workingSessionIds),s=kl(t.pinnedSessionIds),a=new Map([...s].map((x,w)=>[x,w])),i=kl(t.excludedSessionIds),c=Number.
isSafeInteger(t.limit)&&t.limit>=0?t.limit:5,u=new Set,f=[];for(let x of Array.isArray(e)?e:[]){let w=ft(x);!w||u.has(w)||
i.has(w)||(u.add(w),f.push(x))}let b=f.filter(x=>n.has(ft(x))),k=f.filter(x=>!n.has(ft(x))),N=Ph(k).slice(0,c),A=new Set(
N.map(ft)),S=k.filter(x=>!A.has(ft(x))),M=S.filter(x=>s.has(ft(x))).sort((x,w)=>a.get(ft(x))-a.get(ft(w))),d=new Set(M.map(
ft)),v=S.filter(x=>!d.has(ft(x))),g=Object.fromEntries([...b.map(x=>[ft(x),"working"]),...N.map(x=>[ft(x),"recent"]),...M.
map(x=>[ft(x),"pinned"]),...v.map(x=>[ft(x),"workspace"])]);return{working:b,recent:N,pinned:M,remaining:v,ownership:g}}var qr=Object.freeze({live:6e4,"1m":6e4,"5m":3e5,"15m":9e5,since_open:1/0}),qh=Object.freeze({cpu_total_percent:["cpu","\
totalPercent"],cpu_user_percent:["cpu","userPercent"],cpu_privileged_percent:["cpu","privilegedPercent"],memory_used_percent:[
"memory","usedPercent"],memory_commit_percent:["memory","commitPercent"],disk_read_bps:["disk","readBps"],disk_write_bps:[
"disk","writeBps"],disk_read_iops:["disk","readIops"],disk_write_iops:["disk","writeIops"],network_receive_bps:["network",
"receiveBps"],network_send_bps:["network","sendBps"],network_receive_pps:["network","receivePps"],network_send_pps:["net\
work","sendPps"]});function ct(e,t=0){let n=Number(e);return Number.isFinite(n)?n:t}function At(e){if(e==null||e==="")return null;
let t=Number(e);return Number.isFinite(t)&&t>=0?t:null}function ye(e){return Math.max(0,ct(e))}function Gt(e){return Math.
max(0,Math.min(100,ct(e)))}function ji(e){let t=String(e??"0");return/^\d+$/.test(t)?t:"0"}function Mo(e){let t=Date.parse(
String(e||""));return Number.isFinite(t)?t:0}function Ih(e,t){let n=Math.max(0,Math.round(ct(e?.pid))),s=e?.start_time?String(
e.start_time):"",a=String(e?.stable_key||`${n||"process"}:${s||t}`),i=String(e?.attribution_level||(e?.attributed?"runti\
me":"unattributed"));return{key:a,stableKey:a,parentKey:e?.parent_key?String(e.parent_key):"",pid:n,parentPid:Math.max(0,
Math.round(ct(e?.parent_pid))),startTime:s,name:String(e?.name||"Process"),status:String(e?.status||"running"),attributed:e?.
attributed===!0,attributionLevel:i,attributionReason:String(e?.attribution_reason||"No proved agent relationship"),ownedSessionId:e?.
owned_session_id?String(e.owned_session_id):"",agentLabel:e?.agent_label?String(e.agent_label):"",agentTypes:Array.isArray(
e?.agent_types)?e.agent_types.map(String):[],workspaceLabel:e?.workspace_label?String(e.workspace_label):"",sessionCount:Math.
max(0,Math.round(ct(e?.session_count))),cpuPercent:Gt(e?.cpu_host_percent??e?.cpu_percent),cpuHostPercent:Gt(e?.cpu_host_percent??
e?.cpu_percent),cpuCoreEquivalent:ye(e?.cpu_core_equivalent??e?.cpu_percent),memoryBytes:ye(e?.memory_bytes),privateBytes:ye(
e?.private_bytes??e?.memory_bytes),commitBytes:ye(e?.commit_bytes??e?.private_bytes),ioReadBps:ye(e?.io_read_bps),ioWriteBps:ye(
e?.io_write_bps),ioReadOps:ye(e?.io_read_ops),ioWriteOps:ye(e?.io_write_ops),threadCount:Math.max(0,Math.round(ct(e?.thread_count))),
handleCount:Math.max(0,Math.round(ct(e?.handle_count))),uptimeSeconds:e?.uptime_seconds==null?null:ye(e.uptime_seconds),
childCount:Math.max(0,Math.round(ct(e?.child_count))),selectedAs:Array.isArray(e?.selected_as)?e.selected_as.map(String):
[],selectedParentPresent:e?.selected_parent_present!==!1,counterTotals:{ioReadBytes:ji(e?.counter_totals?.io_read_bytes),
ioWriteBytes:ji(e?.counter_totals?.io_write_bytes),ioReadOperations:ji(e?.counter_totals?.io_read_operations),ioWriteOperations:ji(
e?.counter_totals?.io_write_operations)}}}function Oh(e,t){return{id:String(e?.id||`disk-${t}`),label:String(e?.label||`\
Disk ${t+1}`),kind:String(e?.kind||"unknown"),readBps:ye(e?.read_bps),writeBps:ye(e?.write_bps),readIops:ye(e?.read_iops),
writeIops:ye(e?.write_iops),busyPercent:Gt(e?.busy_percent),readLatencyMs:ye(e?.read_latency_ms),writeLatencyMs:ye(e?.write_latency_ms),
queueLength:ye(e?.queue_length),capacityBytes:ye(e?.capacity_bytes),freeBytes:ye(e?.free_bytes),freePercent:Gt(e?.free_percent),
available:e?.available!==!1}}function Dh(e,t){return{id:String(e?.id||`adapter-${t}`),label:String(e?.label||`Adapter ${t+
1}`),kind:String(e?.kind||"unknown"),physicalDefault:e?.physical_default===!0,receiveBps:ye(e?.receive_bps),sendBps:ye(e?.
send_bps),receivePps:ye(e?.receive_pps),sendPps:ye(e?.send_pps),linkSpeedBps:ye(e?.link_speed_bps),utilizationPercent:Gt(
e?.utilization_percent),receiveErrors:ye(e?.receive_errors),sendErrors:ye(e?.send_errors),receiveDiscards:ye(e?.receive_discards),
sendDiscards:ye(e?.send_discards),available:e?.available!==!1}}function fp(e){if(!e||typeof e!="object")return{available:!1,
status:"waiting",schemaVersion:0,source:"",capturedAt:"",capturedAtMs:0,sampleSequence:0,sampleIntervalMs:0,droppedGapCount:0,
machineLabel:"",system:null,processes:[],attributedProcesses:[],sampling:null,privacy:null,capabilities:null,error:null,
lastGoodCapturedAt:"",lastGoodCapturedAtMs:0};let t=e.system&&typeof e.system=="object"?e.system:null,n=t?.cpu&&typeof t.
cpu=="object"?t.cpu:{},s=t?.memory&&typeof t.memory=="object"?t.memory:{},a=t?.disk&&typeof t.disk=="object"?t.disk:{},i=t?.
network&&typeof t.network=="object"?t.network:{},c=t?{cpuPercent:Gt(n.total_percent??t.cpu_percent),cpu:{totalPercent:Gt(
n.total_percent??t.cpu_percent),userPercent:Gt(n.user_percent),privilegedPercent:Gt(n.privileged_percent),idlePercent:Gt(
n.idle_percent),queueLength:ye(n.queue_length),frequencyMhz:ye(n.current_frequency_mhz),logicalCoreCount:Math.max(0,Math.
round(ct(n.logical_core_count))),physicalCoreCount:Math.max(0,Math.round(ct(n.physical_core_count))),perLogical:Array.isArray(
n.per_logical)?n.per_logical:[]},memory:{totalBytes:ye(s.total_bytes),usedBytes:ye(s.used_bytes),availableBytes:ye(s.available_bytes),
usedPercent:Gt(s.used_percent),cacheBytes:ye(s.cache_bytes),commitBytes:ye(s.commit_bytes),commitLimitBytes:ye(s.commit_limit_bytes),
commitPeakBytes:ye(s.commit_peak_bytes),commitPercent:Gt(s.commit_percent),pagedPoolBytes:ye(s.paged_pool_bytes),nonpagedPoolBytes:ye(
s.nonpaged_pool_bytes),pagefileUsedBytes:ye(s.pagefile_used_bytes),pagesPerSec:ye(s.pages_per_sec),faultsPerSec:ye(s.faults_per_sec)},
disk:{readBps:ye(a.read_bps),writeBps:ye(a.write_bps),busyPercent:Gt(a.busy_percent),readIops:ye(a.read_iops),writeIops:ye(
a.write_iops),readLatencyMs:ye(a.read_latency_ms),writeLatencyMs:ye(a.write_latency_ms),transferLatencyMs:ye(a.transfer_latency_ms),
queueLength:ye(a.queue_length)},disks:(Array.isArray(t.disks)?t.disks:[]).map(Oh),network:{receiveBps:ye(i.receive_bps),
sendBps:ye(i.send_bps),receivePps:ye(i.receive_pps),sendPps:ye(i.send_pps),utilizationPercent:Gt(i.utilization_percent),
outputQueueLength:ye(i.output_queue_length),receiveErrors:ye(i.receive_errors),sendErrors:ye(i.send_errors),receiveDiscards:ye(
i.receive_discards),sendDiscards:ye(i.send_discards),tcpRetransmitsPerSec:ye(i.tcp_retransmits_per_sec)},networkAdapters:(Array.
isArray(t.network_adapters)?t.network_adapters:[]).map(Dh),processCount:Math.max(0,Math.round(ct(t.process_count))),threadCount:Math.
max(0,Math.round(ct(t.thread_count))),handleCount:Math.max(0,Math.round(ct(t.handle_count))),uptimeSeconds:ye(t.uptime_seconds)}:
null,u=(Array.isArray(e.processes)?e.processes:[]).map(Ih).sort((k,N)=>Number(N.attributed)-Number(k.attributed)||N.cpuHostPercent-
k.cpuHostPercent||N.memoryBytes-k.memoryBytes||k.pid-N.pid),f=e.captured_at?String(e.captured_at):"",b=e.last_good_captured_at?
String(e.last_good_captured_at):"";return{available:e.status==="fresh"&&!!c,status:String(e.status||"unavailable"),schemaVersion:Math.
max(0,Math.round(ct(e.schema_version))),source:String(e.source||""),capturedAt:f,capturedAtMs:Mo(f),sampleSequence:Math.
max(0,Math.round(ct(e.sample_sequence))),sampleIntervalMs:Math.max(0,Math.round(ct(e.sample_interval_ms))),droppedGapCount:Math.
max(0,Math.round(ct(e.dropped_gap_count))),machineLabel:e.machine_label?String(e.machine_label):"",system:c,processes:u,
attributedProcesses:u.filter(k=>k.attributed),sampling:e.sampling&&typeof e.sampling=="object"?e.sampling:null,privacy:e.
privacy&&typeof e.privacy=="object"?e.privacy:null,capabilities:e.capabilities&&typeof e.capabilities=="object"?e.capabilities:
null,error:e.error&&typeof e.error=="object"?e.error:null,lastGoodCapturedAt:b,lastGoodCapturedAtMs:Mo(b)}}function Sl(e,t=0){
let n=e.filter(Number.isFinite).sort((a,i)=>a-i);if(!n.length)return t;let s=Math.floor(n.length/2);return n.length%2?n[s]:
(n[s-1]+n[s])/2}function Bi(e){let t=Math.max(Number.EPSILON,Number(e)||0),n=10**Math.floor(Math.log10(t)),s=t/n;return(s<=
1?1:s<=2?2:s<=2.5?2.5:s<=5?5:10)*n}function Fi(e){if(!e||typeof e!="object")return null;let t=Number(e.sample_sequence);
if(!Number.isSafeInteger(t)||t<1)return null;let n=e.frame_kind==="system"?e:e.system||{},s=n.cpu||{},a=n.memory||{},i=n.
disk||{},c=n.network||{};return{sampleSequence:t,capturedAt:String(e.captured_at||""),capturedAtMs:Mo(e.captured_at),monotonicMs:ye(
e.monotonic_ms),sampleIntervalMs:ye(e.sample_interval_ms),droppedGapCount:Math.max(0,Math.round(ct(e.dropped_gap_count))),
status:String(e.status||"unavailable"),cpu:{totalPercent:At(s.total_percent??n.cpu_percent),userPercent:At(s.user_percent),
privilegedPercent:At(s.privileged_percent)},memory:{usedPercent:At(a.used_percent),commitPercent:At(a.commit_percent)},disk:{
readBps:At(i.read_bps),writeBps:At(i.write_bps),readIops:At(i.read_iops),writeIops:At(i.write_iops)},network:{receiveBps:At(
c.receive_bps),sendBps:At(c.send_bps),receivePps:At(c.receive_pps),sendPps:At(c.send_pps)}}}function Ir(e,t={}){let n=Array.
isArray(e)?e:[],s=new Map,a=0,i=0,c=0;for(let Q of n){let de=Number(Q?.sample_sequence);!Number.isSafeInteger(de)||de<1||
(de<c&&(i+=1),c=Math.max(c,de),s.has(de)?a+=1:s.set(de,Q))}let f=[...s.values()].sort((Q,de)=>Q.sample_sequence-de.sample_sequence).
map(Q=>({frame:Q,point:Fi(Q)})).filter(Q=>Q.point),b=f.find(Q=>Q.point.capturedAtMs>0&&Q.point.monotonicMs>0)||null,k=f.
map(Q=>{let de=b&&Q.point.monotonicMs>0?b.point.capturedAtMs+Q.point.monotonicMs-b.point.monotonicMs:0;return{...Q,chartTimeMs:de>
0?de:Q.point.capturedAtMs}}),N=[];for(let Q=1;Q<k.length;Q+=1){let de=k[Q].chartTimeMs-k[Q-1].chartTimeMs;de>0&&de<=1e4&&
N.push(de)}let A=k.map(Q=>Q.point.sampleIntervalMs).filter(Q=>Q>0),S=Math.max(1,Math.round(Sl(N,Sl(A,1e3))||1e3)),M=Math.
max(2500,S*2.5),d=[],v=[],g=0,x=0,w=0,E=0,T=0,U=0;for(let Q of k){let de={...Q,chartTimeMs:Q.chartTimeMs+U};if(!(de.chartTimeMs>
0)){g+=1;continue}let pe=d.at(-1),J=!1;if(pe&&de.point.monotonicMs>0&&pe.point.monotonicMs>0&&de.point.monotonicMs<pe.point.
monotonicMs){let te=de.point.capturedAtMs-pe.point.capturedAtMs,$=te>0&&te<=1e4?te:S,H=pe.chartTimeMs+Math.max(1,$);U+=H-
de.chartTimeMs,de.chartTimeMs=H,J=!0,T+=1}if(pe&&de.chartTimeMs<=pe.chartTimeMs){de.chartTimeMs===pe.chartTimeMs?x+=1:w+=
1;continue}let q=de.point.status!=="fresh",G=q?"unavailable":"";if(pe){let te=de.chartTimeMs-pe.chartTimeMs,$=de.point.sampleSequence-
pe.point.sampleSequence,H=de.point.droppedGapCount-pe.point.droppedGapCount;if(($!==1||H>0||te>M)&&(q=!0,G=$!==1||H>0?"d\
ropped":"cadence"),J)E+=1,q=!0,G="clock_discontinuity";else if(de.point.monotonicMs>0&&pe.point.monotonicMs>0&&de.point.
capturedAtMs>0&&pe.point.capturedAtMs>0){let fe=de.point.capturedAtMs-pe.point.capturedAtMs,be=de.point.monotonicMs-pe.point.
monotonicMs;Math.abs(fe-be)>Math.max(5e3,S*2)&&(E+=1,q=!0,G="clock_discontinuity")}q&&v.push({startMs:pe.chartTimeMs,endMs:de.
chartTimeMs,reason:G,previousSequence:pe.point.sampleSequence,nextSequence:de.point.sampleSequence})}d.push({...de,gapBefore:q,
gapReason:G})}let Y=Number.isFinite(Number(t.nowMs))?Number(t.nowMs):Date.now(),re=d.at(-1)||null,ee=re?Math.max(0,Y-re.
chartTimeMs):1/0,ae=Math.max(2500,S*2),W=Math.max(ae*4,1e4),ie="waiting";t.paused?ie="paused":t.connected===!1||t.subscriptionStatus===
"reconnecting"?ie="reconnecting":re?re.point.status!=="fresh"?ie="unavailable":ee>W?ie="stale":ee>ae?ie="delayed":ie="li\
ve":ie=t.error?"unavailable":"waiting",re&&ee>ae&&!t.paused&&v.push({startMs:re.chartTimeMs,endMs:Y,reason:ie,previousSequence:re.
point.sampleSequence,nextSequence:null});let ge=d.length>1?d.at(-1).chartTimeMs-d[0].chartTimeMs:0,X=re&&!t.paused?Math.
max(re.chartTimeMs,Y):re?.chartTimeMs||0,we=d.length?Math.max(0,X-d[0].chartTimeMs):0,ve=d.length?Math.max(1,Math.floor(
we/S)+1):0,Z=d.length?Math.max(0,d.at(-1).point.droppedGapCount-d[0].point.droppedGapCount):0;return{frames:d.map(Q=>({...Q.
frame,chart_time_ms:Q.chartTimeMs,gap_before:Q.gapBefore,gap_reason:Q.gapReason})),points:d.map(Q=>({...Q.point,chartTimeMs:Q.
chartTimeMs,gapBefore:Q.gapBefore,gapReason:Q.gapReason})),gaps:v,status:ie,cadenceMs:S,staleAfterMs:ae,latestAgeMs:ee,nowMs:Y,
startMs:d[0]?.chartTimeMs||0,endMs:d.at(-1)?.chartTimeMs||0,elapsedMs:ge,expectedCount:ve,receivedCount:n.length,validCount:d.
filter(Q=>Q.point.status==="fresh").length,droppedCount:Math.max(Z,Math.max(0,ve-d.length)),gapCount:v.length,duplicateCount:a+
x,outOfOrderCount:i+w,invalidTimestampCount:g,clockDiscontinuityCount:E,monotonicResetCount:T}}function pp(e,t,n){let s=e.
map(a=>({capturedAtMs:a.capturedAtMs,value:t==="cpu"?a.cpu.totalPercent:a.memory.usedPercent})).filter(a=>a.capturedAtMs>
0&&a.value!==null);return s.length<2||s.at(-1).capturedAtMs-s[0].capturedAtMs<15e3?!1:s.every(a=>a.value>=n)}function mp(e,t){
return pp(e,t,95)?"critical":pp(e,t,85)?"warning":"normal"}function gp(e,t={}){let n=ea([],e,60),s=n.map(Fi).filter(Boolean),
a=s.at(-1)||null,i=Number.isFinite(Number(t.nowMs))?Number(t.nowMs):Date.now(),c=t.connected!==!1,u=String(t.subscriptionStatus||
""),f=a?.cpu.totalPercent??null,b=a?.memory.usedPercent??null,k=a?.status==="fresh"&&f!==null&&b!==null,N=a?.capturedAtMs>
0?Math.max(0,i-a.capturedAtMs):1/0,A=Math.max(1e3,a?.sampleIntervalMs||1e3),S=Math.max(2500,A*2),M="waiting";!c||u==="re\
connecting"?M="reconnecting":k?N>S?M="stale":M="live":M=t.error?"unavailable":"waiting";let d=a?.capturedAtMs?a.capturedAtMs-
15e3:1/0,v=s.filter(U=>U.capturedAtMs>=d),g=k?mp(v,"cpu"):"normal",x=k?mp(v,"memory"):"normal",w=M==="live"&&(g==="criti\
cal"||x==="critical")?"critical":M==="live"&&(g==="warning"||x==="warning")?"warning":M,E=n.at(-1)||null,T=E?.frame_kind===
"system"?E:E?.system||null;return{status:M,attention:w,point:a,frames:n,cpuPercent:f,memoryPercent:b,cpuLevel:g,memoryLevel:x,
ageMs:N,ageSeconds:Number.isFinite(N)?Math.max(0,Math.round(N/1e3)):null,staleAfterMs:S,sampleSequence:a?.sampleSequence||
0,capturedAt:a?.capturedAt||"",memoryUsedBytes:At(T?.memory?.used_bytes),memoryTotalBytes:At(T?.memory?.total_bytes)}}function ea(e,t,n=900){
let s=new Map;[...Array.isArray(e)?e:[],...Array.isArray(t)?t:[t]].forEach(i=>{let c=Number(i?.sample_sequence);!Number.
isSafeInteger(c)||c<1||s.has(c)||s.set(c,i)});let a=Math.max(1,Math.min(900,Number(n)||900));return[...s.entries()].sort(
(i,c)=>i[0]-c[0]).slice(-a).map(([,i])=>i)}function Zs(e,t){let n=e?.sampleSequence?e:Fi(e),s=qh[t];return!n||!s?null:At(
s.reduce((a,i)=>a?.[i],n))}function Nl(e,t){let n=(Array.isArray(e)?e:[]).map(x=>({frame:x,point:x?.sampleSequence?x:Fi(
x),value:Zs(x,t),timeMs:Number(x?.chartTimeMs??x?.chart_time_ms)||Mo(x?.capturedAt??x?.captured_at),gapBefore:x?.gapBefore===
!0||x?.gap_before===!0})).filter(x=>x.point&&x.value!==null&&x.timeMs>0).sort((x,w)=>x.timeMs-w.timeMs||x.point.sampleSequence-
w.point.sampleSequence);if(!n.length)return{current:null,min:null,average:null,sampleAverage:null,timeWeightedAverage:null,
averageMethod:"none",max:null,p95:null,provisionalP95:null,p95Ready:!1,peakSequence:null,count:0,elapsedMs:0,cadenceMs:0,
gapCount:0};let s=n.map(x=>x.value),a=[...s].sort((x,w)=>x-w),i=n.reduce((x,w)=>w.value>x.value?w:x,n[0]),c=s.reduce((x,w)=>x+
w,0)/s.length,u=n.slice(1).map((x,w)=>x.timeMs-n[w].timeMs).filter(x=>x>0),f=Math.max(0,Math.round(Sl(u,0))),b=Math.max(
2500,f*2.5),k=0,N=0,A=0;for(let x=1;x<n.length;x+=1){let w=n[x-1],E=n[x],T=E.timeMs-w.timeMs;if(E.gapBefore||T>b){A+=1;continue}
k+=(w.value+E.value)/2*T,N+=T}let S=N>0?k/N:c,M=u.length?Math.min(...u):0,d=u.length?Math.max(...u):0,v=M>0&&d/M>1.2,g=a[Math.
max(0,Math.ceil(a.length*.95)-1)];return{current:s.at(-1),min:Math.min(...s),average:v?S:c,sampleAverage:c,timeWeightedAverage:S,
averageMethod:v?"time-weighted":"sample",max:Math.max(...s),p95:s.length>=20?g:null,provisionalP95:g,p95Ready:s.length>=
20,peakSequence:i.point.sampleSequence,count:s.length,elapsedMs:n.length>1?n.at(-1).timeMs-n[0].timeMs:0,cadenceMs:f,gapCount:A}}function hp(e,t,n=240){let a=Ir(e,{nowMs:Number.MAX_SAFE_INTEGER,paused:!0}).points;if(!a.length)return[];let i=Math.max(
1,Math.round(Number(n)||240)),c=a.length<=i?1:Math.ceil(a.length/i),u=[];for(let f=0;f<a.length;f+=c){let b=a.slice(f,f+
c),k=Nl(b,t);u.push({startSequence:b[0].sampleSequence,endSequence:b.at(-1).sampleSequence,capturedAtStartMs:b[0].chartTimeMs,
capturedAtEndMs:b.at(-1).chartTimeMs,chartTimeMs:b.at(-1).chartTimeMs,current:k.current,min:k.min,average:k.average,max:k.
max,first:Zs(b[0],t),last:Zs(b.at(-1),t),p95:k.p95,provisionalP95:k.provisionalP95,peakSequence:k.peakSequence,count:k.count,
gap:b.some(N=>N.gapBefore)})}return u}function _p(e,t="live",n={}){let s=Number.isFinite(Number(n.nowMs))?Number(n.nowMs):
Date.now(),i=Ir(e,{...n,nowMs:s}).frames,c=qr[t]??qr.live;return!i.length||c===1/0?i:i.filter(u=>Number(u.chart_time_ms)>=
s-c&&Number(u.chart_time_ms)<=s)}function Cl(e,t=0,n={}){if(n.percent)return{maximum:100,minimum:0,step:25,ticks:[0,25,50,
75,100]};let s=Math.max(0,Number(e)||0),a=Math.max(0,Number(t)||0);if(a>0&&s<=a*.95&&s>=a*.65){let b=Bi(a/4),k=Math.max(
2,Math.round(a/b)+1);return{maximum:a,minimum:0,step:b,ticks:Array.from({length:k},(N,A)=>Math.min(a,b*A))}}let i=Math.max(
1,s*1.1),c=Bi(i/4),u=Math.ceil(i/c)*c,f=Math.round(u/c)+1;return f<4&&(c=Bi(i/3),u=Math.ceil(i/c)*c,f=Math.round(u/c)+1),
f>6&&(c=Bi(i/5),u=Math.ceil(i/c)*c,f=Math.round(u/c)+1),{maximum:u,minimum:0,step:c,ticks:Array.from({length:Math.max(2,
f)},(b,k)=>Math.min(u,c*k))}}function bp(e,t,n=5){let s=Number(e),a=Number(t),i=Math.max(2,Math.min(6,Math.round(Number(
n)||5)));return!Number.isFinite(s)||!Number.isFinite(a)||a<=s?[]:Array.from({length:i},(c,u)=>{let f=s+(a-s)*u/(i-1),b=new Date(
f),k=new Date(s).toDateString()!==new Date(a).toDateString();return{timeMs:f,fraction:u/(i-1),label:b.toLocaleString([],
k?{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}:{hour:"2-digit",minute:"2-digit",second:"2-digit"}),accessibleLabel:b.
toLocaleString([],{year:"numeric",month:"long",day:"numeric",hour:"2-digit",minute:"2-digit",second:"2-digit",timeZoneName:"\
short"})}})}function xl(e,t,n){let s=Number(e?.chartTimeMs??e?.chart_time_ms)||Mo(e?.capturedAt??e?.captured_at),a=Number(
t),i=Number(n);return!(s>0)||!Number.isFinite(a)||!Number.isFinite(i)||i<=a?0:Math.max(0,Math.min(1,(s-a)/(i-a)))}function ts(e){let t=ye(e);if(t<1024)return`${Math.round(t)} B`;let n=["KiB","MiB","GiB","TiB"],s=t/1024,a=0;for(;s>=1024&&
a<n.length-1;)s/=1024,a+=1;let i=s>=100?0:s>=10?1:2;return`${s.toFixed(i)} ${n[a]}`}function ns(e){return`${ts(e)}/s`}function vp(e){
return e==null?"\u2014":`${ct(e).toFixed(ct(e)>=10?1:2)}%`}function Al(e,t=Date.now()){let n=Date.parse(e||"");if(!Number.
isFinite(n))return"Waiting for local sample";let s=Math.max(0,Math.round((t-n)/1e3));return s<2?"Updated now":s<60?`Upda\
ted ${s}s ago`:`Updated ${Math.floor(s/60)}m ago`}function Rl(e){let t=typeof e=="number"?e:Date.parse(String(e||""));return Number.
isFinite(t)?new Date(t).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"}):"Unknown time"}function Ml(e){
let t=typeof e=="number"?e:Date.parse(String(e||""));return Number.isFinite(t)?new Date(t).toLocaleString([],{year:"nume\
ric",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit",second:"2-digit",timeZoneName:"short"}):"Unknown date a\
nd time"}var yp=Object.freeze({unavailable:6,auth_required:5,rate_limited:4,stale:3,refreshing:2,fresh:1});function na(e){let t=Number(
e);return Number.isFinite(t)?Math.max(0,t):null}function St(e){let t=Number(e);return Number.isFinite(t)?t:null}function fn(e){
if(!e||typeof e!="object"||e.amount==null||e.amount==="")return null;let t=St(e.amount);return t==null?null:{amount:t,currency:String(
e.currency||"USD"),sourceField:String(e.source_field||""),semantics:String(e.semantics||""),directlyReported:e.directly_reported===
!0}}function jh(e){if(!e||typeof e!="object")return null;let t=e.pool_classification&&typeof e.pool_classification=="obj\
ect"?{status:String(e.pool_classification.classification_status||""),firstParty:fn(e.pool_classification.first_party),thirdParty:fn(
e.pool_classification.third_party),unclassified:fn(e.pool_classification.unclassified),warning:String(e.pool_classification.
warning||"")}:null;return{semanticsVersion:Number(e.semantics_version)||0,source:String(e.source||""),observedAt:String(
e.observed_at||""),accountScope:String(e.account_scope||""),extraUsageEnabled:e.extra_usage_enabled===!0,prepaidBalance:fn(
e.prepaid_balance),extraUsageSpend:fn(e.extra_usage_spend),extraUsageCap:fn(e.extra_usage_cap),reportedSpend:fn(e.reported_spend),
includedSpend:fn(e.included_spend),bonusSpend:fn(e.bonus_spend),planLimit:fn(e.plan_limit),allowanceRemaining:fn(e.allowance_remaining),
reconciliationDelta:fn(e.reconciliation_delta),poolClassification:t,resetsAt:String(e.resets_at||""),disclaimer:String(e.
disclaimer||"")}}function Bh(e){if(!e||typeof e!="object")return null;let t=(Array.isArray(e.request_receipts)?e.request_receipts:
[]).map(n=>({receiptId:String(n?.receipt_id||""),model:String(n?.model||""),surface:String(n?.surface||""),capturedAt:String(
n?.captured_at||""),promptTokens:St(n?.prompt_tokens),responseTokens:St(n?.response_tokens),tokensPerSecond:St(n?.tokens_per_second),
totalDurationNs:St(n?.total_duration_ns),loadDurationNs:St(n?.load_duration_ns),promptEvalDurationNs:St(n?.prompt_eval_duration_ns),
evalDurationNs:St(n?.eval_duration_ns)})).filter(n=>n.receiptId&&n.model&&n.surface);return{status:String(e.status||""),
endpointScope:String(e.endpoint_scope||""),installedModelsCount:Math.max(0,Number(e.installed_models_count)||0),loadedModelsCount:Math.
max(0,Number(e.loaded_models_count)||0),loadedModels:(Array.isArray(e.loaded_models)?e.loaded_models:[]).map(n=>({name:String(
n?.name||"Unnamed local model"),sizeBytes:Math.max(0,Number(n?.size_bytes)||0),sizeVramBytes:Math.max(0,Number(n?.size_vram_bytes)||
0),contextLength:Math.max(0,Number(n?.context_length)||0),expiresAt:String(n?.expires_at||"")})),promptTokens:St(e.prompt_tokens),
responseTokens:St(e.response_tokens),tokensPerSecond:St(e.tokens_per_second),totalDurationNs:St(e.total_duration_ns),loadDurationNs:St(
e.load_duration_ns),promptEvalDurationNs:St(e.prompt_eval_duration_ns),evalDurationNs:St(e.eval_duration_ns),observedRequestCount:Math.
max(0,Number(e.observed_request_count)||0),requestReceipts:t,latestRequest:t.at(-1)||null,telemetryStatus:String(e.telemetry_status||
""),telemetryReason:String(e.telemetry_reason||"")}}function Fh(e){return!e||typeof e!="object"?null:{subscriptionState:[
"active","none","unavailable"].includes(e.subscription_state)?e.subscription_state:"unavailable",source:String(e.source||
""),capturedAt:String(e.captured_at||""),autoReloadEnabled:typeof e.auto_reload_enabled=="boolean"?e.auto_reload_enabled:
null,error:e.error&&typeof e.error=="object"?{code:String(e.error.code||""),message:String(e.error.message||"")}:null,sourceReceipt:e.
source_receipt&&typeof e.source_receipt=="object"?{...e.source_receipt}:null}}function Hh(e){if(!e||typeof e!="object")return null;
let t=["slow","steady","racing","burning"].includes(e.category)?e.category:"",n=na(e.expected_used_percent);if(!t||n==null)
return null;let s=e.budget_percent&&typeof e.budget_percent=="object"?Object.fromEntries(["now","next_hour","next_five_h\
ours","today"].map(a=>[a,na(e.budget_percent[a])??0])):null;return{stage:String(e.stage||""),category:t,expectedUsedPercent:n,
actualUsedPercent:na(e.actual_used_percent),deltaPercent:St(e.delta_percent),projectedUsedPercent:na(e.projected_used_at_reset_percent),
exhaustionAt:e.exhaustion_at?String(e.exhaustion_at):"",willLastToReset:e.will_last_to_reset===!0,budgets:s}}function Uh(e,t){
let n=na(e?.used_percent),s=String(e?.status||(n==null?"unavailable":"available"));if(n==null&&s!=="unavailable")return null;
let a=na(e?.thresholds?.warning_percent)??75,i=Math.max(a,na(e?.thresholds?.critical_percent)??90),c={id:String(e?.id||`\
window-${t+1}`),label:String(e?.label||"Usage"),scope:e?.scope?String(e.scope):"",modelScope:e?.model_scope&&typeof e.model_scope==
"object"?{id:String(e.model_scope.id||""),label:String(e.model_scope.label||"")}:null,usedPercent:n,remainingPercent:St(
e?.remaining_percent)??(n==null?null:100-n),visualPercent:na(e?.visual_percent)??(n==null?null:Math.min(100,n)),durationMinutes:Number.
isFinite(Number(e?.duration_minutes))?Number(e.duration_minutes):null,startsAt:e?.starts_at?String(e.starts_at):"",resetsAt:e?.
resets_at?String(e.resets_at):"",resetDescription:e?.reset_description?String(e.reset_description):"",windowKind:e?.window_kind?
String(e.window_kind):"",source:e?.source?String(e.source):"",provenance:e?.provenance?String(e.provenance):"",freshnessStatus:e?.
freshness_status?String(e.freshness_status):"",status:s,error:e?.error&&typeof e.error=="object"?e.error:null,thresholds:{
warningPercent:a,criticalPercent:i},pace:Hh(e?.pace)};return c.tone=n==null?"unavailable":n>=i||n>=100?"critical":n>=a?"\
warning":"ok",c}function Gh(e){if(e?.status==="auth_required"||e?.status==="unavailable")return"unavailable";if(e?.status===
"rate_limited")return"stale";let t=new Set((e?.windows||[]).map(s=>s.tone)),n=Math.max(-1,...(e?.windows||[]).map(s=>s.usedPercent??
-1));return t.has("critical")?"critical":t.has("warning")?"warning":e?.status==="stale"?"stale":e?.status==="fresh"&&e?.
localRuntime?.status==="running"||n>=0?"ok":"unknown"}function Wh(e,t){let n=(Array.isArray(e?.windows)?e.windows:[]).map(
Uh).filter(Boolean).sort((a,i)=>i.usedPercent-a.usedPercent||a.label.localeCompare(i.label)),s={key:`${e?.provider_id||"\
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
null,financials:jh(e?.financials),localRuntime:Bh(e?.local_runtime),cloudUsage:Fh(e?.cloud_usage),resetCredits:e?.reset_credits&&
typeof e.reset_credits=="object"?e.reset_credits:null,error:e?.error&&typeof e.error=="object"?e.error:null,requestCount:Math.
max(0,Number(e?.request_count)||0),latencyMs:Number.isFinite(Number(e?.latency_ms))?Number(e.latency_ms):null,sessionCount:Math.
max(0,Number(e?.session_count)||0),harnessTypes:Array.isArray(e?.mapped_harness_types)?e.mapped_harness_types.map(String).
sort():[]};return s.tone=Gh(s),s.maximumUsedPercent=n.length>0?Math.max(...n.map(a=>a.usedPercent)):null,s}function Tl(e){
let t=Array.isArray(e?.snapshots)?e.snapshots:[],n=new Map;t.map(Wh).forEach(S=>{let M=n.get(S.key),d=Date.parse(M?.capturedAt||
"")||0,v=Date.parse(S.capturedAt||"")||0;(!M||v>=d)&&n.set(S.key,S)});let s=[...n.values()].sort((S,M)=>(yp[M.status]||0)-
(yp[S.status]||0)||(M.maximumUsedPercent??-1)-(S.maximumUsedPercent??-1)||S.providerName.localeCompare(M.providerName)||
S.accountLabel.localeCompare(M.accountLabel)),a=new Set(s.map(S=>S.providerId)),i=s.filter(S=>S.windows.length>0||S.credits||
S.resetCredits||S.financials||S.localRuntime||S.cloudUsage).length,c=s.filter(S=>["warning","critical"].includes(S.tone)&&
S.maximumUsedPercent<100).length,u=s.filter(S=>S.maximumUsedPercent>=100).length,f=Number(e?.generation)||0,b=e?.in_flight===
!0,k=s.filter(S=>S.status==="fresh").length,N=s.filter(S=>S.status==="stale").length,A=b?"refreshing":f===0&&s.length===
0?"not-started":s.length===0||k===s.length?"ready":k>0?"partial":N>0?"stale":"unavailable";return{schemaVersion:Number(e?.
schema_version)||0,generation:f,generatedAt:e?.generated_at?String(e.generated_at):"",pollIntervalMs:Math.max(0,Number(e?.
poll_interval_ms)||0),cadenceMode:e?.cadence_mode==="watching"?"watching":"idle",inFlight:b,collectionState:A,summaryAuthoritative:f>
0||s.length>0,estimatedCost:zh(e?.estimated_cost),entries:s,summary:{providers:a.size,accounts:s.length,reporting:i,nearLimit:c,
exhausted:u}}}function $l(e,t){if(!t||typeof t!="object")return e;if(!e||typeof e!="object")return t;let n=Math.max(0,Number(
e.generation)||0),s=Math.max(0,Number(t.generation)||0);if(s<n)return e;let a=Array.isArray(e.snapshots)?e.snapshots:[],
i=Array.isArray(t.snapshots)?t.snapshots:[];return s===n&&a.length>0&&i.length===0?t.in_flight===!0&&e.in_flight!==!0?{...e,
in_flight:!0}:e:t}function ta(e){return Array.isArray(e)?e.filter(t=>t&&typeof t=="object").map(t=>({...t})):[]}function To(e){
if(e==null||e==="")return null;let t=Number(e);return Number.isFinite(t)?Math.max(0,t):null}function zh(e){return!e||typeof e!=
"object"?null:{schemaVersion:Number(e.schema_version)||0,catalogVersion:String(e.catalog_version||""),label:String(e.label||
"Local estimated API-equivalent cost"),status:String(e.status||"unavailable"),generatedAt:e.generated_at?String(e.generated_at):
"",range:e.range&&typeof e.range=="object"?e.range:{days:365,since:"",until:""},tokens:{input:To(e.tokens?.input),cached:To(
e.tokens?.cached),output:To(e.tokens?.output)},costUsd:To(e.cost_usd),records:To(e.records),byProvider:ta(e.by_provider),
byModel:ta(e.by_model),byProject:ta(e.by_project),byDay:ta(e.by_day),bySpeed:ta(e.by_speed),dailyBreakdown:ta(e.daily_breakdown),
unknownModels:ta(e.unknown_models),scan:e.scan&&typeof e.scan=="object"?e.scan:{},reasonCode:String(e.reason_code||""),reasonPath:String(
e.reason_path||""),lastGoodGeneratedAt:e.last_good_generated_at?String(e.last_good_generated_at):"",detail:e.detail&&typeof e.
detail=="object"?{totalRows:Math.max(0,Number(e.detail.total_rows)||0),inlineRows:Math.max(0,Number(e.detail.inline_rows)||
0),pageSize:Math.max(0,Number(e.detail.page_size)||0),nextCursor:e.detail.next_cursor==null?"":String(e.detail.next_cursor),
truncated:e.detail.truncated===!0,collections:ta(e.detail.collections)}:null}}function Or(e,t,n,s){e.has(t)||e.set(t,Object.
fromEntries(s.map(i=>[i,n[i]])));let a=e.get(t);a.input=(Number(a.input)||0)+(Number(n.input)||0),a.cached=(Number(a.cached)||
0)+(Number(n.cached)||0),a.output=(Number(a.output)||0)+(Number(n.output)||0),a.cost_usd=(Number(a.cost_usd)||0)+(Number(
n.cost_usd)||0),a.records=(Number(a.records)||0)+(Number(n.records)||0)}function kp(e,t={}){if(!e)return null;let n=Math.
max(1,Math.min(365,Number(t.days)||1)),s=Date.parse(`${e.range?.until||new Date().toISOString().slice(0,10)}T00:00:00.00\
0Z`),a=s-(n-1)*24*60*60*1e3,i=e.dailyBreakdown.filter(b=>{let k=Date.parse(`${b.day}T00:00:00.000Z`);return Number.isFinite(
k)&&k>=a&&k<=s&&(!t.project||b.project===t.project)&&(!t.providerId||b.provider_id===t.providerId)}),c={provider:new Map,
model:new Map,project:new Map,day:new Map,speed:new Map},u={input:0,cached:0,output:0,cost_usd:0,records:0};i.forEach(b=>{
Or(new Map([["total",u]]),"total",b,[]),Or(c.provider,b.provider_id,b,["provider_id"]),Or(c.model,`${b.provider_id}|${b.
model}`,b,["provider_id","model"]),Or(c.project,`${b.provider_id}|${b.project}`,b,["provider_id","project"]),Or(c.day,b.
day,b,["day"]),Or(c.speed,b.speed,b,["speed"])});let f=b=>[...b.values()].map(k=>({...k,cost_usd:Number((k.cost_usd||0).
toFixed(8))}));return{days:n,tokens:{input:u.input,cached:u.cached,output:u.output},costUsd:Number(u.cost_usd.toFixed(8)),
records:u.records,byProvider:f(c.provider),byModel:f(c.model),byProject:f(c.project),byDay:f(c.day),bySpeed:f(c.speed)}}
function Xt(e){let t=Number(e);return Number.isFinite(t)?`${Number.isInteger(t)?t:t.toFixed(2).replace(/0+$/,"").replace(
/\.$/,"")}%`:"Unavailable"}function $o(e){let t=Number(e);return!Number.isFinite(t)||t<0?"Unavailable":t<1e6?`${Math.round(
t/1e3)} us`:t<1e9?`${(t/1e6).toFixed(1).replace(/\.0$/,"")} ms`:`${(t/1e9).toFixed(2).replace(/0+$/,"").replace(/\.$/,"")}\
 s`}function wp(e){let t=Number(e);return!Number.isFinite(t)||t<0?"Unavailable":`${t.toFixed(2).replace(/0+$/,"").replace(
/\.$/,"")} tokens/s`}function Oa(e,t=Date.now()){let n=Date.parse(e||"");if(!Number.isFinite(n))return"Not yet refreshed";
let s=Math.max(0,Math.floor((t-n)/1e3));if(s<10)return"Updated just now";if(s<60)return`Updated ${s}s ago`;let a=Math.floor(
s/60);return a<60?`Updated ${a}m ago`:`Updated ${Math.floor(a/60)}h ${a%60}m ago`}function Da(e,t=Date.now()){let n=Date.
parse(e||"");if(!Number.isFinite(n))return e?String(e):"";let s=Math.max(0,Math.floor((n-t)/1e3)),a=Math.floor(s/60),i=s<
60?`${s}s`:a<60?`${a}m`:`${Math.floor(a/60)}h ${a%60}m`,c=new Date(n).toLocaleString([],{month:"short",day:"numeric",hour:"\
numeric",minute:"2-digit"});return`in ${i} (${c})`}function El(e){if(!e||typeof e!="object")return"";if(e.unlimited===!0)
return"Unlimited credits";let t=e.balance!=null&&e.balance!==""&&Number.isFinite(Number(e.balance));if(e.unit&&t)return`${e.
balance} ${e.unit}`;let n=e.currency==="USD"?"$":e.currency?`${e.currency} `:"";return t?`${n}${Number(e.balance).toFixed(
2)} balance`:""}function Ia(e){return!e||e.amount==null||e.amount===""||!Number.isFinite(Number(e.amount))?"Not reported":
`${e.currency==="USD"?"$":e.currency?`${e.currency} `:""}${Number(e.amount).toFixed(2)}`}function Ll(e){if(!e)return[];let t=[];
return e.prepaidBalance&&t.push({id:"prepaid-balance",label:"Available prepaid balance",value:Ia(e.prepaidBalance)}),e.extraUsageSpend&&
t.push({id:"extra-spend",label:"Extra-usage spend",value:Ia(e.extraUsageSpend)}),e.extraUsageCap&&t.push({id:"extra-cap",
label:"Extra-usage cap",value:Ia(e.extraUsageCap)}),!e.extraUsageEnabled&&(e.extraUsageSpend||e.extraUsageCap)&&t.push({
id:"extra-status",label:"Extra usage",value:"Disabled"}),e.reportedSpend&&t.push({id:"reported-spend",label:"Provider-re\
ported spend",value:Ia(e.reportedSpend)}),e.includedSpend&&t.push({id:"included-spend",label:"Included spend bucket",value:Ia(
e.includedSpend)}),e.bonusSpend&&t.push({id:"bonus-spend",label:"Bonus spend bucket",value:Ia(e.bonusSpend)}),e.planLimit&&
t.push({id:"plan-limit",label:"Reported plan limit",value:Ia(e.planLimit)}),e.reportedSpend&&!e.allowanceRemaining&&t.push(
{id:"allowance-remaining",label:"Available allowance",value:"Not reported by provider"}),e.poolClassification?.status===
"unavailable"&&t.push({id:"pool-classification",label:"First/third-party pools",value:e.poolClassification.warning||"Not\
 reported by provider"}),t}var{useState:$e,useEffect:Pl,useRef:Me,useCallback:It}=React;function Qe(e,t,n,s=(a,i)=>a??i){if(!e||!Object.prototype.hasOwnProperty.call(e,t))return e;let a={...e};return a[n]=s(a[n],
a[t]),delete a[t],a}var Cp=1024*1024,Kh=15e3,xp=3,Vh=new Set(["history_chunk_throttled","history_chunk_duplicate_cursor",
"history_waiter_capacity","history_request_capacity","throttled"]),Yh=15e3,Xh=Object.freeze({queued:1e4,accepted:3e4,launch_accepted:3e4,
delivered:3e4,steered:3e4}),Ap=[250,500,1e3,2e3,3e3],Ui=512,Qh=new Set(["history","history_snapshot","history_chunk","tr\
anscript_resync_required","chat_list"]);function Ns(e,t,n,s=Ui){let a={...e||{}};Object.prototype.hasOwnProperty.call(a,
t)&&delete a[t],a[t]=n;let i=Object.keys(a),c=i.length-Math.max(1,Number(s)||Ui);for(let u=0;u<c;u+=1)delete a[i[u]];return a}
function Jh(e){let n=(e instanceof Map?[...e.values()]:Object.values(e||{})).filter(a=>a&&typeof a=="object"),s=n.filter(
a=>a.aggregateOnly!==!0).length;return{active:n.length>0,aggregateOnly:s===0,consumerCount:n.length,detailConsumerCount:s}}
function ss(e,t){let n=Object.entries(t||{});if(!n.length)return e;let s=!1,a={...e};return n.forEach(([i,c])=>{Object.is(
e[i],c)||Ut(e[i]??null,c??null)||(a[i]=c,s=!0)}),s?a:e}function Zh(e,t,n){return(e==="history_snapshot"||e==="history")&&
!t?.partial&&(!t?.mode||t.mode==="full")?!1:!!(t?.partial||t?.mode==="tail"||n?.mode==="chunked"||n?.partial)}function Gi(e){
return e?e.source_message_id?`source${e.source_message_id}`:e.native_source_id?`native${e.native_source_id}`:e.id!=null?
`id${e.id}`:e.server_message_id!=null?`server${e.server_message_id}`:e.sequence!=null&&e.ts!=null?`seq${e.sequence}${e.
ts}${e.role||""}`:e.client_message_id?`client${e.client_message_id}`:e.client_msg_id?`client${e.client_msg_id}`:"":""}
function e_(e,t){if(!e||!t)return!1;let n=Gi(e),s=Gi(t);return n&&s?n===s:e.role===t.role&&String(e.content||"")===String(
t.content||"")}function Rp(e,t){let n=Array.isArray(e)?e:[],s=(Array.isArray(t)?t:[]).filter(i=>i?._optimistic&&i?._cid);
if(s.length===0)return n;let a=[...n];return s.forEach(i=>{let c=a.findIndex(u=>u?.role==="user"&&(u.client_message_id===
i._cid||u.client_msg_id===i._cid||String(u.content||"")===String(i.content||"")));if(c>=0){let u=a[c]?.status;a[c]={...a[c],
_cid:i._cid,_optimistic:!0,_delivered:i._delivered||a[c]._delivered||u==="delivered"||u==="agent_started",_agentStarted:i.
_agentStarted||a[c]._agentStarted||u==="agent_started",_sendError:u==="failed"?a[c].failure_code||i._sendError||"Send fa\
iled":i._sendError||null}}else a.push(i)}),a}function Mp(e,t){let n=Array.isArray(e)?e:[],s=Array.isArray(t)?t:[];if(!n.
length)return s;if(!s.length)return n;let a=Math.min(n.length,s.length);for(let i=a;i>=1;i--){let c=!0;for(let u=0;u<i;u++)
if(!e_(n[n.length-i+u],s[u])){c=!1;break}if(c)return i===s.length?n:[...n,...s.slice(i)]}return null}function Eo(e){let t=Array.
isArray(e)?e:[],n=s=>{let a=String(s?.content||"");return/\*\*(?:Claude Code|Codex|Cursor) CLI is waiting for a native transcript\.\*\*/i.
test(a)&&/placeholder will be replaced with the real CLI chat history/i.test(a)};return!t.some(n)||!t.some(s=>!n(s))?t:t.
filter(s=>!n(s))}function $p(e,t){let n=e?.agent_type||e?.agentType||"";if(n!=="codex_cli"&&n!=="cursor_cli"||!Array.isArray(
t)||t.length!==1)return!1;let s=t[0];return s?.role!=="assistant"?!1:/\*\*(?:Codex|Cursor) CLI is waiting for a native transcript\.\*\*/.
test(String(s.content||""))}function Tp(e,t={}){let n={},s={},a={};return(e||[]).forEach(i=>{if(!i||typeof i!="object"||
!i.session_id||!i.activity)return;let c=i.activity.kind||"working",u=i.activity.label||(c==="idle"?"":"Working");n[i.session_id]=
{kind:c,label:u,updatedAt:i.activity.updated_at||null,observed_at:i.activity.observed_at||t[i.session_id]?.observed_at||
null,startedAt:i.activity.started_at||null,interruptHint:i.activity.interrupt_hint||"",goal:i.activity.goal||null,goal_run:i.
activity.goal_run||null,thinking:i.activity.thinking||null,current:i.activity.current||null,step:i.activity.step||null,usage:i.
activity.usage||null,task_list:i.activity.task_list||null,context_card:i.activity.context_card||null,thinkingContent:i.activity.
thinking?.text||i.activity.thinkingContent||"",transport:i.activity.transport||t[i.session_id]?.transport||null},s[i.session_id]=
i.activity.thinking?.text||i.activity.thinkingContent||"",a[i.session_id]=["thinking","generating","running_command","ap\
plying_patch","reading_files","working"].includes(c)?u:!1}),{activities:n,thinkingContent:s,thinking:a}}function Ep(){let[
e,t]=$e(()=>$i()),n=e.list,s=It(r=>{t(p=>{let y=typeof r=="function"?r(p.list):r;return Ao(p,y)})},[]),a=_l,i=Yd,[c,u]=$e(
{}),[f,b]=$e({}),[k,N]=$e(!1),[A,S]=$e({state:"connecting",rttMs:null,lastAckAt:null}),[M,d]=$e({}),[v,g]=$e({}),[x,w]=$e(
{}),[E,T]=$e({}),[U,Y]=$e({}),[re,ee]=$e({}),[ae,W]=$e({}),[ie,ge]=$e([]),[X,we]=$e({}),[ve,Z]=$e(null),[Se,Q]=$e({}),[de,
pe]=$e({}),[J,q]=$e({}),[G,te]=$e([]),[$,H]=$e({}),[fe,be]=$e({}),[_e,Ne]=$e({}),[Le,Ae]=$e({}),[He,ce]=$e({}),[je,F]=$e(
{}),[ne,Ce]=$e({}),[Ue,Nt]=$e({}),[Jt,j]=$e({}),[yt,Dt]=$e({}),[hn,On]=$e({}),[Dn,Ga]=$e([]),[Ur,Wa]=$e([]),[oa,os]=$e(null),
[za,Ka]=$e(null),[pc,Gr]=$e(null),[jn,Uo]=$e(null),[Wr,Va]=$e(null),[ia,zr]=$e(null),[ca,_n]=$e(null),[Go,bn]=$e(null),[
Kr,jt]=$e(null),[Wo,xs]=$e([]),[mc,As]=$e([]),[fc,la]=$e({id:"",status:"idle",aggregateOnly:!0,resumed:!1,consumerCount:0,
detailConsumerCount:0}),[gc,Rs]=$e({}),[hc,Vr]=$e([]),[zo,_c]=$e({}),vn=Me({}),is=Me({}),Bt=Me({}),Bn=Me({}),ua=Me({}),nt=Me(
{}),m=Me({}),lt=Me({}),gt=Me(null),Ya=Me(""),Ms=Me([]),da=Me(0),Xa=Me(0),pa=Me(null),Ts=Me(null),yn=Me(null),ot=Me(null),
Yr=Me(0),Qa=Me(1e4),Xr=Me(3e4),cs=Me([]),st=Me(null),Fn=Me(null),Qr=Me(Td()),ma=Me(up()),ls=Me(0),Hn=Me({}),Ko=Me(0),us=Me(
{}),Ge=Me({}),Je=Me({}),fa=Me({}),$s=Me({}),Es=Me(!1),Zt=Me(new Map),Tt=Me(null),ut=Me({}),ht=Me(null),kn=Me(new Map),$t=Me(
new Map),_t=Me({active:!1,aggregateOnly:!0,consumerCount:0,detailConsumerCount:0}),Ze=Me(""),Ja=Me(!0),ga=Me(""),ha=Me(0),
Un=Me({system:"",detail:""}),We=Me({system:0,detail:0}),en=Me({system:0,detail:0});function Jr(r){let p=typeof r?.alias_session_id==
"string"?r.alias_session_id.trim():"",y=typeof r?.canonical_session_id=="string"?r.canonical_session_id.trim():"";if(!p||
!y||p===y)return!1;_c(h=>({...h,[p]:{...r,alias_session_id:p,canonical_session_id:y}})),Vd(p,y),s(h=>{let L=h.find(he=>(typeof he==
"string"?he:he?.session_id)===y),O=h.find(he=>(typeof he=="string"?he:he?.session_id)===p),K=h.filter(he=>{let me=typeof he==
"string"?he:he?.session_id;return me!==p&&me!==y}),V=L&&typeof L=="object"?L:O&&typeof O=="object"?{...O,session_id:y}:{
session_id:y};return K.push({...V,session_id:y,canonical_session_id:y,canonical_conversation_id:r.canonical_conversation_id||
V.canonical_conversation_id||null,canonical_native_id:r.canonical_native_id||V.canonical_native_id||null,current_surface:r.
current_surface||V.current_surface||null,current_surface_label:r.current_surface_label||V.current_surface_label||null}),
K});let P=(h,L)=>h??L,l=(h,L)=>[...Array.isArray(h)?h:[],...Array.isArray(L)?L:[]];u(h=>Qe(h,p,y,P)),b(h=>Qe(h,p,y,P)),d(
h=>Qe(h,p,y,(L,O)=>Number(L||0)+Number(O||0))),g(h=>Qe(h,p,y,P)),w(h=>Qe(h,p,y,P)),T(h=>Qe(h,p,y,P)),Y(h=>Qe(h,p,y,P)),W(
h=>Qe(h,p,y,l)),Q(h=>Qe(h,p,y,P)),pe(h=>Qe(h,p,y,P)),q(h=>Qe(h,p,y,(L,O)=>({...O||{},...L||{},session_id:y,session:y}))),
H(h=>Qe(h,p,y,P)),be(h=>Qe(h,p,y,P)),Ne(h=>Qe(h,p,y,l)),Ae(h=>Qe(h,p,y,l)),ce(h=>Qe(h,p,y,P)),F(h=>Qe(h,p,y,P)),Ce(h=>Qe(
h,p,y,P)),Dt(h=>Qe(h,p,y,P)),Rs(h=>Qe(h,p,y,P)),ge(h=>h.map(L=>L?.session_id===p?{...L,session_id:y}:L)),ua.current=Qe(ua.
current,p,y,P),lt.current=Qe(lt.current,p,y,P),ut.current=Qe(ut.current,p,y,P),st.current===p&&(st.current=y),Ms.current=
[...new Set(Ms.current.map(h=>h===p?y:h))];for(let[h,L]of Object.entries(Bn.current))L===p&&(Bn.current[h]=y);for(let h of[
Hn,us,Je,fa,$s])h.current=Qe(h.current,p,y,P);return!0}function bc(r){return!!zd(r)}function vc(r,p,y=null){if(ut.current=
{...ut.current,[r]:p},kn.current.set(r,{stream:p,streamTrace:y}),ht.current!=null)return;let P=typeof requestAnimationFrame==
"function"?requestAnimationFrame:l=>setTimeout(l,16);ht.current=P(()=>{ht.current=null;let l=[...kn.current.entries()];kn.
current.clear(),l.length&&(Rs(h=>{let L={...h};return l.forEach(([O,K])=>{L[O]=K.stream}),L}),l.forEach(([h,L])=>{L.streamTrace&&
lr({stream_trace:L.streamTrace},h)}))})}function yc(r,p=null){if(!r||ut.current[r]?.open)return;let P=il(r,p);ut.current=
{...ut.current,[r]:P},Rs(l=>({...l,[r]:P}))}function Za(r){if(!r||!ut.current[r])return;let p={...ut.current};delete p[r],
ut.current=p,kn.current.delete(r),Rs(y=>{if(!y[r])return y;let P={...y};return delete P[r],P})}function er(){ut.current=
{},kn.current.clear(),Rs({})}function Zr(){let r=Tt.current;Tt.current=null,r&&(r.kind==="idle"&&typeof cancelIdleCallback==
"function"?cancelIdleCallback(r.id):clearTimeout(r.id))}function ds(){if(Tt.current||Zt.current.size===0)return;let r=()=>{
Tt.current=null;let p=Zt.current.entries().next();if(p.done)return;let[y,P]=p.value;Zt.current.delete(y),Fn.current?.(P),
ds()};typeof requestIdleCallback=="function"?Tt.current={kind:"idle",id:requestIdleCallback(r,{timeout:250})}:Tt.current=
{kind:"timer",id:setTimeout(r,32)}}function ps(){requestAnimationFrame(()=>requestAnimationFrame(()=>{Es.current=!0,ds()}))}
let ke=It(r=>{gt.current?.readyState===WebSocket.OPEN&&gt.current.send(JSON.stringify(r))},[]),eo=It((r=!1,p=null)=>{let y=`\
provider-usage-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return Va({requestId:y,status:"requested",provider_id:p||
null}),ke({type:"provider_usage_refresh",protocol_version:1,force:r===!0,...p?{provider_id:p}:{},request_id:y}),y},[ke]),
tr=It(r=>{ke({type:"provider_usage_watch",protocol_version:1,active:r===!0})},[ke]),ms=It(()=>{let r=`provider-reset-${Date.
now()}-${Math.random().toString(36).slice(2,7)}`;return zr({requestId:r,status:"requested"}),ke({type:"provider_usage_re\
set_credit_consume",protocol_version:1,request_id:r,approved:!0}),r},[ke]),Gn=It((r={})=>{let p=`provider-cost-${Date.now()}\
-${Math.random().toString(36).slice(2,7)}`,y={days:Math.max(1,Math.min(365,Number(r.days)||365)),providerId:r.providerId?
String(r.providerId):"",project:r.project?String(r.project):"",cursor:/^\d+$/.test(String(r.cursor??"0"))?String(r.cursor??
"0"):"0",pageSize:Math.max(1,Math.min(256,Number(r.pageSize)||256))};return _n({requestId:p,status:"loading",query:y,detail:null,
error:null}),ke({type:"provider_usage_cost_detail_request",protocol_version:1,request_id:p,days:y.days,provider_id:y.providerId||
null,project:y.project||null,cursor:y.cursor,page_size:y.pageSize}),p},[ke]),nr=It((r=!1)=>{let p=`host-resource-${Date.
now()}-${Math.random().toString(36).slice(2,7)}`;return jt(null),ke({type:"host_resource_refresh",protocol_version:1,force:r===
!0,aggregate_only:_t.current.aggregateOnly===!0,request_id:p}),p},[ke]),wn=It(()=>{bn(null),jt(null),xs([]),As([]),We.current=
{system:0,detail:0},en.current={system:0,detail:0}},[]),fs=It((r,p="")=>{let y=`host-resource-subscribe-${Date.now()}-${++ha.
current}`;return ga.current=y,jt(null),la(P=>({...P,status:p?"reconnecting":"subscribing",aggregateOnly:r===!0})),ke({type:"\
host_resource_subscribe",protocol_version:1,request_id:y,...p?{resume_subscription_id:p}:{},aggregate_only:r===!0}),y},[
ke]),Ls=It((r,p=0)=>{let y=r==="detail"?"detail":"system",P=Ze.current;if(!P)return null;let l=`host-resource-history-${y}\
-${Date.now()}-${++ha.current}`;return Un.current[y]=l,ke({type:"host_resource_history_request",protocol_version:1,request_id:l,
subscription_id:P,stream:y,after_sequence:Math.max(0,Math.round(Number(p)||0)),max_points:y==="detail"?8:64}),l},[ke]),Wt=It(
()=>{let r=_t.current,p=Jh($t.current);_t.current=p;let y=Ze.current;return p.active?(la(P=>({...P,aggregateOnly:p.aggregateOnly,
consumerCount:p.consumerCount,detailConsumerCount:p.detailConsumerCount})),r.active?(r.aggregateOnly===p.aggregateOnly||
(p.aggregateOnly&&(xs(P=>ea([],P,60)),As([]),bn(null),Un.current.detail="",We.current.detail=0,en.current.detail=0),y&&fs(
p.aggregateOnly,y)),y||null):(wn(),fs(p.aggregateOnly,""),null)):(Ze.current="",ga.current="",Un.current={system:"",detail:""},
Ja.current=!0,y&&ke({type:"host_resource_unsubscribe",protocol_version:1,request_id:`host-resource-unsubscribe-${Date.now()}\
-${++ha.current}`,subscription_id:y}),wn(),la({id:"",status:"idle",aggregateOnly:!0,resumed:!1,consumerCount:0,detailConsumerCount:0}),
null)},[wn,ke,fs]),to=It((r=!1,p="dashboard")=>{let y=String(p||"dashboard").trim().slice(0,64)||"dashboard",P=r===!0;return $t.
current.get(y)?.aggregateOnly===P?Ze.current||null:($t.current.set(y,{aggregateOnly:P}),Wt())},[Wt]),gs=It((r="dashboard")=>{
let p=String(r||"dashboard").trim().slice(0,64)||"dashboard";return $t.current.delete(p)?Wt():Ze.current||null},[Wt]),Vo=It(
r=>{let p=[...new Set((Array.isArray(r)?r:[]).filter(y=>typeof y=="string"&&y.length>0))].sort().slice(0,128);p.length===
Ms.current.length&&p.every((y,P)=>y===Ms.current[P])||(Ms.current=p,gt.current?.readyState===WebSocket.OPEN&&gt.current.
send(JSON.stringify({type:"subscribe",protocol_version:1,request_id:`web-sub-${Date.now()}-${++da.current}`,sessions:p})))},
[]);function hs(){Ts.current&&clearInterval(Ts.current),yn.current&&clearTimeout(yn.current),Ts.current=null,yn.current=
null,ot.current=null}function Ps(r=gt.current){if(!r||r.readyState!==WebSocket.OPEN||ot.current)return;let p=`web-hb-${Date.
now()}-${++Yr.current}`,y=Date.now();ot.current={requestId:p,sentAt:y},r.send(JSON.stringify({type:"heartbeat",protocol_version:1,
request_id:p,client_ts:new Date(y).toISOString()})),yn.current=setTimeout(()=>{if(ot.current?.requestId===p){ot.current=
null,yn.current=null,S({state:"stale",rttMs:null,lastAckAt:null});try{r.close()}catch{}}},Xr.current)}function sr(r,p=gt.
current){hs(),Qa.current=Math.max(1e3,Number(r?.heartbeat_interval_ms)||1e4),Xr.current=Math.max(Qa.current*2,Number(r?.
heartbeat_timeout_ms)||3e4),Ps(p),Ts.current=setInterval(()=>Ps(p),Qa.current)}function _a(r){let p=ot.current;if(!p||p.
requestId!==r.request_id)return;yn.current&&clearTimeout(yn.current),yn.current=null,ot.current=null;let y=Math.max(0,Date.
now()-p.sentAt),P=y<=500?"healthy":y<=2e3?"slow":"poor";S({state:P,rttMs:y,lastAckAt:Date.now()})}function tn(r){let p=is.
current[r];p&&clearTimeout(p),delete is.current[r]}function et(r,p){if(r){if(!Object.prototype.hasOwnProperty.call(Bt.current,
r)&&Object.keys(Bt.current).length>=Ui){let y=Object.keys(Bt.current)[0];tn(y),delete Bn.current[y]}Bt.current=Ns(Bt.current,
r,p),ee(y=>Ns(y,r,p))}}function kt(r,p){!r||!p||(Bn.current=Ns(Bn.current,r,p))}function ba(r,p,y){r&&i(P=>{let l=cp(P,r,
p||Bn.current[r]||"");return l?(kt(r,l),lp(P,r,l,y)):P})}function Wn(r,p,y=""){r&&Bt.current[r]!=="agent_started"&&(tn(r),
et(r,"failed"),ba(r,y,P=>({...P,_sendError:p||"Send failed"})))}function nn(r,p,y){tn(r);let P=Xh[p];P&&(is.current[r]=setTimeout(
()=>{delete is.current[r],Bt.current[r]===p&&Wn(r,y)},P))}Pl(()=>{lt.current=J},[J]),Pl(()=>{ua.current=Se},[Se]);function ar(r,p){
return`${r}:${p}`}function zn(r,p){!Object.prototype.hasOwnProperty.call(nt.current,r)&&Object.keys(nt.current).length>=
Ui&&dt(Object.keys(nt.current)[0]),nt.current=Ns(nt.current,r,p),j(nt.current)}function dt(r){let p=m.current[r];p&&clearTimeout(
p),delete m.current[r]}function zt(r,p){let y=nt.current[r];if(!y||!["pending","awaiting_config"].includes(y.status))return;
dt(r);let l={...lt.current[y.sessionId]||{},[y.configKey]:y.previousValue};lt.current={...lt.current,[y.sessionId]:l},q(
h=>({...h,[y.sessionId]:{...h[y.sessionId]||{},[y.configKey]:y.previousValue}})),zn(r,{...y,status:"failed",error:p||"Co\
ntrol change failed and was rolled back.",completedAt:Date.now()})}function Et(r,p,y,P,l,h){let L=ar(r,p);dt(L);let O=lt.
current[r]||{},K={sessionId:r,field:p,configKey:y,requestId:h,previousValue:O[y],requestedValue:P,status:"pending",error:null,
startedAt:Date.now()},V={...O,[y]:P};return lt.current={...lt.current,[r]:V},q(he=>({...he,[r]:{...he[r]||{},[y]:P}})),zn(
L,K),m.current[L]=setTimeout(()=>zt(L,"Timed out waiting for the agent to confirm this setting."),Yh),ke({...l,session_id:r,
request_id:h}),h}function kc(r,p){Object.entries(nt.current).forEach(([y,P])=>{P.sessionId!==r||!["pending","awaiting_co\
nfig"].includes(P.status)||Object.prototype.hasOwnProperty.call(p,P.configKey)&&p[P.configKey]===P.requestedValue&&(dt(y),
zn(y,{...P,status:"ok",error:null,completedAt:Date.now()}))})}let va=It(()=>{Zr(),Es.current=!1,Zt.current.clear();let r=location.
protocol==="https:"?"wss":"ws",p=new WebSocket(`${r}://${location.host}/client-ws`);gt.current=p,p.onopen=()=>{Xa.current=
0,N(!0),S({state:"connecting",rttMs:null,lastAckAt:null}),p.send(JSON.stringify({type:"subscribe",protocol_version:1,request_id:`\
web-sub-${Date.now()}-${++da.current}`,sessions:Ms.current})),_t.current.active&&fs(_t.current.aggregateOnly,Ze.current)},
p.onclose=()=>{if(hs(),Object.entries(nt.current).forEach(([l,h])=>{["pending","awaiting_config"].includes(h?.status)&&zt(
l,"Connection changed before the native setting was confirmed. Retry after reconnecting.")}),Object.values(Ge.current).forEach(
l=>clearTimeout(l)),Ge.current={},Object.keys(Je.current).forEach(l=>{Je.current[l]={...Je.current[l]||{},inFlight:!1}}),
b({}),er(),N(!1),S({state:"offline",rttMs:null,lastAckAt:null}),_t.current.active&&la(l=>({...l,status:"reconnecting"})),
gt.current!==p)return;let y=Xa.current++,P=Ap[Math.min(y,Ap.length-1)];pa.current=setTimeout(()=>{pa.current=null,va()},
P)},p.onmessage=y=>{let P;try{P=JSON.parse(y.data)}catch{return}P.stream_trace&&typeof P.stream_trace=="object"&&(P.stream_trace=
{...P.stream_trace,browser_received_at_ms:Date.now()}),Fn.current(P)}},[ke,fs]);Pl(()=>(va(),()=>{pa.current&&clearTimeout(
pa.current),hs(),Object.values(is.current).forEach(p=>clearTimeout(p)),is.current={},Object.values(m.current).forEach(p=>clearTimeout(
p)),m.current={},Zr(),ht.current!=null&&(typeof cancelAnimationFrame=="function"?cancelAnimationFrame(ht.current):clearTimeout(
ht.current),ht.current=null),kn.current.clear();let r=gt.current;gt.current=null;try{r?.close()}catch{}}),[va]);function Kt(r){
let p=Tp(r);T(y=>ss(y,Tp(r,y).activities)),w(y=>ss(y,p.thinkingContent)),g(y=>ss(y,p.thinking))}function sn(r){let p=new Set(
(r||[]).map(l=>l&&typeof l=="object"?l.session_id:l).filter(Boolean)),y=l=>{let h=!1,L={...l};return Object.keys(L).forEach(
O=>{p.has(O)||(delete L[O],h=!0)}),h?L:l};Object.keys(vn.current).forEach(l=>{p.has(l)||(clearTimeout(vn.current[l]),delete vn.
current[l])}),[Hn,us,Je,fa,$s].forEach(l=>{Object.keys(l.current).forEach(h=>{p.has(h)||delete l.current[h]})}),Object.keys(
ut.current).forEach(l=>{p.has(l)||delete ut.current[l]});for(let l of kn.current.keys())p.has(l)||kn.current.delete(l);Object.
keys(Ge.current).forEach(l=>{p.has(l)||(clearTimeout(Ge.current[l]),delete Ge.current[l])});let P=!1;Object.entries(nt.current).
forEach(([l,h])=>{p.has(h?.sessionId)||(dt(l),delete nt.current[l],P=!0)}),P&&j({...nt.current}),T(y),w(y),g(y),u(y),b(y),
d(y),Y(y),W(y),Q(y),pe(y),q(y),H(y),be(y),Ne(y),Ae(y),ce(y),F(y),Ce(y),Dt(y),Rs(y),On(l=>{let h=!1,L={...l};return Object.
keys(L).forEach(O=>{let K=O.indexOf(":"),V=K>=0?O.slice(0,K):O;p.has(V)||(delete L[O],h=!0)}),h?L:l})}function Sn(r){let p={};
(r||[]).forEach(y=>{!y||typeof y!="object"||!y.session_id||typeof y.auto_approve_permissions=="boolean"&&(p[y.session_id]=
{auto_approve_permissions:y.auto_approve_permissions})}),Object.keys(p).length>0&&q(y=>{let P=!1,l={...y};return Object.
entries(p).forEach(([h,L])=>{let O={...l[h]||{},...L};Ut(l[h]||{},O)||(l[h]=O,P=!0)}),P?l:y})}function _s(r){let p={};(r||
[]).forEach(y=>{!y||typeof y!="object"||!y.session_id||Array.isArray(y.chat_list)&&(p[y.session_id]=y.chat_list)}),H(y=>ss(
y,p))}function an(r){let p={};(r||[]).forEach(y=>{!y||typeof y!="object"||!y.session_id||y.status&&(p[y.session_id]=y.status)}),
Y(y=>ss(y,p))}function no(r,p={}){let y=typeof r=="string"?r:r?.session_id;if(!y||gt.current?.readyState!==WebSocket.OPEN)
return;let P=`hist-${Date.now()}-${++ls.current}`;Hn.current[y]=P;let l=Math.max(0,Math.floor(Number(p.afterSequence??p.
after_sequence)||0)),h=l>0?"delta":p.full?"full":"tail";b(K=>({...K,[y]:{mode:h,requestedAt:Date.now(),requestId:P}}));let L={
type:l>0?"history_request":"get_history",session:y,session_id:y,request_id:P};l>0&&(L.after_sequence=l);let O=Number(p.limit||
p.tailLimit||0);l<=0&&Number.isFinite(O)&&O>0&&!p.full&&(L.limit=Math.floor(O),L.tail=!0),p.full&&(L.full=!0),ke(L)}function qs(r,p={}){
let y=typeof r=="string"?r:r?.session_id;if(!y||gt.current?.readyState!==WebSocket.OPEN)return;let P=p.mode==="older"?"o\
lder":p.mode==="around"?"around":"tail",l=p.source||"relay_sqlite",h=P==="around"||P==="tail"&&p.replace!==!1,L=p.beforeOffset??
p.before_offset??null,O=p.beforeId??p.before_id??null,K=p.aroundId??p.around_id??null,V=`${P}${l}${L??""}${O??""}${K??
""}`,he=Je.current[y]||{},me=Date.now();if(he.inFlight&&P!=="around"||P==="older"&&he.lastRequestSig===V&&me-Number(he.lastRequestAt||
0)<1500)return;let xe=`histchunk-${Date.now()}-${++Ko.current}`,Be=Math.max(256*1024,Math.min(16*1024*1024,Number(p.chunkBytes||
p.chunk_bytes||Cp)||Cp));if(P!=="older"){let Re=Number(p.retryAttempt||0)>0?he.baselineMessageKeys:null,Ie=Array.isArray(
Re)?Re:(a[y]||[]).map(Lt).filter(Boolean);clearTimeout(Ge.current[y]),Je.current[y]={source:l,chunkBytes:Be,limit:p.limit||
null,inFlight:!0,mode:P,replace:h,baselineMessageKeys:Ie,beforeOffset:L,beforeId:O,aroundId:K,userInitiated:p.userInitiated===
!0||p.user_initiated===!0,retryAttempt:Number(p.retryAttempt||0),lastRequestSig:V,lastRequestAt:me}}else Je.current[y]={
...Je.current[y]||{},source:l,chunkBytes:Be,limit:p.limit||Je.current[y]?.limit||null,inFlight:!0,mode:P,beforeOffset:L,
beforeId:O,aroundId:K,userInitiated:p.userInitiated===!0||p.user_initiated===!0,retryAttempt:Number(p.retryAttempt||0),lastRequestSig:V,
lastRequestAt:me};us.current[y]=xe,u(Re=>{if(!Re[y]?.error)return Re;let Ie={...Re[y]};return delete Ie.error,{...Re,[y]:Ie}}),
b(Re=>({...Re,[y]:{mode:P,kind:"chunked",requestedAt:Date.now(),requestId:xe}}));let Xe={type:"history_chunk_request",session:y,
session_id:y,request_id:xe,mode:P,source:l,replace:h,chunk_bytes:Be},bt=Number(p.limit||p.tailLimit||0);Number.isFinite(
bt)&&bt>0&&(Xe.limit=Math.floor(bt)),(p.userInitiated||p.user_initiated)&&(Xe.user_initiated=!0),P==="older"&&L!=null&&(Xe.
before_offset=L),P==="older"&&O!=null&&(Xe.before_id=O),P==="around"&&K!=null&&(Xe.around_id=K),ke(Xe),Ge.current[y]=setTimeout(
()=>{if(delete Ge.current[y],us.current[y]!==xe)return;let Re=Je.current[y]||{};if(!Re.inFlight)return;if(Je.current[y]=
{...Re,inFlight:!1},st.current!==y){b(ze=>{if(ze[y]?.requestId!==xe)return ze;let Ht={...ze};return delete Ht[y],Ht});return}
let Ie=Number(p.retryAttempt||0);if(Ie<xp&&st.current===y&&gt.current?.readyState===WebSocket.OPEN){qs(y,{...p,mode:P,source:l,
beforeOffset:L,beforeId:O,chunkBytes:Be,retryAttempt:Ie+1});return}b(ze=>{if(ze[y]?.requestId!==xe)return ze;let Ht={...ze};
return delete Ht[y],Ht}),u(ze=>({...ze,[y]:{...ze[y]||{},error:"Transcript history request timed out. Retry to load the \
latest messages."}}))},Kh)}function Lt(r){if(!r)return"";if(r.source_message_id)return`source${r.source_message_id}`;if(r.
native_source_id)return`native${r.native_source_id}`;if(r.id!=null)return`id${r.id}`;if(r.server_message_id!=null)return`\
server${r.server_message_id}`;if(r.sequence!=null&&r.ts!=null)return`seq${r.sequence}${r.ts}${r.role||""}`;if(r.client_msg_id)
return`client${r.client_msg_id}`;let p=Array.isArray(r.content_blocks)?JSON.stringify(r.content_blocks):"";return`${r.role||
""}${r.content||""}${p}`}function bs(r,p,y){let P=Array.isArray(r)?r:[],l=Array.isArray(p)?p:[];if(y==="older"){let V=new Set(
P.map(Lt)),he=[];return l.forEach(me=>{let xe=Lt(me);V.has(xe)||(V.add(xe),he.push(me))}),he.length?[...he,...P]:P}let h=Mp(
P,l);if(h)return h;let L=new Set(P.map(Lt)),O=[...P],K=0;return l.forEach(V=>{let he=Lt(V);L.has(he)||(L.add(he),O.push(
V),K++)}),K?O:P}function Yo(r,p){let y=Array.isArray(r)?r:[],P=Array.isArray(p)?p:[];if(!y.length)return P;if(!P.length)
return y;let l=Mp(y,P);if(l)return l;let h=new Set(y.map(Lt)),L=[...y],O=0;return P.forEach(K=>{let V=Lt(K);h.has(V)||(h.
add(V),L.push(K),O++)}),O?L:y}function so(r,p,y,P){let l=Array.isArray(r)?r:[],h=Array.isArray(p)?p:[],L=new Map(l.map(xe=>[
Lt(xe),xe])),O=h.map(xe=>{let Be=L.get(Lt(xe));return Be&&Ut(Be,xe)?Be:xe}),K=O.length===l.length&&O.every((xe,Be)=>xe===
l[Be])?l:O,V=new Set(Array.isArray(y?.baselineMessageKeys)?y.baselineMessageKeys:[]);if((y?.source==="native"||P==="code\
x_cli_jsonl"||P==="cursor_cli_jsonl")&&V.size>K.length)return l;let me=l.filter(xe=>{let Be=Lt(xe);return Be&&!V.has(Be)});
return me.length===0?K:bs(K,me,"tail")}function ya(r){return!r||typeof r!="object"?!1:["codex","codex-desktop","cursor",
"codex_cli","cursor_cli","roo_code","cline"].includes(r.agent_type)}function Is(r){r&&(i(p=>({...p,[r]:[]})),W(p=>({...p,
[r]:[]})),g(p=>({...p,[r]:!1})),w(p=>({...p,[r]:""})),T(p=>({...p,[r]:!1})),u(p=>({...p,[r]:null})),b(p=>{if(!p[r])return p;
let y={...p};return delete y[r],y}))}function rr(r,p,y,P={}){let l=`prompt-${Date.now()}-${Math.random().toString(36).slice(
2,7)}`,h=typeof P.instruction=="string"?P.instruction.trim():"",L=ua.current[r],O=L?.type==="question_prompt",K=P.action===
"cancel"?"cancel":"answer",V=y||(K==="cancel"?"question_cancel":Array.isArray(P.answers)?"question_answers":h?"alternate\
_instruction":null);Q(he=>he[r]?{...he,[r]:{...he[r],submitting_choice_id:V,request_id:l,error:null}}:he),ke(O?{type:"qu\
estion_response",session_id:r,prompt_id:p,generation:L.generation,action:K,...K==="answer"?{answers:P.answers||[]}:{},request_id:l}:
{type:"permission_response",session_id:r,prompt_id:p,...y?{choice_id:y}:{},...Array.isArray(P.answers)?{answers:P.answers}:
{},...h?{instruction:h}:{},request_id:l})}function Os(r,p,y,P){let l=`errprompt-${Date.now()}-${Math.random().toString(36).
slice(2,7)}`;pe(h=>h[r]?{...h,[r]:{...h[r],submitting_action_id:y,request_id:l,error:null}}:h),ke({type:"error_prompt_ac\
tion",session_id:r,prompt_id:p,action_id:y,request_id:l,...y==="open_native_window"?{operator_user_gesture:P?.isTrusted===
!0}:{}})}function Kn(r,p={}){let y=`interrupt-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return ke({type:"a\
gent_interrupt",session_id:r,request_id:y,connection_id:Ya.current,session_generation:Math.max(0,Number(p.sessionGeneration)||
0),turn_generation:Math.max(0,Number(p.turnGeneration)||0)}),y}function Ds(r,p,y,P={}){let l=String(P.requestId||"").trim()||
`goal-${p}-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return ke({type:"agent_goal_control",session_id:r,request_id:l,
action:p,connection_id:Ya.current,session_generation:Math.max(0,Number(P.sessionGeneration)||0),goal_generation:Math.max(
0,Number(y?.generation)||0),goal_transition_seq:Math.max(0,Number(y?.transition_seq)||0),goal_fingerprint:String(y?.fingerprint||
"")}),l}function Nn(r){let p=`cfg-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;ke({type:"agent_config_request",
session_id:r,request_id:p})}function js(r,p){let y=`model-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,l=(lt.
current[r]||{}).config_semantics==="observed_and_next_send"?"next_send_model_id":"model_id";return Et(r,"model",l,p,{type:"\
agent_set_model",model_id:p},y)}function Cn(r,p){let y=`effort-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,l=(lt.
current[r]||{}).config_semantics==="observed_and_next_send"?"next_send_effort":"effort";return Et(r,"effort",l,p,{type:"\
agent_set_effort",effort:p},y)}function vs(r,p){let y=`perm-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return Et(
r,"permission_mode","permission_mode",p,{type:"agent_set_permission_mode",mode:p},y)}function xn(r,p){let y=`autoperm-${Date.
now()}-${Math.random().toString(36).slice(2,7)}`;return Et(r,"auto_approve_permissions","auto_approve_permissions",!!p,{
type:"agent_set_auto_approve_permissions",enabled:!!p},y)}function Bs(r,p){let y=`mode-${Date.now()}-${Math.random().toString(
36).slice(2,7)}`,P=Object.prototype.hasOwnProperty.call(lt.current[r]||{},"conversation_mode")?"conversation_mode":"mode";
return Et(r,"mode",P,p,{type:"agent_set_mode",mode:p},y)}function rn(r,{model_id:p,effort:y,speed:P,access_mode:l,permission_profile:h,
confirm_bypass:L,workspace_mode:O}){let K=`codex-cfg-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,V=lt.current[r]||
{},he=[["model","model_id",p],["effort","effort",y],["speed","speed",P],["access_mode","permission_mode",l],["workspace_\
mode","workspace_mode",O],["permission_profile","permission_profile",h]],[me,xe,Be]=he.find(([,,Xe])=>Xe!=null)||["codex\
_config","model_id",p];return Et(r,me,xe,Be,{type:"set_codex_config",model_id:p,effort:y,speed:P,access_mode:l,permission_profile:h,
confirm_bypass:L,workspace_mode:O,source_revision:V.source_revision},K)}function Fs(r){let p=`new-thread-${Date.now()}-${Math.
random().toString(36).slice(2,7)}`;return Is(r),ke({type:"new_thread",session_id:r,request_id:p}),p}function Vn(r){let p=`\
panel-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return ke({type:"open_panel",session_id:r,request_id:p}),p}
function at(r,p){let y=`native-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return ke({type:"open_native_wind\
ow",session_id:r,request_id:y,operator_user_gesture:p?.isTrusted===!0}),y}function or(r){let p=`chatlist-${Date.now()}-${Math.
random().toString(36).slice(2,7)}`;return ke({type:"chat_list",session_id:r,request_id:p}),p}function on(r,p){let y=`swi\
tch-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return ke({type:"switch_chat",session_id:r,chat_id:p,request_id:y}),
y}function Xo(r){let p=`newchat-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return ke({type:"new_chat",session_id:r,
request_id:p}),p}function Qo(r){let p=`threads-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return ke({type:"\
thread_list",session_id:r,request_id:p}),p}function Jo(r,p){let y=`swthread-${Date.now()}-${Math.random().toString(36).slice(
2,7)}`;return Is(r),ke({type:"switch_thread",session_id:r,thread_id:p,request_id:y}),y}function ao(r){let p=`term-${Date.
now()}-${Math.random().toString(36).slice(2,7)}`;return ke({type:"terminal_output",session_id:r,request_id:p}),p}function ka(r,p){
let y=`termin-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return ke({type:"terminal_input",session_id:r,request_id:y,
text:p}),y}function wa(r){let p=`diff-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return ke({type:"file_chan\
ges",session_id:r,request_id:p}),p}function ro(r,p,y){let P=`filechg-${Date.now()}-${Math.random().toString(36).slice(2,
7)}`;return ke({type:"file_change_response",session_id:r,change_id:p,action:y,request_id:P}),P}function Zo(r,p){let y=`d\
ir-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return ke({type:"list_directory",session_id:r,request_id:y,path:p||
"."}),y}function wc(r,p){let y=`file-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return ke({type:"read_file",
session_id:r,request_id:y,path:p}),y}function ei(r){let p=`skills-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
return ke({type:"skill_list",session_id:r,request_id:p}),p}function oo(r){let p=`automation-${Date.now()}-${Math.random().
toString(36).slice(2,7)}`;return ke({type:"automation_view_action",session_id:r,request_id:p}),p}function ir(r,p,y,P){let l=`\
attach-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return ke({type:"send_attachment",session_id:r,request_id:l,
data:p,mime_type:y,filename:P}),l}function Sc(r,p){let y=`swws-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return Et(
r,"workspace","file_access_scope",p,{type:"switch_workspace",folder_path:p},y)}function Ft(r){let p=`branches-${Date.now()}\
-${Math.random().toString(36).slice(2,7)}`;return ke({type:"branch_list",session_id:r,request_id:p}),p}function Nc(r,p){
let y=`swbranch-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return ke({type:"switch_branch",session_id:r,branch_name:p,
request_id:y}),y}function An(r,p){let y=`newbranch-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return ke({type:"\
create_branch",session_id:r,branch_name:p,request_id:y}),y}function Cc(r,p,y={}){let P=`launch-${Date.now()}-${Math.random().
toString(36).slice(2,7)}`;return we(l=>Ns(l,P,{status:"launching",agentType:r})),ke({type:"launch_session",agent_type:r,
workspace_path:p||void 0,model_id:y.model_id||void 0,permission_mode:y.permission_mode||void 0,effort:y.effort||void 0,request_id:P}),
P}function Hs(r,p,y,P={}){let l=`resume-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return we(h=>Ns(h,l,{status:"\
launching",agentType:p})),ke({type:"resume_session",source_session:r,agent_type:p||"claude",workspace_path:y||void 0,cli_session_id:P.
cli_session_id||void 0,model_id:P.model_id||void 0,permission_mode:P.permission_mode||void 0,request_id:l}),l}function ti(r,p){
ke(p?{type:"dismiss_session",session:r}:{type:"close_session",session:r})}function xc(r,p,y=""){let P=y||`cmsg-${Date.now()}\
-${Math.random().toString(36).slice(2,8)}`;kt(P,r);let l=y?(_l[r]||[]).find(L=>L._cid===P):null,h=$r(l)?.iso||new Date().
toISOString();return i(L=>{let O=L[r]||[],K=y&&O.some(V=>V._cid===P);return{...L,[r]:K?O.map(V=>V._cid===P?{...V,content:p,
_optimistic:!0,_delivered:!1,_agentStarted:!1,_sendError:null}:V):[...O,Er({role:"user",content:p,_cid:P,_optimistic:!0,
created_at:h})]}}),gt.current?.readyState===WebSocket.OPEN?(et(P,"queued"),nn(P,"queued","Timed out waiting for relay ac\
ceptance."),ke({type:"send",session:r,content:p,client_message_id:P,created_at:h})):cs.current.length<20?(cs.current=[...cs.
current.filter(L=>L.cid!==P),{session:r,content:p,cid:P,created_at:h}],tn(P),et(P,"offline_queued")):(et(P,"queued"),Wn(
P,"Offline send queue is full. Reconnect or retry after another message sends.")),P}function ni(){let r=gt.current;if(!r||
r.readyState!==WebSocket.OPEN||cs.current.length===0)return;let p=cs.current;cs.current=[],p.forEach(y=>{kt(y.cid,y.session),
et(y.cid,"queued"),nn(y.cid,"queued","Timed out waiting for relay acceptance after reconnect."),r.send(JSON.stringify({type:"\
send",session:y.session,content:y.content,client_message_id:y.cid,created_at:y.created_at}))})}function si(r,p,y,P){let l={
type:"steer",session_id:r,client_message_id:p,content:y};P!=null&&(l.native_index=P),ke(l),p&&p.startsWith("native-")&&W(
h=>({...h,[r]:(h[r]||[]).filter(L=>L.cid!==p)}))}function ai(r,p){tn(p),delete Bt.current[p],delete Bn.current[p],ke({type:"\
discard_queued",session_id:r,client_message_id:p}),W(y=>({...y,[r]:(y[r]||[]).filter(P=>P.cid!==p)})),ee(y=>{let P={...y};
return delete P[p],P}),i(y=>{let P=y[r]||[];return{...y,[r]:P.filter(l=>l._cid!==p)}})}function ri(r,p,y){W(P=>({...P,[r]:(P[r]||
[]).map(l=>l.cid===p?{...l,content:y,content_blocks:(l.content_blocks||[]).map(h=>h?.type==="queued_message"?{...h,content:y}:
h)}:l)})),i(P=>{let l=P[r]||[];return{...P,[r]:l.map(h=>h._cid===p?{...h,content:y}:h)}}),ke({type:"edit_queued",session_id:r,
client_message_id:p,content:y})}function cr(r){r?.id&&ge(p=>{let y=p.filter(P=>P.id!==r.id);return["completed","cancelle\
d"].includes(r.state)?y:[r,...y]})}async function io(){let r=await fetch("/api/scheduled-sends",{credentials:"same-origi\
n"});if(!r.ok)throw new Error(`Could not load scheduled sends (${r.status})`);let p=await r.json();return ge((p.scheduled_sends||
[]).filter(y=>!["completed","cancelled"].includes(y.state))),p.scheduled_sends||[]}async function Sa(r,p,y,P=null){let l=await fetch(
"/api/scheduled-sends",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify(
{session_id:r,content:p,trigger_kind:y,...y==="at"?{deliver_at:P}:{}})}),h=await l.json().catch(()=>({}));if(!l.ok)throw new Error(
h.error||`Could not schedule message (${l.status})`);return cr(h.scheduled_send),h.scheduled_send}async function Rn(r){let p=await fetch(
`/api/scheduled-sends/${encodeURIComponent(r)}`,{method:"DELETE",credentials:"same-origin"}),y=await p.json().catch(()=>({}));
if(!p.ok)throw new Error(y.error||`Could not cancel scheduled message (${p.status})`);return cr(y.scheduled_send),y.scheduled_send}
function lr(r,p){if(!r?.stream_trace||typeof window>"u")return;let y={...r.stream_trace,session_id:p||r.session||r.session_id||
""},P=window.requestAnimationFrame||(l=>window.setTimeout(l,16));P(()=>P(()=>{let l=Array.isArray(window.__RAC_STREAM_TRACES__)?
window.__RAC_STREAM_TRACES__:[];l.push({...y,browser_paint_at_ms:Date.now()}),l.length>500&&l.splice(0,l.length-500),window.
__RAC_STREAM_TRACES__=l}))}function Na(r){let p=r.type;if(!ma.current.accept(r)||p==="navigation_started")return;if(p===
"connection_ack"&&(Qr.current.reset(r.state_epoch),Ya.current=String(r.connection_id||""),Array.isArray(r.session_aliases)&&
r.session_aliases.forEach(Jr)),p==="session_alias_reconciled"){Jr(r);return}let y=r.session||r.session_id||"",P=p==="ses\
sion_list"||p==="session_snapshot"||p==="proxy_session_snapshot"?"session_list":(p==="status"||p==="proxy_status"||p==="\
session_status"||p==="session_summary"||p==="session_patch")&&y?`status:${y}`:"";if(!(P&&!Qr.current.accept(r,P))){if(p===
"heartbeat_ack"){_a(r);return}if(p==="provider_usage_snapshot"){r.snapshot&&typeof r.snapshot=="object"&&Uo(l=>$l(l,r.snapshot));
return}if(p==="provider_usage_threshold"){let l=new Set(Array.isArray(r.affected_session_ids)?r.affected_session_ids.map(
String):[]);l.size>0&&s(h=>h.map(L=>{let O=typeof L=="string"?L:L?.session_id;return l.has(O)?{...typeof L=="object"?L:{},
session_id:O,percent_used:Number.isFinite(Number(r.percent_used))?Number(r.percent_used):null,rate_limit_active:r.hard_limited===
!0,rate_limited_until:r.reset_hint||"unknown",usage_limit_provider:r.provider_id||null,usage_limit_window:r.window_label||
r.window_id||null}:L}));return}if(p==="provider_usage_refresh_receipt"){Va(l=>!l||!r.request_id||l.requestId===r.request_id?
{requestId:r.request_id||l?.requestId||"",status:r.status||"error",...r}:l);return}if(p==="provider_usage_reset_credit_r\
eceipt"){zr(l=>l?.requestId&&r.request_id!==l.requestId?l:{requestId:r.request_id,status:r.status||"error",outcome:r.outcome||
null,availableCount:r.reset_credits_available,error:r.code||null});return}if(p==="provider_usage_cost_detail"){_n(l=>l?.
requestId===r.request_id?{...l,status:"ready",detail:r.detail,error:null}:l);return}if(p==="provider_usage_cost_detail_e\
rror"){_n(l=>l?.requestId===r.request_id?{...l,status:"error",error:r.code||"cost_detail_failed"}:l);return}if(p==="host\
_resource_snapshot"){r.snapshot&&typeof r.snapshot=="object"&&(bn(r.snapshot),jt(null));return}if(p==="host_resource_sub\
scription_ack"){if(!_t.current.active||r.request_id!==ga.current||typeof r.subscription_id!="string")return;let l=Ze.current,
h=r.subscription_id,L=r.resumed===!0&&l===h,O=r.aggregate_only===!0,K=l===h&&Ja.current!==O;Ze.current=h,Ja.current=O,ga.
current="",L?K&&O&&(xs(V=>ea([],V,60)),As([]),bn(null),Un.current.detail="",We.current.detail=0,en.current.detail=0):(xs(
[]),As([]),bn(null),We.current={system:0,detail:0},en.current={system:0,detail:0}),la({id:h,status:"live",aggregateOnly:O,
resumed:L,consumerCount:_t.current.consumerCount,detailConsumerCount:_t.current.detailConsumerCount}),Ls("system",L?We.current.
system:0),O||Ls("detail",L?We.current.detail:0),_t.current.aggregateOnly!==O&&fs(_t.current.aggregateOnly,h);return}if(p===
"host_resource_history_chunk"){let l=r.chunk,h=l?.stream==="detail"?"detail":l?.stream==="system"?"system":"";if(!h||r.subscription_id!==
Ze.current||r.request_id!==Un.current[h])return;let L=Array.isArray(l.points)?l.points:[];if(h==="system"){let K=_t.current.
aggregateOnly?60:900;xs(V=>ea(V,L,K))}else{if(_t.current.aggregateOnly)return;As(V=>ea(V,L,180));let K=L.filter(V=>V&&typeof V==
"object").sort((V,he)=>Number(V.sample_sequence||0)-Number(he.sample_sequence||0)).at(-1);K&&bn(K)}let O=Math.max(We.current[h],
Math.round(Number(l.next_sequence)||0));We.current[h]=O,Un.current[h]="",l.done!==!0&&Ls(h,O);return}if(p==="host_resour\
ce_live"){let l=r.point,h=Number(l?.sample_sequence);if(r.subscription_id!==Ze.current||!Number.isSafeInteger(h)||h<=en.
current.system)return;en.current.system=h,We.current.system=Math.max(We.current.system,h);let L=_t.current.aggregateOnly?
60:900;xs(O=>ea(O,l,L)),jt(null);return}if(p==="host_resource_detail"){if(_t.current.aggregateOnly)return;let l=r.snapshot,
h=Number(l?.sample_sequence);if(r.subscription_id!==Ze.current||!Number.isSafeInteger(h)||h<=en.current.detail)return;en.
current.detail=h,We.current.detail=Math.max(We.current.detail,h),As(L=>ea(L,l,180)),bn(l),jt(null);return}if(p==="host_r\
esource_unsubscribed")return r.subscription_id&&r.subscription_id!==Ze.current,void 0;if(p==="host_resource_error"){jt({
code:r.code||"unavailable",message:r.message||"Windows host metrics are unavailable."});return}if(p==="semantic_notifica\
tion"){Vr(l=>yl(l,r));return}if(!Es.current&&!r.request_id&&Qh.has(p)){let l=r.session||r.session_id||"global",h=p==="hi\
story_chunk"?r.source||"native":"";for(Zt.current.set(`${p}:${l}:${h}`,r);Zt.current.size>256;)Zt.current.delete(Zt.current.
keys().next().value);return}if(p==="session_list"){sn(r.sessions||[]),t(l=>Ao(l,r.sessions||[])),Kt(r.sessions||[]),Sn(r.
sessions||[]),_s(r.sessions||[]),an(r.sessions||[]),(r.sessions||[]).forEach(l=>{let h=l&&typeof l=="object"?l.session_id:
l,L=ya(l);l&&typeof l=="object"&&l.is_list_view&&!L&&h&&i(O=>O[h]&&O[h].length>0?{...O,[h]:[]}:O)}),Array.isArray(r.workspaces)&&
te(l=>Ut(l,r.workspaces)?l:r.workspaces);return}if(p==="session_snapshot"||p==="proxy_session_snapshot"){sn(r.sessions||
[]),t(l=>Ao(l,r.sessions||[])),Kt(r.sessions||[]),Sn(r.sessions||[]),_s(r.sessions||[]),an(r.sessions||[]),(r.sessions||
[]).forEach(l=>{let h=l&&typeof l=="object"?l.session_id:l,L=ya(l);l&&typeof l=="object"&&l.is_list_view&&!L&&h&&i(O=>O[h]&&
O[h].length>0?{...O,[h]:[]}:O)});return}if(p==="connection_ack"){if(sr(r),Array.isArray(r.semantic_notifications)&&Vr(l=>yl(
l,r.semantic_notifications)),ni(),io().catch(()=>{}),Ga(Array.isArray(r.duplicate_proxy_alarms)?r.duplicate_proxy_alarms:
[]),Wa(Array.isArray(r.nightly_validation_failures)?r.nightly_validation_failures:[]),os(r.latest_app_update_validation||
null),Ka(r.revalidation_program_health||null),Gr(r.operator_dogfood_health||null),r.provider_usage&&typeof r.provider_usage==
"object"&&Uo(l=>$l(l,r.provider_usage)),r.sessions&&r.sessions.length>0&&(t(l=>Ao(l,r.sessions)),Kt(r.sessions),Sn(r.sessions),
_s(r.sessions),an(r.sessions),r.sessions.forEach(l=>{let h=ya(l);if(l&&typeof l=="object"&&l.is_list_view&&!h){let L=l.session_id;
L&&i(O=>O[L]&&O[L].length>0?{...O,[L]:[]}:O)}})),Array.isArray(r.workspaces)&&te(l=>Ut(l,r.workspaces)?l:r.workspaces),r.
session_health){let l={};Object.entries(r.session_health).forEach(([h,L])=>{l[h]=typeof L=="object"?L.health:L}),Y(h=>ss(
h,l))}r.agent_configs&&typeof r.agent_configs=="object"&&q(l=>({...l,...r.agent_configs}));{let l={};(r.open_prompts||[]).
forEach(h=>{let L=h.session_id||h.session;L&&(l[L]={...h,received_at:Date.now()})}),(r.open_question_prompts||[]).filter(
h=>!h.lifecycle||["open","submitting"].includes(h.lifecycle)).forEach(h=>{let L=h.session_id||h.session;L&&(l[L]={...h,received_at:Date.
now()})}),Q(h=>{let L={...l};return Object.entries(h).forEach(([O,K])=>{L[O]||K?.type==="question_prompt"&&(!K.lifecycle||
["open","submitting"].includes(K.lifecycle))&&(L[O]=K)}),L})}{let l={};(r.open_error_prompts||[]).forEach(h=>{let L=h.session_id||
h.session;L&&(l[L]={...h,received_at:Date.now()})}),pe(l)}ps();return}if(p==="session_patch"){let l=r.session||r.session_id;
if(!l)return;t(O=>Gd(O,r));let h=r.patch&&typeof r.patch=="object"?r.patch:{},L={session_id:l,...h};h.activity&&Kt([L]),
(h.model_id!==void 0||h.permission_mode!==void 0||h.capabilities!==void 0)&&Sn([L]),h.chat_list&&_s([L]),h.status&&an([L]);
return}if(p==="session_health"){let l=r.session||r.session_id;l&&Y(h=>({...h,[l]:r.health}));return}if(p==="scheduled_se\
nd_status"){cr(r.scheduled_send);return}if(p==="session_summary"){let l=r.session||r.session_id;if(!l)return;if(s(h=>{let L=!1,
O=h.map(K=>{if((typeof K=="string"?K:K?.session_id)!==l)return K;let he={...typeof K=="object"?K:{},session_id:l,...r.status?
{status:r.status}:{},...r.activity?{activity:r.activity}:{},...r.goal?{goal:r.goal}:{},...r.fleet_summary?{fleet_summary:r.
fleet_summary}:{},...r.fleet_work_context?{fleet_work_context:r.fleet_work_context}:{},...r.last_user_request?{last_user_request:r.
last_user_request}:{},...r.last_snippet!=null?{last_snippet:r.last_snippet}:{},...wl(r),...qd(r)};return typeof K=="obje\
ct"&&Ut(K,he)?K:(L=!0,he)});return L?O:h}),r.status&&Y(h=>ss(h,{[l]:r.status})),r.activity){let h=String(r.activity.kind||
"idle").toLowerCase();Na({type:"status",session:l,activity:r.activity,activity_trace:r.activity_trace,thinking:["thinkin\
g","generating","running_command","applying_patch","reading_files","working"].includes(h),label:r.activity.label||""})}Number(
r.unread_delta)>0&&l!==st.current&&d(h=>({...h,[l]:(h[l]||0)+Number(r.unread_delta)}));return}if(p==="message_delta"){let l=r.
session_id||r.session;if(!l)return;let h=xd(ut.current[l]||null,r);if(!h.accepted)return;vc(l,h.stream,r.stream_trace||null);
return}if(p==="transcript_resync_required"){let l=r.session_id||r.session;if(!l||l!==st.current)return;let h=Je.current[l]||
{};Je.current[l]={...h,inFlight:!1},clearTimeout(Ge.current[l]),delete Ge.current[l],qs(l,{mode:"tail",source:"relay_sql\
ite",replace:!0});return}if(p==="history"||p==="history_snapshot"){let l=r.session||r.session_id;if(!l||r.request_id&&Hn.
current[l]&&Hn.current[l]!==r.request_id)return;let h=n.find(me=>(typeof me=="object"?me.session_id:me)===l),L=ya(h);if(h&&
typeof h=="object"&&h.is_list_view&&r.messages?.length>0&&!L){b(me=>{if(!me[l])return me;let xe={...me};return delete xe[l],
xe});return}!r.partial&&(!r.mode||r.mode==="full")&&Za(l);let O=r.messages||[],K=c[l]||null,V=!!$s.current[l]&&O.length>
0,he=!V&&Zh(p,r,K);i(me=>{let xe=he?Yo(me[l],O):O,Be=Eo(Rp(xe,me[l]));return Be===me[l]?me:{...me,[l]:Be}}),u(me=>{let xe={
...he?me[l]||{}:{},partial:!!r.partial||!!(he&&me[l]?.partial),loaded:he?Math.max(Number(me[l]?.loaded||0),Number(r.loaded_messages??
O.length)||O.length,(a[l]||[]).length):Number(r.loaded_messages??O.length)||O.length,total:Number(r.total_messages??me[l]?.
total??O.length)||O.length,limit:r.limit||null,mode:he?me[l]?.mode||"chunked":r.mode||(r.partial?"tail":"full")};return Ut(
me[l]||null,xe)?me:{...me,[l]:xe}}),b(me=>{if(!me[l])return me;let xe={...me};return delete xe[l],xe}),V&&delete $s.current[l];
return}if(p==="history_chunk"){let l=r.session||r.session_id;if(!l)return;let h=Je.current[l]||{},L=r.mode!=="older"&&h.
mode==="tail"&&(r.source||"relay_sqlite")===(h.source||"relay_sqlite");if(r.request_id&&us.current[l]&&us.current[l]!==r.
request_id&&!L)return;if(r.error&&(!Array.isArray(r.messages)||r.messages.length===0)){let Re=String(r.error?.code||""),
Ie=Number(h.retryAttempt||0);if(Vh.has(Re)&&Ie<xp){let ze=Number(r.error?.retry_after_ms??r.retry_after_ms),Ht=Number.isFinite(
ze)&&ze>0?ze:1500,oi=Math.max(25,Math.min(250,Math.floor(Ht*.05)));clearTimeout(Ge.current[l]),Je.current[l]={...h,inFlight:!1,
recovering:!0},u(Ca=>{let Pt={...Ca[l]||{},refreshing:!0};return delete Pt.error,{...Ca,[l]:Pt}}),Ge.current[l]=setTimeout(
()=>{delete Ge.current[l],!(st.current!==l||gt.current?.readyState!==WebSocket.OPEN)&&qs(l,{mode:h.mode,source:h.source,
replace:h.replace,beforeOffset:h.beforeOffset,beforeId:h.beforeId,aroundId:h.aroundId,userInitiated:h.userInitiated,limit:h.
limit,chunkBytes:h.chunkBytes,retryAttempt:Ie+1})},Math.ceil(Ht)+oi);return}b(ze=>{if(!ze[l])return ze;let Ht={...ze};return delete Ht[l],
Ht}),Je.current[l]={...Je.current[l]||{},inFlight:!1},clearTimeout(Ge.current[l]),delete Ge.current[l],u(ze=>({...ze,[l]:{
...ze[l]||{},error:String(r.error?.message||r.error||"Transcript history could not be loaded.")}}));return}let O=r.mode===
"older"?"older":r.mode==="around"?"around":"tail",K=r.cursor||{},V=K.next_before_offset??null,he=K.next_before_id??null,
me=!!(r.partial&&(V!=null||he!=null)),xe=Array.isArray(r.messages)?r.messages:[],Be=O==="around"||O==="tail"&&r.replace===
!0,bt=(Be?xe:bs(a[l],xe,O)).length;i(Re=>{let Ie=Eo(Rp(Be?so(Re[l],xe,h,r.source):bs(Re[l],xe,O),Re[l]));return Ie===Re[l]?
Re:{...Re,[l]:Ie}}),u(Re=>{let Ie={...Re[l]||{},partial:me,loaded:Be?Number(r.loaded_messages??bt)||bt:Math.max(Number(Re[l]?.
loaded||0),Number(r.loaded_messages||0),bt),total:Number(r.total_messages||Re[l]?.total||bt)||bt,limit:null,mode:"chunke\
d",source:r.source||"native",cursor:K,bytes_total:K.total_bytes||0,refreshing:!1};return delete Ie.error,Ut(Re[l]||null,
Ie)?Re:{...Re,[l]:Ie}}),b(Re=>{if(!Re[l])return Re;let Ie={...Re};return delete Ie[l],Ie}),Je.current[l]={...Je.current[l]||
{},inFlight:!1,nextBeforeOffset:V,nextBeforeId:he},clearTimeout(Ge.current[l]),delete Ge.current[l];return}if(p==="histo\
ry_delta"){let l=r.session||r.session_id;if(!l||r.request_id&&Hn.current[l]&&Hn.current[l]!==r.request_id)return;let L=(Array.
isArray(r.messages)?r.messages:Array.isArray(r.events)?r.events:[]).map(K=>K?.message||K).filter(Boolean),O=bs(a[l],L,"t\
ail");i(K=>{let V=Eo(bs(K[l],L,"tail"));return V===K[l]?K:{...K,[l]:V}}),u(K=>{let V=K[l]||{},he=Math.max(Number(V.loaded||
0),O.length),me=Math.max(Number(r.total_messages||0),Number(V.total||0),he);return{...K,[l]:{...V,loaded:he,total:me,last_sequence:Number(
r.last_sequence||V.last_sequence||0),mode:V.mode||"chunked"}}}),b(K=>{if(K[l]?.requestId!==r.request_id)return K;let V={
...K};return delete V[l],V});return}if(p==="status"||p==="proxy_status"||p==="session_status"){let l=r.session||r.session_id;
if(!l)return;let h=r.activity?.kind||"",L=r.thinking||["thinking","generating","running_command","applying_patch","readi\
ng_files","working"].includes(h);Cd(ut.current[l],r.activity||(L?null:{kind:"idle"}),L)&&Za(l);let O=r.label||r.activity?.
label||(h==="idle"?"":"Thinking"),K=L||r.activity?{kind:r.activity?.kind||(L?"thinking":"working"),label:O,updatedAt:r.activity?.
updated_at||null,observed_at:r.activity?.observed_at||null,startedAt:r.activity?.started_at||null,interruptHint:r.activity?.
interrupt_hint||"",goal:r.activity?.goal||null,goal_run:r.activity?.goal_run||null,thinking:r.activity?.thinking||null,current:r.
activity?.current||null,step:r.activity?.step||null,usage:r.activity?.usage||null,task_list:r.activity?.task_list||null,
context_card:r.activity?.context_card||null,thinkingContent:r.activity?.thinking?.text||r.activity?.thinkingContent||"",
transport:ep(r.activity_trace)}:!1;if(L){clearTimeout(vn.current[l]),g(he=>Object.is(he[l],O)?he:{...he,[l]:O}),T(he=>ss(
he,{[l]:K}));let V=r.activity?.thinking?.text??r.thinking_content??r.activity?.thinkingContent;V!=null&&w(he=>Object.is(
he[l],V)?he:{...he,[l]:V})}else h==="idle"?(clearTimeout(vn.current[l]),g(V=>V[l]===!1?V:{...V,[l]:!1}),T(V=>ss(V,{[l]:K})),
w(V=>V[l]===""?V:{...V,[l]:""})):r.activity?.goal||r.activity?.task_list||r.activity?.step||r.activity?.usage?(clearTimeout(
vn.current[l]),g(V=>V[l]===!1?V:{...V,[l]:!1}),T(V=>ss(V,{[l]:K}))):(clearTimeout(vn.current[l]),vn.current[l]=setTimeout(
()=>{g(V=>V[l]===!1?V:{...V,[l]:!1}),T(V=>V[l]===!1?V:{...V,[l]:!1}),w(V=>V[l]===""?V:{...V,[l]:""})},4e3));lr(r,l);return}
if(p==="permission_prompt"){let l=r.session_id||r.session;l&&Q(h=>({...h,[l]:{...r,received_at:Date.now()}}));return}if(p===
"question_prompt"){let l=r.session_id||r.session;l&&Q(h=>{let L=h[l],O=L?.prompt_id===r.prompt_id&&L?.generation===r.generation;
return{...h,[l]:{...O?L:{},...r,received_at:O?L.received_at:Date.now(),...r.lifecycle==="submitting"?{submitting_choice_id:L?.
submitting_choice_id||"question_answers"}:{}}}});return}if(p==="question_prompt_state"){let l=r.session_id||r.session;l&&
r.lifecycle==="failed"?Q(h=>{let L=h[l],O=L?.prompt_id===r.prompt_id&&L?.generation===r.generation;return L&&!O?h:{...h,
[l]:{...O?L:{},...r,type:"question_prompt",received_at:O?L.received_at:Date.now(),submitting_choice_id:null}}}):l&&!["op\
en","submitting"].includes(r.lifecycle)&&Q(h=>{let L=h[l];if(L?.prompt_id!==r.prompt_id||L?.generation!==r.generation)return h;
let{[l]:O,...K}=h;return K});return}if(p==="permission_prompt_expired"){let l=r.session_id||r.session;l&&Q(h=>{let{[l]:L,
...O}=h;return O});return}if(p==="session_error_prompt"){let l=r.session_id||r.session;l&&pe(h=>({...h,[l]:{...r,received_at:Date.
now()}}));return}if(p==="session_error_prompt_cleared"){let l=r.session_id||r.session;l&&pe(h=>{let{[l]:L,...O}=h;return O});
return}if(p==="chat_list"){let l=r.session_id||r.session;l&&H(h=>({...h,[l]:r.chats||[]}));return}if(p==="branch_list"){
let l=r.session_id||r.session;l&&ce(h=>({...h,[l]:{branches:r.branches||[],current:r.current||""}}));return}if(p==="thre\
ad_list"){let l=r.session_id||r.session;if(l){let h=r.threads||[],L=h.find(V=>V?.active),O=String(L?.cache_key||""),K=fa.
current[l]||"";O&&K&&O!==K&&($s.current[l]=O,Is(l)),O&&(fa.current[l]=O),be(V=>({...V,[l]:h}))}return}if(p==="duplicate_\
proxy_alarm"){Ga(Array.isArray(r.duplicate_sessions)?r.duplicate_sessions:[]);return}if(p==="nightly_validation_status"){
Wa(Array.isArray(r.failures)?r.failures:[]),r.revalidation_program_health&&Ka(r.revalidation_program_health),r.operator_dogfood_health&&
Gr(r.operator_dogfood_health);return}if(p==="app_update_validation_status"){os(r.validation||null);return}if(p==="harnes\
s_revalidation_status"){Ka(r.program_health||null);return}if(p==="operator_dogfood_status"){Gr(r.program_health||null);return}
if(p==="skill_list"){let l=r.session_id||r.session;l&&F(h=>({...h,[l]:{installed:r.installed||[],recommended:r.recommended||
[]}}));return}if(p==="codex_automation_view"){let l=r.session_id||r.session;l&&Ce(h=>({...h,[l]:r.view||null}));return}if(p===
"terminal_output"){let l=r.session_id||r.session;l&&Ne(h=>({...h,[l]:r.entries||[]}));return}if(p==="file_changes"){let l=r.
session_id||r.session;l&&Ae(h=>({...h,[l]:r.entries||[]}));return}if(p==="directory_listing"){let l=r.session_id||r.session;
l&&Dt(h=>({...h,[l]:{path:r.path,entries:r.entries||[]}}));return}if(p==="file_content"){let l=r.session_id||r.session;l&&
On(h=>Ns(h,`${l}:${r.path}`,{path:r.path,content:r.content,truncated:r.truncated}));return}if(p==="agent_config"){let l=r.
session_id||r.session;if(!l)return;kc(l,r),q(h=>{let L=h[l]||{},O={...L,...r};return(!Array.isArray(r.available_models)||
r.available_models.length===0)&&Array.isArray(L.available_models)&&L.available_models.length>0&&(O.available_models=L.available_models),
Object.values(nt.current).forEach(K=>{K.sessionId!==l||!["pending","awaiting_config"].includes(K.status)||(O[K.configKey]=
K.requestedValue)}),lt.current={...lt.current,[l]:O},{...h,[l]:O}});return}if(p==="agent_control_result"){let l=r.session_id||
r.session;if(r.request_id){Nt(L=>Ns(L,r.request_id,{...r,received_at:Date.now()}));let h=Object.entries(nt.current).find(
([,L])=>L.requestId===r.request_id&&L.sessionId===l&&["pending","awaiting_config"].includes(L.status));if(h){let[L,O]=h;
r.result==="failed"?zt(L,r.error?.message||r.error||"The agent rejected this setting."):r.result==="ok"&&(zn(L,{...O,status:"\
awaiting_config"}),l&&Nn(l))}}l&&r.result==="ok"&&r.command==="new_thread"&&Is(l),l&&r.result==="ok"&&["new_thread","swi\
tch_thread"].includes(r.command)&&Qo(l),l&&r.result==="ok"&&r.command==="switch_chat"&&or(l),["permission_response","que\
stion_response"].includes(r.command)&&l&&(r.result==="ok"?Q(h=>{if(h[l]?.request_id!==r.request_id)return h;let{[l]:L,...O}=h;
return O}):r.result==="failed"&&Q(h=>h[l]?.request_id===r.request_id?{...h,[l]:{...h[l],submitting_choice_id:null,error:r.
error?.message||"Permission response failed"}}:h)),r.command==="error_prompt_action"&&l&&r.result==="failed"&&pe(h=>h[l]?
{...h,[l]:{...h[l],submitting_action_id:null,error:r.error?.message||"Error prompt action failed"}}:h),r.command==="file\
_change_response"&&l&&r.result==="ok"&&wa(l);return}if(p==="message_accepted"){let l=r.client_message_id,h=r.session_id||
r.session;l&&h&&kt(l,h);let L=["accepted","delivered","agent_started","failed"].includes(r.status)?r.status:"accepted",O=L===
"accepted"&&r.launch_accepted_at?"launch_accepted":L;if(l&&O==="failed"){Wn(l,r.failure_code||"Send failed",h);return}let K=l?
Bt.current[l]:null;l&&!["busy_queued","steered","launch_accepted","delivered","agent_started"].includes(K)&&(et(l,O),O===
"accepted"?nn(l,"accepted","Relay accepted the message, but native delivery timed out."):O==="launch_accepted"?nn(l,"lau\
nch_accepted","The native launch was accepted, but no native user turn was observed."):O==="delivered"?nn(l,"delivered",
"Message reached the agent, but agent activity did not start in time."):tn(l)),l&&ba(l,h,V=>Er({...V,...r.created_at!=null?
{created_at:r.created_at}:{},...r.timestamp!=null?{timestamp:r.timestamp}:{},...r.ts!=null?{ts:r.ts}:{},...r.launch_accepted_at!=
null?{_launchAcceptedAt:r.launch_accepted_at}:{},_delivered:O==="delivered"||O==="agent_started",_agentStarted:O==="agen\
t_started",_sendError:null}));return}if(p==="proxy_send_result"&&r.result==="launch_accepted"){let l=r.client_message_id,
h=r.session_id||r.session;l&&h&&kt(l,h),l&&!["delivered","agent_started"].includes(Bt.current[l])&&(et(l,"launch_accepte\
d"),nn(l,"launch_accepted","The native launch was accepted, but no native user turn was observed."),ba(l,h,L=>({...L,_launchAcceptedAt:r.
accepted_at||new Date().toISOString(),_sendError:null})));return}if(p==="message_delivered"||p==="proxy_send_result"&&r.
result==="delivered"){let l=r.client_message_id,h=r.session_id||r.session;l&&h&&kt(l,h),l&&Bt.current[l]!=="agent_starte\
d"&&(et(l,"delivered"),nn(l,"delivered","Message reached the agent, but agent activity did not start in time.")),l&&ba(l,
h,L=>({...L,_delivered:!0,_sendError:null}));return}if(p==="agent_started"){let l=r.client_message_id,h=r.session_id||r.
session;l&&h&&kt(l,h),l&&(tn(l),et(l,"agent_started")),h&&yc(h,l||null),l&&ba(l,h,L=>({...L,_delivered:!0,_agentStarted:!0,
_sendError:null}));return}if(p==="message_failed"||p==="proxy_send_result"&&r.result==="failed"){let l=r.client_message_id,
h=r.session_id||r.session;if(h&&Za(h),l){let L=r.reason||r.message||r.error?.message||"Send failed";Wn(l,L,h)}return}if(p===
"message_queued"){let l=r.client_message_id,h=r.session_id||r.session;if(l){let L=Array.isArray(r.content_blocks)?r.content_blocks:
[],O=L.find(K=>K?.type==="queued_message");tn(l),et(l,"busy_queued"),h&&W(K=>({...K,[h]:[...K[h]||[],{cid:l,content:O?.content??
r.content,content_blocks:L,queuedAt:r.queued_at}]}))}return}if(p==="queue_delivered"){let l=r.client_message_id,h=r.session_id||
r.session;l&&(et(l,"accepted"),nn(l,"accepted","Queued message left the relay, but native delivery timed out."),h&&W(L=>({
...L,[h]:(L[h]||[]).filter(O=>O.cid!==l)})));return}if(p==="steer_result"){let l=r.client_message_id,h=r.session_id||r.session;
l&&(r.result==="ok"?(et(l,"steered"),nn(l,"steered","Message was steered, but agent activity did not start in time.")):Wn(
l,r.error?.message||r.error||"The desktop proxy rejected the message.",h),h&&W(L=>({...L,[h]:(L[h]||[]).filter(O=>O.cid!==
l)})));return}if(p==="native_queue"){let l=r.session_id||r.session,h=r.items||[];l&&W(L=>{let O=(L[l]||[]).filter(V=>V.cid&&
V.cid.startsWith("cmsg-")),K=h.map((V,he)=>({cid:`native-${he}`,content:V.content_blocks?.find(me=>me?.type==="queued_me\
ssage")?.content??V.text,content_blocks:Array.isArray(V.content_blocks)?V.content_blocks:[],native:!0,nativeIndex:V.index,
status:V.state||"queued"}));return{...L,[l]:[...O,...K]}});return}if(p==="rate_limit_active"){let l=r.session_id||r.session,
h=r.percent_used??null,L=h==null||h>=100;l&&s(O=>O.map(K=>(typeof K=="string"?K:K?.session_id)===l?{...typeof K=="object"?
K:{},session_id:l,rate_limited_until:r.retry_after_hint||(L?"unknown":null),rate_limit_active:L,percent_used:h}:K));return}
if(p==="rate_limit_cleared"){let l=r.session_id||r.session;l&&s(h=>h.map(L=>(typeof L=="string"?L:L?.session_id)===l?{...typeof L==
"object"?L:{},session_id:l,rate_limited_until:null,rate_limit_active:!1,percent_used:null}:L));return}if(p!=="session_la\
unching"){if(p==="session_launch_ack"){let l=r.request_id,h=r.session_id||r.session;l&&we(L=>{let{[l]:O,...K}=L;return K}),
h&&Z(h);return}if(p==="session_launch_failed"){let l=r.request_id,h=r.reason||r.error||"Launch failed";l&&we(L=>Ns(L,l,{
...L[l],status:"failed",error:h}));return}if(p==="session_closed"){let l=r.session||r.session_id;l&&s(h=>h.filter(L=>(typeof L==
"string"?L:L?.session_id)!==l));return}if(p==="message"||p==="proxy_message"||p==="message_event"){let l=r.session||r.session_id||
r.message?.session_id,h=r.role||r.message?.role,L=r.content||r.message?.content,O=Array.isArray(r.content_blocks)?r.content_blocks:
Array.isArray(r.message?.content_blocks)?r.message.content_blocks:null,K=r.client_message_id||r.message?.client_message_id||
null,V=r.status||r.message?.status||null,he=V==="delivered"||V==="agent_started";if(!l||!h||!L)return;h==="assistant"&&Za(
l);let me=Er({role:h,content:L,...O?{content_blocks:O}:{},...r.source_message_id?{source_message_id:r.source_message_id}:
{},...r.native_source_id?{native_source_id:r.native_source_id}:{},...r.source_cursor?{source_cursor:r.source_cursor}:{},
...r.source?{source:r.source}:{},...r.server_message_id!=null?{server_message_id:r.server_message_id}:{},...K?{client_message_id:K}:
{},...V?{status:V}:{},...r.sequence!=null?{sequence:r.sequence}:{},...r.created_at!=null?{created_at:r.created_at}:{},...r.
timestamp!=null?{timestamp:r.timestamp}:{},...r.ts!=null?{ts:r.ts}:{}});i(Be=>{let Xe=Be[l]||[];if(h==="user"){let Re=Xe.
findIndex(Ie=>Ie._optimistic&&(K&&Ie._cid===K||!K&&Ie.content===L));if(Re>=0){let Ie=[...Xe],ze=Xe[Re];return Ie[Re]=Er(
{...ze,role:h,content:L,...O?{content_blocks:O}:{},...me.source_message_id?{source_message_id:me.source_message_id}:{},...me.
native_source_id?{native_source_id:me.native_source_id}:{},...me.source_cursor?{source_cursor:me.source_cursor}:{},...me.
source?{source:me.source}:{},...me.server_message_id!=null?{server_message_id:me.server_message_id}:{},...me.client_message_id?
{client_message_id:me.client_message_id}:{},...me.status?{status:me.status}:{},...me.sequence!=null?{sequence:me.sequence}:
{},...me.created_at!=null?{created_at:me.created_at}:{},...me.timestamp!=null?{timestamp:me.timestamp}:{},...me.ts!=null?
{ts:me.ts}:{},_delivered:ze._delivered||he,_agentStarted:ze._agentStarted||V==="agent_started",_cid:ze._cid,_optimistic:ze.
_optimistic}),{...Be,[l]:Eo(Ie)}}}let bt=Gi(me);return Xe.some(Re=>bt?Gi(Re)===bt:Re.role===h&&Re.content===L)?Be:{...Be,
[l]:Eo([...Xe,{...me,...h==="user"&&K?{_cid:K}:{},_delivered:h==="user"&&he,_agentStarted:h==="user"&&V==="agent_started"}])}}),
h==="assistant"&&l!==st.current&&d(Be=>({...Be,[l]:(Be[l]||0)+1}));let xe=wl(r);Object.keys(xe).length>0&&s(Be=>Be.map(Xe=>(typeof Xe==
"string"?Xe:Xe?.session_id)===l?{...typeof Xe=="object"?Xe:{},session_id:l,...xe}:Xe));return}}}}return Fn.current=Na,{sessions:n,
messages:a,provisionalStreams:gc,historyMeta:c,historyLoading:f,connected:k,connectionHealth:A,unread:M,setUnread:d,thinking:v,
thinkingContent:x,activities:E,health:U,deliveryStates:re,launchStates:X,justLaunched:ve,setJustLaunched:Z,permissionPrompts:Se,
respondToPrompt:rr,errorPrompts:de,respondToErrorPrompt:Os,interruptSession:Kn,controlGoal:Ds,agentConfigs:J,configControlStates:Jt,
requestAgentConfig:Nn,setAgentModel:js,setAgentEffort:Cn,setAgentPermissionMode:vs,setAutoApprovePermissions:xn,setAntigravityMode:Bs,
setCodexConfig:rn,newThread:Fs,openPanel:Vn,openNativeWindow:at,requestChatList:or,switchChat:on,newChat:Xo,chatLists:$,
requestThreadList:Qo,switchThread:Jo,threadLists:fe,switchWorkspace:Sc,requestTerminalOutput:ao,sendTerminalInput:ka,terminalOutputs:_e,
requestFileChanges:wa,respondToFileChange:ro,fileChanges:Le,sendAttachment:ir,send:ke,sendToSession:xc,steerMessage:si,discardQueuedMessage:ai,
editQueuedMessage:ri,queuedMessages:ae,scheduledSends:ie,scheduleSend:Sa,cancelScheduledSend:Rn,refreshScheduledSends:io,
launchSession:Cc,resumeSession:Hs,closeSession:ti,activeSessionRef:st,restoreCachedTranscript:bc,setSessionSubscriptions:Vo,
workspaces:G,branchLists:He,requestBranchList:Ft,switchBranch:Nc,createBranch:An,skillLists:je,requestSkillList:ei,automationViews:ne,
showCodexAutomation:oo,controlResults:Ue,directoryListings:yt,requestDirectoryListing:Zo,fileContents:hn,requestFileContent:wc,
requestHistory:no,requestHistoryChunk:qs,duplicateProxyAlarms:Dn,nightlyValidationFailures:Ur,latestAppUpdateValidation:oa,
revalidationProgramHealth:za,operatorDogfoodHealth:pc,providerUsage:jn,providerUsageRefreshReceipt:Wr,requestProviderUsageRefresh:eo,
setProviderUsageWatching:tr,providerUsageResetReceipt:ia,consumeProviderUsageResetCredit:ms,providerUsageCostDetail:ca,requestProviderUsageCostDetail:Gn,
hostResources:Go,hostResourceError:Kr,hostResourceHistory:Wo,hostResourceDetails:mc,hostResourceSubscription:fc,subscribeHostResources:to,
unsubscribeHostResources:gs,requestHostResourceRefresh:nr,clearHostResources:wn,semanticNotifications:hc,sessionAliases:zo}}function t_(e){return typeof e=="string"?e:e?.session_id||e?.id||""}function Lp(e){let t=Number(e?.pin_order);return Number.
isSafeInteger(t)&&t>0?t:0}function n_(e){return e?.pinned===!0||Lp(e)>0}function Pp(e,t={}){let n=[],s=[];for(let a of Array.
isArray(e)?e:[]){let i=t_(a),c=i?t[i]:null;n_(c)?n.push({session:a,id:i,order:Lp(c)}):s.push(a)}return n.sort((a,i)=>(a.
order||Number.MAX_SAFE_INTEGER)-(i.order||Number.MAX_SAFE_INTEGER)||a.id.localeCompare(i.id)),{pinned:n.map(a=>a.session),
unpinned:s}}var Il="remote-agent-chat:group-aliases:v1",Ki=Object.freeze({"^remoteagent":"Remote Agent Chat"}),s_=new Set(["thinking",
"generating","running_command","applying_patch","reading_files","working"]),a_=new Set(["validator","test","fixture","pr\
obe","e2e","throwaway"]),r_=[/(?:^|\/)cursor-test(?:\/|$)/i,/(?:^|\/)remote-agent-(?=[^/]*(?:-(?:test|fixture|probe|e2e|validator|validation|throwaway|switch-anchor)(?:-|\/|$)))[^/]+(?:\/|$)/i,
/(?:^|\/)rac-(?=[^/]*(?:-(?:test|fixture|probe|e2e|validator|validation|throwaway)(?:-|\/|$)))[^/]+(?:\/|$)/i,/(?:^|\/)reply-with-exactly-rac-[^/]*(?:\/|$)/i];
function qn(e){return typeof e=="string"?e:e?.session_id||e?.id||""}function Ol(e){if(!e||typeof e!="object"||e.is_test_session===
!1)return!1;if(e.is_test_session===!0||e.is_test_session===1||e.is_test_session==="true"||e.validator_session===!0||a_.has(
String(e.session_kind||e.session_class||"").trim().toLowerCase()))return!0;let t=String(e.workspace_path||e.project_root||
"").trim().replace(/\\/g,"/").replace(/\/+$/g,"").toLowerCase();if(r_.some(s=>s.test(t)))return!0;let n=[e.workspace_name,
e.display_name,e.window_title,e.chat_title].filter(Boolean).join("/").toLowerCase();return/(?:^|[\s/_-])(?:validator|fixture|throwaway)(?:$|[\s/_-])/i.
test(n)}function ja(e){if(typeof e=="number"&&Number.isFinite(e))return e;let t=Date.parse(String(e||""));return Number.
isFinite(t)?t:0}function o_(e){return(Array.isArray(e)?e:[]).reduce((t,n)=>Math.max(t,ja(n?.ts??n?.timestamp??n?.created_at??
n?.updated_at)),0)}function Op(e,t={}){let n=qn(e),s=t.activities?.[n]||(typeof e=="object"?e.activity:null)||{kind:"idl\
e"},i=!!t.thinking?.[n]&&!s.generating?{...s,kind:s_.has(String(s.kind||"").toLowerCase())?s.kind:"thinking",generating:!0}:
s,c=!!t.pendingPrompts?.[n]||!!t.errorPrompts?.[n]||typeof e=="object"&&e.rate_limit_active===!0;return Ii(i,c,{connected:t.
connected,health:t.health?.[n]||t.healthMap?.[n],nowMs:t.nowMs,freshnessMs:t.freshnessMs,requireFreshness:t.requireFreshness===
!0})}function Dp(e,t={}){let n=[],s=[],a={};for(let i of Array.isArray(e)?e:[]){let c=qn(i);if(!c)continue;let u=Op(i,t);
a[c]=u,(Pa(u)?n:s).push(i)}return{working:n,nonWorking:s,states:a}}function Dl(e,t={}){let n=Array.isArray(e)?e:[],s=n.map(
qn).filter(Boolean);return{version:1,revision:Number(t.revision||0),sessionOrder:s,fallbackSessionById:Object.fromEntries(
n.map(a=>[qn(a),a]).filter(([a])=>a))}}function jp(e,t,n={}){let s=Array.isArray(t)?t:[],a=Object.fromEntries(s.map(A=>[
qn(A),A]).filter(([A])=>A)),i=Object.keys(a),c=e?.version===1?e:Dl(s,n),u=Array.isArray(c.sessionOrder)?c.sessionOrder:[];
if(!(i.length!==u.length||i.some(A=>!u.includes(A))))return{ledger:c,sessions:u.map(A=>a[A]||c.fallbackSessionById?.[A]).
filter(Boolean),structuralChanged:!1,deferred:!1};if(n.freezeStructure)return{ledger:c,sessions:u.map(A=>a[A]||c.fallbackSessionById?.[A]).
filter(Boolean),structuralChanged:!0,deferred:!0};let b=new Set(i),k=u.filter(A=>b.has(A));for(let A of i)k.includes(A)||
k.push(A);let N={version:1,revision:Number(c.revision||0)+1,sessionOrder:k,fallbackSessionById:Object.fromEntries(k.map(
A=>[A,a[A]||c.fallbackSessionById?.[A]]).filter(([,A])=>!!A))};return{ledger:N,sessions:k.map(A=>a[A]||N.fallbackSessionById[A]).
filter(Boolean),structuralChanged:!0,deferred:!1}}function i_(e,t={}){let n=qn(e),s=t.activities?.[n]||(typeof e=="objec\
t"?e.activity:null)||null,a=Op(e,t),i=a==="needs_attention",c=Pa(a),u=Math.max(ja(t.lastMessageAt?.[n]),o_(t.messages?.[n])),
f=Math.max(ja(s?.updatedAt??s?.updated_at),ja(s?.startedAt??s?.started_at),ja(typeof e=="object"?e.last_message_at:null),
ja(typeof e=="object"?e.last_seen_at:null),ja(typeof e=="object"?e.created_at:null));return{id:n,tier:i?2:c&&t.rankWorking!==
!1?1:0,recency:u||f}}function Bp(e,t={}){let n=new Map((t.previousGroupOrder||[]).map((u,f)=>[u,f])),s=new Map((t.previousSessionOrder||
[]).map((u,f)=>[u,f])),a=(u,f)=>n.has(u)?n.get(u):n.size+f,i=(u,f)=>s.has(u)?s.get(u):s.size+f,c=(Array.isArray(e)?e:[]).
map((u,f)=>{let b=(u.sessions||[]).map((k,N)=>({session:k,sessionIndex:N,...i_(k,t)})).sort((k,N)=>N.tier-k.tier||N.recency-
k.recency||i(k.id,k.sessionIndex)-i(N.id,N.sessionIndex)||k.id.localeCompare(N.id));return{group:{...u,sessions:b.map(k=>k.
session)},groupIndex:f,tier:b.reduce((k,N)=>Math.max(k,N.tier),0),recency:b.reduce((k,N)=>Math.max(k,N.recency),0)}});return c.
sort((u,f)=>f.tier-u.tier||f.recency-u.recency||a(u.group.key,u.groupIndex)-a(f.group.key,f.groupIndex)||u.group.key.localeCompare(
f.group.key)),c.map(u=>u.group)}function Fp(e){return{groupOrder:(e||[]).map(t=>t.key),sessionOrder:(e||[]).flatMap(t=>(t.
sessions||[]).map(qn))}}function Hp(e){return(e||[]).flatMap(t=>(t.sessions||[]).map(n=>`${t.key}:${qn(n)}`)).sort().join(
"|")}function ql(e){return String(e?.key||"unscoped")}function Vi(e){let t={},n={},s={};for(let a of e||[]){let i=ql(a);
s[i]={...a,sessions:[]};for(let c of a.sessions||[]){let u=qn(c);u&&(t[u]=c,n[u]=i)}}return{sessionById:t,groupBySession:n,
groupMeta:s}}function c_(e){return{groupOrder:[...e?.groupOrder||[]],sessionOrder:[...e?.sessionOrder||[]]}}function l_(e,t){
return(e?.groupOrder||[]).join("|")===(t?.groupOrder||[]).join("|")&&(e?.sessionOrder||[]).join("|")===(t?.sessionOrder||
[]).join("|")}function u_(e,t={},n=null){return Fp(Bp(e,{...t,previousGroupOrder:n?.groupOrder||t.previousGroupOrder,previousSessionOrder:n?.
sessionOrder||t.previousSessionOrder}))}function Lo(e,t={}){let n=Bp(e,t),s=Vi(n),a=Fp(n);return{version:1,revision:Number(
t.revision||0),groupOrder:a.groupOrder,sessionOrder:a.sessionOrder,historicalGroupOrder:a.groupOrder,historicalSessionOrder:a.
sessionOrder,historicalGroupBySession:s.groupBySession,groupBySession:s.groupBySession,groupMeta:s.groupMeta,fallbackSessionById:s.
sessionById,sourceMembership:Hp(e)}}function Wi(e,t){let n=Vi(t),s=new Map((e?.groupOrder||[]).map(a=>[a,[]]));for(let a of e?.
sessionOrder||[]){let i=e.groupBySession?.[a];if(!i||!s.has(i))continue;let c=n.sessionById[a]||e.fallbackSessionById?.[a];
c&&s.get(i).push(c)}return(e?.groupOrder||[]).map(a=>({...n.groupMeta[a]||e.groupMeta?.[a]||{key:a},key:a,sessions:s.get(
a)||[]})).filter(a=>a.sessions.length>0)}function qp(e,t,n={}){let s=u_(t,n,e);if(!l_(c_(e),s))return!0;let a=Vi(t);return Object.
entries(a.groupBySession).some(([i,c])=>e.groupBySession?.[i]!==c)}function Up(e,t,n={}){let s=e?.version===1?e:Lo(t,n),
a=Hp(t);if((s.sessionOrder||[]).length===0&&a){let v=Lo(t,{...n,revision:Number(s.revision||0)+1});return{ledger:v,groups:Wi(
v,t),orderChanged:!1,structuralChanged:!0,deferred:!1}}if(a===s.sourceMembership)return{ledger:s,groups:Wi(s,t),orderChanged:qp(
s,t,n),structuralChanged:!1,deferred:!1};if(n.freezeStructure)return{ledger:s,groups:Wi(s,t),orderChanged:!0,structuralChanged:!0,
deferred:!0};let i=Vi(t),c=new Set(Object.keys(i.sessionById)),u=[...s.historicalSessionOrder||s.sessionOrder||[]],f=[...s.
historicalGroupOrder||s.groupOrder||[]],b={...s.historicalGroupBySession||s.groupBySession||{}};for(let v of t||[]){let g=ql(
v);f.includes(g)||f.push(g);for(let x of v.sessions||[]){let w=qn(x);w&&!u.includes(w)&&(u.push(w),b[w]=g)}}let k={},N=[],
A=[],S={...s.groupMeta||{}},M={};for(let v of u)c.has(v)&&(N.push(v),k[v]=s.groupBySession?.[v]||b[v]||i.groupBySession[v],
M[v]=i.sessionById[v]);for(let v of t||[]){let g=ql(v);for(let x of v.sessions||[]){let w=qn(x);!w||k[w]||(N.push(w),k[w]=
g,M[w]=x,S[g]={...v,sessions:[]})}}for(let v of f)N.some(g=>k[g]===v)&&A.push(v);for(let v of N){let g=k[v];A.includes(g)||
A.push(g)}let d={version:1,revision:Number(s.revision||0)+1,groupOrder:A,sessionOrder:N,historicalGroupOrder:f,historicalSessionOrder:u,
historicalGroupBySession:b,groupBySession:k,groupMeta:S,fallbackSessionById:M,sourceMembership:a};return{ledger:d,groups:Wi(
d,t),orderChanged:qp(d,t,n),structuralChanged:!0,deferred:!1}}function Gp(e,t,n={}){return Lo(t,{...n,previousGroupOrder:e?.
groupOrder,previousSessionOrder:e?.sessionOrder,revision:Number(e?.revision||0)+1})}function zi(e){let t=String(e||"").trim().
replace(/\\/g,"/").replace(/\/+$/,"");return!t||t.toLowerCase()==="unknown"||!/^(?:[A-Za-z]:\/|\/\/|\/)/.test(t)?null:{key:t.
toLowerCase(),path:t}}function Wp(e){return String(e||"").replace(/\\/g,"/").replace(/\/+$/,"").split("/").filter(Boolean).
pop()||"Unscoped"}function d_(e,t){return e===t||e.startsWith(`${t}/`)}function p_(e){return Wp(e).toLowerCase().replace(
/[^a-z0-9]+/g,"")}function Ip(e){return`alias:${String(e||"").trim().toLowerCase().replace(/[^a-z0-9]+/g,"-")}`}function Yi(e){
let t=e&&typeof e=="object"&&!Array.isArray(e)?e:{};return Object.fromEntries(Object.entries({...Ki,...t}).filter(([n,s])=>String(
n).trim()&&String(s).trim()).map(([n,s])=>[String(n).trim(),String(s).trim()]))}function m_(e,t,n){let s=t&&typeof t=="o\
bject"&&(t.group_alias||t.project_group)||null;if(typeof s=="string"&&s.trim()){let i=s.trim();return{key:Ip(i),title:i}}
if(!e)return null;let a=p_(e.path);for(let[i,c]of Object.entries(Yi(n)))try{if(new RegExp(i,"i").test(a))return{key:Ip(c),
title:c}}catch{}return null}function jl(e,t={},n=Ki){let s=Array.isArray(e)?e:[],a=s.map(u=>zi(u&&typeof u=="object"?u.project_root:
null)).filter(Boolean).sort((u,f)=>f.key.length-u.key.length),i=[],c=new Map;for(let u of s){let f=typeof u=="string"?u:
u?.session_id||u?.id,b=f?t[f]:null,k=zi(u&&typeof u=="object"?u.project_root:null),N=zi(u&&typeof u=="object"?u.workspace_path:
null)||zi(b?.file_access_scope),A=!k&&N?a.find(g=>d_(N.key,g.key)):null,S=k||A||N,M=m_(S,u,n),d=M?.key||S?.key||"unscope\
d",v=c.get(d);v||(v={key:d,label:M?.title||(S?Wp(S.path):"Unscoped"),path:S?.path||null,sessions:[]},c.set(d,v),i.push(v)),
v.sessions.push(u)}return i}var f_=new Set(["claude","claude_cli","claude-desktop","codex","codex_cli","codex-desktop","cursor","cursor_cli","gemini",
"continue","continue_yolo","roo_code","cline","antigravity","antigravity_panel","antigravity-v2"]);function zp(e,t={},n="\
unknown",s=!0){let a=typeof e=="string"?e:String(e?.session_id||e?.id||""),i=String(typeof e=="object"?e?.agent_type||t?.
agent_type||"":t?.agent_type||""),c=t?.capabilities||{};return!!a&&!!s&&f_.has(i)&&n!=="disconnected"&&e?.disconnected!==
!0&&e?.is_list_view!==!0&&c.send!==!1&&c.send_message!==!1&&c.message_send!==!1}function Kp(e,t=()=>!0){let n=Array.isArray(
e?.session_ids)?e.session_ids:[],s=[...new Set(n.map(u=>String(u||"").trim()).filter(Boolean))],a=typeof e?.content=="st\
ring"?e.content.trim():"";if(s.length<1||s.length>20)return{ok:!1,error:"Select between 1 and 20 sessions"};if(!a||a.length>
65536)return{ok:!1,error:"Prompt must contain 1-65536 characters"};let i=`SEND TO ${s.length} SESSIONS`;if(e?.confirmation!==
i)return{ok:!1,error:"Broadcast confirmation does not match the selected session count"};let c=s.filter(u=>!t(u));return c.
length?{ok:!1,error:"One or more selected sessions cannot receive messages",unsupported:c}:{ok:!0,sessionIds:s,content:a,
confirmation:i}}function Vp(e){return Object.fromEntries(e.map(t=>[t,{status:"queued",error:null}]))}var{useEffect:Yp,useLayoutEffect:g_,useRef:Xi,useState:Bl}=React,Ba=12,Xp=10,Fl=360,Qp=210,h_=450;function __(e,t,n){return Math.
min(Math.max(e,t),Math.max(t,n))}function b_(e){return`title-disclosure-${String(e||"title").replace(/[^a-z0-9_-]+/gi,"-")}`}
function Qi({title:e,disclosureKey:t,kind:n="title",wrapperClassName:s,triggerClassName:a,disclosureClassName:i,triggerLabel:c,
triggerTag:u="button"}){let f=Xi(null),b=Xi(null),k=Xi(null),N=Xi({focused:!1,hovered:!1,latched:!1}),[A,S]=Bl(!1),[M,d]=Bl(
!1),[v,g]=Bl(null),x=b_(`${n}-${t}`),w=u;function E(){let W=N.current;S(W.focused||W.hovered||W.latched)}function T({restoreFocus:W=!1}={}){
N.current={focused:!1,hovered:!1,latched:!1},d(!1),g(null),S(!1),W&&f.current?.focus({preventScroll:!0})}function U(){N.
current.latched=!0,d(!0),S(!0)}function Y(){k.current&&(clearTimeout(k.current),k.current=null)}Yp(()=>()=>Y(),[]),Yp(()=>{
if(!A||!M)return;let W=ie=>{f.current?.contains(ie.target)||b.current?.contains(ie.target)||T()};return document.addEventListener(
"pointerdown",W,!0),()=>document.removeEventListener("pointerdown",W,!0)},[A,M]),g_(()=>{if(!A)return;let W=null,ie=()=>{
W=null;let X=f.current,we=b.current;if(!X||!we)return;let ve=X.getBoundingClientRect();if(ve.bottom<=0||ve.top>=window.innerHeight||
ve.right<=0||ve.left>=window.innerWidth){T();return}let Z=window.innerWidth,Se=window.innerHeight,Q=document.querySelector(
".sidebar")?.getBoundingClientRect(),de=window.matchMedia?.("(pointer: coarse)")?.matches===!0||Z<=640,pe=Math.max(ve.right,
Q?.right||ve.right),J=Z-pe-Xp-Ba,q=we.getBoundingClientRect().height;if(!de&&J>=Qp){let G=Math.min(Fl,J),te=__(ve.top,Ba,
Se-q-Ba);g({mode:"right",left:pe+Xp,top:te,width:G});return}g({mode:"sheet",bottom:Ba,left:Ba,width:Math.min(Fl,Z-Ba*2)})},
ge=()=>{W===null&&(W=requestAnimationFrame(ie))};return ge(),window.addEventListener("resize",ge),document.addEventListener(
"scroll",ge,!0),()=>{W!==null&&cancelAnimationFrame(W),window.removeEventListener("resize",ge),document.removeEventListener(
"scroll",ge,!0)}},[A,e]);let re={ref:f,className:a,role:u==="button"?void 0:"button",type:u==="button"?"button":void 0,tabIndex:u===
"button"?void 0:0,"aria-label":c,"aria-describedby":A?x:void 0,"aria-expanded":A,onPointerEnter:W=>{W.pointerType&&W.pointerType!==
"mouse"&&W.pointerType!=="pen"||(N.current.hovered=!0,E())},onPointerLeave:W=>{W.pointerType&&W.pointerType!=="mouse"&&W.
pointerType!=="pen"||(N.current.hovered=!1,E())},onPointerDown:W=>{W.pointerType==="touch"&&(Y(),k.current=setTimeout(()=>{
k.current=null,U()},h_))},onPointerUp:Y,onPointerCancel:Y,onFocus:()=>{N.current.focused=!0,E()},onBlur:()=>{N.current.focused=
!1,E()},onClick:W=>{W.stopPropagation(),U()},onContextMenu:W=>{W.preventDefault(),W.stopPropagation(),U()},onKeyDown:W=>{
if(W.key==="Escape"){W.preventDefault(),T({restoreFocus:!0});return}u!=="button"&&(W.key==="Enter"||W.key===" ")&&(W.preventDefault(),
U())}},ee=v||{mode:"measuring",left:-1e4,top:Ba,width:Fl},ae=A&&ReactDOM.createPortal(React.createElement("div",{ref:b,id:x,
className:`title-disclosure-portal ${i||""}`.trim(),role:"tooltip","data-title-disclosure-for":t,"data-title-disclosure-\
kind":n,"data-placement":ee.mode,style:{left:`${ee.left}px`,top:ee.top==null?"auto":`${ee.top}px`,bottom:ee.bottom==null?
"auto":`${ee.bottom}px`,width:ee.mode==="sheet"?`${ee.width}px`:"max-content",maxWidth:`${ee.width}px`,minWidth:`${Math.
min(Qp,ee.width)}px`}},e),document.body);return React.createElement("div",{className:s},React.createElement(w,{...re},e),
ae)}var Hl=Object.freeze([{command:"/goal resume",action:"resume",detail:"Resume the current Codex goal through native goal \
control."},{command:"/goal pause",action:"pause",detail:"Pause the current Codex goal through native goal control."}]);function Jp(e,t={}){
let s=(typeof e=="string"?e:"").trim(),a=Math.max(0,Number(t.attachmentCount)||0);if(!s||a>0||/[\r\n]/.test(s))return{kind:"\
chat",text:s};let i=s.toLowerCase(),c=Hl.find(u=>u.command===i);return c?{kind:"goal_control",action:c.action,command:c.
command,text:s}:/^\/goal(?:\s|$)/i.test(s)?{kind:"unsupported_goal_control",command:s,text:s}:{kind:"chat",text:s}}function Zp(e,t){
let n=String(t||"").trim().toLowerCase();return e==="resume"&&n==="active"?"Already active":e==="pause"&&n==="paused"?"A\
lready paused":""}var em={schema_version:1,asset_set_version:"2026-07-16.1",retrieved_date:"2026-07-16",policy:{purpose:"First-party provi\
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
er time without modifying source pixels"]}]}]};var y_=Object.freeze(Object.fromEntries(em.providers.map(e=>[e.provider_id,Object.freeze({accessibleName:e.accessible_name,
light:`/provider-assets/${e.render.web.light}`,dark:`/provider-assets/${e.render.web.dark}`,darkTint:e.render.web.dark_tint||
""})])));function k_(e){return y_[String(e||"")]||null}function Ji({providerId:e,providerName:t}){let n=k_(e),[s,a]=React.
useState(!1);React.useEffect(()=>a(!1),[e]);let i=n?.accessibleName||String(t||"Unknown provider");return!n||s?React.createElement(
"span",{className:"usage-dashboard-provider-mark usage-dashboard-provider-mark-fallback","data-provider-mark-id":e,role:"\
img","aria-label":`${i} provider mark unavailable`},React.createElement("span",{"aria-hidden":"true"},i)):React.createElement(
"span",{className:"usage-dashboard-provider-mark","data-provider-mark-id":e,role:"img","aria-label":`${i} provider mark`},
React.createElement("img",{className:"usage-dashboard-provider-mark-image usage-dashboard-provider-mark-light",src:n.light,
alt:"","aria-hidden":"true",onError:()=>a(!0)}),React.createElement("img",{className:`usage-dashboard-provider-mark-imag\
e usage-dashboard-provider-mark-dark${n.darkTint?" usage-dashboard-provider-mark-tinted":""}`,src:n.dark,alt:"","aria-hi\
dden":"true",onError:()=>a(!0)}))}var w_=Object.freeze({codex:"openai-codex","codex-desktop":"openai-codex",codex_cli:"openai-codex",codex_vscode:"openai-\
codex",claude:"anthropic-claude","claude-desktop":"anthropic-claude",claude_cli:"anthropic-claude",claude_code:"anthropi\
c-claude",cursor:"cursor",cursor_cli:"cursor",antigravity:"google-antigravity",antigravity_panel:"google-antigravity","a\
ntigravity-v2":"google-antigravity",gemini:"google-antigravity",ollama:"ollama-local"}),S_=Object.freeze({"openai-codex":"\
OpenAI Codex","anthropic-claude":"Anthropic Claude",cursor:"Cursor","google-antigravity":"Google Antigravity","ollama-lo\
cal":"Ollama"});function Rt(e,t=160){return String(e??"").replace(/\s+/g," ").trim().slice(0,t)}function Zi(e){return Rt(
e).toLowerCase().replace(/[^a-z0-9]+/g,"")}function Po(e){let t=Number(e);return Number.isFinite(t)?t:null}function N_(e,t){
return Rt(e?.agent_type||e?.agentType||t?.agent_type||t?.agentType,80)}function nm(e,t){return Rt(e?.usage_billing_provider_id||
e?.billing_provider_id||e?.provider_usage?.provider_id||t?.usage_billing_provider_id||t?.billing_provider_id,80)}function C_(e,t){
return Rt(e?.usage_account_fingerprint||e?.provider_account_fingerprint||e?.provider_usage?.account_fingerprint||t?.usage_account_fingerprint,
96)}function x_(e,t){return Rt(e?.usage_quota_domain||e?.provider_quota_domain||e?.provider_usage?.quota_domain||t?.usage_quota_domain,
120)}function A_(e,t){let n=Rt(t?.observed_model_id||t?.model_id||t?.selected_model_id||t?.model||e?.observed_model_id||
e?.model_id||e?.selected_model_id||e?.model,160),s=Rt(t?.observed_model_label||t?.model_label||e?.model_label||n,160);return{
id:n,label:s}}function R_(e,t,n){let s=Rt(n?.model_vendor||t?.model_vendor,80);if(s)return s;let a=`${e.id} ${e.label}`.
toLowerCase();return/claude|anthropic/.test(a)?"Anthropic":/gemini|google/.test(a)?"Google":/gpt|codex|openai|\bo[1345](?:\b|-)/.
test(a)?"OpenAI":/ollama|qwen|gemma|llama|mistral/.test(a)?"Ollama/runtime-defined":e.id?"Unknown model vendor":"Not rep\
orted"}function M_(e,t){let n=Rt(e?.usage_runtime_kind||e?.ollama_runtime_kind||e?.model_runtime_kind||t?.usage_runtime_kind||
t?.ollama_runtime_kind||t?.model_runtime_kind,32).toLowerCase();return n==="local"||n==="cloud"?n:""}function T_(e,t){if(!e.
id||!t)return!1;let n=[Zi(e.id),Zi(e.label)].filter(Boolean),s=[Zi(t.id),Zi(t.label)].filter(Boolean);return s.length===
0?!1:s.some(a=>n.some(i=>i===a||i.includes(a)||a.includes(i)))}function Ul(e){let t=Po(e?.remainingPercent);if(t!=null)return t;
let n=Po(e?.usedPercent);return n==null?null:100-n}function tm(e,t){let n=Ul(e),s=Ul(t);if(n!=null&&s!=null&&n!==s)return n-
s;if(n!=null)return-1;if(s!=null)return 1;let a=Po(e?.durationMinutes),i=Po(t?.durationMinutes);return a!=null&&i!=null&&
a!==i?a-i:Rt(e?.label).localeCompare(Rt(t?.label))}function $_(e,t,n){let s=N_(e,t),a=A_(e,t),i=nm(e,t)||w_[s]||"";return{
supported:!!i,state:i?"unavailable":"unsupported",tone:"unavailable",message:i?"Usage account unavailable":"No provider \
usage mapping",billingProviderId:i,billingProviderName:S_[i]||i||"Provider",providerMarkId:i,harnessSurface:s,modelId:a.
id,modelLabel:a.label,modelVendor:R_(a,e,t),accountFingerprint:"",accountLabel:"",quotaDomain:"",plan:"",mappingConfidence:"\
unavailable",generation:Number(n?.generation)||0,capturedAt:"",staleAfter:"",freshness:Rt(n?.collectionState||"unavailab\
le",40),source:"",error:null,applicableWindows:[],headerWindows:[],credits:null,financials:null,cloudUsage:null,localRuntime:null,
runtimeKind:i==="ollama-local"?M_(e,t):""}}function E_(e,t,n,s){let a=Array.isArray(s?.entries)?s.entries:[],i=C_(t,n),c=x_(
t,n),u=e.billingProviderId?a.filter(f=>f?.providerId===e.billingProviderId):a.filter(f=>Array.isArray(f?.harnessTypes)&&
f.harnessTypes.includes(e.harnessSurface));return i&&(u=u.filter(f=>f?.accountFingerprint===i)),c&&(u=u.filter(f=>f?.quotaDomain===
c)),u.length===1?{entry:u[0],confidence:i||c?"explicit_account":nm(t,n)?"explicit_provider":"unique_provider_account"}:u.
length>1?{entry:null,confidence:"ambiguous",candidates:u}:{entry:null,confidence:i||c?"linked_account_unavailable":"unav\
ailable",candidates:u}}function sm(e,t,n,s=Date.now()){let a=$_(e,t,n);if(!a.supported)return a;let i=E_(a,e,t,n);if(!i.
entry)return{...a,state:i.confidence==="ambiguous"?"ambiguous":"unavailable",message:i.confidence==="ambiguous"?"Usage a\
ccount ambiguous":"Usage account unavailable",mappingConfidence:i.confidence};let c=i.entry,u=Date.parse(c.staleAfter||""),
b=Number.isFinite(u)&&u<=s&&c.status==="fresh"?"stale":Rt(c.status||"unavailable",40),k={id:a.modelId,label:a.modelLabel},
N=Array.isArray(c.windows)?c.windows.filter(E=>E&&E.usedPercent!=null):[],A=N.filter(E=>E.modelScope&&T_(k,E.modelScope)).
sort(tm),S=N.filter(E=>!E.modelScope).sort(tm),M=[...A,...S],d=A.length>0?[A[0],S[0]].filter(Boolean):S.slice(0,2),v=a.runtimeKind;
if(a.billingProviderId==="ollama-local"){if(!v)return{...a,billingProviderName:c.providerName||a.billingProviderName,accountFingerprint:c.
accountFingerprint,accountLabel:c.accountLabel,quotaDomain:c.quotaDomain,plan:c.plan,mappingConfidence:i.confidence,capturedAt:c.
capturedAt,staleAfter:c.staleAfter,freshness:b,source:c.source,state:"ambiguous",message:"Ollama runtime unavailable",cloudUsage:c.
cloudUsage,localRuntime:c.localRuntime};if(v==="local")return{...a,billingProviderName:c.providerName||a.billingProviderName,
accountFingerprint:c.accountFingerprint,accountLabel:c.accountLabel,quotaDomain:c.quotaDomain,plan:c.plan,mappingConfidence:i.
confidence,capturedAt:c.capturedAt,staleAfter:c.staleAfter,freshness:b,source:c.source,state:c.localRuntime?"local":"una\
vailable",tone:c.localRuntime?"local":"unavailable",message:c.localRuntime?"Local \xB7 no plan limit":"Local runtime tel\
emetry unavailable",localRuntime:c.localRuntime,cloudUsage:c.cloudUsage}}let g=new Set(d.map(E=>E.tone)),x=g.has("critic\
al")?"critical":g.has("warning")?"warning":b==="stale"?"stale":d.length>0?"ok":"unavailable",w=b==="auth_required"||b===
"unavailable"?"unavailable":b==="stale"||b==="rate_limited"?"stale":d.some(E=>Number(E.usedPercent)>=100)?"exhausted":d.
length>0?"ready":"unavailable";return{...a,state:w,tone:w==="exhausted"?"critical":x,message:d.length>0?"":"Applicable u\
sage windows unavailable",billingProviderName:c.providerName||a.billingProviderName,accountFingerprint:c.accountFingerprint,
accountLabel:c.accountLabel,quotaDomain:c.quotaDomain,plan:c.plan,mappingConfidence:i.confidence,capturedAt:c.capturedAt,
staleAfter:c.staleAfter,freshness:b,source:c.source,error:c.error,applicableWindows:M,headerWindows:d,credits:c.credits,
financials:c.financials,cloudUsage:c.cloudUsage,localRuntime:c.localRuntime}}function Gl(e){let t=Rt(e?.label||"Usage",60),
n=Ul(e);return{label:t,usedPercent:Po(e?.usedPercent),remainingPercent:n,compactValue:n==null?"Unavailable":`${Math.max(
0,Math.round(n))}% left`,reset:Rt(e?.resetDescription||e?.resetsAt,120),tone:Rt(e?.tone||"unavailable",24)}}var Gm=dg(fm()),{goalLifecycleSupported:ab,latestUserRequestFromMessages:rb,projectFleetWorkContext:ob}=Gm.default,{useState:le,
useRef:Te,useEffect:Ee,useLayoutEffect:ra}=React,gm="remote-agent-chat:drafts:v1",hm="remote-agent-chat:show-test-sessio\
ns:v1",ib=120,cb=500,lb=160,ub=256*1024,_m=Object.freeze([]),db=[...Hl,{command:"/plan",detail:"Outline the implementati\
on approach and major steps."},{command:"/review",detail:"Review the current changes for bugs, regressions, and missing \
tests."},{command:"/fix",detail:"Implement or repair the current issue."},{command:"/summarize",detail:"Summarize the cu\
rrent state and important changes."}],In={claude:{name:"Claude Code",color:"#cc785c",abbr:"CC",logo:"/logo-claude-in-ag.\
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
color:"#7c3aed",abbr:"A2",logo:null}},Zl={name:"Agent",color:"#8b949e",abbr:"AG"};function eu(e){return e==="continue"||
e==="continue_yolo"}function Oo(e){return e==="cline"||e==="roo_code"}function pb(e){return e==="codex"||e==="codex-desktop"}function mb(e){return e==="codex_cli"||e==="cursor_cli"?lb:pb(e)?
cb:ib}function oe(e,t=""){return typeof e=="string"?e:e==null?t:String(e)}function Ot(e){if(typeof e=="string")return e;
if(Array.isArray(e))return e.map(t=>typeof t=="string"?t:!t||typeof t!="object"?"":typeof t.text=="string"?t.text:typeof t.
content=="string"?t.content:typeof t.url=="string"?t.url:typeof t.image_url=="string"?t.image_url:"").filter(Boolean).join(
" ");if(e&&typeof e=="object"){if(typeof e.text=="string")return e.text;if(typeof e.content=="string")return e.content;if(typeof e.
url=="string")return e.url;if(typeof e.image_url=="string")return e.image_url;try{return JSON.stringify(e)}catch{return""}}
return""}function cu(e){let t=typeof e=="string"?e:oe(e),n=2166136261;for(let s=0;s<t.length;s++)n^=t.charCodeAt(s),n=Math.
imul(n,16777619);return(n>>>0).toString(36)}function lu(e,t=0){if(!e||typeof e!="object")return`empty:${t}`;if(e._cid)return`\
cid:${e._cid}`;if(e.source_message_id)return`source:${e.source_message_id}`;if(e.native_source_id)return`native:${e.native_source_id}`;
if(e.id!=null)return`id:${e.id}`;if(e.server_message_id!=null)return`server:${e.server_message_id}`;if(e.client_msg_id)return`\
client:${e.client_msg_id}`;if(e.sequence!=null)return`seq:${e.sequence}`;let n=Ot(e.content)||Ho(e.content_blocks),s=Array.
isArray(e.content_blocks)?JSON.stringify(e.content_blocks):"";return["body",e.role||"",e.ts||"",cu(`${n}
${s}`)].join(":")}function fb(e){let t=Ot(e?.content)||Ho(e?.content_blocks),n=Array.isArray(e?.content_blocks)?JSON.stringify(
e.content_blocks):"";return cu(`${t}
${n}`)}function gb(e){return e?.role==="user"?"user":Hr(e?.content_blocks)[0]?.type||"markdown"}function bm(e){return(Array.
isArray(e)?e:[]).map((n,s)=>lu(n,s))}function hb(e,t){if(!e||!t)return"";if(t.type!=="question_prompt")return`${e}\0legac\
y\0${t.prompt_id||t.request_id||t.id||"prompt"}`;let n={kind:t.kind||"request_user_input",title:t.title||"",source_surface:t.
source?.surface||"",questions:(t.questions||[]).map(s=>({id:s.question_id||s.id||"",header:s.header||"",question:s.question||
s.message||"",answer_mode:s.answer_mode||"",multi_select:s.multi_select===!0,choices:(s.choices||s.options||[]).map(a=>({
id:a.choice_id||a.id||"",label:a.label||"",description:a.description||"",other:a.requires_text===!0||a.is_other===!0}))}))};
return`${e}\0question\0${cu(JSON.stringify(n))}`}function gn(e,t){if(!e)return;let n=e.style.scrollBehavior;e.style.scrollBehavior=
"auto",e.scrollTop=t,requestAnimationFrame(()=>{e.style.scrollBehavior==="auto"&&(e.style.scrollBehavior=n)})}function _b(e){
let t=Ot(e),n=t.match(/^\[File: ([^\]]+?) [→\u2192] ([A-Za-z]:\\.+?\\uploads\\([^\\\]]+))\]$/);if(!n)return t;let[,s,,
a]=n;return/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(s)?`![${s}](/uploads/${a})`:t}function bb(e){return Ot(e).trim().length>
0}function Hr(e){return Array.isArray(e)?e.filter(t=>t&&typeof t=="object").map(t=>{let n=oe(t.type||"markdown").toLowerCase();
if(n==="code"){let s=oe(t.language||t.lang||"").trim(),a=Ot(t.content||t.text||t.markdown||"");return{...t,type:"markdow\
n",content:`\`\`\`${s}
${a}
\`\`\``}}return n==="file_change"?{...t,type:"file_changes"}:n==="tool"?{...t,type:"tool_call"}:n==="tool_output"||n==="\
result"?{...t,type:"tool_result"}:n==="thought"?{...t,type:"thinking"}:n==="task_list"?{...t,type:"plan"}:n==="queue"||n===
"queued"?{...t,type:"queued_message"}:n==="banner"||n==="notification"?{...t,type:"notice"}:n==="worked"||n==="activity"?
{...t,type:"status"}:t}):[]}function Wm(e){if(!e||typeof e!="object")return"";let t=[e.workdir?`cwd: ${e.workdir}`:null,
e.command?`$ ${e.command}`:null,e.stdout||null,e.stderr?`stderr:
${e.stderr}`:null,e.exit_code!=null?`exit code: ${e.exit_code}`:null].filter(Boolean);if(t.length)return t.join(`

`);if(Array.isArray(e.files)&&e.files.length>0){let n=e.files.map(s=>[s.path||s.file||"",s.added!=null?`+${s.added}`:"",
s.removed!=null?`-${s.removed}`:""].filter(Boolean).join(" ")).filter(Boolean).join(`
`);return[e.content||e.text||e.markdown||"",n].filter(Boolean).join(`

`)}if(Array.isArray(e.tasks)&&e.tasks.length>0){let n=e.tasks.map(s=>{let a=oe(s?.text||s?.step||s?.title).trim(),i=oe(s?.
state||s?.status||"pending").trim();return a?`[${i}] ${a}`:""}).filter(Boolean).join(`
`);return[e.content||"",n].filter(Boolean).join(`
`)}return e.content||e.text||e.markdown||e.title||e.label||""}function vb(e){return e?bb(e.content)?!0:Hr(e.content_blocks).
some(t=>Ot(Wm(t)).trim().length>0):!1}function Ho(e){return Hr(e).map(t=>Ot(Wm(t))).filter(Boolean).join(`

`)}function sa({actions:e}){return!Array.isArray(e)||e.length===0?null:React.createElement("div",{className:"content-blo\
ck-actions"},e.map((t,n)=>React.createElement("span",{key:t.id||n,className:`content-block-action-label${t.unsupported?"\
 unsupported":""}`,title:t.unsupported?"This Codex control is visible in the source app but is not currently available f\
rom the web UI.":void 0},t.label||t.id||"Action")))}var yb=512,Ua=new Map;function kb(e,t){if(e)for(Ua.delete(e),Ua.set(
e,t);Ua.size>yb;)Ua.delete(Ua.keys().next().value)}function Fa({className:e,summary:t,children:n,stateKey:s="",defaultOpen:a=!0}){
let[i,c]=React.useState(()=>s&&Ua.has(s)?Ua.get(s):a),u=React.useCallback(f=>{let b=f.currentTarget.open;c(b),kb(s,b)},[
s]);return React.createElement("details",{className:e,open:i,onToggle:u},React.createElement("summary",null,t),n)}function wb(e){
let t=oe(e).trim().match(/^(Edited\s+\d+\s+files?)(?:\s+(\+\d+))?(?:\s+(-\d+))?$/i);return t?{label:t[1],additions:t[2]||
"",deletions:t[3]||""}:null}function Sb({blocks:e,monospace:t,autoExpandLongCodeBlocks:n,onOpenPath:s,agentType:a,richContentEager:i=!0,
richContentCacheIdentity:c=""}){let u=Hr(e);if(u.length===0)return null;let f=oe(a).toLowerCase()==="cursor",b=oe(a).toLowerCase()===
"claude",k=oe(a).toLowerCase()==="codex",N=oe(a).toLowerCase()==="codex-desktop",A=["codex","codex-desktop","codex_cli"].
includes(oe(a).toLowerCase()),S=oe(a).toLowerCase()==="antigravity-v2";function M(v){let g=[v.workdir?`cwd: ${v.workdir}`:
null,v.command?`$ ${v.command}`:null,v.stdout||null,v.stderr?`stderr:
${v.stderr}`:null,v.exit_code!=null?`exit code: ${v.exit_code}`:null].filter(Boolean);return g.length?g.join(`

`):Ot(v.content||v.text||v.markdown||"")}function d(v,g){return React.createElement(Tr,{content:v,monospace:t,autoExpandLongCodeBlocks:n,
onOpenPath:s,deferUntilVisible:!i,cacheIdentity:`${c}:block:${g}`})}return React.createElement("div",{className:`content\
-blocks${f?" content-blocks-cursor":""}`},u.map((v,g)=>{let x=oe(v.type||"markdown").toLowerCase(),w=oe(v.title||v.label||
v.summary||x),E=M(v);if(x==="status")return React.createElement("div",{key:g,className:"content-block content-block-stat\
us-chip",title:w},w||"Status");if(x==="thinking"){let T=!E||oe(E).replace(/\s+/g," ").trim()===w;if(A&&v.activity_summary===
!0){let U=E&&!T?E:w&&w.toLowerCase()!=="thinking"?w:"";return U?React.createElement("div",{key:v.native_source_id||g,className:"\
content-block content-block-thinking-native-summary",role:"note","aria-label":"Codex activity summary","data-native-sour\
ce-id":v.native_source_id||void 0,"data-native-turn-id":v.native_turn_id||void 0},React.createElement("div",{className:"\
content-block-thinking-native-summary-copy"},d(U,g)),React.createElement(Bo,{instant:v.producer_timestamp||v.created_at||
v.timestamp||v.ts})):null}if(k){let U=E&&!T?E:w&&w.toLowerCase()!=="thinking"?w:"";return U?React.createElement("div",{key:g,
className:"content-block content-block-thinking-native"},d(U,g)):null}return N&&T?React.createElement("div",{key:g,className:"\
content-block content-block-thinking-codex-desktop"},React.createElement("span",null,w||"Worked"),React.createElement("s\
pan",{className:"content-block-thinking-codex-desktop-chevron","aria-hidden":"true"},"\u2304")):N?React.createElement(Fa,
{key:g,stateKey:`${c}:disclosure:${g}`,className:"content-block content-block-thinking-codex-desktop",summary:w||"Worked"},
d(E,g)):f&&T?React.createElement("div",{key:g,className:"content-block content-block-status-chip thinking",title:w},w||"\
Thinking"):React.createElement(Fa,{key:g,stateKey:`${c}:disclosure:${g}`,className:"content-block content-block-thinking",
summary:w||"Thinking"},E&&!T&&d(E,g))}if(x==="tool_call"||x==="tool_result"){let T=!E||oe(E).replace(/\s+/g," ").trim()===
w;return f&&T?React.createElement("div",{key:g,className:"content-block content-block-status-chip tool",title:w},w||"Too\
l"):React.createElement(Fa,{key:g,stateKey:`${c}:disclosure:${g}`,className:`content-block content-block-${x==="tool_res\
ult"?"tool-result":"tool"}`,summary:React.createElement(React.Fragment,null,React.createElement("span",null,w||(x==="too\
l_result"?"Tool result":"Tool")),v.status&&React.createElement("span",{className:`content-block-status ${oe(v.status).toLowerCase()}`},
v.status))},E&&React.createElement("pre",{className:"content-block-pre"},E),React.createElement(sa,{actions:v.actions}))}
if(x==="terminal"){if(b){let T=(w||"Bash").match(/^(\S+)(?:\s+([\s\S]*))?$/),U=T?.[1]||"Bash",Y=T?.[2]||"",re=oe(v.status||
"running").toLowerCase();return React.createElement("div",{key:g,className:"content-block content-block-terminal-claude",
role:"group","aria-label":w||"Bash command"},React.createElement("div",{className:"content-block-terminal-claude-header"},
React.createElement("span",{className:`content-block-terminal-claude-dot ${re}`,"aria-hidden":"true"}),React.createElement(
"strong",null,U),Y&&React.createElement("span",null,Y)),React.createElement("div",{className:"content-block-terminal-cla\
ude-body"},v.command&&React.createElement("div",{className:"content-block-terminal-claude-row"},React.createElement("spa\
n",null,"IN"),React.createElement("pre",null,v.command)),v.stdout&&React.createElement("div",{className:"content-block-t\
erminal-claude-row"},React.createElement("span",null,"OUT"),React.createElement("pre",null,v.stdout)),v.stderr&&React.createElement(
"div",{className:"content-block-terminal-claude-row error"},React.createElement("span",null,"ERR"),React.createElement("\
pre",null,v.stderr))),React.createElement(sa,{actions:v.actions}))}return N?React.createElement(Fa,{key:g,stateKey:`${c}\
:disclosure:${g}`,className:"content-block content-block-terminal-codex-desktop",summary:React.createElement("span",null,
"Ran commands")},E&&React.createElement("pre",{className:"content-block-pre"},E),React.createElement(sa,{actions:v.actions})):
React.createElement(Fa,{key:g,stateKey:`${c}:disclosure:${g}`,className:"content-block content-block-terminal",summary:React.
createElement(React.Fragment,null,React.createElement("span",null,w||"Terminal"),v.exit_code!=null&&React.createElement(
"span",{className:"content-block-status"},"exit ",v.exit_code))},E&&React.createElement("pre",{className:"content-block-\
pre"},E),React.createElement(sa,{actions:v.actions}))}if(x==="file_changes"){let T=wb(w);if(!!(f&&T&&!E&&(!Array.isArray(
v.files)||v.files.length===0)&&(!Array.isArray(v.actions)||v.actions.length===0)))return React.createElement("div",{key:g,
className:"content-block content-block-file-change content-block-file-change-cursor-summary"},React.createElement("span",
null,T.label),T.additions&&React.createElement("span",{className:"content-block-add"},T.additions),T.deletions&&React.createElement(
"span",{className:"content-block-del"},T.deletions));let Y=[v.files_changed!=null?`${v.files_changed} files`:null,v.additions!=
null?`+${v.additions}`:null,v.deletions!=null?`-${v.deletions}`:null].filter(Boolean).join(" ");return React.createElement(
Fa,{key:g,stateKey:`${c}:disclosure:${g}`,className:"content-block content-block-file-change",summary:React.createElement(
React.Fragment,null,React.createElement("span",null,w||"File changes",Y?` ${Y}`:""),v.status&&React.createElement("span",
{className:`content-block-status ${oe(v.status).toLowerCase()}`},v.status))},Array.isArray(v.files)&&v.files.length>0&&React.
createElement("div",{className:"content-block-file-list"},v.files.map((re,ee)=>React.createElement("div",{className:"con\
tent-block-file-row",key:re.path||ee},React.createElement("span",{className:"content-block-file-path"},re.path||"file"),
re.added!=null&&React.createElement("span",{className:"content-block-add"},"+",re.added),re.removed!=null&&React.createElement(
"span",{className:"content-block-del"},"-",re.removed)))),E&&d(E,g),React.createElement(sa,{actions:v.actions}))}if(x===
"artifact")return React.createElement("div",{key:g,className:"content-block content-block-artifact"},React.createElement(
"div",{className:"content-block-title"},w||"Artifact"),E&&d(E,g));if(x==="plan"){let T=Array.isArray(v.tasks)?v.tasks:[];
return React.createElement("div",{key:g,className:"content-block content-block-plan"},React.createElement("div",{className:"\
content-block-title"},w||"Plan"),T.length>0&&React.createElement("ol",{className:"content-block-plan-list"},T.map((U,Y)=>{
let re=oe(U?.state||U?.status||"pending").toLowerCase();return React.createElement("li",{key:U.id||Y,className:`content-\
block-plan-item ${re}`},React.createElement("span",{className:"content-block-plan-marker","aria-hidden":"true"},re==="co\
mpleted"?"\u2713":re==="in_progress"?"\u2022":"\u25CB"),React.createElement("span",null,U.text||U.step||U.title||""))})),
E&&!T.length&&d(E,g))}return x==="queued_message"?React.createElement("div",{key:g,className:"content-block content-bloc\
k-queued-message"},React.createElement("span",{className:"content-block-queued-label"},w||"Queued message"),E&&React.createElement(
"span",{className:"content-block-queued-body"},E)):x==="notice"?React.createElement("div",{key:g,className:`content-bloc\
k content-block-notice ${oe(v.tone||v.status||"info").toLowerCase()}`},React.createElement("div",{className:"content-blo\
ck-title"},w||"Notice"),E&&d(E,g),React.createElement(sa,{actions:v.actions})):x==="error"&&S?React.createElement(Fa,{key:g,
stateKey:`${c}:disclosure:${g}`,className:"content-block content-block-error content-block-error-antigravity-v2",defaultOpen:!1,
summary:React.createElement(React.Fragment,null,React.createElement("span",{className:"content-block-error-antigravity-v\
2-label"},w||"Error"),E&&React.createElement("span",{className:"content-block-error-antigravity-v2-message"},E))},React.
createElement(sa,{actions:v.actions})):x==="prompt"||x==="error"?React.createElement("div",{key:g,className:`content-blo\
ck content-block-${x}`},React.createElement("div",{className:"content-block-title"},w||x),E&&d(E,g),React.createElement(
sa,{actions:v.actions})):React.createElement("div",{key:g,className:"content-block content-block-markdown"},d(E||w,g))}))}
function Vl(e){let t=Ot(e).trim();return!(!t||t.length<4||/^[\s*._|`~•·▌]+$/.test(t)||!/[A-Za-z0-9]/.test(t))}function Bo({
message:e=null,instant:t=null}){let n=t==null?$r(e):es(t);if(!n)return React.createElement("span",{className:"message-ti\
mestamp message-timestamp-unknown","aria-label":"Sent time unknown",title:"Sent time unknown"},"Time unknown");let s=Md(
n);return React.createElement("time",{className:"message-timestamp",dateTime:n.iso,title:s,"aria-label":`Sent ${s}`},cl(
n))}function Nb(e){return typeof e=="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.
test(e)}function vm(e){if(!e)return Zl;let t=e.split("-")[0].toLowerCase();return In[t]||Zl}function Ha(e){let t=oe(e).toLowerCase();
return t?t.includes("roo code")||t.includes("roo_code")||t.includes("roo-cline")?"roo_code":t.includes("cline")||t.includes(
"claude-dev")?"cline":t.includes("continue yolo")||t.includes("continue_yolo")?"continue_yolo":t.includes("continue")?"c\
ontinue":t.includes("codex cli")||t.includes("codex_cli")?"codex_cli":t.includes("codex desktop")?"codex-desktop":t.includes(
"cursor cli")||t.includes("cursor_cli")?"cursor_cli":/\bcursor\b/.test(t)||t==="cursor"||t.includes("cursor ide")?"curso\
r":t.includes("codex")?"codex":t.includes("claude code")||t.includes("claude")?"claude":t.includes("antigravity chat")||
t.includes("antigravity_panel")?"antigravity_panel":t.includes("antigravity-v2")||t.includes("antigravity v2")?"antigrav\
ity-v2":null:null}function ym(e){if(e&&typeof e=="object"){let t=e.agent_type;return In[t]?t:Ha(e.display_name)||Ha(e.agent_type)||
Ha(e.session_title)||Ha(e.window_title)||Ha(e.chat_title)||Ha(e.session_id)}if(typeof e=="string"){let t=e.split("-")[0].
toLowerCase();return In[t]?t:Ha(e)}return null}function Pe(e){return typeof e=="string"?e:e?.session_id}function Fr(e,t){
if(e&&typeof e=="object"){let s=ym(e);return In[s]||vm(e.session_id)}let n=ym(e);return In[n]||vm(e)}function Br(e,t,n){
if(e&&typeof e=="object"){let i=Ib(e,n),c=n?.file_access_scope?n.file_access_scope.replace(/\\/g,"/").split("/").filter(
Boolean).pop():null,u=e.agent_type==="antigravity_panel"&&e.panel_title?` / ${e.panel_title}`:"",f=(i?.label||e.workspace_name||
c||e.window_title||e.workspace_path||t||"Session")+u;return e.chat_title&&!f.includes("/")?`${f} / ${e.chat_title}`:f}let s=t||
e;return typeof s!="string"?"Session":Nb(s)?"Connected session":s.split("-").slice(1).join("-")||s}function zm(e){let t=oe(
e).replace(/\\/g,"/").replace(/\/+$/,"").trim();return t?t.split("/").filter(Boolean).pop()||t:""}function dc(e){return oe(
e).replace(/\\/g,"/").replace(/\/+$/,"").trim()}function Km(e){let t=dc(e);return/^[A-Za-z]:\//.test(t)||t.startsWith("/\
/")||t.startsWith("/")}function Cb(e){let t=dc(e).toLowerCase();return/^[a-z]:\/users\/[^/]+$/.test(t)||/^[a-z]:\/users\/[^/]+\/documents$/.
test(t)||/^\/users\/[^/]+$/.test(t)||/^\/users\/[^/]+\/documents$/.test(t)||/^\/home\/[^/]+$/.test(t)}function xb(e){let t=dc(
e),n=t.match(/^[A-Za-z]:\/Users\/([^/]+)(?:\/|$)/i);if(n)return n[1];let s=t.match(/^\/(?:Users|home)\/([^/]+)(?:\/|$)/i);
return s?s[1]:""}function Ab(e,t){let n=xb(t);return!!n&&oe(e).trim().toLowerCase()===n.toLowerCase()}function uu(e){return oe(
e).replace(/\s+\(Workspace\)$/i,"").replace(/\s+-\s+(?:Visual Studio Code|Code|Cursor|Antigravity)(?:\s*\[[^\]]+\]|\s+(?:Administrator|Admin))?$/i,
"").trim()}function Vm(e){let t=oe(e).trim();return/^(?:Visual Studio Code|Code|Cursor|Antigravity)(?:\s*\[[^\]]+\]|\s+(?:Administrator|Admin))?$/i.
test(t)}function Rb(e){return/\s+-\s+(?:Visual Studio Code|Code|Cursor|Antigravity)(?:\s*\[[^\]]+\]|\s+(?:Administrator|Admin))?\s*$/i.
test(oe(e))}function Ym(e){let t=oe(e).trim();if(!t)return[];let n=t.split(/\s+-\s+/).map(s=>uu(s)).filter(Boolean);for(;n.
length&&Vm(n[n.length-1]);)n.pop();return n}var Mb=/\b(?:image|screenshot|screen\s*shot|capture)[\w .()[\]-]*\.(?:png|jpe?g|gif|webp|bmp|svg)(?:\b|[\s._-]*\d{2,}(?:\s*[x\u00d7]\s*\d{2,})?|[\s._-]*[a-z0-9]{3,})/i,
Tb=/(?:[A-Za-z]:[\\/]|\\\\[^\\/\s]+[\\/]|\/(?:Users|home|mnt|var|tmp|etc|opt|workspace|workspaces)\/)[^\s"'`<>)]{2,}/i,Xm=new Set(
["agent","agent manager","agent session","antigravity","antigravity chat","antigravity v2","claude","claude code","codex",
"codex cli","codex desktop","connected session","other","session","unknown"]),$b=new Set(Array.from(Xm,e=>e.replace(/[^a-z0-9]+/g,
"")));function Qm(e){let t=uu(e);if(!t)return"";let n=zm(t),s=/[-_]/.test(n),a=n.replace(/[-_]+/g," ");return(s||!/\s/.test(
n))&&(a=a.replace(/([a-z])([A-Z])/g,"$1 $2")),a.replace(/\s+/g," ").trim()}function Eb(e){let t=Qm(e).toLowerCase();if(!t||
/^window\s+\d+$/.test(t)||Vm(t)||Xm.has(t))return!0;let n=t.replace(/[^a-z0-9]+/g,"");return $b.has(n)}function Lb(e,t){
return oe(e).toLowerCase()===oe(t).toLowerCase()}function du(e,t){let n=Qm(e);return Eb(n)?null:{label:n,key:oe(t||n).replace(
/\\/g,"/").replace(/\/+$/,"").toLowerCase()}}function km(e){let t=dc(e);return!t||!Km(t)||Cb(t)?null:du(zm(t),t)}function wm(e){
let t=Ym(e);return t.length<2?null:du(t[t.length-1],t[t.length-1])}function Pb(e){let t=oe(e);if(Rb(t))return null;let n=uu(
e);return!n||Km(n)||Ym(n).length>=2?null:du(n,n)}function qb(e){let t=oe(e).toLowerCase().trim();return[t,t.replace(/\s+/g,
"-"),t.replace(/\s+/g,"")].filter(Boolean)}function Sm(e,t=[]){let n=e.map(a=>oe(a).toLowerCase()).filter(Boolean),s=[...t].
sort((a,i)=>i.label.length-a.label.length);for(let a of s){let i=qb(a.label);if(n.some(c=>i.some(u=>u&&c.includes(u))))return a}
return null}function Ib(e,t,n=[]){if(!e||typeof e!="object")return null;let s=Sm([e.window_title,e.workspace_name,e.chat_title,
e.session_title],n),a=[km(e.workspace_path),km(t?.file_access_scope),s,wm(e.window_title),wm(e.workspace_name),Ab(e.workspace_name,
e.workspace_path)?null:Pb(e.workspace_name)].filter(Boolean);if(a.length>0){let u=a[0];return n.find(f=>Lb(f.label,u.label))||
u}let i=[e.chat_title,e.session_title,e.title,e.display_title,e.window_title,e.workspace_name].map(u=>oe(u).toLowerCase()).
filter(Boolean),c=Sm(i,n);return c||null}function Ob(e){return Ot(e).replace(/!\[[^\]]*\]\((?:data:image\/[^)]+|\/uploads\/[^)]+|[^)]*\.(?:png|jpe?g|gif|webp|bmp|svg))\)/gi,
" ").replace(/\[File:\s*[^\]]+\]/gi," ").replace(Tb," ").replace(Mb," ").replace(/<goal_context>[\s\S]*?<\/goal_context>/gi,
" ").replace(/<[^>\n]{1,80}>/g," ").replace(/```[\s\S]*?```/g," ").replace(/`([^`]+)`/g,"$1").replace(/^\s*(?:user|assistant|codex|claude|tool result)\s*[:\-]\s*/i,
"").replace(/\s+/g," ").trim()}function Do(e,t,n,s=[]){return Od(e,e&&typeof e=="object"?e.custom_display_name:"",s)}function Nm(e){
if(!e||typeof e!="object")return null;if(e.workspace_path)return oe(e.workspace_path).toLowerCase();let t=oe(e.workspace_name||
e.window_title||"");return t&&t.split(" / ")[0].trim().toLowerCase()||null}function Db(e,t){let n=Pe(t),s=Nm(t);return s&&
(e||[]).find(a=>a&&typeof a=="object"&&a.agent_type==="antigravity_panel"&&Pe(a)!==n&&Nm(a)===s)||null}function jb(e){return!e||
typeof e!="object"?"":[e.panel_title||null,e.panel_model||null,e.panel_mode||null].filter(Boolean).join(" \xB7 ")}function Bb(e){return e==="claude"?"claude-document":e==="codex_cli"?"codex-terminal":e==="cursor"?"cursor-cards":e==="c\
odex-desktop"||e==="codex"?"codex-thread":"unified-flow"}function Cm(e){return e==="codex_cli"?"codex-cli":e==="codex"||
e==="codex-desktop"?"codex":e==="claude"||e==="claude_cli"?"claude":e==="cursor"||e==="cursor_cli"?"cursor":"default"}function Fb(e,t){
let n=oe(e).toLowerCase().replace(/\s+/g," ").trim(),s=oe(t).toLowerCase().replace(/\s+/g," ").trim();if(!s)return 0;let a=n.
indexOf(s);if(a>=0)return 2e3-Math.min(a,500)-Math.max(0,n.length-s.length)*.01;let i=0,c=0,u=-1;for(let f of s){if(f===
" ")continue;let b=n.indexOf(f,c);if(b<0)return Number.NEGATIVE_INFINITY;i+=u<0?Math.max(0,80-b):Math.max(1,24-(b-u-1)*3),
(b===0||/[\s/\\_.:-]/.test(n[b-1]))&&(i+=35),u=b,c=b+1}return i}function Hb(e,t){let n=oe(t).toLowerCase().trim().split(
/\s+/).filter(Boolean);return n.length===0?[...e]:e.map((s,a)=>{let i=n.reduce((c,u)=>{let f=Array.isArray(s.searchFields)&&
s.searchFields.length?s.searchFields:[s.searchText],b=Math.max(...f.map(k=>Fb(k,u)));return Number.isFinite(c)&&Number.isFinite(
b)?c+b:Number.NEGATIVE_INFINITY},0);return{item:s,sidebarIndex:a,score:i}}).filter(s=>Number.isFinite(s.score)).sort((s,a)=>+!!a.
item.working-+!!s.item.working||a.score-s.score||s.sidebarIndex-a.sidebarIndex).map(s=>s.item)}function tu(e){return e instanceof
Element?!!e.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]'):!1}function Ub(e,t){if(!e||!t||
e.sessionId!==t.sessionId)return 0;let n=Math.max(0,Number(t.messageCount||0)-Number(e.messageCount||0)),s=!!t.provisionalId&&
(t.provisionalId!==e.provisionalId||Number(t.provisionalLength||0)>Number(e.provisionalLength||0));return n+(s&&n===0?1:
0)}function Gb(e,t,n=!1){let[s,a]=React.useState(()=>Lo(e,t)),i=React.useMemo(()=>Up(s,e,{...t,freezeStructure:n}),[s,e,
t,n]);React.useEffect(()=>{i.ledger!==s&&a(i.ledger)},[s,i]);let c=React.useCallback(()=>{a(u=>Gp(u,e,t))},[e,t]);return{
groups:i.groups,orderChanged:i.orderChanged,sortNow:c,revision:i.ledger.revision}}function xm(e){return!e||typeof e!="ob\
ject"?"":e.visible_pane_visible?[e.visible_pane_title||null,e.visible_pane_location==="right"?"Right Pane":null].filter(
Boolean).join(" \xB7 "):jb(e)}function Jm(e){let t=oe(e);return t?t.replace(/^Gemini\s+/i,"G ").replace(/^Claude\s+/i,"").
replace(/\s*\(Thinking\)\s*/i,"").replace(/\s*\(Medium\)\s*/i,"").replace(/\s+/g," ").trim():""}function Zm(e,t=3){return!Array.
isArray(e)||e.length===0?"":e.slice(0,t).map(n=>{let s=n?.percent_used;if(s==null)return null;let a=Jm(n?.model);return a?
`${a} ${s}%`:null}).filter(Boolean).join(" \xB7 ")}function Yl(e){return e?In[e]?.name||e:""}function Fo(e){let t=oe(e).
trim();if(!t)return"";if(!/^\d{4}-\d{2}-\d{2}T/.test(t))return t;let n=new Date(t);return Number.isNaN(n.getTime())?t:n.
toLocaleString([],{weekday:"short",hour:"numeric",minute:"2-digit"})}function Wb({session:e,config:t,providerUsage:n,onOpenUsage:s}){
let[a,i]=React.useState(!1),[c,u]=React.useState(Date.now()),f=React.useRef(null),b=React.useRef(null),k=React.useMemo(()=>Tl(
n),[n]),N=React.useMemo(()=>sm(e,t,k,c),[e,t,k,c]),A=N.headerWindows.map(Gl);if(React.useEffect(()=>{if(!a)return;u(Date.
now());let g=setInterval(()=>u(Date.now()),3e4);return()=>clearInterval(g)},[a]),React.useEffect(()=>{if(!a)return;let g=(E=!1)=>{
i(!1),E&&requestAnimationFrame(()=>f.current?.focus({preventScroll:!0}))},x=E=>{f.current?.contains(E.target)||b.current?.
contains(E.target)||g(!1)},w=E=>{E.key==="Escape"&&(E.preventDefault(),g(!0))};return document.addEventListener("pointer\
down",x),document.addEventListener("keydown",w),requestAnimationFrame(()=>b.current?.querySelector("button")?.focus({preventScroll:!0})),
()=>{document.removeEventListener("pointerdown",x),document.removeEventListener("keydown",w)}},[a]),!N.supported)return null;
let S=N.state==="local"?"Local":N.state==="exhausted"?"Limit":A[0]?.compactValue||"Usage ?",M=El(N.credits),d=Ll(N.financials),
v=()=>{i(!1),s()};return React.createElement("div",{className:`session-usage-mini tone-${N.tone} state-${N.state}`,"data\
-testid":"session-usage-mini"},React.createElement("button",{ref:f,type:"button",className:"session-usage-mini-trigger",
"aria-expanded":a,"aria-controls":"session-usage-popover",title:`${N.billingProviderName}: ${S}`,onClick:()=>i(g=>!g)},React.
createElement(Ji,{providerId:N.providerMarkId,providerName:N.billingProviderName}),React.createElement("span",{className:"\
session-usage-mini-rows"},N.state==="local"?React.createElement("span",{className:"session-usage-mini-row"},React.createElement(
"strong",null,"Local"),React.createElement("em",null,"no plan limit")):A.length>0?A.map((g,x)=>React.createElement("span",
{className:`session-usage-mini-row ${g.tone}`,key:`${g.label}:${x}`},React.createElement("strong",null,g.label),React.createElement(
"em",null,g.compactValue),React.createElement("i",{"aria-hidden":"true"},React.createElement("b",{style:{width:`${Math.max(
0,Math.min(100,Number(g.usedPercent)||0))}%`}})))):React.createElement("span",{className:"session-usage-mini-row unavail\
able"},React.createElement("strong",null,"Usage"),React.createElement("em",null,N.state==="ambiguous"?"ambiguous":"unava\
ilable"))),React.createElement("span",{className:"session-usage-mini-compact"},S)),a&&React.createElement("div",{ref:b,id:"\
session-usage-popover",className:"session-usage-popover",role:"dialog","aria-modal":"false","aria-label":"Session usage \
details"},React.createElement("div",{className:"session-usage-popover-heading"},React.createElement(Ji,{providerId:N.providerMarkId,
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
map((g,x)=>{let w=Gl(g);return React.createElement("div",{className:`session-usage-popover-window ${w.tone}`,key:`${g.id}\
:${x}`},React.createElement("span",null,React.createElement("strong",null,w.label),React.createElement("em",null,w.usedPercent==
null?"Usage unavailable":`${Xt(w.usedPercent)} used \xB7 ${w.compactValue}`)),React.createElement("i",{"aria-hidden":"tr\
ue"},React.createElement("b",{style:{width:`${Math.max(0,Math.min(100,Number(w.usedPercent)||0))}%`}})),React.createElement(
"small",null,w.reset?`Resets ${Da(w.reset,c)}`:"Reset not reported",g.modelScope?.label?` \xB7 ${g.modelScope.label}`:""))})):
React.createElement("div",{className:`session-usage-popover-state ${N.state}`},React.createElement("strong",null,N.message),
React.createElement("span",null,"No percentage or $0 value is inferred.")),(M||d.length>0)&&React.createElement("div",{className:"\
session-usage-popover-financial"},React.createElement("strong",null,"Credits / overage"),M&&React.createElement("span",null,
M),d.map(g=>React.createElement("span",{key:g.id},g.label,": ",g.value))),React.createElement("div",{className:"session-\
usage-popover-source"},React.createElement("span",null,N.source||"Source unavailable"," \xB7 ",Oa(N.capturedAt,c)),React.
createElement("span",null,"Generation ",N.generation," \xB7 ",N.freshness)),React.createElement("button",{type:"button",
className:"session-usage-open-dashboard",onClick:v},"Open Usage & limits")))}function ef(e){return!e||typeof e!="object"?
"":oe(e.host_label||(e.host_type==="vscode"?"VS Code":e.host_type==="antigravity_ide"?"Antigravity IDE":""))}var zb={healthy:"\
#3fb950",degraded:"#d29922",disconnected:"#f85149"},Am={thinking:{icon:"\u25CC",tone:"thinking"},generating:{icon:"\u2726",
tone:"thinking"},reading_files:{icon:"\u229E",tone:"info"},running_command:{icon:">",tone:"info"},applying_patch:{icon:"\
\u0394",tone:"info"},waiting_for_user:{icon:"?",tone:"idle"},idle:{icon:"\xB7",tone:"idle"},working:{icon:"\u2022",tone:"\
info"}};function jo({agentType:e,compact:t=!1,animate:n=!0}){let s=String(e||"default").toLowerCase(),a=n?"":" static";return s===
"claude"||s==="claude_cli"?React.createElement("span",{className:`native-activity-spinner claude${t?" compact":""}${a}`},
n?React.createElement(iv,null):React.createElement("span",{className:"claude-spinner-icon"},lc[0])):s==="codex"||s==="co\
dex-desktop"||s==="codex_cli"?React.createElement("span",{className:`native-activity-spinner codex${t?" compact":""}${a}`,
"aria-label":"Working"},"\u25CC"):s==="cursor"?React.createElement("span",{className:`native-activity-spinner cursor${t?
" compact":""}${a}`,"aria-label":"Generating"},React.createElement("i",null),React.createElement("i",null),React.createElement(
"i",null)):React.createElement("span",{className:`native-activity-spinner generic${t?" compact":""}${a}`},React.createElement(
"i",null))}function Rm(e){let t=String(e||"Send failed").trim(),n=t.toLowerCase();return n.includes("pending_revalidatio\
n")||n.includes("fixture version mismatch")||n.includes("validation pending")?"Update validation pending":n.includes("ag\
ent_busy")||n.includes("agent is generating")?"Agent busy":n.includes("codex_desktop_thread_not_open")||n.includes("code\
x_desktop_thread_changed")||n.includes("open this thread")?"Open this thread in Codex Desktop":n.includes("native_user_t\
urn_not_observed")||n.includes("native user turn")||n.includes("could not confirm native delivery")?"Could not confirm n\
ative delivery":n.includes("input_verify_failed")||n.includes("composer input could not be verified")||n.includes("verif\
ied send-ready state")?"Composer input could not be verified":n==="send_failed"?"Send failed":t.length>80?`${t.slice(0,77)}\
\u2026`:t}function Kb({msg:e,deliveryStates:t,onSteer:n,onRetry:s}){if(e._optimistic){let a=t[e._cid]||"queued";if(a==="\
offline_queued")return React.createElement("span",{className:"delivery offline-queued",title:"Queued until relay reconne\
cts","aria-label":"Queued offline"},"offline");if(a==="queued")return React.createElement("span",{className:"delivery qu\
eued",title:"Sending\u2026","aria-label":"Sending to relay"},"\xB7\xB7\xB7");if(a==="busy_queued")return React.createElement(
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
g","aria-label":"Agent started working"},"\u25B6");if(a==="failed"){let i=e._sendError||"Agent may be offline",c=Rm(i);return React.
createElement("span",{className:"delivery failed",title:i,"aria-label":`Send failed: ${c}`},React.createElement("span",{
"aria-hidden":"true"},"\u2715"),React.createElement("span",{className:"delivery-failure-reason"},c),s&&React.createElement(
"button",{type:"button",className:"delivery-retry",onClick:u=>{u.stopPropagation(),s(e)}},"Retry"))}}if(e._agentStarted||
e.status==="agent_started")return React.createElement("span",{className:"delivery agent-started",title:"Agent started wo\
rking","aria-label":"Agent started working"},"\u25B6");if(e._delivered||e.status==="delivered")return React.createElement(
"span",{className:"delivery delivered",title:"Native user turn observed","aria-label":"Native user turn delivered"},"\u2713\u2713");
if(e.status==="failed"){let a=e.failure_code||e._sendError||"Send failed",i=Rm(a);return React.createElement("span",{className:"\
delivery failed",title:a,"aria-label":`Send failed: ${i}`},React.createElement("span",{"aria-hidden":"true"},"\u2715"),React.
createElement("span",{className:"delivery-failure-reason"},i))}return e._launchAcceptedAt||e.launch_accepted_at?React.createElement(
"span",{className:"delivery launch-accepted",title:"Native launch accepted; user-turn receipt pending","aria-label":"Nat\
ive launch accepted; user-turn receipt pending"},"\u2197"):e.status==="accepted"?React.createElement("span",{className:"\
delivery accepted",title:"Received by relay; native receipt pending","aria-label":"Relay accepted; native receipt pendin\
g"},"\u2713"):React.createElement("span",{className:"delivery recorded",title:"Recorded \u2014 native delivery receipt unknow\
n","aria-label":"Recorded; native delivery receipt unknown"},"Recorded")}function Vb(e,t=!1){let[n,s]=React.useState(()=>Dl(
e)),a=React.useMemo(()=>jp(n,e,{freezeStructure:t}),[n,e,t]);return React.useEffect(()=>{a.ledger!==n&&s(a.ledger)},[n,a]),
{sessions:a.sessions,revision:a.ledger.revision,deferred:a.deferred}}function Yb(e,t){let[n,s]=React.useState(Date.now());
return React.useEffect(()=>{let a=Date.now(),c=[...Object.values(e||{}),...Array.isArray(t)?t.map(f=>f?.activity):[]].reduce(
(f,b)=>{let k=qi(b),N=k?k+bl:0;return N<=a?f:f===0?N:Math.min(f,N)},0);if(!c)return;let u=setTimeout(()=>s(Date.now()),Math.
max(25,c-a+25));return()=>clearTimeout(u)},[e,t,n]),n}function Xb({stream:e,activeAgent:t,monospace:n}){let s=Te(null),a=Te(
"");return ra(()=>{let i=s.current;if(!i)return;let c=String(e?.content||""),u=a.current;if(c.startsWith(u)){let f=c.slice(
u.length);f&&i.appendChild(document.createTextNode(f))}else i.textContent=c;a.current=c},[e?.content]),React.createElement(
"div",{className:`message assistant live-draft provisional-stream${n?" monospace":""}`,"data-message-id":e?.messageId||"\
awaiting-first-delta","data-message-role":"assistant","data-message-timestamp":es(e?.startedAtMs)?.iso||void 0,"data-str\
eam-open":e?.open?"true":"false"},React.createElement("div",{className:"assistant-gutter"},React.createElement("div",{className:"\
agent-badge transcript-agent-badge",style:{color:t.color,borderColor:t.color+"55",background:t.color+"18"}},t.logo?React.
createElement("img",{src:t.logo,alt:t.abbr,className:"agent-badge-logo"}):t.abbr)),React.createElement("div",{className:"\
assistant-content"},React.createElement("div",{className:"message-role"},React.createElement("span",{className:"message-\
role-label"},t.name),React.createElement(Bo,{instant:e?.startedAtMs})),React.createElement("div",{className:"provisional\
-stream-text",ref:s}),e?.open&&React.createElement("span",{className:"provisional-stream-caret","aria-label":"Streaming \
response"})))}function Qb({msg:e,messageKey:t,activeAgent:n,assistantMonospace:s,autoExpandLongCodeBlocks:a,onOpenPath:i,
agentType:c,preview:u,fileContents:f,onClosePreview:b,deliveryState:k,onSteer:N,onRetry:A,richContentEager:S,searchMatch:M=!1}){
let d=Ot(e.content)||Ho(e.content_blocks),v=_b(e.content),g=$r(e),x=e.role!=="user"&&Hr(e.content_blocks).length>0,w=e.source_message_id||
e.native_source_id||"",E=fb(e),T=gb(e);if(e.role==="user"){let U=e._cid?{[e._cid]:k}:{};return React.createElement("div",
{className:`message user transcript-virtual-row${e._optimistic&&k==="failed"?" failed":""}${M?" search-match":""}`,"data\
-message-key":t,"data-message-id":e.id||void 0,"data-message-role":"user","data-message-block-type":T,"data-message-cont\
ent-hash":E,"data-message-source-id":w||void 0,"data-message-timestamp":g?.iso||"unknown"},React.createElement("div",{className:"\
user-gutter"},React.createElement("div",{className:"user-glyph"})),React.createElement("div",{className:"user-content"},
React.createElement("div",{className:"message-role"},React.createElement("span",{className:"message-role-label"},"You"),
React.createElement(Bo,{message:e}),React.createElement(Kb,{msg:e,deliveryStates:U,onSteer:N,onRetry:A})),/!\[[^\]]*\]\((?:data:|\/uploads\/)/.
test(v)?React.createElement("div",{className:"user-text"},React.createElement(Tr,{content:v,deferUntilVisible:!S,cacheIdentity:`${t}\
:user`})):React.createElement("div",{className:"user-text"},d)))}return React.createElement("div",{className:`message as\
sistant transcript-virtual-row${s?" monospace":""}${M?" search-match":""}`,"data-message-key":t,"data-message-id":e.id||
void 0,"data-message-role":"assistant","data-message-block-type":T,"data-message-content-hash":E,"data-message-source-id":w||
void 0,"data-message-timestamp":g?.iso||"unknown"},React.createElement("div",{className:"assistant-gutter"},React.createElement(
"div",{className:"agent-badge transcript-agent-badge",style:{color:n.color,borderColor:n.color+"55",background:n.color+"\
18"}},n.logo?React.createElement("img",{src:n.logo,alt:n.abbr,className:"agent-badge-logo"}):n.abbr)),React.createElement(
"div",{className:"assistant-content"},React.createElement("div",{className:"message-role"},React.createElement("span",{className:"\
message-role-label"},n.name),React.createElement(Bo,{message:e})),x?React.createElement(Sb,{blocks:e.content_blocks,monospace:s,
autoExpandLongCodeBlocks:a,onOpenPath:U=>i(t,U),agentType:c,richContentEager:S,richContentCacheIdentity:t}):React.createElement(
Tr,{content:Ot(e.content),monospace:s,autoExpandLongCodeBlocks:a,onOpenPath:U=>i(t,U),deferUntilVisible:!S,cacheIdentity:`${t}\
:assistant`}),u&&React.createElement(Dv,{sessionId:u.sessionId,filePath:u.path,fileContents:f,onClose:b})))}function Mm(e){
return e?`${e.sessionId}${e.messageKey}${e.path}`:""}function nu(e){return[e?.name,e?.color,e?.abbr,e?.logo||""].join(
"")}function Jb(e,t){return e.msg===t.msg&&e.messageKey===t.messageKey&&e.assistantMonospace===t.assistantMonospace&&e.
autoExpandLongCodeBlocks===t.autoExpandLongCodeBlocks&&e.agentType===t.agentType&&nu(e.activeAgent)===nu(t.activeAgent)&&
Mm(e.preview)===Mm(t.preview)&&e.fileContents===t.fileContents&&e.deliveryState===t.deliveryState&&e.onRetry===t.onRetry&&
e.richContentEager===t.richContentEager&&e.searchMatch===t.searchMatch}var Zb=React.memo(Qb,Jb),ev=100,sc=1200,Cs=32;function Tm(e){
let t=Ot(e?.content)||Ho(e?.content_blocks),n=Math.max(1,oe(t).split(`
`).length);if(e?.role==="user")return Math.min(180,40+Math.max(0,n-1)*18);let s=Math.ceil(oe(t).length/100),a=Hr(e?.content_blocks).
length*28;return Math.min(420,68+Math.max(n,s)*18+a)}function ac(e,t){let n=0,s=Math.max(0,e.length-1);for(;n<s;){let a=Math.
floor((n+s)/2);e[a]<=t?n=a+1:s=a}return Math.max(0,n-1)}function tv({index:e,messageKey:t,onMeasure:n,children:s}){let a=React.
useRef(null);return React.useLayoutEffect(()=>{let i=a.current;if(!i)return;let c=()=>n(e,t,i.getBoundingClientRect().height,
i);if(c(),typeof ResizeObserver>"u")return;let u=new ResizeObserver(c);return u.observe(i),()=>u.disconnect()},[e,t,n]),
React.createElement("div",{className:"transcript-window-row","data-window-index":e,ref:a},s)}function nv({messages:e,containerRef:t,
sessionId:n,routeActive:s,suppressProgrammaticScrollRef:a}){let i=s&&e.length>ev,c=React.useRef(i);c.current=i;let u=React.
useRef(new Map),f=React.useRef(n);f.current!==n&&(u.current.clear(),f.current=n);let b=React.useRef([0]),k=React.useRef(
null),N=React.useRef(null),A=React.useRef(0),S=React.useRef(0),M=React.useRef({sessionId:null,keys:[],prefix:[0]}),d=React.
useRef(0),v=React.useRef(0),g=React.useRef(null),x=React.useRef(null),w=React.useRef(0),E=React.useRef(0),[T,U]=React.useState(
0),[Y,re]=React.useState({sessionId:null,start:0,end:0}),ee=React.useCallback(()=>a?.current?.()!==!0,[a]),ae=React.useMemo(
()=>e.map((J,q)=>`${n||""}${lu(J,q)}`),[e,n]),W=React.useMemo(()=>{let J=new Array(e.length+1);J[0]=0;for(let q=0;q<e.length;q+=
1){let G=u.current.get(ae[q]);J[q+1]=J[q]+(G||Tm(e[q]))}return J},[e,ae,T]);b.current=W;let ie=React.useCallback(()=>{if(N.
current)return;let J=t.current;if(!i||!J)return;let q=J.getBoundingClientRect(),G=q.top,te=Array.from(J.querySelectorAll(
".transcript-window-row[data-window-index]")),$=te.find(fe=>{let be=fe.getBoundingClientRect();return be.top>=G&&be.top<
q.bottom})||te.find(fe=>fe.getBoundingClientRect().bottom>G)||te[0];if(!$)return;let H=Number($.dataset.windowIndex);!Number.
isInteger(H)||!ae[H]||(k.current={sessionId:n,key:ae[H],viewportOffset:$.getBoundingClientRect().top-G})},[t,i,ae,n]),ge=React.
useCallback(()=>{g.current=null,x.current=null,w.current&&clearTimeout(w.current),w.current=0},[]),X=React.useCallback(()=>{
let J=t.current;if(!i||!J)return;let q=N.current;if(q?.sessionId===n){let He=ae.indexOf(q.key);if(He>=0){re(ce=>ce.sessionId===
n&&ce.start===He&&ce.end===Math.min(e.length,He+Cs)?ce:{sessionId:n,start:He,end:Math.min(e.length,He+Cs)});return}}ie();
let G=b.current,te=Math.max(0,J.scrollTop-sc),$=J.scrollTop+J.clientHeight+sc,H=Math.max(0,ac(G,te)-1),fe=Math.min(e.length,
ac(G,$)+2),be=fe>=e.length?Math.max(0,e.length-Cs):H,_e=fe,Ne=x.current,Le=Ne?ae.indexOf(Ne):g.current;Le>=0&&(g.current=
Le);let Ae=Le;Number.isInteger(Ae)&&Ae>=0&&Ae<e.length&&(be=Math.min(be,Math.max(0,Ae-Cs)),_e=Math.max(_e,Math.min(e.length,
Ae+Cs+1))),React.startTransition(()=>{re(He=>He.sessionId===n&&He.start===be&&He.end===_e?He:{sessionId:n,start:be,end:_e})})},
[ie,t,i,ae,e.length,n]);React.useLayoutEffect(()=>{let J=M.current;if(M.current={sessionId:n,keys:ae,prefix:W},!i||J.sessionId!==
n||!J.keys.length){N.current?.routeRestore||(N.current=null),A.current&&clearTimeout(A.current),A.current=0,ie();return}
let q=k.current;if(!q||q.sessionId!==n||!q.key)return;let G=J.keys.indexOf(q.key),te=ae.indexOf(q.key);if(G<0||te<0||G===
te)return;let $=t.current;if(!$)return;let H=J.prefix[G]||0,fe=W[te]||0;N.current={sessionId:n,key:q.key,viewportOffset:q.
viewportOffset},g.current=te,x.current=q.key,A.current&&clearTimeout(A.current),A.current=setTimeout(()=>{N.current=null,
A.current=0,ge(),ie()},1500),re({sessionId:n,start:te,end:Math.min(e.length,te+Cs)}),ee()?gn($,Math.max(0,$.scrollTop+fe-
H)):(N.current=null,ge())},[ie,t,i,ae,ee,e.length,W,ge,n]),React.useLayoutEffect(()=>{let J=N.current;if(!J||J.sessionId!==
n)return;let q=ae.indexOf(J.key);if(q<Y.start||q>=Y.end)return;let G=t.current,te=G?.querySelector(`.transcript-window-r\
ow[data-window-index="${q}"]`);if(!G||!te)return;if(!ee()){N.current=null,ge(),ie();return}if(J.atBottom){gn(G,G.scrollHeight),
k.current=J;return}let H=te.getBoundingClientRect().top-G.getBoundingClientRect().top-J.viewportOffset;Math.abs(H)>=.5&&
gn(G,Math.max(0,G.scrollTop+H)),k.current=J},[ie,t,i,ae,ee,W,Y,ge,n]),React.useLayoutEffect(()=>{let J=N.current;if(!i||
!J?.routeRestore)return;if(!ee()){N.current=null,ge(),ie();return}let q=!0,G=()=>{if(!q)return;let te=N.current,$=t.current;
if(!te?.routeRestore||te.sessionId!==n||!$)return;if(!ee()){N.current=null,ge();return}let H=ae.indexOf(te.key),fe=H>=0?
$.querySelector(`.transcript-window-row[data-window-index="${H}"]`):null;if(fe)if(te.atBottom)gn($,$.scrollHeight);else{
let _e=fe.getBoundingClientRect().top-$.getBoundingClientRect().top-te.viewportOffset;Math.abs(_e)>=.5&&gn($,Math.max(0,
$.scrollTop+_e))}S.current=requestAnimationFrame(G)};return G(),A.current&&clearTimeout(A.current),A.current=setTimeout(
()=>{N.current=null,A.current=0,S.current&&cancelAnimationFrame(S.current),S.current=0,ge(),ie()},1500),()=>{q=!1,S.current&&
cancelAnimationFrame(S.current),S.current=0}},[ie,t,i,ae,ee,ge,n]),React.useLayoutEffect(()=>{if(!i){ge();return}let J=t.
current;if(!J)return;X();let q=()=>{ie();let G=x.current,te=G?ae.indexOf(G):g.current;te>=0&&(g.current=te);let $=te,H=b.
current;if(Number.isInteger($)&&$>=0&&$<e.length){let fe=H[$]||0,be=H[$+1]||fe,_e=J.scrollTop,Ne=_e+J.clientHeight;(be<_e-
sc||fe>Ne+sc)&&ge()}v.current||(v.current=requestAnimationFrame(()=>{v.current=0,X()}))};return J.addEventListener("scro\
ll",q,{passive:!0}),()=>{J.removeEventListener("scroll",q),v.current&&cancelAnimationFrame(v.current),v.current=0}},[ie,
i,s,n,ae,e.length,X,ge]),React.useLayoutEffect(()=>{i&&X()},[i,W,X]);let we=React.useCallback((J,q,G,te=null)=>{if(!c.current)
return;let $=Math.max(1,Math.ceil(G)),H=u.current.get(q)||Tm(e[J]),fe=typeof window<"u"?window.__RAC_TEMPORAL_CANARY__:null;
if(fe?.active){let Ne=fe.transcriptMeasurements||(fe.transcriptMeasurements=[]);if(Ne.length<4e3&&Math.abs($-H)>=1){let Le=t.
current,Ae=te?.querySelector?.(".message[data-message-key]")||null,He=Ae?.getBoundingClientRect?.()||null,ce=te?.getBoundingClientRect?.()||
null;Ne.push({at_epoch_ms:Date.now(),index:J,key:q,rendered_window_index:Number(te?.dataset?.windowIndex??J),rendered_message_key:Ae?.
dataset?.messageKey||null,rendered_message_role:Ae?.dataset?.messageRole||null,rendered_message_height_px:He?Number(He.height.
toFixed(3)):null,rendered_message_top_px:He?Number(He.top.toFixed(3)):null,wrapper_top_px:ce?Number(ce.top.toFixed(3)):null,
raw_height_px:Number(G.toFixed(3)),next_height_px:$,previous_height_px:H,delta_px:$-H,anchor_index:Le?ac(b.current,Le.scrollTop):
null,scroll_top:Le?.scrollTop??null})}}if(Math.abs($-H)<1)return;u.current.set(q,$);let be=t.current,_e=be?ac(b.current,
be.scrollTop):0;J<_e&&(E.current+=$-H),!d.current&&(d.current=requestAnimationFrame(()=>{if(d.current=0,!c.current){E.current=
0;return}let Ne=t.current,Le=E.current;E.current=0,Ne&&Math.abs(Le)>=1&&ee()&&gn(Ne,Math.max(0,Ne.scrollTop+Le)),U(Ae=>Ae+
1)}))},[t,ee,e]);React.useLayoutEffect(()=>{i||!d.current||(cancelAnimationFrame(d.current),d.current=0,E.current=0)},[i]),
React.useEffect(()=>()=>{d.current&&cancelAnimationFrame(d.current),v.current&&cancelAnimationFrame(v.current),w.current&&
clearTimeout(w.current),A.current&&clearTimeout(A.current),S.current&&cancelAnimationFrame(S.current)},[]);let ve=React.
useCallback((J,q="center")=>{let G=t.current,te=b.current;if(!G||J<0||J>=e.length)return!1;g.current=J,x.current=ae[J]||
null,w.current&&clearTimeout(w.current),w.current=setTimeout(()=>{ge()},1500);let $=te[J]||0,H=te[J+1]||$,fe=q==="start"?
$:q==="end"?H-G.clientHeight:$-Math.max(0,(G.clientHeight-(H-$))/2);gn(G,Math.max(0,fe));let be=Math.max(0,J-Cs),_e=Math.
min(e.length,J+Cs+1);return re({sessionId:n,start:be,end:_e}),!0},[t,ae,e.length,ge,n]),Z=React.useCallback(()=>{ie();let J=k.
current;if(!J||J.sessionId!==n)return!1;let q=ae.indexOf(J.key);return q<0?!1:(g.current=q,x.current=J.key,!0)},[ie,ae,n]),
Se=React.useCallback(()=>{let J=t.current;if(!i||!J)return!1;ie();let q=k.current;if(!q||q.sessionId!==n||!q.key)return!1;
let G=ae.indexOf(q.key);return G<0?!1:(N.current={...q,routeRestore:!0,atBottom:J.scrollHeight-J.scrollTop-J.clientHeight<
80},g.current=G,x.current=q.key,!0)},[ie,t,i,ae,n]),Q=React.useCallback(()=>N.current?.routeRestore?(N.current=null,A.current&&
clearTimeout(A.current),A.current=0,S.current&&cancelAnimationFrame(S.current),S.current=0,ge(),ie(),!0):!1,[ie,ge]),de=0,
pe=e.length;return i&&(Y.sessionId===n&&Y.end>Y.start?(de=Y.start,pe=Y.end):de=Math.max(0,e.length-Cs)),{enabled:i,start:de,
end:pe,totalHeight:W[W.length-1]||0,topSpacerHeight:i&&W[de]||0,bottomSpacerHeight:i?W[W.length-1]-(W[pe]||0):0,onMeasure:we,
scrollToIndex:ve,prepareForPrepend:Z,prepareForRouteChange:Se,cancelRouteRestore:Q}}function sv({qm:e,onSteer:t,onDiscard:n,
onEdit:s}){let[a,i]=React.useState(!1),[c,u]=React.useState(!1),[f,b]=React.useState(e.content),k=React.useRef(null);return React.
useEffect(()=>{if(!a)return;let N=A=>{k.current&&!k.current.contains(A.target)&&i(!1)};return document.addEventListener(
"mousedown",N),()=>document.removeEventListener("mousedown",N)},[a]),c?React.createElement("div",{className:"queued-item\
 editing"},React.createElement("textarea",{className:"queued-edit-input",value:f,onChange:N=>b(N.target.value),onKeyDown:N=>{
N.key==="Enter"&&!N.shiftKey&&(N.preventDefault(),s(f),u(!1)),N.key==="Escape"&&u(!1)},rows:2,autoFocus:!0}),React.createElement(
"button",{className:"steer-btn",onClick:()=>{s(f),u(!1)}},"Save"),React.createElement("button",{className:"queued-trash-\
btn",onClick:()=>u(!1),title:"Cancel"},"\u2715")):e.native?React.createElement("div",{className:"queued-item native"},React.
createElement("span",{className:"queued-item-text"},e.content),e.status&&e.status!=="queued"&&React.createElement("span",
{className:`queued-item-status ${e.status}`},e.status),React.createElement("div",{className:"queued-actions"},React.createElement(
"button",{className:"steer-btn",onClick:t,title:"Click Steer in Codex"},"Steer \u25B8"),React.createElement("button",{className:"\
queued-trash-btn",onClick:n,title:"Delete queued message"},"\u{1F5D1}"))):React.createElement("div",{className:"queued-i\
tem"},React.createElement("span",{className:"queued-item-text"},e.content),React.createElement("div",{className:"queued-\
actions"},React.createElement("button",{className:"steer-btn",onClick:t,title:"Send to agent now"},"Steer \u25B8"),React.
createElement("button",{className:"queued-trash-btn",onClick:n,title:"Discard message"},"\u{1F5D1}"),React.createElement(
"div",{className:"queued-menu-wrap",ref:k},React.createElement("button",{className:"queued-more-btn",onClick:()=>i(!a),title:"\
More options"},"\xB7\xB7\xB7"),a&&React.createElement("div",{className:"queued-dropdown"},React.createElement("button",{
onClick:()=>{i(!1),b(e.content),u(!0)}},"\u270F Edit message"),React.createElement("button",{onClick:()=>{i(!1),n()}},"\u{1F5D1}\
 Discard")))))}function av({session:e,health:t,unread:n,isThinking:s,isActive:a,agentConfig:i,activity:c,sessionMessages:u,
hasBlockingPrompt:f,blockingPromptLabel:b,muted:k,pinned:N,workspaceLabel:A,recentMessageAt:S,menuOpen:M,onMenuToggle:d,
onSelect:v,onClose:g,onManage:x,onPinChange:w,onAutomations:E,showAutomationsActive:T,onSkills:U,showSkillsActive:Y}){let re=Pe(
e),ee=Fr(e,i),ae=Br(e,re,i),W=Do(e,re,i,u),ie=[W,ae||ee.name].filter(Boolean).join(" - "),ge=zb[t]||"#444c56",X=e?.rate_limited_until||
null,we=e?.rate_limit_active===!0,ve=e?.percent_used,Z=e?.agent_type==="antigravity"||e?.agent_type==="antigravity_panel",
Se=Z?Zm(e?.antigravity_quota_models,3):"",Q=Oi(c,{health:t}),de=s?Q||c?.label||"Working":null,pe=ef(e),J=A?`${ee.name} /\
 ${A}`:ee.name,q=S?es(S):null;return React.createElement("div",{className:`session-card${a?" active":""}${we?" rate-limi\
ted":""}${N?" pinned":""}`,"data-session-id":re,"data-last-message-at":q?.iso||void 0,onClick:v,onKeyDown:G=>{G.target!==
G.currentTarget||!["Enter"," "].includes(G.key)||(G.preventDefault(),v())},tabIndex:0,"aria-label":`${W}. ${ae||ee.name}`,
title:ie||re},React.createElement("div",{className:"session-card-badge-wrap"},React.createElement("div",{className:"agen\
t-badge",style:{color:ee.color,borderColor:ee.color+"55",background:ee.color+"18"}},ee.logo?React.createElement("img",{src:ee.
logo,alt:ee.abbr,className:"agent-badge-logo"}):ee.abbr),React.createElement("div",{className:"session-card-health",style:{
background:ge},title:t||"unknown"}),k&&React.createElement("span",{className:"session-card-muted",title:"Notifications m\
uted","aria-label":"Notifications muted"},"M"),N&&React.createElement("button",{type:"button",className:"session-card-pi\
n-toggle",title:`Unpin ${W}`,"aria-label":`Unpin ${W}`,"aria-pressed":"true",onClick:G=>{G.preventDefault(),G.stopPropagation(),
w?.(!1)}},React.createElement("span",{"aria-hidden":"true"},"\u{1F4CC}")),React.createElement("span",{className:"session\
-card-attention-slot"},f&&React.createElement("span",{className:"session-card-perm-badge",title:b||"Action required"},"\u26A0"),
!f&&we&&React.createElement("span",{className:"session-card-perm-badge",title:"Usage limited"},"\u23F3"),!f&&!we&&s&&React.
createElement("span",{className:"session-card-native-status",title:de||"Thinking\u2026"},React.createElement(jo,{agentType:e?.
agent_type,compact:!0,animate:!1})),!s&&!f&&!we&&n>0&&React.createElement("span",{className:"session-card-badge"},n>99?"\
99+":n))),React.createElement("div",{className:"session-card-body"},React.createElement(Qi,{title:W,disclosureKey:re,kind:"\
session",wrapperClassName:"session-title-details",triggerClassName:"session-card-name",disclosureClassName:"session-titl\
e-disclosure",triggerLabel:`Show full title: ${W}`,triggerTag:"div"}),React.createElement("div",{className:`session-card\
-sub${f?" perm-active":""}${q?" has-recent-message":""}`},React.createElement("span",{className:"session-card-sub-contex\
t"},f?`${J} \xB7 ${b||"Action required"}`:we?`${J} \xB7 \u23F3 Usage limited${X&&X!=="unknown"?` \xB7 resets ${Fo(X)}`:"\
 \xB7 reset unknown"}`:Se?`${J} \xB7 ${Se}`:Z&&ve!=null?`${J} \xB7 \u{1F4CA} ${ve}% used${X&&X!=="unknown"?` \xB7 ${X}`:
""}`:ve>=75?`${J} \xB7 \u{1F4CA} ${ve}% used${X&&X!=="unknown"?` \xB7 resets ${Fo(X)}`:""}`:de?`${J} \xB7 ${de}`:pe?`${J}\
 \xB7 ${pe}`:J),q&&React.createElement(React.Fragment,null,React.createElement("span",{"aria-hidden":"true"}," \xB7 "),React.
createElement("time",{dateTime:q.iso},cl(q))))),React.createElement("div",{className:"session-card-right"},React.createElement(
"details",{className:"session-card-menu",open:M,onToggle:G=>d?.(G.currentTarget.open),onClick:G=>G.stopPropagation()},React.
createElement("summary",{className:"session-card-manage",title:"Session actions","aria-label":`Session actions for ${W}`},
"\u22EF"),React.createElement("div",{className:"session-card-menu-popover",role:"menu","aria-label":`Actions for ${W}`},
React.createElement("button",{role:"menuitem",onClick:()=>w?.(!N)},N?"Unpin chat":"Pin chat"),React.createElement("butto\
n",{role:"menuitem",onClick:()=>x&&x()},"Manage session"),E&&React.createElement("button",{role:"menuitem",className:T?"\
active":"",onClick:()=>E()},"Automations"),U&&React.createElement("button",{role:"menuitem",className:Y?"active":"",onClick:()=>U()},
"Skills"),React.createElement("button",{role:"menuitem",className:"danger",onClick:()=>g&&g()},"Close session")))))}function $m(e){
let t=Array.isArray(e)?e:[];if(!t.length)return"0";let n=t[0],s=t[t.length-1];return[t.length,n?.role||"",oe(n?.content).
slice(0,120),s?.role||"",oe(s?.content).slice(0,120)].join("")}function Em(e){return e?[e.model_id||"",e.effort||"",e.permission_mode||
"",e.file_access_scope||""].join(""):""}function Lm(e){return e?[e.kind||"",e.label||"",e.goal?.status||"",e.goal?.label||
"",e.goal_run?.lifecycle||"",e.goal_run?.lease_active===!0?"leased":"released",e.goal_run?.transition_id||""].join(""):
""}function rv(e,t){return e.session===t.session&&e.health===t.health&&e.unread===t.unread&&e.isThinking===t.isThinking&&
e.isActive===t.isActive&&e.hasBlockingPrompt===t.hasBlockingPrompt&&e.blockingPromptLabel===t.blockingPromptLabel&&e.muted===
t.muted&&e.pinned===t.pinned&&e.workspaceLabel===t.workspaceLabel&&e.recentMessageAt===t.recentMessageAt&&e.menuOpen===t.
menuOpen&&e.showAutomationsActive===t.showAutomationsActive&&e.showSkillsActive===t.showSkillsActive&&Em(e.agentConfig)===
Em(t.agentConfig)&&Lm(e.activity)===Lm(t.activity)&&$m(e.sessionMessages)===$m(t.sessionMessages)}var ov=React.memo(av,rv),
Pm=["\xB7","\u2722","*","\u2736","\u273B","\u273D"],lc=[...Pm,...[...Pm].reverse()];function iv(){let[e,t]=React.useState(
0),[n,s]=React.useState(()=>typeof window<"u"&&typeof window.matchMedia=="function"&&window.matchMedia("(prefers-reduced\
-motion: reduce)").matches);return React.useEffect(()=>{if(typeof window>"u"||typeof window.matchMedia!="function")return;
let a=window.matchMedia("(prefers-reduced-motion: reduce)"),i=c=>s(c.matches);return s(a.matches),a.addEventListener?.("\
change",i),()=>a.removeEventListener?.("change",i)},[]),React.useEffect(()=>{if(n){t(0);return}let a=lc.length*3,i=setInterval(
()=>{if(a-=1,a<=0){clearInterval(i),t(0);return}t(c=>(c+1)%lc.length)},120);return()=>clearInterval(i)},[n]),React.createElement(
"span",{className:"claude-spinner-icon"},lc[e])}function qm(e,t){let n=e?new Date(e).getTime():0;if(!Number.isFinite(n)||
n<=0)return"";let s=Math.max(0,Math.floor((t-n)/1e3));return pu(s,{includeSeconds:!0})}function pu(e,{includeSeconds:t=!1}={}){
if(e=Math.max(0,Math.floor(Number(e)||0)),e<60)return`${e}s`;let n=Math.floor(e/60),s=e%60;if(n<60)return t?`${n}m ${String(
s).padStart(2,"0")}s`:`${n}m`;let a=Math.floor(n/60),i=n%60;return a>=24?`${Math.floor(a/24)}d ${String(a%24).padStart(2,
"0")}h ${String(i).padStart(2,"0")}m${t?` ${String(s).padStart(2,"0")}s`:""}`:`${a}h ${String(i).padStart(2,"0")}m${t?` ${String(
s).padStart(2,"0")}s`:""}`}function tf(e,t,n=null){return e?pu(Zd(e,n,t),{includeSeconds:!0}):""}function cv({activity:e,
thinkingText:t,agentType:n,pinned:s=!1}){let a=e?.kind||"working",i=Am[a]||Am.working,c=e?.goal||null,u=i.tone==="thinki\
ng"||i.tone==="info",b=(c?.state||c?.status)==="active"&&(!e?.goal_run||e.goal_run.lease_active===!0),k=!!(e?.thinking||
e?.current),N=String(t||e?.thinkingContent||"").trim(),A=n==="claude"||n==="claude_cli",S=e?.thinking||(!k&&(a==="thinki\
ng"||A)?{text:N,since:e?.startedAt||e?.updatedAt||null}:null),M=e?.current||(!k&&!S&&u?{kind:a==="running_command"?"tool":
"answer",label:e?.label||(a==="running_command"?"Running command":"Working"),partial:N,since:e?.startedAt||e?.updatedAt||
null}:null),d=e?.step||null,v=e?.usage||null,[g,x]=React.useState(Date.now()),w=S?S.since||e?.startedAt||e?.updatedAt:null,
E=M?M.since||e?.startedAt||e?.updatedAt:null,T=ie=>!!ie&&Number.isFinite(new Date(ie).getTime()),U=b&&T(c?.updated_at)||
T(w)||T(E);React.useEffect(()=>{if(!U)return;let ie=setInterval(()=>x(Date.now()),1e3);return()=>clearInterval(ie)},[U,c?.
updated_at,w,E]);let Y=e?.interruptHint||e?.interrupt_hint||"",re=c?tf(c,g,e?.goal_run):"",ee=String(c?.text||c?.objective||
"").trim(),ae=S?qm(w,g):"",W=M?qm(E,g):"";return!c&&!S&&!M&&!d&&!v?null:React.createElement("div",{className:`live-statu\
s-stack${s?" pinned":""}`,"data-testid":"live-status-stack"},M&&React.createElement("div",{className:`live-current-statu\
s ${M.kind||"answer"}`,"data-live-channel":"current"},React.createElement("div",{className:"live-current-tool-heading"},
M.kind==="tool"?React.createElement("span",{className:"live-status-icon"},"\u25B6"):React.createElement(jo,{agentType:n,
compact:!0}),React.createElement("span",{className:"live-status-label"},M.label||(M.kind==="tool"?"Running tool":"Workin\
g")),React.createElement("span",{className:"live-status-meta"},[W,Y].filter(Boolean).join(" \xB7 "))),M.partial&&(M.kind===
"tool"?React.createElement("pre",{className:"live-current-output"},M.partial):React.createElement("p",{className:"live-c\
urrent-narration"},M.partial))),S&&React.createElement("div",{className:"live-thinking-row","data-live-channel":"thinkin\
g"},React.createElement("div",{className:"live-thinking-heading"},React.createElement(jo,{agentType:n}),React.createElement(
"span",{className:"live-status-label"},S.label||e?.label||"Thinking"),ae&&React.createElement("span",{className:"live-st\
atus-meta"},ae)),S.text&&React.createElement("div",{className:"live-thinking-text"},S.text)),d&&React.createElement("div",
{className:"live-step-wrap","data-live-channel":"step"},React.createElement("div",{className:"live-step-chip",title:d.text||
""},d.state==="in_progress"?React.createElement(jo,{agentType:n,compact:!0}):React.createElement("span",null,"\u25CC"),React.
createElement("span",null,"Step ",d.current||1," / ",d.total||1),(d.added!=null||d.deleted!=null)&&React.createElement("\
span",{className:"live-step-diff"},"\xB7 +",d.added||0," \u2212",d.deleted||0))),c&&React.createElement("details",{className:"\
live-goal-row","data-live-channel":"goal"},React.createElement("summary",{title:ee},React.createElement("span",{className:"\
live-status-icon"},"\u26F3"),React.createElement("span",{className:"live-status-label"},c.label||"Pursuing goal"),React.
createElement("span",{className:"live-goal-objective"},ee||"Active goal"),React.createElement("span",{className:"live-st\
atus-meta"},re||c.state||c.status||"active")),ee&&React.createElement("div",{className:"live-goal-expanded"},ee)),v&&React.
createElement("div",{className:"live-usage-banner","data-live-channel":"usage",role:"status"},React.createElement("div",
{className:"live-usage-title"},v.title||"Usage limit reached"),React.createElement("div",{className:"live-usage-detail"},
v.detail||(v.resets_at?`Your rate limit resets at ${v.resets_at}.`:"Usage is currently exhausted."))))}function lv({taskList:e,
sessionId:t}){let n=e?.content_blocks?.find(A=>A?.type==="plan"),s=n?{...e,...n}:e;if(!s||!s.tasks||s.tasks.length===0)return null;
let a=t?`remote-agent-chat:task-list-collapsed:${t}`:null,i=!1,[c,u]=React.useState(()=>{if(!a)return i;let A=localStorage.
getItem(a);return A==null?i:A==="1"});React.useEffect(()=>{if(!a){u(i);return}let A=localStorage.getItem(a);u(A==null?i:
A==="1")},[a,i]);let f=()=>{u(A=>{let S=!A;return a&&localStorage.setItem(a,S?"1":"0"),S})},b={completed:"\u2713",in_progress:"\
\u25CC",pending:"\u25CB"},k={completed:"done",in_progress:"active",pending:""},N=s.tasks.find(A=>A.state==="in_progress");
return React.createElement("div",{className:`codex-task-list${c?" collapsed":""}`},React.createElement("button",{type:"b\
utton",className:"codex-task-header",onClick:f,"aria-expanded":!c,title:c?"Expand task list":"Collapse task list"},React.
createElement("span",{className:"codex-task-chevron"},c?"\u25B8":"\u25BE"),React.createElement("span",{className:"codex-\
task-count"},s.completed,"/",s.total," tasks"),c&&N?.text&&React.createElement("span",{className:"codex-task-active-summ\
ary"},N.text)),!c&&React.createElement("div",{className:"codex-task-items"},s.tasks.map((A,S)=>React.createElement("div",
{key:S,className:`codex-task-item ${k[A.state]||""}`},React.createElement("span",{className:"codex-task-icon"},b[A.state]||
"\u25CB"),React.createElement("span",{className:"codex-task-text"},A.text)))))}function uv({card:e,tone:t="cline"}){if(!e)
return null;let n=Number.isFinite(Number(e.percent_used))?Math.max(0,Math.min(100,Number(e.percent_used))):null,s=oe(e.title||
"Current context"),a=oe(e.subtitle||""),i=oe(e.detail||""),c=oe(e.label||e.usage_label||"");return React.createElement("\
div",{className:`cline-context-card ${t}-context-card`},React.createElement("div",{className:"cline-context-header"},React.
createElement("div",{className:"cline-context-copy"},React.createElement("div",{className:"cline-context-title"},s),a&&React.
createElement("div",{className:"cline-context-subtitle"},a),i&&React.createElement("div",{className:"cline-context-detai\
l"},i)),c&&React.createElement("div",{className:"cline-context-usage"},c)),n!=null&&React.createElement("div",{className:"\
cline-context-meter",title:`${e.percent_used}% of context window used`},React.createElement("div",{className:"cline-cont\
ext-meter-fill",style:{width:`${n}%`}})))}function rs(e,t){return e?.choice_id||e?.id||e?.value||`choice-${t}`}function qo(e,t){
return e?.label||e?.title||e?.text||e?.name||rs(e,t)}function mu(e,t){let n=new Set(Array.isArray(t)?t:[t]);return(Array.
isArray(e?.content_blocks)?e.content_blocks:[]).find(s=>n.has(s?.type))||null}function Im(e){return mu(e,"prompt")?.content||
e?.prompt_text||e?.message||e?.text||"Agent requires permission to continue."}function nf(e){let t=Math.max(0,Math.ceil(
e/1e3)),n=Math.floor(t/60),s=t%60;return`${n}:${String(s).padStart(2,"0")}`}function dv(e,t){return e?.deadline_at?t<=0?
"Native deadline elapsed \xB7 awaiting receipt":`${e.auto_resolution_policy==="native"?"Native auto-resolution in":"Resp\
onse deadline in"} ${nf(t)}`:""}function pv({prompt:e,sessionId:t,agentType:n,onRespond:s,onDismissFocus:a}){let[i,c]=React.
useState(Date.now()),[u,f]=React.useState({}),[b,k]=React.useState({}),[N,A]=React.useState({}),[S,M]=React.useState(""),
[d,v]=React.useState(null),[g,x]=React.useState(!1);React.useEffect(()=>{let q=setInterval(()=>c(Date.now()),500);return()=>clearInterval(
q)},[]),React.useEffect(()=>{f({}),k({}),A({}),M(""),v(null),x(!1)},[e?.prompt_id]);let w=Math.max(0,Number(e?.timeout_ms)||
0),E=Number(e?.received_at)||Date.now(),T=Date.parse(e?.deadline_at||""),U=e?.type==="question_prompt"&&Number.isFinite(
T),Y=U?Math.max(0,T-i):w>0?Math.max(0,w-(i-E)):0,re=Array.isArray(e?.choices)?e.choices:[],ee=e?.submitting_choice_id||null,
ae=e?.type==="question_prompt"&&e?.lifecycle!=="open",W=e?.default_choice||null,ie=(e?.kind==="question"||e?.type==="que\
stion_prompt")&&Array.isArray(e?.questions)?e.questions.filter(q=>q&&typeof q=="object"):[],ge=ie.length>0,X=n==="claude"&&
!ge,we=oe(e?.command).trim(),ve=oe(e?.title).trim()||(we?"Allow this action?":Im(e)),Z=oe(e?.description).trim(),Se=X&&e?.
alternate_instruction_supported===!0,Q=ie.flatMap(q=>(Array.isArray(q.choices)?q.choices:[]).map((G,te)=>({question:q,choiceId:rs(
G,te)}))).slice(0,9),de=(q,G)=>{f(te=>{let $=Array.isArray(te[q.question_id])?te[q.question_id]:[],H=q.multi_select?$.includes(
G)?$.filter(fe=>fe!==G):[...$,G]:[G];return{...te,[q.question_id]:H}})},pe=ie.every(q=>{let G=Array.isArray(q.choices)?q.
choices:[];if(q.answer_mode==="text"||G.length===0)return q.required===!1||oe(N[q.question_id]).trim().length>0;let te=u[q.
question_id]||[];return te.length===0?!1:te.every($=>!G.find((fe,be)=>rs(fe,be)===$)?.requires_text||oe(b[`${q.question_id}\
:${$}`]).trim())}),J=()=>{if(!pe||ee||ae)return;let q=ie.map(G=>{let te=Array.isArray(G.choices)?G.choices:[];if(G.answer_mode===
"text"||te.length===0)return{question_id:G.question_id,text:oe(N[G.question_id]).trim()};let $=u[G.question_id]||[],H=te.
find((_e,Ne)=>_e.requires_text&&$.includes(rs(_e,Ne))),fe=H?te.indexOf(H):-1,be=H?rs(H,fe):null;return{question_id:G.question_id,
choice_ids:$,...be?{other_text:oe(b[`${G.question_id}:${be}`]).trim()}:{}}});s(t,e.prompt_id,null,{answers:q})};return React.
useEffect(()=>{let q=G=>{let te=G.target?.closest?.(".permission-card"),$=G.target?.matches?.(".input-area textarea"),H=G.
target===document.body||G.target===document.documentElement;if(!te&&!$&&!H||ae&&G.key!=="Escape")return;if(G.key==="Esca\
pe"){if(G.preventDefault(),ge&&e?.type==="question_prompt"&&e?.cancel_supported===!0&&!ee&&!ae){s(t,e.prompt_id,null,{action:"\
cancel"});return}let Le=X?re.find((Ae,He)=>/^(?:reject|deny|cancel|block|not now|no)\b/i.test(qo(Ae,He).replace(/^\d+\s+/,
""))):null;if(Le&&!ee){s(t,e.prompt_id,rs(Le,re.indexOf(Le)));return}x(!0),a?.();return}if(g)return;let fe=tu(G.target),
be=G.key==="Enter"&&G.target?.closest?.(".permission-other-input");if(G.key==="Enter"&&!G.shiftKey&&G.target?.closest?.(
".permission-alternate-input")){G.preventDefault();let Le=S.trim();Le&&!ee&&s(t,e.prompt_id,null,{instruction:Le});return}
if(ee||fe&&!be&&!$)return;if(/^[1-9]$/.test(G.key)){let Le=Number(G.key)-1;if(G.preventDefault(),ge){let Ae=Q[Le];Ae&&de(
Ae.question,Ae.choiceId)}else{let Ae=re[Le];Ae&&v(rs(Ae,Le))}return}if(G.key!=="Enter")return;if(ge){pe&&(G.preventDefault(),
J());return}let Ne=d||W;Ne&&re.some((Le,Ae)=>rs(Le,Ae)===Ne)&&(G.preventDefault(),s(t,e.prompt_id,Ne))};return window.addEventListener(
"keydown",q),()=>window.removeEventListener("keydown",q)},[S,re,X,W,ae,g,d,a,s,e?.prompt_id,pe,u,b,N,t,Q,ge,ee]),React.createElement(
"div",{className:"permission-overlay"},React.createElement("div",{className:`permission-card${X?" permission-card-claude":
""}`,role:"dialog","aria-modal":"false","aria-label":X?"Claude Code permission prompt":"Permission or question prompt",onPointerDown:()=>x(
!1)},X?React.createElement(React.Fragment,null,React.createElement("div",{className:"permission-title permission-title-c\
laude"},ve),we&&React.createElement("pre",{className:"permission-command-claude"},we),Z&&React.createElement("div",{className:"\
permission-body permission-body-claude"},Z)):React.createElement(React.Fragment,null,React.createElement("div",{className:"\
permission-eyebrow"},ge?"Question":"Permission Required"),React.createElement("div",{className:"permission-title"},ge?oe(
e?.title,"Answer the native question"):`Agent Paused In ${t?Br(t,t):"Active Session"}`),!ge&&React.createElement("div",{
className:"permission-body"},Im(e)),React.createElement("div",{className:"permission-meta"},U&&React.createElement("span",
{className:"permission-timer"},dv(e,Y)),!U&&w>0&&React.createElement("span",{className:"permission-timer"},"Auto-choice \
in ",nf(Y)),W&&React.createElement("span",{className:"permission-default"},"Default: ",W))),e?.error&&React.createElement(
"div",{className:"permission-error"},e.error),React.createElement("div",{className:`permission-actions${ge?" permission-\
question-list":""}`},ge?ie.map((q,G)=>React.createElement("fieldset",{className:"permission-question",key:q.question_id||
G},React.createElement("legend",null,oe(q.header||q.label,`Question ${G+1}`)),oe(q.message).trim()&&React.createElement(
"div",{className:"permission-question-message"},oe(q.message)),React.createElement("div",{className:"permission-question\
-options"},q.answer_mode==="text"||!Array.isArray(q.choices)||q.choices.length===0?React.createElement("input",{className:"\
permission-question-text-input",type:q.secret===!0?"password":"text",value:N[q.question_id]||"",maxLength:2e3,disabled:!!ee||
ae,autoComplete:"off",spellCheck:q.secret===!0?"false":void 0,placeholder:q.secret===!0?"Enter private answer":"Enter an\
swer","aria-label":`${oe(q.header||q.label,`Question ${G+1}`)} answer`,onChange:te=>A($=>({...$,[q.question_id]:te.target.
value}))}):q.choices.map((te,$)=>{let H=rs(te,$),fe=(u[q.question_id]||[]).includes(H),be=`${q.question_id}:${H}`;return React.
createElement("div",{className:"permission-question-option",key:H},React.createElement("button",{type:"button",className:`\
permission-action${fe?" selected":""}`,role:q.multi_select?"checkbox":"radio","aria-checked":fe,disabled:!!ee||ae,"aria-\
keyshortcuts":Q.findIndex(_e=>_e.question===q&&_e.choiceId===H)>=0?String(Q.findIndex(_e=>_e.question===q&&_e.choiceId===
H)+1):void 0,onClick:()=>de(q,H)},Q.findIndex(_e=>_e.question===q&&_e.choiceId===H)>=0&&React.createElement("kbd",{className:"\
permission-key-hint"},Q.findIndex(_e=>_e.question===q&&_e.choiceId===H)+1),React.createElement("span",{className:"permis\
sion-choice-marker","aria-hidden":"true"},q.multi_select?fe?"\u2713":"\u25A1":fe?"\u25CF":"\u25CB"),React.createElement(
"span",{className:"permission-choice-copy"},React.createElement("span",null,qo(te,$)),oe(te?.description).trim()&&React.
createElement("span",{className:"permission-action-desc"},oe(te.description)))),fe&&te.requires_text&&React.createElement(
"input",{className:"permission-other-input",type:q.secret===!0?"password":"text",value:b[be]||"",maxLength:2e3,disabled:!!ee||
ae,autoComplete:"off",spellCheck:q.secret===!0?"false":void 0,placeholder:"Enter another answer","aria-label":`${qo(te,$)}\
 answer`,onChange:_e=>k(Ne=>({...Ne,[be]:_e.target.value}))}))})))):re.map((q,G)=>{let te=rs(q,G),$=ee===te,H=W&&W===te,
fe=d===te,be=X&&!d&&!W&&G===0,_e=X?qo(q,G).replace(new RegExp(`^${G+1}\\s+`),""):qo(q,G),Ne=X?oe(q?.destination).trim():
"",Le=Ne&&_e.endsWith(Ne)?_e.slice(0,-Ne.length):_e;return React.createElement("button",{key:te,className:`permission-ac\
tion${H?" default":""}${fe||be?" selected":""}${$?" pending":""}`,disabled:!!ee,"aria-pressed":fe||be,"aria-keyshortcuts":G<
9?String(G+1):void 0,onClick:()=>s(t,e.prompt_id,te)},G<9&&React.createElement("kbd",{className:"permission-key-hint"},oe(
q?.shortcut,String(G+1))),React.createElement("span",null,Le,Ne&&React.createElement("span",{className:"permission-choic\
e-destination-claude"},Ne)),oe(q?.description).trim()&&React.createElement("span",{className:"permission-action-desc"},oe(
q.description)),$&&React.createElement("span",{className:"permission-action-state"},"Sending..."))})),Se&&React.createElement(
"textarea",{className:"permission-alternate-input",rows:"1",maxLength:2e3,value:S,disabled:!!ee,placeholder:oe(e?.alternate_instruction_placeholder,
"Tell Claude what to do instead"),"aria-label":"Tell Claude what to do instead",onChange:q=>M(q.target.value)}),ge&&React.
createElement("div",{className:"permission-question-footer"},React.createElement("button",{type:"button",className:"perm\
ission-question-submit",disabled:!pe||!!ee||ae,onClick:J},ee?"Sending...":oe(e.submit_label,"Submit answers")),e?.type===
"question_prompt"&&e?.cancel_supported===!0&&React.createElement("button",{type:"button",className:"permission-question-\
cancel",disabled:!!ee||ae,onClick:()=>s(t,e.prompt_id,null,{action:"cancel"})},"Cancel")),React.createElement("div",{className:"\
permission-keyboard-help"},X?oe(e?.cancel_hint,"Esc to cancel"):`1\u20139 select \xB7 Enter submit \xB7 Esc ${e?.cancel_supported===
!0?"cancel":"return to composer"}`)))}function uc(e){return oe(e?.label,"Action")}function jr(e){return!!e&&e.blocking!==
!1&&e.display_mode!=="inline"}function mv({prompt:e,sessionId:t,onRespond:n}){let s=mu(e,["error","notice"]),a=Array.isArray(
e?.actions)?e.actions:s?.actions||[],i=e?.submitting_action_id||null,c=oe(e?.error_output||s?.error_output).trim();return React.
createElement("div",{className:"permission-overlay"},React.createElement("div",{className:"permission-card error-prompt-\
card"},React.createElement("div",{className:"permission-eyebrow error-prompt-eyebrow"},"Action Required"),React.createElement(
"div",{className:"permission-title"},oe(s?.label||e?.title,"Error handling model response")),React.createElement("div",{
className:"permission-body"},oe(s?.content||e?.message,"There was an error handling the model response.")),c&&React.createElement(
"div",{className:"error-prompt-output-wrap"},React.createElement("div",{className:"error-prompt-output-label"},"Error Ou\
tput"),React.createElement("pre",{className:"error-prompt-output"},c)),e?.error&&React.createElement("div",{className:"p\
ermission-error"},e.error),React.createElement("div",{className:"permission-actions"},a.map(u=>{let f=oe(u?.action_id),b=i===
f;return React.createElement("button",{key:f||uc(u),className:`permission-action error-prompt-action${b?" pending":""}`,
disabled:!!i,onClick:k=>n(t,e.prompt_id,f,k)},React.createElement("span",null,uc(u)),b&&React.createElement("span",{className:"\
permission-action-state"},"Sending..."))}))))}function fv({prompt:e,sessionId:t,onRespond:n}){let s=mu(e,["error","notic\
e"]),a=Array.isArray(e?.actions)?e.actions:s?.actions||[],i=e?.submitting_action_id||null,c=oe(e?.error_output||s?.error_output).
trim();return React.createElement("div",{className:"inline-error-prompt"},React.createElement("div",{className:"inline-e\
rror-prompt-body"},React.createElement("div",{className:"inline-error-prompt-title"},oe(s?.label||e?.title,"Codex requir\
es attention")),React.createElement("div",{className:"inline-error-prompt-message"},oe(s?.content||e?.message,"There was\
 an error handling the model response.")),c&&React.createElement("pre",{className:"inline-error-prompt-output"},c),e?.error&&
React.createElement("div",{className:"permission-error"},e.error)),React.createElement("div",{className:"inline-error-pr\
ompt-actions"},a.map(u=>{let f=oe(u?.action_id),b=i===f;return React.createElement("button",{key:f||uc(u),className:`per\
mission-action error-prompt-action${b?" pending":""}`,disabled:!!i,onClick:k=>n(t,e.prompt_id,f,k)},React.createElement(
"span",null,uc(u)),b&&React.createElement("span",{className:"permission-action-state"},"Sending..."))})))}function gv({launchStates:e,
onLaunch:t,onResume:n,onClose:s,workspaces:a,showTestSessions:i=!1}){let[c,u]=React.useState("new"),[f,b]=React.useState(
"claude"),[k,N]=React.useState(""),[A,S]=React.useState(""),[M,d]=React.useState("deepseek-v4-pro:cloud"),[v,g]=React.useState(
"gpt-5.5"),[x,w]=React.useState("grok-4.5-fast-high"),[E,T]=React.useState(null),[U,Y]=React.useState([]),[re,ee]=React.
useState(!1),ae=E?e[E]:null,W=ae?.status==="launching",ie=ae?.status==="failed"?ae.error:null,ge=(a||[]).length>0;React.
useEffect(()=>{E&&!e[E]&&s()},[e,E]),React.useEffect(()=>{c==="resume"&&!re&&(ee(!0),fetch(`/api/sessions/history?limit=\
30&include_test=${i?"true":"false"}`,{credentials:"same-origin"}).then(Z=>Z.json()).then(Z=>Y(Z.sessions||[])).catch(()=>Y(
[])).finally(()=>ee(!1)))},[c,i]);function X(Z){if(Z.preventDefault(),W)return;let Se=k==="custom"?A.trim():k,Q=f==="cla\
ude_cli"?{model_id:M.trim()||"default"}:f==="codex_cli"?{model_id:v.trim()||"gpt-5.5",permission_mode:"workspace-write",
effort:"medium"}:f==="cursor_cli"?{model_id:x.trim()||"grok-4.5-fast-high",permission_mode:"force"}:{},de=t(f,Se||void 0,
Q);T(de)}function we(Z){if(W)return;let Se=Z.agent_type||f,Q=Z.workspace_path||(k==="custom"?A.trim():k)||void 0,de=n(Z.
session_id,Se,Q,{cli_session_id:Z.cli_session_id||void 0,model_id:Z.model_id||void 0,permission_mode:Z.permission_mode||
void 0});T(de)}function ve(Z){if(!Z)return"";let Se=Date.now()-new Date(Z).getTime(),Q=Math.floor(Se/6e4);if(Q<60)return`${Q}\
m ago`;let de=Math.floor(Q/60);return de<24?`${de}h ago`:`${Math.floor(de/24)}d ago`}return React.createElement("div",{className:"\
new-session-panel"},React.createElement("div",{className:"new-session-header"},React.createElement("span",null,c==="new"?
"New Session":"Resume Session"),React.createElement("button",{className:"new-session-close",onClick:s,title:"Cancel"},"\u2715")),
React.createElement("div",{className:"new-session-tabs"},React.createElement("button",{className:`new-session-tab${c==="\
new"?" active":""}`,onClick:()=>u("new")},"New"),React.createElement("button",{className:`new-session-tab${c==="resume"?
" active":""}`,onClick:()=>u("resume")},"Resume")),c==="new"?React.createElement("form",{className:"new-session-form",onSubmit:X},
React.createElement("div",{className:"new-session-agents"},Object.entries(In).map(([Z,Se])=>React.createElement("button",
{key:Z,type:"button",className:`new-session-agent-btn${f===Z?" selected":""}`,style:f===Z?{borderColor:Se.color,color:Se.
color,background:Se.color+"18"}:{},onClick:()=>b(Z)},React.createElement("span",{className:"agent-badge new-session-badg\
e",style:{color:Se.color,borderColor:Se.color+"55",background:Se.color+"18"}},Se.abbr),React.createElement("span",{className:"\
new-session-agent-name"},Se.name)))),ge?React.createElement(React.Fragment,null,React.createElement("select",{className:"\
new-session-workspace",value:k,onChange:Z=>N(Z.target.value),disabled:W},React.createElement("option",{value:""},"No wor\
kspace (default)"),a.map((Z,Se)=>React.createElement("option",{key:Se,value:Z.path||Z.title},Z.title)),React.createElement(
"option",{value:"custom"},"Custom path\u2026")),k==="custom"&&React.createElement("input",{className:"new-session-worksp\
ace",type:"text",placeholder:"Enter workspace path",value:A,onChange:Z=>S(Z.target.value),disabled:W,autoFocus:!0})):React.
createElement("input",{className:"new-session-workspace",type:"text",placeholder:"Workspace path (optional)",value:A,onChange:Z=>S(
Z.target.value),disabled:W}),f==="claude_cli"&&React.createElement("input",{className:"new-session-workspace",type:"text",
placeholder:"Claude CLI model, e.g. deepseek-v4-pro:cloud",value:M,onChange:Z=>d(Z.target.value),disabled:W}),f==="codex\
_cli"&&React.createElement("select",{className:"new-session-workspace",value:v,onChange:Z=>g(Z.target.value),disabled:W},
fu.map(Z=>React.createElement("option",{key:Z.id,value:Z.id},Z.label))),f==="cursor_cli"&&React.createElement("select",{
className:"new-session-workspace",value:x,onChange:Z=>w(Z.target.value),disabled:W},gu.map(Z=>React.createElement("optio\
n",{key:Z.id,value:Z.id},Z.label))),ie&&React.createElement("div",{className:"new-session-error"},ie),React.createElement(
"button",{className:"new-session-submit",type:"submit",disabled:W},W?React.createElement("span",{className:"new-session-\
spinner"}):null,W?"Launching\u2026":"Launch")):React.createElement("div",{className:"new-session-form"},React.createElement(
"div",{className:"new-session-agents"},Object.entries(In).map(([Z,Se])=>React.createElement("button",{key:Z,type:"button",
className:`new-session-agent-btn${f===Z?" selected":""}`,style:f===Z?{borderColor:Se.color,color:Se.color,background:Se.
color+"18"}:{},onClick:()=>b(Z)},React.createElement("span",{className:"agent-badge new-session-badge",style:{color:Se.color,
borderColor:Se.color+"55",background:Se.color+"18"}},Se.abbr),React.createElement("span",{className:"new-session-agent-n\
ame"},Se.name)))),ie&&React.createElement("div",{className:"new-session-error"},ie),re?React.createElement("div",{className:"\
session-history-loading"},React.createElement("span",{className:"new-session-spinner"})," Loading history\u2026"):U.length===
0?React.createElement("div",{className:"session-history-empty"},"No past sessions found"):React.createElement("div",{className:"\
session-history-list"},U.filter(Z=>!f||!Z.agent_type||Z.agent_type===f).map(Z=>React.createElement("button",{key:Z.session_id,
className:"session-history-item",onClick:()=>we(Z),disabled:W},React.createElement("div",{className:"session-history-pre\
view"},Z.preview||"(empty session)"),React.createElement("div",{className:"session-history-meta"},React.createElement("s\
pan",null,Z.message_count," msg",Z.message_count!==1?"s":""),Z.agent_type&&React.createElement("span",{className:"sessio\
n-history-workspace"},In[Z.agent_type]?.name||Z.agent_type),Z.workspace_name&&React.createElement("span",{className:"ses\
sion-history-workspace",title:Z.workspace_path||""},Z.workspace_name),React.createElement("span",null,ve(Z.last_active_at))))))))}
var hv={claude:[{value:"default",label:"Ask before edit"},{value:"acceptEdits",label:"Edit automatically"},{value:"plan",
label:"Plan mode"},{value:"auto",label:"Auto mode"},{value:"bypassPermissions",label:"Bypass permissions"}],claude_cli:[
{value:"default",label:"Default"},{value:"acceptEdits",label:"Accept edits"},{value:"auto",label:"Auto"},{value:"bypassP\
ermissions",label:"Bypass permissions"},{value:"dontAsk",label:"Do not ask"},{value:"plan",label:"Plan"}],continue_yolo:[
{value:"ask",label:"Ask for permissions"},{value:"bypass",label:"Bypass permissions"}],roo_code:[{value:"BRRR",label:"BR\
RR"},{value:"YOLO",label:"YOLO"},{value:"Ask",label:"Ask"},{value:"Auto-approve",label:"Auto-approve"}],cline:[{value:"Y\
OLO",label:"YOLO"}],codex_cli:[{value:"read-only",label:"Read only"},{value:"workspace-write",label:"Workspace write"},{
value:"danger-full-access",label:"Full access"}],cursor_cli:[{value:"default",label:"Default"},{value:"force",label:"For\
ce (Yolo)"},{value:"plan",label:"Plan"},{value:"ask",label:"Ask"}],codex:[],gemini:[]};function sf(e){return e==="codex_\
cli"?"workspace-write":e==="cursor_cli"?"force":e==="continue_yolo"||e==="roo_code"||e==="cline"?"ask":"default"}var su=[
{id:"default",label:"Auto"},{id:"claude-opus-4-6",label:"Claude Opus 4.6"},{id:"claude-sonnet-4-6",label:"Claude Sonnet \
4.6"},{id:"claude-opus-4-5",label:"Claude Opus 4.5"},{id:"claude-sonnet-4-5",label:"Claude Sonnet 4.5"},{id:"claude-haik\
u-4-5",label:"Claude Haiku 4.5"},{id:"claude-opus-4-0",label:"Claude Opus 4"},{id:"claude-sonnet-4-0",label:"Claude Sonn\
et 4"},{id:"claude-3-7-sonnet",label:"Claude 3.7 Sonnet"},{id:"claude-3-5-sonnet",label:"Claude 3.5 Sonnet"},{id:"claude\
-3-5-haiku",label:"Claude 3.5 Haiku"},{id:"deepseek-v4-pro:cloud",label:"DeepSeek V4 Pro (Ollama Cloud)"}],fu=[{id:"gpt-\
5.6",label:"GPT-5.6"},{id:"gpt-5.6-sol",label:"GPT-5.6 Sol"},{id:"gpt-5.6-terra",label:"GPT-5.6 Terra"},{id:"gpt-5.6-lun\
a",label:"GPT-5.6 Luna"},{id:"gpt-5.5",label:"GPT-5.5"},{id:"gpt-5.4",label:"GPT-5.4"},{id:"gpt-5.4-mini",label:"GPT-5.4\
 Mini"},{id:"gpt-5.3-codex-spark",label:"GPT-5.3 Codex Spark"},{id:"gpt-5.3-codex",label:"GPT-5.3 Codex"},{id:"gpt-5.2-c\
odex",label:"GPT-5.2 Codex"},{id:"gpt-5.2",label:"GPT-5.2"},{id:"gpt-5.1-codex",label:"GPT-5.1 Codex"},{id:"gpt-5.1",label:"\
GPT-5.1"},{id:"gpt-5",label:"GPT-5"},{id:"ollama:deepseek-v4-pro:cloud",label:"DeepSeek V4 Pro (Ollama Cloud)"},{id:"oll\
ama:kimi-k2.6:cloud",label:"Kimi K2.6 (Ollama Cloud)"}],gu=[{id:"grok-4.5-fast-high",label:"Grok 4.5 Fast (High)"},{id:"\
grok-4.5-fast-xhigh",label:"Grok 4.5 Fast (XHigh)"},{id:"claude-fable-5-thinking-high",label:"Claude Fable 5 (Thinking H\
igh)"},{id:"claude-opus-4-8-thinking-high",label:"Claude Opus 4.8 (Thinking High)"},{id:"composer-2.5",label:"Composer 2\
.5"},{id:"composer-2.5-fast",label:"Composer 2.5 Fast"},{id:"gpt-5.5-high",label:"GPT-5.5 (High)"},{id:"gpt-5.3-codex",label:"\
GPT-5.3 Codex"}],hu=[{id:"Planning",label:"Planning"},{id:"Fast",label:"Fast"}],_v=[{id:"Architect",label:"Architect"},{
id:"Code",label:"Code"},{id:"Ask",label:"Ask"},{id:"Debug",label:"Debug"},{id:"Orchestrator",label:"Orchestrator"}],bv=[
{id:"Plan",label:"Plan"},{id:"Act",label:"Act"}],af=[{id:"Gemini 3.1 Pro (High)",label:"Gemini 3.1 Pro (High)"},{id:"Gem\
ini 3.1 Pro (Low)",label:"Gemini 3.1 Pro (Low)"},{id:"Gemini 3 Flash",label:"Gemini 3 Flash"},{id:"Claude Sonnet 4.6 (Th\
inking)",label:"Claude Sonnet 4.6 (Thinking)"},{id:"Claude Opus 4.6 (Thinking)",label:"Claude Opus 4.6 (Thinking)"},{id:"\
GPT-OSS 120B (Medium)",label:"GPT-OSS 120B (Medium)"}],rf=[{id:"Default",label:"Default"},{id:"2.5 Flash",label:"Gemini \
2.5 Flash"},{id:"2.5 Pro",label:"Gemini 2.5 Pro"},{id:"3 Flash Preview",label:"Gemini 3 Flash Preview"},{id:"3.1 Pro Pre\
view",label:"Gemini 3.1 Pro Preview"}];function Om(e,t){return Array.isArray(t?.available_models)&&t.available_models.length>
0?t.available_models.map(n=>typeof n=="string"?{id:n,label:n}:n):e==="continue_yolo"||e==="continue"||e==="roo_code"||e===
"cline"?[]:e==="claude_cli"?su:e==="codex_cli"?fu:e==="cursor_cli"?gu:e==="antigravity"||e==="antigravity_panel"?af:e===
"gemini"?rf:su}function Io(e,t){return Array.isArray(t?.available_modes)&&t.available_modes.length>0?t.available_modes.map(
n=>typeof n=="string"?{id:n,label:n}:n):e==="roo_code"?_v:e==="cline"?bv:e==="antigravity"||e==="antigravity_panel"?hu:[]}
function au(e,t){return Array.isArray(t?.available_permission_modes)&&t.available_permission_modes.length>0?t.available_permission_modes.
map(n=>typeof n=="string"?{value:n,label:n}:{value:n.id||n.value,label:n.label||n.id||n.value}).filter(n=>n.value):hv[e]||
[]}function vv(e){let t="=".repeat((4-e.length%4)%4),n=(e+t).replace(/-/g,"+").replace(/_/g,"/"),s=atob(n);return Uint8Array.
from([...s].map(a=>a.charCodeAt(0)))}var _u=Object.freeze({permission_required:!0,agent_ready:!0,turn_ready:!1,goal_completed:!1,
goal_attention:!0,provider_usage_warning:!0,agent_error:!0,session_offline:!0,rate_limit_cleared:!0,completion_sound:!1,
completion_haptic:!1}),yv=Object.freeze(Object.fromEntries(Object.keys(_u).map(e=>[e,!1]))),rc=null,Dm=0;function bu(){if(typeof window>
"u")return null;let e=window.AudioContext||window.webkitAudioContext;return e?(rc||(rc=new e),rc.state==="suspended"&&rc.
resume().catch(()=>{}),rc):null}function jm(e="completion"){let t=Date.now();if(t-Dm<600)return!1;let n=bu();if(!n||n.state!==
"running")return!1;Dm=t;let s=n.createOscillator(),a=n.createGain(),i=n.currentTime;return s.type="sine",s.frequency.setValueAtTime(
e==="prompt"?740:620,i),s.frequency.exponentialRampToValueAtTime(e==="prompt"?880:760,i+.11),a.gain.setValueAtTime(1e-4,
i),a.gain.exponentialRampToValueAtTime(.035,i+.012),a.gain.exponentialRampToValueAtTime(1e-4,i+.14),s.connect(a),a.connect(
n.destination),s.start(i),s.stop(i+.15),!0}function Bm(e,t){return e!==t?!0:typeof document>"u"?!1:document.visibilityState!==
"visible"||!document.hasFocus()}function kv({onClose:e,onPreferencesChange:t}){let n=_u,[s,a]=le(n),[i,c]=le(!0),[u,f]=le(
null),[b,k]=le(""),[N,A]=le("checking"),[S,M]=le(!1);async function d(){c(!0),k("");try{let E=await fetch("/api/preferen\
ces/notifications",{credentials:"same-origin"}),T=await E.json().catch(()=>({}));if(!E.ok)throw new Error(T.error||"Unab\
le to load notification settings.");let U={...n,...T.preferences||{},turn_ready:!1};a(U),t?.(U)}catch(E){k(E.message||"U\
nable to load notification settings.")}finally{c(!1)}}async function v(){if(!("serviceWorker"in navigator)||!("PushManag\
er"in window)||!("Notification"in window)){A("unsupported");return}try{let T=await(await navigator.serviceWorker.ready).
pushManager.getSubscription();A(T?"enabled":Notification.permission==="denied"?"denied":"available")}catch{A("error")}}Ee(
()=>{d(),v()},[]);async function g(){if(!S){M(!0),k("");try{let E=await Notification.requestPermission();if(E!=="granted"){
A(E==="denied"?"denied":"available");return}let T=await fetch("/api/push/web-config",{credentials:"same-origin"}),U=await T.
json().catch(()=>({}));if(!T.ok||!U.public_key)throw new Error(U.error||"Web Push is unavailable.");let Y=await navigator.
serviceWorker.ready,re=await Y.pushManager.getSubscription();re||(re=await Y.pushManager.subscribe({userVisibleOnly:!0,applicationServerKey:vv(
U.public_key)}));let ee=await fetch("/api/push/web-subscription",{method:"POST",credentials:"same-origin",headers:{"Cont\
ent-Type":"application/json"},body:JSON.stringify({subscription:re.toJSON()})}),ae=await ee.json().catch(()=>({}));if(!ee.
ok)throw new Error(ae.error||"Unable to register browser notifications.");A("enabled")}catch(E){A("error"),k(E.message||
"Unable to enable browser notifications.")}finally{M(!1)}}}async function x(){if(!S){M(!0),k("");try{let T=await(await navigator.
serviceWorker.ready).pushManager.getSubscription();T&&(await fetch("/api/push/web-subscription",{method:"DELETE",credentials:"\
same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({endpoint:T.endpoint})}),await T.unsubscribe()),
A("available")}catch(E){A("error"),k(E.message||"Unable to disable browser notifications.")}finally{M(!1)}}}async function w(E){
if(u||E==="turn_ready")return;let T=s,U={...s,[E]:!s[E]};E==="completion_sound"&&U.completion_sound&&bu(),a(U),f(E),k("");
try{let Y=await fetch("/api/preferences/notifications",{method:"PUT",credentials:"same-origin",headers:{"Content-Type":"\
application/json"},body:JSON.stringify({preferences:U})}),re=await Y.json().catch(()=>({}));if(!Y.ok)throw new Error(re.
error||"Unable to save notification settings.");let ee={...n,...re.preferences||{}};a(ee),t?.(ee)}catch(Y){a(T),k(Y.message||
"Unable to save notification settings.")}finally{f(null)}}return React.createElement("div",{className:"settings-panel no\
tification-settings-panel"},React.createElement("div",{className:"settings-panel-header"},React.createElement("span",null,
"Notifications"),React.createElement("button",{className:"settings-panel-close",onClick:e,title:"Close"},"\u2715")),React.
createElement("div",{className:"settings-panel-body"},React.createElement("div",{className:"notification-setting-row web\
-push-setting-row"},React.createElement("span",null,React.createElement("strong",null,"Browser notifications"),React.createElement(
"small",null,N==="enabled"?"Enabled for this browser":N==="denied"?"Blocked in browser site settings":N==="unsupported"?
"Not supported by this browser":N==="checking"?"Checking browser support\u2026":"Receive notifications when this PWA is \
closed")),N==="enabled"?React.createElement("button",{type:"button",disabled:S,onClick:x},"Disable"):React.createElement(
"button",{type:"button",disabled:S||N==="checking"||N==="unsupported"||N==="denied",onClick:g},S?"Enabling\u2026":"Enabl\
e")),React.createElement("label",{className:"notification-setting-row"},React.createElement("span",null,React.createElement(
"strong",null,"Permission required"),React.createElement("small",null,"When an agent needs approval to continue")),React.
createElement("input",{type:"checkbox",checked:s.permission_required,disabled:i||!!u,onChange:()=>w("permission_required")})),
React.createElement("label",{className:"notification-setting-row"},React.createElement("span",null,React.createElement("\
strong",null,"Turn finished"),React.createElement("small",null,"Unavailable until this harness supplies an authoritative\
 native turn boundary")),React.createElement("input",{type:"checkbox",checked:!1,disabled:!0,onChange:()=>w("turn_ready")})),
React.createElement("label",{className:"notification-setting-row"},React.createElement("span",null,React.createElement("\
strong",null,"Goal completed"),React.createElement("small",null,"Only when the native goal reaches its terminal complete\
d state")),React.createElement("input",{type:"checkbox",checked:s.goal_completed,disabled:i||!!u,onChange:()=>w("goal_co\
mpleted")})),React.createElement("label",{className:"notification-setting-row"},React.createElement("span",null,React.createElement(
"strong",null,"Goal needs attention"),React.createElement("small",null,"Paused, blocked, limited, cancelled, or failed g\
oals")),React.createElement("input",{type:"checkbox",checked:s.goal_attention,disabled:i||!!u,onChange:()=>w("goal_atten\
tion")})),React.createElement("label",{className:"notification-setting-row"},React.createElement("span",null,React.createElement(
"strong",null,"Provider usage warning"),React.createElement("small",null,"At 75%, 90%, and exhaustion for each provider \
account window")),React.createElement("input",{type:"checkbox",checked:s.provider_usage_warning,disabled:i||!!u,onChange:()=>w(
"provider_usage_warning")})),React.createElement("div",{className:"settings-note"},"Active /goal loop checkpoints stay q\
uiet between turns."),React.createElement("label",{className:"notification-setting-row"},React.createElement("span",null,
React.createElement("strong",null,"Agent error or rate limit"),React.createElement("small",null,"When an agent stops and\
 needs attention")),React.createElement("input",{type:"checkbox",checked:s.agent_error,disabled:i||!!u,onChange:()=>w("a\
gent_error")})),React.createElement("label",{className:"notification-setting-row"},React.createElement("span",null,React.
createElement("strong",null,"Session offline"),React.createElement("small",null,"When an agent disconnects from the rela\
y")),React.createElement("input",{type:"checkbox",checked:s.session_offline,disabled:i||!!u,onChange:()=>w("session_offl\
ine")})),React.createElement("label",{className:"notification-setting-row"},React.createElement("span",null,React.createElement(
"strong",null,"Rate limit cleared"),React.createElement("small",null,"When a model's rate limit expires")),React.createElement(
"input",{type:"checkbox",checked:s.rate_limit_cleared,disabled:i||!!u,onChange:()=>w("rate_limit_cleared")})),React.createElement(
"label",{className:"notification-setting-row"},React.createElement("span",null,React.createElement("strong",null,"Notifi\
cation sound"),React.createElement("small",null,"Subtle cue for allowed prompts and explicit goal lifecycle events")),React.
createElement("input",{type:"checkbox",checked:s.completion_sound,disabled:i||!!u,onChange:()=>w("completion_sound")})),
i&&React.createElement("div",{className:"settings-note"},"Loading relay preferences\u2026"),!!b&&React.createElement("di\
v",{className:"notification-settings-error",role:"alert"},React.createElement("span",null,b),React.createElement("button",
{type:"button",onClick:d},"Retry")),React.createElement("div",{className:"settings-note"},"These preferences sync across\
 web and Android.")))}function wv({sessions:e,preferences:t,initialSessionId:n,onSave:s,onExport:a,onClose:i}){let c=n||
Pe(e[0])||"",[u,f]=le(c),[b,k]=le(""),[N,A]=le(!1),[S,M]=le(""),[d,v]=le(""),g=e.find(T=>Pe(T)===u)||null,x=t[u]||{display_name:"",
archived:!1,muted:!1,pinned:!1,pin_order:0};Ee(()=>{k(x.display_name||""),v("")},[u,x.display_name]),Ee(()=>{n&&f(n)},[n]);
async function w(T){if(!(!u||N)){A(!0),v("");try{await s(u,T)}catch(U){v(U.message||"Unable to save session settings.")}finally{
A(!1)}}}async function E(T){if(!(!u||S)){M(T),v("");try{await a(u,T)}catch(U){v(U.message||"Unable to export session.")}finally{
M("")}}}return React.createElement("div",{className:"settings-panel session-management-panel"},React.createElement("div",
{className:"settings-panel-header"},React.createElement("span",null,"Manage sessions"),React.createElement("button",{className:"\
settings-panel-close",onClick:i,title:"Close"},"\u2715")),React.createElement("div",{className:"settings-panel-body"},e.
length===0?React.createElement("div",{className:"settings-note"},"No sessions available."):React.createElement(React.Fragment,
null,React.createElement("label",{className:"settings-row session-management-field"},React.createElement("span",{className:"\
settings-label"},"Session"),React.createElement("select",{value:u,onChange:T=>f(T.target.value)},e.map(T=>{let U=Pe(T),Y=t[U]||
{},re=Y.display_name||T?.display_name||T?.workspace_name||T?.name||U;return React.createElement("option",{key:U,value:U},
Y.archived?"[Hidden] ":"",re)}))),g&&React.createElement(React.Fragment,null,React.createElement("label",{className:"set\
tings-row session-management-field"},React.createElement("span",{className:"settings-label"},"Custom name"),React.createElement(
"input",{value:b,maxLength:100,placeholder:g?.display_name||g?.workspace_name||g?.name||u,onChange:T=>k(T.target.value)})),
React.createElement("label",{className:"notification-setting-row"},React.createElement("span",null,React.createElement("\
strong",null,"Pin chat"),React.createElement("small",null,"Keep this chat in the operator-ordered pinned section")),React.
createElement("input",{type:"checkbox",checked:!!x.pinned,disabled:N,onChange:()=>w({pinned:!x.pinned})})),React.createElement(
"label",{className:"notification-setting-row"},React.createElement("span",null,React.createElement("strong",null,"Mute n\
otifications"),React.createElement("small",null,"Suppress push notifications for this session")),React.createElement("in\
put",{type:"checkbox",checked:!!x.muted,disabled:N,onChange:()=>w({muted:!x.muted})})),React.createElement("div",{className:"\
session-management-actions"},React.createElement("button",{disabled:N,onClick:()=>w({display_name:b})},"Save name"),React.
createElement("button",{className:x.archived?"":"danger",disabled:N,onClick:()=>w({archived:!x.archived})},x.archived?"R\
estore to sidebar":"Hide from sidebar")),React.createElement("div",{className:"session-management-actions session-export\
-actions","aria-label":"Export session"},React.createElement("button",{disabled:!!S,onClick:()=>E("markdown")},S==="mark\
down"?"Preparing\u2026":"Download Markdown"),React.createElement("button",{disabled:!!S,onClick:()=>E("json")},S==="json"?
"Preparing\u2026":"Download JSON")))),!!d&&React.createElement("div",{className:"settings-error",role:"alert"},d),React.
createElement("div",{className:"settings-note"},"Names, pinned order, hidden state, and mute settings sync across web an\
d Android.")))}function Sv({sessionId:e,initialContent:t,jobs:n,onSchedule:s,onCancel:a,onCreated:i,onClose:c}){let[u,f]=le(
t||""),[b,k]=le("idle"),[N,A]=le(()=>{let w=new Date(Date.now()+36e5);return new Date(w.getTime()-w.getTimezoneOffset()*
6e4).toISOString().slice(0,16)}),[S,M]=le(""),[d,v]=le(!1);async function g(w){w.preventDefault(),v(!0),M("");try{await s(
e,u,b,b==="at"?new Date(N).toISOString():null),i?.(),f("")}catch(E){M(E.message)}finally{v(!1)}}async function x(w){try{
await a(w)}catch(E){M(E.message)}}return React.createElement("div",{className:"settings-panel scheduled-send-panel","dat\
a-testid":"scheduled-send-panel"},React.createElement("div",{className:"settings-panel-header"},React.createElement("spa\
n",null,"Schedule message"),React.createElement("button",{className:"settings-panel-close",onClick:c,title:"Close"},"\xD7")),
React.createElement("form",{className:"settings-panel-body",onSubmit:g},React.createElement("label",{className:"settings\
-row session-management-field"},React.createElement("span",{className:"settings-label"},"Message"),React.createElement("\
textarea",{value:u,maxLength:524288,onChange:w=>f(w.target.value)})),React.createElement("label",{className:"settings-ro\
w session-management-field"},React.createElement("span",{className:"settings-label"},"Deliver"),React.createElement("sel\
ect",{value:b,onChange:w=>k(w.target.value)},React.createElement("option",{value:"idle"},"When session is next idle"),React.
createElement("option",{value:"at"},"At a specific time"))),b==="at"&&React.createElement("label",{className:"settings-r\
ow session-management-field"},React.createElement("span",{className:"settings-label"},"Local time"),React.createElement(
"input",{type:"datetime-local",value:N,onChange:w=>A(w.target.value)})),React.createElement("div",{className:"session-ma\
nagement-actions"},React.createElement("button",{type:"submit",disabled:d||!u.trim()},d?"Scheduling\u2026":"Schedule")),
!!S&&React.createElement("div",{className:"settings-error",role:"alert"},S),!!n.length&&React.createElement("div",{className:"\
scheduled-send-list"},React.createElement("strong",null,"Pending"),n.map(w=>React.createElement("div",{className:"schedu\
led-send-row",key:w.id},React.createElement("span",null,w.trigger_kind==="idle"?"Next idle":new Date(w.deliver_at).toLocaleString(),
" \xB7 ",w.content),React.createElement("button",{type:"button",onClick:()=>x(w.id),disabled:w.state!=="pending"},w.state===
"dispatching"?"Sending\u2026":"Cancel"))))))}function Nv({session:e,config:t,configControlStates:n,onRequestRefresh:s,onSetModel:a,
onSetEffort:i,onSetPermissionMode:c,onSetAutoApprovePermissions:u,onSetMode:f,onSetCodexConfig:b,onSwitchWorkspace:k,onClose:N}){
let[A,S]=React.useState(!1),[M,d]=React.useState(null),v=Pe(e),g=j=>n?.[`${v}:${j}`]||null,x=j=>j&&(j.status==="pending"||
j.status==="awaiting_config"),w=g("model"),E=g("permission_mode"),T=g("effort"),U=g("auto_approve_permissions"),Y=g("mod\
e"),re=g("speed"),ee=g("access_mode"),ae=g("permission_profile"),W=g("workspace"),ie=[w,E,T,U,Y,re,ee,ae,W].find(j=>x(j)||
j?.status==="failed"),ge=ie?x(ie)?`Saving ${ie.field.replace(/_/g," ")}\u2026`:ie.error:null,X=e&&typeof e=="object"?e.agent_type:
null,we=t?.capabilities||{},ve=X==="codex_cli"&&t?.config_semantics==="observed_and_next_send",Z=X==="codex",Se=!Z||t?.controls_available!==
!1,Q=t?.model_id||"unknown",de=t?.next_send_model_id||"",pe=e&&typeof e=="object"&&e.rate_limited_until||null,J=Array.isArray(
e?.antigravity_quota_models)?e.antigravity_quota_models:[],q=e?.active_quota_model||null,G=t?.permission_mode||"unknown",
te=t?.conversation_mode||"unknown",$=t?.mode&&t.mode!=="unknown"?t.mode:te,H=typeof t?.auto_approve_permissions=="boolea\
n"?t.auto_approve_permissions:!!e?.auto_approve_permissions,fe=X==="codex_cli"?e?.codex_live_owner:null,be=fe?fe.state===
"confirmed"?{interactive_tui:"Interactive terminal active",proxy_app_server:"Headless RAC app-server turn active",rotator_exec:"\
Headless rotator worker active"}[fe.owner_kind]||"Live owner active":fe.state==="multiple"?"Needs attention: multiple ow\
ners":fe.state==="stale"?"Needs attention: stale owner proof":fe.state==="unavailable"?"Ownership startup is not ready":
"No live owner":"Ownership status unavailable",_e=fe?[fe.thread_id?`thread ${fe.thread_id}`:null,fe.turn_id?`turn ${fe.turn_id}`:
null,fe.root_pid?`PID ${fe.root_pid}`:null,fe.reason||null].filter(Boolean).join(" \xB7 "):"",Ne=t?.effort||null,Le=t?.next_send_effort||
"",Ae=t?.file_access_scope||"unknown",He=au(X,t),ce=Io(X,t),je=X==="claude"||X==="claude_cli"?su:X==="codex_cli"?fu:X===
"cursor_cli"?gu:X==="antigravity"||X==="antigravity_panel"?af:X==="gemini"?rf:[];t?.available_models&&Array.isArray(t.available_models)&&
t.available_models.length>0&&(je=t.available_models.map(j=>typeof j=="string"?{id:j,label:j}:j)),React.useEffect(()=>{v&&
s(v)},[v]);function F(j){!j||j===(ve?de:Q)||a(v,j)}function ne(j){!j||j===G||c(v,j)}function Ce(j){!j||j===(ve?Le:Ne)||i&&
i(v,j)}function Ue(j){!j||j===$||f&&f(v,j)}function Nt(j){H!==!!j&&u&&u(v,!!j)}function Jt(j,yt=!1){if(!(!j||j===t?.permission_profile)){
if(j==="full-access"&&!yt){S(!0);return}j==="full-access"&&d(t?.permission_profile&&t.permission_profile!=="full-access"?
t.permission_profile:"auto"),S(!1),b?.({permission_profile:j,...yt?{confirm_bypass:!0}:{}})}}return React.createElement(
"div",{className:"settings-panel"},React.createElement("div",{className:"settings-panel-header"},React.createElement("sp\
an",null,"Session Settings"),React.createElement("button",{className:"settings-panel-close",onClick:N,title:"Close"},"\u2715")),
React.createElement("div",{className:"settings-panel-body"},X==="codex_cli"&&React.createElement("div",{className:"setti\
ngs-row","data-testid":"codex-live-owner-status"},React.createElement("span",{className:"settings-label"},"Live owner"),
React.createElement("span",{className:`settings-value${["multiple","stale","unavailable"].includes(fe?.state)?" error":""}`,
title:_e},be)),X==="codex_cli"&&React.createElement("div",{className:"settings-row","data-testid":"codex-headless-send-m\
ode"},React.createElement("span",{className:"settings-label"},"Remote sends"),React.createElement("span",{className:"set\
tings-value",title:t?.send_execution_detail},t?.send_execution_label||"Headless / out-of-process"),React.createElement("\
span",{className:"settings-value small"},"Interactive TUI may stay idle")),pe&&React.createElement("div",{className:"set\
tings-rl-banner"},React.createElement("span",{className:"settings-rl-icon"},"\u26A0"),React.createElement("span",{className:"\
settings-rl-text"},"Rate limited",pe!=="unknown"?React.createElement(React.Fragment,null," \u2014 available after ",React.
createElement("strong",null,pe)):React.createElement(React.Fragment,null," \u2014 reset time unknown"))),React.createElement(
"div",{className:"settings-row"},React.createElement("span",{className:"settings-label"},ve?"Observed model":"Model"),React.
createElement("div",{className:"settings-model-wrap"},ve?React.createElement("span",{className:`settings-value${Q==="unk\
nown"?" dim":""}`,title:t?.model_provenance?.source||"No exact native metadata observed"},Q):we.set_model&&je.length>0?React.
createElement("select",{className:"settings-perm-select",value:Q,disabled:x(w),onChange:j=>F(j.target.value)},je.map(j=>React.
createElement("option",{key:j.id,value:j.id},j.label)),X!=="antigravity"&&X!=="gemini"&&!je.some(j=>j.id===Q)&&Q!=="unkn\
own"&&React.createElement("option",{value:Q},Q)):React.createElement("span",{className:`settings-value${Q==="unknown"?" \
dim":""}`},Q),pe&&React.createElement("span",{className:"model-rl-badge",title:`Rate limited${pe!=="unknown"?` \u2014 resets \
at ${pe}`:""}`},"\u26A0")),w?.status==="ok"&&React.createElement("span",{className:"settings-inline-ok"},"Saved")),ve&&we.
set_model&&je.length>0&&React.createElement("div",{className:"settings-row"},React.createElement("span",{className:"sett\
ings-label"},"Next send model"),React.createElement("select",{className:"settings-perm-select",value:de,disabled:x(w),onChange:j=>F(
j.target.value)},React.createElement("option",{value:"",disabled:!0},"Choose model\u2026"),je.map(j=>React.createElement(
"option",{key:j.id,value:j.id},j.label))),React.createElement("span",{className:`settings-value small${t?.next_send_model_status===
"failed"?" error":""}`},t?.next_send_model_status||"unset")),(X==="antigravity"||X==="antigravity_panel")&&J.length>0&&React.
createElement("div",{className:"settings-row",style:{alignItems:"flex-start"}},React.createElement("span",{className:"se\
ttings-label"},"Quotas"),React.createElement("div",{style:{display:"flex",flexDirection:"column",gap:6,flex:1,minWidth:0}},
e?.available_ai_credits!=null&&React.createElement("span",{className:"settings-value"},"AI credits: ",e.available_ai_credits),
React.createElement("div",{style:{display:"flex",flexWrap:"wrap",gap:6}},J.map((j,yt)=>{let Dt=j?.percent_used,hn=Jm(j?.
model),On=Dt>=90?"#f85149":Dt>=75?"#d29922":"#8b949e",Dn=!!q&&q===j?.model;return React.createElement("span",{key:j?.model||
`quota-${yt}`,className:"composer-hint",title:j?.refreshes_in?`${j.model} \xB7 resets in ${j.refreshes_in}`:j?.model||"",
style:{color:On,border:`1px solid ${Dn?On:"#30363d"}`,borderRadius:999,padding:"2px 8px",background:Dn?`${On}18`:"rgba(1\
10,118,129,0.08)"}},hn," ",Dt!=null?`${Dt}%`:"n/a")})))),(X==="antigravity"||X==="antigravity_panel")&&React.createElement(
"div",{className:"settings-row"},React.createElement("span",{className:"settings-label"},"Mode"),React.createElement("se\
lect",{className:"settings-perm-select",value:$==="unknown"?"Planning":$,disabled:x(Y),onChange:j=>Ue(j.target.value)},hu.
map(j=>React.createElement("option",{key:j.id,value:j.id},j.label))),Y?.status==="ok"&&React.createElement("span",{className:"\
settings-inline-ok"},"Saved")),Oo(X)&&we.set_mode&&ce.length>0&&React.createElement("div",{className:"settings-row"},React.
createElement("span",{className:"settings-label"},"Mode"),React.createElement("select",{className:"settings-perm-select",
value:$==="unknown"?ce[0].id:$,disabled:x(Y),onChange:j=>Ue(j.target.value)},ce.map(j=>React.createElement("option",{key:j.
id,value:j.id},j.label)),$!=="unknown"&&!ce.some(j=>j.id===$)&&React.createElement("option",{value:$},$)),Y?.status==="o\
k"&&React.createElement("span",{className:"settings-inline-ok"},"Saved")),(X==="claude"||X==="claude_cli"||X==="codex_cl\
i"||X==="cursor_cli"||X==="continue_yolo"||Oo(X))&&React.createElement("div",{className:"settings-row"},React.createElement(
"span",{className:"settings-label"},"Permission mode"),we.permission_mode_change&&He.length>0?React.createElement("selec\
t",{className:"settings-perm-select",value:G==="unknown"?sf(X):G,disabled:x(E),onChange:j=>ne(j.target.value)},He.map(j=>React.
createElement("option",{key:j.value,value:j.value},j.label)),!He.some(j=>j.value===G)&&G!=="unknown"&&React.createElement(
"option",{value:G},G)):React.createElement("span",{className:`settings-value${G==="unknown"?" dim":""}`},G),E?.status===
"ok"&&React.createElement("span",{className:"settings-inline-ok"},"Saved")),X==="codex_cli"&&t?.approval_policy&&React.createElement(
"div",{className:"settings-row"},React.createElement("span",{className:"settings-label"},"Approval policy"),React.createElement(
"span",{className:"settings-value"},t.approval_policy)),X==="claude"&&Ne&&Ne!=="unknown"&&React.createElement("div",{className:"\
settings-row"},React.createElement("span",{className:"settings-label"},"Effort"),React.createElement("span",{className:"\
settings-value"},((t?.available_efforts||[]).find(j=>j.id===Ne)||{}).label||Ne)),(X==="claude_cli"||X==="codex_cli"||X===
"cursor_cli")&&we.set_effort&&(t?.available_efforts||[]).length>0&&React.createElement("div",{className:"settings-row"},
React.createElement("span",{className:"settings-label"},ve?"Observed effort":"Effort"),ve?React.createElement("span",{className:`\
settings-value${!Ne||Ne==="unknown"?" dim":""}`,title:t?.effort_provenance?.source||"No exact native metadata observed"},
Ne||"unknown"):React.createElement("select",{className:"settings-perm-select",value:Ne||"medium",disabled:x(T),onChange:j=>Ce(
j.target.value)},(t.available_efforts||[]).map(j=>React.createElement("option",{key:j.id,value:j.id},j.label))),T?.status===
"ok"&&React.createElement("span",{className:"settings-inline-ok"},"Saved")),ve&&we.set_effort&&(t?.available_efforts||[]).
length>0&&React.createElement("div",{className:"settings-row"},React.createElement("span",{className:"settings-label"},"\
Next send effort"),React.createElement("select",{className:"settings-perm-select",value:Le,disabled:x(T),onChange:j=>Ce(
j.target.value)},React.createElement("option",{value:"",disabled:!0},"Choose effort\u2026"),(t.available_efforts||[]).map(
j=>React.createElement("option",{key:j.id,value:j.id},j.label))),React.createElement("span",{className:`settings-value s\
mall${t?.next_send_effort_status==="failed"?" error":""}`},t?.next_send_effort_status&&t.next_send_effort_status!=="unse\
t"?t.next_send_effort_status:"No override selected")),(X==="codex"||X==="codex-desktop")&&we.set_codex_config&&React.createElement(
React.Fragment,null,we.codex_model_change&&(t?.available_models||[]).length>0&&React.createElement("div",{className:"set\
tings-row"},React.createElement("span",{className:"settings-label"},Z?"Next turn model":"Model"),React.createElement("se\
lect",{className:"settings-perm-select",value:t?.model_id||"unknown",disabled:x(w)||!Se,onChange:j=>{b?.({model_id:j.target.
value})}},(t?.available_models||[]).map(j=>React.createElement("option",{key:j.id,value:j.id},j.label)),t?.model_id&&!(t?.
available_models||[]).some(j=>j.id===t.model_id)&&t.model_id!=="unknown"&&React.createElement("option",{value:t.model_id},
t.model_id)),w?.status==="ok"&&React.createElement("span",{className:"settings-inline-ok"},"Saved")),we.codex_effort_change&&
(t?.available_efforts||[]).length>0&&React.createElement("div",{className:"settings-row"},React.createElement("span",{className:"\
settings-label"},Z?"Next turn effort":"Effort"),React.createElement("select",{className:"settings-perm-select",value:(t?.
effort||"unknown").toLowerCase(),disabled:x(T)||!Se,onChange:j=>{b?.({effort:j.target.value})}},(t?.available_efforts||[]).
map(j=>React.createElement("option",{key:j.id,value:j.id},j.label))),T?.status==="ok"&&React.createElement("span",{className:"\
settings-inline-ok"},"Saved")),we.codex_permission_profile_change&&(t?.available_permission_profiles||[]).length>0&&React.
createElement("div",{className:"settings-row"},React.createElement("span",{className:"settings-label"},"Next turn permis\
sions"),React.createElement("select",{className:"settings-perm-select",value:t?.permission_profile||"unknown",disabled:x(
ae)||!Se,onChange:j=>Jt(j.target.value)},(t?.available_permission_profiles||[]).map(j=>React.createElement("option",{key:j.
id,value:j.id},j.label))),ae?.status==="ok"&&React.createElement("span",{className:"settings-inline-ok"},"Saved")),A&&React.
createElement("div",{className:"settings-bypass-confirmation",role:"alert"},React.createElement("strong",null,"Enable By\
pass permissions?"),React.createElement("span",null,"Full access sets approval policy to Never and sandbox access to dan\
ger-full-access for this Codex conversation."),React.createElement("div",{className:"settings-bypass-actions"},React.createElement(
"button",{type:"button",onClick:()=>S(!1)},"Cancel"),React.createElement("button",{type:"button",className:"danger",onClick:()=>Jt(
"full-access",!0)},"Enable Full access"))),Z&&t?.bypass_permissions_active&&(M||t?.bypass_restore_profile)&&React.createElement(
"div",{className:"settings-row"},React.createElement("span",{className:"settings-label"},"Bypass permissions"),React.createElement(
"button",{type:"button",className:"settings-restore-safe",disabled:x(ae),onClick:()=>Jt(M||t.bypass_restore_profile)},"R\
estore previous safe permissions")),Z&&React.createElement(React.Fragment,null,React.createElement("div",{className:"set\
tings-row"},React.createElement("span",{className:"settings-label"},"Approval policy"),React.createElement("span",{className:"\
settings-value"},t?.approval_policy||"Native custom policy")),React.createElement("div",{className:"settings-row"},React.
createElement("span",{className:"settings-label"},"Access / sandbox"),React.createElement("span",{className:"settings-va\
lue"},t?.permission_mode||"Native custom access")),!Se&&React.createElement("div",{className:"settings-control-unavailab\
le",role:"status"},t?.controls_unavailable_reason||"Codex controls are unavailable for this conversation.")),we.codex_access_change&&
(t?.available_access||[]).length>0&&React.createElement("div",{className:"settings-row"},React.createElement("span",{className:"\
settings-label"},"Access"),React.createElement("select",{className:"settings-perm-select",value:t?.permission_mode||"unk\
nown",disabled:x(ee),onChange:j=>{b?.({access_mode:j.target.value})}},(t?.available_access||[]).map(j=>React.createElement(
"option",{key:j.id,value:j.id},j.label)))),we.codex_speed_change&&(t?.available_speeds||[]).length>0&&React.createElement(
"div",{className:"settings-row"},React.createElement("span",{className:"settings-label"},"Speed"),React.createElement("s\
elect",{className:"settings-perm-select",value:(t?.speed||"standard").toLowerCase(),disabled:x(re),onChange:j=>{b?.({speed:j.
target.value})}},(t?.available_speeds||[]).map(j=>React.createElement("option",{key:j.id,value:j.id},j.label)))),X==="co\
dex-desktop"&&t?.branch&&t.branch!=="unknown"&&React.createElement("div",{className:"settings-row"},React.createElement(
"span",{className:"settings-label"},"Branch"),React.createElement("span",{className:"settings-value"},t.branch)),X==="co\
dex-desktop"&&t?.sandbox_status&&React.createElement("div",{className:"settings-row"},React.createElement("span",{className:"\
settings-label"},"Sandbox"),React.createElement("span",{className:`settings-value${t.sandbox_status.active?"":" dim"}`},
t.sandbox_status.active?"\u{1F7E2}":"\u26AA"," ",t.sandbox_status.label||(t.sandbox_status.active?"Active":"Inactive"))),
X==="codex-desktop"&&(t?.available_workspaces||[]).length>0&&React.createElement("div",{className:"settings-row"},React.
createElement("span",{className:"settings-label"},"Workspace"),React.createElement("select",{className:"settings-perm-se\
lect",value:t?.file_access_scope||"",disabled:x(W),onChange:j=>{k&&k(v,j.target.value)}},(t.available_workspaces||[]).map(
j=>React.createElement("option",{key:j.id,value:j.path||j.id},j.label)))),ge&&React.createElement("div",{className:"sett\
ings-row"},React.createElement("span",{className:ie?.status==="failed"?"settings-error":"settings-inline-ok",role:"statu\
s"},ge))),(X==="codex"||X==="codex-desktop")&&!we.set_codex_config&&React.createElement("div",{className:"settings-row"},
React.createElement("span",{className:"settings-label"},"Access"),React.createElement("span",{className:`settings-value${G===
"unknown"?" dim":""}`},G)),eu(X)&&t?.mode&&t.mode!=="unknown"&&React.createElement("div",{className:"settings-row"},React.
createElement("span",{className:"settings-label"},"Mode"),React.createElement("span",{className:"settings-value"},t.mode)),
we.auto_approve_permissions_toggle&&React.createElement("div",{className:"settings-row settings-row-checkbox"},React.createElement(
"span",{className:"settings-label"},"Tool Prompts"),React.createElement("label",{className:"settings-checkbox"},React.createElement(
"input",{type:"checkbox",checked:H,disabled:x(U),onChange:j=>Nt(j.target.checked)}),React.createElement("span",null,"Aut\
o-approve permission prompts")),U?.status==="ok"&&React.createElement("span",{className:"settings-inline-ok"},"Saved")),
(()=>{let j=Ae!=="unknown"?Ae:e?.workspace_name||e?.window_title||null;return React.createElement("div",{className:"sett\
ings-row"},React.createElement("span",{className:"settings-label"},"Workspace"),React.createElement("span",{className:`s\
ettings-value small${j?"":" dim"}`,title:j||""},j?Ae!=="unknown"&&j.split(/[\\/]/).pop()||j:"\u2014"))})(),ge&&!(X==="co\
dex"||X==="codex-desktop")&&React.createElement("div",{className:ie?.status==="failed"?"settings-error":"settings-inline\
-ok",role:"status"},ge)),React.createElement("div",{className:"settings-panel-footer"},React.createElement("button",{className:"\
settings-refresh",onClick:()=>{v&&s(v)}},"\u21BB Refresh")))}function Cv({chats:e,sessionId:t,onSwitch:n,onNew:s,onClose:a}){
return React.createElement("div",{className:"chat-list-panel"},React.createElement("div",{className:"chat-list-header"},
React.createElement("span",{className:"chat-list-title"},"Conversations"),React.createElement("button",{className:"chat-\
list-new-btn",onClick:s,title:"New conversation"},"+"),React.createElement("button",{className:"chat-list-close-btn",onClick:a,
title:"Close"},"\u2715")),React.createElement("div",{className:"chat-list-body"},!e||e.length===0?React.createElement("d\
iv",{className:"chat-list-empty"},"No conversations found"):e.map((i,c)=>React.createElement("button",{key:i.id||c,className:`\
chat-list-item${i.active?" active":""}`,onClick:()=>n(i.id),title:i.title},React.createElement("span",{className:"chat-l\
ist-item-title"},i.title),i.active&&React.createElement("span",{className:"chat-list-item-active"},"\u25CF")))))}function Xl({
items:e,onNavigate:t,onNew:n,onClose:s,embedded:a=!1,loading:i=!1}){let c=Array.isArray(e)?e:[],u=c.filter(g=>g?.kind===
"nav"),f=c.filter(g=>g?.kind==="project"),b=c.filter(g=>!g?.kind||g.kind==="chat"),k=c.filter(g=>g?.kind==="see_all"),N=[],
A=new Map;f.forEach(g=>{let x=g.project_index!=null?`idx:${g.project_index}`:`name:${g.project||g.title||"Project"}`;A.has(
x)||(N.push(x),A.set(x,g.title||g.project||"Project"))}),b.forEach(g=>{let x=g.project_index!=null?`idx:${g.project_index}`:
`name:${g.project||"Other"}`;A.has(x)||(N.push(x),A.set(x,g.project||"Other"))});let S=b.filter(g=>g.project_index==null&&
!g.project);function M(g){return g==="new_conversation"?"New Conversation":g==="conversation_history"?"Conversation Hist\
ory":g==="scheduled_tasks"?"Scheduled Tasks":"Agent Manager"}function d(g,x){return React.createElement("button",{key:g.
id||x,className:`agv2-chat-item${g.active?" active":""}`,type:"button",onClick:()=>t(g.id),title:g.title||"Untitled"},React.
createElement("span",{className:"agv2-chat-title"},g.title||"Untitled"),g.age&&React.createElement("span",{className:"ag\
v2-chat-age"},g.age),g.active&&React.createElement("span",{className:"agv2-chat-active"},"\u25CF"))}let v=React.createElement(
React.Fragment,null,React.createElement("div",{className:"agv2-nav-actions"},(u.length?u:[{id:"__agv2:new_conversation",
action:"new_conversation"},{id:"__agv2:conversation_history",action:"conversation_history"},{id:"__agv2:scheduled_tasks",
action:"scheduled_tasks"}]).map(g=>React.createElement("button",{key:g.id||g.action,className:`agv2-nav-action ${g.action||
""}`,type:"button",onClick:()=>g.action==="new_conversation"?n():t(g.id)},React.createElement("span",{className:"agv2-na\
v-action-icon"},g.action==="new_conversation"?"+":g.action==="scheduled_tasks"?"\u25F7":"\u21BA"),React.createElement("s\
pan",null,g.title||M(g.action))))),React.createElement("div",{className:"agv2-project-list"},N.length===0&&S.length===0?
React.createElement("div",{className:"chat-list-empty"},i?"Loading conversations...":"No projects or conversations found"):
React.createElement(React.Fragment,null,N.map(g=>{let x=A.get(g)||"Project",w=b.filter(T=>(T.project_index!=null?`idx:${T.
project_index}`:`name:${T.project||"Other"}`)===g),E=k.filter(T=>(T.project_index!=null?`idx:${T.project_index}`:`name:${T.
project||"Other"}`)===g);return React.createElement("section",{className:"agv2-project-section",key:g},React.createElement(
"div",{className:"agv2-project-header"},React.createElement("span",{className:"agv2-project-icon"},"\u2302"),React.createElement(
"span",{className:"agv2-project-title"},x)),React.createElement("div",{className:"agv2-project-chats"},w.length===0?React.
createElement("div",{className:"agv2-project-empty"},"No visible conversations"):w.map(d),E.map(T=>React.createElement("\
button",{key:T.id,className:"agv2-see-all",type:"button",onClick:()=>t(T.id)},T.title||"See all"))))}),S.length>0&&React.
createElement("section",{className:"agv2-project-section"},React.createElement("div",{className:"agv2-project-header"},React.
createElement("span",{className:"agv2-project-icon"},"\u2302"),React.createElement("span",{className:"agv2-project-title"},
"Other")),React.createElement("div",{className:"agv2-project-chats"},S.map(d))))));return a?React.createElement("div",{className:"\
agv2-nav-embedded"},v):React.createElement("div",{className:"chat-list-panel agv2-nav-panel"},React.createElement("div",
{className:"chat-list-header"},React.createElement("span",{className:"chat-list-title"},"Antigravity Agent Manager"),React.
createElement("button",{className:"chat-list-new-btn",onClick:n,title:"New conversation"},"+"),React.createElement("butt\
on",{className:"chat-list-close-btn",onClick:s,title:"Close"},"\u2715")),React.createElement("div",{className:"chat-list\
-body agv2-nav-body"},v))}function xv({threads:e,sessionId:t,onSwitch:n,onNew:s,onClose:a,newLabel:i="New thread"}){return React.
createElement("div",{className:"chat-list-panel"},React.createElement("div",{className:"chat-list-header"},React.createElement(
"span",{className:"chat-list-title"},"Threads"),React.createElement("button",{className:"chat-list-new-btn",onClick:s,title:i},
"+"),React.createElement("button",{className:"chat-list-close-btn",onClick:a,title:"Close"},"\u2715")),React.createElement(
"div",{className:"chat-list-body"},!e||e.length===0?React.createElement("div",{className:"chat-list-empty"},"No threads \
found"):e.map((c,u)=>React.createElement("button",{key:c.cache_key||c.id||u,className:`chat-list-item${c.active?" active":
""}`,onClick:()=>n(c.id),title:c.title},React.createElement("span",{className:"chat-list-item-title"},c.title),c.age&&React.
createElement("span",{className:"chat-list-item-age"},c.age),c.active&&React.createElement("span",{className:"chat-list-\
item-active"},"\u25CF")))))}function Av({threads:e,activeThreadId:t,onSwitch:n,onNew:s,onOpenHistory:a,showDraftTab:i=!1,
newLabel:c="New chat"}){return React.createElement("div",{className:"thread-tabs-bar"},React.createElement("div",{className:"\
thread-tabs-scroll"},i&&React.createElement("button",{className:"thread-tab active draft",type:"button",title:c},React.createElement(
"span",{className:"thread-tab-title"},c)),(e||[]).map((u,f)=>{let b=t?u.id===t:!!u.active;return React.createElement("bu\
tton",{key:u.cache_key||u.id||f,className:`thread-tab${b?" active":""}`,type:"button",title:u.title||"Untitled",onClick:()=>n(
u.id)},React.createElement("span",{className:"thread-tab-title"},u.title||"Untitled"),u.age&&React.createElement("span",
{className:"thread-tab-age"},u.age))})),React.createElement("div",{className:"thread-tabs-actions"},React.createElement(
"button",{className:"thread-tabs-btn",type:"button",onClick:a,title:"Show all threads"},"All"),React.createElement("butt\
on",{className:"thread-tabs-btn accent",type:"button",onClick:s,title:c},"+")))}function Rv({branchData:e,sessionId:t,currentBranch:n,
onSwitch:s,onCreate:a,onClose:i}){let[c,u]=React.useState(""),[f,b]=React.useState(!1),[k,N]=React.useState(""),A=e?.branches||
[],S=e?.current||n||"",M=c?A.filter(d=>d.toLowerCase().includes(c.toLowerCase())):A;return React.createElement("div",{className:"\
branch-selector-panel"},React.createElement("div",{className:"branch-selector-header"},React.createElement("span",{className:"\
branch-selector-title"},"Branches"),React.createElement("button",{className:"chat-list-close-btn",onClick:i,title:"Close"},
"\u2715")),React.createElement("div",{className:"branch-selector-search"},React.createElement("input",{type:"text",className:"\
branch-search-input",placeholder:"Search branches\u2026",value:c,onChange:d=>u(d.target.value),autoFocus:!0})),React.createElement(
"div",{className:"branch-selector-body"},M.length===0&&!f&&React.createElement("div",{className:"chat-list-empty"},"No b\
ranches found"),M.map((d,v)=>React.createElement("button",{key:d,className:`branch-item${d===S?" active":""}`,onClick:()=>{
d!==S&&s(d)},title:d},React.createElement("span",{className:"branch-item-icon"},d===S?"\u2713":""),React.createElement("\
span",{className:"branch-item-name"},d)))),React.createElement("div",{className:"branch-selector-footer"},f?React.createElement(
"form",{className:"branch-create-form",onSubmit:d=>{d.preventDefault(),k.trim()&&(a(k.trim()),b(!1),N(""))}},React.createElement(
"input",{type:"text",className:"branch-create-input",placeholder:"new-branch-name",value:k,onChange:d=>N(d.target.value),
autoFocus:!0}),React.createElement("button",{type:"submit",className:"branch-create-submit",disabled:!k.trim()},"Create"),
React.createElement("button",{type:"button",className:"branch-create-cancel",onClick:()=>{b(!1),N("")}},"\u2715")):React.
createElement("button",{className:"branch-create-btn",onClick:()=>b(!0)},"+ Create and checkout new branch")))}function Mv({
entries:e,canRead:t,canInput:n,onClose:s,onRefresh:a,onSend:i,controlResults:c}){let[u,f]=le(""),[b,k]=le(null),N=b?c?.[b]:
null;function A(S){S.preventDefault();let M=u.trim();!M||!i||(k(i(M)),f(""))}return React.createElement("div",{className:"\
terminal-viewer"},React.createElement("div",{className:"terminal-viewer-header"},React.createElement("span",{className:"\
terminal-viewer-title"},"Terminal"),t&&React.createElement("button",{className:"terminal-viewer-refresh",onClick:a,title:"\
Refresh"},"\u21BB"),React.createElement("button",{className:"terminal-viewer-close",onClick:s,title:"Close"},"\u2715")),
t?React.createElement("div",{className:"terminal-viewer-body"},!e||e.length===0?React.createElement("div",{className:"te\
rminal-viewer-empty"},"No terminal output captured"):e.map((S,M)=>React.createElement("div",{key:M,className:"terminal-e\
ntry"},S.command&&React.createElement("div",{className:"terminal-command"},"$ ",S.command),React.createElement("pre",{className:"\
terminal-output"},S.output)))):React.createElement("div",{className:"terminal-viewer-empty"},"Terminal output is unavail\
able for this harness."),n&&React.createElement("form",{className:"terminal-input-form",onSubmit:A},React.createElement(
"input",{className:"terminal-input",type:"text",value:u,onChange:S=>f(S.target.value),placeholder:"Enter a command in th\
is session's terminal","aria-label":"Terminal command"}),React.createElement("button",{className:"terminal-input-send",type:"\
submit",disabled:!u.trim()},"Run"),b&&React.createElement("div",{className:`terminal-input-status ${N?.result||"pending"}`,
role:"status"},N?N.result==="ok"?"Command sent":`Command failed: ${N.error?.message||N.error?.code||"unknown error"}`:"C\
ommand pending\u2026")))}function Tv({entries:e,onClose:t,onRefresh:n,onAccept:s,onReject:a}){let i=c=>{let u=String(c||
"").trim();return u?u.split(/\s+/).filter(Boolean).map(f=>({text:f,cls:f.startsWith("+")?"add":f.startsWith("-")?"del":"\
neutral"})):[]};return React.createElement("div",{className:"diff-viewer"},React.createElement("div",{className:"diff-vi\
ewer-header"},React.createElement("span",{className:"diff-viewer-title"},"File Changes"),React.createElement("button",{className:"\
diff-viewer-refresh",onClick:n,title:"Refresh"},"\u21BB"),React.createElement("button",{className:"diff-viewer-close",onClick:t,
title:"Close"},"\u2715")),React.createElement("div",{className:"diff-viewer-body"},!e||e.length===0?React.createElement(
"div",{className:"diff-viewer-empty"},"No file changes detected"):e.map((c,u)=>React.createElement("div",{key:u,className:"\
diff-entry"},c.file&&React.createElement("div",{className:"diff-file-header"},React.createElement("span",null,c.file||c.
path),(c.can_accept||c.can_reject)&&s&&a&&React.createElement("span",{className:"diff-file-actions"},c.can_accept&&React.
createElement("button",{type:"button",className:"diff-action-accept",onClick:()=>s(c.id||c.path)},"Accept"),c.can_reject&&
React.createElement("button",{type:"button",className:"diff-action-reject",onClick:()=>a(c.id||c.path)},"Reject"))),c.summary&&
React.createElement("div",{className:"diff-file-summary"},i(c.summary).map((f,b)=>React.createElement("span",{key:b,className:`\
diff-file-summary-chip diff-file-summary-chip-${f.cls}`},f.text))),c.content?React.createElement("pre",{className:"diff-\
content"},c.content.split(`
`).map((f,b)=>{let k=f.startsWith("+")?"diff-add":f.startsWith("-")?"diff-del":f.startsWith("@@")?"diff-hunk":"";return React.
createElement("span",{key:b,className:k},f,`
`)})):!c.summary&&React.createElement("pre",{className:"diff-content"},"No content")))))}var Ql={directory:"\u{1F4C1}",md:"\
\u{1F4C4}",txt:"\u{1F4C4}",json:"\u{1F4CB}",js:"\u{1F4DC}",jsx:"\u{1F4DC}",ts:"\u{1F4DC}",tsx:"\u{1F4DC}",py:"\u{1F40D}",
html:"\u{1F310}",css:"\u{1F3A8}",yml:"\u2699",yaml:"\u2699",toml:"\u2699",sh:"\u26A1",bat:"\u26A1",ps1:"\u26A1",env:"\u{1F512}",
lock:"\u{1F512}",png:"\u{1F5BC}",jpg:"\u{1F5BC}",gif:"\u{1F5BC}",svg:"\u{1F5BC}",default:"\u{1F4C4}"};function $v(e){if(e.
type==="directory")return Ql.directory;let t=e.name.split(".").pop().toLowerCase();return Ql[t]||Ql.default}function Ev(e){
return e==null?"":e<1024?`${e} B`:e<1024*1024?`${(e/1024).toFixed(1)} KB`:`${(e/(1024*1024)).toFixed(1)} MB`}var Lv=new Set(
["md","txt","json","js","jsx","ts","tsx","py","html","css","yml","yaml","toml","sh","bat","ps1","cfg","conf","ini","xml",
"csv","log","env","gitignore","dockerignore","sql","rs","go","java","c","cpp","h","hpp","rb","php","swift","kt","scala",
"r","lua","vim","zsh","bash","fish"]);function Fm(e){let t=e.split(".").pop().toLowerCase();return Lv.has(t)||e.startsWith(
".")}function Pv(e){return e.toLowerCase().endsWith(".md")}function qv({path:e,content:t,truncated:n,onBack:s}){let a=React.
useMemo(()=>{if(!t)return"";try{let u=marked.parse(t);return DOMPurify.sanitize(u)}catch{return`<pre>${DOMPurify.sanitize(
t)}</pre>`}},[t]),i=React.useRef(null);React.useEffect(()=>{i.current&&i.current.querySelectorAll("pre code").forEach(u=>{
hljs.highlightElement(u)})},[a]);let c=e?e.split("/").pop().split("\\").pop():"File";return React.createElement("div",{className:"\
file-viewer"},React.createElement("div",{className:"file-viewer-header"},React.createElement("button",{className:"file-v\
iewer-back",onClick:s,title:"Back to files"},"\u2190"),React.createElement("span",{className:"file-viewer-title",title:e},
c),n&&React.createElement("span",{className:"file-viewer-truncated"},"truncated")),React.createElement("div",{className:"\
file-viewer-body markdown-body",ref:i,dangerouslySetInnerHTML:{__html:a}}))}function Iv({path:e,content:t,truncated:n,onBack:s}){
let a=e?e.split("/").pop().split("\\").pop():"File",i=a.split(".").pop().toLowerCase(),c=React.useMemo(()=>{if(!t)return"";
try{return i&&hljs.getLanguage(i)?hljs.highlight(t,{language:i}).value:hljs.highlightAuto(t).value}catch{return DOMPurify.
sanitize(t)}},[t,i]);return React.createElement("div",{className:"file-viewer"},React.createElement("div",{className:"fi\
le-viewer-header"},React.createElement("button",{className:"file-viewer-back",onClick:s,title:"Back to files"},"\u2190"),
React.createElement("span",{className:"file-viewer-title",title:e},a),n&&React.createElement("span",{className:"file-vie\
wer-truncated"},"truncated")),React.createElement("div",{className:"file-viewer-body"},React.createElement("pre",{className:"\
file-viewer-code"},React.createElement("code",{dangerouslySetInnerHTML:{__html:c}}))))}function Ov(e,t){let n=xr(e||"text"),s=Math.max(...String(t||"").match(/`+/g)?.map(i=>i.length)||[0]),a="`".repeat(Math.
max(3,s+1));return`${a}${n}
${t||""}
${a}`}function Dv({sessionId:e,filePath:t,fileContents:n,onClose:s}){let a=`${e}:${t}`,i=n[a],c=i?.content||"",u=i?.truncated||
!1,f=React.useMemo(()=>Ov(t,c),[t,c]);return React.createElement("div",{className:"transcript-inline-preview"},React.createElement(
"div",{className:"transcript-inline-preview-header"},React.createElement("span",{className:"transcript-inline-preview-ti\
tle",title:t},t),u&&React.createElement("span",{className:"file-viewer-truncated"},"truncated"),React.createElement("but\
ton",{className:"transcript-inline-preview-close",onClick:s,title:"Collapse"},"Collapse")),i?React.createElement(Tr,{content:f,
monospace:!0}):React.createElement("div",{className:"transcript-file-loading"},React.createElement("div",null,"Loading f\
ile preview...")))}function jv({sessionId:e,listing:t,fileContents:n,onNavigate:s,onOpenFile:a,onClose:i,onRefresh:c,viewingFile:u,
onBackToListing:f}){if(u){let A=`${e}:${u}`,S=n[A],M=S?.content||"",d=S?.truncated||!1;return Pv(u)?React.createElement(
qv,{path:u,content:M,truncated:d,onBack:f}):React.createElement(Iv,{path:u,content:M,truncated:d,onBack:f})}let b=t?.entries||
[],k=t?.path||".",N=k==="."?[]:k.replace(/\\/g,"/").split("/").filter(Boolean);return React.createElement("div",{className:"\
file-browser"},React.createElement("div",{className:"file-browser-header"},React.createElement("span",{className:"file-b\
rowser-title"},"Files"),React.createElement("button",{className:"file-browser-refresh",onClick:c,title:"Refresh"},"\u21BB"),
React.createElement("button",{className:"file-browser-close",onClick:i,title:"Close"},"\u2715")),React.createElement("di\
v",{className:"file-browser-breadcrumbs"},React.createElement("button",{className:"breadcrumb-item",onClick:()=>s(".")},
"root"),N.map((A,S)=>{let M=N.slice(0,S+1).join("/");return React.createElement(React.Fragment,{key:M},React.createElement(
"span",{className:"breadcrumb-sep"},"/"),React.createElement("button",{className:"breadcrumb-item",onClick:()=>s(M)},A))})),
React.createElement("div",{className:"file-browser-body"},b.length===0?React.createElement("div",{className:"file-browse\
r-empty"},"Empty directory"):React.createElement("div",{className:"file-browser-list"},k!=="."&&React.createElement("div",
{className:"file-browser-entry",onClick:()=>{let A=N.slice(0,-1).join("/")||".";s(A)}},React.createElement("span",{className:"\
file-entry-icon"},"\u{1F4C1}"),React.createElement("span",{className:"file-entry-name"},"..")),b.map(A=>React.createElement(
"div",{key:A.name,className:`file-browser-entry${A.type==="directory"?" is-dir":""}${Fm(A.name)?" is-viewable":""}`,onClick:()=>{
if(A.type==="directory"){let S=k==="."?A.name:`${k}/${A.name}`;s(S)}else if(Fm(A.name)){let S=k==="."?A.name:`${k}/${A.name}`;
a(S)}}},React.createElement("span",{className:"file-entry-icon"},$v(A)),React.createElement("span",{className:"file-entr\
y-name"},A.name),React.createElement("span",{className:"file-entry-meta"},A.type==="file"&&Ev(A.size)))))))}var Bv={daily:"\
Daily",weekdays:"Weekdays",weekly:"Weekly",custom:"Custom"},ru={"Status reports":"\u{1F4CA}","Release prep":"\u{1F680}",
"Code quality":"\u{1F50D}",Documentation:"\u{1F4DD}",General:"\u2699"};function Fv({automation:e,onEdit:t,onRun:n,onToggle:s}){
let a=ru[e.category]||"\u2699",i=Bv[e.schedule]||e.schedule,c=In[e.target_agent_type]||Zl;return React.createElement("di\
v",{className:`automation-card${e.enabled?"":" disabled"}`,onClick:()=>t(e)},React.createElement("div",{className:"autom\
ation-card-icon"},a),React.createElement("div",{className:"automation-card-body"},React.createElement("div",{className:"\
automation-card-name"},e.name),e.description&&React.createElement("div",{className:"automation-card-desc"},e.description)),
React.createElement("div",{className:"automation-card-meta"},React.createElement("span",{className:"automation-card-agen\
t",style:{color:c.color},title:c.name},c.abbr),React.createElement("span",{className:"automation-card-schedule"},i," ",String(
e.cron_hour).padStart(2,"0"),":",String(e.cron_minute).padStart(2,"0"))),React.createElement("div",{className:"automatio\
n-card-actions",onClick:u=>u.stopPropagation()},React.createElement("button",{className:"automation-run-btn",title:"Run \
now",onClick:()=>n(e)},"\u25B6"),React.createElement("button",{className:`automation-toggle-btn${e.enabled?" on":""}`,title:e.
enabled?"Disable":"Enable",onClick:()=>s(e)},e.enabled?"\u25CF":"\u25CB")))}function Hv({automation:e,sessions:t,onSave:n,
onDelete:s,onClose:a}){let i=!e?.id,[c,u]=le({name:e?.name||"",description:e?.description||"",category:e?.category||"Gen\
eral",prompt:e?.prompt||"",schedule:e?.schedule||"daily",cron_hour:e?.cron_hour??9,cron_minute:e?.cron_minute??0,cron_days:e?.
cron_days||[1,2,3,4,5],target_agent_type:e?.target_agent_type||"claude",target_session:e?.target_session||"",enabled:e?.
enabled!==!1}),[f,b]=le(!1);function k(M,d){u(v=>({...v,[M]:d}))}function N(M){u(d=>{let v=d.cron_days.includes(M)?d.cron_days.
filter(g=>g!==M):[...d.cron_days,M].sort();return{...d,cron_days:v}})}async function A(M){M.preventDefault(),!(!c.name.trim()||
!c.prompt.trim())&&(b(!0),await n({...c,target_session:c.target_session||null}),b(!1))}let S=["Sun","Mon","Tue","Wed","T\
hu","Fri","Sat"];return React.createElement("div",{className:"automation-modal-overlay",onClick:a},React.createElement("\
div",{className:"automation-modal",onClick:M=>M.stopPropagation()},React.createElement("div",{className:"automation-moda\
l-header"},React.createElement("span",null,i?"New Automation":"Edit Automation"),React.createElement("button",{className:"\
automation-modal-close",onClick:a},"\u2715")),React.createElement("form",{className:"automation-modal-form",onSubmit:A},
React.createElement("label",null,React.createElement("span",null,"Name"),React.createElement("input",{type:"text",value:c.
name,onChange:M=>k("name",M.target.value),placeholder:"e.g. Daily standup summary",required:!0})),React.createElement("l\
abel",null,React.createElement("span",null,"Description"),React.createElement("input",{type:"text",value:c.description,onChange:M=>k(
"description",M.target.value),placeholder:"Brief description (optional)"})),React.createElement("label",null,React.createElement(
"span",null,"Category"),React.createElement("select",{value:c.category,onChange:M=>k("category",M.target.value)},Object.
keys(ru).map(M=>React.createElement("option",{key:M,value:M},ru[M]," ",M)))),React.createElement("label",null,React.createElement(
"span",null,"Prompt"),React.createElement("textarea",{rows:4,value:c.prompt,onChange:M=>k("prompt",M.target.value),placeholder:"\
The prompt to send to the agent...",required:!0})),React.createElement("div",{className:"automation-modal-row"},React.createElement(
"label",{className:"half"},React.createElement("span",null,"Target Agent"),React.createElement("select",{value:c.target_agent_type,
onChange:M=>k("target_agent_type",M.target.value)},Object.entries(In).map(([M,d])=>React.createElement("option",{key:M,value:M},
d.name)))),React.createElement("label",{className:"half"},React.createElement("span",null,"Specific Session (optional)"),
React.createElement("select",{value:c.target_session,onChange:M=>k("target_session",M.target.value)},React.createElement(
"option",{value:""},"Any matching session"),(t||[]).map(M=>{let d=typeof M=="string"?M:M?.session_id,v=Fr(M);return React.
createElement("option",{key:d,value:d},v.name,": ",md(d)||d)})))),React.createElement("div",{className:"automation-modal\
-row"},React.createElement("label",{className:"third"},React.createElement("span",null,"Schedule"),React.createElement("\
select",{value:c.schedule,onChange:M=>k("schedule",M.target.value)},React.createElement("option",{value:"daily"},"Daily"),
React.createElement("option",{value:"weekdays"},"Weekdays"),React.createElement("option",{value:"weekly"},"Weekly"),React.
createElement("option",{value:"custom"},"Custom days"))),React.createElement("label",{className:"third"},React.createElement(
"span",null,"Hour"),React.createElement("input",{type:"number",min:0,max:23,value:c.cron_hour,onChange:M=>k("cron_hour",
parseInt(M.target.value)||0)})),React.createElement("label",{className:"third"},React.createElement("span",null,"Minute"),
React.createElement("input",{type:"number",min:0,max:59,value:c.cron_minute,onChange:M=>k("cron_minute",parseInt(M.target.
value)||0)}))),(c.schedule==="custom"||c.schedule==="weekly")&&React.createElement("div",{className:"automation-days-row"},
React.createElement("span",null,"Days:"),S.map((M,d)=>React.createElement("button",{key:d,type:"button",className:`autom\
ation-day-btn${c.cron_days.includes(d)?" active":""}`,onClick:()=>N(d)},M))),React.createElement("div",{className:"autom\
ation-modal-footer"},!i&&React.createElement("button",{type:"button",className:"automation-delete-btn",onClick:()=>s(e)},
"Delete"),React.createElement("div",{style:{flex:1}}),React.createElement("button",{type:"button",className:"automation-\
cancel-btn",onClick:a},"Cancel"),React.createElement("button",{type:"submit",className:"automation-save-btn",disabled:f||
!c.name.trim()||!c.prompt.trim()},f?"Saving...":i?"Create":"Save")))))}function Uv({sessions:e,onBack:t}){let[n,s]=le([]),
[a,i]=le(!0),[c,u]=le(null),[f,b]=le("");function k(g){b(g),setTimeout(()=>b(""),3e3)}async function N(){try{let g=await fetch(
"/api/automations");if(!g.ok)throw new Error("Failed to fetch");let x=await g.json();s(x.automations||[])}catch{k("Faile\
d to load automations")}finally{i(!1)}}Ee(()=>{N()},[]);async function A(g){let x=!c?.id,w=x?"/api/automations":`/api/au\
tomations/${c.id}`,E=x?"POST":"PUT";try{if(!(await fetch(w,{method:E,headers:{"Content-Type":"application/json"},body:JSON.
stringify(g)})).ok)throw new Error("Save failed");k(x?"Automation created":"Automation updated"),u(null),N()}catch{k("Fa\
iled to save automation")}}async function S(g){if(window.confirm(`Delete "${g.name}"?`))try{await fetch(`/api/automation\
s/${g.id}`,{method:"DELETE"}),k("Automation deleted"),u(null),N()}catch{k("Failed to delete")}}async function M(g){try{let x=await fetch(
`/api/automations/${g.id}/run`,{method:"POST"}),w=await x.json();x.ok?k(`Running "${g.name}"...`):k(w.error||"Failed to \
run")}catch{k("Failed to run automation")}}async function d(g){try{await fetch(`/api/automations/${g.id}`,{method:"PUT",
headers:{"Content-Type":"application/json"},body:JSON.stringify({enabled:!g.enabled})}),N()}catch{k("Failed to toggle")}}
let v={};for(let g of n){let x=g.category||"General";v[x]||(v[x]=[]),v[x].push(g)}return React.createElement("div",{className:"\
automations-view"},React.createElement("div",{className:"automations-header"},React.createElement("button",{className:"a\
utomations-back",onClick:t,title:"Back to sessions"},"\u2190"),React.createElement("div",{className:"automations-header-\
text"},React.createElement("h2",null,"Automations"),React.createElement("p",null,"Automate work by sending scheduled pro\
mpts to your agents.")),React.createElement("button",{className:"automations-new-btn",onClick:()=>u({})},"+ New automati\
on")),a?React.createElement("div",{className:"automations-loading"},"Loading automations..."):n.length===0?React.createElement(
"div",{className:"automations-empty"},React.createElement("div",{className:"automations-empty-icon"},"\u2699"),React.createElement(
"div",{className:"automations-empty-text"},"No automations yet"),React.createElement("div",{className:"automations-empty\
-sub"},"Create your first automation to schedule recurring prompts to your agents."),React.createElement("button",{className:"\
automations-new-btn",onClick:()=>u({})},"+ New automation")):React.createElement("div",{className:"automations-body"},Object.
entries(v).map(([g,x])=>React.createElement("div",{key:g,className:"automations-category"},React.createElement("h3",{className:"\
automations-category-title"},g),React.createElement("div",{className:"automations-card-grid"},x.map(w=>React.createElement(
Fv,{key:w.id,automation:w,onEdit:u,onRun:M,onToggle:d})))))),c!==null&&React.createElement(Hv,{automation:c?.id?c:null,sessions:e,
onSave:A,onDelete:S,onClose:()=>u(null)}),f&&React.createElement("div",{className:"automations-toast"},f))}function Gv({
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
createElement("button",{className:"codex-automation-pane-action",onClick:t},e.action_label))}function Dr(e){return new Intl.
NumberFormat([],{notation:"compact",maximumFractionDigits:1}).format(Math.max(0,Number(e)||0))}function Wv({cost:e,detailState:t,
onRequestDetail:n}){let[s,a]=React.useState(1),[i,c]=React.useState(""),u=React.useMemo(()=>kp(e,{days:s,project:i}),[e,
s,i]),f=t?.status==="ready"?t.detail:null,b=!!f&&Number(f.query?.days)===s&&String(f.query?.project||"")===i&&(!e?.generatedAt||
String(f.generated_at||"")===e.generatedAt),k=t?.status==="loading"&&Number(t.query?.days)===s&&String(t.query?.project||
"")===i&&String(t.query?.cursor||"0")==="0",N=b&&String(f.pagination?.cursor||"0")==="0",A=b?{costUsd:Math.max(0,Number(
f.summary?.cost_usd)||0),records:Math.max(0,Number(f.summary?.records)||0),tokens:{input:Math.max(0,Number(f.summary?.tokens?.
input)||0),cached:Math.max(0,Number(f.summary?.tokens?.cached)||0),output:Math.max(0,Number(f.summary?.tokens?.output)||
0)},byModel:Array.isArray(f.summary?.by_model)?f.summary.by_model:[],byDay:Array.isArray(f.summary?.by_day)?f.summary.by_day:
[]}:u;if(React.useEffect(()=>{!e?.detail?.truncated||!n||k||N||n({days:s,project:i,cursor:"0",pageSize:e.detail.pageSize||
256})},[e?.detail?.truncated,e?.detail?.pageSize,e?.generatedAt,s,i,n]),!e)return null;let S=(["ready","partial","stale"].
includes(e.status)||e.status==="scanning"&&!!e.lastGoodGeneratedAt)&&e.costUsd!=null&&e.records!=null&&e.tokens.input!=null&&
e.tokens.cached!=null&&e.tokens.output!=null,M={"not-started":["Not scanned yet","The local cost scan has not completed."],
idle:["Not scanned yet","The local cost scan has not completed."],scanning:["Scanning local history","Provider quota rem\
ains available while cost files are scanned."],error:["Cost scan unavailable","The last cost payload failed its bounded \
structural contract. Provider quota is still current."],unavailable:["Cost scan unavailable","Local cost sources are una\
vailable. Provider quota is still current."],cancelled:["Cost scan cancelled","No zero total is reported because the sca\
n did not complete."]}[e.status]||["Cost data pending","Waiting for an authoritative local cost scan."];if(!S)return React.
createElement("section",{className:"usage-cost-panel","aria-labelledby":"usage-cost-heading"},React.createElement("div",
{className:"usage-cost-heading"},React.createElement("span",null,React.createElement("h3",{id:"usage-cost-heading"},"Loc\
al estimated API-equivalent cost"),React.createElement("small",null,"Separate from subscription quota")),React.createElement(
"span",{className:`usage-cost-status ${e.status}`},e.status)),React.createElement("div",{className:"usage-cost-state",role:"\
status"},React.createElement("strong",null,M[0]),React.createElement("span",null,M[1]),e.reasonCode&&React.createElement(
"small",null,"Reason: ",e.reasonCode,e.reasonPath?` (${e.reasonPath})`:"")),React.createElement("div",{className:"usage-\
cost-scan"},Number.isFinite(Number(e.scan.files_complete))?`Incremental local JSONL scan - ${e.scan.files_complete}/${e.
scan.files_total||0} files`:"Incremental local JSONL scan has not reported file progress."));let d=[...new Set(e.byProject.
map(w=>w.project).filter(Boolean))].sort(),v=[...A?.byModel||[]].sort((w,E)=>E.cost_usd-w.cost_usd).slice(0,12),g=[...A?.
byDay||[]].sort((w,E)=>w.day.localeCompare(E.day)),x=Math.max(1e-6,...g.map(w=>Number(w.cost_usd)||0));return React.createElement(
"section",{className:"usage-cost-panel","aria-labelledby":"usage-cost-heading"},React.createElement("div",{className:"us\
age-cost-heading"},React.createElement("span",null,React.createElement("h3",{id:"usage-cost-heading"},"Local estimated A\
PI-equivalent cost"),React.createElement("small",null,"Separate from subscription quota \xB7 pricing ",e.catalogVersion||
"unavailable")),React.createElement("span",{className:`usage-cost-status ${e.status}`},e.status)),React.createElement("d\
iv",{className:"usage-cost-controls"},React.createElement("label",null,"Range",React.createElement("select",{value:s,onChange:w=>a(
Number(w.target.value))},[1,7,30,90,365].map(w=>React.createElement("option",{key:w,value:w},w===1?"Today":`${w} days`)))),
React.createElement("label",null,"Project",React.createElement("select",{value:i,onChange:w=>c(w.target.value)},React.createElement(
"option",{value:""},"All projects"),d.map(w=>React.createElement("option",{key:w,value:w},w))))),React.createElement("di\
v",{className:"usage-cost-summary"},React.createElement("span",null,React.createElement("strong",null,"$",(A?.costUsd||0).
toFixed(2)),React.createElement("small",null,"estimated cost")),React.createElement("span",null,React.createElement("str\
ong",null,Dr(A?.tokens.input)),React.createElement("small",null,"input tokens")),React.createElement("span",null,React.createElement(
"strong",null,Dr(A?.tokens.cached)),React.createElement("small",null,"cached tokens")),React.createElement("span",null,React.
createElement("strong",null,Dr(A?.tokens.output)),React.createElement("small",null,"output tokens"))),e.detail?.truncated&&
React.createElement("div",{className:"usage-cost-detail-state",role:"status"},b?`Showing detail rows ${Number(f.pagination?.
cursor||0)+1}-${Number(f.pagination?.cursor||0)+Number(f.pagination?.returned_rows||0)} of ${Number(f.pagination?.total_rows||
0)}.`:t?.status==="error"?"Cost detail is unavailable.":`Loading a bounded detail page for ${e.detail.totalRows} cost-de\
tail rows.`),React.createElement("div",{className:"usage-cost-chart",role:"img","aria-label":`${s}-day estimated cost by\
 day`},(g.length?g:[{day:"No data",cost_usd:0}]).map(w=>React.createElement("span",{key:w.day,title:`${w.day}: $${Number(
w.cost_usd).toFixed(4)}`},React.createElement("i",{style:{height:`${Math.max(3,Number(w.cost_usd)/x*100)}%`}}),React.createElement(
"small",null,w.day.slice(5))))),e.detail?.truncated&&React.createElement("details",{className:"usage-cost-detail-table"},
React.createElement("summary",null,"Cost detail rows"),t?.status==="loading"&&React.createElement("div",{className:"usag\
e-cost-detail-state"},"Loading cost detail\u2026"),t?.status==="error"&&React.createElement("div",{className:"usage-cost\
-detail-state"},"Cost detail unavailable: ",t.error),b&&React.createElement(React.Fragment,null,React.createElement("div",
{className:"usage-cost-detail-pager","aria-label":"Cost detail pagination"},React.createElement("button",{type:"button",
disabled:Number(f.pagination?.cursor||0)<=0,onClick:()=>n({days:s,project:i,cursor:String(Math.max(0,Number(f.pagination.
cursor||0)-Number(f.pagination.page_size||256))),pageSize:f.pagination.page_size||256})},"Previous"),React.createElement(
"span",null,f.pagination.returned_rows," rows \xB7 ",f.pagination.total_rows," total"),React.createElement("button",{type:"\
button",disabled:!f.pagination?.next_cursor,onClick:()=>n({days:s,project:i,cursor:f.pagination.next_cursor,pageSize:f.pagination.
page_size||256})},"Next")),React.createElement("div",{className:"usage-cost-table-wrap"},React.createElement("table",{className:"\
usage-cost-table"},React.createElement("caption",null,"Paginated local cost detail"),React.createElement("thead",null,React.
createElement("tr",null,React.createElement("th",null,"Day"),React.createElement("th",null,"Provider / model"),React.createElement(
"th",null,"Project"),React.createElement("th",null,"Speed"),React.createElement("th",null,"Cost"))),React.createElement(
"tbody",null,(f.rows||[]).map((w,E)=>React.createElement("tr",{key:`${f.pagination.cursor}:${E}`},React.createElement("t\
d",null,w.day),React.createElement("th",{scope:"row"},w.provider_id," \xB7 ",w.model),React.createElement("td",null,w.project),
React.createElement("td",null,w.speed),React.createElement("td",null,"$",Number(w.cost_usd).toFixed(4))))))))),React.createElement(
"div",{className:"usage-cost-table-wrap"},React.createElement("table",{className:"usage-cost-table"},React.createElement(
"caption",null,"Estimated cost and tokens by provider model"),React.createElement("thead",null,React.createElement("tr",
null,React.createElement("th",null,"Provider / model"),React.createElement("th",null,"Input"),React.createElement("th",null,
"Cached"),React.createElement("th",null,"Output"),React.createElement("th",null,"Cost"))),React.createElement("tbody",null,
v.map(w=>React.createElement("tr",{key:`${w.provider_id}:${w.model}`},React.createElement("th",{scope:"row"},w.provider_id===
"openai-codex"?"Codex":"Claude"," \xB7 ",w.model),React.createElement("td",null,Dr(w.input)),React.createElement("td",null,
Dr(w.cached)),React.createElement("td",null,Dr(w.output)),React.createElement("td",null,"$",Number(w.cost_usd).toFixed(4))))))),
e.unknownModels.length>0&&React.createElement("div",{className:"usage-cost-fallbacks"},React.createElement("strong",null,
"Fallback pricing"),e.unknownModels.map(w=>React.createElement("span",{key:`${w.provider_id}:${w.model}`},w.model," \u2192 ",
w.fallback))),React.createElement("div",{className:"usage-cost-scan"},"Incremental local JSONL scan \xB7 ",e.scan.files_complete||
0,"/",e.scan.files_total||0," files \xB7 ",e.records," deduplicated records"))}function zv({usage:e,refreshReceipt:t,resetReceipt:n,
costDetail:s,onBack:a,onRefresh:i,onWatch:c,onConsumeResetCredit:u,onRequestCostDetail:f}){let b=React.useMemo(()=>Tl(e),
[e]),[k,N]=React.useState(Date.now());React.useEffect(()=>{b.collectionState==="not-started"&&i(!1);let d=setInterval(()=>N(
Date.now()),3e4);return()=>clearInterval(d)},[i,b.collectionState]),React.useEffect(()=>(c(!0),()=>c(!1)),[c]);let A=d=>({
fresh:"Fresh",refreshing:"Refreshing",stale:"Stale",auth_required:"Sign in required",rate_limited:"Refresh limited",unavailable:"\
Unavailable"})[d]||"Unavailable",S=b.entries.find(d=>d.providerId==="openai-codex"&&Number(d.resetCredits?.available_count)>
0&&d.windows.some(v=>v.usedPercent>=100)),M=["requested","accepted"].includes(n?.status);return React.createElement("div",
{className:"usage-dashboard","data-testid":"usage-dashboard"},React.createElement("div",{className:"automations-header u\
sage-dashboard-header"},React.createElement("button",{className:"automations-back",onClick:a,title:"Back to sessions"},"\
\u2190"),React.createElement("div",{className:"automations-header-text"},React.createElement("h2",null,"Usage & limits"),
React.createElement("p",null,"Provider-account quotas shared by connected harnesses. Warnings start at 75% used.")),React.
createElement("button",{type:"button",className:"usage-dashboard-refresh",onClick:()=>i(!0),disabled:b.inFlight,"aria-la\
bel":"Refresh provider usage"},b.inFlight?"Refreshing\u2026":"Refresh")),b.collectionState!=="ready"&&React.createElement(
"div",{className:`usage-dashboard-collection-state ${b.collectionState}`,role:"status"},React.createElement("strong",null,
{"not-started":"Provider usage has not been collected yet",refreshing:"Refreshing provider usage",partial:"Some provider\
 usage is unavailable",stale:"Showing last-good provider usage",unavailable:"Provider usage is unavailable"}[b.collectionState]||
"Provider usage is pending"),React.createElement("span",null,"Generation ",b.generation,b.generatedAt?` \xB7 ${Oa(b.generatedAt,
k)}`:"")),React.createElement("div",{className:"usage-dashboard-summary","aria-label":"Usage summary"},React.createElement(
"div",null,React.createElement("strong",null,b.summaryAuthoritative?b.summary.providers:"\u2014"),React.createElement("s\
pan",null,"providers")),React.createElement("div",null,React.createElement("strong",null,b.summaryAuthoritative?b.summary.
accounts:"\u2014"),React.createElement("span",null,"accounts")),React.createElement("div",null,React.createElement("stro\
ng",null,b.summaryAuthoritative?b.summary.reporting:"\u2014"),React.createElement("span",null,"reporting")),React.createElement(
"div",{className:b.summary.nearLimit>0?"warning":""},React.createElement("strong",null,b.summaryAuthoritative?b.summary.
nearLimit:"\u2014"),React.createElement("span",null,"near limit")),React.createElement("div",{className:b.summary.exhausted>
0?"critical":""},React.createElement("strong",null,b.summaryAuthoritative?b.summary.exhausted:"\u2014"),React.createElement(
"span",null,"exhausted"))),t&&React.createElement("div",{className:`usage-refresh-receipt ${t.status}`,role:"status"},"R\
efresh ",t.status,t.generation!=null?` \xB7 generation ${t.generation}`:""),S&&React.createElement("div",{className:"usa\
ge-reset-attention",role:"alert","data-testid":"codex-reset-credit-attention"},React.createElement("span",null,React.createElement(
"strong",null,S.resetCredits.available_count," limit reset",S.resetCredits.available_count===1?"":"s"," available \u2014 appl\
y one?"),React.createElement("small",null,"Remote Agent Chat will use Codex's native reset action only after this approv\
al.")),React.createElement("button",{type:"button",onClick:u,disabled:M},M?"Applying\u2026":"Apply one reset")),n&&!["re\
quested"].includes(n.status)&&React.createElement("div",{className:`usage-refresh-receipt ${n.status}`,role:"status","da\
ta-testid":"codex-reset-credit-receipt"},"Reset ",n.status,n.outcome?`: ${n.outcome}`:"",n.error?` (${n.error})`:""),React.
createElement(Wv,{cost:b.estimatedCost,detailState:s,onRequestDetail:f}),React.createElement("div",{className:"usage-das\
hboard-grid"},b.entries.map(d=>{let v=El(d.credits),g=Ll(d.financials),x=d.credits?.resets_at?Da(d.credits.resets_at,k):
"",w=t?.provider_id===d.providerId?t:null,E=["requested","accepted","coalesced"].includes(w?.status);return React.createElement(
"details",{open:!0,className:`usage-dashboard-card ${d.tone}`,key:d.key,"data-provider-id":d.providerId,"data-account-fi\
ngerprint":d.accountFingerprint},React.createElement("summary",{className:"usage-dashboard-card-summary"},React.createElement(
Ji,{providerId:d.providerId,providerName:d.providerName}),React.createElement("span",{className:"usage-dashboard-card-ti\
tle"},React.createElement("strong",null,d.providerName),React.createElement("span",null,d.accountLabel,d.plan?` \xB7 ${d.
plan}`:"")),React.createElement("span",{className:`usage-dashboard-status ${d.status}`},A(d.status))),React.createElement(
"div",{className:"usage-dashboard-card-body"},React.createElement("div",{className:"usage-dashboard-card-meta"},React.createElement(
"span",null,d.sessionCount," mapped session",d.sessionCount===1?"":"s"),React.createElement("span",null,d.harnessTypes.length>
0?d.harnessTypes.join(", "):"No mapped surfaces"),React.createElement("span",null,d.status==="stale"?`Stale - ${Oa(d.capturedAt,
k)}`:Oa(d.capturedAt,k)),d.nextRefreshAt&&React.createElement("span",null,"Next refresh ",Da(d.nextRefreshAt,k)),d.refreshIntervalMs>
0&&React.createElement("span",null,d.watchBoostActive?`Live cadence ${Math.round(d.refreshIntervalMs/1e3)}s`:`Idle caden\
ce ${Math.round(d.refreshIntervalMs/1e3)}s`),React.createElement("button",{type:"button",className:"usage-card-refresh",
onClick:()=>i(!0,d.providerId),disabled:E,"aria-label":`Refresh ${d.providerName} usage now`},E?"Refreshing...":"Refresh\
 now")),w&&React.createElement("div",{className:`usage-refresh-receipt ${w.status}`,role:"status"},"Refresh ",w.status,w.
code?` (${w.code})`:"",w.retry_after_ms?` - retry in ${Math.ceil(w.retry_after_ms/1e3)}s`:""),d.windows.length>0?React.createElement(
"div",{className:"usage-dashboard-windows"},d.windows.map(T=>{let U=T.tone,Y=T.resetDescription||Da(T.resetsAt,k);return React.
createElement("div",{className:`usage-dashboard-window ${U}`,key:T.id},React.createElement("div",{className:"usage-dashb\
oard-window-heading"},React.createElement("span",null,React.createElement("strong",null,T.label),T.modelScope?.label?React.
createElement("small",null,"Model: ",T.modelScope.label):T.scope&&T.scope!==T.label?React.createElement("small",null,T.scope):
null),React.createElement("span",null,React.createElement("strong",null,T.remainingPercent==null?"Unavailable":`${Xt(T.remainingPercent)}\
 left`),React.createElement("small",null,T.usedPercent==null?"No reported value":`${Xt(T.usedPercent)} used`))),T.usedPercent!=
null&&React.createElement("div",{className:"usage-dashboard-meter",role:"progressbar","aria-label":`${d.providerName} ${T.
label}`,"aria-valuetext":`${Xt(T.usedPercent)} used`,"aria-valuemin":"0","aria-valuemax":"100","aria-valuenow":Math.round(
T.visualPercent)},React.createElement("span",{style:{width:`${T.visualPercent}%`}})),React.createElement("div",{className:"\
usage-window-thresholds"},"Warning ",Xt(T.thresholds.warningPercent)," \xB7 Critical ",Xt(T.thresholds.criticalPercent)),
T.pace&&React.createElement("div",{className:`usage-pace ${T.pace.category}`},React.createElement("div",{className:"usag\
e-pace-heading"},React.createElement("span",{className:"usage-pace-category"},T.pace.category),React.createElement("span",
null,"Ideal ",Xt(T.pace.expectedUsedPercent)," \xB7 projected ",Xt(T.pace.projectedUsedPercent))),React.createElement("d\
iv",{className:"usage-pace-chart",role:"img","aria-label":`${T.label} actual ${Xt(T.usedPercent)}, ideal ${Xt(T.pace.expectedUsedPercent)}\
, projected ${Xt(T.pace.projectedUsedPercent)}`},React.createElement("span",{className:"usage-pace-actual",style:{width:`${T.
visualPercent}%`}}),React.createElement("i",{className:"usage-pace-ideal",style:{left:`${Math.min(100,T.pace.expectedUsedPercent)}\
%`}}),React.createElement("i",{className:"usage-pace-projected",style:{left:`${Math.min(100,T.pace.projectedUsedPercent)}\
%`}})),React.createElement("div",{className:"usage-pace-budgets"},Object.entries({Now:"now","+1 hour":"next_hour","+5 ho\
urs":"next_five_hours",Today:"today"}).map(([re,ee])=>React.createElement("span",{key:ee},React.createElement("small",null,
re),React.createElement("strong",null,Xt(T.pace.budgets?.[ee]||0))))),React.createElement("div",{className:"usage-pace-o\
utcome"},T.usedPercent>=100?"Quota is exhausted":T.pace.willLastToReset?"Current pace lasts to reset":`Projected exhaust\
ion ${Da(T.pace.exhaustionAt,k)}`)),Y&&React.createElement("div",{className:"usage-dashboard-reset"},"Resets ",Y),React.
createElement("div",{className:"usage-window-provenance"},T.source||d.source,T.provenance?` \xB7 ${T.provenance}`:""))})):
!d.localRuntime&&!d.cloudUsage?React.createElement("div",{className:"usage-dashboard-unavailable"},d.error?.message||"Th\
is provider did not report quota windows."):null,d.cloudUsage&&d.providerId==="ollama-local"&&(d.cloudUsage.subscriptionState===
"active"?React.createElement("div",{className:"usage-dashboard-credit-row","data-testid":"ollama-cloud-usage"},React.createElement(
"span",null,React.createElement("strong",null,"Ollama Cloud"),d.windows.length," quota window",d.windows.length===1?"":"\
s",React.createElement("small",null,Oa(d.cloudUsage.capturedAt,k))),React.createElement("span",null,React.createElement(
"strong",null,"Auto-reload"),d.cloudUsage.autoReloadEnabled==null?"Not reported":d.cloudUsage.autoReloadEnabled?"On":"Of\
f",React.createElement("small",null,"Extra usage balance is separate from plan quota"))):d.cloudUsage.subscriptionState===
"none"?React.createElement("div",{className:"usage-dashboard-unavailable","data-testid":"ollama-cloud-no-subscription"},
React.createElement("strong",null,"No cloud subscription")," - local models remain unlimited"):React.createElement("div",
{className:"usage-dashboard-unavailable","data-testid":"ollama-cloud-unavailable"},React.createElement("strong",null,"Cl\
oud usage unavailable")," - ",d.cloudUsage.error?.message||"Open the signed-in Ollama Usage page to expose account quota\
.")),d.localRuntime&&React.createElement("div",{className:"usage-dashboard-credit-row","data-testid":"ollama-local-runti\
me"},React.createElement("span",null,React.createElement("strong",null,"Local runtime"),d.localRuntime.loadedModelsCount,
" loaded / ",d.localRuntime.installedModelsCount," installed",React.createElement("small",null,d.localRuntime.endpointScope.
replace(/_/g," "))),React.createElement("span",null,React.createElement("strong",null,"Request telemetry"),d.localRuntime.
telemetryStatus.replace(/_/g," "),React.createElement("small",null,d.localRuntime.telemetryReason))),d.localRuntime?.latestRequest&&
React.createElement("div",{className:"usage-dashboard-credit-row","data-testid":"ollama-owned-request-metrics"},React.createElement(
"span",null,React.createElement("strong",null,"Latest owned request"),d.localRuntime.latestRequest.model,React.createElement(
"small",null,d.localRuntime.latestRequest.surface.replace(/_/g," ")," - ",Oa(d.localRuntime.latestRequest.capturedAt,k))),
React.createElement("span",null,React.createElement("strong",null,"Tokens"),d.localRuntime.latestRequest.promptTokens," \
prompt - ",d.localRuntime.latestRequest.responseTokens," output",React.createElement("small",null,wp(d.localRuntime.latestRequest.
tokensPerSecond))),React.createElement("span",null,React.createElement("strong",null,"Total / load"),$o(d.localRuntime.latestRequest.
totalDurationNs)," / ",$o(d.localRuntime.latestRequest.loadDurationNs),React.createElement("small",null,"terminal respon\
se metrics")),React.createElement("span",null,React.createElement("strong",null,"Prompt / eval"),$o(d.localRuntime.latestRequest.
promptEvalDurationNs)," / ",$o(d.localRuntime.latestRequest.evalDurationNs),React.createElement("small",null,d.localRuntime.
observedRequestCount," owned receipt",d.localRuntime.observedRequestCount===1?"":"s"))),g.length>0&&React.createElement(
"div",{className:"usage-dashboard-credit-row usage-dashboard-financial-row"},g.map(T=>React.createElement("span",{key:T.
id},React.createElement("strong",null,T.label),T.value))),(v||d.resetCredits)&&React.createElement("div",{className:"usa\
ge-dashboard-credit-row"},v&&React.createElement("span",null,React.createElement("strong",null,"Credits"),v,x&&React.createElement(
"small",null,"Resets ",x)),d.resetCredits&&React.createElement("span",null,React.createElement("strong",null,"Rate-limit\
 resets"),d.resetCredits.available_count||0," available")),Array.isArray(d.resetCredits?.details)&&d.resetCredits.details.
length>0&&React.createElement("div",{className:"usage-dashboard-reset-credits"},d.resetCredits.details.map((T,U)=>React.
createElement("span",{key:`${T.title||"reset"}-${U}`},React.createElement("strong",null,T.title||`Reset credit ${U+1}`),
T.status&&React.createElement("small",null,T.status),T.expires_at&&React.createElement("small",null,"Expires ",Da(T.expires_at,
k))))),d.error?.message&&d.windows.length>0&&React.createElement("div",{className:"usage-dashboard-stale-error"},"Last r\
efresh: ",d.error.message),React.createElement("div",{className:"usage-dashboard-source-row"},React.createElement("span",
null,"Source: ",d.source?d.source.replace(/_/g," "):"not available",d.latencyMs!=null?` \xB7 ${d.latencyMs} ms`:""),d.dashboardUrl&&
React.createElement("a",{href:d.dashboardUrl,target:"_blank",rel:"noreferrer"},"Open provider dashboard"))))}),b.entries.
length===0&&React.createElement("div",{className:"usage-dashboard-empty"},React.createElement("strong",null,b.collectionState===
"ready"?"The completed scan found no provider usage.":"Provider usage is not available yet."),React.createElement("span",
null,b.collectionState==="ready"?"Connect a supported Codex, Claude Code, Antigravity, or Cursor session, or start local\
 Ollama, then refresh.":"Quota totals remain unknown until a provider collection completes."))))}var oc=640,Jl=220,Mt=Object.
freeze({left:54,right:14,top:12,bottom:32});function aa(e){let t=Math.max(.04,Math.min(1,Number(e?.end)-Number(e?.start)||
1)),n=Math.max(0,Math.min(1-t,Number(e?.start)||0));return{start:n,end:n+t}}function Kv(e,t,n,s){let a="",i=!1;return e.
forEach(c=>{let u=c[t];if(c.gap||u==null||!Number.isFinite(u)){i=!1;return}a+=`${i?"L":"M"}${n(c).toFixed(2)},${s(u).toFixed(
2)} `,i=!0}),a.trim()}function ic({title:e,description:t,frames:n,series:s,percentScale:a=!1,viewport:i,onViewportChange:c,
crosshairSequence:u,onCrosshairChange:f,range:b="live",nowMs:k=Date.now(),paused:N=!1,subscriptionStatus:A="live"}){let S=React.
useRef(null),M=React.useRef(new Map),d=React.useRef(null),v=React.useRef(0),[g,x]=React.useState({}),[w,E]=React.useState(
{mode:"auto",fixedMax:null}),T=oc-Mt.left-Mt.right,U=Jl-Mt.top-Mt.bottom,Y=Ir(n,{nowMs:k,paused:N,connected:A!=="reconne\
cting",subscriptionStatus:A}),re=Y.frames,ee=aa(i),ae=qr[b]??qr.live,W=N&&Y.endMs||k,ie=ae===1/0?Y.startMs||W-qr.live:W-
ae,ge=Math.max(1,W-ie),X=ie+ge*ee.start,we=ie+ge*ee.end,ve=re.filter(F=>Number(F.chart_time_ms)>=X&&Number(F.chart_time_ms)<=
we),Z=s.map(F=>{let ne=F.frames?Ir(F.frames,{nowMs:k,paused:!0}).frames:ve,Ce=F.frames?ne.filter(Ue=>Number(Ue.chart_time_ms)>=
X&&Number(Ue.chart_time_ms)<=we):ne;return{...F,visibleFrames:Ce,samples:hp(Ce,F.metric,180)}}),Se=Z.filter(F=>!g[F.key]),
Q=Math.max(0,...Se.flatMap(F=>F.samples.map(ne=>ne.max||0))),de=Cl(Q,v.current,{percent:a});!a&&w.mode==="auto"&&(v.current=
de.maximum);let pe=w.mode==="fixed"&&w.fixedMax?Cl(w.fixedMax,w.fixedMax,{percent:a}):de,J=pe.maximum,q=F=>Mt.left+xl(F,
X,we)*T,G=F=>Mt.top+U-Math.max(0,Math.min(J,F))/Math.max(1,J)*U,te=ve.find(F=>F.sample_sequence===u)||ve.at(-1)||null,$=te?
Mt.left+xl(te,X,we)*T:null,H=s[0]?.format||(F=>String(F)),fe=bp(X,we,typeof window<"u"&&window.innerWidth<=600?4:5),be=Y.
status[0]?.toUpperCase()+Y.status.slice(1);function _e(F){let ne=S.current?.getBoundingClientRect();return ne?.width?Math.
max(0,Math.min(1,(F.clientX-ne.left)/ne.width)):.5}function Ne(F){if(!ve.length)return 0;let ne=X+(we-X)*F;return ve.reduce(
(Ce,Ue)=>Math.abs(Number(Ue.chart_time_ms)-ne)<Math.abs(Number(Ce.chart_time_ms)-ne)?Ue:Ce,ve[0]).sample_sequence}function Le(F,ne=.5){
let Ce=aa(i),Ue=Math.max(.04,Math.min(1,(Ce.end-Ce.start)*F)),Nt=Ce.start+(Ce.end-Ce.start)*ne;c(aa({start:Nt-Ue*ne,end:Nt+
Ue*(1-ne)}))}React.useEffect(()=>{let F=S.current;if(!F)return;let ne=Ce=>{Ce.preventDefault(),Le(Ce.deltaY>0?1.2:.8,_e(
Ce))};return F.addEventListener("wheel",ne,{passive:!1}),()=>F.removeEventListener("wheel",ne)});function Ae(F){try{F.currentTarget.
setPointerCapture?.(F.pointerId)}catch{}if(M.current.set(F.pointerId,{x:F.clientX,y:F.clientY}),f(Ne(_e(F))),M.current.size===
1)d.current={mode:"pan",pointerId:F.pointerId,startX:F.clientX,viewport:aa(i)};else if(M.current.size===2){let ne=[...M.
current.values()];d.current={mode:"pinch",distance:Math.max(1,Math.abs(ne[1].x-ne[0].x)),center:(_e({clientX:ne[0].x})+_e(
{clientX:ne[1].x}))/2,viewport:aa(i)}}}function He(F){if(!M.current.has(F.pointerId)){f(Ne(_e(F)));return}M.current.set(
F.pointerId,{x:F.clientX,y:F.clientY});let ne=d.current;if(ne?.mode==="pinch"&&M.current.size>=2){let Ce=[...M.current.values()],
Ue=Math.max(1,Math.abs(Ce[1].x-Ce[0].x)),Nt=ne.viewport.end-ne.viewport.start,Jt=Math.max(.04,Math.min(1,Nt*ne.distance/
Ue)),j=ne.viewport.start+Nt*ne.center;c(aa({start:j-Jt*ne.center,end:j+Jt*(1-ne.center)}));return}if(ne?.mode==="pan"&&ne.
pointerId===F.pointerId){let Ce=S.current?.getBoundingClientRect(),Ue=ne.viewport.end-ne.viewport.start,Nt=Ce?.width?-(F.
clientX-ne.startX)/Ce.width*Ue:0;c(aa({start:ne.viewport.start+Nt,end:ne.viewport.end+Nt}))}}function ce(F){M.current.delete(
F.pointerId);try{F.currentTarget.releasePointerCapture?.(F.pointerId)}catch{}M.current.size===0&&(d.current=null)}function je(F){
if(!ve.length)return;let ne=Math.max(0,ve.findIndex(Ce=>Ce.sample_sequence===u));if(F.key==="ArrowLeft"||F.key==="ArrowR\
ight")if(F.preventDefault(),F.shiftKey){let Ue=(ee.end-ee.start)*(F.key==="ArrowLeft"?-.1:.1);c(aa({start:ee.start+Ue,end:ee.
end+Ue}))}else{let Ce=Math.max(0,Math.min(ve.length-1,ne+(F.key==="ArrowLeft"?-1:1)));f(ve[Ce].sample_sequence)}else F.key===
"Home"||F.key==="End"?(F.preventDefault(),f((F.key==="Home"?ve[0]:ve.at(-1)).sample_sequence)):F.key==="+"||F.key==="="?
(F.preventDefault(),Le(.75)):F.key==="-"&&(F.preventDefault(),Le(1.25))}return React.createElement("section",{className:"\
host-resource-chart","aria-label":`${e} chart`},React.createElement("div",{className:"host-resource-chart-heading"},React.
createElement("span",null,React.createElement("strong",null,e),React.createElement("small",null,t)),!a&&React.createElement(
"button",{type:"button",onClick:()=>E(F=>F.mode==="auto"?{mode:"fixed",fixedMax:de.maximum}:{mode:"auto",fixedMax:null})},
w.mode==="auto"?"Auto scale":`Fixed ${H(w.fixedMax)}`)),React.createElement("div",{className:`host-resource-chart-qualit\
y ${Y.status}`,role:"status"},React.createElement("strong",null,be),React.createElement("span",null,Y.receivedCount," re\
ceived / ",Y.validCount," valid / ",Y.expectedCount," expected / ",Y.droppedCount," dropped"),React.createElement("span",
null,Math.round(Y.cadenceMs)," ms cadence"),React.createElement("span",null,Y.gapCount," gap",Y.gapCount===1?"":"s"),React.
createElement("span",null,Y.duplicateCount," duplicate / ",Y.outOfOrderCount," out of order")),React.createElement("div",
{className:"host-resource-chart-legend","aria-label":`${e} series`},Z.map((F,ne)=>React.createElement("button",{type:"bu\
tton",key:F.key,"aria-pressed":!g[F.key],onClick:()=>x(Ce=>({...Ce,[F.key]:!Ce[F.key]}))},React.createElement("i",{className:`\
marker marker-${ne%3}`,style:{"--series-color":F.color}}),F.label))),React.createElement("div",{className:"host-resource\
-chart-canvas",ref:S,role:"group",tabIndex:"0","aria-label":`${e}. Drag to pan, wheel or pinch to zoom, arrow keys move \
the synchronized crosshair, shift plus arrows pan, plus and minus zoom.`,onPointerDown:Ae,onPointerMove:He,onPointerUp:ce,
onPointerCancel:ce,onKeyDown:je},React.createElement("svg",{viewBox:`0 0 ${oc} ${Jl}`,"aria-hidden":"true"},Y.gaps.filter(
F=>F.endMs>=X&&F.startMs<=we).map((F,ne)=>{let Ce=Mt.left+Math.max(0,(F.startMs-X)/Math.max(1,we-X))*T,Ue=Mt.left+Math.min(
1,(F.endMs-X)/Math.max(1,we-X))*T;return React.createElement("rect",{key:`${F.reason}-${ne}`,className:"host-resource-ch\
art-gap",x:Ce,y:Mt.top,width:Math.max(2,Ue-Ce),height:U})}),[...pe.ticks].reverse().map(F=>{let ne=G(F);return React.createElement(
React.Fragment,{key:F},React.createElement("line",{className:"host-resource-chart-grid",x1:Mt.left,x2:oc-Mt.right,y1:ne,
y2:ne}),React.createElement("text",{className:"host-resource-chart-y-label",textAnchor:"end",x:Mt.left-7,y:ne+4},H(F)))}),
fe.map((F,ne)=>{let Ce=Mt.left+F.fraction*T;return React.createElement("text",{key:F.timeMs,className:"host-resource-cha\
rt-x-label","aria-label":F.accessibleLabel,textAnchor:ne===0?"start":ne===fe.length-1?"end":"middle",x:Ce,y:Jl-7},F.label)}),
Se.flatMap(F=>F.samples.map(ne=>ne.gap||ne.min==null||ne.max==null?null:React.createElement("line",{key:`${F.key}-${ne.endSequence}`,
className:"host-resource-chart-range",stroke:F.color,x1:q(ne),x2:q(ne),y1:G(ne.min),y2:G(ne.max)}))),Se.map((F,ne)=>React.
createElement("path",{key:F.key,className:`host-resource-chart-line series-${ne%3}`,stroke:F.color,strokeDasharray:F.dashed||
ne%3===1?"7 4":ne%3===2?"2 4":void 0,d:Kv(F.samples,"average",q,G)})),Se.flatMap((F,ne)=>F.visibleFrames.length<10?F.visibleFrames.
map(Ce=>{let Ue=Zs(Ce,F.metric);return Ue==null?null:React.createElement("circle",{key:`${F.key}-point-${Ce.sample_sequence}`,
className:`host-resource-chart-point marker-${ne%3}`,cx:q(Ce),cy:G(Ue),r:"3",stroke:F.color})}):[]),$!=null&&React.createElement(
"line",{className:"host-resource-chart-crosshair",x1:$,x2:$,y1:Mt.top,y2:Mt.top+U})),te&&React.createElement("div",{className:`\
host-resource-chart-tooltip ${$>oc/2?"flip":""}`,role:"status"},React.createElement("strong",null,Ml(te.chart_time_ms),"\
 / seq ",te.sample_sequence),React.createElement("span",null,Math.max(0,Math.round((k-Number(te.chart_time_ms))/1e3)),"s\
 old / ",te.sample_interval_ms||Y.cadenceMs," ms / ",be," / source ",te.status||"unknown"),Z.map(F=>React.createElement(
"span",{key:F.key},React.createElement("i",{style:{background:F.color}}),F.label,": ",F.format(Zs(F.visibleFrames.find(ne=>ne.
sample_sequence===te.sample_sequence),F.metric)))))),React.createElement("div",{className:"host-resource-chart-stats"},Z.
filter(F=>!g[F.key]).map(F=>{let ne=Nl(F.visibleFrames,F.metric),Ce=F.visibleFrames.find(Ue=>Ue.sample_sequence===ne.peakSequence);
return React.createElement("span",{key:F.key},React.createElement("strong",null,F.label),React.createElement("span",null,
"Latest-good ",F.format(ne.current)),React.createElement("span",null,"Min ",F.format(ne.min)),React.createElement("span",
null,"Avg ",F.format(ne.average)," (",ne.averageMethod,")"),React.createElement("span",null,"Max ",F.format(ne.max)),React.
createElement("span",null,ne.p95Ready?`p95 ${F.format(ne.p95)}`:`p95 collecting (${ne.count}/20)`),React.createElement("\
small",null,ne.count," raw / ",Math.round(ne.elapsedMs/1e3),"s / ",ne.cadenceMs||Y.cadenceMs," ms cadence / ",Math.max(ne.
gapCount,Y.gapCount)," gaps / ",be," / peak ",Rl(Ce?.captured_at)))})),React.createElement("details",{className:"host-re\
source-chart-data"},React.createElement("summary",null,"Accessible data table"),React.createElement("div",null,React.createElement(
"table",null,React.createElement("caption",null,"Latest ",Math.min(120,ve.length)," of ",ve.length," visible samples"),React.
createElement("thead",null,React.createElement("tr",null,React.createElement("th",null,"Time / sequence"),Z.map(F=>React.
createElement("th",{key:F.key},F.label)))),React.createElement("tbody",null,ve.slice(-120).map(F=>React.createElement("t\
r",{key:`${F.sample_sequence}:${F.chart_time_ms}`},React.createElement("th",null,Ml(F.chart_time_ms)," / ",F.sample_sequence,
F.gap_before?` / gap: ${F.gap_reason}`:""),Z.map(ne=>React.createElement("td",{key:ne.key},ne.format(Zs(ne.visibleFrames.
find(Ce=>Ce.sample_sequence===F.sample_sequence),ne.metric)))))))))))}function Vv(e,t,n,s,a){let i=t.trim().toLowerCase(),
c=S=>(!i||[S.name,S.agentLabel,S.workspaceLabel,S.pid,S.attributionReason].some(M=>String(M||"").toLowerCase().includes(
i)))&&(n==="all"||S.attributionLevel===n),u=e.filter(c),f=new Set(u.map(S=>S.stableKey)),b=(S,M)=>s==="name"?(S.agentLabel||
S.name).localeCompare(M.agentLabel||M.name)||S.pid-M.pid:s==="memory"?M.memoryBytes-S.memoryBytes||S.pid-M.pid:s==="read"?
M.ioReadBps-S.ioReadBps||S.pid-M.pid:s==="write"?M.ioWriteBps-S.ioWriteBps||S.pid-M.pid:M.cpuHostPercent-S.cpuHostPercent||
S.pid-M.pid,k=new Map;u.forEach(S=>{let M=f.has(S.parentKey)?S.parentKey:"";k.set(M,[...k.get(M)||[],S])});let N=[];function A(S,M){
(k.get(S)||[]).sort(b).forEach(d=>{N.push({process:d,depth:M}),a[d.stableKey]!==!1&&A(d.stableKey,M+1)})}return A("",0),
N}function Hm(e,t,n=44,s=16){let a=(Array.isArray(e)?e:[]).map(i=>Zs(i,t)).filter(i=>i!==null);return a.length<2?"":a.map(
(i,c)=>{let u=c/(a.length-1)*n,f=s-Math.max(0,Math.min(100,i))/100*s;return`${c?"L":"M"}${u.toFixed(2)},${f.toFixed(2)}`}).
join(" ")}function Yv({connected:e,error:t,history:n,subscription:s,onOpen:a,onRefresh:i,onSubscribe:c,onUnsubscribe:u}){
let f="(min-width: 900px)",[b,k]=React.useState(()=>typeof window<"u"&&typeof window.matchMedia=="function"?window.matchMedia(
f).matches:!1),[N,A]=React.useState(Date.now());React.useEffect(()=>{if(typeof window>"u"||typeof window.matchMedia!="fu\
nction")return;let E=window.matchMedia(f),T=()=>k(E.matches);return T(),typeof E.addEventListener=="function"?E.addEventListener(
"change",T):E.addListener?.(T),()=>{typeof E.removeEventListener=="function"?E.removeEventListener("change",T):E.removeListener?.(
T)}},[]),React.useEffect(()=>{if(b)return c(!0,"global-strip"),()=>u("global-strip")},[b,c,u]),React.useEffect(()=>{if(!b)
return;let E=()=>A(Date.now()),T=setInterval(E,1e3),U=()=>{document.visibilityState==="visible"&&(E(),i(!1))};return document.
addEventListener("visibilitychange",U),()=>{clearInterval(T),document.removeEventListener("visibilitychange",U)}},[b,i]);
let S=React.useMemo(()=>gp(n,{connected:e,error:!!t,nowMs:N,subscriptionStatus:s?.status}),[e,t,n,N,s?.status]);if(!b)return null;
let M=E=>(E==null?"\u2014":String(Math.round(E))).padStart(3,"\u2007"),d=E=>E==="critical"?"!!":E==="warning"?"!":"",v=S.
status==="stale"?`stale ${S.ageSeconds}s`:S.status,g=S.memoryUsedBytes!==null&&S.memoryTotalBytes!==null?`${ts(S.memoryUsedBytes)}\
 of ${ts(S.memoryTotalBytes)}`:"memory totals unavailable",x=S.point?`Host CPU ${S.cpuPercent?.toFixed(1)??"unknown"}%; \
memory ${S.memoryPercent?.toFixed(1)??"unknown"}% (${g}); ${v}; sample ${S.sampleSequence}`:`Host resources ${v}`,w=S.point?
`Open Host resources. CPU ${S.cpuPercent?.toFixed(1)??"unknown"} percent, ${S.cpuLevel}. RAM ${S.memoryPercent?.toFixed(
1)??"unknown"} percent, ${S.memoryLevel}. ${v}. Sample ${S.sampleSequence}.`:`Open Host resources. CPU and RAM waiting. ${v}\
.`;return React.createElement("div",{className:"global-desktop-status-rail","data-testid":"global-desktop-status-rail"},
React.createElement("button",{type:"button",className:`global-host-resource-strip ${S.attention}`,"data-testid":"global-\
host-resource-strip","data-status":S.status,"data-cpu-level":S.cpuLevel,"data-memory-level":S.memoryLevel,"data-sample-s\
equence":S.sampleSequence||"","data-sample-captured-at":S.capturedAt||"","data-cpu-percent":S.cpuPercent??"","data-memor\
y-percent":S.memoryPercent??"","data-history-count":S.frames.length,"aria-label":w,title:x,onClick:a},React.createElement(
"span",{className:`global-host-resource-metric ${S.cpuLevel}`},React.createElement("span",{className:"label"},"CPU","\xA0"),
React.createElement("span",{className:"value"},M(S.cpuPercent)),React.createElement("span",{className:"unit"},"%"),React.
createElement("span",{className:"attention-mark"},d(S.cpuLevel))),React.createElement("span",{className:"global-host-res\
ource-divider","aria-hidden":"true"},"\xB7"),React.createElement("span",{className:`global-host-resource-metric ${S.memoryLevel}`},
React.createElement("span",{className:"label"},"RAM","\xA0"),React.createElement("span",{className:"value"},M(S.memoryPercent)),
React.createElement("span",{className:"unit"},"%"),React.createElement("span",{className:"attention-mark"},d(S.memoryLevel))),
React.createElement("svg",{className:"global-host-resource-sparkline",viewBox:"0 0 44 16","aria-hidden":"true"},React.createElement(
"path",{className:"cpu",d:Hm(S.frames,"cpu_total_percent")}),React.createElement("path",{className:"memory",d:Hm(S.frames,
"memory_used_percent")})),React.createElement("span",{className:"global-host-resource-state"},v)))}function Xv({snapshot:e,
error:t,history:n,details:s,subscription:a,onBack:i,onRefresh:c,onSubscribe:u,onUnsubscribe:f}){let b=React.useMemo(()=>fp(
e),[e]),[k,N]=React.useState(Date.now()),[A,S]=React.useState("live"),[M,d]=React.useState(null),[v,g]=React.useState(null),
[x,w]=React.useState({start:0,end:1}),[E,T]=React.useState(0),[U,Y]=React.useState(!1),[re,ee]=React.useState(""),[ae,W]=React.
useState("all"),[ie,ge]=React.useState("cpu"),[X,we]=React.useState({}),[ve,Z]=React.useState("");React.useEffect(()=>(u(
U,"dashboard"),()=>f("dashboard")),[U,u,f]),React.useEffect(()=>{let ce=setInterval(()=>N(Date.now()),1e3);return()=>clearInterval(
ce)},[]);let Se=React.useMemo(()=>M==null?n:n.filter(ce=>ce.sample_sequence<=M),[n,M]),Q=M==null?k:v||k,de=React.useMemo(
()=>_p(Se,A,{nowMs:Q,paused:M!=null,subscriptionStatus:a?.status,connected:a?.status!=="reconnecting",error:!!t}),[Se,A,
Q,M,a?.status,t]),pe=React.useMemo(()=>Ir(Se,{nowMs:Q,paused:M!=null,subscriptionStatus:a?.status,connected:a?.status!==
"reconnecting",error:!!t}),[Se,Q,M,a?.status,t]),J=React.useRef("");React.useEffect(()=>{if(!["delayed","stale"].includes(
pe.status)||M!=null){J.current="";return}let ce=`${pe.status}:${pe.points.at(-1)?.sampleSequence||0}`;J.current!==ce&&(J.
current=ce,c(!1))},[pe.status,pe.points,M,c]),React.useEffect(()=>{!E&&de.length&&T(de.at(-1).sample_sequence)},[E,de]);
let q=b.system,G=q?q.disk.readBps+q.disk.writeBps:0,te=q?q.network.receiveBps+q.network.sendBps:0,$=React.useMemo(()=>Vv(
b.processes,re,ae,ie,X),[b.processes,re,ae,ie,X]),H=b.processes.find(ce=>ce.stableKey===ve)||null,fe=b.lastGoodCapturedAt?
Al(b.lastGoodCapturedAt,k).replace(/^Updated\s+/i,""):"not yet available",be=React.useMemo(()=>ve?s.flatMap(ce=>{let je=(ce.
processes||[]).find(F=>F.stable_key===ve);return je?[{frame_kind:"system",sample_sequence:ce.sample_sequence,captured_at:ce.
captured_at,sample_interval_ms:ce.sample_interval_ms,dropped_gap_count:ce.dropped_gap_count,status:ce.status,cpu:{total_percent:je.
cpu_host_percent},disk:{read_bps:je.io_read_bps,write_bps:je.io_write_bps}}]:[]}):[],[s,ve]),_e=ce=>ce==null?"\u2014":vp(
ce),Ne=ce=>ce==null?"\u2014":ns(ce),Le={live:"Live",delayed:"Delayed",reconnecting:"Reconnecting",paused:"Paused",stale:"\
Stale",waiting:"Waiting",unavailable:"Unavailable"}[pe.status]||"Unavailable",Ae=[{key:"cpu-total",metric:"cpu_total_per\
cent",label:"Total",color:"#58a6ff",format:_e},{key:"cpu-user",metric:"cpu_user_percent",label:"User",color:"#3fb950",format:_e},
{key:"cpu-kernel",metric:"cpu_privileged_percent",label:"Kernel",color:"#d29922",format:_e},...be.length?[{key:"process-\
cpu",metric:"cpu_total_percent",label:`${H?.agentLabel||H?.name||"Process"} overlay`,color:"#f778ba",format:_e,frames:be,
dashed:!0}]:[]],He=[{key:"disk-read",metric:"disk_read_bps",label:"Read",color:"#58a6ff",format:Ne},{key:"disk-write",metric:"\
disk_write_bps",label:"Write",color:"#f0883e",format:Ne},...be.length?[{key:"process-read",metric:"disk_read_bps",label:"\
Process read overlay",color:"#bc8cff",format:Ne,frames:be,dashed:!0},{key:"process-write",metric:"disk_write_bps",label:"\
Process write overlay",color:"#f778ba",format:Ne,frames:be,dashed:!0}]:[]];return React.createElement("div",{className:"\
host-resource-dashboard","data-testid":"host-resource-dashboard"},React.createElement("div",{className:"automations-head\
er host-resource-header"},React.createElement("button",{className:"automations-back",onClick:i,title:"Back to sessions"},
"\u2190"),React.createElement("div",{className:"automations-header-text"},React.createElement("h2",null,"Host resources"),
React.createElement("p",null,"Live, ephemeral Windows metrics. Process commands and executable paths never leave the pro\
xy.")),React.createElement("button",{type:"button",className:"usage-dashboard-refresh",onClick:()=>c(!0),"aria-label":"C\
apture host resource detail now"},"Capture detail")),React.createElement("div",{className:"host-resource-meta"},React.createElement(
"span",{className:`host-resource-status ${pe.status}`},Le),React.createElement("span",null,U?"Aggregate-only":b.machineLabel||
"Windows host"),React.createElement("span",null,Al(b.capturedAt,k)),React.createElement("span",null,pe.receivedCount," r\
eceived / ",pe.validCount," valid / ",pe.expectedCount," expected / ",pe.droppedCount," dropped / ",pe.gapCount," gaps /\
 ",pe.duplicateCount," dup / ",pe.outOfOrderCount," out-of-order"),React.createElement("span",null,Math.round(pe.cadenceMs),
" ms cadence / seq ",b.sampleSequence||"\u2014")),React.createElement("div",{className:"host-resource-controls","aria-la\
bel":"Host resource timeline controls"},React.createElement("div",{className:"host-resource-range",role:"group","aria-la\
bel":"Time range"},[["live","Live"],["1m","1m"],["5m","5m"],["15m","15m"],["since_open","Since open"]].map(([ce,je])=>React.
createElement("button",{key:ce,type:"button",className:A===ce?"active":"","aria-pressed":A===ce,onClick:()=>{S(ce),w({start:0,
end:1})}},je))),React.createElement("button",{type:"button",onClick:()=>{M==null?(g(Date.now()),d(n.at(-1)?.sample_sequence||
0)):(d(null),g(null))}},M==null?"Pause":"Resume"),React.createElement("button",{type:"button",disabled:x.start===0&&x.end===
1,onClick:()=>w({start:0,end:1})},"Reset zoom"),React.createElement("label",null,React.createElement("input",{type:"chec\
kbox",checked:U,onChange:ce=>{Y(ce.target.checked),Z("")}})," Aggregate-only privacy"),React.createElement("span",null,de.
length," raw samples / ",Math.round(pe.elapsedMs/1e3),"s actual",M==null?"":` / paused at ${M}`)),(t||b.error)&&React.createElement(
"div",{className:"host-resource-error",role:"status"},t?.message||b.error?.message,b.error&&` Last full detail: ${fe}.`),
q?React.createElement(React.Fragment,null,React.createElement("div",{className:"host-resource-summary","aria-label":"Hos\
t resource summary"},React.createElement("div",null,React.createElement("strong",null,Math.round(q.cpuPercent),"%"),React.
createElement("span",null,"CPU"),React.createElement("small",null,q.cpu.logicalCoreCount||"\u2014"," logical / ",q.cpu.physicalCoreCount||
"\u2014"," physical cores")),React.createElement("div",null,React.createElement("strong",null,Math.round(q.memory.usedPercent),
"%"),React.createElement("span",null,"memory"),React.createElement("small",null,ts(q.memory.usedBytes)," / ",ts(q.memory.
totalBytes),"; commit ",Math.round(q.memory.commitPercent),"%")),React.createElement("div",null,React.createElement("str\
ong",null,ns(G)),React.createElement("span",null,"disk I/O"),React.createElement("small",null,"Read ",ns(q.disk.readBps),
" / write ",ns(q.disk.writeBps)," / ",Math.round(q.disk.busyPercent),"% busy")),React.createElement("div",null,React.createElement(
"strong",null,ns(te)),React.createElement("span",null,"network I/O"),React.createElement("small",null,"Receive ",ns(q.network.
receiveBps)," / send ",ns(q.network.sendBps)))),React.createElement("div",{className:"host-resource-charts"},React.createElement(
ic,{title:"CPU",description:"Total outline; User and Kernel component overlays (%)",frames:de,series:Ae,percentScale:!0,
viewport:x,onViewportChange:w,crosshairSequence:E,onCrosshairChange:T,range:A,nowMs:Q,paused:M!=null,subscriptionStatus:a?.
status}),React.createElement(ic,{title:"Memory",description:"Physical used and committed (%)",frames:de,series:[{key:"me\
mory-used",metric:"memory_used_percent",label:"Physical used",color:"#bc8cff",format:_e},{key:"memory-commit",metric:"me\
mory_commit_percent",label:"Committed",color:"#f778ba",format:_e}],percentScale:!0,viewport:x,onViewportChange:w,crosshairSequence:E,
onCrosshairChange:T,range:A,nowMs:Q,paused:M!=null,subscriptionStatus:a?.status}),React.createElement(ic,{title:"Disk",description:"\
Aggregate throughput (IEC bytes/s); isolate unequal series in the legend",frames:de,series:He,viewport:x,onViewportChange:w,
crosshairSequence:E,onCrosshairChange:T,range:A,nowMs:Q,paused:M!=null,subscriptionStatus:a?.status}),React.createElement(
ic,{title:"Network",description:"Physical-default receive and send (IEC bytes/s)",frames:de,series:[{key:"network-receiv\
e",metric:"network_receive_bps",label:"Receive",color:"#3fb950",format:Ne},{key:"network-send",metric:"network_send_bps",
label:"Send",color:"#d29922",format:Ne}],viewport:x,onViewportChange:w,crosshairSequence:E,onCrosshairChange:T,range:A,nowMs:Q,
paused:M!=null,subscriptionStatus:a?.status})),!U&&React.createElement("section",{className:"host-resource-process-secti\
on","aria-labelledby":"host-resource-process-heading"},React.createElement("div",{className:"host-resource-process-headi\
ng"},React.createElement("span",null,React.createElement("strong",{id:"host-resource-process-heading"},"Processes"),React.
createElement("small",null,"Union of owned, top CPU, memory, read, and write. Attribution never implies unproved per-ses\
sion ownership.")),React.createElement("span",null,b.attributedProcesses.length," attributed / ",b.processes.length," sh\
own")),React.createElement("div",{className:"host-resource-process-controls"},React.createElement("label",null,"Search ",
React.createElement("input",{value:re,onChange:ce=>ee(ce.target.value),placeholder:"Name, PID, agent, workspace"})),React.
createElement("label",null,"Attribution ",React.createElement("select",{value:ae,onChange:ce=>W(ce.target.value)},React.
createElement("option",{value:"all"},"All"),React.createElement("option",{value:"owned"},"Owned"),React.createElement("o\
ption",{value:"runtime"},"Runtime match"),React.createElement("option",{value:"workspace-associated"},"Workspace-associa\
ted"),React.createElement("option",{value:"unattributed"},"Unattributed"))),React.createElement("label",null,"Sort ",React.
createElement("select",{value:ie,onChange:ce=>ge(ce.target.value)},React.createElement("option",{value:"cpu"},"CPU"),React.
createElement("option",{value:"memory"},"Memory"),React.createElement("option",{value:"read"},"Read"),React.createElement(
"option",{value:"write"},"Write"),React.createElement("option",{value:"name"},"Name")))),H&&React.createElement("div",{className:"\
host-resource-process-overlay",role:"region","aria-label":`Process detail for ${H.agentLabel||H.name}`},React.createElement(
"div",null,React.createElement("strong",null,H.agentLabel||H.name),React.createElement("span",null,H.name," / PID ",H.pid,
" / started ",H.startTime?Rl(H.startTime):"unknown"),React.createElement("small",null,H.attributionLevel,": ",H.attributionReason,
". CPU and disk overlays use the same synchronized timebase.")),React.createElement("button",{type:"button",onClick:()=>Z(
"")},"Remove overlay"),React.createElement("dl",null,React.createElement("div",null,React.createElement("dt",null,"Host \
CPU"),React.createElement("dd",null,H.cpuHostPercent.toFixed(1),"%")),React.createElement("div",null,React.createElement(
"dt",null,"Core equivalent"),React.createElement("dd",null,H.cpuCoreEquivalent.toFixed(1),"%")),React.createElement("div",
null,React.createElement("dt",null,"Working set"),React.createElement("dd",null,ts(H.memoryBytes))),React.createElement(
"div",null,React.createElement("dt",null,"Private / commit"),React.createElement("dd",null,ts(H.privateBytes)," / ",ts(H.
commitBytes))),React.createElement("div",null,React.createElement("dt",null,"Threads / handles"),React.createElement("dd",
null,H.threadCount," / ",H.handleCount)),React.createElement("div",null,React.createElement("dt",null,"I/O operations"),
React.createElement("dd",null,"R ",H.ioReadOps," / W ",H.ioWriteOps)),React.createElement("div",null,React.createElement(
"dt",null,"64-bit byte counters"),React.createElement("dd",null,"R ",H.counterTotals.ioReadBytes," / W ",H.counterTotals.
ioWriteBytes)),React.createElement("div",null,React.createElement("dt",null,"Detail samples"),React.createElement("dd",null,
be.length," / 5s cadence")))),React.createElement("div",{className:"host-resource-process-scroll"},React.createElement("\
table",{className:"host-resource-process-table"},React.createElement("thead",null,React.createElement("tr",null,React.createElement(
"th",{scope:"col"},"Agent / process tree"),React.createElement("th",{scope:"col"},"Confidence"),React.createElement("th",
{scope:"col"},"CPU host / core"),React.createElement("th",{scope:"col"},"Memory"),React.createElement("th",{scope:"col"},
"Read"),React.createElement("th",{scope:"col"},"Write"))),React.createElement("tbody",null,$.map(({process:ce,depth:je})=>React.
createElement("tr",{key:ce.stableKey,className:`${ce.attributed?"attributed":""} ${ve===ce.stableKey?"selected":""}`,"da\
ta-agent-attributed":ce.attributed?"true":"false"},React.createElement("td",{style:{"--process-depth":je}},ce.childCount>
0&&React.createElement("button",{className:"host-resource-process-expand",type:"button","aria-label":`${X[ce.stableKey]===
!1?"Expand":"Collapse"} ${ce.name}`,"aria-expanded":X[ce.stableKey]!==!1,onClick:()=>we(F=>({...F,[ce.stableKey]:F[ce.stableKey]===
!1}))},X[ce.stableKey]===!1?"+":"-"),React.createElement("button",{className:"host-resource-process-select",type:"button",
onClick:()=>Z(ce.stableKey)},React.createElement("strong",null,ce.agentLabel||ce.name),React.createElement("span",null,ce.
agentLabel?`${ce.name} / `:"","PID ",ce.pid,ce.workspaceLabel?` / ${ce.workspaceLabel}`:"",ce.parentKey?" / child proces\
s":ce.parentPid?` / parent PID ${ce.parentPid} outside sample`:""))),React.createElement("td",{"data-label":"Confidence"},
React.createElement("strong",null,ce.attributionLevel),React.createElement("span",{title:ce.attributionReason},ce.attributionReason)),
React.createElement("td",{"data-label":"CPU host / core"},ce.cpuHostPercent.toFixed(1),"% / ",ce.cpuCoreEquivalent.toFixed(
1),"%"),React.createElement("td",{"data-label":"Memory"},ts(ce.memoryBytes)),React.createElement("td",{"data-label":"Rea\
d"},ns(ce.ioReadBps)),React.createElement("td",{"data-label":"Write"},ns(ce.ioWriteBps)))))))),React.createElement("div",
{className:"host-resource-privacy"},React.createElement("strong",null,"Privacy boundary:")," sanitized metrics cross the\
 authenticated relay only to this requester while this view is open. The relay does not cache, persist, log, or restore \
them. Process command lines and executable paths remain local and are never transmitted. Aggregate-only mode also remove\
s machine, device, adapter, workspace, process, and PID labels.")):React.createElement("div",{className:"usage-dashboard\
-empty host-resource-empty"},React.createElement("strong",null,"Waiting for the Windows proxy."),React.createElement("sp\
an",null,"The subscription is ",a?.status||"starting",". Gaps remain visible; unavailable samples are not interpolated.")))}
function Qv(e){let t=Number(e?.percent);if(Number.isFinite(t))return Math.max(0,Math.min(100,t));let n=Number(e?.completed),
s=Number(e?.total);return Number.isInteger(n)&&Number.isInteger(s)&&s>0?Math.max(0,Math.min(100,n/s*100)):null}function Jv(e,t){
let n=oe(e?.last_snippet).trim();if(n)return n.replace(/\s+/g," ").slice(0,180);let s=Array.isArray(t)?t:[];for(let a=s.
length-1;a>=0;a-=1){let i=Ob(s[a]?.content||Ho(s[a]?.content_blocks));if(i)return i.slice(0,180)}return"No recent messag\
e reported."}function Zv(e,t){if(e?.goal)return tf(e.goal,t,e.goal_run);let n=Date.parse(e?.startedAt||e?.started_at||e?.
since||"");return Number.isFinite(n)?pu(Math.max(0,(t-n)/1e3),{includeSeconds:!0}):"live"}function ey(e,t,n=20){let s=e.
filter(a=>t[a]?.canReceiveBroadcast).slice(0,n);return s.length===e.length&&s.every((a,i)=>a===e[i])?e:s}function ty({sessions:e,
activities:t,thinking:n,permissionPrompts:s,errorPrompts:a,messages:i,agentConfigs:c,sessionAttention:u,health:f,connected:b,
deliveryStates:k,stopPending:N,goalControlPending:A,onBroadcastSend:S,onInterrupt:M,onGoalControl:d,onBack:v,onSelectSession:g}){
let[x,w]=React.useState(Date.now()),[E,T]=React.useState(!1),[U,Y]=React.useState([]),[re,ee]=React.useState(""),[ae,W]=React.
useState(""),[ie,ge]=React.useState(""),[X,we]=React.useState({});React.useEffect(()=>{let $=setInterval(()=>w(Date.now()),
1e3);return()=>clearInterval($)},[]);let ve=React.useMemo(()=>(e||[]).map($=>{let H=Pe($),be=Object.prototype.hasOwnProperty.
call(t,H)?t[H]||{kind:"idle",label:""}:$?.activity||{kind:"idle",label:""},_e=s[H]||(jr(a[H])?a[H]:null),Ne=u[H]||null,Le=!!_e||
$?.rate_limit_active===!0||["goal_attention","provider_usage_threshold"].includes(Ne?.kind),Ae=c[H]||{},He=$?.agent_type,
je=ab(He,Ae.capabilities)?be:{...be,goal:null},F=n[H]&&!je?.kind?{...je,kind:"thinking"}:je,ne=Ii(F,Le,{connected:b,health:f[H],
nowMs:x,requireFreshness:!0}),Ce=ne==="needs_attention",Ue=Pa(ne),Nt=Oi(je,{connected:b,health:f[H]}),Jt=Fr($,Ae),j=ob({
agentType:He,capabilities:Ae.capabilities,activity:je,latestUserRequest:$?.last_user_request||rb(i[H]||[])}),yt=j.kind===
"goal"&&je?.goal||null,Dt=String(yt?.state||yt?.status||"").toLowerCase(),hn=Dt==="blocked",On=hn&&Ae.capabilities?.goal_blocked_resume===
!0,Dn=Dt==="active"?"pause":Dt==="paused"||On?"resume":null,Ga=hn?oe(yt?.block_reason||yt?.reason||je?.label||"Goal bloc\
ked").trim():"",Ur=["thinking","generating","running_command","applying_patch","reading_files","working"].includes(String(
je?.kind||"").toLowerCase()),Wa=oe(je?.kind).replace(/_/g," "),oa=Number($?.percent_used),os=$?.rate_limited_until&&$.rate_limited_until!==
"unknown"?Fo($.rate_limited_until):"",za=$?.rate_limit_active===!0?`Usage limited${os?` \xB7 resets ${os}`:" \xB7 reset unk\
nown"}`:Number.isFinite(oa)&&oa>=75?`Usage ${Math.round(oa)}% used${os?` \xB7 resets ${os}`:""}`:"";return{id:H,session:$,
agent:Jt,activity:je,attention:Ce,working:Ue,state:ne,goal:yt,config:Ae,stateLabel:$?.rate_limit_active===!0?"Usage limi\
ted":Jd(ne),title:Do($,H,Ae,i[H]||[]),status:_e?oe(_e.title).trim()||"Action required":za||Nt||oe(be?.label).trim()||(ne===
"idle"?yt?"Goal paused":"Idle":Wa||(yt?"Goal active":"Working")),workContext:j,progress:Qv(j),snippet:Jv($,i[H]||[]),health:f[H]||
"unknown",canReceiveBroadcast:zp($,c[H],f[H]||"unknown",b),freshness:tp(be,x),activityLatencyMs:Number.isFinite(Number(be?.
transport?.latency_ms))?Math.round(Number(be.transport.latency_ms)):null,goalAction:Dn,canControlGoal:!!(Dn&&yt?.fingerprint&&
Ae.capabilities?.goal_pause_resume===!0&&Number($?.control_generation)>0),goalBlocked:hn,goalBlockedReason:Ga,canInterrupt:!!(Ur&&
Ae.capabilities?.interrupt===!0&&Number($?.control_generation)>0&&Number($?.turn_generation)>0)}}).filter(Boolean).sort(
($,H)=>Number(H.attention)-Number($.attention)||Number(H.working)-Number($.working)||$.title.localeCompare(H.title)),[e,
t,n,s,a,i,c,u,f,b,x]),Z=React.useMemo(()=>ve.filter($=>E||$.state!=="idle"||$.goal),[ve,E]),Se=ve.filter($=>$.state==="n\
eeds_attention").length,Q=ve.filter($=>$.working).length,de=ve.filter($=>$.state==="working_goal").length,pe=ve.filter($=>$.
state==="idle").length,J=React.useMemo(()=>Object.fromEntries(Z.map($=>[$.id,$])),[Z]),q=`SEND TO ${U.length} SESSIONS`;
React.useEffect(()=>{U.length<=20&&U.every($=>J[$]?.canReceiveBroadcast)||Y($=>ey($,J))},[J,U]),React.useEffect(()=>{Object.
keys(X).length!==0&&we($=>{let H=!1,fe={};return Object.entries($).forEach(([be,_e])=>{let Ne=k[_e.clientMessageId]||_e.
status,Le=["offline_queued","busy_queued","steered"].includes(Ne)?"queued":Ne,Ae=["queued","accepted","launch_accepted",
"delivered","agent_started","failed"].includes(Le)?Le:_e.status;fe[be]=Ae===_e.status?_e:{..._e,status:Ae},fe[be]!==_e&&
(H=!0)}),H?fe:$})},[k]);function G($){ge(""),Y(H=>H.includes($)?H.filter(fe=>fe!==$):H.length<20?[...H,$]:H)}function te(){
let $=Kp({session_ids:U,content:re,confirmation:ae},be=>!!J[be]?.canReceiveBroadcast);if(!$.ok){ge($.error);return}let H=Vp(
$.sessionIds),fe={};$.sessionIds.forEach(be=>{let _e=S(be,$.content);fe[be]={...H[be],clientMessageId:_e,title:J[be]?.title||
be}}),we(fe),ee(""),W(""),ge("")}return React.createElement("div",{className:"fleet-view","data-testid":"fleet-view"},React.
createElement("div",{className:"automations-header fleet-view-header"},React.createElement("button",{className:"automati\
ons-back",onClick:v,title:"Back to sessions"},"\u2190"),React.createElement("div",{className:"automations-header-text"},
React.createElement("h2",null,"Fleet view"),React.createElement("p",null,"Live monitoring across every active harness se\
ssion."))),React.createElement("div",{className:"fleet-summary","aria-label":"Fleet summary"},React.createElement("div",
null,React.createElement("strong",null,ve.length),React.createElement("span",null,"sessions")),React.createElement("div",
{className:Q?"working":""},React.createElement("strong",null,Q),React.createElement("span",null,"working")),React.createElement(
"div",{className:de?"working-goal":""},React.createElement("strong",null,de),React.createElement("span",null,"on goal")),
React.createElement("div",null,React.createElement("strong",null,pe),React.createElement("span",null,"idle")),React.createElement(
"div",{className:Se?"attention":""},React.createElement("strong",null,Se),React.createElement("span",null,"need attentio\
n"))),React.createElement("div",{className:"fleet-filter-row"},React.createElement("span",null,Q," working now"),React.createElement(
"button",{type:"button",onClick:()=>T($=>!$),"aria-pressed":E},E?"Hide idle sessions":`Show ${pe} idle session${pe===1?"":
"s"}`)),React.createElement("section",{className:"fleet-broadcast","data-testid":"broadcast-send"},React.createElement("\
div",{className:"fleet-broadcast-heading"},React.createElement("div",null,React.createElement("strong",null,"Broadcast p\
rompt"),React.createElement("span",null,"Select up to ",20," capable sessions.")),React.createElement("span",null,U.length,
" selected")),React.createElement("textarea",{value:re,onChange:$=>ee($.target.value),maxLength:65536,placeholder:"Promp\
t every selected session...","aria-label":"Broadcast prompt"}),React.createElement("div",{className:"fleet-broadcast-con\
firm"},React.createElement("label",null,React.createElement("span",null,"Type ",React.createElement("strong",null,q)," t\
o confirm"),React.createElement("input",{value:ae,onChange:$=>W($.target.value),"aria-label":"Broadcast confirmation"})),
React.createElement("button",{type:"button",onClick:te,disabled:!b||U.length===0||!re.trim()||ae!==q},"Send to ",U.length||
0)),ie&&React.createElement("div",{className:"fleet-broadcast-error",role:"alert"},ie),Object.keys(X).length>0&&React.createElement(
"div",{className:"fleet-broadcast-receipts","aria-label":"Broadcast delivery receipts"},Object.entries(X).map(([$,H])=>React.
createElement("span",{key:$,className:`fleet-broadcast-receipt ${H.status}`,title:H.title},React.createElement("strong",
null,H.title),React.createElement("em",null,H.status.replace(/_/g," ")))))),Z.length===0?React.createElement("div",{className:"\
fleet-empty"},React.createElement("strong",null,"Fleet is idle"),React.createElement("span",null,pe," connected session",
pe===1?" is":"s are"," idle. Show idle sessions to inspect them.")):React.createElement("div",{className:"fleet-grid"},Z.
map($=>React.createElement("div",{role:"button",tabIndex:0,className:`fleet-card state-${$.state}${$.attention?" attenti\
on":""}${U.includes($.id)?" selected":""}`,key:$.id,"data-session-id":$.id,"data-activity-state":$.state,"data-activity-\
lag-ms":$.activityLatencyMs??"",onClick:()=>g($.id,$.session),onKeyDown:H=>{H.target===H.currentTarget&&(H.key==="Enter"||
H.key===" ")&&g($.id,$.session)}},React.createElement("span",{className:"fleet-card-top"},React.createElement("span",{className:"\
agent-badge",style:{color:$.agent.color,borderColor:$.agent.color+"55",background:$.agent.color+"18"}},$.agent.logo?React.
createElement("img",{src:$.agent.logo,alt:"",className:"agent-badge-logo"}):$.agent.abbr),React.createElement("span",{className:"\
fleet-card-identity"},React.createElement("strong",null,$.title),React.createElement("span",null,$.agent.name)),React.createElement(
"span",{className:`fleet-health ${$.health}`,title:$.health}),React.createElement("label",{className:`fleet-select${$.canReceiveBroadcast?
"":" unavailable"}`,onClick:H=>H.stopPropagation()},React.createElement("input",{type:"checkbox",checked:U.includes($.id),
disabled:!$.canReceiveBroadcast,onChange:()=>G($.id),"aria-label":`Select ${$.title} for broadcast`}),React.createElement(
"span",null,$.canReceiveBroadcast?"Select":"Unavailable"))),React.createElement("span",{className:"fleet-card-status"},$.
working&&React.createElement(jo,{agentType:$.session?.agent_type,compact:!0,animate:!1}),React.createElement("span",{className:`\
fleet-state-badge ${$.state}`},$.stateLabel),React.createElement("strong",null,$.status),$.working&&React.createElement(
"time",null,Zv($.activity,x))),React.createElement("span",{className:"fleet-freshness",title:"Proxy-to-Fleet delivery ti\
me"},"Activity ",$.freshness),($.canControlGoal||$.goalBlocked||$.canInterrupt)&&React.createElement("span",{className:"\
fleet-control-actions",role:"group","aria-label":`Controls for ${$.title}`,onClick:H=>H.stopPropagation()},$.canControlGoal&&
React.createElement("button",{type:"button",onClick:()=>d($.id,$.goalAction,$.goal,$.session),disabled:!b||!!A?.[$.id],"\
aria-label":`${$.goalAction==="pause"?"Pause":$.goalBlocked?"Resume blocked":"Resume"} goal for ${$.title}`,title:$.goalBlocked?
$.goalBlockedReason:void 0},A?.[$.id]?$.goalAction==="pause"?"Pausing...":"Resuming...":$.goalAction==="pause"?"Pause go\
al":$.goalBlocked?"Resume blocked goal":"Resume goal"),$.goalBlocked&&!$.canControlGoal&&React.createElement("button",{type:"\
button",disabled:!0,"aria-label":`Goal blocked for ${$.title}; resolve in the native session`,title:$.goalBlockedReason||
"No verified native unblock action is available"},"Goal blocked \xB7 native action required"),$.canInterrupt&&React.createElement(
"button",{type:"button",className:"danger",onClick:()=>M($.id,$.session),disabled:!b||!!N?.[$.id],"aria-label":`Interrup\
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
n"},"Open session ",React.createElement("span",{className:"fleet-jump-chevron","aria-hidden":"true"},"\u203A"))))))}function ny({
onBack:e,onOpenResult:t}){let[n,s]=React.useState(""),[a,i]=React.useState(""),[c,u]=React.useState(""),[f,b]=React.useState(
""),[k,N]=React.useState(""),[A,S]=React.useState([]),[M,d]=React.useState(!0),[v,g]=React.useState(!1),[x,w]=React.useState(
"");async function E(T){if(T?.preventDefault(),!(n.trim().length<2||v)){g(!0),w("");try{let U=new URLSearchParams({q:n.trim(),
limit:"50"});a.trim()&&U.set("project",a.trim()),c.trim()&&U.set("harness",c.trim()),f&&U.set("date_from",f),k&&U.set("d\
ate_to",k);let Y=await fetch(`/api/search/messages?${U.toString()}`,{credentials:"same-origin"}),re=await Y.json().catch(
()=>({}));if(!Y.ok)throw new Error(re.error||"Transcript search failed.");S(Array.isArray(re.results)?re.results:[]),d(re.
index?.ready!==!1)}catch(U){S([]),w(U?.message||"Transcript search failed.")}finally{g(!1)}}}return React.createElement(
"div",{className:"transcript-search-view","data-testid":"transcript-search-view"},React.createElement("div",{className:"\
automations-header transcript-search-header"},React.createElement("button",{className:"skills-back",onClick:e,title:"Bac\
k to sessions"},"\u2190"),React.createElement("div",null,React.createElement("h2",null,"Transcript search"),React.createElement(
"p",null,"Search every relay-backed message."))),React.createElement("form",{className:"transcript-search-form",onSubmit:E},
React.createElement("label",{className:"transcript-search-query"},React.createElement("span",null,"Search text"),React.createElement(
"input",{value:n,onChange:T=>s(T.target.value),placeholder:"Words from any conversation",maxLength:200,autoFocus:!0})),React.
createElement("div",{className:"transcript-search-filters"},React.createElement("label",null,React.createElement("span",
null,"Project"),React.createElement("input",{value:a,onChange:T=>i(T.target.value),placeholder:"Exact workspace or proje\
ct",maxLength:300})),React.createElement("label",null,React.createElement("span",null,"Harness"),React.createElement("in\
put",{value:c,onChange:T=>u(T.target.value),placeholder:"e.g. codex_cli",maxLength:80})),React.createElement("label",null,
React.createElement("span",null,"From"),React.createElement("input",{type:"date",value:f,onChange:T=>b(T.target.value)})),
React.createElement("label",null,React.createElement("span",null,"To"),React.createElement("input",{type:"date",value:k,
onChange:T=>N(T.target.value)}))),React.createElement("button",{type:"submit",className:"transcript-search-submit",disabled:n.
trim().length<2||v},v?"Searching\u2026":"Search transcripts")),!M&&React.createElement("div",{className:"transcript-sear\
ch-indexing"},"Older history is still indexing; current results are partial."),x&&React.createElement("div",{className:"\
transcript-search-error",role:"alert"},x),!v&&!x&&A.length===0&&n.trim().length>=2&&React.createElement("div",{className:"\
fleet-empty"},React.createElement("strong",null,"No matches"),React.createElement("span",null,"Try fewer words or clear \
a filter.")),React.createElement("div",{className:"transcript-search-results","aria-live":"polite"},A.map(T=>React.createElement(
"button",{type:"button",className:"transcript-search-result",key:`${T.session_id}:${T.message_id}`,onClick:()=>t(T)},React.
createElement("span",{className:"transcript-search-result-top"},React.createElement("strong",null,T.workspace_name||T.project_root||
T.session_id),React.createElement("em",null,T.agent_type||"unknown"," \xB7 ",T.role)),React.createElement("span",{className:"\
transcript-search-snippet"},T.snippet||"(empty message)"),React.createElement("span",{className:"transcript-search-resul\
t-bottom"},React.createElement("time",null,T.matched_at?new Date(T.matched_at).toLocaleString():""),React.createElement(
"span",null,"Open match \u203A"))))))}function sy({skills:e,onRefresh:t,onBack:n}){let s=e?.installed||[],a=e?.recommended||
[],i=s.length===0&&a.length===0;return React.createElement("div",{className:"skills-view"},React.createElement("div",{className:"\
skills-header"},React.createElement("button",{className:"skills-back",onClick:n,title:"Back to sessions"},"\u2190"),React.
createElement("div",{className:"skills-header-text"},React.createElement("h2",null,"Skills"),React.createElement("p",{className:"\
skills-subtitle"},"Give Codex superpowers.")),React.createElement("button",{className:"skills-refresh-btn",onClick:t,title:"\
Refresh skills"},"\u21BB")),i?React.createElement("div",{className:"skills-loading"},"Loading skills\u2026"):React.createElement(
"div",{className:"skills-body"},s.length>0&&React.createElement("div",{className:"skills-section"},React.createElement("\
h3",{className:"skills-section-title"},"Installed"),React.createElement("div",{className:"skills-card-list"},s.map((c,u)=>React.
createElement("div",{key:c.id||u,className:"skills-card"},React.createElement("div",{className:"skills-card-icon"},c.icon?
React.createElement("img",{src:c.icon,alt:"",className:"skills-card-img"}):React.createElement("span",{className:"skills\
-card-placeholder"},"\u2699")),React.createElement("div",{className:"skills-card-body"},React.createElement("div",{className:"\
skills-card-name"},c.name),c.description&&React.createElement("div",{className:"skills-card-desc"},c.description)),React.
createElement("div",{className:"skills-card-action installed"},"\u2713"))))),a.length>0&&React.createElement("div",{className:"\
skills-section"},React.createElement("h3",{className:"skills-section-title"},"Recommended"),React.createElement("div",{className:"\
skills-card-list"},a.map((c,u)=>React.createElement("div",{key:c.id||u,className:"skills-card"},React.createElement("div",
{className:"skills-card-icon"},c.icon?React.createElement("img",{src:c.icon,alt:"",className:"skills-card-img"}):React.createElement(
"span",{className:"skills-card-placeholder"},"\u2699")),React.createElement("div",{className:"skills-card-body"},React.createElement(
"div",{className:"skills-card-name"},c.name),c.description&&React.createElement("div",{className:"skills-card-desc"},c.description)),
React.createElement("div",{className:"skills-card-action available"},"+")))))))}var ou=class extends React.Component{constructor(t){
super(t),this.state={error:null}}static getDerivedStateFromError(t){return{error:t}}componentDidCatch(t,n){try{console.error(
"Agent Chat render crash",t,n),sessionStorage.setItem("agent-chat:last-render-error",JSON.stringify({message:t?.message||
String(t),stack:t?.stack||"",componentStack:n?.componentStack||"",at:new Date().toISOString()}))}catch{}}render(){return this.
state.error?React.createElement("div",{className:"app-crash"},React.createElement("div",{className:"app-crash-card"},React.
createElement("div",{className:"app-crash-title"},"Agent Chat hit a render error"),React.createElement("div",{className:"\
app-crash-body"},this.state.error?.message||"Unknown UI error"),React.createElement("div",{className:"app-crash-actions"},
React.createElement("button",{className:"app-crash-btn",onClick:()=>location.reload()},"Refresh")))):this.props.children}},
iu=class extends React.Component{componentDidMount(){this.props.finishStructureChange(null)}getSnapshotBeforeUpdate(t){return t.
structureKey===this.props.structureKey?null:this.props.prepareStructureChange(t.placements,this.props.placements)}componentDidUpdate(t,n,s){
t.structureKey!==this.props.structureKey&&this.props.finishStructureChange(s)}render(){return this.props.children}};function ay(){
React.useLayoutEffect(()=>{let o=typeof window<"u"?window.__RAC_TEMPORAL_CANARY__:null;if(!o?.active)return;let _=o.reactCommits||
(o.reactCommits=[]);_.length<2e4?_.push({sequence:_.length+1,at_epoch_ms:Date.now(),route:document.querySelector(".messa\
ges")?"chat":"other"}):o.droppedSamples=Number(o.droppedSamples||0)+1});let{sessions:e,messages:t,provisionalStreams:n,historyMeta:s,
historyLoading:a,connected:i,connectionHealth:c,unread:u,setUnread:f,thinking:b,thinkingContent:k,activities:N,health:A,
deliveryStates:S,launchStates:M,justLaunched:d,setJustLaunched:v,permissionPrompts:g,respondToPrompt:x,errorPrompts:w,respondToErrorPrompt:E,
interruptSession:T,controlGoal:U,agentConfigs:Y,configControlStates:re,requestAgentConfig:ee,setAgentModel:ae,setAgentEffort:W,
setAgentPermissionMode:ie,setAutoApprovePermissions:ge,setAntigravityMode:X,setCodexConfig:we,newThread:ve,openPanel:Z,openNativeWindow:Se,
requestChatList:Q,switchChat:de,newChat:pe,chatLists:J,requestThreadList:q,switchThread:G,threadLists:te,switchWorkspace:$,
requestTerminalOutput:H,sendTerminalInput:fe,terminalOutputs:be,requestFileChanges:_e,respondToFileChange:Ne,fileChanges:Le,
sendAttachment:Ae,send:He,sendToSession:ce,steerMessage:je,discardQueuedMessage:F,editQueuedMessage:ne,queuedMessages:Ce,
scheduledSends:Ue,scheduleSend:Nt,cancelScheduledSend:Jt,launchSession:j,resumeSession:yt,closeSession:Dt,activeSessionRef:hn,
restoreCachedTranscript:On,setSessionSubscriptions:Dn,workspaces:Ga,branchLists:Ur,requestBranchList:Wa,switchBranch:oa,
createBranch:os,skillLists:za,requestSkillList:Ka,automationViews:pc,showCodexAutomation:Gr,controlResults:jn,directoryListings:Uo,
requestDirectoryListing:Wr,fileContents:Va,requestFileContent:ia,requestHistory:zr,requestHistoryChunk:ca,duplicateProxyAlarms:_n,
nightlyValidationFailures:Go,latestAppUpdateValidation:bn,revalidationProgramHealth:Kr,operatorDogfoodHealth:jt,providerUsage:Wo,
providerUsageRefreshReceipt:xs,requestProviderUsageRefresh:mc,setProviderUsageWatching:As,providerUsageResetReceipt:fc,consumeProviderUsageResetCredit:la,
providerUsageCostDetail:gc,requestProviderUsageCostDetail:Rs,hostResources:hc,hostResourceError:Vr,hostResourceHistory:zo,
hostResourceDetails:_c,hostResourceSubscription:vn,subscribeHostResources:is,unsubscribeHostResources:Bt,requestHostResourceRefresh:Bn,
semanticNotifications:ua,sessionAliases:nt}=Ep(),[m,lt]=le(null),gt=React.useCallback(o=>Kd(m,o),[m]),Ya=React.useCallback(
()=>Ei(m),[m]),Ms=React.useSyncExternalStore(gt,Ya,Ya),[da,Xa]=le({}),[pa,Ts]=le({}),[yn,ot]=le(!1),[Yr,Qa]=le(""),[Xr,cs]=le(
""),[st,Fn]=le(null),[Qr,ma]=le({}),[ls,Hn]=le(yv),[Ko,us]=le(!1),Ge=Te(null),Je=Te({}),fa=Te(!1),[$s,Es]=le(!1),[Zt,Tt]=le(
!1),[ut,ht]=le(!1),[kn,$t]=le(!1),[_t,Ze]=le(!1),[Ja,ga]=le(!1),[ha,Un]=le(""),[We,en]=le({}),[Jr,bc]=le(!1),[vc,yc]=le(
""),[Za,er]=le(!1),[Zr,ds]=le(!1),[ps,ke]=le(!1),[eo,tr]=le(""),[ms,Gn]=le(0),[nr,wn]=le(!1),[fs,Ls]=le(!1),[Wt,to]=le({}),
[gs,Vo]=le({}),[hs,Ps]=le({}),sr=Te(new Map),[_a,tn]=le(null),et=Te({sessionId:null,expiresAt:0}),kt=Te(null),[ba,Wn]=le(
!1),[nn,ar]=le(0),[zn,dt]=le(!1),[zt,Et]=le(!0),[kc,va]=le({}),[Kt,sn]=le(!1),[Sn,_s]=le({}),[an,no]=le({}),[qs,Lt]=le({}),
[bs,Yo]=le(!1),[so,ya]=le(!1),[Is,rr]=le(!1),[Os,Kn]=le(!1),[Ds,Nn]=le(!1),[js,Cn]=le(!1),[vs,xn]=le(!1),[Bs,rn]=le(!1),
[Fs,Vn]=le(!1),[at,or]=le(null),[on,Xo]=le(!1),[Qo,Jo]=le("."),[ao,ka]=le(null),[wa,ro]=le(null),Zo=Te(null),[wc,ei]=le(
0),oo=Te(null),[ir,Sc]=le(()=>{try{return localStorage.getItem("remote-agent-chat-theme")||"dark"}catch{return"dark"}}),
[Ft,Nc]=le(()=>{try{let o=JSON.parse(localStorage.getItem("remote-agent-chat:collapsed-directories:v1")||"[]");return Array.
isArray(o)?Object.fromEntries(o.map(_=>[String(_),!0])):{}}catch{return{}}}),[An,Cc]=le(()=>{try{return localStorage.getItem(
hm)==="1"}catch{return!1}});Ee(()=>{try{localStorage.setItem(hm,An?"1":"0")}catch{}},[An]);let[Hs]=le(()=>{try{let o=JSON.
parse(localStorage.getItem(Il)||"{}");return Yi(o)}catch{return Yi(Ki)}});Ee(()=>{try{localStorage.setItem(Il,JSON.stringify(
Hs))}catch{}},[Hs]),Ee(()=>{fetch("/api/preferences/sessions",{credentials:"same-origin"}).then(o=>o.ok?o.json():Promise.
reject(new Error("Session settings unavailable"))).then(o=>{en(o.preferences||{}),bc(!0)}).catch(()=>{})},[]),Ee(()=>{let o=!0;
return fetch("/api/preferences/notifications",{credentials:"same-origin"}).then(_=>_.ok?_.json():Promise.reject(new Error(
"Notification settings unavailable"))).then(_=>{o&&(Hn({..._u,..._.preferences||{},turn_ready:!1}),us(!0))}).catch(()=>{}),
()=>{o=!1}},[]),Ee(()=>{if(!ls.completion_sound)return;let o=()=>bu();return document.addEventListener("pointerdown",o,{
once:!0}),document.addEventListener("keydown",o,{once:!0}),()=>{document.removeEventListener("pointerdown",o),document.removeEventListener(
"keydown",o)}},[ls.completion_sound]);async function ti(o,_){let R=await fetch(`/api/preferences/sessions/${encodeURIComponent(
o)}`,{method:"PUT",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({preference:_})}),
C=await R.json().catch(()=>({}));if(!R.ok)throw new Error(C.error||"Unable to save session settings.");return en(I=>({...I,
[o]:C.preference})),C.preference?.archived&&m===o&&lt(null),C.preference}async function xc(o,_){let R=await fetch(`/api/\
sessions/${encodeURIComponent(o)}/export?format=${encodeURIComponent(_)}`,{credentials:"same-origin"});if(!R.ok){let qe=await R.
json().catch(()=>({}));throw new Error(qe.error||"Unable to export session.")}let I=(R.headers.get("Content-Disposition")||
"").match(/filename\*=UTF-8''([^;]+)/i)?.[1],z=`session.${_==="json"?"json":"md"}`;if(I)try{z=decodeURIComponent(I)}catch{}
let se=URL.createObjectURL(await R.blob()),ue=document.createElement("a");ue.href=se,ue.download=z,ue.hidden=!0,document.
body.appendChild(ue),ue.click(),ue.remove(),setTimeout(()=>URL.revokeObjectURL(se),1e3)}Ee(()=>{try{let o=Object.keys(Ft).
filter(_=>Ft[_]);localStorage.setItem("remote-agent-chat:collapsed-directories:v1",JSON.stringify(o))}catch{}},[Ft]);let ni=React.
useCallback(o=>{Nc(_=>({..._,[o]:!_[o]}))},[]),si=Te(je);Ee(()=>{si.current=je},[je]);let ai=React.useCallback((o,_)=>{m&&
si.current(m,o,_)},[m]),ri=Te(ce);Ee(()=>{ri.current=ce},[ce]);let cr=React.useCallback(o=>{!m||!o?._cid||ri.current(m,o.
content,o._cid)},[m]),io=Te(ia);Ee(()=>{io.current=ia},[ia]);let Sa=React.useMemo(()=>[...e||[]].map(o=>{let _=Pe(o),R=We[_];
return R?.display_name?typeof o=="object"?{...o,custom_display_name:R.display_name}:{session_id:_,custom_display_name:R.
display_name}:o}),[e,We]),Rn=React.useMemo(()=>new Set(Sa.filter(Ol).map(Pe)),[Sa]),lr=React.useMemo(()=>Sa.filter(o=>!Ol(
o)),[Sa]),Na=An?Sa:lr,r=React.useMemo(()=>Na.filter(o=>!We[Pe(o)]?.archived),[Na,We]),p=React.useMemo(()=>lr.filter(o=>!We[Pe(
o)]?.archived),[lr,We]),y=Yb(N,r),P=React.useMemo(()=>({activities:N,thinking:b,pendingPrompts:g,errorPrompts:Object.fromEntries(
Object.entries(w||{}).filter(([,o])=>jr(o))),health:A,connected:i,nowMs:y,requireFreshness:!0}),[N,b,g,w,A,i,y]),{working:l,
states:h}=React.useMemo(()=>Dp(r,P),[r,P]),L=Te(null),O=Te(null),K=Te(null),V=Te(0),he=Te(null),me=Te(null),xe=Te(null),
[Be,Xe]=le(!1),bt=React.useCallback(()=>{K.current&&clearTimeout(K.current),K.current=null,Xe(!0)},[]),Re=React.useCallback(
(o=0)=>{K.current&&clearTimeout(K.current),K.current=setTimeout(()=>{K.current=null,Xe(!1)},o)},[]);React.useEffect(()=>{
let o=()=>Re(80);return window.addEventListener("pointerup",o,!0),window.addEventListener("pointercancel",o,!0),()=>{window.
removeEventListener("pointerup",o,!0),window.removeEventListener("pointercancel",o,!0),K.current&&clearTimeout(K.current),
me.current&&cancelAnimationFrame(me.current),xe.current&&cancelAnimationFrame(xe.current)}},[Re]);let{sessions:Ie}=Vb(l,
Be),ze=React.useMemo(()=>new Set(Ie.map(Pe)),[Ie]),{pinned:Ht}=React.useMemo(()=>Pp(r,We),[r,We]),oi=React.useMemo(()=>new Set(
Ht.map(Pe)),[Ht]),Ca=React.useMemo(()=>dp(r,{workingSessionIds:ze,pinnedSessionIds:oi}),[r,ze,oi]),Pt=Ca.recent,cf=React.
useMemo(()=>new Set(Pt.map(Pe)),[Pt]),Yn=Ca.pinned,lf=React.useMemo(()=>jl(Ca.remaining,Y,Hs),[Ca.remaining,Y,Hs]),ur=React.
useMemo(()=>Object.fromEntries(jl(r,Y,Hs).flatMap(o=>o.sessions.map(_=>[Pe(_),o.label]))),[r,Y,Hs]),uf=React.useMemo(()=>({
...P,messages:t,rankWorking:!1}),[P,t]),{groups:vu,orderChanged:ii,sortNow:yu}=Gb(lf,uf,Be),Mn=React.useMemo(()=>vu.filter(
o=>o.sessions.length>0),[vu]),df=React.useMemo(()=>new Set(Mn.flatMap(o=>o.sessions.map(Pe))),[Mn]),pf=React.useCallback(
()=>{let o=L.current,_=m?o?.querySelector(`[data-session-id="${CSS.escape(m)}"]`):null;O.current=_?{sessionId:m,top:_.getBoundingClientRect().
top}:null,yu()},[m,yu]),pt=Yr.trim().toLowerCase(),ku=React.useMemo(()=>Object.fromEntries(r.map(o=>{let _=Pe(o),R=Fr(o,
Y[_]);return[_,[Do(o,_,Y[_],t[_]||[]),Br(o,_,Y[_]),ur[_]||"Unscoped",We[_]?.pinned?"Pinned":"",R.name,o?.agent_type,o?.workspace_name,
o?.workspace_path,_].filter(Boolean).join(" ").toLowerCase()]})),[r,Y,t,ur,We]),Us=React.useCallback(o=>pt?o.filter(_=>(ku[Pe(
_)]||"").includes(pt)):o,[pt,ku]),dr=React.useMemo(()=>Us(Ie),[Us,Ie]),pr=React.useMemo(()=>Us(Pt),[Us,Pt]),mr=React.useMemo(
()=>Us(Yn),[Us,Yn]),wu=React.useMemo(()=>Mn.map(o=>({...o,sessions:Us(o.sessions)})).filter(o=>o.sessions.length>0),[Us,
Mn]),Su=React.useMemo(()=>[...Ie,...Pt,...Yn,...Mn.flatMap(o=>o.sessions)],[Ie,Pt,Yn,Mn]),Ac=React.useMemo(()=>{let o=new Set;
return r.filter(_=>{let R=Pe(_);return!R||o.has(R)?!1:(o.add(R),!0)})},[r]),Nu=React.useMemo(()=>new Set(Ac.map(Pe)),[Ac]),
mf=React.useMemo(()=>{let o=new Map,_=(R,C)=>{for(let I of R){let z=Pe(I);z&&!o.has(z)&&o.set(z,C)}};_(Ie,"working"),_(Pt,
"recent"),_(Yn,"pinned");for(let R of Mn)_(R.sessions,`workspace:${R.key}`);return o},[Ie,Pt,Yn,Mn]),ff=React.useMemo(()=>[
`working:${Ie.map(Pe).join(",")}`,`recent:${Pt.map(Pe).join(",")}`,`pinned:${Yn.map(Pe).join(",")}`,...Mn.map(o=>`${o.key}\
:${o.sessions.map(Pe).join(",")}`),`collapsed:${Object.keys(Ft).filter(o=>Ft[o]).sort().join(",")}`,`filter:${pt}`].join(
"|"),[Ie,Pt,Yn,Mn,Ft,pt]),Gs=Te(new Map),ci=Te(null),gf=React.useCallback((o,_)=>{let R=L.current;if(!R)return null;xe.current&&
(cancelAnimationFrame(xe.current),xe.current=null),R.classList.add("sidebar-structural-transaction");let C=document.activeElement,
I=C instanceof Element?C.closest("[data-sidebar-card-host]"):null,z=R.getBoundingClientRect(),se=Array.from(R.querySelectorAll(
"[data-session-id]")),ue=C instanceof Element?C.closest("[data-session-id]"):null,qe=se.filter(vt=>{let Vt=vt.getBoundingClientRect();
return Vt.bottom>z.top&&Vt.top<z.bottom}),mt=[...ue&&qe.includes(ue)?[ue]:[],...qe.filter(vt=>vt!==ue)].map(vt=>({sessionId:vt.
dataset.sessionId,top:vt.getBoundingClientRect().top})),En=R.scrollTop,Cr=[];for(let[vt,Vt]of o){let Ln=_.get(vt);if(!Ln||
Ln===Vt)continue;let Yt=Gs.current.get(vt);Yt&&Cr.push(Yt)}if(Cr.length>0){let vt=ci.current;vt||(vt=document.createElement(
"div"),vt.setAttribute("data-sidebar-card-pool",""),Object.assign(vt.style,{position:"fixed",left:"-10000px",top:"-10000\
px",width:"1px",height:"1px",overflow:"hidden",pointerEvents:"none"}),document.body.appendChild(vt),ci.current=vt);for(let Vt of Cr){
let Ln=Vt.closest("[data-sidebar-card-slot]");if(Ln){let Yt=Vt.querySelector("[data-session-id]"),Co=Yt?getComputedStyle(
Yt):null,Ci=Yt?Yt.getBoundingClientRect().height+(Number.parseFloat(Co?.marginTop)||0)+(Number.parseFloat(Co?.marginBottom)||
0):0;Ln.style.display="block",Ln.style.height=`${Ci}px`,Ln.setAttribute("data-sidebar-card-placeholder","")}vt.appendChild(
Vt)}}return I&&C?.isConnected&&document.activeElement!==C&&C.focus({preventScroll:!0}),{candidates:mt,scrollTop:En,interactionEpoch:V.
current,focusedElement:I?C:null,focusedHost:I,movedHostCount:Cr.length}},[]),hf=React.useCallback(o=>{let _=L.current;if(!_)
return;let R=o?.focusedElement||document.activeElement,C=o?.focusedHost||(R instanceof Element?R.closest("[data-sidebar-\
card-host]"):null),I=new Set;for(let ue of _.querySelectorAll("[data-sidebar-card-slot]")){let qe=ue.getAttribute("data-\
sidebar-card-slot")||"",De=Gs.current.get(qe);if(!(!qe||!De)&&(I.add(qe),De.parentElement!==ue)){let xt=C===De&&R?.isConnected;
ue.appendChild(De),xt&&document.activeElement!==R&&R.isConnected&&R.focus({preventScroll:!0})}}let z=O.current,se=z?{candidates:[
z],scrollTop:_.scrollTop,interactionEpoch:V.current}:o;if(se&&se.interactionEpoch===V.current){let qe=(Array.isArray(se.
candidates)?se.candidates:[]).map(mt=>({...mt,card:Array.from(_.querySelectorAll("[data-session-id]")).find(En=>En.dataset.
sessionId===mt.sessionId)})).find(mt=>mt.card),De=null,xt=null;if(qe){let mt=qe.card.getBoundingClientRect().top-qe.top;
Math.abs(mt)>.5&&(De=_.scrollTop+mt),xt=qe.sessionId}else Number.isFinite(se.scrollTop)&&(De=se.scrollTop);if(De!=null){
let mt=Math.max(0,Math.min(De,Math.max(0,_.scrollHeight-_.clientHeight)));if(Math.abs(_.scrollTop-mt)>.5){let En=_.scrollTop;
he.current={target:mt},_.scrollTop=mt,_.dispatchEvent(new CustomEvent("rac-sidebar-scroll-correction",{detail:{from:En,to:_.
scrollTop,anchorSessionId:xt,explicitSort:!!z}})),me.current&&cancelAnimationFrame(me.current),me.current=requestAnimationFrame(
()=>{he.current=null,me.current=null})}}}O.current=null;for(let[ue,qe]of Gs.current)I.has(ue)||Nu.has(ue)||(qe.remove(),
Gs.current.delete(ue));o?.focusedElement?.isConnected&&document.activeElement!==o.focusedElement&&o.focusedElement.focus(
{preventScroll:!0}),xe.current=requestAnimationFrame(()=>{xe.current=requestAnimationFrame(()=>{_.classList.remove("side\
bar-structural-transaction"),xe.current=null})})},[Nu]);Ee(()=>()=>{for(let o of Gs.current.values())o.remove();Gs.current.
clear(),ci.current?.remove(),ci.current=null,O.current=null},[]);let xa=React.useCallback(o=>o.reduce((_,R)=>{let C=Pe(R);
return _.unread+=Rn.has(C)?0:u[C]||0,_.hasPrompt=_.hasPrompt||!!g[C]||!!jr(w[C]),_.working=_.working||Pa(h[C]),_},{unread:0,
hasPrompt:!1,working:!1}),[Rn,u,g,w,h]),co=React.useMemo(()=>xa(dr),[xa,dr]),fr=React.useMemo(()=>xa(pr),[xa,pr]),gr=React.
useMemo(()=>xa(mr),[xa,mr]),ys=React.useMemo(()=>Su.map(o=>{let _=Pe(o),R=Fr(o,Y[_]),C=Do(o,_,Y[_],t[_]||[]),I=Br(o,_,Y[_]),
z=ur[_]||"Unscoped",se=[C,I,z,We[_]?.pinned?"Pinned":"",R.name,o?.agent_type,o?.workspace_name,o?.workspace_path,_].filter(
Boolean);return{id:_,session:o,groupLabel:z,title:C,subtitle:I,agentName:R.name,agentColor:R.color,working:Pa(h[_]),searchFields:se,
searchText:se.join(" ")}}),[Su,ur,We,Y,t,h]),qt=React.useMemo(()=>Hb(ys,eo).slice(0,60),[ys,eo]);Ee(()=>{Gn(o=>Math.max(
0,Math.min(o,qt.length-1)))},[qt.length]),Ee(()=>{if(!ps)return;let o=requestAnimationFrame(()=>{oo.current?.focus(),oo.
current?.select()});return()=>cancelAnimationFrame(o)},[ps]),Ee(()=>{ps&&document.getElementById(`quick-switcher-option-${ms}`)?.
scrollIntoView({block:"nearest"})},[ms,ps]),Ee(()=>{let o=()=>{ke(!1),tr(""),Gn(0),requestAnimationFrame(()=>un.current?.
focus())},_=C=>{C&&(Qn(C.id,C.session),ot(!1),o())},R=C=>{let I=oe(C.key).toLowerCase();if((C.metaKey||C.ctrlKey)&&!C.altKey&&
I==="p"){C.preventDefault(),wn(!1),ke(!0);return}if(ps){C.key==="Escape"?(C.preventDefault(),o()):C.key==="ArrowDown"?(C.
preventDefault(),Gn(z=>qt.length?(z+1)%qt.length:0)):C.key==="ArrowUp"?(C.preventDefault(),Gn(z=>qt.length?(z-1+qt.length)%
qt.length:0)):C.key==="Enter"&&qt.length>0&&(C.preventDefault(),_(qt[ms]||qt[0]));return}if(nr){(C.key==="Escape"||C.key===
"?"&&!tu(C.target))&&(C.preventDefault(),wn(!1),requestAnimationFrame(()=>un.current?.focus()));return}if(C.altKey&&!C.ctrlKey&&
!C.metaKey&&(C.key==="ArrowUp"||C.key==="ArrowDown")){if(ys.length===0)return;C.preventDefault();let z=ys.findIndex(De=>De.
id===m),se=C.key==="ArrowDown"?1:-1,ue=se>0?-1:0,qe=(Math.max(z,ue)+se+ys.length)%ys.length;_(ys[qe]);return}C.key==="?"&&
!C.altKey&&!C.ctrlKey&&!C.metaKey&&!tu(C.target)&&(C.preventDefault(),wn(!0))};return window.addEventListener("keydown",
R),()=>window.removeEventListener("keydown",R)},[m,ms,ys,ps,qt,nr]);let D=React.useMemo(()=>r.find(o=>Pe(o)===m),[r,m]),
Ws=m?Ms:_m,Ct=m&&n[m]||null,Cu=$p(D,Ws),li=m?N[m]:null,xu=m&&k[m]||"",ui=m&&g[m]||null,Rc=m&&w[m]||null,_f=React.useMemo(
()=>{let o=li&&typeof li=="object"?li:null,_=o?.goal||null,R=Array.isArray(o?.task_list?.tasks)?o.task_list.tasks.map(C=>`${C.
state||""}:${C.text||C.title||C.label||""}`).join("|"):"";return[xu,o?.kind||"",o?.label||"",o?.updatedAt||"",o?.startedAt||
"",o?.interruptHint||"",o?.thinkingContent||"",_?.status||"",_?.label||"",_?.objective||"",_?.time_used_seconds??_?.timeUsedSeconds??
"",_?.updated_at||"",R,ui?.id||ui?.request_id||"",Rc?.id||Rc?.request_id||"",Ct?.messageId||"",Ct?.content?.length||0,Ct?.
open?"open":"closed"].join("")},[li,xu,ui,Rc,Ct]),di={sessionId:m,messageCount:Ws.length,provisionalId:Ct?.messageId||"",
provisionalLength:Ct?.content?.length||0},bf=Te(null),cn=Te(null),pi=Te(!0),ln=Te(!0),mi=Te(0),hr=Te(0),lo=Te(0),uo=Te(0),
Mc=Te(null),Tc=Te(null),vf=Te({activeSemanticKey:"",lastClearedSemanticKey:"",clearedAt:0}),$c=Te(m),ks=Te({sessionId:null,
keys:[],scrollTop:0,scrollHeight:0,clientHeight:0,atBottom:!0}),_r=Te(null),po=Te(0),un=Te(null),fi=Te(()=>!1),yf=Te(null),
Ec=Te(di),Lc=Te(di),Xn=Te({}),ws=Te({sessionId:null,index:0,scratch:""}),Pc=Te(i),qc=Te({}),Au=Te({});Ec.current=di,fi.current=
()=>!!ui||typeof document<"u"&&document.activeElement===un.current||Date.now()<mi.current,ra(()=>{$c.current=m},[m]),ra(
()=>{let o=Object.values(nt||{});if(o.length===0)return;let _=(R,C,I,z=(se,ue)=>se??ue)=>{R(se=>{if(!se||!Object.prototype.
hasOwnProperty.call(se,C))return se;let ue={...se};return ue[I]=z(ue[I],ue[C]),delete ue[C],ue})};for(let R of o){let C=R?.
alias_session_id,I=R?.canonical_session_id;!C||!I||C===I||(_(Xa,C,I,(z,se)=>typeof z=="string"&&z.length>0?z:se||""),_(Ts,
C,I,(z,se)=>{let ue=[...Array.isArray(z)?z:[],...Array.isArray(se)?se:[]];return[...new Map(ue.map(qe=>[`${qe?.name||""}\
:${qe?.size||qe?.content?.length||0}`,qe])).values()]}),_(ma,C,I,(z,se)=>z||se),_(en,C,I,(z,se)=>({...se||{},...z||{}})),
ha===C&&Un(I),Fn(z=>z?.sessionId===C?{...z,sessionId:I}:z),Xn.current[C]&&(Xn.current[I]=[...Xn.current[I]||[],...Xn.current[C]],
delete Xn.current[C]),ws.current.sessionId===C&&(ws.current={...ws.current,sessionId:I}),m===C&&(ks.current={...ks.current,
sessionId:I},_r.current?.sessionId===C&&(_r.current={..._r.current,sessionId:I}),$c.current=I,hn.current=I,lt(I)))}},[nt,
m,ha]),Ee(()=>{let o=R=>{try{sessionStorage.setItem("agent-chat:last-window-error",JSON.stringify({message:R?.error?.message||
R?.message||"Unknown window error",stack:R?.error?.stack||"",at:new Date().toISOString()}))}catch{}},_=R=>{try{let C=R?.
reason;sessionStorage.setItem("agent-chat:last-promise-error",JSON.stringify({message:C?.message||oe(C,"Unhandled promis\
e rejection"),stack:C?.stack||"",at:new Date().toISOString()}))}catch{}};return window.addEventListener("error",o),window.
addEventListener("unhandledrejection",_),()=>{window.removeEventListener("error",o),window.removeEventListener("unhandle\
drejection",_)}},[]),Ee(()=>{try{let o=localStorage.getItem(gm);o&&Xa(JSON.parse(o))}catch{}},[]),Ee(()=>{try{localStorage.
setItem(gm,JSON.stringify(da))}catch{}},[da]),Ee(()=>{try{localStorage.setItem("remote-agent-chat-theme",ir)}catch{}document.
documentElement.setAttribute("data-theme",ir)},[ir]),Ee(()=>{if(!m&&r.length>0){let o=new URLSearchParams(window.location.
search).get("session"),_=nt?.[o]?.canonical_session_id||o,R=_?r.find(z=>Pe(z)===_):null,C=R||r[0],I=Pe(C);I&&(Qn(I,C),R&&
window.history.replaceState({},"",window.location.pathname))}},[r,m,nt]),Ee(()=>{if(!("serviceWorker"in navigator))return;
let o=_=>{if(_.data?.type!=="push_notification_clicked")return;let R=_.data.data?.session_id,C=nt?.[R]?.canonical_session_id||
R,I=r.find(z=>Pe(z)===C);C&&I&&Qn(C,I)};return navigator.serviceWorker.addEventListener("message",o),()=>navigator.serviceWorker.
removeEventListener("message",o)},[r,nt]),Ee(()=>{if(!d)return;let o=r.find(_=>(typeof _=="string"?_:_?.session_id)===d);
o&&(Qn(d,o),v(null))},[d,r]),Ee(()=>{let o=cn.current;if(!o)return;let _=null,R=()=>{mi.current=Date.now()+1200,hr.current=
0,lo.current+=1,ln.current&&(Lc.current=Ec.current,ar(0))},C=De=>{De.deltaY<-1&&R()},I=De=>{let xt=o.getBoundingClientRect();
De.clientX>=xt.right-16&&R()},z=De=>{_=De.touches?.[0]?.clientY??null},se=De=>{let xt=De.touches?.[0]?.clientY??null;_!=
null&&xt!=null&&xt-_>4&&R()},ue=De=>{["ArrowUp","PageUp","Home"].includes(De.key)&&R()},qe=()=>{let De=o.scrollHeight-o.
scrollTop-o.clientHeight<80,xt=Date.now(),mt=xt<mi.current,En=xt<hr.current;pi.current=De,De?ln.current=!0:mt&&!En&&(ln.
current=!1,uo.current=0),mt&&!En&&o.scrollTop<160&&Mc.current?.(),Wn(!De&&!ln.current),ks.current={...ks.current,scrollTop:o.
scrollTop,scrollHeight:o.scrollHeight,clientHeight:o.clientHeight,atBottom:De||ln.current}};return o.addEventListener("s\
croll",qe,{passive:!0}),o.addEventListener("wheel",C,{passive:!0}),o.addEventListener("touchstart",z,{passive:!0}),o.addEventListener(
"touchmove",se,{passive:!0}),o.addEventListener("pointerdown",I,{passive:!0}),window.addEventListener("keydown",ue),()=>{
o.removeEventListener("scroll",qe),o.removeEventListener("wheel",C),o.removeEventListener("touchstart",z),o.removeEventListener(
"touchmove",se),o.removeEventListener("pointerdown",I),window.removeEventListener("keydown",ue)}},[m]);function Ic(o,_=2){
let R=m,C=lo.current+1;lo.current=C;let I=()=>{let ue=cn.current;return!ue||$c.current!==R||lo.current!==C||fi.current()?
!1:(hr.current=Date.now()+800,ln.current=!0,Lc.current=Ec.current,gn(ue,ue.scrollHeight),pi.current=!0,Wn(!1),ar(0),ks.current=
{sessionId:R,keys:o,scrollTop:ue.scrollTop,scrollHeight:ue.scrollHeight,clientHeight:ue.clientHeight,atBottom:!0},!0)};I();
let z=Math.max(0,_),se=()=>{z<=0||(z-=1,I()&&requestAnimationFrame(se))};z>0&&requestAnimationFrame(se)}function kf(){if(!cn.
current)return;let _=bm(Ws);uo.current=Date.now()+5e3,Ic(_,4)}ra(()=>{let o=cn.current;if(!o)return;let _=bm(Ws),R=ks.current||
{},C=R.sessionId===m,I=Array.isArray(R.keys)?R.keys:[],z=I[0]||null,se=I[I.length-1]||null,ue=z?_.indexOf(z):-1,qe=se?_.
indexOf(se):-1,De=!!(C&&_.length===I.length&&_.every((Ln,Yt)=>Ln===I[Yt])),xt=(Number(R.scrollHeight)||0)-(Number(R.scrollTop)||
0)-(Number(R.clientHeight)||0),mt=Date.now()<uo.current,En=mt||ln.current||R.atBottom!==!1||xt<120,Cr=!!(C&&I.length&&ue>
0&&qe>=ue);if(!fi.current()){if(!(De&&!mt&&!En))if(!C)ro(null),Ic(_,3);else if(Cr){if(ln.current=!1,uo.current=0,o.dataset.
transcriptWindowed!=="true"){let Ln=o.scrollHeight-(Number(R.scrollHeight)||0);hr.current=Date.now()+500,gn(o,Math.max(0,
(Number(R.scrollTop)||0)+Ln));let Yt=Tc.current,Co=Yt?Array.from(o.querySelectorAll(".message[data-message-key]")).find(
Ci=>Ci.dataset.messageKey===Yt.messageKey):null;if(Co){let ld=Co.getBoundingClientRect().top-Yt.viewportTop;Math.abs(ld)>=
.5&&gn(o,Math.max(0,o.scrollTop+ld))}Tc.current=null}}else En&&Ic(_,3)}let Vt=o.scrollHeight-o.scrollTop-o.clientHeight<
80;pi.current=Vt,Wn(!Vt&&!ln.current),ar(Vt||ln.current?0:Ub(Lc.current,di)),ks.current={sessionId:m,keys:_,scrollTop:o.
scrollTop,scrollHeight:o.scrollHeight,clientHeight:o.clientHeight,atBottom:Vt||ln.current}},[m,Ws,_f]),Ee(()=>{m&&ee(m)},
[m]),Ee(()=>{to(o=>{let _=Object.keys(o).filter(C=>!b[C]);if(_.length===0)return o;let R={...o};return _.forEach(C=>delete R[C]),
R})},[b]),Ee(()=>{let o=Object.entries(Wt).filter(([,C])=>jn[C]),_=Object.entries(gs).filter(([,C])=>jn[C]);if(o.length>
0){let C=new Set(o.map(([I])=>I));to(I=>Object.fromEntries(Object.entries(I).filter(([z])=>!C.has(z))))}if(_.length>0){let C=new Set(
_.map(([I])=>I));Vo(I=>Object.fromEntries(Object.entries(I).filter(([z])=>!C.has(z))));for(let[I,z]of _){let se=sr.current.
get(z);if(!se)continue;let ue=jn[z];if(sr.current.delete(z),ue?.result==="ok")zs(I,qe=>String(qe||"").trim().toLowerCase()===
se.command?"":qe),Ps(qe=>({...qe,[I]:{status:"success",requestId:z,text:se.action==="pause"?"Goal paused":"Goal resumed"}})),
tt(se.action==="pause"?"Goal paused":"Goal resumed");else{let qe=ue?.error?.message||"Native goal control did not apply.";
Ps(De=>({...De,[I]:{status:"failed",requestId:z,text:`${qe} Command retained; press Send to retry.`}}))}}}let R=[...o,..._].
map(([,C])=>jn[C]).find(C=>C?.result==="failed");R&&tt(R.error?.message||(R.command==="agent_interrupt"?"Interrupt did n\
ot apply":"Goal control did not apply"))},[jn,Wt,gs]),Ee(()=>{!Pc.current&&i&&tt("Reconnected"),Pc.current&&!i&&tt("Disc\
onnected \u2014 reconnecting..."),Pc.current=i},[i]);function tt(o){cs(o),setTimeout(()=>cs(""),3e3)}function wf(o){let _=r.
find(R=>Pe(R)===o);return _?Do(_,o,Y[o],t[o]||[]):o}function Ru(o,_,R,C=""){Ge.current&&clearTimeout(Ge.current),Fn({sessionId:o,
kind:_,title:R,detail:C||wf(o)}),Ge.current=setTimeout(()=>{Ge.current=null,Fn(null)},8e3)}function Mu(){Ge.current&&clearTimeout(
Ge.current),Ge.current=null,Fn(null)}Ee(()=>()=>{Ge.current&&clearTimeout(Ge.current)},[]),Ee(()=>{let o=Je.current,_=g||
{},R=Object.keys(o).filter(C=>!_[C]);R.length>0&&(ma(C=>{let I={...C};return R.forEach(z=>{I[z]?.kind==="prompt"&&delete I[z]}),
I}),Fn(C=>C?.kind==="prompt"&&R.includes(C.sessionId)?null:C)),Object.entries(_).forEach(([C,I])=>{let z=I?.prompt_id||I?.
request_id||I?.id||"prompt",se=o[C],ue=se?.prompt_id||se?.request_id||se?.id||null;if(z===ue||(fa.current&&ls.completion_sound&&
Bm(C,m)&&jm("prompt"),C===m))return;let qe=I?.type==="question_prompt"||I?.kind==="question"?"Question needs an answer":
"Permission needs attention";ma(De=>({...De,[C]:{kind:"prompt",promptId:z}})),Ru(C,"prompt",qe)}),Je.current=_,fa.current=
!0},[g,m,ls.completion_sound]),Ee(()=>{!m||st?.sessionId!==m||(Ge.current&&clearTimeout(Ge.current),Ge.current=null,Fn(null))},
[m,st?.sessionId]),Ee(()=>{if(!Ko||!Jr)return;let o=!1;async function _(){for(let R of ua||[]){let C=R.session_id||R.session;
if(!op(R,ls)){qa(R,"suppressed",{reasonCode:"client_preference"});continue}if(We[C]?.muted){qa(R,"suppressed",{reasonCode:"\
session_muted"});continue}if(!Bm(C,m)){qa(R,"suppressed",{reasonCode:"focused_session"});continue}let I=await ip(R);if(o)
continue;if(!I){qa(R,"suppressed",{reasonCode:"client_duplicate"});continue}qa(R,"claimed");let z=R.event_type;ls.completion_sound&&
jm(z==="goal_attention"||z==="provider_usage_threshold"?"prompt":"completion"),C!==m&&ma(ue=>({...ue,[C]:{kind:z,dedupeKey:R.
dedupe_key,createdAt:R.created_at||new Date().toISOString()}})),Ru(C,z,R.title,R.body),(typeof requestAnimationFrame=="f\
unction"?requestAnimationFrame:ue=>setTimeout(ue,16))(()=>{o||qa(R,"displayed")})}}return _().catch(()=>{}),()=>{o=!0}},
[ua,m,We,ls,Ko,Jr]);function zs(o,_){o&&Xa(R=>({...R,[o]:typeof _=="function"?_(R[o]||""):_}))}function Oc(o,_){o&&Ts(R=>{
let C={...R};if(_===null)return delete C[o],C;let I=C[o]||[];return Array.isArray(_)?C[o]=_:C[o]=[...I,_],C})}function Sf(o,_){
o&&Ts(R=>{let C={...R},I=[...C[o]||[]];return I.splice(_,1),I.length===0?delete C[o]:C[o]=I,C})}async function Dc(o,_,R,C){
let I=await fetch("/upload",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({filename:C,content:_,
mimeType:R})});if(!I.ok)throw new Error("Upload failed");let{url:z}=await I.json();return Oc(o,{name:C,url:z,isText:!1,mimeType:R}),
z}function Tu(o,_,R,C){let I=Ae(o,_,R,C);return qc.current[I]={sessionId:o,filename:C,mimeType:R,base64:_,createdAt:Date.
now()},tt(`Sending image to Codex: ${C}`),I}Ee(()=>{let o=Object.entries(jn||{});for(let[_,R]of o){if(!_.startsWith("att\
ach-")||Au.current[_])continue;Au.current[_]=!0;let C=qc.current[_];if(delete qc.current[_],!!C){if(R?.result==="ok"){tt(
`Image attached to Codex: ${C.filename}`);continue}(async()=>{try{await Dc(C.sessionId,C.base64,C.mimeType,C.filename),tt(
`Direct image attach failed \u2014 added ${C.filename} as a file link draft`)}catch{let I=R?.error?.message||R?.error?.code||
"unknown error";tt(`Image attach failed: ${I}`)}})()}}},[jn]);function br(o){let _=o?.agent_type;return{limit:mb(_),..._===
"codex_cli"||_==="cursor_cli"?{chunkBytes:ub}:{}}}function oy(o){let _=r.find(R=>Pe(R)===o);return br(_)}function Qn(o,_){
let R=hn.current===o;On(o),lt(o),hn.current=o,ws.current={sessionId:o,index:(Xn.current[o]||[]).length,scratch:""},f(C=>({
...C,[o]:0})),ma(C=>{if(!C[o])return C;let I={...C};return delete I[o],I}),st?.sessionId===o&&Mu(),ot(!1),Tt(!1),dt(!1),
sn(!1),Vn(!1),R&&setTimeout(()=>zr(o,br(_)),0)}function Nf(o){let _=o?.session_id,R=Number(o?.message_id);if(!_||!Number.
isSafeInteger(R)||R<=0)return;let C=r.find(I=>Pe(I)===_)||{session_id:_,workspace_path:o.workspace_path||null,project_root:o.
project_root||null,workspace_name:o.workspace_name||null,agent_type:o.agent_type||null,status:"history"};Ve.cancelRouteRestore(),
_r.current=null,or({sessionId:_,messageId:R}),Qn(_,C),Vn(!1)}async function Cf(o){let _=Array.from(o.target.files||[]);if(_.
length!==0){o.target.value="";for(let R of _){if(R.size>2*1024*1024){tt(`${R.name}: too large (max 2 MB)`);continue}if(pd(
R.name)&&R.size<500*1024)await new Promise((C,I)=>{let z=new FileReader;z.onload=se=>{Oc(m,{name:R.name,content:se.target.
result,isText:!0}),C()},z.onerror=()=>{tt(`Failed to read ${R.name}`),C()},z.readAsText(R)});else{Es(!0);try{await new Promise(
(C,I)=>{let z=new FileReader;z.onload=async se=>{let ue=se.target.result.split(",")[1];(B?.capabilities||{}).send_attachment&&
R.type.startsWith("image/")?Tu(m,ue,R.type,R.name):(await Dc(m,ue,R.type,R.name),tt(`Uploaded: ${R.name}`)),C()},z.onerror=
()=>{tt(`Failed to read ${R.name}`),C()},z.readAsDataURL(R)})}catch{tt(`Upload failed: ${R.name}`)}finally{Es(!1)}}}}}async function xf(o){
let R=Array.from(o.clipboardData?.items||[]).find(se=>se.type.startsWith("image/"));if(!R||(o.preventDefault(),!m))return;
let C=R.getAsFile();if(!C)return;if(C.size>2*1024*1024){tt("Image too large (max 2 MB)");return}let I=C.type==="image/jp\
eg"?"jpg":"png",z=`screenshot-${Date.now()}.${I}`;Es(!0);try{await new Promise(se=>{let ue=new FileReader;ue.onload=async qe=>{
let De=qe.target.result.split(",")[1];(B?.capabilities||{}).send_attachment?Tu(m,De,C.type,z):(await Dc(m,De,C.type,z),tt(
"Screenshot attached")),se()},ue.onerror=()=>{tt("Failed to read clipboard image"),se()},ue.readAsDataURL(C)})}catch{tt(
"Paste upload failed")}finally{Es(!1)}}function $u(){if(Ra)return;let o=m&&da[m]||"",_=m?pa[m]||[]:[],R=o.trim();if(!R&&
_.length===0||!m)return;let C=Jp(o,{attachmentCount:_.length});if(C.kind!=="chat"){Rf(C);return}let I="";if(_.length>0?(I=
_.map(se=>{if(se.isText){let ue=xr(se.name);return`\`${se.name}\`
\`\`\`${ue}
${se.content}
\`\`\``}return(se.mimeType||"").startsWith("image/")?`![${se.name}](${se.url})`:`[File: ${se.name}](${se.url})`}).join(`\


`),R&&(I+=`

${R}`)):I=R,ce(m,I),R){let z=Xn.current[m]||[],se=z[z.length-1]===R?z:[...z,R].slice(-100);Xn.current[m]=se,ws.current={
sessionId:m,index:se.length,scratch:""}}_s(z=>({...z,[m]:!1})),Lt(z=>({...z,[m]:Math.min(z[m]||0,(t[m]||[]).length)})),zs(
m,""),Oc(m,null),Tt(!1),un.current?.focus()}function jc(){kt.current&&clearTimeout(kt.current),kt.current=null,et.current=
{sessionId:null,expiresAt:0},tn(null)}function Af(){if(!m)return;let o=Date.now()+2500;et.current={sessionId:m,expiresAt:o},
tn(m),kt.current&&clearTimeout(kt.current),kt.current=setTimeout(()=>{et.current.sessionId===m&&et.current.expiresAt===o&&
(et.current={sessionId:null,expiresAt:0},kt.current=null,tn(null))},2500)}function Bc(){if(!m||!b[m]||Wt[m]){jc();return}
jc(),Fc(m,D)}function Fc(o,_){if(!o||Wt[o])return null;let R=T(o,{sessionGeneration:_?.control_generation,turnGeneration:_?.
turn_generation});return to(C=>({...C,[o]:R})),R}function Hc(o,_,R,C,I={}){if(!o||!R||gs[o])return null;let z=U(o,_,R,{sessionGeneration:C?.
control_generation,requestId:I.requestId});return Vo(se=>({...se,[o]:z})),z}function Rf(o){if(!m)return;let _=ue=>{Ps(qe=>({
...qe,[m]:{status:"failed",requestId:null,text:ue}})),tt(ue),Tt(!1)};if(o.kind==="unsupported_goal_control"){_("Unsuppor\
ted goal command. Use /goal resume or /goal pause.");return}if(!i){_("Goal control is offline. Command retained; reconne\
ct and press Send to retry.");return}if(gs[m]){_("A goal control is already applying. Command retained.");return}let R=D?.
agent_type;if(!["codex","codex-desktop","codex_cli"].includes(R)||B?.capabilities?.goal_pause_resume!==!0||!Ys?.fingerprint||
Number(D?.control_generation)<=0){_("This session has no verified native goal control. Command retained.");return}let C=Zp(
o.action,Xs);if(C){zs(m,""),Ps(ue=>({...ue,[m]:{status:"success",requestId:null,text:C}})),tt(C),Tt(!1);return}if(o.action===
"resume"&&Xs==="blocked"&&B?.capabilities?.goal_blocked_resume!==!0){_("Blocked-goal resume is not verified for this ses\
sion. Command retained.");return}if(!(o.action==="pause"?Xs==="active":["paused","blocked"].includes(Xs))){_(`Goal state\
 is ${Xs||"unknown"}; refresh before retrying this command.`);return}let z=`goal-slash-${o.action}-${Date.now()}-${Math.
random().toString(36).slice(2,8)}`;if(sr.current.set(z,{action:o.action,command:o.command}),Ps(ue=>({...ue,[m]:{status:"\
applying",requestId:z,text:"Validating goal, then applying native control\u2026"}})),!Hc(m,o.action,Ys,D,{requestId:z})){
sr.current.delete(z),_("Goal control could not be queued. Command retained; press Send to retry.");return}Tt(!1)}Ee(()=>()=>{
kt.current&&clearTimeout(kt.current)},[]),Ee(()=>{_a&&(_a!==m||!b[_a])&&jc()},[m,b,_a]);function Mf(o){if((o.metaKey||o.
ctrlKey)&&o.key.toLowerCase()==="k"){o.preventDefault(),un.current?.focus();return}if(o.key==="Escape"){if(Zt){Tt(!1);return}
if(Ra)return;gi&&!vr&&(o.preventDefault(),et.current.sessionId===m&&et.current.expiresAt>=Date.now()?Bc():Af());return}if(o.
key==="Enter"&&!o.shiftKey&&et.current.sessionId===m&&et.current.expiresAt>=Date.now()){o.preventDefault(),Bc();return}let _=m?
Xn.current[m]||[]:[],R=ws.current,C=R.sessionId===m&&R.index>=0&&R.index<_.length;if(o.key==="ArrowUp"&&_.length>0&&(Jn===
""||C)){o.preventDefault();let I=R.sessionId===m?R:{sessionId:m,index:_.length,scratch:Jn};I.index=Math.max(0,I.index-1),
ws.current=I,zs(m,_[I.index]);return}if(o.key==="ArrowDown"&&C){o.preventDefault();let I=Math.min(_.length,R.index+1);ws.
current={...R,index:I},zs(m,I===_.length?R.scratch:_[I]);return}if(o.key==="Tab"&&Zt&&bi.length>0){o.preventDefault(),cd(
bi[0].command);return}o.key==="Enter"&&!o.shiftKey&&(o.preventDefault(),$u())}let gi=m?!!b[m]:!1,vr=m?!!Wt[m]:!1,Jn=m&&da[m]||
"",Uc=m?pa[m]||[]:[],mo=React.useCallback(()=>{let o=un.current;if(!o)return;let _=Math.max(42,Math.floor(window.innerHeight*
.4));o.style.height="auto";let R=Math.max(42,Math.min(o.scrollHeight,_));o.style.height=`${R}px`,o.style.overflowY=o.scrollHeight>
_?"auto":"hidden"},[]);ra(()=>{mo()},[m,Jn,mo]),Ee(()=>(window.addEventListener("resize",mo),()=>window.removeEventListener(
"resize",mo)),[mo]);let Aa=Ws,Eu=m&&Sn[m]&&qs[m]||0,Ye=React.useMemo(()=>{let o=Math.min(Eu,Aa.length);return o<=0?Aa:o>=
Aa.length?_m:Aa.slice(o)},[Aa,Eu]),Zn=React.useMemo(()=>Ye.filter(o=>vb(o)),[Ye]),Gc=!Os&&!Ds&&!js&&!vs&&!Bs&&!Fs,Ve=nv(
{messages:Zn,containerRef:cn,sessionId:m,routeActive:Gc,suppressProgrammaticScrollRef:fi}),Ks=React.useCallback(()=>{let o=cn.
current;if(!o)return;let _=o.scrollHeight-o.scrollTop-o.clientHeight<80;_r.current={sessionId:m,scrollTop:o.scrollTop,scrollHeight:o.
scrollHeight,clientHeight:o.clientHeight,atBottom:_},Ve.prepareForRouteChange()},[m,Ve.prepareForRouteChange]);ra(()=>{if(!Gc||
Ve.enabled)return;let o=_r.current;if(!cn.current||o?.sessionId!==m)return;let R=()=>{let C=cn.current;if(!C||o.sessionId!==
m)return;let I=o.atBottom?C.scrollHeight:Math.min(o.scrollTop,Math.max(0,C.scrollHeight-C.clientHeight));hr.current=Date.
now()+800,gn(C,I)};return R(),po.current=requestAnimationFrame(()=>{po.current=0,R()}),()=>{po.current&&cancelAnimationFrame(
po.current),po.current=0}},[m,Gc,Ve.enabled]),Ee(()=>{if(of)return window.__RAC_TRANSCRIPT_WINDOW__={total:Zn.length,scrollToIndex:Ve.
scrollToIndex},()=>{window.__RAC_TRANSCRIPT_WINDOW__?.scrollToIndex===Ve.scrollToIndex&&delete window.__RAC_TRANSCRIPT_WINDOW__}},
[Zn.length,Ve.scrollToIndex]);let Tn=m&&g[m]||null,fo=m&&w[m]||null,go=jr(fo)?fo:null,Lu=fo&&!jr(fo)?fo:null,Ra=Tn||go,ho=React.
useMemo(()=>hb(m,Tn),[m,Tn]),iy=Tn?Tn.type==="question_prompt"?"Question required":"Permission required":go?oe(go.title,
"Action required"):null;ra(()=>{let o=cn.current;if(!o)return;let _=Date.now(),R=vf.current;if(!ho){R.activeSemanticKey&&
(R.lastClearedSemanticKey=R.activeSemanticKey,R.clearedAt=_,R.activeSemanticKey="");return}let C=R.activeSemanticKey===ho||
R.lastClearedSemanticKey===ho&&_-R.clearedAt<=5e3;R.activeSemanticKey=ho,!(C||(lo.current+=1,uo.current=0,ln.current=!1,
document.activeElement===un.current||_<mi.current))&&(hr.current=_+800,gn(o,0),pi.current=o.scrollHeight-o.clientHeight<
80,Wn(!1),ar(0),ks.current={...ks.current,sessionId:m,scrollTop:0,scrollHeight:o.scrollHeight,clientHeight:o.clientHeight,
atBottom:!1})},[ho,m,Zn.length]);let Ma=m&&Y[m]?.capabilities?.write_capability_gate||null,Tf=!!(Jn.trim()||Uc.length>0)&&
!!m&&!$s&&!Ra&&!Ma,Pu=i?c?.state||"connecting":"offline",$f=c?.rttMs!=null?` \xB7 ${c.rttMs} ms`:"",qu=Object.entries(u).
reduce((o,[_,R])=>Rn.has(_)?o:o+Number(R||0),0),hi=Object.keys(Qr).filter(o=>o!==m&&!Rn.has(o)).length,Iu=bn?.completed_at?
Date.now()-Date.parse(bn.completed_at):Number.POSITIVE_INFINITY,dn=Iu>=0&&Iu<=1440*60*1e3?bn:null,yr=dn?Go.filter(o=>o.run_id!==
dn.run_id):Go,Ef=Object.fromEntries((Kr?.coverage_matrix||[]).map(o=>[o.harness,o])),Ou=Object.entries(Kr?.harnesses||{}).
sort(([o],[_])=>o.localeCompare(_)),wt=jt?.latest||null,Lf=wt?.completed_at?Date.now()-Date.parse(wt.completed_at):Number.
POSITIVE_INFINITY,_i=!jt||!wt||Lf>2700*1e3?"STALE":String(jt.status||wt.status||"STALE").toUpperCase(),_o=Array.isArray(
jt?.open_fingerprints)?jt.open_fingerprints:[],bo=_i!=="PASS"||_o.length>0,vo=_n.length>0||yr.length>0||!!dn||!!Ma||bo,Pf=Jn.
startsWith("/")?Jn.slice(1).trim().toLowerCase():"",bi=Jn.startsWith("/")?db.filter(o=>o.command.slice(1).includes(Pf)):
[];ra(()=>{let o=Zo.current;if(!vo||!o){ei(0);return}let _=()=>ei(Math.ceil(o.getBoundingClientRect().height));if(_(),typeof ResizeObserver>
"u")return;let R=new ResizeObserver(_);return R.observe(o),()=>R.disconnect()},[vo,_n.length,yr.length,dn?.run_id,Ma]);let B=m&&
Y[m]||null,Du=m?Object.values(re||{}).filter(o=>o.sessionId===m):[],ju=Du.find(o=>o.status==="pending"||o.status==="awai\
ting_config")||null,vi=Du.find(o=>o.status==="failed")||null,pn=m&&s[m]||null,Vs=m&&a[m]||null;Ee(()=>{if(!m||!i||at?.sessionId===
m)return;let _=(t[m]||[]).reduce((I,z)=>Math.max(I,Number(z?.sequence||0)),0);if(_>0){zr(m,{afterSequence:_});return}let R=br(
D),C=D?.agent_type==="codex_cli"||D?.agent_type==="cursor_cli"?"native":"relay_sqlite";ca(m,{...R,mode:"tail",source:C})},
[m,i,D?.agent_type,at?.sessionId]),Ee(()=>{if(!i||!at||m!==at.sessionId||(t[m]||[]).some(C=>String(C?.id)===String(at.messageId)))
return;let _=()=>ca(m,{mode:"around",source:"relay_sqlite",aroundId:at.messageId,limit:200,replace:!0,userInitiated:!0});
_();let R=setTimeout(_,600);return()=>clearTimeout(R)},[i,m,at?.sessionId,at?.messageId,t[m]]),Ee(()=>{if(!at||m!==at.sessionId)
return;let o=`[data-message-id="${at.messageId}"]`,_=Zn.findIndex(z=>String(z?.id)===String(at.messageId));_>=0&&Ve.scrollToIndex(
_,"center");let R=0,C=null,I=setInterval(()=>{R++;let z=cn.current?.querySelector(o);z?(clearInterval(I),z.scrollIntoView(
{block:"center",behavior:"instant"}),C=setTimeout(()=>{or(se=>se?.sessionId===m&&String(se?.messageId)===String(at.messageId)?
null:se)},5e3)):R>=40&&(clearInterval(I),or(null),tt("Matched message could not be loaded"))},100);return()=>{clearInterval(
I),C&&clearTimeout(C)}},[m,at?.sessionId,at?.messageId,t[m],Zn,Ve.scrollToIndex]),Ee(()=>{Dn(m?[m]:[])},[m,Dn]),Ee(()=>{
if(!m||!i||!Cu)return;let o=br(D);ca(m,{...o,mode:"tail",source:"native"})},[m,i,Cu]);let Ke=D?.agent_type==="antigravit\
y-v2",yo=m?J[m]||[]:[],kr=m?kc[m]:null,Bu=React.useMemo(()=>Ke&&kr?.id?yo.map(o=>!o?.kind||o.kind==="chat"?{...o,active:o.
id===kr.id}:o):yo,[yo,Ke,kr?.id]),Wc=!!(m&&Object.prototype.hasOwnProperty.call(J,m)),Fu=Bu.filter(o=>!o?.kind||o.kind===
"chat").length,qf=!!(m&&Ke&&!on),zc=D?.agent_type==="antigravity"||D?.agent_type==="antigravity_panel"||D?.agent_type===
"antigravity-v2",$n=D?Db(r,D):null,Hu=D?.agent_type==="codex"&&D?.visible_pane_visible?{pane_agent:D.visible_pane_agent||
null,summary:xm(D),sourceSession:D}:null,If=$n?{pane_agent:$n.panel_agent||null,summary:xm($n),sourceSession:$n}:null,yi=Hu||
If,Of=yi?.summary||"",Df=yi?.pane_agent||null,Uu=Of||Yl(Df)||Br(yi?.sourceSession,Pe(yi?.sourceSession)),Gu=Uu,Kc=!!(D&&
D.agent_type==="codex"&&D.visible_pane_visible&&D.visible_pane_agent==="codex"),jf=!!(D&&D.agent_type==="codex"&&D.visible_pane_visible&&
D.visible_pane_agent&&D.visible_pane_agent!=="codex"),rt=Fr(D||m,B),Vc=m?ur[m]:"",Ss=D&&typeof D=="object"?D.workspace_path:
"",Wu=Ss?Ss.split(/[\\/]/).filter(Boolean).pop()||Ss:"",Bf=Wu||(Vc&&Vc!=="Unscoped"?Vc:"")||oe(D?.workspace_name)||"Unsc\
oped",zu=Te(new Map),Yc=React.useMemo(()=>Ke&&kr?.title?{...D||{},native_chat_title:kr.title}:D,[D,Ke,kr?.title]),Xc=React.
useMemo(()=>{if(!m)return{title:"Agent Chat",source:"fallback",field:"no_session"};let o=ul(Yc,Yc?.custom_display_name||
"",Ws),_=Id(zu.current.get(m),o);return zu.current.set(m,_),_},[m,Yc,Ws]),Qc=Xc.title,ki=m?pc[m]:null,Ff=!!(rt?.name==="\
Codex"&&D&&D.agent_type==="codex"&&(jf&&$n||!Hu&&$n&&($n.panel_agent==="antigravity_panel"||Gu))),Ku=!!B?.capabilities?.
new_thread,Hf=D?.agent_type==="codex-desktop",Uf=D?.agent_type==="cursor",Vu=Hf||Uf,Jc=Vu?"New chat":"New thread",Yu=D&&
typeof D=="object"?D.machine_label:"",Xu=ef(D),Qu=React.useMemo(()=>{for(let o=Ye.length-1;o>=0;o--)if(Ye[o]?.role==="us\
er")return Ye[o];return null},[Ye]),Zc=Qu?Ot(Qu.content).replace(/\s+/g," ").trim():"",Ta=m?A[m]||D?.status||"unknown":"",
Ju=React.useCallback(o=>{let _=oe(o).replace(/\s+\((?:Lines?|Line)\s+\d+(?:-\d+)?\)\s*$/i,"").replace(/^["'`]+|["'`]+$/g,
"").trim();if(!_)return"";let R=_.replace(/\\/g,"/"),C=oe(Ss).replace(/\\/g,"/").replace(/\/+$/,"");if(/^[A-Za-z]:\//.test(
R)||R.startsWith("//")){if(!C)return"";let I=R.toLowerCase(),z=C.toLowerCase();return I===z?".":I.startsWith(z+"/")?R.slice(
C.length+1):""}return R.replace(/^\.\/+/,"").replace(/^\/+/,"")},[Ss]),el=React.useCallback((o,_)=>{if(!m)return;let R=Ju(
_);if(!R){tt("File is outside the current workspace");return}ro(C=>C&&C.sessionId===m&&C.messageKey===o&&C.path===R?null:
{sessionId:m,messageKey:o,path:R}),io.current(m,R)},[m,Ju]),Zu=React.useCallback(()=>ro(null),[]),Oe=m?N[m]!==void 0?N[m]:
D&&typeof D=="object"?D.activity:null:null,Ys=Oe?.goal||null,Xs=String(Ys?.state||Ys?.status||"").toLowerCase(),wr=Xs===
"blocked",Gf=wr&&B?.capabilities?.goal_blocked_resume===!0,ko=Xs==="active"?"pause":Xs==="paused"||Gf?"resume":null,Wf=wr?
oe(Ys?.block_reason||Ys?.reason||Oe?.label||"Goal blocked").trim():"",wo=!!(ko&&Ys?.fingerprint&&B?.capabilities?.goal_pause_resume===
!0&&Number(D?.control_generation)>0),ed=!!(gi&&B?.capabilities?.interrupt===!0&&Number(D?.control_generation)>0&&Number(
D?.turn_generation)>0),tl=Oe?.context_card||null,zf=!!(m&&Zc&&!((D?.agent_type==="cline"||D?.agent_type==="roo_code")&&tl)),
So=["claude_cli","codex_cli","cursor_cli"].includes(D?.agent_type),td=React.useMemo(()=>{for(let o=Ye.length-1;o>=0;o--)
if(Ye[o]?.role==="assistant")return Ye[o];return null},[Ye]),Sr=m?(k[m]||"").trim():"",nd=td?Ot(td.content).trim():"",Kf=!!(Oe&&
!Oe?.thinking&&!Oe?.current&&!Oe?.task_list&&Vl(Sr)),sd=!!(m&&!Ct&&Oe&&(Oe.kind==="thinking"||Oe.kind==="generating")&&!Oe?.
thinking&&!Oe?.current&&!Kf&&Vl(Sr)&&(D?.agent_type==="codex"||D?.agent_type==="codex-desktop"||D?.agent_type==="cursor"||
D?.agent_type==="antigravity_panel")&&Sr!==nd&&!nd.includes(Sr)),ad=!!(Oe&&(Oe?.goal||Oe?.thinking||Oe?.current||Oe?.step||
Oe?.usage||Oe?.task_list||Oe.kind!=="idle"||Vl(Sr||Oe.thinkingContent||""))),wi=!!(m&&pn?.partial&&Number(pn.total||0)>Number(
pn.loaded||Ye.length||0)),rd=Number(pn?.loaded||Ye.length||0),Vf=Number(pn?.total||rd||0);function od(){if(!m)return;if(!Ve.
prepareForPrepend()){let _=cn.current,R=_?.getBoundingClientRect(),C=R?.top||0,I=_?Array.from(_.querySelectorAll(".messa\
ge[data-message-key]")):[],z=I.find(se=>{let ue=se.getBoundingClientRect();return ue.top>=C&&ue.top<R.bottom})||I.find(se=>se.
getBoundingClientRect().bottom>C)||I[0]||null;Tc.current=z?{messageKey:z.dataset.messageKey,viewportTop:z.getBoundingClientRect().
top}:null}let o=D?.agent_type==="codex_cli"||D?.agent_type==="cursor_cli"?"native":"relay_sqlite";ca(m,{mode:pn?.cursor?
"older":"tail",source:o,userInitiated:!0,beforeOffset:pn?.cursor?.next_before_offset,beforeId:pn?.cursor?.next_before_id,
...br(D)})}Ee(()=>(Mc.current=wi&&!Vs?od:null,()=>{Mc.current=null}),[m,D?.agent_type,Vs,wi,pn?.cursor?.next_before_offset,
pn?.cursor?.next_before_id]);function Yf(){if(!m)return;let o=D?.agent_type==="codex_cli"||D?.agent_type==="cursor_cli"?
"native":"relay_sqlite";ca(m,{...br(D),mode:"tail",source:o,userInitiated:!0})}let Xf=!!(m&&(Ye.length>0||sd||Ct)),Qf=nu(
rt),Jf=React.useMemo(()=>Zn.slice(Ve.start,Ve.end).map((o,_)=>{let R=Ve.start+_,C=lu(o,R),I=at?.sessionId===m&&String(o?.
id)===String(at?.messageId),z=Ve.enabled||I||R>=Math.max(0,Zn.length-48),se=wa?.sessionId===m&&wa?.messageKey===C?wa:null,
ue=React.createElement(Zb,{key:C,msg:o,messageKey:C,activeAgent:rt,assistantMonospace:So,autoExpandLongCodeBlocks:zc,onOpenPath:el,
agentType:D?.agent_type,preview:se,fileContents:Va,onClosePreview:Zu,deliveryState:o._cid?S[o._cid]:null,onSteer:ai,onRetry:cr,
richContentEager:z,searchMatch:I});return Ve.enabled?React.createElement(tv,{key:C,index:R,messageKey:`${m||""}${C}`,onMeasure:Ve.
onMeasure},ue):ue}),[Zn,Ve.start,Ve.end,Ve.enabled,Ve.onMeasure,m,at?.sessionId,at?.messageId,Qf,So,zc,el,D?.agent_type,
wa,Va,Zu,S,ai,cr]),Nr=B?.capabilities?.thread_list,No=!!D?.is_new_chat_draft,Zf=!!(m&&(D?.agent_type==="codex-desktop"||
D?.agent_type==="cursor")&&Nr&&(te[m]?.length>0||Sn[m]||No)&&!on),eg=React.useMemo(()=>{let o=[...te[m]||[]];if(o.length===
0)return o;let _=an[m],R=_?o.findIndex(I=>I.id===_):-1,C=R>=0?R:o.findIndex(I=>I.active);if(C>0){let[I]=o.splice(C,1);o.
unshift(I)}return o},[m,te,an]),tg=React.useMemo(()=>{let o=an[m],_=(te[m]||[]).find(I=>I?.active),R=_?.cache_key||_?.id,
C=Sn[m]||No?"draft":"";return`${m||"none"}:${C||o||R||"default"}`},[m,te,an,Sn,No]),id=Ye.length===0;React.useEffect(()=>{
m&&Nr&&id&&q(m)},[m,Nr,id]),React.useEffect(()=>{if(!(m&&Ke&&i))return;Q(m);let o=[600,1800,4200].map(I=>setTimeout(()=>{
typeof document<"u"&&document.hidden||Q(m)},I)),_=()=>{typeof document<"u"&&document.hidden||Q(m)},R=setInterval(_,3e4),
C=()=>_();return typeof document<"u"&&document.addEventListener("visibilitychange",C),()=>{o.forEach(I=>clearTimeout(I)),
clearInterval(R),typeof document<"u"&&document.removeEventListener("visibilitychange",C)}},[m,Ke,i]),React.useEffect(()=>{
m&&Ke&&(Et(!0),dt(!1))},[m,Ke]),React.useEffect(()=>{if(!(m&&Ke))return;let o=yo.find(_=>(!_?.kind||_.kind==="chat")&&_.
active);o&&va(_=>{let R=_[m];if(!R||R.id!==o.id&&Date.now()-(R.at||0)<15e3)return _;let C={..._};return delete C[m],C})},
[m,Ke,yo]),React.useEffect(()=>{if(!(m&&Nr&&(Vu||Kt)))return;q(m);let o=setInterval(()=>q(m),Kt?3e3:5e3);return()=>clearInterval(
o)},[m,D?.agent_type,Nr,Kt]),React.useEffect(()=>{if(!m)return;let o=qs[m]||0,_=Aa.length;o>_&&Lt(R=>({...R,[m]:_}))},[m,
qs,Aa.length]),React.useEffect(()=>{!m||Ye.length===0||_s(o=>o[m]?{...o,[m]:!1}:o)},[m,Ye.length]),React.useEffect(()=>{
if(!m)return;let o=te[m]||[],_=an[m];_&&o.some(R=>R.id===_&&R.active)&&no(R=>{let C={...R};return delete C[m],C})},[m,te,
an]);function Si(o=m){o&&(_s(_=>({..._,[o]:!0})),no(_=>{let R={..._};return delete R[o],R}),Lt(_=>({..._,[o]:(t[o]||[]).
length})),sn(!1),ve(o))}function nl(o,_){o&&_&&(_s(R=>({...R,[o]:!1})),no(R=>({...R,[o]:_})),Lt(R=>({...R,[o]:0})),G(o,_))}
function $a(o=m){o&&(Et(!0),dt(!1),va(_=>({..._,[o]:{id:"__agv2:new_conversation",title:"New Conversation",kind:"nav",at:Date.
now()}})),pe(o))}function sl(o,_=m){if(!(_&&o))return;Et(!0),dt(!1);let R=(J[_]||[]).find(I=>I?.id===o),C=o==="__agv2:ne\
w_conversation"?"New Conversation":o==="__agv2:conversation_history"?"Conversation History":o==="__agv2:scheduled_tasks"?
"Scheduled Tasks":"Antigravity v2";if(va(I=>({...I,[_]:{id:o,title:R?.title||C,kind:R?.kind||"chat",at:Date.now()}})),o===
"__agv2:new_conversation"){$a(_);return}de(_,o)}function ng(o){m&&(ws.current={sessionId:m,index:(Xn.current[m]||[]).length,
scratch:o},zs(m,o),Tt(o.startsWith("/")))}function cd(o){if(!m)return;let R={"/plan":`${o} Outline the implementation ap\
proach and major steps.`,"/review":`${o} Review the current changes for bugs, regressions, and missing tests.`,"/fix":`${o}\
 Implement or repair the current issue.`,"/summarize":`${o} Summarize the current state and important changes.`}[o]||`${o}\
 `;zs(m,R),Tt(!1),requestAnimationFrame(()=>un.current?.focus())}function sg(o,_=!1,R=""){let C=Pe(o),I=cf.has(C)?Pr(o):
null,z=Gs.current.get(C);return z||(z=document.createElement("div"),z.className="sidebar-card-host",z.setAttribute("data\
-sidebar-card-host",C),Gs.current.set(C,z)),ReactDOM.createPortal(React.createElement(ov,{session:o,health:A[C],unread:Rn.
has(C)?0:u[C]||0,isThinking:!!b[C]||!!Oi(N[C],{health:A[C]}),isActive:C===m,agentConfig:Y[C]||null,activity:N[C]||null,sessionMessages:t[C]||
[],hasBlockingPrompt:!!g[C]||!!jr(w[C]),blockingPromptLabel:g[C]?g[C].type==="question_prompt"?"Question required":"Perm\
ission required":w[C]?.title||"Action required",muted:!!We[C]?.muted,pinned:_,workspaceLabel:R,recentMessageAt:I?.at||null,
menuOpen:vc===C,onMenuToggle:se=>yc(ue=>se?C:ue===C?"":ue),onPinChange:se=>ti(C,{pinned:se}).catch(ue=>{tt(ue?.message||
`Unable to ${se?"pin":"unpin"} chat`)}),onSelect:()=>Qn(C,o),onManage:()=>{Un(C),Ze(!0),$t(!1),ht(!1)},onClose:()=>{let se=A[C]===
"disconnected"||!A[C],ue=se?"Remove session from the list?":`Close session "${C}"?`;window.confirm(ue)&&Dt(C,se)},onAutomations:o?.
agent_type==="codex-desktop"?()=>{Os||Ks(),Kn(se=>!se),Nn(!1),rn(!1),Cn(!1),xn(!1),ot(!1)}:void 0,showAutomationsActive:Os,
onSkills:o?.agent_type==="codex-desktop"?()=>{Ds||Ks(),Nn(se=>!se),Kn(!1),rn(!1),Cn(!1),xn(!1),ot(!1),za[C]||Ka(C)}:void 0,
showSkillsActive:Ds}),z,C)}function Ni(o,_=!0){let R=Pe(o);return React.createElement("div",{key:R,className:`sidebar-ca\
rd-slot${_?"":" sidebar-card-slot-filtered"}`,"data-sidebar-card-slot":R,"aria-hidden":_?void 0:"true",inert:_?void 0:""})}
return React.createElement("div",{className:`app${vo?" has-system-banner":""}`,style:vo?{"--system-banner-height":`${wc}\
px`}:void 0},ps&&React.createElement("div",{className:"quick-switcher-overlay",onMouseDown:o=>{o.target===o.currentTarget&&
(ke(!1),tr(""),Gn(0),requestAnimationFrame(()=>un.current?.focus()))}},React.createElement("div",{className:"quick-switc\
her",role:"dialog","aria-modal":"true","aria-label":"Switch session"},React.createElement("div",{className:"quick-switch\
er-input-wrap"},React.createElement("span",{"aria-hidden":"true"},"\u2315"),React.createElement("input",{ref:oo,className:"\
quick-switcher-input",value:eo,onChange:o=>{tr(o.target.value),Gn(0)},placeholder:"Search sessions, projects, or harness\
es","aria-label":"Search sessions","aria-controls":"quick-switcher-results","aria-activedescendant":qt.length?`quick-swi\
tcher-option-${ms}`:void 0,autoComplete:"off",spellCheck:"false"}),React.createElement("kbd",null,"Esc")),React.createElement(
"div",{className:"quick-switcher-results",id:"quick-switcher-results",role:"listbox"},qt.length===0?React.createElement(
"div",{className:"quick-switcher-empty"},"No matching sessions"):qt.map((o,_)=>React.createElement("button",{type:"butto\
n",role:"option",id:`quick-switcher-option-${_}`,"aria-selected":_===ms,className:`quick-switcher-option${_===ms?" selec\
ted":""}${o.id===m?" active":""}`,key:o.id,onMouseEnter:()=>Gn(_),onClick:()=>{Qn(o.id,o.session),ot(!1),ke(!1),tr(""),Gn(
0),requestAnimationFrame(()=>un.current?.focus())}},React.createElement("span",{className:"quick-switcher-dot",style:{background:o.
agentColor}}),React.createElement("span",{className:"quick-switcher-copy"},React.createElement("span",{className:"quick-\
switcher-title"},o.title),React.createElement("span",{className:"quick-switcher-meta"},o.groupLabel," \xB7 ",o.agentName,
o.subtitle?` \xB7 ${o.subtitle}`:"")),o.id===m&&React.createElement("span",{className:"quick-switcher-current"},"Current")))),
React.createElement("div",{className:"quick-switcher-footer"},React.createElement("span",null,React.createElement("kbd",
null,"\u2191"),React.createElement("kbd",null,"\u2193")," Navigate"),React.createElement("span",null,React.createElement(
"kbd",null,"Enter")," Switch"),React.createElement("span",null,qt.length," of ",ys.length)))),nr&&React.createElement("d\
iv",{className:"shortcut-help-overlay",onMouseDown:o=>{o.target===o.currentTarget&&wn(!1)}},React.createElement("div",{className:"\
shortcut-help",role:"dialog","aria-modal":"true","aria-label":"Keyboard shortcuts"},React.createElement("div",{className:"\
shortcut-help-header"},React.createElement("strong",null,"Keyboard shortcuts"),React.createElement("button",{type:"butto\
n",onClick:()=>wn(!1),"aria-label":"Close keyboard shortcuts"},"\xD7")),React.createElement("div",{className:"shortcut-h\
elp-list"},React.createElement("div",null,React.createElement("span",null,"Switch session"),React.createElement("kbd",null,
"Ctrl/Cmd P")),React.createElement("div",null,React.createElement("span",null,"Previous / next session"),React.createElement(
"kbd",null,"Alt \u2191 / \u2193")),React.createElement("div",null,React.createElement("span",null,"Focus composer"),React.
createElement("kbd",null,"Ctrl/Cmd K")),React.createElement("div",null,React.createElement("span",null,"Send / newline"),
React.createElement("kbd",null,"Enter / Shift Enter")),React.createElement("div",null,React.createElement("span",null,"O\
pen / close this guide"),React.createElement("kbd",null,"?"))),React.createElement("div",{className:"shortcut-help-note"},
"Shortcuts never switch or submit while you are typing unless they include Ctrl/Cmd or Alt."))),fs&&React.createElement(
"div",{className:"shortcut-help-overlay revalidation-ledger-backdrop",role:"presentation",onMouseDown:o=>{o.target===o.currentTarget&&
Ls(!1)}},React.createElement("div",{className:"revalidation-ledger",role:"dialog","aria-modal":"true","aria-label":"Harn\
ess revalidation program health"},React.createElement("div",{className:"shortcut-help-header"},React.createElement("stro\
ng",null,"Harness revalidation program"),React.createElement("button",{type:"button",onClick:()=>Ls(!1),"aria-label":"Cl\
ose validation health"},"\xD7")),React.createElement("p",{className:"revalidation-ledger-summary"},"Continuous version w\
atch, nightly tier-1, and staggered weekly tier-2. Write controls fail closed after drift until the installed version pa\
sses its required tiers."),React.createElement("section",{className:`operator-dogfood-health validation-state-${_i.toLowerCase()}`,
"aria-label":"Chat stability sentinel health"},React.createElement("h3",null,"Chat stability sentinel: ",_i),React.createElement(
"p",null,wt?`${wt.mode||"unknown"} / ${wt.trigger_source||"unknown trigger"} / ${wt.duration_ms||0} ms / ${wt.refresh_count??
0} refreshes / ${wt.dropped_samples??0} dropped`:"No sentinel result has been published; health remains stale."),React.createElement(
"dl",null,React.createElement("div",null,React.createElement("dt",null,"Source"),React.createElement("dd",null,wt?.source_commit||
"unavailable")),React.createElement("div",null,React.createElement("dt",null,"Build"),React.createElement("dd",null,wt?.
source_bundle_sha256||"unavailable")),React.createElement("div",null,React.createElement("dt",null,"Last end"),React.createElement(
"dd",null,wt?.completed_at?new Date(wt.completed_at).toLocaleString():"never")),React.createElement("div",null,React.createElement(
"dt",null,"Next due"),React.createElement("dd",null,wt?.next_due_at?new Date(wt.next_due_at).toLocaleString():"unknown")),
React.createElement("div",null,React.createElement("dt",null,"Scheduler"),React.createElement("dd",null,wt?.scheduler_last_result||
"unavailable")),React.createElement("div",null,React.createElement("dt",null,"Open findings"),React.createElement("dd",null,
_o.length)))),Ou.length===0?React.createElement("div",{className:"revalidation-ledger-empty"},"Program health has not be\
en published by the updated sentinel yet."):React.createElement("div",{className:"revalidation-ledger-table-wrap"},React.
createElement("table",{className:"revalidation-ledger-table"},React.createElement("thead",null,React.createElement("tr",
null,React.createElement("th",null,"Harness"),React.createElement("th",null,"Version"),React.createElement("th",null,"Fi\
xture"),React.createElement("th",null,"Tier 1"),React.createElement("th",null,"Tier 2"),React.createElement("th",null,"W\
rite gate"),React.createElement("th",null,"Next tier 2"))),React.createElement("tbody",null,Ou.map(([o,_])=>{let R=Ef[o]||
{},C=R.tier2||{},I=_.last_tier2_status||(C.mode==="gated"?"gated":"scheduled");return React.createElement("tr",{key:o},React.
createElement("th",{scope:"row"},o),React.createElement("td",null,_.installed_version||"not installed"),React.createElement(
"td",null,R.fixture?"covered":"missing"),React.createElement("td",null,R.tier1?"covered":"missing"),React.createElement(
"td",{className:`validation-state-${I}`},I),React.createElement("td",{className:`validation-state-${_.status||"pending"}`},
_.status==="pass"?"available":_.status||"pending"),React.createElement("td",null,_.next_tier2_at?new Date(_.next_tier2_at).
toLocaleString():"unscheduled"))})))))),React.createElement("div",{className:`overlay ${yn?"open":""}`,onClick:()=>ot(!1)}),
vo&&React.createElement("div",{className:`duplicate-proxy-banner${dn?.status==="pass"&&_n.length===0&&yr.length===0&&!Ma&&
!bo?" app-update-pass":""}`,role:dn?.status==="pass"&&_n.length===0&&yr.length===0&&!Ma&&!bo?"status":"alert",ref:Zo},_n.
length>0&&React.createElement(React.Fragment,null,React.createElement("strong",null,"Duplicate proxy detected."),React.createElement(
"span",null,_n.length," session",_n.length===1?"":"s"," claimed by multiple proxies. Stop the extra proxy to prevent con\
flicting controls.")),yr.length>0&&React.createElement(React.Fragment,null,React.createElement("strong",null,"Nightly va\
lidation failed."),React.createElement("span",null,yr.map(o=>`${o.harness} (${o.app_version})`).join(", "),". Check the \
validation ledger before using affected controls.")),dn&&React.createElement(React.Fragment,null,React.createElement("st\
rong",null,dn.status==="pass"?"App update validated.":"App update drift validation failed."),React.createElement("span",
null,dn.harness," ",dn.previous_app_version," -> ",dn.app_version,". ",dn.status==="pass"?"Harness controls remain avail\
able.":"A triage item was added to the maturity backlog.")),Ma&&React.createElement(React.Fragment,null,React.createElement(
"strong",null,"Harness writes paused."),React.createElement("span",null,Ma,". Read-only transcript access remains availa\
ble.")),bo&&React.createElement(React.Fragment,null,React.createElement("strong",null,"Chat stability sentinel ",_i.toLowerCase(),
"."),React.createElement("span",null,_o.length>0?`${_o.length} open P0/P1 fingerprint${_o.length===1?"":"s"}.`:"The requ\
ired 30-minute canary is missing, expired, skipped, or running against a different served asset.")),(Kr||jt||bo)&&React.
createElement("button",{type:"button",className:"validation-health-link",onClick:()=>Ls(!0)},"View program health")),React.
createElement("div",{className:`sidebar ${yn?"open":""}`},React.createElement("div",{className:"sidebar-header"},React.createElement(
"span",{className:"logo"},"\u232C"),React.createElement("span",{style:{flex:1}},"Agent Sessions"),React.createElement("b\
utton",{className:`new-session-btn notification-settings-btn${fs?" active":""}`,title:"Harness validation health","aria-\
label":"Harness validation health",onClick:()=>Ls(!0)},"V"),React.createElement("button",{className:`new-session-btn not\
ification-settings-btn${nr?" active":""}`,title:"Keyboard shortcuts (?)","aria-label":"Keyboard shortcuts",onClick:()=>{
wn(o=>!o),ke(!1)}},"?"),React.createElement("button",{className:`new-session-btn notification-settings-btn${kn?" active":
""}`,title:"Notification settings","aria-label":"Notification settings",onClick:()=>{$t(o=>!o),ht(!1),Ze(!1)}},"\u2662"),
React.createElement("button",{className:`new-session-btn notification-settings-btn${_t?" active":""}`,title:"Manage sess\
ions","aria-label":"Manage sessions",onClick:()=>{Un(m&&(An||!Rn.has(m))?m:Pe(Na[0])||""),Ze(o=>!o),ht(!1),$t(!1)}},"\u22EF"),
React.createElement("button",{className:`new-session-btn${ut?" active":""}`,title:"New session",onClick:()=>{ht(o=>!o),$t(
!1),Ze(!1)}},"+")),React.createElement("div",{className:"sidebar-session-search"},React.createElement("input",{type:"sea\
rch",value:Yr,onChange:o=>Qa(o.target.value),placeholder:"Filter sessions","aria-label":"Filter sidebar sessions",autoComplete:"\
off",spellCheck:"false"}),Yr&&React.createElement("button",{type:"button",onClick:()=>Qa(""),"aria-label":"Clear sidebar\
 filter",title:"Clear filter"},"x")),React.createElement("div",{className:`sidebar-order-control${ii?" changed":""}`,"ar\
ia-hidden":!ii,"aria-live":"polite"},React.createElement("span",null,"Order changed"),React.createElement("button",{type:"\
button",onClick:pf,disabled:!ii,tabIndex:ii?0:-1},"Sort now")),kn&&React.createElement(kv,{onClose:()=>$t(!1),onPreferencesChange:o=>{
Hn({...o,turn_ready:!1}),us(!0)}}),_t&&React.createElement(wv,{sessions:Na,preferences:We,initialSessionId:ha,onSave:ti,
onExport:xc,onClose:()=>Ze(!1)}),ut&&React.createElement(gv,{launchStates:M,onLaunch:(o,_,R)=>j(o,_,R),onResume:(o,_,R,C)=>yt(
o,_,R,C),onClose:()=>ht(!1),workspaces:Ga,showTestSessions:An}),React.createElement(iu,{structureKey:ff,placements:mf,prepareStructureChange:gf,
finishStructureChange:hf},React.createElement("div",{className:"session-list",ref:L,onPointerDown:()=>{V.current+=1,bt()},
onPointerUp:()=>Re(80),onPointerCancel:()=>Re(80),onWheel:()=>{V.current+=1,bt(),Re(180)},onTouchStart:()=>{V.current+=1,
bt()},onKeyDown:o=>{["ArrowUp","ArrowDown","PageUp","PageDown","Home","End"," "].includes(o.key)&&(V.current+=1,bt(),Re(
180))},onScroll:o=>{let _=he.current;if(_&&Math.abs(o.currentTarget.scrollTop-_.target)<=.5){he.current=null;return}V.current+=
1,bt(),Re(180)}},r.length===0&&!ut&&React.createElement("div",{className:"session-empty"},"No agents connected"),r.length>
0&&pt&&dr.length===0&&pr.length===0&&mr.length===0&&wu.length===0&&React.createElement("div",{className:"session-empty"},
"No matching sessions"),Ie.length>0&&React.createElement("section",{className:`session-group working-session-group${pt&&
dr.length===0?" sidebar-group-filtered":""}`,"aria-label":"Working now"},React.createElement("div",{className:"session-g\
roup-header"},React.createElement("span",{className:"working-session-group-icon","aria-hidden":"true"},"W"),React.createElement(
"span",{className:"session-group-name pinned-session-group-name"},"Working now"),React.createElement("span",{className:"\
session-group-status-slot"},co.hasPrompt&&React.createElement("span",{className:"session-group-alert",title:"Action requ\
ired"},"!"),React.createElement("span",{className:"session-group-working",title:"Sessions working"}),co.unread>0&&React.
createElement("span",{className:"session-group-unread",title:`${co.unread} unread`},co.unread>99?"99+":co.unread),React.
createElement("span",{className:"session-group-count"},dr.length))),React.createElement("div",{className:"session-group-\
items"},React.createElement("div",{className:"session-group-items-inner"},Ie.map(o=>Ni(o,!pt||dr.includes(o)))))),Pt.length>
0&&React.createElement("section",{className:`session-group recent-session-group${Ft.__recent__&&!pt?" collapsed":""}${pt&&
pr.length===0?" sidebar-group-filtered":""}`,"aria-label":"Recent chats"},React.createElement("div",{className:"session-\
group-header"},React.createElement("button",{type:"button",className:"session-group-toggle",title:`${Ft.__recent__?"Expa\
nd":"Collapse"} Recent chats`,"aria-label":`${Ft.__recent__?"Expand":"Collapse"} Recent chats`,"aria-expanded":!Ft.__recent__||
!!pt,onClick:()=>ni("__recent__")},React.createElement("span",{className:"session-group-caret","aria-hidden":"true"},Ft.
__recent__&&!pt?">":"v")),React.createElement("span",{className:"recent-session-group-icon","aria-hidden":"true"},"R"),React.
createElement("span",{className:"session-group-name pinned-session-group-name"},"Recent chats"),React.createElement("spa\
n",{className:"session-group-status-slot"},fr.hasPrompt&&React.createElement("span",{className:"session-group-alert",title:"\
Action required"},"!"),fr.working&&React.createElement("span",{className:"session-group-working",title:"Session working"}),
fr.unread>0&&React.createElement("span",{className:"session-group-unread",title:`${fr.unread} unread`},fr.unread>99?"99+":
fr.unread),React.createElement("span",{className:"session-group-count"},pr.length))),React.createElement("div",{className:"\
session-group-items"},React.createElement("div",{className:"session-group-items-inner"},Pt.map(o=>Ni(o,!pt||pr.includes(
o)))))),Yn.length>0&&React.createElement("section",{className:`session-group pinned-session-group${pt&&mr.length===0?" s\
idebar-group-filtered":""}`,"aria-label":"Pinned chats"},React.createElement("div",{className:"session-group-header"},React.
createElement("span",{className:"session-group-pin-icon","aria-hidden":"true"},"\u{1F4CC}"),React.createElement("span",{
className:"session-group-name pinned-session-group-name"},"Pinned chats"),React.createElement("span",{className:"session\
-group-status-slot"},gr.hasPrompt&&React.createElement("span",{className:"session-group-alert",title:"Action required"},
"!"),gr.working&&React.createElement("span",{className:"session-group-working",title:"Session working"}),gr.unread>0&&React.
createElement("span",{className:"session-group-unread",title:`${gr.unread} unread`},gr.unread>99?"99+":gr.unread),React.
createElement("span",{className:"session-group-count"},mr.length))),React.createElement("div",{className:"session-group-\
items"},React.createElement("div",{className:"session-group-items-inner"},Yn.map(o=>Ni(o,!pt||mr.includes(o)))))),Mn.map(
o=>{let _=!!Ft[o.key]&&!pt,C=wu.find(z=>z.key===o.key)?.sessions||[],I=xa(C);return React.createElement("div",{className:`\
session-group${_?" collapsed":""}${pt&&C.length===0?" sidebar-group-filtered":""}`,key:o.key},React.createElement("div",
{className:"session-group-header"},React.createElement("button",{type:"button",className:"session-group-toggle",title:`${_?
"Expand":"Collapse"} ${o.label}`,"aria-label":`${_?"Expand":"Collapse"} ${o.label}`,"aria-expanded":!_,onClick:()=>ni(o.
key)},React.createElement("span",{className:"session-group-caret","aria-hidden":"true"},_?">":"v")),React.createElement(
Qi,{title:o.label,disclosureKey:o.key,kind:"group",wrapperClassName:"session-group-title-details",triggerClassName:"sess\
ion-group-name",disclosureClassName:"session-group-disclosure",triggerLabel:`Show full group name: ${o.label}`}),React.createElement(
"span",{className:"session-group-status-slot"},I.hasPrompt&&React.createElement("span",{className:"session-group-alert",
title:"Action required"},"!"),I.working&&React.createElement("span",{className:"session-group-working",title:"Session wo\
rking"}),I.unread>0&&React.createElement("span",{className:"session-group-unread",title:`${I.unread} unread`},I.unread>99?
"99+":I.unread),React.createElement("span",{className:"session-group-count"},pt?C.length:o.sessions.length))),React.createElement(
"div",{className:"session-group-items","aria-hidden":_},React.createElement("div",{className:"session-group-items-inner"},
o.sessions.map(z=>Ni(z,!pt||C.includes(z))))))}),Ac.map(o=>{let _=Pe(o);return sg(o,!!We[_]?.pinned,df.has(_)?"":ur[_]||
"Unscoped")}))),React.createElement("div",{className:"sidebar-footer"},React.createElement("span",{className:`status-dot\
 ${Pu}`}),React.createElement("span",{className:"sidebar-footer-health"},React.createElement("span",null,i?`Relay ${Pu}`:
"Reconnecting\u2026"),React.createElement("span",{className:"sidebar-footer-rtt"},i&&$f.replace(/^\s*·\s*/,"")||"\xA0")),
React.createElement("button",{type:"button",className:`sidebar-footer-action test-session-toggle${An?" active":""}`,title:An?
"Hide test sessions":`Show test sessions (${Rn.size})`,"aria-label":An?"Hide test sessions":"Show test sessions","aria-p\
ressed":An,onClick:()=>Cc(o=>!o)},"T",Rn.size>99?"99+":Rn.size||""),React.createElement("button",{type:"button",className:`\
sidebar-footer-action${js?" active":""}`,title:"Usage and limits","aria-label":"Usage and limits",onClick:()=>{js||Ks(),
Cn(o=>!o),xn(!1),Kn(!1),Nn(!1),ht(!1),$t(!1),Ze(!1),rn(!1),Vn(!1),ot(!1)}},"\u25D4"),React.createElement("button",{type:"\
button",className:`sidebar-footer-action host-resource-footer-action${vs?" active":""}`,title:"Host resources","aria-lab\
el":"Host resources",onClick:()=>{vs||Ks(),xn(o=>!o),Cn(!1),rn(!1),Kn(!1),Nn(!1),ht(!1),$t(!1),Ze(!1),Vn(!1),ot(!1)}},"R"),
React.createElement("button",{type:"button",className:`sidebar-footer-action fleet-footer-action${Bs?" active":""}`,title:"\
Fleet view","aria-label":"Fleet view",onClick:()=>{Bs||Ks(),rn(o=>!o),Cn(!1),xn(!1),Kn(!1),Nn(!1),ht(!1),$t(!1),Ze(!1),Vn(
!1),ot(!1)}},"\u25A6"),React.createElement("button",{type:"button",className:`sidebar-footer-action transcript-search-fo\
oter-action${Fs?" active":""}`,title:"Search all transcripts","aria-label":"Search all transcripts",onClick:()=>{Fs||Ks(),
Vn(o=>!o),rn(!1),Cn(!1),xn(!1),Kn(!1),Nn(!1),ht(!1),$t(!1),Ze(!1),ot(!1)}},"\u2315"),React.createElement("a",{href:"/age\
nt-chat.apk",download:!0,className:"apk-download-link",title:"Download Android APK"},"\u2B07 APK"))),React.createElement(
"div",{className:`main${Os||Ds||js||vs||Bs||Fs?" automations-active":""}`},React.createElement(Yv,{connected:i,error:Vr,
history:zo,subscription:vn,onRefresh:Bn,onSubscribe:is,onUnsubscribe:Bt,onOpen:()=>{vs||Ks(),xn(!0),Cn(!1),rn(!1),Kn(!1),
Nn(!1),ht(!1),$t(!1),Ze(!1),Vn(!1),ot(!1)}}),Os&&React.createElement(Uv,{sessions:e,onBack:()=>Kn(!1)}),Ds&&React.createElement(
sy,{skills:za[m]||null,onRefresh:()=>m&&Ka(m),onBack:()=>Nn(!1)}),Ja&&m&&React.createElement(Sv,{sessionId:m,initialContent:Jn,
jobs:Ue.filter(o=>o.session_id===m),onSchedule:Nt,onCancel:Jt,onCreated:()=>zs(m,""),onClose:()=>ga(!1)}),js&&React.createElement(
zv,{usage:Wo,refreshReceipt:xs,resetReceipt:fc,costDetail:gc,onBack:()=>Cn(!1),onRefresh:mc,onWatch:As,onConsumeResetCredit:la,
onRequestCostDetail:Rs}),vs&&React.createElement(Xv,{snapshot:hc,error:Vr,history:zo,details:_c,subscription:vn,onBack:()=>xn(
!1),onRefresh:Bn,onSubscribe:is,onUnsubscribe:Bt}),Bs&&React.createElement(ty,{sessions:p,activities:N,thinking:b,permissionPrompts:g,
errorPrompts:w,messages:t,agentConfigs:Y,sessionAttention:Qr,health:A,connected:i,deliveryStates:S,stopPending:Wt,goalControlPending:gs,
onBroadcastSend:ce,onInterrupt:Fc,onGoalControl:Hc,onBack:()=>rn(!1),onSelectSession:(o,_)=>{Qn(o,_),rn(!1)}}),Fs&&React.
createElement(ny,{onBack:()=>Vn(!1),onOpenResult:Nf}),!Os&&!Ds&&!js&&!vs&&!Bs&&!Fs&&React.createElement(React.Fragment,null,
React.createElement("div",{className:"topbar"},React.createElement("button",{className:"hamburger",onClick:()=>ot(o=>!o)},
"\u2630",qu>0&&React.createElement("span",{className:"hamburger-badge"},qu),hi>0&&React.createElement("span",{className:"\
hamburger-attention",title:`${hi} session${hi===1?"":"s"} need attention`,"aria-label":`${hi} sessions need attention`},
"!")),React.createElement("div",{className:"topbar-context"},m?React.createElement(React.Fragment,null,React.createElement(
"div",{className:"topbar-title-row",role:"group","aria-label":`${rt.name} chat: ${Qc}`},React.createElement("div",{className:"\
agent-badge topbar-agent-badge",style:{color:rt.color,borderColor:rt.color+"55",background:rt.color+"18"}},rt.logo?React.
createElement("img",{src:rt.logo,alt:rt.abbr,className:"agent-badge-logo"}):rt.abbr),React.createElement("div",{className:"\
topbar-title-group",style:{color:rt.color}},React.createElement("div",{className:"topbar-title-projection","data-chat-ti\
tle-source":Xc.source,"data-chat-title-field":Xc.field},React.createElement(Qi,{title:Qc,disclosureKey:`topbar-${m}`,kind:"\
chat",wrapperClassName:"topbar-title-details",triggerClassName:"topbar-title",disclosureClassName:"topbar-title-disclosu\
re",triggerLabel:`Show full chat title: ${Qc}`,triggerTag:"div"})),React.createElement("div",{className:"topbar-subtitle",
title:Ss||void 0},React.createElement("span",{className:"topbar-workspace-icon"},"\u2302"),Bf,B?.branch&&B.branch!=="unk\
nown"&&React.createElement("button",{className:`topbar-branch-btn${Is?" active":""}`,title:`Branch: ${B.branch}`,onClick:()=>{
let o=!Is;rr(o),o&&Wa(m)}},React.createElement("span",{className:"topbar-branch-icon"},"\u2442"),B.branch)))),React.createElement(
"div",{className:"topbar-meta"},React.createElement("button",{className:"theme-toggle-btn",onClick:()=>Sc(o=>o==="light"?
"dark":"light"),title:"Toggle Light/Dark Mode"},ir==="light"?"\u{1F319}":"\u2600\uFE0F"),React.createElement("span",{className:`\
context-pill topbar-relay-status ${i?"ok":"warn"}`,title:i?"Relay connected":"Relay disconnected \u2014 reconnecting"},i?
"relay live":"reconnecting"),React.createElement("span",{className:`context-pill topbar-proxy-health ${Ta==="healthy"?"o\
k":Ta==="degraded"?"warn":Ta==="disconnected"?"error":""}`,title:`Proxy: ${Ta||"connecting"}`},React.createElement("span",
{className:"topbar-health-dot"}),Ta==="healthy"?"live":Ta==="degraded"?"degraded":Ta==="disconnected"?"offline":"connect\
ing"),Yu&&React.createElement("span",{className:"context-pill",title:"Remote machine"},Yu),Xu&&React.createElement("span",
{className:"context-pill",title:"Native editor host"},Xu),React.createElement(Wb,{session:D,config:B,providerUsage:Wo,onOpenUsage:()=>{
Ks(),Cn(!0),xn(!1),rn(!1)}}),(wo||wr)&&React.createElement("button",{type:"button",className:"context-pill session-contr\
ol-pill goal-control",onClick:()=>wo&&Hc(m,ko,Ys,D),disabled:!wo||!i||!!gs[m],"aria-label":wo?`${ko==="pause"?"Pause":wr?
"Resume blocked":"Resume"} goal`:"Goal blocked; resolve in the native session",title:wr?Wf||"No verified native unblock \
action is available":void 0},gs[m]?ko==="pause"?"Pausing goal...":"Resuming goal...":ko==="pause"?"Pause goal":wr?wo?"Re\
sume blocked goal":"Goal blocked \xB7 native action required":"Resume goal"),ed&&React.createElement("button",{type:"but\
ton",className:"context-pill session-control-pill interrupt-control",onClick:()=>Fc(m,D),disabled:!i||!!Wt[m],"aria-labe\
l":"Interrupt turn"},Wt[m]?"Interrupting...":"Interrupt turn"),D?.agent_type==="codex"&&D?.visible_pane_visible&&React.createElement(
"span",{className:`context-pill ${Kc?"ok":"warn"}`,title:Kc?"This Codex session is the visible right-hand pane":`Visible\
 right-hand pane is ${Uu}`},Kc?"right pane live":`right pane: ${Yl(D.visible_pane_agent)||"other"}`),Ye.length>0&&React.
createElement("span",{className:"context-pill",title:"Messages in this session"},Ye.length," msg",Ye.length!==1?"s":""),
(B?.capabilities?.chat_list||Ke)&&React.createElement("button",{className:`context-pill chat-list-toggle${(Ke?zt:zn)?" a\
ctive":""}`,title:Ke?`${zt?"Hide":"Show"} Agent Manager projects and conversations`:"View conversations",onClick:()=>{if(Ke){
Et(_=>!_),dt(!1),Q(m);return}let o=!zn;dt(o),o&&Q(m)}},Ke?"projects":"chats"),B?.capabilities?.thread_list&&React.createElement(
"button",{className:`context-pill chat-list-toggle${Kt?" active":""}`,title:"View threads",onClick:()=>{let o=!Kt;sn(o),
o&&q(m)}},"threads"),(B?.capabilities?.terminal_output||B?.capabilities?.terminal_input)&&React.createElement("button",{
className:`context-pill terminal-toggle${bs?" active":""}`,title:"Open terminal controls",onClick:()=>{let o=!bs;Yo(o),o&&
B?.capabilities?.terminal_output&&H(m)}},"terminal"),B?.capabilities?.file_changes&&React.createElement("button",{className:`\
context-pill diff-toggle${so?" active":""}`,title:"View file changes",onClick:()=>{let o=!so;ya(o),o&&_e(m)}},"changes"),
ki?.visible&&React.createElement("span",{className:"context-pill ok",title:ki.title||"Automation"},"automation"),B?.capabilities?.
file_browser&&React.createElement("button",{className:`context-pill files-toggle${on?" active":""}`,title:"Browse worksp\
ace files",onClick:()=>{let o=!on;Xo(o),o&&(ka(null),Jo("."),Wr(m,"."))}},"files"),B?.capabilities?.open_panel&&React.createElement(
"button",{className:"context-pill open-panel-btn",title:"Open panel in Antigravity",onClick:()=>Z(m)},"open panel"),B?.capabilities?.
native_window&&React.createElement("button",{className:"context-pill open-panel-btn",title:`Open this ${Yl(D?.agent_type)||
"CLI"} session in a native command window`,onClick:o=>Se(m,o)},"native"),gi&&Oe?.label&&Oe.label!=="Generating"&&React.createElement(
"span",{className:"context-pill thinking",title:Oe.label},Oe.label.length>40?Oe.label.substring(0,40)+"\u2026":Oe.label))):
React.createElement("div",{className:"topbar-title-group"},React.createElement("div",{className:"topbar-title"},"Agent C\
hat"),React.createElement("div",{className:"topbar-subtitle"},"Select a session to inspect its transcript and status")))),
(D?.agent_type==="cline"||D?.agent_type==="roo_code")&&tl&&React.createElement("div",{className:`cline-context-strip ${D?.
agent_type==="roo_code"?"roo-context-strip":""}`},React.createElement(uv,{card:tl,tone:D?.agent_type==="roo_code"?"roo":
"cline"})),Is&&m&&B?.capabilities?.branch_list&&React.createElement(Rv,{branchData:Ur[m]||null,sessionId:m,currentBranch:B?.
branch,onSwitch:o=>{oa(m,o),rr(!1)},onCreate:o=>{os(m,o),rr(!1)},onClose:()=>rr(!1)}),on&&m&&B?.capabilities?.file_browser&&
React.createElement(jv,{sessionId:m,listing:Uo[m],fileContents:Va,viewingFile:ao,onNavigate:o=>{Jo(o),ka(null),Wr(m,o)},
onOpenFile:o=>{ka(o),ia(m,o)},onBackToListing:()=>ka(null),onRefresh:()=>{ao?ia(m,ao):Wr(m,Qo)},onClose:()=>{Xo(!1),ka(null)}}),
React.createElement("div",{className:`messages-wrap${ki?.visible?" has-automation-pane":""}`,style:on?{display:"none"}:void 0},
Zf&&React.createElement(Av,{threads:eg,activeThreadId:an[m]||null,showDraftTab:!!Sn[m]||No,newLabel:Jc,onSwitch:o=>nl(m,
o),onNew:()=>Si(m),onOpenHistory:()=>{q(m),sn(!0)}}),zf&&React.createElement("div",{className:"last-user-banner",title:Zc},
React.createElement("span",{className:"last-user-banner-icon"},"\u21B5"),React.createElement("span",{className:"last-use\
r-banner-text"},Zc)),Ff&&React.createElement("div",{className:"rate-limit-overlay warning"},React.createElement("span",{
className:"rate-limit-icon"},"\u2318"),React.createElement("span",{className:"rate-limit-text"},"The visible right-hand \
pane for this workspace is showing ",React.createElement("strong",null,Gu||Br($n,Pe($n))),", not this transcript."),React.
createElement("button",{className:"context-pill",onClick:()=>Qn(Pe($n),$n),title:"Switch to the live right-hand pane ses\
sion"},"View live pane")),qf&&React.createElement("div",{className:`agv2-session-nav${zt?"":" collapsed"}`},React.createElement(
"div",{className:"agv2-session-nav-header"},React.createElement("div",{className:"agv2-session-nav-copy"},React.createElement(
"span",{className:"agv2-session-nav-title"},"Agent Manager"),React.createElement("span",{className:"agv2-session-nav-met\
a"},Fu," conversation",Fu===1?"":"s")),React.createElement("button",{className:"agv2-session-nav-btn",type:"button",onClick:()=>Q(
m),title:"Refresh Agent Manager conversations"},"Refresh"),React.createElement("button",{className:"agv2-session-nav-btn",
type:"button",onClick:()=>{Et(o=>!o),Q(m)},title:zt?"Hide Agent Manager conversations":"Show Agent Manager conversations"},
zt?"Hide":"Show")),zt&&React.createElement(Xl,{items:Bu,embedded:!0,loading:!Wc,onNavigate:o=>sl(o),onNew:()=>$a(m)})),ba&&
!Ra&&React.createElement("button",{className:"jump-to-newest",onClick:kf},nn>0?`\u2193 ${nn} new`:"\u2193 Jump to Newest"),
React.createElement("div",{className:`messages harness-theme harness-theme-${oe(D?.agent_type||"default").replace(/[^a-z0-9_-]/gi,
"-")}`,"data-agent-type":D?.agent_type||"default","data-layout":Bb(D?.agent_type),"data-transcript-windowed":Ve.enabled?
"true":"false","data-total-message-count":Zn.length,"data-window-start":Ve.start,"data-window-end":Ve.end,key:tg,ref:cn},
Xf&&React.createElement("div",{className:"messages-flex-spacer"}),Tn&&React.createElement(pv,{prompt:Tn,sessionId:m,agentType:D?.
agent_type,onRespond:x,onDismissFocus:()=>un.current?.focus()}),go&&!Tn&&React.createElement(mv,{prompt:go,sessionId:m,onRespond:E}),
(D?.rate_limit_active||D?.percent_used!=null&&D.percent_used>=75)&&React.createElement("div",{className:`rate-limit-over\
lay${D?.rate_limit_active||D?.percent_used>=90?" critical":D?.percent_used>=75?" warning":""}`},React.createElement("spa\
n",{className:"rate-limit-icon"},D?.rate_limit_active?"\u23F3":"\u{1F4CA}"),React.createElement("span",{className:"rate-\
limit-text"},D?.rate_limit_active?React.createElement(React.Fragment,null,"Rate limited",D.rate_limited_until&&D.rate_limited_until!==
"unknown"?React.createElement(React.Fragment,null," \u2014 resets ",React.createElement("strong",null,Fo(D.rate_limited_until))):
null):React.createElement(React.Fragment,null,"Used ",React.createElement("strong",null,D.percent_used,"%")," of session\
 limit",D.rate_limited_until&&D.rate_limited_until!=="unknown"?React.createElement(React.Fragment,null," \xB7 resets ",React.
createElement("strong",null,Fo(D.rate_limited_until))):null))),wi&&React.createElement("div",{className:"history-tail-ba\
nner"},React.createElement("span",null,"Showing latest ",rd.toLocaleString()," of ",Vf.toLocaleString()," messages"),React.
createElement("button",{type:"button",onClick:od,disabled:!!Vs},Vs?"Loading older messages...":"Load older messages")),m&&
Vs&&Ye.length>0&&!wi&&React.createElement("div",{className:"history-tail-banner history-refresh-banner",role:"status"},React.
createElement("span",null,"Refreshing latest messages...")),m&&pn?.error&&React.createElement("div",{className:"history-\
tail-banner history-error-inline",role:"alert"},React.createElement("span",null,pn.error),React.createElement("button",{
type:"button",onClick:Yf,disabled:!!Vs},"Retry transcript")),m?Ye.length===0&&!Ct&&Nr&&D?.is_list_view&&te[m]?.length>0&&
!Sn[m]&&!No?React.createElement("div",{className:"thread-picker-empty"},React.createElement("div",{className:"thread-pic\
ker-header"},"Select a chat"),React.createElement("div",{className:"thread-picker-list"},te[m].map((o,_)=>React.createElement(
"button",{key:o.cache_key||o.id||_,className:`thread-picker-item${o.active?" active":""}`,onClick:()=>{nl(m,o.id)},title:o.
title},React.createElement("span",{className:"thread-picker-title"},o.title||"Untitled"),o.age&&React.createElement("spa\
n",{className:"thread-picker-age"},o.age)))),React.createElement("button",{className:"thread-picker-new",onClick:()=>Si(
m)},"+ New Thread")):Ye.length===0&&!Ct&&Ke&&D?.is_list_view?React.createElement("div",{className:"thread-picker-empty a\
gv2-picker-empty"},React.createElement("div",{className:"thread-picker-header"},"Choose a conversation or start a new on\
e"),zt?null:J[m]?.length>0?React.createElement(Xl,{items:J[m]||[],embedded:!0,loading:!Wc,onNavigate:o=>sl(o),onNew:()=>$a(
m)}):React.createElement("button",{className:"thread-picker-new",onClick:()=>$a(m)},"+ New Conversation")):Ye.length===0&&
!Ct&&Ke&&J[m]?.length>0?React.createElement("div",{className:"thread-picker-empty agv2-picker-empty"},React.createElement(
"div",{className:"thread-picker-header"},"Select an Antigravity project or conversation"),!zt&&React.createElement(Xl,{items:J[m]||
[],embedded:!0,loading:!Wc,onNavigate:o=>sl(o),onNew:()=>$a(m)})):Ye.length===0&&!Ct&&D?.is_list_view&&J[m]?.length>0?React.
createElement("div",{className:"thread-picker-empty"},React.createElement("div",{className:"thread-picker-header"},"Sele\
ct a conversation or type a new message"),React.createElement("div",{className:"thread-picker-list"},J[m].map((o,_)=>React.
createElement("button",{key:o.id||_,className:`thread-picker-item${o.active?" active":""}`,onClick:()=>de(m,o.id),title:o.
title},React.createElement("span",{className:"thread-picker-title"},o.title||"Untitled"))))):Ye.length===0&&!Ct&&Vs?React.
createElement("div",{className:"empty-state history-loading-state"},React.createElement("span",{className:"new-session-s\
pinner"}),React.createElement("div",null,Vs.mode==="older"?"Loading older messages...":"Loading latest messages...")):Ye.
length===0&&!Ct?React.createElement("div",{className:"empty-state"},React.createElement("div",{className:"icon"},"\u{1F4AC}"),
React.createElement("div",null,"No messages yet")):React.createElement(React.Fragment,null,Ve.enabled&&React.createElement(
"div",{className:"transcript-window-spacer top","data-testid":"transcript-window-top-spacer",style:{height:`${Ve.topSpacerHeight}\
px`}}),Jf,Ve.enabled&&React.createElement("div",{className:"transcript-window-spacer bottom","data-testid":"transcript-w\
indow-bottom-spacer",style:{height:`${Ve.bottomSpacerHeight}px`}})):React.createElement("div",{className:"empty-state"},
React.createElement("div",{className:"icon"},"\u{1F916}"),React.createElement("div",null,"Select an agent session")),Ct&&
React.createElement(Xb,{stream:Ct,activeAgent:rt,monospace:So}),sd&&React.createElement("div",{className:`message assist\
ant live-draft${So?" monospace":""}`,"data-message-role":"assistant","data-message-timestamp":es(Oe?.started_at||Oe?.updated_at)?.
iso||"unknown"},React.createElement("div",{className:"assistant-gutter"},React.createElement("div",{className:"agent-bad\
ge transcript-agent-badge",style:{color:rt.color,borderColor:rt.color+"55",background:rt.color+"18"}},rt.logo?React.createElement(
"img",{src:rt.logo,alt:rt.abbr,className:"agent-badge-logo"}):rt.abbr)),React.createElement("div",{className:"assistant-\
content"},React.createElement("div",{className:"message-role"},React.createElement("span",{className:"message-role-label"},
rt.name),React.createElement(Bo,{instant:Oe?.started_at||Oe?.updated_at})),React.createElement(Tr,{content:Sr,monospace:So,
autoExpandLongCodeBlocks:zc,onOpenPath:o=>el("live-draft",o)}))),Lu&&!Tn&&React.createElement(fv,{prompt:Lu,sessionId:m,
onRespond:E}),React.createElement("div",{ref:bf})),React.createElement(Gv,{view:ki,onShow:()=>m&&Gr(m)})),(Oe?.task_list||
ad)&&!on&&React.createElement("div",{className:"transcript-live-footer","data-testid":"transcript-live-footer"},Oe?.task_list&&
!Oe?.step&&React.createElement("div",{className:"session-tasklist-strip"},React.createElement(lv,{taskList:Oe.task_list,
sessionId:m})),ad&&React.createElement("div",{className:"composer-live-status-strip"},React.createElement(cv,{activity:Oe,
thinkingText:m&&k[m]||"",agentType:D?.agent_type,pinned:!0}))),Za&&m&&React.createElement(Nv,{session:D||m,config:B,configControlStates:re,
onRequestRefresh:ee,onSetModel:(o,_)=>ae(o,_),onSetEffort:(o,_)=>W(o,_),onSetPermissionMode:(o,_)=>ie(o,_),onSetAutoApprovePermissions:(o,_)=>ge(
o,_),onSetMode:(o,_)=>X&&X(o,_),onSetCodexConfig:o=>we(m,o),onSwitchWorkspace:(o,_)=>$(o,_),onClose:()=>er(!1)}),!1,zn&&
m&&B?.capabilities?.chat_list&&!Ke&&React.createElement(Cv,{chats:J[m]||[],sessionId:m,onSwitch:o=>{de(m,o),dt(!1)},onNew:()=>{
pe(m),dt(!1)},onClose:()=>dt(!1)}),Kt&&m&&B?.capabilities?.thread_list&&React.createElement(xv,{threads:te[m]||[],sessionId:m,
newLabel:Jc,onSwitch:o=>{nl(m,o),sn(!1)},onNew:()=>{Si(m),sn(!1)},onClose:()=>sn(!1)}),!on&&bs&&m&&(B?.capabilities?.terminal_output||
B?.capabilities?.terminal_input)&&React.createElement(Mv,{entries:be[m]||[],canRead:!!B?.capabilities?.terminal_output,canInput:!!B?.
capabilities?.terminal_input,onRefresh:()=>H(m),onSend:o=>fe(m,o),controlResults:jn,onClose:()=>Yo(!1)}),!on&&so&&m&&B?.
capabilities?.file_changes&&React.createElement(Tv,{entries:Le[m]||[],onRefresh:()=>_e(m),onAccept:o=>Ne(m,o,"accept"),onReject:o=>Ne(
m,o,"reject"),onClose:()=>ya(!1)}),React.createElement("div",{className:`input-area composer-skin-${Cm(D?.agent_type)}`,
"data-composer-skin":Cm(D?.agent_type),style:on?{display:"none"}:void 0},React.createElement("label",{className:`attach-\
btn ${!m||!i||Ra?"disabled":""}`,title:"Attach file"},React.createElement("svg",{width:"18",height:"18",viewBox:"0 0 24 \
24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"},React.createElement(
"path",{d:"M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-\
8.48"})),React.createElement("input",{type:"file",hidden:!0,multiple:!0,ref:yf,onChange:Cf,disabled:!m||!i||!!Ra})),React.
createElement("div",{className:"input-col"},Uc.length>0&&React.createElement("div",{className:"file-chips"},Uc.map((o,_)=>React.
createElement("div",{key:_,className:"file-chip"},React.createElement("span",null,"\u{1F4C4} ",o.name,o.isText?"":" (upl\
oaded)"),React.createElement("button",{onClick:()=>Sf(m,_)},"\xD7")))),Zt&&bi.length>0&&React.createElement("div",{className:"\
slash-menu"},bi.map(o=>React.createElement("button",{key:o.command,type:"button",className:"slash-item",onClick:()=>cd(o.
command)},React.createElement("span",{className:"slash-command"},o.command),React.createElement("span",{className:"slash\
-detail"},o.detail)))),m&&hs[m]&&React.createElement("div",{className:`goal-command-notice ${hs[m].status}`,role:hs[m].status===
"failed"?"alert":"status","data-request-id":hs[m].requestId||void 0},React.createElement("strong",null,"Goal control"),React.
createElement("span",null,hs[m].text)),m&&(Ce[m]||[]).length>0&&React.createElement("div",{className:"queued-bar"},(Ce[m]||
[]).map(o=>React.createElement(sv,{key:o.cid,qm:o,onSteer:()=>je(m,o.cid,o.content,o.nativeIndex),onDiscard:()=>F(m,o.cid),
onEdit:_=>ne(m,o.cid,_)}))),React.createElement("div",{className:"textarea-row"},React.createElement("textarea",{ref:un,
value:Jn,onChange:o=>ng(o.target.value),onKeyDown:Mf,onPaste:xf,placeholder:Ra?`Resolve the ${Tn?.type==="question_promp\
t"?"question":Tn?"permission prompt":"error prompt"} above to continue`:m?window.innerWidth<600?"Enter message\u2026":"M\
essage\u2026 (/ for commands)":"Select a session",disabled:!m,rows:1}),React.createElement("div",{className:"textarea-bt\
ns"},m&&React.createElement("button",{className:`composer-gear-btn schedule-send-btn${Ja?" active":""}`,onClick:()=>ga(o=>!o),
title:"Schedule this message","aria-label":"Schedule message"},"\u25F7"),m&&React.createElement("button",{className:`com\
poser-gear-btn${Zr?" active":""}`,onClick:()=>ds(o=>!o),title:"Toggle settings"},"\u2699"),Ku&&React.createElement("butt\
on",{className:"composer-gear-btn mobile-hide",onClick:()=>Si(m),title:Jc},"\u270E"),(B?.capabilities?.chat_list||Ke)&&React.
createElement("button",{className:`composer-gear-btn mobile-hide${(Ke?zt:zn)?" active":""}`,onClick:()=>{if(Ke){Et(_=>!_),
dt(!1),Q(m);return}let o=!zn;dt(o),o&&Q(m)},title:Ke?"Agent Manager conversations":"Chat history"},"\u2630"),B?.capabilities?.
thread_list&&React.createElement("button",{className:`composer-gear-btn mobile-hide${Kt?" active":""}`,onClick:()=>{let o=!Kt;
sn(o),o&&q(m)},title:"Thread history"},"\u229F"),B?.capabilities?.open_panel&&React.createElement("button",{className:"c\
omposer-gear-btn mobile-hide",onClick:()=>Z(m),title:"Open panel"},"\u229E"),B?.capabilities?.native_window&&React.createElement(
"button",{className:"composer-gear-btn mobile-hide",onClick:o=>Se(m,o),title:"Open native command window"},"cmd"),B?.capabilities?.
new_chat&&React.createElement("button",{className:"composer-gear-btn mobile-hide",onClick:()=>Ke?$a(m):pe(m),title:Ke?"N\
ew Antigravity conversation":"New chat"},"+"),ed?React.createElement("button",{className:`stop-btn${vr?" pending":""}`,title:vr?
"Interrupting\u2026":"Interrupt agent",disabled:vr,onClick:Bc},vr?React.createElement("span",{className:"stop-btn-spinne\
r"}):"\u25A0"):React.createElement("button",{className:"send-btn",onClick:$u,disabled:!Tf,title:i?"Send":"Queue until re\
connected"},$s?"\u2026":"\u2191"))),React.createElement("div",{className:"composer-meta"},_a===m&&gi&&!vr&&React.createElement(
"span",{className:"interrupt-confirm-inline",role:"status","aria-live":"polite"},"Press Esc again or Enter to interrupt"),
(eu(D?.agent_type)||Oo(D?.agent_type))&&B?.mode&&B.mode!=="unknown"&&React.createElement("span",{className:"composer-hin\
t",style:{color:"#d29922"}},B.mode),(eu(D?.agent_type)||Oo(D?.agent_type))&&B?.model_id&&B.model_id!=="unknown"&&React.createElement(
"span",{className:"composer-hint",style:{color:"#d29922"}},B.model_id),D?.agent_type==="codex_cli"&&B?.config_semantics===
"observed_and_next_send"&&React.createElement("span",{className:"composer-hint",style:{color:"#8b949e"}},"Observed ",B.observed_model_id||
"unknown"," / ",B.observed_effort||"unknown"," \xB7 ","Next ",B.next_send_model_id||"unset"," / ",B.next_send_effort||"u\
nset"),D?.agent_type==="antigravity-v2"&&B?.model_id&&B.model_id!=="unknown"&&React.createElement("span",{className:"com\
poser-hint",style:{color:"#8b949e"}},B.model_id),(D?.agent_type==="antigravity"||D?.agent_type==="antigravity_panel")&&(Array.
isArray(D?.antigravity_quota_models)&&D.antigravity_quota_models.length>0?React.createElement("span",{className:"compose\
r-hint",style:{color:"#8b949e"}},Zm(D.antigravity_quota_models,4)):D?.percent_used!=null?React.createElement("span",{className:"\
composer-hint",style:{color:D.percent_used>=90?"#f85149":D.percent_used>=75?"#d29922":"#8b949e"}},"Quota ",D.percent_used,
"%",D?.rate_limited_until&&D.rate_limited_until!=="unknown"?` \xB7 ${D.rate_limited_until}`:""):null),React.createElement(
"span",{className:"composer-hint"},"Enter send"),React.createElement("span",{className:"composer-hint"},"Shift+Enter new\
line"),React.createElement("span",{className:"composer-hint"},"Ctrl/Cmd+K focus"),React.createElement("span",{className:"\
composer-hint"},"/ commands"),React.createElement("span",{className:"composer-hint"},"Ctrl+V image"),m&&Jn&&React.createElement(
"span",{className:"composer-hint draft-live"},"draft saved")),m&&React.createElement("div",{className:`composer-settings${Zr?
" is-open":""}`},(ju||vi)&&React.createElement("div",{className:`composer-control-state ${vi?"failed":"pending"}`,role:"\
status"},vi?vi.error:`Saving ${ju.field.replace(/_/g," ")}\u2026`),(B?.capabilities?.set_model||D?.agent_type==="antigra\
vity"||D?.agent_type==="antigravity_panel")&&React.createElement(React.Fragment,null,D?.agent_type==="codex_cli"&&B?.config_semantics===
"observed_and_next_send"&&React.createElement("span",{className:"composer-setting-label","data-control":"observed-model"},
React.createElement("span",{className:"composer-setting-key"},"Observed model"),React.createElement("span",{className:"c\
omposer-hint"},B.observed_model_id||"unknown")),React.createElement("label",{className:"composer-setting-label","data-co\
ntrol":"model"},React.createElement("span",{className:"composer-setting-key"},D?.agent_type==="codex_cli"&&B?.config_semantics===
"observed_and_next_send"?"Next model":"Model"),React.createElement("select",{className:"composer-setting-select",value:D?.
agent_type==="codex_cli"&&B?.config_semantics==="observed_and_next_send"?B.next_send_model_id||"":B?.model_id||"default",
onChange:o=>ae(m,o.target.value)},D?.agent_type==="codex_cli"&&B?.config_semantics==="observed_and_next_send"&&React.createElement(
"option",{value:"",disabled:!0},"Choose model\u2026"),Om(D?.agent_type,B).map(o=>React.createElement("option",{key:o.id,
value:o.id},o.label)),B?.model_id&&!Om(D?.agent_type,B).some(o=>o.id===B.model_id)&&B.model_id!=="unknown"&&B.config_semantics!==
"observed_and_next_send"&&React.createElement("option",{value:B.model_id},B.model_id)),D?.agent_type==="codex_cli"&&B?.config_semantics===
"observed_and_next_send"&&React.createElement("span",{className:"composer-hint"},B.next_send_model_status||"unset"))),(D?.
agent_type==="antigravity"||D?.agent_type==="antigravity_panel")&&React.createElement("label",{className:"composer-setti\
ng-label","data-control":"mode"},React.createElement("span",{className:"composer-setting-key"},"Mode"),React.createElement(
"select",{className:"composer-setting-select",value:B?.conversation_mode||"Planning",onChange:o=>X(m,o.target.value)},hu.
map(o=>React.createElement("option",{key:o.id,value:o.id},o.label)))),(Oo(D?.agent_type)||D?.agent_type==="cursor")&&B?.
capabilities?.set_mode&&Io(D?.agent_type,B).length>0&&React.createElement("label",{className:"composer-setting-label","d\
ata-control":"mode"},React.createElement("span",{className:"composer-setting-key"},"Mode"),React.createElement("select",
{className:"composer-setting-select",value:B?.mode||Io(D?.agent_type,B)[0]?.id||"unknown",onChange:o=>X(m,o.target.value)},
Io(D?.agent_type,B).map(o=>React.createElement("option",{key:o.id,value:o.id},o.label)),B?.mode&&B.mode!=="unknown"&&!Io(
D?.agent_type,B).some(o=>o.id===B.mode)&&React.createElement("option",{value:B.mode},B.mode))),B?.capabilities?.permission_mode_change&&
React.createElement("label",{className:"composer-setting-label","data-control":"permission"},React.createElement("span",
{className:"composer-setting-key"},D?.agent_type==="codex_cli"?"Access":"Permission"),React.createElement("select",{className:"\
composer-setting-select",value:B.permission_mode||sf(D?.agent_type),onChange:o=>ie(m,o.target.value),title:"Permission m\
ode"},au(D?.agent_type||"claude",B).map(o=>React.createElement("option",{key:o.value,value:o.value},o.label)),B.permission_mode&&
!au(D?.agent_type,B).some(o=>o.value===B.permission_mode)&&B.permission_mode!=="unknown"&&React.createElement("option",{
value:B.permission_mode},B.permission_mode))),(D?.agent_type==="claude_cli"||D?.agent_type==="codex_cli"||D?.agent_type===
"cursor_cli")&&B?.capabilities?.set_effort&&(B.available_efforts||[]).length>0&&React.createElement(React.Fragment,null,
D?.agent_type==="codex_cli"&&B?.config_semantics==="observed_and_next_send"&&React.createElement("span",{className:"comp\
oser-setting-label","data-control":"observed-effort"},React.createElement("span",{className:"composer-setting-key"},"Obs\
erved effort"),React.createElement("span",{className:"composer-hint"},B.observed_effort||"unknown")),React.createElement(
"label",{className:"composer-setting-label","data-control":"effort"},React.createElement("span",{className:"composer-set\
ting-key"},D?.agent_type==="codex_cli"&&B?.config_semantics==="observed_and_next_send"?"Next effort":"Effort"),React.createElement(
"select",{className:"composer-setting-select",value:D?.agent_type==="codex_cli"&&B?.config_semantics==="observed_and_nex\
t_send"?B.next_send_effort||"":B.effort||"medium",onChange:o=>W(m,o.target.value),title:`${D?.agent_type==="codex_cli"?"\
Codex":D?.agent_type==="cursor_cli"?"Cursor":"Claude"} CLI effort`},D?.agent_type==="codex_cli"&&B?.config_semantics==="\
observed_and_next_send"&&React.createElement("option",{value:"",disabled:!0},"Choose effort\u2026"),(B.available_efforts||
[]).map(o=>React.createElement("option",{key:o.id,value:o.id},o.label))),D?.agent_type==="codex_cli"&&B?.config_semantics===
"observed_and_next_send"&&React.createElement("span",{className:"composer-hint"},B.next_send_effort_status&&B.next_send_effort_status!==
"unset"?B.next_send_effort_status:"No override selected"))),B?.capabilities?.auto_approve_permissions_toggle&&React.createElement(
"label",{className:"composer-setting-toggle",title:"Automatically approve permission prompts for this session"},React.createElement(
"input",{type:"checkbox",checked:typeof B?.auto_approve_permissions=="boolean"?B.auto_approve_permissions:!!D?.auto_approve_permissions,
onChange:o=>ge(m,o.target.checked)}),React.createElement("span",null,"Auto-approve prompts")),B?.capabilities?.set_codex_config&&
React.createElement(React.Fragment,null,B?.capabilities?.codex_model_change&&React.createElement("label",{className:"com\
poser-setting-label","data-control":"model"},React.createElement("span",{className:"composer-setting-key"},D?.agent_type===
"codex"?"Next model":"Model"),React.createElement("select",{className:"composer-setting-select",value:B.model_id||"unkno\
wn",disabled:D?.agent_type==="codex"&&B.controls_available===!1||["pending","awaiting_config"].includes(re?.[`${m}:model`]?.
status),onChange:o=>we(m,{model_id:o.target.value}),title:D?.agent_type==="codex"?"Next-turn Codex model":"Codex Desktop\
 model"},(B.available_models||[]).map(o=>React.createElement("option",{key:o.id,value:o.id},o.label)),B.model_id&&!(B.available_models||
[]).some(o=>o.id===B.model_id)&&B.model_id!=="unknown"&&React.createElement("option",{value:B.model_id},B.model_id))),B?.
capabilities?.codex_effort_change&&React.createElement("label",{className:"composer-setting-label","data-control":"effor\
t"},React.createElement("span",{className:"composer-setting-key"},D?.agent_type==="codex"?"Next effort":"Effort"),React.
createElement("select",{className:"composer-setting-select",value:(B.effort||"unknown").toLowerCase(),disabled:D?.agent_type===
"codex"&&B.controls_available===!1||["pending","awaiting_config"].includes(re?.[`${m}:effort`]?.status),onChange:o=>we(m,
{effort:o.target.value}),title:D?.agent_type==="codex"?"Next-turn reasoning effort":"Codex Desktop reasoning effort"},(B.
available_efforts||[]).map(o=>React.createElement("option",{key:o.id,value:o.id},o.label)))),B?.capabilities?.codex_permission_profile_change&&
React.createElement("label",{className:"composer-setting-label","data-control":"permission-profile"},React.createElement(
"span",{className:"composer-setting-key"},"Next permissions"),React.createElement("select",{className:"composer-setting-\
select",value:B.permission_profile||"unknown",disabled:B.controls_available===!1||["pending","awaiting_config"].includes(
re?.[`${m}:permission_profile`]?.status),onChange:o=>we(m,{permission_profile:o.target.value}),title:"Next-turn native C\
odex permissions profile"},B.permission_profile==="full-access"&&React.createElement("option",{value:"full-access",disabled:!0},
"Full access"),(B.available_permission_profiles||[]).filter(o=>o.id!=="full-access").map(o=>React.createElement("option",
{key:o.id,value:o.id},o.label)))),B?.capabilities?.codex_bypass_permissions&&React.createElement("button",{type:"button",
className:"composer-desktop-action composer-bypass-action",onClick:()=>{er(!0),ds(!1)},title:"Review and confirm Full ac\
cess in Session Settings"},B.bypass_permissions_active?"Bypass active":"Bypass\u2026"),B?.capabilities?.codex_speed_change&&
React.createElement("label",{className:"composer-setting-label","data-control":"speed"},React.createElement("span",{className:"\
composer-setting-key"},"Speed"),React.createElement("select",{className:"composer-setting-select",value:(B.speed||"stand\
ard").toLowerCase(),onChange:o=>we(m,{speed:o.target.value}),title:"Speed"},(B.available_speeds||[]).map(o=>React.createElement(
"option",{key:o.id,value:o.id},o.label)),B.speed&&!(B.available_speeds||[]).some(o=>o.id===B.speed)&&B.speed!=="unknown"&&
React.createElement("option",{value:B.speed},B.speed))),B?.capabilities?.codex_access_change&&React.createElement("label",
{className:"composer-setting-label","data-control":"permission"},React.createElement("span",{className:"composer-setting\
-key"},"Access"),React.createElement("select",{className:"composer-setting-select",value:B.permission_mode||"unknown",onChange:o=>we(
m,{access_mode:o.target.value}),title:"Codex Desktop access mode"},(B.available_access||[]).map(o=>React.createElement("\
option",{key:o.id,value:o.id},o.label)),B.permission_mode&&!(B.available_access||[]).some(o=>o.id===B.permission_mode)&&
B.permission_mode!=="unknown"&&React.createElement("option",{value:B.permission_mode},B.permission_mode))),D?.agent_type===
"codex-desktop"&&(B.available_workspaces||[]).length>0&&React.createElement("select",{className:"composer-setting-select",
value:B.file_access_scope||"",onChange:o=>$(m,o.target.value),title:"Switch workspace"},(B.available_workspaces||[]).map(
o=>React.createElement("option",{key:o.id,value:o.path||o.id},o.label)))),Ss&&React.createElement("span",{className:"com\
poser-workspace",title:Ss},"\u2302 ",Wu||Ss),React.createElement("button",{className:"composer-desktop-action",onClick:()=>{
er(!0),ds(!1)}},"\u2699 Session details"),React.createElement("div",{className:"composer-mobile-actions"},React.createElement(
"button",{className:"composer-mobile-action",onClick:()=>{er(!0),ds(!1)}},"\u2699 Session details"),Ku&&React.createElement(
"button",{className:"composer-mobile-action",onClick:()=>ve(m)},"\u270E New thread"),(B?.capabilities?.chat_list||Ke)&&React.
createElement("button",{className:"composer-mobile-action",onClick:()=>{Q(m),Ke?(Et(!0),dt(!1)):dt(!0),ds(!1)}},"\u2630 ",
Ke?"Projects":"Chat history"),B?.capabilities?.thread_list&&React.createElement("button",{className:"composer-mobile-act\
ion",onClick:()=>{q(m),sn(!0),ds(!1)}},"\u229F Threads"),B?.capabilities?.open_panel&&React.createElement("button",{className:"\
composer-mobile-action",onClick:()=>Z(m)},"\u229E Open panel"),B?.capabilities?.new_chat&&React.createElement("button",{
className:"composer-mobile-action",onClick:()=>Ke?$a(m):pe(m)},"+ New chat"))))))),st&&React.createElement("div",{className:"\
attention-toast",role:"status","aria-live":"polite"},React.createElement("span",{className:`attention-toast-icon ${st.kind}`,
"aria-hidden":"true"},st.kind==="prompt"||["goal_attention","provider_usage_threshold"].includes(st.kind)?"!":"\u2713"),
React.createElement("span",{className:"attention-toast-copy"},React.createElement("strong",null,st.title),React.createElement(
"span",null,st.detail)),React.createElement("button",{type:"button",onClick:()=>{let o=r.find(_=>Pe(_)===st.sessionId);o&&
Qn(st.sessionId,o),Mu()}},"Jump")),React.createElement("div",{className:`toast ${Xr?"visible":""}`},Xr))}var of=(()=>{try{return new URLSearchParams(window.location.search).get("render_profile")==="1"}catch{return!1}})();function ry(e,t,n,s,a,i){
let c=window.__RAC_RENDER_PROFILER__||(window.__RAC_RENDER_PROFILER__=[]);c.push({id:e,phase:t,route:document.querySelector(
'[data-testid="fleet-view"]')?"fleet":document.querySelector('[data-testid="usage-dashboard"]')?"usage":document.querySelector(
'[data-testid="host-resource-dashboard"]')?"host-resources":document.querySelector(".messages")?"chat":"other",actual_duration_ms:Number(
n.toFixed(3)),base_duration_ms:Number(s.toFixed(3)),start_time_ms:Number(a.toFixed(3)),commit_time_ms:Number(i.toFixed(3))}),
c.length>2e3&&c.splice(0,c.length-2e3)}var Um=React.createElement(ou,null,React.createElement(ay,null));ReactDOM.createRoot(
document.getElementById("root")).render(of?React.createElement(React.Profiler,{id:"AgentChatRoot",onRender:ry},Um):Um);"serviceWorker"in navigator&&window.addEventListener("load",function(){navigator.serviceWorker.register("/sw.js").catch(
function(e){console.warn("SW registration failed:",e)})});(window.navigator.standalone===!0||window.matchMedia("(display\
-mode: standalone)").matches)&&document.body.classList.add("pwa-standalone");})();
