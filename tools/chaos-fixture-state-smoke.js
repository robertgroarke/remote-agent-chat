#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fork } = require('child_process');

const root = path.resolve(__dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-chaos-state-smoke-'));
const stateFile = path.join(tempRoot, 'harness-state.json');

function waitReady(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('fixture harness ready timeout')), 3000);
    child.on('message', message => {
      if (message?.type === 'ready') {
        clearTimeout(timer);
        resolve(message);
      }
    });
    child.once('exit', code => reject(new Error(`fixture harness exited ${code} before ready`)));
  });
}

async function main() {
  const child = fork(path.join(__dirname, 'chaos-fixture-harness.js'), [
    '--state-file', stateFile,
    '--generation', '1',
  ], { cwd: root, silent: true, windowsHide: true });
  let childError = null;
  child.on('error', error => { childError = error; });
  let parseMisses = 0;
  let reads = 0;
  try {
    await waitReady(child);
    const deadline = Date.now() + 2000;
    let sequence = 0;
    while (Date.now() < deadline) {
      if (!child.connected || child.exitCode != null) {
        const stderr = child.stderr?.read()?.toString() || '';
        throw new Error(`fixture harness IPC lost during state contention: ${stderr}`);
      }
      child.send({ type: 'emit_marker', marker: `CHAOS_STATE_${sequence++}` }, error => {
        if (error) childError = error;
      });
      for (let burst = 0; burst < 20; burst += 1) {
        try {
          JSON.parse(fs.readFileSync(stateFile, 'utf8'));
        } catch {
          parseMisses += 1;
        }
        reads += 1;
      }
      await new Promise(resolve => setImmediate(resolve));
      if (childError) throw childError;
    }
    assert(child.connected && child.exitCode == null, 'fixture harness must remain IPC-connected');
    const finalState = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.match(finalState.message, /^CHAOS_STATE_/);
    console.log(JSON.stringify({
      ok: true,
      reads,
      parse_misses_tolerated: parseMisses,
      final_message: finalState.message,
      fixture_connected: true,
    }, null, 2));
  } finally {
    if (child.exitCode == null) child.kill('SIGTERM');
    await new Promise(resolve => {
      if (child.exitCode != null) return resolve();
      child.once('exit', resolve);
      setTimeout(resolve, 1000);
    });
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(`chaos fixture state smoke: FAIL (${error.stack || error.message})`);
  process.exit(1);
});
