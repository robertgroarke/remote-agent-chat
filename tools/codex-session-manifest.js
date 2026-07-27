#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { atomicReplaceText } = require('../shared/codex-live-owner-registry');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_MANIFEST = path.join(ROOT, 'data', 'codex-session-manifest.json');
const MANIFEST_SCHEMA_VERSION = 1;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function codexHome(env = process.env) {
  return path.resolve(env.CODEX_HOME || path.join(os.homedir(), '.codex'));
}

function atomicWriteJson(filePath, value, options = {}) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  return atomicReplaceText(filePath, serialized, options, candidate => JSON.parse(candidate));
}

function validateManifest(manifest) {
  if (!manifest || manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    throw new Error(`Unsupported Codex session manifest schema: ${manifest?.schemaVersion ?? 'missing'}`);
  }
  if (!manifest.sessions || typeof manifest.sessions !== 'object' || Array.isArray(manifest.sessions)) {
    throw new Error('Codex session manifest must contain a sessions object');
  }
  if (manifest.rotation?.autoStart === true) {
    throw new Error('Codex session autoStart is forbidden; managed sessions are operator-started and parked');
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
    if (entry.autoStart === true) {
      throw new Error(`autoStart is forbidden for ${logicalName}`);
    }
    if (entry.resumeConfigOverride != null) {
      const override = entry.resumeConfigOverride;
      if (override?.explicit !== true || (!String(override.model || '').trim() && !String(override.effort || '').trim())) {
        throw new Error(`resumeConfigOverride must be an explicit persisted choice for ${logicalName}`);
      }
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
  const records = parseJsonlPrefix(filePath, 8 * 1024 * 1024);
  const meta = records.find(record => record?.type === 'session_meta')?.payload || {};
  const configs = records
    .filter(record => record?.type === 'turn_context')
    .map(record => normalizeCodexConfig({
      model: record.payload?.model || record.payload?.model_id,
      effort: record.payload?.effort || record.payload?.model_reasoning_effort,
    }))
    .filter(config => config.model || config.effort);
  const metaConfig = normalizeCodexConfig({
    model: meta.model || meta.model_id,
    effort: meta.effort || meta.model_reasoning_effort,
  });
  if ((metaConfig.model || metaConfig.effort) && !configs.length) configs.push(metaConfig);
  return {
    sessionId: meta.id || meta.session_id || null,
    createdAt: meta.timestamp || null,
    cwd: meta.cwd || null,
    originator: meta.originator || null,
    cliVersion: meta.cli_version || null,
    recordedConfig: configs[0] || { model: null, effort: null },
    observedConfig: configs[configs.length - 1] || metaConfig,
  };
}

function persistResumeConfigOverride(sessionId, patch, options = {}) {
  if (!UUID_RE.test(String(sessionId || ''))) throw new Error('A canonical Codex session UUID is required');
  const manifestPath = path.resolve(options.manifestPath || DEFAULT_MANIFEST);
  const manifest = loadManifest(manifestPath);
  const match = Object.entries(manifest.sessions).find(([, entry]) => entry.sessionId === sessionId);
  if (!match && options.allowUnmanaged === true) return null;
  if (!match) throw new Error(`No managed Codex session owns ${sessionId}`);
  const [logicalName, entry] = match;
  const current = entry.resumeConfigOverride?.explicit === true ? entry.resumeConfigOverride : {};
  const next = normalizeCodexConfig({
    model: patch?.model === undefined ? current.model : patch.model,
    effort: patch?.effort === undefined ? current.effort : patch.effort,
  });
  if (!next.model && !next.effort) throw new Error('An explicit model or effort choice is required');
  manifest.sessions[logicalName] = {
    ...entry,
    resumeConfigOverride: {
      ...next,
      explicit: true,
      chosen_at: new Date(Number(options.nowMs) || Date.now()).toISOString(),
      chosen_by: String(options.chosenBy || 'rac_operator_control'),
    },
  };
  manifest.updatedAt = new Date(Number(options.nowMs) || Date.now()).toISOString();
  validateManifest(manifest);
  atomicWriteJson(manifestPath, manifest);
  return { logicalName, entry: manifest.sessions[logicalName], manifestPath };
}

function normalizeCodexConfig(value) {
  const model = String(value?.model || '').trim() || null;
  const effort = String(value?.effort || '').trim().toLowerCase() || null;
  return { model, effort };
}

function parseCodexConfigArgs(args = []) {
  const config = { model: null, effort: null };
  for (let index = 0; index < args.length; index += 1) {
    if ((args[index] === '-c' || args[index] === '--config') && args[index + 1]) {
      const value = String(args[++index]);
      const model = value.match(/^model\s*=\s*["']?([^"']+?)["']?$/i)?.[1]?.trim();
      const effort = value.match(/^model_reasoning_effort\s*=\s*["']?([^"']+?)["']?$/i)?.[1]?.trim();
      if (model) config.model = model;
      if (effort) config.effort = effort.toLowerCase();
    }
  }
  return config;
}

function stripCodexConfigArgs(args = []) {
  const result = [];
  for (let index = 0; index < args.length; index += 1) {
    if ((args[index] === '-c' || args[index] === '--config') && args[index + 1]
        && /^(?:model|model_reasoning_effort)\s*=/i.test(String(args[index + 1]))) {
      index += 1;
      continue;
    }
    result.push(args[index]);
  }
  return result;
}

function codexConfigArgs(config) {
  const normalized = normalizeCodexConfig(config);
  return [
    ...(normalized.model ? ['-c', `model=${JSON.stringify(normalized.model)}`] : []),
    ...(normalized.effort ? ['-c', `model_reasoning_effort=${JSON.stringify(normalized.effort)}`] : []),
  ];
}

function resolveResumeConfig(entry, rolloutPath = entry?.rolloutPath) {
  const metadata = rolloutPath && fs.existsSync(rolloutPath) ? rolloutMetadata(rolloutPath) : {};
  const recorded = normalizeCodexConfig(metadata.recordedConfig || entry?.recordedConfig);
  const observed = normalizeCodexConfig(metadata.observedConfig || entry?.observedConfig);
  const requested = normalizeCodexConfig(entry?.requestedConfig || parseCodexConfigArgs(entry?.codexGlobalArgs));
  const explicit = entry?.resumeConfigOverride?.explicit === true
    ? normalizeCodexConfig(entry.resumeConfigOverride)
    : { model: null, effort: null };
  const selected = {
    model: explicit.model || recorded.model || null,
    effort: explicit.effort || recorded.effort || null,
  };
  return {
    recorded,
    requested,
    observed,
    selected,
    source: explicit.model || explicit.effort ? 'explicit_operator_override' : 'recorded_rollout',
    explicit: Boolean(explicit.model || explicit.effort),
  };
}

function resumeGlobalArgs(entry, rolloutPath = entry?.rolloutPath) {
  const config = resolveResumeConfig(entry, rolloutPath);
  return [...stripCodexConfigArgs(entry?.codexGlobalArgs || []), ...codexConfigArgs(config.selected)];
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
  codexConfigArgs,
  cleanGoalPrompt,
  codexHome,
  extractGoalPromptFromRollout,
  findRolloutPath,
  formatDigest,
  isScaffoldingPrompt,
  loadManifest,
  main,
  parseJsonlPrefix,
  parseCodexConfigArgs,
  resolveResumeConfig,
  resumeGlobalArgs,
  resolveSession,
  persistResumeConfigOverride,
  responseItemUserText,
  rolloutMetadata,
  stripCodexConfigArgs,
  validateManifest,
  walkJsonlFiles,
};
