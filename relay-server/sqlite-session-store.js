'use strict';

const session = require('express-session');

const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function sessionExpiry(data, now, defaultTtlMs) {
  const explicit = data?.cookie?.expires ? new Date(data.cookie.expires).getTime() : NaN;
  if (Number.isFinite(explicit)) return explicit;
  const maxAge = Number(data?.cookie?.originalMaxAge ?? data?.cookie?.maxAge);
  return now + (Number.isFinite(maxAge) && maxAge > 0 ? maxAge : defaultTtlMs);
}

class SqliteSessionStore extends session.Store {
  constructor(db, { defaultTtlMs = DEFAULT_TTL_MS } = {}) {
    super();
    if (!db || typeof db.prepare !== 'function') {
      throw new TypeError('SqliteSessionStore requires a better-sqlite3 database');
    }
    this.db = db;
    this.defaultTtlMs = defaultTtlMs;
    this.lastCleanupAt = 0;
    db.exec(`
      CREATE TABLE IF NOT EXISTS browser_sessions (
        sid        TEXT PRIMARY KEY,
        data       TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_browser_sessions_expiry
        ON browser_sessions(expires_at);
    `);
    this.getStatement = db.prepare(`
      SELECT data, expires_at FROM browser_sessions WHERE sid = ?
    `);
    this.setStatement = db.prepare(`
      INSERT INTO browser_sessions (sid, data, expires_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(sid) DO UPDATE SET
        data = excluded.data,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at
    `);
    this.destroyStatement = db.prepare('DELETE FROM browser_sessions WHERE sid = ?');
    this.cleanupStatement = db.prepare('DELETE FROM browser_sessions WHERE expires_at <= ?');
  }

  cleanupExpired(now = Date.now()) {
    if (now - this.lastCleanupAt < 60_000) return;
    this.cleanupStatement.run(now);
    this.lastCleanupAt = now;
  }

  get(sid, callback) {
    try {
      const now = Date.now();
      const row = this.getStatement.get(sid);
      if (!row || row.expires_at <= now) {
        if (row) this.destroyStatement.run(sid);
        callback(null, null);
        return;
      }
      callback(null, JSON.parse(row.data));
    } catch (error) {
      callback(error);
    }
  }

  set(sid, data, callback = () => {}) {
    try {
      const now = Date.now();
      this.cleanupExpired(now);
      this.setStatement.run(
        sid,
        JSON.stringify(data),
        sessionExpiry(data, now, this.defaultTtlMs),
        now,
      );
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  destroy(sid, callback = () => {}) {
    try {
      this.destroyStatement.run(sid);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  touch(sid, data, callback = () => {}) {
    this.set(sid, data, callback);
  }
}

module.exports = { SqliteSessionStore, sessionExpiry };
