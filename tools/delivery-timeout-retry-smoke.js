'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const frontendHook = read('frontend/hooks.jsx');
const frontendApp = read('frontend/app.jsx');
const frontendStyles = read('frontend/styles.css');
const androidChat = read('android-app/screens/ChatScreen.jsx');
const androidBubble = read('android-app/components/MessageBubble.jsx');
const androidRelay = read('android-app/lib/relay.js');
const androidLifecycle = require('../android-app/lib/delivery-lifecycle');
const proxyEngine = read('agent-proxy/proxy-engine.js');
const relayServer = read('relay-server/index.js');
const protocol = require('../agent-proxy/protocol');
// esbuild's lineLimit may split long string literals with a JavaScript line
// continuation. Normalize only that serialization detail before asserting the
// runtime-visible copy.
const builtBundle = read('frontend/dist/bundle.js').replace(/\\\r?\n/g, '');

const checks = [];
function assert(condition, label) {
  if (!condition) throw new Error(label);
  checks.push(label);
}

for (const [stage, timeout] of Object.entries({ queued: 10000, accepted: 30000, delivered: 30000, steered: 30000 })) {
  const marker = `${stage}: ${timeout}`;
  assert(frontendHook.includes(marker), `web declares the ${stage} timeout`);
  assert(androidChat.includes(marker), `Android declares the ${stage} timeout`);
}

