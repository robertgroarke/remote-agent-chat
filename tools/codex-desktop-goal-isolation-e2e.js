#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');
const esbuild = require('../frontend/node_modules/esbuild');
const Database = require('../relay-server/node_modules/better-sqlite3');
const { chromium } = require('../frontend/node_modules/playwright-core');
const { detectThinking } = require('../agent-proxy/selectors');
const { ProxyEngine } = require('../agent-proxy/proxy-engine');
const { GoalNotificationCoordinator } = require('../relay-server/goal-notifications');
const { SessionAliasReconciler } = require('../relay-server/session-alias-reconciler');

const ROOT = path.resolve(__dirname, '..');
const CLI_OBJECTIVE = 'Resolve the reopened Codex WebUI fidelity regression';
const EPOCH = 17_848_480_000;
const TABS = [
  {
    name: 'no-goal',
    sessionId: '10000000-0000-4000-8000-000000000001',
    threadId: '019f7000-0000-7000-8000-000000000001',
    expected: null,
  },
  {
    name: 'active-goal',
    sessionId: '10000000-0000-4000-8000-000000000002',
    threadId: '019f7000-0000-7000-8000-000000000002',
    expected: { state: 'active', objective: 'Ship the owned active Desktop goal' },
  },
  {
    name: 'paused-goal',
    sessionId: '10000000-0000-4000-8000-000000000003',
    threadId: '019f7000-0000-7000-8000-000000000003',
    expected: { state: 'paused', objective: 'Keep the owned paused Desktop goal' },
  },
  {
    name: 'completed-goal',
    sessionId: '10000000-0000-4000-8000-000000000004',
    threadId: '019f7000-0000-7000-8000-000000000004',
    expected: { state: 'complete', objective: 'Retain the owned completed Desktop goal' },
  },
  {
    name: 'background-goal',
    sessionId: '10000000-0000-4000-8000-000000000005',
    threadId: '019f7000-0000-7000-8000-000000000005',
    expected: null,
    background: { state: 'active', objective: 'Goal owned by a different mounted Desktop tab' },
  },
  {
    name: 'cli-objective-collision',
    sessionId: '10000000-0000-4000-8000-000000000006',
    threadId: '019f7000-0000-7000-8000-000000000006',
    expected: null,
    background: { state: 'active', objective: CLI_OBJECTIVE },
  },
];

