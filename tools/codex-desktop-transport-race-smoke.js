#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  ProxyEngine,
  codexArchiveAppendContainsExactUser,
  countExactCodexUserMessages,
  isClosedCdpTransportError,
  shouldRetainCodexDesktopPermissionTimeout,
} = require('../agent-proxy/proxy-engine');
const codexCli = require('../agent-proxy/codex-cli');

async function main() {
  assert(isClosedCdpTransportError(new Error('WebSocket is not open: readyState 3 (CLOSED)')));
  assert(!isClosedCdpTransportError(new Error('Runtime.evaluate timed out after 1500ms')));
  assert.strictEqual(countExactCodexUserMessages([
    { role: 'user', content: 'same   text' },
    { role: 'assistant', content: 'same text' },
  ], 'same text'), 1);
  assert(codexArchiveAppendContainsExactUser([
    JSON.stringify({
      type: 'response_item',
      payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'same   text' }] },
    }),
    JSON.stringify({
      type: 'event_msg',
      payload: { type: 'user_message', message: 'same text' },
    }),
  ].join('\n'), 'same text'));
  assert(!codexArchiveAppendContainsExactUser(JSON.stringify({
    type: 'response_item',
    payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'same text' }] },
  }), 'same text'));
  assert(shouldRetainCodexDesktopPermissionTimeout(
    { agentType: 'codex-desktop' },
    new Error('permission poll timeout after 10ms'),
  ));

  const priorHeld = process.env.CODEX_DESKTOP_CDP_LOCK_HELD;
  process.env.CODEX_DESKTOP_CDP_LOCK_HELD = '1';
  try {
    const engine = new ProxyEngine({
      cdpPorts: [],
      relayUrl: 'ws://127.0.0.1:1/proxy-ws',
      codexDesktopPermissionPollTimeoutMs: 10,
    });
    const sessionId = 'codex-desktop-permission-race-smoke';
    let closed = false;
    const logs = [];
    const session = {
      agentType: 'codex-desktop',
      targetId: 'FAKE_CODEX_DESKTOP_TARGET',
      client: { Runtime: {} },
    };
    engine.on('log', (level, message) => logs.push({ level, message }));
    engine._pollPermissions = async () => new Promise(resolve => setTimeout(resolve, 40));
    engine._safeClose = async () => { closed = true; };
    engine.sessions.set(sessionId, session);

    await engine._pollPermissionsBounded(sessionId);
    assert.strictEqual(closed, false, 'transient Codex Desktop permission timeout closed the shared client');
    assert.strictEqual(engine.sessions.get(sessionId), session, 'transient timeout removed the Codex Desktop session');
    assert(session._permissionPollBackoffUntil > Date.now());
    assert(logs.some(entry => /retaining shared CDP client/.test(entry.message)));
    await new Promise(resolve => setTimeout(resolve, 50));

    const oldClient = { Runtime: {}, _ws: { readyState: 3 } };
    const newClient = { Runtime: {}, _ws: { readyState: 1 } };
    const priorSession = {
      agentType: 'codex-desktop',
      client: oldClient,
      _activeThreadKey: 'local:owned-thread',
    };
    const reboundSession = {
      agentType: 'codex-desktop',
      client: newClient,
      _activeThreadKey: 'local:owned-thread',
    };
    engine.sessions.set(sessionId, reboundSession);
    engine._readCodexDesktopActiveThread = async () => 'local:owned-thread';

    let sends = 0;
    engine._sendSessionMessage = async sessionArg => {
      assert.strictEqual(sessionArg, reboundSession);
      sends += 1;
      return { ok: true, method: 'fixture_retry' };
    };
    engine._readCodexDesktopRecentMessages = async () => JSON.stringify([]);
    const retried = await engine._recoverCodexDesktopSendAfterTransportLoss(
      sessionId,
      priorSession,
      'unique recovery prompt',
      { ok: false, code: 'native_user_turn_not_observed', baseline_matches: 0 },
    );
    assert.strictEqual(retried.result.ok, true);
    assert.strictEqual(sends, 1, 'verified-absent send did not retry exactly once');

    sends = 0;
    engine._readCodexDesktopRecentMessages = async () => JSON.stringify([
      { role: 'user', content: 'unique recovery prompt' },
    ]);
    const receiptRecovered = await engine._recoverCodexDesktopSendAfterTransportLoss(
      sessionId,
      priorSession,
      'unique recovery prompt',
      { ok: false, code: 'native_user_turn_not_observed', baseline_matches: 0 },
    );
    assert.strictEqual(receiptRecovered.result.ok, true);
    assert.strictEqual(receiptRecovered.result.method, 'cdp_rebind_receipt_recovered');
    assert.strictEqual(sends, 0, 'recovered native receipt caused a duplicate send');

    engine._readCodexDesktopActiveThread = async () => 'local:different-thread';
    const wrongThread = await engine._recoverCodexDesktopSendAfterTransportLoss(
      sessionId,
      priorSession,
      'unique recovery prompt',
      { ok: false, code: 'native_user_turn_not_observed', baseline_matches: 0 },
    );
    assert.strictEqual(wrongThread.result.ok, false);
    assert.strictEqual(wrongThread.result.code, 'codex_desktop_thread_changed');
    assert.strictEqual(sends, 0, 'wrong-thread recovery attempted a send');

    const originalReadSessionSummary = codexCli.readSessionSummary;
    const originalFindRecentSessionByUserAnchor = codexCli.findRecentSessionByUserAnchor;
    const originalFindRecentSessionByUserAnchors = codexCli.findRecentSessionByUserAnchors;
    try {
      let archiveMessages = [{ role: 'user', content: 'repeatable prompt' }];
      codexCli.readSessionSummary = filePath => ({
        filePath,
        cliSessionId: 'owned-native-archive',
        messages: archiveMessages.slice(),
      });
      codexCli.findRecentSessionByUserAnchor = (anchor, options) => {
        assert.strictEqual(anchor, 'owned provisional archive anchor with enough exact words to exceed the strict eighty character identity threshold safely');
        assert(Number(options?.sinceMs) > 0);
        return codexCli.readSessionSummary('C:\\fixture\\owned-native-archive.jsonl');
      };
      codexCli.findRecentSessionByUserAnchors = (anchors, options) => {
        assert.deepStrictEqual(anchors, [
          'owned provisional archive anchor one with enough exact words to exceed the strict eighty character identity threshold safely',
          'owned provisional archive anchor two with enough exact words to exceed the strict eighty character identity threshold safely',
        ]);
        assert.strictEqual(options?.sinceMs, 0);
        assert.strictEqual(options?.maxFiles, 100);
        return codexCli.readSessionSummary('C:\\fixture\\owned-native-archive.jsonl');
      };
      const archiveSession = {
        agentType: 'codex-desktop',
        client: newClient,
        _activeThreadKey: 'local:client-new-thread:owned-placeholder',
        codexDesktopActiveThreadKey: 'local:client-new-thread:owned-placeholder',
        _codexDesktopArchivePath: null,
        _accumulatedMessages: [
          {
            role: 'user',
            content: 'stale operator thread anchor that must never identify the currently active provisional archive even when it exceeds eighty characters',
          },
        ],
      };
      engine.sessions.set(sessionId, archiveSession);
      engine._readCodexDesktopActiveThread = async () => 'local:client-new-thread:owned-placeholder';
      engine._readCodexDesktopRecentMessages = async () => JSON.stringify([
        {
          role: 'user',
          content: 'owned provisional archive anchor one with enough exact words to exceed the strict eighty character identity threshold safely',
        },
        {
          role: 'user',
          content: 'owned provisional archive anchor two with enough exact words to exceed the strict eighty character identity threshold safely',
        },
      ]);
      const archiveBaseline = await engine._captureCodexDesktopArchiveReceiptBaseline(
        sessionId,
        archiveSession,
        'repeatable prompt',
      );
      assert.strictEqual(archiveBaseline.exact_user_matches, 1);
      assert.strictEqual(archiveSession._codexDesktopArchivePath, 'C:\\fixture\\owned-native-archive.jsonl');
      archiveMessages.push({ role: 'user', content: 'repeatable prompt' });
      const archiveReceipt = await engine._confirmCodexDesktopArchiveReceipt(
        sessionId,
        archiveSession,
        'repeatable prompt',
        archiveBaseline,
      );
      assert.deepStrictEqual(archiveReceipt, {
        ok: true,
        method: 'codex_desktop_archive_receipt_confirmed',
      });
      engine._readCodexDesktopActiveThread = async () => 'local:different-thread';
      const crossThreadReceipt = await engine._confirmCodexDesktopArchiveReceipt(
        sessionId,
        archiveSession,
        'repeatable prompt',
        archiveBaseline,
      );
      assert.strictEqual(crossThreadReceipt, null, 'archive receipt crossed active-thread identity');

      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-codex-receipt-'));
      const archivePath = path.join(tempDir, 'owned.jsonl');
      try {
        fs.writeFileSync(archivePath, `${JSON.stringify({
          type: 'response_item',
          payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'older prompt' }] },
        })}\n`, 'utf8');
        archiveSession._codexDesktopArchivePath = archivePath;
        archiveMessages = [{ role: 'user', content: 'older prompt' }];
        engine._readCodexDesktopActiveThread = async () => 'local:client-new-thread:owned-placeholder';
        const appendBaseline = await engine._captureCodexDesktopArchiveReceiptBaseline(
          sessionId,
          archiveSession,
          'repeatable prompt',
        );
        assert(Number.isFinite(appendBaseline.archive_offset));
        fs.appendFileSync(archivePath, `${JSON.stringify({
          type: 'event_msg',
          payload: { type: 'user_message', message: 'repeatable   prompt' },
        })}\n`, 'utf8');
        const appendReceipt = await engine._confirmCodexDesktopArchiveReceipt(
          sessionId,
          archiveSession,
          'repeatable prompt',
          appendBaseline,
        );
        assert.deepStrictEqual(appendReceipt, {
          ok: true,
          method: 'codex_desktop_archive_append_receipt',
        });
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } finally {
      codexCli.readSessionSummary = originalReadSessionSummary;
      codexCli.findRecentSessionByUserAnchor = originalFindRecentSessionByUserAnchor;
      codexCli.findRecentSessionByUserAnchors = originalFindRecentSessionByUserAnchors;
    }

    const historyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-codex-receipt-history-'));
    try {
      const historyArchive = path.join(
        historyDir,
        'rollout-2026-07-14T00-00-03-dddddddd-dddd-dddd-dddd-dddddddddddd.jsonl',
      );
      const anchor = `owned receipt history anchor ${'h'.repeat(90)}`;
      const appendedToken = 'RAC_CODEX_DESKTOP_RECEIPT_HISTORY_APPEND';
      const initialArchiveEntries = [
        { role: 'user', text: anchor },
        { role: 'assistant', text: 'older owned reply' },
      ].map((entry, index) => JSON.stringify({
        timestamp: new Date(Date.now() + index).toISOString(),
        type: 'response_item',
        payload: {
          type: 'message',
          role: entry.role,
          content: [{ type: entry.role === 'user' ? 'input_text' : 'output_text', text: entry.text }],
        },
      }));
      fs.writeFileSync(historyArchive, `${initialArchiveEntries.join('\n')}\n`, 'utf8');
      const baselineSummary = codexCli.readSessionSummary(historyArchive);
      const staleDom = [
        { role: 'user', content: anchor },
        { role: 'assistant', content: 'older owned reply' },
        { role: 'assistant', type: 'terminal', content: 'older structured output' },
      ];
      const historySession = {
        agentType: 'codex-desktop',
        _activeThreadKey: 'local:client-new-thread:owned-history-placeholder',
        _codexDesktopArchivePath: historyArchive,
        _codexDesktopArchiveCliSessionId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
        _lastCodexDesktopArchiveCheckAt: 0,
        _accumulatedMessages: staleDom.slice(),
        _codexDesktopArchiveUpdatedAt: baselineSummary.updatedAt,
        _codexDesktopArchiveSizeBytes: baselineSummary.sizeBytes,
        pendingLast: { role: 'assistant', content: 'stale native assistant tail' },
        waitingForAssistant: true,
        thinking: true,
        activity: { kind: 'generating', label: 'Generating' },
        status: 'healthy',
      };
      const unchangedHistory = engine._maybeUseCodexDesktopArchive(
        'codex-desktop-receipt-history-smoke',
        historySession,
        staleDom,
      );
      assert.strictEqual(unchangedHistory, staleDom);
      assert.strictEqual(
        historySession._codexDesktopArchivePollSettledActivity,
        null,
        'unchanged pre-send archive falsely cleared the active turn',
      );

      const appendBase = Date.now() + 10;
      const appendedEntries = [
        {
          timestamp: new Date(appendBase).toISOString(),
          type: 'event_msg',
          payload: { type: 'task_started' },
        },
        {
          timestamp: new Date(appendBase + 1).toISOString(),
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: `new prompt ${appendedToken}` }],
          },
        },
        {
          timestamp: new Date(appendBase + 2).toISOString(),
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: appendedToken }],
          },
        },
        {
          timestamp: new Date(appendBase + 3).toISOString(),
          type: 'event_msg',
          payload: { type: 'task_complete' },
        },
      ].map(entry => JSON.stringify(entry));
      fs.appendFileSync(historyArchive, `${appendedEntries.join('\n')}\n`, 'utf8');
      historySession._lastCodexDesktopArchiveCheckAt = 0;
      const recoveredHistory = engine._maybeUseCodexDesktopArchive(
        'codex-desktop-receipt-history-smoke',
        historySession,
        staleDom,
      );
      assert(
        recoveredHistory.some(message => String(message.content || '').includes(appendedToken)),
        'receipt-confirmed provisional archive append did not refresh relay history',
      );
      assert.strictEqual(historySession._codexDesktopArchivePath, historyArchive);
      assert.strictEqual(historySession._codexDesktopArchivePollSettledActivity?.kind, 'idle');
      const relayEvents = [];
      engine._sendToRelay = message => relayEvents.push(message);
      engine._processMessageQueue = () => {};
      assert.strictEqual(
        engine._applyCodexDesktopArchiveSettledActivity(
          'codex-desktop-receipt-history-smoke',
          historySession,
        ),
        true,
      );
      assert.strictEqual(historySession.activity.kind, 'idle');
      assert.strictEqual(historySession.pendingLast, null);
      assert.strictEqual(historySession.waitingForAssistant, false);
      assert.strictEqual(historySession.thinking, false);
      assert(relayEvents.some(message => message?.activity?.kind === 'idle'));
    } finally {
      fs.rmSync(historyDir, { recursive: true, force: true });
    }

    const priorUserProfile = process.env.USERPROFILE;
    const resolverHome = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-codex-anchor-resolver-'));
    try {
      process.env.USERPROFILE = resolverHome;
      const sessionsDir = path.join(resolverHome, '.codex', 'sessions', '2026', '07', '14');
      fs.mkdirSync(sessionsDir, { recursive: true });
      const anchorA = `owned archive anchor alpha ${'a'.repeat(90)}`;
      const anchorB = `owned archive anchor beta ${'b'.repeat(90)}`;
      const anchorC = `owned archive anchor gamma ${'c'.repeat(90)}`;
      const writeArchive = (name, anchors) => {
        const body = anchors.map((text, index) => JSON.stringify({
          timestamp: new Date(Date.now() + index).toISOString(),
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text }],
          },
        })).join('\n');
        fs.writeFileSync(path.join(sessionsDir, name), `${body}\n`, 'utf8');
      };
      writeArchive('rollout-2026-07-14T00-00-00-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jsonl', [anchorA, anchorB]);
      writeArchive('rollout-2026-07-14T00-00-01-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.jsonl', [anchorA, anchorC]);

      const unique = codexCli.findRecentSessionByUserAnchors([anchorA, anchorB], {
        sinceMs: Date.now() - 60_000,
        maxFiles: 40,
      });
      assert(unique?.filePath.endsWith('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jsonl'));
      assert.strictEqual(
        codexCli.findRecentSessionByUserAnchors([anchorA], { sinceMs: Date.now() - 60_000 }),
        null,
        'a non-first user anchor was accepted without a second exact identity anchor',
      );

      writeArchive('rollout-2026-07-14T00-00-02-cccccccc-cccc-cccc-cccc-cccccccccccc.jsonl', [anchorA, anchorB]);
      assert.strictEqual(
        codexCli.findRecentSessionByUserAnchors([anchorA, anchorB], {
          sinceMs: Date.now() - 60_000,
          maxFiles: 40,
        }),
        null,
        'ambiguous multi-anchor archive resolution did not fail closed',
      );
    } finally {
      if (priorUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = priorUserProfile;
      fs.rmSync(resolverHome, { recursive: true, force: true });
    }
  } finally {
    if (priorHeld === undefined) delete process.env.CODEX_DESKTOP_CDP_LOCK_HELD;
    else process.env.CODEX_DESKTOP_CDP_LOCK_HELD = priorHeld;
  }

  console.log('PASS Codex Desktop permission/send CDP race, exact-thread rebind, and duplicate suppression');
}

if (require.main === module) {
  main().catch(error => {
    console.error(`FAIL Codex Desktop transport race smoke: ${error.stack || error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { main };
