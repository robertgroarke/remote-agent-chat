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
const cdpUrl = process.env.RAC_VERIFICATION_BROWSER_CDP || 'http://127.0.0.1:9240';

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

async function main() {
  const localWorker = fs.readFileSync(path.join(ROOT, 'frontend', 'sw.js'), 'utf8');
  const assetVersion = localWorker.match(/const ASSET_VERSION = '([^']+)'/)?.[1];
  assert(assetVersion, 'local service worker is missing ASSET_VERSION');
  const localStyles = fs.readFileSync(path.join(ROOT, 'frontend', 'styles.css'));
  const localStylesSha256 = sha256(localStyles);

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
      }));
    const before = await samplePageState();
    const nonce = Date.now();
    const [workerResponse, stylesResponse] = await Promise.all([
      page.request.get(new URL(`/sw.js?cursor_notice_verify=${nonce}`, beforeUrl).href),
      page.request.get(new URL(`/styles.css?v=${encodeURIComponent(assetVersion)}&cursor_notice_verify=${nonce}`, beforeUrl).href),
    ]);
    const workerText = await workerResponse.text();
    const styleBytes = await stylesResponse.body();
    const styleText = styleBytes.toString('utf8');
    const after = await samplePageState();
    const state = {
      before,
      after,
      worker_status: workerResponse.status(),
      worker_asset_version: (workerText.match(/const ASSET_VERSION = '([^']+)'/) || [])[1] || '',
      styles_status: stylesResponse.status(),
      styles_bytes: styleBytes.byteLength,
      styles_sha256: sha256(styleBytes),
      markers: {
        cursor_notice_selector: styleText.includes('.harness-theme-cursor .content-block-notice {'),
        compact_border: styleText.includes('border: 1px solid #2d2d30;'),
        compact_background: styleText.includes('background: #252526;'),
        info_icon: styleText.includes('content: "\\24D8";'),
        shared_notice_preserved: styleText.includes('border-left-color: rgba(219, 171, 9, 0.65);'),
        light_adaptive_notice: styleText.includes(':root[data-theme="light"] .harness-theme-cursor .content-block-notice {'),
      },
    };

    assert.strictEqual(page.url(), beforeUrl, 'verification page navigated');
    assert.strictEqual(state.before.url, state.after.url, 'browser URL changed during passive verification');
    assert.strictEqual(state.before.active_agent_type, state.after.active_agent_type,
      'selected session changed during passive verification');
    assert.strictEqual(state.worker_status, 200, 'served service worker request failed');
    assert.strictEqual(state.styles_status, 200, 'served stylesheet request failed');
    assert.strictEqual(state.worker_asset_version, assetVersion, 'served asset version is stale');
    assert.strictEqual(state.styles_sha256, localStylesSha256, 'served stylesheet differs from exact source');
    assert(Object.values(state.markers).every(Boolean), 'served Cursor notice stylesheet markers are incomplete');

    const result = {
      ok: true,
      generated_at: new Date().toISOString(),
      cdp: cdpUrl,
      pages: pages.length,
      exact_source_commit: require('child_process').execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: ROOT,
        encoding: 'utf8',
        windowsHide: true,
      }).trim(),
      expected_asset_version: assetVersion,
      served_asset_version: state.worker_asset_version,
      stylesheet: {
        bytes: state.styles_bytes,
        sha256: state.styles_sha256,
        exact_source_match: true,
        markers: state.markers,
      },
      page: {
        url_unchanged: true,
        selected_agent_before: state.before.active_agent_type,
        selected_agent_after: state.after.active_agent_type,
        loaded_asset_version_before: state.before.loaded_asset_version,
        loaded_asset_version_after: state.after.loaded_asset_version,
        visibility_before: state.before.visibility,
        visibility_after: state.after.visibility,
        has_focus_before: state.before.has_focus,
        has_focus_after: state.after.has_focus,
      },
      automation: {
        page_navigations: 0,
        page_reloads: 0,
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
  console.error(`Cursor native notice production E2E: FAIL (${error.stack || error.message || error})`);
  process.exit(1);
});
