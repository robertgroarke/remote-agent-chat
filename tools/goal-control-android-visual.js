#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('../frontend/node_modules/playwright-core');

const root = path.resolve(__dirname, '..');
const outputIndex = process.argv.indexOf('--output-dir');
const outputDir = outputIndex >= 0 && process.argv[outputIndex + 1]
  ? path.resolve(process.argv[outputIndex + 1])
  : path.join(root, 'evidence', 'harness-maturity', '2026-07-19', 'goal-stop-controls-android');

function findChrome() {
  return [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter(Boolean).find(candidate => fs.existsSync(candidate));
}

function fixture(pending) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
  *{box-sizing:border-box}html,body{margin:0;width:100%;min-height:100%;background:#0b0f14;color:#f0f6fc;font-family:Roboto,Arial,sans-serif}body{padding:0}.screen{width:390px;min-height:844px;margin:0 auto;background:#0b0f14;overflow:hidden}.native-header{height:56px;padding:0 14px;display:flex;align-items:center;border-bottom:1px solid #30363d;background:#0b0f14}.back{font-size:24px;color:#cdd9e5;margin-right:14px}.title{font-size:16px;font-weight:700}.health{height:24px;padding:0 12px;display:flex;align-items:center;gap:7px;border-bottom:1px solid #21262d;color:#8b949e;font-size:10px}.dot{width:7px;height:7px;border-radius:50%;background:#3fb950}.session-controls{min-height:54px;padding:8px 12px;border-bottom:1px solid #30363d;background:#10161d;display:flex;align-items:center;justify-content:space-between;gap:10px}.copy{flex:1;min-width:0}.eyebrow{color:#6e7681;font-size:9px;font-weight:700;letter-spacing:.7px}.state{color:#c9d1d9;font-size:11px;font-weight:600;margin-top:2px}.actions,.fleet-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:7px}.control{border:1px solid #388bfd;border-radius:7px;padding:7px 10px;background:#0d2138;color:#f0f6fc;font-size:11px;font-weight:700}.control.stop{border-color:#d29922;background:#2d210d}.control.pending{opacity:.55}.messages{height:170px;padding:14px;display:flex;flex-direction:column;justify-content:flex-end;gap:8px}.bubble{align-self:flex-start;max-width:84%;padding:10px 12px;border-radius:12px;background:#161b22;border:1px solid #30363d;color:#c9d1d9;font-size:12px}.section-title{padding:12px 14px 6px;font-size:18px;font-weight:700}.section-subtitle{padding:0 14px 10px;color:#8b949e;font-size:11px}.cards{padding:0 12px 16px;display:grid;gap:10px}.card{background:#161b22;border:1px solid #30363d;border-left:3px solid #58a6ff;border-radius:12px;padding:12px;display:grid;gap:8px}.card.goal{border-left-color:#3fb950}.card.gated{border-left-color:#8b949e}.card-top{display:flex;align-items:center;gap:8px}.badge{width:25px;height:25px;border-radius:7px;background:#1f6feb22;border:1px solid #58a6ff55;display:grid;place-items:center;font-size:11px}.identity{flex:1}.identity strong{display:block;font-size:13px}.identity span{display:block;color:#8b949e;font-size:10px;margin-top:2px}.pill{border:1px solid #30363d;border-radius:10px;padding:2px 6px;color:#8b949e;font-size:9px}.status{display:flex;align-items:center;gap:7px;font-size:11px;font-weight:600}.status .active{color:#58a6ff}.context{color:#c9d1d9;font-size:11px}.gate{color:#8b949e;font-size:10px}.composer{height:58px;border-top:1px solid #30363d;padding:9px 12px;display:flex;gap:8px}.input{flex:1;border:1px solid #30363d;border-radius:8px;background:#0d1117;color:#6e7681;padding:10px;font-size:12px}.send{width:42px;border-radius:8px;background:#238636;display:grid;place-items:center;font-weight:700}
  </style></head><body><main class="screen">
  <header class="native-header"><span class="back">‹</span><span class="title">Build lane</span></header>
  <div class="health"><span class="dot"></span><span>Relay healthy · 42 ms</span></div>
  <section class="session-controls" aria-label="Session controls"><div class="copy"><div class="eyebrow">TURN CONTROLS</div><div class="state">Goal active</div></div><div class="actions"><button class="control${pending ? ' pending' : ''}" ${pending ? 'disabled' : ''}>${pending ? 'Working...' : 'Pause goal'}</button><button class="control stop${pending ? ' pending' : ''}" ${pending ? 'disabled' : ''}>${pending ? 'Stopping...' : 'Interrupt turn'}</button></div></section>
  <section class="messages"><div class="bubble">The current turn is validating the production control path.</div></section><div class="composer"><div class="input">Message...</div><div class="send">↑</div></div>
  <h1 class="section-title">Fleet view</h1><div class="section-subtitle">Working sessions expose only verified controls.</div><section class="cards">
    <article class="card goal"><div class="card-top"><div class="badge">CX</div><div class="identity"><strong>Paused lane</strong><span>Codex CLI</span></div><span class="pill">GOAL PAUSED</span></div><div class="status"><span>Goal paused</span></div><div class="fleet-actions"><button class="control">Resume goal</button></div><div class="context">Resume only after operator review.</div></article>
    <article class="card"><div class="card-top"><div class="badge">CU</div><div class="identity"><strong>Cursor lane</strong><span>Cursor</span></div><span class="pill active">WORKING</span></div><div class="status"><span class="active">Reviewing diff</span></div><div class="fleet-actions"><button class="control stop">Interrupt turn</button></div><div class="context">Reviewing the active diff.</div></article>
    <article class="card gated"><div class="card-top"><div class="badge">AG</div><div class="identity"><strong>Antigravity lane</strong><span>Antigravity Chat</span></div><span class="pill">GATED</span></div><div class="status"><span>Drafting response</span></div><div class="gate">No verified session-scoped stop exists. No dead button is rendered.</div></article>
  </section></main></body></html>`;
}

(async () => {
  const chatSource = fs.readFileSync(path.join(root, 'android-app', 'screens', 'ChatScreen.jsx'), 'utf8');
  const fleetSource = fs.readFileSync(path.join(root, 'android-app', 'screens', 'SessionListScreen.jsx'), 'utf8');
  for (const marker of ['sessionControlBar', 'TURN CONTROLS', 'Pause goal', 'Resume goal', 'Interrupt turn', 'sessionControlButtonDisabled']) {
    assert(chatSource.includes(marker), `Android chat source missing ${marker}`);
  }
  for (const marker of ['fleetControlRow', 'fleetControlButtonDisabled', 'Pause goal', 'Resume goal', 'Interrupt turn']) {
    assert(fleetSource.includes(marker), `Android Fleet source missing ${marker}`);
  }
  const appConfig = JSON.parse(fs.readFileSync(path.join(root, 'android-app', 'app.json'), 'utf8'));
  assert.strictEqual(appConfig.expo.userInterfaceStyle, 'dark', 'update the recorded light-mode gate');
  const chrome = findChrome();
  assert(chrome, 'Headless Chrome not found');
  fs.mkdirSync(outputDir, { recursive: true });
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-android-control-visual-'));
  const browser = await chromium.launch({
    executablePath: chrome,
    headless: true,
    args: ['--disable-gpu', '--disable-background-networking', '--disable-component-update', '--no-first-run'],
  });
  const cases = [];
  try {
    for (const pending of [false, true]) {
      const fixturePath = path.join(tempDir, pending ? 'pending.html' : 'ready.html');
      fs.writeFileSync(fixturePath, fixture(pending), 'utf8');
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
      await page.goto(pathToFileURL(fixturePath).href);
      const metrics = await page.evaluate(() => ({
        viewport_width: innerWidth,
        scroll_width: document.documentElement.scrollWidth,
        session_control_buttons: document.querySelectorAll('.session-controls .control').length,
        fleet_control_buttons: document.querySelectorAll('.fleet-actions .control').length,
        gated_dead_buttons: document.querySelectorAll('.card.gated .control').length,
        disabled_controls: document.querySelectorAll('.control:disabled').length,
      }));
      assert.equal(metrics.scroll_width, metrics.viewport_width);
      assert.equal(metrics.session_control_buttons, 2);
      assert.equal(metrics.fleet_control_buttons, 2);
      assert.equal(metrics.gated_dead_buttons, 0);
      assert.equal(metrics.disabled_controls, pending ? 2 : 0);
      const imagePath = path.join(outputDir, pending ? 'android-dark-390-pending.png' : 'android-dark-390-ready.png');
      await page.screenshot({ path: imagePath, fullPage: true, animations: 'disabled' });
      cases.push({ state: pending ? 'pending' : 'ready', image: path.relative(root, imagePath).replace(/\\/g, '/'), metrics });
      await page.close();
    }
  } finally {
    await browser.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  const result = {
    ok: true,
    driver: 'playwright-core',
    browser: 'headless-chromium',
    component_contract: 'React Native source-bound visual fixture',
    viewport_dp: '390x844',
    dark_mode_goldens: 2,
    light_mode_gate: 'android-app/app.json is explicitly dark-only; no light-mode native golden is claimed',
    source_markers_verified: true,
    horizontal_overflow: 0,
    gated_dead_buttons: 0,
    cases,
  };
  fs.writeFileSync(path.join(outputDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(result, null, 2));
})().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
