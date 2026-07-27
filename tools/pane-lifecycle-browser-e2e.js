#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  SCENARIOS,
  SESSION_ID,
  baseSession,
  configureContext,
  launchHeadlessBrowser,
  startFixtureServer,
} = require('./mobile-viewport-browser-e2e');
const fidelity = require('./run-fidelity-regression');

const ROOT = path.resolve(__dirname, '..');
const FIXTURE_MODEL = 'gpt-5.4-mini';
const FIXTURE_EFFORT = 'low';
const CHAT_ADJACENT_TOGGLES = Object.freeze({
  'branch-selector': '[data-pane-toggle="branch-selector"]',
  'chat-list': '[data-pane-toggle="chat-list"]',
  'thread-list': '[data-pane-toggle="thread-list"]',
  terminal: '[data-pane-toggle="terminal"]',
  'diff-viewer': '[data-pane-toggle="diff-viewer"]',
  'file-browser': '[data-pane-toggle="file-browser"]',
  'scheduled-send': '[data-pane-toggle="scheduled-send"]',
  'composer-settings': '[data-pane-toggle="composer-settings"]',
  'agent-settings': '[data-pane-toggle="agent-settings"]',
});
const MATRIX_PROFILES = Object.freeze([
  { id: 'desktop-1440x900', width: 1440, height: 900, mobile: false },
  { id: 'phone-390x844', width: 390, height: 844, mobile: true },
  { id: 'phone-320x568', width: 320, height: 568, mobile: true },
  { id: 'landscape-844x390', width: 844, height: 390, mobile: true },
  { id: 'keyboard-390x560', width: 390, height: 560, mobile: true, keyboard: true },
]);

function valueAfter(argv, flag) {
  const index = argv.indexOf(flag);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : '';
}

function parseArgs(argv) {
  const assetSource = valueAfter(argv, '--asset-source') || 'local';
  assert(['local', 'production'].includes(assetSource), '--asset-source must be local or production');
  const output = valueAfter(argv, '--output');
  const screenshotsDir = valueAfter(argv, '--screenshots-dir');
  assert(output, '--output is required');
  assert(screenshotsDir, '--screenshots-dir is required');
  const soakMs = Number(valueAfter(argv, '--soak-ms') || 5_000);
  assert(Number.isFinite(soakMs) && soakMs >= 1_000, '--soak-ms must be at least 1000');
  return {
    assetSource,
    output: path.resolve(output),
    screenshotsDir: path.resolve(screenshotsDir),
    soakMs,
    matrix: argv.includes('--matrix'),
    assertAcceptance: argv.includes('--assert-acceptance'),
  };
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function receiptPath(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, '/');
}

function scenario(id) {
  const value = SCENARIOS.find(item => item.id === id);
  assert(value, `fixture scenario ${id} is unavailable`);
  return value;
}

function broadSession(activity, writeGate = '') {
  const session = baseSession(activity, writeGate);
  session.is_test_session = false;
  session.agent_type = 'codex-desktop';
  session.title = 'P3-40 disposable cross-harness pane fixture';
  session.chat_title = 'P3-40 disposable cross-harness pane fixture';
  session.native_host_label = 'Codex Desktop disposable fixture';
  session.config = {
    ...session.config,
    model: FIXTURE_MODEL,
    model_id: FIXTURE_MODEL,
    effort: FIXTURE_EFFORT,
    capabilities: {
      ...session.config.capabilities,
      send: true,
      interrupt: true,
      question_prompts: true,
      permission_dialogs: true,
      set_codex_config: true,
      agent_config: true,
      chat_list: true,
      thread_list: true,
      terminal_output: true,
      terminal_input: true,
      file_changes: true,
      branch_list: true,
      file_browser: true,
      automation_view: true,
      skill_list: true,
      new_thread: true,
      new_chat: true,
    },
    available_models: [{ id: FIXTURE_MODEL, label: 'GPT-5.4 mini' }],
    available_efforts: [{ id: FIXTURE_EFFORT, label: 'Low' }],
  };
  return session;
}

