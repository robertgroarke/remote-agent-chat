#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { chromium } = require('../frontend/node_modules/playwright-core');
const fidelity = require('./run-fidelity-regression');
const {
  createProductionLoopbackProxy,
  findChrome,
} = require('./mobile-cold-load-production-e2e');

const ROOT = path.resolve(__dirname, '..');
const EXPECTED_LINE = 'const CLAUDE_TOOL_RESULT_MAX_CHARS = 70_000;';

function parseArgs(argv) {
  const options = {
    readOnlyProduction: false,
    sourceRoot: '',
    envRoot: '',
    cliSessionId: '',
    sessionId: '',
    output: '',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--read-only-production') options.readOnlyProduction = true;
    else if (arg === '--source-root') options.sourceRoot = path.resolve(argv[++index] || '');
    else if (arg === '--env-root') options.envRoot = path.resolve(argv[++index] || '');
    else if (arg === '--cli-session-id') options.cliSessionId = String(argv[++index] || '');
    else if (arg === '--session-id') options.sessionId = String(argv[++index] || '');
    else if (arg === '--output') options.output = path.resolve(argv[++index] || '');
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  assert(options.readOnlyProduction, 'Explicit --read-only-production is required');
  assert(options.sourceRoot, '--source-root is required');
  assert(options.envRoot, '--env-root is required');
  assert(/^[0-9a-f-]{36}$/i.test(options.cliSessionId), '--cli-session-id must be a UUID');
  assert(/^[0-9a-f-]{36}$/i.test(options.sessionId), '--session-id must be a UUID');
  assert(options.output, '--output is required');
  const relativeOutput = path.relative(path.join(ROOT, 'evidence'), options.output);
  assert(relativeOutput && !relativeOutput.startsWith(`..${path.sep}`) && !path.isAbsolute(relativeOutput),
    '--output must stay under this checkout evidence tree');
  return options;
}

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

async function waitForApp(page) {
  await page.waitForFunction(() => (
    document.querySelectorAll('.session-card').length > 0
    && /Relay (?:healthy|connected)/.test(document.querySelector('.sidebar-footer')?.textContent || '')
  ), null, { timeout: 45_000 });
}

async function captureLayout(page, label) {
  return page.evaluate(({ label, expectedLine }) => {
    const blocks = [...document.querySelectorAll(
      'details.content-block-tool-result, details.content-block-tool',
    )].map(element => {
      const body = element.querySelector('.content-block-pre');
      const bodyText = body?.textContent || '';
      const rect = element.getBoundingClientRect();
      return {
        summary: element.querySelector('summary')?.textContent?.trim() || '',
        open: element.open,
        body_chars: bodyText.length,
        actual_source_present: bodyText.includes(expectedLine),
        visible: getComputedStyle(element).display !== 'none' && rect.width > 0 && rect.height > 0,
        body_visible: !!body && getComputedStyle(body).display !== 'none' && body.getBoundingClientRect().height > 0,
      };
    });
    return {
      label,
      viewport: { width: innerWidth, height: innerHeight },
      theme: document.documentElement.dataset.theme,
      active_session_id: document.querySelector('.session-card.active')?.dataset.sessionId || '',
      agent_type: document.querySelector('.messages')?.dataset.agentType || '',
      blocks,
    };
  }, { label, expectedLine: EXPECTED_LINE });
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const deployEnv = fidelity.loadEnvFile(path.join(options.envRoot, '.env'));
  const relayEnv = fidelity.loadEnvFile(path.join(options.envRoot, 'relay-server', '.env'));
  const relayIp = deployEnv.RELAY_IP;
  const relayPort = deployEnv.RELAY_PORT || '3500';
  const publicOrigin = new URL(relayEnv.PUBLIC_URL).origin;
  const token = fidelity.buildBearerToken(relayEnv);
  assert(relayIp, 'explicit environment root is missing RELAY_IP');
  assert(token, 'JWT bearer token could not be built from the explicit environment root');
  const upstreamUrl = `http://${relayIp}:${relayPort}`;

  const worker = fs.readFileSync(path.join(options.sourceRoot, 'frontend', 'sw.js'), 'utf8');
  const assetVersion = worker.match(/const ASSET_VERSION = '([^']+)'/)?.[1];
  assert(assetVersion, 'exact source service worker is missing ASSET_VERSION');

  const loopback = await createProductionLoopbackProxy(upstreamUrl, publicOrigin, token);
  const browser = await chromium.launch({
    executablePath: findChrome(),
    headless: true,
    args: ['--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking'],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const response = await page.goto(loopback.url, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    assert.equal(response?.status(), 200, 'production app shell did not load');
    await waitForApp(page);

    const loadedAssetVersion = await page.evaluate(() => ([...document.scripts]
      .map(script => script.src).find(src => src.includes('/dist/bundle.js')) || '')
      .match(/v=(build-[0-9a-f]+)/)?.[1] || '');
    assert.equal(loadedAssetVersion, assetVersion, 'headless Web surface loaded a stale bundle');

    const selector = `.session-card[data-session-id="${options.sessionId}"]`;
    const card = page.locator(selector);
    await card.waitFor({ state: 'attached', timeout: 45_000 });
    assert((await card.getAttribute('title') || '').includes('Read-only production acceptance probe'),
      'production session id does not identify the disposable acceptance probe');
    await card.scrollIntoViewIfNeeded();
    await new Promise(resolve => setTimeout(resolve, 500));
    await card.focus();
    await card.press('Enter');
    await page.waitForFunction(sessionId => (
      document.querySelector('.session-card.active')?.dataset.sessionId === sessionId
    ), options.sessionId, { timeout: 15_000 });
    try {
      await page.waitForFunction(expectedLine => ([...document.querySelectorAll('.content-block-pre')]
        .filter(element => element.textContent.includes(expectedLine)).length >= 2), EXPECTED_LINE,
      { timeout: 90_000 });
    } catch (error) {
      const diagnostics = await page.evaluate(expectedLine => ({
        active_session_id: document.querySelector('.session-card.active')?.dataset.sessionId || '',
        theme: document.documentElement.dataset.theme || '',
        tool_result_blocks: document.querySelectorAll('details.content-block-tool-result, details.content-block-tool').length,
        content_pre_blocks: document.querySelectorAll('.content-block-pre').length,
        matching_content_pre_blocks: [...document.querySelectorAll('.content-block-pre')]
          .filter(element => element.textContent.includes(expectedLine)).length,
        connection_label: document.querySelector('.sidebar-footer-health > span')?.textContent?.trim() || '',
      }), EXPECTED_LINE).catch(() => ({ unavailable: true }));
      throw new Error(`${error.message}; diagnostics=${JSON.stringify(diagnostics)}`);
    }

    const layouts = [];
    layouts.push(await captureLayout(page, 'desktop-dark'));
    await page.locator('.theme-toggle-btn').click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    layouts.push(await captureLayout(page, 'desktop-light'));
    await page.setViewportSize({ width: 390, height: 844 });
    layouts.push(await captureLayout(page, 'mobile-light'));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('.theme-toggle-btn').click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    await page.setViewportSize({ width: 390, height: 844 });
    layouts.push(await captureLayout(page, 'mobile-dark'));

    for (const layout of layouts) {
      assert.equal(layout.active_session_id, options.sessionId, `${layout.label} changed the selected session`);
      assert.equal(layout.agent_type, 'claude_cli', `${layout.label} lost the Claude CLI harness theme`);
      assert.equal(layout.blocks.length, 2, `${layout.label} must render exactly Grep and Read tool results`);
      assert(layout.blocks.every(block => block.open && block.visible && block.body_visible),
        `${layout.label} hid or collapsed a live tool result`);
      assert(layout.blocks.every(block => block.actual_source_present),
        `${layout.label} dropped the actual Grep/Read source body`);
    }
    assert.deepStrictEqual(layouts.map(layout => [layout.viewport.width, layout.theme]), [
      [1440, 'dark'],
      [1440, 'light'],
      [390, 'light'],
      [390, 'dark'],
    ]);

    const result = {
      ok: true,
      generated_at: new Date().toISOString(),
      cli_session_id: options.cliSessionId,
      session_id: options.sessionId,
      source_root: options.sourceRoot,
      asset_version: assetVersion,
      loaded_asset_version: loadedAssetVersion,
      expected_line_sha256: sha256(EXPECTED_LINE),
      layouts,
      safety: {
        disposable_session: true,
        allowed_tools: ['Grep', 'Read'],
        sends_to_protected_sessions: 0,
        protected_session_mutations: 0,
        persistent_browser_connections: 0,
        visible_windows_opened: 0,
      },
    };
    const serialized = `${JSON.stringify(result, null, 2)}\n`;
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, serialized, 'utf8');
    process.stdout.write(serialized);
    return result;
  } finally {
    await browser.close();
    await loopback.close();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Claude CLI live tool-result production E2E: FAIL (${error.stack || error.message})`);
    process.exitCode = 1;
  });
}

module.exports = { captureLayout, main, parseArgs };
