'use strict';

const crypto = require('crypto');

const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$|^[a-zA-Z0-9_-]{3,192}$/i;

function safeText(value, max = 192) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text.slice(0, max) : null;
}

function generationClock(value) {
  if (Number.isSafeInteger(value) && value >= 0) return value;
  const numeric = Number(value);
  if (Number.isSafeInteger(numeric) && numeric >= 0) return numeric;
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function tableExists(db, table) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
}

function tableColumns(db, table) {
  return tableExists(db, table) ? db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name) : [];
}

function insertRow(db, table, row, columns) {
  const names = columns.filter(column => Object.prototype.hasOwnProperty.call(row, column));
  const placeholders = names.map(() => '?').join(', ');
  db.prepare(`INSERT INTO ${table} (${names.join(', ')}) VALUES (${placeholders})`)
    .run(...names.map(name => row[name]));
}

function latestRow(left, right, fields = ['updated_at']) {
  if (!left) return right;
  if (!right) return left;
  for (const field of fields) {
    const leftClock = generationClock(left[field]);
    const rightClock = generationClock(right[field]);
    if (leftClock !== rightClock) return rightClock > leftClock ? right : left;
  }
  return left;
}

function mergedRow(preferred, fallback) {
  const merged = { ...(fallback || {}), ...(preferred || {}) };
  for (const [key, value] of Object.entries(fallback || {})) {
    if (merged[key] == null || merged[key] === '') merged[key] = value;
  }
  return merged;
}

function mergePrimaryRow(db, table, keyColumn, aliasId, canonicalId, choose = latestRow) {
  const columns = tableColumns(db, table);
  if (!columns.includes(keyColumn)) return 0;
  const select = db.prepare(`SELECT * FROM ${table} WHERE ${keyColumn} = ?`);
  const alias = select.get(aliasId);
  if (!alias) return 0;
  const canonical = select.get(canonicalId);
  const preferred = choose(canonical, alias);
  const merged = mergedRow(preferred, preferred === alias ? canonical : alias);
  merged[keyColumn] = canonicalId;
  db.prepare(`DELETE FROM ${table} WHERE ${keyColumn} IN (?, ?)`).run(aliasId, canonicalId);
  insertRow(db, table, merged, columns);
  return 1;
}

function replaceSessionInJson(value, aliasId, canonicalId) {
  if (typeof value !== 'string' || !value.includes(aliasId)) return value;
  try {
    const replace = item => {
      if (Array.isArray(item)) return item.map(replace);
      if (!item || typeof item !== 'object') return item === aliasId ? canonicalId : item;
      return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, replace(child)]));
    };
    return JSON.stringify(replace(JSON.parse(value)));
  } catch {
    return value;
  }
}

class SessionAliasReconciler {
  constructor(db) {
    this.db = db;
    this.aliases = new Map();
    db.exec(`
      CREATE TABLE IF NOT EXISTS session_aliases (
        alias_session_id TEXT PRIMARY KEY,
        canonical_session_id TEXT NOT NULL,
        canonical_conversation_id TEXT,
        canonical_native_id TEXT,
        current_surface TEXT,
        suppression_reason TEXT NOT NULL,
        generation_clock REAL NOT NULL DEFAULT 0,
        receipt_hash TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        released_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_session_aliases_canonical
        ON session_aliases(canonical_session_id, updated_at);
    `);
    const aliasColumns = new Set(tableColumns(db, 'session_aliases'));
    if (!aliasColumns.has('active')) {
      db.exec('ALTER TABLE session_aliases ADD COLUMN active INTEGER NOT NULL DEFAULT 1');
    }
    if (!aliasColumns.has('released_at')) {
      db.exec('ALTER TABLE session_aliases ADD COLUMN released_at TEXT');
    }
    this.records = new Map();
    for (const row of db.prepare('SELECT * FROM session_aliases').all()) {
      this.records.set(row.alias_session_id, row);
      if (Number(row.active) !== 0) this.aliases.set(row.alias_session_id, row);
    }
    this._migrate = db.transaction((aliasId, canonicalId) => this._migrateTransaction(aliasId, canonicalId));
  }

  resolve(sessionId) {
    let current = safeText(sessionId);
    const seen = new Set();
    while (current && !seen.has(current)) {
      seen.add(current);
      const next = this.aliases.get(current)?.canonical_session_id;
      if (!next) break;
      current = next;
    }
    return current || sessionId;
  }

