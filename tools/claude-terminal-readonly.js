#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const CDP = require(path.join(__dirname, '..', 'agent-proxy', 'node_modules', 'chrome-remote-interface'));
const selectors = require('../agent-proxy/selectors');
const guard = require('../agent-proxy/vscode-probe-guard');

async function main() {
  const args = process.argv.slice(2);
  assert(args.includes('--read-only'), 'Explicit --read-only is required');
  const outputIndex = args.indexOf('--output');
  const outputPath = outputIndex >= 0 && args[outputIndex + 1]
    ? path.resolve(args[outputIndex + 1])
    : null;
  assert(args.every((arg, index) => arg === '--read-only' || arg === '--output' || index === outputIndex + 1), 'Unknown argument');
  guard.assertUpdatesDisabled('Claude terminal read-only probe');
  assert.strictEqual(guard.CDP_PORT, 9230, 'Probe is restricted to disposable CDP port 9230');

  const targets = await CDP.List({ port: guard.CDP_PORT });
  const allWorkbenchPages = targets.filter(target => target?.type === 'page'
    && /workbench\.html/i.test(String(target.url || '')));
  const workbenchPages = targets.filter(guard.isThrowawayWorkbench);
  const frames = targets.filter(target => guard.isThrowawayIframe(target, 'claude'));
  assert(frames.length > 0, 'Disposable Claude iframe not found');
  const store = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'agent-proxy', 'session-store.json'), 'utf8'));
  const stored = Object.values(store.sessions || {}).filter(session =>
    guard.isThrowawaySession(session, 'claude')
      && Number(session.cdp_port) === guard.CDP_PORT
      && session.status === 'healthy'
      && frames.some(frame => frame.id === session.target_id)
  );
  assert(stored.length > 0, 'Expected at least one healthy durable Claude frame binding');

  const inspected = [];
  for (const session of stored) {
    const frame = frames.find(target => target.id === session.target_id);
    const client = await CDP({ port: guard.CDP_PORT, target: frame.id });
    try {
      await client.Runtime.enable();
      client.Runtime._webviewId = (String(frame.url || '').match(/[?&]id=([0-9a-f-]+)/i) || [])[1] || '';
      await selectors.cacheInnerContextId(client.Runtime);
      const messages = JSON.parse(await selectors.readMessages(client.Runtime, 'claude', session.session_id) || '[]');
      const terminalBlocks = messages.flatMap(message => Array.isArray(message.content_blocks)
        ? message.content_blocks.filter(block => block?.type === 'terminal')
        : []);
      const owned = terminalBlocks.filter(block => /^RAC_CLAUDE_PERMISSION_[0-9a-f]{8}$/i.test(String(block.stdout || '').trim()));
      inspected.push({ session, frame, messages, terminalBlocks, owned });
    } finally {
      await client.close();
    }
  }
  const matches = inspected.filter(row => row.owned.length > 0);
  assert.strictEqual(matches.length, 1, `Expected one disposable Claude transcript with a completed owned marker, found ${matches.length}`);
  const { session, frame, messages, terminalBlocks, owned } = matches[0];
  {
    const blockTypeCounts = {};
    const latestBlockMessageIndex = {};
    messages.forEach((message, messageIndex) => {
      for (const block of Array.isArray(message.content_blocks) ? message.content_blocks : []) {
        const type = String(block?.type || '').trim();
        if (!type) continue;
        blockTypeCounts[type] = (blockTypeCounts[type] || 0) + 1;
        latestBlockMessageIndex[type] = messageIndex;
      }
    });
    for (const block of owned) {
      const marker = String(block.stdout).trim();
      assert(String(block.command || '').includes(marker), 'Owned terminal command does not contain its exact output marker');
      assert.equal(block.status, 'completed');
      assert.match(String(block.content || ''), /\nOUT\n/);
      assert.equal(block.collapsed, false);
    }

    const result = {
      ok: true,
      generated_at: new Date().toISOString(),
      read_only: true,
      cdp_port: guard.CDP_PORT,
      disposable_workbench_pages: allWorkbenchPages.length,
      matching_primary_workbench_pages: workbenchPages.length,
      disposable_claude_frames: frames.length,
      healthy_claude_frame_bindings: stored.length,
      session_id: session.session_id,
      target_id: frame.id,
      messages: messages.length,
      block_type_counts: blockTypeCounts,
      latest_block_message_index: latestBlockMessageIndex,
      terminal_blocks: terminalBlocks.length,
      owned_completed_terminal_blocks: owned.length,
      owned_markers: owned.map(block => String(block.stdout).trim()),
      sends: 0,
      controls: 0,
      focus_actions: 0,
      visible_windows_opened: 0,
    };
    const serialized = `${JSON.stringify(result, null, 2)}\n`;
    if (outputPath) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, serialized, 'utf8');
    }
    process.stdout.write(serialized);
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
