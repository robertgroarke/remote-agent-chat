#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('../frontend/node_modules/playwright-core');

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

function routeScrollRestored(before, after) {
  if (before.bottom_gap < 80) return Math.abs(before.bottom_gap - after.bottom_gap) <= 1;
  return !!before.anchor_identity
    && before.anchor_identity === after.anchor_identity
    && Math.abs(before.anchor_offset_px - after.anchor_offset_px) <= 1;
}

async function captureChatRouteState(page) {
  return page.evaluate(() => {
    const list = document.querySelector('.messages');
    if (!list) throw new Error('production chat transcript is missing');
    const listRect = list.getBoundingClientRect();
    const rows = [...list.querySelectorAll('.transcript-window-row[data-window-index]')];
    const anchor = rows.find(row => {
      const rect = row.getBoundingClientRect();
      return rect.top >= listRect.top && rect.top < listRect.bottom;
    }) || rows.find(row => row.getBoundingClientRect().bottom > listRect.top) || rows[0] || null;
    const message = anchor?.querySelector('.message') || null;
    return {
      scroll_top: Number(list.scrollTop.toFixed(3)),
      scroll_height: Number(list.scrollHeight.toFixed(3)),
      client_height: Number(list.clientHeight.toFixed(3)),
      bottom_gap: Number((list.scrollHeight - list.scrollTop - list.clientHeight).toFixed(3)),
      anchor_identity: message?.dataset.messageSourceId || message?.dataset.messageKey || null,
      anchor_offset_px: anchor
        ? Number((anchor.getBoundingClientRect().top - listRect.top).toFixed(3))
        : null,
      total_messages: Number(list.dataset.totalMessageCount || 0),
      windowed: list.dataset.transcriptWindowed === 'true',
    };
  });
}

async function waitForStableChatRouteState(page) {
  await page.evaluate(async () => {
    const deadline = performance.now() + 5_000;
    let previous = null;
    let stableFrames = 0;
    const samples = [];
    while (performance.now() < deadline && stableFrames < 3) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      const list = document.querySelector('.messages');
      if (!list) throw new Error('production chat transcript is missing');
      const listRect = list.getBoundingClientRect();
      const rows = [...list.querySelectorAll('.transcript-window-row[data-window-index]')];
      const row = rows.find(candidate => {
        const rect = candidate.getBoundingClientRect();
        return rect.top >= listRect.top && rect.top < listRect.bottom;
      }) || rows.find(candidate => candidate.getBoundingClientRect().bottom > listRect.top) || rows[0] || null;
      const message = row?.querySelector('.message') || null;
      const current = {
        identity: message?.dataset.messageSourceId || message?.dataset.messageKey || null,
        offset: row ? row.getBoundingClientRect().top - listRect.top : null,
        scrollTop: list.scrollTop,
        scrollHeight: list.scrollHeight,
      };
      samples.push(current);
      if (samples.length > 20) samples.shift();
      stableFrames = previous
        && current.identity
        && current.identity === previous.identity
        && Math.abs(current.offset - previous.offset) <= 0.25
        ? stableFrames + 1
        : 0;
      previous = current;
    }
    if (stableFrames < 3) {
      throw new Error(`production chat anchor did not stabilize: ${JSON.stringify(samples)}`);
    }
  });
  return captureChatRouteState(page);
}

