#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const WebSocket = require('../relay-server/node_modules/ws');
const fidelity = require('./run-fidelity-regression');
const guard = require('../agent-proxy/vscode-probe-guard');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function parseArgs(argv) {
  const options = { resultFile: '' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--result-file') options.resultFile = path.resolve(argv[++i]);
  }
  return options;
}

async function waitFor(predicate, timeoutMs, label, intervalMs = 100) {
  const started = Date.now();
  while (Date.now() - started <= timeoutMs) {
    const value = await predicate();
    if (value) return value;
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function relayUrl() {
  const relayEnv = fidelity.loadEnvFile(path.join(__dirname, '..', 'relay-server', '.env'));
  const proxyEnv = fidelity.loadEnvFile(path.join(__dirname, '..', 'agent-proxy', '.env'));
  const token = fidelity.buildBearerToken(relayEnv);
  const base = (proxyEnv.RELAY_URL || '').replace(/\/proxy-ws$/i, '/client-ws')
    || fidelity.deriveRelayBaseUrl(null, relayEnv, proxyEnv).replace(/^http/i, 'ws').replace(/\/+$/, '') + '/client-ws';
  return token ? `${base}${base.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}` : base;
}

async function openRelay() {
  const ws = new WebSocket(relayUrl(), { headers: { Origin: 'http://127.0.0.1:3500' } });
  const messages = [];
  ws.on('message', data => { try { messages.push(JSON.parse(data.toString())); } catch {} });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('relay open timeout')), 30000);
    ws.once('open', () => {
      clearTimeout(timer);
      ws.send(JSON.stringify({
        type: 'connection_hello',
        protocol_version: 1,
        peer_role: 'browser',
        client_name: 'vscode-claude-file-browser-e2e',
      }));
      resolve();
    });
    ws.once('error', reject);
  });
  return { ws, messages };
}

function latestSessions(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (Array.isArray(messages[i]?.sessions)) return messages[i].sessions;
  }
  return [];
}

function storedClaudeSession(sessionId) {
  const storePath = path.join(__dirname, '..', 'agent-proxy', 'session-store.json');
  const sessions = Object.values(JSON.parse(fs.readFileSync(storePath, 'utf8')).sessions || {});
  const matches = sessions.filter(session =>
    session.session_id === sessionId
    && session.agent_type === 'claude'
    && session.host_type === 'vscode'
    && Number(session.cdp_port) === guard.CDP_PORT
    && String(session.workspace_path || '').toLowerCase() === guard.WORKSPACE_PATH.toLowerCase()
    && session.status === 'healthy'
  );
  assert.equal(matches.length, 1, `Expected one guarded Claude session, found ${matches.length}`);
  return matches[0];
}

async function requestConfig(relay, sessionId) {
  const requestId = `claude-files-cfg-${crypto.randomBytes(4).toString('hex')}`;
  const start = relay.messages.length;
  relay.ws.send(JSON.stringify({ type: 'agent_config_request', session_id: sessionId, request_id: requestId }));
  return waitFor(
    () => relay.messages.slice(start).find(message => message.type === 'agent_config' && message.request_id === requestId),
    30000,
    'Claude file-browser config',
  );
}

