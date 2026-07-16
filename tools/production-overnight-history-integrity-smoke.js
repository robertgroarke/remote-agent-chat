#!/usr/bin/env node
'use strict';

const assert = require('assert');
const runner = require('./production-harness-overnight-soak');

const first = runner.exactToken('20260712074833', 1, 'cursor');
const second = runner.exactToken('20260712074833', 2, 'cursor');
const third = runner.exactToken('20260712074833', 3, 'cursor');

const history = {
  messages: [
    { role: 'user', content: third },
    { role: 'assistant', content: first },
    { role: 'assistant', content: `prefix ${second} suffix` },
  ],
};

assert.deepStrictEqual(
  runner.missingAssistantHistoryTokens(history, [first, second]),
  [],
  'every prior assistant-role token must remain durable',
);
assert.deepStrictEqual(
  runner.missingAssistantHistoryTokens(history, [first, second, third]),
  [third],
  'a user-role echo must not satisfy the cross-cycle durability gate',
);
assert.deepStrictEqual(
  runner.missingAssistantHistoryTokens({ messages: [] }, [first, second]),
  [first, second],
  'an authoritative empty history must fail every prior-cycle token',
);

async function main() {
  const selected = Object.fromEntries(runner.PRODUCTION_TYPES.map(type => [type, {
    session_id: `session-${type}`,
  }]));
  const typeBySession = Object.fromEntries(runner.PRODUCTION_TYPES.map(type => [`session-${type}`, type]));
  const omitted = new Set();
  const relay = {
    events: [],
    ws: {
      readyState: 1,
      send(raw) {
        const request = JSON.parse(raw);
        const type = typeBySession[request.session_id];
        const tokens = [1, 2]
          .map(cycle => runner.exactToken('20260712074833', cycle, type))
          .filter(token => !omitted.has(`${type}:${token}`));
        relay.events.push({
          type: 'history_chunk',
          request_id: request.request_id,
          session_id: request.session_id,
          total_messages: tokens.length,
          messages: tokens.map(content => ({ role: 'assistant', content })),
        });
      },
    },
  };

  const summaries = await runner.assertDurableCycleHistory(relay, selected, '20260712074833', 2);
  assert.strictEqual(summaries.length, runner.PRODUCTION_TYPES.length);
  assert(summaries.every(summary => summary.verified_tokens === 2));

  const missingCursorToken = runner.exactToken('20260712074833', 2, 'cursor');
  omitted.add(`cursor:${missingCursorToken}`);
  await assert.rejects(
    () => runner.assertDurableCycleHistory(relay, selected, '20260712074833', 2),
    /cursor relay history lost 1\/2 prior assistant tokens/,
  );

  console.log(JSON.stringify({
    ok: true,
    cross_cycle_assistant_tokens_required: true,
    user_echo_rejected: true,
    empty_history_rejected: true,
    all_production_sessions_checked: true,
    async_history_request_path_checked: true,
  }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
