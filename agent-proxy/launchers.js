// launchers.js — Per-agent session launch and close strategies
//
// Covers task: A3-10 (Implement Session Launch Via CDP)
//
// Launch flow:
//   1. Snapshot current CDP target IDs so we can detect new ones
//   2. Click "New Chat" / "New Conversation" in an existing webview of that type
//   3. If no existing webview and agent_type === 'claude', spawn Antigravity
//   4. Poll CDP targets until a new matching iframe appears (max 30 s)
//   5. Call onSuccess(newTarget, requestId, workspacePath) or onFailure(reason, code, requestId)
//
// Close flow:
//   Use the HTTP DevTools endpoint GET /json/close/:targetId (simpler than CDP domain call)

'use strict';

const CDP    = require('chrome-remote-interface');
const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const { spawn } = require('child_process');
const selectors = require('./selectors');

const LAUNCH_LOG = path.join(__dirname, 'launch.log');
function llog(msg) {
  const line = `${new Date().toISOString()} ${msg}\n`;
  console.log(`[launch] ${msg}`);
  try { fs.appendFileSync(LAUNCH_LOG, line); } catch {}
}

const ANTIGRAVITY_EXE   = process.env.ANTIGRAVITY_EXE
  || (process.env.LOCALAPPDATA
      ? require('path').join(process.env.LOCALAPPDATA, 'Programs', 'Antigravity', 'Antigravity.exe')
      : 'Antigravity');
const LAUNCH_TIMEOUT_MS = 30000;
const POLL_MS           = 1000;
const SPAWN_SETTLE_MS   = 4000; // wait after spawning Antigravity before polling

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function targetMatchesAgent(target, agentType) {
  const url = (target.url || '').toLowerCase();
  if (agentType === 'claude')  return target.type === 'iframe' && (url.includes('anthropic') || url.includes('claude'));
  if (agentType === 'codex')   return target.type === 'iframe' && (url.includes('openai')    || url.includes('chatgpt'));
  if (agentType === 'gemini')  return target.type === 'iframe' && (url.includes('googlecloud')|| url.includes('gemini'));
  if (agentType === 'antigravity' || agentType === 'antigravity_panel') {
    return target.type === 'page' && url.includes('workbench') && url.includes('jetski');
  }
  return false;
}

// Attempt to click "New Chat" / "New Conversation" in an existing agent webview.
// Returns { ok: bool, detail: string }.
async function clickNewSession(Runtime) {
  const result = await Runtime.evaluate({
    expression: `(function() {
      const f = document.getElementById('active-frame');
      if (!f || !f.contentDocument) return { ok: false, detail: 'no-active-frame' };
      const d = f.contentDocument;
      const btns = Array.from(d.querySelectorAll('button, [role="button"]'));
      function matchesNew(el) {
        const s = (el.getAttribute('aria-label') || el.title || el.textContent || '').trim();
        return /new.{0,15}chat/i.test(s)   ||
               /new.{0,15}conv/i.test(s)   ||
               /new.{0,15}session/i.test(s);
      }
      const btn = btns.find(matchesNew);
      if (btn) {
        btn.click();
        return { ok: true, detail: (btn.getAttribute('aria-label') || btn.textContent).trim().substring(0, 60) };
      }
      // Fallback: lone "+" button (commonly used for new sessions)
      const plus = btns.find(b =>
        (b.getAttribute('aria-label') || b.textContent || '').trim() === '+'
      );
      if (plus) { plus.click(); return { ok: true, detail: '+' }; }
      return { ok: false, detail: 'no-new-button-found' };
    })()`,
    returnByValue: true,
    awaitPromise:  false,
  });
  if (result.exceptionDetails) {
    const desc = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
    throw new Error(`JS exception in clickNewSession: ${desc}`);
  }
  return result.result?.value || { ok: false, detail: 'eval-null' };
}

