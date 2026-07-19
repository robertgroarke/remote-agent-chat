#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('../relay-server/node_modules/ws');
const { chromium } = require('../frontend/node_modules/playwright-core');
const { PNG } = require('../frontend/node_modules/pngjs');

const SESSION_COUNT = 69;
const MARKER_SESSION_ID = 'sidebar-session-004';
const SELECTED_SESSION_ID = 'sidebar-session-034';
const PINNED_SESSION_IDS = ['sidebar-session-010', 'sidebar-session-002', 'sidebar-session-018'];
const READABILITY_TITLES = [
  'goal Restore harness controls',
  'Investigate missing UI goal',
  'Update harness steering backlog',
  'Remote Agent Chat goal prompt',
  'The Remote Agent Chat production restoration plan',
  'Restore harness controls and validate production transcript fidelity',
  'Restore harness controls and validate production sidebar readability',
  'Restore harness controls and validate production timestamps',
  'Restore harness controls and validate production reconnect behavior',
  'Restore harness controls and validate production Android parity',
  'Emoji 🚀 sidebar title with a long distinguishable suffix',
  '中文侧边栏标题需要完整显示并且可以轻松区分',
  'عنوان عربي طويل لاختبار اتجاه النص في الشريط الجانبي',
  'UnbrokenIdentifierThatMustWrapWithoutEscapingTheSessionCardBoundary',
  'Update harness steering backlog with a second distinct ending',
];
const READABILITY_GROUP = 'Remote Agent Chat Harness Restoration and Production Maturity Workspace';

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter(Boolean);
  const match = candidates.find(candidate => fs.existsSync(candidate));
  if (!match) throw new Error(`Headless Chrome not found; checked ${candidates.join(', ')}`);
  return match;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function requestJson(port, pathname) {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: '127.0.0.1', port, path: pathname }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        try { resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
        catch { resolve({ status: response.statusCode, body: null }); }
      });
    });
    request.once('error', reject);
  });
}

async function putSessionPreference(port, sessionId, preference) {
  const response = await fetch(`http://127.0.0.1:${port}/api/preferences/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ preference }),
  });
  const body = await response.json().catch(() => ({}));
  assert.strictEqual(response.status, 200, `preference seed failed for ${sessionId}: ${JSON.stringify(body)}`);
  return body.preference;
}

async function waitForHealth(port, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await requestJson(port, '/healthz');
      if (response.status === 200 && response.body?.status === 'ok') return;
    } catch { /* startup retry */ }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('isolated relay did not become healthy');
}

function connectProxy(port, secret) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/proxy-ws`);
    ws.once('open', () => ws.send(JSON.stringify({
      type: 'connection_hello', protocol_version: 1, peer_role: 'proxy',
      proxy_id: 'sidebar-stability-e2e', machine_label: 'sidebar-stability-e2e', secret,
    })));
    ws.on('message', data => {
      const message = JSON.parse(data.toString());
      if (message.type === 'connection_ack') resolve(ws);
    });
    ws.once('error', reject);
  });
}

async function closeSocket(ws) {
  if (!ws || ws.readyState === WebSocket.CLOSED) return;
  await new Promise(resolve => {
    ws.once('close', resolve);
    ws.close();
    setTimeout(resolve, 500).unref();
  });
}

function fixtureSessions(count = SESSION_COUNT) {
  const base = Date.parse('2026-07-13T12:00:00Z');
  return Array.from({ length: count }, (_, index) => {
    const projectName = index < 23 ? READABILITY_GROUP : `Project ${Math.floor(index / 23) + 1}`;
    const projectRoot = `C:\\production-shape\\${projectName}`;
    return {
    session_id: `sidebar-session-${String(index).padStart(3, '0')}`,
    agent_type: index === 0 ? 'codex-desktop' : index % 3 === 0 ? 'codex_cli' : index % 3 === 1 ? 'claude_cli' : 'cursor_cli',
    display_name: `Sidebar session ${String(index).padStart(2, '0')}`,
    chat_title: READABILITY_TITLES[index] || `Stable card ${String(index).padStart(2, '0')}`,
    workspace_name: projectName,
    group_alias: index < 23 ? READABILITY_GROUP : null,
    project_root: projectRoot,
    workspace_path: `${projectRoot}\\lane-${index}`,
    last_seen_at: new Date(base - index * 1_000).toISOString(),
    health: 'connected',
    };
  });
}

function sendVisibleFixtureMessage(proxy, sessionId, index, createdAt, prefix = 'recent-seed') {
  const sourceMessageId = `${prefix}-${String(index).padStart(3, '0')}`;
  proxy.send(JSON.stringify({
    type: 'proxy_message',
    protocol_version: 1,
    session: sessionId,
    role: index % 3 === 0 ? 'tool_result' : index % 2 === 0 ? 'assistant' : 'user',
    content: `Visible recent chat fixture ${prefix} ${index}`,
    created_at: createdAt,
    source: 'sidebar_recent_e2e',
    source_message_id: sourceMessageId,
  }));
  return { sessionId, sourceMessageId, createdAt };
}

function sendStatus(proxy, session, { label, updatedAt, thinking = true, kind = 'working' }) {
  proxy.send(JSON.stringify({
    type: 'status', protocol_version: 1, session, thinking,
    activity: { kind, label, updated_at: updatedAt, started_at: updatedAt },
  }));
}

async function captureSidebar(page) {
  return page.evaluate(() => {
    const list = document.querySelector('.session-list');
    const cards = [...document.querySelectorAll('.session-card[data-session-id]')];
    const rect = node => {
      const value = node.getBoundingClientRect();
      return { top: value.top, left: value.left, width: value.width, height: value.height };
    };
    return {
      order: cards.map(card => card.dataset.sessionId),
      visibleOrder: cards.filter(card => {
        const cardRect = card.getBoundingClientRect();
        const listRect = list.getBoundingClientRect();
        return cardRect.bottom > listRect.top && cardRect.top < listRect.bottom;
      }).map(card => card.dataset.sessionId),
      cards: Object.fromEntries(cards.map(card => [card.dataset.sessionId, rect(card)])),
      sectionBySession: Object.fromEntries(cards.map(card => [
        card.dataset.sessionId,
        card.closest('.working-session-group') ? 'working'
          : card.closest('.recent-session-group') ? 'recent'
            : card.closest('.pinned-session-group') ? 'pinned'
              : card.closest('.session-group')?.querySelector('.session-group-name')?.textContent?.trim() || 'workspace',
      ])),
      scrollTop: list?.scrollTop || 0,
      selectedTop: rect(document.querySelector('.session-card.active')).top,
      focusedSession: document.activeElement?.closest?.('[data-session-id]')?.dataset?.sessionId || null,
      nodeIdentityStable: cards.every(card => window.__RAC_SIDEBAR_STABILITY__?.nodes?.get(card.dataset.sessionId) === card),
      remountedSessionIds: cards.filter(card => (
        window.__RAC_SIDEBAR_STABILITY__?.nodes?.get(card.dataset.sessionId) !== card
      )).map(card => card.dataset.sessionId),
      layoutShift: (window.__RAC_SIDEBAR_STABILITY__?.shifts || []).reduce((sum, entry) => sum + entry.value, 0),
      layoutShiftEntries: window.__RAC_SIDEBAR_STABILITY__?.shifts || [],
      ignoredNonSidebarShiftEntries: window.__RAC_SIDEBAR_STABILITY__?.ignoredShifts || [],
      animationNames: [...new Set([...document.querySelectorAll('.session-group-items-inner')]
        .map(node => getComputedStyle(node).animationName).filter(name => name && name !== 'none'))],
    };
  });
}

async function captureRecentOwnership(page) {
  return page.evaluate(() => {
    const list = document.querySelector('.session-list');
    const cards = [...document.querySelectorAll('.session-card[data-session-id]')];
    const recentSection = document.querySelector('.recent-session-group');
    const recentCards = [...(recentSection?.querySelectorAll('.session-card[data-session-id]') || [])];
    const sectionOf = card => card.closest('.working-session-group') ? 'working'
      : card.closest('.recent-session-group') ? 'recent'
        : card.closest('.pinned-session-group') ? 'pinned'
          : card.closest('.session-group')?.querySelector('.session-group-name')?.textContent?.trim() || 'workspace';
    return {
      allIds: cards.map(card => card.dataset.sessionId),
      uniqueIds: new Set(cards.map(card => card.dataset.sessionId)).size,
      recent: recentCards.map(card => ({
        id: card.dataset.sessionId,
        at: card.dataset.lastMessageAt || null,
        renderedTime: card.querySelector('time')?.textContent?.trim() || null,
        dateTime: card.querySelector('time')?.getAttribute('datetime') || null,
      })),
      sections: Object.fromEntries(cards.map(card => [card.dataset.sessionId, sectionOf(card)])),
      recentCount: Number(recentSection?.querySelector('.session-group-count')?.textContent || 0),
      recentCollapsed: recentSection?.classList.contains('collapsed') || false,
      scrollTop: list?.scrollTop || 0,
      focusedSession: document.activeElement?.closest?.('.session-card[data-session-id]')?.dataset?.sessionId || null,
      activeSession: document.querySelector('.session-card.active')?.dataset?.sessionId || null,
      nodeIdentityStable: cards.every(card => window.__RAC_RECENT_STABILITY__?.nodes?.get(card.dataset.sessionId) === card),
      remountedSessionIds: cards.filter(card => (
        window.__RAC_RECENT_STABILITY__?.nodes?.get(card.dataset.sessionId) !== card
      )).map(card => card.dataset.sessionId),
      sidebarCls: (window.__RAC_RECENT_STABILITY__?.shifts || []).reduce((sum, entry) => sum + entry.value, 0),
      mutationMoves: window.__RAC_RECENT_STABILITY__?.moves || 0,
      scrollSamples: (window.__RAC_RECENT_STABILITY__?.scrollSamples || []).slice(-20),
      mutationSamples: (window.__RAC_RECENT_STABILITY__?.mutationSamples || []).slice(-20),
      visibleSectionOrder: [...document.querySelectorAll('.session-list > .session-group')]
        .filter(group => getComputedStyle(group).display !== 'none')
        .map(group => group.getAttribute('aria-label') || group.querySelector('.session-group-name')?.textContent?.trim() || ''),
    };
  });
}

function changedSectionIds(before, after) {
  return Object.keys(before.sections).filter(id => after.sections[id] && before.sections[id] !== after.sections[id]);
}

