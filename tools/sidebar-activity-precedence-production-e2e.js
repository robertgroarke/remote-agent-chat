#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('../frontend/node_modules/playwright-core');

const ROOT = path.join(__dirname, '..');

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

function sameSet(left, right) {
  return left.length === right.length && left.every(value => right.includes(value));
}

async function snapshot(page) {
  return page.evaluate(() => {
    const list = document.querySelector('.session-list');
    const directGroups = [...(list?.querySelectorAll(':scope > .session-group') || [])];
    const cards = [...(list?.querySelectorAll('.session-card[data-session-id]') || [])];
    const groupLabel = group => group?.getAttribute('aria-label')
      || group?.querySelector('.session-group-name')?.textContent?.trim()
      || 'unknown';
    const workingGroup = list?.querySelector(':scope > .working-session-group');
    const workingCards = [...(workingGroup?.querySelectorAll('.session-card[data-session-id]') || [])];
    const working = workingCards.map(card => card.dataset.sessionId);
    const all = cards.map(card => card.dataset.sessionId);
    const workingSet = new Set(working);
    const nonWorking = all.filter(id => !workingSet.has(id));
    const duplicateIds = [...new Set(all.filter((id, index) => all.indexOf(id) !== index))];
    const sectionById = Object.fromEntries(cards.map(card => [
      card.dataset.sessionId,
      groupLabel(card.closest('.session-group')),
    ]));
    const rows = cards.map((card, index) => {
      const rect = card.getBoundingClientRect();
      return {
        session_id: card.dataset.sessionId,
        index,
        section: sectionById[card.dataset.sessionId],
        top: Number(rect.top.toFixed(3)),
        bottom: Number(rect.bottom.toFixed(3)),
        visible: rect.bottom > 0 && rect.top < window.innerHeight,
      };
    });
    const workingIndexes = rows.filter(row => workingSet.has(row.session_id)).map(row => row.index);
    const nonWorkingIndexes = rows.filter(row => !workingSet.has(row.session_id)).map(row => row.index);
    const script = [...document.scripts].map(node => node.src).find(src => /\/dist\/bundle\.js/.test(src)) || null;
    return {
      sampled_at: new Date().toISOString(),
      url: location.href,
      title: document.title,
      bundle_script: script,
      viewport: { width: window.innerWidth, height: window.innerHeight, device_pixel_ratio: window.devicePixelRatio },
      total: all.length,
      unique: new Set(all).size,
      duplicate_ids: duplicateIds,
      order: all,
      working,
      non_working: nonWorking,
      group_order: directGroups.map(groupLabel),
      section_by_id: sectionById,
      rows,
      working_group_present: !!workingGroup,
      working_group_first: !workingGroup || directGroups[0] === workingGroup,
      working_group_expanded: !workingGroup || !workingGroup.classList.contains('collapsed'),
      maximum_working_index: workingIndexes.length ? Math.max(...workingIndexes) : null,
      minimum_non_working_index: nonWorkingIndexes.length ? Math.min(...nonWorkingIndexes) : null,
      working_before_non_working: !workingIndexes.length || !nonWorkingIndexes.length
        || Math.max(...workingIndexes) < Math.min(...nonWorkingIndexes),
      horizontal_overflow: !!list && list.scrollWidth > list.clientWidth + 0.5,
      scroll_top: list?.scrollTop || 0,
      focused_session: document.activeElement?.closest?.('[data-session-id]')?.dataset?.sessionId || null,
      focused_element: document.activeElement?.className || document.activeElement?.nodeName || null,
      page_has_focus: document.hasFocus(),
    };
  });
}

function assertHierarchy(value) {
  assert(value.total > 0, 'production sidebar has no session rows');
  assert.strictEqual(value.unique, value.total, 'production sidebar has duplicate session rows');
  assert.deepStrictEqual(value.duplicate_ids, []);
  assert.strictEqual(value.working_group_present, value.working.length > 0);
  assert.strictEqual(value.working_group_first, true, 'Working now is not the first production section');
  assert.strictEqual(value.working_group_expanded, true, 'Working now is collapsed in production');
  assert.strictEqual(value.working_before_non_working, true, 'a production non-working row precedes live work');
  assert.strictEqual(value.horizontal_overflow, false, 'production sidebar has horizontal overflow');
}

