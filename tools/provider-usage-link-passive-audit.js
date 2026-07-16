#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const fidelity = require('./run-fidelity-regression');

function parseArgs(argv) {
  const options = { envRoot: '', sourceRoot: '', output: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--read-only-production') options.readOnly = true;
    else if (arg === '--env-root') options.envRoot = path.resolve(argv[++index] || '');
    else if (arg === '--source-root') options.sourceRoot = path.resolve(argv[++index] || '');
    else if (arg === '--output') options.output = path.resolve(argv[++index] || '');
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  assert(options.readOnly, 'Explicit --read-only-production is required');
  assert(options.envRoot, '--env-root is required');
  assert(options.sourceRoot, '--source-root is required');
  assert(options.output, '--output is required');
  return options;
}

function readConnectionAck(origin, token, WebSocket) {
  return new Promise((resolve, reject) => {
    const wsUrl = origin.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:')
      + `/client-ws?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(wsUrl, { headers: { Origin: 'http://127.0.0.1:3500' } });
    const timer = setTimeout(() => finish(new Error('provider-link passive relay audit timed out')), 15_000);
    const finish = (error, value) => {
      clearTimeout(timer);
      try { ws.close(); } catch {}
      if (error) reject(error); else resolve(value);
    };
    ws.once('error', error => finish(error));
    ws.on('open', () => ws.send(JSON.stringify({
      type: 'connection_hello',
      protocol_version: 1,
      peer_role: 'browser',
      client_name: 'provider-usage-link-passive-audit',
    })));
    ws.on('message', raw => {
      let message;
      try { message = JSON.parse(String(raw)); } catch { return; }
      if (message.type === 'connection_ack') finish(null, message);
    });
  });
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const deployEnv = fidelity.loadEnvFile(path.join(options.envRoot, '.env'));
  const relayEnv = fidelity.loadEnvFile(path.join(options.envRoot, 'relay-server', '.env'));
  const token = fidelity.buildBearerToken(relayEnv);
  const relayIp = deployEnv.RELAY_IP;
  const relayPort = deployEnv.RELAY_PORT || '3500';
  assert(relayIp, 'explicit environment root is missing RELAY_IP');
  assert(token, 'JWT bearer token could not be built from the explicit environment root');
  const WebSocket = require(path.join(options.envRoot, 'relay-server', 'node_modules', 'ws'));
  const ack = await readConnectionAck(`http://${relayIp}:${relayPort}`, token, WebSocket);
  const payload = ack.provider_usage || ack.provider_usage_snapshot || null;
  assert(payload && Array.isArray(payload.snapshots), 'connection_ack omitted provider usage');
  const cursor = payload.snapshots.find(snapshot => snapshot.provider_id === 'cursor');
  assert(cursor, 'live relay provider payload omitted Cursor');
  const sourceText = fs.readFileSync(path.join(options.sourceRoot, 'agent-proxy', 'provider-usage.js'), 'utf8');
  const sourceUrl = sourceText.match(/cursor:\s*\{[\s\S]*?dashboard_url:\s*'([^']+)'/)?.[1] || '';
  const result = {
    ok: cursor.dashboard_url === 'https://cursor.com/settings/usage'
      && sourceUrl === 'https://cursor.com/settings/usage',
    generated_at: new Date().toISOString(),
    mode: 'passive_authenticated_relay_connection_ack',
    source_root: options.sourceRoot,
    source_commit: require('child_process').execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: options.sourceRoot, encoding: 'utf8', windowsHide: true,
    }).trim(),
    boundaries: {
      canonical_source_registry: {
        dashboard_url: sourceUrl,
      },
      standalone_proxy_snapshot: {
        status: 'represented_by_relay_ingested_snapshot',
        source: cursor.source || null,
        captured_at: cursor.captured_at || null,
        dashboard_url: cursor.dashboard_url || null,
      },
      relay_ingestion_readback: {
        schema_version: payload.schema_version,
        generation: payload.generation,
        generated_at: payload.generated_at,
        dashboard_url: cursor.dashboard_url || null,
      },
      authenticated_http_api: {
        status: 'not_implemented_in_current_schema_v2',
      },
      production_dom: {
        status: 'deferred_until_exact_deploy_proof',
      },
      android_normalizer: {
        status: 'source_contract_only_before_fix',
      },
    },
    obsolete_billing_url_occurrences: JSON.stringify(payload).split('https://cursor.com/dashboard/billing').length - 1,
    relay_session_count: Array.isArray(ack.sessions) ? ack.sessions.length : 0,
    duplicate_proxy_alarms: Array.isArray(ack.duplicate_proxy_alarms) ? ack.duplicate_proxy_alarms.length : 0,
    payload_persisted: false,
    credentials_persisted: false,
    browser_connected: false,
    page_navigations: 0,
    focus_actions: 0,
    visible_windows_opened: 0,
    sends: 0,
    controls: 0,
  };
  assert.strictEqual(result.obsolete_billing_url_occurrences, 0,
    'live relay provider payload retained the obsolete Cursor billing URL');
  assert(result.relay_session_count > 0, 'live relay inventory is empty');
  assert.strictEqual(result.duplicate_proxy_alarms, 0, 'live relay reports duplicate proxies');
  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}

main().catch(error => {
  console.error(`provider usage link passive audit: FAIL (${error.stack || error.message || error})`);
  process.exit(1);
});
