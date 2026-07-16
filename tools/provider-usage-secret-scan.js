#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
const outputPath = outputIndex >= 0 && args[outputIndex + 1] ? path.resolve(args[outputIndex + 1]) : null;
const androidIndex = args.indexOf('--android-export');
const androidExport = androidIndex >= 0 && args[androidIndex + 1] ? path.resolve(args[androidIndex + 1]) : null;
const additionalTargets = args.reduce((targets, arg, index) => {
  if (arg === '--target' && args[index + 1]) targets.push(path.resolve(args[index + 1]));
  return targets;
}, []);

function localSensitiveValues() {
  const values = [];
  const add = (kind, value) => {
    const text = typeof value === 'string' ? value.trim() : '';
    if (text.length >= 8) values.push({ kind, value: text });
  };
  try {
    const auth = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.codex', 'auth.json'), 'utf8'));
    add('token', auth?.tokens?.access_token);
    add('token', auth?.tokens?.refresh_token);
    add('account_id', auth?.tokens?.account_id);
    add('token', auth?.OPENAI_API_KEY);
  } catch {}
  try {
    const auth = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', '.credentials.json'), 'utf8'));
    add('token', auth?.claudeAiOauth?.accessToken);
    add('token', auth?.claudeAiOauth?.refreshToken);
    add('account_id', auth?.organizationUuid);
  } catch {}
  try {
    const { DatabaseSync } = require('node:sqlite');
    const databasePath = path.join(process.env.APPDATA || '', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
    const database = new DatabaseSync(databasePath, { readOnly: true });
    const rows = database.prepare(`
      SELECT key, value FROM ItemTable
      WHERE key IN ('cursorAuth/accessToken','cursorAuth/refreshToken','cursorAuth/cachedEmail')
    `).all();
    for (const row of rows) {
      let value = row.value;
      try { value = JSON.parse(value); } catch {}
      const text = typeof value === 'string' ? value : value?.accessToken || value?.value;
      add(row.key.endsWith('cachedEmail') ? 'email' : 'token', text);
    }
    database.close();
  } catch {}
  const unique = new Map();
  for (const entry of values) unique.set(`${entry.kind}:${entry.value}`, entry);
  return [...unique.values()];
}

function collectFiles(target, files) {
  if (!target || !fs.existsSync(target)) return;
  const stats = fs.statSync(target);
  if (stats.isFile()) {
    files.push(target);
    return;
  }
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (['node_modules', '.git'].includes(entry.name)) continue;
    collectFiles(path.join(target, entry.name), files);
  }
}

function main() {
  const targets = [
    path.join(root, 'frontend', 'dist', 'bundle.js'),
    path.join(root, 'relay-server', 'public', 'dist', 'bundle.js'),
    path.join(root, 'evidence', 'provider-usage-20260714'),
  ];
  if (androidExport) targets.push(androidExport);
  for (const target of additionalTargets) {
    if (!targets.includes(target)) targets.push(target);
  }
  for (const candidate of [
    path.join(root, 'relay-server', 'data'),
    path.join(root, 'relay-server', 'relay.db'),
    path.join(root, 'relay-server', 'agent-chat.db'),
  ]) {
    if (fs.existsSync(candidate)) targets.push(candidate);
  }
  const files = [];
  targets.forEach(target => collectFiles(target, files));
  const secrets = localSensitiveValues();
  const exactMatches = [];
  const patternMatches = [];
  let scannedBytes = 0;
  for (const file of files) {
    const content = fs.readFileSync(file);
    scannedBytes += content.length;
    for (const secret of secrets) {
      if (content.includes(Buffer.from(secret.value))) {
        exactMatches.push({ file: path.relative(root, file), kind: secret.kind });
      }
    }
    if (!/\.(?:json|jsonl|txt|log|js|html|css|md)$/i.test(file)) continue;
    const text = content.toString('utf8');
    if (/Bearer\s+[a-z0-9._~+\/-]{12,}|\bsk-[a-z0-9_-]{8,}|\beyJ[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}/i.test(text)) {
      patternMatches.push(path.relative(root, file));
    }
  }
  assert.deepStrictEqual(exactMatches, [], 'an exact local token/account/email appeared in a scanned artifact');
  assert.deepStrictEqual(patternMatches, [], 'a credential-shaped value appeared in a scanned text artifact');
  const result = {
    ok: true,
    generated_at: new Date().toISOString(),
    files_scanned: files.length,
    bytes_scanned: scannedBytes,
    local_sensitive_values_checked: secrets.length,
    exact_secret_matches: 0,
    credential_pattern_matches: 0,
    android_export_scanned: !!androidExport,
    additional_targets_scanned: additionalTargets.map(target => path.relative(root, target)),
    targets: targets.map(target => path.relative(root, target)),
  };
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, serialized, 'utf8');
  }
  process.stdout.write(serialized);
}

try {
  main();
} catch (error) {
  console.error(`provider usage secret scan: FAIL (${error.message || error})`);
  process.exit(1);
}
