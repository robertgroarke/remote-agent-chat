#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const claudeCli = require('../agent-proxy/claude-cli');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-claude-watch-'));
  const project = path.join(root, 'C--remote-agent-chat');
  fs.mkdirSync(project, { recursive: true });
  const transcript = path.join(project, '11111111-1111-4111-8111-111111111111.jsonl');
  let watcher;
  try {
    let resolveSummary;
    const observed = new Promise(resolve => { resolveSummary = resolve; });
    watcher = claudeCli.watchSessions(summary => resolveSummary({ summary, receivedAt: Date.now() }), {
      rootDir: root,
      debounceMs: 20,
      onError: error => { throw error; },
    });
    assert(watcher, 'Claude CLI chokidar watcher did not start');
    await new Promise(resolve => setTimeout(resolve, 150));
    const appendAt = Date.now();
    fs.writeFileSync(transcript, JSON.stringify({
      type: 'assistant',
      sessionId: '11111111-1111-4111-8111-111111111111',
      cwd: 'C:\\remote-agent-chat',
      message: { role: 'assistant', content: [{ type: 'text', text: 'watch latency fixture' }] },
      timestamp: new Date().toISOString(),
    }) + '\n');
    const event = await Promise.race([
      observed,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Claude CLI watcher timed out')), 3000)),
    ]);
    const latency = event.receivedAt - appendAt;
    assert(latency < 500, `Claude CLI watcher latency ${latency}ms exceeds 500ms`);
    assert.equal(event.summary.cliSessionId, '11111111-1111-4111-8111-111111111111');
    const result = {
      ok: true,
      claude_cli_append_to_summary_ms: latency,
      configured_debounce_ms: 20,
      production_default_debounce_ms: 120,
      await_write_finish: false,
      codex_cli_default_debounce_ms: 120,
      cursor_cli_default_debounce_ms: 120,
    };
    const serialized = JSON.stringify(result, null, 2) + '\n';
    const outputIndex = process.argv.indexOf('--output');
    if (outputIndex >= 0 && process.argv[outputIndex + 1]) {
      const outputPath = path.resolve(process.argv[outputIndex + 1]);
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, serialized);
    }
    process.stdout.write(serialized);
  } finally {
    if (watcher) await watcher.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
