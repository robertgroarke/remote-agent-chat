'use strict';

const crypto = require('crypto');

const ACTIVE_ACTIVITY_KINDS = new Set([
  'thinking', 'generating', 'running_command', 'applying_patch', 'reading_files', 'working', 'tool',
]);
const ATTENTION_GOAL_STATES = new Set([
  'paused', 'blocked', 'usageLimited', 'budgetLimited', 'cancelled', 'failed',
]);
const TERMINAL_GOAL_STATES = new Set(['complete', 'cancelled', 'failed']);
const TELEMETRY_STAGES = new Set([
  'candidate', 'eligible', 'suppressed', 'dispatched', 'claimed', 'displayed',
]);
const CLIENT_TELEMETRY_STAGES = new Set(['claimed', 'displayed', 'suppressed']);
const TELEMETRY_METADATA_KEYS = new Set([
  'activity_kind', 'terminal_reason', 'source', 'raw_terminal_kind',
  'preference_enabled', 'muted', 'client_id', 'delivery_result',
]);
const REQUIRED_TURN_TERMINAL_GATES = Object.freeze([
  'stable_turn_id',
  'correlated_start_terminal_cursors',
  'terminal_reason_completed',
  'settled_final_output',
  'zero_pending_work',
  'explicit_non_goal_affiliation',
]);

function gatedTurnCapability(observedSource, nativeTerminalSource = null) {
  return Object.freeze({
    status: 'GATED_OFF',
    enabled: false,
    advertised: false,
    observed_source: observedSource,
    native_terminal_source: nativeTerminalSource,
    missing: REQUIRED_TURN_TERMINAL_GATES,
  });
}

// Harness-specific fail-closed registry. A producer may move only its own row
// out of GATED_OFF after it supplies every REQUIRED_TURN_TERMINAL_GATES field;
// no global activity/idle inference is allowed.
const TURN_READY_CAPABILITIES = Object.freeze({
  claude: gatedTurnCapability('claude_code_editor_dom_and_terminal'),
  claude_cli: gatedTurnCapability('claude_cli_jsonl'),
  'claude-desktop': gatedTurnCapability('claude_desktop_webview_dom'),
  codex: gatedTurnCapability('vscode_codex_webview_dom'),
  codex_cli: gatedTurnCapability(
    'codex_cli_jsonl',
    'event_msg.task_started + event_msg.task_complete',
  ),
  'codex-desktop': gatedTurnCapability(
    'codex_desktop_rollout_jsonl',
    'event_msg.task_started + event_msg.task_complete',
  ),
  cursor: gatedTurnCapability('cursor_composer_store_and_dom'),
  cursor_cli: gatedTurnCapability('cursor_cli_jsonl'),
  gemini: gatedTurnCapability('antigravity_chat_dom'),
  continue: gatedTurnCapability('continue_webview_dom'),
  continue_yolo: gatedTurnCapability('continue_webview_dom'),
  roo_code: gatedTurnCapability('roo_code_webview_dom'),
  cline: gatedTurnCapability('cline_webview_dom'),
  antigravity: gatedTurnCapability('legacy_antigravity_dom'),
  antigravity_panel: gatedTurnCapability('antigravity_chat_dom'),
  'antigravity-v2': gatedTurnCapability('antigravity_v2_bridge_status'),
});
const UNKNOWN_TURN_READY_CAPABILITY = gatedTurnCapability('unknown_harness');

function turnReadyCapabilityForHarness(harness) {
  return TURN_READY_CAPABILITIES[String(harness || '').trim()] || UNKNOWN_TURN_READY_CAPABILITY;
}

// No harness currently publishes the complete native terminal envelope needed
// to distinguish a finished ordinary turn from an idle/reconnect/polling edge.
const TURN_READY_NOTIFICATIONS_ENABLED = Object.values(TURN_READY_CAPABILITIES)
  .some(capability => capability.enabled === true);

