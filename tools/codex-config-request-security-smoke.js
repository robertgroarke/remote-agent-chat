#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { validateCodexConfigControlMessage } = require('../relay-server/request-security');

const base = {
  type: 'set_codex_config',
  session_id: 'codex-session-a',
  request_id: 'codex-control-request-a',
};

const accepted = [
  { ...base, model_id: 'gpt-5.6-sol', source_revision: 'codex-0123456789abcdef0123' },
  { ...base, request_id: 'effort', effort: 'extra-high' },
  { ...base, request_id: 'access', access_mode: 'workspace-write' },
  { ...base, request_id: 'profile', permission_profile: 'auto' },
  { ...base, request_id: 'bypass', permission_profile: 'full-access', confirm_bypass: true },
];
accepted.forEach(message => assert.equal(validateCodexConfigControlMessage(message).ok, true));

const rejected = [
  { ...base },
  { ...base, model_id: 'gpt-5.5', effort: 'high' },
  { ...base, request_id: '' , model_id: 'gpt-5.5' },
  { ...base, model_id: '../secret' },
  { ...base, effort: 'maximum' },
  { ...base, access_mode: 'root' },
  { ...base, permission_profile: 'full-access' },
  { ...base, permission_profile: 'auto', confirm_bypass: true },
  { ...base, permission_profile: 'full-access', confirm_bypass: 'yes' },
  { ...base, model_id: 'gpt-5.5', source_revision: 'bad\nrevision' },
];
rejected.forEach(message => assert.equal(validateCodexConfigControlMessage(message).ok, false));

const fingerprintA = validateCodexConfigControlMessage(accepted[0]).fingerprint;
const fingerprintB = validateCodexConfigControlMessage({ ...accepted[0], session_id: 'codex-session-b' }).fingerprint;
const fingerprintRevisionB = validateCodexConfigControlMessage({ ...accepted[0], source_revision: 'codex-fedcba98765432100123' }).fingerprint;
assert.notEqual(fingerprintA, fingerprintB, 'request binding fingerprint omitted the target session');
assert.notEqual(fingerprintA, fingerprintRevisionB, 'request binding fingerprint omitted the source revision');

console.log(JSON.stringify({
  ok: true,
  accepted: accepted.length,
  rejected: rejected.length,
  session_bound_fingerprint: true,
  revision_bound_fingerprint: true,
}, null, 2));
