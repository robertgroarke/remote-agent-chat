#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('../frontend/node_modules/playwright-core');
const selectors = require('../agent-proxy/selectors');
const { applyCodexDomActivityChannels } = require('../agent-proxy/proxy-engine');

const EXACT_SUMMARY = 'Designing process management helpers';
const REPLACEMENT_SUMMARY = 'Reviewing bounded lifecycle state';

function chromePath() {
  const candidates = [
    process.env.RAC_CHROME_PATH,
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter(Boolean);
  const resolved = candidates.find(candidate => fs.existsSync(candidate));
  if (!resolved) throw new Error('Headless Chrome is unavailable');
  return resolved;
}

function fixtureHtml(surface) {
  const currentHeader = surface === 'codex-desktop'
    ? `<div id="current-activity" class="group/activity-header">${EXACT_SUMMARY}</div>`
    : `<div id="current-activity" data-testid="activity-header-current">${EXACT_SUMMARY}</div>`;
  return [
    '<!doctype html><html><body>',
    '<main data-thread-find-target="conversation">',
    '<div data-content-search-unit-key="turn-old:0:user">Historical user</div>',
    '<div data-turn-key="turn-old"><div class="group/activity-header">Historical decoy summary</div></div>',
    '<div data-content-search-unit-key="turn-current:0:user">Current user</div>',
    `<div data-turn-key="turn-current">${currentHeader}</div>`,
    '<aside><div data-codex-activity-header>Background sidebar decoy</div></aside>',
    '</main>',
    '<nav><div class="group/activity-header">Global navigation decoy</div></nav>',
    '<button aria-label="Stop generation">Stop</button>',
    '</body></html>',
  ].join('');
}

async function runSurface(browser, surface) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    const contexts = [];
    cdp.on('Runtime.executionContextCreated', event => contexts.push(event.context));
    await cdp.send('Runtime.enable');
    await page.setContent(fixtureHtml(surface));
    const defaultContext = contexts.find(entry => entry.auxData?.isDefault === true);
    assert(defaultContext?.id, `${surface}: default execution context missing`);
    const Runtime = {
      _innerContextId: defaultContext.id,
      evaluate: params => cdp.send('Runtime.evaluate', params),
    };
    const sessionId = `reasoning-dom-${surface}`;
    const readOptions = surface === 'codex-desktop'
      ? { maxRecentTurns: 24, maxRecentUnits: 96 }
      : {};

    await selectors.readMessages(Runtime, surface, sessionId, readOptions);
    const firstStats = selectors.getCodexReadCacheStats(sessionId);
    const first = await selectors.detectThinking(Runtime, surface);
    assert.strictEqual(first.thinking, true, `${surface}: stop signal should establish live ownership`);
    assert.strictEqual(first.activitySummary?.text, EXACT_SUMMARY, `${surface}: current native header missing`);
    assert.strictEqual(first.activitySummary?.native_turn_id, 'turn-current');
    assert.strictEqual(first.activitySummary?.lifecycle_generation, 2);
    assert.strictEqual(first.activitySummary?.surface_provenance?.surface,
      surface === 'codex-desktop' ? 'codex_desktop' : 'codex_vscode');
    assert.strictEqual(first.thinkingContent, EXACT_SUMMARY);
    assert(!JSON.stringify(first).includes('Historical decoy summary'));
    assert(!JSON.stringify(first).includes('Background sidebar decoy'));
    assert(!JSON.stringify(first).includes('Global navigation decoy'));

    selectors.setCodexCachedThinking(sessionId, first);
    await selectors.readMessages(Runtime, surface, sessionId, readOptions);
    const unchangedStats = selectors.getCodexReadCacheStats(sessionId);
    assert.strictEqual(unchangedStats.sig, firstStats.sig, `${surface}: unchanged signature drifted`);
    assert.strictEqual(unchangedStats.hits, 1, `${surface}: unchanged refresh did not hit cache`);
    assert.strictEqual(selectors.getCodexCachedThinking(sessionId)?.activitySummary?.text, EXACT_SUMMARY);

    await page.locator('#current-activity').evaluate((node, replacement) => { node.textContent = replacement; }, REPLACEMENT_SUMMARY);
    await selectors.readMessages(Runtime, surface, sessionId, readOptions);
    const changedStats = selectors.getCodexReadCacheStats(sessionId);
    assert.notStrictEqual(changedStats.sig, firstStats.sig, `${surface}: summary-only replacement did not invalidate`);
    assert.strictEqual(changedStats.hits, 0, `${surface}: changed summary incorrectly reused cache`);
    assert.strictEqual(selectors.getCodexCachedThinking(sessionId), null, `${surface}: stale thinking cache survived replacement`);

    const replaced = await selectors.detectThinking(Runtime, surface);
    assert.strictEqual(replaced.activitySummary?.text, REPLACEMENT_SUMMARY);
    assert.notStrictEqual(replaced.activitySummary?.native_source_id, first.activitySummary.native_source_id);

    const initialActivity = applyCodexDomActivityChannels({
      kind: 'thinking', label: 'Thinking', updated_at: first.activitySummary.observed_at,
    }, first);
    const sameSourceRefresh = {
      ...first,
      activitySummary: { ...first.activitySummary, observed_at: new Date(Date.parse(first.activitySummary.observed_at) + 1000).toISOString() },
    };
    const unchangedActivity = applyCodexDomActivityChannels({
      kind: 'thinking', label: 'Thinking', updated_at: sameSourceRefresh.activitySummary.observed_at,
    }, sameSourceRefresh, initialActivity);
    assert.strictEqual(
      unchangedActivity.thinking.producer_timestamp,
      initialActivity.thinking.producer_timestamp,
      `${surface}: unchanged native source must not create poll timestamp churn`,
    );
    const replacedActivity = applyCodexDomActivityChannels({
      kind: 'thinking', label: 'Thinking', updated_at: replaced.activitySummary.observed_at,
    }, replaced, unchangedActivity);
    assert.strictEqual(replacedActivity.thinking.text, REPLACEMENT_SUMMARY);
    assert.notStrictEqual(replacedActivity.thinking.native_source_id, unchangedActivity.thinking.native_source_id);

    return {
      surface,
      cache_hits_unchanged: unchangedStats.hits,
      summary_replacements: 1,
      background_false_positives: 0,
      source_turn: replaced.activitySummary.native_turn_id,
    };
  } finally {
    await context.close();
  }
}

async function main() {
  const browser = await chromium.launch({
    executablePath: chromePath(),
    headless: true,
    args: ['--disable-gpu', '--no-first-run', '--no-default-browser-check'],
  });
  try {
    const results = [];
    for (const surface of ['codex-desktop', 'codex']) results.push(await runSurface(browser, surface));
    process.stdout.write(`${JSON.stringify({ ok: true, results, visible_windows_opened: 0 }, null, 2)}\n`);
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