async function measureSidebarReadability(page) {
  await page.evaluate(() => {
    const rect = node => {
      const value = node.getBoundingClientRect();
      return { top: value.top, left: value.left, width: value.width, height: value.height };
    };
    const nodes = [...document.querySelectorAll('.session-card[data-session-id], .session-group-header')];
    const observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        window.__RAC_DISCLOSURE_STABILITY__.layoutShifts.push(entry.value);
      }
    });
    window.__RAC_DISCLOSURE_STABILITY__ = {
      nodes,
      rects: nodes.map(rect),
      listScrollTop: document.querySelector('.session-list')?.scrollTop || 0,
      focusBeforePointer: document.activeElement,
      layoutShifts: [],
      observer,
    };
    observer.observe({ type: 'layout-shift', buffered: false });
  });
  const metrics = await page.evaluate(expectedTitles => {
    const segmenter = typeof Intl.Segmenter === 'function'
      ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
      : null;
    const graphemes = text => segmenter
      ? [...segmenter.segment(text)].map(entry => ({ index: entry.index, segment: entry.segment }))
      : [...text].map((segment, index) => ({ index, segment }));
    const visibleGraphemes = element => {
      const text = element?.textContent || '';
      const node = element?.firstChild;
      if (!element || !node || node.nodeType !== Node.TEXT_NODE) return 0;
      const box = element.getBoundingClientRect();
      const parts = graphemes(text);
      let visible = 0;
      for (let index = 0; index < parts.length; index++) {
        const start = parts[index].index;
        const end = index + 1 < parts.length ? parts[index + 1].index : text.length;
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, end);
        const painted = [...range.getClientRects()].some(rect => (
          rect.bottom > box.top + 0.5 && rect.top < box.bottom - 0.5
          && rect.right > box.left + 0.5 && rect.left < box.right - 0.5
        ));
        if (painted) visible += 1;
      }
      return visible;
    };
    const cards = expectedTitles.map((_, index) => document.querySelector(`.session-card[data-session-id="sidebar-session-${String(index).padStart(3, '0')}"]`));
    const rows = cards.map((card, index) => {
      const title = card.querySelector('.session-card-name');
      const body = card.querySelector('.session-card-body');
      const right = card.querySelector('.session-card-right');
      const full = graphemes(expectedTitles[index]).length;
      const visible = visibleGraphemes(title);
      return {
        expected: expectedTitles[index],
        actual: title?.textContent || '',
        full_graphemes: full,
        visible_graphemes: visible,
        required_visible_graphemes: Math.min(24, full),
        title_box_width_px: Number((title?.getBoundingClientRect().width || 0).toFixed(3)),
        body_width_px: Number((body?.getBoundingClientRect().width || 0).toFixed(3)),
        action_rail_width_px: Number((right?.getBoundingClientRect().width || 0).toFixed(3)),
        card_height_px: Number(card.getBoundingClientRect().height.toFixed(3)),
        title_lines_reserved: getComputedStyle(title).webkitLineClamp,
        title_overflow_x: title.scrollWidth > title.clientWidth + 0.5,
      };
    });
    const sidebar = document.querySelector('.sidebar');
    const list = document.querySelector('.session-list');
    const group = document.querySelector('.session-group-header');
    const groupName = group?.querySelector('.session-group-name');
    return {
      rows,
      minimum_visible_graphemes: Math.min(...rows.map(row => row.visible_graphemes)),
      all_title_sources_exact: rows.every(row => row.actual === row.expected),
      all_title_budgets_pass: rows.every(row => row.visible_graphemes >= row.required_visible_graphemes),
      sidebar_width_px: Number((sidebar?.getBoundingClientRect().width || 0).toFixed(3)),
      sidebar_horizontal_overflow: !!list && list.scrollWidth > list.clientWidth + 0.5,
      group_title: groupName?.textContent || '',
      group_visible_graphemes: visibleGraphemes(groupName),
      group_title_box_width_px: Number((groupName?.getBoundingClientRect().width || 0).toFixed(3)),
      group_title_box_height_px: Number((groupName?.getBoundingClientRect().height || 0).toFixed(3)),
      group_title_lines_reserved: groupName ? getComputedStyle(groupName).webkitLineClamp : null,
      group_height_px: Number((group?.getBoundingClientRect().height || 0).toFixed(3)),
      separate_card_action_buttons: cards.reduce((total, card) => total
        + card.querySelectorAll(':scope > .session-card-right > button, :scope > .session-card-right > .session-card-automations, :scope > .session-card-right > .session-card-close').length, 0),
      session_action_menu_count: cards.filter(card => card.querySelector('.session-card-menu > .session-card-manage')).length,
    };
  }, READABILITY_TITLES);

  const disclosureGeometry = selector => page.evaluate(disclosureSelector => {
    const disclosure = document.querySelector(disclosureSelector);
    const sidebar = document.querySelector('.sidebar');
    const list = document.querySelector('.session-list');
    if (!disclosure || !sidebar || !list) return null;
    const rect = disclosure.getBoundingClientRect();
    const sidebarRect = sidebar.getBoundingClientRect();
    const listRect = list.getBoundingClientRect();
    const overlapWidth = Math.max(0, Math.min(rect.right, listRect.right) - Math.max(rect.left, listRect.left));
    const overlapHeight = Math.max(0, Math.min(rect.bottom, listRect.bottom) - Math.max(rect.top, listRect.top));
    return {
      placement: disclosure.dataset.placement || null,
      portaled_to_body: disclosure.parentElement === document.body,
      fully_in_viewport: rect.left >= 0 && rect.top >= 0
        && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight,
      right_of_sidebar: rect.left >= sidebarRect.right + 6,
      overlaps_sidebar_title_column: overlapWidth * overlapHeight > 0.5,
      rect: {
        left: Number(rect.left.toFixed(3)), top: Number(rect.top.toFixed(3)),
        right: Number(rect.right.toFixed(3)), bottom: Number(rect.bottom.toFixed(3)),
        width: Number(rect.width.toFixed(3)), height: Number(rect.height.toFixed(3)),
      },
      sidebar_right: Number(sidebarRect.right.toFixed(3)),
    };
  }, selector);

  const firstTitle = page.locator('.session-card[data-session-id="sidebar-session-000"] .session-card-name');
  const firstDisclosureSelector = '.session-title-disclosure[data-title-disclosure-for="sidebar-session-000"]';
  const firstDisclosure = page.locator(firstDisclosureSelector);
  await firstTitle.hover();
  await firstDisclosure.waitFor({ state: 'visible' });
  metrics.pointer_focus_preserved = await page.evaluate(() => (
    document.activeElement === window.__RAC_DISCLOSURE_STABILITY__.focusBeforePointer
  ));
  metrics.pointer_disclosure_visible = await firstDisclosure.isVisible();
  metrics.pointer_disclosure_exact = (await firstDisclosure.textContent()) === READABILITY_TITLES[0];
  metrics.pointer_disclosure_geometry = await disclosureGeometry(firstDisclosureSelector);
  metrics.disclosure_role = await firstDisclosure.getAttribute('role');
  metrics.trigger_describes_disclosure = (await firstTitle.getAttribute('aria-describedby')) === (await firstDisclosure.getAttribute('id'));
  metrics.trigger_expanded_while_open = (await firstTitle.getAttribute('aria-expanded')) === 'true';
  await page.mouse.move(500, 500);
  await firstDisclosure.waitFor({ state: 'hidden' });
  await firstTitle.focus();
  await firstDisclosure.waitFor({ state: 'visible' });
  metrics.keyboard_disclosure_visible = await firstDisclosure.isVisible();
  metrics.keyboard_disclosure_geometry = await disclosureGeometry(firstDisclosureSelector);
  await page.keyboard.press('Escape');
  await firstDisclosure.waitFor({ state: 'hidden' });
  metrics.escape_restores_trigger_focus = await firstTitle.evaluate(node => document.activeElement === node);
  await firstTitle.click();
  await firstDisclosure.waitFor({ state: 'visible' });
  metrics.tap_disclosure_visible = await firstDisclosure.isVisible();
  metrics.tap_disclosure_geometry = await disclosureGeometry(firstDisclosureSelector);
  await page.evaluate(() => document.body.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true, composed: true, pointerType: 'mouse',
  })));
  await firstDisclosure.waitFor({ state: 'hidden' });
  metrics.outside_pointer_dismisses_latched_disclosure = true;
  metrics.trigger_collapsed_after_dismiss = (await firstTitle.getAttribute('aria-expanded')) === 'false';

  metrics.long_press_disclosure_visible = null;
  if (await page.evaluate(() => window.matchMedia('(pointer: coarse)').matches || window.innerWidth <= 640)) {
    await firstTitle.dispatchEvent('pointerdown', { pointerType: 'touch', isPrimary: true, pointerId: 11 });
    await page.waitForTimeout(500);
    metrics.long_press_disclosure_visible = await firstDisclosure.isVisible();
    await firstTitle.dispatchEvent('pointerup', { pointerType: 'touch', isPrimary: true, pointerId: 11 });
    await page.keyboard.press('Escape');
  }

  const groupTitle = page.locator('.session-group-title-details .session-group-name').first();
  const groupDisclosureSelector = '.session-group-disclosure[data-title-disclosure-kind="group"]';
  const groupDisclosure = page.locator(groupDisclosureSelector).first();
  await groupTitle.focus();
  await groupDisclosure.waitFor({ state: 'visible' });
  metrics.group_keyboard_disclosure_visible = await groupDisclosure.isVisible();
  metrics.group_disclosure_geometry = await disclosureGeometry(groupDisclosureSelector);
  await page.keyboard.press('Escape');
  await groupTitle.click();
  await groupDisclosure.waitFor({ state: 'visible' });
  metrics.group_tap_disclosure_visible = await groupDisclosure.isVisible();
  metrics.group_disclosure_exact = (await groupDisclosure.textContent()) === READABILITY_GROUP;
  await page.keyboard.press('Escape');

  const firstMenu = page.locator('.session-card[data-session-id="sidebar-session-000"] .session-card-menu');
  const firstManage = firstMenu.locator('.session-card-manage');
  const manageBox = await firstManage.boundingBox();
  metrics.action_hit_target_px = manageBox && {
    width: Number(manageBox.width.toFixed(3)),
    height: Number(manageBox.height.toFixed(3)),
  };
  metrics.title_accessible_name_exact = (await firstTitle.getAttribute('aria-label')) === `Show full title: ${READABILITY_TITLES[0]}`;
  metrics.group_accessible_name_exact = (await groupTitle.getAttribute('aria-label')) === `Show full group name: ${READABILITY_GROUP}`;
  metrics.action_accessible_name_exact = (await firstManage.getAttribute('aria-label')) === `Session actions for ${READABILITY_TITLES[0]}`;
  await firstManage.focus();
  await page.keyboard.press('Enter');
  metrics.action_menu_keyboard_open = await firstMenu.evaluate(node => node.hasAttribute('open'));
  metrics.action_menu_items = await firstMenu.locator('[role="menuitem"]').allTextContents();
  await firstManage.click();
  await page.waitForTimeout(50);
  metrics.disclosure_stability = await page.evaluate(() => {
    const state = window.__RAC_DISCLOSURE_STABILITY__;
    state.observer.disconnect();
    const current = state.nodes.map(node => {
      const value = node.getBoundingClientRect();
      return { top: value.top, left: value.left, width: value.width, height: value.height };
    });
    let maximumDelta = 0;
    state.rects.forEach((before, index) => {
      const after = current[index];
      for (const key of ['top', 'left', 'width', 'height']) {
        maximumDelta = Math.max(maximumDelta, Math.abs(before[key] - after[key]));
      }
    });
    return {
      maximum_outer_geometry_delta_px: Number(maximumDelta.toFixed(3)),
      sidebar_cls: state.layoutShifts.reduce((sum, value) => sum + value, 0),
      scroll_top_drift_px: Math.abs((document.querySelector('.session-list')?.scrollTop || 0) - state.listScrollTop),
      node_identity_stable: state.nodes.every(node => node.isConnected),
      portals_remaining_after_close: document.querySelectorAll('.title-disclosure-portal').length,
    };
  });
  return metrics;
}

function maxRectDelta(before, after) {
  let max = 0;
  for (const [id, left] of Object.entries(before.cards)) {
    const right = after.cards[id];
    if (!right) continue;
    for (const key of ['top', 'left', 'width', 'height']) max = Math.max(max, Math.abs(left[key] - right[key]));
  }
  return max;
}

function maxRectDeltaForIds(before, after, ids) {
  let max = 0;
  for (const id of ids) {
    const left = before.cards[id];
    const right = after.cards[id];
    if (!left || !right) continue;
    for (const key of ['top', 'left', 'width', 'height']) max = Math.max(max, Math.abs(left[key] - right[key]));
  }
  return max;
}

function percentile(values, percentileValue) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * percentileValue) - 1)];
}

function writeHalfBlendOverlay(beforePath, afterPath, outputPath) {
  const before = PNG.sync.read(fs.readFileSync(beforePath));
  const after = PNG.sync.read(fs.readFileSync(afterPath));
  assert.equal(after.width, before.width, 'overlay frame widths differ');
  assert.equal(after.height, before.height, 'overlay frame heights differ');
  const overlay = new PNG({ width: before.width, height: before.height });
  for (let index = 0; index < overlay.data.length; index += 4) {
    overlay.data[index] = Math.round((before.data[index] + after.data[index]) / 2);
    overlay.data[index + 1] = Math.round((before.data[index + 1] + after.data[index + 1]) / 2);
    overlay.data[index + 2] = Math.round((before.data[index + 2] + after.data[index + 2]) / 2);
    overlay.data[index + 3] = 255;
  }
  fs.writeFileSync(outputPath, PNG.sync.write(overlay));
}

