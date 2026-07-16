#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('../frontend/node_modules/playwright-core');
const fidelity = require('./run-fidelity-regression');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
const outputPath = outputIndex >= 0 && args[outputIndex + 1]
  ? path.resolve(args[outputIndex + 1])
  : null;
const cdpUrl = process.env.RAC_VERIFICATION_BROWSER_CDP || 'http://127.0.0.1:9240';

async function main() {
  const deployEnv = fidelity.loadEnvFile(path.join(ROOT, '.env'));
  const relayEnv = fidelity.loadEnvFile(path.join(ROOT, 'relay-server', '.env'));
  const relayIp = deployEnv.RELAY_IP;
  const relayPort = deployEnv.RELAY_PORT || '3500';
  const token = fidelity.buildBearerToken(relayEnv);
  assert(relayIp, '.env RELAY_IP is required');
  assert(token, 'JWT bearer token could not be built');
  const origin = `http://${relayIp}:${relayPort}`;

  const serviceWorkerSource = fs.readFileSync(path.join(ROOT, 'frontend', 'sw.js'), 'utf8');
  const expectedAsset = serviceWorkerSource.match(/const ASSET_VERSION = '([^']+)'/)?.[1];
  assert(expectedAsset, 'source service worker has no asset identity');

  const browser = await chromium.connectOverCDP(cdpUrl);
  try {
    const pagesBefore = browser.contexts().flatMap(context => context.pages());
    assert.strictEqual(pagesBefore.length, 1,
      `expected exactly one CDP-9240 page, found ${pagesBefore.length}`);
    const page = pagesBefore[0];
    await page.route('**/*', async route => {
      const headers = { ...route.request().headers() };
      if (route.request().resourceType() === 'websocket') {
        delete headers.authorization;
      } else if (new URL(route.request().url()).origin === origin) {
        headers.authorization = `Bearer ${token}`;
      } else {
        delete headers.authorization;
      }
      await route.continue({ headers });
    });
    await page.setExtraHTTPHeaders({});

    const startedAt = Date.now();
    await page.goto(`${origin}/?goal_notification_probe=${Date.now()}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20_000,
    });
    await page.waitForSelector('#root', { timeout: 15_000 });

    const inspected = await page.evaluate(async () => {
      const script = [...document.scripts]
        .map(node => node.src)
        .find(src => src.includes('/dist/bundle.js')) || '';
      const [preferencesResponse, workerResponse, bundleResponse] = await Promise.all([
        fetch('/api/preferences/notifications', { cache: 'no-store' }),
        fetch('/sw.js', { cache: 'no-store' }),
        fetch(script, { cache: 'no-store' }),
      ]);
      const preferencesBody = await preferencesResponse.json();
      const worker = await workerResponse.text();
      const bundle = await bundleResponse.text();
      return {
        url: location.href,
        title: document.title,
        app_shell_visible: /agent sessions/i.test(document.body?.innerText || ''),
        document_has_focus: document.hasFocus(),
        visibility_state: document.visibilityState,
        script,
        session_count: document.querySelectorAll('.session-card').length,
        connection_label: document.querySelector('.sidebar-footer-health > span')?.textContent?.trim() || '',
        preferences_status: preferencesResponse.status,
        preferences: preferencesBody.preferences || {},
        worker_status: workerResponse.status,
        worker_semantic_tag: worker.includes('semantic:${data.dedupe_key}'),
        worker_semantic_renotify_suppressed: worker.includes('renotify: !semanticType'),
        worker_turn_ready_kill_switch: worker.includes("['agent_idle', 'turn_ready']"),
        bundle_status: bundleResponse.status,
        bundle_semantic_event: bundle.includes('semantic_notification'),
        bundle_turn_copy: bundle.includes('Turn finished'),
        bundle_turn_unavailable_copy: bundle.includes('authoritative native turn boundary'),
        bundle_goal_copy: bundle.includes('Goal completed'),
        bundle_attention_copy: bundle.includes('Goal needs attention'),
        bundle_retired_completion_copy: bundle.includes('Session completed'),
      };
    });

    assert.strictEqual(new URL(inspected.url).origin, origin,
      'verification page is not on the deployed relay origin');
    assert(inspected.script.includes(`v=${expectedAsset}`),
      `verification page is not running ${expectedAsset}`);
    assert(inspected.app_shell_visible, 'production app shell is not rendered in the CDP page');
    assert.strictEqual(inspected.preferences_status, 200, 'notification preference read failed');
    for (const category of ['turn_ready', 'goal_completed', 'goal_attention']) {
      assert.strictEqual(typeof inspected.preferences[category], 'boolean',
        `${category} is missing from production preferences`);
    }
    assert.strictEqual(inspected.preferences.turn_ready, false,
      'production turn_ready preference must be forced off while no adapter is authoritative');
    assert.strictEqual(inspected.worker_status, 200, 'service worker fetch failed');
    assert(inspected.worker_semantic_tag, 'service worker lacks semantic dedupe tags');
    assert(inspected.worker_semantic_renotify_suppressed,
      'service worker does not suppress semantic renotify');
    assert(inspected.worker_turn_ready_kill_switch,
      'service worker does not reject legacy/unsupported completion events');
    assert.strictEqual(inspected.bundle_status, 200, 'bundle fetch failed');
    assert(inspected.bundle_semantic_event, 'bundle lacks semantic notification handling');
    assert(inspected.bundle_turn_copy, 'bundle lacks the disabled Turn finished setting');
    assert(inspected.bundle_turn_unavailable_copy, 'bundle does not explain why Turn finished is unavailable');
    assert(inspected.bundle_goal_copy, 'bundle lacks goal-completed copy');
    assert(inspected.bundle_attention_copy, 'bundle lacks goal-attention copy');
    assert.strictEqual(inspected.bundle_retired_completion_copy, false,
      'bundle still contains retired Session completed inference copy');

    const pagesAfter = browser.contexts().flatMap(context => context.pages());
    assert.strictEqual(pagesAfter.length, 1,
      `production probe changed page count to ${pagesAfter.length}`);
    const result = {
      ok: true,
      source_commit: require('child_process').execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: ROOT,
        encoding: 'utf8',
        windowsHide: true,
      }).trim(),
      cdp: cdpUrl,
      page_count_before: pagesBefore.length,
      page_count_after: pagesAfter.length,
      navigation_count: 1,
      focus_actions: 0,
      asset_identity: expectedAsset,
      elapsed_ms: Date.now() - startedAt,
      live_inventory_evidence: 'goal-notification-production-auth.json',
      ...inspected,
      generated_at: new Date().toISOString(),
    };
    const serialized = `${JSON.stringify(result, null, 2)}\n`;
    if (outputPath) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, serialized, 'utf8');
    }
    process.stdout.write(serialized);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch(error => {
  console.error(`goal notification production browser E2E: FAIL (${error.stack || error.message || error})`);
  process.exit(1);
});
