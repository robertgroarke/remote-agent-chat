#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const options = { stateFile: null, generation: 1 };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--state-file' && argv[i + 1]) options.stateFile = path.resolve(argv[++i]);
    else if (argv[i] === '--generation' && argv[i + 1]) options.generation = Number(argv[++i]) || 1;
    else throw new Error(`Unknown or incomplete argument: ${argv[i]}`);
  }
  if (!options.stateFile) throw new Error('--state-file is required');
  return options;
}

const options = parseArgs(process.argv.slice(2));
let activity = { kind: 'idle', label: 'Ready' };
let messageId = 0;
let message = `CHAOS_BASELINE_G${options.generation}`;

function writeState() {
  const state = {
    pid: process.pid,
    generation: options.generation,
    updated_at_ms: Date.now(),
    activity,
    message_id: messageId,
    message,
  };
  fs.mkdirSync(path.dirname(options.stateFile), { recursive: true });
  const serialized = JSON.stringify(state);
  // On Windows, rename-over-existing races with the proxy's 100 ms read loop:
  // a reader can hold the destination without delete sharing, causing EPERM and
  // terminating this fixture process (which then drops the parent's IPC channel).
  // The proxy deliberately retains its last good state across transient parse
  // misses, so a direct bounded write is the reliable contract on Windows.
  if (process.platform === 'win32') {
    fs.writeFileSync(options.stateFile, serialized, 'utf8');
    return;
  }
  const temp = `${options.stateFile}.${process.pid}.tmp`;
  fs.writeFileSync(temp, serialized, 'utf8');
  fs.renameSync(temp, options.stateFile);
}

function cleanup() {
  try { fs.unlinkSync(options.stateFile); } catch {}
}

process.on('message', command => {
  if (command?.type === 'set_activity') {
    activity = command.kind === 'working'
      ? { kind: 'thinking', label: command.label || 'Working' }
      : { kind: 'idle', label: command.label || 'Ready' };
    writeState();
  } else if (command?.type === 'emit_marker') {
    messageId += 1;
    message = String(command.marker || `CHAOS_MARKER_${Date.now()}`);
    writeState();
  }
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    cleanup();
    process.exit(0);
  });
}
process.on('exit', cleanup);

writeState();
setInterval(writeState, 100).unref();
if (process.send) process.send({ type: 'ready', pid: process.pid, generation: options.generation, at_ms: Date.now() });
setInterval(() => {}, 60_000);

module.exports = { parseArgs };