assert(frontendHook.includes("function sendToSession(session, content, retryClientMessageId = '')"), 'web retry accepts an existing correlation ID');
assert(frontendHook.includes("const cid = retryClientMessageId ||"), 'web retry reuses the original correlation ID');
assert(/existing\.map\(message => \(\s*message\._cid === cid\s*\|\| message\.client_message_id === cid\s*\|\| message\.client_msg_id === cid/.test(frontendHook),
  'web retry updates an optimistic or hydrated durable bubble');
assert(frontendHook.includes("...(retryClientMessageId ? { retry_failed: true } : {})"), 'web retry carries explicit durable retry intent');
assert(frontendHook.includes('acceptDeliveryAttempt(clientMessageId, rawAttempt'), 'web rejects lower delivery attempt epochs');
assert(frontendHook.includes("armDeliveryTimeout(cid, 'accepted'"), 'web rearms after relay acceptance');
assert(frontendHook.includes("armDeliveryTimeout(cid, 'delivered'"), 'web rearms after native delivery');
assert(frontendHook.includes("setTrackedDeliveryState(cid, 'agent_started', { force: attempt.advanced })"), 'web clears at correlated agent activity');
assert(frontendHook.includes('if (!attempt.accepted) return;'), 'web ignores stale attempt frames');
assert(frontendApp.includes('className="delivery-retry"'), 'web failed state renders a Retry action');
assert(frontendApp.includes('className="delivery-copy"'), 'web failed state renders a Copy action');
assert(frontendApp.includes('className="delivery-failure-reason"'), 'web failed state renders a visible failure reason');
for (const copy of [
  'Update validation pending',
  'Agent busy',
  'Open this thread in Codex Desktop',
  'Could not confirm native delivery',
  'Composer input could not be verified',
]) {
  assert(frontendApp.includes(copy), `web maps the actionable delivery failure: ${copy}`);
  assert(androidBubble.includes(copy), `Android maps the actionable delivery failure: ${copy}`);
}
assert(frontendApp.includes('sendToSessionRef.current(activeSession, message.content, clientMessageId)'),
  'web Retry submits the same bubble and durable correlation ID');
assert(frontendStyles.includes('.delivery-retry:focus-visible'), 'web Retry action has keyboard focus styling');

assert(androidChat.includes("deliveryRecords.current[id] = { text, stage: 'queued', retryFailed: options.retryFailed === true }"),
  'Android retains retry content and intent by correlation ID');
assert(androidChat.includes("armDeliveryStageTimeout(cid, 'accepted'"), 'Android rearms after relay acceptance');
assert(androidChat.includes("armDeliveryStageTimeout(cid, 'delivered'"), 'Android rearms after native delivery');
assert(androidChat.includes('acceptDeliveryAttempt(deliveryAttemptsRef.current, cid, msg.delivery_attempt)'),
  'Android rejects lower delivery attempt epochs');
assert(androidChat.includes('doSend(text, clientMsgId, createdAt, { retryFailed: true })'),
  'Android Retry resubmits the durable correlation ID explicitly');
assert(androidChat.includes('onRetry={handleMessageRetry}'), 'Android routes Retry from the exact failed bubble');
assert(androidBubble.includes('accessibilityLabel="Retry failed message"'), 'Android failed bubble renders an accessible Retry action');
assert(androidBubble.includes('accessibilityLabel="Copy failed message"'), 'Android failed bubble renders an accessible Copy action');
assert(androidBubble.includes('message.failure_reason || message._sendError || message.failure_code'),
  'Android failed bubble renders its typed durable reason');
assert(androidRelay.includes("...(options.retryFailed === true ? { retry_failed: true } : {})"),
  'Android relay frames carry explicit durable retry intent');

const androidCid = 'android-attempt-replay';
const androidReplay = [
  { role: 'user', content: 'proof', _cid: androidCid, _optimistic: true, status: 'accepted', delivery_attempt: 1 },
  {
    id: 7,
    sequence: 7,
    role: 'user',
    content: 'proof',
    client_msg_id: androidCid,
    status: 'failed',
    delivery_attempt: 1,
    failure_reason: 'stale failure',
    failure_native_attempted: false,
    failure_retryable: true,
  },
  { role: 'user', content: 'proof', client_message_id: androidCid, status: 'accepted', delivery_attempt: 2 },
  { id: 7, sequence: 7, role: 'user', content: 'proof', client_message_id: androidCid, status: 'delivered', delivery_attempt: 2 },
  { id: 7, sequence: 7, role: 'user', content: 'proof', client_message_id: androidCid, status: 'agent_started', delivery_attempt: 2 },
];
for (let index = 0; index < 1000; index += 1) {
  const offset = index % androidReplay.length;
  const reordered = androidReplay.slice(offset).concat(androidReplay.slice(0, offset), androidReplay.slice().reverse());
  const rows = androidLifecycle.mergeCanonicalDeliveryMessages(reordered);
  assert(rows.length === 1, `Android replay ${index + 1} preserves one canonical row`);
  assert(rows[0]._cid === androidCid, `Android replay ${index + 1} preserves client identity`);
  assert(rows[0]._deliveryAttempt === 2, `Android replay ${index + 1} preserves attempt epoch`);
  assert(androidLifecycle.deliveryStateOf(rows[0]) === 'agent_started',
    `Android replay ${index + 1} preserves terminal state`);
}

assert(proxyEngine.includes("code: 'codex_desktop_thread_not_open'"), 'Codex Desktop send fails closed when its thread is not open');
assert(proxyEngine.includes("proto.proxySendResult(sessionId, msg.client_message_id, 'failed', { error })"), 'revalidation failure preserves its structured error');
assert(proxyEngine.includes("QUEUE_ON_SEND_CODES.has(result.code)"), 'agent-busy delivery remains a distinct steerable queue state');
assert(relayServer.includes('msg.retry_failed === true'), 'relay recognizes explicit retry restarts');
assert(relayServer.includes('delivery_attempt'), 'relay persists delivery attempt epochs');
const revalidationFailure = protocol.proxySendResult('fixture-session', 'fixture-cid', 'failed', {
  delivery_attempt: 1,
  error: {
    code: 'pending_revalidation',
    message: 'fixture version mismatch',
    native_attempted: false,
    retryable: true,
  },
});
assert(revalidationFailure.error?.code === 'pending_revalidation', 'protocol preserves the revalidation failure code');
assert(revalidationFailure.error?.native_attempted === false, 'protocol preserves pre-native failure safety');
assert(revalidationFailure.error?.retryable === true, 'protocol preserves explicit retry safety');
assert(revalidationFailure.delivery_attempt === 1, 'protocol preserves delivery attempt epoch');

for (const marker of [
  'Timed out waiting for relay acceptance.',
  'Relay accepted the message, but native delivery timed out.',
  'Message reached the agent, but agent activity did not start in time.',
]) {
  assert(builtBundle.includes(marker), `built web bundle contains: ${marker}`);
}

console.log(JSON.stringify({ ok: true, checks: checks.length }, null, 2));
