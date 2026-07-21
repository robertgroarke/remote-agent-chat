'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const codexCli = require('../agent-proxy/codex-cli');

const TURN_COUNT = 120;
const ENCRYPTED_CANARY = 'ENCRYPTED_REASONING_MUST_NEVER_ESCAPE_7c938d49';
const exactSummary = 'Designing process management helpers';
const sessionId = '00000000-0000-4000-8000-000000009901';
const baseMs = Date.parse('2026-07-21T00:00:00.000Z');

function timestamp(turn, sequence) {
  return new Date(baseMs + (turn * 10_000) + sequence).toISOString();
}

function turnRecords(turn) {
  const turnId = `turn-${String(turn).padStart(3, '0')}`;
  const summary = turn % 15 === 0 ? exactSummary : `Native activity summary ${turn % 17}`;
  const answer = `Assistant answer ${turn}`;
  const reasoningEvent = {
    timestamp: timestamp(turn, 30),
    type: 'event_msg',
    payload: { type: 'agent_reasoning', text: summary },
  };
  const reasoningResponse = {
    timestamp: timestamp(turn, 39),
    type: 'response_item',
    payload: {
      id: `reasoning-response-${turn}`,
      type: 'reasoning',
      summary: [{ type: 'summary_text', text: summary }],
      encrypted_content: `${ENCRYPTED_CANARY}-${turn}`,
    },
  };
  const answerEvent = {
    timestamp: timestamp(turn, 80),
    type: 'event_msg',
    payload: { type: 'agent_message', message: answer },
  };
  const answerResponse = {
    timestamp: timestamp(turn, 89),
    type: 'response_item',
    payload: {
      id: `assistant-response-${turn}`,
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: answer }],
    },
  };
  const orderedReasoning = turn % 2 === 0
    ? [reasoningEvent, reasoningResponse]
    : [reasoningResponse, reasoningEvent];
  const orderedAnswer = turn % 3 === 0
    ? [answerEvent, answerResponse]
    : [answerResponse, answerEvent];
  return [
    {
      timestamp: timestamp(turn, 0),
      type: 'turn_context',
      payload: { turn_id: turnId, cwd: 'C:\\fixture\\workspace', model: 'gpt-5.5' },
    },
    { timestamp: timestamp(turn, 5), type: 'event_msg', payload: { type: 'task_started' } },
    {
      timestamp: timestamp(turn, 10),
      type: 'response_item',
      payload: {
        id: `user-${turn}`,
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: `User turn ${turn}` }],
      },
    },
    orderedReasoning[0],
    {
      timestamp: timestamp(turn, 35),
      type: 'event_msg',
      payload: { type: 'token_count', info: { total_token_usage: { total_tokens: turn + 1 } } },
    },
    orderedReasoning[1],
    {
      timestamp: timestamp(turn, 50),
      type: 'response_item',
      payload: {
        type: 'function_call',
        name: 'shell_command',
        call_id: `call-${turn}`,
        arguments: JSON.stringify({ command: `Write-Output turn-${turn}` }),
      },
    },
    {
      timestamp: timestamp(turn, 60),
      type: 'response_item',
      payload: {
        type: 'function_call_output',
        call_id: `call-${turn}`,
        output: `Exit code: 0\nOutput:\nturn-${turn}\n`,
      },
    },
    orderedAnswer[0],
    {
      timestamp: timestamp(turn, 84),
      type: 'event_msg',
      payload: { type: 'token_count', info: { total_token_usage: { total_tokens: turn + 2 } } },
    },
    orderedAnswer[1],
    { timestamp: timestamp(turn, 95), type: 'event_msg', payload: { type: 'task_complete' } },
  ];
}

function encode(records) {
  return `${records.map(record => JSON.stringify(record)).join('\n')}\n`;
}

function reasoningRows(messages) {
  return messages.filter(message => message.content_blocks?.some(block => (
    block.type === 'thinking' && block.activity_summary === true
  )));
}

