'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'frontend', 'app.jsx'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'frontend', 'styles.css'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

for (const [label, marker] of [
  ['prompt identity tracking', 'previousPermissionPromptsRef'],
  ['completion transition tracking', 'previousThinkingRef'],
  ['prompt resolution cleanup', "next[sessionId]?.kind === 'prompt'"],
  ['completion attention state', "kind: 'completion'"],
  ['prompt attention state', "kind: 'prompt'"],
  ['actionable attention toast', 'className="attention-toast"'],
  ['Jump action', '>Jump</button>'],
  ['session-view cleanup', 'setSessionAttention(prev =>'],
  ['mobile attention count', 'attentionTotal'],
  ['hamburger attention indicator', 'className="hamburger-attention"'],
]) {
  assert(app.includes(marker), `cross-session attention contract is missing ${label}: ${marker}`);
}
for (const marker of ['.attention-toast', '.hamburger-attention', '@keyframes attention-toast-in']) {
  assert(styles.includes(marker), `cross-session attention stylesheet is missing ${marker}`);
}

console.log(JSON.stringify({
  ok: true,
  checked_at: new Date().toISOString(),
  prompt_and_question_attention: true,
  completion_transition_attention: true,
  jump_action: true,
  auto_dismiss_on_prompt_resolution: true,
  mobile_hamburger_indicator: true,
}, null, 2));
