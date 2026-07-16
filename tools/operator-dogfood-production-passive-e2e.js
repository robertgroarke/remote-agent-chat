#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const fidelity = require('./run-fidelity-regression');

const ROOT = path.resolve(__dirname, '..');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const canonicalTextBytes = bytes => Buffer.from(Buffer.from(bytes).toString('utf8').replace(/\r\n/g, '\n'), 'utf8');

function parseArgs(argv) {
  const options = { readOnlyProduction: false, envRoot: '', sourceRoot: '', output: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--read-only-production') options.readOnlyProduction = true;
    else if (arg === '--env-root') options.envRoot = path.resolve(argv[++index] || '');
    else if (arg === '--source-root') options.sourceRoot = path.resolve(argv[++index] || '');
    else if (arg === '--output') options.output = path.resolve(argv[++index] || '');
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  assert(options.readOnlyProduction, 'Explicit --read-only-production is required');
  assert(options.envRoot, '--env-root is required');
  assert(options.sourceRoot, '--source-root is required');
  assert(options.output, '--output is required');
  return options;
}

function readRelayInventory(origin, token, WebSocket) {
  return new Promise((resolve, reject) => {
    const wsUrl = origin.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:')
      + `/client-ws?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(wsUrl, { headers: { Origin: 'http://127.0.0.1:3500' } });
    const timer = setTimeout(() => {
      try { ws.terminate(); } catch {}
      reject(new Error('passive production inventory timed out'));
    }, 15_000);
    const finish = (error, value) => {
      clearTimeout(timer);
      try { ws.close(); } catch {}
      if (error) reject(error); else resolve(value);
    };
    ws.once('error', error => finish(error));
    ws.on('open', () => ws.send(JSON.stringify({
      type: 'connection_hello',
      protocol_version: 1,
      peer_role: 'browser',
      client_name: 'operator-dogfood-production-passive-e2e',
    })));
    ws.on('message', raw => {
      let message;
      try { message = JSON.parse(String(raw)); } catch { return; }
      if (message.type !== 'connection_ack') return;
      finish(null, {
        first_message_type: message.type,
        session_count: Array.isArray(message.sessions) ? message.sessions.length : 0,
        duplicate_proxy_alarms: Array.isArray(message.duplicate_proxy_alarms)
          ? message.duplicate_proxy_alarms.length : 0,
      });
    });
  });
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const { chromium } = require(path.join(options.envRoot, 'frontend', 'node_modules', 'playwright-core'));
  const cdpUrl = process.env.RAC_VERIFICATION_BROWSER_CDP || 'http://127.0.0.1:9240';
  const localWorker = fs.readFileSync(path.join(options.sourceRoot, 'frontend', 'sw.js'));
  const localStyles = fs.readFileSync(path.join(options.sourceRoot, 'frontend', 'styles.css'));
  const expectedAssetVersion = localWorker.toString('utf8').match(/const ASSET_VERSION = '([^']+)'/)?.[1];
  assert(expectedAssetVersion, 'exact source service worker is missing ASSET_VERSION');
  const deployEnv = fidelity.loadEnvFile(path.join(options.envRoot, '.env'));
  const relayEnv = fidelity.loadEnvFile(path.join(options.envRoot, 'relay-server', '.env'));
  const token = fidelity.buildBearerToken(relayEnv);
  const relayIp = deployEnv.RELAY_IP;
  const relayPort = deployEnv.RELAY_PORT || '3500';
  assert(relayIp, 'explicit environment root is missing RELAY_IP');
  assert(token, 'JWT bearer token could not be built from the explicit environment root');
  const relayOrigin = `http://${relayIp}:${relayPort}`;
  const WebSocket = require(path.join(options.envRoot, 'relay-server', 'node_modules', 'ws'));

  const browser = await chromium.connectOverCDP(cdpUrl);
  try {
    const pages = browser.contexts().flatMap(context => context.pages());
    assert.equal(pages.length, 1, `expected exactly one persistent verification page, found ${pages.length}`);
    const page = pages[0];
    const beforeUrl = page.url();
    assert(/^https?:/i.test(beforeUrl), 'the sole verification page is not on an HTTP origin');
    const sample = () => page.evaluate(() => ({
      url: location.href,
      visibility: document.visibilityState,
      has_focus: document.hasFocus(),
      active_agent_type: document.querySelector('.messages')?.dataset.agentType || '',
      selected_session: document.querySelector('.session-card.active')?.dataset.sessionId || '',
      loaded_asset_version: ([...document.scripts].map(script => script.src)
        .find(src => src.includes('/dist/bundle.js')) || '').match(/v=(build-[0-9a-f]+)/)?.[1] || '',
      connection_label: document.querySelector('.sidebar-footer-health > span')?.textContent?.trim() || '',
      session_cards: document.querySelectorAll('.session-card').length,
      session_groups: document.querySelectorAll('.session-group').length,
      duplicate_proxy_banners: document.querySelectorAll('.duplicate-proxy-banner').length,
    }));
    const before = await sample();
    const requestOptions = {
      headers: {
        Authorization: `Bearer ${token}`,
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
      maxRedirects: 0,
    };
    const nonce = Date.now();
    const [indexResponse, workerResponse, stylesResponse, inventory] = await Promise.all([
      page.request.get(new URL(`/?operator_dogfood_passive=${nonce}`, beforeUrl).href, requestOptions),
      page.request.get(new URL(`/sw.js?operator_dogfood_passive=${nonce}`, beforeUrl).href, requestOptions),
      page.request.get(new URL(`/styles.css?v=${encodeURIComponent(expectedAssetVersion)}&operator_dogfood_passive=${nonce}`, beforeUrl).href, requestOptions),
      readRelayInventory(relayOrigin, token, WebSocket),
    ]);
    const indexText = await indexResponse.text();
    const workerBytes = await workerResponse.body();
    const stylesBytes = await stylesResponse.body();
    const workerText = workerBytes.toString('utf8');
    const after = await sample();

    assert.equal(indexResponse.status(), 200, 'authenticated app-shell request failed');
    assert(indexText.includes('id="root"'), 'authenticated app shell is missing the root mount');
    assert.equal(workerResponse.status(), 200, 'served service-worker request failed');
    assert.equal(stylesResponse.status(), 200, 'served stylesheet request failed');
    assert.equal((workerText.match(/const ASSET_VERSION = '([^']+)'/) || [])[1] || '', expectedAssetVersion,
      'served asset version differs from exact source');
    assert.equal(sha256(canonicalTextBytes(workerBytes)), sha256(canonicalTextBytes(localWorker)),
      'served service worker differs semantically from exact source');
    assert.equal(sha256(canonicalTextBytes(stylesBytes)), sha256(canonicalTextBytes(localStyles)),
      'served stylesheet differs semantically from exact source');
    assert.equal(page.url(), beforeUrl, 'persistent page navigated');
    assert.equal(after.url, before.url, 'persistent page URL changed');
    assert.equal(after.selected_session, before.selected_session, 'persistent page selection changed');
    assert.equal(after.active_agent_type, before.active_agent_type, 'persistent page agent changed');
    assert.equal(after.visibility, before.visibility, 'persistent page visibility changed');
    assert.equal(after.has_focus, before.has_focus, 'persistent page focus state changed');
    assert(inventory.session_count > 0, 'passive production inventory is empty');
    assert.equal(inventory.duplicate_proxy_alarms, 0, 'passive production inventory has duplicate proxy alarms');

    const result = {
      ok: true,
      generated_at: new Date().toISOString(),
      mode: 'passive_request_context',
      cdp: cdpUrl,
      pages: pages.length,
      source_root: options.sourceRoot,
      expected_asset_version: expectedAssetVersion,
      served_asset_version: expectedAssetVersion,
      assets: {
        app_shell_status: indexResponse.status(),
        service_worker_sha256: sha256(workerBytes),
        stylesheet_sha256: sha256(stylesBytes),
        service_worker_exact_source_match: true,
        stylesheet_exact_source_match: true,
      },
      relay_inventory: inventory,
      page: {
        url_unchanged: true,
        selected_session_unchanged: true,
        active_agent_unchanged: true,
        visibility_unchanged: true,
        focus_state_unchanged: true,
        loaded_asset_version_before: before.loaded_asset_version,
        loaded_asset_version_after: after.loaded_asset_version,
        connection_label_before: before.connection_label,
        connection_label_after: after.connection_label,
        session_cards_before: before.session_cards,
        session_cards_after: after.session_cards,
        session_groups_before: before.session_groups,
        session_groups_after: after.session_groups,
        duplicate_proxy_banners_before: before.duplicate_proxy_banners,
        duplicate_proxy_banners_after: after.duplicate_proxy_banners,
      },
      automation: {
        page_navigations: 0,
        page_reloads: 0,
        focus_actions: 0,
        sends: 0,
        controls: 0,
        dom_mutations: 0,
        visible_windows_opened: 0,
        protected_session_mutations: 0,
      },
    };
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
  } finally {
    await browser.close().catch(() => {});
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Operator dogfood passive production E2E: FAIL (${error.stack || error.message || error})`);
    process.exit(1);
  });
}

module.exports = { main, parseArgs };
