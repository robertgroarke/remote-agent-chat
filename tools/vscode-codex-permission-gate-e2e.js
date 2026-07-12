#!/usr/bin/env node
'use strict';

process.env.VSCODE_PROBE_CDP_PORT = process.env.VSCODE_PROBE_CDP_PORT || '9230';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const selectors = require('../agent-proxy/selectors');
const guard = require('../agent-proxy/vscode-probe-guard');
const production = require('./vscode-extension-production-e2e');

function parseArgs(argv) {
  const index = argv.indexOf('--result-file');
  return { resultFile: index >= 0 && argv[index + 1] ? path.resolve(argv[index + 1]) : '' };
}

function configPolicy(configPath) {
  const text = fs.readFileSync(configPath, 'utf8');
  return {
    approval_policy: (text.match(/^approval_policy\s*=\s*"([^"]+)"/m) || [])[1] || 'unknown',
    sandbox_mode: (text.match(/^sandbox_mode\s*=\s*"([^"]+)"/m) || [])[1] || 'unknown',
    sha256: crypto.createHash('sha256').update(text).digest('hex'),
  };
}

async function requestConfig(relay, sessionId) {
  const requestId = `codex-permission-config-${crypto.randomBytes(4).toString('hex')}`;
  const start = relay.messages.length;
  relay.ws.send(JSON.stringify({ type: 'agent_config_request', session_id: sessionId, request_id: requestId }));
  return production.waitFor(
    () => relay.messages.slice(start).find(message =>
      message.type === 'agent_config' && message.request_id === requestId
    ),
    30000,
    'Codex permission-gate config',
  );
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  guard.assertUpdatesDisabled('VS Code Codex permission-gate E2E');
  assert.equal(guard.CDP_PORT, 9230, 'Permission-gate E2E is restricted to disposable CDP port 9230');
  const configPath = path.join(process.env.USERPROFILE || process.env.HOME, '.codex', 'config.toml');
  const policyBefore = configPolicy(configPath);
  assert.equal(policyBefore.approval_policy, 'never');
  assert.equal(policyBefore.sandbox_mode, 'danger-full-access');

  const native = await production.openNative('codex');
  const relay = await production.openRelay();
  try {
    const store = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'agent-proxy', 'session-store.json'), 'utf8'));
    const session = await production.waitFor(
      () => guard.pickSessionForFrame(production.latestSessions(relay.messages), 'codex', store, native.frame),
      60000,
      'guarded Codex permission-gate session',
    );
    const stored = guard.assertStoreBinding(store, session, native.frame);
    const config = await requestConfig(relay, session.session_id);
    assert.equal(config.capabilities?.permission_dialogs, false);

    const nativeConfig = await selectors.readAgentConfig(native.client.Runtime, 'codex');
    const prompt = await selectors.detectPermissionDialog(native.client.Runtime, 'codex');
    assert.equal(prompt, null, 'Never/full-access Codex unexpectedly exposed a permission prompt');
    const policyAfter = configPolicy(configPath);
    assert.equal(policyAfter.sha256, policyBefore.sha256, 'Permission-gate read changed shared Codex config');

    const result = {
      ok: true,
      generated_at: new Date().toISOString(),
      session_id: session.session_id,
      target_id: stored.target_id,
      cdp_port: guard.CDP_PORT,
      workspace: guard.WORKSPACE_PATH,
      capability: config.capabilities.permission_dialogs,
      native_model: nativeConfig?.model_id || 'unknown',
      native_permission_mode: nativeConfig?.permission_mode || 'unknown',
      active_prompt: null,
      approval_policy: policyBefore.approval_policy,
      sandbox_mode: policyBefore.sandbox_mode,
      shared_config_sha256: policyBefore.sha256,
      shared_config_unchanged: true,
      protected_host: { port: 9223, untouched: true },
    };
    if (options.resultFile) {
      fs.mkdirSync(path.dirname(options.resultFile), { recursive: true });
      fs.writeFileSync(options.resultFile, JSON.stringify(result, null, 2) + '\n');
    }
    console.log(JSON.stringify(result, null, 2));
    return result;
  } finally {
    try { relay.ws.close(); } catch {}
    try { await native.client.close(); } catch {}
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`VS Code Codex permission-gate E2E: FAIL (${error.stack || error.message})`);
    process.exitCode = 1;
  });
}

module.exports = { main, configPolicy };
