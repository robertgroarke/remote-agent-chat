#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const proxySource = fs.readFileSync(path.join(__dirname, '..', 'agent-proxy', 'proxy-engine.js'), 'utf8');
assert(proxySource.includes('_sendFileBackedTranscriptUpdate('),
  'file-backed CLIs must use the semantic append/update contract');
assert(!proxySource.includes('_sendCodexCliLiveTailChunk(')
  && !proxySource.includes('_sendCursorCliLiveTailChunk('),
  'ordinary CLI changes must not emit requestless full-tail chunks');
assert(proxySource.includes("agentType: 'claude_cli'")
  && proxySource.includes("agentType: 'codex_cli'")
  && proxySource.includes("agentType: 'cursor_cli'"),
  'Claude, Codex, and Cursor CLI paths must all use the shared incremental transport');
assert(proxySource.includes('resyncId') && proxySource.includes('minResyncIntervalMs = 5000'),
  'mutation recovery must be identified and rate-limited');

const codexCliSendSection = proxySource.slice(
  proxySource.indexOf('_sendCodexCliMessage(session, content, sessionId'),
  proxySource.indexOf('// ─── Cursor CLI session helpers'),
);
assert(
  /if \(session\.messageQueue\?\.length\) \{\s*await this\._processMessageQueue\(sessionId\);\s*\}/.test(codexCliSendSection),
  'Codex CLI native-process exit must drain turns queued after parsed task completion',
);

console.log('PASS CLI file-backed semantic append and bounded recovery contract');
