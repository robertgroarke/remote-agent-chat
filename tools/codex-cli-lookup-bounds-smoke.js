'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-codex-lookup-'));
const priorUserProfile = process.env.USERPROFILE;
const priorHome = process.env.HOME;
const priorMetadataFallbackMaxFiles = process.env.CODEX_CLI_METADATA_FALLBACK_MAX_FILES;
process.env.USERPROFILE = fixtureRoot;
process.env.HOME = fixtureRoot;
process.env.CODEX_CLI_METADATA_FALLBACK_MAX_FILES = '80';

const sessionsRoot = path.join(fixtureRoot, '.codex', 'sessions', '2026', '07', '18');
fs.mkdirSync(sessionsRoot, { recursive: true });
const targetId = '00000000-0000-4000-8000-000000000123';
const legacyPath = path.join(sessionsRoot, 'rollout-legacy-name.jsonl');
fs.writeFileSync(legacyPath, [
  JSON.stringify({ type: 'session_meta', payload: { id: targetId, cwd: fixtureRoot } }),
  JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Legacy lookup' }] } }),
  JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Found' }] } }),
].join('\n') + '\n', 'utf8');

for (let index = 0; index < 96; index++) {
  const decoyPath = path.join(sessionsRoot, `rollout-legacy-decoy-${String(index).padStart(3, '0')}.jsonl`);
  const rows = [];
  for (let row = 0; row < 80; row++) {
    rows.push(JSON.stringify({
      type: row === 0 ? 'session_meta' : 'event_msg',
      payload: row === 0
        ? { id: `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`, cwd: fixtureRoot }
        : { type: 'token_count', row },
    }));
  }
  fs.writeFileSync(decoyPath, `${rows.join('\n')}\n`, 'utf8');
  fs.truncateSync(decoyPath, 2 * 1024 * 1024);
  const older = new Date(Date.now() - (index + 1) * 1000);
  fs.utimesSync(decoyPath, older, older);
}

const codexCli = require('../agent-proxy/codex-cli');
const originalReadSync = fs.readSync;
let bytesRead = 0;
fs.readSync = function countedReadSync(...args) {
  const read = originalReadSync.apply(this, args);
  bytesRead += Math.max(0, Number(read) || 0);
  return read;
};

try {
  const legacy = codexCli.findSessionByCliId(targetId);
  assert(legacy, 'legacy metadata fallback should find a renamed rollout');
  assert.strictEqual(legacy.cliSessionId, targetId);
  assert(legacy.messages.some(message => message.role === 'assistant' && message.content === 'Found'));

  bytesRead = 0;
  const missing = codexCli.findSessionByCliId('ffffffff-ffff-4fff-8fff-ffffffffffff');
  assert.strictEqual(missing, null, 'missing lookup must fail closed');
  assert(bytesRead <= 81 * 1024 * 1024,
    `metadata miss exceeded its 80-file probe bound (${bytesRead} bytes)`);

  console.log(JSON.stringify({
    ok: true,
    legacy_fallback_hydrated: true,
    missing_result: null,
    metadata_fallback_limit: 80,
    missing_lookup_bytes_read: bytesRead,
  }, null, 2));
} finally {
  fs.readSync = originalReadSync;
  if (priorUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = priorUserProfile;
  if (priorHome === undefined) delete process.env.HOME;
  else process.env.HOME = priorHome;
  if (priorMetadataFallbackMaxFiles === undefined) delete process.env.CODEX_CLI_METADATA_FALLBACK_MAX_FILES;
  else process.env.CODEX_CLI_METADATA_FALLBACK_MAX_FILES = priorMetadataFallbackMaxFiles;
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}