  _migrateMessages(aliasId, canonicalId) {
    if (!tableExists(this.db, 'messages')) return 0;
    this.db.prepare(`
      DELETE FROM messages
      WHERE session = ? AND source_message_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM messages canonical
          WHERE canonical.session = ?
            AND canonical.source_message_id = messages.source_message_id
        )
    `).run(aliasId, canonicalId);
    return this.db.prepare('UPDATE messages SET session = ? WHERE session = ?').run(canonicalId, aliasId).changes;
  }

  _migrateCompositeRows(aliasId, canonicalId) {
    let changed = 0;
    if (tableExists(this.db, 'transcript_source_cursors')) {
      const rows = this.db.prepare('SELECT * FROM transcript_source_cursors WHERE session = ?').all(aliasId);
      const getCanonical = this.db.prepare('SELECT * FROM transcript_source_cursors WHERE session = ? AND source = ?');
      const columns = tableColumns(this.db, 'transcript_source_cursors');
      for (const alias of rows) {
        const canonical = getCanonical.get(canonicalId, alias.source);
        const preferred = latestRow(canonical, alias, ['message_index', 'end_offset', 'updated_at']);
        const merged = mergedRow(preferred, preferred === alias ? canonical : alias);
        merged.session = canonicalId;
        this.db.prepare('DELETE FROM transcript_source_cursors WHERE session IN (?, ?) AND source = ?')
          .run(aliasId, canonicalId, alias.source);
        insertRow(this.db, 'transcript_source_cursors', merged, columns);
        changed += 1;
      }
    }
    if (tableExists(this.db, 'session_preferences')) {
      const rows = this.db.prepare('SELECT * FROM session_preferences WHERE session_id = ?').all(aliasId);
      const getCanonical = this.db.prepare('SELECT * FROM session_preferences WHERE email = ? AND session_id = ?');
      const columns = tableColumns(this.db, 'session_preferences');
      for (const alias of rows) {
        const canonical = getCanonical.get(alias.email, canonicalId);
        const preferred = latestRow(canonical, alias, ['updated_at']);
        const merged = mergedRow(preferred, preferred === alias ? canonical : alias);
        merged.session_id = canonicalId;
        merged.archived = Math.max(Number(alias.archived) || 0, Number(canonical?.archived) || 0);
        merged.muted = Math.max(Number(alias.muted) || 0, Number(canonical?.muted) || 0);
        merged.pin_order = Number(canonical?.pin_order) > 0
          ? canonical.pin_order
          : (Number(alias.pin_order) > 0 ? alias.pin_order : 0);
        this.db.prepare('DELETE FROM session_preferences WHERE email = ? AND session_id IN (?, ?)')
          .run(alias.email, aliasId, canonicalId);
        insertRow(this.db, 'session_preferences', merged, columns);
        changed += 1;
      }
    }
    return changed;
  }

  _migrateTransaction(aliasId, canonicalId) {
    const counts = {
      messages: this._migrateMessages(aliasId, canonicalId),
      composite_rows: this._migrateCompositeRows(aliasId, canonicalId),
      send_receipts: 0,
      scheduled_sends: 0,
      automations: 0,
      notification_rows: 0,
      primary_rows: 0,
    };
    if (tableExists(this.db, 'send_receipts')) {
      counts.send_receipts = this.db.prepare('UPDATE send_receipts SET session = ? WHERE session = ?')
        .run(canonicalId, aliasId).changes;
    }
    if (tableExists(this.db, 'scheduled_sends')) {
      counts.scheduled_sends = this.db.prepare('UPDATE scheduled_sends SET session_id = ? WHERE session_id = ?')
        .run(canonicalId, aliasId).changes;
    }
    if (tableExists(this.db, 'automations')) {
      counts.automations = this.db.prepare('UPDATE automations SET target_session = ? WHERE target_session = ?')
        .run(canonicalId, aliasId).changes;
    }
    for (const table of ['semantic_notification_events', 'semantic_notification_telemetry']) {
      if (!tableExists(this.db, table)) continue;
      const result = this.db.prepare(`UPDATE ${table} SET session_id = ? WHERE session_id = ?`)
        .run(canonicalId, aliasId);
      counts.notification_rows += result.changes;
      if (table === 'semantic_notification_events' && tableColumns(this.db, table).includes('payload_json')) {
        for (const row of this.db.prepare(`SELECT rowid, payload_json FROM ${table} WHERE session_id = ?`).all(canonicalId)) {
          const next = replaceSessionInJson(row.payload_json, aliasId, canonicalId);
          if (next !== row.payload_json) this.db.prepare(`UPDATE ${table} SET payload_json = ? WHERE rowid = ?`).run(next, row.rowid);
        }
      }
    }
    const primaryTables = [
      ['usage_resume_jobs', 'session_id', (left, right) => {
        const active = row => ['pending', 'dispatching'].includes(String(row?.state || ''));
        if (active(left) !== active(right)) return active(right) ? right : left;
        return latestRow(left, right, ['updated_at']);
      }],
      ['session_meta', 'session_id', latestRow],
      ['session_latest_visible_message', 'session_id', (left, right) => latestRow(left, right, ['message_at', 'updated_at'])],
      ['goal_lifecycle_state', 'session_id', (left, right) => latestRow(left, right, ['generation', 'transition_seq', 'updated_at'])],
      ['goal_lifecycle_tombstone', 'session_id', (left, right) => latestRow(left, right, ['epoch', 'sequence', 'updated_at'])],
      ['session_turn_lifecycle', 'session_id', (left, right) => latestRow(left, right, ['updated_at'])],
    ];
    for (const [table, key, choose] of primaryTables) {
      counts.primary_rows += mergePrimaryRow(this.db, table, key, aliasId, canonicalId, choose);
    }
    return counts;
  }

