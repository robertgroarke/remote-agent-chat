'use strict';

const fs = require('fs');
const path = require('path');
const policy = require('../shared/windows-automation-launch-policy.json');
const { createRelayOperatorActionProof } = require('../shared/windows-operator-action-proof');

const consumedProofs = new Map();

function truthyEnvironmentValue(value) {
  return /^(?:1|true|yes|on|test|e2e|validator|synthetic)$/i.test(String(value || '').trim());
}

function automationContext(env = process.env) {
  if (String(env.NODE_ENV || '').trim().toLowerCase() === 'test') return 'NODE_ENV';
  for (const key of policy.automation_environment_keys) {
    if (truthyEnvironmentValue(env[key])) return key;
  }
  return null;
}

function operatorActionError(message, details = {}) {
  const error = new Error(message);
  error.code = 'operator_action_only';
  error.details = details;
  return error;
}

function callerLocation() {
  const stack = String(new Error().stack || '').split(/\r?\n/).slice(1);
  for (const line of stack) {
    const match = line.match(/(?:\(|\s)([A-Za-z]:\\[^():]+|[^():]+):(\d+):(\d+)\)?$/);
    if (!match || match[1].includes('windows-automation-launch-policy.js')) continue;
    const absolute = path.resolve(match[1]);
    const repoRoot = path.resolve(__dirname, '..');
    return {
      file: absolute.toLowerCase().startsWith(`${repoRoot.toLowerCase()}${path.sep}`)
        ? path.relative(repoRoot, absolute).replace(/\\/g, '/')
        : path.basename(absolute),
      line: Number(match[2]),
    };
  }
  return { file: 'unknown', line: null };
}

function recordLaunchDecision(decision) {
  try {
    const repoRoot = path.resolve(__dirname, '..');
    const ledgerPath = path.join(repoRoot, 'data', 'zero-visible-window-launch-ledger.jsonl');
    const caller = callerLocation();
    const row = JSON.stringify({
      ts: new Date().toISOString(),
      pid: process.pid,
      policy_id: policy.policy_id,
      classification: policy.operator_action.classification,
      caller_file: caller.file,
      caller_line: caller.line,
      ...decision,
    });
    fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
    fs.appendFileSync(ledgerPath, `${row}\n`, { encoding: 'utf8', mode: 0o600 });
    const maxBytes = 512 * 1024;
    const stat = fs.statSync(ledgerPath);
    if (stat.size > maxBytes) {
      const keepBytes = Math.floor(maxBytes / 2);
      const handle = fs.openSync(ledgerPath, 'r');
      const buffer = Buffer.alloc(keepBytes);
      fs.readSync(handle, buffer, 0, keepBytes, stat.size - keepBytes);
      fs.closeSync(handle);
      const firstNewline = buffer.indexOf(0x0a);
      fs.writeFileSync(ledgerPath, buffer.subarray(firstNewline >= 0 ? firstNewline + 1 : 0), { mode: 0o600 });
    }
  } catch {
    // The safety decision never depends on diagnostic persistence.
  }
}

function pruneConsumedProofs(nowMs) {
  const ttlMs = policy.operator_action.proof_ttl_ms;
  for (const [nonce, consumedAt] of consumedProofs) {
    if (nowMs - consumedAt > ttlMs) consumedProofs.delete(nonce);
  }
}

function validateOperatorActionProof(proof, {
  action = policy.operator_action.action,
  requestId,
  env = process.env,
  nowMs = Date.now(),
  consume = false,
} = {}) {
  const automationKey = automationContext(env);
  if (automationKey) {
    return { ok: false, reason: 'automation_context', automation_key: automationKey };
  }
  if (!proof || typeof proof !== 'object' || Array.isArray(proof)) {
    return { ok: false, reason: 'missing_relay_proof' };
  }
  if (proof.kind !== 'relay_operator_action' || proof.policy_id !== policy.policy_id) {
    return { ok: false, reason: 'invalid_relay_proof' };
  }
  if (proof.action !== action || proof.authenticated !== true || proof.user_gesture !== true) {
    return { ok: false, reason: 'wrong_action_or_origin' };
  }
  if (!policy.operator_action.allowed_channels.includes(proof.channel)) {
    return { ok: false, reason: 'invalid_channel' };
  }
  if (!requestId || proof.request_id !== requestId) {
    return { ok: false, reason: 'request_mismatch' };
  }
  const issuedAtMs = Number(proof.issued_at_ms);
  if (!Number.isFinite(issuedAtMs) || issuedAtMs > nowMs + 1000
      || nowMs - issuedAtMs > policy.operator_action.proof_ttl_ms) {
    return { ok: false, reason: 'expired_relay_proof' };
  }
  if (!/^[a-f0-9-]{16,80}$/i.test(String(proof.nonce || ''))) {
    return { ok: false, reason: 'invalid_nonce' };
  }
  pruneConsumedProofs(nowMs);
  if (consumedProofs.has(proof.nonce)) return { ok: false, reason: 'replayed_relay_proof' };
  if (consume) consumedProofs.set(proof.nonce, nowMs);
  return { ok: true, classification: policy.operator_action.classification };
}

