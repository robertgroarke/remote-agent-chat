'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-claude-poll-cache-'));
process.env.SESSION_STORE_PATH = path.join(tempRoot, 'session-store.json');

const transcriptPath = path.join(tempRoot, 'claude.jsonl');
fs.writeFileSync(transcriptPath, '{"fixture":1}\n');
const claudeCli = require('../agent-proxy/claude-cli');
const originalRead = claudeCli.readSessionSummary;

(async () => {
  try {
    let reads = 0;
    claudeCli.readSessionSummary = filePath => {
      reads += 1;
      return {
        filePath,
        messages: [{ role: 'assistant', content: `read-${reads}` }],
        sourceCursor: { generation: 'fixture', message_index: reads - 1, file_size: fs.statSync(filePath).size },
      };
    };
    const { ProxyEngine } = require('../agent-proxy/proxy-engine');
    const engine = new ProxyEngine({
      cdpPorts: [],
      relayUrl: 'ws://127.0.0.1:1/proxy-ws',
      uploadDir: path.join(tempRoot, 'uploads'),
    });
    const statusFrames = [];
    engine._sendToRelay = frame => { statusFrames.push(frame); return true; };
    engine._sendFileBackedTranscriptUpdate = () => {};
    engine._handleSessionErrorPromptState = async () => {};
    const session = {
      session_id: 'claude-cli-cache-fixture',
      agentType: 'claude_cli',
      claudeCliFilePath: transcriptPath,
      lastTranscriptSig: '',
      status: 'healthy',
      activity: { kind: 'idle', label: '' },
      _claudeCliChild: null,
    };

    await engine._pollSessionClaudeCli(session.session_id, session);
    await engine._pollSessionClaudeCli(session.session_id, session);
    assert.equal(reads, 1, 'unchanged Claude archive must not be reparsed every poll');

    fs.appendFileSync(transcriptPath, '{"fixture":2}\n');
    await engine._pollSessionClaudeCli(session.session_id, session);
    assert.equal(reads, 2, 'a changed Claude archive must invalidate the stat cache');

    session._claudeCliChild = {};
    session.activity = {
      kind: 'generating',
      label: 'Claude CLI running',
      updated_at: '2026-07-01T00:00:00.000Z',
    };
    const heartbeatFramesBefore = statusFrames.length;
    await engine._pollSessionClaudeCli(session.session_id, session);
    await engine._pollSessionClaudeCli(session.session_id, session);
    assert.equal(statusFrames.length, heartbeatFramesBefore + 1,
      'Claude CLI live-child observations were not coalesced to one bounded heartbeat');
    assert.ok(session.activity.observed_at, 'Claude CLI producer heartbeat omitted observed_at');

    console.log(JSON.stringify({
      ok: true,
      unchanged_polls: 2,
      archive_parses_before_change: 1,
      changed_archive_reparsed: true,
      live_child_heartbeat_bounded: true,
    }, null, 2));
  } finally {
    claudeCli.readSessionSummary = originalRead;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
