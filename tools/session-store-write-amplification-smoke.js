'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-session-store-writes-'));
const storePath = path.join(tempRoot, 'session-store.json');
process.env.SESSION_STORE_PATH = storePath;
process.env.SESSION_STORE_SAVE_DEBOUNCE_MS = '10000';
process.env.SESSION_STORE_SAVE_MAX_WAIT_MS = '10000';
process.env.SESSION_STORE_LAST_SEEN_PERSIST_MS = '60000';
const staleTempPath = `${storePath}.2147483647.1.tmp`;
fs.writeFileSync(staleTempPath, Buffer.alloc(1024));

try {
  const store = require('../agent-proxy/session-store');
  assert.equal(fs.existsSync(staleTempPath), false, 'orphaned atomic-save temp files must be reclaimed at startup');
  const session = store.resolveVirtualSession({
    virtualId: 'write-amplification-fixture',
    agentType: 'claude_cli',
    displayName: 'Claude CLI fixture',
    workspaceName: 'fixture',
    workspacePath: tempRoot,
  });
  assert(fs.existsSync(storePath), 'new sessions must remain synchronously durable');
  const baseline = fs.readFileSync(storePath);

  for (let index = 0; index < 100; index += 1) {
    store.migrateVirtualSession(
      session.session_id,
      'write-amplification-fixture',
      'claude_cli',
    );
  }
  assert.equal(store.flushPendingSaves(), false, 'idempotent virtual-session migration must not schedule persistence');
  assert(fs.readFileSync(storePath).equals(baseline), 'idempotent virtual-session migration rewrote the durable store');

  for (let index = 0; index < 100; index += 1) {
    store.resolveVirtualSession({
      virtualId: 'write-amplification-fixture',
      agentType: 'claude_cli',
      displayName: 'Claude CLI fixture',
      workspaceName: 'fixture',
      workspacePath: tempRoot,
    });
    store.updateSession(session.session_id, {
      activity: {
        kind: 'idle',
        label: '',
        updated_at: new Date(Date.now() + index).toISOString(),
        thinkingContent: `volatile-${index}`,
      },
    });
  }
  assert.equal(store.flushPendingSaves(), false, 'volatile polling touches must not schedule persistence');
  assert(fs.readFileSync(storePath).equals(baseline), 'volatile polling touches rewrote the durable store');

  for (let index = 0; index < 100; index += 1) {
    store.updateSession(session.session_id, {
      accumulated_messages: [{ role: 'assistant', content: `revision-${index}` }],
    });
  }
  store.updateSession(session.session_id, {
    activity: { kind: 'generating', label: 'Working', updated_at: new Date().toISOString() },
  });
  assert(fs.readFileSync(storePath).equals(baseline), 'high-frequency transcript/activity updates must coalesce');
  assert.equal(store.flushPendingSaves(), true, 'meaningful coalesced updates must remain flushable');
  const coalesced = JSON.parse(fs.readFileSync(storePath, 'utf8')).sessions[session.session_id];
  assert.equal(coalesced.accumulated_messages[0].content, 'revision-99');
  assert.equal(coalesced.activity.kind, 'generating');

  store.updateSession(session.session_id, { chat_title: 'Durable title' });
  const structural = JSON.parse(fs.readFileSync(storePath, 'utf8')).sessions[session.session_id];
  assert.equal(structural.chat_title, 'Durable title', 'operator-visible structural changes must remain immediately durable');

  const heartbeatAt = new Date(Date.now() + 61_000).toISOString();
  store.updateSession(session.session_id, { last_seen_at: heartbeatAt });
  assert.equal(store.flushPendingSaves(), true, 'long-lived sessions must periodically checkpoint last_seen_at');
  const heartbeat = JSON.parse(fs.readFileSync(storePath, 'utf8')).sessions[session.session_id];
  assert.equal(heartbeat.last_seen_at, heartbeatAt);

  console.log(JSON.stringify({
    ok: true,
    volatile_updates_skipped: 200,
    idempotent_migrations_skipped: 100,
    transcript_updates_coalesced: 100,
    explicit_shutdown_flush: true,
    immediate_structural_durability: true,
    periodic_last_seen_checkpoint: true,
    stale_temp_reclaimed: true,
  }, null, 2));
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