function assertOperatorForegroundLaunch(options = {}) {
  const validation = validateOperatorActionProof(options.operatorActionProof, {
    action: options.action,
    requestId: options.requestId,
    env: options.env,
    nowMs: options.nowMs,
    consume: options.consume !== false,
  });
  if (!validation.ok) {
    recordLaunchDecision({ action: options.action || policy.operator_action.action, decision: 'denied', reason: validation.reason });
    throw operatorActionError(
      `Visible native windows are operator-action-only (${validation.reason})`,
      validation,
    );
  }
  recordLaunchDecision({ action: options.action || policy.operator_action.action, decision: 'allowed', reason: 'authenticated_operator_gesture' });
  return validation;
}

function assertExistingOperatorTerminalAction({
  env = process.env,
  input = process.stdin,
  output = process.stdout,
} = {}) {
  const automationKey = automationContext(env);
  if (automationKey) {
    recordLaunchDecision({ action: 'attach_existing_terminal', decision: 'denied', reason: 'automation_context' });
    throw operatorActionError(`Interactive terminal attachment denied in automation (${automationKey})`);
  }
  if (input?.isTTY !== true || output?.isTTY !== true) {
    recordLaunchDecision({ action: 'attach_existing_terminal', decision: 'denied', reason: 'no_existing_tty' });
    throw operatorActionError('Interactive Claude requires an existing operator-open terminal');
  }
  recordLaunchDecision({ action: 'attach_existing_terminal', decision: 'allowed', reason: 'existing_operator_tty' });
  return { ok: true, classification: 'existing-operator-terminal-only' };
}

function evaluateAutomationLaunchSpec(spec = {}, { env = process.env } = {}) {
  const modality = String(spec.modality || 'unknown').trim().toLowerCase();
  const context = automationContext(env) || 'automation-default';
  const visibleRequested = spec.visible === true
    || spec.windowsHide === false
    || spec.headless === false
    || /^(?:normal|maximized|minimized)$/i.test(String(spec.windowStyle || ''))
    || spec.showWindow === true
    || spec.activateWindow === true
    || spec.cmdKeepOpen === true
    || spec.guiCapable === true;
  if (visibleRequested) return { ok: false, modality, context, reason: 'visible_or_gui_capable' };
  if (spec.shell === true && spec.shellWindowlessVerified !== true) {
    return { ok: false, modality, context, reason: 'unverified_shell' };
  }
  const safeByModality = {
    node: spec.windowsHide === true,
    python: spec.creationflags === 'CREATE_NO_WINDOW',
    powershell: String(spec.windowStyle || '').toLowerCase() === 'hidden' && spec.createNoWindow === true,
    batch: spec.delegatedToHiddenVbs === true,
    vbs: Number(spec.showStyle) === 0,
    pty: spec.headless === true && spec.useConpty === true,
    browser: spec.headless === true,
    electron: spec.headless === true && spec.disableGpuWindow === true,
    emulator: spec.headless === true && spec.noWindow === true,
    native: spec.createNoWindow === true,
  }[modality] === true;
  return safeByModality
    ? { ok: true, modality, context, reason: 'windowless_at_creation' }
    : { ok: false, modality, context, reason: 'unproven_windowless_creation' };
}

module.exports = {
  automationContext,
  assertExistingOperatorTerminalAction,
  assertOperatorForegroundLaunch,
  createRelayOperatorActionProof,
  evaluateAutomationLaunchSpec,
  operatorActionError,
  policy,
  validateOperatorActionProof,
};
