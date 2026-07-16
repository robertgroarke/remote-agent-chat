#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const { chromium } = require('../frontend/node_modules/playwright-core');
const { WebSocketServer } = require('../relay-server/node_modules/ws');

const root = path.resolve(__dirname, '..');
const publicRoot = path.join(root, 'frontend');
const cdpUrl = process.env.RAC_VERIFICATION_BROWSER_CDP || 'http://127.0.0.1:9240';
const allowHeadlessFallback = process.env.RAC_ALLOW_HEADLESS_BROWSER === '1';
const outputIndex = process.argv.indexOf('--output');
const outputPath = outputIndex >= 0 && process.argv[outputIndex + 1]
  ? path.resolve(process.argv[outputIndex + 1]) : null;
const sessions = [
  { session_id: 'skin-claude', agent_type: 'claude', title: 'Claude controls', chat_title: 'Claude controls' },
  { session_id: 'skin-codex-cli', agent_type: 'codex_cli', title: 'Codex CLI controls', chat_title: 'Codex CLI controls' },
  { session_id: 'skin-cursor', agent_type: 'cursor', title: 'Cursor controls', chat_title: 'Cursor controls' },
  { session_id: 'skin-codex', agent_type: 'codex', title: 'VS Code Codex controls', chat_title: 'VS Code Codex controls' },
  { session_id: 'skin-codex-desktop', agent_type: 'codex-desktop', title: 'Codex Desktop controls', chat_title: 'Codex Desktop controls' },
].map(session => ({ ...session, status: 'healthy', workspace_name: 'Remote Agent Chat' }));
const CONTROL_TYPES = ['agent_set_model', 'agent_set_mode', 'agent_set_permission_mode', 'agent_set_effort', 'set_codex_config'];

