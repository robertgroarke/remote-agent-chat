#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

if (process.argv.length !== 3 || process.argv[2] !== '--read-only') {
  console.error('Usage: node tools/cursor-cli-native-taxonomy-smoke.js --read-only');
  process.exit(2);
}

const root = path.join(process.env.USERPROFILE || process.env.HOME || '', '.cursor', 'cli-sessions');
const knownTypes = new Set([
  'assistant',
  'thinking',
  'system',
  'user',
  'result',
  'tool_call',
  'session_meta',
]);
const toolMetadataKeys = new Set([
  'call_id',
  'hookAdditionalContexts',
  'toolCallId',
  'startedAtMs',
  'completedAtMs',
]);

function increment(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function sortedObject(map) {
  return Object.fromEntries([...map].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function findJsonlFiles(directory) {
  if (!directory || !fs.existsSync(directory)) return [];
  const files = [];
  const stack = [directory];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.jsonl')) files.push(full);
    }
  }
  return files;
}

const files = findJsonlFiles(root);
const types = new Map();
const subtypes = new Map();
const toolTypes = new Map();
const unknownTypes = new Set();
let rows = 0;
let ignoredIncompleteTailLines = 0;

for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  if (!text.endsWith('\n')) {
    lines.pop();
    ignoredIncompleteTailLines++;
  }
  for (const line of lines) {
    if (!line.trim()) continue;
    const event = JSON.parse(line);
    rows++;
    const type = String(event.type || '<missing>');
    increment(types, type);
    increment(subtypes, `${type}:${String(event.subtype || '<none>')}`);
    if (!knownTypes.has(type)) unknownTypes.add(type);
    if (type === 'tool_call') {
      const keys = Object.keys(event.tool_call || {}).filter(key => !toolMetadataKeys.has(key));
      for (const key of keys) increment(toolTypes, key);
    }
  }
}

assert.deepStrictEqual([...unknownTypes], [], `Unmapped Cursor CLI native event types: ${[...unknownTypes].join(', ')}`);

console.log(JSON.stringify({
  ok: true,
  read_only: true,
  available: files.length > 0,
  files: files.length,
  rows,
  ignored_incomplete_tail_lines: ignoredIncompleteTailLines,
  event_types: sortedObject(types),
  event_subtypes: sortedObject(subtypes),
  semantic_tool_types: sortedObject(toolTypes),
  unknown_event_types: [...unknownTypes],
  grounded_absent_structured_events: [
    'file_change',
    'permission_prompt',
    'plan',
    'queue',
    'notice',
    'status',
  ].filter(type => !types.has(type)),
}, null, 2));
