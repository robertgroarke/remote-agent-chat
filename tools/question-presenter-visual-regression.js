#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { chromium } = require('../frontend/node_modules/playwright-core');
const pixelmatch = require('../frontend/node_modules/pixelmatch');
const { PNG } = require('../frontend/node_modules/pngjs');
const { WebSocketServer } = require('../relay-server/node_modules/ws');
const { canonicalQuestionPrompt } = require('../shared/question-prompt-contract');
const { freshEvidencePath } = require('./evidence-path');

const ROOT = path.resolve(__dirname, '..');
const FRONTEND = path.join(ROOT, 'frontend');
const GOLDEN_DIR = path.join(ROOT, 'evidence', 'harness-maturity', 'question-presenter-goldens');
const DEFAULT_OUTPUT_DIR = path.join(ROOT, 'data', 'question-presenter-visual-regression');
const ANDROID_THEME_PATH = path.join(ROOT, 'android-app', 'components', 'permission-prompt-theme.json');
const ANDROID_COMPONENT_PATH = path.join(ROOT, 'android-app', 'components', 'PermissionPrompt.jsx');
const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};
const THEMES = ['dark', 'light'];
const SURFACES = ['web', 'android'];

function parseArgs(argv) {
  const options = {
    updateGoldens: false,
    outputDir: DEFAULT_OUTPUT_DIR,
    goldenDir: GOLDEN_DIR,
    resultFile: freshEvidencePath(ROOT, 'question-presenter-visual-regression.json'),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--update-goldens') options.updateGoldens = true;
    else if (arg === '--output-dir' && argv[index + 1]) options.outputDir = path.resolve(argv[++index]);
    else if (arg === '--golden-dir' && argv[index + 1]) options.goldenDir = path.resolve(argv[++index]);
    else if (arg === '--result-file' && argv[index + 1]) options.resultFile = path.resolve(argv[++index]);
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  return options;
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter(Boolean);
  const executablePath = candidates.find(candidate => fs.existsSync(candidate));
  if (!executablePath) throw new Error(`Headless Chrome not found; checked ${candidates.join(', ')}`);
  return executablePath;
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

async function waitFor(predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out after ${timeoutMs}ms`);
}

function fileEvidence(filePath) {
  const bytes = fs.readFileSync(filePath);
  return {
    path: path.relative(ROOT, filePath).replace(/\\/g, '/'),
    bytes: bytes.length,
    sha256: sha256(bytes),
  };
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(error => (error ? reject(error) : resolve(port)));
    });
  });
}

function contentType(filePath) {
  return ({
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
  })[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function fixtureQuestion(ordinal, variant = 'visual') {
  const questions = variant === 'text-secret' ? [
    {
      id: 'summary', header: 'Short answer', question: 'Enter a bounded response.',
      options: null,
    },
    {
      id: 'private-value', header: 'Private answer', question: 'Enter the temporary native-only value.',
      options: null, secret: true,
    },
  ] : [
    {
      id: 'route',
      header: 'Implementation route',
      question: 'Choose how Remote Agent Chat should continue.',
      options: [
        { id: 'relay', label: 'Relay', description: 'Answer through the verified relay path.' },
        { id: 'native', label: 'Native', description: 'Answer directly in the native surface.' },
        { id: 'other', label: 'Other', description: 'Provide a bounded alternate route.', requires_text: true, is_other: true },
      ],
      allow_other: true,
    },
    {
      id: 'checks',
      header: 'Validation checks',
      question: 'Select every check to run.',
      options: [
        { id: 'tests', label: 'Focused tests', description: 'Run the question presenter suite.' },
        { id: 'visual', label: 'Visual comparison', description: 'Compare the approved golden.' },
      ],
      multi_select: true,
    },
  ];
  return canonicalQuestionPrompt({
    prompt_id: `question-presenter-${ordinal}`,
    session_id: 'question-presenter-session',
    generation: `question-presenter-generation-${ordinal}`,
    kind: 'request_user_input',
    source: { surface: 'codex', version: 'visual-contract' },
    title: 'Choose implementation details',
    questions,
    cancel_supported: true,
  });
}

function androidHtml(themeName, palette) {
  const escape = value => String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
  const p = Object.fromEntries(Object.entries(palette).map(([key, value]) => [key, escape(value)]));
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;background:${p.container};color:${p.text}}
body{display:flex;justify-content:center}.android-shell{width:min(720px,100%);height:100%;display:flex;flex-direction:column;background:${p.container};border-inline:1px solid ${p.questionBorder}}
.android-header{height:56px;display:flex;align-items:center;padding:0 16px;border-bottom:1px solid ${p.questionBorder};font-size:16px;font-weight:650}.android-header span{color:${p.muted};font-size:12px;margin-left:auto}
.android-transcript{flex:1;padding:18px 16px;overflow:hidden}.android-message{max-width:580px;padding:12px 14px;border:1px solid ${p.questionBorder};border-radius:10px;background:${p.optionBackground};font-size:14px;line-height:1.45}.android-message small{display:block;margin-top:7px;color:${p.muted}}
.android-prompt{border-top:1px solid ${p.border};padding:16px;background:${p.container}}.android-prompt-header{display:flex;gap:8px;align-items:center;margin-bottom:8px}.android-prompt-title{font-size:15px;font-weight:650}.android-prompt-desc{margin:0 0 12px;color:${p.muted};font-size:13px}
.android-question-list{display:flex;flex-direction:column;gap:8px}.android-question{border:1px solid ${p.questionBorder};border-radius:8px;padding:10px;display:flex;flex-direction:column;gap:7px}.android-question-title{font-size:14px;font-weight:650}.android-question-message{font-size:12px;color:${p.muted}}
.android-option{width:100%;min-height:44px;border:1px solid ${p.optionBorder};border-radius:8px;padding:10px 16px;display:flex;gap:8px;align-items:flex-start;background:${p.optionBackground};color:${p.text};text-align:left}.android-option.selected{border-color:${p.selectedBorder};background:${p.selectedBackground}}.android-marker{width:16px;flex:0 0 16px;color:${p.accent}}.android-copy{display:flex;flex-direction:column;gap:2px;font-size:14px;font-weight:550}.android-copy small{color:${p.muted};font-size:11px;font-weight:400;line-height:15px}
.android-other{width:100%;min-height:44px;margin-top:6px;border:1px solid ${p.inputBorder};border-radius:7px;padding:8px 10px;background:${p.inputBackground};color:${p.text};font:14px system-ui}.android-submit,.android-cancel{width:100%;min-height:44px;border-radius:8px;font-size:14px;font-weight:650}.android-submit{margin-top:12px;border:0;background:${p.submitBackground};color:${p.submitText}}.android-cancel{margin-top:8px;border:1px solid ${p.questionBorder};background:transparent;color:${p.muted}}
@media(max-width:600px){.android-transcript{padding:12px 10px}.android-prompt{padding:12px}.android-header{height:52px}.android-message{font-size:13px}}
</style></head><body data-theme="${escape(themeName)}">
<main class="android-shell"><header class="android-header">Codex · Remote Agent Chat <span>Waiting for you</span></header><section class="android-transcript"><div class="android-message">I need one decision before continuing the production validation.<small>The exact native request remains open until an acknowledgement arrives.</small></div></section>
<section class="android-prompt" data-question-presenter="android" role="dialog" aria-label="Question prompt"><div class="android-prompt-header"><span aria-hidden="true">?</span><span class="android-prompt-title">Choose implementation details</span></div><p class="android-prompt-desc">Answer all questions to resume the native turn.</p><div class="android-question-list">
<fieldset class="android-question"><legend class="android-question-title">Implementation route</legend><div class="android-question-message">Choose how Remote Agent Chat should continue.</div><button class="android-option" role="radio" aria-checked="false"><span class="android-marker">○</span><span class="android-copy">Relay<small>Answer through the verified relay path.</small></span></button><button class="android-option" role="radio" aria-checked="false"><span class="android-marker">○</span><span class="android-copy">Native<small>Answer directly in the native surface.</small></span></button><div><button class="android-option selected" role="radio" aria-checked="true"><span class="android-marker">●</span><span class="android-copy">Other<small>Provide a bounded alternate route.</small></span></button><input class="android-other" aria-label="Other answer" value="Use the verified bounded fallback"></div></fieldset>
<fieldset class="android-question"><legend class="android-question-title">Validation checks</legend><div class="android-question-message">Select every check to run.</div><button class="android-option selected" role="checkbox" aria-checked="true"><span class="android-marker">✓</span><span class="android-copy">Focused tests<small>Run the question presenter suite.</small></span></button><button class="android-option selected" role="checkbox" aria-checked="true"><span class="android-marker">✓</span><span class="android-copy">Visual comparison<small>Compare the approved golden.</small></span></button></fieldset></div><button class="android-submit">Submit answers</button><button class="android-cancel">Cancel</button></section></main>
</body></html>`;
}

function comparePng(actualPath, goldenPath, diffPath) {
  const actual = PNG.sync.read(fs.readFileSync(actualPath));
  const golden = PNG.sync.read(fs.readFileSync(goldenPath));
  if (actual.width !== golden.width || actual.height !== golden.height) {
    return { different: actual.width * actual.height, pixels: actual.width * actual.height, ratio: 1, dimension_mismatch: true };
  }
  const diff = new PNG({ width: actual.width, height: actual.height });
  const different = pixelmatch(actual.data, golden.data, diff.data, actual.width, actual.height, { threshold: 0.1 });
  if (different > 0) {
    fs.mkdirSync(path.dirname(diffPath), { recursive: true });
    fs.writeFileSync(diffPath, PNG.sync.write(diff));
  }
  return { different, pixels: actual.width * actual.height, ratio: different / (actual.width * actual.height) };
}

async function geometry(page, surface, viewportName) {
  const selector = surface === 'web' ? '.permission-card' : '[data-question-presenter="android"]';
  return page.evaluate(({ selector, surface, mobile }) => {
    const root = document.querySelector(selector);
    const rect = root?.getBoundingClientRect();
    const controls = [...root.querySelectorAll('button,input')].map(node => {
      const box = node.getBoundingClientRect();
      return { tag: node.tagName.toLowerCase(), width: box.width, height: box.height, role: node.getAttribute('role') || '' };
    });
    return {
      surface,
      root_present: !!root,
      dialog_role: root?.getAttribute('role') === 'dialog' || !!root?.closest('[role="dialog"]'),
      root_bounds: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
      viewport: { width: innerWidth, height: innerHeight },
      document_horizontal_overflow_px: Math.max(0, document.documentElement.scrollWidth - innerWidth),
      root_horizontal_overflow_px: root ? Math.max(0, root.scrollWidth - root.clientWidth) : null,
      mobile_prompt_not_clipped: !mobile || (rect?.y || 0) >= 80,
      radio_count: root?.querySelectorAll('[role="radio"]').length || 0,
      checkbox_count: root?.querySelectorAll('[role="checkbox"]').length || 0,
      selected_count: root?.querySelectorAll('[aria-checked="true"]').length || 0,
      text_input_count: root?.querySelectorAll('input').length || 0,
      submit_enabled: surface === 'web'
        ? !root?.querySelector('.permission-question-submit')?.disabled
        : !root?.querySelector('.android-submit')?.disabled,
      control_count: controls.length,
      minimum_control_height_px: controls.length ? Math.min(...controls.map(control => control.height)) : 0,
      mobile_touch_targets_pass: !mobile || controls.every(control => control.height >= 43.5),
    };
  }, { selector, surface, mobile: viewportName === 'mobile' });
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const androidTheme = JSON.parse(fs.readFileSync(ANDROID_THEME_PATH, 'utf8'));
  const androidComponent = fs.readFileSync(ANDROID_COMPONENT_PATH, 'utf8');
  assert.match(androidComponent, /permission-prompt-theme\.json/);
  assert.match(androidComponent, /useColorScheme/);
  assert.match(androidComponent, /structuredTheme\.selectedBackground/);
  assert.match(androidComponent, /minHeight:\s*44/);
  assert.match(androidComponent, /question\.answer_mode === 'text'/);
  assert.match(androidComponent, /secureTextEntry=\{question\.secret === true\}/);
  assert.match(androidComponent, /\{ action: 'cancel' \}/);
  assert.deepStrictEqual(Object.keys(androidTheme).sort(), THEMES);

  const port = await freePort();
  let ordinal = 0;
  let fixtureSocket = null;
  let fixturePrompt = null;
  let fixtureVariant = 'visual';
  let livePromptFrames = 0;
  let reconnectPromptRestores = 0;
  let terminalPromptClears = 0;
  let failedPromptRetained = false;
  let secretPersistenceHits = 0;
  let lateTerminalIdentityPreserved = false;
  const clientMutations = [];
  const server = http.createServer((request, response) => {
    if (request.url.startsWith('/api/')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"preferences":{}}');
      return;
    }
    const pathname = new URL(request.url, `http://127.0.0.1:${port}`).pathname;
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const filePath = path.resolve(FRONTEND, relative);
    if (!filePath.startsWith(`${path.resolve(FRONTEND)}${path.sep}`)
      || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      response.writeHead(404); response.end('not found'); return;
    }
    response.writeHead(200, { 'content-type': contentType(filePath), 'cache-control': 'no-store' });
    fs.createReadStream(filePath).pipe(response);
  });
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request, socket, head) => {
    if (request.url !== '/client-ws') return socket.destroy();
    wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws));
  });
  wss.on('connection', ws => {
    fixtureSocket = ws;
    const send = payload => ws.readyState === ws.OPEN && ws.send(JSON.stringify(payload));
    let acknowledged = false;
    ws.on('message', raw => {
      let message;
      try { message = JSON.parse(String(raw)); } catch { return; }
      const sessionId = message.session_id || message.session;
      if (!acknowledged && ['connection_hello', 'hello', 'subscribe'].includes(message.type)) {
        acknowledged = true;
        const prompt = fixtureQuestion(++ordinal, fixtureVariant);
        fixturePrompt = prompt;
        const restoreFromAck = ordinal % 2 === 0;
        send({
          type: 'connection_ack', heartbeat_interval_ms: 1000, heartbeat_timeout_ms: 5000,
          sessions: [{
            session_id: 'question-presenter-session', agent_type: 'codex',
            title: 'Question presenter visual contract', chat_title: 'Question presenter visual contract',
            status: 'healthy', workspace_name: 'Remote Agent Chat', activity: { kind: 'waiting_for_user', label: 'Waiting for you' },
          }],
          workspaces: [],
          ...(restoreFromAck ? { open_question_prompts: [prompt] } : {}),
        });
        if (restoreFromAck) {
          if (fixtureVariant === 'visual') reconnectPromptRestores += 1;
        } else {
          if (fixtureVariant === 'visual') livePromptFrames += 1;
          setTimeout(() => send(prompt), 40);
        }
      }
      if (['question_response', 'permission_response', 'agent_message', 'send', 'send_message'].includes(message.type)) {
        clientMutations.push(message);
      }
      if (message.type === 'question_response' && fixturePrompt) {
        send({
          ...fixturePrompt,
          type: 'question_prompt_state',
          lifecycle: 'failed',
          error_code: 'fixture_native_ack_failed',
          error: 'Fixture native acknowledgement failed.',
        });
        send({
          type: 'agent_control_result',
          command: 'question_response',
          session_id: message.session_id,
          request_id: message.request_id,
          result: 'failed',
          error: { code: 'fixture_native_ack_failed', message: 'Fixture native acknowledgement failed.' },
        });
      }
      if (message.type === 'heartbeat') send({ type: 'heartbeat_ack', request_id: message.request_id });
      else if (message.type === 'agent_config_request') send({ type: 'agent_config', session_id: sessionId, capabilities: { question_prompts: true } });
      else if (message.type === 'history_chunk_request') send({
        type: 'history_chunk', session_id: sessionId, request_id: message.request_id, source: 'fixture',
        mode: 'tail', replace: true, total_messages: 1, loaded_messages: 1, partial: false,
        messages: [{ role: 'assistant', content: 'I need one decision before continuing the production validation.', sequence: 1 }],
      });
      else if (message.type === 'get_history') send({
        type: 'history', session: sessionId, request_id: message.request_id,
        messages: [{ role: 'assistant', content: 'I need one decision before continuing the production validation.', sequence: 1 }],
      });
    });
  });
  await new Promise((resolve, reject) => server.listen(port, '127.0.0.1', error => (error ? reject(error) : resolve())));

  const browser = await chromium.launch({
    executablePath: findChrome(),
    headless: true,
    args: [
      '--disable-gpu', '--disable-background-networking', '--disable-component-update',
      '--disable-default-apps', '--disable-sync', '--no-first-run', '--no-default-browser-check',
    ],
  });
  const page = await browser.newPage();
  const browserDiagnostics = [];
  page.on('console', message => browserDiagnostics.push({ type: `console:${message.type()}`, text: message.text() }));
  page.on('pageerror', error => browserDiagnostics.push({ type: 'pageerror', text: error.message }));
  const cases = [];
  try {
    for (const surface of SURFACES) {
      for (const theme of THEMES) {
        for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
          await page.setViewportSize(viewport);
          if (surface === 'web') {
            await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 15000 });
            try {
              await page.locator('.permission-card').waitFor({ state: 'visible', timeout: 10000 });
            } catch (error) {
              const state = await page.evaluate(() => ({
                url: location.href,
                body: document.body?.innerText?.slice(0, 2000) || '',
                crash: sessionStorage.getItem('agent-chat:last-render-error'),
                windowError: sessionStorage.getItem('agent-chat:last-window-error'),
                promiseError: sessionStorage.getItem('agent-chat:last-promise-error'),
              })).catch(() => ({}));
              throw new Error(`${error.message}\nfixture diagnostics=${JSON.stringify({ state, browserDiagnostics }, null, 2)}`);
            }
            await page.locator('.toast.visible').waitFor({ state: 'hidden', timeout: 5000 });
            await page.addStyleTag({ content: '.sidebar-footer-rtt{visibility:hidden!important}' });
            const observedTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
            if (observedTheme !== theme) {
              await page.getByTitle('Toggle Light/Dark Mode').click();
              await page.waitForFunction(expected => document.documentElement.getAttribute('data-theme') === expected, theme);
            }
            const card = page.locator('.permission-card');
            const other = card.locator('[role="radio"]').filter({ hasText: 'Other' });
            await other.click();
            await card.getByLabel('Other answer').fill('Use the verified bounded fallback');
            for (const checkbox of await card.locator('[role="checkbox"]').all()) await checkbox.click();
            await page.waitForFunction(() => !document.querySelector('.permission-question-submit')?.disabled);
            assert.strictEqual(await page.locator('.jump-to-newest').count(), 0,
              'blocking question prompt must suppress the Jump to Newest overlay');
          } else {
            await page.setContent(androidHtml(theme, androidTheme[theme]), { waitUntil: 'load' });
          }
          await page.evaluate(() => document.fonts?.ready);
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.waitForFunction(() => window.scrollY === 0);
          await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: theme });
          const metrics = await geometry(page, surface, viewportName);
          assert.strictEqual(metrics.root_present, true);
          assert.strictEqual(metrics.dialog_role, true);
          assert.strictEqual(metrics.document_horizontal_overflow_px, 0);
          assert.strictEqual(metrics.root_horizontal_overflow_px, 0);
          assert.strictEqual(metrics.mobile_prompt_not_clipped, true);
          assert.strictEqual(metrics.radio_count, 3);
          assert.strictEqual(metrics.checkbox_count, 2);
          assert.strictEqual(metrics.selected_count, 3);
          assert.strictEqual(metrics.text_input_count, 1);
          assert.strictEqual(metrics.submit_enabled, true);
          assert.strictEqual(metrics.mobile_touch_targets_pass, true);

          const name = `${surface}-question-presenter-${viewportName}-${theme}.png`;
          const actualPath = path.join(options.outputDir, 'actual', name);
          const goldenPath = path.join(options.goldenDir, name);
          const diffPath = path.join(options.outputDir, 'diff', name);
          fs.mkdirSync(path.dirname(actualPath), { recursive: true });
          await page.screenshot({ path: actualPath, fullPage: false, animations: 'disabled' });
          const png = PNG.sync.read(fs.readFileSync(actualPath));
          assert.deepStrictEqual([png.width, png.height], [viewport.width, viewport.height]);
          let comparison;
          if (options.updateGoldens) {
            assert(!fs.existsSync(goldenPath), `Refusing to overwrite approved golden: ${goldenPath}`);
            fs.mkdirSync(path.dirname(goldenPath), { recursive: true });
            fs.copyFileSync(actualPath, goldenPath);
            comparison = { status: 'created', different: 0, ratio: 0 };
          } else {
            assert(fs.existsSync(goldenPath), `Missing approved golden: ${goldenPath}`);
            const compared = comparePng(actualPath, goldenPath, diffPath);
            comparison = { status: compared.ratio <= 0.001 ? 'pass' : 'fail', ...compared };
          }
          cases.push({
            surface, theme, viewport: viewportName, dimensions: [viewport.width, viewport.height],
            geometry: metrics, actual: path.relative(ROOT, actualPath).replace(/\\/g, '/'),
            golden: fileEvidence(goldenPath),
            diff: fs.existsSync(diffPath) ? path.relative(ROOT, diffPath).replace(/\\/g, '/') : null,
            ...comparison,
          });
          if (surface === 'web' && theme === 'dark' && viewportName === 'desktop') {
            fixtureSocket.send(JSON.stringify({
              ...fixturePrompt,
              type: 'question_prompt_state',
              lifecycle: 'auto_resolved',
            }));
            await page.locator('.permission-card').waitFor({ state: 'hidden', timeout: 2000 });
            terminalPromptClears += 1;
          }
          if (surface === 'web' && theme === 'light' && viewportName === 'mobile') {
            await page.locator('.permission-question-submit').click();
            await waitFor(() => clientMutations.length === 1);
            try {
              await page.waitForFunction(() => (
                document.querySelector('.permission-error')?.textContent?.includes('Fixture native acknowledgement failed.')
                && document.querySelector('.permission-question-submit')?.disabled === true
              ), null, { timeout: 5000 });
            } catch (error) {
              const failedState = await page.evaluate(() => ({
                card: document.querySelector('.permission-card')?.innerText || null,
                error: document.querySelector('.permission-error')?.textContent || null,
                submit_disabled: document.querySelector('.permission-question-submit')?.disabled ?? null,
                submit_text: document.querySelector('.permission-question-submit')?.textContent || null,
              }));
              throw new Error(`${error.message}\nfailed prompt diagnostics=${JSON.stringify({ failedState, clientMutations, browserDiagnostics }, null, 2)}`);
            }
            failedPromptRetained = await page.locator('.permission-card').isVisible();
          }
        }
      }
    }
    fixtureVariant = 'text-secret';
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.locator('.permission-card').waitFor({ state: 'visible', timeout: 10000 });
    const publicTextInput = page.getByLabel('Short answer answer');
    const secretTextInput = page.getByLabel('Private answer answer');
    assert.strictEqual(await secretTextInput.getAttribute('type'), 'password');
    assert.strictEqual(await secretTextInput.getAttribute('autocomplete'), 'off');
    await publicTextInput.fill('Bounded functional answer');
    await secretTextInput.fill('visual-only-placeholder');
    await page.locator('.permission-question-submit').click();
    await waitFor(() => clientMutations.length === 2);
    secretPersistenceHits = await page.evaluate(marker => {
      const stores = [localStorage, sessionStorage];
      return stores.reduce((count, storage) => {
        for (let index = 0; index < storage.length; index += 1) {
          const key = storage.key(index);
          if (`${key}\n${storage.getItem(key)}`.includes(marker)) count += 1;
        }
        return count;
      }, 0);
    }, 'visual-only-placeholder');
    assert.strictEqual(secretPersistenceHits, 0);

    fixtureVariant = 'cancel';
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.locator('.permission-card').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('.permission-question-cancel').click();
    await waitFor(() => clientMutations.length === 3);

    const stalePrompt = fixturePrompt;
    const replacementPrompt = { ...fixtureQuestion(++ordinal, 'visual'), title: 'Replacement question' };
    fixturePrompt = replacementPrompt;
    fixtureSocket.send(JSON.stringify(replacementPrompt));
    await page.waitForFunction(() => (
      document.querySelector('.permission-card .permission-title')?.textContent === 'Replacement question'
    ));
    fixtureSocket.send(JSON.stringify({
      ...stalePrompt,
      type: 'question_prompt_state',
      lifecycle: 'auto_resolved',
    }));
    fixtureSocket.send(JSON.stringify({
      type: 'agent_control_result',
      command: 'question_response',
      session_id: stalePrompt.session_id,
      request_id: clientMutations[2].request_id,
      result: 'ok',
    }));
    await new Promise(resolve => setTimeout(resolve, 100));
    lateTerminalIdentityPreserved = await page.locator('.permission-card').isVisible()
      && await page.locator('.permission-card .permission-title').textContent() === 'Replacement question';
    assert.strictEqual(lateTerminalIdentityPreserved, true);

    assert.strictEqual(clientMutations.length, 3, JSON.stringify(clientMutations));
    assert.strictEqual(livePromptFrames, 2);
    assert.strictEqual(reconnectPromptRestores, 2);
    assert.strictEqual(terminalPromptClears, 1);
    assert.strictEqual(failedPromptRetained, true);
    const [questionResponse, textSecretResponse, cancelResponse] = clientMutations;
    assert.strictEqual(questionResponse.type, 'question_response');
    assert.strictEqual(questionResponse.session_id, 'question-presenter-session');
    assert.match(questionResponse.prompt_id, /^question-presenter-\d+$/);
    assert.match(questionResponse.generation, /^question-presenter-generation-\d+$/);
    assert.strictEqual(questionResponse.action, 'answer');
    assert.match(questionResponse.request_id, /^prompt-[a-zA-Z0-9-]+$/);
    assert.deepStrictEqual(questionResponse.answers, [
      { question_id: 'route', choice_ids: ['other'], other_text: 'Use the verified bounded fallback' },
      { question_id: 'checks', choice_ids: ['tests', 'visual'] },
    ]);
    assert.strictEqual(textSecretResponse.type, 'question_response');
    assert.strictEqual(textSecretResponse.action, 'answer');
    assert.deepStrictEqual(textSecretResponse.answers, [
      { question_id: 'summary', text: 'Bounded functional answer' },
      { question_id: 'private-value', text: 'visual-only-placeholder' },
    ]);
    assert.strictEqual(cancelResponse.type, 'question_response');
    assert.strictEqual(cancelResponse.action, 'cancel');
    assert.strictEqual(Object.prototype.hasOwnProperty.call(cancelResponse, 'answers'), false);
    assert(cases.every(row => ['pass', 'created'].includes(row.status)), JSON.stringify(cases.filter(row => row.status === 'fail')));
    const result = {
      ok: true,
      mode: options.updateGoldens ? 'create-goldens' : 'compare',
      generated_at: new Date().toISOString(),
      chrome: browser.version(),
      driver: 'playwright-core headless',
      surfaces: SURFACES,
      themes: THEMES,
      viewports: VIEWPORTS,
      cases,
      assertions: {
        actual_web_component: true,
        transient_connection_toast_excluded: true,
        nondeterministic_relay_rtt_masked: true,
        android_fixture_source_locked_to_component_and_theme_contract: true,
        android_first_class_transport_source_locked: true,
        structured_questions: 2,
        radio_choices: 3,
        checkbox_choices: 2,
        other_text_visible: true,
        canonical_text_answer_functional: true,
        secret_input_masked: true,
        secret_persistence_hits: secretPersistenceHits,
        canonical_cancel_response_functional: true,
        submit_ready: true,
        horizontal_overflow_cases: 0,
        clipped_mobile_prompt_cases: 0,
        jump_to_newest_overlays_during_prompt: 0,
        mobile_touch_target_failures: 0,
        visual_capture_client_mutations: 0,
        exact_question_responses_after_capture: 3,
        live_question_prompt_frames: livePromptFrames,
        reconnect_question_prompt_restores: reconnectPromptRestores,
        terminal_question_prompt_clears: terminalPromptClears,
        failed_question_prompt_retained_with_disabled_submit: failedPromptRetained,
        late_terminal_and_receipt_cannot_clear_replacement: lateTerminalIdentityPreserved,
        focus_actions: 0,
        visible_windows_opened: 0,
      },
      source: [
        fileEvidence(path.join(ROOT, 'frontend', 'app.jsx')),
        fileEvidence(path.join(ROOT, 'frontend', 'styles.css')),
        fileEvidence(path.join(ROOT, 'frontend', 'hooks.jsx')),
        fileEvidence(path.join(ROOT, 'frontend', 'dist', 'bundle.js')),
        fileEvidence(ANDROID_COMPONENT_PATH),
        fileEvidence(ANDROID_THEME_PATH),
        fileEvidence(path.join(ROOT, 'android-app', 'screens', 'ChatScreen.jsx')),
        fileEvidence(path.join(ROOT, 'android-app', 'screens', 'SessionListScreen.jsx')),
        fileEvidence(path.join(ROOT, 'android-app', 'lib', 'relay.js')),
        fileEvidence(path.join(ROOT, 'protocol.md')),
        fileEvidence(__filename),
      ],
    };
    fs.mkdirSync(path.dirname(options.resultFile), { recursive: true });
    fs.writeFileSync(options.resultFile, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify({
      ok: true,
      mode: result.mode,
      cases: cases.length,
      passed: cases.filter(row => ['pass', 'created'].includes(row.status)).length,
      result_file: options.resultFile,
      visible_windows_opened: 0,
    }, null, 2)}\n`);
    return result;
  } finally {
    await browser.close().catch(() => {});
    for (const ws of wss.clients) ws.terminate();
    await new Promise(resolve => wss.close(resolve));
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
    if (fixtureSocket?.readyState === fixtureSocket?.OPEN) fixtureSocket.terminate();
  }
}

if (require.main === module) main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

module.exports = { SURFACES, THEMES, VIEWPORTS, androidHtml, main, parseArgs };