async function requestFileAction(relay, sessionId, type, requestPath, options = {}) {
  const requestId = `claude-files-${crypto.randomBytes(4).toString('hex')}`;
  const start = relay.messages.length;
  relay.ws.send(JSON.stringify({
    type,
    session_id: sessionId,
    request_id: requestId,
    path: requestPath,
    ...(options.maxSize ? { max_size: options.maxSize } : {}),
  }));
  const control = await waitFor(
    () => relay.messages.slice(start).find(message =>
      message.type === 'agent_control_result' && message.request_id === requestId
    ),
    30000,
    `${type} control result for ${requestPath}`,
  );
  const payloadType = type === 'list_directory' ? 'directory_listing' : 'file_content';
  const payload = relay.messages.slice(start).find(message =>
    message.type === payloadType && message.request_id === requestId
  ) || null;
  return { requestId, control, payload };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  guard.assertUpdatesDisabled('VS Code Claude file-browser E2E');
  assert.equal(guard.CDP_PORT, 9230, 'File-browser E2E is restricted to disposable CDP port 9230');
  const relay = await openRelay();
  try {
    const relaySession = await waitFor(() => latestSessions(relay.messages).find(candidate =>
      candidate?.agent_type === 'claude'
      && candidate?.host_type === 'vscode'
      && String(candidate?.workspace_path || '').toLowerCase() === guard.WORKSPACE_PATH.toLowerCase()
      && candidate?.status === 'healthy'
    ), 90000, 'guarded live Claude relay session', 250);
    const session = storedClaudeSession(relaySession.session_id);
    const config = await requestConfig(relay, session.session_id);
    assert.equal(config?.capabilities?.file_browser, true, 'Claude config did not advertise file_browser');

    const readmePath = path.join(guard.WORKSPACE_PATH, 'README.md');
    const expectedContent = fs.readFileSync(readmePath, 'utf8');
    const expectedSize = fs.statSync(readmePath).size;

    const listing = await requestFileAction(relay, session.session_id, 'list_directory', '.');
    assert.equal(listing.control.result, 'ok', JSON.stringify(listing.control));
    assert(listing.payload, 'list_directory returned no directory_listing payload');
    const readmeEntry = listing.payload.entries.find(entry => entry.name === 'README.md');
    assert(readmeEntry, 'workspace listing did not include README.md');
    assert.equal(readmeEntry.type, 'file');
    assert.equal(readmeEntry.size, expectedSize);

    const read = await requestFileAction(relay, session.session_id, 'read_file', 'README.md');
    assert.equal(read.control.result, 'ok', JSON.stringify(read.control));
    assert(read.payload, 'read_file returned no file_content payload');
    assert.equal(read.payload.content, expectedContent);
    assert.equal(read.payload.truncated, false);

    const bounded = await requestFileAction(relay, session.session_id, 'read_file', 'README.md', { maxSize: 32 });
    assert.equal(bounded.control.result, 'ok', JSON.stringify(bounded.control));
    assert(bounded.payload, 'bounded read_file returned no file_content payload');
    assert.equal(bounded.payload.content, expectedContent.slice(0, 32));
    assert.equal(bounded.payload.truncated, true);

    const parent = await requestFileAction(relay, session.session_id, 'list_directory', '..');
    assert.equal(parent.control.result, 'failed');
    assert.equal(parent.control.error?.code, 'path_traversal');
    assert.equal(parent.payload, null, 'traversal rejection must not return a directory payload');

    const prefixSibling = await requestFileAction(
      relay,
      session.session_id,
      'read_file',
      '..\\remote-agent-vscode-test-sibling\\README.md',
    );
    assert.equal(prefixSibling.control.result, 'failed');
    assert.equal(prefixSibling.control.error?.code, 'path_traversal');
    assert.equal(prefixSibling.payload, null, 'prefix-sibling rejection must not return file content');

    const result = {
      ok: true,
      generated_at: new Date().toISOString(),
      session_id: session.session_id,
      cdp_port: guard.CDP_PORT,
      workspace: guard.WORKSPACE_PATH,
      capability: config.capabilities.file_browser,
      root_entries: listing.payload.entries.length,
      readme_size: expectedSize,
      readme_sha256: crypto.createHash('sha256').update(expectedContent).digest('hex'),
      bounded_read_bytes: Buffer.byteLength(bounded.payload.content),
      bounded_read_truncated: bounded.payload.truncated,
      parent_traversal_code: parent.control.error.code,
      prefix_sibling_code: prefixSibling.control.error.code,
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
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`VS Code Claude file-browser E2E: FAIL (${error.stack || error.message})`);
    process.exitCode = 1;
  });
}

module.exports = { main };
