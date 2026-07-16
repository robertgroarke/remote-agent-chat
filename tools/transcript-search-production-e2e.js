#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('../frontend/node_modules/playwright-core');
const fidelity = require('./run-fidelity-regression');
const soak = require('./production-harness-overnight-soak');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
const outputPath = outputIndex >= 0 && args[outputIndex + 1] ? path.resolve(args[outputIndex + 1]) : null;
const cdpUrl = process.env.RAC_VERIFICATION_BROWSER_CDP || 'http://127.0.0.1:9240';

function externalHeaders(publicUrl, token) {
  return {
    Host: new URL(publicUrl).host,
    'X-Forwarded-For': '203.0.113.10',
    'X-Forwarded-Proto': 'https',
    Authorization: `Bearer ${token}`,
  };
}

async function searchJson(origin, headers, params) {
  const response = await fetch(`${origin}/api/search/messages?${params.toString()}`, {
    headers,
    cache: 'no-store',
  });
  const body = await response.json().catch(() => ({}));
  assert.equal(response.status, 200, `production search failed: ${response.status} ${body.error || ''}`);
  return body;
}

async function main() {
  const deployEnv = fidelity.loadEnvFile(path.join(ROOT, '.env'));
  const relayEnv = fidelity.loadEnvFile(path.join(ROOT, 'relay-server', '.env'));
  const publicUrl = String(relayEnv.PUBLIC_URL || '').replace(/\/+$/, '');
  const relayIp = deployEnv.RELAY_IP;
  const relayPort = deployEnv.RELAY_PORT || '3500';
  const token = fidelity.buildBearerToken(relayEnv);
  assert(publicUrl && relayIp && token, 'production relay URL, IP, and bearer token are required');
  const origin = `http://${relayIp}:${relayPort}`;
  const headers = externalHeaders(publicUrl, token);
  const probeQuery = 'HARNESS_MATURITY_PHASE2_BACKLOG';

  const cursorSamples = [];
  const readinessLatencies = [];
  let search;
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    const startedAt = Date.now();
    search = await searchJson(origin, headers, new URLSearchParams({ q: probeQuery, limit: '100' }));
    readinessLatencies.push(Date.now() - startedAt);
    const cursor = Number(search.index?.cursor_id || 0);
    if (cursorSamples.length === 0 || cursorSamples[cursorSamples.length - 1] !== cursor) cursorSamples.push(cursor);
    if (search.index?.ready) break;
    await new Promise(resolve => setTimeout(resolve, 1_000));
  }
  assert.equal(search?.index?.ready, true, `production FTS index did not converge: ${JSON.stringify(search?.index || {})}`);
  assert(Array.isArray(search.results) && search.results.length > 0, 'production FTS query returned no result for the readiness probe');
  const warmSearchLatencies = [];
  for (let sample = 0; sample < 5; sample++) {
    const startedAt = Date.now();
    await searchJson(origin, headers, new URLSearchParams({ q: 'the', limit: '20' }));
    warmSearchLatencies.push(Date.now() - startedAt);
  }
  const orderedWarmLatencies = [...warmSearchLatencies].sort((a, b) => a - b);
  const first = search.results.find(row => (
    (row.workspace_name || row.project_root || row.workspace_path)
    && row.agent_type
    && /^\d{4}-\d{2}-\d{2}$/.test(String(row.matched_at || '').slice(0, 10))
  ));
  assert(first, 'production search results lack a row with scoped-filter metadata');
  const project = first.workspace_name || first.project_root || first.workspace_path;
  const harness = first.agent_type;
  const date = String(first.matched_at || '').slice(0, 10);
  assert(project && harness && /^\d{4}-\d{2}-\d{2}$/.test(date), 'production result lacks scoped-filter metadata');

  const filtered = await searchJson(origin, headers, new URLSearchParams({
    q: probeQuery, project, harness, date_from: date, date_to: date, limit: '20',
  }));
  assert(filtered.results.some(row => Number(row.message_id) === Number(first.message_id)),
    'combined production filters did not preserve their source match');
  const target = filtered.results[0];

  const releaseOperation = soak.acquirePidLock(
    soak.OPERATION_LOCK_PATH,
    'Remote Agent Chat production operation lock',
    `${JSON.stringify({
      pid: process.pid,
      acquired_at: new Date().toISOString(),
      agent: 'transcript-search-production-e2e',
      kind: 'production-browser-e2e',
    })}\n`,
  );
  const browser = await chromium.connectOverCDP(cdpUrl);
  try {
    const pages = browser.contexts().flatMap(context => context.pages());
    assert.equal(pages.length, 1, `expected one persistent verification page, found ${pages.length}`);
    const page = pages[0];
    let browserAttempts = 0;
    let exactDeepLink = false;
    let lastBrowserError = null;
    while (browserAttempts < 5 && !exactDeepLink) {
      browserAttempts++;
      try {
        await page.goto(publicUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 });
        const openSearch = page.getByRole('button', { name: 'Search all transcripts' });
        if (!await openSearch.isVisible().catch(() => false)) {
          const hamburger = page.locator('.hamburger');
          if (await hamburger.isVisible().catch(() => false)) await hamburger.click();
        }
        await openSearch.evaluate(button => button.click());
        await page.getByTestId('transcript-search-view').waitFor({ state: 'visible', timeout: 5_000 });
        await page.getByLabel('Search text').fill(probeQuery);
        await page.getByLabel('Project').fill(project);
        await page.getByLabel('Harness').fill(harness);
        await page.getByLabel('From').fill(date);
        await page.getByLabel('To').fill(date);
        await page.getByRole('button', { name: 'Search transcripts' }).evaluate(button => button.click());
        const exactResult = page.locator('.transcript-search-result').first();
        await exactResult.waitFor({ state: 'visible', timeout: 30_000 });
        await exactResult.evaluate(button => button.click());
        await page.locator(`.message.search-match[data-message-id="${target.message_id}"]`).waitFor({ timeout: 12_000 });
        exactDeepLink = true;
      } catch (error) {
        const diagnostic = await page.evaluate(() => ({
          view: document.querySelectorAll('[data-testid="transcript-search-view"]').length,
          results: document.querySelectorAll('.transcript-search-result').length,
          error: document.querySelector('.transcript-search-error')?.textContent || '',
          indexing: document.querySelector('.transcript-search-indexing')?.textContent || '',
        })).catch(() => ({}));
        lastBrowserError = new Error(`${error.message}; diagnostic=${JSON.stringify(diagnostic)}`);
        await page.waitForTimeout(250);
      }
    }
    assert(exactDeepLink, `persistent browser search did not survive page contention: ${lastBrowserError?.message || 'unknown error'}`);

    const result = {
      ok: true,
      source_commit: 'f3c67ca8d1630e7ffb74e066386c3b51ef1ce31d',
      public_origin: new URL(publicUrl).origin,
      index_ready: true,
      index_cursor_id: Number(search.index.cursor_id || 0),
      cursor_samples: cursorSamples.length,
      readiness_probe_max_ms: Math.max(...readinessLatencies),
      warm_search_ms: warmSearchLatencies,
      warm_search_p50_ms: orderedWarmLatencies[Math.floor(orderedWarmLatencies.length / 2)],
      warm_search_p95_ms: orderedWarmLatencies[orderedWarmLatencies.length - 1],
      unfiltered_results_observed: search.results.length,
      combined_filters_preserved_match: true,
      authenticated_persistent_pages: pages.length,
      browser_attempts: browserAttempts,
      exact_deep_link: true,
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
    await browser.close().catch(() => {});
    releaseOperation();
  }
}

main().catch(error => {
  console.error(`transcript search production E2E: FAIL (${error.stack || error.message || error})`);
  process.exit(1);
});
