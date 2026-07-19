(()=>{var pf=Object.create;var Mu=Object.defineProperty;var mf=Object.getOwnPropertyDescriptor;var ff=Object.getOwnPropertyNames;var gf=Object.getPrototypeOf,hf=Object.prototype.hasOwnProperty;var _f=(e,t)=>()=>(t||e((t={exports:{}}).exports,t),t.exports);var bf=(e,t,n,s)=>{if(t&&typeof t=="object"||typeof t=="function")for(let a of ff(t))!hf.call(e,a)&&a!==n&&Mu(e,a,{get:()=>t[a],
enumerable:!(s=mf(t,a))||s.enumerable});return e};var vf=(e,t,n)=>(n=e!=null?pf(gf(e)):{},bf(t||!e||!e.__esModule?Mu(n,"default",{value:e,enumerable:!0}):n,e));var $p=_f((ly,Tp)=>{"use strict";var Np=new Set(["codex","codex_cli","codex-desktop"]),Bh=new Set(["thinking","generatin\
g","reading_files","running_command","applying_patch","working"]),Fh=new Set(["active","in_progress","in-progress","work\
ing","running"]),Hh=new Set(["pending","queued","todo","not_started","not-started"]),Sp=new Set(["completed","complete",
"done","passed","success","succeeded"]),Uh=new Set([...Sp,"cancelled","canceled","failed","skipped"]),Wh=new Set(["","ac\
tive","idle","ready","thinking","generating","working","busy","connected"]),Cp=240,zh=32,Gh=48,Kh=/^(?=.*\d)(?:(?:\d+)\s*d\s*)?(?:(?:\d+)\s*h\s*)?(?:(?:\d+)\s*m\s*)?(?:(?:\d+)\s*s)?$/i,
Vh=/^[+-]?\d+\s*[dhms]\b/i,Yh=/^(?:just now|today|yesterday|(?:\d+|an?|one)\s+(?:seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?)\s+ago)$/i,
Xh=/^(?:pursuing goal|paused goal|goal (?:paused|blocked|usage limited|rate limited|limited|budget limited|achieved|cancelled|canceled|stopped|failed)|idle|ready|connected|awaiting live update)$/i,
Qh=/^(?:no (?:recent message|current work|data|activity)(?: reported)?|unavailable|unknown|not available)$/i,Jh=/^(?:remote agent chat|(?:antigravity|claude(?: code)?|cline|codex|continue|cursor|gemini|roo code)\s+(?:harness|workspace))$/i,
kp=Object.freeze({active:"active",running:"active",working:"active",pursuing:"active",pursuing_goal:"active",paused:"pau\
sed",pause:"paused",paused_goal:"paused",blocked:"blocked",goal_blocked:"blocked",needs_attention:"blocked",waiting_for_user:"\
blocked",usagelimited:"usageLimited",usage_limited:"usageLimited",goal_usage_limited:"usageLimited",rate_limited:"usageL\
imited",goal_rate_limited:"usageLimited",budgetlimited:"budgetLimited",budget_limited:"budgetLimited",goal_limited:"budg\
etLimited",goal_budget_limited:"budgetLimited",complete:"complete",completed:"complete",achieved:"complete",goal_achieved:"\
complete",cancelled:"cancelled",canceled:"cancelled",stopped:"cancelled",goal_cancelled:"cancelled",goal_canceled:"cance\
lled",goal_stopped:"cancelled",failed:"failed",failure:"failed",goal_failed:"failed"});function xp(e){return String(e||"").
trim().toLowerCase()}function Ap(e,t){return t&&typeof t.goal_lifecycle=="boolean"?t.goal_lifecycle:Np.has(xp(e))}function bi(e){
if(typeof e=="number"&&Number.isFinite(e)&&e>0)return e;let t=Date.parse(String(e||""));return Number.isFinite(t)?t:0}function Bn(...e){
for(let t of e){let n=bi(t);if(n)return new Date(n).toISOString()}return null}function Zh(e){return/(?:\bbearer\s+[a-z0-9._~+/=-]{8,}|\b(?:api[_ -]?key|password|passwd|secret|access[_ -]?token|refresh[_ -]?token)\s*[:=]\s*\S+|\bsk-[a-z0-9_-]{8,})/i.
test(e)}function Rp(e){let t=String(e??"").replace(/\s+/g," ").trim();return t?Kh.test(t)?"duration_only":Vh.test(t)?"du\
ration_malformed":Yh.test(t)?"age_only":Xh.test(t)?"status_only":Qh.test(t)?"placeholder_only":Jh.test(t)?"surface_label\
_only":"":"empty"}function jt(e,t=Cp){if(typeof e!="string"&&typeof e!="number")return"";let n=String(e).replace(/[\u0000-\u001f\u007f]+/g,
" ").replace(/```[\s\S]*?```/g," ").replace(/\s+/g," ").trim();return!n||Zh(n)||Rp(n)||/^[{[]\s*["']?[\w.-]+["']?\s*:/.test(
n)||/^(?:powershell|pwsh|cmd(?:\.exe)?|bash|sh|zsh|fish)\s+-/i.test(n)?"":(n=n.replace(/^(?:[-*•]\s+|#{1,6}\s+)/,"").trim(),
n.slice(0,t).trim())}function Mp(e){let t=String(e||"").trim().replace(/([a-z0-9])([A-Z])/g,"$1_$2").toLowerCase().replace(
/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"");return t&&(kp[t]||kp[t.replace(/_/g,"")])||"unknown"}function cl(e){for(let t of[
e?.state,e?.status,e?.raw_state,e?.native_state]){let n=Mp(t);if(n!=="unknown")return n}return"unknown"}function hi(e){return String(
e?.state||e?.status||"").trim().toLowerCase()}function wp(e){return jt(e?.subject||e?.text||e?.content||e?.description||
e?.label)}function ll(e,t){let n=Number(t),s=Number(e);return!Number.isInteger(n)||n<=0||!Number.isInteger(s)||s<0?null:
{completed:Math.min(s,n),total:n}}function e_(e){let t=Number(e?.progress_percent??e?.percent_complete??e?.percent??e?.progress);
return Number.isFinite(t)?Math.max(0,Math.min(100,t<=1?t*100:t)):null}function _i(e,t={}){if(!e||typeof e!="object")return null;
let n=String(e.kind||"").trim().toLowerCase().replace(/[^a-z_]/g,"").slice(0,24);if(!n||n==="goal"&&t.goalCapable===!1)return null;
let s=jt(e.label,zh),a=jt(e.text),i=jt(e.source,Gh).replace(/\s+/g,"_").toLowerCase();if(!s||!a||!i)return null;let c=n===
"goal"?cl(e):"unknown";if(n==="goal"&&c==="unknown")return null;let u=ll(e.completed,e.total),p=Number(e.percent);return{
kind:n,label:s,text:a,source:i,updated_at:Bn(e.updated_at)||null,...u||{},...Number.isFinite(p)?{percent:Math.max(0,Math.
min(100,p))}:{},...n==="goal"?{state:c}:e.state?{state:jt(e.state,32).toLowerCase()}:{},...e.diagnostic_reason?{diagnostic_reason:String(
e.diagnostic_reason).slice(0,64)}:{}}}function t_(e){let t=Array.isArray(e)?e:[];for(let n=t.length-1;n>=0;n-=1){let s=t[n];
if(String(s?.role||"").toLowerCase()!=="user")continue;let a=jt(s?.content||s?.text);if(a)return{text:a,updated_at:Bn(s?.
timestamp,s?.created_at,s?.ts,s?.server_ts)}}return null}function il(e,t){let n=xp(e);return n==="claude"||n==="claude_c\
li"||n==="claude-desktop"?t>1?"Tasks":"Task":["antigravity","antigravity_panel","antigravity-v2","gemini","continue","co\
ntinue_yolo","roo_code","cline"].includes(n)?"Task":t>1?"Tasks":"Plan"}function n_(e,t){let n=t?.task_list,s=Array.isArray(
n?.tasks)?n.tasks:[],a=s.filter(b=>wp(b));if(a.length>0){let b=a.find(A=>Fh.has(hi(A))),y=a.find(A=>Hh.has(hi(A))),S=b||
y;if(S){let A=Number(n.total),N=Number.isInteger(A)&&A>0?A:s.length,h=Number(n.completed),d=Number.isInteger(h)&&h>=0?h:
s.filter(v=>Sp.has(hi(v))).length;return{kind:"plan",label:il(e,N),text:wp(S),source:"task_list",updated_at:Bn(S.updated_at,
S.updatedAt,n.updated_at,t.updated_at),...ll(d,N)}}}let i=t?.step,c=hi(i),u=typeof i=="object"?i?.text||i?.content||i?.description||
i?.label||i?.name:i,p=jt(u);return p&&!Uh.has(c)?{kind:"plan",label:il(e,1),text:p,source:"step",updated_at:Bn(i?.updated_at,
i?.updatedAt,t.updated_at)}:null}function s_(e){let t=e?.current;if(!t||typeof t!="object")return null;let n=jt(t.label||
t.title||t.name);if(!n)return null;let s=String(t.kind||"").trim().toLowerCase(),a=["response","thinking","generating","\
message"].includes(s);return{kind:a?"response":"activity",label:a?"Current response":"Current activity",text:n,source:s?
`current_${s}`:"current",updated_at:Bn(t.updated_at,t.since,e.updated_at)}}function a_(e,t){let n=t?.context_card;if(!n||
typeof n!="object")return null;let s=jt(n.task||n.title||n.mode||n.label||n.text);return s?{kind:"task",label:il(e,1),text:s,
source:"context_card",updated_at:Bn(n.updated_at,t.updated_at)}:null}function r_(e){let t=typeof e=="string"?{text:e}:e,
n=jt(t?.text||t?.content);return n?{kind:"request",label:"Request",text:n,source:"latest_user_request",updated_at:Bn(t?.
updated_at,t?.timestamp,t?.created_at)}:null}function o_(e){let t=jt(e?.label,160);return!t||Wh.has(t.toLowerCase())?null:
{kind:"activity",label:"Current activity",text:t,source:"activity_label",updated_at:Bn(e?.updated_at,e?.started_at,e?.since)}}
function i_(e,t){if(!t||!e?.goal||typeof e.goal!="object")return null;let n=e.goal,s=jt(n.objective||n.text);if(!s)return null;
let a=cl(n);if(a==="unknown")return null;let i=ll(n.completed,n.total),c=e_(n);return{kind:"goal",label:"Goal",text:s,source:"\
goal",updated_at:Bn(n.updated_at,n.observed_at,e.updated_at),...i||{},...c==null?{}:{percent:c},state:a}}function c_(e,t){
if(!e)return t;if(!t)return e;let n=bi(e.updated_at);return bi(t.updated_at)>n&&n>0?t:e}function l_(e={}){let t=e.activity&&
typeof e.activity=="object"?e.activity:{},n=Ap(e.agentType,e.capabilities);if(e.preferProvided!==!1){let S=_i(t.work_context,
{goalCapable:n});if(S)return S}let s=i_(t,n);if(s)return _i(s,{goalCapable:n});let a=n_(e.agentType,t),i=s_(t),c=a_(e.agentType,
t),u=r_(e.latestUserRequest),p=o_(t),b=Bh.has(String(t.kind||"").toLowerCase()),y=a||c;return b&&i&&(y=c_(y,i)),y||(y=i||
c||u||p),!y&&u&&(y=u),y||(y={kind:"empty",label:"Current work",text:"Current work unavailable",source:"none",updated_at:Bn(
t.updated_at),diagnostic_reason:"no_authoritative_work_context"}),_i(y,{goalCapable:n})}Tp.exports={CODEX_GOAL_AGENT_TYPES:Np,
MAX_CONTEXT_TEXT:Cp,boundedDisplayText:jt,coherentGoalState:cl,goalLifecycleSupported:Ap,latestUserRequestFromMessages:t_,
normalizeFleetWorkContext:_i,normalizeGoalState:Mp,projectFleetWorkContext:l_,rejectedDisplayTextReason:Rp,timestampMs:bi}});var yf=new Set(["js","jsx","ts","tsx","py","json","md","css","html","htm","sh","bash","yaml","yml","txt","env","csv","xm\
l","sql","go","rs","java","c","cpp","h","hpp","rb","php","swift","kt","scala","r","m","tf","toml","ini","cfg","conf","lo\
g","gitignore","dockerfile","makefile","vue","svelte","graphql","gql"]),kf={js:"javascript",jsx:"jsx",ts:"typescript",tsx:"\
tsx",py:"python",rb:"ruby",sh:"bash",bash:"bash",rs:"rust",kt:"kotlin",tf:"hcl",md:"markdown",yml:"yaml",yaml:"yaml",graphql:"\
graphql",gql:"graphql"};function za(e){let t=e.split(".").pop().toLowerCase();return kf[t]||t}function $u(e){let t=e.split(
".").pop().toLowerCase();return yf.has(t)}var Tu={claude:"Claude Code",claude_cli:"Claude Code CLI",codex:"Codex",codex_cli:"\
Codex CLI",cursor_cli:"Cursor CLI",gemini:"Gemini",continue:"Continue",continue_yolo:"Continue YOLO",roo_code:"Roo Code",
cline:"Cline",antigravity:"Antigravity",antigravity_panel:"Antigravity Chat","codex-desktop":"Codex Desktop",cursor:"Cur\
sor","claude-desktop":"Claude Desktop"},wf=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function Eu(e,t){if(e&&typeof e=="object"){let p=Tu[e.agent_type]||e.display_name||e.agent_type||"Agent",b=e.workspace_name||
e.window_title||"";return b?p+" \u2014 "+b:p}let n=t||e;if(typeof n!="string")return"Agent";if(wf.test(n))return"Agent S\
ession";let s=n.split("-"),a=s[0],i=s[1]||"",c=s[2]||"",u=i?" (win "+i+c+")":"";return(Tu[a]||a)+u}function Pe(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}function Zt(e){return Pe(String(
e)).replace(/"/g,"&quot;")}function Va(e){return/^[A-Za-z]:\\/.test(e)||e.includes("\\")||e.includes("/")||/^[.~]\//.test(
e)}function Nf(e){let t=0,n=0;return e.split(`
`).forEach(s=>{/^\+\+\+|^---|^@@/.test(s)||(s.startsWith("+")&&t++,s.startsWith("-")&&n++)}),{adds:t,dels:n}}function Sf(e){
return/\b(edit|edited|patch|diff|apply_patch|write)\b/i.test(String(e||""))}function Cf(e){let t=String(e||"").replace(/\r\n?/g,
`
`).split(`
`).map(n=>n.trimEnd());for(let n of t)if(n){if(/^(diff --git|index )/.test(n)||/^@@/.test(n)||/^---[ \t]/.test(n)||/^\+\+\+[ \t]/.
test(n))return!0;if(/^[+\- ]/.test(n)){let s=n.slice(1).trim();if(!s||/^[\d\s()+\-]+$/.test(s))continue;return!0}}return!1}function xf(e){let t=(e||"").toLowerCase();return t.includes("bash")||t.includes("run")||t.includes("command")||t.includes(
"execute")?"dot-bash":t.includes("read")?"dot-read":t.includes("edit")||t.includes("write")||t.includes("patch")?"dot-wr\
ite":t.includes("search")||t.includes("grep")||t.includes("find")||t.includes("glob")?"dot-search":t.includes("browser")||
t.includes("web")||t.includes("fetch")?"dot-browser":"dot-default"}function qu(e){let t=String(e||"").split(`
`),n=[],s=[],a=null,i=!1;function c(){let p=s.join(`
`).trim();p&&n.push({type:"markdown",content:p}),s=[]}function u(){if(!a)return;let p=a.lines.join(`
`).trimEnd();n.push({type:"tool",name:a.name,content:p}),a=null}return t.forEach(p=>{let b=/^```/.test(p.trim()),y=i?null:
p.match(/^\[([^\]\n]+)\]\s*$/),S=i?null:p.match(/^(Ran .+|Read .+|Edited file|Edit .+|Analyzed .+|Search(?:ed)? .+|Bash .+)\s*$/),
A=!i&&p.match(/^(\d+\s+lines?(?:\s+of\s+output)?)$/i);if(y){if(y[1].trim()==="end"){u();return}c(),u(),a={name:y[1].trim(),
lines:[]};return}if(A){c(),u(),a={name:A[1].trim(),lines:[]};return}if(S){c(),u(),a={name:S[1].trim(),lines:[]};return}a?
a.lines.push(p):s.push(p),b&&(i=!i)}),c(),u(),n.length>0?n:[{type:"markdown",content:String(e||"")}]}function Sc(e){if(!e)
return!1;let t=String(e).replace(/\r\n?/g,`
`);if(/^(diff --git|index )/m.test(t)||/^@@/m.test(t)||/^---[ \t]/m.test(t)&&/^\+\+\+[ \t]/m.test(t))return!0;let s=t.split(
`
`).map(p=>p.trimEnd()).filter(Boolean);if(s.length<4)return!1;let a=s.filter(p=>/^[+-](?![-+]{2})/.test(p)).length,i=s.filter(
p=>/^\+(?!\+\+ )/.test(p)).length,c=s.filter(p=>/^-(?!-- )/.test(p)).length,u=s.filter(p=>/^ /.test(p)).length;return a>=
3&&i>=1&&c>=1&&u>=1}function Ou(e){let t=e.match(/^\+\+\+[ \t]+(?:[ab]\/)?(.+?)(?:\t.*)?$/m);if(t){let s=t[1].trim();if(s&&
s!=="/dev/null")return s}let n=e.match(/^---[ \t]+(?:[ab]\/)?(.+?)(?:\t.*)?$/m);if(n){let s=n[1].trim();if(s&&s!=="/dev/\
null")return s}return null}var Lu=300;function Af(e,t){if(e.length>Lu||t.length>Lu)return null;let n=e.length,s=t.length,
a=Array.from({length:n+1},()=>new Int32Array(s+1));for(let p=1;p<=n;p++)for(let b=1;b<=s;b++)a[p][b]=e[p-1]===t[b-1]?a[p-
1][b-1]+1:Math.max(a[p-1][b],a[p][b-1]);let i=[],c=n,u=s;for(;c>0||u>0;)c>0&&u>0&&e[c-1]===t[u-1]?(i.unshift({type:"eq"}),
c--,u--):u>0&&(c===0||a[c][u-1]>=a[c-1][u])?(i.unshift({type:"ins"}),u--):(i.unshift({type:"del"}),c--);return i}function Rf(e){
let t=[],n=0,s=null;for(let a of e)a.type==="del"?(s===null&&(s=n),n++):a.type==="eq"&&(s!==null&&(t.push({start:s,end:n}),
s=null),n++);return s!==null&&t.push({start:s,end:n}),t}function Mf(e){let t=[],n=0,s=null;for(let a of e)a.type==="ins"?
(s===null&&(s=n),n++):a.type==="eq"&&(s!==null&&(t.push({start:s,end:n}),s=null),n++);return s!==null&&t.push({start:s,end:n}),
t}function Pu(e,t,n){if(!t||!t.length)return e;let s="",a=0,i=0,c=!1,u=0;for(;u<e.length;)if(e[u]==="<"){c&&(s+="</mark>",
c=!1);let p=e.indexOf(">",u);if(p===-1){s+=e[u++];continue}s+=e.slice(u,p+1),u=p+1,i<t.length&&a>=t[i].start&&a<t[i].end&&
(s+=`<mark class="${n}">`,c=!0)}else{if(c&&a>=t[i].end&&(s+="</mark>",c=!1,i++),!c&&i<t.length&&a>=t[i].start&&(s+=`<mar\
k class="${n}">`,c=!0),e[u]==="&"){let p=e.indexOf(";",u+1),b=p!==-1&&p-u<=8?p+1:u+1;s+=e.slice(u,b),u=b}else s+=e[u++];
a++}return c&&(s+="</mark>"),s}function Iu(e){let t=Du(e);return t.length>0&&t[t.length-1].trim()===""&&t.pop(),t.map((n,s)=>`\
<span class="code-line"><span class="code-line-num">${s+1}</span>${n}</span>`).join("")}var Tf=/[A-Za-z]:\\[^\n"'`<>]+?\.[A-Za-z0-9._-]+(?:\s+\((?:Lines?|Line)\s+\d+(?:-\d+)?\))?|(?:\.{1,2}[\\/])?(?:[A-Za-z0-9_.-]+[\\/])+[A-Za-z0-9_.-]+\.[A-Za-z0-9._-]+(?:\s+\((?:Lines?|Line)\s+\d+(?:-\d+)?\))?/g;
function $f(e){let t=String(e||""),n="",s=0;for(let a of t.matchAll(Tf)){let i=a[0],c=a.index||0,u=c+i.length,p=c>0?t[c-
1]:"",b=u<t.length?t[u]:"",y=(!p||/[\s([{"'`]/.test(p))&&(!b||/[\s)\]},"'`:;]/.test(b)),S=i.trim();!y||!Va(S)||(n+=Pe(t.
slice(s,c)),n+=`<button class="inline-file-ref tool-open-file" type="button" title="Open file preview" data-open-path="${Zt(
S)}" data-copy-path="${Zt(S)}">${Pe(S)}</button>`,s=u)}return n+=Pe(t.slice(s)),n||"&nbsp;"}function Ef(e){let t=String(
e||"").replace(/\r\n/g,`
`).split(`
`);return t.length>0&&t[t.length-1]===""&&t.pop(),t.map((n,s)=>`<span class="code-line"><span class="code-line-num">${s+
1}</span>${$f(n)}</span>`).join("")}function wc(e,t){return`<span class="diff-gutter"><span class="diff-gutter-num diff-\
gutter-old">${e??""}</span><span class="diff-gutter-num diff-gutter-new">${t??""}</span></span>`}function Ga(e){return`<\
span class="diff-gutter"><span class="diff-gutter-num">${e??""}</span></span>`}function Lf(e){let t=0,n=0;for(let s of e)
if(s.type==="hunk"){let a=s.raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);a&&(t=parseInt(a[1],10)-1,n=parseInt(a[2],
10)-1),s.oldLine=null,s.newLine=null}else s.type==="add"?(s.oldLine=null,s.newLine=++n):s.type==="del"?(s.oldLine=++t,s.
newLine=null):s.type==="ctx"?(s.oldLine=++t,s.newLine=++n):(s.oldLine=null,s.newLine=null)}function Pf(e,t,n){let s=[],a=u=>n.
has(u)?n.get(u):t&&t[u]!=null?t[u]:Pe(e[u].raw.startsWith("+")||e[u].raw.startsWith("-")||e[u].raw.startsWith(" ")?e[u].
raw.slice(1):e[u].raw),i=u=>t&&t[u]!=null?" diff-hl":"",c=0;for(;c<e.length;){let u=e[c];if(u.type==="meta"){let N=`<spa\
n class="diff-meta">${Pe(u.raw)}</span>`;s.push({type:"both",html:N}),c++;continue}if(u.type==="hunk"){let N=`<span clas\
s="diff-hunk">${Pe(u.raw)}</span>`;s.push({type:"both",html:N}),c++;continue}if(u.type==="ctx"){s.push({type:"ctx",content:a(
c),hlCls:i(c),oldLine:u.oldLine,newLine:u.newLine}),c++;continue}let p=c;for(;p<e.length&&e[p].type==="del";)p++;let b=p;
for(;b<e.length&&e[b].type==="add";)b++;let y=p-c,S=b-p,A=Math.min(y,S);for(let N=0;N<A;N++)s.push({type:"pair",delContent:a(
c+N),delHlCls:i(c+N),addContent:a(p+N),addHlCls:i(p+N),delOldLine:e[c+N].oldLine,addNewLine:e[p+N].newLine});for(let N=A;N<
y;N++)s.push({type:"del",content:a(c+N),hlCls:i(c+N),oldLine:e[c+N].oldLine});for(let N=A;N<S;N++)s.push({type:"add",content:a(
p+N),hlCls:i(p+N),newLine:e[p+N].newLine});c=b>c?b:c+1}return s}function qf(e){let t=[],n=[];for(let s of e)s.type==="bo\
th"?(t.push(s.html),n.push(s.html)):s.type==="ctx"?(t.push(`<span class="diff-ctx${s.hlCls}">${Ga(s.oldLine)}${s.content}\
</span>`),n.push(`<span class="diff-ctx${s.hlCls}">${Ga(s.newLine)}${s.content}</span>`)):s.type==="pair"?(t.push(`<span\
 class="diff-del${s.delHlCls}">${Ga(s.delOldLine)}${s.delContent}</span>`),n.push(`<span class="diff-add${s.addHlCls}">${Ga(
s.addNewLine)}${s.addContent}</span>`)):s.type==="del"?(t.push(`<span class="diff-del${s.hlCls}">${Ga(s.oldLine)}${s.content}\
</span>`),n.push('<span class="diff-empty"></span>')):s.type==="add"&&(t.push('<span class="diff-empty"></span>'),n.push(
`<span class="diff-add${s.hlCls}">${Ga(s.newLine)}${s.content}</span>`));return`<div class="diff-split"><div class="diff\
-split-col diff-split-old"><code class="hljs diff-code">${t.join("")}</code></div><div class="diff-split-col diff-split-\
new"><code class="hljs diff-code">${n.join("")}</code></div></div>`}function Du(e){let t=[],n="",s=[],a=0;for(;a<e.length;)
if(e[a]===`
`)t.push(n+"</span>".repeat(s.length)),n=s.map(i=>`<span class="${i}">`).join(""),a++;else if(e[a]==="<")if(e.startsWith(
"</span>",a))s.pop(),n+="</span>",a+=7;else if(e.startsWith("<span",a)){let i=e.indexOf(">",a);if(i===-1){n+=e[a++];continue}
let c=e.slice(a,i+1),u=c.match(/class="([^"]*)"/);s.push(u?u[1]:""),n+=c,a=i+1}else n+=e[a++];else n+=e[a++];return(n||s.
length)&&t.push(n+"</span>".repeat(s.length)),t}function ju(e,t){let n=(()=>{if(!t||typeof hljs>"u")return null;if(hljs.
getLanguage(t))return t;let d=t.split(".").pop().toLowerCase();return hljs.getLanguage(d)?d:null})(),a=e.split(`
`).map(d=>/^\+\+\+|^---/.test(d)?{type:"meta",raw:d}:/^@@/.test(d)?{type:"hunk",raw:d}:d.startsWith("+")?{type:"add",raw:d}:
d.startsWith("-")?{type:"del",raw:d}:{type:"ctx",raw:d});Lf(a);let i=null;if(n)try{let d=a.map(g=>g.type==="meta"||g.type===
"hunk"?"":g.raw.startsWith("+")||g.raw.startsWith("-")||g.raw.startsWith(" ")?g.raw.slice(1):g.raw),v=hljs.highlight(d.join(
`
`),{language:n});i=Du(v.value)}catch{i=null}let c=new Map;for(let d=0;d<a.length;){if(a[d].type!=="del"){d++;continue}let v=d;
for(;v<a.length&&a[v].type==="del";)v++;let g=v;for(;g<a.length&&a[g].type==="add";)g++;let _=v-d,k=g-v;if(_===k&&_>0)for(let T=0;T<
_;T++){let L=d+T,H=v+T,V=a[L].raw.slice(1),ne=a[H].raw.slice(1),ee=Af(V,ne);if(!ee)continue;let re=ee.filter(Y=>Y.type===
"eq").length,z=Math.max(V.length,ne.length);if(z>0&&re/z<.15)continue;let oe=i&&i[L]!=null?i[L]:Pe(V),_e=i&&i[H]!=null?i[H]:
Pe(ne);c.set(L,Pu(oe,Rf(ee),"diff-word-del")),c.set(H,Pu(_e,Mf(ee),"diff-word-add"))}d=g>d?g:d+1}let u=0,p=0,b=0,y=!1,S=a.
map((d,v)=>{if(d.type==="meta")return`<span class="diff-meta">${Pe(d.raw)}</span>`;if(d.type==="hunk")return y=!0,b++,`<\
span class="diff-hunk diff-hunk-btn" data-hunk-id="${b}" role="button" tabindex="0" title="Toggle context lines">${Pe(d.
raw)}</span>`;let g=d.raw.startsWith("+")||d.raw.startsWith("-")||d.raw.startsWith(" ")?d.raw.slice(1):d.raw,_=c.has(v)?
c.get(v):i&&i[v]!=null?i[v]:Pe(g),k=i&&i[v]!=null?" diff-hl":"",T=b>0?` data-hunk-ctx="${b}"`:"";return d.type==="add"?(u++,
`<span class="diff-add${k}"${T}>${wc(null,d.newLine)}${_}</span>`):d.type==="del"?(p++,`<span class="diff-del${k}"${T}>${wc(
d.oldLine,null)}${_}</span>`):`<span class="diff-ctx${k}"${T}>${wc(d.oldLine,d.newLine)}${_}</span>`}),A=u||p?`<span cla\
ss="diff-stat-add">+${u}</span><span class="diff-stat-del">-${p}</span>`:"",N=Pf(a,i,c),h=qf(N);return{body:S.join(""),stats:A,
splitHtml:h,hasHunks:y}}var Bu='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke\
-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3"/><path d="M1\
6 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3"/><line x1="12" y1="3" x2="12" y2="21"/></svg>',Of='<svg width="14" height="14" \
viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><c\
ircle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',If='<svg class="copy-icon" width="14" \
height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoi\
n="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9\
a2 2 0 0 1 2 2v1"></path></svg>',Df='<svg class="check-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stro\
ke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:none"><polyline point\
s="20 6 9 17 4 12"></polyline></svg>';var Fu=new marked.Renderer;Fu.code=function(e,t){let n=typeof e=="object"?e.text||e.raw||"":e||"",a=(typeof e=="object"?
e.lang||"":t||"").split(/\s/)[0].toLowerCase()||"text",i=a==="diff"||a==="patch"||Sc(n),c=!i&&(a==="text"||a==="markdown"),
u,p="",b="",y="",S=null;if(i){b=Ou(n)||"";let H=b?za(b):null;S=ju(n,H),u=S.body,p=S.stats,y=S.splitHtml||""}else if(c)u=
Ef(n);else try{u=hljs.getLanguage(a)?hljs.highlight(n,{language:a}).value:hljs.highlightAuto(n).value}catch{u=Pe(n)}let A=n;
!i&&!c&&(u=Iu(u));let N=i||a==="text"?"":a,h=b?`<button class="diff-filepath" title="Open file preview" data-copy-path="${Zt(
b)}" data-open-path="${Zt(b)}">${Pe(b)}</button>`:"",d=y?`<button class="diff-split-toggle" title="Toggle side-by-side v\
iew">${Bu}</button>`:"",v=i&&S&&S.hasHunks?'<button class="diff-ctx-collapse-all" title="Collapse/expand all context lin\
es">Context</button>':"",g=!1,_="",k=typeof localStorage<"u"&&localStorage.getItem("codeblock_wrap_pref")==="1",T=`<butt\
on class="code-wrap-toggle${k?" active":""}" title="${k?"Disable word wrap":"Enable word wrap"}">${k?"No Wrap":"Wrap"}</\
button>`,L=i?"":` data-raw="${Zt(A)}"`;return`<div class="code-block${i?" diff-block":""}${g?" code-collapsible":""}${k?
" code-wrap":""}" data-diff-mode="unified">
    <div class="code-header">
      <span class="code-lang">${N}</span>
      ${h}
      <span class="diff-stats">${p}</span>
      ${v}
      ${d}
      ${_}
      ${T}
      <button class="code-search-btn" title="Search in block">${Of}</button>
      <button class="code-copy" title="Copy code">${If}${Df}<span class="copy-label">Copy</span></button>
    </div>
    <div class="code-search-bar" hidden>
      <input class="code-search-input" type="text" placeholder="Search\u2026" aria-label="Search in code block">
      <span class="code-search-count"></span>
      <button class="code-search-prev" title="Previous match">&#8593;</button>
      <button class="code-search-next" title="Next match">&#8595;</button>
      <button class="code-search-close" title="Close search">&#10005;</button>
    </div>
    <pre><code class="hljs${i?" diff-code":""}"${L}>${u}</code></pre>
    ${y}
  </div>`};marked.use({renderer:Fu,breaks:!0,gfm:!0});function jf(e,t){let n=(e||"").toLowerCase();if(n==="bash"||n==="r\
un"||n==="execute"||n==="shell"){let a=t.find(i=>i.trim());return a?a.trim().substring(0,80):""}let s=t.find(a=>a.trim());
return s&&Va(s.trim())?s.trim():s?s.trim().substring(0,60):""}function Bf(e,t,n){let s=String(t||"").replace(/\n+$/,"").
split(`
`),a=s.find(re=>re.trim()),i=a&&Va(a.trim())?a.trim():"",c=(re,z="")=>{let oe=String(re||"").trim();if(!oe)return"";let _e=[
"tool-path",z,Va(oe)?"tool-open-file":""].filter(Boolean).join(" ");return Va(oe)?`<button class="${_e}" type="button" t\
itle="Open file preview" data-open-path="${Zt(oe)}" data-copy-path="${Zt(oe)}">${Pe(oe)}</button>`:`<span class="${_e}">${Pe(
oe)}</span>`},u=s.filter((re,z,oe)=>!(z===oe.length-1&&oe[z]==="")).length,p=/^\d+\s+lines?(?:\s+of\s+output)?$/i.test(e.
trim()),b=s.some(re=>re.trim()),y=p&&u===0||!b,A=/^Bash\b/i.test(e.trim())&&s.every(re=>{let z=re.trim();return!z||/^\$\s+/.
test(z)}),N=!b,h=s.join(`
`),d=Nf(t),v=Sc(t)||Sf(e)&&(d.adds||d.dels),g=v&&Ou(t)||i,_=v&&g?za(g):null,k=(()=>{if(!v)return h;let re=h,z=re.match(/```(?:diff|patch)?\s*\n([\s\S]*?)```\s*$/m);
z&&(re=z[1]);let oe=re.split(`
`),_e=0;for(;_e<oe.length;){let Y=oe[_e];if(Y.startsWith("+")||Y.startsWith("-")||Y.startsWith("@@")||Y.startsWith(" "))
break;_e++}return oe.slice(_e).join(`
`)})(),T=v&&Cf(k),L=T?ju(k,_):null,H=d.adds||d.dels?`<span class="tool-stat-add">+${d.adds}</span><span class="tool-stat\
-del">-${d.dels}</span>`:"",V=v?(()=>{for(let re of s){let z=re.trim();if(z&&!z.startsWith("```")&&!z.startsWith("+")&&!z.
startsWith("-")&&!z.startsWith("@@")&&!z.startsWith(" "))return z}return""})():"",ne=N&&!g?V||jf(e,s):V||"",ee=!y&&(T||!v);
return`<section class="tool-section${N?" collapsed":""}" data-tool-index="${n}">
    <button class="tool-toggle" type="button" aria-expanded="${N?"false":"true"}">
      <span class="tool-chevron">${ee?N?"\u25B8":"\u25BE":""}</span>
      <span class="tool-dot ${xf(e)}">\u25CF</span>
      <span class="tool-toggle-main">
        ${(()=>{let re=e.indexOf(" ");if(re>0){let z=e.substring(0,re),oe=e.substring(re+1).trim();return`<span class="t\
ool-name">${Pe(z)}</span>${c(oe)}`}return`<span class="tool-name">${Pe(e)}</span>`})()}
        ${g?c(g,"tool-path-secondary"):""}
        ${ne?`<span class="tool-preview">${Pe(ne)}</span>`:""}
      </span>
      <span class="tool-toggle-side">
        ${H}
        ${p&&u>0?`<span class="tool-line-count">${u} lines</span>`:""}
      </span>
    </button>
    ${ee?`<div class="tool-body"${N?" hidden":""}>
      ${T?`<div class="code-block diff-block tool-diff-block" data-diff-mode="unified">
            <div class="code-header">
              <span class="code-lang"></span>
              ${g?`<button class="diff-filepath" title="Open file preview" data-copy-path="${Zt(g)}" data-open-path="${Zt(
g)}">${Pe(g)}</button>`:""}
              <span class="diff-stats">${L?.stats||""}</span>
              ${L?.hasHunks?'<button class="diff-ctx-collapse-all" title="Collapse/expand all context lines">Context</bu\
tton>':""}
              ${L?.splitHtml?`<button class="diff-split-toggle" title="Toggle side-by-side view">${Bu}</button>`:""}
            </div>
            <pre><code class="hljs diff-code">${L?.body||""}</code></pre>
            ${L?.splitHtml||""}
          </div>`:(()=>{let re=Hu(h);if(re)return Uu(re,n+"_b");let z=h.trim();return z.startsWith("```")?`<div class="t\
ool-body-md">${marked.parse(z)}</div>`:`<pre class="tool-body-pre"><code>${Pe(h)}</code></pre>`})()}
    </div>`:""}
  </section>`}var Ff=/^IN\n\n?```([^\n]*)\n([\s\S]*?)\n```\n\n?OUT(?:\n\n?```([^\n]*)\n([\s\S]*?)\n```)?[\s]*$/,Hf=/^IN\n([\s\S]*?)(?:\nOUT\n([\s\S]*))?$/;
function Hu(e){if(!e)return null;let t=e.replace(/\r\n/g,`
`);if(!t.startsWith(`IN
`))return null;let n=t.match(Ff);if(n)return{inLang:n[1]||"",inText:n[2]||"",outLang:n[3]||"",outText:n[4]||""};let s=t.
match(Hf);return s?{inLang:"",inText:(s[1]||"").trim(),outLang:"",outText:(s[2]||"").trim()}:null}function Uu(e,t){let n=(e.
inText||"").trimEnd().split(`
`),s=(e.outText||"").trimEnd().split(`
`),a=(c,u)=>{let p=Pe(u.join(`
`)),b=u.length===0||u.length===1&&!u[0].trim()?'<span class="tool-io-empty">(no output)</span>':"";return`<div class="to\
ol-io-row">
      <span class="tool-io-label">${c}</span>
      <div class="tool-io-content">${b||`<code class="tool-io-code">${p}</code>`}</div>
    </div>`},i=s.length===0||s.length===1&&!s[0].trim();return`<div class="tool-io-block" data-tool-index="${t}">${a("IN",
n)}${i?"":a("OUT",s)}</div>`}function Uf(e){let t=String(e||"").replace(/\r\n/g,`
`);if(!t.trim())return null;let n=t.split(`
`),s=/^\s*(\d+)\s+file(?:\(s\)|s?)\s+changed(?:\s+in\s+this\s+conversation)?/i,a=n.findIndex(g=>s.test(g));if(a===-1)return null;
let i=n[a].trim(),c=i.match(s);if(!c)return null;let u=g=>{let _=String(g||"").match(/\+(\d+)\s+(?:\u00c2\u00b7|·|-|\s)\s*-?(\d+)/);
return _?{adds:Number(_[1])||0,dels:Number(_[2])||0}:null},p=u(i),b=null,y=[],S="",A=a;for(let g=a+1;g<n.length;g++){let _=n[g].
trim();if(!_)continue;if(!p){let ne=u(_);if(ne){p=ne,A=g;continue}}let k=_.match(/^\+(\d+)$/);if(k){b=Number(k[1])||0,A=
g;continue}let T=_.match(/^-(\d+)$/);if(T&&b!=null&&!p){p={adds:b,dels:Number(T[1])||0},b=null,A=g;continue}let L=_.match(
/^\+(\d+)\s+(?:\u00c2\u00b7|·|-|\s)\s*-?(\d+)$/);if(L&&S){y.push({filepath:S,adds:Number(L[1])||0,dels:Number(L[2])||0}),
S="",A=g;continue}let H=_.match(/^(.+?)\s+\+(\d+)\s+(?:\u00c2\u00b7|·|-|\s)\s*-?(\d+)(?:\s+.*)?$/);if(!H){if(Va(_)){S=_,
A=g;continue}break}let V=H[1].trim();if(!V||/^\+?\d+$/.test(V))break;y.push({filepath:V,adds:Number(H[2])||0,dels:Number(
H[3])||0}),S="",A=g}if(y.length===0)return null;let N=p?.adds??y.reduce((g,_)=>g+_.adds,0),h=p?.dels??y.reduce((g,_)=>g+
_.dels,0),d=n.slice(0,a).join(`
`).replace(/\s+$/g,""),v=n.slice(A+1).join(`
`).replace(/^\s+/g,"");return{count:Number(c[1])||y.length,title:i.replace(/\s+\+\d+.*$/,"").trim(),adds:N,dels:h,entries:y,
beforeText:d,afterText:v}}function Wf(e,t){let n=e.entries.map(s=>`<div class="file-changes-item">
      <span class="file-changes-path">${Pe(s.filepath)}</span>
      <span class="file-changes-stats"><span class="diff-stat-add">+${s.adds}</span><span class="diff-stat-del">-${s.dels}\
</span></span>
    </div>`).join("");return`<section class="file-changes-section" data-file-changes-index="${t}">
    <button class="file-changes-toggle" type="button" aria-expanded="true">
      <span class="file-changes-chevron">v</span>
      <span class="file-changes-icon">files</span>
      <span class="file-changes-title">${Pe(e.title||`${e.count} file(s) changed`)}</span>
      <span class="file-changes-summary">
        <span class="diff-stat-add">+${e.adds}</span>
        <span class="diff-stat-del">-${e.dels}</span>
      </span>
    </button>
    ${e.entries.length?`<div class="file-changes-list">${n}</div>`:""}
  </section>`}function zf(e,t){let n;try{n=JSON.parse(e)}catch{return null}if(!n||!Array.isArray(n.items)||!n.items.length)
return null;let s=n.title||"Subagents",a=n.items.map((i,c)=>{let u=String(i.status||"unknown").toLowerCase(),p=u==="runn\
ing"?'<span class="subagent-spinner" aria-hidden="true"></span>':u==="done"?'<span class="subagent-icon subagent-icon-do\
ne" aria-hidden="true">&#10003;</span>':u==="failed"?'<span class="subagent-icon subagent-icon-fail" aria-hidden="true">\
&#10007;</span>':'<span class="subagent-icon subagent-icon-unknown" aria-hidden="true">&#9679;</span>',b=String(i.prompt||
"").trim(),y=String(i.stats||"").trim(),S=Array.isArray(i.tool_calls)?i.tool_calls.filter(Boolean):[],A=S.length?`<ul cl\
ass="subagent-calls">${S.map(N=>`<li><code>${Pe(N)}</code></li>`).join("")}</ul>`:"";return`<li class="subagent-item sub\
agent-status-${Pe(u)}">
      <div class="subagent-row">${p}<div class="subagent-prompt" title="${Pe(b)}">${Pe(b)}</div></div>
      ${y?`<div class="subagent-stats">${Pe(y)}</div>`:""}
      ${A}
    </li>`}).join("");return`<section class="subagents-section" data-subagents-index="${t}">
    <div class="subagents-header"><span class="subagents-icon" aria-hidden="true">&#9783;</span><span class="subagents-t\
itle">${Pe(s)}</span></div>
    <ul class="subagents-list">${a}</ul>
  </section>`}function Gf(e){let t=String(e||"").match(/^Task Completed\s*\n+([\s\S]*?)\s*$/);return t?{content:t[1].replace(
/HAS_CHANGES\s*$/i,"").trimEnd(),wrap:!0}:{content:e,wrap:!1}}function Kf(e){return`<section class="task-completed-secti\
on">
    <div class="task-completed-header">
      <span class="task-completed-icon" aria-hidden="true">&#10003;</span>
      <span class="task-completed-title">Task Completed</span>
    </div>
    <div class="task-completed-body">${e}</div>
  </section>`}function Vf(e){let t=[],n=/^~~~subagents\s*\n([\s\S]*?)\n~~~\s*$/gm;return{content:String(e||"").replace(n,
(a,i)=>{let c=zf(i,t.length)||"";return t.push(c),`\0SUBAGENTS_BLOCK_${t.length-1}\0`}),blocks:t}}function Yf(e){let{content:t,
wrap:n}=Gf(e);e=t;let{content:s,blocks:a}=Vf(e);e=s;let c=qu(e).map((y,S)=>{try{if(y.type==="tool")return Bf(y.name,y.content,
S);let A=Hu(y.content);if(A)return Uu(A,S);let N=Uf(y.content);if(N){let h=Wf(N,S),d=(N.beforeText||"").trim()?marked.parse(
N.beforeText):"",v=(N.afterText||"").trim()?marked.parse(N.afterText):"";return d+h+v}return(y.content||"").trim()?marked.
parse(y.content||""):""}catch(A){return'<pre style="color:var(--red,#f26d78);font-size:11px">[render error: '+Pe(String(
A))+"]</pre><pre>"+Pe(y.content||"")+"</pre>"}}).join("");a.length&&(c=c.replace(/\s*SUBAGENTS_BLOCK_(\d+)\s*/g,(y,S)=>a[Number(
S)]||""));let u=document.createElement("div");typeof DOMPurify<"u"?u.innerHTML=DOMPurify.sanitize(c,{ADD_DATA_URI_TAGS:[
"img"],ALLOW_DATA_ATTR:!0}):u.textContent=c;let b=Array.from(u.querySelectorAll(".diff-block")).map((y,S)=>{let A=y.querySelector(
".diff-filepath");if(!A)return null;let N=A.textContent.trim();if(!N)return null;let h=y.querySelector(".diff-stat-add, \
.tool-stat-add"),d=y.querySelector(".diff-stat-del, .tool-stat-del"),v=h&&parseInt(h.textContent,10)||0,g=d&&parseInt(d.
textContent,10)||0;return y.id=`diff-file-${S}`,{filepath:N,adds:v,dels:g,id:`diff-file-${S}`}}).filter(Boolean);if(b.length>=
2){let y=b.reduce((d,v)=>d+v.adds,0),S=b.reduce((d,v)=>d+v.dels,0),A=b.map(d=>{let v=d.filepath.split(/[/\\]/).pop();return`\
<a class="diff-summary-chip" data-target="${Zt(d.id)}" href="#${Zt(d.id)}" title="${Zt(d.filepath)}"><span class="diff-s\
ummary-name">${Pe(v)}</span><span class="diff-stat-add">+${d.adds}</span><span class="diff-stat-del">-${d.dels}</span></\
a>`}).join(""),N=`<span class="diff-summary-totals"><span class="diff-summary-count">${b.length} files</span><span class\
="diff-stat-add">+${y}</span><span class="diff-stat-del">-${S}</span></span>`,h=document.createElement("div");h.className=
"diff-summary-bar",h.innerHTML=A+N,u.insertBefore(h,u.firstChild)}return n?Kf(u.innerHTML):u.innerHTML}function Xf(e){let t=[],
n=0,s=document.createTreeWalker(e,NodeFilter.SHOW_TEXT,null),a;for(;a=s.nextNode();){if(a.parentElement&&a.parentElement.
classList.contains("code-line-num"))continue;let i=a.nodeValue.length;t.push({node:a,start:n,end:n+i}),n+=i}return{text:t.
map(i=>i.node.nodeValue).join(""),ranges:t}}function zo(e){if(!e)return;let t=e.querySelector("code");if(!t)return;t.querySelectorAll(
"mark.code-search-mark").forEach(s=>{let a=s.parentNode;a&&(a.replaceChild(document.createTextNode(s.textContent),s),a.normalize())});
let n=e.querySelector(".code-search-count");n&&(n.textContent=""),delete e._searchState}function Qf(e){if(!e)return;zo(e);
let t=e.querySelector(".code-search-input"),n=t?t.value:"";if(!n)return;let s=e.querySelector("code");if(!s)return;let{text:a,
ranges:i}=Xf(s),c=a.toLowerCase(),u=n.toLowerCase(),p=[],b=0;for(;b<a.length;){let A=c.indexOf(u,b);if(A===-1)break;p.push(
A),b=A+n.length}if(!p.length){let A=e.querySelector(".code-search-count");A&&(A.textContent="0 / 0");return}let y=[];for(let A=p.
length-1;A>=0;A--){let N=p[A],h=N+n.length,d=i.filter(v=>v.end>N&&v.start<h);for(let v=d.length-1;v>=0;v--){let g=d[v],_=Math.
max(0,N-g.start),k=Math.min(g.node.nodeValue.length,h-g.start),T=g.node,L=T.nodeValue,H=document.createElement("mark");H.
className="code-search-mark",H.textContent=L.slice(_,k);let V=T.parentNode;k<L.length&&V.insertBefore(document.createTextNode(
L.slice(k)),T.nextSibling),V.insertBefore(H,k<L.length?T.nextSibling.previousSibling:T.nextSibling),_>0?T.nodeValue=L.slice(
0,_):V.removeChild(T),y.unshift(H)}}e._searchState={marks:y,current:0};let S=e.querySelector(".code-search-count");S&&(S.
textContent=y.length?`1 / ${y.length}`:"0 / 0"),y.length&&(y[0].classList.add("current"),y[0].scrollIntoView({block:"nea\
rest"}))}function Wo(e,t){if(!e||!e._searchState)return;let{marks:n}=e._searchState;if(!n.length)return;n[e._searchState.
current].classList.remove("current"),e._searchState.current=(e._searchState.current+t+n.length)%n.length;let s=n[e._searchState.
current];s.classList.add("current"),s.scrollIntoView({block:"nearest"});let a=e.querySelector(".code-search-count");a&&(a.
textContent=`${e._searchState.current+1} / ${n.length}`)}function Jf(e){let t=[],n=0;for(;n<e.length;)(n===0||e[n-1]===`\

`)&&e[n]==="`"&&e[n+1]==="`"&&e[n+2]==="`"?(t.push(n),n+=3):n++;if(t.length%2===0)return null;let s=t[t.length-1],a=e.slice(
s+3),i=a.indexOf(`
`);if(i===-1)return{lang:"text",code:""};let u=a.slice(0,i).trim().split(/\s/)[0].toLowerCase()||"text",p=a.slice(i+1);return{
lang:u,code:p}}var Ka=new Map,Br=null,Es=new Map,Nc=0,Zf=256,eg=8*1024*1024;function tg(e){let t=String(e||""),n=2166136261;
for(let s=0;s<t.length;s+=1)n^=t.charCodeAt(s),n=Math.imul(n,16777619);return(n>>>0).toString(36)}function ng(e,t){let n=e?.
closest?.(".message")||e;if(!n||typeof IntersectionObserver>"u")return t(),()=>{};Br||(Br=new IntersectionObserver(a=>{for(let i of a){
if(!i.isIntersecting)continue;let c=Ka.get(i.target);if(c){Ka.delete(i.target),Br.unobserve(i.target);for(let u of c)u()}}},
{root:null,rootMargin:"35% 0px",threshold:0}));let s=Ka.get(n);return s||(s=new Set,Ka.set(n,s),Br.observe(n)),s.add(t),
()=>{let a=Ka.get(n);a&&(a.delete(t),!(a.size>0)&&(Ka.delete(n),Br?.unobserve(n)))}}function sg(e,t){let n=String(e||""),
s=`${t||"content"}${n.length}${tg(n)}`,a=Es.get(s);if(a&&a.content===n)return Es.delete(s),Es.set(s,a),a.html;let i=Yf(
n),c=typeof DOMPurify<"u"?DOMPurify.sanitize(i,{ADD_DATA_URI_TAGS:["img"],ALLOW_DATA_ATTR:!0}):i,u=(n.length+c.length)*2;
for(Es.set(s,{content:n,html:c,bytes:u}),Nc+=u;Es.size>Zf||Nc>eg;){let p=Es.keys().next().value,b=Es.get(p);Es.delete(p),
Nc-=b?.bytes||0}return c}function Ya({content:e,monospace:t=!1,onOpenPath:n=null,autoExpandLongCodeBlocks:s=!1,deferUntilVisible:a=!1,
cacheIdentity:i=""}){let c=React.useRef(null),u=React.useRef(null),p=React.useRef(n),[b,y]=React.useState(!a);return p.current=
n,React.useEffect(()=>{if(!a){y(!0);return}if(!b)return ng(c.current,()=>y(!0))},[a,b]),React.useEffect(()=>{if(!c.current||
!b||e===u.current)return;let S=u.current;if(S!==null&&e.startsWith(S)){let d=Jf(e);if(d&&!Sc(d.code)){let v=c.current.querySelectorAll(
".code-block:not(.diff-block)"),_=(v.length>0?v[v.length-1]:null)?.querySelector(":scope > pre"),k=_?.querySelector("cod\
e");if(k){let T=_.scrollTop,L;try{L=typeof hljs<"u"&&hljs.getLanguage(d.lang)?hljs.highlight(d.code,{language:d.lang}).value:
Pe(d.code)}catch{L=Pe(d.code)}k.innerHTML=Iu(L),k.dataset.raw=d.code,_.scrollTop=T,u.current=e;return}}}let A={toolCollapsed:{},
fileChangesCollapsed:{},codeScroll:[],ctxHidden:{},ctxCollapseActive:{}};u.current!==null&&(c.current.querySelectorAll("\
.tool-section[data-tool-index]").forEach(d=>{A.toolCollapsed[d.dataset.toolIndex]=d.classList.contains("collapsed")}),c.
current.querySelectorAll(".file-changes-section[data-file-changes-index]").forEach(d=>{A.fileChangesCollapsed[d.dataset.
fileChangesIndex]=d.classList.contains("collapsed")}),c.current.querySelectorAll(".code-block pre").forEach((d,v)=>{A.codeScroll[v]=
d.scrollTop}),c.current.querySelectorAll(".diff-block, .tool-diff-block").forEach((d,v)=>{d.querySelectorAll(".diff-hunk\
-btn").forEach(_=>{A.ctxHidden[`${v}:${_.dataset.hunkId}`]=_.classList.contains("diff-hunk-ctx-collapsed")});let g=d.querySelector(
".diff-ctx-collapse-all");g&&(A.ctxCollapseActive[v]=g.classList.contains("active"))})),u.current=e,c.current.innerHTML=
sg(e,i),c.current.querySelectorAll(".tool-section[data-tool-index]").forEach(d=>{let v=d.dataset.toolIndex;if(!(v in A.toolCollapsed))
return;let g=A.toolCollapsed[v],_=d.classList.contains("collapsed");if(g!==_){d.classList.toggle("collapsed",g);let k=d.
querySelector(".tool-body"),T=d.querySelector(".tool-chevron"),L=d.querySelector(".tool-toggle");k&&(k.hidden=g),T&&(T.textContent=
g?"\u25B8":"\u25BE"),L&&L.setAttribute("aria-expanded",g?"false":"true")}}),c.current.querySelectorAll(".file-changes-se\
ction[data-file-changes-index]").forEach(d=>{let v=d.dataset.fileChangesIndex;if(!(v in A.fileChangesCollapsed))return;let g=A.
fileChangesCollapsed[v],_=d.classList.contains("collapsed");if(g!==_){d.classList.toggle("collapsed",g);let k=d.querySelector(
".file-changes-list"),T=d.querySelector(".file-changes-chevron"),L=d.querySelector(".file-changes-toggle");k&&(k.hidden=
g),T&&(T.textContent=g?">":"v"),L&&L.setAttribute("aria-expanded",g?"false":"true")}}),c.current.querySelectorAll(".diff\
-block, .tool-diff-block").forEach((d,v)=>{let g=d.querySelector("code");if(g&&(d.querySelectorAll(".diff-hunk-btn").forEach(
_=>{let k=`${v}:${_.dataset.hunkId}`;!(k in A.ctxHidden)||!A.ctxHidden[k]||(g.querySelectorAll(`[data-hunk-ctx="${_.dataset.
hunkId}"].diff-ctx`).forEach(T=>T.classList.add("diff-ctx-hidden")),_.classList.add("diff-hunk-ctx-collapsed"))}),A.ctxCollapseActive[v])){
let _=d.querySelector(".diff-ctx-collapse-all");_&&_.classList.add("active")}}),c.current.querySelectorAll(".code-copy").
forEach(d=>{d.onclick=()=>{let v=d.closest(".code-block").querySelector("code"),g=v.dataset.raw!==void 0?v.dataset.raw:v.
textContent;navigator.clipboard.writeText(g).then(()=>{d.querySelector(".copy-icon").style.display="none",d.querySelector(
".check-icon").style.display="",d.querySelector(".copy-label").textContent="Copied",d.classList.add("copied"),setTimeout(
()=>{d.querySelector(".copy-icon").style.display="",d.querySelector(".check-icon").style.display="none",d.querySelector(
".copy-label").textContent="Copy",d.classList.remove("copied")},2e3)}).catch(()=>{})}}),c.current.querySelectorAll(".too\
l-toggle").forEach(d=>{d.onclick=()=>{let v=d.closest(".tool-section"),g=v?.querySelector(".tool-body"),_=d.querySelector(
".tool-chevron"),k=v.classList.toggle("collapsed");g&&(g.hidden=k),_&&(_.textContent=k?"\u25B8":"\u25BE"),d.setAttribute(
"aria-expanded",k?"false":"true")}}),c.current.querySelectorAll(".file-changes-toggle").forEach(d=>{d.onclick=()=>{let v=d.
closest(".file-changes-section"),g=v?.querySelector(".file-changes-list"),_=d.querySelector(".file-changes-chevron"),k=v.
classList.toggle("collapsed");g&&(g.hidden=k),_&&(_.textContent=k?">":"v"),d.setAttribute("aria-expanded",k?"false":"tru\
e")}}),c.current.querySelectorAll(".tool-io-more-btn").forEach(d=>{d.onclick=()=>{let v=d.closest(".tool-io-preview"),g=v?.
nextElementSibling;!v||!g||(v.hidden=!0,g.hidden=!1)}}),c.current.querySelectorAll(".tool-io-collapse-btn").forEach(d=>{
d.onclick=()=>{let v=d.closest(".tool-io-full"),g=v?.previousElementSibling;!v||!g||(v.hidden=!0,g.hidden=!1)}}),c.current.
querySelectorAll(".diff-summary-chip").forEach(d=>{d.onclick=v=>{v.preventDefault();let g=d.dataset.target,_=g&&c.current.
querySelector(`#${CSS.escape(g)}`);_&&(_.scrollIntoView({behavior:"smooth",block:"nearest"}),c.current.querySelectorAll(
".diff-summary-chip").forEach(k=>k.classList.remove("active")),d.classList.add("active"))}}),c.current.querySelectorAll(
".diff-split-toggle").forEach(d=>{d.onclick=()=>{let v=d.closest(".diff-block");if(!v)return;let g=v.querySelector(":sco\
pe > pre"),_=v.querySelector(".diff-split"),T=!(v.dataset.diffMode==="split");v.dataset.diffMode=T?"split":"unified",d.classList.
toggle("active",T),d.title=T?"Toggle unified view":"Toggle side-by-side view"}}),c.current.querySelectorAll(".diff-filep\
ath[data-copy-path], .tool-open-file[data-open-path], .inline-file-ref[data-open-path]").forEach(d=>{d.onclick=v=>{v.stopPropagation();
let g=d.dataset.openPath||d.dataset.copyPath,_=p.current;if(g&&typeof _=="function"){v.preventDefault(),_(g);return}d.dataset.
copyPath&&navigator.clipboard.writeText(g).then(()=>{let k=d.textContent;d.textContent="Copied!",d.classList.add("diff-f\
ilepath-copied"),setTimeout(()=>{d.textContent=k,d.classList.remove("diff-filepath-copied")},1500)}).catch(()=>{})}}),c.
current.querySelectorAll(".code-expand-toggle").forEach(d=>{d.onclick=()=>{let v=d.closest(".code-block");if(!v)return;let g=v.
classList.toggle("code-expanded");d.textContent=g?"Collapse":"Expand",d.title=g?"Collapse block":"Expand block",g||v.scrollIntoView(
{behavior:"smooth",block:"nearest"})}}),s&&c.current.querySelectorAll(".code-collapsible").forEach(d=>{d.classList.add("\
code-expanded");let v=d.querySelector(".code-expand-toggle");v&&(v.textContent="Collapse",v.title="Collapse block")}),c.
current.querySelectorAll(".code-wrap-toggle").forEach(d=>{d.onclick=()=>{let v=localStorage.getItem("codeblock_wrap_pref")!==
"1";localStorage.setItem("codeblock_wrap_pref",v?"1":"0"),c.current.querySelectorAll(".code-block").forEach(g=>{g.classList.
toggle("code-wrap",v);let _=g.querySelector(".code-wrap-toggle");_&&(_.textContent=v?"No Wrap":"Wrap",_.title=v?"Disable\
 word wrap":"Enable word wrap",_.classList.toggle("active",v))})}}),c.current.querySelectorAll(".code-search-btn").forEach(
d=>{d.onclick=()=>{let v=d.closest(".code-block");if(!v)return;let g=v.querySelector(".code-search-bar"),_=v.querySelector(
".code-search-input");if(!g)return;!g.hidden?(zo(v),g.hidden=!0,d.classList.remove("active")):(g.hidden=!1,d.classList.add(
"active"),_&&_.focus())}}),c.current.querySelectorAll(".code-search-input").forEach(d=>{d.oninput=()=>Qf(d.closest(".cod\
e-block")),d.onkeydown=v=>{let g=d.closest(".code-block");v.key==="Enter"&&(v.shiftKey?Wo(g,-1):Wo(g,1),v.preventDefault()),
v.key==="Escape"&&(zo(g),g.querySelector(".code-search-bar").hidden=!0,g.querySelector(".code-search-btn").classList.remove(
"active"))}}),c.current.querySelectorAll(".code-search-next").forEach(d=>{d.onclick=()=>Wo(d.closest(".code-block"),1)}),
c.current.querySelectorAll(".code-search-prev").forEach(d=>{d.onclick=()=>Wo(d.closest(".code-block"),-1)}),c.current.querySelectorAll(
".code-search-close").forEach(d=>{d.onclick=()=>{let v=d.closest(".code-block");zo(v),v.querySelector(".code-search-bar").
hidden=!0,v.querySelector(".code-search-btn").classList.remove("active")}}),c.current.querySelectorAll(".diff-hunk-btn").
forEach(d=>{d.onclick=v=>{v.stopPropagation();let g=d.dataset.hunkId,_=d.closest("code");if(!_)return;let k=_.querySelectorAll(
`[data-hunk-ctx="${g}"].diff-ctx`),T=k.length>0&&k[0].classList.contains("diff-ctx-hidden");k.forEach(L=>L.classList.toggle(
"diff-ctx-hidden",!T)),d.classList.toggle("diff-hunk-ctx-collapsed",!T)},d.onkeydown=v=>{(v.key==="Enter"||v.key===" ")&&
(v.preventDefault(),d.click())}}),c.current.querySelectorAll(".diff-ctx-collapse-all").forEach(d=>{d.onclick=()=>{let v=d.
closest(".diff-block, .tool-diff-block");if(!v)return;let g=v.querySelector("code");if(!g)return;let _=g.querySelectorAll(
".diff-ctx"),T=Array.from(_).some(L=>!L.classList.contains("diff-ctx-hidden"));_.forEach(L=>L.classList.toggle("diff-ctx\
-hidden",T)),g.querySelectorAll(".diff-hunk-btn").forEach(L=>L.classList.toggle("diff-hunk-ctx-collapsed",T)),d.classList.
toggle("active",T),d.title=T?"Expand all context lines":"Collapse all context lines"}}),c.current.querySelectorAll(".too\
l-show-all").forEach(d=>{d.onclick=()=>{let g=d.closest(".tool-body")?.querySelector("code"),_=d.closest(".tool-section");
if(!g||!_)return;let k=Number(_.dataset.toolIndex||"-1"),T=qu(e||"")[k];!T||T.type!=="tool"||(g.textContent=T.content||"",
d.remove())}}),A.codeScroll.length&&c.current.querySelectorAll(".code-block pre").forEach((d,v)=>{v<A.codeScroll.length&&
A.codeScroll[v]>0&&(d.scrollTop=A.codeScroll[v])});let N=null,h=c.current.querySelector(".diff-summary-bar");if(h&&typeof IntersectionObserver<
"u"){let d=Array.from(c.current.querySelectorAll(".diff-block[id]"));if(d.length>=2){let v=null,g=c.current.parentElement;
for(;g&&g!==document.body;){let k=window.getComputedStyle(g);if(k.overflowY==="auto"||k.overflowY==="scroll"||k.overflow===
"auto"||k.overflow==="scroll"){v=g;break}g=g.parentElement}let _=new IntersectionObserver(k=>{k.forEach(T=>{if(!T.isIntersecting)
return;let L=T.target.id;h.querySelectorAll(".diff-summary-chip").forEach(H=>{H.classList.toggle("active",H.dataset.target===
L)})})},{root:v,threshold:.1});d.forEach(k=>_.observe(k)),N=()=>_.disconnect()}}return()=>{N&&N()}},[e,s,i,b]),React.createElement(
"div",{className:`message-body${t?" monospace-body":""}`,ref:c,"data-rich-content-ready":b?"true":"false"})}function Cc(e,t=null,n=Date.now()){return{sessionId:e,messageId:null,blockIndex:0,seq:-1,content:"",open:!0,startedAtMs:n,
clientMessageId:t}}function Wu(e,t,n=!1){if(!e||String(e.content||"").length>0||n)return!1;let s=String(t?.kind||"idle").
toLowerCase();return["idle","waiting_for_user","completed","done","failed","error","interrupted"].includes(s)}function zu(e,t,n=Date.
now()){let s=t?.session_id||t?.session||"",a=t?.message_id||"",i=Number(t?.block_index),c=Number(t?.seq);return!s||!a||!Number.
isSafeInteger(i)||i<0||!Number.isSafeInteger(c)||c<0?{accepted:!1,code:"invalid_identity",stream:e||null}:t.op==="block_\
open"?c!==0?{accepted:!1,code:"invalid_open_sequence",stream:e||null}:{accepted:!0,stream:{...Cc(s,e?.clientMessageId||null,
e?.startedAtMs||n),messageId:a,blockIndex:i,seq:c}}:!e||e.messageId!==a||e.blockIndex!==i||!e.open?{accepted:!1,code:"st\
ream_not_open",stream:e||null}:c!==e.seq+1?{accepted:!1,code:"sequence_gap",stream:e}:t.op==="append"?typeof t.append!="\
string"||t.append.length===0?{accepted:!1,code:"invalid_append",stream:e}:{accepted:!0,stream:{...e,seq:c,content:`${e.content||
""}${t.append}`}}:t.op==="block_close"?{accepted:!0,stream:{...e,seq:c,open:!1}}:{accepted:!1,code:"invalid_operation",stream:e}}function In(e){if(e==null||e==="")return null;let t=null;if(typeof e=="number"||typeof e=="string"&&/^\d+(?:\.\d+)?$/.test(
e.trim())){let s=Number(e);Number.isFinite(s)&&s>0&&(t=s>1e12?s:s*1e3)}else{let s=Date.parse(String(e));Number.isFinite(
s)&&s>0&&(t=s)}if(!Number.isFinite(t)||t<=0)return null;let n=new Date(t);return Number.isNaN(n.getTime())?null:{epoch_ms:n.
getTime(),epoch_seconds:n.getTime()/1e3,iso:n.toISOString()}}function Xa(e){return!e||typeof e!="object"?null:In(e.created_at)||
In(e.timestamp)||In(e.ts)||null}function Qa(e){if(!e||typeof e!="object")return e;let t=Xa(e);return!t||e.timestamp===t.
iso&&e.timestamp_ms===t.epoch_ms&&Number(e.ts)===t.epoch_seconds?e:{...e,ts:t.epoch_seconds,timestamp:t.iso,timestamp_ms:t.
epoch_ms}}function Ku(e){if(!Array.isArray(e))return[];let t=!1,n=e.map(s=>{let a=Qa(s);return a!==s&&(t=!0),a});return t?
n:e}function Gu(e,t){return new Intl.DateTimeFormat("en-US-u-ca-gregory",{year:"numeric",...t?{timeZone:t}:{}}).format(e)}
function xc(e,t=new Date,n=void 0,s=void 0){let a=e&&typeof e=="object"&&Number.isFinite(e.epoch_ms)?e:In(e);if(!a)return"";
let i=new Date(a.epoch_ms),c={...Gu(i,s)===Gu(t,s)?{}:{year:"numeric"},month:"short",day:"numeric",hour:"numeric",minute:"\
2-digit",...s?{timeZone:s}:{}};return new Intl.DateTimeFormat(n,c).format(i)}function Vu(e,t=void 0,n=void 0){let s=e&&typeof e==
"object"&&Number.isFinite(e.epoch_ms)?e:In(e);return s?`${new Intl.DateTimeFormat(t,{dateStyle:"full",timeStyle:"long",...n?
{timeZone:n}:{}}).format(new Date(s.epoch_ms))} (${s.iso})`:""}function Yu(){let e=new Map,t=2048,n="";return{reset(s=""){let a=String(s||"");a!==n&&(n=a,e.clear())},accept(s,a){let i=Number(
s?.state_seq);if(!Number.isSafeInteger(i)||i<0)return!0;let c=String(s?.state_epoch||n||"legacy");if(n&&c!==n)return!1;n||
(n=c);let u=String(a||s?.type||"state"),p=e.get(u);if(p?.epoch===c&&i<=p.seq)return!1;for(e.has(u)&&e.delete(u),e.set(u,
{epoch:c,seq:i});e.size>t;)e.delete(e.keys().next().value);return!0},size(){return e.size}}}var Go=/(?:!\[[^\]]*\]\([^)]*\)|\[File:\s*[^\]]+\]|\b(?:image|screenshot|screen\s*shot|capture)[\w .()[\]-]*\.(?:png|jpe?g|gif|webp|bmp|svg)\b)/gi,
Ko=/(?:[A-Za-z]:[\\/]|\\\\[^\\/\s]+[\\/]|\/(?:Users|home|mnt|var|tmp|etc|opt|workspace|workspaces)\/)[^\s"'`<>)]{2,}/gi,
ag=/^(?=.*\d)(?:(?:\d+)\s*d\s*)?(?:(?:\d+)\s*h\s*)?(?:(?:\d+)\s*m\s*)?(?:(?:\d+)\s*s)?$/i,rg=/^[+-]?\d+\s*[dhms]\b/i,og=/^(?:just now|today|yesterday|(?:\d+|an?|one)\s+(?:seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?)\s+ago)$/i,
ig=/^(?:pursuing goal|paused goal|goal (?:paused|blocked|usage limited|rate limited|limited|budget limited|achieved|cancelled|canceled|stopped|failed)|idle|ready|connected|awaiting live update)$/i,
cg=/^(?:no (?:recent message|current work|data|activity)(?: reported)?|unavailable|unknown|not available)$/i,lg=/^(?:(?:antigravity|claude(?: code)?|cline|codex|continue|cursor|gemini|roo code)\s+(?:harness|workspace))$/i,
Xu=new Set(["agent","agentmanager","agentsession","antigravity","antigravitychat","antigravityv2","claude","claudecli","\
claudecode","claudecodecli","claudedesktop","cline","codex","codexcli","codexdesktop","connected","connectedsession","co\
ntinue","continueyolo","cursor","cursoragent","cursorcli","cursoride","gemini","geminicodeassist","newchat","newconversa\
tion","other","proceed","resume","roocode","session","unknown","attachment","file","image","screenshot","disregardthatla\
stmessage","ignorethatlastmessage"]);function Ja(e){return typeof e=="string"?e:Array.isArray(e)?e.map(Ja).filter(Boolean).
join(`
`):!e||typeof e!="object"?"":Ja(e.text||e.content||e.markdown||e.value||"")}function Ac(){Go.lastIndex=0,Ko.lastIndex=0}
function ug(e){let t=Ja(e).replace(/\s+/g," ").trim();return t?ag.test(t)?"duration_only":rg.test(t)?"duration_malformed":
og.test(t)?"age_only":ig.test(t)?"status_only":cg.test(t)?"placeholder_only":lg.test(t)?"surface_label_only":"":"empty"}
function Ls(e){let t=Ja(e).replace(/\s+/g," ").trim();if(!t||ug(t)||/^\[(?:attachment|file|image|screenshot)(?:\s*:[^\]]*)?\]$/i.
test(t)||/^new\s+(?:antigravity|claude|codex|continue|cursor|gemini|roo)(?:\s+(?:agent|chat|cli|code|desktop|ide|panel))*\s+(?:chat|conversation|session|thread)$/i.
test(t))return!0;let n=Go.test(t)||Ko.test(t);if(Ac(),n){let a=t.replace(Go," ").replace(Ko," ").replace(/\b(?:read|open|view|inspect|check|review|show|load|attach|attached|upload|uploaded|file|image|screenshot)\b/gi,
" ").replace(/[^a-z0-9]+/gi,"").trim();if(Ac(),a.length<12)return!0}let s=t.toLowerCase().replace(/[^a-z0-9]+/g,"").replace(
/^remoteagent(?:chat)?/,"");return s?Xu.has(s)?!0:(s=s.replace(/(?:new|production|session|chat|smoke|test|probe|verification|fixture|extension|ext|ide|app|panel|pane)$/g,
""),Xu.has(s)):!/[\p{L}\p{N}]/u.test(t)}function Zu(e){let t=Ja(e);if(!t)return"";let n=t.replace(/<goal_context>[\s\S]*?<\/goal_context>/gi,
" ").replace(/```[\s\S]*?```/g," ").replace(Go," ").replace(Ko," ").replace(/<[^>\n]{1,120}>/g," ").replace(/`([^`]+)`/g,
"$1").replace(/^\s*(?:user|assistant|codex|claude|tool result)\s*[:\-]\s*/i,"").replace(/\s+/g," ").trim();return Ac(),!n||
Ls(n)||/^(?:thinking|working|tool result|tool:|exit code|wall time|read|open|view|inspect|check|review|show|load|attach|attached|uploaded|file|image|screenshot)\b/i.
test(n)&&n.split(/\s+/).length<=4||/^[^\p{L}\p{N}]+$/u.test(n)?"":n.slice(0,80).trim()}function dg(e){let t=Array.isArray(
e)?e:[];for(let n of t){if(String(n?.role||"").toLowerCase()!=="user")continue;let s=Zu(n?.content||n?.content_blocks);if(s)
return s}return""}var Qu=Object.freeze({fallback:0,route:.5,message:1,summary:2,custom:3,native:4}),pg=Object.freeze(["c\
odex_desktop_active_thread_title","cursor_agent_title","native_chat_title","session_title","thread_title","conversation_\
title","title","display_title","summary","chat_title","chat_title_source","thread_name","conversation_name","custom_disp\
lay_name","is_new_chat_draft","is_list_view"]);function Ju(e){return Ja(e).replace(/\s+/g," ").trim()}function ed(e){return!e||
typeof e!="object"?{}:Object.fromEntries(pg.filter(t=>Object.prototype.hasOwnProperty.call(e,t)).map(t=>[t,e[t]]))}function Rc(e,t="",n=[],s=""){
let a=e&&typeof e=="object"?e:{},c=[["codex_desktop_active_thread_title",a.codex_desktop_active_thread_title],["cursor_a\
gent_title",a.cursor_agent_title],["native_chat_title",a.native_chat_title],["session_title",a.session_title],["thread_t\
itle",a.thread_title],["conversation_title",a.conversation_title],["title",a.title],["display_title",a.display_title],["\
chat_title",a.chat_title_source==="summary"?"":a.chat_title],["thread_name",a.thread_name],["conversation_name",a.conversation_name]].
map(([S,A])=>({field:S,title:Ju(A)})).find(S=>S.title&&!Ls(S.title));if(c)return{title:c.title.slice(0,80).trim(),source:"\
native",field:c.field};let u=Ju(t);if(u&&!Ls(u))return{title:u.slice(0,80).trim(),source:"custom",field:"custom_display_\
name"};let b=[["chat_title",a.chat_title_source==="summary"?a.chat_title:""],["summary",a.summary],["derived_message_tit\
le",s]].map(([S,A])=>({field:S,title:Zu(A)})).find(S=>S.title);if(b)return{title:b.title,source:"summary",field:b.field};
let y=dg(n);return y?{title:y,source:"message",field:"first_meaningful_user_message"}:{title:"New chat",source:"fallback",
field:"new_chat"}}function td(e,t){if(!e?.title)return t;if(!t?.title)return e;let n=Qu[e.source]??0;return(Qu[t.source]??
0)>=n?t:e}function nd(e,t="",n=[],s=""){return Rc(e,t,n,s).title}var mg=/(?:\bbearer\s+[a-z0-9._~+/=-]{8,}|\b(?:api[_ -]?key|password|passwd|secret|access[_ -]?token|refresh[_ -]?token)\s*[:=]\s*\S+|\bsk-[a-z0-9_-]{8,})/i,
fg=/(?:[A-Za-z]:[\\/]|\\\\[^\\/\s]+[\\/]|\/(?:Users|home|mnt|var|tmp|etc|opt|workspace|workspaces)\/)[^\s"'<>)]{2,}/i;function gg(e){
let t=0;for(let n of String(e||"")){let s=n.codePointAt(0);t+=s<=127?1:s<=2047?2:s<=65535?3:4}return t}function kn(e,t=96){
if(typeof e!="string"&&typeof e!="number")return"";let n=String(e).replace(/[\u0000-\u001f\u007f]+/g," ").replace(/\s+/g,
" ").trim();return!n||mg.test(n)||fg.test(n)?"":n.slice(0,t).trim()}function Vo(e){if(e==null||e==="")return null;let t=typeof e==
"number"&&Number.isFinite(e)?e:NaN,n=Number.isFinite(t)?t>0&&t<1e12?t*1e3:t:Date.parse(String(e));return Number.isFinite(
n)&&n>0?new Date(n).toISOString():null}function hg(e){let t=String(e||"").trim().toLowerCase().replace(/[^a-z]/g,"");return{
active:"active",paused:"paused",blocked:"blocked",usagelimited:"usageLimited",ratelimited:"usageLimited",budgetlimited:"\
budgetLimited",complete:"complete",completed:"complete",cancelled:"cancelled",canceled:"cancelled",failed:"failed",idle:"\
idle",working:"working"}[t]||null}function Mc(e){if(!e||typeof e!="object"||Number(e.schema_version)!==1)return null;let t={
schema_version:1,parser_version:kn(e.parser_version,32)||"fleet-summary-v1",session_key:kn(e.session_key,40),session_generation:Math.
max(1,Number(e.session_generation)||1),thread_key:kn(e.thread_key,40),thread_generation:Math.max(1,Number(e.thread_generation)||
1),producer_seq:Math.max(0,Number(e.producer_seq)||0),summary_seq:Math.max(0,Number(e.summary_seq)||0),title:kn(e.title,
80)||null,title_source:kn(e.title_source,24)||null,title_confidence:["authoritative","derived","unknown"].includes(e.title_confidence)?
e.title_confidence:"unknown",latest_user_request:kn(e.latest_user_request)||null,latest_user_request_at:Vo(e.latest_user_request_at),
current_work:kn(e.current_work)||null,current_work_source:kn(e.current_work_source,32)||null,current_work_kind:kn(e.current_work_kind,
24)||null,current_work_state:hg(e.current_work_state),current_work_at:Vo(e.current_work_at),last_role:["user","assistant"].
includes(e.last_role)?e.last_role:null,last_message_at:Vo(e.last_message_at),last_snippet:kn(e.last_snippet)||null,message_count:Math.
max(0,Number(e.message_count)||0),user_count:Math.max(0,Number(e.user_count)||0),assistant_count:Math.max(0,Number(e.assistant_count)||
0),other_count:Math.max(0,Number(e.other_count)||0),role_imbalance:["balanced","assistant_without_user","user_without_as\
sistant"].includes(e.role_imbalance)?e.role_imbalance:"balanced",rejected_candidate_reason:kn(e.rejected_candidate_reason,
48)||null,fresh_at:Vo(e.fresh_at)};return!t.session_key||!t.thread_key||gg(JSON.stringify(t))>1024?null:t}function sd(e){
return e?.title_confidence==="authoritative"?3:e?.title_confidence==="derived"?2:e?.title?1:0}function ad(e,t){let n=Mc(
e),s=Mc(t);if(!s)return{summary:n,accepted:!1,changed:!1,reason:"invalid"};if(!n)return{summary:{...s,summary_seq:Math.max(
1,s.summary_seq)},accepted:!0,changed:!0,reason:"initial"};if(s.session_generation<n.session_generation)return{summary:n,
accepted:!1,changed:!1,reason:"older_session_generation"};if(s.session_generation===n.session_generation&&s.session_key!==
n.session_key)return{summary:n,accepted:!1,changed:!1,reason:"session_identity_mismatch"};if(s.session_generation===n.session_generation&&
s.thread_generation<n.thread_generation)return{summary:n,accepted:!1,changed:!1,reason:"older_thread_generation"};if(s.session_generation===
n.session_generation&&s.thread_generation===n.thread_generation&&s.thread_key!==n.thread_key)return{summary:n,accepted:!1,
changed:!1,reason:"thread_identity_mismatch"};let a=s.session_generation>n.session_generation||s.thread_generation>n.thread_generation,
i=s.producer_seq>n.producer_seq||s.producer_seq===n.producer_seq&&s.summary_seq>n.summary_seq;if(!a&&!i)return{summary:n,
accepted:!1,changed:!1,reason:"replayed_or_out_of_order"};let c=a?{...s}:{...n,...s};if(!a){(!s.title||sd(s)<sd(n))&&(c.
title=n.title,c.title_source=n.title_source,c.title_confidence=n.title_confidence);for(let p of["latest_user_request","l\
atest_user_request_at","current_work","current_work_source","current_work_kind","current_work_state","current_work_at","\
last_role","last_message_at","last_snippet","fresh_at"])(s[p]==null||s[p]==="")&&(c[p]=n[p]);for(let p of["message_count",
"user_count","assistant_count","other_count"])c[p]=Math.max(n[p]||0,s[p]||0)}c.summary_seq=Math.max(n.summary_seq||0,s.summary_seq||
0);let u=JSON.stringify(n)!==JSON.stringify(c);return{summary:u?c:n,accepted:!0,changed:u,reason:u?"upgraded":"unchanged"}}
function rd(e){let t=Mc(e);if(!t)return{};let n=t.current_work?{kind:t.current_work_kind||"activity",label:t.current_work_kind===
"goal"?"Goal":t.current_work_kind==="request"?"Request":"Current work",text:t.current_work,source:t.current_work_source||
"fleet_summary",updated_at:t.current_work_at,...t.current_work_state?{state:t.current_work_state}:{}}:null;return{fleet_summary:t,
...t.title?{chat_title:t.title,chat_title_source:t.title_source}:{},...t.latest_user_request?{last_user_request:{text:t.
latest_user_request,updated_at:t.latest_user_request_at}}:{},...t.last_snippet?{last_snippet:t.last_snippet,last_message_at:t.
last_message_at}:{},...n?{fleet_work_context:n}:{}}}var od=new Set(["__proto__","constructor","prototype"]);function id(e){return typeof e=="string"?e:e?.session_id||e?.id||
""}function en(e,t){if(Object.is(e,t))return!0;if(e==null||t==null||typeof e!=typeof t||typeof e!="object")return!1;if(Array.
isArray(e)||Array.isArray(t)){if(!Array.isArray(e)||!Array.isArray(t)||e.length!==t.length)return!1;for(let a=0;a<e.length;a+=
1)if(!en(e[a],t[a]))return!1;return!0}let n=Object.keys(e),s=Object.keys(t);if(n.length!==s.length)return!1;for(let a of n)
if(!Object.prototype.hasOwnProperty.call(t,a)||!en(e[a],t[a]))return!1;return!0}function Yo(e=[]){let t=[],n=[],s=Object.
create(null),a=Object.create(null);for(let i of Array.isArray(e)?e:[]){let c=id(i);if(!c||Object.prototype.hasOwnProperty.
call(s,c))continue;a[c]=t.length,n.push(c);let u=$c(null,i);s[c]=u,t.push(u)}return{byId:s,indexById:a,order:n,list:t}}function Tc(e){
return e?.is_new_chat_draft===!0}function $c(e,t){if(!t||typeof t!="object")return t;if(Tc(t)){let i={...t};for(let c of[
"fleet_summary","fleet_work_context","last_user_request","last_snippet","last_message_at"])delete i[c];return i}let n=ad(
e?.fleet_summary,t.fleet_summary).summary;if(!n)return t;let s=rd(n),a={...t,...s};return s.fleet_work_context&&a.activity&&
typeof a.activity=="object"&&!a.activity.work_context&&(a.activity={...a.activity,work_context:s.fleet_work_context}),a}
function cd(e,t){return!e||typeof e!="object"||!t||typeof t!="object"||Tc(t)||Ls(e.chat_title)||!Ls(t.chat_title)?t:{...t,
chat_title:e.chat_title,chat_title_source:e.chat_title_source||t.chat_title_source||null}}function Fr(e,t){let n=e?.byId?
e:Yo(),s=Array.isArray(t)?t:[],a=[],i=[],c=Object.create(null),u=Object.create(null),p=s.length!==n.list.length;for(let b of s){
let y=id(b);if(!y||Object.prototype.hasOwnProperty.call(c,y))continue;let S=n.byId[y],A=cd(S,$c(S,b)),N=S!==void 0&&en(S,
A)?S:A;u[y]=a.length,i.push(y),c[y]=N,a.push(N),(!Object.is(N,S)||n.order[a.length-1]!==y)&&(p=!0)}return(a.length!==s.length||
a.length!==n.list.length)&&(p=!0),p?{byId:c,indexById:u,order:i,list:a}:n}function ld(e,t){let n=e?.byId?e:Yo(),s=t?.session_id||
t?.session||"";if(!s||!Object.prototype.hasOwnProperty.call(n.byId,s))return n;let a=n.byId[s],i=a&&typeof a=="object"?a:
{session_id:s},c=t?.patch&&typeof t.patch=="object"?t.patch:{},u=Array.isArray(t?.removed_fields)?t.removed_fields:[],p=Tc(
c),b=!p&&!Ls(i.chat_title)&&(!Object.prototype.hasOwnProperty.call(c,"chat_title")||Ls(c.chat_title)),y=i;for(let[h,d]of Object.
entries(c))od.has(h)||h==="session_id"||h==="id"||b&&(h==="chat_title"||h==="chat_title_source")||en(y[h],d)||(y===i&&(y=
{...i}),y[h]=d);for(let h of u)typeof h!="string"||od.has(h)||h==="session_id"||h==="id"||b&&(h==="chat_title"||h==="cha\
t_title_source")||Object.prototype.hasOwnProperty.call(y,h)&&(y===i&&(y={...i}),delete y[h]);if(p&&!Object.prototype.hasOwnProperty.
call(c,"chat_title")&&(y===i&&(y={...i}),y.chat_title=null,y.chat_title_source=null),y=cd(i,$c(i,y)),en(y,i))return n;y.
session_id=s;let S=n.indexById[s],A=n.list.slice();A[S]=y;let N=Object.assign(Object.create(null),n.byId);return N[s]=y,
{byId:N,indexById:n.indexById,order:n.order,list:A}}var ud=10,rt=new Map,Hr=new Map,_g=Object.freeze([]);function Ur(e){return String(e||"").trim()}function dd(e){let t=Ur(e);if(!t||!rt.has(t))return null;let n=rt.get(t);return rt.delete(t),rt.set(t,n),n}function pd(e){
let t=Ur(e);return t&&rt.get(t)||_g}function md(e,t){let n=Ur(e);if(!n||typeof t!="function")return()=>{};let s=Hr.get(n)||
new Set;return s.add(t),Hr.set(n,s),()=>{let a=Hr.get(n);a&&(a.delete(t),a.size===0&&Hr.delete(n))}}function Ec(e){let t=Hr.
get(e);t&&[...t].forEach(n=>n())}function fd(e,t,n=ud){let s=Ur(e);if(!s||!Array.isArray(t))return[];let a=Ku(t),i=rt.get(s);rt.delete(s),rt.set(s,a);let c=[],
u=Math.max(1,Number(n)||ud);for(;rt.size>u;){let p=rt.keys().next().value;rt.delete(p),c.push(p)}return i!==a&&Ec(s),c.forEach(
Ec),c}function gd(e){let t=Ur(e);return!t||!rt.has(t)?!1:(rt.delete(t),Ec(t),!0)}function bg(){return Object.fromEntries(
[...rt.entries()])}function hd(e){let t=bg(),n=typeof e=="function"?e(t):e;if(!n||n===t||typeof n!="object")return t;let s=new Set(
Object.keys(n));return Object.keys(t).forEach(a=>{s.has(a)||gd(a)}),Object.entries(n).forEach(([a,i])=>{Array.isArray(i)&&
t[a]!==i&&fd(a,i)}),n}var Lc=new Proxy({},{get(e,t){if(typeof t=="string")return rt.get(t)},ownKeys(){return[...rt.keys()]},
getOwnPropertyDescriptor(e,t){if(typeof t=="string"&&rt.has(t))return{configurable:!0,enumerable:!0,value:rt.get(t)}},set(e,t,n){
return typeof t!="string"||!Array.isArray(n)?!1:(fd(t,n),!0)},deleteProperty(e,t){return typeof t=="string"?gd(t):!1}});var vg=new Set(["thinking","generating","reading_files","running_command","applying_patch","working"]),yg=new Set(["wait\
ing_for_user","needs_attention","blocked","rate_limited","usage_limited","budget_limited","failed","error"]),kg=new Set(
["blocked","usagelimited","budgetlimited","failed"]),wg=new Set(["complete","completed","cancelled","canceled"]),Ng=new Set(
["starting","running_turn","checkpoint_pending_continuation","verifying"]),Sg=new Set(["waiting_for_user","blocked_limit\
ed"]),Cg=new Set(["paused","completed_cancelled_failed","unknown_disconnected"]),qc=15e3;function xg(e){return String(e?.
goal?.state||e?.goal?.status||"").trim().toLowerCase().replace(/[^a-z]/g,"")}function _d(e){let t=e?.goal,n=e?.goal_run;
return!t||!n||n.schema_version!==1||!n.run_id||!n.goal_fingerprint||!Number.isFinite(Number(n.goal_generation))||String(
n.goal_fingerprint)!==String(t.fingerprint||"")||Number(n.goal_generation)!==Math.max(1,Number(t.generation)||1)?null:n}
function na(e){if(typeof e=="number"&&Number.isFinite(e))return e;let t=Date.parse(String(e||""));return Number.isFinite(
t)?t:0}function Qo(e){return Math.max(na(e?.transport?.client_received_at_ms),na(e?.transport?.relay_forwarded_at_ms),na(
e?.observed_at),na(e?.updatedAt),na(e?.updated_at))}function Pc(e,t={}){if(t.connected===!1||String(t.health||"").toLowerCase()===
"disconnected"||t.fresh===!1)return!1;if(t.requireFreshness!==!0)return!0;let n=Qo(e);if(!n)return!1;let s=Number.isFinite(
Number(t.nowMs))?Number(t.nowMs):Date.now(),a=Math.max(1e3,Number(t.freshnessMs)||qc);return s-n<=a}function Jo(e,t=!1,n={}){
let s=String(e?.kind||"").trim().toLowerCase(),a=xg(e),i=_d(e),c=String(i?.lifecycle||"").trim().toLowerCase();return t||
yg.has(s)||kg.has(a)||Sg.has(c)?"needs_attention":i&&c==="unknown_disconnected"?"stale":i&&Cg.has(c)||wg.has(a)?"idle":i?.
lease_active===!0&&Ng.has(c)?"working_goal":i&&a==="active"||a==="active"?Pc(e,n)?"between_goal_turns":"stale":s==="idle"&&
a!=="active"?"idle":Pc(e,n)?e?.generating===!0||vg.has(s)?"working":"idle":"stale"}function Zo(e,t={}){let n=_d(e),s=String(
n?.lifecycle||"").trim().toLowerCase();return!n||n.lease_active!==!0?"":s==="checkpoint_pending_continuation"?"Waiting f\
or next goal turn":s==="verifying"||t.connected===!1||String(t.health||"").toLowerCase()==="disconnected"?"Reconnecting":
s==="starting"?"Starting goal":s==="running_turn"?"Working":"Goal loop active"}function bd(e){return e==="working_goal"?
"Working on goal":e==="working"?"Working":e==="between_goal_turns"?"Between goal turns":e==="needs_attention"?"Needs att\
ention":e==="stale"?"Stale":"Idle"}function sa(e){return e==="working_goal"||e==="working"}function vd(e,t=null,n=Date.now()){
if(!e||typeof e!="object")return 0;let s=Math.max(0,Number(e.time_used_seconds??e.timeUsedSeconds??0)||0),a=na(e.updated_at||
e.updatedAt),i=String(e.state||e.status||"").toLowerCase()==="active",c=t&&t.lease_active!==!0?na(t.lease_observed_at||t.
observed_at):Number(n),u=c>0?Math.min(Number(n)||c,c):a,p=i&&a>0?Math.max(0,Math.floor((u-a)/1e3)):0;return Math.floor(s+
p)}function Xo(e){let t=Number(e);return Number.isFinite(t)&&t>0?t:null}function yd(e,t=Date.now()){if(!e||typeof e!="ob\
ject")return null;let n=Xo(e.proxy_emitted_at_ms),s=Xo(e.relay_received_at_ms),a=Xo(e.relay_forwarded_at_ms),i=Xo(t)||Date.
now();return{proxy_emitted_at_ms:n,relay_received_at_ms:s,relay_forwarded_at_ms:a,client_received_at_ms:i,latency_ms:n==
null?null:Math.max(0,i-n)}}function kd(e,t=Date.now()){let n=Number(e?.transport?.latency_ms);if(Number.isFinite(n))return`${Math.
round(n)} ms`;let s=Qo(e);if(!s)return"Awaiting live update";let a=Math.max(0,Number(t)-s);return a<1e3?"Observed just n\
ow":a<6e4?`Observed ${Math.floor(a/1e3)}s ago`:a<36e5?`Observed ${Math.floor(a/6e4)}m ago`:`Observed ${Math.floor(a/36e5)}\
h ago`}var Ag=Object.freeze(["goal_completed","goal_attention","provider_usage_threshold"]),Rg=new Set(Ag),wd=Object.freeze({goal_completed:"\
goal_completed",goal_attention:"goal_attention",provider_usage_threshold:"provider_usage_warning"}),Sd="remote-agent-cha\
t:semantic-notifications:v1",Mg="remote-agent-chat:semantic-notification-claim:v1:",Cd=256,Tg=10080*60*1e3;function ei(e){
if(!e||typeof e!="object"||e.type!=="semantic_notification")return null;let t=String(e.event_type||"").trim(),n=String(e.
dedupe_key||"").trim(),s=String(e.session_id||e.session||"").trim();if(!Rg.has(t)||!n||!s)return null;let a=String(e.category||
wd[t]).trim();return a!==wd[t]?null:{...e,type:"semantic_notification",event_type:t,category:a,dedupe_key:n,session_id:s,
session:s,title:String(e.title||"").trim()||(t==="goal_completed"?"Goal completed":t==="provider_usage_threshold"?"Provi\
der usage warning":"Goal needs attention"),body:String(e.body||"").trim(),created_at:e.created_at||new Date().toISOString()}}
function Ic(e,t,n=100){let s=new Map;return[...Array.isArray(e)?e:[],...Array.isArray(t)?t:[t]].map(ei).filter(Boolean).
forEach(a=>s.set(a.dedupe_key,a)),[...s.values()].slice(-Math.max(1,Number(n)||100))}function xd(e,t={}){let n=ei(e);return!!n&&
t?.[n.category]===!0}function Oc(e,t){try{let n=JSON.parse(e?.getItem(Sd)||"{}");return Object.fromEntries(Object.entries(
n||{}).filter(([,s])=>Number(s)>t-Tg).slice(-Cd))}catch{return{}}}function Nd(e,t,n){let s=Oc(e,n);if(s[t])return!1;s[t]=
n;let a=Object.entries(s).slice(-Cd);try{e?.setItem(Sd,JSON.stringify(Object.fromEntries(a)))}catch{}return!0}function $g(e){
return new Promise(t=>setTimeout(t,e))}async function Eg(e,t,n){if(!e)return!0;if(Oc(e,n)[t])return!1;let s=`${Mg}${encodeURIComponent(
t).slice(0,320)}`,a=`${n}:${Math.random().toString(36).slice(2)}`;try{if(e.setItem(s,JSON.stringify({token:a,at:n})),await $g(
20),JSON.parse(e.getItem(s)||"{}").token!==a||!Nd(e,t,n))return!1;let c=Oc(e,n)[t]===n;return c&&e.removeItem(s),c}catch{
return Nd(e,t,n)}}async function Ad(e,{storage:t=typeof localStorage<"u"?localStorage:null,locks:n=typeof navigator<"u"?
navigator.locks:null,now:s=()=>Date.now()}={}){let a=ei(e);if(!a)return!1;let i=()=>Eg(t,a.dedupe_key,s());return n?.request?
n.request(`rac-semantic:${a.dedupe_key}`,{mode:"exclusive"},i):i()}async function aa(e,t,{channel:n="web-in-app",reasonCode:s="",
clientId:a="web-app"}={}){let i=ei(e);if(!i||!["claimed","displayed","suppressed"].includes(t)||typeof fetch!="function")
return!1;try{return(await fetch("/api/notifications/semantic-receipts",{method:"POST",credentials:"same-origin",keepalive:!0,
headers:{"Content-Type":"application/json"},body:JSON.stringify({dedupe_key:i.dedupe_key,stage:t,channel:n,...s?{reason_code:s}:
{},client_id:a})})).ok}catch{return!1}}function Rd(e,t,n=""){if(!t)return"";let s=e||{};return n&&(s[n]||[]).some(a=>a?._cid===t)?n:Object.keys(s).find(a=>(s[a]||
[]).some(i=>i?._cid===t))||""}function Md(e,t,n,s){if(!t||!n||typeof s!="function")return e;let a=e?.[n]||[],i=!1,c=a.map(
u=>{if(u?._cid!==t)return u;let p=s(u);return p!==u&&(i=!0),p});return i?{...e,[n]:c}:e}function Lg(e){let t=Number(e);return!Number.isSafeInteger(t)||t<=0?0:t}function Pg(e){return String(e?.navigation_session_id||
e?.session_id||e?.session||"")}function Td(e={}){let t=Math.max(1,Number(e.maxEntries)||512),n=new Map;function s(a,i){for(n.
delete(a),n.set(a,i);n.size>t;)n.delete(n.keys().next().value)}return{accept(a){let i=Pg(a),c=Lg(a?.navigation_epoch);if(!i||
!c)return!0;let u=n.get(i)||0;return c<u?!1:(s(i,c),!0)},latest(a){return n.get(String(a||""))||0},get size(){return n.size}}}var qg=new Set(["user","assistant","tool","tool_result","permission","permission_prompt","question","question_prompt","e\
rror","system"]);function pt(e){return typeof e=="string"?e:String(e?.session_id||e?.id||"")}function Og(e){let t=String(
e||"").trim().toLowerCase().replace(/[\s-]+/g,"_");return qg.has(t)?t==="permission_prompt"?"permission":t==="question_p\
rompt"?"question":t:null}function Ig(e){let t=String(e||"").trim();return!t||t.length>256||/[\u0000-\u001f\u007f]/.test(
t)?null:t}function Dg(e){let t=String(e||"").trim().toLowerCase().replace(/[\s-]+/g,"_");return!t||t.length>64||/[^a-z0-9_.:/]/.
test(t)?null:t}function jg(e){if(typeof e=="number"||typeof e=="string"&&/^\d+(?:\.\d+)?$/.test(e.trim())){let n=Number(
e);return!Number.isFinite(n)||n<=0?null:n>1e12?n:n*1e3}if(typeof e!="string"||!e.trim())return null;let t=Date.parse(e);
return Number.isFinite(t)&&t>0?t:null}function Za(e){if(!e||typeof e!="object")return null;let t=e.latest_visible_message&&
typeof e.latest_visible_message=="object"?e.latest_visible_message:null,n=Ig(t?.id??t?.message_id??e.last_message_id),s=jg(
t?.at??t?.timestamp??e.last_message_at),a=Og(t?.kind??e.last_message_kind),i=Dg(t?.source??e.last_message_source);return!n||
!s||!a||!i?null:Object.freeze({id:n,at:new Date(s).toISOString(),atMs:s,kind:a,source:i})}function jc(e){let t=Za(e);return t?
{latest_visible_message:{id:t.id,at:t.at,kind:t.kind,source:t.source},last_message_id:t.id,last_message_at:t.at,last_message_kind:t.
kind,last_message_source:t.source}:{}}function Bg(e,t){let n=Za(e),s=Za(t);if(n&&!s)return-1;if(!n&&s)return 1;if(!n&&!s)
return pt(e).localeCompare(pt(t));if(n.atMs!==s.atMs)return s.atMs-n.atMs;let a=s.id.localeCompare(n.id);return a!==0?a:
pt(e).localeCompare(pt(t))}function Fg(e){return(Array.isArray(e)?e:[]).filter(t=>!!pt(t)&&!!Za(t)).slice().sort(Bg)}function Dc(e){
return e instanceof Set?e:!e||typeof e[Symbol.iterator]!="function"?new Set:new Set(Array.from(e,t=>String(t||"")))}function $d(e,t={}){
let n=Dc(t.workingSessionIds),s=Dc(t.pinnedSessionIds),a=Dc(t.excludedSessionIds),i=Number.isSafeInteger(t.limit)&&t.limit>=
0?t.limit:5,c=new Set,u=[];for(let g of Array.isArray(e)?e:[]){let _=pt(g);!_||c.has(_)||a.has(_)||(c.add(_),u.push(g))}
let p=u.filter(g=>n.has(pt(g))),b=u.filter(g=>!n.has(pt(g))),y=Fg(b).slice(0,i),S=new Set(y.map(pt)),A=b.filter(g=>!S.has(
pt(g))),N=A.filter(g=>s.has(pt(g))),h=new Set(N.map(pt)),d=A.filter(g=>!h.has(pt(g))),v=Object.fromEntries([...p.map(g=>[
pt(g),"working"]),...y.map(g=>[pt(g),"recent"]),...N.map(g=>[pt(g),"pinned"]),...d.map(g=>[pt(g),"workspace"])]);return{
working:p,recent:y,pinned:N,remaining:d,ownership:v}}var er=Object.freeze({live:6e4,"1m":6e4,"5m":3e5,"15m":9e5,since_open:1/0}),Hg=Object.freeze({cpu_total_percent:["cpu","\
totalPercent"],cpu_user_percent:["cpu","userPercent"],cpu_privileged_percent:["cpu","privilegedPercent"],memory_used_percent:[
"memory","usedPercent"],memory_commit_percent:["memory","commitPercent"],disk_read_bps:["disk","readBps"],disk_write_bps:[
"disk","writeBps"],disk_read_iops:["disk","readIops"],disk_write_iops:["disk","writeIops"],network_receive_bps:["network",
"receiveBps"],network_send_bps:["network","sendBps"],network_receive_pps:["network","receivePps"],network_send_pps:["net\
work","sendPps"]});function Je(e,t=0){let n=Number(e);return Number.isFinite(n)?n:t}function _t(e){if(e==null||e==="")return null;
let t=Number(e);return Number.isFinite(t)&&t>=0?t:null}function fe(e){return Math.max(0,Je(e))}function Lt(e){return Math.
max(0,Math.min(100,Je(e)))}function ti(e){let t=String(e??"0");return/^\d+$/.test(t)?t:"0"}function Wr(e){let t=Date.parse(
String(e||""));return Number.isFinite(t)?t:0}function Ug(e,t){let n=Math.max(0,Math.round(Je(e?.pid))),s=e?.start_time?String(
e.start_time):"",a=String(e?.stable_key||`${n||"process"}:${s||t}`),i=String(e?.attribution_level||(e?.attributed?"runti\
me":"unattributed"));return{key:a,stableKey:a,parentKey:e?.parent_key?String(e.parent_key):"",pid:n,parentPid:Math.max(0,
Math.round(Je(e?.parent_pid))),startTime:s,name:String(e?.name||"Process"),status:String(e?.status||"running"),attributed:e?.
attributed===!0,attributionLevel:i,attributionReason:String(e?.attribution_reason||"No proved agent relationship"),ownedSessionId:e?.
owned_session_id?String(e.owned_session_id):"",agentLabel:e?.agent_label?String(e.agent_label):"",agentTypes:Array.isArray(
e?.agent_types)?e.agent_types.map(String):[],workspaceLabel:e?.workspace_label?String(e.workspace_label):"",sessionCount:Math.
max(0,Math.round(Je(e?.session_count))),cpuPercent:Lt(e?.cpu_host_percent??e?.cpu_percent),cpuHostPercent:Lt(e?.cpu_host_percent??
e?.cpu_percent),cpuCoreEquivalent:fe(e?.cpu_core_equivalent??e?.cpu_percent),memoryBytes:fe(e?.memory_bytes),privateBytes:fe(
e?.private_bytes??e?.memory_bytes),commitBytes:fe(e?.commit_bytes??e?.private_bytes),ioReadBps:fe(e?.io_read_bps),ioWriteBps:fe(
e?.io_write_bps),ioReadOps:fe(e?.io_read_ops),ioWriteOps:fe(e?.io_write_ops),threadCount:Math.max(0,Math.round(Je(e?.thread_count))),
handleCount:Math.max(0,Math.round(Je(e?.handle_count))),uptimeSeconds:e?.uptime_seconds==null?null:fe(e.uptime_seconds),
childCount:Math.max(0,Math.round(Je(e?.child_count))),selectedAs:Array.isArray(e?.selected_as)?e.selected_as.map(String):
[],selectedParentPresent:e?.selected_parent_present!==!1,counterTotals:{ioReadBytes:ti(e?.counter_totals?.io_read_bytes),
ioWriteBytes:ti(e?.counter_totals?.io_write_bytes),ioReadOperations:ti(e?.counter_totals?.io_read_operations),ioWriteOperations:ti(
e?.counter_totals?.io_write_operations)}}}function Wg(e,t){return{id:String(e?.id||`disk-${t}`),label:String(e?.label||`\
Disk ${t+1}`),kind:String(e?.kind||"unknown"),readBps:fe(e?.read_bps),writeBps:fe(e?.write_bps),readIops:fe(e?.read_iops),
writeIops:fe(e?.write_iops),busyPercent:Lt(e?.busy_percent),readLatencyMs:fe(e?.read_latency_ms),writeLatencyMs:fe(e?.write_latency_ms),
queueLength:fe(e?.queue_length),capacityBytes:fe(e?.capacity_bytes),freeBytes:fe(e?.free_bytes),freePercent:Lt(e?.free_percent),
available:e?.available!==!1}}function zg(e,t){return{id:String(e?.id||`adapter-${t}`),label:String(e?.label||`Adapter ${t+
1}`),kind:String(e?.kind||"unknown"),physicalDefault:e?.physical_default===!0,receiveBps:fe(e?.receive_bps),sendBps:fe(e?.
send_bps),receivePps:fe(e?.receive_pps),sendPps:fe(e?.send_pps),linkSpeedBps:fe(e?.link_speed_bps),utilizationPercent:Lt(
e?.utilization_percent),receiveErrors:fe(e?.receive_errors),sendErrors:fe(e?.send_errors),receiveDiscards:fe(e?.receive_discards),
sendDiscards:fe(e?.send_discards),available:e?.available!==!1}}function Pd(e){if(!e||typeof e!="object")return{available:!1,
status:"waiting",schemaVersion:0,source:"",capturedAt:"",capturedAtMs:0,sampleSequence:0,sampleIntervalMs:0,droppedGapCount:0,
machineLabel:"",system:null,processes:[],attributedProcesses:[],sampling:null,privacy:null,capabilities:null,error:null,
lastGoodCapturedAt:"",lastGoodCapturedAtMs:0};let t=e.system&&typeof e.system=="object"?e.system:null,n=t?.cpu&&typeof t.
cpu=="object"?t.cpu:{},s=t?.memory&&typeof t.memory=="object"?t.memory:{},a=t?.disk&&typeof t.disk=="object"?t.disk:{},i=t?.
network&&typeof t.network=="object"?t.network:{},c=t?{cpuPercent:Lt(n.total_percent??t.cpu_percent),cpu:{totalPercent:Lt(
n.total_percent??t.cpu_percent),userPercent:Lt(n.user_percent),privilegedPercent:Lt(n.privileged_percent),idlePercent:Lt(
n.idle_percent),queueLength:fe(n.queue_length),frequencyMhz:fe(n.current_frequency_mhz),logicalCoreCount:Math.max(0,Math.
round(Je(n.logical_core_count))),physicalCoreCount:Math.max(0,Math.round(Je(n.physical_core_count))),perLogical:Array.isArray(
n.per_logical)?n.per_logical:[]},memory:{totalBytes:fe(s.total_bytes),usedBytes:fe(s.used_bytes),availableBytes:fe(s.available_bytes),
usedPercent:Lt(s.used_percent),cacheBytes:fe(s.cache_bytes),commitBytes:fe(s.commit_bytes),commitLimitBytes:fe(s.commit_limit_bytes),
commitPeakBytes:fe(s.commit_peak_bytes),commitPercent:Lt(s.commit_percent),pagedPoolBytes:fe(s.paged_pool_bytes),nonpagedPoolBytes:fe(
s.nonpaged_pool_bytes),pagefileUsedBytes:fe(s.pagefile_used_bytes),pagesPerSec:fe(s.pages_per_sec),faultsPerSec:fe(s.faults_per_sec)},
disk:{readBps:fe(a.read_bps),writeBps:fe(a.write_bps),busyPercent:Lt(a.busy_percent),readIops:fe(a.read_iops),writeIops:fe(
a.write_iops),readLatencyMs:fe(a.read_latency_ms),writeLatencyMs:fe(a.write_latency_ms),transferLatencyMs:fe(a.transfer_latency_ms),
queueLength:fe(a.queue_length)},disks:(Array.isArray(t.disks)?t.disks:[]).map(Wg),network:{receiveBps:fe(i.receive_bps),
sendBps:fe(i.send_bps),receivePps:fe(i.receive_pps),sendPps:fe(i.send_pps),utilizationPercent:Lt(i.utilization_percent),
outputQueueLength:fe(i.output_queue_length),receiveErrors:fe(i.receive_errors),sendErrors:fe(i.send_errors),receiveDiscards:fe(
i.receive_discards),sendDiscards:fe(i.send_discards),tcpRetransmitsPerSec:fe(i.tcp_retransmits_per_sec)},networkAdapters:(Array.
isArray(t.network_adapters)?t.network_adapters:[]).map(zg),processCount:Math.max(0,Math.round(Je(t.process_count))),threadCount:Math.
max(0,Math.round(Je(t.thread_count))),handleCount:Math.max(0,Math.round(Je(t.handle_count))),uptimeSeconds:fe(t.uptime_seconds)}:
null,u=(Array.isArray(e.processes)?e.processes:[]).map(Ug).sort((y,S)=>Number(S.attributed)-Number(y.attributed)||S.cpuHostPercent-
y.cpuHostPercent||S.memoryBytes-y.memoryBytes||y.pid-S.pid),p=e.captured_at?String(e.captured_at):"",b=e.last_good_captured_at?
String(e.last_good_captured_at):"";return{available:e.status==="fresh"&&!!c,status:String(e.status||"unavailable"),schemaVersion:Math.
max(0,Math.round(Je(e.schema_version))),source:String(e.source||""),capturedAt:p,capturedAtMs:Wr(p),sampleSequence:Math.
max(0,Math.round(Je(e.sample_sequence))),sampleIntervalMs:Math.max(0,Math.round(Je(e.sample_interval_ms))),droppedGapCount:Math.
max(0,Math.round(Je(e.dropped_gap_count))),machineLabel:e.machine_label?String(e.machine_label):"",system:c,processes:u,
attributedProcesses:u.filter(y=>y.attributed),sampling:e.sampling&&typeof e.sampling=="object"?e.sampling:null,privacy:e.
privacy&&typeof e.privacy=="object"?e.privacy:null,capabilities:e.capabilities&&typeof e.capabilities=="object"?e.capabilities:
null,error:e.error&&typeof e.error=="object"?e.error:null,lastGoodCapturedAt:b,lastGoodCapturedAtMs:Wr(b)}}function Bc(e,t=0){
let n=e.filter(Number.isFinite).sort((a,i)=>a-i);if(!n.length)return t;let s=Math.floor(n.length/2);return n.length%2?n[s]:
(n[s-1]+n[s])/2}function ni(e){let t=Math.max(Number.EPSILON,Number(e)||0),n=10**Math.floor(Math.log10(t)),s=t/n;return(s<=
1?1:s<=2?2:s<=2.5?2.5:s<=5?5:10)*n}function si(e){if(!e||typeof e!="object")return null;let t=Number(e.sample_sequence);
if(!Number.isSafeInteger(t)||t<1)return null;let n=e.frame_kind==="system"?e:e.system||{},s=n.cpu||{},a=n.memory||{},i=n.
disk||{},c=n.network||{};return{sampleSequence:t,capturedAt:String(e.captured_at||""),capturedAtMs:Wr(e.captured_at),monotonicMs:fe(
e.monotonic_ms),sampleIntervalMs:fe(e.sample_interval_ms),droppedGapCount:Math.max(0,Math.round(Je(e.dropped_gap_count))),
status:String(e.status||"unavailable"),cpu:{totalPercent:_t(s.total_percent??n.cpu_percent),userPercent:_t(s.user_percent),
privilegedPercent:_t(s.privileged_percent)},memory:{usedPercent:_t(a.used_percent),commitPercent:_t(a.commit_percent)},disk:{
readBps:_t(i.read_bps),writeBps:_t(i.write_bps),readIops:_t(i.read_iops),writeIops:_t(i.write_iops)},network:{receiveBps:_t(
c.receive_bps),sendBps:_t(c.send_bps),receivePps:_t(c.receive_pps),sendPps:_t(c.send_pps)}}}function tr(e,t={}){let n=Array.
isArray(e)?e:[],s=new Map,a=0,i=0,c=0;for(let J of n){let W=Number(J?.sample_sequence);!Number.isSafeInteger(W)||W<1||(W<
c&&(i+=1),c=Math.max(c,W),s.has(W)?a+=1:s.set(W,J))}let p=[...s.values()].sort((J,W)=>J.sample_sequence-W.sample_sequence).
map(J=>({frame:J,point:si(J)})).filter(J=>J.point),b=p.find(J=>J.point.capturedAtMs>0&&J.point.monotonicMs>0)||null,y=p.
map(J=>{let W=b&&J.point.monotonicMs>0?b.point.capturedAtMs+J.point.monotonicMs-b.point.monotonicMs:0;return{...J,chartTimeMs:W>
0?W:J.point.capturedAtMs}}),S=[];for(let J=1;J<y.length;J+=1){let W=y[J].chartTimeMs-y[J-1].chartTimeMs;W>0&&W<=1e4&&S.push(
W)}let A=y.map(J=>J.point.sampleIntervalMs).filter(J=>J>0),N=Math.max(1,Math.round(Bc(S,Bc(A,1e3))||1e3)),h=Math.max(2500,
N*2.5),d=[],v=[],g=0,_=0,k=0,T=0,L=0,H=0;for(let J of y){let W={...J,chartTimeMs:J.chartTimeMs+H};if(!(W.chartTimeMs>0)){
g+=1;continue}let G=d.at(-1),$=!1;if(G&&W.point.monotonicMs>0&&G.point.monotonicMs>0&&W.point.monotonicMs<G.point.monotonicMs){
let te=W.point.capturedAtMs-G.point.capturedAtMs,ce=te>0&&te<=1e4?te:N,ie=G.chartTimeMs+Math.max(1,ce);H+=ie-W.chartTimeMs,
W.chartTimeMs=ie,$=!0,L+=1}if(G&&W.chartTimeMs<=G.chartTimeMs){W.chartTimeMs===G.chartTimeMs?_+=1:k+=1;continue}let P=W.
point.status!=="fresh",B=P?"unavailable":"";if(G){let te=W.chartTimeMs-G.chartTimeMs,ce=W.point.sampleSequence-G.point.sampleSequence,
ie=W.point.droppedGapCount-G.point.droppedGapCount;if((ce!==1||ie>0||te>h)&&(P=!0,B=ce!==1||ie>0?"dropped":"cadence"),$)
T+=1,P=!0,B="clock_discontinuity";else if(W.point.monotonicMs>0&&G.point.monotonicMs>0&&W.point.capturedAtMs>0&&G.point.
capturedAtMs>0){let be=W.point.capturedAtMs-G.point.capturedAtMs,Ne=W.point.monotonicMs-G.point.monotonicMs;Math.abs(be-
Ne)>Math.max(5e3,N*2)&&(T+=1,P=!0,B="clock_discontinuity")}P&&v.push({startMs:G.chartTimeMs,endMs:W.chartTimeMs,reason:B,
previousSequence:G.point.sampleSequence,nextSequence:W.point.sampleSequence})}d.push({...W,gapBefore:P,gapReason:B})}let V=Number.
isFinite(Number(t.nowMs))?Number(t.nowMs):Date.now(),ne=d.at(-1)||null,ee=ne?Math.max(0,V-ne.chartTimeMs):1/0,re=Math.max(
2500,N*2),z=Math.max(re*4,1e4),oe="waiting";t.paused?oe="paused":t.connected===!1||t.subscriptionStatus==="reconnecting"?
oe="reconnecting":ne?ne.point.status!=="fresh"?oe="unavailable":ee>z?oe="stale":ee>re?oe="delayed":oe="live":oe=t.error?
"unavailable":"waiting",ne&&ee>re&&!t.paused&&v.push({startMs:ne.chartTimeMs,endMs:V,reason:oe,previousSequence:ne.point.
sampleSequence,nextSequence:null});let _e=d.length>1?d.at(-1).chartTimeMs-d[0].chartTimeMs:0,Y=ne&&!t.paused?Math.max(ne.
chartTimeMs,V):ne?.chartTimeMs||0,ve=d.length?Math.max(0,Y-d[0].chartTimeMs):0,he=d.length?Math.max(1,Math.floor(ve/N)+1):
0,X=d.length?Math.max(0,d.at(-1).point.droppedGapCount-d[0].point.droppedGapCount):0;return{frames:d.map(J=>({...J.frame,
chart_time_ms:J.chartTimeMs,gap_before:J.gapBefore,gap_reason:J.gapReason})),points:d.map(J=>({...J.point,chartTimeMs:J.
chartTimeMs,gapBefore:J.gapBefore,gapReason:J.gapReason})),gaps:v,status:oe,cadenceMs:N,staleAfterMs:re,latestAgeMs:ee,nowMs:V,
startMs:d[0]?.chartTimeMs||0,endMs:d.at(-1)?.chartTimeMs||0,elapsedMs:_e,expectedCount:he,receivedCount:n.length,validCount:d.
filter(J=>J.point.status==="fresh").length,droppedCount:Math.max(X,Math.max(0,he-d.length)),gapCount:v.length,duplicateCount:a+
_,outOfOrderCount:i+k,invalidTimestampCount:g,clockDiscontinuityCount:T,monotonicResetCount:L}}function Ed(e,t,n){let s=e.
map(a=>({capturedAtMs:a.capturedAtMs,value:t==="cpu"?a.cpu.totalPercent:a.memory.usedPercent})).filter(a=>a.capturedAtMs>
0&&a.value!==null);return s.length<2||s.at(-1).capturedAtMs-s[0].capturedAtMs<15e3?!1:s.every(a=>a.value>=n)}function Ld(e,t){
return Ed(e,t,95)?"critical":Ed(e,t,85)?"warning":"normal"}function qd(e,t={}){let n=qs([],e,60),s=n.map(si).filter(Boolean),
a=s.at(-1)||null,i=Number.isFinite(Number(t.nowMs))?Number(t.nowMs):Date.now(),c=t.connected!==!1,u=String(t.subscriptionStatus||
""),p=a?.cpu.totalPercent??null,b=a?.memory.usedPercent??null,y=a?.status==="fresh"&&p!==null&&b!==null,S=a?.capturedAtMs>
0?Math.max(0,i-a.capturedAtMs):1/0,A=Math.max(1e3,a?.sampleIntervalMs||1e3),N=Math.max(2500,A*2),h="waiting";!c||u==="re\
connecting"?h="reconnecting":y?S>N?h="stale":h="live":h=t.error?"unavailable":"waiting";let d=a?.capturedAtMs?a.capturedAtMs-
15e3:1/0,v=s.filter(H=>H.capturedAtMs>=d),g=y?Ld(v,"cpu"):"normal",_=y?Ld(v,"memory"):"normal",k=h==="live"&&(g==="criti\
cal"||_==="critical")?"critical":h==="live"&&(g==="warning"||_==="warning")?"warning":h,T=n.at(-1)||null,L=T?.frame_kind===
"system"?T:T?.system||null;return{status:h,attention:k,point:a,frames:n,cpuPercent:p,memoryPercent:b,cpuLevel:g,memoryLevel:_,
ageMs:S,ageSeconds:Number.isFinite(S)?Math.max(0,Math.round(S/1e3)):null,staleAfterMs:N,sampleSequence:a?.sampleSequence||
0,capturedAt:a?.capturedAt||"",memoryUsedBytes:_t(L?.memory?.used_bytes),memoryTotalBytes:_t(L?.memory?.total_bytes)}}function qs(e,t,n=900){
let s=new Map;[...Array.isArray(e)?e:[],...Array.isArray(t)?t:[t]].forEach(i=>{let c=Number(i?.sample_sequence);!Number.
isSafeInteger(c)||c<1||s.has(c)||s.set(c,i)});let a=Math.max(1,Math.min(900,Number(n)||900));return[...s.entries()].sort(
(i,c)=>i[0]-c[0]).slice(-a).map(([,i])=>i)}function Ps(e,t){let n=e?.sampleSequence?e:si(e),s=Hg[t];return!n||!s?null:_t(
s.reduce((a,i)=>a?.[i],n))}function Fc(e,t){let n=(Array.isArray(e)?e:[]).map(_=>({frame:_,point:_?.sampleSequence?_:si(
_),value:Ps(_,t),timeMs:Number(_?.chartTimeMs??_?.chart_time_ms)||Wr(_?.capturedAt??_?.captured_at),gapBefore:_?.gapBefore===
!0||_?.gap_before===!0})).filter(_=>_.point&&_.value!==null&&_.timeMs>0).sort((_,k)=>_.timeMs-k.timeMs||_.point.sampleSequence-
k.point.sampleSequence);if(!n.length)return{current:null,min:null,average:null,sampleAverage:null,timeWeightedAverage:null,
averageMethod:"none",max:null,p95:null,provisionalP95:null,p95Ready:!1,peakSequence:null,count:0,elapsedMs:0,cadenceMs:0,
gapCount:0};let s=n.map(_=>_.value),a=[...s].sort((_,k)=>_-k),i=n.reduce((_,k)=>k.value>_.value?k:_,n[0]),c=s.reduce((_,k)=>_+
k,0)/s.length,u=n.slice(1).map((_,k)=>_.timeMs-n[k].timeMs).filter(_=>_>0),p=Math.max(0,Math.round(Bc(u,0))),b=Math.max(
2500,p*2.5),y=0,S=0,A=0;for(let _=1;_<n.length;_+=1){let k=n[_-1],T=n[_],L=T.timeMs-k.timeMs;if(T.gapBefore||L>b){A+=1;continue}
y+=(k.value+T.value)/2*L,S+=L}let N=S>0?y/S:c,h=u.length?Math.min(...u):0,d=u.length?Math.max(...u):0,v=h>0&&d/h>1.2,g=a[Math.
max(0,Math.ceil(a.length*.95)-1)];return{current:s.at(-1),min:Math.min(...s),average:v?N:c,sampleAverage:c,timeWeightedAverage:N,
averageMethod:v?"time-weighted":"sample",max:Math.max(...s),p95:s.length>=20?g:null,provisionalP95:g,p95Ready:s.length>=
20,peakSequence:i.point.sampleSequence,count:s.length,elapsedMs:n.length>1?n.at(-1).timeMs-n[0].timeMs:0,cadenceMs:p,gapCount:A}}function Od(e,t,n=240){let a=tr(e,{nowMs:Number.MAX_SAFE_INTEGER,paused:!0}).points;if(!a.length)return[];let i=Math.max(
1,Math.round(Number(n)||240)),c=a.length<=i?1:Math.ceil(a.length/i),u=[];for(let p=0;p<a.length;p+=c){let b=a.slice(p,p+
c),y=Fc(b,t);u.push({startSequence:b[0].sampleSequence,endSequence:b.at(-1).sampleSequence,capturedAtStartMs:b[0].chartTimeMs,
capturedAtEndMs:b.at(-1).chartTimeMs,chartTimeMs:b.at(-1).chartTimeMs,current:y.current,min:y.min,average:y.average,max:y.
max,first:Ps(b[0],t),last:Ps(b.at(-1),t),p95:y.p95,provisionalP95:y.provisionalP95,peakSequence:y.peakSequence,count:y.count,
gap:b.some(S=>S.gapBefore)})}return u}function Id(e,t="live",n={}){let s=Number.isFinite(Number(n.nowMs))?Number(n.nowMs):
Date.now(),i=tr(e,{...n,nowMs:s}).frames,c=er[t]??er.live;return!i.length||c===1/0?i:i.filter(u=>Number(u.chart_time_ms)>=
s-c&&Number(u.chart_time_ms)<=s)}function Hc(e,t=0,n={}){if(n.percent)return{maximum:100,minimum:0,step:25,ticks:[0,25,50,
75,100]};let s=Math.max(0,Number(e)||0),a=Math.max(0,Number(t)||0);if(a>0&&s<=a*.95&&s>=a*.65){let b=ni(a/4),y=Math.max(
2,Math.round(a/b)+1);return{maximum:a,minimum:0,step:b,ticks:Array.from({length:y},(S,A)=>Math.min(a,b*A))}}let i=Math.max(
1,s*1.1),c=ni(i/4),u=Math.ceil(i/c)*c,p=Math.round(u/c)+1;return p<4&&(c=ni(i/3),u=Math.ceil(i/c)*c,p=Math.round(u/c)+1),
p>6&&(c=ni(i/5),u=Math.ceil(i/c)*c,p=Math.round(u/c)+1),{maximum:u,minimum:0,step:c,ticks:Array.from({length:Math.max(2,
p)},(b,y)=>Math.min(u,c*y))}}function Dd(e,t,n=5){let s=Number(e),a=Number(t),i=Math.max(2,Math.min(6,Math.round(Number(
n)||5)));return!Number.isFinite(s)||!Number.isFinite(a)||a<=s?[]:Array.from({length:i},(c,u)=>{let p=s+(a-s)*u/(i-1),b=new Date(
p),y=new Date(s).toDateString()!==new Date(a).toDateString();return{timeMs:p,fraction:u/(i-1),label:b.toLocaleString([],
y?{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}:{hour:"2-digit",minute:"2-digit",second:"2-digit"}),accessibleLabel:b.
toLocaleString([],{year:"numeric",month:"long",day:"numeric",hour:"2-digit",minute:"2-digit",second:"2-digit",timeZoneName:"\
short"})}})}function Uc(e,t,n){let s=Number(e?.chartTimeMs??e?.chart_time_ms)||Wr(e?.capturedAt??e?.captured_at),a=Number(
t),i=Number(n);return!(s>0)||!Number.isFinite(a)||!Number.isFinite(i)||i<=a?0:Math.max(0,Math.min(1,(s-a)/(i-a)))}function Dn(e){let t=fe(e);if(t<1024)return`${Math.round(t)} B`;let n=["KiB","MiB","GiB","TiB"],s=t/1024,a=0;for(;s>=1024&&
a<n.length-1;)s/=1024,a+=1;let i=s>=100?0:s>=10?1:2;return`${s.toFixed(i)} ${n[a]}`}function jn(e){return`${Dn(e)}/s`}function jd(e){
return e==null?"\u2014":`${Je(e).toFixed(Je(e)>=10?1:2)}%`}function Wc(e,t=Date.now()){let n=Date.parse(e||"");if(!Number.
isFinite(n))return"Waiting for local sample";let s=Math.max(0,Math.round((t-n)/1e3));return s<2?"Updated now":s<60?`Upda\
ted ${s}s ago`:`Updated ${Math.floor(s/60)}m ago`}function zc(e){let t=typeof e=="number"?e:Date.parse(String(e||""));return Number.
isFinite(t)?new Date(t).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"}):"Unknown time"}function Gc(e){
let t=typeof e=="number"?e:Date.parse(String(e||""));return Number.isFinite(t)?new Date(t).toLocaleString([],{year:"nume\
ric",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit",second:"2-digit",timeZoneName:"short"}):"Unknown date a\
nd time"}var Bd=Object.freeze({unavailable:6,auth_required:5,rate_limited:4,stale:3,refreshing:2,fresh:1});function Is(e){let t=Number(
e);return Number.isFinite(t)?Math.max(0,t):null}function mt(e){let t=Number(e);return Number.isFinite(t)?t:null}function tn(e){
if(!e||typeof e!="object"||e.amount==null||e.amount==="")return null;let t=mt(e.amount);return t==null?null:{amount:t,currency:String(
e.currency||"USD"),sourceField:String(e.source_field||""),semantics:String(e.semantics||""),directlyReported:e.directly_reported===
!0}}function Gg(e){if(!e||typeof e!="object")return null;let t=e.pool_classification&&typeof e.pool_classification=="obj\
ect"?{status:String(e.pool_classification.classification_status||""),firstParty:tn(e.pool_classification.first_party),thirdParty:tn(
e.pool_classification.third_party),unclassified:tn(e.pool_classification.unclassified),warning:String(e.pool_classification.
warning||"")}:null;return{semanticsVersion:Number(e.semantics_version)||0,source:String(e.source||""),observedAt:String(
e.observed_at||""),accountScope:String(e.account_scope||""),extraUsageEnabled:e.extra_usage_enabled===!0,prepaidBalance:tn(
e.prepaid_balance),extraUsageSpend:tn(e.extra_usage_spend),extraUsageCap:tn(e.extra_usage_cap),reportedSpend:tn(e.reported_spend),
includedSpend:tn(e.included_spend),bonusSpend:tn(e.bonus_spend),planLimit:tn(e.plan_limit),allowanceRemaining:tn(e.allowance_remaining),
reconciliationDelta:tn(e.reconciliation_delta),poolClassification:t,resetsAt:String(e.resets_at||""),disclaimer:String(e.
disclaimer||"")}}function Kg(e){if(!e||typeof e!="object")return null;let t=(Array.isArray(e.request_receipts)?e.request_receipts:
[]).map(n=>({receiptId:String(n?.receipt_id||""),model:String(n?.model||""),surface:String(n?.surface||""),capturedAt:String(
n?.captured_at||""),promptTokens:mt(n?.prompt_tokens),responseTokens:mt(n?.response_tokens),tokensPerSecond:mt(n?.tokens_per_second),
totalDurationNs:mt(n?.total_duration_ns),loadDurationNs:mt(n?.load_duration_ns),promptEvalDurationNs:mt(n?.prompt_eval_duration_ns),
evalDurationNs:mt(n?.eval_duration_ns)})).filter(n=>n.receiptId&&n.model&&n.surface);return{status:String(e.status||""),
endpointScope:String(e.endpoint_scope||""),installedModelsCount:Math.max(0,Number(e.installed_models_count)||0),loadedModelsCount:Math.
max(0,Number(e.loaded_models_count)||0),loadedModels:(Array.isArray(e.loaded_models)?e.loaded_models:[]).map(n=>({name:String(
n?.name||"Unnamed local model"),sizeBytes:Math.max(0,Number(n?.size_bytes)||0),sizeVramBytes:Math.max(0,Number(n?.size_vram_bytes)||
0),contextLength:Math.max(0,Number(n?.context_length)||0),expiresAt:String(n?.expires_at||"")})),promptTokens:mt(e.prompt_tokens),
responseTokens:mt(e.response_tokens),tokensPerSecond:mt(e.tokens_per_second),totalDurationNs:mt(e.total_duration_ns),loadDurationNs:mt(
e.load_duration_ns),promptEvalDurationNs:mt(e.prompt_eval_duration_ns),evalDurationNs:mt(e.eval_duration_ns),observedRequestCount:Math.
max(0,Number(e.observed_request_count)||0),requestReceipts:t,latestRequest:t.at(-1)||null,telemetryStatus:String(e.telemetry_status||
""),telemetryReason:String(e.telemetry_reason||"")}}function Vg(e){return!e||typeof e!="object"?null:{subscriptionState:[
"active","none","unavailable"].includes(e.subscription_state)?e.subscription_state:"unavailable",source:String(e.source||
""),capturedAt:String(e.captured_at||""),autoReloadEnabled:typeof e.auto_reload_enabled=="boolean"?e.auto_reload_enabled:
null,error:e.error&&typeof e.error=="object"?{code:String(e.error.code||""),message:String(e.error.message||"")}:null,sourceReceipt:e.
source_receipt&&typeof e.source_receipt=="object"?{...e.source_receipt}:null}}function Yg(e){if(!e||typeof e!="object")return null;
let t=["slow","steady","racing","burning"].includes(e.category)?e.category:"",n=Is(e.expected_used_percent);if(!t||n==null)
return null;let s=e.budget_percent&&typeof e.budget_percent=="object"?Object.fromEntries(["now","next_hour","next_five_h\
ours","today"].map(a=>[a,Is(e.budget_percent[a])??0])):null;return{stage:String(e.stage||""),category:t,expectedUsedPercent:n,
actualUsedPercent:Is(e.actual_used_percent),deltaPercent:mt(e.delta_percent),projectedUsedPercent:Is(e.projected_used_at_reset_percent),
exhaustionAt:e.exhaustion_at?String(e.exhaustion_at):"",willLastToReset:e.will_last_to_reset===!0,budgets:s}}function Xg(e,t){
let n=Is(e?.used_percent),s=String(e?.status||(n==null?"unavailable":"available"));if(n==null&&s!=="unavailable")return null;
let a=Is(e?.thresholds?.warning_percent)??75,i=Math.max(a,Is(e?.thresholds?.critical_percent)??90),c={id:String(e?.id||`\
window-${t+1}`),label:String(e?.label||"Usage"),scope:e?.scope?String(e.scope):"",modelScope:e?.model_scope&&typeof e.model_scope==
"object"?{id:String(e.model_scope.id||""),label:String(e.model_scope.label||"")}:null,usedPercent:n,remainingPercent:mt(
e?.remaining_percent)??(n==null?null:100-n),visualPercent:Is(e?.visual_percent)??(n==null?null:Math.min(100,n)),durationMinutes:Number.
isFinite(Number(e?.duration_minutes))?Number(e.duration_minutes):null,startsAt:e?.starts_at?String(e.starts_at):"",resetsAt:e?.
resets_at?String(e.resets_at):"",resetDescription:e?.reset_description?String(e.reset_description):"",windowKind:e?.window_kind?
String(e.window_kind):"",source:e?.source?String(e.source):"",provenance:e?.provenance?String(e.provenance):"",freshnessStatus:e?.
freshness_status?String(e.freshness_status):"",status:s,error:e?.error&&typeof e.error=="object"?e.error:null,thresholds:{
warningPercent:a,criticalPercent:i},pace:Yg(e?.pace)};return c.tone=n==null?"unavailable":n>=i||n>=100?"critical":n>=a?"\
warning":"ok",c}function Qg(e){if(e?.status==="auth_required"||e?.status==="unavailable")return"unavailable";if(e?.status===
"rate_limited")return"stale";let t=new Set((e?.windows||[]).map(s=>s.tone)),n=Math.max(-1,...(e?.windows||[]).map(s=>s.usedPercent??
-1));return t.has("critical")?"critical":t.has("warning")?"warning":e?.status==="stale"?"stale":e?.status==="fresh"&&e?.
localRuntime?.status==="running"||n>=0?"ok":"unknown"}function Jg(e,t){let n=(Array.isArray(e?.windows)?e.windows:[]).map(
Xg).filter(Boolean).sort((a,i)=>i.usedPercent-a.usedPercent||a.label.localeCompare(i.label)),s={key:`${e?.provider_id||"\
provider"}:${e?.account_fingerprint||t}:${e?.quota_domain||"quota"}`,providerId:String(e?.provider_id||"unknown"),providerName:String(
e?.provider_name||"Provider"),quotaDomain:String(e?.quota_domain||""),dashboardUrl:e?.dashboard_url?String(e.dashboard_url):
"",accountFingerprint:String(e?.account_fingerprint||""),accountLabel:String(e?.account_label||"Local account"),plan:e?.
plan?String(e.plan):"",source:e?.source?String(e.source):"",sourceHistory:Array.isArray(e?.source_history)?e.source_history:
[],status:String(e?.status||"unavailable"),capturedAt:e?.captured_at?String(e.captured_at):"",staleAfter:e?.stale_after?
String(e.stale_after):"",nextRefreshAt:e?.next_refresh_at?String(e.next_refresh_at):"",lastGoodCapturedAt:e?.last_good_captured_at?
String(e.last_good_captured_at):"",windows:n,credits:e?.credits&&typeof e.credits=="object"?e.credits:null,financials:Gg(
e?.financials),localRuntime:Kg(e?.local_runtime),cloudUsage:Vg(e?.cloud_usage),resetCredits:e?.reset_credits&&typeof e.reset_credits==
"object"?e.reset_credits:null,error:e?.error&&typeof e.error=="object"?e.error:null,requestCount:Math.max(0,Number(e?.request_count)||
0),latencyMs:Number.isFinite(Number(e?.latency_ms))?Number(e.latency_ms):null,sessionCount:Math.max(0,Number(e?.session_count)||
0),harnessTypes:Array.isArray(e?.mapped_harness_types)?e.mapped_harness_types.map(String).sort():[]};return s.tone=Qg(s),
s.maximumUsedPercent=n.length>0?Math.max(...n.map(a=>a.usedPercent)):null,s}function Kc(e){let t=Array.isArray(e?.snapshots)?
e.snapshots:[],n=new Map;t.map(Jg).forEach(N=>{let h=n.get(N.key),d=Date.parse(h?.capturedAt||"")||0,v=Date.parse(N.capturedAt||
"")||0;(!h||v>=d)&&n.set(N.key,N)});let s=[...n.values()].sort((N,h)=>(Bd[h.status]||0)-(Bd[N.status]||0)||(h.maximumUsedPercent??
-1)-(N.maximumUsedPercent??-1)||N.providerName.localeCompare(h.providerName)||N.accountLabel.localeCompare(h.accountLabel)),
a=new Set(s.map(N=>N.providerId)),i=s.filter(N=>N.windows.length>0||N.credits||N.resetCredits||N.financials||N.localRuntime||
N.cloudUsage).length,c=s.filter(N=>["warning","critical"].includes(N.tone)&&N.maximumUsedPercent<100).length,u=s.filter(
N=>N.maximumUsedPercent>=100).length,p=Number(e?.generation)||0,b=e?.in_flight===!0,y=s.filter(N=>N.status==="fresh").length,
S=s.filter(N=>N.status==="stale").length,A=b?"refreshing":p===0&&s.length===0?"not-started":s.length===0||y===s.length?"\
ready":y>0?"partial":S>0?"stale":"unavailable";return{schemaVersion:Number(e?.schema_version)||0,generation:p,generatedAt:e?.
generated_at?String(e.generated_at):"",pollIntervalMs:Math.max(0,Number(e?.poll_interval_ms)||0),inFlight:b,collectionState:A,
summaryAuthoritative:p>0||s.length>0,estimatedCost:Zg(e?.estimated_cost),entries:s,summary:{providers:a.size,accounts:s.
length,reporting:i,nearLimit:c,exhausted:u}}}function Vc(e,t){if(!t||typeof t!="object")return e;if(!e||typeof e!="objec\
t")return t;let n=Math.max(0,Number(e.generation)||0),s=Math.max(0,Number(t.generation)||0);if(s<n)return e;let a=Array.
isArray(e.snapshots)?e.snapshots:[],i=Array.isArray(t.snapshots)?t.snapshots:[];return s===n&&a.length>0&&i.length===0?t.
in_flight===!0&&e.in_flight!==!0?{...e,in_flight:!0}:e:t}function Os(e){return Array.isArray(e)?e.filter(t=>t&&typeof t==
"object").map(t=>({...t})):[]}function zr(e){if(e==null||e==="")return null;let t=Number(e);return Number.isFinite(t)?Math.
max(0,t):null}function Zg(e){return!e||typeof e!="object"?null:{schemaVersion:Number(e.schema_version)||0,catalogVersion:String(
e.catalog_version||""),label:String(e.label||"Local estimated API-equivalent cost"),status:String(e.status||"unavailable"),
generatedAt:e.generated_at?String(e.generated_at):"",range:e.range&&typeof e.range=="object"?e.range:{days:365,since:"",
until:""},tokens:{input:zr(e.tokens?.input),cached:zr(e.tokens?.cached),output:zr(e.tokens?.output)},costUsd:zr(e.cost_usd),
records:zr(e.records),byProvider:Os(e.by_provider),byModel:Os(e.by_model),byProject:Os(e.by_project),byDay:Os(e.by_day),
bySpeed:Os(e.by_speed),dailyBreakdown:Os(e.daily_breakdown),unknownModels:Os(e.unknown_models),scan:e.scan&&typeof e.scan==
"object"?e.scan:{},reasonCode:String(e.reason_code||""),reasonPath:String(e.reason_path||""),lastGoodGeneratedAt:e.last_good_generated_at?
String(e.last_good_generated_at):"",detail:e.detail&&typeof e.detail=="object"?{totalRows:Math.max(0,Number(e.detail.total_rows)||
0),inlineRows:Math.max(0,Number(e.detail.inline_rows)||0),pageSize:Math.max(0,Number(e.detail.page_size)||0),nextCursor:e.
detail.next_cursor==null?"":String(e.detail.next_cursor),truncated:e.detail.truncated===!0,collections:Os(e.detail.collections)}:
null}}function nr(e,t,n,s){e.has(t)||e.set(t,Object.fromEntries(s.map(i=>[i,n[i]])));let a=e.get(t);a.input=(Number(a.input)||
0)+(Number(n.input)||0),a.cached=(Number(a.cached)||0)+(Number(n.cached)||0),a.output=(Number(a.output)||0)+(Number(n.output)||
0),a.cost_usd=(Number(a.cost_usd)||0)+(Number(n.cost_usd)||0),a.records=(Number(a.records)||0)+(Number(n.records)||0)}function Fd(e,t={}){
if(!e)return null;let n=Math.max(1,Math.min(365,Number(t.days)||1)),s=Date.parse(`${e.range?.until||new Date().toISOString().
slice(0,10)}T00:00:00.000Z`),a=s-(n-1)*24*60*60*1e3,i=e.dailyBreakdown.filter(b=>{let y=Date.parse(`${b.day}T00:00:00.00\
0Z`);return Number.isFinite(y)&&y>=a&&y<=s&&(!t.project||b.project===t.project)&&(!t.providerId||b.provider_id===t.providerId)}),
c={provider:new Map,model:new Map,project:new Map,day:new Map,speed:new Map},u={input:0,cached:0,output:0,cost_usd:0,records:0};
i.forEach(b=>{nr(new Map([["total",u]]),"total",b,[]),nr(c.provider,b.provider_id,b,["provider_id"]),nr(c.model,`${b.provider_id}\
|${b.model}`,b,["provider_id","model"]),nr(c.project,`${b.provider_id}|${b.project}`,b,["provider_id","project"]),nr(c.day,
b.day,b,["day"]),nr(c.speed,b.speed,b,["speed"])});let p=b=>[...b.values()].map(y=>({...y,cost_usd:Number((y.cost_usd||0).
toFixed(8))}));return{days:n,tokens:{input:u.input,cached:u.cached,output:u.output},costUsd:Number(u.cost_usd.toFixed(8)),
records:u.records,byProvider:p(c.provider),byModel:p(c.model),byProject:p(c.project),byDay:p(c.day),bySpeed:p(c.speed)}}
function Dt(e){let t=Number(e);return Number.isFinite(t)?`${Number.isInteger(t)?t:t.toFixed(2).replace(/0+$/,"").replace(
/\.$/,"")}%`:"Unavailable"}function Gr(e){let t=Number(e);return!Number.isFinite(t)||t<0?"Unavailable":t<1e6?`${Math.round(
t/1e3)} us`:t<1e9?`${(t/1e6).toFixed(1).replace(/\.0$/,"")} ms`:`${(t/1e9).toFixed(2).replace(/0+$/,"").replace(/\.$/,"")}\
 s`}function Hd(e){let t=Number(e);return!Number.isFinite(t)||t<0?"Unavailable":`${t.toFixed(2).replace(/0+$/,"").replace(
/\.$/,"")} tokens/s`}function sr(e,t=Date.now()){let n=Date.parse(e||"");if(!Number.isFinite(n))return"Not yet refreshed";
let s=Math.max(0,Math.floor((t-n)/1e3));if(s<10)return"Updated just now";if(s<60)return`Updated ${s}s ago`;let a=Math.floor(
s/60);return a<60?`Updated ${a}m ago`:`Updated ${Math.floor(a/60)}h ${a%60}m ago`}function oa(e,t=Date.now()){let n=Date.
parse(e||"");if(!Number.isFinite(n))return e?String(e):"";let s=Math.max(0,Math.floor((n-t)/1e3)),a=Math.floor(s/60),i=s<
60?`${s}s`:a<60?`${a}m`:`${Math.floor(a/60)}h ${a%60}m`,c=new Date(n).toLocaleString([],{month:"short",day:"numeric",hour:"\
numeric",minute:"2-digit"});return`in ${i} (${c})`}function Yc(e){if(!e||typeof e!="object")return"";if(e.unlimited===!0)
return"Unlimited credits";let t=e.balance!=null&&e.balance!==""&&Number.isFinite(Number(e.balance));if(e.unit&&t)return`${e.
balance} ${e.unit}`;let n=e.currency==="USD"?"$":e.currency?`${e.currency} `:"";return t?`${n}${Number(e.balance).toFixed(
2)} balance`:""}function ra(e){return!e||e.amount==null||e.amount===""||!Number.isFinite(Number(e.amount))?"Not reported":
`${e.currency==="USD"?"$":e.currency?`${e.currency} `:""}${Number(e.amount).toFixed(2)}`}function Xc(e){if(!e)return[];let t=[];
return e.prepaidBalance&&t.push({id:"prepaid-balance",label:"Available prepaid balance",value:ra(e.prepaidBalance)}),e.extraUsageSpend&&
t.push({id:"extra-spend",label:"Extra-usage spend",value:ra(e.extraUsageSpend)}),e.extraUsageCap&&t.push({id:"extra-cap",
label:"Extra-usage cap",value:ra(e.extraUsageCap)}),!e.extraUsageEnabled&&(e.extraUsageSpend||e.extraUsageCap)&&t.push({
id:"extra-status",label:"Extra usage",value:"Disabled"}),e.reportedSpend&&t.push({id:"reported-spend",label:"Provider-re\
ported spend",value:ra(e.reportedSpend)}),e.includedSpend&&t.push({id:"included-spend",label:"Included spend bucket",value:ra(
e.includedSpend)}),e.bonusSpend&&t.push({id:"bonus-spend",label:"Bonus spend bucket",value:ra(e.bonusSpend)}),e.planLimit&&
t.push({id:"plan-limit",label:"Reported plan limit",value:ra(e.planLimit)}),e.reportedSpend&&!e.allowanceRemaining&&t.push(
{id:"allowance-remaining",label:"Available allowance",value:"Not reported by provider"}),e.poolClassification?.status===
"unavailable"&&t.push({id:"pool-classification",label:"First/third-party pools",value:e.poolClassification.warning||"Not\
 reported by provider"}),t}var{useState:Re,useEffect:Qc,useRef:Ae,useCallback:Pt}=React;var zd=1024*1024,eh=15e3,th=1,nh=15e3,sh=Object.freeze({queued:1e4,accepted:3e4,launch_accepted:3e4,delivered:3e4,steered:3e4}),
Gd=[250,500,1e3,2e3,3e3],ri=512,ah=new Set(["history","history_snapshot","history_chunk","transcript_resync_required","c\
hat_list"]);function cs(e,t,n,s=ri){let a={...e||{}};Object.prototype.hasOwnProperty.call(a,t)&&delete a[t],a[t]=n;let i=Object.
keys(a),c=i.length-Math.max(1,Number(s)||ri);for(let u=0;u<c;u+=1)delete a[i[u]];return a}function rh(e){let n=(e instanceof
Map?[...e.values()]:Object.values(e||{})).filter(a=>a&&typeof a=="object"),s=n.filter(a=>a.aggregateOnly!==!0).length;return{
active:n.length>0,aggregateOnly:s===0,consumerCount:n.length,detailConsumerCount:s}}function Ds(e,t){let n=Object.entries(
t||{});if(!n.length)return e;let s=!1,a={...e};return n.forEach(([i,c])=>{Object.is(e[i],c)||en(e[i]??null,c??null)||(a[i]=
c,s=!0)}),s?a:e}function oh(e,t,n){return(e==="history_snapshot"||e==="history")&&!t?.partial&&(!t?.mode||t.mode==="full")?
!1:!!(t?.partial||t?.mode==="tail"||n?.mode==="chunked"||n?.partial)}function oi(e){return e?e.source_message_id?`source\
${e.source_message_id}`:e.native_source_id?`native${e.native_source_id}`:e.id!=null?`id${e.id}`:e.server_message_id!=
null?`server${e.server_message_id}`:e.sequence!=null&&e.ts!=null?`seq${e.sequence}${e.ts}${e.role||""}`:e.client_message_id?
`client${e.client_message_id}`:e.client_msg_id?`client${e.client_msg_id}`:"":""}function ih(e,t){if(!e||!t)return!1;let n=oi(
e),s=oi(t);return n&&s?n===s:e.role===t.role&&String(e.content||"")===String(t.content||"")}function Kd(e,t){let n=Array.
isArray(e)?e:[],s=(Array.isArray(t)?t:[]).filter(i=>i?._optimistic&&i?._cid);if(s.length===0)return n;let a=[...n];return s.
forEach(i=>{let c=a.findIndex(u=>u?.role==="user"&&(u.client_message_id===i._cid||u.client_msg_id===i._cid||String(u.content||
"")===String(i.content||"")));if(c>=0){let u=a[c]?.status;a[c]={...a[c],_cid:i._cid,_optimistic:!0,_delivered:i._delivered||
a[c]._delivered||u==="delivered"||u==="agent_started",_agentStarted:i._agentStarted||a[c]._agentStarted||u==="agent_star\
ted",_sendError:u==="failed"?a[c].failure_code||i._sendError||"Send failed":i._sendError||null}}else a.push(i)}),a}function Vd(e,t){
let n=Array.isArray(e)?e:[],s=Array.isArray(t)?t:[];if(!n.length)return s;if(!s.length)return n;let a=Math.min(n.length,
s.length);for(let i=a;i>=1;i--){let c=!0;for(let u=0;u<i;u++)if(!ih(n[n.length-i+u],s[u])){c=!1;break}if(c)return i===s.
length?n:[...n,...s.slice(i)]}return null}function Kr(e){let t=Array.isArray(e)?e:[],n=s=>{let a=String(s?.content||"");
return/\*\*(?:Claude Code|Codex|Cursor) CLI is waiting for a native transcript\.\*\*/i.test(a)&&/placeholder will be replaced with the real CLI chat history/i.
test(a)};return!t.some(n)||!t.some(s=>!n(s))?t:t.filter(s=>!n(s))}function Xd(e,t){let n=e?.agent_type||e?.agentType||"";
if(n!=="codex_cli"&&n!=="cursor_cli"||!Array.isArray(t)||t.length!==1)return!1;let s=t[0];return s?.role!=="assistant"?!1:
/\*\*(?:Codex|Cursor) CLI is waiting for a native transcript\.\*\*/.test(String(s.content||""))}function Yd(e,t={}){let n={},
s={},a={};return(e||[]).forEach(i=>{if(!i||typeof i!="object"||!i.session_id||!i.activity)return;let c=i.activity.kind||
"working",u=i.activity.label||(c==="idle"?"":"Working");n[i.session_id]={kind:c,label:u,updatedAt:i.activity.updated_at||
null,observed_at:i.activity.observed_at||t[i.session_id]?.observed_at||null,startedAt:i.activity.started_at||null,interruptHint:i.
activity.interrupt_hint||"",goal:i.activity.goal||null,goal_run:i.activity.goal_run||null,thinking:i.activity.thinking||
null,current:i.activity.current||null,step:i.activity.step||null,usage:i.activity.usage||null,task_list:i.activity.task_list||
null,context_card:i.activity.context_card||null,thinkingContent:i.activity.thinking?.text||i.activity.thinkingContent||"",
transport:i.activity.transport||t[i.session_id]?.transport||null},s[i.session_id]=i.activity.thinking?.text||i.activity.
thinkingContent||"",a[i.session_id]=["thinking","generating","running_command","applying_patch","reading_files","working"].
includes(c)?u:!1}),{activities:n,thinkingContent:s,thinking:a}}function Qd(){let[e,t]=Re(()=>Yo()),n=e.list,s=Pt(r=>{t(m=>{
let C=typeof r=="function"?r(m.list):r;return Fr(m,C)})},[]),a=Lc,i=hd,[c,u]=Re({}),[p,b]=Re({}),[y,S]=Re(!1),[A,N]=Re({
state:"connecting",rttMs:null,lastAckAt:null}),[h,d]=Re({}),[v,g]=Re({}),[_,k]=Re({}),[T,L]=Re({}),[H,V]=Re({}),[ne,ee]=Re(
{}),[re,z]=Re({}),[oe,_e]=Re([]),[Y,ve]=Re({}),[he,X]=Re(null),[me,J]=Re({}),[W,G]=Re({}),[$,P]=Re({}),[B,te]=Re([]),[ce,
ie]=Re({}),[be,Ne]=Re({}),[Se,Ee]=Re({}),[xe,Ie]=Re({}),[Ke,de]=Re({}),[Ze,D]=Re({}),[se,ke]=Re({}),[q,et]=Re({}),[yt,xt]=Re(
{}),[Hn,ds]=Re({}),[Ri,lr]=Re({}),[Mi,so]=Re([]),[Ti,ao]=Re([]),[$i,ur]=Re(null),[ro,oo]=Re(null),[Ei,pa]=Re(null),[Li,ma]=Re(
null),[dr,Un]=Re(null),[io,qt]=Re(null),[Wn,Sn]=Re(null),[pr,zn]=Re([]),[Pi,ps]=Re([]),[qi,Fs]=Re({id:"",status:"idle",aggregateOnly:!0,
resumed:!1,consumerCount:0,detailConsumerCount:0}),[Oi,Hs]=Re({}),[Ii,mr]=Re([]),sn=Ae({}),ms=Ae({}),At=Ae({}),fs=Ae({}),
fr=Ae({}),ot=Ae({}),gs=Ae({}),f=Ae({}),nt=Ae(null),fa=Ae([]),gr=Ae(0),co=Ae(0),Gn=Ae(null),Us=Ae(null),an=Ae(null),Cn=Ae(
null),lo=Ae(0),ft=Ae(1e4),ga=Ae(3e4),Kn=Ae([]),Ws=Ae(null),ha=Ae(null),Rt=Ae(Yu()),zs=Ae(Td()),uo=Ae(0),rn=Ae({}),Vn=Ae(
0),hs=Ae({}),it=Ae({}),Ve=Ae({}),gt=Ae({}),Gs=Ae({}),_a=Ae(!1),on=Ae(new Map),cn=Ae(null),ct=Ae({}),Ot=Ae(null),Bt=Ae(new Map),
kt=Ae(new Map),st=Ae({active:!1,aggregateOnly:!0,consumerCount:0,detailConsumerCount:0}),ze=Ae(""),ba=Ae(!0),wt=Ae(""),va=Ae(
0),Yn=Ae({system:"",detail:""}),Mt=Ae({system:0,detail:0}),ln=Ae({system:0,detail:0});function tt(r){return!!dd(r)}function po(r,m,C=null){
if(ct.current={...ct.current,[r]:m},Bt.current.set(r,{stream:m,streamTrace:C}),Ot.current!=null)return;let O=typeof requestAnimationFrame==
"function"?requestAnimationFrame:l=>setTimeout(l,16);Ot.current=O(()=>{Ot.current=null;let l=[...Bt.current.entries()];Bt.
current.clear(),l.length&&(Hs(x=>{let E={...x};return l.forEach(([F,Z])=>{E[F]=Z.stream}),E}),l.forEach(([x,E])=>{E.streamTrace&&
Oe({stream_trace:E.streamTrace},x)}))})}function mo(r,m=null){if(!r||ct.current[r]?.open)return;let O=Cc(r,m);ct.current=
{...ct.current,[r]:O},Hs(l=>({...l,[r]:O}))}function ya(r){if(!r||!ct.current[r])return;let m={...ct.current};delete m[r],
ct.current=m,Bt.current.delete(r),Hs(C=>{if(!C[r])return C;let O={...C};return delete O[r],O})}function Di(){ct.current=
{},Bt.current.clear(),Hs({})}function fo(){let r=cn.current;cn.current=null,r&&(r.kind==="idle"&&typeof cancelIdleCallback==
"function"?cancelIdleCallback(r.id):clearTimeout(r.id))}function go(){if(cn.current||on.current.size===0)return;let r=()=>{
cn.current=null;let m=on.current.entries().next();if(m.done)return;let[C,O]=m.value;on.current.delete(C),ha.current?.(O),
go()};typeof requestIdleCallback=="function"?cn.current={kind:"idle",id:requestIdleCallback(r,{timeout:250})}:cn.current=
{kind:"timer",id:setTimeout(r,32)}}function ka(){requestAnimationFrame(()=>requestAnimationFrame(()=>{_a.current=!0,go()}))}
let we=Pt(r=>{nt.current?.readyState===WebSocket.OPEN&&nt.current.send(JSON.stringify(r))},[]),_s=Pt((r=!1)=>{let m=`pro\
vider-usage-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return pa({requestId:m,status:"requested"}),we({type:"\
provider_usage_refresh",protocol_version:1,force:r===!0,request_id:m}),m},[we]),Xn=Pt(()=>{let r=`provider-reset-${Date.
now()}-${Math.random().toString(36).slice(2,7)}`;return ma({requestId:r,status:"requested"}),we({type:"provider_usage_re\
set_credit_consume",protocol_version:1,request_id:r,approved:!0}),r},[we]),Ks=Pt((r={})=>{let m=`provider-cost-${Date.now()}\
-${Math.random().toString(36).slice(2,7)}`,C={days:Math.max(1,Math.min(365,Number(r.days)||365)),providerId:r.providerId?
String(r.providerId):"",project:r.project?String(r.project):"",cursor:/^\d+$/.test(String(r.cursor??"0"))?String(r.cursor??
"0"):"0",pageSize:Math.max(1,Math.min(256,Number(r.pageSize)||256))};return Un({requestId:m,status:"loading",query:C,detail:null,
error:null}),we({type:"provider_usage_cost_detail_request",protocol_version:1,request_id:m,days:C.days,provider_id:C.providerId||
null,project:C.project||null,cursor:C.cursor,page_size:C.pageSize}),m},[we]),hr=Pt((r=!1)=>{let m=`host-resource-${Date.
now()}-${Math.random().toString(36).slice(2,7)}`;return Sn(null),we({type:"host_resource_refresh",protocol_version:1,force:r===
!0,aggregate_only:st.current.aggregateOnly===!0,request_id:m}),m},[we]),Qn=Pt(()=>{qt(null),Sn(null),zn([]),ps([]),Mt.current=
{system:0,detail:0},ln.current={system:0,detail:0}},[]),Tt=Pt((r,m="")=>{let C=`host-resource-subscribe-${Date.now()}-${++va.
current}`;return wt.current=C,Sn(null),Fs(O=>({...O,status:m?"reconnecting":"subscribing",aggregateOnly:r===!0})),we({type:"\
host_resource_subscribe",protocol_version:1,request_id:C,...m?{resume_subscription_id:m}:{},aggregate_only:r===!0}),C},[
we]),Ft=Pt((r,m=0)=>{let C=r==="detail"?"detail":"system",O=ze.current;if(!O)return null;let l=`host-resource-history-${C}\
-${Date.now()}-${++va.current}`;return Yn.current[C]=l,we({type:"host_resource_history_request",protocol_version:1,request_id:l,
subscription_id:O,stream:C,after_sequence:Math.max(0,Math.round(Number(m)||0)),max_points:C==="detail"?8:64}),l},[we]),Jn=Pt(
()=>{let r=st.current,m=rh(kt.current);st.current=m;let C=ze.current;return m.active?(Fs(O=>({...O,aggregateOnly:m.aggregateOnly,
consumerCount:m.consumerCount,detailConsumerCount:m.detailConsumerCount})),r.active?(r.aggregateOnly===m.aggregateOnly||
(m.aggregateOnly&&(zn(O=>qs([],O,60)),ps([]),qt(null),Yn.current.detail="",Mt.current.detail=0,ln.current.detail=0),C&&Tt(
m.aggregateOnly,C)),C||null):(Qn(),Tt(m.aggregateOnly,""),null)):(ze.current="",wt.current="",Yn.current={system:"",detail:""},
ba.current=!0,C&&we({type:"host_resource_unsubscribe",protocol_version:1,request_id:`host-resource-unsubscribe-${Date.now()}\
-${++va.current}`,subscription_id:C}),Qn(),Fs({id:"",status:"idle",aggregateOnly:!0,resumed:!1,consumerCount:0,detailConsumerCount:0}),
null)},[Qn,we,Tt]),bs=Pt((r=!1,m="dashboard")=>{let C=String(m||"dashboard").trim().slice(0,64)||"dashboard",O=r===!0;return kt.
current.get(C)?.aggregateOnly===O?ze.current||null:(kt.current.set(C,{aggregateOnly:O}),Jn())},[Jn]),ho=Pt((r="dashboard")=>{
let m=String(r||"dashboard").trim().slice(0,64)||"dashboard";return kt.current.delete(m)?Jn():ze.current||null},[Jn]),_o=Pt(
r=>{let m=[...new Set((Array.isArray(r)?r:[]).filter(C=>typeof C=="string"&&C.length>0))].sort().slice(0,128);m.length===
fa.current.length&&m.every((C,O)=>C===fa.current[O])||(fa.current=m,nt.current?.readyState===WebSocket.OPEN&&nt.current.
send(JSON.stringify({type:"subscribe",protocol_version:1,request_id:`web-sub-${Date.now()}-${++gr.current}`,sessions:m})))},
[]);function Zn(){Us.current&&clearInterval(Us.current),an.current&&clearTimeout(an.current),Us.current=null,an.current=
null,Cn.current=null}function wa(r=nt.current){if(!r||r.readyState!==WebSocket.OPEN||Cn.current)return;let m=`web-hb-${Date.
now()}-${++lo.current}`,C=Date.now();Cn.current={requestId:m,sentAt:C},r.send(JSON.stringify({type:"heartbeat",protocol_version:1,
request_id:m,client_ts:new Date(C).toISOString()})),an.current=setTimeout(()=>{if(Cn.current?.requestId===m){Cn.current=
null,an.current=null,N({state:"stale",rttMs:null,lastAckAt:null});try{r.close()}catch{}}},ga.current)}function un(r,m=nt.
current){Zn(),ft.current=Math.max(1e3,Number(r?.heartbeat_interval_ms)||1e4),ga.current=Math.max(ft.current*2,Number(r?.
heartbeat_timeout_ms)||3e4),wa(m),Us.current=setInterval(()=>wa(m),ft.current)}function dn(r){let m=Cn.current;if(!m||m.
requestId!==r.request_id)return;an.current&&clearTimeout(an.current),an.current=null,Cn.current=null;let C=Math.max(0,Date.
now()-m.sentAt),O=C<=500?"healthy":C<=2e3?"slow":"poor";N({state:O,rttMs:C,lastAckAt:Date.now()})}function xn(r){let m=ms.
current[r];m&&clearTimeout(m),delete ms.current[r]}function lt(r,m){if(r){if(!Object.prototype.hasOwnProperty.call(At.current,
r)&&Object.keys(At.current).length>=ri){let C=Object.keys(At.current)[0];xn(C),delete fs.current[C]}At.current=cs(At.current,
r,m),ee(C=>cs(C,r,m))}}function An(r,m){!r||!m||(fs.current=cs(fs.current,r,m))}function Rn(r,m,C){r&&i(O=>{let l=Rd(O,r,
m||fs.current[r]||"");return l?(An(r,l),Md(O,r,l,C)):O})}function pn(r,m,C=""){r&&At.current[r]!=="agent_started"&&(xn(r),
lt(r,"failed"),Rn(r,C,O=>({...O,_sendError:m||"Send failed"})))}function Ge(r,m,C){xn(r);let O=sh[m];O&&(ms.current[r]=setTimeout(
()=>{delete ms.current[r],At.current[r]===m&&pn(r,C)},O))}Qc(()=>{f.current=$},[$]),Qc(()=>{fr.current=me},[me]);function mn(r,m){
return`${r}:${m}`}function Ht(r,m){!Object.prototype.hasOwnProperty.call(ot.current,r)&&Object.keys(ot.current).length>=
ri&&Vs(Object.keys(ot.current)[0]),ot.current=cs(ot.current,r,m),xt(ot.current)}function Vs(r){let m=gs.current[r];m&&clearTimeout(
m),delete gs.current[r]}function Ys(r,m){let C=ot.current[r];if(!C||!["pending","awaiting_config"].includes(C.status))return;
Vs(r);let l={...f.current[C.sessionId]||{},[C.configKey]:C.previousValue};f.current={...f.current,[C.sessionId]:l},P(x=>({
...x,[C.sessionId]:{...x[C.sessionId]||{},[C.configKey]:C.previousValue}})),Ht(r,{...C,status:"failed",error:m||"Control\
 change failed and was rolled back.",completedAt:Date.now()})}function ht(r,m,C,O,l,x){let E=mn(r,m);Vs(E);let F=f.current[r]||
{},Z={sessionId:r,field:m,configKey:C,requestId:x,previousValue:F[C],requestedValue:O,status:"pending",error:null,startedAt:Date.
now()},K={...F,[C]:O};return f.current={...f.current,[r]:K},P(ge=>({...ge,[r]:{...ge[r]||{},[C]:O}})),Ht(E,Z),gs.current[E]=
setTimeout(()=>Ys(E,"Timed out waiting for the agent to confirm this setting."),nh),we({...l,session_id:r,request_id:x}),
x}function fn(r,m){Object.entries(ot.current).forEach(([C,O])=>{O.sessionId!==r||!["pending","awaiting_config"].includes(
O.status)||Object.prototype.hasOwnProperty.call(m,O.configKey)&&m[O.configKey]===O.requestedValue&&(Vs(C),Ht(C,{...O,status:"\
ok",error:null,completedAt:Date.now()}))})}let Mn=Pt(()=>{fo(),_a.current=!1,on.current.clear();let r=location.protocol===
"https:"?"wss":"ws",m=new WebSocket(`${r}://${location.host}/client-ws`);nt.current=m,m.onopen=()=>{co.current=0,S(!0),N(
{state:"connecting",rttMs:null,lastAckAt:null}),m.send(JSON.stringify({type:"subscribe",protocol_version:1,request_id:`w\
eb-sub-${Date.now()}-${++gr.current}`,sessions:fa.current})),st.current.active&&Tt(st.current.aggregateOnly,ze.current)},
m.onclose=()=>{if(Zn(),Object.entries(ot.current).forEach(([l,x])=>{["pending","awaiting_config"].includes(x?.status)&&Ys(
l,"Connection changed before the native setting was confirmed. Retry after reconnecting.")}),Object.values(it.current).forEach(
l=>clearTimeout(l)),it.current={},Object.keys(Ve.current).forEach(l=>{Ve.current[l]={...Ve.current[l]||{},inFlight:!1}}),
b({}),Di(),S(!1),N({state:"offline",rttMs:null,lastAckAt:null}),st.current.active&&Fs(l=>({...l,status:"reconnecting"})),
nt.current!==m)return;let C=co.current++,O=Gd[Math.min(C,Gd.length-1)];Gn.current=setTimeout(()=>{Gn.current=null,Mn()},
O)},m.onmessage=C=>{let O;try{O=JSON.parse(C.data)}catch{return}O.stream_trace&&typeof O.stream_trace=="object"&&(O.stream_trace=
{...O.stream_trace,browser_received_at_ms:Date.now()}),ha.current(O)}},[we,Tt]);Qc(()=>(Mn(),()=>{Gn.current&&clearTimeout(
Gn.current),Zn(),Object.values(ms.current).forEach(m=>clearTimeout(m)),ms.current={},Object.values(gs.current).forEach(m=>clearTimeout(
m)),gs.current={},fo(),Ot.current!=null&&(typeof cancelAnimationFrame=="function"?cancelAnimationFrame(Ot.current):clearTimeout(
Ot.current),Ot.current=null),Bt.current.clear();let r=nt.current;nt.current=null;try{r?.close()}catch{}}),[Mn]);function es(r){
let m=Yd(r);L(C=>Ds(C,Yd(r,C).activities)),k(C=>Ds(C,m.thinkingContent)),g(C=>Ds(C,m.thinking))}function Tn(r){let m=new Set(
(r||[]).map(l=>l&&typeof l=="object"?l.session_id:l).filter(Boolean)),C=l=>{let x=!1,E={...l};return Object.keys(E).forEach(
F=>{m.has(F)||(delete E[F],x=!0)}),x?E:l};Object.keys(sn.current).forEach(l=>{m.has(l)||(clearTimeout(sn.current[l]),delete sn.
current[l])}),[rn,hs,Ve,gt,Gs].forEach(l=>{Object.keys(l.current).forEach(x=>{m.has(x)||delete l.current[x]})}),Object.keys(
ct.current).forEach(l=>{m.has(l)||delete ct.current[l]});for(let l of Bt.current.keys())m.has(l)||Bt.current.delete(l);Object.
keys(it.current).forEach(l=>{m.has(l)||(clearTimeout(it.current[l]),delete it.current[l])});let O=!1;Object.entries(ot.current).
forEach(([l,x])=>{m.has(x?.sessionId)||(Vs(l),delete ot.current[l],O=!0)}),O&&xt({...ot.current}),L(C),k(C),g(C),u(C),b(
C),d(C),V(C),z(C),J(C),G(C),P(C),ie(C),Ne(C),Ee(C),Ie(C),de(C),D(C),ke(C),ds(C),Hs(C),lr(l=>{let x=!1,E={...l};return Object.
keys(E).forEach(F=>{let Z=F.indexOf(":"),K=Z>=0?F.slice(0,Z):F;m.has(K)||(delete E[F],x=!0)}),x?E:l})}function vs(r){let m={};
(r||[]).forEach(C=>{!C||typeof C!="object"||!C.session_id||typeof C.auto_approve_permissions=="boolean"&&(m[C.session_id]=
{auto_approve_permissions:C.auto_approve_permissions})}),Object.keys(m).length>0&&P(C=>{let O=!1,l={...C};return Object.
entries(m).forEach(([x,E])=>{let F={...l[x]||{},...E};en(l[x]||{},F)||(l[x]=F,O=!0)}),O?l:C})}function ys(r){let m={};(r||
[]).forEach(C=>{!C||typeof C!="object"||!C.session_id||Array.isArray(C.chat_list)&&(m[C.session_id]=C.chat_list)}),ie(C=>Ds(
C,m))}function ts(r){let m={};(r||[]).forEach(C=>{!C||typeof C!="object"||!C.session_id||C.status&&(m[C.session_id]=C.status)}),
V(C=>Ds(C,m))}function _r(r,m={}){let C=typeof r=="string"?r:r?.session_id;if(!C||nt.current?.readyState!==WebSocket.OPEN)
return;let O=`hist-${Date.now()}-${++uo.current}`;rn.current[C]=O;let l=Math.max(0,Math.floor(Number(m.afterSequence??m.
after_sequence)||0)),x=l>0?"delta":m.full?"full":"tail";b(Z=>({...Z,[C]:{mode:x,requestedAt:Date.now(),requestId:O}}));let E={
type:l>0?"history_request":"get_history",session:C,session_id:C,request_id:O};l>0&&(E.after_sequence=l);let F=Number(m.limit||
m.tailLimit||0);l<=0&&Number.isFinite(F)&&F>0&&!m.full&&(E.limit=Math.floor(F),E.tail=!0),m.full&&(E.full=!0),we(E)}function Na(r,m={}){
let C=typeof r=="string"?r:r?.session_id;if(!C||nt.current?.readyState!==WebSocket.OPEN)return;let O=m.mode==="older"?"o\
lder":m.mode==="around"?"around":"tail",l=m.source||"relay_sqlite",x=O==="around"||O==="tail"&&m.replace!==!1,E=m.beforeOffset??
m.before_offset??null,F=m.beforeId??m.before_id??null,Z=m.aroundId??m.around_id??null,K=`${O}${l}${E??""}${F??""}${Z??
""}`,ge=Ve.current[C]||{},pe=Date.now();if(ge.inFlight&&O!=="around"||O==="older"&&ge.lastRequestSig===K&&pe-Number(ge.lastRequestAt||
0)<1500)return;let De=`histchunk-${Date.now()}-${++Vn.current}`,He=Math.max(256*1024,Math.min(16*1024*1024,Number(m.chunkBytes||
m.chunk_bytes||zd)||zd));if(O!=="older"){let Ce=Number(m.retryAttempt||0)>0?ge.baselineMessageKeys:null,Le=Array.isArray(
Ce)?Ce:(a[C]||[]).map(Ut).filter(Boolean);clearTimeout(it.current[C]),Ve.current[C]={source:l,chunkBytes:He,limit:m.limit||
null,inFlight:!0,mode:O,replace:x,baselineMessageKeys:Le,lastRequestSig:K,lastRequestAt:pe}}else Ve.current[C]={...Ve.current[C]||
{},source:l,chunkBytes:He,limit:m.limit||Ve.current[C]?.limit||null,inFlight:!0,mode:O,lastRequestSig:K,lastRequestAt:pe};
hs.current[C]=De,u(Ce=>{if(!Ce[C]?.error)return Ce;let Le={...Ce[C]};return delete Le.error,{...Ce,[C]:Le}}),b(Ce=>({...Ce,
[C]:{mode:O,kind:"chunked",requestedAt:Date.now(),requestId:De}}));let We={type:"history_chunk_request",session:C,session_id:C,
request_id:De,mode:O,source:l,replace:x,chunk_bytes:He},Nt=Number(m.limit||m.tailLimit||0);Number.isFinite(Nt)&&Nt>0&&(We.
limit=Math.floor(Nt)),(m.userInitiated||m.user_initiated)&&(We.user_initiated=!0),O==="older"&&E!=null&&(We.before_offset=
E),O==="older"&&F!=null&&(We.before_id=F),O==="around"&&Z!=null&&(We.around_id=Z),we(We),it.current[C]=setTimeout(()=>{if(delete it.
current[C],hs.current[C]!==De)return;let Ce=Ve.current[C]||{};if(!Ce.inFlight)return;Ve.current[C]={...Ce,inFlight:!1};let Le=Number(
m.retryAttempt||0);if(Le<th&&nt.current?.readyState===WebSocket.OPEN){Na(C,{...m,mode:O,source:l,beforeOffset:E,beforeId:F,
chunkBytes:He,retryAttempt:Le+1});return}b($t=>{if($t[C]?.requestId!==De)return $t;let vn={...$t};return delete vn[C],vn}),
u($t=>({...$t,[C]:{...$t[C]||{},error:"Transcript history request timed out. Retry to load the latest messages."}}))},eh)}
function Ut(r){if(!r)return"";if(r.source_message_id)return`source${r.source_message_id}`;if(r.native_source_id)return`\
native${r.native_source_id}`;if(r.id!=null)return`id${r.id}`;if(r.server_message_id!=null)return`server${r.server_message_id}`;
if(r.sequence!=null&&r.ts!=null)return`seq${r.sequence}${r.ts}${r.role||""}`;if(r.client_msg_id)return`client${r.client_msg_id}`;
let m=Array.isArray(r.content_blocks)?JSON.stringify(r.content_blocks):"";return`${r.role||""}${r.content||""}${m}`}function ks(r,m,C){
let O=Array.isArray(r)?r:[],l=Array.isArray(m)?m:[];if(C==="older"){let K=new Set(O.map(Ut)),ge=[];return l.forEach(pe=>{
let De=Ut(pe);K.has(De)||(K.add(De),ge.push(pe))}),ge.length?[...ge,...O]:O}let x=Vd(O,l);if(x)return x;let E=new Set(O.
map(Ut)),F=[...O],Z=0;return l.forEach(K=>{let ge=Ut(K);E.has(ge)||(E.add(ge),F.push(K),Z++)}),Z?F:O}function br(r,m){let C=Array.
isArray(r)?r:[],O=Array.isArray(m)?m:[];if(!C.length)return O;if(!O.length)return C;let l=Vd(C,O);if(l)return l;let x=new Set(
C.map(Ut)),E=[...C],F=0;return O.forEach(Z=>{let K=Ut(Z);x.has(K)||(x.add(K),E.push(Z),F++)}),F?E:C}function Sa(r,m,C,O){
let l=Array.isArray(r)?r:[],x=Array.isArray(m)?m:[],E=new Set(Array.isArray(C?.baselineMessageKeys)?C.baselineMessageKeys:
[]);if((C?.source==="native"||O==="codex_cli_jsonl"||O==="cursor_cli_jsonl")&&E.size>x.length)return l;let Z=l.filter(K=>{
let ge=Ut(K);return ge&&!E.has(ge)});return Z.length===0?x:ks(x,Z,"tail")}function gn(r){return!r||typeof r!="object"?!1:
["codex","codex-desktop","cursor","codex_cli","cursor_cli","roo_code","cline"].includes(r.agent_type)}function It(r){r&&
(i(m=>({...m,[r]:[]})),z(m=>({...m,[r]:[]})),g(m=>({...m,[r]:!1})),k(m=>({...m,[r]:""})),L(m=>({...m,[r]:!1})),u(m=>({...m,
[r]:null})),b(m=>{if(!m[r])return m;let C={...m};return delete C[r],C}))}function ws(r,m,C,O={}){let l=`prompt-${Date.now()}\
-${Math.random().toString(36).slice(2,7)}`,x=typeof O.instruction=="string"?O.instruction.trim():"",E=fr.current[r],F=E?.
type==="question_prompt",Z=O.action==="cancel"?"cancel":"answer",K=C||(Z==="cancel"?"question_cancel":Array.isArray(O.answers)?
"question_answers":x?"alternate_instruction":null);J(ge=>ge[r]?{...ge,[r]:{...ge[r],submitting_choice_id:K,request_id:l,
error:null}}:ge),we(F?{type:"question_response",session_id:r,prompt_id:m,generation:E.generation,action:Z,...Z==="answer"?
{answers:O.answers||[]}:{},request_id:l}:{type:"permission_response",session_id:r,prompt_id:m,...C?{choice_id:C}:{},...Array.
isArray(O.answers)?{answers:O.answers}:{},...x?{instruction:x}:{},request_id:l})}function $n(r,m,C,O){let l=`errprompt-${Date.
now()}-${Math.random().toString(36).slice(2,7)}`;G(x=>x[r]?{...x,[r]:{...x[r],submitting_action_id:C,request_id:l,error:null}}:
x),we({type:"error_prompt_action",session_id:r,prompt_id:m,action_id:C,request_id:l,...C==="open_native_window"?{operator_user_gesture:O?.
isTrusted===!0}:{}})}function Ns(r){let m=`interrupt-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return we({
type:"agent_interrupt",session_id:r,request_id:m}),m}function Wt(r){let m=`cfg-${Date.now()}-${Math.random().toString(36).
slice(2,7)}`;we({type:"agent_config_request",session_id:r,request_id:m})}function ns(r,m){let C=`model-${Date.now()}-${Math.
random().toString(36).slice(2,7)}`,l=(f.current[r]||{}).config_semantics==="observed_and_next_send"?"next_send_model_id":
"model_id";return ht(r,"model",l,m,{type:"agent_set_model",model_id:m},C)}function hn(r,m){let C=`effort-${Date.now()}-${Math.
random().toString(36).slice(2,7)}`,l=(f.current[r]||{}).config_semantics==="observed_and_next_send"?"next_send_effort":"\
effort";return ht(r,"effort",l,m,{type:"agent_set_effort",effort:m},C)}function Ss(r,m){let C=`perm-${Date.now()}-${Math.
random().toString(36).slice(2,7)}`;return ht(r,"permission_mode","permission_mode",m,{type:"agent_set_permission_mode",mode:m},
C)}function zt(r,m){let C=`autoperm-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return ht(r,"auto_approve_pe\
rmissions","auto_approve_permissions",!!m,{type:"agent_set_auto_approve_permissions",enabled:!!m},C)}function Cs(r,m){let C=`\
mode-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,O=Object.prototype.hasOwnProperty.call(f.current[r]||{},"co\
nversation_mode")?"conversation_mode":"mode";return ht(r,"mode",O,m,{type:"agent_set_mode",mode:m},C)}function En(r,{model_id:m,
effort:C,speed:O,access_mode:l,permission_profile:x,confirm_bypass:E,workspace_mode:F}){let Z=`codex-cfg-${Date.now()}-${Math.
random().toString(36).slice(2,7)}`,K=f.current[r]||{},ge=[["model","model_id",m],["effort","effort",C],["speed","speed",
O],["access_mode","permission_mode",l],["workspace_mode","workspace_mode",F],["permission_profile","permission_profile",
x]],[pe,De,He]=ge.find(([,,We])=>We!=null)||["codex_config","model_id",m];return ht(r,pe,De,He,{type:"set_codex_config",
model_id:m,effort:C,speed:O,access_mode:l,permission_profile:x,confirm_bypass:E,workspace_mode:F,source_revision:K.source_revision},
Z)}function Ye(r){let m=`new-thread-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return It(r),we({type:"new_t\
hread",session_id:r,request_id:m}),m}function vr(r){let m=`panel-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
return we({type:"open_panel",session_id:r,request_id:m}),m}function Gt(r,m){let C=`native-${Date.now()}-${Math.random().
toString(36).slice(2,7)}`;return we({type:"open_native_window",session_id:r,request_id:C,operator_user_gesture:m?.isTrusted===
!0}),C}function yr(r){let m=`chatlist-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return we({type:"chat_list",
session_id:r,request_id:m}),m}function ji(r,m){let C=`switch-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return we(
{type:"switch_chat",session_id:r,chat_id:m,request_id:C}),C}function bo(r){let m=`newchat-${Date.now()}-${Math.random().
toString(36).slice(2,7)}`;return we({type:"new_chat",session_id:r,request_id:m}),m}function Ca(r){let m=`threads-${Date.
now()}-${Math.random().toString(36).slice(2,7)}`;return we({type:"thread_list",session_id:r,request_id:m}),m}function Xs(r,m){
let C=`swthread-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return It(r),we({type:"switch_thread",session_id:r,
thread_id:m,request_id:C}),C}function xa(r){let m=`term-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return we(
{type:"terminal_output",session_id:r,request_id:m}),m}function kr(r,m){let C=`termin-${Date.now()}-${Math.random().toString(
36).slice(2,7)}`;return we({type:"terminal_input",session_id:r,request_id:C,text:m}),C}function wr(r){let m=`diff-${Date.
now()}-${Math.random().toString(36).slice(2,7)}`;return we({type:"file_changes",session_id:r,request_id:m}),m}function Bi(r,m,C){
let O=`filechg-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return we({type:"file_change_response",session_id:r,
change_id:m,action:C,request_id:O}),O}function vo(r,m){let C=`dir-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
return we({type:"list_directory",session_id:r,request_id:C,path:m||"."}),C}function Nr(r,m){let C=`file-${Date.now()}-${Math.
random().toString(36).slice(2,7)}`;return we({type:"read_file",session_id:r,request_id:C,path:m}),C}function Aa(r){let m=`\
skills-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return we({type:"skill_list",session_id:r,request_id:m}),
m}function Fi(r){let m=`automation-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return we({type:"automation_v\
iew_action",session_id:r,request_id:m}),m}function _n(r,m,C,O){let l=`attach-${Date.now()}-${Math.random().toString(36).
slice(2,7)}`;return we({type:"send_attachment",session_id:r,request_id:l,data:m,mime_type:C,filename:O}),l}function Hi(r,m){
let C=`swws-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return ht(r,"workspace","file_access_scope",m,{type:"\
switch_workspace",folder_path:m},C)}function bn(r){let m=`branches-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
return we({type:"branch_list",session_id:r,request_id:m}),m}function Ui(r,m){let C=`swbranch-${Date.now()}-${Math.random().
toString(36).slice(2,7)}`;return we({type:"switch_branch",session_id:r,branch_name:m,request_id:C}),C}function xs(r,m){let C=`\
newbranch-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return we({type:"create_branch",session_id:r,branch_name:m,
request_id:C}),C}function yo(r,m,C={}){let O=`launch-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return ve(l=>cs(
l,O,{status:"launching",agentType:r})),we({type:"launch_session",agent_type:r,workspace_path:m||void 0,model_id:C.model_id||
void 0,permission_mode:C.permission_mode||void 0,effort:C.effort||void 0,request_id:O}),O}function Wi(r,m,C,O={}){let l=`\
resume-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return ve(x=>cs(x,l,{status:"launching",agentType:m})),we(
{type:"resume_session",source_session:r,agent_type:m||"claude",workspace_path:C||void 0,cli_session_id:O.cli_session_id||
void 0,model_id:O.model_id||void 0,permission_mode:O.permission_mode||void 0,request_id:l}),l}function ko(r,m){we(m?{type:"\
dismiss_session",session:r}:{type:"close_session",session:r})}function wo(r,m,C=""){let O=C||`cmsg-${Date.now()}-${Math.
random().toString(36).slice(2,8)}`;An(O,r);let l=C?(Lc[r]||[]).find(E=>E._cid===O):null,x=Xa(l)?.iso||new Date().toISOString();
return i(E=>{let F=E[r]||[],Z=C&&F.some(K=>K._cid===O);return{...E,[r]:Z?F.map(K=>K._cid===O?{...K,content:m,_optimistic:!0,
_delivered:!1,_agentStarted:!1,_sendError:null}:K):[...F,Qa({role:"user",content:m,_cid:O,_optimistic:!0,created_at:x})]}}),
nt.current?.readyState===WebSocket.OPEN?(lt(O,"queued"),Ge(O,"queued","Timed out waiting for relay acceptance."),we({type:"\
send",session:r,content:m,client_message_id:O,created_at:x})):Kn.current.length<20?(Kn.current=[...Kn.current.filter(E=>E.
cid!==O),{session:r,content:m,cid:O,created_at:x}],xn(O),lt(O,"offline_queued")):(lt(O,"queued"),pn(O,"Offline send queu\
e is full. Reconnect or retry after another message sends.")),O}function No(){let r=nt.current;if(!r||r.readyState!==WebSocket.
OPEN||Kn.current.length===0)return;let m=Kn.current;Kn.current=[],m.forEach(C=>{An(C.cid,C.session),lt(C.cid,"queued"),Ge(
C.cid,"queued","Timed out waiting for relay acceptance after reconnect."),r.send(JSON.stringify({type:"send",session:C.session,
content:C.content,client_message_id:C.cid,created_at:C.created_at}))})}function So(r,m,C,O){let l={type:"steer",session_id:r,
client_message_id:m,content:C};O!=null&&(l.native_index=O),we(l),m&&m.startsWith("native-")&&z(x=>({...x,[r]:(x[r]||[]).
filter(E=>E.cid!==m)}))}function Co(r,m){xn(m),delete At.current[m],delete fs.current[m],we({type:"discard_queued",session_id:r,
client_message_id:m}),z(C=>({...C,[r]:(C[r]||[]).filter(O=>O.cid!==m)})),ee(C=>{let O={...C};return delete O[m],O}),i(C=>{
let O=C[r]||[];return{...C,[r]:O.filter(l=>l._cid!==m)}})}function xo(r,m,C){z(O=>({...O,[r]:(O[r]||[]).map(l=>l.cid===m?
{...l,content:C,content_blocks:(l.content_blocks||[]).map(x=>x?.type==="queued_message"?{...x,content:C}:x)}:l)})),i(O=>{
let l=O[r]||[];return{...O,[r]:l.map(x=>x._cid===m?{...x,content:C}:x)}}),we({type:"edit_queued",session_id:r,client_message_id:m,
content:C})}function ss(r){r?.id&&_e(m=>{let C=m.filter(O=>O.id!==r.id);return["completed","cancelled"].includes(r.state)?
C:[r,...C]})}async function Kt(){let r=await fetch("/api/scheduled-sends",{credentials:"same-origin"});if(!r.ok)throw new Error(
`Could not load scheduled sends (${r.status})`);let m=await r.json();return _e((m.scheduled_sends||[]).filter(C=>!["comp\
leted","cancelled"].includes(C.state))),m.scheduled_sends||[]}async function Sr(r,m,C,O=null){let l=await fetch("/api/sc\
heduled-sends",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify(
{session_id:r,content:m,trigger_kind:C,...C==="at"?{deliver_at:O}:{}})}),x=await l.json().catch(()=>({}));if(!l.ok)throw new Error(
x.error||`Could not schedule message (${l.status})`);return ss(x.scheduled_send),x.scheduled_send}async function Ra(r){let m=await fetch(
`/api/scheduled-sends/${encodeURIComponent(r)}`,{method:"DELETE",credentials:"same-origin"}),C=await m.json().catch(()=>({}));
if(!m.ok)throw new Error(C.error||`Could not cancel scheduled message (${m.status})`);return ss(C.scheduled_send),C.scheduled_send}
function Oe(r,m){if(!r?.stream_trace||typeof window>"u")return;let C={...r.stream_trace,session_id:m||r.session||r.session_id||
""},O=window.requestAnimationFrame||(l=>window.setTimeout(l,16));O(()=>O(()=>{let l=Array.isArray(window.__RAC_STREAM_TRACES__)?
window.__RAC_STREAM_TRACES__:[];l.push({...C,browser_paint_at_ms:Date.now()}),l.length>500&&l.splice(0,l.length-500),window.
__RAC_STREAM_TRACES__=l}))}function Ao(r){let m=r.type;if(!zs.current.accept(r)||m==="navigation_started")return;m==="co\
nnection_ack"&&Rt.current.reset(r.state_epoch);let C=r.session||r.session_id||"",O=m==="session_list"||m==="session_snap\
shot"||m==="proxy_session_snapshot"?"session_list":(m==="status"||m==="proxy_status"||m==="session_status"||m==="session\
_summary"||m==="session_patch")&&C?`status:${C}`:"";if(!(O&&!Rt.current.accept(r,O))){if(m==="heartbeat_ack"){dn(r);return}
if(m==="provider_usage_snapshot"){r.snapshot&&typeof r.snapshot=="object"&&oo(l=>Vc(l,r.snapshot));return}if(m==="provid\
er_usage_threshold"){let l=new Set(Array.isArray(r.affected_session_ids)?r.affected_session_ids.map(String):[]);l.size>0&&
s(x=>x.map(E=>{let F=typeof E=="string"?E:E?.session_id;return l.has(F)?{...typeof E=="object"?E:{},session_id:F,percent_used:Number.
isFinite(Number(r.percent_used))?Number(r.percent_used):null,rate_limit_active:r.hard_limited===!0,rate_limited_until:r.
reset_hint||"unknown",usage_limit_provider:r.provider_id||null,usage_limit_window:r.window_label||r.window_id||null}:E}));
return}if(m==="provider_usage_refresh_receipt"){pa(l=>!l||!r.request_id||l.requestId===r.request_id?{requestId:r.request_id||
l?.requestId||"",status:r.status||"error",...r}:l);return}if(m==="provider_usage_reset_credit_receipt"){ma(l=>l?.requestId&&
r.request_id!==l.requestId?l:{requestId:r.request_id,status:r.status||"error",outcome:r.outcome||null,availableCount:r.reset_credits_available,
error:r.code||null});return}if(m==="provider_usage_cost_detail"){Un(l=>l?.requestId===r.request_id?{...l,status:"ready",
detail:r.detail,error:null}:l);return}if(m==="provider_usage_cost_detail_error"){Un(l=>l?.requestId===r.request_id?{...l,
status:"error",error:r.code||"cost_detail_failed"}:l);return}if(m==="host_resource_snapshot"){r.snapshot&&typeof r.snapshot==
"object"&&(qt(r.snapshot),Sn(null));return}if(m==="host_resource_subscription_ack"){if(!st.current.active||r.request_id!==
wt.current||typeof r.subscription_id!="string")return;let l=ze.current,x=r.subscription_id,E=r.resumed===!0&&l===x,F=r.aggregate_only===
!0,Z=l===x&&ba.current!==F;ze.current=x,ba.current=F,wt.current="",E?Z&&F&&(zn(K=>qs([],K,60)),ps([]),qt(null),Yn.current.
detail="",Mt.current.detail=0,ln.current.detail=0):(zn([]),ps([]),qt(null),Mt.current={system:0,detail:0},ln.current={system:0,
detail:0}),Fs({id:x,status:"live",aggregateOnly:F,resumed:E,consumerCount:st.current.consumerCount,detailConsumerCount:st.
current.detailConsumerCount}),Ft("system",E?Mt.current.system:0),F||Ft("detail",E?Mt.current.detail:0),st.current.aggregateOnly!==
F&&Tt(st.current.aggregateOnly,x);return}if(m==="host_resource_history_chunk"){let l=r.chunk,x=l?.stream==="detail"?"det\
ail":l?.stream==="system"?"system":"";if(!x||r.subscription_id!==ze.current||r.request_id!==Yn.current[x])return;let E=Array.
isArray(l.points)?l.points:[];if(x==="system"){let Z=st.current.aggregateOnly?60:900;zn(K=>qs(K,E,Z))}else{if(st.current.
aggregateOnly)return;ps(K=>qs(K,E,180));let Z=E.filter(K=>K&&typeof K=="object").sort((K,ge)=>Number(K.sample_sequence||
0)-Number(ge.sample_sequence||0)).at(-1);Z&&qt(Z)}let F=Math.max(Mt.current[x],Math.round(Number(l.next_sequence)||0));Mt.
current[x]=F,Yn.current[x]="",l.done!==!0&&Ft(x,F);return}if(m==="host_resource_live"){let l=r.point,x=Number(l?.sample_sequence);
if(r.subscription_id!==ze.current||!Number.isSafeInteger(x)||x<=ln.current.system)return;ln.current.system=x,Mt.current.
system=Math.max(Mt.current.system,x);let E=st.current.aggregateOnly?60:900;zn(F=>qs(F,l,E)),Sn(null);return}if(m==="host\
_resource_detail"){if(st.current.aggregateOnly)return;let l=r.snapshot,x=Number(l?.sample_sequence);if(r.subscription_id!==
ze.current||!Number.isSafeInteger(x)||x<=ln.current.detail)return;ln.current.detail=x,Mt.current.detail=Math.max(Mt.current.
detail,x),ps(E=>qs(E,l,180)),qt(l),Sn(null);return}if(m==="host_resource_unsubscribed")return r.subscription_id&&r.subscription_id!==
ze.current,void 0;if(m==="host_resource_error"){Sn({code:r.code||"unavailable",message:r.message||"Windows host metrics \
are unavailable."});return}if(m==="semantic_notification"){mr(l=>Ic(l,r));return}if(!_a.current&&!r.request_id&&ah.has(m)){
let l=r.session||r.session_id||"global",x=m==="history_chunk"?r.source||"native":"";for(on.current.set(`${m}:${l}:${x}`,
r);on.current.size>256;)on.current.delete(on.current.keys().next().value);return}if(m==="session_list"){Tn(r.sessions||[]),
t(l=>Fr(l,r.sessions||[])),es(r.sessions||[]),vs(r.sessions||[]),ys(r.sessions||[]),ts(r.sessions||[]),(r.sessions||[]).
forEach(l=>{let x=l&&typeof l=="object"?l.session_id:l,E=gn(l);l&&typeof l=="object"&&l.is_list_view&&!E&&x&&i(F=>F[x]&&
F[x].length>0?{...F,[x]:[]}:F)}),Array.isArray(r.workspaces)&&te(l=>en(l,r.workspaces)?l:r.workspaces);return}if(m==="se\
ssion_snapshot"||m==="proxy_session_snapshot"){Tn(r.sessions||[]),t(l=>Fr(l,r.sessions||[])),es(r.sessions||[]),vs(r.sessions||
[]),ys(r.sessions||[]),ts(r.sessions||[]),(r.sessions||[]).forEach(l=>{let x=l&&typeof l=="object"?l.session_id:l,E=gn(l);
l&&typeof l=="object"&&l.is_list_view&&!E&&x&&i(F=>F[x]&&F[x].length>0?{...F,[x]:[]}:F)});return}if(m==="connection_ack"){
if(un(r),Array.isArray(r.semantic_notifications)&&mr(l=>Ic(l,r.semantic_notifications)),No(),Kt().catch(()=>{}),so(Array.
isArray(r.duplicate_proxy_alarms)?r.duplicate_proxy_alarms:[]),ao(Array.isArray(r.nightly_validation_failures)?r.nightly_validation_failures:
[]),ur(r.latest_app_update_validation||null),r.provider_usage&&typeof r.provider_usage=="object"&&oo(l=>Vc(l,r.provider_usage)),
r.sessions&&r.sessions.length>0&&(t(l=>Fr(l,r.sessions)),es(r.sessions),vs(r.sessions),ys(r.sessions),ts(r.sessions),r.sessions.
forEach(l=>{let x=gn(l);if(l&&typeof l=="object"&&l.is_list_view&&!x){let E=l.session_id;E&&i(F=>F[E]&&F[E].length>0?{...F,
[E]:[]}:F)}})),Array.isArray(r.workspaces)&&te(l=>en(l,r.workspaces)?l:r.workspaces),r.session_health){let l={};Object.entries(
r.session_health).forEach(([x,E])=>{l[x]=typeof E=="object"?E.health:E}),V(x=>Ds(x,l))}r.agent_configs&&typeof r.agent_configs==
"object"&&P(l=>({...l,...r.agent_configs}));{let l={};[...r.open_prompts||[],...r.open_question_prompts||[]].forEach(x=>{
let E=x.session_id||x.session;E&&(l[E]={...x,received_at:Date.now()})}),J(l)}{let l={};(r.open_error_prompts||[]).forEach(
x=>{let E=x.session_id||x.session;E&&(l[E]={...x,received_at:Date.now()})}),G(l)}ka();return}if(m==="session_patch"){let l=r.
session||r.session_id;if(!l)return;t(F=>ld(F,r));let x=r.patch&&typeof r.patch=="object"?r.patch:{},E={session_id:l,...x};
x.activity&&es([E]),(x.model_id!==void 0||x.permission_mode!==void 0||x.capabilities!==void 0)&&vs([E]),x.chat_list&&ys(
[E]),x.status&&ts([E]);return}if(m==="session_health"){let l=r.session||r.session_id;l&&V(x=>({...x,[l]:r.health}));return}
if(m==="scheduled_send_status"){ss(r.scheduled_send);return}if(m==="session_summary"){let l=r.session||r.session_id;if(!l)
return;if(s(x=>x.map(E=>(typeof E=="string"?E:E?.session_id)!==l?E:{...typeof E=="object"?E:{},session_id:l,...r.status?
{status:r.status}:{},...r.activity?{activity:r.activity}:{},...r.goal?{goal:r.goal}:{},...r.fleet_summary?{fleet_summary:r.
fleet_summary}:{},...r.fleet_work_context?{fleet_work_context:r.fleet_work_context}:{},...r.last_user_request?{last_user_request:r.
last_user_request}:{},...r.last_snippet!=null?{last_snippet:r.last_snippet}:{},...jc(r),...ed(r)})),r.status&&V(x=>({...x,
[l]:r.status})),r.activity){let x=String(r.activity.kind||"idle").toLowerCase();Ao({type:"status",session:l,activity:r.activity,
activity_trace:r.activity_trace,thinking:["thinking","generating","running_command","applying_patch","reading_files","wo\
rking"].includes(x),label:r.activity.label||""})}Number(r.unread_delta)>0&&l!==Ws.current&&d(x=>({...x,[l]:(x[l]||0)+Number(
r.unread_delta)}));return}if(m==="message_delta"){let l=r.session_id||r.session;if(!l)return;let x=zu(ct.current[l]||null,
r);if(!x.accepted)return;po(l,x.stream,r.stream_trace||null);return}if(m==="transcript_resync_required"){let l=r.session_id||
r.session;if(!l||l!==Ws.current)return;let x=Ve.current[l]||{};Ve.current[l]={...x,inFlight:!1},clearTimeout(it.current[l]),
delete it.current[l],Na(l,{mode:"tail",source:"relay_sqlite",replace:!0});return}if(m==="history"||m==="history_snapshot"){
let l=r.session||r.session_id;if(!l||r.request_id&&rn.current[l]&&rn.current[l]!==r.request_id)return;let x=n.find(pe=>(typeof pe==
"object"?pe.session_id:pe)===l),E=gn(x);if(x&&typeof x=="object"&&x.is_list_view&&r.messages?.length>0&&!E){b(pe=>{if(!pe[l])
return pe;let De={...pe};return delete De[l],De});return}!r.partial&&(!r.mode||r.mode==="full")&&ya(l);let F=r.messages||
[],Z=c[l]||null,K=!!Gs.current[l]&&F.length>0,ge=!K&&oh(m,r,Z);i(pe=>{let De=ge?br(pe[l],F):F,He=Kr(Kd(De,pe[l]));return He===
pe[l]?pe:{...pe,[l]:He}}),u(pe=>{let De={...ge?pe[l]||{}:{},partial:!!r.partial||!!(ge&&pe[l]?.partial),loaded:ge?Math.max(
Number(pe[l]?.loaded||0),Number(r.loaded_messages??F.length)||F.length,(a[l]||[]).length):Number(r.loaded_messages??F.length)||
F.length,total:Number(r.total_messages??pe[l]?.total??F.length)||F.length,limit:r.limit||null,mode:ge?pe[l]?.mode||"chun\
ked":r.mode||(r.partial?"tail":"full")};return en(pe[l]||null,De)?pe:{...pe,[l]:De}}),b(pe=>{if(!pe[l])return pe;let De={
...pe};return delete De[l],De}),K&&delete Gs.current[l];return}if(m==="history_chunk"){let l=r.session||r.session_id;if(!l)
return;let x=Ve.current[l]||{},E=r.mode!=="older"&&x.mode==="tail"&&(r.source||"relay_sqlite")===(x.source||"relay_sqlit\
e");if(r.request_id&&hs.current[l]&&hs.current[l]!==r.request_id&&!E)return;if(r.error&&(!Array.isArray(r.messages)||r.messages.
length===0)){b(Ce=>{if(!Ce[l])return Ce;let Le={...Ce};return delete Le[l],Le}),Ve.current[l]={...Ve.current[l]||{},inFlight:!1},
clearTimeout(it.current[l]),delete it.current[l],u(Ce=>({...Ce,[l]:{...Ce[l]||{},error:String(r.error?.message||r.error||
"Transcript history could not be loaded.")}}));return}let F=r.mode==="older"?"older":r.mode==="around"?"around":"tail",Z=r.
cursor||{},K=Z.next_before_offset??null,ge=Z.next_before_id??null,pe=!!(r.partial&&(K!=null||ge!=null)),De=Array.isArray(
r.messages)?r.messages:[],He=F==="around"||F==="tail"&&r.replace===!0,Nt=(He?De:ks(a[l],De,F)).length;i(Ce=>{let Le=Kr(Kd(
He?Sa(Ce[l],De,x,r.source):ks(Ce[l],De,F),Ce[l]));return Le===Ce[l]?Ce:{...Ce,[l]:Le}}),u(Ce=>{let Le={...Ce[l]||{},partial:pe,
loaded:He?Number(r.loaded_messages??Nt)||Nt:Math.max(Number(Ce[l]?.loaded||0),Number(r.loaded_messages||0),Nt),total:Number(
r.total_messages||Ce[l]?.total||Nt)||Nt,limit:null,mode:"chunked",source:r.source||"native",cursor:Z,bytes_total:Z.total_bytes||
0};return delete Le.error,en(Ce[l]||null,Le)?Ce:{...Ce,[l]:Le}}),b(Ce=>{if(!Ce[l])return Ce;let Le={...Ce};return delete Le[l],
Le}),Ve.current[l]={...Ve.current[l]||{},inFlight:!1,nextBeforeOffset:K,nextBeforeId:ge},clearTimeout(it.current[l]),delete it.
current[l];return}if(m==="history_delta"){let l=r.session||r.session_id;if(!l||r.request_id&&rn.current[l]&&rn.current[l]!==
r.request_id)return;let E=(Array.isArray(r.messages)?r.messages:Array.isArray(r.events)?r.events:[]).map(Z=>Z?.message||
Z).filter(Boolean),F=ks(a[l],E,"tail");i(Z=>{let K=Kr(ks(Z[l],E,"tail"));return K===Z[l]?Z:{...Z,[l]:K}}),u(Z=>{let K=Z[l]||
{},ge=Math.max(Number(K.loaded||0),F.length),pe=Math.max(Number(r.total_messages||0),Number(K.total||0),ge);return{...Z,
[l]:{...K,loaded:ge,total:pe,last_sequence:Number(r.last_sequence||K.last_sequence||0),mode:K.mode||"chunked"}}}),b(Z=>{
if(Z[l]?.requestId!==r.request_id)return Z;let K={...Z};return delete K[l],K});return}if(m==="status"||m==="proxy_status"||
m==="session_status"){let l=r.session||r.session_id;if(!l)return;let x=r.activity?.kind||"",E=r.thinking||["thinking","g\
enerating","running_command","applying_patch","reading_files","working"].includes(x);Wu(ct.current[l],r.activity||(E?null:
{kind:"idle"}),E)&&ya(l);let F=r.label||r.activity?.label||(x==="idle"?"":"Thinking"),Z=E||r.activity?{kind:r.activity?.
kind||(E?"thinking":"working"),label:F,updatedAt:r.activity?.updated_at||null,observed_at:r.activity?.observed_at||null,
startedAt:r.activity?.started_at||null,interruptHint:r.activity?.interrupt_hint||"",goal:r.activity?.goal||null,goal_run:r.
activity?.goal_run||null,thinking:r.activity?.thinking||null,current:r.activity?.current||null,step:r.activity?.step||null,
usage:r.activity?.usage||null,task_list:r.activity?.task_list||null,context_card:r.activity?.context_card||null,thinkingContent:r.
activity?.thinking?.text||r.activity?.thinkingContent||"",transport:yd(r.activity_trace)}:!1;if(E){clearTimeout(sn.current[l]),
g(ge=>Object.is(ge[l],F)?ge:{...ge,[l]:F}),L(ge=>Ds(ge,{[l]:Z}));let K=r.activity?.thinking?.text??r.thinking_content??r.
activity?.thinkingContent;K!=null&&k(ge=>Object.is(ge[l],K)?ge:{...ge,[l]:K})}else x==="idle"?(clearTimeout(sn.current[l]),
g(K=>K[l]===!1?K:{...K,[l]:!1}),L(K=>{let ge=Z;return Object.is(K[l],ge)?K:{...K,[l]:ge}}),k(K=>K[l]===""?K:{...K,[l]:""})):
r.activity?.goal||r.activity?.task_list||r.activity?.step||r.activity?.usage?(clearTimeout(sn.current[l]),g(K=>K[l]===!1?
K:{...K,[l]:!1}),L(K=>Ds(K,{[l]:Z}))):(clearTimeout(sn.current[l]),sn.current[l]=setTimeout(()=>{g(K=>K[l]===!1?K:{...K,
[l]:!1}),L(K=>K[l]===!1?K:{...K,[l]:!1}),k(K=>K[l]===""?K:{...K,[l]:""})},4e3));Oe(r,l);return}if(m==="permission_prompt"){
let l=r.session_id||r.session;l&&J(x=>({...x,[l]:{...r,received_at:Date.now()}}));return}if(m==="question_prompt"){let l=r.
session_id||r.session;l&&J(x=>{let E=x[l],F=E?.prompt_id===r.prompt_id&&E?.generation===r.generation;return{...x,[l]:{...F?
E:{},...r,received_at:F?E.received_at:Date.now(),...r.lifecycle==="submitting"?{submitting_choice_id:E?.submitting_choice_id||
"question_answers"}:{}}}});return}if(m==="question_prompt_state"){let l=r.session_id||r.session;l&&r.lifecycle==="failed"?
J(x=>{let E=x[l],F=E?.prompt_id===r.prompt_id&&E?.generation===r.generation;return E&&!F?x:{...x,[l]:{...F?E:{},...r,type:"\
question_prompt",received_at:F?E.received_at:Date.now(),submitting_choice_id:null}}}):l&&!["open","submitting"].includes(
r.lifecycle)&&J(x=>{let E=x[l];if(E?.prompt_id!==r.prompt_id||E?.generation!==r.generation)return x;let{[l]:F,...Z}=x;return Z});
return}if(m==="permission_prompt_expired"){let l=r.session_id||r.session;l&&J(x=>{let{[l]:E,...F}=x;return F});return}if(m===
"session_error_prompt"){let l=r.session_id||r.session;l&&G(x=>({...x,[l]:{...r,received_at:Date.now()}}));return}if(m===
"session_error_prompt_cleared"){let l=r.session_id||r.session;l&&G(x=>{let{[l]:E,...F}=x;return F});return}if(m==="chat_\
list"){let l=r.session_id||r.session;l&&ie(x=>({...x,[l]:r.chats||[]}));return}if(m==="branch_list"){let l=r.session_id||
r.session;l&&de(x=>({...x,[l]:{branches:r.branches||[],current:r.current||""}}));return}if(m==="thread_list"){let l=r.session_id||
r.session;if(l){let x=r.threads||[],E=x.find(K=>K?.active),F=String(E?.cache_key||""),Z=gt.current[l]||"";F&&Z&&F!==Z&&(Gs.
current[l]=F,It(l)),F&&(gt.current[l]=F),Ne(K=>({...K,[l]:x}))}return}if(m==="duplicate_proxy_alarm"){so(Array.isArray(r.
duplicate_sessions)?r.duplicate_sessions:[]);return}if(m==="nightly_validation_status"){ao(Array.isArray(r.failures)?r.failures:
[]);return}if(m==="app_update_validation_status"){ur(r.validation||null);return}if(m==="skill_list"){let l=r.session_id||
r.session;l&&D(x=>({...x,[l]:{installed:r.installed||[],recommended:r.recommended||[]}}));return}if(m==="codex_automatio\
n_view"){let l=r.session_id||r.session;l&&ke(x=>({...x,[l]:r.view||null}));return}if(m==="terminal_output"){let l=r.session_id||
r.session;l&&Ee(x=>({...x,[l]:r.entries||[]}));return}if(m==="file_changes"){let l=r.session_id||r.session;l&&Ie(x=>({...x,
[l]:r.entries||[]}));return}if(m==="directory_listing"){let l=r.session_id||r.session;l&&ds(x=>({...x,[l]:{path:r.path,entries:r.
entries||[]}}));return}if(m==="file_content"){let l=r.session_id||r.session;l&&lr(x=>cs(x,`${l}:${r.path}`,{path:r.path,
content:r.content,truncated:r.truncated}));return}if(m==="agent_config"){let l=r.session_id||r.session;if(!l)return;fn(l,
r),P(x=>{let E=x[l]||{},F={...E,...r};return(!Array.isArray(r.available_models)||r.available_models.length===0)&&Array.isArray(
E.available_models)&&E.available_models.length>0&&(F.available_models=E.available_models),Object.values(ot.current).forEach(
Z=>{Z.sessionId!==l||!["pending","awaiting_config"].includes(Z.status)||(F[Z.configKey]=Z.requestedValue)}),f.current={...f.
current,[l]:F},{...x,[l]:F}});return}if(m==="agent_control_result"){let l=r.session_id||r.session;if(r.request_id){et(E=>cs(
E,r.request_id,{...r,received_at:Date.now()}));let x=Object.entries(ot.current).find(([,E])=>E.requestId===r.request_id&&
E.sessionId===l&&["pending","awaiting_config"].includes(E.status));if(x){let[E,F]=x;r.result==="failed"?Ys(E,r.error?.message||
r.error||"The agent rejected this setting."):r.result==="ok"&&(Ht(E,{...F,status:"awaiting_config"}),l&&Wt(l))}}l&&r.result===
"ok"&&r.command==="new_thread"&&It(l),l&&r.result==="ok"&&["new_thread","switch_thread"].includes(r.command)&&Ca(l),l&&r.
result==="ok"&&r.command==="switch_chat"&&yr(l),["permission_response","question_response"].includes(r.command)&&l&&(r.result===
"ok"?J(x=>{if(x[l]?.request_id!==r.request_id)return x;let{[l]:E,...F}=x;return F}):r.result==="failed"&&J(x=>x[l]?.request_id===
r.request_id?{...x,[l]:{...x[l],submitting_choice_id:null,error:r.error?.message||"Permission response failed"}}:x)),r.command===
"error_prompt_action"&&l&&r.result==="failed"&&G(x=>x[l]?{...x,[l]:{...x[l],submitting_action_id:null,error:r.error?.message||
"Error prompt action failed"}}:x),r.command==="file_change_response"&&l&&r.result==="ok"&&wr(l);return}if(m==="message_a\
ccepted"){let l=r.client_message_id,x=r.session_id||r.session;l&&x&&An(l,x);let E=["accepted","delivered","agent_started",
"failed"].includes(r.status)?r.status:"accepted",F=E==="accepted"&&r.launch_accepted_at?"launch_accepted":E;if(l&&F==="f\
ailed"){pn(l,r.failure_code||"Send failed",x);return}let Z=l?At.current[l]:null;l&&!["busy_queued","steered","launch_acc\
epted","delivered","agent_started"].includes(Z)&&(lt(l,F),F==="accepted"?Ge(l,"accepted","Relay accepted the message, bu\
t native delivery timed out."):F==="launch_accepted"?Ge(l,"launch_accepted","The native launch was accepted, but no nati\
ve user turn was observed."):F==="delivered"?Ge(l,"delivered","Message reached the agent, but agent activity did not sta\
rt in time."):xn(l)),l&&Rn(l,x,K=>Qa({...K,...r.created_at!=null?{created_at:r.created_at}:{},...r.timestamp!=null?{timestamp:r.
timestamp}:{},...r.ts!=null?{ts:r.ts}:{},...r.launch_accepted_at!=null?{_launchAcceptedAt:r.launch_accepted_at}:{},_delivered:F===
"delivered"||F==="agent_started",_agentStarted:F==="agent_started",_sendError:null}));return}if(m==="proxy_send_result"&&
r.result==="launch_accepted"){let l=r.client_message_id,x=r.session_id||r.session;l&&x&&An(l,x),l&&!["delivered","agent_\
started"].includes(At.current[l])&&(lt(l,"launch_accepted"),Ge(l,"launch_accepted","The native launch was accepted, but \
no native user turn was observed."),Rn(l,x,E=>({...E,_launchAcceptedAt:r.accepted_at||new Date().toISOString(),_sendError:null})));
return}if(m==="message_delivered"||m==="proxy_send_result"&&r.result==="delivered"){let l=r.client_message_id,x=r.session_id||
r.session;l&&x&&An(l,x),l&&At.current[l]!=="agent_started"&&(lt(l,"delivered"),Ge(l,"delivered","Message reached the age\
nt, but agent activity did not start in time.")),l&&Rn(l,x,E=>({...E,_delivered:!0,_sendError:null}));return}if(m==="age\
nt_started"){let l=r.client_message_id,x=r.session_id||r.session;l&&x&&An(l,x),l&&(xn(l),lt(l,"agent_started")),x&&mo(x,
l||null),l&&Rn(l,x,E=>({...E,_delivered:!0,_agentStarted:!0,_sendError:null}));return}if(m==="message_failed"||m==="prox\
y_send_result"&&r.result==="failed"){let l=r.client_message_id,x=r.session_id||r.session;if(x&&ya(x),l){let E=r.reason||
r.message||r.error?.message||"Send failed";pn(l,E,x)}return}if(m==="message_queued"){let l=r.client_message_id,x=r.session_id||
r.session;if(l){let E=Array.isArray(r.content_blocks)?r.content_blocks:[],F=E.find(Z=>Z?.type==="queued_message");xn(l),
lt(l,"busy_queued"),x&&z(Z=>({...Z,[x]:[...Z[x]||[],{cid:l,content:F?.content??r.content,content_blocks:E,queuedAt:r.queued_at}]}))}
return}if(m==="queue_delivered"){let l=r.client_message_id,x=r.session_id||r.session;l&&(lt(l,"accepted"),Ge(l,"accepted",
"Queued message left the relay, but native delivery timed out."),x&&z(E=>({...E,[x]:(E[x]||[]).filter(F=>F.cid!==l)})));
return}if(m==="steer_result"){let l=r.client_message_id,x=r.session_id||r.session;l&&(r.result==="ok"?(lt(l,"steered"),Ge(
l,"steered","Message was steered, but agent activity did not start in time.")):pn(l,r.error?.message||r.error||"The desk\
top proxy rejected the message.",x),x&&z(E=>({...E,[x]:(E[x]||[]).filter(F=>F.cid!==l)})));return}if(m==="native_queue"){
let l=r.session_id||r.session,x=r.items||[];l&&z(E=>{let F=(E[l]||[]).filter(K=>K.cid&&K.cid.startsWith("cmsg-")),Z=x.map(
(K,ge)=>({cid:`native-${ge}`,content:K.content_blocks?.find(pe=>pe?.type==="queued_message")?.content??K.text,content_blocks:Array.
isArray(K.content_blocks)?K.content_blocks:[],native:!0,nativeIndex:K.index,status:K.state||"queued"}));return{...E,[l]:[
...F,...Z]}});return}if(m==="rate_limit_active"){let l=r.session_id||r.session,x=r.percent_used??null,E=x==null||x>=100;
l&&s(F=>F.map(Z=>(typeof Z=="string"?Z:Z?.session_id)===l?{...typeof Z=="object"?Z:{},session_id:l,rate_limited_until:r.
retry_after_hint||(E?"unknown":null),rate_limit_active:E,percent_used:x}:Z));return}if(m==="rate_limit_cleared"){let l=r.
session_id||r.session;l&&s(x=>x.map(E=>(typeof E=="string"?E:E?.session_id)===l?{...typeof E=="object"?E:{},session_id:l,
rate_limited_until:null,rate_limit_active:!1,percent_used:null}:E));return}if(m!=="session_launching"){if(m==="session_l\
aunch_ack"){let l=r.request_id,x=r.session_id||r.session;l&&ve(E=>{let{[l]:F,...Z}=E;return Z}),x&&X(x);return}if(m==="s\
ession_launch_failed"){let l=r.request_id,x=r.reason||r.error||"Launch failed";l&&ve(E=>cs(E,l,{...E[l],status:"failed",
error:x}));return}if(m==="session_closed"){let l=r.session||r.session_id;l&&s(x=>x.filter(E=>(typeof E=="string"?E:E?.session_id)!==
l));return}if(m==="message"||m==="proxy_message"||m==="message_event"){let l=r.session||r.session_id||r.message?.session_id,
x=r.role||r.message?.role,E=r.content||r.message?.content,F=Array.isArray(r.content_blocks)?r.content_blocks:Array.isArray(
r.message?.content_blocks)?r.message.content_blocks:null,Z=r.client_message_id||r.message?.client_message_id||null,K=r.status||
r.message?.status||null,ge=K==="delivered"||K==="agent_started";if(!l||!x||!E)return;x==="assistant"&&ya(l);let pe=Qa({role:x,
content:E,...F?{content_blocks:F}:{},...r.source_message_id?{source_message_id:r.source_message_id}:{},...r.native_source_id?
{native_source_id:r.native_source_id}:{},...r.source_cursor?{source_cursor:r.source_cursor}:{},...r.source?{source:r.source}:
{},...r.server_message_id!=null?{server_message_id:r.server_message_id}:{},...Z?{client_message_id:Z}:{},...K?{status:K}:
{},...r.sequence!=null?{sequence:r.sequence}:{},...r.created_at!=null?{created_at:r.created_at}:{},...r.timestamp!=null?
{timestamp:r.timestamp}:{},...r.ts!=null?{ts:r.ts}:{}});i(He=>{let We=He[l]||[];if(x==="user"){let Ce=We.findIndex(Le=>Le.
_optimistic&&(Z&&Le._cid===Z||!Z&&Le.content===E));if(Ce>=0){let Le=[...We],$t=We[Ce];return Le[Ce]=Qa({...$t,role:x,content:E,
...F?{content_blocks:F}:{},...pe.source_message_id?{source_message_id:pe.source_message_id}:{},...pe.native_source_id?{native_source_id:pe.
native_source_id}:{},...pe.source_cursor?{source_cursor:pe.source_cursor}:{},...pe.source?{source:pe.source}:{},...pe.server_message_id!=
null?{server_message_id:pe.server_message_id}:{},...pe.client_message_id?{client_message_id:pe.client_message_id}:{},...pe.
status?{status:pe.status}:{},...pe.sequence!=null?{sequence:pe.sequence}:{},...pe.created_at!=null?{created_at:pe.created_at}:
{},...pe.timestamp!=null?{timestamp:pe.timestamp}:{},...pe.ts!=null?{ts:pe.ts}:{},_delivered:$t._delivered||ge,_agentStarted:$t.
_agentStarted||K==="agent_started",_cid:$t._cid,_optimistic:$t._optimistic}),{...He,[l]:Kr(Le)}}}let Nt=oi(pe);return We.
some(Ce=>Nt?oi(Ce)===Nt:Ce.role===x&&Ce.content===E)?He:{...He,[l]:Kr([...We,{...pe,...x==="user"&&Z?{_cid:Z}:{},_delivered:x===
"user"&&ge,_agentStarted:x==="user"&&K==="agent_started"}])}}),x==="assistant"&&l!==Ws.current&&d(He=>({...He,[l]:(He[l]||
0)+1}));let De=jc(r);Object.keys(De).length>0&&s(He=>He.map(We=>(typeof We=="string"?We:We?.session_id)===l?{...typeof We==
"object"?We:{},session_id:l,...De}:We));return}}}}return ha.current=Ao,{sessions:n,messages:a,provisionalStreams:Oi,historyMeta:c,
historyLoading:p,connected:y,connectionHealth:A,unread:h,setUnread:d,thinking:v,thinkingContent:_,activities:T,health:H,
deliveryStates:ne,launchStates:Y,justLaunched:he,setJustLaunched:X,permissionPrompts:me,respondToPrompt:ws,errorPrompts:W,
respondToErrorPrompt:$n,interruptSession:Ns,agentConfigs:$,configControlStates:yt,requestAgentConfig:Wt,setAgentModel:ns,
setAgentEffort:hn,setAgentPermissionMode:Ss,setAutoApprovePermissions:zt,setAntigravityMode:Cs,setCodexConfig:En,newThread:Ye,
openPanel:vr,openNativeWindow:Gt,requestChatList:yr,switchChat:ji,newChat:bo,chatLists:ce,requestThreadList:Ca,switchThread:Xs,
threadLists:be,switchWorkspace:Hi,requestTerminalOutput:xa,sendTerminalInput:kr,terminalOutputs:Se,requestFileChanges:wr,
respondToFileChange:Bi,fileChanges:xe,sendAttachment:_n,send:we,sendToSession:wo,steerMessage:So,discardQueuedMessage:Co,
editQueuedMessage:xo,queuedMessages:re,scheduledSends:oe,scheduleSend:Sr,cancelScheduledSend:Ra,refreshScheduledSends:Kt,
launchSession:yo,resumeSession:Wi,closeSession:ko,activeSessionRef:Ws,restoreCachedTranscript:tt,setSessionSubscriptions:_o,
workspaces:B,branchLists:Ke,requestBranchList:bn,switchBranch:Ui,createBranch:xs,skillLists:Ze,requestSkillList:Aa,automationViews:se,
showCodexAutomation:Fi,controlResults:q,directoryListings:Hn,requestDirectoryListing:vo,fileContents:Ri,requestFileContent:Nr,
requestHistory:_r,requestHistoryChunk:Na,duplicateProxyAlarms:Mi,nightlyValidationFailures:Ti,latestAppUpdateValidation:$i,
providerUsage:ro,providerUsageRefreshReceipt:Ei,requestProviderUsageRefresh:_s,providerUsageResetReceipt:Li,consumeProviderUsageResetCredit:Xn,
providerUsageCostDetail:dr,requestProviderUsageCostDetail:Ks,hostResources:io,hostResourceError:Wn,hostResourceHistory:pr,
hostResourceDetails:Pi,hostResourceSubscription:qi,subscribeHostResources:bs,unsubscribeHostResources:ho,requestHostResourceRefresh:hr,
clearHostResources:Qn,semanticNotifications:Ii}}function ch(e){return typeof e=="string"?e:e?.session_id||e?.id||""}function Jd(e){let t=Number(e?.pin_order);return Number.
isSafeInteger(t)&&t>0?t:0}function lh(e){return e?.pinned===!0||Jd(e)>0}function Zd(e,t={}){let n=[],s=[];for(let a of Array.
isArray(e)?e:[]){let i=ch(a),c=i?t[i]:null;lh(c)?n.push({session:a,id:i,order:Jd(c)}):s.push(a)}return n.sort((a,i)=>(a.
order||Number.MAX_SAFE_INTEGER)-(i.order||Number.MAX_SAFE_INTEGER)||a.id.localeCompare(i.id)),{pinned:n.map(a=>a.session),
unpinned:s}}var Zc="remote-agent-chat:group-aliases:v1",li=Object.freeze({"^remoteagent":"Remote Agent Chat"}),uh=new Set(["thinking",
"generating","running_command","applying_patch","reading_files","working"]),dh=new Set(["validator","test","fixture","pr\
obe","e2e","throwaway"]),ph=[/(?:^|\/)cursor-test(?:\/|$)/i,/(?:^|\/)remote-agent-(?=[^/]*(?:-(?:test|fixture|probe|e2e|validator|validation|throwaway|switch-anchor)(?:-|\/|$)))[^/]+(?:\/|$)/i,
/(?:^|\/)rac-(?=[^/]*(?:-(?:test|fixture|probe|e2e|validator|validation|throwaway)(?:-|\/|$)))[^/]+(?:\/|$)/i,/(?:^|\/)reply-with-exactly-rac-[^/]*(?:\/|$)/i];
function wn(e){return typeof e=="string"?e:e?.session_id||e?.id||""}function el(e){if(!e||typeof e!="object"||e.is_test_session===
!1)return!1;if(e.is_test_session===!0||e.is_test_session===1||e.is_test_session==="true"||e.validator_session===!0||dh.has(
String(e.session_kind||e.session_class||"").trim().toLowerCase()))return!0;let t=String(e.workspace_path||e.project_root||
"").trim().replace(/\\/g,"/").replace(/\/+$/g,"").toLowerCase();if(ph.some(s=>s.test(t)))return!0;let n=[e.workspace_name,
e.display_name,e.window_title,e.chat_title].filter(Boolean).join("/").toLowerCase();return/(?:^|[\s/_-])(?:validator|fixture|throwaway)(?:$|[\s/_-])/i.
test(n)}function ia(e){if(typeof e=="number"&&Number.isFinite(e))return e;let t=Date.parse(String(e||""));return Number.
isFinite(t)?t:0}function mh(e){return(Array.isArray(e)?e:[]).reduce((t,n)=>Math.max(t,ia(n?.ts??n?.timestamp??n?.created_at??
n?.updated_at)),0)}function np(e,t={}){let n=wn(e),s=t.activities?.[n]||(typeof e=="object"?e.activity:null)||{kind:"idl\
e"},i=!!t.thinking?.[n]&&!s.generating?{...s,kind:uh.has(String(s.kind||"").toLowerCase())?s.kind:"thinking",generating:!0}:
s,c=!!t.pendingPrompts?.[n]||!!t.errorPrompts?.[n]||typeof e=="object"&&e.rate_limit_active===!0;return Jo(i,c,{connected:t.
connected,health:t.health?.[n]||t.healthMap?.[n],nowMs:t.nowMs,freshnessMs:t.freshnessMs,requireFreshness:t.requireFreshness===
!0})}function sp(e,t={}){let n=[],s=[],a={};for(let i of Array.isArray(e)?e:[]){let c=wn(i);if(!c)continue;let u=np(i,t);
a[c]=u,(sa(u)?n:s).push(i)}return{working:n,nonWorking:s,states:a}}function tl(e,t={}){let n=Array.isArray(e)?e:[],s=n.map(
wn).filter(Boolean);return{version:1,revision:Number(t.revision||0),sessionOrder:s,fallbackSessionById:Object.fromEntries(
n.map(a=>[wn(a),a]).filter(([a])=>a))}}function ap(e,t,n={}){let s=Array.isArray(t)?t:[],a=Object.fromEntries(s.map(A=>[
wn(A),A]).filter(([A])=>A)),i=Object.keys(a),c=e?.version===1?e:tl(s,n),u=Array.isArray(c.sessionOrder)?c.sessionOrder:[];
if(!(i.length!==u.length||i.some(A=>!u.includes(A))))return{ledger:c,sessions:u.map(A=>a[A]||c.fallbackSessionById?.[A]).
filter(Boolean),structuralChanged:!1,deferred:!1};if(n.freezeStructure)return{ledger:c,sessions:u.map(A=>a[A]||c.fallbackSessionById?.[A]).
filter(Boolean),structuralChanged:!0,deferred:!0};let b=new Set(i),y=u.filter(A=>b.has(A));for(let A of i)y.includes(A)||
y.push(A);let S={version:1,revision:Number(c.revision||0)+1,sessionOrder:y,fallbackSessionById:Object.fromEntries(y.map(
A=>[A,a[A]||c.fallbackSessionById?.[A]]).filter(([,A])=>!!A))};return{ledger:S,sessions:y.map(A=>a[A]||S.fallbackSessionById[A]).
filter(Boolean),structuralChanged:!0,deferred:!1}}function fh(e,t={}){let n=wn(e),s=t.activities?.[n]||(typeof e=="objec\
t"?e.activity:null)||null,a=np(e,t),i=a==="needs_attention",c=sa(a),u=Math.max(ia(t.lastMessageAt?.[n]),mh(t.messages?.[n])),
p=Math.max(ia(s?.updatedAt??s?.updated_at),ia(s?.startedAt??s?.started_at),ia(typeof e=="object"?e.last_message_at:null),
ia(typeof e=="object"?e.last_seen_at:null),ia(typeof e=="object"?e.created_at:null));return{id:n,tier:i?2:c&&t.rankWorking!==
!1?1:0,recency:u||p}}function rp(e,t={}){let n=new Map((t.previousGroupOrder||[]).map((u,p)=>[u,p])),s=new Map((t.previousSessionOrder||
[]).map((u,p)=>[u,p])),a=(u,p)=>n.has(u)?n.get(u):n.size+p,i=(u,p)=>s.has(u)?s.get(u):s.size+p,c=(Array.isArray(e)?e:[]).
map((u,p)=>{let b=(u.sessions||[]).map((y,S)=>({session:y,sessionIndex:S,...fh(y,t)})).sort((y,S)=>S.tier-y.tier||S.recency-
y.recency||i(y.id,y.sessionIndex)-i(S.id,S.sessionIndex)||y.id.localeCompare(S.id));return{group:{...u,sessions:b.map(y=>y.
session)},groupIndex:p,tier:b.reduce((y,S)=>Math.max(y,S.tier),0),recency:b.reduce((y,S)=>Math.max(y,S.recency),0)}});return c.
sort((u,p)=>p.tier-u.tier||p.recency-u.recency||a(u.group.key,u.groupIndex)-a(p.group.key,p.groupIndex)||u.group.key.localeCompare(
p.group.key)),c.map(u=>u.group)}function op(e){return{groupOrder:(e||[]).map(t=>t.key),sessionOrder:(e||[]).flatMap(t=>(t.
sessions||[]).map(wn))}}function ip(e){return(e||[]).flatMap(t=>(t.sessions||[]).map(n=>`${t.key}:${wn(n)}`)).sort().join(
"|")}function Jc(e){return String(e?.key||"unscoped")}function ui(e){let t={},n={},s={};for(let a of e||[]){let i=Jc(a);
s[i]={...a,sessions:[]};for(let c of a.sessions||[]){let u=wn(c);u&&(t[u]=c,n[u]=i)}}return{sessionById:t,groupBySession:n,
groupMeta:s}}function gh(e){return{groupOrder:[...e?.groupOrder||[]],sessionOrder:[...e?.sessionOrder||[]]}}function hh(e,t){
return(e?.groupOrder||[]).join("|")===(t?.groupOrder||[]).join("|")&&(e?.sessionOrder||[]).join("|")===(t?.sessionOrder||
[]).join("|")}function _h(e,t={},n=null){return op(rp(e,{...t,previousGroupOrder:n?.groupOrder||t.previousGroupOrder,previousSessionOrder:n?.
sessionOrder||t.previousSessionOrder}))}function Vr(e,t={}){let n=rp(e,t),s=ui(n),a=op(n);return{version:1,revision:Number(
t.revision||0),groupOrder:a.groupOrder,sessionOrder:a.sessionOrder,historicalGroupOrder:a.groupOrder,historicalSessionOrder:a.
sessionOrder,historicalGroupBySession:s.groupBySession,groupBySession:s.groupBySession,groupMeta:s.groupMeta,fallbackSessionById:s.
sessionById,sourceMembership:ip(e)}}function ii(e,t){let n=ui(t),s=new Map((e?.groupOrder||[]).map(a=>[a,[]]));for(let a of e?.
sessionOrder||[]){let i=e.groupBySession?.[a];if(!i||!s.has(i))continue;let c=n.sessionById[a]||e.fallbackSessionById?.[a];
c&&s.get(i).push(c)}return(e?.groupOrder||[]).map(a=>({...n.groupMeta[a]||e.groupMeta?.[a]||{key:a},key:a,sessions:s.get(
a)||[]})).filter(a=>a.sessions.length>0)}function ep(e,t,n={}){let s=_h(t,n,e);if(!hh(gh(e),s))return!0;let a=ui(t);return Object.
entries(a.groupBySession).some(([i,c])=>e.groupBySession?.[i]!==c)}function cp(e,t,n={}){let s=e?.version===1?e:Vr(t,n),
a=ip(t);if((s.sessionOrder||[]).length===0&&a){let v=Vr(t,{...n,revision:Number(s.revision||0)+1});return{ledger:v,groups:ii(
v,t),orderChanged:!1,structuralChanged:!0,deferred:!1}}if(a===s.sourceMembership)return{ledger:s,groups:ii(s,t),orderChanged:ep(
s,t,n),structuralChanged:!1,deferred:!1};if(n.freezeStructure)return{ledger:s,groups:ii(s,t),orderChanged:!0,structuralChanged:!0,
deferred:!0};let i=ui(t),c=new Set(Object.keys(i.sessionById)),u=[...s.historicalSessionOrder||s.sessionOrder||[]],p=[...s.
historicalGroupOrder||s.groupOrder||[]],b={...s.historicalGroupBySession||s.groupBySession||{}};for(let v of t||[]){let g=Jc(
v);p.includes(g)||p.push(g);for(let _ of v.sessions||[]){let k=wn(_);k&&!u.includes(k)&&(u.push(k),b[k]=g)}}let y={},S=[],
A=[],N={...s.groupMeta||{}},h={};for(let v of u)c.has(v)&&(S.push(v),y[v]=s.groupBySession?.[v]||b[v]||i.groupBySession[v],
h[v]=i.sessionById[v]);for(let v of t||[]){let g=Jc(v);for(let _ of v.sessions||[]){let k=wn(_);!k||y[k]||(S.push(k),y[k]=
g,h[k]=_,N[g]={...v,sessions:[]})}}for(let v of p)S.some(g=>y[g]===v)&&A.push(v);for(let v of S){let g=y[v];A.includes(g)||
A.push(g)}let d={version:1,revision:Number(s.revision||0)+1,groupOrder:A,sessionOrder:S,historicalGroupOrder:p,historicalSessionOrder:u,
historicalGroupBySession:b,groupBySession:y,groupMeta:N,fallbackSessionById:h,sourceMembership:a};return{ledger:d,groups:ii(
d,t),orderChanged:ep(d,t,n),structuralChanged:!0,deferred:!1}}function lp(e,t,n={}){return Vr(t,{...n,previousGroupOrder:e?.
groupOrder,previousSessionOrder:e?.sessionOrder,revision:Number(e?.revision||0)+1})}function ci(e){let t=String(e||"").trim().
replace(/\\/g,"/").replace(/\/+$/,"");return!t||t.toLowerCase()==="unknown"||!/^(?:[A-Za-z]:\/|\/\/|\/)/.test(t)?null:{key:t.
toLowerCase(),path:t}}function up(e){return String(e||"").replace(/\\/g,"/").replace(/\/+$/,"").split("/").filter(Boolean).
pop()||"Unscoped"}function bh(e,t){return e===t||e.startsWith(`${t}/`)}function vh(e){return up(e).toLowerCase().replace(
/[^a-z0-9]+/g,"")}function tp(e){return`alias:${String(e||"").trim().toLowerCase().replace(/[^a-z0-9]+/g,"-")}`}function di(e){
let t=e&&typeof e=="object"&&!Array.isArray(e)?e:{};return Object.fromEntries(Object.entries({...li,...t}).filter(([n,s])=>String(
n).trim()&&String(s).trim()).map(([n,s])=>[String(n).trim(),String(s).trim()]))}function yh(e,t,n){let s=t&&typeof t=="o\
bject"&&(t.group_alias||t.project_group)||null;if(typeof s=="string"&&s.trim()){let i=s.trim();return{key:tp(i),title:i}}
if(!e)return null;let a=vh(e.path);for(let[i,c]of Object.entries(di(n)))try{if(new RegExp(i,"i").test(a))return{key:tp(c),
title:c}}catch{}return null}function nl(e,t={},n=li){let s=Array.isArray(e)?e:[],a=s.map(u=>ci(u&&typeof u=="object"?u.project_root:
null)).filter(Boolean).sort((u,p)=>p.key.length-u.key.length),i=[],c=new Map;for(let u of s){let p=typeof u=="string"?u:
u?.session_id||u?.id,b=p?t[p]:null,y=ci(u&&typeof u=="object"?u.project_root:null),S=ci(u&&typeof u=="object"?u.workspace_path:
null)||ci(b?.file_access_scope),A=!y&&S?a.find(g=>bh(S.key,g.key)):null,N=y||A||S,h=yh(N,u,n),d=h?.key||N?.key||"unscope\
d",v=c.get(d);v||(v={key:d,label:h?.title||(N?up(N.path):"Unscoped"),path:N?.path||null,sessions:[]},c.set(d,v),i.push(v)),
v.sessions.push(u)}return i}var kh=new Set(["claude","claude_cli","claude-desktop","codex","codex_cli","codex-desktop","cursor","cursor_cli","gemini",
"continue","continue_yolo","roo_code","cline","antigravity","antigravity_panel","antigravity-v2"]);function dp(e,t={},n="\
unknown",s=!0){let a=typeof e=="string"?e:String(e?.session_id||e?.id||""),i=String(typeof e=="object"?e?.agent_type||t?.
agent_type||"":t?.agent_type||""),c=t?.capabilities||{};return!!a&&!!s&&kh.has(i)&&n!=="disconnected"&&e?.disconnected!==
!0&&e?.is_list_view!==!0&&c.send!==!1&&c.send_message!==!1&&c.message_send!==!1}function pp(e,t=()=>!0){let n=Array.isArray(
e?.session_ids)?e.session_ids:[],s=[...new Set(n.map(u=>String(u||"").trim()).filter(Boolean))],a=typeof e?.content=="st\
ring"?e.content.trim():"";if(s.length<1||s.length>20)return{ok:!1,error:"Select between 1 and 20 sessions"};if(!a||a.length>
65536)return{ok:!1,error:"Prompt must contain 1-65536 characters"};let i=`SEND TO ${s.length} SESSIONS`;if(e?.confirmation!==
i)return{ok:!1,error:"Broadcast confirmation does not match the selected session count"};let c=s.filter(u=>!t(u));return c.
length?{ok:!1,error:"One or more selected sessions cannot receive messages",unsupported:c}:{ok:!0,sessionIds:s,content:a,
confirmation:i}}function mp(e){return Object.fromEntries(e.map(t=>[t,{status:"queued",error:null}]))}var{useEffect:fp,useLayoutEffect:wh,useRef:pi,useState:sl}=React,ca=12,gp=10,al=360,hp=210,Nh=450;function Sh(e,t,n){return Math.
min(Math.max(e,t),Math.max(t,n))}function Ch(e){return`title-disclosure-${String(e||"title").replace(/[^a-z0-9_-]+/gi,"-")}`}
function mi({title:e,disclosureKey:t,kind:n="title",wrapperClassName:s,triggerClassName:a,disclosureClassName:i,triggerLabel:c,
triggerTag:u="button"}){let p=pi(null),b=pi(null),y=pi(null),S=pi({focused:!1,hovered:!1,latched:!1}),[A,N]=sl(!1),[h,d]=sl(
!1),[v,g]=sl(null),_=Ch(`${n}-${t}`),k=u;function T(){let z=S.current;N(z.focused||z.hovered||z.latched)}function L({restoreFocus:z=!1}={}){
S.current={focused:!1,hovered:!1,latched:!1},d(!1),g(null),N(!1),z&&p.current?.focus({preventScroll:!0})}function H(){S.
current.latched=!0,d(!0),N(!0)}function V(){y.current&&(clearTimeout(y.current),y.current=null)}fp(()=>()=>V(),[]),fp(()=>{
if(!A||!h)return;let z=oe=>{p.current?.contains(oe.target)||b.current?.contains(oe.target)||L()};return document.addEventListener(
"pointerdown",z,!0),()=>document.removeEventListener("pointerdown",z,!0)},[A,h]),wh(()=>{if(!A)return;let z=null,oe=()=>{
z=null;let Y=p.current,ve=b.current;if(!Y||!ve)return;let he=Y.getBoundingClientRect();if(he.bottom<=0||he.top>=window.innerHeight||
he.right<=0||he.left>=window.innerWidth){L();return}let X=window.innerWidth,me=window.innerHeight,J=document.querySelector(
".sidebar")?.getBoundingClientRect(),W=window.matchMedia?.("(pointer: coarse)")?.matches===!0||X<=640,G=Math.max(he.right,
J?.right||he.right),$=X-G-gp-ca,P=ve.getBoundingClientRect().height;if(!W&&$>=hp){let B=Math.min(al,$),te=Sh(he.top,ca,me-
P-ca);g({mode:"right",left:G+gp,top:te,width:B});return}g({mode:"sheet",bottom:ca,left:ca,width:Math.min(al,X-ca*2)})},_e=()=>{
z===null&&(z=requestAnimationFrame(oe))};return _e(),window.addEventListener("resize",_e),document.addEventListener("scr\
oll",_e,!0),()=>{z!==null&&cancelAnimationFrame(z),window.removeEventListener("resize",_e),document.removeEventListener(
"scroll",_e,!0)}},[A,e]);let ne={ref:p,className:a,role:u==="button"?void 0:"button",type:u==="button"?"button":void 0,tabIndex:u===
"button"?void 0:0,"aria-label":c,"aria-describedby":A?_:void 0,"aria-expanded":A,onPointerEnter:z=>{z.pointerType&&z.pointerType!==
"mouse"&&z.pointerType!=="pen"||(S.current.hovered=!0,T())},onPointerLeave:z=>{z.pointerType&&z.pointerType!=="mouse"&&z.
pointerType!=="pen"||(S.current.hovered=!1,T())},onPointerDown:z=>{z.pointerType==="touch"&&(V(),y.current=setTimeout(()=>{
y.current=null,H()},Nh))},onPointerUp:V,onPointerCancel:V,onFocus:()=>{S.current.focused=!0,T()},onBlur:()=>{S.current.focused=
!1,T()},onClick:z=>{z.stopPropagation(),H()},onContextMenu:z=>{z.preventDefault(),z.stopPropagation(),H()},onKeyDown:z=>{
if(z.key==="Escape"){z.preventDefault(),L({restoreFocus:!0});return}u!=="button"&&(z.key==="Enter"||z.key===" ")&&(z.preventDefault(),
H())}},ee=v||{mode:"measuring",left:-1e4,top:ca,width:al},re=A&&ReactDOM.createPortal(React.createElement("div",{ref:b,id:_,
className:`title-disclosure-portal ${i||""}`.trim(),role:"tooltip","data-title-disclosure-for":t,"data-title-disclosure-\
kind":n,"data-placement":ee.mode,style:{left:`${ee.left}px`,top:ee.top==null?"auto":`${ee.top}px`,bottom:ee.bottom==null?
"auto":`${ee.bottom}px`,width:ee.mode==="sheet"?`${ee.width}px`:"max-content",maxWidth:`${ee.width}px`,minWidth:`${Math.
min(hp,ee.width)}px`}},e),document.body);return React.createElement("div",{className:s},React.createElement(k,{...ne},e),
re)}var _p={schema_version:1,asset_set_version:"2026-07-16.1",retrieved_date:"2026-07-16",policy:{purpose:"First-party provi\
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
er time without modifying source pixels"]}]}]};var Ah=Object.freeze(Object.fromEntries(_p.providers.map(e=>[e.provider_id,Object.freeze({accessibleName:e.accessible_name,
light:`/provider-assets/${e.render.web.light}`,dark:`/provider-assets/${e.render.web.dark}`,darkTint:e.render.web.dark_tint||
""})])));function Rh(e){return Ah[String(e||"")]||null}function fi({providerId:e,providerName:t}){let n=Rh(e),[s,a]=React.
useState(!1);React.useEffect(()=>a(!1),[e]);let i=n?.accessibleName||String(t||"Unknown provider");return!n||s?React.createElement(
"span",{className:"usage-dashboard-provider-mark usage-dashboard-provider-mark-fallback","data-provider-mark-id":e,role:"\
img","aria-label":`${i} provider mark unavailable`},React.createElement("span",{"aria-hidden":"true"},i)):React.createElement(
"span",{className:"usage-dashboard-provider-mark","data-provider-mark-id":e,role:"img","aria-label":`${i} provider mark`},
React.createElement("img",{className:"usage-dashboard-provider-mark-image usage-dashboard-provider-mark-light",src:n.light,
alt:"","aria-hidden":"true",onError:()=>a(!0)}),React.createElement("img",{className:`usage-dashboard-provider-mark-imag\
e usage-dashboard-provider-mark-dark${n.darkTint?" usage-dashboard-provider-mark-tinted":""}`,src:n.dark,alt:"","aria-hi\
dden":"true",onError:()=>a(!0)}))}var Mh=Object.freeze({codex:"openai-codex","codex-desktop":"openai-codex",codex_cli:"openai-codex",codex_vscode:"openai-\
codex",claude:"anthropic-claude","claude-desktop":"anthropic-claude",claude_cli:"anthropic-claude",claude_code:"anthropi\
c-claude",cursor:"cursor",cursor_cli:"cursor",antigravity:"google-antigravity",antigravity_panel:"google-antigravity","a\
ntigravity-v2":"google-antigravity",gemini:"google-antigravity",ollama:"ollama-local"}),Th=Object.freeze({"openai-codex":"\
OpenAI Codex","anthropic-claude":"Anthropic Claude",cursor:"Cursor","google-antigravity":"Google Antigravity","ollama-lo\
cal":"Ollama"});function bt(e,t=160){return String(e??"").replace(/\s+/g," ").trim().slice(0,t)}function gi(e){return bt(
e).toLowerCase().replace(/[^a-z0-9]+/g,"")}function Yr(e){let t=Number(e);return Number.isFinite(t)?t:null}function $h(e,t){
return bt(e?.agent_type||e?.agentType||t?.agent_type||t?.agentType,80)}function vp(e,t){return bt(e?.usage_billing_provider_id||
e?.billing_provider_id||e?.provider_usage?.provider_id||t?.usage_billing_provider_id||t?.billing_provider_id,80)}function Eh(e,t){
return bt(e?.usage_account_fingerprint||e?.provider_account_fingerprint||e?.provider_usage?.account_fingerprint||t?.usage_account_fingerprint,
96)}function Lh(e,t){return bt(e?.usage_quota_domain||e?.provider_quota_domain||e?.provider_usage?.quota_domain||t?.usage_quota_domain,
120)}function Ph(e,t){let n=bt(t?.observed_model_id||t?.model_id||t?.selected_model_id||t?.model||e?.observed_model_id||
e?.model_id||e?.selected_model_id||e?.model,160),s=bt(t?.observed_model_label||t?.model_label||e?.model_label||n,160);return{
id:n,label:s}}function qh(e,t,n){let s=bt(n?.model_vendor||t?.model_vendor,80);if(s)return s;let a=`${e.id} ${e.label}`.
toLowerCase();return/claude|anthropic/.test(a)?"Anthropic":/gemini|google/.test(a)?"Google":/gpt|codex|openai|\bo[1345](?:\b|-)/.
test(a)?"OpenAI":/ollama|qwen|gemma|llama|mistral/.test(a)?"Ollama/runtime-defined":e.id?"Unknown model vendor":"Not rep\
orted"}function Oh(e,t){let n=bt(e?.usage_runtime_kind||e?.ollama_runtime_kind||e?.model_runtime_kind||t?.usage_runtime_kind||
t?.ollama_runtime_kind||t?.model_runtime_kind,32).toLowerCase();return n==="local"||n==="cloud"?n:""}function Ih(e,t){if(!e.
id||!t)return!1;let n=[gi(e.id),gi(e.label)].filter(Boolean),s=[gi(t.id),gi(t.label)].filter(Boolean);return s.length===
0?!1:s.some(a=>n.some(i=>i===a||i.includes(a)||a.includes(i)))}function rl(e){let t=Yr(e?.remainingPercent);if(t!=null)return t;
let n=Yr(e?.usedPercent);return n==null?null:100-n}function bp(e,t){let n=rl(e),s=rl(t);if(n!=null&&s!=null&&n!==s)return n-
s;if(n!=null)return-1;if(s!=null)return 1;let a=Yr(e?.durationMinutes),i=Yr(t?.durationMinutes);return a!=null&&i!=null&&
a!==i?a-i:bt(e?.label).localeCompare(bt(t?.label))}function Dh(e,t,n){let s=$h(e,t),a=Ph(e,t),i=vp(e,t)||Mh[s]||"";return{
supported:!!i,state:i?"unavailable":"unsupported",tone:"unavailable",message:i?"Usage account unavailable":"No provider \
usage mapping",billingProviderId:i,billingProviderName:Th[i]||i||"Provider",providerMarkId:i,harnessSurface:s,modelId:a.
id,modelLabel:a.label,modelVendor:qh(a,e,t),accountFingerprint:"",accountLabel:"",quotaDomain:"",plan:"",mappingConfidence:"\
unavailable",generation:Number(n?.generation)||0,capturedAt:"",staleAfter:"",freshness:bt(n?.collectionState||"unavailab\
le",40),source:"",error:null,applicableWindows:[],headerWindows:[],credits:null,financials:null,cloudUsage:null,localRuntime:null,
runtimeKind:i==="ollama-local"?Oh(e,t):""}}function jh(e,t,n,s){let a=Array.isArray(s?.entries)?s.entries:[],i=Eh(t,n),c=Lh(
t,n),u=e.billingProviderId?a.filter(p=>p?.providerId===e.billingProviderId):a.filter(p=>Array.isArray(p?.harnessTypes)&&
p.harnessTypes.includes(e.harnessSurface));return i&&(u=u.filter(p=>p?.accountFingerprint===i)),c&&(u=u.filter(p=>p?.quotaDomain===
c)),u.length===1?{entry:u[0],confidence:i||c?"explicit_account":vp(t,n)?"explicit_provider":"unique_provider_account"}:u.
length>1?{entry:null,confidence:"ambiguous",candidates:u}:{entry:null,confidence:i||c?"linked_account_unavailable":"unav\
ailable",candidates:u}}function yp(e,t,n,s=Date.now()){let a=Dh(e,t,n);if(!a.supported)return a;let i=jh(a,e,t,n);if(!i.
entry)return{...a,state:i.confidence==="ambiguous"?"ambiguous":"unavailable",message:i.confidence==="ambiguous"?"Usage a\
ccount ambiguous":"Usage account unavailable",mappingConfidence:i.confidence};let c=i.entry,u=Date.parse(c.staleAfter||""),
b=Number.isFinite(u)&&u<=s&&c.status==="fresh"?"stale":bt(c.status||"unavailable",40),y={id:a.modelId,label:a.modelLabel},
S=Array.isArray(c.windows)?c.windows.filter(T=>T&&T.usedPercent!=null):[],A=S.filter(T=>T.modelScope&&Ih(y,T.modelScope)).
sort(bp),N=S.filter(T=>!T.modelScope).sort(bp),h=[...A,...N],d=A.length>0?[A[0],N[0]].filter(Boolean):N.slice(0,2),v=a.runtimeKind;
if(a.billingProviderId==="ollama-local"){if(!v)return{...a,billingProviderName:c.providerName||a.billingProviderName,accountFingerprint:c.
accountFingerprint,accountLabel:c.accountLabel,quotaDomain:c.quotaDomain,plan:c.plan,mappingConfidence:i.confidence,capturedAt:c.
capturedAt,staleAfter:c.staleAfter,freshness:b,source:c.source,state:"ambiguous",message:"Ollama runtime unavailable",cloudUsage:c.
cloudUsage,localRuntime:c.localRuntime};if(v==="local")return{...a,billingProviderName:c.providerName||a.billingProviderName,
accountFingerprint:c.accountFingerprint,accountLabel:c.accountLabel,quotaDomain:c.quotaDomain,plan:c.plan,mappingConfidence:i.
confidence,capturedAt:c.capturedAt,staleAfter:c.staleAfter,freshness:b,source:c.source,state:c.localRuntime?"local":"una\
vailable",tone:c.localRuntime?"local":"unavailable",message:c.localRuntime?"Local \xB7 no plan limit":"Local runtime tel\
emetry unavailable",localRuntime:c.localRuntime,cloudUsage:c.cloudUsage}}let g=new Set(d.map(T=>T.tone)),_=g.has("critic\
al")?"critical":g.has("warning")?"warning":b==="stale"?"stale":d.length>0?"ok":"unavailable",k=b==="auth_required"||b===
"unavailable"?"unavailable":b==="stale"||b==="rate_limited"?"stale":d.some(T=>Number(T.usedPercent)>=100)?"exhausted":d.
length>0?"ready":"unavailable";return{...a,state:k,tone:k==="exhausted"?"critical":_,message:d.length>0?"":"Applicable u\
sage windows unavailable",billingProviderName:c.providerName||a.billingProviderName,accountFingerprint:c.accountFingerprint,
accountLabel:c.accountLabel,quotaDomain:c.quotaDomain,plan:c.plan,mappingConfidence:i.confidence,capturedAt:c.capturedAt,
staleAfter:c.staleAfter,freshness:b,source:c.source,error:c.error,applicableWindows:h,headerWindows:d,credits:c.credits,
financials:c.financials,cloudUsage:c.cloudUsage,localRuntime:c.localRuntime}}function ol(e){let t=bt(e?.label||"Usage",60),
n=rl(e);return{label:t,usedPercent:Yr(e?.usedPercent),remainingPercent:n,compactValue:n==null?"Unavailable":`${Math.max(
0,Math.round(n))}% left`,reset:bt(e?.resetDescription||e?.resetsAt,120),tone:bt(e?.tone||"unavailable",24)}}var rm=vf($p()),{goalLifecycleSupported:d_,latestUserRequestFromMessages:p_,projectFleetWorkContext:m_}=rm.default,{useState:ue,
useRef:Me,useEffect:Te,useLayoutEffect:us}=React,Ep="remote-agent-chat:drafts:v1",Lp="remote-agent-chat:show-test-sessio\
ns:v1",f_=120,g_=500,h_=160,__=256*1024,Pp=Object.freeze([]),b_=[{command:"/plan",detail:"Outline the implementation app\
roach and major steps."},{command:"/review",detail:"Review the current changes for bugs, regressions, and missing tests."},
{command:"/fix",detail:"Implement or repair the current issue."},{command:"/summarize",detail:"Summarize the current sta\
te and important changes."}],Nn={claude:{name:"Claude Code",color:"#cc785c",abbr:"CC",logo:"/logo-claude-in-ag.svg"},claude_cli:{
name:"Claude Code CLI",color:"#d97757",abbr:"CLI",logo:"/logo-claude-in-ag.svg"},"claude-desktop":{name:"Claude Desktop",
color:"#cc785c",abbr:"CD",logo:"/logo-claude-in-ag.svg"},codex:{name:"Codex",color:"#10a37f",abbr:"CX",logo:"/logo-codex\
-in-ag.svg"},codex_cli:{name:"Codex CLI",color:"#10a37f",abbr:"CLI",logo:"/logo-codex.svg"},"codex-desktop":{name:"Codex\
 Desktop",color:"#10a37f",abbr:"CX",logo:"/logo-codex.svg"},cursor:{name:"Cursor",color:"#7AA2F7",abbr:"CR",logo:"/logo-\
cursor.svg"},cursor_cli:{name:"Cursor CLI",color:"#7c6cf0",abbr:"CLI",logo:"/logo-cursor.svg"},gemini:{name:"Gemini",color:"\
#4285f4",abbr:"GC",logo:"/logo-gemini-in-ag.svg"},continue:{name:"Continue",color:"#d29922",abbr:"CN",logo:"/logo-contin\
ue.png"},continue_yolo:{name:"Continue YOLO",color:"#f59e0b",abbr:"CY",logo:"/logo-continue.png"},roo_code:{name:"Roo Co\
de",color:"#06b6d4",abbr:"RC",logo:"/logo-continue.png"},cline:{name:"Cline",color:"#6366f1",abbr:"CL",logo:"/logo-cline\
.svg"},antigravity:{name:"Antigravity",color:"#a855f7",abbr:"AG",logo:"/logo-antigravity.svg"},antigravity_panel:{name:"\
Antigravity Chat",color:"#a855f7",abbr:"AC",logo:"/logo-antigravity.svg"},"antigravity-v2":{name:"Antigravity v2",color:"\
#7c3aed",abbr:"A2",logo:null}},_l={name:"Agent",color:"#8b949e",abbr:"AG"};function bl(e){return e==="continue"||e==="co\
ntinue_yolo"}function Jr(e){return e==="cline"||e==="roo_code"}function v_(e){return e==="codex"||e==="codex-desktop"}function y_(e){return e==="codex_cli"||e==="cursor_cli"?h_:v_(e)?
g_:f_}function ae(e,t=""){return typeof e=="string"?e:e==null?t:String(e)}function Ct(e){if(typeof e=="string")return e;
if(Array.isArray(e))return e.map(t=>typeof t=="string"?t:!t||typeof t!="object"?"":typeof t.text=="string"?t.text:typeof t.
content=="string"?t.content:typeof t.url=="string"?t.url:typeof t.image_url=="string"?t.image_url:"").filter(Boolean).join(
" ");if(e&&typeof e=="object"){if(typeof e.text=="string")return e.text;if(typeof e.content=="string")return e.content;if(typeof e.
url=="string")return e.url;if(typeof e.image_url=="string")return e.image_url;try{return JSON.stringify(e)}catch{return""}}
return""}function om(e){let t=typeof e=="string"?e:ae(e),n=2166136261;for(let s=0;s<t.length;s++)n^=t.charCodeAt(s),n=Math.
imul(n,16777619);return(n>>>0).toString(36)}function Cl(e,t=0){if(!e||typeof e!="object")return`empty:${t}`;if(e._cid)return`\
cid:${e._cid}`;if(e.source_message_id)return`source:${e.source_message_id}`;if(e.native_source_id)return`native:${e.native_source_id}`;
if(e.id!=null)return`id:${e.id}`;if(e.server_message_id!=null)return`server:${e.server_message_id}`;if(e.client_msg_id)return`\
client:${e.client_msg_id}`;if(e.sequence!=null)return`seq:${e.sequence}`;let n=Ct(e.content)||no(e.content_blocks),s=Array.
isArray(e.content_blocks)?JSON.stringify(e.content_blocks):"";return["body",e.role||"",e.ts||"",om(`${n}
${s}`)].join(":")}function k_(e){let t=Ct(e?.content)||no(e?.content_blocks),n=Array.isArray(e?.content_blocks)?JSON.stringify(
e.content_blocks):"";return om(`${t}
${n}`)}function w_(e){return e?.role==="user"?"user":cr(e?.content_blocks)[0]?.type||"markdown"}function ul(e){return(Array.
isArray(e)?e:[]).map((n,s)=>Cl(n,s))}function nn(e,t){if(!e)return;let n=e.style.scrollBehavior;e.style.scrollBehavior="\
auto",e.scrollTop=t,requestAnimationFrame(()=>{e.style.scrollBehavior==="auto"&&(e.style.scrollBehavior=n)})}function N_(e){
let t=Ct(e),n=t.match(/^\[File: ([^\]]+?) [→\u2192] ([A-Za-z]:\\.+?\\uploads\\([^\\\]]+))\]$/);if(!n)return t;let[,s,,
a]=n;return/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(s)?`![${s}](/uploads/${a})`:t}function S_(e){return Ct(e).trim().length>
0}function cr(e){return Array.isArray(e)?e.filter(t=>t&&typeof t=="object").map(t=>{let n=ae(t.type||"markdown").toLowerCase();
if(n==="code"){let s=ae(t.language||t.lang||"").trim(),a=Ct(t.content||t.text||t.markdown||"");return{...t,type:"markdow\
n",content:`\`\`\`${s}
${a}
\`\`\``}}return n==="file_change"?{...t,type:"file_changes"}:n==="tool"?{...t,type:"tool_call"}:n==="tool_output"||n==="\
result"?{...t,type:"tool_result"}:n==="thought"?{...t,type:"thinking"}:n==="task_list"?{...t,type:"plan"}:n==="queue"||n===
"queued"?{...t,type:"queued_message"}:n==="banner"||n==="notification"?{...t,type:"notice"}:n==="worked"||n==="activity"?
{...t,type:"status"}:t}):[]}function im(e){if(!e||typeof e!="object")return"";let t=[e.workdir?`cwd: ${e.workdir}`:null,
e.command?`$ ${e.command}`:null,e.stdout||null,e.stderr?`stderr:
${e.stderr}`:null,e.exit_code!=null?`exit code: ${e.exit_code}`:null].filter(Boolean);if(t.length)return t.join(`

`);if(Array.isArray(e.files)&&e.files.length>0){let n=e.files.map(s=>[s.path||s.file||"",s.added!=null?`+${s.added}`:"",
s.removed!=null?`-${s.removed}`:""].filter(Boolean).join(" ")).filter(Boolean).join(`
`);return[e.content||e.text||e.markdown||"",n].filter(Boolean).join(`

`)}if(Array.isArray(e.tasks)&&e.tasks.length>0){let n=e.tasks.map(s=>{let a=ae(s?.text||s?.step||s?.title).trim(),i=ae(s?.
state||s?.status||"pending").trim();return a?`[${i}] ${a}`:""}).filter(Boolean).join(`
`);return[e.content||"",n].filter(Boolean).join(`
`)}return e.content||e.text||e.markdown||e.title||e.label||""}function C_(e){return e?S_(e.content)?!0:cr(e.content_blocks).
some(t=>Ct(im(t)).trim().length>0):!1}function no(e){return cr(e).map(t=>Ct(im(t))).filter(Boolean).join(`

`)}function js({actions:e}){return!Array.isArray(e)||e.length===0?null:React.createElement("div",{className:"content-blo\
ck-actions"},e.map((t,n)=>React.createElement("span",{key:t.id||n,className:`content-block-action-label${t.unsupported?"\
 unsupported":""}`,title:t.unsupported?"This Codex control is visible in the source app but is not currently available f\
rom the web UI.":void 0},t.label||t.id||"Action")))}var x_=512,da=new Map;function A_(e,t){if(e)for(da.delete(e),da.set(
e,t);da.size>x_;)da.delete(da.keys().next().value)}function la({className:e,summary:t,children:n,stateKey:s="",defaultOpen:a=!0}){
let[i,c]=React.useState(()=>s&&da.has(s)?da.get(s):a),u=React.useCallback(p=>{let b=p.currentTarget.open;c(b),A_(s,b)},[
s]);return React.createElement("details",{className:e,open:i,onToggle:u},React.createElement("summary",null,t),n)}function R_(e){
let t=ae(e).trim().match(/^(Edited\s+\d+\s+files?)(?:\s+(\+\d+))?(?:\s+(-\d+))?$/i);return t?{label:t[1],additions:t[2]||
"",deletions:t[3]||""}:null}function M_({blocks:e,monospace:t,autoExpandLongCodeBlocks:n,onOpenPath:s,agentType:a,richContentEager:i=!0,
richContentCacheIdentity:c=""}){let u=cr(e);if(u.length===0)return null;let p=ae(a).toLowerCase()==="cursor",b=ae(a).toLowerCase()===
"claude",y=ae(a).toLowerCase()==="codex",S=ae(a).toLowerCase()==="codex-desktop",A=ae(a).toLowerCase()==="antigravity-v2";
function N(d){let v=[d.workdir?`cwd: ${d.workdir}`:null,d.command?`$ ${d.command}`:null,d.stdout||null,d.stderr?`stderr:\

${d.stderr}`:null,d.exit_code!=null?`exit code: ${d.exit_code}`:null].filter(Boolean);return v.length?v.join(`

`):Ct(d.content||d.text||d.markdown||"")}function h(d,v){return React.createElement(Ya,{content:d,monospace:t,autoExpandLongCodeBlocks:n,
onOpenPath:s,deferUntilVisible:!i,cacheIdentity:`${c}:block:${v}`})}return React.createElement("div",{className:`content\
-blocks${p?" content-blocks-cursor":""}`},u.map((d,v)=>{let g=ae(d.type||"markdown").toLowerCase(),_=ae(d.title||d.label||
d.summary||g),k=N(d);if(g==="status")return React.createElement("div",{key:v,className:"content-block content-block-stat\
us-chip",title:_},_||"Status");if(g==="thinking"){let T=!k||ae(k).replace(/\s+/g," ").trim()===_;if(y){let L=k&&!T?k:_&&
_.toLowerCase()!=="thinking"?_:"";return L?React.createElement("div",{key:v,className:"content-block content-block-think\
ing-native"},h(L,v)):null}return S&&T?React.createElement("div",{key:v,className:"content-block content-block-thinking-c\
odex-desktop"},React.createElement("span",null,_||"Worked"),React.createElement("span",{className:"content-block-thinkin\
g-codex-desktop-chevron","aria-hidden":"true"},"\u2304")):S?React.createElement(la,{key:v,stateKey:`${c}:disclosure:${v}`,
className:"content-block content-block-thinking-codex-desktop",summary:_||"Worked"},h(k,v)):p&&T?React.createElement("di\
v",{key:v,className:"content-block content-block-status-chip thinking",title:_},_||"Thinking"):React.createElement(la,{key:v,
stateKey:`${c}:disclosure:${v}`,className:"content-block content-block-thinking",summary:_||"Thinking"},k&&!T&&h(k,v))}if(g===
"tool_call"||g==="tool_result"){let T=!k||ae(k).replace(/\s+/g," ").trim()===_;return p&&T?React.createElement("div",{key:v,
className:"content-block content-block-status-chip tool",title:_},_||"Tool"):React.createElement(la,{key:v,stateKey:`${c}\
:disclosure:${v}`,className:`content-block content-block-${g==="tool_result"?"tool-result":"tool"}`,summary:React.createElement(
React.Fragment,null,React.createElement("span",null,_||(g==="tool_result"?"Tool result":"Tool")),d.status&&React.createElement(
"span",{className:`content-block-status ${ae(d.status).toLowerCase()}`},d.status))},k&&React.createElement("pre",{className:"\
content-block-pre"},k),React.createElement(js,{actions:d.actions}))}if(g==="terminal"){if(b){let T=(_||"Bash").match(/^(\S+)(?:\s+([\s\S]*))?$/),
L=T?.[1]||"Bash",H=T?.[2]||"",V=ae(d.status||"running").toLowerCase();return React.createElement("div",{key:v,className:"\
content-block content-block-terminal-claude",role:"group","aria-label":_||"Bash command"},React.createElement("div",{className:"\
content-block-terminal-claude-header"},React.createElement("span",{className:`content-block-terminal-claude-dot ${V}`,"a\
ria-hidden":"true"}),React.createElement("strong",null,L),H&&React.createElement("span",null,H)),React.createElement("di\
v",{className:"content-block-terminal-claude-body"},d.command&&React.createElement("div",{className:"content-block-termi\
nal-claude-row"},React.createElement("span",null,"IN"),React.createElement("pre",null,d.command)),d.stdout&&React.createElement(
"div",{className:"content-block-terminal-claude-row"},React.createElement("span",null,"OUT"),React.createElement("pre",null,
d.stdout)),d.stderr&&React.createElement("div",{className:"content-block-terminal-claude-row error"},React.createElement(
"span",null,"ERR"),React.createElement("pre",null,d.stderr))),React.createElement(js,{actions:d.actions}))}return S?React.
createElement(la,{key:v,stateKey:`${c}:disclosure:${v}`,className:"content-block content-block-terminal-codex-desktop",summary:React.
createElement("span",null,"Ran commands")},k&&React.createElement("pre",{className:"content-block-pre"},k),React.createElement(
js,{actions:d.actions})):React.createElement(la,{key:v,stateKey:`${c}:disclosure:${v}`,className:"content-block content-\
block-terminal",summary:React.createElement(React.Fragment,null,React.createElement("span",null,_||"Terminal"),d.exit_code!=
null&&React.createElement("span",{className:"content-block-status"},"exit ",d.exit_code))},k&&React.createElement("pre",
{className:"content-block-pre"},k),React.createElement(js,{actions:d.actions}))}if(g==="file_changes"){let T=R_(_);if(!!(p&&
T&&!k&&(!Array.isArray(d.files)||d.files.length===0)&&(!Array.isArray(d.actions)||d.actions.length===0)))return React.createElement(
"div",{key:v,className:"content-block content-block-file-change content-block-file-change-cursor-summary"},React.createElement(
"span",null,T.label),T.additions&&React.createElement("span",{className:"content-block-add"},T.additions),T.deletions&&React.
createElement("span",{className:"content-block-del"},T.deletions));let H=[d.files_changed!=null?`${d.files_changed} file\
s`:null,d.additions!=null?`+${d.additions}`:null,d.deletions!=null?`-${d.deletions}`:null].filter(Boolean).join(" ");return React.
createElement(la,{key:v,stateKey:`${c}:disclosure:${v}`,className:"content-block content-block-file-change",summary:React.
createElement(React.Fragment,null,React.createElement("span",null,_||"File changes",H?` ${H}`:""),d.status&&React.createElement(
"span",{className:`content-block-status ${ae(d.status).toLowerCase()}`},d.status))},Array.isArray(d.files)&&d.files.length>
0&&React.createElement("div",{className:"content-block-file-list"},d.files.map((V,ne)=>React.createElement("div",{className:"\
content-block-file-row",key:V.path||ne},React.createElement("span",{className:"content-block-file-path"},V.path||"file"),
V.added!=null&&React.createElement("span",{className:"content-block-add"},"+",V.added),V.removed!=null&&React.createElement(
"span",{className:"content-block-del"},"-",V.removed)))),k&&h(k,v),React.createElement(js,{actions:d.actions}))}if(g==="\
artifact")return React.createElement("div",{key:v,className:"content-block content-block-artifact"},React.createElement(
"div",{className:"content-block-title"},_||"Artifact"),k&&h(k,v));if(g==="plan"){let T=Array.isArray(d.tasks)?d.tasks:[];
return React.createElement("div",{key:v,className:"content-block content-block-plan"},React.createElement("div",{className:"\
content-block-title"},_||"Plan"),T.length>0&&React.createElement("ol",{className:"content-block-plan-list"},T.map((L,H)=>{
let V=ae(L?.state||L?.status||"pending").toLowerCase();return React.createElement("li",{key:L.id||H,className:`content-b\
lock-plan-item ${V}`},React.createElement("span",{className:"content-block-plan-marker","aria-hidden":"true"},V==="compl\
eted"?"\u2713":V==="in_progress"?"\u2022":"\u25CB"),React.createElement("span",null,L.text||L.step||L.title||""))})),k&&
!T.length&&h(k,v))}return g==="queued_message"?React.createElement("div",{key:v,className:"content-block content-block-q\
ueued-message"},React.createElement("span",{className:"content-block-queued-label"},_||"Queued message"),k&&React.createElement(
"span",{className:"content-block-queued-body"},k)):g==="notice"?React.createElement("div",{key:v,className:`content-bloc\
k content-block-notice ${ae(d.tone||d.status||"info").toLowerCase()}`},React.createElement("div",{className:"content-blo\
ck-title"},_||"Notice"),k&&h(k,v),React.createElement(js,{actions:d.actions})):g==="error"&&A?React.createElement(la,{key:v,
stateKey:`${c}:disclosure:${v}`,className:"content-block content-block-error content-block-error-antigravity-v2",defaultOpen:!1,
summary:React.createElement(React.Fragment,null,React.createElement("span",{className:"content-block-error-antigravity-v\
2-label"},_||"Error"),k&&React.createElement("span",{className:"content-block-error-antigravity-v2-message"},k))},React.
createElement(js,{actions:d.actions})):g==="prompt"||g==="error"?React.createElement("div",{key:v,className:`content-blo\
ck content-block-${g}`},React.createElement("div",{className:"content-block-title"},_||g),k&&h(k,v),React.createElement(
js,{actions:d.actions})):React.createElement("div",{key:v,className:"content-block content-block-markdown"},h(k||_,v))}))}
function dl(e){let t=Ct(e).trim();return!(!t||t.length<4||/^[\s*._|`~•·▌]+$/.test(t)||!/[A-Za-z0-9]/.test(t))}function Ci({
message:e=null,instant:t=null}){let n=t==null?Xa(e):In(t);if(!n)return React.createElement("span",{className:"message-ti\
mestamp message-timestamp-unknown","aria-label":"Sent time unknown",title:"Sent time unknown"},"Time unknown");let s=Vu(
n);return React.createElement("time",{className:"message-timestamp",dateTime:n.iso,title:s,"aria-label":`Sent ${s}`},xc(
n))}function T_(e){return typeof e=="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.
test(e)}function qp(e){if(!e)return _l;let t=e.split("-")[0].toLowerCase();return Nn[t]||_l}function ua(e){let t=ae(e).toLowerCase();
return t?t.includes("roo code")||t.includes("roo_code")||t.includes("roo-cline")?"roo_code":t.includes("cline")||t.includes(
"claude-dev")?"cline":t.includes("continue yolo")||t.includes("continue_yolo")?"continue_yolo":t.includes("continue")?"c\
ontinue":t.includes("codex cli")||t.includes("codex_cli")?"codex_cli":t.includes("codex desktop")?"codex-desktop":t.includes(
"cursor cli")||t.includes("cursor_cli")?"cursor_cli":/\bcursor\b/.test(t)||t==="cursor"||t.includes("cursor ide")?"curso\
r":t.includes("codex")?"codex":t.includes("claude code")||t.includes("claude")?"claude":t.includes("antigravity chat")||
t.includes("antigravity_panel")?"antigravity_panel":t.includes("antigravity-v2")||t.includes("antigravity v2")?"antigrav\
ity-v2":null:null}function Op(e){if(e&&typeof e=="object"){let t=e.agent_type;return Nn[t]?t:ua(e.display_name)||ua(e.agent_type)||
ua(e.session_title)||ua(e.window_title)||ua(e.chat_title)||ua(e.session_id)}if(typeof e=="string"){let t=e.split("-")[0].
toLowerCase();return Nn[t]?t:ua(e)}return null}function $e(e){return typeof e=="string"?e:e?.session_id}function ir(e,t){
if(e&&typeof e=="object"){let s=Op(e);return Nn[s]||qp(e.session_id)}let n=Op(e);return Nn[n]||qp(e)}function or(e,t,n){
if(e&&typeof e=="object"){let i=H_(e,n),c=n?.file_access_scope?n.file_access_scope.replace(/\\/g,"/").split("/").filter(
Boolean).pop():null,u=e.agent_type==="antigravity_panel"&&e.panel_title?` / ${e.panel_title}`:"",p=(i?.label||e.workspace_name||
c||e.window_title||e.workspace_path||t||"Session")+u;return e.chat_title&&!p.includes("/")?`${p} / ${e.chat_title}`:p}let s=t||
e;return typeof s!="string"?"Session":T_(s)?"Connected session":s.split("-").slice(1).join("-")||s}function cm(e){let t=ae(
e).replace(/\\/g,"/").replace(/\/+$/,"").trim();return t?t.split("/").filter(Boolean).pop()||t:""}function Ai(e){return ae(
e).replace(/\\/g,"/").replace(/\/+$/,"").trim()}function lm(e){let t=Ai(e);return/^[A-Za-z]:\//.test(t)||t.startsWith("/\
/")||t.startsWith("/")}function $_(e){let t=Ai(e).toLowerCase();return/^[a-z]:\/users\/[^/]+$/.test(t)||/^[a-z]:\/users\/[^/]+\/documents$/.
test(t)||/^\/users\/[^/]+$/.test(t)||/^\/users\/[^/]+\/documents$/.test(t)||/^\/home\/[^/]+$/.test(t)}function E_(e){let t=Ai(
e),n=t.match(/^[A-Za-z]:\/Users\/([^/]+)(?:\/|$)/i);if(n)return n[1];let s=t.match(/^\/(?:Users|home)\/([^/]+)(?:\/|$)/i);
return s?s[1]:""}function L_(e,t){let n=E_(t);return!!n&&ae(e).trim().toLowerCase()===n.toLowerCase()}function xl(e){return ae(
e).replace(/\s+\(Workspace\)$/i,"").replace(/\s+-\s+(?:Visual Studio Code|Code|Cursor|Antigravity)(?:\s*\[[^\]]+\]|\s+(?:Administrator|Admin))?$/i,
"").trim()}function um(e){let t=ae(e).trim();return/^(?:Visual Studio Code|Code|Cursor|Antigravity)(?:\s*\[[^\]]+\]|\s+(?:Administrator|Admin))?$/i.
test(t)}function P_(e){return/\s+-\s+(?:Visual Studio Code|Code|Cursor|Antigravity)(?:\s*\[[^\]]+\]|\s+(?:Administrator|Admin))?\s*$/i.
test(ae(e))}function dm(e){let t=ae(e).trim();if(!t)return[];let n=t.split(/\s+-\s+/).map(s=>xl(s)).filter(Boolean);for(;n.
length&&um(n[n.length-1]);)n.pop();return n}var q_=/\b(?:image|screenshot|screen\s*shot|capture)[\w .()[\]-]*\.(?:png|jpe?g|gif|webp|bmp|svg)(?:\b|[\s._-]*\d{2,}(?:\s*[x\u00d7]\s*\d{2,})?|[\s._-]*[a-z0-9]{3,})/i,
O_=/(?:[A-Za-z]:[\\/]|\\\\[^\\/\s]+[\\/]|\/(?:Users|home|mnt|var|tmp|etc|opt|workspace|workspaces)\/)[^\s"'`<>)]{2,}/i,pm=new Set(
["agent","agent manager","agent session","antigravity","antigravity chat","antigravity v2","claude","claude code","codex",
"codex cli","codex desktop","connected session","other","session","unknown"]),I_=new Set(Array.from(pm,e=>e.replace(/[^a-z0-9]+/g,
"")));function mm(e){let t=xl(e);if(!t)return"";let n=cm(t),s=/[-_]/.test(n),a=n.replace(/[-_]+/g," ");return(s||!/\s/.test(
n))&&(a=a.replace(/([a-z])([A-Z])/g,"$1 $2")),a.replace(/\s+/g," ").trim()}function D_(e){let t=mm(e).toLowerCase();if(!t||
/^window\s+\d+$/.test(t)||um(t)||pm.has(t))return!0;let n=t.replace(/[^a-z0-9]+/g,"");return I_.has(n)}function j_(e,t){
return ae(e).toLowerCase()===ae(t).toLowerCase()}function Al(e,t){let n=mm(e);return D_(n)?null:{label:n,key:ae(t||n).replace(
/\\/g,"/").replace(/\/+$/,"").toLowerCase()}}function Ip(e){let t=Ai(e);return!t||!lm(t)||$_(t)?null:Al(cm(t),t)}function Dp(e){
let t=dm(e);return t.length<2?null:Al(t[t.length-1],t[t.length-1])}function B_(e){let t=ae(e);if(P_(t))return null;let n=xl(
e);return!n||lm(n)||dm(n).length>=2?null:Al(n,n)}function F_(e){let t=ae(e).toLowerCase().trim();return[t,t.replace(/\s+/g,
"-"),t.replace(/\s+/g,"")].filter(Boolean)}function jp(e,t=[]){let n=e.map(a=>ae(a).toLowerCase()).filter(Boolean),s=[...t].
sort((a,i)=>i.label.length-a.label.length);for(let a of s){let i=F_(a.label);if(n.some(c=>i.some(u=>u&&c.includes(u))))return a}
return null}function H_(e,t,n=[]){if(!e||typeof e!="object")return null;let s=jp([e.window_title,e.workspace_name,e.chat_title,
e.session_title],n),a=[Ip(e.workspace_path),Ip(t?.file_access_scope),s,Dp(e.window_title),Dp(e.workspace_name),L_(e.workspace_name,
e.workspace_path)?null:B_(e.workspace_name)].filter(Boolean);if(a.length>0){let u=a[0];return n.find(p=>j_(p.label,u.label))||
u}let i=[e.chat_title,e.session_title,e.title,e.display_title,e.window_title,e.workspace_name].map(u=>ae(u).toLowerCase()).
filter(Boolean),c=jp(i,n);return c||null}function U_(e){return Ct(e).replace(/!\[[^\]]*\]\((?:data:image\/[^)]+|\/uploads\/[^)]+|[^)]*\.(?:png|jpe?g|gif|webp|bmp|svg))\)/gi,
" ").replace(/\[File:\s*[^\]]+\]/gi," ").replace(O_," ").replace(q_," ").replace(/<goal_context>[\s\S]*?<\/goal_context>/gi,
" ").replace(/<[^>\n]{1,80}>/g," ").replace(/```[\s\S]*?```/g," ").replace(/`([^`]+)`/g,"$1").replace(/^\s*(?:user|assistant|codex|claude|tool result)\s*[:\-]\s*/i,
"").replace(/\s+/g," ").trim()}function Zr(e,t,n,s=[]){return nd(e,e&&typeof e=="object"?e.custom_display_name:"",s)}function Bp(e){
if(!e||typeof e!="object")return null;if(e.workspace_path)return ae(e.workspace_path).toLowerCase();let t=ae(e.workspace_name||
e.window_title||"");return t&&t.split(" / ")[0].trim().toLowerCase()||null}function W_(e,t){let n=$e(t),s=Bp(t);return s&&
(e||[]).find(a=>a&&typeof a=="object"&&a.agent_type==="antigravity_panel"&&$e(a)!==n&&Bp(a)===s)||null}function z_(e){return!e||
typeof e!="object"?"":[e.panel_title||null,e.panel_model||null,e.panel_mode||null].filter(Boolean).join(" \xB7 ")}function G_(e){return e==="claude"?"claude-document":e==="codex_cli"?"codex-terminal":e==="cursor"?"cursor-cards":e==="c\
odex-desktop"||e==="codex"?"codex-thread":"unified-flow"}function Fp(e){return e==="codex_cli"?"codex-cli":e==="codex"||
e==="codex-desktop"?"codex":e==="claude"||e==="claude_cli"?"claude":e==="cursor"||e==="cursor_cli"?"cursor":"default"}function K_(e,t){
let n=ae(e).toLowerCase().replace(/\s+/g," ").trim(),s=ae(t).toLowerCase().replace(/\s+/g," ").trim();if(!s)return 0;let a=n.
indexOf(s);if(a>=0)return 2e3-Math.min(a,500)-Math.max(0,n.length-s.length)*.01;let i=0,c=0,u=-1;for(let p of s){if(p===
" ")continue;let b=n.indexOf(p,c);if(b<0)return Number.NEGATIVE_INFINITY;i+=u<0?Math.max(0,80-b):Math.max(1,24-(b-u-1)*3),
(b===0||/[\s/\\_.:-]/.test(n[b-1]))&&(i+=35),u=b,c=b+1}return i}function V_(e,t){let n=ae(t).toLowerCase().trim().split(
/\s+/).filter(Boolean);return n.length===0?[...e]:e.map((s,a)=>{let i=n.reduce((c,u)=>{let p=Array.isArray(s.searchFields)&&
s.searchFields.length?s.searchFields:[s.searchText],b=Math.max(...p.map(y=>K_(y,u)));return Number.isFinite(c)&&Number.isFinite(
b)?c+b:Number.NEGATIVE_INFINITY},0);return{item:s,sidebarIndex:a,score:i}}).filter(s=>Number.isFinite(s.score)).sort((s,a)=>+!!a.
item.working-+!!s.item.working||a.score-s.score||s.sidebarIndex-a.sidebarIndex).map(s=>s.item)}function vl(e){return e instanceof
Element?!!e.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]'):!1}function Y_(e,t){if(!e||!t||
e.sessionId!==t.sessionId)return 0;let n=Math.max(0,Number(t.messageCount||0)-Number(e.messageCount||0)),s=!!t.provisionalId&&
(t.provisionalId!==e.provisionalId||Number(t.provisionalLength||0)>Number(e.provisionalLength||0));return n+(s&&n===0?1:
0)}function X_(e,t,n=!1){let[s,a]=React.useState(()=>Vr(e,t)),i=React.useMemo(()=>cp(s,e,{...t,freezeStructure:n}),[s,e,
t,n]);React.useEffect(()=>{i.ledger!==s&&a(i.ledger)},[s,i]);let c=React.useCallback(()=>{a(u=>lp(u,e,t))},[e,t]);return{
groups:i.groups,orderChanged:i.orderChanged,sortNow:c,revision:i.ledger.revision}}function Hp(e){return!e||typeof e!="ob\
ject"?"":e.visible_pane_visible?[e.visible_pane_title||null,e.visible_pane_location==="right"?"Right Pane":null].filter(
Boolean).join(" \xB7 "):z_(e)}function fm(e){let t=ae(e);return t?t.replace(/^Gemini\s+/i,"G ").replace(/^Claude\s+/i,"").
replace(/\s*\(Thinking\)\s*/i,"").replace(/\s*\(Medium\)\s*/i,"").replace(/\s+/g," ").trim():""}function gm(e,t=3){return!Array.
isArray(e)||e.length===0?"":e.slice(0,t).map(n=>{let s=n?.percent_used;if(s==null)return null;let a=fm(n?.model);return a?
`${a} ${s}%`:null}).filter(Boolean).join(" \xB7 ")}function pl(e){return e?Nn[e]?.name||e:""}function to(e){let t=ae(e).
trim();if(!t)return"";if(!/^\d{4}-\d{2}-\d{2}T/.test(t))return t;let n=new Date(t);return Number.isNaN(n.getTime())?t:n.
toLocaleString([],{weekday:"short",hour:"numeric",minute:"2-digit"})}function Q_({session:e,config:t,providerUsage:n,onOpenUsage:s}){
let[a,i]=React.useState(!1),[c,u]=React.useState(Date.now()),p=React.useRef(null),b=React.useRef(null),y=React.useMemo(()=>Kc(
n),[n]),S=React.useMemo(()=>yp(e,t,y,c),[e,t,y,c]),A=S.headerWindows.map(ol);if(React.useEffect(()=>{if(!a)return;u(Date.
now());let g=setInterval(()=>u(Date.now()),3e4);return()=>clearInterval(g)},[a]),React.useEffect(()=>{if(!a)return;let g=(T=!1)=>{
i(!1),T&&requestAnimationFrame(()=>p.current?.focus({preventScroll:!0}))},_=T=>{p.current?.contains(T.target)||b.current?.
contains(T.target)||g(!1)},k=T=>{T.key==="Escape"&&(T.preventDefault(),g(!0))};return document.addEventListener("pointer\
down",_),document.addEventListener("keydown",k),requestAnimationFrame(()=>b.current?.querySelector("button")?.focus({preventScroll:!0})),
()=>{document.removeEventListener("pointerdown",_),document.removeEventListener("keydown",k)}},[a]),!S.supported)return null;
let N=S.state==="local"?"Local":S.state==="exhausted"?"Limit":A[0]?.compactValue||"Usage ?",h=Yc(S.credits),d=Xc(S.financials),
v=()=>{i(!1),s()};return React.createElement("div",{className:`session-usage-mini tone-${S.tone} state-${S.state}`,"data\
-testid":"session-usage-mini"},React.createElement("button",{ref:p,type:"button",className:"session-usage-mini-trigger",
"aria-expanded":a,"aria-controls":"session-usage-popover",title:`${S.billingProviderName}: ${N}`,onClick:()=>i(g=>!g)},React.
createElement(fi,{providerId:S.providerMarkId,providerName:S.billingProviderName}),React.createElement("span",{className:"\
session-usage-mini-rows"},S.state==="local"?React.createElement("span",{className:"session-usage-mini-row"},React.createElement(
"strong",null,"Local"),React.createElement("em",null,"no plan limit")):A.length>0?A.map((g,_)=>React.createElement("span",
{className:`session-usage-mini-row ${g.tone}`,key:`${g.label}:${_}`},React.createElement("strong",null,g.label),React.createElement(
"em",null,g.compactValue),React.createElement("i",{"aria-hidden":"true"},React.createElement("b",{style:{width:`${Math.max(
0,Math.min(100,Number(g.usedPercent)||0))}%`}})))):React.createElement("span",{className:"session-usage-mini-row unavail\
able"},React.createElement("strong",null,"Usage"),React.createElement("em",null,S.state==="ambiguous"?"ambiguous":"unava\
ilable"))),React.createElement("span",{className:"session-usage-mini-compact"},N)),a&&React.createElement("div",{ref:b,id:"\
session-usage-popover",className:"session-usage-popover",role:"dialog","aria-modal":"false","aria-label":"Session usage \
details"},React.createElement("div",{className:"session-usage-popover-heading"},React.createElement(fi,{providerId:S.providerMarkId,
providerName:S.billingProviderName}),React.createElement("span",null,React.createElement("strong",null,S.billingProviderName),
React.createElement("small",null,S.plan||S.message||"Usage details")),React.createElement("button",{type:"button",onClick:()=>{
i(!1),p.current?.focus({preventScroll:!0})},"aria-label":"Close usage details"},"\xD7")),React.createElement("dl",{className:"\
session-usage-popover-meta"},React.createElement("div",null,React.createElement("dt",null,"Billing provider"),React.createElement(
"dd",null,S.billingProviderName)),React.createElement("div",null,React.createElement("dt",null,"Model vendor"),React.createElement(
"dd",null,S.modelVendor)),React.createElement("div",null,React.createElement("dt",null,"Current model"),React.createElement(
"dd",null,S.modelLabel||S.modelId||"Not reported")),React.createElement("div",null,React.createElement("dt",null,"Accoun\
t"),React.createElement("dd",null,S.accountLabel||(S.state==="ambiguous"?"Ambiguous":"Unavailable"))),React.createElement(
"div",null,React.createElement("dt",null,"Quota domain"),React.createElement("dd",null,S.quotaDomain||"Unavailable")),React.
createElement("div",null,React.createElement("dt",null,"Mapping"),React.createElement("dd",null,S.mappingConfidence.replace(
/_/g," ")))),S.state==="local"?React.createElement("div",{className:"session-usage-popover-state local"},React.createElement(
"strong",null,"Local \xB7 no plan limit"),React.createElement("span",null,S.localRuntime?.loadedModelsCount??0," loaded \
model(s)")):S.applicableWindows.length>0?React.createElement("div",{className:"session-usage-popover-windows"},S.applicableWindows.
map((g,_)=>{let k=ol(g);return React.createElement("div",{className:`session-usage-popover-window ${k.tone}`,key:`${g.id}\
:${_}`},React.createElement("span",null,React.createElement("strong",null,k.label),React.createElement("em",null,k.usedPercent==
null?"Usage unavailable":`${Dt(k.usedPercent)} used \xB7 ${k.compactValue}`)),React.createElement("i",{"aria-hidden":"tr\
ue"},React.createElement("b",{style:{width:`${Math.max(0,Math.min(100,Number(k.usedPercent)||0))}%`}})),React.createElement(
"small",null,k.reset?`Resets ${oa(k.reset,c)}`:"Reset not reported",g.modelScope?.label?` \xB7 ${g.modelScope.label}`:""))})):
React.createElement("div",{className:`session-usage-popover-state ${S.state}`},React.createElement("strong",null,S.message),
React.createElement("span",null,"No percentage or $0 value is inferred.")),(h||d.length>0)&&React.createElement("div",{className:"\
session-usage-popover-financial"},React.createElement("strong",null,"Credits / overage"),h&&React.createElement("span",null,
h),d.map(g=>React.createElement("span",{key:g.id},g.label,": ",g.value))),React.createElement("div",{className:"session-\
usage-popover-source"},React.createElement("span",null,S.source||"Source unavailable"," \xB7 ",sr(S.capturedAt,c)),React.
createElement("span",null,"Generation ",S.generation," \xB7 ",S.freshness)),React.createElement("button",{type:"button",
className:"session-usage-open-dashboard",onClick:v},"Open Usage & limits")))}function hm(e){return!e||typeof e!="object"?
"":ae(e.host_label||(e.host_type==="vscode"?"VS Code":e.host_type==="antigravity_ide"?"Antigravity IDE":""))}var J_={healthy:"\
#3fb950",degraded:"#d29922",disconnected:"#f85149"},Up={thinking:{icon:"\u25CC",tone:"thinking"},generating:{icon:"\u2726",
tone:"thinking"},reading_files:{icon:"\u229E",tone:"info"},running_command:{icon:">",tone:"info"},applying_patch:{icon:"\
\u0394",tone:"info"},waiting_for_user:{icon:"?",tone:"idle"},idle:{icon:"\xB7",tone:"idle"},working:{icon:"\u2022",tone:"\
info"}};function eo({agentType:e,compact:t=!1,animate:n=!0}){let s=String(e||"default").toLowerCase(),a=n?"":" static";return s===
"claude"||s==="claude_cli"?React.createElement("span",{className:`native-activity-spinner claude${t?" compact":""}${a}`},
n?React.createElement(mb,null):React.createElement("span",{className:"claude-spinner-icon"},Si[0])):s==="codex"||s==="co\
dex-desktop"||s==="codex_cli"?React.createElement("span",{className:`native-activity-spinner codex${t?" compact":""}${a}`,
"aria-label":"Working"},"\u25CC"):s==="cursor"?React.createElement("span",{className:`native-activity-spinner cursor${t?
" compact":""}${a}`,"aria-label":"Generating"},React.createElement("i",null),React.createElement("i",null),React.createElement(
"i",null)):React.createElement("span",{className:`native-activity-spinner generic${t?" compact":""}${a}`},React.createElement(
"i",null))}function Z_({msg:e,deliveryStates:t,onSteer:n,onRetry:s}){if(e._optimistic){let a=t[e._cid]||"queued";if(a===
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
Recorded; native delivery receipt unknown"},"Recorded")}function eb(e,t=!1){let[n,s]=React.useState(()=>tl(e)),a=React.useMemo(
()=>ap(n,e,{freezeStructure:t}),[n,e,t]);return React.useEffect(()=>{a.ledger!==n&&s(a.ledger)},[n,a]),{sessions:a.sessions,
revision:a.ledger.revision,deferred:a.deferred}}function tb(e,t){let[n,s]=React.useState(Date.now());return React.useEffect(
()=>{let a=Date.now(),c=[...Object.values(e||{}),...Array.isArray(t)?t.map(p=>p?.activity):[]].reduce((p,b)=>{let y=Qo(b),
S=y?y+qc:0;return S<=a?p:p===0?S:Math.min(p,S)},0);if(!c)return;let u=setTimeout(()=>s(Date.now()),Math.max(25,c-a+25));
return()=>clearTimeout(u)},[e,t,n]),n}function nb({stream:e,activeAgent:t,monospace:n}){let s=Me(null),a=Me("");return us(
()=>{let i=s.current;if(!i)return;let c=String(e?.content||""),u=a.current;if(c.startsWith(u)){let p=c.slice(u.length);p&&
i.appendChild(document.createTextNode(p))}else i.textContent=c;a.current=c},[e?.content]),React.createElement("div",{className:`\
message assistant live-draft provisional-stream${n?" monospace":""}`,"data-message-id":e?.messageId||"awaiting-first-del\
ta","data-message-role":"assistant","data-message-timestamp":In(e?.startedAtMs)?.iso||void 0,"data-stream-open":e?.open?
"true":"false"},React.createElement("div",{className:"assistant-gutter"},React.createElement("div",{className:"agent-bad\
ge transcript-agent-badge",style:{color:t.color,borderColor:t.color+"55",background:t.color+"18"}},t.logo?React.createElement(
"img",{src:t.logo,alt:t.abbr,className:"agent-badge-logo"}):t.abbr)),React.createElement("div",{className:"assistant-con\
tent"},React.createElement("div",{className:"message-role"},React.createElement("span",{className:"message-role-label"},
t.name),React.createElement(Ci,{instant:e?.startedAtMs})),React.createElement("div",{className:"provisional-stream-text",
ref:s}),e?.open&&React.createElement("span",{className:"provisional-stream-caret","aria-label":"Streaming response"})))}
function sb({msg:e,messageKey:t,activeAgent:n,assistantMonospace:s,autoExpandLongCodeBlocks:a,onOpenPath:i,agentType:c,preview:u,
fileContents:p,onClosePreview:b,deliveryState:y,onSteer:S,onRetry:A,richContentEager:N,searchMatch:h=!1}){let d=Ct(e.content)||
no(e.content_blocks),v=N_(e.content),g=Xa(e),_=e.role!=="user"&&cr(e.content_blocks).length>0,k=e.source_message_id||e.native_source_id||
"",T=k_(e),L=w_(e);if(e.role==="user"){let H=e._cid?{[e._cid]:y}:{};return React.createElement("div",{className:`message\
 user transcript-virtual-row${e._optimistic&&y==="failed"?" failed":""}${h?" search-match":""}`,"data-message-key":t,"da\
ta-message-id":e.id||void 0,"data-message-role":"user","data-message-block-type":L,"data-message-content-hash":T,"data-m\
essage-source-id":k||void 0,"data-message-timestamp":g?.iso||"unknown"},React.createElement("div",{className:"user-gutte\
r"},React.createElement("div",{className:"user-glyph"})),React.createElement("div",{className:"user-content"},React.createElement(
"div",{className:"message-role"},React.createElement("span",{className:"message-role-label"},"You"),React.createElement(
Ci,{message:e}),React.createElement(Z_,{msg:e,deliveryStates:H,onSteer:S,onRetry:A})),/!\[[^\]]*\]\((?:data:|\/uploads\/)/.
test(v)?React.createElement("div",{className:"user-text"},React.createElement(Ya,{content:v,deferUntilVisible:!N,cacheIdentity:`${t}\
:user`})):React.createElement("div",{className:"user-text"},d)))}return React.createElement("div",{className:`message as\
sistant transcript-virtual-row${s?" monospace":""}${h?" search-match":""}`,"data-message-key":t,"data-message-id":e.id||
void 0,"data-message-role":"assistant","data-message-block-type":L,"data-message-content-hash":T,"data-message-source-id":k||
void 0,"data-message-timestamp":g?.iso||"unknown"},React.createElement("div",{className:"assistant-gutter"},React.createElement(
"div",{className:"agent-badge transcript-agent-badge",style:{color:n.color,borderColor:n.color+"55",background:n.color+"\
18"}},n.logo?React.createElement("img",{src:n.logo,alt:n.abbr,className:"agent-badge-logo"}):n.abbr)),React.createElement(
"div",{className:"assistant-content"},React.createElement("div",{className:"message-role"},React.createElement("span",{className:"\
message-role-label"},n.name),React.createElement(Ci,{message:e})),_?React.createElement(M_,{blocks:e.content_blocks,monospace:s,
autoExpandLongCodeBlocks:a,onOpenPath:H=>i(t,H),agentType:c,richContentEager:N,richContentCacheIdentity:t}):React.createElement(
Ya,{content:Ct(e.content),monospace:s,autoExpandLongCodeBlocks:a,onOpenPath:H=>i(t,H),deferUntilVisible:!N,cacheIdentity:`${t}\
:assistant`}),u&&React.createElement(Wb,{sessionId:u.sessionId,filePath:u.path,fileContents:p,onClose:b})))}function Wp(e){
return e?`${e.sessionId}${e.messageKey}${e.path}`:""}function yl(e){return[e?.name,e?.color,e?.abbr,e?.logo||""].join(
"")}function ab(e,t){return e.msg===t.msg&&e.messageKey===t.messageKey&&e.assistantMonospace===t.assistantMonospace&&e.
autoExpandLongCodeBlocks===t.autoExpandLongCodeBlocks&&e.agentType===t.agentType&&yl(e.activeAgent)===yl(t.activeAgent)&&
Wp(e.preview)===Wp(t.preview)&&e.fileContents===t.fileContents&&e.deliveryState===t.deliveryState&&e.onRetry===t.onRetry&&
e.richContentEager===t.richContentEager&&e.searchMatch===t.searchMatch}var rb=React.memo(sb,ab),ob=100,vi=1200,ls=32;function zp(e){
let t=Ct(e?.content)||no(e?.content_blocks),n=Math.max(1,ae(t).split(`
`).length);if(e?.role==="user")return Math.min(180,40+Math.max(0,n-1)*18);let s=Math.ceil(ae(t).length/100),a=cr(e?.content_blocks).
length*28;return Math.min(420,68+Math.max(n,s)*18+a)}function ml(e,t){let n=0,s=Math.max(0,e.length-1);for(;n<s;){let a=Math.
floor((n+s)/2);e[a]<=t?n=a+1:s=a}return Math.max(0,n-1)}function ib({index:e,messageKey:t,onMeasure:n,children:s}){let a=React.
useRef(null);return React.useLayoutEffect(()=>{let i=a.current;if(!i)return;let c=()=>n(e,t,i.getBoundingClientRect().height);
if(c(),typeof ResizeObserver>"u")return;let u=new ResizeObserver(c);return u.observe(i),()=>u.disconnect()},[e,t,n]),React.
createElement("div",{className:"transcript-window-row","data-window-index":e,ref:a},s)}function cb({messages:e,containerRef:t,
sessionId:n,routeActive:s}){let a=s&&e.length>ob,i=React.useRef(a);i.current=a;let c=React.useRef(new Map),u=React.useRef(
n);u.current!==n&&(c.current.clear(),u.current=n);let p=React.useRef([0]),b=React.useRef(null),y=React.useRef(null),S=React.
useRef(0),A=React.useRef(0),N=React.useRef({sessionId:null,keys:[],prefix:[0]}),h=React.useRef(0),d=React.useRef(0),v=React.
useRef(null),g=React.useRef(null),_=React.useRef(0),k=React.useRef(0),[T,L]=React.useState(0),[H,V]=React.useState({sessionId:null,
start:0,end:0}),ne=React.useMemo(()=>e.map((W,G)=>`${n||""}${Cl(W,G)}`),[e,n]),ee=React.useMemo(()=>{let W=new Array(e.
length+1);W[0]=0;for(let G=0;G<e.length;G+=1){let $=c.current.get(ne[G]);W[G+1]=W[G]+($||zp(e[G]))}return W},[e,ne,T]);p.
current=ee;let re=React.useCallback(()=>{if(y.current)return;let W=t.current;if(!a||!W)return;let G=W.getBoundingClientRect(),
$=G.top,P=Array.from(W.querySelectorAll(".transcript-window-row[data-window-index]")),B=P.find(ce=>{let ie=ce.getBoundingClientRect();
return ie.top>=$&&ie.top<G.bottom})||P.find(ce=>ce.getBoundingClientRect().bottom>$)||P[0];if(!B)return;let te=Number(B.
dataset.windowIndex);!Number.isInteger(te)||!ne[te]||(b.current={sessionId:n,key:ne[te],viewportOffset:B.getBoundingClientRect().
top-$})},[t,a,ne,n]),z=React.useCallback(()=>{v.current=null,g.current=null,_.current&&clearTimeout(_.current),_.current=
0},[]),oe=React.useCallback(()=>{let W=t.current;if(!a||!W)return;let G=y.current;if(G?.sessionId===n){let xe=ne.indexOf(
G.key);if(xe>=0){V(Ie=>Ie.sessionId===n&&Ie.start===xe&&Ie.end===Math.min(e.length,xe+ls)?Ie:{sessionId:n,start:xe,end:Math.
min(e.length,xe+ls)});return}}re();let $=p.current,P=Math.max(0,W.scrollTop-vi),B=W.scrollTop+W.clientHeight+vi,te=Math.
max(0,ml($,P)-1),ce=Math.min(e.length,ml($,B)+2),ie=ce>=e.length?Math.max(0,e.length-ls):te,be=ce,Ne=g.current,Se=Ne?ne.
indexOf(Ne):v.current;Se>=0&&(v.current=Se);let Ee=Se;Number.isInteger(Ee)&&Ee>=0&&Ee<e.length&&(ie=Math.min(ie,Math.max(
0,Ee-ls)),be=Math.max(be,Math.min(e.length,Ee+ls+1))),React.startTransition(()=>{V(xe=>xe.sessionId===n&&xe.start===ie&&
xe.end===be?xe:{sessionId:n,start:ie,end:be})})},[re,t,a,ne,e.length,n]);React.useLayoutEffect(()=>{let W=N.current;if(N.
current={sessionId:n,keys:ne,prefix:ee},!a||W.sessionId!==n||!W.keys.length){y.current?.routeRestore||(y.current=null),S.
current&&clearTimeout(S.current),S.current=0,re();return}let G=b.current;if(!G||G.sessionId!==n||!G.key)return;let $=W.keys.
indexOf(G.key),P=ne.indexOf(G.key);if($<0||P<0||$===P)return;let B=t.current;if(!B)return;let te=W.prefix[$]||0,ce=ee[P]||
0;y.current={sessionId:n,key:G.key,viewportOffset:G.viewportOffset},v.current=P,g.current=G.key,S.current&&clearTimeout(
S.current),S.current=setTimeout(()=>{y.current=null,S.current=0,z(),re()},1500),V({sessionId:n,start:P,end:Math.min(e.length,
P+ls)}),nn(B,Math.max(0,B.scrollTop+ce-te))},[re,t,a,ne,e.length,ee,z,n]),React.useLayoutEffect(()=>{let W=y.current;if(!W||
W.sessionId!==n)return;let G=ne.indexOf(W.key);if(G<H.start||G>=H.end)return;let $=t.current,P=$?.querySelector(`.transc\
ript-window-row[data-window-index="${G}"]`);if(!$||!P)return;if(W.atBottom){nn($,$.scrollHeight),b.current=W;return}let te=P.
getBoundingClientRect().top-$.getBoundingClientRect().top-W.viewportOffset;Math.abs(te)>=.5&&nn($,Math.max(0,$.scrollTop+
te)),b.current=W},[t,a,ne,ee,H,n]),React.useLayoutEffect(()=>{let W=y.current;if(!a||!W?.routeRestore)return;let G=!0,$=()=>{
if(!G)return;let P=y.current,B=t.current;if(!P?.routeRestore||P.sessionId!==n||!B)return;let te=ne.indexOf(P.key),ce=te>=
0?B.querySelector(`.transcript-window-row[data-window-index="${te}"]`):null;if(ce)if(P.atBottom)nn(B,B.scrollHeight);else{
let be=ce.getBoundingClientRect().top-B.getBoundingClientRect().top-P.viewportOffset;Math.abs(be)>=.5&&nn(B,Math.max(0,B.
scrollTop+be))}A.current=requestAnimationFrame($)};return $(),S.current&&clearTimeout(S.current),S.current=setTimeout(()=>{
y.current=null,S.current=0,A.current&&cancelAnimationFrame(A.current),A.current=0,z(),re()},1500),()=>{G=!1,A.current&&cancelAnimationFrame(
A.current),A.current=0}},[re,t,a,ne,z,n]),React.useLayoutEffect(()=>{if(!a){z();return}let W=t.current;if(!W)return;oe();
let G=()=>{re();let $=g.current,P=$?ne.indexOf($):v.current;P>=0&&(v.current=P);let B=P,te=p.current;if(Number.isInteger(
B)&&B>=0&&B<e.length){let ce=te[B]||0,ie=te[B+1]||ce,be=W.scrollTop,Ne=be+W.clientHeight;(ie<be-vi||ce>Ne+vi)&&z()}d.current||
(d.current=requestAnimationFrame(()=>{d.current=0,oe()}))};return W.addEventListener("scroll",G,{passive:!0}),()=>{W.removeEventListener(
"scroll",G),d.current&&cancelAnimationFrame(d.current),d.current=0}},[re,a,s,n,ne,e.length,oe,z]),React.useLayoutEffect(
()=>{a&&oe()},[a,ee,oe]);let _e=React.useCallback((W,G,$)=>{if(!i.current)return;let P=Math.max(1,Math.ceil($)),B=c.current.
get(G)||zp(e[W]);if(Math.abs(P-B)<1)return;c.current.set(G,P);let te=t.current,ce=te?ml(p.current,te.scrollTop):0;W<ce&&
(k.current+=P-B),!h.current&&(h.current=requestAnimationFrame(()=>{if(h.current=0,!i.current){k.current=0;return}let ie=t.
current,be=k.current;k.current=0,ie&&Math.abs(be)>=1&&nn(ie,Math.max(0,ie.scrollTop+be)),L(Ne=>Ne+1)}))},[t,e]);React.useLayoutEffect(
()=>{a||!h.current||(cancelAnimationFrame(h.current),h.current=0,k.current=0)},[a]),React.useEffect(()=>()=>{h.current&&
cancelAnimationFrame(h.current),d.current&&cancelAnimationFrame(d.current),_.current&&clearTimeout(_.current),S.current&&
clearTimeout(S.current),A.current&&cancelAnimationFrame(A.current)},[]);let Y=React.useCallback((W,G="center")=>{let $=t.
current,P=p.current;if(!$||W<0||W>=e.length)return!1;v.current=W,g.current=ne[W]||null,_.current&&clearTimeout(_.current),
_.current=setTimeout(()=>{z()},1500);let B=P[W]||0,te=P[W+1]||B,ce=G==="start"?B:G==="end"?te-$.clientHeight:B-Math.max(
0,($.clientHeight-(te-B))/2);nn($,Math.max(0,ce));let ie=Math.max(0,W-ls),be=Math.min(e.length,W+ls+1);return V({sessionId:n,
start:ie,end:be}),!0},[t,ne,e.length,z,n]),ve=React.useCallback(()=>{re();let W=b.current;if(!W||W.sessionId!==n)return!1;
let G=ne.indexOf(W.key);return G<0?!1:(v.current=G,g.current=W.key,!0)},[re,ne,n]),he=React.useCallback(()=>{let W=t.current;
if(!a||!W)return!1;re();let G=b.current;if(!G||G.sessionId!==n||!G.key)return!1;let $=ne.indexOf(G.key);return $<0?!1:(y.
current={...G,routeRestore:!0,atBottom:W.scrollHeight-W.scrollTop-W.clientHeight<80},v.current=$,g.current=G.key,!0)},[re,
t,a,ne,n]),X=React.useCallback(()=>y.current?.routeRestore?(y.current=null,S.current&&clearTimeout(S.current),S.current=
0,A.current&&cancelAnimationFrame(A.current),A.current=0,z(),re(),!0):!1,[re,z]),me=0,J=e.length;return a&&(H.sessionId===
n&&H.end>H.start?(me=H.start,J=H.end):me=Math.max(0,e.length-ls)),{enabled:a,start:me,end:J,totalHeight:ee[ee.length-1]||
0,topSpacerHeight:a&&ee[me]||0,bottomSpacerHeight:a?ee[ee.length-1]-(ee[J]||0):0,onMeasure:_e,scrollToIndex:Y,prepareForPrepend:ve,
prepareForRouteChange:he,cancelRouteRestore:X}}function lb({qm:e,onSteer:t,onDiscard:n,onEdit:s}){let[a,i]=React.useState(
!1),[c,u]=React.useState(!1),[p,b]=React.useState(e.content),y=React.useRef(null);return React.useEffect(()=>{if(!a)return;
let S=A=>{y.current&&!y.current.contains(A.target)&&i(!1)};return document.addEventListener("mousedown",S),()=>document.
removeEventListener("mousedown",S)},[a]),c?React.createElement("div",{className:"queued-item editing"},React.createElement(
"textarea",{className:"queued-edit-input",value:p,onChange:S=>b(S.target.value),onKeyDown:S=>{S.key==="Enter"&&!S.shiftKey&&
(S.preventDefault(),s(p),u(!1)),S.key==="Escape"&&u(!1)},rows:2,autoFocus:!0}),React.createElement("button",{className:"\
steer-btn",onClick:()=>{s(p),u(!1)}},"Save"),React.createElement("button",{className:"queued-trash-btn",onClick:()=>u(!1),
title:"Cancel"},"\u2715")):e.native?React.createElement("div",{className:"queued-item native"},React.createElement("span",
{className:"queued-item-text"},e.content),e.status&&e.status!=="queued"&&React.createElement("span",{className:`queued-i\
tem-status ${e.status}`},e.status),React.createElement("div",{className:"queued-actions"},React.createElement("button",{
className:"steer-btn",onClick:t,title:"Click Steer in Codex"},"Steer \u25B8"),React.createElement("button",{className:"q\
ueued-trash-btn",onClick:n,title:"Delete queued message"},"\u{1F5D1}"))):React.createElement("div",{className:"queued-it\
em"},React.createElement("span",{className:"queued-item-text"},e.content),React.createElement("div",{className:"queued-a\
ctions"},React.createElement("button",{className:"steer-btn",onClick:t,title:"Send to agent now"},"Steer \u25B8"),React.
createElement("button",{className:"queued-trash-btn",onClick:n,title:"Discard message"},"\u{1F5D1}"),React.createElement(
"div",{className:"queued-menu-wrap",ref:y},React.createElement("button",{className:"queued-more-btn",onClick:()=>i(!a),title:"\
More options"},"\xB7\xB7\xB7"),a&&React.createElement("div",{className:"queued-dropdown"},React.createElement("button",{
onClick:()=>{i(!1),b(e.content),u(!0)}},"\u270F Edit message"),React.createElement("button",{onClick:()=>{i(!1),n()}},"\u{1F5D1}\
 Discard")))))}function ub({session:e,health:t,unread:n,isThinking:s,isActive:a,agentConfig:i,activity:c,sessionMessages:u,
hasBlockingPrompt:p,blockingPromptLabel:b,muted:y,pinned:S,workspaceLabel:A,recentMessageAt:N,menuOpen:h,onMenuToggle:d,
onSelect:v,onClose:g,onManage:_,onPinChange:k,onAutomations:T,showAutomationsActive:L,onSkills:H,showSkillsActive:V}){let ne=$e(
e),ee=ir(e,i),re=or(e,ne,i),z=Zr(e,ne,i,u),oe=[z,re||ee.name].filter(Boolean).join(" - "),_e=J_[t]||"#444c56",Y=e?.rate_limited_until||
null,ve=e?.rate_limit_active===!0,he=e?.percent_used,X=e?.agent_type==="antigravity"||e?.agent_type==="antigravity_panel",
me=X?gm(e?.antigravity_quota_models,3):"",J=Zo(c,{health:t}),W=s?J||c?.label||"Working":null,G=hm(e),$=A?`${ee.name} / ${A}`:
ee.name,P=N?In(N):null;return React.createElement("div",{className:`session-card${a?" active":""}${ve?" rate-limited":""}${S?
" pinned":""}`,"data-session-id":ne,"data-last-message-at":P?.iso||void 0,onClick:v,onKeyDown:B=>{B.target!==B.currentTarget||
!["Enter"," "].includes(B.key)||(B.preventDefault(),v())},tabIndex:0,"aria-label":`${z}. ${re||ee.name}`,title:oe||ne},React.
createElement("div",{className:"session-card-badge-wrap"},React.createElement("div",{className:"agent-badge",style:{color:ee.
color,borderColor:ee.color+"55",background:ee.color+"18"}},ee.logo?React.createElement("img",{src:ee.logo,alt:ee.abbr,className:"\
agent-badge-logo"}):ee.abbr),React.createElement("div",{className:"session-card-health",style:{background:_e},title:t||"\
unknown"}),y&&React.createElement("span",{className:"session-card-muted",title:"Notifications muted","aria-label":"Notif\
ications muted"},"M"),S&&React.createElement("button",{type:"button",className:"session-card-pin-toggle",title:`Unpin ${z}`,
"aria-label":`Unpin ${z}`,"aria-pressed":"true",onClick:B=>{B.preventDefault(),B.stopPropagation(),k?.(!1)}},React.createElement(
"span",{"aria-hidden":"true"},"\u{1F4CC}")),React.createElement("span",{className:"session-card-attention-slot"},p&&React.
createElement("span",{className:"session-card-perm-badge",title:b||"Action required"},"\u26A0"),!p&&ve&&React.createElement(
"span",{className:"session-card-perm-badge",title:"Usage limited"},"\u23F3"),!p&&!ve&&s&&React.createElement("span",{className:"\
session-card-native-status",title:W||"Thinking\u2026"},React.createElement(eo,{agentType:e?.agent_type,compact:!0,animate:!1})),
!s&&!p&&!ve&&n>0&&React.createElement("span",{className:"session-card-badge"},n>99?"99+":n))),React.createElement("div",
{className:"session-card-body"},React.createElement(mi,{title:z,disclosureKey:ne,kind:"session",wrapperClassName:"sessio\
n-title-details",triggerClassName:"session-card-name",disclosureClassName:"session-title-disclosure",triggerLabel:`Show \
full title: ${z}`,triggerTag:"div"}),React.createElement("div",{className:`session-card-sub${p?" perm-active":""}${P?" h\
as-recent-message":""}`},React.createElement("span",{className:"session-card-sub-context"},p?`${$} \xB7 ${b||"Action req\
uired"}`:ve?`${$} \xB7 \u23F3 Usage limited${Y&&Y!=="unknown"?` \xB7 resets ${to(Y)}`:" \xB7 reset unknown"}`:me?`${$} \xB7\
 ${me}`:X&&he!=null?`${$} \xB7 \u{1F4CA} ${he}% used${Y&&Y!=="unknown"?` \xB7 ${Y}`:""}`:he>=75?`${$} \xB7 \u{1F4CA} ${he}\
% used${Y&&Y!=="unknown"?` \xB7 resets ${to(Y)}`:""}`:W?`${$} \xB7 ${W}`:G?`${$} \xB7 ${G}`:$),P&&React.createElement(React.
Fragment,null,React.createElement("span",{"aria-hidden":"true"}," \xB7 "),React.createElement("time",{dateTime:P.iso},xc(
P))))),React.createElement("div",{className:"session-card-right"},React.createElement("details",{className:"session-card\
-menu",open:h,onToggle:B=>d?.(B.currentTarget.open),onClick:B=>B.stopPropagation()},React.createElement("summary",{className:"\
session-card-manage",title:"Session actions","aria-label":`Session actions for ${z}`},"\u22EF"),React.createElement("div",
{className:"session-card-menu-popover",role:"menu","aria-label":`Actions for ${z}`},React.createElement("button",{role:"\
menuitem",onClick:()=>k?.(!S)},S?"Unpin chat":"Pin chat"),React.createElement("button",{role:"menuitem",onClick:()=>_&&_()},
"Manage session"),T&&React.createElement("button",{role:"menuitem",className:L?"active":"",onClick:()=>T()},"Automations"),
H&&React.createElement("button",{role:"menuitem",className:V?"active":"",onClick:()=>H()},"Skills"),React.createElement(
"button",{role:"menuitem",className:"danger",onClick:()=>g&&g()},"Close session")))))}function Gp(e){let t=Array.isArray(
e)?e:[];if(!t.length)return"0";let n=t[0],s=t[t.length-1];return[t.length,n?.role||"",ae(n?.content).slice(0,120),s?.role||
"",ae(s?.content).slice(0,120)].join("")}function Kp(e){return e?[e.model_id||"",e.effort||"",e.permission_mode||"",e.file_access_scope||
""].join(""):""}function Vp(e){return e?[e.kind||"",e.label||"",e.goal?.status||"",e.goal?.label||"",e.goal_run?.lifecycle||
"",e.goal_run?.lease_active===!0?"leased":"released",e.goal_run?.transition_id||""].join(""):""}function db(e,t){return e.
session===t.session&&e.health===t.health&&e.unread===t.unread&&e.isThinking===t.isThinking&&e.isActive===t.isActive&&e.hasBlockingPrompt===
t.hasBlockingPrompt&&e.blockingPromptLabel===t.blockingPromptLabel&&e.muted===t.muted&&e.pinned===t.pinned&&e.workspaceLabel===
t.workspaceLabel&&e.recentMessageAt===t.recentMessageAt&&e.menuOpen===t.menuOpen&&e.showAutomationsActive===t.showAutomationsActive&&
e.showSkillsActive===t.showSkillsActive&&Kp(e.agentConfig)===Kp(t.agentConfig)&&Vp(e.activity)===Vp(t.activity)&&Gp(e.sessionMessages)===
Gp(t.sessionMessages)}var pb=React.memo(ub,db),Yp=["\xB7","\u2722","*","\u2736","\u273B","\u273D"],Si=[...Yp,...[...Yp].
reverse()];function mb(){let[e,t]=React.useState(0),[n,s]=React.useState(()=>typeof window<"u"&&typeof window.matchMedia==
"function"&&window.matchMedia("(prefers-reduced-motion: reduce)").matches);return React.useEffect(()=>{if(typeof window>
"u"||typeof window.matchMedia!="function")return;let a=window.matchMedia("(prefers-reduced-motion: reduce)"),i=c=>s(c.matches);
return s(a.matches),a.addEventListener?.("change",i),()=>a.removeEventListener?.("change",i)},[]),React.useEffect(()=>{if(n){
t(0);return}let a=Si.length*3,i=setInterval(()=>{if(a-=1,a<=0){clearInterval(i),t(0);return}t(c=>(c+1)%Si.length)},120);
return()=>clearInterval(i)},[n]),React.createElement("span",{className:"claude-spinner-icon"},Si[e])}function Xp(e,t){let n=e?
new Date(e).getTime():0;if(!Number.isFinite(n)||n<=0)return"";let s=Math.max(0,Math.floor((t-n)/1e3));return Rl(s,{includeSeconds:!0})}
function Rl(e,{includeSeconds:t=!1}={}){if(e=Math.max(0,Math.floor(Number(e)||0)),e<60)return`${e}s`;let n=Math.floor(e/
60),s=e%60;if(n<60)return t?`${n}m ${String(s).padStart(2,"0")}s`:`${n}m`;let a=Math.floor(n/60),i=n%60;return a>=24?`${Math.
floor(a/24)}d ${String(a%24).padStart(2,"0")}h ${String(i).padStart(2,"0")}m${t?` ${String(s).padStart(2,"0")}s`:""}`:`${a}\
h ${String(i).padStart(2,"0")}m${t?` ${String(s).padStart(2,"0")}s`:""}`}function _m(e,t,n=null){return e?Rl(vd(e,n,t),{
includeSeconds:!0}):""}function fb({activity:e,thinkingText:t,agentType:n,pinned:s=!1}){let a=e?.kind||"working",i=Up[a]||
Up.working,c=e?.goal||null,u=i.tone==="thinking"||i.tone==="info",b=(c?.state||c?.status)==="active"&&(!e?.goal_run||e.goal_run.
lease_active===!0),y=!!(e?.thinking||e?.current),S=String(t||e?.thinkingContent||"").trim(),A=n==="claude"||n==="claude_\
cli",N=e?.thinking||(!y&&(a==="thinking"||A)?{text:S,since:e?.startedAt||e?.updatedAt||null}:null),h=e?.current||(!y&&!N&&
u?{kind:a==="running_command"?"tool":"answer",label:e?.label||(a==="running_command"?"Running command":"Working"),partial:S,
since:e?.startedAt||e?.updatedAt||null}:null),d=e?.step||null,v=e?.usage||null,[g,_]=React.useState(Date.now()),k=N?N.since||
e?.startedAt||e?.updatedAt:null,T=h?h.since||e?.startedAt||e?.updatedAt:null,L=oe=>!!oe&&Number.isFinite(new Date(oe).getTime()),
H=b&&L(c?.updated_at)||L(k)||L(T);React.useEffect(()=>{if(!H)return;let oe=setInterval(()=>_(Date.now()),1e3);return()=>clearInterval(
oe)},[H,c?.updated_at,k,T]);let V=e?.interruptHint||e?.interrupt_hint||"",ne=c?_m(c,g,e?.goal_run):"",ee=String(c?.text||
c?.objective||"").trim(),re=N?Xp(k,g):"",z=h?Xp(T,g):"";return!c&&!N&&!h&&!d&&!v?null:React.createElement("div",{className:`\
live-status-stack${s?" pinned":""}`,"data-testid":"live-status-stack"},h&&React.createElement("div",{className:`live-cur\
rent-status ${h.kind||"answer"}`,"data-live-channel":"current"},React.createElement("div",{className:"live-current-tool-\
heading"},h.kind==="tool"?React.createElement("span",{className:"live-status-icon"},"\u25B6"):React.createElement(eo,{agentType:n,
compact:!0}),React.createElement("span",{className:"live-status-label"},h.label||(h.kind==="tool"?"Running tool":"Workin\
g")),React.createElement("span",{className:"live-status-meta"},[z,V].filter(Boolean).join(" \xB7 "))),h.partial&&(h.kind===
"tool"?React.createElement("pre",{className:"live-current-output"},h.partial):React.createElement("p",{className:"live-c\
urrent-narration"},h.partial))),N&&React.createElement("div",{className:"live-thinking-row","data-live-channel":"thinkin\
g"},React.createElement("div",{className:"live-thinking-heading"},React.createElement(eo,{agentType:n}),React.createElement(
"span",{className:"live-status-label"},N.label||e?.label||"Thinking"),re&&React.createElement("span",{className:"live-st\
atus-meta"},re)),N.text&&React.createElement("div",{className:"live-thinking-text"},N.text)),d&&React.createElement("div",
{className:"live-step-wrap","data-live-channel":"step"},React.createElement("div",{className:"live-step-chip",title:d.text||
""},d.state==="in_progress"?React.createElement(eo,{agentType:n,compact:!0}):React.createElement("span",null,"\u25CC"),React.
createElement("span",null,"Step ",d.current||1," / ",d.total||1),(d.added!=null||d.deleted!=null)&&React.createElement("\
span",{className:"live-step-diff"},"\xB7 +",d.added||0," \u2212",d.deleted||0))),c&&React.createElement("details",{className:"\
live-goal-row","data-live-channel":"goal"},React.createElement("summary",{title:ee},React.createElement("span",{className:"\
live-status-icon"},"\u26F3"),React.createElement("span",{className:"live-status-label"},c.label||"Pursuing goal"),React.
createElement("span",{className:"live-goal-objective"},ee||"Active goal"),React.createElement("span",{className:"live-st\
atus-meta"},ne||c.state||c.status||"active")),ee&&React.createElement("div",{className:"live-goal-expanded"},ee)),v&&React.
createElement("div",{className:"live-usage-banner","data-live-channel":"usage",role:"status"},React.createElement("div",
{className:"live-usage-title"},v.title||"Usage limit reached"),React.createElement("div",{className:"live-usage-detail"},
v.detail||(v.resets_at?`Your rate limit resets at ${v.resets_at}.`:"Usage is currently exhausted."))))}function gb({taskList:e,
sessionId:t}){let n=e?.content_blocks?.find(A=>A?.type==="plan"),s=n?{...e,...n}:e;if(!s||!s.tasks||s.tasks.length===0)return null;
let a=t?`remote-agent-chat:task-list-collapsed:${t}`:null,i=!1,[c,u]=React.useState(()=>{if(!a)return i;let A=localStorage.
getItem(a);return A==null?i:A==="1"});React.useEffect(()=>{if(!a){u(i);return}let A=localStorage.getItem(a);u(A==null?i:
A==="1")},[a,i]);let p=()=>{u(A=>{let N=!A;return a&&localStorage.setItem(a,N?"1":"0"),N})},b={completed:"\u2713",in_progress:"\
\u25CC",pending:"\u25CB"},y={completed:"done",in_progress:"active",pending:""},S=s.tasks.find(A=>A.state==="in_progress");
return React.createElement("div",{className:`codex-task-list${c?" collapsed":""}`},React.createElement("button",{type:"b\
utton",className:"codex-task-header",onClick:p,"aria-expanded":!c,title:c?"Expand task list":"Collapse task list"},React.
createElement("span",{className:"codex-task-chevron"},c?"\u25B8":"\u25BE"),React.createElement("span",{className:"codex-\
task-count"},s.completed,"/",s.total," tasks"),c&&S?.text&&React.createElement("span",{className:"codex-task-active-summ\
ary"},S.text)),!c&&React.createElement("div",{className:"codex-task-items"},s.tasks.map((A,N)=>React.createElement("div",
{key:N,className:`codex-task-item ${y[A.state]||""}`},React.createElement("span",{className:"codex-task-icon"},b[A.state]||
"\u25CB"),React.createElement("span",{className:"codex-task-text"},A.text)))))}function hb({card:e,tone:t="cline"}){if(!e)
return null;let n=Number.isFinite(Number(e.percent_used))?Math.max(0,Math.min(100,Number(e.percent_used))):null,s=ae(e.title||
"Current context"),a=ae(e.subtitle||""),i=ae(e.detail||""),c=ae(e.label||e.usage_label||"");return React.createElement("\
div",{className:`cline-context-card ${t}-context-card`},React.createElement("div",{className:"cline-context-header"},React.
createElement("div",{className:"cline-context-copy"},React.createElement("div",{className:"cline-context-title"},s),a&&React.
createElement("div",{className:"cline-context-subtitle"},a),i&&React.createElement("div",{className:"cline-context-detai\
l"},i)),c&&React.createElement("div",{className:"cline-context-usage"},c)),n!=null&&React.createElement("div",{className:"\
cline-context-meter",title:`${e.percent_used}% of context window used`},React.createElement("div",{className:"cline-cont\
ext-meter-fill",style:{width:`${n}%`}})))}function Fn(e,t){return e?.choice_id||e?.id||e?.value||`choice-${t}`}function Xr(e,t){
return e?.label||e?.title||e?.text||e?.name||Fn(e,t)}function Ml(e,t){let n=new Set(Array.isArray(t)?t:[t]);return(Array.
isArray(e?.content_blocks)?e.content_blocks:[]).find(s=>n.has(s?.type))||null}function Qp(e){return Ml(e,"prompt")?.content||
e?.prompt_text||e?.message||e?.text||"Agent requires permission to continue."}function bm(e){let t=Math.max(0,Math.ceil(
e/1e3)),n=Math.floor(t/60),s=t%60;return`${n}:${String(s).padStart(2,"0")}`}function _b(e,t){return e?.deadline_at?t<=0?
"Native deadline elapsed \xB7 awaiting receipt":`${e.auto_resolution_policy==="native"?"Native auto-resolution in":"Resp\
onse deadline in"} ${bm(t)}`:""}function bb({prompt:e,sessionId:t,agentType:n,onRespond:s,onDismissFocus:a}){let[i,c]=React.
useState(Date.now()),[u,p]=React.useState({}),[b,y]=React.useState({}),[S,A]=React.useState({}),[N,h]=React.useState(""),
[d,v]=React.useState(null),[g,_]=React.useState(!1);React.useEffect(()=>{let P=setInterval(()=>c(Date.now()),500);return()=>clearInterval(
P)},[]),React.useEffect(()=>{p({}),y({}),A({}),h(""),v(null),_(!1)},[e?.prompt_id]);let k=Math.max(0,Number(e?.timeout_ms)||
0),T=Number(e?.received_at)||Date.now(),L=Date.parse(e?.deadline_at||""),H=e?.type==="question_prompt"&&Number.isFinite(
L),V=H?Math.max(0,L-i):k>0?Math.max(0,k-(i-T)):0,ne=Array.isArray(e?.choices)?e.choices:[],ee=e?.submitting_choice_id||null,
re=e?.type==="question_prompt"&&e?.lifecycle!=="open",z=e?.default_choice||null,oe=(e?.kind==="question"||e?.type==="que\
stion_prompt")&&Array.isArray(e?.questions)?e.questions.filter(P=>P&&typeof P=="object"):[],_e=oe.length>0,Y=n==="claude"&&
!_e,ve=ae(e?.command).trim(),he=ae(e?.title).trim()||(ve?"Allow this action?":Qp(e)),X=ae(e?.description).trim(),me=Y&&e?.
alternate_instruction_supported===!0,J=oe.flatMap(P=>(Array.isArray(P.choices)?P.choices:[]).map((B,te)=>({question:P,choiceId:Fn(
B,te)}))).slice(0,9),W=(P,B)=>{p(te=>{let ce=Array.isArray(te[P.question_id])?te[P.question_id]:[],ie=P.multi_select?ce.
includes(B)?ce.filter(be=>be!==B):[...ce,B]:[B];return{...te,[P.question_id]:ie}})},G=oe.every(P=>{let B=Array.isArray(P.
choices)?P.choices:[];if(P.answer_mode==="text"||B.length===0)return P.required===!1||ae(S[P.question_id]).trim().length>
0;let te=u[P.question_id]||[];return te.length===0?!1:te.every(ce=>!B.find((be,Ne)=>Fn(be,Ne)===ce)?.requires_text||ae(b[`${P.
question_id}:${ce}`]).trim())}),$=()=>{if(!G||ee||re)return;let P=oe.map(B=>{let te=Array.isArray(B.choices)?B.choices:[];
if(B.answer_mode==="text"||te.length===0)return{question_id:B.question_id,text:ae(S[B.question_id]).trim()};let ce=u[B.question_id]||
[],ie=te.find((Se,Ee)=>Se.requires_text&&ce.includes(Fn(Se,Ee))),be=ie?te.indexOf(ie):-1,Ne=ie?Fn(ie,be):null;return{question_id:B.
question_id,choice_ids:ce,...Ne?{other_text:ae(b[`${B.question_id}:${Ne}`]).trim()}:{}}});s(t,e.prompt_id,null,{answers:P})};
return React.useEffect(()=>{let P=B=>{let te=B.target?.closest?.(".permission-card"),ce=B.target?.matches?.(".input-area\
 textarea"),ie=B.target===document.body||B.target===document.documentElement;if(!te&&!ce&&!ie||re&&B.key!=="Escape")return;
if(B.key==="Escape"){if(B.preventDefault(),_e&&e?.type==="question_prompt"&&e?.cancel_supported===!0&&!ee&&!re){s(t,e.prompt_id,
null,{action:"cancel"});return}let xe=Y?ne.find((Ie,Ke)=>/^(?:reject|deny|cancel|block|not now|no)\b/i.test(Xr(Ie,Ke).replace(
/^\d+\s+/,""))):null;if(xe&&!ee){s(t,e.prompt_id,Fn(xe,ne.indexOf(xe)));return}_(!0),a?.();return}if(g)return;let be=vl(
B.target),Ne=B.key==="Enter"&&B.target?.closest?.(".permission-other-input");if(B.key==="Enter"&&!B.shiftKey&&B.target?.
closest?.(".permission-alternate-input")){B.preventDefault();let xe=N.trim();xe&&!ee&&s(t,e.prompt_id,null,{instruction:xe});
return}if(ee||be&&!Ne&&!ce)return;if(/^[1-9]$/.test(B.key)){let xe=Number(B.key)-1;if(B.preventDefault(),_e){let Ie=J[xe];
Ie&&W(Ie.question,Ie.choiceId)}else{let Ie=ne[xe];Ie&&v(Fn(Ie,xe))}return}if(B.key!=="Enter")return;if(_e){G&&(B.preventDefault(),
$());return}let Ee=d||z;Ee&&ne.some((xe,Ie)=>Fn(xe,Ie)===Ee)&&(B.preventDefault(),s(t,e.prompt_id,Ee))};return window.addEventListener(
"keydown",P),()=>window.removeEventListener("keydown",P)},[N,ne,Y,z,re,g,d,a,s,e?.prompt_id,G,u,b,S,t,J,_e,ee]),React.createElement(
"div",{className:"permission-overlay"},React.createElement("div",{className:`permission-card${Y?" permission-card-claude":
""}`,role:"dialog","aria-modal":"false","aria-label":Y?"Claude Code permission prompt":"Permission or question prompt",onPointerDown:()=>_(
!1)},Y?React.createElement(React.Fragment,null,React.createElement("div",{className:"permission-title permission-title-c\
laude"},he),ve&&React.createElement("pre",{className:"permission-command-claude"},ve),X&&React.createElement("div",{className:"\
permission-body permission-body-claude"},X)):React.createElement(React.Fragment,null,React.createElement("div",{className:"\
permission-eyebrow"},_e?"Question":"Permission Required"),React.createElement("div",{className:"permission-title"},_e?ae(
e?.title,"Answer the native question"):`Agent Paused In ${t?or(t,t):"Active Session"}`),!_e&&React.createElement("div",{
className:"permission-body"},Qp(e)),React.createElement("div",{className:"permission-meta"},H&&React.createElement("span",
{className:"permission-timer"},_b(e,V)),!H&&k>0&&React.createElement("span",{className:"permission-timer"},"Auto-choice \
in ",bm(V)),z&&React.createElement("span",{className:"permission-default"},"Default: ",z))),e?.error&&React.createElement(
"div",{className:"permission-error"},e.error),React.createElement("div",{className:`permission-actions${_e?" permission-\
question-list":""}`},_e?oe.map((P,B)=>React.createElement("fieldset",{className:"permission-question",key:P.question_id||
B},React.createElement("legend",null,ae(P.header||P.label,`Question ${B+1}`)),ae(P.message).trim()&&React.createElement(
"div",{className:"permission-question-message"},ae(P.message)),React.createElement("div",{className:"permission-question\
-options"},P.answer_mode==="text"||!Array.isArray(P.choices)||P.choices.length===0?React.createElement("input",{className:"\
permission-question-text-input",type:P.secret===!0?"password":"text",value:S[P.question_id]||"",maxLength:2e3,disabled:!!ee||
re,autoComplete:"off",spellCheck:P.secret===!0?"false":void 0,placeholder:P.secret===!0?"Enter private answer":"Enter an\
swer","aria-label":`${ae(P.header||P.label,`Question ${B+1}`)} answer`,onChange:te=>A(ce=>({...ce,[P.question_id]:te.target.
value}))}):P.choices.map((te,ce)=>{let ie=Fn(te,ce),be=(u[P.question_id]||[]).includes(ie),Ne=`${P.question_id}:${ie}`;return React.
createElement("div",{className:"permission-question-option",key:ie},React.createElement("button",{type:"button",className:`\
permission-action${be?" selected":""}`,role:P.multi_select?"checkbox":"radio","aria-checked":be,disabled:!!ee||re,"aria-\
keyshortcuts":J.findIndex(Se=>Se.question===P&&Se.choiceId===ie)>=0?String(J.findIndex(Se=>Se.question===P&&Se.choiceId===
ie)+1):void 0,onClick:()=>W(P,ie)},J.findIndex(Se=>Se.question===P&&Se.choiceId===ie)>=0&&React.createElement("kbd",{className:"\
permission-key-hint"},J.findIndex(Se=>Se.question===P&&Se.choiceId===ie)+1),React.createElement("span",{className:"permi\
ssion-choice-marker","aria-hidden":"true"},P.multi_select?be?"\u2713":"\u25A1":be?"\u25CF":"\u25CB"),React.createElement(
"span",{className:"permission-choice-copy"},React.createElement("span",null,Xr(te,ce)),ae(te?.description).trim()&&React.
createElement("span",{className:"permission-action-desc"},ae(te.description)))),be&&te.requires_text&&React.createElement(
"input",{className:"permission-other-input",type:P.secret===!0?"password":"text",value:b[Ne]||"",maxLength:2e3,disabled:!!ee||
re,autoComplete:"off",spellCheck:P.secret===!0?"false":void 0,placeholder:"Enter another answer","aria-label":`${Xr(te,ce)}\
 answer`,onChange:Se=>y(Ee=>({...Ee,[Ne]:Se.target.value}))}))})))):ne.map((P,B)=>{let te=Fn(P,B),ce=ee===te,ie=z&&z===te,
be=d===te,Ne=Y&&!d&&!z&&B===0,Se=Y?Xr(P,B).replace(new RegExp(`^${B+1}\\s+`),""):Xr(P,B),Ee=Y?ae(P?.destination).trim():
"",xe=Ee&&Se.endsWith(Ee)?Se.slice(0,-Ee.length):Se;return React.createElement("button",{key:te,className:`permission-ac\
tion${ie?" default":""}${be||Ne?" selected":""}${ce?" pending":""}`,disabled:!!ee,"aria-pressed":be||Ne,"aria-keyshortcu\
ts":B<9?String(B+1):void 0,onClick:()=>s(t,e.prompt_id,te)},B<9&&React.createElement("kbd",{className:"permission-key-hi\
nt"},ae(P?.shortcut,String(B+1))),React.createElement("span",null,xe,Ee&&React.createElement("span",{className:"permissi\
on-choice-destination-claude"},Ee)),ae(P?.description).trim()&&React.createElement("span",{className:"permission-action-\
desc"},ae(P.description)),ce&&React.createElement("span",{className:"permission-action-state"},"Sending..."))})),me&&React.
createElement("textarea",{className:"permission-alternate-input",rows:"1",maxLength:2e3,value:N,disabled:!!ee,placeholder:ae(
e?.alternate_instruction_placeholder,"Tell Claude what to do instead"),"aria-label":"Tell Claude what to do instead",onChange:P=>h(
P.target.value)}),_e&&React.createElement("div",{className:"permission-question-footer"},React.createElement("button",{type:"\
button",className:"permission-question-submit",disabled:!G||!!ee||re,onClick:$},ee?"Sending...":ae(e.submit_label,"Submi\
t answers")),e?.type==="question_prompt"&&e?.cancel_supported===!0&&React.createElement("button",{type:"button",className:"\
permission-question-cancel",disabled:!!ee||re,onClick:()=>s(t,e.prompt_id,null,{action:"cancel"})},"Cancel")),React.createElement(
"div",{className:"permission-keyboard-help"},Y?ae(e?.cancel_hint,"Esc to cancel"):`1\u20139 select \xB7 Enter submit \xB7 Esc ${e?.
cancel_supported===!0?"cancel":"return to composer"}`)))}function xi(e){return ae(e?.label,"Action")}function rr(e){return!!e&&
e.blocking!==!1&&e.display_mode!=="inline"}function vb({prompt:e,sessionId:t,onRespond:n}){let s=Ml(e,["error","notice"]),
a=Array.isArray(e?.actions)?e.actions:s?.actions||[],i=e?.submitting_action_id||null,c=ae(e?.error_output||s?.error_output).
trim();return React.createElement("div",{className:"permission-overlay"},React.createElement("div",{className:"permissio\
n-card error-prompt-card"},React.createElement("div",{className:"permission-eyebrow error-prompt-eyebrow"},"Action Requi\
red"),React.createElement("div",{className:"permission-title"},ae(s?.label||e?.title,"Error handling model response")),React.
createElement("div",{className:"permission-body"},ae(s?.content||e?.message,"There was an error handling the model respo\
nse.")),c&&React.createElement("div",{className:"error-prompt-output-wrap"},React.createElement("div",{className:"error-\
prompt-output-label"},"Error Output"),React.createElement("pre",{className:"error-prompt-output"},c)),e?.error&&React.createElement(
"div",{className:"permission-error"},e.error),React.createElement("div",{className:"permission-actions"},a.map(u=>{let p=ae(
u?.action_id),b=i===p;return React.createElement("button",{key:p||xi(u),className:`permission-action error-prompt-action${b?
" pending":""}`,disabled:!!i,onClick:y=>n(t,e.prompt_id,p,y)},React.createElement("span",null,xi(u)),b&&React.createElement(
"span",{className:"permission-action-state"},"Sending..."))}))))}function yb({prompt:e,sessionId:t,onRespond:n}){let s=Ml(
e,["error","notice"]),a=Array.isArray(e?.actions)?e.actions:s?.actions||[],i=e?.submitting_action_id||null,c=ae(e?.error_output||
s?.error_output).trim();return React.createElement("div",{className:"inline-error-prompt"},React.createElement("div",{className:"\
inline-error-prompt-body"},React.createElement("div",{className:"inline-error-prompt-title"},ae(s?.label||e?.title,"Code\
x requires attention")),React.createElement("div",{className:"inline-error-prompt-message"},ae(s?.content||e?.message,"T\
here was an error handling the model response.")),c&&React.createElement("pre",{className:"inline-error-prompt-output"},
c),e?.error&&React.createElement("div",{className:"permission-error"},e.error)),React.createElement("div",{className:"in\
line-error-prompt-actions"},a.map(u=>{let p=ae(u?.action_id),b=i===p;return React.createElement("button",{key:p||xi(u),className:`\
permission-action error-prompt-action${b?" pending":""}`,disabled:!!i,onClick:y=>n(t,e.prompt_id,p,y)},React.createElement(
"span",null,xi(u)),b&&React.createElement("span",{className:"permission-action-state"},"Sending..."))})))}function kb({launchStates:e,
onLaunch:t,onResume:n,onClose:s,workspaces:a,showTestSessions:i=!1}){let[c,u]=React.useState("new"),[p,b]=React.useState(
"claude"),[y,S]=React.useState(""),[A,N]=React.useState(""),[h,d]=React.useState("deepseek-v4-pro:cloud"),[v,g]=React.useState(
"gpt-5.5"),[_,k]=React.useState("grok-4.5-fast-high"),[T,L]=React.useState(null),[H,V]=React.useState([]),[ne,ee]=React.
useState(!1),re=T?e[T]:null,z=re?.status==="launching",oe=re?.status==="failed"?re.error:null,_e=(a||[]).length>0;React.
useEffect(()=>{T&&!e[T]&&s()},[e,T]),React.useEffect(()=>{c==="resume"&&!ne&&(ee(!0),fetch(`/api/sessions/history?limit=\
30&include_test=${i?"true":"false"}`,{credentials:"same-origin"}).then(X=>X.json()).then(X=>V(X.sessions||[])).catch(()=>V(
[])).finally(()=>ee(!1)))},[c,i]);function Y(X){if(X.preventDefault(),z)return;let me=y==="custom"?A.trim():y,J=p==="cla\
ude_cli"?{model_id:h.trim()||"default"}:p==="codex_cli"?{model_id:v.trim()||"gpt-5.5",permission_mode:"workspace-write",
effort:"medium"}:p==="cursor_cli"?{model_id:_.trim()||"grok-4.5-fast-high",permission_mode:"force"}:{},W=t(p,me||void 0,
J);L(W)}function ve(X){if(z)return;let me=X.agent_type||p,J=X.workspace_path||(y==="custom"?A.trim():y)||void 0,W=n(X.session_id,
me,J,{cli_session_id:X.cli_session_id||void 0,model_id:X.model_id||void 0,permission_mode:X.permission_mode||void 0});L(
W)}function he(X){if(!X)return"";let me=Date.now()-new Date(X).getTime(),J=Math.floor(me/6e4);if(J<60)return`${J}m ago`;
let W=Math.floor(J/60);return W<24?`${W}h ago`:`${Math.floor(W/24)}d ago`}return React.createElement("div",{className:"n\
ew-session-panel"},React.createElement("div",{className:"new-session-header"},React.createElement("span",null,c==="new"?
"New Session":"Resume Session"),React.createElement("button",{className:"new-session-close",onClick:s,title:"Cancel"},"\u2715")),
React.createElement("div",{className:"new-session-tabs"},React.createElement("button",{className:`new-session-tab${c==="\
new"?" active":""}`,onClick:()=>u("new")},"New"),React.createElement("button",{className:`new-session-tab${c==="resume"?
" active":""}`,onClick:()=>u("resume")},"Resume")),c==="new"?React.createElement("form",{className:"new-session-form",onSubmit:Y},
React.createElement("div",{className:"new-session-agents"},Object.entries(Nn).map(([X,me])=>React.createElement("button",
{key:X,type:"button",className:`new-session-agent-btn${p===X?" selected":""}`,style:p===X?{borderColor:me.color,color:me.
color,background:me.color+"18"}:{},onClick:()=>b(X)},React.createElement("span",{className:"agent-badge new-session-badg\
e",style:{color:me.color,borderColor:me.color+"55",background:me.color+"18"}},me.abbr),React.createElement("span",{className:"\
new-session-agent-name"},me.name)))),_e?React.createElement(React.Fragment,null,React.createElement("select",{className:"\
new-session-workspace",value:y,onChange:X=>S(X.target.value),disabled:z},React.createElement("option",{value:""},"No wor\
kspace (default)"),a.map((X,me)=>React.createElement("option",{key:me,value:X.path||X.title},X.title)),React.createElement(
"option",{value:"custom"},"Custom path\u2026")),y==="custom"&&React.createElement("input",{className:"new-session-worksp\
ace",type:"text",placeholder:"Enter workspace path",value:A,onChange:X=>N(X.target.value),disabled:z,autoFocus:!0})):React.
createElement("input",{className:"new-session-workspace",type:"text",placeholder:"Workspace path (optional)",value:A,onChange:X=>N(
X.target.value),disabled:z}),p==="claude_cli"&&React.createElement("input",{className:"new-session-workspace",type:"text",
placeholder:"Claude CLI model, e.g. deepseek-v4-pro:cloud",value:h,onChange:X=>d(X.target.value),disabled:z}),p==="codex\
_cli"&&React.createElement("select",{className:"new-session-workspace",value:v,onChange:X=>g(X.target.value),disabled:z},
Tl.map(X=>React.createElement("option",{key:X.id,value:X.id},X.label))),p==="cursor_cli"&&React.createElement("select",{
className:"new-session-workspace",value:_,onChange:X=>k(X.target.value),disabled:z},$l.map(X=>React.createElement("optio\
n",{key:X.id,value:X.id},X.label))),oe&&React.createElement("div",{className:"new-session-error"},oe),React.createElement(
"button",{className:"new-session-submit",type:"submit",disabled:z},z?React.createElement("span",{className:"new-session-\
spinner"}):null,z?"Launching\u2026":"Launch")):React.createElement("div",{className:"new-session-form"},React.createElement(
"div",{className:"new-session-agents"},Object.entries(Nn).map(([X,me])=>React.createElement("button",{key:X,type:"button",
className:`new-session-agent-btn${p===X?" selected":""}`,style:p===X?{borderColor:me.color,color:me.color,background:me.
color+"18"}:{},onClick:()=>b(X)},React.createElement("span",{className:"agent-badge new-session-badge",style:{color:me.color,
borderColor:me.color+"55",background:me.color+"18"}},me.abbr),React.createElement("span",{className:"new-session-agent-n\
ame"},me.name)))),oe&&React.createElement("div",{className:"new-session-error"},oe),ne?React.createElement("div",{className:"\
session-history-loading"},React.createElement("span",{className:"new-session-spinner"})," Loading history\u2026"):H.length===
0?React.createElement("div",{className:"session-history-empty"},"No past sessions found"):React.createElement("div",{className:"\
session-history-list"},H.filter(X=>!p||!X.agent_type||X.agent_type===p).map(X=>React.createElement("button",{key:X.session_id,
className:"session-history-item",onClick:()=>ve(X),disabled:z},React.createElement("div",{className:"session-history-pre\
view"},X.preview||"(empty session)"),React.createElement("div",{className:"session-history-meta"},React.createElement("s\
pan",null,X.message_count," msg",X.message_count!==1?"s":""),X.agent_type&&React.createElement("span",{className:"sessio\
n-history-workspace"},Nn[X.agent_type]?.name||X.agent_type),X.workspace_name&&React.createElement("span",{className:"ses\
sion-history-workspace",title:X.workspace_path||""},X.workspace_name),React.createElement("span",null,he(X.last_active_at))))))))}
var wb={claude:[{value:"default",label:"Ask before edit"},{value:"acceptEdits",label:"Edit automatically"},{value:"plan",
label:"Plan mode"},{value:"auto",label:"Auto mode"},{value:"bypassPermissions",label:"Bypass permissions"}],claude_cli:[
{value:"default",label:"Default"},{value:"acceptEdits",label:"Accept edits"},{value:"auto",label:"Auto"},{value:"bypassP\
ermissions",label:"Bypass permissions"},{value:"dontAsk",label:"Do not ask"},{value:"plan",label:"Plan"}],continue_yolo:[
{value:"ask",label:"Ask for permissions"},{value:"bypass",label:"Bypass permissions"}],roo_code:[{value:"BRRR",label:"BR\
RR"},{value:"YOLO",label:"YOLO"},{value:"Ask",label:"Ask"},{value:"Auto-approve",label:"Auto-approve"}],cline:[{value:"Y\
OLO",label:"YOLO"}],codex_cli:[{value:"read-only",label:"Read only"},{value:"workspace-write",label:"Workspace write"},{
value:"danger-full-access",label:"Full access"}],cursor_cli:[{value:"default",label:"Default"},{value:"force",label:"For\
ce (Yolo)"},{value:"plan",label:"Plan"},{value:"ask",label:"Ask"}],codex:[],gemini:[]};function vm(e){return e==="codex_\
cli"?"workspace-write":e==="cursor_cli"?"force":e==="continue_yolo"||e==="roo_code"||e==="cline"?"ask":"default"}var kl=[
{id:"default",label:"Auto"},{id:"claude-opus-4-6",label:"Claude Opus 4.6"},{id:"claude-sonnet-4-6",label:"Claude Sonnet \
4.6"},{id:"claude-opus-4-5",label:"Claude Opus 4.5"},{id:"claude-sonnet-4-5",label:"Claude Sonnet 4.5"},{id:"claude-haik\
u-4-5",label:"Claude Haiku 4.5"},{id:"claude-opus-4-0",label:"Claude Opus 4"},{id:"claude-sonnet-4-0",label:"Claude Sonn\
et 4"},{id:"claude-3-7-sonnet",label:"Claude 3.7 Sonnet"},{id:"claude-3-5-sonnet",label:"Claude 3.5 Sonnet"},{id:"claude\
-3-5-haiku",label:"Claude 3.5 Haiku"},{id:"deepseek-v4-pro:cloud",label:"DeepSeek V4 Pro (Ollama Cloud)"}],Tl=[{id:"gpt-\
5.6",label:"GPT-5.6"},{id:"gpt-5.6-sol",label:"GPT-5.6 Sol"},{id:"gpt-5.6-terra",label:"GPT-5.6 Terra"},{id:"gpt-5.6-lun\
a",label:"GPT-5.6 Luna"},{id:"gpt-5.5",label:"GPT-5.5"},{id:"gpt-5.4",label:"GPT-5.4"},{id:"gpt-5.4-mini",label:"GPT-5.4\
 Mini"},{id:"gpt-5.3-codex-spark",label:"GPT-5.3 Codex Spark"},{id:"gpt-5.3-codex",label:"GPT-5.3 Codex"},{id:"gpt-5.2-c\
odex",label:"GPT-5.2 Codex"},{id:"gpt-5.2",label:"GPT-5.2"},{id:"gpt-5.1-codex",label:"GPT-5.1 Codex"},{id:"gpt-5.1",label:"\
GPT-5.1"},{id:"gpt-5",label:"GPT-5"},{id:"ollama:deepseek-v4-pro:cloud",label:"DeepSeek V4 Pro (Ollama Cloud)"},{id:"oll\
ama:kimi-k2.6:cloud",label:"Kimi K2.6 (Ollama Cloud)"}],$l=[{id:"grok-4.5-fast-high",label:"Grok 4.5 Fast (High)"},{id:"\
grok-4.5-fast-xhigh",label:"Grok 4.5 Fast (XHigh)"},{id:"claude-fable-5-thinking-high",label:"Claude Fable 5 (Thinking H\
igh)"},{id:"claude-opus-4-8-thinking-high",label:"Claude Opus 4.8 (Thinking High)"},{id:"composer-2.5",label:"Composer 2\
.5"},{id:"composer-2.5-fast",label:"Composer 2.5 Fast"},{id:"gpt-5.5-high",label:"GPT-5.5 (High)"},{id:"gpt-5.3-codex",label:"\
GPT-5.3 Codex"}],El=[{id:"Planning",label:"Planning"},{id:"Fast",label:"Fast"}],Nb=[{id:"Architect",label:"Architect"},{
id:"Code",label:"Code"},{id:"Ask",label:"Ask"},{id:"Debug",label:"Debug"},{id:"Orchestrator",label:"Orchestrator"}],Sb=[
{id:"Plan",label:"Plan"},{id:"Act",label:"Act"}],ym=[{id:"Gemini 3.1 Pro (High)",label:"Gemini 3.1 Pro (High)"},{id:"Gem\
ini 3.1 Pro (Low)",label:"Gemini 3.1 Pro (Low)"},{id:"Gemini 3 Flash",label:"Gemini 3 Flash"},{id:"Claude Sonnet 4.6 (Th\
inking)",label:"Claude Sonnet 4.6 (Thinking)"},{id:"Claude Opus 4.6 (Thinking)",label:"Claude Opus 4.6 (Thinking)"},{id:"\
GPT-OSS 120B (Medium)",label:"GPT-OSS 120B (Medium)"}],km=[{id:"Default",label:"Default"},{id:"2.5 Flash",label:"Gemini \
2.5 Flash"},{id:"2.5 Pro",label:"Gemini 2.5 Pro"},{id:"3 Flash Preview",label:"Gemini 3 Flash Preview"},{id:"3.1 Pro Pre\
view",label:"Gemini 3.1 Pro Preview"}];function Jp(e,t){return Array.isArray(t?.available_models)&&t.available_models.length>
0?t.available_models.map(n=>typeof n=="string"?{id:n,label:n}:n):e==="continue_yolo"||e==="continue"||e==="roo_code"||e===
"cline"?[]:e==="claude_cli"?kl:e==="codex_cli"?Tl:e==="cursor_cli"?$l:e==="antigravity"||e==="antigravity_panel"?ym:e===
"gemini"?km:kl}function Qr(e,t){return Array.isArray(t?.available_modes)&&t.available_modes.length>0?t.available_modes.map(
n=>typeof n=="string"?{id:n,label:n}:n):e==="roo_code"?Nb:e==="cline"?Sb:e==="antigravity"||e==="antigravity_panel"?El:[]}
function wl(e,t){return Array.isArray(t?.available_permission_modes)&&t.available_permission_modes.length>0?t.available_permission_modes.
map(n=>typeof n=="string"?{value:n,label:n}:{value:n.id||n.value,label:n.label||n.id||n.value}).filter(n=>n.value):wb[e]||
[]}function Cb(e){let t="=".repeat((4-e.length%4)%4),n=(e+t).replace(/-/g,"+").replace(/_/g,"/"),s=atob(n);return Uint8Array.
from([...s].map(a=>a.charCodeAt(0)))}var Ll=Object.freeze({permission_required:!0,agent_ready:!0,turn_ready:!1,goal_completed:!1,
goal_attention:!0,provider_usage_warning:!0,agent_error:!0,session_offline:!0,rate_limit_cleared:!0,completion_sound:!1,
completion_haptic:!1}),xb=Object.freeze(Object.fromEntries(Object.keys(Ll).map(e=>[e,!1]))),yi=null,Zp=0;function Pl(){if(typeof window>
"u")return null;let e=window.AudioContext||window.webkitAudioContext;return e?(yi||(yi=new e),yi.state==="suspended"&&yi.
resume().catch(()=>{}),yi):null}function em(e="completion"){let t=Date.now();if(t-Zp<600)return!1;let n=Pl();if(!n||n.state!==
"running")return!1;Zp=t;let s=n.createOscillator(),a=n.createGain(),i=n.currentTime;return s.type="sine",s.frequency.setValueAtTime(
e==="prompt"?740:620,i),s.frequency.exponentialRampToValueAtTime(e==="prompt"?880:760,i+.11),a.gain.setValueAtTime(1e-4,
i),a.gain.exponentialRampToValueAtTime(.035,i+.012),a.gain.exponentialRampToValueAtTime(1e-4,i+.14),s.connect(a),a.connect(
n.destination),s.start(i),s.stop(i+.15),!0}function tm(e,t){return e!==t?!0:typeof document>"u"?!1:document.visibilityState!==
"visible"||!document.hasFocus()}function Ab({onClose:e,onPreferencesChange:t}){let n=Ll,[s,a]=ue(n),[i,c]=ue(!0),[u,p]=ue(
null),[b,y]=ue(""),[S,A]=ue("checking"),[N,h]=ue(!1);async function d(){c(!0),y("");try{let T=await fetch("/api/preferen\
ces/notifications",{credentials:"same-origin"}),L=await T.json().catch(()=>({}));if(!T.ok)throw new Error(L.error||"Unab\
le to load notification settings.");let H={...n,...L.preferences||{},turn_ready:!1};a(H),t?.(H)}catch(T){y(T.message||"U\
nable to load notification settings.")}finally{c(!1)}}async function v(){if(!("serviceWorker"in navigator)||!("PushManag\
er"in window)||!("Notification"in window)){A("unsupported");return}try{let L=await(await navigator.serviceWorker.ready).
pushManager.getSubscription();A(L?"enabled":Notification.permission==="denied"?"denied":"available")}catch{A("error")}}Te(
()=>{d(),v()},[]);async function g(){if(!N){h(!0),y("");try{let T=await Notification.requestPermission();if(T!=="granted"){
A(T==="denied"?"denied":"available");return}let L=await fetch("/api/push/web-config",{credentials:"same-origin"}),H=await L.
json().catch(()=>({}));if(!L.ok||!H.public_key)throw new Error(H.error||"Web Push is unavailable.");let V=await navigator.
serviceWorker.ready,ne=await V.pushManager.getSubscription();ne||(ne=await V.pushManager.subscribe({userVisibleOnly:!0,applicationServerKey:Cb(
H.public_key)}));let ee=await fetch("/api/push/web-subscription",{method:"POST",credentials:"same-origin",headers:{"Cont\
ent-Type":"application/json"},body:JSON.stringify({subscription:ne.toJSON()})}),re=await ee.json().catch(()=>({}));if(!ee.
ok)throw new Error(re.error||"Unable to register browser notifications.");A("enabled")}catch(T){A("error"),y(T.message||
"Unable to enable browser notifications.")}finally{h(!1)}}}async function _(){if(!N){h(!0),y("");try{let L=await(await navigator.
serviceWorker.ready).pushManager.getSubscription();L&&(await fetch("/api/push/web-subscription",{method:"DELETE",credentials:"\
same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({endpoint:L.endpoint})}),await L.unsubscribe()),
A("available")}catch(T){A("error"),y(T.message||"Unable to disable browser notifications.")}finally{h(!1)}}}async function k(T){
if(u||T==="turn_ready")return;let L=s,H={...s,[T]:!s[T]};T==="completion_sound"&&H.completion_sound&&Pl(),a(H),p(T),y("");
try{let V=await fetch("/api/preferences/notifications",{method:"PUT",credentials:"same-origin",headers:{"Content-Type":"\
application/json"},body:JSON.stringify({preferences:H})}),ne=await V.json().catch(()=>({}));if(!V.ok)throw new Error(ne.
error||"Unable to save notification settings.");let ee={...n,...ne.preferences||{}};a(ee),t?.(ee)}catch(V){a(L),y(V.message||
"Unable to save notification settings.")}finally{p(null)}}return React.createElement("div",{className:"settings-panel no\
tification-settings-panel"},React.createElement("div",{className:"settings-panel-header"},React.createElement("span",null,
"Notifications"),React.createElement("button",{className:"settings-panel-close",onClick:e,title:"Close"},"\u2715")),React.
createElement("div",{className:"settings-panel-body"},React.createElement("div",{className:"notification-setting-row web\
-push-setting-row"},React.createElement("span",null,React.createElement("strong",null,"Browser notifications"),React.createElement(
"small",null,S==="enabled"?"Enabled for this browser":S==="denied"?"Blocked in browser site settings":S==="unsupported"?
"Not supported by this browser":S==="checking"?"Checking browser support\u2026":"Receive notifications when this PWA is \
closed")),S==="enabled"?React.createElement("button",{type:"button",disabled:N,onClick:_},"Disable"):React.createElement(
"button",{type:"button",disabled:N||S==="checking"||S==="unsupported"||S==="denied",onClick:g},N?"Enabling\u2026":"Enabl\
e")),React.createElement("label",{className:"notification-setting-row"},React.createElement("span",null,React.createElement(
"strong",null,"Permission required"),React.createElement("small",null,"When an agent needs approval to continue")),React.
createElement("input",{type:"checkbox",checked:s.permission_required,disabled:i||!!u,onChange:()=>k("permission_required")})),
React.createElement("label",{className:"notification-setting-row"},React.createElement("span",null,React.createElement("\
strong",null,"Turn finished"),React.createElement("small",null,"Unavailable until this harness supplies an authoritative\
 native turn boundary")),React.createElement("input",{type:"checkbox",checked:!1,disabled:!0,onChange:()=>k("turn_ready")})),
React.createElement("label",{className:"notification-setting-row"},React.createElement("span",null,React.createElement("\
strong",null,"Goal completed"),React.createElement("small",null,"Only when the native goal reaches its terminal complete\
d state")),React.createElement("input",{type:"checkbox",checked:s.goal_completed,disabled:i||!!u,onChange:()=>k("goal_co\
mpleted")})),React.createElement("label",{className:"notification-setting-row"},React.createElement("span",null,React.createElement(
"strong",null,"Goal needs attention"),React.createElement("small",null,"Paused, blocked, limited, cancelled, or failed g\
oals")),React.createElement("input",{type:"checkbox",checked:s.goal_attention,disabled:i||!!u,onChange:()=>k("goal_atten\
tion")})),React.createElement("label",{className:"notification-setting-row"},React.createElement("span",null,React.createElement(
"strong",null,"Provider usage warning"),React.createElement("small",null,"At 75%, 90%, and exhaustion for each provider \
account window")),React.createElement("input",{type:"checkbox",checked:s.provider_usage_warning,disabled:i||!!u,onChange:()=>k(
"provider_usage_warning")})),React.createElement("div",{className:"settings-note"},"Active /goal loop checkpoints stay q\
uiet between turns."),React.createElement("label",{className:"notification-setting-row"},React.createElement("span",null,
React.createElement("strong",null,"Agent error or rate limit"),React.createElement("small",null,"When an agent stops and\
 needs attention")),React.createElement("input",{type:"checkbox",checked:s.agent_error,disabled:i||!!u,onChange:()=>k("a\
gent_error")})),React.createElement("label",{className:"notification-setting-row"},React.createElement("span",null,React.
createElement("strong",null,"Session offline"),React.createElement("small",null,"When an agent disconnects from the rela\
y")),React.createElement("input",{type:"checkbox",checked:s.session_offline,disabled:i||!!u,onChange:()=>k("session_offl\
ine")})),React.createElement("label",{className:"notification-setting-row"},React.createElement("span",null,React.createElement(
"strong",null,"Rate limit cleared"),React.createElement("small",null,"When a model's rate limit expires")),React.createElement(
"input",{type:"checkbox",checked:s.rate_limit_cleared,disabled:i||!!u,onChange:()=>k("rate_limit_cleared")})),React.createElement(
"label",{className:"notification-setting-row"},React.createElement("span",null,React.createElement("strong",null,"Notifi\
cation sound"),React.createElement("small",null,"Subtle cue for allowed prompts and explicit goal lifecycle events")),React.
createElement("input",{type:"checkbox",checked:s.completion_sound,disabled:i||!!u,onChange:()=>k("completion_sound")})),
i&&React.createElement("div",{className:"settings-note"},"Loading relay preferences\u2026"),!!b&&React.createElement("di\
v",{className:"notification-settings-error",role:"alert"},React.createElement("span",null,b),React.createElement("button",
{type:"button",onClick:d},"Retry")),React.createElement("div",{className:"settings-note"},"These preferences sync across\
 web and Android.")))}function Rb({sessions:e,preferences:t,initialSessionId:n,onSave:s,onExport:a,onClose:i}){let c=n||
$e(e[0])||"",[u,p]=ue(c),[b,y]=ue(""),[S,A]=ue(!1),[N,h]=ue(""),[d,v]=ue(""),g=e.find(L=>$e(L)===u)||null,_=t[u]||{display_name:"",
archived:!1,muted:!1,pinned:!1,pin_order:0};Te(()=>{y(_.display_name||""),v("")},[u,_.display_name]),Te(()=>{n&&p(n)},[n]);
async function k(L){if(!(!u||S)){A(!0),v("");try{await s(u,L)}catch(H){v(H.message||"Unable to save session settings.")}finally{
A(!1)}}}async function T(L){if(!(!u||N)){h(L),v("");try{await a(u,L)}catch(H){v(H.message||"Unable to export session.")}finally{
h("")}}}return React.createElement("div",{className:"settings-panel session-management-panel"},React.createElement("div",
{className:"settings-panel-header"},React.createElement("span",null,"Manage sessions"),React.createElement("button",{className:"\
settings-panel-close",onClick:i,title:"Close"},"\u2715")),React.createElement("div",{className:"settings-panel-body"},e.
length===0?React.createElement("div",{className:"settings-note"},"No sessions available."):React.createElement(React.Fragment,
null,React.createElement("label",{className:"settings-row session-management-field"},React.createElement("span",{className:"\
settings-label"},"Session"),React.createElement("select",{value:u,onChange:L=>p(L.target.value)},e.map(L=>{let H=$e(L),V=t[H]||
{},ne=V.display_name||L?.display_name||L?.workspace_name||L?.name||H;return React.createElement("option",{key:H,value:H},
V.archived?"[Hidden] ":"",ne)}))),g&&React.createElement(React.Fragment,null,React.createElement("label",{className:"set\
tings-row session-management-field"},React.createElement("span",{className:"settings-label"},"Custom name"),React.createElement(
"input",{value:b,maxLength:100,placeholder:g?.display_name||g?.workspace_name||g?.name||u,onChange:L=>y(L.target.value)})),
React.createElement("label",{className:"notification-setting-row"},React.createElement("span",null,React.createElement("\
strong",null,"Pin chat"),React.createElement("small",null,"Keep this chat in the operator-ordered pinned section")),React.
createElement("input",{type:"checkbox",checked:!!_.pinned,disabled:S,onChange:()=>k({pinned:!_.pinned})})),React.createElement(
"label",{className:"notification-setting-row"},React.createElement("span",null,React.createElement("strong",null,"Mute n\
otifications"),React.createElement("small",null,"Suppress push notifications for this session")),React.createElement("in\
put",{type:"checkbox",checked:!!_.muted,disabled:S,onChange:()=>k({muted:!_.muted})})),React.createElement("div",{className:"\
session-management-actions"},React.createElement("button",{disabled:S,onClick:()=>k({display_name:b})},"Save name"),React.
createElement("button",{className:_.archived?"":"danger",disabled:S,onClick:()=>k({archived:!_.archived})},_.archived?"R\
estore to sidebar":"Hide from sidebar")),React.createElement("div",{className:"session-management-actions session-export\
-actions","aria-label":"Export session"},React.createElement("button",{disabled:!!N,onClick:()=>T("markdown")},N==="mark\
down"?"Preparing\u2026":"Download Markdown"),React.createElement("button",{disabled:!!N,onClick:()=>T("json")},N==="json"?
"Preparing\u2026":"Download JSON")))),!!d&&React.createElement("div",{className:"settings-error",role:"alert"},d),React.
createElement("div",{className:"settings-note"},"Names, pinned order, hidden state, and mute settings sync across web an\
d Android.")))}function Mb({sessionId:e,initialContent:t,jobs:n,onSchedule:s,onCancel:a,onCreated:i,onClose:c}){let[u,p]=ue(
t||""),[b,y]=ue("idle"),[S,A]=ue(()=>{let k=new Date(Date.now()+36e5);return new Date(k.getTime()-k.getTimezoneOffset()*
6e4).toISOString().slice(0,16)}),[N,h]=ue(""),[d,v]=ue(!1);async function g(k){k.preventDefault(),v(!0),h("");try{await s(
e,u,b,b==="at"?new Date(S).toISOString():null),i?.(),p("")}catch(T){h(T.message)}finally{v(!1)}}async function _(k){try{
await a(k)}catch(T){h(T.message)}}return React.createElement("div",{className:"settings-panel scheduled-send-panel","dat\
a-testid":"scheduled-send-panel"},React.createElement("div",{className:"settings-panel-header"},React.createElement("spa\
n",null,"Schedule message"),React.createElement("button",{className:"settings-panel-close",onClick:c,title:"Close"},"\xD7")),
React.createElement("form",{className:"settings-panel-body",onSubmit:g},React.createElement("label",{className:"settings\
-row session-management-field"},React.createElement("span",{className:"settings-label"},"Message"),React.createElement("\
textarea",{value:u,maxLength:524288,onChange:k=>p(k.target.value)})),React.createElement("label",{className:"settings-ro\
w session-management-field"},React.createElement("span",{className:"settings-label"},"Deliver"),React.createElement("sel\
ect",{value:b,onChange:k=>y(k.target.value)},React.createElement("option",{value:"idle"},"When session is next idle"),React.
createElement("option",{value:"at"},"At a specific time"))),b==="at"&&React.createElement("label",{className:"settings-r\
ow session-management-field"},React.createElement("span",{className:"settings-label"},"Local time"),React.createElement(
"input",{type:"datetime-local",value:S,onChange:k=>A(k.target.value)})),React.createElement("div",{className:"session-ma\
nagement-actions"},React.createElement("button",{type:"submit",disabled:d||!u.trim()},d?"Scheduling\u2026":"Schedule")),
!!N&&React.createElement("div",{className:"settings-error",role:"alert"},N),!!n.length&&React.createElement("div",{className:"\
scheduled-send-list"},React.createElement("strong",null,"Pending"),n.map(k=>React.createElement("div",{className:"schedu\
led-send-row",key:k.id},React.createElement("span",null,k.trigger_kind==="idle"?"Next idle":new Date(k.deliver_at).toLocaleString(),
" \xB7 ",k.content),React.createElement("button",{type:"button",onClick:()=>_(k.id),disabled:k.state!=="pending"},k.state===
"dispatching"?"Sending\u2026":"Cancel"))))))}function Tb({session:e,config:t,configControlStates:n,onRequestRefresh:s,onSetModel:a,
onSetEffort:i,onSetPermissionMode:c,onSetAutoApprovePermissions:u,onSetMode:p,onSetCodexConfig:b,onSwitchWorkspace:y,onClose:S}){
let[A,N]=React.useState(!1),[h,d]=React.useState(null),v=$e(e),g=q=>n?.[`${v}:${q}`]||null,_=q=>q&&(q.status==="pending"||
q.status==="awaiting_config"),k=g("model"),T=g("permission_mode"),L=g("effort"),H=g("auto_approve_permissions"),V=g("mod\
e"),ne=g("speed"),ee=g("access_mode"),re=g("permission_profile"),z=g("workspace"),oe=[k,T,L,H,V,ne,ee,re,z].find(q=>_(q)||
q?.status==="failed"),_e=oe?_(oe)?`Saving ${oe.field.replace(/_/g," ")}\u2026`:oe.error:null,Y=e&&typeof e=="object"?e.agent_type:
null,ve=t?.capabilities||{},he=Y==="codex_cli"&&t?.config_semantics==="observed_and_next_send",X=Y==="codex",me=!X||t?.controls_available!==
!1,J=t?.model_id||"unknown",W=t?.next_send_model_id||"",G=e&&typeof e=="object"&&e.rate_limited_until||null,$=Array.isArray(
e?.antigravity_quota_models)?e.antigravity_quota_models:[],P=e?.active_quota_model||null,B=t?.permission_mode||"unknown",
te=t?.conversation_mode||"unknown",ce=t?.mode&&t.mode!=="unknown"?t.mode:te,ie=typeof t?.auto_approve_permissions=="bool\
ean"?t.auto_approve_permissions:!!e?.auto_approve_permissions,be=t?.effort||null,Ne=t?.next_send_effort||"",Se=t?.file_access_scope||
"unknown",Ee=wl(Y,t),xe=Qr(Y,t),Ie=Y==="claude"||Y==="claude_cli"?kl:Y==="codex_cli"?Tl:Y==="cursor_cli"?$l:Y==="antigra\
vity"||Y==="antigravity_panel"?ym:Y==="gemini"?km:[];t?.available_models&&Array.isArray(t.available_models)&&t.available_models.
length>0&&(Ie=t.available_models.map(q=>typeof q=="string"?{id:q,label:q}:q)),React.useEffect(()=>{v&&s(v)},[v]);function Ke(q){
!q||q===(he?W:J)||a(v,q)}function de(q){!q||q===B||c(v,q)}function Ze(q){!q||q===(he?Ne:be)||i&&i(v,q)}function D(q){!q||
q===ce||p&&p(v,q)}function se(q){ie!==!!q&&u&&u(v,!!q)}function ke(q,et=!1){if(!(!q||q===t?.permission_profile)){if(q===
"full-access"&&!et){N(!0);return}q==="full-access"&&d(t?.permission_profile&&t.permission_profile!=="full-access"?t.permission_profile:
"auto"),N(!1),b?.({permission_profile:q,...et?{confirm_bypass:!0}:{}})}}return React.createElement("div",{className:"set\
tings-panel"},React.createElement("div",{className:"settings-panel-header"},React.createElement("span",null,"Session Set\
tings"),React.createElement("button",{className:"settings-panel-close",onClick:S,title:"Close"},"\u2715")),React.createElement(
"div",{className:"settings-panel-body"},G&&React.createElement("div",{className:"settings-rl-banner"},React.createElement(
"span",{className:"settings-rl-icon"},"\u26A0"),React.createElement("span",{className:"settings-rl-text"},"Rate limited",
G!=="unknown"?React.createElement(React.Fragment,null," \u2014 available after ",React.createElement("strong",null,G)):React.
createElement(React.Fragment,null," \u2014 reset time unknown"))),React.createElement("div",{className:"settings-row"},React.
createElement("span",{className:"settings-label"},he?"Observed model":"Model"),React.createElement("div",{className:"set\
tings-model-wrap"},he?React.createElement("span",{className:`settings-value${J==="unknown"?" dim":""}`,title:t?.model_provenance?.
source||"No exact native metadata observed"},J):ve.set_model&&Ie.length>0?React.createElement("select",{className:"setti\
ngs-perm-select",value:J,disabled:_(k),onChange:q=>Ke(q.target.value)},Ie.map(q=>React.createElement("option",{key:q.id,
value:q.id},q.label)),Y!=="antigravity"&&Y!=="gemini"&&!Ie.some(q=>q.id===J)&&J!=="unknown"&&React.createElement("option",
{value:J},J)):React.createElement("span",{className:`settings-value${J==="unknown"?" dim":""}`},J),G&&React.createElement(
"span",{className:"model-rl-badge",title:`Rate limited${G!=="unknown"?` \u2014 resets at ${G}`:""}`},"\u26A0")),k?.status===
"ok"&&React.createElement("span",{className:"settings-inline-ok"},"Saved")),he&&ve.set_model&&Ie.length>0&&React.createElement(
"div",{className:"settings-row"},React.createElement("span",{className:"settings-label"},"Next send model"),React.createElement(
"select",{className:"settings-perm-select",value:W,disabled:_(k),onChange:q=>Ke(q.target.value)},React.createElement("op\
tion",{value:"",disabled:!0},"Choose model\u2026"),Ie.map(q=>React.createElement("option",{key:q.id,value:q.id},q.label))),
React.createElement("span",{className:`settings-value small${t?.next_send_model_status==="failed"?" error":""}`},t?.next_send_model_status||
"unset")),(Y==="antigravity"||Y==="antigravity_panel")&&$.length>0&&React.createElement("div",{className:"settings-row",
style:{alignItems:"flex-start"}},React.createElement("span",{className:"settings-label"},"Quotas"),React.createElement("\
div",{style:{display:"flex",flexDirection:"column",gap:6,flex:1,minWidth:0}},e?.available_ai_credits!=null&&React.createElement(
"span",{className:"settings-value"},"AI credits: ",e.available_ai_credits),React.createElement("div",{style:{display:"fl\
ex",flexWrap:"wrap",gap:6}},$.map((q,et)=>{let yt=q?.percent_used,xt=fm(q?.model),Hn=yt>=90?"#f85149":yt>=75?"#d29922":"\
#8b949e",ds=!!P&&P===q?.model;return React.createElement("span",{key:q?.model||`quota-${et}`,className:"composer-hint",title:q?.
refreshes_in?`${q.model} \xB7 resets in ${q.refreshes_in}`:q?.model||"",style:{color:Hn,border:`1px solid ${ds?Hn:"#3036\
3d"}`,borderRadius:999,padding:"2px 8px",background:ds?`${Hn}18`:"rgba(110,118,129,0.08)"}},xt," ",yt!=null?`${yt}%`:"n/\
a")})))),(Y==="antigravity"||Y==="antigravity_panel")&&React.createElement("div",{className:"settings-row"},React.createElement(
"span",{className:"settings-label"},"Mode"),React.createElement("select",{className:"settings-perm-select",value:ce==="u\
nknown"?"Planning":ce,disabled:_(V),onChange:q=>D(q.target.value)},El.map(q=>React.createElement("option",{key:q.id,value:q.
id},q.label))),V?.status==="ok"&&React.createElement("span",{className:"settings-inline-ok"},"Saved")),Jr(Y)&&ve.set_mode&&
xe.length>0&&React.createElement("div",{className:"settings-row"},React.createElement("span",{className:"settings-label"},
"Mode"),React.createElement("select",{className:"settings-perm-select",value:ce==="unknown"?xe[0].id:ce,disabled:_(V),onChange:q=>D(
q.target.value)},xe.map(q=>React.createElement("option",{key:q.id,value:q.id},q.label)),ce!=="unknown"&&!xe.some(q=>q.id===
ce)&&React.createElement("option",{value:ce},ce)),V?.status==="ok"&&React.createElement("span",{className:"settings-inli\
ne-ok"},"Saved")),(Y==="claude"||Y==="claude_cli"||Y==="codex_cli"||Y==="cursor_cli"||Y==="continue_yolo"||Jr(Y))&&React.
createElement("div",{className:"settings-row"},React.createElement("span",{className:"settings-label"},"Permission mode"),
ve.permission_mode_change&&Ee.length>0?React.createElement("select",{className:"settings-perm-select",value:B==="unknown"?
vm(Y):B,disabled:_(T),onChange:q=>de(q.target.value)},Ee.map(q=>React.createElement("option",{key:q.value,value:q.value},
q.label)),!Ee.some(q=>q.value===B)&&B!=="unknown"&&React.createElement("option",{value:B},B)):React.createElement("span",
{className:`settings-value${B==="unknown"?" dim":""}`},B),T?.status==="ok"&&React.createElement("span",{className:"setti\
ngs-inline-ok"},"Saved")),Y==="codex_cli"&&t?.approval_policy&&React.createElement("div",{className:"settings-row"},React.
createElement("span",{className:"settings-label"},"Approval policy"),React.createElement("span",{className:"settings-val\
ue"},t.approval_policy)),Y==="claude"&&be&&be!=="unknown"&&React.createElement("div",{className:"settings-row"},React.createElement(
"span",{className:"settings-label"},"Effort"),React.createElement("span",{className:"settings-value"},((t?.available_efforts||
[]).find(q=>q.id===be)||{}).label||be)),(Y==="claude_cli"||Y==="codex_cli"||Y==="cursor_cli")&&ve.set_effort&&(t?.available_efforts||
[]).length>0&&React.createElement("div",{className:"settings-row"},React.createElement("span",{className:"settings-label"},
he?"Observed effort":"Effort"),he?React.createElement("span",{className:`settings-value${!be||be==="unknown"?" dim":""}`,
title:t?.effort_provenance?.source||"No exact native metadata observed"},be||"unknown"):React.createElement("select",{className:"\
settings-perm-select",value:be||"medium",disabled:_(L),onChange:q=>Ze(q.target.value)},(t.available_efforts||[]).map(q=>React.
createElement("option",{key:q.id,value:q.id},q.label))),L?.status==="ok"&&React.createElement("span",{className:"setting\
s-inline-ok"},"Saved")),he&&ve.set_effort&&(t?.available_efforts||[]).length>0&&React.createElement("div",{className:"se\
ttings-row"},React.createElement("span",{className:"settings-label"},"Next send effort"),React.createElement("select",{className:"\
settings-perm-select",value:Ne,disabled:_(L),onChange:q=>Ze(q.target.value)},React.createElement("option",{value:"",disabled:!0},
"Choose effort\u2026"),(t.available_efforts||[]).map(q=>React.createElement("option",{key:q.id,value:q.id},q.label))),React.
createElement("span",{className:`settings-value small${t?.next_send_effort_status==="failed"?" error":""}`},t?.next_send_effort_status||
"unset")),(Y==="codex"||Y==="codex-desktop")&&ve.set_codex_config&&React.createElement(React.Fragment,null,ve.codex_model_change&&
(t?.available_models||[]).length>0&&React.createElement("div",{className:"settings-row"},React.createElement("span",{className:"\
settings-label"},X?"Next turn model":"Model"),React.createElement("select",{className:"settings-perm-select",value:t?.model_id||
"unknown",disabled:_(k)||!me,onChange:q=>{b?.({model_id:q.target.value})}},(t?.available_models||[]).map(q=>React.createElement(
"option",{key:q.id,value:q.id},q.label)),t?.model_id&&!(t?.available_models||[]).some(q=>q.id===t.model_id)&&t.model_id!==
"unknown"&&React.createElement("option",{value:t.model_id},t.model_id)),k?.status==="ok"&&React.createElement("span",{className:"\
settings-inline-ok"},"Saved")),ve.codex_effort_change&&(t?.available_efforts||[]).length>0&&React.createElement("div",{className:"\
settings-row"},React.createElement("span",{className:"settings-label"},X?"Next turn effort":"Effort"),React.createElement(
"select",{className:"settings-perm-select",value:(t?.effort||"unknown").toLowerCase(),disabled:_(L)||!me,onChange:q=>{b?.(
{effort:q.target.value})}},(t?.available_efforts||[]).map(q=>React.createElement("option",{key:q.id,value:q.id},q.label))),
L?.status==="ok"&&React.createElement("span",{className:"settings-inline-ok"},"Saved")),ve.codex_permission_profile_change&&
(t?.available_permission_profiles||[]).length>0&&React.createElement("div",{className:"settings-row"},React.createElement(
"span",{className:"settings-label"},"Next turn permissions"),React.createElement("select",{className:"settings-perm-sele\
ct",value:t?.permission_profile||"unknown",disabled:_(re)||!me,onChange:q=>ke(q.target.value)},(t?.available_permission_profiles||
[]).map(q=>React.createElement("option",{key:q.id,value:q.id},q.label))),re?.status==="ok"&&React.createElement("span",{
className:"settings-inline-ok"},"Saved")),A&&React.createElement("div",{className:"settings-bypass-confirmation",role:"a\
lert"},React.createElement("strong",null,"Enable Bypass permissions?"),React.createElement("span",null,"Full access sets\
 approval policy to Never and sandbox access to danger-full-access for this Codex conversation."),React.createElement("d\
iv",{className:"settings-bypass-actions"},React.createElement("button",{type:"button",onClick:()=>N(!1)},"Cancel"),React.
createElement("button",{type:"button",className:"danger",onClick:()=>ke("full-access",!0)},"Enable Full access"))),X&&t?.
bypass_permissions_active&&(h||t?.bypass_restore_profile)&&React.createElement("div",{className:"settings-row"},React.createElement(
"span",{className:"settings-label"},"Bypass permissions"),React.createElement("button",{type:"button",className:"setting\
s-restore-safe",disabled:_(re),onClick:()=>ke(h||t.bypass_restore_profile)},"Restore previous safe permissions")),X&&React.
createElement(React.Fragment,null,React.createElement("div",{className:"settings-row"},React.createElement("span",{className:"\
settings-label"},"Approval policy"),React.createElement("span",{className:"settings-value"},t?.approval_policy||"Native \
custom policy")),React.createElement("div",{className:"settings-row"},React.createElement("span",{className:"settings-la\
bel"},"Access / sandbox"),React.createElement("span",{className:"settings-value"},t?.permission_mode||"Native custom acc\
ess")),!me&&React.createElement("div",{className:"settings-control-unavailable",role:"status"},t?.controls_unavailable_reason||
"Codex controls are unavailable for this conversation.")),ve.codex_access_change&&(t?.available_access||[]).length>0&&React.
createElement("div",{className:"settings-row"},React.createElement("span",{className:"settings-label"},"Access"),React.createElement(
"select",{className:"settings-perm-select",value:t?.permission_mode||"unknown",disabled:_(ee),onChange:q=>{b?.({access_mode:q.
target.value})}},(t?.available_access||[]).map(q=>React.createElement("option",{key:q.id,value:q.id},q.label)))),ve.codex_speed_change&&
(t?.available_speeds||[]).length>0&&React.createElement("div",{className:"settings-row"},React.createElement("span",{className:"\
settings-label"},"Speed"),React.createElement("select",{className:"settings-perm-select",value:(t?.speed||"standard").toLowerCase(),
disabled:_(ne),onChange:q=>{b?.({speed:q.target.value})}},(t?.available_speeds||[]).map(q=>React.createElement("option",
{key:q.id,value:q.id},q.label)))),Y==="codex-desktop"&&t?.branch&&t.branch!=="unknown"&&React.createElement("div",{className:"\
settings-row"},React.createElement("span",{className:"settings-label"},"Branch"),React.createElement("span",{className:"\
settings-value"},t.branch)),Y==="codex-desktop"&&t?.sandbox_status&&React.createElement("div",{className:"settings-row"},
React.createElement("span",{className:"settings-label"},"Sandbox"),React.createElement("span",{className:`settings-value${t.
sandbox_status.active?"":" dim"}`},t.sandbox_status.active?"\u{1F7E2}":"\u26AA"," ",t.sandbox_status.label||(t.sandbox_status.
active?"Active":"Inactive"))),Y==="codex-desktop"&&(t?.available_workspaces||[]).length>0&&React.createElement("div",{className:"\
settings-row"},React.createElement("span",{className:"settings-label"},"Workspace"),React.createElement("select",{className:"\
settings-perm-select",value:t?.file_access_scope||"",disabled:_(z),onChange:q=>{y&&y(v,q.target.value)}},(t.available_workspaces||
[]).map(q=>React.createElement("option",{key:q.id,value:q.path||q.id},q.label)))),_e&&React.createElement("div",{className:"\
settings-row"},React.createElement("span",{className:oe?.status==="failed"?"settings-error":"settings-inline-ok",role:"s\
tatus"},_e))),(Y==="codex"||Y==="codex-desktop")&&!ve.set_codex_config&&React.createElement("div",{className:"settings-r\
ow"},React.createElement("span",{className:"settings-label"},"Access"),React.createElement("span",{className:`settings-v\
alue${B==="unknown"?" dim":""}`},B)),bl(Y)&&t?.mode&&t.mode!=="unknown"&&React.createElement("div",{className:"settings-\
row"},React.createElement("span",{className:"settings-label"},"Mode"),React.createElement("span",{className:"settings-va\
lue"},t.mode)),ve.auto_approve_permissions_toggle&&React.createElement("div",{className:"settings-row settings-row-check\
box"},React.createElement("span",{className:"settings-label"},"Tool Prompts"),React.createElement("label",{className:"se\
ttings-checkbox"},React.createElement("input",{type:"checkbox",checked:ie,disabled:_(H),onChange:q=>se(q.target.checked)}),
React.createElement("span",null,"Auto-approve permission prompts")),H?.status==="ok"&&React.createElement("span",{className:"\
settings-inline-ok"},"Saved")),(()=>{let q=Se!=="unknown"?Se:e?.workspace_name||e?.window_title||null;return React.createElement(
"div",{className:"settings-row"},React.createElement("span",{className:"settings-label"},"Workspace"),React.createElement(
"span",{className:`settings-value small${q?"":" dim"}`,title:q||""},q?Se!=="unknown"&&q.split(/[\\/]/).pop()||q:"\u2014"))})(),
_e&&!(Y==="codex"||Y==="codex-desktop")&&React.createElement("div",{className:oe?.status==="failed"?"settings-error":"se\
ttings-inline-ok",role:"status"},_e)),React.createElement("div",{className:"settings-panel-footer"},React.createElement(
"button",{className:"settings-refresh",onClick:()=>{v&&s(v)}},"\u21BB Refresh")))}function $b({chats:e,sessionId:t,onSwitch:n,
onNew:s,onClose:a}){return React.createElement("div",{className:"chat-list-panel"},React.createElement("div",{className:"\
chat-list-header"},React.createElement("span",{className:"chat-list-title"},"Conversations"),React.createElement("button",
{className:"chat-list-new-btn",onClick:s,title:"New conversation"},"+"),React.createElement("button",{className:"chat-li\
st-close-btn",onClick:a,title:"Close"},"\u2715")),React.createElement("div",{className:"chat-list-body"},!e||e.length===
0?React.createElement("div",{className:"chat-list-empty"},"No conversations found"):e.map((i,c)=>React.createElement("bu\
tton",{key:i.id||c,className:`chat-list-item${i.active?" active":""}`,onClick:()=>n(i.id),title:i.title},React.createElement(
"span",{className:"chat-list-item-title"},i.title),i.active&&React.createElement("span",{className:"chat-list-item-activ\
e"},"\u25CF")))))}function fl({items:e,onNavigate:t,onNew:n,onClose:s,embedded:a=!1,loading:i=!1}){let c=Array.isArray(e)?
e:[],u=c.filter(g=>g?.kind==="nav"),p=c.filter(g=>g?.kind==="project"),b=c.filter(g=>!g?.kind||g.kind==="chat"),y=c.filter(
g=>g?.kind==="see_all"),S=[],A=new Map;p.forEach(g=>{let _=g.project_index!=null?`idx:${g.project_index}`:`name:${g.project||
g.title||"Project"}`;A.has(_)||(S.push(_),A.set(_,g.title||g.project||"Project"))}),b.forEach(g=>{let _=g.project_index!=
null?`idx:${g.project_index}`:`name:${g.project||"Other"}`;A.has(_)||(S.push(_),A.set(_,g.project||"Other"))});let N=b.filter(
g=>g.project_index==null&&!g.project);function h(g){return g==="new_conversation"?"New Conversation":g==="conversation_h\
istory"?"Conversation History":g==="scheduled_tasks"?"Scheduled Tasks":"Agent Manager"}function d(g,_){return React.createElement(
"button",{key:g.id||_,className:`agv2-chat-item${g.active?" active":""}`,type:"button",onClick:()=>t(g.id),title:g.title||
"Untitled"},React.createElement("span",{className:"agv2-chat-title"},g.title||"Untitled"),g.age&&React.createElement("sp\
an",{className:"agv2-chat-age"},g.age),g.active&&React.createElement("span",{className:"agv2-chat-active"},"\u25CF"))}let v=React.
createElement(React.Fragment,null,React.createElement("div",{className:"agv2-nav-actions"},(u.length?u:[{id:"__agv2:new_\
conversation",action:"new_conversation"},{id:"__agv2:conversation_history",action:"conversation_history"},{id:"__agv2:sc\
heduled_tasks",action:"scheduled_tasks"}]).map(g=>React.createElement("button",{key:g.id||g.action,className:`agv2-nav-a\
ction ${g.action||""}`,type:"button",onClick:()=>g.action==="new_conversation"?n():t(g.id)},React.createElement("span",{
className:"agv2-nav-action-icon"},g.action==="new_conversation"?"+":g.action==="scheduled_tasks"?"\u25F7":"\u21BA"),React.
createElement("span",null,g.title||h(g.action))))),React.createElement("div",{className:"agv2-project-list"},S.length===
0&&N.length===0?React.createElement("div",{className:"chat-list-empty"},i?"Loading conversations...":"No projects or con\
versations found"):React.createElement(React.Fragment,null,S.map(g=>{let _=A.get(g)||"Project",k=b.filter(L=>(L.project_index!=
null?`idx:${L.project_index}`:`name:${L.project||"Other"}`)===g),T=y.filter(L=>(L.project_index!=null?`idx:${L.project_index}`:
`name:${L.project||"Other"}`)===g);return React.createElement("section",{className:"agv2-project-section",key:g},React.createElement(
"div",{className:"agv2-project-header"},React.createElement("span",{className:"agv2-project-icon"},"\u2302"),React.createElement(
"span",{className:"agv2-project-title"},_)),React.createElement("div",{className:"agv2-project-chats"},k.length===0?React.
createElement("div",{className:"agv2-project-empty"},"No visible conversations"):k.map(d),T.map(L=>React.createElement("\
button",{key:L.id,className:"agv2-see-all",type:"button",onClick:()=>t(L.id)},L.title||"See all"))))}),N.length>0&&React.
createElement("section",{className:"agv2-project-section"},React.createElement("div",{className:"agv2-project-header"},React.
createElement("span",{className:"agv2-project-icon"},"\u2302"),React.createElement("span",{className:"agv2-project-title"},
"Other")),React.createElement("div",{className:"agv2-project-chats"},N.map(d))))));return a?React.createElement("div",{className:"\
agv2-nav-embedded"},v):React.createElement("div",{className:"chat-list-panel agv2-nav-panel"},React.createElement("div",
{className:"chat-list-header"},React.createElement("span",{className:"chat-list-title"},"Antigravity Agent Manager"),React.
createElement("button",{className:"chat-list-new-btn",onClick:n,title:"New conversation"},"+"),React.createElement("butt\
on",{className:"chat-list-close-btn",onClick:s,title:"Close"},"\u2715")),React.createElement("div",{className:"chat-list\
-body agv2-nav-body"},v))}function Eb({threads:e,sessionId:t,onSwitch:n,onNew:s,onClose:a,newLabel:i="New thread"}){return React.
createElement("div",{className:"chat-list-panel"},React.createElement("div",{className:"chat-list-header"},React.createElement(
"span",{className:"chat-list-title"},"Threads"),React.createElement("button",{className:"chat-list-new-btn",onClick:s,title:i},
"+"),React.createElement("button",{className:"chat-list-close-btn",onClick:a,title:"Close"},"\u2715")),React.createElement(
"div",{className:"chat-list-body"},!e||e.length===0?React.createElement("div",{className:"chat-list-empty"},"No threads \
found"):e.map((c,u)=>React.createElement("button",{key:c.cache_key||c.id||u,className:`chat-list-item${c.active?" active":
""}`,onClick:()=>n(c.id),title:c.title},React.createElement("span",{className:"chat-list-item-title"},c.title),c.age&&React.
createElement("span",{className:"chat-list-item-age"},c.age),c.active&&React.createElement("span",{className:"chat-list-\
item-active"},"\u25CF")))))}function Lb({threads:e,activeThreadId:t,onSwitch:n,onNew:s,onOpenHistory:a,showDraftTab:i=!1,
newLabel:c="New chat"}){return React.createElement("div",{className:"thread-tabs-bar"},React.createElement("div",{className:"\
thread-tabs-scroll"},i&&React.createElement("button",{className:"thread-tab active draft",type:"button",title:c},React.createElement(
"span",{className:"thread-tab-title"},c)),(e||[]).map((u,p)=>{let b=t?u.id===t:!!u.active;return React.createElement("bu\
tton",{key:u.cache_key||u.id||p,className:`thread-tab${b?" active":""}`,type:"button",title:u.title||"Untitled",onClick:()=>n(
u.id)},React.createElement("span",{className:"thread-tab-title"},u.title||"Untitled"),u.age&&React.createElement("span",
{className:"thread-tab-age"},u.age))})),React.createElement("div",{className:"thread-tabs-actions"},React.createElement(
"button",{className:"thread-tabs-btn",type:"button",onClick:a,title:"Show all threads"},"All"),React.createElement("butt\
on",{className:"thread-tabs-btn accent",type:"button",onClick:s,title:c},"+")))}function Pb({branchData:e,sessionId:t,currentBranch:n,
onSwitch:s,onCreate:a,onClose:i}){let[c,u]=React.useState(""),[p,b]=React.useState(!1),[y,S]=React.useState(""),A=e?.branches||
[],N=e?.current||n||"",h=c?A.filter(d=>d.toLowerCase().includes(c.toLowerCase())):A;return React.createElement("div",{className:"\
branch-selector-panel"},React.createElement("div",{className:"branch-selector-header"},React.createElement("span",{className:"\
branch-selector-title"},"Branches"),React.createElement("button",{className:"chat-list-close-btn",onClick:i,title:"Close"},
"\u2715")),React.createElement("div",{className:"branch-selector-search"},React.createElement("input",{type:"text",className:"\
branch-search-input",placeholder:"Search branches\u2026",value:c,onChange:d=>u(d.target.value),autoFocus:!0})),React.createElement(
"div",{className:"branch-selector-body"},h.length===0&&!p&&React.createElement("div",{className:"chat-list-empty"},"No b\
ranches found"),h.map((d,v)=>React.createElement("button",{key:d,className:`branch-item${d===N?" active":""}`,onClick:()=>{
d!==N&&s(d)},title:d},React.createElement("span",{className:"branch-item-icon"},d===N?"\u2713":""),React.createElement("\
span",{className:"branch-item-name"},d)))),React.createElement("div",{className:"branch-selector-footer"},p?React.createElement(
"form",{className:"branch-create-form",onSubmit:d=>{d.preventDefault(),y.trim()&&(a(y.trim()),b(!1),S(""))}},React.createElement(
"input",{type:"text",className:"branch-create-input",placeholder:"new-branch-name",value:y,onChange:d=>S(d.target.value),
autoFocus:!0}),React.createElement("button",{type:"submit",className:"branch-create-submit",disabled:!y.trim()},"Create"),
React.createElement("button",{type:"button",className:"branch-create-cancel",onClick:()=>{b(!1),S("")}},"\u2715")):React.
createElement("button",{className:"branch-create-btn",onClick:()=>b(!0)},"+ Create and checkout new branch")))}function qb({
entries:e,canRead:t,canInput:n,onClose:s,onRefresh:a,onSend:i,controlResults:c}){let[u,p]=ue(""),[b,y]=ue(null),S=b?c?.[b]:
null;function A(N){N.preventDefault();let h=u.trim();!h||!i||(y(i(h)),p(""))}return React.createElement("div",{className:"\
terminal-viewer"},React.createElement("div",{className:"terminal-viewer-header"},React.createElement("span",{className:"\
terminal-viewer-title"},"Terminal"),t&&React.createElement("button",{className:"terminal-viewer-refresh",onClick:a,title:"\
Refresh"},"\u21BB"),React.createElement("button",{className:"terminal-viewer-close",onClick:s,title:"Close"},"\u2715")),
t?React.createElement("div",{className:"terminal-viewer-body"},!e||e.length===0?React.createElement("div",{className:"te\
rminal-viewer-empty"},"No terminal output captured"):e.map((N,h)=>React.createElement("div",{key:h,className:"terminal-e\
ntry"},N.command&&React.createElement("div",{className:"terminal-command"},"$ ",N.command),React.createElement("pre",{className:"\
terminal-output"},N.output)))):React.createElement("div",{className:"terminal-viewer-empty"},"Terminal output is unavail\
able for this harness."),n&&React.createElement("form",{className:"terminal-input-form",onSubmit:A},React.createElement(
"input",{className:"terminal-input",type:"text",value:u,onChange:N=>p(N.target.value),placeholder:"Enter a command in th\
is session's terminal","aria-label":"Terminal command"}),React.createElement("button",{className:"terminal-input-send",type:"\
submit",disabled:!u.trim()},"Run"),b&&React.createElement("div",{className:`terminal-input-status ${S?.result||"pending"}`,
role:"status"},S?S.result==="ok"?"Command sent":`Command failed: ${S.error?.message||S.error?.code||"unknown error"}`:"C\
ommand pending\u2026")))}function Ob({entries:e,onClose:t,onRefresh:n,onAccept:s,onReject:a}){let i=c=>{let u=String(c||
"").trim();return u?u.split(/\s+/).filter(Boolean).map(p=>({text:p,cls:p.startsWith("+")?"add":p.startsWith("-")?"del":"\
neutral"})):[]};return React.createElement("div",{className:"diff-viewer"},React.createElement("div",{className:"diff-vi\
ewer-header"},React.createElement("span",{className:"diff-viewer-title"},"File Changes"),React.createElement("button",{className:"\
diff-viewer-refresh",onClick:n,title:"Refresh"},"\u21BB"),React.createElement("button",{className:"diff-viewer-close",onClick:t,
title:"Close"},"\u2715")),React.createElement("div",{className:"diff-viewer-body"},!e||e.length===0?React.createElement(
"div",{className:"diff-viewer-empty"},"No file changes detected"):e.map((c,u)=>React.createElement("div",{key:u,className:"\
diff-entry"},c.file&&React.createElement("div",{className:"diff-file-header"},React.createElement("span",null,c.file||c.
path),(c.can_accept||c.can_reject)&&s&&a&&React.createElement("span",{className:"diff-file-actions"},c.can_accept&&React.
createElement("button",{type:"button",className:"diff-action-accept",onClick:()=>s(c.id||c.path)},"Accept"),c.can_reject&&
React.createElement("button",{type:"button",className:"diff-action-reject",onClick:()=>a(c.id||c.path)},"Reject"))),c.summary&&
React.createElement("div",{className:"diff-file-summary"},i(c.summary).map((p,b)=>React.createElement("span",{key:b,className:`\
diff-file-summary-chip diff-file-summary-chip-${p.cls}`},p.text))),c.content?React.createElement("pre",{className:"diff-\
content"},c.content.split(`
`).map((p,b)=>{let y=p.startsWith("+")?"diff-add":p.startsWith("-")?"diff-del":p.startsWith("@@")?"diff-hunk":"";return React.
createElement("span",{key:b,className:y},p,`
`)})):!c.summary&&React.createElement("pre",{className:"diff-content"},"No content")))))}var gl={directory:"\u{1F4C1}",md:"\
\u{1F4C4}",txt:"\u{1F4C4}",json:"\u{1F4CB}",js:"\u{1F4DC}",jsx:"\u{1F4DC}",ts:"\u{1F4DC}",tsx:"\u{1F4DC}",py:"\u{1F40D}",
html:"\u{1F310}",css:"\u{1F3A8}",yml:"\u2699",yaml:"\u2699",toml:"\u2699",sh:"\u26A1",bat:"\u26A1",ps1:"\u26A1",env:"\u{1F512}",
lock:"\u{1F512}",png:"\u{1F5BC}",jpg:"\u{1F5BC}",gif:"\u{1F5BC}",svg:"\u{1F5BC}",default:"\u{1F4C4}"};function Ib(e){if(e.
type==="directory")return gl.directory;let t=e.name.split(".").pop().toLowerCase();return gl[t]||gl.default}function Db(e){
return e==null?"":e<1024?`${e} B`:e<1024*1024?`${(e/1024).toFixed(1)} KB`:`${(e/(1024*1024)).toFixed(1)} MB`}var jb=new Set(
["md","txt","json","js","jsx","ts","tsx","py","html","css","yml","yaml","toml","sh","bat","ps1","cfg","conf","ini","xml",
"csv","log","env","gitignore","dockerignore","sql","rs","go","java","c","cpp","h","hpp","rb","php","swift","kt","scala",
"r","lua","vim","zsh","bash","fish"]);function nm(e){let t=e.split(".").pop().toLowerCase();return jb.has(t)||e.startsWith(
".")}function Bb(e){return e.toLowerCase().endsWith(".md")}function Fb({path:e,content:t,truncated:n,onBack:s}){let a=React.
useMemo(()=>{if(!t)return"";try{let u=marked.parse(t);return DOMPurify.sanitize(u)}catch{return`<pre>${DOMPurify.sanitize(
t)}</pre>`}},[t]),i=React.useRef(null);React.useEffect(()=>{i.current&&i.current.querySelectorAll("pre code").forEach(u=>{
hljs.highlightElement(u)})},[a]);let c=e?e.split("/").pop().split("\\").pop():"File";return React.createElement("div",{className:"\
file-viewer"},React.createElement("div",{className:"file-viewer-header"},React.createElement("button",{className:"file-v\
iewer-back",onClick:s,title:"Back to files"},"\u2190"),React.createElement("span",{className:"file-viewer-title",title:e},
c),n&&React.createElement("span",{className:"file-viewer-truncated"},"truncated")),React.createElement("div",{className:"\
file-viewer-body markdown-body",ref:i,dangerouslySetInnerHTML:{__html:a}}))}function Hb({path:e,content:t,truncated:n,onBack:s}){
let a=e?e.split("/").pop().split("\\").pop():"File",i=a.split(".").pop().toLowerCase(),c=React.useMemo(()=>{if(!t)return"";
try{return i&&hljs.getLanguage(i)?hljs.highlight(t,{language:i}).value:hljs.highlightAuto(t).value}catch{return DOMPurify.
sanitize(t)}},[t,i]);return React.createElement("div",{className:"file-viewer"},React.createElement("div",{className:"fi\
le-viewer-header"},React.createElement("button",{className:"file-viewer-back",onClick:s,title:"Back to files"},"\u2190"),
React.createElement("span",{className:"file-viewer-title",title:e},a),n&&React.createElement("span",{className:"file-vie\
wer-truncated"},"truncated")),React.createElement("div",{className:"file-viewer-body"},React.createElement("pre",{className:"\
file-viewer-code"},React.createElement("code",{dangerouslySetInnerHTML:{__html:c}}))))}function Ub(e,t){let n=za(e||"text"),s=Math.max(...String(t||"").match(/`+/g)?.map(i=>i.length)||[0]),a="`".repeat(Math.
max(3,s+1));return`${a}${n}
${t||""}
${a}`}function Wb({sessionId:e,filePath:t,fileContents:n,onClose:s}){let a=`${e}:${t}`,i=n[a],c=i?.content||"",u=i?.truncated||
!1,p=React.useMemo(()=>Ub(t,c),[t,c]);return React.createElement("div",{className:"transcript-inline-preview"},React.createElement(
"div",{className:"transcript-inline-preview-header"},React.createElement("span",{className:"transcript-inline-preview-ti\
tle",title:t},t),u&&React.createElement("span",{className:"file-viewer-truncated"},"truncated"),React.createElement("but\
ton",{className:"transcript-inline-preview-close",onClick:s,title:"Collapse"},"Collapse")),i?React.createElement(Ya,{content:p,
monospace:!0}):React.createElement("div",{className:"transcript-file-loading"},React.createElement("div",null,"Loading f\
ile preview...")))}function zb({sessionId:e,listing:t,fileContents:n,onNavigate:s,onOpenFile:a,onClose:i,onRefresh:c,viewingFile:u,
onBackToListing:p}){if(u){let A=`${e}:${u}`,N=n[A],h=N?.content||"",d=N?.truncated||!1;return Bb(u)?React.createElement(
Fb,{path:u,content:h,truncated:d,onBack:p}):React.createElement(Hb,{path:u,content:h,truncated:d,onBack:p})}let b=t?.entries||
[],y=t?.path||".",S=y==="."?[]:y.replace(/\\/g,"/").split("/").filter(Boolean);return React.createElement("div",{className:"\
file-browser"},React.createElement("div",{className:"file-browser-header"},React.createElement("span",{className:"file-b\
rowser-title"},"Files"),React.createElement("button",{className:"file-browser-refresh",onClick:c,title:"Refresh"},"\u21BB"),
React.createElement("button",{className:"file-browser-close",onClick:i,title:"Close"},"\u2715")),React.createElement("di\
v",{className:"file-browser-breadcrumbs"},React.createElement("button",{className:"breadcrumb-item",onClick:()=>s(".")},
"root"),S.map((A,N)=>{let h=S.slice(0,N+1).join("/");return React.createElement(React.Fragment,{key:h},React.createElement(
"span",{className:"breadcrumb-sep"},"/"),React.createElement("button",{className:"breadcrumb-item",onClick:()=>s(h)},A))})),
React.createElement("div",{className:"file-browser-body"},b.length===0?React.createElement("div",{className:"file-browse\
r-empty"},"Empty directory"):React.createElement("div",{className:"file-browser-list"},y!=="."&&React.createElement("div",
{className:"file-browser-entry",onClick:()=>{let A=S.slice(0,-1).join("/")||".";s(A)}},React.createElement("span",{className:"\
file-entry-icon"},"\u{1F4C1}"),React.createElement("span",{className:"file-entry-name"},"..")),b.map(A=>React.createElement(
"div",{key:A.name,className:`file-browser-entry${A.type==="directory"?" is-dir":""}${nm(A.name)?" is-viewable":""}`,onClick:()=>{
if(A.type==="directory"){let N=y==="."?A.name:`${y}/${A.name}`;s(N)}else if(nm(A.name)){let N=y==="."?A.name:`${y}/${A.name}`;
a(N)}}},React.createElement("span",{className:"file-entry-icon"},Ib(A)),React.createElement("span",{className:"file-entr\
y-name"},A.name),React.createElement("span",{className:"file-entry-meta"},A.type==="file"&&Db(A.size)))))))}var Gb={daily:"\
Daily",weekdays:"Weekdays",weekly:"Weekly",custom:"Custom"},Nl={"Status reports":"\u{1F4CA}","Release prep":"\u{1F680}",
"Code quality":"\u{1F50D}",Documentation:"\u{1F4DD}",General:"\u2699"};function Kb({automation:e,onEdit:t,onRun:n,onToggle:s}){
let a=Nl[e.category]||"\u2699",i=Gb[e.schedule]||e.schedule,c=Nn[e.target_agent_type]||_l;return React.createElement("di\
v",{className:`automation-card${e.enabled?"":" disabled"}`,onClick:()=>t(e)},React.createElement("div",{className:"autom\
ation-card-icon"},a),React.createElement("div",{className:"automation-card-body"},React.createElement("div",{className:"\
automation-card-name"},e.name),e.description&&React.createElement("div",{className:"automation-card-desc"},e.description)),
React.createElement("div",{className:"automation-card-meta"},React.createElement("span",{className:"automation-card-agen\
t",style:{color:c.color},title:c.name},c.abbr),React.createElement("span",{className:"automation-card-schedule"},i," ",String(
e.cron_hour).padStart(2,"0"),":",String(e.cron_minute).padStart(2,"0"))),React.createElement("div",{className:"automatio\
n-card-actions",onClick:u=>u.stopPropagation()},React.createElement("button",{className:"automation-run-btn",title:"Run \
now",onClick:()=>n(e)},"\u25B6"),React.createElement("button",{className:`automation-toggle-btn${e.enabled?" on":""}`,title:e.
enabled?"Disable":"Enable",onClick:()=>s(e)},e.enabled?"\u25CF":"\u25CB")))}function Vb({automation:e,sessions:t,onSave:n,
onDelete:s,onClose:a}){let i=!e?.id,[c,u]=ue({name:e?.name||"",description:e?.description||"",category:e?.category||"Gen\
eral",prompt:e?.prompt||"",schedule:e?.schedule||"daily",cron_hour:e?.cron_hour??9,cron_minute:e?.cron_minute??0,cron_days:e?.
cron_days||[1,2,3,4,5],target_agent_type:e?.target_agent_type||"claude",target_session:e?.target_session||"",enabled:e?.
enabled!==!1}),[p,b]=ue(!1);function y(h,d){u(v=>({...v,[h]:d}))}function S(h){u(d=>{let v=d.cron_days.includes(h)?d.cron_days.
filter(g=>g!==h):[...d.cron_days,h].sort();return{...d,cron_days:v}})}async function A(h){h.preventDefault(),!(!c.name.trim()||
!c.prompt.trim())&&(b(!0),await n({...c,target_session:c.target_session||null}),b(!1))}let N=["Sun","Mon","Tue","Wed","T\
hu","Fri","Sat"];return React.createElement("div",{className:"automation-modal-overlay",onClick:a},React.createElement("\
div",{className:"automation-modal",onClick:h=>h.stopPropagation()},React.createElement("div",{className:"automation-moda\
l-header"},React.createElement("span",null,i?"New Automation":"Edit Automation"),React.createElement("button",{className:"\
automation-modal-close",onClick:a},"\u2715")),React.createElement("form",{className:"automation-modal-form",onSubmit:A},
React.createElement("label",null,React.createElement("span",null,"Name"),React.createElement("input",{type:"text",value:c.
name,onChange:h=>y("name",h.target.value),placeholder:"e.g. Daily standup summary",required:!0})),React.createElement("l\
abel",null,React.createElement("span",null,"Description"),React.createElement("input",{type:"text",value:c.description,onChange:h=>y(
"description",h.target.value),placeholder:"Brief description (optional)"})),React.createElement("label",null,React.createElement(
"span",null,"Category"),React.createElement("select",{value:c.category,onChange:h=>y("category",h.target.value)},Object.
keys(Nl).map(h=>React.createElement("option",{key:h,value:h},Nl[h]," ",h)))),React.createElement("label",null,React.createElement(
"span",null,"Prompt"),React.createElement("textarea",{rows:4,value:c.prompt,onChange:h=>y("prompt",h.target.value),placeholder:"\
The prompt to send to the agent...",required:!0})),React.createElement("div",{className:"automation-modal-row"},React.createElement(
"label",{className:"half"},React.createElement("span",null,"Target Agent"),React.createElement("select",{value:c.target_agent_type,
onChange:h=>y("target_agent_type",h.target.value)},Object.entries(Nn).map(([h,d])=>React.createElement("option",{key:h,value:h},
d.name)))),React.createElement("label",{className:"half"},React.createElement("span",null,"Specific Session (optional)"),
React.createElement("select",{value:c.target_session,onChange:h=>y("target_session",h.target.value)},React.createElement(
"option",{value:""},"Any matching session"),(t||[]).map(h=>{let d=typeof h=="string"?h:h?.session_id,v=ir(h);return React.
createElement("option",{key:d,value:d},v.name,": ",Eu(d)||d)})))),React.createElement("div",{className:"automation-modal\
-row"},React.createElement("label",{className:"third"},React.createElement("span",null,"Schedule"),React.createElement("\
select",{value:c.schedule,onChange:h=>y("schedule",h.target.value)},React.createElement("option",{value:"daily"},"Daily"),
React.createElement("option",{value:"weekdays"},"Weekdays"),React.createElement("option",{value:"weekly"},"Weekly"),React.
createElement("option",{value:"custom"},"Custom days"))),React.createElement("label",{className:"third"},React.createElement(
"span",null,"Hour"),React.createElement("input",{type:"number",min:0,max:23,value:c.cron_hour,onChange:h=>y("cron_hour",
parseInt(h.target.value)||0)})),React.createElement("label",{className:"third"},React.createElement("span",null,"Minute"),
React.createElement("input",{type:"number",min:0,max:59,value:c.cron_minute,onChange:h=>y("cron_minute",parseInt(h.target.
value)||0)}))),(c.schedule==="custom"||c.schedule==="weekly")&&React.createElement("div",{className:"automation-days-row"},
React.createElement("span",null,"Days:"),N.map((h,d)=>React.createElement("button",{key:d,type:"button",className:`autom\
ation-day-btn${c.cron_days.includes(d)?" active":""}`,onClick:()=>S(d)},h))),React.createElement("div",{className:"autom\
ation-modal-footer"},!i&&React.createElement("button",{type:"button",className:"automation-delete-btn",onClick:()=>s(e)},
"Delete"),React.createElement("div",{style:{flex:1}}),React.createElement("button",{type:"button",className:"automation-\
cancel-btn",onClick:a},"Cancel"),React.createElement("button",{type:"submit",className:"automation-save-btn",disabled:p||
!c.name.trim()||!c.prompt.trim()},p?"Saving...":i?"Create":"Save")))))}function Yb({sessions:e,onBack:t}){let[n,s]=ue([]),
[a,i]=ue(!0),[c,u]=ue(null),[p,b]=ue("");function y(g){b(g),setTimeout(()=>b(""),3e3)}async function S(){try{let g=await fetch(
"/api/automations");if(!g.ok)throw new Error("Failed to fetch");let _=await g.json();s(_.automations||[])}catch{y("Faile\
d to load automations")}finally{i(!1)}}Te(()=>{S()},[]);async function A(g){let _=!c?.id,k=_?"/api/automations":`/api/au\
tomations/${c.id}`,T=_?"POST":"PUT";try{if(!(await fetch(k,{method:T,headers:{"Content-Type":"application/json"},body:JSON.
stringify(g)})).ok)throw new Error("Save failed");y(_?"Automation created":"Automation updated"),u(null),S()}catch{y("Fa\
iled to save automation")}}async function N(g){if(window.confirm(`Delete "${g.name}"?`))try{await fetch(`/api/automation\
s/${g.id}`,{method:"DELETE"}),y("Automation deleted"),u(null),S()}catch{y("Failed to delete")}}async function h(g){try{let _=await fetch(
`/api/automations/${g.id}/run`,{method:"POST"}),k=await _.json();_.ok?y(`Running "${g.name}"...`):y(k.error||"Failed to \
run")}catch{y("Failed to run automation")}}async function d(g){try{await fetch(`/api/automations/${g.id}`,{method:"PUT",
headers:{"Content-Type":"application/json"},body:JSON.stringify({enabled:!g.enabled})}),S()}catch{y("Failed to toggle")}}
let v={};for(let g of n){let _=g.category||"General";v[_]||(v[_]=[]),v[_].push(g)}return React.createElement("div",{className:"\
automations-view"},React.createElement("div",{className:"automations-header"},React.createElement("button",{className:"a\
utomations-back",onClick:t,title:"Back to sessions"},"\u2190"),React.createElement("div",{className:"automations-header-\
text"},React.createElement("h2",null,"Automations"),React.createElement("p",null,"Automate work by sending scheduled pro\
mpts to your agents.")),React.createElement("button",{className:"automations-new-btn",onClick:()=>u({})},"+ New automati\
on")),a?React.createElement("div",{className:"automations-loading"},"Loading automations..."):n.length===0?React.createElement(
"div",{className:"automations-empty"},React.createElement("div",{className:"automations-empty-icon"},"\u2699"),React.createElement(
"div",{className:"automations-empty-text"},"No automations yet"),React.createElement("div",{className:"automations-empty\
-sub"},"Create your first automation to schedule recurring prompts to your agents."),React.createElement("button",{className:"\
automations-new-btn",onClick:()=>u({})},"+ New automation")):React.createElement("div",{className:"automations-body"},Object.
entries(v).map(([g,_])=>React.createElement("div",{key:g,className:"automations-category"},React.createElement("h3",{className:"\
automations-category-title"},g),React.createElement("div",{className:"automations-card-grid"},_.map(k=>React.createElement(
Kb,{key:k.id,automation:k,onEdit:u,onRun:h,onToggle:d})))))),c!==null&&React.createElement(Vb,{automation:c?.id?c:null,sessions:e,
onSave:A,onDelete:N,onClose:()=>u(null)}),p&&React.createElement("div",{className:"automations-toast"},p))}function Xb({
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
createElement("button",{className:"codex-automation-pane-action",onClick:t},e.action_label))}function ar(e){return new Intl.
NumberFormat([],{notation:"compact",maximumFractionDigits:1}).format(Math.max(0,Number(e)||0))}function Qb({cost:e,detailState:t,
onRequestDetail:n}){let[s,a]=React.useState(1),[i,c]=React.useState(""),u=React.useMemo(()=>Fd(e,{days:s,project:i}),[e,
s,i]),p=t?.status==="ready"?t.detail:null,b=!!p&&Number(p.query?.days)===s&&String(p.query?.project||"")===i&&(!e?.generatedAt||
String(p.generated_at||"")===e.generatedAt),y=t?.status==="loading"&&Number(t.query?.days)===s&&String(t.query?.project||
"")===i&&String(t.query?.cursor||"0")==="0",S=b&&String(p.pagination?.cursor||"0")==="0",A=b?{costUsd:Math.max(0,Number(
p.summary?.cost_usd)||0),records:Math.max(0,Number(p.summary?.records)||0),tokens:{input:Math.max(0,Number(p.summary?.tokens?.
input)||0),cached:Math.max(0,Number(p.summary?.tokens?.cached)||0),output:Math.max(0,Number(p.summary?.tokens?.output)||
0)},byModel:Array.isArray(p.summary?.by_model)?p.summary.by_model:[],byDay:Array.isArray(p.summary?.by_day)?p.summary.by_day:
[]}:u;if(React.useEffect(()=>{!e?.detail?.truncated||!n||y||S||n({days:s,project:i,cursor:"0",pageSize:e.detail.pageSize||
256})},[e?.detail?.truncated,e?.detail?.pageSize,e?.generatedAt,s,i,n]),!e)return null;let N=(["ready","partial","stale"].
includes(e.status)||e.status==="scanning"&&!!e.lastGoodGeneratedAt)&&e.costUsd!=null&&e.records!=null&&e.tokens.input!=null&&
e.tokens.cached!=null&&e.tokens.output!=null,h={"not-started":["Not scanned yet","The local cost scan has not completed."],
idle:["Not scanned yet","The local cost scan has not completed."],scanning:["Scanning local history","Provider quota rem\
ains available while cost files are scanned."],error:["Cost scan unavailable","The last cost payload failed its bounded \
structural contract. Provider quota is still current."],unavailable:["Cost scan unavailable","Local cost sources are una\
vailable. Provider quota is still current."],cancelled:["Cost scan cancelled","No zero total is reported because the sca\
n did not complete."]}[e.status]||["Cost data pending","Waiting for an authoritative local cost scan."];if(!N)return React.
createElement("section",{className:"usage-cost-panel","aria-labelledby":"usage-cost-heading"},React.createElement("div",
{className:"usage-cost-heading"},React.createElement("span",null,React.createElement("h3",{id:"usage-cost-heading"},"Loc\
al estimated API-equivalent cost"),React.createElement("small",null,"Separate from subscription quota")),React.createElement(
"span",{className:`usage-cost-status ${e.status}`},e.status)),React.createElement("div",{className:"usage-cost-state",role:"\
status"},React.createElement("strong",null,h[0]),React.createElement("span",null,h[1]),e.reasonCode&&React.createElement(
"small",null,"Reason: ",e.reasonCode,e.reasonPath?` (${e.reasonPath})`:"")),React.createElement("div",{className:"usage-\
cost-scan"},Number.isFinite(Number(e.scan.files_complete))?`Incremental local JSONL scan - ${e.scan.files_complete}/${e.
scan.files_total||0} files`:"Incremental local JSONL scan has not reported file progress."));let d=[...new Set(e.byProject.
map(k=>k.project).filter(Boolean))].sort(),v=[...A?.byModel||[]].sort((k,T)=>T.cost_usd-k.cost_usd).slice(0,12),g=[...A?.
byDay||[]].sort((k,T)=>k.day.localeCompare(T.day)),_=Math.max(1e-6,...g.map(k=>Number(k.cost_usd)||0));return React.createElement(
"section",{className:"usage-cost-panel","aria-labelledby":"usage-cost-heading"},React.createElement("div",{className:"us\
age-cost-heading"},React.createElement("span",null,React.createElement("h3",{id:"usage-cost-heading"},"Local estimated A\
PI-equivalent cost"),React.createElement("small",null,"Separate from subscription quota \xB7 pricing ",e.catalogVersion||
"unavailable")),React.createElement("span",{className:`usage-cost-status ${e.status}`},e.status)),React.createElement("d\
iv",{className:"usage-cost-controls"},React.createElement("label",null,"Range",React.createElement("select",{value:s,onChange:k=>a(
Number(k.target.value))},[1,7,30,90,365].map(k=>React.createElement("option",{key:k,value:k},k===1?"Today":`${k} days`)))),
React.createElement("label",null,"Project",React.createElement("select",{value:i,onChange:k=>c(k.target.value)},React.createElement(
"option",{value:""},"All projects"),d.map(k=>React.createElement("option",{key:k,value:k},k))))),React.createElement("di\
v",{className:"usage-cost-summary"},React.createElement("span",null,React.createElement("strong",null,"$",(A?.costUsd||0).
toFixed(2)),React.createElement("small",null,"estimated cost")),React.createElement("span",null,React.createElement("str\
ong",null,ar(A?.tokens.input)),React.createElement("small",null,"input tokens")),React.createElement("span",null,React.createElement(
"strong",null,ar(A?.tokens.cached)),React.createElement("small",null,"cached tokens")),React.createElement("span",null,React.
createElement("strong",null,ar(A?.tokens.output)),React.createElement("small",null,"output tokens"))),e.detail?.truncated&&
React.createElement("div",{className:"usage-cost-detail-state",role:"status"},b?`Showing detail rows ${Number(p.pagination?.
cursor||0)+1}-${Number(p.pagination?.cursor||0)+Number(p.pagination?.returned_rows||0)} of ${Number(p.pagination?.total_rows||
0)}.`:t?.status==="error"?"Cost detail is unavailable.":`Loading a bounded detail page for ${e.detail.totalRows} cost-de\
tail rows.`),React.createElement("div",{className:"usage-cost-chart",role:"img","aria-label":`${s}-day estimated cost by\
 day`},(g.length?g:[{day:"No data",cost_usd:0}]).map(k=>React.createElement("span",{key:k.day,title:`${k.day}: $${Number(
k.cost_usd).toFixed(4)}`},React.createElement("i",{style:{height:`${Math.max(3,Number(k.cost_usd)/_*100)}%`}}),React.createElement(
"small",null,k.day.slice(5))))),e.detail?.truncated&&React.createElement("details",{className:"usage-cost-detail-table"},
React.createElement("summary",null,"Cost detail rows"),t?.status==="loading"&&React.createElement("div",{className:"usag\
e-cost-detail-state"},"Loading cost detail\u2026"),t?.status==="error"&&React.createElement("div",{className:"usage-cost\
-detail-state"},"Cost detail unavailable: ",t.error),b&&React.createElement(React.Fragment,null,React.createElement("div",
{className:"usage-cost-detail-pager","aria-label":"Cost detail pagination"},React.createElement("button",{type:"button",
disabled:Number(p.pagination?.cursor||0)<=0,onClick:()=>n({days:s,project:i,cursor:String(Math.max(0,Number(p.pagination.
cursor||0)-Number(p.pagination.page_size||256))),pageSize:p.pagination.page_size||256})},"Previous"),React.createElement(
"span",null,p.pagination.returned_rows," rows \xB7 ",p.pagination.total_rows," total"),React.createElement("button",{type:"\
button",disabled:!p.pagination?.next_cursor,onClick:()=>n({days:s,project:i,cursor:p.pagination.next_cursor,pageSize:p.pagination.
page_size||256})},"Next")),React.createElement("div",{className:"usage-cost-table-wrap"},React.createElement("table",{className:"\
usage-cost-table"},React.createElement("caption",null,"Paginated local cost detail"),React.createElement("thead",null,React.
createElement("tr",null,React.createElement("th",null,"Day"),React.createElement("th",null,"Provider / model"),React.createElement(
"th",null,"Project"),React.createElement("th",null,"Speed"),React.createElement("th",null,"Cost"))),React.createElement(
"tbody",null,(p.rows||[]).map((k,T)=>React.createElement("tr",{key:`${p.pagination.cursor}:${T}`},React.createElement("t\
d",null,k.day),React.createElement("th",{scope:"row"},k.provider_id," \xB7 ",k.model),React.createElement("td",null,k.project),
React.createElement("td",null,k.speed),React.createElement("td",null,"$",Number(k.cost_usd).toFixed(4))))))))),React.createElement(
"div",{className:"usage-cost-table-wrap"},React.createElement("table",{className:"usage-cost-table"},React.createElement(
"caption",null,"Estimated cost and tokens by provider model"),React.createElement("thead",null,React.createElement("tr",
null,React.createElement("th",null,"Provider / model"),React.createElement("th",null,"Input"),React.createElement("th",null,
"Cached"),React.createElement("th",null,"Output"),React.createElement("th",null,"Cost"))),React.createElement("tbody",null,
v.map(k=>React.createElement("tr",{key:`${k.provider_id}:${k.model}`},React.createElement("th",{scope:"row"},k.provider_id===
"openai-codex"?"Codex":"Claude"," \xB7 ",k.model),React.createElement("td",null,ar(k.input)),React.createElement("td",null,
ar(k.cached)),React.createElement("td",null,ar(k.output)),React.createElement("td",null,"$",Number(k.cost_usd).toFixed(4))))))),
e.unknownModels.length>0&&React.createElement("div",{className:"usage-cost-fallbacks"},React.createElement("strong",null,
"Fallback pricing"),e.unknownModels.map(k=>React.createElement("span",{key:`${k.provider_id}:${k.model}`},k.model," \u2192 ",
k.fallback))),React.createElement("div",{className:"usage-cost-scan"},"Incremental local JSONL scan \xB7 ",e.scan.files_complete||
0,"/",e.scan.files_total||0," files \xB7 ",e.records," deduplicated records"))}function Jb({usage:e,refreshReceipt:t,resetReceipt:n,
costDetail:s,onBack:a,onRefresh:i,onConsumeResetCredit:c,onRequestCostDetail:u}){let p=React.useMemo(()=>Kc(e),[e]),[b,y]=React.
useState(Date.now());React.useEffect(()=>{p.collectionState==="not-started"&&i(!1);let h=setInterval(()=>y(Date.now()),3e4);
return()=>clearInterval(h)},[i,p.collectionState]);let S=h=>({fresh:"Fresh",refreshing:"Refreshing",stale:"Stale",auth_required:"\
Sign in required",rate_limited:"Refresh limited",unavailable:"Unavailable"})[h]||"Unavailable",A=p.entries.find(h=>h.providerId===
"openai-codex"&&Number(h.resetCredits?.available_count)>0&&h.windows.some(d=>d.usedPercent>=100)),N=["requested","accept\
ed"].includes(n?.status);return React.createElement("div",{className:"usage-dashboard","data-testid":"usage-dashboard"},
React.createElement("div",{className:"automations-header usage-dashboard-header"},React.createElement("button",{className:"\
automations-back",onClick:a,title:"Back to sessions"},"\u2190"),React.createElement("div",{className:"automations-header\
-text"},React.createElement("h2",null,"Usage & limits"),React.createElement("p",null,"Provider-account quotas shared by \
connected harnesses. Warnings start at 75% used.")),React.createElement("button",{type:"button",className:"usage-dashboa\
rd-refresh",onClick:()=>i(!0),disabled:p.inFlight,"aria-label":"Refresh provider usage"},p.inFlight?"Refreshing\u2026":"\
Refresh")),p.collectionState!=="ready"&&React.createElement("div",{className:`usage-dashboard-collection-state ${p.collectionState}`,
role:"status"},React.createElement("strong",null,{"not-started":"Provider usage has not been collected yet",refreshing:"\
Refreshing provider usage",partial:"Some provider usage is unavailable",stale:"Showing last-good provider usage",unavailable:"\
Provider usage is unavailable"}[p.collectionState]||"Provider usage is pending"),React.createElement("span",null,"Genera\
tion ",p.generation,p.generatedAt?` \xB7 ${sr(p.generatedAt,b)}`:"")),React.createElement("div",{className:"usage-dashbo\
ard-summary","aria-label":"Usage summary"},React.createElement("div",null,React.createElement("strong",null,p.summaryAuthoritative?
p.summary.providers:"\u2014"),React.createElement("span",null,"providers")),React.createElement("div",null,React.createElement(
"strong",null,p.summaryAuthoritative?p.summary.accounts:"\u2014"),React.createElement("span",null,"accounts")),React.createElement(
"div",null,React.createElement("strong",null,p.summaryAuthoritative?p.summary.reporting:"\u2014"),React.createElement("s\
pan",null,"reporting")),React.createElement("div",{className:p.summary.nearLimit>0?"warning":""},React.createElement("st\
rong",null,p.summaryAuthoritative?p.summary.nearLimit:"\u2014"),React.createElement("span",null,"near limit")),React.createElement(
"div",{className:p.summary.exhausted>0?"critical":""},React.createElement("strong",null,p.summaryAuthoritative?p.summary.
exhausted:"\u2014"),React.createElement("span",null,"exhausted"))),t&&React.createElement("div",{className:`usage-refres\
h-receipt ${t.status}`,role:"status"},"Refresh ",t.status,t.generation!=null?` \xB7 generation ${t.generation}`:""),A&&React.
createElement("div",{className:"usage-reset-attention",role:"alert","data-testid":"codex-reset-credit-attention"},React.
createElement("span",null,React.createElement("strong",null,A.resetCredits.available_count," limit reset",A.resetCredits.
available_count===1?"":"s"," available \u2014 apply one?"),React.createElement("small",null,"Remote Agent Chat will use \
Codex's native reset action only after this approval.")),React.createElement("button",{type:"button",onClick:c,disabled:N},
N?"Applying\u2026":"Apply one reset")),n&&!["requested"].includes(n.status)&&React.createElement("div",{className:`usage\
-refresh-receipt ${n.status}`,role:"status","data-testid":"codex-reset-credit-receipt"},"Reset ",n.status,n.outcome?`: ${n.
outcome}`:"",n.error?` (${n.error})`:""),React.createElement(Qb,{cost:p.estimatedCost,detailState:s,onRequestDetail:u}),
React.createElement("div",{className:"usage-dashboard-grid"},p.entries.map(h=>{let d=Yc(h.credits),v=Xc(h.financials),g=h.
credits?.resets_at?oa(h.credits.resets_at,b):"";return React.createElement("details",{open:!0,className:`usage-dashboard\
-card ${h.tone}`,key:h.key,"data-provider-id":h.providerId,"data-account-fingerprint":h.accountFingerprint},React.createElement(
"summary",{className:"usage-dashboard-card-summary"},React.createElement(fi,{providerId:h.providerId,providerName:h.providerName}),
React.createElement("span",{className:"usage-dashboard-card-title"},React.createElement("strong",null,h.providerName),React.
createElement("span",null,h.accountLabel,h.plan?` \xB7 ${h.plan}`:"")),React.createElement("span",{className:`usage-dash\
board-status ${h.status}`},S(h.status))),React.createElement("div",{className:"usage-dashboard-card-body"},React.createElement(
"div",{className:"usage-dashboard-card-meta"},React.createElement("span",null,h.sessionCount," mapped session",h.sessionCount===
1?"":"s"),React.createElement("span",null,h.harnessTypes.length>0?h.harnessTypes.join(", "):"No mapped surfaces"),React.
createElement("span",null,sr(h.capturedAt,b)),h.nextRefreshAt&&React.createElement("span",null,"Next refresh ",oa(h.nextRefreshAt,
b))),h.windows.length>0?React.createElement("div",{className:"usage-dashboard-windows"},h.windows.map(_=>{let k=_.tone,T=_.
resetDescription||oa(_.resetsAt,b);return React.createElement("div",{className:`usage-dashboard-window ${k}`,key:_.id},React.
createElement("div",{className:"usage-dashboard-window-heading"},React.createElement("span",null,React.createElement("st\
rong",null,_.label),_.modelScope?.label?React.createElement("small",null,"Model: ",_.modelScope.label):_.scope&&_.scope!==
_.label?React.createElement("small",null,_.scope):null),React.createElement("span",null,React.createElement("strong",null,
_.remainingPercent==null?"Unavailable":`${Dt(_.remainingPercent)} left`),React.createElement("small",null,_.usedPercent==
null?"No reported value":`${Dt(_.usedPercent)} used`))),_.usedPercent!=null&&React.createElement("div",{className:"usage\
-dashboard-meter",role:"progressbar","aria-label":`${h.providerName} ${_.label}`,"aria-valuetext":`${Dt(_.usedPercent)} \
used`,"aria-valuemin":"0","aria-valuemax":"100","aria-valuenow":Math.round(_.visualPercent)},React.createElement("span",
{style:{width:`${_.visualPercent}%`}})),React.createElement("div",{className:"usage-window-thresholds"},"Warning ",Dt(_.
thresholds.warningPercent)," \xB7 Critical ",Dt(_.thresholds.criticalPercent)),_.pace&&React.createElement("div",{className:`\
usage-pace ${_.pace.category}`},React.createElement("div",{className:"usage-pace-heading"},React.createElement("span",{className:"\
usage-pace-category"},_.pace.category),React.createElement("span",null,"Ideal ",Dt(_.pace.expectedUsedPercent)," \xB7 proje\
cted ",Dt(_.pace.projectedUsedPercent))),React.createElement("div",{className:"usage-pace-chart",role:"img","aria-label":`${_.
label} actual ${Dt(_.usedPercent)}, ideal ${Dt(_.pace.expectedUsedPercent)}, projected ${Dt(_.pace.projectedUsedPercent)}`},
React.createElement("span",{className:"usage-pace-actual",style:{width:`${_.visualPercent}%`}}),React.createElement("i",
{className:"usage-pace-ideal",style:{left:`${Math.min(100,_.pace.expectedUsedPercent)}%`}}),React.createElement("i",{className:"\
usage-pace-projected",style:{left:`${Math.min(100,_.pace.projectedUsedPercent)}%`}})),React.createElement("div",{className:"\
usage-pace-budgets"},Object.entries({Now:"now","+1 hour":"next_hour","+5 hours":"next_five_hours",Today:"today"}).map(([
L,H])=>React.createElement("span",{key:H},React.createElement("small",null,L),React.createElement("strong",null,Dt(_.pace.
budgets?.[H]||0))))),React.createElement("div",{className:"usage-pace-outcome"},_.usedPercent>=100?"Quota is exhausted":
_.pace.willLastToReset?"Current pace lasts to reset":`Projected exhaustion ${oa(_.pace.exhaustionAt,b)}`)),T&&React.createElement(
"div",{className:"usage-dashboard-reset"},"Resets ",T),React.createElement("div",{className:"usage-window-provenance"},_.
source||h.source,_.provenance?` \xB7 ${_.provenance}`:""))})):!h.localRuntime&&!h.cloudUsage?React.createElement("div",{
className:"usage-dashboard-unavailable"},h.error?.message||"This provider did not report quota windows."):null,h.cloudUsage&&
h.providerId==="ollama-local"&&(h.cloudUsage.subscriptionState==="active"?React.createElement("div",{className:"usage-da\
shboard-credit-row","data-testid":"ollama-cloud-usage"},React.createElement("span",null,React.createElement("strong",null,
"Ollama Cloud"),h.windows.length," quota window",h.windows.length===1?"":"s",React.createElement("small",null,sr(h.cloudUsage.
capturedAt,b))),React.createElement("span",null,React.createElement("strong",null,"Auto-reload"),h.cloudUsage.autoReloadEnabled==
null?"Not reported":h.cloudUsage.autoReloadEnabled?"On":"Off",React.createElement("small",null,"Extra usage balance is s\
eparate from plan quota"))):h.cloudUsage.subscriptionState==="none"?React.createElement("div",{className:"usage-dashboar\
d-unavailable","data-testid":"ollama-cloud-no-subscription"},React.createElement("strong",null,"No cloud subscription"),
" - local models remain unlimited"):React.createElement("div",{className:"usage-dashboard-unavailable","data-testid":"ol\
lama-cloud-unavailable"},React.createElement("strong",null,"Cloud usage unavailable")," - ",h.cloudUsage.error?.message||
"Open the signed-in Ollama Usage page to expose account quota.")),h.localRuntime&&React.createElement("div",{className:"\
usage-dashboard-credit-row","data-testid":"ollama-local-runtime"},React.createElement("span",null,React.createElement("s\
trong",null,"Local runtime"),h.localRuntime.loadedModelsCount," loaded / ",h.localRuntime.installedModelsCount," install\
ed",React.createElement("small",null,h.localRuntime.endpointScope.replace(/_/g," "))),React.createElement("span",null,React.
createElement("strong",null,"Request telemetry"),h.localRuntime.telemetryStatus.replace(/_/g," "),React.createElement("s\
mall",null,h.localRuntime.telemetryReason))),h.localRuntime?.latestRequest&&React.createElement("div",{className:"usage-\
dashboard-credit-row","data-testid":"ollama-owned-request-metrics"},React.createElement("span",null,React.createElement(
"strong",null,"Latest owned request"),h.localRuntime.latestRequest.model,React.createElement("small",null,h.localRuntime.
latestRequest.surface.replace(/_/g," ")," - ",sr(h.localRuntime.latestRequest.capturedAt,b))),React.createElement("span",
null,React.createElement("strong",null,"Tokens"),h.localRuntime.latestRequest.promptTokens," prompt - ",h.localRuntime.latestRequest.
responseTokens," output",React.createElement("small",null,Hd(h.localRuntime.latestRequest.tokensPerSecond))),React.createElement(
"span",null,React.createElement("strong",null,"Total / load"),Gr(h.localRuntime.latestRequest.totalDurationNs)," / ",Gr(
h.localRuntime.latestRequest.loadDurationNs),React.createElement("small",null,"terminal response metrics")),React.createElement(
"span",null,React.createElement("strong",null,"Prompt / eval"),Gr(h.localRuntime.latestRequest.promptEvalDurationNs)," /\
 ",Gr(h.localRuntime.latestRequest.evalDurationNs),React.createElement("small",null,h.localRuntime.observedRequestCount,
" owned receipt",h.localRuntime.observedRequestCount===1?"":"s"))),v.length>0&&React.createElement("div",{className:"usa\
ge-dashboard-credit-row usage-dashboard-financial-row"},v.map(_=>React.createElement("span",{key:_.id},React.createElement(
"strong",null,_.label),_.value))),(d||h.resetCredits)&&React.createElement("div",{className:"usage-dashboard-credit-row"},
d&&React.createElement("span",null,React.createElement("strong",null,"Credits"),d,g&&React.createElement("small",null,"R\
esets ",g)),h.resetCredits&&React.createElement("span",null,React.createElement("strong",null,"Rate-limit resets"),h.resetCredits.
available_count||0," available")),Array.isArray(h.resetCredits?.details)&&h.resetCredits.details.length>0&&React.createElement(
"div",{className:"usage-dashboard-reset-credits"},h.resetCredits.details.map((_,k)=>React.createElement("span",{key:`${_.
title||"reset"}-${k}`},React.createElement("strong",null,_.title||`Reset credit ${k+1}`),_.status&&React.createElement("\
small",null,_.status),_.expires_at&&React.createElement("small",null,"Expires ",oa(_.expires_at,b))))),h.error?.message&&
h.windows.length>0&&React.createElement("div",{className:"usage-dashboard-stale-error"},"Last refresh: ",h.error.message),
React.createElement("div",{className:"usage-dashboard-source-row"},React.createElement("span",null,"Source: ",h.source?h.
source.replace(/_/g," "):"not available",h.latencyMs!=null?` \xB7 ${h.latencyMs} ms`:""),h.dashboardUrl&&React.createElement(
"a",{href:h.dashboardUrl,target:"_blank",rel:"noreferrer"},"Open provider dashboard"))))}),p.entries.length===0&&React.createElement(
"div",{className:"usage-dashboard-empty"},React.createElement("strong",null,p.collectionState==="ready"?"The completed s\
can found no provider usage.":"Provider usage is not available yet."),React.createElement("span",null,p.collectionState===
"ready"?"Connect a supported Codex, Claude Code, Antigravity, or Cursor session, or start local Ollama, then refresh.":"\
Quota totals remain unknown until a provider collection completes."))))}var ki=640,hl=220,vt=Object.freeze({left:54,right:14,
top:12,bottom:32});function Bs(e){let t=Math.max(.04,Math.min(1,Number(e?.end)-Number(e?.start)||1)),n=Math.max(0,Math.min(
1-t,Number(e?.start)||0));return{start:n,end:n+t}}function Zb(e,t,n,s){let a="",i=!1;return e.forEach(c=>{let u=c[t];if(c.
gap||u==null||!Number.isFinite(u)){i=!1;return}a+=`${i?"L":"M"}${n(c).toFixed(2)},${s(u).toFixed(2)} `,i=!0}),a.trim()}function wi({
title:e,description:t,frames:n,series:s,percentScale:a=!1,viewport:i,onViewportChange:c,crosshairSequence:u,onCrosshairChange:p,
range:b="live",nowMs:y=Date.now(),paused:S=!1,subscriptionStatus:A="live"}){let N=React.useRef(null),h=React.useRef(new Map),
d=React.useRef(null),v=React.useRef(0),[g,_]=React.useState({}),[k,T]=React.useState({mode:"auto",fixedMax:null}),L=ki-vt.
left-vt.right,H=hl-vt.top-vt.bottom,V=tr(n,{nowMs:y,paused:S,connected:A!=="reconnecting",subscriptionStatus:A}),ne=V.frames,
ee=Bs(i),re=er[b]??er.live,z=S&&V.endMs||y,oe=re===1/0?V.startMs||z-er.live:z-re,_e=Math.max(1,z-oe),Y=oe+_e*ee.start,ve=oe+
_e*ee.end,he=ne.filter(D=>Number(D.chart_time_ms)>=Y&&Number(D.chart_time_ms)<=ve),X=s.map(D=>{let se=D.frames?tr(D.frames,
{nowMs:y,paused:!0}).frames:he,ke=D.frames?se.filter(q=>Number(q.chart_time_ms)>=Y&&Number(q.chart_time_ms)<=ve):se;return{
...D,visibleFrames:ke,samples:Od(ke,D.metric,180)}}),me=X.filter(D=>!g[D.key]),J=Math.max(0,...me.flatMap(D=>D.samples.map(
se=>se.max||0))),W=Hc(J,v.current,{percent:a});!a&&k.mode==="auto"&&(v.current=W.maximum);let G=k.mode==="fixed"&&k.fixedMax?
Hc(k.fixedMax,k.fixedMax,{percent:a}):W,$=G.maximum,P=D=>vt.left+Uc(D,Y,ve)*L,B=D=>vt.top+H-Math.max(0,Math.min($,D))/Math.
max(1,$)*H,te=he.find(D=>D.sample_sequence===u)||he.at(-1)||null,ce=te?vt.left+Uc(te,Y,ve)*L:null,ie=s[0]?.format||(D=>String(
D)),be=Dd(Y,ve,typeof window<"u"&&window.innerWidth<=600?4:5),Ne=V.status[0]?.toUpperCase()+V.status.slice(1);function Se(D){
let se=N.current?.getBoundingClientRect();return se?.width?Math.max(0,Math.min(1,(D.clientX-se.left)/se.width)):.5}function Ee(D){
if(!he.length)return 0;let se=Y+(ve-Y)*D;return he.reduce((ke,q)=>Math.abs(Number(q.chart_time_ms)-se)<Math.abs(Number(ke.
chart_time_ms)-se)?q:ke,he[0]).sample_sequence}function xe(D,se=.5){let ke=Bs(i),q=Math.max(.04,Math.min(1,(ke.end-ke.start)*
D)),et=ke.start+(ke.end-ke.start)*se;c(Bs({start:et-q*se,end:et+q*(1-se)}))}React.useEffect(()=>{let D=N.current;if(!D)return;
let se=ke=>{ke.preventDefault(),xe(ke.deltaY>0?1.2:.8,Se(ke))};return D.addEventListener("wheel",se,{passive:!1}),()=>D.
removeEventListener("wheel",se)});function Ie(D){try{D.currentTarget.setPointerCapture?.(D.pointerId)}catch{}if(h.current.
set(D.pointerId,{x:D.clientX,y:D.clientY}),p(Ee(Se(D))),h.current.size===1)d.current={mode:"pan",pointerId:D.pointerId,startX:D.
clientX,viewport:Bs(i)};else if(h.current.size===2){let se=[...h.current.values()];d.current={mode:"pinch",distance:Math.
max(1,Math.abs(se[1].x-se[0].x)),center:(Se({clientX:se[0].x})+Se({clientX:se[1].x}))/2,viewport:Bs(i)}}}function Ke(D){
if(!h.current.has(D.pointerId)){p(Ee(Se(D)));return}h.current.set(D.pointerId,{x:D.clientX,y:D.clientY});let se=d.current;
if(se?.mode==="pinch"&&h.current.size>=2){let ke=[...h.current.values()],q=Math.max(1,Math.abs(ke[1].x-ke[0].x)),et=se.viewport.
end-se.viewport.start,yt=Math.max(.04,Math.min(1,et*se.distance/q)),xt=se.viewport.start+et*se.center;c(Bs({start:xt-yt*
se.center,end:xt+yt*(1-se.center)}));return}if(se?.mode==="pan"&&se.pointerId===D.pointerId){let ke=N.current?.getBoundingClientRect(),
q=se.viewport.end-se.viewport.start,et=ke?.width?-(D.clientX-se.startX)/ke.width*q:0;c(Bs({start:se.viewport.start+et,end:se.
viewport.end+et}))}}function de(D){h.current.delete(D.pointerId);try{D.currentTarget.releasePointerCapture?.(D.pointerId)}catch{}
h.current.size===0&&(d.current=null)}function Ze(D){if(!he.length)return;let se=Math.max(0,he.findIndex(ke=>ke.sample_sequence===
u));if(D.key==="ArrowLeft"||D.key==="ArrowRight")if(D.preventDefault(),D.shiftKey){let q=(ee.end-ee.start)*(D.key==="Arr\
owLeft"?-.1:.1);c(Bs({start:ee.start+q,end:ee.end+q}))}else{let ke=Math.max(0,Math.min(he.length-1,se+(D.key==="ArrowLef\
t"?-1:1)));p(he[ke].sample_sequence)}else D.key==="Home"||D.key==="End"?(D.preventDefault(),p((D.key==="Home"?he[0]:he.at(
-1)).sample_sequence)):D.key==="+"||D.key==="="?(D.preventDefault(),xe(.75)):D.key==="-"&&(D.preventDefault(),xe(1.25))}
return React.createElement("section",{className:"host-resource-chart","aria-label":`${e} chart`},React.createElement("di\
v",{className:"host-resource-chart-heading"},React.createElement("span",null,React.createElement("strong",null,e),React.
createElement("small",null,t)),!a&&React.createElement("button",{type:"button",onClick:()=>T(D=>D.mode==="auto"?{mode:"f\
ixed",fixedMax:W.maximum}:{mode:"auto",fixedMax:null})},k.mode==="auto"?"Auto scale":`Fixed ${ie(k.fixedMax)}`)),React.createElement(
"div",{className:`host-resource-chart-quality ${V.status}`,role:"status"},React.createElement("strong",null,Ne),React.createElement(
"span",null,V.receivedCount," received / ",V.validCount," valid / ",V.expectedCount," expected / ",V.droppedCount," drop\
ped"),React.createElement("span",null,Math.round(V.cadenceMs)," ms cadence"),React.createElement("span",null,V.gapCount,
" gap",V.gapCount===1?"":"s"),React.createElement("span",null,V.duplicateCount," duplicate / ",V.outOfOrderCount," out o\
f order")),React.createElement("div",{className:"host-resource-chart-legend","aria-label":`${e} series`},X.map((D,se)=>React.
createElement("button",{type:"button",key:D.key,"aria-pressed":!g[D.key],onClick:()=>_(ke=>({...ke,[D.key]:!ke[D.key]}))},
React.createElement("i",{className:`marker marker-${se%3}`,style:{"--series-color":D.color}}),D.label))),React.createElement(
"div",{className:"host-resource-chart-canvas",ref:N,role:"group",tabIndex:"0","aria-label":`${e}. Drag to pan, wheel or \
pinch to zoom, arrow keys move the synchronized crosshair, shift plus arrows pan, plus and minus zoom.`,onPointerDown:Ie,
onPointerMove:Ke,onPointerUp:de,onPointerCancel:de,onKeyDown:Ze},React.createElement("svg",{viewBox:`0 0 ${ki} ${hl}`,"a\
ria-hidden":"true"},V.gaps.filter(D=>D.endMs>=Y&&D.startMs<=ve).map((D,se)=>{let ke=vt.left+Math.max(0,(D.startMs-Y)/Math.
max(1,ve-Y))*L,q=vt.left+Math.min(1,(D.endMs-Y)/Math.max(1,ve-Y))*L;return React.createElement("rect",{key:`${D.reason}-${se}`,
className:"host-resource-chart-gap",x:ke,y:vt.top,width:Math.max(2,q-ke),height:H})}),[...G.ticks].reverse().map(D=>{let se=B(
D);return React.createElement(React.Fragment,{key:D},React.createElement("line",{className:"host-resource-chart-grid",x1:vt.
left,x2:ki-vt.right,y1:se,y2:se}),React.createElement("text",{className:"host-resource-chart-y-label",textAnchor:"end",x:vt.
left-7,y:se+4},ie(D)))}),be.map((D,se)=>{let ke=vt.left+D.fraction*L;return React.createElement("text",{key:D.timeMs,className:"\
host-resource-chart-x-label","aria-label":D.accessibleLabel,textAnchor:se===0?"start":se===be.length-1?"end":"middle",x:ke,
y:hl-7},D.label)}),me.flatMap(D=>D.samples.map(se=>se.gap||se.min==null||se.max==null?null:React.createElement("line",{key:`${D.
key}-${se.endSequence}`,className:"host-resource-chart-range",stroke:D.color,x1:P(se),x2:P(se),y1:B(se.min),y2:B(se.max)}))),
me.map((D,se)=>React.createElement("path",{key:D.key,className:`host-resource-chart-line series-${se%3}`,stroke:D.color,
strokeDasharray:D.dashed||se%3===1?"7 4":se%3===2?"2 4":void 0,d:Zb(D.samples,"average",P,B)})),me.flatMap((D,se)=>D.visibleFrames.
length<10?D.visibleFrames.map(ke=>{let q=Ps(ke,D.metric);return q==null?null:React.createElement("circle",{key:`${D.key}\
-point-${ke.sample_sequence}`,className:`host-resource-chart-point marker-${se%3}`,cx:P(ke),cy:B(q),r:"3",stroke:D.color})}):
[]),ce!=null&&React.createElement("line",{className:"host-resource-chart-crosshair",x1:ce,x2:ce,y1:vt.top,y2:vt.top+H})),
te&&React.createElement("div",{className:`host-resource-chart-tooltip ${ce>ki/2?"flip":""}`,role:"status"},React.createElement(
"strong",null,Gc(te.chart_time_ms)," / seq ",te.sample_sequence),React.createElement("span",null,Math.max(0,Math.round((y-
Number(te.chart_time_ms))/1e3)),"s old / ",te.sample_interval_ms||V.cadenceMs," ms / ",Ne," / source ",te.status||"unkno\
wn"),X.map(D=>React.createElement("span",{key:D.key},React.createElement("i",{style:{background:D.color}}),D.label,": ",
D.format(Ps(D.visibleFrames.find(se=>se.sample_sequence===te.sample_sequence),D.metric)))))),React.createElement("div",{
className:"host-resource-chart-stats"},X.filter(D=>!g[D.key]).map(D=>{let se=Fc(D.visibleFrames,D.metric),ke=D.visibleFrames.
find(q=>q.sample_sequence===se.peakSequence);return React.createElement("span",{key:D.key},React.createElement("strong",
null,D.label),React.createElement("span",null,"Latest-good ",D.format(se.current)),React.createElement("span",null,"Min ",
D.format(se.min)),React.createElement("span",null,"Avg ",D.format(se.average)," (",se.averageMethod,")"),React.createElement(
"span",null,"Max ",D.format(se.max)),React.createElement("span",null,se.p95Ready?`p95 ${D.format(se.p95)}`:`p95 collecti\
ng (${se.count}/20)`),React.createElement("small",null,se.count," raw / ",Math.round(se.elapsedMs/1e3),"s / ",se.cadenceMs||
V.cadenceMs," ms cadence / ",Math.max(se.gapCount,V.gapCount)," gaps / ",Ne," / peak ",zc(ke?.captured_at)))})),React.createElement(
"details",{className:"host-resource-chart-data"},React.createElement("summary",null,"Accessible data table"),React.createElement(
"div",null,React.createElement("table",null,React.createElement("caption",null,"Latest ",Math.min(120,he.length)," of ",
he.length," visible samples"),React.createElement("thead",null,React.createElement("tr",null,React.createElement("th",null,
"Time / sequence"),X.map(D=>React.createElement("th",{key:D.key},D.label)))),React.createElement("tbody",null,he.slice(-120).
map(D=>React.createElement("tr",{key:`${D.sample_sequence}:${D.chart_time_ms}`},React.createElement("th",null,Gc(D.chart_time_ms),
" / ",D.sample_sequence,D.gap_before?` / gap: ${D.gap_reason}`:""),X.map(se=>React.createElement("td",{key:se.key},se.format(
Ps(se.visibleFrames.find(ke=>ke.sample_sequence===D.sample_sequence),se.metric)))))))))))}function ev(e,t,n,s,a){let i=t.
trim().toLowerCase(),c=N=>(!i||[N.name,N.agentLabel,N.workspaceLabel,N.pid,N.attributionReason].some(h=>String(h||"").toLowerCase().
includes(i)))&&(n==="all"||N.attributionLevel===n),u=e.filter(c),p=new Set(u.map(N=>N.stableKey)),b=(N,h)=>s==="name"?(N.
agentLabel||N.name).localeCompare(h.agentLabel||h.name)||N.pid-h.pid:s==="memory"?h.memoryBytes-N.memoryBytes||N.pid-h.pid:
s==="read"?h.ioReadBps-N.ioReadBps||N.pid-h.pid:s==="write"?h.ioWriteBps-N.ioWriteBps||N.pid-h.pid:h.cpuHostPercent-N.cpuHostPercent||
N.pid-h.pid,y=new Map;u.forEach(N=>{let h=p.has(N.parentKey)?N.parentKey:"";y.set(h,[...y.get(h)||[],N])});let S=[];function A(N,h){
(y.get(N)||[]).sort(b).forEach(d=>{S.push({process:d,depth:h}),a[d.stableKey]!==!1&&A(d.stableKey,h+1)})}return A("",0),
S}function sm(e,t,n=44,s=16){let a=(Array.isArray(e)?e:[]).map(i=>Ps(i,t)).filter(i=>i!==null);return a.length<2?"":a.map(
(i,c)=>{let u=c/(a.length-1)*n,p=s-Math.max(0,Math.min(100,i))/100*s;return`${c?"L":"M"}${u.toFixed(2)},${p.toFixed(2)}`}).
join(" ")}function tv({connected:e,error:t,history:n,subscription:s,onOpen:a,onRefresh:i,onSubscribe:c,onUnsubscribe:u}){
let p="(min-width: 900px)",[b,y]=React.useState(()=>typeof window<"u"&&typeof window.matchMedia=="function"?window.matchMedia(
p).matches:!1),[S,A]=React.useState(Date.now());React.useEffect(()=>{if(typeof window>"u"||typeof window.matchMedia!="fu\
nction")return;let T=window.matchMedia(p),L=()=>y(T.matches);return L(),typeof T.addEventListener=="function"?T.addEventListener(
"change",L):T.addListener?.(L),()=>{typeof T.removeEventListener=="function"?T.removeEventListener("change",L):T.removeListener?.(
L)}},[]),React.useEffect(()=>{if(b)return c(!0,"global-strip"),()=>u("global-strip")},[b,c,u]),React.useEffect(()=>{if(!b)
return;let T=()=>A(Date.now()),L=setInterval(T,1e3),H=()=>{document.visibilityState==="visible"&&(T(),i(!1))};return document.
addEventListener("visibilitychange",H),()=>{clearInterval(L),document.removeEventListener("visibilitychange",H)}},[b,i]);
let N=React.useMemo(()=>qd(n,{connected:e,error:!!t,nowMs:S,subscriptionStatus:s?.status}),[e,t,n,S,s?.status]);if(!b)return null;
let h=T=>(T==null?"\u2014":String(Math.round(T))).padStart(3,"\u2007"),d=T=>T==="critical"?"!!":T==="warning"?"!":"",v=N.
status==="stale"?`stale ${N.ageSeconds}s`:N.status,g=N.memoryUsedBytes!==null&&N.memoryTotalBytes!==null?`${Dn(N.memoryUsedBytes)}\
 of ${Dn(N.memoryTotalBytes)}`:"memory totals unavailable",_=N.point?`Host CPU ${N.cpuPercent?.toFixed(1)??"unknown"}%; \
memory ${N.memoryPercent?.toFixed(1)??"unknown"}% (${g}); ${v}; sample ${N.sampleSequence}`:`Host resources ${v}`,k=N.point?
`Open Host resources. CPU ${N.cpuPercent?.toFixed(1)??"unknown"} percent, ${N.cpuLevel}. RAM ${N.memoryPercent?.toFixed(
1)??"unknown"} percent, ${N.memoryLevel}. ${v}. Sample ${N.sampleSequence}.`:`Open Host resources. CPU and RAM waiting. ${v}\
.`;return React.createElement("div",{className:"global-desktop-status-rail","data-testid":"global-desktop-status-rail"},
React.createElement("button",{type:"button",className:`global-host-resource-strip ${N.attention}`,"data-testid":"global-\
host-resource-strip","data-status":N.status,"data-cpu-level":N.cpuLevel,"data-memory-level":N.memoryLevel,"data-sample-s\
equence":N.sampleSequence||"","data-sample-captured-at":N.capturedAt||"","data-cpu-percent":N.cpuPercent??"","data-memor\
y-percent":N.memoryPercent??"","data-history-count":N.frames.length,"aria-label":k,title:_,onClick:a},React.createElement(
"span",{className:`global-host-resource-metric ${N.cpuLevel}`},React.createElement("span",{className:"label"},"CPU","\xA0"),
React.createElement("span",{className:"value"},h(N.cpuPercent)),React.createElement("span",{className:"unit"},"%"),React.
createElement("span",{className:"attention-mark"},d(N.cpuLevel))),React.createElement("span",{className:"global-host-res\
ource-divider","aria-hidden":"true"},"\xB7"),React.createElement("span",{className:`global-host-resource-metric ${N.memoryLevel}`},
React.createElement("span",{className:"label"},"RAM","\xA0"),React.createElement("span",{className:"value"},h(N.memoryPercent)),
React.createElement("span",{className:"unit"},"%"),React.createElement("span",{className:"attention-mark"},d(N.memoryLevel))),
React.createElement("svg",{className:"global-host-resource-sparkline",viewBox:"0 0 44 16","aria-hidden":"true"},React.createElement(
"path",{className:"cpu",d:sm(N.frames,"cpu_total_percent")}),React.createElement("path",{className:"memory",d:sm(N.frames,
"memory_used_percent")})),React.createElement("span",{className:"global-host-resource-state"},v)))}function nv({snapshot:e,
error:t,history:n,details:s,subscription:a,onBack:i,onRefresh:c,onSubscribe:u,onUnsubscribe:p}){let b=React.useMemo(()=>Pd(
e),[e]),[y,S]=React.useState(Date.now()),[A,N]=React.useState("live"),[h,d]=React.useState(null),[v,g]=React.useState(null),
[_,k]=React.useState({start:0,end:1}),[T,L]=React.useState(0),[H,V]=React.useState(!1),[ne,ee]=React.useState(""),[re,z]=React.
useState("all"),[oe,_e]=React.useState("cpu"),[Y,ve]=React.useState({}),[he,X]=React.useState("");React.useEffect(()=>(u(
H,"dashboard"),()=>p("dashboard")),[H,u,p]),React.useEffect(()=>{let de=setInterval(()=>S(Date.now()),1e3);return()=>clearInterval(
de)},[]);let me=React.useMemo(()=>h==null?n:n.filter(de=>de.sample_sequence<=h),[n,h]),J=h==null?y:v||y,W=React.useMemo(
()=>Id(me,A,{nowMs:J,paused:h!=null,subscriptionStatus:a?.status,connected:a?.status!=="reconnecting",error:!!t}),[me,A,
J,h,a?.status,t]),G=React.useMemo(()=>tr(me,{nowMs:J,paused:h!=null,subscriptionStatus:a?.status,connected:a?.status!=="\
reconnecting",error:!!t}),[me,J,h,a?.status,t]),$=React.useRef("");React.useEffect(()=>{if(!["delayed","stale"].includes(
G.status)||h!=null){$.current="";return}let de=`${G.status}:${G.points.at(-1)?.sampleSequence||0}`;$.current!==de&&($.current=
de,c(!1))},[G.status,G.points,h,c]),React.useEffect(()=>{!T&&W.length&&L(W.at(-1).sample_sequence)},[T,W]);let P=b.system,
B=P?P.disk.readBps+P.disk.writeBps:0,te=P?P.network.receiveBps+P.network.sendBps:0,ce=React.useMemo(()=>ev(b.processes,ne,
re,oe,Y),[b.processes,ne,re,oe,Y]),ie=b.processes.find(de=>de.stableKey===he)||null,be=b.lastGoodCapturedAt?Wc(b.lastGoodCapturedAt,
y).replace(/^Updated\s+/i,""):"not yet available",Ne=React.useMemo(()=>he?s.flatMap(de=>{let Ze=(de.processes||[]).find(
D=>D.stable_key===he);return Ze?[{frame_kind:"system",sample_sequence:de.sample_sequence,captured_at:de.captured_at,sample_interval_ms:de.
sample_interval_ms,dropped_gap_count:de.dropped_gap_count,status:de.status,cpu:{total_percent:Ze.cpu_host_percent},disk:{
read_bps:Ze.io_read_bps,write_bps:Ze.io_write_bps}}]:[]}):[],[s,he]),Se=de=>de==null?"\u2014":jd(de),Ee=de=>de==null?"\u2014":
jn(de),xe={live:"Live",delayed:"Delayed",reconnecting:"Reconnecting",paused:"Paused",stale:"Stale",waiting:"Waiting",unavailable:"\
Unavailable"}[G.status]||"Unavailable",Ie=[{key:"cpu-total",metric:"cpu_total_percent",label:"Total",color:"#58a6ff",format:Se},
{key:"cpu-user",metric:"cpu_user_percent",label:"User",color:"#3fb950",format:Se},{key:"cpu-kernel",metric:"cpu_privileg\
ed_percent",label:"Kernel",color:"#d29922",format:Se},...Ne.length?[{key:"process-cpu",metric:"cpu_total_percent",label:`${ie?.
agentLabel||ie?.name||"Process"} overlay`,color:"#f778ba",format:Se,frames:Ne,dashed:!0}]:[]],Ke=[{key:"disk-read",metric:"\
disk_read_bps",label:"Read",color:"#58a6ff",format:Ee},{key:"disk-write",metric:"disk_write_bps",label:"Write",color:"#f\
0883e",format:Ee},...Ne.length?[{key:"process-read",metric:"disk_read_bps",label:"Process read overlay",color:"#bc8cff",
format:Ee,frames:Ne,dashed:!0},{key:"process-write",metric:"disk_write_bps",label:"Process write overlay",color:"#f778ba",
format:Ee,frames:Ne,dashed:!0}]:[]];return React.createElement("div",{className:"host-resource-dashboard","data-testid":"\
host-resource-dashboard"},React.createElement("div",{className:"automations-header host-resource-header"},React.createElement(
"button",{className:"automations-back",onClick:i,title:"Back to sessions"},"\u2190"),React.createElement("div",{className:"\
automations-header-text"},React.createElement("h2",null,"Host resources"),React.createElement("p",null,"Live, ephemeral \
Windows metrics. Process commands and executable paths never leave the proxy.")),React.createElement("button",{type:"but\
ton",className:"usage-dashboard-refresh",onClick:()=>c(!0),"aria-label":"Capture host resource detail now"},"Capture det\
ail")),React.createElement("div",{className:"host-resource-meta"},React.createElement("span",{className:`host-resource-s\
tatus ${G.status}`},xe),React.createElement("span",null,H?"Aggregate-only":b.machineLabel||"Windows host"),React.createElement(
"span",null,Wc(b.capturedAt,y)),React.createElement("span",null,G.receivedCount," received / ",G.validCount," valid / ",
G.expectedCount," expected / ",G.droppedCount," dropped / ",G.gapCount," gaps / ",G.duplicateCount," dup / ",G.outOfOrderCount,
" out-of-order"),React.createElement("span",null,Math.round(G.cadenceMs)," ms cadence / seq ",b.sampleSequence||"\u2014")),
React.createElement("div",{className:"host-resource-controls","aria-label":"Host resource timeline controls"},React.createElement(
"div",{className:"host-resource-range",role:"group","aria-label":"Time range"},[["live","Live"],["1m","1m"],["5m","5m"],
["15m","15m"],["since_open","Since open"]].map(([de,Ze])=>React.createElement("button",{key:de,type:"button",className:A===
de?"active":"","aria-pressed":A===de,onClick:()=>{N(de),k({start:0,end:1})}},Ze))),React.createElement("button",{type:"b\
utton",onClick:()=>{h==null?(g(Date.now()),d(n.at(-1)?.sample_sequence||0)):(d(null),g(null))}},h==null?"Pause":"Resume"),
React.createElement("button",{type:"button",disabled:_.start===0&&_.end===1,onClick:()=>k({start:0,end:1})},"Reset zoom"),
React.createElement("label",null,React.createElement("input",{type:"checkbox",checked:H,onChange:de=>{V(de.target.checked),
X("")}})," Aggregate-only privacy"),React.createElement("span",null,W.length," raw samples / ",Math.round(G.elapsedMs/1e3),
"s actual",h==null?"":` / paused at ${h}`)),(t||b.error)&&React.createElement("div",{className:"host-resource-error",role:"\
status"},t?.message||b.error?.message,b.error&&` Last full detail: ${be}.`),P?React.createElement(React.Fragment,null,React.
createElement("div",{className:"host-resource-summary","aria-label":"Host resource summary"},React.createElement("div",null,
React.createElement("strong",null,Math.round(P.cpuPercent),"%"),React.createElement("span",null,"CPU"),React.createElement(
"small",null,P.cpu.logicalCoreCount||"\u2014"," logical / ",P.cpu.physicalCoreCount||"\u2014"," physical cores")),React.
createElement("div",null,React.createElement("strong",null,Math.round(P.memory.usedPercent),"%"),React.createElement("sp\
an",null,"memory"),React.createElement("small",null,Dn(P.memory.usedBytes)," / ",Dn(P.memory.totalBytes),"; commit ",Math.
round(P.memory.commitPercent),"%")),React.createElement("div",null,React.createElement("strong",null,jn(B)),React.createElement(
"span",null,"disk I/O"),React.createElement("small",null,"Read ",jn(P.disk.readBps)," / write ",jn(P.disk.writeBps)," / ",
Math.round(P.disk.busyPercent),"% busy")),React.createElement("div",null,React.createElement("strong",null,jn(te)),React.
createElement("span",null,"network I/O"),React.createElement("small",null,"Receive ",jn(P.network.receiveBps)," / send ",
jn(P.network.sendBps)))),React.createElement("div",{className:"host-resource-charts"},React.createElement(wi,{title:"CPU",
description:"Total outline; User and Kernel component overlays (%)",frames:W,series:Ie,percentScale:!0,viewport:_,onViewportChange:k,
crosshairSequence:T,onCrosshairChange:L,range:A,nowMs:J,paused:h!=null,subscriptionStatus:a?.status}),React.createElement(
wi,{title:"Memory",description:"Physical used and committed (%)",frames:W,series:[{key:"memory-used",metric:"memory_used\
_percent",label:"Physical used",color:"#bc8cff",format:Se},{key:"memory-commit",metric:"memory_commit_percent",label:"Co\
mmitted",color:"#f778ba",format:Se}],percentScale:!0,viewport:_,onViewportChange:k,crosshairSequence:T,onCrosshairChange:L,
range:A,nowMs:J,paused:h!=null,subscriptionStatus:a?.status}),React.createElement(wi,{title:"Disk",description:"Aggregat\
e throughput (IEC bytes/s); isolate unequal series in the legend",frames:W,series:Ke,viewport:_,onViewportChange:k,crosshairSequence:T,
onCrosshairChange:L,range:A,nowMs:J,paused:h!=null,subscriptionStatus:a?.status}),React.createElement(wi,{title:"Network",
description:"Physical-default receive and send (IEC bytes/s)",frames:W,series:[{key:"network-receive",metric:"network_re\
ceive_bps",label:"Receive",color:"#3fb950",format:Ee},{key:"network-send",metric:"network_send_bps",label:"Send",color:"\
#d29922",format:Ee}],viewport:_,onViewportChange:k,crosshairSequence:T,onCrosshairChange:L,range:A,nowMs:J,paused:h!=null,
subscriptionStatus:a?.status})),!H&&React.createElement("section",{className:"host-resource-process-section","aria-label\
ledby":"host-resource-process-heading"},React.createElement("div",{className:"host-resource-process-heading"},React.createElement(
"span",null,React.createElement("strong",{id:"host-resource-process-heading"},"Processes"),React.createElement("small",null,
"Union of owned, top CPU, memory, read, and write. Attribution never implies unproved per-session ownership.")),React.createElement(
"span",null,b.attributedProcesses.length," attributed / ",b.processes.length," shown")),React.createElement("div",{className:"\
host-resource-process-controls"},React.createElement("label",null,"Search ",React.createElement("input",{value:ne,onChange:de=>ee(
de.target.value),placeholder:"Name, PID, agent, workspace"})),React.createElement("label",null,"Attribution ",React.createElement(
"select",{value:re,onChange:de=>z(de.target.value)},React.createElement("option",{value:"all"},"All"),React.createElement(
"option",{value:"owned"},"Owned"),React.createElement("option",{value:"runtime"},"Runtime match"),React.createElement("o\
ption",{value:"workspace-associated"},"Workspace-associated"),React.createElement("option",{value:"unattributed"},"Unatt\
ributed"))),React.createElement("label",null,"Sort ",React.createElement("select",{value:oe,onChange:de=>_e(de.target.value)},
React.createElement("option",{value:"cpu"},"CPU"),React.createElement("option",{value:"memory"},"Memory"),React.createElement(
"option",{value:"read"},"Read"),React.createElement("option",{value:"write"},"Write"),React.createElement("option",{value:"\
name"},"Name")))),ie&&React.createElement("div",{className:"host-resource-process-overlay",role:"region","aria-label":`P\
rocess detail for ${ie.agentLabel||ie.name}`},React.createElement("div",null,React.createElement("strong",null,ie.agentLabel||
ie.name),React.createElement("span",null,ie.name," / PID ",ie.pid," / started ",ie.startTime?zc(ie.startTime):"unknown"),
React.createElement("small",null,ie.attributionLevel,": ",ie.attributionReason,". CPU and disk overlays use the same syn\
chronized timebase.")),React.createElement("button",{type:"button",onClick:()=>X("")},"Remove overlay"),React.createElement(
"dl",null,React.createElement("div",null,React.createElement("dt",null,"Host CPU"),React.createElement("dd",null,ie.cpuHostPercent.
toFixed(1),"%")),React.createElement("div",null,React.createElement("dt",null,"Core equivalent"),React.createElement("dd",
null,ie.cpuCoreEquivalent.toFixed(1),"%")),React.createElement("div",null,React.createElement("dt",null,"Working set"),React.
createElement("dd",null,Dn(ie.memoryBytes))),React.createElement("div",null,React.createElement("dt",null,"Private / com\
mit"),React.createElement("dd",null,Dn(ie.privateBytes)," / ",Dn(ie.commitBytes))),React.createElement("div",null,React.
createElement("dt",null,"Threads / handles"),React.createElement("dd",null,ie.threadCount," / ",ie.handleCount)),React.createElement(
"div",null,React.createElement("dt",null,"I/O operations"),React.createElement("dd",null,"R ",ie.ioReadOps," / W ",ie.ioWriteOps)),
React.createElement("div",null,React.createElement("dt",null,"64-bit byte counters"),React.createElement("dd",null,"R ",
ie.counterTotals.ioReadBytes," / W ",ie.counterTotals.ioWriteBytes)),React.createElement("div",null,React.createElement(
"dt",null,"Detail samples"),React.createElement("dd",null,Ne.length," / 5s cadence")))),React.createElement("div",{className:"\
host-resource-process-scroll"},React.createElement("table",{className:"host-resource-process-table"},React.createElement(
"thead",null,React.createElement("tr",null,React.createElement("th",{scope:"col"},"Agent / process tree"),React.createElement(
"th",{scope:"col"},"Confidence"),React.createElement("th",{scope:"col"},"CPU host / core"),React.createElement("th",{scope:"\
col"},"Memory"),React.createElement("th",{scope:"col"},"Read"),React.createElement("th",{scope:"col"},"Write"))),React.createElement(
"tbody",null,ce.map(({process:de,depth:Ze})=>React.createElement("tr",{key:de.stableKey,className:`${de.attributed?"attr\
ibuted":""} ${he===de.stableKey?"selected":""}`,"data-agent-attributed":de.attributed?"true":"false"},React.createElement(
"td",{style:{"--process-depth":Ze}},de.childCount>0&&React.createElement("button",{className:"host-resource-process-expa\
nd",type:"button","aria-label":`${Y[de.stableKey]===!1?"Expand":"Collapse"} ${de.name}`,"aria-expanded":Y[de.stableKey]!==
!1,onClick:()=>ve(D=>({...D,[de.stableKey]:D[de.stableKey]===!1}))},Y[de.stableKey]===!1?"+":"-"),React.createElement("b\
utton",{className:"host-resource-process-select",type:"button",onClick:()=>X(de.stableKey)},React.createElement("strong",
null,de.agentLabel||de.name),React.createElement("span",null,de.agentLabel?`${de.name} / `:"","PID ",de.pid,de.workspaceLabel?
` / ${de.workspaceLabel}`:"",de.parentKey?" / child process":de.parentPid?` / parent PID ${de.parentPid} outside sample`:
""))),React.createElement("td",{"data-label":"Confidence"},React.createElement("strong",null,de.attributionLevel),React.
createElement("span",{title:de.attributionReason},de.attributionReason)),React.createElement("td",{"data-label":"CPU hos\
t / core"},de.cpuHostPercent.toFixed(1),"% / ",de.cpuCoreEquivalent.toFixed(1),"%"),React.createElement("td",{"data-labe\
l":"Memory"},Dn(de.memoryBytes)),React.createElement("td",{"data-label":"Read"},jn(de.ioReadBps)),React.createElement("t\
d",{"data-label":"Write"},jn(de.ioWriteBps)))))))),React.createElement("div",{className:"host-resource-privacy"},React.createElement(
"strong",null,"Privacy boundary:")," sanitized metrics cross the authenticated relay only to this requester while this v\
iew is open. The relay does not cache, persist, log, or restore them. Process command lines and executable paths remain \
local and are never transmitted. Aggregate-only mode also removes machine, device, adapter, workspace, process, and PID \
labels.")):React.createElement("div",{className:"usage-dashboard-empty host-resource-empty"},React.createElement("strong",
null,"Waiting for the Windows proxy."),React.createElement("span",null,"The subscription is ",a?.status||"starting",". G\
aps remain visible; unavailable samples are not interpolated.")))}function sv(e){let t=Number(e?.percent);if(Number.isFinite(
t))return Math.max(0,Math.min(100,t));let n=Number(e?.completed),s=Number(e?.total);return Number.isInteger(n)&&Number.isInteger(
s)&&s>0?Math.max(0,Math.min(100,n/s*100)):null}function av(e,t){let n=ae(e?.last_snippet).trim();if(n)return n.replace(/\s+/g,
" ").slice(0,180);let s=Array.isArray(t)?t:[];for(let a=s.length-1;a>=0;a-=1){let i=U_(s[a]?.content||no(s[a]?.content_blocks));
if(i)return i.slice(0,180)}return"No recent message reported."}function rv(e,t){if(e?.goal)return _m(e.goal,t,e.goal_run);
let n=Date.parse(e?.startedAt||e?.started_at||e?.since||"");return Number.isFinite(n)?Rl(Math.max(0,(t-n)/1e3),{includeSeconds:!0}):
"live"}function ov(e,t,n=20){let s=e.filter(a=>t[a]?.canReceiveBroadcast).slice(0,n);return s.length===e.length&&s.every(
(a,i)=>a===e[i])?e:s}function iv({sessions:e,activities:t,thinking:n,permissionPrompts:s,errorPrompts:a,messages:i,agentConfigs:c,
sessionAttention:u,health:p,connected:b,deliveryStates:y,onBroadcastSend:S,onBack:A,onSelectSession:N}){let[h,d]=React.useState(
Date.now()),[v,g]=React.useState(!1),[_,k]=React.useState([]),[T,L]=React.useState(""),[H,V]=React.useState(""),[ne,ee]=React.
useState(""),[re,z]=React.useState({});React.useEffect(()=>{let $=setInterval(()=>d(Date.now()),1e3);return()=>clearInterval(
$)},[]);let oe=React.useMemo(()=>(e||[]).map($=>{let P=$e($),te=Object.prototype.hasOwnProperty.call(t,P)?t[P]||{kind:"i\
dle",label:""}:$?.activity||{kind:"idle",label:""},ce=s[P]||(rr(a[P])?a[P]:null),ie=u[P]||null,be=!!ce||$?.rate_limit_active===
!0||["goal_attention","provider_usage_threshold"].includes(ie?.kind),Ne=c[P]||{},Se=$?.agent_type,xe=d_(Se,Ne.capabilities)?
te:{...te,goal:null},Ie=n[P]&&!xe?.kind?{...xe,kind:"thinking"}:xe,Ke=Jo(Ie,be,{connected:b,health:p[P],nowMs:h,requireFreshness:!0}),
de=Ke==="needs_attention",Ze=sa(Ke),D=Zo(xe,{connected:b,health:p[P]}),se=ir($,Ne),ke=m_({agentType:Se,capabilities:Ne.capabilities,
activity:xe,latestUserRequest:$?.last_user_request||p_(i[P]||[])}),q=ke.kind==="goal"&&xe?.goal||null,et=ae(xe?.kind).replace(
/_/g," "),yt=Number($?.percent_used),xt=$?.rate_limited_until&&$.rate_limited_until!=="unknown"?to($.rate_limited_until):
"",Hn=$?.rate_limit_active===!0?`Usage limited${xt?` \xB7 resets ${xt}`:" \xB7 reset unknown"}`:Number.isFinite(yt)&&yt>=
75?`Usage ${Math.round(yt)}% used${xt?` \xB7 resets ${xt}`:""}`:"";return{id:P,session:$,agent:se,activity:xe,attention:de,
working:Ze,state:Ke,goal:q,config:Ne,stateLabel:$?.rate_limit_active===!0?"Usage limited":bd(Ke),title:Zr($,P,Ne,i[P]||[]),
status:ce?ae(ce.title).trim()||"Action required":Hn||D||ae(te?.label).trim()||(Ke==="idle"?q?"Goal paused":"Idle":et||(q?
"Goal active":"Working")),workContext:ke,progress:sv(ke),snippet:av($,i[P]||[]),health:p[P]||"unknown",canReceiveBroadcast:dp(
$,c[P],p[P]||"unknown",b),freshness:kd(te,h),activityLatencyMs:Number.isFinite(Number(te?.transport?.latency_ms))?Math.round(
Number(te.transport.latency_ms)):null}}).filter(Boolean).sort(($,P)=>Number(P.attention)-Number($.attention)||Number(P.working)-
Number($.working)||$.title.localeCompare(P.title)),[e,t,n,s,a,i,c,u,p,b,h]),_e=React.useMemo(()=>oe.filter($=>v||$.state!==
"idle"||$.goal),[oe,v]),Y=oe.filter($=>$.state==="needs_attention").length,ve=oe.filter($=>$.working).length,he=oe.filter(
$=>$.state==="working_goal").length,X=oe.filter($=>$.state==="idle").length,me=React.useMemo(()=>Object.fromEntries(_e.map(
$=>[$.id,$])),[_e]),J=`SEND TO ${_.length} SESSIONS`;React.useEffect(()=>{_.length<=20&&_.every($=>me[$]?.canReceiveBroadcast)||
k($=>ov($,me))},[me,_]),React.useEffect(()=>{Object.keys(re).length!==0&&z($=>{let P=!1,B={};return Object.entries($).forEach(
([te,ce])=>{let ie=y[ce.clientMessageId]||ce.status,be=["offline_queued","busy_queued","steered"].includes(ie)?"queued":
ie,Ne=["queued","accepted","launch_accepted","delivered","agent_started","failed"].includes(be)?be:ce.status;B[te]=Ne===
ce.status?ce:{...ce,status:Ne},B[te]!==ce&&(P=!0)}),P?B:$})},[y]);function W($){ee(""),k(P=>P.includes($)?P.filter(B=>B!==
$):P.length<20?[...P,$]:P)}function G(){let $=pp({session_ids:_,content:T,confirmation:H},te=>!!me[te]?.canReceiveBroadcast);
if(!$.ok){ee($.error);return}let P=mp($.sessionIds),B={};$.sessionIds.forEach(te=>{let ce=S(te,$.content);B[te]={...P[te],
clientMessageId:ce,title:me[te]?.title||te}}),z(B),L(""),V(""),ee("")}return React.createElement("div",{className:"fleet\
-view","data-testid":"fleet-view"},React.createElement("div",{className:"automations-header fleet-view-header"},React.createElement(
"button",{className:"automations-back",onClick:A,title:"Back to sessions"},"\u2190"),React.createElement("div",{className:"\
automations-header-text"},React.createElement("h2",null,"Fleet view"),React.createElement("p",null,"Live monitoring acro\
ss every active harness session."))),React.createElement("div",{className:"fleet-summary","aria-label":"Fleet summary"},
React.createElement("div",null,React.createElement("strong",null,oe.length),React.createElement("span",null,"sessions")),
React.createElement("div",{className:ve?"working":""},React.createElement("strong",null,ve),React.createElement("span",null,
"working")),React.createElement("div",{className:he?"working-goal":""},React.createElement("strong",null,he),React.createElement(
"span",null,"on goal")),React.createElement("div",null,React.createElement("strong",null,X),React.createElement("span",null,
"idle")),React.createElement("div",{className:Y?"attention":""},React.createElement("strong",null,Y),React.createElement(
"span",null,"need attention"))),React.createElement("div",{className:"fleet-filter-row"},React.createElement("span",null,
ve," working now"),React.createElement("button",{type:"button",onClick:()=>g($=>!$),"aria-pressed":v},v?"Hide idle sessi\
ons":`Show ${X} idle session${X===1?"":"s"}`)),React.createElement("section",{className:"fleet-broadcast","data-testid":"\
broadcast-send"},React.createElement("div",{className:"fleet-broadcast-heading"},React.createElement("div",null,React.createElement(
"strong",null,"Broadcast prompt"),React.createElement("span",null,"Select up to ",20," capable sessions.")),React.createElement(
"span",null,_.length," selected")),React.createElement("textarea",{value:T,onChange:$=>L($.target.value),maxLength:65536,
placeholder:"Prompt every selected session...","aria-label":"Broadcast prompt"}),React.createElement("div",{className:"f\
leet-broadcast-confirm"},React.createElement("label",null,React.createElement("span",null,"Type ",React.createElement("s\
trong",null,J)," to confirm"),React.createElement("input",{value:H,onChange:$=>V($.target.value),"aria-label":"Broadcast\
 confirmation"})),React.createElement("button",{type:"button",onClick:G,disabled:!b||_.length===0||!T.trim()||H!==J},"Se\
nd to ",_.length||0)),ne&&React.createElement("div",{className:"fleet-broadcast-error",role:"alert"},ne),Object.keys(re).
length>0&&React.createElement("div",{className:"fleet-broadcast-receipts","aria-label":"Broadcast delivery receipts"},Object.
entries(re).map(([$,P])=>React.createElement("span",{key:$,className:`fleet-broadcast-receipt ${P.status}`,title:P.title},
React.createElement("strong",null,P.title),React.createElement("em",null,P.status.replace(/_/g," ")))))),_e.length===0?React.
createElement("div",{className:"fleet-empty"},React.createElement("strong",null,"Fleet is idle"),React.createElement("sp\
an",null,X," connected session",X===1?" is":"s are"," idle. Show idle sessions to inspect them.")):React.createElement("\
div",{className:"fleet-grid"},_e.map($=>React.createElement("div",{role:"button",tabIndex:0,className:`fleet-card state-${$.
state}${$.attention?" attention":""}${_.includes($.id)?" selected":""}`,key:$.id,"data-session-id":$.id,"data-activity-s\
tate":$.state,"data-activity-lag-ms":$.activityLatencyMs??"",onClick:()=>N($.id,$.session),onKeyDown:P=>{(P.key==="Enter"||
P.key===" ")&&N($.id,$.session)}},React.createElement("span",{className:"fleet-card-top"},React.createElement("span",{className:"\
agent-badge",style:{color:$.agent.color,borderColor:$.agent.color+"55",background:$.agent.color+"18"}},$.agent.logo?React.
createElement("img",{src:$.agent.logo,alt:"",className:"agent-badge-logo"}):$.agent.abbr),React.createElement("span",{className:"\
fleet-card-identity"},React.createElement("strong",null,$.title),React.createElement("span",null,$.agent.name)),React.createElement(
"span",{className:`fleet-health ${$.health}`,title:$.health}),React.createElement("label",{className:`fleet-select${$.canReceiveBroadcast?
"":" unavailable"}`,onClick:P=>P.stopPropagation()},React.createElement("input",{type:"checkbox",checked:_.includes($.id),
disabled:!$.canReceiveBroadcast,onChange:()=>W($.id),"aria-label":`Select ${$.title} for broadcast`}),React.createElement(
"span",null,$.canReceiveBroadcast?"Select":"Unavailable"))),React.createElement("span",{className:"fleet-card-status"},$.
working&&React.createElement(eo,{agentType:$.session?.agent_type,compact:!0,animate:!1}),React.createElement("span",{className:`\
fleet-state-badge ${$.state}`},$.stateLabel),React.createElement("strong",null,$.status),$.working&&React.createElement(
"time",null,rv($.activity,h))),React.createElement("span",{className:"fleet-freshness",title:"Proxy-to-Fleet delivery ti\
me"},"Activity ",$.freshness),$.session?.agent_type==="codex_cli"&&$.config?.config_semantics==="observed_and_next_send"&&
React.createElement("span",{className:"fleet-freshness",title:"Native observation and pending next-send override"},"Obse\
rved ",$.config.observed_model_id||"unknown"," / ",$.config.observed_effort||"unknown"," \xB7 ","Next ",$.config.next_send_model_id||
"unset"," / ",$.config.next_send_effort||"unset"),React.createElement("span",{className:`fleet-work-context kind-${$.workContext.
kind}`,"aria-label":`${$.workContext.label}: ${$.workContext.text}`,"data-work-context-kind":$.workContext.kind,"data-wo\
rk-context-source":$.workContext.source},React.createElement("strong",null,$.workContext.label),React.createElement("spa\
n",null,$.workContext.text),Number.isInteger($.workContext.completed)&&Number.isInteger($.workContext.total)?React.createElement(
"em",null,$.workContext.completed,"/",$.workContext.total):null),($.workContext.kind==="goal"||$.progress!=null)&&React.
createElement("span",{className:`fleet-work-meter kind-${$.workContext.kind}${$.progress==null&&$.working?" indeterminat\
e":""}${$.working?"":" inactive"}`,"aria-label":$.progress==null?`${$.workContext.label} ${$.stateLabel.toLowerCase()}`:
Number.isInteger($.workContext.completed)&&Number.isInteger($.workContext.total)?`${$.workContext.label} ${$.workContext.
completed} of ${$.workContext.total} complete`:`${$.workContext.label} ${Math.round($.progress)}% complete`},React.createElement(
"span",{style:$.progress==null?void 0:{width:`${$.progress}%`}})),React.createElement("span",{className:"fleet-snippet"},
$.snippet),React.createElement("span",{className:"fleet-jump","aria-label":"Open session"},"Open session ",React.createElement(
"span",{className:"fleet-jump-chevron","aria-hidden":"true"},"\u203A"))))))}function cv({onBack:e,onOpenResult:t}){let[n,
s]=React.useState(""),[a,i]=React.useState(""),[c,u]=React.useState(""),[p,b]=React.useState(""),[y,S]=React.useState(""),
[A,N]=React.useState([]),[h,d]=React.useState(!0),[v,g]=React.useState(!1),[_,k]=React.useState("");async function T(L){
if(L?.preventDefault(),!(n.trim().length<2||v)){g(!0),k("");try{let H=new URLSearchParams({q:n.trim(),limit:"50"});a.trim()&&
H.set("project",a.trim()),c.trim()&&H.set("harness",c.trim()),p&&H.set("date_from",p),y&&H.set("date_to",y);let V=await fetch(
`/api/search/messages?${H.toString()}`,{credentials:"same-origin"}),ne=await V.json().catch(()=>({}));if(!V.ok)throw new Error(
ne.error||"Transcript search failed.");N(Array.isArray(ne.results)?ne.results:[]),d(ne.index?.ready!==!1)}catch(H){N([]),
k(H?.message||"Transcript search failed.")}finally{g(!1)}}}return React.createElement("div",{className:"transcript-searc\
h-view","data-testid":"transcript-search-view"},React.createElement("div",{className:"automations-header transcript-sear\
ch-header"},React.createElement("button",{className:"skills-back",onClick:e,title:"Back to sessions"},"\u2190"),React.createElement(
"div",null,React.createElement("h2",null,"Transcript search"),React.createElement("p",null,"Search every relay-backed me\
ssage."))),React.createElement("form",{className:"transcript-search-form",onSubmit:T},React.createElement("label",{className:"\
transcript-search-query"},React.createElement("span",null,"Search text"),React.createElement("input",{value:n,onChange:L=>s(
L.target.value),placeholder:"Words from any conversation",maxLength:200,autoFocus:!0})),React.createElement("div",{className:"\
transcript-search-filters"},React.createElement("label",null,React.createElement("span",null,"Project"),React.createElement(
"input",{value:a,onChange:L=>i(L.target.value),placeholder:"Exact workspace or project",maxLength:300})),React.createElement(
"label",null,React.createElement("span",null,"Harness"),React.createElement("input",{value:c,onChange:L=>u(L.target.value),
placeholder:"e.g. codex_cli",maxLength:80})),React.createElement("label",null,React.createElement("span",null,"From"),React.
createElement("input",{type:"date",value:p,onChange:L=>b(L.target.value)})),React.createElement("label",null,React.createElement(
"span",null,"To"),React.createElement("input",{type:"date",value:y,onChange:L=>S(L.target.value)}))),React.createElement(
"button",{type:"submit",className:"transcript-search-submit",disabled:n.trim().length<2||v},v?"Searching\u2026":"Search \
transcripts")),!h&&React.createElement("div",{className:"transcript-search-indexing"},"Older history is still indexing; \
current results are partial."),_&&React.createElement("div",{className:"transcript-search-error",role:"alert"},_),!v&&!_&&
A.length===0&&n.trim().length>=2&&React.createElement("div",{className:"fleet-empty"},React.createElement("strong",null,
"No matches"),React.createElement("span",null,"Try fewer words or clear a filter.")),React.createElement("div",{className:"\
transcript-search-results","aria-live":"polite"},A.map(L=>React.createElement("button",{type:"button",className:"transcr\
ipt-search-result",key:`${L.session_id}:${L.message_id}`,onClick:()=>t(L)},React.createElement("span",{className:"transc\
ript-search-result-top"},React.createElement("strong",null,L.workspace_name||L.project_root||L.session_id),React.createElement(
"em",null,L.agent_type||"unknown"," \xB7 ",L.role)),React.createElement("span",{className:"transcript-search-snippet"},L.
snippet||"(empty message)"),React.createElement("span",{className:"transcript-search-result-bottom"},React.createElement(
"time",null,L.matched_at?new Date(L.matched_at).toLocaleString():""),React.createElement("span",null,"Open match \u203A"))))))}
function lv({skills:e,onRefresh:t,onBack:n}){let s=e?.installed||[],a=e?.recommended||[],i=s.length===0&&a.length===0;return React.
createElement("div",{className:"skills-view"},React.createElement("div",{className:"skills-header"},React.createElement(
"button",{className:"skills-back",onClick:n,title:"Back to sessions"},"\u2190"),React.createElement("div",{className:"sk\
ills-header-text"},React.createElement("h2",null,"Skills"),React.createElement("p",{className:"skills-subtitle"},"Give C\
odex superpowers.")),React.createElement("button",{className:"skills-refresh-btn",onClick:t,title:"Refresh skills"},"\u21BB")),
i?React.createElement("div",{className:"skills-loading"},"Loading skills\u2026"):React.createElement("div",{className:"s\
kills-body"},s.length>0&&React.createElement("div",{className:"skills-section"},React.createElement("h3",{className:"ski\
lls-section-title"},"Installed"),React.createElement("div",{className:"skills-card-list"},s.map((c,u)=>React.createElement(
"div",{key:c.id||u,className:"skills-card"},React.createElement("div",{className:"skills-card-icon"},c.icon?React.createElement(
"img",{src:c.icon,alt:"",className:"skills-card-img"}):React.createElement("span",{className:"skills-card-placeholder"},
"\u2699")),React.createElement("div",{className:"skills-card-body"},React.createElement("div",{className:"skills-card-na\
me"},c.name),c.description&&React.createElement("div",{className:"skills-card-desc"},c.description)),React.createElement(
"div",{className:"skills-card-action installed"},"\u2713"))))),a.length>0&&React.createElement("div",{className:"skills-\
section"},React.createElement("h3",{className:"skills-section-title"},"Recommended"),React.createElement("div",{className:"\
skills-card-list"},a.map((c,u)=>React.createElement("div",{key:c.id||u,className:"skills-card"},React.createElement("div",
{className:"skills-card-icon"},c.icon?React.createElement("img",{src:c.icon,alt:"",className:"skills-card-img"}):React.createElement(
"span",{className:"skills-card-placeholder"},"\u2699")),React.createElement("div",{className:"skills-card-body"},React.createElement(
"div",{className:"skills-card-name"},c.name),c.description&&React.createElement("div",{className:"skills-card-desc"},c.description)),
React.createElement("div",{className:"skills-card-action available"},"+")))))))}var Sl=class extends React.Component{constructor(t){
super(t),this.state={error:null}}static getDerivedStateFromError(t){return{error:t}}componentDidCatch(t,n){try{console.error(
"Agent Chat render crash",t,n),sessionStorage.setItem("agent-chat:last-render-error",JSON.stringify({message:t?.message||
String(t),stack:t?.stack||"",componentStack:n?.componentStack||"",at:new Date().toISOString()}))}catch{}}render(){return this.
state.error?React.createElement("div",{className:"app-crash"},React.createElement("div",{className:"app-crash-card"},React.
createElement("div",{className:"app-crash-title"},"Agent Chat hit a render error"),React.createElement("div",{className:"\
app-crash-body"},this.state.error?.message||"Unknown UI error"),React.createElement("div",{className:"app-crash-actions"},
React.createElement("button",{className:"app-crash-btn",onClick:()=>location.reload()},"Refresh")))):this.props.children}};
function uv(){let{sessions:e,messages:t,provisionalStreams:n,historyMeta:s,historyLoading:a,connected:i,connectionHealth:c,
unread:u,setUnread:p,thinking:b,thinkingContent:y,activities:S,health:A,deliveryStates:N,launchStates:h,justLaunched:d,setJustLaunched:v,
permissionPrompts:g,respondToPrompt:_,errorPrompts:k,respondToErrorPrompt:T,interruptSession:L,agentConfigs:H,configControlStates:V,
requestAgentConfig:ne,setAgentModel:ee,setAgentEffort:re,setAgentPermissionMode:z,setAutoApprovePermissions:oe,setAntigravityMode:_e,
setCodexConfig:Y,newThread:ve,openPanel:he,openNativeWindow:X,requestChatList:me,switchChat:J,newChat:W,chatLists:G,requestThreadList:$,
switchThread:P,threadLists:B,switchWorkspace:te,requestTerminalOutput:ce,sendTerminalInput:ie,terminalOutputs:be,requestFileChanges:Ne,
respondToFileChange:Se,fileChanges:Ee,sendAttachment:xe,send:Ie,sendToSession:Ke,steerMessage:de,discardQueuedMessage:Ze,
editQueuedMessage:D,queuedMessages:se,scheduledSends:ke,scheduleSend:q,cancelScheduledSend:et,launchSession:yt,resumeSession:xt,
closeSession:Hn,activeSessionRef:ds,restoreCachedTranscript:Ri,setSessionSubscriptions:lr,workspaces:Mi,branchLists:so,requestBranchList:Ti,
switchBranch:ao,createBranch:$i,skillLists:ur,requestSkillList:ro,automationViews:oo,showCodexAutomation:Ei,controlResults:pa,
directoryListings:Li,requestDirectoryListing:ma,fileContents:dr,requestFileContent:Un,requestHistory:io,requestHistoryChunk:qt,
duplicateProxyAlarms:Wn,nightlyValidationFailures:Sn,latestAppUpdateValidation:pr,providerUsage:zn,providerUsageRefreshReceipt:Pi,
requestProviderUsageRefresh:ps,providerUsageResetReceipt:qi,consumeProviderUsageResetCredit:Fs,providerUsageCostDetail:Oi,
requestProviderUsageCostDetail:Hs,hostResources:Ii,hostResourceError:mr,hostResourceHistory:sn,hostResourceDetails:ms,hostResourceSubscription:At,
subscribeHostResources:fs,unsubscribeHostResources:fr,requestHostResourceRefresh:ot,semanticNotifications:gs}=Qd(),[f,nt]=ue(
null),fa=React.useCallback(o=>md(f,o),[f]),gr=React.useCallback(()=>pd(f),[f]),co=React.useSyncExternalStore(fa,gr,gr),[
Gn,Us]=ue({}),[an,Cn]=ue({}),[lo,ft]=ue(!1),[ga,Kn]=ue(""),[Ws,ha]=ue(""),[Rt,zs]=ue(null),[uo,rn]=ue({}),[Vn,hs]=ue(xb),
[it,Ve]=ue(!1),gt=Me(null),Gs=Me({}),_a=Me(!1),[on,cn]=ue(!1),[ct,Ot]=ue(!1),[Bt,kt]=ue(!1),[st,ze]=ue(!1),[ba,wt]=ue(!1),
[va,Yn]=ue(!1),[Mt,ln]=ue(""),[tt,po]=ue({}),[mo,ya]=ue(!1),[Di,fo]=ue(""),[go,ka]=ue(!1),[we,_s]=ue(!1),[Xn,Ks]=ue(!1),
[hr,Qn]=ue(""),[Tt,Ft]=ue(0),[Jn,bs]=ue(!1),[ho,_o]=ue({}),[Zn,wa]=ue(null),un=Me({sessionId:null,expiresAt:0}),dn=Me(null),
[xn,lt]=ue(!1),[An,Rn]=ue(0),[pn,Ge]=ue(!1),[mn,Ht]=ue(!0),[Vs,Ys]=ue({}),[ht,fn]=ue(!1),[Mn,es]=ue({}),[Tn,vs]=ue({}),[
ys,ts]=ue({}),[_r,Na]=ue(!1),[Ut,ks]=ue(!1),[br,Sa]=ue(!1),[gn,It]=ue(!1),[ws,$n]=ue(!1),[Ns,Wt]=ue(!1),[ns,hn]=ue(!1),[
Ss,zt]=ue(!1),[Cs,En]=ue(!1),[Ye,vr]=ue(null),[Gt,yr]=ue(!1),[ji,bo]=ue("."),[Ca,Xs]=ue(null),[xa,kr]=ue(null),wr=Me(null),
[Bi,vo]=ue(0),Nr=Me(null),[Aa,Fi]=ue(()=>{try{return localStorage.getItem("remote-agent-chat-theme")||"dark"}catch{return"\
dark"}}),[_n,Hi]=ue(()=>{try{let o=JSON.parse(localStorage.getItem("remote-agent-chat:collapsed-directories:v1")||"[]");
return Array.isArray(o)?Object.fromEntries(o.map(w=>[String(w),!0])):{}}catch{return{}}}),[bn,Ui]=ue(()=>{try{return localStorage.
getItem(Lp)==="1"}catch{return!1}});Te(()=>{try{localStorage.setItem(Lp,bn?"1":"0")}catch{}},[bn]);let[xs]=ue(()=>{try{let o=JSON.
parse(localStorage.getItem(Zc)||"{}");return di(o)}catch{return di(li)}});Te(()=>{try{localStorage.setItem(Zc,JSON.stringify(
xs))}catch{}},[xs]),Te(()=>{fetch("/api/preferences/sessions",{credentials:"same-origin"}).then(o=>o.ok?o.json():Promise.
reject(new Error("Session settings unavailable"))).then(o=>{po(o.preferences||{}),ya(!0)}).catch(()=>{})},[]),Te(()=>{let o=!0;
return fetch("/api/preferences/notifications",{credentials:"same-origin"}).then(w=>w.ok?w.json():Promise.reject(new Error(
"Notification settings unavailable"))).then(w=>{o&&(hs({...Ll,...w.preferences||{},turn_ready:!1}),Ve(!0))}).catch(()=>{}),
()=>{o=!1}},[]),Te(()=>{if(!Vn.completion_sound)return;let o=()=>Pl();return document.addEventListener("pointerdown",o,{
once:!0}),document.addEventListener("keydown",o,{once:!0}),()=>{document.removeEventListener("pointerdown",o),document.removeEventListener(
"keydown",o)}},[Vn.completion_sound]);async function yo(o,w){let M=await fetch(`/api/preferences/sessions/${encodeURIComponent(
o)}`,{method:"PUT",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({preference:w})}),
R=await M.json().catch(()=>({}));if(!M.ok)throw new Error(R.error||"Unable to save session settings.");return po(U=>({...U,
[o]:R.preference})),R.preference?.archived&&f===o&&nt(null),R.preference}async function Wi(o,w){let M=await fetch(`/api/\
sessions/${encodeURIComponent(o)}/export?format=${encodeURIComponent(w)}`,{credentials:"same-origin"});if(!M.ok){let Qe=await M.
json().catch(()=>({}));throw new Error(Qe.error||"Unable to export session.")}let U=(M.headers.get("Content-Disposition")||
"").match(/filename\*=UTF-8''([^;]+)/i)?.[1],Q=`session.${w==="json"?"json":"md"}`;if(U)try{Q=decodeURIComponent(U)}catch{}
let le=URL.createObjectURL(await M.blob()),ye=document.createElement("a");ye.href=le,ye.download=Q,ye.hidden=!0,document.
body.appendChild(ye),ye.click(),ye.remove(),setTimeout(()=>URL.revokeObjectURL(le),1e3)}Te(()=>{try{let o=Object.keys(_n).
filter(w=>_n[w]);localStorage.setItem("remote-agent-chat:collapsed-directories:v1",JSON.stringify(o))}catch{}},[_n]);let ko=React.
useCallback(o=>{Hi(w=>({...w,[o]:!w[o]}))},[]),wo=Me(de);Te(()=>{wo.current=de},[de]);let No=React.useCallback((o,w)=>{f&&
wo.current(f,o,w)},[f]),So=Me(Ke);Te(()=>{So.current=Ke},[Ke]);let Co=React.useCallback(o=>{!f||!o?._cid||So.current(f,o.
content,o._cid)},[f]),xo=Me(Un);Te(()=>{xo.current=Un},[Un]);let ss=React.useMemo(()=>[...e||[]].map(o=>{let w=$e(o),M=tt[w];
return M?.display_name?typeof o=="object"?{...o,custom_display_name:M.display_name}:{session_id:w,custom_display_name:M.
display_name}:o}),[e,tt]),Kt=React.useMemo(()=>new Set(ss.filter(el).map($e)),[ss]),Sr=React.useMemo(()=>ss.filter(o=>!el(
o)),[ss]),Ra=bn?ss:Sr,Oe=React.useMemo(()=>Ra.filter(o=>!tt[$e(o)]?.archived),[Ra,tt]),Ao=React.useMemo(()=>Sr.filter(o=>!tt[$e(
o)]?.archived),[Sr,tt]),r=tb(S,Oe),m=React.useMemo(()=>({activities:S,thinking:b,pendingPrompts:g,errorPrompts:Object.fromEntries(
Object.entries(k||{}).filter(([,o])=>rr(o))),health:A,connected:i,nowMs:r,requireFreshness:!0}),[S,b,g,k,A,i,r]),{working:C,
states:O}=React.useMemo(()=>sp(Oe,m),[Oe,m]),l=Me(null),x=Me(null),E=Me(null),[F,Z]=ue(!1),K=React.useCallback(()=>{E.current&&
clearTimeout(E.current),E.current=null,Z(!0)},[]),ge=React.useCallback((o=0)=>{E.current&&clearTimeout(E.current),E.current=
setTimeout(()=>{E.current=null,Z(!1)},o)},[]);React.useEffect(()=>{let o=()=>ge(80);return window.addEventListener("poin\
terup",o,!0),window.addEventListener("pointercancel",o,!0),()=>{window.removeEventListener("pointerup",o,!0),window.removeEventListener(
"pointercancel",o,!0),E.current&&clearTimeout(E.current)}},[ge]);let{sessions:pe,revision:De}=eb(C,F),He=React.useMemo(()=>new Set(
pe.map($e)),[pe]),{pinned:We}=React.useMemo(()=>Zd(Oe,tt),[Oe,tt]),Nt=React.useMemo(()=>new Set(We.map($e)),[We]),Ce=React.
useMemo(()=>$d(Oe,{workingSessionIds:He,pinnedSessionIds:Nt}),[Oe,He,Nt]),Le=Ce.recent,$t=React.useMemo(()=>new Set(Le.map(
$e)),[Le]),vn=Ce.pinned,Nm=React.useMemo(()=>nl(Ce.remaining,H,xs),[Ce.remaining,H,xs]),Ma=React.useMemo(()=>Object.fromEntries(
nl(Oe,H,xs).flatMap(o=>o.sessions.map(w=>[$e(w),o.label]))),[Oe,H,xs]),Sm=React.useMemo(()=>({...m,messages:t,rankWorking:!1}),
[m,t]),{groups:ql,orderChanged:Ro,sortNow:Ol,revision:Cm}=X_(Nm,Sm,F),as=React.useMemo(()=>ql.filter(o=>o.sessions.length>
0),[ql]),xm=React.useMemo(()=>new Set(as.flatMap(o=>o.sessions.map($e))),[as]),Am=React.useCallback(()=>{let o=l.current,
w=f?o?.querySelector(`[data-session-id="${CSS.escape(f)}"]`):null;x.current=w?{sessionId:f,top:w.getBoundingClientRect().
top}:null,Ol()},[f,Ol]),ut=ga.trim().toLowerCase(),Il=React.useMemo(()=>Object.fromEntries(Oe.map(o=>{let w=$e(o),M=ir(o,
H[w]);return[w,[Zr(o,w,H[w],t[w]||[]),or(o,w,H[w]),Ma[w]||"Unscoped",tt[w]?.pinned?"Pinned":"",M.name,o?.agent_type,o?.workspace_name,
o?.workspace_path,w].filter(Boolean).join(" ").toLowerCase()]})),[Oe,H,t,Ma,tt]),As=React.useCallback(o=>ut?o.filter(w=>(Il[$e(
w)]||"").includes(ut)):o,[ut,Il]),Ta=React.useMemo(()=>As(pe),[As,pe]),$a=React.useMemo(()=>As(Le),[As,Le]),Ea=React.useMemo(
()=>As(vn),[As,vn]),Dl=React.useMemo(()=>as.map(o=>({...o,sessions:As(o.sessions)})).filter(o=>o.sessions.length>0),[As,
as]),jl=React.useMemo(()=>[...pe,...Le,...vn,...as.flatMap(o=>o.sessions)],[pe,Le,vn,as]),zi=React.useMemo(()=>{let o=new Set;
return Oe.filter(w=>{let M=$e(w);return!M||o.has(M)?!1:(o.add(M),!0)})},[Oe]),Rm=React.useMemo(()=>new Set(zi.map($e)),[
zi]),Mm=React.useMemo(()=>[`working:${pe.map($e).sort().join(",")}`,`recent:${Le.map($e).sort().join(",")}`,`pinned:${vn.
map($e).sort().join(",")}`,...as.map(o=>`${o.key}:${o.sessions.map($e).sort().join(",")}`).sort()].join("|"),[pe,Le,vn,as]),
Rs=Me(new Map),Mo=Me(null),Qs=Me(null);us(()=>{let o=l.current;if(!o)return;let w=Qs.current||document.activeElement,M=w instanceof
Element?w.closest("[data-sidebar-card-host]"):null,R=new Set;for(let U of o.querySelectorAll("[data-sidebar-card-slot]")){
let Q=U.getAttribute("data-sidebar-card-slot")||"",le=Rs.current.get(Q);if(!(!Q||!le)&&(R.add(Q),le.parentElement!==U)){
let ye=M===le&&w?.isConnected;U.appendChild(le),ye&&document.activeElement!==w&&w.isConnected&&w.focus({preventScroll:!0})}}
Qs.current=null;for(let[U,Q]of Rs.current)R.has(U)||Rm.has(U)||(Q.remove(),Rs.current.delete(U));return()=>{let U=document.
activeElement,Q=U instanceof Element?U.closest("[data-sidebar-card-host]"):null;Qs.current=Q?U:null;let le=Mo.current;le||
(le=document.createElement("div"),le.setAttribute("data-sidebar-card-pool",""),Object.assign(le.style,{position:"fixed",
left:"-10000px",top:"-10000px",width:"1px",height:"1px",overflow:"hidden",pointerEvents:"none"}),document.body.appendChild(
le),Mo.current=le);for(let ye of Rs.current.values())le.appendChild(ye);Qs.current?.isConnected&&document.activeElement!==
Qs.current&&Qs.current.focus({preventScroll:!0})}},[Mm]),Te(()=>()=>{for(let o of Rs.current.values())o.remove();Rs.current.
clear(),Mo.current?.remove(),Mo.current=null,Qs.current=null},[]);let Js=React.useCallback(o=>o.reduce((w,M)=>{let R=$e(
M);return w.unread+=Kt.has(R)?0:u[R]||0,w.hasPrompt=w.hasPrompt||!!g[R]||!!rr(k[R]),w.working=w.working||sa(O[R]),w},{unread:0,
hasPrompt:!1,working:!1}),[Kt,u,g,k,O]),Cr=React.useMemo(()=>Js(Ta),[Js,Ta]),La=React.useMemo(()=>Js($a),[Js,$a]),Pa=React.
useMemo(()=>Js(Ea),[Js,Ea]),rs=React.useMemo(()=>jl.map(o=>{let w=$e(o),M=ir(o,H[w]),R=Zr(o,w,H[w],t[w]||[]),U=or(o,w,H[w]),
Q=Ma[w]||"Unscoped",le=[R,U,Q,tt[w]?.pinned?"Pinned":"",M.name,o?.agent_type,o?.workspace_name,o?.workspace_path,w].filter(
Boolean);return{id:w,session:o,groupLabel:Q,title:R,subtitle:U,agentName:M.name,agentColor:M.color,working:sa(O[w]),searchFields:le,
searchText:le.join(" ")}}),[jl,Ma,tt,H,t,O]),St=React.useMemo(()=>V_(rs,hr).slice(0,60),[rs,hr]);Te(()=>{Ft(o=>Math.max(
0,Math.min(o,St.length-1)))},[St.length]),Te(()=>{if(!Xn)return;let o=requestAnimationFrame(()=>{Nr.current?.focus(),Nr.
current?.select()});return()=>cancelAnimationFrame(o)},[Xn]),Te(()=>{Xn&&document.getElementById(`quick-switcher-option-${Tt}`)?.
scrollIntoView({block:"nearest"})},[Tt,Xn]),Te(()=>{let o=()=>{Ks(!1),Qn(""),Ft(0),requestAnimationFrame(()=>Pn.current?.
focus())},w=R=>{R&&(qn(R.id,R.session),ft(!1),o())},M=R=>{let U=ae(R.key).toLowerCase();if((R.metaKey||R.ctrlKey)&&!R.altKey&&
U==="p"){R.preventDefault(),bs(!1),Ks(!0);return}if(Xn){R.key==="Escape"?(R.preventDefault(),o()):R.key==="ArrowDown"?(R.
preventDefault(),Ft(Q=>St.length?(Q+1)%St.length:0)):R.key==="ArrowUp"?(R.preventDefault(),Ft(Q=>St.length?(Q-1+St.length)%
St.length:0)):R.key==="Enter"&&St.length>0&&(R.preventDefault(),w(St[Tt]||St[0]));return}if(Jn){(R.key==="Escape"||R.key===
"?"&&!vl(R.target))&&(R.preventDefault(),bs(!1),requestAnimationFrame(()=>Pn.current?.focus()));return}if(R.altKey&&!R.ctrlKey&&
!R.metaKey&&(R.key==="ArrowUp"||R.key==="ArrowDown")){if(rs.length===0)return;R.preventDefault();let Q=rs.findIndex(je=>je.
id===f),le=R.key==="ArrowDown"?1:-1,ye=le>0?-1:0,Qe=(Math.max(Q,ye)+le+rs.length)%rs.length;w(rs[Qe]);return}R.key==="?"&&
!R.altKey&&!R.ctrlKey&&!R.metaKey&&!vl(R.target)&&(R.preventDefault(),bs(!0))};return window.addEventListener("keydown",
M),()=>window.removeEventListener("keydown",M)},[f,Tt,rs,Xn,St,Jn]);let To=Me(null);us(()=>{let o=l.current;if(!o){To.current=
null;return}let w=x.current,M=!1;if(w?.sessionId){let Q=Array.from(o.querySelectorAll("[data-session-id]")).find(le=>le.
dataset.sessionId===w.sessionId);if(Q){let le=Q.getBoundingClientRect().top-w.top;Math.abs(le)>.5&&(o.scrollTop+=le),M=!0}
x.current=null}let R=()=>{let Q=To.current;if(!Q?.sessionId)return;let le=Array.from(o.querySelectorAll("[data-session-i\
d]")).find(Qe=>Qe.dataset.sessionId===Q.sessionId);if(!le)return;let ye=le.getBoundingClientRect().top-Q.top;if(Math.abs(
ye)>.5&&(o.scrollTop+=ye),Q.menuOpen){let Qe=le.querySelector("details.session-card-menu");Qe&&(Qe.open=!0)}Q.focusTitle&&
!o.contains(document.activeElement)&&Array.from(le.querySelectorAll("button, [tabindex]")).find(je=>je.getAttribute("tit\
le")===Q.focusTitle)?.focus({preventScroll:!0})},U=()=>{let Q=o.getBoundingClientRect(),le=Array.from(o.querySelectorAll(
"[data-session-id]")),ye=document.activeElement?.closest?.("[data-session-id]"),Qe=le.find(Jt=>{let $s=Jt.getBoundingClientRect();
return $s.bottom>Q.top&&$s.top<Q.bottom}),je=ye||Qe||le[0];return je?{sessionId:je.dataset.sessionId,top:je.getBoundingClientRect().
top,focusTitle:ye&&document.activeElement?.getAttribute?.("title")||null,menuOpen:!!je.querySelector("details.session-ca\
rd-menu[open]")}:null};return M||R(),To.current=U(),()=>{To.current=U()}},[f,De,Cm]);let I=React.useMemo(()=>Oe.find(o=>$e(
o)===f),[Oe,f]),Ln=f?co:Pp,dt=f&&n[f]||null,Bl=Xd(I,Ln),$o=f?S[f]:null,Fl=f&&y[f]||"",Gi=f&&g[f]||null,Ki=f&&k[f]||null,
Hl=React.useMemo(()=>{let o=$o&&typeof $o=="object"?$o:null,w=o?.goal||null,M=Array.isArray(o?.task_list?.tasks)?o.task_list.
tasks.map(R=>`${R.state||""}:${R.text||R.title||R.label||""}`).join("|"):"";return[Fl,o?.kind||"",o?.label||"",o?.updatedAt||
"",o?.startedAt||"",o?.interruptHint||"",o?.thinkingContent||"",w?.status||"",w?.label||"",w?.objective||"",w?.time_used_seconds??
w?.timeUsedSeconds??"",w?.updated_at||"",M,Gi?.id||Gi?.request_id||"",Ki?.id||Ki?.request_id||"",dt?.messageId||"",dt?.content?.
length||0,dt?.open?"open":"closed"].join("")},[$o,Fl,Gi,Ki,dt]),Eo={sessionId:f,messageCount:Ln.length,provisionalId:dt?.
messageId||"",provisionalLength:dt?.content?.length||0},Tm=Me(null),Vt=Me(null),Lo=Me(!0),Yt=Me(!0),Ul=Me(0),qa=Me(0),xr=Me(
0),Ar=Me(0),Vi=Me(null),Yi=Me(null),Wl=Me(""),zl=Me(f),Rr=Me({sessionId:null,keys:[],scrollTop:0,scrollHeight:0,clientHeight:0,
atBottom:!0}),Xi=Me(null),Mr=Me(0),Pn=Me(null),$m=Me(null),Qi=Me(Eo),Ji=Me(Eo),Tr=Me({}),Oa=Me({sessionId:null,index:0,scratch:""}),
Zi=Me(i),ec=Me({}),Gl=Me({});Qi.current=Eo,us(()=>{zl.current=f},[f]),Te(()=>{let o=M=>{try{sessionStorage.setItem("agen\
t-chat:last-window-error",JSON.stringify({message:M?.error?.message||M?.message||"Unknown window error",stack:M?.error?.
stack||"",at:new Date().toISOString()}))}catch{}},w=M=>{try{let R=M?.reason;sessionStorage.setItem("agent-chat:last-prom\
ise-error",JSON.stringify({message:R?.message||ae(R,"Unhandled promise rejection"),stack:R?.stack||"",at:new Date().toISOString()}))}catch{}};
return window.addEventListener("error",o),window.addEventListener("unhandledrejection",w),()=>{window.removeEventListener(
"error",o),window.removeEventListener("unhandledrejection",w)}},[]),Te(()=>{try{let o=localStorage.getItem(Ep);o&&Us(JSON.
parse(o))}catch{}},[]),Te(()=>{try{localStorage.setItem(Ep,JSON.stringify(Gn))}catch{}},[Gn]),Te(()=>{try{localStorage.setItem(
"remote-agent-chat-theme",Aa)}catch{}document.documentElement.setAttribute("data-theme",Aa)},[Aa]),Te(()=>{if(!f&&Oe.length>
0){let o=new URLSearchParams(window.location.search).get("session"),w=o?Oe.find(U=>$e(U)===o):null,M=w||Oe[0],R=$e(M);R&&
(qn(R,M),w&&window.history.replaceState({},"",window.location.pathname))}},[Oe,f]),Te(()=>{if(!("serviceWorker"in navigator))
return;let o=w=>{if(w.data?.type!=="push_notification_clicked")return;let M=w.data.data?.session_id,R=Oe.find(U=>$e(U)===
M);M&&R&&qn(M,R)};return navigator.serviceWorker.addEventListener("message",o),()=>navigator.serviceWorker.removeEventListener(
"message",o)},[Oe]),Te(()=>{if(!d)return;let o=Oe.find(w=>(typeof w=="string"?w:w?.session_id)===d);o&&(qn(d,o),v(null))},
[d,Oe]),Te(()=>{let o=Vt.current;if(!o)return;let w=null,M=()=>{Ul.current=Date.now()+1200,qa.current=0,xr.current+=1,Yt.
current&&(Ji.current=Qi.current,Rn(0))},R=je=>{je.deltaY<-1&&M()},U=je=>{let Jt=o.getBoundingClientRect();je.clientX>=Jt.
right-16&&M()},Q=je=>{w=je.touches?.[0]?.clientY??null},le=je=>{let Jt=je.touches?.[0]?.clientY??null;w!=null&&Jt!=null&&
Jt-w>4&&M()},ye=je=>{["ArrowUp","PageUp","Home"].includes(je.key)&&M()},Qe=()=>{let je=o.scrollHeight-o.scrollTop-o.clientHeight<
80,Jt=Date.now(),$s=Jt<Ul.current,Dr=Jt<qa.current;Lo.current=je,je?Yt.current=!0:$s&&!Dr&&(Yt.current=!1,Ar.current=0),
$s&&!Dr&&o.scrollTop<160&&Vi.current?.(),lt(!je&&!Yt.current),Rr.current={...Rr.current,scrollTop:o.scrollTop,scrollHeight:o.
scrollHeight,clientHeight:o.clientHeight,atBottom:je||Yt.current}};return o.addEventListener("scroll",Qe,{passive:!0}),o.
addEventListener("wheel",R,{passive:!0}),o.addEventListener("touchstart",Q,{passive:!0}),o.addEventListener("touchmove",
le,{passive:!0}),o.addEventListener("pointerdown",U,{passive:!0}),window.addEventListener("keydown",ye),()=>{o.removeEventListener(
"scroll",Qe),o.removeEventListener("wheel",R),o.removeEventListener("touchstart",Q),o.removeEventListener("touchmove",le),
o.removeEventListener("pointerdown",U),window.removeEventListener("keydown",ye)}},[f]);function Po(o,w=2){let M=f,R=xr.current+
1;xr.current=R;let U=()=>{let ye=Vt.current;return!ye||zl.current!==M||xr.current!==R?!1:(qa.current=Date.now()+800,Yt.current=
!0,Ji.current=Qi.current,nn(ye,ye.scrollHeight),Lo.current=!0,lt(!1),Rn(0),Rr.current={sessionId:M,keys:o,scrollTop:ye.scrollTop,
scrollHeight:ye.scrollHeight,clientHeight:ye.clientHeight,atBottom:!0},!0)};U();let Q=Math.max(0,w),le=()=>{Q<=0||(Q-=1,
U()&&requestAnimationFrame(le))};Q>0&&requestAnimationFrame(le)}function Em(){if(!Vt.current)return;let w=ul(Ln);Ar.current=
Date.now()+5e3,Po(w,4)}us(()=>{let o=Vt.current;if(!o)return;let w=ul(Ln),M=Rr.current||{},R=M.sessionId===f,U=Array.isArray(
M.keys)?M.keys:[],Q=U[0]||null,le=U[U.length-1]||null,ye=Q?w.indexOf(Q):-1,Qe=le?w.indexOf(le):-1,je=!!(R&&w.length===U.
length&&w.every((kc,jr)=>kc===U[jr])),Jt=(Number(M.scrollHeight)||0)-(Number(M.scrollTop)||0)-(Number(M.clientHeight)||0),
$s=Date.now()<Ar.current,Dr=$s||Yt.current||M.atBottom!==!1||Jt<120,df=!!(R&&U.length&&ye>0&&Qe>=ye);if(!(je&&!$s&&!Dr))
if(!R)kr(null),Po(w,3);else if(df){if(Yt.current=!1,Ar.current=0,o.dataset.transcriptWindowed!=="true"){let kc=o.scrollHeight-
(Number(M.scrollHeight)||0);qa.current=Date.now()+500,nn(o,Math.max(0,(Number(M.scrollTop)||0)+kc));let jr=Yi.current,xu=jr?
Array.from(o.querySelectorAll(".message[data-message-key]")).find(Au=>Au.dataset.messageKey===jr.messageKey):null;if(xu){
let Ru=xu.getBoundingClientRect().top-o.getBoundingClientRect().top-jr.viewportOffset;Math.abs(Ru)>=.5&&nn(o,Math.max(0,
o.scrollTop+Ru))}Yi.current=null}}else Dr&&Po(w,3);let Uo=o.scrollHeight-o.scrollTop-o.clientHeight<80;Lo.current=Uo,lt(
!Uo&&!Yt.current),Rn(Uo||Yt.current?0:Y_(Ji.current,Eo)),Rr.current={sessionId:f,keys:w,scrollTop:o.scrollTop,scrollHeight:o.
scrollHeight,clientHeight:o.clientHeight,atBottom:Uo||Yt.current}},[f,Ln,Hl]),Te(()=>{f&&ne(f)},[f]),Te(()=>{_o(o=>{let w=Object.
keys(o).filter(R=>!b[R]);if(w.length===0)return o;let M={...o};return w.forEach(R=>delete M[R]),M})},[b]),Te(()=>{!Zi.current&&
i&&at("Reconnected"),Zi.current&&!i&&at("Disconnected \u2014 reconnecting..."),Zi.current=i},[i]);function at(o){ha(o),setTimeout(
()=>ha(""),3e3)}function Lm(o){let w=Oe.find(M=>$e(M)===o);return w?Zr(w,o,H[o],t[o]||[]):o}function Kl(o,w,M,R=""){gt.current&&
clearTimeout(gt.current),zs({sessionId:o,kind:w,title:M,detail:R||Lm(o)}),gt.current=setTimeout(()=>{gt.current=null,zs(
null)},8e3)}function Vl(){gt.current&&clearTimeout(gt.current),gt.current=null,zs(null)}Te(()=>()=>{gt.current&&clearTimeout(
gt.current)},[]),Te(()=>{let o=Gs.current,w=g||{},M=Object.keys(o).filter(R=>!w[R]);M.length>0&&(rn(R=>{let U={...R};return M.
forEach(Q=>{U[Q]?.kind==="prompt"&&delete U[Q]}),U}),zs(R=>R?.kind==="prompt"&&M.includes(R.sessionId)?null:R)),Object.entries(
w).forEach(([R,U])=>{let Q=U?.prompt_id||U?.request_id||U?.id||"prompt",le=o[R],ye=le?.prompt_id||le?.request_id||le?.id||
null;if(Q===ye||(_a.current&&Vn.completion_sound&&tm(R,f)&&em("prompt"),R===f))return;let Qe=U?.type==="question_prompt"||
U?.kind==="question"?"Question needs an answer":"Permission needs attention";rn(je=>({...je,[R]:{kind:"prompt",promptId:Q}})),
Kl(R,"prompt",Qe)}),Gs.current=w,_a.current=!0},[g,f,Vn.completion_sound]),Te(()=>{!f||Rt?.sessionId!==f||(gt.current&&clearTimeout(
gt.current),gt.current=null,zs(null))},[f,Rt?.sessionId]),Te(()=>{if(!it||!mo)return;let o=!1;async function w(){for(let M of gs||
[]){let R=M.session_id||M.session;if(!xd(M,Vn)){aa(M,"suppressed",{reasonCode:"client_preference"});continue}if(tt[R]?.muted){
aa(M,"suppressed",{reasonCode:"session_muted"});continue}if(!tm(R,f)){aa(M,"suppressed",{reasonCode:"focused_session"});
continue}let U=await Ad(M);if(o)continue;if(!U){aa(M,"suppressed",{reasonCode:"client_duplicate"});continue}aa(M,"claime\
d");let Q=M.event_type;Vn.completion_sound&&em(Q==="goal_attention"||Q==="provider_usage_threshold"?"prompt":"completion"),
R!==f&&rn(ye=>({...ye,[R]:{kind:Q,dedupeKey:M.dedupe_key,createdAt:M.created_at||new Date().toISOString()}})),Kl(R,Q,M.title,
M.body),(typeof requestAnimationFrame=="function"?requestAnimationFrame:ye=>setTimeout(ye,16))(()=>{o||aa(M,"displayed")})}}
return w().catch(()=>{}),()=>{o=!0}},[gs,f,tt,Vn,it,mo]);function Ia(o,w){o&&Us(M=>({...M,[o]:w}))}function tc(o,w){o&&Cn(
M=>{let R={...M};if(w===null)return delete R[o],R;let U=R[o]||[];return Array.isArray(w)?R[o]=w:R[o]=[...U,w],R})}function Pm(o,w){
o&&Cn(M=>{let R={...M},U=[...R[o]||[]];return U.splice(w,1),U.length===0?delete R[o]:R[o]=U,R})}async function nc(o,w,M,R){
let U=await fetch("/upload",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({filename:R,content:w,
mimeType:M})});if(!U.ok)throw new Error("Upload failed");let{url:Q}=await U.json();return tc(o,{name:R,url:Q,isText:!1,mimeType:M}),
Q}function Yl(o,w,M,R){let U=xe(o,w,M,R);return ec.current[U]={sessionId:o,filename:R,mimeType:M,base64:w,createdAt:Date.
now()},at(`Sending image to Codex: ${R}`),U}Te(()=>{let o=Object.entries(pa||{});for(let[w,M]of o){if(!w.startsWith("att\
ach-")||Gl.current[w])continue;Gl.current[w]=!0;let R=ec.current[w];if(delete ec.current[w],!!R){if(M?.result==="ok"){at(
`Image attached to Codex: ${R.filename}`);continue}(async()=>{try{await nc(R.sessionId,R.base64,R.mimeType,R.filename),at(
`Direct image attach failed \u2014 added ${R.filename} as a file link draft`)}catch{let U=M?.error?.message||M?.error?.code||
"unknown error";at(`Image attach failed: ${U}`)}})()}}},[pa]);function Da(o){let w=o?.agent_type;return{limit:y_(w),...w===
"codex_cli"||w==="cursor_cli"?{chunkBytes:__}:{}}}function pv(o){let w=Oe.find(M=>$e(M)===o);return Da(w)}function qn(o,w){
let M=ds.current===o;Ri(o),nt(o),ds.current=o,Oa.current={sessionId:o,index:(Tr.current[o]||[]).length,scratch:""},p(R=>({
...R,[o]:0})),rn(R=>{if(!R[o])return R;let U={...R};return delete U[o],U}),Rt?.sessionId===o&&Vl(),ft(!1),Ot(!1),Ge(!1),
fn(!1),En(!1),M&&setTimeout(()=>io(o,Da(w)),0)}function qm(o){let w=o?.session_id,M=Number(o?.message_id);if(!w||!Number.
isSafeInteger(M)||M<=0)return;let R=Oe.find(U=>$e(U)===w)||{session_id:w,workspace_path:o.workspace_path||null,project_root:o.
project_root||null,workspace_name:o.workspace_name||null,agent_type:o.agent_type||null,status:"history"};Fe.cancelRouteRestore(),
Xi.current=null,vr({sessionId:w,messageId:M}),qn(w,R),En(!1)}async function Om(o){let w=Array.from(o.target.files||[]);if(w.
length!==0){o.target.value="";for(let M of w){if(M.size>2*1024*1024){at(`${M.name}: too large (max 2 MB)`);continue}if($u(
M.name)&&M.size<500*1024)await new Promise((R,U)=>{let Q=new FileReader;Q.onload=le=>{tc(f,{name:M.name,content:le.target.
result,isText:!0}),R()},Q.onerror=()=>{at(`Failed to read ${M.name}`),R()},Q.readAsText(M)});else{cn(!0);try{await new Promise(
(R,U)=>{let Q=new FileReader;Q.onload=async le=>{let ye=le.target.result.split(",")[1];(j?.capabilities||{}).send_attachment&&
M.type.startsWith("image/")?Yl(f,ye,M.type,M.name):(await nc(f,ye,M.type,M.name),at(`Uploaded: ${M.name}`)),R()},Q.onerror=
()=>{at(`Failed to read ${M.name}`),R()},Q.readAsDataURL(M)})}catch{at(`Upload failed: ${M.name}`)}finally{cn(!1)}}}}}async function Im(o){
let M=Array.from(o.clipboardData?.items||[]).find(le=>le.type.startsWith("image/"));if(!M||(o.preventDefault(),!f))return;
let R=M.getAsFile();if(!R)return;if(R.size>2*1024*1024){at("Image too large (max 2 MB)");return}let U=R.type==="image/jp\
eg"?"jpg":"png",Q=`screenshot-${Date.now()}.${U}`;cn(!0);try{await new Promise(le=>{let ye=new FileReader;ye.onload=async Qe=>{
let je=Qe.target.result.split(",")[1];(j?.capabilities||{}).send_attachment?Yl(f,je,R.type,Q):(await nc(f,je,R.type,Q),at(
"Screenshot attached")),le()},ye.onerror=()=>{at("Failed to read clipboard image"),le()},ye.readAsDataURL(R)})}catch{at(
"Paste upload failed")}finally{cn(!1)}}function Xl(){if(Ts)return;let o=f&&Gn[f]||"",w=f?an[f]||[]:[],M=o.trim();if(!M&&
w.length===0||!f)return;let R="";if(w.length>0?(R=w.map(Q=>{if(Q.isText){let le=za(Q.name);return`\`${Q.name}\`
\`\`\`${le}
${Q.content}
\`\`\``}return(Q.mimeType||"").startsWith("image/")?`![${Q.name}](${Q.url})`:`[File: ${Q.name}](${Q.url})`}).join(`

`),M&&(R+=`

${M}`)):R=M,Ke(f,R),M){let U=Tr.current[f]||[],Q=U[U.length-1]===M?U:[...U,M].slice(-100);Tr.current[f]=Q,Oa.current={sessionId:f,
index:Q.length,scratch:""}}es(U=>({...U,[f]:!1})),ts(U=>({...U,[f]:Math.min(U[f]||0,(t[f]||[]).length)})),Ia(f,""),tc(f,
null),Ot(!1),Pn.current?.focus()}function sc(){dn.current&&clearTimeout(dn.current),dn.current=null,un.current={sessionId:null,
expiresAt:0},wa(null)}function Dm(){if(!f)return;let o=Date.now()+2500;un.current={sessionId:f,expiresAt:o},wa(f),dn.current&&
clearTimeout(dn.current),dn.current=setTimeout(()=>{un.current.sessionId===f&&un.current.expiresAt===o&&(un.current={sessionId:null,
expiresAt:0},dn.current=null,wa(null))},2500)}function ac(){if(!f||!b[f]||ho[f]){sc();return}sc(),_o(o=>({...o,[f]:!0})),
L(f)}Te(()=>()=>{dn.current&&clearTimeout(dn.current)},[]),Te(()=>{Zn&&(Zn!==f||!b[Zn])&&sc()},[f,b,Zn]);function jm(o){
if((o.metaKey||o.ctrlKey)&&o.key.toLowerCase()==="k"){o.preventDefault(),Pn.current?.focus();return}if(o.key==="Escape"){
if(ct){Ot(!1);return}if(Ts)return;qo&&!ja&&(o.preventDefault(),un.current.sessionId===f&&un.current.expiresAt>=Date.now()?
ac():Dm());return}if(o.key==="Enter"&&!o.shiftKey&&un.current.sessionId===f&&un.current.expiresAt>=Date.now()){o.preventDefault(),
ac();return}let w=f?Tr.current[f]||[]:[],M=Oa.current,R=M.sessionId===f&&M.index>=0&&M.index<w.length;if(o.key==="ArrowU\
p"&&w.length>0&&(On===""||R)){o.preventDefault();let U=M.sessionId===f?M:{sessionId:f,index:w.length,scratch:On};U.index=
Math.max(0,U.index-1),Oa.current=U,Ia(f,w[U.index]);return}if(o.key==="ArrowDown"&&R){o.preventDefault();let U=Math.min(
w.length,M.index+1);Oa.current={...M,index:U},Ia(f,U===w.length?M.scratch:w[U]);return}if(o.key==="Tab"&&ct&&Io.length>0){
o.preventDefault(),Cu(Io[0].command);return}o.key==="Enter"&&!o.shiftKey&&(o.preventDefault(),Xl())}let qo=f?!!b[f]:!1,ja=f?
!!ho[f]:!1,On=f&&Gn[f]||"",rc=f?an[f]||[]:[],$r=React.useCallback(()=>{let o=Pn.current;if(!o)return;let w=Math.max(42,Math.
floor(window.innerHeight*.4));o.style.height="auto";let M=Math.max(42,Math.min(o.scrollHeight,w));o.style.height=`${M}px`,
o.style.overflowY=o.scrollHeight>w?"auto":"hidden"},[]);us(()=>{$r()},[f,On,$r]),Te(()=>(window.addEventListener("resize",
$r),()=>window.removeEventListener("resize",$r)),[$r]);let Zs=Ln,Ql=f&&Mn[f]&&ys[f]||0,Ue=React.useMemo(()=>{let o=Math.
min(Ql,Zs.length);return o<=0?Zs:o>=Zs.length?Pp:Zs.slice(o)},[Zs,Ql]),os=React.useMemo(()=>Ue.filter(o=>C_(o)),[Ue]),oc=!gn&&
!ws&&!Ns&&!ns&&!Ss&&!Cs,Fe=cb({messages:os,containerRef:Vt,sessionId:f,routeActive:oc}),Ms=React.useCallback(()=>{let o=Vt.
current;if(!o)return;let w=o.scrollHeight-o.scrollTop-o.clientHeight<80;Xi.current={sessionId:f,scrollTop:o.scrollTop,scrollHeight:o.
scrollHeight,clientHeight:o.clientHeight,atBottom:w},Fe.prepareForRouteChange()},[f,Fe.prepareForRouteChange]);us(()=>{if(!oc||
Fe.enabled)return;let o=Xi.current;if(!Vt.current||o?.sessionId!==f)return;let M=()=>{let R=Vt.current;if(!R||o.sessionId!==
f)return;let U=o.atBottom?R.scrollHeight:Math.min(o.scrollTop,Math.max(0,R.scrollHeight-R.clientHeight));qa.current=Date.
now()+800,nn(R,U)};return M(),Mr.current=requestAnimationFrame(()=>{Mr.current=0,M()}),()=>{Mr.current&&cancelAnimationFrame(
Mr.current),Mr.current=0}},[f,oc,Fe.enabled]),Te(()=>{if(wm)return window.__RAC_TRANSCRIPT_WINDOW__={total:os.length,scrollToIndex:Fe.
scrollToIndex},()=>{window.__RAC_TRANSCRIPT_WINDOW__?.scrollToIndex===Fe.scrollToIndex&&delete window.__RAC_TRANSCRIPT_WINDOW__}},
[os.length,Fe.scrollToIndex]);let Et=f&&g[f]||null,Er=f&&k[f]||null,Lr=rr(Er)?Er:null,Jl=Er&&!rr(Er)?Er:null,Ts=Et||Lr,mv=Et?
Et.type==="question_prompt"?"Question required":"Permission required":Lr?ae(Lr.title,"Action required"):null;us(()=>{let o=Vt.
current;if(!o)return;let w=Et?`${f||""}\0${Et.prompt_id||Et.request_id||Et.id||"prompt"}`:"",M=Wl.current;Wl.current=w,w?
(xr.current+=1,Ar.current=0,Yt.current=!1,qa.current=Date.now()+800,nn(o,0),Lo.current=o.scrollHeight-o.clientHeight<80,
lt(!1),Rn(0)):M&&Po(ul(Ln),3)},[f,Et?.prompt_id,Hl,Ln]);let Bm=!!(On.trim()||rc.length>0)&&!!f&&!on&&!Ts,Zl=i?c?.state||
"connecting":"offline",Fm=c?.rttMs!=null?` \xB7 ${c.rttMs} ms`:"",eu=Object.entries(u).reduce((o,[w,M])=>Kt.has(w)?o:o+Number(
M||0),0),Oo=Object.keys(uo).filter(o=>o!==f&&!Kt.has(o)).length,tu=pr?.completed_at?Date.now()-Date.parse(pr.completed_at):
Number.POSITIVE_INFINITY,Xt=tu>=0&&tu<=1440*60*1e3?pr:null,Ba=Xt?Sn.filter(o=>o.run_id!==Xt.run_id):Sn,Pr=Wn.length>0||Ba.
length>0||!!Xt,Hm=On.startsWith("/")?On.slice(1).trim().toLowerCase():"",Io=On.startsWith("/")?b_.filter(o=>o.command.slice(
1).includes(Hm)):[];us(()=>{let o=wr.current;if(!Pr||!o){vo(0);return}let w=()=>vo(Math.ceil(o.getBoundingClientRect().height));
if(w(),typeof ResizeObserver>"u")return;let M=new ResizeObserver(w);return M.observe(o),()=>M.disconnect()},[Pr,Wn.length,
Ba.length,Xt?.run_id]);let j=f&&H[f]||null,nu=f?Object.values(V||{}).filter(o=>o.sessionId===f):[],su=nu.find(o=>o.status===
"pending"||o.status==="awaiting_config")||null,Do=nu.find(o=>o.status==="failed")||null,Qt=f&&s[f]||null,Fa=f&&a[f]||null;
Te(()=>{if(!f||!i||Ye?.sessionId===f)return;let w=(t[f]||[]).reduce((U,Q)=>Math.max(U,Number(Q?.sequence||0)),0);if(w>0){
io(f,{afterSequence:w});return}let M=Da(I),R=I?.agent_type==="codex_cli"||I?.agent_type==="cursor_cli"?"native":"relay_s\
qlite";qt(f,{...M,mode:"tail",source:R})},[f,i,I?.agent_type,Ye?.sessionId]),Te(()=>{if(!i||!Ye||f!==Ye.sessionId||(t[f]||
[]).some(R=>String(R?.id)===String(Ye.messageId)))return;let w=()=>qt(f,{mode:"around",source:"relay_sqlite",aroundId:Ye.
messageId,limit:200,replace:!0,userInitiated:!0});w();let M=setTimeout(w,600);return()=>clearTimeout(M)},[i,f,Ye?.sessionId,
Ye?.messageId,t[f]]),Te(()=>{if(!Ye||f!==Ye.sessionId)return;let o=`[data-message-id="${Ye.messageId}"]`,w=os.findIndex(
Q=>String(Q?.id)===String(Ye.messageId));w>=0&&Fe.scrollToIndex(w,"center");let M=0,R=null,U=setInterval(()=>{M++;let Q=Vt.
current?.querySelector(o);Q?(clearInterval(U),Q.scrollIntoView({block:"center",behavior:"instant"}),R=setTimeout(()=>{vr(
le=>le?.sessionId===f&&String(le?.messageId)===String(Ye.messageId)?null:le)},5e3)):M>=40&&(clearInterval(U),vr(null),at(
"Matched message could not be loaded"))},100);return()=>{clearInterval(U),R&&clearTimeout(R)}},[f,Ye?.sessionId,Ye?.messageId,
t[f],os,Fe.scrollToIndex]),Te(()=>{lr(f?[f]:[])},[f,lr]),Te(()=>{if(!f||!i||!Bl)return;let o=Da(I);qt(f,{...o,mode:"tail",
source:"native"})},[f,i,Bl]);let Be=I?.agent_type==="antigravity-v2",qr=f?G[f]||[]:[],Ha=f?Vs[f]:null,au=React.useMemo(()=>Be&&
Ha?.id?qr.map(o=>!o?.kind||o.kind==="chat"?{...o,active:o.id===Ha.id}:o):qr,[qr,Be,Ha?.id]),ic=!!(f&&Object.prototype.hasOwnProperty.
call(G,f)),ru=au.filter(o=>!o?.kind||o.kind==="chat").length,Um=!!(f&&Be&&!Gt),cc=I?.agent_type==="antigravity"||I?.agent_type===
"antigravity_panel"||I?.agent_type==="antigravity-v2",yn=I?W_(Oe,I):null,ou=I?.agent_type==="codex"&&I?.visible_pane_visible?
{pane_agent:I.visible_pane_agent||null,summary:Hp(I),sourceSession:I}:null,Wm=yn?{pane_agent:yn.panel_agent||null,summary:Hp(
yn),sourceSession:yn}:null,jo=ou||Wm,zm=jo?.summary||"",Gm=jo?.pane_agent||null,iu=zm||pl(Gm)||or(jo?.sourceSession,$e(jo?.
sourceSession)),cu=iu,lc=!!(I&&I.agent_type==="codex"&&I.visible_pane_visible&&I.visible_pane_agent==="codex"),Km=!!(I&&
I.agent_type==="codex"&&I.visible_pane_visible&&I.visible_pane_agent&&I.visible_pane_agent!=="codex"),Xe=ir(I||f,j),uc=f?
Ma[f]:"",is=I&&typeof I=="object"?I.workspace_path:"",lu=is?is.split(/[\\/]/).filter(Boolean).pop()||is:"",Vm=lu||(uc&&uc!==
"Unscoped"?uc:"")||ae(I?.workspace_name)||"Unscoped",uu=Me(new Map),dc=React.useMemo(()=>Be&&Ha?.title?{...I||{},native_chat_title:Ha.
title}:I,[I,Be,Ha?.title]),pc=React.useMemo(()=>{if(!f)return{title:"Agent Chat",source:"fallback",field:"no_session"};let o=Rc(
dc,dc?.custom_display_name||"",Ln),w=td(uu.current.get(f),o);return uu.current.set(f,w),w},[f,dc,Ln]),mc=pc.title,Bo=f?oo[f]:
null,Ym=!!(Xe?.name==="Codex"&&I&&I.agent_type==="codex"&&(Km&&yn||!ou&&yn&&(yn.panel_agent==="antigravity_panel"||cu))),
du=!!j?.capabilities?.new_thread,Xm=I?.agent_type==="codex-desktop",Qm=I?.agent_type==="cursor",pu=Xm||Qm,fc=pu?"New cha\
t":"New thread",mu=I&&typeof I=="object"?I.machine_label:"",fu=hm(I),gu=React.useMemo(()=>{for(let o=Ue.length-1;o>=0;o--)
if(Ue[o]?.role==="user")return Ue[o];return null},[Ue]),gc=gu?Ct(gu.content).replace(/\s+/g," ").trim():"",ea=f?A[f]||I?.
status||"unknown":"",hu=React.useCallback(o=>{let w=ae(o).replace(/\s+\((?:Lines?|Line)\s+\d+(?:-\d+)?\)\s*$/i,"").replace(
/^["'`]+|["'`]+$/g,"").trim();if(!w)return"";let M=w.replace(/\\/g,"/"),R=ae(is).replace(/\\/g,"/").replace(/\/+$/,"");if(/^[A-Za-z]:\//.
test(M)||M.startsWith("//")){if(!R)return"";let U=M.toLowerCase(),Q=R.toLowerCase();return U===Q?".":U.startsWith(Q+"/")?
M.slice(R.length+1):""}return M.replace(/^\.\/+/,"").replace(/^\/+/,"")},[is]),hc=React.useCallback((o,w)=>{if(!f)return;
let M=hu(w);if(!M){at("File is outside the current workspace");return}kr(R=>R&&R.sessionId===f&&R.messageKey===o&&R.path===
M?null:{sessionId:f,messageKey:o,path:M}),xo.current(f,M)},[f,hu]),_u=React.useCallback(()=>kr(null),[]),qe=f?S[f]!==void 0?
S[f]:I&&typeof I=="object"?I.activity:null:null,_c=qe?.context_card||null,Jm=!!(f&&gc&&!((I?.agent_type==="cline"||I?.agent_type===
"roo_code")&&_c)),Or=["claude_cli","codex_cli","cursor_cli"].includes(I?.agent_type),bu=React.useMemo(()=>{for(let o=Ue.
length-1;o>=0;o--)if(Ue[o]?.role==="assistant")return Ue[o];return null},[Ue]),Ua=f?(y[f]||"").trim():"",vu=bu?Ct(bu.content).
trim():"",Zm=!!(qe&&!qe?.thinking&&!qe?.current&&!qe?.task_list&&dl(Ua)),yu=!!(f&&!dt&&qe&&(qe.kind==="thinking"||qe.kind===
"generating")&&!qe?.thinking&&!qe?.current&&!Zm&&dl(Ua)&&(I?.agent_type==="codex"||I?.agent_type==="codex-desktop"||I?.agent_type===
"cursor"||I?.agent_type==="antigravity_panel")&&Ua!==vu&&!vu.includes(Ua)),ku=!!(qe&&(qe?.goal||qe?.thinking||qe?.current||
qe?.step||qe?.usage||qe?.task_list||qe.kind!=="idle"||dl(Ua||qe.thinkingContent||""))),bc=!!(f&&Qt?.partial&&Number(Qt.total||
0)>Number(Qt.loaded||Ue.length||0)),wu=Number(Qt?.loaded||Ue.length||0),ef=Number(Qt?.total||wu||0);function Nu(){if(!f)
return;if(!Fe.prepareForPrepend()){let w=Vt.current,M=w?.getBoundingClientRect(),R=M?.top||0,U=w?Array.from(w.querySelectorAll(
".message[data-message-key]")):[],Q=U.find(le=>{let ye=le.getBoundingClientRect();return ye.top>=R&&ye.top<M.bottom})||U.
find(le=>le.getBoundingClientRect().bottom>R)||U[0]||null;Yi.current=Q?{messageKey:Q.dataset.messageKey,viewportOffset:Q.
getBoundingClientRect().top-R}:null}let o=I?.agent_type==="codex_cli"||I?.agent_type==="cursor_cli"?"native":"relay_sqli\
te";qt(f,{mode:Qt?.cursor?"older":"tail",source:o,userInitiated:!0,beforeOffset:Qt?.cursor?.next_before_offset,beforeId:Qt?.
cursor?.next_before_id,...Da(I)})}Te(()=>(Vi.current=bc&&!Fa?Nu:null,()=>{Vi.current=null}),[f,I?.agent_type,Fa,bc,Qt?.cursor?.
next_before_offset,Qt?.cursor?.next_before_id]);function tf(){if(!f)return;let o=I?.agent_type==="codex_cli"||I?.agent_type===
"cursor_cli"?"native":"relay_sqlite";qt(f,{...Da(I),mode:"tail",source:o,userInitiated:!0})}let nf=!!(f&&(Ue.length>0||yu||
dt)),sf=yl(Xe),af=React.useMemo(()=>os.slice(Fe.start,Fe.end).map((o,w)=>{let M=Fe.start+w,R=Cl(o,M),U=Ye?.sessionId===f&&
String(o?.id)===String(Ye?.messageId),Q=Fe.enabled||U||M>=Math.max(0,os.length-48),le=xa?.sessionId===f&&xa?.messageKey===
R?xa:null,ye=React.createElement(rb,{key:R,msg:o,messageKey:R,activeAgent:Xe,assistantMonospace:Or,autoExpandLongCodeBlocks:cc,
onOpenPath:hc,agentType:I?.agent_type,preview:le,fileContents:dr,onClosePreview:_u,deliveryState:o._cid?N[o._cid]:null,onSteer:No,
onRetry:Co,richContentEager:Q,searchMatch:U});return Fe.enabled?React.createElement(ib,{key:R,index:M,messageKey:`${f||""}\
${R}`,onMeasure:Fe.onMeasure},ye):ye}),[os,Fe.start,Fe.end,Fe.enabled,Fe.onMeasure,f,Ye?.sessionId,Ye?.messageId,sf,Or,
cc,hc,I?.agent_type,xa,dr,_u,N,No,Co]),Wa=j?.capabilities?.thread_list,Ir=!!I?.is_new_chat_draft,rf=!!(f&&(I?.agent_type===
"codex-desktop"||I?.agent_type==="cursor")&&Wa&&(B[f]?.length>0||Mn[f]||Ir)&&!Gt),of=React.useMemo(()=>{let o=[...B[f]||
[]];if(o.length===0)return o;let w=Tn[f],M=w?o.findIndex(U=>U.id===w):-1,R=M>=0?M:o.findIndex(U=>U.active);if(R>0){let[U]=o.
splice(R,1);o.unshift(U)}return o},[f,B,Tn]),cf=React.useMemo(()=>{let o=Tn[f],w=(B[f]||[]).find(U=>U?.active),M=w?.cache_key||
w?.id,R=Mn[f]||Ir?"draft":"";return`${f||"none"}:${R||o||M||"default"}`},[f,B,Tn,Mn,Ir]),Su=Ue.length===0;React.useEffect(
()=>{f&&Wa&&Su&&$(f)},[f,Wa,Su]),React.useEffect(()=>{if(!(f&&Be&&i))return;me(f);let o=[600,1800,4200].map(U=>setTimeout(
()=>{typeof document<"u"&&document.hidden||me(f)},U)),w=()=>{typeof document<"u"&&document.hidden||me(f)},M=setInterval(
w,3e4),R=()=>w();return typeof document<"u"&&document.addEventListener("visibilitychange",R),()=>{o.forEach(U=>clearTimeout(
U)),clearInterval(M),typeof document<"u"&&document.removeEventListener("visibilitychange",R)}},[f,Be,i]),React.useEffect(
()=>{f&&Be&&(Ht(!0),Ge(!1))},[f,Be]),React.useEffect(()=>{if(!(f&&Be))return;let o=qr.find(w=>(!w?.kind||w.kind==="chat")&&
w.active);o&&Ys(w=>{let M=w[f];if(!M||M.id!==o.id&&Date.now()-(M.at||0)<15e3)return w;let R={...w};return delete R[f],R})},
[f,Be,qr]),React.useEffect(()=>{if(!(f&&Wa&&(pu||ht)))return;$(f);let o=setInterval(()=>$(f),ht?3e3:5e3);return()=>clearInterval(
o)},[f,I?.agent_type,Wa,ht]),React.useEffect(()=>{if(!f)return;let o=ys[f]||0,w=Zs.length;o>w&&ts(M=>({...M,[f]:w}))},[f,
ys,Zs.length]),React.useEffect(()=>{!f||Ue.length===0||es(o=>o[f]?{...o,[f]:!1}:o)},[f,Ue.length]),React.useEffect(()=>{
if(!f)return;let o=B[f]||[],w=Tn[f];w&&o.some(M=>M.id===w&&M.active)&&vs(M=>{let R={...M};return delete R[f],R})},[f,B,Tn]);
function Fo(o=f){o&&(es(w=>({...w,[o]:!0})),vs(w=>{let M={...w};return delete M[o],M}),ts(w=>({...w,[o]:(t[o]||[]).length})),
fn(!1),ve(o))}function vc(o,w){o&&w&&(es(M=>({...M,[o]:!1})),vs(M=>({...M,[o]:w})),ts(M=>({...M,[o]:0})),P(o,w))}function ta(o=f){
o&&(Ht(!0),Ge(!1),Ys(w=>({...w,[o]:{id:"__agv2:new_conversation",title:"New Conversation",kind:"nav",at:Date.now()}})),W(
o))}function yc(o,w=f){if(!(w&&o))return;Ht(!0),Ge(!1);let M=(G[w]||[]).find(U=>U?.id===o),R=o==="__agv2:new_conversatio\
n"?"New Conversation":o==="__agv2:conversation_history"?"Conversation History":o==="__agv2:scheduled_tasks"?"Scheduled T\
asks":"Antigravity v2";if(Ys(U=>({...U,[w]:{id:o,title:M?.title||R,kind:M?.kind||"chat",at:Date.now()}})),o==="__agv2:ne\
w_conversation"){ta(w);return}J(w,o)}function lf(o){f&&(Oa.current={sessionId:f,index:(Tr.current[f]||[]).length,scratch:o},
Ia(f,o),Ot(o.startsWith("/")))}function Cu(o){if(!f)return;let M={"/plan":`${o} Outline the implementation approach and \
major steps.`,"/review":`${o} Review the current changes for bugs, regressions, and missing tests.`,"/fix":`${o} Impleme\
nt or repair the current issue.`,"/summarize":`${o} Summarize the current state and important changes.`}[o]||`${o} `;Ia(
f,M),Ot(!1),requestAnimationFrame(()=>Pn.current?.focus())}function uf(o,w=!1,M=""){let R=$e(o),U=$t.has(R)?Za(o):null,Q=Rs.
current.get(R);return Q||(Q=document.createElement("div"),Q.className="sidebar-card-host",Q.setAttribute("data-sidebar-c\
ard-host",R),Rs.current.set(R,Q)),ReactDOM.createPortal(React.createElement(pb,{session:o,health:A[R],unread:Kt.has(R)?0:
u[R]||0,isThinking:!!b[R]||!!Zo(S[R],{health:A[R]}),isActive:R===f,agentConfig:H[R]||null,activity:S[R]||null,sessionMessages:t[R]||
[],hasBlockingPrompt:!!g[R]||!!rr(k[R]),blockingPromptLabel:g[R]?g[R].type==="question_prompt"?"Question required":"Perm\
ission required":k[R]?.title||"Action required",muted:!!tt[R]?.muted,pinned:w,workspaceLabel:M,recentMessageAt:U?.at||null,
menuOpen:Di===R,onMenuToggle:le=>fo(ye=>le?R:ye===R?"":ye),onPinChange:le=>yo(R,{pinned:le}).catch(ye=>{at(ye?.message||
`Unable to ${le?"pin":"unpin"} chat`)}),onSelect:()=>qn(R,o),onManage:()=>{ln(R),wt(!0),ze(!1),kt(!1)},onClose:()=>{let le=A[R]===
"disconnected"||!A[R],ye=le?"Remove session from the list?":`Close session "${R}"?`;window.confirm(ye)&&Hn(R,le)},onAutomations:o?.
agent_type==="codex-desktop"?()=>{gn||Ms(),It(le=>!le),$n(!1),zt(!1),Wt(!1),hn(!1),ft(!1)}:void 0,showAutomationsActive:gn,
onSkills:o?.agent_type==="codex-desktop"?()=>{ws||Ms(),$n(le=>!le),It(!1),zt(!1),Wt(!1),hn(!1),ft(!1),ur[R]||ro(R)}:void 0,
showSkillsActive:ws}),Q,R)}function Ho(o,w=!0){let M=$e(o);return React.createElement("div",{key:M,className:`sidebar-ca\
rd-slot${w?"":" sidebar-card-slot-filtered"}`,"data-sidebar-card-slot":M,"aria-hidden":w?void 0:"true",inert:w?void 0:""})}
return React.createElement("div",{className:`app${Pr?" has-system-banner":""}`,style:Pr?{"--system-banner-height":`${Bi}\
px`}:void 0},Xn&&React.createElement("div",{className:"quick-switcher-overlay",onMouseDown:o=>{o.target===o.currentTarget&&
(Ks(!1),Qn(""),Ft(0),requestAnimationFrame(()=>Pn.current?.focus()))}},React.createElement("div",{className:"quick-switc\
her",role:"dialog","aria-modal":"true","aria-label":"Switch session"},React.createElement("div",{className:"quick-switch\
er-input-wrap"},React.createElement("span",{"aria-hidden":"true"},"\u2315"),React.createElement("input",{ref:Nr,className:"\
quick-switcher-input",value:hr,onChange:o=>{Qn(o.target.value),Ft(0)},placeholder:"Search sessions, projects, or harness\
es","aria-label":"Search sessions","aria-controls":"quick-switcher-results","aria-activedescendant":St.length?`quick-swi\
tcher-option-${Tt}`:void 0,autoComplete:"off",spellCheck:"false"}),React.createElement("kbd",null,"Esc")),React.createElement(
"div",{className:"quick-switcher-results",id:"quick-switcher-results",role:"listbox"},St.length===0?React.createElement(
"div",{className:"quick-switcher-empty"},"No matching sessions"):St.map((o,w)=>React.createElement("button",{type:"butto\
n",role:"option",id:`quick-switcher-option-${w}`,"aria-selected":w===Tt,className:`quick-switcher-option${w===Tt?" selec\
ted":""}${o.id===f?" active":""}`,key:o.id,onMouseEnter:()=>Ft(w),onClick:()=>{qn(o.id,o.session),ft(!1),Ks(!1),Qn(""),Ft(
0),requestAnimationFrame(()=>Pn.current?.focus())}},React.createElement("span",{className:"quick-switcher-dot",style:{background:o.
agentColor}}),React.createElement("span",{className:"quick-switcher-copy"},React.createElement("span",{className:"quick-\
switcher-title"},o.title),React.createElement("span",{className:"quick-switcher-meta"},o.groupLabel," \xB7 ",o.agentName,
o.subtitle?` \xB7 ${o.subtitle}`:"")),o.id===f&&React.createElement("span",{className:"quick-switcher-current"},"Current")))),
React.createElement("div",{className:"quick-switcher-footer"},React.createElement("span",null,React.createElement("kbd",
null,"\u2191"),React.createElement("kbd",null,"\u2193")," Navigate"),React.createElement("span",null,React.createElement(
"kbd",null,"Enter")," Switch"),React.createElement("span",null,St.length," of ",rs.length)))),Jn&&React.createElement("d\
iv",{className:"shortcut-help-overlay",onMouseDown:o=>{o.target===o.currentTarget&&bs(!1)}},React.createElement("div",{className:"\
shortcut-help",role:"dialog","aria-modal":"true","aria-label":"Keyboard shortcuts"},React.createElement("div",{className:"\
shortcut-help-header"},React.createElement("strong",null,"Keyboard shortcuts"),React.createElement("button",{type:"butto\
n",onClick:()=>bs(!1),"aria-label":"Close keyboard shortcuts"},"\xD7")),React.createElement("div",{className:"shortcut-h\
elp-list"},React.createElement("div",null,React.createElement("span",null,"Switch session"),React.createElement("kbd",null,
"Ctrl/Cmd P")),React.createElement("div",null,React.createElement("span",null,"Previous / next session"),React.createElement(
"kbd",null,"Alt \u2191 / \u2193")),React.createElement("div",null,React.createElement("span",null,"Focus composer"),React.
createElement("kbd",null,"Ctrl/Cmd K")),React.createElement("div",null,React.createElement("span",null,"Send / newline"),
React.createElement("kbd",null,"Enter / Shift Enter")),React.createElement("div",null,React.createElement("span",null,"O\
pen / close this guide"),React.createElement("kbd",null,"?"))),React.createElement("div",{className:"shortcut-help-note"},
"Shortcuts never switch or submit while you are typing unless they include Ctrl/Cmd or Alt."))),React.createElement("div",
{className:`overlay ${lo?"open":""}`,onClick:()=>ft(!1)}),Pr&&React.createElement("div",{className:`duplicate-proxy-bann\
er${Xt?.status==="pass"&&Wn.length===0&&Ba.length===0?" app-update-pass":""}`,role:Xt?.status==="pass"&&Wn.length===0&&Ba.
length===0?"status":"alert",ref:wr},Wn.length>0&&React.createElement(React.Fragment,null,React.createElement("strong",null,
"Duplicate proxy detected."),React.createElement("span",null,Wn.length," session",Wn.length===1?"":"s"," claimed by mult\
iple proxies. Stop the extra proxy to prevent conflicting controls.")),Ba.length>0&&React.createElement(React.Fragment,null,
React.createElement("strong",null,"Nightly validation failed."),React.createElement("span",null,Ba.map(o=>`${o.harness} \
(${o.app_version})`).join(", "),". Check the validation ledger before using affected controls.")),Xt&&React.createElement(
React.Fragment,null,React.createElement("strong",null,Xt.status==="pass"?"App update validated.":"App update drift valid\
ation failed."),React.createElement("span",null,Xt.harness," ",Xt.previous_app_version," -> ",Xt.app_version,". ",Xt.status===
"pass"?"Harness controls remain available.":"A triage item was added to the maturity backlog."))),React.createElement("d\
iv",{className:`sidebar ${lo?"open":""}`},React.createElement("div",{className:"sidebar-header"},React.createElement("sp\
an",{className:"logo"},"\u232C"),React.createElement("span",{style:{flex:1}},"Agent Sessions"),React.createElement("butt\
on",{className:`new-session-btn notification-settings-btn${Jn?" active":""}`,title:"Keyboard shortcuts (?)","aria-label":"\
Keyboard shortcuts",onClick:()=>{bs(o=>!o),Ks(!1)}},"?"),React.createElement("button",{className:`new-session-btn notifi\
cation-settings-btn${st?" active":""}`,title:"Notification settings","aria-label":"Notification settings",onClick:()=>{ze(
o=>!o),kt(!1),wt(!1)}},"\u2662"),React.createElement("button",{className:`new-session-btn notification-settings-btn${ba?
" active":""}`,title:"Manage sessions","aria-label":"Manage sessions",onClick:()=>{ln(f&&(bn||!Kt.has(f))?f:$e(Ra[0])||""),
wt(o=>!o),kt(!1),ze(!1)}},"\u22EF"),React.createElement("button",{className:`new-session-btn${Bt?" active":""}`,title:"N\
ew session",onClick:()=>{kt(o=>!o),ze(!1),wt(!1)}},"+")),React.createElement("div",{className:"sidebar-session-search"},
React.createElement("input",{type:"search",value:ga,onChange:o=>Kn(o.target.value),placeholder:"Filter sessions","aria-l\
abel":"Filter sidebar sessions",autoComplete:"off",spellCheck:"false"}),ga&&React.createElement("button",{type:"button",
onClick:()=>Kn(""),"aria-label":"Clear sidebar filter",title:"Clear filter"},"x")),React.createElement("div",{className:`\
sidebar-order-control${Ro?" changed":""}`,"aria-hidden":!Ro,"aria-live":"polite"},React.createElement("span",null,"Order\
 changed"),React.createElement("button",{type:"button",onClick:Am,disabled:!Ro,tabIndex:Ro?0:-1},"Sort now")),st&&React.
createElement(Ab,{onClose:()=>ze(!1),onPreferencesChange:o=>{hs({...o,turn_ready:!1}),Ve(!0)}}),ba&&React.createElement(
Rb,{sessions:Ra,preferences:tt,initialSessionId:Mt,onSave:yo,onExport:Wi,onClose:()=>wt(!1)}),Bt&&React.createElement(kb,
{launchStates:h,onLaunch:(o,w,M)=>yt(o,w,M),onResume:(o,w,M,R)=>xt(o,w,M,R),onClose:()=>kt(!1),workspaces:Mi,showTestSessions:bn}),
React.createElement("div",{className:"session-list",ref:l,onPointerDown:K,onPointerUp:()=>ge(80),onPointerCancel:()=>ge(
80),onScroll:()=>{K(),ge(180)}},Oe.length===0&&!Bt&&React.createElement("div",{className:"session-empty"},"No agents con\
nected"),Oe.length>0&&ut&&Ta.length===0&&$a.length===0&&Ea.length===0&&Dl.length===0&&React.createElement("div",{className:"\
session-empty"},"No matching sessions"),pe.length>0&&React.createElement("section",{className:`session-group working-ses\
sion-group${ut&&Ta.length===0?" sidebar-group-filtered":""}`,"aria-label":"Working now"},React.createElement("div",{className:"\
session-group-header"},React.createElement("span",{className:"working-session-group-icon","aria-hidden":"true"},"W"),React.
createElement("span",{className:"session-group-name pinned-session-group-name"},"Working now"),React.createElement("span",
{className:"session-group-status-slot"},Cr.hasPrompt&&React.createElement("span",{className:"session-group-alert",title:"\
Action required"},"!"),React.createElement("span",{className:"session-group-working",title:"Sessions working"}),Cr.unread>
0&&React.createElement("span",{className:"session-group-unread",title:`${Cr.unread} unread`},Cr.unread>99?"99+":Cr.unread),
React.createElement("span",{className:"session-group-count"},Ta.length))),React.createElement("div",{className:"session-\
group-items"},React.createElement("div",{className:"session-group-items-inner"},pe.map(o=>Ho(o,!ut||Ta.includes(o)))))),
Le.length>0&&React.createElement("section",{className:`session-group recent-session-group${_n.__recent__&&!ut?" collapse\
d":""}${ut&&$a.length===0?" sidebar-group-filtered":""}`,"aria-label":"Recent chats"},React.createElement("div",{className:"\
session-group-header"},React.createElement("button",{type:"button",className:"session-group-toggle",title:`${_n.__recent__?
"Expand":"Collapse"} Recent chats`,"aria-label":`${_n.__recent__?"Expand":"Collapse"} Recent chats`,"aria-expanded":!_n.
__recent__||!!ut,onClick:()=>ko("__recent__")},React.createElement("span",{className:"session-group-caret","aria-hidden":"\
true"},_n.__recent__&&!ut?">":"v")),React.createElement("span",{className:"recent-session-group-icon","aria-hidden":"tru\
e"},"R"),React.createElement("span",{className:"session-group-name pinned-session-group-name"},"Recent chats"),React.createElement(
"span",{className:"session-group-status-slot"},La.hasPrompt&&React.createElement("span",{className:"session-group-alert",
title:"Action required"},"!"),La.working&&React.createElement("span",{className:"session-group-working",title:"Session w\
orking"}),La.unread>0&&React.createElement("span",{className:"session-group-unread",title:`${La.unread} unread`},La.unread>
99?"99+":La.unread),React.createElement("span",{className:"session-group-count"},$a.length))),React.createElement("div",
{className:"session-group-items"},React.createElement("div",{className:"session-group-items-inner"},Le.map(o=>Ho(o,!ut||
$a.includes(o)))))),vn.length>0&&React.createElement("section",{className:`session-group pinned-session-group${ut&&Ea.length===
0?" sidebar-group-filtered":""}`,"aria-label":"Pinned chats"},React.createElement("div",{className:"session-group-header"},
React.createElement("span",{className:"session-group-pin-icon","aria-hidden":"true"},"\u{1F4CC}"),React.createElement("s\
pan",{className:"session-group-name pinned-session-group-name"},"Pinned chats"),React.createElement("span",{className:"s\
ession-group-status-slot"},Pa.hasPrompt&&React.createElement("span",{className:"session-group-alert",title:"Action requi\
red"},"!"),Pa.working&&React.createElement("span",{className:"session-group-working",title:"Session working"}),Pa.unread>
0&&React.createElement("span",{className:"session-group-unread",title:`${Pa.unread} unread`},Pa.unread>99?"99+":Pa.unread),
React.createElement("span",{className:"session-group-count"},Ea.length))),React.createElement("div",{className:"session-\
group-items"},React.createElement("div",{className:"session-group-items-inner"},vn.map(o=>Ho(o,!ut||Ea.includes(o)))))),
as.map(o=>{let w=!!_n[o.key]&&!ut,R=Dl.find(Q=>Q.key===o.key)?.sessions||[],U=Js(R);return React.createElement("div",{className:`\
session-group${w?" collapsed":""}${ut&&R.length===0?" sidebar-group-filtered":""}`,key:o.key},React.createElement("div",
{className:"session-group-header"},React.createElement("button",{type:"button",className:"session-group-toggle",title:`${w?
"Expand":"Collapse"} ${o.label}`,"aria-label":`${w?"Expand":"Collapse"} ${o.label}`,"aria-expanded":!w,onClick:()=>ko(o.
key)},React.createElement("span",{className:"session-group-caret","aria-hidden":"true"},w?">":"v")),React.createElement(
mi,{title:o.label,disclosureKey:o.key,kind:"group",wrapperClassName:"session-group-title-details",triggerClassName:"sess\
ion-group-name",disclosureClassName:"session-group-disclosure",triggerLabel:`Show full group name: ${o.label}`}),React.createElement(
"span",{className:"session-group-status-slot"},U.hasPrompt&&React.createElement("span",{className:"session-group-alert",
title:"Action required"},"!"),U.working&&React.createElement("span",{className:"session-group-working",title:"Session wo\
rking"}),U.unread>0&&React.createElement("span",{className:"session-group-unread",title:`${U.unread} unread`},U.unread>99?
"99+":U.unread),React.createElement("span",{className:"session-group-count"},ut?R.length:o.sessions.length))),React.createElement(
"div",{className:"session-group-items","aria-hidden":w},React.createElement("div",{className:"session-group-items-inner"},
o.sessions.map(Q=>Ho(Q,!ut||R.includes(Q))))))}),zi.map(o=>{let w=$e(o);return uf(o,!!tt[w]?.pinned,xm.has(w)?"":Ma[w]||
"Unscoped")})),React.createElement("div",{className:"sidebar-footer"},React.createElement("span",{className:`status-dot ${Zl}`}),
React.createElement("span",{className:"sidebar-footer-health"},React.createElement("span",null,i?`Relay ${Zl}`:"Reconnec\
ting\u2026"),React.createElement("span",{className:"sidebar-footer-rtt"},i&&Fm.replace(/^\s*·\s*/,"")||"\xA0")),React.createElement(
"button",{type:"button",className:`sidebar-footer-action test-session-toggle${bn?" active":""}`,title:bn?"Hide test sess\
ions":`Show test sessions (${Kt.size})`,"aria-label":bn?"Hide test sessions":"Show test sessions","aria-pressed":bn,onClick:()=>Ui(
o=>!o)},"T",Kt.size>99?"99+":Kt.size||""),React.createElement("button",{type:"button",className:`sidebar-footer-action${Ns?
" active":""}`,title:"Usage and limits","aria-label":"Usage and limits",onClick:()=>{Ns||Ms(),Wt(o=>!o),hn(!1),It(!1),$n(
!1),kt(!1),ze(!1),wt(!1),zt(!1),En(!1),ft(!1)}},"\u25D4"),React.createElement("button",{type:"button",className:`sidebar\
-footer-action host-resource-footer-action${ns?" active":""}`,title:"Host resources","aria-label":"Host resources",onClick:()=>{
ns||Ms(),hn(o=>!o),Wt(!1),zt(!1),It(!1),$n(!1),kt(!1),ze(!1),wt(!1),En(!1),ft(!1)}},"R"),React.createElement("button",{type:"\
button",className:`sidebar-footer-action fleet-footer-action${Ss?" active":""}`,title:"Fleet view","aria-label":"Fleet v\
iew",onClick:()=>{Ss||Ms(),zt(o=>!o),Wt(!1),hn(!1),It(!1),$n(!1),kt(!1),ze(!1),wt(!1),En(!1),ft(!1)}},"\u25A6"),React.createElement(
"button",{type:"button",className:`sidebar-footer-action transcript-search-footer-action${Cs?" active":""}`,title:"Searc\
h all transcripts","aria-label":"Search all transcripts",onClick:()=>{Cs||Ms(),En(o=>!o),zt(!1),Wt(!1),hn(!1),It(!1),$n(
!1),kt(!1),ze(!1),wt(!1),ft(!1)}},"\u2315"),React.createElement("a",{href:"/agent-chat.apk",download:!0,className:"apk-d\
ownload-link",title:"Download Android APK"},"\u2B07 APK"))),React.createElement("div",{className:`main${gn||ws||Ns||ns||
Ss||Cs?" automations-active":""}`},React.createElement(tv,{connected:i,error:mr,history:sn,subscription:At,onRefresh:ot,
onSubscribe:fs,onUnsubscribe:fr,onOpen:()=>{ns||Ms(),hn(!0),Wt(!1),zt(!1),It(!1),$n(!1),kt(!1),ze(!1),wt(!1),En(!1),ft(!1)}}),
gn&&React.createElement(Yb,{sessions:e,onBack:()=>It(!1)}),ws&&React.createElement(lv,{skills:ur[f]||null,onRefresh:()=>f&&
ro(f),onBack:()=>$n(!1)}),va&&f&&React.createElement(Mb,{sessionId:f,initialContent:On,jobs:ke.filter(o=>o.session_id===
f),onSchedule:q,onCancel:et,onCreated:()=>Ia(f,""),onClose:()=>Yn(!1)}),Ns&&React.createElement(Jb,{usage:zn,refreshReceipt:Pi,
resetReceipt:qi,costDetail:Oi,onBack:()=>Wt(!1),onRefresh:ps,onConsumeResetCredit:Fs,onRequestCostDetail:Hs}),ns&&React.
createElement(nv,{snapshot:Ii,error:mr,history:sn,details:ms,subscription:At,onBack:()=>hn(!1),onRefresh:ot,onSubscribe:fs,
onUnsubscribe:fr}),Ss&&React.createElement(iv,{sessions:Ao,activities:S,thinking:b,permissionPrompts:g,errorPrompts:k,messages:t,
agentConfigs:H,sessionAttention:uo,health:A,connected:i,deliveryStates:N,onBroadcastSend:Ke,onBack:()=>zt(!1),onSelectSession:(o,w)=>{
qn(o,w),zt(!1)}}),Cs&&React.createElement(cv,{onBack:()=>En(!1),onOpenResult:qm}),!gn&&!ws&&!Ns&&!ns&&!Ss&&!Cs&&React.createElement(
React.Fragment,null,React.createElement("div",{className:"topbar"},React.createElement("button",{className:"hamburger",onClick:()=>ft(
o=>!o)},"\u2630",eu>0&&React.createElement("span",{className:"hamburger-badge"},eu),Oo>0&&React.createElement("span",{className:"\
hamburger-attention",title:`${Oo} session${Oo===1?"":"s"} need attention`,"aria-label":`${Oo} sessions need attention`},
"!")),React.createElement("div",{className:"topbar-context"},f?React.createElement(React.Fragment,null,React.createElement(
"div",{className:"topbar-title-row",role:"group","aria-label":`${Xe.name} chat: ${mc}`},React.createElement("div",{className:"\
agent-badge topbar-agent-badge",style:{color:Xe.color,borderColor:Xe.color+"55",background:Xe.color+"18"}},Xe.logo?React.
createElement("img",{src:Xe.logo,alt:Xe.abbr,className:"agent-badge-logo"}):Xe.abbr),React.createElement("div",{className:"\
topbar-title-group",style:{color:Xe.color}},React.createElement("div",{className:"topbar-title-projection","data-chat-ti\
tle-source":pc.source,"data-chat-title-field":pc.field},React.createElement(mi,{title:mc,disclosureKey:`topbar-${f}`,kind:"\
chat",wrapperClassName:"topbar-title-details",triggerClassName:"topbar-title",disclosureClassName:"topbar-title-disclosu\
re",triggerLabel:`Show full chat title: ${mc}`,triggerTag:"div"})),React.createElement("div",{className:"topbar-subtitle",
title:is||void 0},React.createElement("span",{className:"topbar-workspace-icon"},"\u2302"),Vm,j?.branch&&j.branch!=="unk\
nown"&&React.createElement("button",{className:`topbar-branch-btn${br?" active":""}`,title:`Branch: ${j.branch}`,onClick:()=>{
let o=!br;Sa(o),o&&Ti(f)}},React.createElement("span",{className:"topbar-branch-icon"},"\u2442"),j.branch)))),React.createElement(
"div",{className:"topbar-meta"},React.createElement("button",{className:"theme-toggle-btn",onClick:()=>Fi(o=>o==="light"?
"dark":"light"),title:"Toggle Light/Dark Mode"},Aa==="light"?"\u{1F319}":"\u2600\uFE0F"),React.createElement("span",{className:`\
context-pill topbar-relay-status ${i?"ok":"warn"}`,title:i?"Relay connected":"Relay disconnected \u2014 reconnecting"},i?
"relay live":"reconnecting"),React.createElement("span",{className:`context-pill topbar-proxy-health ${ea==="healthy"?"o\
k":ea==="degraded"?"warn":ea==="disconnected"?"error":""}`,title:`Proxy: ${ea||"connecting"}`},React.createElement("span",
{className:"topbar-health-dot"}),ea==="healthy"?"live":ea==="degraded"?"degraded":ea==="disconnected"?"offline":"connect\
ing"),mu&&React.createElement("span",{className:"context-pill",title:"Remote machine"},mu),fu&&React.createElement("span",
{className:"context-pill",title:"Native editor host"},fu),React.createElement(Q_,{session:I,config:j,providerUsage:zn,onOpenUsage:()=>{
Ms(),Wt(!0),hn(!1),zt(!1)}}),I?.agent_type==="codex"&&I?.visible_pane_visible&&React.createElement("span",{className:`co\
ntext-pill ${lc?"ok":"warn"}`,title:lc?"This Codex session is the visible right-hand pane":`Visible right-hand pane is ${iu}`},
lc?"right pane live":`right pane: ${pl(I.visible_pane_agent)||"other"}`),Ue.length>0&&React.createElement("span",{className:"\
context-pill",title:"Messages in this session"},Ue.length," msg",Ue.length!==1?"s":""),(j?.capabilities?.chat_list||Be)&&
React.createElement("button",{className:`context-pill chat-list-toggle${(Be?mn:pn)?" active":""}`,title:Be?`${mn?"Hide":
"Show"} Agent Manager projects and conversations`:"View conversations",onClick:()=>{if(Be){Ht(w=>!w),Ge(!1),me(f);return}
let o=!pn;Ge(o),o&&me(f)}},Be?"projects":"chats"),j?.capabilities?.thread_list&&React.createElement("button",{className:`\
context-pill chat-list-toggle${ht?" active":""}`,title:"View threads",onClick:()=>{let o=!ht;fn(o),o&&$(f)}},"threads"),
(j?.capabilities?.terminal_output||j?.capabilities?.terminal_input)&&React.createElement("button",{className:`context-pi\
ll terminal-toggle${_r?" active":""}`,title:"Open terminal controls",onClick:()=>{let o=!_r;Na(o),o&&j?.capabilities?.terminal_output&&
ce(f)}},"terminal"),j?.capabilities?.file_changes&&React.createElement("button",{className:`context-pill diff-toggle${Ut?
" active":""}`,title:"View file changes",onClick:()=>{let o=!Ut;ks(o),o&&Ne(f)}},"changes"),Bo?.visible&&React.createElement(
"span",{className:"context-pill ok",title:Bo.title||"Automation"},"automation"),j?.capabilities?.file_browser&&React.createElement(
"button",{className:`context-pill files-toggle${Gt?" active":""}`,title:"Browse workspace files",onClick:()=>{let o=!Gt;
yr(o),o&&(Xs(null),bo("."),ma(f,"."))}},"files"),j?.capabilities?.open_panel&&React.createElement("button",{className:"c\
ontext-pill open-panel-btn",title:"Open panel in Antigravity",onClick:()=>he(f)},"open panel"),j?.capabilities?.native_window&&
React.createElement("button",{className:"context-pill open-panel-btn",title:`Open this ${pl(I?.agent_type)||"CLI"} sessi\
on in a native command window`,onClick:o=>X(f,o)},"native"),qo&&qe?.label&&qe.label!=="Generating"&&React.createElement(
"span",{className:"context-pill thinking",title:qe.label},qe.label.length>40?qe.label.substring(0,40)+"\u2026":qe.label))):
React.createElement("div",{className:"topbar-title-group"},React.createElement("div",{className:"topbar-title"},"Agent C\
hat"),React.createElement("div",{className:"topbar-subtitle"},"Select a session to inspect its transcript and status")))),
(I?.agent_type==="cline"||I?.agent_type==="roo_code")&&_c&&React.createElement("div",{className:`cline-context-strip ${I?.
agent_type==="roo_code"?"roo-context-strip":""}`},React.createElement(hb,{card:_c,tone:I?.agent_type==="roo_code"?"roo":
"cline"})),br&&f&&j?.capabilities?.branch_list&&React.createElement(Pb,{branchData:so[f]||null,sessionId:f,currentBranch:j?.
branch,onSwitch:o=>{ao(f,o),Sa(!1)},onCreate:o=>{$i(f,o),Sa(!1)},onClose:()=>Sa(!1)}),Gt&&f&&j?.capabilities?.file_browser&&
React.createElement(zb,{sessionId:f,listing:Li[f],fileContents:dr,viewingFile:Ca,onNavigate:o=>{bo(o),Xs(null),ma(f,o)},
onOpenFile:o=>{Xs(o),Un(f,o)},onBackToListing:()=>Xs(null),onRefresh:()=>{Ca?Un(f,Ca):ma(f,ji)},onClose:()=>{yr(!1),Xs(null)}}),
React.createElement("div",{className:`messages-wrap${Bo?.visible?" has-automation-pane":""}`,style:Gt?{display:"none"}:void 0},
rf&&React.createElement(Lb,{threads:of,activeThreadId:Tn[f]||null,showDraftTab:!!Mn[f]||Ir,newLabel:fc,onSwitch:o=>vc(f,
o),onNew:()=>Fo(f),onOpenHistory:()=>{$(f),fn(!0)}}),Jm&&React.createElement("div",{className:"last-user-banner",title:gc},
React.createElement("span",{className:"last-user-banner-icon"},"\u21B5"),React.createElement("span",{className:"last-use\
r-banner-text"},gc)),Ym&&React.createElement("div",{className:"rate-limit-overlay warning"},React.createElement("span",{
className:"rate-limit-icon"},"\u2318"),React.createElement("span",{className:"rate-limit-text"},"The visible right-hand \
pane for this workspace is showing ",React.createElement("strong",null,cu||or(yn,$e(yn))),", not this transcript."),React.
createElement("button",{className:"context-pill",onClick:()=>qn($e(yn),yn),title:"Switch to the live right-hand pane ses\
sion"},"View live pane")),Um&&React.createElement("div",{className:`agv2-session-nav${mn?"":" collapsed"}`},React.createElement(
"div",{className:"agv2-session-nav-header"},React.createElement("div",{className:"agv2-session-nav-copy"},React.createElement(
"span",{className:"agv2-session-nav-title"},"Agent Manager"),React.createElement("span",{className:"agv2-session-nav-met\
a"},ru," conversation",ru===1?"":"s")),React.createElement("button",{className:"agv2-session-nav-btn",type:"button",onClick:()=>me(
f),title:"Refresh Agent Manager conversations"},"Refresh"),React.createElement("button",{className:"agv2-session-nav-btn",
type:"button",onClick:()=>{Ht(o=>!o),me(f)},title:mn?"Hide Agent Manager conversations":"Show Agent Manager conversation\
s"},mn?"Hide":"Show")),mn&&React.createElement(fl,{items:au,embedded:!0,loading:!ic,onNavigate:o=>yc(o),onNew:()=>ta(f)})),
xn&&!Ts&&React.createElement("button",{className:"jump-to-newest",onClick:Em},An>0?`\u2193 ${An} new`:"\u2193 Jump to Newest"),
React.createElement("div",{className:`messages harness-theme harness-theme-${ae(I?.agent_type||"default").replace(/[^a-z0-9_-]/gi,
"-")}`,"data-agent-type":I?.agent_type||"default","data-layout":G_(I?.agent_type),"data-transcript-windowed":Fe.enabled?
"true":"false","data-total-message-count":os.length,"data-window-start":Fe.start,"data-window-end":Fe.end,key:cf,ref:Vt},
nf&&React.createElement("div",{className:"messages-flex-spacer"}),Et&&React.createElement(bb,{prompt:Et,sessionId:f,agentType:I?.
agent_type,onRespond:_,onDismissFocus:()=>Pn.current?.focus()}),Lr&&!Et&&React.createElement(vb,{prompt:Lr,sessionId:f,onRespond:T}),
(I?.rate_limit_active||I?.percent_used!=null&&I.percent_used>=75)&&React.createElement("div",{className:`rate-limit-over\
lay${I?.rate_limit_active||I?.percent_used>=90?" critical":I?.percent_used>=75?" warning":""}`},React.createElement("spa\
n",{className:"rate-limit-icon"},I?.rate_limit_active?"\u23F3":"\u{1F4CA}"),React.createElement("span",{className:"rate-\
limit-text"},I?.rate_limit_active?React.createElement(React.Fragment,null,"Rate limited",I.rate_limited_until&&I.rate_limited_until!==
"unknown"?React.createElement(React.Fragment,null," \u2014 resets ",React.createElement("strong",null,to(I.rate_limited_until))):
null):React.createElement(React.Fragment,null,"Used ",React.createElement("strong",null,I.percent_used,"%")," of session\
 limit",I.rate_limited_until&&I.rate_limited_until!=="unknown"?React.createElement(React.Fragment,null," \xB7 resets ",React.
createElement("strong",null,to(I.rate_limited_until))):null))),bc&&React.createElement("div",{className:"history-tail-ba\
nner"},React.createElement("span",null,"Showing latest ",wu.toLocaleString()," of ",ef.toLocaleString()," messages"),React.
createElement("button",{type:"button",onClick:Nu,disabled:!!Fa},Fa?"Loading older messages...":"Load older messages")),f?
Ue.length===0&&!dt&&Wa&&I?.is_list_view&&B[f]?.length>0&&!Mn[f]&&!Ir?React.createElement("div",{className:"thread-picker\
-empty"},React.createElement("div",{className:"thread-picker-header"},"Select a chat"),React.createElement("div",{className:"\
thread-picker-list"},B[f].map((o,w)=>React.createElement("button",{key:o.cache_key||o.id||w,className:`thread-picker-ite\
m${o.active?" active":""}`,onClick:()=>{vc(f,o.id)},title:o.title},React.createElement("span",{className:"thread-picker-\
title"},o.title||"Untitled"),o.age&&React.createElement("span",{className:"thread-picker-age"},o.age)))),React.createElement(
"button",{className:"thread-picker-new",onClick:()=>Fo(f)},"+ New Thread")):Ue.length===0&&!dt&&Be&&I?.is_list_view?React.
createElement("div",{className:"thread-picker-empty agv2-picker-empty"},React.createElement("div",{className:"thread-pic\
ker-header"},"Choose a conversation or start a new one"),mn?null:G[f]?.length>0?React.createElement(fl,{items:G[f]||[],embedded:!0,
loading:!ic,onNavigate:o=>yc(o),onNew:()=>ta(f)}):React.createElement("button",{className:"thread-picker-new",onClick:()=>ta(
f)},"+ New Conversation")):Ue.length===0&&!dt&&Be&&G[f]?.length>0?React.createElement("div",{className:"thread-picker-em\
pty agv2-picker-empty"},React.createElement("div",{className:"thread-picker-header"},"Select an Antigravity project or c\
onversation"),!mn&&React.createElement(fl,{items:G[f]||[],embedded:!0,loading:!ic,onNavigate:o=>yc(o),onNew:()=>ta(f)})):
Ue.length===0&&!dt&&I?.is_list_view&&G[f]?.length>0?React.createElement("div",{className:"thread-picker-empty"},React.createElement(
"div",{className:"thread-picker-header"},"Select a conversation or type a new message"),React.createElement("div",{className:"\
thread-picker-list"},G[f].map((o,w)=>React.createElement("button",{key:o.id||w,className:`thread-picker-item${o.active?"\
 active":""}`,onClick:()=>J(f,o.id),title:o.title},React.createElement("span",{className:"thread-picker-title"},o.title||
"Untitled"))))):Ue.length===0&&!dt&&Qt?.error?React.createElement("div",{className:"empty-state history-error-state"},React.
createElement("div",{className:"icon"},"\u26A0"),React.createElement("div",null,Qt.error),React.createElement("button",{
type:"button",className:"thread-picker-new",onClick:tf},"Retry transcript")):Ue.length===0&&!dt&&Fa?React.createElement(
"div",{className:"empty-state history-loading-state"},React.createElement("span",{className:"new-session-spinner"}),React.
createElement("div",null,Fa.mode==="older"?"Loading older messages...":"Loading latest messages...")):Ue.length===0&&!dt?
React.createElement("div",{className:"empty-state"},React.createElement("div",{className:"icon"},"\u{1F4AC}"),React.createElement(
"div",null,"No messages yet")):React.createElement(React.Fragment,null,Fe.enabled&&React.createElement("div",{className:"\
transcript-window-spacer top","data-testid":"transcript-window-top-spacer",style:{height:`${Fe.topSpacerHeight}px`}}),af,
Fe.enabled&&React.createElement("div",{className:"transcript-window-spacer bottom","data-testid":"transcript-window-bott\
om-spacer",style:{height:`${Fe.bottomSpacerHeight}px`}})):React.createElement("div",{className:"empty-state"},React.createElement(
"div",{className:"icon"},"\u{1F916}"),React.createElement("div",null,"Select an agent session")),dt&&React.createElement(
nb,{stream:dt,activeAgent:Xe,monospace:Or}),yu&&React.createElement("div",{className:`message assistant live-draft${Or?"\
 monospace":""}`,"data-message-role":"assistant","data-message-timestamp":In(qe?.started_at||qe?.updated_at)?.iso||"unkn\
own"},React.createElement("div",{className:"assistant-gutter"},React.createElement("div",{className:"agent-badge transcr\
ipt-agent-badge",style:{color:Xe.color,borderColor:Xe.color+"55",background:Xe.color+"18"}},Xe.logo?React.createElement(
"img",{src:Xe.logo,alt:Xe.abbr,className:"agent-badge-logo"}):Xe.abbr)),React.createElement("div",{className:"assistant-\
content"},React.createElement("div",{className:"message-role"},React.createElement("span",{className:"message-role-label"},
Xe.name),React.createElement(Ci,{instant:qe?.started_at||qe?.updated_at})),React.createElement(Ya,{content:Ua,monospace:Or,
autoExpandLongCodeBlocks:cc,onOpenPath:o=>hc("live-draft",o)}))),Jl&&!Et&&React.createElement(yb,{prompt:Jl,sessionId:f,
onRespond:T}),React.createElement("div",{ref:Tm})),React.createElement(Xb,{view:Bo,onShow:()=>f&&Ei(f)})),(qe?.task_list||
ku)&&!Gt&&React.createElement("div",{className:"transcript-live-footer","data-testid":"transcript-live-footer"},qe?.task_list&&
!qe?.step&&React.createElement("div",{className:"session-tasklist-strip"},React.createElement(gb,{taskList:qe.task_list,
sessionId:f})),ku&&React.createElement("div",{className:"composer-live-status-strip"},React.createElement(fb,{activity:qe,
thinkingText:f&&y[f]||"",agentType:I?.agent_type,pinned:!0}))),go&&f&&React.createElement(Tb,{session:I||f,config:j,configControlStates:V,
onRequestRefresh:ne,onSetModel:(o,w)=>ee(o,w),onSetEffort:(o,w)=>re(o,w),onSetPermissionMode:(o,w)=>z(o,w),onSetAutoApprovePermissions:(o,w)=>oe(
o,w),onSetMode:(o,w)=>_e&&_e(o,w),onSetCodexConfig:o=>Y(f,o),onSwitchWorkspace:(o,w)=>te(o,w),onClose:()=>ka(!1)}),!1,pn&&
f&&j?.capabilities?.chat_list&&!Be&&React.createElement($b,{chats:G[f]||[],sessionId:f,onSwitch:o=>{J(f,o),Ge(!1)},onNew:()=>{
W(f),Ge(!1)},onClose:()=>Ge(!1)}),ht&&f&&j?.capabilities?.thread_list&&React.createElement(Eb,{threads:B[f]||[],sessionId:f,
newLabel:fc,onSwitch:o=>{vc(f,o),fn(!1)},onNew:()=>{Fo(f),fn(!1)},onClose:()=>fn(!1)}),!Gt&&_r&&f&&(j?.capabilities?.terminal_output||
j?.capabilities?.terminal_input)&&React.createElement(qb,{entries:be[f]||[],canRead:!!j?.capabilities?.terminal_output,canInput:!!j?.
capabilities?.terminal_input,onRefresh:()=>ce(f),onSend:o=>ie(f,o),controlResults:pa,onClose:()=>Na(!1)}),!Gt&&Ut&&f&&j?.
capabilities?.file_changes&&React.createElement(Ob,{entries:Ee[f]||[],onRefresh:()=>Ne(f),onAccept:o=>Se(f,o,"accept"),onReject:o=>Se(
f,o,"reject"),onClose:()=>ks(!1)}),React.createElement("div",{className:`input-area composer-skin-${Fp(I?.agent_type)}`,
"data-composer-skin":Fp(I?.agent_type),style:Gt?{display:"none"}:void 0},React.createElement("label",{className:`attach-\
btn ${!f||!i||Ts?"disabled":""}`,title:"Attach file"},React.createElement("svg",{width:"18",height:"18",viewBox:"0 0 24 \
24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"},React.createElement(
"path",{d:"M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-\
8.48"})),React.createElement("input",{type:"file",hidden:!0,multiple:!0,ref:$m,onChange:Om,disabled:!f||!i||!!Ts})),React.
createElement("div",{className:"input-col"},rc.length>0&&React.createElement("div",{className:"file-chips"},rc.map((o,w)=>React.
createElement("div",{key:w,className:"file-chip"},React.createElement("span",null,"\u{1F4C4} ",o.name,o.isText?"":" (upl\
oaded)"),React.createElement("button",{onClick:()=>Pm(f,w)},"\xD7")))),ct&&Io.length>0&&React.createElement("div",{className:"\
slash-menu"},Io.map(o=>React.createElement("button",{key:o.command,type:"button",className:"slash-item",onClick:()=>Cu(o.
command)},React.createElement("span",{className:"slash-command"},o.command),React.createElement("span",{className:"slash\
-detail"},o.detail)))),f&&(se[f]||[]).length>0&&React.createElement("div",{className:"queued-bar"},(se[f]||[]).map(o=>React.
createElement(lb,{key:o.cid,qm:o,onSteer:()=>de(f,o.cid,o.content,o.nativeIndex),onDiscard:()=>Ze(f,o.cid),onEdit:w=>D(f,
o.cid,w)}))),React.createElement("div",{className:"textarea-row"},React.createElement("textarea",{ref:Pn,value:On,onChange:o=>lf(
o.target.value),onKeyDown:jm,onPaste:Im,placeholder:Ts?`Resolve the ${Et?.type==="question_prompt"?"question":Et?"permis\
sion prompt":"error prompt"} above to continue`:f?window.innerWidth<600?"Enter message\u2026":"Message\u2026 (/ for commands)":
"Select a session",disabled:!f||!!Ts,rows:1}),React.createElement("div",{className:"textarea-btns"},f&&React.createElement(
"button",{className:`composer-gear-btn schedule-send-btn${va?" active":""}`,onClick:()=>Yn(o=>!o),title:"Schedule this m\
essage","aria-label":"Schedule message"},"\u25F7"),f&&React.createElement("button",{className:`composer-gear-btn${we?" a\
ctive":""}`,onClick:()=>_s(o=>!o),title:"Toggle settings"},"\u2699"),du&&React.createElement("button",{className:"compos\
er-gear-btn mobile-hide",onClick:()=>Fo(f),title:fc},"\u270E"),(j?.capabilities?.chat_list||Be)&&React.createElement("bu\
tton",{className:`composer-gear-btn mobile-hide${(Be?mn:pn)?" active":""}`,onClick:()=>{if(Be){Ht(w=>!w),Ge(!1),me(f);return}
let o=!pn;Ge(o),o&&me(f)},title:Be?"Agent Manager conversations":"Chat history"},"\u2630"),j?.capabilities?.thread_list&&
React.createElement("button",{className:`composer-gear-btn mobile-hide${ht?" active":""}`,onClick:()=>{let o=!ht;fn(o),o&&
$(f)},title:"Thread history"},"\u229F"),j?.capabilities?.open_panel&&React.createElement("button",{className:"composer-g\
ear-btn mobile-hide",onClick:()=>he(f),title:"Open panel"},"\u229E"),j?.capabilities?.native_window&&React.createElement(
"button",{className:"composer-gear-btn mobile-hide",onClick:o=>X(f,o),title:"Open native command window"},"cmd"),j?.capabilities?.
new_chat&&React.createElement("button",{className:"composer-gear-btn mobile-hide",onClick:()=>Be?ta(f):W(f),title:Be?"Ne\
w Antigravity conversation":"New chat"},"+"),qo?React.createElement("button",{className:`stop-btn${ja?" pending":""}`,title:ja?
"Interrupting\u2026":"Interrupt agent",disabled:ja,onClick:ac},ja?React.createElement("span",{className:"stop-btn-spinne\
r"}):"\u25A0"):React.createElement("button",{className:"send-btn",onClick:Xl,disabled:!Bm,title:i?"Send":"Queue until re\
connected"},on?"\u2026":"\u2191"))),React.createElement("div",{className:"composer-meta"},Zn===f&&qo&&!ja&&React.createElement(
"span",{className:"interrupt-confirm-inline",role:"status","aria-live":"polite"},"Press Esc again or Enter to interrupt"),
(bl(I?.agent_type)||Jr(I?.agent_type))&&j?.mode&&j.mode!=="unknown"&&React.createElement("span",{className:"composer-hin\
t",style:{color:"#d29922"}},j.mode),(bl(I?.agent_type)||Jr(I?.agent_type))&&j?.model_id&&j.model_id!=="unknown"&&React.createElement(
"span",{className:"composer-hint",style:{color:"#d29922"}},j.model_id),I?.agent_type==="codex_cli"&&j?.config_semantics===
"observed_and_next_send"&&React.createElement("span",{className:"composer-hint",style:{color:"#8b949e"}},"Observed ",j.observed_model_id||
"unknown"," / ",j.observed_effort||"unknown"," \xB7 ","Next ",j.next_send_model_id||"unset"," / ",j.next_send_effort||"u\
nset"),I?.agent_type==="antigravity-v2"&&j?.model_id&&j.model_id!=="unknown"&&React.createElement("span",{className:"com\
poser-hint",style:{color:"#8b949e"}},j.model_id),(I?.agent_type==="antigravity"||I?.agent_type==="antigravity_panel")&&(Array.
isArray(I?.antigravity_quota_models)&&I.antigravity_quota_models.length>0?React.createElement("span",{className:"compose\
r-hint",style:{color:"#8b949e"}},gm(I.antigravity_quota_models,4)):I?.percent_used!=null?React.createElement("span",{className:"\
composer-hint",style:{color:I.percent_used>=90?"#f85149":I.percent_used>=75?"#d29922":"#8b949e"}},"Quota ",I.percent_used,
"%",I?.rate_limited_until&&I.rate_limited_until!=="unknown"?` \xB7 ${I.rate_limited_until}`:""):null),React.createElement(
"span",{className:"composer-hint"},"Enter send"),React.createElement("span",{className:"composer-hint"},"Shift+Enter new\
line"),React.createElement("span",{className:"composer-hint"},"Ctrl/Cmd+K focus"),React.createElement("span",{className:"\
composer-hint"},"/ commands"),React.createElement("span",{className:"composer-hint"},"Ctrl+V image"),f&&On&&React.createElement(
"span",{className:"composer-hint draft-live"},"draft saved")),f&&React.createElement("div",{className:`composer-settings${we?
" is-open":""}`},(su||Do)&&React.createElement("div",{className:`composer-control-state ${Do?"failed":"pending"}`,role:"\
status"},Do?Do.error:`Saving ${su.field.replace(/_/g," ")}\u2026`),(j?.capabilities?.set_model||I?.agent_type==="antigra\
vity"||I?.agent_type==="antigravity_panel")&&React.createElement(React.Fragment,null,I?.agent_type==="codex_cli"&&j?.config_semantics===
"observed_and_next_send"&&React.createElement("span",{className:"composer-setting-label","data-control":"observed-model"},
React.createElement("span",{className:"composer-setting-key"},"Observed model"),React.createElement("span",{className:"c\
omposer-hint"},j.observed_model_id||"unknown")),React.createElement("label",{className:"composer-setting-label","data-co\
ntrol":"model"},React.createElement("span",{className:"composer-setting-key"},I?.agent_type==="codex_cli"&&j?.config_semantics===
"observed_and_next_send"?"Next model":"Model"),React.createElement("select",{className:"composer-setting-select",value:I?.
agent_type==="codex_cli"&&j?.config_semantics==="observed_and_next_send"?j.next_send_model_id||"":j?.model_id||"default",
onChange:o=>ee(f,o.target.value)},I?.agent_type==="codex_cli"&&j?.config_semantics==="observed_and_next_send"&&React.createElement(
"option",{value:"",disabled:!0},"Choose model\u2026"),Jp(I?.agent_type,j).map(o=>React.createElement("option",{key:o.id,
value:o.id},o.label)),j?.model_id&&!Jp(I?.agent_type,j).some(o=>o.id===j.model_id)&&j.model_id!=="unknown"&&j.config_semantics!==
"observed_and_next_send"&&React.createElement("option",{value:j.model_id},j.model_id)),I?.agent_type==="codex_cli"&&j?.config_semantics===
"observed_and_next_send"&&React.createElement("span",{className:"composer-hint"},j.next_send_model_status||"unset"))),(I?.
agent_type==="antigravity"||I?.agent_type==="antigravity_panel")&&React.createElement("label",{className:"composer-setti\
ng-label","data-control":"mode"},React.createElement("span",{className:"composer-setting-key"},"Mode"),React.createElement(
"select",{className:"composer-setting-select",value:j?.conversation_mode||"Planning",onChange:o=>_e(f,o.target.value)},El.
map(o=>React.createElement("option",{key:o.id,value:o.id},o.label)))),(Jr(I?.agent_type)||I?.agent_type==="cursor")&&j?.
capabilities?.set_mode&&Qr(I?.agent_type,j).length>0&&React.createElement("label",{className:"composer-setting-label","d\
ata-control":"mode"},React.createElement("span",{className:"composer-setting-key"},"Mode"),React.createElement("select",
{className:"composer-setting-select",value:j?.mode||Qr(I?.agent_type,j)[0]?.id||"unknown",onChange:o=>_e(f,o.target.value)},
Qr(I?.agent_type,j).map(o=>React.createElement("option",{key:o.id,value:o.id},o.label)),j?.mode&&j.mode!=="unknown"&&!Qr(
I?.agent_type,j).some(o=>o.id===j.mode)&&React.createElement("option",{value:j.mode},j.mode))),j?.capabilities?.permission_mode_change&&
React.createElement("label",{className:"composer-setting-label","data-control":"permission"},React.createElement("span",
{className:"composer-setting-key"},I?.agent_type==="codex_cli"?"Access":"Permission"),React.createElement("select",{className:"\
composer-setting-select",value:j.permission_mode||vm(I?.agent_type),onChange:o=>z(f,o.target.value),title:"Permission mo\
de"},wl(I?.agent_type||"claude",j).map(o=>React.createElement("option",{key:o.value,value:o.value},o.label)),j.permission_mode&&
!wl(I?.agent_type,j).some(o=>o.value===j.permission_mode)&&j.permission_mode!=="unknown"&&React.createElement("option",{
value:j.permission_mode},j.permission_mode))),(I?.agent_type==="claude_cli"||I?.agent_type==="codex_cli"||I?.agent_type===
"cursor_cli")&&j?.capabilities?.set_effort&&(j.available_efforts||[]).length>0&&React.createElement(React.Fragment,null,
I?.agent_type==="codex_cli"&&j?.config_semantics==="observed_and_next_send"&&React.createElement("span",{className:"comp\
oser-setting-label","data-control":"observed-effort"},React.createElement("span",{className:"composer-setting-key"},"Obs\
erved effort"),React.createElement("span",{className:"composer-hint"},j.observed_effort||"unknown")),React.createElement(
"label",{className:"composer-setting-label","data-control":"effort"},React.createElement("span",{className:"composer-set\
ting-key"},I?.agent_type==="codex_cli"&&j?.config_semantics==="observed_and_next_send"?"Next effort":"Effort"),React.createElement(
"select",{className:"composer-setting-select",value:I?.agent_type==="codex_cli"&&j?.config_semantics==="observed_and_nex\
t_send"?j.next_send_effort||"":j.effort||"medium",onChange:o=>re(f,o.target.value),title:`${I?.agent_type==="codex_cli"?
"Codex":I?.agent_type==="cursor_cli"?"Cursor":"Claude"} CLI effort`},I?.agent_type==="codex_cli"&&j?.config_semantics===
"observed_and_next_send"&&React.createElement("option",{value:"",disabled:!0},"Choose effort\u2026"),(j.available_efforts||
[]).map(o=>React.createElement("option",{key:o.id,value:o.id},o.label))),I?.agent_type==="codex_cli"&&j?.config_semantics===
"observed_and_next_send"&&React.createElement("span",{className:"composer-hint"},j.next_send_effort_status||"unset"))),j?.
capabilities?.auto_approve_permissions_toggle&&React.createElement("label",{className:"composer-setting-toggle",title:"A\
utomatically approve permission prompts for this session"},React.createElement("input",{type:"checkbox",checked:typeof j?.
auto_approve_permissions=="boolean"?j.auto_approve_permissions:!!I?.auto_approve_permissions,onChange:o=>oe(f,o.target.checked)}),
React.createElement("span",null,"Auto-approve prompts")),j?.capabilities?.set_codex_config&&React.createElement(React.Fragment,
null,j?.capabilities?.codex_model_change&&React.createElement("label",{className:"composer-setting-label","data-control":"\
model"},React.createElement("span",{className:"composer-setting-key"},I?.agent_type==="codex"?"Next model":"Model"),React.
createElement("select",{className:"composer-setting-select",value:j.model_id||"unknown",disabled:I?.agent_type==="codex"&&
j.controls_available===!1||["pending","awaiting_config"].includes(V?.[`${f}:model`]?.status),onChange:o=>Y(f,{model_id:o.
target.value}),title:I?.agent_type==="codex"?"Next-turn Codex model":"Codex Desktop model"},(j.available_models||[]).map(
o=>React.createElement("option",{key:o.id,value:o.id},o.label)),j.model_id&&!(j.available_models||[]).some(o=>o.id===j.model_id)&&
j.model_id!=="unknown"&&React.createElement("option",{value:j.model_id},j.model_id))),j?.capabilities?.codex_effort_change&&
React.createElement("label",{className:"composer-setting-label","data-control":"effort"},React.createElement("span",{className:"\
composer-setting-key"},I?.agent_type==="codex"?"Next effort":"Effort"),React.createElement("select",{className:"composer\
-setting-select",value:(j.effort||"unknown").toLowerCase(),disabled:I?.agent_type==="codex"&&j.controls_available===!1||
["pending","awaiting_config"].includes(V?.[`${f}:effort`]?.status),onChange:o=>Y(f,{effort:o.target.value}),title:I?.agent_type===
"codex"?"Next-turn reasoning effort":"Codex Desktop reasoning effort"},(j.available_efforts||[]).map(o=>React.createElement(
"option",{key:o.id,value:o.id},o.label)))),j?.capabilities?.codex_permission_profile_change&&React.createElement("label",
{className:"composer-setting-label","data-control":"permission-profile"},React.createElement("span",{className:"composer\
-setting-key"},"Next permissions"),React.createElement("select",{className:"composer-setting-select",value:j.permission_profile||
"unknown",disabled:j.controls_available===!1||["pending","awaiting_config"].includes(V?.[`${f}:permission_profile`]?.status),
onChange:o=>Y(f,{permission_profile:o.target.value}),title:"Next-turn native Codex permissions profile"},j.permission_profile===
"full-access"&&React.createElement("option",{value:"full-access",disabled:!0},"Full access"),(j.available_permission_profiles||
[]).filter(o=>o.id!=="full-access").map(o=>React.createElement("option",{key:o.id,value:o.id},o.label)))),j?.capabilities?.
codex_bypass_permissions&&React.createElement("button",{type:"button",className:"composer-desktop-action composer-bypass\
-action",onClick:()=>{ka(!0),_s(!1)},title:"Review and confirm Full access in Session Settings"},j.bypass_permissions_active?
"Bypass active":"Bypass\u2026"),j?.capabilities?.codex_speed_change&&React.createElement("label",{className:"composer-se\
tting-label","data-control":"speed"},React.createElement("span",{className:"composer-setting-key"},"Speed"),React.createElement(
"select",{className:"composer-setting-select",value:(j.speed||"standard").toLowerCase(),onChange:o=>Y(f,{speed:o.target.
value}),title:"Speed"},(j.available_speeds||[]).map(o=>React.createElement("option",{key:o.id,value:o.id},o.label)),j.speed&&
!(j.available_speeds||[]).some(o=>o.id===j.speed)&&j.speed!=="unknown"&&React.createElement("option",{value:j.speed},j.speed))),
j?.capabilities?.codex_access_change&&React.createElement("label",{className:"composer-setting-label","data-control":"pe\
rmission"},React.createElement("span",{className:"composer-setting-key"},"Access"),React.createElement("select",{className:"\
composer-setting-select",value:j.permission_mode||"unknown",onChange:o=>Y(f,{access_mode:o.target.value}),title:"Codex D\
esktop access mode"},(j.available_access||[]).map(o=>React.createElement("option",{key:o.id,value:o.id},o.label)),j.permission_mode&&
!(j.available_access||[]).some(o=>o.id===j.permission_mode)&&j.permission_mode!=="unknown"&&React.createElement("option",
{value:j.permission_mode},j.permission_mode))),I?.agent_type==="codex-desktop"&&(j.available_workspaces||[]).length>0&&React.
createElement("select",{className:"composer-setting-select",value:j.file_access_scope||"",onChange:o=>te(f,o.target.value),
title:"Switch workspace"},(j.available_workspaces||[]).map(o=>React.createElement("option",{key:o.id,value:o.path||o.id},
o.label)))),is&&React.createElement("span",{className:"composer-workspace",title:is},"\u2302 ",lu||is),React.createElement(
"button",{className:"composer-desktop-action",onClick:()=>{ka(!0),_s(!1)}},"\u2699 Session details"),React.createElement(
"div",{className:"composer-mobile-actions"},React.createElement("button",{className:"composer-mobile-action",onClick:()=>{
ka(!0),_s(!1)}},"\u2699 Session details"),du&&React.createElement("button",{className:"composer-mobile-action",onClick:()=>ve(
f)},"\u270E New thread"),(j?.capabilities?.chat_list||Be)&&React.createElement("button",{className:"composer-mobile-acti\
on",onClick:()=>{me(f),Be?(Ht(!0),Ge(!1)):Ge(!0),_s(!1)}},"\u2630 ",Be?"Projects":"Chat history"),j?.capabilities?.thread_list&&
React.createElement("button",{className:"composer-mobile-action",onClick:()=>{$(f),fn(!0),_s(!1)}},"\u229F Threads"),j?.
capabilities?.open_panel&&React.createElement("button",{className:"composer-mobile-action",onClick:()=>he(f)},"\u229E Open pa\
nel"),j?.capabilities?.new_chat&&React.createElement("button",{className:"composer-mobile-action",onClick:()=>Be?ta(f):W(
f)},"+ New chat"))))))),Rt&&React.createElement("div",{className:"attention-toast",role:"status","aria-live":"polite"},React.
createElement("span",{className:`attention-toast-icon ${Rt.kind}`,"aria-hidden":"true"},Rt.kind==="prompt"||["goal_atten\
tion","provider_usage_threshold"].includes(Rt.kind)?"!":"\u2713"),React.createElement("span",{className:"attention-toast\
-copy"},React.createElement("strong",null,Rt.title),React.createElement("span",null,Rt.detail)),React.createElement("but\
ton",{type:"button",onClick:()=>{let o=Oe.find(w=>$e(w)===Rt.sessionId);o&&qn(Rt.sessionId,o),Vl()}},"Jump")),React.createElement(
"div",{className:`toast ${Ws?"visible":""}`},Ws))}var wm=(()=>{try{return new URLSearchParams(window.location.search).get("render_profile")==="1"}catch{return!1}})();function dv(e,t,n,s,a,i){
let c=window.__RAC_RENDER_PROFILER__||(window.__RAC_RENDER_PROFILER__=[]);c.push({id:e,phase:t,route:document.querySelector(
'[data-testid="fleet-view"]')?"fleet":document.querySelector('[data-testid="usage-dashboard"]')?"usage":document.querySelector(
'[data-testid="host-resource-dashboard"]')?"host-resources":document.querySelector(".messages")?"chat":"other",actual_duration_ms:Number(
n.toFixed(3)),base_duration_ms:Number(s.toFixed(3)),start_time_ms:Number(a.toFixed(3)),commit_time_ms:Number(i.toFixed(3))}),
c.length>2e3&&c.splice(0,c.length-2e3)}var am=React.createElement(Sl,null,React.createElement(uv,null));ReactDOM.createRoot(
document.getElementById("root")).render(wm?React.createElement(React.Profiler,{id:"AgentChatRoot",onRender:dv},am):am);"serviceWorker"in navigator&&window.addEventListener("load",function(){navigator.serviceWorker.register("/sw.js").catch(
function(e){console.warn("SW registration failed:",e)})});(window.navigator.standalone===!0||window.matchMedia("(display\
-mode: standalone)").matches)&&document.body.classList.add("pwa-standalone");})();
