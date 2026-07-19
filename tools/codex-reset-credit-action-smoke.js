#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { CodexAppServerConnection } = require('../agent-proxy/codex-app-server');
const { ProxyEngine } = require('../agent-proxy/proxy-engine');
const { normalizeRateLimitState } = require('./codex-session-native');

const ROOT = path.resolve(__dirname, '..');

function rateLimits(usedPercent, availableCount) {
  return {
    rateLimits: {
      primary: { usedPercent, resetsAt: 1784981662 },
      rateLimitReachedType: usedPercent >= 100 ? 'primary' : null,
    },
    rateLimitsByLimitId: {
      codex: { primary: { usedPercent, resetsAt: 1784981662 } },
    },
    rateLimitResetCredits: { availableCount, credits: [] },
  };
}

function waitFor(predicate, timeoutMs = 5000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      const value = predicate();
      if (value) return resolve(value);
      if (Date.now() - started >= timeoutMs) return reject(new Error('Timed out waiting for reset receipt'));
      setTimeout(poll, 10);
    };
    poll();
  });
}

function harness(snapshot, consumeOutcome = 'reset') {
  const engine = Object.create(ProxyEngine.prototype);
  engine.sent = [];
  engine._providerUsageResetInFlight = null;
  engine._sendToRelay = message => engine.sent.push(message);
  engine._log = () => {};
  engine._providerUsage = { refresh: async () => ({ generation: 2 }) };
  engine.consumeCalls = [];
  engine._codexUsageResetConnectionFactory = () => ({
    start: async () => {},
    readRateLimits: async () => snapshot,
    consumeRateLimitResetCredit: async (creditId, idempotencyKey) => {
      engine.consumeCalls.push({ creditId, idempotencyKey });
      return { outcome: consumeOutcome };
    },
    stop: async () => {},
  });
  return engine;
}

async function main() {
  const limited = normalizeRateLimitState(rateLimits(100, 3));
  assert.strictEqual(limited.limited, true);
  assert.strictEqual(limited.resetCreditsAvailable, 3);
  assert.strictEqual(limited.attention.message, '3 limit resets available — apply one?');
  assert.strictEqual(limited.attention.autoConsume, false);
  assert.strictEqual(normalizeRateLimitState(rateLimits(8, 3)).attention, null);
  const topLevelLimited = rateLimits(8, 3);
  topLevelLimited.rateLimits.rateLimitReachedType = 'primary';
  assert.strictEqual(normalizeRateLimitState(topLevelLimited).limited, true,
    'top-level native limit state must remain authoritative when per-limit buckets exist');

  const wrapper = Object.create(CodexAppServerConnection.prototype);
  let nativeRequest = null;
  wrapper.request = async (method, params) => { nativeRequest = { method, params }; return { outcome: 'reset' }; };
  await wrapper.consumeRateLimitResetCredit(null, 'reset-idempotency-fixture');
  assert.deepStrictEqual(nativeRequest, {
    method: 'account/rateLimitResetCredit/consume',
    params: { idempotencyKey: 'reset-idempotency-fixture' },
  });

  const rejected = harness(rateLimits(100, 3));
  rejected._handleRelayMessage({
    type: 'provider_usage_reset_credit_consume', request_id: 'rejected-reset', approved: false,
  });
  assert.strictEqual(rejected.sent[0].code, 'operator_approval_required');
  assert.strictEqual(rejected.consumeCalls.length, 0);

  const noReset = harness(rateLimits(8, 3));
  noReset._handleRelayMessage({
    type: 'provider_usage_reset_credit_consume', request_id: 'not-exhausted-reset', approved: true,
  });
  const nothingReceipt = await waitFor(() => noReset.sent.find(message => message.status === 'completed'));
  assert.strictEqual(nothingReceipt.outcome, 'nothingToReset');
  assert.strictEqual(noReset.consumeCalls.length, 0, 'non-exhausted accounts must never consume a reset');

  const approved = harness(rateLimits(100, 3));
  approved._handleRelayMessage({
    type: 'provider_usage_reset_credit_consume', request_id: 'approved-reset', approved: true,
  });
  const resetReceipt = await waitFor(() => approved.sent.find(message => message.status === 'completed'));
  assert.strictEqual(resetReceipt.outcome, 'reset');
  assert.deepStrictEqual(approved.consumeCalls, [{ creditId: null, idempotencyKey: 'approved-reset' }]);

  const sources = {
    relay: fs.readFileSync(path.join(ROOT, 'relay-server', 'index.js'), 'utf8'),
    web: fs.readFileSync(path.join(ROOT, 'frontend', 'app.jsx'), 'utf8'),
    hooks: fs.readFileSync(path.join(ROOT, 'frontend', 'hooks.jsx'), 'utf8'),
    android: fs.readFileSync(path.join(ROOT, 'android-app', 'screens', 'SessionListScreen.jsx'), 'utf8'),
    androidRelay: fs.readFileSync(path.join(ROOT, 'android-app', 'lib', 'relay.js'), 'utf8'),
  };
  assert(sources.relay.includes("'provider_usage_reset_credit_consume'")
    && sources.relay.includes("'provider_usage_reset_credit_receipt'"));
  assert(sources.hooks.includes("type: 'provider_usage_reset_credit_consume'")
    && sources.hooks.includes("t === 'provider_usage_reset_credit_receipt'"));
  assert(sources.androidRelay.includes("type: 'provider_usage_reset_credit_consume'"));
  assert(sources.android.includes("case 'provider_usage_reset_credit_receipt'"));
  assert(sources.web.includes('limit reset{resetAttention.resetCredits.available_count === 1')
    && sources.web.includes('available — apply one?'));
  assert(sources.android.includes('available — apply one?'));

  process.stdout.write(`${JSON.stringify({
    status: 'pass',
    limited_fixture: limited.reason,
    reset_credits_available: limited.resetCreditsAvailable,
    approval_required: true,
    non_exhausted_consume_calls: noReset.consumeCalls.length,
    approved_consume_calls: approved.consumeCalls.length,
    idempotency_forwarded: true,
    web_android_attention: true,
  }, null, 2)}\n`);
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
