(()=>{var Hg=Object.create;var Ud=Object.defineProperty;var Ug=Object.getOwnPropertyDescriptor;var Gg=Object.getOwnPropertyNames;var Wg=Object.getPrototypeOf,zg=Object.prototype.hasOwnProperty;var Kg=(e,t)=>()=>(t||e((t={exports:{}}).exports,t),t.exports);var Vg=(e,t,n,s)=>{if(t&&typeof t=="object"||typeof t=="function")for(let a of Gg(t))!zg.call(e,a)&&a!==n&&Ud(e,a,{get:()=>t[a],
enumerable:!(s=Ug(t,a))||s.enumerable});return e};var Yg=(e,t,n)=>(n=e!=null?Hg(Wg(e)):{},Vg(t||!e||!e.__esModule?Ud(n,"default",{value:e,enumerable:!0}):n,e));var Jm=Kg((Wk,Qm)=>{"use strict";var Gm=new Set(["codex","codex_cli","codex-desktop"]),bb=new Set(["thinking","generatin\
g","reading_files","running_command","applying_patch","working"]),vb=new Set(["active","in_progress","in-progress","work\
ing","running"]),yb=new Set(["pending","queued","todo","not_started","not-started"]),Wm=new Set(["completed","complete",
"done","passed","success","succeeded"]),kb=new Set([...Wm,"cancelled","canceled","failed","skipped"]),wb=new Set(["","ac\
tive","idle","ready","thinking","generating","working","busy","connected"]),zm=240,Sb=32,Nb=48,Cb=/^(?=.*\d)(?:(?:\d+)\s*d\s*)?(?:(?:\d+)\s*h\s*)?(?:(?:\d+)\s*m\s*)?(?:(?:\d+)\s*s)?$/i,
xb=/^[+-]?\d+\s*[dhms]\b/i,Ab=/^(?:just now|today|yesterday|(?:\d+|an?|one)\s+(?:seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?)\s+ago)$/i,
Rb=/^(?:pursuing goal|paused goal|goal (?:paused|blocked|usage limited|rate limited|limited|budget limited|achieved|cancelled|canceled|stopped|failed)|idle|ready|connected|awaiting live update)$/i,
Mb=/^(?:no (?:recent message|current work|data|activity)(?: reported)?|unavailable|unknown|not available)$/i,Tb=/^(?:remote agent chat|(?:antigravity|claude(?: code)?|cline|codex|continue|cursor|gemini|roo code)\s+(?:harness|workspace))$/i,
Hm=Object.freeze({active:"active",running:"active",working:"active",pursuing:"active",pursuing_goal:"active",paused:"pau\
sed",pause:"paused",paused_goal:"paused",blocked:"blocked",goal_blocked:"blocked",needs_attention:"blocked",waiting_for_user:"\
blocked",usagelimited:"usageLimited",usage_limited:"usageLimited",goal_usage_limited:"usageLimited",rate_limited:"usageL\
imited",goal_rate_limited:"usageLimited",budgetlimited:"budgetLimited",budget_limited:"budgetLimited",goal_limited:"budg\
etLimited",goal_budget_limited:"budgetLimited",complete:"complete",completed:"complete",achieved:"complete",goal_achieved:"\
complete",cancelled:"cancelled",canceled:"cancelled",stopped:"cancelled",goal_cancelled:"cancelled",goal_canceled:"cance\
lled",goal_stopped:"cancelled",failed:"failed",failure:"failed",goal_failed:"failed"});function Km(e){return String(e||"").
trim().toLowerCase()}function Vm(e,t){return t&&typeof t.goal_lifecycle=="boolean"?t.goal_lifecycle:Gm.has(Km(e))}function wc(e){
if(typeof e=="number"&&Number.isFinite(e)&&e>0)return e;let t=Date.parse(String(e||""));return Number.isFinite(t)?t:0}function ps(...e){
for(let t of e){let n=wc(t);if(n)return new Date(n).toISOString()}return null}function $b(e){return/(?:\bbearer\s+[a-z0-9._~+/=-]{8,}|\b(?:api[_ -]?key|password|passwd|secret|access[_ -]?token|refresh[_ -]?token)\s*[:=]\s*\S+|\bsk-[a-z0-9_-]{8,})/i.
test(e)}function Ym(e){let t=String(e??"").replace(/\s+/g," ").trim();return t?Cb.test(t)?"duration_only":xb.test(t)?"du\
ration_malformed":Ab.test(t)?"age_only":Rb.test(t)?"status_only":Mb.test(t)?"placeholder_only":Tb.test(t)?"surface_label\
_only":"":"empty"}function pn(e,t=zm){if(typeof e!="string"&&typeof e!="number")return"";let n=String(e).replace(/[\u0000-\u001f\u007f]+/g,
" ").replace(/```[\s\S]*?```/g," ").replace(/\s+/g," ").trim();return!n||$b(n)||Ym(n)||/^[{[]\s*["']?[\w.-]+["']?\s*:/.test(
n)||/^(?:powershell|pwsh|cmd(?:\.exe)?|bash|sh|zsh|fish)\s+-/i.test(n)?"":(n=n.replace(/^(?:[-*•]\s+|#{1,6}\s+)/,"").trim(),
n.slice(0,t).trim())}function Xm(e){let t=String(e||"").trim().replace(/([a-z0-9])([A-Z])/g,"$1_$2").toLowerCase().replace(
/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"");return t&&(Hm[t]||Hm[t.replace(/_/g,"")])||"unknown"}function yu(e){for(let t of[
e?.state,e?.status,e?.raw_state,e?.native_state]){let n=Xm(t);if(n!=="unknown")return n}return"unknown"}function yc(e){return String(
e?.state||e?.status||"").trim().toLowerCase()}function Um(e){return pn(e?.subject||e?.text||e?.content||e?.description||
e?.label)}function ku(e,t){let n=Number(t),s=Number(e);return!Number.isInteger(n)||n<=0||!Number.isInteger(s)||s<0?null:
{completed:Math.min(s,n),total:n}}function Eb(e){let t=Number(e?.progress_percent??e?.percent_complete??e?.percent??e?.progress);
return Number.isFinite(t)?Math.max(0,Math.min(100,t<=1?t*100:t)):null}function kc(e,t={}){if(!e||typeof e!="object")return null;
let n=String(e.kind||"").trim().toLowerCase().replace(/[^a-z_]/g,"").slice(0,24);if(!n||n==="goal"&&t.goalCapable===!1)return null;
let s=pn(e.label,Sb),a=pn(e.text),i=pn(e.source,Nb).replace(/\s+/g,"_").toLowerCase();if(!s||!a||!i)return null;let c=n===
"goal"?yu(e):"unknown";if(n==="goal"&&c==="unknown")return null;let u=ku(e.completed,e.total),f=Number(e.percent);return{
kind:n,label:s,text:a,source:i,updated_at:ps(e.updated_at)||null,...u||{},...Number.isFinite(f)?{percent:Math.max(0,Math.
min(100,f))}:{},...n==="goal"?{state:c}:e.state?{state:pn(e.state,32).toLowerCase()}:{},...e.diagnostic_reason?{diagnostic_reason:String(
e.diagnostic_reason).slice(0,64)}:{}}}function Lb(e){let t=Array.isArray(e)?e:[];for(let n=t.length-1;n>=0;n-=1){let s=t[n];
if(String(s?.role||"").toLowerCase()!=="user")continue;let a=pn(s?.content||s?.text);if(a)return{text:a,updated_at:ps(s?.
timestamp,s?.created_at,s?.ts,s?.server_ts)}}return null}function vu(e,t){let n=Km(e);return n==="claude"||n==="claude_c\
li"||n==="claude-desktop"?t>1?"Tasks":"Task":["antigravity","antigravity_panel","antigravity-v2","gemini","continue","co\
ntinue_yolo","roo_code","cline"].includes(n)?"Task":t>1?"Tasks":"Plan"}function Ib(e,t){let n=t?.task_list,s=Array.isArray(
n?.tasks)?n.tasks:[],a=s.filter(_=>Um(_));if(a.length>0){let _=a.find(T=>vb.has(yc(T))),y=a.find(T=>yb.has(yc(T))),S=_||
y;if(S){let T=Number(n.total),w=Number.isInteger(T)&&T>0?T:s.length,M=Number(n.completed),d=Number.isInteger(M)&&M>=0?M:
s.filter(h=>Wm.has(yc(h))).length;return{kind:"plan",label:vu(e,w),text:Um(S),source:"task_list",updated_at:ps(S.updated_at,
S.updatedAt,n.updated_at,t.updated_at),...ku(d,w)}}}let i=t?.step,c=yc(i),u=typeof i=="object"?i?.text||i?.content||i?.description||
i?.label||i?.name:i,f=pn(u);return f&&!kb.has(c)?{kind:"plan",label:vu(e,1),text:f,source:"step",updated_at:ps(i?.updated_at,
i?.updatedAt,t.updated_at)}:null}function Ob(e){let t=e?.current;if(!t||typeof t!="object")return null;let n=pn(t.label||
t.title||t.name);if(!n)return null;let s=String(t.kind||"").trim().toLowerCase(),a=["response","thinking","generating","\
message"].includes(s);return{kind:a?"response":"activity",label:a?"Current response":"Current activity",text:n,source:s?
`current_${s}`:"current",updated_at:ps(t.updated_at,t.since,e.updated_at)}}function qb(e,t){let n=t?.context_card;if(!n||
typeof n!="object")return null;let s=pn(n.task||n.title||n.mode||n.label||n.text);return s?{kind:"task",label:vu(e,1),text:s,
source:"context_card",updated_at:ps(n.updated_at,t.updated_at)}:null}function Pb(e){let t=typeof e=="string"?{text:e}:e,
n=pn(t?.text||t?.content);return n?{kind:"request",label:"Request",text:n,source:"latest_user_request",updated_at:ps(t?.
updated_at,t?.timestamp,t?.created_at)}:null}function Db(e){let t=pn(e?.label,160);return!t||wb.has(t.toLowerCase())?null:
{kind:"activity",label:"Current activity",text:t,source:"activity_label",updated_at:ps(e?.updated_at,e?.started_at,e?.since)}}
function jb(e,t){if(!t||!e?.goal||typeof e.goal!="object")return null;let n=e.goal,s=pn(n.objective||n.text);if(!s)return null;
let a=yu(n);if(a==="unknown")return null;let i=ku(n.completed,n.total),c=Eb(n);return{kind:"goal",label:"Goal",text:s,source:"\
goal",updated_at:ps(n.updated_at,n.observed_at,e.updated_at),...i||{},...c==null?{}:{percent:c},state:a}}function Bb(e,t){
if(!e)return t;if(!t)return e;let n=wc(e.updated_at);return wc(t.updated_at)>n&&n>0?t:e}function Fb(e={}){let t=e.activity&&
typeof e.activity=="object"?e.activity:{},n=Vm(e.agentType,e.capabilities);if(e.preferProvided!==!1){let S=kc(t.work_context,
{goalCapable:n});if(S)return S}let s=jb(t,n);if(s)return kc(s,{goalCapable:n});let a=Ib(e.agentType,t),i=Ob(t),c=qb(e.agentType,
t),u=Pb(e.latestUserRequest),f=Db(t),_=bb.has(String(t.kind||"").toLowerCase()),y=a||c;return _&&i&&(y=Bb(y,i)),y||(y=i||
c||u||f),!y&&u&&(y=u),y||(y={kind:"empty",label:"Current work",text:"Current work unavailable",source:"none",updated_at:ps(
t.updated_at),diagnostic_reason:"no_authoritative_work_context"}),kc(y,{goalCapable:n})}Qm.exports={CODEX_GOAL_AGENT_TYPES:Gm,
MAX_CONTEXT_TEXT:zm,boundedDisplayText:pn,coherentGoalState:yu,goalLifecycleSupported:Vm,latestUserRequestFromMessages:Lb,
normalizeFleetWorkContext:kc,normalizeGoalState:Xm,projectFleetWorkContext:Fb,rejectedDisplayTextReason:Ym,timestampMs:wc}});var Xg=new Set(["js","jsx","ts","tsx","py","json","md","css","html","htm","sh","bash","yaml","yml","txt","env","csv","xm\
l","sql","go","rs","java","c","cpp","h","hpp","rb","php","swift","kt","scala","r","m","tf","toml","ini","cfg","conf","lo\
g","gitignore","dockerfile","makefile","vue","svelte","graphql","gql"]),Qg={js:"javascript",jsx:"jsx",ts:"typescript",tsx:"\
tsx",py:"python",rb:"ruby",sh:"bash",bash:"bash",rs:"rust",kt:"kotlin",tf:"hcl",md:"markdown",yml:"yaml",yaml:"yaml",graphql:"\
graphql",gql:"graphql"};function Br(e){let t=e.split(".").pop().toLowerCase();return Qg[t]||t}function Wd(e){let t=e.split(
".").pop().toLowerCase();return Xg.has(t)}var Gd={claude:"Claude Code",claude_cli:"Claude Code CLI",codex:"Codex",codex_cli:"\
Codex CLI",cursor_cli:"Cursor CLI",gemini:"Gemini",continue:"Continue",continue_yolo:"Continue YOLO",roo_code:"Roo Code",
cline:"Cline",antigravity:"Antigravity",antigravity_panel:"Antigravity Chat","codex-desktop":"Codex Desktop",cursor:"Cur\
sor","claude-desktop":"Claude Desktop"},Jg=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function zd(e,t){if(e&&typeof e=="object"){let f=Gd[e.agent_type]||e.display_name||e.agent_type||"Agent",_=e.workspace_name||
e.window_title||"";return _?f+" \u2014 "+_:f}let n=t||e;if(typeof n!="string")return"Agent";if(Jg.test(n))return"Agent S\
ession";let s=n.split("-"),a=s[0],i=s[1]||"",c=s[2]||"",u=i?" (win "+i+c+")":"";return(Gd[a]||a)+u}function Be(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}function kn(e){return Be(String(
e)).replace(/"/g,"&quot;")}function Ur(e){return/^[A-Za-z]:\\/.test(e)||e.includes("\\")||e.includes("/")||/^[.~]\//.test(
e)}function Zg(e){let t=0,n=0;return e.split(`
`).forEach(s=>{/^\+\+\+|^---|^@@/.test(s)||(s.startsWith("+")&&t++,s.startsWith("-")&&n++)}),{adds:t,dels:n}}function eh(e){
return/\b(edit|edited|patch|diff|apply_patch|write)\b/i.test(String(e||""))}function th(e){let t=String(e||"").replace(/\r\n?/g,
`
`).split(`
`).map(n=>n.trimEnd());for(let n of t)if(n){if(/^(diff --git|index )/.test(n)||/^@@/.test(n)||/^---[ \t]/.test(n)||/^\+\+\+[ \t]/.
test(n))return!0;if(/^[+\- ]/.test(n)){let s=n.slice(1).trim();if(!s||/^[\d\s()+\-]+$/.test(s))continue;return!0}}return!1}function nh(e){let t=(e||"").toLowerCase();return t.includes("bash")||t.includes("run")||t.includes("command")||t.includes(
"execute")?"dot-bash":t.includes("read")?"dot-read":t.includes("edit")||t.includes("write")||t.includes("patch")?"dot-wr\
ite":t.includes("search")||t.includes("grep")||t.includes("find")||t.includes("glob")?"dot-search":t.includes("browser")||
t.includes("web")||t.includes("fetch")?"dot-browser":"dot-default"}function Yd(e){let t=String(e||"").split(`
`),n=[],s=[],a=null,i=!1;function c(){let f=s.join(`
`).trim();f&&n.push({type:"markdown",content:f}),s=[]}function u(){if(!a)return;let f=a.lines.join(`
`).trimEnd();n.push({type:"tool",name:a.name,content:f}),a=null}return t.forEach(f=>{let _=/^```/.test(f.trim()),y=i?null:
f.match(/^\[([^\]\n]+)\]\s*$/),S=i?null:f.match(/^(Ran .+|Read .+|Edited file|Edit .+|Analyzed .+|Search(?:ed)? .+|Bash .+)\s*$/),
T=!i&&f.match(/^(\d+\s+lines?(?:\s+of\s+output)?)$/i);if(y){if(y[1].trim()==="end"){u();return}c(),u(),a={name:y[1].trim(),
lines:[]};return}if(T){c(),u(),a={name:T[1].trim(),lines:[]};return}if(S){c(),u(),a={name:S[1].trim(),lines:[]};return}a?
a.lines.push(f):s.push(f),_&&(i=!i)}),c(),u(),n.length>0?n:[{type:"markdown",content:String(e||"")}]}function Tl(e){if(!e)
return!1;let t=String(e).replace(/\r\n?/g,`
`);if(/^(diff --git|index )/m.test(t)||/^@@/m.test(t)||/^---[ \t]/m.test(t)&&/^\+\+\+[ \t]/m.test(t))return!0;let s=t.split(
`
`).map(f=>f.trimEnd()).filter(Boolean);if(s.length<4)return!1;let a=s.filter(f=>/^[+-](?![-+]{2})/.test(f)).length,i=s.filter(
f=>/^\+(?!\+\+ )/.test(f)).length,c=s.filter(f=>/^-(?!-- )/.test(f)).length,u=s.filter(f=>/^ /.test(f)).length;return a>=
3&&i>=1&&c>=1&&u>=1}function Xd(e){let t=e.match(/^\+\+\+[ \t]+(?:[ab]\/)?(.+?)(?:\t.*)?$/m);if(t){let s=t[1].trim();if(s&&
s!=="/dev/null")return s}let n=e.match(/^---[ \t]+(?:[ab]\/)?(.+?)(?:\t.*)?$/m);if(n){let s=n[1].trim();if(s&&s!=="/dev/\
null")return s}return null}var Kd=300;function sh(e,t){if(e.length>Kd||t.length>Kd)return null;let n=e.length,s=t.length,
a=Array.from({length:n+1},()=>new Int32Array(s+1));for(let f=1;f<=n;f++)for(let _=1;_<=s;_++)a[f][_]=e[f-1]===t[_-1]?a[f-
1][_-1]+1:Math.max(a[f-1][_],a[f][_-1]);let i=[],c=n,u=s;for(;c>0||u>0;)c>0&&u>0&&e[c-1]===t[u-1]?(i.unshift({type:"eq"}),
c--,u--):u>0&&(c===0||a[c][u-1]>=a[c-1][u])?(i.unshift({type:"ins"}),u--):(i.unshift({type:"del"}),c--);return i}function ah(e){
let t=[],n=0,s=null;for(let a of e)a.type==="del"?(s===null&&(s=n),n++):a.type==="eq"&&(s!==null&&(t.push({start:s,end:n}),
s=null),n++);return s!==null&&t.push({start:s,end:n}),t}function rh(e){let t=[],n=0,s=null;for(let a of e)a.type==="ins"?
(s===null&&(s=n),n++):a.type==="eq"&&(s!==null&&(t.push({start:s,end:n}),s=null),n++);return s!==null&&t.push({start:s,end:n}),
t}function Vd(e,t,n){if(!t||!t.length)return e;let s="",a=0,i=0,c=!1,u=0;for(;u<e.length;)if(e[u]==="<"){c&&(s+="</mark>",
c=!1);let f=e.indexOf(">",u);if(f===-1){s+=e[u++];continue}s+=e.slice(u,f+1),u=f+1,i<t.length&&a>=t[i].start&&a<t[i].end&&
(s+=`<mark class="${n}">`,c=!0)}else{if(c&&a>=t[i].end&&(s+="</mark>",c=!1,i++),!c&&i<t.length&&a>=t[i].start&&(s+=`<mar\
k class="${n}">`,c=!0),e[u]==="&"){let f=e.indexOf(";",u+1),_=f!==-1&&f-u<=8?f+1:u+1;s+=e.slice(u,_),u=_}else s+=e[u++];
a++}return c&&(s+="</mark>"),s}function Qd(e){let t=Jd(e);return t.length>0&&t[t.length-1].trim()===""&&t.pop(),t.map((n,s)=>`\
<span class="code-line"><span class="code-line-num">${s+1}</span>${n}</span>`).join("")}var oh=/[A-Za-z]:\\[^\n"'`<>]+?\.[A-Za-z0-9._-]+(?:\s+\((?:Lines?|Line)\s+\d+(?:-\d+)?\))?|(?:\.{1,2}[\\/])?(?:[A-Za-z0-9_.-]+[\\/])+[A-Za-z0-9_.-]+\.[A-Za-z0-9._-]+(?:\s+\((?:Lines?|Line)\s+\d+(?:-\d+)?\))?/g;
function ih(e){let t=String(e||""),n="",s=0;for(let a of t.matchAll(oh)){let i=a[0],c=a.index||0,u=c+i.length,f=c>0?t[c-
1]:"",_=u<t.length?t[u]:"",y=(!f||/[\s([{"'`]/.test(f))&&(!_||/[\s)\]},"'`:;]/.test(_)),S=i.trim();!y||!Ur(S)||(n+=Be(t.
slice(s,c)),n+=`<button class="inline-file-ref tool-open-file" type="button" title="Open file preview" data-open-path="${kn(
S)}" data-copy-path="${kn(S)}">${Be(S)}</button>`,s=u)}return n+=Be(t.slice(s)),n||"&nbsp;"}function ch(e){let t=String(
e||"").replace(/\r\n/g,`
`).split(`
`);return t.length>0&&t[t.length-1]===""&&t.pop(),t.map((n,s)=>`<span class="code-line"><span class="code-line-num">${s+
1}</span>${ih(n)}</span>`).join("")}function Rl(e,t){return`<span class="diff-gutter"><span class="diff-gutter-num diff-\
gutter-old">${e??""}</span><span class="diff-gutter-num diff-gutter-new">${t??""}</span></span>`}function Fr(e){return`<\
span class="diff-gutter"><span class="diff-gutter-num">${e??""}</span></span>`}function lh(e){let t=0,n=0;for(let s of e)
if(s.type==="hunk"){let a=s.raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);a&&(t=parseInt(a[1],10)-1,n=parseInt(a[2],
10)-1),s.oldLine=null,s.newLine=null}else s.type==="add"?(s.oldLine=null,s.newLine=++n):s.type==="del"?(s.oldLine=++t,s.
newLine=null):s.type==="ctx"?(s.oldLine=++t,s.newLine=++n):(s.oldLine=null,s.newLine=null)}function uh(e,t,n){let s=[],a=u=>n.
has(u)?n.get(u):t&&t[u]!=null?t[u]:Be(e[u].raw.startsWith("+")||e[u].raw.startsWith("-")||e[u].raw.startsWith(" ")?e[u].
raw.slice(1):e[u].raw),i=u=>t&&t[u]!=null?" diff-hl":"",c=0;for(;c<e.length;){let u=e[c];if(u.type==="meta"){let w=`<spa\
n class="diff-meta">${Be(u.raw)}</span>`;s.push({type:"both",html:w}),c++;continue}if(u.type==="hunk"){let w=`<span clas\
s="diff-hunk">${Be(u.raw)}</span>`;s.push({type:"both",html:w}),c++;continue}if(u.type==="ctx"){s.push({type:"ctx",content:a(
c),hlCls:i(c),oldLine:u.oldLine,newLine:u.newLine}),c++;continue}let f=c;for(;f<e.length&&e[f].type==="del";)f++;let _=f;
for(;_<e.length&&e[_].type==="add";)_++;let y=f-c,S=_-f,T=Math.min(y,S);for(let w=0;w<T;w++)s.push({type:"pair",delContent:a(
c+w),delHlCls:i(c+w),addContent:a(f+w),addHlCls:i(f+w),delOldLine:e[c+w].oldLine,addNewLine:e[f+w].newLine});for(let w=T;w<
y;w++)s.push({type:"del",content:a(c+w),hlCls:i(c+w),oldLine:e[c+w].oldLine});for(let w=T;w<S;w++)s.push({type:"add",content:a(
f+w),hlCls:i(f+w),newLine:e[f+w].newLine});c=_>c?_:c+1}return s}function dh(e){let t=[],n=[];for(let s of e)s.type==="bo\
th"?(t.push(s.html),n.push(s.html)):s.type==="ctx"?(t.push(`<span class="diff-ctx${s.hlCls}">${Fr(s.oldLine)}${s.content}\
</span>`),n.push(`<span class="diff-ctx${s.hlCls}">${Fr(s.newLine)}${s.content}</span>`)):s.type==="pair"?(t.push(`<span\
 class="diff-del${s.delHlCls}">${Fr(s.delOldLine)}${s.delContent}</span>`),n.push(`<span class="diff-add${s.addHlCls}">${Fr(
s.addNewLine)}${s.addContent}</span>`)):s.type==="del"?(t.push(`<span class="diff-del${s.hlCls}">${Fr(s.oldLine)}${s.content}\
</span>`),n.push('<span class="diff-empty"></span>')):s.type==="add"&&(t.push('<span class="diff-empty"></span>'),n.push(
`<span class="diff-add${s.hlCls}">${Fr(s.newLine)}${s.content}</span>`));return`<div class="diff-split"><div class="diff\
-split-col diff-split-old"><code class="hljs diff-code">${t.join("")}</code></div><div class="diff-split-col diff-split-\
new"><code class="hljs diff-code">${n.join("")}</code></div></div>`}function Jd(e){let t=[],n="",s=[],a=0;for(;a<e.length;)
if(e[a]===`
`)t.push(n+"</span>".repeat(s.length)),n=s.map(i=>`<span class="${i}">`).join(""),a++;else if(e[a]==="<")if(e.startsWith(
"</span>",a))s.pop(),n+="</span>",a+=7;else if(e.startsWith("<span",a)){let i=e.indexOf(">",a);if(i===-1){n+=e[a++];continue}
let c=e.slice(a,i+1),u=c.match(/class="([^"]*)"/);s.push(u?u[1]:""),n+=c,a=i+1}else n+=e[a++];else n+=e[a++];return(n||s.
length)&&t.push(n+"</span>".repeat(s.length)),t}function Zd(e,t){let n=(()=>{if(!t||typeof hljs>"u")return null;if(hljs.
getLanguage(t))return t;let d=t.split(".").pop().toLowerCase();return hljs.getLanguage(d)?d:null})(),a=e.split(`
`).map(d=>/^\+\+\+|^---/.test(d)?{type:"meta",raw:d}:/^@@/.test(d)?{type:"hunk",raw:d}:d.startsWith("+")?{type:"add",raw:d}:
d.startsWith("-")?{type:"del",raw:d}:{type:"ctx",raw:d});lh(a);let i=null;if(n)try{let d=a.map(g=>g.type==="meta"||g.type===
"hunk"?"":g.raw.startsWith("+")||g.raw.startsWith("-")||g.raw.startsWith(" ")?g.raw.slice(1):g.raw),h=hljs.highlight(d.join(
`
`),{language:n});i=Jd(h.value)}catch{i=null}let c=new Map;for(let d=0;d<a.length;){if(a[d].type!=="del"){d++;continue}let h=d;
for(;h<a.length&&a[h].type==="del";)h++;let g=h;for(;g<a.length&&a[g].type==="add";)g++;let A=h-d,N=g-h;if(A===N&&A>0)for(let $=0;$<
A;$++){let x=d+$,O=h+$,Y=a[x].raw.slice(1),te=a[O].raw.slice(1),ie=sh(Y,te);if(!ie)continue;let ge=ie.filter(V=>V.type===
"eq").length,z=Math.max(Y.length,te.length);if(z>0&&ge/z<.15)continue;let ae=i&&i[x]!=null?i[x]:Be(Y),_e=i&&i[O]!=null?i[O]:
Be(te);c.set(x,Vd(ae,ah(ie),"diff-word-del")),c.set(O,Vd(_e,rh(ie),"diff-word-add"))}d=g>d?g:d+1}let u=0,f=0,_=0,y=!1,S=a.
map((d,h)=>{if(d.type==="meta")return`<span class="diff-meta">${Be(d.raw)}</span>`;if(d.type==="hunk")return y=!0,_++,`<\
span class="diff-hunk diff-hunk-btn" data-hunk-id="${_}" role="button" tabindex="0" title="Toggle context lines">${Be(d.
raw)}</span>`;let g=d.raw.startsWith("+")||d.raw.startsWith("-")||d.raw.startsWith(" ")?d.raw.slice(1):d.raw,A=c.has(h)?
c.get(h):i&&i[h]!=null?i[h]:Be(g),N=i&&i[h]!=null?" diff-hl":"",$=_>0?` data-hunk-ctx="${_}"`:"";return d.type==="add"?(u++,
`<span class="diff-add${N}"${$}>${Rl(null,d.newLine)}${A}</span>`):d.type==="del"?(f++,`<span class="diff-del${N}"${$}>${Rl(
d.oldLine,null)}${A}</span>`):`<span class="diff-ctx${N}"${$}>${Rl(d.oldLine,d.newLine)}${A}</span>`}),T=u||f?`<span cla\
ss="diff-stat-add">+${u}</span><span class="diff-stat-del">-${f}</span>`:"",w=uh(a,i,c),M=dh(w);return{body:S.join(""),stats:T,
splitHtml:M,hasHunks:y}}var ep='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke\
-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3"/><path d="M1\
6 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3"/><line x1="12" y1="3" x2="12" y2="21"/></svg>',ph='<svg width="14" height="14" \
viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><c\
ircle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',mh='<svg class="copy-icon" width="14" \
height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoi\
n="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9\
a2 2 0 0 1 2 2v1"></path></svg>',fh='<svg class="check-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stro\
ke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:none"><polyline point\
s="20 6 9 17 4 12"></polyline></svg>';var tp=new marked.Renderer;tp.code=function(e,t){let n=typeof e=="object"?e.text||e.raw||"":e||"",a=(typeof e=="object"?
e.lang||"":t||"").split(/\s/)[0].toLowerCase()||"text",i=a==="diff"||a==="patch"||Tl(n),c=!i&&(a==="text"||a==="markdown"),
u,f="",_="",y="",S=null;if(i){_=Xd(n)||"";let O=_?Br(_):null;S=Zd(n,O),u=S.body,f=S.stats,y=S.splitHtml||""}else if(c)u=
ch(n);else try{u=hljs.getLanguage(a)?hljs.highlight(n,{language:a}).value:hljs.highlightAuto(n).value}catch{u=Be(n)}let T=n;
!i&&!c&&(u=Qd(u));let w=i||a==="text"?"":a,M=_?`<button class="diff-filepath" title="Open file preview" data-copy-path="${kn(
_)}" data-open-path="${kn(_)}">${Be(_)}</button>`:"",d=y?`<button class="diff-split-toggle" title="Toggle side-by-side v\
iew">${ep}</button>`:"",h=i&&S&&S.hasHunks?'<button class="diff-ctx-collapse-all" title="Collapse/expand all context lin\
es">Context</button>':"",g=!1,A="",N=typeof localStorage<"u"&&localStorage.getItem("codeblock_wrap_pref")==="1",$=`<butt\
on class="code-wrap-toggle${N?" active":""}" title="${N?"Disable word wrap":"Enable word wrap"}">${N?"No Wrap":"Wrap"}</\
button>`,x=i?"":` data-raw="${kn(T)}"`;return`<div class="code-block${i?" diff-block":""}${g?" code-collapsible":""}${N?
" code-wrap":""}" data-diff-mode="unified">
    <div class="code-header">
      <span class="code-lang">${w}</span>
      ${M}
      <span class="diff-stats">${f}</span>
      ${h}
      ${d}
      ${A}
      ${$}
      <button class="code-search-btn" title="Search in block">${ph}</button>
      <button class="code-copy" title="Copy code">${mh}${fh}<span class="copy-label">Copy</span></button>
    </div>
    <div class="code-search-bar" hidden>
      <input class="code-search-input" type="text" placeholder="Search\u2026" aria-label="Search in code block">
      <span class="code-search-count"></span>
      <button class="code-search-prev" title="Previous match">&#8593;</button>
      <button class="code-search-next" title="Next match">&#8595;</button>
      <button class="code-search-close" title="Close search">&#10005;</button>
    </div>
    <pre><code class="hljs${i?" diff-code":""}"${x}>${u}</code></pre>
    ${y}
  </div>`};marked.use({renderer:tp,breaks:!0,gfm:!0});function gh(e,t){let n=(e||"").toLowerCase();if(n==="bash"||n==="r\
un"||n==="execute"||n==="shell"){let a=t.find(i=>i.trim());return a?a.trim().substring(0,80):""}let s=t.find(a=>a.trim());
return s&&Ur(s.trim())?s.trim():s?s.trim().substring(0,60):""}function hh(e,t,n){let s=String(t||"").replace(/\n+$/,"").
split(`
`),a=s.find(ge=>ge.trim()),i=a&&Ur(a.trim())?a.trim():"",c=(ge,z="")=>{let ae=String(ge||"").trim();if(!ae)return"";let _e=[
"tool-path",z,Ur(ae)?"tool-open-file":""].filter(Boolean).join(" ");return Ur(ae)?`<button class="${_e}" type="button" t\
itle="Open file preview" data-open-path="${kn(ae)}" data-copy-path="${kn(ae)}">${Be(ae)}</button>`:`<span class="${_e}">${Be(
ae)}</span>`},u=s.filter((ge,z,ae)=>!(z===ae.length-1&&ae[z]==="")).length,f=/^\d+\s+lines?(?:\s+of\s+output)?$/i.test(e.
trim()),_=s.some(ge=>ge.trim()),y=f&&u===0||!_,T=/^Bash\b/i.test(e.trim())&&s.every(ge=>{let z=ge.trim();return!z||/^\$\s+/.
test(z)}),w=!_,M=s.join(`
`),d=Zg(t),h=Tl(t)||eh(e)&&(d.adds||d.dels),g=h&&Xd(t)||i,A=h&&g?Br(g):null,N=(()=>{if(!h)return M;let ge=M,z=ge.match(/```(?:diff|patch)?\s*\n([\s\S]*?)```\s*$/m);
z&&(ge=z[1]);let ae=ge.split(`
`),_e=0;for(;_e<ae.length;){let V=ae[_e];if(V.startsWith("+")||V.startsWith("-")||V.startsWith("@@")||V.startsWith(" "))
break;_e++}return ae.slice(_e).join(`
`)})(),$=h&&th(N),x=$?Zd(N,A):null,O=d.adds||d.dels?`<span class="tool-stat-add">+${d.adds}</span><span class="tool-stat\
-del">-${d.dels}</span>`:"",Y=h?(()=>{for(let ge of s){let z=ge.trim();if(z&&!z.startsWith("```")&&!z.startsWith("+")&&!z.
startsWith("-")&&!z.startsWith("@@")&&!z.startsWith(" "))return z}return""})():"",te=w&&!g?Y||gh(e,s):Y||"",ie=!y&&($||!h);
return`<section class="tool-section${w?" collapsed":""}" data-tool-index="${n}">
    <button class="tool-toggle" type="button" aria-expanded="${w?"false":"true"}">
      <span class="tool-chevron">${ie?w?"\u25B8":"\u25BE":""}</span>
      <span class="tool-dot ${nh(e)}">\u25CF</span>
      <span class="tool-toggle-main">
        ${(()=>{let ge=e.indexOf(" ");if(ge>0){let z=e.substring(0,ge),ae=e.substring(ge+1).trim();return`<span class="t\
ool-name">${Be(z)}</span>${c(ae)}`}return`<span class="tool-name">${Be(e)}</span>`})()}
        ${g?c(g,"tool-path-secondary"):""}
        ${te?`<span class="tool-preview">${Be(te)}</span>`:""}
      </span>
      <span class="tool-toggle-side">
        ${O}
        ${f&&u>0?`<span class="tool-line-count">${u} lines</span>`:""}
      </span>
    </button>
    ${ie?`<div class="tool-body"${w?" hidden":""}>
      ${$?`<div class="code-block diff-block tool-diff-block" data-diff-mode="unified">
            <div class="code-header">
              <span class="code-lang"></span>
              ${g?`<button class="diff-filepath" title="Open file preview" data-copy-path="${kn(g)}" data-open-path="${kn(
g)}">${Be(g)}</button>`:""}
              <span class="diff-stats">${x?.stats||""}</span>
              ${x?.hasHunks?'<button class="diff-ctx-collapse-all" title="Collapse/expand all context lines">Context</bu\
tton>':""}
              ${x?.splitHtml?`<button class="diff-split-toggle" title="Toggle side-by-side view">${ep}</button>`:""}
            </div>
            <pre><code class="hljs diff-code">${x?.body||""}</code></pre>
            ${x?.splitHtml||""}
          </div>`:(()=>{let ge=np(M);if(ge)return sp(ge,n+"_b");let z=M.trim();return z.startsWith("```")?`<div class="t\
ool-body-md">${marked.parse(z)}</div>`:`<pre class="tool-body-pre"><code>${Be(M)}</code></pre>`})()}
    </div>`:""}
  </section>`}var _h=/^IN\n\n?```([^\n]*)\n([\s\S]*?)\n```\n\n?OUT(?:\n\n?```([^\n]*)\n([\s\S]*?)\n```)?[\s]*$/,bh=/^IN\n([\s\S]*?)(?:\nOUT\n([\s\S]*))?$/;
function np(e){if(!e)return null;let t=e.replace(/\r\n/g,`
`);if(!t.startsWith(`IN
`))return null;let n=t.match(_h);if(n)return{inLang:n[1]||"",inText:n[2]||"",outLang:n[3]||"",outText:n[4]||""};let s=t.
match(bh);return s?{inLang:"",inText:(s[1]||"").trim(),outLang:"",outText:(s[2]||"").trim()}:null}function sp(e,t){let n=(e.
inText||"").trimEnd().split(`
`),s=(e.outText||"").trimEnd().split(`
`),a=(c,u)=>{let f=Be(u.join(`
`)),_=u.length===0||u.length===1&&!u[0].trim()?'<span class="tool-io-empty">(no output)</span>':"";return`<div class="to\
ol-io-row">
      <span class="tool-io-label">${c}</span>
      <div class="tool-io-content">${_||`<code class="tool-io-code">${f}</code>`}</div>
    </div>`},i=s.length===0||s.length===1&&!s[0].trim();return`<div class="tool-io-block" data-tool-index="${t}">${a("IN",
n)}${i?"":a("OUT",s)}</div>`}function vh(e){let t=String(e||"").replace(/\r\n/g,`
`);if(!t.trim())return null;let n=t.split(`
`),s=/^\s*(\d+)\s+file(?:\(s\)|s?)\s+changed(?:\s+in\s+this\s+conversation)?/i,a=n.findIndex(g=>s.test(g));if(a===-1)return null;
let i=n[a].trim(),c=i.match(s);if(!c)return null;let u=g=>{let A=String(g||"").match(/\+(\d+)\s+(?:\u00c2\u00b7|·|-|\s)\s*-?(\d+)/);
return A?{adds:Number(A[1])||0,dels:Number(A[2])||0}:null},f=u(i),_=null,y=[],S="",T=a;for(let g=a+1;g<n.length;g++){let A=n[g].
trim();if(!A)continue;if(!f){let te=u(A);if(te){f=te,T=g;continue}}let N=A.match(/^\+(\d+)$/);if(N){_=Number(N[1])||0,T=
g;continue}let $=A.match(/^-(\d+)$/);if($&&_!=null&&!f){f={adds:_,dels:Number($[1])||0},_=null,T=g;continue}let x=A.match(
/^\+(\d+)\s+(?:\u00c2\u00b7|·|-|\s)\s*-?(\d+)$/);if(x&&S){y.push({filepath:S,adds:Number(x[1])||0,dels:Number(x[2])||0}),
S="",T=g;continue}let O=A.match(/^(.+?)\s+\+(\d+)\s+(?:\u00c2\u00b7|·|-|\s)\s*-?(\d+)(?:\s+.*)?$/);if(!O){if(Ur(A)){S=A,
T=g;continue}break}let Y=O[1].trim();if(!Y||/^\+?\d+$/.test(Y))break;y.push({filepath:Y,adds:Number(O[2])||0,dels:Number(
O[3])||0}),S="",T=g}if(y.length===0)return null;let w=f?.adds??y.reduce((g,A)=>g+A.adds,0),M=f?.dels??y.reduce((g,A)=>g+
A.dels,0),d=n.slice(0,a).join(`
`).replace(/\s+$/g,""),h=n.slice(T+1).join(`
`).replace(/^\s+/g,"");return{count:Number(c[1])||y.length,title:i.replace(/\s+\+\d+.*$/,"").trim(),adds:w,dels:M,entries:y,
beforeText:d,afterText:h}}function yh(e,t){let n=e.entries.map(s=>`<div class="file-changes-item">
      <span class="file-changes-path">${Be(s.filepath)}</span>
      <span class="file-changes-stats"><span class="diff-stat-add">+${s.adds}</span><span class="diff-stat-del">-${s.dels}\
</span></span>
    </div>`).join("");return`<section class="file-changes-section" data-file-changes-index="${t}">
    <button class="file-changes-toggle" type="button" aria-expanded="true">
      <span class="file-changes-chevron">v</span>
      <span class="file-changes-icon">files</span>
      <span class="file-changes-title">${Be(e.title||`${e.count} file(s) changed`)}</span>
      <span class="file-changes-summary">
        <span class="diff-stat-add">+${e.adds}</span>
        <span class="diff-stat-del">-${e.dels}</span>
      </span>
    </button>
    ${e.entries.length?`<div class="file-changes-list">${n}</div>`:""}
  </section>`}function kh(e,t){let n;try{n=JSON.parse(e)}catch{return null}if(!n||!Array.isArray(n.items)||!n.items.length)
return null;let s=n.title||"Subagents",a=n.items.map((i,c)=>{let u=String(i.status||"unknown").toLowerCase(),f=u==="runn\
ing"?'<span class="subagent-spinner" aria-hidden="true"></span>':u==="done"?'<span class="subagent-icon subagent-icon-do\
ne" aria-hidden="true">&#10003;</span>':u==="failed"?'<span class="subagent-icon subagent-icon-fail" aria-hidden="true">\
&#10007;</span>':'<span class="subagent-icon subagent-icon-unknown" aria-hidden="true">&#9679;</span>',_=String(i.prompt||
"").trim(),y=String(i.stats||"").trim(),S=Array.isArray(i.tool_calls)?i.tool_calls.filter(Boolean):[],T=S.length?`<ul cl\
ass="subagent-calls">${S.map(w=>`<li><code>${Be(w)}</code></li>`).join("")}</ul>`:"";return`<li class="subagent-item sub\
agent-status-${Be(u)}">
      <div class="subagent-row">${f}<div class="subagent-prompt" title="${Be(_)}">${Be(_)}</div></div>
      ${y?`<div class="subagent-stats">${Be(y)}</div>`:""}
      ${T}
    </li>`}).join("");return`<section class="subagents-section" data-subagents-index="${t}">
    <div class="subagents-header"><span class="subagents-icon" aria-hidden="true">&#9783;</span><span class="subagents-t\
itle">${Be(s)}</span></div>
    <ul class="subagents-list">${a}</ul>
  </section>`}function wh(e){let t=String(e||"").match(/^Task Completed\s*\n+([\s\S]*?)\s*$/);return t?{content:t[1].replace(
/HAS_CHANGES\s*$/i,"").trimEnd(),wrap:!0}:{content:e,wrap:!1}}function Sh(e){return`<section class="task-completed-secti\
on">
    <div class="task-completed-header">
      <span class="task-completed-icon" aria-hidden="true">&#10003;</span>
      <span class="task-completed-title">Task Completed</span>
    </div>
    <div class="task-completed-body">${e}</div>
  </section>`}function Nh(e){let t=[],n=/^~~~subagents\s*\n([\s\S]*?)\n~~~\s*$/gm;return{content:String(e||"").replace(n,
(a,i)=>{let c=kh(i,t.length)||"";return t.push(c),`\0SUBAGENTS_BLOCK_${t.length-1}\0`}),blocks:t}}function Ch(e){let{content:t,
wrap:n}=wh(e);e=t;let{content:s,blocks:a}=Nh(e);e=s;let c=Yd(e).map((y,S)=>{try{if(y.type==="tool")return hh(y.name,y.content,
S);let T=np(y.content);if(T)return sp(T,S);let w=vh(y.content);if(w){let M=yh(w,S),d=(w.beforeText||"").trim()?marked.parse(
w.beforeText):"",h=(w.afterText||"").trim()?marked.parse(w.afterText):"";return d+M+h}return(y.content||"").trim()?marked.
parse(y.content||""):""}catch(T){return'<pre style="color:var(--red,#f26d78);font-size:11px">[render error: '+Be(String(
T))+"]</pre><pre>"+Be(y.content||"")+"</pre>"}}).join("");a.length&&(c=c.replace(/\s*SUBAGENTS_BLOCK_(\d+)\s*/g,(y,S)=>a[Number(
S)]||""));let u=document.createElement("div");typeof DOMPurify<"u"?u.innerHTML=DOMPurify.sanitize(c,{ADD_DATA_URI_TAGS:[
"img"],ALLOW_DATA_ATTR:!0}):u.textContent=c;let _=Array.from(u.querySelectorAll(".diff-block")).map((y,S)=>{let T=y.querySelector(
".diff-filepath");if(!T)return null;let w=T.textContent.trim();if(!w)return null;let M=y.querySelector(".diff-stat-add, \
.tool-stat-add"),d=y.querySelector(".diff-stat-del, .tool-stat-del"),h=M&&parseInt(M.textContent,10)||0,g=d&&parseInt(d.
textContent,10)||0;return y.id=`diff-file-${S}`,{filepath:w,adds:h,dels:g,id:`diff-file-${S}`}}).filter(Boolean);if(_.length>=
2){let y=_.reduce((d,h)=>d+h.adds,0),S=_.reduce((d,h)=>d+h.dels,0),T=_.map(d=>{let h=d.filepath.split(/[/\\]/).pop();return`\
<a class="diff-summary-chip" data-target="${kn(d.id)}" href="#${kn(d.id)}" title="${kn(d.filepath)}"><span class="diff-s\
ummary-name">${Be(h)}</span><span class="diff-stat-add">+${d.adds}</span><span class="diff-stat-del">-${d.dels}</span></\
a>`}).join(""),w=`<span class="diff-summary-totals"><span class="diff-summary-count">${_.length} files</span><span class\
="diff-stat-add">+${y}</span><span class="diff-stat-del">-${S}</span></span>`,M=document.createElement("div");M.className=
"diff-summary-bar",M.innerHTML=T+w,u.insertBefore(M,u.firstChild)}return n?Sh(u.innerHTML):u.innerHTML}function xh(e){let t=[],
n=0,s=document.createTreeWalker(e,NodeFilter.SHOW_TEXT,null),a;for(;a=s.nextNode();){if(a.parentElement&&a.parentElement.
classList.contains("code-line-num"))continue;let i=a.nodeValue.length;t.push({node:a,start:n,end:n+i}),n+=i}return{text:t.
map(i=>i.node.nodeValue).join(""),ranges:t}}function Wi(e){if(!e)return;let t=e.querySelector("code");if(!t)return;t.querySelectorAll(
"mark.code-search-mark").forEach(s=>{let a=s.parentNode;a&&(a.replaceChild(document.createTextNode(s.textContent),s),a.normalize())});
let n=e.querySelector(".code-search-count");n&&(n.textContent=""),delete e._searchState}function Ah(e){if(!e)return;Wi(e);
let t=e.querySelector(".code-search-input"),n=t?t.value:"";if(!n)return;let s=e.querySelector("code");if(!s)return;let{text:a,
ranges:i}=xh(s),c=a.toLowerCase(),u=n.toLowerCase(),f=[],_=0;for(;_<a.length;){let T=c.indexOf(u,_);if(T===-1)break;f.push(
T),_=T+n.length}if(!f.length){let T=e.querySelector(".code-search-count");T&&(T.textContent="0 / 0");return}let y=[];for(let T=f.
length-1;T>=0;T--){let w=f[T],M=w+n.length,d=i.filter(h=>h.end>w&&h.start<M);for(let h=d.length-1;h>=0;h--){let g=d[h],A=Math.
max(0,w-g.start),N=Math.min(g.node.nodeValue.length,M-g.start),$=g.node,x=$.nodeValue,O=document.createElement("mark");O.
className="code-search-mark",O.textContent=x.slice(A,N);let Y=$.parentNode;N<x.length&&Y.insertBefore(document.createTextNode(
x.slice(N)),$.nextSibling),Y.insertBefore(O,N<x.length?$.nextSibling.previousSibling:$.nextSibling),A>0?$.nodeValue=x.slice(
0,A):Y.removeChild($),y.unshift(O)}}e._searchState={marks:y,current:0};let S=e.querySelector(".code-search-count");S&&(S.
textContent=y.length?`1 / ${y.length}`:"0 / 0"),y.length&&(y[0].classList.add("current"),y[0].scrollIntoView({block:"nea\
rest"}))}function Gi(e,t){if(!e||!e._searchState)return;let{marks:n}=e._searchState;if(!n.length)return;n[e._searchState.
current].classList.remove("current"),e._searchState.current=(e._searchState.current+t+n.length)%n.length;let s=n[e._searchState.
current];s.classList.add("current"),s.scrollIntoView({block:"nearest"});let a=e.querySelector(".code-search-count");a&&(a.
textContent=`${e._searchState.current+1} / ${n.length}`)}function Rh(e){let t=[],n=0;for(;n<e.length;)(n===0||e[n-1]===`\

`)&&e[n]==="`"&&e[n+1]==="`"&&e[n+2]==="`"?(t.push(n),n+=3):n++;if(t.length%2===0)return null;let s=t[t.length-1],a=e.slice(
s+3),i=a.indexOf(`
`);if(i===-1)return{lang:"text",code:""};let u=a.slice(0,i).trim().split(/\s/)[0].toLowerCase()||"text",f=a.slice(i+1);return{
lang:u,code:f}}var Hr=new Map,Bo=null,da=new Map,Ml=0,Mh=256,Th=8*1024*1024;function $h(e){let t=String(e||""),n=2166136261;
for(let s=0;s<t.length;s+=1)n^=t.charCodeAt(s),n=Math.imul(n,16777619);return(n>>>0).toString(36)}function Eh(e,t){let n=e?.
closest?.(".message")||e;if(!n||typeof IntersectionObserver>"u")return t(),()=>{};Bo||(Bo=new IntersectionObserver(a=>{for(let i of a){
if(!i.isIntersecting)continue;let c=Hr.get(i.target);if(c){Hr.delete(i.target),Bo.unobserve(i.target);for(let u of c)u()}}},
{root:null,rootMargin:"35% 0px",threshold:0}));let s=Hr.get(n);return s||(s=new Set,Hr.set(n,s),Bo.observe(n)),s.add(t),
()=>{let a=Hr.get(n);a&&(a.delete(t),!(a.size>0)&&(Hr.delete(n),Bo?.unobserve(n)))}}function Lh(e,t){let n=String(e||""),
s=`${t||"content"}${n.length}${$h(n)}`,a=da.get(s);if(a&&a.content===n)return da.delete(s),da.set(s,a),a.html;let i=Ch(
n),c=typeof DOMPurify<"u"?DOMPurify.sanitize(i,{ADD_DATA_URI_TAGS:["img"],ALLOW_DATA_ATTR:!0}):i,u=(n.length+c.length)*2;
for(da.set(s,{content:n,html:c,bytes:u}),Ml+=u;da.size>Mh||Ml>Th;){let f=da.keys().next().value,_=da.get(f);da.delete(f),
Ml-=_?.bytes||0}return c}function Gr({content:e,monospace:t=!1,onOpenPath:n=null,autoExpandLongCodeBlocks:s=!1,deferUntilVisible:a=!1,
cacheIdentity:i=""}){let c=React.useRef(null),u=React.useRef(null),f=React.useRef(n),[_,y]=React.useState(!a);return f.current=
n,React.useEffect(()=>{if(!a){y(!0);return}if(!_)return Eh(c.current,()=>y(!0))},[a,_]),React.useEffect(()=>{if(!c.current||
!_||e===u.current)return;let S=u.current;if(S!==null&&e.startsWith(S)){let d=Rh(e);if(d&&!Tl(d.code)){let h=c.current.querySelectorAll(
".code-block:not(.diff-block)"),A=(h.length>0?h[h.length-1]:null)?.querySelector(":scope > pre"),N=A?.querySelector("cod\
e");if(N){let $=A.scrollTop,x;try{x=typeof hljs<"u"&&hljs.getLanguage(d.lang)?hljs.highlight(d.code,{language:d.lang}).value:
Be(d.code)}catch{x=Be(d.code)}N.innerHTML=Qd(x),N.dataset.raw=d.code,A.scrollTop=$,u.current=e;return}}}let T={toolCollapsed:{},
fileChangesCollapsed:{},codeScroll:[],ctxHidden:{},ctxCollapseActive:{}};u.current!==null&&(c.current.querySelectorAll("\
.tool-section[data-tool-index]").forEach(d=>{T.toolCollapsed[d.dataset.toolIndex]=d.classList.contains("collapsed")}),c.
current.querySelectorAll(".file-changes-section[data-file-changes-index]").forEach(d=>{T.fileChangesCollapsed[d.dataset.
fileChangesIndex]=d.classList.contains("collapsed")}),c.current.querySelectorAll(".code-block pre").forEach((d,h)=>{T.codeScroll[h]=
d.scrollTop}),c.current.querySelectorAll(".diff-block, .tool-diff-block").forEach((d,h)=>{d.querySelectorAll(".diff-hunk\
-btn").forEach(A=>{T.ctxHidden[`${h}:${A.dataset.hunkId}`]=A.classList.contains("diff-hunk-ctx-collapsed")});let g=d.querySelector(
".diff-ctx-collapse-all");g&&(T.ctxCollapseActive[h]=g.classList.contains("active"))})),u.current=e,c.current.innerHTML=
Lh(e,i),c.current.querySelectorAll(".tool-section[data-tool-index]").forEach(d=>{let h=d.dataset.toolIndex;if(!(h in T.toolCollapsed))
return;let g=T.toolCollapsed[h],A=d.classList.contains("collapsed");if(g!==A){d.classList.toggle("collapsed",g);let N=d.
querySelector(".tool-body"),$=d.querySelector(".tool-chevron"),x=d.querySelector(".tool-toggle");N&&(N.hidden=g),$&&($.textContent=
g?"\u25B8":"\u25BE"),x&&x.setAttribute("aria-expanded",g?"false":"true")}}),c.current.querySelectorAll(".file-changes-se\
ction[data-file-changes-index]").forEach(d=>{let h=d.dataset.fileChangesIndex;if(!(h in T.fileChangesCollapsed))return;let g=T.
fileChangesCollapsed[h],A=d.classList.contains("collapsed");if(g!==A){d.classList.toggle("collapsed",g);let N=d.querySelector(
".file-changes-list"),$=d.querySelector(".file-changes-chevron"),x=d.querySelector(".file-changes-toggle");N&&(N.hidden=
g),$&&($.textContent=g?">":"v"),x&&x.setAttribute("aria-expanded",g?"false":"true")}}),c.current.querySelectorAll(".diff\
-block, .tool-diff-block").forEach((d,h)=>{let g=d.querySelector("code");if(g&&(d.querySelectorAll(".diff-hunk-btn").forEach(
A=>{let N=`${h}:${A.dataset.hunkId}`;!(N in T.ctxHidden)||!T.ctxHidden[N]||(g.querySelectorAll(`[data-hunk-ctx="${A.dataset.
hunkId}"].diff-ctx`).forEach($=>$.classList.add("diff-ctx-hidden")),A.classList.add("diff-hunk-ctx-collapsed"))}),T.ctxCollapseActive[h])){
let A=d.querySelector(".diff-ctx-collapse-all");A&&A.classList.add("active")}}),c.current.querySelectorAll(".code-copy").
forEach(d=>{d.onclick=()=>{let h=d.closest(".code-block").querySelector("code"),g=h.dataset.raw!==void 0?h.dataset.raw:h.
textContent;navigator.clipboard.writeText(g).then(()=>{d.querySelector(".copy-icon").style.display="none",d.querySelector(
".check-icon").style.display="",d.querySelector(".copy-label").textContent="Copied",d.classList.add("copied"),setTimeout(
()=>{d.querySelector(".copy-icon").style.display="",d.querySelector(".check-icon").style.display="none",d.querySelector(
".copy-label").textContent="Copy",d.classList.remove("copied")},2e3)}).catch(()=>{})}}),c.current.querySelectorAll(".too\
l-toggle").forEach(d=>{d.onclick=()=>{let h=d.closest(".tool-section"),g=h?.querySelector(".tool-body"),A=d.querySelector(
".tool-chevron"),N=h.classList.toggle("collapsed");g&&(g.hidden=N),A&&(A.textContent=N?"\u25B8":"\u25BE"),d.setAttribute(
"aria-expanded",N?"false":"true")}}),c.current.querySelectorAll(".file-changes-toggle").forEach(d=>{d.onclick=()=>{let h=d.
closest(".file-changes-section"),g=h?.querySelector(".file-changes-list"),A=d.querySelector(".file-changes-chevron"),N=h.
classList.toggle("collapsed");g&&(g.hidden=N),A&&(A.textContent=N?">":"v"),d.setAttribute("aria-expanded",N?"false":"tru\
e")}}),c.current.querySelectorAll(".tool-io-more-btn").forEach(d=>{d.onclick=()=>{let h=d.closest(".tool-io-preview"),g=h?.
nextElementSibling;!h||!g||(h.hidden=!0,g.hidden=!1)}}),c.current.querySelectorAll(".tool-io-collapse-btn").forEach(d=>{
d.onclick=()=>{let h=d.closest(".tool-io-full"),g=h?.previousElementSibling;!h||!g||(h.hidden=!0,g.hidden=!1)}}),c.current.
querySelectorAll(".diff-summary-chip").forEach(d=>{d.onclick=h=>{h.preventDefault();let g=d.dataset.target,A=g&&c.current.
querySelector(`#${CSS.escape(g)}`);A&&(A.scrollIntoView({behavior:"smooth",block:"nearest"}),c.current.querySelectorAll(
".diff-summary-chip").forEach(N=>N.classList.remove("active")),d.classList.add("active"))}}),c.current.querySelectorAll(
".diff-split-toggle").forEach(d=>{d.onclick=()=>{let h=d.closest(".diff-block");if(!h)return;let g=h.querySelector(":sco\
pe > pre"),A=h.querySelector(".diff-split"),$=!(h.dataset.diffMode==="split");h.dataset.diffMode=$?"split":"unified",d.classList.
toggle("active",$),d.title=$?"Toggle unified view":"Toggle side-by-side view"}}),c.current.querySelectorAll(".diff-filep\
ath[data-copy-path], .tool-open-file[data-open-path], .inline-file-ref[data-open-path]").forEach(d=>{d.onclick=h=>{h.stopPropagation();
let g=d.dataset.openPath||d.dataset.copyPath,A=f.current;if(g&&typeof A=="function"){h.preventDefault(),A(g);return}d.dataset.
copyPath&&navigator.clipboard.writeText(g).then(()=>{let N=d.textContent;d.textContent="Copied!",d.classList.add("diff-f\
ilepath-copied"),setTimeout(()=>{d.textContent=N,d.classList.remove("diff-filepath-copied")},1500)}).catch(()=>{})}}),c.
current.querySelectorAll(".code-expand-toggle").forEach(d=>{d.onclick=()=>{let h=d.closest(".code-block");if(!h)return;let g=h.
classList.toggle("code-expanded");d.textContent=g?"Collapse":"Expand",d.title=g?"Collapse block":"Expand block",g||h.scrollIntoView(
{behavior:"smooth",block:"nearest"})}}),s&&c.current.querySelectorAll(".code-collapsible").forEach(d=>{d.classList.add("\
code-expanded");let h=d.querySelector(".code-expand-toggle");h&&(h.textContent="Collapse",h.title="Collapse block")}),c.
current.querySelectorAll(".code-wrap-toggle").forEach(d=>{d.onclick=()=>{let h=localStorage.getItem("codeblock_wrap_pref")!==
"1";localStorage.setItem("codeblock_wrap_pref",h?"1":"0"),c.current.querySelectorAll(".code-block").forEach(g=>{g.classList.
toggle("code-wrap",h);let A=g.querySelector(".code-wrap-toggle");A&&(A.textContent=h?"No Wrap":"Wrap",A.title=h?"Disable\
 word wrap":"Enable word wrap",A.classList.toggle("active",h))})}}),c.current.querySelectorAll(".code-search-btn").forEach(
d=>{d.onclick=()=>{let h=d.closest(".code-block");if(!h)return;let g=h.querySelector(".code-search-bar"),A=h.querySelector(
".code-search-input");if(!g)return;!g.hidden?(Wi(h),g.hidden=!0,d.classList.remove("active")):(g.hidden=!1,d.classList.add(
"active"),A&&A.focus())}}),c.current.querySelectorAll(".code-search-input").forEach(d=>{d.oninput=()=>Ah(d.closest(".cod\
e-block")),d.onkeydown=h=>{let g=d.closest(".code-block");h.key==="Enter"&&(h.shiftKey?Gi(g,-1):Gi(g,1),h.preventDefault()),
h.key==="Escape"&&(Wi(g),g.querySelector(".code-search-bar").hidden=!0,g.querySelector(".code-search-btn").classList.remove(
"active"))}}),c.current.querySelectorAll(".code-search-next").forEach(d=>{d.onclick=()=>Gi(d.closest(".code-block"),1)}),
c.current.querySelectorAll(".code-search-prev").forEach(d=>{d.onclick=()=>Gi(d.closest(".code-block"),-1)}),c.current.querySelectorAll(
".code-search-close").forEach(d=>{d.onclick=()=>{let h=d.closest(".code-block");Wi(h),h.querySelector(".code-search-bar").
hidden=!0,h.querySelector(".code-search-btn").classList.remove("active")}}),c.current.querySelectorAll(".diff-hunk-btn").
forEach(d=>{d.onclick=h=>{h.stopPropagation();let g=d.dataset.hunkId,A=d.closest("code");if(!A)return;let N=A.querySelectorAll(
`[data-hunk-ctx="${g}"].diff-ctx`),$=N.length>0&&N[0].classList.contains("diff-ctx-hidden");N.forEach(x=>x.classList.toggle(
"diff-ctx-hidden",!$)),d.classList.toggle("diff-hunk-ctx-collapsed",!$)},d.onkeydown=h=>{(h.key==="Enter"||h.key===" ")&&
(h.preventDefault(),d.click())}}),c.current.querySelectorAll(".diff-ctx-collapse-all").forEach(d=>{d.onclick=()=>{let h=d.
closest(".diff-block, .tool-diff-block");if(!h)return;let g=h.querySelector("code");if(!g)return;let A=g.querySelectorAll(
".diff-ctx"),$=Array.from(A).some(x=>!x.classList.contains("diff-ctx-hidden"));A.forEach(x=>x.classList.toggle("diff-ctx\
-hidden",$)),g.querySelectorAll(".diff-hunk-btn").forEach(x=>x.classList.toggle("diff-hunk-ctx-collapsed",$)),d.classList.
toggle("active",$),d.title=$?"Expand all context lines":"Collapse all context lines"}}),c.current.querySelectorAll(".too\
l-show-all").forEach(d=>{d.onclick=()=>{let g=d.closest(".tool-body")?.querySelector("code"),A=d.closest(".tool-section");
if(!g||!A)return;let N=Number(A.dataset.toolIndex||"-1"),$=Yd(e||"")[N];!$||$.type!=="tool"||(g.textContent=$.content||"",
d.remove())}}),T.codeScroll.length&&c.current.querySelectorAll(".code-block pre").forEach((d,h)=>{h<T.codeScroll.length&&
T.codeScroll[h]>0&&(d.scrollTop=T.codeScroll[h])});let w=null,M=c.current.querySelector(".diff-summary-bar");if(M&&typeof IntersectionObserver<
"u"){let d=Array.from(c.current.querySelectorAll(".diff-block[id]"));if(d.length>=2){let h=null,g=c.current.parentElement;
for(;g&&g!==document.body;){let N=window.getComputedStyle(g);if(N.overflowY==="auto"||N.overflowY==="scroll"||N.overflow===
"auto"||N.overflow==="scroll"){h=g;break}g=g.parentElement}let A=new IntersectionObserver(N=>{N.forEach($=>{if(!$.isIntersecting)
return;let x=$.target.id;M.querySelectorAll(".diff-summary-chip").forEach(O=>{O.classList.toggle("active",O.dataset.target===
x)})})},{root:h,threshold:.1});d.forEach(N=>A.observe(N)),w=()=>A.disconnect()}}return()=>{w&&w()}},[e,s,i,_]),React.createElement(
"div",{className:`message-body${t?" monospace-body":""}`,ref:c,"data-rich-content-ready":_?"true":"false"})}function $l(e,t=null,n=Date.now()){return{sessionId:e,messageId:null,blockIndex:0,seq:-1,content:"",open:!0,startedAtMs:n,
clientMessageId:t}}function ap(e,t,n=!1){if(!e||String(e.content||"").length>0||n)return!1;let s=String(t?.kind||"idle").
toLowerCase();return["idle","waiting_for_user","completed","done","failed","error","interrupted"].includes(s)}function rp(e,t,n=Date.
now()){let s=t?.session_id||t?.session||"",a=t?.message_id||"",i=Number(t?.block_index),c=Number(t?.seq);return!s||!a||!Number.
isSafeInteger(i)||i<0||!Number.isSafeInteger(c)||c<0?{accepted:!1,code:"invalid_identity",stream:e||null}:t.op==="block_\
open"?c!==0?{accepted:!1,code:"invalid_open_sequence",stream:e||null}:{accepted:!0,stream:{...$l(s,e?.clientMessageId||null,
e?.startedAtMs||n),messageId:a,blockIndex:i,seq:c}}:!e||e.messageId!==a||e.blockIndex!==i||!e.open?{accepted:!1,code:"st\
ream_not_open",stream:e||null}:c!==e.seq+1?{accepted:!1,code:"sequence_gap",stream:e}:t.op==="append"?typeof t.append!="\
string"||t.append.length===0?{accepted:!1,code:"invalid_append",stream:e}:{accepted:!0,stream:{...e,seq:c,content:`${e.content||
""}${t.append}`}}:t.op==="block_close"?{accepted:!0,stream:{...e,seq:c,open:!1}}:{accepted:!1,code:"invalid_operation",stream:e}}function ls(e){if(e==null||e==="")return null;let t=null;if(typeof e=="number"||typeof e=="string"&&/^\d+(?:\.\d+)?$/.test(
e.trim())){let s=Number(e);Number.isFinite(s)&&s>0&&(t=s>1e12?s:s*1e3)}else{let s=Date.parse(String(e));Number.isFinite(
s)&&s>0&&(t=s)}if(!Number.isFinite(t)||t<=0)return null;let n=new Date(t);return Number.isNaN(n.getTime())?null:{epoch_ms:n.
getTime(),epoch_seconds:n.getTime()/1e3,iso:n.toISOString()}}function Wr(e){return!e||typeof e!="object"?null:ls(e.created_at)||
ls(e.timestamp)||ls(e.ts)||null}function zr(e){if(!e||typeof e!="object")return e;let t=Wr(e);return!t||e.timestamp===t.
iso&&e.timestamp_ms===t.epoch_ms&&Number(e.ts)===t.epoch_seconds?e:{...e,ts:t.epoch_seconds,timestamp:t.iso,timestamp_ms:t.
epoch_ms}}function ip(e){if(!Array.isArray(e))return[];let t=!1,n=e.map(s=>{let a=zr(s);return a!==s&&(t=!0),a});return t?
n:e}function op(e,t){return new Intl.DateTimeFormat("en-US-u-ca-gregory",{year:"numeric",...t?{timeZone:t}:{}}).format(e)}
function El(e,t=new Date,n=void 0,s=void 0){let a=e&&typeof e=="object"&&Number.isFinite(e.epoch_ms)?e:ls(e);if(!a)return"";
let i=new Date(a.epoch_ms),c={...op(i,s)===op(t,s)?{}:{year:"numeric"},month:"short",day:"numeric",hour:"numeric",minute:"\
2-digit",...s?{timeZone:s}:{}};return new Intl.DateTimeFormat(n,c).format(i)}function cp(e,t=void 0,n=void 0){let s=e&&typeof e==
"object"&&Number.isFinite(e.epoch_ms)?e:ls(e);return s?`${new Intl.DateTimeFormat(t,{dateStyle:"full",timeStyle:"long",...n?
{timeZone:n}:{}}).format(new Date(s.epoch_ms))} (${s.iso})`:""}function lp(){let e=new Map,t=2048,n="";return{reset(s=""){let a=String(s||"");a!==n&&(n=a,e.clear())},accept(s,a){let i=Number(
s?.state_seq);if(!Number.isSafeInteger(i)||i<0)return!0;let c=String(s?.state_epoch||n||"legacy");if(n&&c!==n)return!1;n||
(n=c);let u=String(a||s?.type||"state"),f=e.get(u);if(f?.epoch===c&&i<=f.seq)return!1;for(e.has(u)&&e.delete(u),e.set(u,
{epoch:c,seq:i});e.size>t;)e.delete(e.keys().next().value);return!0},size(){return e.size}}}var zi=/(?:!\[[^\]]*\]\([^)]*\)|\[File:\s*[^\]]+\]|\b(?:image|screenshot|screen\s*shot|capture)[\w .()[\]-]*\.(?:png|jpe?g|gif|webp|bmp|svg)\b)/gi,
Ki=/(?:[A-Za-z]:[\\/]|\\\\[^\\/\s]+[\\/]|\/(?:Users|home|mnt|var|tmp|etc|opt|workspace|workspaces)\/)[^\s"'`<>)]{2,}/gi,
Ih=/^(?=.*\d)(?:(?:\d+)\s*d\s*)?(?:(?:\d+)\s*h\s*)?(?:(?:\d+)\s*m\s*)?(?:(?:\d+)\s*s)?$/i,Oh=/^[+-]?\d+\s*[dhms]\b/i,qh=/^(?:just now|today|yesterday|(?:\d+|an?|one)\s+(?:seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?)\s+ago)$/i,
Ph=/^(?:pursuing goal|paused goal|goal (?:paused|blocked|usage limited|rate limited|limited|budget limited|achieved|cancelled|canceled|stopped|failed)|idle|ready|connected|awaiting live update)$/i,
Dh=/^(?:no (?:recent message|current work|data|activity)(?: reported)?|unavailable|unknown|not available)$/i,jh=/^(?:(?:antigravity|claude(?: code)?|cline|codex|continue|cursor|gemini|roo code)\s+(?:harness|workspace))$/i,
up=new Set(["agent","agentmanager","agentsession","antigravity","antigravitychat","antigravityv2","claude","claudecli","\
claudecode","claudecodecli","claudedesktop","cline","codex","codexcli","codexdesktop","connected","connectedsession","co\
ntinue","continueyolo","cursor","cursoragent","cursorcli","cursoride","gemini","geminicodeassist","newchat","newconversa\
tion","other","proceed","resume","roocode","session","unknown","attachment","file","image","screenshot","disregardthatla\
stmessage","ignorethatlastmessage"]);function Kr(e){return typeof e=="string"?e:Array.isArray(e)?e.map(Kr).filter(Boolean).
join(`
`):!e||typeof e!="object"?"":Kr(e.text||e.content||e.markdown||e.value||"")}function Ll(){zi.lastIndex=0,Ki.lastIndex=0}
function Bh(e){let t=Kr(e).replace(/\s+/g," ").trim();return t?Ih.test(t)?"duration_only":Oh.test(t)?"duration_malformed":
qh.test(t)?"age_only":Ph.test(t)?"status_only":Dh.test(t)?"placeholder_only":jh.test(t)?"surface_label_only":"":"empty"}
function pa(e){let t=Kr(e).replace(/\s+/g," ").trim();if(!t||Bh(t)||/^\[(?:attachment|file|image|screenshot)(?:\s*:[^\]]*)?\]$/i.
test(t)||/^new\s+(?:antigravity|claude|codex|continue|cursor|gemini|roo)(?:\s+(?:agent|chat|cli|code|desktop|ide|panel))*\s+(?:chat|conversation|session|thread)$/i.
test(t))return!0;let n=zi.test(t)||Ki.test(t);if(Ll(),n){let a=t.replace(zi," ").replace(Ki," ").replace(/\b(?:read|open|view|inspect|check|review|show|load|attach|attached|upload|uploaded|file|image|screenshot)\b/gi,
" ").replace(/[^a-z0-9]+/gi,"").trim();if(Ll(),a.length<12)return!0}let s=t.toLowerCase().replace(/[^a-z0-9]+/g,"").replace(
/^remoteagent(?:chat)?/,"");return s?up.has(s)?!0:(s=s.replace(/(?:new|production|session|chat|smoke|test|probe|verification|fixture|extension|ext|ide|app|panel|pane)$/g,
""),up.has(s)):!/[\p{L}\p{N}]/u.test(t)}function mp(e){let t=Kr(e);if(!t)return"";let n=t.replace(/<goal_context>[\s\S]*?<\/goal_context>/gi,
" ").replace(/```[\s\S]*?```/g," ").replace(zi," ").replace(Ki," ").replace(/<[^>\n]{1,120}>/g," ").replace(/`([^`]+)`/g,
"$1").replace(/^\s*(?:user|assistant|codex|claude|tool result)\s*[:\-]\s*/i,"").replace(/\s+/g," ").trim();return Ll(),!n||
pa(n)||/^(?:thinking|working|tool result|tool:|exit code|wall time|read|open|view|inspect|check|review|show|load|attach|attached|uploaded|file|image|screenshot)\b/i.
test(n)&&n.split(/\s+/).length<=4||/^[^\p{L}\p{N}]+$/u.test(n)?"":n.slice(0,80).trim()}function Fh(e){let t=Array.isArray(
e)?e:[];for(let n of t){if(String(n?.role||"").toLowerCase()!=="user")continue;let s=mp(n?.content||n?.content_blocks);if(s)
return s}return""}var dp=Object.freeze({fallback:0,route:.5,message:1,summary:2,custom:3,native:4}),Hh=Object.freeze(["c\
odex_desktop_active_thread_title","cursor_agent_title","native_chat_title","session_title","thread_title","conversation_\
title","title","display_title","summary","chat_title","chat_title_source","thread_name","conversation_name","custom_disp\
lay_name","is_new_chat_draft","is_list_view"]);function pp(e){return Kr(e).replace(/\s+/g," ").trim()}function fp(e){return!e||
typeof e!="object"?{}:Object.fromEntries(Hh.filter(t=>Object.prototype.hasOwnProperty.call(e,t)).map(t=>[t,e[t]]))}function Il(e,t="",n=[],s=""){
let a=e&&typeof e=="object"?e:{},c=[["codex_desktop_active_thread_title",a.codex_desktop_active_thread_title],["cursor_a\
gent_title",a.cursor_agent_title],["native_chat_title",a.native_chat_title],["session_title",a.session_title],["thread_t\
itle",a.thread_title],["conversation_title",a.conversation_title],["title",a.title],["display_title",a.display_title],["\
chat_title",a.chat_title_source==="summary"?"":a.chat_title],["thread_name",a.thread_name],["conversation_name",a.conversation_name]].
map(([S,T])=>({field:S,title:pp(T)})).find(S=>S.title&&!pa(S.title));if(c)return{title:c.title.slice(0,80).trim(),source:"\
native",field:c.field};let u=pp(t);if(u&&!pa(u))return{title:u.slice(0,80).trim(),source:"custom",field:"custom_display_\
name"};let _=[["chat_title",a.chat_title_source==="summary"?a.chat_title:""],["summary",a.summary],["derived_message_tit\
le",s]].map(([S,T])=>({field:S,title:mp(T)})).find(S=>S.title);if(_)return{title:_.title,source:"summary",field:_.field};
let y=Fh(n);return y?{title:y,source:"message",field:"first_meaningful_user_message"}:{title:"New chat",source:"fallback",
field:"new_chat"}}function gp(e,t){if(!e?.title)return t;if(!t?.title)return e;let n=dp[e.source]??0;return(dp[t.source]??
0)>=n?t:e}function hp(e,t="",n=[],s=""){return Il(e,t,n,s).title}var Uh=/(?:\bbearer\s+[a-z0-9._~+/=-]{8,}|\b(?:api[_ -]?key|password|passwd|secret|access[_ -]?token|refresh[_ -]?token)\s*[:=]\s*\S+|\bsk-[a-z0-9_-]{8,})/i,
Gh=/(?:[A-Za-z]:[\\/]|\\\\[^\\/\s]+[\\/]|\/(?:Users|home|mnt|var|tmp|etc|opt|workspace|workspaces)\/)[^\s"'<>)]{2,}/i;function Wh(e){
let t=0;for(let n of String(e||"")){let s=n.codePointAt(0);t+=s<=127?1:s<=2047?2:s<=65535?3:4}return t}function Hn(e,t=96){
if(typeof e!="string"&&typeof e!="number")return"";let n=String(e).replace(/[\u0000-\u001f\u007f]+/g," ").replace(/\s+/g,
" ").trim();return!n||Uh.test(n)||Gh.test(n)?"":n.slice(0,t).trim()}function Vi(e){if(e==null||e==="")return null;let t=typeof e==
"number"&&Number.isFinite(e)?e:NaN,n=Number.isFinite(t)?t>0&&t<1e12?t*1e3:t:Date.parse(String(e));return Number.isFinite(
n)&&n>0?new Date(n).toISOString():null}function zh(e){let t=String(e||"").trim().toLowerCase().replace(/[^a-z]/g,"");return{
active:"active",paused:"paused",blocked:"blocked",usagelimited:"usageLimited",ratelimited:"usageLimited",budgetlimited:"\
budgetLimited",complete:"complete",completed:"complete",cancelled:"cancelled",canceled:"cancelled",failed:"failed",idle:"\
idle",working:"working"}[t]||null}function Ol(e){if(!e||typeof e!="object"||Number(e.schema_version)!==1)return null;let t={
schema_version:1,parser_version:Hn(e.parser_version,32)||"fleet-summary-v1",session_key:Hn(e.session_key,40),session_generation:Math.
max(1,Number(e.session_generation)||1),thread_key:Hn(e.thread_key,40),thread_generation:Math.max(1,Number(e.thread_generation)||
1),producer_seq:Math.max(0,Number(e.producer_seq)||0),summary_seq:Math.max(0,Number(e.summary_seq)||0),title:Hn(e.title,
80)||null,title_source:Hn(e.title_source,24)||null,title_confidence:["authoritative","derived","unknown"].includes(e.title_confidence)?
e.title_confidence:"unknown",latest_user_request:Hn(e.latest_user_request)||null,latest_user_request_at:Vi(e.latest_user_request_at),
current_work:Hn(e.current_work)||null,current_work_source:Hn(e.current_work_source,32)||null,current_work_kind:Hn(e.current_work_kind,
24)||null,current_work_state:zh(e.current_work_state),current_work_at:Vi(e.current_work_at),last_role:["user","assistant"].
includes(e.last_role)?e.last_role:null,last_message_at:Vi(e.last_message_at),last_snippet:Hn(e.last_snippet)||null,message_count:Math.
max(0,Number(e.message_count)||0),user_count:Math.max(0,Number(e.user_count)||0),assistant_count:Math.max(0,Number(e.assistant_count)||
0),other_count:Math.max(0,Number(e.other_count)||0),role_imbalance:["balanced","assistant_without_user","user_without_as\
sistant"].includes(e.role_imbalance)?e.role_imbalance:"balanced",rejected_candidate_reason:Hn(e.rejected_candidate_reason,
48)||null,fresh_at:Vi(e.fresh_at)};return!t.session_key||!t.thread_key||Wh(JSON.stringify(t))>1024?null:t}function _p(e){
return e?.title_confidence==="authoritative"?3:e?.title_confidence==="derived"?2:e?.title?1:0}function bp(e,t){let n=Ol(
e),s=Ol(t);if(!s)return{summary:n,accepted:!1,changed:!1,reason:"invalid"};if(!n)return{summary:{...s,summary_seq:Math.max(
1,s.summary_seq)},accepted:!0,changed:!0,reason:"initial"};if(s.session_generation<n.session_generation)return{summary:n,
accepted:!1,changed:!1,reason:"older_session_generation"};if(s.session_generation===n.session_generation&&s.session_key!==
n.session_key)return{summary:n,accepted:!1,changed:!1,reason:"session_identity_mismatch"};if(s.session_generation===n.session_generation&&
s.thread_generation<n.thread_generation)return{summary:n,accepted:!1,changed:!1,reason:"older_thread_generation"};if(s.session_generation===
n.session_generation&&s.thread_generation===n.thread_generation&&s.thread_key!==n.thread_key)return{summary:n,accepted:!1,
changed:!1,reason:"thread_identity_mismatch"};let a=s.session_generation>n.session_generation||s.thread_generation>n.thread_generation,
i=s.producer_seq>n.producer_seq||s.producer_seq===n.producer_seq&&s.summary_seq>n.summary_seq;if(!a&&!i)return{summary:n,
accepted:!1,changed:!1,reason:"replayed_or_out_of_order"};let c=a?{...s}:{...n,...s};if(!a){(!s.title||_p(s)<_p(n))&&(c.
title=n.title,c.title_source=n.title_source,c.title_confidence=n.title_confidence);for(let f of["latest_user_request","l\
atest_user_request_at","current_work","current_work_source","current_work_kind","current_work_state","current_work_at","\
last_role","last_message_at","last_snippet","fresh_at"])(s[f]==null||s[f]==="")&&(c[f]=n[f]);for(let f of["message_count",
"user_count","assistant_count","other_count"])c[f]=Math.max(n[f]||0,s[f]||0)}c.summary_seq=Math.max(n.summary_seq||0,s.summary_seq||
0);let u=JSON.stringify(n)!==JSON.stringify(c);return{summary:u?c:n,accepted:!0,changed:u,reason:u?"upgraded":"unchanged"}}
function vp(e){let t=Ol(e);if(!t)return{};let n=t.current_work?{kind:t.current_work_kind||"activity",label:t.current_work_kind===
"goal"?"Goal":t.current_work_kind==="request"?"Request":"Current work",text:t.current_work,source:t.current_work_source||
"fleet_summary",updated_at:t.current_work_at,...t.current_work_state?{state:t.current_work_state}:{}}:null;return{fleet_summary:t,
...t.title?{chat_title:t.title,chat_title_source:t.title_source}:{},...t.latest_user_request?{last_user_request:{text:t.
latest_user_request,updated_at:t.latest_user_request_at}}:{},...t.last_snippet?{last_snippet:t.last_snippet,last_message_at:t.
last_message_at}:{},...n?{fleet_work_context:n}:{}}}var yp=new Set(["__proto__","constructor","prototype"]);function kp(e){return typeof e=="string"?e:e?.session_id||e?.id||
""}function Nt(e,t){if(Object.is(e,t))return!0;if(e==null||t==null||typeof e!=typeof t||typeof e!="object")return!1;if(Array.
isArray(e)||Array.isArray(t)){if(!Array.isArray(e)||!Array.isArray(t)||e.length!==t.length)return!1;for(let a=0;a<e.length;a+=
1)if(!Nt(e[a],t[a]))return!1;return!0}let n=Object.keys(e),s=Object.keys(t);if(n.length!==s.length)return!1;for(let a of n)
if(!Object.prototype.hasOwnProperty.call(t,a)||!Nt(e[a],t[a]))return!1;return!0}function Yi(e=[]){let t=[],n=[],s=Object.
create(null),a=Object.create(null);for(let i of Array.isArray(e)?e:[]){let c=kp(i);if(!c||Object.prototype.hasOwnProperty.
call(s,c))continue;a[c]=t.length,n.push(c);let u=Pl(null,i);s[c]=u,t.push(u)}return{byId:s,indexById:a,order:n,list:t}}function ql(e){
return e?.is_new_chat_draft===!0}function Pl(e,t){if(!t||typeof t!="object")return t;if(ql(t)){let i={...t};for(let c of[
"fleet_summary","fleet_work_context","last_user_request","last_snippet","last_message_at"])delete i[c];return i}let n=bp(
e?.fleet_summary,t.fleet_summary).summary;if(!n)return t;let s=vp(n),a={...t,...s};return s.fleet_work_context&&a.activity&&
typeof a.activity=="object"&&!a.activity.work_context&&(a.activity={...a.activity,work_context:s.fleet_work_context}),a}
function wp(e,t){return!e||typeof e!="object"||!t||typeof t!="object"||ql(t)||pa(e.chat_title)||!pa(t.chat_title)?t:{...t,
chat_title:e.chat_title,chat_title_source:e.chat_title_source||t.chat_title_source||null}}function Fo(e,t){let n=e?.byId?
e:Yi(),s=Array.isArray(t)?t:[],a=[],i=[],c=Object.create(null),u=Object.create(null),f=s.length!==n.list.length;for(let _ of s){
let y=kp(_);if(!y||Object.prototype.hasOwnProperty.call(c,y))continue;let S=n.byId[y],T=wp(S,Pl(S,_)),w=S!==void 0&&Nt(S,
T)?S:T;u[y]=a.length,i.push(y),c[y]=w,a.push(w),(!Object.is(w,S)||n.order[a.length-1]!==y)&&(f=!0)}return(a.length!==s.length||
a.length!==n.list.length)&&(f=!0),f?{byId:c,indexById:u,order:i,list:a}:n}function Sp(e,t){let n=e?.byId?e:Yi(),s=t?.session_id||
t?.session||"";if(!s||!Object.prototype.hasOwnProperty.call(n.byId,s))return n;let a=n.byId[s],i=a&&typeof a=="object"?a:
{session_id:s},c=t?.patch&&typeof t.patch=="object"?t.patch:{},u=Array.isArray(t?.removed_fields)?t.removed_fields:[],f=ql(
c),_=!f&&!pa(i.chat_title)&&(!Object.prototype.hasOwnProperty.call(c,"chat_title")||pa(c.chat_title)),y=i;for(let[M,d]of Object.
entries(c))yp.has(M)||M==="session_id"||M==="id"||_&&(M==="chat_title"||M==="chat_title_source")||Nt(y[M],d)||(y===i&&(y=
{...i}),y[M]=d);for(let M of u)typeof M!="string"||yp.has(M)||M==="session_id"||M==="id"||_&&(M==="chat_title"||M==="cha\
t_title_source")||Object.prototype.hasOwnProperty.call(y,M)&&(y===i&&(y={...i}),delete y[M]);if(f&&!Object.prototype.hasOwnProperty.
call(c,"chat_title")&&(y===i&&(y={...i}),y.chat_title=null,y.chat_title_source=null),y=wp(i,Pl(i,y)),Nt(y,i))return n;y.
session_id=s;let S=n.indexById[s],T=n.list.slice();T[S]=y;let w=Object.assign(Object.create(null),n.byId);return w[s]=y,
{byId:w,indexById:n.indexById,order:n.order,list:T}}var Np=10,mt=new Map,Ho=new Map,Kh=Object.freeze([]);function Ya(e){return String(e||"").trim()}function Vh(e){return!e||
typeof e!="object"?"":e.source_message_id?`source:${e.source_message_id}`:e.native_source_id?`native:${e.native_source_id}`:
e.id!=null?`id:${e.id}`:e.server_message_id!=null?`server:${e.server_message_id}`:e.sequence!=null?`sequence:${e.sequence}`:
e.client_message_id?`client:${e.client_message_id}`:e.client_msg_id?`client:${e.client_msg_id}`:e._cid?`client:${e._cid}`:
`content:${e.role||""}:${e.ts||""}:${String(e.content||"")}`}function Yh(e,t){let n=[],s=new Map;return[...Array.isArray(
e)?e:[],...Array.isArray(t)?t:[]].forEach(a=>{let i=Vh(a);if(i&&s.has(i)){let c=s.get(i),u=n[c],f=Array.isArray(u?.content_blocks)&&
u.content_blocks.some(y=>y?.type==="memory_citation"),_=Array.isArray(a?.content_blocks)&&a.content_blocks.some(y=>y?.type===
"memory_citation");n[c]=f&&!_?{...u,...a,content:u.content,content_blocks:u.content_blocks}:{...u,...a};return}i&&s.set(
i,n.length),n.push(a)}),n.sort((a,i)=>{let c=Number(a?.sequence),u=Number(i?.sequence);return Number.isFinite(c)&&Number.
isFinite(u)&&c!==u?c-u:(Number(a?.ts)||0)-(Number(i?.ts)||0)})}function Cp(e){let t=Ya(e);if(!t||!mt.has(t))return null;
let n=mt.get(t);return mt.delete(t),mt.set(t,n),n}function Xi(e){let t=Ya(e);return t&&mt.get(t)||Kh}function xp(e,t){let n=Ya(
e);if(!n||typeof t!="function")return()=>{};let s=Ho.get(n)||new Set;return s.add(t),Ho.set(n,s),()=>{let a=Ho.get(n);a&&
(a.delete(t),a.size===0&&Ho.delete(n))}}function Dl(e){let t=Ho.get(e);t&&[...t].forEach(n=>n())}function jl(e,t,n=Np){let s=Ya(e);if(!s||!Array.isArray(t))return[];let a=ip(t),i=mt.get(s);mt.delete(s),mt.set(s,a);let c=[],
u=Math.max(1,Number(n)||Np);for(;mt.size>u;){let f=mt.keys().next().value;mt.delete(f),c.push(f)}return i!==a&&Dl(s),c.forEach(
Dl),c}function Bl(e){let t=Ya(e);return!t||!mt.has(t)?!1:(mt.delete(t),Dl(t),!0)}function Ap(e,t){let n=Ya(e),s=Ya(t);if(!n||
!s||n===s)return Xi(s);let a=mt.get(n)||[],i=mt.get(s)||[];return a.length>0&&jl(s,Yh(i,a)),Bl(n),Xi(s)}function Xh(){return Object.
fromEntries([...mt.entries()])}function Rp(e){let t=Xh(),n=typeof e=="function"?e(t):e;if(!n||n===t||typeof n!="object")
return t;let s=new Set(Object.keys(n));return Object.keys(t).forEach(a=>{s.has(a)||Bl(a)}),Object.entries(n).forEach(([a,
i])=>{Array.isArray(i)&&t[a]!==i&&jl(a,i)}),n}var Fl=new Proxy({},{get(e,t){if(typeof t=="string")return mt.get(t)},ownKeys(){
return[...mt.keys()]},getOwnPropertyDescriptor(e,t){if(typeof t=="string"&&mt.has(t))return{configurable:!0,enumerable:!0,
value:mt.get(t)}},set(e,t,n){return typeof t!="string"||!Array.isArray(n)?!1:(jl(t,n),!0)},deleteProperty(e,t){return typeof t==
"string"?Bl(t):!1}});var Qh=new Set(["thinking","generating","reading_files","running_command","applying_patch","working"]),Jh=new Set(["wait\
ing_for_user","needs_attention","blocked","rate_limited","usage_limited","budget_limited","failed","error"]),Zh=new Set(
["blocked","usagelimited","budgetlimited","failed"]),e_=new Set(["complete","completed","cancelled","canceled"]),Mp=new Set(
["starting","running_turn","checkpoint_pending_continuation","verifying"]),t_=new Set(["waiting_for_user","blocked_limit\
ed"]),n_=new Set(["paused","completed_cancelled_failed","unknown_disconnected"]),Hl=15e3;function s_(e){return String(e?.
goal?.state||e?.goal?.status||"").trim().toLowerCase().replace(/[^a-z]/g,"")}function Tp(e){let t=e?.goal,n=e?.goal_run;
return!t||!n||n.schema_version!==1||!n.run_id||!n.goal_fingerprint||!Number.isFinite(Number(n.goal_generation))||String(
n.goal_fingerprint)!==String(t.fingerprint||"")||Number(n.goal_generation)!==Math.max(1,Number(t.generation)||1)?null:n}
function Xa(e){if(typeof e=="number"&&Number.isFinite(e))return e;let t=Date.parse(String(e||""));return Number.isFinite(
t)?t:0}function Zi(e){return Math.max(Xa(e?.transport?.client_received_at_ms),Xa(e?.transport?.relay_forwarded_at_ms),Xa(
e?.observed_at),Xa(e?.updatedAt),Xa(e?.updated_at))}function Qi(e,t={}){if(t.connected===!1||String(t.health||"").toLowerCase()===
"disconnected"||t.fresh===!1)return!1;if(t.requireFreshness!==!0)return!0;let n=Zi(e);if(!n)return!1;let s=Number.isFinite(
Number(t.nowMs))?Number(t.nowMs):Date.now(),a=Math.max(1e3,Number(t.freshnessMs)||Hl);return s-n<=a}function ec(e,t=!1,n={}){
let s=String(e?.kind||"").trim().toLowerCase(),a=s_(e),i=Tp(e),c=String(i?.lifecycle||"").trim().toLowerCase();if(t||Jh.
has(s)||t_.has(c))return"needs_attention";let u=e?.generating===!0||Qh.has(s);return i?.lease_active===!0&&i.owner_state===
"confirmed"&&Mp.has(c)&&u&&Qi(e,n)?"working_goal":Zh.has(a)?"needs_attention":i&&c==="unknown_disconnected"?"stale":i&&n_.
has(c)||e_.has(a)?"idle":i?.lease_active===!0&&Mp.has(c)?"working_goal":i&&a==="active"||a==="active"?Qi(e,n)?"between_g\
oal_turns":"stale":s==="idle"&&a!=="active"?"idle":Qi(e,n)?u?"working":"idle":"stale"}function tc(e,t={}){let n=Tp(e),s=String(
n?.lifecycle||"").trim().toLowerCase();return!n||n.lease_active!==!0?"":s==="checkpoint_pending_continuation"?"Waiting f\
or next goal turn":s==="verifying"||t.connected===!1||String(t.health||"").toLowerCase()==="disconnected"?"Reconnecting":
s==="starting"?"Starting goal":s==="running_turn"?"Working":"Goal loop active"}function $p(e){return e==="working_goal"?
"Working on goal":e==="working"?"Working":e==="between_goal_turns"?"Between goal turns":e==="needs_attention"?"Needs att\
ention":e==="stale"?"Stale":"Idle"}function Qa(e){return e==="working_goal"||e==="working"}function Ep(e,t=null,n=Date.now()){
if(!e||typeof e!="object")return 0;let s=Math.max(0,Number(e.time_used_seconds??e.timeUsedSeconds??0)||0),a=Xa(e.updated_at||
e.updatedAt),i=String(e.state||e.status||"").toLowerCase()==="active",c=t&&t.lease_active!==!0?Xa(t.lease_observed_at||t.
observed_at):Number(n),u=c>0?Math.min(Number(n)||c,c):a,f=i&&a>0?Math.max(0,Math.floor((u-a)/1e3)):0;return Math.floor(s+
f)}function Ji(e){let t=Number(e);return Number.isFinite(t)&&t>0?t:null}function Lp(e,t=Date.now()){if(!e||typeof e!="ob\
ject")return null;let n=Ji(e.proxy_emitted_at_ms),s=Ji(e.relay_received_at_ms),a=Ji(e.relay_forwarded_at_ms),i=Ji(t)||Date.
now();return{proxy_emitted_at_ms:n,relay_received_at_ms:s,relay_forwarded_at_ms:a,client_received_at_ms:i,latency_ms:n==
null?null:Math.max(0,i-n)}}function Ip(e,t=Date.now()){let n=Number(e?.transport?.latency_ms);if(Number.isFinite(n))return`${Math.
round(n)} ms`;let s=Zi(e);if(!s)return"Awaiting live update";let a=Math.max(0,Number(t)-s);return a<1e3?"Observed just n\
ow":a<6e4?`Observed ${Math.floor(a/1e3)}s ago`:a<36e5?`Observed ${Math.floor(a/6e4)}m ago`:`Observed ${Math.floor(a/36e5)}\
h ago`}var a_=Object.freeze(["goal_completed","goal_attention","provider_usage_threshold"]),r_=new Set(a_),Op=Object.freeze({goal_completed:"\
goal_completed",goal_attention:"goal_attention",provider_usage_threshold:"provider_usage_warning"}),Pp="remote-agent-cha\
t:semantic-notifications:v1",o_="remote-agent-chat:semantic-notification-claim:v1:",Dp=256,i_=10080*60*1e3;function nc(e){
if(!e||typeof e!="object"||e.type!=="semantic_notification")return null;let t=String(e.event_type||"").trim(),n=String(e.
dedupe_key||"").trim(),s=String(e.session_id||e.session||"").trim();if(!r_.has(t)||!n||!s)return null;let a=String(e.category||
Op[t]).trim();return a!==Op[t]?null:{...e,type:"semantic_notification",event_type:t,category:a,dedupe_key:n,session_id:s,
session:s,title:String(e.title||"").trim()||(t==="goal_completed"?"Goal completed":t==="provider_usage_threshold"?"Provi\
der usage warning":"Goal needs attention"),body:String(e.body||"").trim(),created_at:e.created_at||new Date().toISOString()}}
function Gl(e,t,n=100){let s=new Map;return[...Array.isArray(e)?e:[],...Array.isArray(t)?t:[t]].map(nc).filter(Boolean).
forEach(a=>s.set(a.dedupe_key,a)),[...s.values()].slice(-Math.max(1,Number(n)||100))}function jp(e,t={}){let n=nc(e);return!!n&&
t?.[n.category]===!0}function Ul(e,t){try{let n=JSON.parse(e?.getItem(Pp)||"{}");return Object.fromEntries(Object.entries(
n||{}).filter(([,s])=>Number(s)>t-i_).slice(-Dp))}catch{return{}}}function qp(e,t,n){let s=Ul(e,n);if(s[t])return!1;s[t]=
n;let a=Object.entries(s).slice(-Dp);try{e?.setItem(Pp,JSON.stringify(Object.fromEntries(a)))}catch{}return!0}function c_(e){
return new Promise(t=>setTimeout(t,e))}async function l_(e,t,n){if(!e)return!0;if(Ul(e,n)[t])return!1;let s=`${o_}${encodeURIComponent(
t).slice(0,320)}`,a=`${n}:${Math.random().toString(36).slice(2)}`;try{if(e.setItem(s,JSON.stringify({token:a,at:n})),await c_(
20),JSON.parse(e.getItem(s)||"{}").token!==a||!qp(e,t,n))return!1;let c=Ul(e,n)[t]===n;return c&&e.removeItem(s),c}catch{
return qp(e,t,n)}}async function Bp(e,{storage:t=typeof localStorage<"u"?localStorage:null,locks:n=typeof navigator<"u"?
navigator.locks:null,now:s=()=>Date.now()}={}){let a=nc(e);if(!a)return!1;let i=()=>l_(t,a.dedupe_key,s());return n?.request?
n.request(`rac-semantic:${a.dedupe_key}`,{mode:"exclusive"},i):i()}async function Ja(e,t,{channel:n="web-in-app",reasonCode:s="",
clientId:a="web-app"}={}){let i=nc(e);if(!i||!["claimed","displayed","suppressed"].includes(t)||typeof fetch!="function")
return!1;try{return(await fetch("/api/notifications/semantic-receipts",{method:"POST",credentials:"same-origin",keepalive:!0,
headers:{"Content-Type":"application/json"},body:JSON.stringify({dedupe_key:i.dedupe_key,stage:t,channel:n,...s?{reason_code:s}:
{},client_id:a})})).ok}catch{return!1}}function Fp(e,t,n=""){if(!t)return"";let s=e||{};return n&&(s[n]||[]).some(a=>a?._cid===t)?n:Object.keys(s).find(a=>(s[a]||
[]).some(i=>i?._cid===t))||""}function Hp(e,t,n,s){if(!t||!n||typeof s!="function")return e;let a=e?.[n]||[],i=!1,c=a.map(
u=>{if(u?._cid!==t)return u;let f=s(u);return f!==u&&(i=!0),f});return i?{...e,[n]:c}:e}function u_(e){let t=Number(e);return!Number.isSafeInteger(t)||t<=0?0:t}function d_(e){return String(e?.navigation_session_id||
e?.session_id||e?.session||"")}function Up(e={}){let t=Math.max(1,Number(e.maxEntries)||512),n=new Map;function s(a,i){for(n.
delete(a),n.set(a,i);n.size>t;)n.delete(n.keys().next().value)}return{accept(a){let i=d_(a),c=u_(a?.navigation_epoch);if(!i||
!c)return!0;let u=n.get(i)||0;return c<u?!1:(s(i,c),!0)},latest(a){return n.get(String(a||""))||0},get size(){return n.size}}}var p_=new Set(["user","assistant","tool","tool_result","permission","permission_prompt","question","question_prompt","e\
rror","system"]);function Qe(e){return typeof e=="string"?e:String(e?.session_id||e?.id||"")}function m_(e){let t=String(
e||"").trim().toLowerCase().replace(/[\s-]+/g,"_");return p_.has(t)?t==="permission_prompt"?"permission":t==="question_p\
rompt"?"question":t:null}function f_(e){let t=String(e||"").trim();return!t||t.length>256||/[\u0000-\u001f\u007f]/.test(
t)?null:t}function g_(e){let t=String(e||"").trim().toLowerCase().replace(/[\s-]+/g,"_");return!t||t.length>64||/[^a-z0-9_.:/]/.
test(t)?null:t}function h_(e){if(typeof e=="number"||typeof e=="string"&&/^\d+(?:\.\d+)?$/.test(e.trim())){let n=Number(
e);return!Number.isFinite(n)||n<=0?null:n>1e12?n:n*1e3}if(typeof e!="string"||!e.trim())return null;let t=Date.parse(e);
return Number.isFinite(t)&&t>0?t:null}function Za(e){if(!e||typeof e!="object")return null;let t=e.latest_visible_message&&
typeof e.latest_visible_message=="object"?e.latest_visible_message:null,n=f_(t?.id??t?.message_id??e.last_message_id),s=h_(
t?.at??t?.timestamp??e.last_message_at),a=m_(t?.kind??e.last_message_kind),i=g_(t?.source??e.last_message_source);return!n||
!s||!a||!i?null:Object.freeze({id:n,at:new Date(s).toISOString(),atMs:s,kind:a,source:i})}function zl(e){let t=Za(e);return t?
{latest_visible_message:{id:t.id,at:t.at,kind:t.kind,source:t.source},last_message_id:t.id,last_message_at:t.at,last_message_kind:t.
kind,last_message_source:t.source}:{}}function __(e,t){let n=Za(e),s=Za(t);if(n&&!s)return-1;if(!n&&s)return 1;if(!n&&!s)
return Qe(e).localeCompare(Qe(t));if(n.atMs!==s.atMs)return s.atMs-n.atMs;let a=s.id.localeCompare(n.id);return a!==0?a:
Qe(e).localeCompare(Qe(t))}function Kl(e){return(Array.isArray(e)?e:[]).filter(t=>!!Qe(t)&&!!Za(t)).slice().sort(__)}function Wl(e){
return e instanceof Set?e:!e||typeof e[Symbol.iterator]!="function"?new Set:new Set(Array.from(e,t=>String(t||"")))}function b_(e){
return!e||typeof e[Symbol.iterator]!="function"?[]:[...new Set(Array.from(e,t=>String(t||"")).filter(Boolean))]}function Gp(e){
let t=Za(e);return t?`${t.atMs}|${t.kind}|${t.source}`:""}function Wp(e){let t=new Set;return(Array.isArray(e)?e:[]).filter(
n=>{let s=Qe(n);return!s||t.has(s)?!1:(t.add(s),!0)})}function sc(e,t={}){let n=Wp(e),s=Number.isSafeInteger(t.limit)&&t.
limit>=0?t.limit:5,i=Kl(n).slice(0,s).map(Qe);return{version:1,revision:Number(t.revision||0),limit:s,sessionOrder:i,knownSessionIds:n.
map(Qe),messageRevisionById:Object.fromEntries(n.map(c=>[Qe(c),Gp(c)]).filter(([,c])=>!!c)),fallbackSessionById:Object.fromEntries(
i.map(c=>[c,n.find(u=>Qe(u)===c)]).filter(([,c])=>!!c))}}function zp(e,t,n={}){let s=Wp(t),a=Object.fromEntries(s.map(x=>[
Qe(x),x])),i=e?.version===1?e:sc(s,n),c=Number.isSafeInteger(n.limit)&&n.limit>=0?n.limit:Number(i.limit??5),f=Kl(s).map(
Qe);if((i.sessionOrder||[]).length===0&&f.length>0){let x=sc(s,{limit:c,revision:Number(i.revision||0)+1});return{ledger:x,
sessions:x.sessionOrder.map(O=>a[O]),structuralChanged:!0}}let _=new Set(i.knownSessionIds||[]),y=i.messageRevisionById||
{},S={},T=[];for(let x of s){let O=Qe(x),Y=Gp(x);Y&&(S[O]=Y,(!_.has(O)||y[O]&&y[O]!==Y)&&T.push(O))}if(n.freezeStructure&&
T.length>0)return{ledger:i,sessions:(i.sessionOrder||[]).map(x=>a[x]||i.fallbackSessionById?.[x]).filter(Boolean),structuralChanged:!1,
deferred:!0};let w=new Set(T),d=[...f.filter(x=>w.has(x))];for(let x of i.sessionOrder||[])!w.has(x)&&!d.includes(x)&&d.
push(x);for(let x of f){if(d.length>=c)break;d.includes(x)||d.push(x)}d.splice(c);let h=[..._];for(let x of Object.keys(
a))_.has(x)||h.push(x);let g={...y,...S},A=d.join("|")!==(i.sessionOrder||[]).join("|"),N=h.length!==_.size||Object.entries(
S).some(([x,O])=>y[x]!==O);if(!A&&!N&&Number(i.limit)===c)return{ledger:i,sessions:d.map(x=>a[x]||i.fallbackSessionById?.[x]).
filter(Boolean),structuralChanged:!1,deferred:!1};let $={version:1,revision:Number(i.revision||0)+(A?1:0),limit:c,sessionOrder:d,
knownSessionIds:h,messageRevisionById:g,fallbackSessionById:Object.fromEntries(d.map(x=>[x,a[x]||i.fallbackSessionById?.[x]]).
filter(([,x])=>!!x))};return{ledger:$,sessions:d.map(x=>a[x]||$.fallbackSessionById[x]).filter(Boolean),structuralChanged:A,
deferred:!1}}function Vl(e,t={}){let n=Wl(t.workingSessionIds),s=Wl(t.pinnedSessionIds),a=new Map([...s].map(($,x)=>[$,x])),
i=Wl(t.excludedSessionIds),c=Number.isSafeInteger(t.limit)&&t.limit>=0?t.limit:5,u=new Set,f=[];for(let $ of Array.isArray(
e)?e:[]){let x=Qe($);!x||u.has(x)||i.has(x)||(u.add(x),f.push($))}let _=f.filter($=>n.has(Qe($))),y=f.filter($=>!n.has(Qe(
$))),S=t.recentSessionIds==null?null:b_(t.recentSessionIds),T=new Map(y.map($=>[Qe($),$])),w=S==null?Kl(y).slice(0,c):S.
map($=>T.get($)).filter(Boolean).slice(0,c),M=new Set(w.map(Qe)),d=y.filter($=>!M.has(Qe($))),h=d.filter($=>s.has(Qe($))).
sort(($,x)=>a.get(Qe($))-a.get(Qe(x))),g=new Set(h.map(Qe)),A=d.filter($=>!g.has(Qe($))),N=Object.fromEntries([..._.map(
$=>[Qe($),"working"]),...w.map($=>[Qe($),"recent"]),...h.map($=>[Qe($),"pinned"]),...A.map($=>[Qe($),"workspace"])]);return{
working:_,recent:w,pinned:h,remaining:A,ownership:N}}var Vr=Object.freeze({live:6e4,"1m":6e4,"5m":3e5,"15m":9e5,since_open:1/0}),v_=Object.freeze({cpu_total_percent:["cpu","\
totalPercent"],cpu_user_percent:["cpu","userPercent"],cpu_privileged_percent:["cpu","privilegedPercent"],memory_used_percent:[
"memory","usedPercent"],memory_commit_percent:["memory","commitPercent"],disk_read_bps:["disk","readBps"],disk_write_bps:[
"disk","writeBps"],disk_read_iops:["disk","readIops"],disk_write_iops:["disk","writeIops"],network_receive_bps:["network",
"receiveBps"],network_send_bps:["network","sendBps"],network_receive_pps:["network","receivePps"],network_send_pps:["net\
work","sendPps"]});function ft(e,t=0){let n=Number(e);return Number.isFinite(n)?n:t}function Pt(e){if(e==null||e==="")return null;
let t=Number(e);return Number.isFinite(t)&&t>=0?t:null}function ye(e){return Math.max(0,ft(e))}function an(e){return Math.
max(0,Math.min(100,ft(e)))}function ac(e){let t=String(e??"0");return/^\d+$/.test(t)?t:"0"}function Uo(e){let t=Date.parse(
String(e||""));return Number.isFinite(t)?t:0}function y_(e,t){let n=Math.max(0,Math.round(ft(e?.pid))),s=e?.start_time?String(
e.start_time):"",a=String(e?.stable_key||`${n||"process"}:${s||t}`),i=String(e?.attribution_level||(e?.attributed?"runti\
me":"unattributed"));return{key:a,stableKey:a,parentKey:e?.parent_key?String(e.parent_key):"",pid:n,parentPid:Math.max(0,
Math.round(ft(e?.parent_pid))),startTime:s,name:String(e?.name||"Process"),status:String(e?.status||"running"),attributed:e?.
attributed===!0,attributionLevel:i,attributionReason:String(e?.attribution_reason||"No proved agent relationship"),ownedSessionId:e?.
owned_session_id?String(e.owned_session_id):"",agentLabel:e?.agent_label?String(e.agent_label):"",agentTypes:Array.isArray(
e?.agent_types)?e.agent_types.map(String):[],workspaceLabel:e?.workspace_label?String(e.workspace_label):"",sessionCount:Math.
max(0,Math.round(ft(e?.session_count))),cpuPercent:an(e?.cpu_host_percent??e?.cpu_percent),cpuHostPercent:an(e?.cpu_host_percent??
e?.cpu_percent),cpuCoreEquivalent:ye(e?.cpu_core_equivalent??e?.cpu_percent),memoryBytes:ye(e?.memory_bytes),privateBytes:ye(
e?.private_bytes??e?.memory_bytes),commitBytes:ye(e?.commit_bytes??e?.private_bytes),ioReadBps:ye(e?.io_read_bps),ioWriteBps:ye(
e?.io_write_bps),ioReadOps:ye(e?.io_read_ops),ioWriteOps:ye(e?.io_write_ops),threadCount:Math.max(0,Math.round(ft(e?.thread_count))),
handleCount:Math.max(0,Math.round(ft(e?.handle_count))),uptimeSeconds:e?.uptime_seconds==null?null:ye(e.uptime_seconds),
childCount:Math.max(0,Math.round(ft(e?.child_count))),selectedAs:Array.isArray(e?.selected_as)?e.selected_as.map(String):
[],selectedParentPresent:e?.selected_parent_present!==!1,counterTotals:{ioReadBytes:ac(e?.counter_totals?.io_read_bytes),
ioWriteBytes:ac(e?.counter_totals?.io_write_bytes),ioReadOperations:ac(e?.counter_totals?.io_read_operations),ioWriteOperations:ac(
e?.counter_totals?.io_write_operations)}}}function k_(e,t){return{id:String(e?.id||`disk-${t}`),label:String(e?.label||`\
Disk ${t+1}`),kind:String(e?.kind||"unknown"),readBps:ye(e?.read_bps),writeBps:ye(e?.write_bps),readIops:ye(e?.read_iops),
writeIops:ye(e?.write_iops),busyPercent:an(e?.busy_percent),readLatencyMs:ye(e?.read_latency_ms),writeLatencyMs:ye(e?.write_latency_ms),
queueLength:ye(e?.queue_length),capacityBytes:ye(e?.capacity_bytes),freeBytes:ye(e?.free_bytes),freePercent:an(e?.free_percent),
available:e?.available!==!1}}function w_(e,t){return{id:String(e?.id||`adapter-${t}`),label:String(e?.label||`Adapter ${t+
1}`),kind:String(e?.kind||"unknown"),physicalDefault:e?.physical_default===!0,receiveBps:ye(e?.receive_bps),sendBps:ye(e?.
send_bps),receivePps:ye(e?.receive_pps),sendPps:ye(e?.send_pps),linkSpeedBps:ye(e?.link_speed_bps),utilizationPercent:an(
e?.utilization_percent),receiveErrors:ye(e?.receive_errors),sendErrors:ye(e?.send_errors),receiveDiscards:ye(e?.receive_discards),
sendDiscards:ye(e?.send_discards),available:e?.available!==!1}}function Yp(e){if(!e||typeof e!="object")return{available:!1,
status:"waiting",schemaVersion:0,source:"",capturedAt:"",capturedAtMs:0,sampleSequence:0,sampleIntervalMs:0,droppedGapCount:0,
machineLabel:"",system:null,processes:[],attributedProcesses:[],sampling:null,privacy:null,capabilities:null,error:null,
lastGoodCapturedAt:"",lastGoodCapturedAtMs:0};let t=e.system&&typeof e.system=="object"?e.system:null,n=t?.cpu&&typeof t.
cpu=="object"?t.cpu:{},s=t?.memory&&typeof t.memory=="object"?t.memory:{},a=t?.disk&&typeof t.disk=="object"?t.disk:{},i=t?.
network&&typeof t.network=="object"?t.network:{},c=t?{cpuPercent:an(n.total_percent??t.cpu_percent),cpu:{totalPercent:an(
n.total_percent??t.cpu_percent),userPercent:an(n.user_percent),privilegedPercent:an(n.privileged_percent),idlePercent:an(
n.idle_percent),queueLength:ye(n.queue_length),frequencyMhz:ye(n.current_frequency_mhz),logicalCoreCount:Math.max(0,Math.
round(ft(n.logical_core_count))),physicalCoreCount:Math.max(0,Math.round(ft(n.physical_core_count))),perLogical:Array.isArray(
n.per_logical)?n.per_logical:[]},memory:{totalBytes:ye(s.total_bytes),usedBytes:ye(s.used_bytes),availableBytes:ye(s.available_bytes),
usedPercent:an(s.used_percent),cacheBytes:ye(s.cache_bytes),commitBytes:ye(s.commit_bytes),commitLimitBytes:ye(s.commit_limit_bytes),
commitPeakBytes:ye(s.commit_peak_bytes),commitPercent:an(s.commit_percent),pagedPoolBytes:ye(s.paged_pool_bytes),nonpagedPoolBytes:ye(
s.nonpaged_pool_bytes),pagefileUsedBytes:ye(s.pagefile_used_bytes),pagesPerSec:ye(s.pages_per_sec),faultsPerSec:ye(s.faults_per_sec)},
disk:{readBps:ye(a.read_bps),writeBps:ye(a.write_bps),busyPercent:an(a.busy_percent),readIops:ye(a.read_iops),writeIops:ye(
a.write_iops),readLatencyMs:ye(a.read_latency_ms),writeLatencyMs:ye(a.write_latency_ms),transferLatencyMs:ye(a.transfer_latency_ms),
queueLength:ye(a.queue_length)},disks:(Array.isArray(t.disks)?t.disks:[]).map(k_),network:{receiveBps:ye(i.receive_bps),
sendBps:ye(i.send_bps),receivePps:ye(i.receive_pps),sendPps:ye(i.send_pps),utilizationPercent:an(i.utilization_percent),
outputQueueLength:ye(i.output_queue_length),receiveErrors:ye(i.receive_errors),sendErrors:ye(i.send_errors),receiveDiscards:ye(
i.receive_discards),sendDiscards:ye(i.send_discards),tcpRetransmitsPerSec:ye(i.tcp_retransmits_per_sec)},networkAdapters:(Array.
isArray(t.network_adapters)?t.network_adapters:[]).map(w_),processCount:Math.max(0,Math.round(ft(t.process_count))),threadCount:Math.
max(0,Math.round(ft(t.thread_count))),handleCount:Math.max(0,Math.round(ft(t.handle_count))),uptimeSeconds:ye(t.uptime_seconds)}:
null,u=(Array.isArray(e.processes)?e.processes:[]).map(y_).sort((y,S)=>Number(S.attributed)-Number(y.attributed)||S.cpuHostPercent-
y.cpuHostPercent||S.memoryBytes-y.memoryBytes||y.pid-S.pid),f=e.captured_at?String(e.captured_at):"",_=e.last_good_captured_at?
String(e.last_good_captured_at):"";return{available:e.status==="fresh"&&!!c,status:String(e.status||"unavailable"),schemaVersion:Math.
max(0,Math.round(ft(e.schema_version))),source:String(e.source||""),capturedAt:f,capturedAtMs:Uo(f),sampleSequence:Math.
max(0,Math.round(ft(e.sample_sequence))),sampleIntervalMs:Math.max(0,Math.round(ft(e.sample_interval_ms))),droppedGapCount:Math.
max(0,Math.round(ft(e.dropped_gap_count))),machineLabel:e.machine_label?String(e.machine_label):"",system:c,processes:u,
attributedProcesses:u.filter(y=>y.attributed),sampling:e.sampling&&typeof e.sampling=="object"?e.sampling:null,privacy:e.
privacy&&typeof e.privacy=="object"?e.privacy:null,capabilities:e.capabilities&&typeof e.capabilities=="object"?e.capabilities:
null,error:e.error&&typeof e.error=="object"?e.error:null,lastGoodCapturedAt:_,lastGoodCapturedAtMs:Uo(_)}}function Yl(e,t=0){
let n=e.filter(Number.isFinite).sort((a,i)=>a-i);if(!n.length)return t;let s=Math.floor(n.length/2);return n.length%2?n[s]:
(n[s-1]+n[s])/2}function rc(e){let t=Math.max(Number.EPSILON,Number(e)||0),n=10**Math.floor(Math.log10(t)),s=t/n;return(s<=
1?1:s<=2?2:s<=2.5?2.5:s<=5?5:10)*n}function oc(e){if(!e||typeof e!="object")return null;let t=Number(e.sample_sequence);
if(!Number.isSafeInteger(t)||t<1)return null;let n=e.frame_kind==="system"?e:e.system||{},s=n.cpu||{},a=n.memory||{},i=n.
disk||{},c=n.network||{};return{sampleSequence:t,capturedAt:String(e.captured_at||""),capturedAtMs:Uo(e.captured_at),monotonicMs:ye(
e.monotonic_ms),sampleIntervalMs:ye(e.sample_interval_ms),droppedGapCount:Math.max(0,Math.round(ft(e.dropped_gap_count))),
status:String(e.status||"unavailable"),cpu:{totalPercent:Pt(s.total_percent??n.cpu_percent),userPercent:Pt(s.user_percent),
privilegedPercent:Pt(s.privileged_percent)},memory:{usedPercent:Pt(a.used_percent),commitPercent:Pt(a.commit_percent)},disk:{
readBps:Pt(i.read_bps),writeBps:Pt(i.write_bps),readIops:Pt(i.read_iops),writeIops:Pt(i.write_iops)},network:{receiveBps:Pt(
c.receive_bps),sendBps:Pt(c.send_bps),receivePps:Pt(c.receive_pps),sendPps:Pt(c.send_pps)}}}function Yr(e,t={}){let n=Array.
isArray(e)?e:[],s=new Map,a=0,i=0,c=0;for(let Z of n){let ue=Number(Z?.sample_sequence);!Number.isSafeInteger(ue)||ue<1||
(ue<c&&(i+=1),c=Math.max(c,ue),s.has(ue)?a+=1:s.set(ue,Z))}let f=[...s.values()].sort((Z,ue)=>Z.sample_sequence-ue.sample_sequence).
map(Z=>({frame:Z,point:oc(Z)})).filter(Z=>Z.point),_=f.find(Z=>Z.point.capturedAtMs>0&&Z.point.monotonicMs>0)||null,y=f.
map(Z=>{let ue=_&&Z.point.monotonicMs>0?_.point.capturedAtMs+Z.point.monotonicMs-_.point.monotonicMs:0;return{...Z,chartTimeMs:ue>
0?ue:Z.point.capturedAtMs}}),S=[];for(let Z=1;Z<y.length;Z+=1){let ue=y[Z].chartTimeMs-y[Z-1].chartTimeMs;ue>0&&ue<=1e4&&
S.push(ue)}let T=y.map(Z=>Z.point.sampleIntervalMs).filter(Z=>Z>0),w=Math.max(1,Math.round(Yl(S,Yl(T,1e3))||1e3)),M=Math.
max(2500,w*2.5),d=[],h=[],g=0,A=0,N=0,$=0,x=0,O=0;for(let Z of y){let ue={...Z,chartTimeMs:Z.chartTimeMs+O};if(!(ue.chartTimeMs>
0)){g+=1;continue}let de=d.at(-1),Ae=!1;if(de&&ue.point.monotonicMs>0&&de.point.monotonicMs>0&&ue.point.monotonicMs<de.point.
monotonicMs){let J=ue.point.capturedAtMs-de.point.capturedAtMs,E=J>0&&J<=1e4?J:w,W=de.chartTimeMs+Math.max(1,E);O+=W-ue.
chartTimeMs,ue.chartTimeMs=W,Ae=!0,x+=1}if(de&&ue.chartTimeMs<=de.chartTimeMs){ue.chartTimeMs===de.chartTimeMs?A+=1:N+=1;
continue}let X=ue.point.status!=="fresh",D=X?"unavailable":"";if(de){let J=ue.chartTimeMs-de.chartTimeMs,E=ue.point.sampleSequence-
de.point.sampleSequence,W=ue.point.droppedGapCount-de.point.droppedGapCount;if((E!==1||W>0||J>M)&&(X=!0,D=E!==1||W>0?"dr\
opped":"cadence"),Ae)$+=1,X=!0,D="clock_discontinuity";else if(ue.point.monotonicMs>0&&de.point.monotonicMs>0&&ue.point.
capturedAtMs>0&&de.point.capturedAtMs>0){let ce=ue.point.capturedAtMs-de.point.capturedAtMs,me=ue.point.monotonicMs-de.point.
monotonicMs;Math.abs(ce-me)>Math.max(5e3,w*2)&&($+=1,X=!0,D="clock_discontinuity")}X&&h.push({startMs:de.chartTimeMs,endMs:ue.
chartTimeMs,reason:D,previousSequence:de.point.sampleSequence,nextSequence:ue.point.sampleSequence})}d.push({...ue,gapBefore:X,
gapReason:D})}let Y=Number.isFinite(Number(t.nowMs))?Number(t.nowMs):Date.now(),te=d.at(-1)||null,ie=te?Math.max(0,Y-te.
chartTimeMs):1/0,ge=Math.max(2500,w*2),z=Math.max(ge*4,1e4),ae="waiting";t.paused?ae="paused":t.connected===!1||t.subscriptionStatus===
"reconnecting"?ae="reconnecting":te?te.point.status!=="fresh"?ae="unavailable":ie>z?ae="stale":ie>ge?ae="delayed":ae="li\
ve":ae=t.error?"unavailable":"waiting",te&&ie>ge&&!t.paused&&h.push({startMs:te.chartTimeMs,endMs:Y,reason:ae,previousSequence:te.
point.sampleSequence,nextSequence:null});let _e=d.length>1?d.at(-1).chartTimeMs-d[0].chartTimeMs:0,V=te&&!t.paused?Math.
max(te.chartTimeMs,Y):te?.chartTimeMs||0,he=d.length?Math.max(0,V-d[0].chartTimeMs):0,be=d.length?Math.max(1,Math.floor(
he/w)+1):0,ee=d.length?Math.max(0,d.at(-1).point.droppedGapCount-d[0].point.droppedGapCount):0;return{frames:d.map(Z=>({
...Z.frame,chart_time_ms:Z.chartTimeMs,gap_before:Z.gapBefore,gap_reason:Z.gapReason})),points:d.map(Z=>({...Z.point,chartTimeMs:Z.
chartTimeMs,gapBefore:Z.gapBefore,gapReason:Z.gapReason})),gaps:h,status:ae,cadenceMs:w,staleAfterMs:ge,latestAgeMs:ie,nowMs:Y,
startMs:d[0]?.chartTimeMs||0,endMs:d.at(-1)?.chartTimeMs||0,elapsedMs:_e,expectedCount:be,receivedCount:n.length,validCount:d.
filter(Z=>Z.point.status==="fresh").length,droppedCount:Math.max(ee,Math.max(0,be-d.length)),gapCount:h.length,duplicateCount:a+
A,outOfOrderCount:i+N,invalidTimestampCount:g,clockDiscontinuityCount:$,monotonicResetCount:x}}function Kp(e,t,n){let s=e.
map(a=>({capturedAtMs:a.capturedAtMs,value:t==="cpu"?a.cpu.totalPercent:a.memory.usedPercent})).filter(a=>a.capturedAtMs>
0&&a.value!==null);return s.length<2||s.at(-1).capturedAtMs-s[0].capturedAtMs<15e3?!1:s.every(a=>a.value>=n)}function Vp(e,t){
return Kp(e,t,95)?"critical":Kp(e,t,85)?"warning":"normal"}function Xp(e,t={}){let n=fa([],e,60),s=n.map(oc).filter(Boolean),
a=s.at(-1)||null,i=Number.isFinite(Number(t.nowMs))?Number(t.nowMs):Date.now(),c=t.connected!==!1,u=String(t.subscriptionStatus||
""),f=a?.cpu.totalPercent??null,_=a?.memory.usedPercent??null,y=a?.status==="fresh"&&f!==null&&_!==null,S=a?.capturedAtMs>
0?Math.max(0,i-a.capturedAtMs):1/0,T=Math.max(1e3,a?.sampleIntervalMs||1e3),w=Math.max(2500,T*2),M="waiting";!c||u==="re\
connecting"?M="reconnecting":y?S>w?M="stale":M="live":M=t.error?"unavailable":"waiting";let d=a?.capturedAtMs?a.capturedAtMs-
15e3:1/0,h=s.filter(O=>O.capturedAtMs>=d),g=y?Vp(h,"cpu"):"normal",A=y?Vp(h,"memory"):"normal",N=M==="live"&&(g==="criti\
cal"||A==="critical")?"critical":M==="live"&&(g==="warning"||A==="warning")?"warning":M,$=n.at(-1)||null,x=$?.frame_kind===
"system"?$:$?.system||null;return{status:M,attention:N,point:a,frames:n,cpuPercent:f,memoryPercent:_,cpuLevel:g,memoryLevel:A,
ageMs:S,ageSeconds:Number.isFinite(S)?Math.max(0,Math.round(S/1e3)):null,staleAfterMs:w,sampleSequence:a?.sampleSequence||
0,capturedAt:a?.capturedAt||"",memoryUsedBytes:Pt(x?.memory?.used_bytes),memoryTotalBytes:Pt(x?.memory?.total_bytes)}}function fa(e,t,n=900){
let s=new Map;[...Array.isArray(e)?e:[],...Array.isArray(t)?t:[t]].forEach(i=>{let c=Number(i?.sample_sequence);!Number.
isSafeInteger(c)||c<1||s.has(c)||s.set(c,i)});let a=Math.max(1,Math.min(900,Number(n)||900));return[...s.entries()].sort(
(i,c)=>i[0]-c[0]).slice(-a).map(([,i])=>i)}function ma(e,t){let n=e?.sampleSequence?e:oc(e),s=v_[t];return!n||!s?null:Pt(
s.reduce((a,i)=>a?.[i],n))}function Xl(e,t){let n=(Array.isArray(e)?e:[]).map(A=>({frame:A,point:A?.sampleSequence?A:oc(
A),value:ma(A,t),timeMs:Number(A?.chartTimeMs??A?.chart_time_ms)||Uo(A?.capturedAt??A?.captured_at),gapBefore:A?.gapBefore===
!0||A?.gap_before===!0})).filter(A=>A.point&&A.value!==null&&A.timeMs>0).sort((A,N)=>A.timeMs-N.timeMs||A.point.sampleSequence-
N.point.sampleSequence);if(!n.length)return{current:null,min:null,average:null,sampleAverage:null,timeWeightedAverage:null,
averageMethod:"none",max:null,p95:null,provisionalP95:null,p95Ready:!1,peakSequence:null,count:0,elapsedMs:0,cadenceMs:0,
gapCount:0};let s=n.map(A=>A.value),a=[...s].sort((A,N)=>A-N),i=n.reduce((A,N)=>N.value>A.value?N:A,n[0]),c=s.reduce((A,N)=>A+
N,0)/s.length,u=n.slice(1).map((A,N)=>A.timeMs-n[N].timeMs).filter(A=>A>0),f=Math.max(0,Math.round(Yl(u,0))),_=Math.max(
2500,f*2.5),y=0,S=0,T=0;for(let A=1;A<n.length;A+=1){let N=n[A-1],$=n[A],x=$.timeMs-N.timeMs;if($.gapBefore||x>_){T+=1;continue}
y+=(N.value+$.value)/2*x,S+=x}let w=S>0?y/S:c,M=u.length?Math.min(...u):0,d=u.length?Math.max(...u):0,h=M>0&&d/M>1.2,g=a[Math.
max(0,Math.ceil(a.length*.95)-1)];return{current:s.at(-1),min:Math.min(...s),average:h?w:c,sampleAverage:c,timeWeightedAverage:w,
averageMethod:h?"time-weighted":"sample",max:Math.max(...s),p95:s.length>=20?g:null,provisionalP95:g,p95Ready:s.length>=
20,peakSequence:i.point.sampleSequence,count:s.length,elapsedMs:n.length>1?n.at(-1).timeMs-n[0].timeMs:0,cadenceMs:f,gapCount:T}}function Qp(e,t,n=240){let a=Yr(e,{nowMs:Number.MAX_SAFE_INTEGER,paused:!0}).points;if(!a.length)return[];let i=Math.max(
1,Math.round(Number(n)||240)),c=a.length<=i?1:Math.ceil(a.length/i),u=[];for(let f=0;f<a.length;f+=c){let _=a.slice(f,f+
c),y=Xl(_,t);u.push({startSequence:_[0].sampleSequence,endSequence:_.at(-1).sampleSequence,capturedAtStartMs:_[0].chartTimeMs,
capturedAtEndMs:_.at(-1).chartTimeMs,chartTimeMs:_.at(-1).chartTimeMs,current:y.current,min:y.min,average:y.average,max:y.
max,first:ma(_[0],t),last:ma(_.at(-1),t),p95:y.p95,provisionalP95:y.provisionalP95,peakSequence:y.peakSequence,count:y.count,
gap:_.some(S=>S.gapBefore)})}return u}function Jp(e,t="live",n={}){let s=Number.isFinite(Number(n.nowMs))?Number(n.nowMs):
Date.now(),i=Yr(e,{...n,nowMs:s}).frames,c=Vr[t]??Vr.live;return!i.length||c===1/0?i:i.filter(u=>Number(u.chart_time_ms)>=
s-c&&Number(u.chart_time_ms)<=s)}function Ql(e,t=0,n={}){if(n.percent)return{maximum:100,minimum:0,step:25,ticks:[0,25,50,
75,100]};let s=Math.max(0,Number(e)||0),a=Math.max(0,Number(t)||0);if(a>0&&s<=a*.95&&s>=a*.65){let _=rc(a/4),y=Math.max(
2,Math.round(a/_)+1);return{maximum:a,minimum:0,step:_,ticks:Array.from({length:y},(S,T)=>Math.min(a,_*T))}}let i=Math.max(
1,s*1.1),c=rc(i/4),u=Math.ceil(i/c)*c,f=Math.round(u/c)+1;return f<4&&(c=rc(i/3),u=Math.ceil(i/c)*c,f=Math.round(u/c)+1),
f>6&&(c=rc(i/5),u=Math.ceil(i/c)*c,f=Math.round(u/c)+1),{maximum:u,minimum:0,step:c,ticks:Array.from({length:Math.max(2,
f)},(_,y)=>Math.min(u,c*y))}}function Zp(e,t,n=5){let s=Number(e),a=Number(t),i=Math.max(2,Math.min(6,Math.round(Number(
n)||5)));return!Number.isFinite(s)||!Number.isFinite(a)||a<=s?[]:Array.from({length:i},(c,u)=>{let f=s+(a-s)*u/(i-1),_=new Date(
f),y=new Date(s).toDateString()!==new Date(a).toDateString();return{timeMs:f,fraction:u/(i-1),label:_.toLocaleString([],
y?{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}:{hour:"2-digit",minute:"2-digit",second:"2-digit"}),accessibleLabel:_.
toLocaleString([],{year:"numeric",month:"long",day:"numeric",hour:"2-digit",minute:"2-digit",second:"2-digit",timeZoneName:"\
short"})}})}function Jl(e,t,n){let s=Number(e?.chartTimeMs??e?.chart_time_ms)||Uo(e?.capturedAt??e?.captured_at),a=Number(
t),i=Number(n);return!(s>0)||!Number.isFinite(a)||!Number.isFinite(i)||i<=a?0:Math.max(0,Math.min(1,(s-a)/(i-a)))}function us(e){let t=ye(e);if(t<1024)return`${Math.round(t)} B`;let n=["KiB","MiB","GiB","TiB"],s=t/1024,a=0;for(;s>=1024&&
a<n.length-1;)s/=1024,a+=1;let i=s>=100?0:s>=10?1:2;return`${s.toFixed(i)} ${n[a]}`}function ds(e){return`${us(e)}/s`}function em(e){
return e==null?"\u2014":`${ft(e).toFixed(ft(e)>=10?1:2)}%`}function Zl(e,t=Date.now()){let n=Date.parse(e||"");if(!Number.
isFinite(n))return"Waiting for local sample";let s=Math.max(0,Math.round((t-n)/1e3));return s<2?"Updated now":s<60?`Upda\
ted ${s}s ago`:`Updated ${Math.floor(s/60)}m ago`}function eu(e){let t=typeof e=="number"?e:Date.parse(String(e||""));return Number.
isFinite(t)?new Date(t).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"}):"Unknown time"}function tu(e){
let t=typeof e=="number"?e:Date.parse(String(e||""));return Number.isFinite(t)?new Date(t).toLocaleString([],{year:"nume\
ric",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit",second:"2-digit",timeZoneName:"short"}):"Unknown date a\
nd time"}var tm=Object.freeze({unavailable:6,auth_required:5,rate_limited:4,stale:3,refreshing:2,fresh:1});function ha(e){let t=Number(
e);return Number.isFinite(t)?Math.max(0,t):null}function $t(e){let t=Number(e);return Number.isFinite(t)?t:null}function wn(e){
if(!e||typeof e!="object"||e.amount==null||e.amount==="")return null;let t=$t(e.amount);return t==null?null:{amount:t,currency:String(
e.currency||"USD"),sourceField:String(e.source_field||""),semantics:String(e.semantics||""),directlyReported:e.directly_reported===
!0}}function S_(e){if(!e||typeof e!="object")return null;let t=e.pool_classification&&typeof e.pool_classification=="obj\
ect"?{status:String(e.pool_classification.classification_status||""),firstParty:wn(e.pool_classification.first_party),thirdParty:wn(
e.pool_classification.third_party),unclassified:wn(e.pool_classification.unclassified),warning:String(e.pool_classification.
warning||"")}:null;return{semanticsVersion:Number(e.semantics_version)||0,source:String(e.source||""),observedAt:String(
e.observed_at||""),accountScope:String(e.account_scope||""),extraUsageEnabled:e.extra_usage_enabled===!0,prepaidBalance:wn(
e.prepaid_balance),extraUsageSpend:wn(e.extra_usage_spend),extraUsageCap:wn(e.extra_usage_cap),reportedSpend:wn(e.reported_spend),
includedSpend:wn(e.included_spend),bonusSpend:wn(e.bonus_spend),planLimit:wn(e.plan_limit),allowanceRemaining:wn(e.allowance_remaining),
reconciliationDelta:wn(e.reconciliation_delta),poolClassification:t,resetsAt:String(e.resets_at||""),disclaimer:String(e.
disclaimer||"")}}function N_(e){if(!e||typeof e!="object")return null;let t=(Array.isArray(e.request_receipts)?e.request_receipts:
[]).map(n=>({receiptId:String(n?.receipt_id||""),model:String(n?.model||""),surface:String(n?.surface||""),capturedAt:String(
n?.captured_at||""),promptTokens:$t(n?.prompt_tokens),responseTokens:$t(n?.response_tokens),tokensPerSecond:$t(n?.tokens_per_second),
totalDurationNs:$t(n?.total_duration_ns),loadDurationNs:$t(n?.load_duration_ns),promptEvalDurationNs:$t(n?.prompt_eval_duration_ns),
evalDurationNs:$t(n?.eval_duration_ns)})).filter(n=>n.receiptId&&n.model&&n.surface);return{status:String(e.status||""),
endpointScope:String(e.endpoint_scope||""),installedModelsCount:Math.max(0,Number(e.installed_models_count)||0),loadedModelsCount:Math.
max(0,Number(e.loaded_models_count)||0),loadedModels:(Array.isArray(e.loaded_models)?e.loaded_models:[]).map(n=>({name:String(
n?.name||"Unnamed local model"),sizeBytes:Math.max(0,Number(n?.size_bytes)||0),sizeVramBytes:Math.max(0,Number(n?.size_vram_bytes)||
0),contextLength:Math.max(0,Number(n?.context_length)||0),expiresAt:String(n?.expires_at||"")})),promptTokens:$t(e.prompt_tokens),
responseTokens:$t(e.response_tokens),tokensPerSecond:$t(e.tokens_per_second),totalDurationNs:$t(e.total_duration_ns),loadDurationNs:$t(
e.load_duration_ns),promptEvalDurationNs:$t(e.prompt_eval_duration_ns),evalDurationNs:$t(e.eval_duration_ns),observedRequestCount:Math.
max(0,Number(e.observed_request_count)||0),requestReceipts:t,latestRequest:t.at(-1)||null,telemetryStatus:String(e.telemetry_status||
""),telemetryReason:String(e.telemetry_reason||"")}}function C_(e){return!e||typeof e!="object"?null:{subscriptionState:[
"active","none","unavailable"].includes(e.subscription_state)?e.subscription_state:"unavailable",source:String(e.source||
""),capturedAt:String(e.captured_at||""),autoReloadEnabled:typeof e.auto_reload_enabled=="boolean"?e.auto_reload_enabled:
null,error:e.error&&typeof e.error=="object"?{code:String(e.error.code||""),message:String(e.error.message||"")}:null,sourceReceipt:e.
source_receipt&&typeof e.source_receipt=="object"?{...e.source_receipt}:null}}function x_(e){if(!e||typeof e!="object")return null;
let t=["slow","steady","racing","burning"].includes(e.category)?e.category:"",n=ha(e.expected_used_percent);if(!t||n==null)
return null;let s=e.budget_percent&&typeof e.budget_percent=="object"?Object.fromEntries(["now","next_hour","next_five_h\
ours","today"].map(a=>[a,ha(e.budget_percent[a])??0])):null;return{stage:String(e.stage||""),category:t,expectedUsedPercent:n,
actualUsedPercent:ha(e.actual_used_percent),deltaPercent:$t(e.delta_percent),projectedUsedPercent:ha(e.projected_used_at_reset_percent),
exhaustionAt:e.exhaustion_at?String(e.exhaustion_at):"",willLastToReset:e.will_last_to_reset===!0,budgets:s}}function A_(e,t){
let n=ha(e?.used_percent),s=String(e?.status||(n==null?"unavailable":"available"));if(n==null&&s!=="unavailable")return null;
let a=ha(e?.thresholds?.warning_percent)??75,i=Math.max(a,ha(e?.thresholds?.critical_percent)??90),c={id:String(e?.id||`\
window-${t+1}`),label:String(e?.label||"Usage"),scope:e?.scope?String(e.scope):"",modelScope:e?.model_scope&&typeof e.model_scope==
"object"?{id:String(e.model_scope.id||""),label:String(e.model_scope.label||"")}:null,usedPercent:n,remainingPercent:$t(
e?.remaining_percent)??(n==null?null:100-n),visualPercent:ha(e?.visual_percent)??(n==null?null:Math.min(100,n)),durationMinutes:Number.
isFinite(Number(e?.duration_minutes))?Number(e.duration_minutes):null,startsAt:e?.starts_at?String(e.starts_at):"",resetsAt:e?.
resets_at?String(e.resets_at):"",resetDescription:e?.reset_description?String(e.reset_description):"",windowKind:e?.window_kind?
String(e.window_kind):"",source:e?.source?String(e.source):"",provenance:e?.provenance?String(e.provenance):"",freshnessStatus:e?.
freshness_status?String(e.freshness_status):"",status:s,error:e?.error&&typeof e.error=="object"?e.error:null,thresholds:{
warningPercent:a,criticalPercent:i},pace:x_(e?.pace)};return c.tone=n==null?"unavailable":n>=i||n>=100?"critical":n>=a?"\
warning":"ok",c}function R_(e){if(e?.status==="auth_required"||e?.status==="unavailable")return"unavailable";if(e?.status===
"rate_limited")return"stale";let t=new Set((e?.windows||[]).map(s=>s.tone)),n=Math.max(-1,...(e?.windows||[]).map(s=>s.usedPercent??
-1));return t.has("critical")?"critical":t.has("warning")?"warning":e?.status==="stale"?"stale":e?.status==="fresh"&&e?.
localRuntime?.status==="running"||n>=0?"ok":"unknown"}function M_(e,t){let n=(Array.isArray(e?.windows)?e.windows:[]).map(
A_).filter(Boolean).sort((a,i)=>i.usedPercent-a.usedPercent||a.label.localeCompare(i.label)),s={key:`${e?.provider_id||"\
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
null,financials:S_(e?.financials),localRuntime:N_(e?.local_runtime),cloudUsage:C_(e?.cloud_usage),resetCredits:e?.reset_credits&&
typeof e.reset_credits=="object"?e.reset_credits:null,error:e?.error&&typeof e.error=="object"?e.error:null,requestCount:Math.
max(0,Number(e?.request_count)||0),latencyMs:Number.isFinite(Number(e?.latency_ms))?Number(e.latency_ms):null,sessionCount:Math.
max(0,Number(e?.session_count)||0),harnessTypes:Array.isArray(e?.mapped_harness_types)?e.mapped_harness_types.map(String).
sort():[]};return s.tone=R_(s),s.maximumUsedPercent=n.length>0?Math.max(...n.map(a=>a.usedPercent)):null,s}function nu(e){
let t=Array.isArray(e?.snapshots)?e.snapshots:[],n=new Map;t.map(M_).forEach(w=>{let M=n.get(w.key),d=Date.parse(M?.capturedAt||
"")||0,h=Date.parse(w.capturedAt||"")||0;(!M||h>=d)&&n.set(w.key,w)});let s=[...n.values()].sort((w,M)=>(tm[M.status]||0)-
(tm[w.status]||0)||(M.maximumUsedPercent??-1)-(w.maximumUsedPercent??-1)||w.providerName.localeCompare(M.providerName)||
w.accountLabel.localeCompare(M.accountLabel)),a=new Set(s.map(w=>w.providerId)),i=s.filter(w=>w.windows.length>0||w.credits||
w.resetCredits||w.financials||w.localRuntime||w.cloudUsage).length,c=s.filter(w=>["warning","critical"].includes(w.tone)&&
w.maximumUsedPercent<100).length,u=s.filter(w=>w.maximumUsedPercent>=100).length,f=Number(e?.generation)||0,_=e?.in_flight===
!0,y=s.filter(w=>w.status==="fresh").length,S=s.filter(w=>w.status==="stale").length,T=_?"refreshing":f===0&&s.length===
0?"not-started":s.length===0||y===s.length?"ready":y>0?"partial":S>0?"stale":"unavailable";return{schemaVersion:Number(e?.
schema_version)||0,generation:f,generatedAt:e?.generated_at?String(e.generated_at):"",pollIntervalMs:Math.max(0,Number(e?.
poll_interval_ms)||0),cadenceMode:e?.cadence_mode==="watching"?"watching":"idle",inFlight:_,collectionState:T,summaryAuthoritative:f>
0||s.length>0,estimatedCost:T_(e?.estimated_cost),entries:s,summary:{providers:a.size,accounts:s.length,reporting:i,nearLimit:c,
exhausted:u}}}function su(e,t){if(!t||typeof t!="object")return e;if(!e||typeof e!="object")return t;let n=Math.max(0,Number(
e.generation)||0),s=Math.max(0,Number(t.generation)||0);if(s<n)return e;let a=Array.isArray(e.snapshots)?e.snapshots:[],
i=Array.isArray(t.snapshots)?t.snapshots:[];return s===n&&a.length>0&&i.length===0?t.in_flight===!0&&e.in_flight!==!0?{...e,
in_flight:!0}:e:t}function ga(e){return Array.isArray(e)?e.filter(t=>t&&typeof t=="object").map(t=>({...t})):[]}function Go(e){
if(e==null||e==="")return null;let t=Number(e);return Number.isFinite(t)?Math.max(0,t):null}function T_(e){return!e||typeof e!=
"object"?null:{schemaVersion:Number(e.schema_version)||0,catalogVersion:String(e.catalog_version||""),label:String(e.label||
"Local estimated API-equivalent cost"),status:String(e.status||"unavailable"),generatedAt:e.generated_at?String(e.generated_at):
"",range:e.range&&typeof e.range=="object"?e.range:{days:365,since:"",until:""},tokens:{input:Go(e.tokens?.input),cached:Go(
e.tokens?.cached),output:Go(e.tokens?.output)},costUsd:Go(e.cost_usd),records:Go(e.records),byProvider:ga(e.by_provider),
byModel:ga(e.by_model),byProject:ga(e.by_project),byDay:ga(e.by_day),bySpeed:ga(e.by_speed),dailyBreakdown:ga(e.daily_breakdown),
unknownModels:ga(e.unknown_models),scan:e.scan&&typeof e.scan=="object"?e.scan:{},reasonCode:String(e.reason_code||""),reasonPath:String(
e.reason_path||""),lastGoodGeneratedAt:e.last_good_generated_at?String(e.last_good_generated_at):"",detail:e.detail&&typeof e.
detail=="object"?{totalRows:Math.max(0,Number(e.detail.total_rows)||0),inlineRows:Math.max(0,Number(e.detail.inline_rows)||
0),pageSize:Math.max(0,Number(e.detail.page_size)||0),nextCursor:e.detail.next_cursor==null?"":String(e.detail.next_cursor),
truncated:e.detail.truncated===!0,collections:ga(e.detail.collections)}:null}}function Xr(e,t,n,s){e.has(t)||e.set(t,Object.
fromEntries(s.map(i=>[i,n[i]])));let a=e.get(t);a.input=(Number(a.input)||0)+(Number(n.input)||0),a.cached=(Number(a.cached)||
0)+(Number(n.cached)||0),a.output=(Number(a.output)||0)+(Number(n.output)||0),a.cost_usd=(Number(a.cost_usd)||0)+(Number(
n.cost_usd)||0),a.records=(Number(a.records)||0)+(Number(n.records)||0)}function nm(e,t={}){if(!e)return null;let n=Math.
max(1,Math.min(365,Number(t.days)||1)),s=Date.parse(`${e.range?.until||new Date().toISOString().slice(0,10)}T00:00:00.00\
0Z`),a=s-(n-1)*24*60*60*1e3,i=e.dailyBreakdown.filter(_=>{let y=Date.parse(`${_.day}T00:00:00.000Z`);return Number.isFinite(
y)&&y>=a&&y<=s&&(!t.project||_.project===t.project)&&(!t.providerId||_.provider_id===t.providerId)}),c={provider:new Map,
model:new Map,project:new Map,day:new Map,speed:new Map},u={input:0,cached:0,output:0,cost_usd:0,records:0};i.forEach(_=>{
Xr(new Map([["total",u]]),"total",_,[]),Xr(c.provider,_.provider_id,_,["provider_id"]),Xr(c.model,`${_.provider_id}|${_.
model}`,_,["provider_id","model"]),Xr(c.project,`${_.provider_id}|${_.project}`,_,["provider_id","project"]),Xr(c.day,_.
day,_,["day"]),Xr(c.speed,_.speed,_,["speed"])});let f=_=>[..._.values()].map(y=>({...y,cost_usd:Number((y.cost_usd||0).
toFixed(8))}));return{days:n,tokens:{input:u.input,cached:u.cached,output:u.output},costUsd:Number(u.cost_usd.toFixed(8)),
records:u.records,byProvider:f(c.provider),byModel:f(c.model),byProject:f(c.project),byDay:f(c.day),bySpeed:f(c.speed)}}
function dn(e){let t=Number(e);return Number.isFinite(t)?`${Number.isInteger(t)?t:t.toFixed(2).replace(/0+$/,"").replace(
/\.$/,"")}%`:"Unavailable"}function Wo(e){let t=Number(e);return!Number.isFinite(t)||t<0?"Unavailable":t<1e6?`${Math.round(
t/1e3)} us`:t<1e9?`${(t/1e6).toFixed(1).replace(/\.0$/,"")} ms`:`${(t/1e9).toFixed(2).replace(/0+$/,"").replace(/\.$/,"")}\
 s`}function sm(e){let t=Number(e);return!Number.isFinite(t)||t<0?"Unavailable":`${t.toFixed(2).replace(/0+$/,"").replace(
/\.$/,"")} tokens/s`}function tr(e,t=Date.now()){let n=Date.parse(e||"");if(!Number.isFinite(n))return"Not yet refreshed";
let s=Math.max(0,Math.floor((t-n)/1e3));if(s<10)return"Updated just now";if(s<60)return`Updated ${s}s ago`;let a=Math.floor(
s/60);return a<60?`Updated ${a}m ago`:`Updated ${Math.floor(a/60)}h ${a%60}m ago`}function nr(e,t=Date.now()){let n=Date.
parse(e||"");if(!Number.isFinite(n))return e?String(e):"";let s=Math.max(0,Math.floor((n-t)/1e3)),a=Math.floor(s/60),i=s<
60?`${s}s`:a<60?`${a}m`:`${Math.floor(a/60)}h ${a%60}m`,c=new Date(n).toLocaleString([],{month:"short",day:"numeric",hour:"\
numeric",minute:"2-digit"});return`in ${i} (${c})`}function au(e){if(!e||typeof e!="object")return"";if(e.unlimited===!0)
return"Unlimited credits";let t=e.balance!=null&&e.balance!==""&&Number.isFinite(Number(e.balance));if(e.unit&&t)return`${e.
balance} ${e.unit}`;let n=e.currency==="USD"?"$":e.currency?`${e.currency} `:"";return t?`${n}${Number(e.balance).toFixed(
2)} balance`:""}function er(e){return!e||e.amount==null||e.amount===""||!Number.isFinite(Number(e.amount))?"Not reported":
`${e.currency==="USD"?"$":e.currency?`${e.currency} `:""}${Number(e.amount).toFixed(2)}`}function ru(e){if(!e)return[];let t=[];
return e.prepaidBalance&&t.push({id:"prepaid-balance",label:"Available prepaid balance",value:er(e.prepaidBalance)}),e.extraUsageSpend&&
t.push({id:"extra-spend",label:"Extra-usage spend",value:er(e.extraUsageSpend)}),e.extraUsageCap&&t.push({id:"extra-cap",
label:"Extra-usage cap",value:er(e.extraUsageCap)}),!e.extraUsageEnabled&&(e.extraUsageSpend||e.extraUsageCap)&&t.push({
id:"extra-status",label:"Extra usage",value:"Disabled"}),e.reportedSpend&&t.push({id:"reported-spend",label:"Provider-re\
ported spend",value:er(e.reportedSpend)}),e.includedSpend&&t.push({id:"included-spend",label:"Included spend bucket",value:er(
e.includedSpend)}),e.bonusSpend&&t.push({id:"bonus-spend",label:"Bonus spend bucket",value:er(e.bonusSpend)}),e.planLimit&&
t.push({id:"plan-limit",label:"Reported plan limit",value:er(e.planLimit)}),e.reportedSpend&&!e.allowanceRemaining&&t.push(
{id:"allowance-remaining",label:"Available allowance",value:"Not reported by provider"}),e.poolClassification?.status===
"unavailable"&&t.push({id:"pool-classification",label:"First/third-party pools",value:e.poolClassification.warning||"Not\
 reported by provider"}),t}var{useState:Ie,useEffect:ou,useRef:$e,useCallback:zt}=React;function rt(e,t,n,s=(a,i)=>a??i){if(!e||!Object.prototype.hasOwnProperty.call(e,t))return e;let a={...e};return a[n]=s(a[n],
a[t]),delete a[t],a}var om=1024*1024,$_=15e3,im=3,E_=new Set(["history_chunk_throttled","history_chunk_duplicate_cursor",
"history_waiter_capacity","history_request_capacity","throttled"]),L_=15e3,I_=Object.freeze({queued:1e4,accepted:3e4,launch_accepted:3e4,
delivered:3e4,steered:3e4}),cm=[250,500,1e3,2e3,3e3],lc=512,O_=new Set(["history","history_snapshot","history_chunk","tr\
anscript_resync_required","chat_list"]);function Ps(e,t,n,s=lc){let a={...e||{}};Object.prototype.hasOwnProperty.call(a,
t)&&delete a[t],a[t]=n;let i=Object.keys(a),c=i.length-Math.max(1,Number(s)||lc);for(let u=0;u<c;u+=1)delete a[i[u]];return a}
function q_(e){let n=(e instanceof Map?[...e.values()]:Object.values(e||{})).filter(a=>a&&typeof a=="object"),s=n.filter(
a=>a.aggregateOnly!==!0).length;return{active:n.length>0,aggregateOnly:s===0,consumerCount:n.length,detailConsumerCount:s}}
function cc(e,t){let n=Object.entries(t||{});if(!n.length)return e;let s=!1,a={...e};return n.forEach(([i,c])=>{Object.is(
e[i],c)||Nt(e[i]??null,c??null)||(a[i]=c,s=!0)}),s?a:e}function P_(e,t,n){return(e==="history_snapshot"||e==="history")&&
!t?.partial&&(!t?.mode||t.mode==="full")?!1:!!(t?.partial||t?.mode==="tail"||n?.mode==="chunked"||n?.partial)}function _a(e){
return e?e.source_message_id?`source${e.source_message_id}`:e.native_source_id?`native${e.native_source_id}`:e.id!=null?
`id${e.id}`:e.server_message_id!=null?`server${e.server_message_id}`:e.sequence!=null&&e.ts!=null?`seq${e.sequence}${e.
ts}${e.role||""}`:e.client_message_id?`client${e.client_message_id}`:e.client_msg_id?`client${e.client_msg_id}`:"":""}
function cu(e,t){return e===t||Nt(e??null,t??null)}function zo(e,t){let n=Array.isArray(e)?e:[],s=Array.isArray(t)?t:[],
a=s.map((y,S)=>({message:y,index:S,sequence:Number(y?.sequence)})),c=a.length>1&&a.every(y=>Number.isFinite(y.sequence))?
a.sort((y,S)=>y.sequence-S.sequence||y.index-S.index).map(y=>y.message):s,u=new Map;n.forEach(y=>{let S=_a(y);S&&!u.has(
S)&&u.set(S,y)});let f=new Set,_=[];return c.forEach(y=>{let S=_a(y);if(S&&f.has(S))return;S&&f.add(S);let T=S?u.get(S):
null;_.push(T&&cu(T,y)?T:y)}),_.length===n.length&&_.every((y,S)=>y===n[S])?n:_}function uc(e,t=""){let n=t||e?.session_id||
e?.session||"",s=e?.prompt_id||"",a=e?.generation||"";return n&&s&&a?`${n}\0${s}\0${a}`:""}function lm(e,t,n=Date.now(),s=4096){
let a=uc(t);if(!a||typeof e?.set!="function"||typeof e?.has!="function")return!1;for(e.has(a)||e.set(a,Number(n)||Date.now());e.
size>Math.max(32,Number(s)||4096);)e.delete(e.keys().next().value);return!0}function iu(e,t){let n=uc(t);return!!n&&typeof e?.
has=="function"&&e.has(n)}function D_(e,t){if(!e||!t)return!1;let n=_a(e),s=_a(t);return n&&s?n===s:e.role===t.role&&String(
e.content||"")===String(t.content||"")}function um(e,t){let n=Array.isArray(e)?e:[],s=(Array.isArray(t)?t:[]).filter(i=>i?.
_optimistic&&i?._cid);if(s.length===0)return n;let a=[...n];return s.forEach(i=>{let c=a.findIndex(u=>u?.role==="user"&&
(u.client_message_id===i._cid||u.client_msg_id===i._cid||String(u.content||"")===String(i.content||"")));if(c>=0){let u=a[c]?.
status;a[c]={...a[c],_cid:i._cid,_optimistic:!0,_delivered:i._delivered||a[c]._delivered||u==="delivered"||u==="agent_st\
arted",_agentStarted:i._agentStarted||a[c]._agentStarted||u==="agent_started",_sendError:u==="failed"?a[c].failure_code||
i._sendError||"Send failed":i._sendError||null}}else a.push(i)}),a}function dm(e,t){let n=Array.isArray(e)?e:[],s=Array.
isArray(t)?t:[];if(!n.length)return s;if(!s.length)return n;let a=Math.min(n.length,s.length);for(let i=a;i>=1;i--){let c=!0;
for(let S=0;S<i;S++)if(!D_(n[n.length-i+S],s[S])){c=!1;break}if(!c)continue;let u=n.length-i,f=!1,_=s.slice(0,i).map((S,T)=>{
let w=n[u+T],M=_a(w),d=_a(S);if(M&&M===d&&!cu(w,S)){let h=Array.isArray(w?.content_blocks)&&w.content_blocks.some(A=>A?.
type==="memory_citation"),g=Array.isArray(S?.content_blocks)&&S.content_blocks.some(A=>A?.type==="memory_citation");return h&&
!g?w:(f=!0,S)}return w}),y=s.slice(i);return!f&&y.length===0?n:[...n.slice(0,u),..._,...y]}return null}function Ko(e){let t=Array.
isArray(e)?e:[],n=s=>{let a=String(s?.content||"");return/\*\*(?:Claude Code|Codex|Cursor) CLI is waiting for a native transcript\.\*\*/i.
test(a)&&/placeholder will be replaced with the real CLI chat history/i.test(a)};return!t.some(n)||!t.some(s=>!n(s))?t:t.
filter(s=>!n(s))}function fm(e,t){let n=e?.agent_type||e?.agentType||"";if(n!=="codex_cli"&&n!=="cursor_cli"||!Array.isArray(
t)||t.length!==1)return!1;let s=t[0];return s?.role!=="assistant"?!1:/\*\*(?:Codex|Cursor) CLI is waiting for a native transcript\.\*\*/.
test(String(s.content||""))}function pm(e,t={}){let n={},s={},a={};return(e||[]).forEach(i=>{if(!i||typeof i!="object"||
!i.session_id||!i.activity)return;let c=i.activity.kind||"working",u=i.activity.label||(c==="idle"?"":"Working");n[i.session_id]=
{kind:c,label:u,updatedAt:i.activity.updated_at||null,observed_at:i.activity.observed_at||null,startedAt:i.activity.started_at||
null,interruptHint:i.activity.interrupt_hint||"",goal:i.activity.goal||null,goal_run:i.activity.goal_run||null,...i.activity.
goal_projection?{goal_projection:i.activity.goal_projection}:{},...i.activity.goal_tombstone?{goal_tombstone:i.activity.
goal_tombstone}:{},thinking:i.activity.thinking||null,connection:i.activity.connection||null,connection_tombstone:i.activity.
connection_tombstone||null,interruption:i.activity.interruption||null,interruption_tombstone:i.activity.interruption_tombstone||
null,current:i.activity.current||null,step:i.activity.step||null,usage:i.activity.usage||null,task_list:i.activity.task_list||
null,context_card:i.activity.context_card||null,work_context:i.activity.work_context||null,thinkingContent:i.activity.thinking?.
text||i.activity.thinkingContent||"",transport:i.activity.transport||t[i.session_id]?.transport||null},s[i.session_id]=i.
activity.thinking?.text||i.activity.thinkingContent||"",a[i.session_id]=["thinking","generating","running_command","appl\
ying_patch","reading_files","working"].includes(c)?u:!1}),{activities:n,thinkingContent:s,thinking:a}}function mm(e){if(!e||
typeof e!="object")return null;let t=e.goal_tombstone||e.goal_projection,n=Number(t?.epoch),s=Number(t?.sequence);if(!Number.
isSafeInteger(n)||n<=0||!Number.isSafeInteger(s)||s<=0)return null;let a=e.goal_tombstone||t?.state==="clear"||e.goal===
null?"clear":"present";return{epoch:n,sequence:s,state:a}}function j_(e,t){let n=mm(e),s=mm(t);if(n&&s){if(n.epoch!==s.epoch)
return n.epoch<s.epoch?-1:1;if(n.sequence!==s.sequence)return n.sequence<s.sequence?-1:1;if(n.state!==s.state)return n.state===
"clear"?1:-1}else if(n||s)return n?1:-1;let a=Date.parse(e?.observed_at||e?.updatedAt||"")||0,i=Date.parse(t?.observed_at||
t?.updatedAt||"")||0;return a!==i?a<i?-1:1:0}function Qr(e,t,n={}){let s=e&&typeof e=="object"?e:{},a=t&&typeof t=="obje\
ct"?t:{},i=n.authoritative===!0,c=s;for(let[u,f]of Object.entries(a)){let _=Object.prototype.hasOwnProperty.call(s,u);!i&&
_||i&&_&&f&&typeof f=="object"&&s[u]&&typeof s[u]=="object"&&j_(f,s[u])<0||Object.is(s[u],f)||(c===s&&(c={...s}),c[u]=f)}
return c}function gm(){let[e,t]=Ie(()=>Yi()),n=e.list,s=zt(o=>{t(p=>{let k=typeof o=="function"?o(p.list):o;return Fo(p,
k)})},[]),a=Fl,i=Rp,[c,u]=Ie({}),[f,_]=Ie({}),[y,S]=Ie(!1),[T,w]=Ie({state:"connecting",rttMs:null,lastAckAt:null}),[M,d]=Ie(
{}),[h,g]=Ie({}),[A,N]=Ie({}),[$,x]=Ie({}),[O,Y]=Ie({}),[te,ie]=Ie({}),[ge,z]=Ie({}),[ae,_e]=Ie([]),[V,he]=Ie({}),[be,ee]=Ie(
null),[Se,Z]=Ie({}),[ue,de]=Ie({}),[Ae,X]=Ie({}),[D,J]=Ie([]),[E,W]=Ie({}),[ce,me]=Ie({}),[fe,we]=Ie({}),[Le,Ee]=Ie({}),
[Ze,re]=Ie({}),[Me,B]=Ie({}),[ne,xe]=Ie({}),[He,Et]=Ie({}),[mn,F]=Ie({}),[Ct,Vt]=Ie({}),[Sn,Wn]=Ie({}),[zn,ir]=Ie([]),[so,
cr]=Ie([]),[wa,fs]=Ie(null),[lr,ur]=Ie(null),[Lc,ao]=Ie(null),[Kn,ai]=Ie(null),[ro,dr]=Ie(null),[Sa,oo]=Ie(null),[Na,Nn]=Ie(
null),[ri,Cn]=Ie(null),[io,Yt]=Ie(null),[oi,js]=Ie([]),[Ic,Bs]=Ie([]),[Oc,Ca]=Ie({id:"",status:"idle",aggregateOnly:!0,resumed:!1,
consumerCount:0,detailConsumerCount:0}),[qc,Fs]=Ie({}),[Pc,co]=Ie([]),[ii,Dc]=Ie({}),xn=$e({}),gs=$e({}),Xt=$e({}),Vn=$e(
{}),xa=$e({}),Lt=$e(new Map),m=$e({}),hs=$e({}),xt=$e({}),gt=$e(null),lo=$e(""),An=$e([]),pr=$e(0),uo=$e(0),Hs=$e(null),
Aa=$e(null),lt=$e(null),Rn=$e(null),ci=$e(0),mr=$e(1e4),po=$e(3e4),yt=$e([]),It=$e(null),fr=$e(null),Us=$e(lp()),_s=$e(Up()),
li=$e(0),Yn=$e({}),ui=$e(0),ht=$e({}),pt=$e({}),ot=$e({}),Ra=$e({}),Xn=$e({}),Ma=$e(!1),At=$e(new Map),Qn=$e(null),et=$e(
{}),Jn=$e(null),_t=$e(new Map),Ta=$e(new Map),tt=$e({active:!1,aggregateOnly:!0,consumerCount:0,detailConsumerCount:0}),
Bt=$e(""),gr=$e(!0),Gs=$e(""),$a=$e(0),at=$e({system:"",detail:""}),Ot=$e({system:0,detail:0}),Mn=$e({system:0,detail:0});
function di(o){let p=typeof o?.alias_session_id=="string"?o.alias_session_id.trim():"",k=typeof o?.canonical_session_id==
"string"?o.canonical_session_id.trim():"";if(!p||!k||p===k)return!1;Dc(v=>({...v,[p]:{...o,alias_session_id:p,canonical_session_id:k}})),
Ap(p,k),s(v=>{let L=v.find(pe=>(typeof pe=="string"?pe:pe?.session_id)===k),P=v.find(pe=>(typeof pe=="string"?pe:pe?.session_id)===
p),K=v.filter(pe=>{let ve=typeof pe=="string"?pe:pe?.session_id;return ve!==p&&ve!==k}),U=L&&typeof L=="object"?L:P&&typeof P==
"object"?{...P,session_id:k}:{session_id:k};return K.push({...U,session_id:k,canonical_session_id:k,canonical_conversation_id:o.
canonical_conversation_id||U.canonical_conversation_id||null,canonical_native_id:o.canonical_native_id||U.canonical_native_id||
null,current_surface:o.current_surface||U.current_surface||null,current_surface_label:o.current_surface_label||U.current_surface_label||
null}),K});let I=(v,L)=>v??L,l=(v,L)=>[...Array.isArray(v)?v:[],...Array.isArray(L)?L:[]];u(v=>rt(v,p,k,I)),_(v=>rt(v,p,
k,I)),d(v=>rt(v,p,k,(L,P)=>Number(L||0)+Number(P||0))),g(v=>rt(v,p,k,I)),N(v=>rt(v,p,k,I)),x(v=>rt(v,p,k,I)),Y(v=>rt(v,p,
k,I)),z(v=>rt(v,p,k,l)),Z(v=>rt(v,p,k,I)),de(v=>rt(v,p,k,I)),X(v=>rt(v,p,k,(L,P)=>({...P||{},...L||{},session_id:k,session:k}))),
W(v=>rt(v,p,k,I)),me(v=>rt(v,p,k,I)),we(v=>rt(v,p,k,l)),Ee(v=>rt(v,p,k,l)),re(v=>rt(v,p,k,I)),B(v=>rt(v,p,k,I)),xe(v=>rt(
v,p,k,I)),Vt(v=>rt(v,p,k,I)),Fs(v=>rt(v,p,k,I)),_e(v=>v.map(L=>L?.session_id===p?{...L,session_id:k}:L)),xa.current=rt(xa.
current,p,k,I);for(let[v,L]of[...Lt.current]){if(!v.startsWith(`${p}\0`))continue;let P=`${k}${v.slice(p.length)}`;Lt.current.
has(P)||Lt.current.set(P,L),Lt.current.delete(v)}xt.current=rt(xt.current,p,k,I),et.current=rt(et.current,p,k,I),It.current===
p&&(It.current=k),An.current=[...new Set(An.current.map(v=>v===p?k:v))];for(let[v,L]of Object.entries(Vn.current))L===p&&
(Vn.current[v]=k);for(let v of[Yn,ht,ot,Ra,Xn])v.current=rt(v.current,p,k,I);return!0}function jc(o){return!!Cp(o)}function Bc(o,p,k=null){
if(et.current={...et.current,[o]:p},_t.current.set(o,{stream:p,streamTrace:k}),Jn.current!=null)return;let I=typeof requestAnimationFrame==
"function"?requestAnimationFrame:l=>setTimeout(l,16);Jn.current=I(()=>{Jn.current=null;let l=[..._t.current.entries()];_t.
current.clear(),l.length&&(Fs(v=>{let L={...v};return l.forEach(([P,K])=>{L[P]=K.stream}),L}),l.forEach(([v,L])=>{L.streamTrace&&
ja({stream_trace:L.streamTrace},v)}))})}function Fc(o,p=null){if(!o||et.current[o]?.open)return;let I=$l(o,p);et.current=
{...et.current,[o]:I},Fs(l=>({...l,[o]:I}))}function bs(o){if(!o||!et.current[o])return;let p={...et.current};delete p[o],
et.current=p,_t.current.delete(o),Fs(k=>{if(!k[o])return k;let I={...k};return delete I[o],I})}function pi(){et.current=
{},_t.current.clear(),Fs({})}function vs(){let o=Qn.current;Qn.current=null,o&&(o.kind==="idle"&&typeof cancelIdleCallback==
"function"?cancelIdleCallback(o.id):clearTimeout(o.id))}function Zn(){if(Qn.current||At.current.size===0)return;let o=()=>{
Qn.current=null;let p=At.current.entries().next();if(p.done)return;let[k,I]=p.value;At.current.delete(k),fr.current?.(I),
Zn()};typeof requestIdleCallback=="function"?Qn.current={kind:"idle",id:requestIdleCallback(o,{timeout:250})}:Qn.current=
{kind:"timer",id:setTimeout(o,32)}}function Ea(){requestAnimationFrame(()=>requestAnimationFrame(()=>{Ma.current=!0,Zn()}))}
let Ce=zt(o=>{gt.current?.readyState===WebSocket.OPEN&&gt.current.send(JSON.stringify(o))},[]),hr=zt((o=!1,p=null)=>{let k=`\
provider-usage-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return dr({requestId:k,status:"requested",provider_id:p||
null}),Ce({type:"provider_usage_refresh",protocol_version:1,force:o===!0,...p?{provider_id:p}:{},request_id:k}),k},[Ce]),
ys=zt(o=>{Ce({type:"provider_usage_watch",protocol_version:1,active:o===!0})},[Ce]),es=zt(()=>{let o=`provider-reset-${Date.
now()}-${Math.random().toString(36).slice(2,7)}`;return oo({requestId:o,status:"requested"}),Ce({type:"provider_usage_re\
set_credit_consume",protocol_version:1,request_id:o,approved:!0}),o},[Ce]),_r=zt((o={})=>{let p=`provider-cost-${Date.now()}\
-${Math.random().toString(36).slice(2,7)}`,k={days:Math.max(1,Math.min(365,Number(o.days)||365)),providerId:o.providerId?
String(o.providerId):"",project:o.project?String(o.project):"",cursor:/^\d+$/.test(String(o.cursor??"0"))?String(o.cursor??
"0"):"0",pageSize:Math.max(1,Math.min(256,Number(o.pageSize)||256))};return Nn({requestId:p,status:"loading",query:k,detail:null,
error:null}),Ce({type:"provider_usage_cost_detail_request",protocol_version:1,request_id:p,days:k.days,provider_id:k.providerId||
null,project:k.project||null,cursor:k.cursor,page_size:k.pageSize}),p},[Ce]),Ws=zt((o=!1)=>{let p=`host-resource-${Date.
now()}-${Math.random().toString(36).slice(2,7)}`;return Yt(null),Ce({type:"host_resource_refresh",protocol_version:1,force:o===
!0,aggregate_only:tt.current.aggregateOnly===!0,request_id:p}),p},[Ce]),La=zt(()=>{Cn(null),Yt(null),js([]),Bs([]),Ot.current=
{system:0,detail:0},Mn.current={system:0,detail:0}},[]),Tn=zt((o,p="")=>{let k=`host-resource-subscribe-${Date.now()}-${++$a.
current}`;return Gs.current=k,Yt(null),Ca(I=>({...I,status:p?"reconnecting":"subscribing",aggregateOnly:o===!0})),Ce({type:"\
host_resource_subscribe",protocol_version:1,request_id:k,...p?{resume_subscription_id:p}:{},aggregate_only:o===!0}),k},[
Ce]),fn=zt((o,p=0)=>{let k=o==="detail"?"detail":"system",I=Bt.current;if(!I)return null;let l=`host-resource-history-${k}\
-${Date.now()}-${++$a.current}`;return at.current[k]=l,Ce({type:"host_resource_history_request",protocol_version:1,request_id:l,
subscription_id:I,stream:k,after_sequence:Math.max(0,Math.round(Number(p)||0)),max_points:k==="detail"?8:64}),l},[Ce]),zs=zt(
()=>{let o=tt.current,p=q_(Ta.current);tt.current=p;let k=Bt.current;return p.active?(Ca(I=>({...I,aggregateOnly:p.aggregateOnly,
consumerCount:p.consumerCount,detailConsumerCount:p.detailConsumerCount})),o.active?(o.aggregateOnly===p.aggregateOnly||
(p.aggregateOnly&&(js(I=>fa([],I,60)),Bs([]),Cn(null),at.current.detail="",Ot.current.detail=0,Mn.current.detail=0),k&&Tn(
p.aggregateOnly,k)),k||null):(La(),Tn(p.aggregateOnly,""),null)):(Bt.current="",Gs.current="",at.current={system:"",detail:""},
gr.current=!0,k&&Ce({type:"host_resource_unsubscribe",protocol_version:1,request_id:`host-resource-unsubscribe-${Date.now()}\
-${++$a.current}`,subscription_id:k}),La(),Ca({id:"",status:"idle",aggregateOnly:!0,resumed:!1,consumerCount:0,detailConsumerCount:0}),
null)},[La,Ce,Tn]),ks=zt((o=!1,p="dashboard")=>{let k=String(p||"dashboard").trim().slice(0,64)||"dashboard",I=o===!0;return Ta.
current.get(k)?.aggregateOnly===I?Bt.current||null:(Ta.current.set(k,{aggregateOnly:I}),zs())},[zs]),mi=zt((o="dashboard")=>{
let p=String(o||"dashboard").trim().slice(0,64)||"dashboard";return Ta.current.delete(p)?zs():Bt.current||null},[zs]),Ia=zt(
o=>{let p=[...new Set((Array.isArray(o)?o:[]).filter(k=>typeof k=="string"&&k.length>0))].sort().slice(0,128);p.length===
An.current.length&&p.every((k,I)=>k===An.current[I])||(An.current=p,gt.current?.readyState===WebSocket.OPEN&&gt.current.
send(JSON.stringify({type:"subscribe",protocol_version:1,request_id:`web-sub-${Date.now()}-${++pr.current}`,sessions:p})))},
[]);function ws(){Aa.current&&clearInterval(Aa.current),lt.current&&clearTimeout(lt.current),Aa.current=null,lt.current=
null,Rn.current=null}function Oa(o=gt.current){if(!o||o.readyState!==WebSocket.OPEN||Rn.current)return;let p=`web-hb-${Date.
now()}-${++ci.current}`,k=Date.now();Rn.current={requestId:p,sentAt:k},o.send(JSON.stringify({type:"heartbeat",protocol_version:1,
request_id:p,client_ts:new Date(k).toISOString()})),lt.current=setTimeout(()=>{if(Rn.current?.requestId===p){Rn.current=
null,lt.current=null,w({state:"stale",rttMs:null,lastAckAt:null});try{o.close()}catch{}}},po.current)}function qa(o,p=gt.
current){ws(),mr.current=Math.max(1e3,Number(o?.heartbeat_interval_ms)||1e4),po.current=Math.max(mr.current*2,Number(o?.
heartbeat_timeout_ms)||3e4),Oa(p),Aa.current=setInterval(()=>Oa(p),mr.current)}function mo(o){let p=Rn.current;if(!p||p.
requestId!==o.request_id)return;lt.current&&clearTimeout(lt.current),lt.current=null,Rn.current=null;let k=Math.max(0,Date.
now()-p.sentAt),I=k<=500?"healthy":k<=2e3?"slow":"poor";w({state:I,rttMs:k,lastAckAt:Date.now()})}function kt(o){let p=gs.
current[o];p&&clearTimeout(p),delete gs.current[o]}function it(o,p){if(o){if(!Object.prototype.hasOwnProperty.call(Xt.current,
o)&&Object.keys(Xt.current).length>=lc){let k=Object.keys(Xt.current)[0];kt(k),delete Vn.current[k]}Xt.current=Ps(Xt.current,
o,p),ie(k=>Ps(k,o,p))}}function Ss(o,p){!o||!p||(Vn.current=Ps(Vn.current,o,p))}function ts(o,p,k){o&&i(I=>{let l=Fp(I,o,
p||Vn.current[o]||"");return l?(Ss(o,l),Hp(I,o,l,k)):I})}function Ks(o,p,k=""){o&&Xt.current[o]!=="agent_started"&&(kt(o),
it(o,"failed"),ts(o,k,I=>({...I,_sendError:p||"Send failed"})))}function Qt(o,p,k){kt(o);let I=I_[p];I&&(gs.current[o]=setTimeout(
()=>{delete gs.current[o],Xt.current[o]===p&&Ks(o,k)},I))}ou(()=>{xt.current=Ae},[Ae]),ou(()=>{xa.current=Se},[Se]);function Pa(o,p){
return`${o}:${p}`}function wt(o,p){!Object.prototype.hasOwnProperty.call(m.current,o)&&Object.keys(m.current).length>=lc&&
Ft(Object.keys(m.current)[0]),m.current=Ps(m.current,o,p),F(m.current)}function Ft(o){let p=hs.current[o];p&&clearTimeout(
p),delete hs.current[o]}function $n(o,p){let k=m.current[o];if(!k||!["pending","awaiting_config"].includes(k.status))return;
Ft(o);let l={...xt.current[k.sessionId]||{},[k.configKey]:k.previousValue};xt.current={...xt.current,[k.sessionId]:l},X(
v=>({...v,[k.sessionId]:{...v[k.sessionId]||{},[k.configKey]:k.previousValue}})),wt(o,{...k,status:"failed",error:p||"Co\
ntrol change failed and was rolled back.",completedAt:Date.now()})}function Ns(o,p,k,I,l,v){let L=Pa(o,p);Ft(L);let P=xt.
current[o]||{},K={sessionId:o,field:p,configKey:k,requestId:v,previousValue:P[k],requestedValue:I,status:"pending",error:null,
startedAt:Date.now()},U={...P,[k]:I};return xt.current={...xt.current,[o]:U},X(pe=>({...pe,[o]:{...pe[o]||{},[k]:I}})),wt(
L,K),hs.current[L]=setTimeout(()=>$n(L,"Timed out waiting for the agent to confirm this setting."),L_),Ce({...l,session_id:o,
request_id:v}),v}function fo(o,p){Object.entries(m.current).forEach(([k,I])=>{I.sessionId!==o||!["pending","awaiting_con\
fig"].includes(I.status)||Object.prototype.hasOwnProperty.call(p,I.configKey)&&p[I.configKey]===I.requestedValue&&(Ft(k),
wt(k,{...I,status:"ok",error:null,completedAt:Date.now()}))})}let gn=zt(()=>{vs(),Ma.current=!1,At.current.clear();let o=location.
protocol==="https:"?"wss":"ws",p=new WebSocket(`${o}://${location.host}/client-ws`);gt.current=p,p.onopen=()=>{uo.current=
0,S(!0),w({state:"connecting",rttMs:null,lastAckAt:null}),p.send(JSON.stringify({type:"subscribe",protocol_version:1,request_id:`\
web-sub-${Date.now()}-${++pr.current}`,sessions:An.current})),tt.current.active&&Tn(tt.current.aggregateOnly,Bt.current)},
p.onclose=()=>{if(ws(),Object.entries(m.current).forEach(([l,v])=>{["pending","awaiting_config"].includes(v?.status)&&$n(
l,"Connection changed before the native setting was confirmed. Retry after reconnecting.")}),Object.values(pt.current).forEach(
l=>clearTimeout(l)),pt.current={},Object.keys(ot.current).forEach(l=>{ot.current[l]={...ot.current[l]||{},inFlight:!1}}),
_({}),pi(),S(!1),w({state:"offline",rttMs:null,lastAckAt:null}),tt.current.active&&Ca(l=>({...l,status:"reconnecting"})),
gt.current!==p)return;let k=uo.current++,I=cm[Math.min(k,cm.length-1)];Hs.current=setTimeout(()=>{Hs.current=null,gn()},
I)},p.onmessage=k=>{let I;try{I=JSON.parse(k.data)}catch{return}I.stream_trace&&typeof I.stream_trace=="object"&&(I.stream_trace=
{...I.stream_trace,browser_received_at_ms:Date.now()}),fr.current(I)}},[Ce,Tn]);ou(()=>(gn(),()=>{Hs.current&&clearTimeout(
Hs.current),ws(),Object.values(gs.current).forEach(p=>clearTimeout(p)),gs.current={},Object.values(hs.current).forEach(p=>clearTimeout(
p)),hs.current={},vs(),Jn.current!=null&&(typeof cancelAnimationFrame=="function"?cancelAnimationFrame(Jn.current):clearTimeout(
Jn.current),Jn.current=null),_t.current.clear();let o=gt.current;gt.current=null;try{o?.close()}catch{}}),[gn]);function Jt(o,p={}){
let k=pm(o);x(I=>Qr(I,pm(o,I).activities,p)),N(I=>Qr(I,k.thinkingContent,p)),g(I=>Qr(I,k.thinking,p))}function Cs(o){let p=new Set(
(o||[]).map(l=>l&&typeof l=="object"?l.session_id:l).filter(Boolean)),k=l=>{let v=!1,L={...l};return Object.keys(L).forEach(
P=>{p.has(P)||(delete L[P],v=!0)}),v?L:l};Object.keys(xn.current).forEach(l=>{p.has(l)||(clearTimeout(xn.current[l]),delete xn.
current[l])}),[Yn,ht,ot,Ra,Xn].forEach(l=>{Object.keys(l.current).forEach(v=>{p.has(v)||delete l.current[v]})}),Object.keys(
et.current).forEach(l=>{p.has(l)||delete et.current[l]});for(let l of _t.current.keys())p.has(l)||_t.current.delete(l);Object.
keys(pt.current).forEach(l=>{p.has(l)||(clearTimeout(pt.current[l]),delete pt.current[l])});let I=!1;Object.entries(m.current).
forEach(([l,v])=>{p.has(v?.sessionId)||(Ft(l),delete m.current[l],I=!0)}),I&&F({...m.current}),x(k),N(k),g(k),u(k),_(k),
d(k),Y(k),z(k),Z(k),de(k),X(k),W(k),me(k),we(k),Ee(k),re(k),B(k),xe(k),Vt(k),Fs(k),Wn(l=>{let v=!1,L={...l};return Object.
keys(L).forEach(P=>{let K=P.indexOf(":"),U=K>=0?P.slice(0,K):P;p.has(U)||(delete L[P],v=!0)}),v?L:l})}function xs(o){let p={};
(o||[]).forEach(k=>{!k||typeof k!="object"||!k.session_id||typeof k.auto_approve_permissions=="boolean"&&(p[k.session_id]=
{auto_approve_permissions:k.auto_approve_permissions})}),Object.keys(p).length>0&&X(k=>{let I=!1,l={...k};return Object.
entries(p).forEach(([v,L])=>{let P={...l[v]||{},...L};Nt(l[v]||{},P)||(l[v]=P,I=!0)}),I?l:k})}function hn(o){let p={};(o||
[]).forEach(k=>{!k||typeof k!="object"||!k.session_id||Array.isArray(k.chat_list)&&(p[k.session_id]=k.chat_list)}),W(k=>cc(
k,p))}function Vs(o){let p={};(o||[]).forEach(k=>{!k||typeof k!="object"||!k.session_id||k.status&&(p[k.session_id]=k.status)}),
Y(k=>cc(k,p))}function go(o,p={}){let k=typeof o=="string"?o:o?.session_id;if(!k||gt.current?.readyState!==WebSocket.OPEN)
return;let I=`hist-${Date.now()}-${++li.current}`;Yn.current[k]=I;let l=Math.max(0,Math.floor(Number(p.afterSequence??p.
after_sequence)||0)),v=l>0?"delta":p.full?"full":"tail";_(K=>({...K,[k]:{mode:v,requestedAt:Date.now(),requestId:I}}));let L={
type:l>0?"history_request":"get_history",session:k,session_id:k,request_id:I};l>0&&(L.after_sequence=l);let P=Number(p.limit||
p.tailLimit||0);l<=0&&Number.isFinite(P)&&P>0&&!p.full&&(L.limit=Math.floor(P),L.tail=!0),p.full&&(L.full=!0),Ce(L)}function As(o,p={}){
let k=typeof o=="string"?o:o?.session_id;if(!k||gt.current?.readyState!==WebSocket.OPEN)return;let I=p.mode==="older"?"o\
lder":p.mode==="around"?"around":"tail",l=p.source||"relay_sqlite",v=I==="around"||I==="tail"&&p.replace!==!1,L=p.beforeOffset??
p.before_offset??null,P=p.beforeId??p.before_id??null,K=p.aroundId??p.around_id??null,U=`${I}${l}${L??""}${P??""}${K??
""}`,pe=ot.current[k]||{},ve=Date.now();if(pe.inFlight&&I!=="around"||I==="older"&&pe.lastRequestSig===U&&ve-Number(pe.lastRequestAt||
0)<1500)return;let Re=`histchunk-${Date.now()}-${++ui.current}`,We=Math.max(256*1024,Math.min(16*1024*1024,Number(p.chunkBytes||
p.chunk_bytes||om)||om));if(I!=="older"){let Pe=Number(p.retryAttempt||0)>0?pe.baselineMessageKeys:null,Te=Array.isArray(
Pe)?Pe:(a[k]||[]).map(Zt).filter(Boolean);clearTimeout(pt.current[k]),ot.current[k]={source:l,chunkBytes:We,limit:p.limit||
null,inFlight:!0,mode:I,replace:v,baselineMessageKeys:Te,beforeOffset:L,beforeId:P,aroundId:K,userInitiated:p.userInitiated===
!0||p.user_initiated===!0,retryAttempt:Number(p.retryAttempt||0),lastRequestSig:U,lastRequestAt:ve}}else ot.current[k]={
...ot.current[k]||{},source:l,chunkBytes:We,limit:p.limit||ot.current[k]?.limit||null,inFlight:!0,mode:I,beforeOffset:L,
beforeId:P,aroundId:K,userInitiated:p.userInitiated===!0||p.user_initiated===!0,retryAttempt:Number(p.retryAttempt||0),lastRequestSig:U,
lastRequestAt:ve};ht.current[k]=Re,u(Pe=>{if(!Pe[k]?.error)return Pe;let Te={...Pe[k]};return delete Te.error,{...Pe,[k]:Te}}),
_(Pe=>({...Pe,[k]:{mode:I,kind:"chunked",requestedAt:Date.now(),requestId:Re}}));let st={type:"history_chunk_request",session:k,
session_id:k,request_id:Re,mode:I,source:l,replace:v,chunk_bytes:We},Ht=Number(p.limit||p.tailLimit||0);Number.isFinite(
Ht)&&Ht>0&&(st.limit=Math.floor(Ht)),(p.userInitiated||p.user_initiated)&&(st.user_initiated=!0),I==="older"&&L!=null&&(st.
before_offset=L),I==="older"&&P!=null&&(st.before_id=P),I==="around"&&K!=null&&(st.around_id=K),Ce(st),pt.current[k]=setTimeout(
()=>{if(delete pt.current[k],ht.current[k]!==Re)return;let Pe=ot.current[k]||{};if(!Pe.inFlight)return;if(ot.current[k]=
{...Pe,inFlight:!1},It.current!==k){_(Ue=>{if(Ue[k]?.requestId!==Re)return Ue;let Je={...Ue};return delete Je[k],Je});return}
let Te=Number(p.retryAttempt||0);if(Te<im&&It.current===k&&gt.current?.readyState===WebSocket.OPEN){As(k,{...p,mode:I,source:l,
beforeOffset:L,beforeId:P,chunkBytes:We,retryAttempt:Te+1});return}_(Ue=>{if(Ue[k]?.requestId!==Re)return Ue;let Je={...Ue};
return delete Je[k],Je}),u(Ue=>({...Ue,[k]:{...Ue[k]||{},error:"Transcript history request timed out. Retry to load the \
latest messages."}}))},$_)}function Zt(o){if(!o)return"";if(o.source_message_id)return`source${o.source_message_id}`;if(o.
native_source_id)return`native${o.native_source_id}`;if(o.id!=null)return`id${o.id}`;if(o.server_message_id!=null)return`\
server${o.server_message_id}`;if(o.sequence!=null&&o.ts!=null)return`seq${o.sequence}${o.ts}${o.role||""}`;if(o.client_msg_id)
return`client${o.client_msg_id}`;let p=Array.isArray(o.content_blocks)?JSON.stringify(o.content_blocks):"";return`${o.role||
""}${o.content||""}${p}`}function Ys(o,p,k){let I=Array.isArray(o)?o:[],l=Array.isArray(p)?p:[];if(k==="older"){let U=new Set(
I.map(Zt)),pe=[];return l.forEach(ve=>{let Re=Zt(ve);U.has(Re)||(U.add(Re),pe.push(ve))}),pe.length?[...pe,...I]:I}let v=dm(
I,l);if(v)return v;let L=new Set(I.map(Zt)),P=[...I],K=0;return l.forEach(U=>{let pe=Zt(U);L.has(pe)||(L.add(pe),P.push(
U),K++)}),K?P:I}function ho(o,p){let k=Array.isArray(o)?o:[],I=Array.isArray(p)?p:[];if(!k.length)return I;if(!I.length)
return k;let l=dm(k,I);if(l)return l;let v=new Set(k.map(Zt)),L=[...k],P=0;return I.forEach(K=>{let U=Zt(K);v.has(U)||(v.
add(U),L.push(K),P++)}),P?L:k}function fi(o,p,k,I){let l=Array.isArray(o)?o:[],v=Array.isArray(p)?p:[],L=new Map(l.map(Re=>[
Zt(Re),Re])),P=v.map(Re=>{let We=L.get(Zt(Re));return We&&Nt(We,Re)?We:Re}),K=P.length===l.length&&P.every((Re,We)=>Re===
l[We])?l:P,U=new Set(Array.isArray(k?.baselineMessageKeys)?k.baselineMessageKeys:[]);if((k?.source==="native"||I==="code\
x_cli_jsonl"||I==="cursor_cli_jsonl")&&U.size>K.length)return l;let ve=l.filter(Re=>{let We=Zt(Re);return We&&!U.has(We)});
return ve.length===0?K:Ys(K,ve,"tail")}function Xs(o){return!o||typeof o!="object"?!1:["codex","codex-desktop","cursor",
"codex_cli","cursor_cli","roo_code","cline"].includes(o.agent_type)}function Rs(o){o&&(i(p=>({...p,[o]:[]})),z(p=>({...p,
[o]:[]})),g(p=>({...p,[o]:!1})),N(p=>({...p,[o]:""})),x(p=>({...p,[o]:!1})),u(p=>({...p,[o]:null})),_(p=>{if(!p[o])return p;
let k={...p};return delete k[o],k}))}function Qs(o,p,k,I={}){let l=`prompt-${Date.now()}-${Math.random().toString(36).slice(
2,7)}`,v=typeof I.instruction=="string"?I.instruction.trim():"",L=xa.current[o],P=L?.type==="question_prompt",K=I.action===
"cancel"?"cancel":"answer",U=k||(K==="cancel"?"question_cancel":Array.isArray(I.answers)?"question_answers":v?"alternate\
_instruction":null);Z(pe=>pe[o]?{...pe,[o]:{...pe[o],submitting_choice_id:U,request_id:l,error:null}}:pe),Ce(P?{type:"qu\
estion_response",session_id:o,prompt_id:p,generation:L.generation,action:K,...K==="answer"?{answers:I.answers||[]}:{},request_id:l}:
{type:"permission_response",session_id:o,prompt_id:p,...k?{choice_id:k}:{},...Array.isArray(I.answers)?{answers:I.answers}:
{},...v?{instruction:v}:{},request_id:l})}function ns(o,p,k,I){let l=`errprompt-${Date.now()}-${Math.random().toString(36).
slice(2,7)}`;de(v=>v[o]?{...v,[o]:{...v[o],submitting_action_id:k,request_id:l,error:null}}:v),Ce({type:"error_prompt_ac\
tion",session_id:o,prompt_id:p,action_id:k,request_id:l,...k==="open_native_window"?{operator_user_gesture:I?.isTrusted===
!0}:{}})}function Js(o,p={}){let k=`interrupt-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return Ce({type:"a\
gent_interrupt",session_id:o,request_id:k,connection_id:lo.current,session_generation:Math.max(0,Number(p.sessionGeneration)||
0),turn_generation:Math.max(0,Number(p.turnGeneration)||0)}),k}function ss(o,p,k,I={}){let l=String(I.requestId||"").trim()||
`goal-${p}-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return Ce({type:"agent_goal_control",session_id:o,request_id:l,
action:p,connection_id:lo.current,session_generation:Math.max(0,Number(I.sessionGeneration)||0),goal_generation:Math.max(
0,Number(k?.generation)||0),goal_transition_seq:Math.max(0,Number(k?.transition_seq)||0),goal_fingerprint:String(k?.fingerprint||
"")}),l}function Ms(o){let p=`cfg-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;Ce({type:"agent_config_request",
session_id:o,request_id:p})}function En(o,p){let k=`model-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,l=(xt.
current[o]||{}).config_semantics==="observed_and_next_send"?"next_send_model_id":"model_id";return Ns(o,"model",l,p,{type:"\
agent_set_model",model_id:p},k)}function Ts(o,p){let k=`effort-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,l=(xt.
current[o]||{}).config_semantics==="observed_and_next_send"?"next_send_effort":"effort";return Ns(o,"effort",l,p,{type:"\
agent_set_effort",effort:p},k)}function Ln(o,p){let k=`perm-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return Ns(
o,"permission_mode","permission_mode",p,{type:"agent_set_permission_mode",mode:p},k)}function Zs(o,p){let k=`autoperm-${Date.
now()}-${Math.random().toString(36).slice(2,7)}`;return Ns(o,"auto_approve_permissions","auto_approve_permissions",!!p,{
type:"agent_set_auto_approve_permissions",enabled:!!p},k)}function _n(o,p){let k=`mode-${Date.now()}-${Math.random().toString(
36).slice(2,7)}`,I=Object.prototype.hasOwnProperty.call(xt.current[o]||{},"conversation_mode")?"conversation_mode":"mode";
return Ns(o,"mode",I,p,{type:"agent_set_mode",mode:p},k)}function ea(o,{model_id:p,effort:k,speed:I,access_mode:l,permission_profile:v,
confirm_bypass:L,workspace_mode:P}){let K=`codex-cfg-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,U=xt.current[o]||
{},pe=[["model","model_id",p],["effort","effort",k],["speed","speed",I],["access_mode","permission_mode",l],["workspace_\
mode","workspace_mode",P],["permission_profile","permission_profile",v]],[ve,Re,We]=pe.find(([,,st])=>st!=null)||["codex\
_config","model_id",p];return Ns(o,ve,Re,We,{type:"set_codex_config",model_id:p,effort:k,speed:I,access_mode:l,permission_profile:v,
confirm_bypass:L,workspace_mode:P,source_revision:U.source_revision},K)}function as(o){let p=`new-thread-${Date.now()}-${Math.
random().toString(36).slice(2,7)}`;return Rs(o),Ce({type:"new_thread",session_id:o,request_id:p}),p}function ut(o){let p=`\
panel-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return Ce({type:"open_panel",session_id:o,request_id:p}),p}
function _o(o,p){let k=`native-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return Ce({type:"open_native_wind\
ow",session_id:o,request_id:k,operator_user_gesture:p?.isTrusted===!0}),k}function rn(o){let p=`chatlist-${Date.now()}-${Math.
random().toString(36).slice(2,7)}`;return Ce({type:"chat_list",session_id:o,request_id:p}),p}function gi(o,p){let k=`swi\
tch-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return Ce({type:"switch_chat",session_id:o,chat_id:p,request_id:k}),
k}function Hc(o){let p=`newchat-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return Ce({type:"new_chat",session_id:o,
request_id:p}),p}function bo(o){let p=`threads-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return Ce({type:"\
thread_list",session_id:o,request_id:p}),p}function vo(o,p){let k=`swthread-${Date.now()}-${Math.random().toString(36).slice(
2,7)}`;return Rs(o),Ce({type:"switch_thread",session_id:o,thread_id:p,request_id:k}),k}function Da(o){let p=`term-${Date.
now()}-${Math.random().toString(36).slice(2,7)}`;return Ce({type:"terminal_output",session_id:o,request_id:p}),p}function br(o,p){
let k=`termin-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return Ce({type:"terminal_input",session_id:o,request_id:k,
text:p}),k}function vr(o){let p=`diff-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return Ce({type:"file_chan\
ges",session_id:o,request_id:p}),p}function hi(o,p,k){let I=`filechg-${Date.now()}-${Math.random().toString(36).slice(2,
7)}`;return Ce({type:"file_change_response",session_id:o,change_id:p,action:k,request_id:I}),I}function Uc(o,p){let k=`d\
ir-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return Ce({type:"list_directory",session_id:o,request_id:k,path:p||
"."}),k}function _i(o,p){let k=`file-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return Ce({type:"read_file",
session_id:o,request_id:k,path:p}),k}function yo(o){let p=`skills-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
return Ce({type:"skill_list",session_id:o,request_id:p}),p}function yr(o){let p=`automation-${Date.now()}-${Math.random().
toString(36).slice(2,7)}`;return Ce({type:"automation_view_action",session_id:o,request_id:p}),p}function Gc(o,p,k,I){let l=`\
attach-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return Ce({type:"send_attachment",session_id:o,request_id:l,
data:p,mime_type:k,filename:I}),l}function en(o,p){let k=`swws-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return Ns(
o,"workspace","file_access_scope",p,{type:"switch_workspace",folder_path:p},k)}function Wc(o){let p=`branches-${Date.now()}\
-${Math.random().toString(36).slice(2,7)}`;return Ce({type:"branch_list",session_id:o,request_id:p}),p}function In(o,p){
let k=`swbranch-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return Ce({type:"switch_branch",session_id:o,branch_name:p,
request_id:k}),k}function zc(o,p){let k=`newbranch-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return Ce({type:"\
create_branch",session_id:o,branch_name:p,request_id:k}),k}function ta(o,p,k={}){let I=`launch-${Date.now()}-${Math.random().
toString(36).slice(2,7)}`;return he(l=>Ps(l,I,{status:"launching",agentType:o})),Ce({type:"launch_session",agent_type:o,
workspace_path:p||void 0,model_id:k.model_id||void 0,permission_mode:k.permission_mode||void 0,effort:k.effort||void 0,request_id:I}),
I}function bi(o,p,k,I={}){let l=`resume-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;return he(v=>Ps(v,l,{status:"\
launching",agentType:p})),Ce({type:"resume_session",source_session:o,agent_type:p||"claude",workspace_path:k||void 0,cli_session_id:I.
cli_session_id||void 0,model_id:I.model_id||void 0,permission_mode:I.permission_mode||void 0,request_id:l}),l}function Kc(o,p){
Ce(p?{type:"dismiss_session",session:o}:{type:"close_session",session:o})}function vi(o,p,k=""){let I=k||`cmsg-${Date.now()}\
-${Math.random().toString(36).slice(2,8)}`;Ss(I,o);let l=k?(Fl[o]||[]).find(L=>L._cid===I):null,v=Wr(l)?.iso||new Date().
toISOString();return i(L=>{let P=L[o]||[],K=k&&P.some(U=>U._cid===I);return{...L,[o]:K?P.map(U=>U._cid===I?{...U,content:p,
_optimistic:!0,_delivered:!1,_agentStarted:!1,_sendError:null}:U):[...P,zr({role:"user",content:p,_cid:I,_optimistic:!0,
created_at:v})]}}),gt.current?.readyState===WebSocket.OPEN?(it(I,"queued"),Qt(I,"queued","Timed out waiting for relay ac\
ceptance."),Ce({type:"send",session:o,content:p,client_message_id:I,created_at:v})):yt.current.length<20?(yt.current=[...yt.
current.filter(L=>L.cid!==I),{session:o,content:p,cid:I,created_at:v}],kt(I),it(I,"offline_queued")):(it(I,"queued"),Ks(
I,"Offline send queue is full. Reconnect or retry after another message sends.")),I}function yi(){let o=gt.current;if(!o||
o.readyState!==WebSocket.OPEN||yt.current.length===0)return;let p=yt.current;yt.current=[],p.forEach(k=>{Ss(k.cid,k.session),
it(k.cid,"queued"),Qt(k.cid,"queued","Timed out waiting for relay acceptance after reconnect."),o.send(JSON.stringify({type:"\
send",session:k.session,content:k.content,client_message_id:k.cid,created_at:k.created_at}))})}function ki(o,p,k,I){let l={
type:"steer",session_id:o,client_message_id:p,content:k};I!=null&&(l.native_index=I),Ce(l),p&&p.startsWith("native-")&&z(
v=>({...v,[o]:(v[o]||[]).filter(L=>L.cid!==p)}))}function wi(o,p){kt(p),delete Xt.current[p],delete Vn.current[p],Ce({type:"\
discard_queued",session_id:o,client_message_id:p}),z(k=>({...k,[o]:(k[o]||[]).filter(I=>I.cid!==p)})),ie(k=>{let I={...k};
return delete I[p],I}),i(k=>{let I=k[o]||[];return{...k,[o]:I.filter(l=>l._cid!==p)}})}function Si(o,p,k){z(I=>({...I,[o]:(I[o]||
[]).map(l=>l.cid===p?{...l,content:k,content_blocks:(l.content_blocks||[]).map(v=>v?.type==="queued_message"?{...v,content:k}:
v)}:l)})),i(I=>{let l=I[o]||[];return{...I,[o]:l.map(v=>v._cid===p?{...v,content:k}:v)}}),Ce({type:"edit_queued",session_id:o,
client_message_id:p,content:k})}function kr(o){o?.id&&_e(p=>{let k=p.filter(I=>I.id!==o.id);return["completed","cancelle\
d"].includes(o.state)?k:[o,...k]})}async function na(){let o=await fetch("/api/scheduled-sends",{credentials:"same-origi\
n"});if(!o.ok)throw new Error(`Could not load scheduled sends (${o.status})`);let p=await o.json();return _e((p.scheduled_sends||
[]).filter(k=>!["completed","cancelled"].includes(k.state))),p.scheduled_sends||[]}async function On(o,p,k,I=null){let l=await fetch(
"/api/scheduled-sends",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify(
{session_id:o,content:p,trigger_kind:k,...k==="at"?{deliver_at:I}:{}})}),v=await l.json().catch(()=>({}));if(!l.ok)throw new Error(
v.error||`Could not schedule message (${l.status})`);return kr(v.scheduled_send),v.scheduled_send}async function ko(o){let p=await fetch(
`/api/scheduled-sends/${encodeURIComponent(o)}`,{method:"DELETE",credentials:"same-origin"}),k=await p.json().catch(()=>({}));
if(!p.ok)throw new Error(k.error||`Could not cancel scheduled message (${p.status})`);return kr(k.scheduled_send),k.scheduled_send}
function ja(o,p){if(!o?.stream_trace||typeof window>"u")return;let k={...o.stream_trace,session_id:p||o.session||o.session_id||
""},I=window.requestAnimationFrame||(l=>window.setTimeout(l,16));I(()=>I(()=>{let l=Array.isArray(window.__RAC_STREAM_TRACES__)?
window.__RAC_STREAM_TRACES__:[];l.push({...k,browser_paint_at_ms:Date.now()}),l.length>500&&l.splice(0,l.length-500),window.
__RAC_STREAM_TRACES__=l}))}function je(o){let p=o.type;if(!_s.current.accept(o)||p==="navigation_started")return;if(p===
"connection_ack"&&(Us.current.reset(o.state_epoch),lo.current=String(o.connection_id||""),Array.isArray(o.session_aliases)&&
o.session_aliases.forEach(di)),p==="session_alias_reconciled"){di(o);return}let k=o.session||o.session_id||"",I=p==="ses\
sion_list"||p==="session_snapshot"||p==="proxy_session_snapshot"?"session_list":(p==="status"||p==="proxy_status"||p==="\
session_status"||p==="session_summary"||p==="session_patch")&&k?`status:${k}`:"";if(!(I&&!Us.current.accept(o,I))){if(p===
"heartbeat_ack"){mo(o);return}if(p==="provider_usage_snapshot"){o.snapshot&&typeof o.snapshot=="object"&&ai(l=>su(l,o.snapshot));
return}if(p==="provider_usage_threshold"){let l=new Set(Array.isArray(o.affected_session_ids)?o.affected_session_ids.map(
String):[]);l.size>0&&s(v=>v.map(L=>{let P=typeof L=="string"?L:L?.session_id;return l.has(P)?{...typeof L=="object"?L:{},
session_id:P,percent_used:Number.isFinite(Number(o.percent_used))?Number(o.percent_used):null,rate_limit_active:o.hard_limited===
!0,rate_limited_until:o.reset_hint||"unknown",usage_limit_provider:o.provider_id||null,usage_limit_window:o.window_label||
o.window_id||null}:L}));return}if(p==="provider_usage_refresh_receipt"){dr(l=>!l||!o.request_id||l.requestId===o.request_id?
{requestId:o.request_id||l?.requestId||"",status:o.status||"error",...o}:l);return}if(p==="provider_usage_reset_credit_r\
eceipt"){oo(l=>l?.requestId&&o.request_id!==l.requestId?l:{requestId:o.request_id,status:o.status||"error",outcome:o.outcome||
null,availableCount:o.reset_credits_available,error:o.code||null});return}if(p==="provider_usage_cost_detail"){Nn(l=>l?.
requestId===o.request_id?{...l,status:"ready",detail:o.detail,error:null}:l);return}if(p==="provider_usage_cost_detail_e\
rror"){Nn(l=>l?.requestId===o.request_id?{...l,status:"error",error:o.code||"cost_detail_failed"}:l);return}if(p==="host\
_resource_snapshot"){o.snapshot&&typeof o.snapshot=="object"&&(Cn(o.snapshot),Yt(null));return}if(p==="host_resource_sub\
scription_ack"){if(!tt.current.active||o.request_id!==Gs.current||typeof o.subscription_id!="string")return;let l=Bt.current,
v=o.subscription_id,L=o.resumed===!0&&l===v,P=o.aggregate_only===!0,K=l===v&&gr.current!==P;Bt.current=v,gr.current=P,Gs.
current="",L?K&&P&&(js(U=>fa([],U,60)),Bs([]),Cn(null),at.current.detail="",Ot.current.detail=0,Mn.current.detail=0):(js(
[]),Bs([]),Cn(null),Ot.current={system:0,detail:0},Mn.current={system:0,detail:0}),Ca({id:v,status:"live",aggregateOnly:P,
resumed:L,consumerCount:tt.current.consumerCount,detailConsumerCount:tt.current.detailConsumerCount}),fn("system",L?Ot.current.
system:0),P||fn("detail",L?Ot.current.detail:0),tt.current.aggregateOnly!==P&&Tn(tt.current.aggregateOnly,v);return}if(p===
"host_resource_history_chunk"){let l=o.chunk,v=l?.stream==="detail"?"detail":l?.stream==="system"?"system":"";if(!v||o.subscription_id!==
Bt.current||o.request_id!==at.current[v])return;let L=Array.isArray(l.points)?l.points:[];if(v==="system"){let K=tt.current.
aggregateOnly?60:900;js(U=>fa(U,L,K))}else{if(tt.current.aggregateOnly)return;Bs(U=>fa(U,L,180));let K=L.filter(U=>U&&typeof U==
"object").sort((U,pe)=>Number(U.sample_sequence||0)-Number(pe.sample_sequence||0)).at(-1);K&&Cn(K)}let P=Math.max(Ot.current[v],
Math.round(Number(l.next_sequence)||0));Ot.current[v]=P,at.current[v]="",l.done!==!0&&fn(v,P);return}if(p==="host_resour\
ce_live"){let l=o.point,v=Number(l?.sample_sequence);if(o.subscription_id!==Bt.current||!Number.isSafeInteger(v)||v<=Mn.
current.system)return;Mn.current.system=v,Ot.current.system=Math.max(Ot.current.system,v);let L=tt.current.aggregateOnly?
60:900;js(P=>fa(P,l,L)),Yt(null);return}if(p==="host_resource_detail"){if(tt.current.aggregateOnly)return;let l=o.snapshot,
v=Number(l?.sample_sequence);if(o.subscription_id!==Bt.current||!Number.isSafeInteger(v)||v<=Mn.current.detail)return;Mn.
current.detail=v,Ot.current.detail=Math.max(Ot.current.detail,v),Bs(L=>fa(L,l,180)),Cn(l),Yt(null);return}if(p==="host_r\
esource_unsubscribed")return o.subscription_id&&o.subscription_id!==Bt.current,void 0;if(p==="host_resource_error"){Yt({
code:o.code||"unavailable",message:o.message||"Windows host metrics are unavailable."});return}if(p==="semantic_notifica\
tion"){co(l=>Gl(l,o));return}if(!Ma.current&&!o.request_id&&O_.has(p)){let l=o.session||o.session_id||"global",v=p==="hi\
story_chunk"?o.source||"native":"";for(At.current.set(`${p}:${l}:${v}`,o);At.current.size>256;)At.current.delete(At.current.
keys().next().value);return}if(p==="session_list"){Cs(o.sessions||[]),t(l=>Fo(l,o.sessions||[])),Jt(o.sessions||[],{authoritative:!0}),
xs(o.sessions||[]),hn(o.sessions||[]),Vs(o.sessions||[]),(o.sessions||[]).forEach(l=>{let v=l&&typeof l=="object"?l.session_id:
l,L=Xs(l);l&&typeof l=="object"&&l.is_list_view&&!L&&v&&i(P=>P[v]&&P[v].length>0?{...P,[v]:[]}:P)}),Array.isArray(o.workspaces)&&
J(l=>Nt(l,o.workspaces)?l:o.workspaces);return}if(p==="session_snapshot"||p==="proxy_session_snapshot"){Cs(o.sessions||[]),
t(l=>Fo(l,o.sessions||[])),Jt(o.sessions||[],{authoritative:!0}),xs(o.sessions||[]),hn(o.sessions||[]),Vs(o.sessions||[]),
(o.sessions||[]).forEach(l=>{let v=l&&typeof l=="object"?l.session_id:l,L=Xs(l);l&&typeof l=="object"&&l.is_list_view&&!L&&
v&&i(P=>P[v]&&P[v].length>0?{...P,[v]:[]}:P)});return}if(p==="connection_ack"){if(qa(o),Array.isArray(o.semantic_notifications)&&
co(l=>Gl(l,o.semantic_notifications)),yi(),na().catch(()=>{}),ir(Array.isArray(o.duplicate_proxy_alarms)?o.duplicate_proxy_alarms:
[]),cr(Array.isArray(o.nightly_validation_failures)?o.nightly_validation_failures:[]),fs(o.latest_app_update_validation||
null),ur(o.revalidation_program_health||null),ao(o.operator_dogfood_health||null),o.provider_usage&&typeof o.provider_usage==
"object"&&ai(l=>su(l,o.provider_usage)),o.sessions&&o.sessions.length>0&&(t(l=>Fo(l,o.sessions)),Jt(o.sessions,{authoritative:!0}),
xs(o.sessions),hn(o.sessions),Vs(o.sessions),o.sessions.forEach(l=>{let v=Xs(l);if(l&&typeof l=="object"&&l.is_list_view&&
!v){let L=l.session_id;L&&i(P=>P[L]&&P[L].length>0?{...P,[L]:[]}:P)}})),Array.isArray(o.workspaces)&&J(l=>Nt(l,o.workspaces)?
l:o.workspaces),o.session_health){let l={};Object.entries(o.session_health).forEach(([v,L])=>{l[v]=typeof L=="object"?L.
health:L}),Y(v=>cc(v,l))}o.agent_configs&&typeof o.agent_configs=="object"&&X(l=>({...l,...o.agent_configs})),Z(l=>{let v={},
L=U=>{let pe=U?.session_id||U?.session;if(!pe)return;let ve=l[pe],Re=ve?.prompt_id===U.prompt_id&&(U.type!=="question_pr\
ompt"||ve?.generation===U.generation),We=Re?ve.received_at:Date.now(),st={...U,received_at:We};v[pe]=Re&&Nt(ve,st)?ve:st};
(o.open_prompts||[]).forEach(L),(o.open_question_prompts||[]).filter(U=>(!U.lifecycle||["open","submitting"].includes(U.
lifecycle))&&!iu(Lt.current,U)).forEach(L);let P=Object.keys(l),K=Object.keys(v);return P.length===K.length&&K.every(U=>l[U]===
v[U])?l:v});{let l={};(o.open_error_prompts||[]).forEach(v=>{let L=v.session_id||v.session;L&&(l[L]={...v,received_at:Date.
now()})}),de(l)}Ea();return}if(p==="session_patch"){let l=o.session||o.session_id;if(!l)return;t(P=>Sp(P,o));let v=o.patch&&
typeof o.patch=="object"?o.patch:{},L={session_id:l,...v};v.activity&&Jt([L],{authoritative:!0}),(v.model_id!==void 0||v.
permission_mode!==void 0||v.capabilities!==void 0)&&xs([L]),v.chat_list&&hn([L]),v.status&&Vs([L]);return}if(p==="sessio\
n_health"){let l=o.session||o.session_id;l&&Y(v=>({...v,[l]:o.health}));return}if(p==="scheduled_send_status"){kr(o.scheduled_send);
return}if(p==="session_summary"){let l=o.session||o.session_id;if(!l)return;if(s(v=>{let L=!1,P=v.map(K=>{if((typeof K==
"string"?K:K?.session_id)!==l)return K;let pe={...typeof K=="object"?K:{},session_id:l,...o.status?{status:o.status}:{},
...o.activity?{activity:o.activity}:{},...o.goal?{goal:o.goal}:{},...o.fleet_summary?{fleet_summary:o.fleet_summary}:{},
...o.fleet_work_context?{fleet_work_context:o.fleet_work_context}:{},...o.last_user_request?{last_user_request:o.last_user_request}:
{},...o.last_snippet!=null?{last_snippet:o.last_snippet}:{},...zl(o),...fp(o)};return typeof K=="object"&&Nt(K,pe)?K:(L=
!0,pe)});return L?P:v}),o.status&&Y(v=>cc(v,{[l]:o.status})),o.activity){let v=String(o.activity.kind||"idle").toLowerCase();
je({type:"status",session:l,activity:o.activity,activity_trace:o.activity_trace,thinking:["thinking","generating","runni\
ng_command","applying_patch","reading_files","working"].includes(v),label:o.activity.label||""})}Number(o.unread_delta)>
0&&l!==It.current&&d(v=>({...v,[l]:(v[l]||0)+Number(o.unread_delta)}));return}if(p==="message_delta"){let l=o.session_id||
o.session;if(!l)return;let v=rp(et.current[l]||null,o);if(!v.accepted)return;Bc(l,v.stream,o.stream_trace||null);return}
if(p==="transcript_resync_required"){let l=o.session_id||o.session;if(!l||l!==It.current)return;let v=ot.current[l]||{};
ot.current[l]={...v,inFlight:!1},clearTimeout(pt.current[l]),delete pt.current[l],As(l,{mode:"tail",source:"relay_sqlite",
replace:!0});return}if(p==="history"||p==="history_snapshot"){let l=o.session||o.session_id;if(!l||o.request_id&&Yn.current[l]&&
Yn.current[l]!==o.request_id)return;let v=n.find(ve=>(typeof ve=="object"?ve.session_id:ve)===l),L=Xs(v);if(v&&typeof v==
"object"&&v.is_list_view&&o.messages?.length>0&&!L){_(ve=>{if(!ve[l])return ve;let Re={...ve};return delete Re[l],Re});return}
!o.partial&&(!o.mode||o.mode==="full")&&bs(l);let P=o.messages||[],K=c[l]||null,U=!!Xn.current[l]&&P.length>0,pe=!U&&P_(
p,o,K);i(ve=>{let Re=pe?ho(ve[l],P):P,We=Ko(um(Re,ve[l])),st=zo(U?[]:ve[l],We);return st===ve[l]?ve:{...ve,[l]:st}}),u(ve=>{
let Re={...pe?ve[l]||{}:{},partial:!!o.partial||!!(pe&&ve[l]?.partial),loaded:pe?Math.max(Number(ve[l]?.loaded||0),Number(
o.loaded_messages??P.length)||P.length,(a[l]||[]).length):Number(o.loaded_messages??P.length)||P.length,total:Number(o.total_messages??
ve[l]?.total??P.length)||P.length,limit:o.limit||null,mode:pe?ve[l]?.mode||"chunked":o.mode||(o.partial?"tail":"full")};
return Nt(ve[l]||null,Re)?ve:{...ve,[l]:Re}}),_(ve=>{if(!ve[l])return ve;let Re={...ve};return delete Re[l],Re}),U&&delete Xn.
current[l];return}if(p==="history_chunk"){let l=o.session||o.session_id;if(!l)return;let v=ot.current[l]||{},L=o.mode!==
"older"&&v.mode==="tail"&&(o.source||"relay_sqlite")===(v.source||"relay_sqlite");if(o.request_id&&ht.current[l]&&ht.current[l]!==
o.request_id&&!L)return;if(o.error&&(!Array.isArray(o.messages)||o.messages.length===0)){let Pe=String(o.error?.code||""),
Te=Number(v.retryAttempt||0);if(E_.has(Pe)&&Te<im){let Ue=Number(o.error?.retry_after_ms??o.retry_after_ms),Je=Number.isFinite(
Ue)&&Ue>0?Ue:1500,Ye=Math.max(25,Math.min(250,Math.floor(Je*.05)));clearTimeout(pt.current[l]),ot.current[l]={...v,inFlight:!1,
recovering:!0},u(on=>{let Rt={...on[l]||{},refreshing:!0};return delete Rt.error,{...on,[l]:Rt}}),pt.current[l]=setTimeout(
()=>{delete pt.current[l],!(It.current!==l||gt.current?.readyState!==WebSocket.OPEN)&&As(l,{mode:v.mode,source:v.source,
replace:v.replace,beforeOffset:v.beforeOffset,beforeId:v.beforeId,aroundId:v.aroundId,userInitiated:v.userInitiated,limit:v.
limit,chunkBytes:v.chunkBytes,retryAttempt:Te+1})},Math.ceil(Je)+Ye);return}_(Ue=>{if(!Ue[l])return Ue;let Je={...Ue};return delete Je[l],
Je}),ot.current[l]={...ot.current[l]||{},inFlight:!1},clearTimeout(pt.current[l]),delete pt.current[l],u(Ue=>({...Ue,[l]:{
...Ue[l]||{},error:String(o.error?.message||o.error||"Transcript history could not be loaded.")}}));return}let P=o.mode===
"older"?"older":o.mode==="around"?"around":"tail",K=o.cursor||{},U=K.next_before_offset??null,pe=K.next_before_id??null,
ve=!!(o.partial&&(U!=null||pe!=null)),Re=Array.isArray(o.messages)?o.messages:[],We=P==="around"||P==="tail"&&o.replace===
!0,Ht=(We?Re:Ys(a[l],Re,P)).length;i(Pe=>{let Te=Ko(um(We?fi(Pe[l],Re,v,o.source):Ys(Pe[l],Re,P),Pe[l])),Ue=zo(Pe[l],Te);
return Ue===Pe[l]?Pe:{...Pe,[l]:Ue}}),u(Pe=>{let Te={...Pe[l]||{},partial:ve,loaded:We?Number(o.loaded_messages??Ht)||Ht:
Math.max(Number(Pe[l]?.loaded||0),Number(o.loaded_messages||0),Ht),total:Number(o.total_messages||Pe[l]?.total||Ht)||Ht,
limit:null,mode:"chunked",source:o.source||"native",cursor:K,bytes_total:K.total_bytes||0,refreshing:!1};return delete Te.
error,Nt(Pe[l]||null,Te)?Pe:{...Pe,[l]:Te}}),_(Pe=>{if(!Pe[l])return Pe;let Te={...Pe};return delete Te[l],Te}),ot.current[l]=
{...ot.current[l]||{},inFlight:!1,nextBeforeOffset:U,nextBeforeId:pe},clearTimeout(pt.current[l]),delete pt.current[l];return}
if(p==="history_delta"){let l=o.session||o.session_id;if(!l||o.request_id&&Yn.current[l]&&Yn.current[l]!==o.request_id)return;
let L=(Array.isArray(o.messages)?o.messages:Array.isArray(o.events)?o.events:[]).map(K=>K?.message||K).filter(Boolean),P=Ys(
a[l],L,"tail");i(K=>{let U=Ko(Ys(K[l],L,"tail")),pe=zo(K[l],U);return pe===K[l]?K:{...K,[l]:pe}}),u(K=>{let U=K[l]||{},pe=Math.
max(Number(U.loaded||0),P.length),ve=Math.max(Number(o.total_messages||0),Number(U.total||0),pe);return{...K,[l]:{...U,loaded:pe,
total:ve,last_sequence:Number(o.last_sequence||U.last_sequence||0),mode:U.mode||"chunked"}}}),_(K=>{if(K[l]?.requestId!==
o.request_id)return K;let U={...K};return delete U[l],U});return}if(p==="status"||p==="proxy_status"||p==="session_statu\
s"){let l=o.session||o.session_id;if(!l)return;let v=o.activity?.kind||"",L=o.thinking||["thinking","generating","runnin\
g_command","applying_patch","reading_files","working"].includes(v);ap(et.current[l],o.activity||(L?null:{kind:"idle"}),L)&&
bs(l);let P=o.label||o.activity?.label||(v==="idle"?"":"Thinking"),K=L||o.activity?{kind:o.activity?.kind||(L?"thinking":
"working"),label:P,updatedAt:o.activity?.updated_at||null,observed_at:o.activity?.observed_at||null,startedAt:o.activity?.
started_at||null,interruptHint:o.activity?.interrupt_hint||"",goal:o.activity?.goal||null,goal_run:o.activity?.goal_run||
null,...o.activity?.goal_projection?{goal_projection:o.activity.goal_projection}:{},...o.activity?.goal_tombstone?{goal_tombstone:o.
activity.goal_tombstone}:{},thinking:o.activity?.thinking||null,connection:o.activity?.connection||null,connection_tombstone:o.
activity?.connection_tombstone||null,interruption:o.activity?.interruption||null,interruption_tombstone:o.activity?.interruption_tombstone||
null,current:o.activity?.current||null,step:o.activity?.step||null,usage:o.activity?.usage||null,task_list:o.activity?.task_list||
null,context_card:o.activity?.context_card||null,work_context:o.activity?.work_context||null,thinkingContent:o.activity?.
thinking?.text||o.activity?.thinkingContent||"",transport:Lp(o.activity_trace)}:!1;if(L){clearTimeout(xn.current[l]),g(pe=>Object.
is(pe[l],P)?pe:{...pe,[l]:P}),x(pe=>Qr(pe,{[l]:K},{authoritative:!0}));let U=o.activity?.thinking?.text??o.thinking_content??
o.activity?.thinkingContent;U!=null&&N(pe=>Object.is(pe[l],U)?pe:{...pe,[l]:U})}else v==="idle"?(clearTimeout(xn.current[l]),
g(U=>U[l]===!1?U:{...U,[l]:!1}),x(U=>Qr(U,{[l]:K},{authoritative:!0})),N(U=>U[l]===""?U:{...U,[l]:""})):Object.prototype.
hasOwnProperty.call(o.activity||{},"goal")||o.activity?.goal_projection||o.activity?.goal_tombstone||o.activity?.task_list||
o.activity?.step||o.activity?.usage||o.activity?.connection||o.activity?.interruption||o.activity?.interruption_tombstone?
(clearTimeout(xn.current[l]),g(U=>U[l]===!1?U:{...U,[l]:!1}),x(U=>Qr(U,{[l]:K},{authoritative:!0}))):(clearTimeout(xn.current[l]),
xn.current[l]=setTimeout(()=>{g(U=>U[l]===!1?U:{...U,[l]:!1}),x(U=>U[l]===!1?U:{...U,[l]:!1}),N(U=>U[l]===""?U:{...U,[l]:""})},
4e3));ja(o,l);return}if(p==="permission_prompt"){if(o.kind==="question")return;let l=o.session_id||o.session;l&&Z(v=>({...v,
[l]:{...o,received_at:Date.now()}}));return}if(p==="question_prompt"){let l=o.session_id||o.session,v=!o.lifecycle||["op\
en","submitting"].includes(o.lifecycle);if(!l||!uc(o))return;if(!v||iu(Lt.current,o)){v||lm(Lt.current,o),Z(L=>{let P=L[l];
if(P?.prompt_id!==o.prompt_id||P?.generation!==o.generation)return L;let{[l]:K,...U}=L;return U});return}Z(L=>{let P=L[l],
K=P?.prompt_id===o.prompt_id&&P?.generation===o.generation,U={...K?P:{},...o,received_at:K?P.received_at:Date.now(),...o.
lifecycle==="submitting"?{submitting_choice_id:P?.submitting_choice_id||"question_answers"}:{}};return K&&Nt(P,U)?L:{...L,
[l]:U}});return}if(p==="question_prompt_state"){let l=o.session_id||o.session;if(!l||!uc(o))return;["open","submitting"].
includes(o.lifecycle)&&!iu(Lt.current,o)?Z(v=>{let L=v[l];if(!(L?.prompt_id===o.prompt_id&&L?.generation===o.generation))
return v;let K={...L,...o,type:"question_prompt",received_at:L.received_at,submitting_choice_id:o.lifecycle==="submittin\
g"?L.submitting_choice_id||"question_answers":null};return Nt(L,K)?v:{...v,[l]:K}}):["open","submitting"].includes(o.lifecycle)||
(lm(Lt.current,o),Z(v=>{let L=v[l];if(L?.prompt_id!==o.prompt_id||L?.generation!==o.generation)return v;let{[l]:P,...K}=v;
return K}));return}if(p==="permission_prompt_expired"){let l=o.session_id||o.session;l&&Z(v=>{let{[l]:L,...P}=v;return P});
return}if(p==="session_error_prompt"){let l=o.session_id||o.session;l&&de(v=>({...v,[l]:{...o,received_at:Date.now()}}));
return}if(p==="session_error_prompt_cleared"){let l=o.session_id||o.session;l&&de(v=>{let{[l]:L,...P}=v;return P});return}
if(p==="chat_list"){let l=o.session_id||o.session;l&&W(v=>({...v,[l]:o.chats||[]}));return}if(p==="branch_list"){let l=o.
session_id||o.session;l&&re(v=>({...v,[l]:{branches:o.branches||[],current:o.current||""}}));return}if(p==="thread_list"){
let l=o.session_id||o.session;if(l){let v=o.threads||[],L=v.find(U=>U?.active),P=String(L?.cache_key||""),K=Ra.current[l]||
"";P&&K&&P!==K&&(Xn.current[l]=P,Rs(l)),P&&(Ra.current[l]=P),me(U=>({...U,[l]:v}))}return}if(p==="duplicate_proxy_alarm"){
ir(Array.isArray(o.duplicate_sessions)?o.duplicate_sessions:[]);return}if(p==="nightly_validation_status"){cr(Array.isArray(
o.failures)?o.failures:[]),o.revalidation_program_health&&ur(o.revalidation_program_health),o.operator_dogfood_health&&ao(
o.operator_dogfood_health);return}if(p==="app_update_validation_status"){fs(o.validation||null);return}if(p==="harness_r\
evalidation_status"){ur(o.program_health||null);return}if(p==="operator_dogfood_status"){ao(o.program_health||null);return}
if(p==="skill_list"){let l=o.session_id||o.session;l&&B(v=>({...v,[l]:{installed:o.installed||[],recommended:o.recommended||
[]}}));return}if(p==="codex_automation_view"){let l=o.session_id||o.session;l&&xe(v=>({...v,[l]:o.view||null}));return}if(p===
"terminal_output"){let l=o.session_id||o.session;l&&we(v=>({...v,[l]:o.entries||[]}));return}if(p==="file_changes"){let l=o.
session_id||o.session;l&&Ee(v=>({...v,[l]:o.entries||[]}));return}if(p==="directory_listing"){let l=o.session_id||o.session;
l&&Vt(v=>({...v,[l]:{path:o.path,entries:o.entries||[]}}));return}if(p==="file_content"){let l=o.session_id||o.session;l&&
Wn(v=>Ps(v,`${l}:${o.path}`,{path:o.path,content:o.content,truncated:o.truncated}));return}if(p==="agent_config"){let l=o.
session_id||o.session;if(!l)return;fo(l,o),X(v=>{let L=v[l]||{},P={...L,...o};return(!Array.isArray(o.available_models)||
o.available_models.length===0)&&Array.isArray(L.available_models)&&L.available_models.length>0&&(P.available_models=L.available_models),
Object.values(m.current).forEach(K=>{K.sessionId!==l||!["pending","awaiting_config"].includes(K.status)||(P[K.configKey]=
K.requestedValue)}),xt.current={...xt.current,[l]:P},{...v,[l]:P}});return}if(p==="agent_control_result"){let l=o.session_id||
o.session;if(o.request_id){Et(L=>Ps(L,o.request_id,{...o,received_at:Date.now()}));let v=Object.entries(m.current).find(
([,L])=>L.requestId===o.request_id&&L.sessionId===l&&["pending","awaiting_config"].includes(L.status));if(v){let[L,P]=v;
o.result==="failed"?$n(L,o.error?.message||o.error||"The agent rejected this setting."):o.result==="ok"&&(wt(L,{...P,status:"\
awaiting_config"}),l&&Ms(l))}}l&&o.result==="ok"&&o.command==="new_thread"&&Rs(l),l&&o.result==="ok"&&["new_thread","swi\
tch_thread"].includes(o.command)&&bo(l),l&&o.result==="ok"&&o.command==="switch_chat"&&rn(l),["permission_response","que\
stion_response"].includes(o.command)&&l&&(o.result==="ok"?Z(v=>{if(v[l]?.request_id!==o.request_id)return v;let{[l]:L,...P}=v;
return P}):o.result==="failed"&&Z(v=>v[l]?.request_id===o.request_id?{...v,[l]:{...v[l],submitting_choice_id:null,error:o.
error?.message||"Permission response failed"}}:v)),o.command==="error_prompt_action"&&l&&o.result==="failed"&&de(v=>v[l]?
{...v,[l]:{...v[l],submitting_action_id:null,error:o.error?.message||"Error prompt action failed"}}:v),o.command==="file\
_change_response"&&l&&o.result==="ok"&&vr(l);return}if(p==="message_accepted"){let l=o.client_message_id,v=o.session_id||
o.session;l&&v&&Ss(l,v);let L=["accepted","delivered","agent_started","failed"].includes(o.status)?o.status:"accepted",P=L===
"accepted"&&o.launch_accepted_at?"launch_accepted":L;if(l&&P==="failed"){Ks(l,o.failure_code||"Send failed",v);return}let K=l?
Xt.current[l]:null;l&&!["busy_queued","steered","launch_accepted","delivered","agent_started"].includes(K)&&(it(l,P),P===
"accepted"?Qt(l,"accepted","Relay accepted the message, but native delivery timed out."):P==="launch_accepted"?Qt(l,"lau\
nch_accepted","The native launch was accepted, but no native user turn was observed."):P==="delivered"?Qt(l,"delivered",
"Message reached the agent, but agent activity did not start in time."):kt(l)),l&&ts(l,v,U=>zr({...U,...o.created_at!=null?
{created_at:o.created_at}:{},...o.timestamp!=null?{timestamp:o.timestamp}:{},...o.ts!=null?{ts:o.ts}:{},...o.launch_accepted_at!=
null?{_launchAcceptedAt:o.launch_accepted_at}:{},_delivered:P==="delivered"||P==="agent_started",_agentStarted:P==="agen\
t_started",_sendError:null}));return}if(p==="proxy_send_result"&&o.result==="launch_accepted"){let l=o.client_message_id,
v=o.session_id||o.session;l&&v&&Ss(l,v),l&&!["delivered","agent_started"].includes(Xt.current[l])&&(it(l,"launch_accepte\
d"),Qt(l,"launch_accepted","The native launch was accepted, but no native user turn was observed."),ts(l,v,L=>({...L,_launchAcceptedAt:o.
accepted_at||new Date().toISOString(),_sendError:null})));return}if(p==="message_delivered"||p==="proxy_send_result"&&o.
result==="delivered"){let l=o.client_message_id,v=o.session_id||o.session;l&&v&&Ss(l,v),l&&Xt.current[l]!=="agent_starte\
d"&&(it(l,"delivered"),Qt(l,"delivered","Message reached the agent, but agent activity did not start in time.")),l&&ts(l,
v,L=>({...L,_delivered:!0,_sendError:null}));return}if(p==="agent_started"){let l=o.client_message_id,v=o.session_id||o.
session;l&&v&&Ss(l,v),l&&(kt(l),it(l,"agent_started")),v&&Fc(v,l||null),l&&ts(l,v,L=>({...L,_delivered:!0,_agentStarted:!0,
_sendError:null}));return}if(p==="message_failed"||p==="proxy_send_result"&&o.result==="failed"){let l=o.client_message_id,
v=o.session_id||o.session;if(v&&bs(v),l){let L=o.reason||o.message||o.error?.message||"Send failed";Ks(l,L,v)}return}if(p===
"message_queued"){let l=o.client_message_id,v=o.session_id||o.session;if(l){let L=Array.isArray(o.content_blocks)?o.content_blocks:
[],P=L.find(K=>K?.type==="queued_message");kt(l),it(l,"busy_queued"),v&&z(K=>({...K,[v]:[...K[v]||[],{cid:l,content:P?.content??
o.content,content_blocks:L,queuedAt:o.queued_at}]}))}return}if(p==="queue_delivered"){let l=o.client_message_id,v=o.session_id||
o.session;l&&(it(l,"accepted"),Qt(l,"accepted","Queued message left the relay, but native delivery timed out."),v&&z(L=>({
...L,[v]:(L[v]||[]).filter(P=>P.cid!==l)})));return}if(p==="steer_result"){let l=o.client_message_id,v=o.session_id||o.session;
l&&(o.result==="ok"?(it(l,"steered"),Qt(l,"steered","Message was steered, but agent activity did not start in time.")):Ks(
l,o.error?.message||o.error||"The desktop proxy rejected the message.",v),v&&z(L=>({...L,[v]:(L[v]||[]).filter(P=>P.cid!==
l)})));return}if(p==="native_queue"){let l=o.session_id||o.session,v=o.items||[];l&&z(L=>{let P=(L[l]||[]).filter(U=>U.cid&&
U.cid.startsWith("cmsg-")),K=v.map((U,pe)=>({cid:`native-${pe}`,content:U.content_blocks?.find(ve=>ve?.type==="queued_me\
ssage")?.content??U.text,content_blocks:Array.isArray(U.content_blocks)?U.content_blocks:[],native:!0,nativeIndex:U.index,
status:U.state||"queued"}));return{...L,[l]:[...P,...K]}});return}if(p==="rate_limit_active"){let l=o.session_id||o.session,
v=o.percent_used??null,L=v==null||v>=100;l&&s(P=>P.map(K=>(typeof K=="string"?K:K?.session_id)===l?{...typeof K=="object"?
K:{},session_id:l,rate_limited_until:o.retry_after_hint||(L?"unknown":null),rate_limit_active:L,percent_used:v}:K));return}
if(p==="rate_limit_cleared"){let l=o.session_id||o.session;l&&s(v=>v.map(L=>(typeof L=="string"?L:L?.session_id)===l?{...typeof L==
"object"?L:{},session_id:l,rate_limited_until:null,rate_limit_active:!1,percent_used:null}:L));return}if(p!=="session_la\
unching"){if(p==="session_launch_ack"){let l=o.request_id,v=o.session_id||o.session;l&&he(L=>{let{[l]:P,...K}=L;return K}),
v&&ee(v);return}if(p==="session_launch_failed"){let l=o.request_id,v=o.reason||o.error||"Launch failed";l&&he(L=>Ps(L,l,
{...L[l],status:"failed",error:v}));return}if(p==="session_closed"){let l=o.session||o.session_id;l&&s(v=>v.filter(L=>(typeof L==
"string"?L:L?.session_id)!==l));return}if(p==="message"||p==="proxy_message"||p==="message_event"){let l=o.session||o.session_id||
o.message?.session_id,v=o.role||o.message?.role,L=o.content||o.message?.content,P=Array.isArray(o.content_blocks)?o.content_blocks:
Array.isArray(o.message?.content_blocks)?o.message.content_blocks:null,K=o.client_message_id||o.message?.client_message_id||
null,U=o.status||o.message?.status||null,pe=o.source_message_id||o.message?.source_message_id||null,ve=o.native_source_id||
o.message?.native_source_id||null,Re=o.source_cursor||o.message?.source_cursor||null,We=o.source||o.message?.source||null,
st=o.server_message_id??o.message?.server_message_id??null,Ht=o.sequence??o.message?.sequence??null,Pe=U==="delivered"||
U==="agent_started";if(!l||!v||!L)return;v==="assistant"&&bs(l);let Te=zr({role:v,content:L,...P?{content_blocks:P}:{},...pe?
{source_message_id:pe}:{},...ve?{native_source_id:ve}:{},...Re?{source_cursor:Re}:{},...We?{source:We}:{},...st!=null?{server_message_id:st}:
{},...K?{client_message_id:K}:{},...U?{status:U}:{},...Ht!=null?{sequence:Ht}:{},...(o.created_at??o.message?.created_at)!=
null?{created_at:o.created_at??o.message?.created_at}:{},...(o.timestamp??o.message?.timestamp)!=null?{timestamp:o.timestamp??
o.message?.timestamp}:{},...(o.ts??o.message?.ts)!=null?{ts:o.ts??o.message?.ts}:{}});i(Je=>{let Ye=Je[l]||[];if(v==="us\
er"){let St=Ye.findIndex(cn=>cn._optimistic&&(K&&cn._cid===K||!K&&cn.content===L));if(St>=0){let cn=[...Ye],bn=Ye[St];return cn[St]=
zr({...bn,role:v,content:L,...P?{content_blocks:P}:{},...Te.source_message_id?{source_message_id:Te.source_message_id}:{},
...Te.native_source_id?{native_source_id:Te.native_source_id}:{},...Te.source_cursor?{source_cursor:Te.source_cursor}:{},
...Te.source?{source:Te.source}:{},...Te.server_message_id!=null?{server_message_id:Te.server_message_id}:{},...Te.client_message_id?
{client_message_id:Te.client_message_id}:{},...Te.status?{status:Te.status}:{},...Te.sequence!=null?{sequence:Te.sequence}:
{},...Te.created_at!=null?{created_at:Te.created_at}:{},...Te.timestamp!=null?{timestamp:Te.timestamp}:{},...Te.ts!=null?
{ts:Te.ts}:{},_delivered:bn._delivered||Pe,_agentStarted:bn._agentStarted||U==="agent_started",_cid:bn._cid,_optimistic:bn.
_optimistic}),{...Je,[l]:Ko(cn)}}}let on=_a(Te);if(on){let St=Ye.findIndex(cn=>_a(cn)===on);if(St>=0){if(cu(Ye[St],Te))return Je;
let cn=Array.isArray(Ye[St]?.content_blocks)&&Ye[St].content_blocks.some(Sr=>Sr?.type==="memory_citation"),bn=Array.isArray(
Te?.content_blocks)&&Te.content_blocks.some(Sr=>Sr?.type==="memory_citation");if(cn&&!bn)return Je;let wr=[...Ye];return wr[St]=
{...Ye[St],...Te},{...Je,[l]:zo(Ye,wr)}}}else if(Ye.some(St=>St.role===v&&St.content===L))return Je;let Rt=Ko([...Ye,{...Te,
...v==="user"&&K?{_cid:K}:{},_delivered:v==="user"&&Pe,_agentStarted:v==="user"&&U==="agent_started"}]);return{...Je,[l]:zo(
Ye,Rt)}}),v==="assistant"&&l!==It.current&&d(Je=>({...Je,[l]:(Je[l]||0)+1}));let Ue=zl(o);Object.keys(Ue).length>0&&s(Je=>Je.
map(Ye=>(typeof Ye=="string"?Ye:Ye?.session_id)===l?{...typeof Ye=="object"?Ye:{},session_id:l,...Ue}:Ye));return}}}}return fr.
current=je,{sessions:n,messages:a,provisionalStreams:qc,historyMeta:c,historyLoading:f,connected:y,connectionHealth:T,unread:M,
setUnread:d,thinking:h,thinkingContent:A,activities:$,health:O,deliveryStates:te,launchStates:V,justLaunched:be,setJustLaunched:ee,
permissionPrompts:Se,respondToPrompt:Qs,errorPrompts:ue,respondToErrorPrompt:ns,interruptSession:Js,controlGoal:ss,agentConfigs:Ae,
configControlStates:mn,requestAgentConfig:Ms,setAgentModel:En,setAgentEffort:Ts,setAgentPermissionMode:Ln,setAutoApprovePermissions:Zs,
setAntigravityMode:_n,setCodexConfig:ea,newThread:as,openPanel:ut,openNativeWindow:_o,requestChatList:rn,switchChat:gi,newChat:Hc,
chatLists:E,requestThreadList:bo,switchThread:vo,threadLists:ce,switchWorkspace:en,requestTerminalOutput:Da,sendTerminalInput:br,
terminalOutputs:fe,requestFileChanges:vr,respondToFileChange:hi,fileChanges:Le,sendAttachment:Gc,send:Ce,sendToSession:vi,
steerMessage:ki,discardQueuedMessage:wi,editQueuedMessage:Si,queuedMessages:ge,scheduledSends:ae,scheduleSend:On,cancelScheduledSend:ko,
refreshScheduledSends:na,launchSession:ta,resumeSession:bi,closeSession:Kc,activeSessionRef:It,restoreCachedTranscript:jc,
setSessionSubscriptions:Ia,workspaces:D,branchLists:Ze,requestBranchList:Wc,switchBranch:In,createBranch:zc,skillLists:Me,
requestSkillList:yo,automationViews:ne,showCodexAutomation:yr,controlResults:He,directoryListings:Ct,requestDirectoryListing:Uc,
fileContents:Sn,requestFileContent:_i,requestHistory:go,requestHistoryChunk:As,duplicateProxyAlarms:zn,nightlyValidationFailures:so,
latestAppUpdateValidation:wa,revalidationProgramHealth:lr,operatorDogfoodHealth:Lc,providerUsage:Kn,providerUsageRefreshReceipt:ro,
requestProviderUsageRefresh:hr,setProviderUsageWatching:ys,providerUsageResetReceipt:Sa,consumeProviderUsageResetCredit:es,
providerUsageCostDetail:Na,requestProviderUsageCostDetail:_r,hostResources:ri,hostResourceError:io,hostResourceHistory:oi,
hostResourceDetails:Ic,hostResourceSubscription:Oc,subscribeHostResources:ks,unsubscribeHostResources:mi,requestHostResourceRefresh:Ws,
clearHostResources:La,semanticNotifications:Pc,sessionAliases:ii}}function B_(e){return typeof e=="string"?e:e?.session_id||e?.id||""}function hm(e){let t=Number(e?.pin_order);return Number.
isSafeInteger(t)&&t>0?t:0}function F_(e){return e?.pinned===!0||hm(e)>0}function _m(e,t={}){let n=[],s=[];for(let a of Array.
isArray(e)?e:[]){let i=B_(a),c=i?t[i]:null;F_(c)?n.push({session:a,id:i,order:hm(c)}):s.push(a)}return n.sort((a,i)=>(a.
order||Number.MAX_SAFE_INTEGER)-(i.order||Number.MAX_SAFE_INTEGER)||a.id.localeCompare(i.id)),{pinned:n.map(a=>a.session),
unpinned:s}}var uu="remote-agent-chat:group-aliases:v1",mc=Object.freeze({"^remoteagent":"Remote Agent Chat"}),H_=new Set(["thinking",
"generating","running_command","applying_patch","reading_files","working"]),U_=new Set(["validator","test","fixture","pr\
obe","e2e","throwaway"]),G_=[/(?:^|\/)cursor-test(?:\/|$)/i,/(?:^|\/)remote-agent-(?=[^/]*(?:-(?:test|fixture|probe|e2e|validator|validation|throwaway|switch-anchor)(?:-|\/|$)))[^/]+(?:\/|$)/i,
/(?:^|\/)rac-(?=[^/]*(?:-(?:test|fixture|probe|e2e|validator|validation|throwaway)(?:-|\/|$)))[^/]+(?:\/|$)/i,/(?:^|\/)reply-with-exactly-rac-[^/]*(?:\/|$)/i];
function Un(e){return typeof e=="string"?e:e?.session_id||e?.id||""}function du(e){if(!e||typeof e!="object"||e.is_test_session===
!1)return!1;if(e.is_test_session===!0||e.is_test_session===1||e.is_test_session==="true"||e.validator_session===!0||U_.has(
String(e.session_kind||e.session_class||"").trim().toLowerCase()))return!0;let t=String(e.workspace_path||e.project_root||
"").trim().replace(/\\/g,"/").replace(/\/+$/g,"").toLowerCase();if(G_.some(s=>s.test(t)))return!0;let n=[e.workspace_name,
e.display_name,e.window_title,e.chat_title].filter(Boolean).join("/").toLowerCase();return/(?:^|[\s/_-])(?:validator|fixture|throwaway)(?:$|[\s/_-])/i.
test(n)}function sr(e){if(typeof e=="number"&&Number.isFinite(e))return e;let t=Date.parse(String(e||""));return Number.
isFinite(t)?t:0}function W_(e){return(Array.isArray(e)?e:[]).reduce((t,n)=>Math.max(t,sr(n?.ts??n?.timestamp??n?.created_at??
n?.updated_at)),0)}function ym(e,t={}){let n=Un(e),s=t.activities&&typeof t.activities=="object"?t.activities:{},i=Object.
prototype.hasOwnProperty.call(s,n)?s[n]||{kind:"idle"}:(typeof e=="object"?e.activity:null)||{kind:"idle"},u=!!t.thinking?.[n]&&
!i.generating?{...i,kind:H_.has(String(i.kind||"").toLowerCase())?i.kind:"thinking",generating:!0}:i,f=!!t.pendingPrompts?.[n]||
!!t.errorPrompts?.[n]||typeof e=="object"&&e.rate_limit_active===!0;return ec(u,f,{connected:t.connected,health:t.health?.[n]||
t.healthMap?.[n],nowMs:t.nowMs,freshnessMs:t.freshnessMs,requireFreshness:t.requireFreshness===!0})}function km(e,t={}){
let n=[],s=[],a={};for(let i of Array.isArray(e)?e:[]){let c=Un(i);if(!c)continue;let u=ym(i,t);a[c]=u,(Qa(u)?n:s).push(
i)}return{working:n,nonWorking:s,states:a}}function wm(e={}){return{...e,requireFreshness:!1}}function pu(e,t={}){let n=Array.
isArray(e)?e:[],s=n.map(Un).filter(Boolean);return{version:1,revision:Number(t.revision||0),sessionOrder:s,fallbackSessionById:Object.
fromEntries(n.map(a=>[Un(a),a]).filter(([a])=>a)),pendingEntrySinceById:{},missingSinceById:{}}}function Sm(e,t,n={}){let s=Array.
isArray(t)?t:[],a=Object.fromEntries(s.map(O=>[Un(O),O]).filter(([O])=>O)),i=Object.keys(a),c=e?.version===1?e:pu(s,n),u=Array.
isArray(c.sessionOrder)?c.sessionOrder:[],f=i.length!==u.length||i.some(O=>!u.includes(O));if(f&&n.freezeStructure)return{
ledger:c,sessions:u.map(O=>a[O]||c.fallbackSessionById?.[O]).filter(Boolean),structuralChanged:!0,deferred:!0};let _=Number.
isFinite(Number(n.nowMs))?Number(n.nowMs):Date.now(),y=Math.max(0,Number(n.entryConfirmMs)||0),S=Math.max(0,Number(n.exitGraceMs)||
0),T=n.immediateExitIds instanceof Set?n.immediateExitIds:new Set(n.immediateExitIds||[]),w=new Set(i),M={},d={},h=new Set;
for(let O of u){if(w.has(O)){h.add(O);continue}if(T.has(O)||S<=0)continue;let Y=Number(c.missingSinceById?.[O])||_;_-Y<S&&
(d[O]=Y,h.add(O))}for(let O of i){if(h.has(O))continue;if(u.includes(O)||y<=0){h.add(O);continue}let Y=Number(c.pendingEntrySinceById?.[O])||
_;_-Y>=y?h.add(O):M[O]=Y}let g=u.filter(O=>h.has(O));for(let O of i)h.has(O)&&!g.includes(O)&&g.push(O);let A=g.length!==
u.length||g.some((O,Y)=>u[Y]!==O),N=JSON.stringify(M)!==JSON.stringify(c.pendingEntrySinceById||{})||JSON.stringify(d)!==
JSON.stringify(c.missingSinceById||{}),$=Object.fromEntries(g.map(O=>[O,a[O]||c.fallbackSessionById?.[O]]).filter(([,O])=>!!O));
if(!A&&!N)return{ledger:c,sessions:u.map(O=>a[O]||c.fallbackSessionById?.[O]).filter(Boolean),structuralChanged:!1,deferred:!1};
let x={version:1,revision:Number(c.revision||0)+(A?1:0),sessionOrder:g,fallbackSessionById:$,pendingEntrySinceById:M,missingSinceById:d};
return{ledger:x,sessions:g.map(O=>a[O]||x.fallbackSessionById[O]).filter(Boolean),structuralChanged:A,deferred:f&&!A}}function z_(e,t={}){
let n=Un(e),s=t.activities?.[n]||(typeof e=="object"?e.activity:null)||null,a=ym(e,t),i=a==="needs_attention",c=Qa(a),u=Math.
max(sr(t.lastMessageAt?.[n]),W_(t.messages?.[n])),f=Math.max(sr(s?.updatedAt??s?.updated_at),sr(s?.startedAt??s?.started_at),
sr(typeof e=="object"?e.last_message_at:null),sr(typeof e=="object"?e.last_seen_at:null),sr(typeof e=="object"?e.created_at:
null));return{id:n,tier:i?2:c&&t.rankWorking!==!1?1:0,recency:u||f}}function Nm(e,t={}){let n=new Map((t.previousGroupOrder||
[]).map((u,f)=>[u,f])),s=new Map((t.previousSessionOrder||[]).map((u,f)=>[u,f])),a=(u,f)=>n.has(u)?n.get(u):n.size+f,i=(u,f)=>s.
has(u)?s.get(u):s.size+f,c=(Array.isArray(e)?e:[]).map((u,f)=>{let _=(u.sessions||[]).map((y,S)=>({session:y,sessionIndex:S,
...z_(y,t)})).sort((y,S)=>S.tier-y.tier||S.recency-y.recency||i(y.id,y.sessionIndex)-i(S.id,S.sessionIndex)||y.id.localeCompare(
S.id));return{group:{...u,sessions:_.map(y=>y.session)},groupIndex:f,tier:_.reduce((y,S)=>Math.max(y,S.tier),0),recency:_.
reduce((y,S)=>Math.max(y,S.recency),0)}});return c.sort((u,f)=>f.tier-u.tier||f.recency-u.recency||a(u.group.key,u.groupIndex)-
a(f.group.key,f.groupIndex)||u.group.key.localeCompare(f.group.key)),c.map(u=>u.group)}function Cm(e){return{groupOrder:(e||
[]).map(t=>t.key),sessionOrder:(e||[]).flatMap(t=>(t.sessions||[]).map(Un))}}function xm(e){return(e||[]).flatMap(t=>(t.
sessions||[]).map(n=>`${t.key}:${Un(n)}`)).sort().join("|")}function lu(e){return String(e?.key||"unscoped")}function fc(e){
let t={},n={},s={};for(let a of e||[]){let i=lu(a);s[i]={...a,sessions:[]};for(let c of a.sessions||[]){let u=Un(c);u&&(t[u]=
c,n[u]=i)}}return{sessionById:t,groupBySession:n,groupMeta:s}}function K_(e){return{groupOrder:[...e?.groupOrder||[]],sessionOrder:[
...e?.sessionOrder||[]]}}function V_(e,t){return(e?.groupOrder||[]).join("|")===(t?.groupOrder||[]).join("|")&&(e?.sessionOrder||
[]).join("|")===(t?.sessionOrder||[]).join("|")}function Y_(e,t={},n=null){return Cm(Nm(e,{...t,previousGroupOrder:n?.groupOrder||
t.previousGroupOrder,previousSessionOrder:n?.sessionOrder||t.previousSessionOrder}))}function Vo(e,t={}){let n=Nm(e,t),s=fc(
n),a=Cm(n);return{version:1,revision:Number(t.revision||0),groupOrder:a.groupOrder,sessionOrder:a.sessionOrder,historicalGroupOrder:a.
groupOrder,historicalSessionOrder:a.sessionOrder,historicalGroupBySession:s.groupBySession,groupBySession:s.groupBySession,
groupMeta:s.groupMeta,fallbackSessionById:s.sessionById,sourceMembership:xm(e)}}function dc(e,t){let n=fc(t),s=new Map((e?.
groupOrder||[]).map(a=>[a,[]]));for(let a of e?.sessionOrder||[]){let i=e.groupBySession?.[a];if(!i||!s.has(i))continue;
let c=n.sessionById[a]||e.fallbackSessionById?.[a];c&&s.get(i).push(c)}return(e?.groupOrder||[]).map(a=>({...n.groupMeta[a]||
e.groupMeta?.[a]||{key:a},key:a,sessions:s.get(a)||[]})).filter(a=>a.sessions.length>0)}function bm(e,t,n={}){let s=Y_(t,
n,e);if(!V_(K_(e),s))return!0;let a=fc(t);return Object.entries(a.groupBySession).some(([i,c])=>e.groupBySession?.[i]!==
c)}function Am(e,t,n={}){let s=e?.version===1?e:Vo(t,n),a=xm(t);if((s.sessionOrder||[]).length===0&&a){let h=Vo(t,{...n,
revision:Number(s.revision||0)+1});return{ledger:h,groups:dc(h,t),orderChanged:!1,structuralChanged:!0,deferred:!1}}if(a===
s.sourceMembership)return{ledger:s,groups:dc(s,t),orderChanged:bm(s,t,n),structuralChanged:!1,deferred:!1};if(n.freezeStructure)
return{ledger:s,groups:dc(s,t),orderChanged:!0,structuralChanged:!0,deferred:!0};let i=fc(t),c=new Set(Object.keys(i.sessionById)),
u=[...s.historicalSessionOrder||s.sessionOrder||[]],f=[...s.historicalGroupOrder||s.groupOrder||[]],_={...s.historicalGroupBySession||
s.groupBySession||{}};for(let h of t||[]){let g=lu(h);f.includes(g)||f.push(g);for(let A of h.sessions||[]){let N=Un(A);
N&&!u.includes(N)&&(u.push(N),_[N]=g)}}let y={},S=[],T=[],w={...s.groupMeta||{}},M={};for(let h of u)c.has(h)&&(S.push(h),
y[h]=s.groupBySession?.[h]||_[h]||i.groupBySession[h],M[h]=i.sessionById[h]);for(let h of t||[]){let g=lu(h);for(let A of h.
sessions||[]){let N=Un(A);!N||y[N]||(S.push(N),y[N]=g,M[N]=A,w[g]={...h,sessions:[]})}}for(let h of f)S.some(g=>y[g]===h)&&
T.push(h);for(let h of S){let g=y[h];T.includes(g)||T.push(g)}let d={version:1,revision:Number(s.revision||0)+1,groupOrder:T,
sessionOrder:S,historicalGroupOrder:f,historicalSessionOrder:u,historicalGroupBySession:_,groupBySession:y,groupMeta:w,fallbackSessionById:M,
sourceMembership:a};return{ledger:d,groups:dc(d,t),orderChanged:bm(d,t,n),structuralChanged:!0,deferred:!1}}function Rm(e,t,n={}){
return Vo(t,{...n,previousGroupOrder:e?.groupOrder,previousSessionOrder:e?.sessionOrder,revision:Number(e?.revision||0)+
1})}function pc(e){let t=String(e||"").trim().replace(/\\/g,"/").replace(/\/+$/,"");return!t||t.toLowerCase()==="unknown"||
!/^(?:[A-Za-z]:\/|\/\/|\/)/.test(t)?null:{key:t.toLowerCase(),path:t}}function Mm(e){return String(e||"").replace(/\\/g,
"/").replace(/\/+$/,"").split("/").filter(Boolean).pop()||"Unscoped"}function X_(e,t){return e===t||e.startsWith(`${t}/`)}
function Q_(e){return Mm(e).toLowerCase().replace(/[^a-z0-9]+/g,"")}function vm(e){return`alias:${String(e||"").trim().toLowerCase().
replace(/[^a-z0-9]+/g,"-")}`}function gc(e){let t=e&&typeof e=="object"&&!Array.isArray(e)?e:{};return Object.fromEntries(
Object.entries({...mc,...t}).filter(([n,s])=>String(n).trim()&&String(s).trim()).map(([n,s])=>[String(n).trim(),String(s).
trim()]))}function J_(e,t,n){let s=t&&typeof t=="object"&&(t.group_alias||t.project_group)||null;if(typeof s=="string"&&
s.trim()){let i=s.trim();return{key:vm(i),title:i}}if(!e)return null;let a=Q_(e.path);for(let[i,c]of Object.entries(gc(n)))
try{if(new RegExp(i,"i").test(a))return{key:vm(c),title:c}}catch{}return null}function mu(e,t={},n=mc){let s=Array.isArray(
e)?e:[],a=s.map(u=>pc(u&&typeof u=="object"?u.project_root:null)).filter(Boolean).sort((u,f)=>f.key.length-u.key.length),
i=[],c=new Map;for(let u of s){let f=typeof u=="string"?u:u?.session_id||u?.id,_=f?t[f]:null,y=pc(u&&typeof u=="object"?
u.project_root:null),S=pc(u&&typeof u=="object"?u.workspace_path:null)||pc(_?.file_access_scope),T=!y&&S?a.find(g=>X_(S.
key,g.key)):null,w=y||T||S,M=J_(w,u,n),d=M?.key||w?.key||"unscoped",h=c.get(d);h||(h={key:d,label:M?.title||(w?Mm(w.path):
"Unscoped"),path:w?.path||null,sessions:[]},c.set(d,h),i.push(h)),h.sessions.push(u)}return i}var Z_=new Set(["claude","claude_cli","claude-desktop","codex","codex_cli","codex-desktop","cursor","cursor_cli","gemini",
"continue","continue_yolo","roo_code","cline","antigravity","antigravity_panel","antigravity-v2"]);function Tm(e,t={},n="\
unknown",s=!0){let a=typeof e=="string"?e:String(e?.session_id||e?.id||""),i=String(typeof e=="object"?e?.agent_type||t?.
agent_type||"":t?.agent_type||""),c=t?.capabilities||{};return!!a&&!!s&&Z_.has(i)&&n!=="disconnected"&&e?.disconnected!==
!0&&e?.is_list_view!==!0&&c.send!==!1&&c.send_message!==!1&&c.message_send!==!1}function $m(e,t=()=>!0){let n=Array.isArray(
e?.session_ids)?e.session_ids:[],s=[...new Set(n.map(u=>String(u||"").trim()).filter(Boolean))],a=typeof e?.content=="st\
ring"?e.content.trim():"";if(s.length<1||s.length>20)return{ok:!1,error:"Select between 1 and 20 sessions"};if(!a||a.length>
65536)return{ok:!1,error:"Prompt must contain 1-65536 characters"};let i=`SEND TO ${s.length} SESSIONS`;if(e?.confirmation!==
i)return{ok:!1,error:"Broadcast confirmation does not match the selected session count"};let c=s.filter(u=>!t(u));return c.
length?{ok:!1,error:"One or more selected sessions cannot receive messages",unsupported:c}:{ok:!0,sessionIds:s,content:a,
confirmation:i}}function Em(e){return Object.fromEntries(e.map(t=>[t,{status:"queued",error:null}]))}var{useEffect:Lm,useLayoutEffect:eb,useRef:hc,useState:fu}=React,ar=12,Im=10,gu=360,Om=210,tb=450;function nb(e,t,n){return Math.
min(Math.max(e,t),Math.max(t,n))}function sb(e){return`title-disclosure-${String(e||"title").replace(/[^a-z0-9_-]+/gi,"-")}`}
function _c({title:e,disclosureKey:t,kind:n="title",wrapperClassName:s,triggerClassName:a,disclosureClassName:i,triggerLabel:c,
triggerTag:u="button"}){let f=hc(null),_=hc(null),y=hc(null),S=hc({focused:!1,hovered:!1,latched:!1}),[T,w]=fu(!1),[M,d]=fu(
!1),[h,g]=fu(null),A=sb(`${n}-${t}`),N=u;function $(){let z=S.current;w(z.focused||z.hovered||z.latched)}function x({restoreFocus:z=!1}={}){
S.current={focused:!1,hovered:!1,latched:!1},d(!1),g(null),w(!1),z&&f.current?.focus({preventScroll:!0})}function O(){S.
current.latched=!0,d(!0),w(!0)}function Y(){y.current&&(clearTimeout(y.current),y.current=null)}Lm(()=>()=>Y(),[]),Lm(()=>{
if(!T||!M)return;let z=ae=>{f.current?.contains(ae.target)||_.current?.contains(ae.target)||x()};return document.addEventListener(
"pointerdown",z,!0),()=>document.removeEventListener("pointerdown",z,!0)},[T,M]),eb(()=>{if(!T)return;let z=null,ae=()=>{
z=null;let V=f.current,he=_.current;if(!V||!he)return;let be=V.getBoundingClientRect();if(be.bottom<=0||be.top>=window.innerHeight||
be.right<=0||be.left>=window.innerWidth){x();return}let ee=window.innerWidth,Se=window.innerHeight,Z=document.querySelector(
".sidebar")?.getBoundingClientRect(),ue=window.matchMedia?.("(pointer: coarse)")?.matches===!0||ee<=640,de=Math.max(be.right,
Z?.right||be.right),Ae=ee-de-Im-ar,X=he.getBoundingClientRect().height;if(!ue&&Ae>=Om){let D=Math.min(gu,Ae),J=nb(be.top,
ar,Se-X-ar);g({mode:"right",left:de+Im,top:J,width:D});return}g({mode:"sheet",bottom:ar,left:ar,width:Math.min(gu,ee-ar*
2)})},_e=()=>{z===null&&(z=requestAnimationFrame(ae))};return _e(),window.addEventListener("resize",_e),document.addEventListener(
"scroll",_e,!0),()=>{z!==null&&cancelAnimationFrame(z),window.removeEventListener("resize",_e),document.removeEventListener(
"scroll",_e,!0)}},[T,e]);let te={ref:f,className:a,role:u==="button"?void 0:"button",type:u==="button"?"button":void 0,tabIndex:u===
"button"?void 0:0,"aria-label":c,"aria-describedby":T?A:void 0,"aria-expanded":T,onPointerEnter:z=>{z.pointerType&&z.pointerType!==
"mouse"&&z.pointerType!=="pen"||(S.current.hovered=!0,$())},onPointerLeave:z=>{z.pointerType&&z.pointerType!=="mouse"&&z.
pointerType!=="pen"||(S.current.hovered=!1,$())},onPointerDown:z=>{z.pointerType==="touch"&&(Y(),y.current=setTimeout(()=>{
y.current=null,O()},tb))},onPointerUp:Y,onPointerCancel:Y,onFocus:()=>{S.current.focused=!0,$()},onBlur:()=>{S.current.focused=
!1,$()},onClick:z=>{z.stopPropagation(),O()},onContextMenu:z=>{z.preventDefault(),z.stopPropagation(),O()},onKeyDown:z=>{
if(z.key==="Escape"){z.preventDefault(),x({restoreFocus:!0});return}u!=="button"&&(z.key==="Enter"||z.key===" ")&&(z.preventDefault(),
O())}},ie=h||{mode:"measuring",left:-1e4,top:ar,width:gu},ge=T&&ReactDOM.createPortal(React.createElement("div",{ref:_,id:A,
className:`title-disclosure-portal ${i||""}`.trim(),role:"tooltip","data-title-disclosure-for":t,"data-title-disclosure-\
kind":n,"data-placement":ie.mode,style:{left:`${ie.left}px`,top:ie.top==null?"auto":`${ie.top}px`,bottom:ie.bottom==null?
"auto":`${ie.bottom}px`,width:ie.mode==="sheet"?`${ie.width}px`:"max-content",maxWidth:`${ie.width}px`,minWidth:`${Math.
min(Om,ie.width)}px`}},e),document.body);return React.createElement("div",{className:s},React.createElement(N,{...te},e),
ge)}var hu=Object.freeze([{command:"/goal resume",action:"resume",detail:"Resume the current Codex goal through native goal \
control."},{command:"/goal pause",action:"pause",detail:"Pause the current Codex goal through native goal control."}]);function qm(e,t={}){
let s=(typeof e=="string"?e:"").trim(),a=Math.max(0,Number(t.attachmentCount)||0);if(!s||a>0||/[\r\n]/.test(s))return{kind:"\
chat",text:s};let i=s.toLowerCase(),c=hu.find(u=>u.command===i);return c?{kind:"goal_control",action:c.action,command:c.
command,text:s}:/^\/goal(?:\s|$)/i.test(s)?{kind:"unsupported_goal_control",command:s,text:s}:{kind:"chat",text:s}}function Pm(e,t){
let n=String(t||"").trim().toLowerCase();return e==="resume"&&n==="active"?"Already active":e==="pause"&&n==="paused"?"A\
lready paused":""}var Dm={schema_version:1,asset_set_version:"2026-07-16.1",retrieved_date:"2026-07-16",policy:{purpose:"First-party provi\
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
er time without modifying source pixels"]}]}]};var rb=Object.freeze(Object.fromEntries(Dm.providers.map(e=>[e.provider_id,Object.freeze({accessibleName:e.accessible_name,
light:`/provider-assets/${e.render.web.light}`,dark:`/provider-assets/${e.render.web.dark}`,darkTint:e.render.web.dark_tint||
""})])));function ob(e){return rb[String(e||"")]||null}function bc({providerId:e,providerName:t}){let n=ob(e),[s,a]=React.
useState(!1);React.useEffect(()=>a(!1),[e]);let i=n?.accessibleName||String(t||"Unknown provider");return!n||s?React.createElement(
"span",{className:"usage-dashboard-provider-mark usage-dashboard-provider-mark-fallback","data-provider-mark-id":e,role:"\
img","aria-label":`${i} provider mark unavailable`},React.createElement("span",{"aria-hidden":"true"},i)):React.createElement(
"span",{className:"usage-dashboard-provider-mark","data-provider-mark-id":e,role:"img","aria-label":`${i} provider mark`},
React.createElement("img",{className:"usage-dashboard-provider-mark-image usage-dashboard-provider-mark-light",src:n.light,
alt:"","aria-hidden":"true",onError:()=>a(!0)}),React.createElement("img",{className:`usage-dashboard-provider-mark-imag\
e usage-dashboard-provider-mark-dark${n.darkTint?" usage-dashboard-provider-mark-tinted":""}`,src:n.dark,alt:"","aria-hi\
dden":"true",onError:()=>a(!0)}))}var ib=Object.freeze({codex:"openai-codex","codex-desktop":"openai-codex",codex_cli:"openai-codex",codex_vscode:"openai-\
codex",claude:"anthropic-claude","claude-desktop":"anthropic-claude",claude_cli:"anthropic-claude",claude_code:"anthropi\
c-claude",cursor:"cursor",cursor_cli:"cursor",antigravity:"google-antigravity",antigravity_panel:"google-antigravity","a\
ntigravity-v2":"google-antigravity",gemini:"google-antigravity",ollama:"ollama-local"}),cb=Object.freeze({"openai-codex":"\
OpenAI Codex","anthropic-claude":"Anthropic Claude",cursor:"Cursor","google-antigravity":"Google Antigravity","ollama-lo\
cal":"Ollama"});function Dt(e,t=160){return String(e??"").replace(/\s+/g," ").trim().slice(0,t)}function vc(e){return Dt(
e).toLowerCase().replace(/[^a-z0-9]+/g,"")}function Yo(e){let t=Number(e);return Number.isFinite(t)?t:null}function lb(e,t){
return Dt(e?.agent_type||e?.agentType||t?.agent_type||t?.agentType,80)}function Bm(e,t){return Dt(e?.usage_billing_provider_id||
e?.billing_provider_id||e?.provider_usage?.provider_id||t?.usage_billing_provider_id||t?.billing_provider_id,80)}function ub(e,t){
return Dt(e?.usage_account_fingerprint||e?.provider_account_fingerprint||e?.provider_usage?.account_fingerprint||t?.usage_account_fingerprint,
96)}function db(e,t){return Dt(e?.usage_quota_domain||e?.provider_quota_domain||e?.provider_usage?.quota_domain||t?.usage_quota_domain,
120)}function pb(e,t){let n=Dt(t?.observed_model_id||t?.model_id||t?.selected_model_id||t?.model||e?.observed_model_id||
e?.model_id||e?.selected_model_id||e?.model,160),s=Dt(t?.observed_model_label||t?.model_label||e?.model_label||n,160);return{
id:n,label:s}}function mb(e,t,n){let s=Dt(n?.model_vendor||t?.model_vendor,80);if(s)return s;let a=`${e.id} ${e.label}`.
toLowerCase();return/claude|anthropic/.test(a)?"Anthropic":/gemini|google/.test(a)?"Google":/gpt|codex|openai|\bo[1345](?:\b|-)/.
test(a)?"OpenAI":/ollama|qwen|gemma|llama|mistral/.test(a)?"Ollama/runtime-defined":e.id?"Unknown model vendor":"Not rep\
orted"}function fb(e,t){let n=Dt(e?.usage_runtime_kind||e?.ollama_runtime_kind||e?.model_runtime_kind||t?.usage_runtime_kind||
t?.ollama_runtime_kind||t?.model_runtime_kind,32).toLowerCase();return n==="local"||n==="cloud"?n:""}function gb(e,t){if(!e.
id||!t)return!1;let n=[vc(e.id),vc(e.label)].filter(Boolean),s=[vc(t.id),vc(t.label)].filter(Boolean);return s.length===
0?!1:s.some(a=>n.some(i=>i===a||i.includes(a)||a.includes(i)))}function _u(e){let t=Yo(e?.remainingPercent);if(t!=null)return t;
let n=Yo(e?.usedPercent);return n==null?null:100-n}function jm(e,t){let n=_u(e),s=_u(t);if(n!=null&&s!=null&&n!==s)return n-
s;if(n!=null)return-1;if(s!=null)return 1;let a=Yo(e?.durationMinutes),i=Yo(t?.durationMinutes);return a!=null&&i!=null&&
a!==i?a-i:Dt(e?.label).localeCompare(Dt(t?.label))}function hb(e,t,n){let s=lb(e,t),a=pb(e,t),i=Bm(e,t)||ib[s]||"";return{
supported:!!i,state:i?"unavailable":"unsupported",tone:"unavailable",message:i?"Usage account unavailable":"No provider \
usage mapping",billingProviderId:i,billingProviderName:cb[i]||i||"Provider",providerMarkId:i,harnessSurface:s,modelId:a.
id,modelLabel:a.label,modelVendor:mb(a,e,t),accountFingerprint:"",accountLabel:"",quotaDomain:"",plan:"",mappingConfidence:"\
unavailable",generation:Number(n?.generation)||0,capturedAt:"",staleAfter:"",freshness:Dt(n?.collectionState||"unavailab\
le",40),source:"",error:null,applicableWindows:[],headerWindows:[],credits:null,financials:null,cloudUsage:null,localRuntime:null,
runtimeKind:i==="ollama-local"?fb(e,t):""}}function _b(e,t,n,s){let a=Array.isArray(s?.entries)?s.entries:[],i=ub(t,n),c=db(
t,n),u=e.billingProviderId?a.filter(f=>f?.providerId===e.billingProviderId):a.filter(f=>Array.isArray(f?.harnessTypes)&&
f.harnessTypes.includes(e.harnessSurface));return i&&(u=u.filter(f=>f?.accountFingerprint===i)),c&&(u=u.filter(f=>f?.quotaDomain===
c)),u.length===1?{entry:u[0],confidence:i||c?"explicit_account":Bm(t,n)?"explicit_provider":"unique_provider_account"}:u.
length>1?{entry:null,confidence:"ambiguous",candidates:u}:{entry:null,confidence:i||c?"linked_account_unavailable":"unav\
ailable",candidates:u}}function Fm(e,t,n,s=Date.now()){let a=hb(e,t,n);if(!a.supported)return a;let i=_b(a,e,t,n);if(!i.
entry)return{...a,state:i.confidence==="ambiguous"?"ambiguous":"unavailable",message:i.confidence==="ambiguous"?"Usage a\
ccount ambiguous":"Usage account unavailable",mappingConfidence:i.confidence};let c=i.entry,u=Date.parse(c.staleAfter||""),
_=Number.isFinite(u)&&u<=s&&c.status==="fresh"?"stale":Dt(c.status||"unavailable",40),y={id:a.modelId,label:a.modelLabel},
S=Array.isArray(c.windows)?c.windows.filter($=>$&&$.usedPercent!=null):[],T=S.filter($=>$.modelScope&&gb(y,$.modelScope)).
sort(jm),w=S.filter($=>!$.modelScope).sort(jm),M=[...T,...w],d=T.length>0?[T[0],w[0]].filter(Boolean):w.slice(0,2),h=a.runtimeKind;
if(a.billingProviderId==="ollama-local"){if(!h)return{...a,billingProviderName:c.providerName||a.billingProviderName,accountFingerprint:c.
accountFingerprint,accountLabel:c.accountLabel,quotaDomain:c.quotaDomain,plan:c.plan,mappingConfidence:i.confidence,capturedAt:c.
capturedAt,staleAfter:c.staleAfter,freshness:_,source:c.source,state:"ambiguous",message:"Ollama runtime unavailable",cloudUsage:c.
cloudUsage,localRuntime:c.localRuntime};if(h==="local")return{...a,billingProviderName:c.providerName||a.billingProviderName,
accountFingerprint:c.accountFingerprint,accountLabel:c.accountLabel,quotaDomain:c.quotaDomain,plan:c.plan,mappingConfidence:i.
confidence,capturedAt:c.capturedAt,staleAfter:c.staleAfter,freshness:_,source:c.source,state:c.localRuntime?"local":"una\
vailable",tone:c.localRuntime?"local":"unavailable",message:c.localRuntime?"Local \xB7 no plan limit":"Local runtime tel\
emetry unavailable",localRuntime:c.localRuntime,cloudUsage:c.cloudUsage}}let g=new Set(d.map($=>$.tone)),A=g.has("critic\
al")?"critical":g.has("warning")?"warning":_==="stale"?"stale":d.length>0?"ok":"unavailable",N=_==="auth_required"||_===
"unavailable"?"unavailable":_==="stale"||_==="rate_limited"?"stale":d.some($=>Number($.usedPercent)>=100)?"exhausted":d.
length>0?"ready":"unavailable";return{...a,state:N,tone:N==="exhausted"?"critical":A,message:d.length>0?"":"Applicable u\
sage windows unavailable",billingProviderName:c.providerName||a.billingProviderName,accountFingerprint:c.accountFingerprint,
accountLabel:c.accountLabel,quotaDomain:c.quotaDomain,plan:c.plan,mappingConfidence:i.confidence,capturedAt:c.capturedAt,
staleAfter:c.staleAfter,freshness:_,source:c.source,error:c.error,applicableWindows:M,headerWindows:d,credits:c.credits,
financials:c.financials,cloudUsage:c.cloudUsage,localRuntime:c.localRuntime}}function bu(e){let t=Dt(e?.label||"Usage",60),
n=_u(e);return{label:t,usedPercent:Yo(e?.usedPercent),remainingPercent:n,compactValue:n==null?"Unavailable":`${Math.max(
0,Math.round(n))}% left`,reset:Dt(e?.resetDescription||e?.resetsAt,120),tone:Dt(e?.tone||"unavailable",24)}}var Mf=Yg(Jm()),{goalLifecycleSupported:Ub,latestUserRequestFromMessages:Gb,projectFleetWorkContext:Wb}=Mf.default,{useState:le,
useRef:ke,useEffect:Oe,useLayoutEffect:ka}=React,Zm="remote-agent-chat:drafts:v1",ef="remote-agent-chat:show-test-sessio\
ns:v1",zb=120,Kb=500,Vb=160,Yb=256*1024,tf=Object.freeze([]),Xb=[...hu,{command:"/plan",detail:"Outline the implementati\
on approach and major steps."},{command:"/review",detail:"Review the current changes for bugs, regressions, and missing \
tests."},{command:"/fix",detail:"Implement or repair the current issue."},{command:"/summarize",detail:"Summarize the cu\
rrent state and important changes."}],Gn={claude:{name:"Claude Code",color:"#cc785c",abbr:"CC",logo:"/logo-claude-in-ag.\
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
color:"#7c3aed",abbr:"A2",logo:null}},Au={name:"Agent",color:"#8b949e",abbr:"AG"};function Ru(e){return e==="continue"||
e==="continue_yolo"}function Jo(e){return e==="cline"||e==="roo_code"}function Qb(e){return e==="codex"||e==="codex-desktop"}function Jb(e){return e==="codex_cli"||e==="cursor_cli"?Vb:Qb(e)?
Kb:zb}function oe(e,t=""){return typeof e=="string"?e:e==null?t:String(e)}function Kt(e){if(typeof e=="string")return e;
if(Array.isArray(e))return e.map(t=>typeof t=="string"?t:!t||typeof t!="object"?"":typeof t.text=="string"?t.text:typeof t.
content=="string"?t.content:typeof t.url=="string"?t.url:typeof t.image_url=="string"?t.image_url:"").filter(Boolean).join(
" ");if(e&&typeof e=="object"){if(typeof e.text=="string")return e.text;if(typeof e.content=="string")return e.content;if(typeof e.
url=="string")return e.url;if(typeof e.image_url=="string")return e.image_url;try{return JSON.stringify(e)}catch{return""}}
return""}function Tf(e){let t=typeof e=="string"?e:oe(e),n=2166136261;for(let s=0;s<t.length;s++)n^=t.charCodeAt(s),n=Math.
imul(n,16777619);return(n>>>0).toString(36)}function Tc(e,t=0){if(!e||typeof e!="object")return`empty:${t}`;if(e._cid)return`\
cid:${e._cid}`;if(e.source_message_id)return`source:${e.source_message_id}`;if(e.native_source_id)return`native:${e.native_source_id}`;
if(e.id!=null)return`id:${e.id}`;if(e.server_message_id!=null)return`server:${e.server_message_id}`;if(e.client_msg_id)return`\
client:${e.client_msg_id}`;if(e.sequence!=null)return`seq:${e.sequence}`;let n=Kt(e.content)||si(e.content_blocks),s=Array.
isArray(e.content_blocks)?JSON.stringify(e.content_blocks):"";return["body",e.role||"",e.ts||"",Tf(`${n}
${s}`)].join(":")}function Zb(e){let t=Kt(e?.content)||si(e?.content_blocks),n=Array.isArray(e?.content_blocks)?JSON.stringify(
e.content_blocks):"";return Tf(`${t}
${n}`)}function ev(e){return e?.role==="user"?"user":no(e?.content_blocks)[0]?.type||"markdown"}function nf(e){return(Array.
isArray(e)?e:[]).map((n,s)=>Tc(n,s))}function tv(e,t){return!e||!t?"":t.type!=="question_prompt"?`${e}\0legacy\0${t.prompt_id||
t.request_id||t.id||"prompt"}`:!t.prompt_id||!t.generation?"":`${e}\0question\0${t.prompt_id}\0${t.generation}`}function nv(e){
return e?.matches?.(".messages")?"transcript":e?.matches?.(".session-list")?"sidebar":"other"}function Mu(e,t,n={}){if(!e)
return;let s=e.style.scrollBehavior;e.style.scrollBehavior="auto";let a={container:n.container||nv(e),writer:n.writer||"\
scroll-coordinator",reason:n.reason||"unspecified",interaction_epoch:Number(n.interactionEpoch)||0,route_session_id:n.sessionId||
null,anchor_id:n.anchorId||null,anchor_offset_px:Number.isFinite(n.anchorOffset)?n.anchorOffset:null,bottom_gap_px:e.scrollHeight-
e.scrollTop-e.clientHeight,payload_generation:Number(n.payloadGeneration)||0},i=typeof window<"u"&&window.__RAC_TEMPORAL_CANARY__?.
active;i&&(window.__RAC_SCROLL_WRITE_CONTEXT__=a);try{e.scrollTop=t}finally{i&&window.__RAC_SCROLL_WRITE_CONTEXT__===a&&
delete window.__RAC_SCROLL_WRITE_CONTEXT__}requestAnimationFrame(()=>{e.style.scrollBehavior==="auto"&&(e.style.scrollBehavior=
s)})}function sv(e){let t=Kt(e),n=t.match(/^\[File: ([^\]]+?) [→\u2192] ([A-Za-z]:\\.+?\\uploads\\([^\\\]]+))\]$/);if(!n)
return t;let[,s,,a]=n;return/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(s)?`![${s}](/uploads/${a})`:t}function av(e){return Kt(
e).trim().length>0}function no(e){return Array.isArray(e)?e.filter(t=>t&&typeof t=="object").map(t=>{let n=oe(t.type||"m\
arkdown").toLowerCase();if(n==="code"){let s=oe(t.language||t.lang||"").trim(),a=Kt(t.content||t.text||t.markdown||"");return{
...t,type:"markdown",content:`\`\`\`${s}
${a}
\`\`\``}}return n==="file_change"?{...t,type:"file_changes"}:n==="tool"?{...t,type:"tool_call"}:n==="tool_output"||n==="\
result"?{...t,type:"tool_result"}:n==="thought"?{...t,type:"thinking"}:n==="task_list"?{...t,type:"plan"}:n==="queue"||n===
"queued"?{...t,type:"queued_message"}:n==="banner"||n==="notification"?{...t,type:"notice"}:n==="worked"||n==="activity"?
{...t,type:"status"}:t}):[]}function $f(e){if(!e||typeof e!="object")return"";let t=[e.workdir?`cwd: ${e.workdir}`:null,
e.command?`$ ${e.command}`:null,e.stdout||null,e.stderr?`stderr:
${e.stderr}`:null,e.exit_code!=null?`exit code: ${e.exit_code}`:null].filter(Boolean);if(t.length)return t.join(`

`);if(Array.isArray(e.files)&&e.files.length>0){let n=e.files.map(s=>[s.path||s.file||"",s.added!=null?`+${s.added}`:"",
s.removed!=null?`-${s.removed}`:""].filter(Boolean).join(" ")).filter(Boolean).join(`
`);return[e.content||e.text||e.markdown||"",n].filter(Boolean).join(`

`)}if(Array.isArray(e.tasks)&&e.tasks.length>0){let n=e.tasks.map(s=>{let a=oe(s?.text||s?.step||s?.title).trim(),i=oe(s?.
state||s?.status||"pending").trim();return a?`[${i}] ${a}`:""}).filter(Boolean).join(`
`);return[e.content||"",n].filter(Boolean).join(`
`)}return e.content||e.text||e.markdown||e.title||e.label||""}function rv(e){return e?av(e.content)?!0:no(e.content_blocks).
some(t=>Kt($f(t)).trim().length>0):!1}function si(e){return no(e).map(t=>Kt($f(t))).filter(Boolean).join(`

`)}function ba({actions:e}){return!Array.isArray(e)||e.length===0?null:React.createElement("div",{className:"content-blo\
ck-actions"},e.map((t,n)=>React.createElement("span",{key:t.id||n,className:`content-block-action-label${t.unsupported?"\
 unsupported":""}`,title:t.unsupported?"This Codex control is visible in the source app but is not currently available f\
rom the web UI.":void 0},t.label||t.id||"Action")))}var ov=512,or=new Map;function iv(e,t){if(e)for(or.delete(e),or.set(
e,t);or.size>ov;)or.delete(or.keys().next().value)}function va({className:e,summary:t,children:n,stateKey:s="",defaultOpen:a=!0}){
let[i,c]=React.useState(()=>s&&or.has(s)?or.get(s):a),u=React.useCallback(f=>{let _=f.currentTarget.open;c(_),iv(s,_)},[
s]);return React.createElement("details",{className:e,open:i,onToggle:u},React.createElement("summary",null,t),n)}function cv(e){
let t=oe(e).trim().match(/^(Edited\s+\d+\s+files?)(?:\s+(\+\d+))?(?:\s+(-\d+))?$/i);return t?{label:t[1],additions:t[2]||
"",deletions:t[3]||""}:null}function lv({blocks:e,monospace:t,autoExpandLongCodeBlocks:n,onOpenPath:s,agentType:a,richContentEager:i=!0,
richContentCacheIdentity:c=""}){let u=no(e);if(u.length===0)return null;let f=oe(a).toLowerCase()==="cursor",_=oe(a).toLowerCase()===
"claude",y=oe(a).toLowerCase()==="codex",S=oe(a).toLowerCase()==="codex-desktop",T=["codex","codex-desktop","codex_cli"].
includes(oe(a).toLowerCase()),w=oe(a).toLowerCase()==="antigravity-v2";function M(h){let g=[h.workdir?`cwd: ${h.workdir}`:
null,h.command?`$ ${h.command}`:null,h.stdout||null,h.stderr?`stderr:
${h.stderr}`:null,h.exit_code!=null?`exit code: ${h.exit_code}`:null].filter(Boolean);return g.length?g.join(`

`):Kt(h.content||h.text||h.markdown||"")}function d(h,g){return React.createElement(Gr,{content:h,monospace:t,autoExpandLongCodeBlocks:n,
onOpenPath:s,deferUntilVisible:!i,cacheIdentity:`${c}:block:${g}`})}return React.createElement("div",{className:`content\
-blocks${f?" content-blocks-cursor":""}`},u.map((h,g)=>{let A=oe(h.type||"markdown").toLowerCase(),N=oe(h.title||h.label||
h.summary||A),$=M(h);if(A==="status")return React.createElement("div",{key:g,className:"content-block content-block-stat\
us-chip",title:N},N||"Status");if(A==="thinking"){let x=!$||oe($).replace(/\s+/g," ").trim()===N;if(T&&h.activity_summary===
!0){let O=$&&!x?$:N&&N.toLowerCase()!=="thinking"?N:"";return O?React.createElement("div",{key:h.native_source_id||g,className:"\
content-block content-block-thinking-native-summary",role:"note","aria-label":"Codex activity summary","data-native-sour\
ce-id":h.native_source_id||void 0,"data-native-turn-id":h.native_turn_id||void 0},React.createElement("div",{className:"\
content-block-thinking-native-summary-copy"},d(O,g)),React.createElement(ti,{instant:h.producer_timestamp||h.created_at||
h.timestamp||h.ts})):null}if(y){let O=$&&!x?$:N&&N.toLowerCase()!=="thinking"?N:"";return O?React.createElement("div",{key:g,
className:"content-block content-block-thinking-native"},d(O,g)):null}return S&&x?React.createElement("div",{key:g,className:"\
content-block content-block-thinking-codex-desktop"},React.createElement("span",null,N||"Worked"),React.createElement("s\
pan",{className:"content-block-thinking-codex-desktop-chevron","aria-hidden":"true"},"\u2304")):S?React.createElement(va,
{key:g,stateKey:`${c}:disclosure:${g}`,className:"content-block content-block-thinking-codex-desktop",summary:N||"Worked"},
d($,g)):f&&x?React.createElement("div",{key:g,className:"content-block content-block-status-chip thinking",title:N},N||"\
Thinking"):React.createElement(va,{key:g,stateKey:`${c}:disclosure:${g}`,className:"content-block content-block-thinking",
summary:N||"Thinking"},$&&!x&&d($,g))}if(A==="tool_call"||A==="tool_result"){let x=!$||oe($).replace(/\s+/g," ").trim()===
N;return f&&x?React.createElement("div",{key:g,className:"content-block content-block-status-chip tool",title:N},N||"Too\
l"):React.createElement(va,{key:g,stateKey:`${c}:disclosure:${g}`,className:`content-block content-block-${A==="tool_res\
ult"?"tool-result":"tool"}`,summary:React.createElement(React.Fragment,null,React.createElement("span",null,N||(A==="too\
l_result"?"Tool result":"Tool")),h.status&&React.createElement("span",{className:`content-block-status ${oe(h.status).toLowerCase()}`},
h.status))},$&&React.createElement("pre",{className:"content-block-pre"},$),React.createElement(ba,{actions:h.actions}))}
if(A==="terminal"){if(_){let x=(N||"Bash").match(/^(\S+)(?:\s+([\s\S]*))?$/),O=x?.[1]||"Bash",Y=x?.[2]||"",te=oe(h.status||
"running").toLowerCase();return React.createElement("div",{key:g,className:"content-block content-block-terminal-claude",
role:"group","aria-label":N||"Bash command"},React.createElement("div",{className:"content-block-terminal-claude-header"},
React.createElement("span",{className:`content-block-terminal-claude-dot ${te}`,"aria-hidden":"true"}),React.createElement(
"strong",null,O),Y&&React.createElement("span",null,Y)),React.createElement("div",{className:"content-block-terminal-cla\
ude-body"},h.command&&React.createElement("div",{className:"content-block-terminal-claude-row"},React.createElement("spa\
n",null,"IN"),React.createElement("pre",null,h.command)),h.stdout&&React.createElement("div",{className:"content-block-t\
erminal-claude-row"},React.createElement("span",null,"OUT"),React.createElement("pre",null,h.stdout)),h.stderr&&React.createElement(
"div",{className:"content-block-terminal-claude-row error"},React.createElement("span",null,"ERR"),React.createElement("\
pre",null,h.stderr))),React.createElement(ba,{actions:h.actions}))}return S?React.createElement(va,{key:g,stateKey:`${c}\
:disclosure:${g}`,className:"content-block content-block-terminal-codex-desktop",summary:React.createElement("span",null,
"Ran commands")},$&&React.createElement("pre",{className:"content-block-pre"},$),React.createElement(ba,{actions:h.actions})):
React.createElement(va,{key:g,stateKey:`${c}:disclosure:${g}`,className:"content-block content-block-terminal",summary:React.
createElement(React.Fragment,null,React.createElement("span",null,N||"Terminal"),h.exit_code!=null&&React.createElement(
"span",{className:"content-block-status"},"exit ",h.exit_code))},$&&React.createElement("pre",{className:"content-block-\
pre"},$),React.createElement(ba,{actions:h.actions}))}if(A==="file_changes"){let x=cv(N);if(!!(f&&x&&!$&&(!Array.isArray(
h.files)||h.files.length===0)&&(!Array.isArray(h.actions)||h.actions.length===0)))return React.createElement("div",{key:g,
className:"content-block content-block-file-change content-block-file-change-cursor-summary"},React.createElement("span",
null,x.label),x.additions&&React.createElement("span",{className:"content-block-add"},x.additions),x.deletions&&React.createElement(
"span",{className:"content-block-del"},x.deletions));let Y=[h.files_changed!=null?`${h.files_changed} files`:null,h.additions!=
null?`+${h.additions}`:null,h.deletions!=null?`-${h.deletions}`:null].filter(Boolean).join(" ");return React.createElement(
va,{key:g,stateKey:`${c}:disclosure:${g}`,className:"content-block content-block-file-change",summary:React.createElement(
React.Fragment,null,React.createElement("span",null,N||"File changes",Y?` ${Y}`:""),h.status&&React.createElement("span",
{className:`content-block-status ${oe(h.status).toLowerCase()}`},h.status))},Array.isArray(h.files)&&h.files.length>0&&React.
createElement("div",{className:"content-block-file-list"},h.files.map((te,ie)=>React.createElement("div",{className:"con\
tent-block-file-row",key:te.path||ie},React.createElement("span",{className:"content-block-file-path"},te.path||"file"),
te.added!=null&&React.createElement("span",{className:"content-block-add"},"+",te.added),te.removed!=null&&React.createElement(
"span",{className:"content-block-del"},"-",te.removed)))),$&&d($,g),React.createElement(ba,{actions:h.actions}))}if(A===
"artifact")return React.createElement("div",{key:g,className:"content-block content-block-artifact"},React.createElement(
"div",{className:"content-block-title"},N||"Artifact"),$&&d($,g));if(A==="plan"){let x=Array.isArray(h.tasks)?h.tasks:[];
return React.createElement("div",{key:g,className:"content-block content-block-plan"},React.createElement("div",{className:"\
content-block-title"},N||"Plan"),x.length>0&&React.createElement("ol",{className:"content-block-plan-list"},x.map((O,Y)=>{
let te=oe(O?.state||O?.status||"pending").toLowerCase();return React.createElement("li",{key:O.id||Y,className:`content-\
block-plan-item ${te}`},React.createElement("span",{className:"content-block-plan-marker","aria-hidden":"true"},te==="co\
mpleted"?"\u2713":te==="in_progress"?"\u2022":"\u25CB"),React.createElement("span",null,O.text||O.step||O.title||""))})),
$&&!x.length&&d($,g))}return A==="queued_message"?React.createElement("div",{key:g,className:"content-block content-bloc\
k-queued-message"},React.createElement("span",{className:"content-block-queued-label"},N||"Queued message"),$&&React.createElement(
"span",{className:"content-block-queued-body"},$)):A==="notice"?React.createElement("div",{key:g,className:`content-bloc\
k content-block-notice ${oe(h.tone||h.status||"info").toLowerCase()}`},React.createElement("div",{className:"content-blo\
ck-title"},N||"Notice"),$&&d($,g),React.createElement(ba,{actions:h.actions})):A==="memory_citation"?React.createElement(
va,{key:g,stateKey:`${c}:memory-citation:${g}`,className:"content-block content-block-memory-citation",defaultOpen:!1,summary:N||
"Sources"},$&&d($,g)):A==="error"&&w?React.createElement(va,{key:g,stateKey:`${c}:disclosure:${g}`,className:"content-bl\
ock content-block-error content-block-error-antigravity-v2",defaultOpen:!1,summary:React.createElement(React.Fragment,null,
React.createElement("span",{className:"content-block-error-antigravity-v2-label"},N||"Error"),$&&React.createElement("sp\
an",{className:"content-block-error-antigravity-v2-message"},$))},React.createElement(ba,{actions:h.actions})):A==="prom\
pt"||A==="error"?React.createElement("div",{key:g,className:`content-block content-block-${A}`},React.createElement("div",
{className:"content-block-title"},N||A),$&&d($,g),React.createElement(ba,{actions:h.actions})):React.createElement("div",
{key:g,className:"content-block content-block-markdown"},d($||N,g))}))}function wu(e){let t=Kt(e).trim();return!(!t||t.length<
4||/^[\s*._|`~•·▌]+$/.test(t)||!/[A-Za-z0-9]/.test(t))}function ti({message:e=null,instant:t=null}){let n=t==null?Wr(
e):ls(t);if(!n)return React.createElement("span",{className:"message-timestamp message-timestamp-unknown","aria-label":"\
Sent time unknown",title:"Sent time unknown"},"Time unknown");let s=cp(n);return React.createElement("time",{className:"\
message-timestamp",dateTime:n.iso,title:s,"aria-label":`Sent ${s}`},El(n))}function uv(e){return typeof e=="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.
test(e)}function sf(e){if(!e)return Au;let t=e.split("-")[0].toLowerCase();return Gn[t]||Au}function rr(e){let t=oe(e).toLowerCase();
return t?t.includes("roo code")||t.includes("roo_code")||t.includes("roo-cline")?"roo_code":t.includes("cline")||t.includes(
"claude-dev")?"cline":t.includes("continue yolo")||t.includes("continue_yolo")?"continue_yolo":t.includes("continue")?"c\
ontinue":t.includes("codex cli")||t.includes("codex_cli")?"codex_cli":t.includes("codex desktop")?"codex-desktop":t.includes(
"cursor cli")||t.includes("cursor_cli")?"cursor_cli":/\bcursor\b/.test(t)||t==="cursor"||t.includes("cursor ide")?"curso\
r":t.includes("codex")?"codex":t.includes("claude code")||t.includes("claude")?"claude":t.includes("antigravity chat")||
t.includes("antigravity_panel")?"antigravity_panel":t.includes("antigravity-v2")||t.includes("antigravity v2")?"antigrav\
ity-v2":null:null}function af(e){if(e&&typeof e=="object"){let t=e.agent_type;return Gn[t]?t:rr(e.display_name)||rr(e.agent_type)||
rr(e.session_title)||rr(e.window_title)||rr(e.chat_title)||rr(e.session_id)}if(typeof e=="string"){let t=e.split("-")[0].
toLowerCase();return Gn[t]?t:rr(e)}return null}function qe(e){return typeof e=="string"?e:e?.session_id}function to(e,t){
if(e&&typeof e=="object"){let s=af(e);return Gn[s]||sf(e.session_id)}let n=af(e);return Gn[n]||sf(e)}function eo(e,t,n){
if(e&&typeof e=="object"){let i=wv(e,n),c=n?.file_access_scope?n.file_access_scope.replace(/\\/g,"/").split("/").filter(
Boolean).pop():null,u=e.agent_type==="antigravity_panel"&&e.panel_title?` / ${e.panel_title}`:"",f=(i?.label||e.workspace_name||
c||e.window_title||e.workspace_path||t||"Session")+u;return e.chat_title&&!f.includes("/")?`${f} / ${e.chat_title}`:f}let s=t||
e;return typeof s!="string"?"Session":uv(s)?"Connected session":s.split("-").slice(1).join("-")||s}function Ef(e){let t=oe(
e).replace(/\\/g,"/").replace(/\/+$/,"").trim();return t?t.split("/").filter(Boolean).pop()||t:""}function Ec(e){return oe(
e).replace(/\\/g,"/").replace(/\/+$/,"").trim()}function Lf(e){let t=Ec(e);return/^[A-Za-z]:\//.test(t)||t.startsWith("/\
/")||t.startsWith("/")}function dv(e){let t=Ec(e).toLowerCase();return/^[a-z]:\/users\/[^/]+$/.test(t)||/^[a-z]:\/users\/[^/]+\/documents$/.
test(t)||/^\/users\/[^/]+$/.test(t)||/^\/users\/[^/]+\/documents$/.test(t)||/^\/home\/[^/]+$/.test(t)}function pv(e){let t=Ec(
e),n=t.match(/^[A-Za-z]:\/Users\/([^/]+)(?:\/|$)/i);if(n)return n[1];let s=t.match(/^\/(?:Users|home)\/([^/]+)(?:\/|$)/i);
return s?s[1]:""}function mv(e,t){let n=pv(t);return!!n&&oe(e).trim().toLowerCase()===n.toLowerCase()}function Pu(e){return oe(
e).replace(/\s+\(Workspace\)$/i,"").replace(/\s+-\s+(?:Visual Studio Code|Code|Cursor|Antigravity)(?:\s*\[[^\]]+\]|\s+(?:Administrator|Admin))?$/i,
"").trim()}function If(e){let t=oe(e).trim();return/^(?:Visual Studio Code|Code|Cursor|Antigravity)(?:\s*\[[^\]]+\]|\s+(?:Administrator|Admin))?$/i.
test(t)}function fv(e){return/\s+-\s+(?:Visual Studio Code|Code|Cursor|Antigravity)(?:\s*\[[^\]]+\]|\s+(?:Administrator|Admin))?\s*$/i.
test(oe(e))}function Of(e){let t=oe(e).trim();if(!t)return[];let n=t.split(/\s+-\s+/).map(s=>Pu(s)).filter(Boolean);for(;n.
length&&If(n[n.length-1]);)n.pop();return n}var gv=/\b(?:image|screenshot|screen\s*shot|capture)[\w .()[\]-]*\.(?:png|jpe?g|gif|webp|bmp|svg)(?:\b|[\s._-]*\d{2,}(?:\s*[x\u00d7]\s*\d{2,})?|[\s._-]*[a-z0-9]{3,})/i,
hv=/(?:[A-Za-z]:[\\/]|\\\\[^\\/\s]+[\\/]|\/(?:Users|home|mnt|var|tmp|etc|opt|workspace|workspaces)\/)[^\s"'`<>)]{2,}/i,qf=new Set(
["agent","agent manager","agent session","antigravity","antigravity chat","antigravity v2","claude","claude code","codex",
"codex cli","codex desktop","connected session","other","session","unknown"]),_v=new Set(Array.from(qf,e=>e.replace(/[^a-z0-9]+/g,
"")));function Pf(e){let t=Pu(e);if(!t)return"";let n=Ef(t),s=/[-_]/.test(n),a=n.replace(/[-_]+/g," ");return(s||!/\s/.test(
n))&&(a=a.replace(/([a-z])([A-Z])/g,"$1 $2")),a.replace(/\s+/g," ").trim()}function bv(e){let t=Pf(e).toLowerCase();if(!t||
/^window\s+\d+$/.test(t)||If(t)||qf.has(t))return!0;let n=t.replace(/[^a-z0-9]+/g,"");return _v.has(n)}function vv(e,t){
return oe(e).toLowerCase()===oe(t).toLowerCase()}function Du(e,t){let n=Pf(e);return bv(n)?null:{label:n,key:oe(t||n).replace(
/\\/g,"/").replace(/\/+$/,"").toLowerCase()}}function rf(e){let t=Ec(e);return!t||!Lf(t)||dv(t)?null:Du(Ef(t),t)}function of(e){
let t=Of(e);return t.length<2?null:Du(t[t.length-1],t[t.length-1])}function yv(e){let t=oe(e);if(fv(t))return null;let n=Pu(
e);return!n||Lf(n)||Of(n).length>=2?null:Du(n,n)}function kv(e){let t=oe(e).toLowerCase().trim();return[t,t.replace(/\s+/g,
"-"),t.replace(/\s+/g,"")].filter(Boolean)}function cf(e,t=[]){let n=e.map(a=>oe(a).toLowerCase()).filter(Boolean),s=[...t].
sort((a,i)=>i.label.length-a.label.length);for(let a of s){let i=kv(a.label);if(n.some(c=>i.some(u=>u&&c.includes(u))))return a}
return null}function wv(e,t,n=[]){if(!e||typeof e!="object")return null;let s=cf([e.window_title,e.workspace_name,e.chat_title,
e.session_title],n),a=[rf(e.workspace_path),rf(t?.file_access_scope),s,of(e.window_title),of(e.workspace_name),mv(e.workspace_name,
e.workspace_path)?null:yv(e.workspace_name)].filter(Boolean);if(a.length>0){let u=a[0];return n.find(f=>vv(f.label,u.label))||
u}let i=[e.chat_title,e.session_title,e.title,e.display_title,e.window_title,e.workspace_name].map(u=>oe(u).toLowerCase()).
filter(Boolean),c=cf(i,n);return c||null}function Sv(e){return Kt(e).replace(/!\[[^\]]*\]\((?:data:image\/[^)]+|\/uploads\/[^)]+|[^)]*\.(?:png|jpe?g|gif|webp|bmp|svg))\)/gi,
" ").replace(/\[File:\s*[^\]]+\]/gi," ").replace(hv," ").replace(gv," ").replace(/<goal_context>[\s\S]*?<\/goal_context>/gi,
" ").replace(/<[^>\n]{1,80}>/g," ").replace(/```[\s\S]*?```/g," ").replace(/`([^`]+)`/g,"$1").replace(/^\s*(?:user|assistant|codex|claude|tool result)\s*[:\-]\s*/i,
"").replace(/\s+/g," ").trim()}function Zo(e,t,n,s=[]){return hp(e,e&&typeof e=="object"?e.custom_display_name:"",s)}function lf(e){
if(!e||typeof e!="object")return null;if(e.workspace_path)return oe(e.workspace_path).toLowerCase();let t=oe(e.workspace_name||
e.window_title||"");return t&&t.split(" / ")[0].trim().toLowerCase()||null}function Nv(e,t){let n=qe(t),s=lf(t);return s&&
(e||[]).find(a=>a&&typeof a=="object"&&a.agent_type==="antigravity_panel"&&qe(a)!==n&&lf(a)===s)||null}function Cv(e){return!e||
typeof e!="object"?"":[e.panel_title||null,e.panel_model||null,e.panel_mode||null].filter(Boolean).join(" \xB7 ")}function xv(e){return e==="claude"?"claude-document":e==="codex_cli"?"codex-terminal":e==="cursor"?"cursor-cards":e==="c\
odex-desktop"||e==="codex"?"codex-thread":"unified-flow"}function uf(e){return e==="codex_cli"?"codex-cli":e==="codex"||
e==="codex-desktop"?"codex":e==="claude"||e==="claude_cli"?"claude":e==="cursor"||e==="cursor_cli"?"cursor":"default"}function Av(e,t){
let n=oe(e).toLowerCase().replace(/\s+/g," ").trim(),s=oe(t).toLowerCase().replace(/\s+/g," ").trim();if(!s)return 0;let a=n.
indexOf(s);if(a>=0)return 2e3-Math.min(a,500)-Math.max(0,n.length-s.length)*.01;let i=0,c=0,u=-1;for(let f of s){if(f===
" ")continue;let _=n.indexOf(f,c);if(_<0)return Number.NEGATIVE_INFINITY;i+=u<0?Math.max(0,80-_):Math.max(1,24-(_-u-1)*3),
(_===0||/[\s/\\_.:-]/.test(n[_-1]))&&(i+=35),u=_,c=_+1}return i}function Rv(e,t){let n=oe(t).toLowerCase().trim().split(
/\s+/).filter(Boolean);return n.length===0?[...e]:e.map((s,a)=>{let i=n.reduce((c,u)=>{let f=Array.isArray(s.searchFields)&&
s.searchFields.length?s.searchFields:[s.searchText],_=Math.max(...f.map(y=>Av(y,u)));return Number.isFinite(c)&&Number.isFinite(
_)?c+_:Number.NEGATIVE_INFINITY},0);return{item:s,sidebarIndex:a,score:i}}).filter(s=>Number.isFinite(s.score)).sort((s,a)=>+!!a.
item.working-+!!s.item.working||a.score-s.score||s.sidebarIndex-a.sidebarIndex).map(s=>s.item)}function Tu(e){return e instanceof
Element?!!e.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]'):!1}function Mv(e,t){if(!e||!t||
e.sessionId!==t.sessionId)return 0;let n=Math.max(0,Number(t.messageCount||0)-Number(e.messageCount||0)),s=!!t.provisionalId&&
(t.provisionalId!==e.provisionalId||Number(t.provisionalLength||0)>Number(e.provisionalLength||0));return n+(s&&n===0?1:
0)}function Tv(e,t,n=!1){let[s,a]=React.useState(()=>Vo(e,t)),i=React.useMemo(()=>Am(s,e,{...t,freezeStructure:n}),[s,e,
t,n]);React.useEffect(()=>{i.ledger!==s&&a(i.ledger)},[s,i]);let c=React.useCallback(()=>{a(u=>Rm(u,e,t))},[e,t]);return{
groups:i.groups,orderChanged:i.orderChanged,sortNow:c,revision:i.ledger.revision}}function df(e){return!e||typeof e!="ob\
ject"?"":e.visible_pane_visible?[e.visible_pane_title||null,e.visible_pane_location==="right"?"Right Pane":null].filter(
Boolean).join(" \xB7 "):Cv(e)}function Df(e){let t=oe(e);return t?t.replace(/^Gemini\s+/i,"G ").replace(/^Claude\s+/i,"").
replace(/\s*\(Thinking\)\s*/i,"").replace(/\s*\(Medium\)\s*/i,"").replace(/\s+/g," ").trim():""}function jf(e,t=3){return!Array.
isArray(e)||e.length===0?"":e.slice(0,t).map(n=>{let s=n?.percent_used;if(s==null)return null;let a=Df(n?.model);return a?
`${a} ${s}%`:null}).filter(Boolean).join(" \xB7 ")}function Su(e){return e?Gn[e]?.name||e:""}function ni(e){let t=oe(e).
trim();if(!t)return"";if(!/^\d{4}-\d{2}-\d{2}T/.test(t))return t;let n=new Date(t);return Number.isNaN(n.getTime())?t:n.
toLocaleString([],{weekday:"short",hour:"numeric",minute:"2-digit"})}function $v({session:e,config:t,providerUsage:n,onOpenUsage:s}){
let[a,i]=React.useState(!1),[c,u]=React.useState(Date.now()),f=React.useRef(null),_=React.useRef(null),y=React.useMemo(()=>nu(
n),[n]),S=React.useMemo(()=>Fm(e,t,y,c),[e,t,y,c]),T=S.headerWindows.map(bu);if(React.useEffect(()=>{if(!a)return;u(Date.
now());let g=setInterval(()=>u(Date.now()),3e4);return()=>clearInterval(g)},[a]),React.useEffect(()=>{if(!a)return;let g=($=!1)=>{
i(!1),$&&requestAnimationFrame(()=>f.current?.focus({preventScroll:!0}))},A=$=>{f.current?.contains($.target)||_.current?.
contains($.target)||g(!1)},N=$=>{$.key==="Escape"&&($.preventDefault(),g(!0))};return document.addEventListener("pointer\
down",A),document.addEventListener("keydown",N),requestAnimationFrame(()=>_.current?.querySelector("button")?.focus({preventScroll:!0})),
()=>{document.removeEventListener("pointerdown",A),document.removeEventListener("keydown",N)}},[a]),!S.supported)return null;
let w=S.state==="local"?"Local":S.state==="exhausted"?"Limit":T[0]?.compactValue||"Usage ?",M=au(S.credits),d=ru(S.financials),
h=()=>{i(!1),s()};return React.createElement("div",{className:`session-usage-mini tone-${S.tone} state-${S.state}`,"data\
-testid":"session-usage-mini"},React.createElement("button",{ref:f,type:"button",className:"session-usage-mini-trigger",
"aria-expanded":a,"aria-controls":"session-usage-popover",title:`${S.billingProviderName}: ${w}`,onClick:()=>i(g=>!g)},React.
createElement(bc,{providerId:S.providerMarkId,providerName:S.billingProviderName}),React.createElement("span",{className:"\
session-usage-mini-rows"},S.state==="local"?React.createElement("span",{className:"session-usage-mini-row"},React.createElement(
"strong",null,"Local"),React.createElement("em",null,"no plan limit")):T.length>0?T.map((g,A)=>React.createElement("span",
{className:`session-usage-mini-row ${g.tone}`,key:`${g.label}:${A}`},React.createElement("strong",null,g.label),React.createElement(
"em",null,g.compactValue),React.createElement("i",{"aria-hidden":"true"},React.createElement("b",{style:{width:`${Math.max(
0,Math.min(100,Number(g.usedPercent)||0))}%`}})))):React.createElement("span",{className:"session-usage-mini-row unavail\
able"},React.createElement("strong",null,"Usage"),React.createElement("em",null,S.state==="ambiguous"?"ambiguous":"unava\
ilable"))),React.createElement("span",{className:"session-usage-mini-compact"},w)),a&&React.createElement("div",{ref:_,id:"\
session-usage-popover",className:"session-usage-popover",role:"dialog","aria-modal":"false","aria-label":"Session usage \
details"},React.createElement("div",{className:"session-usage-popover-heading"},React.createElement(bc,{providerId:S.providerMarkId,
providerName:S.billingProviderName}),React.createElement("span",null,React.createElement("strong",null,S.billingProviderName),
React.createElement("small",null,S.plan||S.message||"Usage details")),React.createElement("button",{type:"button",onClick:()=>{
i(!1),f.current?.focus({preventScroll:!0})},"aria-label":"Close usage details"},"\xD7")),React.createElement("dl",{className:"\
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
map((g,A)=>{let N=bu(g);return React.createElement("div",{className:`session-usage-popover-window ${N.tone}`,key:`${g.id}\
:${A}`},React.createElement("span",null,React.createElement("strong",null,N.label),React.createElement("em",null,N.usedPercent==
null?"Usage unavailable":`${dn(N.usedPercent)} used \xB7 ${N.compactValue}`)),React.createElement("i",{"aria-hidden":"tr\
ue"},React.createElement("b",{style:{width:`${Math.max(0,Math.min(100,Number(N.usedPercent)||0))}%`}})),React.createElement(
"small",null,N.reset?`Resets ${nr(N.reset,c)}`:"Reset not reported",g.modelScope?.label?` \xB7 ${g.modelScope.label}`:""))})):
React.createElement("div",{className:`session-usage-popover-state ${S.state}`},React.createElement("strong",null,S.message),
React.createElement("span",null,"No percentage or $0 value is inferred.")),(M||d.length>0)&&React.createElement("div",{className:"\
session-usage-popover-financial"},React.createElement("strong",null,"Credits / overage"),M&&React.createElement("span",null,
M),d.map(g=>React.createElement("span",{key:g.id},g.label,": ",g.value))),React.createElement("div",{className:"session-\
usage-popover-source"},React.createElement("span",null,S.source||"Source unavailable"," \xB7 ",tr(S.capturedAt,c)),React.
createElement("span",null,"Generation ",S.generation," \xB7 ",S.freshness)),React.createElement("button",{type:"button",
className:"session-usage-open-dashboard",onClick:h},"Open Usage & limits")))}function Bf(e){return!e||typeof e!="object"?
"":oe(e.host_label||(e.host_type==="vscode"?"VS Code":e.host_type==="antigravity_ide"?"Antigravity IDE":""))}var Ev={healthy:"\
#3fb950",degraded:"#d29922",disconnected:"#f85149"},pf={thinking:{icon:"\u25CC",tone:"thinking"},generating:{icon:"\u2726",
tone:"thinking"},reading_files:{icon:"\u229E",tone:"info"},running_command:{icon:">",tone:"info"},applying_patch:{icon:"\
\u0394",tone:"info"},waiting_for_user:{icon:"?",tone:"idle"},idle:{icon:"\xB7",tone:"idle"},working:{icon:"\u2022",tone:"\
info"}};function ei({agentType:e,compact:t=!1,animate:n=!0}){let s=String(e||"default").toLowerCase(),a=n?"":" static";return s===
"claude"||s==="claude_cli"?React.createElement("span",{className:`native-activity-spinner claude${t?" compact":""}${a}`},
n?React.createElement(Vv,null):React.createElement("span",{className:"claude-spinner-icon"},Mc[0])):s==="codex"||s==="co\
dex-desktop"||s==="codex_cli"?React.createElement("span",{className:`native-activity-spinner codex${t?" compact":""}${a}`,
"aria-label":"Working"},"\u25CC"):s==="cursor"?React.createElement("span",{className:`native-activity-spinner cursor${t?
" compact":""}${a}`,"aria-label":"Generating"},React.createElement("i",null),React.createElement("i",null),React.createElement(
"i",null)):React.createElement("span",{className:`native-activity-spinner generic${t?" compact":""}${a}`},React.createElement(
"i",null))}function mf(e){let t=String(e||"Send failed").trim(),n=t.toLowerCase();return n.includes("pending_revalidatio\
n")||n.includes("fixture version mismatch")||n.includes("validation pending")?"Update validation pending":n.includes("ag\
ent_busy")||n.includes("agent is generating")?"Agent busy":n.includes("codex_desktop_thread_not_open")||n.includes("code\
x_desktop_thread_changed")||n.includes("open this thread")?"Open this thread in Codex Desktop":n.includes("native_user_t\
urn_not_observed")||n.includes("native user turn")||n.includes("could not confirm native delivery")?"Could not confirm n\
ative delivery":n.includes("input_verify_failed")||n.includes("composer input could not be verified")||n.includes("verif\
ied send-ready state")?"Composer input could not be verified":n==="send_failed"?"Send failed":t.length>80?`${t.slice(0,77)}\
\u2026`:t}function Lv({msg:e,deliveryStates:t,onSteer:n,onRetry:s}){if(e._optimistic){let a=t[e._cid]||"queued";if(a==="\
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
g","aria-label":"Agent started working"},"\u25B6");if(a==="failed"){let i=e._sendError||"Agent may be offline",c=mf(i);return React.
createElement("span",{className:"delivery failed",title:i,"aria-label":`Send failed: ${c}`},React.createElement("span",{
"aria-hidden":"true"},"\u2715"),React.createElement("span",{className:"delivery-failure-reason"},c),s&&React.createElement(
"button",{type:"button",className:"delivery-retry",onClick:u=>{u.stopPropagation(),s(e)}},"Retry"))}}if(e._agentStarted||
e.status==="agent_started")return React.createElement("span",{className:"delivery agent-started",title:"Agent started wo\
rking","aria-label":"Agent started working"},"\u25B6");if(e._delivered||e.status==="delivered")return React.createElement(
"span",{className:"delivery delivered",title:"Native user turn observed","aria-label":"Native user turn delivered"},"\u2713\u2713");
if(e.status==="failed"){let a=e.failure_code||e._sendError||"Send failed",i=mf(a);return React.createElement("span",{className:"\
delivery failed",title:a,"aria-label":`Send failed: ${i}`},React.createElement("span",{"aria-hidden":"true"},"\u2715"),React.
createElement("span",{className:"delivery-failure-reason"},i))}return e._launchAcceptedAt||e.launch_accepted_at?React.createElement(
"span",{className:"delivery launch-accepted",title:"Native launch accepted; user-turn receipt pending","aria-label":"Nat\
ive launch accepted; user-turn receipt pending"},"\u2197"):e.status==="accepted"?React.createElement("span",{className:"\
delivery accepted",title:"Received by relay; native receipt pending","aria-label":"Relay accepted; native receipt pendin\
g"},"\u2713"):React.createElement("span",{className:"delivery recorded",title:"Recorded \u2014 native delivery receipt unknow\
n","aria-label":"Recorded; native delivery receipt unknown"},"Recorded")}function Iv(e,t=!1,n={}){let[s,a]=React.useState(
()=>pu(e)),i=React.useMemo(()=>Sm(s,e,{...n,freezeStructure:t}),[s,e,t,n]);return React.useEffect(()=>{i.ledger!==s&&a(i.
ledger)},[s,i]),{sessions:i.sessions,revision:i.ledger.revision,deferred:i.deferred}}function Ov(e,t=!1){let[n,s]=React.
useState(()=>sc(e)),a=React.useMemo(()=>zp(n,e,{freezeStructure:t}),[n,e,t]);return React.useEffect(()=>{a.ledger!==n&&s(
a.ledger)},[n,a]),a.sessions}function qv(e,t){let[n,s]=React.useState(Date.now());return React.useEffect(()=>{let a=Date.
now(),c=[...Object.values(e||{}),...Array.isArray(t)?t.map(f=>f?.activity):[]].reduce((f,_)=>{let y=Zi(_),S=y?y+Hl:0;return S<=
a?f:f===0?S:Math.min(f,S)},0);if(!c)return;let u=setTimeout(()=>s(Date.now()),Math.max(25,c-a+25));return()=>clearTimeout(
u)},[e,t,n]),n}function Pv({stream:e,activeAgent:t,monospace:n}){let s=ke(null),a=ke("");return ka(()=>{let i=s.current;
if(!i)return;let c=String(e?.content||""),u=a.current;if(c.startsWith(u)){let f=c.slice(u.length);f&&i.appendChild(document.
createTextNode(f))}else i.textContent=c;a.current=c},[e?.content]),React.createElement("div",{className:`message assista\
nt live-draft provisional-stream${n?" monospace":""}`,"data-message-id":e?.messageId||"awaiting-first-delta","data-messa\
ge-role":"assistant","data-message-timestamp":ls(e?.startedAtMs)?.iso||void 0,"data-stream-open":e?.open?"true":"false"},
React.createElement("div",{className:"assistant-gutter"},React.createElement("div",{className:"agent-badge transcript-ag\
ent-badge",style:{color:t.color,borderColor:t.color+"55",background:t.color+"18"}},t.logo?React.createElement("img",{src:t.
logo,alt:t.abbr,className:"agent-badge-logo"}):t.abbr)),React.createElement("div",{className:"assistant-content"},React.
createElement("div",{className:"message-role"},React.createElement("span",{className:"message-role-label"},t.name),React.
createElement(ti,{instant:e?.startedAtMs})),React.createElement("div",{className:"provisional-stream-text",ref:s}),e?.open&&
React.createElement("span",{className:"provisional-stream-caret","aria-label":"Streaming response"})))}function Dv({msg:e,
messageKey:t,activeAgent:n,assistantMonospace:s,autoExpandLongCodeBlocks:a,onOpenPath:i,agentType:c,preview:u,fileContents:f,
onClosePreview:_,deliveryState:y,onSteer:S,onRetry:T,richContentEager:w,searchMatch:M=!1}){let d=Kt(e.content)||si(e.content_blocks),
h=sv(e.content),g=Wr(e),A=e.role!=="user"&&no(e.content_blocks).length>0,N=e.source_message_id||e.native_source_id||"",$=Zb(
e),x=ev(e);if(e.role==="user"){let O=e._cid?{[e._cid]:y}:{};return React.createElement("div",{className:`message user tr\
anscript-virtual-row${e._optimistic&&y==="failed"?" failed":""}${M?" search-match":""}`,"data-message-key":t,"data-messa\
ge-id":e.id||void 0,"data-message-role":"user","data-message-block-type":x,"data-message-content-hash":$,"data-message-s\
ource-id":N||void 0,"data-message-timestamp":g?.iso||"unknown"},React.createElement("div",{className:"user-gutter"},React.
createElement("div",{className:"user-glyph"})),React.createElement("div",{className:"user-content"},React.createElement(
"div",{className:"message-role"},React.createElement("span",{className:"message-role-label"},"You"),React.createElement(
ti,{message:e}),React.createElement(Lv,{msg:e,deliveryStates:O,onSteer:S,onRetry:T})),/!\[[^\]]*\]\((?:data:|\/uploads\/)/.
test(h)?React.createElement("div",{className:"user-text"},React.createElement(Gr,{content:h,deferUntilVisible:!w,cacheIdentity:`${t}\
:user`})):React.createElement("div",{className:"user-text"},d)))}return React.createElement("div",{className:`message as\
sistant transcript-virtual-row${s?" monospace":""}${M?" search-match":""}`,"data-message-key":t,"data-message-id":e.id||
void 0,"data-message-role":"assistant","data-message-block-type":x,"data-message-content-hash":$,"data-message-source-id":N||
void 0,"data-message-timestamp":g?.iso||"unknown"},React.createElement("div",{className:"assistant-gutter"},React.createElement(
"div",{className:"agent-badge transcript-agent-badge",style:{color:n.color,borderColor:n.color+"55",background:n.color+"\
18"}},n.logo?React.createElement("img",{src:n.logo,alt:n.abbr,className:"agent-badge-logo"}):n.abbr)),React.createElement(
"div",{className:"assistant-content"},React.createElement("div",{className:"message-role"},React.createElement("span",{className:"\
message-role-label"},n.name),React.createElement(ti,{message:e})),A?React.createElement(lv,{blocks:e.content_blocks,monospace:s,
autoExpandLongCodeBlocks:a,onOpenPath:O=>i(t,O),agentType:c,richContentEager:w,richContentCacheIdentity:t}):React.createElement(
Gr,{content:Kt(e.content),monospace:s,autoExpandLongCodeBlocks:a,onOpenPath:O=>i(t,O),deferUntilVisible:!w,cacheIdentity:`${t}\
:assistant`}),u&&React.createElement(Cy,{sessionId:u.sessionId,filePath:u.path,fileContents:f,onClose:_})))}function ff(e){
return e?`${e.sessionId}${e.messageKey}${e.path}`:""}function $u(e){return[e?.name,e?.color,e?.abbr,e?.logo||""].join(
"")}function jv(e,t){return e.msg===t.msg&&e.messageKey===t.messageKey&&e.assistantMonospace===t.assistantMonospace&&e.
autoExpandLongCodeBlocks===t.autoExpandLongCodeBlocks&&e.agentType===t.agentType&&$u(e.activeAgent)===$u(t.activeAgent)&&
ff(e.preview)===ff(t.preview)&&e.fileContents===t.fileContents&&e.deliveryState===t.deliveryState&&e.onRetry===t.onRetry&&
e.richContentEager===t.richContentEager&&e.searchMatch===t.searchMatch}var Bv=React.memo(Dv,jv),Fv=100,Sc=1200,Ds=32;function gf(e){
let t=Kt(e?.content)||si(e?.content_blocks),n=Math.max(1,oe(t).split(`
`).length);if(e?.role==="user")return Math.min(180,40+Math.max(0,n-1)*18);let s=Math.ceil(oe(t).length/100),a=no(e?.content_blocks).
length*28;return Math.min(420,68+Math.max(n,s)*18+a)}function Nc(e,t){let n=0,s=Math.max(0,e.length-1);for(;n<s;){let a=Math.
floor((n+s)/2);e[a]<=t?n=a+1:s=a}return Math.max(0,n-1)}function Hv({index:e,messageKey:t,onMeasure:n,children:s}){let a=React.
useRef(null);return React.useLayoutEffect(()=>{let i=a.current;if(!i)return;let c=()=>n(e,t,i.getBoundingClientRect().height,
i);if(c(),typeof ResizeObserver>"u")return;let u=new ResizeObserver(c);return u.observe(i),()=>u.disconnect()},[e,t,n]),
React.createElement("div",{className:"transcript-window-row","data-window-index":e,ref:a},s)}function Uv({messages:e,containerRef:t,
sessionId:n,routeActive:s,suppressProgrammaticScrollRef:a,scrollCoordinatorRef:i}){let c=s&&e.length>Fv,u=React.useRef(c);
u.current=c;let f=React.useRef(new Map),_=React.useRef(n);_.current!==n&&(f.current.clear(),_.current=n);let y=React.useRef(
[0]),S=React.useRef(null),T=React.useRef(null),w=React.useRef(0),M=React.useRef(0),d=React.useRef({sessionId:null,keys:[],
prefix:[0]}),h=React.useRef(0),g=React.useRef(0),A=React.useRef(null),N=React.useRef(null),$=React.useRef(0),x=React.useRef(
0),[O,Y]=React.useState(0),[te,ie]=React.useState({sessionId:null,start:0,end:0}),ge=React.useCallback(()=>a?.current?.()!==
!0,[a]),z=React.useCallback((D,J,E,W={})=>D?typeof i?.current=="function"?i.current(D,J,E,W)===!0:ge()?(Mu(D,J,{container:"\
transcript",writer:"virtual-transcript-fallback",reason:E,sessionId:n}),!0):!1:!1,[ge,i]),ae=React.useMemo(()=>e.map((D,J)=>`${n||
""}${Tc(D,J)}`),[e,n]),_e=React.useMemo(()=>{let D=new Array(e.length+1);D[0]=0;for(let J=0;J<e.length;J+=1){let E=f.current.
get(ae[J]);D[J+1]=D[J]+(E||gf(e[J]))}return D},[e,ae,O]);y.current=_e;let V=React.useCallback(()=>{if(T.current)return;let D=t.
current;if(!c||!D)return;let J=D.getBoundingClientRect(),E=J.top,W=Array.from(D.querySelectorAll(".transcript-window-row\
[data-window-index]")),ce=W.find(fe=>{let we=fe.getBoundingClientRect();return we.top>=E&&we.top<J.bottom})||W.find(fe=>fe.
getBoundingClientRect().bottom>E)||W[0];if(!ce)return;let me=Number(ce.dataset.windowIndex);!Number.isInteger(me)||!ae[me]||
(S.current={sessionId:n,key:ae[me],viewportOffset:ce.getBoundingClientRect().top-E})},[t,c,ae,n]),he=React.useCallback(()=>{
A.current=null,N.current=null,$.current&&clearTimeout($.current),$.current=0},[]),be=React.useCallback(()=>{let D=t.current;
if(!c||!D)return;let J=T.current;if(J?.sessionId===n){let Me=ae.indexOf(J.key);if(Me>=0){ie(B=>B.sessionId===n&&B.start===
Me&&B.end===Math.min(e.length,Me+Ds)?B:{sessionId:n,start:Me,end:Math.min(e.length,Me+Ds)});return}}V();let E=y.current,
W=Math.max(0,D.scrollTop-Sc),ce=D.scrollTop+D.clientHeight+Sc,me=Math.max(0,Nc(E,W)-1),fe=Math.min(e.length,Nc(E,ce)+2),
we=fe>=e.length?Math.max(0,e.length-Ds):me,Le=fe,Ee=N.current,Ze=Ee?ae.indexOf(Ee):A.current;Ze>=0&&(A.current=Ze);let re=Ze;
Number.isInteger(re)&&re>=0&&re<e.length&&(we=Math.min(we,Math.max(0,re-Ds)),Le=Math.max(Le,Math.min(e.length,re+Ds+1))),
React.startTransition(()=>{ie(Me=>Me.sessionId===n&&Me.start===we&&Me.end===Le?Me:{sessionId:n,start:we,end:Le})})},[V,t,
c,ae,e.length,n]);React.useLayoutEffect(()=>{let D=d.current;if(d.current={sessionId:n,keys:ae,prefix:_e},!c||D.sessionId!==
n||!D.keys.length){T.current?.routeRestore||(T.current=null),w.current&&clearTimeout(w.current),w.current=0,V();return}let J=S.
current;if(!J||J.sessionId!==n||!J.key)return;let E=D.keys.indexOf(J.key),W=ae.indexOf(J.key);if(E<0||W<0||E===W)return;
let ce=t.current;if(!ce)return;let me=D.prefix[E]||0,fe=_e[W]||0;T.current={sessionId:n,key:J.key,viewportOffset:J.viewportOffset},
A.current=W,N.current=J.key,w.current&&clearTimeout(w.current),w.current=setTimeout(()=>{T.current=null,w.current=0,he(),
V()},1500),ie({sessionId:n,start:W,end:Math.min(e.length,W+Ds)}),z(ce,Math.max(0,ce.scrollTop+fe-me),"virtual-window-key\
-reorder",{anchorId:J.key,anchorOffset:J.viewportOffset})||(T.current=null,he())},[V,t,c,ae,e.length,_e,he,n,z]),React.useLayoutEffect(
()=>{let D=T.current;if(!D||D.sessionId!==n)return;let J=ae.indexOf(D.key);if(J<te.start||J>=te.end)return;let E=t.current,
W=E?.querySelector(`.transcript-window-row[data-window-index="${J}"]`);if(!E||!W)return;if(D.atBottom){if(!z(E,E.scrollHeight,
"virtual-anchor-bottom",{anchorId:D.key,anchorOffset:D.viewportOffset})){T.current=null,he(),V();return}S.current=D;return}
let me=W.getBoundingClientRect().top-E.getBoundingClientRect().top-D.viewportOffset;if(Math.abs(me)>=.5&&!z(E,Math.max(0,
E.scrollTop+me),"virtual-anchor-correction",{anchorId:D.key,anchorOffset:D.viewportOffset})){T.current=null,he(),V();return}
S.current=D},[V,t,c,ae,_e,te,he,n,z]),React.useLayoutEffect(()=>{let D=T.current;if(!c||!D?.routeRestore)return;let J=!0,
E=()=>{if(!J)return;let W=T.current,ce=t.current;if(!W?.routeRestore||W.sessionId!==n||!ce)return;let me=ae.indexOf(W.key),
fe=me>=0?ce.querySelector(`.transcript-window-row[data-window-index="${me}"]`):null;if(fe)if(W.atBottom)z(ce,ce.scrollHeight,
"route-anchor-bottom",{allowWhenUserOwned:!0,retainUserOwnership:!0});else{let Le=fe.getBoundingClientRect().top-ce.getBoundingClientRect().
top-W.viewportOffset;Math.abs(Le)>=.5&&z(ce,Math.max(0,ce.scrollTop+Le),"route-anchor-correction",{allowWhenUserOwned:!0,
retainUserOwnership:!0})}M.current=requestAnimationFrame(E)};return E(),w.current&&clearTimeout(w.current),w.current=setTimeout(
()=>{T.current=null,w.current=0,M.current&&cancelAnimationFrame(M.current),M.current=0,he(),V()},1500),()=>{J=!1,M.current&&
cancelAnimationFrame(M.current),M.current=0}},[V,t,c,ae,he,n,z]),React.useLayoutEffect(()=>{if(!c){he();return}let D=t.current;
if(!D)return;be();let J=()=>{V();let E=N.current,W=E?ae.indexOf(E):A.current;W>=0&&(A.current=W);let ce=W,me=y.current;if(Number.
isInteger(ce)&&ce>=0&&ce<e.length){let fe=me[ce]||0,we=me[ce+1]||fe,Le=D.scrollTop,Ee=Le+D.clientHeight;(we<Le-Sc||fe>Ee+
Sc)&&he()}g.current||(g.current=requestAnimationFrame(()=>{g.current=0,be()}))};return D.addEventListener("scroll",J,{passive:!0}),
()=>{D.removeEventListener("scroll",J),g.current&&cancelAnimationFrame(g.current),g.current=0}},[V,c,s,n,ae,e.length,be,
he]),React.useLayoutEffect(()=>{c&&be()},[c,_e,be]),React.useLayoutEffect(()=>{if(!c||O===0)return;let D=t.current;D&&z(
D,D.scrollHeight,"virtual-row-resize-settled")},[t,c,O,z]);let ee=React.useCallback((D,J,E,W=null)=>{if(!u.current)return;
let ce=Math.max(1,Math.ceil(E)),me=f.current.get(J)||gf(e[D]),fe=typeof window<"u"?window.__RAC_TEMPORAL_CANARY__:null;if(fe?.
active){let Ee=fe.transcriptMeasurements||(fe.transcriptMeasurements=[]);if(Ee.length<4e3&&Math.abs(ce-me)>=1){let Ze=t.
current,re=W?.querySelector?.(".message[data-message-key]")||null,Me=re?.getBoundingClientRect?.()||null,B=W?.getBoundingClientRect?.()||
null;Ee.push({at_epoch_ms:Date.now(),index:D,key:J,rendered_window_index:Number(W?.dataset?.windowIndex??D),rendered_message_key:re?.
dataset?.messageKey||null,rendered_message_role:re?.dataset?.messageRole||null,rendered_message_height_px:Me?Number(Me.height.
toFixed(3)):null,rendered_message_top_px:Me?Number(Me.top.toFixed(3)):null,wrapper_top_px:B?Number(B.top.toFixed(3)):null,
raw_height_px:Number(E.toFixed(3)),next_height_px:ce,previous_height_px:me,delta_px:ce-me,anchor_index:Ze?Nc(y.current,Ze.
scrollTop):null,scroll_top:Ze?.scrollTop??null})}}if(Math.abs(ce-me)<1)return;f.current.set(J,ce);let we=t.current,Le=we?
Nc(y.current,we.scrollTop):0;D<Le&&(x.current+=ce-me),!h.current&&(h.current=requestAnimationFrame(()=>{if(h.current=0,!u.
current){x.current=0;return}let Ee=t.current,Ze=x.current;x.current=0,Ee&&Math.abs(Ze)>=1&&z(Ee,Math.max(0,Ee.scrollTop+
Ze),"virtual-row-resize-correction",{anchorId:N.current||S.current?.key||null}),Y(re=>re+1)}))},[t,e,z]);React.useLayoutEffect(
()=>{c||!h.current||(cancelAnimationFrame(h.current),h.current=0,x.current=0)},[c]),React.useEffect(()=>()=>{h.current&&
cancelAnimationFrame(h.current),g.current&&cancelAnimationFrame(g.current),$.current&&clearTimeout($.current),w.current&&
clearTimeout(w.current),M.current&&cancelAnimationFrame(M.current)},[]);let Se=React.useCallback((D,J="center")=>{let E=t.
current,W=y.current;if(!E||D<0||D>=e.length)return!1;A.current=D,N.current=ae[D]||null,$.current&&clearTimeout($.current),
$.current=setTimeout(()=>{he()},1500);let ce=W[D]||0,me=W[D+1]||ce,fe=J==="start"?ce:J==="end"?me-E.clientHeight:ce-Math.
max(0,(E.clientHeight-(me-ce))/2);z(E,Math.max(0,fe),"operator-scroll-to-message",{allowWhenUserOwned:!0,takeUserOwnership:!0});
let we=Math.max(0,D-Ds),Le=Math.min(e.length,D+Ds+1);return ie({sessionId:n,start:we,end:Le}),!0},[t,ae,e.length,he,n,z]),
Z=React.useCallback(()=>{V();let D=S.current;if(!D||D.sessionId!==n)return!1;let J=ae.indexOf(D.key);return J<0?!1:(A.current=
J,N.current=D.key,!0)},[V,ae,n]),ue=React.useCallback(()=>{let D=t.current;if(!c||!D)return!1;V();let J=S.current;if(!J||
J.sessionId!==n||!J.key)return!1;let E=ae.indexOf(J.key);return E<0?!1:(T.current={...J,routeRestore:!0,atBottom:D.scrollHeight-
D.scrollTop-D.clientHeight<80},A.current=E,N.current=J.key,!0)},[V,t,c,ae,n]),de=React.useCallback(()=>T.current?.routeRestore?
(T.current=null,w.current&&clearTimeout(w.current),w.current=0,M.current&&cancelAnimationFrame(M.current),M.current=0,he(),
V(),!0):!1,[V,he]),Ae=0,X=e.length;return c&&(te.sessionId===n&&te.end>te.start?(Ae=te.start,X=te.end):Ae=Math.max(0,e.length-
Ds)),{enabled:c,start:Ae,end:X,totalHeight:_e[_e.length-1]||0,topSpacerHeight:c&&_e[Ae]||0,bottomSpacerHeight:c?_e[_e.length-
1]-(_e[X]||0):0,onMeasure:ee,scrollToIndex:Se,prepareForPrepend:Z,prepareForRouteChange:ue,cancelRouteRestore:de}}function Gv({
qm:e,onSteer:t,onDiscard:n,onEdit:s}){let[a,i]=React.useState(!1),[c,u]=React.useState(!1),[f,_]=React.useState(e.content),
y=React.useRef(null);return React.useEffect(()=>{if(!a)return;let S=T=>{y.current&&!y.current.contains(T.target)&&i(!1)};
return document.addEventListener("mousedown",S),()=>document.removeEventListener("mousedown",S)},[a]),c?React.createElement(
"div",{className:"queued-item editing"},React.createElement("textarea",{className:"queued-edit-input",value:f,onChange:S=>_(
S.target.value),onKeyDown:S=>{S.key==="Enter"&&!S.shiftKey&&(S.preventDefault(),s(f),u(!1)),S.key==="Escape"&&u(!1)},rows:2,
autoFocus:!0}),React.createElement("button",{className:"steer-btn",onClick:()=>{s(f),u(!1)}},"Save"),React.createElement(
"button",{className:"queued-trash-btn",onClick:()=>u(!1),title:"Cancel"},"\u2715")):e.native?React.createElement("div",{
className:"queued-item native"},React.createElement("span",{className:"queued-item-text"},e.content),e.status&&e.status!==
"queued"&&React.createElement("span",{className:`queued-item-status ${e.status}`},e.status),React.createElement("div",{className:"\
queued-actions"},React.createElement("button",{className:"steer-btn",onClick:t,title:"Click Steer in Codex"},"Steer \u25B8"),
React.createElement("button",{className:"queued-trash-btn",onClick:n,title:"Delete queued message"},"\u{1F5D1}"))):React.
createElement("div",{className:"queued-item"},React.createElement("span",{className:"queued-item-text"},e.content),React.
createElement("div",{className:"queued-actions"},React.createElement("button",{className:"steer-btn",onClick:t,title:"Se\
nd to agent now"},"Steer \u25B8"),React.createElement("button",{className:"queued-trash-btn",onClick:n,title:"Discard me\
ssage"},"\u{1F5D1}"),React.createElement("div",{className:"queued-menu-wrap",ref:y},React.createElement("button",{className:"\
queued-more-btn",onClick:()=>i(!a),title:"More options"},"\xB7\xB7\xB7"),a&&React.createElement("div",{className:"queued\
-dropdown"},React.createElement("button",{onClick:()=>{i(!1),_(e.content),u(!0)}},"\u270F Edit message"),React.createElement(
"button",{onClick:()=>{i(!1),n()}},"\u{1F5D1} Discard")))))}function Wv({session:e,health:t,unread:n,isThinking:s,isActive:a,
agentConfig:i,activity:c,sessionMessages:u,hasBlockingPrompt:f,blockingPromptLabel:_,muted:y,pinned:S,workspaceLabel:T,recentMessageAt:w,
menuOpen:M,onMenuToggle:d,onSelect:h,onClose:g,onManage:A,onPinChange:N,onAutomations:$,showAutomationsActive:x,onSkills:O,
showSkillsActive:Y}){let te=qe(e),ie=to(e,i),ge=eo(e,te,i),z=Zo(e,te,i,u),ae=[z,ge||ie.name].filter(Boolean).join(" - "),
_e=Ev[t]||"#444c56",V=e?.rate_limited_until||null,he=e?.rate_limit_active===!0,be=e?.percent_used,ee=e?.agent_type==="an\
tigravity"||e?.agent_type==="antigravity_panel",Se=ee?jf(e?.antigravity_quota_models,3):"",Z=tc(c,{health:t}),ue=s?Z||c?.
label||"Working":null,de=Bf(e),Ae=T?`${ie.name} / ${T}`:ie.name,X=w?ls(w):null;return React.createElement("div",{className:`\
session-card${a?" active":""}${he?" rate-limited":""}${S?" pinned":""}`,"data-session-id":te,"data-last-message-at":X?.iso||
void 0,onClick:h,onKeyDown:D=>{D.target!==D.currentTarget||!["Enter"," "].includes(D.key)||(D.preventDefault(),h())},tabIndex:0,
"aria-label":`${z}. ${ge||ie.name}`,title:ae||te},React.createElement("div",{className:"session-card-badge-wrap"},React.
createElement("div",{className:"agent-badge",style:{color:ie.color,borderColor:ie.color+"55",background:ie.color+"18"}},
ie.logo?React.createElement("img",{src:ie.logo,alt:ie.abbr,className:"agent-badge-logo"}):ie.abbr),React.createElement("\
div",{className:"session-card-health",style:{background:_e},title:t||"unknown"}),y&&React.createElement("span",{className:"\
session-card-muted",title:"Notifications muted","aria-label":"Notifications muted"},"M"),S&&React.createElement("button",
{type:"button",className:"session-card-pin-toggle",title:`Unpin ${z}`,"aria-label":`Unpin ${z}`,"aria-pressed":"true",onClick:D=>{
D.preventDefault(),D.stopPropagation(),N?.(!1)}},React.createElement("span",{"aria-hidden":"true"},"\u{1F4CC}")),React.createElement(
"span",{className:"session-card-attention-slot"},f&&React.createElement("span",{className:"session-card-perm-badge",title:_||
"Action required"},"\u26A0"),!f&&he&&React.createElement("span",{className:"session-card-perm-badge",title:"Usage limite\
d"},"\u23F3"),!f&&!he&&s&&React.createElement("span",{className:"session-card-native-status",title:ue||"Thinking\u2026"},
React.createElement(ei,{agentType:e?.agent_type,compact:!0,animate:!1})),!s&&!f&&!he&&n>0&&React.createElement("span",{className:"\
session-card-badge"},n>99?"99+":n))),React.createElement("div",{className:"session-card-body"},React.createElement(_c,{title:z,
disclosureKey:te,kind:"session",wrapperClassName:"session-title-details",triggerClassName:"session-card-name",disclosureClassName:"\
session-title-disclosure",triggerLabel:`Show full title: ${z}`,triggerTag:"div"}),React.createElement("div",{className:`\
session-card-sub${f?" perm-active":""}${X?" has-recent-message":""}`},React.createElement("span",{className:"session-car\
d-sub-context"},f?`${Ae} \xB7 ${_||"Action required"}`:he?`${Ae} \xB7 \u23F3 Usage limited${V&&V!=="unknown"?` \xB7 resets ${ni(
V)}`:" \xB7 reset unknown"}`:Se?`${Ae} \xB7 ${Se}`:ee&&be!=null?`${Ae} \xB7 \u{1F4CA} ${be}% used${V&&V!=="unknown"?` \xB7 ${V}`:
""}`:be>=75?`${Ae} \xB7 \u{1F4CA} ${be}% used${V&&V!=="unknown"?` \xB7 resets ${ni(V)}`:""}`:ue?`${Ae} \xB7 ${ue}`:de?`${Ae}\
 \xB7 ${de}`:Ae),X&&React.createElement(React.Fragment,null,React.createElement("span",{"aria-hidden":"true"}," \xB7 "),
React.createElement("time",{dateTime:X.iso},El(X))))),React.createElement("div",{className:"session-card-right"},React.createElement(
"details",{className:"session-card-menu",open:M,onToggle:D=>d?.(D.currentTarget.open),onClick:D=>D.stopPropagation()},React.
createElement("summary",{className:"session-card-manage",title:"Session actions","aria-label":`Session actions for ${z}`},
"\u22EF"),React.createElement("div",{className:"session-card-menu-popover",role:"menu","aria-label":`Actions for ${z}`},
React.createElement("button",{role:"menuitem",onClick:()=>N?.(!S)},S?"Unpin chat":"Pin chat"),React.createElement("butto\
n",{role:"menuitem",onClick:()=>A&&A()},"Manage session"),$&&React.createElement("button",{role:"menuitem",className:x?"\
active":"",onClick:()=>$()},"Automations"),O&&React.createElement("button",{role:"menuitem",className:Y?"active":"",onClick:()=>O()},
"Skills"),React.createElement("button",{role:"menuitem",className:"danger",onClick:()=>g&&g()},"Close session")))))}function hf(e){
let t=Array.isArray(e)?e:[];if(!t.length)return"0";let n=t[0],s=t[t.length-1];return[t.length,n?.role||"",oe(n?.content).
slice(0,120),s?.role||"",oe(s?.content).slice(0,120)].join("")}function _f(e){return e?[e.model_id||"",e.effort||"",e.permission_mode||
"",e.file_access_scope||""].join(""):""}function bf(e){return e?[e.kind||"",e.label||"",e.goal?.status||"",e.goal?.label||
"",e.goal_run?.lifecycle||"",e.goal_run?.lease_active===!0?"leased":"released",e.goal_run?.transition_id||""].join(""):
""}function zv(e,t){return e.session===t.session&&e.health===t.health&&e.unread===t.unread&&e.isThinking===t.isThinking&&
e.isActive===t.isActive&&e.hasBlockingPrompt===t.hasBlockingPrompt&&e.blockingPromptLabel===t.blockingPromptLabel&&e.muted===
t.muted&&e.pinned===t.pinned&&e.workspaceLabel===t.workspaceLabel&&e.recentMessageAt===t.recentMessageAt&&e.menuOpen===t.
menuOpen&&e.showAutomationsActive===t.showAutomationsActive&&e.showSkillsActive===t.showSkillsActive&&_f(e.agentConfig)===
_f(t.agentConfig)&&bf(e.activity)===bf(t.activity)&&hf(e.sessionMessages)===hf(t.sessionMessages)}var Kv=React.memo(Wv,zv),
vf=["\xB7","\u2722","*","\u2736","\u273B","\u273D"],Mc=[...vf,...[...vf].reverse()];function Vv(){let[e,t]=React.useState(
0),[n,s]=React.useState(()=>typeof window<"u"&&typeof window.matchMedia=="function"&&window.matchMedia("(prefers-reduced\
-motion: reduce)").matches);return React.useEffect(()=>{if(typeof window>"u"||typeof window.matchMedia!="function")return;
let a=window.matchMedia("(prefers-reduced-motion: reduce)"),i=c=>s(c.matches);return s(a.matches),a.addEventListener?.("\
change",i),()=>a.removeEventListener?.("change",i)},[]),React.useEffect(()=>{if(n){t(0);return}let a=Mc.length*3,i=setInterval(
()=>{if(a-=1,a<=0){clearInterval(i),t(0);return}t(c=>(c+1)%Mc.length)},120);return()=>clearInterval(i)},[n]),React.createElement(
"span",{className:"claude-spinner-icon"},Mc[e])}function yf(e,t){let n=e?new Date(e).getTime():0;if(!Number.isFinite(n)||
n<=0)return"";let s=Math.max(0,Math.floor((t-n)/1e3));return ju(s,{includeSeconds:!0})}function ju(e,{includeSeconds:t=!1}={}){
if(e=Math.max(0,Math.floor(Number(e)||0)),e<60)return`${e}s`;let n=Math.floor(e/60),s=e%60;if(n<60)return t?`${n}m ${String(
s).padStart(2,"0")}s`:`${n}m`;let a=Math.floor(n/60),i=n%60;return a>=24?`${Math.floor(a/24)}d ${String(a%24).padStart(2,
"0")}h ${String(i).padStart(2,"0")}m${t?` ${String(s).padStart(2,"0")}s`:""}`:`${a}h ${String(i).padStart(2,"0")}m${t?` ${String(
s).padStart(2,"0")}s`:""}`}function Ff(e,t,n=null){return e?ju(Ep(e,n,t),{includeSeconds:!0}):""}function Yv({activity:e,
thinkingText:t,agentType:n,pinned:s=!1}){let a=e?.kind||"working",i=pf[a]||pf.working,c=e?.goal||null,u=i.tone==="thinki\
ng"||i.tone==="info",_=(c?.state||c?.status)==="active"&&(!e?.goal_run||e.goal_run.lease_active===!0),y=!!(e?.thinking||
e?.current),S=String(t||e?.thinkingContent||"").trim(),T=n==="claude"||n==="claude_cli",w=e?.thinking||(!y&&(a==="thinki\
ng"||T)?{text:S,since:e?.startedAt||e?.updatedAt||null}:null),M=e?.current||(!y&&!w&&u?{kind:a==="running_command"?"tool":
"answer",label:e?.label||(a==="running_command"?"Running command":"Working"),partial:S,since:e?.startedAt||e?.updatedAt||
null}:null),d=e?.connection||null,h=e?.interruption?.resolution_state==="unresolved"?e.interruption:null,g=e?.step||null,
A=e?.usage||null,[N,$]=React.useState(Date.now()),x=w?w.since||e?.startedAt||e?.updatedAt:null,O=M?M.since||e?.startedAt||
e?.updatedAt:null,Y=V=>!!V&&Number.isFinite(new Date(V).getTime()),te=_&&Y(c?.updated_at)||Y(x)||Y(O);React.useEffect(()=>{
if(!te)return;let V=setInterval(()=>$(Date.now()),1e3);return()=>clearInterval(V)},[te,c?.updated_at,x,O]);let ie=e?.interruptHint||
e?.interrupt_hint||"",ge=c?Ff(c,N,e?.goal_run):"",z=String(c?.text||c?.objective||"").trim(),ae=w?yf(x,N):"",_e=M?yf(O,N):
"";return!c&&!w&&!M&&!d&&!h&&!g&&!A?null:React.createElement("div",{className:`live-status-stack${s?" pinned":""}`,"data\
-testid":"live-status-stack"},h&&React.createElement("div",{className:`live-native-interruption-row ${h.severity||"error"}`,
"data-live-channel":"native-interruption","data-interruption-event-id":h.event_id||"",role:h.blocking?"alert":"status","\
aria-live":h.blocking?"assertive":"polite","aria-label":`${h.title||"Harness interruption"}. ${h.safe_display_text||""}`},
React.createElement("div",{className:"live-native-interruption-heading"},React.createElement("span",{className:"live-nat\
ive-interruption-icon","aria-hidden":"true"},"!"),React.createElement("span",{className:"live-status-label"},h.title||"H\
arness interruption"),h.blocking&&React.createElement("span",{className:"live-status-meta"},"Needs attention")),h.safe_display_text&&
React.createElement("div",{className:"live-native-interruption-detail"},h.safe_display_text),React.createElement("div",{
className:"live-native-interruption-meta"},[h.native_timestamp?new Date(h.native_timestamp).toLocaleString():"",h.retryable?
"Retry may be available in the native harness":"Open the native session for recovery"].filter(Boolean).join(" \xB7 "))),
d&&React.createElement("div",{className:`live-native-connection-row ${d.state||"reconnecting"}`,"data-live-channel":"nat\
ive-connection","data-connection-generation":d.generation||"","data-connection-attempt":d.attempt||"",role:d.state==="fa\
iled"?"alert":"status","aria-live":d.state==="failed"?"assertive":"polite","aria-label":`Codex native connection. ${d.label||
"Connection status"}`},React.createElement("span",{className:"live-native-connection-icon","aria-hidden":"true"},"\u2301"),
React.createElement("span",{className:"live-status-label"},d.label||"Native connection status"),d.state==="failed"&&React.
createElement("span",{className:"live-status-meta"},"Needs attention")),M&&React.createElement("div",{className:`live-cu\
rrent-status ${M.kind||"answer"}`,"data-live-channel":"current"},React.createElement("div",{className:"live-current-tool\
-heading"},M.kind==="tool"?React.createElement("span",{className:"live-status-icon"},"\u25B6"):React.createElement(ei,{agentType:n,
compact:!0}),React.createElement("span",{className:"live-status-label"},M.label||(M.kind==="tool"?"Running tool":"Workin\
g")),React.createElement("span",{className:"live-status-meta"},[_e,ie].filter(Boolean).join(" \xB7 "))),M.partial&&(M.kind===
"tool"?React.createElement("pre",{className:"live-current-output"},M.partial):React.createElement("p",{className:"live-c\
urrent-narration"},M.partial))),w&&React.createElement("div",{className:"live-thinking-row","data-live-channel":"thinkin\
g"},React.createElement("div",{className:"live-thinking-heading"},React.createElement(ei,{agentType:n}),React.createElement(
"span",{className:"live-status-label"},w.label||e?.label||"Thinking"),ae&&React.createElement("span",{className:"live-st\
atus-meta"},ae)),w.text&&React.createElement("div",{className:"live-thinking-text"},w.text)),g&&React.createElement("div",
{className:"live-step-wrap","data-live-channel":"step"},React.createElement("div",{className:"live-step-chip",title:g.text||
""},g.state==="in_progress"?React.createElement(ei,{agentType:n,compact:!0}):React.createElement("span",null,"\u25CC"),React.
createElement("span",null,"Step ",g.current||1," / ",g.total||1),(g.added!=null||g.deleted!=null)&&React.createElement("\
span",{className:"live-step-diff"},"\xB7 +",g.added||0," \u2212",g.deleted||0))),c&&React.createElement("details",{className:"\
live-goal-row","data-live-channel":"goal"},React.createElement("summary",{title:z},React.createElement("span",{className:"\
live-status-icon"},"\u26F3"),React.createElement("span",{className:"live-status-label"},c.label||"Pursuing goal"),React.
createElement("span",{className:"live-goal-objective"},z||"Active goal"),React.createElement("span",{className:"live-sta\
tus-meta"},ge||c.state||c.status||"active")),z&&React.createElement("div",{className:"live-goal-expanded"},z)),A&&React.
createElement("div",{className:"live-usage-banner","data-live-channel":"usage",role:"status"},React.createElement("div",
{className:"live-usage-title"},A.title||"Usage limit reached"),React.createElement("div",{className:"live-usage-detail"},
A.detail||(A.resets_at?`Your rate limit resets at ${A.resets_at}.`:"Usage is currently exhausted."))))}function Xv({taskList:e,
sessionId:t}){let n=e?.content_blocks?.find(T=>T?.type==="plan"),s=n?{...e,...n}:e;if(!s||!s.tasks||s.tasks.length===0)return null;
let a=t?`remote-agent-chat:task-list-collapsed:${t}`:null,i=!1,[c,u]=React.useState(()=>{if(!a)return i;let T=localStorage.
getItem(a);return T==null?i:T==="1"});React.useEffect(()=>{if(!a){u(i);return}let T=localStorage.getItem(a);u(T==null?i:
T==="1")},[a,i]);let f=()=>{u(T=>{let w=!T;return a&&localStorage.setItem(a,w?"1":"0"),w})},_={completed:"\u2713",in_progress:"\
\u25CC",pending:"\u25CB"},y={completed:"done",in_progress:"active",pending:""},S=s.tasks.find(T=>T.state==="in_progress");
return React.createElement("div",{className:`codex-task-list${c?" collapsed":""}`},React.createElement("button",{type:"b\
utton",className:"codex-task-header",onClick:f,"aria-expanded":!c,title:c?"Expand task list":"Collapse task list"},React.
createElement("span",{className:"codex-task-chevron"},c?"\u25B8":"\u25BE"),React.createElement("span",{className:"codex-\
task-count"},s.completed,"/",s.total," tasks"),c&&S?.text&&React.createElement("span",{className:"codex-task-active-summ\
ary"},S.text)),!c&&React.createElement("div",{className:"codex-task-items"},s.tasks.map((T,w)=>React.createElement("div",
{key:w,className:`codex-task-item ${y[T.state]||""}`},React.createElement("span",{className:"codex-task-icon"},_[T.state]||
"\u25CB"),React.createElement("span",{className:"codex-task-text"},T.text)))))}function Qv({card:e,tone:t="cline"}){if(!e)
return null;let n=Number.isFinite(Number(e.percent_used))?Math.max(0,Math.min(100,Number(e.percent_used))):null,s=oe(e.title||
"Current context"),a=oe(e.subtitle||""),i=oe(e.detail||""),c=oe(e.label||e.usage_label||"");return React.createElement("\
div",{className:`cline-context-card ${t}-context-card`},React.createElement("div",{className:"cline-context-header"},React.
createElement("div",{className:"cline-context-copy"},React.createElement("div",{className:"cline-context-title"},s),a&&React.
createElement("div",{className:"cline-context-subtitle"},a),i&&React.createElement("div",{className:"cline-context-detai\
l"},i)),c&&React.createElement("div",{className:"cline-context-usage"},c)),n!=null&&React.createElement("div",{className:"\
cline-context-meter",title:`${e.percent_used}% of context window used`},React.createElement("div",{className:"cline-cont\
ext-meter-fill",style:{width:`${n}%`}})))}function ms(e,t){return e?.choice_id||e?.id||e?.value||`choice-${t}`}function Xo(e,t){
return e?.label||e?.title||e?.text||e?.name||ms(e,t)}function Bu(e,t){let n=new Set(Array.isArray(t)?t:[t]);return(Array.
isArray(e?.content_blocks)?e.content_blocks:[]).find(s=>n.has(s?.type))||null}function kf(e){return Bu(e,"prompt")?.content||
e?.prompt_text||e?.message||e?.text||"Agent requires permission to continue."}function Hf(e){let t=Math.max(0,Math.ceil(
e/1e3)),n=Math.floor(t/60),s=t%60;return`${n}:${String(s).padStart(2,"0")}`}function Jv(e,t){return e?.deadline_at?t<=0?
"Native deadline elapsed \xB7 awaiting receipt":`${e.auto_resolution_policy==="native"?"Native auto-resolution in":"Resp\
onse deadline in"} ${Hf(t)}`:""}function Zv({prompt:e,sessionId:t,agentType:n,onRespond:s,onDismissFocus:a}){let[i,c]=React.
useState(Date.now()),[u,f]=React.useState({}),[_,y]=React.useState({}),[S,T]=React.useState({}),[w,M]=React.useState(""),
[d,h]=React.useState(null),[g,A]=React.useState(!1);React.useEffect(()=>{let X=setInterval(()=>c(Date.now()),500);return()=>clearInterval(
X)},[]),React.useEffect(()=>{f({}),y({}),T({}),M(""),h(null),A(!1)},[e?.prompt_id]);let N=Math.max(0,Number(e?.timeout_ms)||
0),$=Number(e?.received_at)||Date.now(),x=Date.parse(e?.deadline_at||""),O=e?.type==="question_prompt"&&Number.isFinite(
x),Y=O?Math.max(0,x-i):N>0?Math.max(0,N-(i-$)):0,te=Array.isArray(e?.choices)?e.choices:[],ie=e?.submitting_choice_id||null,
ge=e?.type==="question_prompt"&&e?.lifecycle!=="open",z=e?.default_choice||null,ae=(e?.kind==="question"||e?.type==="que\
stion_prompt")&&Array.isArray(e?.questions)?e.questions.filter(X=>X&&typeof X=="object"):[],_e=ae.length>0,V=n==="claude"&&
!_e,he=oe(e?.command).trim(),be=oe(e?.title).trim()||(he?"Allow this action?":kf(e)),ee=oe(e?.description).trim(),Se=V&&
e?.alternate_instruction_supported===!0,Z=ae.flatMap(X=>(Array.isArray(X.choices)?X.choices:[]).map((D,J)=>({question:X,
choiceId:ms(D,J)}))).slice(0,9),ue=(X,D)=>{f(J=>{let E=Array.isArray(J[X.question_id])?J[X.question_id]:[],W=X.multi_select?
E.includes(D)?E.filter(ce=>ce!==D):[...E,D]:[D];return{...J,[X.question_id]:W}})},de=ae.every(X=>{let D=Array.isArray(X.
choices)?X.choices:[];if(X.answer_mode==="text"||D.length===0)return X.required===!1||oe(S[X.question_id]).trim().length>
0;let J=u[X.question_id]||[];return J.length===0?!1:J.every(E=>!D.find((ce,me)=>ms(ce,me)===E)?.requires_text||oe(_[`${X.
question_id}:${E}`]).trim())}),Ae=()=>{if(!de||ie||ge)return;let X=ae.map(D=>{let J=Array.isArray(D.choices)?D.choices:[];
if(D.answer_mode==="text"||J.length===0)return{question_id:D.question_id,text:oe(S[D.question_id]).trim()};let E=u[D.question_id]||
[],W=J.find((fe,we)=>fe.requires_text&&E.includes(ms(fe,we))),ce=W?J.indexOf(W):-1,me=W?ms(W,ce):null;return{question_id:D.
question_id,choice_ids:E,...me?{other_text:oe(_[`${D.question_id}:${me}`]).trim()}:{}}});s(t,e.prompt_id,null,{answers:X})};
return React.useEffect(()=>{let X=D=>{let J=D.target?.closest?.(".permission-card"),E=D.target?.matches?.(".input-area t\
extarea"),W=D.target===document.body||D.target===document.documentElement;if(!J&&!E&&!W||ge&&D.key!=="Escape")return;if(D.
key==="Escape"){if(D.preventDefault(),_e&&e?.type==="question_prompt"&&e?.cancel_supported===!0&&!ie&&!ge){s(t,e.prompt_id,
null,{action:"cancel"});return}let Le=V?te.find((Ee,Ze)=>/^(?:reject|deny|cancel|block|not now|no)\b/i.test(Xo(Ee,Ze).replace(
/^\d+\s+/,""))):null;if(Le&&!ie){s(t,e.prompt_id,ms(Le,te.indexOf(Le)));return}A(!0),a?.();return}if(g)return;let ce=Tu(
D.target),me=D.key==="Enter"&&D.target?.closest?.(".permission-other-input");if(D.key==="Enter"&&!D.shiftKey&&D.target?.
closest?.(".permission-alternate-input")){D.preventDefault();let Le=w.trim();Le&&!ie&&s(t,e.prompt_id,null,{instruction:Le});
return}if(ie||ce&&!me&&!E)return;if(/^[1-9]$/.test(D.key)){let Le=Number(D.key)-1;if(D.preventDefault(),_e){let Ee=Z[Le];
Ee&&ue(Ee.question,Ee.choiceId)}else{let Ee=te[Le];Ee&&h(ms(Ee,Le))}return}if(D.key!=="Enter")return;if(_e){de&&(D.preventDefault(),
Ae());return}let we=d||z;we&&te.some((Le,Ee)=>ms(Le,Ee)===we)&&(D.preventDefault(),s(t,e.prompt_id,we))};return window.addEventListener(
"keydown",X),()=>window.removeEventListener("keydown",X)},[w,te,V,z,ge,g,d,a,s,e?.prompt_id,de,u,_,S,t,Z,_e,ie]),React.createElement(
"div",{className:"permission-overlay"},React.createElement("div",{className:`permission-card${V?" permission-card-claude":
""}`,role:"dialog","aria-modal":"false","aria-label":V?"Claude Code permission prompt":"Permission or question prompt",onPointerDown:()=>A(
!1)},V?React.createElement(React.Fragment,null,React.createElement("div",{className:"permission-title permission-title-c\
laude"},be),he&&React.createElement("pre",{className:"permission-command-claude"},he),ee&&React.createElement("div",{className:"\
permission-body permission-body-claude"},ee)):React.createElement(React.Fragment,null,React.createElement("div",{className:"\
permission-eyebrow"},_e?"Question":"Permission Required"),React.createElement("div",{className:"permission-title"},_e?oe(
e?.title,"Answer the native question"):`Agent Paused In ${t?eo(t,t):"Active Session"}`),!_e&&React.createElement("div",{
className:"permission-body"},kf(e)),React.createElement("div",{className:"permission-meta"},O&&React.createElement("span",
{className:"permission-timer"},Jv(e,Y)),!O&&N>0&&React.createElement("span",{className:"permission-timer"},"Auto-choice \
in ",Hf(Y)),z&&React.createElement("span",{className:"permission-default"},"Default: ",z))),e?.error&&React.createElement(
"div",{className:"permission-error"},e.error),React.createElement("div",{className:`permission-actions${_e?" permission-\
question-list":""}`},_e?ae.map((X,D)=>React.createElement("fieldset",{className:"permission-question",key:X.question_id||
D},React.createElement("legend",null,oe(X.header||X.label,`Question ${D+1}`)),oe(X.message).trim()&&React.createElement(
"div",{className:"permission-question-message"},oe(X.message)),React.createElement("div",{className:"permission-question\
-options"},X.answer_mode==="text"||!Array.isArray(X.choices)||X.choices.length===0?React.createElement("input",{className:"\
permission-question-text-input",type:X.secret===!0?"password":"text",value:S[X.question_id]||"",maxLength:2e3,disabled:!!ie||
ge,autoComplete:"off",spellCheck:X.secret===!0?"false":void 0,placeholder:X.secret===!0?"Enter private answer":"Enter an\
swer","aria-label":`${oe(X.header||X.label,`Question ${D+1}`)} answer`,onChange:J=>T(E=>({...E,[X.question_id]:J.target.
value}))}):X.choices.map((J,E)=>{let W=ms(J,E),ce=(u[X.question_id]||[]).includes(W),me=`${X.question_id}:${W}`;return React.
createElement("div",{className:"permission-question-option",key:W},React.createElement("button",{type:"button",className:`\
permission-action${ce?" selected":""}`,role:X.multi_select?"checkbox":"radio","aria-checked":ce,disabled:!!ie||ge,"aria-\
keyshortcuts":Z.findIndex(fe=>fe.question===X&&fe.choiceId===W)>=0?String(Z.findIndex(fe=>fe.question===X&&fe.choiceId===
W)+1):void 0,onClick:()=>ue(X,W)},Z.findIndex(fe=>fe.question===X&&fe.choiceId===W)>=0&&React.createElement("kbd",{className:"\
permission-key-hint"},Z.findIndex(fe=>fe.question===X&&fe.choiceId===W)+1),React.createElement("span",{className:"permis\
sion-choice-marker","aria-hidden":"true"},X.multi_select?ce?"\u2713":"\u25A1":ce?"\u25CF":"\u25CB"),React.createElement(
"span",{className:"permission-choice-copy"},React.createElement("span",null,Xo(J,E)),oe(J?.description).trim()&&React.createElement(
"span",{className:"permission-action-desc"},oe(J.description)))),ce&&J.requires_text&&React.createElement("input",{className:"\
permission-other-input",type:X.secret===!0?"password":"text",value:_[me]||"",maxLength:2e3,disabled:!!ie||ge,autoComplete:"\
off",spellCheck:X.secret===!0?"false":void 0,placeholder:"Enter another answer","aria-label":`${Xo(J,E)} answer`,onChange:fe=>y(
we=>({...we,[me]:fe.target.value}))}))})))):te.map((X,D)=>{let J=ms(X,D),E=ie===J,W=z&&z===J,ce=d===J,me=V&&!d&&!z&&D===
0,fe=V?Xo(X,D).replace(new RegExp(`^${D+1}\\s+`),""):Xo(X,D),we=V?oe(X?.destination).trim():"",Le=we&&fe.endsWith(we)?fe.
slice(0,-we.length):fe;return React.createElement("button",{key:J,className:`permission-action${W?" default":""}${ce||me?
" selected":""}${E?" pending":""}`,disabled:!!ie,"aria-pressed":ce||me,"aria-keyshortcuts":D<9?String(D+1):void 0,onClick:()=>s(
t,e.prompt_id,J)},D<9&&React.createElement("kbd",{className:"permission-key-hint"},oe(X?.shortcut,String(D+1))),React.createElement(
"span",null,Le,we&&React.createElement("span",{className:"permission-choice-destination-claude"},we)),oe(X?.description).
trim()&&React.createElement("span",{className:"permission-action-desc"},oe(X.description)),E&&React.createElement("span",
{className:"permission-action-state"},"Sending..."))})),Se&&React.createElement("textarea",{className:"permission-altern\
ate-input",rows:"1",maxLength:2e3,value:w,disabled:!!ie,placeholder:oe(e?.alternate_instruction_placeholder,"Tell Claude\
 what to do instead"),"aria-label":"Tell Claude what to do instead",onChange:X=>M(X.target.value)}),_e&&React.createElement(
"div",{className:"permission-question-footer"},React.createElement("button",{type:"button",className:"permission-questio\
n-submit",disabled:!de||!!ie||ge,onClick:Ae},ie?"Sending...":oe(e.submit_label,"Submit answers")),e?.type==="question_pr\
ompt"&&e?.cancel_supported===!0&&React.createElement("button",{type:"button",className:"permission-question-cancel",disabled:!!ie||
ge,onClick:()=>s(t,e.prompt_id,null,{action:"cancel"})},"Cancel")),React.createElement("div",{className:"permission-keyb\
oard-help"},V?oe(e?.cancel_hint,"Esc to cancel"):`1\u20139 select \xB7 Enter submit \xB7 Esc ${e?.cancel_supported===!0?
"cancel":"return to composer"}`)))}function $c(e){return oe(e?.label,"Action")}function Zr(e){return!!e&&e.blocking!==!1&&
e.display_mode!=="inline"}function ey({prompt:e,sessionId:t,onRespond:n}){let s=Bu(e,["error","notice"]),a=Array.isArray(
e?.actions)?e.actions:s?.actions||[],i=e?.submitting_action_id||null,c=oe(e?.error_output||s?.error_output).trim();return React.
createElement("div",{className:"permission-overlay"},React.createElement("div",{className:"permission-card error-prompt-\
card"},React.createElement("div",{className:"permission-eyebrow error-prompt-eyebrow"},"Action Required"),React.createElement(
"div",{className:"permission-title"},oe(s?.label||e?.title,"Error handling model response")),React.createElement("div",{
className:"permission-body"},oe(s?.content||e?.message,"There was an error handling the model response.")),c&&React.createElement(
"div",{className:"error-prompt-output-wrap"},React.createElement("div",{className:"error-prompt-output-label"},"Error Ou\
tput"),React.createElement("pre",{className:"error-prompt-output"},c)),e?.error&&React.createElement("div",{className:"p\
ermission-error"},e.error),React.createElement("div",{className:"permission-actions"},a.map(u=>{let f=oe(u?.action_id),_=i===
f;return React.createElement("button",{key:f||$c(u),className:`permission-action error-prompt-action${_?" pending":""}`,
disabled:!!i,onClick:y=>n(t,e.prompt_id,f,y)},React.createElement("span",null,$c(u)),_&&React.createElement("span",{className:"\
permission-action-state"},"Sending..."))}))))}function ty({prompt:e,sessionId:t,onRespond:n}){let s=Bu(e,["error","notic\
e"]),a=Array.isArray(e?.actions)?e.actions:s?.actions||[],i=e?.submitting_action_id||null,c=oe(e?.error_output||s?.error_output).
trim();return React.createElement("div",{className:"inline-error-prompt"},React.createElement("div",{className:"inline-e\
rror-prompt-body"},React.createElement("div",{className:"inline-error-prompt-title"},oe(s?.label||e?.title,"Codex requir\
es attention")),React.createElement("div",{className:"inline-error-prompt-message"},oe(s?.content||e?.message,"There was\
 an error handling the model response.")),c&&React.createElement("pre",{className:"inline-error-prompt-output"},c),e?.error&&
React.createElement("div",{className:"permission-error"},e.error)),React.createElement("div",{className:"inline-error-pr\
ompt-actions"},a.map(u=>{let f=oe(u?.action_id),_=i===f;return React.createElement("button",{key:f||$c(u),className:`per\
mission-action error-prompt-action${_?" pending":""}`,disabled:!!i,onClick:y=>n(t,e.prompt_id,f,y)},React.createElement(
"span",null,$c(u)),_&&React.createElement("span",{className:"permission-action-state"},"Sending..."))})))}function ny({launchStates:e,
onLaunch:t,onResume:n,onClose:s,workspaces:a,showTestSessions:i=!1}){let[c,u]=React.useState("new"),[f,_]=React.useState(
"claude"),[y,S]=React.useState(""),[T,w]=React.useState(""),[M,d]=React.useState("deepseek-v4-pro:cloud"),[h,g]=React.useState(
"gpt-5.5"),[A,N]=React.useState("grok-4.5-fast-high"),[$,x]=React.useState(null),[O,Y]=React.useState([]),[te,ie]=React.
useState(!1),ge=$?e[$]:null,z=ge?.status==="launching",ae=ge?.status==="failed"?ge.error:null,_e=(a||[]).length>0;React.
useEffect(()=>{$&&!e[$]&&s()},[e,$]),React.useEffect(()=>{c==="resume"&&!te&&(ie(!0),fetch(`/api/sessions/history?limit=\
30&include_test=${i?"true":"false"}`,{credentials:"same-origin"}).then(ee=>ee.json()).then(ee=>Y(ee.sessions||[])).catch(
()=>Y([])).finally(()=>ie(!1)))},[c,i]);function V(ee){if(ee.preventDefault(),z)return;let Se=y==="custom"?T.trim():y,Z=f===
"claude_cli"?{model_id:M.trim()||"default"}:f==="codex_cli"?{model_id:h.trim()||"gpt-5.5",permission_mode:"workspace-wri\
te",effort:"medium"}:f==="cursor_cli"?{model_id:A.trim()||"grok-4.5-fast-high",permission_mode:"force"}:{},ue=t(f,Se||void 0,
Z);x(ue)}function he(ee){if(z)return;let Se=ee.agent_type||f,Z=ee.workspace_path||(y==="custom"?T.trim():y)||void 0,ue=n(
ee.session_id,Se,Z,{cli_session_id:ee.cli_session_id||void 0,model_id:ee.model_id||void 0,permission_mode:ee.permission_mode||
void 0});x(ue)}function be(ee){if(!ee)return"";let Se=Date.now()-new Date(ee).getTime(),Z=Math.floor(Se/6e4);if(Z<60)return`${Z}\
m ago`;let ue=Math.floor(Z/60);return ue<24?`${ue}h ago`:`${Math.floor(ue/24)}d ago`}return React.createElement("div",{className:"\
new-session-panel"},React.createElement("div",{className:"new-session-header"},React.createElement("span",null,c==="new"?
"New Session":"Resume Session"),React.createElement("button",{className:"new-session-close",onClick:s,title:"Cancel"},"\u2715")),
React.createElement("div",{className:"new-session-tabs"},React.createElement("button",{className:`new-session-tab${c==="\
new"?" active":""}`,onClick:()=>u("new")},"New"),React.createElement("button",{className:`new-session-tab${c==="resume"?
" active":""}`,onClick:()=>u("resume")},"Resume")),c==="new"?React.createElement("form",{className:"new-session-form",onSubmit:V},
React.createElement("div",{className:"new-session-agents"},Object.entries(Gn).map(([ee,Se])=>React.createElement("button",
{key:ee,type:"button",className:`new-session-agent-btn${f===ee?" selected":""}`,style:f===ee?{borderColor:Se.color,color:Se.
color,background:Se.color+"18"}:{},onClick:()=>_(ee)},React.createElement("span",{className:"agent-badge new-session-bad\
ge",style:{color:Se.color,borderColor:Se.color+"55",background:Se.color+"18"}},Se.abbr),React.createElement("span",{className:"\
new-session-agent-name"},Se.name)))),_e?React.createElement(React.Fragment,null,React.createElement("select",{className:"\
new-session-workspace",value:y,onChange:ee=>S(ee.target.value),disabled:z},React.createElement("option",{value:""},"No w\
orkspace (default)"),a.map((ee,Se)=>React.createElement("option",{key:Se,value:ee.path||ee.title},ee.title)),React.createElement(
"option",{value:"custom"},"Custom path\u2026")),y==="custom"&&React.createElement("input",{className:"new-session-worksp\
ace",type:"text",placeholder:"Enter workspace path",value:T,onChange:ee=>w(ee.target.value),disabled:z,autoFocus:!0})):React.
createElement("input",{className:"new-session-workspace",type:"text",placeholder:"Workspace path (optional)",value:T,onChange:ee=>w(
ee.target.value),disabled:z}),f==="claude_cli"&&React.createElement("input",{className:"new-session-workspace",type:"tex\
t",placeholder:"Claude CLI model, e.g. deepseek-v4-pro:cloud",value:M,onChange:ee=>d(ee.target.value),disabled:z}),f==="\
codex_cli"&&React.createElement("select",{className:"new-session-workspace",value:h,onChange:ee=>g(ee.target.value),disabled:z},
Fu.map(ee=>React.createElement("option",{key:ee.id,value:ee.id},ee.label))),f==="cursor_cli"&&React.createElement("selec\
t",{className:"new-session-workspace",value:A,onChange:ee=>N(ee.target.value),disabled:z},Hu.map(ee=>React.createElement(
"option",{key:ee.id,value:ee.id},ee.label))),ae&&React.createElement("div",{className:"new-session-error"},ae),React.createElement(
"button",{className:"new-session-submit",type:"submit",disabled:z},z?React.createElement("span",{className:"new-session-\
spinner"}):null,z?"Launching\u2026":"Launch")):React.createElement("div",{className:"new-session-form"},React.createElement(
"div",{className:"new-session-agents"},Object.entries(Gn).map(([ee,Se])=>React.createElement("button",{key:ee,type:"butt\
on",className:`new-session-agent-btn${f===ee?" selected":""}`,style:f===ee?{borderColor:Se.color,color:Se.color,background:Se.
color+"18"}:{},onClick:()=>_(ee)},React.createElement("span",{className:"agent-badge new-session-badge",style:{color:Se.
color,borderColor:Se.color+"55",background:Se.color+"18"}},Se.abbr),React.createElement("span",{className:"new-session-a\
gent-name"},Se.name)))),ae&&React.createElement("div",{className:"new-session-error"},ae),te?React.createElement("div",{
className:"session-history-loading"},React.createElement("span",{className:"new-session-spinner"})," Loading history\u2026"):
O.length===0?React.createElement("div",{className:"session-history-empty"},"No past sessions found"):React.createElement(
"div",{className:"session-history-list"},O.filter(ee=>!f||!ee.agent_type||ee.agent_type===f).map(ee=>React.createElement(
"button",{key:ee.session_id,className:"session-history-item",onClick:()=>he(ee),disabled:z},React.createElement("div",{className:"\
session-history-preview"},ee.preview||"(empty session)"),React.createElement("div",{className:"session-history-meta"},React.
createElement("span",null,ee.message_count," msg",ee.message_count!==1?"s":""),ee.agent_type&&React.createElement("span",
{className:"session-history-workspace"},Gn[ee.agent_type]?.name||ee.agent_type),ee.workspace_name&&React.createElement("\
span",{className:"session-history-workspace",title:ee.workspace_path||""},ee.workspace_name),React.createElement("span",
null,be(ee.last_active_at))))))))}var sy={claude:[{value:"default",label:"Ask before edit"},{value:"acceptEdits",label:"\
Edit automatically"},{value:"plan",label:"Plan mode"},{value:"auto",label:"Auto mode"},{value:"bypassPermissions",label:"\
Bypass permissions"}],claude_cli:[{value:"default",label:"Default"},{value:"acceptEdits",label:"Accept edits"},{value:"a\
uto",label:"Auto"},{value:"bypassPermissions",label:"Bypass permissions"},{value:"dontAsk",label:"Do not ask"},{value:"p\
lan",label:"Plan"}],continue_yolo:[{value:"ask",label:"Ask for permissions"},{value:"bypass",label:"Bypass permissions"}],
roo_code:[{value:"BRRR",label:"BRRR"},{value:"YOLO",label:"YOLO"},{value:"Ask",label:"Ask"},{value:"Auto-approve",label:"\
Auto-approve"}],cline:[{value:"YOLO",label:"YOLO"}],codex_cli:[{value:"read-only",label:"Read only"},{value:"workspace-w\
rite",label:"Workspace write"},{value:"danger-full-access",label:"Full access"}],cursor_cli:[{value:"default",label:"Def\
ault"},{value:"force",label:"Force (Yolo)"},{value:"plan",label:"Plan"},{value:"ask",label:"Ask"}],codex:[],gemini:[]};function Uf(e){
return e==="codex_cli"?"workspace-write":e==="cursor_cli"?"force":e==="continue_yolo"||e==="roo_code"||e==="cline"?"ask":
"default"}var Eu=[{id:"default",label:"Auto"},{id:"claude-opus-4-6",label:"Claude Opus 4.6"},{id:"claude-sonnet-4-6",label:"\
Claude Sonnet 4.6"},{id:"claude-opus-4-5",label:"Claude Opus 4.5"},{id:"claude-sonnet-4-5",label:"Claude Sonnet 4.5"},{id:"\
claude-haiku-4-5",label:"Claude Haiku 4.5"},{id:"claude-opus-4-0",label:"Claude Opus 4"},{id:"claude-sonnet-4-0",label:"\
Claude Sonnet 4"},{id:"claude-3-7-sonnet",label:"Claude 3.7 Sonnet"},{id:"claude-3-5-sonnet",label:"Claude 3.5 Sonnet"},
{id:"claude-3-5-haiku",label:"Claude 3.5 Haiku"},{id:"deepseek-v4-pro:cloud",label:"DeepSeek V4 Pro (Ollama Cloud)"}],Fu=[
{id:"gpt-5.6",label:"GPT-5.6"},{id:"gpt-5.6-sol",label:"GPT-5.6 Sol"},{id:"gpt-5.6-terra",label:"GPT-5.6 Terra"},{id:"gp\
t-5.6-luna",label:"GPT-5.6 Luna"},{id:"gpt-5.5",label:"GPT-5.5"},{id:"gpt-5.4",label:"GPT-5.4"},{id:"gpt-5.4-mini",label:"\
GPT-5.4 Mini"},{id:"gpt-5.3-codex-spark",label:"GPT-5.3 Codex Spark"},{id:"gpt-5.3-codex",label:"GPT-5.3 Codex"},{id:"gp\
t-5.2-codex",label:"GPT-5.2 Codex"},{id:"gpt-5.2",label:"GPT-5.2"},{id:"gpt-5.1-codex",label:"GPT-5.1 Codex"},{id:"gpt-5\
.1",label:"GPT-5.1"},{id:"gpt-5",label:"GPT-5"},{id:"ollama:deepseek-v4-pro:cloud",label:"DeepSeek V4 Pro (Ollama Cloud)"},
{id:"ollama:kimi-k2.6:cloud",label:"Kimi K2.6 (Ollama Cloud)"}],Hu=[{id:"grok-4.5-fast-high",label:"Grok 4.5 Fast (High)"},
{id:"grok-4.5-fast-xhigh",label:"Grok 4.5 Fast (XHigh)"},{id:"claude-fable-5-thinking-high",label:"Claude Fable 5 (Think\
ing High)"},{id:"claude-opus-4-8-thinking-high",label:"Claude Opus 4.8 (Thinking High)"},{id:"composer-2.5",label:"Compo\
ser 2.5"},{id:"composer-2.5-fast",label:"Composer 2.5 Fast"},{id:"gpt-5.5-high",label:"GPT-5.5 (High)"},{id:"gpt-5.3-cod\
ex",label:"GPT-5.3 Codex"}],Uu=[{id:"Planning",label:"Planning"},{id:"Fast",label:"Fast"}],ay=[{id:"Architect",label:"Ar\
chitect"},{id:"Code",label:"Code"},{id:"Ask",label:"Ask"},{id:"Debug",label:"Debug"},{id:"Orchestrator",label:"Orchestra\
tor"}],ry=[{id:"Plan",label:"Plan"},{id:"Act",label:"Act"}],Gf=[{id:"Gemini 3.1 Pro (High)",label:"Gemini 3.1 Pro (High)"},
{id:"Gemini 3.1 Pro (Low)",label:"Gemini 3.1 Pro (Low)"},{id:"Gemini 3 Flash",label:"Gemini 3 Flash"},{id:"Claude Sonnet\
 4.6 (Thinking)",label:"Claude Sonnet 4.6 (Thinking)"},{id:"Claude Opus 4.6 (Thinking)",label:"Claude Opus 4.6 (Thinking\
)"},{id:"GPT-OSS 120B (Medium)",label:"GPT-OSS 120B (Medium)"}],Wf=[{id:"Default",label:"Default"},{id:"2.5 Flash",label:"\
Gemini 2.5 Flash"},{id:"2.5 Pro",label:"Gemini 2.5 Pro"},{id:"3 Flash Preview",label:"Gemini 3 Flash Preview"},{id:"3.1 \
Pro Preview",label:"Gemini 3.1 Pro Preview"}];function wf(e,t){return Array.isArray(t?.available_models)&&t.available_models.
length>0?t.available_models.map(n=>typeof n=="string"?{id:n,label:n}:n):e==="continue_yolo"||e==="continue"||e==="roo_co\
de"||e==="cline"?[]:e==="claude_cli"?Eu:e==="codex_cli"?Fu:e==="cursor_cli"?Hu:e==="antigravity"||e==="antigravity_panel"?
Gf:e==="gemini"?Wf:Eu}function Qo(e,t){return Array.isArray(t?.available_modes)&&t.available_modes.length>0?t.available_modes.
map(n=>typeof n=="string"?{id:n,label:n}:n):e==="roo_code"?ay:e==="cline"?ry:e==="antigravity"||e==="antigravity_panel"?
Uu:[]}function Lu(e,t){return Array.isArray(t?.available_permission_modes)&&t.available_permission_modes.length>0?t.available_permission_modes.
map(n=>typeof n=="string"?{value:n,label:n}:{value:n.id||n.value,label:n.label||n.id||n.value}).filter(n=>n.value):sy[e]||
[]}function oy(e){let t="=".repeat((4-e.length%4)%4),n=(e+t).replace(/-/g,"+").replace(/_/g,"/"),s=atob(n);return Uint8Array.
from([...s].map(a=>a.charCodeAt(0)))}var Gu=Object.freeze({permission_required:!0,agent_ready:!0,turn_ready:!1,goal_completed:!1,
goal_attention:!0,provider_usage_warning:!0,agent_error:!0,session_offline:!0,rate_limit_cleared:!0,completion_sound:!1,
completion_haptic:!1}),iy=Object.freeze(Object.fromEntries(Object.keys(Gu).map(e=>[e,!1]))),Cc=null,Sf=0;function Wu(){if(typeof window>
"u")return null;let e=window.AudioContext||window.webkitAudioContext;return e?(Cc||(Cc=new e),Cc.state==="suspended"&&Cc.
resume().catch(()=>{}),Cc):null}function Nf(e="completion"){let t=Date.now();if(t-Sf<600)return!1;let n=Wu();if(!n||n.state!==
"running")return!1;Sf=t;let s=n.createOscillator(),a=n.createGain(),i=n.currentTime;return s.type="sine",s.frequency.setValueAtTime(
e==="prompt"?740:620,i),s.frequency.exponentialRampToValueAtTime(e==="prompt"?880:760,i+.11),a.gain.setValueAtTime(1e-4,
i),a.gain.exponentialRampToValueAtTime(.035,i+.012),a.gain.exponentialRampToValueAtTime(1e-4,i+.14),s.connect(a),a.connect(
n.destination),s.start(i),s.stop(i+.15),!0}function Cf(e,t){return e!==t?!0:typeof document>"u"?!1:document.visibilityState!==
"visible"||!document.hasFocus()}function cy({onClose:e,onPreferencesChange:t}){let n=Gu,[s,a]=le(n),[i,c]=le(!0),[u,f]=le(
null),[_,y]=le(""),[S,T]=le("checking"),[w,M]=le(!1);async function d(){c(!0),y("");try{let $=await fetch("/api/preferen\
ces/notifications",{credentials:"same-origin"}),x=await $.json().catch(()=>({}));if(!$.ok)throw new Error(x.error||"Unab\
le to load notification settings.");let O={...n,...x.preferences||{},turn_ready:!1};a(O),t?.(O)}catch($){y($.message||"U\
nable to load notification settings.")}finally{c(!1)}}async function h(){if(!("serviceWorker"in navigator)||!("PushManag\
er"in window)||!("Notification"in window)){T("unsupported");return}try{let x=await(await navigator.serviceWorker.ready).
pushManager.getSubscription();T(x?"enabled":Notification.permission==="denied"?"denied":"available")}catch{T("error")}}Oe(
()=>{d(),h()},[]);async function g(){if(!w){M(!0),y("");try{let $=await Notification.requestPermission();if($!=="granted"){
T($==="denied"?"denied":"available");return}let x=await fetch("/api/push/web-config",{credentials:"same-origin"}),O=await x.
json().catch(()=>({}));if(!x.ok||!O.public_key)throw new Error(O.error||"Web Push is unavailable.");let Y=await navigator.
serviceWorker.ready,te=await Y.pushManager.getSubscription();te||(te=await Y.pushManager.subscribe({userVisibleOnly:!0,applicationServerKey:oy(
O.public_key)}));let ie=await fetch("/api/push/web-subscription",{method:"POST",credentials:"same-origin",headers:{"Cont\
ent-Type":"application/json"},body:JSON.stringify({subscription:te.toJSON()})}),ge=await ie.json().catch(()=>({}));if(!ie.
ok)throw new Error(ge.error||"Unable to register browser notifications.");T("enabled")}catch($){T("error"),y($.message||
"Unable to enable browser notifications.")}finally{M(!1)}}}async function A(){if(!w){M(!0),y("");try{let x=await(await navigator.
serviceWorker.ready).pushManager.getSubscription();x&&(await fetch("/api/push/web-subscription",{method:"DELETE",credentials:"\
same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({endpoint:x.endpoint})}),await x.unsubscribe()),
T("available")}catch($){T("error"),y($.message||"Unable to disable browser notifications.")}finally{M(!1)}}}async function N($){
if(u||$==="turn_ready")return;let x=s,O={...s,[$]:!s[$]};$==="completion_sound"&&O.completion_sound&&Wu(),a(O),f($),y("");
try{let Y=await fetch("/api/preferences/notifications",{method:"PUT",credentials:"same-origin",headers:{"Content-Type":"\
application/json"},body:JSON.stringify({preferences:O})}),te=await Y.json().catch(()=>({}));if(!Y.ok)throw new Error(te.
error||"Unable to save notification settings.");let ie={...n,...te.preferences||{}};a(ie),t?.(ie)}catch(Y){a(x),y(Y.message||
"Unable to save notification settings.")}finally{f(null)}}return React.createElement("div",{className:"settings-panel no\
tification-settings-panel"},React.createElement("div",{className:"settings-panel-header"},React.createElement("span",null,
"Notifications"),React.createElement("button",{className:"settings-panel-close",onClick:e,title:"Close"},"\u2715")),React.
createElement("div",{className:"settings-panel-body"},React.createElement("div",{className:"notification-setting-row web\
-push-setting-row"},React.createElement("span",null,React.createElement("strong",null,"Browser notifications"),React.createElement(
"small",null,S==="enabled"?"Enabled for this browser":S==="denied"?"Blocked in browser site settings":S==="unsupported"?
"Not supported by this browser":S==="checking"?"Checking browser support\u2026":"Receive notifications when this PWA is \
closed")),S==="enabled"?React.createElement("button",{type:"button",disabled:w,onClick:A},"Disable"):React.createElement(
"button",{type:"button",disabled:w||S==="checking"||S==="unsupported"||S==="denied",onClick:g},w?"Enabling\u2026":"Enabl\
e")),React.createElement("label",{className:"notification-setting-row"},React.createElement("span",null,React.createElement(
"strong",null,"Permission required"),React.createElement("small",null,"When an agent needs approval to continue")),React.
createElement("input",{type:"checkbox",checked:s.permission_required,disabled:i||!!u,onChange:()=>N("permission_required")})),
React.createElement("label",{className:"notification-setting-row"},React.createElement("span",null,React.createElement("\
strong",null,"Turn finished"),React.createElement("small",null,"Unavailable until this harness supplies an authoritative\
 native turn boundary")),React.createElement("input",{type:"checkbox",checked:!1,disabled:!0,onChange:()=>N("turn_ready")})),
React.createElement("label",{className:"notification-setting-row"},React.createElement("span",null,React.createElement("\
strong",null,"Goal completed"),React.createElement("small",null,"Only when the native goal reaches its terminal complete\
d state")),React.createElement("input",{type:"checkbox",checked:s.goal_completed,disabled:i||!!u,onChange:()=>N("goal_co\
mpleted")})),React.createElement("label",{className:"notification-setting-row"},React.createElement("span",null,React.createElement(
"strong",null,"Goal needs attention"),React.createElement("small",null,"Paused, blocked, limited, cancelled, or failed g\
oals")),React.createElement("input",{type:"checkbox",checked:s.goal_attention,disabled:i||!!u,onChange:()=>N("goal_atten\
tion")})),React.createElement("label",{className:"notification-setting-row"},React.createElement("span",null,React.createElement(
"strong",null,"Provider usage warning"),React.createElement("small",null,"At 75%, 90%, and exhaustion for each provider \
account window")),React.createElement("input",{type:"checkbox",checked:s.provider_usage_warning,disabled:i||!!u,onChange:()=>N(
"provider_usage_warning")})),React.createElement("div",{className:"settings-note"},"Active /goal loop checkpoints stay q\
uiet between turns."),React.createElement("label",{className:"notification-setting-row"},React.createElement("span",null,
React.createElement("strong",null,"Agent error or rate limit"),React.createElement("small",null,"When an agent stops and\
 needs attention")),React.createElement("input",{type:"checkbox",checked:s.agent_error,disabled:i||!!u,onChange:()=>N("a\
gent_error")})),React.createElement("label",{className:"notification-setting-row"},React.createElement("span",null,React.
createElement("strong",null,"Session offline"),React.createElement("small",null,"When an agent disconnects from the rela\
y")),React.createElement("input",{type:"checkbox",checked:s.session_offline,disabled:i||!!u,onChange:()=>N("session_offl\
ine")})),React.createElement("label",{className:"notification-setting-row"},React.createElement("span",null,React.createElement(
"strong",null,"Rate limit cleared"),React.createElement("small",null,"When a model's rate limit expires")),React.createElement(
"input",{type:"checkbox",checked:s.rate_limit_cleared,disabled:i||!!u,onChange:()=>N("rate_limit_cleared")})),React.createElement(
"label",{className:"notification-setting-row"},React.createElement("span",null,React.createElement("strong",null,"Notifi\
cation sound"),React.createElement("small",null,"Subtle cue for allowed prompts and explicit goal lifecycle events")),React.
createElement("input",{type:"checkbox",checked:s.completion_sound,disabled:i||!!u,onChange:()=>N("completion_sound")})),
i&&React.createElement("div",{className:"settings-note"},"Loading relay preferences\u2026"),!!_&&React.createElement("di\
v",{className:"notification-settings-error",role:"alert"},React.createElement("span",null,_),React.createElement("button",
{type:"button",onClick:d},"Retry")),React.createElement("div",{className:"settings-note"},"These preferences sync across\
 web and Android.")))}function ly({sessions:e,preferences:t,initialSessionId:n,onSave:s,onExport:a,onClose:i}){let c=n||
qe(e[0])||"",[u,f]=le(c),[_,y]=le(""),[S,T]=le(!1),[w,M]=le(""),[d,h]=le(""),g=e.find(x=>qe(x)===u)||null,A=t[u]||{display_name:"",
archived:!1,muted:!1,pinned:!1,pin_order:0};Oe(()=>{y(A.display_name||""),h("")},[u,A.display_name]),Oe(()=>{n&&f(n)},[n]);
async function N(x){if(!(!u||S)){T(!0),h("");try{await s(u,x)}catch(O){h(O.message||"Unable to save session settings.")}finally{
T(!1)}}}async function $(x){if(!(!u||w)){M(x),h("");try{await a(u,x)}catch(O){h(O.message||"Unable to export session.")}finally{
M("")}}}return React.createElement("div",{className:"settings-panel session-management-panel"},React.createElement("div",
{className:"settings-panel-header"},React.createElement("span",null,"Manage sessions"),React.createElement("button",{className:"\
settings-panel-close",onClick:i,title:"Close"},"\u2715")),React.createElement("div",{className:"settings-panel-body"},e.
length===0?React.createElement("div",{className:"settings-note"},"No sessions available."):React.createElement(React.Fragment,
null,React.createElement("label",{className:"settings-row session-management-field"},React.createElement("span",{className:"\
settings-label"},"Session"),React.createElement("select",{value:u,onChange:x=>f(x.target.value)},e.map(x=>{let O=qe(x),Y=t[O]||
{},te=Y.display_name||x?.display_name||x?.workspace_name||x?.name||O;return React.createElement("option",{key:O,value:O},
Y.archived?"[Hidden] ":"",te)}))),g&&React.createElement(React.Fragment,null,React.createElement("label",{className:"set\
tings-row session-management-field"},React.createElement("span",{className:"settings-label"},"Custom name"),React.createElement(
"input",{value:_,maxLength:100,placeholder:g?.display_name||g?.workspace_name||g?.name||u,onChange:x=>y(x.target.value)})),
React.createElement("label",{className:"notification-setting-row"},React.createElement("span",null,React.createElement("\
strong",null,"Pin chat"),React.createElement("small",null,"Keep this chat in the operator-ordered pinned section")),React.
createElement("input",{type:"checkbox",checked:!!A.pinned,disabled:S,onChange:()=>N({pinned:!A.pinned})})),React.createElement(
"label",{className:"notification-setting-row"},React.createElement("span",null,React.createElement("strong",null,"Mute n\
otifications"),React.createElement("small",null,"Suppress push notifications for this session")),React.createElement("in\
put",{type:"checkbox",checked:!!A.muted,disabled:S,onChange:()=>N({muted:!A.muted})})),React.createElement("div",{className:"\
session-management-actions"},React.createElement("button",{disabled:S,onClick:()=>N({display_name:_})},"Save name"),React.
createElement("button",{className:A.archived?"":"danger",disabled:S,onClick:()=>N({archived:!A.archived})},A.archived?"R\
estore to sidebar":"Hide from sidebar")),React.createElement("div",{className:"session-management-actions session-export\
-actions","aria-label":"Export session"},React.createElement("button",{disabled:!!w,onClick:()=>$("markdown")},w==="mark\
down"?"Preparing\u2026":"Download Markdown"),React.createElement("button",{disabled:!!w,onClick:()=>$("json")},w==="json"?
"Preparing\u2026":"Download JSON")))),!!d&&React.createElement("div",{className:"settings-error",role:"alert"},d),React.
createElement("div",{className:"settings-note"},"Names, pinned order, hidden state, and mute settings sync across web an\
d Android.")))}function uy({sessionId:e,initialContent:t,jobs:n,onSchedule:s,onCancel:a,onCreated:i,onClose:c}){let[u,f]=le(
t||""),[_,y]=le("idle"),[S,T]=le(()=>{let N=new Date(Date.now()+36e5);return new Date(N.getTime()-N.getTimezoneOffset()*
6e4).toISOString().slice(0,16)}),[w,M]=le(""),[d,h]=le(!1);async function g(N){N.preventDefault(),h(!0),M("");try{await s(
e,u,_,_==="at"?new Date(S).toISOString():null),i?.(),f("")}catch($){M($.message)}finally{h(!1)}}async function A(N){try{
await a(N)}catch($){M($.message)}}return React.createElement("div",{className:"settings-panel scheduled-send-panel","dat\
a-testid":"scheduled-send-panel"},React.createElement("div",{className:"settings-panel-header"},React.createElement("spa\
n",null,"Schedule message"),React.createElement("button",{className:"settings-panel-close",onClick:c,title:"Close"},"\xD7")),
React.createElement("form",{className:"settings-panel-body",onSubmit:g},React.createElement("label",{className:"settings\
-row session-management-field"},React.createElement("span",{className:"settings-label"},"Message"),React.createElement("\
textarea",{value:u,maxLength:524288,onChange:N=>f(N.target.value)})),React.createElement("label",{className:"settings-ro\
w session-management-field"},React.createElement("span",{className:"settings-label"},"Deliver"),React.createElement("sel\
ect",{value:_,onChange:N=>y(N.target.value)},React.createElement("option",{value:"idle"},"When session is next idle"),React.
createElement("option",{value:"at"},"At a specific time"))),_==="at"&&React.createElement("label",{className:"settings-r\
ow session-management-field"},React.createElement("span",{className:"settings-label"},"Local time"),React.createElement(
"input",{type:"datetime-local",value:S,onChange:N=>T(N.target.value)})),React.createElement("div",{className:"session-ma\
nagement-actions"},React.createElement("button",{type:"submit",disabled:d||!u.trim()},d?"Scheduling\u2026":"Schedule")),
!!w&&React.createElement("div",{className:"settings-error",role:"alert"},w),!!n.length&&React.createElement("div",{className:"\
scheduled-send-list"},React.createElement("strong",null,"Pending"),n.map(N=>React.createElement("div",{className:"schedu\
led-send-row",key:N.id},React.createElement("span",null,N.trigger_kind==="idle"?"Next idle":new Date(N.deliver_at).toLocaleString(),
" \xB7 ",N.content),React.createElement("button",{type:"button",onClick:()=>A(N.id),disabled:N.state!=="pending"},N.state===
"dispatching"?"Sending\u2026":"Cancel"))))))}function dy({session:e,config:t,configControlStates:n,onRequestRefresh:s,onSetModel:a,
onSetEffort:i,onSetPermissionMode:c,onSetAutoApprovePermissions:u,onSetMode:f,onSetCodexConfig:_,onSwitchWorkspace:y,onClose:S}){
let[T,w]=React.useState(!1),[M,d]=React.useState(null),h=qe(e),g=F=>n?.[`${h}:${F}`]||null,A=F=>F&&(F.status==="pending"||
F.status==="awaiting_config"),N=g("model"),$=g("permission_mode"),x=g("effort"),O=g("auto_approve_permissions"),Y=g("mod\
e"),te=g("speed"),ie=g("access_mode"),ge=g("permission_profile"),z=g("workspace"),ae=[N,$,x,O,Y,te,ie,ge,z].find(F=>A(F)||
F?.status==="failed"),_e=ae?A(ae)?`Saving ${ae.field.replace(/_/g," ")}\u2026`:ae.error:null,V=e&&typeof e=="object"?e.agent_type:
null,he=t?.capabilities||{},be=V==="codex_cli"&&t?.config_semantics==="observed_and_next_send",ee=V==="codex",Se=!ee||t?.
controls_available!==!1,Z=t?.model_id||"unknown",ue=t?.next_send_model_id||"",de=e&&typeof e=="object"&&e.rate_limited_until||
null,Ae=Array.isArray(e?.antigravity_quota_models)?e.antigravity_quota_models:[],X=e?.active_quota_model||null,D=t?.permission_mode||
"unknown",J=t?.conversation_mode||"unknown",E=t?.mode&&t.mode!=="unknown"?t.mode:J,W=typeof t?.auto_approve_permissions==
"boolean"?t.auto_approve_permissions:!!e?.auto_approve_permissions,ce=V==="codex_cli"?e?.codex_live_owner:null,me=ce?ce.
state==="confirmed"?{interactive_tui:"Interactive terminal active",proxy_app_server:"Headless RAC app-server turn active",
rotator_exec:"Headless rotator worker active"}[ce.owner_kind]||"Live owner active":ce.state==="multiple"?"Needs attentio\
n: multiple owners":ce.state==="stale"?"Needs attention: stale owner proof":ce.state==="unavailable"?"Ownership startup \
is not ready":"No live owner":"Ownership status unavailable",fe=ce?[ce.thread_id?`thread ${ce.thread_id}`:null,ce.turn_id?
`turn ${ce.turn_id}`:null,ce.root_pid?`PID ${ce.root_pid}`:null,ce.reason||null].filter(Boolean).join(" \xB7 "):"",we=t?.
effort||null,Le=t?.next_send_effort||"",Ee=t?.file_access_scope||"unknown",Ze=Lu(V,t),re=Qo(V,t),Me=V==="claude"||V==="c\
laude_cli"?Eu:V==="codex_cli"?Fu:V==="cursor_cli"?Hu:V==="antigravity"||V==="antigravity_panel"?Gf:V==="gemini"?Wf:[];t?.
available_models&&Array.isArray(t.available_models)&&t.available_models.length>0&&(Me=t.available_models.map(F=>typeof F==
"string"?{id:F,label:F}:F)),React.useEffect(()=>{h&&s(h)},[h]);function B(F){!F||F===(be?ue:Z)||a(h,F)}function ne(F){!F||
F===D||c(h,F)}function xe(F){!F||F===(be?Le:we)||i&&i(h,F)}function He(F){!F||F===E||f&&f(h,F)}function Et(F){W!==!!F&&u&&
u(h,!!F)}function mn(F,Ct=!1){if(!(!F||F===t?.permission_profile)){if(F==="full-access"&&!Ct){w(!0);return}F==="full-acc\
ess"&&d(t?.permission_profile&&t.permission_profile!=="full-access"?t.permission_profile:"auto"),w(!1),_?.({permission_profile:F,
...Ct?{confirm_bypass:!0}:{}})}}return React.createElement("div",{className:"settings-panel"},React.createElement("div",
{className:"settings-panel-header"},React.createElement("span",null,"Session Settings"),React.createElement("button",{className:"\
settings-panel-close",onClick:S,title:"Close"},"\u2715")),React.createElement("div",{className:"settings-panel-body"},V===
"codex_cli"&&React.createElement("div",{className:"settings-row","data-testid":"codex-live-owner-status"},React.createElement(
"span",{className:"settings-label"},"Live owner"),React.createElement("span",{className:`settings-value${["multiple","st\
ale","unavailable"].includes(ce?.state)?" error":""}`,title:fe},me)),V==="codex_cli"&&React.createElement("div",{className:"\
settings-row","data-testid":"codex-headless-send-mode"},React.createElement("span",{className:"settings-label"},"Remote \
sends"),React.createElement("span",{className:"settings-value",title:t?.send_execution_detail},t?.send_execution_label||
"Headless / out-of-process"),React.createElement("span",{className:"settings-value small"},"Interactive TUI may stay idl\
e")),de&&React.createElement("div",{className:"settings-rl-banner"},React.createElement("span",{className:"settings-rl-i\
con"},"\u26A0"),React.createElement("span",{className:"settings-rl-text"},"Rate limited",de!=="unknown"?React.createElement(
React.Fragment,null," \u2014 available after ",React.createElement("strong",null,de)):React.createElement(React.Fragment,
null," \u2014 reset time unknown"))),React.createElement("div",{className:"settings-row"},React.createElement("span",{className:"\
settings-label"},be?"Observed model":"Model"),React.createElement("div",{className:"settings-model-wrap"},be?React.createElement(
"span",{className:`settings-value${Z==="unknown"?" dim":""}`,title:t?.model_provenance?.source||"No exact native metadat\
a observed"},Z):he.set_model&&Me.length>0?React.createElement("select",{className:"settings-perm-select",value:Z,disabled:A(
N),onChange:F=>B(F.target.value)},Me.map(F=>React.createElement("option",{key:F.id,value:F.id},F.label)),V!=="antigravit\
y"&&V!=="gemini"&&!Me.some(F=>F.id===Z)&&Z!=="unknown"&&React.createElement("option",{value:Z},Z)):React.createElement("\
span",{className:`settings-value${Z==="unknown"?" dim":""}`},Z),de&&React.createElement("span",{className:"model-rl-badg\
e",title:`Rate limited${de!=="unknown"?` \u2014 resets at ${de}`:""}`},"\u26A0")),N?.status==="ok"&&React.createElement(
"span",{className:"settings-inline-ok"},"Saved")),be&&he.set_model&&Me.length>0&&React.createElement("div",{className:"s\
ettings-row"},React.createElement("span",{className:"settings-label"},"Next send model"),React.createElement("select",{className:"\
settings-perm-select",value:ue,disabled:A(N),onChange:F=>B(F.target.value)},React.createElement("option",{value:"",disabled:!0},
"Choose model\u2026"),Me.map(F=>React.createElement("option",{key:F.id,value:F.id},F.label))),React.createElement("span",
{className:`settings-value small${t?.next_send_model_status==="failed"?" error":""}`},t?.next_send_model_status||"unset")),
(V==="antigravity"||V==="antigravity_panel")&&Ae.length>0&&React.createElement("div",{className:"settings-row",style:{alignItems:"\
flex-start"}},React.createElement("span",{className:"settings-label"},"Quotas"),React.createElement("div",{style:{display:"\
flex",flexDirection:"column",gap:6,flex:1,minWidth:0}},e?.available_ai_credits!=null&&React.createElement("span",{className:"\
settings-value"},"AI credits: ",e.available_ai_credits),React.createElement("div",{style:{display:"flex",flexWrap:"wrap",
gap:6}},Ae.map((F,Ct)=>{let Vt=F?.percent_used,Sn=Df(F?.model),Wn=Vt>=90?"#f85149":Vt>=75?"#d29922":"#8b949e",zn=!!X&&X===
F?.model;return React.createElement("span",{key:F?.model||`quota-${Ct}`,className:"composer-hint",title:F?.refreshes_in?
`${F.model} \xB7 resets in ${F.refreshes_in}`:F?.model||"",style:{color:Wn,border:`1px solid ${zn?Wn:"#30363d"}`,borderRadius:999,
padding:"2px 8px",background:zn?`${Wn}18`:"rgba(110,118,129,0.08)"}},Sn," ",Vt!=null?`${Vt}%`:"n/a")})))),(V==="antigrav\
ity"||V==="antigravity_panel")&&React.createElement("div",{className:"settings-row"},React.createElement("span",{className:"\
settings-label"},"Mode"),React.createElement("select",{className:"settings-perm-select",value:E==="unknown"?"Planning":E,
disabled:A(Y),onChange:F=>He(F.target.value)},Uu.map(F=>React.createElement("option",{key:F.id,value:F.id},F.label))),Y?.
status==="ok"&&React.createElement("span",{className:"settings-inline-ok"},"Saved")),Jo(V)&&he.set_mode&&re.length>0&&React.
createElement("div",{className:"settings-row"},React.createElement("span",{className:"settings-label"},"Mode"),React.createElement(
"select",{className:"settings-perm-select",value:E==="unknown"?re[0].id:E,disabled:A(Y),onChange:F=>He(F.target.value)},
re.map(F=>React.createElement("option",{key:F.id,value:F.id},F.label)),E!=="unknown"&&!re.some(F=>F.id===E)&&React.createElement(
"option",{value:E},E)),Y?.status==="ok"&&React.createElement("span",{className:"settings-inline-ok"},"Saved")),(V==="cla\
ude"||V==="claude_cli"||V==="codex_cli"||V==="cursor_cli"||V==="continue_yolo"||Jo(V))&&React.createElement("div",{className:"\
settings-row"},React.createElement("span",{className:"settings-label"},"Permission mode"),he.permission_mode_change&&Ze.
length>0?React.createElement("select",{className:"settings-perm-select",value:D==="unknown"?Uf(V):D,disabled:A($),onChange:F=>ne(
F.target.value)},Ze.map(F=>React.createElement("option",{key:F.value,value:F.value},F.label)),!Ze.some(F=>F.value===D)&&
D!=="unknown"&&React.createElement("option",{value:D},D)):React.createElement("span",{className:`settings-value${D==="un\
known"?" dim":""}`},D),$?.status==="ok"&&React.createElement("span",{className:"settings-inline-ok"},"Saved")),V==="code\
x_cli"&&t?.approval_policy&&React.createElement("div",{className:"settings-row"},React.createElement("span",{className:"\
settings-label"},"Approval policy"),React.createElement("span",{className:"settings-value"},t.approval_policy)),V==="cla\
ude"&&we&&we!=="unknown"&&React.createElement("div",{className:"settings-row"},React.createElement("span",{className:"se\
ttings-label"},"Effort"),React.createElement("span",{className:"settings-value"},((t?.available_efforts||[]).find(F=>F.id===
we)||{}).label||we)),(V==="claude_cli"||V==="codex_cli"||V==="cursor_cli")&&he.set_effort&&(t?.available_efforts||[]).length>
0&&React.createElement("div",{className:"settings-row"},React.createElement("span",{className:"settings-label"},be?"Obse\
rved effort":"Effort"),be?React.createElement("span",{className:`settings-value${!we||we==="unknown"?" dim":""}`,title:t?.
effort_provenance?.source||"No exact native metadata observed"},we||"unknown"):React.createElement("select",{className:"\
settings-perm-select",value:we||"medium",disabled:A(x),onChange:F=>xe(F.target.value)},(t.available_efforts||[]).map(F=>React.
createElement("option",{key:F.id,value:F.id},F.label))),x?.status==="ok"&&React.createElement("span",{className:"setting\
s-inline-ok"},"Saved")),be&&he.set_effort&&(t?.available_efforts||[]).length>0&&React.createElement("div",{className:"se\
ttings-row"},React.createElement("span",{className:"settings-label"},"Next send effort"),React.createElement("select",{className:"\
settings-perm-select",value:Le,disabled:A(x),onChange:F=>xe(F.target.value)},React.createElement("option",{value:"",disabled:!0},
"Choose effort\u2026"),(t.available_efforts||[]).map(F=>React.createElement("option",{key:F.id,value:F.id},F.label))),React.
createElement("span",{className:`settings-value small${t?.next_send_effort_status==="failed"?" error":""}`},t?.next_send_effort_status&&
t.next_send_effort_status!=="unset"?t.next_send_effort_status:"No override selected")),(V==="codex"||V==="codex-desktop")&&
he.set_codex_config&&React.createElement(React.Fragment,null,he.codex_model_change&&(t?.available_models||[]).length>0&&
React.createElement("div",{className:"settings-row"},React.createElement("span",{className:"settings-label"},ee?"Next tu\
rn model":"Model"),React.createElement("select",{className:"settings-perm-select",value:t?.model_id||"unknown",disabled:A(
N)||!Se,onChange:F=>{_?.({model_id:F.target.value})}},(t?.available_models||[]).map(F=>React.createElement("option",{key:F.
id,value:F.id},F.label)),t?.model_id&&!(t?.available_models||[]).some(F=>F.id===t.model_id)&&t.model_id!=="unknown"&&React.
createElement("option",{value:t.model_id},t.model_id)),N?.status==="ok"&&React.createElement("span",{className:"settings\
-inline-ok"},"Saved")),he.codex_effort_change&&(t?.available_efforts||[]).length>0&&React.createElement("div",{className:"\
settings-row"},React.createElement("span",{className:"settings-label"},ee?"Next turn effort":"Effort"),React.createElement(
"select",{className:"settings-perm-select",value:(t?.effort||"unknown").toLowerCase(),disabled:A(x)||!Se,onChange:F=>{_?.(
{effort:F.target.value})}},(t?.available_efforts||[]).map(F=>React.createElement("option",{key:F.id,value:F.id},F.label))),
x?.status==="ok"&&React.createElement("span",{className:"settings-inline-ok"},"Saved")),he.codex_permission_profile_change&&
(t?.available_permission_profiles||[]).length>0&&React.createElement("div",{className:"settings-row"},React.createElement(
"span",{className:"settings-label"},"Next turn permissions"),React.createElement("select",{className:"settings-perm-sele\
ct",value:t?.permission_profile||"unknown",disabled:A(ge)||!Se,onChange:F=>mn(F.target.value)},(t?.available_permission_profiles||
[]).map(F=>React.createElement("option",{key:F.id,value:F.id},F.label))),ge?.status==="ok"&&React.createElement("span",{
className:"settings-inline-ok"},"Saved")),T&&React.createElement("div",{className:"settings-bypass-confirmation",role:"a\
lert"},React.createElement("strong",null,"Enable Bypass permissions?"),React.createElement("span",null,"Full access sets\
 approval policy to Never and sandbox access to danger-full-access for this Codex conversation."),React.createElement("d\
iv",{className:"settings-bypass-actions"},React.createElement("button",{type:"button",onClick:()=>w(!1)},"Cancel"),React.
createElement("button",{type:"button",className:"danger",onClick:()=>mn("full-access",!0)},"Enable Full access"))),ee&&t?.
bypass_permissions_active&&(M||t?.bypass_restore_profile)&&React.createElement("div",{className:"settings-row"},React.createElement(
"span",{className:"settings-label"},"Bypass permissions"),React.createElement("button",{type:"button",className:"setting\
s-restore-safe",disabled:A(ge),onClick:()=>mn(M||t.bypass_restore_profile)},"Restore previous safe permissions")),ee&&React.
createElement(React.Fragment,null,React.createElement("div",{className:"settings-row"},React.createElement("span",{className:"\
settings-label"},"Approval policy"),React.createElement("span",{className:"settings-value"},t?.approval_policy||"Native \
custom policy")),React.createElement("div",{className:"settings-row"},React.createElement("span",{className:"settings-la\
bel"},"Access / sandbox"),React.createElement("span",{className:"settings-value"},t?.permission_mode||"Native custom acc\
ess")),!Se&&React.createElement("div",{className:"settings-control-unavailable",role:"status"},t?.controls_unavailable_reason||
"Codex controls are unavailable for this conversation.")),he.codex_access_change&&(t?.available_access||[]).length>0&&React.
createElement("div",{className:"settings-row"},React.createElement("span",{className:"settings-label"},"Access"),React.createElement(
"select",{className:"settings-perm-select",value:t?.permission_mode||"unknown",disabled:A(ie),onChange:F=>{_?.({access_mode:F.
target.value})}},(t?.available_access||[]).map(F=>React.createElement("option",{key:F.id,value:F.id},F.label)))),he.codex_speed_change&&
(t?.available_speeds||[]).length>0&&React.createElement("div",{className:"settings-row"},React.createElement("span",{className:"\
settings-label"},"Speed"),React.createElement("select",{className:"settings-perm-select",value:(t?.speed||"standard").toLowerCase(),
disabled:A(te),onChange:F=>{_?.({speed:F.target.value})}},(t?.available_speeds||[]).map(F=>React.createElement("option",
{key:F.id,value:F.id},F.label)))),V==="codex-desktop"&&t?.branch&&t.branch!=="unknown"&&React.createElement("div",{className:"\
settings-row"},React.createElement("span",{className:"settings-label"},"Branch"),React.createElement("span",{className:"\
settings-value"},t.branch)),V==="codex-desktop"&&t?.sandbox_status&&React.createElement("div",{className:"settings-row"},
React.createElement("span",{className:"settings-label"},"Sandbox"),React.createElement("span",{className:`settings-value${t.
sandbox_status.active?"":" dim"}`},t.sandbox_status.active?"\u{1F7E2}":"\u26AA"," ",t.sandbox_status.label||(t.sandbox_status.
active?"Active":"Inactive"))),V==="codex-desktop"&&(t?.available_workspaces||[]).length>0&&React.createElement("div",{className:"\
settings-row"},React.createElement("span",{className:"settings-label"},"Workspace"),React.createElement("select",{className:"\
settings-perm-select",value:t?.file_access_scope||"",disabled:A(z),onChange:F=>{y&&y(h,F.target.value)}},(t.available_workspaces||
[]).map(F=>React.createElement("option",{key:F.id,value:F.path||F.id},F.label)))),_e&&React.createElement("div",{className:"\
settings-row"},React.createElement("span",{className:ae?.status==="failed"?"settings-error":"settings-inline-ok",role:"s\
tatus"},_e))),(V==="codex"||V==="codex-desktop")&&!he.set_codex_config&&React.createElement("div",{className:"settings-r\
ow"},React.createElement("span",{className:"settings-label"},"Access"),React.createElement("span",{className:`settings-v\
alue${D==="unknown"?" dim":""}`},D)),Ru(V)&&t?.mode&&t.mode!=="unknown"&&React.createElement("div",{className:"settings-\
row"},React.createElement("span",{className:"settings-label"},"Mode"),React.createElement("span",{className:"settings-va\
lue"},t.mode)),he.auto_approve_permissions_toggle&&React.createElement("div",{className:"settings-row settings-row-check\
box"},React.createElement("span",{className:"settings-label"},"Tool Prompts"),React.createElement("label",{className:"se\
ttings-checkbox"},React.createElement("input",{type:"checkbox",checked:W,disabled:A(O),onChange:F=>Et(F.target.checked)}),
React.createElement("span",null,"Auto-approve permission prompts")),O?.status==="ok"&&React.createElement("span",{className:"\
settings-inline-ok"},"Saved")),(()=>{let F=Ee!=="unknown"?Ee:e?.workspace_name||e?.window_title||null;return React.createElement(
"div",{className:"settings-row"},React.createElement("span",{className:"settings-label"},"Workspace"),React.createElement(
"span",{className:`settings-value small${F?"":" dim"}`,title:F||""},F?Ee!=="unknown"&&F.split(/[\\/]/).pop()||F:"\u2014"))})(),
_e&&!(V==="codex"||V==="codex-desktop")&&React.createElement("div",{className:ae?.status==="failed"?"settings-error":"se\
ttings-inline-ok",role:"status"},_e)),React.createElement("div",{className:"settings-panel-footer"},React.createElement(
"button",{className:"settings-refresh",onClick:()=>{h&&s(h)}},"\u21BB Refresh")))}function py({chats:e,sessionId:t,onSwitch:n,
onNew:s,onClose:a}){return React.createElement("div",{className:"chat-list-panel"},React.createElement("div",{className:"\
chat-list-header"},React.createElement("span",{className:"chat-list-title"},"Conversations"),React.createElement("button",
{className:"chat-list-new-btn",onClick:s,title:"New conversation"},"+"),React.createElement("button",{className:"chat-li\
st-close-btn",onClick:a,title:"Close"},"\u2715")),React.createElement("div",{className:"chat-list-body"},!e||e.length===
0?React.createElement("div",{className:"chat-list-empty"},"No conversations found"):e.map((i,c)=>React.createElement("bu\
tton",{key:i.id||c,className:`chat-list-item${i.active?" active":""}`,onClick:()=>n(i.id),title:i.title},React.createElement(
"span",{className:"chat-list-item-title"},i.title),i.active&&React.createElement("span",{className:"chat-list-item-activ\
e"},"\u25CF")))))}function Nu({items:e,onNavigate:t,onNew:n,onClose:s,embedded:a=!1,loading:i=!1}){let c=Array.isArray(e)?
e:[],u=c.filter(g=>g?.kind==="nav"),f=c.filter(g=>g?.kind==="project"),_=c.filter(g=>!g?.kind||g.kind==="chat"),y=c.filter(
g=>g?.kind==="see_all"),S=[],T=new Map;f.forEach(g=>{let A=g.project_index!=null?`idx:${g.project_index}`:`name:${g.project||
g.title||"Project"}`;T.has(A)||(S.push(A),T.set(A,g.title||g.project||"Project"))}),_.forEach(g=>{let A=g.project_index!=
null?`idx:${g.project_index}`:`name:${g.project||"Other"}`;T.has(A)||(S.push(A),T.set(A,g.project||"Other"))});let w=_.filter(
g=>g.project_index==null&&!g.project);function M(g){return g==="new_conversation"?"New Conversation":g==="conversation_h\
istory"?"Conversation History":g==="scheduled_tasks"?"Scheduled Tasks":"Agent Manager"}function d(g,A){return React.createElement(
"button",{key:g.id||A,className:`agv2-chat-item${g.active?" active":""}`,type:"button",onClick:()=>t(g.id),title:g.title||
"Untitled"},React.createElement("span",{className:"agv2-chat-title"},g.title||"Untitled"),g.age&&React.createElement("sp\
an",{className:"agv2-chat-age"},g.age),g.active&&React.createElement("span",{className:"agv2-chat-active"},"\u25CF"))}let h=React.
createElement(React.Fragment,null,React.createElement("div",{className:"agv2-nav-actions"},(u.length?u:[{id:"__agv2:new_\
conversation",action:"new_conversation"},{id:"__agv2:conversation_history",action:"conversation_history"},{id:"__agv2:sc\
heduled_tasks",action:"scheduled_tasks"}]).map(g=>React.createElement("button",{key:g.id||g.action,className:`agv2-nav-a\
ction ${g.action||""}`,type:"button",onClick:()=>g.action==="new_conversation"?n():t(g.id)},React.createElement("span",{
className:"agv2-nav-action-icon"},g.action==="new_conversation"?"+":g.action==="scheduled_tasks"?"\u25F7":"\u21BA"),React.
createElement("span",null,g.title||M(g.action))))),React.createElement("div",{className:"agv2-project-list"},S.length===
0&&w.length===0?React.createElement("div",{className:"chat-list-empty"},i?"Loading conversations...":"No projects or con\
versations found"):React.createElement(React.Fragment,null,S.map(g=>{let A=T.get(g)||"Project",N=_.filter(x=>(x.project_index!=
null?`idx:${x.project_index}`:`name:${x.project||"Other"}`)===g),$=y.filter(x=>(x.project_index!=null?`idx:${x.project_index}`:
`name:${x.project||"Other"}`)===g);return React.createElement("section",{className:"agv2-project-section",key:g},React.createElement(
"div",{className:"agv2-project-header"},React.createElement("span",{className:"agv2-project-icon"},"\u2302"),React.createElement(
"span",{className:"agv2-project-title"},A)),React.createElement("div",{className:"agv2-project-chats"},N.length===0?React.
createElement("div",{className:"agv2-project-empty"},"No visible conversations"):N.map(d),$.map(x=>React.createElement("\
button",{key:x.id,className:"agv2-see-all",type:"button",onClick:()=>t(x.id)},x.title||"See all"))))}),w.length>0&&React.
createElement("section",{className:"agv2-project-section"},React.createElement("div",{className:"agv2-project-header"},React.
createElement("span",{className:"agv2-project-icon"},"\u2302"),React.createElement("span",{className:"agv2-project-title"},
"Other")),React.createElement("div",{className:"agv2-project-chats"},w.map(d))))));return a?React.createElement("div",{className:"\
agv2-nav-embedded"},h):React.createElement("div",{className:"chat-list-panel agv2-nav-panel"},React.createElement("div",
{className:"chat-list-header"},React.createElement("span",{className:"chat-list-title"},"Antigravity Agent Manager"),React.
createElement("button",{className:"chat-list-new-btn",onClick:n,title:"New conversation"},"+"),React.createElement("butt\
on",{className:"chat-list-close-btn",onClick:s,title:"Close"},"\u2715")),React.createElement("div",{className:"chat-list\
-body agv2-nav-body"},h))}function my({threads:e,sessionId:t,onSwitch:n,onNew:s,onClose:a,newLabel:i="New thread"}){return React.
createElement("div",{className:"chat-list-panel"},React.createElement("div",{className:"chat-list-header"},React.createElement(
"span",{className:"chat-list-title"},"Threads"),React.createElement("button",{className:"chat-list-new-btn",onClick:s,title:i},
"+"),React.createElement("button",{className:"chat-list-close-btn",onClick:a,title:"Close"},"\u2715")),React.createElement(
"div",{className:"chat-list-body"},!e||e.length===0?React.createElement("div",{className:"chat-list-empty"},"No threads \
found"):e.map((c,u)=>React.createElement("button",{key:c.cache_key||c.id||u,className:`chat-list-item${c.active?" active":
""}`,onClick:()=>n(c.id),title:c.title},React.createElement("span",{className:"chat-list-item-title"},c.title),c.age&&React.
createElement("span",{className:"chat-list-item-age"},c.age),c.active&&React.createElement("span",{className:"chat-list-\
item-active"},"\u25CF")))))}function fy({threads:e,activeThreadId:t,onSwitch:n,onNew:s,onOpenHistory:a,showDraftTab:i=!1,
newLabel:c="New chat"}){return React.createElement("div",{className:"thread-tabs-bar"},React.createElement("div",{className:"\
thread-tabs-scroll"},i&&React.createElement("button",{className:"thread-tab active draft",type:"button",title:c},React.createElement(
"span",{className:"thread-tab-title"},c)),(e||[]).map((u,f)=>{let _=t?u.id===t:!!u.active;return React.createElement("bu\
tton",{key:u.cache_key||u.id||f,className:`thread-tab${_?" active":""}`,type:"button",title:u.title||"Untitled",onClick:()=>n(
u.id)},React.createElement("span",{className:"thread-tab-title"},u.title||"Untitled"),u.age&&React.createElement("span",
{className:"thread-tab-age"},u.age))})),React.createElement("div",{className:"thread-tabs-actions"},React.createElement(
"button",{className:"thread-tabs-btn",type:"button",onClick:a,title:"Show all threads"},"All"),React.createElement("butt\
on",{className:"thread-tabs-btn accent",type:"button",onClick:s,title:c},"+")))}function gy({branchData:e,sessionId:t,currentBranch:n,
onSwitch:s,onCreate:a,onClose:i}){let[c,u]=React.useState(""),[f,_]=React.useState(!1),[y,S]=React.useState(""),T=e?.branches||
[],w=e?.current||n||"",M=c?T.filter(d=>d.toLowerCase().includes(c.toLowerCase())):T;return React.createElement("div",{className:"\
branch-selector-panel"},React.createElement("div",{className:"branch-selector-header"},React.createElement("span",{className:"\
branch-selector-title"},"Branches"),React.createElement("button",{className:"chat-list-close-btn",onClick:i,title:"Close"},
"\u2715")),React.createElement("div",{className:"branch-selector-search"},React.createElement("input",{type:"text",className:"\
branch-search-input",placeholder:"Search branches\u2026",value:c,onChange:d=>u(d.target.value),autoFocus:!0})),React.createElement(
"div",{className:"branch-selector-body"},M.length===0&&!f&&React.createElement("div",{className:"chat-list-empty"},"No b\
ranches found"),M.map((d,h)=>React.createElement("button",{key:d,className:`branch-item${d===w?" active":""}`,onClick:()=>{
d!==w&&s(d)},title:d},React.createElement("span",{className:"branch-item-icon"},d===w?"\u2713":""),React.createElement("\
span",{className:"branch-item-name"},d)))),React.createElement("div",{className:"branch-selector-footer"},f?React.createElement(
"form",{className:"branch-create-form",onSubmit:d=>{d.preventDefault(),y.trim()&&(a(y.trim()),_(!1),S(""))}},React.createElement(
"input",{type:"text",className:"branch-create-input",placeholder:"new-branch-name",value:y,onChange:d=>S(d.target.value),
autoFocus:!0}),React.createElement("button",{type:"submit",className:"branch-create-submit",disabled:!y.trim()},"Create"),
React.createElement("button",{type:"button",className:"branch-create-cancel",onClick:()=>{_(!1),S("")}},"\u2715")):React.
createElement("button",{className:"branch-create-btn",onClick:()=>_(!0)},"+ Create and checkout new branch")))}function hy({
entries:e,canRead:t,canInput:n,onClose:s,onRefresh:a,onSend:i,controlResults:c}){let[u,f]=le(""),[_,y]=le(null),S=_?c?.[_]:
null;function T(w){w.preventDefault();let M=u.trim();!M||!i||(y(i(M)),f(""))}return React.createElement("div",{className:"\
terminal-viewer"},React.createElement("div",{className:"terminal-viewer-header"},React.createElement("span",{className:"\
terminal-viewer-title"},"Terminal"),t&&React.createElement("button",{className:"terminal-viewer-refresh",onClick:a,title:"\
Refresh"},"\u21BB"),React.createElement("button",{className:"terminal-viewer-close",onClick:s,title:"Close"},"\u2715")),
t?React.createElement("div",{className:"terminal-viewer-body"},!e||e.length===0?React.createElement("div",{className:"te\
rminal-viewer-empty"},"No terminal output captured"):e.map((w,M)=>React.createElement("div",{key:M,className:"terminal-e\
ntry"},w.command&&React.createElement("div",{className:"terminal-command"},"$ ",w.command),React.createElement("pre",{className:"\
terminal-output"},w.output)))):React.createElement("div",{className:"terminal-viewer-empty"},"Terminal output is unavail\
able for this harness."),n&&React.createElement("form",{className:"terminal-input-form",onSubmit:T},React.createElement(
"input",{className:"terminal-input",type:"text",value:u,onChange:w=>f(w.target.value),placeholder:"Enter a command in th\
is session's terminal","aria-label":"Terminal command"}),React.createElement("button",{className:"terminal-input-send",type:"\
submit",disabled:!u.trim()},"Run"),_&&React.createElement("div",{className:`terminal-input-status ${S?.result||"pending"}`,
role:"status"},S?S.result==="ok"?"Command sent":`Command failed: ${S.error?.message||S.error?.code||"unknown error"}`:"C\
ommand pending\u2026")))}function _y({entries:e,onClose:t,onRefresh:n,onAccept:s,onReject:a}){let i=c=>{let u=String(c||
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
React.createElement("div",{className:"diff-file-summary"},i(c.summary).map((f,_)=>React.createElement("span",{key:_,className:`\
diff-file-summary-chip diff-file-summary-chip-${f.cls}`},f.text))),c.content?React.createElement("pre",{className:"diff-\
content"},c.content.split(`
`).map((f,_)=>{let y=f.startsWith("+")?"diff-add":f.startsWith("-")?"diff-del":f.startsWith("@@")?"diff-hunk":"";return React.
createElement("span",{key:_,className:y},f,`
`)})):!c.summary&&React.createElement("pre",{className:"diff-content"},"No content")))))}var Cu={directory:"\u{1F4C1}",md:"\
\u{1F4C4}",txt:"\u{1F4C4}",json:"\u{1F4CB}",js:"\u{1F4DC}",jsx:"\u{1F4DC}",ts:"\u{1F4DC}",tsx:"\u{1F4DC}",py:"\u{1F40D}",
html:"\u{1F310}",css:"\u{1F3A8}",yml:"\u2699",yaml:"\u2699",toml:"\u2699",sh:"\u26A1",bat:"\u26A1",ps1:"\u26A1",env:"\u{1F512}",
lock:"\u{1F512}",png:"\u{1F5BC}",jpg:"\u{1F5BC}",gif:"\u{1F5BC}",svg:"\u{1F5BC}",default:"\u{1F4C4}"};function by(e){if(e.
type==="directory")return Cu.directory;let t=e.name.split(".").pop().toLowerCase();return Cu[t]||Cu.default}function vy(e){
return e==null?"":e<1024?`${e} B`:e<1024*1024?`${(e/1024).toFixed(1)} KB`:`${(e/(1024*1024)).toFixed(1)} MB`}var yy=new Set(
["md","txt","json","js","jsx","ts","tsx","py","html","css","yml","yaml","toml","sh","bat","ps1","cfg","conf","ini","xml",
"csv","log","env","gitignore","dockerignore","sql","rs","go","java","c","cpp","h","hpp","rb","php","swift","kt","scala",
"r","lua","vim","zsh","bash","fish"]);function xf(e){let t=e.split(".").pop().toLowerCase();return yy.has(t)||e.startsWith(
".")}function ky(e){return e.toLowerCase().endsWith(".md")}function wy({path:e,content:t,truncated:n,onBack:s}){let a=React.
useMemo(()=>{if(!t)return"";try{let u=marked.parse(t);return DOMPurify.sanitize(u)}catch{return`<pre>${DOMPurify.sanitize(
t)}</pre>`}},[t]),i=React.useRef(null);React.useEffect(()=>{i.current&&i.current.querySelectorAll("pre code").forEach(u=>{
hljs.highlightElement(u)})},[a]);let c=e?e.split("/").pop().split("\\").pop():"File";return React.createElement("div",{className:"\
file-viewer"},React.createElement("div",{className:"file-viewer-header"},React.createElement("button",{className:"file-v\
iewer-back",onClick:s,title:"Back to files"},"\u2190"),React.createElement("span",{className:"file-viewer-title",title:e},
c),n&&React.createElement("span",{className:"file-viewer-truncated"},"truncated")),React.createElement("div",{className:"\
file-viewer-body markdown-body",ref:i,dangerouslySetInnerHTML:{__html:a}}))}function Sy({path:e,content:t,truncated:n,onBack:s}){
let a=e?e.split("/").pop().split("\\").pop():"File",i=a.split(".").pop().toLowerCase(),c=React.useMemo(()=>{if(!t)return"";
try{return i&&hljs.getLanguage(i)?hljs.highlight(t,{language:i}).value:hljs.highlightAuto(t).value}catch{return DOMPurify.
sanitize(t)}},[t,i]);return React.createElement("div",{className:"file-viewer"},React.createElement("div",{className:"fi\
le-viewer-header"},React.createElement("button",{className:"file-viewer-back",onClick:s,title:"Back to files"},"\u2190"),
React.createElement("span",{className:"file-viewer-title",title:e},a),n&&React.createElement("span",{className:"file-vie\
wer-truncated"},"truncated")),React.createElement("div",{className:"file-viewer-body"},React.createElement("pre",{className:"\
file-viewer-code"},React.createElement("code",{dangerouslySetInnerHTML:{__html:c}}))))}function Ny(e,t){let n=Br(e||"text"),s=Math.max(...String(t||"").match(/`+/g)?.map(i=>i.length)||[0]),a="`".repeat(Math.
max(3,s+1));return`${a}${n}
${t||""}
${a}`}function Cy({sessionId:e,filePath:t,fileContents:n,onClose:s}){let a=`${e}:${t}`,i=n[a],c=i?.content||"",u=i?.truncated||
!1,f=React.useMemo(()=>Ny(t,c),[t,c]);return React.createElement("div",{className:"transcript-inline-preview"},React.createElement(
"div",{className:"transcript-inline-preview-header"},React.createElement("span",{className:"transcript-inline-preview-ti\
tle",title:t},t),u&&React.createElement("span",{className:"file-viewer-truncated"},"truncated"),React.createElement("but\
ton",{className:"transcript-inline-preview-close",onClick:s,title:"Collapse"},"Collapse")),i?React.createElement(Gr,{content:f,
monospace:!0}):React.createElement("div",{className:"transcript-file-loading"},React.createElement("div",null,"Loading f\
ile preview...")))}function xy({sessionId:e,listing:t,fileContents:n,onNavigate:s,onOpenFile:a,onClose:i,onRefresh:c,viewingFile:u,
onBackToListing:f}){if(u){let T=`${e}:${u}`,w=n[T],M=w?.content||"",d=w?.truncated||!1;return ky(u)?React.createElement(
wy,{path:u,content:M,truncated:d,onBack:f}):React.createElement(Sy,{path:u,content:M,truncated:d,onBack:f})}let _=t?.entries||
[],y=t?.path||".",S=y==="."?[]:y.replace(/\\/g,"/").split("/").filter(Boolean);return React.createElement("div",{className:"\
file-browser"},React.createElement("div",{className:"file-browser-header"},React.createElement("span",{className:"file-b\
rowser-title"},"Files"),React.createElement("button",{className:"file-browser-refresh",onClick:c,title:"Refresh"},"\u21BB"),
React.createElement("button",{className:"file-browser-close",onClick:i,title:"Close"},"\u2715")),React.createElement("di\
v",{className:"file-browser-breadcrumbs"},React.createElement("button",{className:"breadcrumb-item",onClick:()=>s(".")},
"root"),S.map((T,w)=>{let M=S.slice(0,w+1).join("/");return React.createElement(React.Fragment,{key:M},React.createElement(
"span",{className:"breadcrumb-sep"},"/"),React.createElement("button",{className:"breadcrumb-item",onClick:()=>s(M)},T))})),
React.createElement("div",{className:"file-browser-body"},_.length===0?React.createElement("div",{className:"file-browse\
r-empty"},"Empty directory"):React.createElement("div",{className:"file-browser-list"},y!=="."&&React.createElement("div",
{className:"file-browser-entry",onClick:()=>{let T=S.slice(0,-1).join("/")||".";s(T)}},React.createElement("span",{className:"\
file-entry-icon"},"\u{1F4C1}"),React.createElement("span",{className:"file-entry-name"},"..")),_.map(T=>React.createElement(
"div",{key:T.name,className:`file-browser-entry${T.type==="directory"?" is-dir":""}${xf(T.name)?" is-viewable":""}`,onClick:()=>{
if(T.type==="directory"){let w=y==="."?T.name:`${y}/${T.name}`;s(w)}else if(xf(T.name)){let w=y==="."?T.name:`${y}/${T.name}`;
a(w)}}},React.createElement("span",{className:"file-entry-icon"},by(T)),React.createElement("span",{className:"file-entr\
y-name"},T.name),React.createElement("span",{className:"file-entry-meta"},T.type==="file"&&vy(T.size)))))))}var Ay={daily:"\
Daily",weekdays:"Weekdays",weekly:"Weekly",custom:"Custom"},Iu={"Status reports":"\u{1F4CA}","Release prep":"\u{1F680}",
"Code quality":"\u{1F50D}",Documentation:"\u{1F4DD}",General:"\u2699"};function Ry({automation:e,onEdit:t,onRun:n,onToggle:s}){
let a=Iu[e.category]||"\u2699",i=Ay[e.schedule]||e.schedule,c=Gn[e.target_agent_type]||Au;return React.createElement("di\
v",{className:`automation-card${e.enabled?"":" disabled"}`,onClick:()=>t(e)},React.createElement("div",{className:"autom\
ation-card-icon"},a),React.createElement("div",{className:"automation-card-body"},React.createElement("div",{className:"\
automation-card-name"},e.name),e.description&&React.createElement("div",{className:"automation-card-desc"},e.description)),
React.createElement("div",{className:"automation-card-meta"},React.createElement("span",{className:"automation-card-agen\
t",style:{color:c.color},title:c.name},c.abbr),React.createElement("span",{className:"automation-card-schedule"},i," ",String(
e.cron_hour).padStart(2,"0"),":",String(e.cron_minute).padStart(2,"0"))),React.createElement("div",{className:"automatio\
n-card-actions",onClick:u=>u.stopPropagation()},React.createElement("button",{className:"automation-run-btn",title:"Run \
now",onClick:()=>n(e)},"\u25B6"),React.createElement("button",{className:`automation-toggle-btn${e.enabled?" on":""}`,title:e.
enabled?"Disable":"Enable",onClick:()=>s(e)},e.enabled?"\u25CF":"\u25CB")))}function My({automation:e,sessions:t,onSave:n,
onDelete:s,onClose:a}){let i=!e?.id,[c,u]=le({name:e?.name||"",description:e?.description||"",category:e?.category||"Gen\
eral",prompt:e?.prompt||"",schedule:e?.schedule||"daily",cron_hour:e?.cron_hour??9,cron_minute:e?.cron_minute??0,cron_days:e?.
cron_days||[1,2,3,4,5],target_agent_type:e?.target_agent_type||"claude",target_session:e?.target_session||"",enabled:e?.
enabled!==!1}),[f,_]=le(!1);function y(M,d){u(h=>({...h,[M]:d}))}function S(M){u(d=>{let h=d.cron_days.includes(M)?d.cron_days.
filter(g=>g!==M):[...d.cron_days,M].sort();return{...d,cron_days:h}})}async function T(M){M.preventDefault(),!(!c.name.trim()||
!c.prompt.trim())&&(_(!0),await n({...c,target_session:c.target_session||null}),_(!1))}let w=["Sun","Mon","Tue","Wed","T\
hu","Fri","Sat"];return React.createElement("div",{className:"automation-modal-overlay",onClick:a},React.createElement("\
div",{className:"automation-modal",onClick:M=>M.stopPropagation()},React.createElement("div",{className:"automation-moda\
l-header"},React.createElement("span",null,i?"New Automation":"Edit Automation"),React.createElement("button",{className:"\
automation-modal-close",onClick:a},"\u2715")),React.createElement("form",{className:"automation-modal-form",onSubmit:T},
React.createElement("label",null,React.createElement("span",null,"Name"),React.createElement("input",{type:"text",value:c.
name,onChange:M=>y("name",M.target.value),placeholder:"e.g. Daily standup summary",required:!0})),React.createElement("l\
abel",null,React.createElement("span",null,"Description"),React.createElement("input",{type:"text",value:c.description,onChange:M=>y(
"description",M.target.value),placeholder:"Brief description (optional)"})),React.createElement("label",null,React.createElement(
"span",null,"Category"),React.createElement("select",{value:c.category,onChange:M=>y("category",M.target.value)},Object.
keys(Iu).map(M=>React.createElement("option",{key:M,value:M},Iu[M]," ",M)))),React.createElement("label",null,React.createElement(
"span",null,"Prompt"),React.createElement("textarea",{rows:4,value:c.prompt,onChange:M=>y("prompt",M.target.value),placeholder:"\
The prompt to send to the agent...",required:!0})),React.createElement("div",{className:"automation-modal-row"},React.createElement(
"label",{className:"half"},React.createElement("span",null,"Target Agent"),React.createElement("select",{value:c.target_agent_type,
onChange:M=>y("target_agent_type",M.target.value)},Object.entries(Gn).map(([M,d])=>React.createElement("option",{key:M,value:M},
d.name)))),React.createElement("label",{className:"half"},React.createElement("span",null,"Specific Session (optional)"),
React.createElement("select",{value:c.target_session,onChange:M=>y("target_session",M.target.value)},React.createElement(
"option",{value:""},"Any matching session"),(t||[]).map(M=>{let d=typeof M=="string"?M:M?.session_id,h=to(M);return React.
createElement("option",{key:d,value:d},h.name,": ",zd(d)||d)})))),React.createElement("div",{className:"automation-modal\
-row"},React.createElement("label",{className:"third"},React.createElement("span",null,"Schedule"),React.createElement("\
select",{value:c.schedule,onChange:M=>y("schedule",M.target.value)},React.createElement("option",{value:"daily"},"Daily"),
React.createElement("option",{value:"weekdays"},"Weekdays"),React.createElement("option",{value:"weekly"},"Weekly"),React.
createElement("option",{value:"custom"},"Custom days"))),React.createElement("label",{className:"third"},React.createElement(
"span",null,"Hour"),React.createElement("input",{type:"number",min:0,max:23,value:c.cron_hour,onChange:M=>y("cron_hour",
parseInt(M.target.value)||0)})),React.createElement("label",{className:"third"},React.createElement("span",null,"Minute"),
React.createElement("input",{type:"number",min:0,max:59,value:c.cron_minute,onChange:M=>y("cron_minute",parseInt(M.target.
value)||0)}))),(c.schedule==="custom"||c.schedule==="weekly")&&React.createElement("div",{className:"automation-days-row"},
React.createElement("span",null,"Days:"),w.map((M,d)=>React.createElement("button",{key:d,type:"button",className:`autom\
ation-day-btn${c.cron_days.includes(d)?" active":""}`,onClick:()=>S(d)},M))),React.createElement("div",{className:"autom\
ation-modal-footer"},!i&&React.createElement("button",{type:"button",className:"automation-delete-btn",onClick:()=>s(e)},
"Delete"),React.createElement("div",{style:{flex:1}}),React.createElement("button",{type:"button",className:"automation-\
cancel-btn",onClick:a},"Cancel"),React.createElement("button",{type:"submit",className:"automation-save-btn",disabled:f||
!c.name.trim()||!c.prompt.trim()},f?"Saving...":i?"Create":"Save")))))}function Ty({sessions:e,onBack:t}){let[n,s]=le([]),
[a,i]=le(!0),[c,u]=le(null),[f,_]=le("");function y(g){_(g),setTimeout(()=>_(""),3e3)}async function S(){try{let g=await fetch(
"/api/automations");if(!g.ok)throw new Error("Failed to fetch");let A=await g.json();s(A.automations||[])}catch{y("Faile\
d to load automations")}finally{i(!1)}}Oe(()=>{S()},[]);async function T(g){let A=!c?.id,N=A?"/api/automations":`/api/au\
tomations/${c.id}`,$=A?"POST":"PUT";try{if(!(await fetch(N,{method:$,headers:{"Content-Type":"application/json"},body:JSON.
stringify(g)})).ok)throw new Error("Save failed");y(A?"Automation created":"Automation updated"),u(null),S()}catch{y("Fa\
iled to save automation")}}async function w(g){if(window.confirm(`Delete "${g.name}"?`))try{await fetch(`/api/automation\
s/${g.id}`,{method:"DELETE"}),y("Automation deleted"),u(null),S()}catch{y("Failed to delete")}}async function M(g){try{let A=await fetch(
`/api/automations/${g.id}/run`,{method:"POST"}),N=await A.json();A.ok?y(`Running "${g.name}"...`):y(N.error||"Failed to \
run")}catch{y("Failed to run automation")}}async function d(g){try{await fetch(`/api/automations/${g.id}`,{method:"PUT",
headers:{"Content-Type":"application/json"},body:JSON.stringify({enabled:!g.enabled})}),S()}catch{y("Failed to toggle")}}
let h={};for(let g of n){let A=g.category||"General";h[A]||(h[A]=[]),h[A].push(g)}return React.createElement("div",{className:"\
automations-view"},React.createElement("div",{className:"automations-header"},React.createElement("button",{className:"a\
utomations-back",onClick:t,title:"Back to sessions"},"\u2190"),React.createElement("div",{className:"automations-header-\
text"},React.createElement("h2",null,"Automations"),React.createElement("p",null,"Automate work by sending scheduled pro\
mpts to your agents.")),React.createElement("button",{className:"automations-new-btn",onClick:()=>u({})},"+ New automati\
on")),a?React.createElement("div",{className:"automations-loading"},"Loading automations..."):n.length===0?React.createElement(
"div",{className:"automations-empty"},React.createElement("div",{className:"automations-empty-icon"},"\u2699"),React.createElement(
"div",{className:"automations-empty-text"},"No automations yet"),React.createElement("div",{className:"automations-empty\
-sub"},"Create your first automation to schedule recurring prompts to your agents."),React.createElement("button",{className:"\
automations-new-btn",onClick:()=>u({})},"+ New automation")):React.createElement("div",{className:"automations-body"},Object.
entries(h).map(([g,A])=>React.createElement("div",{key:g,className:"automations-category"},React.createElement("h3",{className:"\
automations-category-title"},g),React.createElement("div",{className:"automations-card-grid"},A.map(N=>React.createElement(
Ry,{key:N.id,automation:N,onEdit:u,onRun:M,onToggle:d})))))),c!==null&&React.createElement(My,{automation:c?.id?c:null,sessions:e,
onSave:T,onDelete:w,onClose:()=>u(null)}),f&&React.createElement("div",{className:"automations-toast"},f))}function $y({
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
createElement("button",{className:"codex-automation-pane-action",onClick:t},e.action_label))}function Jr(e){return new Intl.
NumberFormat([],{notation:"compact",maximumFractionDigits:1}).format(Math.max(0,Number(e)||0))}function Ey({cost:e,detailState:t,
onRequestDetail:n}){let[s,a]=React.useState(1),[i,c]=React.useState(""),u=React.useMemo(()=>nm(e,{days:s,project:i}),[e,
s,i]),f=t?.status==="ready"?t.detail:null,_=!!f&&Number(f.query?.days)===s&&String(f.query?.project||"")===i&&(!e?.generatedAt||
String(f.generated_at||"")===e.generatedAt),y=t?.status==="loading"&&Number(t.query?.days)===s&&String(t.query?.project||
"")===i&&String(t.query?.cursor||"0")==="0",S=_&&String(f.pagination?.cursor||"0")==="0",T=_?{costUsd:Math.max(0,Number(
f.summary?.cost_usd)||0),records:Math.max(0,Number(f.summary?.records)||0),tokens:{input:Math.max(0,Number(f.summary?.tokens?.
input)||0),cached:Math.max(0,Number(f.summary?.tokens?.cached)||0),output:Math.max(0,Number(f.summary?.tokens?.output)||
0)},byModel:Array.isArray(f.summary?.by_model)?f.summary.by_model:[],byDay:Array.isArray(f.summary?.by_day)?f.summary.by_day:
[]}:u;if(React.useEffect(()=>{!e?.detail?.truncated||!n||y||S||n({days:s,project:i,cursor:"0",pageSize:e.detail.pageSize||
256})},[e?.detail?.truncated,e?.detail?.pageSize,e?.generatedAt,s,i,n]),!e)return null;let w=(["ready","partial","stale"].
includes(e.status)||e.status==="scanning"&&!!e.lastGoodGeneratedAt)&&e.costUsd!=null&&e.records!=null&&e.tokens.input!=null&&
e.tokens.cached!=null&&e.tokens.output!=null,M={"not-started":["Not scanned yet","The local cost scan has not completed."],
idle:["Not scanned yet","The local cost scan has not completed."],scanning:["Scanning local history","Provider quota rem\
ains available while cost files are scanned."],error:["Cost scan unavailable","The last cost payload failed its bounded \
structural contract. Provider quota is still current."],unavailable:["Cost scan unavailable","Local cost sources are una\
vailable. Provider quota is still current."],cancelled:["Cost scan cancelled","No zero total is reported because the sca\
n did not complete."]}[e.status]||["Cost data pending","Waiting for an authoritative local cost scan."];if(!w)return React.
createElement("section",{className:"usage-cost-panel","aria-labelledby":"usage-cost-heading"},React.createElement("div",
{className:"usage-cost-heading"},React.createElement("span",null,React.createElement("h3",{id:"usage-cost-heading"},"Loc\
al estimated API-equivalent cost"),React.createElement("small",null,"Separate from subscription quota")),React.createElement(
"span",{className:`usage-cost-status ${e.status}`},e.status)),React.createElement("div",{className:"usage-cost-state",role:"\
status"},React.createElement("strong",null,M[0]),React.createElement("span",null,M[1]),e.reasonCode&&React.createElement(
"small",null,"Reason: ",e.reasonCode,e.reasonPath?` (${e.reasonPath})`:"")),React.createElement("div",{className:"usage-\
cost-scan"},Number.isFinite(Number(e.scan.files_complete))?`Incremental local JSONL scan - ${e.scan.files_complete}/${e.
scan.files_total||0} files`:"Incremental local JSONL scan has not reported file progress."));let d=[...new Set(e.byProject.
map(N=>N.project).filter(Boolean))].sort(),h=[...T?.byModel||[]].sort((N,$)=>$.cost_usd-N.cost_usd).slice(0,12),g=[...T?.
byDay||[]].sort((N,$)=>N.day.localeCompare($.day)),A=Math.max(1e-6,...g.map(N=>Number(N.cost_usd)||0));return React.createElement(
"section",{className:"usage-cost-panel","aria-labelledby":"usage-cost-heading"},React.createElement("div",{className:"us\
age-cost-heading"},React.createElement("span",null,React.createElement("h3",{id:"usage-cost-heading"},"Local estimated A\
PI-equivalent cost"),React.createElement("small",null,"Separate from subscription quota \xB7 pricing ",e.catalogVersion||
"unavailable")),React.createElement("span",{className:`usage-cost-status ${e.status}`},e.status)),React.createElement("d\
iv",{className:"usage-cost-controls"},React.createElement("label",null,"Range",React.createElement("select",{value:s,onChange:N=>a(
Number(N.target.value))},[1,7,30,90,365].map(N=>React.createElement("option",{key:N,value:N},N===1?"Today":`${N} days`)))),
React.createElement("label",null,"Project",React.createElement("select",{value:i,onChange:N=>c(N.target.value)},React.createElement(
"option",{value:""},"All projects"),d.map(N=>React.createElement("option",{key:N,value:N},N))))),React.createElement("di\
v",{className:"usage-cost-summary"},React.createElement("span",null,React.createElement("strong",null,"$",(T?.costUsd||0).
toFixed(2)),React.createElement("small",null,"estimated cost")),React.createElement("span",null,React.createElement("str\
ong",null,Jr(T?.tokens.input)),React.createElement("small",null,"input tokens")),React.createElement("span",null,React.createElement(
"strong",null,Jr(T?.tokens.cached)),React.createElement("small",null,"cached tokens")),React.createElement("span",null,React.
createElement("strong",null,Jr(T?.tokens.output)),React.createElement("small",null,"output tokens"))),e.detail?.truncated&&
React.createElement("div",{className:"usage-cost-detail-state",role:"status"},_?`Showing detail rows ${Number(f.pagination?.
cursor||0)+1}-${Number(f.pagination?.cursor||0)+Number(f.pagination?.returned_rows||0)} of ${Number(f.pagination?.total_rows||
0)}.`:t?.status==="error"?"Cost detail is unavailable.":`Loading a bounded detail page for ${e.detail.totalRows} cost-de\
tail rows.`),React.createElement("div",{className:"usage-cost-chart",role:"img","aria-label":`${s}-day estimated cost by\
 day`},(g.length?g:[{day:"No data",cost_usd:0}]).map(N=>React.createElement("span",{key:N.day,title:`${N.day}: $${Number(
N.cost_usd).toFixed(4)}`},React.createElement("i",{style:{height:`${Math.max(3,Number(N.cost_usd)/A*100)}%`}}),React.createElement(
"small",null,N.day.slice(5))))),e.detail?.truncated&&React.createElement("details",{className:"usage-cost-detail-table"},
React.createElement("summary",null,"Cost detail rows"),t?.status==="loading"&&React.createElement("div",{className:"usag\
e-cost-detail-state"},"Loading cost detail\u2026"),t?.status==="error"&&React.createElement("div",{className:"usage-cost\
-detail-state"},"Cost detail unavailable: ",t.error),_&&React.createElement(React.Fragment,null,React.createElement("div",
{className:"usage-cost-detail-pager","aria-label":"Cost detail pagination"},React.createElement("button",{type:"button",
disabled:Number(f.pagination?.cursor||0)<=0,onClick:()=>n({days:s,project:i,cursor:String(Math.max(0,Number(f.pagination.
cursor||0)-Number(f.pagination.page_size||256))),pageSize:f.pagination.page_size||256})},"Previous"),React.createElement(
"span",null,f.pagination.returned_rows," rows \xB7 ",f.pagination.total_rows," total"),React.createElement("button",{type:"\
button",disabled:!f.pagination?.next_cursor,onClick:()=>n({days:s,project:i,cursor:f.pagination.next_cursor,pageSize:f.pagination.
page_size||256})},"Next")),React.createElement("div",{className:"usage-cost-table-wrap"},React.createElement("table",{className:"\
usage-cost-table"},React.createElement("caption",null,"Paginated local cost detail"),React.createElement("thead",null,React.
createElement("tr",null,React.createElement("th",null,"Day"),React.createElement("th",null,"Provider / model"),React.createElement(
"th",null,"Project"),React.createElement("th",null,"Speed"),React.createElement("th",null,"Cost"))),React.createElement(
"tbody",null,(f.rows||[]).map((N,$)=>React.createElement("tr",{key:`${f.pagination.cursor}:${$}`},React.createElement("t\
d",null,N.day),React.createElement("th",{scope:"row"},N.provider_id," \xB7 ",N.model),React.createElement("td",null,N.project),
React.createElement("td",null,N.speed),React.createElement("td",null,"$",Number(N.cost_usd).toFixed(4))))))))),React.createElement(
"div",{className:"usage-cost-table-wrap"},React.createElement("table",{className:"usage-cost-table"},React.createElement(
"caption",null,"Estimated cost and tokens by provider model"),React.createElement("thead",null,React.createElement("tr",
null,React.createElement("th",null,"Provider / model"),React.createElement("th",null,"Input"),React.createElement("th",null,
"Cached"),React.createElement("th",null,"Output"),React.createElement("th",null,"Cost"))),React.createElement("tbody",null,
h.map(N=>React.createElement("tr",{key:`${N.provider_id}:${N.model}`},React.createElement("th",{scope:"row"},N.provider_id===
"openai-codex"?"Codex":"Claude"," \xB7 ",N.model),React.createElement("td",null,Jr(N.input)),React.createElement("td",null,
Jr(N.cached)),React.createElement("td",null,Jr(N.output)),React.createElement("td",null,"$",Number(N.cost_usd).toFixed(4))))))),
e.unknownModels.length>0&&React.createElement("div",{className:"usage-cost-fallbacks"},React.createElement("strong",null,
"Fallback pricing"),e.unknownModels.map(N=>React.createElement("span",{key:`${N.provider_id}:${N.model}`},N.model," \u2192 ",
N.fallback))),React.createElement("div",{className:"usage-cost-scan"},"Incremental local JSONL scan \xB7 ",e.scan.files_complete||
0,"/",e.scan.files_total||0," files \xB7 ",e.records," deduplicated records"))}function Ly({usage:e,refreshReceipt:t,resetReceipt:n,
costDetail:s,onBack:a,onRefresh:i,onWatch:c,onConsumeResetCredit:u,onRequestCostDetail:f}){let _=React.useMemo(()=>nu(e),
[e]),[y,S]=React.useState(Date.now());React.useEffect(()=>{_.collectionState==="not-started"&&i(!1);let d=setInterval(()=>S(
Date.now()),3e4);return()=>clearInterval(d)},[i,_.collectionState]),React.useEffect(()=>(c(!0),()=>c(!1)),[c]);let T=d=>({
fresh:"Fresh",refreshing:"Refreshing",stale:"Stale",auth_required:"Sign in required",rate_limited:"Refresh limited",unavailable:"\
Unavailable"})[d]||"Unavailable",w=_.entries.find(d=>d.providerId==="openai-codex"&&Number(d.resetCredits?.available_count)>
0&&d.windows.some(h=>h.usedPercent>=100)),M=["requested","accepted"].includes(n?.status);return React.createElement("div",
{className:"usage-dashboard","data-testid":"usage-dashboard"},React.createElement("div",{className:"automations-header u\
sage-dashboard-header"},React.createElement("button",{className:"automations-back",onClick:a,title:"Back to sessions"},"\
\u2190"),React.createElement("div",{className:"automations-header-text"},React.createElement("h2",null,"Usage & limits"),
React.createElement("p",null,"Provider-account quotas shared by connected harnesses. Warnings start at 75% used.")),React.
createElement("button",{type:"button",className:"usage-dashboard-refresh",onClick:()=>i(!0),disabled:_.inFlight,"aria-la\
bel":"Refresh provider usage"},_.inFlight?"Refreshing\u2026":"Refresh")),_.collectionState!=="ready"&&React.createElement(
"div",{className:`usage-dashboard-collection-state ${_.collectionState}`,role:"status"},React.createElement("strong",null,
{"not-started":"Provider usage has not been collected yet",refreshing:"Refreshing provider usage",partial:"Some provider\
 usage is unavailable",stale:"Showing last-good provider usage",unavailable:"Provider usage is unavailable"}[_.collectionState]||
"Provider usage is pending"),React.createElement("span",null,"Generation ",_.generation,_.generatedAt?` \xB7 ${tr(_.generatedAt,
y)}`:"")),React.createElement("div",{className:"usage-dashboard-summary","aria-label":"Usage summary"},React.createElement(
"div",null,React.createElement("strong",null,_.summaryAuthoritative?_.summary.providers:"\u2014"),React.createElement("s\
pan",null,"providers")),React.createElement("div",null,React.createElement("strong",null,_.summaryAuthoritative?_.summary.
accounts:"\u2014"),React.createElement("span",null,"accounts")),React.createElement("div",null,React.createElement("stro\
ng",null,_.summaryAuthoritative?_.summary.reporting:"\u2014"),React.createElement("span",null,"reporting")),React.createElement(
"div",{className:_.summary.nearLimit>0?"warning":""},React.createElement("strong",null,_.summaryAuthoritative?_.summary.
nearLimit:"\u2014"),React.createElement("span",null,"near limit")),React.createElement("div",{className:_.summary.exhausted>
0?"critical":""},React.createElement("strong",null,_.summaryAuthoritative?_.summary.exhausted:"\u2014"),React.createElement(
"span",null,"exhausted"))),t&&React.createElement("div",{className:`usage-refresh-receipt ${t.status}`,role:"status"},"R\
efresh ",t.status,t.generation!=null?` \xB7 generation ${t.generation}`:""),w&&React.createElement("div",{className:"usa\
ge-reset-attention",role:"alert","data-testid":"codex-reset-credit-attention"},React.createElement("span",null,React.createElement(
"strong",null,w.resetCredits.available_count," limit reset",w.resetCredits.available_count===1?"":"s"," available \u2014 appl\
y one?"),React.createElement("small",null,"Remote Agent Chat will use Codex's native reset action only after this approv\
al.")),React.createElement("button",{type:"button",onClick:u,disabled:M},M?"Applying\u2026":"Apply one reset")),n&&!["re\
quested"].includes(n.status)&&React.createElement("div",{className:`usage-refresh-receipt ${n.status}`,role:"status","da\
ta-testid":"codex-reset-credit-receipt"},"Reset ",n.status,n.outcome?`: ${n.outcome}`:"",n.error?` (${n.error})`:""),React.
createElement(Ey,{cost:_.estimatedCost,detailState:s,onRequestDetail:f}),React.createElement("div",{className:"usage-das\
hboard-grid"},_.entries.map(d=>{let h=au(d.credits),g=ru(d.financials),A=d.credits?.resets_at?nr(d.credits.resets_at,y):
"",N=t?.provider_id===d.providerId?t:null,$=["requested","accepted","coalesced"].includes(N?.status);return React.createElement(
"details",{open:!0,className:`usage-dashboard-card ${d.tone}`,key:d.key,"data-provider-id":d.providerId,"data-account-fi\
ngerprint":d.accountFingerprint},React.createElement("summary",{className:"usage-dashboard-card-summary"},React.createElement(
bc,{providerId:d.providerId,providerName:d.providerName}),React.createElement("span",{className:"usage-dashboard-card-ti\
tle"},React.createElement("strong",null,d.providerName),React.createElement("span",null,d.accountLabel,d.plan?` \xB7 ${d.
plan}`:"")),React.createElement("span",{className:`usage-dashboard-status ${d.status}`},T(d.status))),React.createElement(
"div",{className:"usage-dashboard-card-body"},React.createElement("div",{className:"usage-dashboard-card-meta"},React.createElement(
"span",null,d.sessionCount," mapped session",d.sessionCount===1?"":"s"),React.createElement("span",null,d.harnessTypes.length>
0?d.harnessTypes.join(", "):"No mapped surfaces"),React.createElement("span",null,d.status==="stale"?`Stale - ${tr(d.capturedAt,
y)}`:tr(d.capturedAt,y)),d.nextRefreshAt&&React.createElement("span",null,"Next refresh ",nr(d.nextRefreshAt,y)),d.refreshIntervalMs>
0&&React.createElement("span",null,d.watchBoostActive?`Live cadence ${Math.round(d.refreshIntervalMs/1e3)}s`:`Idle caden\
ce ${Math.round(d.refreshIntervalMs/1e3)}s`),React.createElement("button",{type:"button",className:"usage-card-refresh",
onClick:()=>i(!0,d.providerId),disabled:$,"aria-label":`Refresh ${d.providerName} usage now`},$?"Refreshing...":"Refresh\
 now")),N&&React.createElement("div",{className:`usage-refresh-receipt ${N.status}`,role:"status"},"Refresh ",N.status,N.
code?` (${N.code})`:"",N.retry_after_ms?` - retry in ${Math.ceil(N.retry_after_ms/1e3)}s`:""),d.windows.length>0?React.createElement(
"div",{className:"usage-dashboard-windows"},d.windows.map(x=>{let O=x.tone,Y=x.resetDescription||nr(x.resetsAt,y);return React.
createElement("div",{className:`usage-dashboard-window ${O}`,key:x.id},React.createElement("div",{className:"usage-dashb\
oard-window-heading"},React.createElement("span",null,React.createElement("strong",null,x.label),x.modelScope?.label?React.
createElement("small",null,"Model: ",x.modelScope.label):x.scope&&x.scope!==x.label?React.createElement("small",null,x.scope):
null),React.createElement("span",null,React.createElement("strong",null,x.remainingPercent==null?"Unavailable":`${dn(x.remainingPercent)}\
 left`),React.createElement("small",null,x.usedPercent==null?"No reported value":`${dn(x.usedPercent)} used`))),x.usedPercent!=
null&&React.createElement("div",{className:"usage-dashboard-meter",role:"progressbar","aria-label":`${d.providerName} ${x.
label}`,"aria-valuetext":`${dn(x.usedPercent)} used`,"aria-valuemin":"0","aria-valuemax":"100","aria-valuenow":Math.round(
x.visualPercent)},React.createElement("span",{style:{width:`${x.visualPercent}%`}})),React.createElement("div",{className:"\
usage-window-thresholds"},"Warning ",dn(x.thresholds.warningPercent)," \xB7 Critical ",dn(x.thresholds.criticalPercent)),
x.pace&&React.createElement("div",{className:`usage-pace ${x.pace.category}`},React.createElement("div",{className:"usag\
e-pace-heading"},React.createElement("span",{className:"usage-pace-category"},x.pace.category),React.createElement("span",
null,"Ideal ",dn(x.pace.expectedUsedPercent)," \xB7 projected ",dn(x.pace.projectedUsedPercent))),React.createElement("d\
iv",{className:"usage-pace-chart",role:"img","aria-label":`${x.label} actual ${dn(x.usedPercent)}, ideal ${dn(x.pace.expectedUsedPercent)}\
, projected ${dn(x.pace.projectedUsedPercent)}`},React.createElement("span",{className:"usage-pace-actual",style:{width:`${x.
visualPercent}%`}}),React.createElement("i",{className:"usage-pace-ideal",style:{left:`${Math.min(100,x.pace.expectedUsedPercent)}\
%`}}),React.createElement("i",{className:"usage-pace-projected",style:{left:`${Math.min(100,x.pace.projectedUsedPercent)}\
%`}})),React.createElement("div",{className:"usage-pace-budgets"},Object.entries({Now:"now","+1 hour":"next_hour","+5 ho\
urs":"next_five_hours",Today:"today"}).map(([te,ie])=>React.createElement("span",{key:ie},React.createElement("small",null,
te),React.createElement("strong",null,dn(x.pace.budgets?.[ie]||0))))),React.createElement("div",{className:"usage-pace-o\
utcome"},x.usedPercent>=100?"Quota is exhausted":x.pace.willLastToReset?"Current pace lasts to reset":`Projected exhaust\
ion ${nr(x.pace.exhaustionAt,y)}`)),Y&&React.createElement("div",{className:"usage-dashboard-reset"},"Resets ",Y),React.
createElement("div",{className:"usage-window-provenance"},x.source||d.source,x.provenance?` \xB7 ${x.provenance}`:""))})):
!d.localRuntime&&!d.cloudUsage?React.createElement("div",{className:"usage-dashboard-unavailable"},d.error?.message||"Th\
is provider did not report quota windows."):null,d.cloudUsage&&d.providerId==="ollama-local"&&(d.cloudUsage.subscriptionState===
"active"?React.createElement("div",{className:"usage-dashboard-credit-row","data-testid":"ollama-cloud-usage"},React.createElement(
"span",null,React.createElement("strong",null,"Ollama Cloud"),d.windows.length," quota window",d.windows.length===1?"":"\
s",React.createElement("small",null,tr(d.cloudUsage.capturedAt,y))),React.createElement("span",null,React.createElement(
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
"small",null,d.localRuntime.latestRequest.surface.replace(/_/g," ")," - ",tr(d.localRuntime.latestRequest.capturedAt,y))),
React.createElement("span",null,React.createElement("strong",null,"Tokens"),d.localRuntime.latestRequest.promptTokens," \
prompt - ",d.localRuntime.latestRequest.responseTokens," output",React.createElement("small",null,sm(d.localRuntime.latestRequest.
tokensPerSecond))),React.createElement("span",null,React.createElement("strong",null,"Total / load"),Wo(d.localRuntime.latestRequest.
totalDurationNs)," / ",Wo(d.localRuntime.latestRequest.loadDurationNs),React.createElement("small",null,"terminal respon\
se metrics")),React.createElement("span",null,React.createElement("strong",null,"Prompt / eval"),Wo(d.localRuntime.latestRequest.
promptEvalDurationNs)," / ",Wo(d.localRuntime.latestRequest.evalDurationNs),React.createElement("small",null,d.localRuntime.
observedRequestCount," owned receipt",d.localRuntime.observedRequestCount===1?"":"s"))),g.length>0&&React.createElement(
"div",{className:"usage-dashboard-credit-row usage-dashboard-financial-row"},g.map(x=>React.createElement("span",{key:x.
id},React.createElement("strong",null,x.label),x.value))),(h||d.resetCredits)&&React.createElement("div",{className:"usa\
ge-dashboard-credit-row"},h&&React.createElement("span",null,React.createElement("strong",null,"Credits"),h,A&&React.createElement(
"small",null,"Resets ",A)),d.resetCredits&&React.createElement("span",null,React.createElement("strong",null,"Rate-limit\
 resets"),d.resetCredits.available_count||0," available")),Array.isArray(d.resetCredits?.details)&&d.resetCredits.details.
length>0&&React.createElement("div",{className:"usage-dashboard-reset-credits"},d.resetCredits.details.map((x,O)=>React.
createElement("span",{key:`${x.title||"reset"}-${O}`},React.createElement("strong",null,x.title||`Reset credit ${O+1}`),
x.status&&React.createElement("small",null,x.status),x.expires_at&&React.createElement("small",null,"Expires ",nr(x.expires_at,
y))))),d.error?.message&&d.windows.length>0&&React.createElement("div",{className:"usage-dashboard-stale-error"},"Last r\
efresh: ",d.error.message),React.createElement("div",{className:"usage-dashboard-source-row"},React.createElement("span",
null,"Source: ",d.source?d.source.replace(/_/g," "):"not available",d.latencyMs!=null?` \xB7 ${d.latencyMs} ms`:""),d.dashboardUrl&&
React.createElement("a",{href:d.dashboardUrl,target:"_blank",rel:"noreferrer"},"Open provider dashboard"))))}),_.entries.
length===0&&React.createElement("div",{className:"usage-dashboard-empty"},React.createElement("strong",null,_.collectionState===
"ready"?"The completed scan found no provider usage.":"Provider usage is not available yet."),React.createElement("span",
null,_.collectionState==="ready"?"Connect a supported Codex, Claude Code, Antigravity, or Cursor session, or start local\
 Ollama, then refresh.":"Quota totals remain unknown until a provider collection completes."))))}var xc=640,xu=220,jt=Object.
freeze({left:54,right:14,top:12,bottom:32});function ya(e){let t=Math.max(.04,Math.min(1,Number(e?.end)-Number(e?.start)||
1)),n=Math.max(0,Math.min(1-t,Number(e?.start)||0));return{start:n,end:n+t}}function Iy(e,t,n,s){let a="",i=!1;return e.
forEach(c=>{let u=c[t];if(c.gap||u==null||!Number.isFinite(u)){i=!1;return}a+=`${i?"L":"M"}${n(c).toFixed(2)},${s(u).toFixed(
2)} `,i=!0}),a.trim()}function Ac({title:e,description:t,frames:n,series:s,percentScale:a=!1,viewport:i,onViewportChange:c,
crosshairSequence:u,onCrosshairChange:f,range:_="live",nowMs:y=Date.now(),paused:S=!1,subscriptionStatus:T="live"}){let w=React.
useRef(null),M=React.useRef(new Map),d=React.useRef(null),h=React.useRef(0),[g,A]=React.useState({}),[N,$]=React.useState(
{mode:"auto",fixedMax:null}),x=xc-jt.left-jt.right,O=xu-jt.top-jt.bottom,Y=Yr(n,{nowMs:y,paused:S,connected:T!=="reconne\
cting",subscriptionStatus:T}),te=Y.frames,ie=ya(i),ge=Vr[_]??Vr.live,z=S&&Y.endMs||y,ae=ge===1/0?Y.startMs||z-Vr.live:z-
ge,_e=Math.max(1,z-ae),V=ae+_e*ie.start,he=ae+_e*ie.end,be=te.filter(B=>Number(B.chart_time_ms)>=V&&Number(B.chart_time_ms)<=
he),ee=s.map(B=>{let ne=B.frames?Yr(B.frames,{nowMs:y,paused:!0}).frames:be,xe=B.frames?ne.filter(He=>Number(He.chart_time_ms)>=
V&&Number(He.chart_time_ms)<=he):ne;return{...B,visibleFrames:xe,samples:Qp(xe,B.metric,180)}}),Se=ee.filter(B=>!g[B.key]),
Z=Math.max(0,...Se.flatMap(B=>B.samples.map(ne=>ne.max||0))),ue=Ql(Z,h.current,{percent:a});!a&&N.mode==="auto"&&(h.current=
ue.maximum);let de=N.mode==="fixed"&&N.fixedMax?Ql(N.fixedMax,N.fixedMax,{percent:a}):ue,Ae=de.maximum,X=B=>jt.left+Jl(B,
V,he)*x,D=B=>jt.top+O-Math.max(0,Math.min(Ae,B))/Math.max(1,Ae)*O,J=be.find(B=>B.sample_sequence===u)||be.at(-1)||null,E=J?
jt.left+Jl(J,V,he)*x:null,W=s[0]?.format||(B=>String(B)),ce=Zp(V,he,typeof window<"u"&&window.innerWidth<=600?4:5),me=Y.
status[0]?.toUpperCase()+Y.status.slice(1);function fe(B){let ne=w.current?.getBoundingClientRect();return ne?.width?Math.
max(0,Math.min(1,(B.clientX-ne.left)/ne.width)):.5}function we(B){if(!be.length)return 0;let ne=V+(he-V)*B;return be.reduce(
(xe,He)=>Math.abs(Number(He.chart_time_ms)-ne)<Math.abs(Number(xe.chart_time_ms)-ne)?He:xe,be[0]).sample_sequence}function Le(B,ne=.5){
let xe=ya(i),He=Math.max(.04,Math.min(1,(xe.end-xe.start)*B)),Et=xe.start+(xe.end-xe.start)*ne;c(ya({start:Et-He*ne,end:Et+
He*(1-ne)}))}React.useEffect(()=>{let B=w.current;if(!B)return;let ne=xe=>{xe.preventDefault(),Le(xe.deltaY>0?1.2:.8,fe(
xe))};return B.addEventListener("wheel",ne,{passive:!1}),()=>B.removeEventListener("wheel",ne)});function Ee(B){try{B.currentTarget.
setPointerCapture?.(B.pointerId)}catch{}if(M.current.set(B.pointerId,{x:B.clientX,y:B.clientY}),f(we(fe(B))),M.current.size===
1)d.current={mode:"pan",pointerId:B.pointerId,startX:B.clientX,viewport:ya(i)};else if(M.current.size===2){let ne=[...M.
current.values()];d.current={mode:"pinch",distance:Math.max(1,Math.abs(ne[1].x-ne[0].x)),center:(fe({clientX:ne[0].x})+fe(
{clientX:ne[1].x}))/2,viewport:ya(i)}}}function Ze(B){if(!M.current.has(B.pointerId)){f(we(fe(B)));return}M.current.set(
B.pointerId,{x:B.clientX,y:B.clientY});let ne=d.current;if(ne?.mode==="pinch"&&M.current.size>=2){let xe=[...M.current.values()],
He=Math.max(1,Math.abs(xe[1].x-xe[0].x)),Et=ne.viewport.end-ne.viewport.start,mn=Math.max(.04,Math.min(1,Et*ne.distance/
He)),F=ne.viewport.start+Et*ne.center;c(ya({start:F-mn*ne.center,end:F+mn*(1-ne.center)}));return}if(ne?.mode==="pan"&&ne.
pointerId===B.pointerId){let xe=w.current?.getBoundingClientRect(),He=ne.viewport.end-ne.viewport.start,Et=xe?.width?-(B.
clientX-ne.startX)/xe.width*He:0;c(ya({start:ne.viewport.start+Et,end:ne.viewport.end+Et}))}}function re(B){M.current.delete(
B.pointerId);try{B.currentTarget.releasePointerCapture?.(B.pointerId)}catch{}M.current.size===0&&(d.current=null)}function Me(B){
if(!be.length)return;let ne=Math.max(0,be.findIndex(xe=>xe.sample_sequence===u));if(B.key==="ArrowLeft"||B.key==="ArrowR\
ight")if(B.preventDefault(),B.shiftKey){let He=(ie.end-ie.start)*(B.key==="ArrowLeft"?-.1:.1);c(ya({start:ie.start+He,end:ie.
end+He}))}else{let xe=Math.max(0,Math.min(be.length-1,ne+(B.key==="ArrowLeft"?-1:1)));f(be[xe].sample_sequence)}else B.key===
"Home"||B.key==="End"?(B.preventDefault(),f((B.key==="Home"?be[0]:be.at(-1)).sample_sequence)):B.key==="+"||B.key==="="?
(B.preventDefault(),Le(.75)):B.key==="-"&&(B.preventDefault(),Le(1.25))}return React.createElement("section",{className:"\
host-resource-chart","aria-label":`${e} chart`},React.createElement("div",{className:"host-resource-chart-heading"},React.
createElement("span",null,React.createElement("strong",null,e),React.createElement("small",null,t)),!a&&React.createElement(
"button",{type:"button",onClick:()=>$(B=>B.mode==="auto"?{mode:"fixed",fixedMax:ue.maximum}:{mode:"auto",fixedMax:null})},
N.mode==="auto"?"Auto scale":`Fixed ${W(N.fixedMax)}`)),React.createElement("div",{className:`host-resource-chart-qualit\
y ${Y.status}`,role:"status"},React.createElement("strong",null,me),React.createElement("span",null,Y.receivedCount," re\
ceived / ",Y.validCount," valid / ",Y.expectedCount," expected / ",Y.droppedCount," dropped"),React.createElement("span",
null,Math.round(Y.cadenceMs)," ms cadence"),React.createElement("span",null,Y.gapCount," gap",Y.gapCount===1?"":"s"),React.
createElement("span",null,Y.duplicateCount," duplicate / ",Y.outOfOrderCount," out of order")),React.createElement("div",
{className:"host-resource-chart-legend","aria-label":`${e} series`},ee.map((B,ne)=>React.createElement("button",{type:"b\
utton",key:B.key,"aria-pressed":!g[B.key],onClick:()=>A(xe=>({...xe,[B.key]:!xe[B.key]}))},React.createElement("i",{className:`\
marker marker-${ne%3}`,style:{"--series-color":B.color}}),B.label))),React.createElement("div",{className:"host-resource\
-chart-canvas",ref:w,role:"group",tabIndex:"0","aria-label":`${e}. Drag to pan, wheel or pinch to zoom, arrow keys move \
the synchronized crosshair, shift plus arrows pan, plus and minus zoom.`,onPointerDown:Ee,onPointerMove:Ze,onPointerUp:re,
onPointerCancel:re,onKeyDown:Me},React.createElement("svg",{viewBox:`0 0 ${xc} ${xu}`,"aria-hidden":"true"},Y.gaps.filter(
B=>B.endMs>=V&&B.startMs<=he).map((B,ne)=>{let xe=jt.left+Math.max(0,(B.startMs-V)/Math.max(1,he-V))*x,He=jt.left+Math.min(
1,(B.endMs-V)/Math.max(1,he-V))*x;return React.createElement("rect",{key:`${B.reason}-${ne}`,className:"host-resource-ch\
art-gap",x:xe,y:jt.top,width:Math.max(2,He-xe),height:O})}),[...de.ticks].reverse().map(B=>{let ne=D(B);return React.createElement(
React.Fragment,{key:B},React.createElement("line",{className:"host-resource-chart-grid",x1:jt.left,x2:xc-jt.right,y1:ne,
y2:ne}),React.createElement("text",{className:"host-resource-chart-y-label",textAnchor:"end",x:jt.left-7,y:ne+4},W(B)))}),
ce.map((B,ne)=>{let xe=jt.left+B.fraction*x;return React.createElement("text",{key:B.timeMs,className:"host-resource-cha\
rt-x-label","aria-label":B.accessibleLabel,textAnchor:ne===0?"start":ne===ce.length-1?"end":"middle",x:xe,y:xu-7},B.label)}),
Se.flatMap(B=>B.samples.map(ne=>ne.gap||ne.min==null||ne.max==null?null:React.createElement("line",{key:`${B.key}-${ne.endSequence}`,
className:"host-resource-chart-range",stroke:B.color,x1:X(ne),x2:X(ne),y1:D(ne.min),y2:D(ne.max)}))),Se.map((B,ne)=>React.
createElement("path",{key:B.key,className:`host-resource-chart-line series-${ne%3}`,stroke:B.color,strokeDasharray:B.dashed||
ne%3===1?"7 4":ne%3===2?"2 4":void 0,d:Iy(B.samples,"average",X,D)})),Se.flatMap((B,ne)=>B.visibleFrames.length<10?B.visibleFrames.
map(xe=>{let He=ma(xe,B.metric);return He==null?null:React.createElement("circle",{key:`${B.key}-point-${xe.sample_sequence}`,
className:`host-resource-chart-point marker-${ne%3}`,cx:X(xe),cy:D(He),r:"3",stroke:B.color})}):[]),E!=null&&React.createElement(
"line",{className:"host-resource-chart-crosshair",x1:E,x2:E,y1:jt.top,y2:jt.top+O})),J&&React.createElement("div",{className:`\
host-resource-chart-tooltip ${E>xc/2?"flip":""}`,role:"status"},React.createElement("strong",null,tu(J.chart_time_ms)," \
/ seq ",J.sample_sequence),React.createElement("span",null,Math.max(0,Math.round((y-Number(J.chart_time_ms))/1e3)),"s ol\
d / ",J.sample_interval_ms||Y.cadenceMs," ms / ",me," / source ",J.status||"unknown"),ee.map(B=>React.createElement("spa\
n",{key:B.key},React.createElement("i",{style:{background:B.color}}),B.label,": ",B.format(ma(B.visibleFrames.find(ne=>ne.
sample_sequence===J.sample_sequence),B.metric)))))),React.createElement("div",{className:"host-resource-chart-stats"},ee.
filter(B=>!g[B.key]).map(B=>{let ne=Xl(B.visibleFrames,B.metric),xe=B.visibleFrames.find(He=>He.sample_sequence===ne.peakSequence);
return React.createElement("span",{key:B.key},React.createElement("strong",null,B.label),React.createElement("span",null,
"Latest-good ",B.format(ne.current)),React.createElement("span",null,"Min ",B.format(ne.min)),React.createElement("span",
null,"Avg ",B.format(ne.average)," (",ne.averageMethod,")"),React.createElement("span",null,"Max ",B.format(ne.max)),React.
createElement("span",null,ne.p95Ready?`p95 ${B.format(ne.p95)}`:`p95 collecting (${ne.count}/20)`),React.createElement("\
small",null,ne.count," raw / ",Math.round(ne.elapsedMs/1e3),"s / ",ne.cadenceMs||Y.cadenceMs," ms cadence / ",Math.max(ne.
gapCount,Y.gapCount)," gaps / ",me," / peak ",eu(xe?.captured_at)))})),React.createElement("details",{className:"host-re\
source-chart-data"},React.createElement("summary",null,"Accessible data table"),React.createElement("div",null,React.createElement(
"table",null,React.createElement("caption",null,"Latest ",Math.min(120,be.length)," of ",be.length," visible samples"),React.
createElement("thead",null,React.createElement("tr",null,React.createElement("th",null,"Time / sequence"),ee.map(B=>React.
createElement("th",{key:B.key},B.label)))),React.createElement("tbody",null,be.slice(-120).map(B=>React.createElement("t\
r",{key:`${B.sample_sequence}:${B.chart_time_ms}`},React.createElement("th",null,tu(B.chart_time_ms)," / ",B.sample_sequence,
B.gap_before?` / gap: ${B.gap_reason}`:""),ee.map(ne=>React.createElement("td",{key:ne.key},ne.format(ma(ne.visibleFrames.
find(xe=>xe.sample_sequence===B.sample_sequence),ne.metric)))))))))))}function Oy(e,t,n,s,a){let i=t.trim().toLowerCase(),
c=w=>(!i||[w.name,w.agentLabel,w.workspaceLabel,w.pid,w.attributionReason].some(M=>String(M||"").toLowerCase().includes(
i)))&&(n==="all"||w.attributionLevel===n),u=e.filter(c),f=new Set(u.map(w=>w.stableKey)),_=(w,M)=>s==="name"?(w.agentLabel||
w.name).localeCompare(M.agentLabel||M.name)||w.pid-M.pid:s==="memory"?M.memoryBytes-w.memoryBytes||w.pid-M.pid:s==="read"?
M.ioReadBps-w.ioReadBps||w.pid-M.pid:s==="write"?M.ioWriteBps-w.ioWriteBps||w.pid-M.pid:M.cpuHostPercent-w.cpuHostPercent||
w.pid-M.pid,y=new Map;u.forEach(w=>{let M=f.has(w.parentKey)?w.parentKey:"";y.set(M,[...y.get(M)||[],w])});let S=[];function T(w,M){
(y.get(w)||[]).sort(_).forEach(d=>{S.push({process:d,depth:M}),a[d.stableKey]!==!1&&T(d.stableKey,M+1)})}return T("",0),
S}function Af(e,t,n=44,s=16){let a=(Array.isArray(e)?e:[]).map(i=>ma(i,t)).filter(i=>i!==null);return a.length<2?"":a.map(
(i,c)=>{let u=c/(a.length-1)*n,f=s-Math.max(0,Math.min(100,i))/100*s;return`${c?"L":"M"}${u.toFixed(2)},${f.toFixed(2)}`}).
join(" ")}function qy({connected:e,error:t,history:n,subscription:s,onOpen:a,onRefresh:i,onSubscribe:c,onUnsubscribe:u}){
let f="(min-width: 900px)",[_,y]=React.useState(()=>typeof window<"u"&&typeof window.matchMedia=="function"?window.matchMedia(
f).matches:!1),[S,T]=React.useState(Date.now());React.useEffect(()=>{if(typeof window>"u"||typeof window.matchMedia!="fu\
nction")return;let $=window.matchMedia(f),x=()=>y($.matches);return x(),typeof $.addEventListener=="function"?$.addEventListener(
"change",x):$.addListener?.(x),()=>{typeof $.removeEventListener=="function"?$.removeEventListener("change",x):$.removeListener?.(
x)}},[]),React.useEffect(()=>{if(_)return c(!0,"global-strip"),()=>u("global-strip")},[_,c,u]),React.useEffect(()=>{if(!_)
return;let $=()=>T(Date.now()),x=setInterval($,1e3),O=()=>{document.visibilityState==="visible"&&($(),i(!1))};return document.
addEventListener("visibilitychange",O),()=>{clearInterval(x),document.removeEventListener("visibilitychange",O)}},[_,i]);
let w=React.useMemo(()=>Xp(n,{connected:e,error:!!t,nowMs:S,subscriptionStatus:s?.status}),[e,t,n,S,s?.status]);if(!_)return null;
let M=$=>($==null?"\u2014":String(Math.round($))).padStart(3,"\u2007"),d=$=>$==="critical"?"!!":$==="warning"?"!":"",h=w.
status==="stale"?`stale ${w.ageSeconds}s`:w.status,g=w.memoryUsedBytes!==null&&w.memoryTotalBytes!==null?`${us(w.memoryUsedBytes)}\
 of ${us(w.memoryTotalBytes)}`:"memory totals unavailable",A=w.point?`Host CPU ${w.cpuPercent?.toFixed(1)??"unknown"}%; \
memory ${w.memoryPercent?.toFixed(1)??"unknown"}% (${g}); ${h}; sample ${w.sampleSequence}`:`Host resources ${h}`,N=w.point?
`Open Host resources. CPU ${w.cpuPercent?.toFixed(1)??"unknown"} percent, ${w.cpuLevel}. RAM ${w.memoryPercent?.toFixed(
1)??"unknown"} percent, ${w.memoryLevel}. ${h}. Sample ${w.sampleSequence}.`:`Open Host resources. CPU and RAM waiting. ${h}\
.`;return React.createElement("div",{className:"global-desktop-status-rail","data-testid":"global-desktop-status-rail"},
React.createElement("button",{type:"button",className:`global-host-resource-strip ${w.attention}`,"data-testid":"global-\
host-resource-strip","data-status":w.status,"data-cpu-level":w.cpuLevel,"data-memory-level":w.memoryLevel,"data-sample-s\
equence":w.sampleSequence||"","data-sample-captured-at":w.capturedAt||"","data-cpu-percent":w.cpuPercent??"","data-memor\
y-percent":w.memoryPercent??"","data-history-count":w.frames.length,"aria-label":N,title:A,onClick:a},React.createElement(
"span",{className:`global-host-resource-metric ${w.cpuLevel}`},React.createElement("span",{className:"label"},"CPU","\xA0"),
React.createElement("span",{className:"value"},M(w.cpuPercent)),React.createElement("span",{className:"unit"},"%"),React.
createElement("span",{className:"attention-mark"},d(w.cpuLevel))),React.createElement("span",{className:"global-host-res\
ource-divider","aria-hidden":"true"},"\xB7"),React.createElement("span",{className:`global-host-resource-metric ${w.memoryLevel}`},
React.createElement("span",{className:"label"},"RAM","\xA0"),React.createElement("span",{className:"value"},M(w.memoryPercent)),
React.createElement("span",{className:"unit"},"%"),React.createElement("span",{className:"attention-mark"},d(w.memoryLevel))),
React.createElement("svg",{className:"global-host-resource-sparkline",viewBox:"0 0 44 16","aria-hidden":"true"},React.createElement(
"path",{className:"cpu",d:Af(w.frames,"cpu_total_percent")}),React.createElement("path",{className:"memory",d:Af(w.frames,
"memory_used_percent")})),React.createElement("span",{className:"global-host-resource-state"},h)))}function Py({snapshot:e,
error:t,history:n,details:s,subscription:a,onBack:i,onRefresh:c,onSubscribe:u,onUnsubscribe:f}){let _=React.useMemo(()=>Yp(
e),[e]),[y,S]=React.useState(Date.now()),[T,w]=React.useState("live"),[M,d]=React.useState(null),[h,g]=React.useState(null),
[A,N]=React.useState({start:0,end:1}),[$,x]=React.useState(0),[O,Y]=React.useState(!1),[te,ie]=React.useState(""),[ge,z]=React.
useState("all"),[ae,_e]=React.useState("cpu"),[V,he]=React.useState({}),[be,ee]=React.useState("");React.useEffect(()=>(u(
O,"dashboard"),()=>f("dashboard")),[O,u,f]),React.useEffect(()=>{let re=setInterval(()=>S(Date.now()),1e3);return()=>clearInterval(
re)},[]);let Se=React.useMemo(()=>M==null?n:n.filter(re=>re.sample_sequence<=M),[n,M]),Z=M==null?y:h||y,ue=React.useMemo(
()=>Jp(Se,T,{nowMs:Z,paused:M!=null,subscriptionStatus:a?.status,connected:a?.status!=="reconnecting",error:!!t}),[Se,T,
Z,M,a?.status,t]),de=React.useMemo(()=>Yr(Se,{nowMs:Z,paused:M!=null,subscriptionStatus:a?.status,connected:a?.status!==
"reconnecting",error:!!t}),[Se,Z,M,a?.status,t]),Ae=React.useRef("");React.useEffect(()=>{if(!["delayed","stale"].includes(
de.status)||M!=null){Ae.current="";return}let re=`${de.status}:${de.points.at(-1)?.sampleSequence||0}`;Ae.current!==re&&
(Ae.current=re,c(!1))},[de.status,de.points,M,c]),React.useEffect(()=>{!$&&ue.length&&x(ue.at(-1).sample_sequence)},[$,ue]);
let X=_.system,D=X?X.disk.readBps+X.disk.writeBps:0,J=X?X.network.receiveBps+X.network.sendBps:0,E=React.useMemo(()=>Oy(
_.processes,te,ge,ae,V),[_.processes,te,ge,ae,V]),W=_.processes.find(re=>re.stableKey===be)||null,ce=_.lastGoodCapturedAt?
Zl(_.lastGoodCapturedAt,y).replace(/^Updated\s+/i,""):"not yet available",me=React.useMemo(()=>be?s.flatMap(re=>{let Me=(re.
processes||[]).find(B=>B.stable_key===be);return Me?[{frame_kind:"system",sample_sequence:re.sample_sequence,captured_at:re.
captured_at,sample_interval_ms:re.sample_interval_ms,dropped_gap_count:re.dropped_gap_count,status:re.status,cpu:{total_percent:Me.
cpu_host_percent},disk:{read_bps:Me.io_read_bps,write_bps:Me.io_write_bps}}]:[]}):[],[s,be]),fe=re=>re==null?"\u2014":em(
re),we=re=>re==null?"\u2014":ds(re),Le={live:"Live",delayed:"Delayed",reconnecting:"Reconnecting",paused:"Paused",stale:"\
Stale",waiting:"Waiting",unavailable:"Unavailable"}[de.status]||"Unavailable",Ee=[{key:"cpu-total",metric:"cpu_total_per\
cent",label:"Total",color:"#58a6ff",format:fe},{key:"cpu-user",metric:"cpu_user_percent",label:"User",color:"#3fb950",format:fe},
{key:"cpu-kernel",metric:"cpu_privileged_percent",label:"Kernel",color:"#d29922",format:fe},...me.length?[{key:"process-\
cpu",metric:"cpu_total_percent",label:`${W?.agentLabel||W?.name||"Process"} overlay`,color:"#f778ba",format:fe,frames:me,
dashed:!0}]:[]],Ze=[{key:"disk-read",metric:"disk_read_bps",label:"Read",color:"#58a6ff",format:we},{key:"disk-write",metric:"\
disk_write_bps",label:"Write",color:"#f0883e",format:we},...me.length?[{key:"process-read",metric:"disk_read_bps",label:"\
Process read overlay",color:"#bc8cff",format:we,frames:me,dashed:!0},{key:"process-write",metric:"disk_write_bps",label:"\
Process write overlay",color:"#f778ba",format:we,frames:me,dashed:!0}]:[]];return React.createElement("div",{className:"\
host-resource-dashboard","data-testid":"host-resource-dashboard"},React.createElement("div",{className:"automations-head\
er host-resource-header"},React.createElement("button",{className:"automations-back",onClick:i,title:"Back to sessions"},
"\u2190"),React.createElement("div",{className:"automations-header-text"},React.createElement("h2",null,"Host resources"),
React.createElement("p",null,"Live, ephemeral Windows metrics. Process commands and executable paths never leave the pro\
xy.")),React.createElement("button",{type:"button",className:"usage-dashboard-refresh",onClick:()=>c(!0),"aria-label":"C\
apture host resource detail now"},"Capture detail")),React.createElement("div",{className:"host-resource-meta"},React.createElement(
"span",{className:`host-resource-status ${de.status}`},Le),React.createElement("span",null,O?"Aggregate-only":_.machineLabel||
"Windows host"),React.createElement("span",null,Zl(_.capturedAt,y)),React.createElement("span",null,de.receivedCount," r\
eceived / ",de.validCount," valid / ",de.expectedCount," expected / ",de.droppedCount," dropped / ",de.gapCount," gaps /\
 ",de.duplicateCount," dup / ",de.outOfOrderCount," out-of-order"),React.createElement("span",null,Math.round(de.cadenceMs),
" ms cadence / seq ",_.sampleSequence||"\u2014")),React.createElement("div",{className:"host-resource-controls","aria-la\
bel":"Host resource timeline controls"},React.createElement("div",{className:"host-resource-range",role:"group","aria-la\
bel":"Time range"},[["live","Live"],["1m","1m"],["5m","5m"],["15m","15m"],["since_open","Since open"]].map(([re,Me])=>React.
createElement("button",{key:re,type:"button",className:T===re?"active":"","aria-pressed":T===re,onClick:()=>{w(re),N({start:0,
end:1})}},Me))),React.createElement("button",{type:"button",onClick:()=>{M==null?(g(Date.now()),d(n.at(-1)?.sample_sequence||
0)):(d(null),g(null))}},M==null?"Pause":"Resume"),React.createElement("button",{type:"button",disabled:A.start===0&&A.end===
1,onClick:()=>N({start:0,end:1})},"Reset zoom"),React.createElement("label",null,React.createElement("input",{type:"chec\
kbox",checked:O,onChange:re=>{Y(re.target.checked),ee("")}})," Aggregate-only privacy"),React.createElement("span",null,
ue.length," raw samples / ",Math.round(de.elapsedMs/1e3),"s actual",M==null?"":` / paused at ${M}`)),(t||_.error)&&React.
createElement("div",{className:"host-resource-error",role:"status"},t?.message||_.error?.message,_.error&&` Last full de\
tail: ${ce}.`),X?React.createElement(React.Fragment,null,React.createElement("div",{className:"host-resource-summary","a\
ria-label":"Host resource summary"},React.createElement("div",null,React.createElement("strong",null,Math.round(X.cpuPercent),
"%"),React.createElement("span",null,"CPU"),React.createElement("small",null,X.cpu.logicalCoreCount||"\u2014"," logical \
/ ",X.cpu.physicalCoreCount||"\u2014"," physical cores")),React.createElement("div",null,React.createElement("strong",null,
Math.round(X.memory.usedPercent),"%"),React.createElement("span",null,"memory"),React.createElement("small",null,us(X.memory.
usedBytes)," / ",us(X.memory.totalBytes),"; commit ",Math.round(X.memory.commitPercent),"%")),React.createElement("div",
null,React.createElement("strong",null,ds(D)),React.createElement("span",null,"disk I/O"),React.createElement("small",null,
"Read ",ds(X.disk.readBps)," / write ",ds(X.disk.writeBps)," / ",Math.round(X.disk.busyPercent),"% busy")),React.createElement(
"div",null,React.createElement("strong",null,ds(J)),React.createElement("span",null,"network I/O"),React.createElement("\
small",null,"Receive ",ds(X.network.receiveBps)," / send ",ds(X.network.sendBps)))),React.createElement("div",{className:"\
host-resource-charts"},React.createElement(Ac,{title:"CPU",description:"Total outline; User and Kernel component overlay\
s (%)",frames:ue,series:Ee,percentScale:!0,viewport:A,onViewportChange:N,crosshairSequence:$,onCrosshairChange:x,range:T,
nowMs:Z,paused:M!=null,subscriptionStatus:a?.status}),React.createElement(Ac,{title:"Memory",description:"Physical used \
and committed (%)",frames:ue,series:[{key:"memory-used",metric:"memory_used_percent",label:"Physical used",color:"#bc8cf\
f",format:fe},{key:"memory-commit",metric:"memory_commit_percent",label:"Committed",color:"#f778ba",format:fe}],percentScale:!0,
viewport:A,onViewportChange:N,crosshairSequence:$,onCrosshairChange:x,range:T,nowMs:Z,paused:M!=null,subscriptionStatus:a?.
status}),React.createElement(Ac,{title:"Disk",description:"Aggregate throughput (IEC bytes/s); isolate unequal series in\
 the legend",frames:ue,series:Ze,viewport:A,onViewportChange:N,crosshairSequence:$,onCrosshairChange:x,range:T,nowMs:Z,paused:M!=
null,subscriptionStatus:a?.status}),React.createElement(Ac,{title:"Network",description:"Physical-default receive and se\
nd (IEC bytes/s)",frames:ue,series:[{key:"network-receive",metric:"network_receive_bps",label:"Receive",color:"#3fb950",
format:we},{key:"network-send",metric:"network_send_bps",label:"Send",color:"#d29922",format:we}],viewport:A,onViewportChange:N,
crosshairSequence:$,onCrosshairChange:x,range:T,nowMs:Z,paused:M!=null,subscriptionStatus:a?.status})),!O&&React.createElement(
"section",{className:"host-resource-process-section","aria-labelledby":"host-resource-process-heading"},React.createElement(
"div",{className:"host-resource-process-heading"},React.createElement("span",null,React.createElement("strong",{id:"host\
-resource-process-heading"},"Processes"),React.createElement("small",null,"Union of owned, top CPU, memory, read, and wr\
ite. Attribution never implies unproved per-session ownership.")),React.createElement("span",null,_.attributedProcesses.
length," attributed / ",_.processes.length," shown")),React.createElement("div",{className:"host-resource-process-contro\
ls"},React.createElement("label",null,"Search ",React.createElement("input",{value:te,onChange:re=>ie(re.target.value),placeholder:"\
Name, PID, agent, workspace"})),React.createElement("label",null,"Attribution ",React.createElement("select",{value:ge,onChange:re=>z(
re.target.value)},React.createElement("option",{value:"all"},"All"),React.createElement("option",{value:"owned"},"Owned"),
React.createElement("option",{value:"runtime"},"Runtime match"),React.createElement("option",{value:"workspace-associate\
d"},"Workspace-associated"),React.createElement("option",{value:"unattributed"},"Unattributed"))),React.createElement("l\
abel",null,"Sort ",React.createElement("select",{value:ae,onChange:re=>_e(re.target.value)},React.createElement("option",
{value:"cpu"},"CPU"),React.createElement("option",{value:"memory"},"Memory"),React.createElement("option",{value:"read"},
"Read"),React.createElement("option",{value:"write"},"Write"),React.createElement("option",{value:"name"},"Name")))),W&&
React.createElement("div",{className:"host-resource-process-overlay",role:"region","aria-label":`Process detail for ${W.
agentLabel||W.name}`},React.createElement("div",null,React.createElement("strong",null,W.agentLabel||W.name),React.createElement(
"span",null,W.name," / PID ",W.pid," / started ",W.startTime?eu(W.startTime):"unknown"),React.createElement("small",null,
W.attributionLevel,": ",W.attributionReason,". CPU and disk overlays use the same synchronized timebase.")),React.createElement(
"button",{type:"button",onClick:()=>ee("")},"Remove overlay"),React.createElement("dl",null,React.createElement("div",null,
React.createElement("dt",null,"Host CPU"),React.createElement("dd",null,W.cpuHostPercent.toFixed(1),"%")),React.createElement(
"div",null,React.createElement("dt",null,"Core equivalent"),React.createElement("dd",null,W.cpuCoreEquivalent.toFixed(1),
"%")),React.createElement("div",null,React.createElement("dt",null,"Working set"),React.createElement("dd",null,us(W.memoryBytes))),
React.createElement("div",null,React.createElement("dt",null,"Private / commit"),React.createElement("dd",null,us(W.privateBytes),
" / ",us(W.commitBytes))),React.createElement("div",null,React.createElement("dt",null,"Threads / handles"),React.createElement(
"dd",null,W.threadCount," / ",W.handleCount)),React.createElement("div",null,React.createElement("dt",null,"I/O operatio\
ns"),React.createElement("dd",null,"R ",W.ioReadOps," / W ",W.ioWriteOps)),React.createElement("div",null,React.createElement(
"dt",null,"64-bit byte counters"),React.createElement("dd",null,"R ",W.counterTotals.ioReadBytes," / W ",W.counterTotals.
ioWriteBytes)),React.createElement("div",null,React.createElement("dt",null,"Detail samples"),React.createElement("dd",null,
me.length," / 5s cadence")))),React.createElement("div",{className:"host-resource-process-scroll"},React.createElement("\
table",{className:"host-resource-process-table"},React.createElement("thead",null,React.createElement("tr",null,React.createElement(
"th",{scope:"col"},"Agent / process tree"),React.createElement("th",{scope:"col"},"Confidence"),React.createElement("th",
{scope:"col"},"CPU host / core"),React.createElement("th",{scope:"col"},"Memory"),React.createElement("th",{scope:"col"},
"Read"),React.createElement("th",{scope:"col"},"Write"))),React.createElement("tbody",null,E.map(({process:re,depth:Me})=>React.
createElement("tr",{key:re.stableKey,className:`${re.attributed?"attributed":""} ${be===re.stableKey?"selected":""}`,"da\
ta-agent-attributed":re.attributed?"true":"false"},React.createElement("td",{style:{"--process-depth":Me}},re.childCount>
0&&React.createElement("button",{className:"host-resource-process-expand",type:"button","aria-label":`${V[re.stableKey]===
!1?"Expand":"Collapse"} ${re.name}`,"aria-expanded":V[re.stableKey]!==!1,onClick:()=>he(B=>({...B,[re.stableKey]:B[re.stableKey]===
!1}))},V[re.stableKey]===!1?"+":"-"),React.createElement("button",{className:"host-resource-process-select",type:"button",
onClick:()=>ee(re.stableKey)},React.createElement("strong",null,re.agentLabel||re.name),React.createElement("span",null,
re.agentLabel?`${re.name} / `:"","PID ",re.pid,re.workspaceLabel?` / ${re.workspaceLabel}`:"",re.parentKey?" / child pro\
cess":re.parentPid?` / parent PID ${re.parentPid} outside sample`:""))),React.createElement("td",{"data-label":"Confiden\
ce"},React.createElement("strong",null,re.attributionLevel),React.createElement("span",{title:re.attributionReason},re.attributionReason)),
React.createElement("td",{"data-label":"CPU host / core"},re.cpuHostPercent.toFixed(1),"% / ",re.cpuCoreEquivalent.toFixed(
1),"%"),React.createElement("td",{"data-label":"Memory"},us(re.memoryBytes)),React.createElement("td",{"data-label":"Rea\
d"},ds(re.ioReadBps)),React.createElement("td",{"data-label":"Write"},ds(re.ioWriteBps)))))))),React.createElement("div",
{className:"host-resource-privacy"},React.createElement("strong",null,"Privacy boundary:")," sanitized metrics cross the\
 authenticated relay only to this requester while this view is open. The relay does not cache, persist, log, or restore \
them. Process command lines and executable paths remain local and are never transmitted. Aggregate-only mode also remove\
s machine, device, adapter, workspace, process, and PID labels.")):React.createElement("div",{className:"usage-dashboard\
-empty host-resource-empty"},React.createElement("strong",null,"Waiting for the Windows proxy."),React.createElement("sp\
an",null,"The subscription is ",a?.status||"starting",". Gaps remain visible; unavailable samples are not interpolated.")))}
function Dy(e){let t=Number(e?.percent);if(Number.isFinite(t))return Math.max(0,Math.min(100,t));let n=Number(e?.completed),
s=Number(e?.total);return Number.isInteger(n)&&Number.isInteger(s)&&s>0?Math.max(0,Math.min(100,n/s*100)):null}function jy(e,t){
let n=oe(e?.last_snippet).trim();if(n)return n.replace(/\s+/g," ").slice(0,180);let s=Array.isArray(t)?t:[];for(let a=s.
length-1;a>=0;a-=1){let i=Sv(s[a]?.content||si(s[a]?.content_blocks));if(i)return i.slice(0,180)}return"No recent messag\
e reported."}function By(e,t){if(e?.goal)return Ff(e.goal,t,e.goal_run);let n=Date.parse(e?.startedAt||e?.started_at||e?.
since||"");return Number.isFinite(n)?ju(Math.max(0,(t-n)/1e3),{includeSeconds:!0}):"live"}function Fy(e,t,n=20){let s=e.
filter(a=>t[a]?.canReceiveBroadcast).slice(0,n);return s.length===e.length&&s.every((a,i)=>a===e[i])?e:s}function Hy({sessions:e,
activities:t,thinking:n,permissionPrompts:s,errorPrompts:a,messages:i,agentConfigs:c,sessionAttention:u,health:f,connected:_,
deliveryStates:y,stopPending:S,goalControlPending:T,onBroadcastSend:w,onInterrupt:M,onGoalControl:d,onBack:h,onSelectSession:g}){
let[A,N]=React.useState(Date.now()),[$,x]=React.useState(!1),[O,Y]=React.useState([]),[te,ie]=React.useState(""),[ge,z]=React.
useState(""),[ae,_e]=React.useState(""),[V,he]=React.useState({});React.useEffect(()=>{let E=setInterval(()=>N(Date.now()),
1e3);return()=>clearInterval(E)},[]);let be=React.useMemo(()=>(e||[]).map(E=>{let W=qe(E),me=Object.prototype.hasOwnProperty.
call(t,W)?t[W]||{kind:"idle",label:""}:E?.activity||{kind:"idle",label:""},fe=s[W]||(Zr(a[W])?a[W]:null),we=u[W]||null,Le=!!fe||
E?.rate_limit_active===!0||["goal_attention","provider_usage_threshold"].includes(we?.kind),Ee=c[W]||{},Ze=E?.agent_type,
Me=Ub(Ze,Ee.capabilities)?me:{...me,goal:null},B=n[W]&&!Me?.kind?{...Me,kind:"thinking"}:Me,ne=ec(B,Le,{connected:_,health:f[W],
nowMs:A,requireFreshness:!0}),xe=ne==="needs_attention",He=Qa(ne),Et=tc(Me,{connected:_,health:f[W]}),mn=to(E,Ee),F=Wb({
agentType:Ze,capabilities:Ee.capabilities,activity:Me,latestUserRequest:E?.last_user_request||Gb(i[W]||[])}),Ct=F.kind===
"goal"&&Me?.goal||null,Vt=String(Ct?.state||Ct?.status||"").toLowerCase(),Sn=Vt==="blocked",Wn=Sn&&Ee.capabilities?.goal_blocked_resume===
!0,zn=Vt==="active"?"pause":Vt==="paused"||Wn?"resume":null,ir=Sn?oe(Ct?.block_reason||Ct?.reason||Me?.label||"Goal bloc\
ked").trim():"",so=["thinking","generating","running_command","applying_patch","reading_files","working"].includes(String(
Me?.kind||"").toLowerCase()),cr=oe(Me?.kind).replace(/_/g," "),wa=Number(E?.percent_used),fs=E?.rate_limited_until&&E.rate_limited_until!==
"unknown"?ni(E.rate_limited_until):"",lr=E?.rate_limit_active===!0?`Usage limited${fs?` \xB7 resets ${fs}`:" \xB7 reset unk\
nown"}`:Number.isFinite(wa)&&wa>=75?`Usage ${Math.round(wa)}% used${fs?` \xB7 resets ${fs}`:""}`:"";return{id:W,session:E,
agent:mn,activity:Me,attention:xe,working:He,state:ne,goal:Ct,config:Ee,stateLabel:E?.rate_limit_active===!0?"Usage limi\
ted":$p(ne),title:Zo(E,W,Ee,i[W]||[]),status:fe?oe(fe.title).trim()||"Action required":lr||Et||oe(me?.label).trim()||(ne===
"idle"?Ct?"Goal paused":"Idle":cr||(Ct?"Goal active":"Working")),workContext:F,progress:Dy(F),snippet:jy(E,i[W]||[]),health:f[W]||
"unknown",canReceiveBroadcast:Tm(E,c[W],f[W]||"unknown",_),freshness:Ip(me,A),activityLatencyMs:Number.isFinite(Number(me?.
transport?.latency_ms))?Math.round(Number(me.transport.latency_ms)):null,goalAction:zn,canControlGoal:!!(zn&&Ct?.fingerprint&&
Ee.capabilities?.goal_pause_resume===!0&&Number(E?.control_generation)>0),goalBlocked:Sn,goalBlockedReason:ir,canInterrupt:!!(so&&
Ee.capabilities?.interrupt===!0&&Number(E?.control_generation)>0&&Number(E?.turn_generation)>0)}}).filter(Boolean).sort(
(E,W)=>Number(W.attention)-Number(E.attention)||Number(W.working)-Number(E.working)||E.title.localeCompare(W.title)),[e,
t,n,s,a,i,c,u,f,_,A]),ee=React.useMemo(()=>be.filter(E=>$||E.state!=="idle"||E.goal),[be,$]),Se=be.filter(E=>E.state==="\
needs_attention").length,Z=be.filter(E=>E.working).length,ue=be.filter(E=>E.state==="working_goal").length,de=be.filter(
E=>E.state==="idle").length,Ae=React.useMemo(()=>Object.fromEntries(ee.map(E=>[E.id,E])),[ee]),X=`SEND TO ${O.length} SE\
SSIONS`;React.useEffect(()=>{O.length<=20&&O.every(E=>Ae[E]?.canReceiveBroadcast)||Y(E=>Fy(E,Ae))},[Ae,O]),React.useEffect(
()=>{Object.keys(V).length!==0&&he(E=>{let W=!1,ce={};return Object.entries(E).forEach(([me,fe])=>{let we=y[fe.clientMessageId]||
fe.status,Le=["offline_queued","busy_queued","steered"].includes(we)?"queued":we,Ee=["queued","accepted","launch_accepte\
d","delivered","agent_started","failed"].includes(Le)?Le:fe.status;ce[me]=Ee===fe.status?fe:{...fe,status:Ee},ce[me]!==fe&&
(W=!0)}),W?ce:E})},[y]);function D(E){_e(""),Y(W=>W.includes(E)?W.filter(ce=>ce!==E):W.length<20?[...W,E]:W)}function J(){
let E=$m({session_ids:O,content:te,confirmation:ge},me=>!!Ae[me]?.canReceiveBroadcast);if(!E.ok){_e(E.error);return}let W=Em(
E.sessionIds),ce={};E.sessionIds.forEach(me=>{let fe=w(me,E.content);ce[me]={...W[me],clientMessageId:fe,title:Ae[me]?.title||
me}}),he(ce),ie(""),z(""),_e("")}return React.createElement("div",{className:"fleet-view","data-testid":"fleet-view"},React.
createElement("div",{className:"automations-header fleet-view-header"},React.createElement("button",{className:"automati\
ons-back",onClick:h,title:"Back to sessions"},"\u2190"),React.createElement("div",{className:"automations-header-text"},
React.createElement("h2",null,"Fleet view"),React.createElement("p",null,"Live monitoring across every active harness se\
ssion."))),React.createElement("div",{className:"fleet-summary","aria-label":"Fleet summary"},React.createElement("div",
null,React.createElement("strong",null,be.length),React.createElement("span",null,"sessions")),React.createElement("div",
{className:Z?"working":""},React.createElement("strong",null,Z),React.createElement("span",null,"working")),React.createElement(
"div",{className:ue?"working-goal":""},React.createElement("strong",null,ue),React.createElement("span",null,"on goal")),
React.createElement("div",null,React.createElement("strong",null,de),React.createElement("span",null,"idle")),React.createElement(
"div",{className:Se?"attention":""},React.createElement("strong",null,Se),React.createElement("span",null,"need attentio\
n"))),React.createElement("div",{className:"fleet-filter-row"},React.createElement("span",null,Z," working now"),React.createElement(
"button",{type:"button",onClick:()=>x(E=>!E),"aria-pressed":$},$?"Hide idle sessions":`Show ${de} idle session${de===1?"":
"s"}`)),React.createElement("section",{className:"fleet-broadcast","data-testid":"broadcast-send"},React.createElement("\
div",{className:"fleet-broadcast-heading"},React.createElement("div",null,React.createElement("strong",null,"Broadcast p\
rompt"),React.createElement("span",null,"Select up to ",20," capable sessions.")),React.createElement("span",null,O.length,
" selected")),React.createElement("textarea",{value:te,onChange:E=>ie(E.target.value),maxLength:65536,placeholder:"Promp\
t every selected session...","aria-label":"Broadcast prompt"}),React.createElement("div",{className:"fleet-broadcast-con\
firm"},React.createElement("label",null,React.createElement("span",null,"Type ",React.createElement("strong",null,X)," t\
o confirm"),React.createElement("input",{value:ge,onChange:E=>z(E.target.value),"aria-label":"Broadcast confirmation"})),
React.createElement("button",{type:"button",onClick:J,disabled:!_||O.length===0||!te.trim()||ge!==X},"Send to ",O.length||
0)),ae&&React.createElement("div",{className:"fleet-broadcast-error",role:"alert"},ae),Object.keys(V).length>0&&React.createElement(
"div",{className:"fleet-broadcast-receipts","aria-label":"Broadcast delivery receipts"},Object.entries(V).map(([E,W])=>React.
createElement("span",{key:E,className:`fleet-broadcast-receipt ${W.status}`,title:W.title},React.createElement("strong",
null,W.title),React.createElement("em",null,W.status.replace(/_/g," ")))))),ee.length===0?React.createElement("div",{className:"\
fleet-empty"},React.createElement("strong",null,"Fleet is idle"),React.createElement("span",null,de," connected session",
de===1?" is":"s are"," idle. Show idle sessions to inspect them.")):React.createElement("div",{className:"fleet-grid"},ee.
map(E=>React.createElement("div",{role:"button",tabIndex:0,className:`fleet-card state-${E.state}${E.attention?" attenti\
on":""}${O.includes(E.id)?" selected":""}`,key:E.id,"data-session-id":E.id,"data-activity-state":E.state,"data-activity-\
lag-ms":E.activityLatencyMs??"",onClick:()=>g(E.id,E.session),onKeyDown:W=>{W.target===W.currentTarget&&(W.key==="Enter"||
W.key===" ")&&g(E.id,E.session)}},React.createElement("span",{className:"fleet-card-top"},React.createElement("span",{className:"\
agent-badge",style:{color:E.agent.color,borderColor:E.agent.color+"55",background:E.agent.color+"18"}},E.agent.logo?React.
createElement("img",{src:E.agent.logo,alt:"",className:"agent-badge-logo"}):E.agent.abbr),React.createElement("span",{className:"\
fleet-card-identity"},React.createElement("strong",null,E.title),React.createElement("span",null,E.agent.name)),React.createElement(
"span",{className:`fleet-health ${E.health}`,title:E.health}),React.createElement("label",{className:`fleet-select${E.canReceiveBroadcast?
"":" unavailable"}`,onClick:W=>W.stopPropagation()},React.createElement("input",{type:"checkbox",checked:O.includes(E.id),
disabled:!E.canReceiveBroadcast,onChange:()=>D(E.id),"aria-label":`Select ${E.title} for broadcast`}),React.createElement(
"span",null,E.canReceiveBroadcast?"Select":"Unavailable"))),React.createElement("span",{className:"fleet-card-status"},E.
working&&React.createElement(ei,{agentType:E.session?.agent_type,compact:!0,animate:!1}),React.createElement("span",{className:`\
fleet-state-badge ${E.state}`},E.stateLabel),React.createElement("strong",null,E.status),E.working&&React.createElement(
"time",null,By(E.activity,A))),React.createElement("span",{className:"fleet-freshness",title:"Proxy-to-Fleet delivery ti\
me"},"Activity ",E.freshness),(E.canControlGoal||E.goalBlocked||E.canInterrupt)&&React.createElement("span",{className:"\
fleet-control-actions",role:"group","aria-label":`Controls for ${E.title}`,onClick:W=>W.stopPropagation()},E.canControlGoal&&
React.createElement("button",{type:"button",onClick:()=>d(E.id,E.goalAction,E.goal,E.session),disabled:!_||!!T?.[E.id],"\
aria-label":`${E.goalAction==="pause"?"Pause":E.goalBlocked?"Resume blocked":"Resume"} goal for ${E.title}`,title:E.goalBlocked?
E.goalBlockedReason:void 0},T?.[E.id]?E.goalAction==="pause"?"Pausing...":"Resuming...":E.goalAction==="pause"?"Pause go\
al":E.goalBlocked?"Resume blocked goal":"Resume goal"),E.goalBlocked&&!E.canControlGoal&&React.createElement("button",{type:"\
button",disabled:!0,"aria-label":`Goal blocked for ${E.title}; resolve in the native session`,title:E.goalBlockedReason||
"No verified native unblock action is available"},"Goal blocked \xB7 native action required"),E.canInterrupt&&React.createElement(
"button",{type:"button",className:"danger",onClick:()=>M(E.id,E.session),disabled:!_||!!S?.[E.id],"aria-label":`Interrup\
t turn for ${E.title}`},S?.[E.id]?"Interrupting...":"Interrupt turn")),E.session?.agent_type==="codex_cli"&&E.config?.config_semantics===
"observed_and_next_send"&&React.createElement("span",{className:"fleet-freshness",title:"Native observation and pending \
next-send override"},"Observed ",E.config.observed_model_id||"unknown"," / ",E.config.observed_effort||"unknown"," \xB7 ",
"Next ",E.config.next_send_model_id||"unset"," / ",E.config.next_send_effort||"unset"),React.createElement("span",{className:`\
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
n"},"Open session ",React.createElement("span",{className:"fleet-jump-chevron","aria-hidden":"true"},"\u203A"))))))}function Uy({
onBack:e,onOpenResult:t}){let[n,s]=React.useState(""),[a,i]=React.useState(""),[c,u]=React.useState(""),[f,_]=React.useState(
""),[y,S]=React.useState(""),[T,w]=React.useState([]),[M,d]=React.useState(!0),[h,g]=React.useState(!1),[A,N]=React.useState(
"");async function $(x){if(x?.preventDefault(),!(n.trim().length<2||h)){g(!0),N("");try{let O=new URLSearchParams({q:n.trim(),
limit:"50"});a.trim()&&O.set("project",a.trim()),c.trim()&&O.set("harness",c.trim()),f&&O.set("date_from",f),y&&O.set("d\
ate_to",y);let Y=await fetch(`/api/search/messages?${O.toString()}`,{credentials:"same-origin"}),te=await Y.json().catch(
()=>({}));if(!Y.ok)throw new Error(te.error||"Transcript search failed.");w(Array.isArray(te.results)?te.results:[]),d(te.
index?.ready!==!1)}catch(O){w([]),N(O?.message||"Transcript search failed.")}finally{g(!1)}}}return React.createElement(
"div",{className:"transcript-search-view","data-testid":"transcript-search-view"},React.createElement("div",{className:"\
automations-header transcript-search-header"},React.createElement("button",{className:"skills-back",onClick:e,title:"Bac\
k to sessions"},"\u2190"),React.createElement("div",null,React.createElement("h2",null,"Transcript search"),React.createElement(
"p",null,"Search every relay-backed message."))),React.createElement("form",{className:"transcript-search-form",onSubmit:$},
React.createElement("label",{className:"transcript-search-query"},React.createElement("span",null,"Search text"),React.createElement(
"input",{value:n,onChange:x=>s(x.target.value),placeholder:"Words from any conversation",maxLength:200,autoFocus:!0})),React.
createElement("div",{className:"transcript-search-filters"},React.createElement("label",null,React.createElement("span",
null,"Project"),React.createElement("input",{value:a,onChange:x=>i(x.target.value),placeholder:"Exact workspace or proje\
ct",maxLength:300})),React.createElement("label",null,React.createElement("span",null,"Harness"),React.createElement("in\
put",{value:c,onChange:x=>u(x.target.value),placeholder:"e.g. codex_cli",maxLength:80})),React.createElement("label",null,
React.createElement("span",null,"From"),React.createElement("input",{type:"date",value:f,onChange:x=>_(x.target.value)})),
React.createElement("label",null,React.createElement("span",null,"To"),React.createElement("input",{type:"date",value:y,
onChange:x=>S(x.target.value)}))),React.createElement("button",{type:"submit",className:"transcript-search-submit",disabled:n.
trim().length<2||h},h?"Searching\u2026":"Search transcripts")),!M&&React.createElement("div",{className:"transcript-sear\
ch-indexing"},"Older history is still indexing; current results are partial."),A&&React.createElement("div",{className:"\
transcript-search-error",role:"alert"},A),!h&&!A&&T.length===0&&n.trim().length>=2&&React.createElement("div",{className:"\
fleet-empty"},React.createElement("strong",null,"No matches"),React.createElement("span",null,"Try fewer words or clear \
a filter.")),React.createElement("div",{className:"transcript-search-results","aria-live":"polite"},T.map(x=>React.createElement(
"button",{type:"button",className:"transcript-search-result",key:`${x.session_id}:${x.message_id}`,onClick:()=>t(x)},React.
createElement("span",{className:"transcript-search-result-top"},React.createElement("strong",null,x.workspace_name||x.project_root||
x.session_id),React.createElement("em",null,x.agent_type||"unknown"," \xB7 ",x.role)),React.createElement("span",{className:"\
transcript-search-snippet"},x.snippet||"(empty message)"),React.createElement("span",{className:"transcript-search-resul\
t-bottom"},React.createElement("time",null,x.matched_at?new Date(x.matched_at).toLocaleString():""),React.createElement(
"span",null,"Open match \u203A"))))))}function Gy({skills:e,onRefresh:t,onBack:n}){let s=e?.installed||[],a=e?.recommended||
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
React.createElement("div",{className:"skills-card-action available"},"+")))))))}var Ou=class extends React.Component{constructor(t){
super(t),this.state={error:null}}static getDerivedStateFromError(t){return{error:t}}componentDidCatch(t,n){try{console.error(
"Agent Chat render crash",t,n),sessionStorage.setItem("agent-chat:last-render-error",JSON.stringify({message:t?.message||
String(t),stack:t?.stack||"",componentStack:n?.componentStack||"",at:new Date().toISOString()}))}catch{}}render(){return this.
state.error?React.createElement("div",{className:"app-crash"},React.createElement("div",{className:"app-crash-card"},React.
createElement("div",{className:"app-crash-title"},"Agent Chat hit a render error"),React.createElement("div",{className:"\
app-crash-body"},this.state.error?.message||"Unknown UI error"),React.createElement("div",{className:"app-crash-actions"},
React.createElement("button",{className:"app-crash-btn",onClick:()=>location.reload()},"Refresh")))):this.props.children}},
qu=class extends React.Component{componentDidMount(){this.props.finishStructureChange(null)}getSnapshotBeforeUpdate(t){return t.
structureKey===this.props.structureKey?null:this.props.prepareStructureChange(t.placements,this.props.placements)}componentDidUpdate(t,n,s){
t.structureKey!==this.props.structureKey&&this.props.finishStructureChange(s)}render(){return this.props.children}};function Wy(){
React.useLayoutEffect(()=>{let r=typeof window<"u"?window.__RAC_TEMPORAL_CANARY__:null;if(!r?.active)return;let b=r.reactCommits||
(r.reactCommits=[]);b.length<2e4?b.push({sequence:b.length+1,at_epoch_ms:Date.now(),route:document.querySelector(".messa\
ges")?"chat":"other"}):r.droppedSamples=Number(r.droppedSamples||0)+1});let{sessions:e,messages:t,provisionalStreams:n,historyMeta:s,
historyLoading:a,connected:i,connectionHealth:c,unread:u,setUnread:f,thinking:_,thinkingContent:y,activities:S,health:T,
deliveryStates:w,launchStates:M,justLaunched:d,setJustLaunched:h,permissionPrompts:g,respondToPrompt:A,errorPrompts:N,respondToErrorPrompt:$,
interruptSession:x,controlGoal:O,agentConfigs:Y,configControlStates:te,requestAgentConfig:ie,setAgentModel:ge,setAgentEffort:z,
setAgentPermissionMode:ae,setAutoApprovePermissions:_e,setAntigravityMode:V,setCodexConfig:he,newThread:be,openPanel:ee,
openNativeWindow:Se,requestChatList:Z,switchChat:ue,newChat:de,chatLists:Ae,requestThreadList:X,switchThread:D,threadLists:J,
switchWorkspace:E,requestTerminalOutput:W,sendTerminalInput:ce,terminalOutputs:me,requestFileChanges:fe,respondToFileChange:we,
fileChanges:Le,sendAttachment:Ee,send:Ze,sendToSession:re,steerMessage:Me,discardQueuedMessage:B,editQueuedMessage:ne,queuedMessages:xe,
scheduledSends:He,scheduleSend:Et,cancelScheduledSend:mn,launchSession:F,resumeSession:Ct,closeSession:Vt,activeSessionRef:Sn,
restoreCachedTranscript:Wn,setSessionSubscriptions:zn,workspaces:ir,branchLists:so,requestBranchList:cr,switchBranch:wa,
createBranch:fs,skillLists:lr,requestSkillList:ur,automationViews:Lc,showCodexAutomation:ao,controlResults:Kn,directoryListings:ai,
requestDirectoryListing:ro,fileContents:dr,requestFileContent:Sa,requestHistory:oo,requestHistoryChunk:Na,duplicateProxyAlarms:Nn,
nightlyValidationFailures:ri,latestAppUpdateValidation:Cn,revalidationProgramHealth:io,operatorDogfoodHealth:Yt,providerUsage:oi,
providerUsageRefreshReceipt:js,requestProviderUsageRefresh:Ic,setProviderUsageWatching:Bs,providerUsageResetReceipt:Oc,consumeProviderUsageResetCredit:Ca,
providerUsageCostDetail:qc,requestProviderUsageCostDetail:Fs,hostResources:Pc,hostResourceError:co,hostResourceHistory:ii,
hostResourceDetails:Dc,hostResourceSubscription:xn,subscribeHostResources:gs,unsubscribeHostResources:Xt,requestHostResourceRefresh:Vn,
semanticNotifications:xa,sessionAliases:Lt}=gm(),[m,hs]=le(null),xt=React.useCallback(r=>xp(m,r),[m]),gt=React.useCallback(
()=>Xi(m),[m]),lo=React.useSyncExternalStore(xt,gt,gt),[An,pr]=le({}),[uo,Hs]=le({}),[Aa,lt]=le(!1),[Rn,ci]=le(""),[mr,po]=le(
""),[yt,It]=le(null),[fr,Us]=le({}),[_s,li]=le(iy),[Yn,ui]=le(!1),ht=ke(null),pt=ke({}),ot=ke(!1),[Ra,Xn]=le(!1),[Ma,At]=le(
!1),[Qn,et]=le(!1),[Jn,_t]=le(!1),[Ta,tt]=le(!1),[Bt,gr]=le(!1),[Gs,$a]=le(""),[at,Ot]=le({}),[Mn,di]=le(!1),[jc,Bc]=le(
""),[Fc,bs]=le(!1),[pi,vs]=le(!1),[Zn,Ea]=le(!1),[Ce,hr]=le(""),[ys,es]=le(0),[_r,Ws]=le(!1),[La,Tn]=le(!1),[fn,zs]=le({}),
[ks,mi]=le({}),[Ia,ws]=le({}),Oa=ke(new Map),[qa,mo]=le(null),kt=ke({sessionId:null,expiresAt:0}),it=ke(null),[Ss,ts]=le(
!1),[Ks,Qt]=le(0),[Pa,wt]=le(!1),[Ft,$n]=le(!0),[Ns,fo]=le({}),[gn,Jt]=le(!1),[Cs,xs]=le({}),[hn,Vs]=le({}),[go,As]=le({}),
[Zt,Ys]=le(!1),[ho,fi]=le(!1),[Xs,Rs]=le(!1),[Qs,ns]=le(!1),[Js,ss]=le(!1),[Ms,En]=le(!1),[Ts,Ln]=le(!1),[Zs,_n]=le(!1),
[ea,as]=le(!1),[ut,_o]=le(null),[rn,gi]=le(!1),[Hc,bo]=le("."),[vo,Da]=le(null),[br,vr]=le(null),hi=ke(null),[Uc,_i]=le(
0),yo=ke(null),[yr,Gc]=le(()=>{try{return localStorage.getItem("remote-agent-chat-theme")||"dark"}catch{return"dark"}}),
[en,Wc]=le(()=>{try{let r=JSON.parse(localStorage.getItem("remote-agent-chat:collapsed-directories:v1")||"[]");return Array.
isArray(r)?Object.fromEntries(r.map(b=>[String(b),!0])):{}}catch{return{}}}),[In,zc]=le(()=>{try{return localStorage.getItem(
ef)==="1"}catch{return!1}});Oe(()=>{try{localStorage.setItem(ef,In?"1":"0")}catch{}},[In]);let[ta]=le(()=>{try{let r=JSON.
parse(localStorage.getItem(uu)||"{}");return gc(r)}catch{return gc(mc)}});Oe(()=>{try{localStorage.setItem(uu,JSON.stringify(
ta))}catch{}},[ta]),Oe(()=>{fetch("/api/preferences/sessions",{credentials:"same-origin"}).then(r=>r.ok?r.json():Promise.
reject(new Error("Session settings unavailable"))).then(r=>{Ot(r.preferences||{}),di(!0)}).catch(()=>{})},[]),Oe(()=>{let r=!0;
return fetch("/api/preferences/notifications",{credentials:"same-origin"}).then(b=>b.ok?b.json():Promise.reject(new Error(
"Notification settings unavailable"))).then(b=>{r&&(li({...Gu,...b.preferences||{},turn_ready:!1}),ui(!0))}).catch(()=>{}),
()=>{r=!1}},[]),Oe(()=>{if(!_s.completion_sound)return;let r=()=>Wu();return document.addEventListener("pointerdown",r,{
once:!0}),document.addEventListener("keydown",r,{once:!0}),()=>{document.removeEventListener("pointerdown",r),document.removeEventListener(
"keydown",r)}},[_s.completion_sound]);async function bi(r,b){let R=await fetch(`/api/preferences/sessions/${encodeURIComponent(
r)}`,{method:"PUT",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({preference:b})}),
C=await R.json().catch(()=>({}));if(!R.ok)throw new Error(C.error||"Unable to save session settings.");return Ot(q=>({...q,
[r]:C.preference})),C.preference?.archived&&m===r&&hs(null),C.preference}async function Kc(r,b){let R=await fetch(`/api/\
sessions/${encodeURIComponent(r)}/export?format=${encodeURIComponent(b)}`,{credentials:"same-origin"});if(!R.ok){let Ne=await R.
json().catch(()=>({}));throw new Error(Ne.error||"Unable to export session.")}let q=(R.headers.get("Content-Disposition")||
"").match(/filename\*=UTF-8''([^;]+)/i)?.[1],G=`session.${b==="json"?"json":"md"}`;if(q)try{G=decodeURIComponent(q)}catch{}
let Q=URL.createObjectURL(await R.blob()),se=document.createElement("a");se.href=Q,se.download=G,se.hidden=!0,document.body.
appendChild(se),se.click(),se.remove(),setTimeout(()=>URL.revokeObjectURL(Q),1e3)}Oe(()=>{try{let r=Object.keys(en).filter(
b=>en[b]);localStorage.setItem("remote-agent-chat:collapsed-directories:v1",JSON.stringify(r))}catch{}},[en]);let vi=React.
useCallback(r=>{Wc(b=>({...b,[r]:!b[r]}))},[]),yi=ke(Me);Oe(()=>{yi.current=Me},[Me]);let ki=React.useCallback((r,b)=>{m&&
yi.current(m,r,b)},[m]),wi=ke(re);Oe(()=>{wi.current=re},[re]);let Si=React.useCallback(r=>{!m||!r?._cid||wi.current(m,r.
content,r._cid)},[m]),kr=ke(Sa);Oe(()=>{kr.current=Sa},[Sa]);let na=React.useMemo(()=>[...e||[]].map(r=>{let b=qe(r),R=at[b];
return R?.display_name?typeof r=="object"?{...r,custom_display_name:R.display_name}:{session_id:b,custom_display_name:R.
display_name}:r}),[e,at]),On=React.useMemo(()=>new Set(na.filter(du).map(qe)),[na]),ko=React.useMemo(()=>na.filter(r=>!du(
r)),[na]),ja=In?na:ko,je=React.useMemo(()=>ja.filter(r=>!at[qe(r)]?.archived),[ja,at]),o=React.useMemo(()=>ko.filter(r=>!at[qe(
r)]?.archived),[ko,at]),p=qv(S,je),k=React.useMemo(()=>({activities:S,thinking:_,pendingPrompts:g,errorPrompts:Object.fromEntries(
Object.entries(N||{}).filter(([,r])=>Zr(r))),health:T,connected:i,nowMs:p,requireFreshness:!0}),[S,_,g,N,T,i,p]),I=React.
useMemo(()=>wm(k),[k]),{working:l,states:v}=React.useMemo(()=>km(je,I),[je,I]),L=ke(null),P=ke(null),K=ke(null),U=ke(0),
pe=ke(null),ve=ke(null),Re=ke(null),We=ke(!1),st=ke(0),Ht=ke(null),Pe=ke(0),Te=ke(""),[Ue,Je]=le(!1),Ye=React.useCallback(
()=>{K.current&&clearTimeout(K.current),K.current=null,Je(!0)},[]),on=React.useCallback((r=0)=>{K.current&&clearTimeout(
K.current),K.current=setTimeout(()=>{K.current=null,Je(!1)},r)},[]);React.useEffect(()=>{let r=()=>on(80);return window.
addEventListener("pointerup",r,!0),window.addEventListener("pointercancel",r,!0),()=>{window.removeEventListener("pointe\
rup",r,!0),window.removeEventListener("pointercancel",r,!0),K.current&&clearTimeout(K.current),ve.current&&cancelAnimationFrame(
ve.current),Re.current&&cancelAnimationFrame(Re.current),st.current&&cancelAnimationFrame(st.current)}},[on]);let{sessions:Rt}=Iv(
l,Ue,React.useMemo(()=>({nowMs:p,entryConfirmMs:2e3,exitGraceMs:1e4,immediateExitIds:new Set(Object.entries(v).filter(([
,r])=>r==="idle"||r==="needs_attention").map(([r])=>r))}),[p,v])),St=React.useMemo(()=>new Set(Rt.map(qe)),[Rt]),{pinned:cn}=React.
useMemo(()=>_m(je,at),[je,at]),bn=React.useMemo(()=>new Set(cn.map(qe)),[cn]),wr=React.useMemo(()=>Vl(je,{workingSessionIds:St,
pinnedSessionIds:bn}),[je,St,bn]),Sr=Ov([...wr.recent,...wr.pinned,...wr.remaining],Ue),zu=React.useMemo(()=>Sr.map(qe),
[Sr]),Ni=React.useMemo(()=>Vl(je,{workingSessionIds:St,pinnedSessionIds:bn,recentSessionIds:zu}),[je,St,bn,zu]),vn=Ni.recent,
Kf=React.useMemo(()=>new Set(vn.map(qe)),[vn]),rs=Ni.pinned,Vf=React.useMemo(()=>mu(Ni.remaining,Y,ta),[Ni.remaining,Y,ta]),
Nr=React.useMemo(()=>Object.fromEntries(mu(je,Y,ta).flatMap(r=>r.sessions.map(b=>[qe(b),r.label]))),[je,Y,ta]),Yf=React.
useMemo(()=>({...k,messages:t,rankWorking:!1}),[k,t]),{groups:Ku,orderChanged:Ci,sortNow:Vu}=Tv(Vf,Yf,Ue),qn=React.useMemo(
()=>Ku.filter(r=>r.sessions.length>0),[Ku]),Xf=React.useMemo(()=>new Set(qn.flatMap(r=>r.sessions.map(qe))),[qn]),Qf=React.
useCallback(()=>{let r=L.current,b=m?r?.querySelector(`[data-session-id="${CSS.escape(m)}"]`):null;P.current=b?{sessionId:m,
top:b.getBoundingClientRect().top}:null,Vu()},[m,Vu]),bt=Rn.trim().toLowerCase(),Yu=React.useMemo(()=>Object.fromEntries(
je.map(r=>{let b=qe(r),R=to(r,Y[b]);return[b,[Zo(r,b,Y[b],t[b]||[]),eo(r,b,Y[b]),Nr[b]||"Unscoped",at[b]?.pinned?"Pinned":
"",R.name,r?.agent_type,r?.workspace_name,r?.workspace_path,b].filter(Boolean).join(" ").toLowerCase()]})),[je,Y,t,Nr,at]),
sa=React.useCallback(r=>bt?r.filter(b=>(Yu[qe(b)]||"").includes(bt)):r,[bt,Yu]),Cr=React.useMemo(()=>sa(Rt),[sa,Rt]),xr=React.
useMemo(()=>sa(vn),[sa,vn]),Ar=React.useMemo(()=>sa(rs),[sa,rs]),Xu=React.useMemo(()=>qn.map(r=>({...r,sessions:sa(r.sessions)})).
filter(r=>r.sessions.length>0),[sa,qn]),Qu=React.useMemo(()=>[...Rt,...vn,...rs,...qn.flatMap(r=>r.sessions)],[Rt,vn,rs,
qn]),Vc=React.useMemo(()=>{let r=new Set;return je.filter(b=>{let R=qe(b);return!R||r.has(R)?!1:(r.add(R),!0)})},[je]),Ju=React.
useMemo(()=>new Set(Vc.map(qe)),[Vc]),Jf=React.useMemo(()=>{let r=new Map,b=(R,C)=>{for(let q of R){let G=qe(q);G&&!r.has(
G)&&r.set(G,C)}};b(Rt,"working"),b(vn,"recent"),b(rs,"pinned");for(let R of qn)b(R.sessions,`workspace:${R.key}`);return r},
[Rt,vn,rs,qn]),Yc=React.useMemo(()=>[`working:${Rt.map(qe).join(",")}`,`recent:${vn.map(qe).join(",")}`,`pinned:${rs.map(
qe).join(",")}`,...qn.map(r=>`${r.key}:${r.sessions.map(qe).join(",")}`),`collapsed:${Object.keys(en).filter(r=>en[r]).sort().
join(",")}`,`filter:${bt}`].join("|"),[Rt,vn,rs,qn,en,bt]),Zu=`${Yc}${m||""}`;Te.current!==Zu&&(Te.current=Zu,Pe.current+=
1);let xi=React.useCallback((r,b,R,C={})=>{if(!r)return!1;let q=Math.max(0,r.scrollHeight-r.clientHeight),G=Math.max(0,Math.
min(Number(b)||0,q)),Q=r.scrollTop;return Math.abs(Q-G)<.5?!0:We.current?!1:(We.current=!0,st.current&&cancelAnimationFrame(
st.current),st.current=requestAnimationFrame(()=>{We.current=!1,st.current=0}),pe.current={target:G},Mu(r,G,{container:"\
sidebar",writer:"sidebar-scroll-coordinator",reason:R,interactionEpoch:U.current,sessionId:m,anchorId:C.anchorSessionId||
null,anchorOffset:C.anchorOffset,payloadGeneration:Pe.current}),r.dispatchEvent(new CustomEvent("rac-sidebar-scroll-corr\
ection",{detail:{from:Q,to:r.scrollTop,reason:R,anchorSessionId:C.anchorSessionId||null,explicitSort:C.explicitSort===!0,
interactionEpoch:U.current,payloadGeneration:Pe.current}})),ve.current&&cancelAnimationFrame(ve.current),ve.current=requestAnimationFrame(
()=>{pe.current=null,ve.current=null}),!0)},[m,Yc]),aa=ke(new Map),Ai=ke(null),Zf=React.useCallback((r,b)=>{let R=L.current;
if(!R)return null;Re.current&&(cancelAnimationFrame(Re.current),Re.current=null),R.classList.add("sidebar-structural-tra\
nsaction");let C=document.activeElement,q=C instanceof Element?C.closest("[data-sidebar-card-host]"):null,G=R.getBoundingClientRect(),
Q=Array.from(R.querySelectorAll("[data-session-id]")),se=C instanceof Element?C.closest("[data-session-id]"):null,Ne=Q.filter(
ze=>{let un=ze.getBoundingClientRect();return un.bottom>G.top&&un.top<G.bottom}),Ge=[...se&&Ne.includes(se)?[se]:[],...Ne.
filter(ze=>ze!==se)].map(ze=>({sessionId:ze.dataset.sessionId,top:ze.getBoundingClientRect().top})),Tt=R.scrollTop,qt=[];
for(let[ze,un]of r){let Fn=b.get(ze);if(!Fn||Fn===un)continue;let Wt=aa.current.get(ze);Wt&&qt.push(Wt)}if(qt.length>0){
let ze=Ai.current;ze||(ze=document.createElement("div"),ze.setAttribute("data-sidebar-card-pool",""),Object.assign(ze.style,
{position:"fixed",left:"-10000px",top:"-10000px",width:"1px",height:"1px",overflow:"hidden",pointerEvents:"none"}),document.
body.appendChild(ze),Ai.current=ze);for(let un of qt){let Fn=un.closest("[data-sidebar-card-slot]");if(Fn){let Wt=un.querySelector(
"[data-session-id]"),jo=Wt?getComputedStyle(Wt):null,Ui=Wt?Wt.getBoundingClientRect().height+(Number.parseFloat(jo?.marginTop)||
0)+(Number.parseFloat(jo?.marginBottom)||0):0;Fn.style.display="block",Fn.style.height=`${Ui}px`,Fn.setAttribute("data-s\
idebar-card-placeholder","")}ze.appendChild(un)}}return q&&C?.isConnected&&document.activeElement!==C&&C.focus({preventScroll:!0}),
{candidates:Ge,scrollTop:Tt,interactionEpoch:U.current,focusedElement:q?C:null,focusedHost:q,movedHostCount:qt.length}},
[]),eg=React.useCallback(r=>{let b=L.current;if(!b)return;let R=r?.focusedElement||document.activeElement,C=r?.focusedHost||
(R instanceof Element?R.closest("[data-sidebar-card-host]"):null),q=new Set;for(let se of b.querySelectorAll("[data-side\
bar-card-slot]")){let Ne=se.getAttribute("data-sidebar-card-slot")||"",Xe=aa.current.get(Ne);if(!(!Ne||!Xe)&&(q.add(Ne),
Xe.parentElement!==se)){let Fe=C===Xe&&R?.isConnected;se.appendChild(Xe),Fe&&document.activeElement!==R&&R.isConnected&&
R.focus({preventScroll:!0})}}let G=P.current,Q=G?{candidates:[G],scrollTop:b.scrollTop,interactionEpoch:U.current}:r;if(Q&&
Q.interactionEpoch===U.current){let Ne=(Array.isArray(Q.candidates)?Q.candidates:[]).map(Ge=>({...Ge,card:Array.from(b.querySelectorAll(
"[data-session-id]")).find(Tt=>Tt.dataset.sessionId===Ge.sessionId)})).find(Ge=>Ge.card),Xe=null,Fe=null;if(Ne){let Ge=Ne.
card.getBoundingClientRect().top-Ne.top;Math.abs(Ge)>.5&&(Xe=b.scrollTop+Ge),Fe=Ne.sessionId}else Number.isFinite(Q.scrollTop)&&
(Xe=Q.scrollTop);if(Xe!=null){let Ge=Math.max(0,Math.min(Xe,Math.max(0,b.scrollHeight-b.clientHeight)));Math.abs(b.scrollTop-
Ge)>.5&&xi(b,Ge,G?"operator-sidebar-sort-anchor":"sidebar-structure-anchor",{anchorSessionId:Fe,anchorOffset:Ne?.top,explicitSort:!!G})}}
P.current=null;for(let[se,Ne]of aa.current)q.has(se)||Ju.has(se)||(Ne.remove(),aa.current.delete(se));r?.focusedElement?.
isConnected&&document.activeElement!==r.focusedElement&&r.focusedElement.focus({preventScroll:!0}),Re.current=requestAnimationFrame(
()=>{Re.current=requestAnimationFrame(()=>{b.classList.remove("sidebar-structural-transaction"),Re.current=null})})},[Ju,
xi]),Ba=React.useCallback(()=>{let r=L.current;if(!r)return null;let b=r.getBoundingClientRect(),R=Array.from(r.querySelectorAll(
"[data-session-id]")).find(q=>{let G=q.getBoundingClientRect();return G.bottom>b.top+1&&G.top<b.bottom-1})||null,C=R?{sessionId:R.
dataset.sessionId||null,offset:R.getBoundingClientRect().top-b.top,interactionEpoch:U.current}:null;return Ht.current=C,
C},[]);React.useLayoutEffect(()=>{let r=L.current;if(!r||typeof ResizeObserver>"u")return;Ba();let b=0,R=()=>{b||(b=requestAnimationFrame(
()=>{b=0;let Q=Ht.current;if(!Q||Q.interactionEpoch!==U.current){Ba();return}let se=L.current,Ne=se&&Array.from(se.querySelectorAll(
"[data-session-id]")).find(Ge=>Ge.dataset.sessionId===Q.sessionId);if(!se||!Ne){Ba();return}let Fe=Ne.getBoundingClientRect().
top-se.getBoundingClientRect().top-Q.offset;Math.abs(Fe)>.5&&xi(se,se.scrollTop+Fe,"sidebar-row-resize-anchor",{anchorSessionId:Q.
sessionId,anchorOffset:Q.offset}),Ba()}))},C=new ResizeObserver(R),q=Q=>{Q?.nodeType===1&&Q.matches?.("[data-session-id]\
, .session-group-header, .sidebar-order-control")&&C.observe(Q),Q?.nodeType===1&&Q.querySelectorAll?.("[data-session-id]\
, .session-group-header, .sidebar-order-control").forEach(se=>C.observe(se))};Array.from(r.children).forEach(q);let G=new MutationObserver(
Q=>{Q.forEach(se=>{Array.from(se.removedNodes||[]).forEach(Ne=>{Ne?.nodeType===1&&C.unobserve(Ne)}),Array.from(se.addedNodes||
[]).forEach(q)}),R()});return G.observe(r,{childList:!0,subtree:!0}),()=>{G.disconnect(),C.disconnect(),b&&cancelAnimationFrame(
b)}},[Ba,xi]),Oe(()=>()=>{for(let r of aa.current.values())r.remove();aa.current.clear(),Ai.current?.remove(),Ai.current=
null,P.current=null},[]);let Fa=React.useCallback(r=>r.reduce((b,R)=>{let C=qe(R);return b.unread+=On.has(C)?0:u[C]||0,b.
hasPrompt=b.hasPrompt||!!g[C]||!!Zr(N[C]),b.working=b.working||Qa(v[C]),b},{unread:0,hasPrompt:!1,working:!1}),[On,u,g,N,
v]),wo=React.useMemo(()=>Fa(Cr),[Fa,Cr]),Rr=React.useMemo(()=>Fa(xr),[Fa,xr]),Mr=React.useMemo(()=>Fa(Ar),[Fa,Ar]),$s=React.
useMemo(()=>Qu.map(r=>{let b=qe(r),R=to(r,Y[b]),C=Zo(r,b,Y[b],t[b]||[]),q=eo(r,b,Y[b]),G=Nr[b]||"Unscoped",Q=[C,q,G,at[b]?.
pinned?"Pinned":"",R.name,r?.agent_type,r?.workspace_name,r?.workspace_path,b].filter(Boolean);return{id:b,session:r,groupLabel:G,
title:C,subtitle:q,agentName:R.name,agentColor:R.color,working:Qa(v[b]),searchFields:Q,searchText:Q.join(" ")}}),[Qu,Nr,
at,Y,t,v]),Ut=React.useMemo(()=>Rv($s,Ce).slice(0,60),[$s,Ce]);Oe(()=>{es(r=>Math.max(0,Math.min(r,Ut.length-1)))},[Ut.length]),
Oe(()=>{if(!Zn)return;let r=requestAnimationFrame(()=>{yo.current?.focus(),yo.current?.select()});return()=>cancelAnimationFrame(
r)},[Zn]),Oe(()=>{Zn&&document.getElementById(`quick-switcher-option-${ys}`)?.scrollIntoView({block:"nearest"})},[ys,Zn]),
Oe(()=>{let r=()=>{Ea(!1),hr(""),es(0),requestAnimationFrame(()=>Pn.current?.focus())},b=C=>{C&&(is(C.id,C.session),lt(!1),
r())},R=C=>{let q=oe(C.key).toLowerCase();if((C.metaKey||C.ctrlKey)&&!C.altKey&&q==="p"){C.preventDefault(),Ws(!1),Ea(!0);
return}if(Zn){C.key==="Escape"?(C.preventDefault(),r()):C.key==="ArrowDown"?(C.preventDefault(),es(G=>Ut.length?(G+1)%Ut.
length:0)):C.key==="ArrowUp"?(C.preventDefault(),es(G=>Ut.length?(G-1+Ut.length)%Ut.length:0)):C.key==="Enter"&&Ut.length>
0&&(C.preventDefault(),b(Ut[ys]||Ut[0]));return}if(_r){(C.key==="Escape"||C.key==="?"&&!Tu(C.target))&&(C.preventDefault(),
Ws(!1),requestAnimationFrame(()=>Pn.current?.focus()));return}if(C.altKey&&!C.ctrlKey&&!C.metaKey&&(C.key==="ArrowUp"||C.
key==="ArrowDown")){if($s.length===0)return;C.preventDefault();let G=$s.findIndex(Xe=>Xe.id===m),Q=C.key==="ArrowDown"?1:
-1,se=Q>0?-1:0,Ne=(Math.max(G,se)+Q+$s.length)%$s.length;b($s[Ne]);return}C.key==="?"&&!C.altKey&&!C.ctrlKey&&!C.metaKey&&
!Tu(C.target)&&(C.preventDefault(),Ws(!0))};return window.addEventListener("keydown",R),()=>window.removeEventListener("\
keydown",R)},[m,ys,$s,Zn,Ut,_r]);let j=React.useMemo(()=>je.find(r=>qe(r)===m),[je,m]),So=!!j?.is_new_chat_draft,Tr=!Qs&&
!Js&&!Ms&&!Ts&&!Zs&&!ea,Xc=React.useMemo(()=>{let r=hn[m],b=(J[m]||[]).find(q=>q?.active),R=b?.cache_key||b?.id,C=Cs[m]||
So?"draft":"";return`${m||"none"}:${C||r||R||"default"}`},[m,J,hn,Cs,So]),ra=m?lo:tf,tn=m&&n[m]||null,ed=fm(j,ra),ln=m?S[m]:
null,tg=m&&y[m]||"",Es=m&&g[m]||null,Ri=m&&N[m]||null,ng=[m||"",tn?.messageId||"",tn?.content?.length||0,ln?.kind||"",ln?.
thinking?.native_source_id||"",ln?.thinking?.text||tg||"",ln?.current?.native_source_id||"",ln?.current?.text||ln?.current?.
content||"",ln?.step?.native_source_id||ln?.step?.id||"",ln?.step?.text||ln?.step?.label||"",Es?.prompt_id||Es?.id||"",Ri?.
request_id||Ri?.id||""].join(""),Ha={sessionId:m,messageCount:ra.length,provisionalId:tn?.messageId||"",provisionalLength:tn?.
content?.length||0},sg=ke(null),nn=ke(null),Mi=ke(!0),vt=ke(!0),sn=ke(!1),No=ke(0),Qc=ke(0),Jc=ke(0),Zc=ke(0),td=ke(""),
Ti=ke(!1),Ua=ke(0),$i=ke(null),Co=ke(0),xo=ke(0),el=ke(null),tl=ke(null),ag=ke({activeSemanticKey:"",lastClearedSemanticKey:"",
clearedAt:0}),$r=ke(m),nd=ke(m),Ls=ke({sessionId:null,keys:[],scrollTop:0,scrollHeight:0,clientHeight:0,atBottom:!0}),Er=ke(
null),Ao=ke(0),Pn=ke(null),nl=ke(()=>!1),Is=ke(null),rg=ke(null),sl=ke(Ha),al=ke(Ha),os=ke({}),Os=ke({sessionId:null,index:0,
scratch:""}),rl=ke(i),ol=ke({}),sd=ke({});sl.current=Ha;let ad=[m||"",Ha.messageCount,Ha.provisionalId,Ha.provisionalLength,
Es?.prompt_id||Es?.id||Es?.request_id||"",Es?.generation||"",Ri?.id||Ri?.request_id||"",ln?.kind||"",ln?.thinking?.native_source_id||
"",ln?.current?.native_source_id||""].join("");td.current!==ad&&(td.current=ad,Zc.current+=1),nl.current=()=>sn.current||
!!Es||Date.now()<No.current,Is.current=(r,b,R,C={})=>{if(!r)return!1;let q=String(R||"unspecified"),G=C.allowWhenUserOwned===
!0,Q=C.allowDuringPrompt===!0;if(sn.current&&!G||Date.now()<No.current&&!G||Es&&!Q&&!G)return!1;if(C.releaseUserOwnership===
!0)sn.current=!1,vt.current=!0;else if(C.takeUserOwnership===!0){let ze=r.scrollHeight-Number(b||0)-r.clientHeight;sn.current=
ze>=80,vt.current=ze<80}let se=r.scrollTop,Ne=Math.max(0,r.scrollHeight-r.clientHeight),Xe=vt.current&&!sn.current,Fe=/^(?:operator-|route-|genuine-prompt)/.
test(q),Ge=Xe&&!Fe?r.scrollHeight:b,Tt=Math.max(0,Math.min(Number(Ge)||0,Ne));if(Math.abs(se-Tt)<.5)return!0;if(Ti.current)
return $i.current={element:r,value:b,reason:q,options:C},!0;Ti.current=!0,Ua.current&&cancelAnimationFrame(Ua.current),Ua.
current=requestAnimationFrame(()=>{Ti.current=!1,Ua.current=0;let ze=$i.current;$i.current=null,ze?.element?.isConnected&&
Is.current?.(ze.element,ze.value,ze.reason,ze.options)}),Qc.current=Date.now()+800,Mu(r,Tt,{container:"transcript",writer:"\
transcript-scroll-coordinator",reason:q,interactionEpoch:Jc.current,sessionId:$r.current,anchorId:C.anchorId||null,anchorOffset:C.
anchorOffset,payloadGeneration:Zc.current});let qt=typeof window<"u"?window.__RAC_TEMPORAL_CANARY__:null;if(qt?.active){
let ze=qt.transcriptScrollWrites||(qt.transcriptScrollWrites=[]);ze.length<1e4&&ze.push({at_epoch_ms:Date.now(),session_id:$r.
current,reason:q,from:se,requested:Tt,user_owned:sn.current,interaction_epoch:Jc.current,payload_generation:Zc.current})}
return!0},ka(()=>{$r.current=m},[m]),ka(()=>{let r=Object.values(Lt||{});if(r.length===0)return;let b=(R,C,q,G=(Q,se)=>Q??
se)=>{R(Q=>{if(!Q||!Object.prototype.hasOwnProperty.call(Q,C))return Q;let se={...Q};return se[q]=G(se[q],se[C]),delete se[C],
se})};for(let R of r){let C=R?.alias_session_id,q=R?.canonical_session_id;!C||!q||C===q||(b(pr,C,q,(G,Q)=>typeof G=="str\
ing"&&G.length>0?G:Q||""),b(Hs,C,q,(G,Q)=>{let se=[...Array.isArray(G)?G:[],...Array.isArray(Q)?Q:[]];return[...new Map(
se.map(Ne=>[`${Ne?.name||""}:${Ne?.size||Ne?.content?.length||0}`,Ne])).values()]}),b(Us,C,q,(G,Q)=>G||Q),b(Ot,C,q,(G,Q)=>({
...Q||{},...G||{}})),Gs===C&&$a(q),It(G=>G?.sessionId===C?{...G,sessionId:q}:G),os.current[C]&&(os.current[q]=[...os.current[q]||
[],...os.current[C]],delete os.current[C]),Os.current.sessionId===C&&(Os.current={...Os.current,sessionId:q}),m===C&&(Ls.
current={...Ls.current,sessionId:q},Er.current?.sessionId===C&&(Er.current={...Er.current,sessionId:q}),$r.current=q,Sn.
current=q,hs(q)))}},[Lt,m,Gs]),Oe(()=>{let r=R=>{try{sessionStorage.setItem("agent-chat:last-window-error",JSON.stringify(
{message:R?.error?.message||R?.message||"Unknown window error",stack:R?.error?.stack||"",at:new Date().toISOString()}))}catch{}},
b=R=>{try{let C=R?.reason;sessionStorage.setItem("agent-chat:last-promise-error",JSON.stringify({message:C?.message||oe(
C,"Unhandled promise rejection"),stack:C?.stack||"",at:new Date().toISOString()}))}catch{}};return window.addEventListener(
"error",r),window.addEventListener("unhandledrejection",b),()=>{window.removeEventListener("error",r),window.removeEventListener(
"unhandledrejection",b)}},[]),Oe(()=>{try{let r=localStorage.getItem(Zm);r&&pr(JSON.parse(r))}catch{}},[]),Oe(()=>{try{localStorage.
setItem(Zm,JSON.stringify(An))}catch{}},[An]),Oe(()=>{try{localStorage.setItem("remote-agent-chat-theme",yr)}catch{}document.
documentElement.setAttribute("data-theme",yr)},[yr]),Oe(()=>{if(!m&&je.length>0){let r=new URLSearchParams(window.location.
search).get("session"),b=Lt?.[r]?.canonical_session_id||r,R=b?je.find(G=>qe(G)===b):null,C=R||je[0],q=qe(C);q&&(is(q,C),
R&&window.history.replaceState({},"",window.location.pathname))}},[je,m,Lt]),Oe(()=>{if(!("serviceWorker"in navigator))return;
let r=b=>{if(b.data?.type!=="push_notification_clicked")return;let R=b.data.data?.session_id,C=Lt?.[R]?.canonical_session_id||
R,q=je.find(G=>qe(G)===C);C&&q&&is(C,q)};return navigator.serviceWorker.addEventListener("message",r),()=>navigator.serviceWorker.
removeEventListener("message",r)},[je,Lt]),Oe(()=>{if(!d)return;let r=je.find(b=>(typeof b=="string"?b:b?.session_id)===
d);r&&(is(d,r),h(null))},[d,je]),Oe(()=>{let r=nn.current;if(!r)return;let b=nd.current!==m;nd.current=m,b&&(sn.current=
!1,vt.current=!0);let R=null,C=(Fe=!0)=>{No.current=Date.now()+1200,Jc.current+=1,Qc.current=0,Co.current+=1,Fe&&(sn.current=
!0),vt.current&&(al.current=sl.current,Qt(0))},q=Fe=>{if(Math.abs(Fe.deltaY)<=1)return;let Ge=r.scrollHeight-r.scrollTop-
r.clientHeight<80;C(Fe.deltaY<0||!Ge)},G=Fe=>{let Ge=r.getBoundingClientRect();Fe.clientX>=Ge.right-16&&C()},Q=Fe=>{R=Fe.
touches?.[0]?.clientY??null},se=Fe=>{let Ge=Fe.touches?.[0]?.clientY??null;if(R!=null&&Ge!=null&&Math.abs(Ge-R)>4){let Tt=r.
scrollHeight-r.scrollTop-r.clientHeight<80;C(Ge>R||!Tt)}},Ne=Fe=>{if(!Fe.target?.closest?.('textarea, input, [contentedi\
table="true"]')&&["ArrowUp","ArrowDown","PageUp","PageDown","Home","End"," "].includes(Fe.key)){let Tt=r.scrollHeight-r.
scrollTop-r.clientHeight<80,qt=["ArrowUp","PageUp","Home"].includes(Fe.key);C(qt||!Tt)}},Xe=()=>{let Fe=r.scrollHeight-r.
scrollTop-r.clientHeight<80,Ge=Date.now(),Tt=Ge<No.current,qt=Ge<Qc.current;Mi.current=Fe,Fe?(vt.current=!0,Tt&&!qt&&(sn.
current=!1)):Tt&&!qt&&(vt.current=!1,sn.current=!0,xo.current=0),Tt&&!qt&&r.scrollTop<160&&el.current?.(),ts(!Fe&&!vt.current),
Ls.current={...Ls.current,scrollTop:r.scrollTop,scrollHeight:r.scrollHeight,clientHeight:r.clientHeight,atBottom:Fe||vt.
current}};return r.addEventListener("scroll",Xe,{passive:!0}),r.addEventListener("wheel",q,{passive:!0}),r.addEventListener(
"touchstart",Q,{passive:!0}),r.addEventListener("touchmove",se,{passive:!0}),r.addEventListener("pointerdown",G,{passive:!0}),
window.addEventListener("keydown",Ne),()=>{r.removeEventListener("scroll",Xe),r.removeEventListener("wheel",q),r.removeEventListener(
"touchstart",Q),r.removeEventListener("touchmove",se),r.removeEventListener("pointerdown",G),window.removeEventListener(
"keydown",Ne),Ua.current&&(cancelAnimationFrame(Ua.current),Ua.current=0),Ti.current=!1,$i.current=null}},[m,Xc,Tr]);function il(r,b=0,{
operatorInitiated:R=!1}={}){let C=m,q=Co.current+1;Co.current=q;let G=()=>{let Ne=nn.current;return!Ne||$r.current!==C||
Co.current!==q||!Is.current?.(Ne,Ne.scrollHeight,R?"operator-jump-to-live-edge":"live-edge-pin",R?{allowWhenUserOwned:!0,
releaseUserOwnership:!0}:{})?!1:(vt.current=!0,al.current=sl.current,Mi.current=!0,ts(!1),Qt(0),Ls.current={sessionId:C,
keys:r,scrollTop:Ne.scrollTop,scrollHeight:Ne.scrollHeight,clientHeight:Ne.clientHeight,atBottom:!0},!0)};G();let Q=Math.
max(0,b),se=()=>{Q<=0||(Q-=1,G()&&requestAnimationFrame(se))};Q>0&&requestAnimationFrame(se)}function og(){if(!nn.current)
return;let b=nf(ra);xo.current=Date.now()+5e3,il(b,2,{operatorInitiated:!0})}ka(()=>{let r=nn.current;if(!r)return;let b=nf(
ra),R=Ls.current||{},C=R.sessionId===m,q=Array.isArray(R.keys)?R.keys:[],G=q[0]||null,Q=q[q.length-1]||null,se=G?b.indexOf(
G):-1,Ne=Q?b.indexOf(Q):-1,Xe=!!(C&&b.length===q.length&&b.every((Fn,Wt)=>Fn===q[Wt])),Fe=(Number(R.scrollHeight)||0)-(Number(
R.scrollTop)||0)-(Number(R.clientHeight)||0),Ge=Date.now()<xo.current,Tt=Ge||vt.current||R.atBottom!==!1||Fe<120,qt=!!(C&&
q.length&&se>0&&Ne>=se);if(!nl.current()){if(!(Xe&&!Ge))if(!C)vr(null),sn.current=!1,vt.current=!0,il(b,1);else if(qt){if(vt.
current=!1,xo.current=0,r.dataset.transcriptWindowed!=="true"){let Fn=r.scrollHeight-(Number(R.scrollHeight)||0),Wt=tl.current,
jo=Wt?Array.from(r.querySelectorAll(".message[data-message-key]")).find(Fd=>Fd.dataset.messageKey===Wt.messageKey):null,
Ui=Math.max(0,(Number(R.scrollTop)||0)+Fn),Bd="history-prepend-compensation";if(jo){let Hd=jo.getBoundingClientRect().top-
Wt.viewportTop;Math.abs(Hd)>=.5&&(Ui=Math.max(0,r.scrollTop+Hd),Bd="history-prepend-anchor-correction")}Is.current?.(r,Ui,
Bd,{anchorId:Wt?.messageKey||null,anchorOffset:Wt?.viewportTop}),tl.current=null}}else Tt&&il(b)}let un=r.scrollHeight-r.
scrollTop-r.clientHeight<80;Mi.current=un,ts(!un&&!vt.current),Qt(un||vt.current?0:Mv(al.current,Ha)),Ls.current={sessionId:m,
keys:b,scrollTop:r.scrollTop,scrollHeight:r.scrollHeight,clientHeight:r.clientHeight,atBottom:un||vt.current}},[m,ra]),React.
useLayoutEffect(()=>{let r=nn.current;!r||sn.current||!vt.current||Es||Is.current?.(r,r.scrollHeight,"live-edge-semantic\
-geometry")},[m,ng]),Oe(()=>{m&&ie(m)},[m]),Oe(()=>{zs(r=>{let b=Object.keys(r).filter(C=>!_[C]);if(b.length===0)return r;
let R={...r};return b.forEach(C=>delete R[C]),R})},[_]),Oe(()=>{let r=Object.entries(fn).filter(([,C])=>Kn[C]),b=Object.
entries(ks).filter(([,C])=>Kn[C]);if(r.length>0){let C=new Set(r.map(([q])=>q));zs(q=>Object.fromEntries(Object.entries(
q).filter(([G])=>!C.has(G))))}if(b.length>0){let C=new Set(b.map(([q])=>q));mi(q=>Object.fromEntries(Object.entries(q).filter(
([G])=>!C.has(G))));for(let[q,G]of b){let Q=Oa.current.get(G);if(!Q)continue;let se=Kn[G];if(Oa.current.delete(G),se?.result===
"ok")oa(q,Ne=>String(Ne||"").trim().toLowerCase()===Q.command?"":Ne),ws(Ne=>({...Ne,[q]:{status:"success",requestId:G,text:Q.
action==="pause"?"Goal paused":"Goal resumed"}})),ct(Q.action==="pause"?"Goal paused":"Goal resumed");else{let Ne=se?.error?.
message||"Native goal control did not apply.";ws(Xe=>({...Xe,[q]:{status:"failed",requestId:G,text:`${Ne} Command retain\
ed; press Send to retry.`}}))}}}let R=[...r,...b].map(([,C])=>Kn[C]).find(C=>C?.result==="failed");R&&ct(R.error?.message||
(R.command==="agent_interrupt"?"Interrupt did not apply":"Goal control did not apply"))},[Kn,fn,ks]),Oe(()=>{!rl.current&&
i&&ct("Reconnected"),rl.current&&!i&&ct("Disconnected \u2014 reconnecting..."),rl.current=i},[i]);function ct(r){po(r),setTimeout(
()=>po(""),3e3)}function ig(r){let b=je.find(R=>qe(R)===r);return b?Zo(b,r,Y[r],t[r]||[]):r}function rd(r,b,R,C=""){ht.current&&
clearTimeout(ht.current),It({sessionId:r,kind:b,title:R,detail:C||ig(r)}),ht.current=setTimeout(()=>{ht.current=null,It(
null)},8e3)}function od(){ht.current&&clearTimeout(ht.current),ht.current=null,It(null)}Oe(()=>()=>{ht.current&&clearTimeout(
ht.current)},[]),Oe(()=>{let r=pt.current,b=g||{},R=Object.keys(r).filter(C=>!b[C]);R.length>0&&(Us(C=>{let q={...C};return R.
forEach(G=>{q[G]?.kind==="prompt"&&delete q[G]}),q}),It(C=>C?.kind==="prompt"&&R.includes(C.sessionId)?null:C)),Object.entries(
b).forEach(([C,q])=>{let G=q?.prompt_id||q?.request_id||q?.id||"prompt",Q=r[C],se=Q?.prompt_id||Q?.request_id||Q?.id||null;
if(G===se||(ot.current&&_s.completion_sound&&Cf(C,m)&&Nf("prompt"),C===m))return;let Ne=q?.type==="question_prompt"||q?.
kind==="question"?"Question needs an answer":"Permission needs attention";Us(Xe=>({...Xe,[C]:{kind:"prompt",promptId:G}})),
rd(C,"prompt",Ne)}),pt.current=b,ot.current=!0},[g,m,_s.completion_sound]),Oe(()=>{!m||yt?.sessionId!==m||(ht.current&&clearTimeout(
ht.current),ht.current=null,It(null))},[m,yt?.sessionId]),Oe(()=>{if(!Yn||!Mn)return;let r=!1;async function b(){for(let R of xa||
[]){let C=R.session_id||R.session;if(!jp(R,_s)){Ja(R,"suppressed",{reasonCode:"client_preference"});continue}if(at[C]?.muted){
Ja(R,"suppressed",{reasonCode:"session_muted"});continue}if(!Cf(C,m)){Ja(R,"suppressed",{reasonCode:"focused_session"});
continue}let q=await Bp(R);if(r)continue;if(!q){Ja(R,"suppressed",{reasonCode:"client_duplicate"});continue}Ja(R,"claime\
d");let G=R.event_type;_s.completion_sound&&Nf(G==="goal_attention"||G==="provider_usage_threshold"?"prompt":"completion"),
C!==m&&Us(se=>({...se,[C]:{kind:G,dedupeKey:R.dedupe_key,createdAt:R.created_at||new Date().toISOString()}})),rd(C,G,R.title,
R.body),(typeof requestAnimationFrame=="function"?requestAnimationFrame:se=>setTimeout(se,16))(()=>{r||Ja(R,"displayed")})}}
return b().catch(()=>{}),()=>{r=!0}},[xa,m,at,_s,Yn,Mn]);function oa(r,b){r&&pr(R=>({...R,[r]:typeof b=="function"?b(R[r]||
""):b}))}function cl(r,b){r&&Hs(R=>{let C={...R};if(b===null)return delete C[r],C;let q=C[r]||[];return Array.isArray(b)?
C[r]=b:C[r]=[...q,b],C})}function cg(r,b){r&&Hs(R=>{let C={...R},q=[...C[r]||[]];return q.splice(b,1),q.length===0?delete C[r]:
C[r]=q,C})}async function ll(r,b,R,C){let q=await fetch("/upload",{method:"POST",headers:{"Content-Type":"application/js\
on"},body:JSON.stringify({filename:C,content:b,mimeType:R})});if(!q.ok)throw new Error("Upload failed");let{url:G}=await q.
json();return cl(r,{name:C,url:G,isText:!1,mimeType:R}),G}function id(r,b,R,C){let q=Ee(r,b,R,C);return ol.current[q]={sessionId:r,
filename:C,mimeType:R,base64:b,createdAt:Date.now()},ct(`Sending image to Codex: ${C}`),q}Oe(()=>{let r=Object.entries(Kn||
{});for(let[b,R]of r){if(!b.startsWith("attach-")||sd.current[b])continue;sd.current[b]=!0;let C=ol.current[b];if(delete ol.
current[b],!!C){if(R?.result==="ok"){ct(`Image attached to Codex: ${C.filename}`);continue}(async()=>{try{await ll(C.sessionId,
C.base64,C.mimeType,C.filename),ct(`Direct image attach failed \u2014 added ${C.filename} as a file link draft`)}catch{let q=R?.
error?.message||R?.error?.code||"unknown error";ct(`Image attach failed: ${q}`)}})()}}},[Kn]);function Lr(r){let b=r?.agent_type;
return{limit:Jb(b),...b==="codex_cli"||b==="cursor_cli"?{chunkBytes:Yb}:{}}}function Ky(r){let b=je.find(R=>qe(R)===r);return Lr(
b)}function is(r,b){let R=Sn.current===r;Wn(r),hs(r),Sn.current=r,Os.current={sessionId:r,index:(os.current[r]||[]).length,
scratch:""},f(C=>({...C,[r]:0})),Us(C=>{if(!C[r])return C;let q={...C};return delete q[r],q}),yt?.sessionId===r&&od(),lt(
!1),At(!1),wt(!1),Jt(!1),as(!1),R&&setTimeout(()=>oo(r,Lr(b)),0)}function lg(r){let b=r?.session_id,R=Number(r?.message_id);
if(!b||!Number.isSafeInteger(R)||R<=0)return;let C=je.find(q=>qe(q)===b)||{session_id:b,workspace_path:r.workspace_path||
null,project_root:r.project_root||null,workspace_name:r.workspace_name||null,agent_type:r.agent_type||null,status:"histo\
ry"};Ke.cancelRouteRestore(),Er.current=null,_o({sessionId:b,messageId:R}),is(b,C),as(!1)}async function ug(r){let b=Array.
from(r.target.files||[]);if(b.length!==0){r.target.value="";for(let R of b){if(R.size>2*1024*1024){ct(`${R.name}: too la\
rge (max 2 MB)`);continue}if(Wd(R.name)&&R.size<500*1024)await new Promise((C,q)=>{let G=new FileReader;G.onload=Q=>{cl(
m,{name:R.name,content:Q.target.result,isText:!0}),C()},G.onerror=()=>{ct(`Failed to read ${R.name}`),C()},G.readAsText(
R)});else{Xn(!0);try{await new Promise((C,q)=>{let G=new FileReader;G.onload=async Q=>{let se=Q.target.result.split(",")[1];
(H?.capabilities||{}).send_attachment&&R.type.startsWith("image/")?id(m,se,R.type,R.name):(await ll(m,se,R.type,R.name),
ct(`Uploaded: ${R.name}`)),C()},G.onerror=()=>{ct(`Failed to read ${R.name}`),C()},G.readAsDataURL(R)})}catch{ct(`Upload\
 failed: ${R.name}`)}finally{Xn(!1)}}}}}async function dg(r){let R=Array.from(r.clipboardData?.items||[]).find(Q=>Q.type.
startsWith("image/"));if(!R||(r.preventDefault(),!m))return;let C=R.getAsFile();if(!C)return;if(C.size>2*1024*1024){ct("\
Image too large (max 2 MB)");return}let q=C.type==="image/jpeg"?"jpg":"png",G=`screenshot-${Date.now()}.${q}`;Xn(!0);try{
await new Promise(Q=>{let se=new FileReader;se.onload=async Ne=>{let Xe=Ne.target.result.split(",")[1];(H?.capabilities||
{}).send_attachment?id(m,Xe,C.type,G):(await ll(m,Xe,C.type,G),ct("Screenshot attached")),Q()},se.onerror=()=>{ct("Faile\
d to read clipboard image"),Q()},se.readAsDataURL(C)})}catch{ct("Paste upload failed")}finally{Xn(!1)}}function cd(){if(Wa)
return;let r=m&&An[m]||"",b=m?uo[m]||[]:[],R=r.trim();if(!R&&b.length===0||!m)return;let C=qm(r,{attachmentCount:b.length});
if(C.kind!=="chat"){mg(C);return}let q="";if(b.length>0?(q=b.map(Q=>{if(Q.isText){let se=Br(Q.name);return`\`${Q.name}\`
\`\`\`${se}
${Q.content}
\`\`\``}return(Q.mimeType||"").startsWith("image/")?`![${Q.name}](${Q.url})`:`[File: ${Q.name}](${Q.url})`}).join(`

`),R&&(q+=`

${R}`)):q=R,re(m,q),R){let G=os.current[m]||[],Q=G[G.length-1]===R?G:[...G,R].slice(-100);os.current[m]=Q,Os.current={sessionId:m,
index:Q.length,scratch:""}}xs(G=>({...G,[m]:!1})),As(G=>({...G,[m]:Math.min(G[m]||0,(t[m]||[]).length)})),oa(m,""),cl(m,
null),At(!1),Pn.current?.focus()}function ul(){it.current&&clearTimeout(it.current),it.current=null,kt.current={sessionId:null,
expiresAt:0},mo(null)}function pg(){if(!m)return;let r=Date.now()+2500;kt.current={sessionId:m,expiresAt:r},mo(m),it.current&&
clearTimeout(it.current),it.current=setTimeout(()=>{kt.current.sessionId===m&&kt.current.expiresAt===r&&(kt.current={sessionId:null,
expiresAt:0},it.current=null,mo(null))},2500)}function dl(){if(!m||!_[m]||fn[m]){ul();return}ul(),pl(m,j)}function pl(r,b){
if(!r||fn[r])return null;let R=x(r,{sessionGeneration:b?.control_generation,turnGeneration:b?.turn_generation});return zs(
C=>({...C,[r]:R})),R}function ml(r,b,R,C,q={}){if(!r||!R||ks[r])return null;let G=O(r,b,R,{sessionGeneration:C?.control_generation,
requestId:q.requestId});return mi(Q=>({...Q,[r]:G})),G}function mg(r){if(!m)return;let b=se=>{ws(Ne=>({...Ne,[m]:{status:"\
failed",requestId:null,text:se}})),ct(se),At(!1)};if(r.kind==="unsupported_goal_control"){b("Unsupported goal command. U\
se /goal resume or /goal pause.");return}if(!i){b("Goal control is offline. Command retained; reconnect and press Send t\
o retry.");return}if(ks[m]){b("A goal control is already applying. Command retained.");return}let R=j?.agent_type;if(!["\
codex","codex-desktop","codex_cli"].includes(R)||H?.capabilities?.goal_pause_resume!==!0||!la?.fingerprint||Number(j?.control_generation)<=
0){b("This session has no verified native goal control. Command retained.");return}let C=Pm(r.action,ua);if(C){oa(m,""),
ws(se=>({...se,[m]:{status:"success",requestId:null,text:C}})),ct(C),At(!1);return}if(r.action==="resume"&&ua==="blocked"&&
H?.capabilities?.goal_blocked_resume!==!0){b("Blocked-goal resume is not verified for this session. Command retained.");
return}if(!(r.action==="pause"?ua==="active":["paused","blocked"].includes(ua))){b(`Goal state is ${ua||"unknown"}; refr\
esh before retrying this command.`);return}let G=`goal-slash-${r.action}-${Date.now()}-${Math.random().toString(36).slice(
2,8)}`;if(Oa.current.set(G,{action:r.action,command:r.command}),ws(se=>({...se,[m]:{status:"applying",requestId:G,text:"\
Validating goal, then applying native control\u2026"}})),!ml(m,r.action,la,j,{requestId:G})){Oa.current.delete(G),b("Goa\
l control could not be queued. Command retained; press Send to retry.");return}At(!1)}Oe(()=>()=>{it.current&&clearTimeout(
it.current)},[]),Oe(()=>{qa&&(qa!==m||!_[qa])&&ul()},[m,_,qa]);function fg(r){if((r.metaKey||r.ctrlKey)&&r.key.toLowerCase()===
"k"){r.preventDefault(),Pn.current?.focus();return}if(r.key==="Escape"){if(Ma){At(!1);return}if(Wa)return;Ei&&!Ir&&(r.preventDefault(),
kt.current.sessionId===m&&kt.current.expiresAt>=Date.now()?dl():pg());return}if(r.key==="Enter"&&!r.shiftKey&&kt.current.
sessionId===m&&kt.current.expiresAt>=Date.now()){r.preventDefault(),dl();return}let b=m?os.current[m]||[]:[],R=Os.current,
C=R.sessionId===m&&R.index>=0&&R.index<b.length;if(r.key==="ArrowUp"&&b.length>0&&(cs===""||C)){r.preventDefault();let q=R.
sessionId===m?R:{sessionId:m,index:b.length,scratch:cs};q.index=Math.max(0,q.index-1),Os.current=q,oa(m,b[q.index]);return}
if(r.key==="ArrowDown"&&C){r.preventDefault();let q=Math.min(b.length,R.index+1);Os.current={...R,index:q},oa(m,q===b.length?
R.scratch:b[q]);return}if(r.key==="Tab"&&Ma&&Oi.length>0){r.preventDefault(),jd(Oi[0].command);return}r.key==="Enter"&&!r.
shiftKey&&(r.preventDefault(),cd())}let Ei=m?!!_[m]:!1,Ir=m?!!fn[m]:!1,cs=m&&An[m]||"",fl=m?uo[m]||[]:[],Ro=React.useCallback(
()=>{let r=Pn.current;if(!r)return;let b=Math.max(42,Math.floor(window.innerHeight*.4));r.style.height="auto";let R=Math.
max(42,Math.min(r.scrollHeight,b));r.style.height=`${R}px`,r.style.overflowY=r.scrollHeight>b?"auto":"hidden"},[]);ka(()=>{
Ro()},[m,cs,Ro]),Oe(()=>(window.addEventListener("resize",Ro),()=>window.removeEventListener("resize",Ro)),[Ro]);let Ga=ra,
ld=m&&Cs[m]&&go[m]||0,nt=React.useMemo(()=>{let r=Math.min(ld,Ga.length);return r<=0?Ga:r>=Ga.length?tf:Ga.slice(r)},[Ga,
ld]),Dn=React.useMemo(()=>nt.filter(r=>rv(r)),[nt]),Ke=Uv({messages:Dn,containerRef:nn,sessionId:m,routeActive:Tr,suppressProgrammaticScrollRef:nl,
scrollCoordinatorRef:Is}),ia=React.useCallback(()=>{let r=nn.current;if(!r)return;let b=r.scrollHeight-r.scrollTop-r.clientHeight<
80;Er.current={sessionId:m,scrollTop:r.scrollTop,scrollHeight:r.scrollHeight,clientHeight:r.clientHeight,atBottom:b},Ke.
prepareForRouteChange()},[m,Ke.prepareForRouteChange]);ka(()=>{if(!Tr||Ke.enabled)return;let r=Er.current;if(!nn.current||
r?.sessionId!==m)return;let R=()=>{let C=nn.current;if(!C||r.sessionId!==m)return;let q=r.atBottom?C.scrollHeight:Math.min(
r.scrollTop,Math.max(0,C.scrollHeight-C.clientHeight));Is.current?.(C,q,"route-scroll-restore",{allowWhenUserOwned:!0,retainUserOwnership:!0})};
return R(),Ao.current=requestAnimationFrame(()=>{Ao.current=0,R()}),()=>{Ao.current&&cancelAnimationFrame(Ao.current),Ao.
current=0}},[m,Tr,Ke.enabled]),Oe(()=>{if(zf)return window.__RAC_TRANSCRIPT_WINDOW__={total:Dn.length,messageKeys:Dn.map(
(r,b)=>Tc(r,b)),scrollToIndex:Ke.scrollToIndex},()=>{window.__RAC_TRANSCRIPT_WINDOW__?.scrollToIndex===Ke.scrollToIndex&&
delete window.__RAC_TRANSCRIPT_WINDOW__}},[Dn,Ke.scrollToIndex]);let jn=m&&g[m]||null,Mo=m&&N[m]||null,To=Zr(Mo)?Mo:null,
ud=Mo&&!Zr(Mo)?Mo:null,Wa=jn||To,$o=React.useMemo(()=>tv(m,jn),[m,jn]),Vy=jn?jn.type==="question_prompt"?"Question requi\
red":"Permission required":To?oe(To.title,"Action required"):null;ka(()=>{let r=nn.current;if(!r)return;let b=Date.now(),
R=ag.current;if(!$o){R.activeSemanticKey&&(R.lastClearedSemanticKey=R.activeSemanticKey,R.clearedAt=b,R.activeSemanticKey=
"");return}let C=R.activeSemanticKey===$o||R.lastClearedSemanticKey===$o&&b-R.clearedAt<=5e3;R.activeSemanticKey=$o,!(C||
(Co.current+=1,xo.current=0,vt.current=!1,sn.current||document.activeElement===Pn.current||b<No.current)||!Is.current?.(
r,0,"genuine-prompt-reveal",{allowDuringPrompt:!0}))&&(Mi.current=r.scrollHeight-r.clientHeight<80,ts(!1),Qt(0),Ls.current=
{...Ls.current,sessionId:m,scrollTop:0,scrollHeight:r.scrollHeight,clientHeight:r.clientHeight,atBottom:!1})},[$o,m,Dn.length]);
let za=m&&Y[m]?.capabilities?.write_capability_gate||null,gg=!!(cs.trim()||fl.length>0)&&!!m&&!Ra&&!Wa&&!za,dd=i?c?.state||
"connecting":"offline",hg=c?.rttMs!=null?` \xB7 ${c.rttMs} ms`:"",pd=Object.entries(u).reduce((r,[b,R])=>On.has(b)?r:r+Number(
R||0),0),Li=Object.keys(fr).filter(r=>r!==m&&!On.has(r)).length,md=Cn?.completed_at?Date.now()-Date.parse(Cn.completed_at):
Number.POSITIVE_INFINITY,yn=md>=0&&md<=1440*60*1e3?Cn:null,Or=yn?ri.filter(r=>r.run_id!==yn.run_id):ri,_g=Object.fromEntries(
(io?.coverage_matrix||[]).map(r=>[r.harness,r])),fd=Object.entries(io?.harnesses||{}).sort(([r],[b])=>r.localeCompare(b)),
Mt=Yt?.latest||null,bg=Mt?.completed_at?Date.now()-Date.parse(Mt.completed_at):Number.POSITIVE_INFINITY,Ii=!Yt||!Mt||bg>
2700*1e3?"STALE":String(Yt.status||Mt.status||"STALE").toUpperCase(),Eo=Array.isArray(Yt?.open_fingerprints)?Yt.open_fingerprints:
[],Lo=Ii!=="PASS"||Eo.length>0,Io=Nn.length>0||Or.length>0||!!yn||!!za||Lo,vg=cs.startsWith("/")?cs.slice(1).trim().toLowerCase():
"",Oi=cs.startsWith("/")?Xb.filter(r=>r.command.slice(1).includes(vg)):[];ka(()=>{let r=hi.current;if(!Io||!r){_i(0);return}
let b=()=>_i(Math.ceil(r.getBoundingClientRect().height));if(b(),typeof ResizeObserver>"u")return;let R=new ResizeObserver(
b);return R.observe(r),()=>R.disconnect()},[Io,Nn.length,Or.length,yn?.run_id,za]);let H=m&&Y[m]||null,gd=m?Object.values(
te||{}).filter(r=>r.sessionId===m):[],hd=gd.find(r=>r.status==="pending"||r.status==="awaiting_config")||null,qi=gd.find(
r=>r.status==="failed")||null,Gt=m&&s[m]||null,ca=m&&a[m]||null;Oe(()=>{if(!m||!i||ut?.sessionId===m)return;let b=(t[m]||
[]).reduce((q,G)=>Math.max(q,Number(G?.sequence||0)),0);if(b>0){oo(m,{afterSequence:b});return}let R=Lr(j),C=j?.agent_type===
"codex_cli"||j?.agent_type==="cursor_cli"?"native":"relay_sqlite";Na(m,{...R,mode:"tail",source:C})},[m,i,j?.agent_type,
ut?.sessionId]),Oe(()=>{if(!i||!ut||m!==ut.sessionId||(t[m]||[]).some(C=>String(C?.id)===String(ut.messageId)))return;let b=()=>Na(
m,{mode:"around",source:"relay_sqlite",aroundId:ut.messageId,limit:200,replace:!0,userInitiated:!0});b();let R=setTimeout(
b,600);return()=>clearTimeout(R)},[i,m,ut?.sessionId,ut?.messageId,t[m]]),Oe(()=>{if(!ut||m!==ut.sessionId)return;let r=`\
[data-message-id="${ut.messageId}"]`,b=Dn.findIndex(G=>String(G?.id)===String(ut.messageId));b>=0&&Ke.scrollToIndex(b,"c\
enter");let R=0,C=null,q=setInterval(()=>{R++,nn.current?.querySelector(r)?(clearInterval(q),b>=0&&Ke.scrollToIndex(b,"c\
enter"),C=setTimeout(()=>{_o(Q=>Q?.sessionId===m&&String(Q?.messageId)===String(ut.messageId)?null:Q)},5e3)):R>=40&&(clearInterval(
q),_o(null),ct("Matched message could not be loaded"))},100);return()=>{clearInterval(q),C&&clearTimeout(C)}},[m,ut?.sessionId,
ut?.messageId,t[m],Dn,Ke.scrollToIndex]),Oe(()=>{zn(m?[m]:[])},[m,zn]),Oe(()=>{if(!m||!i||!ed)return;let r=Lr(j);Na(m,{...r,
mode:"tail",source:"native"})},[m,i,ed]);let Ve=j?.agent_type==="antigravity-v2",Oo=m?Ae[m]||[]:[],qr=m?Ns[m]:null,_d=React.
useMemo(()=>Ve&&qr?.id?Oo.map(r=>!r?.kind||r.kind==="chat"?{...r,active:r.id===qr.id}:r):Oo,[Oo,Ve,qr?.id]),gl=!!(m&&Object.
prototype.hasOwnProperty.call(Ae,m)),bd=_d.filter(r=>!r?.kind||r.kind==="chat").length,yg=!!(m&&Ve&&!rn),hl=j?.agent_type===
"antigravity"||j?.agent_type==="antigravity_panel"||j?.agent_type==="antigravity-v2",Bn=j?Nv(je,j):null,vd=j?.agent_type===
"codex"&&j?.visible_pane_visible?{pane_agent:j.visible_pane_agent||null,summary:df(j),sourceSession:j}:null,kg=Bn?{pane_agent:Bn.
panel_agent||null,summary:df(Bn),sourceSession:Bn}:null,Pi=vd||kg,wg=Pi?.summary||"",Sg=Pi?.pane_agent||null,yd=wg||Su(Sg)||
eo(Pi?.sourceSession,qe(Pi?.sourceSession)),kd=yd,_l=!!(j&&j.agent_type==="codex"&&j.visible_pane_visible&&j.visible_pane_agent===
"codex"),Ng=!!(j&&j.agent_type==="codex"&&j.visible_pane_visible&&j.visible_pane_agent&&j.visible_pane_agent!=="codex"),
dt=to(j||m,H),bl=m?Nr[m]:"",qs=j&&typeof j=="object"?j.workspace_path:"",wd=qs?qs.split(/[\\/]/).filter(Boolean).pop()||
qs:"",Cg=wd||(bl&&bl!=="Unscoped"?bl:"")||oe(j?.workspace_name)||"Unscoped",Sd=ke(new Map),vl=React.useMemo(()=>Ve&&qr?.
title?{...j||{},native_chat_title:qr.title}:j,[j,Ve,qr?.title]),yl=React.useMemo(()=>{if(!m)return{title:"Agent Chat",source:"\
fallback",field:"no_session"};let r=Il(vl,vl?.custom_display_name||"",ra),b=gp(Sd.current.get(m),r);return Sd.current.set(
m,b),b},[m,vl,ra]),kl=yl.title,Di=m?Lc[m]:null,xg=!!(dt?.name==="Codex"&&j&&j.agent_type==="codex"&&(Ng&&Bn||!vd&&Bn&&(Bn.
panel_agent==="antigravity_panel"||kd))),Nd=!!H?.capabilities?.new_thread,Ag=j?.agent_type==="codex-desktop",Rg=j?.agent_type===
"cursor",Cd=Ag||Rg,wl=Cd?"New chat":"New thread",xd=j&&typeof j=="object"?j.machine_label:"",Ad=Bf(j),Rd=React.useMemo(()=>{
for(let r=nt.length-1;r>=0;r--)if(nt[r]?.role==="user")return nt[r];return null},[nt]),Sl=Rd?Kt(Rd.content).replace(/\s+/g,
" ").trim():"",Ka=m?T[m]||j?.status||"unknown":"",Md=React.useCallback(r=>{let b=oe(r).replace(/\s+\((?:Lines?|Line)\s+\d+(?:-\d+)?\)\s*$/i,
"").replace(/^["'`]+|["'`]+$/g,"").trim();if(!b)return"";let R=b.replace(/\\/g,"/"),C=oe(qs).replace(/\\/g,"/").replace(
/\/+$/,"");if(/^[A-Za-z]:\//.test(R)||R.startsWith("//")){if(!C)return"";let q=R.toLowerCase(),G=C.toLowerCase();return q===
G?".":q.startsWith(G+"/")?R.slice(C.length+1):""}return R.replace(/^\.\/+/,"").replace(/^\/+/,"")},[qs]),Nl=React.useCallback(
(r,b)=>{if(!m)return;let R=Md(b);if(!R){ct("File is outside the current workspace");return}vr(C=>C&&C.sessionId===m&&C.messageKey===
r&&C.path===R?null:{sessionId:m,messageKey:r,path:R}),kr.current(m,R)},[m,Md]),Td=React.useCallback(()=>vr(null),[]),De=m?
S[m]!==void 0?S[m]:j&&typeof j=="object"?j.activity:null:null,la=De?.goal||null,ua=String(la?.state||la?.status||"").toLowerCase(),
Pr=ua==="blocked",Mg=Pr&&H?.capabilities?.goal_blocked_resume===!0,qo=ua==="active"?"pause":ua==="paused"||Mg?"resume":null,
Tg=Pr?oe(la?.block_reason||la?.reason||De?.label||"Goal blocked").trim():"",Po=!!(qo&&la?.fingerprint&&H?.capabilities?.
goal_pause_resume===!0&&Number(j?.control_generation)>0),$d=!!(Ei&&H?.capabilities?.interrupt===!0&&Number(j?.control_generation)>
0&&Number(j?.turn_generation)>0),Cl=De?.context_card||null,$g=!!(m&&Sl&&!((j?.agent_type==="cline"||j?.agent_type==="roo\
_code")&&Cl)),Do=["claude_cli","codex_cli","cursor_cli"].includes(j?.agent_type),Ed=React.useMemo(()=>{for(let r=nt.length-
1;r>=0;r--)if(nt[r]?.role==="assistant")return nt[r];return null},[nt]),Dr=m?(y[m]||"").trim():"",Ld=Ed?Kt(Ed.content).trim():
"",Eg=!!(De&&!De?.thinking&&!De?.current&&!De?.task_list&&wu(Dr)),Id=!!(m&&!tn&&De&&(De.kind==="thinking"||De.kind==="ge\
nerating")&&!De?.thinking&&!De?.current&&!Eg&&wu(Dr)&&(j?.agent_type==="codex"||j?.agent_type==="codex-desktop"||j?.agent_type===
"cursor"||j?.agent_type==="antigravity_panel")&&Dr!==Ld&&!Ld.includes(Dr)),Od=!!(De&&(De?.goal||De?.connection||De?.thinking||
De?.current||De?.step||De?.usage||De?.task_list||De.kind!=="idle"||wu(Dr||De.thinkingContent||""))),Lg=!!(Gt?.cursor&&(Gt.
cursor.next_before_offset!=null||Gt.cursor.next_before_id!=null)),ji=!!(m&&Gt?.partial&&(Lg||Number(Gt.total||0)>Number(
Gt.loaded||nt.length||0))),Bi=Number(Gt?.loaded||nt.length||0),qd=Number(Gt?.total||Bi||0);function Pd(){if(!m)return;if(!Ke.
prepareForPrepend()){let b=nn.current,R=b?.getBoundingClientRect(),C=R?.top||0,q=b?Array.from(b.querySelectorAll(".messa\
ge[data-message-key]")):[],G=q.find(Q=>{let se=Q.getBoundingClientRect();return se.top>=C&&se.top<R.bottom})||q.find(Q=>Q.
getBoundingClientRect().bottom>C)||q[0]||null;tl.current=G?{messageKey:G.dataset.messageKey,viewportTop:G.getBoundingClientRect().
top}:null}let r=j?.agent_type==="codex_cli"||j?.agent_type==="cursor_cli"?"native":"relay_sqlite";Na(m,{mode:Gt?.cursor?
"older":"tail",source:r,userInitiated:!0,beforeOffset:Gt?.cursor?.next_before_offset,beforeId:Gt?.cursor?.next_before_id,
...Lr(j)})}Oe(()=>(el.current=ji&&!ca?Pd:null,()=>{el.current=null}),[m,j?.agent_type,ca,ji,Gt?.cursor?.next_before_offset,
Gt?.cursor?.next_before_id]);function Ig(){if(!m)return;let r=j?.agent_type==="codex_cli"||j?.agent_type==="cursor_cli"?
"native":"relay_sqlite";Na(m,{...Lr(j),mode:"tail",source:r,userInitiated:!0})}let Og=!!(m&&(nt.length>0||Id||tn)),qg=$u(
dt),Pg=React.useMemo(()=>Dn.slice(Ke.start,Ke.end).map((r,b)=>{let R=Ke.start+b,C=Tc(r,R),q=ut?.sessionId===m&&String(r?.
id)===String(ut?.messageId),G=Ke.enabled||q||R>=Math.max(0,Dn.length-48),Q=br?.sessionId===m&&br?.messageKey===C?br:null,
se=React.createElement(Bv,{key:C,msg:r,messageKey:C,activeAgent:dt,assistantMonospace:Do,autoExpandLongCodeBlocks:hl,onOpenPath:Nl,
agentType:j?.agent_type,preview:Q,fileContents:dr,onClosePreview:Td,deliveryState:r._cid?w[r._cid]:null,onSteer:ki,onRetry:Si,
richContentEager:G,searchMatch:q});return Ke.enabled?React.createElement(Hv,{key:C,index:R,messageKey:`${m||""}${C}`,onMeasure:Ke.
onMeasure},se):se}),[Dn,Ke.start,Ke.end,Ke.enabled,Ke.onMeasure,m,ut?.sessionId,ut?.messageId,qg,Do,hl,Nl,j?.agent_type,
br,dr,Td,w,ki,Si]),jr=H?.capabilities?.thread_list,Dg=!!(m&&(j?.agent_type==="codex-desktop"||j?.agent_type==="cursor")&&
jr&&(J[m]?.length>0||Cs[m]||So)&&!rn),jg=React.useMemo(()=>{let r=[...J[m]||[]];if(r.length===0)return r;let b=hn[m],R=b?
r.findIndex(q=>q.id===b):-1,C=R>=0?R:r.findIndex(q=>q.active);if(C>0){let[q]=r.splice(C,1);r.unshift(q)}return r},[m,J,hn]);
React.useLayoutEffect(()=>{if(!Tr||typeof ResizeObserver>"u")return;let r=nn.current;if(!r)return;let b=m,R=()=>{$r.current!==
b||sn.current||!vt.current||Is.current?.(r,r.scrollHeight,"live-edge-resize-follow")},C=new ResizeObserver(R);C.observe(
r);let q=Q=>{Q?.nodeType===1&&C.observe(Q)};Array.from(r.children).forEach(q);let G=new MutationObserver(Q=>{for(let se of Q)
Array.from(se.removedNodes||[]).forEach(Ne=>{Ne?.nodeType===1&&C.unobserve(Ne)}),Array.from(se.addedNodes||[]).forEach(q);
R()});return G.observe(r,{childList:!0}),()=>{G.disconnect(),C.disconnect()}},[m,Xc,Tr]);let Dd=nt.length===0;React.useEffect(
()=>{m&&jr&&Dd&&X(m)},[m,jr,Dd]),React.useEffect(()=>{if(!(m&&Ve&&i))return;Z(m);let r=[600,1800,4200].map(q=>setTimeout(
()=>{typeof document<"u"&&document.hidden||Z(m)},q)),b=()=>{typeof document<"u"&&document.hidden||Z(m)},R=setInterval(b,
3e4),C=()=>b();return typeof document<"u"&&document.addEventListener("visibilitychange",C),()=>{r.forEach(q=>clearTimeout(
q)),clearInterval(R),typeof document<"u"&&document.removeEventListener("visibilitychange",C)}},[m,Ve,i]),React.useEffect(
()=>{m&&Ve&&($n(!0),wt(!1))},[m,Ve]),React.useEffect(()=>{if(!(m&&Ve))return;let r=Oo.find(b=>(!b?.kind||b.kind==="chat")&&
b.active);r&&fo(b=>{let R=b[m];if(!R||R.id!==r.id&&Date.now()-(R.at||0)<15e3)return b;let C={...b};return delete C[m],C})},
[m,Ve,Oo]),React.useEffect(()=>{if(!(m&&jr&&(Cd||gn)))return;X(m);let r=setInterval(()=>X(m),gn?3e3:5e3);return()=>clearInterval(
r)},[m,j?.agent_type,jr,gn]),React.useEffect(()=>{if(!m)return;let r=go[m]||0,b=Ga.length;r>b&&As(R=>({...R,[m]:b}))},[m,
go,Ga.length]),React.useEffect(()=>{!m||nt.length===0||xs(r=>r[m]?{...r,[m]:!1}:r)},[m,nt.length]),React.useEffect(()=>{
if(!m)return;let r=J[m]||[],b=hn[m];b&&r.some(R=>R.id===b&&R.active)&&Vs(R=>{let C={...R};return delete C[m],C})},[m,J,hn]);
function Fi(r=m){r&&(xs(b=>({...b,[r]:!0})),Vs(b=>{let R={...b};return delete R[r],R}),As(b=>({...b,[r]:(t[r]||[]).length})),
Jt(!1),be(r))}function xl(r,b){r&&b&&(xs(R=>({...R,[r]:!1})),Vs(R=>({...R,[r]:b})),As(R=>({...R,[r]:0})),D(r,b))}function Va(r=m){
r&&($n(!0),wt(!1),fo(b=>({...b,[r]:{id:"__agv2:new_conversation",title:"New Conversation",kind:"nav",at:Date.now()}})),de(
r))}function Al(r,b=m){if(!(b&&r))return;$n(!0),wt(!1);let R=(Ae[b]||[]).find(q=>q?.id===r),C=r==="__agv2:new_conversati\
on"?"New Conversation":r==="__agv2:conversation_history"?"Conversation History":r==="__agv2:scheduled_tasks"?"Scheduled \
Tasks":"Antigravity v2";if(fo(q=>({...q,[b]:{id:r,title:R?.title||C,kind:R?.kind||"chat",at:Date.now()}})),r==="__agv2:n\
ew_conversation"){Va(b);return}ue(b,r)}function Bg(r){m&&(Os.current={sessionId:m,index:(os.current[m]||[]).length,scratch:r},
oa(m,r),At(r.startsWith("/")))}function jd(r){if(!m)return;let R={"/plan":`${r} Outline the implementation approach and \
major steps.`,"/review":`${r} Review the current changes for bugs, regressions, and missing tests.`,"/fix":`${r} Impleme\
nt or repair the current issue.`,"/summarize":`${r} Summarize the current state and important changes.`}[r]||`${r} `;oa(
m,R),At(!1),requestAnimationFrame(()=>Pn.current?.focus())}function Fg(r,b=!1,R=""){let C=qe(r),q=Kf.has(C)?Za(r):null,G=aa.
current.get(C);return G||(G=document.createElement("div"),G.className="sidebar-card-host",G.setAttribute("data-sidebar-c\
ard-host",C),aa.current.set(C,G)),ReactDOM.createPortal(React.createElement(Kv,{session:r,health:T[C],unread:On.has(C)?0:
u[C]||0,isThinking:!!_[C]||!!tc(S[C],{health:T[C]}),isActive:C===m,agentConfig:Y[C]||null,activity:S[C]||null,sessionMessages:t[C]||
[],hasBlockingPrompt:!!g[C]||!!Zr(N[C]),blockingPromptLabel:g[C]?g[C].type==="question_prompt"?"Question required":"Perm\
ission required":N[C]?.title||"Action required",muted:!!at[C]?.muted,pinned:b,workspaceLabel:R,recentMessageAt:q?.at||null,
menuOpen:jc===C,onMenuToggle:Q=>Bc(se=>Q?C:se===C?"":se),onPinChange:Q=>bi(C,{pinned:Q}).catch(se=>{ct(se?.message||`Una\
ble to ${Q?"pin":"unpin"} chat`)}),onSelect:()=>is(C,r),onManage:()=>{$a(C),tt(!0),_t(!1),et(!1)},onClose:()=>{let Q=T[C]===
"disconnected"||!T[C],se=Q?"Remove session from the list?":`Close session "${C}"?`;window.confirm(se)&&Vt(C,Q)},onAutomations:r?.
agent_type==="codex-desktop"?()=>{Qs||ia(),ns(Q=>!Q),ss(!1),_n(!1),En(!1),Ln(!1),lt(!1)}:void 0,showAutomationsActive:Qs,
onSkills:r?.agent_type==="codex-desktop"?()=>{Js||ia(),ss(Q=>!Q),ns(!1),_n(!1),En(!1),Ln(!1),lt(!1),lr[C]||ur(C)}:void 0,
showSkillsActive:Js}),G,C)}function Hi(r,b=!0){let R=qe(r);return React.createElement("div",{key:R,className:`sidebar-ca\
rd-slot${b?"":" sidebar-card-slot-filtered"}`,"data-sidebar-card-slot":R,"aria-hidden":b?void 0:"true",inert:b?void 0:""})}
return React.createElement("div",{className:`app${Io?" has-system-banner":""}`,style:Io?{"--system-banner-height":`${Uc}\
px`}:void 0},Zn&&React.createElement("div",{className:"quick-switcher-overlay",onMouseDown:r=>{r.target===r.currentTarget&&
(Ea(!1),hr(""),es(0),requestAnimationFrame(()=>Pn.current?.focus()))}},React.createElement("div",{className:"quick-switc\
her",role:"dialog","aria-modal":"true","aria-label":"Switch session"},React.createElement("div",{className:"quick-switch\
er-input-wrap"},React.createElement("span",{"aria-hidden":"true"},"\u2315"),React.createElement("input",{ref:yo,className:"\
quick-switcher-input",value:Ce,onChange:r=>{hr(r.target.value),es(0)},placeholder:"Search sessions, projects, or harness\
es","aria-label":"Search sessions","aria-controls":"quick-switcher-results","aria-activedescendant":Ut.length?`quick-swi\
tcher-option-${ys}`:void 0,autoComplete:"off",spellCheck:"false"}),React.createElement("kbd",null,"Esc")),React.createElement(
"div",{className:"quick-switcher-results",id:"quick-switcher-results",role:"listbox"},Ut.length===0?React.createElement(
"div",{className:"quick-switcher-empty"},"No matching sessions"):Ut.map((r,b)=>React.createElement("button",{type:"butto\
n",role:"option",id:`quick-switcher-option-${b}`,"aria-selected":b===ys,className:`quick-switcher-option${b===ys?" selec\
ted":""}${r.id===m?" active":""}`,key:r.id,onMouseEnter:()=>es(b),onClick:()=>{is(r.id,r.session),lt(!1),Ea(!1),hr(""),es(
0),requestAnimationFrame(()=>Pn.current?.focus())}},React.createElement("span",{className:"quick-switcher-dot",style:{background:r.
agentColor}}),React.createElement("span",{className:"quick-switcher-copy"},React.createElement("span",{className:"quick-\
switcher-title"},r.title),React.createElement("span",{className:"quick-switcher-meta"},r.groupLabel," \xB7 ",r.agentName,
r.subtitle?` \xB7 ${r.subtitle}`:"")),r.id===m&&React.createElement("span",{className:"quick-switcher-current"},"Current")))),
React.createElement("div",{className:"quick-switcher-footer"},React.createElement("span",null,React.createElement("kbd",
null,"\u2191"),React.createElement("kbd",null,"\u2193")," Navigate"),React.createElement("span",null,React.createElement(
"kbd",null,"Enter")," Switch"),React.createElement("span",null,Ut.length," of ",$s.length)))),_r&&React.createElement("d\
iv",{className:"shortcut-help-overlay",onMouseDown:r=>{r.target===r.currentTarget&&Ws(!1)}},React.createElement("div",{className:"\
shortcut-help",role:"dialog","aria-modal":"true","aria-label":"Keyboard shortcuts"},React.createElement("div",{className:"\
shortcut-help-header"},React.createElement("strong",null,"Keyboard shortcuts"),React.createElement("button",{type:"butto\
n",onClick:()=>Ws(!1),"aria-label":"Close keyboard shortcuts"},"\xD7")),React.createElement("div",{className:"shortcut-h\
elp-list"},React.createElement("div",null,React.createElement("span",null,"Switch session"),React.createElement("kbd",null,
"Ctrl/Cmd P")),React.createElement("div",null,React.createElement("span",null,"Previous / next session"),React.createElement(
"kbd",null,"Alt \u2191 / \u2193")),React.createElement("div",null,React.createElement("span",null,"Focus composer"),React.
createElement("kbd",null,"Ctrl/Cmd K")),React.createElement("div",null,React.createElement("span",null,"Send / newline"),
React.createElement("kbd",null,"Enter / Shift Enter")),React.createElement("div",null,React.createElement("span",null,"O\
pen / close this guide"),React.createElement("kbd",null,"?"))),React.createElement("div",{className:"shortcut-help-note"},
"Shortcuts never switch or submit while you are typing unless they include Ctrl/Cmd or Alt."))),La&&React.createElement(
"div",{className:"shortcut-help-overlay revalidation-ledger-backdrop",role:"presentation",onMouseDown:r=>{r.target===r.currentTarget&&
Tn(!1)}},React.createElement("div",{className:"revalidation-ledger",role:"dialog","aria-modal":"true","aria-label":"Harn\
ess revalidation program health"},React.createElement("div",{className:"shortcut-help-header"},React.createElement("stro\
ng",null,"Harness revalidation program"),React.createElement("button",{type:"button",onClick:()=>Tn(!1),"aria-label":"Cl\
ose validation health"},"\xD7")),React.createElement("p",{className:"revalidation-ledger-summary"},"Continuous version w\
atch, nightly tier-1, and staggered weekly tier-2. Write controls fail closed after drift until the installed version pa\
sses its required tiers."),React.createElement("section",{className:`operator-dogfood-health validation-state-${Ii.toLowerCase()}`,
"aria-label":"Chat stability sentinel health"},React.createElement("h3",null,"Chat stability sentinel: ",Ii),React.createElement(
"p",null,Mt?`${Mt.mode||"unknown"} / ${Mt.trigger_source||"unknown trigger"} / ${Mt.duration_ms||0} ms / ${Mt.refresh_count??
0} refreshes / ${Mt.dropped_samples??0} dropped`:"No sentinel result has been published; health remains stale."),React.createElement(
"dl",null,React.createElement("div",null,React.createElement("dt",null,"Source"),React.createElement("dd",null,Mt?.source_commit||
"unavailable")),React.createElement("div",null,React.createElement("dt",null,"Build"),React.createElement("dd",null,Mt?.
source_bundle_sha256||"unavailable")),React.createElement("div",null,React.createElement("dt",null,"Last end"),React.createElement(
"dd",null,Mt?.completed_at?new Date(Mt.completed_at).toLocaleString():"never")),React.createElement("div",null,React.createElement(
"dt",null,"Next due"),React.createElement("dd",null,Mt?.next_due_at?new Date(Mt.next_due_at).toLocaleString():"unknown")),
React.createElement("div",null,React.createElement("dt",null,"Scheduler"),React.createElement("dd",null,Mt?.scheduler_last_result||
"unavailable")),React.createElement("div",null,React.createElement("dt",null,"Open findings"),React.createElement("dd",null,
Eo.length)))),fd.length===0?React.createElement("div",{className:"revalidation-ledger-empty"},"Program health has not be\
en published by the updated sentinel yet."):React.createElement("div",{className:"revalidation-ledger-table-wrap"},React.
createElement("table",{className:"revalidation-ledger-table"},React.createElement("thead",null,React.createElement("tr",
null,React.createElement("th",null,"Harness"),React.createElement("th",null,"Version"),React.createElement("th",null,"Fi\
xture"),React.createElement("th",null,"Tier 1"),React.createElement("th",null,"Tier 2"),React.createElement("th",null,"W\
rite gate"),React.createElement("th",null,"Next tier 2"))),React.createElement("tbody",null,fd.map(([r,b])=>{let R=_g[r]||
{},C=R.tier2||{},q=b.last_tier2_status||(C.mode==="gated"?"gated":"scheduled");return React.createElement("tr",{key:r},React.
createElement("th",{scope:"row"},r),React.createElement("td",null,b.installed_version||"not installed"),React.createElement(
"td",null,R.fixture?"covered":"missing"),React.createElement("td",null,R.tier1?"covered":"missing"),React.createElement(
"td",{className:`validation-state-${q}`},q),React.createElement("td",{className:`validation-state-${b.status||"pending"}`},
b.status==="pass"?"available":b.status||"pending"),React.createElement("td",null,b.next_tier2_at?new Date(b.next_tier2_at).
toLocaleString():"unscheduled"))})))))),React.createElement("div",{className:`overlay ${Aa?"open":""}`,onClick:()=>lt(!1)}),
Io&&React.createElement("div",{className:`duplicate-proxy-banner${yn?.status==="pass"&&Nn.length===0&&Or.length===0&&!za&&
!Lo?" app-update-pass":""}`,role:yn?.status==="pass"&&Nn.length===0&&Or.length===0&&!za&&!Lo?"status":"alert",ref:hi},Nn.
length>0&&React.createElement(React.Fragment,null,React.createElement("strong",null,"Duplicate proxy detected."),React.createElement(
"span",null,Nn.length," session",Nn.length===1?"":"s"," claimed by multiple proxies. Stop the extra proxy to prevent con\
flicting controls.")),Or.length>0&&React.createElement(React.Fragment,null,React.createElement("strong",null,"Nightly va\
lidation failed."),React.createElement("span",null,Or.map(r=>`${r.harness} (${r.app_version})`).join(", "),". Check the \
validation ledger before using affected controls.")),yn&&React.createElement(React.Fragment,null,React.createElement("st\
rong",null,yn.status==="pass"?"App update validated.":"App update drift validation failed."),React.createElement("span",
null,yn.harness," ",yn.previous_app_version," -> ",yn.app_version,". ",yn.status==="pass"?"Harness controls remain avail\
able.":"A triage item was added to the maturity backlog.")),za&&React.createElement(React.Fragment,null,React.createElement(
"strong",null,"Harness writes paused."),React.createElement("span",null,za,". Read-only transcript access remains availa\
ble.")),Lo&&React.createElement(React.Fragment,null,React.createElement("strong",null,"Chat stability sentinel ",Ii.toLowerCase(),
"."),React.createElement("span",null,Eo.length>0?`${Eo.length} open P0/P1 fingerprint${Eo.length===1?"":"s"}.`:"The requ\
ired 30-minute canary is missing, expired, skipped, or running against a different served asset.")),(io||Yt||Lo)&&React.
createElement("button",{type:"button",className:"validation-health-link",onClick:()=>Tn(!0)},"View program health")),React.
createElement("div",{className:`sidebar ${Aa?"open":""}`},React.createElement("div",{className:"sidebar-header"},React.createElement(
"span",{className:"logo"},"\u232C"),React.createElement("span",{style:{flex:1}},"Agent Sessions"),React.createElement("b\
utton",{className:`new-session-btn notification-settings-btn${La?" active":""}`,title:"Harness validation health","aria-\
label":"Harness validation health",onClick:()=>Tn(!0)},"V"),React.createElement("button",{className:`new-session-btn not\
ification-settings-btn${_r?" active":""}`,title:"Keyboard shortcuts (?)","aria-label":"Keyboard shortcuts",onClick:()=>{
Ws(r=>!r),Ea(!1)}},"?"),React.createElement("button",{className:`new-session-btn notification-settings-btn${Jn?" active":
""}`,title:"Notification settings","aria-label":"Notification settings",onClick:()=>{_t(r=>!r),et(!1),tt(!1)}},"\u2662"),
React.createElement("button",{className:`new-session-btn notification-settings-btn${Ta?" active":""}`,title:"Manage sess\
ions","aria-label":"Manage sessions",onClick:()=>{$a(m&&(In||!On.has(m))?m:qe(ja[0])||""),tt(r=>!r),et(!1),_t(!1)}},"\u22EF"),
React.createElement("button",{className:`new-session-btn${Qn?" active":""}`,title:"New session",onClick:()=>{et(r=>!r),_t(
!1),tt(!1)}},"+")),React.createElement("div",{className:"sidebar-session-search"},React.createElement("input",{type:"sea\
rch",value:Rn,onChange:r=>ci(r.target.value),placeholder:"Filter sessions","aria-label":"Filter sidebar sessions",autoComplete:"\
off",spellCheck:"false"}),Rn&&React.createElement("button",{type:"button",onClick:()=>ci(""),"aria-label":"Clear sidebar\
 filter",title:"Clear filter"},"x")),React.createElement("div",{className:`sidebar-order-control${Ci?" changed":""}`,"ar\
ia-hidden":!Ci,"aria-live":"polite"},React.createElement("span",null,"Order changed"),React.createElement("button",{type:"\
button",onClick:Qf,disabled:!Ci,tabIndex:Ci?0:-1},"Sort now")),Jn&&React.createElement(cy,{onClose:()=>_t(!1),onPreferencesChange:r=>{
li({...r,turn_ready:!1}),ui(!0)}}),Ta&&React.createElement(ly,{sessions:ja,preferences:at,initialSessionId:Gs,onSave:bi,
onExport:Kc,onClose:()=>tt(!1)}),Qn&&React.createElement(ny,{launchStates:M,onLaunch:(r,b,R)=>F(r,b,R),onResume:(r,b,R,C)=>Ct(
r,b,R,C),onClose:()=>et(!1),workspaces:ir,showTestSessions:In}),React.createElement(qu,{structureKey:Yc,placements:Jf,prepareStructureChange:Zf,
finishStructureChange:eg},React.createElement("div",{className:"session-list",ref:L,onPointerDown:()=>{U.current+=1,Ye()},
onPointerUp:()=>on(80),onPointerCancel:()=>on(80),onWheel:()=>{U.current+=1,Ye(),on(180)},onTouchStart:()=>{U.current+=1,
Ye()},onKeyDown:r=>{["ArrowUp","ArrowDown","PageUp","PageDown","Home","End"," "].includes(r.key)&&(U.current+=1,Ye(),on(
180))},onScroll:r=>{let b=pe.current;if(b&&Math.abs(r.currentTarget.scrollTop-b.target)<=.5){pe.current=null,Ba();return}
U.current+=1,Ba(),Ye(),on(180)}},je.length===0&&!Qn&&React.createElement("div",{className:"session-empty"},"No agents co\
nnected"),je.length>0&&bt&&Cr.length===0&&xr.length===0&&Ar.length===0&&Xu.length===0&&React.createElement("div",{className:"\
session-empty"},"No matching sessions"),Rt.length>0&&React.createElement("section",{className:`session-group working-ses\
sion-group${bt&&Cr.length===0?" sidebar-group-filtered":""}`,"aria-label":"Working now"},React.createElement("div",{className:"\
session-group-header"},React.createElement("span",{className:"working-session-group-icon","aria-hidden":"true"},"W"),React.
createElement("span",{className:"session-group-name pinned-session-group-name"},"Working now"),React.createElement("span",
{className:"session-group-status-slot"},wo.hasPrompt&&React.createElement("span",{className:"session-group-alert",title:"\
Action required"},"!"),React.createElement("span",{className:"session-group-working",title:"Sessions working"}),wo.unread>
0&&React.createElement("span",{className:"session-group-unread",title:`${wo.unread} unread`},wo.unread>99?"99+":wo.unread),
React.createElement("span",{className:"session-group-count"},Cr.length))),React.createElement("div",{className:"session-\
group-items"},React.createElement("div",{className:"session-group-items-inner"},Rt.map(r=>Hi(r,!bt||Cr.includes(r)))))),
vn.length>0&&React.createElement("section",{className:`session-group recent-session-group${en.__recent__&&!bt?" collapse\
d":""}${bt&&xr.length===0?" sidebar-group-filtered":""}`,"aria-label":"Recent chats"},React.createElement("div",{className:"\
session-group-header"},React.createElement("button",{type:"button",className:"session-group-toggle",title:`${en.__recent__?
"Expand":"Collapse"} Recent chats`,"aria-label":`${en.__recent__?"Expand":"Collapse"} Recent chats`,"aria-expanded":!en.
__recent__||!!bt,onClick:()=>vi("__recent__")},React.createElement("span",{className:"session-group-caret","aria-hidden":"\
true"},en.__recent__&&!bt?">":"v")),React.createElement("span",{className:"recent-session-group-icon","aria-hidden":"tru\
e"},"R"),React.createElement("span",{className:"session-group-name pinned-session-group-name"},"Recent chats"),React.createElement(
"span",{className:"session-group-status-slot"},Rr.hasPrompt&&React.createElement("span",{className:"session-group-alert",
title:"Action required"},"!"),Rr.working&&React.createElement("span",{className:"session-group-working",title:"Session w\
orking"}),Rr.unread>0&&React.createElement("span",{className:"session-group-unread",title:`${Rr.unread} unread`},Rr.unread>
99?"99+":Rr.unread),React.createElement("span",{className:"session-group-count"},xr.length))),React.createElement("div",
{className:"session-group-items"},React.createElement("div",{className:"session-group-items-inner"},vn.map(r=>Hi(r,!bt||
xr.includes(r)))))),rs.length>0&&React.createElement("section",{className:`session-group pinned-session-group${bt&&Ar.length===
0?" sidebar-group-filtered":""}`,"aria-label":"Pinned chats"},React.createElement("div",{className:"session-group-header"},
React.createElement("span",{className:"session-group-pin-icon","aria-hidden":"true"},"\u{1F4CC}"),React.createElement("s\
pan",{className:"session-group-name pinned-session-group-name"},"Pinned chats"),React.createElement("span",{className:"s\
ession-group-status-slot"},Mr.hasPrompt&&React.createElement("span",{className:"session-group-alert",title:"Action requi\
red"},"!"),Mr.working&&React.createElement("span",{className:"session-group-working",title:"Session working"}),Mr.unread>
0&&React.createElement("span",{className:"session-group-unread",title:`${Mr.unread} unread`},Mr.unread>99?"99+":Mr.unread),
React.createElement("span",{className:"session-group-count"},Ar.length))),React.createElement("div",{className:"session-\
group-items"},React.createElement("div",{className:"session-group-items-inner"},rs.map(r=>Hi(r,!bt||Ar.includes(r)))))),
qn.map(r=>{let b=!!en[r.key]&&!bt,C=Xu.find(G=>G.key===r.key)?.sessions||[],q=Fa(C);return React.createElement("div",{className:`\
session-group${b?" collapsed":""}${bt&&C.length===0?" sidebar-group-filtered":""}`,key:r.key},React.createElement("div",
{className:"session-group-header"},React.createElement("button",{type:"button",className:"session-group-toggle",title:`${b?
"Expand":"Collapse"} ${r.label}`,"aria-label":`${b?"Expand":"Collapse"} ${r.label}`,"aria-expanded":!b,onClick:()=>vi(r.
key)},React.createElement("span",{className:"session-group-caret","aria-hidden":"true"},b?">":"v")),React.createElement(
_c,{title:r.label,disclosureKey:r.key,kind:"group",wrapperClassName:"session-group-title-details",triggerClassName:"sess\
ion-group-name",disclosureClassName:"session-group-disclosure",triggerLabel:`Show full group name: ${r.label}`}),React.createElement(
"span",{className:"session-group-status-slot"},q.hasPrompt&&React.createElement("span",{className:"session-group-alert",
title:"Action required"},"!"),q.working&&React.createElement("span",{className:"session-group-working",title:"Session wo\
rking"}),q.unread>0&&React.createElement("span",{className:"session-group-unread",title:`${q.unread} unread`},q.unread>99?
"99+":q.unread),React.createElement("span",{className:"session-group-count"},bt?C.length:r.sessions.length))),React.createElement(
"div",{className:"session-group-items","aria-hidden":b},React.createElement("div",{className:"session-group-items-inner"},
r.sessions.map(G=>Hi(G,!bt||C.includes(G))))))}),Vc.map(r=>{let b=qe(r);return Fg(r,!!at[b]?.pinned,Xf.has(b)?"":Nr[b]||
"Unscoped")}))),React.createElement("div",{className:"sidebar-footer"},React.createElement("span",{className:`status-dot\
 ${dd}`}),React.createElement("span",{className:"sidebar-footer-health"},React.createElement("span",null,i?`Relay ${dd}`:
"Reconnecting\u2026"),React.createElement("span",{className:"sidebar-footer-rtt"},i&&hg.replace(/^\s*·\s*/,"")||"\xA0")),
React.createElement("button",{type:"button",className:`sidebar-footer-action test-session-toggle${In?" active":""}`,title:In?
"Hide test sessions":`Show test sessions (${On.size})`,"aria-label":In?"Hide test sessions":"Show test sessions","aria-p\
ressed":In,onClick:()=>zc(r=>!r)},"T",On.size>99?"99+":On.size||""),React.createElement("button",{type:"button",className:`\
sidebar-footer-action${Ms?" active":""}`,title:"Usage and limits","aria-label":"Usage and limits",onClick:()=>{Ms||ia(),
En(r=>!r),Ln(!1),ns(!1),ss(!1),et(!1),_t(!1),tt(!1),_n(!1),as(!1),lt(!1)}},"\u25D4"),React.createElement("button",{type:"\
button",className:`sidebar-footer-action host-resource-footer-action${Ts?" active":""}`,title:"Host resources","aria-lab\
el":"Host resources",onClick:()=>{Ts||ia(),Ln(r=>!r),En(!1),_n(!1),ns(!1),ss(!1),et(!1),_t(!1),tt(!1),as(!1),lt(!1)}},"R"),
React.createElement("button",{type:"button",className:`sidebar-footer-action fleet-footer-action${Zs?" active":""}`,title:"\
Fleet view","aria-label":"Fleet view",onClick:()=>{Zs||ia(),_n(r=>!r),En(!1),Ln(!1),ns(!1),ss(!1),et(!1),_t(!1),tt(!1),as(
!1),lt(!1)}},"\u25A6"),React.createElement("button",{type:"button",className:`sidebar-footer-action transcript-search-fo\
oter-action${ea?" active":""}`,title:"Search all transcripts","aria-label":"Search all transcripts",onClick:()=>{ea||ia(),
as(r=>!r),_n(!1),En(!1),Ln(!1),ns(!1),ss(!1),et(!1),_t(!1),tt(!1),lt(!1)}},"\u2315"),React.createElement("a",{href:"/age\
nt-chat.apk",download:!0,className:"apk-download-link",title:"Download Android APK"},"\u2B07 APK"))),React.createElement(
"div",{className:`main${Qs||Js||Ms||Ts||Zs||ea?" automations-active":""}`},React.createElement(qy,{connected:i,error:co,
history:ii,subscription:xn,onRefresh:Vn,onSubscribe:gs,onUnsubscribe:Xt,onOpen:()=>{Ts||ia(),Ln(!0),En(!1),_n(!1),ns(!1),
ss(!1),et(!1),_t(!1),tt(!1),as(!1),lt(!1)}}),Qs&&React.createElement(Ty,{sessions:e,onBack:()=>ns(!1)}),Js&&React.createElement(
Gy,{skills:lr[m]||null,onRefresh:()=>m&&ur(m),onBack:()=>ss(!1)}),Bt&&m&&React.createElement(uy,{sessionId:m,initialContent:cs,
jobs:He.filter(r=>r.session_id===m),onSchedule:Et,onCancel:mn,onCreated:()=>oa(m,""),onClose:()=>gr(!1)}),Ms&&React.createElement(
Ly,{usage:oi,refreshReceipt:js,resetReceipt:Oc,costDetail:qc,onBack:()=>En(!1),onRefresh:Ic,onWatch:Bs,onConsumeResetCredit:Ca,
onRequestCostDetail:Fs}),Ts&&React.createElement(Py,{snapshot:Pc,error:co,history:ii,details:Dc,subscription:xn,onBack:()=>Ln(
!1),onRefresh:Vn,onSubscribe:gs,onUnsubscribe:Xt}),Zs&&React.createElement(Hy,{sessions:o,activities:S,thinking:_,permissionPrompts:g,
errorPrompts:N,messages:t,agentConfigs:Y,sessionAttention:fr,health:T,connected:i,deliveryStates:w,stopPending:fn,goalControlPending:ks,
onBroadcastSend:re,onInterrupt:pl,onGoalControl:ml,onBack:()=>_n(!1),onSelectSession:(r,b)=>{is(r,b),_n(!1)}}),ea&&React.
createElement(Uy,{onBack:()=>as(!1),onOpenResult:lg}),!Qs&&!Js&&!Ms&&!Ts&&!Zs&&!ea&&React.createElement(React.Fragment,null,
React.createElement("div",{className:"topbar"},React.createElement("button",{className:"hamburger",onClick:()=>lt(r=>!r)},
"\u2630",pd>0&&React.createElement("span",{className:"hamburger-badge"},pd),Li>0&&React.createElement("span",{className:"\
hamburger-attention",title:`${Li} session${Li===1?"":"s"} need attention`,"aria-label":`${Li} sessions need attention`},
"!")),React.createElement("div",{className:"topbar-context"},m?React.createElement(React.Fragment,null,React.createElement(
"div",{className:"topbar-title-row",role:"group","aria-label":`${dt.name} chat: ${kl}`},React.createElement("div",{className:"\
agent-badge topbar-agent-badge",style:{color:dt.color,borderColor:dt.color+"55",background:dt.color+"18"}},dt.logo?React.
createElement("img",{src:dt.logo,alt:dt.abbr,className:"agent-badge-logo"}):dt.abbr),React.createElement("div",{className:"\
topbar-title-group",style:{color:dt.color}},React.createElement("div",{className:"topbar-title-projection","data-chat-ti\
tle-source":yl.source,"data-chat-title-field":yl.field},React.createElement(_c,{title:kl,disclosureKey:`topbar-${m}`,kind:"\
chat",wrapperClassName:"topbar-title-details",triggerClassName:"topbar-title",disclosureClassName:"topbar-title-disclosu\
re",triggerLabel:`Show full chat title: ${kl}`,triggerTag:"div"})),React.createElement("div",{className:"topbar-subtitle",
title:qs||void 0},React.createElement("span",{className:"topbar-workspace-icon"},"\u2302"),Cg,H?.branch&&H.branch!=="unk\
nown"&&React.createElement("button",{className:`topbar-branch-btn${Xs?" active":""}`,title:`Branch: ${H.branch}`,onClick:()=>{
let r=!Xs;Rs(r),r&&cr(m)}},React.createElement("span",{className:"topbar-branch-icon"},"\u2442"),H.branch)))),React.createElement(
"div",{className:"topbar-meta"},React.createElement("button",{className:"theme-toggle-btn",onClick:()=>Gc(r=>r==="light"?
"dark":"light"),title:"Toggle Light/Dark Mode"},yr==="light"?"\u{1F319}":"\u2600\uFE0F"),React.createElement("span",{className:`\
context-pill topbar-relay-status ${i?"ok":"warn"}`,title:i?"Relay connected":"Relay disconnected \u2014 reconnecting"},i?
"relay live":"reconnecting"),React.createElement("span",{className:`context-pill topbar-proxy-health ${Ka==="healthy"?"o\
k":Ka==="degraded"?"warn":Ka==="disconnected"?"error":""}`,title:`Proxy: ${Ka||"connecting"}`},React.createElement("span",
{className:"topbar-health-dot"}),Ka==="healthy"?"live":Ka==="degraded"?"degraded":Ka==="disconnected"?"offline":"connect\
ing"),xd&&React.createElement("span",{className:"context-pill",title:"Remote machine"},xd),Ad&&React.createElement("span",
{className:"context-pill",title:"Native editor host"},Ad),React.createElement($v,{session:j,config:H,providerUsage:oi,onOpenUsage:()=>{
ia(),En(!0),Ln(!1),_n(!1)}}),(Po||Pr)&&React.createElement("button",{type:"button",className:"context-pill session-contr\
ol-pill goal-control",onClick:()=>Po&&ml(m,qo,la,j),disabled:!Po||!i||!!ks[m],"aria-label":Po?`${qo==="pause"?"Pause":Pr?
"Resume blocked":"Resume"} goal`:"Goal blocked; resolve in the native session",title:Pr?Tg||"No verified native unblock \
action is available":void 0},ks[m]?qo==="pause"?"Pausing goal...":"Resuming goal...":qo==="pause"?"Pause goal":Pr?Po?"Re\
sume blocked goal":"Goal blocked \xB7 native action required":"Resume goal"),$d&&React.createElement("button",{type:"but\
ton",className:"context-pill session-control-pill interrupt-control",onClick:()=>pl(m,j),disabled:!i||!!fn[m],"aria-labe\
l":"Interrupt turn"},fn[m]?"Interrupting...":"Interrupt turn"),j?.agent_type==="codex"&&j?.visible_pane_visible&&React.createElement(
"span",{className:`context-pill ${_l?"ok":"warn"}`,title:_l?"This Codex session is the visible right-hand pane":`Visible\
 right-hand pane is ${yd}`},_l?"right pane live":`right pane: ${Su(j.visible_pane_agent)||"other"}`),nt.length>0&&React.
createElement("span",{className:"context-pill",title:"Messages in this session"},nt.length," msg",nt.length!==1?"s":""),
(H?.capabilities?.chat_list||Ve)&&React.createElement("button",{className:`context-pill chat-list-toggle${(Ve?Ft:Pa)?" a\
ctive":""}`,title:Ve?`${Ft?"Hide":"Show"} Agent Manager projects and conversations`:"View conversations",onClick:()=>{if(Ve){
$n(b=>!b),wt(!1),Z(m);return}let r=!Pa;wt(r),r&&Z(m)}},Ve?"projects":"chats"),H?.capabilities?.thread_list&&React.createElement(
"button",{className:`context-pill chat-list-toggle${gn?" active":""}`,title:"View threads",onClick:()=>{let r=!gn;Jt(r),
r&&X(m)}},"threads"),(H?.capabilities?.terminal_output||H?.capabilities?.terminal_input)&&React.createElement("button",{
className:`context-pill terminal-toggle${Zt?" active":""}`,title:"Open terminal controls",onClick:()=>{let r=!Zt;Ys(r),r&&
H?.capabilities?.terminal_output&&W(m)}},"terminal"),H?.capabilities?.file_changes&&React.createElement("button",{className:`\
context-pill diff-toggle${ho?" active":""}`,title:"View file changes",onClick:()=>{let r=!ho;fi(r),r&&fe(m)}},"changes"),
Di?.visible&&React.createElement("span",{className:"context-pill ok",title:Di.title||"Automation"},"automation"),H?.capabilities?.
file_browser&&React.createElement("button",{className:`context-pill files-toggle${rn?" active":""}`,title:"Browse worksp\
ace files",onClick:()=>{let r=!rn;gi(r),r&&(Da(null),bo("."),ro(m,"."))}},"files"),H?.capabilities?.open_panel&&React.createElement(
"button",{className:"context-pill open-panel-btn",title:"Open panel in Antigravity",onClick:()=>ee(m)},"open panel"),H?.
capabilities?.native_window&&React.createElement("button",{className:"context-pill open-panel-btn",title:`Open this ${Su(
j?.agent_type)||"CLI"} session in a native command window`,onClick:r=>Se(m,r)},"native"),Ei&&De?.label&&De.label!=="Gene\
rating"&&React.createElement("span",{className:"context-pill thinking",title:De.label},De.label.length>40?De.label.substring(
0,40)+"\u2026":De.label))):React.createElement("div",{className:"topbar-title-group"},React.createElement("div",{className:"\
topbar-title"},"Agent Chat"),React.createElement("div",{className:"topbar-subtitle"},"Select a session to inspect its tr\
anscript and status")))),(j?.agent_type==="cline"||j?.agent_type==="roo_code")&&Cl&&React.createElement("div",{className:`\
cline-context-strip ${j?.agent_type==="roo_code"?"roo-context-strip":""}`},React.createElement(Qv,{card:Cl,tone:j?.agent_type===
"roo_code"?"roo":"cline"})),Xs&&m&&H?.capabilities?.branch_list&&React.createElement(gy,{branchData:so[m]||null,sessionId:m,
currentBranch:H?.branch,onSwitch:r=>{wa(m,r),Rs(!1)},onCreate:r=>{fs(m,r),Rs(!1)},onClose:()=>Rs(!1)}),rn&&m&&H?.capabilities?.
file_browser&&React.createElement(xy,{sessionId:m,listing:ai[m],fileContents:dr,viewingFile:vo,onNavigate:r=>{bo(r),Da(null),
ro(m,r)},onOpenFile:r=>{Da(r),Sa(m,r)},onBackToListing:()=>Da(null),onRefresh:()=>{vo?Sa(m,vo):ro(m,Hc)},onClose:()=>{gi(
!1),Da(null)}}),React.createElement("div",{className:`messages-wrap${Di?.visible?" has-automation-pane":""}`,style:rn?{display:"\
none"}:void 0},Dg&&React.createElement(fy,{threads:jg,activeThreadId:hn[m]||null,showDraftTab:!!Cs[m]||So,newLabel:wl,onSwitch:r=>xl(
m,r),onNew:()=>Fi(m),onOpenHistory:()=>{X(m),Jt(!0)}}),$g&&React.createElement("div",{className:"last-user-banner",title:Sl},
React.createElement("span",{className:"last-user-banner-icon"},"\u21B5"),React.createElement("span",{className:"last-use\
r-banner-text"},Sl)),xg&&React.createElement("div",{className:"rate-limit-overlay warning"},React.createElement("span",{
className:"rate-limit-icon"},"\u2318"),React.createElement("span",{className:"rate-limit-text"},"The visible right-hand \
pane for this workspace is showing ",React.createElement("strong",null,kd||eo(Bn,qe(Bn))),", not this transcript."),React.
createElement("button",{className:"context-pill",onClick:()=>is(qe(Bn),Bn),title:"Switch to the live right-hand pane ses\
sion"},"View live pane")),yg&&React.createElement("div",{className:`agv2-session-nav${Ft?"":" collapsed"}`},React.createElement(
"div",{className:"agv2-session-nav-header"},React.createElement("div",{className:"agv2-session-nav-copy"},React.createElement(
"span",{className:"agv2-session-nav-title"},"Agent Manager"),React.createElement("span",{className:"agv2-session-nav-met\
a"},bd," conversation",bd===1?"":"s")),React.createElement("button",{className:"agv2-session-nav-btn",type:"button",onClick:()=>Z(
m),title:"Refresh Agent Manager conversations"},"Refresh"),React.createElement("button",{className:"agv2-session-nav-btn",
type:"button",onClick:()=>{$n(r=>!r),Z(m)},title:Ft?"Hide Agent Manager conversations":"Show Agent Manager conversations"},
Ft?"Hide":"Show")),Ft&&React.createElement(Nu,{items:_d,embedded:!0,loading:!gl,onNavigate:r=>Al(r),onNew:()=>Va(m)})),Ss&&
!Wa&&React.createElement("button",{className:"jump-to-newest",onClick:og},Ks>0?`\u2193 ${Ks} new`:"\u2193 Jump to Newest"),
React.createElement("div",{className:`messages harness-theme harness-theme-${oe(j?.agent_type||"default").replace(/[^a-z0-9_-]/gi,
"-")}`,"data-agent-type":j?.agent_type||"default","data-layout":xv(j?.agent_type),"data-transcript-windowed":Ke.enabled?
"true":"false","data-total-message-count":Dn.length,"data-window-start":Ke.start,"data-window-end":Ke.end,key:Xc,ref:nn},
Og&&React.createElement("div",{className:"messages-flex-spacer"}),jn&&React.createElement(Zv,{prompt:jn,sessionId:m,agentType:j?.
agent_type,onRespond:A,onDismissFocus:()=>Pn.current?.focus()}),To&&!jn&&React.createElement(ey,{prompt:To,sessionId:m,onRespond:$}),
(j?.rate_limit_active||j?.percent_used!=null&&j.percent_used>=75)&&React.createElement("div",{className:`rate-limit-over\
lay${j?.rate_limit_active||j?.percent_used>=90?" critical":j?.percent_used>=75?" warning":""}`},React.createElement("spa\
n",{className:"rate-limit-icon"},j?.rate_limit_active?"\u23F3":"\u{1F4CA}"),React.createElement("span",{className:"rate-\
limit-text"},j?.rate_limit_active?React.createElement(React.Fragment,null,"Rate limited",j.rate_limited_until&&j.rate_limited_until!==
"unknown"?React.createElement(React.Fragment,null," \u2014 resets ",React.createElement("strong",null,ni(j.rate_limited_until))):
null):React.createElement(React.Fragment,null,"Used ",React.createElement("strong",null,j.percent_used,"%")," of session\
 limit",j.rate_limited_until&&j.rate_limited_until!=="unknown"?React.createElement(React.Fragment,null," \xB7 resets ",React.
createElement("strong",null,ni(j.rate_limited_until))):null))),ji&&React.createElement("div",{className:"history-tail-ba\
nner"},React.createElement("span",null,qd>Bi?React.createElement(React.Fragment,null,"Showing latest ",Bi.toLocaleString(),
" of ",qd.toLocaleString()," messages"):React.createElement(React.Fragment,null,"Showing latest ",Bi.toLocaleString()," \
messages")),React.createElement("button",{type:"button",onClick:Pd,disabled:!!ca},ca?"Loading older messages...":"Load o\
lder messages")),m&&ca&&nt.length>0&&!ji&&React.createElement("div",{className:"history-tail-banner history-refresh-bann\
er",role:"status"},React.createElement("span",null,"Refreshing latest messages...")),m&&Gt?.error&&React.createElement("\
div",{className:"history-tail-banner history-error-inline",role:"alert"},React.createElement("span",null,Gt.error),React.
createElement("button",{type:"button",onClick:Ig,disabled:!!ca},"Retry transcript")),m?nt.length===0&&!tn&&jr&&j?.is_list_view&&
J[m]?.length>0&&!Cs[m]&&!So?React.createElement("div",{className:"thread-picker-empty"},React.createElement("div",{className:"\
thread-picker-header"},"Select a chat"),React.createElement("div",{className:"thread-picker-list"},J[m].map((r,b)=>React.
createElement("button",{key:r.cache_key||r.id||b,className:`thread-picker-item${r.active?" active":""}`,onClick:()=>{xl(
m,r.id)},title:r.title},React.createElement("span",{className:"thread-picker-title"},r.title||"Untitled"),r.age&&React.createElement(
"span",{className:"thread-picker-age"},r.age)))),React.createElement("button",{className:"thread-picker-new",onClick:()=>Fi(
m)},"+ New Thread")):nt.length===0&&!tn&&Ve&&j?.is_list_view?React.createElement("div",{className:"thread-picker-empty a\
gv2-picker-empty"},React.createElement("div",{className:"thread-picker-header"},"Choose a conversation or start a new on\
e"),Ft?null:Ae[m]?.length>0?React.createElement(Nu,{items:Ae[m]||[],embedded:!0,loading:!gl,onNavigate:r=>Al(r),onNew:()=>Va(
m)}):React.createElement("button",{className:"thread-picker-new",onClick:()=>Va(m)},"+ New Conversation")):nt.length===0&&
!tn&&Ve&&Ae[m]?.length>0?React.createElement("div",{className:"thread-picker-empty agv2-picker-empty"},React.createElement(
"div",{className:"thread-picker-header"},"Select an Antigravity project or conversation"),!Ft&&React.createElement(Nu,{items:Ae[m]||
[],embedded:!0,loading:!gl,onNavigate:r=>Al(r),onNew:()=>Va(m)})):nt.length===0&&!tn&&j?.is_list_view&&Ae[m]?.length>0?React.
createElement("div",{className:"thread-picker-empty"},React.createElement("div",{className:"thread-picker-header"},"Sele\
ct a conversation or type a new message"),React.createElement("div",{className:"thread-picker-list"},Ae[m].map((r,b)=>React.
createElement("button",{key:r.id||b,className:`thread-picker-item${r.active?" active":""}`,onClick:()=>ue(m,r.id),title:r.
title},React.createElement("span",{className:"thread-picker-title"},r.title||"Untitled"))))):nt.length===0&&!tn&&ca?React.
createElement("div",{className:"empty-state history-loading-state"},React.createElement("span",{className:"new-session-s\
pinner"}),React.createElement("div",null,ca.mode==="older"?"Loading older messages...":"Loading latest messages...")):nt.
length===0&&!tn?React.createElement("div",{className:"empty-state"},React.createElement("div",{className:"icon"},"\u{1F4AC}"),
React.createElement("div",null,"No messages yet")):React.createElement(React.Fragment,null,Ke.enabled&&React.createElement(
"div",{className:"transcript-window-spacer top","data-testid":"transcript-window-top-spacer",style:{height:`${Ke.topSpacerHeight}\
px`}}),Pg,Ke.enabled&&React.createElement("div",{className:"transcript-window-spacer bottom","data-testid":"transcript-w\
indow-bottom-spacer",style:{height:`${Ke.bottomSpacerHeight}px`}})):React.createElement("div",{className:"empty-state"},
React.createElement("div",{className:"icon"},"\u{1F916}"),React.createElement("div",null,"Select an agent session")),tn&&
React.createElement(Pv,{stream:tn,activeAgent:dt,monospace:Do}),Id&&React.createElement("div",{className:`message assist\
ant live-draft${Do?" monospace":""}`,"data-message-role":"assistant","data-message-timestamp":ls(De?.started_at||De?.updated_at)?.
iso||"unknown"},React.createElement("div",{className:"assistant-gutter"},React.createElement("div",{className:"agent-bad\
ge transcript-agent-badge",style:{color:dt.color,borderColor:dt.color+"55",background:dt.color+"18"}},dt.logo?React.createElement(
"img",{src:dt.logo,alt:dt.abbr,className:"agent-badge-logo"}):dt.abbr)),React.createElement("div",{className:"assistant-\
content"},React.createElement("div",{className:"message-role"},React.createElement("span",{className:"message-role-label"},
dt.name),React.createElement(ti,{instant:De?.started_at||De?.updated_at})),React.createElement(Gr,{content:Dr,monospace:Do,
autoExpandLongCodeBlocks:hl,onOpenPath:r=>Nl("live-draft",r)}))),ud&&!jn&&React.createElement(ty,{prompt:ud,sessionId:m,
onRespond:$}),React.createElement("div",{ref:sg})),React.createElement($y,{view:Di,onShow:()=>m&&ao(m)})),(De?.task_list||
Od)&&!rn&&React.createElement("div",{className:"transcript-live-footer","data-testid":"transcript-live-footer"},De?.task_list&&
!De?.step&&React.createElement("div",{className:"session-tasklist-strip"},React.createElement(Xv,{taskList:De.task_list,
sessionId:m})),Od&&React.createElement("div",{className:"composer-live-status-strip"},React.createElement(Yv,{activity:De,
thinkingText:m&&y[m]||"",agentType:j?.agent_type,pinned:!0}))),Fc&&m&&React.createElement(dy,{session:j||m,config:H,configControlStates:te,
onRequestRefresh:ie,onSetModel:(r,b)=>ge(r,b),onSetEffort:(r,b)=>z(r,b),onSetPermissionMode:(r,b)=>ae(r,b),onSetAutoApprovePermissions:(r,b)=>_e(
r,b),onSetMode:(r,b)=>V&&V(r,b),onSetCodexConfig:r=>he(m,r),onSwitchWorkspace:(r,b)=>E(r,b),onClose:()=>bs(!1)}),!1,Pa&&
m&&H?.capabilities?.chat_list&&!Ve&&React.createElement(py,{chats:Ae[m]||[],sessionId:m,onSwitch:r=>{ue(m,r),wt(!1)},onNew:()=>{
de(m),wt(!1)},onClose:()=>wt(!1)}),gn&&m&&H?.capabilities?.thread_list&&React.createElement(my,{threads:J[m]||[],sessionId:m,
newLabel:wl,onSwitch:r=>{xl(m,r),Jt(!1)},onNew:()=>{Fi(m),Jt(!1)},onClose:()=>Jt(!1)}),!rn&&Zt&&m&&(H?.capabilities?.terminal_output||
H?.capabilities?.terminal_input)&&React.createElement(hy,{entries:me[m]||[],canRead:!!H?.capabilities?.terminal_output,canInput:!!H?.
capabilities?.terminal_input,onRefresh:()=>W(m),onSend:r=>ce(m,r),controlResults:Kn,onClose:()=>Ys(!1)}),!rn&&ho&&m&&H?.
capabilities?.file_changes&&React.createElement(_y,{entries:Le[m]||[],onRefresh:()=>fe(m),onAccept:r=>we(m,r,"accept"),onReject:r=>we(
m,r,"reject"),onClose:()=>fi(!1)}),React.createElement("div",{className:`input-area composer-skin-${uf(j?.agent_type)}`,
"data-composer-skin":uf(j?.agent_type),style:rn?{display:"none"}:void 0},React.createElement("label",{className:`attach-\
btn ${!m||!i||Wa?"disabled":""}`,title:"Attach file"},React.createElement("svg",{width:"18",height:"18",viewBox:"0 0 24 \
24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"},React.createElement(
"path",{d:"M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-\
8.48"})),React.createElement("input",{type:"file",hidden:!0,multiple:!0,ref:rg,onChange:ug,disabled:!m||!i||!!Wa})),React.
createElement("div",{className:"input-col"},fl.length>0&&React.createElement("div",{className:"file-chips"},fl.map((r,b)=>React.
createElement("div",{key:b,className:"file-chip"},React.createElement("span",null,"\u{1F4C4} ",r.name,r.isText?"":" (upl\
oaded)"),React.createElement("button",{onClick:()=>cg(m,b)},"\xD7")))),Ma&&Oi.length>0&&React.createElement("div",{className:"\
slash-menu"},Oi.map(r=>React.createElement("button",{key:r.command,type:"button",className:"slash-item",onClick:()=>jd(r.
command)},React.createElement("span",{className:"slash-command"},r.command),React.createElement("span",{className:"slash\
-detail"},r.detail)))),m&&Ia[m]&&React.createElement("div",{className:`goal-command-notice ${Ia[m].status}`,role:Ia[m].status===
"failed"?"alert":"status","data-request-id":Ia[m].requestId||void 0},React.createElement("strong",null,"Goal control"),React.
createElement("span",null,Ia[m].text)),m&&(xe[m]||[]).length>0&&React.createElement("div",{className:"queued-bar"},(xe[m]||
[]).map(r=>React.createElement(Gv,{key:r.cid,qm:r,onSteer:()=>Me(m,r.cid,r.content,r.nativeIndex),onDiscard:()=>B(m,r.cid),
onEdit:b=>ne(m,r.cid,b)}))),React.createElement("div",{className:"textarea-row"},React.createElement("textarea",{ref:Pn,
value:cs,onChange:r=>Bg(r.target.value),onKeyDown:fg,onPaste:dg,placeholder:Wa?`Resolve the ${jn?.type==="question_promp\
t"?"question":jn?"permission prompt":"error prompt"} above to continue`:m?window.innerWidth<600?"Enter message\u2026":"M\
essage\u2026 (/ for commands)":"Select a session",disabled:!m,rows:1}),React.createElement("div",{className:"textarea-bt\
ns"},m&&React.createElement("button",{className:`composer-gear-btn schedule-send-btn${Bt?" active":""}`,onClick:()=>gr(r=>!r),
title:"Schedule this message","aria-label":"Schedule message"},"\u25F7"),m&&React.createElement("button",{className:`com\
poser-gear-btn${pi?" active":""}`,onClick:()=>vs(r=>!r),title:"Toggle settings"},"\u2699"),Nd&&React.createElement("butt\
on",{className:"composer-gear-btn mobile-hide",onClick:()=>Fi(m),title:wl},"\u270E"),(H?.capabilities?.chat_list||Ve)&&React.
createElement("button",{className:`composer-gear-btn mobile-hide${(Ve?Ft:Pa)?" active":""}`,onClick:()=>{if(Ve){$n(b=>!b),
wt(!1),Z(m);return}let r=!Pa;wt(r),r&&Z(m)},title:Ve?"Agent Manager conversations":"Chat history"},"\u2630"),H?.capabilities?.
thread_list&&React.createElement("button",{className:`composer-gear-btn mobile-hide${gn?" active":""}`,onClick:()=>{let r=!gn;
Jt(r),r&&X(m)},title:"Thread history"},"\u229F"),H?.capabilities?.open_panel&&React.createElement("button",{className:"c\
omposer-gear-btn mobile-hide",onClick:()=>ee(m),title:"Open panel"},"\u229E"),H?.capabilities?.native_window&&React.createElement(
"button",{className:"composer-gear-btn mobile-hide",onClick:r=>Se(m,r),title:"Open native command window"},"cmd"),H?.capabilities?.
new_chat&&React.createElement("button",{className:"composer-gear-btn mobile-hide",onClick:()=>Ve?Va(m):de(m),title:Ve?"N\
ew Antigravity conversation":"New chat"},"+"),$d?React.createElement("button",{className:`stop-btn${Ir?" pending":""}`,title:Ir?
"Interrupting\u2026":"Interrupt agent",disabled:Ir,onClick:dl},Ir?React.createElement("span",{className:"stop-btn-spinne\
r"}):"\u25A0"):React.createElement("button",{className:"send-btn",onClick:cd,disabled:!gg,title:i?"Send":"Queue until re\
connected"},Ra?"\u2026":"\u2191"))),React.createElement("div",{className:"composer-meta"},qa===m&&Ei&&!Ir&&React.createElement(
"span",{className:"interrupt-confirm-inline",role:"status","aria-live":"polite"},"Press Esc again or Enter to interrupt"),
(Ru(j?.agent_type)||Jo(j?.agent_type))&&H?.mode&&H.mode!=="unknown"&&React.createElement("span",{className:"composer-hin\
t",style:{color:"#d29922"}},H.mode),(Ru(j?.agent_type)||Jo(j?.agent_type))&&H?.model_id&&H.model_id!=="unknown"&&React.createElement(
"span",{className:"composer-hint",style:{color:"#d29922"}},H.model_id),j?.agent_type==="codex_cli"&&H?.config_semantics===
"observed_and_next_send"&&React.createElement("span",{className:"composer-hint",style:{color:"#8b949e"}},"Observed ",H.observed_model_id||
"unknown"," / ",H.observed_effort||"unknown"," \xB7 ","Next ",H.next_send_model_id||"unset"," / ",H.next_send_effort||"u\
nset"),j?.agent_type==="antigravity-v2"&&H?.model_id&&H.model_id!=="unknown"&&React.createElement("span",{className:"com\
poser-hint",style:{color:"#8b949e"}},H.model_id),(j?.agent_type==="antigravity"||j?.agent_type==="antigravity_panel")&&(Array.
isArray(j?.antigravity_quota_models)&&j.antigravity_quota_models.length>0?React.createElement("span",{className:"compose\
r-hint",style:{color:"#8b949e"}},jf(j.antigravity_quota_models,4)):j?.percent_used!=null?React.createElement("span",{className:"\
composer-hint",style:{color:j.percent_used>=90?"#f85149":j.percent_used>=75?"#d29922":"#8b949e"}},"Quota ",j.percent_used,
"%",j?.rate_limited_until&&j.rate_limited_until!=="unknown"?` \xB7 ${j.rate_limited_until}`:""):null),React.createElement(
"span",{className:"composer-hint"},"Enter send"),React.createElement("span",{className:"composer-hint"},"Shift+Enter new\
line"),React.createElement("span",{className:"composer-hint"},"Ctrl/Cmd+K focus"),React.createElement("span",{className:"\
composer-hint"},"/ commands"),React.createElement("span",{className:"composer-hint"},"Ctrl+V image"),m&&cs&&React.createElement(
"span",{className:"composer-hint draft-live"},"draft saved")),m&&React.createElement("div",{className:`composer-settings${pi?
" is-open":""}`},(hd||qi)&&React.createElement("div",{className:`composer-control-state ${qi?"failed":"pending"}`,role:"\
status"},qi?qi.error:`Saving ${hd.field.replace(/_/g," ")}\u2026`),(H?.capabilities?.set_model||j?.agent_type==="antigra\
vity"||j?.agent_type==="antigravity_panel")&&React.createElement(React.Fragment,null,j?.agent_type==="codex_cli"&&H?.config_semantics===
"observed_and_next_send"&&React.createElement("span",{className:"composer-setting-label","data-control":"observed-model"},
React.createElement("span",{className:"composer-setting-key"},"Observed model"),React.createElement("span",{className:"c\
omposer-hint"},H.observed_model_id||"unknown")),React.createElement("label",{className:"composer-setting-label","data-co\
ntrol":"model"},React.createElement("span",{className:"composer-setting-key"},j?.agent_type==="codex_cli"&&H?.config_semantics===
"observed_and_next_send"?"Next model":"Model"),React.createElement("select",{className:"composer-setting-select",value:j?.
agent_type==="codex_cli"&&H?.config_semantics==="observed_and_next_send"?H.next_send_model_id||"":H?.model_id||"default",
onChange:r=>ge(m,r.target.value)},j?.agent_type==="codex_cli"&&H?.config_semantics==="observed_and_next_send"&&React.createElement(
"option",{value:"",disabled:!0},"Choose model\u2026"),wf(j?.agent_type,H).map(r=>React.createElement("option",{key:r.id,
value:r.id},r.label)),H?.model_id&&!wf(j?.agent_type,H).some(r=>r.id===H.model_id)&&H.model_id!=="unknown"&&H.config_semantics!==
"observed_and_next_send"&&React.createElement("option",{value:H.model_id},H.model_id)),j?.agent_type==="codex_cli"&&H?.config_semantics===
"observed_and_next_send"&&React.createElement("span",{className:"composer-hint"},H.next_send_model_status||"unset"))),(j?.
agent_type==="antigravity"||j?.agent_type==="antigravity_panel")&&React.createElement("label",{className:"composer-setti\
ng-label","data-control":"mode"},React.createElement("span",{className:"composer-setting-key"},"Mode"),React.createElement(
"select",{className:"composer-setting-select",value:H?.conversation_mode||"Planning",onChange:r=>V(m,r.target.value)},Uu.
map(r=>React.createElement("option",{key:r.id,value:r.id},r.label)))),(Jo(j?.agent_type)||j?.agent_type==="cursor")&&H?.
capabilities?.set_mode&&Qo(j?.agent_type,H).length>0&&React.createElement("label",{className:"composer-setting-label","d\
ata-control":"mode"},React.createElement("span",{className:"composer-setting-key"},"Mode"),React.createElement("select",
{className:"composer-setting-select",value:H?.mode||Qo(j?.agent_type,H)[0]?.id||"unknown",onChange:r=>V(m,r.target.value)},
Qo(j?.agent_type,H).map(r=>React.createElement("option",{key:r.id,value:r.id},r.label)),H?.mode&&H.mode!=="unknown"&&!Qo(
j?.agent_type,H).some(r=>r.id===H.mode)&&React.createElement("option",{value:H.mode},H.mode))),H?.capabilities?.permission_mode_change&&
React.createElement("label",{className:"composer-setting-label","data-control":"permission"},React.createElement("span",
{className:"composer-setting-key"},j?.agent_type==="codex_cli"?"Access":"Permission"),React.createElement("select",{className:"\
composer-setting-select",value:H.permission_mode||Uf(j?.agent_type),onChange:r=>ae(m,r.target.value),title:"Permission m\
ode"},Lu(j?.agent_type||"claude",H).map(r=>React.createElement("option",{key:r.value,value:r.value},r.label)),H.permission_mode&&
!Lu(j?.agent_type,H).some(r=>r.value===H.permission_mode)&&H.permission_mode!=="unknown"&&React.createElement("option",{
value:H.permission_mode},H.permission_mode))),(j?.agent_type==="claude_cli"||j?.agent_type==="codex_cli"||j?.agent_type===
"cursor_cli")&&H?.capabilities?.set_effort&&(H.available_efforts||[]).length>0&&React.createElement(React.Fragment,null,
j?.agent_type==="codex_cli"&&H?.config_semantics==="observed_and_next_send"&&React.createElement("span",{className:"comp\
oser-setting-label","data-control":"observed-effort"},React.createElement("span",{className:"composer-setting-key"},"Obs\
erved effort"),React.createElement("span",{className:"composer-hint"},H.observed_effort||"unknown")),React.createElement(
"label",{className:"composer-setting-label","data-control":"effort"},React.createElement("span",{className:"composer-set\
ting-key"},j?.agent_type==="codex_cli"&&H?.config_semantics==="observed_and_next_send"?"Next effort":"Effort"),React.createElement(
"select",{className:"composer-setting-select",value:j?.agent_type==="codex_cli"&&H?.config_semantics==="observed_and_nex\
t_send"?H.next_send_effort||"":H.effort||"medium",onChange:r=>z(m,r.target.value),title:`${j?.agent_type==="codex_cli"?"\
Codex":j?.agent_type==="cursor_cli"?"Cursor":"Claude"} CLI effort`},j?.agent_type==="codex_cli"&&H?.config_semantics==="\
observed_and_next_send"&&React.createElement("option",{value:"",disabled:!0},"Choose effort\u2026"),(H.available_efforts||
[]).map(r=>React.createElement("option",{key:r.id,value:r.id},r.label))),j?.agent_type==="codex_cli"&&H?.config_semantics===
"observed_and_next_send"&&React.createElement("span",{className:"composer-hint"},H.next_send_effort_status&&H.next_send_effort_status!==
"unset"?H.next_send_effort_status:"No override selected"))),H?.capabilities?.auto_approve_permissions_toggle&&React.createElement(
"label",{className:"composer-setting-toggle",title:"Automatically approve permission prompts for this session"},React.createElement(
"input",{type:"checkbox",checked:typeof H?.auto_approve_permissions=="boolean"?H.auto_approve_permissions:!!j?.auto_approve_permissions,
onChange:r=>_e(m,r.target.checked)}),React.createElement("span",null,"Auto-approve prompts")),H?.capabilities?.set_codex_config&&
React.createElement(React.Fragment,null,H?.capabilities?.codex_model_change&&React.createElement("label",{className:"com\
poser-setting-label","data-control":"model"},React.createElement("span",{className:"composer-setting-key"},j?.agent_type===
"codex"?"Next model":"Model"),React.createElement("select",{className:"composer-setting-select",value:H.model_id||"unkno\
wn",disabled:j?.agent_type==="codex"&&H.controls_available===!1||["pending","awaiting_config"].includes(te?.[`${m}:model`]?.
status),onChange:r=>he(m,{model_id:r.target.value}),title:j?.agent_type==="codex"?"Next-turn Codex model":"Codex Desktop\
 model"},(H.available_models||[]).map(r=>React.createElement("option",{key:r.id,value:r.id},r.label)),H.model_id&&!(H.available_models||
[]).some(r=>r.id===H.model_id)&&H.model_id!=="unknown"&&React.createElement("option",{value:H.model_id},H.model_id))),H?.
capabilities?.codex_effort_change&&React.createElement("label",{className:"composer-setting-label","data-control":"effor\
t"},React.createElement("span",{className:"composer-setting-key"},j?.agent_type==="codex"?"Next effort":"Effort"),React.
createElement("select",{className:"composer-setting-select",value:(H.effort||"unknown").toLowerCase(),disabled:j?.agent_type===
"codex"&&H.controls_available===!1||["pending","awaiting_config"].includes(te?.[`${m}:effort`]?.status),onChange:r=>he(m,
{effort:r.target.value}),title:j?.agent_type==="codex"?"Next-turn reasoning effort":"Codex Desktop reasoning effort"},(H.
available_efforts||[]).map(r=>React.createElement("option",{key:r.id,value:r.id},r.label)))),H?.capabilities?.codex_permission_profile_change&&
React.createElement("label",{className:"composer-setting-label","data-control":"permission-profile"},React.createElement(
"span",{className:"composer-setting-key"},"Next permissions"),React.createElement("select",{className:"composer-setting-\
select",value:H.permission_profile||"unknown",disabled:H.controls_available===!1||["pending","awaiting_config"].includes(
te?.[`${m}:permission_profile`]?.status),onChange:r=>he(m,{permission_profile:r.target.value}),title:"Next-turn native C\
odex permissions profile"},H.permission_profile==="full-access"&&React.createElement("option",{value:"full-access",disabled:!0},
"Full access"),(H.available_permission_profiles||[]).filter(r=>r.id!=="full-access").map(r=>React.createElement("option",
{key:r.id,value:r.id},r.label)))),H?.capabilities?.codex_bypass_permissions&&React.createElement("button",{type:"button",
className:"composer-desktop-action composer-bypass-action",onClick:()=>{bs(!0),vs(!1)},title:"Review and confirm Full ac\
cess in Session Settings"},H.bypass_permissions_active?"Bypass active":"Bypass\u2026"),H?.capabilities?.codex_speed_change&&
React.createElement("label",{className:"composer-setting-label","data-control":"speed"},React.createElement("span",{className:"\
composer-setting-key"},"Speed"),React.createElement("select",{className:"composer-setting-select",value:(H.speed||"stand\
ard").toLowerCase(),onChange:r=>he(m,{speed:r.target.value}),title:"Speed"},(H.available_speeds||[]).map(r=>React.createElement(
"option",{key:r.id,value:r.id},r.label)),H.speed&&!(H.available_speeds||[]).some(r=>r.id===H.speed)&&H.speed!=="unknown"&&
React.createElement("option",{value:H.speed},H.speed))),H?.capabilities?.codex_access_change&&React.createElement("label",
{className:"composer-setting-label","data-control":"permission"},React.createElement("span",{className:"composer-setting\
-key"},"Access"),React.createElement("select",{className:"composer-setting-select",value:H.permission_mode||"unknown",onChange:r=>he(
m,{access_mode:r.target.value}),title:"Codex Desktop access mode"},(H.available_access||[]).map(r=>React.createElement("\
option",{key:r.id,value:r.id},r.label)),H.permission_mode&&!(H.available_access||[]).some(r=>r.id===H.permission_mode)&&
H.permission_mode!=="unknown"&&React.createElement("option",{value:H.permission_mode},H.permission_mode))),j?.agent_type===
"codex-desktop"&&(H.available_workspaces||[]).length>0&&React.createElement("select",{className:"composer-setting-select",
value:H.file_access_scope||"",onChange:r=>E(m,r.target.value),title:"Switch workspace"},(H.available_workspaces||[]).map(
r=>React.createElement("option",{key:r.id,value:r.path||r.id},r.label)))),qs&&React.createElement("span",{className:"com\
poser-workspace",title:qs},"\u2302 ",wd||qs),React.createElement("button",{className:"composer-desktop-action",onClick:()=>{
bs(!0),vs(!1)}},"\u2699 Session details"),React.createElement("div",{className:"composer-mobile-actions"},React.createElement(
"button",{className:"composer-mobile-action",onClick:()=>{bs(!0),vs(!1)}},"\u2699 Session details"),Nd&&React.createElement(
"button",{className:"composer-mobile-action",onClick:()=>be(m)},"\u270E New thread"),(H?.capabilities?.chat_list||Ve)&&React.
createElement("button",{className:"composer-mobile-action",onClick:()=>{Z(m),Ve?($n(!0),wt(!1)):wt(!0),vs(!1)}},"\u2630 ",
Ve?"Projects":"Chat history"),H?.capabilities?.thread_list&&React.createElement("button",{className:"composer-mobile-act\
ion",onClick:()=>{X(m),Jt(!0),vs(!1)}},"\u229F Threads"),H?.capabilities?.open_panel&&React.createElement("button",{className:"\
composer-mobile-action",onClick:()=>ee(m)},"\u229E Open panel"),H?.capabilities?.new_chat&&React.createElement("button",
{className:"composer-mobile-action",onClick:()=>Ve?Va(m):de(m)},"+ New chat"))))))),yt&&React.createElement("div",{className:"\
attention-toast",role:"status","aria-live":"polite"},React.createElement("span",{className:`attention-toast-icon ${yt.kind}`,
"aria-hidden":"true"},yt.kind==="prompt"||["goal_attention","provider_usage_threshold"].includes(yt.kind)?"!":"\u2713"),
React.createElement("span",{className:"attention-toast-copy"},React.createElement("strong",null,yt.title),React.createElement(
"span",null,yt.detail)),React.createElement("button",{type:"button",onClick:()=>{let r=je.find(b=>qe(b)===yt.sessionId);
r&&is(yt.sessionId,r),od()}},"Jump")),React.createElement("div",{className:`toast ${mr?"visible":""}`},mr))}var zf=(()=>{try{return new URLSearchParams(window.location.search).get("render_profile")==="1"}catch{return!1}})();function zy(e,t,n,s,a,i){
let c=window.__RAC_RENDER_PROFILER__||(window.__RAC_RENDER_PROFILER__=[]);c.push({id:e,phase:t,route:document.querySelector(
'[data-testid="fleet-view"]')?"fleet":document.querySelector('[data-testid="usage-dashboard"]')?"usage":document.querySelector(
'[data-testid="host-resource-dashboard"]')?"host-resources":document.querySelector(".messages")?"chat":"other",actual_duration_ms:Number(
n.toFixed(3)),base_duration_ms:Number(s.toFixed(3)),start_time_ms:Number(a.toFixed(3)),commit_time_ms:Number(i.toFixed(3))}),
c.length>2e3&&c.splice(0,c.length-2e3)}var Rf=React.createElement(Ou,null,React.createElement(Wy,null));ReactDOM.createRoot(
document.getElementById("root")).render(zf?React.createElement(React.Profiler,{id:"AgentChatRoot",onRender:zy},Rf):Rf);"serviceWorker"in navigator&&window.addEventListener("load",function(){navigator.serviceWorker.register("/sw.js").catch(
function(e){console.warn("SW registration failed:",e)})});(window.navigator.standalone===!0||window.matchMedia("(display\
-mode: standalone)").matches)&&document.body.classList.add("pwa-standalone");})();
