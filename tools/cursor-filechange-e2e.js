#!/usr/bin/env node
'use strict';
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const assert = require('assert');
const CDP = require(path.join(__dirname, '..', 'agent-proxy', 'node_modules', 'chrome-remote-interface'));
const WebSocket = require(path.join(__dirname, '..', 'relay-server', 'node_modules', 'ws'));
const cursorSel = require(path.join(__dirname, '..', 'agent-proxy', 'cursor-selectors'));
const guard = require(path.join(__dirname, '..', 'agent-proxy', 'cursor-probe-guard'));
const fidelity = require('./run-fidelity-regression');
const { OPERATION_LOCK_PATH, acquirePidLock } = require('./production-harness-overnight-soak');

const THROWAWAY_ROOT = path.resolve('C:\\temp\\cursor-test');
const README_PATH = path.join(THROWAWAY_ROOT, 'README.md');
const outputIndex = process.argv.indexOf('--output');
const outputPath = outputIndex >= 0 && process.argv[outputIndex + 1]
  ? path.resolve(process.argv[outputIndex + 1]) : null;
const forcePendingControls = process.argv.includes('--force-pending-controls');

function stripHarnessMarkers(content) {
  const source = String(content || '');
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const trailing = /\r?\n$/.test(source);
  const lines = source.split(/\r?\n/).filter(line => !/^RAC_FILECHG_E2E_[a-f0-9]+$/i.test(line.trim()));
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.join(eol) + (trailing ? eol : '');
}

function deriveRelayWsUrl() {
  const relayEnv = fidelity.loadEnvFile(path.join(__dirname, '..', 'relay-server', '.env'));
  const proxyEnv = fidelity.loadEnvFile(path.join(__dirname, '..', 'agent-proxy', '.env'));
  const token = fidelity.buildBearerToken(relayEnv);
  const relayUrl = proxyEnv.RELAY_URL || '';
  const withToken = (url) => (token ? `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}` : url);
  if (relayUrl) return withToken(relayUrl.replace(/\/proxy-ws$/i, '/client-ws'));
  const base = fidelity.deriveRelayBaseUrl(null, relayEnv, proxyEnv) || 'http://127.0.0.1:3500';
  return withToken(base.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:').replace(/\/+$/, '') + '/client-ws');
}

function waitFor(predicate, timeoutMs, label) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const v = await predicate();
        if (v) return resolve(v);
      } catch (e) {
        return reject(e);
      }
      if (Date.now() - started > timeoutMs) return reject(new Error(`Timed out: ${label}`));
      setTimeout(tick, 500);
    };
    tick();
  });
}

async function requestFileChanges(ws, messages, sessionId, runId, suffix) {
  const requestId = `fc-list-${runId}-${suffix}`;
  const before = messages.length;
  ws.send(JSON.stringify({ type: 'file_changes', session_id: sessionId, request_id: requestId }));
  await waitFor(
    () => messages.find(message => message.type === 'agent_control_result'
      && message.request_id === requestId && message.result === 'ok'),
    15000,
    `file_changes ack ${suffix}`,
  );
  const payload = await waitFor(
    () => messages.slice(before).find(message => message.type === 'file_changes'
      && (message.session_id === sessionId || message.session === sessionId)),
    15000,
    `file_changes payload ${suffix}`,
  );
  return payload.entries || [];
}

async function respondFileChange(ws, messages, sessionId, runId, entry, action, suffix) {
  const requestId = `fc-${action}-${runId}-${suffix}`;
  ws.send(JSON.stringify({
    type: 'file_change_response',
    session_id: sessionId,
    change_id: entry.id || entry.path,
    action,
    request_id: requestId,
  }));
  const result = await waitFor(
    () => messages.find(message => message.type === 'agent_control_result'
      && message.request_id === requestId),
    30000,
    `file_change_response ${action} ${suffix}`,
  );
  assert.equal(result.result, 'ok', `${action} failed: ${result.error?.message || result.result}`);
  return result;
}

