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
  codexCli.CODEX_CLI_ACTIVE_HYDRATE_MAX_BYTES >= 16 * 1024 * 1024,
  'active Codex CLI hydration should remain separately tunable when archive hydration is capped low'
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
  block.type === 'tool_result'
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
assert(summary.messages.some(msg => (
  msg.role === 'assistant'
  && msg.content.includes('Parser smoke complete.')
  && msg.content_blocks?.some(block => block.type === 'markdown' && block.content === msg.content)
)), 'event_msg agent_message answers must emit a canonical markdown block');
assert(summary.activity, 'expected active Codex CLI activity');
assert.strictEqual(summary.activity.kind, 'running_command');
assert.strictEqual(summary.activity.label, 'Working');
assert(summary.activity.started_at, 'expected activity start timestamp for timer rendering');
assert(summary.activity.thinkingContent.includes('npm test -- --watch=false'));
assert.strictEqual(summary.activity.current.kind, 'tool');
assert.strictEqual(summary.activity.current.label, 'Running command');
assert(summary.activity.current.partial.includes('npm test -- --watch=false'));
assert.strictEqual(summary.activity.thinking.text, 'Preparing to run the active command.');
assert(!summary.activity.thinking.text.includes('npm test -- --watch=false'), 'a running command must not be mislabeled as current reasoning');
assert(summary.activity.task_list, 'expected update_plan task list on activity');
assert.strictEqual(summary.activity.task_list.completed, 1);
assert.strictEqual(summary.activity.task_list.tasks[1].state, 'in_progress');
assert.strictEqual(summary.activity.step.current, 2);
assert.strictEqual(summary.activity.step.total, 3);
assert.strictEqual(summary.activity.step.state, 'in_progress');

