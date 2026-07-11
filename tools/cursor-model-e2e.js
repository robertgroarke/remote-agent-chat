#!/usr/bin/env node
'use strict';
// Relay model round-trip on the guarded cursor-test session, with native group isolation.
const path = require('path');
const crypto = require('crypto');
const CDP = require(path.join(__dirname, '..', 'agent-proxy', 'node_modules', 'chrome-remote-interface'));
const WebSocket = require(path.join(__dirname, '..', 'relay-server', 'node_modules', 'ws'));
const cursorSel = require(path.join(__dirname, '..', 'agent-proxy', 'cursor-selectors'));
const guard = require(path.join(__dirname, '..', 'agent-proxy', 'cursor-probe-guard'));
const fidelity = require('./run-fidelity-regression');

const CDP_PORT = 9227;

function deriveRelayWsUrl() {
  const root = path.join(__dirname, '..');
  const relayEnv = fidelity.loadEnvFile(path.join(root, 'relay-server', '.env'));
  const proxyEnv = fidelity.loadEnvFile(path.join(root, 'agent-proxy', '.env'));
  const token = fidelity.buildBearerToken(relayEnv);
  const relayUrl = proxyEnv.RELAY_URL || '';
  const withToken = url => (token ? `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}` : url);
  if (relayUrl) return withToken(relayUrl.replace(/\/proxy-ws$/i, '/client-ws'));
  const base = fidelity.deriveRelayBaseUrl(null, relayEnv, proxyEnv) || 'http://127.0.0.1:3500';
  return withToken(base.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:').replace(/\/+$/, '') + '/client-ws');
}

function waitFor(predicate, timeoutMs, label) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const value = await predicate();
        if (value) return resolve(value);
      } catch (err) {
        return reject(err);
      }
      if (Date.now() - started > timeoutMs) return reject(new Error(`Timed out waiting for ${label}`));
      setTimeout(tick, 300);
    };
    tick();
  });
}

function openRelay(url) {
  const ws = new WebSocket(url, { headers: { Origin: 'http://127.0.0.1:3500' } });
  const messages = [];
  ws.on('message', data => { try { messages.push(JSON.parse(data.toString())); } catch {} });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try { ws.terminate(); } catch {}
      reject(new Error('relay websocket timeout'));
    }, 30000);
    ws.once('open', () => {
      clearTimeout(timer);
      ws.send(JSON.stringify({
        type: 'connection_hello',
        protocol_version: 1,
        peer_role: 'browser',
        client_name: 'cursor-model-e2e',
      }));
      resolve({ ws, messages });
    });
    ws.once('error', reject);
  });
}

function latestSessions(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if ((msg.type === 'connection_ack' || msg.type === 'session_list' || msg.type === 'session_snapshot')
      && Array.isArray(msg.sessions)) return msg.sessions;
  }
  return [];
}

function sessionIdOf(session) {
  return typeof session === 'string' ? session : session?.session_id;
}

