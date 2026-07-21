#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require(process.env.RAC_PLAYWRIGHT_CORE || '../frontend/node_modules/playwright-core');
const { DETECTION_CLASSES, auditPage } = require('./operator-dogfood-audit');
const { analyzeTemporalTrace } = require('./chat-stability-temporal-contract');
const { freshEvidenceDirectory } = require('./evidence-path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUTPUT_DIR = freshEvidenceDirectory(ROOT, 'operator-dogfood');

function parseArgs(argv) {
  let outputDir = DEFAULT_OUTPUT_DIR;
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--output-dir' && argv[index + 1]) outputDir = path.resolve(argv[++index]);
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  return { outputDir };
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter(Boolean);
  const selected = candidates.find(candidate => fs.existsSync(candidate));
  if (!selected) throw new Error(`Headless Chrome not found; checked ${candidates.join(', ')}`);
  return selected;
}

function seededHtml(staleIso) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 24px; font: 16px/1.4 system-ui, sans-serif; background: #10151d; color: #eef3f8; }
    section, article { margin: 0 0 12px; padding: 10px; border: 1px solid #405065; border-radius: 8px; }
    .seed-overflow { width: calc(100vw + 96px); background: #263447; }
    [role="dialog"] { position: fixed; left: calc(100vw - 24px); top: 40px; width: 240px; padding: 12px; background: #401f2b; z-index: 20; }
    [data-audit-preserve-scroll] { width: 360px; height: 72px; overflow: auto; border: 1px solid #6e8199; }
    [data-audit-preserve-scroll] > div { height: 280px; padding: 8px; }
    [data-stable-key] { padding: 6px; border-bottom: 1px solid #52647a; }
  </style>
</head>
<body>
  <main>
    <h1>Disposable operator discovery seed pack</h1>
    <div role="dialog" aria-modal="true">Clipped permission portal</div>
    <div class="seed-overflow">This row forces horizontal overflow.</div>
    <p>Usage â€™ ready after refresh.</p>
    <section data-agent-type="codex"><span data-role="harness-label">Claude Code</span></section>
    <article data-session-status="working" data-updated-at="${staleIso}">Working</article>
    <section data-capabilities="model,effort,permission">
      <button data-capability="model">Model</button>
    </section>
    <section data-chat-title="Fix Unicode title handling" data-workspace-name="Remote Agent Chat">
      <h2 data-primary-title>Remote Agent Chat</h2>
    </section>
    <article data-audit-message="missing-time">
      <div data-message-content>Assistant response without time context.</div>
    </article>
    <article data-audit-message="missing-body"><time>13:30</time></article>
    <section data-terminal-state="working">Session completed</section>
    <section data-source-count="4"><div data-empty-state>No usage data available.</div></section>
    <div data-audit-stable-list data-audit-key="session-order">
      <div data-stable-key="alpha">Alpha</div>
      <div data-stable-key="beta">Beta</div>
      <div data-stable-key="gamma">Gamma</div>
    </div>
    <div data-audit-preserve-scroll data-audit-key="transcript-scroll"><div>Long transcript body</div></div>
    <label>Draft <input name="draft" value="preserve me"></label>
    <button data-refresh-focus-target>Refresh target</button>
  </main>
  <script>
    const scroller = document.querySelector('[data-audit-preserve-scroll]');
    scroller.scrollTop = 120;
    document.querySelector('input[name="draft"]').focus();
    window.__operatorDogfoodAuditRefresh = async () => {
      const list = document.querySelector('[data-audit-stable-list]');
      list.insertBefore(list.children[1], list.children[0]);
      scroller.scrollTop = 0;
      document.querySelector('[data-refresh-focus-target]').focus();
    };
  </script>
</body>
</html>`;
}

function cleanHtml() {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body><main><h1>Restored clean disposable fixture</h1><p>No seeded defects remain.</p></main>
<script>delete window.__operatorDogfoodAuditRefresh;</script></body>
</html>`;
}

async function main(argv = process.argv.slice(2)) {
  const { outputDir } = parseArgs(argv);
  const resultPath = path.join(outputDir, 'seeded-defect-pack.json');
  const screenshotPath = path.join(outputDir, 'seeded-defect-pack.png');
  const startedAt = new Date();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-agent-operator-dogfood-seeds-'));
  const seedPath = path.join(tempRoot, 'seed-pack.html');
  const consoleErrors = [];
  const failedRequests = [];
  let browser;
  try {
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(seedPath, seededHtml(new Date(Date.now() - 10 * 60 * 1000).toISOString()), 'utf8');
    browser = await chromium.launch({
      executablePath: findChrome(),
      headless: true,
      args: ['--disable-gpu', '--hide-scrollbars'],
    });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark' });
    const page = await context.newPage();
    page.on('console', message => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', error => consoleErrors.push(error.message));
    page.on('requestfailed', request => failedRequests.push({ url: request.url(), failure: request.failure()?.errorText || null }));
    await page.goto(pathToFileURL(seedPath).href, { waitUntil: 'load' });

    const seeded = await auditPage(page, { staleStatusMs: 120000 });
    await page.screenshot({ path: screenshotPath, fullPage: true, animations: 'disabled' });
    const temporal = analyzeTemporalTrace({
      samples: [
        { at_ms: 0, refresh_sequence: 0, session_id: 'seed-session', canonical_conversation_id: 'codex:seed-thread',
          scroll_top: 800, anchor_key: 'seed-anchor', anchor_offset_px: 0, prompt_count: 0,
          canonical_card_count: 1, lifecycle: 'paused', user_scroll_epoch: 0 },
        { at_ms: 400, refresh_sequence: 1, session_id: 'seed-session', canonical_conversation_id: 'codex:seed-thread',
          scroll_top: 0, anchor_key: 'seed-anchor', anchor_offset_px: -800, phase: 'programmatic_scroll_write',
          writer: 'prompt_transition', prompt_id: 'false-seed', prompt_generation: 1,
          prompt_source: 'inferred_goal_state', prompt_count: 1, canonical_card_count: 2,
          lifecycle: 'waiting_for_user', user_scroll_epoch: 0,
          canonical_rows: [
            { surface: 'codex-desktop', canonical_conversation_id: 'codex:seed-thread', owner_verified: true },
            { surface: 'codex_cli', canonical_conversation_id: 'codex:seed-thread', owner_verified: false },
          ] },
        { at_ms: 900, refresh_sequence: 2, session_id: 'seed-session', canonical_conversation_id: 'codex:seed-thread',
          scroll_top: 800, anchor_key: 'seed-anchor', anchor_offset_px: 0, phase: 'programmatic_scroll_write',
          writer: 'live_edge_anchor', prompt_count: 0, canonical_card_count: 1,
          lifecycle: 'paused', user_scroll_epoch: 0 },
      ],
      truth: { native_prompts: [], session_id: 'seed-session', canonical_conversation_id: 'codex:seed-thread' },
    });
    const detected = [...new Set([...seeded.detected_classes, ...temporal.detected_classes])].sort();
    const expected = [...DETECTION_CLASSES].sort();
    assert.deepStrictEqual(detected, expected, `seed detection mismatch: ${JSON.stringify({ expected, detected })}`);

    await page.setContent(cleanHtml(), { waitUntil: 'load' });
    const restored = await auditPage(page, { staleStatusMs: 120000 });
    const restoredTemporal = analyzeTemporalTrace({
      samples: Array.from({ length: 20 }, (_, index) => ({
        at_ms: index * 100, refresh_sequence: index, session_id: 'seed-session',
        canonical_conversation_id: 'codex:seed-thread', scroll_top: 800,
        anchor_key: 'seed-anchor', anchor_offset_px: 0, prompt_count: 0,
        canonical_card_count: 1, lifecycle: 'paused', user_scroll_epoch: 0,
      })),
      truth: { native_prompts: [] },
    });
    assert.strictEqual(restored.ok && restoredTemporal.ok, true,
      `restored fixture must be clean: ${JSON.stringify([...restored.findings, ...restoredTemporal.findings])}`);
    assert.strictEqual(restored.findings.length, 0, 'restored fixture must have zero findings');
    assert.deepStrictEqual(consoleErrors, [], 'seed audit must not produce console/page errors');
    assert.deepStrictEqual(failedRequests, [], 'seed audit must not produce failed requests');

    const screenshotBytes = fs.readFileSync(screenshotPath);
    const result = {
      schema_version: 1,
      run_id: `operator-dogfood-seeds-${startedAt.toISOString().replace(/[:.]/g, '-')}`,
      started_at: startedAt.toISOString(),
      completed_at: new Date().toISOString(),
      result: 'PASS',
      expected_classes: expected,
      detected_classes: detected,
      score: { detected: detected.length, expected: expected.length, percent: 100 },
      findings: [...seeded.findings, ...temporal.findings],
      generic_assertion_contract: 'Detection is keyed by semantic DOM/state evidence, never a component ID.',
      clean_control: {
        result: 'PASS',
        findings: restored.findings.length,
        fixture_restored: true,
      },
      evidence: {
        screenshot: path.relative(ROOT, screenshotPath).replace(/\\/g, '/'),
        screenshot_sha256: sha256(screenshotBytes),
        audit_engine_sha256: sha256(fs.readFileSync(path.join(__dirname, 'operator-dogfood-audit.js'))),
        seed_runner_sha256: sha256(fs.readFileSync(__filename)),
      },
      telemetry: {
        console_errors: consoleErrors,
        failed_requests: failedRequests,
      },
      safety: {
        headless: true,
        disposable_file_fixture: true,
        fixture_removed_after_run: true,
        production_pages: 0,
        production_mutations: 0,
        protected_session_mutations: 0,
        visible_windows: 0,
        focus_actions: 0,
      },
    };
    fs.writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    process.stdout.write(`PASS operator dogfood seeded discovery (${detected.length}/${expected.length}); clean control restored\n`);
    process.stdout.write(`${path.relative(ROOT, resultPath).replace(/\\/g, '/')}\n`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    const safePrefix = path.join(os.tmpdir(), 'remote-agent-operator-dogfood-seeds-').toLowerCase();
    if (tempRoot.toLowerCase().startsWith(safePrefix)) fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});

module.exports = { cleanHtml, parseArgs, seededHtml };