async function runRecentChatsMode({
  page, context, proxy, sessions, port, seedMessages, transcriptRequests,
  viewportText, colorScheme, zoomPercent, framesDir, pinsMode,
}) {
  const expectedSeedRecent = [19, 18, 17, 16, 15]
    .map(index => `sidebar-session-${String(index).padStart(3, '0')}`);
  await page.waitForFunction(expected => {
    const ids = [...document.querySelectorAll('.recent-session-group .session-card[data-session-id]')]
      .map(card => card.dataset.sessionId);
    return JSON.stringify(ids) === JSON.stringify(expected);
  }, expectedSeedRecent);

  const coldLoad = await captureRecentOwnership(page);
  assert.deepStrictEqual(coldLoad.recent.map(item => item.id), expectedSeedRecent);
  assert.strictEqual(coldLoad.recentCount, 5);
  assert.strictEqual(coldLoad.allIds.length, sessions.length);
  assert.strictEqual(coldLoad.uniqueIds, sessions.length);
  assert(coldLoad.recent.every(item => item.at && item.at === item.dateTime && item.renderedTime),
    'Recent rows must render their canonical timestamps');
  assert.deepStrictEqual(coldLoad.visibleSectionOrder.slice(0, 2), ['Working now', 'Recent chats']);

  const visual = await page.evaluate(expectPinnedRecent => {
    const section = document.querySelector('.recent-session-group');
    const list = document.querySelector('.session-list');
    const sidebar = document.querySelector('.sidebar');
    const cards = [...(section?.querySelectorAll('.session-card[data-session-id]') || [])];
    const within = (child, parent) => {
      const childRect = child.getBoundingClientRect();
      const parentRect = parent.getBoundingClientRect();
      return childRect.left >= parentRect.left - 0.5 && childRect.right <= parentRect.right + 0.5;
    };
    return {
      applied_theme: document.documentElement.getAttribute('data-theme'),
      recent_accessible_name: section?.getAttribute('aria-label') || null,
      toggle_accessible_name: section?.querySelector('.session-group-toggle')?.getAttribute('aria-label') || null,
      cards_within_sidebar: !!sidebar && cards.every(card => within(card, sidebar)),
      section_within_list: !!section && !!list && within(section, list),
      document_horizontal_overflow_px: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
      title_line_clamps: cards.map(card => getComputedStyle(card.querySelector('.session-card-name')).webkitLineClamp),
      pinned_recent_marker_preserved: expectPinnedRecent
        ? !!section?.querySelector('.session-card[data-session-id="sidebar-session-018"].pinned')
        : null,
    };
  }, pinsMode);
  assert.strictEqual(visual.applied_theme, colorScheme);
  assert.strictEqual(visual.recent_accessible_name, 'Recent chats');
  assert.match(visual.toggle_accessible_name || '', /Recent chats/);
  assert.strictEqual(visual.cards_within_sidebar, true);
  assert.strictEqual(visual.section_within_list, true);
  assert.strictEqual(visual.document_horizontal_overflow_px, 0);
  assert(visual.title_line_clamps.every(value => value === '2'), 'Recent titles must retain the two-line clamp');
  visual.timestamp_metrics = [];
  for (const sessionId of expectedSeedRecent) {
    const card = page.locator(`.recent-session-group .session-card[data-session-id="${sessionId}"]`);
    await card.evaluate(node => node.scrollIntoView({ block: 'center' }));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    visual.timestamp_metrics.push(await card.evaluate(node => {
      const time = node.querySelector('time');
      const style = time ? getComputedStyle(time) : null;
      return {
        session_id: node.dataset.sessionId,
        text: time?.textContent?.trim() || null,
        width: time ? Number(time.getBoundingClientRect().width.toFixed(3)) : 0,
        display: style?.display || null,
        visibility: style?.visibility || null,
      };
    }));
  }
  visual.timestamps_visible = visual.timestamp_metrics.every(item => (
    !!item.text && item.width > 0 && item.display !== 'none' && item.visibility === 'visible'
  ));
  assert.strictEqual(visual.timestamps_visible, true, JSON.stringify(visual.timestamp_metrics));
  if (pinsMode) assert.strictEqual(visual.pinned_recent_marker_preserved, true);
  let visualFrame = null;
  if (framesDir) {
    fs.mkdirSync(framesDir, { recursive: true });
    visualFrame = path.join(framesDir, `${viewportText}-${colorScheme}-${zoomPercent}pct-recent-chats.png`);
    if (zoomPercent >= 200) {
      await page.locator('.recent-session-group').evaluate(node => node.scrollIntoView({ block: 'start' }));
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    } else {
      await page.locator('.session-list').evaluate(node => { node.scrollTop = 0; });
    }
    await page.locator('.sidebar').screenshot({ path: visualFrame, animations: 'disabled' });
  }
  await page.locator('.session-list').evaluate(node => { node.scrollTop = 0; });

  await page.locator('.recent-session-group .session-group-toggle').click();
  assert.strictEqual((await captureRecentOwnership(page)).recentCollapsed, true);
  const sidebarFilter = page.getByLabel('Filter sidebar sessions');
  await sidebarFilter.fill('Stable card 18');
  await page.waitForFunction(() => (
    [...document.querySelectorAll('.recent-session-group .session-card[data-session-id]')]
      .filter(card => card.getBoundingClientRect().height > 0).length === 1
  ));
  assert.strictEqual((await captureRecentOwnership(page)).recentCollapsed, false,
    'search must temporarily reveal a collapsed Recent section');
  await page.getByLabel('Clear sidebar filter').click();
  assert.strictEqual((await captureRecentOwnership(page)).recentCollapsed, true,
    'clearing search must restore the durable collapse state');
  await page.locator('.recent-session-group .session-group-toggle').click();

  await page.locator('.session-card[data-session-id="sidebar-session-018"] .session-card-manage').focus();
  await page.waitForTimeout(100);
  await page.evaluate(() => {
    const sidebar = document.querySelector('.sidebar');
    const state = {
      nodes: new Map([...document.querySelectorAll('.session-card[data-session-id]')]
        .map(card => [card.dataset.sessionId, card])),
      shifts: [],
      moves: 0,
      scrollSamples: [],
      mutationSamples: [],
    };
    const shiftObserver = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        if (entry.hadRecentInput) continue;
        const sources = entry.sources || [];
        if (sources.length === 0 || sources.some(source => sidebar?.contains(source.node))) {
          state.shifts.push({ value: entry.value, at: entry.startTime });
        }
      }
    });
    shiftObserver.observe({ type: 'layout-shift', buffered: false });
    const moveObserver = new MutationObserver(records => {
      for (const record of records) {
        const changed = [...record.addedNodes, ...record.removedNodes].some(node => (
          node.nodeType === Node.ELEMENT_NODE
          && (node.matches?.('[data-sidebar-card-host]') || node.querySelector?.('[data-sidebar-card-host]'))
        ));
        if (changed) {
          state.moves += 1;
          state.mutationSamples.push({
            at: performance.now(),
            scrollTop: document.querySelector('.session-list')?.scrollTop || 0,
            focusedSession: document.activeElement?.closest?.('[data-session-id]')?.dataset?.sessionId || null,
          });
        }
      }
    });
    const list = document.querySelector('.session-list');
    moveObserver.observe(list, { childList: true, subtree: true });
    const recordScroll = () => state.scrollSamples.push({
      at: performance.now(),
      scrollTop: list.scrollTop,
      focusedSession: document.activeElement?.closest?.('[data-session-id]')?.dataset?.sessionId || null,
    });
    list.addEventListener('scroll', recordScroll, { passive: true });
    state.shiftObserver = shiftObserver;
    state.moveObserver = moveObserver;
    window.__RAC_RECENT_STABILITY__ = state;
  });

  const stormBefore = await captureRecentOwnership(page);
  const transcriptRequestsBeforeStorm = transcriptRequests.length;
  const stormStartedAt = Date.now();
  const tickMs = 100;
  const stormDurationIndex = process.argv.indexOf('--recent-storm-ms');
  const requestedStormMs = stormDurationIndex === -1 ? 60_000 : Number(process.argv[stormDurationIndex + 1]);
  assert(Number.isFinite(requestedStormMs) && requestedStormMs >= 1_000, '--recent-storm-ms must be at least 1000');
  const totalTicks = Math.ceil(requestedStormMs / tickMs);
  const burstStarts = Array.from({ length: 10 }, (_, index) => (
    Math.floor(((index + 1) * totalTicks) / 11) - 5
  ));
  let inventorySnapshots = 0;
  let duplicateReplays = 0;
  let activityFrames = 0;
  let clientReconnects = 0;
  const refreshStableWorking = () => {
    for (let workingIndex = 0; workingIndex < 3; workingIndex += 1) {
      sendStatus(proxy, `sidebar-session-${String(workingIndex).padStart(3, '0')}`, {
        label: `Stable work ${workingIndex + 1}`,
        updatedAt: new Date(Date.now() - workingIndex).toISOString(),
        thinking: true,
        kind: 'working',
      });
    }
  };
  for (let tick = 0; tick < totalTicks; tick += 1) {
    if (tick === 200 || tick === 400) {
      await context.setOffline(true);
      await page.waitForTimeout(120);
      await context.setOffline(false);
      clientReconnects += 1;
    }
    if (tick % 10 === 0) {
      const seed = seedMessages[tick / 10 % seedMessages.length];
      sendVisibleFixtureMessage(
        proxy,
        seed.sessionId,
        Number(seed.sessionId.slice(-3)),
        seed.createdAt,
        'recent-seed',
      );
      duplicateReplays += 1;
      sendStatus(proxy, 'sidebar-session-040', {
        label: `Idle heartbeat ${tick / 10}`,
        updatedAt: new Date(Date.now()).toISOString(),
        thinking: false,
        kind: 'idle',
      });
      refreshStableWorking();
      activityFrames += 4;
    }
    const burst = burstStarts.some(start => tick >= start && tick < start + 10);
    if (tick % 10 === 0 || burst) {
      proxy.send(JSON.stringify({
        type: 'session_list', protocol_version: 1, proxy_id: 'sidebar-stability-e2e',
        sessions: sessions.map((session, index) => ({
          ...session,
          last_seen_at: new Date(Date.now() + index).toISOString(),
        })),
      }));
      inventorySnapshots += 1;
    }
    const nextTickAt = stormStartedAt + (tick + 1) * tickMs;
    const delay = nextTickAt - Date.now();
    if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
  }
  await page.waitForTimeout(500);
  const stormAfter = await captureRecentOwnership(page);
  const stormDurationMs = Date.now() - stormStartedAt;
  assert(stormDurationMs >= requestedStormMs, `storm ended early at ${stormDurationMs}ms`);
  assert.deepStrictEqual(stormAfter.recent, stormBefore.recent);
  assert.deepStrictEqual(stormAfter.allIds, stormBefore.allIds);
  assert.strictEqual(stormAfter.nodeIdentityStable, true);
  assert.strictEqual(stormAfter.remountedSessionIds.length, 0);
  assert.strictEqual(stormAfter.sidebarCls, 0);
  assert.strictEqual(stormAfter.scrollTop, stormBefore.scrollTop,
    `sidebar scroll drifted: ${JSON.stringify({
      before: stormBefore.scrollTop,
      after: stormAfter.scrollTop,
      scrollSamples: stormAfter.scrollSamples,
      mutationMoves: stormAfter.mutationMoves,
      mutationSamples: stormAfter.mutationSamples,
    })}`);
  assert.strictEqual(stormAfter.focusedSession, stormBefore.focusedSession);
  assert.strictEqual(stormAfter.activeSession, stormBefore.activeSession);
  assert.strictEqual(stormAfter.mutationMoves, 0);
  assert.strictEqual(transcriptRequests.length - transcriptRequestsBeforeStorm, 0);

  await page.evaluate(() => {
    window.__RAC_RECENT_STABILITY__.shifts = [];
    window.__RAC_RECENT_STABILITY__.moves = 0;
  });
  const messageTransitions = [];
  const messageEventBase = Date.now();
  for (let index = 0; index < 10; index += 1) {
    refreshStableWorking();
    const target = `sidebar-session-${String(20 + index).padStart(3, '0')}`;
    if (index === 0) {
      await page.locator(`.session-card[data-session-id="${target}"]`).scrollIntoViewIfNeeded();
      await page.locator(`.session-card[data-session-id="${target}"] .session-card-manage`).focus();
    }
    const before = await captureRecentOwnership(page);
    const createdAt = new Date(messageEventBase + index * 1_000).toISOString();
    const sentAt = Date.now();
    sendVisibleFixtureMessage(proxy, target, 20 + index, createdAt, 'recent-transition');
    sendStatus(proxy, 'sidebar-session-040', {
      label: `Message flush ${index}`,
      updatedAt: new Date().toISOString(),
      thinking: false,
      kind: 'idle',
    });
    await page.waitForFunction(({ targetId, timestamp }) => {
      const first = document.querySelector('.recent-session-group .session-card[data-session-id]');
      return first?.dataset.sessionId === targetId && first?.dataset.lastMessageAt === timestamp;
    }, { targetId: target, timestamp: createdAt }, { timeout: 2_000 });
    const latencyMs = Date.now() - sentAt;
    const after = await captureRecentOwnership(page);
    const changed = changedSectionIds(before, after);
    assert.strictEqual(changed.length, 2, `message ${index + 1} changed ${changed.length} sections`);
    assert.strictEqual(after.nodeIdentityStable, true,
      `message ${index + 1} remounted ${after.remountedSessionIds.join(',')}`);
    assert.strictEqual(after.uniqueIds, sessions.length);
    assert(latencyMs <= 2_000, `message ${index + 1} latency ${latencyMs}ms`);
    if (index === 0) assert.strictEqual(after.focusedSession, target, 'focused row lost focus while entering Recent');
    messageTransitions.push({ target, created_at: createdAt, latency_ms: latencyMs, changed_section_ids: changed });
  }

  const workingTransitions = [];
  const workingTargets = [29, 28, 27, 26, 25]
    .map(index => `sidebar-session-${String(index).padStart(3, '0')}`);
  for (const target of workingTargets) {
    refreshStableWorking();
    const beforeStart = await captureRecentOwnership(page);
    const startSentAt = Date.now();
    sendStatus(proxy, target, {
      label: 'Recent edge working', updatedAt: new Date().toISOString(), thinking: true, kind: 'working',
    });
    await page.waitForFunction(targetId => (
      !!document.querySelector(`.working-session-group .session-card[data-session-id="${targetId}"]`)
    ), target, { timeout: 2_000 });
    const startLatencyMs = Date.now() - startSentAt;
    const afterStart = await captureRecentOwnership(page);
    const startChanged = changedSectionIds(beforeStart, afterStart);
    assert.strictEqual(startChanged.length, 2, `working start for ${target} changed ${startChanged.length} sections`);
    assert.strictEqual(afterStart.nodeIdentityStable, true);

    const stopSentAt = Date.now();
    sendStatus(proxy, target, {
      label: 'Recent edge idle', updatedAt: new Date().toISOString(), thinking: false, kind: 'idle',
    });
    await page.waitForFunction(targetId => (
      !!document.querySelector(`.recent-session-group .session-card[data-session-id="${targetId}"]`)
    ), target, { timeout: 2_000 });
    const afterStop = await captureRecentOwnership(page);
    const stopChanged = changedSectionIds(afterStart, afterStop);
    assert.strictEqual(stopChanged.length, 2, `working stop for ${target} changed ${stopChanged.length} sections`);
    assert.strictEqual(afterStop.nodeIdentityStable, true);
    workingTransitions.push({
      target,
      start_latency_ms: startLatencyMs,
      stop_latency_ms: Date.now() - stopSentAt,
      start_changed_section_ids: startChanged,
      stop_changed_section_ids: stopChanged,
    });
  }
  assert(workingTransitions.every(item => item.start_latency_ms <= 2_000 && item.stop_latency_ms <= 2_000));

  const canonicalBeforeSearch = await captureRecentOwnership(page);
  await sidebarFilter.fill('Stable card 28');
  await page.waitForFunction(() => (
    [...document.querySelectorAll('.recent-session-group .session-card[data-session-id]')]
      .filter(card => card.getBoundingClientRect().height > 0).length === 1
  ));
  const filteredRecentIds = await page.locator('.recent-session-group .session-card[data-session-id]')
    .evaluateAll(cards => cards.filter(card => card.getBoundingClientRect().height > 0).map(card => card.dataset.sessionId));
  await page.getByLabel('Clear sidebar filter').click();
  const canonicalAfterSearch = await captureRecentOwnership(page);
  assert.deepStrictEqual(filteredRecentIds, ['sidebar-session-028']);
  assert.deepStrictEqual(canonicalAfterSearch.recent, canonicalBeforeSearch.recent);
  assert.strictEqual(canonicalAfterSearch.nodeIdentityStable, true);

  await page.locator('.recent-session-group .session-group-toggle').click();
  const collapsedBeforeReload = await captureRecentOwnership(page);
  assert.strictEqual(collapsedBeforeReload.recentCollapsed, true);
  const recentBeforeReload = collapsedBeforeReload.recent;
  const transcriptRequestsBeforeReload = transcriptRequests.length;
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(count => document.querySelectorAll('.session-card[data-session-id]').length === count, sessions.length);
  const reconnectColdLoad = await captureRecentOwnership(page);
  assert.strictEqual(reconnectColdLoad.recentCollapsed, true);
  assert.deepStrictEqual(reconnectColdLoad.recent, recentBeforeReload);

  const result = {
    status: 'PASS',
    mode: 'recent-chats',
    actual_relay: true,
    actual_built_bundle: true,
    production_shape_sessions: sessions.length,
    viewport: viewportText,
    color_scheme: colorScheme,
    zoom_percent: zoomPercent,
    visual: {
      ...visual,
      frame: visualFrame
        ? path.relative(path.join(__dirname, '..'), visualFrame).replace(/\\/g, '/')
        : null,
    },
    cold_load: coldLoad,
    storm: {
      requested_duration_ms: requestedStormMs,
      measured_duration_ms: stormDurationMs,
      inventory_snapshots: inventorySnapshots,
      ten_hz_bursts: burstStarts.length,
      duplicate_stable_id_replays: duplicateReplays,
      activity_frames: activityFrames,
      client_reconnects: clientReconnects,
      row_moves: 0,
      group_moves: 0,
      remounts: stormAfter.remountedSessionIds.length,
      sidebar_cls: stormAfter.sidebarCls,
      scroll_drift_px: Math.abs(stormAfter.scrollTop - stormBefore.scrollTop),
      transcript_fetch_fan_out: transcriptRequests.length - transcriptRequestsBeforeStorm,
      node_identity_stable: stormAfter.nodeIdentityStable,
      keyboard_focus_stable: stormAfter.focusedSession === stormBefore.focusedSession,
      selected_chat_stable: stormAfter.activeSession === stormBefore.activeSession,
    },
    persisted_message_transitions: messageTransitions,
    working_edges: workingTransitions.flatMap(item => [
      { target: item.target, edge: 'start', latency_ms: item.start_latency_ms, changed_section_ids: item.start_changed_section_ids },
      { target: item.target, edge: 'stop', latency_ms: item.stop_latency_ms, changed_section_ids: item.stop_changed_section_ids },
    ]),
    search: {
      filtered_recent_ids: filteredRecentIds,
      canonical_order_restored: true,
      node_identity_stable: canonicalAfterSearch.nodeIdentityStable,
    },
    durable_collapse: {
      before_reload: collapsedBeforeReload.recentCollapsed,
      after_reload: reconnectColdLoad.recentCollapsed,
    },
    reconnect_cold_load: {
      recent: reconnectColdLoad.recent,
      transcript_requests_during_reload: transcriptRequests.length - transcriptRequestsBeforeReload,
    },
    visible_windows: 0,
    protected_user_apps_touched: 0,
    recorded_at: new Date().toISOString(),
  };
  const evidenceIndex = process.argv.indexOf('--evidence');
  if (evidenceIndex !== -1) {
    const evidencePath = process.argv[evidenceIndex + 1];
    assert(evidencePath, '--evidence requires an output path');
    fs.mkdirSync(path.dirname(path.resolve(evidencePath)), { recursive: true });
    fs.writeFileSync(path.resolve(evidencePath), `${JSON.stringify(result, null, 2)}\n`);
  }
  console.log(JSON.stringify(result, null, 2));
  return proxy;
}

