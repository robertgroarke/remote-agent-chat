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
  'interaction_query',
  'connection',
  'retry',
]);
const reviewedSubtypes = new Map([
  ['assistant', new Set(['<none>'])],
  ['thinking', new Set(['delta', 'completed'])],
  ['system', new Set(['init', 'task_notification'])],
  ['user', new Set(['<none>'])],
  ['result', new Set(['success', 'error'])],
  ['tool_call', new Set(['started', 'completed'])],
  ['session_meta', new Set(['<none>'])],
  ['interaction_query', new Set(['request', 'response'])],
  ['connection', new Set(['reconnecting', 'reconnected'])],
  ['retry', new Set(['starting'])],
]);
const reviewedInteractionQueryTypes = new Set([
  'webSearchRequestQuery',
  'webFetchRequestQuery',
]);
const reviewedTaskNotificationStatuses = new Set(['success', 'error']);
const reviewedInteractionResponseDispositions = new Set(['approved']);
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
const unknownSubtypes = new Set();
const unknownInteractionQueryTypes = new Set();
const unknownTaskNotificationStatuses = new Set();
const unknownInteractionResponseDispositions = new Set();
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
    const allowedSubtypes = reviewedSubtypes.get(type);
    if (allowedSubtypes && !allowedSubtypes.has(String(event.subtype || '<none>'))) {
      unknownSubtypes.add(`${type}:${String(event.subtype || '<none>')}`);
    }
    if (type === 'interaction_query' && !reviewedInteractionQueryTypes.has(String(event.query_type || ''))) {
      unknownInteractionQueryTypes.add(String(event.query_type || '<missing>'));
    }
    if (type === 'system' && event.subtype === 'task_notification'
        && !reviewedTaskNotificationStatuses.has(String(event.status || ''))) {
      unknownTaskNotificationStatuses.add(String(event.status || '<missing>'));
    }
    if (type === 'interaction_query' && event.subtype === 'response') {
      const responseType = String(event.query_type || '').replace(/Query$/, 'Response');
      const dispositions = Object.keys(event.response?.[responseType] || {});
      for (const disposition of dispositions) {
        if (!reviewedInteractionResponseDispositions.has(disposition)) {
          unknownInteractionResponseDispositions.add(disposition);
        }
      }
    }
    if (type === 'tool_call') {
      const keys = Object.keys(event.tool_call || {}).filter(key => !toolMetadataKeys.has(key));
      for (const key of keys) increment(toolTypes, key);
    }
  }
}

assert.deepStrictEqual([...unknownTypes], [], `Unmapped Cursor CLI native event types: ${[...unknownTypes].join(', ')}`);
assert.deepStrictEqual([...unknownSubtypes], [], `Unmapped Cursor CLI native event subtypes: ${[...unknownSubtypes].join(', ')}`);
assert.deepStrictEqual([...unknownInteractionQueryTypes], [],
  `Unmapped Cursor CLI interaction query types: ${[...unknownInteractionQueryTypes].join(', ')}`);
assert.deepStrictEqual([...unknownTaskNotificationStatuses], [],
  `Unmapped Cursor CLI task notification statuses: ${[...unknownTaskNotificationStatuses].join(', ')}`);
assert.deepStrictEqual([...unknownInteractionResponseDispositions], [],
  `Unmapped Cursor CLI interaction response dispositions: ${[...unknownInteractionResponseDispositions].join(', ')}`);

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
  unknown_event_subtypes: [...unknownSubtypes],
  unknown_interaction_query_types: [...unknownInteractionQueryTypes],
  unknown_task_notification_statuses: [...unknownTaskNotificationStatuses],
  unknown_interaction_response_dispositions: [...unknownInteractionResponseDispositions],
  grounded_absent_structured_events: [
    'file_change',
    'plan',
    'queue',
    'status',
  ].filter(type => !types.has(type)),
}, null, 2));
