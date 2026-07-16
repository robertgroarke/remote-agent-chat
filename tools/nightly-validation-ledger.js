#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const fidelity = require('./run-fidelity-regression');
const { collectAppVersions } = require('./app-version-inventory');

const root = path.resolve(__dirname, '..');
const DEFAULT_LEDGER = path.join(root, 'data', 'nightly-validation-ledger.jsonl');
const DEFAULT_LOCK = path.join(root, 'data', 'nightly-validation.lock');
const VALIDATOR_RUNTIME_BUDGET_MS = 60 * 1000;

function parseArgs(argv) {
  const options = {
    ledger: DEFAULT_LEDGER,
    lock: DEFAULT_LOCK,
    timeoutMs: VALIDATOR_RUNTIME_BUDGET_MS,
    relayOrigin: null,
    publish: true,
    only: null,
    authOnly: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--ledger' && argv[i + 1]) options.ledger = path.resolve(argv[++i]);
    else if (argv[i] === '--lock' && argv[i + 1]) options.lock = path.resolve(argv[++i]);
    else if (argv[i] === '--timeout-ms' && argv[i + 1]) {
      options.timeoutMs = Math.min(
        VALIDATOR_RUNTIME_BUDGET_MS,
        Math.max(1000, Number(argv[++i]) || VALIDATOR_RUNTIME_BUDGET_MS),
      );
    }
    else if (argv[i] === '--relay-origin' && argv[i + 1]) options.relayOrigin = argv[++i].replace(/\/+$/, '');
    else if (argv[i] === '--no-publish') options.publish = false;
    else if (argv[i] === '--auth-only') options.authOnly = true;
    else if (argv[i] === '--only' && argv[i + 1]) options.only = argv[++i].split(',').map(value => value.trim()).filter(Boolean);
    else throw new Error(`Unknown or incomplete argument: ${argv[i]}`);
  }
  return options;
}

function discoverValidators() {
  return fs.readdirSync(__dirname)
    .filter(name => name.endsWith('-validate-all.js'))
    .sort()
    .map(script => ({ harness: script.slice(0, -'-validate-all.js'.length), script }));
}

function appendLedger(ledgerPath, entry) {
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.appendFileSync(ledgerPath, `${JSON.stringify(entry)}\n`, 'utf8');
}

function resolveRelay(options) {
  const deployEnv = fidelity.loadEnvFile(path.join(root, '.env'));
  const relayEnv = fidelity.loadEnvFile(path.join(root, 'relay-server', '.env'));
  const proxyEnv = fidelity.loadEnvFile(path.join(root, 'agent-proxy', '.env'));
  const origin = options.relayOrigin
    || (deployEnv.RELAY_IP ? `http://${deployEnv.RELAY_IP}:${deployEnv.RELAY_PORT || '3500'}` : null)
    || fidelity.deriveRelayBaseUrl(null, relayEnv, proxyEnv);
  return { origin, token: fidelity.buildBearerToken(relayEnv) };
}

async function verifyRelayAuth(relay, runId, fetchImpl = fetch) {
  const started = Date.now();
  const base = {
    schema_version: 1,
    kind: 'nightly_auth_gate',
    run_id: runId,
    harness: 'relay-auth',
    app_version: 'relay',
    validator: 'nightly-validation-ledger:auth-gate',
    read_only: true,
  };
  try {
    if (!relay?.origin || !relay?.token) throw new Error('Relay origin or signed bearer token unavailable');
    const externalHeaders = {
      'X-Forwarded-For': '203.0.113.10',
      'X-Forwarded-Proto': 'https',
      Connection: 'close',
    };
    const unauthenticated = await fetchImpl(`${relay.origin}/`, {
      redirect: 'manual', headers: externalHeaders, signal: AbortSignal.timeout(15000),
    });
    if (unauthenticated.status !== 302 || unauthenticated.headers.get('location') !== '/auth/google') {
      throw new Error(`unauthenticated root returned ${unauthenticated.status} ${unauthenticated.headers.get('location') || ''}`.trim());
    }
    const authenticated = await fetchImpl(`${relay.origin}/`, {
      headers: { ...externalHeaders, Authorization: `Bearer ${relay.token}` },
      signal: AbortSignal.timeout(15000),
    });
    const body = await authenticated.text();
    if (authenticated.status !== 200 || !body.includes('id="root"')) {
      throw new Error(`authenticated root returned ${authenticated.status} or missing app root`);
    }
    return {
      ...base, status: 'pass', duration_ms: Date.now() - started, exit_code: 0,
      completed_at: new Date().toISOString(),
      detail: 'unauthenticated 302 /auth/google; authenticated 200 app root',
    };
  } catch (error) {
    return {
      ...base, status: 'fail', duration_ms: Date.now() - started, exit_code: 1,
      completed_at: new Date().toISOString(), detail: error.message,
    };
  }
}