const STATE_ALIASES = Object.freeze({
  active: 'active', running: 'active', working: 'active', pursuing: 'active', in_progress: 'active',
  paused: 'paused', pause: 'paused',
  blocked: 'blocked', needs_attention: 'blocked', waiting_for_user: 'blocked',
  usage_limited: 'usageLimited', usagelimited: 'usageLimited', rate_limited: 'usageLimited', ratelimited: 'usageLimited',
  budget_limited: 'budgetLimited', budgetlimited: 'budgetLimited', token_budget_limited: 'budgetLimited',
  complete: 'complete', completed: 'complete', achieved: 'complete', done: 'complete', success: 'complete',
  cancelled: 'cancelled', canceled: 'cancelled', stopped: 'cancelled', aborted: 'cancelled',
  failed: 'failed', failure: 'failed', error: 'failed',
});

function hashText(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function normalizeGoalState(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'unknown';
  const compact = raw
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return STATE_ALIASES[compact] || STATE_ALIASES[compact.replace(/_/g, '')] || 'unknown';
}

function normalizedIso(value) {
  const ms = value == null ? NaN : Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function telemetryMetadata(value) {
  if (!value || typeof value !== 'object') return {};
  const safe = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!TELEMETRY_METADATA_KEYS.has(key)) continue;
    if (typeof raw === 'boolean' || Number.isFinite(raw)) safe[key] = raw;
    else if (typeof raw === 'string' && raw.trim()) safe[key] = raw.trim().slice(0, 160);
  }
  return safe;
}

function normalizeGoalRecord(sessionId, goal, nowIso = new Date().toISOString()) {
  if (!sessionId || !goal || typeof goal !== 'object') return null;
  const objective = String(goal.objective || goal.text || '').trim();
  const objectiveHash = String(goal.objective_hash || hashText(objective));
  const rawState = String(goal.raw_state || goal.native_state || goal.state || goal.status || '').trim();
  const state = normalizeGoalState(rawState);
  const fingerprint = String(goal.fingerprint || goal.goal_fingerprint || '').trim()
    || `goal:${hashText(`${sessionId}\u0000${objectiveHash}\u0000${goal.created_at || goal.started_at || 'unknown'}`).slice(0, 40)}`;
  const nativeUpdatedAt = normalizedIso(goal.native_updated_at);
  const transitionSeq = Math.max(1, Number(goal.transition_seq) || 1);
  const transitionId = String(goal.transition_id || '').trim()
    || `goal-transition:${hashText(`${fingerprint}\u0000${state}\u0000${nativeUpdatedAt || transitionSeq}`).slice(0, 40)}`;
  return {
    ...goal,
    objective,
    text: objective,
    objective_hash: objectiveHash,
    fingerprint,
    generation: Math.max(1, Number(goal.generation) || 1),
    state,
    status: state,
    raw_state: rawState || 'unknown',
    native_state: rawState || 'unknown',
    terminal: TERMINAL_GOAL_STATES.has(state),
    transition_seq: transitionSeq,
    transition_id: transitionId,
    source: String(goal.source || 'proxy'),
    native_updated_at: nativeUpdatedAt,
    observed_at: normalizedIso(goal.observed_at) || nowIso,
    updated_at: normalizedIso(goal.updated_at) || nativeUpdatedAt || nowIso,
  };
}

function eventCopy(eventType, sessionName, goal = null) {
  const name = String(sessionName || 'Agent').trim() || 'Agent';
  const state = goal?.state || 'unknown';
  if (eventType === 'turn_ready') return {
    title: 'Turn finished',
    body: `${name} is waiting for input.`,
    activity_type: 'turn_ready',
  };
  if (eventType === 'goal_completed') return {
    title: 'Goal completed',
    body: `${name} completed its goal.`,
    activity_type: 'goal_completed',
  };
  const byState = {
    paused: ['Goal paused', `${name}'s goal is paused.`],
    blocked: ['Needs attention', `${name}'s goal is blocked.`],
    usageLimited: ['Goal paused for provider capacity', `${name}'s goal is waiting for provider capacity.`],
    budgetLimited: ['Goal budget reached', `${name}'s goal reached its budget.`],
    cancelled: ['Goal stopped', `${name}'s goal was cancelled.`],
    failed: ['Goal failed', `${name}'s goal failed.`],
  };
  const [title, body] = byState[state] || ['Goal needs attention', `${name}'s goal needs attention.`];
  return { title, body, activity_type: `goal_${state}` };
}

