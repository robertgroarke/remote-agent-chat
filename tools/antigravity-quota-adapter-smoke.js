#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('../frontend/node_modules/playwright-core');
const selectors = require('../agent-proxy/selectors');

const root = path.resolve(__dirname, '..');

function runtimeFromSession(session) {
  return {
    evaluate: options => session.send('Runtime.evaluate', options),
  };
}

async function readFixture(html) {
  const executablePath = process.env.RAC_CHROME_PATH
    || 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
  assert(fs.existsSync(executablePath), 'installed headless Chrome executable is unavailable');
  const browser = await chromium.launch({ headless: true, executablePath });
  try {
    const page = await browser.newPage();
    await page.setContent(html);
    const session = await page.context().newCDPSession(page);
    await session.send('Runtime.enable');
    return await selectors.readAntigravityModelQuota(runtimeFromSession(session));
  } finally {
    await browser.close();
  }
}

async function main() {
  const grouped = await readFixture([
    '<main>',
    '<section class="space-y-2">',
    '<div><div>Model Quota</div></div>',
    '<div>',
    '<div class="flex flex-col p-5 bg-card">',
    '<h3>Gemini Models</h3>',
    '<div class="flex flex-row items-center justify-between py-2">',
    '<div><div>Weekly Limit</div>',
    '<div>You have used some of your weekly limit, it will fully refresh in 1 day, 8 hours.</div></div>',
    '<span>90%</span><svg><circle stroke-dasharray="80"></circle></svg>',
    '</div>',
    '<div class="flex flex-row items-center justify-between py-2">',
    '<div><div>Five Hour Limit</div></div><span>100%</span>',
    '<svg><circle stroke-dasharray="80"></circle></svg>',
    '</div></div>',
    '<div class="flex flex-col p-5 bg-card">',
    '<h3>Claude and GPT models</h3>',
    '<div class="flex flex-row items-center justify-between py-2">',
    '<div><div>Weekly Limit</div></div><span>100%</span></div>',
    '<div class="flex flex-row items-center justify-between py-2">',
    '<div><div>Five Hour Limit</div></div><span>100%</span></div>',
    '</div></div></section>',
    '<section>Available AI Credits: 0</section>',
    '</main>',
  ].join(''));
  assert(grouped, 'grouped Antigravity quota fixture was not detected');
  assert.strictEqual(grouped.schema_variant, 'grouped_limits_v2');
  assert.strictEqual(grouped.percentage_semantics, 'remaining');
  assert.strictEqual(grouped.available_ai_credits, 0, 'an authoritative zero credit balance was lost');
  assert.deepStrictEqual(grouped.models.map(model => ({
    model: model.model,
    remaining: model.percent_remaining,
    used: model.percent_used,
    refresh: model.refreshes_in,
  })), [
    { model: 'Gemini Models · Weekly Limit', remaining: 90, used: 10, refresh: '1 day, 8 hours' },
    { model: 'Gemini Models · Five Hour Limit', remaining: 100, used: 0, refresh: null },
    { model: 'Claude and GPT models · Weekly Limit', remaining: 100, used: 0, refresh: null },
    { model: 'Claude and GPT models · Five Hour Limit', remaining: 100, used: 0, refresh: null },
  ]);

  const legacy = await readFixture([
    '<main><h2>MODEL QUOTA</h2>',
    '<div class="py-3">',
    '<div class="flex items-center justify-between mb-2">',
    '<span>Gemini 2.5 Pro</span><span>Refreshes in 2 hours</span></div>',
    '<div class="flex-1 h-1 overflow-hidden bg-gray-500/20" style="width:100px">',
    '<div style="width:75px;background:#00ff00"></div></div></div>',
    '<div>Available AI Credits: 12.5</div></main>',
  ].join(''));
  assert(legacy, 'legacy Antigravity quota fixture regressed');
  assert.strictEqual(legacy.schema_variant, 'model_rows_v1');
  assert.strictEqual(legacy.available_ai_credits, 12.5);
  assert.strictEqual(legacy.models.length, 1);
  assert.strictEqual(legacy.models[0].model, 'Gemini 2.5 Pro');
  assert.strictEqual(legacy.models[0].refreshes_in, '2 hours');
  assert.strictEqual(legacy.models[0].percent_used, 25);

  const source = fs.readFileSync(path.join(root, 'agent-proxy', 'proxy-engine.js'), 'utf8');
  const methodStart = source.indexOf('async _withAntigravitySettingsClient(work)');
  const methodEnd = source.indexOf('\n  _normalizeAntigravityModelName', methodStart);
  const method = source.slice(methodStart, methodEnd);
  assert(method.includes('for (const cdpPort of this.CDP_PORTS)'),
    'Antigravity quota discovery is still pinned to the first CDP port');
  assert(method.includes("['127.0.0.1', '::1', 'localhost'].includes(url.hostname)"),
    'current Antigravity hosted-app target is not restricted to loopback');
  const refreshStart = source.indexOf('async _refreshAntigravityQuotaUsage(force = false)');
  const refreshEnd = source.indexOf('\n  _claudeCliPendingTranscriptMessages', refreshStart);
  const refreshMethod = source.slice(refreshStart, refreshEnd);
  assert(!refreshMethod.includes('refreshAntigravityModelQuota'),
    'protected Antigravity quota acquisition still clicks Refresh');
  assert(refreshMethod.includes('readAntigravityModelQuota'),
    'protected Antigravity quota acquisition is not read-only');

  process.stdout.write(JSON.stringify({
    ok: true,
    grouped_models: grouped.models.length,
    grouped_available_ai_credits: grouped.available_ai_credits,
    grouped_gemini_weekly_used_percent: grouped.models[0].percent_used,
    grouped_gemini_weekly_remaining_percent: grouped.models[0].percent_remaining,
    legacy_models: legacy.models.length,
    multi_port_discovery: true,
    loopback_only_current_target: true,
    protected_refresh_clicks: 0,
    headless: true,
  }, null, 2) + '\n');
}

main().catch(error => {
  console.error('Antigravity quota adapter smoke: FAIL (' + (error.stack || error.message || error) + ')');
  process.exit(1);
});
