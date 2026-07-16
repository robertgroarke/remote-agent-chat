#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const esbuild = require('../frontend/node_modules/esbuild');

const ROOT = path.resolve(__dirname, '..');

async function loadModule(file) {
  const built = await esbuild.build({
    entryPoints: [file],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    target: ['node18'],
  });
  const loaded = new Module(file, module);
  loaded.filename = file;
  loaded.paths = Module._nodeModulePaths(path.dirname(file));
  loaded._compile(built.outputFiles[0].text, file);
  return loaded.exports;
}

function exercise(api, label) {
  const sessions = Array.from({ length: 69 }, (_, index) => ({
    session_id: `session-${index}`,
    agent_type: index % 2 ? 'codex_cli' : 'claude_cli',
    title: `Session ${index}`,
    status: 'healthy',
    activity: { kind: index < 5 ? 'working' : 'idle', label: '' },
  }));
  const initial = api.createSessionRegistry(sessions);
  const identical = api.reconcileSessionRegistry(initial, sessions.map(session => ({
    ...session,
    activity: { ...session.activity },
  })));
  assert.strictEqual(identical, initial, `${label}: equal inventory replaced registry`);

  const targetIndex = 37;
  const targetId = sessions[targetIndex].session_id;
  const patched = api.patchSessionRegistry(initial, {
    type: 'session_patch',
    session_id: targetId,
    patch: { model_id: 'fixture-model', last_seen_at: '2026-07-14T02:35:00.000Z' },
  });
  assert.notStrictEqual(patched, initial, `${label}: patch did not update registry`);
  assert.strictEqual(patched.order, initial.order, `${label}: patch replaced stable order`);
  assert.strictEqual(patched.indexById, initial.indexById, `${label}: patch rebuilt stable index`);
  assert.strictEqual(patched.list.length, initial.list.length, `${label}: patch changed membership`);
  assert.strictEqual(patched.list[targetIndex].model_id, 'fixture-model', `${label}: patch value missing`);
  sessions.forEach((session, index) => {
    if (index === targetIndex) assert.notStrictEqual(patched.list[index], initial.list[index], `${label}: touched row retained identity`);
    else assert.strictEqual(patched.list[index], initial.list[index], `${label}: unrelated row ${index} lost identity`);
  });

  const removed = api.patchSessionRegistry(patched, {
    session_id: targetId,
    patch: { constructor: { polluted: true }, __proto__: { polluted: true } },
    removed_fields: ['model_id', '__proto__'],
  });
  assert.strictEqual(removed.list[targetIndex].model_id, undefined, `${label}: removed field survived`);
  assert.strictEqual({}.polluted, undefined, `${label}: unsafe patch polluted Object.prototype`);
  assert.strictEqual(api.patchSessionRegistry(removed, { session_id: 'unknown', patch: { status: 'x' } }), removed,
    `${label}: unknown patch invented membership`);

  const durableTitle = api.patchSessionRegistry(removed, {
    session_id: targetId,
    patch: { chat_title: 'Restore harness controls', chat_title_source: 'summary' },
  });
  const ignoredGenericPatch = api.patchSessionRegistry(durableTitle, {
    session_id: targetId,
    patch: { chat_title: 'New chat', chat_title_source: null },
  });
  assert.strictEqual(ignoredGenericPatch.list[targetIndex].chat_title, 'Restore harness controls',
    `${label}: generic patch regressed a durable title`);
  assert.strictEqual(ignoredGenericPatch.list[targetIndex].chat_title_source, 'summary',
    `${label}: generic patch erased durable title provenance`);
  const ignoredGenericInventory = api.reconcileSessionRegistry(ignoredGenericPatch, ignoredGenericPatch.list.map((item, index) => (
    index === targetIndex ? { ...item, chat_title: null, chat_title_source: null } : item
  )));
  assert.strictEqual(ignoredGenericInventory.list[targetIndex].chat_title, 'Restore harness controls',
    `${label}: generic inventory regressed a durable title`);
  const explicitReset = api.patchSessionRegistry(ignoredGenericInventory, {
    session_id: targetId,
    patch: { chat_title: 'New Conversation', chat_title_source: null, is_new_chat_draft: true },
  });
  assert.strictEqual(explicitReset.list[targetIndex].chat_title, 'New Conversation',
    `${label}: explicit new-chat reset did not clear durable title`);
  const nativeReplacement = api.patchSessionRegistry(explicitReset, {
    session_id: targetId,
    patch: { chat_title: 'Native thread title', chat_title_source: 'native', is_new_chat_draft: false },
  });
  assert.strictEqual(nativeReplacement.list[targetIndex].chat_title, 'Native thread title',
    `${label}: native title did not replace reset placeholder`);

  const timings = [];
  let current = nativeReplacement;
  for (let index = 0; index < 5000; index += 1) {
    const started = performance.now();
    current = api.patchSessionRegistry(current, {
      session_id: targetId,
      patch: { last_seen_at: `2026-07-14T02:${String(index % 60).padStart(2, '0')}:00.000Z` },
    });
    timings.push(performance.now() - started);
  }
  timings.sort((left, right) => left - right);
  return {
    label,
    sessions: sessions.length,
    stable_registry_on_equal_inventory: identical === initial,
    unchanged_row_identity_count: sessions.length - 1,
    membership_and_order_stable: current.order === initial.order && current.list.length === initial.list.length,
    unsafe_patch_keys_rejected: {}.polluted === undefined,
    durable_title_monotonic: ignoredGenericInventory.list[targetIndex].chat_title === 'Restore harness controls',
    explicit_title_reset: explicitReset.list[targetIndex].chat_title === 'New Conversation',
    patch_p50_ms: timings[Math.ceil(timings.length * 0.50) - 1],
    patch_p95_ms: timings[Math.ceil(timings.length * 0.95) - 1],
    patch_max_ms: timings[timings.length - 1],
  };
}

async function main(argv = process.argv.slice(2)) {
  const outputIndex = argv.indexOf('--output');
  const outputPath = outputIndex >= 0 && argv[outputIndex + 1] ? path.resolve(argv[outputIndex + 1]) : null;
  const web = await loadModule(path.join(ROOT, 'frontend', 'session-registry.js'));
  const android = await loadModule(path.join(ROOT, 'android-app', 'lib', 'session-registry.js'));
  const results = [exercise(web, 'web'), exercise(android, 'android')];
  const result = {
    status: 'PASS',
    generated_at: new Date().toISOString(),
    results,
    visible_windows_opened: 0,
    focus_actions: 0,
  };
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, serialized, 'utf8');
  }
  process.stdout.write(serialized);
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  });
}

module.exports = { exercise, loadModule, main };