  reconcile(event) {
    const aliasId = safeText(event?.alias_session_id);
    const canonicalId = this.resolve(event?.canonical_session_id);
    if (!SESSION_ID_RE.test(aliasId || '') || !SESSION_ID_RE.test(canonicalId || '') || aliasId === canonicalId) {
      return { accepted: false, reason: 'invalid_alias_identity', alias_session_id: aliasId, canonical_session_id: canonicalId };
    }
    const clock = generationClock(
      event?.owner_evidence?.observed_at
      || event?.owner_evidence?.generation
      || event?.generation
      || event?.observed_at,
    );
    const existing = this.records.get(aliasId);
    if (existing && (
      Number(existing.active) === 0
      || existing.canonical_session_id !== canonicalId
    ) && clock <= Number(existing.generation_clock || 0)) {
      return { accepted: false, reason: 'stale_alias_generation', ...existing };
    }
    const receiptHash = crypto.createHash('sha256').update(JSON.stringify({
      active: true,
      alias_session_id: aliasId,
      canonical_session_id: canonicalId,
      canonical_conversation_id: safeText(event.canonical_conversation_id),
      canonical_native_id: safeText(event.canonical_native_id),
      current_surface: safeText(event.current_surface, 80),
      suppression_reason: safeText(event.suppression_reason, 160),
      generation_clock: clock,
    })).digest('hex');
    if (Number(existing?.active) !== 0 && existing?.receipt_hash === receiptHash) {
      return { accepted: true, reason: 'idempotent_replay', alias: existing, counts: {} };
    }
    const counts = this._migrate(aliasId, canonicalId);
    const now = new Date().toISOString();
    const row = {
      alias_session_id: aliasId,
      canonical_session_id: canonicalId,
      canonical_conversation_id: safeText(event.canonical_conversation_id),
      canonical_native_id: safeText(event.canonical_native_id),
      current_surface: safeText(event.current_surface, 80),
      suppression_reason: safeText(event.suppression_reason, 160) || 'canonical_alias_reconciled',
      generation_clock: Math.max(clock, Number(existing?.generation_clock || 0)),
      receipt_hash: receiptHash,
      active: 1,
      released_at: null,
      created_at: existing?.created_at || now,
      updated_at: now,
    };
    this.db.prepare(`
      INSERT INTO session_aliases
        (alias_session_id, canonical_session_id, canonical_conversation_id, canonical_native_id,
         current_surface, suppression_reason, generation_clock, receipt_hash, active, released_at,
         created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(alias_session_id) DO UPDATE SET
        canonical_session_id = excluded.canonical_session_id,
        canonical_conversation_id = excluded.canonical_conversation_id,
        canonical_native_id = excluded.canonical_native_id,
        current_surface = excluded.current_surface,
        suppression_reason = excluded.suppression_reason,
        generation_clock = excluded.generation_clock,
        receipt_hash = excluded.receipt_hash,
        active = excluded.active,
        released_at = excluded.released_at,
        updated_at = excluded.updated_at
    `).run(...[
      row.alias_session_id, row.canonical_session_id, row.canonical_conversation_id, row.canonical_native_id,
      row.current_surface, row.suppression_reason, row.generation_clock, row.receipt_hash,
      row.active, row.released_at, row.created_at, row.updated_at,
    ]);
    this.records.set(aliasId, row);
    this.aliases.set(aliasId, row);
    return { accepted: true, reason: 'reconciled', alias: row, counts };
  }