async function waitForSingleChange(ws, messages, sessionId, runId, suffix) {
  const maxAttempts = Math.max(1, Number(process.env.CURSOR_FILECHANGE_LIST_ATTEMPTS || 24));
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const entries = await requestFileChanges(ws, messages, sessionId, runId, `${suffix}-${attempt}`);
    if (entries.length > 0) {
      assert.equal(entries.length, 1, `expected one deduplicated live file change, got ${entries.length}`);
      return entries[0];
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(`No live file change for ${suffix}`);
}

async function settleExistingChanges(ws, messages, sessionId, runId) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const entries = await requestFileChanges(ws, messages, sessionId, runId, `settle-${attempt}`);
    if (entries.length === 0) return;
    assert.equal(entries.length, 1, `expected one deduplicated pre-existing change, got ${entries.length}`);
    await respondFileChange(ws, messages, sessionId, runId, entries[0], 'accept', `settle-${attempt}`);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('Pre-existing Cursor file change did not settle');
}

async function captureFileChangeDiagnostic(Runtime) {
  const evaluated = await Runtime.evaluate({
    expression: `(() => {
      const norm = value => String(value || '').replace(/\\s+/g, ' ').trim();
      const visible = element => {
        const rect = element?.getBoundingClientRect?.();
        return !!rect && rect.width > 0 && rect.height > 0;
      };
      const root = document.body;
      const candidates = Array.from(root.querySelectorAll(
        'button, [role="button"], [data-click-ready], [class*="file"], [class*="edit"], [class*="diff"], [class*="undo"], [class*="keep"]'
      )).filter(element => visible(element) && /undo|keep|file|edit|diff|review/i.test(
        norm(element.innerText || element.textContent || element.getAttribute('aria-label') || '')
      ));
      return {
        root_tail: norm(root.innerText || '').slice(-3000),
        editor_groups: Array.from(document.querySelectorAll('.editor-group-container'))
          .filter(visible).map((element, index) => ({
            index,
            class_name: String(element.className || '').slice(0, 240),
            text_tail: norm(element.innerText || '').slice(-1600),
          })),
        candidates: candidates.slice(0, 120).map(element => {
          const rect = element.getBoundingClientRect();
          return {
            tag: element.tagName,
            class_name: String(element.className || '').slice(0, 240),
            text: norm(element.innerText || element.textContent || '').slice(0, 300),
            aria_label: element.getAttribute('aria-label'),
            click_ready: element.getAttribute('data-click-ready'),
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            parent_text: norm(element.parentElement?.innerText || '').slice(0, 300),
          };
        }),
      };
    })()`,
    returnByValue: true,
    silent: true,
  });
  return evaluated.result?.value || null;
}

