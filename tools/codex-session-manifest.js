#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_MANIFEST = path.join(ROOT, 'data', 'codex-session-manifest.json');
const MANIFEST_SCHEMA_VERSION = 1;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function codexHome(env = process.env) {
  return path.resolve(env.CODEX_HOME || path.join(os.homedir(), '.codex'));
}

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, filePath);
}

function validateManifest(manifest) {
  if (!manifest || manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    throw new Error(`Unsupported Codex session manifest schema: ${manifest?.schemaVersion ?? 'missing'}`);
  }
  if (!manifest.sessions || typeof manifest.sessions !== 'object' || Array.isArray(manifest.sessions)) {
    throw new Error('Codex session manifest must contain a sessions object');
  }
  for (const [logicalName, entry] of Object.entries(manifest.sessions)) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(logicalName)) {
      throw new Error(`Invalid logical session name: ${logicalName}`);
    }
    if (!entry || !UUID_RE.test(String(entry.sessionId || ''))) {
      throw new Error(`Invalid sessionId for ${logicalName}: ${entry?.sessionId || 'missing'}`);
    }
    if (!entry.cwd || !path.isAbsolute(entry.cwd)) {
      throw new Error(`Invalid cwd for ${logicalName}: ${entry?.cwd || 'missing'}`);
    }
    if (!String(entry.goalPrompt || '').trim()) {
      throw new Error(`Missing standing goal prompt for ${logicalName}`);
    }
    if (entry.codexGlobalArgs != null && !Array.isArray(entry.codexGlobalArgs)) {
      throw new Error(`codexGlobalArgs must be an array for ${logicalName}`);
    }
  }
  return manifest;
}

function loadManifest(manifestPath = DEFAULT_MANIFEST) {
  const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  return validateManifest(parsed);
}

function resolveSession(manifest, logicalName) {
  const entry = manifest.sessions[logicalName];
  if (!entry) throw new Error(`Unknown logical Codex session: ${logicalName}`);
  return entry;
}

function walkJsonlFiles(rootPath) {
  if (!fs.existsSync(rootPath)) return [];
  const files = [];
  const pending = [rootPath];
  while (pending.length) {
    const current = pending.pop();
    for (const item of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, item.name);
      if (item.isDirectory()) pending.push(absolute);
      else if (item.isFile() && item.name.endsWith('.jsonl')) files.push(absolute);
    }
  }
  return files;
}

function findRolloutPath(sessionId, home = codexHome(), options = {}) {
  if (!UUID_RE.test(String(sessionId || ''))) return null;
  const roots = [path.join(home, 'sessions')];
  if (options.includeArchived) roots.push(path.join(home, 'archived_sessions'));
  for (const rootPath of roots) {
    const match = walkJsonlFiles(rootPath).find(filePath => path.basename(filePath).includes(sessionId));
    if (match) return match;
  }
  return null;
}

function readPrefix(filePath, maxBytes = 8 * 1024 * 1024) {
  const handle = fs.openSync(filePath, 'r');
  try {
    const size = Math.min(fs.fstatSync(handle).size, maxBytes);
    const buffer = Buffer.allocUnsafe(size);
    const bytesRead = fs.readSync(handle, buffer, 0, size, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    fs.closeSync(handle);
  }
}

function parseJsonlPrefix(filePath, maxBytes) {
  const records = [];
  const text = readPrefix(filePath, maxBytes);
  const lines = text.split(/\r?\n/);
  if (text && !text.endsWith('\n')) lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    try { records.push(JSON.parse(line)); } catch {}
  }
  return records;
}

function responseItemUserText(record) {
  if (record?.type !== 'response_item'
      || record?.payload?.type !== 'message'
      || record?.payload?.role !== 'user') return '';
  return (Array.isArray(record.payload.content) ? record.payload.content : [])
    .filter(block => block?.type === 'input_text' || block?.type === 'text')
    .map(block => block.text || '')
    .join('\n')
    .trim();
}

function isScaffoldingPrompt(value) {
  const text = String(value || '').trim();
  if (!text) return true;
  if (text.includes('## My request for Codex:')) return false;
  return text.startsWith('# AGENTS.md instructions for ')
    || text.startsWith('<recommended_plugins>')
    || text.startsWith('<environment_context>')
    || text.startsWith('<codex_internal_context source="goal">');
}

function cleanGoalPrompt(value) {
  let text = String(value || '').trim();
  const marker = '## My request for Codex:';
  const markerIndex = text.indexOf(marker);
  if (markerIndex >= 0) text = text.slice(markerIndex + marker.length).trim();
  text = text.replace(/^\/goal(?:\s+|$)/i, '').trim();
  return text;
}

