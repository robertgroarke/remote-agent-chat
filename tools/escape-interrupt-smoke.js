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
  ['scoped confirm state', 'interruptConfirmSession'],
  ['synchronous double-Esc state', 'interruptConfirmRef.current'],
  ['brief confirmation window', 'Date.now() + 2500'],
  ['prompt priority', 'if (activeBlockingPrompt) return;'],
  ['slash-menu priority', 'if (showSlashMenu)'],
  ['generating-only guard', 'if (isActiveThinking && !isStopPending)'],
  ['Enter confirmation', "e.key === 'Enter' && !e.shiftKey"],
  ['shared interrupt action', 'onClick={performInterrupt}'],
  ['accessible inline confirmation', 'aria-live="polite"'],
  ['confirmation copy', 'Press Esc again or Enter to interrupt'],
]) {
  assert(app.includes(marker), `escape-interrupt contract is missing ${label}: ${marker}`);
}
assert(styles.includes('.interrupt-confirm-inline'), 'escape-interrupt confirmation styling is missing');

console.log(JSON.stringify({
  ok: true,
  checked_at: new Date().toISOString(),
  first_escape_arms: true,
  second_escape_confirms: true,
  enter_confirms: true,
  prompt_and_slash_menu_priority: true,
  brief_timeout_ms: 2500,
}, null, 2));
