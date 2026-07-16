#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const fidelity = require('./run-fidelity-regression');

const ROOT = path.resolve(__dirname, '..');
const NATIVE_SESSION_ID = '5b58a6de-92af-4b8d-a777-e5d5ac556793';
const MARKER = 'RAC_CLAUDE_NATIVE_TOOLS_0A20B8E3';
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const canonicalTextBytes = bytes => Buffer.from(Buffer.from(bytes).toString('utf8').replace(/\r\n/g, '\n'), 'utf8');

function parseArgs(argv) {
  const options = { readOnlyProduction: false, envRoot: '', browserReceipt: '', output: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--read-only-production') options.readOnlyProduction = true;
    else if (arg === '--env-root') options.envRoot = path.resolve(argv[++index] || '');
    else if (arg === '--browser-receipt') options.browserReceipt = path.resolve(argv[++index] || '');
    else if (arg === '--output') options.output = path.resolve(argv[++index] || '');
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  assert(options.readOnlyProduction, 'Explicit --read-only-production is required');
  assert(options.envRoot, '--env-root is required');
  assert(options.browserReceipt, '--browser-receipt is required');
  assert(options.output, '--output is required');
  const relative = path.relative(path.join(ROOT, 'evidence'), options.output);
  assert(relative && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
    '--output must stay under this checkout evidence tree');
  return options;
}

function ruleBodyAfter(css, selector) {
  const start = css.indexOf(selector);
  assert(start >= 0, `served stylesheet is missing selector: ${selector}`);
  const open = css.indexOf('{', start + selector.length);
  const close = css.indexOf('}', open + 1);
  assert(open >= 0 && close > open, `served stylesheet has an incomplete rule: ${selector}`);
  return css.slice(open + 1, close);
}

function waitForMessage(messages, predicate, timeoutMs, label) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      const match = messages.find(predicate);
      if (match) {
        clearInterval(timer);
        resolve(match);
      } else if (Date.now() - startedAt >= timeoutMs) {
        clearInterval(timer);
        reject(new Error(`Timed out waiting for ${label}`));
      }
    }, 25);
  });
}

async function openRelay(origin, token, WebSocket) {
  const messages = [];
  const wsUrl = origin.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:')
    + `/client-ws?token=${encodeURIComponent(token)}`;
  const ws = new WebSocket(wsUrl, { headers: { Origin: 'http://127.0.0.1:3500' } });
  ws.on('message', raw => {
    try { messages.push(JSON.parse(String(raw))); } catch {}
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Relay connection timed out')), 15_000);
    ws.once('open', () => {
      clearTimeout(timer);
      ws.send(JSON.stringify({
        type: 'connection_hello',
        protocol_version: 1,
        peer_role: 'browser',
        client_name: 'claude-cli-native-tools-production-e2e',
      }));
      resolve();
    });
    ws.once('error', reject);
  });
  const ack = await waitForMessage(messages, message => message.type === 'connection_ack', 15_000,
    'production connection acknowledgement');
  return { ws, messages, ack };
}

