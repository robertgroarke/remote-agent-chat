#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const CDP = require(path.join(__dirname, '..', 'agent-proxy', 'node_modules', 'chrome-remote-interface'));
const selectors = require('../agent-proxy/selectors');
const guard = require('../agent-proxy/vscode-probe-guard');

async function main() {
  assert.deepStrictEqual(process.argv.slice(2), ['--read-only'], 'Explicit --read-only is required');
  guard.assertUpdatesDisabled('Claude Markdown block read-only probe');
  assert.strictEqual(guard.CDP_PORT, 9230, 'Probe is restricted to disposable CDP port 9230');

  const targets = await CDP.List({ port: guard.CDP_PORT });
  const frames = targets.filter(target => guard.isThrowawayIframe(target, 'claude'));
  assert(frames.length > 0, 'Disposable Claude iframe not found');
  const store = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'agent-proxy', 'session-store.json'), 'utf8'));
  const stored = Object.values(store.sessions || {}).filter(session =>
    guard.isThrowawaySession(session, 'claude')
      && Number(session.cdp_port) === guard.CDP_PORT
      && session.status === 'healthy'
      && frames.some(frame => frame.id === session.target_id)
  );
  assert.strictEqual(stored.length, 1, `Expected one healthy durable Claude frame binding, found ${stored.length}`);
  const frame = frames.find(target => target.id === stored[0].target_id);
  assert(frame, `Healthy Claude target is not live: ${stored[0].target_id}`);

  const client = await CDP({ port: guard.CDP_PORT, target: frame.id });
  try {
    await client.Runtime.enable();
    client.Runtime._webviewId = (String(frame.url || '').match(/[?&]id=([0-9a-f-]+)/i) || [])[1] || '';
    await selectors.cacheInnerContextId(client.Runtime);
    const raw = await selectors.readMessages(client.Runtime, 'claude', stored[0].session_id);
    const messages = JSON.parse(raw || '[]');
    const assistantRows = messages.filter(message =>
      message?.role === 'assistant'
        && typeof message.content === 'string'
        && message.content.trim()
    );
    const untyped = assistantRows.filter(message =>
      !Array.isArray(message.content_blocks) || message.content_blocks.length === 0
    );
    const markdownRows = assistantRows.filter(message =>
      message.content_blocks.some(block => block?.type === 'markdown')
    );

    assert(assistantRows.length > 0, 'Disposable Claude transcript has no non-empty assistant row to inspect');
    assert.strictEqual(untyped.length, 0, `Found ${untyped.length} non-empty untyped Claude assistant rows`);
    assert(markdownRows.length > 0, 'Disposable Claude transcript has no canonical Markdown assistant row');

    console.log(JSON.stringify({
      ok: true,
      generated_at: new Date().toISOString(),
      read_only: true,
      cdp_port: guard.CDP_PORT,
      session_id: stored[0].session_id,
      target_id: frame.id,
      messages: messages.length,
      nonempty_assistant_rows: assistantRows.length,
      typed_assistant_rows: assistantRows.length - untyped.length,
      markdown_assistant_rows: markdownRows.length,
      sends: 0,
      controls: 0,
      focus_actions: 0,
      visible_windows_opened: 0,
    }, null, 2));
  } finally {
    await client.close();
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
