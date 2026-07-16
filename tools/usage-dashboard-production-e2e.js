#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('../frontend/node_modules/playwright-core');
const fidelity = require('./run-fidelity-regression');

const root = path.resolve(__dirname, '..');
const relayEnv = fidelity.loadEnvFile(path.join(root, 'relay-server', '.env'));
const publicUrl = process.env.RAC_PUBLIC_URL || relayEnv.PUBLIC_URL;
const expectedAssetVersion = fs.readFileSync(path.join(root, 'frontend', 'index.html'), 'utf8')
  .match(/styles\.css\?v=(build-[a-f0-9]+)/i)?.[1];
const cdpUrl = process.env.RAC_VERIFICATION_BROWSER_CDP || 'http://127.0.0.1:9240';
const outputIndex = process.argv.indexOf('--output');
const outputPath = outputIndex >= 0 && process.argv[outputIndex + 1]
  ? path.resolve(process.argv[outputIndex + 1]) : null;
const screenshotDirIndex = process.argv.indexOf('--screenshot-dir');
const screenshotDir = screenshotDirIndex >= 0 && process.argv[screenshotDirIndex + 1]
  ? path.resolve(process.argv[screenshotDirIndex + 1]) : null;
const referenceIndex = process.argv.indexOf('--reference');
const referencePath = referenceIndex >= 0 && process.argv[referenceIndex + 1]
  ? path.resolve(process.argv[referenceIndex + 1]) : null;

function numericDelta(left, right) {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  return Number.isFinite(leftNumber) && Number.isFinite(rightNumber)
    ? Number(Math.abs(leftNumber - rightNumber).toFixed(4)) : null;
}

function compareLiveReference(snapshot, reference) {
  if (!reference) return [];
  const comparisons = [];
  for (const provider of reference.providers.filter(item => item.status === 'ok')) {
    const production = snapshot.snapshots.find(item => item.provider_id === provider.provider);
    assert(production, `production snapshot omitted live provider ${provider.provider}`);
    const lanes = [];
    for (const expected of provider.windows || []) {
      const actual = (production.windows || []).find(window => window.id === expected.id)
        || (production.windows || []).find(window => window.label === expected.label);
      assert(actual, `production ${provider.provider} omitted live lane ${expected.id || expected.label}`);
      const usedDelta = numericDelta(actual.used_percent, expected.used_percent);
      const remainingDelta = numericDelta(actual.remaining_percent, expected.remaining_percent);
      const actualReset = Date.parse(actual.resets_at || '');
      const expectedReset = Date.parse(expected.resets_at || '');
      const resetDelta = Number.isFinite(actualReset) && Number.isFinite(expectedReset)
        ? Math.abs(actualReset - expectedReset) / 1000 : null;
      if (usedDelta != null) assert(usedDelta <= 1,
        `${provider.provider}/${expected.id} used delta ${usedDelta}pp exceeded 1pp`);
      if (remainingDelta != null) assert(remainingDelta <= 1,
        `${provider.provider}/${expected.id} remaining delta ${remainingDelta}pp exceeded 1pp`);
      if (resetDelta != null) assert(resetDelta <= 60,
        `${provider.provider}/${expected.id} reset delta ${resetDelta}s exceeded 60s`);
      lanes.push({
        id: expected.id,
        label: expected.label,
        used_delta_percentage_points: usedDelta,
        remaining_delta_percentage_points: remainingDelta,
        reset_delta_seconds: resetDelta,
        within_tolerance: true,
      });
    }
    comparisons.push({
      provider_id: provider.provider,
      direct_source: provider.source,
      production_source: production.source,
      direct_latency_ms: provider.latency_ms,
      production_request_count: production.request_count,
      production_latency_ms: production.latency_ms,
      lanes,
    });
  }
  return comparisons;
}

