#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { chromium } = require('../frontend/node_modules/playwright-core');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
const outputPath = outputIndex >= 0 && args[outputIndex + 1]
  ? path.resolve(args[outputIndex + 1])
  : null;
const sourceRootIndex = args.indexOf('--source-root');
const sourceRoot = sourceRootIndex >= 0 && args[sourceRootIndex + 1]
  ? path.resolve(args[sourceRootIndex + 1])
  : ROOT;
const reloadPage = args.includes('--reload');
const cdpUrl = process.env.RAC_VERIFICATION_BROWSER_CDP || 'http://127.0.0.1:9240';

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

async function main() {
  const localWorker = fs.readFileSync(path.join(sourceRoot, 'frontend', 'sw.js'), 'utf8');
  const assetVersion = localWorker.match(/const ASSET_VERSION = '([^']+)'/)?.[1];
  assert(assetVersion, 'local service worker is missing ASSET_VERSION');
  const localStyles = fs.readFileSync(path.join(sourceRoot, 'frontend', 'styles.css'));
  const localBundle = fs.readFileSync(path.join(sourceRoot, 'frontend', 'dist', 'bundle.js'));
  const localApp = fs.readFileSync(path.join(sourceRoot, 'frontend', 'app.jsx'));

  const browser = await chromium.connectOverCDP(cdpUrl);
  try {
    const pages = browser.contexts().flatMap(context => context.pages());
    assert.strictEqual(pages.length, 1, `expected exactly one verification page, found ${pages.length}`);
    const page = pages[0];
    const beforeUrl = page.url();
    const samplePageState = () => page.evaluate(() => ({
      url: location.href,
      visibility: document.visibilityState,
      has_focus: document.hasFocus(),
      active_agent_type: document.querySelector('.messages')?.dataset.agentType || '',
      loaded_asset_version: (document.querySelector('link[href*="styles.css?v="]')?.href
        .match(/v=(build-[0-9a-f]+)/) || [])[1] || '',
      antigravity_error_rows: document.querySelectorAll(
        '.harness-theme-antigravity-v2 details.content-block-error-antigravity-v2',
      ).length,
      generic_error_cards: document.querySelectorAll(
        '.harness-theme-antigravity-v2 .content-block-error:not(.content-block-error-antigravity-v2)',
      ).length,
    }));
    const beforeReload = await samplePageState();
    if (reloadPage) {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(expected => (
        (document.querySelector('link[href*="styles.css?v="]')?.href || '').includes(`v=${expected}`)
      ), assetVersion, { timeout: 15000 });
      if (beforeReload.active_agent_type && beforeReload.active_agent_type !== 'default') {
        await page.waitForFunction(expected => (
          (document.querySelector('.messages')?.dataset.agentType || '') === expected
        ), beforeReload.active_agent_type, { timeout: 15000 });
      }
    }
    const before = await samplePageState();
    const nonce = Date.now();
    const [workerResponse, stylesResponse, bundleResponse, appResponse] = await Promise.all([
      page.request.get(new URL(`/sw.js?antigravity_error_verify=${nonce}`, beforeUrl).href),
      page.request.get(new URL(`/styles.css?v=${encodeURIComponent(assetVersion)}&antigravity_error_verify=${nonce}`, beforeUrl).href),
      page.request.get(new URL(`/dist/bundle.js?v=${encodeURIComponent(assetVersion)}&antigravity_error_verify=${nonce}`, beforeUrl).href),
      page.request.get(new URL(`/app.jsx?antigravity_error_verify=${nonce}`, beforeUrl).href),
    ]);
    const workerText = await workerResponse.text();
    const styleBytes = await stylesResponse.body();
    const bundleBytes = await bundleResponse.body();
    const appBytes = await appResponse.body();
    const styleText = styleBytes.toString('utf8');
    const bundleText = bundleBytes.toString('utf8');
    const appText = appBytes.toString('utf8');
    const after = await samplePageState();

    const markers = {
      scoped_flat_disclosure: styleText.includes('.harness-theme-antigravity-v2 details.content-block-error-antigravity-v2 {'),
      red_rail_removed: /content-block-error-antigravity-v2 \{[\s\S]*?border-left: 0;[\s\S]*?padding-left: 0;/.test(styleText),
      collapsed_chevron: styleText.includes('content: "\\203A";'),
      shared_error_rail_preserved: styleText.includes('border-left-color: rgba(248, 81, 73, 0.65);'),
      web_renderer_class: appText.includes('content-block-error-antigravity-v2'),
      web_renderer_collapsed: appText.includes('defaultOpen={false}'),
      bundle_renderer_class: bundleText.includes('content-block-error-antigravity-v2'),
      bundle_agent_gate: bundleText.includes('antigravity-v2'),
    };

    assert.strictEqual(page.url(), beforeUrl, 'verification page navigated');
    assert.deepStrictEqual(after, before, 'passive production audit changed page state');
    if (reloadPage) {
      assert.strictEqual(before.loaded_asset_version, assetVersion, 'reloaded page did not activate exact asset version');
      assert.strictEqual(before.active_agent_type, beforeReload.active_agent_type,
        'controlled reload changed the selected session');
    }
    assert.strictEqual(workerResponse.status(), 200, 'served service worker request failed');
    assert.strictEqual(stylesResponse.status(), 200, 'served stylesheet request failed');
    assert.strictEqual(bundleResponse.status(), 200, 'served bundle request failed');
    assert.strictEqual(appResponse.status(), 200, 'served source request failed');
    assert.strictEqual((workerText.match(/const ASSET_VERSION = '([^']+)'/) || [])[1], assetVersion,
      'served asset version is stale');
    assert.strictEqual(sha256(styleBytes), sha256(localStyles), 'served stylesheet differs from exact source');
    assert.strictEqual(sha256(bundleBytes), sha256(localBundle), 'served bundle differs from exact source');
    assert.strictEqual(sha256(appBytes), sha256(localApp), 'served app source differs from exact source');
    assert(Object.values(markers).every(Boolean), 'served Antigravity error markers are incomplete');

    const result = {
      ok: true,
      generated_at: new Date().toISOString(),
      source_root: sourceRoot,
      exact_source_commit: require('child_process').execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: sourceRoot,
        encoding: 'utf8',
        windowsHide: true,
      }).trim(),
      expected_asset_version: assetVersion,
      served_asset_version: (workerText.match(/const ASSET_VERSION = '([^']+)'/) || [])[1] || '',
      assets: {
        styles: { status: stylesResponse.status(), bytes: styleBytes.length, sha256: sha256(styleBytes), exact_source_match: true },
        bundle: { status: bundleResponse.status(), bytes: bundleBytes.length, sha256: sha256(bundleBytes), exact_source_match: true },
        app: { status: appResponse.status(), bytes: appBytes.length, sha256: sha256(appBytes), exact_source_match: true },
        markers,
      },
      page: {
        pages: pages.length,
        url_unchanged: true,
        selected_agent_before_reload: beforeReload.active_agent_type,
        selected_agent_before: before.active_agent_type,
        selected_agent_after: after.active_agent_type,
        loaded_asset_version_before_reload: beforeReload.loaded_asset_version,
        loaded_asset_version_before: before.loaded_asset_version,
        loaded_asset_version_after: after.loaded_asset_version,
        visibility_before: before.visibility,
        visibility_after: after.visibility,
        has_focus_before: before.has_focus,
        has_focus_after: after.has_focus,
        antigravity_error_rows: before.antigravity_error_rows,
        generic_error_cards: before.generic_error_cards,
      },
      automation: {
        page_navigations: 0,
        page_reloads: reloadPage ? 1 : 0,
        session_selections: 0,
        focus_actions: 0,
        sends: 0,
        controls: 0,
        dom_mutations: 0,
        visible_windows_opened: 0,
      },
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
  console.error(`Antigravity v2 native error production E2E: FAIL (${error.stack || error.message || error})`);
  process.exit(1);
});