function extractGoalPromptFromRollout(filePath) {
  const records = parseJsonlPrefix(filePath);
  for (let index = 0; index < records.length; index += 1) {
    const raw = responseItemUserText(records[index]);
    if (!raw || isScaffoldingPrompt(raw)) continue;
    const goalPrompt = cleanGoalPrompt(raw);
    if (goalPrompt) return { goalPrompt, recordIndex: index };
  }
  throw new Error(`Unable to extract a standing goal prompt from ${filePath}`);
}

function rolloutMetadata(filePath) {
  const records = parseJsonlPrefix(filePath, 2 * 1024 * 1024);
  const meta = records.find(record => record?.type === 'session_meta')?.payload || {};
  return {
    sessionId: meta.id || meta.session_id || null,
    createdAt: meta.timestamp || null,
    cwd: meta.cwd || null,
    originator: meta.originator || null,
    cliVersion: meta.cli_version || null,
  };
}

function formatDigest(manifest, options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const lines = [
    '# Codex session rotation digest',
    '',
    `Generated: ${generatedAt}`,
    `Manifest: ${options.manifestPath || DEFAULT_MANIFEST}`,
    '',
    '| Logical name | Current session | Profile | Last rotation | Eligibility |',
    '|---|---|---|---|---|',
  ];
  const plannedByName = new Map((options.planned || []).map(item => [item.logicalName, item]));
  for (const [logicalName, entry] of Object.entries(manifest.sessions).sort(([a], [b]) => a.localeCompare(b))) {
    const planned = plannedByName.get(logicalName);
    const eligibility = planned
      ? `${planned.eligible ? 'eligible' : 'held'}: \`${planned.eligibilityReason || 'unknown'}\``
      : 'not evaluated';
    lines.push(`| \`${logicalName}\` | \`${entry.sessionId}\` | ${entry.terminalProfile || entry.displayName || ''} | ${entry.lastRotatedAt || 'not yet'} | ${eligibility} |`);
  }
  if (options.usageState) {
    lines.push('', '## Usage gate', '',
      `- Status: \`${options.usageState.status || 'unknown'}\``,
      `- Reason: \`${options.usageState.reason || 'unknown'}\``,
      `- Reset credits available: ${Number(options.usageState.resetCreditsAvailable) || 0}`);
    if (options.usageState.attention?.message) lines.push(`- Attention: ${options.usageState.attention.message}`);
  }
  if (Array.isArray(options.rotations) && options.rotations.length) {
    lines.push('', '## Rotations in this scan', '');
    for (const item of options.rotations) {
      lines.push(`- \`${item.logicalName}\`: \`${item.oldSessionId}\` -> \`${item.newSessionId}\` (${item.status})`);
    }
  }
  lines.push('', 'Resolve a logical name at use time:', '', `\`node "${path.join(ROOT, 'tools', 'codex-session-manifest.js')}" resolve <logical-name>\``, '');
  return lines.join('\n');
}

function parseCli(argv) {
  const args = [...argv];
  let manifestPath = DEFAULT_MANIFEST;
  const manifestIndex = args.indexOf('--manifest');
  if (manifestIndex >= 0) {
    if (!args[manifestIndex + 1]) throw new Error('--manifest requires a path');
    manifestPath = path.resolve(args[manifestIndex + 1]);
    args.splice(manifestIndex, 2);
  }
  return { command: args.shift() || 'list', args, manifestPath };
}

function main(argv = process.argv.slice(2)) {
  const { command, args, manifestPath } = parseCli(argv);
  const manifest = loadManifest(manifestPath);
  if (command === 'resolve') {
    if (!args[0]) throw new Error('resolve requires a logical name');
    process.stdout.write(`${resolveSession(manifest, args[0]).sessionId}\n`);
    return;
  }
  if (command === 'show') {
    if (!args[0]) throw new Error('show requires a logical name');
    process.stdout.write(`${JSON.stringify(resolveSession(manifest, args[0]), null, 2)}\n`);
    return;
  }
  if (command === 'digest') {
    process.stdout.write(`${formatDigest(manifest, { manifestPath })}\n`);
    return;
  }
  if (command === 'validate') {
    process.stdout.write(`PASS ${Object.keys(manifest.sessions).length} Codex session manifest entries\n`);
    return;
  }
  if (command === 'list') {
    for (const [logicalName, entry] of Object.entries(manifest.sessions).sort(([a], [b]) => a.localeCompare(b))) {
      process.stdout.write(`${logicalName}\t${entry.sessionId}\t${entry.terminalProfile || ''}\n`);
    }
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  DEFAULT_MANIFEST,
  MANIFEST_SCHEMA_VERSION,
  UUID_RE,
  atomicWriteJson,
  cleanGoalPrompt,
  codexHome,
  extractGoalPromptFromRollout,
  findRolloutPath,
  formatDigest,
  isScaffoldingPrompt,
  loadManifest,
  main,
  parseJsonlPrefix,
  resolveSession,
  responseItemUserText,
  rolloutMetadata,
  validateManifest,
  walkJsonlFiles,
};