const liveLikeFixture = path.join(os.tmpdir(), `codex-cli-live-like-${Date.now()}.jsonl`);
const now = Date.now();
const iso = deltaMs => new Date(now + deltaMs).toISOString();
fs.writeFileSync(liveLikeFixture, [
  { timestamp: iso(-300000), type: 'session_meta', payload: { id: '00000000-0000-4000-8000-000000000099', cwd: process.cwd(), model: 'gpt-5.5' } },
  { timestamp: iso(-299500), type: 'response_item', payload: { type: 'message', role: 'user', content: [
    { type: 'input_text', text: '<recommended_plugins>\nPrivate injected plugin catalog\n</recommended_plugins>' },
    { type: 'input_text', text: `<environment_context>\n<cwd>${process.cwd()}</cwd>\n</environment_context>` },
  ] } },
  { timestamp: iso(-299400), type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<codex_internal_context source="goal">\n<objective>Hidden objective transport</objective>\n</codex_internal_context>' }] } },
  { timestamp: iso(-299300), type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<goal_context>\n<objective>Legacy hidden objective transport</objective>\n</goal_context>' }] } },
  { timestamp: iso(-299100), type: 'event_msg', payload: { type: 'turn_aborted', reason: 'interrupted', duration_ms: 15494 } },
  { timestamp: iso(-299000), type: 'turn_context', payload: { cwd: process.cwd(), model: 'gpt-5.5', effort: 'high', sandbox_policy: { type: 'danger-full-access' }, approval_policy: 'never' } },
  { timestamp: iso(-295000), type: 'event_msg', payload: { type: 'task_started' } },
  { timestamp: iso(-294500), type: 'event_msg', payload: { type: 'thread_name_updated', thread_name: 'Codex CLI fidelity smoke' } },
  { timestamp: iso(-294000), type: 'event_msg', payload: { type: 'thread_goal_updated', goal: { objective: 'Keep proving live Codex CLI fidelity', status: 'active', timeUsedSeconds: 58, tokensUsed: 1234, createdAt: Math.floor((now - 60000) / 1000), updatedAt: Math.floor((now - 1000) / 1000) } } },
  { timestamp: iso(-290000), type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Live task' }] } },
  { timestamp: iso(-280000), type: 'response_item', payload: { type: 'function_call', name: 'update_plan', call_id: 'plan_live', arguments: '{"plan":[{"step":"Do live work","status":"in_progress"}]}' } },
  { timestamp: iso(-279000), type: 'response_item', payload: { type: 'function_call_output', call_id: 'plan_live', output: 'Plan updated' } },
  { timestamp: iso(-270000), type: 'response_item', payload: { type: 'function_call', name: 'shell_command', call_id: 'done_cmd', arguments: '{"command":"echo done"}' } },
  { timestamp: iso(-269000), type: 'response_item', payload: { type: 'function_call_output', call_id: 'done_cmd', output: 'Exit code: 0\nOutput:\ndone\n' } },
  { timestamp: iso(-268000), type: 'event_msg', payload: { type: 'exec_command_end', command: ['powershell.exe', '-Command', 'Write-Output done'], cwd: process.cwd(), aggregated_output: 'done\n', exit_code: 0 } },
  { timestamp: iso(-260000), type: 'response_item', payload: { type: 'reasoning', summary: [] } },
  { timestamp: iso(-240000), type: 'event_msg', payload: { type: 'agent_reasoning', text: 'I am checking the live parser path.' } },
  { timestamp: iso(-230000), type: 'response_item', payload: { type: 'web_search_call', status: 'completed', action: { type: 'search', query: 'Remote Agent Chat Codex CLI fidelity' } } },
  { timestamp: iso(-229000), type: 'event_msg', payload: { type: 'web_search_end', call_id: 'ws_live', query: 'Remote Agent Chat Codex CLI fidelity' } },
  { timestamp: iso(-220000), type: 'response_item', payload: { type: 'tool_search_call', call_id: 'tool_search_live', status: 'completed', arguments: { query: 'browser automation', limit: 2 } } },
  { timestamp: iso(-219000), type: 'response_item', payload: { type: 'tool_search_output', call_id: 'tool_search_live', status: 'completed', tools: [{ name: 'codex_app', tools: [{ name: 'read_thread_terminal' }] }] } },
  { timestamp: iso(-210000), type: 'event_msg', payload: { type: 'mcp_tool_call_end', call_id: 'mcp_live', invocation: { server: 'codex_app', tool: 'read_thread_terminal', arguments: {} }, result: { Ok: { content: [{ type: 'text', text: 'terminal output' }], structuredContent: { ok: true } } } } },
  { timestamp: iso(-205000), type: 'event_msg', payload: { type: 'view_image_tool_call', path: path.join(process.cwd(), 'screenshot.png') } },
  { timestamp: iso(-202000), type: 'event_msg', payload: { type: 'patch_apply_end', success: true, stdout: 'Success. Updated the following files:\\nM agent-proxy/codex-cli.js\\n', changes: { [path.join(process.cwd(), 'agent-proxy', 'codex-cli.js')]: { type: 'update', unified_diff: '@@ -1 +1\\n-old\\n+new\\n' } } } },
  { timestamp: iso(-201000), type: 'event_msg', payload: { type: 'error', message: 'Remote compact task failed', codex_error_info: 'other' } },
  { timestamp: iso(-200000), type: 'event_msg', payload: { type: 'context_compacted' } },
  { timestamp: iso(-198000), type: 'event_msg', payload: { type: 'thread_rolled_back', num_turns: 1 } },
  { timestamp: iso(-195000), type: 'compacted', payload: { message: 'Replaced earlier context with a summary.' } },
  { timestamp: iso(-190000), type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { total_tokens: 42 } }, rate_limits: { primary: { used_percent: 12, resets_at: Math.floor((now + 600000) / 1000) }, secondary: { used_percent: 34, resets_at: Math.floor((now + 3600000) / 1000) }, rate_limit_reached_type: null } } },
].map(entry => JSON.stringify(entry)).join('\n') + '\n');
const liveLikeSummary = codexCli.readSessionSummary(liveLikeFixture);
assert(liveLikeSummary, 'expected live-like summary');
assert.strictEqual(liveLikeSummary.title, 'Codex CLI fidelity smoke');
assert.strictEqual(liveLikeSummary.effort, 'high');
assert.strictEqual(liveLikeSummary.permission_mode, 'danger-full-access');
assert.strictEqual(liveLikeSummary.approval_policy, 'never');
assert.strictEqual(liveLikeSummary.percent_used, 34);
assert.strictEqual(liveLikeSummary.rate_limit_active, false);
assert.strictEqual(liveLikeSummary.token_usage.total_tokens, 42);
assert(!liveLikeSummary.messages.some(msg => /recommended_plugins|environment_context|codex_internal_context|goal_context/.test(msg.content || '')), 'injected Codex context must not render as user transcript');
assert(liveLikeSummary.messages.some(msg => msg.role === 'user' && msg.content === 'Live task'), 'real post-context user turn must remain');
assert(!liveLikeSummary.messages.some(msg => msg.content_blocks?.some(block => block.collapsed === true)), 'all Codex CLI structured blocks must be expanded by default');
const liveLikeLightweight = codexCli.readSessionSummary(liveLikeFixture, { includeMessages: false });
assert.strictEqual(liveLikeLightweight.title, 'Codex CLI fidelity smoke');
assert.strictEqual(liveLikeLightweight.effort, 'high');
assert.strictEqual(liveLikeLightweight.permission_mode, 'danger-full-access');
assert.strictEqual(liveLikeLightweight.approval_policy, 'never');
assert.strictEqual(liveLikeSummary.activity.kind, 'thinking');
assert.strictEqual(liveLikeSummary.activity.label, 'Working');
assert.strictEqual(liveLikeSummary.activity.thinkingContent, 'I am checking the live parser path.');
assert.strictEqual(liveLikeSummary.activity.thinking.text, 'I am checking the live parser path.');
assert(!liveLikeSummary.activity.current, 'a reasoning-only phase must not expose plan text as current output');
assert.strictEqual(liveLikeSummary.activity.interrupt_hint, 'esc to interrupt');
assert(liveLikeSummary.activity.started_at, 'expected active working start timestamp');
assert(liveLikeSummary.activity.goal, 'expected active goal metadata');
assert.strictEqual(liveLikeSummary.activity.goal.label, 'Pursuing goal');
assert.strictEqual(liveLikeSummary.activity.goal.text, 'Keep proving live Codex CLI fidelity');
assert.strictEqual(liveLikeSummary.activity.goal.state, 'active');
assert.strictEqual(liveLikeSummary.activity.goal.time_used_seconds, 58);
assert.strictEqual(liveLikeSummary.activity.goal.objective, 'Keep proving live Codex CLI fidelity');
assert(liveLikeSummary.messages.some(msg => msg.content_blocks?.some(block =>
  block.type === 'notice'
  && block.title === 'Goal updated'
  && block.content.includes('Keep proving live Codex CLI fidelity')
)), 'expected /goal updates to render into transcript blocks');
assert(liveLikeSummary.messages.some(msg => msg.content_blocks?.some(block =>
  block.type === 'thinking'
  && block.content.includes('checking the live parser path')
)), 'expected event_msg agent_reasoning to render as thinking');
assert(liveLikeSummary.messages.some(msg => msg.content_blocks?.some(block =>
  block.type === 'tool_call'
  && block.title === 'Tool: web_search'
  && block.content.includes('Remote Agent Chat Codex CLI fidelity')
)), 'expected web_search_call to render as a tool block');
assert(liveLikeSummary.messages.some(msg => msg.content_blocks?.some(block =>
  block.type === 'tool_result'
  && block.title === 'Tool result: web_search'
  && block.content.includes('ws_live')
)), 'expected web_search_end to render as a tool result');
assert(liveLikeSummary.messages.some(msg => msg.content_blocks?.some(block =>
  block.type === 'terminal'
  && block.command.includes('powershell.exe')
  && block.command.includes('"Write-Output done"')
  && block.workdir === process.cwd()
  && block.stdout.includes('done')
)), 'expected argv command and aggregated output terminal events to render faithfully');
assert(liveLikeSummary.messages.some(msg => msg.content_blocks?.some(block =>
  block.type === 'tool_call'
  && block.title === 'Tool: tool_search'
  && block.content.includes('browser automation')
)), 'expected tool_search_call to render as a tool block');
assert(liveLikeSummary.messages.some(msg => msg.content_blocks?.some(block =>
  block.type === 'tool_result'
  && block.title === 'Tool result: tool_search'
  && block.content.includes('codex_app.read_thread_terminal')
)), 'expected tool_search_output to render matched tool names');
assert(liveLikeSummary.messages.some(msg => msg.content_blocks?.some(block =>
  block.type === 'tool_result'
  && block.title === 'Tool result: codex_app.read_thread_terminal'
  && block.content.includes('structuredContent')
  && block.content.includes('terminal output')
)), 'expected MCP tool result to include invocation and result body');
assert(liveLikeSummary.messages.some(msg => msg.content_blocks?.some(block =>
  block.type === 'artifact'
  && block.title === 'Image viewed'
  && block.content.includes('screenshot.png')
)), 'expected viewed images to render into transcript blocks');
assert(liveLikeSummary.messages.some(msg => msg.content_blocks?.some(block =>
  block.type === 'file_changes'
  && block.collapsed === false
  && block.files?.[0]?.path.endsWith(path.join('agent-proxy', 'codex-cli.js'))
  && block.content.includes('```diff')
)), 'expected object-shaped patch changes to render as expanded file-change diffs');
assert(liveLikeSummary.messages.some(msg => msg.content_blocks?.some(block =>
  block.type === 'error'
  && block.title === 'Error: other'
  && block.content.includes('Remote compact task failed')
)), 'expected Codex CLI error events to render explicitly');
assert(liveLikeSummary.messages.some(msg => msg.content_blocks?.some(block =>
  block.type === 'notice'
  && block.title === 'Context compacted'
)), 'expected context compaction to render into transcript blocks');
assert(liveLikeSummary.messages.some(msg => msg.content_blocks?.some(block =>
  block.type === 'notice'
  && block.title === 'Thread rolled back'
  && block.content.includes('Rolled back 1 turn')
)), 'expected thread rollback event to render explicitly');
assert(liveLikeSummary.messages.some(msg => msg.content_blocks?.some(block =>
  block.type === 'status'
  && block.label === 'Interrupted'
  && block.content === 'Interrupted'
  && block.status === 'stopped'
)), 'expected native interrupted turns to render as canonical stopped status blocks');
assert(!liveLikeSummary.messages.some(msg =>
  msg.content === 'Reasoning'
  && msg.content_blocks?.some(block => block.type === 'thinking' && !String(block.content || '').trim())
), 'empty reasoning summaries should not create placeholder messages');
try { fs.unlinkSync(liveLikeFixture); } catch {}

const canonicalCliId = '00000000-0000-4000-8000-000000000201';
const staleMetaId = '00000000-0000-4000-8000-000000000202';
const canonicalIdFixture = path.join(os.tmpdir(), `rollout-2026-07-09T10-07-34-${canonicalCliId}.jsonl`);
fs.writeFileSync(canonicalIdFixture, [
  { timestamp: iso(-1000), type: 'session_meta', payload: { id: staleMetaId, cwd: process.cwd(), model: 'gpt-5.5' } },
  { timestamp: iso(-900), type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Canonical id check' }] } },
  { timestamp: iso(-800), type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Canonical id confirmed.' }] } },
].map(entry => JSON.stringify(entry)).join('\n') + '\n');
assert.strictEqual(codexCli.readSessionSummary(canonicalIdFixture).cliSessionId, canonicalCliId);
assert(codexCli.readSessionSummary(canonicalIdFixture).messages.some(msg => (
  msg.role === 'assistant'
  && msg.content === 'Canonical id confirmed.'
  && msg.content_blocks?.some(block => block.type === 'markdown' && block.content === msg.content)
)), 'response_item assistant answers must emit a canonical markdown block');
assert.strictEqual(codexCli.readSessionSummary(canonicalIdFixture, { includeMessages: false }).cliSessionId, canonicalCliId);
assert.strictEqual(codexCli.readSessionSummary(canonicalIdFixture, { maxHydrateBytes: 1 }).cliSessionId, canonicalCliId);
assert.strictEqual(codexCli.parseCodexJsonlChunk(canonicalIdFixture, { chunkBytes: 256 * 1024 }).state.cliSessionId, canonicalCliId);
try { fs.unlinkSync(canonicalIdFixture); } catch {}

const metadataOnlyCliId = '00000000-0000-4000-8000-000000000203';
const metadataOnlyFixture = path.join(os.tmpdir(), `codex-cli-metadata-session-${Date.now()}.jsonl`);
fs.writeFileSync(metadataOnlyFixture, [
  { timestamp: iso(-1000), type: 'session_meta', payload: { session_id: metadataOnlyCliId, id: staleMetaId, cwd: process.cwd(), model: 'gpt-5.5' } },
  { timestamp: iso(-900), type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Metadata id check' }] } },
].map(entry => JSON.stringify(entry)).join('\n') + '\n');
assert.strictEqual(codexCli.readSessionSummary(metadataOnlyFixture).cliSessionId, metadataOnlyCliId);
assert.strictEqual(codexCli.readSessionSummary(metadataOnlyFixture, { includeMessages: false }).cliSessionId, metadataOnlyCliId);
try { fs.unlinkSync(metadataOnlyFixture); } catch {}

const workspaceInferRoot = fs.mkdtempSync(path.join(os.tmpdir(), `codex-cli-workspace-infer-${Date.now()}-`));
const inferredParentRepo = path.join(workspaceInferRoot, 'Parent Repo');
const inferredTargetRepo = path.join(workspaceInferRoot, 'Target Repo');
fs.mkdirSync(path.join(inferredParentRepo, '.git'), { recursive: true });
fs.mkdirSync(path.join(inferredTargetRepo, '.git'), { recursive: true });
fs.writeFileSync(path.join(inferredParentRepo, 'AGENTS.md'), 'registry rules\n');
const workspaceInferFixture = path.join(os.tmpdir(), `codex-cli-workspace-infer-${Date.now()}.jsonl`);
fs.writeFileSync(workspaceInferFixture, [
  {
    timestamp: iso(-10000),
    type: 'session_meta',
    payload: {
      id: '00000000-0000-4000-8000-000000000102',
      cwd: os.homedir(),
      model: 'gpt-5.5',
    },
  },
  {
    timestamp: iso(-9000),
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'user',
      content: [{
        type: 'input_text',
        text: [
          `/goal Improve tooling targeting ${inferredTargetRepo}.`,
          'Read first:',
          `- ${path.join(inferredParentRepo, 'AGENTS.md')} (registry rules)`,
          `Constraints: Work in the parent repo only (${inferredParentRepo}).`,
          `Do NOT modify ${path.join(inferredTargetRepo, '.git', 'hooks', 'pre-commit')} except by installing a hook.`,
        ].join('\n'),
      }],
    },
  },
].map(entry => JSON.stringify(entry)).join('\n') + '\n');
const workspaceInferSummary = codexCli.readSessionSummary(workspaceInferFixture);
assert.strictEqual(workspaceInferSummary.workspacePath, inferredParentRepo);
assert.strictEqual(workspaceInferSummary.workspaceName, path.basename(inferredParentRepo));
try { fs.unlinkSync(workspaceInferFixture); } catch {}
try { fs.rmSync(workspaceInferRoot, { recursive: true, force: true }); } catch {}

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
assert(!sameSecondSummary.activity.thinkingContent, 'plan text must not masquerade as reasoning or current output');
assert(!sameSecondSummary.activity.thinking);
assert(!sameSecondSummary.activity.current);
assert.strictEqual(sameSecondSummary.activity.task_list.tasks[0].text, 'Keep live timer anchored');
assert.strictEqual(new Date(sameSecondSummary.activity.started_at).getTime(), new Date(sameSecondStartTs).getTime(), 'same-second task_started must win over prior task_complete timestamp');
try { fs.unlinkSync(sameSecondFixture); } catch {}

const completedWithoutAssistantFixture = path.join(os.tmpdir(), `codex-cli-complete-no-assistant-${Date.now()}.jsonl`);
const completedWithoutAssistantBase = now - 120000;
fs.writeFileSync(completedWithoutAssistantFixture, [
  { timestamp: new Date(completedWithoutAssistantBase).toISOString(), type: 'session_meta', payload: { id: '00000000-0000-4000-8000-000000000104', cwd: process.cwd(), model: 'gpt-5.6-sol' } },
  { timestamp: new Date(completedWithoutAssistantBase + 1000).toISOString(), type: 'event_msg', payload: { type: 'task_started', started_at: Math.floor((completedWithoutAssistantBase + 1000) / 1000) } },
  { timestamp: new Date(completedWithoutAssistantBase + 1500).toISOString(), type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'A request that receives no assistant row' }] } },
  { timestamp: new Date(completedWithoutAssistantBase + 2000).toISOString(), type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: {} }, rate_limits: { limit_id: 'premium', credits: { has_credits: false, balance: '0' } } } },
  { timestamp: new Date(completedWithoutAssistantBase + 2500).toISOString(), type: 'event_msg', payload: { type: 'task_complete', completed_at: Math.floor((completedWithoutAssistantBase + 2500) / 1000), last_agent_message: null } },
].map(entry => JSON.stringify(entry)).join('\n') + '\n');
const completedWithoutAssistantSummary = codexCli.readSessionSummary(completedWithoutAssistantFixture);
assert.strictEqual(completedWithoutAssistantSummary.activity, null, 'task_complete without an assistant row must clear generating activity');
assert.strictEqual(completedWithoutAssistantSummary.messages.length, 1);
assert.strictEqual(completedWithoutAssistantSummary.messages[0].role, 'user');
try { fs.unlinkSync(completedWithoutAssistantFixture); } catch {}

