#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require(process.env.RAC_WS_MODULE || '../relay-server/node_modules/ws');
const { chromium } = require(process.env.RAC_PLAYWRIGHT_CORE || '../frontend/node_modules/playwright-core');

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter(Boolean);
  const match = candidates.find(candidate => fs.existsSync(candidate));
  if (!match) throw new Error(`Headless Chrome not found; checked ${candidates.join(', ')}`);
  return match;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function requestJson(port, pathname) {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: '127.0.0.1', port, path: pathname }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        try { resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
        catch { resolve({ status: response.statusCode, body: null }); }
      });
    });
    request.once('error', reject);
  });
}

async function waitForHealth(port, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await requestJson(port, '/healthz');
      if (response.status === 200 && response.body?.status === 'ok') return;
    } catch { /* startup retry */ }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('isolated relay did not become healthy');
}

function connectProxy(port, secret) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/proxy-ws`);
    ws.once('open', () => ws.send(JSON.stringify({
      type: 'connection_hello', protocol_version: 1, peer_role: 'proxy',
      proxy_id: 'fleet-view-e2e', machine_label: 'fleet-view-e2e', secret,
    })));
    ws.on('message', data => {
      const message = JSON.parse(data.toString());
      if (message.type === 'connection_ack') resolve(ws);
    });
    ws.once('error', reject);
  });
}

async function closeSocket(ws) {
  if (!ws || ws.readyState === WebSocket.CLOSED) return;
  await new Promise(resolve => {
    ws.once('close', resolve);
    ws.close();
    setTimeout(resolve, 500).unref();
  });
}

async function captureFleetVisualMatrix(browser, origin, screenshotDir, refreshLiveFixtures) {
  const cases = [
    { name: 'desktop-dark-100pct', theme: 'dark', css: [1440, 900], target: [1440, 900], scale: 1, touch: false },
    { name: 'desktop-light-100pct', theme: 'light', css: [1440, 900], target: [1440, 900], scale: 1, touch: false },
    { name: 'mobile-dark-100pct', theme: 'dark', css: [390, 844], target: [390, 844], scale: 1, touch: true },
    { name: 'mobile-light-100pct', theme: 'light', css: [390, 844], target: [390, 844], scale: 1, touch: true },
    { name: 'desktop-dark-125pct', theme: 'dark', css: [1152, 720], target: [1440, 900], scale: 1.25, touch: false },
    { name: 'desktop-light-200pct', theme: 'light', css: [720, 450], target: [1440, 900], scale: 2, touch: false },
  ];
  if (screenshotDir) fs.mkdirSync(screenshotDir, { recursive: true });
  const rows = [];
  for (const visualCase of cases) {
    await refreshLiveFixtures?.();
    const context = await browser.newContext({
      viewport: { width: visualCase.css[0], height: visualCase.css[1] },
      deviceScaleFactor: visualCase.scale,
      hasTouch: visualCase.touch,
    });
    try {
      await context.addInitScript(theme => {
        localStorage.setItem('remote-agent-chat-theme', theme);
        window.__fleetLayoutShift = 0;
        new PerformanceObserver(list => {
          for (const entry of list.getEntries()) {
            if (!entry.hadRecentInput) window.__fleetLayoutShift += entry.value;
          }
        }).observe({ type: 'layout-shift', buffered: true });
      }, visualCase.theme);
      const page = await context.newPage();
      await page.goto(origin, { waitUntil: 'networkidle' });
      if (visualCase.css[0] <= 600) {
        await page.locator('.hamburger').click();
        await page.locator('.sidebar.open').waitFor();
      }
      await page.getByRole('button', { name: 'Fleet view' }).click();
      await page.getByRole('heading', { name: 'Fleet view' }).waitFor();
      await page.evaluate(() => { window.__fleetLayoutShift = 0; });
      await page.waitForTimeout(350);
      const metrics = await page.evaluate(() => {
        const rectsOverlap = (left, right) => (
          Math.min(left.right, right.right) - Math.max(left.left, right.left) > 0.5
          && Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top) > 0.5
        );
        const summaryRects = [...document.querySelectorAll('.fleet-summary > div')].map(node => node.getBoundingClientRect());
        const cardRects = [...document.querySelectorAll('.fleet-card')].map(node => node.getBoundingClientRect());
        const contextHeights = [...document.querySelectorAll('.fleet-work-context')]
          .map(node => Number(node.getBoundingClientRect().height.toFixed(2)));
        const text = document.body.innerText || '';
        return {
          cards: cardRects.length,
          summary_cells: summaryRects.length,
          summary_clip_count: [...document.querySelectorAll('.fleet-summary > div')]
            .filter(node => node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1).length,
          horizontal_overflow_px: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
          card_overflow_count: cardRects.filter(rect => rect.left < -1 || rect.right > document.documentElement.clientWidth + 1).length,
          summary_overlap_count: summaryRects.reduce((count, rect, index) => (
            count + summaryRects.slice(index + 1).filter(other => rectsOverlap(rect, other)).length
          ), 0),
          context_height_min: Math.min(...contextHeights),
          context_height_max: Math.max(...contextHeights),
          corrupt_display_text: /[\u00e2\u00c2\u00c3\ufffd]/.test(text),
          false_empty_goal_copy: text.includes('No active goal reported'),
          non_codex_goal_elements: document.querySelectorAll('.fleet-card[data-session-id="fleet-goal"] .fleet-work-context.kind-goal').length,
          explicit_goal_40: document.querySelectorAll('[aria-label="Goal 40% complete"]').length,
          indeterminate_goal: document.querySelectorAll('[aria-label="Goal working on goal"].fleet-work-meter.indeterminate').length,
          layout_shift: Number((window.__fleetLayoutShift || 0).toFixed(6)),
          theme: document.documentElement.dataset.theme,
        };
      });
      assert.strictEqual(metrics.cards, 9, `${visualCase.name} lost default Fleet cards`);
      assert.strictEqual(metrics.summary_cells, 5, `${visualCase.name} lost a Fleet summary fact`);
      assert.strictEqual(metrics.summary_clip_count, 0, `${visualCase.name} clipped Fleet summary text`);
      assert.strictEqual(metrics.horizontal_overflow_px, 0, `${visualCase.name} overflowed horizontally`);
      assert.strictEqual(metrics.card_overflow_count, 0, `${visualCase.name} clipped a Fleet card`);
      assert.strictEqual(metrics.summary_overlap_count, 0, `${visualCase.name} overlapped Fleet summary cells`);
      assert(metrics.context_height_max - metrics.context_height_min <= 1,
        `${visualCase.name} work-context blocks changed height: ${metrics.context_height_min}-${metrics.context_height_max}`);
      assert.strictEqual(metrics.corrupt_display_text, false, `${visualCase.name} rendered corrupt display text`);
      assert.strictEqual(metrics.false_empty_goal_copy, false, `${visualCase.name} rendered false empty-goal copy`);
      assert.strictEqual(metrics.non_codex_goal_elements, 0, `${visualCase.name} rendered a non-Codex goal`);
      assert.strictEqual(metrics.explicit_goal_40, 1, `${visualCase.name} lost explicit goal progress`);
      assert.strictEqual(metrics.indeterminate_goal, 1, `${visualCase.name} lost an indeterminate native goal`);
      assert.strictEqual(metrics.layout_shift, 0, `${visualCase.name} shifted after the Fleet view settled`);
      assert.strictEqual(metrics.theme, visualCase.theme, `${visualCase.name} used the wrong theme`);
      const screenshot = screenshotDir ? path.join(screenshotDir, `${visualCase.name}.png`) : null;
      if (screenshot) await page.screenshot({ path: screenshot, fullPage: true });
      rows.push({
        ...visualCase,
        metrics,
        screenshot,
      });
    } finally {
      await context.close();
    }
  }
  return rows;
}

async function main() {
  const port = await freePort();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-fleet-view-'));
  const secret = 'fleet-view-e2e-proxy-secret';
  const output = [];
  const child = spawn(process.execPath, ['index.js'], {
    cwd: path.join(__dirname, '..', 'relay-server'),
    env: {
      ...process.env,
      PORT: String(port),
      PUBLIC_URL: `http://127.0.0.1:${port}`,
      SESSION_SECRET: 'fleet-view-e2e-session-secret-at-least-32-chars',
      GOOGLE_CLIENT_ID: 'fleet-view-e2e-client-id',
      GOOGLE_CLIENT_SECRET: 'fleet-view-e2e-client-secret',
      PROXY_SECRET: secret,
      RAC_DATA_DIR: tempRoot,
      ALLOW_LAN_BYPASS: 'true',
      ALLOW_LOOPBACK_BYPASS: 'true',
      FIREBASE_SERVICE_ACCOUNT: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout.on('data', chunk => output.push(chunk.toString()));
  child.stderr.on('data', chunk => output.push(chunk.toString()));

  let proxy;
  let browser;
  try {
    await waitForHealth(port);
    proxy = await connectProxy(port, secret);
    const sessions = [
      { session_id: 'fleet-working', agent_type: 'codex_cli', chat_title: 'Build lane', display_name: 'Build lane', workspace_name: 'Remote Agent Chat', last_snippet: 'Applying the verified dashboard patch.' },
      { session_id: 'fleet-goal', agent_type: 'claude_cli', chat_title: 'Validation lane', display_name: 'Validation lane', workspace_name: 'Remote Agent Chat', last_snippet: 'Running the mobile parity audit.' },
      { session_id: 'fleet-attention', agent_type: 'cursor', chat_title: 'Review lane', display_name: 'Review lane', workspace_name: 'Remote Agent Chat', last_snippet: 'Waiting for approval on the generated diff.' },
      { session_id: 'fleet-paused', agent_type: 'codex_cli', chat_title: 'Paused lane', display_name: 'Paused lane', workspace_name: 'Remote Agent Chat', last_snippet: 'Goal paused by the operator.' },
      { session_id: 'fleet-idle', agent_type: 'codex-desktop', chat_title: 'Idle lane', display_name: 'Idle lane', workspace_name: 'Remote Agent Chat', last_snippet: 'Finished earlier work.' },
      { session_id: 'fleet-readonly', agent_type: 'codex_cli', chat_title: 'Read-only lane', display_name: 'Read-only lane', workspace_name: 'Remote Agent Chat', last_snippet: 'Choose a thread before sending.', is_list_view: true },
      { session_id: 'fleet-goal-two', agent_type: 'codex-desktop', chat_title: 'Release lane', display_name: 'Release lane', workspace_name: 'Remote Agent Chat', last_snippet: 'Preparing exact release evidence.' },
      { session_id: 'fleet-cursor-work', agent_type: 'cursor', chat_title: 'Cursor lane', display_name: 'Cursor lane', workspace_name: 'Remote Agent Chat', last_snippet: 'Reviewing the active diff.' },
      { session_id: 'fleet-antigravity-work', agent_type: 'antigravity_panel', chat_title: 'Antigravity lane', display_name: 'Antigravity lane', workspace_name: 'Remote Agent Chat', last_snippet: 'Drafting the current response.' },
      { session_id: 'fleet-attention-two', agent_type: 'continue', chat_title: 'Blocked lane', display_name: 'Blocked lane', workspace_name: 'Remote Agent Chat', last_snippet: 'Waiting for an operator choice.' },
      { session_id: 'fleet-idle-claude', agent_type: 'claude', chat_title: 'Claude idle', display_name: 'Claude idle', workspace_name: 'Remote Agent Chat', last_snippet: 'No current work.' },
      { session_id: 'fleet-idle-cursor', agent_type: 'cursor_cli', chat_title: 'Cursor CLI idle', display_name: 'Cursor CLI idle', workspace_name: 'Remote Agent Chat', last_snippet: 'No current work.' },
      { session_id: 'fleet-idle-gemini', agent_type: 'gemini', chat_title: 'Gemini idle', display_name: 'Gemini idle', workspace_name: 'Remote Agent Chat', last_snippet: 'No current work.' },
      { session_id: 'fleet-idle-continue', agent_type: 'continue_yolo', chat_title: 'Continue idle', display_name: 'Continue idle', workspace_name: 'Remote Agent Chat', last_snippet: 'No current work.' },
      { session_id: 'fleet-idle-roo', agent_type: 'roo_code', chat_title: 'Roo idle', display_name: 'Roo idle', workspace_name: 'Remote Agent Chat', last_snippet: 'No current work.' },
      { session_id: 'fleet-idle-cline', agent_type: 'cline', chat_title: 'Cline idle', display_name: 'Cline idle', workspace_name: 'Remote Agent Chat', last_snippet: 'No current work.' },
    ];
    const broadcastProxyMessages = [];
    proxy.on('message', data => {
      const message = JSON.parse(data.toString());
      if (message.type !== 'send') return;
      broadcastProxyMessages.push(message);
      proxy.send(JSON.stringify({
        type: 'proxy_send_result', protocol_version: 1, session_id: message.session,
        client_message_id: message.client_message_id, result: 'delivered',
      }));
      setTimeout(() => proxy.send(JSON.stringify({
        type: 'status', protocol_version: 1, session: message.session, thinking: true,
        activity: { kind: 'working', label: 'Broadcast prompt received', started_at: new Date().toISOString() },
      })), 25);
    });
    proxy.send(JSON.stringify({ type: 'session_list', proxy_id: 'fleet-view-e2e', sessions }));
    const now = Date.now();
    proxy.send(JSON.stringify({
      type: 'status', session: 'fleet-working', thinking: true,
      activity_trace: { proxy_emitted_at_ms: Date.now() },
      activity: {
        kind: 'applying_patch', label: 'Applying patch', started_at: new Date(now - 65_000).toISOString(),
        goal: { status: 'active', objective: 'Ship fleet dashboard', time_used_seconds: 125, updated_at: new Date(now).toISOString() },
        task_list: { tasks: [
          { state: 'completed', text: 'Model fleet state' }, { state: 'completed', text: 'Build web cards' },
          { state: 'in_progress', text: 'Verify mobile' }, { state: 'pending', text: 'Deploy' },
        ] },
      },
    }));
    proxy.send(JSON.stringify({
      type: 'status', session: 'fleet-goal', thinking: true,
      activity_trace: { proxy_emitted_at_ms: Date.now() },
      activity: {
        kind: 'thinking', label: 'Running parity audit', started_at: new Date(now - 35_000).toISOString(),
        goal: { status: 'active', objective: 'Validate every client', progress_percent: 72, time_used_seconds: 35, updated_at: new Date(now).toISOString() },
        current: { kind: 'response', label: 'Running the mobile parity audit', since: new Date(now).toISOString() },
      },
    }));
    proxy.send(JSON.stringify({
      type: 'status', session: 'fleet-attention', thinking: false,
      activity_trace: { proxy_emitted_at_ms: Date.now() },
      activity: { kind: 'waiting_for_user', label: 'Waiting for approval' },
    }));
    proxy.send(JSON.stringify({
      type: 'permission_prompt', session_id: 'fleet-attention', prompt_id: 'fleet-permission',
      title: 'Review generated diff', message: 'Approve the proposed change?', timeout_ms: 120_000,
    }));
    proxy.send(JSON.stringify({
      type: 'status', session: 'fleet-paused', thinking: false,
      activity_trace: { proxy_emitted_at_ms: Date.now() },
      activity: {
        kind: 'idle', label: 'Goal paused',
        goal: { status: 'paused', objective: 'Resume only after operator review', updated_at: new Date(now).toISOString() },
      },
    }));
    proxy.send(JSON.stringify({
      type: 'status', session: 'fleet-idle', thinking: false,
      activity_trace: { proxy_emitted_at_ms: Date.now() },
      activity: { kind: 'idle', label: '' },
    }));
    proxy.send(JSON.stringify({
      type: 'status', session: 'fleet-readonly', thinking: true,
      activity_trace: { proxy_emitted_at_ms: Date.now() },
      activity: { kind: 'thinking', label: 'Waiting for thread selection' },
    }));
    [
      ['fleet-goal-two', { kind: 'generating', label: 'Preparing release', goal: { status: 'active', objective: 'Ship the verified release', progress_percent: 40, updated_at: new Date(now).toISOString() } }],
      ['fleet-cursor-work', { kind: 'working', label: 'Reviewing diff', current: { kind: 'tool', label: 'Reviewing active diff', since: new Date(now).toISOString() } }],
      ['fleet-antigravity-work', { kind: 'generating', label: 'Drafting response', current: { kind: 'response', label: 'Drafting the current response', since: new Date(now).toISOString() } }],
      ['fleet-attention-two', { kind: 'blocked', label: 'Operator choice required' }],
      ['fleet-idle-claude', { kind: 'idle', label: 'Idle' }],
      ['fleet-idle-cursor', { kind: 'idle', label: 'Idle' }],
      ['fleet-idle-gemini', { kind: 'idle', label: 'Idle' }],
      ['fleet-idle-continue', { kind: 'idle', label: 'Idle' }],
      ['fleet-idle-roo', { kind: 'idle', label: 'Idle' }],
      ['fleet-idle-cline', { kind: 'idle', label: 'Idle' }],
    ].forEach(([session, activity]) => proxy.send(JSON.stringify({
      type: 'status', session, thinking: ['thinking', 'generating', 'working'].includes(activity.kind),
      activity_trace: { proxy_emitted_at_ms: Date.now() }, activity,
    })));
    await new Promise(resolve => setTimeout(resolve, 350));

    browser = await chromium.launch({
      executablePath: findChrome(), headless: true,
      args: ['--disable-gpu', '--no-first-run', '--no-default-browser-check'],
    });
    const screenshotIndex = process.argv.indexOf('--screenshot-dir');
    const screenshotDir = screenshotIndex !== -1 ? path.resolve(process.argv[screenshotIndex + 1] || '') : null;
    if (screenshotIndex !== -1) assert(process.argv[screenshotIndex + 1], '--screenshot-dir requires an output path');
    const refreshLiveFixtures = async () => {
      const refreshedAt = Date.now();
      [
        ['fleet-working', {
          kind: 'applying_patch', label: 'Applying patch', started_at: new Date(refreshedAt - 65_000).toISOString(),
          goal: { status: 'active', objective: 'Ship fleet dashboard', time_used_seconds: 125, updated_at: new Date(refreshedAt).toISOString() },
          task_list: { tasks: [
            { state: 'completed', text: 'Model fleet state' }, { state: 'completed', text: 'Build web cards' },
            { state: 'in_progress', text: 'Verify mobile' }, { state: 'pending', text: 'Deploy' },
          ] },
        }],
        ['fleet-goal', {
          kind: 'thinking', label: 'Running parity audit', started_at: new Date(refreshedAt - 35_000).toISOString(),
          goal: { status: 'active', objective: 'Validate every client', progress_percent: 72, updated_at: new Date(refreshedAt).toISOString() },
          current: { kind: 'response', label: 'Running the mobile parity audit', since: new Date(refreshedAt).toISOString() },
        }],
        ['fleet-readonly', { kind: 'thinking', label: 'Waiting for thread selection' }],
        ['fleet-goal-two', { kind: 'generating', label: 'Preparing release', goal: { status: 'active', objective: 'Ship the verified release', progress_percent: 40, updated_at: new Date(refreshedAt).toISOString() } }],
        ['fleet-cursor-work', { kind: 'working', label: 'Reviewing diff', current: { kind: 'tool', label: 'Reviewing active diff', since: new Date(refreshedAt).toISOString() } }],
        ['fleet-antigravity-work', { kind: 'generating', label: 'Drafting response', current: { kind: 'response', label: 'Drafting the current response', since: new Date(refreshedAt).toISOString() } }],
        ['fleet-attention-two', { kind: 'blocked', label: 'Operator choice required' }],
      ].forEach(([session, activity]) => proxy.send(JSON.stringify({
        type: 'status', session, thinking: true,
        activity_trace: { proxy_emitted_at_ms: Date.now() }, activity,
      })));
      await new Promise(resolve => setTimeout(resolve, 100));
    };
    const visualMatrix = await captureFleetVisualMatrix(
      browser, `http://127.0.0.1:${port}/`, screenshotDir, refreshLiveFixtures,
    );
    await refreshLiveFixtures();
    const browserContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const page = await browserContext.newPage();
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
    await page.locator('.hamburger').click();
    await page.locator('.sidebar.open').waitFor();
    const workingSection = page.locator('.working-session-group');
    await workingSection.waitFor();
    const workingSidebarIds = await workingSection.locator('.session-card').evaluateAll(nodes => nodes.map(node => node.dataset.sessionId));
    assert.strictEqual(workingSidebarIds.length, 6);
    assert.deepStrictEqual(new Set(workingSidebarIds), new Set([
      'fleet-working', 'fleet-goal', 'fleet-readonly', 'fleet-goal-two', 'fleet-cursor-work', 'fleet-antigravity-work',
    ]));
    const sidebarIds = await page.locator('.session-list .session-card').evaluateAll(nodes => nodes.map(node => node.dataset.sessionId));
    assert.strictEqual(new Set(sidebarIds).size, sessions.length, 'sidebar hierarchy must contain every session exactly once');
    assert.deepStrictEqual(new Set(sidebarIds), new Set(sessions.map(session => session.session_id)));
    assert.ok(sidebarIds.slice(0, workingSidebarIds.length).every((id, index) => id === workingSidebarIds[index]), 'every working session must precede every non-working session');
    const workingContext = await workingSection.locator('.session-card[data-session-id="fleet-working"] .session-card-sub').textContent();
    assert.match(workingContext || '', /Remote Agent Chat|Unscoped/, `working row lost workspace context: ${JSON.stringify(workingContext)}`);
    await page.getByRole('button', { name: 'Fleet view' }).click();
    await page.getByRole('heading', { name: 'Fleet view' }).waitFor();
    assert.equal(await page.locator('.fleet-card').count(), 9, 'fleet must omit ordinary idle sessions while retaining paused-goal and active read-only sessions');
    assert.equal(await page.locator('.fleet-card[data-session-id="fleet-idle"]').count(), 0);
    const summaryText = await page.locator('.fleet-summary').innerText();
    for (const marker of ['16\nSESSIONS', '6\nWORKING', '2\nON GOAL', '8\nIDLE', '2\nNEED ATTENTION']) {
      assert(summaryText.includes(marker), `fleet summary missing ${marker}`);
    }
    const body = await page.locator('body').innerText();
    for (const marker of [
      'Build lane', 'Applying patch', 'Ship fleet dashboard', 'Applying the verified dashboard patch.',
      'Validation lane', 'Running the mobile parity audit', 'Review lane', 'Needs attention', 'Waiting for approval on the generated diff.',
      'Paused lane', 'Goal paused', 'Read-only lane', 'Unavailable', 'Working on goal', 'Activity',
    ]) assert(body.includes(marker), `fleet body missing ${marker}`);
    assert(!body.includes('Validate every client'), 'non-Codex stray goal text leaked into Fleet');
    assert(!body.includes('No active goal reported'), 'Fleet retained the false empty-goal copy');
    assert.equal(await page.locator('.fleet-card[data-session-id="fleet-working"][data-activity-state="working_goal"]').count(), 1);
    assert.equal(await page.locator('.fleet-card[data-session-id="fleet-goal"][data-activity-state="working"] .fleet-work-context.kind-response').count(), 1);
    assert.equal(await page.locator('.fleet-card[data-session-id="fleet-goal"] .fleet-work-context.kind-goal').count(), 0);
    assert.equal(await page.locator('.fleet-card[data-session-id="fleet-goal"] .fleet-work-meter.kind-goal').count(), 0);
    assert.equal(await page.locator('.fleet-card[data-session-id="fleet-readonly"][data-activity-state="working"]').count(), 1);
    assert.equal(await page.locator('.fleet-card[data-session-id="fleet-attention"][data-activity-state="needs_attention"]').count(), 1);
    assert.equal(await page.locator('.fleet-card[data-session-id="fleet-paused"][data-activity-state="idle"] .fleet-work-meter.kind-goal.inactive').count(), 1);
    assert.equal(await page.locator('[aria-label="Goal 50% complete"]').count(), 0,
      'task-list completion must not be invented as unlinked goal progress');
    assert.equal(await page.locator('[aria-label="Goal working on goal"].fleet-work-meter.indeterminate').count(), 1);
    assert.equal(await page.locator('[aria-label="Goal 40% complete"]').count(), 1,
      'explicit native Codex goal progress must render without inference');
    assert.equal(await page.locator('[aria-label="Goal 72% complete"]').count(), 0);
    const fleetJumpRows = await page.locator('.fleet-jump').evaluateAll(nodes => nodes.map(node => ({
      text: node.textContent.replace(/\s+/g, ' ').trim(),
      label: node.getAttribute('aria-label'),
      corrupt: /[\u00e2\u00c2\u00c3\ufffd]/.test(node.textContent || ''),
      chevrons: node.querySelectorAll('.fleet-jump-chevron[aria-hidden="true"]').length,
    })));
    assert.strictEqual(fleetJumpRows.length, 9);
    assert(fleetJumpRows.every(row => row.text === `Open session ${String.fromCodePoint(0x203a)}` && row.label === 'Open session' && !row.corrupt && row.chevrons === 1),
      `Fleet open actions are not encoding-safe: ${JSON.stringify(fleetJumpRows)}`);
    await page.getByRole('button', { name: 'Show 8 idle sessions' }).click();
    assert.equal(await page.locator('.fleet-card').count(), 16, 'idle reveal must expose every operator-visible session');
    assert.equal(await page.locator('.fleet-card[data-session-id="fleet-idle"][data-activity-state="idle"]').count(), 1);
    assert.equal(
      await page.locator('.fleet-card[data-session-id="fleet-idle"] .fleet-card-status strong').innerText(),
      'Idle',
      'an empty native activity label must retain an explicit operator-visible fallback status',
    );
    await page.getByRole('button', { name: 'Hide idle sessions' }).click();
    const elapsedBefore = await page.locator('.fleet-card[data-session-id="fleet-working"] time').innerText();
    await page.waitForTimeout(1_100);
    const elapsedAfter = await page.locator('.fleet-card[data-session-id="fleet-working"] time').innerText();
    assert.notEqual(elapsedAfter, elapsedBefore, 'live elapsed ticker must advance');

    const freshnessLatencies = [];
    for (let index = 0; index < 20; index += 1) {
      const proxyEmittedAtMs = Date.now();
      proxy.send(JSON.stringify({
        type: 'proxy_status', session_id: 'fleet-goal', status: 'healthy', thinking: true,
        activity_trace: { proxy_emitted_at_ms: proxyEmittedAtMs },
        activity: {
          kind: 'thinking', label: `Freshness sample ${index}`,
          goal: { status: 'active', objective: 'Validate every client', progress_percent: 72, updated_at: new Date(proxyEmittedAtMs).toISOString() },
        },
      }));
      const card = page.locator('.fleet-card[data-session-id="fleet-goal"]');
      await card.locator('.fleet-card-status strong').filter({ hasText: `Freshness sample ${index}` }).waitFor({ timeout: 2000 });
      const latency = Number(await card.getAttribute('data-activity-lag-ms'));
      assert(Number.isFinite(latency), `freshness sample ${index} did not reach the Fleet card with a trace`);
      freshnessLatencies.push(latency);
    }
    const sortedLatencies = [...freshnessLatencies].sort((left, right) => left - right);
    const freshnessP95Ms = sortedLatencies[Math.ceil(sortedLatencies.length * 0.95) - 1];
    assert(freshnessP95Ms <= 2000, `proxy-to-Fleet freshness p95 was ${freshnessP95Ms} ms`);

    await page.getByLabel('Select Build lane for broadcast').check();
    await page.getByLabel('Select Validation lane for broadcast').check();
    assert.equal(await page.getByLabel('Select Read-only lane for broadcast').isDisabled(), true,
      'list-view session must be capability-gated from broadcast');
    await page.getByLabel('Broadcast prompt').fill('Review the current working tree and report blockers.');
    await page.getByLabel('Broadcast confirmation').fill('SEND TO 2 SESSION');
    assert.equal(await page.getByRole('button', { name: 'Send to 2' }).isDisabled(), true,
      'wrong exact-count confirmation must not enable send');
    await page.getByLabel('Broadcast confirmation').fill('SEND TO 2 SESSIONS');
    await page.getByRole('button', { name: 'Send to 2' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.fleet-broadcast-receipt.agent_started').length === 2);
    assert.equal(broadcastProxyMessages.length, 2, 'broadcast must fan out exactly once per selected session');
    assert.deepEqual(broadcastProxyMessages.map(message => message.session).sort(), ['fleet-goal', 'fleet-working']);
    assert(broadcastProxyMessages.every(message => message.content === 'Review the current working tree and report blockers.'));
    async function reopenFleet() {
      await page.locator('.hamburger').click();
      await page.locator('.sidebar.open').waitFor();
      await page.getByRole('button', { name: 'Fleet view' }).click();
      await page.getByRole('heading', { name: 'Fleet view' }).waitFor();
    }

    await page.locator('.fleet-card[data-session-id="fleet-working"]').click();
    await page.locator('[data-testid="fleet-view"]').waitFor({ state: 'detached' });
    assert.equal(await page.locator('.session-card.active[data-session-id="fleet-working"]').count(), 1);
    await reopenFleet();
    await page.locator('.fleet-card[data-session-id="fleet-goal"]').focus();
    await page.keyboard.press('Enter');
    await page.locator('[data-testid="fleet-view"]').waitFor({ state: 'detached' });
    assert.equal(await page.locator('.session-card.active[data-session-id="fleet-goal"]').count(), 1);
    await reopenFleet();
    await page.locator('.fleet-card[data-session-id="fleet-readonly"]').tap();
    await page.locator('[data-testid="fleet-view"]').waitFor({ state: 'detached' });
    assert.equal(await page.locator('.session-card.active[data-session-id="fleet-readonly"]').count(), 1);

    const androidSource = fs.readFileSync(path.join(__dirname, '..', 'android-app', 'screens', 'SessionListScreen.jsx'), 'utf8');
    for (const marker of [
      'visible={showFleetView}', 'Fleet view', 'fleetEntries', 'fleetElapsedLabel',
      'fleetStateLabel(entry.state)', 'Activity {entry.freshness}', 'Show ${fleetIdleCount} idle',
      'Open session', "{'\\u203A'}", 'workContext', "navigation.navigate('Chat'",
      'broadcastSelectedIds', 'Broadcast prompt', 'SEND TO ${broadcastSelectedIds.length} SESSIONS',
      'Broadcast delivery receipts', 'sessionSupportsBroadcast',
    ]) assert(androidSource.includes(marker), `Android fleet parity missing ${marker}`);

    const result = {
      status: 'PASS',
      actual_relay: true,
      actual_web_bundle: true,
      viewport: '390x844',
      active_cards: 8,
      default_cards: 9,
      total_sessions: 16,
      idle_cards_default: 1,
      idle_cards_revealed: 8,
      working_on_goal_cards: 2,
      working_without_goal_cards: 4,
      non_codex_goal_elements: 0,
      needs_attention_cards: 2,
      goal_progress: [40],
      indeterminate_native_goal_meters: 1,
      live_elapsed_advanced: true,
      freshness_samples: freshnessLatencies.length,
      freshness_p95_ms: freshnessP95Ms,
      freshness_max_ms: Math.max(...freshnessLatencies),
      attention_priority: true,
      snippets_visible: true,
      one_tap_jump: true,
      navigation_input_modes: ['mouse', 'keyboard', 'touch'],
      open_action_encoding_safe: true,
      visual_matrix: visualMatrix,
      android_source_parity: true,
      broadcast_selected_sessions: 2,
      broadcast_exact_confirmation: true,
      broadcast_capability_gate: true,
      broadcast_proxy_deliveries: broadcastProxyMessages.length,
      broadcast_final_receipts: 'agent_started',
      visible_windows: 0,
      protected_user_apps_touched: 0,
    };
    const evidenceIndex = process.argv.indexOf('--evidence');
    if (evidenceIndex !== -1) {
      const evidencePath = process.argv[evidenceIndex + 1];
      assert(evidencePath, '--evidence requires an output path');
      fs.mkdirSync(path.dirname(path.resolve(evidencePath)), { recursive: true });
      fs.writeFileSync(path.resolve(evidencePath), `${JSON.stringify({
        ...result,
        recorded_at: new Date().toISOString(),
      }, null, 2)}\n`);
    }
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    throw new Error(`${error.stack || error}\n--- relay output ---\n${output.join('')}`);
  } finally {
    await browser?.close();
    await closeSocket(proxy);
    if (child.exitCode == null) {
      await new Promise(resolve => {
        child.once('exit', resolve);
        child.kill();
        setTimeout(() => child.exitCode == null && child.kill('SIGKILL'), 1_000).unref();
      });
    }
    const resolved = path.resolve(tempRoot);
    assert(resolved.startsWith(path.resolve(os.tmpdir(), 'rac-fleet-view-')));
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
