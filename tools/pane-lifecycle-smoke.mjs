#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PANE_CLOSED,
  PANE_DEFINITIONS,
  PANE_MINIMIZED,
  PANE_OPEN,
  createPaneLifecycleLedger,
  paneRecord,
  paneRestoreRail,
  paneState,
  removePaneLifecycleSession,
  synchronizeAuthoritativePane,
  transitionPaneLifecycle,
} from '../frontend/pane-lifecycle.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputIndex = process.argv.indexOf('--output');
const outputPath = outputIndex >= 0 && process.argv[outputIndex + 1]
  ? path.resolve(process.argv[outputIndex + 1])
  : '';

assert(PANE_DEFINITIONS.length >= 28, 'pane registry lost advertised surfaces');
assert.equal(new Set(PANE_DEFINITIONS.map(definition => definition.id)).size, PANE_DEFINITIONS.length,
  'pane IDs must be globally unique');
assert(PANE_DEFINITIONS.every(definition => (
  definition.id
  && definition.label
  && ['chat-adjacent', 'blocking-native-action', 'transient-status', 'full-route'].includes(definition.classification)
  && (definition.web || definition.android)
)), 'every pane definition needs identity, classification, and a real client');

let ledger = createPaneLifecycleLedger();
ledger = transitionPaneLifecycle(ledger, {
  session_id: 'session-a',
  pane_id: 'terminal',
  action: 'open',
  compact: true,
  payload: { scroll_top: 317, selection: 'command-7' },
});
ledger = transitionPaneLifecycle(ledger, {
  session_id: 'session-a',
  pane_id: 'file-browser',
  action: 'open',
  compact: true,
  payload: { scroll_top: 92, selection: 'src/index.js' },
});
assert.equal(paneState(ledger, 'session-a', 'terminal'), PANE_MINIMIZED);
assert.equal(paneState(ledger, 'session-a', 'file-browser'), PANE_OPEN);
assert.deepEqual(paneRecord(ledger, 'session-a', 'terminal').payload,
  { scroll_top: 317, selection: 'command-7' });

const transitions = [];
for (let cycle = 0; cycle < 1_000; cycle += 1) {
  ledger = transitionPaneLifecycle(ledger, {
    session_id: 'session-a',
    pane_id: 'file-browser',
    action: 'minimize',
  });
  transitions.push(paneState(ledger, 'session-a', 'file-browser'));
  ledger = transitionPaneLifecycle(ledger, {
    session_id: 'session-a',
    pane_id: 'file-browser',
    action: 'restore',
    compact: true,
  });
  transitions.push(paneState(ledger, 'session-a', 'file-browser'));
}
assert.equal(transitions.filter(state => state === PANE_MINIMIZED).length, 1_000);
assert.equal(transitions.filter(state => state === PANE_OPEN).length, 1_000);
assert.deepEqual(paneRecord(ledger, 'session-a', 'file-browser').payload,
  { scroll_top: 92, selection: 'src/index.js' });

ledger = synchronizeAuthoritativePane(ledger, {
  session_id: 'session-a',
  pane_id: 'native-action',
  source_key: 'generation-4:prompt-9',
  attention_count: 1,
  compact: true,
  payload: { selected_choice_ids: ['safe'] },
});
assert.equal(paneState(ledger, 'session-a', 'native-action'), PANE_OPEN);
ledger = transitionPaneLifecycle(ledger, {
  session_id: 'session-a',
  pane_id: 'native-action',
  action: 'minimize',
});
const minimizedPromptRevision = paneRecord(ledger, 'session-a', 'native-action').revision;
ledger = synchronizeAuthoritativePane(ledger, {
  session_id: 'session-a',
  pane_id: 'native-action',
  source_key: 'generation-4:prompt-9',
  attention_count: 1,
  compact: true,
  payload: { selected_choice_ids: ['safe'] },
});
assert.equal(paneState(ledger, 'session-a', 'native-action'), PANE_MINIMIZED,
  'ordinary refresh resurrected a minimized native action');
assert.equal(paneRecord(ledger, 'session-a', 'native-action').revision, minimizedPromptRevision,
  'identical native refresh rewrote pane lifecycle state');
assert.deepEqual(paneRecord(ledger, 'session-a', 'native-action').payload,
  { selected_choice_ids: ['safe'] });

ledger = synchronizeAuthoritativePane(ledger, {
  session_id: 'session-a',
  pane_id: 'native-action',
  source_key: 'generation-4:prompt-10',
  attention_count: 1,
  compact: true,
});
assert.equal(paneState(ledger, 'session-a', 'native-action'), PANE_OPEN,
  'a genuinely new native action did not surface');
ledger = synchronizeAuthoritativePane(ledger, {
  session_id: 'session-a',
  pane_id: 'native-action',
  source_key: '',
});
assert.equal(paneState(ledger, 'session-a', 'native-action'), PANE_CLOSED,
  'authoritative native resolution did not clear the pane');

ledger = transitionPaneLifecycle(ledger, {
  session_id: 'session-b',
  pane_id: 'terminal',
  action: 'open',
  compact: false,
  payload: { scroll_top: 11 },
});
assert.equal(paneState(ledger, 'session-a', 'terminal'), PANE_MINIMIZED);
assert.equal(paneState(ledger, 'session-b', 'terminal'), PANE_OPEN);
ledger = removePaneLifecycleSession(ledger, 'session-b');
assert.equal(paneState(ledger, 'session-b', 'terminal'), PANE_CLOSED);
assert.equal(paneState(ledger, 'session-a', 'terminal'), PANE_MINIMIZED);

const rail = paneRestoreRail(ledger, 'session-a');
assert(rail.length >= 1);
assert(rail.every(record => record.state === PANE_MINIMIZED));
assert(rail.every(record => PANE_DEFINITIONS.some(definition => definition.id === record.pane_id)));

const receipt = {
  ok: true,
  checked_at: new Date().toISOString(),
  pane_definitions: PANE_DEFINITIONS.length,
  lifecycle_states: [PANE_CLOSED, PANE_OPEN, PANE_MINIMIZED],
  adversarial_cycles: 1_000,
  transitions: transitions.length,
  state_regressions: 0,
  payload_losses: 0,
  native_action_resurrections: 0,
  cross_session_leaks: 0,
  restore_rail_rows: rail.length,
};

if (outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
}
console.log(JSON.stringify(receipt, null, 2));
