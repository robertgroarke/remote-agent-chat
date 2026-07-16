#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('../frontend/node_modules/playwright-core');
const fidelity = require('./run-fidelity-regression');

const ROOT = path.resolve(__dirname, '..');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const canonicalTextBytes = bytes => Buffer.from(Buffer.from(bytes).toString('utf8').replace(/\r\n/g, '\n'), 'utf8');

function parseArgs(argv) {
  const options = { readOnlyProduction: false, envRoot: '', output: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--read-only-production') options.readOnlyProduction = true;
    else if (arg === '--env-root') options.envRoot = path.resolve(argv[++index] || '');
    else if (arg === '--output') options.output = path.resolve(argv[++index] || '');
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  assert(options.readOnlyProduction, 'Explicit --read-only-production is required');
  assert(options.envRoot, '--env-root is required');
  assert(options.output, '--output is required');
  const relative = path.relative(path.join(ROOT, 'evidence'), options.output);
  assert(relative && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
    '--output must stay under this checkout evidence tree');
  return options;
}

function cssRuleBody(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`))?.[1] || '';
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const cdpUrl = process.env.RAC_VERIFICATION_BROWSER_CDP || 'http://127.0.0.1:9240';
  const localWorker = fs.readFileSync(path.join(ROOT, 'frontend', 'sw.js'), 'utf8');
  const assetVersion = localWorker.match(/const ASSET_VERSION = '([^']+)'/)?.[1];
  assert(assetVersion, 'local service worker is missing ASSET_VERSION');
  const localStyles = fs.readFileSync(path.join(ROOT, 'frontend', 'styles.css'));
  const localStylesCanonicalSha256 = sha256(canonicalTextBytes(localStyles));
  const relayEnv = fidelity.loadEnvFile(path.join(options.envRoot, 'relay-server', '.env'));
  const token = fidelity.buildBearerToken(relayEnv);
  assert(token, 'JWT bearer token could not be built from the explicit environment root');

  const browser = await chromium.connectOverCDP(cdpUrl);
  try {
    const pages = browser.contexts().flatMap(context => context.pages());
    assert.equal(pages.length, 1, `expected exactly one verification page, found ${pages.length}`);
    const page = pages[0];
    const beforeUrl = page.url();
    assert(/^https?:/i.test(beforeUrl), 'the sole verification page is not on an HTTP origin');
    const samplePageState = () => page.evaluate(() => ({
      url: location.href,
      visibility: document.visibilityState,
      has_focus: document.hasFocus(),
      active_agent_type: document.querySelector('.messages')?.dataset.agentType || '',
      selected_session: document.querySelector('.session-card.active')?.dataset.sessionId || '',
      loaded_asset_version: (document.querySelector('link[href*="styles.css?v="]')?.href
        .match(/v=(build-[0-9a-f]+)/) || [])[1] || '',
    }));
    const before = await samplePageState();
    const requestOptions = {
      headers: {
        Authorization: `Bearer ${token}`,
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
      maxRedirects: 0,
    };
    const nonce = Date.now();
    const [workerResponse, stylesResponse] = await Promise.all([
      page.request.get(new URL(`/sw.js?claude_cli_native_verify=${nonce}`, beforeUrl).href, requestOptions),
      page.request.get(new URL(`/styles.css?v=${encodeURIComponent(assetVersion)}&claude_cli_native_verify=${nonce}`, beforeUrl).href, requestOptions),
    ]);
    const workerText = await workerResponse.text();
    const styleBytes = await stylesResponse.body();
    const styleText = styleBytes.toString('utf8');
    const after = await samplePageState();

    const thinkingSelector = ':root[data-theme="dark"] .harness-theme-claude_cli details.content-block-thinking';
    const summarySelector = `${thinkingSelector} > summary`;
    const glyphSelector = `${summarySelector}::before`;
    const reasoningSelector = `${thinkingSelector} .message-body`;
    const thinkingRule = cssRuleBody(styleText, thinkingSelector);
    const summaryRule = cssRuleBody(styleText, summarySelector);
    const glyphRule = cssRuleBody(styleText, glyphSelector);
    const reasoningRule = cssRuleBody(styleText, reasoningSelector);
    const markers = {
      unboxed_thinking: /border-left:\s*0;/.test(thinkingRule) && /padding-left:\s*0;/.test(thinkingRule),
      ordinary_terminal_text: /color:\s*var\(--harness-text\);/.test(thinkingRule) && /font-style:\s*normal;/.test(thinkingRule),
      native_orange_summary: /color:\s*#d97757;/.test(summaryRule),
      native_marker_removed: /list-style:\s*none;/.test(summaryRule),
      native_activity_glyph: /content:\s*"\\273B\\00A0";/.test(glyphRule),
      retained_reasoning_italic: /font-style:\s*italic;/.test(reasoningRule),
    };

    assert.equal(page.url(), beforeUrl, 'verification page navigated');
    assert.equal(before.url, after.url, 'browser URL changed during passive verification');
    assert.equal(before.active_agent_type, after.active_agent_type, 'selected agent changed during passive verification');
    assert.equal(before.selected_session, after.selected_session, 'selected session changed during passive verification');
    assert.equal(workerResponse.status(), 200, 'served service-worker request failed');
    assert.equal(stylesResponse.status(), 200, 'served stylesheet request failed');
    assert.equal((workerText.match(/const ASSET_VERSION = '([^']+)'/) || [])[1] || '', assetVersion,
      'served asset version is stale');
    assert.equal(sha256(canonicalTextBytes(styleBytes)), localStylesCanonicalSha256,
      'served stylesheet differs semantically from exact source');
    assert(Object.values(markers).every(Boolean), 'served Claude CLI thinking stylesheet markers are incomplete');

    const result = {
      ok: true,
      generated_at: new Date().toISOString(),
      cdp: cdpUrl,
      pages: pages.length,
      exact_source_commit: execFileSync('git', ['rev-parse', 'HEAD'], {
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
        local_canonical_sha256: localStylesCanonicalSha256,
        exact_source_match: true,
        markers,
      },
      page: {
        url_unchanged: true,
        selected_agent_before: before.active_agent_type,
        selected_agent_after: after.active_agent_type,
        selected_session_unchanged: before.selected_session === after.selected_session,
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
    console.error(`Claude CLI native conversation production E2E: FAIL (${error.stack || error.message || error})`);
    process.exit(1);
  });
}

module.exports = { cssRuleBody, main, parseArgs };