class GoalNotificationCoordinator {
  constructor(db, { now = () => Date.now(), liveWindowMs = 10 * 60 * 1000 } = {}) {
    this.db = db;
    this.now = now;
    this.liveWindowMs = liveWindowMs;
    this.ensureSchema();
    db.prepare('DELETE FROM semantic_notification_events WHERE created_at < ?')
      .run(new Date(this.now() - 30 * 24 * 60 * 60 * 1000).toISOString());
    db.prepare('DELETE FROM semantic_notification_telemetry WHERE occurred_at < ?')
      .run(new Date(this.now() - 30 * 24 * 60 * 60 * 1000).toISOString());
    this.getGoal = db.prepare('SELECT * FROM goal_lifecycle_state WHERE session_id = ?');
    this.upsertGoal = db.prepare(`
      INSERT INTO goal_lifecycle_state
        (session_id, fingerprint, generation, objective_hash, objective, state, raw_state, transition_seq,
         transition_id, source, native_updated_at, native_cursor_json, observed_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        fingerprint = excluded.fingerprint,
        generation = excluded.generation,
        objective_hash = excluded.objective_hash,
        objective = excluded.objective,
        state = excluded.state,
        raw_state = excluded.raw_state,
        transition_seq = excluded.transition_seq,
        transition_id = excluded.transition_id,
        source = excluded.source,
        native_updated_at = excluded.native_updated_at,
        native_cursor_json = excluded.native_cursor_json,
        observed_at = excluded.observed_at,
        updated_at = excluded.updated_at
    `);
    this.getTurn = db.prepare('SELECT * FROM session_turn_lifecycle WHERE session_id = ?');
    this.upsertTurn = db.prepare(`
      INSERT INTO session_turn_lifecycle (session_id, activity_kind, active_anchor, activity_updated_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        activity_kind = excluded.activity_kind,
        active_anchor = excluded.active_anchor,
        activity_updated_at = excluded.activity_updated_at,
        updated_at = excluded.updated_at
    `);
    this.insertEvent = db.prepare(`
      INSERT OR IGNORE INTO semantic_notification_events
        (dedupe_key, session_id, event_type, category, title, body, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.getRecent = db.prepare(`
      SELECT payload_json FROM semantic_notification_events
      WHERE created_at >= ?
      ORDER BY created_at ASC
      LIMIT ?
    `);
    this.getEventByDedupe = db.prepare(`
      SELECT payload_json FROM semantic_notification_events WHERE dedupe_key = ?
    `);
    this.insertTelemetry = db.prepare(`
      INSERT OR IGNORE INTO semantic_notification_telemetry
        (stage_key, dedupe_key, session_id, event_type, stage, reason_code, harness,
         goal_affiliation, preference_revision, client_channel, native_event_id,
         turn_id, occurred_at, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
  }

  ensureSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS goal_lifecycle_state (
        session_id         TEXT PRIMARY KEY,
        fingerprint        TEXT NOT NULL,
        generation         INTEGER NOT NULL DEFAULT 1,
        objective_hash     TEXT NOT NULL,
        objective          TEXT NOT NULL DEFAULT '',
        state              TEXT NOT NULL,
        raw_state          TEXT NOT NULL,
        transition_seq     INTEGER NOT NULL,
        transition_id      TEXT NOT NULL,
        source             TEXT NOT NULL,
        native_updated_at  TEXT,
        native_cursor_json TEXT,
        observed_at        TEXT NOT NULL,
        updated_at         TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS session_turn_lifecycle (
        session_id          TEXT PRIMARY KEY,
        activity_kind       TEXT NOT NULL,
        active_anchor       TEXT,
        activity_updated_at TEXT,
        updated_at          TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS semantic_notification_events (
        dedupe_key  TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        category   TEXT NOT NULL,
        title      TEXT NOT NULL,
        body       TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_semantic_notification_created
        ON semantic_notification_events(created_at);
      CREATE TABLE IF NOT EXISTS semantic_notification_telemetry (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        stage_key           TEXT NOT NULL UNIQUE,
        dedupe_key          TEXT NOT NULL,
        session_id          TEXT NOT NULL,
        event_type          TEXT NOT NULL,
        stage               TEXT NOT NULL,
        reason_code         TEXT,
        harness             TEXT NOT NULL DEFAULT 'unknown',
        goal_affiliation    TEXT NOT NULL DEFAULT 'unknown',
        preference_revision TEXT,
        client_channel      TEXT,
        native_event_id     TEXT,
        turn_id             TEXT,
        occurred_at         TEXT NOT NULL,
        metadata_json       TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_semantic_notification_telemetry_time
        ON semantic_notification_telemetry(occurred_at);
      CREATE INDEX IF NOT EXISTS idx_semantic_notification_telemetry_stage
        ON semantic_notification_telemetry(stage, reason_code, client_channel, occurred_at);
    `);
    const goalColumns = new Set(
      this.db.prepare('PRAGMA table_info(goal_lifecycle_state)').all().map(info => info.name),
    );
    if (!goalColumns.has('generation')) {
      this.db.exec('ALTER TABLE goal_lifecycle_state ADD COLUMN generation INTEGER NOT NULL DEFAULT 1');
    }
    const telemetryColumns = new Set(
      this.db.prepare('PRAGMA table_info(semantic_notification_telemetry)').all().map(info => info.name),
    );
    if (!telemetryColumns.has('stage_key')) {
      this.db.exec('ALTER TABLE semantic_notification_telemetry ADD COLUMN stage_key TEXT');
      this.db.exec("UPDATE semantic_notification_telemetry SET stage_key = 'legacy:' || id WHERE stage_key IS NULL");
    }
    this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_semantic_notification_telemetry_stage_key
      ON semantic_notification_telemetry(stage_key)
    `);
  }

  _goalFromRow(row) {
    if (!row) return null;
    let nativeCursor = null;
    try { nativeCursor = row.native_cursor_json ? JSON.parse(row.native_cursor_json) : null; } catch {}
    return {
      fingerprint: row.fingerprint,
      generation: Math.max(1, Number(row.generation) || 1),
      objective_hash: row.objective_hash,
      objective: row.objective,
      text: row.objective,
      state: row.state,
      status: row.state,
      raw_state: row.raw_state,
      native_state: row.raw_state,
      transition_seq: Number(row.transition_seq) || 1,
      transition_id: row.transition_id,
      source: row.source,
      native_updated_at: row.native_updated_at,
      native_cursor: nativeCursor,
      observed_at: row.observed_at,
      updated_at: row.updated_at,
      terminal: TERMINAL_GOAL_STATES.has(row.state),
    };
  }

  currentGoal(sessionId) {
    return this._goalFromRow(this.getGoal.get(sessionId));
  }

  _persistGoal(sessionId, goal) {
    this.upsertGoal.run(
      sessionId,
      goal.fingerprint,
      goal.generation,
      goal.objective_hash,
      goal.objective,
      goal.state,
      goal.raw_state,
      goal.transition_seq,
      goal.transition_id,
      goal.source,
      goal.native_updated_at,
      goal.native_cursor ? JSON.stringify(goal.native_cursor) : null,
      goal.observed_at,
      goal.updated_at,
    );
  }

  recordStage(subject, stage, {
    reasonCode = null,
    harness = null,
    goalAffiliation = null,
    preferenceRevision = null,
    clientChannel = null,
    nativeEventId = null,
    turnId = null,
    occurredAt = null,
    metadata = null,
  } = {}) {
    if (!TELEMETRY_STAGES.has(stage) || !subject || typeof subject !== 'object') return null;
    const sessionId = String(subject.session_id || subject.session || '').trim();
    const eventType = String(subject.event_type || subject.category || '').trim();
    if (!sessionId || !eventType) return null;
    const at = normalizedIso(occurredAt || subject.created_at || subject.observed_at)
      || new Date(this.now()).toISOString();
    const resolvedNativeEventId = String(
      nativeEventId || subject.native_event_id || subject.transition_id || '',
    ).trim() || null;
    const resolvedTurnId = String(turnId || subject.turn_id || '').trim() || null;
    const dedupeKey = String(subject.dedupe_key || '').trim()
      || `telemetry:${hashText([
        sessionId, eventType, resolvedTurnId || '', resolvedNativeEventId || '', at,
      ].join('\u0000')).slice(0, 40)}`;
    const resolvedReason = String(
      reasonCode || (stage === 'suppressed' ? subject.reason : '') || '',
    ).trim().slice(0, 120) || null;
    const resolvedHarness = String(
      harness || subject.harness || subject.agent_type || 'unknown',
    ).trim().slice(0, 80) || 'unknown';
    const resolvedGoalAffiliation = String(
      goalAffiliation || subject.goal_affiliation || 'unknown',
    ).trim().slice(0, 48) || 'unknown';
    const resolvedPreferenceRevision = String(preferenceRevision || '').trim().slice(0, 80) || null;
    const resolvedClientChannel = String(clientChannel || '').trim().slice(0, 80) || null;
    const safeMetadata = telemetryMetadata(metadata);
    const stageKey = `stage:${hashText([
      dedupeKey,
      stage,
      resolvedReason || '',
      resolvedClientChannel || '',
      resolvedPreferenceRevision || '',
      safeMetadata.client_id || '',
      safeMetadata.delivery_result || '',
    ].join('\u0000')).slice(0, 48)}`;
    const result = this.insertTelemetry.run(
      stageKey,
      dedupeKey,
      sessionId,
      eventType,
      stage,
      resolvedReason,
      resolvedHarness,
      resolvedGoalAffiliation,
      resolvedPreferenceRevision,
      resolvedClientChannel,
      resolvedNativeEventId,
      resolvedTurnId,
      at,
      JSON.stringify(safeMetadata),
    );
    return result.changes === 1 ? (result.lastInsertRowid || null) : null;
  }

  recordClientStage(dedupeKey, stage, options = {}) {
    if (!CLIENT_TELEMETRY_STAGES.has(stage)) return { ok: false, code: 'invalid_stage' };
    const row = this.getEventByDedupe.get(String(dedupeKey || '').trim());
    if (!row) return { ok: false, code: 'unknown_event' };
    let event;
    try { event = JSON.parse(row.payload_json); } catch { return { ok: false, code: 'invalid_event' }; }
    const id = this.recordStage(event, stage, options);
    return { ok: true, id, duplicate: !id };
  }

  diagnostics({ maxAgeMs = 24 * 60 * 60 * 1000 } = {}) {
    const boundedAgeMs = Math.max(60 * 1000, Math.min(30 * 24 * 60 * 60 * 1000, Number(maxAgeMs) || 0));
    const since = new Date(this.now() - boundedAgeMs).toISOString();
    const grouped = (column) => this.db.prepare(`
      SELECT COALESCE(${column}, 'none') AS key, COUNT(*) AS count
      FROM semantic_notification_telemetry
      WHERE occurred_at >= ?
      GROUP BY COALESCE(${column}, 'none')
      ORDER BY count DESC, key ASC
      LIMIT 100
    `).all(since).map(row => ({ key: row.key, count: Number(row.count) || 0 }));
    const total = this.db.prepare(`
      SELECT COUNT(*) AS count FROM semantic_notification_telemetry WHERE occurred_at >= ?
    `).get(since);
    return {
      since,
      max_age_ms: boundedAgeMs,
      total: Number(total?.count) || 0,
      by_stage: grouped('stage'),
      by_reason: grouped('reason_code'),
      by_channel: grouped('client_channel'),
      by_harness: grouped('harness'),
      by_event_type: grouped('event_type'),
    };
  }

  _event(sessionId, eventType, category, sessionName, goal, dedupeKey, createdAt, telemetry = {}) {
    if (eventType === 'turn_ready'
      && !turnReadyCapabilityForHarness(telemetry.harness).enabled) return null;
    const copy = eventCopy(eventType, sessionName, goal);
    const payload = {
      type: 'semantic_notification',
      event_type: eventType,
      category,
      dedupe_key: dedupeKey,
      session_id: sessionId,
      session: sessionId,
      session_name: sessionName,
      title: copy.title,
      body: copy.body,
      activity_type: copy.activity_type,
      created_at: createdAt,
      harness: telemetry.harness || 'unknown',
      goal_affiliation: telemetry.goalAffiliation || (goal ? 'active_terminal_goal' : 'unknown'),
      ...(telemetry.nativeEventId ? { native_event_id: telemetry.nativeEventId } : {}),
      ...(telemetry.turnId ? { turn_id: telemetry.turnId } : {}),
      ...(goal ? { goal } : {}),
    };
    this.recordStage(payload, 'candidate', telemetry);
    const inserted = this.insertEvent.run(
      dedupeKey,
      sessionId,
      eventType,
      category,
      copy.title,
      copy.body,
      JSON.stringify(payload),
      createdAt,
    );
    if (inserted.changes === 1) {
      this.recordStage(payload, 'eligible', telemetry);
      return payload;
    }
    this.recordStage(payload, 'suppressed', { ...telemetry, reasonCode: 'duplicate_lifecycle_identity' });
    return null;
  }

  observeGoal(sessionId, incomingGoal, {
    sessionName = 'Agent',
    hydrateOnly = false,
    reconcileLive = false,
    harness = 'unknown',
  } = {}) {
    const nowIso = new Date(this.now()).toISOString();
    const current = normalizeGoalRecord(sessionId, incomingGoal, nowIso);
    if (!current) return { goal: this.currentGoal(sessionId), event: null, code: 'missing_goal' };
    const previous = this.currentGoal(sessionId);
    const incomingTime = Date.parse(current.native_updated_at || current.observed_at || '') || 0;
    const previousTime = Date.parse(previous?.native_updated_at || previous?.observed_at || '') || 0;
    if (previous && previous.fingerprint !== current.fingerprint) {
      const olderGeneration = current.generation < previous.generation;
      const stalePeerGeneration = current.generation === previous.generation
        && incomingTime > 0
        && previousTime > 0
        && incomingTime <= previousTime;
      if (olderGeneration || stalePeerGeneration) {
        return { goal: previous, event: null, code: 'out_of_order' };
      }
    }
    if (previous?.fingerprint === current.fingerprint) {
      const outOfOrder = current.transition_seq < previous.transition_seq
        || (current.transition_seq === previous.transition_seq
          && current.transition_id !== previous.transition_id
          && incomingTime <= previousTime);
      if (outOfOrder) return { goal: previous, event: null, code: 'out_of_order' };
      if (current.transition_id === previous.transition_id) {
        const duplicate = { ...current, transition_seq: Math.max(previous.transition_seq, current.transition_seq) };
        this._persistGoal(sessionId, duplicate);
        return { goal: duplicate, event: null, code: 'duplicate' };
      }
    }

    this._persistGoal(sessionId, current);
    const transitionIsFresh = Math.abs(this.now() - (incomingTime || this.now())) <= this.liveWindowMs;
    const reconcileHydration = hydrateOnly
      && reconcileLive
      && transitionIsFresh
      && previous
      && previous.fingerprint === current.fingerprint
      && previous.state !== current.state;
    if ((hydrateOnly && !reconcileHydration) || !previous
      || previous.fingerprint !== current.fingerprint || previous.state === current.state) {
      return { goal: current, event: null, code: hydrateOnly ? 'hydrated' : 'state_recorded' };
    }
    if (current.state === 'complete' && !TERMINAL_GOAL_STATES.has(previous.state)) {
      const dedupeKey = `goal_completed:${current.transition_id}`;
      return {
        goal: current,
        event: this._event(sessionId, 'goal_completed', 'goal_completed', sessionName, current, dedupeKey, nowIso, {
          harness,
          goalAffiliation: 'active_terminal_goal',
          nativeEventId: current.transition_id,
        }),
        code: 'goal_completed',
      };
    }
    if (ATTENTION_GOAL_STATES.has(current.state)) {
      const dedupeKey = `goal_attention:${current.transition_id}`;
      return {
        goal: current,
        event: this._event(sessionId, 'goal_attention', 'goal_attention', sessionName, current, dedupeKey, nowIso, {
          harness,
          goalAffiliation: 'active_terminal_goal',
          nativeEventId: current.transition_id,
        }),
        code: 'goal_attention',
      };
    }
    return { goal: current, event: null, code: 'transition_recorded' };
  }

  observeActivity(sessionId, activity, {
    sessionName = 'Agent',
    hydrateOnly = false,
    reconcileLive = false,
    harness = 'unknown',
  } = {}) {
    const nowMs = this.now();
    const nowIso = new Date(nowMs).toISOString();
    const goalResult = activity?.goal
      ? this.observeGoal(sessionId, activity.goal, {
          sessionName, hydrateOnly, reconcileLive, harness,
        })
      : { goal: this.currentGoal(sessionId), event: null, code: 'missing_goal' };
    const previousTurn = this.getTurn.get(sessionId);
    const turnCapability = turnReadyCapabilityForHarness(harness);
    const kind = String(activity?.kind || 'idle').trim().toLowerCase() || 'idle';
    const active = ACTIVE_ACTIVITY_KINDS.has(kind);
    const previousActive = ACTIVE_ACTIVITY_KINDS.has(String(previousTurn?.activity_kind || '').toLowerCase());
    const activityUpdatedAt = normalizedIso(activity?.updated_at) || nowIso;
    const activeAnchor = active
      ? (normalizedIso(activity?.started_at) || (previousActive ? previousTurn?.active_anchor : null) || activityUpdatedAt)
      : (previousTurn?.active_anchor || null);
    this.upsertTurn.run(sessionId, kind, activeAnchor, activityUpdatedAt, nowIso);

    // Fail closed: activity idleness is not an authoritative turn terminal.
    // Every harness must stay quiet until its adapter supplies a correlated
    // native terminal envelope and passes the harness-specific capability gate.
    // Do not reinstate timestamp/active-anchor inference here.
    const suppressedTurnReady = previousActive && kind === 'idle'
      ? {
          dedupe_key: `turn-ready-candidate:${hashText([
            sessionId, activeAnchor || '', activityUpdatedAt, kind,
          ].join('\u0000')).slice(0, 40)}`,
          session_id: sessionId,
          event_type: 'turn_ready',
          reason: hydrateOnly ? 'hydration'
            : goalResult.goal ? 'goal_affiliation_not_explicitly_none'
              : 'authoritative_terminal_missing',
          activity_kind: kind,
          active_anchor: activeAnchor,
          observed_at: nowIso,
          harness,
          capability_status: turnCapability.status,
          capability_source: turnCapability.observed_source,
          goal_affiliation: goalResult.goal ? 'active_terminal_goal' : 'unknown',
        }
      : null;
    if (suppressedTurnReady) {
      const telemetry = {
        harness,
        goalAffiliation: suppressedTurnReady.goal_affiliation,
        occurredAt: nowIso,
        metadata: {
          activity_kind: kind,
          source: String(activity?.source || 'activity_status'),
        },
      };
      this.recordStage(suppressedTurnReady, 'candidate', telemetry);
      this.recordStage(suppressedTurnReady, 'suppressed', {
        ...telemetry,
        reasonCode: suppressedTurnReady.reason,
      });
    }
    return {
      goal: goalResult.goal,
      goal_event: goalResult.event,
      turn_event: null,
      events: [goalResult.event].filter(Boolean),
      turn_suppression: suppressedTurnReady,
      suppressions: suppressedTurnReady ? [suppressedTurnReady] : [],
      turn_capability: turnCapability,
      code: goalResult.code,
    };
  }

  recentEvents({ maxAgeMs = 15 * 60 * 1000, limit = 50 } = {}) {
    const cutoff = new Date(this.now() - maxAgeMs).toISOString();
    return this.getRecent.all(cutoff, Math.max(1, Math.min(200, Number(limit) || 50)))
      .map(row => {
        try { return JSON.parse(row.payload_json); } catch { return null; }
      })
      .filter(event => event && event.event_type !== 'turn_ready');
  }
}

module.exports = {
  ACTIVE_ACTIVITY_KINDS,
  ATTENTION_GOAL_STATES,
  GoalNotificationCoordinator,
  REQUIRED_TURN_TERMINAL_GATES,
  TURN_READY_CAPABILITIES,
  TURN_READY_NOTIFICATIONS_ENABLED,
  eventCopy,
  hashText,
  normalizeGoalRecord,
  normalizeGoalState,
  turnReadyCapabilityForHarness,
};
