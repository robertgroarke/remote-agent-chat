#!/usr/bin/env node
'use strict';

const assert = require('assert');
const proto = require('../agent-proxy/protocol');
const {
  shouldImmediatelyStreamCursorAssistant,
  shouldImmediatelyStreamAntigravityV2Assistant,
  shouldBypassHistoryBulkQueue,
  shouldSendStablePendingMessage,
} = require('../agent-proxy/proxy-engine');

assert.strictEqual(
  shouldImmediatelyStreamCursorAssistant(
    { role: 'assistant', content: '' },
    { role: 'assistant', content: 'RAC_E2E_CURSOR_TOKEN' },
  ),
  true,
  'Cursor must stream the first non-empty assistant mutation without waiting for a second poll',
);
assert.strictEqual(
  shouldImmediatelyStreamCursorAssistant(
    { role: 'assistant', content: 'partial' },
    { role: 'assistant', content: 'partial' },
  ),
  false,
  'unchanged assistant content must not rebroadcast',
);
assert.strictEqual(
  shouldImmediatelyStreamCursorAssistant(
    { role: 'user', content: 'prompt' },
    { role: 'assistant', content: 'answer' },
  ),
  false,
  'role transitions continue through the normal pending-message path',
);
assert.strictEqual(
  shouldImmediatelyStreamCursorAssistant(
    { role: 'assistant', content: 'partial' },
    { role: 'assistant', content: '' },
  ),
  false,
  'empty intermediate shells must not be streamed',
);

assert.strictEqual(
  shouldImmediatelyStreamAntigravityV2Assistant(
    null,
    { role: 'assistant', content: 'RAC_E2E_ANTIGRAVITY_V2_TOKEN' },
  ),
  true,
  'Antigravity v2 must stream the first non-empty assistant tail without waiting for stability',
);
assert.strictEqual(
  shouldImmediatelyStreamAntigravityV2Assistant(
    { role: 'assistant', content: 'partial' },
    { role: 'assistant', content: 'complete' },
  ),
  true,
  'Antigravity v2 must stream later non-empty assistant mutations immediately',
);
assert.strictEqual(
  shouldImmediatelyStreamAntigravityV2Assistant(
    { role: 'user', content: 'prompt' },
    { role: 'assistant', content: 'answer' },
  ),
  false,
  'Antigravity v2 role transitions still use the new-tail path',
);

assert.strictEqual(
  shouldBypassHistoryBulkQueue('cursor', 'assistant completion', 9 * 1024),
  true,
  'small live Cursor completion snapshots must bypass unrelated bulk history backlog',
);
assert.strictEqual(
  shouldBypassHistoryBulkQueue('cursor', 'assistant completion', 65 * 1024),
  false,
  'large Cursor history snapshots must remain bounded by the bulk queue',
);
assert.strictEqual(
  shouldBypassHistoryBulkQueue('antigravity-v2', 'assistant completion', 9 * 1024),
  true,
  'small live Antigravity v2 completion snapshots must bypass unrelated bulk history backlog',
);
assert.strictEqual(
  shouldBypassHistoryBulkQueue('antigravity-v2', 'assistant completion', 65 * 1024),
  true,
  'moderate Antigravity v2 live snapshots must bypass unrelated bulk history backlog',
);
assert.strictEqual(
  shouldBypassHistoryBulkQueue('antigravity-v2', 'assistant completion', 257 * 1024),
  false,
  'Antigravity v2 live snapshots above the dedicated 256 KiB ceiling must retain bulk backpressure',
);
assert.strictEqual(
  proto.historySnapshot('antigravity-live', [], { liveUpdate: 'assistant_completion' }).live_update,
  'assistant_completion',
  'priority live completion snapshots must carry the relay scheduling hint',
);
assert.strictEqual(
  shouldBypassHistoryBulkQueue('cursor', 'message count drift', 9 * 1024),
  false,
  'non-streaming resync snapshots must retain normal bulk ordering',
);
assert.strictEqual(
  shouldBypassHistoryBulkQueue('codex-desktop', 'assistant completion', 9 * 1024),
  false,
  'the bypass must not increase pressure on unrelated user-owned surfaces',
);
assert.strictEqual(
  shouldSendStablePendingMessage(
    { role: 'assistant', content: 'RAC_E2E_CURSOR_TOKEN' },
    'RAC_E2E_CURSOR_TOKEN',
  ),
  false,
  'a streamed Cursor assistant tail must not append again when it stabilizes',
);
assert.strictEqual(
  shouldSendStablePendingMessage(
    { role: 'assistant', content: 'RAC_E2E_ANTIGRAVITY_V2_TOKEN' },
    'structured-signature',
    'structured-signature',
  ),
  false,
  'a streamed Antigravity v2 structured tail must not append again when it stabilizes',
);

console.log('PASS Cursor immediate assistant streaming contract');
