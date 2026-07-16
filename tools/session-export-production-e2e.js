#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('../frontend/node_modules/playwright-core');
const fidelity = require('./run-fidelity-regression');
const soak = require('./production-harness-overnight-soak');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
const outputPath = outputIndex >= 0 && args[outputIndex + 1] ? path.resolve(args[outputIndex + 1]) : null;
const cdpUrl = process.env.RAC_VERIFICATION_BROWSER_CDP || 'http://127.0.0.1:9240';

function headers(publicUrl, token) {
  return {
    Host: new URL(publicUrl).host,
    'X-Forwarded-For': '203.0.113.10',
    'X-Forwarded-Proto': 'https',
    Authorization: `Bearer ${token}`,
  };
}

async function readResponse(response) {
  return {
    status: response.status,
    contentType: response.headers.get('content-type') || '',
    disposition: response.headers.get('content-disposition') || '',
    cacheControl: response.headers.get('cache-control') || '',
    body: await response.text(),
  };
}

async function downloadText(page, name, downloadRoot) {
  const button = page.getByRole('button', { name });
  await button.waitFor({ state: 'visible', timeout: 10_000 });
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    button.evaluate(element => element.click()),
  ]);
  const failure = await download.failure();
  assert.equal(failure, null, `${name} browser download failed: ${failure}`);
  const suggestedFilename = download.suggestedFilename();
  const deadline = Date.now() + 30_000;
  let completedPath = null;
  while (Date.now() < deadline) {
    const candidate = path.join(downloadRoot, suggestedFilename);
    if (fs.existsSync(candidate) && !fs.existsSync(`${candidate}.crdownload`)) {
      completedPath = candidate;
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert(completedPath, `${name} browser download did not write a completed file`);
  return {
    filename: suggestedFilename,
    body: fs.readFileSync(completedPath, 'utf8'),
  };
}

async function openManageSession(page, sessionId = null) {
  const exportButton = page.getByRole('button', { name: 'Download Markdown' });
  if (!await exportButton.isVisible().catch(() => false)) {
    const manageButton = page.getByRole('button', { name: 'Manage sessions' });
    if (!await manageButton.isVisible().catch(() => false)) {
      await page.locator('.hamburger').click();
      await manageButton.waitFor({ state: 'visible', timeout: 5_000 });
    }
    await manageButton.click();
    await page.getByText('Manage sessions', { exact: true }).waitFor({ state: 'visible', timeout: 5_000 });
  }
  const select = page.locator('.session-management-field select').first();
  if (sessionId) await select.selectOption(sessionId);
  return select;
}

async function main() {
  const deployEnv = fidelity.loadEnvFile(path.join(ROOT, '.env'));
  const relayEnv = fidelity.loadEnvFile(path.join(ROOT, 'relay-server', '.env'));
  const publicUrl = String(relayEnv.PUBLIC_URL || '').replace(/\/+$/, '');
  const origin = `http://${deployEnv.RELAY_IP}:${deployEnv.RELAY_PORT || '3500'}`;
  const token = fidelity.buildBearerToken(relayEnv);
  assert(publicUrl && deployEnv.RELAY_IP && token, 'production URL, relay IP, and bearer token are required');

  const releaseOperation = soak.acquirePidLock(
    soak.OPERATION_LOCK_PATH,
    'Remote Agent Chat production operation lock',
    `${JSON.stringify({
      pid: process.pid,
      acquired_at: new Date().toISOString(),
      agent: 'session-export-production-e2e',
      kind: 'production-browser-e2e',
    })}\n`,
  );
  const browser = await chromium.connectOverCDP(cdpUrl);
  let downloadRoot = null;
  let cdp = null;
  try {
    const pages = browser.contexts().flatMap(context => context.pages());
    assert.equal(pages.length, 1, `expected one persistent verification page, found ${pages.length}`);
    const page = pages[0];
    downloadRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-session-export-production-'));
    cdp = await page.context().newCDPSession(page);
    await cdp.send('Browser.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: downloadRoot,
      eventsEnabled: true,
    });
    await page.goto(publicUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    assert.equal(await page.locator('#root').count(), 1, 'persistent browser is not authenticated to the app');

    const sessionSelect = await openManageSession(page);
    const selectedSessionId = await sessionSelect.inputValue();
    assert(selectedSessionId, 'session export menu did not select a session');

    const endpoint = `${origin}/api/sessions/${encodeURIComponent(selectedSessionId)}/export`;
    const requestHeaders = headers(publicUrl, token);
    const jsonResponse = await readResponse(await fetch(`${endpoint}?format=json`, { headers: requestHeaders, cache: 'no-store' }));
    assert.equal(jsonResponse.status, 200, `production JSON export failed: ${jsonResponse.status}`);
    assert.match(jsonResponse.contentType, /^application\/json/);
    assert.match(jsonResponse.disposition, /attachment; filename\*=UTF-8''/);
    assert.match(jsonResponse.cacheControl, /private/);
    assert.match(jsonResponse.cacheControl, /no-store/);
    const json = JSON.parse(jsonResponse.body);
    assert.equal(json.schema_version, 1);
    assert.equal(json.session.session_id, selectedSessionId);
    assert(Array.isArray(json.messages), 'production JSON export omitted messages');

    const markdownResponse = await readResponse(await fetch(`${endpoint}?format=markdown`, { headers: requestHeaders, cache: 'no-store' }));
    assert.equal(markdownResponse.status, 200, `production Markdown export failed: ${markdownResponse.status}`);
    assert.match(markdownResponse.contentType, /^text\/markdown/);
    assert(markdownResponse.body.includes(`Messages: ${json.messages.length}`), 'Markdown/JSON message counts differ');
    assert(markdownResponse.body.includes(`Session: \`${selectedSessionId}\``), 'Markdown export identifies the wrong session');

    const invalidResponse = await fetch(`${endpoint}?format=xml`, { headers: requestHeaders, cache: 'no-store' });
    assert.equal(invalidResponse.status, 400, 'production export must reject unsupported formats');
    const anonymousResponse = await fetch(`${endpoint}?format=json`, { cache: 'no-store' });
    assert.equal(anonymousResponse.status, 401, 'production export must reject anonymous API access');

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 20_000 });
    assert.equal(await page.locator('#root').count(), 1, 'persistent app did not survive in-place reload');
    await openManageSession(page, selectedSessionId);
    const markdownDownload = await downloadText(page, 'Download Markdown', downloadRoot);
    await openManageSession(page, selectedSessionId);
    const jsonDownload = await downloadText(page, 'Download JSON', downloadRoot);
    assert(markdownDownload.filename.endsWith('.md'));
    assert(jsonDownload.filename.endsWith('.json'));
    const markdownSessionLine = markdownDownload.body.split(/\r?\n/).find(line => line.startsWith('- Session:')) || '';
    assert.equal(
      markdownSessionLine,
      `- Session: \`${selectedSessionId}\``,
      `browser Markdown download identifies the wrong session: ${markdownSessionLine}`,
    );
    assert(
      markdownDownload.body.includes(`Messages: ${json.messages.length}`),
      'browser Markdown download has the wrong message count',
    );
    const downloadedJson = JSON.parse(jsonDownload.body);
    assert.equal(downloadedJson.session.session_id, selectedSessionId);
    assert.equal(downloadedJson.messages.length, json.messages.length);
    assert.deepEqual(downloadedJson.messages, json.messages);
    await page.locator('.session-management-panel .settings-panel-close').click();

    const canonicalBlocks = json.messages.reduce((total, message) => (
      total + (Array.isArray(message.content_blocks) ? message.content_blocks.length : 0)
    ), 0);
    const result = {
      ok: true,
      source_commit: 'f421b3a3d1a3e037ea873f15223f5cced1a58498',
      public_origin: new URL(publicUrl).origin,
      session_id_sha256: crypto.createHash('sha256').update(selectedSessionId).digest('hex'),
      messages: json.messages.length,
      canonical_blocks_observed: canonicalBlocks,
      formats: ['markdown', 'json'],
      browser_downloads: 2,
      api_and_browser_payloads_match: true,
      unsupported_format_status: invalidResponse.status,
      anonymous_status: anonymousResponse.status,
      authenticated_persistent_pages: pages.length,
      production_sends: 0,
      production_controls: 0,
      visible_windows_opened: 0,
      protected_user_apps_touched: 0,
      generated_at: new Date().toISOString(),
    };
    const serialized = `${JSON.stringify(result, null, 2)}\n`;
    if (outputPath) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, serialized, 'utf8');
    }
    process.stdout.write(serialized);
  } finally {
    await cdp?.detach().catch(() => {});
    await browser.close().catch(() => {});
    if (downloadRoot) {
      const resolved = path.resolve(downloadRoot);
      assert(resolved.startsWith(path.resolve(os.tmpdir(), 'rac-session-export-production-')));
      fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
    releaseOperation();
  }
}

main().catch(error => {
  console.error(`session export production e2e: FAIL (${error.stack || error.message || error})`);
  process.exit(1);
});
