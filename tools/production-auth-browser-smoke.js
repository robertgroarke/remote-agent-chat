#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const CDP = require('../agent-proxy/node_modules/chrome-remote-interface');
const fidelity = require('./run-fidelity-regression');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
const outputPath = outputIndex >= 0 && args[outputIndex + 1]
  ? path.resolve(args[outputIndex + 1]) : null;
const cdp = process.env.RAC_VERIFICATION_BROWSER_CDP || 'http://127.0.0.1:9240';

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

(async () => {
  const relayEnv = fidelity.loadEnvFile(path.join(ROOT, 'relay-server', '.env'));
  const publicUrl = String(relayEnv.PUBLIC_URL || '').replace(/\/+$/, '');
  assert(publicUrl, 'relay-server/.env PUBLIC_URL is required');
  const publicOrigin = new URL(publicUrl).origin;
  const endpoint = new URL(cdp);
  const port = Number(endpoint.port || 9240);
  const pages = (await CDP.List({ host: endpoint.hostname, port }))
    .filter(target => target.type === 'page');
  assert.strictEqual(pages.length, 1,
    `expected one persistent verification page, found ${pages.length}`);

  const client = await CDP({ host: endpoint.hostname, port, target: pages[0].id });
  try {
    await Promise.all([client.Page.enable(), client.Runtime.enable()]);
    const current = await client.Runtime.evaluate({
      expression: 'location.href',
      returnByValue: true,
    });
    if (new URL(String(current?.result?.value || 'about:blank')).origin !== publicOrigin) {
      await client.Runtime.evaluate({
        expression: `location.replace(${JSON.stringify(publicUrl + '/?auth_browser_smoke=' + Date.now())})`,
        returnByValue: true,
      });
      await wait(1500);
    }

    const unauthenticated = await client.Runtime.evaluate({
      expression: `(async () => {
        const response = await fetch('/?auth_browser_smoke_unauth=' + Date.now(), {
          credentials: 'omit',
          cache: 'no-store',
          redirect: 'manual'
        });
        return { status: response.status, type: response.type, redirected: response.redirected };
      })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    const unauth = unauthenticated?.result?.value;
    assert(unauth && unauth.status === 0 && unauth.type === 'opaqueredirect',
      `credential-free browser request did not enter a redirect: ${JSON.stringify(unauth)}`);

    await client.Page.reload({ ignoreCache: true });
    let snapshot = null;
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      await wait(250);
      try {
        const evaluated = await client.Runtime.evaluate({
          expression: `(() => ({
            origin: location.origin,
            href: location.href,
            title: document.title,
            root_present: !!document.querySelector('#root'),
            root_child_count: document.querySelector('#root')?.childElementCount || 0,
            session_card_count: document.querySelectorAll('.session-card').length,
            unauthorized_json_visible: document.body?.innerText?.trim() === '{"error":"unauthorized"}'
          }))()`,
          returnByValue: true,
        });
        snapshot = evaluated?.result?.value;
        if (snapshot?.origin === publicOrigin && snapshot.root_child_count > 0
            && snapshot.session_card_count > 0) break;
      } catch {}
    }
    assert(snapshot?.origin === publicOrigin, 'persistent browser is not on the production origin');
    assert(snapshot.root_present && snapshot.root_child_count > 0,
      'authenticated production browser did not mount the app root');
    assert(snapshot.session_card_count > 0,
      'authenticated production browser did not load the session inventory');
    assert.strictEqual(snapshot.unauthorized_json_visible, false,
      'authenticated production browser rendered API-style unauthorized JSON');

    const result = {
      ok: true,
      cdp,
      public_origin: publicOrigin,
      pages: pages.length,
      reused_existing_page: true,
      headless_or_preexisting_browser_only: true,
      unauthenticated_browser_request: {
        credentials: 'omit',
        response_type: unauth.type,
        redirect_observed: true,
      },
      authenticated_browser_load: {
        app_root: true,
        root_child_count: snapshot.root_child_count,
        session_card_count: snapshot.session_card_count,
        unauthorized_json_visible: false,
        title: snapshot.title,
      },
      page_reloads: 1,
      focus_actions: 0,
      visible_windows_opened: 0,
      generated_at: new Date().toISOString(),
    };
    const serialized = JSON.stringify(result, null, 2) + '\n';
    if (outputPath) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, serialized, 'utf8');
    }
    process.stdout.write(serialized);
  } finally {
    await client.close().catch(() => {});
  }
})().catch(error => {
  console.error('production auth browser smoke: FAIL (' + (error.stack || error.message || error) + ')');
  process.exit(1);
});
