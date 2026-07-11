#!/usr/bin/env node
'use strict';
// Passive guarded screenshot of the throwaway Cursor window.
const fs = require('fs');
const path = require('path');
const CDP = require(path.join(__dirname, '..', 'agent-proxy', 'node_modules', 'chrome-remote-interface'));
const guard = require(path.join(__dirname, '..', 'agent-proxy', 'cursor-probe-guard'));
const cursorSel = require(path.join(__dirname, '..', 'agent-proxy', 'cursor-selectors'));

async function main() {
  const output = process.argv[2];
  const expectedAgentId = process.argv[3] || '';
  if (!output) throw new Error('Usage: node tools/cursor-native-screenshot.js <output.png> [expected-agent-id]');
  const targets = await CDP.List({ port: 9227 });
  const { page, blocked } = guard.pickProbePage(targets);
  if (blocked || !page) throw new Error(blocked || 'no throwaway Cursor page');
  guard.assertProbeTarget(page, __filename);

  const client = await CDP({ port: 9227, target: page.id });
  try {
    await client.Runtime.enable();
    await client.Page.enable();
    let native;
    if (expectedAgentId) {
      const agents = await cursorSel.readCursorAgentList(client.Runtime);
      const active = agents.filter(agent => agent && agent.active);
      if (active.length !== 1 || active[0].id !== expectedAgentId) {
        throw new Error(`Native Cursor active agent mismatch: ${JSON.stringify(active)}`);
      }
      native = { activeAgentId: active[0].id, activeAgentTitle: active[0].title };
    } else {
      const state = await client.Runtime.evaluate({
        returnByValue: true,
        expression: `(() => {
        const norm = value => String(value || '').replace(/\\s+/g, ' ').trim();
        const groups = Array.from(document.querySelectorAll('.editor-group-container.has-composer-editor'));
        const blank = groups.filter(group => {
          const tab = group.querySelector('.tabs-container .tab.active.selected, .tabs-container .tab[aria-selected="true"], .tabs-container .tab.selected, .tabs-container .tab.active');
          return tab && norm((tab.querySelector('.label-name') || tab).textContent || '') === 'New Agent';
        });
        return {
          blankGroups: blank.length,
          messages: blank.length === 1 ? blank[0].querySelectorAll('.composer-rendered-message').length : -1,
          hasInput: blank.length === 1 && !!blank[0].querySelector('.ui-prompt-input-editor__input[contenteditable="true"], .tiptap.ProseMirror[contenteditable="true"], .aislash-editor-input[contenteditable="true"]'),
        };
      })()`,
      });
      native = state.result.value;
      if (native.blankGroups !== 1 || native.messages !== 0 || !native.hasInput) {
        throw new Error(`Native Cursor is not a unique empty New Agent editor: ${JSON.stringify(native)}`);
      }
    }
    const shot = await client.Page.captureScreenshot({ format: 'png', fromSurface: true, captureBeyondViewport: false });
    fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
    fs.writeFileSync(output, Buffer.from(shot.data, 'base64'));
    console.log(JSON.stringify({ output: path.resolve(output), target: page.id.slice(0, 8), ...native }));
  } finally {
    await client.close();
  }
}

main().catch(err => {
  console.error('FAIL', err.message);
  process.exit(1);
});
