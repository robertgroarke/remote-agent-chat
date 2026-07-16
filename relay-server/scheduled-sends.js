'use strict';

const crypto = require('crypto');

const MAX_CONTENT_BYTES = 512 * 1024;
const MAX_FUTURE_MS = 366 * 24 * 60 * 60 * 1000;

function publicJob(row) {
  if (!row) return null;
  return {
    id: row.id, session_id: row.session_id, content: row.content,
    trigger_kind: row.trigger_kind, deliver_at: row.deliver_at || null,
    state: row.state, client_message_id: row.client_msg_id || null,
    last_error: row.last_error || null, created_at: row.created_at,
    updated_at: row.updated_at, dispatched_at: row.dispatched_at || null,
    completed_at: row.completed_at || null,
  };
}

class ScheduledSendStore {
  constructor(db, { now = () => new Date() } = {}) {
    this.db = db;
    this.now = now;
    db.exec(`
      CREATE TABLE IF NOT EXISTS scheduled_sends (
        id TEXT PRIMARY KEY,
        owner_email TEXT NOT NULL,
        session_id TEXT NOT NULL,
        content TEXT NOT NULL,
        trigger_kind TEXT NOT NULL CHECK(trigger_kind IN ('at', 'idle')),
        deliver_at TEXT,
        state TEXT NOT NULL DEFAULT 'pending',
        client_msg_id TEXT UNIQUE,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        dispatched_at TEXT,
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_scheduled_sends_due
        ON scheduled_sends(state, trigger_kind, deliver_at);
      CREATE INDEX IF NOT EXISTS idx_scheduled_sends_session
        ON scheduled_sends(owner_email, session_id, created_at);
    `);
    this.selectOwnerById = db.prepare('SELECT owner_email FROM scheduled_sends WHERE id = ?');
    // A relay crash after proxy hand-off cannot be replayed safely without
    // risking a duplicate native send. Preserve the job and surface that
    // uncertainty instead of silently redispatching it on startup.
    const nowIso = this.now().toISOString();
    db.prepare(`
      UPDATE scheduled_sends
      SET state = 'failed', last_error = ?, updated_at = ?, completed_at = ?
      WHERE state = 'dispatching'
    `).run('Relay restarted while delivery was in progress; delivery state is unknown.', nowIso, nowIso);
  }

  create({ ownerEmail, sessionId, content, triggerKind, deliverAt = null }) {
    const now = this.now();
    if (!ownerEmail || !sessionId) throw new Error('Owner and session are required');
    if (typeof content !== 'string' || !content.trim()) throw new Error('Message is required');
    if (Buffer.byteLength(content, 'utf8') > MAX_CONTENT_BYTES) throw new Error('Message is too large');
    if (!['at', 'idle'].includes(triggerKind)) throw new Error('Trigger must be at or idle');
    let normalizedAt = null;
    if (triggerKind === 'at') {
      const parsed = Date.parse(deliverAt || '');
      if (!Number.isFinite(parsed) || parsed <= now.getTime()) throw new Error('Delivery time must be in the future');
      if (parsed - now.getTime() > MAX_FUTURE_MS) throw new Error('Delivery time is too far in the future');
      normalizedAt = new Date(parsed).toISOString();
    }
    const id = `scheduled-${crypto.randomUUID()}`;
    const clientMessageId = `scheduled-send-${id}`;
    const nowIso = now.toISOString();
    this.db.prepare(`
      INSERT INTO scheduled_sends
        (id, owner_email, session_id, content, trigger_kind, deliver_at, state,
         client_msg_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
    `).run(id, ownerEmail.toLowerCase(), sessionId, content, triggerKind, normalizedAt, clientMessageId, nowIso, nowIso);
    return publicJob(this.db.prepare('SELECT * FROM scheduled_sends WHERE id = ?').get(id));
  }

  list(ownerEmail, sessionId = null) {
    const rows = sessionId
      ? this.db.prepare('SELECT * FROM scheduled_sends WHERE owner_email = ? AND session_id = ? ORDER BY created_at DESC LIMIT 200').all(ownerEmail.toLowerCase(), sessionId)
      : this.db.prepare('SELECT * FROM scheduled_sends WHERE owner_email = ? ORDER BY created_at DESC LIMIT 200').all(ownerEmail.toLowerCase());
    return rows.map(publicJob);
  }

  ownerEmail(id) {
    const owner = this.selectOwnerById.get(id)?.owner_email;
    return owner ? String(owner).toLowerCase() : null;
  }

  cancel(ownerEmail, id) {
    const nowIso = this.now().toISOString();
    const result = this.db.prepare(`
      UPDATE scheduled_sends SET state = 'cancelled', updated_at = ?, completed_at = ?
      WHERE id = ? AND owner_email = ? AND state = 'pending'
    `).run(nowIso, nowIso, id, ownerEmail.toLowerCase());
    return result.changes === 1 ? publicJob(this.db.prepare('SELECT * FROM scheduled_sends WHERE id = ?').get(id)) : null;
  }

  dueAt(limit = 20) {
    return this.db.prepare(`
      SELECT * FROM scheduled_sends
      WHERE state = 'pending' AND trigger_kind = 'at' AND deliver_at <= ?
      ORDER BY deliver_at ASC LIMIT ?
    `).all(this.now().toISOString(), limit).map(publicJob);
  }

  dueIdle(sessionId, limit = 20) {
    return this.db.prepare(`
      SELECT * FROM scheduled_sends
      WHERE state = 'pending' AND trigger_kind = 'idle' AND session_id = ?
      ORDER BY created_at ASC LIMIT ?
    `).all(sessionId, limit).map(publicJob);
  }

  claim(id) {
    const nowIso = this.now().toISOString();
    const result = this.db.prepare(`
      UPDATE scheduled_sends SET state = 'dispatching', updated_at = ?, dispatched_at = ?
      WHERE id = ? AND state = 'pending'
    `).run(nowIso, nowIso, id);
    return result.changes === 1 ? publicJob(this.db.prepare('SELECT * FROM scheduled_sends WHERE id = ?').get(id)) : null;
  }

  settle(clientMessageId, result, error = null) {
    const job = this.db.prepare('SELECT * FROM scheduled_sends WHERE client_msg_id = ?').get(clientMessageId);
    if (!job || job.state !== 'dispatching') return publicJob(job);
    const nowIso = this.now().toISOString();
    const state = result === 'delivered' ? 'completed' : 'failed';
    this.db.prepare(`
      UPDATE scheduled_sends
      SET state = ?, last_error = ?, updated_at = ?, completed_at = ?
      WHERE client_msg_id = ? AND state = 'dispatching'
    `).run(state, state === 'failed' ? String(error || 'Proxy rejected scheduled send').slice(0, 500) : null, nowIso, nowIso, clientMessageId);
    return publicJob(this.db.prepare('SELECT * FROM scheduled_sends WHERE client_msg_id = ?').get(clientMessageId));
  }
}

module.exports = { MAX_CONTENT_BYTES, MAX_FUTURE_MS, ScheduledSendStore, publicJob };
