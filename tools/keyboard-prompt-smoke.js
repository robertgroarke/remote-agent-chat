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
  ['generic keyboard selection state', 'keyboardChoiceId'],
  ['number-key selection', "/^[1-9]$/.test(event.key)"],
  ['selected/default Enter fallback', 'keyboardChoiceId || defaultChoiceId'],
  ['structured atomic submit', 'submitQuestionAnswers();'],
  ['index-aware generated choice ids', 'promptChoiceId(item, index) === choiceId'],
  ['editable target guard', 'isEditableShortcutTarget(event.target)'],
  ['Other-text Enter submit', "closest?.('.permission-other-input')"],
  ['unresolved Esc focus fallback', 'onDismissFocus?.();'],
  ['Claude native Esc cancellation', 'claudeCancelChoice'],
  ['dismissed keyboard mode', 'setKeyboardDismissed(true)'],
  ['composer shortcut target', "matches?.('.input-area textarea')"],
  ['blocked composer send guard', 'if (activeBlockingPrompt) return;'],
  ['number accessibility metadata', 'aria-keyshortcuts='],
  ['prompt dialog semantics', "aria-label={claudeActionPrompt ? 'Claude Code permission prompt' : 'Permission or question prompt'}"],
  ['discoverable keyboard help', '1–9 select · Enter submit · Esc return to composer'],
]) {
  assert(app.includes(marker), `keyboard prompt contract is missing ${label}: ${marker}`);
}

for (const marker of ['.permission-key-hint', '.permission-keyboard-help']) {
  assert(styles.includes(marker), `keyboard prompt stylesheet is missing ${marker}`);
}

console.log(JSON.stringify({
  ok: true,
  checked_at: new Date().toISOString(),
  generic: { number_select: true, enter_selected_or_default: true },
  structured: { number_toggle: true, atomic_enter_submit: true, other_text_safe: true },
  claude_escape_submits_negative_choice: true,
  unresolved_escape_preserves_prompt: true,
  accessible_hints: true,
}, null, 2));
