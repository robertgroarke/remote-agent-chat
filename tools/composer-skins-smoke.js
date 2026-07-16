'use strict';

const fs = require('fs');
const path = require('path');
const visual = require('./visual-regression');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'frontend', 'app.jsx'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'frontend', 'styles.css'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

for (const skin of ['codex-cli', 'codex', 'claude', 'cursor']) {
  assert(app.includes(`return '${skin}'`), `composer skin mapping is missing ${skin}`);
  assert(styles.includes(`.composer-skin-${skin}`), `composer stylesheet is missing ${skin}`);
}
for (const control of ['model', 'permission', 'effort', 'speed', 'mode']) {
  assert(app.includes(`data-control="${control}"`), `composer control geometry is missing ${control}`);
}
assert(app.includes('data-composer-skin='), 'composer root does not expose its skin identity');
assert(JSON.stringify(visual.COMPOSER_AGENTS) === JSON.stringify(['claude', 'codex', 'codex-desktop', 'cursor', 'codex_cli']), 'unexpected composer visual agents');
assert(JSON.stringify(visual.COMPOSER_CASES) === JSON.stringify(['composer_chrome']), 'unexpected composer visual cases');

console.log(JSON.stringify({
  ok: true,
  checked_at: new Date().toISOString(),
  skins: ['claude', 'codex', 'codex-cli', 'cursor'],
  controls: ['model', 'permission/access', 'effort', 'speed', 'mode'],
  visual_agents: visual.COMPOSER_AGENTS,
  visual_cases_per_theme_viewport: visual.COMPOSER_CASES.length,
}, null, 2));
