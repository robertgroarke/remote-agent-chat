#!/usr/bin/env node
'use strict';

const assert = require('assert');
const CDP = require('../agent-proxy/node_modules/chrome-remote-interface');
const selectors = require('../agent-proxy/selectors');
const { withCodexDesktopCdpLock } = require('../agent-proxy/codex-desktop-cdp-lock');

const PORT = Number(process.env.CODEX_DESKTOP_CDP_PORT || 9225);
const TIMEOUT_MS = Number(process.env.CODEX_DESKTOP_THREAD_SMOKE_TIMEOUT_MS || 15000);

function withTimeout(promise, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${TIMEOUT_MS}ms`)), TIMEOUT_MS);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function main() {
  const targets = await withTimeout(CDP.List({ port: PORT }), 'Codex Desktop target list');
  const target = targets.find(item => item.type === 'page' && item.url === 'app://-/index.html')
    || targets.find(item => item.type === 'page' && /^app:/.test(item.url || ''));
  assert(target, `Codex Desktop app target not found on port ${PORT}`);

  const client = await withTimeout(CDP({ port: PORT, target: target.id }), 'Codex Desktop attach');
  try {
    await client.Runtime.enable();
    const inventoryResult = await withTimeout(client.Runtime.evaluate({
      expression: `JSON.stringify(Array.from(document.querySelectorAll('[data-app-action-sidebar-thread-row]')).map(function(el) {
        return {
          id: el.getAttribute('data-app-action-sidebar-thread-id') || '',
          title: el.getAttribute('data-app-action-sidebar-thread-title') || (el.innerText || el.textContent || '').trim(),
          active: el.getAttribute('data-app-action-sidebar-thread-active') === 'true'
            || el.getAttribute('aria-current') === 'page'
            || el.getAttribute('aria-selected') === 'true'
        };
      }))`,
      returnByValue: true,
    }), 'native thread inventory');
    const nativeRows = JSON.parse(inventoryResult.result?.value || '[]');
    assert(nativeRows.length > 0, 'native Codex Desktop sidebar has no thread rows to validate');

    const threads = await withTimeout(
      selectors.readCodexThreadList(client.Runtime, true),
      'readCodexThreadList',
    );
    assert(threads.length > 0,
      `selector returned zero threads while native DOM exposes ${nativeRows.length}`);
    assert.equal(threads.length, nativeRows.length,
      'selector must preserve every native sidebar thread row');

    const nativeIds = nativeRows.map(row => row.id);
    assert(nativeIds.every(Boolean), 'native thread rows must expose stable IDs');
    assert.deepEqual(threads.map(thread => thread.id), nativeIds,
      'selector must preserve native thread IDs in sidebar order');
    assert.deepEqual(
      threads.map(thread => thread.title),
      nativeRows.map(row => String(row.title || '').replace(/\s+/g, ' ').trim()),
      'selector must preserve every visible native thread title exactly',
    );
    assert(threads.every(thread => thread.title && thread.title.trim()),
      'selector must provide a visible title for every thread');

    const nativeActive = nativeRows.filter(row => row.active);
    const selectedActive = threads.filter(thread => thread.active);
    assert.equal(nativeActive.length, 1, 'native sidebar must expose exactly one active thread');
    assert.equal(selectedActive.length, 1, 'selector must expose exactly one active thread');
    assert.equal(selectedActive[0].id, nativeActive[0].id,
      'selector active thread must match the native active row');

    console.log(`Codex Desktop thread list smoke: PASS (${threads.length} threads, active=${selectedActive[0].id})`);
  } finally {
    await client.close();
  }
}

withCodexDesktopCdpLock('codex-desktop-thread-list', main, { waitMs: 90000 }).catch(error => {
  console.error(`Codex Desktop thread list smoke: FAIL (${error.message})`);
  process.exit(1);
});