async function main() {
  assert(publicUrl, 'PUBLIC_URL is required');
  assert(expectedAssetVersion, 'local frontend asset version is unavailable');
  let browser;
  let page;
  let cdpSession;
  let originalUrl;
  let originalViewport;
  let latestProviderUsageSnapshot = null;
  try {
    browser = await chromium.connectOverCDP(cdpUrl);
    const pages = browser.contexts().flatMap(context => context.pages());
    assert.strictEqual(pages.length, 1, `expected one persistent verification page, found ${pages.length}`);
    [page] = pages;
    originalUrl = page.url();
    originalViewport = page.viewportSize();
    cdpSession = await page.context().newCDPSession(page);
    await cdpSession.send('Network.enable');
    cdpSession.on('Network.webSocketFrameReceived', event => {
      try {
        const message = JSON.parse(event.response.payloadData);
        const snapshot = message.type === 'provider_usage_snapshot'
          ? message.snapshot : message.provider_usage;
        if (snapshot?.schema_version === 2) latestProviderUsageSnapshot = snapshot;
      } catch {}
    });
    const waitForProviderSnapshot = async (predicate, timeoutMs = 30000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (latestProviderUsageSnapshot && predicate(latestProviderUsageSnapshot)) {
          return latestProviderUsageSnapshot;
        }
        await page.waitForTimeout(100);
      }
      throw new Error('timed out waiting for a schema-v2 provider usage snapshot');
    };

    const openDashboard = async viewport => {
      await page.setViewportSize(viewport);
      await page.goto(`${publicUrl}/?usage-dashboard-proof=${Date.now()}`, {
        waitUntil: 'domcontentloaded', timeout: 20000,
      });
      await page.locator('.session-card').first().waitFor({ state: 'visible', timeout: 15000 });
      if (viewport.width <= 600) await page.locator('.hamburger').click();
      await page.getByRole('button', { name: 'Usage and limits' }).click();
      const dashboard = page.locator('[data-testid="usage-dashboard"]');
      await dashboard.waitFor({ state: 'visible', timeout: 5000 });
      await waitForProviderSnapshot(() => true);
      await page.waitForFunction(() => !document.querySelector('.toast.visible'), null, { timeout: 5000 });
      await page.waitForTimeout(300);
      if (viewport.width <= 600) {
        await page.waitForFunction(() => !document.querySelector('.sidebar')?.classList.contains('open'));
        await page.waitForTimeout(250);
      }
      const banner = page.locator('.duplicate-proxy-banner');
      if (await banner.count()) {
        const separation = await page.evaluate(() => {
          const alertBox = document.querySelector('.duplicate-proxy-banner')?.getBoundingClientRect();
          const contentBox = document.querySelector('[data-testid="usage-dashboard"]')?.getBoundingClientRect();
          return { bannerBottom: alertBox?.bottom || 0, contentTop: contentBox?.top || 0 };
        });
        assert(separation.contentTop >= separation.bannerBottom - 1,
          `system banner overlaps main navigation: ${JSON.stringify(separation)}`);
      }
      return dashboard;
    };

    const desktop = await openDashboard({ width: 1280, height: 900 });
    const desktopState = await desktop.evaluate(node => ({
      cards: node.querySelectorAll('.usage-dashboard-card').length,
      reportingCards: node.querySelectorAll('.usage-dashboard-card:not(.unavailable):not(.auth_required)').length,
      uniqueAccounts: new Set([...node.querySelectorAll('.usage-dashboard-card')].map(card =>
        `${card.dataset.providerId}:${card.dataset.accountFingerprint}`)).size,
      openCards: node.querySelectorAll('.usage-dashboard-card[open]').length,
      windows: node.querySelectorAll('.usage-dashboard-window').length,
      meters: node.querySelectorAll('[role="progressbar"]').length,
      sourceRows: node.querySelectorAll('.usage-dashboard-source-row').length,
      paceWindows: node.querySelectorAll('.usage-pace').length,
      thresholdRows: node.querySelectorAll('.usage-window-thresholds').length,
      costPanels: node.querySelectorAll('.usage-cost-panel').length,
      costCharts: node.querySelectorAll('.usage-cost-chart[role="img"]').length,
      costTables: node.querySelectorAll('.usage-cost-table').length,
      costRangeOptions: node.querySelectorAll('.usage-cost-controls select').item(0)?.options.length || 0,
      providerIds: [...node.querySelectorAll('.usage-dashboard-card')].map(card => card.dataset.providerId).sort(),
      providers: [...node.querySelectorAll('.usage-dashboard-card')].map(card => ({
        provider_id: card.dataset.providerId,
        status: card.querySelector('.usage-dashboard-status')?.textContent?.trim() || '',
        source: card.querySelector('.usage-dashboard-source-row > span')?.textContent?.trim() || '',
        windows: card.querySelectorAll('.usage-dashboard-window').length,
        lane_labels: [...card.querySelectorAll('.usage-dashboard-window-heading > span:first-child > strong')]
          .map(label => label.textContent.trim()),
        model_scoped_lanes: [...card.querySelectorAll('.usage-dashboard-window-heading small')]
          .map(label => label.textContent.trim()).filter(label => label.startsWith('Model:')),
      })).sort((left, right) => left.provider_id.localeCompare(right.provider_id)),
      text: node.innerText,
      overflow: node.scrollWidth - node.clientWidth,
      bounds: (() => { const box = node.getBoundingClientRect(); return { left: box.left, right: box.right, width: box.width }; })(),
    }));
    assert(desktopState.cards >= 1, 'production dashboard has no provider-account cards');
    assert(desktopState.reportingCards >= 1, 'production dashboard has no live capacity signal');
    assert.equal(desktopState.uniqueAccounts, desktopState.cards, 'provider-account cards are not uniquely keyed');
    assert.equal(desktopState.openCards, desktopState.cards, 'provider-account cards must start expanded');
    assert(desktopState.windows >= 1, 'production dashboard has no native quota windows');
    assert.equal(desktopState.meters, desktopState.windows, 'every native quota window must have a meter');
    assert.equal(desktopState.sourceRows, desktopState.cards, 'every provider-account card must expose source/freshness metadata');
    assert(desktopState.paceWindows >= 1, 'production dashboard has no predictive pace windows');
    assert.equal(desktopState.thresholdRows, desktopState.windows, 'every quota window must expose its thresholds');
    assert.equal(desktopState.costPanels, 1, 'production dashboard must separate one local estimated-cost panel');
    assert.equal(desktopState.costCharts, 1, 'production estimated cost must expose an accessible chart');
    assert.equal(desktopState.costTables, 1, 'production estimated cost must expose an accessible table');
    assert(desktopState.costRangeOptions >= 5, 'production estimated cost must expose Today/7/30/90/365 ranges');
    assert.match(desktopState.text, /providers?/i);
    assert.match(desktopState.text, /accounts?/i);
    assert.match(desktopState.text, /reporting/i);
    assert.match(desktopState.text, /% left/i);
    assert.match(desktopState.text, /% used/i);
    assert.match(desktopState.text, /source:/i);
    assert(!/NaN|undefined|null%/.test(desktopState.text), 'production dashboard rendered an invalid value');
    assert(desktopState.overflow <= 1, `desktop production dashboard overflowed ${desktopState.overflow}px`);
    if (screenshotDir) {
      fs.mkdirSync(screenshotDir, { recursive: true });
      await desktop.screenshot({ path: path.join(screenshotDir, 'usage-dashboard-production-desktop.png') });
    }

    const activeSessionBefore = await page.locator('.session-card.active').getAttribute('data-session-id');
    const reportingCard = page.locator('.usage-dashboard-card:not(.unavailable):not(.auth_required)').first();
    const providerId = await reportingCard.getAttribute('data-provider-id');
    const accountFingerprint = await reportingCard.getAttribute('data-account-fingerprint');
    await reportingCard.locator('summary').click();
    assert.equal(await reportingCard.getAttribute('open'), null, 'provider card must be collapsible');
    await reportingCard.locator('summary').click();
    assert.notEqual(await reportingCard.getAttribute('open'), null, 'provider card must reopen');
    assert.equal(await page.locator('.session-card.active').getAttribute('data-session-id'), activeSessionBefore,
      'provider-card disclosure must not navigate to an arbitrary mapped session');
    const generationBeforeRefresh = latestProviderUsageSnapshot.generation;
    await page.getByRole('button', { name: 'Refresh provider usage' }).click();
    const refreshedProviderUsage = await waitForProviderSnapshot(snapshot =>
      snapshot.generation > generationBeforeRefresh && snapshot.in_flight === false);
    await page.waitForFunction(() => ![...document.querySelectorAll('.usage-dashboard-status')]
      .some(node => node.textContent?.trim() === 'Refreshing'), null, { timeout: 5000 });
    assert(await page.locator(`[data-provider-id="${providerId}"][data-account-fingerprint="${accountFingerprint}"]`).count(),
      'manual refresh must preserve the provider-account identity');
    const reference = referencePath ? JSON.parse(fs.readFileSync(referencePath, 'utf8')) : null;
    const liveComparisons = compareLiveReference(refreshedProviderUsage, reference);

    const mobile = await openDashboard({ width: 390, height: 844 });
    const mobileState = await mobile.evaluate(node => ({
      cards: node.querySelectorAll('.usage-dashboard-card').length,
      windows: node.querySelectorAll('.usage-dashboard-window').length,
      sourceRows: node.querySelectorAll('.usage-dashboard-source-row').length,
      providerIds: [...node.querySelectorAll('.usage-dashboard-card')].map(card => card.dataset.providerId).sort(),
      providers: [...node.querySelectorAll('.usage-dashboard-card')].map(card => ({
        provider_id: card.dataset.providerId,
        status: card.querySelector('.usage-dashboard-status')?.textContent?.trim() || '',
        source: card.querySelector('.usage-dashboard-source-row > span')?.textContent?.trim() || '',
        windows: card.querySelectorAll('.usage-dashboard-window').length,
      })).sort((left, right) => left.provider_id.localeCompare(right.provider_id)),
      overflow: node.scrollWidth - node.clientWidth,
      bounds: (() => { const box = node.getBoundingClientRect(); return { left: box.left, right: box.right, width: box.width }; })(),
      summaryColumns: getComputedStyle(node.querySelector('.usage-dashboard-summary')).gridTemplateColumns.split(' ').length,
      cardColumns: getComputedStyle(node.querySelector('.usage-dashboard-grid')).gridTemplateColumns.split(' ').length,
    }));
    assert(mobileState.cards >= 1, 'mobile production dashboard has no provider-account cards');
    assert(mobileState.windows >= 1, 'mobile production dashboard has no native quota windows');
    assert.equal(mobileState.sourceRows, mobileState.cards, 'every mobile provider-account card must expose source metadata');
    assert(mobileState.overflow <= 1, `mobile production dashboard overflowed ${mobileState.overflow}px`);
    assert(mobileState.bounds.left >= -1 && mobileState.bounds.right <= 391,
      `mobile production dashboard escaped viewport: ${JSON.stringify(mobileState.bounds)}`);
    assert.equal(mobileState.summaryColumns, 2);
    assert.equal(mobileState.cardColumns, 1);
    if (screenshotDir) {
      await page.waitForFunction(() => !document.querySelector('.toast.visible'), null, { timeout: 10000 });
      await mobile.screenshot({ path: path.join(screenshotDir, 'usage-dashboard-production-mobile-390.png') });
    }

    const assetVersion = await page.locator('link[href*="/styles.css?v="]').getAttribute('href');
    assert(assetVersion?.includes(expectedAssetVersion), `unexpected production asset href: ${assetVersion}`);
    const result = {
      ok: true,
      generated_at: new Date().toISOString(),
      public_origin: new URL(publicUrl).origin,
      asset_version: expectedAssetVersion,
      schema_version: refreshedProviderUsage.schema_version,
      refresh_generation_before: generationBeforeRefresh,
      refresh_generation_after: refreshedProviderUsage.generation,
      provider_snapshot_generated_at: refreshedProviderUsage.generated_at,
      live_reference_generated_at: reference?.generated_at || null,
      same_minute_live_comparisons: liveComparisons,
      browser_cookie_import_used: false,
      browser_provider_page_proof: 'gated_absent_explicit_provider_specific_opt_in',
      antigravity_live: (() => {
        const antigravity = refreshedProviderUsage.snapshots
          .find(item => item.provider_id === 'google-antigravity');
        return {
          status: antigravity?.status || 'missing',
          source: antigravity?.source || 'not_available',
          error: antigravity?.error || null,
          source_history: antigravity?.source_history || [],
          lane_labels: (antigravity?.windows || []).map(window => window.label),
        };
      })(),
      estimated_cost_scan: (() => {
        const cost = refreshedProviderUsage.estimated_cost || {};
        const todayCutoff = Date.now() - 24 * 60 * 60 * 1000;
        const todayRecords = (cost.by_day || [])
          .filter(row => Date.parse(`${row.day}T23:59:59.999Z`) >= todayCutoff)
          .reduce((sum, row) => sum + (Number(row.records) || 0), 0);
        assert(['partial', 'ready'].includes(cost.status), 'production estimated-cost scan is not active');
        assert((cost.records || 0) > 0, 'production estimated-cost scan has no deduplicated records');
        assert(todayRecords > 0, 'newest-first production scan did not make the Today range useful');
        return {
          status: cost.status,
          pricing_catalog_version: cost.catalog_version || null,
          records: cost.records || 0,
          today_records: todayRecords,
          files_total: cost.scan?.files_total || 0,
          files_complete: cost.scan?.files_complete || 0,
          checkpoint_hash: cost.scan?.checkpoint_hash || null,
        };
      })(),
      claude_live_layout: (() => {
        const claude = refreshedProviderUsage.snapshots.find(item => item.provider_id === 'anthropic-claude');
        return {
          lane_labels: (claude?.windows || []).map(window => window.label),
          model_scoped_lanes: (claude?.windows || []).filter(window => window.model_scope).map(window => window.label),
          credits_reported: !!claude?.credits,
          scoped_lane_gate: (claude?.windows || []).some(window => window.model_scope)
            ? null : 'OAuth/hidden-CLI live sources reported no scoped weekly lane; browser-session source is disabled absent explicit opt-in.',
        };
      })(),
      persistent_browser_pages: pages.length,
      new_windows_opened: 0,
      focus_actions: 0,
      sends_or_harness_controls: 0,
      desktop: desktopState,
      mobile: mobileState,
      sampled_provider_id: providerId,
      sampled_account_fingerprint: accountFingerprint,
      active_session_preserved: true,
      provider_set_changed_during_live_convergence:
        JSON.stringify(desktopState.providerIds) !== JSON.stringify(mobileState.providerIds),
    };
    delete result.desktop.text;
    if (outputPath) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n');
    }
    console.log(JSON.stringify(result, null, 2));
  } finally {
    if (page && originalViewport) await page.setViewportSize(originalViewport).catch(() => {});
    if (page && originalUrl && originalUrl !== 'about:blank') {
      await page.goto(originalUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    }
    if (cdpSession) await cdpSession.detach().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
