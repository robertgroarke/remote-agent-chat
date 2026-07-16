#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const CDP = require('../agent-proxy/node_modules/chrome-remote-interface');
const selectors = require('../agent-proxy/selectors');

const args = process.argv.slice(2);
const portIndex = args.indexOf('--port');
const outputIndex = args.indexOf('--output');
const port = portIndex >= 0 ? Number(args[portIndex + 1]) : 9230;
const outputPath = outputIndex >= 0 && args[outputIndex + 1]
  ? path.resolve(args[outputIndex + 1]) : '';
assert.strictEqual(port, 9230, 'Passive disposable Codex diagnostic is restricted to port 9230');

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16);
}

function isCodexFrame(target) {
  return target?.type === 'iframe'
    && /[?&]extensionId=openai\.chatgpt(?:&|$)/i.test(String(target.url || ''));
}

async function main() {
  const targets = (await CDP.List({ port })).filter(isCodexFrame);
  assert(targets.length > 0, 'No disposable Codex iframe found');
  const frames = [];
  for (const target of targets) {
    let client;
    try {
      client = await CDP({ port, target: target.id });
      await client.Runtime.enable();
      client.Runtime._webviewId = (String(target.url || '').match(/[?&]id=([0-9a-f-]+)/i) || [])[1] || '';
      await selectors.cacheInnerContextId(client.Runtime);
      const raw = await selectors.evalInFrame(client.Runtime, `
        function visible(el) {
          if (!el || !el.getBoundingClientRect) return false;
          var rect = el.getBoundingClientRect();
          var style = window.getComputedStyle ? window.getComputedStyle(el) : null;
          return rect.width > 0 && rect.height > 0 && (!style || (
            style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0'
          ));
        }
        function bounded(value, limit) {
          return String(value || '').replace(/\\s+/g, ' ').trim().slice(0, limit || 160);
        }
        var nodes = Array.from(d.querySelectorAll('button, a, h1, h2, h3, [role="alert"], [role="status"]'))
          .filter(visible).slice(0, 40);
        return JSON.stringify({
          ready_state: d.readyState,
          title: bounded(d.title, 160),
          body_present: !!d.body,
          composer_count: Array.from(d.querySelectorAll('.ProseMirror')).filter(visible).length,
          conversation_root_count: d.querySelectorAll('[data-thread-find-target="conversation"], [data-testid*="conversation"]').length,
          shell_nodes: nodes.map(function(node, ordinal) {
            return {
              ordinal: ordinal,
              tag: bounded(node.tagName, 20).toLowerCase(),
              role: bounded(node.getAttribute('role'), 40),
              test_id: bounded(node.getAttribute('data-testid'), 120),
              aria_label: bounded(node.getAttribute('aria-label'), 160),
              disabled: !!node.disabled || node.getAttribute('aria-disabled') === 'true',
              text: bounded(node.innerText || node.textContent, 160)
            };
          })
        });
      `);
      frames.push({ target_hash: hash(target.id), ...(raw ? JSON.parse(raw) : {}) });
    } finally {
      await client?.close().catch(() => {});
    }
  }
  const result = {
    ok: true,
    generated_at: new Date().toISOString(),
    port,
    frame_count: frames.length,
    frames,
    read_only: true,
    transcript_content_captured: false,
    clicks: 0,
    sends: 0,
    controls: 0,
    page_reloads: 0,
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

main().catch(error => {
  console.error(`VS Code Codex passive surface diagnostic: FAIL (${error.stack || error.message})`);
  process.exit(1);
});
