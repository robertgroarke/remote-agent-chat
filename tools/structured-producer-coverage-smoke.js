#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { CANONICAL_BLOCK_TYPES } = require('../android-app/lib/content-blocks');

const ROOT = path.resolve(__dirname, '..');
const EVIDENCE_ROOT = path.join(ROOT, 'evidence', 'harness-maturity', '2026-07-12');
const EXPECTED_HARNESSES = [
  'claude',
  'codex',
  'antigravity_panel',
  'codex-desktop',
  'antigravity-v2',
  'cursor',
  'claude_cli',
  'codex_cli',
  'cursor_cli',
  'gemini',
  'continue',
  'roo_code',
];
const EXTERNAL_GATES = new Set(['antigravity_panel', 'gemini', 'roo_code']);

function parseArgs(argv) {
  const options = {
    inventory: path.join(EVIDENCE_ROOT, 'production-block-inventory-history-ranked.json'),
    output: '',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--inventory' && argv[index + 1]) options.inventory = path.resolve(ROOT, argv[++index]);
    else if (arg === '--output' && argv[index + 1]) options.output = path.resolve(ROOT, argv[++index]);
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  return options;
}

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(EVIDENCE_ROOT, name), 'utf8'));
}

function readSource(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

const options = parseArgs(process.argv.slice(2));
const inventory = JSON.parse(fs.readFileSync(options.inventory, 'utf8'));
const cursorCliTaxonomy = readJson('cursor-cli-native-taxonomy-result.json');
const queueContract = readJson('structured-queue-block-source.json');
const planContract = readJson('structured-live-plan-source.json');
const promptContract = readJson('structured-prompt-event-source.json');
const compactionContract = readJson('codex-compaction-notice-source.json');

assert.strictEqual(inventory.ok, true);
assert.deepStrictEqual(inventory.canonical_block_types, CANONICAL_BLOCK_TYPES);
assert.strictEqual(cursorCliTaxonomy.ok, true);
assert.deepStrictEqual(cursorCliTaxonomy.unknown_event_types, []);
assert.strictEqual(queueContract.canonical_type, 'queued_message');
assert.strictEqual(planContract.canonical_type, 'plan');
assert.deepStrictEqual(promptContract.canonical_types, ['prompt', 'notice', 'error']);
assert.strictEqual(compactionContract.native_compaction_notice_typed, true);
assert.strictEqual(compactionContract.native_compaction_prompt_emitted, false);

const claudeCliSource = readSource('agent-proxy/claude-cli.js');
assert.match(claudeCliSource, /name === 'AskUserQuestion'/);
assert.match(claudeCliSource, /type: 'prompt'/);
assert.match(claudeCliSource, /CLAUDE_TASK_TOOLS = new Set\(\['TaskCreate', 'TaskGet', 'TaskUpdate', 'TaskList'\]\)/);
assert.match(claudeCliSource, /function applyClaudeTaskResult\(/);
assert.match(claudeCliSource, /Current Task operations must reduce to one plan block|type: 'plan'/);
assert.match(claudeCliSource, /permission_mode: state\.permissionMode \|\| undefined/);

const protocolSource = readSource('agent-proxy/protocol.js');
assert.match(protocolSource, /type: 'queued_message'/);
assert.match(protocolSource, /function messageQueued\(/);
assert.match(protocolSource, /function nativeQueue\(/);

const coverage = {
  claude: {
    typed: ['markdown', 'thinking', 'tool_call', 'file_changes', 'prompt'],
    observed_untyped: [],
    inventory_limit: 'No owned native notice, plan, or queue transcript surface was observed.',
    activation: 'production_live_inventory_verified',
  },
  codex: {
    typed: ['markdown', 'thinking', 'tool_call', 'terminal', 'file_changes', 'prompt', 'plan', 'queued_message', 'notice', 'error', 'status'],
    observed_untyped: [],
    inventory_limit: 'All owned native transcript, plan, queue, permission, notice, error, and status surfaces are mapped.',
    activation: 'production_live_inventory_verified',
  },
  antigravity_panel: {
    typed: [],
    observed_untyped: [],
    external_gate: 'Antigravity IDE must be launched on prepared CDP port 9228.',
  },
  'codex-desktop': {
    typed: ['markdown', 'thinking', 'tool_call', 'terminal', 'file_changes', 'prompt', 'plan', 'queued_message', 'notice', 'error', 'status'],
    observed_untyped: [],
    inventory_limit: 'All owned native transcript, plan, queue, permission, notice, error, and status surfaces are mapped.',
    activation: 'production_live_inventory_verified',
  },
  'antigravity-v2': {
    typed: ['markdown', 'thinking', 'tool_call', 'terminal', 'file_changes', 'artifact', 'prompt', 'error', 'status'],
    observed_untyped: [],
    inventory_limit: 'No owned native queue transcript surface was observed.',
    activation: 'production_live_inventory_verified',
  },
  cursor: {
    typed: ['markdown', 'thinking', 'tool_call', 'file_changes', 'prompt', 'notice', 'error', 'status'],
    observed_untyped: [],
    inventory_limit: 'No owned native terminal, artifact, or queue transcript surface was observed.',
    activation: 'production_live_inventory_verified',
  },
  claude_cli: {
    typed: ['markdown', 'thinking', 'tool_call', 'tool_result', 'terminal', 'prompt', 'plan', 'queued_message', 'notice', 'error'],
    observed_untyped: [],
    inventory_limit: 'TaskCreate/TaskUpdate/TaskList reduce to the native task plan and AskUserQuestion is the native transcript prompt; permission_mode is session configuration, not a transcript block.',
    activation: 'production_live_inventory_verified',
  },
  codex_cli: {
    typed: ['markdown', 'thinking', 'tool_call', 'tool_result', 'terminal', 'file_changes', 'artifact', 'prompt', 'plan', 'notice', 'error', 'status'],
    observed_untyped: [],
    inventory_limit: 'Retained native JSONL has no queue event; shared busy/native proxy queue events are canonical queued_message blocks.',
    activation: 'production_live_inventory_verified',
  },
  cursor_cli: {
    typed: ['markdown', 'thinking', 'tool_call', 'tool_result', 'terminal', 'error'],
    observed_untyped: [],
    grounded_native_absent: ['file_changes', 'prompt', 'plan', 'queued_message', 'notice', 'status'],
    inventory_limit: 'The retained 4,512-row native taxonomy has no file-change, permission, plan, queue, notice, or status event; new event types fail closed.',
    activation: 'production_live_inventory_verified',
  },
  gemini: {
    typed: [],
    observed_untyped: [],
    external_gate: 'Gemini Code Assist is signed out on the disposable host.',
  },
  continue: {
    typed: ['markdown', 'tool_call', 'terminal', 'prompt', 'notice', 'error'],
    observed_untyped: [],
    inventory_limit: 'The live formal producer is typed; native extension history remains unavailable.',
    activation: 'production_live_inventory_verified',
  },
  roo_code: {
    typed: [],
    observed_untyped: [],
    external_gate: 'Roo Code is blocked on onboarding and provider setup.',
  },
};

assert.deepStrictEqual(Object.keys(coverage), EXPECTED_HARNESSES);

const inventoryByHarness = new Map(inventory.harnesses.map(row => [row.agent_type, row]));
assert.deepStrictEqual(inventory.harnesses.map(row => row.agent_type), EXPECTED_HARNESSES);

for (const [agentType, row] of Object.entries(coverage)) {
  const evidence = inventoryByHarness.get(agentType);
  assert(evidence, `missing production inventory row for ${agentType}`);
  assert.deepStrictEqual(row.observed_untyped, [], `${agentType} has an observed untyped surface`);
  assert(row.typed.every(type => CANONICAL_BLOCK_TYPES.includes(type)), `${agentType} declares an unknown canonical type`);
  assert.strictEqual(new Set(row.typed).size, row.typed.length, `${agentType} repeats a typed surface`);

  if (EXTERNAL_GATES.has(agentType)) {
    assert.strictEqual(evidence.status, 'unavailable', `${agentType} external gate unexpectedly became available`);
    assert(row.external_gate, `${agentType} is missing its external-gate reason`);
    continue;
  }

  assert.notStrictEqual(evidence.status, 'unavailable', `${agentType} lost its owned inventory surface`);
  assert.strictEqual(row.activation, 'production_live_inventory_verified', `${agentType} has stale production activation metadata`);
  assert.strictEqual(evidence.latest_assistant?.typed, true, `${agentType} has current flattened assistant output`);
  if (evidence.latest_plain_assistant_at) {
    assert(
      Date.parse(evidence.latest_plain_assistant_at) < Date.parse(evidence.latest_assistant.at),
      `${agentType} has current flattened assistant output`,
    );
  }
  assert.deepStrictEqual(evidence.unknown_types, [], `${agentType} emitted an unknown block type`);
  for (const type of evidence.observed_types) {
    assert(row.typed.includes(type), `${agentType} observed ${type} without a typed producer classification`);
  }
}

assert.deepStrictEqual(
  cursorCliTaxonomy.grounded_absent_structured_events,
  ['file_change', 'permission_prompt', 'plan', 'queue', 'notice', 'status'],
);

const pendingMappings = Object.entries(coverage)
  .filter(([, row]) => row.observed_untyped.length > 0)
  .map(([agentType]) => agentType);
const externallyGated = Object.entries(coverage)
  .filter(([, row]) => row.external_gate)
  .map(([agentType]) => agentType);

assert.deepStrictEqual(pendingMappings, []);
assert.deepStrictEqual(externallyGated, [...EXTERNAL_GATES]);

const result = {
  ok: true,
  generated_at: new Date().toISOString(),
  canonical_block_types: CANONICAL_BLOCK_TYPES,
  harness_count: EXPECTED_HARNESSES.length,
  owned_inventory_harnesses: EXPECTED_HARNESSES.length - EXTERNAL_GATES.size,
  external_gates: externallyGated,
  observed_untyped_harnesses: pendingMappings,
  source_schema_complete_for_owned_observed_surfaces: true,
  fresh_inventory_input_supported: true,
  production_activation: 'live_inventory_verified',
  grounding: {
    production_inventory: path.relative(ROOT, options.inventory).replace(/\\/g, '/'),
    cursor_cli_taxonomy: 'cursor-cli-native-taxonomy-result.json',
    queue_contract: 'structured-queue-block-source.json',
    plan_contract: 'structured-live-plan-source.json',
    prompt_contract: 'structured-prompt-event-source.json',
    compaction_contract: 'codex-compaction-notice-source.json',
  },
  harnesses: Object.entries(coverage).map(([agent_type, row]) => ({ agent_type, ...row })),
  safety: {
    sends: 0,
    controls: 0,
    focus_actions: 0,
    visible_windows_opened: 0,
    proxy_restarts: 0,
    relay_deploys: 0,
  },
};

const rendered = JSON.stringify(result, null, 2) + '\n';
if (options.output) {
  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, rendered, 'utf8');
}
process.stdout.write(rendered);

module.exports = { parseArgs };