async function requestHistory(relay, sessionId) {
  const requestId = `claude-cli-native-tools-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  relay.ws.send(JSON.stringify({
    type: 'history_chunk_request',
    session_id: sessionId,
    session: sessionId,
    request_id: requestId,
    mode: 'tail',
    source: 'relay_sqlite',
    limit: 500,
  }));
  return waitForMessage(relay.messages,
    message => message.type === 'history_chunk' && message.request_id === requestId,
    15_000, 'request-correlated native-tools history');
}

function externalHeaders(publicUrl, token) {
  return {
    Host: new URL(publicUrl).host,
    'X-Forwarded-For': '203.0.113.10',
    'X-Forwarded-Proto': 'https',
    Authorization: `Bearer ${token}`,
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
  };
}

async function fetchBytes(url, headers) {
  const response = await fetch(url, { headers, cache: 'no-store', redirect: 'manual' });
  assert.equal(response.status, 200, `${url} returned HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const deployEnv = fidelity.loadEnvFile(path.join(options.envRoot, '.env'));
  const relayEnv = fidelity.loadEnvFile(path.join(options.envRoot, 'relay-server', '.env'));
  const relayIp = deployEnv.RELAY_IP;
  const relayPort = deployEnv.RELAY_PORT || '3500';
  const publicUrl = String(relayEnv.PUBLIC_URL || '').replace(/\/+$/, '');
  const token = fidelity.buildBearerToken(relayEnv);
  assert(relayIp, 'explicit environment root is missing RELAY_IP');
  assert(publicUrl, 'explicit environment root is missing PUBLIC_URL');
  assert(token, 'JWT bearer token could not be built from the explicit environment root');
  const origin = `http://${relayIp}:${relayPort}`;
  const WebSocket = require(path.join(options.envRoot, 'relay-server', 'node_modules', 'ws'));

  const localWorker = fs.readFileSync(path.join(ROOT, 'frontend', 'sw.js'));
  const localStyles = fs.readFileSync(path.join(ROOT, 'frontend', 'styles.css'));
  const assetVersion = localWorker.toString('utf8').match(/const ASSET_VERSION = '([^']+)'/)?.[1];
  assert(assetVersion, 'exact source service worker is missing ASSET_VERSION');
  const headers = externalHeaders(publicUrl, token);
  const nonce = Date.now();
  const [servedWorker, servedStyles] = await Promise.all([
    fetchBytes(`${origin}/sw.js?claude_cli_native_tools=${nonce}`, headers),
    fetchBytes(`${origin}/styles.css?v=${encodeURIComponent(assetVersion)}&claude_cli_native_tools=${nonce}`, headers),
  ]);
  const servedWorkerText = servedWorker.toString('utf8');
  const servedStylesText = servedStyles.toString('utf8');
  assert.equal((servedWorkerText.match(/const ASSET_VERSION = '([^']+)'/) || [])[1] || '', assetVersion,
    'served asset version differs from exact source');
  assert.equal(sha256(canonicalTextBytes(servedStyles)), sha256(canonicalTextBytes(localStyles)),
    'served stylesheet differs semantically from exact source');

  const toolRule = ruleBodyAfter(servedStylesText,
    ':root[data-theme="dark"] .harness-theme-claude_cli details.content-block-tool,');
  const toolStatusRule = ruleBodyAfter(servedStylesText,
    ':root[data-theme="dark"] .harness-theme-claude_cli details.content-block-tool .content-block-status,');
  const toolBodyRule = ruleBodyAfter(servedStylesText,
    ':root[data-theme="dark"] .harness-theme-claude_cli details.content-block-tool > .content-block-pre,');
  const planRule = ruleBodyAfter(servedStylesText,
    ':root[data-theme="dark"] .harness-theme-claude_cli .content-block-plan');
  const pendingRule = ruleBodyAfter(servedStylesText,
    ':root[data-theme="dark"] .harness-theme-claude_cli .content-block-plan-item.pending .content-block-plan-marker::before');
  const activeRule = ruleBodyAfter(servedStylesText,
    ':root[data-theme="dark"] .harness-theme-claude_cli .content-block-plan-item.in_progress');
  const completedMarkerRule = ruleBodyAfter(servedStylesText,
    ':root[data-theme="dark"] .harness-theme-claude_cli .content-block-plan-item.completed .content-block-plan-marker');
  const completedGlyphRule = ruleBodyAfter(servedStylesText,
    ':root[data-theme="dark"] .harness-theme-claude_cli .content-block-plan-item.completed .content-block-plan-marker::before');
  const cssMarkers = {
    flat_tool_rows: /border-left:\s*0;/.test(toolRule) && /padding-left:\s*0;/.test(toolRule),
    tool_status_pill_hidden: /display:\s*none;/.test(toolStatusRule),
    tool_body_transparent: /border:\s*0;/.test(toolBodyRule) && /background:\s*transparent;/.test(toolBodyRule),
    flat_plan: /border-left:\s*0;/.test(planRule) && /padding-left:\s*0;/.test(planRule),
    pending_square: /content:\s*"\\25A1";/.test(pendingRule),
    active_orange: /color:\s*#d97757;/.test(activeRule),
    completed_green: /color:\s*#4ade80;/.test(completedMarkerRule),
    completed_check: /content:\s*"\\2713";/.test(completedGlyphRule),
  };
  assert(Object.values(cssMarkers).every(Boolean),
    `served Claude CLI native tool/plan markers are incomplete: ${JSON.stringify(cssMarkers)}`);

  const relay = await openRelay(origin, token, WebSocket);
  try {
    assert(Array.isArray(relay.ack.sessions), 'connection acknowledgement omitted production inventory');
    assert.equal((relay.ack.duplicate_proxy_alarms || []).length, 0, 'production has duplicate proxy alarms');
    const session = relay.ack.sessions.find(candidate => candidate.cli_session_id === NATIVE_SESSION_ID);
    assert(session, 'retained native-tools session is absent from production inventory');
    assert.equal(session.agent_type, 'claude_cli');
    assert.equal(session.permission_mode, 'dontAsk');
    const history = await requestHistory(relay, session.session_id);
    const messages = history.messages || [];
    const blocks = messages.flatMap((message, messageIndex) =>
      (message.content_blocks || []).map((block, blockIndex) => ({ messageIndex, blockIndex, ...block })));
    const plans = blocks.filter(block => block.type === 'plan');
    const toolCalls = blocks.filter(block => block.type === 'tool_call');
    const toolResults = blocks.filter(block => block.type === 'tool_result');
    const genericTaskCards = blocks.filter(block =>
      /^(?:TaskCreate|TaskGet|TaskUpdate|TaskList)$/.test(block.tool_name || '')
      && (block.type === 'tool_call' || block.type === 'tool_result'));
    assert.equal(messages.length, 6, 'production history must preserve the six-message retained conversation');
    assert.deepStrictEqual(blocks.map(block => block.type),
      ['thinking', 'plan', 'tool_call', 'tool_result', 'markdown']);
    assert.equal(plans.length, 1);
    assert.equal(plans[0].title, '2 tasks (2 done, 0 open)');
    assert.equal(plans[0].status, 'completed');
    assert.deepStrictEqual(plans[0].tasks.map(task => ({ step: task.step, status: task.status })), [
      { step: 'Read fixture', status: 'completed' },
      { step: 'Report token', status: 'completed' },
    ]);
    assert.equal(toolCalls.length, 1);
    assert.equal(toolCalls[0].tool_name, 'Read');
    assert.equal(toolCalls[0].status, 'completed');
    assert.equal(toolResults.length, 1);
    assert.equal(toolResults[0].tool_name, 'Read');
    assert.equal(toolResults[0].status, 'completed');
    assert.equal(genericTaskCards.length, 0, 'current Task operations fanned out into generic cards');
    assert(messages.some(message => JSON.stringify(message).includes(MARKER)), 'final marker is missing');

    const browserReceipt = JSON.parse(fs.readFileSync(options.browserReceipt, 'utf8'));
    assert.equal(browserReceipt.ok, true, 'passive browser receipt is not green');
    assert.equal(browserReceipt.pages, 1, 'passive browser receipt did not retain exactly one page');
    assert.equal(browserReceipt.expected_asset_version, assetVersion);
    assert.equal(browserReceipt.served_asset_version, assetVersion);
    assert.equal(browserReceipt.stylesheet.exact_source_match, true);
    assert(Object.values(browserReceipt.automation).every(value => value === 0),
      'passive browser receipt contains a mutating action');

    const result = {
      ok: true,
      generated_at: new Date().toISOString(),
      exact_source_commit: execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: ROOT,
        encoding: 'utf8',
        windowsHide: true,
      }).trim(),
      asset_version: assetVersion,
      production_assets: {
        origin,
        service_worker_sha256: sha256(servedWorker),
        stylesheet_sha256: sha256(servedStyles),
        stylesheet_canonical_sha256: sha256(canonicalTextBytes(servedStyles)),
        exact_source_match: true,
        css_markers: cssMarkers,
      },
      relay: {
        session_count: relay.ack.sessions.length,
        duplicate_proxy_alarms: 0,
        session_id: session.session_id,
        cli_session_id: session.cli_session_id,
        agent_type: session.agent_type,
        permission_mode: session.permission_mode,
      },
      history: {
        message_count: messages.length,
        block_types: blocks.map(block => block.type),
        plan: {
          title: plans[0].title,
          status: plans[0].status,
          tasks: plans[0].tasks,
        },
        tool_call: { tool_name: toolCalls[0].tool_name, title: toolCalls[0].title, status: toolCalls[0].status },
        tool_result: { tool_name: toolResults[0].tool_name, title: toolResults[0].title, status: toolResults[0].status },
        generic_task_cards: genericTaskCards.length,
        final_marker_present: true,
      },
      browser: {
        receipt: path.relative(ROOT, options.browserReceipt).replace(/\\/g, '/'),
        pages: browserReceipt.pages,
        loaded_asset_version_before: browserReceipt.page.loaded_asset_version_before,
        loaded_asset_version_after: browserReceipt.page.loaded_asset_version_after,
        selected_session_unchanged: browserReceipt.page.selected_session_unchanged,
      },
      safety: {
        read_only: true,
        sends: 0,
        controls: 0,
        page_navigations: 0,
        page_reloads: 0,
        focus_actions: 0,
        dom_mutations: 0,
        visible_windows_opened: 0,
        protected_session_mutations: 0,
        proxy_restarts: 0,
        relay_deploys: 0,
      },
    };
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
  } finally {
    relay.ws.close();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Claude CLI native tools production E2E: FAIL (${error.stack || error.message || error})`);
    process.exit(1);
  });
}

module.exports = { main, parseArgs, ruleBodyAfter };
