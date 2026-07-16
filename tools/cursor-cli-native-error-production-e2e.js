#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
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
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const canonicalTextBytes = bytes => Buffer.from(Buffer.from(bytes).toString('utf8').replace(/\r\n/g, '\n'), 'utf8');

async function main() {
  const localWorker = fs.readFileSync(path.join(ROOT, 'frontend', 'sw.js'), 'utf8');
  const assetVersion = localWorker.match(/const ASSET_VERSION = '([^']+)'/)?.[1];
  assert(assetVersion, 'local service worker is missing ASSET_VERSION');
  const localStyles = fs.readFileSync(path.join(ROOT, 'frontend', 'styles.css'));
  const localStylesCanonicalSha256 = sha256(canonicalTextBytes(localStyles));
  const relayEnv = fidelity.loadEnvFile(path.join(ROOT, 'relay-server', '.env'));
  const token = fidelity.buildBearerToken(relayEnv);
  assert(token, 'JWT bearer token could not be built');

  const browser = await chromium.connectOverCDP(cdpUrl);
  try {
    const pages = browser.contexts().flatMap(context => context.pages());
    assert.equal(pages.length, 1, `expected exactly one verification page, found ${pages.length}`);
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
    const requestOptions = {
      headers: {
        Authorization: `Bearer ${token}`,
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
      maxRedirects: 0,
    };
    const [workerResponse, stylesResponse] = await Promise.all([
      page.request.get(new URL(`/sw.js?cursor_cli_error_verify=${nonce}`, beforeUrl).href, requestOptions),
      page.request.get(new URL(`/styles.css?v=${encodeURIComponent(assetVersion)}&cursor_cli_error_verify=${nonce}`, beforeUrl).href, requestOptions),
    ]);
    const workerText = await workerResponse.text();
    const styleBytes = await stylesResponse.body();
    const styleText = styleBytes.toString('utf8');
    const after = await samplePageState();
    const markers = {
      cursor_cli_error_selector: styleText.includes('.harness-theme-cursor_cli .content-block-error {'),
      unboxed_border: styleText.includes('border-left: 0;'),
      terminal_text_color: styleText.includes('color: var(--harness-text);'),
      palette_three_warning: styleText.includes('color: #c4a000;'),
      warning_glyph: styleText.includes('content: "\\26A0\\00A0";'),
      transparent_message_body: styleText.includes('.harness-theme-cursor_cli .message.assistant .content-block-error .message-body {'),
      compact_mobile_reflow: styleText.includes('@media (max-width: 520px)')
        && styleText.includes('font-size: 12px;') && styleText.includes('line-height: 18px;'),
      shared_error_rail_preserved: styleText.includes('border-left-color: rgba(248, 81, 73, 0.65);'),
    };

    assert.equal(page.url(), beforeUrl, 'verification page navigated');
    assert.equal(before.url, after.url, 'browser URL changed during passive verification');
    assert.equal(before.active_agent_type, after.active_agent_type,
      'selected session changed during passive verification');
    assert.equal(workerResponse.status(), 200, 'served service worker request failed');
    assert.equal(stylesResponse.status(), 200, 'served stylesheet request failed');
    assert.equal((workerText.match(/const ASSET_VERSION = '([^']+)'/) || [])[1] || '', assetVersion,
      'served asset version is stale');
    assert.equal(sha256(canonicalTextBytes(styleBytes)), localStylesCanonicalSha256,
      'served stylesheet differs semantically from exact source');
    assert(Object.values(markers).every(Boolean), 'served Cursor CLI error stylesheet markers are incomplete');

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
      served_asset_version: assetVersion,
      stylesheet: {
        bytes: styleBytes.byteLength,
        sha256: sha256(styleBytes),
        canonical_sha256: sha256(canonicalTextBytes(styleBytes)),
        exact_source_match: true,
        markers,
      },
      page: {
        url_unchanged: true,
        selected_agent_before: before.active_agent_type,
        selected_agent_after: after.active_agent_type,
        loaded_asset_version_before: before.loaded_asset_version,
        loaded_asset_version_after: after.loaded_asset_version,
        visibility_before: before.visibility,
        visibility_after: after.visibility,
        has_focus_before: before.has_focus,
        has_focus_after: after.has_focus,
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
    return result;
  } finally {
    await browser.close().catch(() => {});
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Cursor CLI native error production E2E: FAIL (${error.stack || error.message || error})`);
    process.exit(1);
  });
}

module.exports = { main };