async function main() {
  const endpoint = argValue('--cdp', 'http://127.0.0.1:9240');
  const monitorMs = Number(argValue('--monitor-ms', '120000'));
  const sampleMs = Number(argValue('--sample-ms', '1000'));
  const settleMs = Number(argValue('--settle-ms', '3000'));
  const evidencePath = argValue('--evidence');
  const framesDir = argValue('--frames-dir');
  assert(Number.isFinite(monitorMs) && monitorMs >= 0, '--monitor-ms must be non-negative');
  assert(Number.isFinite(sampleMs) && sampleMs >= 250, '--sample-ms must be at least 250');
  assert(Number.isFinite(settleMs) && settleMs >= 0, '--settle-ms must be non-negative');

  const browser = await chromium.connectOverCDP(endpoint);
  let cdp;
  try {
    const pagesBefore = browser.contexts().flatMap(context => context.pages());
    assert.strictEqual(pagesBefore.length, 1, `expected sole production page, found ${pagesBefore.length}`);
    const page = pagesBefore[0];
    const originalUrl = page.url();
    const originalFocus = await page.evaluate(() => ({
      has_focus: document.hasFocus(),
      element: document.activeElement?.className || document.activeElement?.nodeName || null,
      session: document.activeElement?.closest?.('[data-session-id]')?.dataset?.sessionId || null,
    }));

    const outgoingFrames = [];
    let navigations = 0;
    cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Page.enable');
    cdp.on('Network.webSocketFrameSent', event => outgoingFrames.push(event.response?.payloadData || ''));
    cdp.on('Page.frameNavigated', () => { navigations += 1; });

    const frameEvidence = {};
    const resolvedFrames = framesDir ? path.resolve(framesDir) : null;
    if (resolvedFrames) {
      fs.mkdirSync(resolvedFrames, { recursive: true });
      frameEvidence.before = path.join(resolvedFrames, 'production-natural-edge-before.png');
      await page.screenshot({ path: frameEvidence.before, animations: 'disabled' });
    }
    const before = await snapshot(page);
    assert.strictEqual(before.url, originalUrl);
    assertHierarchy(before);
    const samples = [before];
    let previous = before;
    let during = null;
    const startedAt = Date.now();
    while (Date.now() - startedAt < monitorMs) {
      await page.waitForTimeout(sampleMs);
      const current = await snapshot(page);
      assertHierarchy(current);
      samples.push(current);
      if (!sameSet(previous.working, current.working)) {
        during = current;
        if (resolvedFrames) {
          frameEvidence.during = path.join(resolvedFrames, 'production-natural-edge-during.png');
          await page.screenshot({ path: frameEvidence.during, animations: 'disabled' });
        }
        break;
      }
      previous = current;
    }

    let after = null;
    let edge = null;
    if (during) {
      await page.waitForTimeout(settleMs);
      after = await snapshot(page);
      assertHierarchy(after);
      samples.push(after);
      if (resolvedFrames) {
        frameEvidence.after = path.join(resolvedFrames, 'production-natural-edge-after.png');
        await page.screenshot({ path: frameEvidence.after, animations: 'disabled' });
      }
      const entered = during.working.filter(id => !previous.working.includes(id));
      const exited = previous.working.filter(id => !during.working.includes(id));
      edge = {
        observed: true,
        detected_after_ms: Date.now() - startedAt - settleMs,
        entered_working: entered,
        exited_working: exited,
        changed_session_ids: [...new Set([...entered, ...exited])],
        before_working_count: previous.working.length,
        during_working_count: during.working.length,
        after_working_count: after.working.length,
        before_order: previous.order,
        during_order: during.order,
        after_order: after.order,
        before_hierarchy_pass: previous.working_before_non_working,
        during_hierarchy_pass: during.working_before_non_working,
        after_hierarchy_pass: after.working_before_non_working,
      };
    } else {
      after = samples.at(-1);
      edge = { observed: false, detected_after_ms: monitorMs, changed_session_ids: [] };
    }

    const pagesAfter = browser.contexts().flatMap(context => context.pages());
    const finalFocus = await page.evaluate(() => ({
      has_focus: document.hasFocus(),
      element: document.activeElement?.className || document.activeElement?.nodeName || null,
      session: document.activeElement?.closest?.('[data-session-id]')?.dataset?.sessionId || null,
    }));
    const dangerousOutgoing = outgoingFrames.map(payload => {
      try { return JSON.parse(payload); } catch { return null; }
    }).filter(message => message && [
      'user_message', 'permission_response', 'error_prompt_response', 'set_model',
      'set_effort', 'broadcast_message', 'resource_request', 'control_request',
    ].includes(message.type));

    const result = {
      status: edge.observed ? 'PASS' : 'BLOCKED_NO_NATURAL_EDGE',
      production: true,
      cdp_endpoint: endpoint,
      sole_existing_page_before: pagesBefore.length,
      sole_existing_page_after: pagesAfter.length,
      original_url: originalUrl,
      final_url: page.url(),
      navigations: navigations,
      new_pages_or_windows: pagesAfter.length - pagesBefore.length,
      sends: 0,
      controls: 0,
      focus_actions: 0,
      outgoing_control_or_provider_requests: dangerousOutgoing.length,
      original_focus: originalFocus,
      final_focus: finalFocus,
      focus_unchanged: JSON.stringify(originalFocus) === JSON.stringify(finalFocus),
      monitor_requested_ms: monitorMs,
      monitor_measured_ms: Date.now() - startedAt,
      sample_interval_ms: sampleMs,
      sample_count: samples.length,
      every_sample_working_first: samples.every(sample => sample.working_before_non_working),
      every_sample_unique: samples.every(sample => sample.total === sample.unique && sample.duplicate_ids.length === 0),
      before,
      natural_edge: edge,
      after,
      frame_evidence: Object.fromEntries(Object.entries(frameEvidence).map(([key, value]) => [
        key, path.relative(ROOT, value).replace(/\\/g, '/'),
      ])),
      visible_windows_opened: 0,
      protected_user_apps_touched: 0,
      recorded_at: new Date().toISOString(),
    };
    if (evidencePath) {
      const resolved = path.resolve(evidencePath);
      fs.mkdirSync(path.dirname(resolved), { recursive: true });
      fs.writeFileSync(resolved, `${JSON.stringify(result, null, 2)}\n`);
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

    assert.strictEqual(pagesAfter.length, pagesBefore.length, 'production observer opened a page/window');
    assert.strictEqual(page.url(), originalUrl, 'production observer navigated the page');
    assert.strictEqual(navigations, 0, 'production page navigated while observing');
    assert.deepStrictEqual(dangerousOutgoing, [], 'production observer emitted a control/provider request');
    assert.strictEqual(result.focus_unchanged, true, 'production observer changed focus');
    assert.strictEqual(edge.observed, true, 'no natural production working edge was observed');
  } finally {
    await cdp?.detach().catch(() => {});
    await browser.close();
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
