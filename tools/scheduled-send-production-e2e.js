#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
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

async function readJobs(url, headers) {
  const response = await fetch(url, { headers, cache: 'no-store' });
  const body = await response.json().catch(() => ({}));
  assert.equal(response.status, 200, `scheduled-send list failed: ${response.status} ${body.error || ''}`);
  assert(Array.isArray(body.scheduled_sends), 'scheduled-send list omitted scheduled_sends');
  return body.scheduled_sends;
}

async function main() {
  const deployEnv = fidelity.loadEnvFile(path.join(ROOT, '.env'));
  const relayEnv = fidelity.loadEnvFile(path.join(ROOT, 'relay-server', '.env'));
  const publicUrl = String(relayEnv.PUBLIC_URL || '').replace(/\/+$/, '');
  const origin = `http://${deployEnv.RELAY_IP}:${deployEnv.RELAY_PORT || '3500'}`;
  const token = fidelity.buildBearerToken(relayEnv);
  assert(publicUrl && deployEnv.RELAY_IP && token, 'production URL, relay IP, and bearer token are required');
  const headers = externalHeaders(publicUrl, token);
  const listUrl = `${origin}/api/scheduled-sends`;

  const anonymous = await fetch(listUrl, { cache: 'no-store' });
  assert.equal(anonymous.status, 401, 'anonymous scheduled-send list must be rejected');
  const beforeJobs = await readJobs(listUrl, headers);

  const releaseOperation = soak.acquirePidLock(
    soak.OPERATION_LOCK_PATH,
    'Remote Agent Chat production operation lock',
    `${JSON.stringify({
      pid: process.pid,
      acquired_at: new Date().toISOString(),
      agent: 'scheduled-send-production-e2e',
      kind: 'production-browser-e2e-read-only',
    })}\n`,
  );
  const browser = await chromium.connectOverCDP(cdpUrl);
  let originalUrl = null;
  let originalSessionId = null;
  let originalDraft = null;
  try {
    const pages = browser.contexts().flatMap(context => context.pages());
    assert.equal(pages.length, 1, `expected one persistent verification page, found ${pages.length}`);
    const page = pages[0];
    originalUrl = page.url();
    await page.goto(publicUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    assert.equal(await page.locator('#root').count(), 1, 'persistent browser is not authenticated');
    await page.waitForFunction(() => document.querySelectorAll('.session-card[data-session-id]').length > 0, null, { timeout: 20_000 });

    let activeCard = page.locator('.session-card.active[data-session-id]').first();
    if (!await activeCard.count()) {
      activeCard = page.locator('.session-card[data-session-id]').first();
      await activeCard.evaluate(element => element.click());
    }
    originalSessionId = await activeCard.getAttribute('data-session-id');
    assert(originalSessionId, 'production UI has no selectable operator session');
    const composer = page.locator('.textarea-row textarea');
    await composer.waitFor({ state: 'attached', timeout: 10_000 });
    originalDraft = await composer.inputValue();
    const userMessagesBefore = await page.locator('.message.user').count();

    const scheduleButton = page.getByRole('button', { name: 'Schedule message' });
    await scheduleButton.waitFor({ state: 'visible', timeout: 10_000 });
    await scheduleButton.evaluate(element => element.click());
    const panel = page.getByTestId('scheduled-send-panel');
    await panel.waitFor({ state: 'visible', timeout: 10_000 });
    assert.equal(await panel.getByText('Schedule message', { exact: true }).count(), 1);
    const deliverSelect = panel.locator('select');
    assert.equal(await deliverSelect.locator('option').allTextContents().then(items => items.join('|')),
      'When session is next idle|At a specific time');
    assert.equal(await panel.locator('textarea').inputValue(), originalDraft, 'scheduler did not carry the current draft');
    const pendingRows = await panel.locator('.scheduled-send-row').count();
    assert.equal(pendingRows, beforeJobs.filter(job => job.session_id === originalSessionId).length,
      'scheduled-send panel does not match the authenticated read-only list');
    await panel.locator('.settings-panel-close').evaluate(element => element.click());
    await panel.waitFor({ state: 'detached', timeout: 5_000 });

    assert.equal(await composer.inputValue(), originalDraft, 'opening the scheduler changed the composer draft');
    assert.equal(await page.locator('.message.user').count(), userMessagesBefore, 'read-only scheduler probe changed transcript rows');
    const afterJobs = await readJobs(listUrl, headers);
    assert.deepEqual(afterJobs, beforeJobs, 'read-only scheduler probe changed production jobs');
    assert.equal(browser.contexts().flatMap(context => context.pages()).length, 1, 'scheduler probe opened another page');

    const result = {
      ok: true,
      source_commit: '6c3ef49fe9600447d08c331c177947560412d36c',
      public_origin: new URL(publicUrl).origin,
      session_id_sha256: crypto.createHash('sha256').update(originalSessionId).digest('hex'),
      authenticated_list_status: 200,
      anonymous_list_status: anonymous.status,
      jobs_before: beforeJobs.length,
      jobs_after: afterJobs.length,
      session_jobs_rendered: pendingRows,
      trigger_options: ['idle', 'at'],
      draft_carried: true,
      draft_restored: true,
      transcript_user_rows_unchanged: true,
      authenticated_persistent_pages: 1,
      production_sends: 0,
      production_controls: 0,
      production_job_mutations: 0,
      visible_windows_opened: 0,
      focus_actions: 0,
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
    try {
      const pages = browser.contexts().flatMap(context => context.pages());
      const page = pages[0];
      if (page) {
        const panel = page.getByTestId('scheduled-send-panel');
        if (await panel.isVisible().catch(() => false)) {
          await panel.locator('.settings-panel-close').evaluate(element => element.click()).catch(() => {});
        }
        if (originalSessionId) {
          const activeId = await page.locator('.session-card.active[data-session-id]').first().getAttribute('data-session-id').catch(() => null);
          if (activeId !== originalSessionId) {
            await page.locator(`.session-card[data-session-id="${originalSessionId}"]`).first().evaluate(element => element.click()).catch(() => {});
          }
        }
        if (originalDraft != null) {
          const composer = page.locator('.textarea-row textarea');
          if (await composer.count()) await composer.fill(originalDraft);
        }
        if (originalUrl && originalUrl !== page.url() && new URL(originalUrl).origin === new URL(publicUrl).origin) {
          await page.goto(originalUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 }).catch(() => {});
        }
      }
    } catch {}
    await browser.close().catch(() => {});
    releaseOperation();
  }
}

main().catch(error => {
  console.error(`scheduled send production e2e: FAIL (${error.stack || error.message || error})`);
  process.exit(1);
});