// Execute a VS Code command from the workbench page to open a new agent session.
// This is more reliable than clicking buttons inside the iframe because it doesn't
// depend on the iframe's scroll state or UI rendering.
async function executeNewSessionCommand(port, agentType, workspacePath) {
  llog(`executeNewSessionCommand: agent=${agentType} workspace=${workspacePath || '(any)'}`);
  const targets = await CDP.List({ port });
  const workbenchPages = targets.filter(t =>
    t.type === 'page' && t.url && t.url.includes('workbench.html') && !t.url.includes('jetski')
  );
  if (workbenchPages.length === 0) return { ok: false, detail: 'no-workbench-pages' };

  // If workspace specified, sort pages so the matching window comes first
  if (workspacePath && workbenchPages.length > 1) {
    const normalise = p => (p || '').replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
    const wanted = normalise(workspacePath);
    const wantedBasename = wanted.split('/').filter(Boolean).pop() || '';
    workbenchPages.sort((a, b) => {
      const aTitle = (a.title || '').replace(/ - Antigravity.*/, '').trim().toLowerCase();
      const bTitle = (b.title || '').replace(/ - Antigravity.*/, '').trim().toLowerCase();
      const aMatch = aTitle === wantedBasename || wanted.endsWith(aTitle) ? 1 : 0;
      const bMatch = bTitle === wantedBasename || wanted.endsWith(bTitle) ? 1 : 0;
      return bMatch - aMatch;
    });
    llog(`Prioritised workbench "${workbenchPages[0].title}" for workspace "${workspacePath}"`);
  }

  // Map agent types to VS Code command IDs
  const commandMap = {
    claude: 'claude-code.newSession',
    codex:  'openai-chatgpt.newThread',
    gemini: 'googlecloudtools.cloudcode.newChat',
  };
  const command = commandMap[agentType];

  for (const page of workbenchPages) {
    let pageClient;
    try {
      pageClient = await CDP({ port, target: page.id });
      await pageClient.Runtime.enable();

      if (command) {
        // Try VS Code command API first
        const cmdResult = await pageClient.Runtime.evaluate({
          expression: `(async function() {
            try {
              if (typeof acquireVsCodeApi === 'function') {
                // We're in a webview context — can't directly call commands
                return { ok: false, detail: 'webview-context' };
              }
              // Try the require-based command execution (extension host)
              if (typeof require === 'function') {
                try {
                  const vscode = require('vscode');
                  await vscode.commands.executeCommand(${JSON.stringify(command)});
                  return { ok: true, detail: 'vscode-command', command: ${JSON.stringify(command)} };
                } catch (e) {
                  // require('vscode') may not be available in renderer
                }
              }
              // Workbench page: use the internal command service
              if (typeof window !== 'undefined' && window._commandService) {
                await window._commandService.executeCommand(${JSON.stringify(command)});
                return { ok: true, detail: 'commandService' };
              }
              return { ok: false, detail: 'no-command-api' };
            } catch (e) {
              return { ok: false, detail: 'command-error: ' + e.message };
            }
          })()`,
          returnByValue: true,
          awaitPromise: true,
        });
        const val = cmdResult.result?.value;
        if (val?.ok) {
          await pageClient.close();
          llog(`VS Code command succeeded: ${val.detail} on "${page.title}"`);
          return val;
        }
        llog(`VS Code command failed: ${val?.detail || 'unknown'} — trying keyboard shortcut`);
      }

      // Fallback: keyboard shortcut via CDP Input domain
      // Focus the window first, then send Ctrl+Shift+P to open command palette
      // and type the command name
      await pageClient.Runtime.evaluate({
        expression: 'window.focus()',
        awaitPromise: false,
      });

      // Use CDP Input.dispatchKeyEvent for keyboard shortcut
      // Claude Code: Ctrl+L is "New Chat" in many versions
      // Generic: Ctrl+Shift+` opens a new terminal, Ctrl+Shift+P opens palette
      const input = pageClient.Input;
      if (input) {
        // Try Ctrl+Shift+P to open command palette, then type the command
        await input.dispatchKeyEvent({ type: 'keyDown', key: 'F1', code: 'F1', windowsVirtualKeyCode: 112 });
        await input.dispatchKeyEvent({ type: 'keyUp', key: 'F1', code: 'F1', windowsVirtualKeyCode: 112 });
        await sleep(300);

        // Type the command name
        const cmdLabel = agentType === 'claude' ? 'Claude Code: New Session'
                       : agentType === 'codex'  ? 'Codex: New Thread'
                       : 'New Chat';
        for (const ch of cmdLabel) {
          await input.dispatchKeyEvent({ type: 'keyDown', key: ch, text: ch });
          await input.dispatchKeyEvent({ type: 'keyUp', key: ch });
        }
        await sleep(500);
        // Press Enter to execute the first match
        await input.dispatchKeyEvent({ type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
        await input.dispatchKeyEvent({ type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });

        await pageClient.close();
        llog(`Keyboard shortcut (command palette) sent on "${page.title}"`);
        return { ok: true, detail: 'command-palette', page: page.title };
      }

      await pageClient.close();
    } catch (e) {
      if (pageClient) try { await pageClient.close(); } catch {}
      llog(`executeNewSessionCommand failed on page ${page.id.substring(0, 8)}: ${e.message}`);
    }
  }
  return { ok: false, detail: 'all-workbench-pages-failed' };
}

// Poll CDP target list for a new iframe matching agentType that isn't in knownIds.
// Returns the new target object or null on timeout.
async function waitForNewTarget(port, agentType, knownIds, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    let targets;
    try { targets = await CDP.List({ port }); } catch { continue; }
    for (const t of targets) {
      if (knownIds.has(t.id))          continue;
      if (targetMatchesAgent(t, agentType)) return t;
    }
  }
  return null;
}

// Spawn Antigravity with CDP enabled (detached — proxy keeps running).
function spawnAntigravity(port) {
  llog(`Spawning Antigravity on CDP port ${port}`);
  const child = spawn(
    ANTIGRAVITY_EXE,
    [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'],
    { detached: true, stdio: 'ignore' }
  );
  child.unref();
  return child;
}

// HTTP close via /json/close/:targetId (standard DevTools endpoint).
function httpCloseTarget(port, targetId) {
  return new Promise(resolve => {
    const req = http.get(
      `http://localhost:${port}/json/close/${targetId}`,
      res => {
        let body = '';
        res.on('data', d => { body += d; });
        res.on('end', () => resolve({ ok: true, body }));
      }
    );
    req.on('error', err => resolve({ ok: false, error: err.message }));
    req.setTimeout(5000, () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Launch a new agent session.
 *
 * options:
 *   agentType      — 'claude' | 'codex' | 'gemini'
 *   port           — active CDP port number
 *   sessions       — Map<session_id, RuntimeSession> (live proxy sessions)
 *   requestId      — relay request_id for ack/fail routing
 *   workspacePath  — optional, injected as `/cd path` after the session appears
 *   onSuccess(newTarget, requestId, workspacePath)
 *   onFailure(reason, errorCode, requestId)
 */
async function launchSession({ agentType, port, sessions, requestId, workspacePath, onSuccess, onFailure }) {
  llog(`launchSession START agent=${agentType} workspace=${workspacePath || '(none)'} request=${requestId}`);

  // Gemini: must already be open — we can't spawn it standalone
  if (agentType === 'gemini') {
    const hasGemini = Array.from(sessions.values()).some(s => s.agentType === 'gemini');
    if (!hasGemini) {
      onFailure(
        'Agent not open — start Gemini Code Assist in Antigravity first',
        'agent_not_open',
        requestId
      );
      return;
    }
  }

  // Snapshot existing target IDs so we can detect the new one
  let existingIds;
  try {
    const targets = await CDP.List({ port });
    existingIds = new Set(targets.map(t => t.id));
    llog(`Snapshot ${existingIds.size} existing targets`);
  } catch (e) {
    onFailure(
      'Cannot list CDP targets — is Antigravity running with CDP enabled?',
      'cdp_unavailable',
      requestId
    );
    return;
  }

  // Find an existing live session of this agent type to click "New" in.
  // When a workspace is specified, prefer a session in that workspace so the
  // new chat opens in the correct Antigravity window.
  const sametype = Array.from(sessions.values()).filter(s => s.agentType === agentType);
  llog(`Found ${sametype.length} same-type sessions: ${sametype.map(s => s.session_id?.substring(0,8) + '=' + (s.workspace_path || s.workspace_name || '?')).join(', ')}`);
  let existingSession;
  if (workspacePath && sametype.length > 0) {
    const normalise = p => (p || '').replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
    const wanted = normalise(workspacePath);
    existingSession = sametype.find(s => normalise(s.workspace_path) === wanted)
      || sametype.find(s => s.workspace_name && wanted.endsWith(normalise(s.workspace_name)));
    if (!existingSession) {
      llog(`No existing ${agentType} session in workspace "${workspacePath}" — will try matching workbench page`);
      // Don't fall back to a session in the wrong workspace
    } else {
      llog(`Matched session ${existingSession.session_id?.substring(0,8)} in workspace "${existingSession.workspace_path}"`);
    }
  } else {
    existingSession = sametype[0];
    llog(`No workspace filter — using first session: ${existingSession?.session_id?.substring(0,8) || 'NONE'}`);
  }

  if (existingSession) {
    let clicked = false;
    try {
      const click = await clickNewSession(existingSession.client.Runtime);
      llog(`clickNewSession(${agentType}): ok=${click.ok} detail="${click.detail}"`);
      clicked = click.ok;
    } catch (e) {
      llog(`WARN: clickNewSession threw: ${e.message}`);
    }
    // Fallback: use workbench command palette if button click didn't work
    if (!clicked && (agentType === 'claude' || agentType === 'codex' || agentType === 'gemini')) {
      llog(`Falling back to executeNewSessionCommand for ${agentType}`);
      try {
        const cmdResult = await executeNewSessionCommand(port, agentType, workspacePath);
        llog(`executeNewSessionCommand: ok=${cmdResult.ok} detail="${cmdResult.detail}"`);
        if (cmdResult.ok) {
          // Give the command palette time to execute and the new tab to appear
          await sleep(1500);
        }
      } catch (e) {
        llog(`WARN: executeNewSessionCommand threw: ${e.message} — still polling`);
      }
    }
  } else if (agentType === 'claude' || agentType === 'antigravity' || agentType === 'antigravity_panel') {
    // No existing session — try command palette on existing workbench first
    let launched = false;
    if (agentType === 'claude') {
      try {
        const cmdResult = await executeNewSessionCommand(port, agentType, workspacePath);
        llog(`executeNewSessionCommand (no existing session): ok=${cmdResult.ok} detail="${cmdResult.detail}"`);
        if (cmdResult.ok) {
          launched = true;
          await sleep(1500);
        }
      } catch (e) {
        llog(`WARN: executeNewSessionCommand failed: ${e.message}`);
      }
    }
    if (!launched) {
      // Last resort — launch Antigravity fresh
      try {
        spawnAntigravity(port);
        llog(`Waiting ${SPAWN_SETTLE_MS}ms for Antigravity to start...`);
        await sleep(SPAWN_SETTLE_MS);
      } catch (e) {
        onFailure(`Failed to spawn Antigravity: ${e.message}`, 'spawn_failed', requestId);
        return;
      }
    }
  } else if (agentType === 'codex') {
    // No existing Codex session — try opening the panel via the activity bar
    llog(`No existing Codex session — attempting to open panel via activity bar`);
    try {
      const targets = await CDP.List({ port });
      const workbenchPages = targets.filter(t =>
        t.type === 'page' && t.url && t.url.includes('workbench.html') && !t.url.includes('jetski')
      );
      if (workbenchPages.length === 0) {
        onFailure('No Antigravity workbench found — start Antigravity first', 'agent_not_open', requestId);
        return;
      }
      // If workspace specified, sort pages so the matching window comes first
      if (workspacePath && workbenchPages.length > 1) {
        const normalise = p => (p || '').replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
        const wanted = normalise(workspacePath);
        const wantedBasename = wanted.split('/').filter(Boolean).pop() || '';
        workbenchPages.sort((a, b) => {
          const aTitle = (a.title || '').replace(/ - Antigravity.*/, '').trim().toLowerCase();
          const bTitle = (b.title || '').replace(/ - Antigravity.*/, '').trim().toLowerCase();
          const aMatch = aTitle === wantedBasename || wanted.endsWith(aTitle) ? 1 : 0;
          const bMatch = bTitle === wantedBasename || wanted.endsWith(bTitle) ? 1 : 0;
          return bMatch - aMatch;
        });
        llog(`Codex panel: prioritising workbench "${workbenchPages[0].title}" for workspace "${workspacePath}"`);
      }
      let panelOpened = false;
      for (const page of workbenchPages) {
        let pageClient;
        try {
          pageClient = await CDP({ port, target: page.id });
          await pageClient.Runtime.enable();
          const result = await selectors.openCodexPanel(pageClient.Runtime);
          await pageClient.close();
          if (result.ok) {
            llog(`Opened Codex panel: method=${result.method} detail=${result.detail}`);
            panelOpened = true;
            break;
          }
        } catch (e) {
          if (pageClient) try { await pageClient.close(); } catch {}
          llog(`WARN: openCodexPanel failed on page ${page.id.substring(0, 8)}: ${e.message}`);
        }
      }
      if (!panelOpened) {
        onFailure('Could not open Codex panel — Codex extension may not be installed', 'agent_not_open', requestId);
        return;
      }
      // Wait for the panel's iframe to appear
      llog(`Waiting ${SPAWN_SETTLE_MS}ms for Codex panel to load...`);
      await sleep(SPAWN_SETTLE_MS);
    } catch (e) {
      onFailure(`Failed to open Codex panel: ${e.message}`, 'panel_open_failed', requestId);
      return;
    }
  } else {
    // Unknown agent type or Gemini with no existing session — can't spawn
    const label = agentType === 'gemini' ? 'Gemini Code Assist' : agentType;
    onFailure(
      `Agent not open — start ${label} in Antigravity first`,
      'agent_not_open',
      requestId
    );
    return;
  }

  // Poll for new target
  llog(`Polling for new target (timeout ${LAUNCH_TIMEOUT_MS}ms)...`);
  const newTarget = await waitForNewTarget(port, agentType, existingIds, LAUNCH_TIMEOUT_MS);
  if (!newTarget) {
    llog(`TIMEOUT: No new ${agentType} target appeared in ${LAUNCH_TIMEOUT_MS}ms`);
    onFailure('Timed out waiting for new session to appear (30 s)', 'launch_timeout', requestId);
    return;
  }

  llog(`SUCCESS: New ${agentType} target: ${newTarget.id.substring(0, 8)}`);
  onSuccess(newTarget, requestId, workspacePath);
}

/**
 * Close a session via the DevTools HTTP close endpoint.
 * Returns { ok, error? }.
 */
async function closeSession({ targetId, port }) {
  console.log(`[launch] Closing target ${targetId.substring(0, 8)} on port ${port}`);
  try {
    const result = await httpCloseTarget(port, targetId);
    if (!result.ok) console.warn(`[launch] HTTP close failed: ${result.error}`);
    return result;
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { launchSession, closeSession };
