'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const frontendHook = read('frontend/hooks.jsx');
const frontendApp = read('frontend/app.jsx');
const frontendStyles = read('frontend/styles.css');
const androidChat = read('android-app/screens/ChatScreen.jsx');
const builtBundle = read('frontend/dist/bundle.js');

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
assert(frontendApp.includes('sendToSessionRef.current(activeSession, message.content, message._cid)'), 'web Retry submits the same bubble and correlation ID');
assert(frontendStyles.includes('.delivery-retry:focus-visible'), 'web Retry action has keyboard focus styling');

assert(androidChat.includes('deliveryRecords.current[id] = { text, stage: \'queued\' }'), 'Android retains retry content by correlation ID');
assert(androidChat.includes("armDeliveryStageTimeout(cid, 'accepted'"), 'Android rearms after relay acceptance');
assert(androidChat.includes("armDeliveryStageTimeout(cid, 'delivered'"), 'Android rearms after native delivery');
assert(androidChat.includes("deliveryStatesRef.current[clientMsgId] === 'agent_started'"), 'Android ignores a stale failure after agent activity');
assert(androidChat.includes('doSend(text, clientMsgId);'), 'Android Retry resubmits the original correlation ID');
assert(androidChat.includes("failedMsg.reason || 'Send failed'"), 'Android surfaces the stage-specific retry reason');

for (const marker of [
  'Timed out waiting for relay acceptance.',
  'Relay accepted the message, but native delivery timed out.',
  'Message reached the agent, but agent activity did not start in time.',
]) {
  assert(builtBundle.includes(marker), `built web bundle contains: ${marker}`);
}

console.log(JSON.stringify({ ok: true, checks: checks.length }, null, 2));