const usageFixture = path.join(os.tmpdir(), `codex-cli-usage-${Date.now()}.jsonl`);
const usageReset = Math.floor((now + 3600000) / 1000);
fs.writeFileSync(usageFixture, [
  { timestamp: iso(-2000), type: 'session_meta', payload: { id: '00000000-0000-4000-8000-000000000105', cwd: process.cwd() } },
  { timestamp: iso(-1000), type: 'event_msg', payload: { type: 'token_count', rate_limits: { primary: { used_percent: 100, resets_at: usageReset }, rate_limit_reached_type: 'primary' } } },
].map(entry => JSON.stringify(entry)).join('\n') + '\n');
const usageSummary = codexCli.readSessionSummary(usageFixture);
assert.strictEqual(usageSummary.activity.kind, 'idle');
assert.strictEqual(usageSummary.activity.usage.state, 'exhausted');
assert.match(usageSummary.activity.usage.title, /out of Codex and Work usage/);
assert.strictEqual(usageSummary.activity.usage.resets_at, new Date(usageReset * 1000).toISOString());
try { fs.unlinkSync(usageFixture); } catch {}

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

const largeGoalFixture = path.join(os.tmpdir(), `codex-cli-large-goal-${Date.now()}.jsonl`);
const largeGoalEntries = [
  { timestamp: iso(-5000), type: 'session_meta', payload: { id: '00000000-0000-4000-8000-000000000104', cwd: process.cwd(), model: 'gpt-5.5' } },
  { timestamp: iso(-4900), type: 'event_msg', payload: { type: 'thread_goal_updated', goal: { objective: 'Recover the durable large-archive goal', status: 'active', timeUsedSeconds: 142200, createdAt: Math.floor((now - 142200000) / 1000), updatedAt: Math.floor((now - 5000) / 1000) } } },
  { timestamp: iso(-4800), type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: `noise mentioning thread_goal_updated ${'x'.repeat(5 * 1024 * 1024)}` }] } },
  { timestamp: iso(-1000), type: 'event_msg', payload: { type: 'task_started', started_at: Math.floor((now - 1000) / 1000) } },
  { timestamp: iso(-500), type: 'event_msg', payload: { type: 'agent_reasoning', text: 'Reasoning remains separate from current output.' } },
];
fs.writeFileSync(largeGoalFixture, largeGoalEntries.map(entry => JSON.stringify(entry)).join('\n') + '\n');
const largeGoalSummary = codexCli.readSessionSummary(largeGoalFixture, { maxHydrateBytes: 100 });
assert.strictEqual(largeGoalSummary.messagesPartial, true);
assert.strictEqual(largeGoalSummary.activity.goal.text, 'Recover the durable large-archive goal');
assert.strictEqual(largeGoalSummary.activity.goal.time_used_seconds, 142200);
assert.strictEqual(largeGoalSummary.activity.thinking.text, 'Reasoning remains separate from current output.');
assert(!largeGoalSummary.activity.current);
const appendedGoal = {
  timestamp: iso(-300),
  type: 'event_msg',
  payload: {
    type: 'thread_goal_updated',
    goal: {
      objective: 'Observe appended durable goal updates',
      status: 'active',
      timeUsedSeconds: 142500,
      createdAt: Math.floor((now - 142500000) / 1000),
      updatedAt: Math.floor((now - 300) / 1000),
    },
  },
};
const appendedGoalNoise = {
  timestamp: iso(-200),
  type: 'response_item',
  payload: {
    type: 'message',
    role: 'user',
    content: [{ type: 'input_text', text: `later tail noise ${'y'.repeat(5 * 1024 * 1024)}` }],
  },
};
fs.appendFileSync(largeGoalFixture, `${JSON.stringify(appendedGoal)}\n${JSON.stringify(appendedGoalNoise)}\n`);
const appendedGoalSummary = codexCli.readSessionSummary(largeGoalFixture, { maxHydrateBytes: 100 });
assert.strictEqual(
  appendedGoalSummary.activity.goal.text,
  'Observe appended durable goal updates',
  'large-archive goal recovery cache must inspect appended events',
);
assert.strictEqual(appendedGoalSummary.activity.goal.time_used_seconds, 142500);
try { fs.unlinkSync(largeGoalFixture); } catch {}