async function main() {
  const viewportIndex = process.argv.indexOf('--viewport');
  const viewportText = viewportIndex === -1 ? '1440x900' : String(process.argv[viewportIndex + 1] || '1440x900');
  const viewportMatch = viewportText.match(/^(\d+)x(\d+)$/);
  assert(viewportMatch, '--viewport must use WIDTHxHEIGHT');
  const viewport = { width: Number(viewportMatch[1]), height: Number(viewportMatch[2]) };
  const colorSchemeIndex = process.argv.indexOf('--color-scheme');
  const colorScheme = colorSchemeIndex === -1 ? 'dark' : String(process.argv[colorSchemeIndex + 1] || 'dark');
  assert(['light', 'dark'].includes(colorScheme), '--color-scheme must be light or dark');
  const sidebarWidthIndex = process.argv.indexOf('--sidebar-width');
  const sidebarWidth = sidebarWidthIndex === -1 ? 260 : Number(process.argv[sidebarWidthIndex + 1]);
  assert(Number.isFinite(sidebarWidth) && sidebarWidth >= 220 && sidebarWidth <= 480, '--sidebar-width must be 220..480');
  const zoomIndex = process.argv.indexOf('--zoom');
  const zoomPercent = zoomIndex === -1 ? 100 : Number(process.argv[zoomIndex + 1]);
  assert([100, 125, 200].includes(zoomPercent), '--zoom must be 100, 125, or 200');
  const zoomScale = zoomPercent / 100;
  const layoutViewport = {
    width: Math.floor(viewport.width / zoomScale),
    height: Math.floor(viewport.height / zoomScale),
  };
  const fontSubstitution = process.argv.includes('--font-substitution');
  const disclosureOnly = process.argv.includes('--disclosure-only');
  const pinsMode = process.argv.includes('--pins');
  const recentMode = process.argv.includes('--recent-chats');
  const fixtureSessionCount = recentMode ? 79 : SESSION_COUNT;
  const framesIndex = process.argv.indexOf('--frames-dir');
  const framesDir = framesIndex === -1 ? null : path.resolve(process.argv[framesIndex + 1]);
  const port = await freePort();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-sidebar-stability-'));
  const secret = 'sidebar-stability-e2e-proxy-secret';
  const relayOutput = [];
  const child = spawn(process.execPath, ['index.js'], {
    cwd: path.join(__dirname, '..', 'relay-server'),
    env: {
      ...process.env,
      PORT: String(port),
      PUBLIC_URL: `http://127.0.0.1:${port}`,
      SESSION_SECRET: 'sidebar-stability-session-secret-at-least-32-chars',
      GOOGLE_CLIENT_ID: 'sidebar-stability-client-id',
      GOOGLE_CLIENT_SECRET: 'sidebar-stability-client-secret',
      PROXY_SECRET: secret,
      RAC_DATA_DIR: tempRoot,
      ALLOW_LAN_BYPASS: 'true',
      ALLOW_LOOPBACK_BYPASS: 'true',
      FIREBASE_SERVICE_ACCOUNT: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout.on('data', chunk => relayOutput.push(chunk.toString()));
  child.stderr.on('data', chunk => relayOutput.push(chunk.toString()));

  let proxy;
  let browser;
  let seededPinPreferences = [];
  const seedMessages = [];
  const transcriptRequests = [];
  try {
    await waitForHealth(port);
    proxy = await connectProxy(port, secret);
    const sessions = fixtureSessions(fixtureSessionCount);
    proxy.send(JSON.stringify({ type: 'session_list', protocol_version: 1, proxy_id: 'sidebar-stability-e2e', sessions }));
    if (pinsMode) {
      for (const sessionId of PINNED_SESSION_IDS) {
        seededPinPreferences.push(await putSessionPreference(port, sessionId, { pinned: true }));
      }
    }
    for (let index = 0; index < (recentMode ? 3 : 5); index += 1) {
      const updatedAt = new Date((recentMode ? Date.now() : Date.parse('2026-07-13T12:30:00Z')) - index * 1_000).toISOString();
      sendStatus(proxy, `sidebar-session-${String(index).padStart(3, '0')}`, {
        label: `Initial work ${index + 1}`, updatedAt,
      });
    }
    if (recentMode) {
      const seedBase = Date.now() - 120_000;
      for (let index = 10; index < 20; index += 1) {
        seedMessages.push(sendVisibleFixtureMessage(
          proxy,
          `sidebar-session-${String(index).padStart(3, '0')}`,
          index,
          new Date(seedBase + index * 1_000).toISOString(),
          'recent-seed',
        ));
      }
      proxy.send(JSON.stringify({
        type: 'session_list', protocol_version: 1, proxy_id: 'sidebar-stability-e2e', sessions,
      }));
    }
    await new Promise(resolve => setTimeout(resolve, 250));

    browser = await chromium.launch({
      executablePath: findChrome(),
      headless: true,
      args: ['--disable-gpu', '--no-first-run', '--no-default-browser-check'],
    });
    const touchMode = process.argv.includes('--touch');
    const context = await browser.newContext({
      viewport: layoutViewport,
      deviceScaleFactor: zoomScale,
      colorScheme,
      hasTouch: touchMode,
      isMobile: touchMode,
    });
    await context.addInitScript(theme => {
      try { localStorage.setItem('remote-agent-chat-theme', theme); } catch {}
    }, colorScheme);
    const page = await context.newPage();
    page.on('request', request => {
      if (/\/api\/sessions\/[^/]+\/messages(?:\?|$)/.test(request.url())) transcriptRequests.push(request.url());
    });
    page.on('websocket', socket => {
      socket.on('framesent', event => {
        try {
          const payload = JSON.parse(String(event.payload || ''));
          if (payload.type === 'get_history' || payload.type === 'history_request') {
            transcriptRequests.push(`${payload.type}:${payload.session || payload.session_id || ''}`);
          }
        } catch { /* binary/non-JSON WebSocket frame */ }
      });
    });
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
    await page.evaluate(({ width, substituteFont }) => {
      document.documentElement.style.setProperty('--sidebar-w', `${width}px`);
      if (substituteFont) document.body.style.fontFamily = 'Georgia, "Times New Roman", serif';
    }, { width: sidebarWidth, substituteFont: fontSubstitution });
    await page.waitForFunction(count => document.querySelectorAll('.session-card[data-session-id]').length === count, fixtureSessionCount);
    if (viewport.width <= 640) {
      await page.locator('.hamburger').click();
      await page.locator('.sidebar.open').waitFor();
      await page.waitForTimeout(250);
    }
    if (recentMode) {
      proxy = await runRecentChatsMode({
        page, context, proxy, sessions, port, seedMessages, transcriptRequests,
        viewportText, colorScheme, zoomPercent, framesDir, pinsMode,
      });
      return;
    }
    await page.locator('.session-list').evaluate(node => { node.scrollTop = 0; });
    if (pinsMode) {
      const capturePins = () => page.evaluate(() => {
        const list = document.querySelector('.session-list');
        const allCards = [...document.querySelectorAll('.session-card[data-session-id]')];
        const pinnedGroup = document.querySelector('.pinned-session-group');
        const pinnedCards = [...(pinnedGroup?.querySelectorAll('.session-card[data-session-id]') || [])];
        const allIds = allCards.map(card => card.dataset.sessionId);
        return {
          first_group_is_pinned: list?.querySelector(':scope > .session-group') === pinnedGroup,
          pinned_order: pinnedCards.map(card => card.dataset.sessionId),
          pinned_titles: pinnedCards.map(card => card.querySelector('.session-card-name')?.textContent?.trim() || ''),
          total_cards: allCards.length,
          unique_cards: new Set(allIds).size,
          pinned_cards_outside_pinned_group: allCards.filter(card => (
            card.classList.contains('pinned') && !card.closest('.pinned-session-group')
          )).length,
          direct_unpin_buttons: pinnedCards.map(card => {
            const button = card.querySelector('.session-card-pin-toggle');
            const rect = button?.getBoundingClientRect();
            return {
              label: button?.getAttribute('aria-label') || '',
              width: rect?.width || 0,
              height: rect?.height || 0,
            };
          }),
          hidden_pin_menu_actions: [...document.querySelectorAll('.session-card-menu-popover button')]
            .filter(button => button.textContent?.trim() === 'Pin chat').length,
        };
      });
      const initialPins = await capturePins();
      assert.deepStrictEqual(seededPinPreferences.map(preference => preference.pin_order), [1, 2, 3]);
      assert.strictEqual(initialPins.first_group_is_pinned, true, 'pinned section is not first');
      assert.deepStrictEqual(initialPins.pinned_order, PINNED_SESSION_IDS);
      assert.strictEqual(initialPins.total_cards, SESSION_COUNT);
      assert.strictEqual(initialPins.unique_cards, SESSION_COUNT, 'pinned cards were duplicated in workspace groups');
      assert.strictEqual(initialPins.pinned_cards_outside_pinned_group, 0);
      assert(initialPins.direct_unpin_buttons.every(button => (
        button.label.startsWith('Unpin ') && button.width >= 28 && button.height >= 28
      )), 'direct unpin controls are not accessible');
      assert(initialPins.hidden_pin_menu_actions > 0, 'unpinned cards lost their Pin chat action');

      const lowerCard = page.locator('.session-group:not(.pinned-session-group) .session-card').nth(5);
      await lowerCard.locator('summary.session-card-manage').click();
      await lowerCard.locator('.session-card-menu-popover button', { hasText: 'Manage session' }).click();
      await page.locator('.session-management-panel').waitFor({ state: 'visible' });
      await page.locator('.session-management-panel .settings-panel-close').click();
      await page.locator('.session-management-panel').waitFor({ state: 'detached' });

      await page.evaluate(() => {
        window.__RAC_PIN_NODES__ = new Map([...document.querySelectorAll('.pinned-session-group .session-card')]
          .map(card => [card.dataset.sessionId, card]));
      });
      sendStatus(proxy, PINNED_SESSION_IDS[2], {
        label: 'Pinned activity refresh', updatedAt: '2026-07-14T13:55:00Z', kind: 'generating',
      });
      proxy.send(JSON.stringify({
        type: 'session_list', protocol_version: 1, proxy_id: 'sidebar-stability-e2e',
        sessions: [...sessions].reverse().map((session, index) => ({
          ...session,
          chat_title: index % 2 ? `${session.chat_title} hydrated` : session.chat_title,
          last_seen_at: new Date(Date.parse('2026-07-14T13:56:00Z') + index * 1000).toISOString(),
        })),
      }));
      await page.waitForTimeout(600);
      const refreshedPins = await capturePins();
      refreshedPins.node_identity_stable = await page.evaluate(() => (
        [...document.querySelectorAll('.pinned-session-group .session-card')]
          .every(card => window.__RAC_PIN_NODES__?.get(card.dataset.sessionId) === card)
      ));
      assert.deepStrictEqual(refreshedPins.pinned_order, PINNED_SESSION_IDS,
        'ordinary session refresh changed operator pin order');
      assert.strictEqual(refreshedPins.node_identity_stable, true, 'pin refresh remounted pinned cards');

      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForFunction(expected => JSON.stringify(
        [...document.querySelectorAll('.pinned-session-group .session-card')].map(card => card.dataset.sessionId),
      ) === JSON.stringify(expected), PINNED_SESSION_IDS);
      const reloadedPins = await capturePins();
      assert.deepStrictEqual(reloadedPins.pinned_order, PINNED_SESSION_IDS, 'reload lost persisted pin order');

      await page.keyboard.press('Control+P');
      const quickInput = page.locator('.quick-switcher-input');
      await quickInput.waitFor({ state: 'visible' });
      await quickInput.fill(reloadedPins.pinned_titles[1]);
      const quickMatches = await page.locator('.quick-switcher-option').allTextContents();
      assert(quickMatches.some(text => text.includes(reloadedPins.pinned_titles[1])), 'quick switcher search omitted a pinned chat');
      await page.keyboard.press('Escape');

      const unpinnedId = PINNED_SESSION_IDS[2];
      await page.locator(`.pinned-session-group .session-card[data-session-id="${unpinnedId}"] .session-card-pin-toggle`).click();
      await page.waitForFunction(({ expected, removed }) => {
        const pinned = [...document.querySelectorAll('.pinned-session-group .session-card')]
          .map(card => card.dataset.sessionId);
        const all = [...document.querySelectorAll('.session-card[data-session-id]')]
          .map(card => card.dataset.sessionId);
        return JSON.stringify(pinned) === JSON.stringify(expected) && all.filter(id => id === removed).length === 1;
      }, { expected: PINNED_SESSION_IDS.slice(0, 2), removed: unpinnedId });
      const afterUnpin = await capturePins();
      const persisted = await requestJson(port, '/api/preferences/sessions');
      assert.strictEqual(persisted.status, 200);
      assert.strictEqual(persisted.body.preferences[unpinnedId].pinned, false);
      assert.strictEqual(persisted.body.preferences[unpinnedId].pin_order, 0);
      assert.deepStrictEqual(afterUnpin.pinned_order, PINNED_SESSION_IDS.slice(0, 2));
      assert.strictEqual(afterUnpin.total_cards, SESSION_COUNT);
      assert.strictEqual(afterUnpin.unique_cards, SESSION_COUNT);

      const result = {
        status: 'PASS',
        mode: 'pinned-chats',
        actual_relay: true,
        actual_built_bundle: true,
        production_shape_sessions: SESSION_COUNT,
        initial: initialPins,
        refreshed: refreshedPins,
        reloaded: reloadedPins,
        after_one_click_unpin: afterUnpin,
        relay_pin_orders: seededPinPreferences.map(preference => preference.pin_order),
        persisted_across_reload: true,
        non_pin_refresh_order_stable: true,
        pinned_cards_deduplicated: true,
        lower_card_pointer_menu_pass: true,
        quick_switcher_search_pass: true,
        direct_unpin_clicks: 1,
        visible_windows: 0,
        protected_user_apps_touched: 0,
        recorded_at: new Date().toISOString(),
      };
      const evidenceIndex = process.argv.indexOf('--evidence');
      if (evidenceIndex !== -1) {
        const evidencePath = process.argv[evidenceIndex + 1];
        assert(evidencePath, '--evidence requires an output path');
        fs.mkdirSync(path.dirname(path.resolve(evidencePath)), { recursive: true });
        fs.writeFileSync(path.resolve(evidencePath), `${JSON.stringify(result, null, 2)}\n`);
      }
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    const readability = await measureSidebarReadability(page);
    readability.zoom_emulation = await page.evaluate(expected => ({
      physical_viewport: expected.physical,
      css_viewport: { width: window.innerWidth, height: window.innerHeight },
      device_pixel_ratio: window.devicePixelRatio,
    }), { physical: viewport });
    if (framesDir) {
      fs.mkdirSync(framesDir, { recursive: true });
      const variantStem = `${viewport.width}x${viewport.height}-${colorScheme}-${sidebarWidth}px-${zoomPercent}pct${touchMode ? '-touch' : ''}${fontSubstitution ? '-fontsub' : ''}`;
      const readabilityPath = path.join(framesDir, `${variantStem}-readability.png`);
      await page.locator('.sidebar').screenshot({ path: readabilityPath, animations: 'disabled' });
      readability.frame = path.relative(path.join(__dirname, '..'), readabilityPath).replace(/\\/g, '/');
      if (disclosureOnly) {
        const disclosurePath = path.join(framesDir, `${variantStem}-title-disclosure.png`);
        const title = page.locator('.session-card[data-session-id="sidebar-session-000"] .session-card-name');
        await title.click();
        await page.locator('.session-title-disclosure[data-title-disclosure-for="sidebar-session-000"]').waitFor({ state: 'visible' });
        await page.screenshot({ path: disclosurePath, animations: 'disabled' });
        await page.keyboard.press('Escape');
        readability.disclosure_frame = path.relative(path.join(__dirname, '..'), disclosurePath).replace(/\\/g, '/');
      }
    }
    if (disclosureOnly) {
      const violations = [];
      if (!readability.pointer_disclosure_visible || !readability.pointer_disclosure_exact) violations.push('pointer full-title disclosure failed');
      if (!readability.keyboard_disclosure_visible || !readability.escape_restores_trigger_focus) violations.push('keyboard full-title disclosure or focus restoration failed');
      if (!readability.tap_disclosure_visible || !readability.outside_pointer_dismisses_latched_disclosure) violations.push('click/tap latch or outside dismissal failed');
      if (!readability.group_keyboard_disclosure_visible || !readability.group_tap_disclosure_visible || !readability.group_disclosure_exact) violations.push('group full-title disclosure failed');
      for (const [label, geometry] of [
        ['pointer', readability.pointer_disclosure_geometry],
        ['keyboard', readability.keyboard_disclosure_geometry],
        ['tap', readability.tap_disclosure_geometry],
        ['group', readability.group_disclosure_geometry],
      ]) {
        if (!geometry?.portaled_to_body || !geometry?.fully_in_viewport) violations.push(`${label} disclosure was clipped or outside the viewport`);
        if (layoutViewport.width > 640 && (geometry?.placement !== 'right'
          || !geometry?.right_of_sidebar || geometry?.overlaps_sidebar_title_column)) {
          violations.push(`${label} disclosure did not escape to the right of the sidebar`);
        }
        if (layoutViewport.width <= 640 && geometry?.placement !== 'sheet') violations.push(`${label} disclosure did not use viewport-safe sheet geometry`);
      }
      if (touchMode && !readability.long_press_disclosure_visible) violations.push('touch long-press full-title disclosure failed');
      if (readability.disclosure_role !== 'tooltip' || !readability.trigger_describes_disclosure
        || !readability.trigger_expanded_while_open || !readability.trigger_collapsed_after_dismiss) {
        violations.push('disclosure screen-reader semantics were incomplete');
      }
      if (!readability.pointer_focus_preserved) violations.push('pointer disclosure stole focus');
      if (readability.disclosure_stability.maximum_outer_geometry_delta_px > 0.5) violations.push(`disclosure moved sidebar geometry ${readability.disclosure_stability.maximum_outer_geometry_delta_px}px`);
      if (readability.disclosure_stability.sidebar_cls !== 0) violations.push(`disclosure caused sidebar CLS ${readability.disclosure_stability.sidebar_cls}`);
      if (readability.disclosure_stability.scroll_top_drift_px > 1) violations.push(`disclosure changed scrollTop ${readability.disclosure_stability.scroll_top_drift_px}px`);
      if (!readability.disclosure_stability.node_identity_stable || readability.disclosure_stability.portals_remaining_after_close !== 0) violations.push('disclosure remounted sidebar nodes or left an orphan portal');
      const result = {
        status: violations.length ? 'FAIL' : 'PASS',
        mode: 'title-disclosure',
        actual_relay: true,
        actual_built_bundle: true,
        production_shape_sessions: SESSION_COUNT,
        viewport: viewportText,
        color_scheme: colorScheme,
        sidebar_width_requested_px: sidebarWidth,
        zoom_percent: zoomPercent,
        touch: touchMode,
        font_substitution: fontSubstitution ? 'Georgia, Times New Roman, serif' : null,
        readability,
        violations,
        visible_windows: 0,
        protected_user_apps_touched: 0,
        recorded_at: new Date().toISOString(),
      };
      const evidenceIndex = process.argv.indexOf('--evidence');
      if (evidenceIndex !== -1) {
        const evidencePath = process.argv[evidenceIndex + 1];
        assert(evidencePath, '--evidence requires an output path');
        fs.mkdirSync(path.dirname(path.resolve(evidencePath)), { recursive: true });
        fs.writeFileSync(path.resolve(evidencePath), `${JSON.stringify(result, null, 2)}\n`);
      }
      console.log(JSON.stringify(result, null, 2));
      assert.deepStrictEqual(violations, [], `sidebar title disclosure violations:\n- ${violations.join('\n- ')}`);
      return;
    }
    await page.locator(`.session-card[data-session-id="${SELECTED_SESSION_ID}"]`).click();
    await page.locator(`.session-card.active[data-session-id="${SELECTED_SESSION_ID}"]`).waitFor();
    if (viewport.width <= 640 && await page.locator('.sidebar.open').count() === 0) {
      await page.locator('.hamburger').click();
      await page.locator('.sidebar.open').waitFor();
    }
    await page.locator(`.session-card[data-session-id="${SELECTED_SESSION_ID}"] .session-card-manage`).focus();
    await page.locator('.session-list').evaluate(node => { node.scrollTop = Math.min(900, node.scrollHeight - node.clientHeight); });
    await page.waitForTimeout(650);
    await page.evaluate(() => {
      const cards = [...document.querySelectorAll('.session-card[data-session-id]')];
      const state = {
        nodes: new Map(cards.map(card => [card.dataset.sessionId, card])),
        shifts: [], ignoredShifts: [], markerPaintAt: null, markerMutationAt: null,
      };
      const shiftObserver = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          if (entry.hadRecentInput) continue;
          const sidebar = document.querySelector('.sidebar');
          const rawSources = entry.sources || [];
          const serialized = {
            value: entry.value,
            at: entry.startTime,
            sources: rawSources.map(source => ({
              node: source.node?.className || source.node?.nodeName || null,
              previous: source.previousRect && { x: source.previousRect.x, y: source.previousRect.y, width: source.previousRect.width, height: source.previousRect.height },
              current: source.currentRect && { x: source.currentRect.x, y: source.currentRect.y, width: source.currentRect.width, height: source.currentRect.height },
            })),
          };
          const belongsToSidebar = rawSources.length === 0 || rawSources.some(source => sidebar?.contains(source.node));
          (belongsToSidebar ? state.shifts : state.ignoredShifts).push(serialized);
        }
      });
      shiftObserver.observe({ type: 'layout-shift', buffered: false });
      const marker = document.querySelector('[data-session-id="sidebar-session-004"] .session-card-sub');
      const mutationObserver = new MutationObserver(() => {
        if (!marker.textContent.includes('Refresh marker')) return;
        state.markerMutationAt = Date.now();
        requestAnimationFrame(() => requestAnimationFrame(() => { state.markerPaintAt = Date.now(); }));
        mutationObserver.disconnect();
      });
      mutationObserver.observe(marker, { childList: true, characterData: true, subtree: true });
      window.__RAC_SIDEBAR_STABILITY__ = state;
    });

    await page.locator('.session-list').evaluate(node => { node.scrollTop = 0; });
    await page.waitForTimeout(100);
    const beforeZeroToUnread = await captureSidebar(page);
    proxy.send(JSON.stringify({
      type: 'proxy_message', protocol_version: 1, session: 'sidebar-session-000', role: 'assistant',
      content: 'Unread slot geometry probe', source: 'sidebar-stability-e2e',
      source_message_id: 'sidebar-unread-slot-geometry-probe',
    }));
    await page.waitForFunction(() => Number(document.querySelector('.session-group-unread')?.textContent || 0) > 0);
    await page.waitForTimeout(100);
    const afterZeroToUnread = await captureSidebar(page);
    const zeroToUnreadOuterDeltaPx = maxRectDelta(beforeZeroToUnread, afterZeroToUnread);
    const unreadBadgeWidths = [await page.locator('.session-group-unread').first().evaluate(node => node.getBoundingClientRect().width)];
    for (let index = 1; index < 10; index += 1) {
      proxy.send(JSON.stringify({
        type: 'proxy_message', protocol_version: 1, session: 'sidebar-session-000', role: 'assistant',
        content: `Unread slot geometry probe ${index + 1}`, source: 'sidebar-stability-e2e',
        source_message_id: `sidebar-unread-slot-geometry-probe-${index + 1}`,
      }));
    }
    await page.waitForFunction(() => document.querySelector('.session-group-unread')?.textContent === '10');
    await page.waitForTimeout(100);
    const afterDoubleDigitUnread = await captureSidebar(page);
    unreadBadgeWidths.push(await page.locator('.session-group-unread').first().evaluate(node => node.getBoundingClientRect().width));
    for (let index = 10; index < 100; index += 1) {
      proxy.send(JSON.stringify({
        type: 'proxy_message', protocol_version: 1, session: 'sidebar-session-000', role: 'assistant',
        content: `Unread slot geometry probe ${index + 1}`, source: 'sidebar-stability-e2e',
        source_message_id: `sidebar-unread-slot-geometry-probe-${index + 1}`,
      }));
    }
    await page.waitForFunction(() => document.querySelector('.session-group-unread')?.textContent === '99+');
    await page.waitForTimeout(100);
    const afterCappedUnread = await captureSidebar(page);
    unreadBadgeWidths.push(await page.locator('.session-group-unread').first().evaluate(node => node.getBoundingClientRect().width));
    const unreadDigitTransitionOuterDeltaPx = Math.max(
      maxRectDelta(afterZeroToUnread, afterDoubleDigitUnread),
      maxRectDelta(afterDoubleDigitUnread, afterCappedUnread),
    );
    const unreadDigitTransitionCls = afterCappedUnread.layoutShift - afterZeroToUnread.layoutShift;
    await page.locator('.session-list').evaluate(node => { node.scrollTop = Math.min(900, node.scrollHeight - node.clientHeight); });
    await page.waitForTimeout(200);

    const before = await captureSidebar(page);
    let frameEvidence = null;
    if (framesDir) {
      fs.mkdirSync(framesDir, { recursive: true });
      const frameStem = `${viewport.width}x${viewport.height}-${colorScheme}-${sidebarWidth}px-${zoomPercent}pct${touchMode ? '-touch' : ''}${fontSubstitution ? '-fontsub' : ''}`;
      frameEvidence = {
        before: path.join(framesDir, `${frameStem}-before.png`),
        after: path.join(framesDir, `${frameStem}-after.png`),
        overlay: path.join(framesDir, `${frameStem}-overlay.png`),
      };
      await page.locator('.sidebar').screenshot({ path: frameEvidence.before, animations: 'disabled' });
    }
    const refreshSentAt = Date.now();
    const refreshActivity = {
      kind: 'working',
      label: 'Refresh marker',
      updated_at: new Date(Date.parse('2026-07-13T12:45:00Z')).toISOString(),
      started_at: new Date(Date.parse('2026-07-13T12:45:00Z')).toISOString(),
    };
    sendStatus(proxy, MARKER_SESSION_ID, {
      label: refreshActivity.label, updatedAt: refreshActivity.updated_at,
    });
    const refreshedSessions = sessions.map(session => session.session_id === MARKER_SESSION_ID
      ? { ...session, activity: refreshActivity, last_seen_at: '2026-07-13T13:00:00Z' }
      : session);
    proxy.send(JSON.stringify({
      type: 'session_list', protocol_version: 1, proxy_id: 'sidebar-stability-e2e', sessions: refreshedSessions,
    }));
    await page.waitForFunction(() => Number.isFinite(window.__RAC_SIDEBAR_STABILITY__?.markerPaintAt));
    const markerPaintAt = await page.evaluate(() => window.__RAC_SIDEBAR_STABILITY__.markerPaintAt);
    const refreshToPaintMs = markerPaintAt - refreshSentAt;
    await page.waitForTimeout(3_350);
    const afterRefresh = await captureSidebar(page);
    if (frameEvidence) {
      await page.locator('.sidebar').screenshot({ path: frameEvidence.after, animations: 'disabled' });
      writeHalfBlendOverlay(frameEvidence.before, frameEvidence.after, frameEvidence.overlay);
    }

    proxy.send(JSON.stringify({
      type: 'session_list', protocol_version: 1, proxy_id: 'sidebar-stability-e2e', sessions: refreshedSessions,
    }));
    await page.waitForTimeout(250);
    const afterIdenticalReconnect = await captureSidebar(page);

    const soakIndex = process.argv.indexOf('--soak-ms');
    const soakMs = soakIndex === -1 ? 0 : Number(process.argv[soakIndex + 1]);
    let soak = null;
    if (Number.isFinite(soakMs) && soakMs > 0) {
      await page.evaluate(() => {
        const paints = [];
        const observer = new MutationObserver(records => {
          for (const record of records) {
            const target = record.target.nodeType === Node.TEXT_NODE ? record.target.parentElement : record.target;
            const sub = target?.closest?.('.session-card-sub');
            const label = sub?.textContent || '';
            const match = label.match(/Soak refresh \d+/);
            if (!match) continue;
            const marker = match[0];
            requestAnimationFrame(() => requestAnimationFrame(() => paints.push({ marker, paintedAt: Date.now() })));
          }
        });
        observer.observe(document.querySelector('.session-list'), { childList: true, characterData: true, subtree: true });
        window.__RAC_SIDEBAR_SOAK__ = { paints, observer };
      });
      const soakBefore = await captureSidebar(page);
      const tickMs = 100;
      const totalTicks = Math.floor(soakMs / tickMs);
      const burstStarts = Array.from({ length: 10 }, (_, index) => (
        Math.floor(((index + 1) * totalTicks) / 11) - 5
      ));
      const sentAtByMarker = new Map();
      const measuredLatencies = [];
      const latestActivityBySession = new Map([[MARKER_SESSION_ID, refreshActivity]]);
      let sequence = 0;
      let oneHzEvents = 0;
      let burstEvents = 0;
      const startedAt = Date.now();
      for (let tick = 0; tick < totalTicks; tick += 1) {
        const oneHz = tick % 10 === 0;
        const burst = burstStarts.some(start => tick >= start && tick < start + 10);
        if (oneHz || burst) {
          if (oneHz) oneHzEvents += 1;
          if (burst) burstEvents += 1;
          sequence += 1;
          const sid = `sidebar-session-${String(sequence % 5).padStart(3, '0')}`;
          const marker = `Soak refresh ${sequence}`;
          const sentAt = Date.now();
          const updatedAt = new Date(Date.parse('2026-07-13T14:00:00Z') + sequence * 1_000).toISOString();
          latestActivityBySession.set(sid, {
            kind: 'working', label: marker, updated_at: updatedAt, started_at: updatedAt,
          });
          sentAtByMarker.set(marker, sentAt);
          sendStatus(proxy, sid, {
            label: marker,
            updatedAt,
          });
          if (sequence % 4 === 0) {
            proxy.send(JSON.stringify({
              type: 'proxy_message', protocol_version: 1, session: sid, role: 'assistant',
              content: `Unread summary ${sequence}`, source: 'sidebar-soak',
              source_message_id: `sidebar-soak-${sequence}`,
            }));
          }
          if (sequence % 20 === 0) {
            proxy.send(JSON.stringify({
              type: 'permission_prompt', protocol_version: 1, session_id: 'sidebar-session-010',
              prompt_id: `soak-prompt-${sequence}`, title: 'Soak action required', message: 'Confirm fixture action',
            }));
          } else if (sequence % 20 === 5) {
            proxy.send(JSON.stringify({ type: 'permission_prompt_expired', protocol_version: 1, session_id: 'sidebar-session-010' }));
          }
          if (sequence % 25 === 0) {
            const snapshot = sessions.map((session, index) => ({
              ...session,
              ...(latestActivityBySession.has(session.session_id)
                ? { activity: latestActivityBySession.get(session.session_id) }
                : {}),
              chat_title: `${READABILITY_TITLES[index] || `Stable card ${String(index).padStart(2, '0')}`} · hydration ${sequence}`,
              last_seen_at: new Date(Date.parse('2026-07-13T15:00:00Z') + (sequence + index) * 1_000).toISOString(),
            }));
            proxy.send(JSON.stringify({
              type: 'session_list', protocol_version: 1, proxy_id: 'sidebar-stability-e2e', sessions: snapshot,
            }));
          }
          await page.waitForFunction(({ sessionId, expected }) => (
            document.querySelector(`[data-session-id="${sessionId}"] .session-card-sub`)?.textContent?.includes(expected)
          ), { sessionId: sid, expected: marker }, { timeout: 750 });
          const paintedAt = await page.evaluate(() => new Promise(resolve => {
            requestAnimationFrame(() => setTimeout(() => resolve(Date.now()), 0));
          }));
          measuredLatencies.push(paintedAt - sentAt);
        }
        const nextTickAt = startedAt + (tick + 1) * tickMs;
        const delay = nextTickAt - Date.now();
        if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
      }
      await page.waitForTimeout(650);
      const soakAfter = await captureSidebar(page);
      const painted = await page.evaluate(() => {
        window.__RAC_SIDEBAR_SOAK__?.observer?.disconnect();
        return window.__RAC_SIDEBAR_SOAK__?.paints || [];
      });
      const paintedAtByMarker = new Map(painted.map(entry => [entry.marker, entry.paintedAt]));
      const observerLatencies = [...sentAtByMarker.entries()].map(([marker, sentAt]) => (
        paintedAtByMarker.has(marker) ? paintedAtByMarker.get(marker) - sentAt : null
      )).filter(Number.isFinite);
      const latencies = measuredLatencies;
      const commonSoakOrderBefore = soakBefore.order.filter(id => soakAfter.order.includes(id));
      const commonSoakOrderAfter = soakAfter.order.filter(id => soakBefore.order.includes(id));
      soak = {
        requested_duration_ms: soakMs,
        measured_duration_ms: Date.now() - startedAt,
        one_hz_events: oneHzEvents,
        ten_hz_bursts: burstStarts.length,
        burst_events: burstEvents,
        total_refresh_events: sentAtByMarker.size,
        painted_refresh_events: latencies.length,
        observer_painted_refresh_events: observerLatencies.length,
        missing_paints: sentAtByMarker.size - latencies.length,
        refresh_to_paint_p50_ms: percentile(latencies, 0.5),
        refresh_to_paint_p95_ms: percentile(latencies, 0.95),
        refresh_to_paint_max_ms: latencies.length ? Math.max(...latencies) : null,
        order_stable: JSON.stringify(commonSoakOrderBefore) === JSON.stringify(commonSoakOrderAfter),
        outer_card_max_delta_px: Number(maxRectDelta(soakBefore, soakAfter).toFixed(3)),
        sidebar_cls: soakAfter.layoutShift - soakBefore.layoutShift,
        layout_shift_entries: soakAfter.layoutShiftEntries.slice(soakBefore.layoutShiftEntries.length),
        selected_card_drift_px: Number(Math.abs(soakBefore.selectedTop - soakAfter.selectedTop).toFixed(3)),
        scroll_top_drift_px: Number(Math.abs(soakBefore.scrollTop - soakAfter.scrollTop).toFixed(3)),
        stable_dom_identity: soakAfter.nodeIdentityStable,
        stable_keyboard_focus: soakAfter.focusedSession === SELECTED_SESSION_ID,
        refresh_animation_names: soakAfter.animationNames,
      };
    }

    const structuralViolations = [];
    let currentSessions = refreshedSessions;

    await page.locator(`.session-card[data-session-id="${SELECTED_SESSION_ID}"]`).scrollIntoViewIfNeeded();
    const pressedCard = page.locator(`.session-card[data-session-id="${SELECTED_SESSION_ID}"]`);
    const pressedBox = await pressedCard.boundingBox();
    assert(pressedBox, 'selected pointer target must be visible');
    const pointerX = pressedBox.x + Math.min(44, pressedBox.width / 3);
    const pointerY = pressedBox.y + pressedBox.height / 2;
    await page.mouse.move(pointerX, pointerY);
    await page.mouse.down();
    const pointerSessionBefore = await page.evaluate(({ x, y }) => (
      document.elementFromPoint(x, y)?.closest?.('[data-session-id]')?.dataset?.sessionId || null
    ), { x: pointerX, y: pointerY });
    sendStatus(proxy, MARKER_SESSION_ID, {
      label: 'Pointer refresh marker', updatedAt: '2026-07-13T15:00:00Z',
    });
    currentSessions = currentSessions.map(session => session.session_id === MARKER_SESSION_ID
      ? { ...session, last_seen_at: '2026-07-13T15:00:00Z' }
      : session);
    proxy.send(JSON.stringify({ type: 'session_list', protocol_version: 1, proxy_id: 'sidebar-stability-e2e', sessions: currentSessions }));
    await page.waitForTimeout(180);
    const pointerSessionAfter = await page.evaluate(({ x, y }) => (
      document.elementFromPoint(x, y)?.closest?.('[data-session-id]')?.dataset?.sessionId || null
    ), { x: pointerX, y: pointerY });
    await page.mouse.up();
    if (viewport.width <= 640 && await page.locator('.sidebar.open').count() === 0) {
      await page.locator('.hamburger').click();
      await page.locator('.sidebar.open').waitFor();
    }
    if (pointerSessionBefore !== SELECTED_SESSION_ID || pointerSessionAfter !== pointerSessionBefore) {
      structuralViolations.push(`pointer target changed from ${pointerSessionBefore} to ${pointerSessionAfter}`);
    }

    let touchTargetStable = null;
    let momentumRefreshStable = null;
    if (touchMode) {
      await pressedCard.scrollIntoViewIfNeeded();
      const touchBox = await pressedCard.boundingBox();
      const touchPoint = { x: touchBox.x + touchBox.width / 2, y: touchBox.y + touchBox.height / 2 };
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart', touchPoints: [{ ...touchPoint, radiusX: 4, radiusY: 4, force: 1 }],
      });
      sendStatus(proxy, SELECTED_SESSION_ID, {
        label: 'Touch-held refresh marker', updatedAt: '2026-07-13T15:00:30Z',
      });
      await page.waitForTimeout(150);
      const touchSessionAfter = await page.evaluate(({ x, y }) => (
        document.elementFromPoint(x, y)?.closest?.('[data-session-id]')?.dataset?.sessionId || null
      ), touchPoint);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      if (viewport.width <= 640 && await page.locator('.sidebar.open').count() === 0) {
        await page.locator('.hamburger').click();
        await page.locator('.sidebar.open').waitFor();
      }
      touchTargetStable = touchSessionAfter === SELECTED_SESSION_ID;
      if (!touchTargetStable) structuralViolations.push(`touch target changed to ${touchSessionAfter}`);

      const momentumBefore = await captureSidebar(page);
      await page.locator('.session-list').evaluate(node => node.scrollBy({ top: 240, behavior: 'smooth' }));
      sendStatus(proxy, 'sidebar-session-003', {
        label: 'Momentum refresh marker', updatedAt: '2026-07-13T15:00:31Z',
      });
      await page.waitForTimeout(650);
      const momentumAfter = await captureSidebar(page);
      momentumRefreshStable = JSON.stringify(momentumBefore.order) === JSON.stringify(momentumAfter.order)
        && momentumAfter.nodeIdentityStable;
      if (!momentumRefreshStable) structuralViolations.push('momentum-scroll refresh reordered or remounted cards');
    }

    await page.keyboard.press('Control+p');
    const quickSearch = page.getByLabel('Search sessions');
    await quickSearch.waitFor();
    await quickSearch.fill('Stable card 34');
    const quickResultsBefore = await page.locator('.quick-switcher-option').count();
    sendStatus(proxy, MARKER_SESSION_ID, {
      label: 'Search refresh marker', updatedAt: '2026-07-13T15:01:00Z',
    });
    await page.waitForTimeout(150);
    const quickResultsAfter = await page.locator('.quick-switcher-option').count();
    const searchFocused = await quickSearch.evaluate(node => document.activeElement === node && node.value === 'Stable card 34');
    if (!searchFocused || quickResultsBefore !== quickResultsAfter || quickResultsAfter < 1) {
      structuralViolations.push('quick-switcher search/focus changed during refresh');
    }
    await page.keyboard.press('Escape');

    const groupHeaders = page.locator('.session-group-header');
    const groupHeaderCount = await groupHeaders.count();
    assert(groupHeaderCount > 0, 'fixture must render collapsible groups');
    const firstGroupHeader = groupHeaders.nth(0);
    const firstGroupToggle = firstGroupHeader.locator('.session-group-toggle');
    await firstGroupToggle.click();
    const collapsedBeforeRefresh = await firstGroupToggle.getAttribute('aria-expanded');
    sendStatus(proxy, MARKER_SESSION_ID, {
      label: 'Collapsed refresh marker', updatedAt: '2026-07-13T15:02:00Z',
    });
    await page.waitForTimeout(150);
    const collapsedAfterRefresh = await firstGroupToggle.getAttribute('aria-expanded');
    if (collapsedBeforeRefresh !== 'false' || collapsedAfterRefresh !== 'false') {
      structuralViolations.push('group collapse state changed during refresh');
    }
    await firstGroupToggle.click();

    await page.locator('.session-list').evaluate(node => {
      node.scrollTop = Math.min(850, node.scrollHeight - node.clientHeight);
      node.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    await page.waitForTimeout(240);
    const beforeNewSession = await captureSidebar(page);
    const newSession = {
      session_id: 'sidebar-session-new', agent_type: 'codex_cli', display_name: 'New stable session',
      chat_title: 'New stable session', workspace_name: 'Project 3',
      project_root: 'C:\\production-shape\\project-3', workspace_path: 'C:\\production-shape\\project-3\\new',
      last_seen_at: '2026-07-13T16:00:00Z', health: 'connected',
    };
    currentSessions = [...currentSessions, newSession];
    proxy.send(JSON.stringify({ type: 'session_list', protocol_version: 1, proxy_id: 'sidebar-stability-e2e', sessions: currentSessions }));
    await page.waitForFunction(() => document.querySelectorAll('.session-card[data-session-id]').length === 70);
    const afterNewSession = await captureSidebar(page);
    await page.evaluate(() => {
      const node = document.querySelector('[data-session-id="sidebar-session-new"]');
      if (node) window.__RAC_SIDEBAR_STABILITY__?.nodes?.set('sidebar-session-new', node);
    });
    const newSessionGroupIds = await page.locator('.session-group')
      .filter({ has: page.locator('[data-session-id="sidebar-session-new"]') })
      .locator('.session-card[data-session-id]').evaluateAll(nodes => nodes.map(node => node.dataset.sessionId));
    const newVisibleDelta = maxRectDeltaForIds(beforeNewSession, afterNewSession, beforeNewSession.visibleOrder);
    if (newVisibleDelta > 0.5 || newSessionGroupIds.at(-1) !== newSession.session_id) {
      structuralViolations.push(`new session did not append without visible movement (${newVisibleDelta.toFixed(3)}px)`);
    }

    const beforeLateMetadata = await captureSidebar(page);
    currentSessions = currentSessions.map(session => session.session_id === 'sidebar-session-010'
      ? { ...session, project_root: 'C:\\production-shape\\project-3', workspace_path: 'C:\\production-shape\\project-3\\late' }
      : session);
    proxy.send(JSON.stringify({ type: 'session_list', protocol_version: 1, proxy_id: 'sidebar-stability-e2e', sessions: currentSessions }));
    await page.waitForTimeout(250);
    const afterLateMetadata = await captureSidebar(page);
    if (JSON.stringify(beforeLateMetadata.order) !== JSON.stringify(afterLateMetadata.order)
      || maxRectDelta(beforeLateMetadata, afterLateMetadata) > 0.5) {
      structuralViolations.push('late workspace metadata moved a pinned card');
    }

    await page.locator('.session-list').evaluate(node => {
      node.scrollTop = Math.min(1_250, node.scrollHeight - node.clientHeight);
      node.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    await page.waitForTimeout(40);
    const beforeRemoval = await captureSidebar(page);
    const removalId = beforeRemoval.order.find(id => !beforeRemoval.visibleOrder.includes(id));
    assert(removalId, 'fixture must have a removable session above the viewport');
    currentSessions = currentSessions.filter(session => session.session_id !== removalId);
    proxy.send(JSON.stringify({ type: 'session_list', protocol_version: 1, proxy_id: 'sidebar-stability-e2e', sessions: currentSessions }));
    await page.waitForFunction(() => document.querySelectorAll('.session-card[data-session-id]').length === 69);
    await page.waitForTimeout(350);
    const afterRemoval = await captureSidebar(page);
    const removalVisibleIds = beforeRemoval.visibleOrder.filter(id => id !== removalId && afterRemoval.cards[id]);
    const removalVisibleDelta = maxRectDeltaForIds(beforeRemoval, afterRemoval, removalVisibleIds);
    if (removalVisibleDelta > 1 || !afterRemoval.nodeIdentityStable) {
      structuralViolations.push(`removal above viewport lost its visual anchor (${removalVisibleDelta.toFixed(3)}px; remounted=${afterRemoval.remountedSessionIds.map(id => `${id}:${beforeRemoval.sectionBySession[id]}->${afterRemoval.sectionBySession[id]}`).join(',')})`);
    }

    await page.locator(`.session-card[data-session-id="${SELECTED_SESSION_ID}"]`).scrollIntoViewIfNeeded();
    await page.locator(`.session-card[data-session-id="${SELECTED_SESSION_ID}"] .session-card-manage`).focus();
    await page.waitForTimeout(50);
    const beforeExplicitSort = await captureSidebar(page);
    const sortButton = page.getByRole('button', { name: 'Sort now' });
    await sortButton.waitFor();
    await sortButton.click();
    await page.waitForFunction(() => !document.querySelector('.sidebar-order-control')?.classList.contains('changed'));
    const afterExplicitSort = await captureSidebar(page);
    const explicitSortApplied = JSON.stringify(beforeExplicitSort.order) !== JSON.stringify(afterExplicitSort.order);
    const explicitSelectedStable = await page.locator(`.session-card.active[data-session-id="${SELECTED_SESSION_ID}"]`).count() === 1;
    const explicitSelectedDrift = Math.abs(beforeExplicitSort.selectedTop - afterExplicitSort.selectedTop);
    if (!explicitSortApplied || !explicitSelectedStable || explicitSelectedDrift > 1) {
      structuralViolations.push(`explicit sort lost selection/anchor (applied=${explicitSortApplied}, drift=${explicitSelectedDrift.toFixed(3)}px)`);
    }

    const commonBefore = before.order.filter(id => afterRefresh.order.includes(id));
    const commonAfter = afterRefresh.order.filter(id => before.order.includes(id));
    const orderStable = JSON.stringify(commonBefore) === JSON.stringify(commonAfter);
    const reconnectOrderStable = JSON.stringify(afterRefresh.order) === JSON.stringify(afterIdenticalReconnect.order);
    const outerCardDeltaPx = maxRectDelta(before, afterRefresh);
    const selectedCardDriftPx = Math.abs(before.selectedTop - afterRefresh.selectedTop);
    const scrollDriftPx = Math.abs(before.scrollTop - afterRefresh.scrollTop);
    const violations = [...structuralViolations];
    if (!readability.all_title_sources_exact) violations.push('readability fixture title source changed before hydration');
    if (!readability.all_title_budgets_pass) violations.push(`title visible-grapheme budget failed (minimum ${readability.minimum_visible_graphemes})`);
    if (readability.sidebar_horizontal_overflow) violations.push('sidebar introduced horizontal overflow');
    if (readability.group_title !== READABILITY_GROUP || readability.group_visible_graphemes < 24) violations.push('group title readability budget failed');
    if (readability.separate_card_action_buttons !== 0 || readability.session_action_menu_count !== READABILITY_TITLES.length) violations.push('secondary card actions were not consolidated into one menu');
    if (!readability.pointer_disclosure_visible || !readability.pointer_disclosure_exact) violations.push('pointer full-title disclosure failed');
    if (!readability.keyboard_disclosure_visible) violations.push('keyboard full-title disclosure failed');
    if (!readability.tap_disclosure_visible) violations.push('touch/click full-title disclosure failed');
    if (!readability.group_keyboard_disclosure_visible || !readability.group_tap_disclosure_visible || !readability.group_disclosure_exact) violations.push('group full-title disclosure failed');
    for (const [label, geometry] of [
      ['pointer', readability.pointer_disclosure_geometry],
      ['keyboard', readability.keyboard_disclosure_geometry],
      ['tap', readability.tap_disclosure_geometry],
      ['group', readability.group_disclosure_geometry],
    ]) {
      if (!geometry?.portaled_to_body || !geometry?.fully_in_viewport) {
        violations.push(`${label} title disclosure remained clipped or outside the viewport`);
      }
      if (layoutViewport.width > 640 && (geometry?.placement !== 'right'
        || !geometry?.right_of_sidebar || geometry?.overlaps_sidebar_title_column)) {
        violations.push(`${label} title disclosure did not escape to the right of the sidebar`);
      }
      if (layoutViewport.width <= 640 && geometry?.placement !== 'sheet') {
        violations.push(`${label} title disclosure did not use viewport-safe touch geometry`);
      }
    }
    if (touchMode && !readability.long_press_disclosure_visible) violations.push('touch long-press full-title disclosure failed');
    const minimumActionTarget = layoutViewport.width <= 640 ? 44 : 28;
    if (!readability.action_hit_target_px || readability.action_hit_target_px.width < minimumActionTarget || readability.action_hit_target_px.height < minimumActionTarget) violations.push('session action hit target is too small');
    if (!readability.title_accessible_name_exact || !readability.group_accessible_name_exact || !readability.action_accessible_name_exact) violations.push('title/group/action accessible names are incomplete');
    if (!readability.action_menu_keyboard_open || JSON.stringify(readability.action_menu_items) !== JSON.stringify(['Pin chat', 'Manage session', 'Automations', 'Skills', 'Close session'])) violations.push('keyboard action menu lost Pin/Manage/Automations/Skills/Close');
    if (zeroToUnreadOuterDeltaPx > 0.5) violations.push(`zero-to-unread group badge moved cards ${zeroToUnreadOuterDeltaPx.toFixed(3)}px`);
    if (unreadDigitTransitionOuterDeltaPx > 0.5) violations.push(`unread digit transition moved cards ${unreadDigitTransitionOuterDeltaPx.toFixed(3)}px`);
    if (unreadDigitTransitionCls !== 0) violations.push(`unread digit transition CLS was ${unreadDigitTransitionCls}`);
    if (Math.max(...unreadBadgeWidths) - Math.min(...unreadBadgeWidths) > 0.5) violations.push(`unread badge width changed across 1/10/99+: ${unreadBadgeWidths.join('/')}`);
    if (!orderStable) violations.push('ordinary refresh automatically reordered cards');
    if (outerCardDeltaPx > 0.5) violations.push(`outer card coordinates moved ${outerCardDeltaPx.toFixed(3)}px`);
    if (afterRefresh.layoutShift !== 0) violations.push(`sidebar CLS was ${afterRefresh.layoutShift}`);
    if (selectedCardDriftPx > 1) violations.push(`selected card drifted ${selectedCardDriftPx.toFixed(3)}px`);
    if (scrollDriftPx > 1) violations.push(`scrollTop drifted ${scrollDriftPx.toFixed(3)}px`);
    if (!afterRefresh.nodeIdentityStable) violations.push('a keyed card DOM node was replaced');
    if (afterRefresh.focusedSession !== SELECTED_SESSION_ID) violations.push('keyboard focus left the selected card');
    if (afterRefresh.animationNames.length) violations.push(`refresh rank animation fired: ${afterRefresh.animationNames.join(', ')}`);
    if (refreshToPaintMs > 100) violations.push(`refresh-to-paint p95 gate exceeded: ${refreshToPaintMs}ms`);
    if (!reconnectOrderStable || !afterIdenticalReconnect.nodeIdentityStable) violations.push('identical reconnect reordered or remounted cards');
    if (soak) {
      if (soak.missing_paints) violations.push(`${soak.missing_paints} soak refreshes were not painted`);
      if (soak.refresh_to_paint_p95_ms > 100) violations.push(`soak refresh-to-paint p95 was ${soak.refresh_to_paint_p95_ms}ms`);
      if (!soak.order_stable) violations.push('soak refresh traffic reordered cards');
      if (soak.outer_card_max_delta_px > 0.5) violations.push(`soak outer cards moved ${soak.outer_card_max_delta_px}px`);
      if (soak.sidebar_cls !== 0) violations.push(`soak sidebar CLS was ${soak.sidebar_cls}`);
      if (soak.selected_card_drift_px > 1 || soak.scroll_top_drift_px > 1) violations.push('soak selection or scroll anchor drifted');
      if (!soak.stable_dom_identity || !soak.stable_keyboard_focus) violations.push('soak remounted a card or moved keyboard focus');
      if (soak.refresh_animation_names.length) violations.push('soak refresh animation fired');
    }

    const result = {
      status: violations.length ? 'FAIL' : 'PASS',
      actual_relay: true,
      actual_built_bundle: true,
      production_shape_sessions: SESSION_COUNT,
      working_sessions: 5,
      viewport: viewportText,
      color_scheme: colorScheme,
      sidebar_width_requested_px: sidebarWidth,
      zoom_percent: zoomPercent,
      font_substitution: fontSubstitution ? 'Georgia, Times New Roman, serif' : null,
      readability,
      order_stable: orderStable,
      moved_session_count: commonBefore.filter((id, index) => commonAfter[index] !== id).length,
      outer_card_max_delta_px: Number(outerCardDeltaPx.toFixed(3)),
      sidebar_cls: afterRefresh.layoutShift,
      layout_shift_entries: afterRefresh.layoutShiftEntries,
      ignored_non_sidebar_shift_entries: afterRefresh.ignoredNonSidebarShiftEntries,
      selected_card_drift_px: Number(selectedCardDriftPx.toFixed(3)),
      scroll_top_drift_px: Number(scrollDriftPx.toFixed(3)),
      stable_dom_identity: afterRefresh.nodeIdentityStable,
      stable_keyboard_focus: afterRefresh.focusedSession === SELECTED_SESSION_ID,
      refresh_animation_names: afterRefresh.animationNames,
      refresh_to_paint_ms: refreshToPaintMs,
      identical_reconnect_stable: reconnectOrderStable && afterIdenticalReconnect.nodeIdentityStable,
      frame_evidence: frameEvidence && Object.fromEntries(Object.entries(frameEvidence).map(([key, value]) => [
        key, path.relative(path.join(__dirname, '..'), value).replace(/\\/g, '/'),
      ])),
      soak,
      pointer_target_stable: pointerSessionBefore === SELECTED_SESSION_ID && pointerSessionAfter === pointerSessionBefore,
      touch_target_stable: touchTargetStable,
      momentum_refresh_stable: momentumRefreshStable,
      search_focus_stable: searchFocused,
      collapse_state_stable: collapsedBeforeRefresh === 'false' && collapsedAfterRefresh === 'false',
      zero_to_unread_outer_card_delta_px: Number(zeroToUnreadOuterDeltaPx.toFixed(3)),
      unread_digit_transition_outer_card_delta_px: Number(unreadDigitTransitionOuterDeltaPx.toFixed(3)),
      unread_digit_transition_cls: unreadDigitTransitionCls,
      unread_badge_widths_px: unreadBadgeWidths.map(value => Number(value.toFixed(3))),
      new_session_appended: newSessionGroupIds.at(-1) === newSession.session_id,
      new_session_visible_card_delta_px: Number(newVisibleDelta.toFixed(3)),
      late_metadata_queued: JSON.stringify(beforeLateMetadata.order) === JSON.stringify(afterLateMetadata.order),
      removal_visible_card_delta_px: Number(removalVisibleDelta.toFixed(3)),
      removal_scroll_compensation_px: Number(Math.abs(beforeRemoval.scrollTop - afterRemoval.scrollTop).toFixed(3)),
      explicit_sort_applied: explicitSortApplied,
      explicit_sort_selected_drift_px: Number(explicitSelectedDrift.toFixed(3)),
      initial_order: before.order,
      final_order: afterRefresh.order,
      violations,
      visible_windows: 0,
      protected_user_apps_touched: 0,
      recorded_at: new Date().toISOString(),
    };
    const evidenceIndex = process.argv.indexOf('--evidence');
    if (evidenceIndex !== -1) {
      const evidencePath = process.argv[evidenceIndex + 1];
      assert(evidencePath, '--evidence requires an output path');
      fs.mkdirSync(path.dirname(path.resolve(evidencePath)), { recursive: true });
      fs.writeFileSync(path.resolve(evidencePath), `${JSON.stringify(result, null, 2)}\n`);
    }
    console.log(JSON.stringify(result, null, 2));
    assert.deepStrictEqual(violations, [], `sidebar refresh stability violations:\n- ${violations.join('\n- ')}`);
  } catch (error) {
    throw new Error(`${error.stack || error}\n--- relay output ---\n${relayOutput.join('')}`);
  } finally {
    await browser?.close();
    await closeSocket(proxy);
    if (child.exitCode == null) {
      await new Promise(resolve => {
        child.once('exit', resolve);
        child.kill();
        setTimeout(() => child.exitCode == null && child.kill('SIGKILL'), 1_000).unref();
      });
    }
    const resolved = path.resolve(tempRoot);
    assert(resolved.startsWith(path.resolve(os.tmpdir(), 'rac-sidebar-stability-')));
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