function assertReasoningContract(messages, label) {
  const rows = reasoningRows(messages);
  assert.strictEqual(rows.length, TURN_COUNT, `${label}: expected one reasoning row per turn`);
  assert.deepStrictEqual(
    rows.map(message => message.native_turn_id),
    Array.from({ length: TURN_COUNT }, (_, turn) => `turn-${String(turn).padStart(3, '0')}`),
    `${label}: reasoning rows must retain turn order and ownership`,
  );
  assert.strictEqual(
    rows.filter(message => message.content_blocks[0].content === exactSummary).length,
    Math.ceil(TURN_COUNT / 15),
    `${label}: identical summaries in different turns must not merge`,
  );
  for (let turn = 0; turn < rows.length; turn += 1) {
    const message = rows[turn];
    const block = message.content_blocks[0];
    assert.strictEqual(message.native_source_kind, 'response_item.reasoning');
    assert.strictEqual(message.native_source_id, `response_item.reasoning:id:reasoning-response-${turn}`);
    assert.strictEqual(message.source_message_id.startsWith('codex_cli:'), true);
    assert.strictEqual(message.native_source_paired, true);
    assert.strictEqual(message.native_sources.length, 2);
    assert.strictEqual(new Set(message.native_sources.map(source => source.kind)).size, 2);
    assert.strictEqual(block.native_source_id, message.native_source_id);
    assert.strictEqual(block.native_turn_id, message.native_turn_id);
    assert.strictEqual(block.lifecycle_generation, turn + 1);
    assert.strictEqual(block.native_source_cursor.start_offset >= 0, true);
    assert.strictEqual(block.native_source_cursor.end_offset > block.native_source_cursor.start_offset, true);
    assert.strictEqual(block.producer_timestamp, message.created_at);
    assert.deepStrictEqual(block.surface_provenance, {
      family: 'codex',
      surface: 'codex_cli',
      source: 'codex_cli_jsonl',
    });
  }
  const serialized = JSON.stringify(messages);
  assert.strictEqual(serialized.includes(ENCRYPTED_CANARY), false, `${label}: encrypted reasoning escaped parser output`);
  return rows;
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-codex-reasoning-'));
const incrementalPath = path.join(tempRoot, 'incremental.jsonl');
const replayPath = path.join(tempRoot, 'replay.jsonl');

try {
  const meta = {
    timestamp: new Date(baseMs - 1000).toISOString(),
    type: 'session_meta',
    payload: { id: sessionId, cwd: 'C:\\fixture\\workspace', model: 'gpt-5.5' },
  };
  const firstHalf = [meta];
  const secondHalf = [];
  for (let turn = 0; turn < TURN_COUNT; turn += 1) {
    (turn < TURN_COUNT / 2 ? firstHalf : secondHalf).push(...turnRecords(turn));
  }
  const allRecords = [...firstHalf, ...secondHalf];
  assert(allRecords.length >= 1000, 'fixture must replay at least 1,000 mixed records');

  fs.writeFileSync(incrementalPath, encode(firstHalf));
  const beforeAppend = codexCli.readSessionSummary(incrementalPath);
  assert.strictEqual(reasoningRows(beforeAppend.messages).length, TURN_COUNT / 2);
  fs.appendFileSync(incrementalPath, encode(secondHalf));
  const afterAppend = codexCli.readSessionSummary(incrementalPath);
  const incrementalRows = assertReasoningContract(afterAppend.messages, 'incremental append');
  assert.strictEqual(afterAppend.sourceCursor.mode, 'append');

  fs.writeFileSync(replayPath, encode(allRecords));
  const replayMessages = codexCli.parseCodexJsonl(replayPath);
  const replayRows = assertReasoningContract(replayMessages, 'full replay');
  assert.deepStrictEqual(
    replayRows.map(message => message.source_message_id),
    incrementalRows.map(message => message.source_message_id),
    'stable native reasoning IDs must survive reconnect/replay path rotation',
  );

  const chunk = codexCli.parseCodexJsonlChunk(replayPath, {
    chunkBytes: 16 * 1024 * 1024,
    maxChunkBytes: 16 * 1024 * 1024,
  });
  assert.strictEqual(chunk.eventsRead, allRecords.length);
  assert.strictEqual(chunk.state.pendingToolCalls.size, 0, 'pending tool-call map must return to baseline');
  assert.strictEqual(chunk.state.messages.filter(message => message.content.startsWith('Assistant answer ')).length, TURN_COUNT);
  assert.strictEqual(chunk.state.messages.filter(message => message.content.startsWith('[Tool: shell_command]')).length, TURN_COUNT);
  assert.strictEqual(chunk.state.messages.filter(message => message.content.startsWith('[Tool result: shell_command]')).length, TURN_COUNT);
  assert.strictEqual(JSON.stringify(chunk.state.messages).includes(ENCRYPTED_CANARY), false);

  console.log(JSON.stringify({
    ok: true,
    records: allRecords.length,
    turns: TURN_COUNT,
    reasoning_rows: replayRows.length,
    exact_repeated_rows: replayRows.filter(message => message.content_blocks[0].content === exactSummary).length,
    cross_turn_merges: 0,
    encrypted_bytes_exposed: 0,
    pending_tool_calls: chunk.state.pendingToolCalls.size,
  }));
} finally {
  for (const filePath of [incrementalPath, replayPath]) {
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}
  }
  try { fs.rmdirSync(tempRoot); } catch {}
}
