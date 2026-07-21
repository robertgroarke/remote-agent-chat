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
const proxyEngine = read('agent-proxy/proxy-engine.js');
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
assert(frontendHook.includes("existing.map(message => message._cid === cid"), 'web retry updates the original optimistic bubble');
assert(frontendHook.includes("armDeliveryTimeout(cid, 'accepted'"), 'web rearms after relay acceptance');
assert(frontendHook.includes("armDeliveryTimeout(cid, 'delivered'"), 'web rearms after native delivery');
assert(frontendHook.includes("setTrackedDeliveryState(cid, 'agent_started')"), 'web clears at correlated agent activity');
assert(frontendHook.includes("deliveryStatesRef.current[clientMessageId] === 'agent_started'"), 'web ignores a stale failure after agent activity');
assert(frontendApp.includes('className="delivery-retry"'), 'web failed state renders a Retry action');
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
assert(frontendApp.includes('sendToSessionRef.current(activeSession, message.content, message._cid)'), 'web Retry submits the same bubble and correlation ID');
assert(frontendStyles.includes('.delivery-retry:focus-visible'), 'web Retry action has keyboard focus styling');

assert(androidChat.includes('deliveryRecords.current[id] = { text, stage: \'queued\' }'), 'Android retains retry content by correlation ID');
assert(androidChat.includes("armDeliveryStageTimeout(cid, 'accepted'"), 'Android rearms after relay acceptance');
assert(androidChat.includes("armDeliveryStageTimeout(cid, 'delivered'"), 'Android rearms after native delivery');
assert(androidChat.includes("deliveryStatesRef.current[clientMsgId] === 'agent_started'"), 'Android ignores a stale failure after agent activity');
assert(androidChat.includes('doSend(text, clientMsgId);'), 'Android Retry resubmits the original correlation ID');
assert(androidChat.includes("failedMsg.reason || 'Send failed'"), 'Android surfaces the stage-specific retry reason');
assert(androidBubble.includes("deliveryFailureText(message._sendError || message.failure_code)"), 'Android failed bubble renders its reason');

assert(proxyEngine.includes("code: 'codex_desktop_thread_not_open'"), 'Codex Desktop send fails closed when its thread is not open');
assert(proxyEngine.includes("proto.proxySendResult(sessionId, msg.client_message_id, 'failed', { error })"), 'revalidation failure preserves its structured error');
assert(proxyEngine.includes("QUEUE_ON_SEND_CODES.has(result.code)"), 'agent-busy delivery remains a distinct steerable queue state');
const revalidationFailure = protocol.proxySendResult('fixture-session', 'fixture-cid', 'failed', {
  error: { code: 'pending_revalidation', message: 'fixture version mismatch' },
});
assert(revalidationFailure.error?.code === 'pending_revalidation', 'protocol preserves the revalidation failure code');

for (const marker of [
  'Timed out waiting for relay acceptance.',
  'Relay accepted the message, but native delivery timed out.',
  'Message reached the agent, but agent activity did not start in time.',
]) {
  assert(builtBundle.includes(marker), `built web bundle contains: ${marker}`);
}

console.log(JSON.stringify({ ok: true, checks: checks.length }, null, 2));