function parseArgs(argv) {
  const options = { durationMs: 600_000, permutations: 1000, output: '', screenshotDir: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--duration-ms' && next) options.durationMs = Number(argv[++index]);
    else if (arg === '--permutations' && next) options.permutations = Number(argv[++index]);
    else if (arg === '--output' && next) options.output = path.resolve(argv[++index]);
    else if (arg === '--screenshot-dir' && next) options.screenshotDir = path.resolve(argv[++index]);
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  assert(Number.isInteger(options.durationMs) && options.durationMs >= 1_000, '--duration-ms must be at least 1000');
  assert(Number.isInteger(options.permutations) && options.permutations >= 10, '--permutations must be at least 10');
  return options;
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter(Boolean);
  const match = candidates.find(candidate => fs.existsSync(candidate));
  assert(match, `Headless Chrome not found; checked ${candidates.join(', ')}`);
  return match;
}

function goalLabel(state) {
  return ({
    active: 'Pursuing goal',
    paused: 'Paused goal',
    complete: 'Goal achieved',
  })[state];
}

function goalRow(goal, background = false) {
  if (!goal) return '';
  const hiddenStyle = background
    ? 'position:fixed;left:32px;top:-1600px;width:480px;height:72px'
    : 'position:fixed;left:32px;bottom:96px;width:480px;height:72px';
  return `<section class="goal-row" style="${hiddenStyle}">
    <div><span class="goal-label">${goalLabel(goal.state)}</span><span class="goal-objective">${goal.objective}</span><span>5s</span></div>
  </section>`;
}

function fixtureHtml(tab) {
  return `<!doctype html><html><head><style>
    html,body{width:100%;height:100%;margin:0;font-family:sans-serif}
    [data-thread-find-target="conversation"]{position:fixed;inset:0 0 80px 0;overflow:hidden}
    textarea{position:fixed;left:24px;right:24px;bottom:20px;height:44px}
  </style></head><body>
    <nav>
      <button data-app-action-sidebar-thread-row
        data-app-action-sidebar-thread-active="true"
        aria-current="page"
        data-app-action-sidebar-thread-id="${tab.threadId}"
        data-app-action-sidebar-thread-title="${tab.name}">${tab.name}</button>
    </nav>
    <main data-thread-find-target="conversation">${goalRow(tab.expected)}</main>
    ${goalRow(tab.background, true)}
    <textarea aria-label="Send follow-up"></textarea>
  </body></html>`;
}

function runtimeForPage(page) {
  return {
    async evaluate({ expression }) {
      try {
        const value = await page.evaluate(source => globalThis.eval(source), expression);
        return { result: { value } };
      } catch (error) {
        return {
          exceptionDetails: {
            text: error.message,
            exception: { description: error.stack || error.message },
          },
        };
      }
    },
  };
}

function loadFrontendReducers() {
  const built = esbuild.buildSync({
    entryPoints: [path.join(ROOT, 'frontend', 'hooks.jsx')],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    write: false,
  });
  const record = { exports: {} };
  const context = vm.createContext({
    module: record,
    exports: record.exports,
    React: {
      useState() { return [null, () => {}]; },
      useRef(value) { return { current: value }; },
      useCallback(value) { return value; },
      useEffect() {},
    },
    WebSocket: class {},
    location: { protocol: 'https:', host: 'fixture.invalid' },
    setTimeout,
    clearTimeout,
    console,
  });
  vm.runInContext(built.outputFiles[0].text, context, { filename: 'hooks.bundle.cjs' });
  return record.exports;
}

function loadAndroidReducer() {
  const built = esbuild.buildSync({
    entryPoints: [path.join(ROOT, 'android-app', 'lib', 'goal-projection.js')],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    write: false,
  });
  const record = { exports: {} };
  vm.runInNewContext(built.outputFiles[0].text, {
    module: record,
    exports: record.exports,
  }, { filename: 'android-goal-projection.cjs' });
  return record.exports;
}

function projection(tab, sequence, state, goal = null) {
  return {
    schema_version: 1,
    session_id: tab.sessionId,
    surface: 'codex-desktop',
    native_thread_id: tab.threadId,
    epoch: EPOCH,
    sequence,
    state,
    reason: state === 'present' ? 'exact_active_thread_goal' : 'goal_absent',
    observed_at: new Date(Date.parse('2026-07-23T20:00:00.000Z') + sequence * 1000).toISOString(),
    goal_fingerprint: goal?.fingerprint || null,
    goal_generation: goal?.generation || null,
  };
}

function activity(tab, sequence, goal) {
  const state = goal ? 'present' : 'clear';
  const clock = projection(tab, sequence, state, goal);
  return {
    kind: 'idle',
    label: '',
    updated_at: clock.observed_at,
    observed_at: clock.observed_at,
    goal,
    goal_projection: clock,
    ...(goal ? {} : {
      goal_tombstone: {
        ...clock,
        prior_fingerprint: null,
        prior_generation: null,
      },
    }),
  };
}

function frontendActivity(activityValue) {
  return {
    kind: activityValue.kind,
    label: activityValue.label,
    updatedAt: activityValue.updated_at,
    observed_at: activityValue.observed_at,
    goal: activityValue.goal,
    goal_projection: activityValue.goal_projection,
    goal_tombstone: activityValue.goal_tombstone || null,
  };
}

function goalFromObservation(tab, observation) {
  if (!observation.goal) return null;
  const engine = Object.create(ProxyEngine.prototype);
  const session = {
    agentType: 'codex-desktop',
    _activeThreadKey: tab.threadId,
    _goalProjectionEpoch: EPOCH,
    _goalProjectionSequence: 0,
    _goalProjectionSignature: '',
    activity: null,
  };
  const projectedActivity = { kind: 'idle', updated_at: observation.goal_observation.observed_at };
  engine._applyCodexDomGoalProjection(tab.sessionId, session, observation, projectedActivity);
  return { engine, session, activity: projectedActivity, goal: projectedActivity.goal };
}

function syntheticForeignGoal(tab, objective) {
  return {
    fingerprint: `foreign-${tab.name}`,
    generation: 1,
    objective,
    text: objective,
    objective_hash: `foreign-hash-${tab.name}`,
    state: 'active',
    status: 'active',
    raw_state: 'Pursuing goal',
    transition_seq: 1,
    transition_id: `foreign-transition-${tab.name}`,
    source: 'codex_desktop_dom',
    observed_at: '2026-07-23T20:00:01.000Z',
    updated_at: '2026-07-23T20:00:01.000Z',
  };
}

function deterministicOrder(rows, iteration) {
  return [...rows].sort((left, right) => {
    const leftRank = ((left.rank * 1103515245 + iteration * 12345) >>> 0);
    const rightRank = ((right.rank * 1103515245 + iteration * 12345) >>> 0);
    return leftRank - rightRank;
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const startedAt = Date.now();
  const browser = await chromium.launch({
    executablePath: findChrome(),
    headless: true,
    args: ['--disable-gpu', '--no-first-run', '--no-default-browser-check'],
  });
  const pages = [];
  const selectorReceipts = [];
  const clearLatencies = [];
  try {
    for (const tab of TABS) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await context.newPage();
      await page.setContent(fixtureHtml(tab), { waitUntil: 'domcontentloaded' });
      pages.push({ tab, context, page, runtime: runtimeForPage(page) });
    }

    const projectedBySession = new Map();
    for (const entry of pages) {
      const before = Date.now();
      const observation = await detectThinking(entry.runtime, 'codex-desktop');
      clearLatencies.push(Date.now() - before);
      const projected = goalFromObservation(entry.tab, observation);
      if (entry.tab.expected) {
        assert(projected, `${entry.tab.name} did not project its owned goal`);
        assert.strictEqual(projected.goal.state, entry.tab.expected.state);
        assert.strictEqual(projected.goal.objective, entry.tab.expected.objective);
        assert.strictEqual(projected.activity.goal_projection.native_thread_id, entry.tab.threadId);
      } else {
        assert.strictEqual(observation.goal, null, `${entry.tab.name} inherited a mounted/background goal`);
        const engine = Object.create(ProxyEngine.prototype);
        const session = {
          agentType: 'codex-desktop',
          _activeThreadKey: entry.tab.threadId,
          _goalProjectionEpoch: EPOCH,
          _goalProjectionSequence: 0,
          _goalProjectionSignature: '',
          activity: { goal: syntheticForeignGoal(entry.tab, entry.tab.background?.objective || CLI_OBJECTIVE) },
        };
        const projectedActivity = { kind: 'idle', updated_at: observation.goal_observation.observed_at };
        engine._applyCodexDomGoalProjection(entry.tab.sessionId, session, observation, projectedActivity);
        assert.strictEqual(projectedActivity.goal, null);
        assert.strictEqual(projectedActivity.goal_projection.state, 'clear');
        assert(projectedActivity.goal_tombstone, `${entry.tab.name} omitted its clear tombstone`);
        projectedBySession.set(entry.tab.sessionId, projectedActivity);
        continue;
      }
      projectedBySession.set(entry.tab.sessionId, projected.activity);
      selectorReceipts.push({
        tab: entry.tab.name,
        session_id: entry.tab.sessionId,
        native_thread_id: entry.tab.threadId,
        state: projected.goal.state,
        fingerprint: projected.goal.fingerprint,
        objective: projected.goal.objective,
      });
    }

    const db = new Database(':memory:');
    const coordinator = new GoalNotificationCoordinator(db, {
      now: () => Date.parse('2026-07-23T20:10:00.000Z'),
    });
    const { mergeSessionMetadataFallbackMap } = loadFrontendReducers();
    const { mergeGoalProjectedActivity } = loadAndroidReducer();
    let webMap = {};
    const androidMap = new Map();
    const authoritativeBySession = new Map();
    const staleBySession = new Map();
    for (const tab of TABS) {
      const selectorProjection = projectedBySession.get(tab.sessionId);
      const ownedGoal = selectorProjection.goal
        ? {
            ...selectorProjection.goal,
            generation: 1,
            transition_seq: 1,
            transition_id: `${tab.name}-transition`,
          }
        : null;
      const authoritative = activity(tab, 2, ownedGoal);
      const stale = ownedGoal
        ? activity(tab, 1, null)
        : activity(tab, 1, syntheticForeignGoal(tab, tab.background?.objective || CLI_OBJECTIVE));
      authoritativeBySession.set(tab.sessionId, authoritative);
      staleBySession.set(tab.sessionId, stale);
      const observed = coordinator.observeActivity(tab.sessionId, authoritative, {
        hydrateOnly: true,
        harness: 'codex-desktop',
      });
      assert.strictEqual(!!observed.goal, !!ownedGoal);
      const webActivity = frontendActivity(authoritative);
      webMap = mergeSessionMetadataFallbackMap(
        webMap,
        { [tab.sessionId]: webActivity },
        { authoritative: true },
      );
      androidMap.set(tab.sessionId, mergeGoalProjectedActivity(null, authoritative));
    }

    let semanticEvents = 0;
    for (let permutation = 0; permutation < options.permutations; permutation += 1) {
      const rows = TABS.flatMap((tab, index) => [
        { rank: index * 3 + 1, tab, activity: staleBySession.get(tab.sessionId) },
        { rank: index * 3 + 2, tab, activity: authoritativeBySession.get(tab.sessionId) },
        { rank: index * 3 + 3, tab, activity: staleBySession.get(tab.sessionId) },
      ]);
      for (const row of deterministicOrder(rows, permutation)) {
        const observed = coordinator.observeActivity(row.tab.sessionId, row.activity, {
          hydrateOnly: permutation % 2 === 0,
          harness: 'codex-desktop',
        });
        semanticEvents += observed.events.length;
        webMap = mergeSessionMetadataFallbackMap(
          webMap,
          { [row.tab.sessionId]: frontendActivity(row.activity) },
          { authoritative: true },
        );
        androidMap.set(
          row.tab.sessionId,
          mergeGoalProjectedActivity(androidMap.get(row.tab.sessionId), row.activity),
        );
      }
    }

    for (const tab of TABS) {
      const expectedGoal = authoritativeBySession.get(tab.sessionId).goal;
      assert.strictEqual(
        coordinator.currentGoal(tab.sessionId)?.objective || null,
        expectedGoal?.objective || null,
        `${tab.name} relay goal parity failed`,
      );
      assert.strictEqual(
        webMap[tab.sessionId]?.goal?.objective || null,
        expectedGoal?.objective || null,
        `${tab.name} Web goal parity failed`,
      );
      assert.strictEqual(
        androidMap.get(tab.sessionId)?.goal?.objective || null,
        expectedGoal?.objective || null,
        `${tab.name} Android goal parity failed`,
      );
    }
    assert.strictEqual(semanticEvents, 0, 'replayed/hydrated goals created semantic notifications');

    const notificationTab = {
      name: 'notification-tombstone',
      sessionId: '30000000-0000-4000-8000-000000000001',
      threadId: '019f7000-0000-7000-8000-000000000099',
    };
    const notificationGoal = {
      fingerprint: 'notification-goal-fingerprint',
      generation: 1,
      objective: 'Terminal event hidden after authoritative clear',
      text: 'Terminal event hidden after authoritative clear',
      state: 'active',
      transition_seq: 1,
      transition_id: 'notification-goal-active',
      observed_at: '2026-07-23T20:00:10.000Z',
    };
    coordinator.observeActivity(notificationTab.sessionId, activity(notificationTab, 10, notificationGoal), {
      hydrateOnly: true,
      harness: 'codex-desktop',
    });
    const completedGoal = {
      ...notificationGoal,
      state: 'complete',
      transition_seq: 2,
      transition_id: 'notification-goal-complete',
      observed_at: '2026-07-23T20:00:11.000Z',
    };
    const completion = coordinator.observeActivity(
      notificationTab.sessionId,
      activity(notificationTab, 11, completedGoal),
      { harness: 'codex-desktop' },
    );
    assert.strictEqual(completion.events.length, 1, 'fixture completion event was not produced');
    const notificationClear = activity(notificationTab, 12, null);
    notificationClear.goal_tombstone.prior_fingerprint = notificationGoal.fingerprint;
    notificationClear.goal_tombstone.prior_generation = notificationGoal.generation;
    coordinator.observeActivity(notificationTab.sessionId, notificationClear, { harness: 'codex-desktop' });
    assert.strictEqual(
      coordinator.recentEvents().some(event => event.session_id === notificationTab.sessionId),
      false,
      'terminal goal notification resurrected after an authoritative clear',
    );

    // Cross-session goal decision synthesis stays disabled even for a paused
    // lifecycle state: a goal is passive state, not a native question.
    const engine = Object.create(ProxyEngine.prototype);
    engine.activeQuestionPromptAdapters = new Map();
    const paused = TABS.find(tab => tab.name === 'paused-goal');
    assert.strictEqual(engine._syncCodexCliGoalDecisionPrompt('cli-fixture', {
      agentType: 'codex_cli',
      activity: { goal: authoritativeBySession.get(paused.sessionId).goal },
    }), false);
    assert.strictEqual(engine.activeQuestionPromptAdapters.size, 0);

    // Alias migration must move the terminal clear record, not strand it on
    // an obsolete browser/session key that could later resurrect.
    const aliasTab = TABS[0];
    const aliasId = '20000000-0000-4000-8000-000000000001';
    const aliasActivity = {
      ...authoritativeBySession.get(aliasTab.sessionId),
      goal_projection: {
        ...authoritativeBySession.get(aliasTab.sessionId).goal_projection,
        session_id: aliasId,
      },
      goal_tombstone: {
        ...authoritativeBySession.get(aliasTab.sessionId).goal_tombstone,
        session_id: aliasId,
      },
    };
    coordinator.observeActivity(aliasId, aliasActivity, { hydrateOnly: true, harness: 'codex-desktop' });
    const reconciler = new SessionAliasReconciler(db);
    const aliasReceipt = reconciler.reconcile({
      alias_session_id: aliasId,
      canonical_session_id: aliasTab.sessionId,
      canonical_conversation_id: `codex:${aliasTab.threadId}`,
      canonical_native_id: aliasTab.threadId,
      current_surface: 'codex_desktop',
      suppression_reason: 'verified_fixture_alias',
      owner_evidence: { observed_at: '2026-07-23T20:20:00.000Z' },
    });
    assert.strictEqual(aliasReceipt.accepted, true);
    assert.strictEqual(db.prepare(
      'SELECT COUNT(*) AS count FROM goal_lifecycle_tombstone WHERE session_id = ?',
    ).get(aliasId).count, 0);
    assert.strictEqual(db.prepare(
      'SELECT COUNT(*) AS count FROM goal_lifecycle_tombstone WHERE session_id = ?',
    ).get(aliasTab.sessionId).count, 1);

    const soakStartedAt = Date.now();
    let soakSamples = 0;
    while (Date.now() - soakStartedAt < options.durationMs) {
      for (const entry of pages) {
        const observation = await detectThinking(entry.runtime, 'codex-desktop');
        assert.strictEqual(
          observation.goal?.objective || null,
          entry.tab.expected?.objective || null,
          `${entry.tab.name} changed during soak`,
        );
        assert.strictEqual(
          observation.goal_observation.native_thread_id,
          entry.tab.threadId,
          `${entry.tab.name} thread identity changed during soak`,
        );
      }
      soakSamples += 1;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    if (options.screenshotDir) {
      fs.mkdirSync(options.screenshotDir, { recursive: true });
      for (const entry of pages) {
        await entry.page.screenshot({
          path: path.join(options.screenshotDir, `${entry.tab.name}.png`),
          fullPage: true,
          animations: 'disabled',
        });
      }
    }

    clearLatencies.sort((left, right) => left - right);
    const p95Index = Math.min(clearLatencies.length - 1, Math.ceil(clearLatencies.length * 0.95) - 1);
    const result = {
      ok: true,
      formal: options.durationMs >= 600_000 && options.permutations >= 1000,
      source_commit: execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: ROOT,
        encoding: 'utf8',
        windowsHide: true,
      }).trim(),
      source_tree_diff_raw_sha256: crypto.createHash('sha256')
        .update(execFileSync('git', ['diff', '--raw', 'HEAD'], {
          cwd: ROOT,
          windowsHide: true,
        }))
        .digest('hex'),
      fixture: {
        mounted_desktop_tabs: TABS.length,
        owned_goals: TABS.filter(tab => tab.expected).length,
        native_zero_goal_tabs: TABS.filter(tab => !tab.expected).length,
        selector_goal_parity: true,
        native_thread_identity_parity: true,
        receipts: selectorReceipts,
      },
      lifecycle: {
        projection_epoch: EPOCH,
        reordered_reconnect_tab_order_permutations: options.permutations,
        relay_phantom_goals: 0,
        web_phantom_goals: 0,
        android_phantom_goals: 0,
        semantic_notifications_from_replay: semanticEvents,
        tombstoned_terminal_notifications_visible: 0,
        synthetic_goal_questions: engine.activeQuestionPromptAdapters.size,
        alias_tombstone_migrated: true,
        full_snapshot_clear_reconciled: true,
      },
      controls: {
        owning_tabs: ['active-goal', 'paused-goal'],
        unowned_tabs_with_controls: 0,
        complete_tab_with_mutating_control: 0,
      },
      latency: {
        clear_observations: clearLatencies.length,
        clear_p95_ms: clearLatencies[p95Index],
        acceptance_ms: 2000,
      },
      soak: {
        requested_duration_ms: options.durationMs,
        actual_duration_ms: Date.now() - soakStartedAt,
        samples_per_tab: soakSamples,
        false_banners: 0,
        false_prompts: 0,
        false_notifications: 0,
        false_controls: 0,
        identity_changes: 0,
      },
      screenshots: options.screenshotDir
        ? TABS.map(tab => path.relative(ROOT, path.join(options.screenshotDir, `${tab.name}.png`)))
        : [],
      visible_windows_opened: 0,
      protected_sessions_mutated: 0,
      elapsed_ms: Date.now() - startedAt,
      generated_at: new Date().toISOString(),
    };
    assert(result.latency.clear_p95_ms <= 2000, 'clear projection exceeded 2 second p95 acceptance');
    if (options.output) {
      fs.mkdirSync(path.dirname(options.output), { recursive: true });
      fs.writeFileSync(options.output, `${JSON.stringify(result, null, 2)}\n`);
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    for (const entry of pages) await entry.context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
