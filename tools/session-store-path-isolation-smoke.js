#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const productionStore = path.join(root, 'agent-proxy', 'session-store.json');
const modulePath = path.join(root, 'agent-proxy', 'session-store.js');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-session-store-isolation-'));
const isolatedStore = path.join(tempRoot, 'rescue-session-store.json');

try {
  const source = [
    `const store = require(${JSON.stringify(modulePath)});`,
    `const row = store.resolveVirtualSession({`,
    `  virtualId: 'rescue-drill-fixture', agentType: 'claude',`,
    `  displayName: 'Claude Code', workspaceName: 'fixture',`,
    `  workspacePath: 'C:\\\\temp\\\\rescue-fixture', windowTitle: 'fixture', extra: {},`,
    `});`,
    `if (!row || !row.session_id) process.exit(3);`,
  ].join('\n');
  const child = spawnSync(process.execPath, ['-e', source], {
    cwd: root,
    env: { ...process.env, SESSION_STORE_PATH: isolatedStore },
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.strictEqual(child.status, 0, child.stderr || child.stdout || 'isolated store child failed');
  assert(fs.existsSync(isolatedStore), 'isolated session store was not created');
  const parsed = JSON.parse(fs.readFileSync(isolatedStore, 'utf8'));
  assert.strictEqual(Object.keys(parsed.sessions || {}).length, 1);
  assert.strictEqual(Object.values(parsed.sessions)[0].agent_type, 'claude');
  const production = JSON.parse(fs.readFileSync(productionStore, 'utf8'));
  const contaminated = Object.values(production.sessions || {}).some(session => (
    session.virtual_id === 'rescue-drill-fixture'
    || String(session.workspace_path || '').includes('rescue-fixture')
  ));
  assert.strictEqual(contaminated, false, 'isolated fixture leaked into the production session store');
  console.log(JSON.stringify({ ok: true, isolated_sessions: 1, production_store_not_contaminated: true }));
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
