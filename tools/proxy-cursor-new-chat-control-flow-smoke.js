#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-cursor-new-chat-flow-'));
process.env.SESSION_STORE_PATH = path.join(tempDir, 'session-store.json');

const selectors = require('../agent-proxy/selectors');
const cursorSelectors = require('../agent-proxy/cursor-selectors');
const sessionStore = require('../agent-proxy/session-store');
const { ProxyEngine } = require('../agent-proxy/proxy-engine');

async function main() {
  const priorCursorNew = cursorSelectors.newCursorAgent;
  const priorCursorList = cursorSelectors.readCursorAgentList;
  const priorCodexNew = selectors.newCodexChat;
  const priorUpdate = sessionStore.updateSession;
  try {
    let cursorCalls = 0;
    let codexCalls = 0;
    cursorSelectors.newCursorAgent = async () => {
      cursorCalls += 1;
      return { ok: true };
    };
    cursorSelectors.readCursorAgentList = async () => [];
    selectors.newCodexChat = async () => {
      codexCalls += 1;
      return true;
    };
    sessionStore.updateSession = () => {};

    const engine = new ProxyEngine({ cdpPorts: [], relayUrl: 'ws://127.0.0.1:1/proxy-ws' });
    const sessionId = 'cursor-new-chat-flow';
    const relayed = [];
    engine.sessions.set(sessionId, {
      agentType: 'cursor',
      client: { Runtime: {}, Input: {} },
      _cursorAgentHistories: {},
      _accumulatedMessages: [],
    });
    engine._cacheCursorActiveTranscript = () => {};
    engine._broadcastSessionSnapshot = () => {};
    engine._sendToRelay = message => {
      relayed.push(message);
      return true;
    };

    await engine._handleRelayMessage({
      type: 'new_chat',
      session_id: sessionId,
      request_id: 'cursor-new-chat-request',
    });

    assert.strictEqual(cursorCalls, 1, 'Cursor New Agent was not invoked exactly once');
    assert.strictEqual(codexCalls, 0, 'Cursor new_chat fell through to the generic Codex control');
    assert(relayed.some(message => (
      message.type === 'agent_control_result'
      && message.request_id === 'cursor-new-chat-request'
      && message.result === 'ok'
    )), 'Cursor new_chat did not emit a successful terminal result');
    assert.strictEqual(engine._navigationOperations.size, 0, 'new_chat retained navigation queue state');

    console.log('PASS Cursor new_chat executes one native control without Codex fallthrough');
  } finally {
    cursorSelectors.newCursorAgent = priorCursorNew;
    cursorSelectors.readCursorAgentList = priorCursorList;
    selectors.newCodexChat = priorCodexNew;
    sessionStore.updateSession = priorUpdate;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
