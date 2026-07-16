#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('../relay-server/node_modules/better-sqlite3');

const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
const outputPath = outputIndex >= 0 && args[outputIndex + 1]
  ? path.resolve(args[outputIndex + 1])
  : null;

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function assertIsolatedRoot(root) {
  const resolved = path.resolve(root);
  const tempRoot = path.resolve(os.tmpdir()) + path.sep;
  assert(resolved.startsWith(tempRoot), `drill root escaped the OS temp directory: ${resolved}`);
  assert(path.basename(resolved).startsWith('rac-relay-restore-drill-'),
    `drill root lacks the required isolation prefix: ${resolved}`);
  assert(!resolved.toLowerCase().includes(`${path.sep}data${path.sep}messages.db`),
    'drill must never target the production relay database');
}

function readSnapshot(db) {
  return {
    messages: db.prepare(`
      SELECT session, role, content, ts, blocks
      FROM messages
      ORDER BY id
    `).all(),
    sessions: db.prepare(`
      SELECT session_id, agent_type, display_name, workspace_path
      FROM session_meta
      ORDER BY session_id
    `).all(),
  };
}

async function main() {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-relay-restore-drill-'));
  assertIsolatedRoot(root);

  const sourceDir = path.join(root, 'source');
  const backupDir = path.join(root, 'backups');
  const recoveryDir = path.join(root, 'pre-restore');
  const restoreDir = path.join(root, 'restored');
  for (const dir of [sourceDir, backupDir, recoveryDir, restoreDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const sourcePath = path.join(sourceDir, 'messages.db');
  const partialPath = path.join(backupDir, 'messages-incomplete.db.partial');
  const backupPath = path.join(backupDir, 'messages-drill.db');
  const backupWorkPath = backupPath + '.partial';
  const restorePath = path.join(restoreDir, 'messages.db');
  const preservedPath = path.join(recoveryDir, 'messages.db.corrupt');

  let source;
  let restored;
  let result;
  try {
    source = new Database(sourcePath);
    assert.equal(source.pragma('journal_mode = WAL', { simple: true }).toLowerCase(), 'wal');
    source.pragma('synchronous = NORMAL');
    source.pragma('wal_autocheckpoint = 0');
    source.exec(`
      CREATE TABLE messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        ts INTEGER NOT NULL,
        blocks TEXT
      );
      CREATE TABLE session_meta (
        session_id TEXT PRIMARY KEY,
        agent_type TEXT,
        display_name TEXT,
        workspace_path TEXT
      );
    `);

    const insertSession = source.prepare(`
      INSERT INTO session_meta (session_id, agent_type, display_name, workspace_path)
      VALUES (?, ?, ?, ?)
    `);
    const insertMessage = source.prepare(`
      INSERT INTO messages (session, role, content, ts, blocks)
      VALUES (?, ?, ?, ?, ?)
    `);
    source.transaction(() => {
      insertSession.run('restore-drill-codex', 'codex_cli', 'Restore drill Codex', 'C:\\isolated\\fixture');
      insertSession.run('restore-drill-claude', 'claude_cli', 'Restore drill Claude', 'C:\\isolated\\fixture');
      insertMessage.run('restore-drill-codex', 'user', 'Preserve this operator request.', 1001, null);
      insertMessage.run('restore-drill-codex', 'assistant', 'Preserved canonical response.', 1002,
        JSON.stringify([
          { type: 'text', text: 'Preserved canonical response.' },
          { type: 'tool_call', name: 'Read', input: { file_path: 'fixture.txt' } },
          { type: 'tool_result', text: 'fixture contents' },
        ]));
      insertMessage.run('restore-drill-claude', 'assistant', 'Second session survives.', 1003,
        JSON.stringify([{ type: 'thinking', text: 'bounded fixture reasoning' }]));
    })();

    const expected = readSnapshot(source);
    assert.equal(expected.messages.length, 3);
    assert.equal(expected.sessions.length, 2);
    const walPath = sourcePath + '-wal';
    assert(fs.existsSync(walPath) && fs.statSync(walPath).size > 0,
      'fixture must contain uncheckpointed WAL pages before the online backup');

    fs.writeFileSync(partialPath, 'incomplete backup must never be selected');
    const selectableBackups = fs.readdirSync(backupDir).filter(name => /^messages-.+\.db$/.test(name));
    assert.deepEqual(selectableBackups, [], '.partial backup was incorrectly treated as restorable');

    await source.backup(backupWorkPath);
    fs.renameSync(backupWorkPath, backupPath);
    assert(fs.statSync(backupPath).size > 0, 'online backup is empty');

    const backupCheck = new Database(backupPath, { readonly: true, fileMustExist: true });
    try {
      assert.equal(backupCheck.pragma('integrity_check', { simple: true }), 'ok');
      assert.deepEqual(readSnapshot(backupCheck), expected,
        'online backup omitted committed rows from the WAL-backed source');
    } finally {
      backupCheck.close();
    }

    // Model the documented stopped-relay restore: preserve a broken current DB,
    // copy only a completed backup, and leave stale WAL/SHM siblings behind nowhere.
    fs.writeFileSync(restorePath, Buffer.from('not a sqlite database'));
    fs.renameSync(restorePath, preservedPath);
    fs.copyFileSync(backupPath, restorePath);
    assert(!fs.existsSync(restorePath + '-wal') && !fs.existsSync(restorePath + '-shm'),
      'restored database must not inherit stale WAL/SHM siblings');

    restored = new Database(restorePath, { readonly: true, fileMustExist: true });
    const integrity = restored.pragma('integrity_check', { simple: true });
    const quickCheck = restored.pragma('quick_check', { simple: true });
    const actual = readSnapshot(restored);
    assert.equal(integrity, 'ok');
    assert.equal(quickCheck, 'ok');
    assert.deepEqual(actual, expected);
    assert.equal(sha256File(restorePath), sha256File(backupPath),
      'restored database bytes do not match the completed backup');

    result = {
      ok: true,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - started,
      scope: 'isolated OS temp fixture only',
      production_mutations: 0,
      visible_windows_opened: 0,
      source: {
        journal_mode: 'wal',
        uncheckpointed_wal_proved: true,
        sessions: expected.sessions.length,
        messages: expected.messages.length,
        canonical_block_types: ['text', 'tool_call', 'tool_result', 'thinking'],
      },
      backup: {
        online_api: true,
        completed_file_selected: true,
        partial_file_rejected: true,
        sha256: sha256File(backupPath),
      },
      restore: {
        corrupt_database_preserved: fs.existsSync(preservedPath),
        stale_wal_or_shm_restored: false,
        integrity_check: integrity,
        quick_check: quickCheck,
        exact_rows_restored: true,
        exact_backup_bytes_restored: true,
      },
      cleanup: { fixture_removed: false },
    };
  } finally {
    if (restored?.open) restored.close();
    if (source?.open) source.close();
    assertIsolatedRoot(root);
    fs.rmSync(root, { recursive: true, force: true });
  }

  assert(!fs.existsSync(root), 'isolated fixture directory survived cleanup');
  result.cleanup.fixture_removed = true;
  result.completed_at = new Date().toISOString();
  result.duration_ms = Date.now() - started;
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n');
  }
  console.log(JSON.stringify(result, null, 2));
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
