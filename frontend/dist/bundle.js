(()=>{var B_=Object.create;var bm=Object.defineProperty;var F_=Object.getOwnPropertyDescriptor;var H_=Object.getOwnPropertyNames;var z_=Object.getPrototypeOf,U_=Object.prototype.hasOwnProperty;var ym=(e,t)=>()=>(t||e((t={exports:{}}).exports,t),t.exports);var G_=(e,t,n,s)=>{if(t&&typeof t=="object"||typeof t=="function")for(let a of H_(t))!U_.call(e,a)&&a!==n&&bm(e,a,{get:()=>t[a],
enumerable:!(s=F_(t,a))||s.enumerable});return e};var vm=(e,t,n)=>(n=e!=null?B_(z_(e)):{},G_(t||!e||!e.__esModule?bm(n,"default",{value:e,enumerable:!0}):n,e));var Zf=ym((HS,Jf)=>{"use strict";var Qf=new Set([9223,9225,9240]);function qy(e){return e&&typeof e=="object"&&!Array.isArray(
e)?e:{}}function Dy({agentType:e,capabilities:t,session:n}={}){let s=qy(t),a=e==="codex-desktop",o=Number(n?.cdp_port??n?.
cdpPort??0),c=a&&(!Number.isInteger(o)||o<=0||Qf.has(o)),u=a&&(s.write_restricted_due_to_revalidation===!0||s.read_only_due_to_revalidation===
!0||!!s.write_capability_gate),m=s.switch_thread===!0,f=a?m&&!c&&!u:m,v=[];if(c&&v.push(Number.isInteger(o)&&o>0?`protec\
ted Codex Desktop session on CDP ${o}`:"Codex Desktop session ownership is not proven"),u){let k=String(s.write_capability_gate||
"").trim(),R=String(s.revalidation_version||"").trim();v.push(k||`Codex Desktop${R?` ${R}`:""} has not passed full write\
 revalidation`)}else a&&!m&&v.push("native thread switching is not advertised by this session");return{threadListAvailable:s.
thread_list===!0,localArchiveViewEnabled:a&&s.thread_list===!0,nativeSwitchAdvertised:m,nativeSwitchEnabled:f,protectedTarget:c,
revalidationRestricted:u,selectionMode:f?"native":"client_local_readonly",reason:v.join("; "),notice:f?"Selecting a chat\
 switches the owned Codex Desktop session.":["Selecting a non-active chat opens its read-only archive in RAC only.","Cod\
ex Desktop stays on its native chat.",v.length?`Native switching is disabled: ${v.join("; ")}.`:""].filter(Boolean).join(
" ")}}Jf.exports={PROTECTED_CODEX_DESKTOP_CDP_PORTS:Qf,codexDesktopThreadControlPolicy:Dy}});var Hh=ym((e0,Fh)=>{"use strict";var Oh=new Set(["codex","codex_cli","codex-desktop"]),vv=new Set(["thinking","generatin\
g","reading_files","running_command","applying_patch","working"]),wv=new Set(["active","in_progress","in-progress","work\
ing","running"]),kv=new Set(["pending","queued","todo","not_started","not-started"]),Ih=new Set(["completed","complete",
"done","passed","success","succeeded"]),Sv=new Set([...Ih,"cancelled","canceled","failed","skipped"]),Nv=new Set(["","ac\
tive","idle","ready","thinking","generating","working","busy","connected"]),Ph=240,xv=32,Cv=48,Av=/^(?=.*\d)(?:(?:\d+)\s*d\s*)?(?:(?:\d+)\s*h\s*)?(?:(?:\d+)\s*m\s*)?(?:(?:\d+)\s*s)?$/i,
Mv=/^[+-]?\d+\s*[dhms]\b/i,Rv=/^(?:just now|today|yesterday|(?:\d+|an?|one)\s+(?:seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?)\s+ago)$/i,
Tv=/^(?:pursuing goal|paused goal|goal (?:paused|blocked|usage limited|rate limited|limited|budget limited|achieved|cancelled|canceled|stopped|failed)|idle|ready|connected|awaiting live update)$/i,
$v=/^(?:no (?:recent message|current work|data|activity)(?: reported)?|unavailable|unknown|not available)$/i,Ev=/^(?:remote agent chat|(?:antigravity|claude(?: code)?|cline|codex|continue|cursor|gemini|roo code)\s+(?:harness|workspace))$/i,
Eh=Object.freeze({active:"active",running:"active",working:"active",pursuing:"active",pursuing_goal:"active",paused:"pau\
sed",pause:"paused",paused_goal:"paused",blocked:"blocked",goal_blocked:"blocked",needs_attention:"blocked",waiting_for_user:"\
blocked",usagelimited:"usageLimited",usage_limited:"usageLimited",goal_usage_limited:"usageLimited",rate_limited:"usageL\
imited",goal_rate_limited:"usageLimited",budgetlimited:"budgetLimited",budget_limited:"budgetLimited",goal_limited:"budg\
etLimited",goal_budget_limited:"budgetLimited",complete:"complete",completed:"complete",achieved:"complete",goal_achieved:"\
complete",cancelled:"cancelled",canceled:"cancelled",stopped:"cancelled",goal_cancelled:"cancelled",goal_canceled:"cance\
lled",goal_stopped:"cancelled",failed:"failed",failure:"failed",goal_failed:"failed"});function qh(e){return String(e||"").
trim().toLowerCase()}function Dh(e,t){return t&&typeof t.goal_lifecycle=="boolean"?t.goal_lifecycle:Oh.has(qh(e))}function Nl(e){
if(typeof e=="number"&&Number.isFinite(e)&&e>0)return e;let t=Date.parse(String(e||""));return Number.isFinite(t)?t:0}function zs(...e){
for(let t of e){let n=Nl(t);if(n)return new Date(n).toISOString()}return null}function Lv(e){return/(?:\bbearer\s+[a-z0-9._~+/=-]{8,}|\b(?:api[_ -]?key|password|passwd|secret|access[_ -]?token|refresh[_ -]?token)\s*[:=]\s*\S+|\bsk-[a-z0-9_-]{8,})/i.
test(e)}function jh(e){let t=String(e??"").replace(/\s+/g," ").trim();return t?Av.test(t)?"duration_only":Mv.test(t)?"du\
ration_malformed":Rv.test(t)?"age_only":Tv.test(t)?"status_only":$v.test(t)?"placeholder_only":Ev.test(t)?"surface_label\
_only":"":"empty"}function Mn(e,t=Ph){if(typeof e!="string"&&typeof e!="number")return"";let n=String(e).replace(/[\u0000-\u001f\u007f]+/g,
" ").replace(/```[\s\S]*?```/g," ").replace(/\s+/g," ").trim();return!n||Lv(n)||jh(n)||/^[{[]\s*["']?[\w.-]+["']?\s*:/.test(
n)||/^(?:powershell|pwsh|cmd(?:\.exe)?|bash|sh|zsh|fish)\s+-/i.test(n)?"":(n=n.replace(/^(?:[-*•]\s+|#{1,6}\s+)/,"").trim(),
n.slice(0,t).trim())}function Bh(e){let t=String(e||"").trim().replace(/([a-z0-9])([A-Z])/g,"$1_$2").toLowerCase().replace(
/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"");return t&&(Eh[t]||Eh[t.replace(/_/g,"")])||"unknown"}function zd(e){for(let t of[
e?.state,e?.status,e?.raw_state,e?.native_state]){let n=Bh(t);if(n!=="unknown")return n}return"unknown"}function kl(e){return String(
e?.state||e?.status||"").trim().toLowerCase()}function Lh(e){return Mn(e?.subject||e?.text||e?.content||e?.description||
e?.label)}function Ud(e,t){let n=Number(t),s=Number(e);return!Number.isInteger(n)||n<=0||!Number.isInteger(s)||s<0?null:
{completed:Math.min(s,n),total:n}}function Ov(e){let t=Number(e?.progress_percent??e?.percent_complete??e?.percent??e?.progress);
return Number.isFinite(t)?Math.max(0,Math.min(100,t<=1?t*100:t)):null}function Sl(e,t={}){if(!e||typeof e!="object")return null;
let n=String(e.kind||"").trim().toLowerCase().replace(/[^a-z_]/g,"").slice(0,24);if(!n||n==="goal"&&t.goalCapable===!1)return null;
let s=Mn(e.label,xv),a=Mn(e.text),o=Mn(e.source,Cv).replace(/\s+/g,"_").toLowerCase();if(!s||!a||!o)return null;let c=n===
"goal"?zd(e):"unknown";if(n==="goal"&&c==="unknown")return null;let u=Ud(e.completed,e.total),m=Number(e.percent);return{
kind:n,label:s,text:a,source:o,updated_at:zs(e.updated_at)||null,...u||{},...Number.isFinite(m)?{percent:Math.max(0,Math.
min(100,m))}:{},...n==="goal"?{state:c}:e.state?{state:Mn(e.state,32).toLowerCase()}:{},...e.diagnostic_reason?{diagnostic_reason:String(
e.diagnostic_reason).slice(0,64)}:{}}}function Iv(e){let t=Array.isArray(e)?e:[];for(let n=t.length-1;n>=0;n-=1){let s=t[n];
if(String(s?.role||"").toLowerCase()!=="user")continue;let a=Mn(s?.content||s?.text);if(a)return{text:a,updated_at:zs(s?.
timestamp,s?.created_at,s?.ts,s?.server_ts)}}return null}function Hd(e,t){let n=qh(e);return n==="claude"||n==="claude_c\
li"||n==="claude-desktop"?t>1?"Tasks":"Task":["antigravity","antigravity_panel","antigravity-v2","gemini","continue","co\
ntinue_yolo","roo_code","cline"].includes(n)?"Task":t>1?"Tasks":"Plan"}function Pv(e,t){let n=t?.task_list,s=Array.isArray(
n?.tasks)?n.tasks:[],a=s.filter(f=>Lh(f));if(a.length>0){let f=a.find(R=>wv.has(kl(R))),v=a.find(R=>kv.has(kl(R))),k=f||
v;if(k){let R=Number(n.total),S=Number.isInteger(R)&&R>0?R:s.length,T=Number(n.completed),b=Number.isInteger(T)&&T>=0?T:
s.filter(w=>Ih.has(kl(w))).length;return{kind:"plan",label:Hd(e,S),text:Lh(k),source:"task_list",updated_at:zs(k.updated_at,
k.updatedAt,n.updated_at,t.updated_at),...Ud(b,S)}}}let o=t?.step,c=kl(o),u=typeof o=="object"?o?.text||o?.content||o?.description||
o?.label||o?.name:o,m=Mn(u);return m&&!Sv.has(c)?{kind:"plan",label:Hd(e,1),text:m,source:"step",updated_at:zs(o?.updated_at,
o?.updatedAt,t.updated_at)}:null}function qv(e){let t=e?.current;if(!t||typeof t!="object")return null;let n=Mn(t.label||
t.title||t.name);if(!n)return null;let s=String(t.kind||"").trim().toLowerCase(),a=["response","thinking","generating","\
message"].includes(s);return{kind:a?"response":"activity",label:a?"Current response":"Current activity",text:n,source:s?
`current_${s}`:"current",updated_at:zs(t.updated_at,t.since,e.updated_at)}}function Dv(e,t){let n=t?.context_card;if(!n||
typeof n!="object")return null;let s=Mn(n.task||n.title||n.mode||n.label||n.text);return s?{kind:"task",label:Hd(e,1),text:s,
source:"context_card",updated_at:zs(n.updated_at,t.updated_at)}:null}function jv(e){let t=typeof e=="string"?{text:e}:e,
n=Mn(t?.text||t?.content);return n?{kind:"request",label:"Request",text:n,source:"latest_user_request",updated_at:zs(t?.
updated_at,t?.timestamp,t?.created_at)}:null}function Bv(e){let t=Mn(e?.label,160);return!t||Nv.has(t.toLowerCase())?null:
{kind:"activity",label:"Current activity",text:t,source:"activity_label",updated_at:zs(e?.updated_at,e?.started_at,e?.since)}}
function Fv(e,t){if(!t||!e?.goal||typeof e.goal!="object")return null;let n=e.goal,s=Mn(n.objective||n.text);if(!s)return null;
let a=zd(n);if(a==="unknown")return null;let o=Ud(n.completed,n.total),c=Ov(n);return{kind:"goal",label:"Goal",text:s,source:"\
goal",updated_at:zs(n.updated_at,n.observed_at,e.updated_at),...o||{},...c==null?{}:{percent:c},state:a}}function Hv(e,t){
if(!e)return t;if(!t)return e;let n=Nl(e.updated_at);return Nl(t.updated_at)>n&&n>0?t:e}function zv(e={}){let t=e.activity&&
typeof e.activity=="object"?e.activity:{},n=Dh(e.agentType,e.capabilities);if(e.preferProvided!==!1){let k=Sl(t.work_context,
{goalCapable:n});if(k)return k}let s=Fv(t,n);if(s)return Sl(s,{goalCapable:n});let a=Pv(e.agentType,t),o=qv(t),c=Dv(e.agentType,
t),u=jv(e.latestUserRequest),m=Bv(t),f=vv.has(String(t.kind||"").toLowerCase()),v=a||c;return f&&o&&(v=Hv(v,o)),v||(v=o||
c||u||m),!v&&u&&(v=u),v||(v={kind:"empty",label:"Current work",text:"Current work unavailable",source:"none",updated_at:zs(
t.updated_at),diagnostic_reason:"no_authoritative_work_context"}),Sl(v,{goalCapable:n})}Fh.exports={CODEX_GOAL_AGENT_TYPES:Oh,
MAX_CONTEXT_TEXT:Ph,boundedDisplayText:Mn,coherentGoalState:zd,goalLifecycleSupported:Dh,latestUserRequestFromMessages:Iv,
normalizeFleetWorkContext:Sl,normalizeGoalState:Bh,projectFleetWorkContext:zv,rejectedDisplayTextReason:jh,timestampMs:Nl}});var W_=new Set(["js","jsx","ts","tsx","py","json","md","css","html","htm","sh","bash","yaml","yml","txt","env","csv","xm\
l","sql","go","rs","java","c","cpp","h","hpp","rb","php","swift","kt","scala","r","m","tf","toml","ini","cfg","conf","lo\
g","gitignore","dockerfile","makefile","vue","svelte","graphql","gql"]),K_={js:"javascript",jsx:"jsx",ts:"typescript",tsx:"\
tsx",py:"python",rb:"ruby",sh:"bash",bash:"bash",rs:"rust",kt:"kotlin",tf:"hcl",md:"markdown",yml:"yaml",yaml:"yaml",graphql:"\
graphql",gql:"graphql"};function Ei(e){let t=e.split(".").pop().toLowerCase();return K_[t]||t}function km(e){let t=e.split(
".").pop().toLowerCase();return W_.has(t)}var wm={claude:"Claude Code",claude_cli:"Claude Code CLI",codex:"Codex",codex_cli:"\
Codex CLI",cursor_cli:"Cursor CLI",gemini:"Gemini",continue:"Continue",continue_yolo:"Continue YOLO",roo_code:"Roo Code",
cline:"Cline",antigravity:"Antigravity",antigravity_panel:"Antigravity Chat","codex-desktop":"Codex Desktop",cursor:"Cur\
sor","claude-desktop":"Claude Desktop"},V_=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function Sm(e,t){if(e&&typeof e=="object"){let m=wm[e.agent_type]||e.display_name||e.agent_type||"Agent",f=e.workspace_name||
e.window_title||"";return f?m+" \u2014 "+f:m}let n=t||e;if(typeof n!="string")return"Agent";if(V_.test(n))return"Agent S\
ession";let s=n.split("-"),a=s[0],o=s[1]||"",c=s[2]||"",u=o?" (win "+o+c+")":"";return(wm[a]||a)+u}function Ue(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}function Hn(e){return Ue(String(
e)).replace(/"/g,"&quot;")}function Ii(e){return/^[A-Za-z]:\\/.test(e)||e.includes("\\")||e.includes("/")||/^[.~]\//.test(
e)}function Y_(e){let t=0,n=0;return e.split(`
`).forEach(s=>{/^\+\+\+|^---|^@@/.test(s)||(s.startsWith("+")&&t++,s.startsWith("-")&&n++)}),{adds:t,dels:n}}function X_(e){
return/\b(edit|edited|patch|diff|apply_patch|write)\b/i.test(String(e||""))}function Q_(e){let t=String(e||"").replace(/\r\n?/g,
`
`).split(`
`).map(n=>n.trimEnd());for(let n of t)if(n){if(/^(diff --git|index )/.test(n)||/^@@/.test(n)||/^---[ \t]/.test(n)||/^\+\+\+[ \t]/.
test(n))return!0;if(/^[+\- ]/.test(n)){let s=n.slice(1).trim();if(!s||/^[\d\s()+\-]+$/.test(s))continue;return!0}}return!1}function J_(e){let t=(e||"").toLowerCase();return t.includes("bash")||t.includes("run")||t.includes("command")||t.includes(
"execute")?"dot-bash":t.includes("read")?"dot-read":t.includes("edit")||t.includes("write")||t.includes("patch")?"dot-wr\
ite":t.includes("search")||t.includes("grep")||t.includes("find")||t.includes("glob")?"dot-search":t.includes("browser")||
t.includes("web")||t.includes("fetch")?"dot-browser":"dot-default"}function Cm(e){let t=String(e||"").split(`
`),n=[],s=[],a=null,o=!1;function c(){let m=s.join(`
`).trim();m&&n.push({type:"markdown",content:m}),s=[]}function u(){if(!a)return;let m=a.lines.join(`
`).trimEnd();n.push({type:"tool",name:a.name,content:m}),a=null}return t.forEach(m=>{let f=/^```/.test(m.trim()),v=o?null:
m.match(/^\[([^\]\n]+)\]\s*$/),k=o?null:m.match(/^(Ran .+|Read .+|Edited file|Edit .+|Analyzed .+|Search(?:ed)? .+|Bash .+)\s*$/),
R=!o&&m.match(/^(\d+\s+lines?(?:\s+of\s+output)?)$/i);if(v){if(v[1].trim()==="end"){u();return}c(),u(),a={name:v[1].trim(),
lines:[]};return}if(R){c(),u(),a={name:R[1].trim(),lines:[]};return}if(k){c(),u(),a={name:k[1].trim(),lines:[]};return}a?
a.lines.push(m):s.push(m),f&&(o=!o)}),c(),u(),n.length>0?n:[{type:"markdown",content:String(e||"")}]}function Gu(e){if(!e)
return!1;let t=String(e).replace(/\r\n?/g,`
`);if(/^(diff --git|index )/m.test(t)||/^@@/m.test(t)||/^---[ \t]/m.test(t)&&/^\+\+\+[ \t]/m.test(t))return!0;let s=t.split(
`
`).map(m=>m.trimEnd()).filter(Boolean);if(s.length<4)return!1;let a=s.filter(m=>/^[+-](?![-+]{2})/.test(m)).length,o=s.filter(
m=>/^\+(?!\+\+ )/.test(m)).length,c=s.filter(m=>/^-(?!-- )/.test(m)).length,u=s.filter(m=>/^ /.test(m)).length;return a>=
3&&o>=1&&c>=1&&u>=1}function Am(e){let t=e.match(/^\+\+\+[ \t]+(?:[ab]\/)?(.+?)(?:\t.*)?$/m);if(t){let s=t[1].trim();if(s&&
s!=="/dev/null")return s}let n=e.match(/^---[ \t]+(?:[ab]\/)?(.+?)(?:\t.*)?$/m);if(n){let s=n[1].trim();if(s&&s!=="/dev/\
null")return s}return null}var Nm=300;function Z_(e,t){if(e.length>Nm||t.length>Nm)return null;let n=e.length,s=t.length,
a=Array.from({length:n+1},()=>new Int32Array(s+1));for(let m=1;m<=n;m++)for(let f=1;f<=s;f++)a[m][f]=e[m-1]===t[f-1]?a[m-
1][f-1]+1:Math.max(a[m-1][f],a[m][f-1]);let o=[],c=n,u=s;for(;c>0||u>0;)c>0&&u>0&&e[c-1]===t[u-1]?(o.unshift({type:"eq"}),
c--,u--):u>0&&(c===0||a[c][u-1]>=a[c-1][u])?(o.unshift({type:"ins"}),u--):(o.unshift({type:"del"}),c--);return o}function eb(e){
let t=[],n=0,s=null;for(let a of e)a.type==="del"?(s===null&&(s=n),n++):a.type==="eq"&&(s!==null&&(t.push({start:s,end:n}),
s=null),n++);return s!==null&&t.push({start:s,end:n}),t}function tb(e){let t=[],n=0,s=null;for(let a of e)a.type==="ins"?
(s===null&&(s=n),n++):a.type==="eq"&&(s!==null&&(t.push({start:s,end:n}),s=null),n++);return s!==null&&t.push({start:s,end:n}),
t}function xm(e,t,n){if(!t||!t.length)return e;let s="",a=0,o=0,c=!1,u=0;for(;u<e.length;)if(e[u]==="<"){c&&(s+="</mark>",
c=!1);let m=e.indexOf(">",u);if(m===-1){s+=e[u++];continue}s+=e.slice(u,m+1),u=m+1,o<t.length&&a>=t[o].start&&a<t[o].end&&
(s+=`<mark class="${n}">`,c=!0)}else{if(c&&a>=t[o].end&&(s+="</mark>",c=!1,o++),!c&&o<t.length&&a>=t[o].start&&(s+=`<mar\
k class="${n}">`,c=!0),e[u]==="&"){let m=e.indexOf(";",u+1),f=m!==-1&&m-u<=8?m+1:u+1;s+=e.slice(u,f),u=f}else s+=e[u++];
a++}return c&&(s+="</mark>"),s}function Mm(e){let t=Rm(e);return t.length>0&&t[t.length-1].trim()===""&&t.pop(),t.map((n,s)=>`\
<span class="code-line"><span class="code-line-num">${s+1}</span>${n}</span>`).join("")}var nb=/[A-Za-z]:\\[^\n"'`<>]+?\.[A-Za-z0-9._-]+(?:\s+\((?:Lines?|Line)\s+\d+(?:-\d+)?\))?|(?:\.{1,2}[\\/])?(?:[A-Za-z0-9_.-]+[\\/])+[A-Za-z0-9_.-]+\.[A-Za-z0-9._-]+(?:\s+\((?:Lines?|Line)\s+\d+(?:-\d+)?\))?/g;
function sb(e){let t=String(e||""),n="",s=0;for(let a of t.matchAll(nb)){let o=a[0],c=a.index||0,u=c+o.length,m=c>0?t[c-
1]:"",f=u<t.length?t[u]:"",v=(!m||/[\s([{"'`]/.test(m))&&(!f||/[\s)\]},"'`:;]/.test(f)),k=o.trim();!v||!Ii(k)||(n+=Ue(t.
slice(s,c)),n+=`<button class="inline-file-ref tool-open-file" type="button" title="Open file preview" data-open-path="${Hn(
k)}" data-copy-path="${Hn(k)}">${Ue(k)}</button>`,s=u)}return n+=Ue(t.slice(s)),n||"&nbsp;"}function ab(e){let t=String(
e||"").replace(/\r\n/g,`
`).split(`
`);return t.length>0&&t[t.length-1]===""&&t.pop(),t.map((n,s)=>`<span class="code-line"><span class="code-line-num">${s+
1}</span>${sb(n)}</span>`).join("")}function zu(e,t){return`<span class="diff-gutter"><span class="diff-gutter-num diff-\
gutter-old">${e??""}</span><span class="diff-gutter-num diff-gutter-new">${t??""}</span></span>`}function Li(e){return`<\
span class="diff-gutter"><span class="diff-gutter-num">${e??""}</span></span>`}function rb(e){let t=0,n=0;for(let s of e)
if(s.type==="hunk"){let a=s.raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);a&&(t=parseInt(a[1],10)-1,n=parseInt(a[2],
10)-1),s.oldLine=null,s.newLine=null}else s.type==="add"?(s.oldLine=null,s.newLine=++n):s.type==="del"?(s.oldLine=++t,s.
newLine=null):s.type==="ctx"?(s.oldLine=++t,s.newLine=++n):(s.oldLine=null,s.newLine=null)}function ib(e,t,n){let s=[],a=u=>n.
has(u)?n.get(u):t&&t[u]!=null?t[u]:Ue(e[u].raw.startsWith("+")||e[u].raw.startsWith("-")||e[u].raw.startsWith(" ")?e[u].
raw.slice(1):e[u].raw),o=u=>t&&t[u]!=null?" diff-hl":"",c=0;for(;c<e.length;){let u=e[c];if(u.type==="meta"){let S=`<spa\
n class="diff-meta">${Ue(u.raw)}</span>`;s.push({type:"both",html:S}),c++;continue}if(u.type==="hunk"){let S=`<span clas\
s="diff-hunk">${Ue(u.raw)}</span>`;s.push({type:"both",html:S}),c++;continue}if(u.type==="ctx"){s.push({type:"ctx",content:a(
c),hlCls:o(c),oldLine:u.oldLine,newLine:u.newLine}),c++;continue}let m=c;for(;m<e.length&&e[m].type==="del";)m++;let f=m;
for(;f<e.length&&e[f].type==="add";)f++;let v=m-c,k=f-m,R=Math.min(v,k);for(let S=0;S<R;S++)s.push({type:"pair",delContent:a(
c+S),delHlCls:o(c+S),addContent:a(m+S),addHlCls:o(m+S),delOldLine:e[c+S].oldLine,addNewLine:e[m+S].newLine});for(let S=R;S<
v;S++)s.push({type:"del",content:a(c+S),hlCls:o(c+S),oldLine:e[c+S].oldLine});for(let S=R;S<k;S++)s.push({type:"add",content:a(
m+S),hlCls:o(m+S),newLine:e[m+S].newLine});c=f>c?f:c+1}return s}function ob(e){let t=[],n=[];for(let s of e)s.type==="bo\
th"?(t.push(s.html),n.push(s.html)):s.type==="ctx"?(t.push(`<span class="diff-ctx${s.hlCls}">${Li(s.oldLine)}${s.content}\
</span>`),n.push(`<span class="diff-ctx${s.hlCls}">${Li(s.newLine)}${s.content}</span>`)):s.type==="pair"?(t.push(`<span\
 class="diff-del${s.delHlCls}">${Li(s.delOldLine)}${s.delContent}</span>`),n.push(`<span class="diff-add${s.addHlCls}">${Li(
s.addNewLine)}${s.addContent}</span>`)):s.type==="del"?(t.push(`<span class="diff-del${s.hlCls}">${Li(s.oldLine)}${s.content}\
</span>`),n.push('<span class="diff-empty"></span>')):s.type==="add"&&(t.push('<span class="diff-empty"></span>'),n.push(
`<span class="diff-add${s.hlCls}">${Li(s.newLine)}${s.content}</span>`));return`<div class="diff-split"><div class="diff\
-split-col diff-split-old"><code class="hljs diff-code">${t.join("")}</code></div><div class="diff-split-col diff-split-\
new"><code class="hljs diff-code">${n.join("")}</code></div></div>`}function Rm(e){let t=[],n="",s=[],a=0;for(;a<e.length;)
if(e[a]===`
`)t.push(n+"</span>".repeat(s.length)),n=s.map(o=>`<span class="${o}">`).join(""),a++;else if(e[a]==="<")if(e.startsWith(
"</span>",a))s.pop(),n+="</span>",a+=7;else if(e.startsWith("<span",a)){let o=e.indexOf(">",a);if(o===-1){n+=e[a++];continue}
let c=e.slice(a,o+1),u=c.match(/class="([^"]*)"/);s.push(u?u[1]:""),n+=c,a=o+1}else n+=e[a++];else n+=e[a++];return(n||s.
length)&&t.push(n+"</span>".repeat(s.length)),t}function Tm(e,t){let n=(()=>{if(!t||typeof hljs>"u")return null;if(hljs.
getLanguage(t))return t;let b=t.split(".").pop().toLowerCase();return hljs.getLanguage(b)?b:null})(),a=e.split(`
`).map(b=>/^\+\+\+|^---/.test(b)?{type:"meta",raw:b}:/^@@/.test(b)?{type:"hunk",raw:b}:b.startsWith("+")?{type:"add",raw:b}:
b.startsWith("-")?{type:"del",raw:b}:{type:"ctx",raw:b});rb(a);let o=null;if(n)try{let b=a.map(h=>h.type==="meta"||h.type===
"hunk"?"":h.raw.startsWith("+")||h.raw.startsWith("-")||h.raw.startsWith(" ")?h.raw.slice(1):h.raw),w=hljs.highlight(b.join(
`
`),{language:n});o=Rm(w.value)}catch{o=null}let c=new Map;for(let b=0;b<a.length;){if(a[b].type!=="del"){b++;continue}let w=b;
for(;w<a.length&&a[w].type==="del";)w++;let h=w;for(;h<a.length&&a[h].type==="add";)h++;let M=w-b,C=h-w;if(M===C&&M>0)for(let _=0;_<
M;_++){let L=b+_,P=w+_,V=a[L].raw.slice(1),Z=a[P].raw.slice(1),oe=Z_(V,Z);if(!oe)continue;let ge=oe.filter(ue=>ue.type===
"eq").length,W=Math.max(V.length,Z.length);if(W>0&&ge/W<.15)continue;let te=o&&o[L]!=null?o[L]:Ue(V),X=o&&o[P]!=null?o[P]:
Ue(Z);c.set(L,xm(te,eb(oe),"diff-word-del")),c.set(P,xm(X,tb(oe),"diff-word-add"))}b=h>b?h:b+1}let u=0,m=0,f=0,v=!1,k=a.
map((b,w)=>{if(b.type==="meta")return`<span class="diff-meta">${Ue(b.raw)}</span>`;if(b.type==="hunk")return v=!0,f++,`<\
span class="diff-hunk diff-hunk-btn" data-hunk-id="${f}" role="button" tabindex="0" title="Toggle context lines">${Ue(b.
raw)}</span>`;let h=b.raw.startsWith("+")||b.raw.startsWith("-")||b.raw.startsWith(" ")?b.raw.slice(1):b.raw,M=c.has(w)?
c.get(w):o&&o[w]!=null?o[w]:Ue(h),C=o&&o[w]!=null?" diff-hl":"",_=f>0?` data-hunk-ctx="${f}"`:"";return b.type==="add"?(u++,
`<span class="diff-add${C}"${_}>${zu(null,b.newLine)}${M}</span>`):b.type==="del"?(m++,`<span class="diff-del${C}"${_}>${zu(
b.oldLine,null)}${M}</span>`):`<span class="diff-ctx${C}"${_}>${zu(b.oldLine,b.newLine)}${M}</span>`}),R=u||m?`<span cla\
ss="diff-stat-add">+${u}</span><span class="diff-stat-del">-${m}</span>`:"",S=ib(a,o,c),T=ob(S);return{body:k.join(""),stats:R,
splitHtml:T,hasHunks:v}}var $m='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke\
-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3"/><path d="M1\
6 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3"/><line x1="12" y1="3" x2="12" y2="21"/></svg>',cb='<svg width="14" height="14" \
viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><c\
ircle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',lb='<svg class="copy-icon" width="14" \
height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoi\
n="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9\
a2 2 0 0 1 2 2v1"></path></svg>',ub='<svg class="check-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stro\
ke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:none"><polyline point\
s="20 6 9 17 4 12"></polyline></svg>';var Em=new marked.Renderer;Em.code=function(e,t){let n=typeof e=="object"?e.text||e.raw||"":e||"",a=(typeof e=="object"?
e.lang||"":t||"").split(/\s/)[0].toLowerCase()||"text",o=a==="diff"||a==="patch"||Gu(n),c=!o&&(a==="text"||a==="markdown"),
u,m="",f="",v="",k=null;if(o){f=Am(n)||"";let P=f?Ei(f):null;k=Tm(n,P),u=k.body,m=k.stats,v=k.splitHtml||""}else if(c)u=
ab(n);else try{u=hljs.getLanguage(a)?hljs.highlight(n,{language:a}).value:hljs.highlightAuto(n).value}catch{u=Ue(n)}let R=n;
!o&&!c&&(u=Mm(u));let S=o||a==="text"?"":a,T=f?`<button class="diff-filepath" title="Open file preview" data-copy-path="${Hn(
f)}" data-open-path="${Hn(f)}">${Ue(f)}</button>`:"",b=v?`<button class="diff-split-toggle" title="Toggle side-by-side v\
iew">${$m}</button>`:"",w=o&&k&&k.hasHunks?'<button class="diff-ctx-collapse-all" title="Collapse/expand all context lin\
es">Context</button>':"",h=!1,M="",C=typeof localStorage<"u"&&localStorage.getItem("codeblock_wrap_pref")==="1",_=`<butt\
on class="code-wrap-toggle${C?" active":""}" title="${C?"Disable word wrap":"Enable word wrap"}">${C?"No Wrap":"Wrap"}</\
button>`,L=o?"":` data-raw="${Hn(R)}"`;return`<div class="code-block${o?" diff-block":""}${h?" code-collapsible":""}${C?
" code-wrap":""}" data-diff-mode="unified">
    <div class="code-header">
      <span class="code-lang">${S}</span>
      ${T}
      <span class="diff-stats">${m}</span>
      ${w}
      ${b}
      ${M}
      ${_}
      <button class="code-search-btn" title="Search in block">${cb}</button>
      <button class="code-copy" title="Copy code">${lb}${ub}<span class="copy-label">Copy</span></button>
    </div>
    <div class="code-search-bar" hidden>
      <input class="code-search-input" type="text" placeholder="Search\u2026" aria-label="Search in code block">
      <span class="code-search-count"></span>
      <button class="code-search-prev" title="Previous match">&#8593;</button>
      <button class="code-search-next" title="Next match">&#8595;</button>
      <button class="code-search-close" title="Close search">&#10005;</button>
    </div>
    <pre><code class="hljs${o?" diff-code":""}"${L}>${u}</code></pre>
    ${v}
  </div>`};marked.use({renderer:Em,breaks:!0,gfm:!0});function db(e,t){let n=(e||"").toLowerCase();if(n==="bash"||n==="r\
un"||n==="execute"||n==="shell"){let a=t.find(o=>o.trim());return a?a.trim().substring(0,80):""}let s=t.find(a=>a.trim());
return s&&Ii(s.trim())?s.trim():s?s.trim().substring(0,60):""}function pb(e,t,n){let s=String(t||"").replace(/\n+$/,"").
split(`
`),a=s.find(ge=>ge.trim()),o=a&&Ii(a.trim())?a.trim():"",c=(ge,W="")=>{let te=String(ge||"").trim();if(!te)return"";let X=[
"tool-path",W,Ii(te)?"tool-open-file":""].filter(Boolean).join(" ");return Ii(te)?`<button class="${X}" type="button" ti\
tle="Open file preview" data-open-path="${Hn(te)}" data-copy-path="${Hn(te)}">${Ue(te)}</button>`:`<span class="${X}">${Ue(
te)}</span>`},u=s.filter((ge,W,te)=>!(W===te.length-1&&te[W]==="")).length,m=/^\d+\s+lines?(?:\s+of\s+output)?$/i.test(e.
trim()),f=s.some(ge=>ge.trim()),v=m&&u===0||!f,R=/^Bash\b/i.test(e.trim())&&s.every(ge=>{let W=ge.trim();return!W||/^\$\s+/.
test(W)}),S=!f,T=s.join(`
`),b=Y_(t),w=Gu(t)||X_(e)&&(b.adds||b.dels),h=w&&Am(t)||o,M=w&&h?Ei(h):null,C=(()=>{if(!w)return T;let ge=T,W=ge.match(/```(?:diff|patch)?\s*\n([\s\S]*?)```\s*$/m);
W&&(ge=W[1]);let te=ge.split(`
`),X=0;for(;X<te.length;){let ue=te[X];if(ue.startsWith("+")||ue.startsWith("-")||ue.startsWith("@@")||ue.startsWith(" "))
break;X++}return te.slice(X).join(`
`)})(),_=w&&Q_(C),L=_?Tm(C,M):null,P=b.adds||b.dels?`<span class="tool-stat-add">+${b.adds}</span><span class="tool-stat\
-del">-${b.dels}</span>`:"",V=w?(()=>{for(let ge of s){let W=ge.trim();if(W&&!W.startsWith("```")&&!W.startsWith("+")&&!W.
startsWith("-")&&!W.startsWith("@@")&&!W.startsWith(" "))return W}return""})():"",Z=S&&!h?V||db(e,s):V||"",oe=!v&&(_||!w);
return`<section class="tool-section${S?" collapsed":""}" data-tool-index="${n}">
    <button class="tool-toggle" type="button" aria-expanded="${S?"false":"true"}">
      <span class="tool-chevron">${oe?S?"\u25B8":"\u25BE":""}</span>
      <span class="tool-dot ${J_(e)}">\u25CF</span>
      <span class="tool-toggle-main">
        ${(()=>{let ge=e.indexOf(" ");if(ge>0){let W=e.substring(0,ge),te=e.substring(ge+1).trim();return`<span class="t\
ool-name">${Ue(W)}</span>${c(te)}`}return`<span class="tool-name">${Ue(e)}</span>`})()}
        ${h?c(h,"tool-path-secondary"):""}
        ${Z?`<span class="tool-preview">${Ue(Z)}</span>`:""}
      </span>
      <span class="tool-toggle-side">
        ${P}
        ${m&&u>0?`<span class="tool-line-count">${u} lines</span>`:""}
      </span>
    </button>
    ${oe?`<div class="tool-body"${S?" hidden":""}>
      ${_?`<div class="code-block diff-block tool-diff-block" data-diff-mode="unified">
            <div class="code-header">
              <span class="code-lang"></span>
              ${h?`<button class="diff-filepath" title="Open file preview" data-copy-path="${Hn(h)}" data-open-path="${Hn(
h)}">${Ue(h)}</button>`:""}
              <span class="diff-stats">${L?.stats||""}</span>
              ${L?.hasHunks?'<button class="diff-ctx-collapse-all" title="Collapse/expand all context lines">Context</bu\
tton>':""}
              ${L?.splitHtml?`<button class="diff-split-toggle" title="Toggle side-by-side view">${$m}</button>`:""}
            </div>
            <pre><code class="hljs diff-code">${L?.body||""}</code></pre>
            ${L?.splitHtml||""}
          </div>`:(()=>{let ge=Lm(T);if(ge)return Om(ge,n+"_b");let W=T.trim();return W.startsWith("```")?`<div class="t\
ool-body-md">${marked.parse(W)}</div>`:`<pre class="tool-body-pre"><code>${Ue(T)}</code></pre>`})()}
    </div>`:""}
  </section>`}var mb=/^IN\n\n?```([^\n]*)\n([\s\S]*?)\n```\n\n?OUT(?:\n\n?```([^\n]*)\n([\s\S]*?)\n```)?[\s]*$/,fb=/^IN\n([\s\S]*?)(?:\nOUT\n([\s\S]*))?$/;
function Lm(e){if(!e)return null;let t=e.replace(/\r\n/g,`
`);if(!t.startsWith(`IN
`))return null;let n=t.match(mb);if(n)return{inLang:n[1]||"",inText:n[2]||"",outLang:n[3]||"",outText:n[4]||""};let s=t.
match(fb);return s?{inLang:"",inText:(s[1]||"").trim(),outLang:"",outText:(s[2]||"").trim()}:null}function Om(e,t){let n=(e.
inText||"").trimEnd().split(`
`),s=(e.outText||"").trimEnd().split(`
`),a=(c,u)=>{let m=Ue(u.join(`
`)),f=u.length===0||u.length===1&&!u[0].trim()?'<span class="tool-io-empty">(no output)</span>':"";return`<div class="to\
ol-io-row">
      <span class="tool-io-label">${c}</span>
      <div class="tool-io-content">${f||`<code class="tool-io-code">${m}</code>`}</div>
    </div>`},o=s.length===0||s.length===1&&!s[0].trim();return`<div class="tool-io-block" data-tool-index="${t}">${a("IN",
n)}${o?"":a("OUT",s)}</div>`}function hb(e){let t=String(e||"").replace(/\r\n/g,`
`);if(!t.trim())return null;let n=t.split(`
`),s=/^\s*(\d+)\s+file(?:\(s\)|s?)\s+changed(?:\s+in\s+this\s+conversation)?/i,a=n.findIndex(h=>s.test(h));if(a===-1)return null;
let o=n[a].trim(),c=o.match(s);if(!c)return null;let u=h=>{let M=String(h||"").match(/\+(\d+)\s+(?:\u00c2\u00b7|·|-|\s)\s*-?(\d+)/);
return M?{adds:Number(M[1])||0,dels:Number(M[2])||0}:null},m=u(o),f=null,v=[],k="",R=a;for(let h=a+1;h<n.length;h++){let M=n[h].
trim();if(!M)continue;if(!m){let Z=u(M);if(Z){m=Z,R=h;continue}}let C=M.match(/^\+(\d+)$/);if(C){f=Number(C[1])||0,R=h;continue}
let _=M.match(/^-(\d+)$/);if(_&&f!=null&&!m){m={adds:f,dels:Number(_[1])||0},f=null,R=h;continue}let L=M.match(/^\+(\d+)\s+(?:\u00c2\u00b7|·|-|\s)\s*-?(\d+)$/);
if(L&&k){v.push({filepath:k,adds:Number(L[1])||0,dels:Number(L[2])||0}),k="",R=h;continue}let P=M.match(/^(.+?)\s+\+(\d+)\s+(?:\u00c2\u00b7|·|-|\s)\s*-?(\d+)(?:\s+.*)?$/);
if(!P){if(Ii(M)){k=M,R=h;continue}break}let V=P[1].trim();if(!V||/^\+?\d+$/.test(V))break;v.push({filepath:V,adds:Number(
P[2])||0,dels:Number(P[3])||0}),k="",R=h}if(v.length===0)return null;let S=m?.adds??v.reduce((h,M)=>h+M.adds,0),T=m?.dels??
v.reduce((h,M)=>h+M.dels,0),b=n.slice(0,a).join(`
`).replace(/\s+$/g,""),w=n.slice(R+1).join(`
`).replace(/^\s+/g,"");return{count:Number(c[1])||v.length,title:o.replace(/\s+\+\d+.*$/,"").trim(),adds:S,dels:T,entries:v,
beforeText:b,afterText:w}}function gb(e,t){let n=e.entries.map(s=>`<div class="file-changes-item">
      <span class="file-changes-path">${Ue(s.filepath)}</span>
      <span class="file-changes-stats"><span class="diff-stat-add">+${s.adds}</span><span class="diff-stat-del">-${s.dels}\
</span></span>
    </div>`).join("");return`<section class="file-changes-section" data-file-changes-index="${t}">
    <button class="file-changes-toggle" type="button" aria-expanded="true">
      <span class="file-changes-chevron">v</span>
      <span class="file-changes-icon">files</span>
      <span class="file-changes-title">${Ue(e.title||`${e.count} file(s) changed`)}</span>
      <span class="file-changes-summary">
        <span class="diff-stat-add">+${e.adds}</span>
        <span class="diff-stat-del">-${e.dels}</span>
      </span>
    </button>
    ${e.entries.length?`<div class="file-changes-list">${n}</div>`:""}
  </section>`}function _b(e,t){let n;try{n=JSON.parse(e)}catch{return null}if(!n||!Array.isArray(n.items)||!n.items.length)
return null;let s=n.title||"Subagents",a=n.items.map((o,c)=>{let u=String(o.status||"unknown").toLowerCase(),m=u==="runn\
ing"?'<span class="subagent-spinner" aria-hidden="true"></span>':u==="done"?'<span class="subagent-icon subagent-icon-do\
ne" aria-hidden="true">&#10003;</span>':u==="failed"?'<span class="subagent-icon subagent-icon-fail" aria-hidden="true">\
&#10007;</span>':'<span class="subagent-icon subagent-icon-unknown" aria-hidden="true">&#9679;</span>',f=String(o.prompt||
"").trim(),v=String(o.stats||"").trim(),k=Array.isArray(o.tool_calls)?o.tool_calls.filter(Boolean):[],R=k.length?`<ul cl\
ass="subagent-calls">${k.map(S=>`<li><code>${Ue(S)}</code></li>`).join("")}</ul>`:"";return`<li class="subagent-item sub\
agent-status-${Ue(u)}">
      <div class="subagent-row">${m}<div class="subagent-prompt" title="${Ue(f)}">${Ue(f)}</div></div>
      ${v?`<div class="subagent-stats">${Ue(v)}</div>`:""}
      ${R}
    </li>`}).join("");return`<section class="subagents-section" data-subagents-index="${t}">
    <div class="subagents-header"><span class="subagents-icon" aria-hidden="true">&#9783;</span><span class="subagents-t\
itle">${Ue(s)}</span></div>
    <ul class="subagents-list">${a}</ul>
  </section>`}function bb(e){let t=String(e||"").match(/^Task Completed\s*\n+([\s\S]*?)\s*$/);return t?{content:t[1].replace(
/HAS_CHANGES\s*$/i,"").trimEnd(),wrap:!0}:{content:e,wrap:!1}}function yb(e){return`<section class="task-completed-secti\
on">
    <div class="task-completed-header">
      <span class="task-completed-icon" aria-hidden="true">&#10003;</span>
      <span class="task-completed-title">Task Completed</span>
    </div>
    <div class="task-completed-body">${e}</div>
  </section>`}function vb(e){let t=[],n=/^~~~subagents\s*\n([\s\S]*?)\n~~~\s*$/gm;return{content:String(e||"").replace(n,
(a,o)=>{let c=_b(o,t.length)||"";return t.push(c),`\0SUBAGENTS_BLOCK_${t.length-1}\0`}),blocks:t}}function wb(e){let{content:t,
wrap:n}=bb(e);e=t;let{content:s,blocks:a}=vb(e);e=s;let c=Cm(e).map((v,k)=>{try{if(v.type==="tool")return pb(v.name,v.content,
k);let R=Lm(v.content);if(R)return Om(R,k);let S=hb(v.content);if(S){let T=gb(S,k),b=(S.beforeText||"").trim()?marked.parse(
S.beforeText):"",w=(S.afterText||"").trim()?marked.parse(S.afterText):"";return b+T+w}return(v.content||"").trim()?marked.
parse(v.content||""):""}catch(R){return'<pre style="color:var(--red,#f26d78);font-size:11px">[render error: '+Ue(String(
R))+"]</pre><pre>"+Ue(v.content||"")+"</pre>"}}).join("");a.length&&(c=c.replace(/\s*SUBAGENTS_BLOCK_(\d+)\s*/g,(v,k)=>a[Number(
k)]||""));let u=document.createElement("div");typeof DOMPurify<"u"?u.innerHTML=DOMPurify.sanitize(c,{ADD_DATA_URI_TAGS:[
"img"],ALLOW_DATA_ATTR:!0}):u.textContent=c;let f=Array.from(u.querySelectorAll(".diff-block")).map((v,k)=>{let R=v.querySelector(
".diff-filepath");if(!R)return null;let S=R.textContent.trim();if(!S)return null;let T=v.querySelector(".diff-stat-add, \
.tool-stat-add"),b=v.querySelector(".diff-stat-del, .tool-stat-del"),w=T&&parseInt(T.textContent,10)||0,h=b&&parseInt(b.
textContent,10)||0;return v.id=`diff-file-${k}`,{filepath:S,adds:w,dels:h,id:`diff-file-${k}`}}).filter(Boolean);if(f.length>=
2){let v=f.reduce((b,w)=>b+w.adds,0),k=f.reduce((b,w)=>b+w.dels,0),R=f.map(b=>{let w=b.filepath.split(/[/\\]/).pop();return`\
<a class="diff-summary-chip" data-target="${Hn(b.id)}" href="#${Hn(b.id)}" title="${Hn(b.filepath)}"><span class="diff-s\
ummary-name">${Ue(w)}</span><span class="diff-stat-add">+${b.adds}</span><span class="diff-stat-del">-${b.dels}</span></\
a>`}).join(""),S=`<span class="diff-summary-totals"><span class="diff-summary-count">${f.length} files</span><span class\
="diff-stat-add">+${v}</span><span class="diff-stat-del">-${k}</span></span>`,T=document.createElement("div");T.className=
"diff-summary-bar",T.innerHTML=R+S,u.insertBefore(T,u.firstChild)}return n?yb(u.innerHTML):u.innerHTML}function kb(e){let t=[],
n=0,s=document.createTreeWalker(e,NodeFilter.SHOW_TEXT,null),a;for(;a=s.nextNode();){if(a.parentElement&&a.parentElement.
classList.contains("code-line-num"))continue;let o=a.nodeValue.length;t.push({node:a,start:n,end:n+o}),n+=o}return{text:t.
map(o=>o.node.nodeValue).join(""),ranges:t}}function Wc(e){if(!e)return;let t=e.querySelector("code");if(!t)return;t.querySelectorAll(
"mark.code-search-mark").forEach(s=>{let a=s.parentNode;a&&(a.replaceChild(document.createTextNode(s.textContent),s),a.normalize())});
let n=e.querySelector(".code-search-count");n&&(n.textContent=""),delete e._searchState}function Sb(e){if(!e)return;Wc(e);
let t=e.querySelector(".code-search-input"),n=t?t.value:"";if(!n)return;let s=e.querySelector("code");if(!s)return;let{text:a,
ranges:o}=kb(s),c=a.toLowerCase(),u=n.toLowerCase(),m=[],f=0;for(;f<a.length;){let R=c.indexOf(u,f);if(R===-1)break;m.push(
R),f=R+n.length}if(!m.length){let R=e.querySelector(".code-search-count");R&&(R.textContent="0 / 0");return}let v=[];for(let R=m.
length-1;R>=0;R--){let S=m[R],T=S+n.length,b=o.filter(w=>w.end>S&&w.start<T);for(let w=b.length-1;w>=0;w--){let h=b[w],M=Math.
max(0,S-h.start),C=Math.min(h.node.nodeValue.length,T-h.start),_=h.node,L=_.nodeValue,P=document.createElement("mark");P.
className="code-search-mark",P.textContent=L.slice(M,C);let V=_.parentNode;C<L.length&&V.insertBefore(document.createTextNode(
L.slice(C)),_.nextSibling),V.insertBefore(P,C<L.length?_.nextSibling.previousSibling:_.nextSibling),M>0?_.nodeValue=L.slice(
0,M):V.removeChild(_),v.unshift(P)}}e._searchState={marks:v,current:0};let k=e.querySelector(".code-search-count");k&&(k.
textContent=v.length?`1 / ${v.length}`:"0 / 0"),v.length&&(v[0].classList.add("current"),v[0].scrollIntoView({block:"nea\
rest"}))}function Gc(e,t){if(!e||!e._searchState)return;let{marks:n}=e._searchState;if(!n.length)return;n[e._searchState.
current].classList.remove("current"),e._searchState.current=(e._searchState.current+t+n.length)%n.length;let s=n[e._searchState.
current];s.classList.add("current"),s.scrollIntoView({block:"nearest"});let a=e.querySelector(".code-search-count");a&&(a.
textContent=`${e._searchState.current+1} / ${n.length}`)}function Nb(e){let t=[],n=0;for(;n<e.length;)(n===0||e[n-1]===`\

`)&&e[n]==="`"&&e[n+1]==="`"&&e[n+2]==="`"?(t.push(n),n+=3):n++;if(t.length%2===0)return null;let s=t[t.length-1],a=e.slice(
s+3),o=a.indexOf(`
`);if(o===-1)return{lang:"text",code:""};let u=a.slice(0,o).trim().split(/\s/)[0].toLowerCase()||"text",m=a.slice(o+1);return{
lang:u,code:m}}var Oi=new Map,qo=null,Ya=new Map,Uu=0,xb=256,Cb=8*1024*1024;function Ab(e){let t=String(e||""),n=2166136261;
for(let s=0;s<t.length;s+=1)n^=t.charCodeAt(s),n=Math.imul(n,16777619);return(n>>>0).toString(36)}function Mb(e,t){let n=e?.
closest?.(".message")||e;if(!n||typeof IntersectionObserver>"u")return t(),()=>{};qo||(qo=new IntersectionObserver(a=>{for(let o of a){
if(!o.isIntersecting)continue;let c=Oi.get(o.target);if(c){Oi.delete(o.target),qo.unobserve(o.target);for(let u of c)u()}}},
{root:null,rootMargin:"35% 0px",threshold:0}));let s=Oi.get(n);return s||(s=new Set,Oi.set(n,s),qo.observe(n)),s.add(t),
()=>{let a=Oi.get(n);a&&(a.delete(t),!(a.size>0)&&(Oi.delete(n),qo?.unobserve(n)))}}function Rb(e,t){let n=String(e||""),
s=`${t||"content"}${n.length}${Ab(n)}`,a=Ya.get(s);if(a&&a.content===n)return Ya.delete(s),Ya.set(s,a),a.html;let o=wb(
n),c=typeof DOMPurify<"u"?DOMPurify.sanitize(o,{ADD_DATA_URI_TAGS:["img"],ALLOW_DATA_ATTR:!0}):o,u=(n.length+c.length)*2;
for(Ya.set(s,{content:n,html:c,bytes:u}),Uu+=u;Ya.size>xb||Uu>Cb;){let m=Ya.keys().next().value,f=Ya.get(m);Ya.delete(m),
Uu-=f?.bytes||0}return c}function Pi({content:e,monospace:t=!1,onOpenPath:n=null,autoExpandLongCodeBlocks:s=!1,deferUntilVisible:a=!1,
cacheIdentity:o=""}){let c=React.useRef(null),u=React.useRef(null),m=React.useRef(n),[f,v]=React.useState(!a);return m.current=
n,React.useEffect(()=>{if(!a){v(!0);return}if(!f)return Mb(c.current,()=>v(!0))},[a,f]),React.useEffect(()=>{if(!c.current||
!f||e===u.current)return;let k=u.current;if(k!==null&&e.startsWith(k)){let b=Nb(e);if(b&&!Gu(b.code)){let w=c.current.querySelectorAll(
".code-block:not(.diff-block)"),M=(w.length>0?w[w.length-1]:null)?.querySelector(":scope > pre"),C=M?.querySelector("cod\
e");if(C){let _=M.scrollTop,L;try{L=typeof hljs<"u"&&hljs.getLanguage(b.lang)?hljs.highlight(b.code,{language:b.lang}).value:
Ue(b.code)}catch{L=Ue(b.code)}C.innerHTML=Mm(L),C.dataset.raw=b.code,M.scrollTop=_,u.current=e;return}}}let R={toolCollapsed:{},
fileChangesCollapsed:{},codeScroll:[],ctxHidden:{},ctxCollapseActive:{}};u.current!==null&&(c.current.querySelectorAll("\
.tool-section[data-tool-index]").forEach(b=>{R.toolCollapsed[b.dataset.toolIndex]=b.classList.contains("collapsed")}),c.
current.querySelectorAll(".file-changes-section[data-file-changes-index]").forEach(b=>{R.fileChangesCollapsed[b.dataset.
fileChangesIndex]=b.classList.contains("collapsed")}),c.current.querySelectorAll(".code-block pre").forEach((b,w)=>{R.codeScroll[w]=
b.scrollTop}),c.current.querySelectorAll(".diff-block, .tool-diff-block").forEach((b,w)=>{b.querySelectorAll(".diff-hunk\
-btn").forEach(M=>{R.ctxHidden[`${w}:${M.dataset.hunkId}`]=M.classList.contains("diff-hunk-ctx-collapsed")});let h=b.querySelector(
".diff-ctx-collapse-all");h&&(R.ctxCollapseActive[w]=h.classList.contains("active"))})),u.current=e,c.current.innerHTML=
Rb(e,o),c.current.querySelectorAll(".tool-section[data-tool-index]").forEach(b=>{let w=b.dataset.toolIndex;if(!(w in R.toolCollapsed))
return;let h=R.toolCollapsed[w],M=b.classList.contains("collapsed");if(h!==M){b.classList.toggle("collapsed",h);let C=b.
querySelector(".tool-body"),_=b.querySelector(".tool-chevron"),L=b.querySelector(".tool-toggle");C&&(C.hidden=h),_&&(_.textContent=
h?"\u25B8":"\u25BE"),L&&L.setAttribute("aria-expanded",h?"false":"true")}}),c.current.querySelectorAll(".file-changes-se\
ction[data-file-changes-index]").forEach(b=>{let w=b.dataset.fileChangesIndex;if(!(w in R.fileChangesCollapsed))return;let h=R.
fileChangesCollapsed[w],M=b.classList.contains("collapsed");if(h!==M){b.classList.toggle("collapsed",h);let C=b.querySelector(
".file-changes-list"),_=b.querySelector(".file-changes-chevron"),L=b.querySelector(".file-changes-toggle");C&&(C.hidden=
h),_&&(_.textContent=h?">":"v"),L&&L.setAttribute("aria-expanded",h?"false":"true")}}),c.current.querySelectorAll(".diff\
-block, .tool-diff-block").forEach((b,w)=>{let h=b.querySelector("code");if(h&&(b.querySelectorAll(".diff-hunk-btn").forEach(
M=>{let C=`${w}:${M.dataset.hunkId}`;!(C in R.ctxHidden)||!R.ctxHidden[C]||(h.querySelectorAll(`[data-hunk-ctx="${M.dataset.
hunkId}"].diff-ctx`).forEach(_=>_.classList.add("diff-ctx-hidden")),M.classList.add("diff-hunk-ctx-collapsed"))}),R.ctxCollapseActive[w])){
let M=b.querySelector(".diff-ctx-collapse-all");M&&M.classList.add("active")}}),c.current.querySelectorAll(".code-copy").
forEach(b=>{b.onclick=()=>{let w=b.closest(".code-block").querySelector("code"),h=w.dataset.raw!==void 0?w.dataset.raw:w.
textContent;navigator.clipboard.writeText(h).then(()=>{b.querySelector(".copy-icon").style.display="none",b.querySelector(
".check-icon").style.display="",b.querySelector(".copy-label").textContent="Copied",b.classList.add("copied"),setTimeout(
()=>{b.querySelector(".copy-icon").style.display="",b.querySelector(".check-icon").style.display="none",b.querySelector(
".copy-label").textContent="Copy",b.classList.remove("copied")},2e3)}).catch(()=>{})}}),c.current.querySelectorAll(".too\
l-toggle").forEach(b=>{b.onclick=()=>{let w=b.closest(".tool-section"),h=w?.querySelector(".tool-body"),M=b.querySelector(
".tool-chevron"),C=w.classList.toggle("collapsed");h&&(h.hidden=C),M&&(M.textContent=C?"\u25B8":"\u25BE"),b.setAttribute(
"aria-expanded",C?"false":"true")}}),c.current.querySelectorAll(".file-changes-toggle").forEach(b=>{b.onclick=()=>{let w=b.
closest(".file-changes-section"),h=w?.querySelector(".file-changes-list"),M=b.querySelector(".file-changes-chevron"),C=w.
classList.toggle("collapsed");h&&(h.hidden=C),M&&(M.textContent=C?">":"v"),b.setAttribute("aria-expanded",C?"false":"tru\
e")}}),c.current.querySelectorAll(".tool-io-more-btn").forEach(b=>{b.onclick=()=>{let w=b.closest(".tool-io-preview"),h=w?.
nextElementSibling;!w||!h||(w.hidden=!0,h.hidden=!1)}}),c.current.querySelectorAll(".tool-io-collapse-btn").forEach(b=>{
b.onclick=()=>{let w=b.closest(".tool-io-full"),h=w?.previousElementSibling;!w||!h||(w.hidden=!0,h.hidden=!1)}}),c.current.
querySelectorAll(".diff-summary-chip").forEach(b=>{b.onclick=w=>{w.preventDefault();let h=b.dataset.target,M=h&&c.current.
querySelector(`#${CSS.escape(h)}`);M&&(M.scrollIntoView({behavior:"smooth",block:"nearest"}),c.current.querySelectorAll(
".diff-summary-chip").forEach(C=>C.classList.remove("active")),b.classList.add("active"))}}),c.current.querySelectorAll(
".diff-split-toggle").forEach(b=>{b.onclick=()=>{let w=b.closest(".diff-block");if(!w)return;let h=w.querySelector(":sco\
pe > pre"),M=w.querySelector(".diff-split"),_=!(w.dataset.diffMode==="split");w.dataset.diffMode=_?"split":"unified",b.classList.
toggle("active",_),b.title=_?"Toggle unified view":"Toggle side-by-side view"}}),c.current.querySelectorAll(".diff-filep\
ath[data-copy-path], .tool-open-file[data-open-path], .inline-file-ref[data-open-path]").forEach(b=>{b.onclick=w=>{w.stopPropagation();
let h=b.dataset.openPath||b.dataset.copyPath,M=m.current;if(h&&typeof M=="function"){w.preventDefault(),M(h);return}b.dataset.
copyPath&&navigator.clipboard.writeText(h).then(()=>{let C=b.textContent;b.textContent="Copied!",b.classList.add("diff-f\
ilepath-copied"),setTimeout(()=>{b.textContent=C,b.classList.remove("diff-filepath-copied")},1500)}).catch(()=>{})}}),c.
current.querySelectorAll(".code-expand-toggle").forEach(b=>{b.onclick=()=>{let w=b.closest(".code-block");if(!w)return;let h=w.
classList.toggle("code-expanded");b.textContent=h?"Collapse":"Expand",b.title=h?"Collapse block":"Expand block",h||w.scrollIntoView(
{behavior:"smooth",block:"nearest"})}}),s&&c.current.querySelectorAll(".code-collapsible").forEach(b=>{b.classList.add("\
code-expanded");let w=b.querySelector(".code-expand-toggle");w&&(w.textContent="Collapse",w.title="Collapse block")}),c.
current.querySelectorAll(".code-wrap-toggle").forEach(b=>{b.onclick=()=>{let w=localStorage.getItem("codeblock_wrap_pref")!==
"1";localStorage.setItem("codeblock_wrap_pref",w?"1":"0"),c.current.querySelectorAll(".code-block").forEach(h=>{h.classList.
toggle("code-wrap",w);let M=h.querySelector(".code-wrap-toggle");M&&(M.textContent=w?"No Wrap":"Wrap",M.title=w?"Disable\
 word wrap":"Enable word wrap",M.classList.toggle("active",w))})}}),c.current.querySelectorAll(".code-search-btn").forEach(
b=>{b.onclick=()=>{let w=b.closest(".code-block");if(!w)return;let h=w.querySelector(".code-search-bar"),M=w.querySelector(
".code-search-input");if(!h)return;!h.hidden?(Wc(w),h.hidden=!0,b.classList.remove("active")):(h.hidden=!1,b.classList.add(
"active"),M&&M.focus())}}),c.current.querySelectorAll(".code-search-input").forEach(b=>{b.oninput=()=>Sb(b.closest(".cod\
e-block")),b.onkeydown=w=>{let h=b.closest(".code-block");w.key==="Enter"&&(w.shiftKey?Gc(h,-1):Gc(h,1),w.preventDefault()),
w.key==="Escape"&&(Wc(h),h.querySelector(".code-search-bar").hidden=!0,h.querySelector(".code-search-btn").classList.remove(
"active"))}}),c.current.querySelectorAll(".code-search-next").forEach(b=>{b.onclick=()=>Gc(b.closest(".code-block"),1)}),
c.current.querySelectorAll(".code-search-prev").forEach(b=>{b.onclick=()=>Gc(b.closest(".code-block"),-1)}),c.current.querySelectorAll(
".code-search-close").forEach(b=>{b.onclick=()=>{let w=b.closest(".code-block");Wc(w),w.querySelector(".code-search-bar").
hidden=!0,w.querySelector(".code-search-btn").classList.remove("active")}}),c.current.querySelectorAll(".diff-hunk-btn").
forEach(b=>{b.onclick=w=>{w.stopPropagation();let h=b.dataset.hunkId,M=b.closest("code");if(!M)return;let C=M.querySelectorAll(
`[data-hunk-ctx="${h}"].diff-ctx`),_=C.length>0&&C[0].classList.contains("diff-ctx-hidden");C.forEach(L=>L.classList.toggle(
"diff-ctx-hidden",!_)),b.classList.toggle("diff-hunk-ctx-collapsed",!_)},b.onkeydown=w=>{(w.key==="Enter"||w.key===" ")&&
(w.preventDefault(),b.click())}}),c.current.querySelectorAll(".diff-ctx-collapse-all").forEach(b=>{b.onclick=()=>{let w=b.
closest(".diff-block, .tool-diff-block");if(!w)return;let h=w.querySelector("code");if(!h)return;let M=h.querySelectorAll(
".diff-ctx"),_=Array.from(M).some(L=>!L.classList.contains("diff-ctx-hidden"));M.forEach(L=>L.classList.toggle("diff-ctx\
-hidden",_)),h.querySelectorAll(".diff-hunk-btn").forEach(L=>L.classList.toggle("diff-hunk-ctx-collapsed",_)),b.classList.
toggle("active",_),b.title=_?"Expand all context lines":"Collapse all context lines"}}),c.current.querySelectorAll(".too\
l-show-all").forEach(b=>{b.onclick=()=>{let h=b.closest(".tool-body")?.querySelector("code"),M=b.closest(".tool-section");
if(!h||!M)return;let C=Number(M.dataset.toolIndex||"-1"),_=Cm(e||"")[C];!_||_.type!=="tool"||(h.textContent=_.content||"",
b.remove())}}),R.codeScroll.length&&c.current.querySelectorAll(".code-block pre").forEach((b,w)=>{w<R.codeScroll.length&&
R.codeScroll[w]>0&&(b.scrollTop=R.codeScroll[w])});let S=null,T=c.current.querySelector(".diff-summary-bar");if(T&&typeof IntersectionObserver<
"u"){let b=Array.from(c.current.querySelectorAll(".diff-block[id]"));if(b.length>=2){let w=null,h=c.current.parentElement;
for(;h&&h!==document.body;){let C=window.getComputedStyle(h);if(C.overflowY==="auto"||C.overflowY==="scroll"||C.overflow===
"auto"||C.overflow==="scroll"){w=h;break}h=h.parentElement}let M=new IntersectionObserver(C=>{C.forEach(_=>{if(!_.isIntersecting)
return;let L=_.target.id;T.querySelectorAll(".diff-summary-chip").forEach(P=>{P.classList.toggle("active",P.dataset.target===
L)})})},{root:w,threshold:.1});b.forEach(C=>M.observe(C)),S=()=>M.disconnect()}}return()=>{S&&S()}},[e,s,o,f]),React.createElement(
"div",{className:`message-body${t?" monospace-body":""}`,ref:c,"data-rich-content-ready":f?"true":"false"})}function Wu(e,t=null,n=Date.now()){return{sessionId:e,messageId:null,blockIndex:0,seq:-1,content:"",open:!0,startedAtMs:n,
clientMessageId:t}}function Im(e,t,n=!1){if(!e||String(e.content||"").length>0||n)return!1;let s=String(t?.kind||"idle").
toLowerCase();return["idle","waiting_for_user","completed","done","failed","error","interrupted"].includes(s)}function Pm(e,t,n=Date.
now()){let s=t?.session_id||t?.session||"",a=t?.message_id||"",o=Number(t?.block_index),c=Number(t?.seq);return!s||!a||!Number.
isSafeInteger(o)||o<0||!Number.isSafeInteger(c)||c<0?{accepted:!1,code:"invalid_identity",stream:e||null}:t.op==="block_\
open"?c!==0?{accepted:!1,code:"invalid_open_sequence",stream:e||null}:{accepted:!0,stream:{...Wu(s,e?.clientMessageId||null,
e?.startedAtMs||n),messageId:a,blockIndex:o,seq:c}}:!e||e.messageId!==a||e.blockIndex!==o||!e.open?{accepted:!1,code:"st\
ream_not_open",stream:e||null}:c!==e.seq+1?{accepted:!1,code:"sequence_gap",stream:e}:t.op==="append"?typeof t.append!="\
string"||t.append.length===0?{accepted:!1,code:"invalid_append",stream:e}:{accepted:!0,stream:{...e,seq:c,content:`${e.content||
""}${t.append}`}}:t.op==="block_close"?{accepted:!0,stream:{...e,seq:c,open:!1}}:{accepted:!1,code:"invalid_operation",stream:e}}function js(e){if(e==null||e==="")return null;let t=null;if(typeof e=="number"||typeof e=="string"&&/^\d+(?:\.\d+)?$/.test(
e.trim())){let s=Number(e);Number.isFinite(s)&&s>0&&(t=s>1e12?s:s*1e3)}else{let s=Date.parse(String(e));Number.isFinite(
s)&&s>0&&(t=s)}if(!Number.isFinite(t)||t<=0)return null;let n=new Date(t);return Number.isNaN(n.getTime())?null:{epoch_ms:n.
getTime(),epoch_seconds:n.getTime()/1e3,iso:n.toISOString()}}function qi(e){return!e||typeof e!="object"?null:js(e.created_at)||
js(e.timestamp)||js(e.ts)||null}function Di(e){if(!e||typeof e!="object")return e;let t=qi(e);return!t||e.timestamp===t.
iso&&e.timestamp_ms===t.epoch_ms&&Number(e.ts)===t.epoch_seconds?e:{...e,ts:t.epoch_seconds,timestamp:t.iso,timestamp_ms:t.
epoch_ms}}function Dm(e){if(!Array.isArray(e))return[];let t=!1,n=e.map(s=>{let a=Di(s);return a!==s&&(t=!0),a});return t?
n:e}function qm(e,t){return new Intl.DateTimeFormat("en-US-u-ca-gregory",{year:"numeric",...t?{timeZone:t}:{}}).format(e)}
function Ku(e,t=new Date,n=void 0,s=void 0){let a=e&&typeof e=="object"&&Number.isFinite(e.epoch_ms)?e:js(e);if(!a)return"";
let o=new Date(a.epoch_ms),c={...qm(o,s)===qm(t,s)?{}:{year:"numeric"},month:"short",day:"numeric",hour:"numeric",minute:"\
2-digit",...s?{timeZone:s}:{}};return new Intl.DateTimeFormat(n,c).format(o)}function jm(e,t=void 0,n=void 0){let s=e&&typeof e==
"object"&&Number.isFinite(e.epoch_ms)?e:js(e);return s?`${new Intl.DateTimeFormat(t,{dateStyle:"full",timeStyle:"long",...n?
{timeZone:n}:{}}).format(new Date(s.epoch_ms))} (${s.iso})`:""}function Bm(e,t){let n=e&&typeof e=="object"?e:{},s=t&&typeof t=="object"?t:{},a=s.streamTrace!=null,o=s.latencyTrace!=null;
return{stream:s.stream??n.stream??null,streamTrace:a?s.streamTrace:n.streamTrace??null,latencyTrace:o?s.latencyTrace:n.latencyTrace??
null,receivedAtMs:o?s.receivedAtMs??null:n.latencyTrace!=null?n.receivedAtMs??null:null}}function Fm(){let e=new Map,t=2048,n="";return{reset(s=""){let a=String(s||"");a!==n&&(n=a,e.clear())},accept(s,a){let o=Number(
s?.state_seq);if(!Number.isSafeInteger(o)||o<0)return!0;let c=String(s?.state_epoch||n||"legacy");if(n&&c!==n)return!1;n||
(n=c);let u=String(a||s?.type||"state"),m=e.get(u);if(m?.epoch===c&&o<=m.seq)return!1;for(e.has(u)&&e.delete(u),e.set(u,
{epoch:c,seq:o});e.size>t;)e.delete(e.keys().next().value);return!0},size(){return e.size}}}var Kc=/(?:!\[[^\]]*\]\([^)]*\)|\[File:\s*[^\]]+\]|\b(?:image|screenshot|screen\s*shot|capture)[\w .()[\]-]*\.(?:png|jpe?g|gif|webp|bmp|svg)\b)/gi,
Vc=/(?:[A-Za-z]:[\\/]|\\\\[^\\/\s]+[\\/]|\/(?:Users|home|mnt|var|tmp|etc|opt|workspace|workspaces)\/)[^\s"'`<>)]{2,}/gi,
Tb=/^(?=.*\d)(?:(?:\d+)\s*d\s*)?(?:(?:\d+)\s*h\s*)?(?:(?:\d+)\s*m\s*)?(?:(?:\d+)\s*s)?$/i,$b=/^[+-]?\d+\s*[dhms]\b/i,Eb=/^(?:just now|today|yesterday|(?:\d+|an?|one)\s+(?:seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?)\s+ago)$/i,
Lb=/^(?:pursuing goal|paused goal|goal (?:paused|blocked|usage limited|rate limited|limited|budget limited|achieved|cancelled|canceled|stopped|failed)|idle|ready|connected|awaiting live update)$/i,
Ob=/^(?:no (?:recent message|current work|data|activity)(?: reported)?|unavailable|unknown|not available)$/i,Ib=/^(?:(?:antigravity|claude(?: code)?|cline|codex|continue|cursor|gemini|roo code)\s+(?:harness|workspace))$/i,
Hm=new Set(["agent","agentmanager","agentsession","antigravity","antigravitychat","antigravityv2","claude","claudecli","\
claudecode","claudecodecli","claudedesktop","cline","codex","codexcli","codexdesktop","connected","connectedsession","co\
ntinue","continueyolo","cursor","cursoragent","cursorcli","cursoride","gemini","geminicodeassist","newchat","newconversa\
tion","other","proceed","resume","roocode","session","unknown","attachment","file","image","screenshot","disregardthatla\
stmessage","ignorethatlastmessage"]);function ji(e){return typeof e=="string"?e:Array.isArray(e)?e.map(ji).filter(Boolean).
join(`
`):!e||typeof e!="object"?"":ji(e.text||e.content||e.markdown||e.value||"")}function Vu(){Kc.lastIndex=0,Vc.lastIndex=0}
function Pb(e){let t=ji(e).replace(/\s+/g," ").trim();return t?Tb.test(t)?"duration_only":$b.test(t)?"duration_malformed":
Eb.test(t)?"age_only":Lb.test(t)?"status_only":Ob.test(t)?"placeholder_only":Ib.test(t)?"surface_label_only":"":"empty"}
function Xa(e){let t=ji(e).replace(/\s+/g," ").trim();if(!t||Pb(t)||/^\[(?:attachment|file|image|screenshot)(?:\s*:[^\]]*)?\]$/i.
test(t)||/^new\s+(?:antigravity|claude|codex|continue|cursor|gemini|roo)(?:\s+(?:agent|chat|cli|code|desktop|ide|panel))*\s+(?:chat|conversation|session|thread)$/i.
test(t))return!0;let n=Kc.test(t)||Vc.test(t);if(Vu(),n){let a=t.replace(Kc," ").replace(Vc," ").replace(/\b(?:read|open|view|inspect|check|review|show|load|attach|attached|upload|uploaded|file|image|screenshot)\b/gi,
" ").replace(/[^a-z0-9]+/gi,"").trim();if(Vu(),a.length<12)return!0}let s=t.toLowerCase().replace(/[^a-z0-9]+/g,"").replace(
/^remoteagent(?:chat)?/,"");return s?Hm.has(s)?!0:(s=s.replace(/(?:new|production|session|chat|smoke|test|probe|verification|fixture|extension|ext|ide|app|panel|pane)$/g,
""),Hm.has(s)):!/[\p{L}\p{N}]/u.test(t)}function Gm(e){let t=ji(e);if(!t)return"";let n=t.replace(/<goal_context>[\s\S]*?<\/goal_context>/gi,
" ").replace(/```[\s\S]*?```/g," ").replace(Kc," ").replace(Vc," ").replace(/<[^>\n]{1,120}>/g," ").replace(/`([^`]+)`/g,
"$1").replace(/^\s*(?:user|assistant|codex|claude|tool result)\s*[:\-]\s*/i,"").replace(/\s+/g," ").trim();return Vu(),!n||
Xa(n)||/^(?:thinking|working|tool result|tool:|exit code|wall time|read|open|view|inspect|check|review|show|load|attach|attached|uploaded|file|image|screenshot)\b/i.
test(n)&&n.split(/\s+/).length<=4||/^[^\p{L}\p{N}]+$/u.test(n)?"":n.slice(0,80).trim()}function qb(e){let t=Array.isArray(
e)?e:[];for(let n of t){if(String(n?.role||"").toLowerCase()!=="user")continue;let s=Gm(n?.content||n?.content_blocks);if(s)
return s}return""}var zm=Object.freeze({fallback:0,route:.5,message:1,summary:2,custom:3,native:4}),Db=Object.freeze(["c\
odex_desktop_active_thread_title","cursor_agent_title","native_chat_title","session_title","thread_title","conversation_\
title","title","display_title","summary","chat_title","chat_title_source","thread_name","conversation_name","custom_disp\
lay_name","is_new_chat_draft","is_list_view"]);function Um(e){return ji(e).replace(/\s+/g," ").trim()}function Wm(e){return!e||
typeof e!="object"?{}:Object.fromEntries(Db.filter(t=>Object.prototype.hasOwnProperty.call(e,t)).map(t=>[t,e[t]]))}function Yu(e,t="",n=[],s=""){
let a=e&&typeof e=="object"?e:{},c=[["codex_desktop_active_thread_title",a.codex_desktop_active_thread_title],["cursor_a\
gent_title",a.cursor_agent_title],["native_chat_title",a.native_chat_title],["session_title",a.session_title],["thread_t\
itle",a.thread_title],["conversation_title",a.conversation_title],["title",a.title],["display_title",a.display_title],["\
chat_title",a.chat_title_source==="summary"?"":a.chat_title],["thread_name",a.thread_name],["conversation_name",a.conversation_name]].
map(([k,R])=>({field:k,title:Um(R)})).find(k=>k.title&&!Xa(k.title));if(c)return{title:c.title.slice(0,80).trim(),source:"\
native",field:c.field};let u=Um(t);if(u&&!Xa(u))return{title:u.slice(0,80).trim(),source:"custom",field:"custom_display_\
name"};let f=[["chat_title",a.chat_title_source==="summary"?a.chat_title:""],["summary",a.summary],["derived_message_tit\
le",s]].map(([k,R])=>({field:k,title:Gm(R)})).find(k=>k.title);if(f)return{title:f.title,source:"summary",field:f.field};
let v=qb(n);return v?{title:v,source:"message",field:"first_meaningful_user_message"}:{title:"New chat",source:"fallback",
field:"new_chat"}}function Km(e,t){if(!e?.title)return t;if(!t?.title)return e;let n=zm[e.source]??0;return(zm[t.source]??
0)>=n?t:e}function Vm(e,t="",n=[],s=""){return Yu(e,t,n,s).title}var jb=/(?:\bbearer\s+[a-z0-9._~+/=-]{8,}|\b(?:api[_ -]?key|password|passwd|secret|access[_ -]?token|refresh[_ -]?token)\s*[:=]\s*\S+|\bsk-[a-z0-9_-]{8,})/i,
Bb=/(?:[A-Za-z]:[\\/]|\\\\[^\\/\s]+[\\/]|\/(?:Users|home|mnt|var|tmp|etc|opt|workspace|workspaces)\/)[^\s"'<>)]{2,}/i;function Fb(e){
let t=0;for(let n of String(e||"")){let s=n.codePointAt(0);t+=s<=127?1:s<=2047?2:s<=65535?3:4}return t}function _s(e,t=96){
if(typeof e!="string"&&typeof e!="number")return"";let n=String(e).replace(/[\u0000-\u001f\u007f]+/g," ").replace(/\s+/g,
" ").trim();return!n||jb.test(n)||Bb.test(n)?"":n.slice(0,t).trim()}function Yc(e){if(e==null||e==="")return null;let t=typeof e==
"number"&&Number.isFinite(e)?e:NaN,n=Number.isFinite(t)?t>0&&t<1e12?t*1e3:t:Date.parse(String(e));return Number.isFinite(
n)&&n>0?new Date(n).toISOString():null}function Hb(e){let t=String(e||"").trim().toLowerCase().replace(/[^a-z]/g,"");return{
active:"active",paused:"paused",blocked:"blocked",usagelimited:"usageLimited",ratelimited:"usageLimited",budgetlimited:"\
budgetLimited",complete:"complete",completed:"complete",cancelled:"cancelled",canceled:"cancelled",failed:"failed",idle:"\
idle",working:"working"}[t]||null}function Xu(e){if(!e||typeof e!="object"||Number(e.schema_version)!==1)return null;let t={
schema_version:1,parser_version:_s(e.parser_version,32)||"fleet-summary-v1",session_key:_s(e.session_key,40),session_generation:Math.
max(1,Number(e.session_generation)||1),thread_key:_s(e.thread_key,40),thread_generation:Math.max(1,Number(e.thread_generation)||
1),producer_seq:Math.max(0,Number(e.producer_seq)||0),summary_seq:Math.max(0,Number(e.summary_seq)||0),title:_s(e.title,
80)||null,title_source:_s(e.title_source,24)||null,title_confidence:["authoritative","derived","unknown"].includes(e.title_confidence)?
e.title_confidence:"unknown",latest_user_request:_s(e.latest_user_request)||null,latest_user_request_at:Yc(e.latest_user_request_at),
current_work:_s(e.current_work)||null,current_work_source:_s(e.current_work_source,32)||null,current_work_kind:_s(e.current_work_kind,
24)||null,current_work_state:Hb(e.current_work_state),current_work_at:Yc(e.current_work_at),last_role:["user","assistant"].
includes(e.last_role)?e.last_role:null,last_message_at:Yc(e.last_message_at),last_snippet:_s(e.last_snippet)||null,message_count:Math.
max(0,Number(e.message_count)||0),user_count:Math.max(0,Number(e.user_count)||0),assistant_count:Math.max(0,Number(e.assistant_count)||
0),other_count:Math.max(0,Number(e.other_count)||0),role_imbalance:["balanced","assistant_without_user","user_without_as\
sistant"].includes(e.role_imbalance)?e.role_imbalance:"balanced",rejected_candidate_reason:_s(e.rejected_candidate_reason,
48)||null,fresh_at:Yc(e.fresh_at)};return!t.session_key||!t.thread_key||Fb(JSON.stringify(t))>1024?null:t}function Ym(e){
return e?.title_confidence==="authoritative"?3:e?.title_confidence==="derived"?2:e?.title?1:0}function Xm(e,t){let n=Xu(
e),s=Xu(t);if(!s)return{summary:n,accepted:!1,changed:!1,reason:"invalid"};if(!n)return{summary:{...s,summary_seq:Math.max(
1,s.summary_seq)},accepted:!0,changed:!0,reason:"initial"};if(s.session_generation<n.session_generation)return{summary:n,
accepted:!1,changed:!1,reason:"older_session_generation"};if(s.session_generation===n.session_generation&&s.session_key!==
n.session_key)return{summary:n,accepted:!1,changed:!1,reason:"session_identity_mismatch"};if(s.session_generation===n.session_generation&&
s.thread_generation<n.thread_generation)return{summary:n,accepted:!1,changed:!1,reason:"older_thread_generation"};if(s.session_generation===
n.session_generation&&s.thread_generation===n.thread_generation&&s.thread_key!==n.thread_key)return{summary:n,accepted:!1,
changed:!1,reason:"thread_identity_mismatch"};let a=s.session_generation>n.session_generation||s.thread_generation>n.thread_generation,
o=s.producer_seq>n.producer_seq||s.producer_seq===n.producer_seq&&s.summary_seq>n.summary_seq;if(!a&&!o)return{summary:n,
accepted:!1,changed:!1,reason:"replayed_or_out_of_order"};let c=a?{...s}:{...n,...s};if(!a){(!s.title||Ym(s)<Ym(n))&&(c.
title=n.title,c.title_source=n.title_source,c.title_confidence=n.title_confidence);for(let m of["latest_user_request","l\
atest_user_request_at","current_work","current_work_source","current_work_kind","current_work_state","current_work_at","\
last_role","last_message_at","last_snippet","fresh_at"])(s[m]==null||s[m]==="")&&(c[m]=n[m]);for(let m of["message_count",
"user_count","assistant_count","other_count"])c[m]=Math.max(n[m]||0,s[m]||0)}c.summary_seq=Math.max(n.summary_seq||0,s.summary_seq||
0);let u=JSON.stringify(n)!==JSON.stringify(c);return{summary:u?c:n,accepted:!0,changed:u,reason:u?"upgraded":"unchanged"}}
function Qm(e){let t=Xu(e);if(!t)return{};let n=t.current_work?{kind:t.current_work_kind||"activity",label:t.current_work_kind===
"goal"?"Goal":t.current_work_kind==="request"?"Request":"Current work",text:t.current_work,source:t.current_work_source||
"fleet_summary",updated_at:t.current_work_at,...t.current_work_state?{state:t.current_work_state}:{}}:null;return{fleet_summary:t,
...t.title?{chat_title:t.title,chat_title_source:t.title_source}:{},...t.latest_user_request?{last_user_request:{text:t.
latest_user_request,updated_at:t.latest_user_request_at}}:{},...t.last_snippet?{last_snippet:t.last_snippet,last_message_at:t.
last_message_at}:{},...n?{fleet_work_context:n}:{}}}var Jm=new Set(["__proto__","constructor","prototype"]);function Zm(e){return typeof e=="string"?e:e?.session_id||e?.id||
""}function Tt(e,t){if(Object.is(e,t))return!0;if(e==null||t==null||typeof e!=typeof t||typeof e!="object")return!1;if(Array.
isArray(e)||Array.isArray(t)){if(!Array.isArray(e)||!Array.isArray(t)||e.length!==t.length)return!1;for(let a=0;a<e.length;a+=
1)if(!Tt(e[a],t[a]))return!1;return!0}let n=Object.keys(e),s=Object.keys(t);if(n.length!==s.length)return!1;for(let a of n)
if(!Object.prototype.hasOwnProperty.call(t,a)||!Tt(e[a],t[a]))return!1;return!0}function Xc(e=[]){let t=[],n=[],s=Object.
create(null),a=Object.create(null);for(let o of Array.isArray(e)?e:[]){let c=Zm(o);if(!c||Object.prototype.hasOwnProperty.
call(s,c))continue;a[c]=t.length,n.push(c);let u=Ju(null,o);s[c]=u,t.push(u)}return{byId:s,indexById:a,order:n,list:t}}function Qu(e){
return e?.is_new_chat_draft===!0}function Ju(e,t){if(!t||typeof t!="object")return t;if(Qu(t)){let o={...t};for(let c of[
"fleet_summary","fleet_work_context","last_user_request","last_snippet","last_message_at"])delete o[c];return o}let n=Xm(
e?.fleet_summary,t.fleet_summary).summary;if(!n)return t;let s=Qm(n),a={...t,...s};return s.fleet_work_context&&a.activity&&
typeof a.activity=="object"&&!a.activity.work_context&&(a.activity={...a.activity,work_context:s.fleet_work_context}),a}
function ef(e,t){return!e||typeof e!="object"||!t||typeof t!="object"||Qu(t)||Xa(e.chat_title)||!Xa(t.chat_title)?t:{...t,
chat_title:e.chat_title,chat_title_source:e.chat_title_source||t.chat_title_source||null}}function Do(e,t){let n=e?.byId?
e:Xc(),s=Array.isArray(t)?t:[],a=[],o=[],c=Object.create(null),u=Object.create(null),m=s.length!==n.list.length;for(let f of s){
let v=Zm(f);if(!v||Object.prototype.hasOwnProperty.call(c,v))continue;let k=n.byId[v],R=ef(k,Ju(k,f)),S=k!==void 0&&Tt(k,
R)?k:R;u[v]=a.length,o.push(v),c[v]=S,a.push(S),(!Object.is(S,k)||n.order[a.length-1]!==v)&&(m=!0)}return(a.length!==s.length||
a.length!==n.list.length)&&(m=!0),m?{byId:c,indexById:u,order:o,list:a}:n}function tf(e,t){let n=e?.byId?e:Xc(),s=t?.session_id||
t?.session||"";if(!s||!Object.prototype.hasOwnProperty.call(n.byId,s))return n;let a=n.byId[s],o=a&&typeof a=="object"?a:
{session_id:s},c=t?.patch&&typeof t.patch=="object"?t.patch:{},u=Array.isArray(t?.removed_fields)?t.removed_fields:[],m=Qu(
c),f=!m&&!Xa(o.chat_title)&&(!Object.prototype.hasOwnProperty.call(c,"chat_title")||Xa(c.chat_title)),v=o;for(let[T,b]of Object.
entries(c))Jm.has(T)||T==="session_id"||T==="id"||f&&(T==="chat_title"||T==="chat_title_source")||Tt(v[T],b)||(v===o&&(v=
{...o}),v[T]=b);for(let T of u)typeof T!="string"||Jm.has(T)||T==="session_id"||T==="id"||f&&(T==="chat_title"||T==="cha\
t_title_source")||Object.prototype.hasOwnProperty.call(v,T)&&(v===o&&(v={...o}),delete v[T]);if(m&&!Object.prototype.hasOwnProperty.
call(c,"chat_title")&&(v===o&&(v={...o}),v.chat_title=null,v.chat_title_source=null),v=ef(o,Ju(o,v)),Tt(v,o))return n;v.
session_id=s;let k=n.indexById[s],R=n.list.slice();R[k]=v;let S=Object.assign(Object.create(null),n.byId);return S[s]=v,
{byId:S,indexById:n.indexById,order:n.order,list:R}}var nf=10,wt=new Map,jo=new Map,zb=Object.freeze([]);function Lr(e){return String(e||"").trim()}function Ub(e){return!e||
typeof e!="object"?"":e.source_message_id?`source:${e.source_message_id}`:e.native_source_id?`native:${e.native_source_id}`:
e.id!=null?`id:${e.id}`:e.server_message_id!=null?`server:${e.server_message_id}`:e.sequence!=null?`sequence:${e.sequence}`:
e.client_message_id?`client:${e.client_message_id}`:e.client_msg_id?`client:${e.client_msg_id}`:e._cid?`client:${e._cid}`:
`content:${e.role||""}:${e.ts||""}:${String(e.content||"")}`}function Gb(e,t){let n=[],s=new Map;return[...Array.isArray(
e)?e:[],...Array.isArray(t)?t:[]].forEach(a=>{let o=Ub(a);if(o&&s.has(o)){let c=s.get(o),u=n[c],m=Array.isArray(u?.content_blocks)&&
u.content_blocks.some(v=>v?.type==="memory_citation"),f=Array.isArray(a?.content_blocks)&&a.content_blocks.some(v=>v?.type===
"memory_citation");n[c]=m&&!f?{...u,...a,content:u.content,content_blocks:u.content_blocks}:{...u,...a};return}o&&s.set(
o,n.length),n.push(a)}),n.sort((a,o)=>{let c=Number(a?.sequence),u=Number(o?.sequence);return Number.isFinite(c)&&Number.
isFinite(u)&&c!==u?c-u:(Number(a?.ts)||0)-(Number(o?.ts)||0)})}function sf(e){let t=Lr(e);if(!t||!wt.has(t))return null;
let n=wt.get(t);return wt.delete(t),wt.set(t,n),n}function Qc(e){let t=Lr(e);return t&&wt.get(t)||zb}function af(e,t){let n=Lr(
e);if(!n||typeof t!="function")return()=>{};let s=jo.get(n)||new Set;return s.add(t),jo.set(n,s),()=>{let a=jo.get(n);a&&
(a.delete(t),a.size===0&&jo.delete(n))}}function Zu(e){let t=jo.get(e);t&&[...t].forEach(n=>n())}function ed(e,t,n=nf){let s=Lr(e);if(!s||!Array.isArray(t))return[];let a=Dm(t),o=wt.get(s);wt.delete(s),wt.set(s,a);let c=[],
u=Math.max(1,Number(n)||nf);for(;wt.size>u;){let m=wt.keys().next().value;wt.delete(m),c.push(m)}return o!==a&&Zu(s),c.forEach(
Zu),c}function td(e){let t=Lr(e);return!t||!wt.has(t)?!1:(wt.delete(t),Zu(t),!0)}function rf(e,t){let n=Lr(e),s=Lr(t);if(!n||
!s||n===s)return Qc(s);let a=wt.get(n)||[],o=wt.get(s)||[];return a.length>0&&ed(s,Gb(o,a)),td(n),Qc(s)}function Wb(){return Object.
fromEntries([...wt.entries()])}function of(e){let t=Wb(),n=typeof e=="function"?e(t):e;if(!n||n===t||typeof n!="object")
return t;let s=new Set(Object.keys(n));return Object.keys(t).forEach(a=>{s.has(a)||td(a)}),Object.entries(n).forEach(([a,
o])=>{Array.isArray(o)&&t[a]!==o&&ed(a,o)}),n}var nd=new Proxy({},{get(e,t){if(typeof t=="string")return wt.get(t)},ownKeys(){
return[...wt.keys()]},getOwnPropertyDescriptor(e,t){if(typeof t=="string"&&wt.has(t))return{configurable:!0,enumerable:!0,
value:wt.get(t)}},set(e,t,n){return typeof t!="string"||!Array.isArray(n)?!1:(ed(t,n),!0)},deleteProperty(e,t){return typeof t==
"string"?td(t):!1}});var Kb=new Set(["thinking","generating","reading_files","running_command","applying_patch","working"]),Vb=new Set(["wait\
ing_for_user","needs_attention","blocked","rate_limited","usage_limited","budget_limited","failed","error"]),Yb=new Set(
["blocked","usagelimited","budgetlimited","failed"]),Xb=new Set(["complete","completed","cancelled","canceled"]),cf=new Set(
["starting","running_turn","checkpoint_pending_continuation","verifying"]),Qb=new Set(["waiting_for_user","blocked_limit\
ed"]),Jb=new Set(["paused","completed_cancelled_failed","unknown_disconnected"]),sd=15e3;function Zb(e){return String(e?.
goal?.state||e?.goal?.status||"").trim().toLowerCase().replace(/[^a-z]/g,"")}function lf(e){let t=e?.goal,n=e?.goal_run;
return!t||!n||n.schema_version!==1||!n.run_id||!n.goal_fingerprint||!Number.isFinite(Number(n.goal_generation))||String(
n.goal_fingerprint)!==String(t.fingerprint||"")||Number(n.goal_generation)!==Math.max(1,Number(t.generation)||1)?null:n}
function Or(e){if(typeof e=="number"&&Number.isFinite(e))return e;let t=Date.parse(String(e||""));return Number.isFinite(
t)?t:0}function el(e){return Math.max(Or(e?.transport?.client_received_at_ms),Or(e?.transport?.relay_forwarded_at_ms),Or(
e?.observed_at),Or(e?.updatedAt),Or(e?.updated_at))}function Jc(e,t={}){if(t.connected===!1||String(t.health||"").toLowerCase()===
"disconnected"||t.fresh===!1)return!1;if(t.requireFreshness!==!0)return!0;let n=el(e);if(!n)return!1;let s=Number.isFinite(
Number(t.nowMs))?Number(t.nowMs):Date.now(),a=Math.max(1e3,Number(t.freshnessMs)||sd);return s-n<=a}function tl(e,t=!1,n={}){
let s=String(e?.kind||"").trim().toLowerCase(),a=Zb(e),o=lf(e),c=String(o?.lifecycle||"").trim().toLowerCase();if(t||Vb.
has(s)||Qb.has(c))return"needs_attention";let u=e?.generating===!0||Kb.has(s);return o?.lease_active===!0&&o.owner_state===
"confirmed"&&cf.has(c)&&u&&Jc(e,n)?"working_goal":Yb.has(a)?"needs_attention":o&&c==="unknown_disconnected"?"stale":o&&Jb.
has(c)||Xb.has(a)?"idle":o?.lease_active===!0&&cf.has(c)?"working_goal":o&&a==="active"||a==="active"?Jc(e,n)?"between_g\
oal_turns":"stale":s==="idle"&&a!=="active"?"idle":Jc(e,n)?u?"working":"idle":"stale"}function nl(e,t={}){let n=lf(e),s=String(
n?.lifecycle||"").trim().toLowerCase();return!n||n.lease_active!==!0?"":s==="checkpoint_pending_continuation"?"Waiting f\
or next goal turn":s==="verifying"||t.connected===!1||String(t.health||"").toLowerCase()==="disconnected"?"Reconnecting":
s==="starting"?"Starting goal":s==="running_turn"?"Working":"Goal loop active"}function uf(e){return e==="working_goal"?
"Working on goal":e==="working"?"Working":e==="between_goal_turns"?"Between goal turns":e==="needs_attention"?"Needs att\
ention":e==="stale"?"Stale":"Idle"}function Ir(e){return e==="working_goal"||e==="working"}function df(e,t=null,n=Date.now()){
if(!e||typeof e!="object")return 0;let s=Math.max(0,Number(e.time_used_seconds??e.timeUsedSeconds??0)||0),a=Or(e.updated_at||
e.updatedAt),o=String(e.state||e.status||"").toLowerCase()==="active",c=t&&t.lease_active!==!0?Or(t.lease_observed_at||t.
observed_at):Number(n),u=c>0?Math.min(Number(n)||c,c):a,m=o&&a>0?Math.max(0,Math.floor((u-a)/1e3)):0;return Math.floor(s+
m)}function Zc(e){let t=Number(e);return Number.isFinite(t)&&t>0?t:null}function pf(e,t=Date.now()){if(!e||typeof e!="ob\
ject")return null;let n=Zc(e.proxy_emitted_at_ms),s=Zc(e.relay_received_at_ms),a=Zc(e.relay_forwarded_at_ms),o=Zc(t)||Date.
now();return{proxy_emitted_at_ms:n,relay_received_at_ms:s,relay_forwarded_at_ms:a,client_received_at_ms:o,latency_ms:n==
null?null:Math.max(0,o-n)}}function mf(e,t=Date.now()){let n=Number(e?.transport?.latency_ms);if(Number.isFinite(n))return`${Math.
round(n)} ms`;let s=el(e);if(!s)return"Awaiting live update";let a=Math.max(0,Number(t)-s);return a<1e3?"Observed just n\
ow":a<6e4?`Observed ${Math.floor(a/1e3)}s ago`:a<36e5?`Observed ${Math.floor(a/6e4)}m ago`:`Observed ${Math.floor(a/36e5)}\
h ago`}var ey=Object.freeze(["goal_completed","goal_attention","provider_usage_threshold"]),ty=new Set(ey),ff=Object.freeze({goal_completed:"\
goal_completed",goal_attention:"goal_attention",provider_usage_threshold:"provider_usage_warning"}),gf="remote-agent-cha\
t:semantic-notifications:v1",ny="remote-agent-chat:semantic-notification-claim:v1:",_f=256,sy=10080*60*1e3;function sl(e){
if(!e||typeof e!="object"||e.type!=="semantic_notification")return null;let t=String(e.event_type||"").trim(),n=String(e.
dedupe_key||"").trim(),s=String(e.session_id||e.session||"").trim();if(!ty.has(t)||!n||!s)return null;let a=String(e.category||
ff[t]).trim();return a!==ff[t]?null:{...e,type:"semantic_notification",event_type:t,category:a,dedupe_key:n,session_id:s,
session:s,title:String(e.title||"").trim()||(t==="goal_completed"?"Goal completed":t==="provider_usage_threshold"?"Provi\
der usage warning":"Goal needs attention"),body:String(e.body||"").trim(),created_at:e.created_at||new Date().toISOString()}}
function rd(e,t,n=100){let s=new Map;return[...Array.isArray(e)?e:[],...Array.isArray(t)?t:[t]].map(sl).filter(Boolean).
forEach(a=>s.set(a.dedupe_key,a)),[...s.values()].slice(-Math.max(1,Number(n)||100))}function bf(e,t={}){let n=sl(e);return!!n&&
t?.[n.category]===!0}function ad(e,t){try{let n=JSON.parse(e?.getItem(gf)||"{}");return Object.fromEntries(Object.entries(
n||{}).filter(([,s])=>Number(s)>t-sy).slice(-_f))}catch{return{}}}function hf(e,t,n){let s=ad(e,n);if(s[t])return!1;s[t]=
n;let a=Object.entries(s).slice(-_f);try{e?.setItem(gf,JSON.stringify(Object.fromEntries(a)))}catch{}return!0}function ay(e){
return new Promise(t=>setTimeout(t,e))}async function ry(e,t,n){if(!e)return!0;if(ad(e,n)[t])return!1;let s=`${ny}${encodeURIComponent(
t).slice(0,320)}`,a=`${n}:${Math.random().toString(36).slice(2)}`;try{if(e.setItem(s,JSON.stringify({token:a,at:n})),await ay(
20),JSON.parse(e.getItem(s)||"{}").token!==a||!hf(e,t,n))return!1;let c=ad(e,n)[t]===n;return c&&e.removeItem(s),c}catch{
return hf(e,t,n)}}async function yf(e,{storage:t=typeof localStorage<"u"?localStorage:null,locks:n=typeof navigator<"u"?
navigator.locks:null,now:s=()=>Date.now()}={}){let a=sl(e);if(!a)return!1;let o=()=>ry(t,a.dedupe_key,s());return n?.request?
n.request(`rac-semantic:${a.dedupe_key}`,{mode:"exclusive"},o):o()}async function Pr(e,t,{channel:n="web-in-app",reasonCode:s="",
clientId:a="web-app"}={}){let o=sl(e);if(!o||!["claimed","displayed","suppressed"].includes(t)||typeof fetch!="function")
return!1;try{return(await fetch("/api/notifications/semantic-receipts",{method:"POST",credentials:"same-origin",keepalive:!0,
headers:{"Content-Type":"application/json"},body:JSON.stringify({dedupe_key:o.dedupe_key,stage:t,channel:n,...s?{reason_code:s}:
{},client_id:a})})).ok}catch{return!1}}function vf(e,t,n=""){if(!t)return"";let s=e||{};return n&&(s[n]||[]).some(a=>a?._cid===t)?n:Object.keys(s).find(a=>(s[a]||
[]).some(o=>o?._cid===t))||""}function wf(e,t,n,s){if(!t||!n||typeof s!="function")return e;let a=e?.[n]||[],o=!1,c=a.map(
u=>{if(u?._cid!==t)return u;let m=s(u);return m!==u&&(o=!0),m});return o?{...e,[n]:c}:e}function iy(e){let t=Number(e);return!Number.isSafeInteger(t)||t<=0?0:t}function oy(e){return String(e?.navigation_session_id||
e?.session_id||e?.session||"")}function kf(e={}){let t=Math.max(1,Number(e.maxEntries)||512),n=new Map;function s(a,o){for(n.
delete(a),n.set(a,o);n.size>t;)n.delete(n.keys().next().value)}return{accept(a){let o=oy(a),c=iy(a?.navigation_epoch);if(!o||
!c)return!0;let u=n.get(o)||0;return c<u?!1:(s(o,c),!0)},latest(a){return n.get(String(a||""))||0},get size(){return n.size}}}var cy=new Set(["user","assistant","tool","tool_result","permission","permission_prompt","question","question_prompt","e\
rror","system"]);function et(e){return typeof e=="string"?e:String(e?.session_id||e?.id||"")}function ly(e){let t=String(
e||"").trim().toLowerCase().replace(/[\s-]+/g,"_");return cy.has(t)?t==="permission_prompt"?"permission":t==="question_p\
rompt"?"question":t:null}function uy(e){let t=String(e||"").trim();return!t||t.length>256||/[\u0000-\u001f\u007f]/.test(
t)?null:t}function dy(e){let t=String(e||"").trim().toLowerCase().replace(/[\s-]+/g,"_");return!t||t.length>64||/[^a-z0-9_.:/]/.
test(t)?null:t}function py(e){if(typeof e=="number"||typeof e=="string"&&/^\d+(?:\.\d+)?$/.test(e.trim())){let n=Number(
e);return!Number.isFinite(n)||n<=0?null:n>1e12?n:n*1e3}if(typeof e!="string"||!e.trim())return null;let t=Date.parse(e);
return Number.isFinite(t)&&t>0?t:null}function qr(e){if(!e||typeof e!="object")return null;let t=e.latest_visible_message&&
typeof e.latest_visible_message=="object"?e.latest_visible_message:null,n=uy(t?.id??t?.message_id??e.last_message_id),s=py(
t?.at??t?.timestamp??e.last_message_at),a=ly(t?.kind??e.last_message_kind),o=dy(t?.source??e.last_message_source);return!n||
!s||!a||!o?null:Object.freeze({id:n,at:new Date(s).toISOString(),atMs:s,kind:a,source:o})}function od(e){let t=qr(e);return t?
{latest_visible_message:{id:t.id,at:t.at,kind:t.kind,source:t.source},last_message_id:t.id,last_message_at:t.at,last_message_kind:t.
kind,last_message_source:t.source}:{}}function my(e,t){let n=qr(e),s=qr(t);if(n&&!s)return-1;if(!n&&s)return 1;if(!n&&!s)
return et(e).localeCompare(et(t));if(n.atMs!==s.atMs)return s.atMs-n.atMs;let a=s.id.localeCompare(n.id);return a!==0?a:
et(e).localeCompare(et(t))}function cd(e){return(Array.isArray(e)?e:[]).filter(t=>!!et(t)&&!!qr(t)).slice().sort(my)}function id(e){
return e instanceof Set?e:!e||typeof e[Symbol.iterator]!="function"?new Set:new Set(Array.from(e,t=>String(t||"")))}function fy(e){
return!e||typeof e[Symbol.iterator]!="function"?[]:[...new Set(Array.from(e,t=>String(t||"")).filter(Boolean))]}function Sf(e){
let t=qr(e);return t?`${t.atMs}|${t.kind}|${t.source}`:""}function Nf(e){let t=new Set;return(Array.isArray(e)?e:[]).filter(
n=>{let s=et(n);return!s||t.has(s)?!1:(t.add(s),!0)})}function al(e,t={}){let n=Nf(e),s=Number.isSafeInteger(t.limit)&&t.
limit>=0?t.limit:5,o=cd(n).slice(0,s).map(et);return{version:1,revision:Number(t.revision||0),limit:s,sessionOrder:o,knownSessionIds:n.
map(et),messageRevisionById:Object.fromEntries(n.map(c=>[et(c),Sf(c)]).filter(([,c])=>!!c)),fallbackSessionById:Object.fromEntries(
o.map(c=>[c,n.find(u=>et(u)===c)]).filter(([,c])=>!!c))}}function xf(e,t,n={}){let s=Nf(t),a=Object.fromEntries(s.map(L=>[
et(L),L])),o=e?.version===1?e:al(s,n),c=Number.isSafeInteger(n.limit)&&n.limit>=0?n.limit:Number(o.limit??5),m=cd(s).map(
et);if((o.sessionOrder||[]).length===0&&m.length>0){let L=al(s,{limit:c,revision:Number(o.revision||0)+1});return{ledger:L,
sessions:L.sessionOrder.map(P=>a[P]),structuralChanged:!0}}let f=new Set(o.knownSessionIds||[]),v=o.messageRevisionById||
{},k={},R=[];for(let L of s){let P=et(L),V=Sf(L);V&&(k[P]=V,(!f.has(P)||v[P]&&v[P]!==V)&&R.push(P))}if(n.freezeStructure&&
R.length>0)return{ledger:o,sessions:(o.sessionOrder||[]).map(L=>a[L]||o.fallbackSessionById?.[L]).filter(Boolean),structuralChanged:!1,
deferred:!0};let S=new Set(R),b=[...m.filter(L=>S.has(L))];for(let L of o.sessionOrder||[])!S.has(L)&&!b.includes(L)&&b.
push(L);for(let L of m){if(b.length>=c)break;b.includes(L)||b.push(L)}b.splice(c);let w=[...f];for(let L of Object.keys(
a))f.has(L)||w.push(L);let h={...v,...k},M=b.join("|")!==(o.sessionOrder||[]).join("|"),C=w.length!==f.size||Object.entries(
k).some(([L,P])=>v[L]!==P);if(!M&&!C&&Number(o.limit)===c)return{ledger:o,sessions:b.map(L=>a[L]||o.fallbackSessionById?.[L]).
filter(Boolean),structuralChanged:!1,deferred:!1};let _={version:1,revision:Number(o.revision||0)+(M?1:0),limit:c,sessionOrder:b,
knownSessionIds:w,messageRevisionById:h,fallbackSessionById:Object.fromEntries(b.map(L=>[L,a[L]||o.fallbackSessionById?.[L]]).
filter(([,L])=>!!L))};return{ledger:_,sessions:b.map(L=>a[L]||_.fallbackSessionById[L]).filter(Boolean),structuralChanged:M,
deferred:!1}}function ld(e,t={}){let n=id(t.workingSessionIds),s=id(t.pinnedSessionIds),a=new Map([...s].map((_,L)=>[_,L])),
o=id(t.excludedSessionIds),c=Number.isSafeInteger(t.limit)&&t.limit>=0?t.limit:5,u=new Set,m=[];for(let _ of Array.isArray(
e)?e:[]){let L=et(_);!L||u.has(L)||o.has(L)||(u.add(L),m.push(_))}let f=m.filter(_=>n.has(et(_))),v=m.filter(_=>!n.has(et(
_))),k=t.recentSessionIds==null?null:fy(t.recentSessionIds),R=new Map(v.map(_=>[et(_),_])),S=k==null?cd(v).slice(0,c):k.
map(_=>R.get(_)).filter(Boolean).slice(0,c),T=new Set(S.map(et)),b=v.filter(_=>!T.has(et(_))),w=b.filter(_=>s.has(et(_))).
sort((_,L)=>a.get(et(_))-a.get(et(L))),h=new Set(w.map(et)),M=b.filter(_=>!h.has(et(_))),C=Object.fromEntries([...f.map(
_=>[et(_),"working"]),...S.map(_=>[et(_),"recent"]),...w.map(_=>[et(_),"pinned"]),...M.map(_=>[et(_),"workspace"])]);return{
working:f,recent:S,pinned:w,remaining:M,ownership:C}}var Bi=Object.freeze({live:6e4,"1m":6e4,"5m":3e5,"15m":9e5,since_open:1/0}),hy=Object.freeze({cpu_total_percent:["cpu","\
totalPercent"],cpu_user_percent:["cpu","userPercent"],cpu_privileged_percent:["cpu","privilegedPercent"],memory_used_percent:[
"memory","usedPercent"],memory_commit_percent:["memory","commitPercent"],disk_read_bps:["disk","readBps"],disk_write_bps:[
"disk","writeBps"],disk_read_iops:["disk","readIops"],disk_write_iops:["disk","writeIops"],network_receive_bps:["network",
"receiveBps"],network_send_bps:["network","sendBps"],network_receive_pps:["network","receivePps"],network_send_pps:["net\
work","sendPps"]});function kt(e,t=0){let n=Number(e);return Number.isFinite(n)?n:t}function Vt(e){if(e==null||e==="")return null;
let t=Number(e);return Number.isFinite(t)&&t>=0?t:null}function ve(e){return Math.max(0,kt(e))}function _n(e){return Math.
max(0,Math.min(100,kt(e)))}function rl(e){let t=String(e??"0");return/^\d+$/.test(t)?t:"0"}function Bo(e){let t=Date.parse(
String(e||""));return Number.isFinite(t)?t:0}function gy(e,t){let n=Math.max(0,Math.round(kt(e?.pid))),s=e?.start_time?String(
e.start_time):"",a=String(e?.stable_key||`${n||"process"}:${s||t}`),o=String(e?.attribution_level||(e?.attributed?"runti\
me":"unattributed"));return{key:a,stableKey:a,parentKey:e?.parent_key?String(e.parent_key):"",pid:n,parentPid:Math.max(0,
Math.round(kt(e?.parent_pid))),startTime:s,name:String(e?.name||"Process"),status:String(e?.status||"running"),attributed:e?.
attributed===!0,attributionLevel:o,attributionReason:String(e?.attribution_reason||"No proved agent relationship"),ownedSessionId:e?.
owned_session_id?String(e.owned_session_id):"",agentLabel:e?.agent_label?String(e.agent_label):"",agentTypes:Array.isArray(
e?.agent_types)?e.agent_types.map(String):[],workspaceLabel:e?.workspace_label?String(e.workspace_label):"",sessionCount:Math.
max(0,Math.round(kt(e?.session_count))),cpuPercent:_n(e?.cpu_host_percent??e?.cpu_percent),cpuHostPercent:_n(e?.cpu_host_percent??
e?.cpu_percent),cpuCoreEquivalent:ve(e?.cpu_core_equivalent??e?.cpu_percent),memoryBytes:ve(e?.memory_bytes),privateBytes:ve(
e?.private_bytes??e?.memory_bytes),commitBytes:ve(e?.commit_bytes??e?.private_bytes),ioReadBps:ve(e?.io_read_bps),ioWriteBps:ve(
e?.io_write_bps),ioReadOps:ve(e?.io_read_ops),ioWriteOps:ve(e?.io_write_ops),threadCount:Math.max(0,Math.round(kt(e?.thread_count))),
handleCount:Math.max(0,Math.round(kt(e?.handle_count))),uptimeSeconds:e?.uptime_seconds==null?null:ve(e.uptime_seconds),
childCount:Math.max(0,Math.round(kt(e?.child_count))),selectedAs:Array.isArray(e?.selected_as)?e.selected_as.map(String):
[],selectedParentPresent:e?.selected_parent_present!==!1,counterTotals:{ioReadBytes:rl(e?.counter_totals?.io_read_bytes),
ioWriteBytes:rl(e?.counter_totals?.io_write_bytes),ioReadOperations:rl(e?.counter_totals?.io_read_operations),ioWriteOperations:rl(
e?.counter_totals?.io_write_operations)}}}function _y(e,t){return{id:String(e?.id||`disk-${t}`),label:String(e?.label||`\
Disk ${t+1}`),kind:String(e?.kind||"unknown"),readBps:ve(e?.read_bps),writeBps:ve(e?.write_bps),readIops:ve(e?.read_iops),
writeIops:ve(e?.write_iops),busyPercent:_n(e?.busy_percent),readLatencyMs:ve(e?.read_latency_ms),writeLatencyMs:ve(e?.write_latency_ms),
queueLength:ve(e?.queue_length),capacityBytes:ve(e?.capacity_bytes),freeBytes:ve(e?.free_bytes),freePercent:_n(e?.free_percent),
available:e?.available!==!1}}function by(e,t){return{id:String(e?.id||`adapter-${t}`),label:String(e?.label||`Adapter ${t+
1}`),kind:String(e?.kind||"unknown"),physicalDefault:e?.physical_default===!0,receiveBps:ve(e?.receive_bps),sendBps:ve(e?.
send_bps),receivePps:ve(e?.receive_pps),sendPps:ve(e?.send_pps),linkSpeedBps:ve(e?.link_speed_bps),utilizationPercent:_n(
e?.utilization_percent),receiveErrors:ve(e?.receive_errors),sendErrors:ve(e?.send_errors),receiveDiscards:ve(e?.receive_discards),
sendDiscards:ve(e?.send_discards),available:e?.available!==!1}}function Mf(e){if(!e||typeof e!="object")return{available:!1,
status:"waiting",schemaVersion:0,source:"",capturedAt:"",capturedAtMs:0,sampleSequence:0,sampleIntervalMs:0,droppedGapCount:0,
machineLabel:"",system:null,processes:[],attributedProcesses:[],sampling:null,privacy:null,capabilities:null,error:null,
lastGoodCapturedAt:"",lastGoodCapturedAtMs:0};let t=e.system&&typeof e.system=="object"?e.system:null,n=t?.cpu&&typeof t.
cpu=="object"?t.cpu:{},s=t?.memory&&typeof t.memory=="object"?t.memory:{},a=t?.disk&&typeof t.disk=="object"?t.disk:{},o=t?.
network&&typeof t.network=="object"?t.network:{},c=t?{cpuPercent:_n(n.total_percent??t.cpu_percent),cpu:{totalPercent:_n(
n.total_percent??t.cpu_percent),userPercent:_n(n.user_percent),privilegedPercent:_n(n.privileged_percent),idlePercent:_n(
n.idle_percent),queueLength:ve(n.queue_length),frequencyMhz:ve(n.current_frequency_mhz),logicalCoreCount:Math.max(0,Math.
round(kt(n.logical_core_count))),physicalCoreCount:Math.max(0,Math.round(kt(n.physical_core_count))),perLogical:Array.isArray(
n.per_logical)?n.per_logical:[]},memory:{totalBytes:ve(s.total_bytes),usedBytes:ve(s.used_bytes),availableBytes:ve(s.available_bytes),
usedPercent:_n(s.used_percent),cacheBytes:ve(s.cache_bytes),commitBytes:ve(s.commit_bytes),commitLimitBytes:ve(s.commit_limit_bytes),
commitPeakBytes:ve(s.commit_peak_bytes),commitPercent:_n(s.commit_percent),pagedPoolBytes:ve(s.paged_pool_bytes),nonpagedPoolBytes:ve(
s.nonpaged_pool_bytes),pagefileUsedBytes:ve(s.pagefile_used_bytes),pagesPerSec:ve(s.pages_per_sec),faultsPerSec:ve(s.faults_per_sec)},
disk:{readBps:ve(a.read_bps),writeBps:ve(a.write_bps),busyPercent:_n(a.busy_percent),readIops:ve(a.read_iops),writeIops:ve(
a.write_iops),readLatencyMs:ve(a.read_latency_ms),writeLatencyMs:ve(a.write_latency_ms),transferLatencyMs:ve(a.transfer_latency_ms),
queueLength:ve(a.queue_length)},disks:(Array.isArray(t.disks)?t.disks:[]).map(_y),network:{receiveBps:ve(o.receive_bps),
sendBps:ve(o.send_bps),receivePps:ve(o.receive_pps),sendPps:ve(o.send_pps),utilizationPercent:_n(o.utilization_percent),
outputQueueLength:ve(o.output_queue_length),receiveErrors:ve(o.receive_errors),sendErrors:ve(o.send_errors),receiveDiscards:ve(
o.receive_discards),sendDiscards:ve(o.send_discards),tcpRetransmitsPerSec:ve(o.tcp_retransmits_per_sec)},networkAdapters:(Array.
isArray(t.network_adapters)?t.network_adapters:[]).map(by),processCount:Math.max(0,Math.round(kt(t.process_count))),threadCount:Math.
max(0,Math.round(kt(t.thread_count))),handleCount:Math.max(0,Math.round(kt(t.handle_count))),uptimeSeconds:ve(t.uptime_seconds)}:
null,u=(Array.isArray(e.processes)?e.processes:[]).map(gy).sort((v,k)=>Number(k.attributed)-Number(v.attributed)||k.cpuHostPercent-
v.cpuHostPercent||k.memoryBytes-v.memoryBytes||v.pid-k.pid),m=e.captured_at?String(e.captured_at):"",f=e.last_good_captured_at?
String(e.last_good_captured_at):"";return{available:e.status==="fresh"&&!!c,status:String(e.status||"unavailable"),schemaVersion:Math.
max(0,Math.round(kt(e.schema_version))),source:String(e.source||""),capturedAt:m,capturedAtMs:Bo(m),sampleSequence:Math.
max(0,Math.round(kt(e.sample_sequence))),sampleIntervalMs:Math.max(0,Math.round(kt(e.sample_interval_ms))),droppedGapCount:Math.
max(0,Math.round(kt(e.dropped_gap_count))),machineLabel:e.machine_label?String(e.machine_label):"",system:c,processes:u,
attributedProcesses:u.filter(v=>v.attributed),sampling:e.sampling&&typeof e.sampling=="object"?e.sampling:null,privacy:e.
privacy&&typeof e.privacy=="object"?e.privacy:null,capabilities:e.capabilities&&typeof e.capabilities=="object"?e.capabilities:
null,error:e.error&&typeof e.error=="object"?e.error:null,lastGoodCapturedAt:f,lastGoodCapturedAtMs:Bo(f)}}function ud(e,t=0){
let n=e.filter(Number.isFinite).sort((a,o)=>a-o);if(!n.length)return t;let s=Math.floor(n.length/2);return n.length%2?n[s]:
(n[s-1]+n[s])/2}function il(e){let t=Math.max(Number.EPSILON,Number(e)||0),n=10**Math.floor(Math.log10(t)),s=t/n;return(s<=
1?1:s<=2?2:s<=2.5?2.5:s<=5?5:10)*n}function ol(e){if(!e||typeof e!="object")return null;let t=Number(e.sample_sequence);
if(!Number.isSafeInteger(t)||t<1)return null;let n=e.frame_kind==="system"?e:e.system||{},s=n.cpu||{},a=n.memory||{},o=n.
disk||{},c=n.network||{};return{sampleSequence:t,capturedAt:String(e.captured_at||""),capturedAtMs:Bo(e.captured_at),monotonicMs:ve(
e.monotonic_ms),sampleIntervalMs:ve(e.sample_interval_ms),droppedGapCount:Math.max(0,Math.round(kt(e.dropped_gap_count))),
status:String(e.status||"unavailable"),cpu:{totalPercent:Vt(s.total_percent??n.cpu_percent),userPercent:Vt(s.user_percent),
privilegedPercent:Vt(s.privileged_percent)},memory:{usedPercent:Vt(a.used_percent),commitPercent:Vt(a.commit_percent)},disk:{
readBps:Vt(o.read_bps),writeBps:Vt(o.write_bps),readIops:Vt(o.read_iops),writeIops:Vt(o.write_iops)},network:{receiveBps:Vt(
c.receive_bps),sendBps:Vt(c.send_bps),receivePps:Vt(c.receive_pps),sendPps:Vt(c.send_pps)}}}function Fi(e,t={}){let n=Array.
isArray(e)?e:[],s=new Map,a=0,o=0,c=0;for(let Q of n){let de=Number(Q?.sample_sequence);!Number.isSafeInteger(de)||de<1||
(de<c&&(o+=1),c=Math.max(c,de),s.has(de)?a+=1:s.set(de,Q))}let m=[...s.values()].sort((Q,de)=>Q.sample_sequence-de.sample_sequence).
map(Q=>({frame:Q,point:ol(Q)})).filter(Q=>Q.point),f=m.find(Q=>Q.point.capturedAtMs>0&&Q.point.monotonicMs>0)||null,v=m.
map(Q=>{let de=f&&Q.point.monotonicMs>0?f.point.capturedAtMs+Q.point.monotonicMs-f.point.monotonicMs:0;return{...Q,chartTimeMs:de>
0?de:Q.point.capturedAtMs}}),k=[];for(let Q=1;Q<v.length;Q+=1){let de=v[Q].chartTimeMs-v[Q-1].chartTimeMs;de>0&&de<=1e4&&
k.push(de)}let R=v.map(Q=>Q.point.sampleIntervalMs).filter(Q=>Q>0),S=Math.max(1,Math.round(ud(k,ud(R,1e3))||1e3)),T=Math.
max(2500,S*2.5),b=[],w=[],h=0,M=0,C=0,_=0,L=0,P=0;for(let Q of v){let de={...Q,chartTimeMs:Q.chartTimeMs+P};if(!(de.chartTimeMs>
0)){h+=1;continue}let he=b.at(-1),xe=!1;if(he&&de.point.monotonicMs>0&&he.point.monotonicMs>0&&de.point.monotonicMs<he.point.
monotonicMs){let H=de.point.capturedAtMs-he.point.capturedAtMs,E=H>0&&H<=1e4?H:S,z=he.chartTimeMs+Math.max(1,E);P+=z-de.
chartTimeMs,de.chartTimeMs=z,xe=!0,L+=1}if(he&&de.chartTimeMs<=he.chartTimeMs){de.chartTimeMs===he.chartTimeMs?M+=1:C+=1;
continue}let be=de.point.status!=="fresh",ee=be?"unavailable":"";if(he){let H=de.chartTimeMs-he.chartTimeMs,E=de.point.sampleSequence-
he.point.sampleSequence,z=de.point.droppedGapCount-he.point.droppedGapCount;if((E!==1||z>0||H>T)&&(be=!0,ee=E!==1||z>0?"\
dropped":"cadence"),xe)_+=1,be=!0,ee="clock_discontinuity";else if(de.point.monotonicMs>0&&he.point.monotonicMs>0&&de.point.
capturedAtMs>0&&he.point.capturedAtMs>0){let fe=de.point.capturedAtMs-he.point.capturedAtMs,ie=de.point.monotonicMs-he.point.
monotonicMs;Math.abs(fe-ie)>Math.max(5e3,S*2)&&(_+=1,be=!0,ee="clock_discontinuity")}be&&w.push({startMs:he.chartTimeMs,
endMs:de.chartTimeMs,reason:ee,previousSequence:he.point.sampleSequence,nextSequence:de.point.sampleSequence})}b.push({...de,
gapBefore:be,gapReason:ee})}let V=Number.isFinite(Number(t.nowMs))?Number(t.nowMs):Date.now(),Z=b.at(-1)||null,oe=Z?Math.
max(0,V-Z.chartTimeMs):1/0,ge=Math.max(2500,S*2),W=Math.max(ge*4,1e4),te="waiting";t.paused?te="paused":t.connected===!1||
t.subscriptionStatus==="reconnecting"?te="reconnecting":Z?Z.point.status!=="fresh"?te="unavailable":oe>W?te="stale":oe>ge?
te="delayed":te="live":te=t.error?"unavailable":"waiting",Z&&oe>ge&&!t.paused&&w.push({startMs:Z.chartTimeMs,endMs:V,reason:te,
previousSequence:Z.point.sampleSequence,nextSequence:null});let X=b.length>1?b.at(-1).chartTimeMs-b[0].chartTimeMs:0,ue=Z&&
!t.paused?Math.max(Z.chartTimeMs,V):Z?.chartTimeMs||0,J=b.length?Math.max(0,ue-b[0].chartTimeMs):0,pe=b.length?Math.max(
1,Math.floor(J/S)+1):0,Ce=b.length?Math.max(0,b.at(-1).point.droppedGapCount-b[0].point.droppedGapCount):0;return{frames:b.
map(Q=>({...Q.frame,chart_time_ms:Q.chartTimeMs,gap_before:Q.gapBefore,gap_reason:Q.gapReason})),points:b.map(Q=>({...Q.
point,chartTimeMs:Q.chartTimeMs,gapBefore:Q.gapBefore,gapReason:Q.gapReason})),gaps:w,status:te,cadenceMs:S,staleAfterMs:ge,
latestAgeMs:oe,nowMs:V,startMs:b[0]?.chartTimeMs||0,endMs:b.at(-1)?.chartTimeMs||0,elapsedMs:X,expectedCount:pe,receivedCount:n.
length,validCount:b.filter(Q=>Q.point.status==="fresh").length,droppedCount:Math.max(Ce,Math.max(0,pe-b.length)),gapCount:w.
length,duplicateCount:a+M,outOfOrderCount:o+C,invalidTimestampCount:h,clockDiscontinuityCount:_,monotonicResetCount:L}}function Cf(e,t,n){
let s=e.map(a=>({capturedAtMs:a.capturedAtMs,value:t==="cpu"?a.cpu.totalPercent:a.memory.usedPercent})).filter(a=>a.capturedAtMs>
0&&a.value!==null);return s.length<2||s.at(-1).capturedAtMs-s[0].capturedAtMs<15e3?!1:s.every(a=>a.value>=n)}function Af(e,t){
return Cf(e,t,95)?"critical":Cf(e,t,85)?"warning":"normal"}function Rf(e,t={}){let n=Ja([],e,60),s=n.map(ol).filter(Boolean),
a=s.at(-1)||null,o=Number.isFinite(Number(t.nowMs))?Number(t.nowMs):Date.now(),c=t.connected!==!1,u=String(t.subscriptionStatus||
""),m=a?.cpu.totalPercent??null,f=a?.memory.usedPercent??null,v=a?.status==="fresh"&&m!==null&&f!==null,k=a?.capturedAtMs>
0?Math.max(0,o-a.capturedAtMs):1/0,R=Math.max(1e3,a?.sampleIntervalMs||1e3),S=Math.max(2500,R*2),T="waiting";!c||u==="re\
connecting"?T="reconnecting":v?k>S?T="stale":T="live":T=t.error?"unavailable":"waiting";let b=a?.capturedAtMs?a.capturedAtMs-
15e3:1/0,w=s.filter(P=>P.capturedAtMs>=b),h=v?Af(w,"cpu"):"normal",M=v?Af(w,"memory"):"normal",C=T==="live"&&(h==="criti\
cal"||M==="critical")?"critical":T==="live"&&(h==="warning"||M==="warning")?"warning":T,_=n.at(-1)||null,L=_?.frame_kind===
"system"?_:_?.system||null;return{status:T,attention:C,point:a,frames:n,cpuPercent:m,memoryPercent:f,cpuLevel:h,memoryLevel:M,
ageMs:k,ageSeconds:Number.isFinite(k)?Math.max(0,Math.round(k/1e3)):null,staleAfterMs:S,sampleSequence:a?.sampleSequence||
0,capturedAt:a?.capturedAt||"",memoryUsedBytes:Vt(L?.memory?.used_bytes),memoryTotalBytes:Vt(L?.memory?.total_bytes)}}function Ja(e,t,n=900){
let s=new Map;[...Array.isArray(e)?e:[],...Array.isArray(t)?t:[t]].forEach(o=>{let c=Number(o?.sample_sequence);!Number.
isSafeInteger(c)||c<1||s.has(c)||s.set(c,o)});let a=Math.max(1,Math.min(900,Number(n)||900));return[...s.entries()].sort(
(o,c)=>o[0]-c[0]).slice(-a).map(([,o])=>o)}function Qa(e,t){let n=e?.sampleSequence?e:ol(e),s=hy[t];return!n||!s?null:Vt(
s.reduce((a,o)=>a?.[o],n))}function dd(e,t){let n=(Array.isArray(e)?e:[]).map(M=>({frame:M,point:M?.sampleSequence?M:ol(
M),value:Qa(M,t),timeMs:Number(M?.chartTimeMs??M?.chart_time_ms)||Bo(M?.capturedAt??M?.captured_at),gapBefore:M?.gapBefore===
!0||M?.gap_before===!0})).filter(M=>M.point&&M.value!==null&&M.timeMs>0).sort((M,C)=>M.timeMs-C.timeMs||M.point.sampleSequence-
C.point.sampleSequence);if(!n.length)return{current:null,min:null,average:null,sampleAverage:null,timeWeightedAverage:null,
averageMethod:"none",max:null,p95:null,provisionalP95:null,p95Ready:!1,peakSequence:null,count:0,elapsedMs:0,cadenceMs:0,
gapCount:0};let s=n.map(M=>M.value),a=[...s].sort((M,C)=>M-C),o=n.reduce((M,C)=>C.value>M.value?C:M,n[0]),c=s.reduce((M,C)=>M+
C,0)/s.length,u=n.slice(1).map((M,C)=>M.timeMs-n[C].timeMs).filter(M=>M>0),m=Math.max(0,Math.round(ud(u,0))),f=Math.max(
2500,m*2.5),v=0,k=0,R=0;for(let M=1;M<n.length;M+=1){let C=n[M-1],_=n[M],L=_.timeMs-C.timeMs;if(_.gapBefore||L>f){R+=1;continue}
v+=(C.value+_.value)/2*L,k+=L}let S=k>0?v/k:c,T=u.length?Math.min(...u):0,b=u.length?Math.max(...u):0,w=T>0&&b/T>1.2,h=a[Math.
max(0,Math.ceil(a.length*.95)-1)];return{current:s.at(-1),min:Math.min(...s),average:w?S:c,sampleAverage:c,timeWeightedAverage:S,
averageMethod:w?"time-weighted":"sample",max:Math.max(...s),p95:s.length>=20?h:null,provisionalP95:h,p95Ready:s.length>=
20,peakSequence:o.point.sampleSequence,count:s.length,elapsedMs:n.length>1?n.at(-1).timeMs-n[0].timeMs:0,cadenceMs:m,gapCount:R}}function Tf(e,t,n=240){let a=Fi(e,{nowMs:Number.MAX_SAFE_INTEGER,paused:!0}).points;if(!a.length)return[];let o=Math.max(
1,Math.round(Number(n)||240)),c=a.length<=o?1:Math.ceil(a.length/o),u=[];for(let m=0;m<a.length;m+=c){let f=a.slice(m,m+
c),v=dd(f,t);u.push({startSequence:f[0].sampleSequence,endSequence:f.at(-1).sampleSequence,capturedAtStartMs:f[0].chartTimeMs,
capturedAtEndMs:f.at(-1).chartTimeMs,chartTimeMs:f.at(-1).chartTimeMs,current:v.current,min:v.min,average:v.average,max:v.
max,first:Qa(f[0],t),last:Qa(f.at(-1),t),p95:v.p95,provisionalP95:v.provisionalP95,peakSequence:v.peakSequence,count:v.count,
gap:f.some(k=>k.gapBefore)})}return u}function $f(e,t="live",n={}){let s=Number.isFinite(Number(n.nowMs))?Number(n.nowMs):
Date.now(),o=Fi(e,{...n,nowMs:s}).frames,c=Bi[t]??Bi.live;return!o.length||c===1/0?o:o.filter(u=>Number(u.chart_time_ms)>=
s-c&&Number(u.chart_time_ms)<=s)}function pd(e,t=0,n={}){if(n.percent)return{maximum:100,minimum:0,step:25,ticks:[0,25,50,
75,100]};let s=Math.max(0,Number(e)||0),a=Math.max(0,Number(t)||0);if(a>0&&s<=a*.95&&s>=a*.65){let f=il(a/4),v=Math.max(
2,Math.round(a/f)+1);return{maximum:a,minimum:0,step:f,ticks:Array.from({length:v},(k,R)=>Math.min(a,f*R))}}let o=Math.max(
1,s*1.1),c=il(o/4),u=Math.ceil(o/c)*c,m=Math.round(u/c)+1;return m<4&&(c=il(o/3),u=Math.ceil(o/c)*c,m=Math.round(u/c)+1),
m>6&&(c=il(o/5),u=Math.ceil(o/c)*c,m=Math.round(u/c)+1),{maximum:u,minimum:0,step:c,ticks:Array.from({length:Math.max(2,
m)},(f,v)=>Math.min(u,c*v))}}function Ef(e,t,n=5){let s=Number(e),a=Number(t),o=Math.max(2,Math.min(6,Math.round(Number(
n)||5)));return!Number.isFinite(s)||!Number.isFinite(a)||a<=s?[]:Array.from({length:o},(c,u)=>{let m=s+(a-s)*u/(o-1),f=new Date(
m),v=new Date(s).toDateString()!==new Date(a).toDateString();return{timeMs:m,fraction:u/(o-1),label:f.toLocaleString([],
v?{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}:{hour:"2-digit",minute:"2-digit",second:"2-digit"}),accessibleLabel:f.
toLocaleString([],{year:"numeric",month:"long",day:"numeric",hour:"2-digit",minute:"2-digit",second:"2-digit",timeZoneName:"\
short"})}})}function md(e,t,n){let s=Number(e?.chartTimeMs??e?.chart_time_ms)||Bo(e?.capturedAt??e?.captured_at),a=Number(
t),o=Number(n);return!(s>0)||!Number.isFinite(a)||!Number.isFinite(o)||o<=a?0:Math.max(0,Math.min(1,(s-a)/(o-a)))}function Bs(e){let t=ve(e);if(t<1024)return`${Math.round(t)} B`;let n=["KiB","MiB","GiB","TiB"],s=t/1024,a=0;for(;s>=1024&&
a<n.length-1;)s/=1024,a+=1;let o=s>=100?0:s>=10?1:2;return`${s.toFixed(o)} ${n[a]}`}function Fs(e){return`${Bs(e)}/s`}function Lf(e){
return e==null?"\u2014":`${kt(e).toFixed(kt(e)>=10?1:2)}%`}function fd(e,t=Date.now()){let n=Date.parse(e||"");if(!Number.
isFinite(n))return"Waiting for local sample";let s=Math.max(0,Math.round((t-n)/1e3));return s<2?"Updated now":s<60?`Upda\
ted ${s}s ago`:`Updated ${Math.floor(s/60)}m ago`}function hd(e){let t=typeof e=="number"?e:Date.parse(String(e||""));return Number.
isFinite(t)?new Date(t).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"}):"Unknown time"}function gd(e){
let t=typeof e=="number"?e:Date.parse(String(e||""));return Number.isFinite(t)?new Date(t).toLocaleString([],{year:"nume\
ric",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit",second:"2-digit",timeZoneName:"short"}):"Unknown date a\
nd time"}var Of=Object.freeze({unavailable:6,auth_required:5,rate_limited:4,stale:3,refreshing:2,fresh:1});function er(e){let t=Number(
e);return Number.isFinite(t)?Math.max(0,t):null}function zt(e){let t=Number(e);return Number.isFinite(t)?t:null}function cl(e){
if(e==null||e==="")return null;let t=Number(e);return Number.isFinite(t)?Math.max(0,Math.floor(t)):null}function Ho(e){if(!e||
typeof e!="object")return null;let t=["loading","fresh","stale","auth_required","unavailable","error"].includes(e.status)?
e.status:"unavailable",n=e.diagnostic&&typeof e.diagnostic=="object"?{configuredPorts:(Array.isArray(e.diagnostic.configured_ports)?
e.diagnostic.configured_ports:[]).map(Number).filter(Number.isInteger),fallbackPorts:(Array.isArray(e.diagnostic.fallback_ports)?
e.diagnostic.fallback_ports:[]).map(Number).filter(Number.isInteger),effectivePorts:(Array.isArray(e.diagnostic.effective_ports)?
e.diagnostic.effective_ports:[]).map(Number).filter(Number.isInteger),fallbackPolicy:String(e.diagnostic.fallback_policy||
""),extractionSignature:String(e.diagnostic.extraction_signature||""),attempts:(Array.isArray(e.diagnostic.attempts)?e.diagnostic.
attempts:[]).map(s=>({port:cl(s?.port),status:String(s?.status||""),code:String(s?.code||""),reachable:s?.reachable===!0,
elapsedMs:Math.max(0,Number(s?.elapsed_ms)||0),ollamaOriginTargets:Math.max(0,Number(s?.ollama_origin_targets)||0),usageTargets:Math.
max(0,Number(s?.usage_targets)||0)})),supervision:e.diagnostic.supervision&&typeof e.diagnostic.supervision=="object"?{status:String(
e.diagnostic.supervision.status||""),code:String(e.diagnostic.supervision.code||""),port:cl(e.diagnostic.supervision.port),
elapsedMs:Math.max(0,Number(e.diagnostic.supervision.elapsed_ms)||0),visibleWindowsOpened:Math.max(0,Number(e.diagnostic.
supervision.visible_windows_opened)||0),protectedExistingTargetsMutated:Math.max(0,Number(e.diagnostic.supervision.protected_existing_targets_mutated)||
0)}:null,elapsedMs:Math.max(0,Number(e.diagnostic.elapsed_ms)||0)}:null;return{status:t,capturedAt:String(e.captured_at||
""),lastGoodAt:String(e.last_good_at||""),attemptedAt:String(e.attempted_at||""),attemptId:String(e.attempt_id||""),reason:e.
reason&&typeof e.reason=="object"?{code:String(e.reason.code||""),message:String(e.reason.message||"")}:null,nextAction:String(
e.next_action||""),diagnostic:n}}function zn(e){if(!e||typeof e!="object"||e.amount==null||e.amount==="")return null;let t=zt(
e.amount);return t==null?null:{amount:t,currency:String(e.currency||"USD"),sourceField:String(e.source_field||""),semantics:String(
e.semantics||""),directlyReported:e.directly_reported===!0}}function yy(e){if(!e||typeof e!="object")return null;let t=e.
pool_classification&&typeof e.pool_classification=="object"?{status:String(e.pool_classification.classification_status||
""),firstParty:zn(e.pool_classification.first_party),thirdParty:zn(e.pool_classification.third_party),unclassified:zn(e.
pool_classification.unclassified),warning:String(e.pool_classification.warning||"")}:null;return{semanticsVersion:Number(
e.semantics_version)||0,source:String(e.source||""),observedAt:String(e.observed_at||""),accountScope:String(e.account_scope||
""),extraUsageEnabled:e.extra_usage_enabled===!0,prepaidBalance:zn(e.prepaid_balance),extraUsageSpend:zn(e.extra_usage_spend),
extraUsageCap:zn(e.extra_usage_cap),reportedSpend:zn(e.reported_spend),includedSpend:zn(e.included_spend),bonusSpend:zn(
e.bonus_spend),planLimit:zn(e.plan_limit),allowanceRemaining:zn(e.allowance_remaining),reconciliationDelta:zn(e.reconciliation_delta),
poolClassification:t,resetsAt:String(e.resets_at||""),disclaimer:String(e.disclaimer||"")}}function vy(e){if(!e||typeof e!=
"object")return null;let t=(Array.isArray(e.request_receipts)?e.request_receipts:[]).map(n=>({receiptId:String(n?.receipt_id||
""),model:String(n?.model||""),surface:String(n?.surface||""),capturedAt:String(n?.captured_at||""),promptTokens:zt(n?.prompt_tokens),
responseTokens:zt(n?.response_tokens),tokensPerSecond:zt(n?.tokens_per_second),totalDurationNs:zt(n?.total_duration_ns),
loadDurationNs:zt(n?.load_duration_ns),promptEvalDurationNs:zt(n?.prompt_eval_duration_ns),evalDurationNs:zt(n?.eval_duration_ns)})).
filter(n=>n.receiptId&&n.model&&n.surface);return{status:String(e.status||""),endpointScope:String(e.endpoint_scope||""),
installedModelsCount:cl(e.installed_models_count),loadedModelsCount:cl(e.loaded_models_count),loadedModels:(Array.isArray(
e.loaded_models)?e.loaded_models:[]).map(n=>({name:String(n?.name||"Unnamed local model"),sizeBytes:Math.max(0,Number(n?.
size_bytes)||0),sizeVramBytes:Math.max(0,Number(n?.size_vram_bytes)||0),contextLength:Math.max(0,Number(n?.context_length)||
0),expiresAt:String(n?.expires_at||"")})),promptTokens:zt(e.prompt_tokens),responseTokens:zt(e.response_tokens),tokensPerSecond:zt(
e.tokens_per_second),totalDurationNs:zt(e.total_duration_ns),loadDurationNs:zt(e.load_duration_ns),promptEvalDurationNs:zt(
e.prompt_eval_duration_ns),evalDurationNs:zt(e.eval_duration_ns),observedRequestCount:Math.max(0,Number(e.observed_request_count)||
0),requestReceipts:t,latestRequest:t.at(-1)||null,telemetryStatus:String(e.telemetry_status||""),telemetryReason:String(
e.telemetry_reason||""),lifecycle:Ho(e.lifecycle),observations:e.observations&&typeof e.observations=="object"?{apiPs:Ho(
e.observations.api_ps),apiTags:Ho(e.observations.api_tags),ownedReceipts:Ho(e.observations.owned_receipts)}:null}}function wy(e){
return!e||typeof e!="object"?null:{subscriptionState:["active","none","unavailable"].includes(e.subscription_state)?e.subscription_state:
"unavailable",source:String(e.source||""),capturedAt:String(e.captured_at||""),autoReloadEnabled:typeof e.auto_reload_enabled==
"boolean"?e.auto_reload_enabled:null,error:e.error&&typeof e.error=="object"?{code:String(e.error.code||""),message:String(
e.error.message||"")}:null,sourceReceipt:e.source_receipt&&typeof e.source_receipt=="object"?{...e.source_receipt}:null,
lifecycle:Ho(e.lifecycle)}}function ky(e){if(!e||typeof e!="object")return null;let t=["slow","steady","racing","burning"].
includes(e.category)?e.category:"",n=er(e.expected_used_percent);if(!t||n==null)return null;let s=e.budget_percent&&typeof e.
budget_percent=="object"?Object.fromEntries(["now","next_hour","next_five_hours","today"].map(a=>[a,er(e.budget_percent[a])??
0])):null;return{stage:String(e.stage||""),category:t,expectedUsedPercent:n,actualUsedPercent:er(e.actual_used_percent),
deltaPercent:zt(e.delta_percent),projectedUsedPercent:er(e.projected_used_at_reset_percent),exhaustionAt:e.exhaustion_at?
String(e.exhaustion_at):"",willLastToReset:e.will_last_to_reset===!0,budgets:s}}function Sy(e,t){let n=er(e?.used_percent),
s=String(e?.status||(n==null?"unavailable":"available"));if(n==null&&s!=="unavailable")return null;let a=er(e?.thresholds?.
warning_percent)??75,o=Math.max(a,er(e?.thresholds?.critical_percent)??90),c={id:String(e?.id||`window-${t+1}`),label:String(
e?.label||"Usage"),scope:e?.scope?String(e.scope):"",modelScope:e?.model_scope&&typeof e.model_scope=="object"?{id:String(
e.model_scope.id||""),label:String(e.model_scope.label||"")}:null,usedPercent:n,remainingPercent:zt(e?.remaining_percent)??
(n==null?null:100-n),visualPercent:er(e?.visual_percent)??(n==null?null:Math.min(100,n)),durationMinutes:Number.isFinite(
Number(e?.duration_minutes))?Number(e.duration_minutes):null,startsAt:e?.starts_at?String(e.starts_at):"",resetsAt:e?.resets_at?
String(e.resets_at):"",resetDescription:e?.reset_description?String(e.reset_description):"",windowKind:e?.window_kind?String(
e.window_kind):"",source:e?.source?String(e.source):"",provenance:e?.provenance?String(e.provenance):"",freshnessStatus:e?.
freshness_status?String(e.freshness_status):"",status:s,error:e?.error&&typeof e.error=="object"?e.error:null,thresholds:{
warningPercent:a,criticalPercent:o},pace:ky(e?.pace)};return c.tone=n==null?"unavailable":n>=o||n>=100?"critical":n>=a?"\
warning":"ok",c}function Ny(e){if(e?.status==="auth_required"||e?.status==="unavailable")return"unavailable";if(e?.status===
"rate_limited")return"stale";let t=new Set((e?.windows||[]).map(s=>s.tone)),n=Math.max(-1,...(e?.windows||[]).map(s=>s.usedPercent??
-1));return t.has("critical")?"critical":t.has("warning")?"warning":e?.status==="stale"?"stale":e?.status==="fresh"&&e?.
localRuntime?.status==="running"||n>=0?"ok":"unknown"}function xy(e,t){let n=(Array.isArray(e?.windows)?e.windows:[]).map(
Sy).filter(Boolean).sort((a,o)=>o.usedPercent-a.usedPercent||a.label.localeCompare(o.label)),s={key:`${e?.provider_id||"\
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
null,financials:yy(e?.financials),localRuntime:vy(e?.local_runtime),cloudUsage:wy(e?.cloud_usage),resetCredits:e?.reset_credits&&
typeof e.reset_credits=="object"?e.reset_credits:null,error:e?.error&&typeof e.error=="object"?e.error:null,requestCount:Math.
max(0,Number(e?.request_count)||0),latencyMs:Number.isFinite(Number(e?.latency_ms))?Number(e.latency_ms):null,sessionCount:Math.
max(0,Number(e?.session_count)||0),harnessTypes:Array.isArray(e?.mapped_harness_types)?e.mapped_harness_types.map(String).
sort():[]};return s.tone=Ny(s),s.maximumUsedPercent=n.length>0?Math.max(...n.map(a=>a.usedPercent)):null,s}function _d(e){
let t=Array.isArray(e?.snapshots)?e.snapshots:[],n=new Map;t.map(xy).forEach(S=>{let T=n.get(S.key),b=Date.parse(T?.capturedAt||
"")||0,w=Date.parse(S.capturedAt||"")||0;(!T||w>=b)&&n.set(S.key,S)});let s=[...n.values()].sort((S,T)=>(Of[T.status]||0)-
(Of[S.status]||0)||(T.maximumUsedPercent??-1)-(S.maximumUsedPercent??-1)||S.providerName.localeCompare(T.providerName)||
S.accountLabel.localeCompare(T.accountLabel)),a=new Set(s.map(S=>S.providerId)),o=s.filter(S=>S.windows.length>0||S.credits||
S.resetCredits||S.financials||S.localRuntime||S.cloudUsage).length,c=s.filter(S=>["warning","critical"].includes(S.tone)&&
S.maximumUsedPercent<100).length,u=s.filter(S=>S.maximumUsedPercent>=100).length,m=Number(e?.generation)||0,f=e?.in_flight===
!0,v=s.filter(S=>S.status==="fresh").length,k=s.filter(S=>S.status==="stale").length,R=f?"refreshing":m===0&&s.length===
0?"not-started":s.length===0||v===s.length?"ready":v>0?"partial":k>0?"stale":"unavailable";return{schemaVersion:Number(e?.
schema_version)||0,generation:m,generatedAt:e?.generated_at?String(e.generated_at):"",pollIntervalMs:Math.max(0,Number(e?.
poll_interval_ms)||0),cadenceMode:e?.cadence_mode==="watching"?"watching":"idle",inFlight:f,collectionState:R,summaryAuthoritative:m>
0||s.length>0,estimatedCost:Cy(e?.estimated_cost),entries:s,summary:{providers:a.size,accounts:s.length,reporting:o,nearLimit:c,
exhausted:u}}}function bd(e,t){if(!t||typeof t!="object")return e;if(!e||typeof e!="object")return t;let n=Math.max(0,Number(
e.generation)||0),s=Math.max(0,Number(t.generation)||0);if(s<n)return e;let a=Array.isArray(e.snapshots)?e.snapshots:[],
o=Array.isArray(t.snapshots)?t.snapshots:[];return s===n&&a.length>0&&o.length===0?t.in_flight===!0&&e.in_flight!==!0?{...e,
in_flight:!0}:e:t}function Za(e){return Array.isArray(e)?e.filter(t=>t&&typeof t=="object").map(t=>({...t})):[]}function Fo(e){
if(e==null||e==="")return null;let t=Number(e);return Number.isFinite(t)?Math.max(0,t):null}function Cy(e){return!e||typeof e!=
"object"?null:{schemaVersion:Number(e.schema_version)||0,catalogVersion:String(e.catalog_version||""),label:String(e.label||
"Local estimated API-equivalent cost"),status:String(e.status||"unavailable"),generatedAt:e.generated_at?String(e.generated_at):
"",range:e.range&&typeof e.range=="object"?e.range:{days:365,since:"",until:""},tokens:{input:Fo(e.tokens?.input),cached:Fo(
e.tokens?.cached),output:Fo(e.tokens?.output)},costUsd:Fo(e.cost_usd),records:Fo(e.records),byProvider:Za(e.by_provider),
byModel:Za(e.by_model),byProject:Za(e.by_project),byDay:Za(e.by_day),bySpeed:Za(e.by_speed),dailyBreakdown:Za(e.daily_breakdown),
unknownModels:Za(e.unknown_models),scan:e.scan&&typeof e.scan=="object"?e.scan:{},reasonCode:String(e.reason_code||""),reasonPath:String(
e.reason_path||""),lastGoodGeneratedAt:e.last_good_generated_at?String(e.last_good_generated_at):"",detail:e.detail&&typeof e.
detail=="object"?{totalRows:Math.max(0,Number(e.detail.total_rows)||0),inlineRows:Math.max(0,Number(e.detail.inline_rows)||
0),pageSize:Math.max(0,Number(e.detail.page_size)||0),nextCursor:e.detail.next_cursor==null?"":String(e.detail.next_cursor),
truncated:e.detail.truncated===!0,collections:Za(e.detail.collections)}:null}}function Hi(e,t,n,s){e.has(t)||e.set(t,Object.
fromEntries(s.map(o=>[o,n[o]])));let a=e.get(t);a.input=(Number(a.input)||0)+(Number(n.input)||0),a.cached=(Number(a.cached)||
0)+(Number(n.cached)||0),a.output=(Number(a.output)||0)+(Number(n.output)||0),a.cost_usd=(Number(a.cost_usd)||0)+(Number(
n.cost_usd)||0),a.records=(Number(a.records)||0)+(Number(n.records)||0)}function If(e,t={}){if(!e)return null;let n=Math.
max(1,Math.min(365,Number(t.days)||1)),s=Date.parse(`${e.range?.until||new Date().toISOString().slice(0,10)}T00:00:00.00\
0Z`),a=s-(n-1)*24*60*60*1e3,o=e.dailyBreakdown.filter(f=>{let v=Date.parse(`${f.day}T00:00:00.000Z`);return Number.isFinite(
v)&&v>=a&&v<=s&&(!t.project||f.project===t.project)&&(!t.providerId||f.provider_id===t.providerId)}),c={provider:new Map,
model:new Map,project:new Map,day:new Map,speed:new Map},u={input:0,cached:0,output:0,cost_usd:0,records:0};o.forEach(f=>{
Hi(new Map([["total",u]]),"total",f,[]),Hi(c.provider,f.provider_id,f,["provider_id"]),Hi(c.model,`${f.provider_id}|${f.
model}`,f,["provider_id","model"]),Hi(c.project,`${f.provider_id}|${f.project}`,f,["provider_id","project"]),Hi(c.day,f.
day,f,["day"]),Hi(c.speed,f.speed,f,["speed"])});let m=f=>[...f.values()].map(v=>({...v,cost_usd:Number((v.cost_usd||0).
toFixed(8))}));return{days:n,tokens:{input:u.input,cached:u.cached,output:u.output},costUsd:Number(u.cost_usd.toFixed(8)),
records:u.records,byProvider:m(c.provider),byModel:m(c.model),byProject:m(c.project),byDay:m(c.day),bySpeed:m(c.speed)}}
function An(e){let t=Number(e);return Number.isFinite(t)?`${Number.isInteger(t)?t:t.toFixed(2).replace(/0+$/,"").replace(
/\.$/,"")}%`:"Unavailable"}function zo(e){let t=Number(e);return!Number.isFinite(t)||t<0?"Unavailable":t<1e6?`${Math.round(
t/1e3)} us`:t<1e9?`${(t/1e6).toFixed(1).replace(/\.0$/,"")} ms`:`${(t/1e9).toFixed(2).replace(/0+$/,"").replace(/\.$/,"")}\
 s`}function Pf(e){let t=Number(e);return!Number.isFinite(t)||t<0?"Unavailable":`${t.toFixed(2).replace(/0+$/,"").replace(
/\.$/,"")} tokens/s`}function jr(e,t=Date.now()){let n=Date.parse(e||"");if(!Number.isFinite(n))return"Not yet refreshed";
let s=Math.max(0,Math.floor((t-n)/1e3));if(s<10)return"Updated just now";if(s<60)return`Updated ${s}s ago`;let a=Math.floor(
s/60);return a<60?`Updated ${a}m ago`:`Updated ${Math.floor(a/60)}h ${a%60}m ago`}function Br(e,t=Date.now()){let n=Date.
parse(e||"");if(!Number.isFinite(n))return e?String(e):"";let s=Math.max(0,Math.floor((n-t)/1e3)),a=Math.floor(s/60),o=s<
60?`${s}s`:a<60?`${a}m`:`${Math.floor(a/60)}h ${a%60}m`,c=new Date(n).toLocaleString([],{month:"short",day:"numeric",hour:"\
numeric",minute:"2-digit"});return`in ${o} (${c})`}function yd(e){if(!e||typeof e!="object")return"";if(e.unlimited===!0)
return"Unlimited credits";let t=e.balance!=null&&e.balance!==""&&Number.isFinite(Number(e.balance));if(e.unit&&t)return`${e.
balance} ${e.unit}`;let n=e.currency==="USD"?"$":e.currency?`${e.currency} `:"";return t?`${n}${Number(e.balance).toFixed(
2)} balance`:""}function Dr(e){return!e||e.amount==null||e.amount===""||!Number.isFinite(Number(e.amount))?"Not reported":
`${e.currency==="USD"?"$":e.currency?`${e.currency} `:""}${Number(e.amount).toFixed(2)}`}function vd(e){if(!e)return[];let t=[];
return e.prepaidBalance&&t.push({id:"prepaid-balance",label:"Available prepaid balance",value:Dr(e.prepaidBalance)}),e.extraUsageSpend&&
t.push({id:"extra-spend",label:"Extra-usage spend",value:Dr(e.extraUsageSpend)}),e.extraUsageCap&&t.push({id:"extra-cap",
label:"Extra-usage cap",value:Dr(e.extraUsageCap)}),!e.extraUsageEnabled&&(e.extraUsageSpend||e.extraUsageCap)&&t.push({
id:"extra-status",label:"Extra usage",value:"Disabled"}),e.reportedSpend&&t.push({id:"reported-spend",label:"Provider-re\
ported spend",value:Dr(e.reportedSpend)}),e.includedSpend&&t.push({id:"included-spend",label:"Included spend bucket",value:Dr(
e.includedSpend)}),e.bonusSpend&&t.push({id:"bonus-spend",label:"Bonus spend bucket",value:Dr(e.bonusSpend)}),e.planLimit&&
t.push({id:"plan-limit",label:"Reported plan limit",value:Dr(e.planLimit)}),e.reportedSpend&&!e.allowanceRemaining&&t.push(
{id:"allowance-remaining",label:"Available allowance",value:"Not reported by provider"}),e.poolClassification?.status===
"unavailable"&&t.push({id:"pool-classification",label:"First/third-party pools",value:e.poolClassification.warning||"Not\
 reported by provider"}),t}function Uo(e){let t=Number(e);return Number.isFinite(t)&&t>0?t:null}function Go(e){return Math.round(Number(e)*1e3)/1e3}
function wd({clientSentAtMs:e,relayReceivedAtMs:t,relaySentAtMs:n,clientReceivedAtMs:s}={}){let a=Uo(e),o=Uo(t),c=Uo(n),
u=Uo(s);if([a,o,c,u].some(S=>S===null))return{ok:!1,code:"clock_sample_timestamp_invalid"};if(c<o)return{ok:!1,code:"clo\
ck_sample_relay_regressed"};if(u<a)return{ok:!1,code:"clock_sample_client_regressed"};let m=c-o,f=u-a-m;if(f<0)return{ok:!1,
code:"clock_sample_negative_rtt"};let v=(o-a+(c-u))/2,k=f/2;return{ok:!0,estimate:{schema_version:1,status:f>2e3?"rtt_th\
reshold_exceeded":Math.abs(v)>1e3?"skew_threshold_exceeded":"synchronized",reference_clock:"relay",offset_ms:Go(v),rtt_ms:Go(
f),uncertainty_ms:Go(k),client_sent_at_ms:a,relay_received_at_ms:o,relay_sent_at_ms:c,client_received_at_ms:u,sampled_at_ms:u}}}
function kd(e,t,n=null,{nowMs:s=e}={}){let a=Uo(e);if(a===null)return{ok:!1,code:"stage_timestamp_invalid"};let o=String(
t||"").trim().toLowerCase();if(!o)return{ok:!1,code:"clock_domain_missing"};if(o==="relay")return{ok:!0,rankingEligible:!0,
adjustedAtMs:a,source:{clock_domain:"relay",clock_reference:"relay",clock_status:"reference",raw_at_ms:a,adjusted_at_ms:a,
clock_offset_ms:0,clock_rtt_ms:0,clock_uncertainty_ms:0,clock_sample_age_ms:0}};let c=wd({clientSentAtMs:n?.client_sent_at_ms,
relayReceivedAtMs:n?.relay_received_at_ms,relaySentAtMs:n?.relay_sent_at_ms,clientReceivedAtMs:n?.client_received_at_ms});
if(!c.ok)return{ok:!0,rankingEligible:!1,adjustedAtMs:a,source:{clock_domain:o,clock_reference:"relay",clock_status:c.code,
raw_at_ms:a,adjusted_at_ms:a}};let u=c.estimate,m=Math.max(0,Number(s)-u.sampled_at_ms),f=m>6e4?"stale":u.status,v=Go(a+
u.offset_ms);return{ok:!0,rankingEligible:f==="synchronized",adjustedAtMs:v,source:{clock_domain:o,clock_reference:"rela\
y",clock_status:f,raw_at_ms:a,adjusted_at_ms:v,clock_offset_ms:u.offset_ms,clock_rtt_ms:u.rtt_ms,clock_uncertainty_ms:u.
uncertainty_ms,clock_sample_age_ms:Go(m)}}}var{useState:Oe,useEffect:Sd,useRef:Ae,useCallback:an}=React;function at(e,t,n,s=(a,o)=>a??o){if(!e||!Object.prototype.hasOwnProperty.call(e,t))return e;let a={...e};return a[n]=s(a[n],
a[t]),delete a[t],a}var jf=1024*1024,Ay=15e3,Nd=1e4,Bf=3,My=new Set(["history_chunk_throttled","history_chunk_duplicate_\
cursor","history_waiter_capacity","history_request_capacity","throttled"]),Ry=15e3,Ty=Object.freeze({queued:1e4,accepted:3e4,
launch_accepted:3e4,delivered:3e4,steered:3e4}),Ff=[250,500,1e3,2e3,3e3],Fr=512,Hf=Object.freeze({offline_queued:0,queued:0,
busy_queued:3,accepted:2,steered:3,launch_accepted:3,failed:4,delivered:5,agent_started:6}),$y=new Set(["history","histo\
ry_snapshot","history_chunk","transcript_resync_required","chat_list"]);function zf(e,t="unknown",n=Date.now(),s="",a=null){
let o=s||globalThis.crypto?.randomUUID?.()||`${n}-${Math.random().toString(36).slice(2,12)}`,c=kd(n,"browser",a,{nowMs:n});
return{schema_version:2,trace_id:s||`latency-${o}`,client_message_id:e,agent_type:t||"unknown",stages:{webui_send:c.adjustedAtMs},
raw_stages:{webui_send:n},stage_sources:{webui_send:{source:"webui_client_ws",...c.source}}}}function Ey(e,t,n,s=null){if(!e?.
trace_id||!e?.stages?.relay_broadcast)return null;if(e.stages.webui_render)return e;let a=Number(t);if(!Number.isFinite(
a)||a<=0)return null;let o=kd(a,"browser",s,{nowMs:a});return{...e,schema_version:2,stages:{...e.stages,webui_render:o.adjustedAtMs},
raw_stages:{...e.raw_stages||{},webui_render:a},stage_sources:{...e.stage_sources||{},webui_render:{source:"react_post_p\
aint",...o.source,...Number.isFinite(Number(n))?{browser_received_at_ms:Number(n)}:{},browser_paint_at_ms:a}}}}function Hs(e,t,n,s=Fr){
let a={...e||{}};Object.prototype.hasOwnProperty.call(a,t)&&delete a[t],a[t]=n;let o=Object.keys(a),c=o.length-Math.max(
1,Number(s)||Fr);for(let u=0;u<c;u+=1)delete a[o[u]];return a}function Ly(e){let n=(e instanceof Map?[...e.values()]:Object.
values(e||{})).filter(a=>a&&typeof a=="object"),s=n.filter(a=>a.aggregateOnly!==!0).length;return{active:n.length>0,aggregateOnly:s===
0,consumerCount:n.length,detailConsumerCount:s}}function ul(e,t){let n=Object.entries(t||{});if(!n.length)return e;let s=!1,
a={...e};return n.forEach(([o,c])=>{Object.is(e[o],c)||Tt(e[o]??null,c??null)||(a[o]=c,s=!0)}),s?a:e}function Oy(e,t,n){
return(e==="history_snapshot"||e==="history")&&!t?.partial&&(!t?.mode||t.mode==="full")?!1:!!(t?.partial||t?.mode==="tai\
l"||n?.mode==="chunked"||n?.partial)}function tr(e){return e?e.source_message_id?`source${e.source_message_id}`:e.native_source_id?
`native${e.native_source_id}`:e.id!=null?`id${e.id}`:e.server_message_id!=null?`server${e.server_message_id}`:e.sequence!=
null&&e.ts!=null?`seq${e.sequence}${e.ts}${e.role||""}`:e.client_message_id?`client${e.client_message_id}`:e.client_msg_id?
`client${e.client_msg_id}`:"":""}function Cd(e,t){return e===t||Tt(e??null,t??null)}function Wo(e,t){let n=Array.isArray(
e)?e:[],s=Array.isArray(t)?t:[],a=s.map((v,k)=>({message:v,index:k,sequence:Number(v?.sequence)})),c=a.length>1&&a.every(
v=>Number.isFinite(v.sequence))?a.sort((v,k)=>v.sequence-k.sequence||v.index-k.index).map(v=>v.message):s,u=new Map;n.forEach(
v=>{let k=tr(v);k&&!u.has(k)&&u.set(k,v)});let m=new Set,f=[];return c.forEach(v=>{let k=tr(v);if(k&&m.has(k))return;k&&
m.add(k);let R=k?u.get(k):null;f.push(R&&Cd(R,v)?R:v)}),f.length===n.length&&f.every((v,k)=>v===n[k])?n:f}function dl(e,t=""){
let n=t||e?.session_id||e?.session||"",s=e?.prompt_id||"",a=e?.generation||"";return n&&s&&a?`${n}\0${s}\0${a}`:""}function Uf(e,t,n=Date.
now(),s=4096){let a=dl(t);if(!a||typeof e?.set!="function"||typeof e?.has!="function")return!1;for(e.has(a)||e.set(a,Number(
n)||Date.now());e.size>Math.max(32,Number(s)||4096);)e.delete(e.keys().next().value);return!0}function xd(e,t){let n=dl(
t);return!!n&&typeof e?.has=="function"&&e.has(n)}function Iy(e,t){if(!e||!t)return!1;let n=tr(e),s=tr(t);return n&&s?n===
s:e.role===t.role&&String(e.content||"")===String(t.content||"")}function Gf(e,t){let n=Array.isArray(e)?e:[],s=(Array.isArray(
t)?t:[]).filter(o=>o?._optimistic&&o?._cid);if(s.length===0)return n;let a=[...n];return s.forEach(o=>{let c=a.findIndex(
u=>u?.role==="user"&&(u.client_message_id===o._cid||u.client_msg_id===o._cid||String(u.content||"")===String(o.content||
"")));if(c>=0){let u=a[c]?.status;a[c]={...a[c],_cid:o._cid,_optimistic:!0,_delivered:o._delivered||a[c]._delivered||u===
"delivered"||u==="agent_started",_agentStarted:o._agentStarted||a[c]._agentStarted||u==="agent_started",_sendError:u==="\
failed"?a[c].failure_reason||a[c].failure_code||o._sendError||"Send failed":o._sendError||null}}else a.push(o)}),a}function Wf(e,t){
let n=Array.isArray(e)?e:[],s=Array.isArray(t)?t:[];if(!n.length)return s;if(!s.length)return n;let a=Math.min(n.length,
s.length);for(let o=a;o>=1;o--){let c=!0;for(let k=0;k<o;k++)if(!Iy(n[n.length-o+k],s[k])){c=!1;break}if(!c)continue;let u=n.
length-o,m=!1,f=s.slice(0,o).map((k,R)=>{let S=n[u+R],T=tr(S),b=tr(k);if(T&&T===b&&!Cd(S,k)){let w=Array.isArray(S?.content_blocks)&&
S.content_blocks.some(M=>M?.type==="memory_citation"),h=Array.isArray(k?.content_blocks)&&k.content_blocks.some(M=>M?.type===
"memory_citation");return w&&!h?S:(m=!0,k)}return S}),v=s.slice(o);return!m&&v.length===0?n:[...n.slice(0,u),...f,...v]}
return null}function Ko(e){let t=Array.isArray(e)?e:[],n=s=>{let a=String(s?.content||"");return/\*\*(?:Claude Code|Codex|Cursor) CLI is waiting for a native transcript\.\*\*/i.
test(a)&&/placeholder will be replaced with the real CLI chat history/i.test(a)};return!t.some(n)||!t.some(s=>!n(s))?t:t.
filter(s=>!n(s))}function Yf(e,t){let n=e?.agent_type||e?.agentType||"";if(n!=="codex_cli"&&n!=="cursor_cli"||!Array.isArray(
t)||t.length!==1)return!1;let s=t[0];return s?.role!=="assistant"?!1:/\*\*(?:Codex|Cursor) CLI is waiting for a native transcript\.\*\*/.
test(String(s.content||""))}function Kf(e,t={}){let n={},s={},a={};return(e||[]).forEach(o=>{if(!o||typeof o!="object"||
!o.session_id||!o.activity)return;let c=o.activity.kind||"working",u=o.activity.label||(c==="idle"?"":"Working");n[o.session_id]=
{kind:c,label:u,updatedAt:o.activity.updated_at||null,observed_at:o.activity.observed_at||null,startedAt:o.activity.started_at||
null,interruptHint:o.activity.interrupt_hint||"",goal:o.activity.goal||null,goal_run:o.activity.goal_run||null,...o.activity.
goal_projection?{goal_projection:o.activity.goal_projection}:{},...o.activity.goal_tombstone?{goal_tombstone:o.activity.
goal_tombstone}:{},thinking:o.activity.thinking||null,connection:o.activity.connection||null,connection_tombstone:o.activity.
connection_tombstone||null,interruption:o.activity.interruption||null,interruption_tombstone:o.activity.interruption_tombstone||
null,current:o.activity.current||null,step:o.activity.step||null,usage:o.activity.usage||null,task_list:o.activity.task_list||
null,context_card:o.activity.context_card||null,work_context:o.activity.work_context||null,thinkingContent:o.activity.thinking?.
text||o.activity.thinkingContent||"",transport:o.activity.transport||t[o.session_id]?.transport||null},s[o.session_id]=o.
activity.thinking?.text||o.activity.thinkingContent||"",a[o.session_id]=["thinking","generating","running_command","appl\
ying_patch","reading_files","working"].includes(c)?u:!1}),{activities:n,thinkingContent:s,thinking:a}}function Vf(e){if(!e||
typeof e!="object")return null;let t=e.goal_tombstone||e.goal_projection,n=Number(t?.epoch),s=Number(t?.sequence);if(!Number.
isSafeInteger(n)||n<=0||!Number.isSafeInteger(s)||s<=0)return null;let a=e.goal_tombstone||t?.state==="clear"||e.goal===
null?"clear":"present";return{epoch:n,sequence:s,state:a}}function Py(e,t){let n=Vf(e),s=Vf(t);if(n&&s){if(n.epoch!==s.epoch)
return n.epoch<s.epoch?-1:1;if(n.sequence!==s.sequence)return n.sequence<s.sequence?-1:1;if(n.state!==s.state)return n.state===
"clear"?1:-1}else if(n||s)return n?1:-1;let a=Date.parse(e?.observed_at||e?.updatedAt||"")||0,o=Date.parse(t?.observed_at||
t?.updatedAt||"")||0;return a!==o?a<o?-1:1:0}function zi(e,t,n={}){let s=e&&typeof e=="object"?e:{},a=t&&typeof t=="obje\
ct"?t:{},o=n.authoritative===!0,c=s;for(let[u,m]of Object.entries(a)){let f=Object.prototype.hasOwnProperty.call(s,u);!o&&
f||o&&f&&m&&typeof m=="object"&&s[u]&&typeof s[u]=="object"&&Py(m,s[u])<0||Object.is(s[u],m)||(c===s&&(c={...s}),c[u]=m)}
return c}function Xf(){let[e,t]=Oe(()=>Xc()),n=e.list,s=an(r=>{t(p=>{let y=typeof r=="function"?r(p.list):r;return Do(p,
y)})},[]),a=nd,o=of,[c,u]=Oe({}),[m,f]=Oe({}),[v,k]=Oe(!1),[R,S]=Oe({state:"connecting",rttMs:null,lastAckAt:null}),[T,b]=Oe(
{}),[w,h]=Oe({}),[M,C]=Oe({}),[_,L]=Oe({}),[P,V]=Oe({}),[Z,oe]=Oe({}),[ge,W]=Oe({}),[te,X]=Oe([]),[ue,J]=Oe({}),[pe,Ce]=Oe(
null),[se,Q]=Oe({}),[de,he]=Oe({}),[xe,be]=Oe({}),[ee,H]=Oe([]),[E,z]=Oe({}),[fe,ie]=Oe({}),[ye,Me]=Oe({}),[ke,Ee]=Oe({}),
[He,ae]=Oe({}),[Re,F]=Oe({}),[re,Te]=Oe({}),[Ke,St]=Oe({}),[vs,on]=Oe({}),[G,bn]=Oe({}),[Rn,Un]=Oe({}),[ws,ks]=Oe({}),[Zi,
Vr]=Oe([]),[rr,Ws]=Oe([]),[eo,to]=Oe(null),[ic,no]=Oe(null),[Pl,Tn]=Oe(null),[ql,Yr]=Oe(null),[so,_a]=Oe(null),[oc,ba]=Oe(
null),[$n,Xr]=Oe(null),[ao,Gn]=Oe(null),[ya,Ss]=Oe(null),[Dl,va]=Oe([]),[jl,wa]=Oe([]),[Bl,ir]=Oe({id:"",status:"idle",aggregateOnly:!0,
resumed:!1,consumerCount:0,detailConsumerCount:0}),[Fl,ka]=Oe({}),[cc,ro]=Oe([]),[Hl,lc]=Oe({}),Wn=Ae({}),Ks=Ae({}),Kn=Ae(
{}),Ns=Ae({}),En=Ae({}),d=Ae({}),yn=Ae(new Map),Be=Ae({}),Ge=Ae({}),Le=Ae({}),Fe=Ae(null),xs=Ae(""),vn=Ae([]),Vs=Ae(0),Ys=Ae(
0),Vn=Ae(null),Yn=Ae(null),It=Ae(null),cn=Ae(null),Ln=Ae(null),Sa=Ae(0),Cs=Ae(1e4),Xs=Ae(3e4),wn=Ae([]),Pt=Ae(null),Xn=Ae(
null),Qr=Ae(Fm()),io=Ae(kf()),oo=Ae(0),Qn=Ae({}),Na=Ae(0),kn=Ae({}),tt=Ae({}),it=Ae({}),Qt=Ae({}),$t=Ae({}),Et=Ae({}),xa=Ae(
{}),Ca=Ae({}),Jr=Ae(!1),Jn=Ae(new Map),Qs=Ae(null),Nt=Ae({}),As=Ae(null),On=Ae(new Map),Js=Ae(new Set),Zs=Ae(new Map),gt=Ae(
{active:!1,aggregateOnly:!0,consumerCount:0,detailConsumerCount:0}),ln=Ae(""),Zn=Ae(!0),qt=Ae(""),un=Ae(0),Jt=Ae({system:"",
detail:""}),Ut=Ae({system:0,detail:0}),es=Ae({system:0,detail:0});function Dt(r,p){if(!r)return;let y=Qt.current[r]||null,
O=typeof p=="function"?p(y):p;if(!O){if(!y)return;let x={...Qt.current};delete x[r],Qt.current=x,Me(x);return}if(y&&Tt(y,
O))return;let l={...Qt.current,[r]:O};Qt.current=l,Me(l)}function ea(r){let p=Qt.current[r]?.view_state;return!!p&&p!=="\
native_active"}function ta(r){let p=Et.current[r];p&&clearTimeout(p),delete Et.current[r]}function Ms(r){clearTimeout(tt.
current[r]),delete tt.current[r];let p=it.current[r];p&&(it.current[r]={...p,inFlight:!1})}function Zr(r){let p=typeof r?.
alias_session_id=="string"?r.alias_session_id.trim():"",y=typeof r?.canonical_session_id=="string"?r.canonical_session_id.
trim():"";if(!p||!y||p===y)return!1;lc(A=>({...A,[p]:{...r,alias_session_id:p,canonical_session_id:y}})),rf(p,y),s(A=>{let I=A.
find(me=>(typeof me=="string"?me:me?.session_id)===y),j=A.find(me=>(typeof me=="string"?me:me?.session_id)===p),D=A.filter(
me=>{let Ie=typeof me=="string"?me:me?.session_id;return Ie!==p&&Ie!==y}),ne=I&&typeof I=="object"?I:j&&typeof j=="objec\
t"?{...j,session_id:y}:{session_id:y};return D.push({...ne,session_id:y,canonical_session_id:y,canonical_conversation_id:r.
canonical_conversation_id||ne.canonical_conversation_id||null,canonical_native_id:r.canonical_native_id||ne.canonical_native_id||
null,current_surface:r.current_surface||ne.current_surface||null,current_surface_label:r.current_surface_label||ne.current_surface_label||
null}),D});let O=(A,I)=>A??I,l=(A,I)=>[...Array.isArray(A)?A:[],...Array.isArray(I)?I:[]];u(A=>at(A,p,y,O)),f(A=>at(A,p,
y,O)),b(A=>at(A,p,y,(I,j)=>Number(I||0)+Number(j||0))),h(A=>at(A,p,y,O)),C(A=>at(A,p,y,O)),L(A=>at(A,p,y,O)),V(A=>at(A,p,
y,O)),W(A=>at(A,p,y,l)),Q(A=>at(A,p,y,O)),he(A=>at(A,p,y,O)),be(A=>at(A,p,y,(I,j)=>({...j||{},...I||{},session_id:y,session:y}))),
z(A=>at(A,p,y,O)),ie(A=>at(A,p,y,O)),Qt.current=at(Qt.current,p,y,O),Me(Qt.current),Ee(A=>at(A,p,y,l)),ae(A=>at(A,p,y,l)),
F(A=>at(A,p,y,O)),Te(A=>at(A,p,y,O)),St(A=>at(A,p,y,O)),Un(A=>at(A,p,y,O)),ka(A=>at(A,p,y,O)),X(A=>A.map(I=>I?.session_id===
p?{...I,session_id:y}:I)),d.current=at(d.current,p,y,O);for(let[A,I]of[...yn.current]){if(!A.startsWith(`${p}\0`))continue;
let j=`${y}${A.slice(p.length)}`;yn.current.has(j)||yn.current.set(j,I),yn.current.delete(A)}Le.current=at(Le.current,p,
y,O),Nt.current=at(Nt.current,p,y,O),Pt.current===p&&(Pt.current=y),vn.current=[...new Set(vn.current.map(A=>A===p?y:A))];
for(let[A,I]of Object.entries(Ns.current))I===p&&(Ns.current[A]=y);for(let A of[Qn,kn,it,xa,Ca])A.current=at(A.current,p,
y,O);let x=!1;return Et.current[p]&&(ta(p),x=!0),Object.entries($t.current).forEach(([A,I])=>{I?.sessionId===p&&(delete $t.
current[A],x=!0)}),x&&Dt(y,A=>({...A||{},view_state:"error",retryable:!0,completed_at:Date.now(),message:"The session id\
entity changed while selecting this chat. Retry without changing the native app."})),!0}function uc(r){return!!sf(r)}function In(r,p,y=null,O=null,l=null){
if(Nt.current={...Nt.current,[r]:p},On.current.set(r,Bm(On.current.get(r),{stream:p,streamTrace:y,latencyTrace:O,receivedAtMs:l})),
As.current!=null)return;let x=typeof requestAnimationFrame=="function"?requestAnimationFrame:A=>setTimeout(A,16);As.current=
x(()=>{As.current=null;let A=[...On.current.entries()];On.current.clear(),A.length&&(ka(I=>{let j={...I};return A.forEach(
([D,ne])=>{j[D]=ne.stream}),j}),A.forEach(([I,j])=>{j.streamTrace&&yc({stream_trace:j.streamTrace},I),j.latencyTrace&&di(
{latency_trace:j.latencyTrace,_latency_browser_received_at_ms:j.receivedAtMs},I)}))})}function Aa(r,p=null){if(!r||Nt.current[r]?.
open)return;let O=Wu(r,p);Nt.current={...Nt.current,[r]:O},ka(l=>({...l,[r]:O}))}function ts(r){if(!r||!Nt.current[r])return;
let p={...Nt.current};delete p[r],Nt.current=p,On.current.delete(r),ka(y=>{if(!y[r])return y;let O={...y};return delete O[r],
O})}function or(){Nt.current={},On.current.clear(),ka({})}function cr(){let r=Qs.current;Qs.current=null,r&&(r.kind==="i\
dle"&&typeof cancelIdleCallback=="function"?cancelIdleCallback(r.id):clearTimeout(r.id))}function na(){if(Qs.current||Jn.
current.size===0)return;let r=()=>{Qs.current=null;let p=Jn.current.entries().next();if(p.done)return;let[y,O]=p.value;Jn.
current.delete(y),Xn.current?.(O),na()};typeof requestIdleCallback=="function"?Qs.current={kind:"idle",id:requestIdleCallback(
r,{timeout:250})}:Qs.current={kind:"timer",id:setTimeout(r,32)}}function dc(){requestAnimationFrame(()=>requestAnimationFrame(
()=>{Jr.current=!0,na()}))}let Se=an(r=>{Fe.current?.readyState===WebSocket.OPEN&&Fe.current.send(JSON.stringify(r))},[]),
zl=an((r=!1,p=null)=>{let y=`provider-usage-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return _a({requestId:y,
status:"requested",provider_id:p||null}),Se({type:"provider_usage_refresh",protocol_version:1,force:r===!0,...p?{provider_id:p}:
{},request_id:y}),y},[Se]),pc=an(r=>{Se({type:"provider_usage_watch",protocol_version:1,active:r===!0})},[Se]),Ul=an(()=>{
let r=`provider-reset-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return ba({requestId:r,status:"requested"}),
Se({type:"provider_usage_reset_credit_consume",protocol_version:1,request_id:r,approved:!0}),r},[Se]),ei=an((r={})=>{let p=`\
provider-cost-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,y={days:Math.max(1,Math.min(365,Number(r.days)||365)),
providerId:r.providerId?String(r.providerId):"",project:r.project?String(r.project):"",cursor:/^\d+$/.test(String(r.cursor??
"0"))?String(r.cursor??"0"):"0",pageSize:Math.max(1,Math.min(256,Number(r.pageSize)||256))};return Xr({requestId:p,status:"\
loading",query:y,detail:null,error:null}),Se({type:"provider_usage_cost_detail_request",protocol_version:1,request_id:p,
days:y.days,provider_id:y.providerId||null,project:y.project||null,cursor:y.cursor,page_size:y.pageSize}),p},[Se]),co=an(
(r=!1)=>{let p=`host-resource-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return Ss(null),Se({type:"host_res\
ource_refresh",protocol_version:1,force:r===!0,aggregate_only:gt.current.aggregateOnly===!0,request_id:p}),p},[Se]),lr=an(
()=>{Gn(null),Ss(null),va([]),wa([]),Ut.current={system:0,detail:0},es.current={system:0,detail:0}},[]),Rs=an((r,p="")=>{
let y=`host-resource-subscribe-${Date.now()}-${++un.current}`;return qt.current=y,Ss(null),ir(O=>({...O,status:p?"reconn\
ecting":"subscribing",aggregateOnly:r===!0})),Se({type:"host_resource_subscribe",protocol_version:1,request_id:y,...p?{resume_subscription_id:p}:
{},aggregate_only:r===!0}),y},[Se]),ur=an((r,p=0)=>{let y=r==="detail"?"detail":"system",O=ln.current;if(!O)return null;
let l=`host-resource-history-${y}-${Date.now()}-${++un.current}`;return Jt.current[y]=l,Se({type:"host_resource_history_\
request",protocol_version:1,request_id:l,subscription_id:O,stream:y,after_sequence:Math.max(0,Math.round(Number(p)||0)),
max_points:y==="detail"?8:64}),l},[Se]),dr=an(()=>{let r=gt.current,p=Ly(Zs.current);gt.current=p;let y=ln.current;return p.
active?(ir(O=>({...O,aggregateOnly:p.aggregateOnly,consumerCount:p.consumerCount,detailConsumerCount:p.detailConsumerCount})),
r.active?(r.aggregateOnly===p.aggregateOnly||(p.aggregateOnly&&(va(O=>Ja([],O,60)),wa([]),Gn(null),Jt.current.detail="",
Ut.current.detail=0,es.current.detail=0),y&&Rs(p.aggregateOnly,y)),y||null):(lr(),Rs(p.aggregateOnly,""),null)):(ln.current=
"",qt.current="",Jt.current={system:"",detail:""},Zn.current=!0,y&&Se({type:"host_resource_unsubscribe",protocol_version:1,
request_id:`host-resource-unsubscribe-${Date.now()}-${++un.current}`,subscription_id:y}),lr(),ir({id:"",status:"idle",aggregateOnly:!0,
resumed:!1,consumerCount:0,detailConsumerCount:0}),null)},[lr,Se,Rs]),mc=an((r=!1,p="dashboard")=>{let y=String(p||"dash\
board").trim().slice(0,64)||"dashboard",O=r===!0;return Zs.current.get(y)?.aggregateOnly===O?ln.current||null:(Zs.current.
set(y,{aggregateOnly:O}),dr())},[dr]),fc=an((r="dashboard")=>{let p=String(r||"dashboard").trim().slice(0,64)||"dashboar\
d";return Zs.current.delete(p)?dr():ln.current||null},[dr]),Sn=an(r=>{let p=[...new Set((Array.isArray(r)?r:[]).filter(y=>typeof y==
"string"&&y.length>0))].sort().slice(0,128);p.length===vn.current.length&&p.every((y,O)=>y===vn.current[O])||(vn.current=
p,Fe.current?.readyState===WebSocket.OPEN&&Fe.current.send(JSON.stringify({type:"subscribe",protocol_version:1,request_id:`\
web-sub-${Date.now()}-${++Vs.current}`,sessions:p})))},[]);function Ts(){Yn.current&&clearInterval(Yn.current),It.current&&
clearTimeout(It.current),Yn.current=null,It.current=null,cn.current=null,Ln.current=null}function lo(r=Fe.current){if(!r||
r.readyState!==WebSocket.OPEN||cn.current)return;let p=`web-hb-${Date.now()}-${++Sa.current}`,y=Date.now();cn.current={requestId:p,
sentAt:y},r.send(JSON.stringify({type:"heartbeat",protocol_version:1,request_id:p,client_sent_at_ms:y,client_ts:new Date(
y).toISOString()})),It.current=setTimeout(()=>{if(cn.current?.requestId===p){cn.current=null,It.current=null,S({state:"s\
tale",rttMs:null,lastAckAt:null});try{r.close()}catch{}}},Xs.current)}function pr(r,p=Fe.current){Ts(),Cs.current=Math.max(
1e3,Number(r?.heartbeat_interval_ms)||1e4),Xs.current=Math.max(Cs.current*2,Number(r?.heartbeat_timeout_ms)||3e4),lo(p),
Yn.current=setInterval(()=>lo(p),Cs.current)}function sa(r){let p=cn.current;if(!p||p.requestId!==r.request_id)return;It.
current&&clearTimeout(It.current),It.current=null,cn.current=null;let y=Date.now(),O=wd({clientSentAtMs:p.sentAt,relayReceivedAtMs:r.
relay_received_at_ms,relaySentAtMs:r.relay_sent_at_ms,clientReceivedAtMs:y});Ln.current=O.ok?O.estimate:null;let l=Math.
max(0,y-p.sentAt),x=l<=500?"healthy":l<=2e3?"slow":"poor";S({state:x,rttMs:l,lastAckAt:y,clockStatus:O.ok?O.estimate.status:
O.code,clockOffsetMs:O.ok?O.estimate.offset_ms:null,clockUncertaintyMs:O.ok?O.estimate.uncertainty_ms:null})}function ns(r){
let p=Ks.current[r];p&&clearTimeout(p),delete Ks.current[r]}function Zt(r,p,{force:y=!1}={}){if(!r)return!1;let O=Kn.current[r],
l=Hf[O]??-1,x=Hf[p]??-1;if(!y&&O&&x<l)return!1;if(!Object.prototype.hasOwnProperty.call(Kn.current,r)&&Object.keys(Kn.current).
length>=Fr){let A=Object.keys(Kn.current)[0];ns(A),delete Ns.current[A],delete En.current[A]}return Kn.current=Hs(Kn.current,
r,p),oe(A=>Hs(A,r,p)),!0}function ss(r,p,{allowMissingCurrent:y=!1}={}){if(!r)return{accepted:!1,advanced:!1,attempt:0};
let O=Math.max(0,Number(En.current[r])||0),l=Number(p);if(!Number.isInteger(l)||l<1)return O<=1||y?{accepted:!0,advanced:!1,
attempt:O||1,legacy:!0}:{accepted:!1,advanced:!1,attempt:O,legacy:!0};if(l<O)return{accepted:!1,advanced:!1,attempt:O,legacy:!1};
let x=l>O;return x&&(En.current=Hs(En.current,r,l)),{accepted:!0,advanced:x,attempt:l,legacy:!1}}function _t(r,p){!r||!p||
(Ns.current=Hs(Ns.current,r,p))}function Ma(r,p,y){r&&o(O=>{let l=vf(O,r,p||Ns.current[r]||"");return l?(_t(r,l),wf(O,r,
l,y)):O})}function Ra(r,p,y="",O={}){if(!r)return;let l=ss(r,O.delivery_attempt,{allowMissingCurrent:O.network!==!0});l.
accepted&&Zt(r,"failed",{force:l.advanced})&&(ns(r),Ma(r,y,x=>({...x,status:"failed",failure_code:O.failure_code||x.failure_code||
null,failure_reason:p||O.failure_reason||"Send failed",failure_native_attempted:O.failure_native_attempted??x.failure_native_attempted??
null,failure_retryable:O.failure_retryable??x.failure_retryable??null,_deliveryAttempt:l.attempt,_sendError:p||"Send fai\
led"})))}function Pn(r,p,y){ns(r);let O=Ty[p];O&&(Ks.current[r]=setTimeout(()=>{delete Ks.current[r],Kn.current[r]===p&&
Ra(r,y)},O))}Sd(()=>{Le.current=xe},[xe]),Sd(()=>{d.current=se},[se]);function ti(r,p){return`${r}:${p}`}function Ta(r,p){
!Object.prototype.hasOwnProperty.call(Be.current,r)&&Object.keys(Be.current).length>=Fr&&dn(Object.keys(Be.current)[0]),
Be.current=Hs(Be.current,r,p),bn(Be.current)}function dn(r){let p=Ge.current[r];p&&clearTimeout(p),delete Ge.current[r]}
function mr(r,p){let y=Be.current[r];if(!y||!["pending","awaiting_config"].includes(y.status))return;dn(r);let l={...Le.
current[y.sessionId]||{},[y.configKey]:y.previousValue};Le.current={...Le.current,[y.sessionId]:l},be(x=>({...x,[y.sessionId]:{
...x[y.sessionId]||{},[y.configKey]:y.previousValue}})),Ta(r,{...y,status:"failed",error:p||"Control change failed and w\
as rolled back.",completedAt:Date.now()})}function as(r,p,y,O,l,x){let A=ti(r,p);dn(A);let I=Le.current[r]||{},j={sessionId:r,
field:p,configKey:y,requestId:x,previousValue:I[y],requestedValue:O,status:"pending",error:null,startedAt:Date.now()},D={
...I,[y]:O};return Le.current={...Le.current,[r]:D},be(ne=>({...ne,[r]:{...ne[r]||{},[y]:O}})),Ta(A,j),Ge.current[A]=setTimeout(
()=>mr(A,"Timed out waiting for the agent to confirm this setting."),Ry),Se({...l,session_id:r,request_id:x}),x}function xt(r,p){
Object.entries(Be.current).forEach(([y,O])=>{O.sessionId!==r||!["pending","awaiting_config"].includes(O.status)||Object.
prototype.hasOwnProperty.call(p,O.configKey)&&p[O.configKey]===O.requestedValue&&(dn(y),Ta(y,{...O,status:"ok",error:null,
completedAt:Date.now()}))})}let fr=an(()=>{cr(),Jr.current=!1,Jn.current.clear();let r=location.protocol==="https:"?"wss":
"ws",p=new WebSocket(`${r}://${location.host}/client-ws`);Fe.current=p,p.onopen=()=>{Ys.current=0,k(!0),S({state:"connec\
ting",rttMs:null,lastAckAt:null}),p.send(JSON.stringify({type:"subscribe",protocol_version:1,request_id:`web-sub-${Date.
now()}-${++Vs.current}`,sessions:vn.current})),gt.current.active&&Rs(gt.current.aggregateOnly,ln.current)},p.onclose=()=>{
if(Ts(),Object.entries(Be.current).forEach(([l,x])=>{["pending","awaiting_config"].includes(x?.status)&&mr(l,"Connection\
 changed before the native setting was confirmed. Retry after reconnecting.")}),Object.values(tt.current).forEach(l=>clearTimeout(
l)),tt.current={},Object.keys(it.current).forEach(l=>{it.current[l]={...it.current[l]||{},inFlight:!1}}),f({}),or(),k(!1),
S({state:"offline",rttMs:null,lastAckAt:null}),gt.current.active&&ir(l=>({...l,status:"reconnecting"})),Fe.current!==p)return;
let y=Ys.current++,O=Ff[Math.min(y,Ff.length-1)];Vn.current=setTimeout(()=>{Vn.current=null,fr()},O)},p.onmessage=y=>{let O;
try{O=JSON.parse(y.data)}catch{return}let l=Date.now();O.stream_trace&&typeof O.stream_trace=="object"&&(O.stream_trace=
{...O.stream_trace,browser_received_at_ms:Date.now()}),O.latency_trace&&typeof O.latency_trace=="object"&&(O._latency_browser_received_at_ms=
l),Xn.current(O)}},[Se,Rs]);Sd(()=>(fr(),()=>{Vn.current&&clearTimeout(Vn.current),Ts(),Object.values(Ks.current).forEach(
p=>clearTimeout(p)),Ks.current={},Object.values(Ge.current).forEach(p=>clearTimeout(p)),Ge.current={},cr(),As.current!=null&&
(typeof cancelAnimationFrame=="function"?cancelAnimationFrame(As.current):clearTimeout(As.current),As.current=null),On.current.
clear();let r=Fe.current;Fe.current=null;try{r?.close()}catch{}}),[fr]);function hr(r,p={}){let y=Kf(r);L(O=>zi(O,Kf(r,O).
activities,p)),C(O=>zi(O,y.thinkingContent,p)),h(O=>zi(O,y.thinking,p))}function hc(r){let p=new Set((r||[]).map(A=>A&&typeof A==
"object"?A.session_id:A).filter(Boolean)),y=A=>{let I=!1,j={...A};return Object.keys(j).forEach(D=>{p.has(D)||(delete j[D],
I=!0)}),I?j:A};Object.keys(Wn.current).forEach(A=>{p.has(A)||(clearTimeout(Wn.current[A]),delete Wn.current[A])}),[Qn,kn,
it,xa,Ca].forEach(A=>{Object.keys(A.current).forEach(I=>{p.has(I)||delete A.current[I]})});let O=!1,l={...Qt.current};Object.
keys(l).forEach(A=>{p.has(A)||(delete l[A],ta(A),O=!0)}),O&&(Qt.current=l,Me(l)),Object.entries($t.current).forEach(([A,
I])=>{p.has(I?.sessionId)||delete $t.current[A]}),Object.keys(Nt.current).forEach(A=>{p.has(A)||delete Nt.current[A]});for(let A of On.
current.keys())p.has(A)||On.current.delete(A);Object.keys(tt.current).forEach(A=>{p.has(A)||(clearTimeout(tt.current[A]),
delete tt.current[A])});let x=!1;Object.entries(Be.current).forEach(([A,I])=>{p.has(I?.sessionId)||(dn(A),delete Be.current[A],
x=!0)}),x&&bn({...Be.current}),L(y),C(y),h(y),u(y),f(y),b(y),V(y),W(y),Q(y),he(y),be(y),z(y),ie(y),Ee(y),ae(y),F(y),Te(y),
St(y),Un(y),ka(y),ks(A=>{let I=!1,j={...A};return Object.keys(j).forEach(D=>{let ne=D.indexOf(":"),me=ne>=0?D.slice(0,ne):
D;p.has(me)||(delete j[D],I=!0)}),I?j:A})}function ni(r){let p={};(r||[]).forEach(y=>{!y||typeof y!="object"||!y.session_id||
typeof y.auto_approve_permissions=="boolean"&&(p[y.session_id]={auto_approve_permissions:y.auto_approve_permissions})}),
Object.keys(p).length>0&&be(y=>{let O=!1,l={...y};return Object.entries(p).forEach(([x,A])=>{let I={...l[x]||{},...A};Tt(
l[x]||{},I)||(l[x]=I,O=!0)}),O?l:y})}function si(r){let p={};(r||[]).forEach(y=>{!y||typeof y!="object"||!y.session_id||
Array.isArray(y.chat_list)&&(p[y.session_id]=y.chat_list)}),z(y=>ul(y,p))}function $a(r){let p={};(r||[]).forEach(y=>{!y||
typeof y!="object"||!y.session_id||y.status&&(p[y.session_id]=y.status)}),V(y=>ul(y,p))}function ai(r,p={}){let y=typeof r==
"string"?r:r?.session_id;if(!y||Fe.current?.readyState!==WebSocket.OPEN)return;let O=`hist-${Date.now()}-${++oo.current}`;
Qn.current[y]=O;let l=Math.max(0,Math.floor(Number(p.afterSequence??p.after_sequence)||0)),x=l>0?"delta":p.full?"full":"\
tail";f(j=>({...j,[y]:{mode:x,requestedAt:Date.now(),requestId:O}}));let A={type:l>0?"history_request":"get_history",session:y,
session_id:y,request_id:O};l>0&&(A.after_sequence=l);let I=Number(p.limit||p.tailLimit||0);l<=0&&Number.isFinite(I)&&I>0&&
!p.full&&(A.limit=Math.floor(I),A.tail=!0),p.full&&(A.full=!0),Se(A)}function Gt(r,p={}){let y=typeof r=="string"?r:r?.session_id;
if(!y||Fe.current?.readyState!==WebSocket.OPEN)return;let O=p.mode==="older"?"older":p.mode==="around"?"around":"tail",l=p.
source||"relay_sqlite",x=O==="around"||O==="tail"&&p.replace!==!1,A=p.beforeOffset??p.before_offset??null,I=p.beforeId??
p.before_id??null,j=p.aroundId??p.around_id??null,D=String(p.threadId??p.thread_id??"").trim()||null,ne=`${O}${l}${D||
""}${A??""}${I??""}${j??""}`,me=it.current[y]||{},Ie=Date.now();if(me.inFlight&&O!=="around"||O==="older"&&me.lastRequestSig===
ne&&Ie-Number(me.lastRequestAt||0)<1500)return;let Ye=`histchunk-${Date.now()}-${++Na.current}`,bt=Math.max(256*1024,Math.
min(16*1024*1024,Number(p.chunkBytes||p.chunk_bytes||jf)||jf));if(O!=="older"){let At=Number(p.retryAttempt||0)>0?me.baselineMessageKeys:
null,ut=Array.isArray(At)?At:(a[y]||[]).map(Ct).filter(Boolean);clearTimeout(tt.current[y]),it.current[y]={source:l,chunkBytes:bt,
limit:p.limit||null,inFlight:!0,mode:O,replace:x,baselineMessageKeys:ut,beforeOffset:A,beforeId:I,aroundId:j,threadId:D,
userInitiated:p.userInitiated===!0||p.user_initiated===!0,retryAttempt:Number(p.retryAttempt||0),lastRequestSig:ne,lastRequestAt:Ie}}else
it.current[y]={...it.current[y]||{},source:l,chunkBytes:bt,limit:p.limit||it.current[y]?.limit||null,inFlight:!0,mode:O,
beforeOffset:A,beforeId:I,aroundId:j,threadId:D,userInitiated:p.userInitiated===!0||p.user_initiated===!0,retryAttempt:Number(
p.retryAttempt||0),lastRequestSig:ne,lastRequestAt:Ie};kn.current[y]=Ye,u(At=>{if(!At[y]?.error)return At;let ut={...At[y]};
return delete ut.error,{...At,[y]:ut}}),f(At=>({...At,[y]:{mode:O,kind:"chunked",requestedAt:Date.now(),requestId:Ye}}));
let Lt={type:"history_chunk_request",session:y,session_id:y,request_id:Ye,mode:O,source:l,replace:x,chunk_bytes:bt};D&&(Lt.
thread_id=D);let Nn=Number(p.limit||p.tailLimit||0);Number.isFinite(Nn)&&Nn>0&&(Lt.limit=Math.floor(Nn)),(p.userInitiated||
p.user_initiated)&&(Lt.user_initiated=!0),O==="older"&&A!=null&&(Lt.before_offset=A),O==="older"&&I!=null&&(Lt.before_id=
I),O==="around"&&j!=null&&(Lt.around_id=j),Se(Lt),tt.current[y]=setTimeout(()=>{if(delete tt.current[y],kn.current[y]!==
Ye)return;let At=it.current[y]||{};if(!At.inFlight)return;if(it.current[y]={...At,inFlight:!1},Pt.current!==y){f(qe=>{if(qe[y]?.
requestId!==Ye)return qe;let ot={...qe};return delete ot[y],ot});return}let ut=Number(p.retryAttempt||0);if(ut<Bf&&Pt.current===
y&&Fe.current?.readyState===WebSocket.OPEN){Gt(y,{...p,mode:O,source:l,beforeOffset:A,beforeId:I,threadId:D,chunkBytes:bt,
retryAttempt:ut+1});return}f(qe=>{if(qe[y]?.requestId!==Ye)return qe;let ot={...qe};return delete ot[y],ot}),u(qe=>({...qe,
[y]:{...qe[y]||{},error:"Transcript history request timed out. Retry to load the latest messages."}}))},Ay)}function Ct(r){
if(!r)return"";if(r.source_message_id)return`source${r.source_message_id}`;if(r.native_source_id)return`native${r.native_source_id}`;
if(r.id!=null)return`id${r.id}`;if(r.server_message_id!=null)return`server${r.server_message_id}`;if(r.sequence!=null&&
r.ts!=null)return`seq${r.sequence}${r.ts}${r.role||""}`;if(r.client_msg_id)return`client${r.client_msg_id}`;let p=Array.
isArray(r.content_blocks)?JSON.stringify(r.content_blocks):"";return`${r.role||""}${r.content||""}${p}`}function pn(r,p,y){
let O=Array.isArray(r)?r:[],l=Array.isArray(p)?p:[];if(y==="older"){let D=new Set(O.map(Ct)),ne=[];return l.forEach(me=>{
let Ie=Ct(me);D.has(Ie)||(D.add(Ie),ne.push(me))}),ne.length?[...ne,...O]:O}let x=Wf(O,l);if(x)return x;let A=new Set(O.
map(Ct)),I=[...O],j=0;return l.forEach(D=>{let ne=Ct(D);A.has(ne)||(A.add(ne),I.push(D),j++)}),j?I:O}function uo(r,p){let y=Array.
isArray(r)?r:[],O=Array.isArray(p)?p:[];if(!y.length)return O;if(!O.length)return y;let l=Wf(y,O);if(l)return l;let x=new Set(
y.map(Ct)),A=[...y],I=0;return O.forEach(j=>{let D=Ct(j);x.has(D)||(x.add(D),A.push(j),I++)}),I?A:y}function aa(r,p,y,O){
let l=Array.isArray(r)?r:[],x=Array.isArray(p)?p:[],A=new Map(l.map(Ie=>[Ct(Ie),Ie])),I=x.map(Ie=>{let Ye=A.get(Ct(Ie));
return Ye&&Tt(Ye,Ie)?Ye:Ie}),j=I.length===l.length&&I.every((Ie,Ye)=>Ie===l[Ye])?l:I,D=new Set(Array.isArray(y?.baselineMessageKeys)?
y.baselineMessageKeys:[]);if((y?.source==="native"||O==="codex_cli_jsonl"||O==="cursor_cli_jsonl")&&D.size>j.length)return l;
let me=l.filter(Ie=>{let Ye=Ct(Ie);return Ye&&!D.has(Ye)});return me.length===0?j:pn(j,me,"tail")}function gr(r){return!r||
typeof r!="object"?!1:["codex","codex-desktop","cursor","codex_cli","cursor_cli","roo_code","cline"].includes(r.agent_type)}
function mn(r,p={}){r&&(o(y=>({...y,[r]:[]})),p.preserveQueued!==!0&&W(y=>({...y,[r]:[]})),h(y=>({...y,[r]:!1})),C(y=>({
...y,[r]:""})),L(y=>({...y,[r]:!1})),u(y=>({...y,[r]:null})),f(y=>{if(!y[r])return y;let O={...y};return delete O[r],O}))}
function _r(r,p,y,O={}){let l=`prompt-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,x=typeof O.instruction=="s\
tring"?O.instruction.trim():"",A=d.current[r],I=A?.type==="question_prompt",j=O.action==="cancel"?"cancel":"answer",D=y||
(j==="cancel"?"question_cancel":Array.isArray(O.answers)?"question_answers":x?"alternate_instruction":null);Q(ne=>ne[r]?
{...ne,[r]:{...ne[r],submitting_choice_id:D,request_id:l,error:null}}:ne),Se(I?{type:"question_response",session_id:r,prompt_id:p,
generation:A.generation,action:j,...j==="answer"?{answers:O.answers||[]}:{},request_id:l}:{type:"permission_response",session_id:r,
prompt_id:p,...y?{choice_id:y}:{},...Array.isArray(O.answers)?{answers:O.answers}:{},...x?{instruction:x}:{},request_id:l})}
function ri(r,p,y,O){let l=`errprompt-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;he(x=>x[r]?{...x,[r]:{...x[r],
submitting_action_id:y,request_id:l,error:null}}:x),Se({type:"error_prompt_action",session_id:r,prompt_id:p,action_id:y,
request_id:l,...y==="open_native_window"?{operator_user_gesture:O?.isTrusted===!0}:{}})}function br(r,p={}){let y=`inter\
rupt-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return Se({type:"agent_interrupt",session_id:r,request_id:y,
connection_id:xs.current,session_generation:Math.max(0,Number(p.sessionGeneration)||0),turn_generation:Math.max(0,Number(
p.turnGeneration)||0)}),y}function po(r,p,y,O={}){let l=String(O.requestId||"").trim()||`goal-${p}-${Date.now()}-${Math.
random().toString(36).slice(2,7)}`;return Se({type:"agent_goal_control",session_id:r,request_id:l,action:p,connection_id:xs.
current,session_generation:Math.max(0,Number(O.sessionGeneration)||0),goal_generation:Math.max(0,Number(y?.generation)||
0),goal_transition_seq:Math.max(0,Number(y?.transition_seq)||0),goal_fingerprint:String(y?.fingerprint||"")}),l}function qn(r){
let p=`cfg-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;Se({type:"agent_config_request",session_id:r,request_id:p})}
function rs(r,p){let y=`model-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,l=(Le.current[r]||{}).config_semantics===
"observed_and_next_send"?"next_send_model_id":"model_id";return as(r,"model",l,p,{type:"agent_set_model",model_id:p},y)}
function Gl(r,p){let y=`effort-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,l=(Le.current[r]||{}).config_semantics===
"observed_and_next_send"?"next_send_effort":"effort";return as(r,"effort",l,p,{type:"agent_set_effort",effort:p},y)}function ii(r,p){
let y=`perm-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return as(r,"permission_mode","permission_mode",p,{type:"\
agent_set_permission_mode",mode:p},y)}function gc(r,p){let y=`autoperm-${Date.now()}-${Math.random().toString(36).slice(
2,7)}`;return as(r,"auto_approve_permissions","auto_approve_permissions",!!p,{type:"agent_set_auto_approve_permissions",
enabled:!!p},y)}function oi(r,p){let y=`mode-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,O=Object.prototype.
hasOwnProperty.call(Le.current[r]||{},"conversation_mode")?"conversation_mode":"mode";return as(r,"mode",O,p,{type:"agen\
t_set_mode",mode:p},y)}function Wl(r,{model_id:p,effort:y,speed:O,access_mode:l,permission_profile:x,confirm_bypass:A,workspace_mode:I}){
let j=`codex-cfg-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,D=Le.current[r]||{},ne=[["model","model_id",p],
["effort","effort",y],["speed","speed",O],["access_mode","permission_mode",l],["workspace_mode","workspace_mode",I],["pe\
rmission_profile","permission_profile",x]],[me,Ie,Ye]=ne.find(([,,bt])=>bt!=null)||["codex_config","model_id",p];return as(
r,me,Ie,Ye,{type:"set_codex_config",model_id:p,effort:y,speed:O,access_mode:l,permission_profile:x,confirm_bypass:A,workspace_mode:I,
source_revision:D.source_revision},j)}function mo(r){let p=`new-thread-${Date.now()}-${Math.random().toString(36).slice(
2,7)}`;return n.find(O=>(typeof O=="object"?O?.session_id:O)===r)?.agent_type==="codex-desktop"&&(ta(r),Object.entries($t.
current).forEach(([O,l])=>{l?.sessionId===r&&delete $t.current[O]}),Ms(r),Dt(r,null)),mn(r),Se({type:"new_thread",session_id:r,
request_id:p}),p}function Ea(r){let p=`panel-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return Se({type:"op\
en_panel",session_id:r,request_id:p}),p}function ci(r,p){let y=`native-${Date.now()}-${Math.random().toString(36).slice(
2,7)}`;return Se({type:"open_native_window",session_id:r,request_id:y,operator_user_gesture:p?.isTrusted===!0}),y}function is(r){
let p=`chatlist-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return Se({type:"chat_list",session_id:r,request_id:p}),
p}function fo(r,p){let y=`switch-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return Se({type:"switch_chat",session_id:r,
chat_id:p,request_id:y}),y}function ho(r){let p=`newchat-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return Se(
{type:"new_chat",session_id:r,request_id:p}),p}function yr(r){let p=`threads-${Date.now()}-${Math.random().toString(36).
slice(2,7)}`;return Se({type:"thread_list",session_id:r,request_id:p}),p}function La(r,p){let y=`swthread-${Date.now()}-${Math.
random().toString(36).slice(2,7)}`;if(n.find(I=>(typeof I=="object"?I?.session_id:I)===r)?.agent_type!=="codex-desktop")
return mn(r),Se({type:"switch_thread",session_id:r,thread_id:p,request_id:y}),y;let l=(fe[r]||[]).find(I=>String(I?.id||
"")===String(p)||String(I?.cache_key||"")===String(p)),x=Date.now();ta(r),Object.entries($t.current).forEach(([I,j])=>{j?.
sessionId===r&&delete $t.current[I]}),Ms(r),mn(r,{preserveQueued:!0});let A={sessionId:r,threadId:String(p||""),requestId:y,
startedAt:x};return $t.current[y]=A,Dt(r,{thread_id:A.threadId,title:l?.title||"Codex Desktop chat",view_state:"loading",
selection_mode:"client_local_readonly",selection_budget_ms:Nd,started_at:x,deadline_at:x+Nd,read_only:!0,retryable:!1,message:"\
Checking this Codex Desktop chat without changing the native app."}),Fe.current?.readyState!==WebSocket.OPEN?(delete $t.
current[y],Dt(r,I=>({...I||{},view_state:"error",retryable:!0,completed_at:Date.now(),message:"The relay is offline. Rec\
onnect, then retry this chat."})),y):(Et.current[r]=setTimeout(()=>{delete Et.current[r],$t.current[y]&&(delete $t.current[y],
Dt(r,I=>I?.thread_id!==A.threadId||I?.view_state!=="loading"?I:{...I,view_state:"error",retryable:!0,completed_at:Date.now(),
message:"Codex Desktop chat availability timed out. Retry without changing the native app."}))},Nd),Se({type:"switch_thr\
ead",session_id:r,thread_id:p,request_id:y}),y)}function $s(r){let p=`term-${Date.now()}-${Math.random().toString(36).slice(
2,7)}`;return Se({type:"terminal_output",session_id:r,request_id:p}),p}function Oa(r,p){let y=`termin-${Date.now()}-${Math.
random().toString(36).slice(2,7)}`;return Se({type:"terminal_input",session_id:r,request_id:y,text:p}),y}function os(r){
let p=`diff-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return Se({type:"file_changes",session_id:r,request_id:p}),
p}function Ia(r,p,y){let O=`filechg-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return Se({type:"file_change\
_response",session_id:r,change_id:p,action:y,request_id:O}),O}function cs(r,p){let y=`dir-${Date.now()}-${Math.random().
toString(36).slice(2,7)}`;return Se({type:"list_directory",session_id:r,request_id:y,path:p||"."}),y}function ra(r,p){let y=`\
file-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return Se({type:"read_file",session_id:r,request_id:y,path:p}),
y}function ls(r){let p=`skills-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return Se({type:"skill_list",session_id:r,
request_id:p}),p}function Pa(r){let p=`automation-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return Se({type:"\
automation_view_action",session_id:r,request_id:p}),p}function Dn(r,p,y,O){let l=`attach-${Date.now()}-${Math.random().toString(
36).slice(2,7)}`;return Se({type:"send_attachment",session_id:r,request_id:l,data:p,mime_type:y,filename:O}),l}function qa(r,p){
let y=`swws-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return as(r,"workspace","file_access_scope",p,{type:"\
switch_workspace",folder_path:p},y)}function Es(r){let p=`branches-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
return Se({type:"branch_list",session_id:r,request_id:p}),p}function mt(r,p){let y=`swbranch-${Date.now()}-${Math.random().
toString(36).slice(2,7)}`;return Se({type:"switch_branch",session_id:r,branch_name:p,request_id:y}),y}function go(r,p){let y=`\
newbranch-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return Se({type:"create_branch",session_id:r,branch_name:p,
request_id:y}),y}function Kl(r,p,y={}){let O=`launch-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return J(l=>Hs(
l,O,{status:"launching",agentType:r})),Se({type:"launch_session",agent_type:r,workspace_path:p||void 0,model_id:y.model_id||
void 0,permission_mode:y.permission_mode||void 0,effort:y.effort||void 0,request_id:O}),O}function _c(r,p,y,O={}){let l=`\
resume-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return J(x=>Hs(x,l,{status:"launching",agentType:p})),Se(
{type:"resume_session",source_session:r,agent_type:p||"claude",workspace_path:y||void 0,cli_session_id:O.cli_session_id||
void 0,model_id:O.model_id||void 0,permission_mode:O.permission_mode||void 0,request_id:l}),l}function _o(r,p){Se(p?{type:"\
dismiss_session",session:r}:{type:"close_session",session:r})}function vr(r,p,y=""){let O=y||`cmsg-${Date.now()}-${Math.
random().toString(36).slice(2,8)}`;_t(O,r);let l=y?(nd[r]||[]).find(A=>A._cid===O||A.client_message_id===O||A.client_msg_id===
O):null,x=qi(l)?.iso||new Date().toISOString();if(o(A=>{let I=A[r]||[],j=y&&I.some(D=>D._cid===O||D.client_message_id===
O||D.client_msg_id===O);return{...A,[r]:j?I.map(D=>D._cid===O||D.client_message_id===O||D.client_msg_id===O?{...D,content:p,
_cid:O,_optimistic:!0,_delivered:!1,_agentStarted:!1,_sendError:null,failure_code:null,failure_reason:null,failure_native_attempted:null,
failure_retryable:null}:D):[...I,Di({role:"user",content:p,_cid:O,_optimistic:!0,created_at:x})]}}),Fe.current?.readyState===
WebSocket.OPEN){Zt(O,"queued",{force:!!y}),Pn(O,"queued","Timed out waiting for relay acceptance.");let A=n.find(j=>(typeof j==
"string"?j:j?.session_id)===r),I=(typeof A=="object"?A?.agent_type:null)||Le.current[r]?.agent_type||"unknown";Se({type:"\
send",session:r,content:p,client_message_id:O,created_at:x,...y?{retry_failed:!0}:{},latency_trace:zf(O,I,Date.now(),"",
Ln.current)})}else wn.current.length<20?(wn.current=[...wn.current.filter(A=>A.cid!==O),{session:r,content:p,cid:O,created_at:x,
retry_failed:!!y}],ns(O),Zt(O,"offline_queued")):(Zt(O,"queued"),Ra(O,"Offline send queue is full. Reconnect or retry af\
ter another message sends."));return O}function li(){let r=Fe.current;if(!r||r.readyState!==WebSocket.OPEN||wn.current.length===
0)return;let p=wn.current;wn.current=[],p.forEach(y=>{_t(y.cid,y.session),Zt(y.cid,"queued",{force:y.retry_failed===!0}),
Pn(y.cid,"queued","Timed out waiting for relay acceptance after reconnect.");let O=n.find(x=>(typeof x=="string"?x:x?.session_id)===
y.session),l=(typeof O=="object"?O?.agent_type:null)||Le.current[y.session]?.agent_type||"unknown";r.send(JSON.stringify(
{type:"send",session:y.session,content:y.content,client_message_id:y.cid,created_at:y.created_at,...y.retry_failed?{retry_failed:!0}:
{},latency_trace:zf(y.cid,l,Date.now(),"",Ln.current)}))})}function bo(r,p,y,O){let l={type:"steer",session_id:r,client_message_id:p,
content:y};O!=null&&(l.native_index=O),Se(l),p&&p.startsWith("native-")&&W(x=>({...x,[r]:(x[r]||[]).filter(A=>A.cid!==p)}))}
function bc(r,p){ns(p),delete Kn.current[p],delete Ns.current[p],delete En.current[p],Se({type:"discard_queued",session_id:r,
client_message_id:p}),W(y=>({...y,[r]:(y[r]||[]).filter(O=>O.cid!==p)})),oe(y=>{let O={...y};return delete O[p],O}),o(y=>{
let O=y[r]||[];return{...y,[r]:O.filter(l=>l._cid!==p)}})}function Vl(r,p,y){W(O=>({...O,[r]:(O[r]||[]).map(l=>l.cid===p?
{...l,content:y,content_blocks:(l.content_blocks||[]).map(x=>x?.type==="queued_message"?{...x,content:y}:x)}:l)})),o(O=>{
let l=O[r]||[];return{...O,[r]:l.map(x=>x._cid===p?{...x,content:y}:x)}}),Se({type:"edit_queued",session_id:r,client_message_id:p,
content:y})}function ui(r){r?.id&&X(p=>{let y=p.filter(O=>O.id!==r.id);return["completed","cancelled"].includes(r.state)?
y:[r,...y]})}async function Da(){let r=await fetch("/api/scheduled-sends",{credentials:"same-origin"});if(!r.ok)throw new Error(
`Could not load scheduled sends (${r.status})`);let p=await r.json();return X((p.scheduled_sends||[]).filter(y=>!["compl\
eted","cancelled"].includes(y.state))),p.scheduled_sends||[]}async function Yl(r,p,y,O=null){let l=await fetch("/api/sch\
eduled-sends",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({
session_id:r,content:p,trigger_kind:y,...y==="at"?{deliver_at:O}:{}})}),x=await l.json().catch(()=>({}));if(!l.ok)throw new Error(
x.error||`Could not schedule message (${l.status})`);return ui(x.scheduled_send),x.scheduled_send}async function wr(r){let p=await fetch(
`/api/scheduled-sends/${encodeURIComponent(r)}`,{method:"DELETE",credentials:"same-origin"}),y=await p.json().catch(()=>({}));
if(!p.ok)throw new Error(y.error||`Could not cancel scheduled message (${p.status})`);return ui(y.scheduled_send),y.scheduled_send}
function yc(r,p){if(!r?.stream_trace||typeof window>"u")return;let y={...r.stream_trace,session_id:p||r.session||r.session_id||
""},O=window.requestAnimationFrame||(l=>window.setTimeout(l,16));O(()=>O(()=>{let l=Array.isArray(window.__RAC_STREAM_TRACES__)?
window.__RAC_STREAM_TRACES__:[];l.push({...y,browser_paint_at_ms:Date.now()}),l.length>500&&l.splice(0,l.length-500),window.
__RAC_STREAM_TRACES__=l}))}function di(r,p){let y=r?.latency_trace;if(!y?.trace_id||!y?.stages?.relay_broadcast||typeof window>
"u"||Js.current.has(y.trace_id))return;for(Js.current.add(y.trace_id);Js.current.size>Fr;)Js.current.delete(Js.current.values().
next().value);let O=Number(r._latency_browser_received_at_ms)||Date.now(),l=window.requestAnimationFrame||(x=>window.setTimeout(
x,16));l(()=>l(()=>{let x=Ey(y,Date.now(),O,Ln.current);if(!x)return;let A=Array.isArray(window.__RAC_LATENCY_TRACES__)?
window.__RAC_LATENCY_TRACES__:[];A.push({...x,session_id:p||r.session||r.session_id||""}),A.length>Fr&&A.splice(0,A.length-
Fr),window.__RAC_LATENCY_TRACES__=A,Se({type:"latency_trace_complete",protocol_version:1,latency_trace:x})}))}function vc(r){
let p=r.type;if(!io.current.accept(r)||p==="navigation_started")return;if(p==="connection_ack"&&(Qr.current.reset(r.state_epoch),
xs.current=String(r.connection_id||""),Array.isArray(r.session_aliases)&&r.session_aliases.forEach(Zr)),p==="session_ali\
as_reconciled"){Zr(r);return}let y=r.session||r.session_id||"",O=p==="session_list"||p==="session_snapshot"||p==="proxy_\
session_snapshot"?"session_list":(p==="status"||p==="proxy_status"||p==="session_status"||p==="session_summary"||p==="se\
ssion_patch")&&y?`status:${y}`:"";if(!(O&&!Qr.current.accept(r,O))){if(p==="heartbeat_ack"){sa(r);return}if(p==="provide\
r_usage_snapshot"){r.snapshot&&typeof r.snapshot=="object"&&Yr(l=>bd(l,r.snapshot));return}if(p==="provider_usage_thresh\
old"){let l=new Set(Array.isArray(r.affected_session_ids)?r.affected_session_ids.map(String):[]);l.size>0&&s(x=>x.map(A=>{
let I=typeof A=="string"?A:A?.session_id;return l.has(I)?{...typeof A=="object"?A:{},session_id:I,percent_used:Number.isFinite(
Number(r.percent_used))?Number(r.percent_used):null,rate_limit_active:r.hard_limited===!0,rate_limited_until:r.reset_hint||
"unknown",usage_limit_provider:r.provider_id||null,usage_limit_window:r.window_label||r.window_id||null}:A}));return}if(p===
"provider_usage_refresh_receipt"){_a(l=>!l||!r.request_id||l.requestId===r.request_id?{requestId:r.request_id||l?.requestId||
"",status:r.status||"error",...r}:l);return}if(p==="provider_usage_reset_credit_receipt"){ba(l=>l?.requestId&&r.request_id!==
l.requestId?l:{requestId:r.request_id,status:r.status||"error",outcome:r.outcome||null,availableCount:r.reset_credits_available,
error:r.code||null});return}if(p==="provider_usage_cost_detail"){Xr(l=>l?.requestId===r.request_id?{...l,status:"ready",
detail:r.detail,error:null}:l);return}if(p==="provider_usage_cost_detail_error"){Xr(l=>l?.requestId===r.request_id?{...l,
status:"error",error:r.code||"cost_detail_failed"}:l);return}if(p==="host_resource_snapshot"){r.snapshot&&typeof r.snapshot==
"object"&&(Gn(r.snapshot),Ss(null));return}if(p==="host_resource_subscription_ack"){if(!gt.current.active||r.request_id!==
qt.current||typeof r.subscription_id!="string")return;let l=ln.current,x=r.subscription_id,A=r.resumed===!0&&l===x,I=r.aggregate_only===
!0,j=l===x&&Zn.current!==I;ln.current=x,Zn.current=I,qt.current="",A?j&&I&&(va(D=>Ja([],D,60)),wa([]),Gn(null),Jt.current.
detail="",Ut.current.detail=0,es.current.detail=0):(va([]),wa([]),Gn(null),Ut.current={system:0,detail:0},es.current={system:0,
detail:0}),ir({id:x,status:"live",aggregateOnly:I,resumed:A,consumerCount:gt.current.consumerCount,detailConsumerCount:gt.
current.detailConsumerCount}),ur("system",A?Ut.current.system:0),I||ur("detail",A?Ut.current.detail:0),gt.current.aggregateOnly!==
I&&Rs(gt.current.aggregateOnly,x);return}if(p==="host_resource_history_chunk"){let l=r.chunk,x=l?.stream==="detail"?"det\
ail":l?.stream==="system"?"system":"";if(!x||r.subscription_id!==ln.current||r.request_id!==Jt.current[x])return;let A=Array.
isArray(l.points)?l.points:[];if(x==="system"){let j=gt.current.aggregateOnly?60:900;va(D=>Ja(D,A,j))}else{if(gt.current.
aggregateOnly)return;wa(D=>Ja(D,A,180));let j=A.filter(D=>D&&typeof D=="object").sort((D,ne)=>Number(D.sample_sequence||
0)-Number(ne.sample_sequence||0)).at(-1);j&&Gn(j)}let I=Math.max(Ut.current[x],Math.round(Number(l.next_sequence)||0));Ut.
current[x]=I,Jt.current[x]="",l.done!==!0&&ur(x,I);return}if(p==="host_resource_live"){let l=r.point,x=Number(l?.sample_sequence);
if(r.subscription_id!==ln.current||!Number.isSafeInteger(x)||x<=es.current.system)return;es.current.system=x,Ut.current.
system=Math.max(Ut.current.system,x);let A=gt.current.aggregateOnly?60:900;va(I=>Ja(I,l,A)),Ss(null);return}if(p==="host\
_resource_detail"){if(gt.current.aggregateOnly)return;let l=r.snapshot,x=Number(l?.sample_sequence);if(r.subscription_id!==
ln.current||!Number.isSafeInteger(x)||x<=es.current.detail)return;es.current.detail=x,Ut.current.detail=Math.max(Ut.current.
detail,x),wa(A=>Ja(A,l,180)),Gn(l),Ss(null);return}if(p==="host_resource_unsubscribed")return r.subscription_id&&r.subscription_id!==
ln.current,void 0;if(p==="host_resource_error"){Ss({code:r.code||"unavailable",message:r.message||"Windows host metrics \
are unavailable."});return}if(p==="semantic_notification"){ro(l=>rd(l,r));return}if(!Jr.current&&!r.request_id&&$y.has(p)){
let l=r.session||r.session_id||"global",x=p==="history_chunk"?r.source||"native":"";for(Jn.current.set(`${p}:${l}:${x}`,
r);Jn.current.size>256;)Jn.current.delete(Jn.current.keys().next().value);return}if(p==="session_list"){hc(r.sessions||[]),
t(l=>Do(l,r.sessions||[])),hr(r.sessions||[],{authoritative:!0}),ni(r.sessions||[]),si(r.sessions||[]),$a(r.sessions||[]),
(r.sessions||[]).forEach(l=>{let x=l&&typeof l=="object"?l.session_id:l,A=gr(l);l&&typeof l=="object"&&l.is_list_view&&!A&&
x&&o(I=>I[x]&&I[x].length>0?{...I,[x]:[]}:I)}),Array.isArray(r.workspaces)&&H(l=>Tt(l,r.workspaces)?l:r.workspaces);return}
if(p==="session_snapshot"||p==="proxy_session_snapshot"){hc(r.sessions||[]),t(l=>Do(l,r.sessions||[])),hr(r.sessions||[],
{authoritative:!0}),ni(r.sessions||[]),si(r.sessions||[]),$a(r.sessions||[]),(r.sessions||[]).forEach(l=>{let x=l&&typeof l==
"object"?l.session_id:l,A=gr(l);l&&typeof l=="object"&&l.is_list_view&&!A&&x&&o(I=>I[x]&&I[x].length>0?{...I,[x]:[]}:I)});
return}if(p==="connection_ack"){if(pr(r),Array.isArray(r.semantic_notifications)&&ro(l=>rd(l,r.semantic_notifications)),
li(),Da().catch(()=>{}),Vr(Array.isArray(r.duplicate_proxy_alarms)?r.duplicate_proxy_alarms:[]),Ws(Array.isArray(r.nightly_validation_failures)?
r.nightly_validation_failures:[]),to(r.latest_app_update_validation||null),no(r.revalidation_program_health||null),Tn(r.
operator_dogfood_health||null),r.provider_usage&&typeof r.provider_usage=="object"&&Yr(l=>bd(l,r.provider_usage)),r.sessions&&
r.sessions.length>0&&(t(l=>Do(l,r.sessions)),hr(r.sessions,{authoritative:!0}),ni(r.sessions),si(r.sessions),$a(r.sessions),
r.sessions.forEach(l=>{let x=gr(l);if(l&&typeof l=="object"&&l.is_list_view&&!x){let A=l.session_id;A&&o(I=>I[A]&&I[A].length>
0?{...I,[A]:[]}:I)}})),Array.isArray(r.workspaces)&&H(l=>Tt(l,r.workspaces)?l:r.workspaces),r.session_health){let l={};Object.
entries(r.session_health).forEach(([x,A])=>{l[x]=typeof A=="object"?A.health:A}),V(x=>ul(x,l))}r.agent_configs&&typeof r.
agent_configs=="object"&&be(l=>({...l,...r.agent_configs})),Q(l=>{let x={},A=D=>{let ne=D?.session_id||D?.session;if(!ne)
return;let me=l[ne],Ie=me?.prompt_id===D.prompt_id&&(D.type!=="question_prompt"||me?.generation===D.generation),Ye=Ie?me.
received_at:Date.now(),bt={...D,received_at:Ye};x[ne]=Ie&&Tt(me,bt)?me:bt};(r.open_prompts||[]).forEach(A),(r.open_question_prompts||
[]).filter(D=>(!D.lifecycle||["open","submitting"].includes(D.lifecycle))&&!xd(yn.current,D)).forEach(A);let I=Object.keys(
l),j=Object.keys(x);return I.length===j.length&&j.every(D=>l[D]===x[D])?l:x});{let l={};(r.open_error_prompts||[]).forEach(
x=>{let A=x.session_id||x.session;A&&(l[A]={...x,received_at:Date.now()})}),he(l)}dc();return}if(p==="session_patch"){let l=r.
session||r.session_id;if(!l)return;t(I=>tf(I,r));let x=r.patch&&typeof r.patch=="object"?r.patch:{},A={session_id:l,...x};
x.activity&&hr([A],{authoritative:!0}),(x.model_id!==void 0||x.permission_mode!==void 0||x.capabilities!==void 0)&&ni([A]),
x.chat_list&&si([A]),x.status&&$a([A]);return}if(p==="session_health"){let l=r.session||r.session_id;l&&V(x=>({...x,[l]:r.
health}));return}if(p==="scheduled_send_status"){ui(r.scheduled_send);return}if(p==="session_summary"){let l=r.session||
r.session_id;if(!l)return;if(s(x=>{let A=!1,I=x.map(j=>{if((typeof j=="string"?j:j?.session_id)!==l)return j;let ne={...typeof j==
"object"?j:{},session_id:l,...r.status?{status:r.status}:{},...r.activity?{activity:r.activity}:{},...r.goal?{goal:r.goal}:
{},...r.fleet_summary?{fleet_summary:r.fleet_summary}:{},...r.fleet_work_context?{fleet_work_context:r.fleet_work_context}:
{},...r.last_user_request?{last_user_request:r.last_user_request}:{},...r.last_snippet!=null?{last_snippet:r.last_snippet}:
{},...od(r),...Wm(r)};return typeof j=="object"&&Tt(j,ne)?j:(A=!0,ne)});return A?I:x}),r.status&&V(x=>ul(x,{[l]:r.status})),
r.activity){let x=String(r.activity.kind||"idle").toLowerCase();vc({type:"status",session:l,activity:r.activity,activity_trace:r.
activity_trace,thinking:["thinking","generating","running_command","applying_patch","reading_files","working"].includes(
x),label:r.activity.label||""})}Number(r.unread_delta)>0&&l!==Pt.current&&b(x=>({...x,[l]:(x[l]||0)+Number(r.unread_delta)}));
return}if(p==="message_delta"){let l=r.session_id||r.session;if(!l||ea(l))return;let x=Pm(Nt.current[l]||null,r);if(!x.accepted)
return;In(l,x.stream,r.stream_trace||null,r.latency_trace||null,r._latency_browser_received_at_ms||null);return}if(p==="\
transcript_resync_required"){let l=r.session_id||r.session;if(!l||l!==Pt.current||ea(l))return;let x=it.current[l]||{};it.
current[l]={...x,inFlight:!1},clearTimeout(tt.current[l]),delete tt.current[l],Gt(l,{mode:"tail",source:"relay_sqlite",replace:!0});
return}if(p==="history"||p==="history_snapshot"){let l=r.session||r.session_id;if(!l||ea(l)||r.request_id&&Qn.current[l]&&
Qn.current[l]!==r.request_id)return;let x=n.find(me=>(typeof me=="object"?me.session_id:me)===l),A=gr(x);if(x&&typeof x==
"object"&&x.is_list_view&&r.messages?.length>0&&!A){f(me=>{if(!me[l])return me;let Ie={...me};return delete Ie[l],Ie});return}
!r.partial&&(!r.mode||r.mode==="full")&&ts(l);let I=r.messages||[],j=c[l]||null,D=!!Ca.current[l]&&I.length>0,ne=!D&&Oy(
p,r,j);o(me=>{let Ie=ne?uo(me[l],I):I,Ye=Ko(Gf(Ie,me[l])),bt=Wo(D?[]:me[l],Ye);return bt===me[l]?me:{...me,[l]:bt}}),u(me=>{
let Ie={...ne?me[l]||{}:{},partial:!!r.partial||!!(ne&&me[l]?.partial),loaded:ne?Math.max(Number(me[l]?.loaded||0),Number(
r.loaded_messages??I.length)||I.length,(a[l]||[]).length):Number(r.loaded_messages??I.length)||I.length,total:Number(r.total_messages??
me[l]?.total??I.length)||I.length,limit:r.limit||null,mode:ne?me[l]?.mode||"chunked":r.mode||(r.partial?"tail":"full")};
return Tt(me[l]||null,Ie)?me:{...me,[l]:Ie}}),f(me=>{if(!me[l])return me;let Ie={...me};return delete Ie[l],Ie}),D&&delete Ca.
current[l];return}if(p==="history_chunk"){let l=r.session||r.session_id;if(!l)return;let x=r.source||"relay_sqlite",A=String(
r.thread_id||""),I=Qt.current[l]||null;if(x==="codex_desktop_jsonl"){if(I?.view_state!=="archive"||!A||A!==String(I.thread_id||
""))return}else if(ea(l))return;let j=it.current[l]||{},D=r.mode!=="older"&&j.mode==="tail"&&x===(j.source||"relay_sqlit\
e")&&A===String(j.threadId||"");if(r.request_id&&kn.current[l]&&kn.current[l]!==r.request_id&&!D)return;if(r.error&&(!Array.
isArray(r.messages)||r.messages.length===0)){let qe=String(r.error?.code||""),ot=Number(j.retryAttempt||0);if(My.has(qe)&&
ot<Bf){let ct=Number(r.error?.retry_after_ms??r.retry_after_ms),Pe=Number.isFinite(ct)&&ct>0?ct:1500,pi=Math.max(25,Math.
min(250,Math.floor(Pe*.05)));clearTimeout(tt.current[l]),it.current[l]={...j,inFlight:!1,recovering:!0},u(yt=>{let Je={...yt[l]||
{},refreshing:!0};return delete Je.error,{...yt,[l]:Je}}),tt.current[l]=setTimeout(()=>{delete tt.current[l],!(Pt.current!==
l||Fe.current?.readyState!==WebSocket.OPEN)&&Gt(l,{mode:j.mode,source:j.source,replace:j.replace,beforeOffset:j.beforeOffset,
beforeId:j.beforeId,aroundId:j.aroundId,threadId:j.threadId,userInitiated:j.userInitiated,limit:j.limit,chunkBytes:j.chunkBytes,
retryAttempt:ot+1})},Math.ceil(Pe)+pi);return}f(ct=>{if(!ct[l])return ct;let Pe={...ct};return delete Pe[l],Pe}),it.current[l]=
{...it.current[l]||{},inFlight:!1},clearTimeout(tt.current[l]),delete tt.current[l],x==="codex_desktop_jsonl"&&r.view_state===
"unavailable"&&Dt(l,ct=>({...ct||{},view_state:"unavailable",read_only:!0,retryable:!0,completed_at:Date.now(),pollability:r.
pollability||ct?.pollability||null,message:String(r.error?.message||r.error||"Open this chat in Codex Desktop once, then\
 retry.")})),u(ct=>({...ct,[l]:{...ct[l]||{},error:String(r.error?.message||r.error||"Transcript history could not be lo\
aded.")}}));return}let ne=r.mode==="older"?"older":r.mode==="around"?"around":"tail",me=r.cursor||{},Ie=me.next_before_offset??
null,Ye=me.next_before_id??null,bt=!!(r.partial&&(Ie!=null||Ye!=null)),Lt=Array.isArray(r.messages)?r.messages:[],Nn=ne===
"around"||ne==="tail"&&r.replace===!0,ut=(Nn?Lt:pn(a[l],Lt,ne)).length;o(qe=>{let ot=Ko(Gf(Nn?aa(qe[l],Lt,j,r.source):pn(
qe[l],Lt,ne),qe[l])),ct=Wo(qe[l],ot);return ct===qe[l]?qe:{...qe,[l]:ct}}),u(qe=>{let ot={...qe[l]||{},partial:bt,loaded:Nn?
Number(r.loaded_messages??ut)||ut:Math.max(Number(qe[l]?.loaded||0),Number(r.loaded_messages||0),ut),total:Number(r.total_messages||
qe[l]?.total||ut)||ut,limit:null,mode:"chunked",source:r.source||"native",thread_id:A||null,view_state:r.view_state||I?.
view_state||null,pollability:r.pollability||I?.pollability||null,cursor:me,bytes_total:me.total_bytes||0,refreshing:!1};
return delete ot.error,Tt(qe[l]||null,ot)?qe:{...qe,[l]:ot}}),f(qe=>{if(!qe[l])return qe;let ot={...qe};return delete ot[l],
ot}),it.current[l]={...it.current[l]||{},inFlight:!1,nextBeforeOffset:Ie,nextBeforeId:Ye},clearTimeout(tt.current[l]),delete tt.
current[l];return}if(p==="history_delta"){let l=r.session||r.session_id;if(!l||ea(l)||r.request_id&&Qn.current[l]&&Qn.current[l]!==
r.request_id)return;let A=(Array.isArray(r.messages)?r.messages:Array.isArray(r.events)?r.events:[]).map(j=>j?.message||
j).filter(Boolean),I=pn(a[l],A,"tail");o(j=>{let D=Ko(pn(j[l],A,"tail")),ne=Wo(j[l],D);return ne===j[l]?j:{...j,[l]:ne}}),
u(j=>{let D=j[l]||{},ne=Math.max(Number(D.loaded||0),I.length),me=Math.max(Number(r.total_messages||0),Number(D.total||0),
ne);return{...j,[l]:{...D,loaded:ne,total:me,last_sequence:Number(r.last_sequence||D.last_sequence||0),mode:D.mode||"chu\
nked"}}}),f(j=>{if(j[l]?.requestId!==r.request_id)return j;let D={...j};return delete D[l],D});return}if(p==="status"||p===
"proxy_status"||p==="session_status"){let l=r.session||r.session_id;if(!l)return;let x=r.activity?.kind||"",A=r.thinking||
["thinking","generating","running_command","applying_patch","reading_files","working"].includes(x);Im(Nt.current[l],r.activity||
(A?null:{kind:"idle"}),A)&&ts(l);let I=r.label||r.activity?.label||(x==="idle"?"":"Thinking"),j=A||r.activity?{kind:r.activity?.
kind||(A?"thinking":"working"),label:I,updatedAt:r.activity?.updated_at||null,observed_at:r.activity?.observed_at||null,
startedAt:r.activity?.started_at||null,interruptHint:r.activity?.interrupt_hint||"",goal:r.activity?.goal||null,goal_run:r.
activity?.goal_run||null,...r.activity?.goal_projection?{goal_projection:r.activity.goal_projection}:{},...r.activity?.goal_tombstone?
{goal_tombstone:r.activity.goal_tombstone}:{},thinking:r.activity?.thinking||null,connection:r.activity?.connection||null,
connection_tombstone:r.activity?.connection_tombstone||null,interruption:r.activity?.interruption||null,interruption_tombstone:r.
activity?.interruption_tombstone||null,current:r.activity?.current||null,step:r.activity?.step||null,usage:r.activity?.usage||
null,task_list:r.activity?.task_list||null,context_card:r.activity?.context_card||null,work_context:r.activity?.work_context||
null,thinkingContent:r.activity?.thinking?.text||r.activity?.thinkingContent||"",transport:pf(r.activity_trace)}:!1;if(A){
clearTimeout(Wn.current[l]),h(ne=>Object.is(ne[l],I)?ne:{...ne,[l]:I}),L(ne=>zi(ne,{[l]:j},{authoritative:!0}));let D=r.
activity?.thinking?.text??r.thinking_content??r.activity?.thinkingContent;D!=null&&C(ne=>Object.is(ne[l],D)?ne:{...ne,[l]:D})}else
x==="idle"?(clearTimeout(Wn.current[l]),h(D=>D[l]===!1?D:{...D,[l]:!1}),L(D=>zi(D,{[l]:j},{authoritative:!0})),C(D=>D[l]===
""?D:{...D,[l]:""})):Object.prototype.hasOwnProperty.call(r.activity||{},"goal")||r.activity?.goal_projection||r.activity?.
goal_tombstone||r.activity?.task_list||r.activity?.step||r.activity?.usage||r.activity?.connection||r.activity?.interruption||
r.activity?.interruption_tombstone?(clearTimeout(Wn.current[l]),h(D=>D[l]===!1?D:{...D,[l]:!1}),L(D=>zi(D,{[l]:j},{authoritative:!0}))):
(clearTimeout(Wn.current[l]),Wn.current[l]=setTimeout(()=>{h(D=>D[l]===!1?D:{...D,[l]:!1}),L(D=>D[l]===!1?D:{...D,[l]:!1}),
C(D=>D[l]===""?D:{...D,[l]:""})},4e3));yc(r,l);return}if(p==="permission_prompt"){if(r.kind==="question")return;let l=r.
session_id||r.session;l&&Q(x=>({...x,[l]:{...r,received_at:Date.now()}}));return}if(p==="question_prompt"){let l=r.session_id||
r.session,x=!r.lifecycle||["open","submitting"].includes(r.lifecycle);if(!l||!dl(r))return;if(!x||xd(yn.current,r)){x||Uf(
yn.current,r),Q(A=>{let I=A[l];if(I?.prompt_id!==r.prompt_id||I?.generation!==r.generation)return A;let{[l]:j,...D}=A;return D});
return}Q(A=>{let I=A[l],j=I?.prompt_id===r.prompt_id&&I?.generation===r.generation,D={...j?I:{},...r,received_at:j?I.received_at:
Date.now(),...r.lifecycle==="submitting"?{submitting_choice_id:I?.submitting_choice_id||"question_answers"}:{}};return j&&
Tt(I,D)?A:{...A,[l]:D}});return}if(p==="question_prompt_state"){let l=r.session_id||r.session;if(!l||!dl(r))return;["ope\
n","submitting"].includes(r.lifecycle)&&!xd(yn.current,r)?Q(x=>{let A=x[l];if(!(A?.prompt_id===r.prompt_id&&A?.generation===
r.generation))return x;let j={...A,...r,type:"question_prompt",received_at:A.received_at,submitting_choice_id:r.lifecycle===
"submitting"?A.submitting_choice_id||"question_answers":null};return Tt(A,j)?x:{...x,[l]:j}}):["open","submitting"].includes(
r.lifecycle)||(Uf(yn.current,r),Q(x=>{let A=x[l];if(A?.prompt_id!==r.prompt_id||A?.generation!==r.generation)return x;let{
[l]:I,...j}=x;return j}));return}if(p==="permission_prompt_expired"){let l=r.session_id||r.session;l&&Q(x=>{let{[l]:A,...I}=x;
return I});return}if(p==="session_error_prompt"){let l=r.session_id||r.session;l&&he(x=>({...x,[l]:{...r,received_at:Date.
now()}}));return}if(p==="session_error_prompt_cleared"){let l=r.session_id||r.session;l&&he(x=>{let{[l]:A,...I}=x;return I});
return}if(p==="chat_list"){let l=r.session_id||r.session;l&&z(x=>({...x,[l]:r.chats||[]}));return}if(p==="branch_list"){
let l=r.session_id||r.session;l&&F(x=>({...x,[l]:{branches:r.branches||[],current:r.current||""}}));return}if(p==="threa\
d_list"){let l=r.session_id||r.session;if(l){let x=r.threads||[],A=x.find(ne=>ne?.active),I=String(A?.cache_key||""),j=xa.
current[l]||"",D=Qt.current[l]||null;if((!D||D.view_state==="native_active")&&I&&j&&I!==j&&(Ca.current[l]=I,mn(l)),I&&(xa.
current[l]=I),ie(ne=>({...ne,[l]:x})),D&&D.view_state!=="loading"){let ne=x.find(me=>String(me?.id||"")===String(D.thread_id||
"")||String(me?.cache_key||"")===String(D.thread_id||""));if(!ne)Dt(l,{...D,view_state:"unavailable",read_only:!0,retryable:!0,
completed_at:Date.now(),message:"This chat is no longer in the current Codex Desktop inventory. Refresh the list and ret\
ry."});else if(ne.active&&D.view_state!=="native_active")Ms(l),mn(l,{preserveQueued:!0}),Dt(l,{...D,thread_id:String(ne.
id||D.thread_id),title:ne.title||D.title,view_state:"native_active",history_source:"relay_sqlite",read_only:!1,retryable:!1,
pollability:ne.pollability||D.pollability,completed_at:Date.now(),message:"Showing the natively active Codex Desktop cha\
t."}),Gt(l,{mode:"tail",source:"relay_sqlite",replace:!0});else if(!ne.active&&ne.view_state!==D.view_state){let me=ne.view_state===
"archive"?"archive":"unavailable";Ms(l),mn(l,{preserveQueued:!0}),Dt(l,{...D,thread_id:String(ne.id||D.thread_id),title:ne.
title||D.title,view_state:me,history_source:me==="archive"?"codex_desktop_jsonl":null,read_only:!0,retryable:me==="unava\
ilable",pollability:ne.pollability||D.pollability,completed_at:Date.now(),message:me==="archive"?"Showing the immutable \
native archive. This chat is read-only until it is active in Codex Desktop.":ne.pollability?.required_action||"Open this\
 chat in Codex Desktop once, then retry."}),me==="archive"&&Gt(l,{mode:"tail",source:"codex_desktop_jsonl",threadId:String(
ne.id||D.thread_id),replace:!0})}else Dt(l,{...D,title:ne.title||D.title,pollability:ne.pollability||D.pollability})}}return}
if(p==="duplicate_proxy_alarm"){Vr(Array.isArray(r.duplicate_sessions)?r.duplicate_sessions:[]);return}if(p==="nightly_v\
alidation_status"){Ws(Array.isArray(r.failures)?r.failures:[]),r.revalidation_program_health&&no(r.revalidation_program_health),
r.operator_dogfood_health&&Tn(r.operator_dogfood_health);return}if(p==="app_update_validation_status"){to(r.validation||
null);return}if(p==="harness_revalidation_status"){no(r.program_health||null);return}if(p==="operator_dogfood_status"){Tn(
r.program_health||null);return}if(p==="skill_list"){let l=r.session_id||r.session;l&&Te(x=>({...x,[l]:{installed:r.installed||
[],recommended:r.recommended||[]}}));return}if(p==="codex_automation_view"){let l=r.session_id||r.session;l&&St(x=>({...x,
[l]:r.view||null}));return}if(p==="terminal_output"){let l=r.session_id||r.session;l&&Ee(x=>({...x,[l]:r.entries||[]}));
return}if(p==="file_changes"){let l=r.session_id||r.session;l&&ae(x=>({...x,[l]:r.entries||[]}));return}if(p==="director\
y_listing"){let l=r.session_id||r.session;l&&Un(x=>({...x,[l]:{path:r.path,entries:r.entries||[]}}));return}if(p==="file\
_content"){let l=r.session_id||r.session;l&&ks(x=>Hs(x,`${l}:${r.path}`,{path:r.path,content:r.content,truncated:r.truncated}));
return}if(p==="agent_config"){let l=r.session_id||r.session;if(!l)return;xt(l,r),be(x=>{let A=x[l]||{},I={...A,...r};return(!Array.
isArray(r.available_models)||r.available_models.length===0)&&Array.isArray(A.available_models)&&A.available_models.length>
0&&(I.available_models=A.available_models),Object.values(Be.current).forEach(j=>{j.sessionId!==l||!["pending","awaiting_\
config"].includes(j.status)||(I[j.configKey]=j.requestedValue)}),Le.current={...Le.current,[l]:I},{...x,[l]:I}});return}
if(p==="agent_control_result"){let l=r.session_id||r.session;if(r.request_id){on(I=>Hs(I,r.request_id,{...r,received_at:Date.
now()}));let x=r.command==="switch_thread"?$t.current[r.request_id]:null;if(x){let I=l||x.sessionId;if(ta(x.sessionId),delete $t.
current[r.request_id],r.result==="ok"){let j=r.details||{},D=String(j.thread_id||"");if(!D||D!==x.threadId)Dt(I,ne=>({...ne||
{},view_state:"error",retryable:!0,completed_at:Date.now(),error_code:"thread_identity_mismatch",message:"Codex Desktop \
returned a different chat identity. Retry without changing the native app."}));else{let ne={...j,thread_id:D,view_state:j.
view_state||"unavailable",selection_mode:"client_local_readonly",started_at:x.startedAt,completed_at:Date.now()};Dt(I,ne),
Ms(I),mn(I,{preserveQueued:!0}),ne.view_state==="archive"?Gt(I,{mode:"tail",source:"codex_desktop_jsonl",threadId:D,replace:!0}):
ne.view_state==="native_active"&&Gt(I,{mode:"tail",source:"relay_sqlite",replace:!0})}}else{let j=typeof r.error=="objec\
t"&&r.error?r.error:{};Dt(I,D=>({...D||{},view_state:"error",retryable:r.retryable!==!1&&j.retryable!==!1,completed_at:Date.
now(),error_code:j.code||"thread_view_failed",native_mutated:!1,message:j.message||String(r.error||"Codex Desktop chat a\
vailability could not be resolved.")}))}}let A=Object.entries(Be.current).find(([,I])=>I.requestId===r.request_id&&I.sessionId===
l&&["pending","awaiting_config"].includes(I.status));if(A){let[I,j]=A;r.result==="failed"?mr(I,r.error?.message||r.error||
"The agent rejected this setting."):r.result==="ok"&&(Ta(I,{...j,status:"awaiting_config"}),l&&qn(l))}}l&&r.result==="ok"&&
r.command==="new_thread"&&mn(l),l&&r.result==="ok"&&["new_thread","switch_thread"].includes(r.command)&&yr(l),l&&r.result===
"ok"&&r.command==="switch_chat"&&is(l),["permission_response","question_response"].includes(r.command)&&l&&(r.result==="\
ok"?Q(x=>{if(x[l]?.request_id!==r.request_id)return x;let{[l]:A,...I}=x;return I}):r.result==="failed"&&Q(x=>x[l]?.request_id===
r.request_id?{...x,[l]:{...x[l],submitting_choice_id:null,error:r.error?.message||"Permission response failed"}}:x)),r.command===
"error_prompt_action"&&l&&r.result==="failed"&&he(x=>x[l]?{...x,[l]:{...x[l],submitting_action_id:null,error:r.error?.message||
"Error prompt action failed"}}:x),r.command==="file_change_response"&&l&&r.result==="ok"&&os(l);return}if(p==="message_a\
ccepted"){let l=r.client_message_id,x=r.session_id||r.session;l&&x&&_t(l,x);let A=ss(l,r.delivery_attempt);if(l&&!A.accepted)
return;let I=["accepted","delivered","agent_started","failed"].includes(r.status)?r.status:"accepted",j=I==="accepted"&&
r.launch_accepted_at?"launch_accepted":I;if(l&&j==="failed"){Ra(l,r.failure_reason||r.failure_code||"Send failed",x,{network:!0,
delivery_attempt:r.delivery_attempt,failure_code:r.failure_code,failure_reason:r.failure_reason,failure_native_attempted:r.
failure_native_attempted,failure_retryable:r.failure_retryable});return}if(l){if(!Zt(l,j,{force:A.advanced||r.retry_restarted===
!0}))return;j==="accepted"?Pn(l,"accepted","Relay accepted the message, but native delivery timed out."):j==="launch_acc\
epted"?Pn(l,"launch_accepted","The native launch was accepted, but no native user turn was observed."):j==="delivered"?Pn(
l,"delivered","Message reached the agent, but agent activity did not start in time."):ns(l)}l&&Ma(l,x,D=>Di({...D,...r.created_at!=
null?{created_at:r.created_at}:{},...r.timestamp!=null?{timestamp:r.timestamp}:{},...r.ts!=null?{ts:r.ts}:{},...r.launch_accepted_at!=
null?{_launchAcceptedAt:r.launch_accepted_at}:{},status:j==="launch_accepted"?"accepted":j,_cid:l,_deliveryAttempt:A.attempt,
_delivered:j==="delivered"||j==="agent_started",_agentStarted:j==="agent_started",failure_code:null,failure_reason:null,
failure_native_attempted:null,failure_retryable:null,_sendError:null}));return}if(p==="proxy_send_result"&&r.result==="l\
aunch_accepted"){let l=r.client_message_id,x=r.session_id||r.session;l&&x&&_t(l,x);let A=ss(l,r.delivery_attempt);if(l&&
!A.accepted)return;l&&Zt(l,"launch_accepted",{force:A.advanced})&&(Pn(l,"launch_accepted","The native launch was accepte\
d, but no native user turn was observed."),Ma(l,x,I=>({...I,status:"accepted",_cid:l,_deliveryAttempt:A.attempt,_launchAcceptedAt:r.
accepted_at||new Date().toISOString(),_sendError:null})));return}if(p==="message_delivered"||p==="proxy_send_result"&&r.
result==="delivered"){let l=r.client_message_id,x=r.session_id||r.session;l&&x&&_t(l,x);let A=ss(l,r.delivery_attempt);if(l&&
!A.accepted)return;l&&Zt(l,"delivered",{force:A.advanced})&&Pn(l,"delivered","Message reached the agent, but agent activ\
ity did not start in time."),l&&Ma(l,x,I=>({...I,status:"delivered",_cid:l,_deliveryAttempt:A.attempt,_delivered:!0,failure_code:null,
failure_reason:null,failure_native_attempted:null,failure_retryable:null,_sendError:null}));return}if(p==="agent_started"){
let l=r.client_message_id,x=r.session_id||r.session;l&&x&&_t(l,x);let A=ss(l,r.delivery_attempt);if(l&&!A.accepted)return;
l&&(ns(l),Zt(l,"agent_started",{force:A.advanced})),x&&Aa(x,l||null),l&&Ma(l,x,I=>({...I,status:"agent_started",_cid:l,_deliveryAttempt:A.
attempt,_delivered:!0,_agentStarted:!0,failure_code:null,failure_reason:null,failure_native_attempted:null,failure_retryable:null,
_sendError:null}));return}if(p==="message_failed"||p==="proxy_send_result"&&r.result==="failed"){let l=r.client_message_id,
x=r.session_id||r.session,A=ss(l,r.delivery_attempt);if(l&&!A.accepted)return;if(x&&ts(x),l){let I=r.reason||r.message||
r.error?.message||"Send failed";Ra(l,I,x,{network:!0,delivery_attempt:r.delivery_attempt,failure_code:r.failure_code||r.
error?.code,failure_reason:I,failure_native_attempted:r.failure_native_attempted??r.error?.native_attempted,failure_retryable:r.
failure_retryable??r.error?.retryable})}return}if(p==="message_queued"){let l=r.client_message_id,x=r.session_id||r.session;
if(l){let A=ss(l,r.delivery_attempt);if(!A.accepted)return;let I=Array.isArray(r.content_blocks)?r.content_blocks:[],j=I.
find(D=>D?.type==="queued_message");if(!Zt(l,"busy_queued",{force:A.advanced}))return;ns(l),x&&W(D=>({...D,[x]:[...(D[x]||
[]).filter(ne=>ne.cid!==l),{cid:l,content:j?.content??r.content,content_blocks:I,queuedAt:r.queued_at,delivery_attempt:A.
attempt}]}))}return}if(p==="queue_delivered"){let l=r.client_message_id,x=r.session_id||r.session;if(l){if(!ss(l,r.delivery_attempt).
accepted||!Zt(l,"accepted",{force:!0}))return;Pn(l,"accepted","Queued message left the relay, but native delivery timed \
out."),x&&W(I=>({...I,[x]:(I[x]||[]).filter(j=>j.cid!==l)}))}return}if(p==="steer_result"){let l=r.client_message_id,x=r.
session_id||r.session;l&&(r.result==="ok"?(Zt(l,"steered"),Pn(l,"steered","Message was steered, but agent activity did n\
ot start in time.")):Ra(l,r.error?.message||r.error||"The desktop proxy rejected the message.",x),x&&W(A=>({...A,[x]:(A[x]||
[]).filter(I=>I.cid!==l)})));return}if(p==="native_queue"){let l=r.session_id||r.session,x=r.items||[];l&&W(A=>{let I=(A[l]||
[]).filter(D=>D.cid&&D.cid.startsWith("cmsg-")),j=x.map((D,ne)=>({cid:`native-${ne}`,content:D.content_blocks?.find(me=>me?.
type==="queued_message")?.content??D.text,content_blocks:Array.isArray(D.content_blocks)?D.content_blocks:[],native:!0,nativeIndex:D.
index,status:D.state||"queued"}));return{...A,[l]:[...I,...j]}});return}if(p==="rate_limit_active"){let l=r.session_id||
r.session,x=r.percent_used??null,A=x==null||x>=100;l&&s(I=>I.map(j=>(typeof j=="string"?j:j?.session_id)===l?{...typeof j==
"object"?j:{},session_id:l,rate_limited_until:r.retry_after_hint||(A?"unknown":null),rate_limit_active:A,percent_used:x}:
j));return}if(p==="rate_limit_cleared"){let l=r.session_id||r.session;l&&s(x=>x.map(A=>(typeof A=="string"?A:A?.session_id)===
l?{...typeof A=="object"?A:{},session_id:l,rate_limited_until:null,rate_limit_active:!1,percent_used:null}:A));return}if(p!==
"session_launching"){if(p==="session_launch_ack"){let l=r.request_id,x=r.session_id||r.session;l&&J(A=>{let{[l]:I,...j}=A;
return j}),x&&Ce(x);return}if(p==="session_launch_failed"){let l=r.request_id,x=r.reason||r.error||"Launch failed";l&&J(
A=>Hs(A,l,{...A[l],status:"failed",error:x}));return}if(p==="session_closed"){let l=r.session||r.session_id;l&&s(x=>x.filter(
A=>(typeof A=="string"?A:A?.session_id)!==l));return}if(p==="message"||p==="proxy_message"||p==="message_event"){let l=r.
session||r.session_id||r.message?.session_id,x=r.role||r.message?.role,A=r.content||r.message?.content,I=Array.isArray(r.
content_blocks)?r.content_blocks:Array.isArray(r.message?.content_blocks)?r.message.content_blocks:null,j=r.client_message_id||
r.client_msg_id||r.message?.client_message_id||r.message?.client_msg_id||null,D=r.status||r.message?.status||null,ne=r.delivery_attempt??
r.message?.delivery_attempt??null,me=r.failure_code||r.message?.failure_code||null,Ie=r.failure_reason||r.message?.failure_reason||
null,Ye=r.failure_native_attempted??r.message?.failure_native_attempted??null,bt=r.failure_retryable??r.message?.failure_retryable??
null,Lt=r.source_message_id||r.message?.source_message_id||null,Nn=r.native_source_id||r.message?.native_source_id||null,
At=r.source_cursor||r.message?.source_cursor||null,ut=r.source||r.message?.source||null,qe=r.server_message_id??r.message?.
server_message_id??null,ot=r.sequence??r.message?.sequence??null,ct=D==="delivered"||D==="agent_started";if(!l||!x||!A||
ea(l))return;x==="assistant"&&ts(l);let Pe=Di({role:x,content:A,...I?{content_blocks:I}:{},...Lt?{source_message_id:Lt}:
{},...Nn?{native_source_id:Nn}:{},...At?{source_cursor:At}:{},...ut?{source:ut}:{},...qe!=null?{server_message_id:qe}:{},
...j?{client_message_id:j}:{},...D?{status:D}:{},...ne!=null?{delivery_attempt:ne}:{},...me?{failure_code:me}:{},...Ie?{
failure_reason:Ie}:{},...Ye!=null?{failure_native_attempted:Ye}:{},...bt!=null?{failure_retryable:bt}:{},...ot!=null?{sequence:ot}:
{},...(r.created_at??r.message?.created_at)!=null?{created_at:r.created_at??r.message?.created_at}:{},...(r.timestamp??r.
message?.timestamp)!=null?{timestamp:r.timestamp??r.message?.timestamp}:{},...(r.ts??r.message?.ts)!=null?{ts:r.ts??r.message?.
ts}:{}});o(yt=>{let Je=yt[l]||[];if(x==="user"){let vt=Je.findIndex(Ot=>Ot._optimistic&&(j&&Ot._cid===j||!j&&Ot.content===
A));if(vt>=0){let Ot=[...Je],en=Je[vt];return Ot[vt]=Di({...en,...Pe,_delivered:en._delivered||ct,_agentStarted:en._agentStarted||
D==="agent_started",_cid:en._cid,_optimistic:en._optimistic,_deliveryAttempt:ne??en._deliveryAttempt??1,_sendError:D==="\
failed"?Ie||me||en._sendError||"Send failed":en._sendError}),{...yt,[l]:Ko(Ot)}}}let yo=tr(Pe);if(yo){let vt=Je.findIndex(
Ot=>tr(Ot)===yo);if(vt>=0){if(Cd(Je[vt],Pe))return yt;let Ot=Array.isArray(Je[vt]?.content_blocks)&&Je[vt].content_blocks.
some(Wt=>Wt?.type==="memory_citation"),en=Array.isArray(Pe?.content_blocks)&&Pe.content_blocks.some(Wt=>Wt?.type==="memo\
ry_citation");if(Ot&&!en)return yt;let jn=[...Je];return jn[vt]={...Je[vt],...Pe},{...yt,[l]:Wo(Je,jn)}}}else if(Je.some(
vt=>vt.role===x&&vt.content===A))return yt;let Xl=Ko([...Je,{...Pe,...x==="user"&&j?{_cid:j}:{},...x==="user"&&ne!=null?
{_deliveryAttempt:ne}:{},...x==="user"&&D==="failed"?{_sendError:Ie||me||"Send failed"}:{},_delivered:x==="user"&&ct,_agentStarted:x===
"user"&&D==="agent_started"}]);return{...yt,[l]:Wo(Je,Xl)}}),x==="assistant"&&l!==Pt.current&&b(yt=>({...yt,[l]:(yt[l]||
0)+1}));let pi=od(r);Object.keys(pi).length>0&&s(yt=>yt.map(Je=>(typeof Je=="string"?Je:Je?.session_id)===l?{...typeof Je==
"object"?Je:{},session_id:l,...pi}:Je)),di(r,l);return}}}}return Xn.current=vc,{sessions:n,messages:a,provisionalStreams:Fl,
historyMeta:c,historyLoading:m,connected:v,connectionHealth:R,unread:T,setUnread:b,thinking:w,thinkingContent:M,activities:_,
health:P,deliveryStates:Z,launchStates:ue,justLaunched:pe,setJustLaunched:Ce,permissionPrompts:se,respondToPrompt:_r,errorPrompts:de,
respondToErrorPrompt:ri,interruptSession:br,controlGoal:po,agentConfigs:xe,configControlStates:G,requestAgentConfig:qn,setAgentModel:rs,
setAgentEffort:Gl,setAgentPermissionMode:ii,setAutoApprovePermissions:gc,setAntigravityMode:oi,setCodexConfig:Wl,newThread:mo,
openPanel:Ea,openNativeWindow:ci,requestChatList:is,switchChat:fo,newChat:ho,chatLists:E,requestThreadList:yr,switchThread:La,
threadLists:fe,threadViews:ye,switchWorkspace:qa,requestTerminalOutput:$s,sendTerminalInput:Oa,terminalOutputs:ke,requestFileChanges:os,
respondToFileChange:Ia,fileChanges:He,sendAttachment:Dn,send:Se,sendToSession:vr,steerMessage:bo,discardQueuedMessage:bc,
editQueuedMessage:Vl,queuedMessages:ge,scheduledSends:te,scheduleSend:Yl,cancelScheduledSend:wr,refreshScheduledSends:Da,
launchSession:Kl,resumeSession:_c,closeSession:_o,activeSessionRef:Pt,restoreCachedTranscript:uc,setSessionSubscriptions:Sn,
workspaces:ee,branchLists:Re,requestBranchList:Es,switchBranch:mt,createBranch:go,skillLists:re,requestSkillList:ls,automationViews:Ke,
showCodexAutomation:Pa,controlResults:vs,directoryListings:Rn,requestDirectoryListing:cs,fileContents:ws,requestFileContent:ra,
requestHistory:ai,requestHistoryChunk:Gt,duplicateProxyAlarms:Zi,nightlyValidationFailures:rr,latestAppUpdateValidation:eo,
revalidationProgramHealth:ic,operatorDogfoodHealth:Pl,providerUsage:ql,providerUsageRefreshReceipt:so,requestProviderUsageRefresh:zl,
setProviderUsageWatching:pc,providerUsageResetReceipt:oc,consumeProviderUsageResetCredit:Ul,providerUsageCostDetail:$n,requestProviderUsageCostDetail:ei,
hostResources:ao,hostResourceError:ya,hostResourceHistory:Dl,hostResourceDetails:jl,hostResourceSubscription:Bl,subscribeHostResources:mc,
unsubscribeHostResources:fc,requestHostResourceRefresh:co,clearHostResources:lr,semanticNotifications:cc,sessionAliases:Hl}}var Ng=vm(Zf());function jy(e){return typeof e=="string"?e:e?.session_id||e?.id||""}function eh(e){let t=Number(e?.pin_order);return Number.
isSafeInteger(t)&&t>0?t:0}function By(e){return e?.pinned===!0||eh(e)>0}function th(e,t={}){let n=[],s=[];for(let a of Array.
isArray(e)?e:[]){let o=jy(a),c=o?t[o]:null;By(c)?n.push({session:a,id:o,order:eh(c)}):s.push(a)}return n.sort((a,o)=>(a.
order||Number.MAX_SAFE_INTEGER)-(o.order||Number.MAX_SAFE_INTEGER)||a.id.localeCompare(o.id)),{pinned:n.map(a=>a.session),
unpinned:s}}var Md="remote-agent-chat:group-aliases:v1",fl=Object.freeze({"^remoteagent":"Remote Agent Chat"}),Fy=new Set(["thinking",
"generating","running_command","applying_patch","reading_files","working"]),Hy=new Set(["validator","test","fixture","pr\
obe","e2e","throwaway"]),zy=[/(?:^|\/)cursor-test(?:\/|$)/i,/(?:^|\/)remote-agent-(?=[^/]*(?:-(?:test|fixture|probe|e2e|validator|validation|throwaway|switch-anchor)(?:-|\/|$)))[^/]+(?:\/|$)/i,
/(?:^|\/)rac-(?=[^/]*(?:-(?:test|fixture|probe|e2e|validator|validation|throwaway)(?:-|\/|$)))[^/]+(?:\/|$)/i,/(?:^|\/)reply-with-exactly-rac-[^/]*(?:\/|$)/i];
function bs(e){return typeof e=="string"?e:e?.session_id||e?.id||""}function Rd(e){if(!e||typeof e!="object"||e.is_test_session===
!1)return!1;if(e.is_test_session===!0||e.is_test_session===1||e.is_test_session==="true"||e.validator_session===!0||Hy.has(
String(e.session_kind||e.session_class||"").trim().toLowerCase()))return!0;let t=String(e.workspace_path||e.project_root||
"").trim().replace(/\\/g,"/").replace(/\/+$/g,"").toLowerCase();if(zy.some(s=>s.test(t)))return!0;let n=[e.workspace_name,
e.display_name,e.window_title,e.chat_title].filter(Boolean).join("/").toLowerCase();return/(?:^|[\s/_-])(?:validator|fixture|throwaway)(?:$|[\s/_-])/i.
test(n)}function Hr(e){if(typeof e=="number"&&Number.isFinite(e))return e;let t=Date.parse(String(e||""));return Number.
isFinite(t)?t:0}function Uy(e){return(Array.isArray(e)?e:[]).reduce((t,n)=>Math.max(t,Hr(n?.ts??n?.timestamp??n?.created_at??
n?.updated_at)),0)}function ah(e,t={}){let n=bs(e),s=t.activities&&typeof t.activities=="object"?t.activities:{},o=Object.
prototype.hasOwnProperty.call(s,n)?s[n]||{kind:"idle"}:(typeof e=="object"?e.activity:null)||{kind:"idle"},u=!!t.thinking?.[n]&&
!o.generating?{...o,kind:Fy.has(String(o.kind||"").toLowerCase())?o.kind:"thinking",generating:!0}:o,m=!!t.pendingPrompts?.[n]||
!!t.errorPrompts?.[n]||typeof e=="object"&&e.rate_limit_active===!0;return tl(u,m,{connected:t.connected,health:t.health?.[n]||
t.healthMap?.[n],nowMs:t.nowMs,freshnessMs:t.freshnessMs,requireFreshness:t.requireFreshness===!0})}function rh(e,t={}){
let n=[],s=[],a={};for(let o of Array.isArray(e)?e:[]){let c=bs(o);if(!c)continue;let u=ah(o,t);a[c]=u,(Ir(u)?n:s).push(
o)}return{working:n,nonWorking:s,states:a}}function ih(e={}){return{...e,requireFreshness:!1}}function Td(e,t={}){let n=Array.
isArray(e)?e:[],s=n.map(bs).filter(Boolean);return{version:1,revision:Number(t.revision||0),sessionOrder:s,fallbackSessionById:Object.
fromEntries(n.map(a=>[bs(a),a]).filter(([a])=>a)),pendingEntrySinceById:{},missingSinceById:{}}}function oh(e,t,n={}){let s=Array.
isArray(t)?t:[],a=Object.fromEntries(s.map(P=>[bs(P),P]).filter(([P])=>P)),o=Object.keys(a),c=e?.version===1?e:Td(s,n),u=Array.
isArray(c.sessionOrder)?c.sessionOrder:[],m=o.length!==u.length||o.some(P=>!u.includes(P));if(m&&n.freezeStructure)return{
ledger:c,sessions:u.map(P=>a[P]||c.fallbackSessionById?.[P]).filter(Boolean),structuralChanged:!0,deferred:!0};let f=Number.
isFinite(Number(n.nowMs))?Number(n.nowMs):Date.now(),v=Math.max(0,Number(n.entryConfirmMs)||0),k=Math.max(0,Number(n.exitGraceMs)||
0),R=n.immediateExitIds instanceof Set?n.immediateExitIds:new Set(n.immediateExitIds||[]),S=new Set(o),T={},b={},w=new Set;
for(let P of u){if(S.has(P)){w.add(P);continue}if(R.has(P)||k<=0)continue;let V=Number(c.missingSinceById?.[P])||f;f-V<k&&
(b[P]=V,w.add(P))}for(let P of o){if(w.has(P))continue;if(u.includes(P)||v<=0){w.add(P);continue}let V=Number(c.pendingEntrySinceById?.[P])||
f;f-V>=v?w.add(P):T[P]=V}let h=u.filter(P=>w.has(P));for(let P of o)w.has(P)&&!h.includes(P)&&h.push(P);let M=h.length!==
u.length||h.some((P,V)=>u[V]!==P),C=JSON.stringify(T)!==JSON.stringify(c.pendingEntrySinceById||{})||JSON.stringify(b)!==
JSON.stringify(c.missingSinceById||{}),_=Object.fromEntries(h.map(P=>[P,a[P]||c.fallbackSessionById?.[P]]).filter(([,P])=>!!P));
if(!M&&!C)return{ledger:c,sessions:u.map(P=>a[P]||c.fallbackSessionById?.[P]).filter(Boolean),structuralChanged:!1,deferred:!1};
let L={version:1,revision:Number(c.revision||0)+(M?1:0),sessionOrder:h,fallbackSessionById:_,pendingEntrySinceById:T,missingSinceById:b};
return{ledger:L,sessions:h.map(P=>a[P]||L.fallbackSessionById[P]).filter(Boolean),structuralChanged:M,deferred:m&&!M}}function Gy(e,t={}){
let n=bs(e),s=t.activities?.[n]||(typeof e=="object"?e.activity:null)||null,a=ah(e,t),o=a==="needs_attention",c=Ir(a),u=Math.
max(Hr(t.lastMessageAt?.[n]),Uy(t.messages?.[n])),m=Math.max(Hr(s?.updatedAt??s?.updated_at),Hr(s?.startedAt??s?.started_at),
Hr(typeof e=="object"?e.last_message_at:null),Hr(typeof e=="object"?e.last_seen_at:null),Hr(typeof e=="object"?e.created_at:
null));return{id:n,tier:o?2:c&&t.rankWorking!==!1?1:0,recency:u||m}}function ch(e,t={}){let n=new Map((t.previousGroupOrder||
[]).map((u,m)=>[u,m])),s=new Map((t.previousSessionOrder||[]).map((u,m)=>[u,m])),a=(u,m)=>n.has(u)?n.get(u):n.size+m,o=(u,m)=>s.
has(u)?s.get(u):s.size+m,c=(Array.isArray(e)?e:[]).map((u,m)=>{let f=(u.sessions||[]).map((v,k)=>({session:v,sessionIndex:k,
...Gy(v,t)})).sort((v,k)=>k.tier-v.tier||k.recency-v.recency||o(v.id,v.sessionIndex)-o(k.id,k.sessionIndex)||v.id.localeCompare(
k.id));return{group:{...u,sessions:f.map(v=>v.session)},groupIndex:m,tier:f.reduce((v,k)=>Math.max(v,k.tier),0),recency:f.
reduce((v,k)=>Math.max(v,k.recency),0)}});return c.sort((u,m)=>m.tier-u.tier||m.recency-u.recency||a(u.group.key,u.groupIndex)-
a(m.group.key,m.groupIndex)||u.group.key.localeCompare(m.group.key)),c.map(u=>u.group)}function lh(e){return{groupOrder:(e||
[]).map(t=>t.key),sessionOrder:(e||[]).flatMap(t=>(t.sessions||[]).map(bs))}}function uh(e){return(e||[]).flatMap(t=>(t.
sessions||[]).map(n=>`${t.key}:${bs(n)}`)).sort().join("|")}function Ad(e){return String(e?.key||"unscoped")}function hl(e){
let t={},n={},s={};for(let a of e||[]){let o=Ad(a);s[o]={...a,sessions:[]};for(let c of a.sessions||[]){let u=bs(c);u&&(t[u]=
c,n[u]=o)}}return{sessionById:t,groupBySession:n,groupMeta:s}}function Wy(e){return{groupOrder:[...e?.groupOrder||[]],sessionOrder:[
...e?.sessionOrder||[]]}}function Ky(e,t){return(e?.groupOrder||[]).join("|")===(t?.groupOrder||[]).join("|")&&(e?.sessionOrder||
[]).join("|")===(t?.sessionOrder||[]).join("|")}function Vy(e,t={},n=null){return lh(ch(e,{...t,previousGroupOrder:n?.groupOrder||
t.previousGroupOrder,previousSessionOrder:n?.sessionOrder||t.previousSessionOrder}))}function Vo(e,t={}){let n=ch(e,t),s=hl(
n),a=lh(n);return{version:1,revision:Number(t.revision||0),groupOrder:a.groupOrder,sessionOrder:a.sessionOrder,historicalGroupOrder:a.
groupOrder,historicalSessionOrder:a.sessionOrder,historicalGroupBySession:s.groupBySession,groupBySession:s.groupBySession,
groupMeta:s.groupMeta,fallbackSessionById:s.sessionById,sourceMembership:uh(e)}}function pl(e,t){let n=hl(t),s=new Map((e?.
groupOrder||[]).map(a=>[a,[]]));for(let a of e?.sessionOrder||[]){let o=e.groupBySession?.[a];if(!o||!s.has(o))continue;
let c=n.sessionById[a]||e.fallbackSessionById?.[a];c&&s.get(o).push(c)}return(e?.groupOrder||[]).map(a=>({...n.groupMeta[a]||
e.groupMeta?.[a]||{key:a},key:a,sessions:s.get(a)||[]})).filter(a=>a.sessions.length>0)}function nh(e,t,n={}){let s=Vy(t,
n,e);if(!Ky(Wy(e),s))return!0;let a=hl(t);return Object.entries(a.groupBySession).some(([o,c])=>e.groupBySession?.[o]!==
c)}function dh(e,t,n={}){let s=e?.version===1?e:Vo(t,n),a=uh(t);if((s.sessionOrder||[]).length===0&&a){let w=Vo(t,{...n,
revision:Number(s.revision||0)+1});return{ledger:w,groups:pl(w,t),orderChanged:!1,structuralChanged:!0,deferred:!1}}if(a===
s.sourceMembership)return{ledger:s,groups:pl(s,t),orderChanged:nh(s,t,n),structuralChanged:!1,deferred:!1};if(n.freezeStructure)
return{ledger:s,groups:pl(s,t),orderChanged:!0,structuralChanged:!0,deferred:!0};let o=hl(t),c=new Set(Object.keys(o.sessionById)),
u=[...s.historicalSessionOrder||s.sessionOrder||[]],m=[...s.historicalGroupOrder||s.groupOrder||[]],f={...s.historicalGroupBySession||
s.groupBySession||{}};for(let w of t||[]){let h=Ad(w);m.includes(h)||m.push(h);for(let M of w.sessions||[]){let C=bs(M);
C&&!u.includes(C)&&(u.push(C),f[C]=h)}}let v={},k=[],R=[],S={...s.groupMeta||{}},T={};for(let w of u)c.has(w)&&(k.push(w),
v[w]=s.groupBySession?.[w]||f[w]||o.groupBySession[w],T[w]=o.sessionById[w]);for(let w of t||[]){let h=Ad(w);for(let M of w.
sessions||[]){let C=bs(M);!C||v[C]||(k.push(C),v[C]=h,T[C]=M,S[h]={...w,sessions:[]})}}for(let w of m)k.some(h=>v[h]===w)&&
R.push(w);for(let w of k){let h=v[w];R.includes(h)||R.push(h)}let b={version:1,revision:Number(s.revision||0)+1,groupOrder:R,
sessionOrder:k,historicalGroupOrder:m,historicalSessionOrder:u,historicalGroupBySession:f,groupBySession:v,groupMeta:S,fallbackSessionById:T,
sourceMembership:a};return{ledger:b,groups:pl(b,t),orderChanged:nh(b,t,n),structuralChanged:!0,deferred:!1}}function ph(e,t,n={}){
return Vo(t,{...n,previousGroupOrder:e?.groupOrder,previousSessionOrder:e?.sessionOrder,revision:Number(e?.revision||0)+
1})}function ml(e){let t=String(e||"").trim().replace(/\\/g,"/").replace(/\/+$/,"");return!t||t.toLowerCase()==="unknown"||
!/^(?:[A-Za-z]:\/|\/\/|\/)/.test(t)?null:{key:t.toLowerCase(),path:t}}function mh(e){return String(e||"").replace(/\\/g,
"/").replace(/\/+$/,"").split("/").filter(Boolean).pop()||"Unscoped"}function Yy(e,t){return e===t||e.startsWith(`${t}/`)}
function Xy(e){return mh(e).toLowerCase().replace(/[^a-z0-9]+/g,"")}function sh(e){return`alias:${String(e||"").trim().toLowerCase().
replace(/[^a-z0-9]+/g,"-")}`}function gl(e){let t=e&&typeof e=="object"&&!Array.isArray(e)?e:{};return Object.fromEntries(
Object.entries({...fl,...t}).filter(([n,s])=>String(n).trim()&&String(s).trim()).map(([n,s])=>[String(n).trim(),String(s).
trim()]))}function Qy(e,t,n){let s=t&&typeof t=="object"&&(t.group_alias||t.project_group)||null;if(typeof s=="string"&&
s.trim()){let o=s.trim();return{key:sh(o),title:o}}if(!e)return null;let a=Xy(e.path);for(let[o,c]of Object.entries(gl(n)))
try{if(new RegExp(o,"i").test(a))return{key:sh(c),title:c}}catch{}return null}function $d(e,t={},n=fl){let s=Array.isArray(
e)?e:[],a=s.map(u=>ml(u&&typeof u=="object"?u.project_root:null)).filter(Boolean).sort((u,m)=>m.key.length-u.key.length),
o=[],c=new Map;for(let u of s){let m=typeof u=="string"?u:u?.session_id||u?.id,f=m?t[m]:null,v=ml(u&&typeof u=="object"?
u.project_root:null),k=ml(u&&typeof u=="object"?u.workspace_path:null)||ml(f?.file_access_scope),R=!v&&k?a.find(h=>Yy(k.
key,h.key)):null,S=v||R||k,T=Qy(S,u,n),b=T?.key||S?.key||"unscoped",w=c.get(b);w||(w={key:b,label:T?.title||(S?mh(S.path):
"Unscoped"),path:S?.path||null,sessions:[]},c.set(b,w),o.push(w)),w.sessions.push(u)}return o}var Jy=new Set(["claude","claude_cli","claude-desktop","codex","codex_cli","codex-desktop","cursor","cursor_cli","gemini",
"continue","continue_yolo","roo_code","cline","antigravity","antigravity_panel","antigravity-v2"]);function fh(e,t={},n="\
unknown",s=!0){let a=typeof e=="string"?e:String(e?.session_id||e?.id||""),o=String(typeof e=="object"?e?.agent_type||t?.
agent_type||"":t?.agent_type||""),c=t?.capabilities||{};return!!a&&!!s&&Jy.has(o)&&n!=="disconnected"&&e?.disconnected!==
!0&&e?.is_list_view!==!0&&c.send!==!1&&c.send_message!==!1&&c.message_send!==!1}function hh(e,t=()=>!0){let n=Array.isArray(
e?.session_ids)?e.session_ids:[],s=[...new Set(n.map(u=>String(u||"").trim()).filter(Boolean))],a=typeof e?.content=="st\
ring"?e.content.trim():"";if(s.length<1||s.length>20)return{ok:!1,error:"Select between 1 and 20 sessions"};if(!a||a.length>
65536)return{ok:!1,error:"Prompt must contain 1-65536 characters"};let o=`SEND TO ${s.length} SESSIONS`;if(e?.confirmation!==
o)return{ok:!1,error:"Broadcast confirmation does not match the selected session count"};let c=s.filter(u=>!t(u));return c.
length?{ok:!1,error:"One or more selected sessions cannot receive messages",unsupported:c}:{ok:!0,sessionIds:s,content:a,
confirmation:o}}function gh(e){return Object.fromEntries(e.map(t=>[t,{status:"queued",error:null}]))}var{useEffect:_h,useLayoutEffect:Zy,useRef:_l,useState:Ed}=React,zr=12,bh=10,Ld=360,yh=210,ev=450;function tv(e,t,n){return Math.
min(Math.max(e,t),Math.max(t,n))}function nv(e){return`title-disclosure-${String(e||"title").replace(/[^a-z0-9_-]+/gi,"-")}`}
function bl({title:e,disclosureKey:t,kind:n="title",wrapperClassName:s,triggerClassName:a,disclosureClassName:o,triggerLabel:c,
triggerTag:u="button"}){let m=_l(null),f=_l(null),v=_l(null),k=_l({focused:!1,hovered:!1,latched:!1}),[R,S]=Ed(!1),[T,b]=Ed(
!1),[w,h]=Ed(null),M=nv(`${n}-${t}`),C=u;function _(){let W=k.current;S(W.focused||W.hovered||W.latched)}function L({restoreFocus:W=!1}={}){
k.current={focused:!1,hovered:!1,latched:!1},b(!1),h(null),S(!1),W&&m.current?.focus({preventScroll:!0})}function P(){k.
current.latched=!0,b(!0),S(!0)}function V(){v.current&&(clearTimeout(v.current),v.current=null)}_h(()=>()=>V(),[]),_h(()=>{
if(!R||!T)return;let W=te=>{m.current?.contains(te.target)||f.current?.contains(te.target)||L()};return document.addEventListener(
"pointerdown",W,!0),()=>document.removeEventListener("pointerdown",W,!0)},[R,T]),Zy(()=>{if(!R)return;let W=null,te=()=>{
W=null;let ue=m.current,J=f.current;if(!ue||!J)return;let pe=ue.getBoundingClientRect();if(pe.bottom<=0||pe.top>=window.
innerHeight||pe.right<=0||pe.left>=window.innerWidth){L();return}let Ce=window.innerWidth,se=window.innerHeight,Q=document.
querySelector(".sidebar")?.getBoundingClientRect(),de=window.matchMedia?.("(pointer: coarse)")?.matches===!0||Ce<=640,he=Math.
max(pe.right,Q?.right||pe.right),xe=Ce-he-bh-zr,be=J.getBoundingClientRect().height;if(!de&&xe>=yh){let ee=Math.min(Ld,xe),
H=tv(pe.top,zr,se-be-zr);h({mode:"right",left:he+bh,top:H,width:ee});return}h({mode:"sheet",bottom:zr,left:zr,width:Math.
min(Ld,Ce-zr*2)})},X=()=>{W===null&&(W=requestAnimationFrame(te))};return X(),window.addEventListener("resize",X),document.
addEventListener("scroll",X,!0),()=>{W!==null&&cancelAnimationFrame(W),window.removeEventListener("resize",X),document.removeEventListener(
"scroll",X,!0)}},[R,e]);let Z={ref:m,className:a,role:u==="button"?void 0:"button",type:u==="button"?"button":void 0,tabIndex:u===
"button"?void 0:0,"aria-label":c,"aria-describedby":R?M:void 0,"aria-expanded":R,onPointerEnter:W=>{W.pointerType&&W.pointerType!==
"mouse"&&W.pointerType!=="pen"||(k.current.hovered=!0,_())},onPointerLeave:W=>{W.pointerType&&W.pointerType!=="mouse"&&W.
pointerType!=="pen"||(k.current.hovered=!1,_())},onPointerDown:W=>{W.pointerType==="touch"&&(V(),v.current=setTimeout(()=>{
v.current=null,P()},ev))},onPointerUp:V,onPointerCancel:V,onFocus:()=>{k.current.focused=!0,_()},onBlur:()=>{k.current.focused=
!1,_()},onClick:W=>{W.stopPropagation(),P()},onContextMenu:W=>{W.preventDefault(),W.stopPropagation(),P()},onKeyDown:W=>{
if(W.key==="Escape"){W.preventDefault(),L({restoreFocus:!0});return}u!=="button"&&(W.key==="Enter"||W.key===" ")&&(W.preventDefault(),
P())}},oe=w||{mode:"measuring",left:-1e4,top:zr,width:Ld},ge=R&&ReactDOM.createPortal(React.createElement("div",{ref:f,id:M,
className:`title-disclosure-portal ${o||""}`.trim(),role:"tooltip","data-title-disclosure-for":t,"data-title-disclosure-\
kind":n,"data-placement":oe.mode,style:{left:`${oe.left}px`,top:oe.top==null?"auto":`${oe.top}px`,bottom:oe.bottom==null?
"auto":`${oe.bottom}px`,width:oe.mode==="sheet"?`${oe.width}px`:"max-content",maxWidth:`${oe.width}px`,minWidth:`${Math.
min(yh,oe.width)}px`}},e),document.body);return React.createElement("div",{className:s},React.createElement(C,{...Z},e),
ge)}var Od=Object.freeze([{command:"/goal resume",action:"resume",detail:"Resume the current Codex goal through native goal \
control."},{command:"/goal pause",action:"pause",detail:"Pause the current Codex goal through native goal control."}]);function vh(e,t={}){
let s=(typeof e=="string"?e:"").trim(),a=Math.max(0,Number(t.attachmentCount)||0);if(!s||a>0||/[\r\n]/.test(s))return{kind:"\
chat",text:s};let o=s.toLowerCase(),c=Od.find(u=>u.command===o);return c?{kind:"goal_control",action:c.action,command:c.
command,text:s}:/^\/goal(?:\s|$)/i.test(s)?{kind:"unsupported_goal_control",command:s,text:s}:{kind:"chat",text:s}}function wh(e,t){
let n=String(t||"").trim().toLowerCase();return e==="resume"&&n==="active"?"Already active":e==="pause"&&n==="paused"?"A\
lready paused":""}var kh={schema_version:1,asset_set_version:"2026-07-16.1",retrieved_date:"2026-07-16",policy:{purpose:"First-party provi\
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
er time without modifying source pixels"]}]}]};var av=Object.freeze(Object.fromEntries(kh.providers.map(e=>[e.provider_id,Object.freeze({accessibleName:e.accessible_name,
light:`/provider-assets/${e.render.web.light}`,dark:`/provider-assets/${e.render.web.dark}`,darkTint:e.render.web.dark_tint||
""})])));function rv(e){return av[String(e||"")]||null}function yl({providerId:e,providerName:t}){let n=rv(e),[s,a]=React.
useState(!1);React.useEffect(()=>a(!1),[e]);let o=n?.accessibleName||String(t||"Unknown provider");return!n||s?React.createElement(
"span",{className:"usage-dashboard-provider-mark usage-dashboard-provider-mark-fallback","data-provider-mark-id":e,role:"\
img","aria-label":`${o} provider mark unavailable`},React.createElement("span",{"aria-hidden":"true"},o)):React.createElement(
"span",{className:"usage-dashboard-provider-mark","data-provider-mark-id":e,role:"img","aria-label":`${o} provider mark`},
React.createElement("img",{className:"usage-dashboard-provider-mark-image usage-dashboard-provider-mark-light",src:n.light,
alt:"","aria-hidden":"true",onError:()=>a(!0)}),React.createElement("img",{className:`usage-dashboard-provider-mark-imag\
e usage-dashboard-provider-mark-dark${n.darkTint?" usage-dashboard-provider-mark-tinted":""}`,src:n.dark,alt:"","aria-hi\
dden":"true",onError:()=>a(!0)}))}var iv=Object.freeze({codex:"openai-codex","codex-desktop":"openai-codex",codex_cli:"openai-codex",codex_vscode:"openai-\
codex",claude:"anthropic-claude","claude-desktop":"anthropic-claude",claude_cli:"anthropic-claude",claude_code:"anthropi\
c-claude",cursor:"cursor",cursor_cli:"cursor",antigravity:"google-antigravity",antigravity_panel:"google-antigravity","a\
ntigravity-v2":"google-antigravity",gemini:"google-antigravity",ollama:"ollama-local"}),ov=Object.freeze({"openai-codex":"\
OpenAI Codex","anthropic-claude":"Anthropic Claude",cursor:"Cursor","google-antigravity":"Google Antigravity","ollama-lo\
cal":"Ollama"});function Yt(e,t=160){return String(e??"").replace(/\s+/g," ").trim().slice(0,t)}function vl(e){return Yt(
e).toLowerCase().replace(/[^a-z0-9]+/g,"")}function Yo(e){let t=Number(e);return Number.isFinite(t)?t:null}function cv(e,t){
return Yt(e?.agent_type||e?.agentType||t?.agent_type||t?.agentType,80)}function Nh(e,t){return Yt(e?.usage_billing_provider_id||
e?.billing_provider_id||e?.provider_usage?.provider_id||t?.usage_billing_provider_id||t?.billing_provider_id,80)}function lv(e,t){
return Yt(e?.usage_account_fingerprint||e?.provider_account_fingerprint||e?.provider_usage?.account_fingerprint||t?.usage_account_fingerprint,
96)}function uv(e,t){return Yt(e?.usage_quota_domain||e?.provider_quota_domain||e?.provider_usage?.quota_domain||t?.usage_quota_domain,
120)}function dv(e,t){let n=Yt(t?.observed_model_id||t?.model_id||t?.selected_model_id||t?.model||e?.observed_model_id||
e?.model_id||e?.selected_model_id||e?.model,160),s=Yt(t?.observed_model_label||t?.model_label||e?.model_label||n,160);return{
id:n,label:s}}function pv(e,t,n){let s=Yt(n?.model_vendor||t?.model_vendor,80);if(s)return s;let a=`${e.id} ${e.label}`.
toLowerCase();return/claude|anthropic/.test(a)?"Anthropic":/gemini|google/.test(a)?"Google":/gpt|codex|openai|\bo[1345](?:\b|-)/.
test(a)?"OpenAI":/ollama|qwen|gemma|llama|mistral/.test(a)?"Ollama/runtime-defined":e.id?"Unknown model vendor":"Not rep\
orted"}function mv(e,t){let n=Yt(e?.usage_runtime_kind||e?.ollama_runtime_kind||e?.model_runtime_kind||t?.usage_runtime_kind||
t?.ollama_runtime_kind||t?.model_runtime_kind,32).toLowerCase();return n==="local"||n==="cloud"?n:""}function fv(e,t){if(!e.
id||!t)return!1;let n=[vl(e.id),vl(e.label)].filter(Boolean),s=[vl(t.id),vl(t.label)].filter(Boolean);return s.length===
0?!1:s.some(a=>n.some(o=>o===a||o.includes(a)||a.includes(o)))}function Id(e){let t=Yo(e?.remainingPercent);if(t!=null)return t;
let n=Yo(e?.usedPercent);return n==null?null:100-n}function Sh(e,t){let n=Id(e),s=Id(t);if(n!=null&&s!=null&&n!==s)return n-
s;if(n!=null)return-1;if(s!=null)return 1;let a=Yo(e?.durationMinutes),o=Yo(t?.durationMinutes);return a!=null&&o!=null&&
a!==o?a-o:Yt(e?.label).localeCompare(Yt(t?.label))}function hv(e,t,n){let s=cv(e,t),a=dv(e,t),o=Nh(e,t)||iv[s]||"";return{
supported:!!o,state:o?"unavailable":"unsupported",tone:"unavailable",message:o?"Usage account unavailable":"No provider \
usage mapping",billingProviderId:o,billingProviderName:ov[o]||o||"Provider",providerMarkId:o,harnessSurface:s,modelId:a.
id,modelLabel:a.label,modelVendor:pv(a,e,t),accountFingerprint:"",accountLabel:"",quotaDomain:"",plan:"",mappingConfidence:"\
unavailable",generation:Number(n?.generation)||0,capturedAt:"",staleAfter:"",freshness:Yt(n?.collectionState||"unavailab\
le",40),source:"",error:null,applicableWindows:[],headerWindows:[],credits:null,financials:null,cloudUsage:null,localRuntime:null,
runtimeKind:o==="ollama-local"?mv(e,t):""}}function gv(e,t,n,s){let a=Array.isArray(s?.entries)?s.entries:[],o=lv(t,n),c=uv(
t,n),u=e.billingProviderId?a.filter(m=>m?.providerId===e.billingProviderId):a.filter(m=>Array.isArray(m?.harnessTypes)&&
m.harnessTypes.includes(e.harnessSurface));return o&&(u=u.filter(m=>m?.accountFingerprint===o)),c&&(u=u.filter(m=>m?.quotaDomain===
c)),u.length===1?{entry:u[0],confidence:o||c?"explicit_account":Nh(t,n)?"explicit_provider":"unique_provider_account"}:u.
length>1?{entry:null,confidence:"ambiguous",candidates:u}:{entry:null,confidence:o||c?"linked_account_unavailable":"unav\
ailable",candidates:u}}function xh(e,t,n,s=Date.now()){let a=hv(e,t,n);if(!a.supported)return a;let o=gv(a,e,t,n);if(!o.
entry)return{...a,state:o.confidence==="ambiguous"?"ambiguous":"unavailable",message:o.confidence==="ambiguous"?"Usage a\
ccount ambiguous":"Usage account unavailable",mappingConfidence:o.confidence};let c=o.entry,u=Date.parse(c.staleAfter||""),
f=Number.isFinite(u)&&u<=s&&c.status==="fresh"?"stale":Yt(c.status||"unavailable",40),v={id:a.modelId,label:a.modelLabel},
k=Array.isArray(c.windows)?c.windows.filter(_=>_&&_.usedPercent!=null):[],R=k.filter(_=>_.modelScope&&fv(v,_.modelScope)).
sort(Sh),S=k.filter(_=>!_.modelScope).sort(Sh),T=[...R,...S],b=R.length>0?[R[0],S[0]].filter(Boolean):S.slice(0,2),w=a.runtimeKind;
if(a.billingProviderId==="ollama-local"){if(!w)return{...a,billingProviderName:c.providerName||a.billingProviderName,accountFingerprint:c.
accountFingerprint,accountLabel:c.accountLabel,quotaDomain:c.quotaDomain,plan:c.plan,mappingConfidence:o.confidence,capturedAt:c.
capturedAt,staleAfter:c.staleAfter,freshness:f,source:c.source,state:"ambiguous",message:"Ollama runtime unavailable",cloudUsage:c.
cloudUsage,localRuntime:c.localRuntime};if(w==="local")return{...a,billingProviderName:c.providerName||a.billingProviderName,
accountFingerprint:c.accountFingerprint,accountLabel:c.accountLabel,quotaDomain:c.quotaDomain,plan:c.plan,mappingConfidence:o.
confidence,capturedAt:c.capturedAt,staleAfter:c.staleAfter,freshness:f,source:c.source,state:c.localRuntime?"local":"una\
vailable",tone:c.localRuntime?"local":"unavailable",message:c.localRuntime?"Local \xB7 no plan limit":"Local runtime tel\
emetry unavailable",localRuntime:c.localRuntime,cloudUsage:c.cloudUsage}}let h=new Set(b.map(_=>_.tone)),M=h.has("critic\
al")?"critical":h.has("warning")?"warning":f==="stale"?"stale":b.length>0?"ok":"unavailable",C=f==="auth_required"||f===
"unavailable"?"unavailable":f==="stale"||f==="rate_limited"?"stale":b.some(_=>Number(_.usedPercent)>=100)?"exhausted":b.
length>0?"ready":"unavailable";return{...a,state:C,tone:C==="exhausted"?"critical":M,message:b.length>0?"":"Applicable u\
sage windows unavailable",billingProviderName:c.providerName||a.billingProviderName,accountFingerprint:c.accountFingerprint,
accountLabel:c.accountLabel,quotaDomain:c.quotaDomain,plan:c.plan,mappingConfidence:o.confidence,capturedAt:c.capturedAt,
staleAfter:c.staleAfter,freshness:f,source:c.source,error:c.error,applicableWindows:T,headerWindows:b,credits:c.credits,
financials:c.financials,cloudUsage:c.cloudUsage,localRuntime:c.localRuntime}}function Pd(e){let t=Yt(e?.label||"Usage",60),
n=Id(e);return{label:t,usedPercent:Yo(e?.usedPercent),remainingPercent:n,compactValue:n==null?"Unavailable":`${Math.max(
0,Math.round(n))}% left`,reset:Yt(e?.resetDescription||e?.resetsAt,120),tone:Yt(e?.tone||"unavailable",24)}}var fa="closed",Ur="open",Gr="minimized",_v=Object.freeze([fa,Ur,Gr]),Qo="__global__",qd=Object.freeze([{id:"sidebar",label:"\
Sessions",classification:"chat-adjacent",capability:"always",web:!0,android:!1,android_na:"Android uses a navigation-sta\
ck session list, not a chat-overlapping sidebar."},{id:"agent-settings",label:"Agent settings",classification:"chat-adja\
cent",capability:"agent_config",web:!0,android:!0},{id:"composer-settings",label:"Composer settings",classification:"cha\
t-adjacent",capability:"always",web:!0,android:!1,android_na:"Android exposes the coordinated Agent settings sheet inste\
ad of an independent composer popover."},{id:"chat-list",label:"Chats",classification:"chat-adjacent",capability:"chat_l\
ist",web:!0,android:!0},{id:"thread-list",label:"Threads",classification:"chat-adjacent",capability:"thread_list",web:!0,
android:!0},{id:"terminal",label:"Terminal",classification:"chat-adjacent",capability:"terminal_output|terminal_input",web:!0,
android:!0},{id:"diff-viewer",label:"Changes",classification:"chat-adjacent",capability:"file_changes",web:!0,android:!0},
{id:"branch-selector",label:"Branches",classification:"chat-adjacent",capability:"branch_list",web:!0,android:!0},{id:"f\
ile-browser",label:"Files",classification:"chat-adjacent",capability:"file_browser",web:!0,android:!0},{id:"scheduled-se\
nd",label:"Scheduled send",classification:"chat-adjacent",capability:"broadcast_send",web:!0,android:!0},{id:"session-us\
age",label:"Session usage",classification:"chat-adjacent",capability:"always",web:!1,android:!0,web_na:"Web exposes usag\
e as a full route rather than an inline session sheet."},{id:"native-action",label:"Action needed",classification:"block\
ing-native-action",capability:"permission_dialogs|question_prompts",web:!0,android:!0},{id:"rate-limit",label:"Rate limi\
t",classification:"transient-status",capability:"always",web:!0,android:!0},{id:"live-activity",label:"Live activity",classification:"\
transient-status",capability:"always",web:!0,android:!0},{id:"task-list",label:"Task list",classification:"chat-adjacent",
capability:"always",web:!0,android:!1,android_na:"Android renders task rows inside the bounded, minimizable Live activit\
y pane."},{id:"automation-context",label:"Automation",classification:"chat-adjacent",capability:"automation_view",web:!0,
android:!1,android_na:"Android automation management is a navigation route, not a chat-adjacent overlay."},{id:"antigrav\
ity-navigator",label:"Conversations",classification:"chat-adjacent",capability:"agent:antigravity-v2",web:!0,android:!1,
android_na:"Android uses the shared coordinated Chats sheet for Antigravity v2 conversations."},{id:"new-session",label:"\
New session",classification:"chat-adjacent",capability:"always",web:!0,android:!1,android_na:"Android launches sessions \
from the separate session-list route, never over Chat.",global:!0},{id:"notification-settings",label:"Notifications",classification:"\
chat-adjacent",capability:"always",web:!0,android:!1,android_na:"Android notification settings are a separate navigation\
 route, never a Chat overlay.",global:!0},{id:"session-management",label:"Manage sessions",classification:"chat-adjacent",
capability:"always",web:!0,android:!1,android_na:"Android session management belongs to the separate session-list route.",
global:!0},{id:"quick-switcher",label:"Quick switcher",classification:"chat-adjacent",capability:"always",web:!0,android:!1,
android_na:"Android switches sessions through its navigation-stack session list.",global:!0},{id:"shortcut-help",label:"\
Keyboard shortcuts",classification:"chat-adjacent",capability:"always",web:!0,android:!1,android_na:"Android has no keyb\
oard-shortcut overlay.",global:!0},{id:"revalidation-ledger",label:"Validation ledger",classification:"chat-adjacent",capability:"\
always",web:!0,android:!1,android_na:"Android validation health is a session-list modal, never a Chat overlay.",global:!0},
{id:"route-automations",label:"Automations",classification:"full-route",capability:"automation_view",web:!0,android:!1,android_na:"\
Android Automations is launched from Session list and does not replace an active Chat route."},{id:"route-skills",label:"\
Skills",classification:"full-route",capability:"skill_list",web:!0,android:!1,android_na:"Android Skills is launched fro\
m Session list and does not replace an active Chat route."},{id:"route-usage",label:"Usage",classification:"full-route",
capability:"always",web:!0,android:!0},{id:"route-host-resources",label:"Host resources",classification:"full-route",capability:"\
always",web:!0,android:!1,android_na:"Android Host resources is owned by Session list and does not replace an active Cha\
t route."},{id:"route-fleet",label:"Fleet",classification:"full-route",capability:"always",web:!0,android:!1,android_na:"\
Android Fleet is owned by Session list and does not replace an active Chat route."},{id:"route-search",label:"Transcript\
 search",classification:"full-route",capability:"always",web:!0,android:!1,android_na:"Android transcript search is owne\
d by Session list and returns to Chat only after result selection."}]),Bd=new Map(qd.map(e=>[e.id,e]));function Wi(e,t){
return String(e||"").trim()||t}function Dd(e){let t=Math.floor(Number(e)||0);return Math.max(0,Math.min(999,t))}function Ch(e){
return{pane_id:e,state:fa,source_key:"",attention_count:0,revision:0,payload:null}}function Ui(e,t){let n=t&&typeof t=="\
object"?t:{},s=_v.includes(n.state)?n.state:fa;return{pane_id:e,state:s,source_key:String(n.source_key||""),attention_count:Dd(
n.attention_count),revision:Math.max(0,Math.floor(Number(n.revision)||0)),payload:n.payload&&typeof n.payload=="object"?
n.payload:null}}function Ah(e){let t=e&&typeof e=="object"?e:{},n={};for(let[s,a]of Object.entries(t.panes||{}))Bd.has(s)&&
(n[s]=Ui(s,a));return{panes:n}}function wl(e=null){let t=e&&typeof e=="object"?e:{},n={};for(let[s,a]of Object.entries(t.
sessions||{}))n[Wi(s,Qo)]=Ah(a);return{schema_version:1,sessions:n}}function ha(e){return Bd.get(String(e||""))||null}function Mh(e,t=""){
return ha(t)?.global?Qo:Wi(e,Qo)}function Gi(e,t,n){let s=Wi(n,"");if(!Bd.has(s))return Ch(s);let a=Mh(t,s);return Ui(s,
e?.sessions?.[a]?.panes?.[s])}function Rh(e,t,n){return Gi(e,t,n).state}function Th(e,t,n){return Rh(e,t,n)!==fa}function Fd(e,t,n){
return Rh(e,t,n)===Ur}function $h(e,t){return[...new Set([Wi(t,Qo),Qo])].flatMap(s=>Object.values(e?.sessions?.[s]?.panes||
{})).map(s=>Ui(s.pane_id,s)).filter(s=>s.state===Gr).sort((s,a)=>{let o=ha(s.pane_id),c=ha(a.pane_id),u=qd.indexOf(o),m=qd.
indexOf(c);return u-m||s.pane_id.localeCompare(a.pane_id)})}function jd(e,t){if(e===t)return!0;if(!e||!t||typeof e!="obj\
ect"||typeof t!="object")return!1;if(Array.isArray(e)||Array.isArray(t))return Array.isArray(e)&&Array.isArray(t)&&e.length===
t.length&&e.every((a,o)=>jd(a,t[o]));let n=Object.keys(e).sort(),s=Object.keys(t).sort();return n.length===s.length&&n.every(
(a,o)=>a===s[o]&&jd(e[a],t[a]))}function bv(e,t){return e.state===t.state&&e.source_key===t.source_key&&e.attention_count===
t.attention_count&&jd(e.payload,t.payload)}function Xo(e,t,n,s){let a=Ah(e?.sessions?.[t]),o=Ui(n,a.panes[n]),c=Ui(n,s);
if(bv(o,c))return e;let u={...c,revision:o.revision+1};return{schema_version:1,sessions:{...e?.sessions||{},[t]:{panes:{
...a.panes,[n]:u}}}}}function yv(e,t,n){let s=e,a=e?.sessions?.[t]?.panes||{};for(let[o,c]of Object.entries(a)){if(o===n)
continue;let u=ha(o);if(!u||u.classification==="full-route")continue;let m=Ui(o,c);m.state===Ur&&(s=Xo(s,t,o,{...m,state:Gr}))}
return s}function ma(e,t){let n=wl(e),s=Wi(t?.pane_id,""),a=ha(s);if(!a||a.classification==="full-route")return e||n;let o=Mh(
t?.session_id,s),c=Gi(n,o,s),u=String(t?.action||"").toLowerCase(),m=t?.compact===!0,f=n;if(u==="open"||u==="restore"){m&&
(f=yv(f,o,s));let v=Gi(f,o,s);return Xo(f,o,s,{...v,state:Ur,source_key:t?.source_key==null?v.source_key:String(t.source_key),
attention_count:t?.attention_count==null?v.attention_count:Dd(t.attention_count),payload:t?.payload===void 0?v.payload:t.
payload})}return u==="minimize"?c.state===fa?e||n:Xo(f,o,s,{...c,state:Gr}):u==="close"||u==="resolve"?c.state===fa&&!c.
source_key&&!c.payload?e||n:Xo(f,o,s,Ch(s)):u==="update"?Xo(f,o,s,{...c,source_key:t?.source_key==null?c.source_key:String(
t.source_key),attention_count:t?.attention_count==null?c.attention_count:Dd(t.attention_count),payload:t?.payload===void 0?
c.payload:t.payload}):e||n}function Ki(e,t){let n=Wi(t?.pane_id,"");if(!ha(n))return wl(e);let s=String(t?.source_key||""),
a=Gi(e,t?.session_id,n);return s?a.source_key===s&&a.state!==fa?ma(e,{session_id:t?.session_id,pane_id:n,action:"update",
source_key:s,attention_count:t?.attention_count,payload:t?.payload}):ma(e,{session_id:t?.session_id,pane_id:n,action:"op\
en",compact:t?.compact===!0,source_key:s,attention_count:t?.attention_count,payload:t?.payload}):ma(e,{session_id:t?.session_id,
pane_id:n,action:"resolve"})}var xg=vm(Hh()),{goalLifecycleSupported:Gv,latestUserRequestFromMessages:Wv,projectFleetWorkContext:Kv}=xg.default,{useState:_e,
useRef:we,useEffect:$e,useLayoutEffect:Us}=React;function zh(){if(typeof window>"u")return!1;let e=Number(window.visualViewport?.
width||window.innerWidth||0);return e>0&&e<=700}function Vv(){let[e,t]=React.useState(zh);return React.useEffect(()=>{if(typeof window>
"u")return;let n=()=>t(zh()),s=window.matchMedia?.("(max-width: 700px)");return s?.addEventListener?.("change",n),window.
visualViewport?.addEventListener?.("resize",n),window.addEventListener("resize",n),()=>{s?.removeEventListener?.("change",
n),window.visualViewport?.removeEventListener?.("resize",n),window.removeEventListener("resize",n)}},[]),e}function pt(e,t,n,s,a,o){
let c=Fd(e,n,s),u=Th(e,n,s),m=Gi(e,n,s),f=React.useCallback(k=>{t(R=>{let S=Fd(R,n,s),T=typeof k=="function"?!!k(S):!!k;
return T&&typeof document<"u"&&document.activeElement instanceof HTMLElement&&(o.current[s]=document.activeElement),ma(R,
{session_id:n,pane_id:s,action:T?S?"open":"restore":"close",compact:a})})},[a,o,s,n,t]),v=React.useCallback(()=>{t(R=>ma(
R,{session_id:n,pane_id:s,action:"minimize"}));let k=o.current[s];k?.isConnected&&requestAnimationFrame(()=>k.focus({preventScroll:!0}))},
[o,s,n,t]);return{open:c,mounted:u,record:m,setOpen:f,minimize:v}}function ht({paneId:e,state:t,onMinimize:n,children:s,
blocking:a=!1}){let o=t===Ur;return React.createElement("div",{id:`pane-${e}`,className:"pane-lifecycle-boundary","data-\
pane-id":e,"data-pane-state":t,hidden:!o,style:{display:o?"contents":"none"},onKeyDown:c=>{a||c.key!=="Escape"||c.defaultPrevented||
c.target?.matches?.('input, textarea, select, [contenteditable="true"]')||(c.preventDefault(),c.stopPropagation(),n?.())}},
s)}function rt({paneId:e,onMinimize:t}){let n=ha(e);return React.createElement("button",{type:"button",className:"pane-m\
inimize-btn",onClick:t,title:`Minimize ${n?.label||e}`,"aria-label":`Minimize ${n?.label||e}`,"aria-controls":`pane-${e}`,
"aria-expanded":"true"},React.createElement("span",{"aria-hidden":"true"},"\u2014"),React.createElement("span",{className:"\
pane-minimize-label"},"Minimize"))}function Yv({records:e,onRestore:t}){return e.length?React.createElement("nav",{className:"\
pane-restore-rail","aria-label":"Minimized chat panes","data-testid":"pane-restore-rail"},e.map(n=>{let s=ha(n.pane_id),
a=n.attention_count>0;return React.createElement("button",{type:"button",className:`pane-restore-chip${a?" attention":""}`,
key:n.pane_id,"data-pane-restore":n.pane_id,"aria-controls":`pane-${n.pane_id}`,"aria-expanded":"false",onClick:o=>t(n.pane_id,
o.currentTarget)},React.createElement("span",null,s?.label||n.pane_id),a&&React.createElement("span",{className:"pane-at\
tention-count","aria-label":`${n.attention_count} pending`},n.attention_count))})):null}var Uh="remote-agent-chat:drafts\
:v1",Gh="remote-agent-chat:show-test-sessions:v1",Wh="remote-agent-chat:mobile-system-banner-expanded:v1",Kh="remote-age\
nt-chat:mobile-header-expanded:v1",Vh="remote-agent-chat:mobile-live-status-expanded:v1",Yh="remote-agent-chat:mobile-sy\
stem-fingerprint:v1",Xv=120,Qv=500,Jv=160,Zv=256*1024,Xh=Object.freeze([]),ew=[...Od,{command:"/plan",detail:"Outline th\
e implementation approach and major steps."},{command:"/review",detail:"Review the current changes for bugs, regressions\
, and missing tests."},{command:"/fix",detail:"Implement or repair the current issue."},{command:"/summarize",detail:"Su\
mmarize the current state and important changes."}],ys={claude:{name:"Claude Code",color:"#cc785c",abbr:"CC",logo:"/logo\
-claude-in-ag.svg"},claude_cli:{name:"Claude Code CLI",color:"#d97757",abbr:"CLI",logo:"/logo-claude-in-ag.svg"},"claude\
-desktop":{name:"Claude Desktop",color:"#cc785c",abbr:"CD",logo:"/logo-claude-in-ag.svg"},codex:{name:"Codex",color:"#10\
a37f",abbr:"CX",logo:"/logo-codex-in-ag.svg"},codex_cli:{name:"Codex CLI",color:"#10a37f",abbr:"CLI",logo:"/logo-codex.s\
vg"},"codex-desktop":{name:"Codex Desktop",color:"#10a37f",abbr:"CX",logo:"/logo-codex.svg"},cursor:{name:"Cursor",color:"\
#7AA2F7",abbr:"CR",logo:"/logo-cursor.svg"},cursor_cli:{name:"Cursor CLI",color:"#7c6cf0",abbr:"CLI",logo:"/logo-cursor.\
svg"},gemini:{name:"Gemini",color:"#4285f4",abbr:"GC",logo:"/logo-gemini-in-ag.svg"},continue:{name:"Continue",color:"#d\
29922",abbr:"CN",logo:"/logo-continue.png"},continue_yolo:{name:"Continue YOLO",color:"#f59e0b",abbr:"CY",logo:"/logo-co\
ntinue.png"},roo_code:{name:"Roo Code",color:"#06b6d4",abbr:"RC",logo:"/logo-continue.png"},cline:{name:"Cline",color:"#\
6366f1",abbr:"CL",logo:"/logo-cline.svg"},antigravity:{name:"Antigravity",color:"#a855f7",abbr:"AG",logo:"/logo-antigrav\
ity.svg"},antigravity_panel:{name:"Antigravity Chat",color:"#a855f7",abbr:"AC",logo:"/logo-antigravity.svg"},"antigravit\
y-v2":{name:"Antigravity v2",color:"#7c3aed",abbr:"A2",logo:null}},Xd={name:"Agent",color:"#8b949e",abbr:"AG"};function Qd(e){
return e==="continue"||e==="continue_yolo"}function ec(e){return e==="cline"||e==="roo_code"}function tw(e){return e==="codex"||e==="codex-desktop"}function nw(e){return e==="codex_cli"||e==="cursor_cli"?Jv:tw(e)?
Qv:Xv}function ce(e,t=""){return typeof e=="string"?e:e==null?t:String(e)}function rn(e){if(typeof e=="string")return e;
if(Array.isArray(e))return e.map(t=>typeof t=="string"?t:!t||typeof t!="object"?"":typeof t.text=="string"?t.text:typeof t.
content=="string"?t.content:typeof t.url=="string"?t.url:typeof t.image_url=="string"?t.image_url:"").filter(Boolean).join(
" ");if(e&&typeof e=="object"){if(typeof e.text=="string")return e.text;if(typeof e.content=="string")return e.content;if(typeof e.
url=="string")return e.url;if(typeof e.image_url=="string")return e.image_url;try{return JSON.stringify(e)}catch{return""}}
return""}function Cg(e){let t=typeof e=="string"?e:ce(e),n=2166136261;for(let s=0;s<t.length;s++)n^=t.charCodeAt(s),n=Math.
imul(n,16777619);return(n>>>0).toString(36)}function Ll(e,t=0){if(!e||typeof e!="object")return`empty:${t}`;if(e._cid)return`\
cid:${e._cid}`;if(e.client_message_id)return`cid:${e.client_message_id}`;if(e.source_message_id)return`source:${e.source_message_id}`;
if(e.native_source_id)return`native:${e.native_source_id}`;if(e.id!=null)return`id:${e.id}`;if(e.server_message_id!=null)
return`server:${e.server_message_id}`;if(e.client_msg_id)return`client:${e.client_msg_id}`;if(e.sequence!=null)return`se\
q:${e.sequence}`;let n=rn(e.content)||rc(e.content_blocks),s=Array.isArray(e.content_blocks)?JSON.stringify(e.content_blocks):
"";return["body",e.role||"",e.ts||"",Cg(`${n}
${s}`)].join(":")}function $l(e){return String(e?._cid||e?.client_message_id||e?.client_msg_id||"")}function sw(e){let t=rn(
e?.content)||rc(e?.content_blocks),n=Array.isArray(e?.content_blocks)?JSON.stringify(e.content_blocks):"";return Cg(`${t}\

${n}`)}function aw(e){return e?.role==="user"?"user":Ji(e?.content_blocks)[0]?.type||"markdown"}function Qh(e){return(Array.
isArray(e)?e:[]).map((n,s)=>Ll(n,s))}function rw(e,t){return!e||!t?"":t.type!=="question_prompt"?`${e}\0legacy\0${t.prompt_id||
t.request_id||t.id||"prompt"}`:!t.prompt_id||!t.generation?"":`${e}\0question\0${t.prompt_id}\0${t.generation}`}function iw(e){
return e?.matches?.(".messages")?"transcript":e?.matches?.(".session-list")?"sidebar":"other"}function Jd(e,t,n={}){if(!e)
return;let s=e.style.scrollBehavior;e.style.scrollBehavior="auto";let a={container:n.container||iw(e),writer:n.writer||"\
scroll-coordinator",reason:n.reason||"unspecified",interaction_epoch:Number(n.interactionEpoch)||0,route_session_id:n.sessionId||
null,anchor_id:n.anchorId||null,anchor_offset_px:Number.isFinite(n.anchorOffset)?n.anchorOffset:null,bottom_gap_px:e.scrollHeight-
e.scrollTop-e.clientHeight,payload_generation:Number(n.payloadGeneration)||0},o=typeof window<"u"&&window.__RAC_TEMPORAL_CANARY__?.
active;o&&(window.__RAC_SCROLL_WRITE_CONTEXT__=a);try{e.scrollTop=t}finally{o&&window.__RAC_SCROLL_WRITE_CONTEXT__===a&&
delete window.__RAC_SCROLL_WRITE_CONTEXT__}requestAnimationFrame(()=>{e.style.scrollBehavior==="auto"&&(e.style.scrollBehavior=
s)})}function ow(e){let t=rn(e),n=t.match(/^\[File: ([^\]]+?) [→\u2192] ([A-Za-z]:\\.+?\\uploads\\([^\\\]]+))\]$/);if(!n)
return t;let[,s,,a]=n;return/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(s)?`![${s}](/uploads/${a})`:t}function cw(e){return rn(
e).trim().length>0}function Ji(e){return Array.isArray(e)?e.filter(t=>t&&typeof t=="object").map(t=>{let n=ce(t.type||"m\
arkdown").toLowerCase();if(n==="code"){let s=ce(t.language||t.lang||"").trim(),a=rn(t.content||t.text||t.markdown||"");return{
...t,type:"markdown",content:`\`\`\`${s}
${a}
\`\`\``}}return n==="file_change"?{...t,type:"file_changes"}:n==="tool"?{...t,type:"tool_call"}:n==="tool_output"||n==="\
result"?{...t,type:"tool_result"}:n==="thought"?{...t,type:"thinking"}:n==="task_list"?{...t,type:"plan"}:n==="queue"||n===
"queued"?{...t,type:"queued_message"}:n==="banner"||n==="notification"?{...t,type:"notice"}:n==="worked"||n==="activity"?
{...t,type:"status"}:t}):[]}function Ag(e){if(!e||typeof e!="object")return"";let t=[e.workdir?`cwd: ${e.workdir}`:null,
e.command?`$ ${e.command}`:null,e.stdout||null,e.stderr?`stderr:
${e.stderr}`:null,e.exit_code!=null?`exit code: ${e.exit_code}`:null].filter(Boolean);if(t.length)return t.join(`

`);if(Array.isArray(e.files)&&e.files.length>0){let n=e.files.map(s=>[s.path||s.file||"",s.added!=null?`+${s.added}`:"",
s.removed!=null?`-${s.removed}`:""].filter(Boolean).join(" ")).filter(Boolean).join(`
`);return[e.content||e.text||e.markdown||"",n].filter(Boolean).join(`

`)}if(Array.isArray(e.tasks)&&e.tasks.length>0){let n=e.tasks.map(s=>{let a=ce(s?.text||s?.step||s?.title).trim(),o=ce(s?.
state||s?.status||"pending").trim();return a?`[${o}] ${a}`:""}).filter(Boolean).join(`
`);return[e.content||"",n].filter(Boolean).join(`
`)}return e.content||e.text||e.markdown||e.title||e.label||""}function lw(e){return e?cw(e.content)?!0:Ji(e.content_blocks).
some(t=>rn(Ag(t)).trim().length>0):!1}function rc(e){return Ji(e).map(t=>rn(Ag(t))).filter(Boolean).join(`

`)}function nr({actions:e}){return!Array.isArray(e)||e.length===0?null:React.createElement("div",{className:"content-blo\
ck-actions"},e.map((t,n)=>React.createElement("span",{key:t.id||n,className:`content-block-action-label${t.unsupported?"\
 unsupported":""}`,title:t.unsupported?"This Codex control is visible in the source app but is not currently available f\
rom the web UI.":void 0},t.label||t.id||"Action")))}var uw=512,Kr=new Map;function dw(e,t){if(e)for(Kr.delete(e),Kr.set(
e,t);Kr.size>uw;)Kr.delete(Kr.keys().next().value)}function sr({className:e,summary:t,children:n,stateKey:s="",defaultOpen:a=!0}){
let[o,c]=React.useState(()=>s&&Kr.has(s)?Kr.get(s):a),u=React.useCallback(m=>{let f=m.currentTarget.open;c(f),dw(s,f)},[
s]);return React.createElement("details",{className:e,open:o,onToggle:u},React.createElement("summary",null,t),n)}function pw(e){
let t=ce(e).trim().match(/^(Edited\s+\d+\s+files?)(?:\s+(\+\d+))?(?:\s+(-\d+))?$/i);return t?{label:t[1],additions:t[2]||
"",deletions:t[3]||""}:null}function mw({blocks:e,monospace:t,autoExpandLongCodeBlocks:n,onOpenPath:s,agentType:a,richContentEager:o=!0,
richContentCacheIdentity:c=""}){let u=Ji(e);if(u.length===0)return null;let m=ce(a).toLowerCase()==="cursor",f=ce(a).toLowerCase()===
"claude",v=ce(a).toLowerCase()==="codex",k=ce(a).toLowerCase()==="codex-desktop",R=["codex","codex-desktop","codex_cli"].
includes(ce(a).toLowerCase()),S=ce(a).toLowerCase()==="antigravity-v2";function T(w){let h=[w.workdir?`cwd: ${w.workdir}`:
null,w.command?`$ ${w.command}`:null,w.stdout||null,w.stderr?`stderr:
${w.stderr}`:null,w.exit_code!=null?`exit code: ${w.exit_code}`:null].filter(Boolean);return h.length?h.join(`

`):rn(w.content||w.text||w.markdown||"")}function b(w,h){return React.createElement(Pi,{content:w,monospace:t,autoExpandLongCodeBlocks:n,
onOpenPath:s,deferUntilVisible:!o,cacheIdentity:`${c}:block:${h}`})}return React.createElement("div",{className:`content\
-blocks${m?" content-blocks-cursor":""}`},u.map((w,h)=>{let M=ce(w.type||"markdown").toLowerCase(),C=ce(w.title||w.label||
w.summary||M),_=T(w);if(M==="status")return React.createElement("div",{key:h,className:"content-block content-block-stat\
us-chip",title:C},C||"Status");if(M==="thinking"){let L=!_||ce(_).replace(/\s+/g," ").trim()===C;if(R&&w.activity_summary===
!0){let P=_&&!L?_:C&&C.toLowerCase()!=="thinking"?C:"";return P?React.createElement("div",{key:w.native_source_id||h,className:"\
content-block content-block-thinking-native-summary",role:"note","aria-label":"Codex activity summary","data-native-sour\
ce-id":w.native_source_id||void 0,"data-native-turn-id":w.native_turn_id||void 0},React.createElement("div",{className:"\
content-block-thinking-native-summary-copy"},b(P,h)),React.createElement(sc,{instant:w.producer_timestamp||w.created_at||
w.timestamp||w.ts})):null}if(v){let P=_&&!L?_:C&&C.toLowerCase()!=="thinking"?C:"";return P?React.createElement("div",{key:h,
className:"content-block content-block-thinking-native"},b(P,h)):null}return k&&L?React.createElement("div",{key:h,className:"\
content-block content-block-thinking-codex-desktop"},React.createElement("span",null,C||"Worked"),React.createElement("s\
pan",{className:"content-block-thinking-codex-desktop-chevron","aria-hidden":"true"},"\u2304")):k?React.createElement(sr,
{key:h,stateKey:`${c}:disclosure:${h}`,className:"content-block content-block-thinking-codex-desktop",summary:C||"Worked"},
b(_,h)):m&&L?React.createElement("div",{key:h,className:"content-block content-block-status-chip thinking",title:C},C||"\
Thinking"):React.createElement(sr,{key:h,stateKey:`${c}:disclosure:${h}`,className:"content-block content-block-thinking",
summary:C||"Thinking"},_&&!L&&b(_,h))}if(M==="tool_call"||M==="tool_result"){let L=!_||ce(_).replace(/\s+/g," ").trim()===
C;return m&&L?React.createElement("div",{key:h,className:"content-block content-block-status-chip tool",title:C},C||"Too\
l"):React.createElement(sr,{key:h,stateKey:`${c}:disclosure:${h}`,className:`content-block content-block-${M==="tool_res\
ult"?"tool-result":"tool"}`,summary:React.createElement(React.Fragment,null,React.createElement("span",null,C||(M==="too\
l_result"?"Tool result":"Tool")),w.status&&React.createElement("span",{className:`content-block-status ${ce(w.status).toLowerCase()}`},
w.status))},_&&React.createElement("pre",{className:"content-block-pre"},_),React.createElement(nr,{actions:w.actions}))}
if(M==="terminal"){if(f){let L=(C||"Bash").match(/^(\S+)(?:\s+([\s\S]*))?$/),P=L?.[1]||"Bash",V=L?.[2]||"",Z=ce(w.status||
"running").toLowerCase();return React.createElement("div",{key:h,className:"content-block content-block-terminal-claude",
role:"group","aria-label":C||"Bash command"},React.createElement("div",{className:"content-block-terminal-claude-header"},
React.createElement("span",{className:`content-block-terminal-claude-dot ${Z}`,"aria-hidden":"true"}),React.createElement(
"strong",null,P),V&&React.createElement("span",null,V)),React.createElement("div",{className:"content-block-terminal-cla\
ude-body"},w.command&&React.createElement("div",{className:"content-block-terminal-claude-row"},React.createElement("spa\
n",null,"IN"),React.createElement("pre",null,w.command)),w.stdout&&React.createElement("div",{className:"content-block-t\
erminal-claude-row"},React.createElement("span",null,"OUT"),React.createElement("pre",null,w.stdout)),w.stderr&&React.createElement(
"div",{className:"content-block-terminal-claude-row error"},React.createElement("span",null,"ERR"),React.createElement("\
pre",null,w.stderr))),React.createElement(nr,{actions:w.actions}))}return k?React.createElement(sr,{key:h,stateKey:`${c}\
:disclosure:${h}`,className:"content-block content-block-terminal-codex-desktop",summary:React.createElement("span",null,
"Ran commands")},_&&React.createElement("pre",{className:"content-block-pre"},_),React.createElement(nr,{actions:w.actions})):
React.createElement(sr,{key:h,stateKey:`${c}:disclosure:${h}`,className:"content-block content-block-terminal",summary:React.
createElement(React.Fragment,null,React.createElement("span",null,C||"Terminal"),w.exit_code!=null&&React.createElement(
"span",{className:"content-block-status"},"exit ",w.exit_code))},_&&React.createElement("pre",{className:"content-block-\
pre"},_),React.createElement(nr,{actions:w.actions}))}if(M==="file_changes"){let L=pw(C);if(!!(m&&L&&!_&&(!Array.isArray(
w.files)||w.files.length===0)&&(!Array.isArray(w.actions)||w.actions.length===0)))return React.createElement("div",{key:h,
className:"content-block content-block-file-change content-block-file-change-cursor-summary"},React.createElement("span",
null,L.label),L.additions&&React.createElement("span",{className:"content-block-add"},L.additions),L.deletions&&React.createElement(
"span",{className:"content-block-del"},L.deletions));let V=[w.files_changed!=null?`${w.files_changed} files`:null,w.additions!=
null?`+${w.additions}`:null,w.deletions!=null?`-${w.deletions}`:null].filter(Boolean).join(" ");return React.createElement(
sr,{key:h,stateKey:`${c}:disclosure:${h}`,className:"content-block content-block-file-change",summary:React.createElement(
React.Fragment,null,React.createElement("span",null,C||"File changes",V?` ${V}`:""),w.status&&React.createElement("span",
{className:`content-block-status ${ce(w.status).toLowerCase()}`},w.status))},Array.isArray(w.files)&&w.files.length>0&&React.
createElement("div",{className:"content-block-file-list"},w.files.map((Z,oe)=>React.createElement("div",{className:"cont\
ent-block-file-row",key:Z.path||oe},React.createElement("span",{className:"content-block-file-path"},Z.path||"file"),Z.added!=
null&&React.createElement("span",{className:"content-block-add"},"+",Z.added),Z.removed!=null&&React.createElement("span",
{className:"content-block-del"},"-",Z.removed)))),_&&b(_,h),React.createElement(nr,{actions:w.actions}))}if(M==="artifac\
t")return React.createElement("div",{key:h,className:"content-block content-block-artifact"},React.createElement("div",{
className:"content-block-title"},C||"Artifact"),_&&b(_,h));if(M==="plan"){let L=Array.isArray(w.tasks)?w.tasks:[];return React.
createElement("div",{key:h,className:"content-block content-block-plan"},React.createElement("div",{className:"content-b\
lock-title"},C||"Plan"),L.length>0&&React.createElement("ol",{className:"content-block-plan-list"},L.map((P,V)=>{let Z=ce(
P?.state||P?.status||"pending").toLowerCase();return React.createElement("li",{key:P.id||V,className:`content-block-plan\
-item ${Z}`},React.createElement("span",{className:"content-block-plan-marker","aria-hidden":"true"},Z==="completed"?"\u2713":
Z==="in_progress"?"\u2022":"\u25CB"),React.createElement("span",null,P.text||P.step||P.title||""))})),_&&!L.length&&b(_,
h))}return M==="queued_message"?React.createElement("div",{key:h,className:"content-block content-block-queued-message"},
React.createElement("span",{className:"content-block-queued-label"},C||"Queued message"),_&&React.createElement("span",{
className:"content-block-queued-body"},_)):M==="notice"?React.createElement("div",{key:h,className:`content-block conten\
t-block-notice ${ce(w.tone||w.status||"info").toLowerCase()}`},React.createElement("div",{className:"content-block-title"},
C||"Notice"),_&&b(_,h),React.createElement(nr,{actions:w.actions})):M==="memory_citation"?React.createElement(sr,{key:h,
stateKey:`${c}:memory-citation:${h}`,className:"content-block content-block-memory-citation",defaultOpen:!1,summary:C||"\
Sources"},_&&b(_,h)):M==="error"&&S?React.createElement(sr,{key:h,stateKey:`${c}:disclosure:${h}`,className:"content-blo\
ck content-block-error content-block-error-antigravity-v2",defaultOpen:!1,summary:React.createElement(React.Fragment,null,
React.createElement("span",{className:"content-block-error-antigravity-v2-label"},C||"Error"),_&&React.createElement("sp\
an",{className:"content-block-error-antigravity-v2-message"},_))},React.createElement(nr,{actions:w.actions})):M==="prom\
pt"||M==="error"?React.createElement("div",{key:h,className:`content-block content-block-${M}`},React.createElement("div",
{className:"content-block-title"},C||M),_&&b(_,h),React.createElement(nr,{actions:w.actions})):React.createElement("div",
{key:h,className:"content-block content-block-markdown"},b(_||C,h))}))}function Gd(e){let t=rn(e).trim();return!(!t||t.length<
4||/^[\s*._|`~•·▌]+$/.test(t)||!/[A-Za-z0-9]/.test(t))}function sc({message:e=null,instant:t=null}){let n=t==null?qi(
e):js(t);if(!n)return React.createElement("span",{className:"message-timestamp message-timestamp-unknown","aria-label":"\
Sent time unknown",title:"Sent time unknown"},"Time unknown");let s=jm(n);return React.createElement("time",{className:"\
message-timestamp",dateTime:n.iso,title:s,"aria-label":`Sent ${s}`},Ku(n))}function fw(e){return typeof e=="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.
test(e)}function Jh(e){if(!e)return Xd;let t=e.split("-")[0].toLowerCase();return ys[t]||Xd}function Wr(e){let t=ce(e).toLowerCase();
return t?t.includes("roo code")||t.includes("roo_code")||t.includes("roo-cline")?"roo_code":t.includes("cline")||t.includes(
"claude-dev")?"cline":t.includes("continue yolo")||t.includes("continue_yolo")?"continue_yolo":t.includes("continue")?"c\
ontinue":t.includes("codex cli")||t.includes("codex_cli")?"codex_cli":t.includes("codex desktop")?"codex-desktop":t.includes(
"cursor cli")||t.includes("cursor_cli")?"cursor_cli":/\bcursor\b/.test(t)||t==="cursor"||t.includes("cursor ide")?"curso\
r":t.includes("codex")?"codex":t.includes("claude code")||t.includes("claude")?"claude":t.includes("antigravity chat")||
t.includes("antigravity_panel")?"antigravity_panel":t.includes("antigravity-v2")||t.includes("antigravity v2")?"antigrav\
ity-v2":null:null}function Zh(e){if(e&&typeof e=="object"){let t=e.agent_type;return ys[t]?t:Wr(e.display_name)||Wr(e.agent_type)||
Wr(e.session_title)||Wr(e.window_title)||Wr(e.chat_title)||Wr(e.session_id)}if(typeof e=="string"){let t=e.split("-")[0].
toLowerCase();return ys[t]?t:Wr(e)}return null}function je(e){return typeof e=="string"?e:e?.session_id}function Qi(e,t){
if(e&&typeof e=="object"){let s=Zh(e);return ys[s]||Jh(e.session_id)}let n=Zh(e);return ys[n]||Jh(e)}function Xi(e,t,n){
if(e&&typeof e=="object"){let o=Cw(e,n),c=n?.file_access_scope?n.file_access_scope.replace(/\\/g,"/").split("/").filter(
Boolean).pop():null,u=e.agent_type==="antigravity_panel"&&e.panel_title?` / ${e.panel_title}`:"",m=(o?.label||e.workspace_name||
c||e.window_title||e.workspace_path||t||"Session")+u;return e.chat_title&&!m.includes("/")?`${m} / ${e.chat_title}`:m}let s=t||
e;return typeof s!="string"?"Session":fw(s)?"Connected session":s.split("-").slice(1).join("-")||s}function Mg(e){let t=ce(
e).replace(/\\/g,"/").replace(/\/+$/,"").trim();return t?t.split("/").filter(Boolean).pop()||t:""}function Il(e){return ce(
e).replace(/\\/g,"/").replace(/\/+$/,"").trim()}function Rg(e){let t=Il(e);return/^[A-Za-z]:\//.test(t)||t.startsWith("/\
/")||t.startsWith("/")}function hw(e){let t=Il(e).toLowerCase();return/^[a-z]:\/users\/[^/]+$/.test(t)||/^[a-z]:\/users\/[^/]+\/documents$/.
test(t)||/^\/users\/[^/]+$/.test(t)||/^\/users\/[^/]+\/documents$/.test(t)||/^\/home\/[^/]+$/.test(t)}function gw(e){let t=Il(
e),n=t.match(/^[A-Za-z]:\/Users\/([^/]+)(?:\/|$)/i);if(n)return n[1];let s=t.match(/^\/(?:Users|home)\/([^/]+)(?:\/|$)/i);
return s?s[1]:""}function _w(e,t){let n=gw(t);return!!n&&ce(e).trim().toLowerCase()===n.toLowerCase()}function ip(e){return ce(
e).replace(/\s+\(Workspace\)$/i,"").replace(/\s+-\s+(?:Visual Studio Code|Code|Cursor|Antigravity)(?:\s*\[[^\]]+\]|\s+(?:Administrator|Admin))?$/i,
"").trim()}function Tg(e){let t=ce(e).trim();return/^(?:Visual Studio Code|Code|Cursor|Antigravity)(?:\s*\[[^\]]+\]|\s+(?:Administrator|Admin))?$/i.
test(t)}function bw(e){return/\s+-\s+(?:Visual Studio Code|Code|Cursor|Antigravity)(?:\s*\[[^\]]+\]|\s+(?:Administrator|Admin))?\s*$/i.
test(ce(e))}function $g(e){let t=ce(e).trim();if(!t)return[];let n=t.split(/\s+-\s+/).map(s=>ip(s)).filter(Boolean);for(;n.
length&&Tg(n[n.length-1]);)n.pop();return n}var yw=/\b(?:image|screenshot|screen\s*shot|capture)[\w .()[\]-]*\.(?:png|jpe?g|gif|webp|bmp|svg)(?:\b|[\s._-]*\d{2,}(?:\s*[x\u00d7]\s*\d{2,})?|[\s._-]*[a-z0-9]{3,})/i,
vw=/(?:[A-Za-z]:[\\/]|\\\\[^\\/\s]+[\\/]|\/(?:Users|home|mnt|var|tmp|etc|opt|workspace|workspaces)\/)[^\s"'`<>)]{2,}/i,Eg=new Set(
["agent","agent manager","agent session","antigravity","antigravity chat","antigravity v2","claude","claude code","codex",
"codex cli","codex desktop","connected session","other","session","unknown"]),ww=new Set(Array.from(Eg,e=>e.replace(/[^a-z0-9]+/g,
"")));function Lg(e){let t=ip(e);if(!t)return"";let n=Mg(t),s=/[-_]/.test(n),a=n.replace(/[-_]+/g," ");return(s||!/\s/.test(
n))&&(a=a.replace(/([a-z])([A-Z])/g,"$1 $2")),a.replace(/\s+/g," ").trim()}function kw(e){let t=Lg(e).toLowerCase();if(!t||
/^window\s+\d+$/.test(t)||Tg(t)||Eg.has(t))return!0;let n=t.replace(/[^a-z0-9]+/g,"");return ww.has(n)}function Sw(e,t){
return ce(e).toLowerCase()===ce(t).toLowerCase()}function op(e,t){let n=Lg(e);return kw(n)?null:{label:n,key:ce(t||n).replace(
/\\/g,"/").replace(/\/+$/,"").toLowerCase()}}function eg(e){let t=Il(e);return!t||!Rg(t)||hw(t)?null:op(Mg(t),t)}function tg(e){
let t=$g(e);return t.length<2?null:op(t[t.length-1],t[t.length-1])}function Nw(e){let t=ce(e);if(bw(t))return null;let n=ip(
e);return!n||Rg(n)||$g(n).length>=2?null:op(n,n)}function xw(e){let t=ce(e).toLowerCase().trim();return[t,t.replace(/\s+/g,
"-"),t.replace(/\s+/g,"")].filter(Boolean)}function ng(e,t=[]){let n=e.map(a=>ce(a).toLowerCase()).filter(Boolean),s=[...t].
sort((a,o)=>o.label.length-a.label.length);for(let a of s){let o=xw(a.label);if(n.some(c=>o.some(u=>u&&c.includes(u))))return a}
return null}function Cw(e,t,n=[]){if(!e||typeof e!="object")return null;let s=ng([e.window_title,e.workspace_name,e.chat_title,
e.session_title],n),a=[eg(e.workspace_path),eg(t?.file_access_scope),s,tg(e.window_title),tg(e.workspace_name),_w(e.workspace_name,
e.workspace_path)?null:Nw(e.workspace_name)].filter(Boolean);if(a.length>0){let u=a[0];return n.find(m=>Sw(m.label,u.label))||
u}let o=[e.chat_title,e.session_title,e.title,e.display_title,e.window_title,e.workspace_name].map(u=>ce(u).toLowerCase()).
filter(Boolean),c=ng(o,n);return c||null}function Aw(e){return rn(e).replace(/!\[[^\]]*\]\((?:data:image\/[^)]+|\/uploads\/[^)]+|[^)]*\.(?:png|jpe?g|gif|webp|bmp|svg))\)/gi,
" ").replace(/\[File:\s*[^\]]+\]/gi," ").replace(vw," ").replace(yw," ").replace(/<goal_context>[\s\S]*?<\/goal_context>/gi,
" ").replace(/<[^>\n]{1,80}>/g," ").replace(/```[\s\S]*?```/g," ").replace(/`([^`]+)`/g,"$1").replace(/^\s*(?:user|assistant|codex|claude|tool result)\s*[:\-]\s*/i,
"").replace(/\s+/g," ").trim()}function tc(e,t,n,s=[]){return Vm(e,e&&typeof e=="object"?e.custom_display_name:"",s)}function sg(e){
if(!e||typeof e!="object")return null;if(e.workspace_path)return ce(e.workspace_path).toLowerCase();let t=ce(e.workspace_name||
e.window_title||"");return t&&t.split(" / ")[0].trim().toLowerCase()||null}function Mw(e,t){let n=je(t),s=sg(t);return s&&
(e||[]).find(a=>a&&typeof a=="object"&&a.agent_type==="antigravity_panel"&&je(a)!==n&&sg(a)===s)||null}function Rw(e){return!e||
typeof e!="object"?"":[e.panel_title||null,e.panel_model||null,e.panel_mode||null].filter(Boolean).join(" \xB7 ")}function Tw(e){return e==="claude"?"claude-document":e==="codex_cli"?"codex-terminal":e==="cursor"?"cursor-cards":e==="c\
odex-desktop"||e==="codex"?"codex-thread":"unified-flow"}function ag(e){return e==="codex_cli"?"codex-cli":e==="codex"||
e==="codex-desktop"?"codex":e==="claude"||e==="claude_cli"?"claude":e==="cursor"||e==="cursor_cli"?"cursor":"default"}function $w(e,t){
let n=ce(e).toLowerCase().replace(/\s+/g," ").trim(),s=ce(t).toLowerCase().replace(/\s+/g," ").trim();if(!s)return 0;let a=n.
indexOf(s);if(a>=0)return 2e3-Math.min(a,500)-Math.max(0,n.length-s.length)*.01;let o=0,c=0,u=-1;for(let m of s){if(m===
" ")continue;let f=n.indexOf(m,c);if(f<0)return Number.NEGATIVE_INFINITY;o+=u<0?Math.max(0,80-f):Math.max(1,24-(f-u-1)*3),
(f===0||/[\s/\\_.:-]/.test(n[f-1]))&&(o+=35),u=f,c=f+1}return o}function Ew(e,t){let n=ce(t).toLowerCase().trim().split(
/\s+/).filter(Boolean);return n.length===0?[...e]:e.map((s,a)=>{let o=n.reduce((c,u)=>{let m=Array.isArray(s.searchFields)&&
s.searchFields.length?s.searchFields:[s.searchText],f=Math.max(...m.map(v=>$w(v,u)));return Number.isFinite(c)&&Number.isFinite(
f)?c+f:Number.NEGATIVE_INFINITY},0);return{item:s,sidebarIndex:a,score:o}}).filter(s=>Number.isFinite(s.score)).sort((s,a)=>+!!a.
item.working-+!!s.item.working||a.score-s.score||s.sidebarIndex-a.sidebarIndex).map(s=>s.item)}function Zd(e){return e instanceof
Element?!!e.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]'):!1}function Lw(e,t){if(!e||!t||
e.sessionId!==t.sessionId)return 0;let n=Math.max(0,Number(t.messageCount||0)-Number(e.messageCount||0)),s=!!t.provisionalId&&
(t.provisionalId!==e.provisionalId||Number(t.provisionalLength||0)>Number(e.provisionalLength||0));return n+(s&&n===0?1:
0)}function Ow(e,t,n=!1){let[s,a]=React.useState(()=>Vo(e,t)),o=React.useMemo(()=>dh(s,e,{...t,freezeStructure:n}),[s,e,
t,n]);React.useEffect(()=>{o.ledger!==s&&a(o.ledger)},[s,o]);let c=React.useCallback(()=>{a(u=>ph(u,e,t))},[e,t]);return{
groups:o.groups,orderChanged:o.orderChanged,sortNow:c,revision:o.ledger.revision}}function rg(e){return!e||typeof e!="ob\
ject"?"":e.visible_pane_visible?[e.visible_pane_title||null,e.visible_pane_location==="right"?"Right Pane":null].filter(
Boolean).join(" \xB7 "):Rw(e)}function Og(e){let t=ce(e);return t?t.replace(/^Gemini\s+/i,"G ").replace(/^Claude\s+/i,"").
replace(/\s*\(Thinking\)\s*/i,"").replace(/\s*\(Medium\)\s*/i,"").replace(/\s+/g," ").trim():""}function Ig(e,t=3){return!Array.
isArray(e)||e.length===0?"":e.slice(0,t).map(n=>{let s=n?.percent_used;if(s==null)return null;let a=Og(n?.model);return a?
`${a} ${s}%`:null}).filter(Boolean).join(" \xB7 ")}function Wd(e){return e?ys[e]?.name||e:""}function ac(e){let t=ce(e).
trim();if(!t)return"";if(!/^\d{4}-\d{2}-\d{2}T/.test(t))return t;let n=new Date(t);return Number.isNaN(n.getTime())?t:n.
toLocaleString([],{weekday:"short",hour:"numeric",minute:"2-digit"})}function Iw({session:e,config:t,providerUsage:n,onOpenUsage:s}){
let[a,o]=React.useState(!1),[c,u]=React.useState(Date.now()),m=React.useRef(null),f=React.useRef(null),v=React.useMemo(()=>_d(
n),[n]),k=React.useMemo(()=>xh(e,t,v,c),[e,t,v,c]),R=k.headerWindows.map(Pd);if(React.useEffect(()=>{if(!a)return;u(Date.
now());let h=setInterval(()=>u(Date.now()),3e4);return()=>clearInterval(h)},[a]),React.useEffect(()=>{if(!a)return;let h=(_=!1)=>{
o(!1),_&&requestAnimationFrame(()=>m.current?.focus({preventScroll:!0}))},M=_=>{m.current?.contains(_.target)||f.current?.
contains(_.target)||h(!1)},C=_=>{_.key==="Escape"&&(_.preventDefault(),h(!0))};return document.addEventListener("pointer\
down",M),document.addEventListener("keydown",C),requestAnimationFrame(()=>f.current?.querySelector("button")?.focus({preventScroll:!0})),
()=>{document.removeEventListener("pointerdown",M),document.removeEventListener("keydown",C)}},[a]),!k.supported)return null;
let S=k.state==="local"?"Local":k.state==="exhausted"?"Limit":R[0]?.compactValue||"Usage ?",T=yd(k.credits),b=vd(k.financials),
w=()=>{o(!1),s()};return React.createElement("div",{className:`session-usage-mini tone-${k.tone} state-${k.state}`,"data\
-testid":"session-usage-mini"},React.createElement("button",{ref:m,type:"button",className:"session-usage-mini-trigger",
"aria-expanded":a,"aria-controls":"session-usage-popover",title:`${k.billingProviderName}: ${S}`,onClick:()=>o(h=>!h)},React.
createElement(yl,{providerId:k.providerMarkId,providerName:k.billingProviderName}),React.createElement("span",{className:"\
session-usage-mini-rows"},k.state==="local"?React.createElement("span",{className:"session-usage-mini-row"},React.createElement(
"strong",null,"Local"),React.createElement("em",null,"no plan limit")):R.length>0?R.map((h,M)=>React.createElement("span",
{className:`session-usage-mini-row ${h.tone}`,key:`${h.label}:${M}`},React.createElement("strong",null,h.label),React.createElement(
"em",null,h.compactValue),React.createElement("i",{"aria-hidden":"true"},React.createElement("b",{style:{width:`${Math.max(
0,Math.min(100,Number(h.usedPercent)||0))}%`}})))):React.createElement("span",{className:"session-usage-mini-row unavail\
able"},React.createElement("strong",null,"Usage"),React.createElement("em",null,k.state==="ambiguous"?"ambiguous":"unava\
ilable"))),React.createElement("span",{className:"session-usage-mini-compact"},S)),a&&React.createElement("div",{ref:f,id:"\
session-usage-popover",className:"session-usage-popover",role:"dialog","aria-modal":"false","aria-label":"Session usage \
details"},React.createElement("div",{className:"session-usage-popover-heading"},React.createElement(yl,{providerId:k.providerMarkId,
providerName:k.billingProviderName}),React.createElement("span",null,React.createElement("strong",null,k.billingProviderName),
React.createElement("small",null,k.plan||k.message||"Usage details")),React.createElement("button",{type:"button",onClick:()=>{
o(!1),m.current?.focus({preventScroll:!0})},"aria-label":"Close usage details"},"\xD7")),React.createElement("dl",{className:"\
session-usage-popover-meta"},React.createElement("div",null,React.createElement("dt",null,"Billing provider"),React.createElement(
"dd",null,k.billingProviderName)),React.createElement("div",null,React.createElement("dt",null,"Model vendor"),React.createElement(
"dd",null,k.modelVendor)),React.createElement("div",null,React.createElement("dt",null,"Current model"),React.createElement(
"dd",null,k.modelLabel||k.modelId||"Not reported")),React.createElement("div",null,React.createElement("dt",null,"Accoun\
t"),React.createElement("dd",null,k.accountLabel||(k.state==="ambiguous"?"Ambiguous":"Unavailable"))),React.createElement(
"div",null,React.createElement("dt",null,"Quota domain"),React.createElement("dd",null,k.quotaDomain||"Unavailable")),React.
createElement("div",null,React.createElement("dt",null,"Mapping"),React.createElement("dd",null,k.mappingConfidence.replace(
/_/g," ")))),k.state==="local"?React.createElement("div",{className:"session-usage-popover-state local"},React.createElement(
"strong",null,"Local \xB7 no plan limit"),React.createElement("span",null,k.localRuntime?.loadedModelsCount??0," loaded \
model(s)")):k.applicableWindows.length>0?React.createElement("div",{className:"session-usage-popover-windows"},k.applicableWindows.
map((h,M)=>{let C=Pd(h);return React.createElement("div",{className:`session-usage-popover-window ${C.tone}`,key:`${h.id}\
:${M}`},React.createElement("span",null,React.createElement("strong",null,C.label),React.createElement("em",null,C.usedPercent==
null?"Usage unavailable":`${An(C.usedPercent)} used \xB7 ${C.compactValue}`)),React.createElement("i",{"aria-hidden":"tr\
ue"},React.createElement("b",{style:{width:`${Math.max(0,Math.min(100,Number(C.usedPercent)||0))}%`}})),React.createElement(
"small",null,C.reset?`Resets ${Br(C.reset,c)}`:"Reset not reported",h.modelScope?.label?` \xB7 ${h.modelScope.label}`:""))})):
React.createElement("div",{className:`session-usage-popover-state ${k.state}`},React.createElement("strong",null,k.message),
React.createElement("span",null,"No percentage or $0 value is inferred.")),(T||b.length>0)&&React.createElement("div",{className:"\
session-usage-popover-financial"},React.createElement("strong",null,"Credits / overage"),T&&React.createElement("span",null,
T),b.map(h=>React.createElement("span",{key:h.id},h.label,": ",h.value))),React.createElement("div",{className:"session-\
usage-popover-source"},React.createElement("span",null,k.source||"Source unavailable"," \xB7 ",jr(k.capturedAt,c)),React.
createElement("span",null,"Generation ",k.generation," \xB7 ",k.freshness)),React.createElement("button",{type:"button",
className:"session-usage-open-dashboard",onClick:w},"Open Usage & limits")))}function Pg(e){return!e||typeof e!="object"?
"":ce(e.host_label||(e.host_type==="vscode"?"VS Code":e.host_type==="antigravity_ide"?"Antigravity IDE":""))}var Pw={healthy:"\
#3fb950",degraded:"#d29922",disconnected:"#f85149"},ig={thinking:{icon:"\u25CC",tone:"thinking"},generating:{icon:"\u2726",
tone:"thinking"},reading_files:{icon:"\u229E",tone:"info"},running_command:{icon:">",tone:"info"},applying_patch:{icon:"\
\u0394",tone:"info"},waiting_for_user:{icon:"?",tone:"idle"},idle:{icon:"\xB7",tone:"idle"},working:{icon:"\u2022",tone:"\
info"}};function nc({agentType:e,compact:t=!1,animate:n=!0}){let s=String(e||"default").toLowerCase(),a=n?"":" static";return s===
"claude"||s==="claude_cli"?React.createElement("span",{className:`native-activity-spinner claude${t?" compact":""}${a}`},
n?React.createElement(Jw,null):React.createElement("span",{className:"claude-spinner-icon"},El[0])):s==="codex"||s==="co\
dex-desktop"||s==="codex_cli"?React.createElement("span",{className:`native-activity-spinner codex${t?" compact":""}${a}`,
"aria-label":"Working"},"\u25CC"):s==="cursor"?React.createElement("span",{className:`native-activity-spinner cursor${t?
" compact":""}${a}`,"aria-label":"Generating"},React.createElement("i",null),React.createElement("i",null),React.createElement(
"i",null)):React.createElement("span",{className:`native-activity-spinner generic${t?" compact":""}${a}`},React.createElement(
"i",null))}function og(e){let t=String(e||"Send failed").trim(),n=t.toLowerCase();return n.includes("pending_revalidatio\
n")||n.includes("fixture version mismatch")||n.includes("validation pending")?"Update validation pending":n.includes("ag\
ent_busy")||n.includes("agent is generating")?"Agent busy":n.includes("codex_desktop_thread_not_open")||n.includes("code\
x_desktop_thread_changed")||n.includes("open this thread")?"Open this thread in Codex Desktop":n.includes("native_user_t\
urn_not_observed")||n.includes("native user turn")||n.includes("could not confirm native delivery")?"Could not confirm n\
ative delivery":n.includes("input_verify_failed")||n.includes("composer input could not be verified")||n.includes("verif\
ied send-ready state")?"Composer input could not be verified":n==="send_failed"?"Send failed":t.length>80?`${t.slice(0,77)}\
\u2026`:t}function cg({msg:e,onRetry:t}){let n=e.failure_retryable!=null||e.failure_native_attempted!=null,s=!!t&&(e.failure_retryable===
!0&&e.failure_native_attempted===!1||e._optimistic&&!n);return React.createElement("span",{className:"delivery-failure-a\
ctions"},s&&React.createElement("button",{type:"button",className:"delivery-retry",onClick:o=>{o.stopPropagation(),t(e)}},
"Retry"),React.createElement("button",{type:"button",className:"delivery-copy",onClick:o=>{o.stopPropagation(),navigator.
clipboard?.writeText&&navigator.clipboard.writeText(String(e.content||"")).catch(()=>{})},"aria-label":"Copy failed mess\
age"},"Copy"))}function qw({msg:e,deliveryStates:t,onSteer:n,onRetry:s}){if(e._optimistic){let a=t[e._cid]||"queued";if(a===
"offline_queued")return React.createElement("span",{className:"delivery offline-queued",title:"Queued until relay reconn\
ects","aria-label":"Queued offline"},"offline");if(a==="queued")return React.createElement("span",{className:"delivery q\
ueued",title:"Sending\u2026","aria-label":"Sending to relay"},"\xB7\xB7\xB7");if(a==="busy_queued")return React.createElement(
"span",{className:"delivery busy-queued",title:"Agent is busy \u2014 message queued","aria-label":"Queued while agent is\
 busy"},React.createElement("span",{className:"queued-label"},"queued"),n&&React.createElement("button",{className:"stee\
r-btn",onClick:o=>{o.stopPropagation(),n(e._cid,e.content)},title:"Inject into agent's context now"},"Steer \u25B8"));if(a===
"steered")return React.createElement("span",{className:"delivery steered",title:"Injected into agent context","aria-labe\
l":"Steered into agent context"},"\u2933");if(a==="accepted")return React.createElement("span",{className:"delivery acce\
pted",title:"Received by relay","aria-label":"Relay accepted; native receipt pending"},"\u2713");if(a==="launch_accepted")
return React.createElement("span",{className:"delivery launch-accepted",title:"Native launch accepted; user-turn receipt\
 pending","aria-label":"Native launch accepted; user-turn receipt pending"},"\u2197");if(a==="delivered")return React.createElement(
"span",{className:"delivery delivered",title:"Native user turn observed","aria-label":"Native user turn delivered"},"\u2713\u2713");
if(a==="agent_started")return React.createElement("span",{className:"delivery agent-started",title:"Agent started workin\
g","aria-label":"Agent started working"},"\u25B6");if(a==="failed"){let o=e._sendError||"Agent may be offline",c=og(o);return React.
createElement("span",{className:"delivery failed",title:o,"aria-label":`Send failed: ${c}`},React.createElement("span",{
"aria-hidden":"true"},"\u2715"),React.createElement("span",{className:"delivery-failure-reason"},c),React.createElement(
cg,{msg:e,onRetry:s}))}}if(e._agentStarted||e.status==="agent_started")return React.createElement("span",{className:"del\
ivery agent-started",title:"Agent started working","aria-label":"Agent started working"},"\u25B6");if(e._delivered||e.status===
"delivered")return React.createElement("span",{className:"delivery delivered",title:"Native user turn observed","aria-la\
bel":"Native user turn delivered"},"\u2713\u2713");if(e.status==="failed"){let a=e.failure_reason||e.failure_code||e._sendError||
"Send failed",o=og(a);return React.createElement("span",{className:"delivery failed",title:a,"aria-label":`Send failed: ${o}`},
React.createElement("span",{"aria-hidden":"true"},"\u2715"),React.createElement("span",{className:"delivery-failure-reas\
on"},o),React.createElement(cg,{msg:e,onRetry:s}))}return e._launchAcceptedAt||e.launch_accepted_at?React.createElement(
"span",{className:"delivery launch-accepted",title:"Native launch accepted; user-turn receipt pending","aria-label":"Nat\
ive launch accepted; user-turn receipt pending"},"\u2197"):e.status==="accepted"?React.createElement("span",{className:"\
delivery accepted",title:"Received by relay; native receipt pending","aria-label":"Relay accepted; native receipt pendin\
g"},"\u2713"):React.createElement("span",{className:"delivery recorded",title:"Recorded \u2014 native delivery receipt unknow\
n","aria-label":"Recorded; native delivery receipt unknown"},"Recorded")}function Dw(e,t=!1,n={}){let[s,a]=React.useState(
()=>Td(e)),o=React.useMemo(()=>oh(s,e,{...n,freezeStructure:t}),[s,e,t,n]);return React.useEffect(()=>{o.ledger!==s&&a(o.
ledger)},[s,o]),{sessions:o.sessions,revision:o.ledger.revision,deferred:o.deferred}}function jw(e,t=!1){let[n,s]=React.
useState(()=>al(e)),a=React.useMemo(()=>xf(n,e,{freezeStructure:t}),[n,e,t]);return React.useEffect(()=>{a.ledger!==n&&s(
a.ledger)},[n,a]),a.sessions}function Bw(e,t){let[n,s]=React.useState(Date.now());return React.useEffect(()=>{let a=Date.
now(),c=[...Object.values(e||{}),...Array.isArray(t)?t.map(m=>m?.activity):[]].reduce((m,f)=>{let v=el(f),k=v?v+sd:0;return k<=
a?m:m===0?k:Math.min(m,k)},0);if(!c)return;let u=setTimeout(()=>s(Date.now()),Math.max(25,c-a+25));return()=>clearTimeout(
u)},[e,t,n]),n}function Fw({stream:e,activeAgent:t,monospace:n}){let s=we(null),a=we("");return Us(()=>{let o=s.current;
if(!o)return;let c=String(e?.content||""),u=a.current;if(c.startsWith(u)){let m=c.slice(u.length);m&&o.appendChild(document.
createTextNode(m))}else o.textContent=c;a.current=c},[e?.content]),React.createElement("div",{className:`message assista\
nt live-draft provisional-stream${n?" monospace":""}`,"data-message-id":e?.messageId||"awaiting-first-delta","data-messa\
ge-role":"assistant","data-message-timestamp":js(e?.startedAtMs)?.iso||void 0,"data-stream-open":e?.open?"true":"false"},
React.createElement("div",{className:"assistant-gutter"},React.createElement("div",{className:"agent-badge transcript-ag\
ent-badge",style:{color:t.color,borderColor:t.color+"55",background:t.color+"18"}},t.logo?React.createElement("img",{src:t.
logo,alt:t.abbr,className:"agent-badge-logo"}):t.abbr)),React.createElement("div",{className:"assistant-content"},React.
createElement("div",{className:"message-role"},React.createElement("span",{className:"message-role-label"},t.name),React.
createElement(sc,{instant:e?.startedAtMs})),React.createElement("div",{className:"provisional-stream-text",ref:s}),e?.open&&
React.createElement("span",{className:"provisional-stream-caret","aria-label":"Streaming response"})))}function Hw({msg:e,
messageKey:t,activeAgent:n,assistantMonospace:s,autoExpandLongCodeBlocks:a,onOpenPath:o,agentType:c,preview:u,fileContents:m,
onClosePreview:f,deliveryState:v,onSteer:k,onRetry:R,richContentEager:S,searchMatch:T=!1}){let b=rn(e.content)||rc(e.content_blocks),
w=ow(e.content),h=qi(e),M=e.role!=="user"&&Ji(e.content_blocks).length>0,C=e.source_message_id||e.native_source_id||"",_=sw(
e),L=aw(e),P=$l(e);if(e.role==="user"){let V=P?{[P]:v}:{};return React.createElement("div",{className:`message user tran\
script-virtual-row${e.status==="failed"||e._optimistic&&v==="failed"?" failed":""}${T?" search-match":""}`,"data-message\
-key":t,"data-message-id":e.id||void 0,"data-message-role":"user","data-message-block-type":L,"data-message-content-hash":_,
"data-message-source-id":C||void 0,"data-client-message-id":P||void 0,"data-delivery-attempt":e.delivery_attempt||e._deliveryAttempt||
void 0,"data-message-timestamp":h?.iso||"unknown"},React.createElement("div",{className:"user-gutter"},React.createElement(
"div",{className:"user-glyph"})),React.createElement("div",{className:"user-content"},React.createElement("div",{className:"\
message-role"},React.createElement("span",{className:"message-role-label"},"You"),React.createElement(sc,{message:e}),React.
createElement(qw,{msg:e,deliveryStates:V,onSteer:k,onRetry:R})),/!\[[^\]]*\]\((?:data:|\/uploads\/)/.test(w)?React.createElement(
"div",{className:"user-text"},React.createElement(Pi,{content:w,deferUntilVisible:!S,cacheIdentity:`${t}:user`})):React.
createElement("div",{className:"user-text"},b)))}return React.createElement("div",{className:`message assistant transcri\
pt-virtual-row${s?" monospace":""}${T?" search-match":""}`,"data-message-key":t,"data-message-id":e.id||void 0,"data-mes\
sage-role":"assistant","data-message-block-type":L,"data-message-content-hash":_,"data-message-source-id":C||void 0,"dat\
a-message-timestamp":h?.iso||"unknown"},React.createElement("div",{className:"assistant-gutter"},React.createElement("di\
v",{className:"agent-badge transcript-agent-badge",style:{color:n.color,borderColor:n.color+"55",background:n.color+"18"}},
n.logo?React.createElement("img",{src:n.logo,alt:n.abbr,className:"agent-badge-logo"}):n.abbr)),React.createElement("div",
{className:"assistant-content"},React.createElement("div",{className:"message-role"},React.createElement("span",{className:"\
message-role-label"},n.name),React.createElement(sc,{message:e})),M?React.createElement(mw,{blocks:e.content_blocks,monospace:s,
autoExpandLongCodeBlocks:a,onOpenPath:V=>o(t,V),agentType:c,richContentEager:S,richContentCacheIdentity:t}):React.createElement(
Pi,{content:rn(e.content),monospace:s,autoExpandLongCodeBlocks:a,onOpenPath:V=>o(t,V),deferUntilVisible:!S,cacheIdentity:`${t}\
:assistant`}),u&&React.createElement(Rk,{sessionId:u.sessionId,filePath:u.path,fileContents:m,onClose:f})))}function lg(e){
return e?`${e.sessionId}${e.messageKey}${e.path}`:""}function ep(e){return[e?.name,e?.color,e?.abbr,e?.logo||""].join(
"")}function zw(e,t){return e.msg===t.msg&&e.messageKey===t.messageKey&&e.assistantMonospace===t.assistantMonospace&&e.
autoExpandLongCodeBlocks===t.autoExpandLongCodeBlocks&&e.agentType===t.agentType&&ep(e.activeAgent)===ep(t.activeAgent)&&
lg(e.preview)===lg(t.preview)&&e.fileContents===t.fileContents&&e.deliveryState===t.deliveryState&&e.onRetry===t.onRetry&&
e.richContentEager===t.richContentEager&&e.searchMatch===t.searchMatch}var Uw=React.memo(Hw,zw),Gw=100,xl=1200,ga=32;function ug(e){
let t=rn(e?.content)||rc(e?.content_blocks),n=Math.max(1,ce(t).split(`
`).length);if(e?.role==="user")return Math.min(180,40+Math.max(0,n-1)*18);let s=Math.ceil(ce(t).length/100),a=Ji(e?.content_blocks).
length*28;return Math.min(420,68+Math.max(n,s)*18+a)}function Cl(e,t){let n=0,s=Math.max(0,e.length-1);for(;n<s;){let a=Math.
floor((n+s)/2);e[a]<=t?n=a+1:s=a}return Math.max(0,n-1)}function Ww({index:e,messageKey:t,onMeasure:n,children:s}){let a=React.
useRef(null);return React.useLayoutEffect(()=>{let o=a.current;if(!o)return;let c=()=>n(e,t,o.getBoundingClientRect().height,
o);if(c(),typeof ResizeObserver>"u")return;let u=new ResizeObserver(c);return u.observe(o),()=>u.disconnect()},[e,t,n]),
React.createElement("div",{className:"transcript-window-row","data-window-index":e,ref:a},s)}function Kw({messages:e,containerRef:t,
sessionId:n,routeActive:s,suppressProgrammaticScrollRef:a,scrollCoordinatorRef:o}){let c=s&&e.length>Gw,u=React.useRef(c);
u.current=c;let m=React.useRef(new Map),f=React.useRef(n);f.current!==n&&(m.current.clear(),f.current=n);let v=React.useRef(
[0]),k=React.useRef(null),R=React.useRef(null),S=React.useRef(0),T=React.useRef(0),b=React.useRef({sessionId:null,keys:[],
prefix:[0]}),w=React.useRef(0),h=React.useRef(0),M=React.useRef(null),C=React.useRef(null),_=React.useRef(0),L=React.useRef(
0),[P,V]=React.useState(0),[Z,oe]=React.useState({sessionId:null,start:0,end:0}),ge=React.useCallback(()=>a?.current?.()!==
!0,[a]),W=React.useCallback((ee,H,E,z={})=>ee?typeof o?.current=="function"?o.current(ee,H,E,z)===!0:ge()?(Jd(ee,H,{container:"\
transcript",writer:"virtual-transcript-fallback",reason:E,sessionId:n}),!0):!1:!1,[ge,o]),te=React.useMemo(()=>e.map((ee,H)=>`${n||
""}${Ll(ee,H)}`),[e,n]),X=React.useMemo(()=>{let ee=new Array(e.length+1);ee[0]=0;for(let H=0;H<e.length;H+=1){let E=m.
current.get(te[H]);ee[H+1]=ee[H]+(E||ug(e[H]))}return ee},[e,te,P]);v.current=X;let ue=React.useCallback(()=>{if(R.current)
return;let ee=t.current;if(!c||!ee)return;let H=ee.getBoundingClientRect(),E=H.top,z=Array.from(ee.querySelectorAll(".tr\
anscript-window-row[data-window-index]")),fe=z.find(ye=>{let Me=ye.getBoundingClientRect();return Me.top>=E&&Me.top<H.bottom})||
z.find(ye=>ye.getBoundingClientRect().bottom>E)||z[0];if(!fe)return;let ie=Number(fe.dataset.windowIndex);!Number.isInteger(
ie)||!te[ie]||(k.current={sessionId:n,key:te[ie],viewportOffset:fe.getBoundingClientRect().top-E})},[t,c,te,n]),J=React.
useCallback(()=>{M.current=null,C.current=null,_.current&&clearTimeout(_.current),_.current=0},[]),pe=React.useCallback(
()=>{let ee=t.current;if(!c||!ee)return;let H=R.current;if(H?.sessionId===n){let Re=te.indexOf(H.key);if(Re>=0){oe(F=>F.
sessionId===n&&F.start===Re&&F.end===Math.min(e.length,Re+ga)?F:{sessionId:n,start:Re,end:Math.min(e.length,Re+ga)});return}}
ue();let E=v.current,z=Math.max(0,ee.scrollTop-xl),fe=ee.scrollTop+ee.clientHeight+xl,ie=Math.max(0,Cl(E,z)-1),ye=Math.min(
e.length,Cl(E,fe)+2),Me=ye>=e.length?Math.max(0,e.length-ga):ie,ke=ye,Ee=C.current,He=Ee?te.indexOf(Ee):M.current;He>=0&&
(M.current=He);let ae=He;Number.isInteger(ae)&&ae>=0&&ae<e.length&&(Me=Math.min(Me,Math.max(0,ae-ga)),ke=Math.max(ke,Math.
min(e.length,ae+ga+1))),React.startTransition(()=>{oe(Re=>Re.sessionId===n&&Re.start===Me&&Re.end===ke?Re:{sessionId:n,start:Me,
end:ke})})},[ue,t,c,te,e.length,n]);React.useLayoutEffect(()=>{let ee=b.current;if(b.current={sessionId:n,keys:te,prefix:X},
!c||ee.sessionId!==n||!ee.keys.length){R.current?.routeRestore||(R.current=null),S.current&&clearTimeout(S.current),S.current=
0,ue();return}let H=k.current;if(!H||H.sessionId!==n||!H.key)return;let E=ee.keys.indexOf(H.key),z=te.indexOf(H.key);if(E<
0||z<0||E===z)return;let fe=t.current;if(!fe)return;let ie=ee.prefix[E]||0,ye=X[z]||0;R.current={sessionId:n,key:H.key,viewportOffset:H.
viewportOffset},M.current=z,C.current=H.key,S.current&&clearTimeout(S.current),S.current=setTimeout(()=>{R.current=null,
S.current=0,J(),ue()},1500),oe({sessionId:n,start:z,end:Math.min(e.length,z+ga)}),W(fe,Math.max(0,fe.scrollTop+ye-ie),"v\
irtual-window-key-reorder",{anchorId:H.key,anchorOffset:H.viewportOffset})||(R.current=null,J())},[ue,t,c,te,e.length,X,
J,n,W]),React.useLayoutEffect(()=>{let ee=R.current;if(!ee||ee.sessionId!==n)return;let H=te.indexOf(ee.key);if(H<Z.start||
H>=Z.end)return;let E=t.current,z=E?.querySelector(`.transcript-window-row[data-window-index="${H}"]`);if(!E||!z)return;
if(ee.atBottom){if(!W(E,E.scrollHeight,"virtual-anchor-bottom",{anchorId:ee.key,anchorOffset:ee.viewportOffset})){R.current=
null,J(),ue();return}k.current=ee;return}let ie=z.getBoundingClientRect().top-E.getBoundingClientRect().top-ee.viewportOffset;
if(Math.abs(ie)>=.5&&!W(E,Math.max(0,E.scrollTop+ie),"virtual-anchor-correction",{anchorId:ee.key,anchorOffset:ee.viewportOffset})){
R.current=null,J(),ue();return}k.current=ee},[ue,t,c,te,X,Z,J,n,W]),React.useLayoutEffect(()=>{let ee=R.current;if(!c||!ee?.
routeRestore)return;let H=!0,E=()=>{if(!H)return;let z=R.current,fe=t.current;if(!z?.routeRestore||z.sessionId!==n||!fe)
return;let ie=te.indexOf(z.key),ye=ie>=0?fe.querySelector(`.transcript-window-row[data-window-index="${ie}"]`):null;if(ye)
if(z.atBottom)W(fe,fe.scrollHeight,"route-anchor-bottom",{allowWhenUserOwned:!0,retainUserOwnership:!0});else{let ke=ye.
getBoundingClientRect().top-fe.getBoundingClientRect().top-z.viewportOffset;Math.abs(ke)>=.5&&W(fe,Math.max(0,fe.scrollTop+
ke),"route-anchor-correction",{allowWhenUserOwned:!0,retainUserOwnership:!0})}T.current=requestAnimationFrame(E)};return E(),
S.current&&clearTimeout(S.current),S.current=setTimeout(()=>{R.current=null,S.current=0,T.current&&cancelAnimationFrame(
T.current),T.current=0,J(),ue()},1500),()=>{H=!1,T.current&&cancelAnimationFrame(T.current),T.current=0}},[ue,t,c,te,J,n,
W]),React.useLayoutEffect(()=>{if(!c){J();return}let ee=t.current;if(!ee)return;pe();let H=()=>{ue();let E=C.current,z=E?
te.indexOf(E):M.current;z>=0&&(M.current=z);let fe=z,ie=v.current;if(Number.isInteger(fe)&&fe>=0&&fe<e.length){let ye=ie[fe]||
0,Me=ie[fe+1]||ye,ke=ee.scrollTop,Ee=ke+ee.clientHeight;(Me<ke-xl||ye>Ee+xl)&&J()}h.current||(h.current=requestAnimationFrame(
()=>{h.current=0,pe()}))};return ee.addEventListener("scroll",H,{passive:!0}),()=>{ee.removeEventListener("scroll",H),h.
current&&cancelAnimationFrame(h.current),h.current=0}},[ue,c,s,n,te,e.length,pe,J]),React.useLayoutEffect(()=>{c&&pe()},
[c,X,pe]),React.useLayoutEffect(()=>{if(!c||P===0)return;let ee=t.current;ee&&W(ee,ee.scrollHeight,"virtual-row-resize-s\
ettled")},[t,c,P,W]);let Ce=React.useCallback((ee,H,E,z=null)=>{if(!u.current)return;let fe=Math.max(1,Math.ceil(E)),ie=m.
current.get(H)||ug(e[ee]),ye=typeof window<"u"?window.__RAC_TEMPORAL_CANARY__:null;if(ye?.active){let Ee=ye.transcriptMeasurements||
(ye.transcriptMeasurements=[]);if(Ee.length<4e3&&Math.abs(fe-ie)>=1){let He=t.current,ae=z?.querySelector?.(".message[da\
ta-message-key]")||null,Re=ae?.getBoundingClientRect?.()||null,F=z?.getBoundingClientRect?.()||null;Ee.push({at_epoch_ms:Date.
now(),index:ee,key:H,rendered_window_index:Number(z?.dataset?.windowIndex??ee),rendered_message_key:ae?.dataset?.messageKey||
null,rendered_message_role:ae?.dataset?.messageRole||null,rendered_message_height_px:Re?Number(Re.height.toFixed(3)):null,
rendered_message_top_px:Re?Number(Re.top.toFixed(3)):null,wrapper_top_px:F?Number(F.top.toFixed(3)):null,raw_height_px:Number(
E.toFixed(3)),next_height_px:fe,previous_height_px:ie,delta_px:fe-ie,anchor_index:He?Cl(v.current,He.scrollTop):null,scroll_top:He?.
scrollTop??null})}}if(Math.abs(fe-ie)<1)return;m.current.set(H,fe);let Me=t.current,ke=Me?Cl(v.current,Me.scrollTop):0;ee<
ke&&(L.current+=fe-ie),!w.current&&(w.current=requestAnimationFrame(()=>{if(w.current=0,!u.current){L.current=0;return}let Ee=t.
current,He=L.current;L.current=0,Ee&&Math.abs(He)>=1&&W(Ee,Math.max(0,Ee.scrollTop+He),"virtual-row-resize-correction",{
anchorId:C.current||k.current?.key||null}),V(ae=>ae+1)}))},[t,e,W]);React.useLayoutEffect(()=>{c||!w.current||(cancelAnimationFrame(
w.current),w.current=0,L.current=0)},[c]),React.useEffect(()=>()=>{w.current&&cancelAnimationFrame(w.current),h.current&&
cancelAnimationFrame(h.current),_.current&&clearTimeout(_.current),S.current&&clearTimeout(S.current),T.current&&cancelAnimationFrame(
T.current)},[]);let se=React.useCallback((ee,H="center")=>{let E=t.current,z=v.current;if(!E||ee<0||ee>=e.length)return!1;
M.current=ee,C.current=te[ee]||null,_.current&&clearTimeout(_.current),_.current=setTimeout(()=>{J()},1500);let fe=z[ee]||
0,ie=z[ee+1]||fe,ye=H==="start"?fe:H==="end"?ie-E.clientHeight:fe-Math.max(0,(E.clientHeight-(ie-fe))/2);W(E,Math.max(0,
ye),"operator-scroll-to-message",{allowWhenUserOwned:!0,takeUserOwnership:!0});let Me=Math.max(0,ee-ga),ke=Math.min(e.length,
ee+ga+1);return oe({sessionId:n,start:Me,end:ke}),!0},[t,te,e.length,J,n,W]),Q=React.useCallback(()=>{ue();let ee=k.current;
if(!ee||ee.sessionId!==n)return!1;let H=te.indexOf(ee.key);return H<0?!1:(M.current=H,C.current=ee.key,!0)},[ue,te,n]),de=React.
useCallback(()=>{let ee=t.current;if(!c||!ee)return!1;ue();let H=k.current;if(!H||H.sessionId!==n||!H.key)return!1;let E=te.
indexOf(H.key);return E<0?!1:(R.current={...H,routeRestore:!0,atBottom:ee.scrollHeight-ee.scrollTop-ee.clientHeight<80},
M.current=E,C.current=H.key,!0)},[ue,t,c,te,n]),he=React.useCallback(()=>R.current?.routeRestore?(R.current=null,S.current&&
clearTimeout(S.current),S.current=0,T.current&&cancelAnimationFrame(T.current),T.current=0,J(),ue(),!0):!1,[ue,J]),xe=0,
be=e.length;return c&&(Z.sessionId===n&&Z.end>Z.start?(xe=Z.start,be=Z.end):xe=Math.max(0,e.length-ga)),{enabled:c,start:xe,
end:be,totalHeight:X[X.length-1]||0,topSpacerHeight:c&&X[xe]||0,bottomSpacerHeight:c?X[X.length-1]-(X[be]||0):0,onMeasure:Ce,
scrollToIndex:se,prepareForPrepend:Q,prepareForRouteChange:de,cancelRouteRestore:he}}function Vw({qm:e,onSteer:t,onDiscard:n,
onEdit:s}){let[a,o]=React.useState(!1),[c,u]=React.useState(!1),[m,f]=React.useState(e.content),v=React.useRef(null);return React.
useEffect(()=>{if(!a)return;let k=R=>{v.current&&!v.current.contains(R.target)&&o(!1)};return document.addEventListener(
"mousedown",k),()=>document.removeEventListener("mousedown",k)},[a]),c?React.createElement("div",{className:"queued-item\
 editing"},React.createElement("textarea",{className:"queued-edit-input",value:m,onChange:k=>f(k.target.value),onKeyDown:k=>{
k.key==="Enter"&&!k.shiftKey&&(k.preventDefault(),s(m),u(!1)),k.key==="Escape"&&u(!1)},rows:2,autoFocus:!0}),React.createElement(
"button",{className:"steer-btn",onClick:()=>{s(m),u(!1)}},"Save"),React.createElement("button",{className:"queued-trash-\
btn",onClick:()=>u(!1),title:"Cancel"},"\u2715")):e.native?React.createElement("div",{className:"queued-item native"},React.
createElement("span",{className:"queued-item-text"},e.content),e.status&&e.status!=="queued"&&React.createElement("span",
{className:`queued-item-status ${e.status}`},e.status),React.createElement("div",{className:"queued-actions"},React.createElement(
"button",{className:"steer-btn",onClick:t,title:"Click Steer in Codex"},"Steer \u25B8"),React.createElement("button",{className:"\
queued-trash-btn",onClick:n,title:"Delete queued message"},"\u{1F5D1}"))):React.createElement("div",{className:"queued-i\
tem"},React.createElement("span",{className:"queued-item-text"},e.content),React.createElement("div",{className:"queued-\
actions"},React.createElement("button",{className:"steer-btn",onClick:t,title:"Send to agent now"},"Steer \u25B8"),React.
createElement("button",{className:"queued-trash-btn",onClick:n,title:"Discard message"},"\u{1F5D1}"),React.createElement(
"div",{className:"queued-menu-wrap",ref:v},React.createElement("button",{className:"queued-more-btn",onClick:()=>o(!a),title:"\
More options"},"\xB7\xB7\xB7"),a&&React.createElement("div",{className:"queued-dropdown"},React.createElement("button",{
onClick:()=>{o(!1),f(e.content),u(!0)}},"\u270F Edit message"),React.createElement("button",{onClick:()=>{o(!1),n()}},"\u{1F5D1}\
 Discard")))))}function Yw({session:e,health:t,unread:n,isThinking:s,isActive:a,agentConfig:o,activity:c,sessionMessages:u,
hasBlockingPrompt:m,blockingPromptLabel:f,muted:v,pinned:k,workspaceLabel:R,recentMessageAt:S,menuOpen:T,onMenuToggle:b,
onSelect:w,onClose:h,onManage:M,onPinChange:C,onAutomations:_,showAutomationsActive:L,onSkills:P,showSkillsActive:V}){let Z=je(
e),oe=Qi(e,o),ge=Xi(e,Z,o),W=tc(e,Z,o,u),te=[W,ge||oe.name].filter(Boolean).join(" - "),X=Pw[t]||"#444c56",ue=e?.rate_limited_until||
null,J=e?.rate_limit_active===!0,pe=e?.percent_used,Ce=e?.agent_type==="antigravity"||e?.agent_type==="antigravity_panel",
se=Ce?Ig(e?.antigravity_quota_models,3):"",Q=nl(c,{health:t}),de=s?Q||c?.label||"Working":null,he=Pg(e),xe=R?`${oe.name}\
 / ${R}`:oe.name,be=S?js(S):null;return React.createElement("div",{className:`session-card${a?" active":""}${J?" rate-li\
mited":""}${k?" pinned":""}`,"data-session-id":Z,"data-last-message-at":be?.iso||void 0,onClick:w,onKeyDown:ee=>{ee.target!==
ee.currentTarget||!["Enter"," "].includes(ee.key)||(ee.preventDefault(),w())},tabIndex:0,"aria-label":`${W}. ${ge||oe.name}`,
title:te||Z},React.createElement("div",{className:"session-card-badge-wrap"},React.createElement("div",{className:"agent\
-badge",style:{color:oe.color,borderColor:oe.color+"55",background:oe.color+"18"}},oe.logo?React.createElement("img",{src:oe.
logo,alt:oe.abbr,className:"agent-badge-logo"}):oe.abbr),React.createElement("div",{className:"session-card-health",style:{
background:X},title:t||"unknown"}),v&&React.createElement("span",{className:"session-card-muted",title:"Notifications mu\
ted","aria-label":"Notifications muted"},"M"),k&&React.createElement("button",{type:"button",className:"session-card-pin\
-toggle",title:`Unpin ${W}`,"aria-label":`Unpin ${W}`,"aria-pressed":"true",onClick:ee=>{ee.preventDefault(),ee.stopPropagation(),
C?.(!1)}},React.createElement("span",{"aria-hidden":"true"},"\u{1F4CC}")),React.createElement("span",{className:"session\
-card-attention-slot"},m&&React.createElement("span",{className:"session-card-perm-badge",title:f||"Action required"},"\u26A0"),
!m&&J&&React.createElement("span",{className:"session-card-perm-badge",title:"Usage limited"},"\u23F3"),!m&&!J&&s&&React.
createElement("span",{className:"session-card-native-status",title:de||"Thinking\u2026"},React.createElement(nc,{agentType:e?.
agent_type,compact:!0,animate:!1})),!s&&!m&&!J&&n>0&&React.createElement("span",{className:"session-card-badge"},n>99?"9\
9+":n))),React.createElement("div",{className:"session-card-body"},React.createElement(bl,{title:W,disclosureKey:Z,kind:"\
session",wrapperClassName:"session-title-details",triggerClassName:"session-card-name",disclosureClassName:"session-titl\
e-disclosure",triggerLabel:`Show full title: ${W}`,triggerTag:"div"}),React.createElement("div",{className:`session-card\
-sub${m?" perm-active":""}${be?" has-recent-message":""}`},React.createElement("span",{className:"session-card-sub-conte\
xt"},m?`${xe} \xB7 ${f||"Action required"}`:J?`${xe} \xB7 \u23F3 Usage limited${ue&&ue!=="unknown"?` \xB7 resets ${ac(ue)}`:
" \xB7 reset unknown"}`:se?`${xe} \xB7 ${se}`:Ce&&pe!=null?`${xe} \xB7 \u{1F4CA} ${pe}% used${ue&&ue!=="unknown"?` \xB7 ${ue}`:
""}`:pe>=75?`${xe} \xB7 \u{1F4CA} ${pe}% used${ue&&ue!=="unknown"?` \xB7 resets ${ac(ue)}`:""}`:de?`${xe} \xB7 ${de}`:he?
`${xe} \xB7 ${he}`:xe),be&&React.createElement(React.Fragment,null,React.createElement("span",{"aria-hidden":"true"}," \xB7\
 "),React.createElement("time",{dateTime:be.iso},Ku(be))))),React.createElement("div",{className:"session-card-right"},React.
createElement("details",{className:"session-card-menu",open:T,onToggle:ee=>b?.(ee.currentTarget.open),onClick:ee=>ee.stopPropagation()},
React.createElement("summary",{className:"session-card-manage",title:"Session actions","aria-label":`Session actions for\
 ${W}`},"\u22EF"),React.createElement("div",{className:"session-card-menu-popover",role:"menu","aria-label":`Actions for\
 ${W}`},React.createElement("button",{role:"menuitem",onClick:()=>C?.(!k)},k?"Unpin chat":"Pin chat"),React.createElement(
"button",{role:"menuitem",onClick:()=>M&&M()},"Manage session"),_&&React.createElement("button",{role:"menuitem",className:L?
"active":"",onClick:()=>_()},"Automations"),P&&React.createElement("button",{role:"menuitem",className:V?"active":"",onClick:()=>P()},
"Skills"),React.createElement("button",{role:"menuitem",className:"danger",onClick:()=>h&&h()},"Close session")))))}function dg(e){
let t=Array.isArray(e)?e:[];if(!t.length)return"0";let n=t[0],s=t[t.length-1];return[t.length,n?.role||"",ce(n?.content).
slice(0,120),s?.role||"",ce(s?.content).slice(0,120)].join("")}function pg(e){return e?[e.model_id||"",e.effort||"",e.permission_mode||
"",e.file_access_scope||""].join(""):""}function mg(e){return e?[e.kind||"",e.label||"",e.goal?.status||"",e.goal?.label||
"",e.goal_run?.lifecycle||"",e.goal_run?.lease_active===!0?"leased":"released",e.goal_run?.transition_id||""].join(""):
""}function Xw(e,t){return e.session===t.session&&e.health===t.health&&e.unread===t.unread&&e.isThinking===t.isThinking&&
e.isActive===t.isActive&&e.hasBlockingPrompt===t.hasBlockingPrompt&&e.blockingPromptLabel===t.blockingPromptLabel&&e.muted===
t.muted&&e.pinned===t.pinned&&e.workspaceLabel===t.workspaceLabel&&e.recentMessageAt===t.recentMessageAt&&e.menuOpen===t.
menuOpen&&e.showAutomationsActive===t.showAutomationsActive&&e.showSkillsActive===t.showSkillsActive&&pg(e.agentConfig)===
pg(t.agentConfig)&&mg(e.activity)===mg(t.activity)&&dg(e.sessionMessages)===dg(t.sessionMessages)}var Qw=React.memo(Yw,Xw),
fg=["\xB7","\u2722","*","\u2736","\u273B","\u273D"],El=[...fg,...[...fg].reverse()];function Jw(){let[e,t]=React.useState(
0),[n,s]=React.useState(()=>typeof window<"u"&&typeof window.matchMedia=="function"&&window.matchMedia("(prefers-reduced\
-motion: reduce)").matches);return React.useEffect(()=>{if(typeof window>"u"||typeof window.matchMedia!="function")return;
let a=window.matchMedia("(prefers-reduced-motion: reduce)"),o=c=>s(c.matches);return s(a.matches),a.addEventListener?.("\
change",o),()=>a.removeEventListener?.("change",o)},[]),React.useEffect(()=>{if(n){t(0);return}let a=El.length*3,o=setInterval(
()=>{if(a-=1,a<=0){clearInterval(o),t(0);return}t(c=>(c+1)%El.length)},120);return()=>clearInterval(o)},[n]),React.createElement(
"span",{className:"claude-spinner-icon"},El[e])}function hg(e,t){let n=e?new Date(e).getTime():0;if(!Number.isFinite(n)||
n<=0)return"";let s=Math.max(0,Math.floor((t-n)/1e3));return cp(s,{includeSeconds:!0})}function cp(e,{includeSeconds:t=!1}={}){
if(e=Math.max(0,Math.floor(Number(e)||0)),e<60)return`${e}s`;let n=Math.floor(e/60),s=e%60;if(n<60)return t?`${n}m ${String(
s).padStart(2,"0")}s`:`${n}m`;let a=Math.floor(n/60),o=n%60;return a>=24?`${Math.floor(a/24)}d ${String(a%24).padStart(2,
"0")}h ${String(o).padStart(2,"0")}m${t?` ${String(s).padStart(2,"0")}s`:""}`:`${a}h ${String(o).padStart(2,"0")}m${t?` ${String(
s).padStart(2,"0")}s`:""}`}function qg(e,t,n=null){return e?cp(df(e,n,t),{includeSeconds:!0}):""}function Zw({activity:e,
thinkingText:t,agentType:n,pinned:s=!1,mobileExpanded:a=!1,onMobileExpandedChange:o=null,mobileDisclosureId:c="mobile-li\
ve-status-details"}){let u=e?.kind||"working",m=ig[u]||ig.working,f=e?.goal||null,v=m.tone==="thinking"||m.tone==="info",
R=(f?.state||f?.status)==="active"&&(!e?.goal_run||e.goal_run.lease_active===!0),S=!!(e?.thinking||e?.current),T=String(
t||e?.thinkingContent||"").trim(),b=n==="claude"||n==="claude_cli",w=e?.thinking||(!S&&(u==="thinking"||b)?{text:T,since:e?.
startedAt||e?.updatedAt||null}:null),h=e?.current||(!S&&!w&&v?{kind:u==="running_command"?"tool":"answer",label:e?.label||
(u==="running_command"?"Running command":"Working"),partial:T,since:e?.startedAt||e?.updatedAt||null}:null),M=e?.connection||
null,C=e?.interruption?.resolution_state==="unresolved"?e.interruption:null,_=e?.step||null,L=e?.usage||null,[P,V]=React.
useState(Date.now()),Z=w?w.since||e?.startedAt||e?.updatedAt:null,oe=h?h.since||e?.startedAt||e?.updatedAt:null,ge=de=>!!de&&
Number.isFinite(new Date(de).getTime()),W=R&&ge(f?.updated_at)||ge(Z)||ge(oe);React.useEffect(()=>{if(!W)return;let de=setInterval(
()=>V(Date.now()),1e3);return()=>clearInterval(de)},[W,f?.updated_at,Z,oe]);let te=e?.interruptHint||e?.interrupt_hint||
"",X=f?qg(f,P,e?.goal_run):"",ue=String(f?.text||f?.objective||"").trim(),J=w?hg(Z,P):"",pe=h?hg(oe,P):"";if(!f&&!w&&!h&&
!M&&!C&&!_&&!L)return null;let Ce=!!C?.blocking||M?.state==="failed"||!!L,se=[C,M,h,w,_,f,L].filter(Boolean).length,Q=C?.
title||(M?.state==="failed"?M.label:"")||L?.title||h?.label||w?.label||f?.label||e?.label||"Working";return React.createElement(
"div",{className:`live-status-stack${s?" pinned":""}${a?" mobile-live-status-expanded":" mobile-live-status-collapsed"}${Ce?
" needs-attention":""}`,"data-testid":"live-status-stack"},React.createElement("button",{type:"button",className:"mobile\
-live-status-summary","aria-expanded":a,"aria-controls":c,"aria-label":`${a?"Hide":"Show"} current agent activity detail\
s`,onClick:()=>o?.(!a)},React.createElement("span",{className:"mobile-live-status-icon","aria-hidden":"true"},Ce?"!":"\u25CF"),
React.createElement("span",{className:"mobile-live-status-label"},Q),React.createElement("span",{className:"mobile-live-\
status-meta"},Ce?"Needs attention":`${se} active`),React.createElement("span",{className:"mobile-disclosure-chevron","ar\
ia-hidden":"true"},a?"\u2303":"\u2304")),React.createElement("div",{className:"live-status-details",id:c},C&&React.createElement(
"div",{className:`live-native-interruption-row ${C.severity||"error"}`,"data-live-channel":"native-interruption","data-i\
nterruption-event-id":C.event_id||"",role:C.blocking?"alert":"status","aria-live":C.blocking?"assertive":"polite","aria-\
label":`${C.title||"Harness interruption"}. ${C.safe_display_text||""}`},React.createElement("div",{className:"live-nati\
ve-interruption-heading"},React.createElement("span",{className:"live-native-interruption-icon","aria-hidden":"true"},"!"),
React.createElement("span",{className:"live-status-label"},C.title||"Harness interruption"),C.blocking&&React.createElement(
"span",{className:"live-status-meta"},"Needs attention")),C.safe_display_text&&React.createElement("div",{className:"liv\
e-native-interruption-detail"},C.safe_display_text),React.createElement("div",{className:"live-native-interruption-meta"},
[C.native_timestamp?new Date(C.native_timestamp).toLocaleString():"",C.retryable?"Retry may be available in the native h\
arness":"Open the native session for recovery"].filter(Boolean).join(" \xB7 "))),M&&React.createElement("div",{className:`\
live-native-connection-row ${M.state||"reconnecting"}`,"data-live-channel":"native-connection","data-connection-generati\
on":M.generation||"","data-connection-attempt":M.attempt||"",role:M.state==="failed"?"alert":"status","aria-live":M.state===
"failed"?"assertive":"polite","aria-label":`Codex native connection. ${M.label||"Connection status"}`},React.createElement(
"span",{className:"live-native-connection-icon","aria-hidden":"true"},"\u2301"),React.createElement("span",{className:"l\
ive-status-label"},M.label||"Native connection status"),M.state==="failed"&&React.createElement("span",{className:"live-\
status-meta"},"Needs attention")),h&&React.createElement("div",{className:`live-current-status ${h.kind||"answer"}`,"dat\
a-live-channel":"current"},React.createElement("div",{className:"live-current-tool-heading"},h.kind==="tool"?React.createElement(
"span",{className:"live-status-icon"},"\u25B6"):React.createElement(nc,{agentType:n,compact:!0}),React.createElement("sp\
an",{className:"live-status-label"},h.label||(h.kind==="tool"?"Running tool":"Working")),React.createElement("span",{className:"\
live-status-meta"},[pe,te].filter(Boolean).join(" \xB7 "))),h.partial&&(h.kind==="tool"?React.createElement("pre",{className:"\
live-current-output"},h.partial):React.createElement("p",{className:"live-current-narration"},h.partial))),w&&React.createElement(
"div",{className:"live-thinking-row","data-live-channel":"thinking"},React.createElement("div",{className:"live-thinking\
-heading"},React.createElement(nc,{agentType:n}),React.createElement("span",{className:"live-status-label"},w.label||e?.
label||"Thinking"),J&&React.createElement("span",{className:"live-status-meta"},J)),w.text&&React.createElement("div",{className:"\
live-thinking-text"},w.text)),_&&React.createElement("div",{className:"live-step-wrap","data-live-channel":"step"},React.
createElement("div",{className:"live-step-chip",title:_.text||""},_.state==="in_progress"?React.createElement(nc,{agentType:n,
compact:!0}):React.createElement("span",null,"\u25CC"),React.createElement("span",null,"Step ",_.current||1," / ",_.total||
1),(_.added!=null||_.deleted!=null)&&React.createElement("span",{className:"live-step-diff"},"\xB7 +",_.added||0," \u2212",
_.deleted||0))),f&&React.createElement("details",{className:"live-goal-row","data-live-channel":"goal"},React.createElement(
"summary",{title:ue},React.createElement("span",{className:"live-status-icon"},"\u26F3"),React.createElement("span",{className:"\
live-status-label"},f.label||"Pursuing goal"),React.createElement("span",{className:"live-goal-objective"},ue||"Active g\
oal"),React.createElement("span",{className:"live-status-meta"},X||f.state||f.status||"active")),ue&&React.createElement(
"div",{className:"live-goal-expanded"},ue)),L&&React.createElement("div",{className:"live-usage-banner","data-live-chann\
el":"usage",role:"status"},React.createElement("div",{className:"live-usage-title"},L.title||"Usage limit reached"),React.
createElement("div",{className:"live-usage-detail"},L.detail||(L.resets_at?`Your rate limit resets at ${L.resets_at}.`:"\
Usage is currently exhausted.")))))}function ek({taskList:e,sessionId:t}){let n=e?.content_blocks?.find(R=>R?.type==="pl\
an"),s=n?{...e,...n}:e;if(!s||!s.tasks||s.tasks.length===0)return null;let a=t?`remote-agent-chat:task-list-collapsed:${t}`:
null,o=!1,[c,u]=React.useState(()=>{if(!a)return o;let R=localStorage.getItem(a);return R==null?o:R==="1"});React.useEffect(
()=>{if(!a){u(o);return}let R=localStorage.getItem(a);u(R==null?o:R==="1")},[a,o]);let m=()=>{u(R=>{let S=!R;return a&&localStorage.
setItem(a,S?"1":"0"),S})},f={completed:"\u2713",in_progress:"\u25CC",pending:"\u25CB"},v={completed:"done",in_progress:"\
active",pending:""},k=s.tasks.find(R=>R.state==="in_progress");return React.createElement("div",{className:`codex-task-l\
ist${c?" collapsed":""}`},React.createElement("button",{type:"button",className:"codex-task-header",onClick:m,"aria-expa\
nded":!c,title:c?"Expand task list":"Collapse task list"},React.createElement("span",{className:"codex-task-chevron"},c?
"\u25B8":"\u25BE"),React.createElement("span",{className:"codex-task-count"},s.completed,"/",s.total," tasks"),c&&k?.text&&
React.createElement("span",{className:"codex-task-active-summary"},k.text)),!c&&React.createElement("div",{className:"co\
dex-task-items"},s.tasks.map((R,S)=>React.createElement("div",{key:S,className:`codex-task-item ${v[R.state]||""}`},React.
createElement("span",{className:"codex-task-icon"},f[R.state]||"\u25CB"),React.createElement("span",{className:"codex-ta\
sk-text"},R.text)))))}function tk({card:e,tone:t="cline"}){if(!e)return null;let n=Number.isFinite(Number(e.percent_used))?
Math.max(0,Math.min(100,Number(e.percent_used))):null,s=ce(e.title||"Current context"),a=ce(e.subtitle||""),o=ce(e.detail||
""),c=ce(e.label||e.usage_label||"");return React.createElement("div",{className:`cline-context-card ${t}-context-card`},
React.createElement("div",{className:"cline-context-header"},React.createElement("div",{className:"cline-context-copy"},
React.createElement("div",{className:"cline-context-title"},s),a&&React.createElement("div",{className:"cline-context-su\
btitle"},a),o&&React.createElement("div",{className:"cline-context-detail"},o)),c&&React.createElement("div",{className:"\
cline-context-usage"},c)),n!=null&&React.createElement("div",{className:"cline-context-meter",title:`${e.percent_used}% \
of context window used`},React.createElement("div",{className:"cline-context-meter-fill",style:{width:`${n}%`}})))}function Gs(e,t){
return e?.choice_id||e?.id||e?.value||`choice-${t}`}function Jo(e,t){return e?.label||e?.title||e?.text||e?.name||Gs(e,t)}
function lp(e,t){let n=new Set(Array.isArray(t)?t:[t]);return(Array.isArray(e?.content_blocks)?e.content_blocks:[]).find(
s=>n.has(s?.type))||null}function gg(e){return lp(e,"prompt")?.content||e?.prompt_text||e?.message||e?.text||"Agent requ\
ires permission to continue."}function Dg(e){let t=Math.max(0,Math.ceil(e/1e3)),n=Math.floor(t/60),s=t%60;return`${n}:${String(
s).padStart(2,"0")}`}function nk(e,t){return e?.deadline_at?t<=0?"Native deadline elapsed \xB7 awaiting receipt":`${e.auto_resolution_policy===
"native"?"Native auto-resolution in":"Response deadline in"} ${Dg(t)}`:""}function sk({prompt:e,sessionId:t,agentType:n,
onRespond:s,onDismissFocus:a,onMinimize:o,interactive:c=!0}){let[u,m]=React.useState(Date.now()),[f,v]=React.useState({}),
[k,R]=React.useState({}),[S,T]=React.useState({}),[b,w]=React.useState(""),[h,M]=React.useState(null),[C,_]=React.useState(
!1);React.useEffect(()=>{let H=setInterval(()=>m(Date.now()),500);return()=>clearInterval(H)},[]),React.useEffect(()=>{v(
{}),R({}),T({}),w(""),M(null),_(!1)},[e?.prompt_id]);let L=Math.max(0,Number(e?.timeout_ms)||0),P=Number(e?.received_at)||
Date.now(),V=Date.parse(e?.deadline_at||""),Z=e?.type==="question_prompt"&&Number.isFinite(V),oe=Z?Math.max(0,V-u):L>0?Math.
max(0,L-(u-P)):0,ge=Array.isArray(e?.choices)?e.choices:[],W=e?.submitting_choice_id||null,te=e?.type==="question_prompt"&&
e?.lifecycle!=="open",X=e?.default_choice||null,ue=(e?.kind==="question"||e?.type==="question_prompt")&&Array.isArray(e?.
questions)?e.questions.filter(H=>H&&typeof H=="object"):[],J=ue.length>0,pe=n==="claude"&&!J,Ce=ce(e?.command).trim(),se=ce(
e?.title).trim()||(Ce?"Allow this action?":gg(e)),Q=ce(e?.description).trim(),de=pe&&e?.alternate_instruction_supported===
!0,he=ue.flatMap(H=>(Array.isArray(H.choices)?H.choices:[]).map((E,z)=>({question:H,choiceId:Gs(E,z)}))).slice(0,9),xe=(H,E)=>{
v(z=>{let fe=Array.isArray(z[H.question_id])?z[H.question_id]:[],ie=H.multi_select?fe.includes(E)?fe.filter(ye=>ye!==E):
[...fe,E]:[E];return{...z,[H.question_id]:ie}})},be=ue.every(H=>{let E=Array.isArray(H.choices)?H.choices:[];if(H.answer_mode===
"text"||E.length===0)return H.required===!1||ce(S[H.question_id]).trim().length>0;let z=f[H.question_id]||[];return z.length===
0?!1:z.every(fe=>!E.find((ye,Me)=>Gs(ye,Me)===fe)?.requires_text||ce(k[`${H.question_id}:${fe}`]).trim())}),ee=()=>{if(!be||
W||te)return;let H=ue.map(E=>{let z=Array.isArray(E.choices)?E.choices:[];if(E.answer_mode==="text"||z.length===0)return{
question_id:E.question_id,text:ce(S[E.question_id]).trim()};let fe=f[E.question_id]||[],ie=z.find((ke,Ee)=>ke.requires_text&&
fe.includes(Gs(ke,Ee))),ye=ie?z.indexOf(ie):-1,Me=ie?Gs(ie,ye):null;return{question_id:E.question_id,choice_ids:fe,...Me?
{other_text:ce(k[`${E.question_id}:${Me}`]).trim()}:{}}});s(t,e.prompt_id,null,{answers:H})};return React.useEffect(()=>{
if(!c)return;let H=E=>{let z=E.target?.closest?.(".permission-card"),fe=E.target?.matches?.(".input-area textarea"),ie=E.
target===document.body||E.target===document.documentElement;if(!z&&!fe&&!ie||te&&E.key!=="Escape")return;if(E.key==="Esc\
ape"){if(E.preventDefault(),J&&e?.type==="question_prompt"&&e?.cancel_supported===!0&&!W&&!te){s(t,e.prompt_id,null,{action:"\
cancel"});return}let He=pe?ge.find((ae,Re)=>/^(?:reject|deny|cancel|block|not now|no)\b/i.test(Jo(ae,Re).replace(/^\d+\s+/,
""))):null;if(He&&!W){s(t,e.prompt_id,Gs(He,ge.indexOf(He)));return}_(!0),a?.();return}if(C)return;let ye=Zd(E.target),Me=E.
key==="Enter"&&E.target?.closest?.(".permission-other-input");if(E.key==="Enter"&&!E.shiftKey&&E.target?.closest?.(".per\
mission-alternate-input")){E.preventDefault();let He=b.trim();He&&!W&&s(t,e.prompt_id,null,{instruction:He});return}if(W||
ye&&!Me&&!fe)return;if(/^[1-9]$/.test(E.key)){let He=Number(E.key)-1;if(E.preventDefault(),J){let ae=he[He];ae&&xe(ae.question,
ae.choiceId)}else{let ae=ge[He];ae&&M(Gs(ae,He))}return}if(E.key!=="Enter")return;if(J){be&&(E.preventDefault(),ee());return}
let Ee=h||X;Ee&&ge.some((He,ae)=>Gs(He,ae)===Ee)&&(E.preventDefault(),s(t,e.prompt_id,Ee))};return window.addEventListener(
"keydown",H),()=>window.removeEventListener("keydown",H)},[b,ge,pe,X,te,C,h,a,s,e?.prompt_id,be,f,k,S,t,he,J,W,c]),React.
createElement("div",{className:"permission-overlay"},React.createElement("div",{className:`permission-card${pe?" permiss\
ion-card-claude":""}`,role:"dialog","aria-modal":"false","aria-label":pe?"Claude Code permission prompt":"Permission or \
question prompt",onPointerDown:()=>_(!1)},React.createElement(rt,{paneId:"native-action",onMinimize:o}),pe?React.createElement(
React.Fragment,null,React.createElement("div",{className:"permission-title permission-title-claude"},se),Ce&&React.createElement(
"pre",{className:"permission-command-claude"},Ce),Q&&React.createElement("div",{className:"permission-body permission-bo\
dy-claude"},Q)):React.createElement(React.Fragment,null,React.createElement("div",{className:"permission-eyebrow"},J?"Qu\
estion":"Permission Required"),React.createElement("div",{className:"permission-title"},J?ce(e?.title,"Answer the native\
 question"):`Agent Paused In ${t?Xi(t,t):"Active Session"}`),!J&&React.createElement("div",{className:"permission-body"},
gg(e)),React.createElement("div",{className:"permission-meta"},Z&&React.createElement("span",{className:"permission-time\
r"},nk(e,oe)),!Z&&L>0&&React.createElement("span",{className:"permission-timer"},"Auto-choice in ",Dg(oe)),X&&React.createElement(
"span",{className:"permission-default"},"Default: ",X))),e?.error&&React.createElement("div",{className:"permission-erro\
r"},e.error),React.createElement("div",{className:`permission-actions${J?" permission-question-list":""}`},J?ue.map((H,E)=>React.
createElement("fieldset",{className:"permission-question",key:H.question_id||E},React.createElement("legend",null,ce(H.header||
H.label,`Question ${E+1}`)),ce(H.message).trim()&&React.createElement("div",{className:"permission-question-message"},ce(
H.message)),React.createElement("div",{className:"permission-question-options"},H.answer_mode==="text"||!Array.isArray(H.
choices)||H.choices.length===0?React.createElement("input",{className:"permission-question-text-input",type:H.secret===!0?
"password":"text",value:S[H.question_id]||"",maxLength:2e3,disabled:!!W||te,autoComplete:"off",spellCheck:H.secret===!0?
"false":void 0,placeholder:H.secret===!0?"Enter private answer":"Enter answer","aria-label":`${ce(H.header||H.label,`Que\
stion ${E+1}`)} answer`,onChange:z=>T(fe=>({...fe,[H.question_id]:z.target.value}))}):H.choices.map((z,fe)=>{let ie=Gs(z,
fe),ye=(f[H.question_id]||[]).includes(ie),Me=`${H.question_id}:${ie}`;return React.createElement("div",{className:"perm\
ission-question-option",key:ie},React.createElement("button",{type:"button",className:`permission-action${ye?" selected":
""}`,role:H.multi_select?"checkbox":"radio","aria-checked":ye,disabled:!!W||te,"aria-keyshortcuts":he.findIndex(ke=>ke.question===
H&&ke.choiceId===ie)>=0?String(he.findIndex(ke=>ke.question===H&&ke.choiceId===ie)+1):void 0,onClick:()=>xe(H,ie)},he.findIndex(
ke=>ke.question===H&&ke.choiceId===ie)>=0&&React.createElement("kbd",{className:"permission-key-hint"},he.findIndex(ke=>ke.
question===H&&ke.choiceId===ie)+1),React.createElement("span",{className:"permission-choice-marker","aria-hidden":"true"},
H.multi_select?ye?"\u2713":"\u25A1":ye?"\u25CF":"\u25CB"),React.createElement("span",{className:"permission-choice-copy"},
React.createElement("span",null,Jo(z,fe)),ce(z?.description).trim()&&React.createElement("span",{className:"permission-a\
ction-desc"},ce(z.description)))),ye&&z.requires_text&&React.createElement("input",{className:"permission-other-input",type:H.
secret===!0?"password":"text",value:k[Me]||"",maxLength:2e3,disabled:!!W||te,autoComplete:"off",spellCheck:H.secret===!0?
"false":void 0,placeholder:"Enter another answer","aria-label":`${Jo(z,fe)} answer`,onChange:ke=>R(Ee=>({...Ee,[Me]:ke.target.
value}))}))})))):ge.map((H,E)=>{let z=Gs(H,E),fe=W===z,ie=X&&X===z,ye=h===z,Me=pe&&!h&&!X&&E===0,ke=pe?Jo(H,E).replace(new RegExp(
`^${E+1}\\s+`),""):Jo(H,E),Ee=pe?ce(H?.destination).trim():"",He=Ee&&ke.endsWith(Ee)?ke.slice(0,-Ee.length):ke;return React.
createElement("button",{key:z,className:`permission-action${ie?" default":""}${ye||Me?" selected":""}${fe?" pending":""}`,
disabled:!!W,"aria-pressed":ye||Me,"aria-keyshortcuts":E<9?String(E+1):void 0,onClick:()=>s(t,e.prompt_id,z)},E<9&&React.
createElement("kbd",{className:"permission-key-hint"},ce(H?.shortcut,String(E+1))),React.createElement("span",null,He,Ee&&
React.createElement("span",{className:"permission-choice-destination-claude"},Ee)),ce(H?.description).trim()&&React.createElement(
"span",{className:"permission-action-desc"},ce(H.description)),fe&&React.createElement("span",{className:"permission-act\
ion-state"},"Sending..."))})),de&&React.createElement("textarea",{className:"permission-alternate-input",rows:"1",maxLength:2e3,
value:b,disabled:!!W,placeholder:ce(e?.alternate_instruction_placeholder,"Tell Claude what to do instead"),"aria-label":"\
Tell Claude what to do instead",onChange:H=>w(H.target.value)}),J&&React.createElement("div",{className:"permission-ques\
tion-footer"},React.createElement("button",{type:"button",className:"permission-question-submit",disabled:!be||!!W||te,onClick:ee},
W?"Sending...":ce(e.submit_label,"Submit answers")),e?.type==="question_prompt"&&e?.cancel_supported===!0&&React.createElement(
"button",{type:"button",className:"permission-question-cancel",disabled:!!W||te,onClick:()=>s(t,e.prompt_id,null,{action:"\
cancel"})},"Cancel")),React.createElement("div",{className:"permission-keyboard-help"},pe?ce(e?.cancel_hint,"Esc to canc\
el"):`1\u20139 select \xB7 Enter submit \xB7 Esc ${e?.cancel_supported===!0?"cancel":"return to composer"}`)))}function Ol(e){
return ce(e?.label,"Action")}function Yi(e){return!!e&&e.blocking!==!1&&e.display_mode!=="inline"}function ak({prompt:e,
sessionId:t,onRespond:n,onMinimize:s}){let a=lp(e,["error","notice"]),o=Array.isArray(e?.actions)?e.actions:a?.actions||
[],c=e?.submitting_action_id||null,u=ce(e?.error_output||a?.error_output).trim();return React.createElement("div",{className:"\
permission-overlay"},React.createElement("div",{className:"permission-card error-prompt-card"},React.createElement(rt,{paneId:"\
native-action",onMinimize:s}),React.createElement("div",{className:"permission-eyebrow error-prompt-eyebrow"},"Action Re\
quired"),React.createElement("div",{className:"permission-title"},ce(a?.label||e?.title,"Error handling model response")),
React.createElement("div",{className:"permission-body"},ce(a?.content||e?.message,"There was an error handling the model\
 response.")),u&&React.createElement("div",{className:"error-prompt-output-wrap"},React.createElement("div",{className:"\
error-prompt-output-label"},"Error Output"),React.createElement("pre",{className:"error-prompt-output"},u)),e?.error&&React.
createElement("div",{className:"permission-error"},e.error),React.createElement("div",{className:"permission-actions"},o.
map(m=>{let f=ce(m?.action_id),v=c===f;return React.createElement("button",{key:f||Ol(m),className:`permission-action er\
ror-prompt-action${v?" pending":""}`,disabled:!!c,onClick:k=>n(t,e.prompt_id,f,k)},React.createElement("span",null,Ol(m)),
v&&React.createElement("span",{className:"permission-action-state"},"Sending..."))}))))}function rk({prompt:e,sessionId:t,
onRespond:n}){let s=lp(e,["error","notice"]),a=Array.isArray(e?.actions)?e.actions:s?.actions||[],o=e?.submitting_action_id||
null,c=ce(e?.error_output||s?.error_output).trim();return React.createElement("div",{className:"inline-error-prompt"},React.
createElement("div",{className:"inline-error-prompt-body"},React.createElement("div",{className:"inline-error-prompt-tit\
le"},ce(s?.label||e?.title,"Codex requires attention")),React.createElement("div",{className:"inline-error-prompt-messag\
e"},ce(s?.content||e?.message,"There was an error handling the model response.")),c&&React.createElement("pre",{className:"\
inline-error-prompt-output"},c),e?.error&&React.createElement("div",{className:"permission-error"},e.error)),React.createElement(
"div",{className:"inline-error-prompt-actions"},a.map(u=>{let m=ce(u?.action_id),f=o===m;return React.createElement("but\
ton",{key:m||Ol(u),className:`permission-action error-prompt-action${f?" pending":""}`,disabled:!!o,onClick:v=>n(t,e.prompt_id,
m,v)},React.createElement("span",null,Ol(u)),f&&React.createElement("span",{className:"permission-action-state"},"Sendin\
g..."))})))}function ik({launchStates:e,onLaunch:t,onResume:n,onClose:s,onMinimize:a,workspaces:o,showTestSessions:c=!1}){
let[u,m]=React.useState("new"),[f,v]=React.useState("claude"),[k,R]=React.useState(""),[S,T]=React.useState(""),[b,w]=React.
useState("deepseek-v4-pro:cloud"),[h,M]=React.useState("gpt-5.5"),[C,_]=React.useState("grok-4.5-fast-high"),[L,P]=React.
useState(null),[V,Z]=React.useState([]),[oe,ge]=React.useState(!1),W=L?e[L]:null,te=W?.status==="launching",X=W?.status===
"failed"?W.error:null,ue=(o||[]).length>0;React.useEffect(()=>{L&&!e[L]&&s()},[e,L]),React.useEffect(()=>{u==="resume"&&
!oe&&(ge(!0),fetch(`/api/sessions/history?limit=30&include_test=${c?"true":"false"}`,{credentials:"same-origin"}).then(se=>se.
json()).then(se=>Z(se.sessions||[])).catch(()=>Z([])).finally(()=>ge(!1)))},[u,c]);function J(se){if(se.preventDefault(),
te)return;let Q=k==="custom"?S.trim():k,de=f==="claude_cli"?{model_id:b.trim()||"default"}:f==="codex_cli"?{model_id:h.trim()||
"gpt-5.5",permission_mode:"workspace-write",effort:"medium"}:f==="cursor_cli"?{model_id:C.trim()||"grok-4.5-fast-high",permission_mode:"\
force"}:{},he=t(f,Q||void 0,de);P(he)}function pe(se){if(te)return;let Q=se.agent_type||f,de=se.workspace_path||(k==="cu\
stom"?S.trim():k)||void 0,he=n(se.session_id,Q,de,{cli_session_id:se.cli_session_id||void 0,model_id:se.model_id||void 0,
permission_mode:se.permission_mode||void 0});P(he)}function Ce(se){if(!se)return"";let Q=Date.now()-new Date(se).getTime(),
de=Math.floor(Q/6e4);if(de<60)return`${de}m ago`;let he=Math.floor(de/60);return he<24?`${he}h ago`:`${Math.floor(he/24)}\
d ago`}return React.createElement("div",{className:"new-session-panel"},React.createElement("div",{className:"new-sessio\
n-header"},React.createElement("span",null,u==="new"?"New Session":"Resume Session"),React.createElement(rt,{paneId:"new\
-session",onMinimize:a}),React.createElement("button",{className:"new-session-close",onClick:s,title:"Cancel"},"\u2715")),
React.createElement("div",{className:"new-session-tabs"},React.createElement("button",{className:`new-session-tab${u==="\
new"?" active":""}`,onClick:()=>m("new")},"New"),React.createElement("button",{className:`new-session-tab${u==="resume"?
" active":""}`,onClick:()=>m("resume")},"Resume")),u==="new"?React.createElement("form",{className:"new-session-form",onSubmit:J},
React.createElement("div",{className:"new-session-agents"},Object.entries(ys).map(([se,Q])=>React.createElement("button",
{key:se,type:"button",className:`new-session-agent-btn${f===se?" selected":""}`,style:f===se?{borderColor:Q.color,color:Q.
color,background:Q.color+"18"}:{},onClick:()=>v(se)},React.createElement("span",{className:"agent-badge new-session-badg\
e",style:{color:Q.color,borderColor:Q.color+"55",background:Q.color+"18"}},Q.abbr),React.createElement("span",{className:"\
new-session-agent-name"},Q.name)))),ue?React.createElement(React.Fragment,null,React.createElement("select",{className:"\
new-session-workspace",value:k,onChange:se=>R(se.target.value),disabled:te},React.createElement("option",{value:""},"No \
workspace (default)"),o.map((se,Q)=>React.createElement("option",{key:Q,value:se.path||se.title},se.title)),React.createElement(
"option",{value:"custom"},"Custom path\u2026")),k==="custom"&&React.createElement("input",{className:"new-session-worksp\
ace",type:"text",placeholder:"Enter workspace path",value:S,onChange:se=>T(se.target.value),disabled:te,autoFocus:!0})):
React.createElement("input",{className:"new-session-workspace",type:"text",placeholder:"Workspace path (optional)",value:S,
onChange:se=>T(se.target.value),disabled:te}),f==="claude_cli"&&React.createElement("input",{className:"new-session-work\
space",type:"text",placeholder:"Claude CLI model, e.g. deepseek-v4-pro:cloud",value:b,onChange:se=>w(se.target.value),disabled:te}),
f==="codex_cli"&&React.createElement("select",{className:"new-session-workspace",value:h,onChange:se=>M(se.target.value),
disabled:te},up.map(se=>React.createElement("option",{key:se.id,value:se.id},se.label))),f==="cursor_cli"&&React.createElement(
"select",{className:"new-session-workspace",value:C,onChange:se=>_(se.target.value),disabled:te},dp.map(se=>React.createElement(
"option",{key:se.id,value:se.id},se.label))),X&&React.createElement("div",{className:"new-session-error"},X),React.createElement(
"button",{className:"new-session-submit",type:"submit",disabled:te},te?React.createElement("span",{className:"new-sessio\
n-spinner"}):null,te?"Launching\u2026":"Launch")):React.createElement("div",{className:"new-session-form"},React.createElement(
"div",{className:"new-session-agents"},Object.entries(ys).map(([se,Q])=>React.createElement("button",{key:se,type:"butto\
n",className:`new-session-agent-btn${f===se?" selected":""}`,style:f===se?{borderColor:Q.color,color:Q.color,background:Q.
color+"18"}:{},onClick:()=>v(se)},React.createElement("span",{className:"agent-badge new-session-badge",style:{color:Q.color,
borderColor:Q.color+"55",background:Q.color+"18"}},Q.abbr),React.createElement("span",{className:"new-session-agent-name"},
Q.name)))),X&&React.createElement("div",{className:"new-session-error"},X),oe?React.createElement("div",{className:"sess\
ion-history-loading"},React.createElement("span",{className:"new-session-spinner"})," Loading history\u2026"):V.length===
0?React.createElement("div",{className:"session-history-empty"},"No past sessions found"):React.createElement("div",{className:"\
session-history-list"},V.filter(se=>!f||!se.agent_type||se.agent_type===f).map(se=>React.createElement("button",{key:se.
session_id,className:"session-history-item",onClick:()=>pe(se),disabled:te},React.createElement("div",{className:"sessio\
n-history-preview"},se.preview||"(empty session)"),React.createElement("div",{className:"session-history-meta"},React.createElement(
"span",null,se.message_count," msg",se.message_count!==1?"s":""),se.agent_type&&React.createElement("span",{className:"s\
ession-history-workspace"},ys[se.agent_type]?.name||se.agent_type),se.workspace_name&&React.createElement("span",{className:"\
session-history-workspace",title:se.workspace_path||""},se.workspace_name),React.createElement("span",null,Ce(se.last_active_at))))))))}
var ok={claude:[{value:"default",label:"Ask before edit"},{value:"acceptEdits",label:"Edit automatically"},{value:"plan",
label:"Plan mode"},{value:"auto",label:"Auto mode"},{value:"bypassPermissions",label:"Bypass permissions"}],claude_cli:[
{value:"default",label:"Default"},{value:"acceptEdits",label:"Accept edits"},{value:"auto",label:"Auto"},{value:"bypassP\
ermissions",label:"Bypass permissions"},{value:"dontAsk",label:"Do not ask"},{value:"plan",label:"Plan"}],continue_yolo:[
{value:"ask",label:"Ask for permissions"},{value:"bypass",label:"Bypass permissions"}],roo_code:[{value:"BRRR",label:"BR\
RR"},{value:"YOLO",label:"YOLO"},{value:"Ask",label:"Ask"},{value:"Auto-approve",label:"Auto-approve"}],cline:[{value:"Y\
OLO",label:"YOLO"}],codex_cli:[{value:"read-only",label:"Read only"},{value:"workspace-write",label:"Workspace write"},{
value:"danger-full-access",label:"Full access"}],cursor_cli:[{value:"default",label:"Default"},{value:"force",label:"For\
ce (Yolo)"},{value:"plan",label:"Plan"},{value:"ask",label:"Ask"}],codex:[],gemini:[]};function jg(e){return e==="codex_\
cli"?"workspace-write":e==="cursor_cli"?"force":e==="continue_yolo"||e==="roo_code"||e==="cline"?"ask":"default"}var tp=[
{id:"default",label:"Auto"},{id:"claude-opus-4-6",label:"Claude Opus 4.6"},{id:"claude-sonnet-4-6",label:"Claude Sonnet \
4.6"},{id:"claude-opus-4-5",label:"Claude Opus 4.5"},{id:"claude-sonnet-4-5",label:"Claude Sonnet 4.5"},{id:"claude-haik\
u-4-5",label:"Claude Haiku 4.5"},{id:"claude-opus-4-0",label:"Claude Opus 4"},{id:"claude-sonnet-4-0",label:"Claude Sonn\
et 4"},{id:"claude-3-7-sonnet",label:"Claude 3.7 Sonnet"},{id:"claude-3-5-sonnet",label:"Claude 3.5 Sonnet"},{id:"claude\
-3-5-haiku",label:"Claude 3.5 Haiku"},{id:"deepseek-v4-pro:cloud",label:"DeepSeek V4 Pro (Ollama Cloud)"}],up=[{id:"gpt-\
5.6",label:"GPT-5.6"},{id:"gpt-5.6-sol",label:"GPT-5.6 Sol"},{id:"gpt-5.6-terra",label:"GPT-5.6 Terra"},{id:"gpt-5.6-lun\
a",label:"GPT-5.6 Luna"},{id:"gpt-5.5",label:"GPT-5.5"},{id:"gpt-5.4",label:"GPT-5.4"},{id:"gpt-5.4-mini",label:"GPT-5.4\
 Mini"},{id:"gpt-5.3-codex-spark",label:"GPT-5.3 Codex Spark"},{id:"gpt-5.3-codex",label:"GPT-5.3 Codex"},{id:"gpt-5.2-c\
odex",label:"GPT-5.2 Codex"},{id:"gpt-5.2",label:"GPT-5.2"},{id:"gpt-5.1-codex",label:"GPT-5.1 Codex"},{id:"gpt-5.1",label:"\
GPT-5.1"},{id:"gpt-5",label:"GPT-5"},{id:"ollama:deepseek-v4-pro:cloud",label:"DeepSeek V4 Pro (Ollama Cloud)"},{id:"oll\
ama:kimi-k2.6:cloud",label:"Kimi K2.6 (Ollama Cloud)"}],dp=[{id:"grok-4.5-fast-high",label:"Grok 4.5 Fast (High)"},{id:"\
grok-4.5-fast-xhigh",label:"Grok 4.5 Fast (XHigh)"},{id:"claude-fable-5-thinking-high",label:"Claude Fable 5 (Thinking H\
igh)"},{id:"claude-opus-4-8-thinking-high",label:"Claude Opus 4.8 (Thinking High)"},{id:"composer-2.5",label:"Composer 2\
.5"},{id:"composer-2.5-fast",label:"Composer 2.5 Fast"},{id:"gpt-5.5-high",label:"GPT-5.5 (High)"},{id:"gpt-5.3-codex",label:"\
GPT-5.3 Codex"}],pp=[{id:"Planning",label:"Planning"},{id:"Fast",label:"Fast"}],ck=[{id:"Architect",label:"Architect"},{
id:"Code",label:"Code"},{id:"Ask",label:"Ask"},{id:"Debug",label:"Debug"},{id:"Orchestrator",label:"Orchestrator"}],lk=[
{id:"Plan",label:"Plan"},{id:"Act",label:"Act"}],Bg=[{id:"Gemini 3.1 Pro (High)",label:"Gemini 3.1 Pro (High)"},{id:"Gem\
ini 3.1 Pro (Low)",label:"Gemini 3.1 Pro (Low)"},{id:"Gemini 3 Flash",label:"Gemini 3 Flash"},{id:"Claude Sonnet 4.6 (Th\
inking)",label:"Claude Sonnet 4.6 (Thinking)"},{id:"Claude Opus 4.6 (Thinking)",label:"Claude Opus 4.6 (Thinking)"},{id:"\
GPT-OSS 120B (Medium)",label:"GPT-OSS 120B (Medium)"}],Fg=[{id:"Default",label:"Default"},{id:"2.5 Flash",label:"Gemini \
2.5 Flash"},{id:"2.5 Pro",label:"Gemini 2.5 Pro"},{id:"3 Flash Preview",label:"Gemini 3 Flash Preview"},{id:"3.1 Pro Pre\
view",label:"Gemini 3.1 Pro Preview"}];function _g(e,t){return Array.isArray(t?.available_models)&&t.available_models.length>
0?t.available_models.map(n=>typeof n=="string"?{id:n,label:n}:n):e==="continue_yolo"||e==="continue"||e==="roo_code"||e===
"cline"?[]:e==="claude_cli"?tp:e==="codex_cli"?up:e==="cursor_cli"?dp:e==="antigravity"||e==="antigravity_panel"?Bg:e===
"gemini"?Fg:tp}function Zo(e,t){return Array.isArray(t?.available_modes)&&t.available_modes.length>0?t.available_modes.map(
n=>typeof n=="string"?{id:n,label:n}:n):e==="roo_code"?ck:e==="cline"?lk:e==="antigravity"||e==="antigravity_panel"?pp:[]}
function np(e,t){return Array.isArray(t?.available_permission_modes)&&t.available_permission_modes.length>0?t.available_permission_modes.
map(n=>typeof n=="string"?{value:n,label:n}:{value:n.id||n.value,label:n.label||n.id||n.value}).filter(n=>n.value):ok[e]||
[]}function uk(e){let t="=".repeat((4-e.length%4)%4),n=(e+t).replace(/-/g,"+").replace(/_/g,"/"),s=atob(n);return Uint8Array.
from([...s].map(a=>a.charCodeAt(0)))}var mp=Object.freeze({permission_required:!0,agent_ready:!0,turn_ready:!1,goal_completed:!1,
goal_attention:!0,provider_usage_warning:!0,agent_error:!0,session_offline:!0,rate_limit_cleared:!0,completion_sound:!1,
completion_haptic:!1}),dk=Object.freeze(Object.fromEntries(Object.keys(mp).map(e=>[e,!1]))),Al=null,bg=0;function fp(){if(typeof window>
"u")return null;let e=window.AudioContext||window.webkitAudioContext;return e?(Al||(Al=new e),Al.state==="suspended"&&Al.
resume().catch(()=>{}),Al):null}function yg(e="completion"){let t=Date.now();if(t-bg<600)return!1;let n=fp();if(!n||n.state!==
"running")return!1;bg=t;let s=n.createOscillator(),a=n.createGain(),o=n.currentTime;return s.type="sine",s.frequency.setValueAtTime(
e==="prompt"?740:620,o),s.frequency.exponentialRampToValueAtTime(e==="prompt"?880:760,o+.11),a.gain.setValueAtTime(1e-4,
o),a.gain.exponentialRampToValueAtTime(.035,o+.012),a.gain.exponentialRampToValueAtTime(1e-4,o+.14),s.connect(a),a.connect(
n.destination),s.start(o),s.stop(o+.15),!0}function vg(e,t){return e!==t?!0:typeof document>"u"?!1:document.visibilityState!==
"visible"||!document.hasFocus()}function pk({onClose:e,onMinimize:t,onPreferencesChange:n}){let s=mp,[a,o]=_e(s),[c,u]=_e(
!0),[m,f]=_e(null),[v,k]=_e(""),[R,S]=_e("checking"),[T,b]=_e(!1);async function w(){u(!0),k("");try{let L=await fetch("\
/api/preferences/notifications",{credentials:"same-origin"}),P=await L.json().catch(()=>({}));if(!L.ok)throw new Error(P.
error||"Unable to load notification settings.");let V={...s,...P.preferences||{},turn_ready:!1};o(V),n?.(V)}catch(L){k(L.
message||"Unable to load notification settings.")}finally{u(!1)}}async function h(){if(!("serviceWorker"in navigator)||!("\
PushManager"in window)||!("Notification"in window)){S("unsupported");return}try{let P=await(await navigator.serviceWorker.
ready).pushManager.getSubscription();S(P?"enabled":Notification.permission==="denied"?"denied":"available")}catch{S("err\
or")}}$e(()=>{w(),h()},[]);async function M(){if(!T){b(!0),k("");try{let L=await Notification.requestPermission();if(L!==
"granted"){S(L==="denied"?"denied":"available");return}let P=await fetch("/api/push/web-config",{credentials:"same-origi\
n"}),V=await P.json().catch(()=>({}));if(!P.ok||!V.public_key)throw new Error(V.error||"Web Push is unavailable.");let Z=await navigator.
serviceWorker.ready,oe=await Z.pushManager.getSubscription();oe||(oe=await Z.pushManager.subscribe({userVisibleOnly:!0,applicationServerKey:uk(
V.public_key)}));let ge=await fetch("/api/push/web-subscription",{method:"POST",credentials:"same-origin",headers:{"Cont\
ent-Type":"application/json"},body:JSON.stringify({subscription:oe.toJSON()})}),W=await ge.json().catch(()=>({}));if(!ge.
ok)throw new Error(W.error||"Unable to register browser notifications.");S("enabled")}catch(L){S("error"),k(L.message||"\
Unable to enable browser notifications.")}finally{b(!1)}}}async function C(){if(!T){b(!0),k("");try{let P=await(await navigator.
serviceWorker.ready).pushManager.getSubscription();P&&(await fetch("/api/push/web-subscription",{method:"DELETE",credentials:"\
same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({endpoint:P.endpoint})}),await P.unsubscribe()),
S("available")}catch(L){S("error"),k(L.message||"Unable to disable browser notifications.")}finally{b(!1)}}}async function _(L){
if(m||L==="turn_ready")return;let P=a,V={...a,[L]:!a[L]};L==="completion_sound"&&V.completion_sound&&fp(),o(V),f(L),k("");
try{let Z=await fetch("/api/preferences/notifications",{method:"PUT",credentials:"same-origin",headers:{"Content-Type":"\
application/json"},body:JSON.stringify({preferences:V})}),oe=await Z.json().catch(()=>({}));if(!Z.ok)throw new Error(oe.
error||"Unable to save notification settings.");let ge={...s,...oe.preferences||{}};o(ge),n?.(ge)}catch(Z){o(P),k(Z.message||
"Unable to save notification settings.")}finally{f(null)}}return React.createElement("div",{className:"settings-panel no\
tification-settings-panel"},React.createElement("div",{className:"settings-panel-header"},React.createElement("span",null,
"Notifications"),React.createElement(rt,{paneId:"notification-settings",onMinimize:t}),React.createElement("button",{className:"\
settings-panel-close",onClick:e,title:"Close"},"\u2715")),React.createElement("div",{className:"settings-panel-body"},React.
createElement("div",{className:"notification-setting-row web-push-setting-row"},React.createElement("span",null,React.createElement(
"strong",null,"Browser notifications"),React.createElement("small",null,R==="enabled"?"Enabled for this browser":R==="de\
nied"?"Blocked in browser site settings":R==="unsupported"?"Not supported by this browser":R==="checking"?"Checking brow\
ser support\u2026":"Receive notifications when this PWA is closed")),R==="enabled"?React.createElement("button",{type:"b\
utton",disabled:T,onClick:C},"Disable"):React.createElement("button",{type:"button",disabled:T||R==="checking"||R==="uns\
upported"||R==="denied",onClick:M},T?"Enabling\u2026":"Enable")),React.createElement("label",{className:"notification-se\
tting-row"},React.createElement("span",null,React.createElement("strong",null,"Permission required"),React.createElement(
"small",null,"When an agent needs approval to continue")),React.createElement("input",{type:"checkbox",checked:a.permission_required,
disabled:c||!!m,onChange:()=>_("permission_required")})),React.createElement("label",{className:"notification-setting-ro\
w"},React.createElement("span",null,React.createElement("strong",null,"Turn finished"),React.createElement("small",null,
"Unavailable until this harness supplies an authoritative native turn boundary")),React.createElement("input",{type:"che\
ckbox",checked:!1,disabled:!0,onChange:()=>_("turn_ready")})),React.createElement("label",{className:"notification-setti\
ng-row"},React.createElement("span",null,React.createElement("strong",null,"Goal completed"),React.createElement("small",
null,"Only when the native goal reaches its terminal completed state")),React.createElement("input",{type:"checkbox",checked:a.
goal_completed,disabled:c||!!m,onChange:()=>_("goal_completed")})),React.createElement("label",{className:"notification-\
setting-row"},React.createElement("span",null,React.createElement("strong",null,"Goal needs attention"),React.createElement(
"small",null,"Paused, blocked, limited, cancelled, or failed goals")),React.createElement("input",{type:"checkbox",checked:a.
goal_attention,disabled:c||!!m,onChange:()=>_("goal_attention")})),React.createElement("label",{className:"notification-\
setting-row"},React.createElement("span",null,React.createElement("strong",null,"Provider usage warning"),React.createElement(
"small",null,"At 75%, 90%, and exhaustion for each provider account window")),React.createElement("input",{type:"checkbo\
x",checked:a.provider_usage_warning,disabled:c||!!m,onChange:()=>_("provider_usage_warning")})),React.createElement("div",
{className:"settings-note"},"Active /goal loop checkpoints stay quiet between turns."),React.createElement("label",{className:"\
notification-setting-row"},React.createElement("span",null,React.createElement("strong",null,"Agent error or rate limit"),
React.createElement("small",null,"When an agent stops and needs attention")),React.createElement("input",{type:"checkbox",
checked:a.agent_error,disabled:c||!!m,onChange:()=>_("agent_error")})),React.createElement("label",{className:"notificat\
ion-setting-row"},React.createElement("span",null,React.createElement("strong",null,"Session offline"),React.createElement(
"small",null,"When an agent disconnects from the relay")),React.createElement("input",{type:"checkbox",checked:a.session_offline,
disabled:c||!!m,onChange:()=>_("session_offline")})),React.createElement("label",{className:"notification-setting-row"},
React.createElement("span",null,React.createElement("strong",null,"Rate limit cleared"),React.createElement("small",null,
"When a model's rate limit expires")),React.createElement("input",{type:"checkbox",checked:a.rate_limit_cleared,disabled:c||
!!m,onChange:()=>_("rate_limit_cleared")})),React.createElement("label",{className:"notification-setting-row"},React.createElement(
"span",null,React.createElement("strong",null,"Notification sound"),React.createElement("small",null,"Subtle cue for all\
owed prompts and explicit goal lifecycle events")),React.createElement("input",{type:"checkbox",checked:a.completion_sound,
disabled:c||!!m,onChange:()=>_("completion_sound")})),c&&React.createElement("div",{className:"settings-note"},"Loading \
relay preferences\u2026"),!!v&&React.createElement("div",{className:"notification-settings-error",role:"alert"},React.createElement(
"span",null,v),React.createElement("button",{type:"button",onClick:w},"Retry")),React.createElement("div",{className:"se\
ttings-note"},"These preferences sync across web and Android.")))}function mk({sessions:e,preferences:t,initialSessionId:n,
onSave:s,onExport:a,onClose:o,onMinimize:c}){let u=n||je(e[0])||"",[m,f]=_e(u),[v,k]=_e(""),[R,S]=_e(!1),[T,b]=_e(""),[w,
h]=_e(""),M=e.find(P=>je(P)===m)||null,C=t[m]||{display_name:"",archived:!1,muted:!1,pinned:!1,pin_order:0};$e(()=>{k(C.
display_name||""),h("")},[m,C.display_name]),$e(()=>{n&&f(n)},[n]);async function _(P){if(!(!m||R)){S(!0),h("");try{await s(
m,P)}catch(V){h(V.message||"Unable to save session settings.")}finally{S(!1)}}}async function L(P){if(!(!m||T)){b(P),h("");
try{await a(m,P)}catch(V){h(V.message||"Unable to export session.")}finally{b("")}}}return React.createElement("div",{className:"\
settings-panel session-management-panel"},React.createElement("div",{className:"settings-panel-header"},React.createElement(
"span",null,"Manage sessions"),React.createElement(rt,{paneId:"session-management",onMinimize:c}),React.createElement("b\
utton",{className:"settings-panel-close",onClick:o,title:"Close"},"\u2715")),React.createElement("div",{className:"setti\
ngs-panel-body"},e.length===0?React.createElement("div",{className:"settings-note"},"No sessions available."):React.createElement(
React.Fragment,null,React.createElement("label",{className:"settings-row session-management-field"},React.createElement(
"span",{className:"settings-label"},"Session"),React.createElement("select",{value:m,onChange:P=>f(P.target.value)},e.map(
P=>{let V=je(P),Z=t[V]||{},oe=Z.display_name||P?.display_name||P?.workspace_name||P?.name||V;return React.createElement(
"option",{key:V,value:V},Z.archived?"[Hidden] ":"",oe)}))),M&&React.createElement(React.Fragment,null,React.createElement(
"label",{className:"settings-row session-management-field"},React.createElement("span",{className:"settings-label"},"Cus\
tom name"),React.createElement("input",{value:v,maxLength:100,placeholder:M?.display_name||M?.workspace_name||M?.name||m,
onChange:P=>k(P.target.value)})),React.createElement("label",{className:"notification-setting-row"},React.createElement(
"span",null,React.createElement("strong",null,"Pin chat"),React.createElement("small",null,"Keep this chat in the operat\
or-ordered pinned section")),React.createElement("input",{type:"checkbox",checked:!!C.pinned,disabled:R,onChange:()=>_({
pinned:!C.pinned})})),React.createElement("label",{className:"notification-setting-row"},React.createElement("span",null,
React.createElement("strong",null,"Mute notifications"),React.createElement("small",null,"Suppress push notifications fo\
r this session")),React.createElement("input",{type:"checkbox",checked:!!C.muted,disabled:R,onChange:()=>_({muted:!C.muted})})),
React.createElement("div",{className:"session-management-actions"},React.createElement("button",{disabled:R,onClick:()=>_(
{display_name:v})},"Save name"),React.createElement("button",{className:C.archived?"":"danger",disabled:R,onClick:()=>_(
{archived:!C.archived})},C.archived?"Restore to sidebar":"Hide from sidebar")),React.createElement("div",{className:"ses\
sion-management-actions session-export-actions","aria-label":"Export session"},React.createElement("button",{disabled:!!T,
onClick:()=>L("markdown")},T==="markdown"?"Preparing\u2026":"Download Markdown"),React.createElement("button",{disabled:!!T,
onClick:()=>L("json")},T==="json"?"Preparing\u2026":"Download JSON")))),!!w&&React.createElement("div",{className:"setti\
ngs-error",role:"alert"},w),React.createElement("div",{className:"settings-note"},"Names, pinned order, hidden state, an\
d mute settings sync across web and Android.")))}function fk({sessionId:e,initialContent:t,jobs:n,onSchedule:s,onCancel:a,
onCreated:o,onClose:c,onMinimize:u}){let[m,f]=_e(t||""),[v,k]=_e("idle"),[R,S]=_e(()=>{let _=new Date(Date.now()+36e5);return new Date(
_.getTime()-_.getTimezoneOffset()*6e4).toISOString().slice(0,16)}),[T,b]=_e(""),[w,h]=_e(!1);async function M(_){_.preventDefault(),
h(!0),b("");try{await s(e,m,v,v==="at"?new Date(R).toISOString():null),o?.(),f("")}catch(L){b(L.message)}finally{h(!1)}}
async function C(_){try{await a(_)}catch(L){b(L.message)}}return React.createElement("div",{className:"settings-panel sc\
heduled-send-panel","data-testid":"scheduled-send-panel"},React.createElement("div",{className:"settings-panel-header"},
React.createElement("span",null,"Schedule message"),React.createElement(rt,{paneId:"scheduled-send",onMinimize:u}),React.
createElement("button",{className:"settings-panel-close",onClick:c,title:"Close"},"\xD7")),React.createElement("form",{className:"\
settings-panel-body",onSubmit:M},React.createElement("label",{className:"settings-row session-management-field"},React.createElement(
"span",{className:"settings-label"},"Message"),React.createElement("textarea",{value:m,maxLength:524288,onChange:_=>f(_.
target.value)})),React.createElement("label",{className:"settings-row session-management-field"},React.createElement("sp\
an",{className:"settings-label"},"Deliver"),React.createElement("select",{value:v,onChange:_=>k(_.target.value)},React.createElement(
"option",{value:"idle"},"When session is next idle"),React.createElement("option",{value:"at"},"At a specific time"))),v===
"at"&&React.createElement("label",{className:"settings-row session-management-field"},React.createElement("span",{className:"\
settings-label"},"Local time"),React.createElement("input",{type:"datetime-local",value:R,onChange:_=>S(_.target.value)})),
React.createElement("div",{className:"session-management-actions"},React.createElement("button",{type:"submit",disabled:w||
!m.trim()},w?"Scheduling\u2026":"Schedule")),!!T&&React.createElement("div",{className:"settings-error",role:"alert"},T),
!!n.length&&React.createElement("div",{className:"scheduled-send-list"},React.createElement("strong",null,"Pending"),n.map(
_=>React.createElement("div",{className:"scheduled-send-row",key:_.id},React.createElement("span",null,_.trigger_kind===
"idle"?"Next idle":new Date(_.deliver_at).toLocaleString()," \xB7 ",_.content),React.createElement("button",{type:"butto\
n",onClick:()=>C(_.id),disabled:_.state!=="pending"},_.state==="dispatching"?"Sending\u2026":"Cancel"))))))}function hk({
session:e,config:t,configControlStates:n,onRequestRefresh:s,onSetModel:a,onSetEffort:o,onSetPermissionMode:c,onSetAutoApprovePermissions:u,
onSetMode:m,onSetCodexConfig:f,onSwitchWorkspace:v,onClose:k,onMinimize:R}){let[S,T]=React.useState(!1),[b,w]=React.useState(
null),h=je(e),M=G=>n?.[`${h}:${G}`]||null,C=G=>G&&(G.status==="pending"||G.status==="awaiting_config"),_=M("model"),L=M(
"permission_mode"),P=M("effort"),V=M("auto_approve_permissions"),Z=M("mode"),oe=M("speed"),ge=M("access_mode"),W=M("perm\
ission_profile"),te=M("workspace"),X=[_,L,P,V,Z,oe,ge,W,te].find(G=>C(G)||G?.status==="failed"),ue=X?C(X)?`Saving ${X.field.
replace(/_/g," ")}\u2026`:X.error:null,J=e&&typeof e=="object"?e.agent_type:null,pe=t?.capabilities||{},Ce=J==="codex_cl\
i"&&t?.config_semantics==="observed_and_next_send",se=J==="codex",Q=!se||t?.controls_available!==!1,de=t?.model_id||"unk\
nown",he=t?.next_send_model_id||"",xe=e&&typeof e=="object"&&e.rate_limited_until||null,be=Array.isArray(e?.antigravity_quota_models)?
e.antigravity_quota_models:[],ee=e?.active_quota_model||null,H=t?.permission_mode||"unknown",E=t?.conversation_mode||"un\
known",z=t?.mode&&t.mode!=="unknown"?t.mode:E,fe=typeof t?.auto_approve_permissions=="boolean"?t.auto_approve_permissions:
!!e?.auto_approve_permissions,ie=J==="codex_cli"?e?.codex_live_owner:null,ye=ie?ie.state==="confirmed"?{interactive_tui:"\
Interactive terminal active",proxy_app_server:"Headless RAC app-server turn active",rotator_exec:"Headless rotator worke\
r active"}[ie.owner_kind]||"Live owner active":ie.state==="multiple"?"Needs attention: multiple owners":ie.state==="stal\
e"?"Needs attention: stale owner proof":ie.state==="unavailable"?"Ownership startup is not ready":"No live owner":"Owner\
ship status unavailable",Me=ie?[ie.thread_id?`thread ${ie.thread_id}`:null,ie.turn_id?`turn ${ie.turn_id}`:null,ie.root_pid?
`PID ${ie.root_pid}`:null,ie.reason||null].filter(Boolean).join(" \xB7 "):"",ke=t?.effort||null,Ee=t?.next_send_effort||
"",He=t?.file_access_scope||"unknown",ae=np(J,t),Re=Zo(J,t),F=J==="claude"||J==="claude_cli"?tp:J==="codex_cli"?up:J==="\
cursor_cli"?dp:J==="antigravity"||J==="antigravity_panel"?Bg:J==="gemini"?Fg:[];t?.available_models&&Array.isArray(t.available_models)&&
t.available_models.length>0&&(F=t.available_models.map(G=>typeof G=="string"?{id:G,label:G}:G)),React.useEffect(()=>{h&&
s(h)},[h]);function re(G){!G||G===(Ce?he:de)||a(h,G)}function Te(G){!G||G===H||c(h,G)}function Ke(G){!G||G===(Ce?Ee:ke)||
o&&o(h,G)}function St(G){!G||G===z||m&&m(h,G)}function vs(G){fe!==!!G&&u&&u(h,!!G)}function on(G,bn=!1){if(!(!G||G===t?.
permission_profile)){if(G==="full-access"&&!bn){T(!0);return}G==="full-access"&&w(t?.permission_profile&&t.permission_profile!==
"full-access"?t.permission_profile:"auto"),T(!1),f?.({permission_profile:G,...bn?{confirm_bypass:!0}:{}})}}return React.
createElement("div",{className:"settings-panel"},React.createElement("div",{className:"settings-panel-header"},React.createElement(
"span",null,"Session Settings"),React.createElement(rt,{paneId:"agent-settings",onMinimize:R}),React.createElement("butt\
on",{className:"settings-panel-close",onClick:k,title:"Close"},"\u2715")),React.createElement("div",{className:"settings\
-panel-body"},J==="codex_cli"&&React.createElement("div",{className:"settings-row","data-testid":"codex-live-owner-statu\
s"},React.createElement("span",{className:"settings-label"},"Live owner"),React.createElement("span",{className:`setting\
s-value${["multiple","stale","unavailable"].includes(ie?.state)?" error":""}`,title:Me},ye)),J==="codex_cli"&&React.createElement(
"div",{className:"settings-row","data-testid":"codex-headless-send-mode"},React.createElement("span",{className:"setting\
s-label"},"Remote sends"),React.createElement("span",{className:"settings-value",title:t?.send_execution_detail},t?.send_execution_label||
"Headless / out-of-process"),React.createElement("span",{className:"settings-value small"},"Interactive TUI may stay idl\
e")),xe&&React.createElement("div",{className:"settings-rl-banner"},React.createElement("span",{className:"settings-rl-i\
con"},"\u26A0"),React.createElement("span",{className:"settings-rl-text"},"Rate limited",xe!=="unknown"?React.createElement(
React.Fragment,null," \u2014 available after ",React.createElement("strong",null,xe)):React.createElement(React.Fragment,
null," \u2014 reset time unknown"))),React.createElement("div",{className:"settings-row"},React.createElement("span",{className:"\
settings-label"},Ce?"Observed model":"Model"),React.createElement("div",{className:"settings-model-wrap"},Ce?React.createElement(
"span",{className:`settings-value${de==="unknown"?" dim":""}`,title:t?.model_provenance?.source||"No exact native metada\
ta observed"},de):pe.set_model&&F.length>0?React.createElement("select",{className:"settings-perm-select",value:de,disabled:C(
_),onChange:G=>re(G.target.value)},F.map(G=>React.createElement("option",{key:G.id,value:G.id},G.label)),J!=="antigravit\
y"&&J!=="gemini"&&!F.some(G=>G.id===de)&&de!=="unknown"&&React.createElement("option",{value:de},de)):React.createElement(
"span",{className:`settings-value${de==="unknown"?" dim":""}`},de),xe&&React.createElement("span",{className:"model-rl-b\
adge",title:`Rate limited${xe!=="unknown"?` \u2014 resets at ${xe}`:""}`},"\u26A0")),_?.status==="ok"&&React.createElement(
"span",{className:"settings-inline-ok"},"Saved")),Ce&&pe.set_model&&F.length>0&&React.createElement("div",{className:"se\
ttings-row"},React.createElement("span",{className:"settings-label"},"Next send model"),React.createElement("select",{className:"\
settings-perm-select",value:he,disabled:C(_),onChange:G=>re(G.target.value)},React.createElement("option",{value:"",disabled:!0},
"Choose model\u2026"),F.map(G=>React.createElement("option",{key:G.id,value:G.id},G.label))),React.createElement("span",
{className:`settings-value small${t?.next_send_model_status==="failed"?" error":""}`},t?.next_send_model_status||"unset")),
(J==="antigravity"||J==="antigravity_panel")&&be.length>0&&React.createElement("div",{className:"settings-row",style:{alignItems:"\
flex-start"}},React.createElement("span",{className:"settings-label"},"Quotas"),React.createElement("div",{style:{display:"\
flex",flexDirection:"column",gap:6,flex:1,minWidth:0}},e?.available_ai_credits!=null&&React.createElement("span",{className:"\
settings-value"},"AI credits: ",e.available_ai_credits),React.createElement("div",{style:{display:"flex",flexWrap:"wrap",
gap:6}},be.map((G,bn)=>{let Rn=G?.percent_used,Un=Og(G?.model),ws=Rn>=90?"#f85149":Rn>=75?"#d29922":"#8b949e",ks=!!ee&&ee===
G?.model;return React.createElement("span",{key:G?.model||`quota-${bn}`,className:"composer-hint",title:G?.refreshes_in?
`${G.model} \xB7 resets in ${G.refreshes_in}`:G?.model||"",style:{color:ws,border:`1px solid ${ks?ws:"#30363d"}`,borderRadius:999,
padding:"2px 8px",background:ks?`${ws}18`:"rgba(110,118,129,0.08)"}},Un," ",Rn!=null?`${Rn}%`:"n/a")})))),(J==="antigrav\
ity"||J==="antigravity_panel")&&React.createElement("div",{className:"settings-row"},React.createElement("span",{className:"\
settings-label"},"Mode"),React.createElement("select",{className:"settings-perm-select",value:z==="unknown"?"Planning":z,
disabled:C(Z),onChange:G=>St(G.target.value)},pp.map(G=>React.createElement("option",{key:G.id,value:G.id},G.label))),Z?.
status==="ok"&&React.createElement("span",{className:"settings-inline-ok"},"Saved")),ec(J)&&pe.set_mode&&Re.length>0&&React.
createElement("div",{className:"settings-row"},React.createElement("span",{className:"settings-label"},"Mode"),React.createElement(
"select",{className:"settings-perm-select",value:z==="unknown"?Re[0].id:z,disabled:C(Z),onChange:G=>St(G.target.value)},
Re.map(G=>React.createElement("option",{key:G.id,value:G.id},G.label)),z!=="unknown"&&!Re.some(G=>G.id===z)&&React.createElement(
"option",{value:z},z)),Z?.status==="ok"&&React.createElement("span",{className:"settings-inline-ok"},"Saved")),(J==="cla\
ude"||J==="claude_cli"||J==="codex_cli"||J==="cursor_cli"||J==="continue_yolo"||ec(J))&&React.createElement("div",{className:"\
settings-row"},React.createElement("span",{className:"settings-label"},"Permission mode"),pe.permission_mode_change&&ae.
length>0?React.createElement("select",{className:"settings-perm-select",value:H==="unknown"?jg(J):H,disabled:C(L),onChange:G=>Te(
G.target.value)},ae.map(G=>React.createElement("option",{key:G.value,value:G.value},G.label)),!ae.some(G=>G.value===H)&&
H!=="unknown"&&React.createElement("option",{value:H},H)):React.createElement("span",{className:`settings-value${H==="un\
known"?" dim":""}`},H),L?.status==="ok"&&React.createElement("span",{className:"settings-inline-ok"},"Saved")),J==="code\
x_cli"&&t?.approval_policy&&React.createElement("div",{className:"settings-row"},React.createElement("span",{className:"\
settings-label"},"Approval policy"),React.createElement("span",{className:"settings-value"},t.approval_policy)),J==="cla\
ude"&&ke&&ke!=="unknown"&&React.createElement("div",{className:"settings-row"},React.createElement("span",{className:"se\
ttings-label"},"Effort"),React.createElement("span",{className:"settings-value"},((t?.available_efforts||[]).find(G=>G.id===
ke)||{}).label||ke)),(J==="claude_cli"||J==="codex_cli"||J==="cursor_cli")&&pe.set_effort&&(t?.available_efforts||[]).length>
0&&React.createElement("div",{className:"settings-row"},React.createElement("span",{className:"settings-label"},Ce?"Obse\
rved effort":"Effort"),Ce?React.createElement("span",{className:`settings-value${!ke||ke==="unknown"?" dim":""}`,title:t?.
effort_provenance?.source||"No exact native metadata observed"},ke||"unknown"):React.createElement("select",{className:"\
settings-perm-select",value:ke||"medium",disabled:C(P),onChange:G=>Ke(G.target.value)},(t.available_efforts||[]).map(G=>React.
createElement("option",{key:G.id,value:G.id},G.label))),P?.status==="ok"&&React.createElement("span",{className:"setting\
s-inline-ok"},"Saved")),Ce&&pe.set_effort&&(t?.available_efforts||[]).length>0&&React.createElement("div",{className:"se\
ttings-row"},React.createElement("span",{className:"settings-label"},"Next send effort"),React.createElement("select",{className:"\
settings-perm-select",value:Ee,disabled:C(P),onChange:G=>Ke(G.target.value)},React.createElement("option",{value:"",disabled:!0},
"Choose effort\u2026"),(t.available_efforts||[]).map(G=>React.createElement("option",{key:G.id,value:G.id},G.label))),React.
createElement("span",{className:`settings-value small${t?.next_send_effort_status==="failed"?" error":""}`},t?.next_send_effort_status&&
t.next_send_effort_status!=="unset"?t.next_send_effort_status:"No override selected")),(J==="codex"||J==="codex-desktop")&&
pe.set_codex_config&&React.createElement(React.Fragment,null,pe.codex_model_change&&(t?.available_models||[]).length>0&&
React.createElement("div",{className:"settings-row"},React.createElement("span",{className:"settings-label"},se?"Next tu\
rn model":"Model"),React.createElement("select",{className:"settings-perm-select",value:t?.model_id||"unknown",disabled:C(
_)||!Q,onChange:G=>{f?.({model_id:G.target.value})}},(t?.available_models||[]).map(G=>React.createElement("option",{key:G.
id,value:G.id},G.label)),t?.model_id&&!(t?.available_models||[]).some(G=>G.id===t.model_id)&&t.model_id!=="unknown"&&React.
createElement("option",{value:t.model_id},t.model_id)),_?.status==="ok"&&React.createElement("span",{className:"settings\
-inline-ok"},"Saved")),pe.codex_effort_change&&(t?.available_efforts||[]).length>0&&React.createElement("div",{className:"\
settings-row"},React.createElement("span",{className:"settings-label"},se?"Next turn effort":"Effort"),React.createElement(
"select",{className:"settings-perm-select",value:(t?.effort||"unknown").toLowerCase(),disabled:C(P)||!Q,onChange:G=>{f?.(
{effort:G.target.value})}},(t?.available_efforts||[]).map(G=>React.createElement("option",{key:G.id,value:G.id},G.label))),
P?.status==="ok"&&React.createElement("span",{className:"settings-inline-ok"},"Saved")),pe.codex_permission_profile_change&&
(t?.available_permission_profiles||[]).length>0&&React.createElement("div",{className:"settings-row"},React.createElement(
"span",{className:"settings-label"},"Next turn permissions"),React.createElement("select",{className:"settings-perm-sele\
ct",value:t?.permission_profile||"unknown",disabled:C(W)||!Q,onChange:G=>on(G.target.value)},(t?.available_permission_profiles||
[]).map(G=>React.createElement("option",{key:G.id,value:G.id},G.label))),W?.status==="ok"&&React.createElement("span",{className:"\
settings-inline-ok"},"Saved")),S&&React.createElement("div",{className:"settings-bypass-confirmation",role:"alert"},React.
createElement("strong",null,"Enable Bypass permissions?"),React.createElement("span",null,"Full access sets approval pol\
icy to Never and sandbox access to danger-full-access for this Codex conversation."),React.createElement("div",{className:"\
settings-bypass-actions"},React.createElement("button",{type:"button",onClick:()=>T(!1)},"Cancel"),React.createElement("\
button",{type:"button",className:"danger",onClick:()=>on("full-access",!0)},"Enable Full access"))),se&&t?.bypass_permissions_active&&
(b||t?.bypass_restore_profile)&&React.createElement("div",{className:"settings-row"},React.createElement("span",{className:"\
settings-label"},"Bypass permissions"),React.createElement("button",{type:"button",className:"settings-restore-safe",disabled:C(
W),onClick:()=>on(b||t.bypass_restore_profile)},"Restore previous safe permissions")),se&&React.createElement(React.Fragment,
null,React.createElement("div",{className:"settings-row"},React.createElement("span",{className:"settings-label"},"Appro\
val policy"),React.createElement("span",{className:"settings-value"},t?.approval_policy||"Native custom policy")),React.
createElement("div",{className:"settings-row"},React.createElement("span",{className:"settings-label"},"Access / sandbox"),
React.createElement("span",{className:"settings-value"},t?.permission_mode||"Native custom access")),!Q&&React.createElement(
"div",{className:"settings-control-unavailable",role:"status"},t?.controls_unavailable_reason||"Codex controls are unava\
ilable for this conversation.")),pe.codex_access_change&&(t?.available_access||[]).length>0&&React.createElement("div",{
className:"settings-row"},React.createElement("span",{className:"settings-label"},"Access"),React.createElement("select",
{className:"settings-perm-select",value:t?.permission_mode||"unknown",disabled:C(ge),onChange:G=>{f?.({access_mode:G.target.
value})}},(t?.available_access||[]).map(G=>React.createElement("option",{key:G.id,value:G.id},G.label)))),pe.codex_speed_change&&
(t?.available_speeds||[]).length>0&&React.createElement("div",{className:"settings-row"},React.createElement("span",{className:"\
settings-label"},"Speed"),React.createElement("select",{className:"settings-perm-select",value:(t?.speed||"standard").toLowerCase(),
disabled:C(oe),onChange:G=>{f?.({speed:G.target.value})}},(t?.available_speeds||[]).map(G=>React.createElement("option",
{key:G.id,value:G.id},G.label)))),J==="codex-desktop"&&t?.branch&&t.branch!=="unknown"&&React.createElement("div",{className:"\
settings-row"},React.createElement("span",{className:"settings-label"},"Branch"),React.createElement("span",{className:"\
settings-value"},t.branch)),J==="codex-desktop"&&t?.sandbox_status&&React.createElement("div",{className:"settings-row"},
React.createElement("span",{className:"settings-label"},"Sandbox"),React.createElement("span",{className:`settings-value${t.
sandbox_status.active?"":" dim"}`},t.sandbox_status.active?"\u{1F7E2}":"\u26AA"," ",t.sandbox_status.label||(t.sandbox_status.
active?"Active":"Inactive"))),J==="codex-desktop"&&(t?.available_workspaces||[]).length>0&&React.createElement("div",{className:"\
settings-row"},React.createElement("span",{className:"settings-label"},"Workspace"),React.createElement("select",{className:"\
settings-perm-select",value:t?.file_access_scope||"",disabled:C(te),onChange:G=>{v&&v(h,G.target.value)}},(t.available_workspaces||
[]).map(G=>React.createElement("option",{key:G.id,value:G.path||G.id},G.label)))),ue&&React.createElement("div",{className:"\
settings-row"},React.createElement("span",{className:X?.status==="failed"?"settings-error":"settings-inline-ok",role:"st\
atus"},ue))),(J==="codex"||J==="codex-desktop")&&!pe.set_codex_config&&React.createElement("div",{className:"settings-ro\
w"},React.createElement("span",{className:"settings-label"},"Access"),React.createElement("span",{className:`settings-va\
lue${H==="unknown"?" dim":""}`},H)),Qd(J)&&t?.mode&&t.mode!=="unknown"&&React.createElement("div",{className:"settings-r\
ow"},React.createElement("span",{className:"settings-label"},"Mode"),React.createElement("span",{className:"settings-val\
ue"},t.mode)),pe.auto_approve_permissions_toggle&&React.createElement("div",{className:"settings-row settings-row-checkb\
ox"},React.createElement("span",{className:"settings-label"},"Tool Prompts"),React.createElement("label",{className:"set\
tings-checkbox"},React.createElement("input",{type:"checkbox",checked:fe,disabled:C(V),onChange:G=>vs(G.target.checked)}),
React.createElement("span",null,"Auto-approve permission prompts")),V?.status==="ok"&&React.createElement("span",{className:"\
settings-inline-ok"},"Saved")),(()=>{let G=He!=="unknown"?He:e?.workspace_name||e?.window_title||null;return React.createElement(
"div",{className:"settings-row"},React.createElement("span",{className:"settings-label"},"Workspace"),React.createElement(
"span",{className:`settings-value small${G?"":" dim"}`,title:G||""},G?He!=="unknown"&&G.split(/[\\/]/).pop()||G:"\u2014"))})(),
ue&&!(J==="codex"||J==="codex-desktop")&&React.createElement("div",{className:X?.status==="failed"?"settings-error":"set\
tings-inline-ok",role:"status"},ue)),React.createElement("div",{className:"settings-panel-footer"},React.createElement("\
button",{className:"settings-refresh",onClick:()=>{h&&s(h)}},"\u21BB Refresh")))}function gk({chats:e,sessionId:t,onSwitch:n,
onNew:s,onClose:a,onMinimize:o}){return React.createElement("div",{className:"chat-list-panel"},React.createElement("div",
{className:"chat-list-header"},React.createElement("span",{className:"chat-list-title"},"Conversations"),React.createElement(
"button",{className:"chat-list-new-btn",onClick:s,title:"New conversation"},"+"),React.createElement(rt,{paneId:"chat-li\
st",onMinimize:o}),React.createElement("button",{className:"chat-list-close-btn",onClick:a,title:"Close"},"\u2715")),React.
createElement("div",{className:"chat-list-body"},!e||e.length===0?React.createElement("div",{className:"chat-list-empty"},
"No conversations found"):e.map((c,u)=>React.createElement("button",{key:c.id||u,className:`chat-list-item${c.active?" a\
ctive":""}`,onClick:()=>n(c.id),title:c.title},React.createElement("span",{className:"chat-list-item-title"},c.title),c.
active&&React.createElement("span",{className:"chat-list-item-active"},"\u25CF")))))}function Kd({items:e,onNavigate:t,onNew:n,
onClose:s,embedded:a=!1,loading:o=!1}){let c=Array.isArray(e)?e:[],u=c.filter(h=>h?.kind==="nav"),m=c.filter(h=>h?.kind===
"project"),f=c.filter(h=>!h?.kind||h.kind==="chat"),v=c.filter(h=>h?.kind==="see_all"),k=[],R=new Map;m.forEach(h=>{let M=h.
project_index!=null?`idx:${h.project_index}`:`name:${h.project||h.title||"Project"}`;R.has(M)||(k.push(M),R.set(M,h.title||
h.project||"Project"))}),f.forEach(h=>{let M=h.project_index!=null?`idx:${h.project_index}`:`name:${h.project||"Other"}`;
R.has(M)||(k.push(M),R.set(M,h.project||"Other"))});let S=f.filter(h=>h.project_index==null&&!h.project);function T(h){return h===
"new_conversation"?"New Conversation":h==="conversation_history"?"Conversation History":h==="scheduled_tasks"?"Scheduled\
 Tasks":"Agent Manager"}function b(h,M){return React.createElement("button",{key:h.id||M,className:`agv2-chat-item${h.active?
" active":""}`,type:"button",onClick:()=>t(h.id),title:h.title||"Untitled"},React.createElement("span",{className:"agv2-\
chat-title"},h.title||"Untitled"),h.age&&React.createElement("span",{className:"agv2-chat-age"},h.age),h.active&&React.createElement(
"span",{className:"agv2-chat-active"},"\u25CF"))}let w=React.createElement(React.Fragment,null,React.createElement("div",
{className:"agv2-nav-actions"},(u.length?u:[{id:"__agv2:new_conversation",action:"new_conversation"},{id:"__agv2:convers\
ation_history",action:"conversation_history"},{id:"__agv2:scheduled_tasks",action:"scheduled_tasks"}]).map(h=>React.createElement(
"button",{key:h.id||h.action,className:`agv2-nav-action ${h.action||""}`,type:"button",onClick:()=>h.action==="new_conve\
rsation"?n():t(h.id)},React.createElement("span",{className:"agv2-nav-action-icon"},h.action==="new_conversation"?"+":h.
action==="scheduled_tasks"?"\u25F7":"\u21BA"),React.createElement("span",null,h.title||T(h.action))))),React.createElement(
"div",{className:"agv2-project-list"},k.length===0&&S.length===0?React.createElement("div",{className:"chat-list-empty"},
o?"Loading conversations...":"No projects or conversations found"):React.createElement(React.Fragment,null,k.map(h=>{let M=R.
get(h)||"Project",C=f.filter(L=>(L.project_index!=null?`idx:${L.project_index}`:`name:${L.project||"Other"}`)===h),_=v.filter(
L=>(L.project_index!=null?`idx:${L.project_index}`:`name:${L.project||"Other"}`)===h);return React.createElement("sectio\
n",{className:"agv2-project-section",key:h},React.createElement("div",{className:"agv2-project-header"},React.createElement(
"span",{className:"agv2-project-icon"},"\u2302"),React.createElement("span",{className:"agv2-project-title"},M)),React.createElement(
"div",{className:"agv2-project-chats"},C.length===0?React.createElement("div",{className:"agv2-project-empty"},"No visib\
le conversations"):C.map(b),_.map(L=>React.createElement("button",{key:L.id,className:"agv2-see-all",type:"button",onClick:()=>t(
L.id)},L.title||"See all"))))}),S.length>0&&React.createElement("section",{className:"agv2-project-section"},React.createElement(
"div",{className:"agv2-project-header"},React.createElement("span",{className:"agv2-project-icon"},"\u2302"),React.createElement(
"span",{className:"agv2-project-title"},"Other")),React.createElement("div",{className:"agv2-project-chats"},S.map(b))))));
return a?React.createElement("div",{className:"agv2-nav-embedded"},w):React.createElement("div",{className:"chat-list-pa\
nel agv2-nav-panel"},React.createElement("div",{className:"chat-list-header"},React.createElement("span",{className:"cha\
t-list-title"},"Antigravity Agent Manager"),React.createElement("button",{className:"chat-list-new-btn",onClick:n,title:"\
New conversation"},"+"),React.createElement("button",{className:"chat-list-close-btn",onClick:s,title:"Close"},"\u2715")),
React.createElement("div",{className:"chat-list-body agv2-nav-body"},w))}function Hg(e){return e?.active||e?.view_state===
"native_active"?"Live":e?.view_state==="archive"?"Read-only archive":e?.view_state==="unavailable"?"Open once in Desktop":
e?.pollability?.pollable===!1?"Not pollable":""}function zg(e){let t=Hg(e),n=e?.pollability?.required_action||e?.pollability?.
reason||"";return[e?.title||"Untitled",t,n].filter(Boolean).join(" \xB7 ")}function _k({threads:e,selectedThreadId:t,sessionId:n,
onSwitch:s,onNew:a,onClose:o,onMinimize:c,controlPolicy:u,canCreateThread:m=!0,newLabel:f="New thread"}){let v=u||{},k=v.
selectionMode||"native";return React.createElement("div",{className:"chat-list-panel"},React.createElement("div",{className:"\
chat-list-header"},React.createElement("span",{className:"chat-list-title"},"Threads"),React.createElement("button",{className:"\
chat-list-new-btn",onClick:a,title:m?f:v.reason||"Native thread creation is unavailable",disabled:!m,"aria-disabled":!m},
"+"),React.createElement(rt,{paneId:"thread-list",onMinimize:c}),React.createElement("button",{className:"chat-list-clos\
e-btn",onClick:o,title:"Close"},"\u2715")),React.createElement("div",{className:"chat-list-body"},!!v.notice&&React.createElement(
"div",{className:`thread-control-notice mode-${k}`,role:"status"},React.createElement("strong",null,v.nativeSwitchEnabled?
"Native thread control":"RAC archive viewer"),React.createElement("span",null,v.notice)),!e||e.length===0?React.createElement(
"div",{className:"chat-list-empty"},"No threads found"):e.map((R,S)=>{let T=t?String(R.id||"")===String(t)||String(R.cache_key||
"")===String(t):!!R.active,b=Hg(R),w=v.nativeSwitchEnabled?`Switch Codex Desktop to ${R.title||"Untitled chat"}`:R.active?
`Show native-active chat ${R.title||"Untitled chat"} in RAC`:`View ${R.title||"Untitled chat"} in RAC only; does not swi\
tch Codex Desktop`;return React.createElement("button",{key:R.cache_key||R.id||S,className:`chat-list-item${T?" active":
""}`,onClick:()=>s(R.id,k),title:`${w} \xC2\xB7 ${zg(R)}`,"aria-label":w,"data-selection-mode":k},React.createElement("s\
pan",{className:"chat-list-item-copy"},React.createElement("span",{className:"chat-list-item-title"},R.title),b&&React.createElement(
"span",{className:`chat-list-item-state state-${R.view_state||"unknown"}`},b)),R.age&&React.createElement("span",{className:"\
chat-list-item-age"},R.age),T&&React.createElement("span",{className:"chat-list-item-active"},"\u25CF"))})))}function bk({
threads:e,activeThreadId:t,onSwitch:n,onNew:s,onOpenHistory:a,controlPolicy:o,canCreateThread:c=!0,showDraftTab:u=!1,newLabel:m="\
New chat"}){let f=o||{},v=f.selectionMode||"native";return React.createElement("div",{className:"thread-tabs-bar","data-\
selection-mode":v},!!f.notice&&React.createElement("span",{className:`thread-tabs-scope mode-${v}`,role:"status",title:f.
notice},f.nativeSwitchEnabled?"Native tabs":"RAC-only archive view"),React.createElement("div",{className:"thread-tabs-s\
croll"},u&&React.createElement("button",{className:"thread-tab active draft",type:"button",title:m},React.createElement(
"span",{className:"thread-tab-title"},m)),(e||[]).map((k,R)=>{let S=t?String(k.id||"")===String(t)||String(k.cache_key||
"")===String(t):!!k.active,T=f.nativeSwitchEnabled?`Switch Codex Desktop to ${k.title||"Untitled chat"}`:k.active?`Show \
native-active chat ${k.title||"Untitled chat"} in RAC`:`View ${k.title||"Untitled chat"} in RAC only; does not switch Co\
dex Desktop`;return React.createElement("button",{key:k.cache_key||k.id||R,className:`thread-tab${S?" active":""}`,type:"\
button",title:`${T} \xC2\xB7 ${zg(k)}`,"aria-label":T,"data-selection-mode":v,onClick:()=>n(k.id,v)},React.createElement(
"span",{className:"thread-tab-title"},k.title||"Untitled"),k.age&&React.createElement("span",{className:"thread-tab-age"},
k.age))})),React.createElement("div",{className:"thread-tabs-actions"},React.createElement("button",{className:"thread-t\
abs-btn",type:"button",onClick:a,title:"Show all threads"},"All"),React.createElement("button",{className:"thread-tabs-b\
tn accent",type:"button",onClick:s,title:c?m:f.reason||"Native thread creation is unavailable",disabled:!c,"aria-disable\
d":!c},"+")))}function yk({branchData:e,sessionId:t,currentBranch:n,onSwitch:s,onCreate:a,onClose:o,onMinimize:c}){let[u,
m]=React.useState(""),[f,v]=React.useState(!1),[k,R]=React.useState(""),S=e?.branches||[],T=e?.current||n||"",b=u?S.filter(
w=>w.toLowerCase().includes(u.toLowerCase())):S;return React.createElement("div",{className:"branch-selector-panel"},React.
createElement("div",{className:"branch-selector-header"},React.createElement("span",{className:"branch-selector-title"},
"Branches"),React.createElement(rt,{paneId:"branch-selector",onMinimize:c}),React.createElement("button",{className:"cha\
t-list-close-btn",onClick:o,title:"Close"},"\u2715")),React.createElement("div",{className:"branch-selector-search"},React.
createElement("input",{type:"text",className:"branch-search-input",placeholder:"Search branches\u2026",value:u,onChange:w=>m(
w.target.value),autoFocus:!0})),React.createElement("div",{className:"branch-selector-body"},b.length===0&&!f&&React.createElement(
"div",{className:"chat-list-empty"},"No branches found"),b.map((w,h)=>React.createElement("button",{key:w,className:`bra\
nch-item${w===T?" active":""}`,onClick:()=>{w!==T&&s(w)},title:w},React.createElement("span",{className:"branch-item-ico\
n"},w===T?"\u2713":""),React.createElement("span",{className:"branch-item-name"},w)))),React.createElement("div",{className:"\
branch-selector-footer"},f?React.createElement("form",{className:"branch-create-form",onSubmit:w=>{w.preventDefault(),k.
trim()&&(a(k.trim()),v(!1),R(""))}},React.createElement("input",{type:"text",className:"branch-create-input",placeholder:"\
new-branch-name",value:k,onChange:w=>R(w.target.value),autoFocus:!0}),React.createElement("button",{type:"submit",className:"\
branch-create-submit",disabled:!k.trim()},"Create"),React.createElement("button",{type:"button",className:"branch-create\
-cancel",onClick:()=>{v(!1),R("")}},"\u2715")):React.createElement("button",{className:"branch-create-btn",onClick:()=>v(
!0)},"+ Create and checkout new branch")))}function vk({entries:e,canRead:t,canInput:n,onClose:s,onRefresh:a,onSend:o,controlResults:c,
onMinimize:u}){let[m,f]=_e(""),[v,k]=_e(null),R=v?c?.[v]:null;function S(T){T.preventDefault();let b=m.trim();!b||!o||(k(
o(b)),f(""))}return React.createElement("div",{className:"terminal-viewer"},React.createElement("div",{className:"termin\
al-viewer-header"},React.createElement("span",{className:"terminal-viewer-title"},"Terminal"),t&&React.createElement("bu\
tton",{className:"terminal-viewer-refresh",onClick:a,title:"Refresh"},"\u21BB"),React.createElement(rt,{paneId:"terminal",
onMinimize:u}),React.createElement("button",{className:"terminal-viewer-close",onClick:s,title:"Close"},"\u2715")),t?React.
createElement("div",{className:"terminal-viewer-body"},!e||e.length===0?React.createElement("div",{className:"terminal-v\
iewer-empty"},"No terminal output captured"):e.map((T,b)=>React.createElement("div",{key:b,className:"terminal-entry"},T.
command&&React.createElement("div",{className:"terminal-command"},"$ ",T.command),React.createElement("pre",{className:"\
terminal-output"},T.output)))):React.createElement("div",{className:"terminal-viewer-empty"},"Terminal output is unavail\
able for this harness."),n&&React.createElement("form",{className:"terminal-input-form",onSubmit:S},React.createElement(
"input",{className:"terminal-input",type:"text",value:m,onChange:T=>f(T.target.value),placeholder:"Enter a command in th\
is session's terminal","aria-label":"Terminal command"}),React.createElement("button",{className:"terminal-input-send",type:"\
submit",disabled:!m.trim()},"Run"),v&&React.createElement("div",{className:`terminal-input-status ${R?.result||"pending"}`,
role:"status"},R?R.result==="ok"?"Command sent":`Command failed: ${R.error?.message||R.error?.code||"unknown error"}`:"C\
ommand pending\u2026")))}function wk({entries:e,onClose:t,onRefresh:n,onAccept:s,onReject:a,onMinimize:o}){let c=u=>{let m=String(
u||"").trim();return m?m.split(/\s+/).filter(Boolean).map(f=>({text:f,cls:f.startsWith("+")?"add":f.startsWith("-")?"del":
"neutral"})):[]};return React.createElement("div",{className:"diff-viewer"},React.createElement("div",{className:"diff-v\
iewer-header"},React.createElement("span",{className:"diff-viewer-title"},"File Changes"),React.createElement("button",{
className:"diff-viewer-refresh",onClick:n,title:"Refresh"},"\u21BB"),React.createElement(rt,{paneId:"diff-viewer",onMinimize:o}),
React.createElement("button",{className:"diff-viewer-close",onClick:t,title:"Close"},"\u2715")),React.createElement("div",
{className:"diff-viewer-body"},!e||e.length===0?React.createElement("div",{className:"diff-viewer-empty"},"No file chang\
es detected"):e.map((u,m)=>React.createElement("div",{key:m,className:"diff-entry"},u.file&&React.createElement("div",{className:"\
diff-file-header"},React.createElement("span",null,u.file||u.path),(u.can_accept||u.can_reject)&&s&&a&&React.createElement(
"span",{className:"diff-file-actions"},u.can_accept&&React.createElement("button",{type:"button",className:"diff-action-\
accept",onClick:()=>s(u.id||u.path)},"Accept"),u.can_reject&&React.createElement("button",{type:"button",className:"diff\
-action-reject",onClick:()=>a(u.id||u.path)},"Reject"))),u.summary&&React.createElement("div",{className:"diff-file-summ\
ary"},c(u.summary).map((f,v)=>React.createElement("span",{key:v,className:`diff-file-summary-chip diff-file-summary-chip\
-${f.cls}`},f.text))),u.content?React.createElement("pre",{className:"diff-content"},u.content.split(`
`).map((f,v)=>{let k=f.startsWith("+")?"diff-add":f.startsWith("-")?"diff-del":f.startsWith("@@")?"diff-hunk":"";return React.
createElement("span",{key:v,className:k},f,`
`)})):!u.summary&&React.createElement("pre",{className:"diff-content"},"No content")))))}var Vd={directory:"\u{1F4C1}",md:"\
\u{1F4C4}",txt:"\u{1F4C4}",json:"\u{1F4CB}",js:"\u{1F4DC}",jsx:"\u{1F4DC}",ts:"\u{1F4DC}",tsx:"\u{1F4DC}",py:"\u{1F40D}",
html:"\u{1F310}",css:"\u{1F3A8}",yml:"\u2699",yaml:"\u2699",toml:"\u2699",sh:"\u26A1",bat:"\u26A1",ps1:"\u26A1",env:"\u{1F512}",
lock:"\u{1F512}",png:"\u{1F5BC}",jpg:"\u{1F5BC}",gif:"\u{1F5BC}",svg:"\u{1F5BC}",default:"\u{1F4C4}"};function kk(e){if(e.
type==="directory")return Vd.directory;let t=e.name.split(".").pop().toLowerCase();return Vd[t]||Vd.default}function Sk(e){
return e==null?"":e<1024?`${e} B`:e<1024*1024?`${(e/1024).toFixed(1)} KB`:`${(e/(1024*1024)).toFixed(1)} MB`}var Nk=new Set(
["md","txt","json","js","jsx","ts","tsx","py","html","css","yml","yaml","toml","sh","bat","ps1","cfg","conf","ini","xml",
"csv","log","env","gitignore","dockerignore","sql","rs","go","java","c","cpp","h","hpp","rb","php","swift","kt","scala",
"r","lua","vim","zsh","bash","fish"]);function wg(e){let t=e.split(".").pop().toLowerCase();return Nk.has(t)||e.startsWith(
".")}function xk(e){return e.toLowerCase().endsWith(".md")}function Ck({path:e,content:t,truncated:n,onBack:s,onMinimize:a}){
let o=React.useMemo(()=>{if(!t)return"";try{let m=marked.parse(t);return DOMPurify.sanitize(m)}catch{return`<pre>${DOMPurify.
sanitize(t)}</pre>`}},[t]),c=React.useRef(null);React.useEffect(()=>{c.current&&c.current.querySelectorAll("pre code").forEach(
m=>{hljs.highlightElement(m)})},[o]);let u=e?e.split("/").pop().split("\\").pop():"File";return React.createElement("div",
{className:"file-viewer"},React.createElement("div",{className:"file-viewer-header"},React.createElement("button",{className:"\
file-viewer-back",onClick:s,title:"Back to files"},"\u2190"),React.createElement("span",{className:"file-viewer-title",title:e},
u),n&&React.createElement("span",{className:"file-viewer-truncated"},"truncated"),a&&React.createElement(rt,{paneId:"fil\
e-browser",onMinimize:a})),React.createElement("div",{className:"file-viewer-body markdown-body",ref:c,dangerouslySetInnerHTML:{
__html:o}}))}function Ak({path:e,content:t,truncated:n,onBack:s,onMinimize:a}){let o=e?e.split("/").pop().split("\\").pop():
"File",c=o.split(".").pop().toLowerCase(),u=React.useMemo(()=>{if(!t)return"";try{return c&&hljs.getLanguage(c)?hljs.highlight(
t,{language:c}).value:hljs.highlightAuto(t).value}catch{return DOMPurify.sanitize(t)}},[t,c]);return React.createElement(
"div",{className:"file-viewer"},React.createElement("div",{className:"file-viewer-header"},React.createElement("button",
{className:"file-viewer-back",onClick:s,title:"Back to files"},"\u2190"),React.createElement("span",{className:"file-vie\
wer-title",title:e},o),n&&React.createElement("span",{className:"file-viewer-truncated"},"truncated"),a&&React.createElement(
rt,{paneId:"file-browser",onMinimize:a})),React.createElement("div",{className:"file-viewer-body"},React.createElement("\
pre",{className:"file-viewer-code"},React.createElement("code",{dangerouslySetInnerHTML:{__html:u}}))))}function Mk(e,t){let n=Ei(e||"text"),s=Math.max(...String(t||"").match(/`+/g)?.map(o=>o.length)||[0]),a="`".repeat(Math.
max(3,s+1));return`${a}${n}
${t||""}
${a}`}function Rk({sessionId:e,filePath:t,fileContents:n,onClose:s}){let a=`${e}:${t}`,o=n[a],c=o?.content||"",u=o?.truncated||
!1,m=React.useMemo(()=>Mk(t,c),[t,c]);return React.createElement("div",{className:"transcript-inline-preview"},React.createElement(
"div",{className:"transcript-inline-preview-header"},React.createElement("span",{className:"transcript-inline-preview-ti\
tle",title:t},t),u&&React.createElement("span",{className:"file-viewer-truncated"},"truncated"),React.createElement("but\
ton",{className:"transcript-inline-preview-close",onClick:s,title:"Collapse"},"Collapse")),o?React.createElement(Pi,{content:m,
monospace:!0}):React.createElement("div",{className:"transcript-file-loading"},React.createElement("div",null,"Loading f\
ile preview...")))}function Tk({sessionId:e,listing:t,fileContents:n,onNavigate:s,onOpenFile:a,onClose:o,onRefresh:c,viewingFile:u,
onBackToListing:m,onMinimize:f}){if(u){let S=`${e}:${u}`,T=n[S],b=T?.content||"",w=T?.truncated||!1;return xk(u)?React.createElement(
Ck,{path:u,content:b,truncated:w,onBack:m,onMinimize:f}):React.createElement(Ak,{path:u,content:b,truncated:w,onBack:m,onMinimize:f})}
let v=t?.entries||[],k=t?.path||".",R=k==="."?[]:k.replace(/\\/g,"/").split("/").filter(Boolean);return React.createElement(
"div",{className:"file-browser"},React.createElement("div",{className:"file-browser-header"},React.createElement("span",
{className:"file-browser-title"},"Files"),React.createElement("button",{className:"file-browser-refresh",onClick:c,title:"\
Refresh"},"\u21BB"),React.createElement(rt,{paneId:"file-browser",onMinimize:f}),React.createElement("button",{className:"\
file-browser-close",onClick:o,title:"Close"},"\u2715")),React.createElement("div",{className:"file-browser-breadcrumbs"},
React.createElement("button",{className:"breadcrumb-item",onClick:()=>s(".")},"root"),R.map((S,T)=>{let b=R.slice(0,T+1).
join("/");return React.createElement(React.Fragment,{key:b},React.createElement("span",{className:"breadcrumb-sep"},"/"),
React.createElement("button",{className:"breadcrumb-item",onClick:()=>s(b)},S))})),React.createElement("div",{className:"\
file-browser-body"},v.length===0?React.createElement("div",{className:"file-browser-empty"},"Empty directory"):React.createElement(
"div",{className:"file-browser-list"},k!=="."&&React.createElement("div",{className:"file-browser-entry",onClick:()=>{let S=R.
slice(0,-1).join("/")||".";s(S)}},React.createElement("span",{className:"file-entry-icon"},"\u{1F4C1}"),React.createElement(
"span",{className:"file-entry-name"},"..")),v.map(S=>React.createElement("div",{key:S.name,className:`file-browser-entry${S.
type==="directory"?" is-dir":""}${wg(S.name)?" is-viewable":""}`,onClick:()=>{if(S.type==="directory"){let T=k==="."?S.name:
`${k}/${S.name}`;s(T)}else if(wg(S.name)){let T=k==="."?S.name:`${k}/${S.name}`;a(T)}}},React.createElement("span",{className:"\
file-entry-icon"},kk(S)),React.createElement("span",{className:"file-entry-name"},S.name),React.createElement("span",{className:"\
file-entry-meta"},S.type==="file"&&Sk(S.size)))))))}var $k={daily:"Daily",weekdays:"Weekdays",weekly:"Weekly",custom:"Cu\
stom"},sp={"Status reports":"\u{1F4CA}","Release prep":"\u{1F680}","Code quality":"\u{1F50D}",Documentation:"\u{1F4DD}",
General:"\u2699"};function Ek({automation:e,onEdit:t,onRun:n,onToggle:s}){let a=sp[e.category]||"\u2699",o=$k[e.schedule]||
e.schedule,c=ys[e.target_agent_type]||Xd;return React.createElement("div",{className:`automation-card${e.enabled?"":" di\
sabled"}`,onClick:()=>t(e)},React.createElement("div",{className:"automation-card-icon"},a),React.createElement("div",{className:"\
automation-card-body"},React.createElement("div",{className:"automation-card-name"},e.name),e.description&&React.createElement(
"div",{className:"automation-card-desc"},e.description)),React.createElement("div",{className:"automation-card-meta"},React.
createElement("span",{className:"automation-card-agent",style:{color:c.color},title:c.name},c.abbr),React.createElement(
"span",{className:"automation-card-schedule"},o," ",String(e.cron_hour).padStart(2,"0"),":",String(e.cron_minute).padStart(
2,"0"))),React.createElement("div",{className:"automation-card-actions",onClick:u=>u.stopPropagation()},React.createElement(
"button",{className:"automation-run-btn",title:"Run now",onClick:()=>n(e)},"\u25B6"),React.createElement("button",{className:`\
automation-toggle-btn${e.enabled?" on":""}`,title:e.enabled?"Disable":"Enable",onClick:()=>s(e)},e.enabled?"\u25CF":"\u25CB")))}
function Lk({automation:e,sessions:t,onSave:n,onDelete:s,onClose:a}){let o=!e?.id,[c,u]=_e({name:e?.name||"",description:e?.
description||"",category:e?.category||"General",prompt:e?.prompt||"",schedule:e?.schedule||"daily",cron_hour:e?.cron_hour??
9,cron_minute:e?.cron_minute??0,cron_days:e?.cron_days||[1,2,3,4,5],target_agent_type:e?.target_agent_type||"claude",target_session:e?.
target_session||"",enabled:e?.enabled!==!1}),[m,f]=_e(!1);function v(T,b){u(w=>({...w,[T]:b}))}function k(T){u(b=>{let w=b.
cron_days.includes(T)?b.cron_days.filter(h=>h!==T):[...b.cron_days,T].sort();return{...b,cron_days:w}})}async function R(T){
T.preventDefault(),!(!c.name.trim()||!c.prompt.trim())&&(f(!0),await n({...c,target_session:c.target_session||null}),f(!1))}
let S=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];return React.createElement("div",{className:"automation-modal-overlay",
onClick:a},React.createElement("div",{className:"automation-modal",onClick:T=>T.stopPropagation()},React.createElement("\
div",{className:"automation-modal-header"},React.createElement("span",null,o?"New Automation":"Edit Automation"),React.createElement(
"button",{className:"automation-modal-close",onClick:a},"\u2715")),React.createElement("form",{className:"automation-mod\
al-form",onSubmit:R},React.createElement("label",null,React.createElement("span",null,"Name"),React.createElement("input",
{type:"text",value:c.name,onChange:T=>v("name",T.target.value),placeholder:"e.g. Daily standup summary",required:!0})),React.
createElement("label",null,React.createElement("span",null,"Description"),React.createElement("input",{type:"text",value:c.
description,onChange:T=>v("description",T.target.value),placeholder:"Brief description (optional)"})),React.createElement(
"label",null,React.createElement("span",null,"Category"),React.createElement("select",{value:c.category,onChange:T=>v("c\
ategory",T.target.value)},Object.keys(sp).map(T=>React.createElement("option",{key:T,value:T},sp[T]," ",T)))),React.createElement(
"label",null,React.createElement("span",null,"Prompt"),React.createElement("textarea",{rows:4,value:c.prompt,onChange:T=>v(
"prompt",T.target.value),placeholder:"The prompt to send to the agent...",required:!0})),React.createElement("div",{className:"\
automation-modal-row"},React.createElement("label",{className:"half"},React.createElement("span",null,"Target Agent"),React.
createElement("select",{value:c.target_agent_type,onChange:T=>v("target_agent_type",T.target.value)},Object.entries(ys).
map(([T,b])=>React.createElement("option",{key:T,value:T},b.name)))),React.createElement("label",{className:"half"},React.
createElement("span",null,"Specific Session (optional)"),React.createElement("select",{value:c.target_session,onChange:T=>v(
"target_session",T.target.value)},React.createElement("option",{value:""},"Any matching session"),(t||[]).map(T=>{let b=typeof T==
"string"?T:T?.session_id,w=Qi(T);return React.createElement("option",{key:b,value:b},w.name,": ",Sm(b)||b)})))),React.createElement(
"div",{className:"automation-modal-row"},React.createElement("label",{className:"third"},React.createElement("span",null,
"Schedule"),React.createElement("select",{value:c.schedule,onChange:T=>v("schedule",T.target.value)},React.createElement(
"option",{value:"daily"},"Daily"),React.createElement("option",{value:"weekdays"},"Weekdays"),React.createElement("optio\
n",{value:"weekly"},"Weekly"),React.createElement("option",{value:"custom"},"Custom days"))),React.createElement("label",
{className:"third"},React.createElement("span",null,"Hour"),React.createElement("input",{type:"number",min:0,max:23,value:c.
cron_hour,onChange:T=>v("cron_hour",parseInt(T.target.value)||0)})),React.createElement("label",{className:"third"},React.
createElement("span",null,"Minute"),React.createElement("input",{type:"number",min:0,max:59,value:c.cron_minute,onChange:T=>v(
"cron_minute",parseInt(T.target.value)||0)}))),(c.schedule==="custom"||c.schedule==="weekly")&&React.createElement("div",
{className:"automation-days-row"},React.createElement("span",null,"Days:"),S.map((T,b)=>React.createElement("button",{key:b,
type:"button",className:`automation-day-btn${c.cron_days.includes(b)?" active":""}`,onClick:()=>k(b)},T))),React.createElement(
"div",{className:"automation-modal-footer"},!o&&React.createElement("button",{type:"button",className:"automation-delete\
-btn",onClick:()=>s(e)},"Delete"),React.createElement("div",{style:{flex:1}}),React.createElement("button",{type:"button",
className:"automation-cancel-btn",onClick:a},"Cancel"),React.createElement("button",{type:"submit",className:"automation\
-save-btn",disabled:m||!c.name.trim()||!c.prompt.trim()},m?"Saving...":o?"Create":"Save")))))}function Ok({sessions:e,onBack:t}){
let[n,s]=_e([]),[a,o]=_e(!0),[c,u]=_e(null),[m,f]=_e("");function v(h){f(h),setTimeout(()=>f(""),3e3)}async function k(){
try{let h=await fetch("/api/automations");if(!h.ok)throw new Error("Failed to fetch");let M=await h.json();s(M.automations||
[])}catch{v("Failed to load automations")}finally{o(!1)}}$e(()=>{k()},[]);async function R(h){let M=!c?.id,C=M?"/api/aut\
omations":`/api/automations/${c.id}`,_=M?"POST":"PUT";try{if(!(await fetch(C,{method:_,headers:{"Content-Type":"applicat\
ion/json"},body:JSON.stringify(h)})).ok)throw new Error("Save failed");v(M?"Automation created":"Automation updated"),u(
null),k()}catch{v("Failed to save automation")}}async function S(h){if(window.confirm(`Delete "${h.name}"?`))try{await fetch(
`/api/automations/${h.id}`,{method:"DELETE"}),v("Automation deleted"),u(null),k()}catch{v("Failed to delete")}}async function T(h){
try{let M=await fetch(`/api/automations/${h.id}/run`,{method:"POST"}),C=await M.json();M.ok?v(`Running "${h.name}"...`):
v(C.error||"Failed to run")}catch{v("Failed to run automation")}}async function b(h){try{await fetch(`/api/automations/${h.
id}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({enabled:!h.enabled})}),k()}catch{v("\
Failed to toggle")}}let w={};for(let h of n){let M=h.category||"General";w[M]||(w[M]=[]),w[M].push(h)}return React.createElement(
"div",{className:"automations-view","data-pane-id":"route-automations"},React.createElement("div",{className:"automation\
s-header"},React.createElement("button",{className:"automations-back","data-route-return":"chat",onClick:t,title:"Back t\
o chat"},"\u2190 Back to chat"),React.createElement("div",{className:"automations-header-text"},React.createElement("h2",
null,"Automations"),React.createElement("p",null,"Automate work by sending scheduled prompts to your agents.")),React.createElement(
"button",{className:"automations-new-btn",onClick:()=>u({})},"+ New automation")),a?React.createElement("div",{className:"\
automations-loading"},"Loading automations..."):n.length===0?React.createElement("div",{className:"automations-empty"},React.
createElement("div",{className:"automations-empty-icon"},"\u2699"),React.createElement("div",{className:"automations-emp\
ty-text"},"No automations yet"),React.createElement("div",{className:"automations-empty-sub"},"Create your first automat\
ion to schedule recurring prompts to your agents."),React.createElement("button",{className:"automations-new-btn",onClick:()=>u(
{})},"+ New automation")):React.createElement("div",{className:"automations-body"},Object.entries(w).map(([h,M])=>React.
createElement("div",{key:h,className:"automations-category"},React.createElement("h3",{className:"automations-category-t\
itle"},h),React.createElement("div",{className:"automations-card-grid"},M.map(C=>React.createElement(Ek,{key:C.id,automation:C,
onEdit:u,onRun:T,onToggle:b})))))),c!==null&&React.createElement(Lk,{automation:c?.id?c:null,sessions:e,onSave:R,onDelete:S,
onClose:()=>u(null)}),m&&React.createElement("div",{className:"automations-toast"},m))}function Ik({view:e,onShow:t,onMinimize:n}){
if(!e?.visible)return null;let s=Array.isArray(e.status_rows)?e.status_rows:[],a=Array.isArray(e.detail_rows)?e.detail_rows:
[],o=e.status||s.find(c=>c.label==="Status")?.value||"";return React.createElement("aside",{className:"codex-automation-\
pane","aria-label":"Codex automation"},React.createElement("div",{className:"codex-automation-pane-header"},React.createElement(
"div",{className:"codex-automation-pane-icon"},"o"),React.createElement("div",{className:"codex-automation-pane-title"},
e.title||"Automation"),React.createElement(rt,{paneId:"automation-context",onMinimize:n})),e.description&&React.createElement(
"div",{className:"codex-automation-pane-desc"},e.description),(s.length>0||o)&&React.createElement("div",{className:"cod\
ex-automation-pane-section"},React.createElement("div",{className:"codex-automation-pane-section-title"},"Status"),s.length>
0?s.map((c,u)=>React.createElement("div",{key:`${c.label}-${u}`,className:"codex-automation-pane-row"},React.createElement(
"span",null,c.label),React.createElement("strong",{className:c.label==="Status"&&/active/i.test(c.value)?"active":""},c.
value))):React.createElement("div",{className:"codex-automation-pane-row"},React.createElement("span",null,"Status"),React.
createElement("strong",null,o))),a.length>0&&React.createElement("div",{className:"codex-automation-pane-section"},React.
createElement("div",{className:"codex-automation-pane-section-title"},"Details"),a.map((c,u)=>React.createElement("div",
{key:`${c.label}-${u}`,className:"codex-automation-pane-row"},React.createElement("span",null,c.label),React.createElement(
"strong",null,c.value)))),e.action_label&&React.createElement("button",{className:"codex-automation-pane-action",onClick:t},
e.action_label))}function Vi(e){return new Intl.NumberFormat([],{notation:"compact",maximumFractionDigits:1}).format(Math.
max(0,Number(e)||0))}function Pk({cost:e,detailState:t,onRequestDetail:n}){let[s,a]=React.useState(1),[o,c]=React.useState(
""),u=React.useMemo(()=>If(e,{days:s,project:o}),[e,s,o]),m=t?.status==="ready"?t.detail:null,f=!!m&&Number(m.query?.days)===
s&&String(m.query?.project||"")===o&&(!e?.generatedAt||String(m.generated_at||"")===e.generatedAt),v=t?.status==="loadin\
g"&&Number(t.query?.days)===s&&String(t.query?.project||"")===o&&String(t.query?.cursor||"0")==="0",k=f&&String(m.pagination?.
cursor||"0")==="0",R=f?{costUsd:Math.max(0,Number(m.summary?.cost_usd)||0),records:Math.max(0,Number(m.summary?.records)||
0),tokens:{input:Math.max(0,Number(m.summary?.tokens?.input)||0),cached:Math.max(0,Number(m.summary?.tokens?.cached)||0),
output:Math.max(0,Number(m.summary?.tokens?.output)||0)},byModel:Array.isArray(m.summary?.by_model)?m.summary.by_model:[],
byDay:Array.isArray(m.summary?.by_day)?m.summary.by_day:[]}:u;if(React.useEffect(()=>{!e?.detail?.truncated||!n||v||k||n(
{days:s,project:o,cursor:"0",pageSize:e.detail.pageSize||256})},[e?.detail?.truncated,e?.detail?.pageSize,e?.generatedAt,
s,o,n]),!e)return null;let S=(["ready","partial","stale"].includes(e.status)||e.status==="scanning"&&!!e.lastGoodGeneratedAt)&&
e.costUsd!=null&&e.records!=null&&e.tokens.input!=null&&e.tokens.cached!=null&&e.tokens.output!=null,T={"not-started":["\
Not scanned yet","The local cost scan has not completed."],idle:["Not scanned yet","The local cost scan has not complete\
d."],scanning:["Scanning local history","Provider quota remains available while cost files are scanned."],error:["Cost s\
can unavailable","The last cost payload failed its bounded structural contract. Provider quota is still current."],unavailable:[
"Cost scan unavailable","Local cost sources are unavailable. Provider quota is still current."],cancelled:["Cost scan ca\
ncelled","No zero total is reported because the scan did not complete."]}[e.status]||["Cost data pending","Waiting for a\
n authoritative local cost scan."];if(!S)return React.createElement("section",{className:"usage-cost-panel","aria-labell\
edby":"usage-cost-heading"},React.createElement("div",{className:"usage-cost-heading"},React.createElement("span",null,React.
createElement("h3",{id:"usage-cost-heading"},"Local estimated API-equivalent cost"),React.createElement("small",null,"Se\
parate from subscription quota")),React.createElement("span",{className:`usage-cost-status ${e.status}`},e.status)),React.
createElement("div",{className:"usage-cost-state",role:"status"},React.createElement("strong",null,T[0]),React.createElement(
"span",null,T[1]),e.reasonCode&&React.createElement("small",null,"Reason: ",e.reasonCode,e.reasonPath?` (${e.reasonPath}\
)`:"")),React.createElement("div",{className:"usage-cost-scan"},Number.isFinite(Number(e.scan.files_complete))?`Incremen\
tal local JSONL scan - ${e.scan.files_complete}/${e.scan.files_total||0} files`:"Incremental local JSONL scan has not re\
ported file progress."));let b=[...new Set(e.byProject.map(C=>C.project).filter(Boolean))].sort(),w=[...R?.byModel||[]].
sort((C,_)=>_.cost_usd-C.cost_usd).slice(0,12),h=[...R?.byDay||[]].sort((C,_)=>C.day.localeCompare(_.day)),M=Math.max(1e-6,
...h.map(C=>Number(C.cost_usd)||0));return React.createElement("section",{className:"usage-cost-panel","aria-labelledby":"\
usage-cost-heading"},React.createElement("div",{className:"usage-cost-heading"},React.createElement("span",null,React.createElement(
"h3",{id:"usage-cost-heading"},"Local estimated API-equivalent cost"),React.createElement("small",null,"Separate from su\
bscription quota \xB7 pricing ",e.catalogVersion||"unavailable")),React.createElement("span",{className:`usage-cost-stat\
us ${e.status}`},e.status)),React.createElement("div",{className:"usage-cost-controls"},React.createElement("label",null,
"Range",React.createElement("select",{value:s,onChange:C=>a(Number(C.target.value))},[1,7,30,90,365].map(C=>React.createElement(
"option",{key:C,value:C},C===1?"Today":`${C} days`)))),React.createElement("label",null,"Project",React.createElement("s\
elect",{value:o,onChange:C=>c(C.target.value)},React.createElement("option",{value:""},"All projects"),b.map(C=>React.createElement(
"option",{key:C,value:C},C))))),React.createElement("div",{className:"usage-cost-summary"},React.createElement("span",null,
React.createElement("strong",null,"$",(R?.costUsd||0).toFixed(2)),React.createElement("small",null,"estimated cost")),React.
createElement("span",null,React.createElement("strong",null,Vi(R?.tokens.input)),React.createElement("small",null,"input\
 tokens")),React.createElement("span",null,React.createElement("strong",null,Vi(R?.tokens.cached)),React.createElement("\
small",null,"cached tokens")),React.createElement("span",null,React.createElement("strong",null,Vi(R?.tokens.output)),React.
createElement("small",null,"output tokens"))),e.detail?.truncated&&React.createElement("div",{className:"usage-cost-deta\
il-state",role:"status"},f?`Showing detail rows ${Number(m.pagination?.cursor||0)+1}-${Number(m.pagination?.cursor||0)+Number(
m.pagination?.returned_rows||0)} of ${Number(m.pagination?.total_rows||0)}.`:t?.status==="error"?"Cost detail is unavail\
able.":`Loading a bounded detail page for ${e.detail.totalRows} cost-detail rows.`),React.createElement("div",{className:"\
usage-cost-chart",role:"img","aria-label":`${s}-day estimated cost by day`},(h.length?h:[{day:"No data",cost_usd:0}]).map(
C=>React.createElement("span",{key:C.day,title:`${C.day}: $${Number(C.cost_usd).toFixed(4)}`},React.createElement("i",{style:{
height:`${Math.max(3,Number(C.cost_usd)/M*100)}%`}}),React.createElement("small",null,C.day.slice(5))))),e.detail?.truncated&&
React.createElement("details",{className:"usage-cost-detail-table"},React.createElement("summary",null,"Cost detail rows"),
t?.status==="loading"&&React.createElement("div",{className:"usage-cost-detail-state"},"Loading cost detail\u2026"),t?.status===
"error"&&React.createElement("div",{className:"usage-cost-detail-state"},"Cost detail unavailable: ",t.error),f&&React.createElement(
React.Fragment,null,React.createElement("div",{className:"usage-cost-detail-pager","aria-label":"Cost detail pagination"},
React.createElement("button",{type:"button",disabled:Number(m.pagination?.cursor||0)<=0,onClick:()=>n({days:s,project:o,
cursor:String(Math.max(0,Number(m.pagination.cursor||0)-Number(m.pagination.page_size||256))),pageSize:m.pagination.page_size||
256})},"Previous"),React.createElement("span",null,m.pagination.returned_rows," rows \xB7 ",m.pagination.total_rows," to\
tal"),React.createElement("button",{type:"button",disabled:!m.pagination?.next_cursor,onClick:()=>n({days:s,project:o,cursor:m.
pagination.next_cursor,pageSize:m.pagination.page_size||256})},"Next")),React.createElement("div",{className:"usage-cost\
-table-wrap"},React.createElement("table",{className:"usage-cost-table"},React.createElement("caption",null,"Paginated l\
ocal cost detail"),React.createElement("thead",null,React.createElement("tr",null,React.createElement("th",null,"Day"),React.
createElement("th",null,"Provider / model"),React.createElement("th",null,"Project"),React.createElement("th",null,"Spee\
d"),React.createElement("th",null,"Cost"))),React.createElement("tbody",null,(m.rows||[]).map((C,_)=>React.createElement(
"tr",{key:`${m.pagination.cursor}:${_}`},React.createElement("td",null,C.day),React.createElement("th",{scope:"row"},C.provider_id,
" \xB7 ",C.model),React.createElement("td",null,C.project),React.createElement("td",null,C.speed),React.createElement("t\
d",null,"$",Number(C.cost_usd).toFixed(4))))))))),React.createElement("div",{className:"usage-cost-table-wrap"},React.createElement(
"table",{className:"usage-cost-table"},React.createElement("caption",null,"Estimated cost and tokens by provider model"),
React.createElement("thead",null,React.createElement("tr",null,React.createElement("th",null,"Provider / model"),React.createElement(
"th",null,"Input"),React.createElement("th",null,"Cached"),React.createElement("th",null,"Output"),React.createElement("\
th",null,"Cost"))),React.createElement("tbody",null,w.map(C=>React.createElement("tr",{key:`${C.provider_id}:${C.model}`},
React.createElement("th",{scope:"row"},C.provider_id==="openai-codex"?"Codex":"Claude"," \xB7 ",C.model),React.createElement(
"td",null,Vi(C.input)),React.createElement("td",null,Vi(C.cached)),React.createElement("td",null,Vi(C.output)),React.createElement(
"td",null,"$",Number(C.cost_usd).toFixed(4))))))),e.unknownModels.length>0&&React.createElement("div",{className:"usage-\
cost-fallbacks"},React.createElement("strong",null,"Fallback pricing"),e.unknownModels.map(C=>React.createElement("span",
{key:`${C.provider_id}:${C.model}`},C.model," \u2192 ",C.fallback))),React.createElement("div",{className:"usage-cost-sc\
an"},"Incremental local JSONL scan \xB7 ",e.scan.files_complete||0,"/",e.scan.files_total||0," files \xB7 ",e.records," \
deduplicated records"))}function qk({usage:e,refreshReceipt:t,resetReceipt:n,costDetail:s,onBack:a,onRefresh:o,onWatch:c,
onConsumeResetCredit:u,onRequestCostDetail:m}){let f=React.useMemo(()=>_d(e),[e]),[v,k]=React.useState(Date.now());React.
useEffect(()=>{f.collectionState==="not-started"&&o(!1);let _=setInterval(()=>k(Date.now()),3e4);return()=>clearInterval(
_)},[o,f.collectionState]),React.useEffect(()=>(c(!0),()=>c(!1)),[c]);let R=_=>({fresh:"Fresh",refreshing:"Refreshing",stale:"\
Stale",auth_required:"Sign in required",rate_limited:"Refresh limited",unavailable:"Unavailable"})[_]||"Unavailable",S=(_,L="\
Unavailable")=>({loading:"Loading",fresh:"Fresh",stale:"Stale",auth_required:"Sign in required",unavailable:L,error:"Nee\
ds attention"})[_?.status]||L,T=_=>{let L=_?.capturedAt||_?.lastGoodAt||_?.attemptedAt;return L?`${_?.status==="stale"?"\
Last good":_?.capturedAt?"Observed":"Last attempt"} ${jr(L,v).replace(/^Updated /,"").toLowerCase()}`:"Not yet observed"},
b=_=>_??"Unknown",w=_=>{let L=_?.diagnostic;if(!L)return"";let P=L.effectivePorts||[],Z=(L.attempts||[]).filter(oe=>oe.reachable).
length;return P.length===0?"No owned browser endpoint configured":`Owned browser ${P.join(", ")} \xB7 ${Z}/${P.length} r\
eachable`},h=_=>({start_owned_cloud_source:"Start owned browser",sign_in_owned_cloud_source:"Retry after sign-in",configure_owned_cloud_source:"\
Retry cloud"})[_?.nextAction]||"Retry cloud",M=f.entries.find(_=>_.providerId==="openai-codex"&&Number(_.resetCredits?.available_count)>
0&&_.windows.some(L=>L.usedPercent>=100)),C=["requested","accepted"].includes(n?.status);return React.createElement("div",
{className:"usage-dashboard","data-testid":"usage-dashboard","data-pane-id":"route-usage"},React.createElement("div",{className:"\
automations-header usage-dashboard-header"},React.createElement("button",{className:"automations-back","data-route-retur\
n":"chat",onClick:a,title:"Back to chat"},"\u2190 Back to chat"),React.createElement("div",{className:"automations-heade\
r-text"},React.createElement("h2",null,"Usage & limits"),React.createElement("p",null,"Provider-account quotas shared by\
 connected harnesses. Warnings start at 75% used.")),React.createElement("button",{type:"button",className:"usage-dashbo\
ard-refresh",onClick:()=>o(!0),disabled:f.inFlight,"aria-label":"Refresh provider usage"},f.inFlight?"Refreshing\u2026":
"Refresh")),f.collectionState!=="ready"&&React.createElement("div",{className:`usage-dashboard-collection-state ${f.collectionState}`,
role:"status"},React.createElement("strong",null,{"not-started":"Provider usage has not been collected yet",refreshing:"\
Refreshing provider usage",partial:"Some provider usage is unavailable",stale:"Showing last-good provider usage",unavailable:"\
Provider usage is unavailable"}[f.collectionState]||"Provider usage is pending"),React.createElement("span",null,"Genera\
tion ",f.generation,f.generatedAt?` \xB7 ${jr(f.generatedAt,v)}`:"")),React.createElement("div",{className:"usage-dashbo\
ard-summary","aria-label":"Usage summary"},React.createElement("div",null,React.createElement("strong",null,f.summaryAuthoritative?
f.summary.providers:"\u2014"),React.createElement("span",null,"providers")),React.createElement("div",null,React.createElement(
"strong",null,f.summaryAuthoritative?f.summary.accounts:"\u2014"),React.createElement("span",null,"accounts")),React.createElement(
"div",null,React.createElement("strong",null,f.summaryAuthoritative?f.summary.reporting:"\u2014"),React.createElement("s\
pan",null,"reporting")),React.createElement("div",{className:f.summary.nearLimit>0?"warning":""},React.createElement("st\
rong",null,f.summaryAuthoritative?f.summary.nearLimit:"\u2014"),React.createElement("span",null,"near limit")),React.createElement(
"div",{className:f.summary.exhausted>0?"critical":""},React.createElement("strong",null,f.summaryAuthoritative?f.summary.
exhausted:"\u2014"),React.createElement("span",null,"exhausted"))),t&&React.createElement("div",{className:`usage-refres\
h-receipt ${t.status}`,role:"status"},"Refresh ",t.status,t.generation!=null?` \xB7 generation ${t.generation}`:""),M&&React.
createElement("div",{className:"usage-reset-attention",role:"alert","data-testid":"codex-reset-credit-attention"},React.
createElement("span",null,React.createElement("strong",null,M.resetCredits.available_count," limit reset",M.resetCredits.
available_count===1?"":"s"," available \u2014 apply one?"),React.createElement("small",null,"Remote Agent Chat will use \
Codex's native reset action only after this approval.")),React.createElement("button",{type:"button",onClick:u,disabled:C},
C?"Applying\u2026":"Apply one reset")),n&&!["requested"].includes(n.status)&&React.createElement("div",{className:`usage\
-refresh-receipt ${n.status}`,role:"status","data-testid":"codex-reset-credit-receipt"},"Reset ",n.status,n.outcome?`: ${n.
outcome}`:"",n.error?` (${n.error})`:""),React.createElement(Pk,{cost:f.estimatedCost,detailState:s,onRequestDetail:m}),
React.createElement("div",{className:"usage-dashboard-grid"},f.entries.map(_=>{let L=yd(_.credits),P=vd(_.financials),V=_.
credits?.resets_at?Br(_.credits.resets_at,v):"",Z=t?.provider_id===_.providerId?t:null,oe=["requested","accepted","coale\
sced"].includes(Z?.status),ge=_.localRuntime?.lifecycle,W=_.cloudUsage?.lifecycle,te=h(W);return React.createElement("de\
tails",{open:!0,className:`usage-dashboard-card ${_.tone}`,key:_.key,"data-provider-id":_.providerId,"data-account-finge\
rprint":_.accountFingerprint},React.createElement("summary",{className:"usage-dashboard-card-summary"},React.createElement(
yl,{providerId:_.providerId,providerName:_.providerName}),React.createElement("span",{className:"usage-dashboard-card-ti\
tle"},React.createElement("strong",null,_.providerName),React.createElement("span",null,_.accountLabel,_.plan?` \xB7 ${_.
plan}`:"")),React.createElement("span",{className:`usage-dashboard-status ${_.status}`},R(_.status))),React.createElement(
"div",{className:"usage-dashboard-card-body"},React.createElement("div",{className:"usage-dashboard-card-meta"},React.createElement(
"span",null,_.sessionCount," mapped session",_.sessionCount===1?"":"s"),React.createElement("span",null,_.harnessTypes.length>
0?_.harnessTypes.join(", "):"No mapped surfaces"),React.createElement("span",null,_.status==="stale"?`Stale - ${jr(_.capturedAt,
v)}`:jr(_.capturedAt,v)),_.nextRefreshAt&&React.createElement("span",null,"Next refresh ",Br(_.nextRefreshAt,v)),_.refreshIntervalMs>
0&&React.createElement("span",null,_.watchBoostActive?`Live cadence ${Math.round(_.refreshIntervalMs/1e3)}s`:`Idle caden\
ce ${Math.round(_.refreshIntervalMs/1e3)}s`),React.createElement("button",{type:"button",className:"usage-card-refresh",
onClick:()=>o(!0,_.providerId),disabled:oe,"aria-label":`Refresh ${_.providerName} usage now`},oe?"Refreshing...":"Refre\
sh now")),Z&&React.createElement("div",{className:`usage-refresh-receipt ${Z.status}`,role:"status"},"Refresh ",Z.status,
Z.code?` (${Z.code})`:"",Z.retry_after_ms?` - retry in ${Math.ceil(Z.retry_after_ms/1e3)}s`:""),_.windows.length>0?React.
createElement("div",{className:"usage-dashboard-windows"},_.windows.map(X=>{let ue=X.tone,J=X.resetDescription||Br(X.resetsAt,
v);return React.createElement("div",{className:`usage-dashboard-window ${ue}`,key:X.id},React.createElement("div",{className:"\
usage-dashboard-window-heading"},React.createElement("span",null,React.createElement("strong",null,X.label),X.modelScope?.
label?React.createElement("small",null,"Model: ",X.modelScope.label):X.scope&&X.scope!==X.label?React.createElement("sma\
ll",null,X.scope):null),React.createElement("span",null,React.createElement("strong",null,X.remainingPercent==null?"Unav\
ailable":`${An(X.remainingPercent)} left`),React.createElement("small",null,X.usedPercent==null?"No reported value":`${An(
X.usedPercent)} used`))),X.usedPercent!=null&&React.createElement("div",{className:"usage-dashboard-meter",role:"progres\
sbar","aria-label":`${_.providerName} ${X.label}`,"aria-valuetext":`${An(X.usedPercent)} used`,"aria-valuemin":"0","aria\
-valuemax":"100","aria-valuenow":Math.round(X.visualPercent)},React.createElement("span",{style:{width:`${X.visualPercent}\
%`}})),React.createElement("div",{className:"usage-window-thresholds"},"Warning ",An(X.thresholds.warningPercent)," \xB7 Cr\
itical ",An(X.thresholds.criticalPercent)),X.pace&&React.createElement("div",{className:`usage-pace ${X.pace.category}`},
React.createElement("div",{className:"usage-pace-heading"},React.createElement("span",{className:"usage-pace-category"},
X.pace.category),React.createElement("span",null,"Ideal ",An(X.pace.expectedUsedPercent)," \xB7 projected ",An(X.pace.projectedUsedPercent))),
React.createElement("div",{className:"usage-pace-chart",role:"img","aria-label":`${X.label} actual ${An(X.usedPercent)},\
 ideal ${An(X.pace.expectedUsedPercent)}, projected ${An(X.pace.projectedUsedPercent)}`},React.createElement("span",{className:"\
usage-pace-actual",style:{width:`${X.visualPercent}%`}}),React.createElement("i",{className:"usage-pace-ideal",style:{left:`${Math.
min(100,X.pace.expectedUsedPercent)}%`}}),React.createElement("i",{className:"usage-pace-projected",style:{left:`${Math.
min(100,X.pace.projectedUsedPercent)}%`}})),React.createElement("div",{className:"usage-pace-budgets"},Object.entries({Now:"\
now","+1 hour":"next_hour","+5 hours":"next_five_hours",Today:"today"}).map(([pe,Ce])=>React.createElement("span",{key:Ce},
React.createElement("small",null,pe),React.createElement("strong",null,An(X.pace.budgets?.[Ce]||0))))),React.createElement(
"div",{className:"usage-pace-outcome"},X.usedPercent>=100?"Quota is exhausted":X.pace.willLastToReset?"Current pace last\
s to reset":`Projected exhaustion ${Br(X.pace.exhaustionAt,v)}`)),J&&React.createElement("div",{className:"usage-dashboa\
rd-reset"},"Resets ",J),React.createElement("div",{className:"usage-window-provenance"},X.source||_.source,X.provenance?
` \xB7 ${X.provenance}`:""))})):!_.localRuntime&&!_.cloudUsage?React.createElement("div",{className:"usage-dashboard-una\
vailable"},_.error?.message||"This provider did not report quota windows."):null,_.localRuntime&&React.createElement("di\
v",{className:`usage-dashboard-credit-row usage-dashboard-source-state ${ge?.status||"unavailable"}`,"data-testid":"olla\
ma-local-runtime","data-source-status":ge?.status||"unavailable"},React.createElement("span",null,React.createElement("s\
trong",null,"Local runtime"),b(_.localRuntime.loadedModelsCount)," loaded / ",b(_.localRuntime.installedModelsCount)," i\
nstalled",React.createElement("small",null,S(ge)," \xB7 ",T(ge),ge?.reason?.message?` \xB7 ${ge.reason.message}`:"")),React.
createElement("span",null,React.createElement("strong",null,"Request telemetry"),_.localRuntime.telemetryStatus.replace(
/_/g," "),React.createElement("small",null,_.localRuntime.telemetryReason)),React.createElement("button",{type:"button",
className:"usage-card-refresh",onClick:()=>o(!0,_.providerId),disabled:oe,"aria-label":"Refresh Ollama local runtime"},oe?
"Refreshing...":"Refresh local")),_.cloudUsage&&_.providerId==="ollama-local"&&(_.cloudUsage.subscriptionState==="active"?
React.createElement("div",{className:`usage-dashboard-credit-row usage-dashboard-source-state ${W?.status||"fresh"}`,"da\
ta-testid":"ollama-cloud-usage","data-source-status":W?.status||"fresh"},React.createElement("span",null,React.createElement(
"strong",null,"Ollama Cloud"),_.windows.length," quota window",_.windows.length===1?"":"s",React.createElement("small",null,
S(W)," \xB7 ",T(W))),React.createElement("span",null,React.createElement("strong",null,"Auto-reload"),_.cloudUsage.autoReloadEnabled==
null?"Not reported":_.cloudUsage.autoReloadEnabled?"On":"Off",React.createElement("small",null,"Extra usage balance is s\
eparate from plan quota")),React.createElement("button",{type:"button",className:"usage-card-refresh",onClick:()=>o(!0,_.
providerId),disabled:oe,"aria-label":"Refresh Ollama Cloud usage"},oe?"Refreshing...":"Refresh cloud")):_.cloudUsage.subscriptionState===
"none"?React.createElement("div",{className:"usage-dashboard-credit-row usage-dashboard-source-state fresh","data-testid":"\
ollama-cloud-no-subscription","data-source-status":"fresh"},React.createElement("span",null,React.createElement("strong",
null,"Ollama Cloud"),"No cloud subscription",React.createElement("small",null,"Fresh \xB7 local models remain available")),
React.createElement("button",{type:"button",className:"usage-card-refresh",onClick:()=>o(!0,_.providerId),disabled:oe,"a\
ria-label":"Refresh Ollama Cloud subscription"},oe?"Refreshing...":"Refresh cloud")):React.createElement("div",{className:`\
usage-dashboard-credit-row usage-dashboard-source-state ${W?.status||"unavailable"}`,"data-testid":"ollama-cloud-unavail\
able","data-source-status":W?.status||"unavailable"},React.createElement("span",null,React.createElement("strong",null,"\
Ollama Cloud"),S(W,"Not connected"),React.createElement("small",null,_.cloudUsage.error?.message||W?.reason?.message||"O\
llama Cloud monitoring is not connected.",w(W)?` \xB7 ${w(W)}`:"",` \xB7 ${T(W)}`)),React.createElement("button",{type:"\
button",className:"usage-card-refresh",onClick:()=>o(!0,_.providerId),disabled:oe,"aria-label":`${te} for Ollama Cloud`},
oe?te==="Start owned browser"?"Starting...":"Refreshing...":te),_.dashboardUrl&&React.createElement("a",{href:_.dashboardUrl,
target:"_blank",rel:"noreferrer"},"Open Ollama Cloud"))),_.localRuntime?.latestRequest&&React.createElement("div",{className:"\
usage-dashboard-credit-row","data-testid":"ollama-owned-request-metrics"},React.createElement("span",null,React.createElement(
"strong",null,"Latest owned request"),_.localRuntime.latestRequest.model,React.createElement("small",null,_.localRuntime.
latestRequest.surface.replace(/_/g," ")," - ",jr(_.localRuntime.latestRequest.capturedAt,v))),React.createElement("span",
null,React.createElement("strong",null,"Tokens"),_.localRuntime.latestRequest.promptTokens," prompt - ",_.localRuntime.latestRequest.
responseTokens," output",React.createElement("small",null,Pf(_.localRuntime.latestRequest.tokensPerSecond))),React.createElement(
"span",null,React.createElement("strong",null,"Total / load"),zo(_.localRuntime.latestRequest.totalDurationNs)," / ",zo(
_.localRuntime.latestRequest.loadDurationNs),React.createElement("small",null,"terminal response metrics")),React.createElement(
"span",null,React.createElement("strong",null,"Prompt / eval"),zo(_.localRuntime.latestRequest.promptEvalDurationNs)," /\
 ",zo(_.localRuntime.latestRequest.evalDurationNs),React.createElement("small",null,_.localRuntime.observedRequestCount,
" owned receipt",_.localRuntime.observedRequestCount===1?"":"s"))),P.length>0&&React.createElement("div",{className:"usa\
ge-dashboard-credit-row usage-dashboard-financial-row"},P.map(X=>React.createElement("span",{key:X.id},React.createElement(
"strong",null,X.label),X.value))),(L||_.resetCredits)&&React.createElement("div",{className:"usage-dashboard-credit-row"},
L&&React.createElement("span",null,React.createElement("strong",null,"Credits"),L,V&&React.createElement("small",null,"R\
esets ",V)),_.resetCredits&&React.createElement("span",null,React.createElement("strong",null,"Rate-limit resets"),_.resetCredits.
available_count||0," available")),Array.isArray(_.resetCredits?.details)&&_.resetCredits.details.length>0&&React.createElement(
"div",{className:"usage-dashboard-reset-credits"},_.resetCredits.details.map((X,ue)=>React.createElement("span",{key:`${X.
title||"reset"}-${ue}`},React.createElement("strong",null,X.title||`Reset credit ${ue+1}`),X.status&&React.createElement(
"small",null,X.status),X.expires_at&&React.createElement("small",null,"Expires ",Br(X.expires_at,v))))),_.error?.message&&
_.windows.length>0&&React.createElement("div",{className:"usage-dashboard-stale-error"},"Last refresh: ",_.error.message),
React.createElement("div",{className:"usage-dashboard-source-row"},React.createElement("span",null,"Source: ",_.source?_.
source.replace(/_/g," "):"not available",_.latencyMs!=null?` \xB7 ${_.latencyMs} ms`:""),_.dashboardUrl&&React.createElement(
"a",{href:_.dashboardUrl,target:"_blank",rel:"noreferrer"},"Open provider dashboard"))))}),f.entries.length===0&&React.createElement(
"div",{className:"usage-dashboard-empty"},React.createElement("strong",null,f.collectionState==="ready"?"The completed s\
can found no provider usage.":"Provider usage is not available yet."),React.createElement("span",null,f.collectionState===
"ready"?"Connect a supported Codex, Claude Code, Antigravity, or Cursor session, or start local Ollama, then refresh.":"\
Quota totals remain unknown until a provider collection completes."))))}var Ml=640,Yd=220,Xt=Object.freeze({left:54,right:14,
top:12,bottom:32});function ar(e){let t=Math.max(.04,Math.min(1,Number(e?.end)-Number(e?.start)||1)),n=Math.max(0,Math.min(
1-t,Number(e?.start)||0));return{start:n,end:n+t}}function Dk(e,t,n,s){let a="",o=!1;return e.forEach(c=>{let u=c[t];if(c.
gap||u==null||!Number.isFinite(u)){o=!1;return}a+=`${o?"L":"M"}${n(c).toFixed(2)},${s(u).toFixed(2)} `,o=!0}),a.trim()}function Rl({
title:e,description:t,frames:n,series:s,percentScale:a=!1,viewport:o,onViewportChange:c,crosshairSequence:u,onCrosshairChange:m,
range:f="live",nowMs:v=Date.now(),paused:k=!1,subscriptionStatus:R="live"}){let S=React.useRef(null),T=React.useRef(new Map),
b=React.useRef(null),w=React.useRef(0),[h,M]=React.useState({}),[C,_]=React.useState({mode:"auto",fixedMax:null}),L=Ml-Xt.
left-Xt.right,P=Yd-Xt.top-Xt.bottom,V=Fi(n,{nowMs:v,paused:k,connected:R!=="reconnecting",subscriptionStatus:R}),Z=V.frames,
oe=ar(o),ge=Bi[f]??Bi.live,W=k&&V.endMs||v,te=ge===1/0?V.startMs||W-Bi.live:W-ge,X=Math.max(1,W-te),ue=te+X*oe.start,J=te+
X*oe.end,pe=Z.filter(F=>Number(F.chart_time_ms)>=ue&&Number(F.chart_time_ms)<=J),Ce=s.map(F=>{let re=F.frames?Fi(F.frames,
{nowMs:v,paused:!0}).frames:pe,Te=F.frames?re.filter(Ke=>Number(Ke.chart_time_ms)>=ue&&Number(Ke.chart_time_ms)<=J):re;return{
...F,visibleFrames:Te,samples:Tf(Te,F.metric,180)}}),se=Ce.filter(F=>!h[F.key]),Q=Math.max(0,...se.flatMap(F=>F.samples.
map(re=>re.max||0))),de=pd(Q,w.current,{percent:a});!a&&C.mode==="auto"&&(w.current=de.maximum);let he=C.mode==="fixed"&&
C.fixedMax?pd(C.fixedMax,C.fixedMax,{percent:a}):de,xe=he.maximum,be=F=>Xt.left+md(F,ue,J)*L,ee=F=>Xt.top+P-Math.max(0,Math.
min(xe,F))/Math.max(1,xe)*P,H=pe.find(F=>F.sample_sequence===u)||pe.at(-1)||null,E=H?Xt.left+md(H,ue,J)*L:null,z=s[0]?.format||
(F=>String(F)),fe=Ef(ue,J,typeof window<"u"&&window.innerWidth<=600?4:5),ie=V.status[0]?.toUpperCase()+V.status.slice(1);
function ye(F){let re=S.current?.getBoundingClientRect();return re?.width?Math.max(0,Math.min(1,(F.clientX-re.left)/re.width)):
.5}function Me(F){if(!pe.length)return 0;let re=ue+(J-ue)*F;return pe.reduce((Te,Ke)=>Math.abs(Number(Ke.chart_time_ms)-
re)<Math.abs(Number(Te.chart_time_ms)-re)?Ke:Te,pe[0]).sample_sequence}function ke(F,re=.5){let Te=ar(o),Ke=Math.max(.04,
Math.min(1,(Te.end-Te.start)*F)),St=Te.start+(Te.end-Te.start)*re;c(ar({start:St-Ke*re,end:St+Ke*(1-re)}))}React.useEffect(
()=>{let F=S.current;if(!F)return;let re=Te=>{Te.preventDefault(),ke(Te.deltaY>0?1.2:.8,ye(Te))};return F.addEventListener(
"wheel",re,{passive:!1}),()=>F.removeEventListener("wheel",re)});function Ee(F){try{F.currentTarget.setPointerCapture?.(
F.pointerId)}catch{}if(T.current.set(F.pointerId,{x:F.clientX,y:F.clientY}),m(Me(ye(F))),T.current.size===1)b.current={mode:"\
pan",pointerId:F.pointerId,startX:F.clientX,viewport:ar(o)};else if(T.current.size===2){let re=[...T.current.values()];b.
current={mode:"pinch",distance:Math.max(1,Math.abs(re[1].x-re[0].x)),center:(ye({clientX:re[0].x})+ye({clientX:re[1].x}))/
2,viewport:ar(o)}}}function He(F){if(!T.current.has(F.pointerId)){m(Me(ye(F)));return}T.current.set(F.pointerId,{x:F.clientX,
y:F.clientY});let re=b.current;if(re?.mode==="pinch"&&T.current.size>=2){let Te=[...T.current.values()],Ke=Math.max(1,Math.
abs(Te[1].x-Te[0].x)),St=re.viewport.end-re.viewport.start,vs=Math.max(.04,Math.min(1,St*re.distance/Ke)),on=re.viewport.
start+St*re.center;c(ar({start:on-vs*re.center,end:on+vs*(1-re.center)}));return}if(re?.mode==="pan"&&re.pointerId===F.pointerId){
let Te=S.current?.getBoundingClientRect(),Ke=re.viewport.end-re.viewport.start,St=Te?.width?-(F.clientX-re.startX)/Te.width*
Ke:0;c(ar({start:re.viewport.start+St,end:re.viewport.end+St}))}}function ae(F){T.current.delete(F.pointerId);try{F.currentTarget.
releasePointerCapture?.(F.pointerId)}catch{}T.current.size===0&&(b.current=null)}function Re(F){if(!pe.length)return;let re=Math.
max(0,pe.findIndex(Te=>Te.sample_sequence===u));if(F.key==="ArrowLeft"||F.key==="ArrowRight")if(F.preventDefault(),F.shiftKey){
let Ke=(oe.end-oe.start)*(F.key==="ArrowLeft"?-.1:.1);c(ar({start:oe.start+Ke,end:oe.end+Ke}))}else{let Te=Math.max(0,Math.
min(pe.length-1,re+(F.key==="ArrowLeft"?-1:1)));m(pe[Te].sample_sequence)}else F.key==="Home"||F.key==="End"?(F.preventDefault(),
m((F.key==="Home"?pe[0]:pe.at(-1)).sample_sequence)):F.key==="+"||F.key==="="?(F.preventDefault(),ke(.75)):F.key==="-"&&
(F.preventDefault(),ke(1.25))}return React.createElement("section",{className:"host-resource-chart","aria-label":`${e} c\
hart`},React.createElement("div",{className:"host-resource-chart-heading"},React.createElement("span",null,React.createElement(
"strong",null,e),React.createElement("small",null,t)),!a&&React.createElement("button",{type:"button",onClick:()=>_(F=>F.
mode==="auto"?{mode:"fixed",fixedMax:de.maximum}:{mode:"auto",fixedMax:null})},C.mode==="auto"?"Auto scale":`Fixed ${z(C.
fixedMax)}`)),React.createElement("div",{className:`host-resource-chart-quality ${V.status}`,role:"status"},React.createElement(
"strong",null,ie),React.createElement("span",null,V.receivedCount," received / ",V.validCount," valid / ",V.expectedCount,
" expected / ",V.droppedCount," dropped"),React.createElement("span",null,Math.round(V.cadenceMs)," ms cadence"),React.createElement(
"span",null,V.gapCount," gap",V.gapCount===1?"":"s"),React.createElement("span",null,V.duplicateCount," duplicate / ",V.
outOfOrderCount," out of order")),React.createElement("div",{className:"host-resource-chart-legend","aria-label":`${e} s\
eries`},Ce.map((F,re)=>React.createElement("button",{type:"button",key:F.key,"aria-pressed":!h[F.key],onClick:()=>M(Te=>({
...Te,[F.key]:!Te[F.key]}))},React.createElement("i",{className:`marker marker-${re%3}`,style:{"--series-color":F.color}}),
F.label))),React.createElement("div",{className:"host-resource-chart-canvas",ref:S,role:"group",tabIndex:"0","aria-label":`${e}\
. Drag to pan, wheel or pinch to zoom, arrow keys move the synchronized crosshair, shift plus arrows pan, plus and minus\
 zoom.`,onPointerDown:Ee,onPointerMove:He,onPointerUp:ae,onPointerCancel:ae,onKeyDown:Re},React.createElement("svg",{viewBox:`\
0 0 ${Ml} ${Yd}`,"aria-hidden":"true"},V.gaps.filter(F=>F.endMs>=ue&&F.startMs<=J).map((F,re)=>{let Te=Xt.left+Math.max(
0,(F.startMs-ue)/Math.max(1,J-ue))*L,Ke=Xt.left+Math.min(1,(F.endMs-ue)/Math.max(1,J-ue))*L;return React.createElement("\
rect",{key:`${F.reason}-${re}`,className:"host-resource-chart-gap",x:Te,y:Xt.top,width:Math.max(2,Ke-Te),height:P})}),[...he.
ticks].reverse().map(F=>{let re=ee(F);return React.createElement(React.Fragment,{key:F},React.createElement("line",{className:"\
host-resource-chart-grid",x1:Xt.left,x2:Ml-Xt.right,y1:re,y2:re}),React.createElement("text",{className:"host-resource-c\
hart-y-label",textAnchor:"end",x:Xt.left-7,y:re+4},z(F)))}),fe.map((F,re)=>{let Te=Xt.left+F.fraction*L;return React.createElement(
"text",{key:F.timeMs,className:"host-resource-chart-x-label","aria-label":F.accessibleLabel,textAnchor:re===0?"start":re===
fe.length-1?"end":"middle",x:Te,y:Yd-7},F.label)}),se.flatMap(F=>F.samples.map(re=>re.gap||re.min==null||re.max==null?null:
React.createElement("line",{key:`${F.key}-${re.endSequence}`,className:"host-resource-chart-range",stroke:F.color,x1:be(
re),x2:be(re),y1:ee(re.min),y2:ee(re.max)}))),se.map((F,re)=>React.createElement("path",{key:F.key,className:`host-resou\
rce-chart-line series-${re%3}`,stroke:F.color,strokeDasharray:F.dashed||re%3===1?"7 4":re%3===2?"2 4":void 0,d:Dk(F.samples,
"average",be,ee)})),se.flatMap((F,re)=>F.visibleFrames.length<10?F.visibleFrames.map(Te=>{let Ke=Qa(Te,F.metric);return Ke==
null?null:React.createElement("circle",{key:`${F.key}-point-${Te.sample_sequence}`,className:`host-resource-chart-point \
marker-${re%3}`,cx:be(Te),cy:ee(Ke),r:"3",stroke:F.color})}):[]),E!=null&&React.createElement("line",{className:"host-re\
source-chart-crosshair",x1:E,x2:E,y1:Xt.top,y2:Xt.top+P})),H&&React.createElement("div",{className:`host-resource-chart-\
tooltip ${E>Ml/2?"flip":""}`,role:"status"},React.createElement("strong",null,gd(H.chart_time_ms)," / seq ",H.sample_sequence),
React.createElement("span",null,Math.max(0,Math.round((v-Number(H.chart_time_ms))/1e3)),"s old / ",H.sample_interval_ms||
V.cadenceMs," ms / ",ie," / source ",H.status||"unknown"),Ce.map(F=>React.createElement("span",{key:F.key},React.createElement(
"i",{style:{background:F.color}}),F.label,": ",F.format(Qa(F.visibleFrames.find(re=>re.sample_sequence===H.sample_sequence),
F.metric)))))),React.createElement("div",{className:"host-resource-chart-stats"},Ce.filter(F=>!h[F.key]).map(F=>{let re=dd(
F.visibleFrames,F.metric),Te=F.visibleFrames.find(Ke=>Ke.sample_sequence===re.peakSequence);return React.createElement("\
span",{key:F.key},React.createElement("strong",null,F.label),React.createElement("span",null,"Latest-good ",F.format(re.
current)),React.createElement("span",null,"Min ",F.format(re.min)),React.createElement("span",null,"Avg ",F.format(re.average),
" (",re.averageMethod,")"),React.createElement("span",null,"Max ",F.format(re.max)),React.createElement("span",null,re.p95Ready?
`p95 ${F.format(re.p95)}`:`p95 collecting (${re.count}/20)`),React.createElement("small",null,re.count," raw / ",Math.round(
re.elapsedMs/1e3),"s / ",re.cadenceMs||V.cadenceMs," ms cadence / ",Math.max(re.gapCount,V.gapCount)," gaps / ",ie," / p\
eak ",hd(Te?.captured_at)))})),React.createElement("details",{className:"host-resource-chart-data"},React.createElement(
"summary",null,"Accessible data table"),React.createElement("div",null,React.createElement("table",null,React.createElement(
"caption",null,"Latest ",Math.min(120,pe.length)," of ",pe.length," visible samples"),React.createElement("thead",null,React.
createElement("tr",null,React.createElement("th",null,"Time / sequence"),Ce.map(F=>React.createElement("th",{key:F.key},
F.label)))),React.createElement("tbody",null,pe.slice(-120).map(F=>React.createElement("tr",{key:`${F.sample_sequence}:${F.
chart_time_ms}`},React.createElement("th",null,gd(F.chart_time_ms)," / ",F.sample_sequence,F.gap_before?` / gap: ${F.gap_reason}`:
""),Ce.map(re=>React.createElement("td",{key:re.key},re.format(Qa(re.visibleFrames.find(Te=>Te.sample_sequence===F.sample_sequence),
re.metric)))))))))))}function jk(e,t,n,s,a){let o=t.trim().toLowerCase(),c=S=>(!o||[S.name,S.agentLabel,S.workspaceLabel,
S.pid,S.attributionReason].some(T=>String(T||"").toLowerCase().includes(o)))&&(n==="all"||S.attributionLevel===n),u=e.filter(
c),m=new Set(u.map(S=>S.stableKey)),f=(S,T)=>s==="name"?(S.agentLabel||S.name).localeCompare(T.agentLabel||T.name)||S.pid-
T.pid:s==="memory"?T.memoryBytes-S.memoryBytes||S.pid-T.pid:s==="read"?T.ioReadBps-S.ioReadBps||S.pid-T.pid:s==="write"?
T.ioWriteBps-S.ioWriteBps||S.pid-T.pid:T.cpuHostPercent-S.cpuHostPercent||S.pid-T.pid,v=new Map;u.forEach(S=>{let T=m.has(
S.parentKey)?S.parentKey:"";v.set(T,[...v.get(T)||[],S])});let k=[];function R(S,T){(v.get(S)||[]).sort(f).forEach(b=>{k.
push({process:b,depth:T}),a[b.stableKey]!==!1&&R(b.stableKey,T+1)})}return R("",0),k}function kg(e,t,n=44,s=16){let a=(Array.
isArray(e)?e:[]).map(o=>Qa(o,t)).filter(o=>o!==null);return a.length<2?"":a.map((o,c)=>{let u=c/(a.length-1)*n,m=s-Math.
max(0,Math.min(100,o))/100*s;return`${c?"L":"M"}${u.toFixed(2)},${m.toFixed(2)}`}).join(" ")}function Bk({connected:e,error:t,
history:n,subscription:s,onOpen:a,onRefresh:o,onSubscribe:c,onUnsubscribe:u}){let m="(min-width: 900px)",[f,v]=React.useState(
()=>typeof window<"u"&&typeof window.matchMedia=="function"?window.matchMedia(m).matches:!1),[k,R]=React.useState(Date.now());
React.useEffect(()=>{if(typeof window>"u"||typeof window.matchMedia!="function")return;let _=window.matchMedia(m),L=()=>v(
_.matches);return L(),typeof _.addEventListener=="function"?_.addEventListener("change",L):_.addListener?.(L),()=>{typeof _.
removeEventListener=="function"?_.removeEventListener("change",L):_.removeListener?.(L)}},[]),React.useEffect(()=>{if(f)
return c(!0,"global-strip"),()=>u("global-strip")},[f,c,u]),React.useEffect(()=>{if(!f)return;let _=()=>R(Date.now()),L=setInterval(
_,1e3),P=()=>{document.visibilityState==="visible"&&(_(),o(!1))};return document.addEventListener("visibilitychange",P),
()=>{clearInterval(L),document.removeEventListener("visibilitychange",P)}},[f,o]);let S=React.useMemo(()=>Rf(n,{connected:e,
error:!!t,nowMs:k,subscriptionStatus:s?.status}),[e,t,n,k,s?.status]);if(!f)return null;let T=_=>(_==null?"\u2014":String(
Math.round(_))).padStart(3,"\u2007"),b=_=>_==="critical"?"!!":_==="warning"?"!":"",w=S.status==="stale"?`stale ${S.ageSeconds}\
s`:S.status,h=S.memoryUsedBytes!==null&&S.memoryTotalBytes!==null?`${Bs(S.memoryUsedBytes)} of ${Bs(S.memoryTotalBytes)}`:
"memory totals unavailable",M=S.point?`Host CPU ${S.cpuPercent?.toFixed(1)??"unknown"}%; memory ${S.memoryPercent?.toFixed(
1)??"unknown"}% (${h}); ${w}; sample ${S.sampleSequence}`:`Host resources ${w}`,C=S.point?`Open Host resources. CPU ${S.
cpuPercent?.toFixed(1)??"unknown"} percent, ${S.cpuLevel}. RAM ${S.memoryPercent?.toFixed(1)??"unknown"} percent, ${S.memoryLevel}\
. ${w}. Sample ${S.sampleSequence}.`:`Open Host resources. CPU and RAM waiting. ${w}.`;return React.createElement("div",
{className:"global-desktop-status-rail","data-testid":"global-desktop-status-rail"},React.createElement("button",{type:"\
button",className:`global-host-resource-strip ${S.attention}`,"data-testid":"global-host-resource-strip","data-status":S.
status,"data-cpu-level":S.cpuLevel,"data-memory-level":S.memoryLevel,"data-sample-sequence":S.sampleSequence||"","data-s\
ample-captured-at":S.capturedAt||"","data-cpu-percent":S.cpuPercent??"","data-memory-percent":S.memoryPercent??"","data-\
history-count":S.frames.length,"aria-label":C,title:M,onClick:a},React.createElement("span",{className:`global-host-reso\
urce-metric ${S.cpuLevel}`},React.createElement("span",{className:"label"},"CPU","\xA0"),React.createElement("span",{className:"\
value"},T(S.cpuPercent)),React.createElement("span",{className:"unit"},"%"),React.createElement("span",{className:"atten\
tion-mark"},b(S.cpuLevel))),React.createElement("span",{className:"global-host-resource-divider","aria-hidden":"true"},"\
\xB7"),React.createElement("span",{className:`global-host-resource-metric ${S.memoryLevel}`},React.createElement("span",
{className:"label"},"RAM","\xA0"),React.createElement("span",{className:"value"},T(S.memoryPercent)),React.createElement(
"span",{className:"unit"},"%"),React.createElement("span",{className:"attention-mark"},b(S.memoryLevel))),React.createElement(
"svg",{className:"global-host-resource-sparkline",viewBox:"0 0 44 16","aria-hidden":"true"},React.createElement("path",{
className:"cpu",d:kg(S.frames,"cpu_total_percent")}),React.createElement("path",{className:"memory",d:kg(S.frames,"memor\
y_used_percent")})),React.createElement("span",{className:"global-host-resource-state"},w)))}function Fk({snapshot:e,error:t,
history:n,details:s,subscription:a,onBack:o,onRefresh:c,onSubscribe:u,onUnsubscribe:m}){let f=React.useMemo(()=>Mf(e),[e]),
[v,k]=React.useState(Date.now()),[R,S]=React.useState("live"),[T,b]=React.useState(null),[w,h]=React.useState(null),[M,C]=React.
useState({start:0,end:1}),[_,L]=React.useState(0),[P,V]=React.useState(!1),[Z,oe]=React.useState(""),[ge,W]=React.useState(
"all"),[te,X]=React.useState("cpu"),[ue,J]=React.useState({}),[pe,Ce]=React.useState("");React.useEffect(()=>(u(P,"dashb\
oard"),()=>m("dashboard")),[P,u,m]),React.useEffect(()=>{let ae=setInterval(()=>k(Date.now()),1e3);return()=>clearInterval(
ae)},[]);let se=React.useMemo(()=>T==null?n:n.filter(ae=>ae.sample_sequence<=T),[n,T]),Q=T==null?v:w||v,de=React.useMemo(
()=>$f(se,R,{nowMs:Q,paused:T!=null,subscriptionStatus:a?.status,connected:a?.status!=="reconnecting",error:!!t}),[se,R,
Q,T,a?.status,t]),he=React.useMemo(()=>Fi(se,{nowMs:Q,paused:T!=null,subscriptionStatus:a?.status,connected:a?.status!==
"reconnecting",error:!!t}),[se,Q,T,a?.status,t]),xe=React.useRef("");React.useEffect(()=>{if(!["delayed","stale"].includes(
he.status)||T!=null){xe.current="";return}let ae=`${he.status}:${he.points.at(-1)?.sampleSequence||0}`;xe.current!==ae&&
(xe.current=ae,c(!1))},[he.status,he.points,T,c]),React.useEffect(()=>{!_&&de.length&&L(de.at(-1).sample_sequence)},[_,de]);
let be=f.system,ee=be?be.disk.readBps+be.disk.writeBps:0,H=be?be.network.receiveBps+be.network.sendBps:0,E=React.useMemo(
()=>jk(f.processes,Z,ge,te,ue),[f.processes,Z,ge,te,ue]),z=f.processes.find(ae=>ae.stableKey===pe)||null,fe=f.lastGoodCapturedAt?
fd(f.lastGoodCapturedAt,v).replace(/^Updated\s+/i,""):"not yet available",ie=React.useMemo(()=>pe?s.flatMap(ae=>{let Re=(ae.
processes||[]).find(F=>F.stable_key===pe);return Re?[{frame_kind:"system",sample_sequence:ae.sample_sequence,captured_at:ae.
captured_at,sample_interval_ms:ae.sample_interval_ms,dropped_gap_count:ae.dropped_gap_count,status:ae.status,cpu:{total_percent:Re.
cpu_host_percent},disk:{read_bps:Re.io_read_bps,write_bps:Re.io_write_bps}}]:[]}):[],[s,pe]),ye=ae=>ae==null?"\u2014":Lf(
ae),Me=ae=>ae==null?"\u2014":Fs(ae),ke={live:"Live",delayed:"Delayed",reconnecting:"Reconnecting",paused:"Paused",stale:"\
Stale",waiting:"Waiting",unavailable:"Unavailable"}[he.status]||"Unavailable",Ee=[{key:"cpu-total",metric:"cpu_total_per\
cent",label:"Total",color:"#58a6ff",format:ye},{key:"cpu-user",metric:"cpu_user_percent",label:"User",color:"#3fb950",format:ye},
{key:"cpu-kernel",metric:"cpu_privileged_percent",label:"Kernel",color:"#d29922",format:ye},...ie.length?[{key:"process-\
cpu",metric:"cpu_total_percent",label:`${z?.agentLabel||z?.name||"Process"} overlay`,color:"#f778ba",format:ye,frames:ie,
dashed:!0}]:[]],He=[{key:"disk-read",metric:"disk_read_bps",label:"Read",color:"#58a6ff",format:Me},{key:"disk-write",metric:"\
disk_write_bps",label:"Write",color:"#f0883e",format:Me},...ie.length?[{key:"process-read",metric:"disk_read_bps",label:"\
Process read overlay",color:"#bc8cff",format:Me,frames:ie,dashed:!0},{key:"process-write",metric:"disk_write_bps",label:"\
Process write overlay",color:"#f778ba",format:Me,frames:ie,dashed:!0}]:[]];return React.createElement("div",{className:"\
host-resource-dashboard","data-testid":"host-resource-dashboard","data-pane-id":"route-host-resources"},React.createElement(
"div",{className:"automations-header host-resource-header"},React.createElement("button",{className:"automations-back","\
data-route-return":"chat",onClick:o,title:"Back to chat"},"\u2190 Back to chat"),React.createElement("div",{className:"a\
utomations-header-text"},React.createElement("h2",null,"Host resources"),React.createElement("p",null,"Live, ephemeral W\
indows metrics. Process commands and executable paths never leave the proxy.")),React.createElement("button",{type:"butt\
on",className:"usage-dashboard-refresh",onClick:()=>c(!0),"aria-label":"Capture host resource detail now"},"Capture deta\
il")),React.createElement("div",{className:"host-resource-meta"},React.createElement("span",{className:`host-resource-st\
atus ${he.status}`},ke),React.createElement("span",null,P?"Aggregate-only":f.machineLabel||"Windows host"),React.createElement(
"span",null,fd(f.capturedAt,v)),React.createElement("span",null,he.receivedCount," received / ",he.validCount," valid / ",
he.expectedCount," expected / ",he.droppedCount," dropped / ",he.gapCount," gaps / ",he.duplicateCount," dup / ",he.outOfOrderCount,
" out-of-order"),React.createElement("span",null,Math.round(he.cadenceMs)," ms cadence / seq ",f.sampleSequence||"\u2014")),
React.createElement("div",{className:"host-resource-controls","aria-label":"Host resource timeline controls"},React.createElement(
"div",{className:"host-resource-range",role:"group","aria-label":"Time range"},[["live","Live"],["1m","1m"],["5m","5m"],
["15m","15m"],["since_open","Since open"]].map(([ae,Re])=>React.createElement("button",{key:ae,type:"button",className:R===
ae?"active":"","aria-pressed":R===ae,onClick:()=>{S(ae),C({start:0,end:1})}},Re))),React.createElement("button",{type:"b\
utton",onClick:()=>{T==null?(h(Date.now()),b(n.at(-1)?.sample_sequence||0)):(b(null),h(null))}},T==null?"Pause":"Resume"),
React.createElement("button",{type:"button",disabled:M.start===0&&M.end===1,onClick:()=>C({start:0,end:1})},"Reset zoom"),
React.createElement("label",null,React.createElement("input",{type:"checkbox",checked:P,onChange:ae=>{V(ae.target.checked),
Ce("")}})," Aggregate-only privacy"),React.createElement("span",null,de.length," raw samples / ",Math.round(he.elapsedMs/
1e3),"s actual",T==null?"":` / paused at ${T}`)),(t||f.error)&&React.createElement("div",{className:"host-resource-error",
role:"status"},t?.message||f.error?.message,f.error&&` Last full detail: ${fe}.`),be?React.createElement(React.Fragment,
null,React.createElement("div",{className:"host-resource-summary","aria-label":"Host resource summary"},React.createElement(
"div",null,React.createElement("strong",null,Math.round(be.cpuPercent),"%"),React.createElement("span",null,"CPU"),React.
createElement("small",null,be.cpu.logicalCoreCount||"\u2014"," logical / ",be.cpu.physicalCoreCount||"\u2014"," physical\
 cores")),React.createElement("div",null,React.createElement("strong",null,Math.round(be.memory.usedPercent),"%"),React.
createElement("span",null,"memory"),React.createElement("small",null,Bs(be.memory.usedBytes)," / ",Bs(be.memory.totalBytes),
"; commit ",Math.round(be.memory.commitPercent),"%")),React.createElement("div",null,React.createElement("strong",null,Fs(
ee)),React.createElement("span",null,"disk I/O"),React.createElement("small",null,"Read ",Fs(be.disk.readBps)," / write ",
Fs(be.disk.writeBps)," / ",Math.round(be.disk.busyPercent),"% busy")),React.createElement("div",null,React.createElement(
"strong",null,Fs(H)),React.createElement("span",null,"network I/O"),React.createElement("small",null,"Receive ",Fs(be.network.
receiveBps)," / send ",Fs(be.network.sendBps)))),React.createElement("div",{className:"host-resource-charts"},React.createElement(
Rl,{title:"CPU",description:"Total outline; User and Kernel component overlays (%)",frames:de,series:Ee,percentScale:!0,
viewport:M,onViewportChange:C,crosshairSequence:_,onCrosshairChange:L,range:R,nowMs:Q,paused:T!=null,subscriptionStatus:a?.
status}),React.createElement(Rl,{title:"Memory",description:"Physical used and committed (%)",frames:de,series:[{key:"me\
mory-used",metric:"memory_used_percent",label:"Physical used",color:"#bc8cff",format:ye},{key:"memory-commit",metric:"me\
mory_commit_percent",label:"Committed",color:"#f778ba",format:ye}],percentScale:!0,viewport:M,onViewportChange:C,crosshairSequence:_,
onCrosshairChange:L,range:R,nowMs:Q,paused:T!=null,subscriptionStatus:a?.status}),React.createElement(Rl,{title:"Disk",description:"\
Aggregate throughput (IEC bytes/s); isolate unequal series in the legend",frames:de,series:He,viewport:M,onViewportChange:C,
crosshairSequence:_,onCrosshairChange:L,range:R,nowMs:Q,paused:T!=null,subscriptionStatus:a?.status}),React.createElement(
Rl,{title:"Network",description:"Physical-default receive and send (IEC bytes/s)",frames:de,series:[{key:"network-receiv\
e",metric:"network_receive_bps",label:"Receive",color:"#3fb950",format:Me},{key:"network-send",metric:"network_send_bps",
label:"Send",color:"#d29922",format:Me}],viewport:M,onViewportChange:C,crosshairSequence:_,onCrosshairChange:L,range:R,nowMs:Q,
paused:T!=null,subscriptionStatus:a?.status})),!P&&React.createElement("section",{className:"host-resource-process-secti\
on","aria-labelledby":"host-resource-process-heading"},React.createElement("div",{className:"host-resource-process-headi\
ng"},React.createElement("span",null,React.createElement("strong",{id:"host-resource-process-heading"},"Processes"),React.
createElement("small",null,"Union of owned, top CPU, memory, read, and write. Attribution never implies unproved per-ses\
sion ownership.")),React.createElement("span",null,f.attributedProcesses.length," attributed / ",f.processes.length," sh\
own")),React.createElement("div",{className:"host-resource-process-controls"},React.createElement("label",null,"Search ",
React.createElement("input",{value:Z,onChange:ae=>oe(ae.target.value),placeholder:"Name, PID, agent, workspace"})),React.
createElement("label",null,"Attribution ",React.createElement("select",{value:ge,onChange:ae=>W(ae.target.value)},React.
createElement("option",{value:"all"},"All"),React.createElement("option",{value:"owned"},"Owned"),React.createElement("o\
ption",{value:"runtime"},"Runtime match"),React.createElement("option",{value:"workspace-associated"},"Workspace-associa\
ted"),React.createElement("option",{value:"unattributed"},"Unattributed"))),React.createElement("label",null,"Sort ",React.
createElement("select",{value:te,onChange:ae=>X(ae.target.value)},React.createElement("option",{value:"cpu"},"CPU"),React.
createElement("option",{value:"memory"},"Memory"),React.createElement("option",{value:"read"},"Read"),React.createElement(
"option",{value:"write"},"Write"),React.createElement("option",{value:"name"},"Name")))),z&&React.createElement("div",{className:"\
host-resource-process-overlay",role:"region","aria-label":`Process detail for ${z.agentLabel||z.name}`},React.createElement(
"div",null,React.createElement("strong",null,z.agentLabel||z.name),React.createElement("span",null,z.name," / PID ",z.pid,
" / started ",z.startTime?hd(z.startTime):"unknown"),React.createElement("small",null,z.attributionLevel,": ",z.attributionReason,
". CPU and disk overlays use the same synchronized timebase.")),React.createElement("button",{type:"button",onClick:()=>Ce(
"")},"Remove overlay"),React.createElement("dl",null,React.createElement("div",null,React.createElement("dt",null,"Host \
CPU"),React.createElement("dd",null,z.cpuHostPercent.toFixed(1),"%")),React.createElement("div",null,React.createElement(
"dt",null,"Core equivalent"),React.createElement("dd",null,z.cpuCoreEquivalent.toFixed(1),"%")),React.createElement("div",
null,React.createElement("dt",null,"Working set"),React.createElement("dd",null,Bs(z.memoryBytes))),React.createElement(
"div",null,React.createElement("dt",null,"Private / commit"),React.createElement("dd",null,Bs(z.privateBytes)," / ",Bs(z.
commitBytes))),React.createElement("div",null,React.createElement("dt",null,"Threads / handles"),React.createElement("dd",
null,z.threadCount," / ",z.handleCount)),React.createElement("div",null,React.createElement("dt",null,"I/O operations"),
React.createElement("dd",null,"R ",z.ioReadOps," / W ",z.ioWriteOps)),React.createElement("div",null,React.createElement(
"dt",null,"64-bit byte counters"),React.createElement("dd",null,"R ",z.counterTotals.ioReadBytes," / W ",z.counterTotals.
ioWriteBytes)),React.createElement("div",null,React.createElement("dt",null,"Detail samples"),React.createElement("dd",null,
ie.length," / 5s cadence")))),React.createElement("div",{className:"host-resource-process-scroll"},React.createElement("\
table",{className:"host-resource-process-table"},React.createElement("thead",null,React.createElement("tr",null,React.createElement(
"th",{scope:"col"},"Agent / process tree"),React.createElement("th",{scope:"col"},"Confidence"),React.createElement("th",
{scope:"col"},"CPU host / core"),React.createElement("th",{scope:"col"},"Memory"),React.createElement("th",{scope:"col"},
"Read"),React.createElement("th",{scope:"col"},"Write"))),React.createElement("tbody",null,E.map(({process:ae,depth:Re})=>React.
createElement("tr",{key:ae.stableKey,className:`${ae.attributed?"attributed":""} ${pe===ae.stableKey?"selected":""}`,"da\
ta-agent-attributed":ae.attributed?"true":"false"},React.createElement("td",{style:{"--process-depth":Re}},ae.childCount>
0&&React.createElement("button",{className:"host-resource-process-expand",type:"button","aria-label":`${ue[ae.stableKey]===
!1?"Expand":"Collapse"} ${ae.name}`,"aria-expanded":ue[ae.stableKey]!==!1,onClick:()=>J(F=>({...F,[ae.stableKey]:F[ae.stableKey]===
!1}))},ue[ae.stableKey]===!1?"+":"-"),React.createElement("button",{className:"host-resource-process-select",type:"butto\
n",onClick:()=>Ce(ae.stableKey)},React.createElement("strong",null,ae.agentLabel||ae.name),React.createElement("span",null,
ae.agentLabel?`${ae.name} / `:"","PID ",ae.pid,ae.workspaceLabel?` / ${ae.workspaceLabel}`:"",ae.parentKey?" / child pro\
cess":ae.parentPid?` / parent PID ${ae.parentPid} outside sample`:""))),React.createElement("td",{"data-label":"Confiden\
ce"},React.createElement("strong",null,ae.attributionLevel),React.createElement("span",{title:ae.attributionReason},ae.attributionReason)),
React.createElement("td",{"data-label":"CPU host / core"},ae.cpuHostPercent.toFixed(1),"% / ",ae.cpuCoreEquivalent.toFixed(
1),"%"),React.createElement("td",{"data-label":"Memory"},Bs(ae.memoryBytes)),React.createElement("td",{"data-label":"Rea\
d"},Fs(ae.ioReadBps)),React.createElement("td",{"data-label":"Write"},Fs(ae.ioWriteBps)))))))),React.createElement("div",
{className:"host-resource-privacy"},React.createElement("strong",null,"Privacy boundary:")," sanitized metrics cross the\
 authenticated relay only to this requester while this view is open. The relay does not cache, persist, log, or restore \
them. Process command lines and executable paths remain local and are never transmitted. Aggregate-only mode also remove\
s machine, device, adapter, workspace, process, and PID labels.")):React.createElement("div",{className:"usage-dashboard\
-empty host-resource-empty"},React.createElement("strong",null,"Waiting for the Windows proxy."),React.createElement("sp\
an",null,"The subscription is ",a?.status||"starting",". Gaps remain visible; unavailable samples are not interpolated.")))}
function Hk(e){let t=Number(e?.percent);if(Number.isFinite(t))return Math.max(0,Math.min(100,t));let n=Number(e?.completed),
s=Number(e?.total);return Number.isInteger(n)&&Number.isInteger(s)&&s>0?Math.max(0,Math.min(100,n/s*100)):null}function zk(e,t){
let n=ce(e?.last_snippet).trim();if(n)return n.replace(/\s+/g," ").slice(0,180);let s=Array.isArray(t)?t:[];for(let a=s.
length-1;a>=0;a-=1){let o=Aw(s[a]?.content||rc(s[a]?.content_blocks));if(o)return o.slice(0,180)}return"No recent messag\
e reported."}function Uk(e,t){if(e?.goal)return qg(e.goal,t,e.goal_run);let n=Date.parse(e?.startedAt||e?.started_at||e?.
since||"");return Number.isFinite(n)?cp(Math.max(0,(t-n)/1e3),{includeSeconds:!0}):"live"}function Gk(e,t,n=20){let s=e.
filter(a=>t[a]?.canReceiveBroadcast).slice(0,n);return s.length===e.length&&s.every((a,o)=>a===e[o])?e:s}function Wk({sessions:e,
activities:t,thinking:n,permissionPrompts:s,errorPrompts:a,messages:o,agentConfigs:c,sessionAttention:u,health:m,connected:f,
deliveryStates:v,stopPending:k,goalControlPending:R,onBroadcastSend:S,onInterrupt:T,onGoalControl:b,onBack:w,onSelectSession:h}){
let[M,C]=React.useState(Date.now()),[_,L]=React.useState(!1),[P,V]=React.useState([]),[Z,oe]=React.useState(""),[ge,W]=React.
useState(""),[te,X]=React.useState(""),[ue,J]=React.useState({});React.useEffect(()=>{let E=setInterval(()=>C(Date.now()),
1e3);return()=>clearInterval(E)},[]);let pe=React.useMemo(()=>(e||[]).map(E=>{let z=je(E),ie=Object.prototype.hasOwnProperty.
call(t,z)?t[z]||{kind:"idle",label:""}:E?.activity||{kind:"idle",label:""},ye=s[z]||(Yi(a[z])?a[z]:null),Me=u[z]||null,ke=!!ye||
E?.rate_limit_active===!0||["goal_attention","provider_usage_threshold"].includes(Me?.kind),Ee=c[z]||{},He=E?.agent_type,
Re=Gv(He,Ee.capabilities)?ie:{...ie,goal:null},F=n[z]&&!Re?.kind?{...Re,kind:"thinking"}:Re,re=tl(F,ke,{connected:f,health:m[z],
nowMs:M,requireFreshness:!0}),Te=re==="needs_attention",Ke=Ir(re),St=nl(Re,{connected:f,health:m[z]}),vs=Qi(E,Ee),on=Kv(
{agentType:He,capabilities:Ee.capabilities,activity:Re,latestUserRequest:E?.last_user_request||Wv(o[z]||[])}),G=on.kind===
"goal"&&Re?.goal||null,bn=String(G?.state||G?.status||"").toLowerCase(),Rn=bn==="blocked",Un=Rn&&Ee.capabilities?.goal_blocked_resume===
!0,ws=bn==="active"?"pause":bn==="paused"||Un?"resume":null,ks=Rn?ce(G?.block_reason||G?.reason||Re?.label||"Goal blocke\
d").trim():"",Zi=["thinking","generating","running_command","applying_patch","reading_files","working"].includes(String(
Re?.kind||"").toLowerCase()),Vr=ce(Re?.kind).replace(/_/g," "),rr=Number(E?.percent_used),Ws=E?.rate_limited_until&&E.rate_limited_until!==
"unknown"?ac(E.rate_limited_until):"",eo=E?.rate_limit_active===!0?`Usage limited${Ws?` \xB7 resets ${Ws}`:" \xB7 reset unk\
nown"}`:Number.isFinite(rr)&&rr>=75?`Usage ${Math.round(rr)}% used${Ws?` \xB7 resets ${Ws}`:""}`:"";return{id:z,session:E,
agent:vs,activity:Re,attention:Te,working:Ke,state:re,goal:G,config:Ee,stateLabel:E?.rate_limit_active===!0?"Usage limit\
ed":uf(re),title:tc(E,z,Ee,o[z]||[]),status:ye?ce(ye.title).trim()||"Action required":eo||St||ce(ie?.label).trim()||(re===
"idle"?G?"Goal paused":"Idle":Vr||(G?"Goal active":"Working")),workContext:on,progress:Hk(on),snippet:zk(E,o[z]||[]),health:m[z]||
"unknown",canReceiveBroadcast:fh(E,c[z],m[z]||"unknown",f),freshness:mf(ie,M),activityLatencyMs:Number.isFinite(Number(ie?.
transport?.latency_ms))?Math.round(Number(ie.transport.latency_ms)):null,goalAction:ws,canControlGoal:!!(ws&&G?.fingerprint&&
Ee.capabilities?.goal_pause_resume===!0&&Number(E?.control_generation)>0),goalBlocked:Rn,goalBlockedReason:ks,canInterrupt:!!(Zi&&
Ee.capabilities?.interrupt===!0&&Number(E?.control_generation)>0&&Number(E?.turn_generation)>0)}}).filter(Boolean).sort(
(E,z)=>Number(z.attention)-Number(E.attention)||Number(z.working)-Number(E.working)||E.title.localeCompare(z.title)),[e,
t,n,s,a,o,c,u,m,f,M]),Ce=React.useMemo(()=>pe.filter(E=>_||E.state!=="idle"||E.goal),[pe,_]),se=pe.filter(E=>E.state==="\
needs_attention").length,Q=pe.filter(E=>E.working).length,de=pe.filter(E=>E.state==="working_goal").length,he=pe.filter(
E=>E.state==="idle").length,xe=React.useMemo(()=>Object.fromEntries(Ce.map(E=>[E.id,E])),[Ce]),be=`SEND TO ${P.length} S\
ESSIONS`;React.useEffect(()=>{P.length<=20&&P.every(E=>xe[E]?.canReceiveBroadcast)||V(E=>Gk(E,xe))},[xe,P]),React.useEffect(
()=>{Object.keys(ue).length!==0&&J(E=>{let z=!1,fe={};return Object.entries(E).forEach(([ie,ye])=>{let Me=v[ye.clientMessageId]||
ye.status,ke=["offline_queued","busy_queued","steered"].includes(Me)?"queued":Me,Ee=["queued","accepted","launch_accepte\
d","delivered","agent_started","failed"].includes(ke)?ke:ye.status;fe[ie]=Ee===ye.status?ye:{...ye,status:Ee},fe[ie]!==ye&&
(z=!0)}),z?fe:E})},[v]);function ee(E){X(""),V(z=>z.includes(E)?z.filter(fe=>fe!==E):z.length<20?[...z,E]:z)}function H(){
let E=hh({session_ids:P,content:Z,confirmation:ge},ie=>!!xe[ie]?.canReceiveBroadcast);if(!E.ok){X(E.error);return}let z=gh(
E.sessionIds),fe={};E.sessionIds.forEach(ie=>{let ye=S(ie,E.content);fe[ie]={...z[ie],clientMessageId:ye,title:xe[ie]?.title||
ie}}),J(fe),oe(""),W(""),X("")}return React.createElement("div",{className:"fleet-view","data-testid":"fleet-view","data\
-pane-id":"route-fleet"},React.createElement("div",{className:"automations-header fleet-view-header"},React.createElement(
"button",{className:"automations-back","data-route-return":"chat",onClick:w,title:"Back to chat"},"\u2190"," Back to cha\
t"),React.createElement("div",{className:"automations-header-text"},React.createElement("h2",null,"Fleet view"),React.createElement(
"p",null,"Live monitoring across every active harness session."))),React.createElement("div",{className:"fleet-summary",
"aria-label":"Fleet summary"},React.createElement("div",null,React.createElement("strong",null,pe.length),React.createElement(
"span",null,"sessions")),React.createElement("div",{className:Q?"working":""},React.createElement("strong",null,Q),React.
createElement("span",null,"working")),React.createElement("div",{className:de?"working-goal":""},React.createElement("st\
rong",null,de),React.createElement("span",null,"on goal")),React.createElement("div",null,React.createElement("strong",null,
he),React.createElement("span",null,"idle")),React.createElement("div",{className:se?"attention":""},React.createElement(
"strong",null,se),React.createElement("span",null,"need attention"))),React.createElement("div",{className:"fleet-filter\
-row"},React.createElement("span",null,Q," working now"),React.createElement("button",{type:"button",onClick:()=>L(E=>!E),
"aria-pressed":_},_?"Hide idle sessions":`Show ${he} idle session${he===1?"":"s"}`)),React.createElement("section",{className:"\
fleet-broadcast","data-testid":"broadcast-send"},React.createElement("div",{className:"fleet-broadcast-heading"},React.createElement(
"div",null,React.createElement("strong",null,"Broadcast prompt"),React.createElement("span",null,"Select up to ",20," ca\
pable sessions.")),React.createElement("span",null,P.length," selected")),React.createElement("textarea",{value:Z,onChange:E=>oe(
E.target.value),maxLength:65536,placeholder:"Prompt every selected session...","aria-label":"Broadcast prompt"}),React.createElement(
"div",{className:"fleet-broadcast-confirm"},React.createElement("label",null,React.createElement("span",null,"Type ",React.
createElement("strong",null,be)," to confirm"),React.createElement("input",{value:ge,onChange:E=>W(E.target.value),"aria\
-label":"Broadcast confirmation"})),React.createElement("button",{type:"button",onClick:H,disabled:!f||P.length===0||!Z.
trim()||ge!==be},"Send to ",P.length||0)),te&&React.createElement("div",{className:"fleet-broadcast-error",role:"alert"},
te),Object.keys(ue).length>0&&React.createElement("div",{className:"fleet-broadcast-receipts","aria-label":"Broadcast de\
livery receipts"},Object.entries(ue).map(([E,z])=>React.createElement("span",{key:E,className:`fleet-broadcast-receipt ${z.
status}`,title:z.title},React.createElement("strong",null,z.title),React.createElement("em",null,z.status.replace(/_/g,"\
 ")))))),Ce.length===0?React.createElement("div",{className:"fleet-empty"},React.createElement("strong",null,"Fleet is i\
dle"),React.createElement("span",null,he," connected session",he===1?" is":"s are"," idle. Show idle sessions to inspect\
 them.")):React.createElement("div",{className:"fleet-grid"},Ce.map(E=>React.createElement("div",{role:"button",tabIndex:0,
className:`fleet-card state-${E.state}${E.attention?" attention":""}${P.includes(E.id)?" selected":""}`,key:E.id,"data-s\
ession-id":E.id,"data-activity-state":E.state,"data-activity-lag-ms":E.activityLatencyMs??"",onClick:()=>h(E.id,E.session),
onKeyDown:z=>{z.target===z.currentTarget&&(z.key==="Enter"||z.key===" ")&&h(E.id,E.session)}},React.createElement("span",
{className:"fleet-card-top"},React.createElement("span",{className:"agent-badge",style:{color:E.agent.color,borderColor:E.
agent.color+"55",background:E.agent.color+"18"}},E.agent.logo?React.createElement("img",{src:E.agent.logo,alt:"",className:"\
agent-badge-logo"}):E.agent.abbr),React.createElement("span",{className:"fleet-card-identity"},React.createElement("stro\
ng",null,E.title),React.createElement("span",null,E.agent.name)),React.createElement("span",{className:`fleet-health ${E.
health}`,title:E.health}),React.createElement("label",{className:`fleet-select${E.canReceiveBroadcast?"":" unavailable"}`,
onClick:z=>z.stopPropagation()},React.createElement("input",{type:"checkbox",checked:P.includes(E.id),disabled:!E.canReceiveBroadcast,
onChange:()=>ee(E.id),"aria-label":`Select ${E.title} for broadcast`}),React.createElement("span",null,E.canReceiveBroadcast?
"Select":"Unavailable"))),React.createElement("span",{className:"fleet-card-status"},E.working&&React.createElement(nc,{
agentType:E.session?.agent_type,compact:!0,animate:!1}),React.createElement("span",{className:`fleet-state-badge ${E.state}`},
E.stateLabel),React.createElement("strong",null,E.status),E.working&&React.createElement("time",null,Uk(E.activity,M))),
React.createElement("span",{className:"fleet-freshness",title:"Proxy-to-Fleet delivery time"},"Activity ",E.freshness),(E.
canControlGoal||E.goalBlocked||E.canInterrupt)&&React.createElement("span",{className:"fleet-control-actions",role:"grou\
p","aria-label":`Controls for ${E.title}`,onClick:z=>z.stopPropagation()},E.canControlGoal&&React.createElement("button",
{type:"button",onClick:()=>b(E.id,E.goalAction,E.goal,E.session),disabled:!f||!!R?.[E.id],"aria-label":`${E.goalAction===
"pause"?"Pause":E.goalBlocked?"Resume blocked":"Resume"} goal for ${E.title}`,title:E.goalBlocked?E.goalBlockedReason:void 0},
R?.[E.id]?E.goalAction==="pause"?"Pausing...":"Resuming...":E.goalAction==="pause"?"Pause goal":E.goalBlocked?"Resume bl\
ocked goal":"Resume goal"),E.goalBlocked&&!E.canControlGoal&&React.createElement("button",{type:"button",disabled:!0,"ar\
ia-label":`Goal blocked for ${E.title}; resolve in the native session`,title:E.goalBlockedReason||"No verified native un\
block action is available"},"Goal blocked \xB7 native action required"),E.canInterrupt&&React.createElement("button",{type:"\
button",className:"danger",onClick:()=>T(E.id,E.session),disabled:!f||!!k?.[E.id],"aria-label":`Interrupt turn for ${E.title}`},
k?.[E.id]?"Interrupting...":"Interrupt turn")),E.session?.agent_type==="codex_cli"&&E.config?.config_semantics==="observ\
ed_and_next_send"&&React.createElement("span",{className:"fleet-freshness",title:"Native observation and pending next-se\
nd override"},"Observed ",E.config.observed_model_id||"unknown"," / ",E.config.observed_effort||"unknown"," \xB7 ","Next\
 ",E.config.next_send_model_id||"unset"," / ",E.config.next_send_effort||"unset"),React.createElement("span",{className:`\
fleet-work-context kind-${E.workContext.kind}`,"aria-label":`${E.workContext.label}: ${E.workContext.text}`,"data-work-c\
ontext-kind":E.workContext.kind,"data-work-context-source":E.workContext.source},React.createElement("strong",null,E.workContext.
label),React.createElement("span",null,E.workContext.text),Number.isInteger(E.workContext.completed)&&Number.isInteger(E.
workContext.total)?React.createElement("em",null,E.workContext.completed,"/",E.workContext.total):null),(E.workContext.kind===
"goal"||E.progress!=null)&&React.createElement("span",{className:`fleet-work-meter kind-${E.workContext.kind}${E.progress==
null&&E.working?" indeterminate":""}${E.working?"":" inactive"}`,"aria-label":E.progress==null?`${E.workContext.label} ${E.
stateLabel.toLowerCase()}`:Number.isInteger(E.workContext.completed)&&Number.isInteger(E.workContext.total)?`${E.workContext.
label} ${E.workContext.completed} of ${E.workContext.total} complete`:`${E.workContext.label} ${Math.round(E.progress)}%\
 complete`},React.createElement("span",{style:E.progress==null?void 0:{width:`${E.progress}%`}})),React.createElement("s\
pan",{className:"fleet-snippet"},E.snippet),React.createElement("span",{className:"fleet-jump","aria-label":"Open sessio\
n"},"Open session ",React.createElement("span",{className:"fleet-jump-chevron","aria-hidden":"true"},"\u203A"))))))}function Kk({
onBack:e,onOpenResult:t}){let[n,s]=React.useState(""),[a,o]=React.useState(""),[c,u]=React.useState(""),[m,f]=React.useState(
""),[v,k]=React.useState(""),[R,S]=React.useState([]),[T,b]=React.useState(!0),[w,h]=React.useState(!1),[M,C]=React.useState(
"");async function _(L){if(L?.preventDefault(),!(n.trim().length<2||w)){h(!0),C("");try{let P=new URLSearchParams({q:n.trim(),
limit:"50"});a.trim()&&P.set("project",a.trim()),c.trim()&&P.set("harness",c.trim()),m&&P.set("date_from",m),v&&P.set("d\
ate_to",v);let V=await fetch(`/api/search/messages?${P.toString()}`,{credentials:"same-origin"}),Z=await V.json().catch(
()=>({}));if(!V.ok)throw new Error(Z.error||"Transcript search failed.");S(Array.isArray(Z.results)?Z.results:[]),b(Z.index?.
ready!==!1)}catch(P){S([]),C(P?.message||"Transcript search failed.")}finally{h(!1)}}}return React.createElement("div",{
className:"transcript-search-view","data-testid":"transcript-search-view","data-pane-id":"route-search"},React.createElement(
"div",{className:"automations-header transcript-search-header"},React.createElement("button",{className:"skills-back","d\
ata-route-return":"chat",onClick:e,title:"Back to chat"},"\u2190 Back to chat"),React.createElement("div",null,React.createElement(
"h2",null,"Transcript search"),React.createElement("p",null,"Search every relay-backed message."))),React.createElement(
"form",{className:"transcript-search-form",onSubmit:_},React.createElement("label",{className:"transcript-search-query"},
React.createElement("span",null,"Search text"),React.createElement("input",{value:n,onChange:L=>s(L.target.value),placeholder:"\
Words from any conversation",maxLength:200,autoFocus:!0})),React.createElement("div",{className:"transcript-search-filte\
rs"},React.createElement("label",null,React.createElement("span",null,"Project"),React.createElement("input",{value:a,onChange:L=>o(
L.target.value),placeholder:"Exact workspace or project",maxLength:300})),React.createElement("label",null,React.createElement(
"span",null,"Harness"),React.createElement("input",{value:c,onChange:L=>u(L.target.value),placeholder:"e.g. codex_cli",maxLength:80})),
React.createElement("label",null,React.createElement("span",null,"From"),React.createElement("input",{type:"date",value:m,
onChange:L=>f(L.target.value)})),React.createElement("label",null,React.createElement("span",null,"To"),React.createElement(
"input",{type:"date",value:v,onChange:L=>k(L.target.value)}))),React.createElement("button",{type:"submit",className:"tr\
anscript-search-submit",disabled:n.trim().length<2||w},w?"Searching\u2026":"Search transcripts")),!T&&React.createElement(
"div",{className:"transcript-search-indexing"},"Older history is still indexing; current results are partial."),M&&React.
createElement("div",{className:"transcript-search-error",role:"alert"},M),!w&&!M&&R.length===0&&n.trim().length>=2&&React.
createElement("div",{className:"fleet-empty"},React.createElement("strong",null,"No matches"),React.createElement("span",
null,"Try fewer words or clear a filter.")),React.createElement("div",{className:"transcript-search-results","aria-live":"\
polite"},R.map(L=>React.createElement("button",{type:"button",className:"transcript-search-result",key:`${L.session_id}:${L.
message_id}`,onClick:()=>t(L)},React.createElement("span",{className:"transcript-search-result-top"},React.createElement(
"strong",null,L.workspace_name||L.project_root||L.session_id),React.createElement("em",null,L.agent_type||"unknown"," \xB7 ",
L.role)),React.createElement("span",{className:"transcript-search-snippet"},L.snippet||"(empty message)"),React.createElement(
"span",{className:"transcript-search-result-bottom"},React.createElement("time",null,L.matched_at?new Date(L.matched_at).
toLocaleString():""),React.createElement("span",null,"Open match \u203A"))))))}function Vk({skills:e,onRefresh:t,onBack:n}){
let s=e?.installed||[],a=e?.recommended||[],o=s.length===0&&a.length===0;return React.createElement("div",{className:"sk\
ills-view","data-pane-id":"route-skills"},React.createElement("div",{className:"skills-header"},React.createElement("but\
ton",{className:"skills-back","data-route-return":"chat",onClick:n,title:"Back to chat"},"\u2190 Back to chat"),React.createElement(
"div",{className:"skills-header-text"},React.createElement("h2",null,"Skills"),React.createElement("p",{className:"skill\
s-subtitle"},"Give Codex superpowers.")),React.createElement("button",{className:"skills-refresh-btn",onClick:t,title:"R\
efresh skills"},"\u21BB")),o?React.createElement("div",{className:"skills-loading"},"Loading skills\u2026"):React.createElement(
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
React.createElement("div",{className:"skills-card-action available"},"+")))))))}var ap=class extends React.Component{constructor(t){
super(t),this.state={error:null}}static getDerivedStateFromError(t){return{error:t}}componentDidCatch(t,n){try{console.error(
"Agent Chat render crash",t,n),sessionStorage.setItem("agent-chat:last-render-error",JSON.stringify({message:t?.message||
String(t),stack:t?.stack||"",componentStack:n?.componentStack||"",at:new Date().toISOString()}))}catch{}}render(){return this.
state.error?React.createElement("div",{className:"app-crash"},React.createElement("div",{className:"app-crash-card"},React.
createElement("div",{className:"app-crash-title"},"Agent Chat hit a render error"),React.createElement("div",{className:"\
app-crash-body"},this.state.error?.message||"Unknown UI error"),React.createElement("div",{className:"app-crash-actions"},
React.createElement("button",{className:"app-crash-btn",onClick:()=>location.reload()},"Refresh")))):this.props.children}},
rp=class extends React.Component{componentDidMount(){this.props.finishStructureChange(null)}getSnapshotBeforeUpdate(t){return t.
structureKey===this.props.structureKey?null:this.props.prepareStructureChange(t.placements,this.props.placements)}componentDidUpdate(t,n,s){
t.structureKey!==this.props.structureKey&&this.props.finishStructureChange(s)}render(){return this.props.children}};function Yk(){
React.useLayoutEffect(()=>{let i=typeof window<"u"?window.__RAC_TEMPORAL_CANARY__:null;if(!i?.active)return;let g=i.reactCommits||
(i.reactCommits=[]);g.length<2e4?g.push({sequence:g.length+1,at_epoch_ms:Date.now(),route:document.querySelector(".messa\
ges")?"chat":"other"}):i.droppedSamples=Number(i.droppedSamples||0)+1});let{sessions:e,messages:t,provisionalStreams:n,historyMeta:s,
historyLoading:a,connected:o,connectionHealth:c,unread:u,setUnread:m,thinking:f,thinkingContent:v,activities:k,health:R,
deliveryStates:S,launchStates:T,justLaunched:b,setJustLaunched:w,permissionPrompts:h,respondToPrompt:M,errorPrompts:C,respondToErrorPrompt:_,
interruptSession:L,controlGoal:P,agentConfigs:V,configControlStates:Z,requestAgentConfig:oe,setAgentModel:ge,setAgentEffort:W,
setAgentPermissionMode:te,setAutoApprovePermissions:X,setAntigravityMode:ue,setCodexConfig:J,newThread:pe,openPanel:Ce,openNativeWindow:se,
requestChatList:Q,switchChat:de,newChat:he,chatLists:xe,requestThreadList:be,switchThread:ee,threadLists:H,threadViews:E,
switchWorkspace:z,requestTerminalOutput:fe,sendTerminalInput:ie,terminalOutputs:ye,requestFileChanges:Me,respondToFileChange:ke,
fileChanges:Ee,sendAttachment:He,send:ae,sendToSession:Re,steerMessage:F,discardQueuedMessage:re,editQueuedMessage:Te,queuedMessages:Ke,
scheduledSends:St,scheduleSend:vs,cancelScheduledSend:on,launchSession:G,resumeSession:bn,closeSession:Rn,activeSessionRef:Un,
restoreCachedTranscript:ws,setSessionSubscriptions:ks,workspaces:Zi,branchLists:Vr,requestBranchList:rr,switchBranch:Ws,
createBranch:eo,skillLists:to,requestSkillList:ic,automationViews:no,showCodexAutomation:Pl,controlResults:Tn,directoryListings:ql,
requestDirectoryListing:Yr,fileContents:so,requestFileContent:_a,requestHistory:oc,requestHistoryChunk:ba,duplicateProxyAlarms:$n,
nightlyValidationFailures:Xr,latestAppUpdateValidation:ao,revalidationProgramHealth:Gn,operatorDogfoodHealth:ya,providerUsage:Ss,
providerUsageRefreshReceipt:Dl,requestProviderUsageRefresh:va,setProviderUsageWatching:jl,providerUsageResetReceipt:wa,consumeProviderUsageResetCredit:Bl,
providerUsageCostDetail:ir,requestProviderUsageCostDetail:Fl,hostResources:ka,hostResourceError:cc,hostResourceHistory:ro,
hostResourceDetails:Hl,hostResourceSubscription:lc,subscribeHostResources:Wn,unsubscribeHostResources:Ks,requestHostResourceRefresh:Kn,
semanticNotifications:Ns,sessionAliases:En}=Xf(),[d,yn]=_e(null),[Be,Ge]=_e(()=>wl()),Le=Vv(),Fe=we({}),xs=pt(Be,Ge,d,"s\
idebar",Le,Fe),vn=pt(Be,Ge,d,"new-session",Le,Fe),Vs=pt(Be,Ge,d,"notification-settings",Le,Fe),Ys=pt(Be,Ge,d,"session-ma\
nagement",Le,Fe),Vn=pt(Be,Ge,d,"scheduled-send",Le,Fe),Yn=pt(Be,Ge,d,"agent-settings",Le,Fe),It=pt(Be,Ge,d,"composer-set\
tings",Le,Fe),cn=pt(Be,Ge,d,"chat-list",Le,Fe),Ln=pt(Be,Ge,d,"thread-list",Le,Fe),Sa=pt(Be,Ge,d,"terminal",Le,Fe),Cs=pt(
Be,Ge,d,"diff-viewer",Le,Fe),Xs=pt(Be,Ge,d,"branch-selector",Le,Fe),wn=pt(Be,Ge,d,"file-browser",Le,Fe),Pt=pt(Be,Ge,d,"a\
ntigravity-navigator",Le,Fe),Xn=pt(Be,Ge,d,"native-action",Le,Fe),Qr=pt(Be,Ge,d,"rate-limit",Le,Fe),io=pt(Be,Ge,d,"live-\
activity",Le,Fe),oo=pt(Be,Ge,d,"task-list",Le,Fe),Qn=pt(Be,Ge,d,"automation-context",Le,Fe),Na=pt(Be,Ge,d,"quick-switche\
r",Le,Fe),kn=pt(Be,Ge,d,"shortcut-help",Le,Fe),tt=pt(Be,Ge,d,"revalidation-ledger",Le,Fe),it=$h(Be,d),Qt=React.useCallback(
(i,g)=>{g&&(Fe.current[i]=g),Ge($=>ma($,{session_id:d,pane_id:i,action:"restore",compact:Le}))},[d,Le]),$t=xs.open,Et=xs.
setOpen,xa=vn.open,Ca=vn.setOpen,Jr=Vs.open,Jn=Vs.setOpen,Qs=Ys.open,Nt=Ys.setOpen,As=Vn.open,On=Vn.setOpen,Js=Yn.open,Zs=Yn.
setOpen,gt=It.open,ln=It.setOpen,Zn=cn.open,qt=cn.setOpen,un=Ln.open,Jt=Ln.setOpen,Ut=Sa.open,es=Sa.setOpen,Dt=Cs.open,ea=Cs.
setOpen,ta=Xs.open,Ms=Xs.setOpen,Zr=wn.open,uc=wn.setOpen,In=Pt.open,Aa=Pt.setOpen,ts=Na.open,or=Na.setOpen,cr=kn.open,na=kn.
setOpen,dc=tt.open,Se=tt.setOpen;$e(()=>{Le||Be?.sessions?.[d||"__global__"]?.panes?.sidebar||Ge(i=>ma(i,{session_id:d,pane_id:"\
sidebar",action:"open",compact:!1}))},[d,Le,Be]);let zl=React.useCallback(i=>af(d,i),[d]),pc=React.useCallback(()=>Qc(d),
[d]),Ul=React.useSyncExternalStore(zl,pc,pc),[ei,co]=_e({}),[lr,Rs]=_e({}),[ur,dr]=_e(""),[mc,fc]=_e(""),[Sn,Ts]=_e(null),
[lo,pr]=_e({}),[sa,ns]=_e(dk),[Zt,ss]=_e(!1),_t=we(null),Ma=we({}),Ra=we(!1),[Pn,ti]=_e(!1),[Ta,dn]=_e(!1),[mr,as]=_e(""),
[xt,fr]=_e({}),[hr,hc]=_e(!1),[ni,si]=_e(""),[$a,ai]=_e(""),[Gt,Ct]=_e(0),[pn,uo]=_e({}),[aa,gr]=_e({}),[mn,_r]=_e({}),ri=we(
new Map),[br,po]=_e(null),qn=we({sessionId:null,expiresAt:0}),rs=we(null),[Gl,ii]=_e(!1),[gc,oi]=_e(0),[Wl,mo]=_e({}),[Ea,
ci]=_e({}),[is,fo]=_e({}),[ho,yr]=_e({}),[La,$s]=_e(!1),[Oa,os]=_e(!1),[Ia,cs]=_e(!1),[ra,ls]=_e(!1),[Pa,Dn]=_e(!1),[qa,
Es]=_e(!1),[mt,go]=_e(null),[Kl,_c]=_e("."),[_o,vr]=_e(null),[li,bo]=_e(null),bc=we(null),[Vl,ui]=_e(0),[Da,Yl]=_e(()=>{
try{return localStorage.getItem(Wh)==="1"}catch{return!1}}),[wr,yc]=_e(()=>{try{return localStorage.getItem(Kh)==="1"}catch{
return!1}}),[di,vc]=_e(()=>{try{return localStorage.getItem(Vh)==="1"}catch{return!1}}),[r,p]=_e(!1),y=we(null),[O,l]=_e(
()=>{try{return localStorage.getItem("remote-agent-chat-theme")||"dark"}catch{return"dark"}}),[x,A]=_e(()=>{try{let i=JSON.
parse(localStorage.getItem("remote-agent-chat:collapsed-directories:v1")||"[]");return Array.isArray(i)?Object.fromEntries(
i.map(g=>[String(g),!0])):{}}catch{return{}}}),[I,j]=_e(()=>{try{return localStorage.getItem(Gh)==="1"}catch{return!1}});
$e(()=>{try{localStorage.setItem(Gh,I?"1":"0")}catch{}},[I]),$e(()=>{try{localStorage.setItem(Wh,Da?"1":"0")}catch{}},[Da]),
$e(()=>{try{localStorage.setItem(Kh,wr?"1":"0")}catch{}},[wr]),$e(()=>{try{localStorage.setItem(Vh,di?"1":"0")}catch{}},
[di]),$e(()=>{let i=window.visualViewport,g=()=>{let $=Math.max(1,Math.round(i?.width||window.innerWidth||1)),N=Math.max(
1,Math.round(i?.height||window.innerHeight||1)),q=Math.max(0,Math.round(i?.offsetTop||0));document.documentElement.style.
setProperty("--rac-visual-viewport-width",`${$}px`),document.documentElement.style.setProperty("--rac-visual-viewport-he\
ight",`${N}px`),document.documentElement.style.setProperty("--rac-visual-viewport-offset-top",`${q}px`)};return g(),i?.addEventListener(
"resize",g),i?.addEventListener("scroll",g),window.addEventListener("resize",g),window.addEventListener("orientationchan\
ge",g),()=>{i?.removeEventListener("resize",g),i?.removeEventListener("scroll",g),window.removeEventListener("resize",g),
window.removeEventListener("orientationchange",g)}},[]);let[D]=_e(()=>{try{let i=JSON.parse(localStorage.getItem(Md)||"{\
}");return gl(i)}catch{return gl(fl)}});$e(()=>{try{localStorage.setItem(Md,JSON.stringify(D))}catch{}},[D]),$e(()=>{fetch(
"/api/preferences/sessions",{credentials:"same-origin"}).then(i=>i.ok?i.json():Promise.reject(new Error("Session setting\
s unavailable"))).then(i=>{fr(i.preferences||{}),hc(!0)}).catch(()=>{})},[]),$e(()=>{let i=!0;return fetch("/api/prefere\
nces/notifications",{credentials:"same-origin"}).then(g=>g.ok?g.json():Promise.reject(new Error("Notification settings u\
navailable"))).then(g=>{i&&(ns({...mp,...g.preferences||{},turn_ready:!1}),ss(!0))}).catch(()=>{}),()=>{i=!1}},[]),$e(()=>{
if(!sa.completion_sound)return;let i=()=>fp();return document.addEventListener("pointerdown",i,{once:!0}),document.addEventListener(
"keydown",i,{once:!0}),()=>{document.removeEventListener("pointerdown",i),document.removeEventListener("keydown",i)}},[sa.
completion_sound]);async function ne(i,g){let $=await fetch(`/api/preferences/sessions/${encodeURIComponent(i)}`,{method:"\
PUT",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({preference:g})}),N=await $.
json().catch(()=>({}));if(!$.ok)throw new Error(N.error||"Unable to save session settings.");return fr(q=>({...q,[i]:N.preference})),
N.preference?.archived&&d===i&&yn(null),N.preference}async function me(i,g){let $=await fetch(`/api/sessions/${encodeURIComponent(
i)}/export?format=${encodeURIComponent(g)}`,{credentials:"same-origin"});if(!$.ok){let Ne=await $.json().catch(()=>({}));
throw new Error(Ne.error||"Unable to export session.")}let q=($.headers.get("Content-Disposition")||"").match(/filename\*=UTF-8''([^;]+)/i)?.[1],
K=`session.${g==="json"?"json":"md"}`;if(q)try{K=decodeURIComponent(q)}catch{}let Y=URL.createObjectURL(await $.blob()),
le=document.createElement("a");le.href=Y,le.download=K,le.hidden=!0,document.body.appendChild(le),le.click(),le.remove(),
setTimeout(()=>URL.revokeObjectURL(Y),1e3)}$e(()=>{try{let i=Object.keys(x).filter(g=>x[g]);localStorage.setItem("remote\
-agent-chat:collapsed-directories:v1",JSON.stringify(i))}catch{}},[x]);let Ie=React.useCallback(i=>{A(g=>({...g,[i]:!g[i]}))},
[]),Ye=we(F);$e(()=>{Ye.current=F},[F]);let bt=React.useCallback((i,g)=>{d&&Ye.current(d,i,g)},[d]),Lt=we(Re);$e(()=>{Lt.
current=Re},[Re]);let Nn=React.useCallback(i=>{let g=$l(i);!d||!g||Lt.current(d,i.content,g)},[d]),At=we(_a);$e(()=>{At.
current=_a},[_a]);let ut=React.useMemo(()=>[...e||[]].map(i=>{let g=je(i),$=xt[g];return $?.display_name?typeof i=="obje\
ct"?{...i,custom_display_name:$.display_name}:{session_id:g,custom_display_name:$.display_name}:i}),[e,xt]),qe=React.useMemo(
()=>new Set(ut.filter(Rd).map(je)),[ut]),ot=React.useMemo(()=>ut.filter(i=>!Rd(i)),[ut]),ct=I?ut:ot,Pe=React.useMemo(()=>ct.
filter(i=>!xt[je(i)]?.archived),[ct,xt]),pi=React.useMemo(()=>ot.filter(i=>!xt[je(i)]?.archived),[ot,xt]),yt=Bw(k,Pe),Je=React.
useMemo(()=>({activities:k,thinking:f,pendingPrompts:h,errorPrompts:Object.fromEntries(Object.entries(C||{}).filter(([,i])=>Yi(
i))),health:R,connected:o,nowMs:yt,requireFreshness:!0}),[k,f,h,C,R,o,yt]),yo=React.useMemo(()=>ih(Je),[Je]),{working:Xl,
states:vt}=React.useMemo(()=>rh(Pe,yo),[Pe,yo]),Ot=we(null),en=we(null),jn=we(null),Wt=we(0),wc=we(null),mi=we(null),ja=we(
null),Ql=we(!1),fi=we(0),hp=we(null),Jl=we(0),gp=we(""),[Zl,_p]=_e(!1),vo=React.useCallback(()=>{jn.current&&clearTimeout(
jn.current),jn.current=null,_p(!0)},[]),kr=React.useCallback((i=0)=>{jn.current&&clearTimeout(jn.current),jn.current=setTimeout(
()=>{jn.current=null,_p(!1)},i)},[]);React.useEffect(()=>{let i=()=>kr(80);return window.addEventListener("pointerup",i,
!0),window.addEventListener("pointercancel",i,!0),()=>{window.removeEventListener("pointerup",i,!0),window.removeEventListener(
"pointercancel",i,!0),jn.current&&clearTimeout(jn.current),mi.current&&cancelAnimationFrame(mi.current),ja.current&&cancelAnimationFrame(
ja.current),fi.current&&cancelAnimationFrame(fi.current)}},[kr]);let{sessions:Bn}=Dw(Xl,Zl,React.useMemo(()=>({nowMs:yt,
entryConfirmMs:2e3,exitGraceMs:1e4,immediateExitIds:new Set(Object.entries(vt).filter(([,i])=>i==="idle"||i==="needs_att\
ention").map(([i])=>i))}),[yt,vt])),kc=React.useMemo(()=>new Set(Bn.map(je)),[Bn]),{pinned:bp}=React.useMemo(()=>th(Pe,xt),
[Pe,xt]),Sc=React.useMemo(()=>new Set(bp.map(je)),[bp]),eu=React.useMemo(()=>ld(Pe,{workingSessionIds:kc,pinnedSessionIds:Sc}),
[Pe,kc,Sc]),yp=jw([...eu.recent,...eu.pinned,...eu.remaining],Zl),vp=React.useMemo(()=>yp.map(je),[yp]),Nc=React.useMemo(
()=>ld(Pe,{workingSessionIds:kc,pinnedSessionIds:Sc,recentSessionIds:vp}),[Pe,kc,Sc,vp]),Fn=Nc.recent,Gg=React.useMemo(()=>new Set(
Fn.map(je)),[Fn]),Ls=Nc.pinned,Wg=React.useMemo(()=>$d(Nc.remaining,V,D),[Nc.remaining,V,D]),hi=React.useMemo(()=>Object.
fromEntries($d(Pe,V,D).flatMap(i=>i.sessions.map(g=>[je(g),i.label]))),[Pe,V,D]),Kg=React.useMemo(()=>({...Je,messages:t,
rankWorking:!1}),[Je,t]),{groups:wp,orderChanged:xc,sortNow:kp}=Ow(Wg,Kg,Zl),us=React.useMemo(()=>wp.filter(i=>i.sessions.
length>0),[wp]),Vg=React.useMemo(()=>new Set(us.flatMap(i=>i.sessions.map(je))),[us]),Yg=React.useCallback(()=>{let i=Ot.
current,g=d?i?.querySelector(`[data-session-id="${CSS.escape(d)}"]`):null;en.current=g?{sessionId:d,top:g.getBoundingClientRect().
top}:null,kp()},[d,kp]),Mt=ur.trim().toLowerCase(),Sp=React.useMemo(()=>Object.fromEntries(Pe.map(i=>{let g=je(i),$=Qi(i,
V[g]);return[g,[tc(i,g,V[g],t[g]||[]),Xi(i,g,V[g]),hi[g]||"Unscoped",xt[g]?.pinned?"Pinned":"",$.name,i?.agent_type,i?.workspace_name,
i?.workspace_path,g].filter(Boolean).join(" ").toLowerCase()]})),[Pe,V,t,hi,xt]),Ba=React.useCallback(i=>Mt?i.filter(g=>(Sp[je(
g)]||"").includes(Mt)):i,[Mt,Sp]),gi=React.useMemo(()=>Ba(Bn),[Ba,Bn]),_i=React.useMemo(()=>Ba(Fn),[Ba,Fn]),bi=React.useMemo(
()=>Ba(Ls),[Ba,Ls]),Np=React.useMemo(()=>us.map(i=>({...i,sessions:Ba(i.sessions)})).filter(i=>i.sessions.length>0),[Ba,
us]),xp=React.useMemo(()=>[...Bn,...Fn,...Ls,...us.flatMap(i=>i.sessions)],[Bn,Fn,Ls,us]),tu=React.useMemo(()=>{let i=new Set;
return Pe.filter(g=>{let $=je(g);return!$||i.has($)?!1:(i.add($),!0)})},[Pe]),Cp=React.useMemo(()=>new Set(tu.map(je)),[
tu]),Xg=React.useMemo(()=>{let i=new Map,g=($,N)=>{for(let q of $){let K=je(q);K&&!i.has(K)&&i.set(K,N)}};g(Bn,"working"),
g(Fn,"recent"),g(Ls,"pinned");for(let $ of us)g($.sessions,`workspace:${$.key}`);return i},[Bn,Fn,Ls,us]),nu=React.useMemo(
()=>[`working:${Bn.map(je).join(",")}`,`recent:${Fn.map(je).join(",")}`,`pinned:${Ls.map(je).join(",")}`,...us.map(i=>`${i.
key}:${i.sessions.map(je).join(",")}`),`collapsed:${Object.keys(x).filter(i=>x[i]).sort().join(",")}`,`filter:${Mt}`].join(
"|"),[Bn,Fn,Ls,us,x,Mt]),Ap=`${nu}${d||""}`;gp.current!==Ap&&(gp.current=Ap,Jl.current+=1);let Cc=React.useCallback((i,g,$,N={})=>{
if(!i)return!1;let q=Math.max(0,i.scrollHeight-i.clientHeight),K=Math.max(0,Math.min(Number(g)||0,q)),Y=i.scrollTop;return Math.
abs(Y-K)<.5?!0:Ql.current?!1:(Ql.current=!0,fi.current&&cancelAnimationFrame(fi.current),fi.current=requestAnimationFrame(
()=>{Ql.current=!1,fi.current=0}),wc.current={target:K},Jd(i,K,{container:"sidebar",writer:"sidebar-scroll-coordinator",
reason:$,interactionEpoch:Wt.current,sessionId:d,anchorId:N.anchorSessionId||null,anchorOffset:N.anchorOffset,payloadGeneration:Jl.
current}),i.dispatchEvent(new CustomEvent("rac-sidebar-scroll-correction",{detail:{from:Y,to:i.scrollTop,reason:$,anchorSessionId:N.
anchorSessionId||null,explicitSort:N.explicitSort===!0,interactionEpoch:Wt.current,payloadGeneration:Jl.current}})),mi.current&&
cancelAnimationFrame(mi.current),mi.current=requestAnimationFrame(()=>{wc.current=null,mi.current=null}),!0)},[d,nu]),Fa=we(
new Map),Ac=we(null),Qg=React.useCallback((i,g)=>{let $=Ot.current;if(!$)return null;ja.current&&(cancelAnimationFrame(ja.
current),ja.current=null),$.classList.add("sidebar-structural-transaction");let N=document.activeElement,q=N instanceof Element?
N.closest("[data-sidebar-card-host]"):null,K=$.getBoundingClientRect(),Y=Array.from($.querySelectorAll("[data-session-id\
]")),le=N instanceof Element?N.closest("[data-session-id]"):null,Ne=Y.filter(Xe=>{let Cn=Xe.getBoundingClientRect();return Cn.
bottom>K.top&&Cn.top<K.bottom}),Ve=[...le&&Ne.includes(le)?[le]:[],...Ne.filter(Xe=>Xe!==le)].map(Xe=>({sessionId:Xe.dataset.
sessionId,top:Xe.getBoundingClientRect().top})),Ht=$.scrollTop,Kt=[];for(let[Xe,Cn]of i){let gs=g.get(Xe);if(!gs||gs===Cn)
continue;let sn=Fa.current.get(Xe);sn&&Kt.push(sn)}if(Kt.length>0){let Xe=Ac.current;Xe||(Xe=document.createElement("div"),
Xe.setAttribute("data-sidebar-card-pool",""),Object.assign(Xe.style,{position:"fixed",left:"-10000px",top:"-10000px",width:"\
1px",height:"1px",overflow:"hidden",pointerEvents:"none"}),document.body.appendChild(Xe),Ac.current=Xe);for(let Cn of Kt){
let gs=Cn.closest("[data-sidebar-card-slot]");if(gs){let sn=Cn.querySelector("[data-session-id]"),Po=sn?getComputedStyle(
sn):null,Uc=sn?sn.getBoundingClientRect().height+(Number.parseFloat(Po?.marginTop)||0)+(Number.parseFloat(Po?.marginBottom)||
0):0;gs.style.display="block",gs.style.height=`${Uc}px`,gs.setAttribute("data-sidebar-card-placeholder","")}Xe.appendChild(
Cn)}}return q&&N?.isConnected&&document.activeElement!==N&&N.focus({preventScroll:!0}),{candidates:Ve,scrollTop:Ht,interactionEpoch:Wt.
current,focusedElement:q?N:null,focusedHost:q,movedHostCount:Kt.length}},[]),Jg=React.useCallback(i=>{let g=Ot.current;if(!g)
return;let $=i?.focusedElement||document.activeElement,N=i?.focusedHost||($ instanceof Element?$.closest("[data-sidebar-\
card-host]"):null),q=new Set;for(let le of g.querySelectorAll("[data-sidebar-card-slot]")){let Ne=le.getAttribute("data-\
sidebar-card-slot")||"",Ze=Fa.current.get(Ne);if(!(!Ne||!Ze)&&(q.add(Ne),Ze.parentElement!==le)){let We=N===Ze&&$?.isConnected;
le.appendChild(Ze),We&&document.activeElement!==$&&$.isConnected&&$.focus({preventScroll:!0})}}let K=en.current,Y=K?{candidates:[
K],scrollTop:g.scrollTop,interactionEpoch:Wt.current}:i;if(Y&&Y.interactionEpoch===Wt.current){let Ne=(Array.isArray(Y.candidates)?
Y.candidates:[]).map(Ve=>({...Ve,card:Array.from(g.querySelectorAll("[data-session-id]")).find(Ht=>Ht.dataset.sessionId===
Ve.sessionId)})).find(Ve=>Ve.card),Ze=null,We=null;if(Ne){let Ve=Ne.card.getBoundingClientRect().top-Ne.top;Math.abs(Ve)>
.5&&(Ze=g.scrollTop+Ve),We=Ne.sessionId}else Number.isFinite(Y.scrollTop)&&(Ze=Y.scrollTop);if(Ze!=null){let Ve=Math.max(
0,Math.min(Ze,Math.max(0,g.scrollHeight-g.clientHeight)));Math.abs(g.scrollTop-Ve)>.5&&Cc(g,Ve,K?"operator-sidebar-sort-\
anchor":"sidebar-structure-anchor",{anchorSessionId:We,anchorOffset:Ne?.top,explicitSort:!!K})}}en.current=null;for(let[
le,Ne]of Fa.current)q.has(le)||Cp.has(le)||(Ne.remove(),Fa.current.delete(le));i?.focusedElement?.isConnected&&document.
activeElement!==i.focusedElement&&i.focusedElement.focus({preventScroll:!0}),ja.current=requestAnimationFrame(()=>{ja.current=
requestAnimationFrame(()=>{g.classList.remove("sidebar-structural-transaction"),ja.current=null})})},[Cp,Cc]),Sr=React.useCallback(
()=>{let i=Ot.current;if(!i)return null;let g=i.getBoundingClientRect(),$=Array.from(i.querySelectorAll("[data-session-i\
d]")).find(q=>{let K=q.getBoundingClientRect();return K.bottom>g.top+1&&K.top<g.bottom-1})||null,N=$?{sessionId:$.dataset.
sessionId||null,offset:$.getBoundingClientRect().top-g.top,interactionEpoch:Wt.current}:null;return hp.current=N,N},[]);
React.useLayoutEffect(()=>{let i=Ot.current;if(!i||typeof ResizeObserver>"u")return;Sr();let g=0,$=()=>{g||(g=requestAnimationFrame(
()=>{g=0;let Y=hp.current;if(!Y||Y.interactionEpoch!==Wt.current){Sr();return}let le=Ot.current,Ne=le&&Array.from(le.querySelectorAll(
"[data-session-id]")).find(Ve=>Ve.dataset.sessionId===Y.sessionId);if(!le||!Ne){Sr();return}let We=Ne.getBoundingClientRect().
top-le.getBoundingClientRect().top-Y.offset;Math.abs(We)>.5&&Cc(le,le.scrollTop+We,"sidebar-row-resize-anchor",{anchorSessionId:Y.
sessionId,anchorOffset:Y.offset}),Sr()}))},N=new ResizeObserver($),q=Y=>{Y?.nodeType===1&&Y.matches?.("[data-session-id]\
, .session-group-header, .sidebar-order-control")&&N.observe(Y),Y?.nodeType===1&&Y.querySelectorAll?.("[data-session-id]\
, .session-group-header, .sidebar-order-control").forEach(le=>N.observe(le))};Array.from(i.children).forEach(q);let K=new MutationObserver(
Y=>{Y.forEach(le=>{Array.from(le.removedNodes||[]).forEach(Ne=>{Ne?.nodeType===1&&N.unobserve(Ne)}),Array.from(le.addedNodes||
[]).forEach(q)}),$()});return K.observe(i,{childList:!0,subtree:!0}),()=>{K.disconnect(),N.disconnect(),g&&cancelAnimationFrame(
g)}},[Sr,Cc]),$e(()=>()=>{for(let i of Fa.current.values())i.remove();Fa.current.clear(),Ac.current?.remove(),Ac.current=
null,en.current=null},[]);let Nr=React.useCallback(i=>i.reduce((g,$)=>{let N=je($);return g.unread+=qe.has(N)?0:u[N]||0,
g.hasPrompt=g.hasPrompt||!!h[N]||!!Yi(C[N]),g.working=g.working||Ir(vt[N]),g},{unread:0,hasPrompt:!1,working:!1}),[qe,u,
h,C,vt]),wo=React.useMemo(()=>Nr(gi),[Nr,gi]),yi=React.useMemo(()=>Nr(_i),[Nr,_i]),vi=React.useMemo(()=>Nr(bi),[Nr,bi]),
ia=React.useMemo(()=>xp.map(i=>{let g=je(i),$=Qi(i,V[g]),N=tc(i,g,V[g],t[g]||[]),q=Xi(i,g,V[g]),K=hi[g]||"Unscoped",Y=[N,
q,K,xt[g]?.pinned?"Pinned":"",$.name,i?.agent_type,i?.workspace_name,i?.workspace_path,g].filter(Boolean);return{id:g,session:i,
groupLabel:K,title:N,subtitle:q,agentName:$.name,agentColor:$.color,working:Ir(vt[g]),searchFields:Y,searchText:Y.join("\
 ")}}),[xp,hi,xt,V,t,vt]),tn=React.useMemo(()=>Ew(ia,$a).slice(0,60),[ia,$a]);$e(()=>{Ct(i=>Math.max(0,Math.min(i,tn.length-
1)))},[tn.length]),$e(()=>{if(!ts)return;let i=requestAnimationFrame(()=>{y.current?.focus(),y.current?.select()});return()=>cancelAnimationFrame(
i)},[ts]),$e(()=>{ts&&document.getElementById(`quick-switcher-option-${Gt}`)?.scrollIntoView({block:"nearest"})},[Gt,ts]),
$e(()=>{let i=()=>{or(!1),ai(""),Ct(0),requestAnimationFrame(()=>ds.current?.focus())},g=N=>{N&&(Is(N.id,N.session),Et(!1),
i())},$=N=>{let q=ce(N.key).toLowerCase();if((N.metaKey||N.ctrlKey)&&!N.altKey&&q==="p"){N.preventDefault(),na(!1),or(!0);
return}if(ts){N.key==="Escape"?(N.preventDefault(),i()):N.key==="ArrowDown"?(N.preventDefault(),Ct(K=>tn.length?(K+1)%tn.
length:0)):N.key==="ArrowUp"?(N.preventDefault(),Ct(K=>tn.length?(K-1+tn.length)%tn.length:0)):N.key==="Enter"&&tn.length>
0&&(N.preventDefault(),g(tn[Gt]||tn[0]));return}if(cr){(N.key==="Escape"||N.key==="?"&&!Zd(N.target))&&(N.preventDefault(),
na(!1),requestAnimationFrame(()=>ds.current?.focus()));return}if(N.altKey&&!N.ctrlKey&&!N.metaKey&&(N.key==="ArrowUp"||N.
key==="ArrowDown")){if(ia.length===0)return;N.preventDefault();let K=ia.findIndex(Ze=>Ze.id===d),Y=N.key==="ArrowDown"?1:
-1,le=Y>0?-1:0,Ne=(Math.max(K,le)+Y+ia.length)%ia.length;g(ia[Ne]);return}N.key==="?"&&!N.altKey&&!N.ctrlKey&&!N.metaKey&&
!Zd(N.target)&&(N.preventDefault(),na(!0))};return window.addEventListener("keydown",$),()=>window.removeEventListener("\
keydown",$)},[d,Gt,ia,ts,tn,cr]);let B=React.useMemo(()=>Pe.find(i=>je(i)===d),[Pe,d]),nt=B?.agent_type==="codex-desktop"&&
d&&E[d]||null,lt=!!(nt?.view_state&&nt.view_state!=="native_active"),xr=nt?.view_state==="archive",su=nt?.view_state==="\
loading",ko=!!B?.is_new_chat_draft,wi=!La&&!Oa&&!Ia&&!ra&&!Pa&&!qa,au=React.useMemo(()=>{let i=nt?.thread_id||is[d],g=(H[d]||
[]).find(q=>q?.active),$=g?.cache_key||g?.id,N=Ea[d]||ko?"draft":"";return`${d||"none"}:${nt?.view_state||"native"}:${N||
i||$||"default"}`},[d,nt?.thread_id,nt?.view_state,H,is,Ea,ko]),Ha=d?Ul:Xh,fn=d&&!lt&&n[d]||null,Mp=Yf(B,Ha),xn=d&&!lt?k[d]:
null,Zg=d&&!lt&&v[d]||"",oa=d&&!lt&&h[d]||null,Mc=d&&!lt&&C[d]||null,e_=[d||"",fn?.messageId||"",fn?.content?.length||0,
xn?.kind||"",xn?.thinking?.native_source_id||"",xn?.thinking?.text||Zg||"",xn?.current?.native_source_id||"",xn?.current?.
text||xn?.current?.content||"",xn?.step?.native_source_id||xn?.step?.id||"",xn?.step?.text||xn?.step?.label||"",oa?.prompt_id||
oa?.id||"",Mc?.request_id||Mc?.id||""].join(""),Cr={sessionId:d,messageCount:Ha.length,provisionalId:fn?.messageId||"",
provisionalLength:fn?.content?.length||0},t_=we(null),hn=we(null),Rc=we(!0),Rt=we(!0),gn=we(!1),So=we(0),ru=we(0),iu=we(
0),ou=we(0),Rp=we(""),Tc=we(!1),Ar=we(0),$c=we(null),No=we(0),xo=we(0),cu=we(null),lu=we(null),n_=we({activeSemanticKey:"",
lastClearedSemanticKey:"",clearedAt:0}),ki=we(d),Tp=we(d),ca=we({sessionId:null,keys:[],scrollTop:0,scrollHeight:0,clientHeight:0,
atBottom:!0}),Si=we(null),Co=we(0),ds=we(null),uu=we(()=>!1),la=we(null),s_=we(null),du=we(Cr),pu=we(Cr),Os=we({}),ua=we(
{sessionId:null,index:0,scratch:""}),mu=we(o),fu=we({}),$p=we({});du.current=Cr;let Ep=[d||"",Cr.messageCount,Cr.provisionalId,
Cr.provisionalLength,oa?.prompt_id||oa?.id||oa?.request_id||"",oa?.generation||"",Mc?.id||Mc?.request_id||"",xn?.kind||"",
xn?.thinking?.native_source_id||"",xn?.current?.native_source_id||""].join("");Rp.current!==Ep&&(Rp.current=Ep,ou.current+=
1),uu.current=()=>gn.current||!!oa||Date.now()<So.current,la.current=(i,g,$,N={})=>{if(!i)return!1;let q=String($||"unsp\
ecified"),K=N.allowWhenUserOwned===!0,Y=N.allowDuringPrompt===!0;if(gn.current&&!K||Date.now()<So.current&&!K||oa&&!Y&&!K)
return!1;if(N.releaseUserOwnership===!0)gn.current=!1,Rt.current=!0;else if(N.takeUserOwnership===!0){let Xe=i.scrollHeight-
Number(g||0)-i.clientHeight;gn.current=Xe>=80,Rt.current=Xe<80}let le=i.scrollTop,Ne=Math.max(0,i.scrollHeight-i.clientHeight),
Ze=Rt.current&&!gn.current,We=/^(?:operator-|route-|genuine-prompt)/.test(q),Ve=Ze&&!We?i.scrollHeight:g,Ht=Math.max(0,Math.
min(Number(Ve)||0,Ne));if(Math.abs(le-Ht)<.5)return!0;if(Tc.current)return $c.current={element:i,value:g,reason:q,options:N},
!0;Tc.current=!0,Ar.current&&cancelAnimationFrame(Ar.current),Ar.current=requestAnimationFrame(()=>{Tc.current=!1,Ar.current=
0;let Xe=$c.current;$c.current=null,Xe?.element?.isConnected&&la.current?.(Xe.element,Xe.value,Xe.reason,Xe.options)}),ru.
current=Date.now()+800,Jd(i,Ht,{container:"transcript",writer:"transcript-scroll-coordinator",reason:q,interactionEpoch:iu.
current,sessionId:ki.current,anchorId:N.anchorId||null,anchorOffset:N.anchorOffset,payloadGeneration:ou.current});let Kt=typeof window<
"u"?window.__RAC_TEMPORAL_CANARY__:null;if(Kt?.active){let Xe=Kt.transcriptScrollWrites||(Kt.transcriptScrollWrites=[]);
Xe.length<1e4&&Xe.push({at_epoch_ms:Date.now(),session_id:ki.current,reason:q,from:le,requested:Ht,user_owned:gn.current,
interaction_epoch:iu.current,payload_generation:ou.current})}return!0},Us(()=>{ki.current=d},[d]),Us(()=>{let i=Object.values(
En||{});if(i.length===0)return;let g=($,N,q,K=(Y,le)=>Y??le)=>{$(Y=>{if(!Y||!Object.prototype.hasOwnProperty.call(Y,N))return Y;
let le={...Y};return le[q]=K(le[q],le[N]),delete le[N],le})};for(let $ of i){let N=$?.alias_session_id,q=$?.canonical_session_id;
!N||!q||N===q||(g(co,N,q,(K,Y)=>typeof K=="string"&&K.length>0?K:Y||""),g(Rs,N,q,(K,Y)=>{let le=[...Array.isArray(K)?K:[],
...Array.isArray(Y)?Y:[]];return[...new Map(le.map(Ne=>[`${Ne?.name||""}:${Ne?.size||Ne?.content?.length||0}`,Ne])).values()]}),
g(pr,N,q,(K,Y)=>K||Y),g(fr,N,q,(K,Y)=>({...Y||{},...K||{}})),mr===N&&as(q),Ts(K=>K?.sessionId===N?{...K,sessionId:q}:K),
Os.current[N]&&(Os.current[q]=[...Os.current[q]||[],...Os.current[N]],delete Os.current[N]),ua.current.sessionId===N&&(ua.
current={...ua.current,sessionId:q}),d===N&&(ca.current={...ca.current,sessionId:q},Si.current?.sessionId===N&&(Si.current=
{...Si.current,sessionId:q}),ki.current=q,Un.current=q,yn(q)))}},[En,d,mr]),$e(()=>{let i=$=>{try{sessionStorage.setItem(
"agent-chat:last-window-error",JSON.stringify({message:$?.error?.message||$?.message||"Unknown window error",stack:$?.error?.
stack||"",at:new Date().toISOString()}))}catch{}},g=$=>{try{let N=$?.reason;sessionStorage.setItem("agent-chat:last-prom\
ise-error",JSON.stringify({message:N?.message||ce(N,"Unhandled promise rejection"),stack:N?.stack||"",at:new Date().toISOString()}))}catch{}};
return window.addEventListener("error",i),window.addEventListener("unhandledrejection",g),()=>{window.removeEventListener(
"error",i),window.removeEventListener("unhandledrejection",g)}},[]),$e(()=>{try{let i=localStorage.getItem(Uh);i&&co(JSON.
parse(i))}catch{}},[]),$e(()=>{try{localStorage.setItem(Uh,JSON.stringify(ei))}catch{}},[ei]),$e(()=>{try{localStorage.setItem(
"remote-agent-chat-theme",O)}catch{}document.documentElement.setAttribute("data-theme",O)},[O]),$e(()=>{if(!d&&Pe.length>
0){let i=new URLSearchParams(window.location.search).get("session"),g=En?.[i]?.canonical_session_id||i,$=g?Pe.find(K=>je(
K)===g):null,N=$||Pe[0],q=je(N);q&&(Is(q,N),$&&window.history.replaceState({},"",window.location.pathname))}},[Pe,d,En]),
$e(()=>{if(!("serviceWorker"in navigator))return;let i=g=>{if(g.data?.type!=="push_notification_clicked")return;let $=g.
data.data?.session_id,N=En?.[$]?.canonical_session_id||$,q=Pe.find(K=>je(K)===N);N&&q&&Is(N,q)};return navigator.serviceWorker.
addEventListener("message",i),()=>navigator.serviceWorker.removeEventListener("message",i)},[Pe,En]),$e(()=>{if(!b)return;
let i=Pe.find(g=>(typeof g=="string"?g:g?.session_id)===b);i&&(Is(b,i),w(null))},[b,Pe]),$e(()=>{let i=hn.current;if(!i)
return;let g=Tp.current!==d;Tp.current=d,g&&(gn.current=!1,Rt.current=!0);let $=null,N=(We=!0)=>{So.current=Date.now()+1200,
iu.current+=1,ru.current=0,No.current+=1,We&&(gn.current=!0),Rt.current&&(pu.current=du.current,oi(0))},q=We=>{if(Math.abs(
We.deltaY)<=1)return;let Ve=i.scrollHeight-i.scrollTop-i.clientHeight<80;N(We.deltaY<0||!Ve)},K=We=>{let Ve=i.getBoundingClientRect();
We.clientX>=Ve.right-16&&N()},Y=We=>{$=We.touches?.[0]?.clientY??null},le=We=>{let Ve=We.touches?.[0]?.clientY??null;if($!=
null&&Ve!=null&&Math.abs(Ve-$)>4){let Ht=i.scrollHeight-i.scrollTop-i.clientHeight<80;N(Ve>$||!Ht)}},Ne=We=>{if(!We.target?.
closest?.('textarea, input, [contenteditable="true"]')&&["ArrowUp","ArrowDown","PageUp","PageDown","Home","End"," "].includes(
We.key)){let Ht=i.scrollHeight-i.scrollTop-i.clientHeight<80,Kt=["ArrowUp","PageUp","Home"].includes(We.key);N(Kt||!Ht)}},
Ze=()=>{let We=i.scrollHeight-i.scrollTop-i.clientHeight<80,Ve=Date.now(),Ht=Ve<So.current,Kt=Ve<ru.current;Rc.current=We,
We?(Rt.current=!0,Ht&&!Kt&&(gn.current=!1)):Ht&&!Kt&&(Rt.current=!1,gn.current=!0,xo.current=0),Ht&&!Kt&&i.scrollTop<160&&
cu.current?.(),ii(!We&&!Rt.current),ca.current={...ca.current,scrollTop:i.scrollTop,scrollHeight:i.scrollHeight,clientHeight:i.
clientHeight,atBottom:We||Rt.current}};return i.addEventListener("scroll",Ze,{passive:!0}),i.addEventListener("wheel",q,
{passive:!0}),i.addEventListener("touchstart",Y,{passive:!0}),i.addEventListener("touchmove",le,{passive:!0}),i.addEventListener(
"pointerdown",K,{passive:!0}),window.addEventListener("keydown",Ne),()=>{i.removeEventListener("scroll",Ze),i.removeEventListener(
"wheel",q),i.removeEventListener("touchstart",Y),i.removeEventListener("touchmove",le),i.removeEventListener("pointerdow\
n",K),window.removeEventListener("keydown",Ne),Ar.current&&(cancelAnimationFrame(Ar.current),Ar.current=0),Tc.current=!1,
$c.current=null}},[d,au,wi]);function hu(i,g=0,{operatorInitiated:$=!1}={}){let N=d,q=No.current+1;No.current=q;let K=()=>{
let Ne=hn.current;return!Ne||ki.current!==N||No.current!==q||!la.current?.(Ne,Ne.scrollHeight,$?"operator-jump-to-live-e\
dge":"live-edge-pin",$?{allowWhenUserOwned:!0,releaseUserOwnership:!0}:{})?!1:(Rt.current=!0,pu.current=du.current,Rc.current=
!0,ii(!1),oi(0),ca.current={sessionId:N,keys:i,scrollTop:Ne.scrollTop,scrollHeight:Ne.scrollHeight,clientHeight:Ne.clientHeight,
atBottom:!0},!0)};K();let Y=Math.max(0,g),le=()=>{Y<=0||(Y-=1,K()&&requestAnimationFrame(le))};Y>0&&requestAnimationFrame(
le)}function a_(){if(!hn.current)return;let g=Qh(Ha);xo.current=Date.now()+5e3,hu(g,2,{operatorInitiated:!0})}Us(()=>{let i=hn.
current;if(!i)return;let g=Qh(Ha),$=ca.current||{},N=$.sessionId===d,q=Array.isArray($.keys)?$.keys:[],K=q[0]||null,Y=q[q.
length-1]||null,le=K?g.indexOf(K):-1,Ne=Y?g.indexOf(Y):-1,Ze=!!(N&&g.length===q.length&&g.every((gs,sn)=>gs===q[sn])),We=(Number(
$.scrollHeight)||0)-(Number($.scrollTop)||0)-(Number($.clientHeight)||0),Ve=Date.now()<xo.current,Ht=Ve||Rt.current||$.atBottom!==
!1||We<120,Kt=!!(N&&q.length&&le>0&&Ne>=le);if(!uu.current()){if(!(Ze&&!Ve))if(!N)bo(null),gn.current=!1,Rt.current=!0,hu(
g,1);else if(Kt){if(Rt.current=!1,xo.current=0,i.dataset.transcriptWindowed!=="true"){let gs=i.scrollHeight-(Number($.scrollHeight)||
0),sn=lu.current,Po=sn?Array.from(i.querySelectorAll(".message[data-message-key]")).find(gm=>gm.dataset.messageKey===sn.
messageKey):null,Uc=Math.max(0,(Number($.scrollTop)||0)+gs),hm="history-prepend-compensation";if(Po){let _m=Po.getBoundingClientRect().
top-sn.viewportTop;Math.abs(_m)>=.5&&(Uc=Math.max(0,i.scrollTop+_m),hm="history-prepend-anchor-correction")}la.current?.(
i,Uc,hm,{anchorId:sn?.messageKey||null,anchorOffset:sn?.viewportTop}),lu.current=null}}else Ht&&hu(g)}let Cn=i.scrollHeight-
i.scrollTop-i.clientHeight<80;Rc.current=Cn,ii(!Cn&&!Rt.current),oi(Cn||Rt.current?0:Lw(pu.current,Cr)),ca.current={sessionId:d,
keys:g,scrollTop:i.scrollTop,scrollHeight:i.scrollHeight,clientHeight:i.clientHeight,atBottom:Cn||Rt.current}},[d,Ha]),React.
useLayoutEffect(()=>{let i=hn.current;!i||gn.current||!Rt.current||oa||la.current?.(i,i.scrollHeight,"live-edge-semantic\
-geometry")},[d,e_]),$e(()=>{d&&oe(d)},[d]),$e(()=>{uo(i=>{let g=Object.keys(i).filter(N=>!f[N]);if(g.length===0)return i;
let $={...i};return g.forEach(N=>delete $[N]),$})},[f]),$e(()=>{let i=Object.entries(pn).filter(([,N])=>Tn[N]),g=Object.
entries(aa).filter(([,N])=>Tn[N]);if(i.length>0){let N=new Set(i.map(([q])=>q));uo(q=>Object.fromEntries(Object.entries(
q).filter(([K])=>!N.has(K))))}if(g.length>0){let N=new Set(g.map(([q])=>q));gr(q=>Object.fromEntries(Object.entries(q).filter(
([K])=>!N.has(K))));for(let[q,K]of g){let Y=ri.current.get(K);if(!Y)continue;let le=Tn[K];if(ri.current.delete(K),le?.result===
"ok")za(q,Ne=>String(Ne||"").trim().toLowerCase()===Y.command?"":Ne),_r(Ne=>({...Ne,[q]:{status:"success",requestId:K,text:Y.
action==="pause"?"Goal paused":"Goal resumed"}})),dt(Y.action==="pause"?"Goal paused":"Goal resumed");else{let Ne=le?.error?.
message||"Native goal control did not apply.";_r(Ze=>({...Ze,[q]:{status:"failed",requestId:K,text:`${Ne} Command retain\
ed; press Send to retry.`}}))}}}let $=[...i,...g].map(([,N])=>Tn[N]).find(N=>N?.result==="failed");$&&dt($.error?.message||
($.command==="agent_interrupt"?"Interrupt did not apply":"Goal control did not apply"))},[Tn,pn,aa]),$e(()=>{!mu.current&&
o&&dt("Reconnected"),mu.current&&!o&&dt("Disconnected \u2014 reconnecting..."),mu.current=o},[o]);function dt(i){fc(i),setTimeout(
()=>fc(""),3e3)}function r_(i){let g=Pe.find($=>je($)===i);return g?tc(g,i,V[i],t[i]||[]):i}function Lp(i,g,$,N=""){_t.current&&
clearTimeout(_t.current),Ts({sessionId:i,kind:g,title:$,detail:N||r_(i)}),_t.current=setTimeout(()=>{_t.current=null,Ts(
null)},8e3)}function Op(){_t.current&&clearTimeout(_t.current),_t.current=null,Ts(null)}$e(()=>()=>{_t.current&&clearTimeout(
_t.current)},[]),$e(()=>{let i=Ma.current,g=h||{},$=Object.keys(i).filter(N=>!g[N]);$.length>0&&(pr(N=>{let q={...N};return $.
forEach(K=>{q[K]?.kind==="prompt"&&delete q[K]}),q}),Ts(N=>N?.kind==="prompt"&&$.includes(N.sessionId)?null:N)),Object.entries(
g).forEach(([N,q])=>{let K=q?.prompt_id||q?.request_id||q?.id||"prompt",Y=i[N],le=Y?.prompt_id||Y?.request_id||Y?.id||null;
if(K===le||(Ra.current&&sa.completion_sound&&vg(N,d)&&yg("prompt"),N===d))return;let Ne=q?.type==="question_prompt"||q?.
kind==="question"?"Question needs an answer":"Permission needs attention";pr(Ze=>({...Ze,[N]:{kind:"prompt",promptId:K}})),
Lp(N,"prompt",Ne)}),Ma.current=g,Ra.current=!0},[h,d,sa.completion_sound]),$e(()=>{!d||Sn?.sessionId!==d||(_t.current&&clearTimeout(
_t.current),_t.current=null,Ts(null))},[d,Sn?.sessionId]),$e(()=>{if(!Zt||!hr)return;let i=!1;async function g(){for(let $ of Ns||
[]){let N=$.session_id||$.session;if(!bf($,sa)){Pr($,"suppressed",{reasonCode:"client_preference"});continue}if(xt[N]?.muted){
Pr($,"suppressed",{reasonCode:"session_muted"});continue}if(!vg(N,d)){Pr($,"suppressed",{reasonCode:"focused_session"});
continue}let q=await yf($);if(i)continue;if(!q){Pr($,"suppressed",{reasonCode:"client_duplicate"});continue}Pr($,"claime\
d");let K=$.event_type;sa.completion_sound&&yg(K==="goal_attention"||K==="provider_usage_threshold"?"prompt":"completion"),
N!==d&&pr(le=>({...le,[N]:{kind:K,dedupeKey:$.dedupe_key,createdAt:$.created_at||new Date().toISOString()}})),Lp(N,K,$.title,
$.body),(typeof requestAnimationFrame=="function"?requestAnimationFrame:le=>setTimeout(le,16))(()=>{i||Pr($,"displayed")})}}
return g().catch(()=>{}),()=>{i=!0}},[Ns,d,xt,sa,Zt,hr]);function za(i,g){i&&co($=>({...$,[i]:typeof g=="function"?g($[i]||
""):g}))}function gu(i,g){i&&Rs($=>{let N={...$};if(g===null)return delete N[i],N;let q=N[i]||[];return Array.isArray(g)?
N[i]=g:N[i]=[...q,g],N})}function i_(i,g){i&&Rs($=>{let N={...$},q=[...N[i]||[]];return q.splice(g,1),q.length===0?delete N[i]:
N[i]=q,N})}async function _u(i,g,$,N){let q=await fetch("/upload",{method:"POST",headers:{"Content-Type":"application/js\
on"},body:JSON.stringify({filename:N,content:g,mimeType:$})});if(!q.ok)throw new Error("Upload failed");let{url:K}=await q.
json();return gu(i,{name:N,url:K,isText:!1,mimeType:$}),K}function Ip(i,g,$,N){let q=He(i,g,$,N);return fu.current[q]={sessionId:i,
filename:N,mimeType:$,base64:g,createdAt:Date.now()},dt(`Sending image to Codex: ${N}`),q}$e(()=>{let i=Object.entries(Tn||
{});for(let[g,$]of i){if(!g.startsWith("attach-")||$p.current[g])continue;$p.current[g]=!0;let N=fu.current[g];if(delete fu.
current[g],!!N){if($?.result==="ok"){dt(`Image attached to Codex: ${N.filename}`);continue}(async()=>{try{await _u(N.sessionId,
N.base64,N.mimeType,N.filename),dt(`Direct image attach failed \u2014 added ${N.filename} as a file link draft`)}catch{let q=$?.
error?.message||$?.error?.code||"unknown error";dt(`Image attach failed: ${q}`)}})()}}},[Tn]);function Ni(i){let g=i?.agent_type;
return{limit:nw(g),...g==="codex_cli"||g==="cursor_cli"?{chunkBytes:Zv}:{}}}function Qk(i){let g=Pe.find($=>je($)===i);return Ni(
g)}function Is(i,g){let $=Un.current===i;ws(i),yn(i),Un.current=i,ua.current={sessionId:i,index:(Os.current[i]||[]).length,
scratch:""},m(N=>({...N,[i]:0})),pr(N=>{if(!N[i])return N;let q={...N};return delete q[i],q}),Sn?.sessionId===i&&Op(),Et(
!1),dn(!1),Es(!1),$&&setTimeout(()=>oc(i,Ni(g)),0)}function o_(i){let g=i?.session_id,$=Number(i?.message_id);if(!g||!Number.
isSafeInteger($)||$<=0)return;let N=Pe.find(q=>je(q)===g)||{session_id:g,workspace_path:i.workspace_path||null,project_root:i.
project_root||null,workspace_name:i.workspace_name||null,agent_type:i.agent_type||null,status:"history"};Qe.cancelRouteRestore(),
Si.current=null,go({sessionId:g,messageId:$}),Is(g,N),Es(!1)}async function c_(i){let g=Array.from(i.target.files||[]);if(g.
length!==0){i.target.value="";for(let $ of g){if($.size>2*1024*1024){dt(`${$.name}: too large (max 2 MB)`);continue}if(km(
$.name)&&$.size<500*1024)await new Promise((N,q)=>{let K=new FileReader;K.onload=Y=>{gu(d,{name:$.name,content:Y.target.
result,isText:!0}),N()},K.onerror=()=>{dt(`Failed to read ${$.name}`),N()},K.readAsText($)});else{ti(!0);try{await new Promise(
(N,q)=>{let K=new FileReader;K.onload=async Y=>{let le=Y.target.result.split(",")[1];(U?.capabilities||{}).send_attachment&&
$.type.startsWith("image/")?Ip(d,le,$.type,$.name):(await _u(d,le,$.type,$.name),dt(`Uploaded: ${$.name}`)),N()},K.onerror=
()=>{dt(`Failed to read ${$.name}`),N()},K.readAsDataURL($)})}catch{dt(`Upload failed: ${$.name}`)}finally{ti(!1)}}}}}async function l_(i){
let $=Array.from(i.clipboardData?.items||[]).find(Y=>Y.type.startsWith("image/"));if(!$||(i.preventDefault(),!d))return;
let N=$.getAsFile();if(!N)return;if(N.size>2*1024*1024){dt("Image too large (max 2 MB)");return}let q=N.type==="image/jp\
eg"?"jpg":"png",K=`screenshot-${Date.now()}.${q}`;ti(!0);try{await new Promise(Y=>{let le=new FileReader;le.onload=async Ne=>{
let Ze=Ne.target.result.split(",")[1];(U?.capabilities||{}).send_attachment?Ip(d,Ze,N.type,K):(await _u(d,Ze,N.type,K),dt(
"Screenshot attached")),Y()},le.onerror=()=>{dt("Failed to read clipboard image"),Y()},le.readAsDataURL(N)})}catch{dt("P\
aste upload failed")}finally{ti(!1)}}function Pp(){if(Ga||lt)return;let i=d&&ei[d]||"",g=d?lr[d]||[]:[],$=i.trim();if(!$&&
g.length===0||!d)return;let N=vh(i,{attachmentCount:g.length});if(N.kind!=="chat"){d_(N);return}let q="";if(g.length>0?(q=
g.map(Y=>{if(Y.isText){let le=Ei(Y.name);return`\`${Y.name}\`
\`\`\`${le}
${Y.content}
\`\`\``}return(Y.mimeType||"").startsWith("image/")?`![${Y.name}](${Y.url})`:`[File: ${Y.name}](${Y.url})`}).join(`

`),$&&(q+=`

${$}`)):q=$,Re(d,q),$){let K=Os.current[d]||[],Y=K[K.length-1]===$?K:[...K,$].slice(-100);Os.current[d]=Y,ua.current={sessionId:d,
index:Y.length,scratch:""}}ci(K=>({...K,[d]:!1})),yr(K=>({...K,[d]:Math.min(K[d]||0,(t[d]||[]).length)})),za(d,""),gu(d,
null),dn(!1),ds.current?.focus()}function bu(){rs.current&&clearTimeout(rs.current),rs.current=null,qn.current={sessionId:null,
expiresAt:0},po(null)}function u_(){if(!d)return;let i=Date.now()+2500;qn.current={sessionId:d,expiresAt:i},po(d),rs.current&&
clearTimeout(rs.current),rs.current=setTimeout(()=>{qn.current.sessionId===d&&qn.current.expiresAt===i&&(qn.current={sessionId:null,
expiresAt:0},rs.current=null,po(null))},2500)}function yu(){if(!d||!f[d]||pn[d]){bu();return}bu(),vu(d,B)}function vu(i,g){
if(!i||pn[i])return null;let $=L(i,{sessionGeneration:g?.control_generation,turnGeneration:g?.turn_generation});return uo(
N=>({...N,[i]:$})),$}function wu(i,g,$,N,q={}){if(!i||!$||aa[i])return null;let K=P(i,g,$,{sessionGeneration:N?.control_generation,
requestId:q.requestId});return gr(Y=>({...Y,[i]:K})),K}function d_(i){if(!d)return;let g=le=>{_r(Ne=>({...Ne,[d]:{status:"\
failed",requestId:null,text:le}})),dt(le),dn(!1)};if(i.kind==="unsupported_goal_control"){g("Unsupported goal command. U\
se /goal resume or /goal pause.");return}if(!o){g("Goal control is offline. Command retained; reconnect and press Send t\
o retry.");return}if(aa[d]){g("A goal control is already applying. Command retained.");return}let $=B?.agent_type;if(!["\
codex","codex-desktop","codex_cli"].includes($)||U?.capabilities?.goal_pause_resume!==!0||!Ka?.fingerprint||Number(B?.control_generation)<=
0){g("This session has no verified native goal control. Command retained.");return}let N=wh(i.action,Va);if(N){za(d,""),
_r(le=>({...le,[d]:{status:"success",requestId:null,text:N}})),dt(N),dn(!1);return}if(i.action==="resume"&&Va==="blocked"&&
U?.capabilities?.goal_blocked_resume!==!0){g("Blocked-goal resume is not verified for this session. Command retained.");
return}if(!(i.action==="pause"?Va==="active":["paused","blocked"].includes(Va))){g(`Goal state is ${Va||"unknown"}; refr\
esh before retrying this command.`);return}let K=`goal-slash-${i.action}-${Date.now()}-${Math.random().toString(36).slice(
2,8)}`;if(ri.current.set(K,{action:i.action,command:i.command}),_r(le=>({...le,[d]:{status:"applying",requestId:K,text:"\
Validating goal, then applying native control\u2026"}})),!wu(d,i.action,Ka,B,{requestId:K})){ri.current.delete(K),g("Goa\
l control could not be queued. Command retained; press Send to retry.");return}dn(!1)}$e(()=>()=>{rs.current&&clearTimeout(
rs.current)},[]),$e(()=>{br&&(br!==d||!f[br])&&bu()},[d,f,br]);function p_(i){if((i.metaKey||i.ctrlKey)&&i.key.toLowerCase()===
"k"){i.preventDefault(),ds.current?.focus();return}if(i.key==="Escape"){if(Ta){dn(!1);return}if(Ga)return;Ec&&!xi&&(i.preventDefault(),
qn.current.sessionId===d&&qn.current.expiresAt>=Date.now()?yu():u_());return}if(i.key==="Enter"&&!i.shiftKey&&qn.current.
sessionId===d&&qn.current.expiresAt>=Date.now()){i.preventDefault(),yu();return}let g=d?Os.current[d]||[]:[],$=ua.current,
N=$.sessionId===d&&$.index>=0&&$.index<g.length;if(i.key==="ArrowUp"&&g.length>0&&(Ps===""||N)){i.preventDefault();let q=$.
sessionId===d?$:{sessionId:d,index:g.length,scratch:Ps};q.index=Math.max(0,q.index-1),ua.current=q,za(d,g[q.index]);return}
if(i.key==="ArrowDown"&&N){i.preventDefault();let q=Math.min(g.length,$.index+1);ua.current={...$,index:q},za(d,q===g.length?
$.scratch:g[q]);return}if(i.key==="Tab"&&Ta&&Ic.length>0){i.preventDefault(),fm(Ic[0].command);return}i.key==="Enter"&&!i.
shiftKey&&(i.preventDefault(),Pp())}let Ec=d&&!lt?!!f[d]:!1,xi=d?!!pn[d]:!1,Ps=d&&ei[d]||"",ku=d?lr[d]||[]:[],Ao=React.useCallback(
()=>{let i=ds.current;if(!i)return;let g=Math.max(42,Math.floor(window.innerHeight*.4));i.style.height="auto";let $=Math.
max(42,Math.min(i.scrollHeight,g));i.style.height=`${$}px`,i.style.overflowY=i.scrollHeight>g?"auto":"hidden"},[]);Us(()=>{
Ao()},[d,Ps,Ao]),$e(()=>(window.addEventListener("resize",Ao),()=>window.removeEventListener("resize",Ao)),[Ao]);let Mr=Ha,
qp=d&&Ea[d]&&ho[d]||0,st=React.useMemo(()=>{let i=Math.min(qp,Mr.length);return i<=0?Mr:i>=Mr.length?Xh:Mr.slice(i)},[Mr,
qp]),ps=React.useMemo(()=>st.filter(i=>lw(i)),[st]),Qe=Kw({messages:ps,containerRef:hn,sessionId:d,routeActive:wi,suppressProgrammaticScrollRef:uu,
scrollCoordinatorRef:la}),Ua=React.useCallback(()=>{let i=hn.current;if(!i)return;let g=i.scrollHeight-i.scrollTop-i.clientHeight<
80;Si.current={sessionId:d,scrollTop:i.scrollTop,scrollHeight:i.scrollHeight,clientHeight:i.clientHeight,atBottom:g},Qe.
prepareForRouteChange()},[d,Qe.prepareForRouteChange]);Us(()=>{if(!wi||Qe.enabled)return;let i=Si.current;if(!hn.current||
i?.sessionId!==d)return;let $=()=>{let N=hn.current;if(!N||i.sessionId!==d)return;let q=i.atBottom?N.scrollHeight:Math.min(
i.scrollTop,Math.max(0,N.scrollHeight-N.clientHeight));la.current?.(N,q,"route-scroll-restore",{allowWhenUserOwned:!0,retainUserOwnership:!0})};
return $(),Co.current=requestAnimationFrame(()=>{Co.current=0,$()}),()=>{Co.current&&cancelAnimationFrame(Co.current),Co.
current=0}},[d,wi,Qe.enabled]),$e(()=>{if(Ug)return window.__RAC_TRANSCRIPT_WINDOW__={total:ps.length,messageKeys:ps.map(
(i,g)=>Ll(i,g)),scrollToIndex:Qe.scrollToIndex},()=>{window.__RAC_TRANSCRIPT_WINDOW__?.scrollToIndex===Qe.scrollToIndex&&
delete window.__RAC_TRANSCRIPT_WINDOW__}},[ps,Qe.scrollToIndex]);let jt=d&&!lt&&h[d]||null,Mo=d&&!lt&&C[d]||null,qs=Yi(Mo)?
Mo:null,Dp=Mo&&!Yi(Mo)?Mo:null,Ga=jt||qs,Ci=React.useMemo(()=>rw(d,jt),[d,jt]),jp=jt?jt.type==="question_prompt"?"Questi\
on required":"Permission required":qs?ce(qs.title,"Action required"):null,Lc=jt?Ci||[d,jt.type||"prompt",jt.prompt_id||jt.
request_id||jt.id||"unknown",jt.generation||B?.turn_generation||"legacy"].join("\0"):qs?[d,"error",qs.prompt_id||qs.request_id||
qs.id||"unknown",qs.generation||B?.turn_generation||"legacy"].join("\0"):"";Us(()=>{Ge(i=>Ki(i,{session_id:d,pane_id:"na\
tive-action",source_key:Lc,attention_count:Lc?1:0,compact:Le,payload:Lc?{label:jp}:null}))},[d,jp,Le,Lc]),Us(()=>{let i=hn.
current;if(!i)return;let g=Date.now(),$=n_.current;if(!Ci){$.activeSemanticKey&&($.lastClearedSemanticKey=$.activeSemanticKey,
$.clearedAt=g,$.activeSemanticKey="");return}let N=$.activeSemanticKey===Ci||$.lastClearedSemanticKey===Ci&&g-$.clearedAt<=
5e3;$.activeSemanticKey=Ci,!(N||(No.current+=1,xo.current=0,Rt.current=!1,gn.current||document.activeElement===ds.current||
g<So.current)||!la.current?.(i,0,"genuine-prompt-reveal",{allowDuringPrompt:!0}))&&(Rc.current=i.scrollHeight-i.clientHeight<
80,ii(!1),oi(0),ca.current={...ca.current,sessionId:d,scrollTop:0,scrollHeight:i.scrollHeight,clientHeight:i.clientHeight,
atBottom:!1})},[Ci,d,ps.length]);let Ds=d&&V[d]?.capabilities?.write_capability_gate||null,m_=!!(Ps.trim()||ku.length>0)&&
!!d&&!Pn&&!Ga&&!Ds&&!lt,Bp=o?c?.state||"connecting":"offline",f_=c?.rttMs!=null?` \xB7 ${c.rttMs} ms`:"",Fp=Object.entries(
u).reduce((i,[g,$])=>qe.has(g)?i:i+Number($||0),0),Oc=Object.keys(lo).filter(i=>i!==d&&!qe.has(i)).length,Hp=ao?.completed_at?
Date.now()-Date.parse(ao.completed_at):Number.POSITIVE_INFINITY,Bt=Hp>=0&&Hp<=1440*60*1e3?ao:null,da=Bt?Xr.filter(i=>i.run_id!==
Bt.run_id):Xr,h_=Object.fromEntries((Gn?.coverage_matrix||[]).map(i=>[i.harness,i])),zp=Object.entries(Gn?.harnesses||{}).
sort(([i],[g])=>i.localeCompare(g)),Ft=ya?.latest||null,g_=Ft?.completed_at?Date.now()-Date.parse(Ft.completed_at):Number.
POSITIVE_INFINITY,Ai=!ya||!Ft||g_>2700*1e3?"STALE":String(ya.status||Ft.status||"STALE").toUpperCase(),Rr=Array.isArray(
ya?.open_fingerprints)?ya.open_fingerprints:[],Tr=Ai!=="PASS"||Rr.length>0,$r=$n.length>0||da.length>0||!!Bt||!!Ds||Tr,Up=($n.
length>0?1:0)+da.length+(Bt?1:0)+(Ds?1:0)+(Tr?1:0),Ro=Ds||$n.length>0||Bt?.status==="fail"||Ai==="FAIL"||Rr.length>0?"cr\
itical":da.length>0||Tr?"warning":"status",Su=JSON.stringify({duplicate:$n.map(i=>i.session_id||i.session||"").sort(),nightly:da.
map(i=>i.run_id||`${i.harness}:${i.app_version}`).sort(),app_update:Bt?`${Bt.run_id||""}:${Bt.status||""}`:"",write_gate:!!Ds,
dogfood:`${Ai}:${Rr.slice().sort().join(",")}`});$e(()=>{if(!$r){p(!1);return}let i=Ro==="critical"?2:Ro==="warning"?1:0;
try{let g=JSON.parse(localStorage.getItem(Yh)||"null"),$=i>0&&(!g||i>Number(g.severity_rank||0)||i===2&&g.fingerprint!==
Su);p($),localStorage.setItem(Yh,JSON.stringify({fingerprint:Su,severity_rank:i}))}catch{p(i>0)}},[$r,Su,Ro]);let __=Ps.
startsWith("/")?Ps.slice(1).trim().toLowerCase():"",Ic=Ps.startsWith("/")?ew.filter(i=>i.command.slice(1).includes(__)):
[];Us(()=>{let i=bc.current;if(!$r||!i){ui(0);return}let g=()=>ui(Math.ceil(i.getBoundingClientRect().height));if(g(),typeof ResizeObserver>
"u")return;let $=new ResizeObserver(g);return $.observe(i),()=>$.disconnect()},[$r,$n.length,da.length,Bt?.run_id,Ds]);let U=d&&
V[d]||null,Gp=d?Object.values(Z||{}).filter(i=>i.sessionId===d):[],Wp=Gp.find(i=>i.status==="pending"||i.status==="await\
ing_config")||null,Pc=Gp.find(i=>i.status==="failed")||null,nn=d&&s[d]||null,Wa=d&&a[d]||null,To=xr?"codex_desktop_jsonl":
B?.agent_type==="codex_cli"||B?.agent_type==="cursor_cli"?"native":"relay_sqlite",$o=xr&&nt?.thread_id||null;$e(()=>{if(!d||
!o||mt?.sessionId===d||lt&&!xr)return;let g=(t[d]||[]).reduce((N,q)=>Math.max(N,Number(q?.sequence||0)),0);if(g>0&&!xr){
oc(d,{afterSequence:g});return}let $=Ni(B);ba(d,{...$,mode:"tail",source:To,threadId:$o})},[d,o,B?.agent_type,xr,lt,To,$o,
mt?.sessionId]),$e(()=>{if(!o||!mt||d!==mt.sessionId||lt||(t[d]||[]).some(N=>String(N?.id)===String(mt.messageId)))return;
let g=()=>ba(d,{mode:"around",source:"relay_sqlite",aroundId:mt.messageId,limit:200,replace:!0,userInitiated:!0});g();let $=setTimeout(
g,600);return()=>clearTimeout($)},[o,d,lt,mt?.sessionId,mt?.messageId,t[d]]),$e(()=>{if(!mt||d!==mt.sessionId)return;let i=`\
[data-message-id="${mt.messageId}"]`,g=ps.findIndex(K=>String(K?.id)===String(mt.messageId));g>=0&&Qe.scrollToIndex(g,"c\
enter");let $=0,N=null,q=setInterval(()=>{$++,hn.current?.querySelector(i)?(clearInterval(q),g>=0&&Qe.scrollToIndex(g,"c\
enter"),N=setTimeout(()=>{go(Y=>Y?.sessionId===d&&String(Y?.messageId)===String(mt.messageId)?null:Y)},5e3)):$>=40&&(clearInterval(
q),go(null),dt("Matched message could not be loaded"))},100);return()=>{clearInterval(q),N&&clearTimeout(N)}},[d,mt?.sessionId,
mt?.messageId,t[d],ps,Qe.scrollToIndex]),$e(()=>{ks(d?[d]:[])},[d,ks]),$e(()=>{if(!d||!o||!Mp)return;let i=Ni(B);ba(d,{...i,
mode:"tail",source:"native"})},[d,o,Mp]);let ze=B?.agent_type==="antigravity-v2";React.useEffect(()=>{!d||!ze||Be?.sessions?.[d]?.
panes?.["antigravity-navigator"]||Ge(g=>ma(g,{session_id:d,pane_id:"antigravity-navigator",action:"open",compact:Le}))},
[d,Le,ze,Be]);let Eo=d?xe[d]||[]:[],Mi=d?Wl[d]:null,Kp=React.useMemo(()=>ze&&Mi?.id?Eo.map(i=>!i?.kind||i.kind==="chat"?
{...i,active:i.id===Mi.id}:i):Eo,[Eo,ze,Mi?.id]),Nu=!!(d&&Object.prototype.hasOwnProperty.call(xe,d)),Vp=Kp.filter(i=>!i?.
kind||i.kind==="chat").length,b_=!!(d&&ze),xu=B?.agent_type==="antigravity"||B?.agent_type==="antigravity_panel"||B?.agent_type===
"antigravity-v2",ms=B?Mw(Pe,B):null,Yp=B?.agent_type==="codex"&&B?.visible_pane_visible?{pane_agent:B.visible_pane_agent||
null,summary:rg(B),sourceSession:B}:null,y_=ms?{pane_agent:ms.panel_agent||null,summary:rg(ms),sourceSession:ms}:null,qc=Yp||
y_,v_=qc?.summary||"",w_=qc?.pane_agent||null,Xp=v_||Wd(w_)||Xi(qc?.sourceSession,je(qc?.sourceSession)),Qp=Xp,Cu=!!(B&&
B.agent_type==="codex"&&B.visible_pane_visible&&B.visible_pane_agent==="codex"),k_=!!(B&&B.agent_type==="codex"&&B.visible_pane_visible&&
B.visible_pane_agent&&B.visible_pane_agent!=="codex"),ft=Qi(B||d,U),Au=d?hi[d]:"",pa=B&&typeof B=="object"?B.workspace_path:
"",Jp=pa?pa.split(/[\\/]/).filter(Boolean).pop()||pa:"",S_=Jp||(Au&&Au!=="Unscoped"?Au:"")||ce(B?.workspace_name)||"Unsc\
oped",Zp=we(new Map),Mu=React.useMemo(()=>ze&&Mi?.title?{...B||{},native_chat_title:Mi.title}:B,[B,ze,Mi?.title]),Ru=React.
useMemo(()=>{if(!d)return{title:"Agent Chat",source:"fallback",field:"no_session"};let i=Yu(Mu,Mu?.custom_display_name||
"",Ha),g=Km(Zp.current.get(d),i);return Zp.current.set(d,g),g},[d,Mu,Ha]),Tu=nt?.title||Ru.title,fs=d&&!lt?no[d]:null,N_=!!(ft?.
name==="Codex"&&B&&B.agent_type==="codex"&&(k_&&ms||!Yp&&ms&&(ms.panel_agent==="antigravity_panel"||Qp))),em=!!U?.capabilities?.
new_thread,x_=B?.agent_type==="codex-desktop",C_=B?.agent_type==="cursor",tm=x_||C_,$u=tm?"New chat":"New thread",nm=B&&
typeof B=="object"?B.machine_label:"",sm=Pg(B),am=React.useMemo(()=>{for(let i=st.length-1;i>=0;i--)if(st[i]?.role==="us\
er")return st[i];return null},[st]),Eu=am?rn(am.content).replace(/\s+/g," ").trim():"",hs=d?R[d]||B?.status||"unknown":"",
rm=React.useCallback(i=>{let g=ce(i).replace(/\s+\((?:Lines?|Line)\s+\d+(?:-\d+)?\)\s*$/i,"").replace(/^["'`]+|["'`]+$/g,
"").trim();if(!g)return"";let $=g.replace(/\\/g,"/"),N=ce(pa).replace(/\\/g,"/").replace(/\/+$/,"");if(/^[A-Za-z]:\//.test(
$)||$.startsWith("//")){if(!N)return"";let q=$.toLowerCase(),K=N.toLowerCase();return q===K?".":q.startsWith(K+"/")?$.slice(
N.length+1):""}return $.replace(/^\.\/+/,"").replace(/^\/+/,"")},[pa]),Lu=React.useCallback((i,g)=>{if(!d)return;let $=rm(
g);if(!$){dt("File is outside the current workspace");return}bo(N=>N&&N.sessionId===d&&N.messageKey===i&&N.path===$?null:
{sessionId:d,messageKey:i,path:$}),At.current(d,$)},[d,rm]),im=React.useCallback(()=>bo(null),[]),De=d&&!lt?k[d]!==void 0?
k[d]:B&&typeof B=="object"?B.activity:null:null,Ka=De?.goal||null,Va=String(Ka?.state||Ka?.status||"").toLowerCase(),Ri=Va===
"blocked",A_=Ri&&U?.capabilities?.goal_blocked_resume===!0,Lo=Va==="active"?"pause":Va==="paused"||A_?"resume":null,M_=Ri?
ce(Ka?.block_reason||Ka?.reason||De?.label||"Goal blocked").trim():"",Oo=!!(Lo&&Ka?.fingerprint&&U?.capabilities?.goal_pause_resume===
!0&&Number(B?.control_generation)>0),om=!!(Ec&&U?.capabilities?.interrupt===!0&&Number(B?.control_generation)>0&&Number(
B?.turn_generation)>0),Ou=De?.context_card||null,R_=!!(d&&Eu&&!((B?.agent_type==="cline"||B?.agent_type==="roo_code")&&Ou)),
Io=["claude_cli","codex_cli","cursor_cli"].includes(B?.agent_type),cm=React.useMemo(()=>{for(let i=st.length-1;i>=0;i--)
if(st[i]?.role==="assistant")return st[i];return null},[st]),Ti=d?(v[d]||"").trim():"",lm=cm?rn(cm.content).trim():"",T_=!!(De&&
!De?.thinking&&!De?.current&&!De?.task_list&&Gd(Ti)),um=!!(d&&!fn&&De&&(De.kind==="thinking"||De.kind==="generating")&&!De?.
thinking&&!De?.current&&!T_&&Gd(Ti)&&(B?.agent_type==="codex"||B?.agent_type==="codex-desktop"||B?.agent_type==="cursor"||
B?.agent_type==="antigravity_panel")&&Ti!==lm&&!lm.includes(Ti)),Iu=!!(De&&(De?.goal||De?.connection||De?.thinking||De?.
current||De?.step||De?.usage||De?.task_list||De.kind!=="idle"||Gd(Ti||De.thinkingContent||""))),Pu=!!(d&&(B?.rate_limit_active||
B?.percent_used!=null&&B.percent_used>=75)),Dc=d&&Iu?[d,"activity",B?.turn_generation||De?.turn_id||De?.started_at||De?.
goal?.fingerprint||"current"].join("\0"):"",qu=d&&De?.task_list&&!De?.step?`${Dc||d}\0tasks`:"",Du=d&&fs?.visible?[d,"au\
tomation",fs.id||fs.title||"visible"].join("\0"):"",ju=Pu?[d,B?.rate_limit_active?"rate-limit":"usage-warning"].join("\0"):
"";Us(()=>{Ge(i=>{let g=i;return g=Ki(g,{session_id:d,pane_id:"rate-limit",source_key:ju,attention_count:B?.rate_limit_active?
1:0,payload:ju?{percent_used:B?.percent_used??null}:null}),g=Ki(g,{session_id:d,pane_id:"live-activity",source_key:Dc,payload:Dc?
{kind:De?.kind||"activity"}:null}),g=Ki(g,{session_id:d,pane_id:"task-list",source_key:qu,payload:qu?{present:!0}:null}),
Ki(g,{session_id:d,pane_id:"automation-context",source_key:Du,payload:Du?{title:fs?.title||"Automation"}:null})})},[De?.
kind,fs?.title,fs?.visible,Pu,d,B?.percent_used,B?.rate_limit_active,Dc,Du,ju,qu]);let $_=!!(nn?.cursor&&(nn.cursor.next_before_offset!=
null||nn.cursor.next_before_id!=null)),jc=!!(d&&nn?.partial&&($_||Number(nn.total||0)>Number(nn.loaded||st.length||0))),
Bc=Number(nn?.loaded||st.length||0),dm=Number(nn?.total||Bc||0);function pm(){if(d){if(!Qe.prepareForPrepend()){let i=hn.
current,g=i?.getBoundingClientRect(),$=g?.top||0,N=i?Array.from(i.querySelectorAll(".message[data-message-key]")):[],q=N.
find(K=>{let Y=K.getBoundingClientRect();return Y.top>=$&&Y.top<g.bottom})||N.find(K=>K.getBoundingClientRect().bottom>$)||
N[0]||null;lu.current=q?{messageKey:q.dataset.messageKey,viewportTop:q.getBoundingClientRect().top}:null}ba(d,{mode:nn?.
cursor?"older":"tail",source:To,threadId:$o,userInitiated:!0,beforeOffset:nn?.cursor?.next_before_offset,beforeId:nn?.cursor?.
next_before_id,...Ni(B)})}}$e(()=>(cu.current=jc&&!Wa?pm:null,()=>{cu.current=null}),[d,B?.agent_type,To,$o,Wa,jc,nn?.cursor?.
next_before_offset,nn?.cursor?.next_before_id]);function E_(){d&&ba(d,{...Ni(B),mode:"tail",source:To,threadId:$o,userInitiated:!0})}
let L_=!!(d&&(st.length>0||um||fn)),O_=ep(ft),I_=React.useMemo(()=>ps.slice(Qe.start,Qe.end).map((i,g)=>{let $=Qe.start+
g,N=Ll(i,$),q=mt?.sessionId===d&&String(i?.id)===String(mt?.messageId),K=Qe.enabled||q||$>=Math.max(0,ps.length-48),Y=li?.
sessionId===d&&li?.messageKey===N?li:null,le=React.createElement(Uw,{key:N,msg:i,messageKey:N,activeAgent:ft,assistantMonospace:Io,
autoExpandLongCodeBlocks:xu,onOpenPath:Lu,agentType:B?.agent_type,preview:Y,fileContents:so,onClosePreview:im,deliveryState:$l(
i)?S[$l(i)]:null,onSteer:bt,onRetry:Nn,richContentEager:K,searchMatch:q});return Qe.enabled?React.createElement(Ww,{key:N,
index:$,messageKey:`${d||""}${N}`,onMeasure:Qe.onMeasure},le):le}),[ps,Qe.start,Qe.end,Qe.enabled,Qe.onMeasure,d,mt?.sessionId,
mt?.messageId,O_,Io,xu,Lu,B?.agent_type,li,so,im,S,bt,Nn]),$i=U?.capabilities?.thread_list,Bu=React.useMemo(()=>(0,Ng.codexDesktopThreadControlPolicy)(
{agentType:B?.agent_type,capabilities:U?.capabilities,session:B}),[U?.capabilities,B]),Fu=U?.capabilities?.new_thread===
!0&&(B?.agent_type!=="codex-desktop"||Bu.nativeSwitchEnabled),P_=!!(d&&(B?.agent_type==="codex-desktop"||B?.agent_type===
"cursor")&&$i&&(H[d]?.length>0||Ea[d]||ko)),q_=React.useMemo(()=>{let i=[...H[d]||[]];if(i.length===0)return i;let g=nt?.
thread_id||is[d],$=g?i.findIndex(q=>String(q.id||"")===String(g)||String(q.cache_key||"")===String(g)):-1,N=$>=0?$:i.findIndex(
q=>q.active);if(N>0){let[q]=i.splice(N,1);i.unshift(q)}return i},[d,nt?.thread_id,H,is]);React.useLayoutEffect(()=>{if(!wi||
typeof ResizeObserver>"u")return;let i=hn.current;if(!i)return;let g=d,$=()=>{ki.current!==g||gn.current||!Rt.current||la.
current?.(i,i.scrollHeight,"live-edge-resize-follow")},N=new ResizeObserver($);N.observe(i);let q=Y=>{Y?.nodeType===1&&N.
observe(Y)};Array.from(i.children).forEach(q);let K=new MutationObserver(Y=>{for(let le of Y)Array.from(le.removedNodes||
[]).forEach(Ne=>{Ne?.nodeType===1&&N.unobserve(Ne)}),Array.from(le.addedNodes||[]).forEach(q);$()});return K.observe(i,{
childList:!0}),()=>{K.disconnect(),N.disconnect()}},[d,au,wi]);let mm=st.length===0;React.useEffect(()=>{d&&$i&&mm&&be(d)},
[d,$i,mm]),React.useEffect(()=>{if(!(d&&ze&&o))return;Q(d);let i=[600,1800,4200].map(q=>setTimeout(()=>{typeof document<
"u"&&document.hidden||Q(d)},q)),g=()=>{typeof document<"u"&&document.hidden||Q(d)},$=setInterval(g,3e4),N=()=>g();return typeof document<
"u"&&document.addEventListener("visibilitychange",N),()=>{i.forEach(q=>clearTimeout(q)),clearInterval($),typeof document<
"u"&&document.removeEventListener("visibilitychange",N)}},[d,ze,o]),React.useEffect(()=>{d&&ze&&(Aa(!0),qt(!1))},[d,ze]),
React.useEffect(()=>{if(!(d&&ze))return;let i=Eo.find(g=>(!g?.kind||g.kind==="chat")&&g.active);i&&mo(g=>{let $=g[d];if(!$||
$.id!==i.id&&Date.now()-($.at||0)<15e3)return g;let N={...g};return delete N[d],N})},[d,ze,Eo]),React.useEffect(()=>{if(!(d&&
$i&&(tm||un)))return;be(d);let i=setInterval(()=>be(d),un?3e3:5e3);return()=>clearInterval(i)},[d,B?.agent_type,$i,un]),
React.useEffect(()=>{if(!d)return;let i=ho[d]||0,g=Mr.length;i>g&&yr($=>({...$,[d]:g}))},[d,ho,Mr.length]),React.useEffect(
()=>{!d||st.length===0||ci(i=>i[d]?{...i,[d]:!1}:i)},[d,st.length]),React.useEffect(()=>{if(!d)return;let i=H[d]||[],g=is[d];
if(!g)return;let $=E[d]?.thread_id;(String($||"")===String(g)||i.some(N=>N.id===g&&N.active))&&fo(N=>{let q={...N};return delete q[d],
q})},[d,H,E,is]);function Fc(i=d){i&&(i===d&&!Fu||(ci(g=>({...g,[i]:!0})),fo(g=>{let $={...g};return delete $[i],$}),yr(
g=>({...g,[i]:(t[i]||[]).length})),Jt(!1),pe(i)))}function Hc(i,g,$="native"){i&&g&&(ci(N=>({...N,[i]:!1})),fo(N=>({...N,
[i]:g})),yr(N=>({...N,[i]:0})),ee(i,g,{selectionMode:$}))}function Er(i=d){i&&(Aa(!0),qt(!1),mo(g=>({...g,[i]:{id:"__agv\
2:new_conversation",title:"New Conversation",kind:"nav",at:Date.now()}})),he(i))}function Hu(i,g=d){if(!(g&&i))return;Aa(
!0),qt(!1);let $=(xe[g]||[]).find(q=>q?.id===i),N=i==="__agv2:new_conversation"?"New Conversation":i==="__agv2:conversat\
ion_history"?"Conversation History":i==="__agv2:scheduled_tasks"?"Scheduled Tasks":"Antigravity v2";if(mo(q=>({...q,[g]:{
id:i,title:$?.title||N,kind:$?.kind||"chat",at:Date.now()}})),i==="__agv2:new_conversation"){Er(g);return}de(g,i)}function D_(i){
d&&(ua.current={sessionId:d,index:(Os.current[d]||[]).length,scratch:i},za(d,i),dn(i.startsWith("/")))}function fm(i){if(!d)
return;let $={"/plan":`${i} Outline the implementation approach and major steps.`,"/review":`${i} Review the current cha\
nges for bugs, regressions, and missing tests.`,"/fix":`${i} Implement or repair the current issue.`,"/summarize":`${i} \
Summarize the current state and important changes.`}[i]||`${i} `;za(d,$),dn(!1),requestAnimationFrame(()=>ds.current?.focus())}
function j_(i,g=!1,$=""){let N=je(i),q=Gg.has(N)?qr(i):null,K=Fa.current.get(N);return K||(K=document.createElement("div"),
K.className="sidebar-card-host",K.setAttribute("data-sidebar-card-host",N),Fa.current.set(N,K)),ReactDOM.createPortal(React.
createElement(Qw,{session:i,health:R[N],unread:qe.has(N)?0:u[N]||0,isThinking:!!f[N]||!!nl(k[N],{health:R[N]}),isActive:N===
d,agentConfig:V[N]||null,activity:k[N]||null,sessionMessages:t[N]||[],hasBlockingPrompt:!!h[N]||!!Yi(C[N]),blockingPromptLabel:h[N]?
h[N].type==="question_prompt"?"Question required":"Permission required":C[N]?.title||"Action required",muted:!!xt[N]?.muted,
pinned:g,workspaceLabel:$,recentMessageAt:q?.at||null,menuOpen:ni===N,onMenuToggle:Y=>si(le=>Y?N:le===N?"":le),onPinChange:Y=>ne(
N,{pinned:Y}).catch(le=>{dt(le?.message||`Unable to ${Y?"pin":"unpin"} chat`)}),onSelect:()=>Is(N,i),onManage:()=>{as(N),
Nt(!0)},onClose:()=>{let Y=R[N]==="disconnected"||!R[N],le=Y?"Remove session from the list?":`Close session "${N}"?`;window.
confirm(le)&&Rn(N,Y)},onAutomations:i?.agent_type==="codex-desktop"?()=>{La||Ua(),$s(Y=>!Y),os(!1),Dn(!1),cs(!1),ls(!1),
Et(!1)}:void 0,showAutomationsActive:La,onSkills:i?.agent_type==="codex-desktop"?()=>{Oa||Ua(),os(Y=>!Y),$s(!1),Dn(!1),cs(
!1),ls(!1),Et(!1),to[N]||ic(N)}:void 0,showSkillsActive:Oa}),K,N)}function zc(i,g=!0){let $=je(i);return React.createElement(
"div",{key:$,className:`sidebar-card-slot${g?"":" sidebar-card-slot-filtered"}`,"data-sidebar-card-slot":$,"aria-hidden":g?
void 0:"true",inert:g?void 0:""})}return React.createElement("div",{className:`app${$r?" has-system-banner":""}`,style:$r?
{"--system-banner-height":`${Vl}px`}:void 0},Na.mounted&&React.createElement(ht,{paneId:"quick-switcher",state:Na.record.
state,onMinimize:Na.minimize},React.createElement("div",{className:"quick-switcher-overlay",onMouseDown:i=>{i.target===i.
currentTarget&&(or(!1),ai(""),Ct(0),requestAnimationFrame(()=>ds.current?.focus()))}},React.createElement("div",{className:"\
quick-switcher",role:"dialog","aria-modal":"true","aria-label":"Switch session"},React.createElement("div",{className:"q\
uick-switcher-input-wrap"},React.createElement("span",{"aria-hidden":"true"},"\u2315"),React.createElement(rt,{paneId:"q\
uick-switcher",onMinimize:Na.minimize}),React.createElement("input",{ref:y,className:"quick-switcher-input",value:$a,onChange:i=>{
ai(i.target.value),Ct(0)},placeholder:"Search sessions, projects, or harnesses","aria-label":"Search sessions","aria-con\
trols":"quick-switcher-results","aria-activedescendant":tn.length?`quick-switcher-option-${Gt}`:void 0,autoComplete:"off",
spellCheck:"false"}),React.createElement("kbd",null,"Esc")),React.createElement("div",{className:"quick-switcher-results",
id:"quick-switcher-results",role:"listbox"},tn.length===0?React.createElement("div",{className:"quick-switcher-empty"},"\
No matching sessions"):tn.map((i,g)=>React.createElement("button",{type:"button",role:"option",id:`quick-switcher-option\
-${g}`,"aria-selected":g===Gt,className:`quick-switcher-option${g===Gt?" selected":""}${i.id===d?" active":""}`,key:i.id,
onMouseEnter:()=>Ct(g),onClick:()=>{Is(i.id,i.session),Et(!1),or(!1),ai(""),Ct(0),requestAnimationFrame(()=>ds.current?.
focus())}},React.createElement("span",{className:"quick-switcher-dot",style:{background:i.agentColor}}),React.createElement(
"span",{className:"quick-switcher-copy"},React.createElement("span",{className:"quick-switcher-title"},i.title),React.createElement(
"span",{className:"quick-switcher-meta"},i.groupLabel," \xB7 ",i.agentName,i.subtitle?` \xB7 ${i.subtitle}`:"")),i.id===
d&&React.createElement("span",{className:"quick-switcher-current"},"Current")))),React.createElement("div",{className:"q\
uick-switcher-footer"},React.createElement("span",null,React.createElement("kbd",null,"\u2191"),React.createElement("kbd",
null,"\u2193")," Navigate"),React.createElement("span",null,React.createElement("kbd",null,"Enter")," Switch"),React.createElement(
"span",null,tn.length," of ",ia.length))))),kn.mounted&&React.createElement(ht,{paneId:"shortcut-help",state:kn.record.state,
onMinimize:kn.minimize},React.createElement("div",{className:"shortcut-help-overlay",onMouseDown:i=>{i.target===i.currentTarget&&
na(!1)}},React.createElement("div",{className:"shortcut-help",role:"dialog","aria-modal":"true","aria-label":"Keyboard s\
hortcuts"},React.createElement("div",{className:"shortcut-help-header"},React.createElement("strong",null,"Keyboard shor\
tcuts"),React.createElement(rt,{paneId:"shortcut-help",onMinimize:kn.minimize}),React.createElement("button",{type:"butt\
on",onClick:()=>na(!1),"aria-label":"Close keyboard shortcuts"},"\xD7")),React.createElement("div",{className:"shortcut-\
help-list"},React.createElement("div",null,React.createElement("span",null,"Switch session"),React.createElement("kbd",null,
"Ctrl/Cmd P")),React.createElement("div",null,React.createElement("span",null,"Previous / next session"),React.createElement(
"kbd",null,"Alt \u2191 / \u2193")),React.createElement("div",null,React.createElement("span",null,"Focus composer"),React.
createElement("kbd",null,"Ctrl/Cmd K")),React.createElement("div",null,React.createElement("span",null,"Send / newline"),
React.createElement("kbd",null,"Enter / Shift Enter")),React.createElement("div",null,React.createElement("span",null,"O\
pen / close this guide"),React.createElement("kbd",null,"?"))),React.createElement("div",{className:"shortcut-help-note"},
"Shortcuts never switch or submit while you are typing unless they include Ctrl/Cmd or Alt.")))),tt.mounted&&React.createElement(
ht,{paneId:"revalidation-ledger",state:tt.record.state,onMinimize:tt.minimize},React.createElement("div",{className:"sho\
rtcut-help-overlay revalidation-ledger-backdrop",role:"presentation",onMouseDown:i=>{i.target===i.currentTarget&&Se(!1)}},
React.createElement("div",{className:"revalidation-ledger",role:"dialog","aria-modal":"true","aria-label":"Harness reval\
idation program health"},React.createElement("div",{className:"shortcut-help-header"},React.createElement("strong",null,
"Harness revalidation program"),React.createElement(rt,{paneId:"revalidation-ledger",onMinimize:tt.minimize}),React.createElement(
"button",{type:"button",onClick:()=>Se(!1),"aria-label":"Close validation health"},"\xD7")),React.createElement("p",{className:"\
revalidation-ledger-summary"},"Continuous version watch, nightly tier-1, and staggered weekly tier-2. Write controls fai\
l closed after drift until the installed version passes its required tiers."),React.createElement("section",{className:`\
operator-dogfood-health validation-state-${Ai.toLowerCase()}`,"aria-label":"Chat stability sentinel health"},React.createElement(
"h3",null,"Chat stability sentinel: ",Ai),React.createElement("p",null,Ft?`${Ft.mode||"unknown"} / ${Ft.trigger_source||
"unknown trigger"} / ${Ft.duration_ms||0} ms / ${Ft.refresh_count??0} refreshes / ${Ft.dropped_samples??0} dropped`:"No \
sentinel result has been published; health remains stale."),React.createElement("dl",null,React.createElement("div",null,
React.createElement("dt",null,"Source"),React.createElement("dd",null,Ft?.source_commit||"unavailable")),React.createElement(
"div",null,React.createElement("dt",null,"Build"),React.createElement("dd",null,Ft?.source_bundle_sha256||"unavailable")),
React.createElement("div",null,React.createElement("dt",null,"Last end"),React.createElement("dd",null,Ft?.completed_at?
new Date(Ft.completed_at).toLocaleString():"never")),React.createElement("div",null,React.createElement("dt",null,"Next \
due"),React.createElement("dd",null,Ft?.next_due_at?new Date(Ft.next_due_at).toLocaleString():"unknown")),React.createElement(
"div",null,React.createElement("dt",null,"Scheduler"),React.createElement("dd",null,Ft?.scheduler_last_result||"unavaila\
ble")),React.createElement("div",null,React.createElement("dt",null,"Open findings"),React.createElement("dd",null,Rr.length)))),
zp.length===0?React.createElement("div",{className:"revalidation-ledger-empty"},"Program health has not been published b\
y the updated sentinel yet."):React.createElement("div",{className:"revalidation-ledger-table-wrap"},React.createElement(
"table",{className:"revalidation-ledger-table"},React.createElement("thead",null,React.createElement("tr",null,React.createElement(
"th",null,"Harness"),React.createElement("th",null,"Version"),React.createElement("th",null,"Fixture"),React.createElement(
"th",null,"Tier 1"),React.createElement("th",null,"Tier 2"),React.createElement("th",null,"Write gate"),React.createElement(
"th",null,"Next tier 2"))),React.createElement("tbody",null,zp.map(([i,g])=>{let $=h_[i]||{},N=$.tier2||{},q=g.last_tier2_status||
(N.mode==="gated"?"gated":"scheduled");return React.createElement("tr",{key:i},React.createElement("th",{scope:"row"},i),
React.createElement("td",null,g.installed_version||"not installed"),React.createElement("td",null,$.fixture?"covered":"m\
issing"),React.createElement("td",null,$.tier1?"covered":"missing"),React.createElement("td",{className:`validation-stat\
e-${q}`},q),React.createElement("td",{className:`validation-state-${g.status||"pending"}`},g.status==="pass"?"available":
g.status||"pending"),React.createElement("td",null,g.next_tier2_at?new Date(g.next_tier2_at).toLocaleString():"unschedul\
ed"))}))))))),React.createElement("div",{className:`overlay ${$t?"open":""}`,onClick:()=>Et(!1)}),$r&&React.createElement(
"div",{className:`duplicate-proxy-banner mobile-system-${Da?"expanded":"collapsed"} severity-${Ro}${Bt?.status==="pass"&&
$n.length===0&&da.length===0&&!Ds&&!Tr?" app-update-pass":""}`,role:Bt?.status==="pass"&&$n.length===0&&da.length===0&&!Ds&&
!Tr?"status":"alert",ref:bc},React.createElement("div",{className:"system-banner-mobile-summary"},React.createElement("s\
pan",{className:"system-banner-severity","aria-hidden":"true"},"!"),React.createElement("span",{className:"system-banner\
-summary-label"},Up," system alert",Up===1?"":"s"," \xB7 ",Ro),r&&React.createElement("span",{className:"system-banner-n\
ew"},"New"),React.createElement("button",{type:"button",className:"system-banner-disclosure","aria-expanded":Da,"aria-co\
ntrols":"system-banner-mobile-details",onClick:()=>{Yl(i=>!i),p(!1)}},Da?"Hide":"Details")),React.createElement("div",{className:"\
system-banner-details",id:"system-banner-mobile-details"},$n.length>0&&React.createElement(React.Fragment,null,React.createElement(
"strong",null,"Duplicate proxy detected."),React.createElement("span",null,$n.length," session",$n.length===1?"":"s"," c\
laimed by multiple proxies. Stop the extra proxy to prevent conflicting controls.")),da.length>0&&React.createElement(React.
Fragment,null,React.createElement("strong",null,"Nightly validation failed."),React.createElement("span",null,da.map(i=>`${i.
harness} (${i.app_version})`).join(", "),". Check the validation ledger before using affected controls.")),Bt&&React.createElement(
React.Fragment,null,React.createElement("strong",null,Bt.status==="pass"?"App update validated.":"App update drift valid\
ation failed."),React.createElement("span",null,Bt.harness," ",Bt.previous_app_version," -> ",Bt.app_version,". ",Bt.status===
"pass"?"Harness controls remain available.":"A triage item was added to the maturity backlog.")),Ds&&React.createElement(
React.Fragment,null,React.createElement("strong",null,"Harness writes paused."),React.createElement("span",null,Ds,". Re\
ad-only transcript access remains available.")),Tr&&React.createElement(React.Fragment,null,React.createElement("strong",
null,"Chat stability sentinel ",Ai.toLowerCase(),"."),React.createElement("span",null,Rr.length>0?`${Rr.length} open P0/\
P1 fingerprint${Rr.length===1?"":"s"}.`:"The required 30-minute canary is missing, expired, skipped, or running against \
a different served asset.")),(Gn||ya||Tr)&&React.createElement("button",{type:"button",className:"validation-health-link",
onClick:()=>Se(!0)},"View program health"))),React.createElement("div",{id:"pane-sidebar",className:`sidebar ${$t?"open":
""}${xs.record.state===Gr?" pane-minimized":""}`,"data-pane-id":"sidebar","data-pane-state":xs.record.state===fa&&!Le?Ur:
xs.record.state},React.createElement("div",{className:"sidebar-header"},React.createElement("span",{className:"logo"},"\u232C"),
React.createElement("span",{style:{flex:1}},"Agent Sessions"),React.createElement(rt,{paneId:"sidebar",onMinimize:xs.minimize}),
React.createElement("button",{className:`new-session-btn notification-settings-btn${dc?" active":""}`,"data-pane-toggle":"\
revalidation-ledger","aria-expanded":dc,"aria-controls":"pane-revalidation-ledger",title:"Harness validation health","ar\
ia-label":"Harness validation health",onClick:()=>Se(!0)},"V"),React.createElement("button",{className:`new-session-btn \
notification-settings-btn${cr?" active":""}`,"data-pane-toggle":"shortcut-help","aria-expanded":cr,"aria-controls":"pane\
-shortcut-help",title:"Keyboard shortcuts (?)","aria-label":"Keyboard shortcuts",onClick:()=>{na(i=>!i),or(!1)}},"?"),React.
createElement("button",{className:`new-session-btn notification-settings-btn${Jr?" active":""}`,"data-pane-toggle":"noti\
fication-settings",title:"Notification settings","aria-label":"Notification settings","aria-expanded":Jr,"aria-controls":"\
pane-notification-settings",onClick:()=>{Jn(i=>!i)}},"\u2662"),React.createElement("button",{className:`new-session-btn \
notification-settings-btn${Qs?" active":""}`,"data-pane-toggle":"session-management",title:"Manage sessions","aria-label":"\
Manage sessions","aria-expanded":Qs,"aria-controls":"pane-session-management",onClick:()=>{as(d&&(I||!qe.has(d))?d:je(ct[0])||
""),Nt(i=>!i)}},"\u22EF"),React.createElement("button",{className:`new-session-btn${xa?" active":""}`,"data-pane-toggle":"\
new-session",title:"New session","aria-expanded":xa,"aria-controls":"pane-new-session",onClick:()=>{Ca(i=>!i)}},"+")),React.
createElement("div",{className:"sidebar-session-search"},React.createElement("input",{type:"search",value:ur,onChange:i=>dr(
i.target.value),placeholder:"Filter sessions","aria-label":"Filter sidebar sessions",autoComplete:"off",spellCheck:"fals\
e"}),ur&&React.createElement("button",{type:"button",onClick:()=>dr(""),"aria-label":"Clear sidebar filter",title:"Clear\
 filter"},"x")),React.createElement("div",{className:`sidebar-order-control${xc?" changed":""}`,"aria-hidden":!xc,"aria-\
live":"polite"},React.createElement("span",null,"Order changed"),React.createElement("button",{type:"button",onClick:Yg,
disabled:!xc,tabIndex:xc?0:-1},"Sort now")),Vs.mounted&&React.createElement(ht,{paneId:"notification-settings",state:Vs.
record.state,onMinimize:Vs.minimize},React.createElement(pk,{onClose:()=>Jn(!1),onMinimize:Vs.minimize,onPreferencesChange:i=>{
ns({...i,turn_ready:!1}),ss(!0)}})),Ys.mounted&&React.createElement(ht,{paneId:"session-management",state:Ys.record.state,
onMinimize:Ys.minimize},React.createElement(mk,{sessions:ct,preferences:xt,initialSessionId:mr,onSave:ne,onExport:me,onClose:()=>Nt(
!1),onMinimize:Ys.minimize})),vn.mounted&&React.createElement(ht,{paneId:"new-session",state:vn.record.state,onMinimize:vn.
minimize},React.createElement(ik,{launchStates:T,onLaunch:(i,g,$)=>G(i,g,$),onResume:(i,g,$,N)=>bn(i,g,$,N),onClose:()=>Ca(
!1),onMinimize:vn.minimize,workspaces:Zi,showTestSessions:I})),React.createElement(rp,{structureKey:nu,placements:Xg,prepareStructureChange:Qg,
finishStructureChange:Jg},React.createElement("div",{className:"session-list",ref:Ot,onPointerDown:()=>{Wt.current+=1,vo()},
onPointerUp:()=>kr(80),onPointerCancel:()=>kr(80),onWheel:()=>{Wt.current+=1,vo(),kr(180)},onTouchStart:()=>{Wt.current+=
1,vo()},onKeyDown:i=>{["ArrowUp","ArrowDown","PageUp","PageDown","Home","End"," "].includes(i.key)&&(Wt.current+=1,vo(),
kr(180))},onScroll:i=>{let g=wc.current;if(g&&Math.abs(i.currentTarget.scrollTop-g.target)<=.5){wc.current=null,Sr();return}
Wt.current+=1,Sr(),vo(),kr(180)}},Pe.length===0&&!xa&&React.createElement("div",{className:"session-empty"},"No agents c\
onnected"),Pe.length>0&&Mt&&gi.length===0&&_i.length===0&&bi.length===0&&Np.length===0&&React.createElement("div",{className:"\
session-empty"},"No matching sessions"),Bn.length>0&&React.createElement("section",{className:`session-group working-ses\
sion-group${Mt&&gi.length===0?" sidebar-group-filtered":""}`,"aria-label":"Working now"},React.createElement("div",{className:"\
session-group-header"},React.createElement("span",{className:"working-session-group-icon","aria-hidden":"true"},"W"),React.
createElement("span",{className:"session-group-name pinned-session-group-name"},"Working now"),React.createElement("span",
{className:"session-group-status-slot"},wo.hasPrompt&&React.createElement("span",{className:"session-group-alert",title:"\
Action required"},"!"),React.createElement("span",{className:"session-group-working",title:"Sessions working"}),wo.unread>
0&&React.createElement("span",{className:"session-group-unread",title:`${wo.unread} unread`},wo.unread>99?"99+":wo.unread),
React.createElement("span",{className:"session-group-count"},gi.length))),React.createElement("div",{className:"session-\
group-items"},React.createElement("div",{className:"session-group-items-inner"},Bn.map(i=>zc(i,!Mt||gi.includes(i)))))),
Fn.length>0&&React.createElement("section",{className:`session-group recent-session-group${x.__recent__&&!Mt?" collapsed":
""}${Mt&&_i.length===0?" sidebar-group-filtered":""}`,"aria-label":"Recent chats"},React.createElement("div",{className:"\
session-group-header"},React.createElement("button",{type:"button",className:"session-group-toggle",title:`${x.__recent__?
"Expand":"Collapse"} Recent chats`,"aria-label":`${x.__recent__?"Expand":"Collapse"} Recent chats`,"aria-expanded":!x.__recent__||
!!Mt,onClick:()=>Ie("__recent__")},React.createElement("span",{className:"session-group-caret","aria-hidden":"true"},x.__recent__&&
!Mt?">":"v")),React.createElement("span",{className:"recent-session-group-icon","aria-hidden":"true"},"R"),React.createElement(
"span",{className:"session-group-name pinned-session-group-name"},"Recent chats"),React.createElement("span",{className:"\
session-group-status-slot"},yi.hasPrompt&&React.createElement("span",{className:"session-group-alert",title:"Action requ\
ired"},"!"),yi.working&&React.createElement("span",{className:"session-group-working",title:"Session working"}),yi.unread>
0&&React.createElement("span",{className:"session-group-unread",title:`${yi.unread} unread`},yi.unread>99?"99+":yi.unread),
React.createElement("span",{className:"session-group-count"},_i.length))),React.createElement("div",{className:"session-\
group-items"},React.createElement("div",{className:"session-group-items-inner"},Fn.map(i=>zc(i,!Mt||_i.includes(i)))))),
Ls.length>0&&React.createElement("section",{className:`session-group pinned-session-group${Mt&&bi.length===0?" sidebar-g\
roup-filtered":""}`,"aria-label":"Pinned chats"},React.createElement("div",{className:"session-group-header"},React.createElement(
"span",{className:"session-group-pin-icon","aria-hidden":"true"},"\u{1F4CC}"),React.createElement("span",{className:"ses\
sion-group-name pinned-session-group-name"},"Pinned chats"),React.createElement("span",{className:"session-group-status-\
slot"},vi.hasPrompt&&React.createElement("span",{className:"session-group-alert",title:"Action required"},"!"),vi.working&&
React.createElement("span",{className:"session-group-working",title:"Session working"}),vi.unread>0&&React.createElement(
"span",{className:"session-group-unread",title:`${vi.unread} unread`},vi.unread>99?"99+":vi.unread),React.createElement(
"span",{className:"session-group-count"},bi.length))),React.createElement("div",{className:"session-group-items"},React.
createElement("div",{className:"session-group-items-inner"},Ls.map(i=>zc(i,!Mt||bi.includes(i)))))),us.map(i=>{let g=!!x[i.
key]&&!Mt,N=Np.find(K=>K.key===i.key)?.sessions||[],q=Nr(N);return React.createElement("div",{className:`session-group${g?
" collapsed":""}${Mt&&N.length===0?" sidebar-group-filtered":""}`,key:i.key},React.createElement("div",{className:"sessi\
on-group-header"},React.createElement("button",{type:"button",className:"session-group-toggle",title:`${g?"Expand":"Coll\
apse"} ${i.label}`,"aria-label":`${g?"Expand":"Collapse"} ${i.label}`,"aria-expanded":!g,onClick:()=>Ie(i.key)},React.createElement(
"span",{className:"session-group-caret","aria-hidden":"true"},g?">":"v")),React.createElement(bl,{title:i.label,disclosureKey:i.
key,kind:"group",wrapperClassName:"session-group-title-details",triggerClassName:"session-group-name",disclosureClassName:"\
session-group-disclosure",triggerLabel:`Show full group name: ${i.label}`}),React.createElement("span",{className:"sessi\
on-group-status-slot"},q.hasPrompt&&React.createElement("span",{className:"session-group-alert",title:"Action required"},
"!"),q.working&&React.createElement("span",{className:"session-group-working",title:"Session working"}),q.unread>0&&React.
createElement("span",{className:"session-group-unread",title:`${q.unread} unread`},q.unread>99?"99+":q.unread),React.createElement(
"span",{className:"session-group-count"},Mt?N.length:i.sessions.length))),React.createElement("div",{className:"session-\
group-items","aria-hidden":g},React.createElement("div",{className:"session-group-items-inner"},i.sessions.map(K=>zc(K,!Mt||
N.includes(K))))))}),tu.map(i=>{let g=je(i);return j_(i,!!xt[g]?.pinned,Vg.has(g)?"":hi[g]||"Unscoped")}))),React.createElement(
"div",{className:"sidebar-footer"},React.createElement("span",{className:`status-dot ${Bp}`}),React.createElement("span",
{className:"sidebar-footer-health"},React.createElement("span",null,o?`Relay ${Bp}`:"Reconnecting\u2026"),React.createElement(
"span",{className:"sidebar-footer-rtt"},o&&f_.replace(/^\s*·\s*/,"")||"\xA0")),React.createElement("button",{type:"butt\
on",className:`sidebar-footer-action test-session-toggle${I?" active":""}`,title:I?"Hide test sessions":`Show test sessi\
ons (${qe.size})`,"aria-label":I?"Hide test sessions":"Show test sessions","aria-pressed":I,onClick:()=>j(i=>!i)},"T",qe.
size>99?"99+":qe.size||""),React.createElement("button",{type:"button",className:`sidebar-footer-action${Ia?" active":""}`,
title:"Usage and limits","aria-label":"Usage and limits",onClick:()=>{Ia||Ua(),cs(i=>!i),ls(!1),$s(!1),os(!1),Dn(!1),Es(
!1),Et(!1)}},"\u25D4"),React.createElement("button",{type:"button",className:`sidebar-footer-action host-resource-footer\
-action${ra?" active":""}`,title:"Host resources","aria-label":"Host resources",onClick:()=>{ra||Ua(),ls(i=>!i),cs(!1),Dn(
!1),$s(!1),os(!1),Es(!1),Et(!1)}},"R"),React.createElement("button",{type:"button",className:`sidebar-footer-action flee\
t-footer-action${Pa?" active":""}`,title:"Fleet view","aria-label":"Fleet view",onClick:()=>{Pa||Ua(),Dn(i=>!i),cs(!1),ls(
!1),$s(!1),os(!1),Es(!1),Et(!1)}},"\u25A6"),React.createElement("button",{type:"button",className:`sidebar-footer-action\
 transcript-search-footer-action${qa?" active":""}`,title:"Search all transcripts","aria-label":"Search all transcripts",
onClick:()=>{qa||Ua(),Es(i=>!i),Dn(!1),cs(!1),ls(!1),$s(!1),os(!1),Et(!1)}},"\u2315"),React.createElement("a",{href:"/ag\
ent-chat.apk",download:!0,className:"apk-download-link",title:"Download Android APK"},"\u2B07 APK"))),React.createElement(
"div",{className:`main${La||Oa||Ia||ra||Pa||qa?" automations-active":""}`},React.createElement(Bk,{connected:o,error:cc,
history:ro,subscription:lc,onRefresh:Kn,onSubscribe:Wn,onUnsubscribe:Ks,onOpen:()=>{ra||Ua(),ls(!0),cs(!1),Dn(!1),$s(!1),
os(!1),Es(!1),Et(!1)}}),La&&React.createElement(Ok,{sessions:e,onBack:()=>$s(!1)}),Oa&&React.createElement(Vk,{skills:to[d]||
null,onRefresh:()=>d&&ic(d),onBack:()=>os(!1)}),Vn.mounted&&d&&!lt&&React.createElement(ht,{paneId:"scheduled-send",state:Vn.
record.state,onMinimize:Vn.minimize},React.createElement(fk,{sessionId:d,initialContent:Ps,jobs:St.filter(i=>i.session_id===
d),onSchedule:vs,onCancel:on,onCreated:()=>za(d,""),onClose:()=>On(!1),onMinimize:Vn.minimize})),Ia&&React.createElement(
qk,{usage:Ss,refreshReceipt:Dl,resetReceipt:wa,costDetail:ir,onBack:()=>cs(!1),onRefresh:va,onWatch:jl,onConsumeResetCredit:Bl,
onRequestCostDetail:Fl}),ra&&React.createElement(Fk,{snapshot:ka,error:cc,history:ro,details:Hl,subscription:lc,onBack:()=>ls(
!1),onRefresh:Kn,onSubscribe:Wn,onUnsubscribe:Ks}),Pa&&React.createElement(Wk,{sessions:pi,activities:k,thinking:f,permissionPrompts:h,
errorPrompts:C,messages:t,agentConfigs:V,sessionAttention:lo,health:R,connected:o,deliveryStates:S,stopPending:pn,goalControlPending:aa,
onBroadcastSend:Re,onInterrupt:vu,onGoalControl:wu,onBack:()=>Dn(!1),onSelectSession:(i,g)=>{Is(i,g),Dn(!1)}}),qa&&React.
createElement(Kk,{onBack:()=>Es(!1),onOpenResult:o_}),!La&&!Oa&&!Ia&&!ra&&!Pa&&!qa&&React.createElement(React.Fragment,null,
React.createElement("div",{className:`topbar${wr?" mobile-header-expanded":" mobile-header-collapsed"}`},React.createElement(
"button",{className:"hamburger","data-pane-toggle":"sidebar","aria-expanded":$t,"aria-controls":"pane-sidebar",onClick:()=>Et(
i=>!i)},"\u2630",Fp>0&&React.createElement("span",{className:"hamburger-badge"},Fp),Oc>0&&React.createElement("span",{className:"\
hamburger-attention",title:`${Oc} session${Oc===1?"":"s"} need attention`,"aria-label":`${Oc} sessions need attention`},
"!")),React.createElement("div",{className:"topbar-context"},d?React.createElement(React.Fragment,null,React.createElement(
"div",{className:"topbar-title-row",role:"group","aria-label":`${ft.name} chat: ${Tu}`},React.createElement("div",{className:"\
agent-badge topbar-agent-badge",style:{color:ft.color,borderColor:ft.color+"55",background:ft.color+"18"}},ft.logo?React.
createElement("img",{src:ft.logo,alt:ft.abbr,className:"agent-badge-logo"}):ft.abbr),React.createElement("div",{className:"\
topbar-title-group",style:{color:ft.color}},React.createElement("div",{className:"topbar-title-projection","data-chat-ti\
tle-source":Ru.source,"data-chat-title-field":Ru.field},React.createElement(bl,{title:Tu,disclosureKey:`topbar-${d}`,kind:"\
chat",wrapperClassName:"topbar-title-details",triggerClassName:"topbar-title",disclosureClassName:"topbar-title-disclosu\
re",triggerLabel:`Show full chat title: ${Tu}`,triggerTag:"div"})),React.createElement("div",{className:"topbar-subtitle",
title:pa||void 0},React.createElement("span",{className:"topbar-workspace-icon"},"\u2302"),S_,U?.branch&&U.branch!=="unk\
nown"&&React.createElement("button",{className:`topbar-branch-btn${ta?" active":""}`,"data-pane-toggle":"branch-selector",
"aria-expanded":ta,"aria-controls":"pane-branch-selector",title:`Branch: ${U.branch}`,onClick:()=>{let i=!ta;Ms(i),i&&rr(
d)}},React.createElement("span",{className:"topbar-branch-icon"},"\u2442"),U.branch)))),React.createElement("div",{className:"\
mobile-topbar-controls"},React.createElement("span",{className:`mobile-topbar-connection ${o&&hs==="healthy"?"ok":"warn"}`,
role:"status","aria-label":`${o?"Relay connected":"Relay reconnecting"}; proxy ${hs||"connecting"}`,title:`${o?"Relay co\
nnected":"Relay reconnecting"}; proxy ${hs||"connecting"}`},React.createElement("span",{className:"mobile-topbar-connect\
ion-dot","aria-hidden":"true"}),o&&hs==="healthy"?"Live":o?"Degraded":"Offline"),React.createElement("button",{type:"but\
ton",className:"mobile-header-disclosure","aria-expanded":wr,"aria-controls":"mobile-session-header-details",onClick:()=>yc(
i=>!i)},React.createElement("span",{className:"mobile-header-disclosure-label"},"Details"),React.createElement("span",{"\
aria-hidden":"true"},wr?"\u2303":"\u2304"))),React.createElement("div",{className:"topbar-meta",id:"mobile-session-heade\
r-details"},React.createElement("button",{className:"theme-toggle-btn",onClick:()=>l(i=>i==="light"?"dark":"light"),title:"\
Toggle Light/Dark Mode"},O==="light"?"\u{1F319}":"\u2600\uFE0F"),React.createElement("span",{className:`context-pill top\
bar-relay-status ${o?"ok":"warn"}`,title:o?"Relay connected":"Relay disconnected \u2014 reconnecting"},o?"relay live":"r\
econnecting"),React.createElement("span",{className:`context-pill topbar-proxy-health ${hs==="healthy"?"ok":hs==="degrad\
ed"?"warn":hs==="disconnected"?"error":""}`,title:`Proxy: ${hs||"connecting"}`},React.createElement("span",{className:"t\
opbar-health-dot"}),hs==="healthy"?"live":hs==="degraded"?"degraded":hs==="disconnected"?"offline":"connecting"),nm&&React.
createElement("span",{className:"context-pill",title:"Remote machine"},nm),sm&&React.createElement("span",{className:"co\
ntext-pill",title:"Native editor host"},sm),React.createElement(Iw,{session:B,config:U,providerUsage:Ss,onOpenUsage:()=>{
Ua(),cs(!0),ls(!1),Dn(!1)}}),(Oo||Ri)&&React.createElement("button",{type:"button",className:"context-pill session-contr\
ol-pill goal-control",onClick:()=>Oo&&wu(d,Lo,Ka,B),disabled:!Oo||!o||!!aa[d],"aria-label":Oo?`${Lo==="pause"?"Pause":Ri?
"Resume blocked":"Resume"} goal`:"Goal blocked; resolve in the native session",title:Ri?M_||"No verified native unblock \
action is available":void 0},aa[d]?Lo==="pause"?"Pausing goal...":"Resuming goal...":Lo==="pause"?"Pause goal":Ri?Oo?"Re\
sume blocked goal":"Goal blocked \xB7 native action required":"Resume goal"),om&&React.createElement("button",{type:"but\
ton",className:"context-pill session-control-pill interrupt-control",onClick:()=>vu(d,B),disabled:!o||!!pn[d],"aria-labe\
l":"Interrupt turn"},pn[d]?"Interrupting...":"Interrupt turn"),B?.agent_type==="codex"&&B?.visible_pane_visible&&React.createElement(
"span",{className:`context-pill ${Cu?"ok":"warn"}`,title:Cu?"This Codex session is the visible right-hand pane":`Visible\
 right-hand pane is ${Xp}`},Cu?"right pane live":`right pane: ${Wd(B.visible_pane_agent)||"other"}`),st.length>0&&React.
createElement("span",{className:"context-pill",title:"Messages in this session"},st.length," msg",st.length!==1?"s":""),
(U?.capabilities?.chat_list||ze)&&React.createElement("button",{className:`context-pill chat-list-toggle${(ze?In:Zn)?" a\
ctive":""}`,"data-pane-toggle":ze?"antigravity-navigator":"chat-list","aria-expanded":ze?In:Zn,"aria-controls":`pane-${ze?
"antigravity-navigator":"chat-list"}`,title:ze?`${In?"Hide":"Show"} Agent Manager projects and conversations`:"View conv\
ersations",onClick:()=>{if(ze){In?Pt.minimize():Aa(!0),qt(!1),Q(d);return}let i=!Zn;qt(i),i&&Q(d)}},ze?"projects":"chats"),
U?.capabilities?.thread_list&&React.createElement("button",{className:`context-pill chat-list-toggle${un?" active":""}`,
"data-pane-toggle":"thread-list","aria-expanded":un,"aria-controls":"pane-thread-list",title:"View threads",onClick:()=>{
let i=!un;Jt(i),i&&be(d)}},"threads"),(U?.capabilities?.terminal_output||U?.capabilities?.terminal_input)&&React.createElement(
"button",{className:`context-pill terminal-toggle${Ut?" active":""}`,"data-pane-toggle":"terminal","aria-expanded":Ut,"a\
ria-controls":"pane-terminal",title:"Open terminal controls",onClick:()=>{let i=!Ut;es(i),i&&U?.capabilities?.terminal_output&&
fe(d)}},"terminal"),U?.capabilities?.file_changes&&React.createElement("button",{className:`context-pill diff-toggle${Dt?
" active":""}`,"data-pane-toggle":"diff-viewer","aria-expanded":Dt,"aria-controls":"pane-diff-viewer",title:"View file c\
hanges",onClick:()=>{let i=!Dt;ea(i),i&&Me(d)}},"changes"),fs?.visible&&React.createElement("span",{className:"context-p\
ill ok",title:fs.title||"Automation"},"automation"),U?.capabilities?.file_browser&&React.createElement("button",{className:`\
context-pill files-toggle${Zr?" active":""}`,"data-pane-toggle":"file-browser","aria-expanded":Zr,"aria-controls":"pane-\
file-browser",title:"Browse workspace files",onClick:()=>{let i=!Zr;uc(i),i&&(vr(null),_c("."),Yr(d,"."))}},"files"),U?.
capabilities?.open_panel&&React.createElement("button",{className:"context-pill open-panel-btn",title:"Open panel in Ant\
igravity",onClick:()=>Ce(d)},"open panel"),U?.capabilities?.native_window&&React.createElement("button",{className:"cont\
ext-pill open-panel-btn",title:`Open this ${Wd(B?.agent_type)||"CLI"} session in a native command window`,onClick:i=>se(
d,i)},"native"),Ec&&De?.label&&De.label!=="Generating"&&React.createElement("span",{className:"context-pill thinking",title:De.
label},De.label.length>40?De.label.substring(0,40)+"\u2026":De.label))):React.createElement("div",{className:"topbar-tit\
le-group"},React.createElement("div",{className:"topbar-title"},"Agent Chat"),React.createElement("div",{className:"topb\
ar-subtitle"},"Select a session to inspect its transcript and status")))),(B?.agent_type==="cline"||B?.agent_type==="roo\
_code")&&Ou&&React.createElement("div",{className:`cline-context-strip ${B?.agent_type==="roo_code"?"roo-context-strip":
""}`},React.createElement(tk,{card:Ou,tone:B?.agent_type==="roo_code"?"roo":"cline"})),Xs.mounted&&d&&U?.capabilities?.branch_list&&
React.createElement(ht,{paneId:"branch-selector",state:Xs.record.state,onMinimize:Xs.minimize},React.createElement(yk,{branchData:Vr[d]||
null,sessionId:d,currentBranch:U?.branch,onSwitch:i=>{Ws(d,i),Ms(!1)},onCreate:i=>{eo(d,i),Ms(!1)},onClose:()=>Ms(!1),onMinimize:Xs.
minimize})),wn.mounted&&d&&U?.capabilities?.file_browser&&React.createElement(ht,{paneId:"file-browser",state:wn.record.
state,onMinimize:wn.minimize},React.createElement(Tk,{sessionId:d,listing:ql[d],fileContents:so,viewingFile:_o,onNavigate:i=>{
_c(i),vr(null),Yr(d,i)},onOpenFile:i=>{vr(i),_a(d,i)},onBackToListing:()=>vr(null),onRefresh:()=>{_o?_a(d,_o):Yr(d,Kl)},
onClose:()=>{uc(!1),vr(null)},onMinimize:wn.minimize})),React.createElement(Yv,{records:it,onRestore:Qt}),React.createElement(
"div",{className:`messages-wrap${fs?.visible?" has-automation-pane":""}`},P_&&React.createElement(bk,{threads:q_,activeThreadId:nt?.
thread_id||is[d]||null,showDraftTab:!!Ea[d]||ko,newLabel:$u,controlPolicy:Bu,canCreateThread:Fu,onSwitch:(i,g)=>Hc(d,i,g),
onNew:()=>Fc(d),onOpenHistory:()=>{be(d),Jt(!0)}}),lt&&React.createElement("div",{className:`thread-view-banner state-${nt.
view_state}`,"data-testid":"codex-desktop-thread-view","data-thread-id":nt.thread_id||"",role:["error","unavailable"].includes(
nt.view_state)?"alert":"status"},React.createElement("span",{className:"thread-view-banner-copy"},React.createElement("s\
trong",null,su?"Checking chat":xr?"Read-only native archive":nt.view_state==="unavailable"?"Chat needs one native open":
"Chat could not be loaded"),React.createElement("span",null,nt.message)),nt.retryable&&nt.thread_id&&React.createElement(
"button",{type:"button",onClick:()=>Hc(d,nt.thread_id),disabled:!o||su},"Retry")),R_&&React.createElement("div",{className:"\
last-user-banner",title:Eu},React.createElement("span",{className:"last-user-banner-icon"},"\u21B5"),React.createElement(
"span",{className:"last-user-banner-text"},Eu)),N_&&React.createElement("div",{className:"rate-limit-overlay warning"},React.
createElement("span",{className:"rate-limit-icon"},"\u2318"),React.createElement("span",{className:"rate-limit-text"},"T\
he visible right-hand pane for this workspace is showing ",React.createElement("strong",null,Qp||Xi(ms,je(ms))),", not t\
his transcript."),React.createElement("button",{className:"context-pill",onClick:()=>Is(je(ms),ms),title:"Switch to the \
live right-hand pane session"},"View live pane")),b_&&React.createElement(ht,{paneId:"antigravity-navigator",state:Pt.record.
state,onMinimize:Pt.minimize},React.createElement("div",{className:"agv2-session-nav"},React.createElement("div",{className:"\
agv2-session-nav-header"},React.createElement("div",{className:"agv2-session-nav-copy"},React.createElement("span",{className:"\
agv2-session-nav-title"},"Agent Manager"),React.createElement("span",{className:"agv2-session-nav-meta"},Vp," conversati\
on",Vp===1?"":"s")),React.createElement("button",{className:"agv2-session-nav-btn",type:"button",onClick:()=>Q(d),title:"\
Refresh Agent Manager conversations"},"Refresh"),React.createElement(rt,{paneId:"antigravity-navigator",onMinimize:Pt.minimize})),
React.createElement(Kd,{items:Kp,embedded:!0,loading:!Nu,onNavigate:i=>Hu(i),onNew:()=>Er(d)}))),Gl&&!Ga&&React.createElement(
"button",{className:"jump-to-newest",onClick:a_},gc>0?`\u2193 ${gc} new`:"\u2193 Jump to Newest"),React.createElement("d\
iv",{className:`messages harness-theme harness-theme-${ce(B?.agent_type||"default").replace(/[^a-z0-9_-]/gi,"-")}`,"data\
-agent-type":B?.agent_type||"default","data-layout":Tw(B?.agent_type),"data-transcript-windowed":Qe.enabled?"true":"fals\
e","data-total-message-count":ps.length,"data-window-start":Qe.start,"data-window-end":Qe.end,key:au,ref:hn},L_&&React.createElement(
"div",{className:"messages-flex-spacer"}),jt&&React.createElement(ht,{paneId:"native-action",state:Xn.record.state,onMinimize:Xn.
minimize,blocking:!0},React.createElement(sk,{prompt:jt,sessionId:d,agentType:B?.agent_type,onRespond:M,onDismissFocus:()=>ds.
current?.focus(),onMinimize:Xn.minimize,interactive:Xn.open})),qs&&!jt&&React.createElement(ht,{paneId:"native-action",state:Xn.
record.state,onMinimize:Xn.minimize,blocking:!0},React.createElement(ak,{prompt:qs,sessionId:d,onRespond:_,onMinimize:Xn.
minimize})),Pu&&React.createElement(ht,{paneId:"rate-limit",state:Qr.record.state,onMinimize:Qr.minimize},React.createElement(
"div",{className:`rate-limit-overlay${B?.rate_limit_active||B?.percent_used>=90?" critical":B?.percent_used>=75?" warnin\
g":""}`},React.createElement("span",{className:"rate-limit-icon"},B?.rate_limit_active?"\u23F3":"\u{1F4CA}"),React.createElement(
"span",{className:"rate-limit-text"},B?.rate_limit_active?React.createElement(React.Fragment,null,"Rate limited",B.rate_limited_until&&
B.rate_limited_until!=="unknown"?React.createElement(React.Fragment,null," \u2014 resets ",React.createElement("strong",
null,ac(B.rate_limited_until))):null):React.createElement(React.Fragment,null,"Used ",React.createElement("strong",null,
B.percent_used,"%")," of session limit",B.rate_limited_until&&B.rate_limited_until!=="unknown"?React.createElement(React.
Fragment,null," \xB7 resets ",React.createElement("strong",null,ac(B.rate_limited_until))):null)),React.createElement(rt,
{paneId:"rate-limit",onMinimize:Qr.minimize}))),jc&&React.createElement("div",{className:"history-tail-banner"},React.createElement(
"span",null,dm>Bc?React.createElement(React.Fragment,null,"Showing latest ",Bc.toLocaleString()," of ",dm.toLocaleString(),
" messages"):React.createElement(React.Fragment,null,"Showing latest ",Bc.toLocaleString()," messages")),React.createElement(
"button",{type:"button",onClick:pm,disabled:!!Wa},Wa?"Loading older messages...":"Load older messages")),d&&Wa&&st.length>
0&&!jc&&React.createElement("div",{className:"history-tail-banner history-refresh-banner",role:"status"},React.createElement(
"span",null,"Refreshing latest messages...")),d&&nn?.error&&React.createElement("div",{className:"history-tail-banner hi\
story-error-inline",role:"alert"},React.createElement("span",null,nn.error),React.createElement("button",{type:"button",
onClick:E_,disabled:!!Wa},"Retry transcript")),d?st.length===0&&!fn&&!nt&&$i&&B?.is_list_view&&H[d]?.length>0&&!Ea[d]&&!ko?
React.createElement("div",{className:"thread-picker-empty"},React.createElement("div",{className:"thread-picker-header"},
"Select a chat"),React.createElement("div",{className:"thread-picker-list"},H[d].map((i,g)=>React.createElement("button",
{key:i.cache_key||i.id||g,className:`thread-picker-item${String(nt?.thread_id||"")===String(i.id||"")||String(nt?.thread_id||
"")===String(i.cache_key||"")||!nt&&i.active?" active":""}`,onClick:()=>{Hc(d,i.id)},title:i.title},React.createElement(
"span",{className:"thread-picker-title"},i.title||"Untitled"),i.age&&React.createElement("span",{className:"thread-picke\
r-age"},i.age)))),React.createElement("button",{className:"thread-picker-new",onClick:()=>Fc(d)},"+ New Thread")):st.length===
0&&!fn&&ze&&B?.is_list_view?React.createElement("div",{className:"thread-picker-empty agv2-picker-empty"},React.createElement(
"div",{className:"thread-picker-header"},"Choose a conversation or start a new one"),In?null:xe[d]?.length>0?React.createElement(
Kd,{items:xe[d]||[],embedded:!0,loading:!Nu,onNavigate:i=>Hu(i),onNew:()=>Er(d)}):React.createElement("button",{className:"\
thread-picker-new",onClick:()=>Er(d)},"+ New Conversation")):st.length===0&&!fn&&ze&&xe[d]?.length>0?React.createElement(
"div",{className:"thread-picker-empty agv2-picker-empty"},React.createElement("div",{className:"thread-picker-header"},"\
Select an Antigravity project or conversation"),!In&&React.createElement(Kd,{items:xe[d]||[],embedded:!0,loading:!Nu,onNavigate:i=>Hu(
i),onNew:()=>Er(d)})):st.length===0&&!fn&&B?.is_list_view&&xe[d]?.length>0?React.createElement("div",{className:"thread-\
picker-empty"},React.createElement("div",{className:"thread-picker-header"},"Select a conversation or type a new message"),
React.createElement("div",{className:"thread-picker-list"},xe[d].map((i,g)=>React.createElement("button",{key:i.id||g,className:`\
thread-picker-item${i.active?" active":""}`,onClick:()=>de(d,i.id),title:i.title},React.createElement("span",{className:"\
thread-picker-title"},i.title||"Untitled"))))):st.length===0&&!fn&&Wa?React.createElement("div",{className:"empty-state \
history-loading-state"},React.createElement("span",{className:"new-session-spinner"}),React.createElement("div",null,Wa.
mode==="older"?"Loading older messages...":"Loading latest messages...")):st.length===0&&!fn?React.createElement("div",{
className:"empty-state"},React.createElement("div",{className:"icon"},"\u{1F4AC}"),React.createElement("div",null,"No me\
ssages yet")):React.createElement(React.Fragment,null,Qe.enabled&&React.createElement("div",{className:"transcript-windo\
w-spacer top","data-testid":"transcript-window-top-spacer",style:{height:`${Qe.topSpacerHeight}px`}}),I_,Qe.enabled&&React.
createElement("div",{className:"transcript-window-spacer bottom","data-testid":"transcript-window-bottom-spacer",style:{
height:`${Qe.bottomSpacerHeight}px`}})):React.createElement("div",{className:"empty-state"},React.createElement("div",{className:"\
icon"},"\u{1F916}"),React.createElement("div",null,"Select an agent session")),fn&&React.createElement(Fw,{stream:fn,activeAgent:ft,
monospace:Io}),um&&React.createElement("div",{className:`message assistant live-draft${Io?" monospace":""}`,"data-messag\
e-role":"assistant","data-message-timestamp":js(De?.started_at||De?.updated_at)?.iso||"unknown"},React.createElement("di\
v",{className:"assistant-gutter"},React.createElement("div",{className:"agent-badge transcript-agent-badge",style:{color:ft.
color,borderColor:ft.color+"55",background:ft.color+"18"}},ft.logo?React.createElement("img",{src:ft.logo,alt:ft.abbr,className:"\
agent-badge-logo"}):ft.abbr)),React.createElement("div",{className:"assistant-content"},React.createElement("div",{className:"\
message-role"},React.createElement("span",{className:"message-role-label"},ft.name),React.createElement(sc,{instant:De?.
started_at||De?.updated_at})),React.createElement(Pi,{content:Ti,monospace:Io,autoExpandLongCodeBlocks:xu,onOpenPath:i=>Lu(
"live-draft",i)}))),Dp&&!jt&&React.createElement(rk,{prompt:Dp,sessionId:d,onRespond:_}),React.createElement("div",{ref:t_})),
fs?.visible&&React.createElement(ht,{paneId:"automation-context",state:Qn.record.state,onMinimize:Qn.minimize},React.createElement(
Ik,{view:fs,onShow:()=>d&&Pl(d),onMinimize:Qn.minimize}))),(De?.task_list||Iu)&&React.createElement("div",{className:"tr\
anscript-live-footer","data-testid":"transcript-live-footer"},De?.task_list&&!De?.step&&React.createElement(ht,{paneId:"\
task-list",state:oo.record.state,onMinimize:oo.minimize},React.createElement("div",{className:"session-tasklist-strip"},
React.createElement(rt,{paneId:"task-list",onMinimize:oo.minimize}),React.createElement(ek,{taskList:De.task_list,sessionId:d}))),
Iu&&React.createElement(ht,{paneId:"live-activity",state:io.record.state,onMinimize:io.minimize},React.createElement("di\
v",{className:"composer-live-status-strip"},React.createElement(rt,{paneId:"live-activity",onMinimize:io.minimize}),React.
createElement(Zw,{activity:De,thinkingText:d&&v[d]||"",agentType:B?.agent_type,pinned:!0,mobileExpanded:di,onMobileExpandedChange:vc,
mobileDisclosureId:"mobile-live-status-details"})))),Yn.mounted&&d&&React.createElement(ht,{paneId:"agent-settings",state:Yn.
record.state,onMinimize:Yn.minimize},React.createElement(hk,{session:B||d,config:U,configControlStates:Z,onRequestRefresh:oe,
onSetModel:(i,g)=>ge(i,g),onSetEffort:(i,g)=>W(i,g),onSetPermissionMode:(i,g)=>te(i,g),onSetAutoApprovePermissions:(i,g)=>X(
i,g),onSetMode:(i,g)=>ue&&ue(i,g),onSetCodexConfig:i=>J(d,i),onSwitchWorkspace:(i,g)=>z(i,g),onClose:()=>Zs(!1),onMinimize:Yn.
minimize})),!1,cn.mounted&&d&&U?.capabilities?.chat_list&&!ze&&React.createElement(ht,{paneId:"chat-list",state:cn.record.
state,onMinimize:cn.minimize},React.createElement(gk,{chats:xe[d]||[],sessionId:d,onSwitch:i=>{de(d,i),qt(!1)},onNew:()=>{
he(d),qt(!1)},onClose:()=>qt(!1),onMinimize:cn.minimize})),Ln.mounted&&d&&U?.capabilities?.thread_list&&React.createElement(
ht,{paneId:"thread-list",state:Ln.record.state,onMinimize:Ln.minimize},React.createElement(_k,{threads:H[d]||[],selectedThreadId:nt?.
thread_id||is[d]||null,sessionId:d,newLabel:$u,controlPolicy:Bu,canCreateThread:Fu,onSwitch:(i,g)=>{Hc(d,i,g),Jt(!1)},onNew:()=>{
Fc(d),Jt(!1)},onClose:()=>Jt(!1),onMinimize:Ln.minimize})),Sa.mounted&&d&&(U?.capabilities?.terminal_output||U?.capabilities?.
terminal_input)&&React.createElement(ht,{paneId:"terminal",state:Sa.record.state,onMinimize:Sa.minimize},React.createElement(
vk,{entries:ye[d]||[],canRead:!!U?.capabilities?.terminal_output,canInput:!!U?.capabilities?.terminal_input,onRefresh:()=>fe(
d),onSend:i=>ie(d,i),controlResults:Tn,onClose:()=>es(!1),onMinimize:Sa.minimize})),Cs.mounted&&d&&U?.capabilities?.file_changes&&
React.createElement(ht,{paneId:"diff-viewer",state:Cs.record.state,onMinimize:Cs.minimize},React.createElement(wk,{entries:Ee[d]||
[],onRefresh:()=>Me(d),onAccept:i=>ke(d,i,"accept"),onReject:i=>ke(d,i,"reject"),onClose:()=>ea(!1),onMinimize:Cs.minimize})),
React.createElement("div",{className:`input-area composer-skin-${ag(B?.agent_type)}`,"data-composer-skin":ag(B?.agent_type)},
React.createElement("label",{className:`attach-btn ${!d||!o||Ga?"disabled":""}`,title:"Attach file"},React.createElement(
"svg",{width:"18",height:"18",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",
strokeLinejoin:"round"},React.createElement("path",{d:"M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5\
.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"})),React.createElement("input",{type:"file",hidden:!0,multiple:!0,ref:s_,
onChange:c_,disabled:!d||!o||!!Ga})),React.createElement("div",{className:"input-col"},ku.length>0&&React.createElement(
"div",{className:"file-chips"},ku.map((i,g)=>React.createElement("div",{key:g,className:"file-chip"},React.createElement(
"span",null,"\u{1F4C4} ",i.name,i.isText?"":" (uploaded)"),React.createElement("button",{onClick:()=>i_(d,g)},"\xD7")))),
Ta&&Ic.length>0&&React.createElement("div",{className:"slash-menu"},Ic.map(i=>React.createElement("button",{key:i.command,
type:"button",className:"slash-item",onClick:()=>fm(i.command)},React.createElement("span",{className:"slash-command"},i.
command),React.createElement("span",{className:"slash-detail"},i.detail)))),d&&!lt&&mn[d]&&React.createElement("div",{className:`\
goal-command-notice ${mn[d].status}`,role:mn[d].status==="failed"?"alert":"status","data-request-id":mn[d].requestId||void 0},
React.createElement("strong",null,"Goal control"),React.createElement("span",null,mn[d].text)),d&&!lt&&(Ke[d]||[]).length>
0&&React.createElement("div",{className:"queued-bar"},(Ke[d]||[]).map(i=>React.createElement(Vw,{key:i.cid,qm:i,onSteer:()=>F(
d,i.cid,i.content,i.nativeIndex),onDiscard:()=>re(d,i.cid),onEdit:g=>Te(d,i.cid,g)}))),React.createElement("div",{className:"\
textarea-row"},React.createElement("textarea",{ref:ds,value:Ps,onChange:i=>D_(i.target.value),onKeyDown:p_,onPaste:l_,placeholder:lt?
su?"Checking Codex Desktop chat availability\u2026":xr?"Read-only Codex Desktop archive":"This Codex Desktop chat is una\
vailable":Ga?`Resolve the ${jt?.type==="question_prompt"?"question":jt?"permission prompt":"error prompt"} above to cont\
inue`:d?window.innerWidth<600?"Enter message\u2026":"Message\u2026 (/ for commands)":"Select a session",disabled:!d||!!Ga||
lt,rows:1}),React.createElement("div",{className:"textarea-btns"},d&&!lt&&React.createElement("button",{className:`compo\
ser-gear-btn schedule-send-btn${As?" active":""}`,"data-pane-toggle":"scheduled-send","aria-expanded":As,"aria-controls":"\
pane-scheduled-send",onClick:()=>On(i=>!i),title:"Schedule this message","aria-label":"Schedule message"},"\u25F7"),d&&React.
createElement("button",{className:`composer-gear-btn${gt?" active":""}`,"data-pane-toggle":"composer-settings","aria-exp\
anded":gt,"aria-controls":"pane-composer-settings",onClick:()=>ln(i=>!i),title:"Toggle settings"},"\u2699"),em&&React.createElement(
"button",{className:"composer-gear-btn mobile-hide",onClick:()=>Fc(d),title:$u},"\u270E"),(U?.capabilities?.chat_list||ze)&&
React.createElement("button",{className:`composer-gear-btn mobile-hide${(ze?In:Zn)?" active":""}`,"data-pane-toggle":ze?
"antigravity-navigator":"chat-list","aria-expanded":ze?In:Zn,"aria-controls":`pane-${ze?"antigravity-navigator":"chat-li\
st"}`,onClick:()=>{if(ze){In?Pt.minimize():Aa(!0),qt(!1),Q(d);return}let i=!Zn;qt(i),i&&Q(d)},title:ze?"Agent Manager co\
nversations":"Chat history"},"\u2630"),U?.capabilities?.thread_list&&React.createElement("button",{className:`composer-g\
ear-btn mobile-hide${un?" active":""}`,"data-pane-toggle":"thread-list","aria-expanded":un,"aria-controls":"pane-thread-\
list",onClick:()=>{let i=!un;Jt(i),i&&be(d)},title:"Thread history"},"\u229F"),U?.capabilities?.open_panel&&React.createElement(
"button",{className:"composer-gear-btn mobile-hide",onClick:()=>Ce(d),title:"Open panel"},"\u229E"),U?.capabilities?.native_window&&
React.createElement("button",{className:"composer-gear-btn mobile-hide",onClick:i=>se(d,i),title:"Open native command wi\
ndow"},"cmd"),U?.capabilities?.new_chat&&React.createElement("button",{className:"composer-gear-btn mobile-hide",onClick:()=>ze?
Er(d):he(d),title:ze?"New Antigravity conversation":"New chat"},"+"),om?React.createElement("button",{className:`stop-bt\
n${xi?" pending":""}`,title:xi?"Interrupting\u2026":"Interrupt agent",disabled:xi,onClick:yu},xi?React.createElement("sp\
an",{className:"stop-btn-spinner"}):"\u25A0"):React.createElement("button",{className:"send-btn",onClick:Pp,disabled:!m_,
title:o?"Send":"Queue until reconnected"},Pn?"\u2026":"\u2191"))),React.createElement("div",{className:"composer-meta"},
br===d&&Ec&&!xi&&React.createElement("span",{className:"interrupt-confirm-inline",role:"status","aria-live":"polite"},"P\
ress Esc again or Enter to interrupt"),(Qd(B?.agent_type)||ec(B?.agent_type))&&U?.mode&&U.mode!=="unknown"&&React.createElement(
"span",{className:"composer-hint",style:{color:"#d29922"}},U.mode),(Qd(B?.agent_type)||ec(B?.agent_type))&&U?.model_id&&
U.model_id!=="unknown"&&React.createElement("span",{className:"composer-hint",style:{color:"#d29922"}},U.model_id),B?.agent_type===
"codex_cli"&&U?.config_semantics==="observed_and_next_send"&&React.createElement("span",{className:"composer-hint",style:{
color:"#8b949e"}},"Observed ",U.observed_model_id||"unknown"," / ",U.observed_effort||"unknown"," \xB7 ","Next ",U.next_send_model_id||
"unset"," / ",U.next_send_effort||"unset"),B?.agent_type==="antigravity-v2"&&U?.model_id&&U.model_id!=="unknown"&&React.
createElement("span",{className:"composer-hint",style:{color:"#8b949e"}},U.model_id),(B?.agent_type==="antigravity"||B?.
agent_type==="antigravity_panel")&&(Array.isArray(B?.antigravity_quota_models)&&B.antigravity_quota_models.length>0?React.
createElement("span",{className:"composer-hint",style:{color:"#8b949e"}},Ig(B.antigravity_quota_models,4)):B?.percent_used!=
null?React.createElement("span",{className:"composer-hint",style:{color:B.percent_used>=90?"#f85149":B.percent_used>=75?
"#d29922":"#8b949e"}},"Quota ",B.percent_used,"%",B?.rate_limited_until&&B.rate_limited_until!=="unknown"?` \xB7 ${B.rate_limited_until}`:
""):null),React.createElement("span",{className:"composer-hint"},"Enter send"),React.createElement("span",{className:"co\
mposer-hint"},"Shift+Enter newline"),React.createElement("span",{className:"composer-hint"},"Ctrl/Cmd+K focus"),React.createElement(
"span",{className:"composer-hint"},"/ commands"),React.createElement("span",{className:"composer-hint"},"Ctrl+V image"),
d&&Ps&&React.createElement("span",{className:"composer-hint draft-live"},"draft saved")),d&&React.createElement("div",{id:"\
pane-composer-settings",className:`composer-settings${gt?" is-open":""}${It.record.state===Gr?" is-minimized":""}`,"data\
-pane-id":"composer-settings","data-pane-state":It.record.state},gt&&React.createElement("div",{className:"composer-sett\
ings-header"},React.createElement("span",null,"Composer settings"),React.createElement(rt,{paneId:"composer-settings",onMinimize:It.
minimize})),(Wp||Pc)&&React.createElement("div",{className:`composer-control-state ${Pc?"failed":"pending"}`,role:"statu\
s"},Pc?Pc.error:`Saving ${Wp.field.replace(/_/g," ")}\u2026`),(U?.capabilities?.set_model||B?.agent_type==="antigravity"||
B?.agent_type==="antigravity_panel")&&React.createElement(React.Fragment,null,B?.agent_type==="codex_cli"&&U?.config_semantics===
"observed_and_next_send"&&React.createElement("span",{className:"composer-setting-label","data-control":"observed-model"},
React.createElement("span",{className:"composer-setting-key"},"Observed model"),React.createElement("span",{className:"c\
omposer-hint"},U.observed_model_id||"unknown")),React.createElement("label",{className:"composer-setting-label","data-co\
ntrol":"model"},React.createElement("span",{className:"composer-setting-key"},B?.agent_type==="codex_cli"&&U?.config_semantics===
"observed_and_next_send"?"Next model":"Model"),React.createElement("select",{className:"composer-setting-select",value:B?.
agent_type==="codex_cli"&&U?.config_semantics==="observed_and_next_send"?U.next_send_model_id||"":U?.model_id||"default",
onChange:i=>ge(d,i.target.value)},B?.agent_type==="codex_cli"&&U?.config_semantics==="observed_and_next_send"&&React.createElement(
"option",{value:"",disabled:!0},"Choose model\u2026"),_g(B?.agent_type,U).map(i=>React.createElement("option",{key:i.id,
value:i.id},i.label)),U?.model_id&&!_g(B?.agent_type,U).some(i=>i.id===U.model_id)&&U.model_id!=="unknown"&&U.config_semantics!==
"observed_and_next_send"&&React.createElement("option",{value:U.model_id},U.model_id)),B?.agent_type==="codex_cli"&&U?.config_semantics===
"observed_and_next_send"&&React.createElement("span",{className:"composer-hint"},U.next_send_model_status||"unset"))),(B?.
agent_type==="antigravity"||B?.agent_type==="antigravity_panel")&&React.createElement("label",{className:"composer-setti\
ng-label","data-control":"mode"},React.createElement("span",{className:"composer-setting-key"},"Mode"),React.createElement(
"select",{className:"composer-setting-select",value:U?.conversation_mode||"Planning",onChange:i=>ue(d,i.target.value)},pp.
map(i=>React.createElement("option",{key:i.id,value:i.id},i.label)))),(ec(B?.agent_type)||B?.agent_type==="cursor")&&U?.
capabilities?.set_mode&&Zo(B?.agent_type,U).length>0&&React.createElement("label",{className:"composer-setting-label","d\
ata-control":"mode"},React.createElement("span",{className:"composer-setting-key"},"Mode"),React.createElement("select",
{className:"composer-setting-select",value:U?.mode||Zo(B?.agent_type,U)[0]?.id||"unknown",onChange:i=>ue(d,i.target.value)},
Zo(B?.agent_type,U).map(i=>React.createElement("option",{key:i.id,value:i.id},i.label)),U?.mode&&U.mode!=="unknown"&&!Zo(
B?.agent_type,U).some(i=>i.id===U.mode)&&React.createElement("option",{value:U.mode},U.mode))),U?.capabilities?.permission_mode_change&&
React.createElement("label",{className:"composer-setting-label","data-control":"permission"},React.createElement("span",
{className:"composer-setting-key"},B?.agent_type==="codex_cli"?"Access":"Permission"),React.createElement("select",{className:"\
composer-setting-select",value:U.permission_mode||jg(B?.agent_type),onChange:i=>te(d,i.target.value),title:"Permission m\
ode"},np(B?.agent_type||"claude",U).map(i=>React.createElement("option",{key:i.value,value:i.value},i.label)),U.permission_mode&&
!np(B?.agent_type,U).some(i=>i.value===U.permission_mode)&&U.permission_mode!=="unknown"&&React.createElement("option",{
value:U.permission_mode},U.permission_mode))),(B?.agent_type==="claude_cli"||B?.agent_type==="codex_cli"||B?.agent_type===
"cursor_cli")&&U?.capabilities?.set_effort&&(U.available_efforts||[]).length>0&&React.createElement(React.Fragment,null,
B?.agent_type==="codex_cli"&&U?.config_semantics==="observed_and_next_send"&&React.createElement("span",{className:"comp\
oser-setting-label","data-control":"observed-effort"},React.createElement("span",{className:"composer-setting-key"},"Obs\
erved effort"),React.createElement("span",{className:"composer-hint"},U.observed_effort||"unknown")),React.createElement(
"label",{className:"composer-setting-label","data-control":"effort"},React.createElement("span",{className:"composer-set\
ting-key"},B?.agent_type==="codex_cli"&&U?.config_semantics==="observed_and_next_send"?"Next effort":"Effort"),React.createElement(
"select",{className:"composer-setting-select",value:B?.agent_type==="codex_cli"&&U?.config_semantics==="observed_and_nex\
t_send"?U.next_send_effort||"":U.effort||"medium",onChange:i=>W(d,i.target.value),title:`${B?.agent_type==="codex_cli"?"\
Codex":B?.agent_type==="cursor_cli"?"Cursor":"Claude"} CLI effort`},B?.agent_type==="codex_cli"&&U?.config_semantics==="\
observed_and_next_send"&&React.createElement("option",{value:"",disabled:!0},"Choose effort\u2026"),(U.available_efforts||
[]).map(i=>React.createElement("option",{key:i.id,value:i.id},i.label))),B?.agent_type==="codex_cli"&&U?.config_semantics===
"observed_and_next_send"&&React.createElement("span",{className:"composer-hint"},U.next_send_effort_status&&U.next_send_effort_status!==
"unset"?U.next_send_effort_status:"No override selected"))),U?.capabilities?.auto_approve_permissions_toggle&&React.createElement(
"label",{className:"composer-setting-toggle",title:"Automatically approve permission prompts for this session"},React.createElement(
"input",{type:"checkbox",checked:typeof U?.auto_approve_permissions=="boolean"?U.auto_approve_permissions:!!B?.auto_approve_permissions,
onChange:i=>X(d,i.target.checked)}),React.createElement("span",null,"Auto-approve prompts")),U?.capabilities?.set_codex_config&&
React.createElement(React.Fragment,null,U?.capabilities?.codex_model_change&&React.createElement("label",{className:"com\
poser-setting-label","data-control":"model"},React.createElement("span",{className:"composer-setting-key"},B?.agent_type===
"codex"?"Next model":"Model"),React.createElement("select",{className:"composer-setting-select",value:U.model_id||"unkno\
wn",disabled:B?.agent_type==="codex"&&U.controls_available===!1||["pending","awaiting_config"].includes(Z?.[`${d}:model`]?.
status),onChange:i=>J(d,{model_id:i.target.value}),title:B?.agent_type==="codex"?"Next-turn Codex model":"Codex Desktop \
model"},(U.available_models||[]).map(i=>React.createElement("option",{key:i.id,value:i.id},i.label)),U.model_id&&!(U.available_models||
[]).some(i=>i.id===U.model_id)&&U.model_id!=="unknown"&&React.createElement("option",{value:U.model_id},U.model_id))),U?.
capabilities?.codex_effort_change&&React.createElement("label",{className:"composer-setting-label","data-control":"effor\
t"},React.createElement("span",{className:"composer-setting-key"},B?.agent_type==="codex"?"Next effort":"Effort"),React.
createElement("select",{className:"composer-setting-select",value:(U.effort||"unknown").toLowerCase(),disabled:B?.agent_type===
"codex"&&U.controls_available===!1||["pending","awaiting_config"].includes(Z?.[`${d}:effort`]?.status),onChange:i=>J(d,{
effort:i.target.value}),title:B?.agent_type==="codex"?"Next-turn reasoning effort":"Codex Desktop reasoning effort"},(U.
available_efforts||[]).map(i=>React.createElement("option",{key:i.id,value:i.id},i.label)))),U?.capabilities?.codex_permission_profile_change&&
React.createElement("label",{className:"composer-setting-label","data-control":"permission-profile"},React.createElement(
"span",{className:"composer-setting-key"},"Next permissions"),React.createElement("select",{className:"composer-setting-\
select",value:U.permission_profile||"unknown",disabled:U.controls_available===!1||["pending","awaiting_config"].includes(
Z?.[`${d}:permission_profile`]?.status),onChange:i=>J(d,{permission_profile:i.target.value}),title:"Next-turn native Cod\
ex permissions profile"},U.permission_profile==="full-access"&&React.createElement("option",{value:"full-access",disabled:!0},
"Full access"),(U.available_permission_profiles||[]).filter(i=>i.id!=="full-access").map(i=>React.createElement("option",
{key:i.id,value:i.id},i.label)))),U?.capabilities?.codex_bypass_permissions&&React.createElement("button",{type:"button",
className:"composer-desktop-action composer-bypass-action","data-pane-toggle":"agent-settings","aria-expanded":Js,"aria-\
controls":"pane-agent-settings",onClick:()=>{Zs(!0),It.minimize()},title:"Review and confirm Full access in Session Sett\
ings"},U.bypass_permissions_active?"Bypass active":"Bypass\u2026"),U?.capabilities?.codex_speed_change&&React.createElement(
"label",{className:"composer-setting-label","data-control":"speed"},React.createElement("span",{className:"composer-sett\
ing-key"},"Speed"),React.createElement("select",{className:"composer-setting-select",value:(U.speed||"standard").toLowerCase(),
onChange:i=>J(d,{speed:i.target.value}),title:"Speed"},(U.available_speeds||[]).map(i=>React.createElement("option",{key:i.
id,value:i.id},i.label)),U.speed&&!(U.available_speeds||[]).some(i=>i.id===U.speed)&&U.speed!=="unknown"&&React.createElement(
"option",{value:U.speed},U.speed))),U?.capabilities?.codex_access_change&&React.createElement("label",{className:"compos\
er-setting-label","data-control":"permission"},React.createElement("span",{className:"composer-setting-key"},"Access"),React.
createElement("select",{className:"composer-setting-select",value:U.permission_mode||"unknown",onChange:i=>J(d,{access_mode:i.
target.value}),title:"Codex Desktop access mode"},(U.available_access||[]).map(i=>React.createElement("option",{key:i.id,
value:i.id},i.label)),U.permission_mode&&!(U.available_access||[]).some(i=>i.id===U.permission_mode)&&U.permission_mode!==
"unknown"&&React.createElement("option",{value:U.permission_mode},U.permission_mode))),B?.agent_type==="codex-desktop"&&
(U.available_workspaces||[]).length>0&&React.createElement("select",{className:"composer-setting-select",value:U.file_access_scope||
"",onChange:i=>z(d,i.target.value),title:"Switch workspace"},(U.available_workspaces||[]).map(i=>React.createElement("op\
tion",{key:i.id,value:i.path||i.id},i.label)))),pa&&React.createElement("span",{className:"composer-workspace",title:pa},
"\u2302 ",Jp||pa),React.createElement("button",{className:"composer-desktop-action","data-pane-toggle":"agent-settings",
"aria-expanded":Js,"aria-controls":"pane-agent-settings",onClick:()=>{Zs(!0),It.minimize()}},"\u2699 Session details"),React.
createElement("div",{className:"composer-mobile-actions"},React.createElement("button",{className:"composer-mobile-actio\
n","data-pane-toggle":"agent-settings","aria-expanded":Js,"aria-controls":"pane-agent-settings",onClick:()=>{Zs(!0),It.minimize()}},
"\u2699 Session details"),em&&React.createElement("button",{className:"composer-mobile-action",onClick:()=>pe(d)},"\u270E New\
 thread"),(U?.capabilities?.chat_list||ze)&&React.createElement("button",{className:"composer-mobile-action","data-pane-\
toggle":ze?"antigravity-navigator":"chat-list","aria-expanded":ze?In:Zn,"aria-controls":`pane-${ze?"antigravity-navigato\
r":"chat-list"}`,onClick:()=>{Q(d),ze?(Aa(!0),qt(!1)):qt(!0)}},"\u2630 ",ze?"Projects":"Chat history"),U?.capabilities?.
thread_list&&React.createElement("button",{className:"composer-mobile-action","data-pane-toggle":"thread-list","aria-exp\
anded":un,"aria-controls":"pane-thread-list",onClick:()=>{be(d),Jt(!0)}},"\u229F Threads"),U?.capabilities?.open_panel&&
React.createElement("button",{className:"composer-mobile-action",onClick:()=>Ce(d)},"\u229E Open panel"),U?.capabilities?.
new_chat&&React.createElement("button",{className:"composer-mobile-action",onClick:()=>ze?Er(d):he(d)},"+ New chat"))))))),
Sn&&React.createElement("div",{className:"attention-toast",role:"status","aria-live":"polite"},React.createElement("span",
{className:`attention-toast-icon ${Sn.kind}`,"aria-hidden":"true"},Sn.kind==="prompt"||["goal_attention","provider_usage\
_threshold"].includes(Sn.kind)?"!":"\u2713"),React.createElement("span",{className:"attention-toast-copy"},React.createElement(
"strong",null,Sn.title),React.createElement("span",null,Sn.detail)),React.createElement("button",{type:"button",onClick:()=>{
let i=Pe.find(g=>je(g)===Sn.sessionId);i&&Is(Sn.sessionId,i),Op()}},"Jump")),React.createElement("div",{className:`toast\
 ${mc?"visible":""}`},mc))}var Ug=(()=>{try{return new URLSearchParams(window.location.search).get("render_profile")==="1"}catch{return!1}})();function Xk(e,t,n,s,a,o){
let c=window.__RAC_RENDER_PROFILER__||(window.__RAC_RENDER_PROFILER__=[]);c.push({id:e,phase:t,route:document.querySelector(
'[data-testid="fleet-view"]')?"fleet":document.querySelector('[data-testid="usage-dashboard"]')?"usage":document.querySelector(
'[data-testid="host-resource-dashboard"]')?"host-resources":document.querySelector(".messages")?"chat":"other",actual_duration_ms:Number(
n.toFixed(3)),base_duration_ms:Number(s.toFixed(3)),start_time_ms:Number(a.toFixed(3)),commit_time_ms:Number(o.toFixed(3))}),
c.length>2e3&&c.splice(0,c.length-2e3)}var Sg=React.createElement(ap,null,React.createElement(Yk,null));ReactDOM.createRoot(
document.getElementById("root")).render(Ug?React.createElement(React.Profiler,{id:"AgentChatRoot",onRender:Xk},Sg):Sg);"serviceWorker"in navigator&&window.addEventListener("load",function(){navigator.serviceWorker.register("/sw.js").catch(
function(e){console.warn("SW registration failed:",e)})});(window.navigator.standalone===!0||window.matchMedia("(display\
-mode: standalone)").matches)&&document.body.classList.add("pwa-standalone");})();
