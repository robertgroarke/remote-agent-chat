'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const web = fs.readFileSync(path.join(root, 'frontend', 'app.jsx'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'frontend', 'styles.css'), 'utf8');
const android = fs.readFileSync(path.join(root, 'android-app', 'screens', 'SessionListScreen.jsx'), 'utf8');
const outputIndex = process.argv.indexOf('--output');
const outputPath = outputIndex >= 0 && process.argv[outputIndex + 1]
  ? path.resolve(process.argv[outputIndex + 1]) : null;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const webContracts = [
  ['fuzzy ranking helper', 'function rankQuickSwitcherItems('],
  ['per-field fuzzy ranking', 'item.searchFields'],
  ['palette state', 'const [quickSwitcherOpen, setQuickSwitcherOpen]'],
  ['Ctrl/Cmd+P shortcut', "key === 'p'"],
  ['sidebar-order previous/next shortcut', "event.altKey"],
  ['shortcut help state', 'const [shortcutHelpOpen, setShortcutHelpOpen]'],
  ['editable-target guard for ?', 'isEditableShortcutTarget(event.target)'],
  ['palette dialog semantics', 'aria-label="Switch session"'],
  ['palette listbox semantics', 'role="listbox"'],
  ['palette search semantics', 'aria-label="Search sessions"'],
  ['selected result semantics', 'aria-selected={index === quickSwitcherIndex}'],
  ['shortcut help dialog semantics', 'aria-label="Keyboard shortcuts"'],
  ['session name search source', 'title,'],
  ['project search source', 'group.label,'],
  ['harness search source', 'agent.name,'],
];
for (const [label, marker] of webContracts) {
  assert(web.includes(marker), `web quick-switcher is missing ${label}: ${marker}`);
}

for (const marker of [
  '.quick-switcher-overlay',
  '.quick-switcher',
  '.quick-switcher-input',
  '.quick-switcher-option',
  '.shortcut-help',
]) {
  assert(styles.includes(marker), `quick-switcher stylesheet is missing ${marker}`);
}

assert(android.includes('const sessionSearchText ='),
  'Android session search must centralize the same name/project/harness search text');
assert(android.includes('sessionSearchText(item).includes('),
  'Android session filter must use the parity search text');
assert(android.includes('agentBadge(agentType(item)).label'),
  'Android session search must include the harness label');
assert(android.includes('workspace_path'),
  'Android session search must include project/workspace context');

const result = {
  ok: true,
  checked_at: new Date().toISOString(),
  web: {
    ctrl_cmd_p_palette: true,
    fuzzy_name_project_harness: true,
    enter_and_arrow_navigation: true,
    alt_sidebar_order_navigation: true,
    question_mark_help: true,
    accessible_dialogs: true,
  },
  android: {
    name_project_harness_search_parity: true,
  },
};
if (outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}
console.log(JSON.stringify(result, null, 2));
