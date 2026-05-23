'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.CODEX_CLI_ACTIVITY_STALE_MS = String(365 * 24 * 60 * 60 * 1000);
process.env.CODEX_CLI_HYDRATE_MAX_MB = '10';
delete process.env.CODEX_CLI_ACTIVE_HYDRATE_MAX_MB;
const codexCli = require('../agent-proxy/codex-cli');

assert(
  codexCli.CODEX_CLI_ACTIVE_HYDRATE_MAX_BYTES >= 75 * 1024 * 1024,
  'active Codex CLI hydration should stay high even when archive hydration is capped low'
);

const fixture = path.join(__dirname, 'fixtures', 'codex-cli-session-sample.jsonl');
const summary = codexCli.readSessionSummary(fixture);

assert(summary, 'expected fixture summary');
assert.strictEqual(summary.cliSessionId, '00000000-0000-4000-8000-000000000001');
assert.strictEqual(summary.workspaceName, 'Remote Agent Chat');
assert.strictEqual(summary.model_id, 'gpt-5.5');
assert.strictEqual(summary.effort, 'low');
assert.strictEqual(summary.permission_mode, 'workspace-write');
assert(summary.messages.some(msg => msg.role === 'user' && msg.content.includes('/goal Verify parser fidelity')));
assert(summary.messages.some(msg => msg.content_blocks?.some(block =>
  block.type === 'tool_call'
  && /shell_command/.test(block.title)
  && /arguments:\n/.test(block.content)
  && block.command === 'git status --short'
  && block.collapsed === false
)));
assert(summary.messages.some(msg => msg.content_blocks?.some(block =>
  block.type === 'tool_call'
  && block.title === 'Tool result: shell_command'
  && block.content.includes('tool: shell_command')
  && block.content.includes('"changed"')
  && block.collapsed === false
)));
assert(summary.messages.some(msg => msg.content_blocks?.some(block =>
  block.type === 'terminal'
  && block.command === 'git status --short'
  && block.collapsed === false
)));
assert(summary.messages.some(msg => msg.content_blocks?.some(block => block.type === 'file_changes' && block.files?.[0]?.path === 'agent-proxy/codex-cli.js')));
assert(summary.messages.some(msg => msg.role === 'assistant' && msg.content.includes('Parser smoke complete.')));
assert(summary.activity, 'expected active Codex CLI activity');
assert.strictEqual(summary.activity.kind, 'running_command');
assert.strictEqual(summary.activity.label, 'Working');
assert(summary.activity.started_at, 'expected activity start timestamp for timer rendering');
assert(summary.activity.thinkingContent.includes('npm test -- --watch=false'));
assert(summary.activity.task_list, 'expected update_plan task list on activity');
assert.strictEqual(summary.activity.task_list.completed, 1);
assert.strictEqual(summary.activity.task_list.tasks[1].state, 'in_progress');