async function openReviewForDiagnostic(cdp) {
  const pointResult = await cdp.Runtime.evaluate({
    expression: `(() => {
      const norm = value => String(value || '').replace(/\\s+/g, ' ').trim();
      const matches = Array.from(document.querySelectorAll(
        '[data-click-ready], button, [role="button"], a, div, span'
      )).filter(candidate => {
        const rect = candidate.getBoundingClientRect?.();
        return rect && rect.width > 0 && rect.height > 0
          && /^review$/i.test(norm(candidate.innerText || candidate.textContent
            || candidate.getAttribute('aria-label') || ''));
      });
      const element = matches.find(candidate => candidate.getAttribute('data-click-ready') === 'true')
        || matches[0];
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`,
    returnByValue: true,
    silent: true,
  });
  const point = pointResult.result?.value;
  if (!point) return null;
  await cdp.Input.dispatchMouseEvent({ type: 'mouseMoved', ...point });
  await cdp.Input.dispatchMouseEvent({ type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
  await cdp.Input.dispatchMouseEvent({ type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
  let diagnostic = null;
  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 100));
    diagnostic = await captureFileChangeDiagnostic(cdp.Runtime);
    const text = (diagnostic?.root_tail || '') + ' ' + JSON.stringify(diagnostic?.candidates || []);
    if (/accept|reject|discard|undo|keep/i.test(text)) break;
  }
  return diagnostic;
}

async function runOwnedSweep() {
  const runId = crypto.randomBytes(4).toString('hex');
  const keepMarker = `RAC_FILECHG_E2E_${runId}a`;
  const undoMarker = `RAC_FILECHG_E2E_${runId}b`;
  const originalReadme = fs.readFileSync(README_PATH, 'utf8');
  const cleanReadme = stripHarnessMarkers(originalReadme);
  const wsUrl = deriveRelayWsUrl();
  const ws = new WebSocket(wsUrl, { headers: { Origin: 'http://127.0.0.1:3500' } });
  const messages = [];
  let cdp = null;
  ws.on('message', (d) => { try { messages.push(JSON.parse(d.toString())); } catch {} });
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('ws timeout')), 30000);
    ws.once('open', () => {
      clearTimeout(t);
      ws.send(JSON.stringify({ type: 'connection_hello', protocol_version: 1, peer_role: 'browser', client_name: 'cursor-filechange-e2e' }));
      res();
    });
    ws.once('error', rej);
  });

  try {
    const session = await waitFor(() => {
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (!Array.isArray(m.sessions)) continue;
        return guard.pickThrowawaySession(m.sessions);
      }
      return null;
    }, 45000, 'session');

    const sessionId = session.session_id || session;
    assert.equal(path.resolve(session.workspace_path || '').toLowerCase(), THROWAWAY_ROOT.toLowerCase(),
      `refusing file-change test outside ${THROWAWAY_ROOT}`);

    const targets = await CDP.List({ port: 9227 });
    const { page, blocked } = guard.pickProbePage(targets);
    if (blocked || !page) throw new Error(blocked || 'no throwaway CDP');
    guard.assertProbeTarget(page, __filename);
    cdp = await CDP({ port: 9227, target: page.id });
    await cdp.Runtime.enable();
    const ack = messages.find(message => message.type === 'connection_ack');
    const config = ack?.agent_configs?.[sessionId] || null;
    if (config?.capabilities?.file_changes === false && !forcePendingControls) {
      const nativeRaw = await cdp.Runtime.evaluate({
        expression: [
          '(() => {',
          "const norm = value => String(value || '').replace(/\\s+/g, ' ').trim();",
          'const visible = element => {',
          'const rect = element?.getBoundingClientRect?.();',
          'return !!rect && rect.width > 0 && rect.height > 0;',
          '};',
          "const controls = Array.from(document.querySelectorAll('[data-click-ready], button, [role=\"button\"], a'))",
          ".filter(visible).map(element => norm(element.innerText || element.textContent || element.getAttribute('aria-label') || ''));",
          'const exactCount = expression => controls.filter(label => expression.test(label)).length;',
          'return {',
          'review: exactCount(/^review$/i),',
          'keep: exactCount(/^keep$/i),',
          'undo: exactCount(/^undo$/i),',
          'confirm: exactCount(/^confirm$/i),',
          "review_tab: Array.from(document.querySelectorAll('.tab[data-resource-name=\"review-changes\"]')).filter(visible).length,",
          'commit: exactCount(/^commit$/i),',
          '};',
          '})()',
        ].join('\n'),
        returnByValue: true,
        silent: true,
      });
      const nativeControls = nativeRaw.result?.value || {};
      const listed = await cursorSel.readCursorFileChanges(cdp.Runtime);
      assert.equal(listed.length, 0, 'disabled Cursor reversible control must not report pending entries');
      assert.equal(nativeControls.keep || 0, 0, 'Cursor 3.5 unexpectedly exposed Keep');
      assert.equal(nativeControls.undo || 0, 0, 'Cursor 3.5 unexpectedly exposed Undo');
      assert((nativeControls.review || 0) > 0 || (nativeControls.review_tab || 0) > 0,
        'expected Cursor 3.5 Review surface');
      return {
        ok: true,
        status: 'GATED OFF',
        generated_at: new Date().toISOString(),
        run_id: runId,
        session_id: sessionId,
        workspace_path: THROWAWAY_ROOT,
        reason: 'Cursor 3.5 applies Agent edits immediately and exposes Review/Commit, not reversible Keep/Undo controls.',
        capability_file_changes: false,
        pending_entries: listed.length,
        native_controls: nativeControls,
        sends: 0,
        controls: 0,
        exact_disk_state_unchanged: fs.readFileSync(README_PATH, 'utf8') === cleanReadme,
        operation_lock: OPERATION_LOCK_PATH,
        visible_windows_opened: 0,
        external_focus_actions: 0,
      };
    }

    await settleExistingChanges(ws, messages, sessionId, runId);
    if (cleanReadme !== originalReadme) fs.writeFileSync(README_PATH, cleanReadme, 'utf8');
    const keepSend = await cursorSel.sendCursorMessage(
      cdp.Runtime,
      cdp,
      `Edit README.md: append a new final line exactly ${keepMarker} (one line only).`,
    );
    assert.equal(keepSend?.ok, true, `failed to send Keep edit prompt: ${keepSend?.detail || keepSend?.code}`);
    await waitFor(() => fs.readFileSync(README_PATH, 'utf8').includes(keepMarker), 120000, 'Keep marker on disk');
    let keepEntry;
    try {
      keepEntry = await waitForSingleChange(ws, messages, sessionId, runId, 'keep');
    } catch (error) {
      const diagnostic = await captureFileChangeDiagnostic(cdp.Runtime).catch(() => null);
      const review_diagnostic = await openReviewForDiagnostic(cdp).catch(() => null);
      if (outputPath) {
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, `${JSON.stringify({
          ok: false,
          generated_at: new Date().toISOString(),
          run_id: runId,
          session_id: sessionId,
          stage: 'keep-selector',
          error: error.message,
          diagnostic,
          review_diagnostic,
        }, null, 2)}\n`, 'utf8');
      }
      throw error;
    }
    assert.equal(keepEntry.can_accept, true, 'live change must expose Keep');
    await respondFileChange(ws, messages, sessionId, runId, keepEntry, 'accept', 'keep');
    const keptReadme = await waitFor(() => {
      const content = fs.readFileSync(README_PATH, 'utf8');
      return content.includes(keepMarker) ? content : null;
    }, 30000, 'kept marker to remain on disk');

    const undoSend = await cursorSel.sendCursorMessage(
      cdp.Runtime,
      cdp,
      `Edit README.md: append a new final line exactly ${undoMarker} (one line only).`,
    );
    assert.equal(undoSend?.ok, true, `failed to send Undo edit prompt: ${undoSend?.detail || undoSend?.code}`);
    await waitFor(() => fs.readFileSync(README_PATH, 'utf8').includes(undoMarker), 120000, 'Undo marker on disk');
    const undoEntry = await waitForSingleChange(ws, messages, sessionId, runId, 'undo');
    assert.equal(undoEntry.can_reject, true, 'live change must expose Undo');
    await respondFileChange(ws, messages, sessionId, runId, undoEntry, 'reject', 'undo');
    await waitFor(() => fs.readFileSync(README_PATH, 'utf8') === keptReadme, 30000, 'Undo to restore exact kept disk state');
    console.log(`PASS exact Keep+Undo ${keepEntry.id} -> ${undoEntry.id}; disk restored`);
    return {
      ok: true,
      generated_at: new Date().toISOString(),
      run_id: runId,
      session_id: sessionId,
      workspace_path: THROWAWAY_ROOT,
      keep_change_id: keepEntry.id,
      undo_change_id: undoEntry.id,
      exact_disk_state_restored: true,
      operation_lock: OPERATION_LOCK_PATH,
      visible_windows_opened: 0,
      external_focus_actions: 0,
    };
  } finally {
    try { if (cdp) await cdp.close(); } catch {}
    try { ws.close(); } catch {}
    // Never leave validator markers in the throwaway workspace, including
    // artifacts from older false-positive runs.
    const current = fs.readFileSync(README_PATH, 'utf8');
    const cleaned = stripHarnessMarkers(current);
    if (cleaned !== current) fs.writeFileSync(README_PATH, cleaned, 'utf8');
  }
}

async function main() {
  const releaseOperation = acquirePidLock(
    OPERATION_LOCK_PATH,
    'production operation lock',
    `${JSON.stringify({
      pid: process.pid,
      acquired_at: new Date().toISOString(),
      agent: 'cursor-filechange-e2e',
      kind: 'guarded-cursor-filechange-contract',
    })}\n`,
  );
  try {
    const result = await runOwnedSweep();
    if (outputPath) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    }
    console.log(JSON.stringify(result, null, 2));
  } finally {
    releaseOperation();
  }
}

main().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