async function publishEntry(relay, entry) {
  if (!relay.origin || !relay.token) throw new Error('Relay origin or signed bearer token unavailable');
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(`${relay.origin}/api/maintenance/validation`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${relay.token}`,
          'Content-Type': 'application/json',
          Connection: 'close',
        },
        body: JSON.stringify({ validation: entry }),
        signal: AbortSignal.timeout(15000),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `relay returned HTTP ${response.status}`);
      return { ...body, publish_attempts: attempt };
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 500));
    }
  }
  throw lastError || new Error('Relay publication failed');
}

function runValidator(validator, appVersion, timeoutMs, runId) {
  const started = Date.now();
  const result = spawnSync(process.execPath, [path.join(__dirname, validator.script), '--read-only'], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: timeoutMs,
    env: { ...process.env, RAC_NIGHTLY_VALIDATION: '1' },
    maxBuffer: 16 * 1024 * 1024,
  });
  const combined = `${result.stdout || ''}${result.stderr || ''}`.trim();
  const status = result.error?.code === 'ETIMEDOUT' ? 'timed_out' : (!result.error && result.status === 0 ? 'pass' : 'fail');
  return {
    schema_version: 1,
    kind: 'nightly_validation',
    run_id: runId,
    harness: validator.harness,
    status,
    app_version: appVersion || 'unavailable',
    validator: `tools/${validator.script}`,
    read_only: true,
    runtime_budget_ms: timeoutMs,
    budget_exhausted: status === 'timed_out',
    duration_ms: Date.now() - started,
    exit_code: Number.isInteger(result.status) ? result.status : null,
    completed_at: new Date().toISOString(),
    detail: (result.error?.message || combined.slice(-4000) || 'No validator output'),
  };
}

function acquireLock(lockPath) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  try {
    const handle = fs.openSync(lockPath, 'wx');
    fs.writeFileSync(handle, `${process.pid}\n${new Date().toISOString()}\n`, 'utf8');
    return () => {
      try { fs.closeSync(handle); } catch {}
      try { fs.unlinkSync(lockPath); } catch {}
    };
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Nightly validation already running (${lockPath})`);
    throw error;
  }
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const releaseLock = acquireLock(options.lock);
  let failures = 0;
  try {
    const versions = collectAppVersions();
    let validators = discoverValidators();
    if (options.only) validators = validators.filter(item => options.only.includes(item.harness));
    if (validators.length === 0 && !options.authOnly) throw new Error('No validate-all entry points selected');
    const relay = resolveRelay(options);
    const runId = `nightly-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    const authEntry = await verifyRelayAuth(relay, runId);
    appendLedger(options.ledger, authEntry);
    if (authEntry.status !== 'pass') failures += 1;
    console.log(`${authEntry.status.toUpperCase()} relay-auth ${authEntry.duration_ms}ms`);
    if (options.authOnly) validators = [];
    for (const validator of validators) {
      const entry = runValidator(validator, versions[validator.harness], options.timeoutMs, runId);
      appendLedger(options.ledger, entry);
      if (entry.status !== 'pass') failures += 1;
      if (options.publish) {
        try {
          await publishEntry(relay, entry);
        } catch (error) {
          failures += 1;
          const publishFailure = {
            ...entry,
            kind: 'nightly_validation_publish_failure',
            status: 'fail',
            completed_at: new Date().toISOString(),
            detail: error.message,
          };
          appendLedger(options.ledger, publishFailure);
          console.error(`PUBLISH FAIL ${validator.harness}: ${error.message}`);
        }
      }
      console.log(`${entry.status.toUpperCase()} ${validator.harness} ${entry.app_version} ${entry.duration_ms}ms`);
    }
  } finally {
    releaseLock();
  }
  process.exitCode = failures ? 1 : 0;
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  VALIDATOR_RUNTIME_BUDGET_MS,
  appendLedger,
  discoverValidators,
  main,
  parseArgs,
  publishEntry,
  resolveRelay,
  runValidator,
  verifyRelayAuth,
};
