#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const production = require('./vscode-extension-production-e2e');
const {
  nativeState,
  openNative,
  requestConfig,
} = require('./codex-desktop-owned-controls-e2e');
const { freshEvidencePath } = require('./evidence-path');

const ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const options = {
    output: freshEvidencePath(ROOT, 'codex-desktop-restart-preflight.json'),
    ownedThreadId: '',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--owned-thread-id' && argv[index + 1]) options.ownedThreadId = argv[++index];
    else if (arg === '--output' && argv[index + 1]) options.output = path.resolve(argv[++index]);
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  if (!options.ownedThreadId) throw new Error('--owned-thread-id is required');
  return options;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  let native;
  let relay;
  try {
    native = await openNative();
    relay = await production.openRelay();
    const session = await production.waitFor(
      () => production.latestSessions(relay.messages).find(item =>
        item.agent_type === 'codex-desktop' && item.status !== 'disconnected'),
      30000,
      'connected Codex Desktop relay session',
    );
    const sessionId = session.session_id;
    let state = await nativeState(native, sessionId);
    assert.strictEqual(state.thinking?.thinking, false, 'Codex Desktop is active; refusing restart preflight');
    if (state.active?.id !== options.ownedThreadId) {
      await production.control(relay.ws, relay.messages, sessionId, 'switch_thread', {
        thread_id: options.ownedThreadId,
      });
      state = await production.waitFor(async () => {
        const current = await nativeState(native, sessionId);
        return current.active?.id === options.ownedThreadId && !current.thinking?.thinking ? current : null;
      }, 30000, 'owned Codex Desktop restart thread', 100);
    }
    assert.strictEqual(state.active?.id, options.ownedThreadId, 'exact owned thread was not selected');
    assert.strictEqual(state.thinking?.thinking, false, 'owned Codex Desktop thread is not idle');
    const ownershipMarkers = state.messages.filter(message =>
      /RAC_CODEX_DESKTOP_(?:OWNED|INTERRUPT)/.test(String(message.content || '')));
    assert(ownershipMarkers.length >= 1, 'owned thread lacks the RAC ownership marker');

    const config = await requestConfig(relay, sessionId);
    for (const capability of ['new_thread', 'thread_list', 'switch_thread', 'interrupt']) {
      assert.strictEqual(config.capabilities?.[capability], true, `missing ${capability} capability`);
    }
    const generatedAt = new Date();
    const result = {
      schema_version: 1,
      kind: 'codex-desktop-invisible-restart-preflight',
      owned: true,
      idle: true,
      generated_at: generatedAt.toISOString(),
      expires_at: new Date(generatedAt.getTime() + 120000).toISOString(),
      cdp_port: 9225,
      session_id: sessionId,
      thread_id: state.active.id,
      thread_title: state.active.title || '',
      message_count: state.messages.length,
      ownership_marker_count: ownershipMarkers.length,
      focus_actions: 0,
      visible_windows_opened: 0,
      app_restarted: false,
      capabilities: {
        new_thread: true,
        thread_list: true,
        switch_thread: true,
        interrupt: true,
      },
    };
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(result, null, 2));
    return result;
  } finally {
    try { relay?.ws?.close(); } catch {}
    try { await native?.client?.close(); } catch {}
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = { main, parseArgs };