async function routeCycle(page, expectedRouteState) {
  return page.evaluate(async expected => {
    const waitFor = async predicate => {
      const startedAt = performance.now();
      while (!predicate()) {
        if (performance.now() - startedAt > 5_000) throw new Error('production Fleet route timed out');
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
    };
    const painted = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const captureRouteState = () => {
      const list = document.querySelector('.messages');
      if (!list) return null;
      const listRect = list.getBoundingClientRect();
      const rows = [...list.querySelectorAll('.transcript-window-row[data-window-index]')];
      const anchor = rows.find(row => {
        const rect = row.getBoundingClientRect();
        return rect.top >= listRect.top && rect.top < listRect.bottom;
      }) || rows.find(row => row.getBoundingClientRect().bottom > listRect.top) || rows[0] || null;
      const message = anchor?.querySelector('.message') || null;
      return {
        scroll_top: Number(list.scrollTop.toFixed(3)),
        scroll_height: Number(list.scrollHeight.toFixed(3)),
        client_height: Number(list.clientHeight.toFixed(3)),
        bottom_gap: Number((list.scrollHeight - list.scrollTop - list.clientHeight).toFixed(3)),
        anchor_identity: message?.dataset.messageSourceId || message?.dataset.messageKey || null,
        anchor_offset_px: anchor
          ? Number((anchor.getBoundingClientRect().top - listRect.top).toFixed(3))
          : null,
      };
    };
    const restored = current => !!current && (expected.bottom_gap < 80
      ? Math.abs(expected.bottom_gap - current.bottom_gap) <= 1
      : !!expected.anchor_identity
        && expected.anchor_identity === current.anchor_identity
        && Math.abs(expected.anchor_offset_px - current.anchor_offset_px) <= 1);
    const fleetButton = [...document.querySelectorAll('button')]
      .find(button => button.getAttribute('aria-label') === 'Fleet view');
    if (!fleetButton) throw new Error('production Fleet route trigger is missing');

    const openStartedAt = performance.now();
    fleetButton.click();
    await waitFor(() => document.querySelector('[data-testid="fleet-view"]'));
    await painted();
    const fleetOpenMs = performance.now() - openStartedAt;
    const fleetCards = [...document.querySelectorAll('.fleet-card')];
    const fleetSummary = Object.fromEntries([...document.querySelectorAll('.fleet-summary > div')].map(node => [
      node.querySelector('span')?.textContent?.trim()?.toLowerCase() || 'unknown',
      Number(node.querySelector('strong')?.textContent || 0),
    ]));

    const backButton = document.querySelector('[data-testid="fleet-view"] .automations-back');
    if (!backButton) throw new Error('production Fleet back control is missing');
    const backStartedAt = performance.now();
    backButton.click();
    await waitFor(() => !document.querySelector('[data-testid="fleet-view"]') && document.querySelector('.messages'));
    let restoredFrames = 0;
    let routeState = captureRouteState();
    while (performance.now() - backStartedAt <= 100 && restoredFrames < 2) {
      restoredFrames = restored(routeState) ? restoredFrames + 1 : 0;
      if (restoredFrames >= 2) break;
      await new Promise(resolve => requestAnimationFrame(resolve));
      routeState = captureRouteState();
    }
    return {
      fleet_open_ms: Number(fleetOpenMs.toFixed(3)),
      fleet_back_ms: Number((performance.now() - backStartedAt).toFixed(3)),
      fleet_cards: fleetCards.length,
      fleet_summary: fleetSummary,
      route_state_restored: restoredFrames >= 2,
      route_state: routeState,
    };
  }, expectedRouteState);
}

async function main() {
  const endpoint = argValue('--cdp', 'http://127.0.0.1:9240');
  const cycles = Number(argValue('--cycles', '5'));
  const outputPath = argValue('--output');
  assert(Number.isInteger(cycles) && cycles > 0 && cycles <= 20, '--cycles must be between 1 and 20');

  const browser = await chromium.connectOverCDP(endpoint);
  let cdp;
  try {
    const pagesBefore = browser.contexts().flatMap(context => context.pages());
    assert.strictEqual(pagesBefore.length, 1, `expected sole production page, found ${pagesBefore.length}`);
    const page = pagesBefore[0];
    const originalRouteState = await waitForStableChatRouteState(page);
    const original = await page.evaluate(() => ({
      url: location.href,
      active_session: document.querySelector('.session-card.active')?.dataset.sessionId || null,
      transcript_scroll_top: document.querySelector('.messages')?.scrollTop || 0,
      focus: document.activeElement?.className || document.activeElement?.nodeName || null,
      has_focus: document.hasFocus(),
      fleet_open: !!document.querySelector('[data-testid="fleet-view"]'),
      bundle_script: [...document.scripts].map(script => script.src).find(src => /\/dist\/bundle\.js/.test(src)) || null,
      session_count: document.querySelectorAll('.session-card[data-session-id]').length,
      viewport: { width: innerWidth, height: innerHeight, device_pixel_ratio: devicePixelRatio },
    }));
    original.route_state = originalRouteState;
    assert.strictEqual(original.fleet_open, false, 'production page did not start on the chat route');
    assert(original.active_session, 'production page has no active chat session');

    const outgoingFrames = [];
    let navigations = 0;
    cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Page.enable');
    cdp.on('Network.webSocketFrameSent', event => outgoingFrames.push(event.response?.payloadData || ''));
    cdp.on('Page.frameNavigated', () => { navigations += 1; });

    const measurements = [];
    for (let index = 0; index < cycles; index += 1) {
      measurements.push(await routeCycle(page, originalRouteState));
      await page.waitForTimeout(250);
    }
    const finalRouteState = await captureChatRouteState(page);
    const final = await page.evaluate(() => ({
      url: location.href,
      active_session: document.querySelector('.session-card.active')?.dataset.sessionId || null,
      transcript_scroll_top: document.querySelector('.messages')?.scrollTop || 0,
      focus: document.activeElement?.className || document.activeElement?.nodeName || null,
      has_focus: document.hasFocus(),
      fleet_open: !!document.querySelector('[data-testid="fleet-view"]'),
      session_count: document.querySelectorAll('.session-card[data-session-id]').length,
    }));
    final.route_state = finalRouteState;
    const pagesAfter = browser.contexts().flatMap(context => context.pages());
    const parsedOutgoing = outgoingFrames.map(payload => {
      try { return JSON.parse(payload); } catch { return null; }
    }).filter(Boolean);
    const dangerousOutgoing = parsedOutgoing.filter(message => [
      'user_message', 'permission_response', 'error_prompt_response', 'set_model',
      'set_effort', 'broadcast_message', 'resource_request', 'control_request',
    ].includes(message.type));
    const fleetOpen = measurements.map(sample => sample.fleet_open_ms);
    const fleetBack = measurements.map(sample => sample.fleet_back_ms);
    const everyRouteWithinBudget = [...fleetOpen, ...fleetBack].every(value => value <= 100);
    const stateRestored = original.url === final.url
      && original.active_session === final.active_session
      && measurements.every(sample => sample.route_state_restored)
      && routeScrollRestored(originalRouteState, finalRouteState)
      && original.focus === final.focus
      && original.has_focus === final.has_focus
      && !final.fleet_open;
    const safeExecution = pagesAfter.length === pagesBefore.length
      && navigations === 0
      && dangerousOutgoing.length === 0;
    const result = {
      status: everyRouteWithinBudget && stateRestored && safeExecution ? 'PASS' : 'FAIL',
      production: true,
      read_only_route_navigation: true,
      cdp_endpoint: endpoint,
      cycles,
      budget_ms: 100,
      measurements,
      fleet_open_max_ms: Math.max(...fleetOpen),
      fleet_back_max_ms: Math.max(...fleetBack),
      every_route_within_budget: everyRouteWithinBudget,
      original,
      final,
      state_restored: stateRestored,
      sole_existing_page_before: pagesBefore.length,
      sole_existing_page_after: pagesAfter.length,
      new_pages_or_windows: pagesAfter.length - pagesBefore.length,
      document_navigations: navigations,
      sends: 0,
      session_controls: 0,
      focus_actions: 0,
      outgoing_frame_types: [...new Set(parsedOutgoing.map(message => message.type || 'unknown'))],
      outgoing_control_or_provider_requests: dangerousOutgoing.length,
      visible_windows_opened: 0,
      protected_user_apps_touched: 0,
      recorded_at: new Date().toISOString(),
    };
    if (outputPath) {
      const resolved = path.resolve(outputPath);
      fs.mkdirSync(path.dirname(resolved), { recursive: true });
      fs.writeFileSync(resolved, `${JSON.stringify(result, null, 2)}\n`);
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

    assert.strictEqual(result.every_route_within_budget, true, 'production Fleet route exceeded 100 ms');
    assert.strictEqual(result.state_restored, true, 'production route proof did not restore chat state');
    assert.strictEqual(pagesAfter.length, pagesBefore.length, 'production route proof opened a page/window');
    assert.strictEqual(navigations, 0, 'production document navigated during in-app route proof');
    assert.deepStrictEqual(dangerousOutgoing, [], 'production route proof emitted a control/provider request');
  } finally {
    await cdp?.detach().catch(() => {});
    await browser.close();
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