const chunkFixture = path.join(os.tmpdir(), `codex-cli-history-chunk-${Date.now()}.jsonl`);
const chunkEntries = [
  { timestamp: iso(-800000), type: 'session_meta', payload: { id: '00000000-0000-4000-8000-000000000103', cwd: process.cwd(), model: 'gpt-5.5' } },
];
for (let i = 0; i < 240; i++) {
  chunkEntries.push({
    timestamp: iso(-700000 + i),
    type: 'response_item',
    payload: {
      id: `chunk-message-${i}`,
      type: 'message',
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: [{ type: i % 2 === 0 ? 'input_text' : 'output_text', text: `Chunk message ${i} ${'x'.repeat(6000)}` }],
    },
  });
}
fs.writeFileSync(chunkFixture, chunkEntries.map(entry => JSON.stringify(entry)).join('\n') + '\n');
const tailChunk = codexCli.parseCodexJsonlChunk(chunkFixture, { chunkBytes: 256 * 1024 });
assert(tailChunk, 'expected tail chunk');
assert(tailChunk.nextBeforeOffset, 'expected tail chunk to expose an older cursor');
assert(tailChunk.state.messages.some(msg => msg.content.includes('Chunk message 239')), 'tail chunk should contain the newest message');
const adaptiveTailChunk = codexCli.parseCodexJsonlChunk(chunkFixture, {
  chunkBytes: 256 * 1024,
  minimumMessages: 160,
});
assert(adaptiveTailChunk.state.messages.length >= 160, 'adaptive chunk should satisfy the requested semantic row count');
assert(adaptiveTailChunk.bytesRead > 256 * 1024, 'adaptive chunk should expand beyond the undersized initial byte window');
assert.strictEqual(adaptiveTailChunk.messageStartOffsets.length, adaptiveTailChunk.state.messages.length);
assert(adaptiveTailChunk.state.messages.every(message => message.native_source_id), 'chunk rows should retain stable native source identity');
const olderChunk = codexCli.parseCodexJsonlChunk(chunkFixture, {
  beforeOffset: tailChunk.nextBeforeOffset,
  chunkBytes: 256 * 1024,
});
assert(olderChunk, 'expected older chunk');
assert.strictEqual(olderChunk.endOffset, tailChunk.nextBeforeOffset, 'older chunk should end at the prior cursor');
assert(olderChunk.state.messages.length > 0, 'older chunk should contain messages');
assert(!olderChunk.state.messages.some(msg => msg.content.includes('Chunk message 239')), 'older chunk should not overlap the newest tail');
try { fs.unlinkSync(chunkFixture); } catch {}