function fixtureResponse({ frame, send }) {
  const sessionId = frame.session_id || frame.session || SESSION_ID;
  if (frame.type === 'branch_list_request' || frame.type === 'branch_list') {
    send({
      type: 'branch_list',
      session_id: sessionId,
      branches: ['master', 'feature/pane-fixture', 'release/pane-lifecycle'],
      current: 'master',
    });
  } else if (frame.type === 'chat_list_request' || frame.type === 'chat_list') {
    send({
      type: 'chat_list',
      session_id: sessionId,
      chats: [{ id: 'chat-1', title: 'Fixture chat', active: true }],
    });
  } else if (frame.type === 'thread_list_request' || frame.type === 'thread_list') {
    send({
      type: 'thread_list',
      session_id: sessionId,
      threads: [{ id: 'thread-1', title: 'Fixture thread', active: true, cache_key: 'fixture-thread' }],
    });
  } else if (frame.type === 'terminal_output_request' || frame.type === 'terminal_output') {
    send({
      type: 'terminal_output',
      session_id: sessionId,
      entries: [{ command: 'echo pane', output: 'pane fixture output' }],
    });
  } else if (frame.type === 'file_changes_request' || frame.type === 'file_changes') {
    send({
      type: 'file_changes',
      session_id: sessionId,
      entries: [{ id: 'change-1', path: 'fixture.txt', content: '+fixture', can_accept: true, can_reject: true }],
    });
  } else if (frame.type === 'directory_listing_request' || frame.type === 'directory_listing') {
    send({
      type: 'directory_listing',
      session_id: sessionId,
      path: frame.path || '.',
      entries: [{ name: 'fixture.md', path: 'fixture.md', type: 'file', size: 64 }],
    });
  } else if (frame.type === 'file_content_request' || frame.type === 'file_content') {
    send({
      type: 'file_content',
      session_id: sessionId,
      path: frame.path || 'fixture.md',
      content: '# Disposable pane fixture',
    });
  }
}

function browserContextOptions(profile, theme = 'dark') {
  const mobile = profile.mobile === true;
  return {
    viewport: { width: profile.width, height: profile.height },
    deviceScaleFactor: mobile ? 2 : 1,
    isMobile: mobile,
    hasTouch: mobile,
    serviceWorkers: 'block',
    userAgent: mobile
      ? 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/136.0 Mobile Safari/537.36'
      : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/136.0 Safari/537.36',
    colorScheme: theme,
  };
}