async function readNativeGroups(Runtime) {
  const result = await Runtime.evaluate({
    expression: `(() => {
      const norm = value => String(value || '').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\\s+/g, ' ').trim();
      const selected = document.querySelector('.agent-sidebar-cell[data-selected="true"]');
      const selectedTitle = norm(selected?.querySelector('.agent-sidebar-cell-text')?.textContent);
      const groups = [...document.querySelectorAll('.editor-group-container.has-composer-editor')].map(group => {
        const tab = [...group.querySelectorAll('.tab[aria-selected="true"]')][0];
        const trigger = group.querySelector('.ui-model-picker__trigger');
        return { title: norm(tab?.textContent), model: norm(trigger?.textContent) };
      });
      return { selectedTitle, groups };
    })()`,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  }
  return result.result?.value || { selectedTitle: '', groups: [] };
}

async function main() {
  const runId = crypto.randomBytes(4).toString('hex');
  const targets = await CDP.List({ port: CDP_PORT });
  const { page, blocked } = guard.pickProbePage(targets);
  if (blocked || !page) throw new Error(blocked || 'throwaway Cursor page not open');
  guard.assertProbeTarget(page, __filename);

  const client = await CDP({ port: CDP_PORT, target: page.id });
  await client.Runtime.enable();
  const initialAgents = await cursorSel.readCursorAgentList(client.Runtime);
  const initialActive = initialAgents.filter(agent => agent && agent.active);
  if (initialActive.length !== 1) {
    await client.close();
    throw new Error(`Need one active Cursor agent before model test, got ${initialActive.length}`);
  }
  const focused = await cursorSel.switchCursorAgent(client.Runtime, initialActive[0].id);
  if (!focused.ok) {
    await client.close();
    throw new Error(`Could not focus active Cursor agent before model test: ${focused.detail}`);
  }
  const beforeConfig = await cursorSel.readCursorConfig(client.Runtime);
  const beforeGroups = await readNativeGroups(client.Runtime);
  const original = beforeConfig.model_id;
  const originalOption = beforeConfig.available_models.find(item => item.id === original);
  const alternate = beforeConfig.available_models.find(item => item.label === 'Codex 5.3 Medium' && item.id !== original)
    || beforeConfig.available_models.find(item => item.id !== original);
  if (!originalOption || !alternate || alternate.id === original) {
    await client.close();
    throw new Error('Need a known current model and a distinct native alternate');
  }
  const selectedBefore = beforeGroups.groups.find(group => group.title === beforeGroups.selectedTitle);
  const otherBefore = beforeGroups.groups.filter(group => group.title !== beforeGroups.selectedTitle);
  if (!selectedBefore) {
    await client.close();
    throw new Error('Need a uniquely selected Cursor agent group');
  }

  const { ws, messages } = await openRelay(deriveRelayWsUrl());
  let restoreFailure = null;
  try {
    const session = await waitFor(() => guard.pickThrowawaySession(latestSessions(messages)), 45000, 'throwaway session');
    const sessionId = sessionIdOf(session);
    const baselineConfigRequestId = `config-baseline-${runId}-${Date.now()}`;
    ws.send(JSON.stringify({
      type: 'agent_config_request',
      session_id: sessionId,
      request_id: baselineConfigRequestId,
    }));
    await waitFor(
      () => messages.find(msg => msg.type === 'agent_config'
        && msg.request_id === baselineConfigRequestId
        && msg.model_id === original
        && Array.isArray(msg.available_models)
        && msg.available_models.length >= 2),
      30000,
      'baseline native agent_config'
    );
    const setThroughRelay = async (model, phase) => {
      const requestId = `model-${phase}-${runId}-${Date.now()}`;
      ws.send(JSON.stringify({
        type: 'agent_set_model',
        session_id: sessionId,
        model_id: model.id,
        request_id: requestId,
      }));
      const control = await waitFor(
        () => messages.find(msg => msg.type === 'agent_control_result' && msg.request_id === requestId),
        30000,
        `${phase} model control result`
      );
      if (control.result !== 'ok') {
        throw new Error(`${phase} failed: ${control.result} ${control.error?.message || ''}`);
      }
      await waitFor(async () => {
        const config = await cursorSel.readCursorConfig(client.Runtime);
        return config.model_id === model.id ? config : null;
      }, 15000, `${phase} native model`);

      const configRequestId = `config-${phase}-${runId}-${Date.now()}`;
      ws.send(JSON.stringify({
        type: 'agent_config_request',
        session_id: sessionId,
        request_id: configRequestId,
      }));
      const freshConfig = await waitFor(
        () => messages.find(msg => msg.type === 'agent_config'
          && msg.request_id === configRequestId
          && msg.model_id === model.id
          && Array.isArray(msg.available_models)
          && msg.available_models.length >= 2),
        30000,
        `${phase} fresh agent_config`
      );
      if (!freshConfig.available_models.some(option => option.id === originalOption.id)
          || !freshConfig.available_models.some(option => option.id === alternate.id)) {
        throw new Error(`${phase} agent_config lost native model choices`);
      }
    };

    try {
      await setThroughRelay(alternate, 'alternate');
      const afterGroups = await readNativeGroups(client.Runtime);
      const selectedAfter = afterGroups.groups.find(group => group.title === beforeGroups.selectedTitle);
      if (!selectedAfter || selectedAfter.model !== alternate.label) {
        throw new Error(`Selected group mismatch: ${selectedAfter?.model || 'absent'} != ${alternate.label}`);
      }
      for (const expected of otherBefore) {
        const actual = afterGroups.groups.find(group => group.title === expected.title);
        if (!actual || actual.model !== expected.model) {
          throw new Error(`Unselected group changed: ${expected.title} ${expected.model} -> ${actual?.model || 'absent'}`);
        }
      }
      console.log('alternate', alternate.id, alternate.label);
      console.log('unselected groups preserved', otherBefore);
    } finally {
      try {
        await setThroughRelay(originalOption, 'restore');
      } catch (err) {
        restoreFailure = err;
        const fallback = await cursorSel.setCursorModel(client.Runtime, original);
        if (!fallback.ok) throw new Error(`Relay restore failed (${err.message}); direct restore failed (${fallback.detail})`);
      }
    }

    const finalConfig = await cursorSel.readCursorConfig(client.Runtime);
    const finalGroups = await readNativeGroups(client.Runtime);
    const selectedFinal = finalGroups.groups.find(group => group.title === beforeGroups.selectedTitle);
    if (finalConfig.model_id !== original || selectedFinal?.model !== originalOption.label) {
      throw new Error(`Restore mismatch: ${finalConfig.model_id} / ${selectedFinal?.model || 'absent'}`);
    }
    if (restoreFailure) throw restoreFailure;
    console.log('restored', original, originalOption.label);
    console.log('PASS cursor model relay E2E');
  } finally {
    try { ws.close(); } catch {}
    try { await client.close(); } catch {}
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('FAIL', err.message);
    process.exit(1);
  });
}