const liveLikeFixture = path.join(os.tmpdir(), `codex-cli-live-like-${Date.now()}.jsonl`);
const now = Date.now();
const iso = deltaMs => new Date(now + deltaMs).toISOString();
fs.writeFileSync(liveLikeFixture, [
  { timestamp: iso(-300000), type: 'session_meta', payload: { id: '00000000-0000-4000-8000-000000000099', cwd: process.cwd(), model: 'gpt-5.5' } },
  { timestamp: iso(-295000), type: 'event_msg', payload: { type: 'task_started' } },
  { timestamp: iso(-294000), type: 'event_msg', payload: { type: 'thread_goal_updated', goal: { objective: 'Keep proving live Codex CLI fidelity', status: 'active', timeUsedSeconds: 58, tokensUsed: 1234, createdAt: Math.floor((now - 60000) / 1000), updatedAt: Math.floor((now - 1000) / 1000) } } },
  { timestamp: iso(-290000), type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Live task' }] } },
  { timestamp: iso(-280000), type: 'response_item', payload: { type: 'function_call', name: 'update_plan', call_id: 'plan_live', arguments: '{"plan":[{"step":"Do live work","status":"in_progress"}]}' } },
  { timestamp: iso(-279000), type: 'response_item', payload: { type: 'function_call_output', call_id: 'plan_live', output: 'Plan updated' } },
  { timestamp: iso(-270000), type: 'response_item', payload: { type: 'function_call', name: 'shell_command', call_id: 'done_cmd', arguments: '{"command":"echo done"}' } },
  { timestamp: iso(-269000), type: 'response_item', payload: { type: 'function_call_output', call_id: 'done_cmd', output: 'Exit code: 0\nOutput:\ndone\n' } },
  { timestamp: iso(-260000), type: 'response_item', payload: { type: 'reasoning', summary: [] } },
  { timestamp: iso(-250000), type: 'event_msg', payload: { type: 'token_count' } },
].map(entry => JSON.stringify(entry)).join('\n') + '\n');
const liveLikeSummary = codexCli.readSessionSummary(liveLikeFixture);
assert(liveLikeSummary, 'expected live-like summary');
assert.strictEqual(liveLikeSummary.activity.kind, 'generating');
assert.strictEqual(liveLikeSummary.activity.label, 'Working');
assert.strictEqual(liveLikeSummary.activity.thinkingContent, 'Do live work');
assert.strictEqual(liveLikeSummary.activity.interrupt_hint, 'esc to interrupt');
assert(liveLikeSummary.activity.started_at, 'expected active working start timestamp');
assert(liveLikeSummary.activity.goal, 'expected active goal metadata');
assert.strictEqual(liveLikeSummary.activity.goal.label, 'Pursuing goal');
assert.strictEqual(liveLikeSummary.activity.goal.time_used_seconds, 58);
assert.strictEqual(liveLikeSummary.activity.goal.objective, 'Keep proving live Codex CLI fidelity');
assert(!liveLikeSummary.messages.some(msg =>
  msg.content === 'Reasoning'
  && msg.content_blocks?.some(block => block.type === 'thinking' && !String(block.content || '').trim())
), 'empty reasoning summaries should not create placeholder messages');
try { fs.unlinkSync(liveLikeFixture); } catch {}

const sameSecondFixture = path.join(os.tmpdir(), `codex-cli-same-second-task-${Date.now()}.jsonl`);
const sameSecondBase = Math.floor((now - 600000) / 1000) * 1000;
const sameSecondUnix = Math.floor(sameSecondBase / 1000);
const sameSecondCompleteTs = new Date(sameSecondBase + 100).toISOString();
const sameSecondStartTs = new Date(sameSecondBase + 250).toISOString();
fs.writeFileSync(sameSecondFixture, [
  { timestamp: iso(-700000), type: 'session_meta', payload: { id: '00000000-0000-4000-8000-000000000101', cwd: process.cwd(), model: 'gpt-5.5' } },
  { timestamp: sameSecondCompleteTs, type: 'event_msg', payload: { type: 'task_complete', completed_at: sameSecondUnix, duration_ms: 1000 } },
  { timestamp: sameSecondStartTs, type: 'event_msg', payload: { type: 'task_started', started_at: sameSecondUnix } },
  { timestamp: iso(-5000), type: 'response_item', payload: { type: 'function_call', name: 'update_plan', call_id: 'plan_same_second', arguments: '{"plan":[{"step":"Keep live timer anchored","status":"in_progress"}]}' } },
  { timestamp: iso(-4500), type: 'response_item', payload: { type: 'function_call_output', call_id: 'plan_same_second', output: 'Plan updated' } },
  { timestamp: iso(-1000), type: 'event_msg', payload: { type: 'token_count' } },
].map(entry => JSON.stringify(entry)).join('\n') + '\n');
const sameSecondSummary = codexCli.readSessionSummary(sameSecondFixture);
assert.strictEqual(sameSecondSummary.activity.kind, 'generating');
assert.strictEqual(sameSecondSummary.activity.label, 'Working');
assert.strictEqual(sameSecondSummary.activity.thinkingContent, 'Keep live timer anchored');
assert.strictEqual(new Date(sameSecondSummary.activity.started_at).getTime(), new Date(sameSecondStartTs).getTime(), 'same-second task_started must win over prior task_complete timestamp');
try { fs.unlinkSync(sameSecondFixture); } catch {}

const partialFixture = path.join(os.tmpdir(), `codex-cli-partial-line-${Date.now()}.jsonl`);
const partialMeta = { timestamp: iso(-1000), type: 'session_meta', payload: { id: '00000000-0000-4000-8000-000000000100', cwd: process.cwd() } };
const partialFirst = { timestamp: iso(-900), type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Before partial' }] } };
const partialSecond = { timestamp: iso(-800), type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'After partial completes' }] } };
const partialSecondJson = JSON.stringify(partialSecond);
fs.writeFileSync(partialFixture, `${JSON.stringify(partialMeta)}\n${JSON.stringify(partialFirst)}\n${partialSecondJson.slice(0, 40)}`);
const partialBefore = codexCli.readSessionSummary(partialFixture);
assert.strictEqual(partialBefore.messages.length, 1, 'unterminated partial JSONL line should not hydrate yet');
fs.appendFileSync(partialFixture, `${partialSecondJson.slice(40)}\n`);
const partialAfter = codexCli.readSessionSummary(partialFixture);
assert.strictEqual(partialAfter.messages.length, 2, 'completed partial JSONL line should hydrate on the next read');
assert.strictEqual(partialAfter.messages[1].content, 'After partial completes');
try { fs.unlinkSync(partialFixture); } catch {}

const tailSummary = codexCli.readSessionSummary(fixture, { maxHydrateBytes: 100 });
assert(tailSummary, 'expected oversized fixture summary');
assert.strictEqual(tailSummary.hydrateSkippedReason, 'file_too_large_tail');
assert.strictEqual(tailSummary.messagesPartial, true);
assert(tailSummary.messagesHydrated, 'expected oversized transcript to hydrate from tail');
assert(!tailSummary.messages.some(msg => /too large to hydrate automatically/i.test(msg.content || '')));
assert(tailSummary.messages.some(msg => msg.role === 'assistant' && msg.content.includes('Parser smoke complete.')));

console.log(`Codex CLI parser smoke passed (${summary.messages.length} messages, tail=${tailSummary.messages.length})`);
