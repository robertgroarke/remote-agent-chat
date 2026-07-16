#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const Database = require('../relay-server/node_modules/better-sqlite3');

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

async function waitForHealth(port) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const ok = await new Promise(resolve => {
        const req = http.get({ host: '127.0.0.1', port, path: '/healthz' }, response => {
          response.resume();
          resolve(response.statusCode === 200);
        });
        req.once('error', () => resolve(false));
      });
      if (ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('legacy migration relay did not become healthy');
}

async function main() {
  const port = await freePort();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-session-noise-migration-'));
  const databasePath = path.join(tempRoot, 'messages.db');
  const db = new Database(databasePath);
  db.exec(`
    CREATE TABLE session_meta (
      session_id TEXT PRIMARY KEY, workspace_path TEXT, project_root TEXT,
      workspace_name TEXT, agent_type TEXT, cli_session_id TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO session_meta (session_id, workspace_path, project_root, workspace_name, agent_type)
    VALUES
      ('legacy-validator', 'C:\\temp\\remote-agent-vscode-test', NULL, 'Validator', 'codex_cli'),
      ('legacy-operator', 'C:\\work\\operator', NULL, 'Operator', 'codex_cli');
  `);
  db.close();
  const child = spawn(process.execPath, ['index.js'], {
    cwd: path.join(__dirname, '..', 'relay-server'),
    env: {
      ...process.env,
      PORT: String(port), PUBLIC_URL: `http://127.0.0.1:${port}`,
      SESSION_SECRET: 'session-noise-migration-secret-at-least-32-chars',
      GOOGLE_CLIENT_ID: 'migration-client-id', GOOGLE_CLIENT_SECRET: 'migration-client-secret',
      PROXY_SECRET: 'migration-proxy-secret', RAC_DATA_DIR: tempRoot,
      ALLOW_LAN_BYPASS: 'true', ALLOW_LOOPBACK_BYPASS: 'true', FIREBASE_SERVICE_ACCOUNT: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  const output = [];
  child.stdout.on('data', chunk => output.push(chunk.toString()));
  child.stderr.on('data', chunk => output.push(chunk.toString()));
  try {
    await waitForHealth(port);
    const verify = new Database(databasePath, { readonly: true });
    const rows = verify.prepare(`
      SELECT session_id, session_kind, is_test_session, project_group
      FROM session_meta ORDER BY session_id
    `).all();
    verify.close();
    assert.deepEqual(rows, [
      { session_id: 'legacy-operator', session_kind: 'operator', is_test_session: 0, project_group: null },
      { session_id: 'legacy-validator', session_kind: 'validator', is_test_session: 1, project_group: 'Remote Agent Chat' },
    ]);
    assert(output.join('').includes('Backfilled legacy session noise metadata'));
    console.log(JSON.stringify({ ok: true, legacy_rows: 2, validator_rows: 1, operator_rows: 1 }, null, 2));
  } finally {
    if (child.exitCode == null) {
      await new Promise(resolve => {
        child.once('exit', resolve);
        child.kill();
        setTimeout(() => child.exitCode == null && child.kill('SIGKILL'), 1_000).unref();
      });
    }
    const resolved = path.resolve(tempRoot);
    assert(resolved.startsWith(path.resolve(os.tmpdir(), 'rac-session-noise-migration-')));
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