async function createPage(browser, fixture, profile, theme, tag) {
  const context = await browser.newContext(browserContextOptions(profile, theme));
  await configureContext(context, theme);
  const page = await context.newPage();
  const diagnostics = [];
  page.on('console', message => {
    if (message.type() === 'error' && !/Failed to load resource:/i.test(message.text())) {
      diagnostics.push(`console:${message.text()}`);
    }
  });
  page.on('pageerror', error => diagnostics.push(`pageerror:${error.message}`));
  const response = await page.goto(`${fixture.url}/?p3_40=${tag}&t=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });
  assert(response && response.status() === 200, `${tag}: app shell failed`);
  await page.waitForSelector(`.session-card[data-session-id="${SESSION_ID}"]`, {
    state: 'attached',
    timeout: 15_000,
  });
  await page.locator(`.session-card[data-session-id="${SESSION_ID}"]`).evaluate(node => node.click());
  await page.waitForFunction(
    id => document.querySelector('.session-card.active')?.dataset.sessionId === id,
    SESSION_ID,
    { timeout: 10_000 },
  );
  await page.waitForSelector('.messages .message[data-message-key]', { timeout: 15_000 });
  return { context, page, diagnostics };
}

async function clickVisible(page, selector, description = selector) {
  const locator = page.locator(selector);
  const index = await locator.evaluateAll(nodes => nodes.findIndex(candidate => {
      const style = getComputedStyle(candidate);
      const rect = candidate.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    }));
  if (index < 0) {
    const details = await locator.evaluateAll(nodes => nodes.map(node => ({
      outer_html: node.outerHTML.slice(0, 500),
      display: getComputedStyle(node).display,
      visibility: getComputedStyle(node).visibility,
      rect: {
        width: node.getBoundingClientRect().width,
        height: node.getBoundingClientRect().height,
        top: node.getBoundingClientRect().top,
        left: node.getBoundingClientRect().left,
      },
    })));
    throw new assert.AssertionError({
      message: `no visible ${description}; candidates=${JSON.stringify(details)}`,
    });
  }
  await locator.nth(index).click();
}

async function waitPaneState(page, paneId, state) {
  await page.waitForFunction(
    ({ id, expected }) => document.querySelector(`[data-pane-id="${id}"]`)?.dataset.paneState === expected,
    { id: paneId, expected: state },
    { timeout: 10_000 },
  );
}

async function openPane(page, paneId, { allowHiddenToggle = false } = {}) {
  const selector = CHAT_ADJACENT_TOGGLES[paneId];
  assert(selector, `missing toggle selector for ${paneId}`);
  if (allowHiddenToggle) {
    const toggle = page.locator(selector).first();
    assert(await toggle.count(), `missing ${paneId} toggle`);
    await toggle.evaluate(node => node.click());
  } else {
    await clickVisible(page, selector, `${paneId} toggle`);
  }
  await waitPaneState(page, paneId, 'open');
}

async function minimizePane(page, paneId) {
  await clickVisible(page, `[data-pane-id="${paneId}"] .pane-minimize-btn`, `${paneId} minimize button`);
  await waitPaneState(page, paneId, 'minimized');
}

async function restorePane(page, paneId) {
  await clickVisible(page, `[data-pane-restore="${paneId}"]`, `${paneId} restore chip`);
  await waitPaneState(page, paneId, 'open');
}

async function paneStateSnapshot(page) {
  return page.evaluate(() => ({
    states: Object.fromEntries(
      Array.from(document.querySelectorAll('[data-pane-id][data-pane-state]'))
        .map(node => [node.dataset.paneId, node.dataset.paneState]),
    ),
    open: Array.from(document.querySelectorAll('[data-pane-id][data-pane-state="open"]'))
      .map(node => node.dataset.paneId),
    minimized: Array.from(document.querySelectorAll('[data-pane-id][data-pane-state="minimized"]'))
      .map(node => node.dataset.paneId),
    restore: Array.from(document.querySelectorAll('[data-pane-restore]'))
      .map(node => ({
        pane_id: node.dataset.paneRestore,
        aria_controls: node.getAttribute('aria-controls'),
        aria_expanded: node.getAttribute('aria-expanded'),
        rect: {
          width: node.getBoundingClientRect().width,
          height: node.getBoundingClientRect().height,
        },
      })),
    rail_height_px: document.querySelector('.pane-restore-rail')?.getBoundingClientRect().height || 0,
  }));
}

async function transcriptSnapshot(page) {
  return page.evaluate(() => {
    const list = document.querySelector('.messages');
    const rows = Array.from(list?.querySelectorAll('.message[data-message-key]') || []);
    return {
      session_id: document.querySelector('.session-card.active')?.dataset.sessionId || '',
      keys: rows.map(row => row.dataset.messageKey),
      source_ids: rows.map(row => row.dataset.messageSourceId || ''),
      scroll_top: list?.scrollTop || 0,
      scroll_height: list?.scrollHeight || 0,
      client_height: list?.clientHeight || 0,
      composer_draft: document.querySelector('.input-area textarea')?.value || '',
    };
  });
}

async function scrollAwayFromLiveEdge(page, ratio) {
  const list = page.locator('.messages');
  await list.hover();
  await page.mouse.wheel(0, -900);
  await page.waitForTimeout(50);
  const position = await list.evaluate((node, requestedRatio) => {
    node.scrollTop = Math.max(120, Math.floor((node.scrollHeight - node.clientHeight) * requestedRatio));
    node.dispatchEvent(new Event('scroll'));
    return {
      scroll_top: node.scrollTop,
      bottom_gap: node.scrollHeight - node.scrollTop - node.clientHeight,
    };
  }, ratio);
  assert(position.bottom_gap >= 80, `failed to establish user-owned transcript viewport: ${JSON.stringify(position)}`);
  await page.waitForTimeout(75);
  return position;
}

async function paneGeometry(page, paneId) {
  return page.evaluate(id => {
    const boundary = document.querySelector(`[data-pane-id="${id}"]`);
    const rail = document.querySelector('.pane-restore-rail');
    const minimize = boundary?.querySelector('.pane-minimize-btn');
    const visibleRects = Array.from(boundary?.querySelectorAll('*') || [])
      .filter(node => {
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      })
      .map(node => node.getBoundingClientRect());
    return {
      pane_id: id,
      state: boundary?.dataset.paneState || 'missing',
      max_descendant_height_px: visibleRects.length ? Math.max(...visibleRects.map(rect => rect.height)) : 0,
      minimize_rect: minimize ? {
        width: minimize.getBoundingClientRect().width,
        height: minimize.getBoundingClientRect().height,
      } : null,
      rail_height_px: rail?.getBoundingClientRect().height || 0,
      viewport_height_px: window.visualViewport?.height || window.innerHeight,
    };
  }, paneId);
}

async function assertCompactOwnership(page, except = '') {
  const states = await paneStateSnapshot(page);
  const nonRouteOpen = states.open.filter(id => !id.startsWith('route-') && id !== 'sidebar');
  assert(nonRouteOpen.length <= 1, `compact layout has competing open panes: ${nonRouteOpen.join(',')}`);
  if (except) assert(nonRouteOpen.includes(except), `expected ${except} to own compact viewport`);
  return states;
}

async function runCompactInteraction(browser, fixture, screenshotsDir) {
  fixture.selectScenario(scenario('no-warning-idle'));
  const { context, page, diagnostics } = await createPage(
    browser,
    fixture,
    { id: 'compact', width: 390, height: 844, mobile: true },
    'dark',
    'compact-interaction',
  );
  try {
    await scrollAwayFromLiveEdge(page, 0.37);
    const before = await transcriptSnapshot(page);
    const draft = 'retained scheduled draft p3-40';
    await openPane(page, 'scheduled-send');
    await page.locator('[data-pane-id="scheduled-send"] textarea').fill(draft);
    let geometry = await paneGeometry(page, 'scheduled-send');
    assert(geometry.minimize_rect.width >= 44 && geometry.minimize_rect.height >= 44,
      'scheduled-send minimize target is smaller than 44px');
    assert(geometry.max_descendant_height_px <= geometry.viewport_height_px * 0.45 + 1,
      `scheduled-send exceeds 45% visual viewport: ${JSON.stringify(geometry)}`);
    await minimizePane(page, 'scheduled-send');
    await page.waitForFunction(
      () => document.activeElement?.matches?.('[data-pane-toggle="scheduled-send"]'),
      null,
      { timeout: 2_000 },
    );

    await openPane(page, 'branch-selector', { allowHiddenToggle: true });
    await page.locator('.branch-search-input').fill('pane-fixture');
    await minimizePane(page, 'branch-selector');

    await openPane(page, 'chat-list', { allowHiddenToggle: true });
    await assertCompactOwnership(page, 'chat-list');
    await openPane(page, 'terminal', { allowHiddenToggle: true });
    await assertCompactOwnership(page, 'terminal');
    await openPane(page, 'file-browser', { allowHiddenToggle: true });
    await assertCompactOwnership(page, 'file-browser');
    await minimizePane(page, 'file-browser');
    const rail = await paneStateSnapshot(page);
    assert(rail.restore.length >= 5, `expected at least five minimized panes, got ${rail.restore.length}`);
    assert(rail.rail_height_px <= 48.5, `restore rail exceeds 48px: ${rail.rail_height_px}`);
    assert(rail.restore.every(item => item.aria_controls === `pane-${item.pane_id}`
      && item.aria_expanded === 'false'
      && item.rect.height >= 44), `restore rail aria/touch contract failed: ${JSON.stringify(rail.restore)}`);

    await restorePane(page, 'scheduled-send');
    assert.strictEqual(await page.locator('[data-pane-id="scheduled-send"] textarea').inputValue(), draft,
      'scheduled draft changed across minimize/restore');
    await minimizePane(page, 'scheduled-send');
    await restorePane(page, 'branch-selector');
    assert.strictEqual(await page.locator('.branch-search-input').inputValue(), 'pane-fixture',
      'branch filter changed across minimize/restore');
    await minimizePane(page, 'branch-selector');

    const after = await transcriptSnapshot(page);
    assert.deepStrictEqual(after.keys, before.keys, 'pane transitions changed rendered message identity/order');
    assert.deepStrictEqual(after.source_ids, before.source_ids, 'pane transitions changed rendered native source order');
    assert.strictEqual(after.session_id, before.session_id, 'pane transitions changed selected session');
    assert(Math.abs(after.scroll_top - before.scroll_top) <= 0.5,
      `pane transitions drifted transcript ${before.scroll_top} -> ${after.scroll_top}`);
    const screenshot = path.join(screenshotsDir, 'compact-retained-panes-390x844-dark.png');
    await page.screenshot({ path: screenshot, fullPage: false });
    return {
      profile: '390x844 dark',
      retained_scheduled_draft: draft,
      retained_branch_filter: 'pane-fixture',
      minimized_count: rail.restore.length,
      rail_height_px: rail.rail_height_px,
      transcript_keys: after.keys.length,
      scroll_drift_px: Math.abs(after.scroll_top - before.scroll_top),
      screenshot: receiptPath(screenshot),
      diagnostics,
      ok: diagnostics.length === 0,
    };
  } finally {
    await context.close();
  }
}

async function runDesktopInteraction(browser, fixture, screenshotsDir) {
  fixture.selectScenario(scenario('no-warning-idle'));
  const { context, page, diagnostics } = await createPage(
    browser,
    fixture,
    { id: 'desktop', width: 1440, height: 900, mobile: false },
    'light',
    'desktop-interaction',
  );
  try {
    await openPane(page, 'chat-list');
    await openPane(page, 'terminal');
    const state = await paneStateSnapshot(page);
    assert(state.open.includes('chat-list') && state.open.includes('terminal'),
      `desktop did not retain intentional multi-pane ownership: ${state.open.join(',')}`);
    const geometries = [];
    for (const paneId of ['chat-list', 'terminal']) {
      const geometry = await paneGeometry(page, paneId);
      geometries.push(geometry);
      assert(geometry.minimize_rect.width >= 44 && geometry.minimize_rect.height >= 44,
        `${paneId} minimize target is smaller than 44px`);
      assert(geometry.max_descendant_height_px <= geometry.viewport_height_px * 0.45 + 1,
        `${paneId} exceeds 45% viewport: ${JSON.stringify(geometry)}`);
    }
    const screenshot = path.join(screenshotsDir, 'desktop-multi-pane-1440x900-light.png');
    await page.screenshot({ path: screenshot, fullPage: false });
    return {
      profile: '1440x900 light',
      open_panes: state.open,
      geometries,
      screenshot: receiptPath(screenshot),
      diagnostics,
      ok: diagnostics.length === 0,
    };
  } finally {
    await context.close();
  }
}

async function runRouteReturn(browser, fixture, screenshotsDir) {
  fixture.selectScenario(scenario('no-warning-idle'));
  const { context, page, diagnostics } = await createPage(
    browser,
    fixture,
    { id: 'route', width: 1440, height: 900, mobile: false },
    'dark',
    'route-return',
  );
  try {
    const composerDraft = 'route retained composer draft p3-40';
    await page.locator('.input-area textarea').fill(composerDraft);
    await scrollAwayFromLiveEdge(page, 0.37);
    const before = await transcriptSnapshot(page);
    await page.evaluate(() => {
      window.__RAC_TEMPORAL_CANARY__ = { active: true, transcriptScrollWrites: [] };
      window.__RAC_MOBILE_VIEWPORT_WATCH__.start();
    });
    await clickVisible(
      page,
      '.sidebar-footer button[aria-label="Usage and limits"]',
      'sidebar Usage and limits route',
    );
    await page.waitForSelector('[data-pane-id="route-usage"]', { timeout: 10_000 });
    const routeButton = page.locator('[data-pane-id="route-usage"] [data-route-return="chat"]');
    assert.strictEqual((await routeButton.textContent()).trim().replace(/^←\s*/, ''), 'Back to chat',
      'usage route does not expose exact Back to chat copy');
    await routeButton.click();
    await page.waitForSelector('[data-pane-id="route-usage"]', { state: 'detached', timeout: 10_000 });
    await page.waitForTimeout(75);
    const after = await transcriptSnapshot(page);
    const routeTrace = await page.evaluate(() => ({
      writes: window.__RAC_TEMPORAL_CANARY__?.transcriptScrollWrites || [],
      metrics: window.__RAC_MOBILE_VIEWPORT_WATCH__.stop(),
    }));
    await page.evaluate(() => {
      if (window.__RAC_TEMPORAL_CANARY__) window.__RAC_TEMPORAL_CANARY__.active = false;
    });
    assert.strictEqual(after.session_id, before.session_id, 'usage route return changed selected session');
    assert.strictEqual(after.composer_draft, composerDraft, 'usage route return changed composer draft');
    assert.deepStrictEqual(after.keys, before.keys, 'usage route return changed message identity/order');
    assert(Math.abs(after.scroll_top - before.scroll_top) <= 0.5,
      `usage route return drifted transcript ${before.scroll_top} -> ${after.scroll_top}; trace=${JSON.stringify(routeTrace)}`);
    const screenshot = path.join(screenshotsDir, 'usage-route-return-1440x900-dark.png');
    await page.screenshot({ path: screenshot, fullPage: false });
    return {
      exact_back_to_chat: true,
      session_id: after.session_id,
      transcript_keys: after.keys.length,
      scroll_drift_px: Math.abs(after.scroll_top - before.scroll_top),
      scroll_trace: routeTrace,
      composer_draft_retained: after.composer_draft === composerDraft,
      screenshot: receiptPath(screenshot),
      diagnostics,
      ok: diagnostics.length === 0,
    };
  } finally {
    await context.close();
  }
}

async function promptIdentity(page) {
  return page.evaluate(() => {
    const card = document.querySelector('.permission-card');
    return {
      card_count: document.querySelectorAll('.permission-card').length,
      title: card?.querySelector('.permission-title')?.textContent?.trim() || '',
      question: card?.querySelector('.permission-question-message')?.textContent?.trim() || '',
      choices: Array.from(card?.querySelectorAll('.permission-action') || [])
        .map(node => node.textContent.trim().replace(/\s+/g, ' ')),
      composer_locked: !!document.querySelector('.input-area textarea:disabled'),
    };
  });
}

async function runPromptSoak(browser, fixture, options) {
  const promptScenario = scenario('question-prompt');
  fixture.selectScenario(promptScenario);
  const { context, page, diagnostics } = await createPage(
    browser,
    fixture,
    { id: 'soak', width: 390, height: 844, mobile: true },
    'dark',
    `prompt-soak-${options.soakMs}`,
  );
  try {
    await page.waitForSelector('.permission-card', { timeout: 10_000 });
    const expectedPrompt = await promptIdentity(page);
    assert.strictEqual(expectedPrompt.card_count, 1, 'fixture did not render exactly one native prompt');
    assert.strictEqual(expectedPrompt.composer_locked, true, 'native prompt did not lock the composer');
    await openPane(page, 'chat-list', { allowHiddenToggle: true });
    await openPane(page, 'terminal', { allowHiddenToggle: true });
    await openPane(page, 'file-browser', { allowHiddenToggle: true });
    await minimizePane(page, 'file-browser');
    const beforeSoak = await paneStateSnapshot(page);
    assert(beforeSoak.minimized.includes('native-action'), 'native prompt was not retained while minimized');
    assert(beforeSoak.restore.length >= 4, `expected at least four restore chips, got ${beforeSoak.restore.length}`);
    assert(beforeSoak.rail_height_px <= 48.5, `prompt restore rail exceeds 48px: ${beforeSoak.rail_height_px}`);

    await scrollAwayFromLiveEdge(page, 0.42);
    const transcriptBefore = await transcriptSnapshot(page);
    await page.evaluate(() => window.__RAC_MOBILE_VIEWPORT_WATCH__.start());
    const startedAt = Date.now();
    const initialConnections = fixture.connectionCount();
    const reconnectTargets = [Math.floor(options.soakMs / 3), Math.floor(options.soakMs * 2 / 3)];
    let reconnects = 0;
    let oneHzSnapshots = 0;
    let burstSnapshots = 0;
    let samples = 0;
    let nextOneHz = 0;
    while (Date.now() - startedAt < options.soakMs) {
      const elapsed = Date.now() - startedAt;
      if (elapsed >= nextOneHz) {
        const session = broadSession(promptScenario.activity, promptScenario.writeGate);
        fixture.broadcast({ type: 'session_list', protocol_version: 1, sessions: [session], workspaces: [] });
        fixture.broadcast({
          type: 'status',
          protocol_version: 1,
          session: SESSION_ID,
          session_id: SESSION_ID,
          status: 'healthy',
          thinking: false,
          label: '',
          activity: promptScenario.activity,
        });
        oneHzSnapshots += 1;
        nextOneHz += 1000;
      }
      if (elapsed % 12_000 < 1000) {
        const session = broadSession(promptScenario.activity, promptScenario.writeGate);
        fixture.broadcast({ type: 'session_list', protocol_version: 1, sessions: [session], workspaces: [] });
        burstSnapshots += 1;
      }
      if (reconnects < reconnectTargets.length && elapsed >= reconnectTargets[reconnects]) {
        fixture.reconnectAll();
        reconnects += 1;
      }
      await page.evaluate(() => window.__RAC_MOBILE_VIEWPORT_WATCH__.sample());
      samples += 1;
      if (elapsed > 0 && elapsed % 30_000 < 100) {
        process.stdout.write(`[pane-lifecycle-soak] elapsed_ms=${elapsed} one_hz=${oneHzSnapshots} bursts=${burstSnapshots} reconnects=${reconnects}\n`);
      }
      await page.waitForTimeout(100);
    }
    const metrics = await page.evaluate(() => window.__RAC_MOBILE_VIEWPORT_WATCH__.stop());
    await page.waitForFunction(() => document.querySelector('[data-pane-id="native-action"]')?.dataset.paneState === 'minimized');
    const afterSoak = await paneStateSnapshot(page);
    const transcriptAfter = await transcriptSnapshot(page);
    await restorePane(page, 'native-action');
    const actualPrompt = await promptIdentity(page);
    assert.deepStrictEqual(actualPrompt, expectedPrompt, 'native prompt identity/lifecycle changed across soak');
    const screenshot = path.join(options.screenshotsDir, 'prompt-soak-390x844-dark-final.png');
    await page.screenshot({ path: screenshot, fullPage: false });
    const acceptance = {
      duration_120s: options.soakMs >= 120_000,
      scroll_writes_zero: metrics.scroll_writes === 0,
      pixel_drift_zero: metrics.max_scroll_drift_px <= 0.5,
      reconnects_two: reconnects === 2,
      reconnected: fixture.connectionCount() >= initialConnections + 2,
      one_hz_exercised: oneHzSnapshots >= Math.floor(options.soakMs / 1000),
      bounded_ten_hz_bursts_exercised: burstSnapshots >= Math.floor(options.soakMs / 12_000) * 8,
      prompt_exactly_once: actualPrompt.card_count === 1,
      prompt_identity_retained: JSON.stringify(actualPrompt) === JSON.stringify(expectedPrompt),
      prompt_composer_lock_retained: actualPrompt.composer_locked,
      prompt_minimized_during_soak: afterSoak.minimized.includes('native-action'),
      transcript_identity_retained: JSON.stringify(transcriptAfter.keys) === JSON.stringify(transcriptBefore.keys),
      transcript_source_order_retained: JSON.stringify(transcriptAfter.source_ids) === JSON.stringify(transcriptBefore.source_ids),
      selected_session_retained: transcriptAfter.session_id === transcriptBefore.session_id,
      restore_rail_three_plus: afterSoak.restore.length >= 3,
      restore_rail_le_48: afterSoak.rail_height_px <= 48.5,
      diagnostics_zero: diagnostics.length === 0,
    };
    return {
      duration_ms: Date.now() - startedAt,
      one_hz_snapshots: oneHzSnapshots,
      bounded_ten_hz_burst_snapshots: burstSnapshots,
      reconnects,
      samples,
      metrics,
      expected_prompt: expectedPrompt,
      prompt_after_soak: actualPrompt,
      restore_count_during_soak: afterSoak.restore.length,
      transcript_keys: transcriptAfter.keys.length,
      acceptance,
      ok: Object.values(acceptance).every(Boolean),
      screenshot: receiptPath(screenshot),
      diagnostics,
    };
  } finally {
    await context.close();
  }
}

async function runMatrix(browser, fixture, options) {
  if (!options.matrix) return [];
  const matrix = [];
  for (const profile of MATRIX_PROFILES) {
    for (const theme of ['light', 'dark']) {
      const compactWidth = profile.width <= 640;
      fixture.selectScenario(scenario('no-warning-idle'));
      const { context, page, diagnostics } = await createPage(
        browser,
        fixture,
        profile,
        theme,
        `matrix-${profile.id}-${theme}`,
      );
      try {
        if (profile.keyboard) await page.locator('.input-area textarea').focus();
        await openPane(page, 'chat-list', { allowHiddenToggle: profile.mobile });
        await openPane(page, 'terminal', { allowHiddenToggle: profile.mobile });
        if (compactWidth) await assertCompactOwnership(page, 'terminal');
        const geometry = await paneGeometry(page, 'terminal');
        const pageGeometry = await page.evaluate(() => ({
          viewport_height_px: window.visualViewport?.height || window.innerHeight,
          horizontal_overflow_px: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
          composer_bottom_gap_px: Math.max(
            0,
            (document.querySelector('.input-area')?.getBoundingClientRect().bottom || 0)
              - (window.visualViewport?.height || window.innerHeight),
          ),
        }));
        const state = await paneStateSnapshot(page);
        const acceptance = {
          minimize_touch_target_ge_44: geometry.minimize_rect?.width >= 44 && geometry.minimize_rect?.height >= 44,
          non_prompt_pane_le_45_percent: geometry.max_descendant_height_px <= geometry.viewport_height_px * 0.45 + 1,
          restore_rail_le_48: state.rail_height_px <= 48.5,
          compact_single_owner: !compactWidth
            || state.open.filter(id => !id.startsWith('route-') && id !== 'sidebar').length <= 1,
          horizontal_overflow_zero: pageGeometry.horizontal_overflow_px === 0,
          composer_visible: pageGeometry.composer_bottom_gap_px <= 0.5,
          diagnostics_zero: diagnostics.length === 0,
        };
        const screenshot = path.join(options.screenshotsDir, `matrix-${profile.id}-${theme}.png`);
        await page.screenshot({ path: screenshot, fullPage: false });
        matrix.push({
          profile,
          theme,
          geometry,
          page_geometry: pageGeometry,
          pane_state: state,
          acceptance,
          ok: Object.values(acceptance).every(Boolean),
          screenshot: receiptPath(screenshot),
          diagnostics,
        });
      } finally {
        await context.close();
      }
    }
  }
  return matrix;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const deployEnv = fidelity.loadEnvFile(path.join(ROOT, '.env'));
  const relayEnv = fidelity.loadEnvFile(path.join(ROOT, 'relay-server', '.env'));
  const proxyEnv = fidelity.loadEnvFile(path.join(ROOT, 'agent-proxy', '.env'));
  const configured = fidelity.deriveRelayBaseUrl(null, relayEnv, proxyEnv);
  const upstreamUrl = configured?.startsWith('http://')
    ? configured
    : `http://${deployEnv.DEPLOY_HOST || 'tower'}:3500`;
  const token = fidelity.buildBearerToken(relayEnv);
  if (options.assetSource === 'production') assert(token, 'production bearer token is unavailable');
  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.mkdirSync(options.screenshotsDir, { recursive: true });
  const fixture = await startFixtureServer({
    assetSource: options.assetSource,
    upstreamUrl,
    token,
    sessionFactory: broadSession,
    onFrame: fixtureResponse,
  });
  const browser = await launchHeadlessBrowser('chromium');
  try {
    const compact = await runCompactInteraction(browser, fixture, options.screenshotsDir);
    const desktop = await runDesktopInteraction(browser, fixture, options.screenshotsDir);
    const route = await runRouteReturn(browser, fixture, options.screenshotsDir);
    const soak = await runPromptSoak(browser, fixture, options);
    const matrix = await runMatrix(browser, fixture, options);
    const assetIdentity = options.assetSource === 'local'
      ? {
          index_sha256: sha256(path.join(ROOT, 'frontend', 'index.html')),
          bundle_sha256: sha256(path.join(ROOT, 'frontend', 'dist', 'bundle.js')),
        }
      : { origin: upstreamUrl };
    const receipt = {
      schema_version: 1,
      gate: 'P3-40 cross-harness pane lifecycle browser E2E',
      generated_at: new Date().toISOString(),
      asset_source: options.assetSource,
      asset_identity: assetIdentity,
      browser: 'headless Chromium',
      visible_windows_opened: 0,
      protected_cdp_sessions_touched: 0,
      fixture: {
        session_id: SESSION_ID,
        agent_type: 'codex-desktop',
        model: FIXTURE_MODEL,
        effort: FIXTURE_EFFORT,
        mutations: 'disposable fixture only',
      },
      compact,
      desktop,
      route,
      soak,
      matrix,
      counts: {
        matrix_profiles: matrix.length,
        minimized_compact_panes: compact.minimized_count,
        transcript_keys: compact.transcript_keys,
        reconnects: soak.reconnects,
        one_hz_snapshots: soak.one_hz_snapshots,
        bounded_ten_hz_burst_snapshots: soak.bounded_ten_hz_burst_snapshots,
      },
      acceptance: {
        compact_interaction_green: compact.ok,
        desktop_multi_pane_green: desktop.ok,
        exact_route_return_green: route.ok,
        soak_green: soak.ok,
        matrix_green: matrix.every(row => row.ok),
        formal_duration_120s: options.soakMs >= 120_000,
      },
    };
    receipt.ok = Object.values(receipt.acceptance).every(Boolean);
    fs.writeFileSync(options.output, `${JSON.stringify(receipt, null, 2)}\n`);
    if (options.assertAcceptance) {
      assert(receipt.ok, `P3-40 acceptance failed: ${JSON.stringify(receipt.acceptance)}`);
    }
    process.stdout.write(`${JSON.stringify({
      status: receipt.ok ? 'PASS' : 'DIAGNOSTIC',
      output: receiptPath(options.output),
      asset_source: options.assetSource,
      soak_ms: options.soakMs,
      matrix_profiles: matrix.length,
      acceptance: receipt.acceptance,
    })}\n`);
  } finally {
    await browser.close();
    await fixture.close();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Pane lifecycle browser E2E: FAIL (${error.stack || error.message || error})`);
    process.exitCode = 1;
  });
}