const pairedMessageFixture = path.join(os.tmpdir(), `codex-cli-paired-message-${Date.now()}.jsonl`);
fs.writeFileSync(pairedMessageFixture, [
  { timestamp: iso(-4000), type: 'session_meta', payload: { id: '00000000-0000-4000-8000-000000000204', cwd: process.cwd(), model: 'gpt-5.5' } },
  { timestamp: iso(-3000), type: 'response_item', payload: { id: 'assistant-answer-a', type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'An intentionally identical answer.' }] } },
  { timestamp: iso(-2999), type: 'event_msg', payload: { type: 'agent_message', message: 'An intentionally identical answer.' } },
  { timestamp: iso(-2000), type: 'response_item', payload: { id: 'assistant-answer-b', type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'An intentionally identical answer.' }] } },
  { timestamp: iso(-1999), type: 'event_msg', payload: { type: 'agent_message', message: 'An intentionally identical answer.' } },
].map(entry => JSON.stringify(entry)).join('\n') + '\n');
const pairedSummary = codexCli.readSessionSummary(pairedMessageFixture);
const pairedAnswers = pairedSummary.messages.filter(message => message.content === 'An intentionally identical answer.');
assert.strictEqual(pairedAnswers.length, 2, 'paired Codex events must render once while distinct identical answers remain distinct');
assert.deepStrictEqual(
  pairedAnswers.map(message => message.native_source_id),
  ['response_item.message:id:assistant-answer-a', 'response_item.message:id:assistant-answer-b'],
);
try { fs.unlinkSync(pairedMessageFixture); } catch {}

console.log(`Codex CLI parser smoke passed (${summary.messages.length} messages, tail=${tailSummary.messages.length})`);
