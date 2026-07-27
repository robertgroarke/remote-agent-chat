#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('../frontend/node_modules/playwright-core');
const CDP = require('../agent-proxy/node_modules/chrome-remote-interface');
const selectors = require('../agent-proxy/selectors');
const fidelity = require('./run-fidelity-regression');
const {
  createProductionLoopbackProxy,
  findChrome,
} = require('./mobile-cold-load-production-e2e');

const ROOT = path.resolve(__dirname, '..');
const ENV_ROOT = path.resolve(process.env.RAC_CONFIG_ROOT || ROOT);
const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
const outputPath = outputIndex >= 0 && args[outputIndex + 1]
  ? path.resolve(args[outputIndex + 1])
  : path.join(ROOT, 'evidence', 'harness-maturity', new Date().toISOString().slice(0, 10),
    'vscode-codex-controls-production-passive.json');
const sessionIndex = args.indexOf('--session-id');
const requestedSessionId = sessionIndex >= 0 && args[sessionIndex + 1]
  ? String(args[sessionIndex + 1])
  : '';
const widthIndex = args.indexOf('--width');
const heightIndex = args.indexOf('--height');
const themeIndex = args.indexOf('--theme');
const viewport = {
  width: widthIndex >= 0 ? Number(args[widthIndex + 1]) : 1440,
  height: heightIndex >= 0 ? Number(args[heightIndex + 1]) : 900,
};
const theme = themeIndex >= 0 ? String(args[themeIndex + 1]) : 'dark';
const sessionStorePath = path.resolve(
  process.env.SESSION_STORE_PATH || path.join(ROOT, 'agent-proxy', 'session-store.json'),
);
assert(Number.isInteger(viewport.width) && viewport.width >= 320, '--width must be at least 320');
assert(Number.isInteger(viewport.height) && viewport.height >= 480, '--height must be at least 480');
assert(['dark', 'light'].includes(theme), '--theme must be dark or light');

const FORBIDDEN_WS_TYPES = new Set([
  'set_codex_config', 'send', 'permission_response', 'error_prompt_action',
  'agent_interrupt', 'agent_set_model', 'agent_set_permission_mode',
  'agent_set_effort', 'agent_set_mode', 'agent_set_auto_approve_permissions',
  'switch_chat', 'new_thread', 'new_chat', 'open_panel',
]);

function protectedSession() {
  const store = JSON.parse(fs.readFileSync(sessionStorePath, 'utf8'));
  const matches = Object.entries(store.sessions || {}).filter(([sessionId, session]) => (
    session?.agent_type === 'codex'
    && Number(session?.cdp_port) === 9223
    && session?.status === 'healthy'
    && (requestedSessionId
      ? sessionId === requestedSessionId
      : /[\\/]Remote Agent Chat$/i.test(String(session?.workspace_path || '')))
  ));
  assert.equal(matches.length, 1, requestedSessionId
    ? `Expected one healthy protected Codex session ${requestedSessionId}`
    : 'Expected one healthy protected Remote Agent Chat Codex session');
  const [sessionId, session] = matches[0];
  assert(session.target_id, 'Protected Codex session omitted target_id');
  return { session_id: sessionId, ...session };
}

async function nativeConfig(session) {
  const targets = await CDP.List({ port: 9223 });
  const target = targets.find(candidate => candidate.id === session.target_id);
  assert(target, 'Protected Codex target is no longer present on port 9223');
  let client;
  try {
    client = await CDP({ port: 9223, target: target.id });
    await client.Runtime.enable();
    client.Runtime._webviewId = (String(target.url || '').match(/[?&]id=([0-9a-f-]+)/i) || [])[1] || '';
    await selectors.cacheInnerContextId(client.Runtime);
    const [config, rawMessages] = await Promise.all([
      selectors.readAgentConfig(client.Runtime, 'codex', session.workspace_path || ''),
      selectors.readMessages(client.Runtime, 'codex', `vscode-codex-controls-${session.session_id}`),
    ]);
    const messages = rawMessages ? JSON.parse(rawMessages) : [];
    return {
      model_id: config.model_id,
      effort: config.effort,
      permission_profile: config.permission_profile,
      permission_mode: config.permission_mode,
      approval_policy: config.approval_policy,
      conversation_scoped: config.conversation_scoped === true,
      native_message_count: Array.isArray(messages) ? messages.length : 0,
    };
  } finally {
    await client?.close().catch(() => {});
  }
}