  release(event) {
    const aliasId = safeText(event?.alias_session_id);
    const priorCanonicalId = safeText(event?.prior_canonical_session_id || event?.canonical_session_id);
    const ownerEvidence = event?.owner_evidence && typeof event.owner_evidence === 'object'
      ? event.owner_evidence
      : {};
    const currentSurface = safeText(event?.current_surface, 80);
    if (!SESSION_ID_RE.test(aliasId || '') || !SESSION_ID_RE.test(priorCanonicalId || '')
        || aliasId === priorCanonicalId) {
      return {
        accepted: false,
        reason: 'invalid_alias_release_identity',
        alias_session_id: aliasId,
        canonical_session_id: priorCanonicalId,
      };
    }
    if (ownerEvidence.verified !== true || currentSurface !== 'codex_cli') {
      return {
        accepted: false,
        reason: 'verified_cli_owner_required',
        alias_session_id: aliasId,
        canonical_session_id: priorCanonicalId,
      };
    }
    const clock = generationClock(
      ownerEvidence.observed_at
      || ownerEvidence.generation
      || event?.generation
      || event?.observed_at,
    );
    if (clock <= 0) {
      return {
        accepted: false,
        reason: 'alias_release_generation_required',
        alias_session_id: aliasId,
        canonical_session_id: priorCanonicalId,
      };
    }
    const existing = this.records.get(aliasId);
    if (existing && existing.canonical_session_id !== priorCanonicalId) {
      return {
        accepted: false,
        reason: 'alias_release_canonical_mismatch',
        alias_session_id: aliasId,
        canonical_session_id: priorCanonicalId,
      };
    }
    const receiptHash = crypto.createHash('sha256').update(JSON.stringify({
      active: false,
      alias_session_id: aliasId,
      canonical_session_id: priorCanonicalId,
      canonical_conversation_id: safeText(event.canonical_conversation_id),
      canonical_native_id: safeText(event.canonical_native_id),
      current_surface: currentSurface,
      suppression_reason: safeText(event.release_reason || event.suppression_reason, 160),
      generation_clock: clock,
    })).digest('hex');
    if (Number(existing?.active) === 0 && existing?.receipt_hash === receiptHash) {
      return { accepted: true, reason: 'idempotent_release_replay', alias: existing };
    }
    if (existing && clock <= Number(existing.generation_clock || 0)) {
      return {
        accepted: false,
        reason: 'stale_alias_release',
        alias_session_id: aliasId,
        canonical_session_id: priorCanonicalId,
      };
    }
    const now = new Date().toISOString();
    const row = {
      alias_session_id: aliasId,
      canonical_session_id: priorCanonicalId,
      canonical_conversation_id: safeText(event.canonical_conversation_id)
        || existing?.canonical_conversation_id
        || null,
      canonical_native_id: safeText(event.canonical_native_id)
        || existing?.canonical_native_id
        || null,
      current_surface: currentSurface,
      suppression_reason: safeText(event.release_reason || event.suppression_reason, 160)
        || 'verified_cli_owner_restored',
      generation_clock: clock,
      receipt_hash: receiptHash,
      active: 0,
      released_at: now,
      created_at: existing?.created_at || now,
      updated_at: now,
    };
    this.db.prepare(`
      INSERT INTO session_aliases
        (alias_session_id, canonical_session_id, canonical_conversation_id, canonical_native_id,
         current_surface, suppression_reason, generation_clock, receipt_hash, active, released_at,
         created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(alias_session_id) DO UPDATE SET
        canonical_session_id = excluded.canonical_session_id,
        canonical_conversation_id = excluded.canonical_conversation_id,
        canonical_native_id = excluded.canonical_native_id,
        current_surface = excluded.current_surface,
        suppression_reason = excluded.suppression_reason,
        generation_clock = excluded.generation_clock,
        receipt_hash = excluded.receipt_hash,
        active = excluded.active,
        released_at = excluded.released_at,
        updated_at = excluded.updated_at
    `).run(...[
      row.alias_session_id, row.canonical_session_id, row.canonical_conversation_id, row.canonical_native_id,
      row.current_surface, row.suppression_reason, row.generation_clock, row.receipt_hash,
      row.active, row.released_at, row.created_at, row.updated_at,
    ]);
    this.records.set(aliasId, row);
    this.aliases.delete(aliasId);
    return { accepted: true, reason: 'released', alias: row };
  }
}

module.exports = {
  SessionAliasReconciler,
  generationClock,
  replaceSessionInJson,
};