const configs = {
  'skin-claude': {
    capabilities: { set_model: true, permission_mode_change: true }, model_id: 'claude-sonnet-4', permission_mode: 'acceptEdits',
    available_models: [{ id: 'claude-sonnet-4', label: 'Claude Sonnet 4' }],
    available_permission_modes: [{ id: 'default', label: 'Ask before edits' }, { id: 'acceptEdits', label: 'Edit automatically' }],
  },
  'skin-codex-cli': {
    capabilities: { set_model: true, permission_mode_change: true, set_effort: true }, model_id: 'gpt-5', permission_mode: 'on-request', effort: 'high',
    available_models: [{ id: 'gpt-5', label: 'gpt-5' }],
    available_permission_modes: [{ id: 'on-request', label: 'On request' }, { id: 'never', label: 'Never ask' }],
    available_efforts: [{ id: 'medium', label: 'Medium' }, { id: 'high', label: 'High' }],
  },
  'skin-cursor': {
    capabilities: { set_model: true, set_mode: true }, model_id: 'auto', mode: 'agent',
    available_models: [{ id: 'auto', label: 'Auto' }],
    available_modes: [{ id: 'agent', label: 'Agent' }, { id: 'ask', label: 'Ask' }],
  },
  'skin-codex': {
    capabilities: {
      set_codex_config: true,
      codex_model_change: true,
      codex_effort_change: true,
      codex_permission_profile_change: true,
      codex_bypass_permissions: true,
    },
    config_semantics: 'next_turn_native', controls_available: true, conversation_scoped: true,
    source_revision: 'codex-fixture-revision', model_id: 'gpt-5.6-sol', effort: 'extra-high',
    permission_profile: 'auto', permission_mode: 'workspace-write', approval_policy: 'on-request',
    bypass_permissions_active: false,
    available_models: [{ id: 'gpt-5.5', label: 'GPT-5.5' }, { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' }],
    available_efforts: [{ id: 'high', label: 'High' }, { id: 'extra-high', label: 'Extra High' }],
    available_permission_profiles: [
      { id: 'auto', label: 'Ask for approval' },
      { id: 'guardian-approvals', label: 'Approve for me' },
      { id: 'full-access', label: 'Full access' },
      { id: 'custom', label: 'Custom (config.toml)' },
    ],
  },
  'skin-codex-desktop': {
    capabilities: {
      set_codex_config: true,
      codex_model_change: true,
      codex_effort_change: true,
      codex_access_change: true,
      codex_speed_change: true,
    }, model_id: 'gpt-5', permission_mode: 'workspace-write', effort: 'high', speed: 'standard',
    available_models: [{ id: 'gpt-5', label: 'GPT-5' }, { id: 'gpt-5-mini', label: 'GPT-5 mini' }],
    available_access: [{ id: 'workspace-write', label: 'Workspace' }],
    available_efforts: [{ id: 'medium', label: 'Medium' }, { id: 'high', label: 'High' }],
    available_speeds: [{ id: 'standard', label: 'Standard' }],
  },
};

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

function contentType(filePath) {
  return ({ '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8' })[path.extname(filePath)]
    || 'application/octet-stream';
}

async function main() {
  const port = await freePort();
  const mutations = [];
  const clientMessages = [];
  let fixtureSocket = null;
  const server = http.createServer((request, response) => {
    if (request.url.startsWith('/api/')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"preferences":{}}');
      return;
    }
    const pathname = new URL(request.url, `http://127.0.0.1:${port}`).pathname;
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const filePath = path.resolve(publicRoot, relative);
    if (!filePath.startsWith(`${path.resolve(publicRoot)}${path.sep}`)
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
    send({ type: 'connection_ack', heartbeat_interval_ms: 1000, heartbeat_timeout_ms: 5000, sessions, workspaces: [] });
    ws.on('message', raw => {
      let message;
      try { message = JSON.parse(String(raw)); } catch { return; }
      clientMessages.push(message);
      const sid = message.session_id || message.session;
      if ([...CONTROL_TYPES, 'agent_message', 'agent_interrupt', 'permission_response'].includes(message.type)) mutations.push(message);
      if (message.type === 'heartbeat') {
        send({ type: 'heartbeat_ack', request_id: message.request_id, server_ts: new Date().toISOString() });
      } else if (message.type === 'agent_config_request') {
        send({ type: 'agent_config', session_id: sid, ...(configs[sid] || { capabilities: {} }) });
      } else if (message.type === 'history_chunk_request') {
        send({ type: 'history_chunk', session_id: sid, request_id: message.request_id, source: 'fixture', mode: 'tail', replace: message.replace !== false, messages: [{ role: 'assistant', content: `Transcript for ${sid}`, sequence: 1 }], total_messages: 1, loaded_messages: 1, partial: false });
      } else if (message.type === 'get_history') {
        send({ type: 'history', session: sid, request_id: message.request_id, messages: [{ role: 'assistant', content: `Transcript for ${sid}`, sequence: 1 }] });
      } else if (message.type === 'history_request') {
        send({ type: 'history_delta', session: sid, session_id: sid, request_id: message.request_id, messages: [], loaded_messages: 0, total_messages: 1 });
      }
    });
  });
  await new Promise((resolve, reject) => server.listen(port, '127.0.0.1', error => error ? reject(error) : resolve()));

  let browser;
  let page;
  let pages;
  let originalUrl;
  let originalViewport;
  let headlessFallback = false;
  try {
    try {
      browser = await chromium.connectOverCDP(cdpUrl);
      pages = browser.contexts().flatMap(context => context.pages());
    } catch (error) {
      if (!allowHeadlessFallback) throw error;
      browser = await chromium.launch({ channel: 'chrome', headless: true });
      page = await browser.newPage();
      pages = [page];
      headlessFallback = true;
    }
    assert.strictEqual(pages.length, 1, `expected one persistent page, found ${pages.length}`);
    if (!page) [page] = pages;
    originalUrl = page.url();
    originalViewport = page.viewportSize();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.locator('.input-area[data-composer-skin]').waitFor({ state: 'visible', timeout: 5000 });
    await page.waitForFunction(() => !document.querySelector('.toast.visible'), null, { timeout: 5000 });

    const expected = {
      'skin-claude': { skin: 'claude', controls: ['Permission', 'Model'] },
      'skin-codex-cli': { skin: 'codex-cli', controls: ['Model', 'Access', 'Effort'] },
      'skin-cursor': { skin: 'cursor', controls: ['Model', 'Mode'] },
      'skin-codex': { skin: 'codex', controls: ['Next model', 'Next effort', 'Next permissions'] },
      'skin-codex-desktop': { skin: 'codex', controls: ['Model', 'Effort', 'Speed', 'Access'] },
    };
    const geometry = {};
    const screenshots = [];
    const settingsVisuals = [];
    async function captureCodexSettingsState(state) {
      for (const viewport of [
        { id: 'desktop', width: 1440, height: 900 },
        { id: 'mobile', width: 390, height: 844 },
      ]) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        for (const theme of ['dark', 'light']) {
          await page.evaluate(value => {
            document.documentElement.setAttribute('data-theme', value);
            localStorage.setItem('remote-agent-chat-theme', value);
          }, theme);
          await page.waitForTimeout(30);
          const measurement = await page.locator('.settings-panel').evaluate(node => {
            const rect = node.getBoundingClientRect();
            const actionHeights = Array.from(node.querySelectorAll('.settings-bypass-actions button, .settings-restore-safe'))
              .map(button => Math.round(button.getBoundingClientRect().height));
            return {
              left: Math.round(rect.left),
              right: Math.round(rect.right),
              width: Math.round(rect.width),
              viewport_width: innerWidth,
              scroll_width: node.scrollWidth,
              client_width: node.clientWidth,
              action_heights: actionHeights,
            };
          });
          assert(measurement.left >= 0 && measurement.right <= measurement.viewport_width,
            `${state}/${viewport.id}/${theme} settings panel escaped the viewport`);
          assert(measurement.scroll_width <= measurement.client_width + 1,
            `${state}/${viewport.id}/${theme} settings panel overflowed horizontally`);
          measurement.action_heights.forEach(height => assert(height >= 44,
            `${state}/${viewport.id}/${theme} high-risk action is below 44 px`));
          const screenshot = outputPath
            ? path.join(path.dirname(outputPath), `skin-codex-settings-${state}-${viewport.id}-${theme}.png`)
            : null;
          if (screenshot) {
            await page.locator('.settings-panel').screenshot({ path: screenshot, animations: 'disabled' });
            screenshots.push(path.relative(root, screenshot));
          }
          settingsVisuals.push({ state, viewport: viewport.id, theme, ...measurement });
        }
      }
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.evaluate(() => {
        document.documentElement.setAttribute('data-theme', 'dark');
        localStorage.setItem('remote-agent-chat-theme', 'dark');
      });
    }
    for (const session of sessions) {
      await page.locator(`.session-card[data-session-id="${session.session_id}"]`).evaluate(node => node.click());
      await page.waitForFunction(id => document.querySelector('.session-card.active')?.dataset.sessionId === id, session.session_id);
      await page.waitForFunction(count => document.querySelectorAll('.composer-settings .composer-setting-label').length >= count, expected[session.session_id].controls.length);
      const composer = page.locator('.input-area');
      assert.strictEqual(await composer.getAttribute('data-composer-skin'), expected[session.session_id].skin);
      const controls = await page.locator('.composer-settings .composer-setting-label').evaluateAll(nodes => nodes.map(node => node.innerText.replace(/\s+/g, ' ').trim()));
      for (const label of expected[session.session_id].controls) {
        assert(controls.some(value => value.toLowerCase().startsWith(label.toLowerCase())), `${session.session_id} is missing ${label}`);
      }
      const bounds = await page.locator('.composer-settings .composer-setting-label').evaluateAll(nodes => nodes.map(node => {
        const rect = node.getBoundingClientRect();
        return { control: node.dataset.control, x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
      }));
      geometry[session.session_id] = bounds;
      if (outputPath) {
        const screenshot = path.join(path.dirname(outputPath), `${session.session_id}-composer.png`);
        await composer.screenshot({ path: screenshot, animations: 'disabled' });
        screenshots.push(path.relative(root, screenshot));
      }
    }

    assert(geometry['skin-claude'].find(row => row.control === 'permission').x <= geometry['skin-claude'].find(row => row.control === 'model').x);
    assert(geometry['skin-cursor'].find(row => row.control === 'mode').x <= geometry['skin-cursor'].find(row => row.control === 'model').x);
    assert(new Set(geometry['skin-codex-cli'].map(row => row.y)).size === 1, 'Codex CLI chips are not one footer row');

    await page.locator('.session-card[data-session-id="skin-cursor"]').evaluate(node => node.click());
    await page.locator('.composer-settings [data-control="mode"] select').selectOption('ask');
    await page.locator('.session-card[data-session-id="skin-codex-cli"]').evaluate(node => node.click());
    await page.locator('.composer-settings [data-control="permission"] select').selectOption('never');
    await page.locator('.session-card[data-session-id="skin-codex-desktop"]').evaluate(node => node.click());
    await page.locator('.composer-settings [data-control="model"] select').selectOption('gpt-5-mini');
    await page.locator('.session-card[data-session-id="skin-codex"]').evaluate(node => node.click());
    await page.locator('.composer-settings .composer-desktop-action').filter({ hasText: 'Session details' }).click();
    await page.locator('.settings-panel').waitFor({ state: 'visible', timeout: 1000 });
    const detailLabels = await page.locator('.settings-panel .settings-label').allTextContents();
    for (const expectedLabel of ['Next turn model', 'Next turn effort', 'Next turn permissions', 'Approval policy', 'Access / sandbox']) {
      assert(detailLabels.includes(expectedLabel), `VS Code Codex Session Settings omitted ${expectedLabel}`);
    }
    await captureCodexSettingsState('idle');

    const modelSelect = page.locator('.settings-panel .settings-row').filter({ hasText: 'Next turn model' }).locator('select');
    await modelSelect.selectOption('gpt-5.5');
    await page.locator('.settings-panel').getByText('Saving model…', { exact: true }).waitFor({ state: 'visible', timeout: 1000 });
    await captureCodexSettingsState('applying');
    const firstModelControl = mutations.filter(message => message.session_id === 'skin-codex' && message.model_id).at(-1);
    fixtureSocket.send(JSON.stringify({
      type: 'agent_control_result', session_id: 'skin-codex', request_id: firstModelControl.request_id,
      command: 'set_codex_config', result: 'failed', error: { code: 'fixture_rejected', message: 'Fixture rejected model change.' },
    }));
    await page.locator('.settings-error').getByText('Fixture rejected model change.', { exact: true }).waitFor({ state: 'visible', timeout: 1000 });
    await captureCodexSettingsState('failed');

    await modelSelect.selectOption('gpt-5.5');
    await page.waitForFunction(() => document.querySelector('.settings-panel')?.innerText.includes('Saving model…'));
    const secondModelControl = mutations.filter(message => message.session_id === 'skin-codex' && message.model_id).at(-1);
    assert.notEqual(secondModelControl.request_id, firstModelControl.request_id);
    configs['skin-codex'] = {
      ...configs['skin-codex'],
      model_id: 'gpt-5.5',
      source_revision: 'codex-fixture-revision-2',
    };
    fixtureSocket.send(JSON.stringify({ type: 'agent_config', session_id: 'skin-codex', ...configs['skin-codex'] }));
    fixtureSocket.send(JSON.stringify({
      type: 'agent_control_result', session_id: 'skin-codex', request_id: secondModelControl.request_id,
      command: 'set_codex_config', result: 'ok', details: { field: 'model_id', value: 'gpt-5.5' },
    }));
    await page.locator('.settings-panel .settings-row')
      .filter({ hasText: 'Next turn model' })
      .locator('.settings-inline-ok')
      .getByText('Saved', { exact: true })
      .waitFor({ state: 'visible', timeout: 1000 });
    await captureCodexSettingsState('saved');

    configs['skin-codex'] = {
      ...configs['skin-codex'],
      controls_available: false,
      controls_unavailable_reason: 'Available when this turn finishes.',
    };
    fixtureSocket.send(JSON.stringify({ type: 'agent_config', session_id: 'skin-codex', ...configs['skin-codex'] }));
    await page.getByText('Available when this turn finishes.', { exact: true }).waitFor({ state: 'visible', timeout: 1000 });
    await captureCodexSettingsState('active-disabled');
    configs['skin-codex'] = { ...configs['skin-codex'], controls_available: true, controls_unavailable_reason: null };
    fixtureSocket.send(JSON.stringify({ type: 'agent_config', session_id: 'skin-codex', ...configs['skin-codex'] }));
    await page.waitForFunction(() => !document.body.innerText.includes('Available when this turn finishes.'));

    const permissionSelect = page.locator('.settings-panel .settings-row').filter({ hasText: 'Next turn permissions' }).locator('select');
    await permissionSelect.selectOption('full-access');
    await page.waitForTimeout(100);
    if (await page.locator('.settings-bypass-confirmation').count() === 0) {
      throw new Error(`bypass confirmation did not render; select=${await permissionSelect.inputValue()}; panel=${await page.locator('.settings-panel').innerText()}`);
    }
    const bypassCopy = await page.locator('.settings-bypass-confirmation').innerText();
    assert(bypassCopy.includes('approval policy to Never'));
    assert(bypassCopy.includes('danger-full-access'));
    await captureCodexSettingsState('bypass-confirmation');
    if (outputPath) {
      const screenshot = path.join(path.dirname(outputPath), 'skin-codex-bypass-confirmation.png');
      await page.locator('.settings-panel').screenshot({ path: screenshot, animations: 'disabled' });
      screenshots.push(path.relative(root, screenshot));
    }
    await page.getByRole('button', { name: 'Enable Full access', exact: true }).click();
    await page.waitForTimeout(50);
    const controlsSent = clientMessages.filter(message => CONTROL_TYPES.includes(message.type));
    assert.strictEqual(controlsSent.length, 6, `expected six fixture controls, received ${controlsSent.length}; controls: ${JSON.stringify(controlsSent)}; client types: ${clientMessages.map(message => message.type).join(', ')}`);
    const bypassControl = controlsSent.find(message => message.session_id === 'skin-codex' && message.permission_profile === 'full-access');
    assert.deepStrictEqual({
      permission_profile: bypassControl?.permission_profile,
      confirm_bypass: bypassControl?.confirm_bypass,
      source_revision: bypassControl?.source_revision,
    }, {
      permission_profile: 'full-access',
      confirm_bypass: true,
      source_revision: 'codex-fixture-revision-2',
    });
    await page.locator('.settings-panel .settings-panel-close').click();
    assert.strictEqual(clientMessages.filter(message => message.type === 'agent_message').length, 0);

    await page.setViewportSize({ width: 390, height: 844 });
    const gear = page.locator('.input-area .composer-gear-btn[title="Toggle settings"]');
    await gear.evaluate(node => node.click());
    await page.locator('.composer-settings.is-open').waitFor({ state: 'visible', timeout: 3000 });
    const mobileBounds = await page.locator('.input-area').evaluate(node => {
      const rect = node.getBoundingClientRect();
      return { width: Math.round(rect.width), viewport_width: innerWidth, right: Math.round(rect.right) };
    });
    assert(mobileBounds.right <= mobileBounds.viewport_width, 'mobile composer overflows the viewport');
    if (originalViewport) await page.setViewportSize(originalViewport);

    const result = {
      ok: true,
      generated_at: new Date().toISOString(),
      browser_cdp: cdpUrl,
      browser_mode: headlessFallback ? 'owned_headless_fallback' : 'persistent_cdp',
      persistent_browser_pages: pages.length,
      skins: Object.fromEntries(Object.entries(expected).map(([id, value]) => [id, value.skin])),
      geometry,
      settings_visuals: settingsVisuals,
      functional_fixture_controls: controlsSent.map(message => ({ session_id: message.session_id, command: message.type })),
      mobile_390: mobileBounds,
      user_messages_sent: 0,
      visible_windows_opened: 0,
      external_focus_actions: 0,
      screenshots,
    };
    if (outputPath) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    }
    console.log(JSON.stringify(result, null, 2));
  } finally {
    if (page && originalViewport) await page.setViewportSize(originalViewport).catch(() => {});
    if (page && originalUrl) await page.goto(originalUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    if (browser) await browser.close().catch(() => {});
    for (const ws of wss.clients) ws.terminate();
    await new Promise(resolve => wss.close(resolve));
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