async function main() {
  const relayEnv = fidelity.loadEnvFile(path.join(ENV_ROOT, 'relay-server', '.env'));
  const proxyEnv = fidelity.loadEnvFile(path.join(ENV_ROOT, 'agent-proxy', '.env'));
  const upstreamUrl = fidelity.deriveRelayBaseUrl(null, relayEnv, proxyEnv);
  const publicOrigin = new URL(relayEnv.PUBLIC_URL).origin;
  const token = fidelity.buildBearerToken(relayEnv);
  assert(upstreamUrl?.startsWith('http://'), 'Configured production LAN relay URL is required');
  assert(token, 'JWT bearer token could not be built');

  const session = protectedSession();
  const expected = await nativeConfig(session);
  assert(expected.model_id && expected.model_id !== 'unknown', 'Protected native model is unreadable');
  assert(expected.effort && expected.effort !== 'unknown', 'Protected native effort is unreadable');
  assert(expected.permission_profile && expected.permission_profile !== 'unknown',
    'Protected native permission profile is unreadable');

  const loopback = await createProductionLoopbackProxy(upstreamUrl, publicOrigin, token);
  const browser = await chromium.launch({
    executablePath: findChrome(),
    headless: true,
    args: ['--disable-gpu', '--no-first-run', '--disable-background-networking'],
  });
  try {
    const context = await browser.newContext({ viewport });
    await context.addInitScript(selectedTheme => localStorage.setItem('theme', selectedTheme), theme);
    const page = await context.newPage();
    const diagnostics = [];
    page.on('console', message => diagnostics.push(`console:${message.type()}:${message.text()}`));
    page.on('pageerror', error => diagnostics.push(`pageerror:${error.message}`));
    page.on('websocket', socket => {
      diagnostics.push(`websocket:${new URL(socket.url()).pathname}`);
      socket.on('socketerror', error => diagnostics.push(`websocket-error:${error}`));
      socket.on('close', () => diagnostics.push('websocket-close'));
    });
    await page.addInitScript(() => {
      const NativeWebSocket = window.WebSocket;
      const sent = [];
      function AuditedWebSocket(url, protocols) {
        const socket = protocols === undefined
          ? new NativeWebSocket(url)
          : new NativeWebSocket(url, protocols);
        const nativeSend = socket.send.bind(socket);
        socket.send = data => {
          try {
            const message = JSON.parse(String(data));
            sent.push({ type: String(message?.type || ''), session_id: message?.session_id || message?.session || null });
          } catch {
            sent.push({ type: 'non_json', session_id: null });
          }
          return nativeSend(data);
        };
        return socket;
      }
      AuditedWebSocket.prototype = NativeWebSocket.prototype;
      for (const key of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) {
        AuditedWebSocket[key] = NativeWebSocket[key];
      }
      window.WebSocket = AuditedWebSocket;
      window.__RAC_PASSIVE_WS_SENT__ = sent;
    });

    const response = await page.goto(loopback.url + '?vscode_codex_controls_passive=1', {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });
    assert.equal(response?.status(), 200, 'Authenticated production app did not load');
    try {
      await page.waitForFunction(sessionId => (
        /Relay (?:connected|healthy)/.test(document.querySelector('.sidebar-footer')?.textContent || '')
        && document.querySelector('.session-card[data-session-id="' + CSS.escape(sessionId) + '"]')
      ), session.session_id, { timeout: 45000 });
    } catch (error) {
      const rendered = await page.evaluate(sessionId => ({
        title: document.title,
        body_text: document.body?.innerText?.slice(0, 2000) || '',
        footer_text: document.querySelector('.sidebar-footer')?.textContent?.replace(/\s+/g, ' ').trim() || '',
        card_count: document.querySelectorAll('.session-card[data-session-id]').length,
        target_present: !!document.querySelector('.session-card[data-session-id="' + CSS.escape(sessionId) + '"]'),
        card_ids: Array.from(document.querySelectorAll('.session-card[data-session-id]'))
          .map(card => card.dataset.sessionId).filter(Boolean),
        bundle_src: document.querySelector('script[src*="/dist/bundle.js"]')?.getAttribute('src') || '',
        service_worker_controlled: !!navigator.serviceWorker?.controller,
      }), session.session_id);
      throw new Error(`${error.message}; diagnostic=${JSON.stringify({ rendered, diagnostics })}`);
    }

    const card = page.locator('.session-card[data-session-id="' + session.session_id + '"]');
    await card.evaluate(element => element.click());
    await page.waitForFunction(sessionId => (
      document.querySelector('.session-card.active[data-session-id="' + CSS.escape(sessionId) + '"]')
      && document.querySelector('.messages')?.dataset?.agentType === 'codex'
    ), session.session_id, { timeout: 20000 });
    await page.waitForFunction(({ sessionId, expectedCount }) => (
      document.querySelector('.session-card.active[data-session-id="' + CSS.escape(sessionId) + '"]')
      && Number(document.querySelector('.messages')?.dataset?.totalMessageCount || 0) === expectedCount
    ), { sessionId: session.session_id, expectedCount: expected.native_message_count }, { timeout: 45000 });
    if (viewport.width <= 768) {
      const mobileSettingsToggle = page.locator('button.composer-gear-btn[title="Toggle settings"]');
      await mobileSettingsToggle.waitFor({ state: 'visible', timeout: 15000 });
      await mobileSettingsToggle.evaluate(element => element.click());
      await page.waitForSelector('.composer-settings.is-open', { state: 'visible', timeout: 15000 });
    }

    const detailsButton = page.locator('button.composer-desktop-action:visible, button.composer-mobile-action:visible')
      .filter({ hasText: 'Session details' })
      .first();
    await detailsButton.waitFor({ state: 'visible', timeout: 15000 });
    await detailsButton.evaluate(element => element.click());
    await page.waitForFunction(() => {
      const panel = document.querySelector('.settings-panel');
      const labels = Array.from(panel?.querySelectorAll('.settings-label') || [])
        .map(node => node.textContent?.trim());
      return panel?.querySelector('.settings-panel-header')?.textContent?.includes('Session Settings')
        && ['Next turn model', 'Next turn effort', 'Next turn permissions',
          'Approval policy', 'Access / sandbox'].every(label => labels.includes(label));
    }, null, { timeout: 30000 });

    const state = await page.evaluate(() => {
      function row(label) {
        const root = Array.from(document.querySelectorAll('.settings-panel .settings-row'))
          .find(candidate => candidate.querySelector('.settings-label')?.textContent?.trim() === label);
        if (!root) return null;
        const select = root.querySelector('select');
        const value = root.querySelector('.settings-value');
        return {
          value: select ? select.value : value?.textContent?.trim() || '',
          selected_text: select ? select.selectedOptions[0]?.textContent?.trim() || '' : value?.textContent?.trim() || '',
          disabled: select ? select.disabled : null,
          options: select ? Array.from(select.options).map(option => ({
            value: option.value,
            text: option.textContent?.trim() || '',
          })) : [],
        };
      }
      const script = document.querySelector('script[src*="/dist/bundle.js"]');
      return {
        selected_session_id: document.querySelector('.session-card.active[data-session-id]')?.dataset?.sessionId || '',
        agent_type: document.querySelector('.messages')?.dataset?.agentType || '',
        panel_title: document.querySelector('.settings-panel-header')?.textContent?.replace(/\s+/g, ' ').trim() || '',
        model: row('Next turn model'),
        effort: row('Next turn effort'),
        permissions: row('Next turn permissions'),
        approval_policy: row('Approval policy'),
        access_sandbox: row('Access / sandbox'),
        total_message_count: Number(document.querySelector('.messages')?.dataset?.totalMessageCount || 0),
        session_card_text: document.querySelector('.session-card.active[data-session-id]')?.textContent
          ?.replace(/\s+/g, ' ').trim() || '',
        composer_present: !!document.querySelector('.input-area textarea'),
        composer_disabled: document.querySelector('.input-area textarea')?.disabled === true,
        body_overflow_x: document.body.scrollWidth > window.innerWidth,
        bundle_src: script?.getAttribute('src') || '',
        sent_ws: Array.from(window.__RAC_PASSIVE_WS_SENT__ || []),
      };
    });

    assert.equal(state.selected_session_id, session.session_id, 'Production UI selected the wrong session');
    assert.equal(state.agent_type, 'codex', 'Production UI rendered the wrong harness skin');
    assert.equal(state.total_message_count, expected.native_message_count,
      'Rendered transcript count differs from protected native truth');
    assert.equal(state.model?.value, expected.model_id, 'Rendered model differs from protected native truth');
    assert.equal(state.effort?.value, expected.effort, 'Rendered effort differs from protected native truth');
    assert.equal(state.permissions?.value, expected.permission_profile,
      'Rendered permission profile differs from protected native truth');
    assert.equal(state.approval_policy?.value, expected.approval_policy || 'Native custom policy',
      'Rendered approval policy differs from protected native truth');
    assert.equal(state.access_sandbox?.value, expected.permission_mode || 'Native custom access',
      'Rendered sandbox/access differs from protected native truth');
    assert(state.model.options.some(option => option.value === expected.model_id), 'Current model is absent from picker');
    assert(state.effort.options.some(option => option.value === expected.effort), 'Current effort is absent from picker');
    assert(state.permissions.options.some(option => option.value === 'full-access' && option.text === 'Full access'),
      'Confirmed Full access option is absent from permission picker');
    assert.equal(state.model.disabled, !expected.conversation_scoped,
      'Protected model picker availability differs from native conversation scope');
    assert.equal(state.effort.disabled, !expected.conversation_scoped,
      'Protected effort picker availability differs from native conversation scope');
    assert.equal(state.permissions.disabled, !expected.conversation_scoped,
      'Protected permissions picker availability differs from native conversation scope');
    assert.equal(state.body_overflow_x, false, 'Production settings cause horizontal overflow');
    const forbidden = state.sent_ws.filter(message => FORBIDDEN_WS_TYPES.has(message.type));
    assert.deepStrictEqual(forbidden, [], 'Passive production proof emitted a control/send message');

    const screenshotPath = path.join(path.dirname(outputPath),
      `vscode-codex-controls-production-passive-${session.session_id.slice(0, 8)}-${viewport.width}x${viewport.height}-${theme}.png`);
    fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: true });
    const result = {
      ok: true,
      generated_at: new Date().toISOString(),
      browser: 'Google Chrome headless (fresh authenticated production loopback)',
      public_origin: publicOrigin,
      production_lan_origin: new URL(upstreamUrl).origin,
      viewport: { ...viewport, theme },
      protected_session: {
        session_id: session.session_id,
        cdp_port: 9223,
        workspace_path: session.workspace_path,
      },
      native_expected: expected,
      rendered: state,
      forbidden_ws_messages: forbidden.length,
      delivery_capability: {
        composer_present: state.composer_present,
        composer_disabled: state.composer_disabled,
        protected_send_exercised: false,
        reason: 'protected port 9223 passive-only contract',
      },
      production_controls_clicked: 0,
      user_messages_sent: 0,
      focus_actions: 0,
      visible_windows_opened: 0,
      screenshot: screenshotPath,
    };
    const serialized = JSON.stringify(result, null, 2) + '\n';
    fs.writeFileSync(outputPath, serialized, 'utf8');
    process.stdout.write(serialized);
  } finally {
    await browser.close();
    await loopback.close();
  }
}

main().catch(error => {
  console.error('VS Code Codex production passive E2E: FAIL (' + (error.stack || error.message) + ')');
  process.exit(1);
});
