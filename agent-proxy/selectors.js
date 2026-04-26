// selectors.js — DOM selector strategy layer for agent-proxy
//
// Primary and fallback selector sets per agent type.
// All DOM reading and writing goes through this module so selector
// updates are isolated and fallback logic is consistent.
//
// Covers tasks: A3-04 (selector strategy layer), A3-05 (send fallbacks + diagnostics)

'use strict';

// ─── Claude selector sets ─────────────────────────────────────────────────────

const CLAUDE_PRIMARY = {
  detect:    '.sendButton_gGYT1w',
  msgList:   '.message_07S1Yg',
  userClass: 'userMessageContainer_07S1Yg',
  userText:  '.userMessage_07S1Yg',
  userTextAlt: '.content_xGDvVg span',
  assistantTestId: 'assistant-message',
  thinkingDetails: 'details.thinking_aHyQPQ[open]',
  thinkingSummary: '.thinkingSummary_aHyQPQ',
  spinnerRow:  '.spinnerRow_07S1Yg',
  spinnerVerb: '.text_hc5dvw',
  input:     '.messageInput_cKsPxg',
  sendBtn:   'button.sendButton_gGYT1w[type="submit"]',
};

// Fallback: broader selectors for when UI class names change
const CLAUDE_FALLBACK = {
  detect:    'button[type="submit"]',
  msgList:   '[data-testid="assistant-message"], .message_07S1Yg',
  userClass: null, // determined by data-role
  userText:  '[data-role="user"] p',
  userTextAlt: null,
  assistantTestId: 'assistant-message',
  thinkingDetails: 'details[open]',
  thinkingSummary: 'summary',
  input:     '[contenteditable][aria-label], [contenteditable].messageInput_cKsPxg, [contenteditable]',
  sendBtn:   'button[aria-label*="send" i], button[aria-label*="Send" i], button[type="submit"]',
};

// ─── Codex selector sets ──────────────────────────────────────────────────────
// Used for both Codex VS Code extension (evalInFrame) and Codex Desktop (evalInPage).
//
// Codex Desktop (port 9225) DOM findings (A12-03, 2026-03-21):
//   CDP target: type="page", url="app://-/index.html?hostId=local", title="Codex"
//   Conversation: [data-thread-find-target="conversation"]
//   Turns:        [data-content-search-turn-key] — one per user/assistant exchange
//   Units:        [data-content-search-unit-key] — "{turnId}:{index}:{role}"
//   User text:    .whitespace-pre-wrap inside unit
//   Assistant:    p, li, pre, h1-h4 inside unit
//   Composer:     .ProseMirror (contenteditable div)
//   Send button:  last button in ancestor container with 4+ buttons (rounded-full)
//                 Idle SVG path starts "M9.334" (arrow up); stop SVG differs
//   Config:       GPT-5.4 / Medium / Default permissions buttons in composer toolbar
//   Rate limit:   body innerText scan for "rate limit resets at..." pattern
//   Thinking:     stop button aria-label or send button SVG change

const CODEX_PRIMARY = {
  detect:  '.ProseMirror',
  input:   '.ProseMirror',
  minComposerButtons: 4,  // walk up from input until we find container with 4+ buttons
};

// Codex fallback: try Enter key dispatch when button walk fails
const CODEX_FALLBACK = {
  input: '.ProseMirror, [contenteditable]',
};

// Gemini Code Assist (google.geminicodeassist extension)
// Selectors confirmed from webview/app_bundle.js static analysis.
// The UI is an Angular Material app. class names are stable Angular component selectors.
const GEMINI_PRIMARY = {
  detect:  '.chat-submit-input',         // present whenever the chat panel is open
  input:   '.chat-submit-input',         // contenteditable="plaintext-only" div
  sendBtn: 'button.submit-button',       // submit-button class, inside .button-container
  stopBtn: 'button.chat-stop-button',    // visible only while Gemini is generating
  msgSel:  'chat-history-item',          // custom element, one per turn
  userCls: 'user',                       // .user added via Angular Xr() when entity=="USER"
  sysCls:  'system',                     // .system added for system/error messages
  textSel: '.history-item-text',         // rendered markdown text inside each item
};

// Fallback: broader selectors survive minor Angular version bumps
const GEMINI_FALLBACK = {
  input:   [
    '.chat-submit-input',
    '[contenteditable="plaintext-only"]',
    '[contenteditable="true"]',
    'textarea',
  ].join(', '),
  sendBtn: [
    'button.submit-button',
    'button.standalone-action-button[type="submit"]:not(.chat-stop-button)',
    'button[type="submit"].mat-mdc-button-base:not(.chat-stop-button):not([disabled])',
  ].join(', '),
};

// ─── Continue selector sets ──────────────────────────────────────────────────
// Continue.dev VS Code extension (Continue.continue).
// Uses TipTap/ProseMirror for input, data-testid attributes for key elements.
// Conversation turns are children of the scroll container:
//   - User messages: contain [data-testid^="continue-input-box-"] (non-main)
//   - Assistant messages: contain .thread-message with .sc-eDPEul markdown body

const CONTINUE_PRIMARY = {
  detect:    '[data-testid="editor-input-main"]',
  input:     '[data-testid="editor-input-main"]',             // TipTap .tiptap.ProseMirror contenteditable
  sendBtn:   '[data-testid="submit-input-button"]:last-of-type', // last submit button = main input's
  modelBtn:  '[data-testid="model-select-button"]',
  modeBtn:   '[data-testid="mode-select-button"]',
  scrollContainer: '.overflow-y-scroll.no-scrollbar.flex-1, .thin-scrollbar.overflow-y-scroll.flex-1',  // conversation scroll area
  threadMsg: '.thread-message',                               // assistant message wrapper
  markdownBody: '.sc-eDPEul',                                 // rendered markdown inside thread-message
};

const CONTINUE_FALLBACK = {
  input:   '.tiptap.ProseMirror[contenteditable="true"]',
  sendBtn: 'button[data-testid="submit-input-button"]',
};

// ─── Roo Code selector sets ──────────────────────────────────────────────────
// Roo Code (RooVeterinaryInc.roo-cline) VS Code extension.
// Runs in a side-pane webview like Continue.
// Selectors confirmed via live CDP DOM inspection (2026-04-26).
//
// DOM structure:
//   - #root > [data-testid="chat-view"]           ← root chat container
//   - textarea[placeholder*="task" i]              ← input (also "Type a message...")
//   - button[aria-label="Press Enter to send"]     ← send button
//   - button[aria-label="Stop"]                     ← stop button (visible while generating)
//   - [data-testid="virtuoso-item-list"]             ← virtualized message list
//   - [data-testid="virtuoso-item-list"] > div       ← individual message rows
//   - Text prefixes: "Roo said", "Roo wants", "You said", "API Request", "Checkpoint"
//   - Mode button text: "🏗️ Architect", "💻 Code", etc.

const ROO_CODE_PRIMARY = {
  detect:    'textarea[placeholder*="task" i], textarea[placeholder*="message" i]',
  input:     'textarea[placeholder*="task" i], textarea[placeholder*="message" i]',
  sendBtn:   'button[aria-label="Press Enter to send"]',
  stopBtn:   'button[aria-label="Stop"]',
  virtuoso:  '[data-testid="virtuoso-item-list"]',
  chatView:  '[data-testid="chat-view"]',
};

const ROO_CODE_FALLBACK = {
  input:   'textarea',
  sendBtn: 'button[aria-label*="send" i]',
};

// ─── Failure tracking ─────────────────────────────────────────────────────────

const selectorFailures = new Map(); // sessionId -> { readFails, sendFails, lastDiagAt }

function _getFailures(sessionId) {
  if (!selectorFailures.has(sessionId)) {
    selectorFailures.set(sessionId, { readFails: 0, sendFails: 0, lastDiagAt: 0 });
  }
  return selectorFailures.get(sessionId);
}

function recordReadFailure(sessionId) {
  const f = _getFailures(sessionId);
  f.readFails++;
  return f;
}

function recordSendFailure(sessionId) {
  const f = _getFailures(sessionId);
  f.sendFails++;
  return f;
}

function resetReadFailures(sessionId)  { const f = _getFailures(sessionId); f.readFails = 0; }
function resetSendFailures(sessionId)  { const f = _getFailures(sessionId); f.sendFails = 0; }

function getSelectorFailures(sessionId) {
  return { ..._getFailures(sessionId) };
}

// ─── Diagnostic snapshot ──────────────────────────────────────────────────────
// Throttled — captured at most once per 30 s per session

async function captureDiagnostic(Runtime, sessionId) {
  const f = _getFailures(sessionId);
  const now = Date.now();
  if (now - f.lastDiagAt < 30000) return;
  f.lastDiagAt = now;

  try {
    const result = await Runtime.evaluate({
      expression: `(function() {
        const webviewId = ${JSON.stringify(null)}; // diagnostic path uses generic frame resolution only
        function resolveDoc() {
          const active = document.getElementById('active-frame');
          if (active && active.contentDocument) return active.contentDocument;
          if (document.body && document.body.children.length > 0) return document;
          const frames = Array.from(document.querySelectorAll('iframe.webview.ready, iframe'));
          const visible = frames.filter(function(frame) {
            if (!frame || !frame.contentDocument) return false;
            const rect = frame.getBoundingClientRect();
            return rect.width > 40 && rect.height > 40;
          });
          return (visible[0] && visible[0].contentDocument) || null;
        }
        const d = resolveDoc();
        if (!d) return JSON.stringify({ error: 'no-webview-frame' });
        return JSON.stringify({
          title: d.title,
          url: d.URL ? d.URL.substring(0, 120) : '',
          bodyClass: d.body ? d.body.className.substring(0, 200) : '',
          childCount: d.body ? d.body.children.length : 0,
          topTags: d.body
            ? Array.from(d.body.children).slice(0, 5).map(function(e) {
                return e.tagName + (e.id ? '#' + e.id : '') + (e.className ? '.' + e.className.split(' ')[0] : '');
              })
            : [],
        });
      })()`,
      returnByValue: true,
      awaitPromise: false,
    });
    if (result?.result?.value) {
      console.warn(`[${sessionId}] [diag] ${result.result.value}`);
    }
  } catch (e) {
    console.warn(`[${sessionId}] [diag] capture failed: ${e.message}`);
  }
}

// ─── Core page eval helper (Antigravity native agent — no active-frame) ──────
//
// The Antigravity built-in Agent Manager runs as a `page` type CDP target
// (workbench-jetski-agent.html), not a VS Code webview iframe.  Its content
// lives directly in `document`, so we evaluate without the active-frame lookup.

async function evalInPage(Runtime, code) {
  const result = await Runtime.evaluate({
    expression: `(function() {
      const d = document;
      ${code}
    })()`,
    returnByValue: true,
    awaitPromise: false,
    silent: true,
    userGesture: false,
  });
  if (result.exceptionDetails) {
    const desc = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
    throw new Error(`JS exception: ${desc}`);
  }
  return result.result?.value ?? null;
}

async function evalInWorkbenchWebview(Runtime, webviewId, code) {
  const result = await Runtime.evaluate({
    expression: `(function() {
      const root = document;
      const webviewId = ${JSON.stringify(webviewId || '')};
      function resolveDoc() {
        if (!webviewId) return null;
        let iframe = root.querySelector('iframe[name="' + webviewId + '"]');
        if (iframe && iframe.contentDocument) return iframe.contentDocument;

        const editorEl = root.querySelector('[aria-flowto="' + webviewId + '"]');
        if (editorEl) {
          iframe = editorEl.querySelector('iframe');
          if (iframe && iframe.contentDocument) return iframe.contentDocument;
        }

        const iframes = Array.from(root.querySelectorAll('iframe'));
        iframe = iframes.find(f => f.name === webviewId || f.id === webviewId) || null;
        if (iframe && iframe.contentDocument) return iframe.contentDocument;
        return null;
      }

      const d = resolveDoc();
      if (!d) return null;
      ${code}
    })()`,
    returnByValue: true,
    awaitPromise: false,
    silent: true,
    userGesture: false,
  });
  if (result.exceptionDetails) {
    const desc = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
    throw new Error(`JS exception: ${desc}`);
  }
  return result.result?.value ?? null;
}

// ─── Core frame eval helper ───────────────────────────────────────────────────

async function evalInFrame(Runtime, code) {
  const webviewId = Runtime._webviewId || '';
  // If the session has a cached inner-frame contextId, evaluate directly
  // in that context to avoid accessing active-frame.contentDocument which
  // can trigger focus/scroll changes in Electron webviews.
  if (Runtime._innerContextId) {
    try {
      const result = await Runtime.evaluate({
        expression: `(function() {
          const d = document;
          ${code}
        })()`,
        contextId: Runtime._innerContextId,
        returnByValue: true,
        awaitPromise: false,
        silent: true,
        userGesture: false,
      });
      if (!result.exceptionDetails) return result.result?.value ?? null;
      // Context stale — clear and try to re-cache before falling back
      Runtime._innerContextId = null;
    } catch {
      Runtime._innerContextId = null;
    }
  }

  // Context ID is null — try to re-cache it before falling through to the
  // focus-stealing cross-document path.  Without this, one webview reload
  // would permanently degrade to active-frame.contentDocument access which
  // steals focus between Antigravity windows.
  //
  // Cooldown: cacheInnerContextId does Runtime.disable/enable which itself
  // can cause focus issues, so rate-limit re-cache attempts to once per 30s.
  const now = Date.now();
  const canRecache = !Runtime._innerContextRecacheInFlight &&
    (!Runtime._innerContextLastRecacheAt || now - Runtime._innerContextLastRecacheAt > 30000);
  if (!Runtime._innerContextId && canRecache) {
    Runtime._innerContextRecacheInFlight = true;
    Runtime._innerContextLastRecacheAt = now;
    try {
      await cacheInnerContextId(Runtime);
    } catch {}
    Runtime._innerContextRecacheInFlight = false;
    // Retry with freshly cached context
    if (Runtime._innerContextId) {
      try {
        const result = await Runtime.evaluate({
          expression: `(function() {
            const d = document;
            ${code}
          })()`,
          contextId: Runtime._innerContextId,
          returnByValue: true,
          awaitPromise: false,
          silent: true,
          userGesture: false,
        });
        if (!result.exceptionDetails) return result.result?.value ?? null;
        Runtime._innerContextId = null;
      } catch {
        Runtime._innerContextId = null;
      }
    }
  }

  const result = await Runtime.evaluate({
    expression: `(function() {
      const webviewId = ${JSON.stringify(webviewId)};
      function resolveDoc() {
        const active = document.getElementById('active-frame');
        if (active && active.contentDocument) return active.contentDocument;

        if (webviewId) {
          let iframe = document.querySelector('iframe[name="' + webviewId + '"]');
          if (iframe && iframe.contentDocument) return iframe.contentDocument;

          const editorEl = document.querySelector('[aria-flowto="' + webviewId + '"]');
          if (editorEl) {
            iframe = editorEl.querySelector('iframe');
            if (iframe && iframe.contentDocument) return iframe.contentDocument;
          }

          const exact = Array.from(document.querySelectorAll('iframe')).find(function(frame) {
            return frame && (frame.name === webviewId || frame.id === webviewId);
          });
          if (exact && exact.contentDocument) return exact.contentDocument;
        }

        const frames = Array.from(document.querySelectorAll('iframe.webview.ready, iframe'));
        const visible = frames.filter(function(frame) {
          if (!frame || !frame.contentDocument) return false;
          const rect = frame.getBoundingClientRect();
          return rect.width > 40 && rect.height > 40;
        });
        if (visible.length === 1) return visible[0].contentDocument;
        const withBody = visible.find(function(frame) {
          const txt = frame.contentDocument && frame.contentDocument.body
            ? (frame.contentDocument.body.innerText || '').trim()
            : '';
          return txt.length > 0;
        });
        if (withBody) return withBody.contentDocument;
        if (document.body && document.body.children.length > 0) return document;
        return null;
      }
      const d = resolveDoc();
      if (!d) return null;
      ${code}
    })()`,
    returnByValue: true,
    awaitPromise: false,
    silent: true,
    userGesture: false,
  });
  if (result.exceptionDetails) {
    const desc = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
    throw new Error(`JS exception: ${desc}`);
  }
  return result.result?.value ?? null;
}

// Cache the inner-frame execution context ID for a session's Runtime.
// Call once after connecting to an iframe target to find the active-frame context.
async function cacheInnerContextId(Runtime) {
  return new Promise((resolve) => {
    const contexts = [];
    function scoreContext(ctx) {
      if (!ctx) return -Infinity;
      let score = 0;
      const aux = ctx.auxData || {};
      if (aux.isDefault) score += 10000;
      if (aux.type === 'default') score += 5000;
      if (ctx.origin && !/^devtools:/i.test(ctx.origin)) score += 100;
      if (typeof ctx.name === 'string' && ctx.name.length === 0) score += 50;
      if (Runtime._webviewId) {
        const wid = String(Runtime._webviewId);
        if (String(ctx.name || '').includes(wid)) score += 1000;
        if (String(ctx.origin || '').includes(wid)) score += 1000;
        if (String(aux.frameId || '').includes(wid)) score += 1000;
      }
      score += Math.min(Number(ctx.id) || 0, 999);
      return score;
    }
    const handler = (params) => { contexts.push(params.context); };
    Runtime.on('executionContextCreated', handler);
    // Re-trigger context events by disabling then re-enabling Runtime
    Runtime.disable().then(() => Runtime.enable()).then(() => {
      setTimeout(() => {
        try {
          if (typeof Runtime.off === 'function') {
            Runtime.off('executionContextCreated', handler);
          } else if (typeof Runtime.removeListener === 'function') {
            Runtime.removeListener('executionContextCreated', handler);
          }
        } catch {}
        // Prefer the default-world context for the current frame.  The old
        // highest-id heuristic can drift onto unrelated mounted worlds in newer
        // Continue/Antigravity builds and return stale toolbar state.
        if (contexts.length > 0) {
          contexts.sort((a, b) => scoreContext(b) - scoreContext(a) || ((b.id || 0) - (a.id || 0)));
          Runtime._innerContextId = contexts[0].id;
          Runtime._innerContextScore = scoreContext(contexts[0]);
        }
        // Install a passive listener to track future context creation/destruction
        // without requiring a disable/enable cycle.  When the webview reloads,
        // the old context is destroyed and a new one is created; we'll pick up
        // the new one automatically.
        if (!Runtime._innerContextWatcherInstalled) {
          Runtime._innerContextWatcherInstalled = true;
          Runtime.on('executionContextCreated', (params) => {
            const ctx = params?.context;
            if (!ctx) return;
            const nextScore = scoreContext(ctx);
            const currentScore = Runtime._innerContextScore ?? -Infinity;
            if (!Runtime._innerContextId || nextScore >= currentScore) {
              Runtime._innerContextId = ctx.id;
              Runtime._innerContextScore = nextScore;
            }
          });
          Runtime.on('executionContextDestroyed', (params) => {
            if (Runtime._innerContextId && params?.executionContextId === Runtime._innerContextId) {
              Runtime._innerContextId = null;
              Runtime._innerContextScore = null;
            }
          });
          Runtime.on('executionContextsCleared', () => {
            Runtime._innerContextId = null;
            Runtime._innerContextScore = null;
          });
        }
        resolve(Runtime._innerContextId || null);
      }, 300);
    }).catch(() => resolve(null));
  });
}

// ─── Agent type detection ─────────────────────────────────────────────────────

async function detectAgentType(Runtime, extensionIdHint) {
  const webviewId = Runtime._webviewId || '';
  const hint = String(extensionIdHint || '').toLowerCase();

  // 0. Extension-ID-based pre-classification for Cline forks.
  //    Roo Code (rooveterinaryinc.roo-cline) and Cline (saoudrizwan.claude-dev)
  //    share identical DOM, so DOM selectors cannot distinguish them.
  //    Check ext ID first — this is the most reliable discriminator.
  const isClineHint = hint.includes('saoudrizwan.claude-dev');
  const isRooHint   = hint.includes('rooveterinaryinc') || hint.includes('roo-code');

  const result = await Runtime.evaluate({
    expression: `(function() {
      const webviewId = ${JSON.stringify(webviewId)};
      function resolveDoc() {
        const active = document.getElementById('active-frame');
        if (active && active.contentDocument) return active.contentDocument;
        if (webviewId) {
          let iframe = document.querySelector('iframe[name="' + webviewId + '"]');
          if (iframe && iframe.contentDocument) return iframe.contentDocument;
          const editorEl = document.querySelector('[aria-flowto="' + webviewId + '"]');
          if (editorEl) {
            iframe = editorEl.querySelector('iframe');
            if (iframe && iframe.contentDocument) return iframe.contentDocument;
          }
        }
        const frames = Array.from(document.querySelectorAll('iframe.webview.ready, iframe'));
        const visible = frames.find(function(frame) {
          if (!frame || !frame.contentDocument) return false;
          const rect = frame.getBoundingClientRect();
          return rect.width > 40 && rect.height > 40;
        });
        if (visible) return visible.contentDocument;
        if (document.body && document.body.children.length > 0) return document;
        if (document.documentElement) return document;
        return null;
      }
      const d = resolveDoc();
      if (!d) return null;
      if (d.querySelector('${CLAUDE_PRIMARY.detect}')) return 'claude';
      if (d.querySelector('${CONTINUE_PRIMARY.detect}')) return ${JSON.stringify(hint.includes('continue-yolo') || hint.includes('continue.continue-yolo') ? 'continue_yolo' : 'continue')};
      if (d.querySelector('${CODEX_PRIMARY.detect}')) return 'codex';
      if (d.querySelector('${GEMINI_PRIMARY.detect}')) return 'gemini';
      if (d.querySelector('${ROO_CODE_PRIMARY.detect}')) return 'roo_code_or_cline';
      if (d.querySelector('${CLAUDE_FALLBACK.detect}')) return 'claude';
      return null;
    })()`,
    returnByValue: true,
    awaitPromise: false,
  });
  let detected = result.result?.value ?? null;

  // Disambiguate roo_code vs cline using ext ID when DOM detection
  // returns the shared marker.
  if (detected === 'roo_code_or_cline') {
    if (isClineHint) detected = 'cline';
    else if (isRooHint) detected = 'roo_code';
    else detected = 'roo_code'; // default to roo_code if no hint
  }
  if (detected) return detected;

  // Last resort: use extension ID hint (covers empty/loading panels)
  if (hint.includes('gemini') || hint.includes('googlecloud') || hint.includes('geminicodeassist')) return 'gemini';
  if (hint.includes('continue.continue-yolo') || hint.includes('continue-yolo')) return 'continue_yolo';
  if (hint.includes('continue.continue')) return 'continue';
  if (isClineHint) return 'cline';
  if (isRooHint || hint.includes('roo')) return 'roo_code';
  return null;
}

function isContinueAgentType(agentType) {
  return agentType === 'continue' || agentType === 'continue_yolo';
}

function isRooCodeAgentType(agentType) {
  return agentType === 'roo_code' || agentType === 'cline';
}

// ─── Thinking detection ───────────────────────────────────────────────────────

async function detectThinking(Runtime, agentType) {
  if (isRooCodeAgentType(agentType)) return detectRooCodeThinking(Runtime);
  if (isContinueAgentType(agentType)) return detectContinueThinking(Runtime);
  if (agentType === 'antigravity_panel') return detectAntigravityPanelThinking(Runtime);
  if (agentType === 'antigravity') return detectAntigravityThinking(Runtime);
  if (agentType === 'gemini') {
    try {
      const raw = await evalInFrame(Runtime, `
        var stopBtn = d.querySelector('${GEMINI_PRIMARY.stopBtn}');
        var isVisible = stopBtn && stopBtn.offsetParent !== null;
        return JSON.stringify({ thinking: !!isVisible, label: isVisible ? 'Generating' : '' });
      `);
      try { return JSON.parse(raw); } catch { return { thinking: false, label: '' }; }
    } catch {
      return { thinking: false, label: '' };
    }
  }
  if (agentType === 'codex' || agentType === 'codex-desktop') {
    try {
      const evalFn = agentType === 'codex-desktop' ? evalInPage : evalInFrame;
      const raw = await evalFn(Runtime, `
        var isDesktopApp = ${JSON.stringify(agentType === 'codex-desktop')};
        var isCodexExtension = ${JSON.stringify(agentType === 'codex')};
        // Codex shows a stop button (aria-label contains "stop") while generating.
        // Also check if the send button SVG changed from arrow to square (stop icon).
        var isThinking = false;
        var hasStopSignal = false;
        var hasShimmerSignal = false;
        var stopBtn = d.querySelector('button[aria-label*="Stop" i], button[aria-label*="stop" i]');
        if (stopBtn && stopBtn.offsetParent !== null) {
          isThinking = true;
          hasStopSignal = true;
        }
        // Check for the Codex "Thinking" shimmer indicator.
        // IMPORTANT: Only match spans with the shimmer class — Codex uses
        // "loading-shimmer-pure-text" for active thinking indicators.  Regular
        // message content may contain the literal word "Thinking" and must be
        // excluded.  Also require the span to be in the viewport (top >= 0)
        // because Codex leaves residual shimmer spans in old chat history.
        // Enabled for both Codex extension and Codex Desktop — Desktop uses
        // the same shimmer class plus an animate-spin spinner.
        if (!isThinking) {
          var shimmers = d.querySelectorAll('span[class*="loading-shimmer"]');
          for (var si = 0; si < shimmers.length; si++) {
            var st = (shimmers[si].textContent || '').trim();
            if ((st === 'Thinking' || st === 'Generating') && shimmers[si].offsetParent !== null) {
              var rect = shimmers[si].getBoundingClientRect();
              if (rect.top >= 0) {
                isThinking = true;
                hasShimmerSignal = true;
                break;
              }
            }
          }
        }
        // Codex Desktop: also check for animate-spin spinner (strong thinking signal)
        var hasSpinnerSignal = false;
        if (isDesktopApp && !isThinking) {
          var spinner = d.querySelector('[class*="animate-spin"]');
          if (spinner && spinner.offsetParent !== null) {
            isThinking = true;
            hasSpinnerSignal = true;
          }
        }
        // Fallback: check send button for a rect-based stop icon (square).
        // Do NOT use SVG path matching — Codex updates send arrow paths
        // frequently and unknown paths cause permanent false "thinking" state.
        if (!isThinking) {
          var pm = d.querySelector('.ProseMirror');
          if (pm) {
            var container = pm.parentElement;
            while (container && container !== d.body) {
              if (container.querySelectorAll('button').length >= 4) break;
              container = container.parentElement;
            }
            if (container && container !== d.body) {
              var btns = Array.from(container.querySelectorAll('button'));
              var lastBtn = btns[btns.length - 1];
              if (lastBtn) {
                // Only check for rect-based stop icon (square) — this is reliable
                var stopRect = lastBtn.querySelector('svg rect');
                if (stopRect) {
                  isThinking = true;
                  hasStopSignal = true;
                }
              }
            }
          }
        }

        if (!isThinking) return JSON.stringify({ thinking: false, label: '' });

        // Enhanced activity detection: extract granular activity label + command content.
        var label = 'Generating';
        var thinkingContent = '';
        var liveDraft = '';
        try {
          var bt = String.fromCharCode(96);
          var fence = bt + bt + bt;
          function shouldIgnoreDraftText(txt) {
            if (!txt) return true;
            if (txt.length < 8) return true;
            return /^(Thinking|Generating|Worked for .*|Undo|Review|Context automatically compacted|Running command(?: for [\\dsmh ]+)?|Reading|Writing|Editing|Searching|Creating|Applying)$/i.test(txt);
          }

          function inlineText(node) {
            if (!node) return '';
            if (node.nodeType === 3) return node.textContent || '';
            if (node.nodeType !== 1) return '';
            var tag = node.nodeName.toUpperCase();
            if (tag === 'BR') return '\\n';
            if (tag === 'PRE') return '';
            if (tag === 'CODE') {
              var codeText = (node.textContent || '').trim();
              return codeText ? bt + codeText + bt : '';
            }
            if (tag === 'BUTTON' || tag === 'SVG' || tag === 'PATH' || tag === 'SUMMARY') return '';
            return Array.from(node.childNodes).map(inlineText).join('');
          }

          function nodeToMarkdown(node) {
            if (!node) return '';
            if (node.nodeType === 3) return node.textContent || '';
            if (node.nodeType !== 1) return '';
            var tag = node.nodeName.toUpperCase();
            if (tag === 'PRE') {
              var codeEl = node.querySelector('code');
              var cls = codeEl ? (codeEl.className || '') : '';
              var lang = (cls.match(/language-(\\w+)/) || [])[1] || '';
              var codeText = ((codeEl || node).textContent || '').trim();
              return codeText ? ('\\n' + fence + lang + '\\n' + codeText + '\\n' + fence + '\\n\\n') : '';
            }
            if (tag === 'CODE') return bt + ((node.textContent || '').trim()) + bt;
            if (tag === 'P') {
              var para = inlineText(node).replace(/\\n{3,}/g, '\\n\\n').trim();
              return para ? (para + '\\n\\n') : '';
            }
            if (tag === 'UL' || tag === 'OL') {
              var idx = 1;
              var out = [];
              Array.from(node.children).forEach(function(li) {
                if (!li || li.nodeName.toUpperCase() !== 'LI') return;
                var body = inlineText(li).replace(/\\n{3,}/g, '\\n\\n').trim();
                if (!body) return;
                out.push((tag === 'OL' ? (idx++ + '. ') : '- ') + body);
              });
              return out.length > 0 ? out.join('\\n') + '\\n\\n' : '';
            }
            return Array.from(node.childNodes).map(nodeToMarkdown).join('');
          }

          function findVisibleAssistantDraft() {
            var convo = d.querySelector('[data-thread-find-target="conversation"]') || d.body;
            var selectors = [
              '[data-content-search-unit-key$=":assistant"]',
              '.overflow-x-auto',
              '[class*="prose"]',
              '[data-message-author-role="assistant"]',
            ];
            for (var si = 0; si < selectors.length; si++) {
              var nodes = Array.from(convo.querySelectorAll(selectors[si]));
              for (var ni = nodes.length - 1; ni >= 0; ni--) {
                var node = nodes[ni];
                if (!node || !node.offsetParent) continue;
                if (node.closest('[class*="items-end"]')) continue;
                if (node.closest('button, summary, dialog, [role="dialog"]')) continue;
                var txt = nodeToMarkdown(node).replace(/\\n{3,}/g, '\\n\\n').trim();
                if (!txt) {
                  txt = (node.innerText || '').replace(/\\n{3,}/g, '\\n\\n').trim();
                }
                if (shouldIgnoreDraftText(txt)) continue;
                return txt.substring(0, 4000);
              }
            }
            return '';
          }

          // Priority 1: "Running command for Ns" / "Reading file" / "Searching" etc.
          // These are DIVs with class containing "loading-shimmer" or matching text pattern.
          var activityDivs = d.querySelectorAll('div, span');
          for (var ai = activityDivs.length - 1; ai >= 0; ai--) {
            var el = activityDivs[ai];
            if (!el.offsetParent) continue;
            var t = (el.textContent || '').trim();
            var m = t.match(/^(Running command|Reading|Writing|Editing|Searching|Creating|Applying)(?:\\s+\\w+)*(?:\\s+for\\s+[\\dsmh ]+)?$/i);
            if (m && t.length < 80) {
              label = t;
              // Try to find the command/content being executed nearby
              // Look for the last CODE element before this activity indicator
              var codes = d.querySelectorAll('code');
              for (var ci = codes.length - 1; ci >= 0; ci--) {
                var codeText = codes[ci].textContent.trim();
                if (codeText.startsWith('$') && codeText.length > 3) {
                  thinkingContent = codeText.substring(1).trim().substring(0, 200);
                  break;
                }
              }
              break;
            }
          }

          // Priority 2: "Running command" in expanded button
          if (label === 'Generating') {
            var runBtns = d.querySelectorAll('button[aria-expanded="true"]');
            for (var ri = runBtns.length - 1; ri >= 0; ri--) {
              var rtxt = (runBtns[ri].textContent || '').trim();
              if (/Running command/i.test(rtxt)) { label = rtxt; break; }
            }
          }

          // Priority 3: "Thinking" / "Generating" visible text
          if (label === 'Generating') {
            var thinkLeafs = Array.from(d.querySelectorAll('span')).filter(function(s) {
              return s.children.length === 0 && s.offsetParent !== null &&
                     /^(Thinking|Generating)$/i.test((s.textContent || '').trim());
            });
            if (thinkLeafs.length > 0) label = thinkLeafs[thinkLeafs.length - 1].textContent.trim();
          }

          // Priority 4: data-content-search-unit-key tool output
          if (label === 'Generating') {
            var units = Array.from(d.querySelectorAll('[data-content-search-unit-key]'));
            if (units.length > 0) {
              var lastUnit = units[units.length - 1];
              var unitKey = lastUnit.getAttribute('data-content-search-unit-key') || '';
              var parts = unitKey.split(':');
              var role = parts.length >= 3 ? parts[parts.length - 1] : '';
              if (role === 'tool') {
                var unitText = (lastUnit.innerText || '').trim();
                var firstLine = unitText.split('\\n')[0].trim();
                if (firstLine.startsWith('$')) {
                  label = 'Running command';
                  thinkingContent = firstLine.substring(1).trim().substring(0, 200);
                } else if (/^(Reading|Writing|Editing|Creating|Deleting)\\b/i.test(firstLine)) {
                  label = firstLine.substring(0, 80);
                } else if (firstLine.length > 0 && firstLine.length < 80) {
                  label = 'Tool: ' + firstLine;
                }
              }
            }
          }
          if (!isDesktopApp && !isCodexExtension) {
            liveDraft = findVisibleAssistantDraft();
            if (liveDraft && (!thinkingContent || liveDraft.length > thinkingContent.length + 40)) {
              thinkingContent = liveDraft;
            }
          }
        } catch(e) {}

        // Codex Desktop can leave a stale shimmer/task-list block visible long after
        // generation stopped. Do not treat that alone as live activity.
        // However, an active spinner (animate-spin) or shimmer with "Thinking"/"Generating"
        // text IS a reliable signal — trust it even without a stop button.
        if (isDesktopApp && !hasStopSignal && !hasSpinnerSignal && !hasShimmerSignal) {
          var hasActiveLabel = /^(Running command|Reading|Writing|Editing|Searching|Creating|Applying|Tool:)/i.test(label);
          if (!hasActiveLabel && !liveDraft) {
            return JSON.stringify({ thinking: false, label: '', thinkingContent: '' });
          }
        }

        // Codex (Desktop + side pane): only show the label, no draft content
        var finalContent = (isDesktopApp || isCodexExtension) ? '' : thinkingContent;
        return JSON.stringify({ thinking: true, label: label, thinkingContent: finalContent });
      `);
      try { return JSON.parse(raw); } catch { return { thinking: false, label: '' }; }
    } catch {
      return { thinking: false, label: '' };
    }
  }
  if (agentType !== 'claude' && agentType !== 'claude-desktop') return { thinking: false, label: '' };
  try {
    const raw = await evalInFrame(Runtime, `
      var result = { thinking: false, label: '', thinkingContent: '', spinnerVerb: '' };

      function appendThinkingText(target, txt) {
        txt = (txt || '').trim();
        if (!txt) return target;
        if (!target) return txt;
        if (target.includes(txt)) return target;
        return target + '\\n' + txt;
      }

      function isToolTraceLine(txt) {
        txt = (txt || '').trim();
        if (!txt) return true;
        if (/^(Thinking|Generating|Show thinking|Hide thinking|Claude Code|Retry)$/i.test(txt)) return true;
        if (/^(Bash|Read|Write|Edit|Edited|Update|Updated|Search|Searched|Find|Found|Glob pattern|Grep|LS|Cat|Kill|Launch|Rebuild|Inject|Poll|Check)\\b/i.test(txt)) return true;
        if (/^[A-Za-z]:\\\\/.test(txt)) return true;
        if (/^[/~.][\\\\/]/.test(txt)) return true;
        if (/^[*._|~â€¢Â·â–Œ-]+$/.test(txt)) return true;
        return false;
      }

      function compactNarrativeText(txt) {
        txt = (txt || '').replace(/\\r\\n/g, '\\n').trim();
        if (!txt) return '';
        var paras = txt.split(/\\n{2,}/);
        var kept = [];
        for (var i = 0; i < paras.length; i++) {
          var para = paras[i].trim();
          if (!para) continue;
          var lines = para.split('\\n').map(function(line) { return line.trim(); }).filter(Boolean);
          var useful = lines.filter(function(line) { return !isToolTraceLine(line); });
          if (useful.length === 0) continue;
          kept.push(useful.join('\\n'));
        }
        return kept.join('\\n\\n').trim().substring(0, 3000);
      }

      function collectDetailsText(detailsEl) {
        if (!detailsEl) return '';
        var parts = [];
        var nodes = Array.from(detailsEl.querySelectorAll('p, li, pre, code, div, span'));
        for (var i = 0; i < nodes.length; i++) {
          var node = nodes[i];
          if (!node || !node.offsetParent) continue;
          if (node.closest('summary')) continue;
          if (node.children.length > 0 && node.tagName !== 'PRE' && node.tagName !== 'CODE') continue;
          var txt = compactNarrativeText(node.innerText || node.textContent || '');
          if (!txt) continue;
          parts.push(txt);
        }
        var joined = parts.join('\\n').replace(/\\n{3,}/g, '\\n\\n').trim();
        return joined.substring(0, 3000);
      }

      function collectAssistantDraftText(root) {
        if (!root) return '';
        var blocks = Array.from(root.querySelectorAll('p, li, pre, code, div, span'));
        var parts = [];
        for (var i = 0; i < blocks.length; i++) {
          var block = blocks[i];
          if (!block || !block.offsetParent) continue;
          if (block.closest('details, summary, button')) continue;
          if (block.children.length > 0 && block.tagName !== 'PRE' && block.tagName !== 'CODE') continue;
          var txt = compactNarrativeText(block.innerText || block.textContent || '');
          if (!txt) continue;
          if (/^[*._|~•·▌]+$/.test(txt)) continue;
          parts.push(txt);
        }
        return parts.join('\\n').replace(/\\n{3,}/g, '\\n\\n').trim().substring(0, 3000);
      }

      function collectThinkingSummaryHints(root) {
        if (!root) return '';
        var parts = [];
        var seen = {};
        var summaries = Array.from(root.querySelectorAll('details summary, summary'));
        for (var i = 0; i < summaries.length; i++) {
          var txt = (summaries[i].innerText || summaries[i].textContent || '').trim();
          if (!txt) continue;
          if (/^(Show thinking|Hide thinking)$/i.test(txt)) continue;
          if (/^Thinking$/i.test(txt)) continue;
          if (seen[txt]) continue;
          seen[txt] = true;
          parts.push(txt);
        }
        return parts.join('\\n').trim().substring(0, 1000);
      }

      // Check for the spinner verb text (e.g. "Cerebrating...", "Spelunking...")
      var spinnerRow = d.querySelector('${CLAUDE_PRIMARY.spinnerRow}');
      if (spinnerRow) {
        var verbEl = spinnerRow.querySelector('${CLAUDE_PRIMARY.spinnerVerb}') ||
                     spinnerRow.querySelector('[class*="text_"]');
        if (verbEl) {
          result.spinnerVerb = (verbEl.textContent || '').trim();
        }
      }

      var msgs = d.querySelectorAll('[data-testid="${CLAUDE_PRIMARY.assistantTestId}"]');
        if (msgs.length > 0) {
          var last = msgs[msgs.length - 1];
        // Check for OPEN thinking details (actively thinking)
        var openDetails = last.querySelector('${CLAUDE_PRIMARY.thinkingDetails}') ||
                          last.querySelector('details[open]');
          if (openDetails) {
          var summary = openDetails.querySelector('${CLAUDE_PRIMARY.thinkingSummary}') ||
                        openDetails.querySelector('summary');
          // Use spinner verb if available, otherwise summary text
          result.thinking = true;
          result.label = result.spinnerVerb || (summary ? summary.textContent.trim() : 'Thinking');
          // Extract thinking content text (skip the summary element itself)
          try {
            result.thinkingContent = appendThinkingText(result.thinkingContent, collectDetailsText(openDetails));
            result.thinkingContent = appendThinkingText(result.thinkingContent, collectThinkingSummaryHints(openDetails));
            if (result.thinkingContent.length > 3000) result.thinkingContent = result.thinkingContent.substring(0, 3000) + '…';
          } catch(e) {}
          return JSON.stringify(result);
        }
        // Spinner visible but no open thinking details = generating after thinking
        if (result.spinnerVerb) {
          result.thinking = true;
          result.label = result.spinnerVerb;
          try {
            result.thinkingContent = appendThinkingText(result.thinkingContent, collectDetailsText(last.querySelector('details[open]') || d.querySelector('details[open]')));
            result.thinkingContent = appendThinkingText(result.thinkingContent, collectAssistantDraftText(last));
            if (!result.thinkingContent) {
              result.thinkingContent = appendThinkingText(result.thinkingContent, collectThinkingSummaryHints(last));
              result.thinkingContent = appendThinkingText(result.thinkingContent, collectThinkingSummaryHints(d));
            }
          } catch(e) {}
          return JSON.stringify(result);
        }
        // Check for CLOSED thinking details — thinking finished, now generating
        var closedDetails = last.querySelector('details.thinking_aHyQPQ:not([open])') ||
                            last.querySelector('details:not([open])');
        if (closedDetails) {
          var clsSummary = closedDetails.querySelector('${CLAUDE_PRIMARY.thinkingSummary}') ||
                           closedDetails.querySelector('summary');
          var closedLabel = clsSummary ? clsSummary.textContent.trim() : '';
          if (closedLabel) {
            result.label = closedLabel;
            return JSON.stringify(result);
          }
        }
      } else if (result.spinnerVerb) {
        // Spinner visible but no assistant messages yet (first response)
        result.thinking = true;
        result.label = result.spinnerVerb;
        try {
          result.thinkingContent = appendThinkingText(result.thinkingContent, collectDetailsText(d.querySelector('details[open]')));
          result.thinkingContent = appendThinkingText(result.thinkingContent, collectAssistantDraftText(d.querySelector('[data-testid="${CLAUDE_PRIMARY.assistantTestId}"]:last-of-type') || d.body));
          if (!result.thinkingContent) {
            result.thinkingContent = appendThinkingText(result.thinkingContent, collectThinkingSummaryHints(d));
          }
        } catch(e) {}
        return JSON.stringify(result);
      }

      return JSON.stringify(result);
    `);
    try { return JSON.parse(raw); } catch { return { thinking: false, label: '' }; }
  } catch {
    return { thinking: false, label: '' };
  }
}

// ─── Claude message reader ────────────────────────────────────────────────────

function buildClaudeReadExpr(userClass, userText, userTextAlt) {
  const userTextSel = userText + (userTextAlt ? ', ' + userTextAlt : '');
  return `
    var bt = String.fromCharCode(96);
    var fence = bt + bt + bt;

    var BLOCK_TAGS = { DIV:1, P:1, LI:1, TR:1, H1:1, H2:1, H3:1, H4:1, H5:1, H6:1, BLOCKQUOTE:1, SECTION:1, ARTICLE:1 };

    function compactToolBody(header, bodyText) {
      var text = (bodyText || '').replace(/\\r\\n/g, '\\n').trim();
      if (!text) return '';
      var lowerHeader = String(header || '').toLowerCase();
      var lines = text.split('\\n').map(function(line) { return line.trim(); }).filter(Boolean);
      var filtered = [];
      var seen = {};
      lines.forEach(function(line) {
        var lower = line.toLowerCase();
        if (!line) return;
        if (lower === lowerHeader) return;
        if (seen[lower]) return;
        seen[lower] = true;
        filtered.push(line);
      });
      if (filtered.length === 0) return '';
      if (/^read\b/i.test(lowerHeader)) return '';
      var limit = (/^(glob|grep|search|find)\b/i.test(lowerHeader)) ? 2 : 3;
      return filtered.slice(0, limit).join('\\n').substring(0, 600).trim();
    }

    function nodeToText(node) {
      if (node.nodeType === 3) return node.textContent;
      if (node.nodeType !== 1) return '';
      var tag = node.nodeName.toUpperCase();
      if (tag === 'BR') return '\\n';
      // Skip UI chrome elements that should not appear in scraped text
      if (tag === 'BUTTON' || tag === 'SVG' || tag === 'svg') return '';
      var cls = (typeof node.className === 'string') ? node.className : '';
      // Skip copy buttons, icon buttons, action buttons
      if (cls.includes('copyButton') || cls.includes('iconButton') || cls.includes('actionButton')) return '';
      // Skip permission request containers (they have their own detection flow)
      if (cls.includes('permissionRequest')) return '';
      // Skip keyboard hints and shortcut indicators
      if (cls.includes('keyboardHints') || cls.includes('shortcutNum')) return '';
      if (tag === 'DETAILS') {
        if (cls.includes('thinking')) return '';
        var summary = node.querySelector('summary');
        var summaryText = summary ? summary.textContent.trim() : 'Details';
        var contentParts = Array.from(node.childNodes)
          .filter(function(n) { return n.nodeName.toUpperCase() !== 'SUMMARY'; })
          .map(nodeToText).join('').trim();
        var label = '\\n[' + summaryText + ']\\n';
        return contentParts ? label + contentParts + '\\n[end]\\n' : label + '[end]\\n';
      }
      if (tag === 'SUMMARY') return '';
      // Handle tool use containers — format as structured [Tool Name]\\n...\\n[end]
      if (cls.includes('toolUse_')) {
        var nameEl = node.querySelector('[class*="toolNameText_"]');
        var descEl = node.querySelector('[class*="toolNameTextSecondary"]');
        var toolName = nameEl ? nameEl.textContent.trim() : 'Tool';
        var toolDesc = descEl ? descEl.textContent.trim() : '';
        var header = toolName + (toolDesc ? ' ' + toolDesc : '');
        // Check for Monaco diff editor (Edit tool blocks)
        var diffWrapper = node.querySelector('[class*="diffEditorWrapper_"]');
        if (diffWrapper) {
          var secondaryEl = node.querySelector('[class*="secondaryLine_"]');
          var summary = secondaryEl ? secondaryEl.textContent.trim() : '';
          var diffEditor = diffWrapper.querySelector('.monaco-diff-editor');
          var body = summary + '\\n';
          if (diffEditor) {
            var origEditor = diffEditor.querySelector('.editor.original');
            var modEditor = diffEditor.querySelector('.editor.modified');
            function getViewLineTexts(editor) {
              if (!editor) return [];
              return Array.from(editor.querySelectorAll('.view-line')).map(function(l) { return l.textContent; });
            }
            var origLines = getViewLineTexts(origEditor);
            var modLines = getViewLineTexts(modEditor);
            // Build a simple unified diff
            if (origLines.length > 0 || modLines.length > 0) {
              body += fence + 'diff\\n';
              // Find common prefix/suffix to show only changed region
              var maxOrig = origLines.length, maxMod = modLines.length;
              var prefixLen = 0;
              while (prefixLen < maxOrig && prefixLen < maxMod && origLines[prefixLen] === modLines[prefixLen]) prefixLen++;
              var suffixLen = 0;
              while (suffixLen < (maxOrig - prefixLen) && suffixLen < (maxMod - prefixLen) && origLines[maxOrig - 1 - suffixLen] === modLines[maxMod - 1 - suffixLen]) suffixLen++;
              // Show context lines around changes
              var ctxStart = Math.max(0, prefixLen - 2);
              var ctxEndOrig = Math.min(maxOrig, maxOrig - suffixLen + 2);
              var ctxEndMod = Math.min(maxMod, maxMod - suffixLen + 2);
              for (var li = ctxStart; li < ctxEndOrig || li < ctxEndMod; li++) {
                var inSharedPrefix = li < prefixLen;
                var inSharedSuffix = li >= (maxOrig - suffixLen) && li >= (maxMod - suffixLen);
                if (inSharedPrefix || inSharedSuffix) {
                  // Context line (same in both)
                  if (li < maxMod) body += ' ' + modLines[li] + '\\n';
                } else {
                  if (li < maxOrig - suffixLen && li < maxOrig) body += '-' + origLines[li] + '\\n';
                  if (li < maxMod - suffixLen && li < maxMod) body += '+' + modLines[li] + '\\n';
                }
              }
              body += fence + '\\n';
            }
          }
          return '\\n[' + header + ']\\n' + body + '[end]\\n';
        }
        // Extract IN/OUT rows
        var rows = node.querySelectorAll('[class*="toolBodyRow_"]');
        var body = '';
        rows.forEach(function(row) {
          var labelEl = row.querySelector('[class*="toolBodyRowLabel_"]');
          var contentEl = row.querySelector('[class*="toolBodyRowContent_"]');
          var rowLabel = labelEl ? labelEl.textContent.trim() : '';
          var rowContent = contentEl ? contentEl.textContent.trim() : '';
          if (rowLabel && rowContent) {
            body += rowLabel + '\\n' + rowContent + '\\n';
          }
        });
        if (!body) {
          var bodyEl = node.querySelector('[class*="toolBody_"]');
          if (bodyEl) {
            var monacoEditor = bodyEl.querySelector('.monaco-editor:not(.original-in-monaco-diff-editor):not(.modified-in-monaco-diff-editor)');
            if (monacoEditor) {
              var lines = Array.from(monacoEditor.querySelectorAll('.view-line')).map(function(l) { return l.textContent; });
              body = compactToolBody(header, lines.join('\\n'));
            } else if (!bodyEl.querySelector('.monaco-diff-editor')) {
              body = compactToolBody(header, bodyEl.textContent);
            }
          }
        }
        if (!body) return '\\n[' + header + ']\\n[end]\\n';
        return '\\n[' + header + ']\\n' + body + '[end]\\n';
      }
      if (tag === 'PRE') {
        var codeEl = node.querySelector('code');
        var preCls = codeEl ? (codeEl.className || '') : '';
        var lang = (preCls.match(/language-(\\w+)/) || [])[1] || '';
        return '\\n' + fence + lang + '\\n' + (codeEl || node).textContent.trim() + '\\n' + fence + '\\n';
      }
      if (tag === 'CODE') { return bt + node.textContent + bt; }
      var inner = Array.from(node.childNodes).map(nodeToText).join('');
      if (BLOCK_TAGS[tag] && inner.trim()) {
        return inner.endsWith('\\n') ? inner : inner + '\\n';
      }
      return inner;
    }

    const msgs = [];
    const els = d.querySelectorAll('.message_07S1Yg');
    els.forEach(function(el) {
      const isUser = ${userClass ? `el.classList.contains('${userClass}')` : 'false'} ||
                     el.getAttribute('data-role') === 'user';
      const isAssistant = el.getAttribute('data-testid') === '${CLAUDE_PRIMARY.assistantTestId}';
      if (isUser) {
        const textEl = el.querySelector('${userTextSel}');
        if (textEl) msgs.push({ role: 'user', content: textEl.textContent.trim() });
      } else if (isAssistant) {
        const text = nodeToText(el).trim();
        if (text) msgs.push({ role: 'assistant', content: text });
      }
    });
    return JSON.stringify(msgs);
  `;
}

// ─── Output details expansion helpers ────────────────────────────────────────
//
// Claude Code conditionally renders the body of tool-output <details> elements,
// so a closed <details> has no DOM content for nodeToText to capture.
// We temporarily open them before reading, wait for React to render, then restore.

async function _expandOutputDetails(Runtime) {
  // Open closed "N lines of output" <details> so their content is in the DOM
  // for reading.  We INTENTIONALLY leave them open after reading — closing
  // them every poll caused open/close DOM mutation cycles that shifted focus
  // between Electron renderer processes (visible as rapid focus shifts
  // between Claude Code windows in different Antigravity instances).
  //
  // Trade-off: tool output sections in the user's Claude Code UI will appear
  // expanded.  This is purely visual; the user can collapse them manually if
  // they want.  Re-collapsing here would re-introduce the focus issue.
  try {
    const count = await evalInFrame(Runtime, `
      var toOpen = Array.from(d.querySelectorAll('details:not([open])')).filter(function(el) {
        var s = el.querySelector('summary');
        return s && /^\\d+\\s+lines?(?:\\s+of\\s+output)?$/i.test(s.textContent.trim());
      });
      toOpen.forEach(function(el) { el.open = true; });
      return toOpen.length;
    `);
    const n = Number(count) || 0;
    if (n === 0) return 0;
    // Wait briefly for React to lazy-render the newly-expanded content.
    // We can't poll readiness without another eval per check (more focus risk),
    // so use a single short fixed delay.  React typically renders within ~50ms.
    await new Promise(r => setTimeout(r, 200));
    return n;
  } catch {
    return 0;
  }
}

// No-op now: details stay open after expanding.  Kept for callsite compatibility.
function _collapseOutputDetails() {}

async function readClaudeMessages(Runtime, sessionId) {
  // Pre-flight: open lazy-rendered output <details> so their content is in the DOM.
  const expanded = await _expandOutputDetails(Runtime);
  // _expandOutputDetails already polls until content appears (up to 1 s),
  // so no additional fixed delay is needed here.

  // Strategy 1: primary selectors
  try {
    const raw = await evalInFrame(Runtime, buildClaudeReadExpr(
      CLAUDE_PRIMARY.userClass, CLAUDE_PRIMARY.userText, CLAUDE_PRIMARY.userTextAlt
    ));
    if (raw !== null) {
      resetReadFailures(sessionId);
      _collapseOutputDetails(Runtime);
      return raw;
    }
  } catch (e) {
    console.warn(`[${sessionId}] [sel] Claude primary read error: ${e.message}`);
  }

  // Strategy 2: fallback selectors
  try {
    const raw = await evalInFrame(Runtime, buildClaudeReadExpr(
      null, CLAUDE_FALLBACK.userText, null
    ));
    if (raw !== null) {
      console.log(`[${sessionId}] [sel] Claude fallback read succeeded`);
      resetReadFailures(sessionId);
      _collapseOutputDetails(Runtime);
      return raw;
    }
  } catch (e) {
    console.warn(`[${sessionId}] [sel] Claude fallback read error: ${e.message}`);
  }

  _collapseOutputDetails(Runtime);
  const f = recordReadFailure(sessionId);
  if (f.readFails === 1 || f.readFails % 5 === 0) {
    console.warn(`[${sessionId}] [sel] Claude read null x${f.readFails}`);
    await captureDiagnostic(Runtime, sessionId);
  }
  return null;
}

// ─── Codex message reader ─────────────────────────────────────────────────────

const CODEX_READ_EXPR = `
  var bt = String.fromCharCode(96);
  var fence = bt + bt + bt;

  // Strategy 1: Sequential flat-child reader for Codex conversation container.
  // The Codex side pane renders all items (user bubbles, "Ran ..." commands, assistant text,
  // "Context automatically compacted" banners, file change cards, "Worked for" summaries)
  // as flat siblings inside a flex-col wrapper — NOT nested inside turn elements.
  var conv = d.querySelector('[data-thread-find-target="conversation"]');
  // Codex renders turns inside a .flex.flex-col.gap-3 container.
  // Each child of gap-3 is a complete turn (user msg + assistant response).
  // Inside each turn, assistant content lives in .flex.flex-col.space-y-0 containers
  // or as direct children (for simple responses like "Received.").
  var gap3 = conv ? conv.querySelector('.flex.flex-col.gap-3') : null;
  if (gap3 && gap3.children.length > 0) {
    var allItems = [];
    for (var gi = 0; gi < gap3.children.length; gi++) {
      var turn = gap3.children[gi];
      // Collect items from space-y-0 containers inside this turn
      var sy0s = turn.querySelectorAll(':scope .flex.flex-col.space-y-0');
      if (sy0s.length > 0) {
        for (var si = 0; si < sy0s.length; si++) {
          var ch = sy0s[si].children;
          for (var ci = 0; ci < ch.length; ci++) allItems.push(ch[ci]);
        }
      }
      // Also collect direct flex-col gap-0 children (simple turns, final messages)
      // Skip gap-0 containers that are inside a space-y-0 (already covered) or that
      // CONTAIN a space-y-0 (their children overlap with sy0 items and the coarse
      // gap-0 children cause command handlers to swallow narrative text).
      var gap0s = turn.querySelectorAll(':scope > .flex.flex-col > .flex.flex-col.gap-0');
      if (gap0s.length === 0) gap0s = turn.querySelectorAll(':scope .flex.flex-col.gap-0');
      for (var g0i = 0; g0i < gap0s.length; g0i++) {
        var skipGap0 = false;
        // Skip if inside a space-y-0
        var p = gap0s[g0i].parentElement;
        while (p && p !== turn) {
          if (p.classList && p.classList.contains('space-y-0')) { skipGap0 = true; break; }
          p = p.parentElement;
        }
        // Skip if this gap-0 contains a space-y-0 (content already collected above)
        if (!skipGap0 && gap0s[g0i].querySelector('.flex.flex-col.space-y-0')) {
          skipGap0 = true;
        }
        if (!skipGap0) {
          var ch2 = gap0s[g0i].children;
          for (var ci2 = 0; ci2 < ch2.length; ci2++) allItems.push(ch2[ci2]);
        }
      }
    }

    var msgs = [];
    var pendingAssistant = [];

    function flushAssistant() {
      if (pendingAssistant.length === 0) return;
      var content = pendingAssistant.join('\\n\\n').trim();
      if (content) msgs.push({ role: 'assistant', content: content });
      pendingAssistant = [];
    }

    // Extract diff content from a diffs-container shadow DOM.
    // The shadow DOM uses: <code data-code><div data-gutter>...<div data-content>
    // The data-content div has children with data-line-type="change-addition"|"change-deletion"|"context"
    function _extractDiffFromShadow(parentEl) {
      var dc = parentEl.querySelector('diffs-container');
      if (!dc || !dc.shadowRoot) return '';
      var sr = dc.shadowRoot;
      var contentCol = sr.querySelector('div[data-content]');
      if (!contentCol) return '';
      var diffLines = [];
      var children = contentCol.children;
      for (var li = 0; li < children.length && diffLines.length < 200; li++) {
        var line = children[li];
        var lineType = line.getAttribute('data-line-type') || '';
        var lineText = (line.innerText || line.textContent || '');
        // Trim trailing whitespace but preserve leading
        lineText = lineText.replace(/\\s+$/, '');
        if (lineType === 'change-addition') {
          diffLines.push('+' + lineText);
        } else if (lineType === 'change-deletion') {
          diffLines.push('-' + lineText);
        } else if (lineType === 'context' && lineText) {
          diffLines.push(' ' + lineText);
        }
      }
      return diffLines.length > 0 ? diffLines.join('\\n') : '';
    }

    var items = allItems;
    for (var i = 0; i < items.length; i++) {
      var el = items[i];
      var text = (el.innerText || '').trim();
      if (!text) continue; // skip spacers

      // Helper: extract inline images (screenshots/attachments) from a user message element
      function _extractImages(container) {
        var imgParts = [];
        var images = container.querySelectorAll('img');
        for (var ii = 0; ii < images.length; ii++) {
          var imgSrc = images[ii].src || '';
          if (imgSrc.startsWith('data:image/') && imgSrc.length < 700000) {
            imgParts.push('![screenshot](' + imgSrc + ')');
          } else if (imgSrc.startsWith('data:image/')) {
            imgParts.push('[Screenshot: ' + images[ii].naturalWidth + 'x' + images[ii].naturalHeight + ' (too large)]');
          } else if (imgSrc.startsWith('blob:')) {
            imgParts.push('[Screenshot: ' + images[ii].naturalWidth + 'x' + images[ii].naturalHeight + ']');
          }
        }
        return imgParts;
      }

      // Detect user messages: has items-end class or whitespace-pre-wrap inside items-end
      var userEl = el.querySelector('[class*="items-end"]');
      if (userEl) {
        flushAssistant();
        var wpw = userEl.querySelector('.whitespace-pre-wrap');
        var utext = wpw ? wpw.textContent.trim() : userEl.textContent.trim();
        var uimgs = _extractImages(userEl);
        var ucontent = (uimgs.length > 0 ? uimgs.join('\\n') + '\\n' : '') + (utext || '');
        if (ucontent.trim()) msgs.push({ role: 'user', content: ucontent.trim() });
        continue;
      }
      // Detect user unit key
      var userUnit = el.querySelector('[data-content-search-unit-key$=":user"]');
      if (userUnit) {
        flushAssistant();
        var wpw2 = userUnit.querySelector('.whitespace-pre-wrap');
        var ut2 = wpw2 ? wpw2.textContent.trim() : userUnit.textContent.trim();
        var uimgs2 = _extractImages(userUnit);
        var ucontent2 = (uimgs2.length > 0 ? uimgs2.join('\\n') + '\\n' : '') + (ut2 || '');
        if (ucontent2.trim()) msgs.push({ role: 'user', content: ucontent2.trim() });
        continue;
      }

      // "Context automatically compacted" banner — flush before it
      if (/context.*compact/i.test(text) && text.length < 60) {
        flushAssistant();
        pendingAssistant.push('--- ' + text + ' ---');
        flushAssistant();
        continue;
      }

      // "Worked for Xs" — marks end of a turn, flush accumulated content first
      var statusBtn = el.querySelector('button[aria-expanded]');
      if (statusBtn && /Worked for/i.test(statusBtn.textContent)) {
        pendingAssistant.push((statusBtn.textContent || '').trim());
        flushAssistant();
        continue;
      }
      // "Running command for Ns" — active, add to current accumulation
      if (statusBtn && /Running command/i.test(statusBtn.textContent)) {
        pendingAssistant.push((statusBtn.textContent || '').trim());
      }

      // Command blocks ("Ran ..." with group/command inside, or "$ ..." shell lines)
      // The group/command element only contains the command header (e.g. "$ command").
      // The actual command output lives in .overflow-hidden descendant of the item,
      // or in a group/output sibling of the command element.
      var cmdEls = [];
      if (el.matches && el.matches('[class*="group/command"]')) {
        cmdEls = [el];
      } else {
        cmdEls = Array.from(el.querySelectorAll('[class*="group/command"]'));
      }
      if (cmdEls.length > 0) {
        for (var ci = 0; ci < cmdEls.length; ci++) {
          var cmdText = (cmdEls[ci].innerText || '').trim();
          if (!cmdText) continue;
          var cmdLine = cmdText.split('\\n')[0].replace(/^\\$\\s*/, '').trim();
          if (!cmdLine) cmdLine = cmdText.split('\\n')[0];
          // Find the output: try group/output sibling first, then .overflow-hidden in item
          var outputEl = null;
          var cp = cmdEls[ci].parentElement;
          if (cp) {
            var sib = cp.querySelector('[class*="group/output"]');
            if (sib) outputEl = sib;
          }
          if (!outputEl) outputEl = el.querySelector('.overflow-hidden');
          var cmdOutput = outputEl ? (outputEl.innerText || '').trim() : '';
          var block = '[Bash ' + cmdLine + ']\\n' + (cmdOutput || '') + '\\n[end]';
          pendingAssistant.push(block);
        }
        continue;
      }

      // "Ran ..." summary text (when commands are collapsed — no group/command children)
      if (/^Ran /i.test(text)) {
        var ranLine = text.split('\\n')[0].trim().substring(4);
        // Include any visible output below the "Ran" header
        var ranOutput = text.split('\\n').slice(1).join('\\n').trim();
        pendingAssistant.push('[Bash ' + ranLine + ']\\n' + (ranOutput || '') + '\\n[end]');
        continue;
      }

      // File change cards
      var fileDiffEls = [];
      if (el.matches && el.matches('[class*="group/file-diff"]')) {
        fileDiffEls = [el];
      } else {
        fileDiffEls = Array.from(el.querySelectorAll('[class*="group/file-diff"]'));
      }
      if (fileDiffEls.length === 0 && el.matches && el.matches('[class*="thread-diff"]')) {
        fileDiffEls = [el];
      }
      if (fileDiffEls.length > 0) {
        var seenFiles = {};
        for (var fdi = 0; fdi < fileDiffEls.length; fdi++) {
          var fileDiff = fileDiffEls[fdi];
          var fnameBtns = fileDiff.querySelectorAll('button[data-state]');
          fnameBtns.forEach(function(fb) {
            var spanTexts = Array.from(fb.querySelectorAll('span'))
              .map(function(sp) { return (sp.textContent || '').trim(); })
              .filter(Boolean);
            var fname = spanTexts.find(function(t) { return /[\\\\/]/.test(t); })
              || spanTexts.sort(function(a, b) { return b.length - a.length; })[0]
              || (fb.textContent || '').trim();
            // De-duplicate filename (responsive span renders name twice)
            if (fname && fname.length > 4) {
              var fhalf = Math.floor(fname.length / 2);
              if (fname.substring(0, fhalf) === fname.substring(fhalf)) fname = fname.substring(0, fhalf);
            }
            if (fname && fname.length < 200 && !seenFiles[fname]) {
              seenFiles[fname] = true;
              var diffContent = _extractDiffFromShadow(fileDiff);
              var block = '[Edit ' + fname + ']\\n';
              if (diffContent) block += diffContent + '\\n';
              block += '[end]';
              pendingAssistant.push(block);
            }
          });
        }
        continue;
      }
      // "N file(s) changed" summary
      if (/^\\d+\\s+files?\\s+changed/i.test(text)) {
        pendingAssistant.push(text.split('\\n')[0].trim());
        continue;
      }

      // "Edited file" block — may have inline diff in shadow DOM
      if (/^Edited file/i.test(text)) {
        // Extract filename: look for a line containing a dot (file extension)
        var editName = '';
        var _efParts = text.split(String.fromCharCode(10));
        for (var _efi = 0; _efi < _efParts.length; _efi++) {
          var _efLine = _efParts[_efi].replace(/^\\s+|\\s+$/g, '');
          if (_efLine && _efLine.indexOf('.') >= 0 && _efLine.length > 2) {
            editName = _efLine;
            break;
          }
        }
        // Remove duplicate filename (responsive span renders name twice)
        if (editName.length > 4) {
          var half = Math.floor(editName.length / 2);
          if (editName.substring(0, half) === editName.substring(half)) {
            editName = editName.substring(0, half);
          }
        }
        var diffContent = _extractDiffFromShadow(el);
        if (editName) {
          var block = '[Edit ' + editName + ']\\n';
          if (diffContent) block += diffContent + '\\n';
          block += '[end]';
          pendingAssistant.push(block);
        }
        continue;
      }

      // "Final message" divider — skip it
      if (/^Final message$/i.test(text)) continue;
      // Skip bare button text (Undo, Review)
      if (/^(Undo|Review)$/i.test(text)) continue;

      // Check for inline images (screenshots taken by the agent)
      var aImgs = _extractImages(el);
      if (aImgs.length > 0) {
        pendingAssistant.push(aImgs.join('\\n'));
      }

      // Regular assistant text (narrative paragraphs)
      if (text.length > 5) {
        // Use innerText directly — Codex uses divs not p tags
        pendingAssistant.push(text);
      }
    }
    flushAssistant();
    if (msgs.length > 0) return JSON.stringify(msgs);
  }

  // Strategy 2: legacy class-based selectors (fallback)
  var userEls = Array.from(d.querySelectorAll('.whitespace-pre-wrap'))
    .filter(function(el) { return !!el.closest('[class*="items-end"]'); });

  var assistantEls = Array.from(d.querySelectorAll('[class*="overflow-x-auto"]'))
    .filter(function(el) {
      if (el.closest('[class*="items-end"]')) return false;
      var p = el.parentElement;
      while (p && p !== d.body) {
        if (p.className && typeof p.className === 'string' && p.className.includes('overflow-x-auto')) return false;
        p = p.parentElement;
      }
      return !!(el.querySelector('p') || el.querySelector('li') || el.querySelector('pre'));
    });

  if (userEls.length === 0 && assistantEls.length === 0) return JSON.stringify([]);

  var all = userEls.map(function(el) { return { el: el, role: 'user' }; })
    .concat(assistantEls.map(function(el) { return { el: el, role: 'assistant' }; }));
  all.sort(function(a, b) {
    var pos = a.el.compareDocumentPosition(b.el);
    return (pos & 4) ? -1 : (pos & 2) ? 1 : 0;
  });

  var msgs = [];
  for (var i = 0; i < all.length; i++) {
    var item = all[i];
    if (item.role === 'user') {
      var text = item.el.textContent.trim();
      if (text) msgs.push({ role: 'user', content: text });
    } else {
      var parts = [];
      var children = Array.from(item.el.querySelectorAll('p, li, pre, h1, h2, h3, h4'));
      for (var j = 0; j < children.length; j++) {
        var child = children[j];
        if (child.tagName !== 'PRE' && child.closest('pre')) continue;
        if (child.tagName === 'PRE') {
          var codeEl = child.querySelector('code');
          var langMatch = codeEl ? (codeEl.className.match(/language-(\\w+)/) || []) : [];
          var lang = langMatch[1] || '';
          parts.push('\\n' + fence + lang + '\\n' + child.textContent.trim() + '\\n' + fence + '\\n');
        } else {
          var t = child.textContent.trim();
          if (t) parts.push(t);
        }
      }
      var content = parts.join('\\n').trim();
      if (content.length > 5) msgs.push({ role: 'assistant', content: content });
    }
  }
  return JSON.stringify(msgs);
`;

const CODEX_DESKTOP_READ_EXPR = `
  var bt = String.fromCharCode(96);
  var fence = bt + bt + bt;
  var BLOCK_TAGS = { DIV:1, P:1, LI:1, TR:1, H1:1, H2:1, H3:1, H4:1, H5:1, H6:1, BLOCKQUOTE:1, SECTION:1, ARTICLE:1 };

  function squashNewlines(text) {
    return String(text || '').replace(/\\n{3,}/g, '\\n\\n').trim();
  }

  function cleanLine(line, role) {
    var trimmed = String(line || '').trim();
    if (!trimmed) return '';
    if (/^\\d{1,2}:\\d{2}\\s*(AM|PM)$/i.test(trimmed)) return '';
    if (/^(Playground|Commit|Undo|Review|Show more|Threads|Plugins|Automations|Search|New chat|Settings|Copy|Copy message|Fork from this message)$/i.test(trimmed)) return '';
    if (role === 'assistant' && /^(Worked for .*|Working for .*)$/i.test(trimmed)) return '';
    return String(line || '').replace(/\\s+$/g, '');
  }

  function cleanText(text, role) {
    if (!text) return '';
    var lines = String(text).split('\\n');
    var kept = [];
    for (var i = 0; i < lines.length; i++) {
      var raw = cleanLine(lines[i], role);
      if (!raw) {
        if (kept.length > 0 && kept[kept.length - 1] !== '') kept.push('');
        continue;
      }
      kept.push(raw);
    }
    while (kept.length > 0 && kept[0] === '') kept.shift();
    while (kept.length > 0 && kept[kept.length - 1] === '') kept.pop();
    return squashNewlines(kept.join('\\n'));
  }

  function uniquePush(parts, value) {
    if (!value) return;
    if (parts.length > 0 && parts[parts.length - 1] === value) return;
    parts.push(value);
  }

  function uniquePushAny(parts, value) {
    if (!value) return;
    if (parts.indexOf(value) !== -1) return;
    parts.push(value);
  }

  function roleFromUnit(unit) {
    var key = unit.getAttribute('data-content-search-unit-key') || '';
    var parts = key.split(':');
    return parts.length >= 3 ? parts[parts.length - 1] : '';
  }

  function stripControls(root) {
    if (!root) return root;
    var clone = root.cloneNode(true);
    Array.from(clone.querySelectorAll('button, svg, path, [aria-label*="Copy"], [aria-label*="Fork"]')).forEach(function(node) {
      if (node && node.parentNode) node.parentNode.removeChild(node);
    });
    Array.from(clone.querySelectorAll('span, div')).forEach(function(node) {
      var txt = (node.innerText || node.textContent || '').trim();
      if (/^\\d{1,2}:\\d{2}\\s*(AM|PM)$/i.test(txt)) {
        if (node.parentNode) node.parentNode.removeChild(node);
      }
    });
    return clone;
  }

  function inlineText(node) {
    if (!node) return '';
    if (node.nodeType === 3) return node.textContent || '';
    if (node.nodeType !== 1) return '';
    var tag = node.nodeName.toUpperCase();
    if (tag === 'BR') return '\\n';
    if (tag === 'PRE') return '';
    if (tag === 'CODE') {
      var codeText = squashNewlines(node.textContent || '');
      return codeText ? bt + codeText + bt : '';
    }
    if (tag === 'BUTTON' || tag === 'SVG' || tag === 'PATH') return '';
    var inner = Array.from(node.childNodes).map(inlineText).join('');
    if ((tag === 'P' || tag === 'DIV') && !node.querySelector('pre, ul, ol, li, h1, h2, h3, h4, h5, h6')) {
      return inner;
    }
    return inner;
  }

  function listItemText(li) {
    var parts = [];
    Array.from(li.childNodes).forEach(function(child) {
      if (child.nodeType === 1) {
        var tag = child.nodeName.toUpperCase();
        if (tag === 'UL' || tag === 'OL') return;
      }
      parts.push(inlineText(child));
    });
    return squashNewlines(parts.join(''));
  }

  function desktopCodeCardText(node) {
    if (!node || node.nodeType !== 1) return '';
    var cls = typeof node.className === 'string' ? node.className : '';
    if (cls.indexOf('bg-token-text-code-block-background') === -1 && cls.indexOf('text-code-block-background') === -1) return '';
    var hasNestedCard = Array.from(node.children || []).some(function(child) {
      if (!child || child.nodeType !== 1) return false;
      var childCls = typeof child.className === 'string' ? child.className : '';
      return childCls.indexOf('bg-token-text-code-block-background') !== -1 || childCls.indexOf('text-code-block-background') !== -1;
    });
    if (hasNestedCard) return '';
    var codeEl = node.querySelector('code[class*="whitespace-pre"]');
    if (!codeEl) return '';
    var codeText = String(codeEl.textContent || '').replace(/\\r\\n/g, '\\n').replace(/\\n+$/g, '');
    if (!codeText.trim()) return '';
    var headerEl = node.querySelector('[class*="truncate"]');
    var lang = squashNewlines(headerEl ? (headerEl.textContent || '') : '').split(/\\s+/)[0].toLowerCase() || 'text';
    if (!/^[a-z0-9_+-]+$/.test(lang)) lang = 'text';
    return '\\n' + fence + lang + '\\n' + codeText + '\\n' + fence + '\\n\\n';
  }

  function nodeToMarkdown(node, depth, role) {
    if (!node) return '';
    if (node.nodeType === 3) return node.textContent || '';
    if (node.nodeType !== 1) return '';
    var codeCard = desktopCodeCardText(node);
    if (codeCard) return codeCard;
    var tag = node.nodeName.toUpperCase();
    if (tag === 'PRE') {
      var codeEl = node.querySelector('code');
      var cls = codeEl ? (codeEl.className || '') : '';
      var lang = (cls.match(/language-(\\w+)/) || [])[1] || '';
      var codeText = squashNewlines((codeEl || node).textContent || '');
      return codeText ? ('\\n' + fence + lang + '\\n' + codeText + '\\n' + fence + '\\n\\n') : '';
    }
    if (tag === 'CODE') return bt + squashNewlines(node.textContent || '') + bt;
    if (tag === 'BR') return '\\n';
    if (tag === 'BUTTON' || tag === 'SVG' || tag === 'PATH') return '';
    if (/^H[1-6]$/.test(tag)) {
      var heading = squashNewlines(inlineText(node));
      return heading ? ('**' + heading + '**\\n\\n') : '';
    }
    if (tag === 'P') {
      var para = squashNewlines(inlineText(node));
      return para ? (para + '\\n\\n') : '';
    }
    if (tag === 'UL' || tag === 'OL') {
      var items = [];
      var idx = 1;
      Array.from(node.children).forEach(function(li) {
        if (!li || li.nodeName.toUpperCase() !== 'LI') return;
        var body = listItemText(li);
        if (body) {
          var marker = tag === 'OL' ? (idx + '. ') : '- ';
          items.push(marker + body);
          idx++;
        }
        Array.from(li.children).forEach(function(child) {
          var childTag = child.nodeName.toUpperCase();
          if (childTag === 'UL' || childTag === 'OL') {
            var nested = squashNewlines(nodeToMarkdown(child, depth + 1, role));
            if (nested) items.push(nested);
          }
        });
      });
      return items.length > 0 ? items.join('\\n') + '\\n\\n' : '';
    }
    if (tag === 'BLOCKQUOTE') {
      var quote = squashNewlines(Array.from(node.childNodes).map(function(child) {
        return nodeToMarkdown(child, depth + 1, role);
      }).join(''));
      if (!quote) return '';
      return quote.split('\\n').map(function(line) { return line ? '> ' + line : '>'; }).join('\\n') + '\\n\\n';
    }
    var hasBlockChildren = Array.from(node.children || []).some(function(child) {
      return BLOCK_TAGS[child.nodeName.toUpperCase()] || child.nodeName.toUpperCase() === 'PRE' || child.nodeName.toUpperCase() === 'UL' || child.nodeName.toUpperCase() === 'OL';
    });
    if (!hasBlockChildren) {
      return inlineText(node);
    }
    return Array.from(node.childNodes).map(function(child) {
      return nodeToMarkdown(child, depth + 1, role);
    }).join('');
  }

  function toolify(text) {
    if (!text) return '';
    var lines = String(text).split('\\n');
    var first = (lines[0] || '').trim();
    var rest = squashNewlines(lines.slice(1).join('\\n'));
    var m = first.match(/^Ran\\s+(.+)$/i);
    if (m) return '[Bash ' + m[1].trim() + ']\\n' + (rest || '') + '\\n[end]';
    m = first.match(/^Bash\\s+(.+)$/i);
    if (m) return '[Bash ' + m[1].trim() + ']\\n' + (rest || '') + '\\n[end]';
    m = first.match(/^Read\\s+(.+)$/i);
    if (m) return '[Read ' + m[1].trim() + ']\\n' + (rest || '') + '\\n[end]';
    m = first.match(/^Search(?:ed)?\\s+(.+)$/i);
    if (m) return '[Search ' + m[1].trim() + ']\\n' + (rest || '') + '\\n[end]';
    if (/^Edited file/i.test(first)) {
      var target = lines.find(function(line) {
        var t = String(line || '').trim();
        return t && t !== first && /[A-Za-z0-9_./\\\\-]+\\.[A-Za-z0-9]+/.test(t);
      }) || 'file';
      return '[Edit ' + target.trim() + ']\\n' + (rest || '') + '\\n[end]';
    }
    // "Shell" header — Codex Desktop uses this for running/completed commands
    if (/^Shell$/i.test(first)) {
      // Look for a $ command line in the body
      var cmdLine = lines.find(function(line) { return /^\\$\\s+/.test(line.trim()); });
      if (cmdLine) {
        var cmd = cmdLine.trim().replace(/^\\$\\s+/, '').trim();
        var cmdIdx = lines.indexOf(cmdLine);
        var cmdBody = squashNewlines(lines.slice(cmdIdx + 1).join('\\n'));
        return '[Bash ' + cmd + ']\\n' + (cmdBody || '') + '\\n[end]';
      }
      return '[Bash shell]\\n' + (rest || '') + '\\n[end]';
    }
    // Bare "$ command" line — direct shell command
    if (/^\\$\\s+/.test(first)) {
      var cmd = first.replace(/^\\$\\s+/, '').trim();
      return '[Bash ' + cmd + ']\\n' + (rest || '') + '\\n[end]';
    }
    // "Running command for Ns" status
    if (/^Running command/i.test(first)) {
      return '[Bash ' + first + ']\\n' + (rest || '') + '\\n[end]';
    }
    return text;
  }

  function extractUnitText(unit, role) {
    if (!unit) return '';
    var root = stripControls(unit);
    var markdownHost = root.querySelector('._markdownContent_tcy7y_41, [class*="_markdownContent"], [class*="markdownContent"]') || root;
    var text = squashNewlines(nodeToMarkdown(markdownHost, 0, role));
    if (!text) text = cleanText(root.innerText || root.textContent || '', role);
    if (role === 'tool') text = toolify(text);
    return cleanText(text, role === 'tool' ? 'assistant' : role);
  }

  function parseCollapsedToolActivity(block) {
    if (!block) return [];
    if (block.querySelector && block.querySelector('[class*="group/command"]')) return [];
    var text = cleanText(block.innerText || block.textContent || '', 'assistant');
    if (!text) return [];
    var lines = text.split('\\n').map(function(line) { return String(line || '').trim(); }).filter(Boolean);
    if (lines.length === 0) return [];
    function toolBlock(name, body) {
      var safeBody = typeof body === 'string' ? body.trim() : '';
      return '[' + name + ']\\n' + (safeBody ? safeBody + '\\n' : '') + '[end]';
    }
    var summary = lines[0];
    var bodyText = squashNewlines(lines.slice(1).join('\\n'));
    if (/^Ran(?:\\s+\\d+\\s+commands?)?$/i.test(summary)) {
      return [toolBlock('Bash ' + summary.replace(/^Ran\\s*/i, '').trim(), bodyText)];
    }
    if (/^Edited(?:\\s+\\d+\\s+files?)?(?:,\\s*ran\\s+\\d+\\s+commands?)?$/i.test(summary)) {
      return [toolBlock('Edit ' + summary.replace(/^Edited\\s*/i, '').trim(), bodyText)];
    }
    for (var i = 0; i < lines.length; i++) {
      var ranMatch = lines[i].match(/^Ran\\s+(.+)$/i);
      if (ranMatch) {
        var remaining = lines.slice(i + 1).join('\\n');
        return [toolBlock('Bash ' + ranMatch[1].trim(), remaining)];
      }
      if (/^Edited$/i.test(lines[i])) {
        var file = lines[i + 1] || 'file';
        var editBody = lines.slice(i + 1).join('\\n');
        return [toolBlock('Edit ' + file, editBody)];
      }
    }
    return [];
  }

  function parseVisibleCommandBlock(block) {
    if (!block) return '';
    var text = cleanText(block.innerText || block.textContent || '', 'assistant');
    if (!text) return '';
    var lines = text.split('\\n').map(function(line) { return String(line || '').trim(); });
    var commandLine = lines.find(function(line) { return /^\\$\\s+/.test(line); }) || '';
    var bodyStart = commandLine ? lines.indexOf(commandLine) + 1 : 0;
    var body = squashNewlines(lines.slice(bodyStart).join('\\n'));
    if (commandLine) {
      return '[Bash ' + commandLine.replace(/^\\$\\s+/, '').trim() + ']\\n' + (body ? body + '\\n' : '') + '[end]';
    }
    var first = lines.find(function(line) { return !!line; }) || '';
    if (/^Ran\\s+/i.test(first)) {
      return '[Bash ' + first.replace(/^Ran\\s+/i, '').trim() + ']\\n[end]';
    }
    return '';
  }

  var convo = d.querySelector('[data-thread-find-target="conversation"]');
  if (!convo) return JSON.stringify([]);

  var turns = Array.from(convo.querySelectorAll('[data-content-search-turn-key]'));
  var msgs = [];

  for (var ti = 0; ti < turns.length; ti++) {
    var turn = turns[ti];
    var userParts = [];
    var assistantParts = [];
    var units = Array.from(turn.querySelectorAll('[data-content-search-unit-key]'));

    for (var ui = 0; ui < units.length; ui++) {
      var unit = units[ui];
      var role = roleFromUnit(unit);
      if (!role) continue;

      var text = extractUnitText(unit, role);
      if (!text) continue;

      if (role === 'user') {
        uniquePush(userParts, text);
      } else if (role === 'assistant' || role === 'tool') {
        uniquePush(assistantParts, text);
      }
    }

    // Shell boxes: Codex Desktop renders running commands inside a rounded-lg
    // container with a "Shell" header and a nested group/command element.
    // These live OUTSIDE of data-content-search-unit-key elements, so the unit
    // loop above doesn't catch them.  Scan for group/command blocks that are
    // NOT inside a unit to capture Shell boxes without duplicating unit content.
    var commandBlocks = Array.from(turn.querySelectorAll('[class*="group/command"]'));
    for (var cbi = 0; cbi < commandBlocks.length; cbi++) {
      if (commandBlocks[cbi].closest('[data-content-search-unit-key]')) continue;
      var parsedCommand = parseVisibleCommandBlock(commandBlocks[cbi]);
      if (parsedCommand) uniquePushAny(assistantParts, parsedCommand);
    }

    if (userParts.length > 0) {
      msgs.push({ role: 'user', content: userParts.join('\\n\\n') });
    }
    if (assistantParts.length > 0) {
      msgs.push({ role: 'assistant', content: assistantParts.join('\\n\\n') });
    }
  }

  return JSON.stringify(msgs);
`;

async function readCodexMessages(Runtime, sessionId, usePageEval) {
  // Keep background polling read-only.
  // Expanding/collapsing Codex disclosure rows during every poll causes visible
  // UI thrash in the desktop app, so we only read what is already rendered.
  try {
    const raw = usePageEval
      ? await evalInPage(Runtime, CODEX_DESKTOP_READ_EXPR)
      : await evalInFrame(Runtime, CODEX_READ_EXPR);
    if (raw !== null) { resetReadFailures(sessionId); return raw; }
  } catch (e) {
    console.warn(`[${sessionId}] [sel] Codex read error: ${e.message}`);
  }

  const f = recordReadFailure(sessionId);
  if (f.readFails === 1 || f.readFails % 5 === 0) {
    console.warn(`[${sessionId}] [sel] Codex read null x${f.readFails}`);
    await captureDiagnostic(Runtime, sessionId);
  }
  return null;
}

// Gemini Code Assist message reader
// Uses the stable Angular component selectors discovered from app_bundle.js:
//   chat-history-item.user     → user turn
//   chat-history-item.system   → system/error (skip)
//   chat-history-item (other)  → Gemini assistant turn
//   .history-item-text         → rendered markdown content
const GEMINI_READ_EXPR = `
  var bt = String.fromCharCode(96);
  var fence = bt + bt + bt;

  var BLOCK_TAGS = { DIV:1, P:1, LI:1, TR:1, H1:1, H2:1, H3:1, H4:1, H5:1, H6:1, BLOCKQUOTE:1, SECTION:1 };

  function nodeToText(node) {
    if (!node) return '';
    if (node.nodeType === 3) return node.textContent;
    if (node.nodeType !== 1) return '';
    var tag = node.nodeName.toUpperCase();
    if (tag === 'BR') return '\\n';
    if (tag === 'PRE') {
      var codeEl = node.querySelector('code');
      var cls = codeEl ? (codeEl.className || '') : '';
      var lang = (cls.match(/language-(\\w+)/) || [])[1] || '';
      var preText = ((codeEl || node).innerText || (codeEl || node).textContent || '').trim();
      return '\\n' + fence + lang + '\\n' + preText + '\\n' + fence + '\\n';
    }
    if (tag === 'CODE') return bt + node.textContent + bt;
    if (tag === 'BUTTON' || tag === 'MAT-ICON') return '';
    var inner = Array.from(node.childNodes).map(nodeToText).join('');
    if (BLOCK_TAGS[tag] && inner.trim()) {
      return inner.endsWith('\\n') ? inner : inner + '\\n';
    }
    return inner;
  }

  var items = Array.from(d.querySelectorAll('chat-history-item'));
  if (items.length === 0) return JSON.stringify([]);

  var msgs = [];
  for (var i = 0; i < items.length; i++) {
    var el = items[i];
    var isUser   = el.classList.contains('user');
    // Note: Gemini AI responses use the 'system' CSS class — do NOT skip them.

    // Primary: .history-item-text; fallback: full element (nodeToText already strips buttons/icons)
    var textEl = el.querySelector('.history-item-text') || el;

    var content = nodeToText(textEl).replace(/\\n{3,}/g, '\\n\\n').trim();
    if (!content || content.length < 2) continue;
    msgs.push({ role: isUser ? 'user' : 'assistant', content: content });
  }
  return JSON.stringify(msgs);
`;

async function readGeminiMessages(Runtime, sessionId) {
  // Strategy 1: targeted selectors from app_bundle.js analysis
  try {
    const raw = await evalInFrame(Runtime, GEMINI_READ_EXPR);
    if (raw !== null) { resetReadFailures(sessionId); return raw; }
  } catch (e) {
    console.warn(`[${sessionId}] [sel] Gemini read error: ${e.message}`);
  }

  const f = recordReadFailure(sessionId);
  if (f.readFails === 1 || f.readFails % 5 === 0) {
    console.warn(`[${sessionId}] [sel] Gemini read null x${f.readFails}`);
    await captureDiagnostic(Runtime, sessionId);
  }
  return JSON.stringify([]);
}

// ─── Continue (Continue.continue extension) ──────────────────────────────────
//
// DOM structure (confirmed via live CDP probe):
//   Scroll container: .overflow-y-scroll.no-scrollbar.flex-1
//   Children are alternating user/assistant turns:
//     User turn:      contains [data-testid^="continue-input-box-"] (NOT main)
//       └─ .tiptap editor with user text
//     Assistant turn:  contains .thread-message
//       └─ .sc-eDPEul markdown body with rendered response
//   Main input: [data-testid="editor-input-main"] (TipTap/ProseMirror)
//   Submit button: last [data-testid="submit-input-button"]
//   Model button: [data-testid="model-select-button"]
//   Mode button: [data-testid="mode-select-button"]

const CONTINUE_READ_EXPR = `
  var bt = String.fromCharCode(96);
  var fence = bt + bt + bt;

  function cleanText(text) {
    return String(text || '').replace(/\\n{3,}/g, '\\n\\n').trim();
  }

  function nodeToText(node) {
    if (!node) return '';
    if (node.nodeType === 3) return node.textContent;
    if (node.nodeType !== 1) return '';
    var tag = node.nodeName.toUpperCase();
    if (tag === 'BR') return '\\n';
    if (tag === 'PRE') {
      var codeEl = node.querySelector('code');
      var cls = codeEl ? (codeEl.className || '') : '';
      var lang = (cls.match(/language-(\\w+)/) || [])[1] || '';
      var preText = ((codeEl || node).innerText || (codeEl || node).textContent || '').trim();
      return '\\n' + fence + lang + '\\n' + preText + '\\n' + fence + '\\n';
    }
    if (tag === 'CODE') return bt + node.textContent + bt;
    if (tag === 'BUTTON' || tag === 'SVG' || tag === 'STYLE') return '';
    var inner = Array.from(node.childNodes).map(nodeToText).join('');
    var BLOCK = { DIV:1, P:1, LI:1, TR:1, H1:1, H2:1, H3:1, H4:1, H5:1, H6:1, BLOCKQUOTE:1, SECTION:1 };
    if (BLOCK[tag] && inner.trim()) {
      return inner.endsWith('\\n') ? inner : inner + '\\n';
    }
    return inner;
  }

  function collectContinueToolBlocks(child) {
    var blocks = [];
    var seen = [];

    function addBlock(el) {
      if (!el) return;
      if (seen.indexOf(el) !== -1) return;
      seen.push(el);

      var content = cleanText(nodeToText(el) || el.textContent || '');
      if (!content) return;

      // Keep real block content, but strip UI-only chrome lines that add noise.
      content = content
        .replace(/^(Expand all|Collapse all|Collapse|Relocate|Cancel|Always run|Never run)$/gmi, '')
        .replace(/\\n{3,}/g, '\\n\\n')
        .trim();
      if (!content) return;

      blocks.push(content);
    }

    Array.from(child.querySelectorAll('[data-testid="terminal-container"]')).forEach(addBlock);
    Array.from(child.querySelectorAll('[data-testid="tool-call-title"]')).forEach(addBlock);
    Array.from(child.querySelectorAll('[data-testid="performing-actions"]')).forEach(addBlock);
    Array.from(child.querySelectorAll('[data-testid="context-items-peek"]')).forEach(addBlock);

    if (blocks.length === 0) {
      Array.from(child.querySelectorAll('.py-1')).forEach(addBlock);
    }

    var unique = [];
    for (var i = 0; i < blocks.length; i++) {
      if (unique.indexOf(blocks[i]) === -1) unique.push(blocks[i]);
    }
    return unique;
  }

  var scrollContainer = d.querySelector('${CONTINUE_PRIMARY.scrollContainer}');
  if (!scrollContainer) {
    scrollContainer = Array.from(d.querySelectorAll('main div')).find(function(el) {
      var cls = el.className || '';
      return (cls.indexOf('overflow-y-auto') !== -1 || cls.indexOf('overflow-y-scroll') !== -1)
        && cls.indexOf('flex-1') !== -1
        && cls.indexOf('pt-[8px]') !== -1;
    }) || Array.from(d.querySelectorAll('main div')).find(function(el) {
      var cls = el.className || '';
      return (cls.indexOf('overflow-y-auto') !== -1 || cls.indexOf('overflow-y-scroll') !== -1)
        && cls.indexOf('flex-1') !== -1
        && (el.querySelector('${CONTINUE_PRIMARY.threadMsg}') || el.querySelector('.sc-eDPEul.keZkes'));
    });
  }
  if (!scrollContainer) return JSON.stringify([]);

  var msgs = [];
  var children = Array.from(scrollContainer.children);

  for (var i = 0; i < children.length; i++) {
    var child = children[i];

    // Newer Continue YOLO builds render user turns as markdown blocks rather
    // than mirrored readonly TipTap inputs.
    var userMarkdown = child.querySelector('.sc-eDPEul.keZkes');
    if (userMarkdown) {
      var userText = cleanText(nodeToText(userMarkdown) || userMarkdown.textContent || '');
      if (userText) {
        msgs.push({ role: 'user', content: userText });
      }
      continue;
    }

    // Older Continue builds render user turns as non-main input boxes.
    var inputBox = child.querySelector('[data-testid^="continue-input-box-"]');
    if (inputBox && !inputBox.getAttribute('data-testid').includes('main')) {
      var editor = inputBox.querySelector('.tiptap');
      var text = editor ? (editor.textContent || '').trim() : '';
      if (text) {
        msgs.push({ role: 'user', content: text });
      }
      continue;
    }

    // Assistant turn: contains .thread-message
    var threadMsg = child.querySelector('${CONTINUE_PRIMARY.threadMsg}');
    if (threadMsg) {
      var markdown = threadMsg.querySelector('${CONTINUE_PRIMARY.markdownBody}');
      var text = markdown ? cleanText(nodeToText(markdown) || markdown.textContent || '') : '';
      var toolBlocks = collectContinueToolBlocks(child);
      var toolText = toolBlocks.join('\\n\\n');

      if (text && toolText) {
        text = toolText + '\\n\\n' + text;
      } else if (!text && toolText) {
        text = toolText;
      } else if (!text) {
        text = '[tool call]';
      }
      msgs.push({ role: 'assistant', content: text });
      continue;
    }
  }

  return JSON.stringify(msgs);
`;

async function readContinueMessages(Runtime, sessionId) {
  try {
    const raw = await evalInFrame(Runtime, CONTINUE_READ_EXPR);
    if (raw !== null) { resetReadFailures(sessionId); return raw; }
  } catch (e) {
    console.warn(`[${sessionId}] [sel] Continue read error: ${e.message}`);
  }

  const f = recordReadFailure(sessionId);
  if (f.readFails === 1 || f.readFails % 5 === 0) {
    console.warn(`[${sessionId}] [sel] Continue read null x${f.readFails}`);
    await captureDiagnostic(Runtime, sessionId);
  }
  return JSON.stringify([]);
}

async function readContinueMessagesFromWorkbench(Runtime, webviewId, sessionId) {
  try {
    const raw = await evalInWorkbenchWebview(Runtime, webviewId, CONTINUE_READ_EXPR);
    if (raw !== null) { resetReadFailures(sessionId); return raw; }
  } catch (e) {
    console.warn(`[${sessionId}] [sel] Continue workbench read error: ${e.message}`);
  }

  const f = recordReadFailure(sessionId);
  if (f.readFails === 1 || f.readFails % 5 === 0) {
    console.warn(`[${sessionId}] [sel] Continue workbench read null x${f.readFails}`);
  }
  return JSON.stringify([]);
}

async function detectContinueThinking(Runtime) {
  try {
    const raw = await evalInFrame(Runtime, `
      function norm(text) {
        return String(text || '').replace(/\\s+/g, ' ').trim();
      }
      function isVisible(el) {
        if (!el || !el.getBoundingClientRect) return false;
        var rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        var style = window.getComputedStyle ? window.getComputedStyle(el) : null;
        if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) return false;
        return true;
      }
      function detectStreamingToolbar() {
        var candidates = Array.from(d.querySelectorAll('div, span')).filter(function(el) {
          if (!isVisible(el)) return false;
          var txt = norm(el.textContent);
          return txt === 'Generating' || txt === 'Applying';
        });
        for (var i = 0; i < candidates.length; i++) {
          var indicator = candidates[i];
          var root = indicator.closest('.flex.w-full.items-center.justify-between') || indicator.parentElement;
          while (root && root !== d.body) {
            if (!isVisible(root)) { root = root.parentElement; continue; }
            var rootText = norm(root.textContent).toLowerCase();
            if ((rootText.includes('generating') || rootText.includes('applying')) &&
                (rootText.includes('stop') || rootText.includes('cancel') || rootText.includes('⌫'))) {
              if (rootText.includes('applying')) return 'Applying';
              if (rootText.includes('stop terminal')) return 'Stop Terminal';
              return 'Generating';
            }
            root = root.parentElement;
          }
        }
        return '';
      }

      var toolbarLabel = detectStreamingToolbar();
      if (toolbarLabel) {
        return JSON.stringify({ thinking: true, label: toolbarLabel });
      }

      // Continue/Continue YOLO can also expose generation through a stop-style
      // submit button. Keep that as a fallback.
      var submitBtns = d.querySelectorAll('[data-testid="submit-input-button"]');
      var lastSubmit = submitBtns[submitBtns.length - 1];
      if (!lastSubmit) return JSON.stringify({ thinking: false, label: '' });

      var btnBits = [
        lastSubmit.innerText || '',
        lastSubmit.textContent || '',
        lastSubmit.getAttribute('aria-label') || '',
        lastSubmit.getAttribute('title') || '',
        lastSubmit.getAttribute('data-state') || ''
      ].join(' ').toLowerCase();
      var hasStopLabel = /\\b(stop|cancel|generating|running)\\b/.test(btnBits);
      var svgPaths = lastSubmit.querySelectorAll('svg path');
      var hasStopIcon = false;
      for (var i = 0; i < svgPaths.length; i++) {
        var pathD = svgPaths[i].getAttribute('d') || '';
        if (pathD.includes('M6') && pathD.includes('18') && !pathD.includes('M12')) {
          hasStopIcon = true;
          break;
        }
      }

      var spinners = d.querySelectorAll(
        '[class*=animate-spin], [class*=loading], [class*=spinner], [role="status"], [aria-busy="true"]'
      );
      var hasSpinner = false;
      for (var i = 0; i < spinners.length; i++) {
        if (spinners[i].offsetParent !== null) { hasSpinner = true; break; }
      }

      // A disabled Enter button by itself just means the composer is empty.
      // Treat only explicit stop/running affordances as "Generating".
      var thinking = hasStopLabel || hasStopIcon || hasSpinner;
      return JSON.stringify({ thinking: thinking, label: thinking ? 'Generating' : '' });
    `);
    try { return JSON.parse(raw); } catch { return { thinking: false, label: '' }; }
  } catch {
    return { thinking: false, label: '' };
  }
}

async function detectContinueThinkingFromWorkbench(Runtime, webviewId) {
  try {
    const raw = await evalInWorkbenchWebview(Runtime, webviewId, `
      function norm(text) {
        return String(text || '').replace(/\\s+/g, ' ').trim();
      }
      function isVisible(el) {
        if (!el || !el.getBoundingClientRect) return false;
        var rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        var style = window.getComputedStyle ? window.getComputedStyle(el) : null;
        if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) return false;
        return true;
      }
      function detectStreamingToolbar() {
        var candidates = Array.from(d.querySelectorAll('div, span')).filter(function(el) {
          if (!isVisible(el)) return false;
          var txt = norm(el.textContent);
          return txt === 'Generating' || txt === 'Applying';
        });
        for (var i = 0; i < candidates.length; i++) {
          var indicator = candidates[i];
          var root = indicator.closest('.flex.w-full.items-center.justify-between') || indicator.parentElement;
          while (root && root !== d.body) {
            if (!isVisible(root)) { root = root.parentElement; continue; }
            var rootText = norm(root.textContent).toLowerCase();
            if ((rootText.includes('generating') || rootText.includes('applying')) &&
                (rootText.includes('stop') || rootText.includes('cancel') || rootText.includes('⌫'))) {
              if (rootText.includes('applying')) return 'Applying';
              if (rootText.includes('stop terminal')) return 'Stop Terminal';
              return 'Generating';
            }
            root = root.parentElement;
          }
        }
        return '';
      }

      var toolbarLabel = detectStreamingToolbar();
      if (toolbarLabel) {
        return JSON.stringify({ thinking: true, label: toolbarLabel });
      }

      var submitBtns = d.querySelectorAll('[data-testid="submit-input-button"]');
      var lastSubmit = submitBtns[submitBtns.length - 1];
      if (!lastSubmit) return JSON.stringify({ thinking: false, label: '' });

      var btnBits = [
        lastSubmit.innerText || '',
        lastSubmit.textContent || '',
        lastSubmit.getAttribute('aria-label') || '',
        lastSubmit.getAttribute('title') || '',
        lastSubmit.getAttribute('data-state') || ''
      ].join(' ').toLowerCase();
      var hasStopLabel = /\\b(stop|cancel|generating|running)\\b/.test(btnBits);
      var svgPaths = lastSubmit.querySelectorAll('svg path');
      var hasStopIcon = false;
      for (var i = 0; i < svgPaths.length; i++) {
        var pathD = svgPaths[i].getAttribute('d') || '';
        if (pathD.includes('M6') && pathD.includes('18') && !pathD.includes('M12')) {
          hasStopIcon = true;
          break;
        }
      }

      var spinners = d.querySelectorAll(
        '[class*=animate-spin], [class*=loading], [class*=spinner], [role="status"], [aria-busy="true"]'
      );
      var hasSpinner = false;
      for (var i = 0; i < spinners.length; i++) {
        if (spinners[i].offsetParent !== null) { hasSpinner = true; break; }
      }

      // A disabled Enter button by itself just means the composer is empty.
      // Treat only explicit stop/running affordances as "Generating".
      var thinking = hasStopLabel || hasStopIcon || hasSpinner;
      return JSON.stringify({ thinking: thinking, label: thinking ? 'Generating' : '' });
    `);
    try { return JSON.parse(raw); } catch { return { thinking: false, label: '' }; }
  } catch {
    return { thinking: false, label: '' };
  }
}

async function detectContinuePermissionDialogFromWorkbench(Runtime, webviewId) {
  try {
    const raw = await evalInWorkbenchWebview(Runtime, webviewId, `
      var allAccept = d.querySelectorAll('[data-testid^="accept-tool-call-button-"]');
      var acceptBtn = null;
      for (var i = allAccept.length - 1; i >= 0; i--) {
        if (allAccept[i].offsetParent !== null) { acceptBtn = allAccept[i]; break; }
      }
      if (!acceptBtn) return null;
      var callId = acceptBtn.getAttribute('data-testid').replace('accept-tool-call-button-', '');
      var rejectBtn = d.querySelector('[data-testid="reject-tool-call-button-' + callId + '"]');
      var allTitles = d.querySelectorAll('[data-testid="tool-call-title"]');
      var titleEl = allTitles.length > 0 ? allTitles[allTitles.length - 1] : null;
      var message = titleEl ? (titleEl.textContent || '').trim() : 'Tool call pending';
      return JSON.stringify({
        message: message,
        choices: [
          { choice_id: acceptBtn.getAttribute('data-testid'), label: 'Accept' },
          { choice_id: rejectBtn ? rejectBtn.getAttribute('data-testid') : 'reject-tool-call-button-' + callId, label: 'Reject' },
        ],
      });
    `);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function sendContinuePrimary(Runtime, text) {
  // Set text in the main TipTap editor via execCommand
  console.log(`[continue-focus] send primary:start chars=${(text || '').length}`);
  const set = await evalInFrame(Runtime, `
    var input = d.querySelector('${CONTINUE_PRIMARY.input}');
    if (!input) return 'no-input';
    function escapeHtml(value) {
      return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }
    function selectInput(target, collapseToEnd) {
      var sel = (d.getSelection && d.getSelection()) || (window.getSelection && window.getSelection());
      if (!sel || !d.createRange) return false;
      var range = d.createRange();
      range.selectNodeContents(target);
      range.collapse(!!collapseToEnd);
      sel.removeAllRanges();
      sel.addRange(range);
      return true;
    }
    function paragraphHtml(value) {
      return String(value || '')
        .split(/\\r?\\n/)
        .map(function(line) {
          return '<p>' + (line ? escapeHtml(line) : '<br>') + '</p>';
        })
        .join('');
    }
    input.focus();
    // TipTap/ProseMirror requires a live selection inside the editor before
    // insertText works reliably in current Continue YOLO builds.
    selectInput(input, false);
    d.execCommand('delete', false, null);
    if ((input.textContent || '').trim()) {
      input.innerHTML = '<p><br></p>';
    }
    selectInput(input, true);
    var ok = d.execCommand('insertText', false, ${JSON.stringify(text)});
    if (!ok || !(input.textContent || '').trim()) {
      // Fallback: write the paragraphs directly, then emit input events so
      // the editor state catches up even when execCommand is blocked.
      input.innerHTML = paragraphHtml(${JSON.stringify(text)});
      selectInput(input, true);
      try {
        input.dispatchEvent(new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: ${JSON.stringify(text)}
        }));
      } catch {}
      try {
        input.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          inputType: 'insertText',
          data: ${JSON.stringify(text)}
        }));
      } catch {
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
    return (input.textContent || '').trim() ? 'ok' : 'empty';
  `);
  if (set !== 'ok') return { ok: false, code: 'input_not_found', detail: set };

  // Wait for TipTap to process the input
  await new Promise(r => setTimeout(r, 200));

  // Click the last submit button (the main one)
  console.log('[continue-focus] send primary:click-submit');
  const click = await evalInFrame(Runtime, `
    var btns = d.querySelectorAll('${CONTINUE_PRIMARY.sendBtn}');
    if (!btns.length) {
      // Fallback: get all submit-input-buttons and pick the last
      btns = d.querySelectorAll('[data-testid="submit-input-button"]');
    }
    var btn = btns[btns.length - 1];
    if (!btn) return 'no-btn';
    if (btn.disabled) return 'disabled';
    btn.click();
    return 'sent';
  `);
  if (click === 'sent') return { ok: true };
  return { ok: false, code: 'send_button_failed', detail: click };
}

async function sendContinueFallback(Runtime, text) {
  // Fallback: try broader selectors and Enter key dispatch
  console.log(`[continue-focus] send fallback:start chars=${(text || '').length}`);
  const result = await evalInFrame(Runtime, `
    var input = d.querySelector('${CONTINUE_FALLBACK.input}');
    if (!input) return 'no-input';
    function escapeHtml(value) {
      return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }
    function selectInput(target, collapseToEnd) {
      var sel = (d.getSelection && d.getSelection()) || (window.getSelection && window.getSelection());
      if (!sel || !d.createRange) return false;
      var range = d.createRange();
      range.selectNodeContents(target);
      range.collapse(!!collapseToEnd);
      sel.removeAllRanges();
      sel.addRange(range);
      return true;
    }
    input.focus();
    selectInput(input, false);
    d.execCommand('delete', false, null);
    selectInput(input, true);
    var ok = d.execCommand('insertText', false, ${JSON.stringify(text)});
    if (!ok || !(input.textContent || '').trim()) {
      input.innerHTML = String(${JSON.stringify(text)}).split(/\\r?\\n/).map(function(line) {
        return '<p>' + (line ? escapeHtml(line) : '<br>') + '</p>';
      }).join('');
      selectInput(input, true);
      try {
        input.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          inputType: 'insertText',
          data: ${JSON.stringify(text)}
        }));
      } catch {
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
    // Try click first
    var btn = d.querySelector('${CONTINUE_FALLBACK.sendBtn}');
    if (btn && !btn.disabled) {
      btn.click();
      return 'sent-btn';
    }
    // Fallback: Enter key
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
    input.dispatchEvent(new KeyboardEvent('keyup',   { key: 'Enter', code: 'Enter', bubbles: true }));
    return 'dispatched';
  `);
  if (result === 'sent-btn' || result === 'dispatched') return { ok: true };
  return { ok: false, code: 'fallback_enter_failed', detail: result };
}

async function readContinueConfig(Runtime) {
  try {
    const raw = await evalInFrame(Runtime, `
      var modelBtn = d.querySelector('${CONTINUE_PRIMARY.modelBtn}');
      var modeBtn = d.querySelector('${CONTINUE_PRIMARY.modeBtn}');
      return JSON.stringify({
        model: modelBtn ? (modelBtn.textContent || '').trim() : null,
        mode: modeBtn ? (modeBtn.textContent || '').trim() : null,
      });
    `);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

// ─── Roo Code helpers ─────────────────────────────────────────────────────────
// Selectors confirmed via live CDP DOM inspection (2026-04-26).
//
// Message list: [data-testid="virtuoso-item-list"] > div (virtualized rows)
// Each row text starts with a prefix indicating the role:
//   "You said"          → user
//   "Roo said"          → assistant
//   "Roo wants"         → assistant (tool intent)
//   "Roo wants to edit" → assistant (file edit)
//   "Roo wants to read" → assistant (file read)
//   "API Request"       → assistant (tool call)
//   "Checkpoint"        → assistant (checkpoint)
//   "Running(PID:...)"  → assistant (command execution)
//   "Updated the to-do list" → assistant (status)

const ROO_CODE_READ_EXPR = `
  function norm(text) {
    return String(text || '').replace(/\\s+/g, ' ').trim();
  }
  function cleanText(text) {
    return norm(text).replace(/\\u200B/g, '').replace(/\\u00A0/g, ' ');
  }

  var msgs = [];
  var virtuoso = d.querySelector('${ROO_CODE_PRIMARY.virtuoso}');
  var items = virtuoso ? Array.from(virtuoso.children) : [];

  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    var rawText = cleanText(item.innerText || item.textContent || '');
    if (!rawText) continue;

    // Determine role from text prefix
    var role = null;
    var content = rawText;

    if (rawText.indexOf('You said') === 0) {
      role = 'user';
      content = rawText.substring('You said'.length).trim();
    } else if (rawText.indexOf('Roo said') === 0) {
      role = 'assistant';
      content = rawText.substring('Roo said'.length).trim();
    } else if (rawText.indexOf('Roo wants') === 0) {
      role = 'assistant';
      // Keep full text including "Roo wants" for context
    } else if (rawText.indexOf('API Request') === 0) {
      role = 'assistant';
      // Keep full text
    } else if (rawText.indexOf('Checkpoint') === 0) {
      role = 'assistant';
      // Keep full text
    } else if (/^Running\\(PID:/.test(rawText)) {
      role = 'assistant';
      // Keep full text
    } else if (rawText.indexOf('Updated the to-do list') === 0) {
      role = 'assistant';
      // Keep full text
    }

    if (!role) continue;

    // Skip duplicate consecutive messages with same content
    var last = msgs[msgs.length - 1];
    if (last && last.role === role && last.content === content) continue;

    msgs.push({ role: role, content: content });
  }

  return JSON.stringify(msgs);
`;

async function evalInRooCodeFrame(Runtime, code) {
  const result = await Runtime.evaluate({
    expression: `(function() {
      const active = document.getElementById('active-frame');
      const d = active && active.contentDocument ? active.contentDocument : document;
      if (!d) return null;
      ${code}
    })()`,
    returnByValue: true,
    awaitPromise: false,
    silent: true,
    userGesture: false,
  });
  if (result.exceptionDetails) {
    const desc = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
    throw new Error(`JS exception: ${desc}`);
  }
  return result.result?.value ?? null;
}

async function readRooCodeMessages(Runtime, sessionId) {
  try {
    const raw = await evalInRooCodeFrame(Runtime, ROO_CODE_READ_EXPR);
    if (raw !== null) { resetReadFailures(sessionId); return raw; }
  } catch (e) {
    console.warn(`[${sessionId}] [sel] Roo Code read error: ${e.message}`);
  }

  const f = recordReadFailure(sessionId);
  if (f.readFails === 1 || f.readFails % 5 === 0) {
    console.warn(`[${sessionId}] [sel] Roo Code read null x${f.readFails}`);
    await captureDiagnostic(Runtime, sessionId);
  }
  return JSON.stringify([]);
}

async function detectRooCodeThinking(Runtime) {
  try {
    const raw = await evalInRooCodeFrame(Runtime, `
      function isVisible(el) {
        if (!el || !el.getBoundingClientRect) return false;
        var rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        var style = window.getComputedStyle ? window.getComputedStyle(el) : null;
        if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) return false;
        return true;
      }
      // Check for explicit stop button (visible while generating)
      var stopBtn = d.querySelector('${ROO_CODE_PRIMARY.stopBtn}');
      if (stopBtn && isVisible(stopBtn)) {
        return JSON.stringify({ thinking: true, label: 'Generating' });
      }
      // Fallback: any button with aria-label containing "Stop"
      var allBtns = d.querySelectorAll('button');
      for (var i = 0; i < allBtns.length; i++) {
        var aria = (allBtns[i].getAttribute('aria-label') || '').toLowerCase();
        if (aria.indexOf('stop') !== -1 && isVisible(allBtns[i])) {
          return JSON.stringify({ thinking: true, label: 'Generating' });
        }
      }
      return JSON.stringify({ thinking: false, label: '' });
    `);
    try { return JSON.parse(raw); } catch { return { thinking: false, label: '' }; }
  } catch {
    return { thinking: false, label: '' };
  }
}

async function sendRooCodePrimary(Runtime, text) {
  const set = await evalInRooCodeFrame(Runtime, `
    var input = d.querySelector('${ROO_CODE_PRIMARY.input}');
    if (!input) return 'no-input';
    input.focus();
    input.value = ${JSON.stringify(text)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    // Also dispatch a change event for React form bindings
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return input.value === ${JSON.stringify(text)} ? 'ok' : 'empty';
  `);
  if (set !== 'ok') return { ok: false, code: 'input_not_found', detail: set };

  await new Promise(r => setTimeout(r, 200));

  const click = await evalInRooCodeFrame(Runtime, `
    var btn = d.querySelector('${ROO_CODE_PRIMARY.sendBtn}');
    if (!btn) return 'no-btn';
    if (btn.disabled) return 'disabled';
    btn.click();
    return 'sent';
  `);
  if (click === 'sent') return { ok: true };
  return { ok: false, code: 'send_button_failed', detail: click };
}

async function sendRooCodeFallback(Runtime, text) {
  const result = await evalInRooCodeFrame(Runtime, `
    var input = d.querySelector('${ROO_CODE_FALLBACK.input}');
    if (!input) return 'no-input';
    input.focus();
    input.value = ${JSON.stringify(text)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    var btn = d.querySelector('${ROO_CODE_FALLBACK.sendBtn}');
    if (btn && !btn.disabled) {
      btn.click();
      return 'sent-btn';
    }
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
    input.dispatchEvent(new KeyboardEvent('keyup',   { key: 'Enter', code: 'Enter', bubbles: true }));
    return 'dispatched';
  `);
  if (result === 'sent-btn' || result === 'dispatched') return { ok: true };
  return { ok: false, code: 'fallback_enter_failed', detail: result };
}

async function readRooCodeConfig(Runtime) {
  try {
    const raw = await evalInRooCodeFrame(Runtime, `
      function norm(t) {
        return String(t || '').replace(/\\s+/g, ' ').trim();
      }
      function gatherText() {
        var root = d.body || d.documentElement;
        if (!root) return '';
        return norm(root.textContent || '');
      }
      var bodyText = gatherText();

      // Mode detection from body text
      var modeMatch = bodyText.match(/[🏗️💻🔍🐛]\\s*(Architect|Code|Ask|Debug)/i);
      var mode = modeMatch ? modeMatch[0] : 'unknown';

      // Model detection
      var modelMatch = bodyText.match(/(claude|gpt|gemini|o3|o4|sonnet|opus|haiku|deepseek|llama)[-\\s\\w]*/i);
      var model = modelMatch ? norm(modelMatch[0]) : 'unknown';

      // Auto-approve detection
      var autoApprove = /auto-approved?/i.test(bodyText) ? 'auto_approved' : 'unknown';

      // Version detection
      var versionMatch = bodyText.match(/v\\d+\\.\\d+\\.\\d+/);
      var version = versionMatch ? versionMatch[0] : 'unknown';

      return JSON.stringify({
        model_id: model,
        mode: mode,
        permission_mode: autoApprove,
        version: version,
      });
    `);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

async function setRooCodeModel(Runtime, modelId, sessionId) {
  // Placeholder — Roo Code model selection via DOM clicks will be added after live inspection
  console.warn(`[${sessionId}] [sel] setRooCodeModel not yet implemented (modelId=${modelId})`);
  return { ok: false, code: 'not_implemented', detail: 'Roo Code model selection requires live DOM inspection' };
}

async function setRooCodePermissionMode(Runtime, mode, sessionId) {
  // Placeholder — Roo Code permission mode selection via DOM clicks will be added after live inspection
  console.warn(`[${sessionId}] [sel] setRooCodePermissionMode not yet implemented (mode=${mode})`);
  return { ok: false, code: 'not_implemented', detail: 'Roo Code permission mode selection requires live DOM inspection' };
}

async function detectRooCodePermissionDialog(Runtime) {
  // Placeholder — Roo Code permission dialog detection will be added after live inspection
  return null;
}

// ─── Antigravity native agent (workbench-jetski-agent.html) ─────────────────
//
// Selectors confirmed via live CDP DOM inspection of the Manager page.
// The UI is a React/Tailwind app with NO active-frame iframe — evalInPage() only.
//
// DOM structure:
//   .relative.flex.flex-col.gap-y-3.px-4          ← conversation turn container
//     > div (no class, style=)                     ← one turn (may contain multiple items)
//       > div (no class)                           ← user OR assistant item
//         > div.flex.w-full.flex-row               ← USER indicator
//           > div.flex.min-w-0.grow.flex-col       ← user text
//         > div.flex.flex-col.space-y-2            ← ASSISTANT indicator
//           > div.flex.flex-row.my-2...            ← response rows; "Thought for Xs" rows skipped
//           > div.pt-3                             ← "Copy" button row (skip)

const ANTIGRAVITY_READ_EXPR = `
  var bt = String.fromCharCode(96);
  var fence = bt + bt + bt;

  var BLOCK_TAGS = { DIV:1, P:1, LI:1, TR:1, H1:1, H2:1, H3:1, H4:1, H5:1, H6:1, BLOCKQUOTE:1, SECTION:1 };

  function nodeToText(node) {
    if (!node) return '';
    if (node.nodeType === 3) return node.textContent;
    if (node.nodeType !== 1) return '';
    var tag = node.nodeName.toUpperCase();
    if (tag === 'BR') return '\\n';
    if (tag === 'PRE') {
      var codeEl = node.querySelector('code');
      var cls = codeEl ? (codeEl.className || '') : '';
      var lang = (cls.match(/language-(\\w+)/) || [])[1] || '';
      var preText = ((codeEl || node).innerText || (codeEl || node).textContent || '').trim();
      return '\\n' + fence + lang + '\\n' + preText + '\\n' + fence + '\\n';
    }
    if (tag === 'CODE') return bt + node.textContent + bt;
    if (tag === 'BUTTON' || tag === 'SVG' || tag === 'STYLE') return '';
    var inner = Array.from(node.childNodes).map(nodeToText).join('');
    if (BLOCK_TAGS[tag] && inner.trim()) {
      return inner.endsWith('\\n') ? inner : inner + '\\n';
    }
    return inner;
  }

  // Extract text from a tool-call / action block (isolate bordered container).
  function extractToolBlock(el) {
    var rawText = (el.innerText || '').trim();
    var cleanText = rawText.replace(/^(Expand all|Collapse all|Collapse|Relocate|Cancel|Always run|Never run)$/gmi, '').trim();
    cleanText = cleanText.replace(/\\n\\s*\\n\\s*\\n/g, '\\n\\n');
    return cleanText.length > 10000 ? cleanText.substring(0, 10000) + '\\n...[truncated]' : cleanText;
  }

  // Find the conversation turn container
  var turnContainer = null;
  var divs = Array.from(d.querySelectorAll('div'));
  for (var i = 0; i < divs.length; i++) {
    var cls = divs[i].className || '';
    if (cls.includes('gap-y-3') && cls.includes('px-4') && cls.includes('flex-col')) {
      turnContainer = divs[i]; break;
    }
  }
  if (!turnContainer) return JSON.stringify([]);

  var msgs = [];
  var turns = Array.from(turnContainer.children);

  for (var t = 0; t < turns.length; t++) {
    var turn = turns[t];
    var items = Array.from(turn.children);

    for (var j = 0; j < items.length; j++) {
      var item = items[j];

      // Skip hidden/transition-out items
      var itemCls = item.className || '';
      if (itemCls.includes('hidden') || itemCls.includes('opacity-0')) continue;

      var firstChild = item.children[0];
      if (!firstChild) continue;
      var fcCls = firstChild.className || '';

      // User message: first child has flex w-full flex-row
      if (fcCls.includes('w-full') && fcCls.includes('flex-row')) {
        var textEl = firstChild.querySelector('[class*="min-w-0"]') || firstChild;
        var text = textEl.innerText.trim();
        if (text) msgs.push({ role: 'user', content: text });

      // Assistant message: first child has flex-col space-y-2
      } else if (fcCls.includes('flex-col') && fcCls.includes('space-y-2')) {
        var parts = [];

        var gapContainers = Array.from(firstChild.querySelectorAll('[class*="gap-y-3"]'))
          .filter(function(el) {
            return el !== turnContainer && !el.contains(turnContainer);
          });

        if (gapContainers.length > 0) {
          for (var g = 0; g < gapContainers.length; g++) {
            var gKids = Array.from(gapContainers[g].children);
            for (var gk = 0; gk < gKids.length; gk++) {
              var kid = gKids[gk];
              var kidCls = kid.className || '';
              // Extract thinking/content from isolate containers instead of skipping them
              if (kidCls.includes('isolate')) {
                var isoText = nodeToText(kid).trim();
                if (isoText) parts.push(isoText);
                continue;
              }
              if (kidCls.includes('pt-3')) continue;
              var kidText = nodeToText(kid).trim();
              if (kidText) parts.push(kidText);
            }
          }
        }

        // Fallback: old layout where rows are direct children of space-y-2
        if (parts.length === 0) {
          var rows = Array.from(firstChild.children);
          for (var k = 0; k < rows.length; k++) {
            var row = rows[k];
            var rowText = nodeToText(row).trim();
            var rowInnerText = row.innerText ? row.innerText.trim() : rowText;
            if (/^Thought for \\d/.test(rowText) || /^Thought for \\d/.test(rowInnerText)) continue;
            if (rowText) parts.push(rowText);
          }
        }

        var content = parts.join('\\n').trim();
        if (content) msgs.push({ role: 'assistant', content: content });

      // Tool-call / action block: first child is isolate bordered container
      } else if (fcCls.includes('isolate') && fcCls.includes('border')) {
        var toolText = extractToolBlock(firstChild);
        if (toolText) {
          if (msgs.length > 0 && msgs[msgs.length - 1].role === 'assistant') {
            msgs[msgs.length - 1].content += '\\n' + toolText;
          } else {
            msgs.push({ role: 'assistant', content: toolText });
          }
        }

      // Status/waiting items
      } else if (itemCls.includes('opacity-50') || itemCls.includes('transition-opacity')) {
        var statusText = (item.innerText || '').trim();
        if (statusText && statusText.length < 100) {
          if (msgs.length > 0 && msgs[msgs.length - 1].role === 'assistant') {
            msgs[msgs.length - 1].content += '\\n[' + statusText + ']';
          } else {
            msgs.push({ role: 'assistant', content: '[' + statusText + ']' });
          }
        }

      // Permission prompt items (e.g. "Run command?", "Edit file?")
      } else {
        var innerText = (item.innerText || '').trim();
        if (/Run command\\??|Edit file\\??|Steps? Require Input|Run tool\\??/i.test(innerText)) {
          var promptParts = [];
          var headings = item.querySelectorAll('div, span, p');
          for (var hi = 0; hi < headings.length; hi++) {
            var ht = (headings[hi].innerText || '').trim();
            if (/^(Run command|Edit file|Run tool|\\d+ Steps? Require Input)/i.test(ht) && ht.length < 80) {
              promptParts.push(ht);
              break;
            }
          }
          var cmdEl = item.querySelector('pre, code, [class*="font-mono"], [class*="monospace"]');
          if (cmdEl) promptParts.push(cmdEl.textContent.trim().substring(0, 500));
          var itemBtns = Array.from(item.querySelectorAll('button'));
          var btnLabels = [];
          for (var ib = 0; ib < itemBtns.length; ib++) {
            var bl = (itemBtns[ib].textContent || '').trim();
            bl = bl.replace(/\\s*(Alt|Ctrl|Shift|Cmd|Meta)\\+\\S+$/i, '').trim();
            if (bl && bl.length < 30) btnLabels.push('[' + bl + ']');
          }
          if (btnLabels.length > 0) promptParts.push(btnLabels.join('  '));
          var itemSelects = Array.from(item.querySelectorAll('select'));
          for (var is2 = 0; is2 < itemSelects.length; is2++) {
            var selVal = itemSelects[is2].options[itemSelects[is2].selectedIndex];
            if (selVal) promptParts.push('[' + selVal.textContent.trim() + ' v]');
          }
          var promptText = promptParts.join('\\n').trim();
          if (promptText) {
            if (msgs.length > 0 && msgs[msgs.length - 1].role === 'assistant') {
              msgs[msgs.length - 1].content += '\\n' + promptText;
            } else {
              msgs.push({ role: 'assistant', content: promptText });
            }
          }
        }
      }
    }
  }
  return JSON.stringify(msgs);
`;

async function readAntigravityMessages(Runtime, sessionId) {
  try {
    const raw = await evalInPage(Runtime, ANTIGRAVITY_READ_EXPR);
    if (raw !== null) { resetReadFailures(sessionId); return raw; }
  } catch (e) {
    console.warn(`[${sessionId}] [sel] Antigravity read error: ${e.message}`);
  }
  const f = recordReadFailure(sessionId);
  if (f.readFails === 1 || f.readFails % 5 === 0) {
    console.warn(`[${sessionId}] [sel] Antigravity read null x${f.readFails}`);
  }
  return JSON.stringify([]);
}

// ─── Antigravity side-panel (workspace page embedded chat) ───────────────────
//
// The Antigravity built-in chat panel is rendered directly in the workbench.html
// page DOM inside .antigravity-agent-side-panel — NOT a separate CDP target.
// The React/Tailwind message structure is identical to the Manager page, so we
// reuse ANTIGRAVITY_READ_EXPR (which scans document divs and finds the same
// gap-y-3 px-4 flex-col turn container inside the panel).
//
// The panel exists in every workspace window, but only has content when a
// conversation is active. We check for this before creating a session.

// Returns true if the panel has a live conversation (has message turns).
const ANTIGRAVITY_PANEL_HAS_CONTENT_EXPR = `
  var panel = d.querySelector('.antigravity-agent-side-panel');
  if (!panel) return false;
  // Check for the turn container
  var divs = Array.from(panel.querySelectorAll('div'));
  for (var i = 0; i < divs.length; i++) {
    var cls = divs[i].className || '';
    if (cls.includes('gap-y-3') && cls.includes('px-4') && cls.includes('flex-col')) {
      return divs[i].children.length > 0;
    }
  }
  return false;
`;

// Returns the panel conversation title (shown in panel header).
const ANTIGRAVITY_PANEL_TITLE_EXPR = `
  var panel = d.querySelector('.antigravity-agent-side-panel');
  if (!panel) return null;
  // Header title is in the first .flex.min-w-0 descendant of the panel
  var titleEl = panel.querySelector('.flex.min-w-0');
  return titleEl ? (titleEl.innerText || '').trim() : null;
`;

const ANTIGRAVITY_PANEL_SUMMARY_EXPR = `
  var panel = d.querySelector('.antigravity-agent-side-panel');
  if (!panel) return null;

  function uniqPush(arr, value) {
    if (!value) return;
    if (!arr.includes(value)) arr.push(value);
  }

  var text = (panel.innerText || '').replace(/\\s+/g, ' ').trim();
  var titleEl = panel.querySelector('.flex.min-w-0');
  var title = titleEl ? (titleEl.innerText || '').trim() : null;
  var buttons = Array.from(panel.querySelectorAll('button, [role="button"]'));
  var labels = [];
  buttons.forEach(function(btn) {
    var raw = (btn.innerText || btn.textContent || btn.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim();
    if (!raw || raw.length > 120) return;
    uniqPush(labels, raw);
  });

  var mode = labels.find(function(label) { return /^(Planning|Fast)$/i.test(label); }) || null;
  var model = labels.find(function(label) { return /\\b(Claude|Opus|Sonnet|GPT|Gemini|Flash|Pro)\\b/i.test(label); }) || null;
  var paneAgent = null;
  if (/\\bAsk anything, @ to mention, \\/ for workflows\\b/i.test(text) || /^Agent$/i.test(title || '')) {
    paneAgent = 'antigravity_panel';
  } else if (/\\bCodex\\b/i.test(title || '') || /\\bGPT-5(?:\\.|\\b)/i.test(text)) {
    paneAgent = 'codex';
  }

  return JSON.stringify({
    title: title || null,
    mode: mode || null,
    model: model || null,
    pane_agent: paneAgent || null,
  });
`;

async function detectAntigravityPanelHasContent(Runtime) {
  try {
    const raw = await evalInPage(Runtime, ANTIGRAVITY_PANEL_HAS_CONTENT_EXPR);
    return raw === true;
  } catch { return false; }
}

async function readAntigravityPanelTitle(Runtime) {
  try {
    return await evalInPage(Runtime, ANTIGRAVITY_PANEL_TITLE_EXPR);
  } catch { return null; }
}

async function readAntigravityPanelSummary(Runtime) {
  try {
    const raw = await evalInPage(Runtime, ANTIGRAVITY_PANEL_SUMMARY_EXPR);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Panel-scoped read expression — identical logic to ANTIGRAVITY_READ_EXPR but
// searches inside .antigravity-agent-side-panel instead of the whole document.
// This avoids picking up containers from the editor area or other panels.
const ANTIGRAVITY_PANEL_READ_EXPR = `
  var bt = String.fromCharCode(96);
  var fence = bt + bt + bt;

  var BLOCK_TAGS = { DIV:1, P:1, LI:1, TR:1, H1:1, H2:1, H3:1, H4:1, H5:1, H6:1, BLOCKQUOTE:1, SECTION:1 };

  function nodeToText(node) {
    if (!node) return '';
    if (node.nodeType === 3) return node.textContent;
    if (node.nodeType !== 1) return '';
    var tag = node.nodeName.toUpperCase();
    if (tag === 'BR') return '\\n';
    if (tag === 'PRE') {
      var codeEl = node.querySelector('code');
      var cls = codeEl ? (codeEl.className || '') : '';
      var lang = (cls.match(/language-(\\w+)/) || [])[1] || '';
      var preText = ((codeEl || node).innerText || (codeEl || node).textContent || '').trim();
      return '\\n' + fence + lang + '\\n' + preText + '\\n' + fence + '\\n';
    }
    if (tag === 'CODE') return bt + node.textContent + bt;
    if (tag === 'BUTTON' || tag === 'SVG' || tag === 'STYLE') return '';
    var inner = Array.from(node.childNodes).map(nodeToText).join('');
    if (BLOCK_TAGS[tag] && inner.trim()) {
      return inner.endsWith('\\n') ? inner : inner + '\\n';
    }
    return inner;
  }

  // Extract text from a tool-call / action block (isolate bordered container).
  // Structure: .isolate > .flex (header with title + description) + div (progress/files)
  function extractToolBlock(el) {
    var rawText = (el.innerText || '').trim();
    var cleanText = rawText.replace(/^(Expand all|Collapse all|Collapse|Relocate|Cancel|Always run|Never run)$/gmi, '').trim();
    cleanText = cleanText.replace(/\\n\\s*\\n\\s*\\n/g, '\\n\\n');
    return cleanText.length > 10000 ? cleanText.substring(0, 10000) + '\\n...[truncated]' : cleanText;
  }

  // Scope search to the side panel
  var panel = d.querySelector('.antigravity-agent-side-panel');
  if (!panel) return JSON.stringify([]);

  // Find the conversation turn container within the panel
  var turnContainer = null;
  var divs = Array.from(panel.querySelectorAll('div'));
  for (var i = 0; i < divs.length; i++) {
    var cls = divs[i].className || '';
    if (cls.includes('gap-y-3') && cls.includes('px-4') && cls.includes('flex-col')) {
      turnContainer = divs[i]; break;
    }
  }
  if (!turnContainer) return JSON.stringify([]);

  var msgs = [];
  var turns = Array.from(turnContainer.children);

  for (var t = 0; t < turns.length; t++) {
    var turn = turns[t];
    var items = Array.from(turn.children);

    for (var j = 0; j < items.length; j++) {
      var item = items[j];

      // Skip hidden/transition-out items
      var itemCls = item.className || '';
      if (itemCls.includes('hidden') || itemCls.includes('opacity-0')) continue;

      var firstChild = item.children[0];
      if (!firstChild) continue;
      var fcCls = firstChild.className || '';

      // User message: first child has flex w-full flex-row
      if (fcCls.includes('w-full') && fcCls.includes('flex-row')) {
        var textEl = firstChild.querySelector('[class*="min-w-0"]') || firstChild;
        var text = textEl.innerText.trim();
        if (text) msgs.push({ role: 'user', content: text });

      // Assistant message: first child has flex-col space-y-2
      } else if (fcCls.includes('flex-col') && fcCls.includes('space-y-2')) {
        var parts = [];

        var gapContainers = Array.from(firstChild.querySelectorAll('[class*="gap-y-3"]'))
          .filter(function(el) {
            return el !== turnContainer && !el.contains(turnContainer);
          });

        if (gapContainers.length > 0) {
          for (var g = 0; g < gapContainers.length; g++) {
            var gKids = Array.from(gapContainers[g].children);
            for (var gk = 0; gk < gKids.length; gk++) {
              var kid = gKids[gk];
              var kidCls = kid.className || '';
              // Extract thinking/content from isolate containers instead of skipping them
              if (kidCls.includes('isolate')) {
                // The isolate div wraps markdown content (thinking output, tool results, etc.)
                var isoText = nodeToText(kid).trim();
                if (isoText) parts.push(isoText);
                continue;
              }
              if (kidCls.includes('pt-3')) continue;
              var kidText = nodeToText(kid).trim();
              if (kidText) parts.push(kidText);
            }
          }
        }

        // Fallback: old layout where rows are direct children of space-y-2
        if (parts.length === 0) {
          var rows = Array.from(firstChild.children);
          for (var k = 0; k < rows.length; k++) {
            var row = rows[k];
            var rowText = nodeToText(row).trim();
            var rowInnerText = row.innerText ? row.innerText.trim() : rowText;
            if (/^Thought for \\d/.test(rowText) || /^Thought for \\d/.test(rowInnerText)) continue;
            if (rowText) parts.push(rowText);
          }
        }

        var content = parts.join('\\n').trim();
        if (content) msgs.push({ role: 'assistant', content: content });

      // Tool-call / action block: first child is isolate bordered container
      // These appear as separate items in the turn alongside user/assistant items
      } else if (fcCls.includes('isolate') && fcCls.includes('border')) {
        var toolText = extractToolBlock(firstChild);
        if (toolText) {
          // Append to last assistant message if exists, otherwise create new one
          if (msgs.length > 0 && msgs[msgs.length - 1].role === 'assistant') {
            msgs[msgs.length - 1].content += '\\n' + toolText;
          } else {
            msgs.push({ role: 'assistant', content: toolText });
          }
        }

      // Status/waiting items (e.g. "Waiting", "Generating") — treat as assistant
      } else if (itemCls.includes('opacity-50') || itemCls.includes('transition-opacity')) {
        var statusText = (item.innerText || '').trim();
        if (statusText && statusText.length < 100) {
          if (msgs.length > 0 && msgs[msgs.length - 1].role === 'assistant') {
            msgs[msgs.length - 1].content += '\\n[' + statusText + ']';
          } else {
            msgs.push({ role: 'assistant', content: '[' + statusText + ']' });
          }
        }

      // Permission prompt items (e.g. "Run command?", "Edit file?") — extract text
      // including button labels so the web UI shows the pending action
      } else {
        var innerText = (item.innerText || '').trim();
        // Check if this looks like a permission prompt
        if (/Run command\\??|Edit file\\??|Steps? Require Input|Run tool\\??/i.test(innerText)) {
          // Build a prompt representation: extract heading + command + button labels
          var promptParts = [];
          // Get text nodes (heading like "Run command?")
          var headings = item.querySelectorAll('div, span, p');
          for (var hi = 0; hi < headings.length; hi++) {
            var ht = (headings[hi].innerText || '').trim();
            if (/^(Run command|Edit file|Run tool|\\d+ Steps? Require Input)/i.test(ht) && ht.length < 80) {
              promptParts.push(ht);
              break;
            }
          }
          // Get code/command content
          var cmdEl = item.querySelector('pre, code, [class*="font-mono"], [class*="monospace"]');
          if (cmdEl) {
            promptParts.push(cmdEl.textContent.trim().substring(0, 500));
          }
          // Get button labels
          var itemBtns = Array.from(item.querySelectorAll('button'));
          var btnLabels = [];
          for (var ib = 0; ib < itemBtns.length; ib++) {
            var bl = (itemBtns[ib].textContent || '').trim();
            bl = bl.replace(/\\s*(Alt|Ctrl|Shift|Cmd|Meta)\\+\\S+$/i, '').trim();
            if (bl && bl.length < 30) btnLabels.push('[' + bl + ']');
          }
          if (btnLabels.length > 0) promptParts.push(btnLabels.join('  '));
          // Get select/dropdown labels
          var itemSelects = Array.from(item.querySelectorAll('select'));
          for (var is2 = 0; is2 < itemSelects.length; is2++) {
            var selVal = itemSelects[is2].options[itemSelects[is2].selectedIndex];
            if (selVal) promptParts.push('[' + selVal.textContent.trim() + ' v]');
          }

          var promptText = promptParts.join('\\n').trim();
          if (promptText) {
            if (msgs.length > 0 && msgs[msgs.length - 1].role === 'assistant') {
              msgs[msgs.length - 1].content += '\\n' + promptText;
            } else {
              msgs.push({ role: 'assistant', content: promptText });
            }
          }
        }
      }
    }
  }
  return JSON.stringify(msgs);
`;

// Read messages from the panel — scoped to .antigravity-agent-side-panel to
// avoid picking up containers from the editor area or other page elements.
async function readAntigravityPanelMessages(Runtime, sessionId) {
  try {
    const raw = await evalInPage(Runtime, ANTIGRAVITY_PANEL_READ_EXPR);
    if (raw !== null) { resetReadFailures(sessionId); return raw; }
  } catch (e) {
    console.warn(`[${sessionId}] [sel] AntigravityPanel read error: ${e.message}`);
  }
  const f = recordReadFailure(sessionId);
  if (f.readFails === 1 || f.readFails % 5 === 0) {
    console.warn(`[${sessionId}] [sel] AntigravityPanel read null x${f.readFails}`);
  }
  return JSON.stringify([]);
}

// Send a message via the panel input (scoped to avoid Monaco editor contenteditable).
async function sendAntigravityPanelPrimary(Runtime, text) {
  const set = await evalInPage(Runtime, `
    var panel = d.querySelector('.antigravity-agent-side-panel');
    if (!panel) return 'no-panel';
    var input = panel.querySelector('[contenteditable]');
    if (!input) return 'no-input';
    input.focus();
    d.execCommand('selectAll', false, null);
    d.execCommand('delete', false, null);
    var ok = d.execCommand('insertText', false, ${JSON.stringify(text)});
    if (!ok) {
      input.textContent = ${JSON.stringify(text)};
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return 'ok';
  `);
  if (set !== 'ok') return { ok: false, code: 'input_not_found', detail: set };

  await new Promise(r => setTimeout(r, 200));

  const click = await evalInPage(Runtime, `
    var panel = d.querySelector('.antigravity-agent-side-panel');
    if (!panel) return 'no-panel';
    var btns = Array.from(panel.querySelectorAll('button'));
    var btn = btns.find(function(b) { return b.textContent.trim() === 'Send'; });
    if (!btn) return 'no-btn';
    if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') return 'disabled';
    btn.click();
    return 'sent';
  `);
  if (click === 'sent') return { ok: true };
  return { ok: false, code: 'send_button_failed', detail: click };
}

async function sendAntigravityPrimary(Runtime, text) {
  // Fill the contenteditable input (there is only one in the Manager page)
  const set = await evalInPage(Runtime, `
    const input = d.querySelector('[contenteditable]');
    if (!input) return 'no-input';
    input.focus();
    d.execCommand('selectAll', false, null);
    d.execCommand('delete', false, null);
    const ok = d.execCommand('insertText', false, ${JSON.stringify(text)});
    if (!ok) {
      input.textContent = ${JSON.stringify(text)};
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return 'ok';
  `);
  if (set !== 'ok') return { ok: false, code: 'input_not_found', detail: set };

  await new Promise(r => setTimeout(r, 200));

  // Click the Send button
  const click = await evalInPage(Runtime, `
    var btns = Array.from(d.querySelectorAll('button'));
    var btn = btns.find(function(b) { return b.textContent.trim() === 'Send'; });
    if (!btn) return 'no-btn';
    if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') return 'disabled';
    btn.click();
    return 'sent';
  `);
  if (click === 'sent') return { ok: true };
  return { ok: false, code: 'send_button_failed', detail: click };
}

async function sendAntigravityFallback(Runtime, text) {
  const result = await evalInPage(Runtime, `
    const input = d.querySelector('[contenteditable]');
    if (!input) return 'no-input';
    input.focus();
    d.execCommand('selectAll', false, null);
    d.execCommand('delete', false, null);
    d.execCommand('insertText', false, ${JSON.stringify(text)});
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
    input.dispatchEvent(new KeyboardEvent('keyup',   { key: 'Enter', code: 'Enter', bubbles: true }));
    return 'dispatched';
  `);
  if (result === 'dispatched') return { ok: true };
  return { ok: false, code: 'fallback_enter_failed', detail: result };
}

async function detectAntigravityThinking(Runtime) {
  try {
    const raw = await evalInPage(Runtime, `
      var btns = Array.from(d.querySelectorAll('button'));
      var stopBtn = btns.find(function(b) {
        var t = (b.textContent || b.getAttribute('aria-label') || '').toLowerCase();
        return t === 'stop' || t === 'cancel' || t.includes('stop generating');
      });
      var isThinking = !!stopBtn && stopBtn.offsetParent !== null;
      return JSON.stringify({ thinking: isThinking, label: isThinking ? 'Working' : '' });
    `);
    try { return JSON.parse(raw); } catch { return { thinking: false, label: '' }; }
  } catch {
    return { thinking: false, label: '' };
  }
}

// Panel-scoped thinking detection — only look for stop/cancel buttons within
// .antigravity-agent-side-panel to avoid false positives from other UI elements.
async function detectAntigravityPanelThinking(Runtime) {
  try {
    const raw = await evalInPage(Runtime, `
      var panel = d.querySelector('.antigravity-agent-side-panel');
      if (!panel) return JSON.stringify({ thinking: false, label: '', thinkingContent: '' });
      function appendThinkingText(target, txt) {
        txt = (txt || '').trim();
        if (!txt) return target;
        if (!target) return txt;
        if (target.includes(txt)) return target;
        return target + '\\n' + txt;
      }
      function collectDetailsText(detailsEl) {
        if (!detailsEl) return '';
        var parts = [];
        var nodes = Array.from(detailsEl.querySelectorAll('p, li, pre, code, div, span'));
        for (var i = 0; i < nodes.length; i++) {
          var node = nodes[i];
          if (!node || !node.offsetParent) continue;
          if (node.closest('summary')) continue;
          if (node.children.length > 0 && node.tagName !== 'PRE' && node.tagName !== 'CODE') continue;
          var txt = (node.innerText || node.textContent || '').trim();
          if (!txt) continue;
          if (/^(Thinking|Generating|Show thinking|Hide thinking)$/i.test(txt)) continue;
          parts.push(txt);
        }
        return parts.join('\\n').replace(/\\n{3,}/g, '\\n\\n').trim().substring(0, 3000);
      }
      var btns = Array.from(panel.querySelectorAll('button'));
      // Only match actual stop/abort buttons, NOT "Cancel" from permission prompts
      // (permission prompts have "Always run" + "Cancel" side by side)
      var stopBtn = btns.find(function(b) {
        var t = (b.textContent || b.getAttribute('aria-label') || '').trim().toLowerCase();
        if (t === 'stop' || t === 'stop generating' || t.includes('stop generating')) return true;
        // "Cancel" is only a stop button if there's no "Always run" nearby
        // (permission prompts have "Always run" + "Cancel" in nearby ancestors)
        if (t === 'cancel') {
          var ancestor = b.parentElement;
          for (var ci = 0; ci < 4 && ancestor; ci++) {
            var nearby = Array.from(ancestor.querySelectorAll('button'));
            if (nearby.some(function(s) { return (s.textContent || '').toLowerCase().includes('always run'); })) return false;
            ancestor = ancestor.parentElement;
          }
          return true;
        }
        return false;
      });
      var isThinking = !!stopBtn && stopBtn.offsetParent !== null;
      var thinkingContent = '';
      try {
        thinkingContent = appendThinkingText(thinkingContent, collectDetailsText(panel.querySelector('details[open]')));
      } catch(e) {}
      return JSON.stringify({ thinking: isThinking, label: isThinking ? 'Working' : '', thinkingContent: thinkingContent });
    `);
    try { return JSON.parse(raw); } catch { return { thinking: false, label: '', thinkingContent: '' }; }
  } catch {
    return { thinking: false, label: '', thinkingContent: '' };
  }
}

// Returns the current conversation title (workspace / conversation name) from the Manager sidebar.
async function readAntigravitySessionTitle(Runtime) {
  try {
    return await evalInPage(Runtime, `
      // The header shows: "Workspace / Conversation  ⋯  dock_to_left"
      // Look for the element containing a "/" separator near the dock button
      var allEls = Array.from(d.querySelectorAll('div, span, p'));
      for (var i = 0; i < allEls.length; i++) {
        var el = allEls[i];
        var text = (el.innerText || '').trim();
        if (text.includes('/') && text.split('\\n').length <= 4 && text.length < 100) {
          var parts = text.split(/\\s*[\\/\\n]\\s*/);
          if (parts.length >= 2 && parts[0].length > 1 && parts[1].length > 1) {
            return parts.filter(Boolean).join(' / ');
          }
        }
      }
      return null;
    `);
  } catch {
    return null;
  }
}

// Returns { model_id, conversation_mode } from the compose toolbar.
//
// conversation_mode: 'Planning' or 'Fast' — read from the Planning button's hidden dialog.
// The dialog is always in the DOM (sibling of the Planning [role="button"]); the active item
// carries the class bg-gray-500/20.  We read it without opening the dialog.
async function readAntigravityConfig(Runtime, workspacePath) {
  try {
    const raw = await evalInPage(Runtime, `
      // --- Model name ---
      // Antigravity surfaces the active model as a clickable [role="button"]
      // (or <button>) labeled like "Claude Opus 4.6 (Thinking)" or
      // "Gemini 3.1 Pro (High)" right next to the chat input. Walking up from
      // Send was reading the wrong toolbar (sibling panel / hidden settings),
      // so look for the element that directly displays a model name instead.
      var model = null;
      var searchRoot = d.querySelector('.antigravity-agent-side-panel') || d;
      // Reject UI noise that happens to contain a family keyword.
      var skipExact = ['Planning', 'Fast', 'Send', 'Conversation mode', 'Model', 'Mode', 'Stop', 'New Chat'];
      // Match labels with both a model family keyword and a digit (version)
      // to avoid grabbing strings like "Conversation mode" or "Pro plan".
      var modelFamilyPat = /\\b(claude|gemini|gpt|llama|mistral|sonnet|opus|haiku|flash)\\b/i;
      var versionPat = /\\d/;
      var modelCandidates = Array.from(searchRoot.querySelectorAll('button, [role="button"]'))
        .filter(function(el){
          if (!el.offsetParent) return false;
          var t = (el.innerText || '').trim();
          if (!t) return false;
          var first = t.split('\\n')[0].trim();
          if (skipExact.indexOf(first) !== -1) return false;
          if (first.length < 4 || first.length > 60) return false;
          return modelFamilyPat.test(first) && versionPat.test(first);
        })
        .map(function(el){ return (el.innerText || '').split('\\n')[0].trim(); });
      if (modelCandidates.length > 0) {
        model = modelCandidates[0];
      } else {
        // Fallback: original toolbar-from-Send strategy.
        var sendBtn = Array.from(searchRoot.querySelectorAll('button')).find(function(b){ return b.textContent.trim() === 'Send'; });
        if (sendBtn) {
          var toolbar = sendBtn.parentElement;
          while (toolbar && toolbar.querySelectorAll('button').length < 3) {
            toolbar = toolbar.parentElement;
          }
          if (toolbar) {
            var lines = toolbar.innerText.split('\\n').map(function(s){ return s.trim(); }).filter(Boolean);
            var modelLines = lines.filter(function(l) {
              return skipExact.indexOf(l) === -1 && l.length > 2 && l.length < 60 && modelFamilyPat.test(l) && versionPat.test(l);
            });
            if (modelLines.length > 0) model = modelLines[0];
          }
        }
      }

      // --- Conversation mode ---
      // The Planning button ([role="button"][aria-haspopup="dialog"]) has a sibling [role="dialog"]
      // that contains 'Planning' and 'Fast' items.  The active item has bg-gray-500/20 in className.
      var mode = 'unknown';
      var planBtn = Array.from(searchRoot.querySelectorAll('[role="button"][aria-haspopup="dialog"]')).find(function(el) {
        var t = el.innerText ? el.innerText.trim() : '';
        return t === 'Planning' || t === 'Fast';
      });
      if (planBtn) {
        var leftDiv = planBtn.parentElement;
        if (leftDiv) {
          var dialogs = Array.from(leftDiv.children).filter(function(el) { return el.getAttribute('role') === 'dialog'; });
          for (var i = 0; i < dialogs.length; i++) {
            var dlgText = dialogs[i].innerText || '';
            if (dlgText.includes('Planning') && dlgText.includes('Fast')) {
              var items = Array.from(dialogs[i].querySelectorAll('[class*="cursor-pointer"]'));
              var activeItem = items.find(function(el) { return el.className.includes('bg-gray-500/20'); });
              if (activeItem) {
                var nameEl = activeItem.querySelector('.font-medium');
                mode = nameEl ? nameEl.innerText.trim() : activeItem.innerText.split('\\n')[0].trim();
              }
              break;
            }
          }
        }
      }

      return JSON.stringify({ model_id: model, conversation_mode: mode });
    `);
    const parsed = raw ? JSON.parse(raw) : {};
    const modelId = parsed.model_id || 'unknown';
    const conversationMode = parsed.conversation_mode || 'unknown';
    return {
      model_id:           modelId,
      conversation_mode:  conversationMode,
      permission_mode:    'unknown',
      file_access_scope:  workspacePath    || 'unknown',
    };
  } catch {
    return { model_id: 'unknown', conversation_mode: 'unknown', permission_mode: 'unknown', file_access_scope: workspacePath || 'unknown' };
  }
}

// ─── Message reading (dispatch) ───────────────────────────────────────────────

async function readMessages(Runtime, agentType, sessionId) {
  if (agentType === 'codex-desktop')      return readCodexMessages(Runtime, sessionId, true);
  if (agentType === 'codex')              return readCodexMessages(Runtime, sessionId, false);
  if (agentType === 'gemini')             return readGeminiMessages(Runtime, sessionId);
  if (isRooCodeAgentType(agentType))      return readRooCodeMessages(Runtime, sessionId);
  if (isContinueAgentType(agentType))     return readContinueMessages(Runtime, sessionId);
  if (agentType === 'antigravity')        return readAntigravityMessages(Runtime, sessionId);
  if (agentType === 'antigravity_panel')  return readAntigravityPanelMessages(Runtime, sessionId);
  // 'claude' and 'claude-desktop' both use Claude message selectors
  return readClaudeMessages(Runtime, sessionId);
}

// ─── Claude send strategies ───────────────────────────────────────────────────

async function sendClaudePrimary(Runtime, text) {
  const set = await evalInFrame(Runtime, `
    const input = d.querySelector('${CLAUDE_PRIMARY.input}');
    if (!input) return 'no-input';
    input.focus();
    d.execCommand('selectAll', false, null);
    const ok = d.execCommand('insertText', false, ${JSON.stringify(text)});
    if (!ok) { input.textContent = ${JSON.stringify(text)}; input.dispatchEvent(new Event('input', { bubbles: true })); }
    return 'ok';
  `);
  if (set !== 'ok') return { ok: false, code: 'input_not_found', detail: set };

  await new Promise(r => setTimeout(r, 200));

  const click = await evalInFrame(Runtime, `
    const btn = d.querySelector('${CLAUDE_PRIMARY.sendBtn}');
    if (!btn) return 'no-btn';
    if (btn.disabled) return 'disabled';
    btn.click();
    return 'sent';
  `);
  if (click === 'sent') return { ok: true };
  return { ok: false, code: 'send_button_failed', detail: click };
}

async function sendClaudeFallback(Runtime, text) {
  const set = await evalInFrame(Runtime, `
    const input = d.querySelector('[contenteditable]');
    if (!input) return 'no-input';
    input.focus();
    d.execCommand('selectAll', false, null);
    const ok = d.execCommand('insertText', false, ${JSON.stringify(text)});
    if (!ok) { input.textContent = ${JSON.stringify(text)}; input.dispatchEvent(new Event('input', { bubbles: true })); }
    return 'ok';
  `);
  if (set !== 'ok') return { ok: false, code: 'fallback_no_input', detail: set };

  await new Promise(r => setTimeout(r, 200));

  const click = await evalInFrame(Runtime, `
    const btn = d.querySelector('${CLAUDE_FALLBACK.sendBtn}');
    if (!btn) return 'no-btn';
    if (btn.disabled) return 'disabled';
    btn.click();
    return 'sent';
  `);
  if (click === 'sent') return { ok: true };
  return { ok: false, code: 'fallback_send_failed', detail: click };
}

// ─── Codex send strategies ────────────────────────────────────────────────────

async function sendCodexPrimary(Runtime, text, usePageEval) {
  const evalFn = usePageEval ? evalInPage : evalInFrame;
  const set = await evalFn(Runtime, `
    const input = d.querySelector('${CODEX_PRIMARY.input}');
    if (!input) return 'no-input';
    input.focus();
    // Clear existing content
    d.execCommand('selectAll', false, null);
    d.execCommand('delete', false, null);
    // Try modern InputEvent first, fall back to execCommand
    var ok = false;
    try {
      var ev = new InputEvent('beforeinput', { inputType: 'insertText', data: ${JSON.stringify(text)}, bubbles: true, cancelable: true, composed: true });
      input.dispatchEvent(ev);
      // Check if ProseMirror accepted it
      if (input.textContent.trim().length > 0) { ok = true; }
    } catch(e) {}
    if (!ok) {
      ok = d.execCommand('insertText', false, ${JSON.stringify(text)});
    }
    if (!ok) {
      // Last resort: set innerHTML and dispatch input event
      input.innerHTML = '<p>' + ${JSON.stringify(text)}.replace(/</g, '&lt;') + '</p>';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      ok = true;
    }
    return 'ok';
  `);
  if (set !== 'ok') return { ok: false, code: 'input_not_found', detail: set };

  await new Promise(r => setTimeout(r, 400));

  const click = await evalFn(Runtime, `
    const pm = d.querySelector('${CODEX_PRIMARY.input}');
    if (!pm) return 'no-input';
    let container = pm.parentElement;
    let found = null;
    while (container && container !== d.body) {
      if (container.querySelectorAll('button').length >= ${CODEX_PRIMARY.minComposerButtons}) { found = container; break; }
      container = container.parentElement;
    }
    if (!found) return 'no-container';
    const btns = Array.from(found.querySelectorAll('button'));
    const btn = btns[btns.length - 1];
    if (!btn) return 'no-btn';
    if (btn.disabled) return 'disabled';
    // Check if this is the send button vs stop button.
    // Send arrow: "M9.334" (old) or "M4.5 5.75" / "M4.5 " (new).
    // Stop icon: rect element or unknown SVG path.
    var svg = btn.querySelector('svg path');
    var svgD = svg ? svg.getAttribute('d') || '' : '';
    var isKnownSend = !svgD || svgD.startsWith('M9.334') || svgD.startsWith('M4.5 ');
    if (!isKnownSend) return 'agent_busy';
    var hasStopRect = btn.querySelector('svg rect');
    if (hasStopRect) return 'agent_busy';
    btn.click();
    return 'sent';
  `);
  if (click === 'sent') return { ok: true };
  if (click === 'agent_busy') return { ok: false, code: 'agent_busy', detail: 'Agent is generating — send button is stop icon' };
  return { ok: false, code: 'send_button_failed', detail: click };
}

// Steer: inject text into Codex's ProseMirror input WITHOUT clicking send.
// This triggers Codex's native steer UI when the agent is generating —
// Codex detects user typing mid-generation and shows a "steer" prompt.
async function steerCodexInput(Runtime, text, usePageEval) {
  const evalFn = usePageEval ? evalInPage : evalInFrame;
  const set = await evalFn(Runtime, `
    const input = d.querySelector('${CODEX_PRIMARY.input}');
    if (!input) return 'no-input';
    input.focus();
    d.execCommand('selectAll', false, null);
    d.execCommand('delete', false, null);
    var ok = false;
    try {
      var ev = new InputEvent('beforeinput', { inputType: 'insertText', data: ${JSON.stringify(text)}, bubbles: true, cancelable: true, composed: true });
      input.dispatchEvent(ev);
      if (input.textContent.trim().length > 0) ok = true;
    } catch(e) {}
    if (!ok) ok = d.execCommand('insertText', false, ${JSON.stringify(text)});
    if (!ok) {
      input.innerHTML = '<p>' + ${JSON.stringify(text)}.replace(/</g, '&lt;') + '</p>';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return 'ok';
  `);
  if (set !== 'ok') return { ok: false, code: 'input_not_found', detail: set };
  return { ok: true };
}

// Codex fallback: dispatch Enter keydown (no Shift = submit, not newline)
async function sendCodexFallback(Runtime, text, usePageEval) {
  const evalFn = usePageEval ? evalInPage : evalInFrame;
  const result = await evalFn(Runtime, `
    const input = d.querySelector('${CODEX_FALLBACK.input}');
    if (!input) return 'no-input';
    input.focus();
    d.execCommand('selectAll', false, null);
    d.execCommand('delete', false, null);
    const ok = d.execCommand('insertText', false, ${JSON.stringify(text)});
    if (!ok) { input.textContent = ${JSON.stringify(text)}; input.dispatchEvent(new Event('input', { bubbles: true })); }
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
    input.dispatchEvent(new KeyboardEvent('keyup',   { key: 'Enter', code: 'Enter', bubbles: true }));
    return 'dispatched';
  `);
  if (result === 'dispatched') return { ok: true };
  return { ok: false, code: 'fallback_enter_failed', detail: result };
}

async function sendGeminiPrimary(Runtime, text) {
  // Set text in the .chat-submit-input element (may be textarea or contenteditable div)
  const set = await evalInFrame(Runtime, `
    const input = d.querySelector('${GEMINI_PRIMARY.input}');
    if (!input) return 'no-input';
    input.focus();
    if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
      // Native textarea: set value and fire Angular's change detection
      var nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
      if (nativeInputValueSetter) nativeInputValueSetter.set.call(input, ${JSON.stringify(text)});
      else input.value = ${JSON.stringify(text)};
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      // Contenteditable div: use execCommand so Angular detects the change
      d.execCommand('selectAll', false, null);
      d.execCommand('delete', false, null);
      const ok = d.execCommand('insertText', false, ${JSON.stringify(text)});
      if (!ok) {
        input.textContent = ${JSON.stringify(text)};
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
    return 'ok';
  `);
  if (set !== 'ok') return { ok: false, code: 'input_not_found', detail: set };

  // Wait for Angular's change detection to enable the send button
  await new Promise(r => setTimeout(r, 300));

  const click = await evalInFrame(Runtime, `
    const btn = d.querySelector('${GEMINI_PRIMARY.sendBtn}');
    if (!btn) return 'no-btn';
    if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') return 'disabled';
    btn.click();
    return 'sent';
  `);
  if (click === 'sent') return { ok: true };
  return { ok: false, code: 'send_button_failed', detail: click };
}

async function sendGeminiFallback(Runtime, text) {
  // Fallback: try broader selectors then submit via Enter key
  const result = await evalInFrame(Runtime, `
    const input = d.querySelector('${GEMINI_FALLBACK.input}');
    if (!input) return 'no-input';
    input.focus();
    if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
      input.value = ${JSON.stringify(text)};
      input.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      d.execCommand('selectAll', false, null);
      d.execCommand('delete', false, null);
      const ok = d.execCommand('insertText', false, ${JSON.stringify(text)});
      if (!ok) {
        input.textContent = ${JSON.stringify(text)};
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
    // Try click send button first, then fall back to Enter
    const btn = d.querySelector('${GEMINI_FALLBACK.sendBtn}');
    if (btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true') {
      btn.click();
      return 'sent-btn';
    }
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
    input.dispatchEvent(new KeyboardEvent('keyup',   { key: 'Enter', code: 'Enter', bubbles: true }));
    return 'dispatched';
  `);
  if (result === 'sent-btn' || result === 'dispatched') return { ok: true };
  return { ok: false, code: 'fallback_enter_failed', detail: result };
}

// ─── Stop / interrupt selectors ───────────────────────────────────────────────
//
// When the agent is generating, a stop/interrupt button appears in the UI.
// We use three layers:
//   1. aria-label patterns — most semantic, survives class renames
//   2. class-name heuristics — catches cases without good aria labels
//   3. Escape key dispatch — last resort; Claude Code cancels on Escape

const STOP_SELECTORS = {
  claude: {
    primary: [
      'button[aria-label*="Stop" i]',
      'button[aria-label*="Interrupt" i]',
      'button[aria-label*="stop generating" i]',
      'button[aria-label*="interrupt agent" i]',
      'button[data-testid*="stop" i]',
      'button[data-testid*="interrupt" i]',
    ].join(', '),
    fallback: [
      'button[class*="stop"]',
      'button[class*="Stop"]',
      'button[class*="interrupt"]',
      'button[class*="cancel"]',
    ].join(', '),
    escapeOnFail: true, // Claude Code cancels generation on Escape
  },
  codex: {
    primary: [
      'button[aria-label*="Stop" i]',
      'button[aria-label*="Interrupt" i]',
      'button[aria-label*="Cancel" i]',
      'button[data-testid*="stop" i]',
    ].join(', '),
    fallback: [
      'button[class*="stop"]',
      'button[class*="Stop"]',
      'button[class*="cancel"]',
    ].join(', '),
    escapeOnFail: true,
  },
  gemini: {
    primary: [
      'button.chat-stop-button',               // confirmed live: aria-label="Stop current request"
      'button[aria-label*="Stop" i]',
      'button[aria-label*="Cancel" i]',
    ].join(', '),
    fallback: [
      'button.standalone-action-button:not(.submit-button)',
    ].join(', '),
    escapeOnFail: false,
  },
  continue: {
    primary: [
      'button[aria-label*="Stop" i]',
      'button[aria-label*="Cancel" i]',
      'button[data-testid*="stop" i]',
    ].join(', '),
    fallback: [
      'button[class*="stop"]',
      'button[class*="cancel"]',
    ].join(', '),
    escapeOnFail: false,
  },
  roo_code: {
    primary: [
      'button[aria-label*="Stop" i]',
      'button[aria-label*="Cancel" i]',
      'button[data-testid*="stop" i]',
    ].join(', '),
    fallback: [
      'button[class*="stop"]',
      'button[class*="cancel"]',
    ].join(', '),
    escapeOnFail: false,
  },
};

// Try clicking the stop button using the given selector string.
// Returns 'clicked' | 'disabled' | 'no-btn'.
function _buildStopClickExpr(sel) {
  return `
    var btn = d.querySelector(${JSON.stringify(sel)});
    if (!btn) {
      // also check: button whose only child is an SVG with a 'stop'-like desc/title
      var allBtns = d.querySelectorAll('button');
      for (var i = 0; i < allBtns.length; i++) {
        var b = allBtns[i];
        var t = (b.getAttribute('aria-label') || b.getAttribute('title') || b.textContent || '').toLowerCase();
        if (t.indexOf('stop') !== -1 || t.indexOf('interrupt') !== -1) { btn = b; break; }
      }
    }
    if (!btn) return 'no-btn';
    if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') return 'disabled';
    btn.click();
    return 'clicked';
  `;
}

// Dispatch Escape to the active element (or body) — cancels generation in Claude Code.
const _ESCAPE_EXPR = `
  var target = d.activeElement || d.body;
  target.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true
  }));
  target.dispatchEvent(new KeyboardEvent('keyup', {
    key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true
  }));
  return 'dispatched';
`;

// Attempt to stop a running agent generation.
// Returns { ok: true } on success, { ok: false, code, detail } on failure.
// 'agent_not_active' means no stop button was found (agent is idle).
async function interruptAgent(Runtime, agentType, sessionId) {
  // antigravity/antigravity_panel host the Claude Code webview — use claude stop selectors
  // claude-desktop uses claude selectors; codex-desktop uses codex selectors
  const normalised = (agentType === 'antigravity' || agentType === 'antigravity_panel') ? 'claude'
    : agentType === 'claude-desktop' ? 'claude'
    : agentType === 'codex-desktop'  ? 'codex'
    : agentType === 'cline'          ? 'roo_code'
    : agentType; // 'continue', 'gemini', 'claude', 'codex', 'roo_code' pass through
  const sels = STOP_SELECTORS[normalised] || STOP_SELECTORS.claude;
  const evalFn = (agentType === 'codex-desktop') ? evalInPage : evalInFrame;

  // Strategy 1 — primary aria-label / data-testid selectors
  try {
    const r = await evalFn(Runtime, _buildStopClickExpr(sels.primary));
    if (r === 'clicked') {
      console.log(`[${sessionId}] [interrupt] Stop button clicked (primary)`);
      return { ok: true };
    }
    if (r === 'disabled') {
      return { ok: false, code: 'agent_not_active', detail: 'Stop button found but disabled — agent may already be idle' };
    }
  } catch (e) {
    console.warn(`[${sessionId}] [interrupt] Primary stop error: ${e.message}`);
  }

  // Strategy 2 — class-name fallback
  if (sels.fallback) {
    try {
      const r = await evalFn(Runtime, _buildStopClickExpr(sels.fallback));
      if (r === 'clicked') {
        console.log(`[${sessionId}] [interrupt] Stop button clicked (fallback)`);
        return { ok: true };
      }
      if (r === 'disabled') {
        return { ok: false, code: 'agent_not_active', detail: 'Stop button (fallback) found but disabled' };
      }
    } catch (e) {
      console.warn(`[${sessionId}] [interrupt] Fallback stop error: ${e.message}`);
    }
  }

  // Strategy 3 — Escape key dispatch
  if (sels.escapeOnFail) {
    try {
      const r = await evalFn(Runtime, _ESCAPE_EXPR);
      if (r === 'dispatched') {
        console.log(`[${sessionId}] [interrupt] Escape key dispatched`);
        // Escape is best-effort — report ok, the thinking poll will confirm
        return { ok: true };
      }
    } catch (e) {
      console.warn(`[${sessionId}] [interrupt] Escape dispatch error: ${e.message}`);
    }
  }

  console.warn(`[${sessionId}] [interrupt] No stop button found — agent likely idle`);
  return { ok: false, code: 'agent_not_active', detail: 'No stop button visible — agent may not be generating' };
}

// ─── Codex config reading ─────────────────────────────────────────────────────
//
// Reads model, effort, speed, and access level from the Codex (openai.chatgpt) composer
// toolbar buttons.  These values are displayed as read-only — Codex does not
// expose its settings via in-DOM dropdowns (they use VS Code host APIs instead).

const READ_CODEX_CONFIG_EXPR = `
  var config = { model_id: null, effort: null, speed: null, access: null };
  var btns = Array.from(d.querySelectorAll('button'));
  var lastBtns = btns.slice(-25);
  function norm(t) {
    return String(t || '').replace(/\\s+/g, ' ').trim();
  }
  function normalizeModelLabel(label) {
    var t = norm(label);
    if (!t) return null;
    if (/^\\d+(?:\\.\\d+)?$/.test(t)) return 'gpt-' + t;
    if (/^gpt[-\\s.]?[\\d.]+$/i.test(t)) return t.toLowerCase().replace(/\\s+/g, '-');
    if (/^o[134](?:[-\\s.]?[\\d.]+)?$/i.test(t)) return t.toLowerCase().replace(/\\s+/g, '-');
    return null;
  }

  // Model: button text matching GPT-x.x or o1/o3/o4 patterns in composer area
  var modelBtn = lastBtns.find(function(b) {
    var t = norm(b.textContent || '');
    return /^gpt[-\\s.]?[\\d.]+|^o[134][-\\s.]/i.test(t) && t.length < 20;
  });
  if (modelBtn) config.model_id = normalizeModelLabel(modelBtn.textContent) || norm(modelBtn.textContent);

  // Effort level: Low / Medium / High / Extra High button
  var effortBtn = lastBtns.find(function(b) {
    return /^(low|medium|high|extra\\s*high)$/i.test(norm(b.textContent || ''));
  });
  if (effortBtn) config.effort = norm(effortBtn.textContent);

  // Newer Codex Desktop builds combine model + effort in one footer button,
  // e.g. "5.5High" or "GPT-5.4 Medium".
  if (!config.model_id || !config.effort) {
    var comboBtn = lastBtns.find(function(b) {
      var parts = Array.from(b.querySelectorAll('span')).map(function(span) { return norm(span.textContent); }).filter(Boolean);
      if (parts.length < 2) return false;
      var modelPart = parts.map(normalizeModelLabel).find(Boolean);
      var effortPart = parts.find(function(part) { return /^(low|medium|high|extra\\s*high)$/i.test(part); });
      return !!(modelPart && effortPart);
    });
    if (comboBtn) {
      var comboParts = Array.from(comboBtn.querySelectorAll('span')).map(function(span) { return norm(span.textContent); }).filter(Boolean);
      var comboModel = comboParts.map(normalizeModelLabel).find(Boolean);
      var comboEffort = comboParts.find(function(part) { return /^(low|medium|high|extra\\s*high)$/i.test(part); }) || null;
      if (!config.model_id && comboModel) config.model_id = comboModel;
      if (!config.effort && comboEffort) config.effort = comboEffort;
    }
  }

  // Access mode: "Full access", "Read access", "Default permissions", etc.
  var accessBtn = lastBtns.find(function(b) {
    var t = norm(b.textContent || '');
    return (/access|restricted/i.test(t) && !/add|ide|file$/i.test(t) && t.length < 30) ||
           /^default\\s+permissions$/i.test(t);
  });
  if (accessBtn) config.access = norm(accessBtn.textContent);

  // Speed is usually only visible while the combined model menu is open. If a
  // menu is already open, capture the checked Standard/Fast item without
  // opening menus during passive polling.
  var speedItems = Array.from(d.querySelectorAll('[role="menuitem"],[role="option"],button')).filter(function(el) {
    if (!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)) return false;
    var t = norm(el.innerText || el.textContent || '');
    return /^(standard|fast)(\\s|$)/i.test(t);
  });
  var checkedSpeed = speedItems.find(function(el) {
    return el.getAttribute('aria-checked') === 'true' ||
      /check|selected|active/i.test(String(el.className || '')) ||
      !!el.querySelector('svg');
  }) || null;
  if (checkedSpeed) {
    var speedText = norm(checkedSpeed.innerText || checkedSpeed.textContent || '').split(' ')[0];
    config.speed = speedText;
  }

  return JSON.stringify(config);
`;

// Normalize access button text to config.toml sandbox_mode value.
const _CODEX_ACCESS_LABEL_TO_ID = {
  'full access':          'danger-full-access',
  'workspace write':      'workspace-write',
  'read only':            'read-only',
  'default permissions':  'default',
};

// Reverse map: config.toml value → display label (for CDP button clicking)
const _CODEX_ACCESS_ID_TO_LABEL = {
  'danger-full-access': 'Full access',
  'workspace-write':    'Workspace write',
  'read-only':          'Read only',
  'default':            'Default permissions',
};

function _normalizeCodexAccess(label) {
  if (!label) return label;
  const lower = label.toLowerCase().replace(/\s+/g, ' ').trim();
  return _CODEX_ACCESS_LABEL_TO_ID[lower] || label;
}

// Normalize effort button text to reasoning_effort value.
function _normalizeCodexEffort(label) {
  if (!label) return label;
  // "Low" → "low", "Medium" → "medium", "Extra High" → "extra-high"
  return label.toLowerCase().replace(/\s+/g, '-').trim();
}

async function readCodexConfig(Runtime, usePageEval) {
  try {
    const raw = usePageEval
      ? await evalInPage(Runtime, READ_CODEX_CONFIG_EXPR)
      : await evalInFrame(Runtime, READ_CODEX_CONFIG_EXPR);
    if (!raw) return null;
    const cfg = JSON.parse(raw);
    // Normalize display labels to config.toml values
    if (cfg.access)   cfg.access   = _normalizeCodexAccess(cfg.access);
    if (cfg.effort)   cfg.effort   = _normalizeCodexEffort(cfg.effort);
    if (cfg.model_id) cfg.model_id = cfg.model_id.toLowerCase().trim(); // "GPT-5.4" → "gpt-5.4"
    if (cfg.speed) cfg.speed = String(cfg.speed).toLowerCase().trim();
    return cfg;
  } catch {
    return null;
  }
}

// ─── Codex sandbox status (Epic 7) ────────────────────────────────────────────
//
// Reads sandbox/environment status from Codex Desktop DOM. The sandbox state
// is inferred from the access mode button and any visible status indicators.
// Returns: { active: bool, mode: string, label: string }

const READ_CODEX_SANDBOX_STATUS_EXPR = `
  var result = { active: false, mode: 'unknown', label: 'Unknown' };

  // Read the access mode button (same as config reading) to determine sandbox level
  var btns = Array.from(d.querySelectorAll('button'));
  var lastBtns = btns.slice(-25);
  var accessBtn = lastBtns.find(function(b) {
    var t = (b.textContent || '').trim();
    return (/access|restricted/i.test(t) && !/add|ide|file$/i.test(t) && t.length < 30) ||
           /^default\\s+permissions$/i.test(t);
  });
  if (accessBtn) {
    var mode = accessBtn.textContent.trim().toLowerCase();
    result.mode = mode;
    if (/full/i.test(mode)) {
      result.active = false;
      result.label = 'Sandbox off (full access)';
    } else if (/read/i.test(mode)) {
      result.active = true;
      result.label = 'Sandbox active (read only)';
    } else if (/write/i.test(mode)) {
      result.active = true;
      result.label = 'Sandbox active (workspace write)';
    } else if (/default/i.test(mode)) {
      result.active = true;
      result.label = 'Sandbox active (default)';
    }
  }

  // Look for additional sandbox-related indicators in the DOM
  var statusEls = d.querySelectorAll('[class*="sandbox"], [class*="environment"], [data-testid*="sandbox"]');
  for (var i = 0; i < statusEls.length; i++) {
    var text = (statusEls[i].innerText || '').trim();
    if (text && text.length < 80) {
      result.label = text;
      result.active = !/off|disabled|inactive/i.test(text);
      break;
    }
  }

  return JSON.stringify(result);
`;

async function readCodexSandboxStatus(Runtime, usePageEval) {
  try {
    const evalFn = usePageEval ? evalInPage : evalInFrame;
    const raw = await evalFn(Runtime, READ_CODEX_SANDBOX_STATUS_EXPR);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ─── Codex terminal output reader (Epic 4) ────────────────────────────────────
//
// Extracts terminal/command output from the Codex conversation.
// Tool output appears as <pre> blocks within assistant turns, often preceded
// by command labels. Returns the most recent blocks as structured output.
//
// Returns: [{ command?: string, output: string, turnId?: string }]

const READ_CODEX_TERMINAL_OUTPUT_EXPR = `
  var results = [];
  var bt = String.fromCharCode(96);

  // Strategy 0: Read live xterm terminal panel (Codex Desktop only)
  // The terminal uses xterm with class .bg-token-terminal-background and .xterm-rows
  var termDiv = d.querySelector('.bg-token-terminal-background, [data-codex-terminal]');
  if (termDiv) {
    var xtermRows = termDiv.querySelector('.xterm-rows');
    if (xtermRows) {
      var rowTexts = Array.from(xtermRows.children).map(function(r) { return r.textContent; }).filter(function(t) { return t.trim(); });
      if (rowTexts.length > 0) {
        results.push({
          command: null,
          output: rowTexts.join('\\n').substring(0, 8000),
          turnId: '__live_terminal__',
          live: true
        });
      }
    }
  }

  // Strategy 1: data-content-search-unit-key based (modern Codex DOM)
  var units = Array.from(d.querySelectorAll('[data-content-search-unit-key]'));
  var assistantUnits = units.filter(function(u) {
    return (u.getAttribute('data-content-search-unit-key') || '').endsWith(':assistant');
  });

  // Only look at the last 5 assistant units to keep output manageable
  var recentUnits = assistantUnits.slice(-5);

  for (var i = 0; i < recentUnits.length; i++) {
    var unit = recentUnits[i];
    var turnKey = unit.getAttribute('data-content-search-unit-key') || '';
    var preBlocks = Array.from(unit.querySelectorAll('pre'));

    for (var j = 0; j < preBlocks.length; j++) {
      var pre = preBlocks[j];
      var text = pre.textContent.trim();
      if (!text || text.length < 2) continue;

      // Try to detect a command label — check preceding sibling or parent
      var command = null;
      var prev = pre.previousElementSibling;
      if (prev) {
        var prevText = (prev.textContent || '').trim();
        // Heuristic: short text before a <pre> is likely the command or tool name
        if (prevText.length > 0 && prevText.length < 120 &&
            (prevText.startsWith(bt) || /^(\\$|>|#|\\w+\\s+(--|-))/.test(prevText) ||
             /^(Running|Executing|Command|Output|Terminal|bash|sh|cmd)/i.test(prevText))) {
          command = prevText.replace(/^\\s*[\\$>]\\s*/, '').trim();
        }
      }

      results.push({
        command: command,
        output: text.substring(0, 8000),
        turnId: turnKey,
      });
    }
  }

  // Strategy 2: fallback — look for any <pre> blocks in the page (non-unit DOM)
  if (results.length === 0) {
    var allPres = Array.from(d.querySelectorAll('pre'));
    var recentPres = allPres.slice(-5);
    for (var k = 0; k < recentPres.length; k++) {
      var text = recentPres[k].textContent.trim();
      if (text && text.length >= 2) {
        results.push({ command: null, output: text.substring(0, 8000), turnId: null });
      }
    }
  }

  return JSON.stringify(results);
`;

async function readCodexTerminalOutput(Runtime, usePageEval) {
  try {
    const evalFn = usePageEval ? evalInPage : evalInFrame;
    const raw = await evalFn(Runtime, READ_CODEX_TERMINAL_OUTPUT_EXPR);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

// ─── Codex terminal input writer ──────────────────────────────────────────────
//
// Writes text + Enter to the xterm terminal in Codex Desktop.
// xterm uses a hidden textarea (.xterm-helper-textarea) for keyboard input.
// We focus it and dispatch keyboard events for each character, then Enter.

async function writeCodexTerminalInput(Runtime, usePageEval, text) {
  const evalFn = usePageEval ? evalInPage : evalInFrame;
  // Focus the xterm textarea and type each character via input events
  const expr = `
    var ta = d.querySelector('.xterm-helper-textarea');
    if (!ta) return 'no_textarea';
    ta.focus();
    var text = ${JSON.stringify(text)};
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      ta.dispatchEvent(new KeyboardEvent('keydown',  { key: ch, code: 'Key' + ch.toUpperCase(), charCode: ch.charCodeAt(0), keyCode: ch.charCodeAt(0), bubbles: true }));
      ta.dispatchEvent(new KeyboardEvent('keypress', { key: ch, code: 'Key' + ch.toUpperCase(), charCode: ch.charCodeAt(0), keyCode: ch.charCodeAt(0), bubbles: true }));
      ta.dispatchEvent(new KeyboardEvent('keyup',    { key: ch, code: 'Key' + ch.toUpperCase(), charCode: ch.charCodeAt(0), keyCode: ch.charCodeAt(0), bubbles: true }));
    }
    // Press Enter
    ta.dispatchEvent(new KeyboardEvent('keydown',  { key: 'Enter', code: 'Enter', keyCode: 13, charCode: 13, bubbles: true }));
    ta.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, charCode: 13, bubbles: true }));
    ta.dispatchEvent(new KeyboardEvent('keyup',    { key: 'Enter', code: 'Enter', keyCode: 13, charCode: 13, bubbles: true }));
    return 'ok';
  `;
  const result = await evalFn(Runtime, expr);
  if (result === 'no_textarea') {
    throw new Error('xterm textarea not found — terminal may not be visible');
  }
  return result;
}

// ─── Codex file changes / diff reader (Epic 5) ───────────────────────────────
//
// Reads the diff/code changes panel in Codex Desktop. The panel is a 450px
// sliding overlay (opacity:0 = hidden, opacity:1 = visible) that shows
// unstaged/staged file changes. Also scans assistant messages for inline
// code blocks containing file modifications.
//
// Returns: [{ file?: string, content: string, type: 'diff'|'inline' }]

const READ_CODEX_FILE_CHANGES_EXPR = `
  var results = [];
  var seen = {};

  function pushResult(entry) {
    if (!entry) return;
    var key = (entry.file || '') + '::' + (entry.summary || '') + '::' + (entry.content || '');
    if (seen[key]) return;
    seen[key] = true;
    results.push(entry);
  }

  // Strategy 0: Read compact inline diff cards, which match the visible
  // Codex Desktop "Review changes" summaries even when no full diff is expanded.
  var diffCards = Array.from(d.querySelectorAll('[class*="group/file-diff"]'));
  for (var di = 0; di < diffCards.length; di++) {
    var card = diffCards[di];
    var btn = card.querySelector('button[data-state]');
    var spans = btn ? Array.from(btn.querySelectorAll('span')).map(function(s) {
      return (s.innerText || s.textContent || '').trim();
    }).filter(Boolean) : [];
    var file = spans.find(function(t) { return /[\\\\/]/.test(t); })
      || spans.sort(function(a, b) { return b.length - a.length; })[0]
      || null;
    var statWrap = card.querySelector('[data-thread-find-skip="true"]');
    var statSpans = statWrap ? Array.from(statWrap.querySelectorAll('span')).map(function(s) {
      return (s.innerText || s.textContent || '').trim();
    }).filter(Boolean) : [];
    var expanded = card.querySelector('pre, code');
    pushResult({
      file: file,
      content: expanded ? expanded.textContent.trim().substring(0, 8000) : '',
      summary: statSpans.join(' ') || null,
      type: 'diff'
    });
  }

  // Strategy 1: Read from the Codex Desktop diff panel (main-surface z-30)
  var diffPanel = null;
  var candidates = d.querySelectorAll('[class*="main-surface"]');
  for (var i = 0; i < candidates.length; i++) {
    var cand = candidates[i];
    if ((cand.className || '').includes('z-30')) { diffPanel = cand; break; }
  }
  if (diffPanel) {
    var panelOpacity = getComputedStyle(diffPanel).opacity;
    var isVisible = panelOpacity !== '0' && getComputedStyle(diffPanel).pointerEvents !== 'none';

    // Read file items from the panel if it has content
    var fileHeaders = diffPanel.querySelectorAll('[class*="font-medium"], [class*="file-name"], th, [class*="filename"]');
    for (var fi = 0; fi < fileHeaders.length; fi++) {
      var headerText = (fileHeaders[fi].textContent || '').trim();
      if (headerText && headerText !== 'Unstaged' && headerText !== 'Staged' && headerText.length < 200) {
        // Look for associated diff content
        var parent = fileHeaders[fi].closest('[class*="overflow-hidden"]') || fileHeaders[fi].parentElement;
        var codeContent = parent ? parent.querySelector('pre, code, [class*="diff"]') : null;
        pushResult({
          file: headerText,
          content: codeContent ? codeContent.textContent.trim().substring(0, 8000) : '',
          summary: null,
          type: 'diff',
          panelVisible: isVisible
        });
      }
    }

    // If no individual files found but panel has content, grab the raw text
    if (results.length === 0 && isVisible) {
      var panelText = diffPanel.textContent.trim();
      if (panelText && !panelText.includes('No unstaged changes')) {
        pushResult({
          file: null,
          content: panelText.substring(0, 8000),
          summary: null,
          type: 'diff',
          panelVisible: true
        });
      }
    }
  }

  // Strategy 2: Read code blocks from assistant messages that look like file changes
  var units = Array.from(d.querySelectorAll('[data-content-search-unit-key]'));
  var assistantUnits = units.filter(function(u) {
    return (u.getAttribute('data-content-search-unit-key') || '').endsWith(':assistant');
  });
  var recentUnits = assistantUnits.slice(-5);
  for (var j = 0; j < recentUnits.length; j++) {
    var unit = recentUnits[j];
    var preBlocks = Array.from(unit.querySelectorAll('pre'));
    for (var k = 0; k < preBlocks.length; k++) {
      var pre = preBlocks[k];
      var text = pre.textContent.trim();
      if (!text || text.length < 10) continue;
      // Check if this looks like a file change (has +/- diff markers or file path header)
      if (/^(---|\\+\\+\\+|@@|diff )/.test(text) || /^[+-]\\s/.test(text.split('\\n')[1] || '')) {
        var fileMatch = text.match(/^(?:---|\\+\\+\\+)\\s+(?:a\\/|b\\/)?(.+)/m);
        pushResult({
          file: fileMatch ? fileMatch[1] : null,
          content: text.substring(0, 8000),
          summary: null,
          type: 'inline'
        });
      }
    }
  }

  return JSON.stringify(results);
`;

async function readCodexFileChanges(Runtime, usePageEval) {
  try {
    const evalFn = usePageEval ? evalInPage : evalInFrame;
    const raw = await evalFn(Runtime, READ_CODEX_FILE_CHANGES_EXPR);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

// ─── Codex image/file injection (Epic 6) ──────────────────────────────────────
//
// Injects an image into the Codex Desktop composer via the hidden file input
// or clipboard paste simulation. The Codex Desktop has:
// - input[type="file"][multiple] (hidden) — accepts any file type
// - button[aria-label="Add files and more"] — triggers the file input
// - .ProseMirror[contenteditable] — paste target for clipboard events
//
// For remote injection, we use DataTransfer API to simulate a paste event
// on the ProseMirror editor with the base64-decoded image data.

async function injectCodexImage(Runtime, base64Data, mimeType, filename, usePageEval) {
  const evalFn = usePageEval ? evalInPage : evalInFrame;
  try {
    const raw = await evalFn(Runtime, `
      (function() {
        var base64 = ${JSON.stringify(base64Data)};
        var mime = ${JSON.stringify(mimeType || 'image/png')};
        var fname = ${JSON.stringify(filename || 'image.png')};

        // Decode base64 to binary
        var binary = atob(base64);
        var bytes = new Uint8Array(binary.length);
        for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        var blob = new Blob([bytes], { type: mime });
        var file = new File([blob], fname, { type: mime });

        function visible(el) {
          if (!el) return false;
          var cs = getComputedStyle(el);
          if (!cs || cs.display === 'none' || cs.visibility === 'hidden') return false;
          var r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        }

        function attachmentAccepted() {
          var bodyText = (d.body && (d.body.innerText || d.body.textContent) || '');
          if (bodyText.indexOf(fname) >= 0) return true;

          var fileInput = d.querySelector('input[type="file"]');
          if (fileInput && fileInput.files && fileInput.files.length > 0) {
            for (var fi = 0; fi < fileInput.files.length; fi++) {
              if ((fileInput.files[fi] && fileInput.files[fi].name) === fname) return true;
            }
          }

          var chips = Array.from(d.querySelectorAll('button, div, span, li')).filter(function(el) {
            if (!visible(el)) return false;
            var text = (el.textContent || '').trim();
            if (!text || text.length > 240) return false;
            if (text.indexOf(fname) >= 0) return true;
            // Some Codex builds display generic image chips without the full filename.
            return /image|attachment|uploaded|paste/i.test(text) && !!el.closest('form,[role="textbox"],.ProseMirror');
          });
          if (chips.length > 0) return true;

          var blobs = d.querySelectorAll('img[src^="blob:"], [style*="blob:"]');
          return blobs.length > 0;
        }

        function setFilesOnInput(input, files) {
          try {
            var desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files');
            if (desc && desc.set) desc.set.call(input, files);
            else input.files = files;
          } catch (e) {
            try { input.files = files; } catch (_) {}
          }
        }

        // Strategy 1: Set files on the hidden file input and dispatch both input/change.
        // This tends to be more reliable than synthetic paste for the Codex webview.
        var fileInput = d.querySelector('input[type="file"]');
        if (fileInput) {
          var dt2 = new DataTransfer();
          dt2.items.add(file);
          setFilesOnInput(fileInput, dt2.files);
          fileInput.dispatchEvent(new Event('input', { bubbles: true }));
          fileInput.dispatchEvent(new Event('change', { bubbles: true }));
          if (attachmentAccepted()) {
            return JSON.stringify({ ok: true, method: 'file-input' });
          }
        }

        // Strategy 2: Dispatch paste event with DataTransfer on ProseMirror editor
        var editor = d.querySelector('.ProseMirror[contenteditable="true"], [contenteditable="true"][role="textbox"]');
        if (editor) {
          try { editor.focus(); } catch (e) {}
          var dt = new DataTransfer();
          dt.items.add(file);
          var pasteEvent = new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            clipboardData: dt
          });
          editor.dispatchEvent(pasteEvent);
          editor.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertFromPaste',
            dataTransfer: dt
          }));
          if (attachmentAccepted()) {
            return JSON.stringify({ ok: true, method: 'paste-event' });
          }
          return JSON.stringify({ ok: false, detail: 'paste-not-accepted' });
        }

        return JSON.stringify({ ok: false, detail: 'no-editor-or-input' });
      })()
    `);
    try { return JSON.parse(raw); } catch { return { ok: false, detail: 'eval-failed' }; }
  } catch (e) {
    return { ok: false, detail: e.message };
  }
}

// ─── Codex rate limit detection ───────────────────────────────────────────────
//
// Scans the Codex webview for rate limit messaging and extracts the datetime
// string shown by the OpenAI Codex extension (e.g. "Try again after 3:00 PM"
// or "Resets on March 15 at 3:00 PM").  Returns null when not rate-limited.

const READ_CODEX_RATE_LIMIT_EXPR = `
  function isVisible(el) {
    if (!el || el.offsetParent === null) return false;
    var cs = getComputedStyle(el);
    return cs && cs.visibility !== 'hidden' && cs.display !== 'none';
  }

  function normalizeText(text) {
    return (text || '').replace(/\\s+/g, ' ').trim();
  }

  function extractUntil(text) {
    if (!text) return null;
    var isoMatch = text.match(/\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}/);
    if (isoMatch) return isoMatch[0];

    var afterMatch = text.match(/(?:after|until|at)\\s+([\\d]{1,2}:[\\d]{2}(?::[\\d]{2})?(?:\\s*(?:AM|PM|UTC|GMT|[A-Z]{2,4}))?)/i);
    if (afterMatch) return afterMatch[1].trim();

    var dateMatch = text.match(/(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\s+\\d{1,2}(?:,?\\s+\\d{4})?(?:[,\\s]+(?:at\\s+)?)?\\d{1,2}:\\d{2}(?::[\\d]{2})?\\s*(?:AM|PM|UTC|GMT)?/i);
    if (dateMatch) return dateMatch[0].trim();

    return null;
  }

  var rateWordPat = /rate.?limit|usage.?limit|too many requests|blocked until|available after|quota exceeded|hit your.*limit/i;
  var resetWordPat = /try again after|available after|reset(s)? (on|at|after)|blocked until|quota exceeded|upgrade to|purchase more/i;
  var conv = d.querySelector('[data-thread-find-target="conversation"]');

  // Strategy 1: Scan for live banner/status UI OUTSIDE the conversation.
  // These elements disappear when the rate limit clears.
  var candidates = Array.from(d.querySelectorAll(
    '[role="alert"], [role="status"], [aria-live], [class*="warning"], [class*="error"], [class*="alert"], [class*="notice"], [class*="banner"], button, div, span, p'
  )).filter(function(el) {
    if (!isVisible(el)) return false;
    if (conv && conv.contains(el)) return false;
    if (el.closest && el.closest('[data-thread-find-target="conversation"], pre, code')) return false;
    var text = normalizeText(el.innerText || el.textContent || '');
    if (!text || text.length < 8 || text.length > 240) return false;
    if (!rateWordPat.test(text)) return false;
    return resetWordPat.test(text);
  });

  // Strategy 2: Check if the LAST visible message in the conversation is a
  // "usage limit" message. Only triggers if it's the final message (not
  // followed by newer messages, which would mean the limit cleared).
  if (candidates.length === 0 && conv) {
    var lastChild = conv.lastElementChild;
    while (lastChild && lastChild.lastElementChild) lastChild = lastChild.lastElementChild;
    // Walk back up to find a text-bearing element
    var el = lastChild;
    for (var ci = 0; ci < 5 && el && el !== conv; ci++) {
      var ct = normalizeText(el.textContent || '');
      if (ct.length > 20 && /hit your.*limit|usage.?limit.*upgrade/i.test(ct) && ct.length < 240) {
        candidates.push(el);
        break;
      }
      el = el.parentElement;
    }
  }

  if (candidates.length === 0) return null;

  // Prefer the shortest matching banner/status text to avoid container over-capture.
  candidates.sort(function(a, b) {
    var at = normalizeText(a.innerText || a.textContent || '');
    var bt = normalizeText(b.innerText || b.textContent || '');
    return at.length - bt.length;
  });

  var bestText = normalizeText(candidates[0].innerText || candidates[0].textContent || '');
  return JSON.stringify({ rate_limited: true, until_text: extractUntil(bestText) });
`;

async function readCodexRateLimit(Runtime, usePageEval) {
  try {
    const raw = usePageEval
      ? await evalInPage(Runtime, READ_CODEX_RATE_LIMIT_EXPR)
      : await evalInFrame(Runtime, READ_CODEX_RATE_LIMIT_EXPR);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ─── Antigravity rate limit detection ────────────────────────────────────────
//
// Detects rate-limited models in the Antigravity Manager page by finding yellow
// warning SVG triangles (fill-yellow-200 class = Heroicons exclamation-triangle).
// These appear next to model names in the model picker dialog that stays in DOM
// even when aria-expanded="false".
//
// Also reads the currently-active model from the toolbar button so we can report
// rate_limited=true only when the session's active model is affected.
//
// Tooltip content (reset datetime) is linked via data-tooltip-id on the SVG's
// parent div — we query the portal-rendered tooltip element by that ID.
//
// Returns { rate_limited: true, until_text: string|null } or null.

const READ_ANTIGRAVITY_RATE_LIMIT_EXPR = `
  // --- Find all rate-limited model names via yellow warning SVGs ---
  var warnSvgs = Array.from(d.querySelectorAll('svg[class*="fill-yellow-200"]'));
  if (warnSvgs.length === 0) return null;

  var rateLimitedModels = [];
  warnSvgs.forEach(function(svg) {
    // Parent of SVG is the data-tooltip-id container
    var tooltipContainer = svg.parentElement;
    var tooltipId = tooltipContainer ? tooltipContainer.getAttribute('data-tooltip-id') : null;

    // Grandparent is the flex row: flex items-center justify-start gap-2
    // That row also contains the model name span
    var row = tooltipContainer ? tooltipContainer.parentElement : null;
    var modelName = null;
    if (row) {
      // Model name is in: <span class="text-xs font-medium"><span>NAME</span></span>
      var nameSpan = row.querySelector('span span');
      if (nameSpan) modelName = nameSpan.textContent.trim();
    }

    // Attempt to read tooltip text (reset datetime) from portal element
    var resetText = null;
    if (tooltipId) {
      var tooltipEl = d.getElementById(tooltipId);
      if (tooltipEl) resetText = tooltipEl.textContent.replace(/\\s+/g, ' ').trim().substring(0, 300);
    }

    if (modelName) rateLimitedModels.push({ model: modelName, reset_text: resetText || null });
  });

  if (rateLimitedModels.length === 0) return null;

  // --- Read the currently-active model from the toolbar button ---
  var activeModel = null;
  var modelBtns = Array.from(d.querySelectorAll('[role="button"][aria-haspopup="dialog"]'));
  for (var i = 0; i < modelBtns.length; i++) {
    var t = (modelBtns[i].innerText || '').trim();
    if (t && t !== 'Planning' && t !== 'Fast' && /gemini|claude|gpt|sonnet|opus|flash|pro/i.test(t) && t.length < 100) {
      // The button innerText is "MODEL_NAME\\n..." — take first non-empty line
      var lines = t.split('\\n').map(function(l){ return l.trim(); }).filter(Boolean);
      if (lines.length > 0) { activeModel = lines[0]; break; }
    }
  }

  // Check if active model is in the rate-limited list (case-insensitive substring match)
  var activeEntry = null;
  if (activeModel) {
    var al = activeModel.toLowerCase();
    for (var j = 0; j < rateLimitedModels.length; j++) {
      var ml = rateLimitedModels[j].model.toLowerCase();
      if (ml === al || ml.includes(al) || al.includes(ml)) { activeEntry = rateLimitedModels[j]; break; }
    }
  }
  // If we can't identify the active model, flag rate-limited if any model is
  if (!activeEntry && !activeModel) activeEntry = rateLimitedModels[0];

  if (!activeEntry) {
    // Other models are rate-limited but not the active one — not flagging
    return JSON.stringify({ rate_limited: false, rate_limited_models: rateLimitedModels });
  }

  // --- Extract reset datetime from tooltip text ---
  var resetText = activeEntry.reset_text || '';
  var until_text = null;

  var isoMatch = resetText.match(/\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}/);
  if (isoMatch) { until_text = isoMatch[0]; }

  if (!until_text) {
    var afterMatch = resetText.match(/(?:after|until|at)\\s+([\\d]{1,2}:[\\d]{2}(?::[\\d]{2})?(?:\\s*(?:AM|PM|UTC|GMT|[A-Z]{2,4}))?)/i);
    if (afterMatch) until_text = afterMatch[1].trim();
  }

  if (!until_text) {
    var dateMatch = resetText.match(/(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\s+\\d{1,2}(?:,?\\s+\\d{4})?(?:\\s+at)?\\s+\\d{1,2}:\\d{2}(?:[:\\d]{3})?\\s*(?:AM|PM|UTC|GMT)?/i);
    if (dateMatch) until_text = dateMatch[0].trim();
  }

  // If tooltip had text but no parseable time, use it raw (truncated)
  if (!until_text && resetText) until_text = resetText.substring(0, 100);

  return JSON.stringify({ rate_limited: true, until_text: until_text, model: activeEntry.model });
`;

const READ_ANTIGRAVITY_MODEL_QUOTA_EXPR = `
  function cleanText(text) {
    return String(text || '').replace(/\\s+/g, ' ').trim();
  }

  function rectWidth(el) {
    if (!el || !el.getBoundingClientRect) return 0;
    var rect = el.getBoundingClientRect();
    return rect && rect.width ? rect.width : 0;
  }

  var pageText = d.body ? (d.body.innerText || '') : '';
  if (pageText.indexOf('MODEL QUOTA') === -1) return null;

  var creditsMatch = pageText.match(/Available AI Credits:\\s*(\\d+)/i);
  var availableCredits = creditsMatch ? parseInt(creditsMatch[1], 10) : null;

  var quotaRows = Array.from(d.querySelectorAll('.py-3')).filter(function(row) {
    return /Refreshes in/i.test(row.innerText || '');
  });

  var models = quotaRows.map(function(row) {
    var header = row.querySelector('.flex.items-center.justify-between.mb-2');
    if (!header) return null;
    var children = Array.from(header.children || []);
    var modelName = children.length > 0 ? cleanText(children[0].innerText || children[0].textContent || '') : '';
    var refreshText = children.length > 1 ? cleanText(children[1].innerText || children[1].textContent || '') : '';
    refreshText = refreshText.replace(/^Refreshes in\\s*/i, '').trim();
    if (!modelName) return null;

    var segments = Array.from(row.querySelectorAll('div')).filter(function(el) {
      var cls = String(el.className || '');
      return cls.indexOf('flex-1') >= 0 &&
        cls.indexOf('h-1') >= 0 &&
        cls.indexOf('overflow-hidden') >= 0 &&
        cls.indexOf('bg-gray-500/20') >= 0;
    });
    var totalWidth = 0;
    var filledWidth = 0;
    var color = null;
    for (var i = 0; i < segments.length; i++) {
      totalWidth += rectWidth(segments[i]);
      var fill = segments[i].firstElementChild;
      if (fill) {
        filledWidth += rectWidth(fill);
        if (!color && rectWidth(fill) > 0) color = getComputedStyle(fill).backgroundColor;
      }
    }
    var percentRemaining = totalWidth > 0 ? Math.round((filledWidth / totalWidth) * 100) : null;
    var percentUsed = percentRemaining == null ? null : Math.max(0, Math.min(100, 100 - percentRemaining));
    return {
      model: modelName,
      refreshes_in: refreshText || null,
      percent_used: percentUsed,
      color: color || null,
    };
  }).filter(Boolean);

  return JSON.stringify({
    available_ai_credits: availableCredits,
    models: models,
    fetched_at: new Date().toISOString(),
  });
`;

const REFRESH_ANTIGRAVITY_MODEL_QUOTA_EXPR = `
  function cleanText(text) {
    return String(text || '').replace(/\\s+/g, ' ').trim();
  }

  var refreshButton = Array.from(d.querySelectorAll('button')).find(function(button) {
    return cleanText(button.innerText || button.textContent || '').toLowerCase() === 'refresh';
  });
  if (!refreshButton) {
    return JSON.stringify({ ok: false, code: 'refresh_button_not_found' });
  }
  if (refreshButton.disabled) {
    return JSON.stringify({ ok: false, code: 'refresh_button_disabled' });
  }

  refreshButton.click();
  return JSON.stringify({
    ok: true,
    clicked_at: new Date().toISOString(),
  });
`;

// ─── Claude rate limit detection (A12-03 stub) ───────────────────────────────
//
// STUB: Claude Code's rate limit notification primarily surfaces in the VS Code
// status bar and native notification toast — outside the extension webview iframe.
// This text-scan checks if Claude Code echoes any rate limit feedback into the
// chat itself (e.g. "Claude AI is currently rate limited", "usage limit reached").
//
// The selectors here are best-guesses. Fill in confirmed selectors after
// observing a live rate-limited Claude Code session via CDP.
//
// Returns { rate_limited: true, until_text: string|null } or null.

// STUB: DOM-first detection only — text scanning is disabled until we can
// observe a live rate-limited Claude Code session and confirm which elements
// actually appear.  The bannerEl selector list is the only trigger so that
// incidental text matches (e.g. "overloaded" in a code comment, timestamps
// in transcript messages) don't produce false positives.
//
// Claude Code usage warning banner: class like "banner_XXXX" with text
// "You've used NN% of your session limit · resets in Xh"
const READ_CLAUDE_RATE_LIMIT_EXPR = `
  function isActuallyVisible(el) {
    if (!el || el.offsetParent === null) return false;
    var cs = getComputedStyle(el);
    if (!cs || cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    var r = el.getBoundingClientRect();
    if (!r || r.width < 4 || r.height < 4) return false;
    var vh = window.innerHeight || document.documentElement.clientHeight || 0;
    var vw = window.innerWidth || document.documentElement.clientWidth || 0;
    return r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw;
  }

  // Match by class prefix (hash suffix changes between builds)
  var bannerEl = null;
  var candidates = d.querySelectorAll('[class*="banner_"]');
  for (var i = 0; i < candidates.length; i++) {
    var t = (candidates[i].textContent || '').trim();
    if ((t.indexOf('session limit') >= 0 || t.indexOf('usage') >= 0) && isActuallyVisible(candidates[i])) {
      bannerEl = candidates[i];
      break;
    }
  }
  if (!bannerEl) return null;

  var bannerText = bannerEl.textContent || '';

  // Extract percentage: "You've used 93% of your session limit"
  var pctMatch = bannerText.match(/(\\d+)%/);
  var pct = pctMatch ? parseInt(pctMatch[1], 10) : null;

  // Extract reset time: "resets in 1h", "resets in 30m", "resets in 2h 15m"
  var resetMatch = bannerText.match(/resets\\s+in\\s+([\\dhmins ]+)/i);
  var resetText = resetMatch ? resetMatch[1].trim() : null;

  // Only flag as rate_limited if at 100% or banner contains explicit limit text
  var isHardLimited = pct >= 100 || bannerText.indexOf('limit reached') >= 0 || bannerText.indexOf('rate limited') >= 0;
  return JSON.stringify({ rate_limited: isHardLimited, percent_used: pct, until_text: resetText });
`;

async function readClaudeRateLimit(Runtime) {
  try {
    const raw = await evalInFrame(Runtime, READ_CLAUDE_RATE_LIMIT_EXPR);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ─── Codex native queue detection ─────────────────────────────────────────────
//
// Reads the native queue (messages waiting with Steer buttons) from the Codex
// side-panel DOM. These are messages typed/sent while the agent was busy.
// The queue container has class "vertical-scroll-fade-mask" with child items
// having class "overflow-visible" containing text + Steer button.
//
// Returns array of { text: string, index: number } or empty array.

const READ_CODEX_NATIVE_QUEUE_EXPR = `
  var steerBtns = [];
  var btns = d.querySelectorAll('button');
  for (var i = 0; i < btns.length; i++) {
    if (btns[i].textContent.trim() === 'Steer') steerBtns.push(btns[i]);
  }
  if (steerBtns.length === 0) return null;
  var items = [];
  for (var i = 0; i < steerBtns.length; i++) {
    var container = steerBtns[i].closest('.overflow-visible') || steerBtns[i].parentElement;
    var textEl = container.querySelector('[class*="text-size-chat"]');
    var text = textEl ? textEl.textContent.trim() : container.textContent.replace('Steer', '').trim();
    if (text) items.push({ text: text, index: i });
  }
  return JSON.stringify(items);
`;

async function readCodexNativeQueue(Runtime, usePageEval) {
  try {
    const evalFn = usePageEval ? evalInPage : evalInFrame;
    const raw = await evalFn(Runtime, READ_CODEX_NATIVE_QUEUE_EXPR);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

// ─── Codex task list detection ────────────────────────────────────────────────
//
// Reads the plan/task list from Codex Desktop or Codex extension.
// Header: SPAN matching /\d+ out of \d+ tasks completed/
// Items: div[id^="plan-item-"] with number + icon + description span.
// States: animate-spin = in_progress, SVG path M10 2.9032 = pending, else = completed.
//
// Returns { completed, total, tasks: [{ index, text, state }] } or null.

async function readCodexTaskList(Runtime, usePageEval) {
  const evalFn = usePageEval ? evalInPage : evalInFrame;
  const raw = await evalFn(Runtime, `
    // Find task list header — supports multiple formats:
    //   "X out of Y tasks completed"  (old format)
    //   "N tasks in progress"         (new format)
    //   "N task in progress"          (singular)
    // NOTE: use [0-9] instead of \\d — \\d gets mangled through the multiple
    // escaping layers (Node template literal → evalInFrame wrapper → CDP evaluate).
    var header = null;
    var headerText = '';
    var spans = d.querySelectorAll('span');
    for (var i = 0; i < spans.length; i++) {
      var st = (spans[i].textContent || '').trim();
      if (/[0-9]+ out of [0-9]+ tasks/.test(st) || /[0-9]+\\s+tasks?\\s+(in progress|completed)/i.test(st)) {
        header = spans[i];
        headerText = st;
        break;
      }
    }

    var planItems = d.querySelectorAll('div[id^="plan-item-"]');
    // Bail only if we have neither a header nor plan items
    if (!header && planItems.length === 0) return null;

    // Parse header for counts
    var completedCount = 0;
    var totalCount = 0;
    var outOfMatch = headerText.match(/([0-9]+) out of ([0-9]+)/);
    if (outOfMatch) {
      completedCount = parseInt(outOfMatch[1]);
      totalCount = parseInt(outOfMatch[2]);
    } else {
      var inProgressMatch = headerText.match(/([0-9]+)\\s+tasks?\\s+in progress/i);
      if (inProgressMatch) {
        // "N tasks in progress" — inProgress count, total comes from plan items
        totalCount = planItems.length || parseInt(inProgressMatch[1]);
      }
    }

    if (planItems.length === 0) return null;

    var tasks = [];
    for (var j = 0; j < planItems.length; j++) {
      var item = planItems[j];
      var rect = item.getBoundingClientRect();
      if (rect.height <= 0) continue;
      // Second child is the task description span (first child is the number+icon)
      var descSpan = item.children.length > 1 ? item.children[1] : null;
      var text = descSpan ? descSpan.textContent.trim() : item.textContent.trim().replace(/^[0-9]+\\.\\s*/, '');
      var hasSpinner = !!item.querySelector('[class*="animate-spin"]');
      var hasLineThrough = descSpan ? (descSpan.className || '').toString().indexOf('line-through') >= 0 : false;
      // Also check for checkmark/completed indicators
      var hasCheck = !!item.querySelector('[class*="text-green"], svg[class*="check"], [data-state="checked"]');
      var state = hasSpinner ? 'in_progress' : (hasLineThrough || hasCheck) ? 'completed' : 'pending';
      tasks.push({ index: j, text: text, state: state });
    }
    // Mark completed tasks based on header count (Codex marks first N as completed)
    if (completedCount > 0) {
      for (var k = 0; k < tasks.length; k++) {
        if (tasks[k].state === 'pending' && k < completedCount) tasks[k].state = 'completed';
      }
    }
    if (!totalCount) totalCount = tasks.length;
    var actualCompleted = tasks.filter(function(t) { return t.state === 'completed'; }).length;
    return JSON.stringify({ completed: actualCompleted, total: totalCount, tasks: tasks });
  `);
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

// ─── Generic rate limit detection (Claude, Gemini, Antigravity) ───────────────
//
// - claude:      text-scan of webview body (stub — selectors need live validation)
// - codex:       text-scan of webview body (reuses READ_CODEX_RATE_LIMIT_EXPR)
// - gemini:      text-scan of webview body (same pattern, different false-positive risk)
// - antigravity: SVG-based detection (yellow warning triangle in model picker)
//
// Returns { rate_limited: boolean, until_text: string|null } or null.

async function readRateLimit(Runtime, agentType) {
  if (agentType === 'codex' || agentType === 'codex-desktop') return readCodexRateLimit(Runtime, agentType === 'codex-desktop');
  if (agentType === 'claude' || agentType === 'claude-desktop') return readClaudeRateLimit(Runtime);
  if (isContinueAgentType(agentType)) return null; // Continue agents use local models — no rate limiting
  if (agentType === 'antigravity' || agentType === 'antigravity_panel') {
    try {
      const raw = await evalInPage(Runtime, READ_ANTIGRAVITY_RATE_LIMIT_EXPR);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  // gemini: text-scan fallback
  try {
    const raw = await evalInFrame(Runtime, READ_CODEX_RATE_LIMIT_EXPR);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ─── Agent config reading (A3-09) ─────────────────────────────────────────────
//
// Reads the current model name and permission mode from the Claude Code
// webview DOM.  Best-effort — returns 'unknown' for fields it can't find.
//
// Claude Code shows:
//   - A model selector button whose text contains "claude-..." or "Claude"
//   - A permission indicator in settings or a header chip (e.g. "bypassPermissions")
//
// We probe broadly and use pattern matching rather than fixed class names
// so the function survives minor Claude Code extension version bumps.

const READ_AGENT_CONFIG_EXPR = `
  var config = { model_id: null, permission_mode: null };

  // ── Permission mode ─────────────────────────────────────────────────────────
  // Claude Code 2.x stores the current permission mode in data-permission-mode
  // on the composer fieldset — most reliable source.
  var fieldset = d.querySelector('fieldset[data-permission-mode]');
  if (fieldset) {
    config.permission_mode = fieldset.getAttribute('data-permission-mode');
  } else {
    // Fallback: body text scan for known permission mode strings
    var allText = (d.body ? d.body.innerText : '').substring(0, 8000);
    if (/bypassPermissions/i.test(allText)) config.permission_mode = 'bypassPermissions';
    else if (/autoApprove/i.test(allText))  config.permission_mode = 'autoApprove';
    else if (/default/i.test(allText) && /permission/i.test(allText)) config.permission_mode = 'default';
  }

  return JSON.stringify(config);
`;

// Returns { model_id, permission_mode, file_access_scope, [effort] } or null on error.
// Fields are 'unknown' when not detected.
async function readAgentConfig(Runtime, agentType, workspacePath) {
  if (agentType === 'antigravity' || agentType === 'antigravity_panel') return readAntigravityConfig(Runtime, workspacePath);
  if (isContinueAgentType(agentType)) {
    try {
      console.log('[continue-focus] config read:start');
      const raw = await evalInFrame(Runtime, `
        function norm(t) {
          return String(t || '').replace(/\\s+/g, ' ').trim();
        }
        function rectBottom(el) {
          if (!el || !el.getBoundingClientRect) return -1;
          var rect = el.getBoundingClientRect();
          return rect.bottom || (rect.top + rect.height) || -1;
        }
        function hasVisibleBox(el) {
          if (!el || !el.getBoundingClientRect) return false;
          var rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }
        function isVisible(el) {
          if (!el || !hasVisibleBox(el)) return false;
          var style = window.getComputedStyle ? window.getComputedStyle(el) : null;
          if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) return false;
          return true;
        }
        function keepModelText(t) {
          return t &&
            t.length < 120 &&
            !/^Models?$/i.test(t) &&
            !/^Add Chat model$/i.test(t) &&
            !/^Ctrl/i.test(t) &&
            !/^Select model$/i.test(t) &&
            !/to toggle model$/i.test(t);
        }
        function pickActiveToolbar() {
          var toolbars = Array.from(d.querySelectorAll('.find-widget-skip')).filter(function(el) {
            return isVisible(el) && (
              el.querySelector('[data-testid="model-select-button"]') ||
              /Bypass permissions|Ask for permissions?|Ask for permission/i.test(norm(el.textContent))
            );
          });
          if (!toolbars.length) return null;
          toolbars.sort(function(a, b) { return rectBottom(b) - rectBottom(a); });
          return toolbars[0];
        }
        function pickVisibleControl(root, selector) {
          var searchRoot = root || d;
          var candidates = Array.from(searchRoot.querySelectorAll(selector)).filter(isVisible);
          if (!candidates.length && searchRoot !== d) {
            candidates = Array.from(d.querySelectorAll(selector)).filter(isVisible);
          }
          if (!candidates.length) return searchRoot.querySelector(selector) || d.querySelector(selector);
          candidates.sort(function(a, b) { return rectBottom(b) - rectBottom(a); });
          return candidates[0];
        }
        function collectVisibleModels() {
          var opts = Array.from(d.querySelectorAll('div[class*="option"], [role="option"], [role="menuitem"], [role="menuitemradio"], [cmdk-item], .truncate'));
          var models = [];
          for (var i = 0; i < opts.length; i++) {
            var opt = opts[i];
            var textEl = opt.querySelector ? (opt.querySelector('.truncate, span, div') || opt) : opt;
            var t = norm(textEl && textEl.textContent ? textEl.textContent : opt.textContent);
            if (!keepModelText(t)) continue;
            var visible = isVisible(opt);
            if (!visible && opt.parentElement) visible = isVisible(opt.parentElement);
            if (visible && !models.includes(t)) models.push(t);
          }
          return models;
        }
        function detectPermissionModeFromUi(root) {
          var searchRoots = [];
          if (root) searchRoots.push(root);
          searchRoots.push(d.body || d);
          for (var sr = 0; sr < searchRoots.length; sr++) {
            var scope = searchRoots[sr];
            if (!scope) continue;
            var candidates = Array.from(scope.querySelectorAll('button, [role="button"], .text-description, .find-widget-skip, div'));
            for (var i = 0; i < candidates.length; i++) {
              var text = norm(candidates[i] && candidates[i].textContent);
              if (!text) continue;
              if (/^Bypass permissions$/i.test(text)) return 'bypass';
              if (/^Ask for permissions?$/i.test(text)) return 'ask';
            }
          }
          var bodyText = norm(d.body && d.body.innerText);
          if (/Bypass permissions/i.test(bodyText)) return 'bypass';
          if (/Ask for permissions?/i.test(bodyText)) return 'ask';
          return 'unknown';
        }
        var activeToolbar = pickActiveToolbar();
        var btn = pickVisibleControl(activeToolbar, '[data-testid="model-select-button"]');
        var modeBtn = pickVisibleControl(activeToolbar, '[data-testid="mode-select-button"]');
        var permissionMode = 'unknown';
        try {
          permissionMode = (window.localStorage && window.localStorage.getItem('permissionMode')) || 'unknown';
        } catch {}
        if (permissionMode === 'unknown') {
          permissionMode = detectPermissionModeFromUi(activeToolbar);
        }
        if (!btn) {
          return JSON.stringify({
            model: 'unknown',
            mode: modeBtn ? (modeBtn.textContent || '').trim() : 'unknown',
            permission_mode: permissionMode,
            available_models: []
          });
        }
        var model_id = btn.textContent.trim();
        var mode = modeBtn ? (modeBtn.textContent || '').trim() : 'unknown';
        var existingModels = collectVisibleModels();
        return JSON.stringify({
          model: model_id,
          mode: mode,
          permission_mode: permissionMode,
          available_models: existingModels
        });
      `);
      let parsed = { model: 'unknown', mode: 'unknown', permission_mode: 'unknown', available_models: [] };
      if (raw) {
        var r = JSON.parse(raw);
        parsed.model = r.model;
        parsed.mode = r.mode || 'unknown';
        parsed.permission_mode = r.permission_mode || 'unknown';
        parsed.available_models = r.available_models || [];
      }
      return {
        model_id:          parsed.model || 'unknown',
        mode:              parsed.mode || 'unknown',
        permission_mode:   parsed.permission_mode || 'unknown',
        available_models:  parsed.available_models || [],
        file_access_scope: workspacePath || 'unknown',
      };
    } catch {
      return { model_id: 'unknown', mode: 'unknown', permission_mode: 'unknown', available_models: [], file_access_scope: workspacePath || 'unknown' };
    }
  }
  if (agentType === 'gemini') {
    try {
      const raw = await evalInFrame(Runtime, `
        var sel = d.querySelector('.model-config-selector mat-select .mat-mdc-select-trigger');
        var configText = sel ? sel.textContent.trim() : null;
        var infoEl = d.querySelector('.model-info');
        var infoText = infoEl ? infoEl.textContent.trim().replace(/^Responding with\\s*/i, '') : null;
        return JSON.stringify({ config: configText, model: infoText });
      `);
      const parsed = raw ? JSON.parse(raw) : {};
      return {
        model_id:          parsed.config || parsed.model || 'unknown',
        actual_model:      parsed.model  || 'unknown',
        permission_mode:   'unknown',
        file_access_scope: workspacePath || 'unknown',
      };
    } catch {
      return { model_id: 'unknown', permission_mode: 'unknown', file_access_scope: workspacePath || 'unknown' };
    }
  }

  if (isRooCodeAgentType(agentType)) {
    try {
      const cfg = await readRooCodeConfig(Runtime);
      return {
        model_id:          cfg?.model_id        || 'unknown',
        mode:              cfg?.mode            || 'unknown',
        permission_mode:   cfg?.permission_mode || 'unknown',
        file_access_scope: workspacePath || 'unknown',
      };
    } catch {
      return { model_id: 'unknown', mode: 'unknown', permission_mode: 'unknown', file_access_scope: workspacePath || 'unknown' };
    }
  }

  if (agentType === 'codex' || agentType === 'codex-desktop') {
    const usePageEval = agentType === 'codex-desktop';
    const cfg = await readCodexConfig(Runtime, usePageEval);
    const result = {
      model_id:          cfg?.model_id  || 'unknown',
      permission_mode:   cfg?.access    || 'unknown',
      effort:            cfg?.effort    || 'unknown',
      speed:             cfg?.speed     || 'unknown',
      file_access_scope: workspacePath  || 'unknown',
    };
    // Epic 7: read sandbox status for codex-desktop
    if (agentType === 'codex-desktop') {
      try {
        const sandbox = await readCodexSandboxStatus(Runtime, true);
        if (sandbox) result.sandbox_status = sandbox;
      } catch {}
      // Epic 3: read available workspaces for codex-desktop
      try {
        const ws = await readCodexWorkspaces(Runtime, true);
        if (ws && ws.length > 0) result.available_workspaces = ws.map(w => ({ id: w.path || w.id, label: w.title, path: w.path }));
      } catch {}
    }
    return result;
  }

  try {
    const raw = await evalInFrame(Runtime, READ_AGENT_CONFIG_EXPR);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      model_id:          parsed.model_id      || 'unknown',
      permission_mode:   parsed.permission_mode || 'unknown',
      file_access_scope: workspacePath         || 'unknown',
    };
  } catch {
    return null;
  }
}

async function readContinueConfigFromWorkbench(Runtime, webviewId, workspacePath) {
  try {
    console.log(`[continue-focus] workbench config read:start webview=${webviewId || 'unknown'}`);
    const raw = await evalInWorkbenchWebview(Runtime, webviewId, `
      function norm(t) {
        return String(t || '').replace(/\\s+/g, ' ').trim();
      }
      function rectBottom(el) {
        if (!el || !el.getBoundingClientRect) return -1;
        var rect = el.getBoundingClientRect();
        return rect.bottom || (rect.top + rect.height) || -1;
      }
      function hasVisibleBox(el) {
        if (!el || !el.getBoundingClientRect) return false;
        var rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }
      function isVisible(el) {
        if (!el || !hasVisibleBox(el)) return false;
        var style = window.getComputedStyle ? window.getComputedStyle(el) : null;
        if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) return false;
        return true;
      }
      function pickActiveToolbar() {
        var toolbars = Array.from(d.querySelectorAll('.find-widget-skip')).filter(function(el) {
          return isVisible(el) && (
            el.querySelector('[data-testid="model-select-button"]') ||
            /Bypass permissions|Ask for permissions?|Ask for permission/i.test(norm(el.textContent))
          );
        });
        if (!toolbars.length) return null;
        toolbars.sort(function(a, b) { return rectBottom(b) - rectBottom(a); });
        return toolbars[0];
      }
      function pickVisibleControl(root, selector) {
        var searchRoot = root || d;
        var candidates = Array.from(searchRoot.querySelectorAll(selector)).filter(isVisible);
        if (!candidates.length && searchRoot !== d) {
          candidates = Array.from(d.querySelectorAll(selector)).filter(isVisible);
        }
        if (!candidates.length) return searchRoot.querySelector(selector) || d.querySelector(selector);
        candidates.sort(function(a, b) { return rectBottom(b) - rectBottom(a); });
        return candidates[0];
      }
      function detectPermissionModeFromUi(root) {
        var searchRoots = [];
        if (root) searchRoots.push(root);
        searchRoots.push(d.body || d);
        for (var sr = 0; sr < searchRoots.length; sr++) {
          var scope = searchRoots[sr];
          if (!scope) continue;
          var candidates = Array.from(scope.querySelectorAll('button, [role="button"], .text-description, .find-widget-skip, div'));
          for (var i = 0; i < candidates.length; i++) {
            var text = norm(candidates[i] && candidates[i].textContent);
            if (!text) continue;
            if (/^Bypass permissions$/i.test(text)) return 'bypass';
            if (/^Ask for permissions?$/i.test(text)) return 'ask';
          }
        }
        return 'unknown';
      }
      var activeToolbar = pickActiveToolbar();
      var btn = pickVisibleControl(activeToolbar, '[data-testid="model-select-button"]');
      if (!btn) return JSON.stringify({ model: 'unknown', permission_mode: detectPermissionModeFromUi(activeToolbar), available_models: [] });
      var model_id = (btn.textContent || '').trim();
      var permissionMode = 'unknown';
      try {
        permissionMode = (window.localStorage && window.localStorage.getItem('permissionMode')) || 'unknown';
      } catch {}
      if (permissionMode === 'unknown') {
        permissionMode = detectPermissionModeFromUi(activeToolbar);
      }
      return JSON.stringify({
        model: model_id,
        permission_mode: permissionMode,
        available_models: []
      });
    `);
    let parsed = { model: 'unknown', permission_mode: 'unknown', available_models: [] };
    if (raw) {
      var r = JSON.parse(raw);
      parsed.model = r.model;
      parsed.permission_mode = r.permission_mode || 'unknown';
      parsed.available_models = r.available_models || [];
    }
    return {
      model_id:          parsed.model || 'unknown',
      mode:              'unknown',
      permission_mode:   parsed.permission_mode || 'unknown',
      available_models:  parsed.available_models || [],
      file_access_scope: workspacePath || 'unknown',
    };
  } catch {
    return { model_id: 'unknown', permission_mode: 'unknown', available_models: [], file_access_scope: workspacePath || 'unknown' };
  }
}

// ─── Model selection (A3-08) ──────────────────────────────────────────────────
//
// Claude Code has a model selector button (showing current model) in the
// composer toolbar.  Clicking it opens a dropdown/listbox; clicking an
// option changes the active model.
//
// Strategy:
//   1. Find the button whose text matches the current model pattern.
//   2. Click it to open the dropdown.
//   3. Wait briefly for the option list to appear.
//   4. Click the option whose text best matches the requested model_id.
//   5. If the dropdown doesn't open or the option is missing, return an error.
//
// We don't hard-code the list of available models — we read them live from the
// dropdown so this works regardless of which models are provisioned.

const MODEL_PATTERN = /claude[-\s_]*(opus|sonnet|haiku|3|4|5)[-\s_.0-9]*/i;

// Opens the model dropdown and returns the list of available option texts.
// Returns null if no dropdown could be found.
const LIST_MODEL_OPTIONS_EXPR = `
  (function() {
    // Find the model selector button
    var modelPat = /claude[-\\s_]*(opus|sonnet|haiku|3|4|5)[-\\s_.0-9]*/i;
    var btn = null;

    // 1. aria-label match
    var allBtns = Array.from(d.querySelectorAll('button'));
    for (var i = 0; i < allBtns.length; i++) {
      var b = allBtns[i];
      var label = b.getAttribute('aria-label') || b.textContent || '';
      if (modelPat.test(label)) { btn = b; break; }
    }

    // 2. combobox / listbox role
    if (!btn) {
      var combos = Array.from(d.querySelectorAll('[role="combobox"], [role="button"]'));
      for (var i = 0; i < combos.length; i++) {
        if (modelPat.test(combos[i].textContent || '')) { btn = combos[i]; break; }
      }
    }

    if (!btn) return JSON.stringify({ error: 'no-model-btn' });

    btn.click();
    return JSON.stringify({ clicked: true, label: (btn.getAttribute('aria-label') || btn.textContent || '').trim().substring(0, 80) });
  })()
`;

const COLLECT_MODEL_OPTIONS_EXPR = `
  (function() {
    // After clicking the model button, a listbox / popover should appear.
    var opts = [];

    // Role-based
    var roleOpts = Array.from(d.querySelectorAll('[role="option"], [role="menuitem"], [role="menuitemradio"]'));
    if (roleOpts.length > 0) {
      opts = roleOpts.map(function(el) { return el.textContent.trim(); }).filter(Boolean);
    }

    // Fallback: any li / div in a visible list that looks like a model name
    if (opts.length === 0) {
      var modelPat = /claude/i;
      var items = Array.from(d.querySelectorAll('li, [class*="option"], [class*="item"], [class*="choice"]'));
      for (var i = 0; i < items.length; i++) {
        var t = items[i].textContent.trim();
        if (modelPat.test(t) && t.length < 100) opts.push(t);
      }
    }

    return JSON.stringify({ options: opts });
  })()
`;

// Click the option matching modelId in an open dropdown.
function buildModelSelectExpr(modelId) {
  return `
    (function() {
      var target = ${JSON.stringify(modelId.toLowerCase())};

      // Prefer role-based options
      var opts = Array.from(d.querySelectorAll('[role="option"], [role="menuitem"], [role="menuitemradio"]'));
      if (opts.length === 0) {
        opts = Array.from(d.querySelectorAll('li, [class*="option"], [class*="item"], [class*="choice"]'));
      }

      var best = null, bestScore = 0;
      for (var i = 0; i < opts.length; i++) {
        var t = opts[i].textContent.trim().toLowerCase();
        if (!t) continue;
        // Exact match
        if (t === target || t.replace(/\\s+/g, '-') === target) { best = opts[i]; break; }
        // Partial: target is substring of option text or vice versa
        var score = 0;
        if (t.includes(target)) score = 2;
        else if (target.includes(t.replace(/\\s+/g, '-'))) score = 1;
        if (score > bestScore) { bestScore = score; best = opts[i]; }
      }

      if (!best) return JSON.stringify({ error: 'option-not-found' });
      best.click();
      return JSON.stringify({ clicked: true, label: best.textContent.trim().substring(0, 80) });
    })()
  `;
}

// ─── Antigravity model selection ─────────────────────────────────────────────
//
// The model name in the compose toolbar is a [role="button"] div (not a <button>).
// el.click() does not fire React's synthetic events — requires CDP Input mouse events
// at real screen coordinates. InputDomain is client.Input from chrome-remote-interface.

async function setAntigravityModel(Runtime, InputDomain, modelId, sessionId) {
  // Step 1: find the model element and get its screen coordinates
  const coordsRaw = await evalInPage(Runtime, `
    // Model element is [role="button"] whose text matches a model pattern but is not "Planning"
    var modelEl = Array.from(d.querySelectorAll('[role="button"]')).find(function(el) {
      var t = el.innerText.trim();
      return t && t !== 'Planning' && /gemini|claude|gpt|sonnet|opus|flash|pro/i.test(t) && t.length < 80;
    });
    if (!modelEl) return JSON.stringify({ error: 'no_model_element' });
    var r = modelEl.getBoundingClientRect();
    return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
  `);
  const coords = JSON.parse(coordsRaw);
  if (coords.error) return { ok: false, code: coords.error };

  // Step 2: CDP mouse click to open the model picker (React synthetic events require this)
  await InputDomain.dispatchMouseEvent({ type: 'mousePressed', x: coords.x, y: coords.y, button: 'left', clickCount: 1 });
  await new Promise(r => setTimeout(r, 60));
  await InputDomain.dispatchMouseEvent({ type: 'mouseReleased', x: coords.x, y: coords.y, button: 'left', clickCount: 1 });
  await new Promise(r => setTimeout(r, 700));

  // Step 3: find the target model item in the visible dialog
  const itemCoordsRaw = await evalInPage(Runtime, `
    var dialog = Array.from(d.querySelectorAll('[role="dialog"]')).find(function(el) {
      var s = window.getComputedStyle(el);
      return s.opacity !== '0' && s.visibility !== 'hidden' && el.innerText.trim().length > 5;
    });
    if (!dialog) return JSON.stringify({ error: 'no_visible_dialog' });
    var target = ${JSON.stringify(modelId)};
    // Find the leaf element whose text matches the model name exactly (or case-insensitively)
    var items = Array.from(dialog.querySelectorAll('div, span, button')).filter(function(el) {
      return el.children.length === 0 || Array.from(el.children).every(function(c){ return c.tagName === 'SPAN' || c.tagName === 'svg' || c.tagName === 'SVG'; });
    });
    var matchEl = items.find(function(el) {
      var t = el.innerText.trim();
      return t === target || t.toLowerCase() === target.toLowerCase();
    });
    if (!matchEl) {
      var available = items.map(function(el){ return el.innerText.trim(); }).filter(function(t){ return t && t.length > 1 && t !== 'New'; });
      return JSON.stringify({ error: 'model_not_found', available: available });
    }
    var r = matchEl.getBoundingClientRect();
    return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2, selected: matchEl.innerText.trim() });
  `);
  const itemCoords = JSON.parse(itemCoordsRaw);
  if (itemCoords.error) {
    // Close dialog before returning
    await InputDomain.dispatchKeyEvent({ type: 'keyDown', key: 'Escape', code: 'Escape' });
    return { ok: false, code: itemCoords.error, detail: JSON.stringify(itemCoords.available || []) };
  }

  // Step 4: click the model item
  await InputDomain.dispatchMouseEvent({ type: 'mousePressed', x: itemCoords.x, y: itemCoords.y, button: 'left', clickCount: 1 });
  await new Promise(r => setTimeout(r, 60));
  await InputDomain.dispatchMouseEvent({ type: 'mouseReleased', x: itemCoords.x, y: itemCoords.y, button: 'left', clickCount: 1 });
  await new Promise(r => setTimeout(r, 300));

  console.log(`[${sessionId}] [model] Antigravity model set to: ${itemCoords.selected}`);
  return { ok: true, selected: itemCoords.selected };
}

// Set conversation mode (Planning | Fast) on the Antigravity Agent Manager.
// Requires CDP Input mouse events (same pattern as setAntigravityModel).
//
// Confirmed DOM structure (2026-03-19):
//   Planning button: [role="button"][aria-haspopup="dialog"][aria-expanded="false|true"]
//   Dialog: [role="dialog"] sibling in leftDiv; opacity:1 when open
//   Items: div.cursor-pointer children — active item has bg-gray-500/20 class
//   Available modes: 'Planning', 'Fast'
async function setAntigravityMode(Runtime, InputDomain, mode, sessionId) {
  // Step 1: find the Planning button and get coordinates for CDP click
  const coordsRaw = await evalInPage(Runtime, `
    var planBtn = Array.from(d.querySelectorAll('[role="button"][aria-haspopup="dialog"]')).find(function(el) {
      var t = el.innerText ? el.innerText.trim() : '';
      return t === 'Planning' || t === 'Fast';
    });
    if (!planBtn) return JSON.stringify({ error: 'no_planning_button' });
    var inner = planBtn.querySelector('button') || planBtn;
    var r = inner.getBoundingClientRect();
    return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
  `);
  const coords = JSON.parse(coordsRaw);
  if (coords.error) return { ok: false, code: coords.error };

  // Step 2: CDP click to open the Planning dialog
  await InputDomain.dispatchMouseEvent({ type: 'mousePressed', x: coords.x, y: coords.y, button: 'left', clickCount: 1 });
  await new Promise(r => setTimeout(r, 60));
  await InputDomain.dispatchMouseEvent({ type: 'mouseReleased', x: coords.x, y: coords.y, button: 'left', clickCount: 1 });
  await new Promise(r => setTimeout(r, 700));

  // Step 3: find the target mode item in the visible dialog
  const itemCoordsRaw = await evalInPage(Runtime, `
    var dialog = Array.from(d.querySelectorAll('[role="dialog"]')).find(function(el) {
      var s = window.getComputedStyle(el);
      var txt = el.innerText || '';
      return s.opacity === '1' && s.visibility === 'visible' && txt.includes('Planning') && txt.includes('Fast');
    });
    if (!dialog) return JSON.stringify({ error: 'no_mode_dialog' });
    var target = ${JSON.stringify(mode)};
    var items = Array.from(dialog.querySelectorAll('[class*="cursor-pointer"]'));
    var matchItem = items.find(function(el) {
      var firstLine = el.innerText.split('\\n')[0].trim();
      return firstLine.toLowerCase() === target.toLowerCase();
    });
    if (!matchItem) {
      var available = items.map(function(el) { return el.innerText.split('\\n')[0].trim(); });
      return JSON.stringify({ error: 'mode_not_found', available: available });
    }
    var r = matchItem.getBoundingClientRect();
    return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2, selected: matchItem.innerText.split('\\n')[0].trim() });
  `);
  const itemCoords = JSON.parse(itemCoordsRaw);
  if (itemCoords.error) {
    await InputDomain.dispatchKeyEvent({ type: 'keyDown', key: 'Escape', code: 'Escape' });
    return { ok: false, code: itemCoords.error, detail: JSON.stringify(itemCoords.available || []) };
  }

  // Step 4: click the mode item
  await InputDomain.dispatchMouseEvent({ type: 'mousePressed', x: itemCoords.x, y: itemCoords.y, button: 'left', clickCount: 1 });
  await new Promise(r => setTimeout(r, 60));
  await InputDomain.dispatchMouseEvent({ type: 'mouseReleased', x: itemCoords.x, y: itemCoords.y, button: 'left', clickCount: 1 });
  await new Promise(r => setTimeout(r, 300));

  console.log(`[${sessionId}] [mode] Antigravity conversation mode set to: ${itemCoords.selected}`);
  return { ok: true, selected: itemCoords.selected };
}

// ─── Continue model selection ──────────────────────────────────────────────────
async function setContinueModel(Runtime, modelId, sessionId) {
  try {
    console.log(`[${sessionId}] [continue-focus] set-model:start model=${modelId}`);
    const raw = await evalInFrame(Runtime, `
      var btn = d.querySelector('[data-testid="model-select-button"]');
      if (!btn) return JSON.stringify({ error: 'no-model-btn' });
      console.log('[continue-focus] set-model:open-dropdown');
      btn.click();
      return JSON.stringify({ ok: true });
    `);
    if (!raw) return { ok: false, code: 'eval_null', detail: 'No result opening model selector' };
    const step1 = JSON.parse(raw);
    if (step1.error) return { ok: false, code: step1.error, detail: 'Model button not found' };

    await new Promise(r => setTimeout(r, 300));

    const selectRaw = await evalInFrame(Runtime, `
      var target = ${JSON.stringify((modelId || '').toLowerCase())};
      var opts = Array.from(d.querySelectorAll('div[class*="option"], [role="option"], [role="menuitem"], .truncate'));
      var match = null;
      for (var i = 0; i < opts.length; i++) {
        var textEl = opts[i].querySelector('.truncate') || opts[i];
        var t = textEl.textContent.trim().toLowerCase();
        if (t && (t === target || t.includes(target) || target.includes(t)) && opts[i].offsetParent !== null) {
           match = opts[i]; break;
        }
      }
      if (!match) {
        var available = Array.from(d.querySelectorAll('.truncate, span')).map(function(el) { return el.textContent.trim(); }).filter(Boolean).slice(0, 50);
        var menuBtn = d.querySelector('[data-testid="model-select-button"]');
        console.log('[continue-focus] set-model:close-dropdown-no-match');
        if (menuBtn) menuBtn.click(); // close dropdown
        return JSON.stringify({ error: 'option_not_found', available: available });
      }
      console.log('[continue-focus] set-model:select-option');
      match.click();
      return JSON.stringify({ ok: true, selected: match.textContent.trim() });
    `);
    if (!selectRaw) return { ok: false, code: 'select_eval_null', detail: 'No result selecting option' };
    const step2 = JSON.parse(selectRaw);
    if (step2.error) return { ok: false, code: step2.error, detail: `No option matching "${modelId}"`, available: step2.available };

    console.log(`[${sessionId}] [model] Continue model selected: ${step2.selected}`);
    return { ok: true, selected: step2.selected };
  } catch (e) {
    return { ok: false, code: 'exception', detail: e.message };
  }
}

// ─── Gemini model selection ───────────────────────────────────────────────────
//
// Gemini Code Assist exposes a mat-select in .model-config-selector.
// Options confirmed live: Default, 2.5 Flash, 2.5 Pro, 3 Flash Preview, 3.1 Pro Preview.
// The trigger is .mat-mdc-select-trigger; options appear as mat-option in the frame doc.

async function setGeminiModel(Runtime, modelId, sessionId) {
  try {
    // Step 1: Click the mat-select trigger to open the dropdown
    const openResult = await evalInFrame(Runtime, `
      var trigger = d.querySelector('.model-config-selector mat-select .mat-mdc-select-trigger');
      if (!trigger) return JSON.stringify({ error: 'trigger_not_found' });
      var current = trigger.textContent.trim();
      trigger.click();
      return JSON.stringify({ ok: true, current: current });
    `);
    if (!openResult) return { ok: false, code: 'eval_null', detail: 'No result opening Gemini model selector' };
    const or = JSON.parse(openResult);
    if (or.error) return { ok: false, code: or.error, detail: 'Gemini model selector trigger not found' };
    console.log(`[${sessionId}] [model] Gemini selector opened (current: ${or.current})`);

    // Step 2: Wait for options to render
    await new Promise(r => setTimeout(r, 300));

    // Step 3: Click the mat-option whose text contains the requested modelId
    const selectResult = await evalInFrame(Runtime, `
      var opts = Array.from(d.querySelectorAll('mat-option'));
      var modelId = ${JSON.stringify(modelId)};
      var match = null;
      for (var i = 0; i < opts.length; i++) {
        var text = opts[i].textContent.trim();
        if (text.toLowerCase().indexOf(modelId.toLowerCase()) !== -1) {
          match = opts[i];
          break;
        }
      }
      if (!match) {
        var avail = opts.map(function(o) { return o.textContent.trim(); });
        return JSON.stringify({ error: 'option_not_found', available: avail });
      }
      match.click();
      return JSON.stringify({ ok: true, selected: match.textContent.trim() });
    `);
    if (!selectResult) return { ok: false, code: 'select_eval_null', detail: 'No result selecting Gemini option' };
    const sr = JSON.parse(selectResult);
    if (sr.error) return { ok: false, code: sr.error, detail: `No option matching "${modelId}"`, available: sr.available };

    console.log(`[${sessionId}] [model] Gemini model selected: ${sr.selected}`);
    return { ok: true, selected: sr.selected };
  } catch (e) {
    return { ok: false, code: 'exception', detail: e.message };
  }
}

// Set model for Antigravity Chat side panel using JS clicks (no CDP mouse events needed).
// The panel's model selector is a [role="button"] div inside .antigravity-agent-side-panel.
// Clicking it opens a dropdown of div options with cursor-pointer class.
async function setAntigravityPanelModel(Runtime, modelId, sessionId) {
  try {
    const raw = await evalInPage(Runtime, `
      var panel = d.querySelector('.antigravity-agent-side-panel');
      if (!panel) return JSON.stringify({ error: 'no-panel' });

      // Find and click the model selector button
      var modelEl = Array.from(panel.querySelectorAll('[role="button"]')).find(function(el) {
        return /gemini|claude|gpt/i.test(el.innerText) && el.innerText.trim().length < 40;
      });
      if (!modelEl) return JSON.stringify({ error: 'no-model-button' });
      modelEl.click();
      return JSON.stringify({ ok: true, current: modelEl.innerText.trim() });
    `);
    if (!raw) return { ok: false, code: 'eval_null', detail: 'No result' };
    const step1 = JSON.parse(raw);
    if (step1.error) return { ok: false, code: step1.error, detail: 'Model button not found' };

    // Wait for dropdown to appear
    await new Promise(r => setTimeout(r, 500));

    // Find and click the desired model option
    const selectRaw = await evalInPage(Runtime, `
      var wanted = ${JSON.stringify(modelId)}.toLowerCase();
      // Look for dropdown options (cursor-pointer divs with model names)
      var opts = Array.from(d.querySelectorAll('div')).filter(function(el) {
        var cls = el.className || '';
        if (!cls.includes('cursor-pointer') || !cls.includes('px-2') || !cls.includes('py-1')) return false;
        var t = (el.innerText || '').trim();
        return /gemini|claude|gpt/i.test(t) && t.length < 50;
      });
      if (opts.length === 0) return JSON.stringify({ error: 'no-options', detail: 'Dropdown not found' });

      var match = opts.find(function(o) {
        var t = o.innerText.trim().split('\\n')[0].trim().toLowerCase();
        return t === wanted || t.includes(wanted) || wanted.includes(t);
      });
      if (!match) {
        var avail = opts.map(function(o) { return o.innerText.trim().split('\\n')[0].trim(); });
        return JSON.stringify({ error: 'option_not_found', available: avail });
      }
      match.click();
      return JSON.stringify({ ok: true, selected: match.innerText.trim().split('\\n')[0].trim() });
    `);
    if (!selectRaw) return { ok: false, code: 'select_eval_null', detail: 'No result selecting option' };
    const step2 = JSON.parse(selectRaw);
    if (step2.error) return { ok: false, code: step2.error, detail: step2.detail || `No option matching "${modelId}"`, available: step2.available };

    console.log(`[${sessionId}] [model] Panel model selected: ${step2.selected}`);
    return { ok: true, selected: step2.selected };
  } catch (e) {
    return { ok: false, code: 'exception', detail: e.message };
  }
}

// Returns { ok: true, selected: label } or { ok: false, code, detail }.
// InputDomain (optional) is client.Input — required for antigravity (CDP mouse events).
async function setAgentModel(Runtime, agentType, modelId, sessionId, InputDomain) {
  if (agentType === 'antigravity_panel') {
    return setAntigravityPanelModel(Runtime, modelId, sessionId);
  }
  if (agentType === 'antigravity') {
    if (!InputDomain) return { ok: false, code: 'no_input_domain', detail: 'InputDomain required for antigravity model selection' };
    return setAntigravityModel(Runtime, InputDomain, modelId, sessionId);
  }
  if (agentType === 'gemini') {
    return setGeminiModel(Runtime, modelId, sessionId);
  }
  if (isContinueAgentType(agentType)) {
    return setContinueModel(Runtime, modelId, sessionId);
  }
  if (agentType !== 'claude') {
    return { ok: false, code: 'not_supported', detail: `Model selection not supported for ${agentType}` };
  }

  try {
    // Step 1: Click the model selector button to open dropdown
    const clickResult = await evalInFrame(Runtime, LIST_MODEL_OPTIONS_EXPR);
    if (!clickResult) return { ok: false, code: 'eval_null', detail: 'No result from frame' };
    const cr = JSON.parse(clickResult);
    if (cr.error) return { ok: false, code: cr.error, detail: 'Model selector button not found' };

    console.log(`[${sessionId}] [model] Opened selector (${cr.label})`);

    // Step 2: Wait for dropdown to appear
    await new Promise(r => setTimeout(r, 300));

    // Step 3: Collect available options
    const optsResult = await evalInFrame(Runtime, COLLECT_MODEL_OPTIONS_EXPR);
    const optsData = optsResult ? JSON.parse(optsResult) : { options: [] };
    console.log(`[${sessionId}] [model] Options: ${(optsData.options || []).join(', ')}`);

    // Step 4: Click the matching option
    const selectResult = await evalInFrame(Runtime, buildModelSelectExpr(modelId));
    if (!selectResult) return { ok: false, code: 'select_eval_null', detail: 'No result selecting option' };
    const sr = JSON.parse(selectResult);
    if (sr.error) return { ok: false, code: sr.error, detail: `Option not found for: ${modelId}`, available: optsData.options };

    console.log(`[${sessionId}] [model] Selected: ${sr.label}`);
    return { ok: true, selected: sr.label, available: optsData.options };

  } catch (e) {
    return { ok: false, code: 'exception', detail: e.message };
  }
}

// ─── Permission dialog detection and response ─────────────────────────────────
//
// Claude Code shows a native webview dialog when it needs approval to run a
// command (bash, file write, etc.).  We probe for dialog/modal patterns,
// extract the message text and button choices, and return a normalised object
// that the proxy can forward to the relay as a permission_prompt event.
//
// Response: given a choice_id (derived from button label), we re-locate the
// dialog and click the matching button.

async function setAgentPermissionMode(Runtime, agentType, mode, sessionId) {
  if (agentType === 'continue_yolo') {
    const allowed = new Set(['ask', 'bypass']);
    if (!allowed.has(mode)) {
      return { ok: false, code: 'invalid_mode', detail: `Unsupported permission mode: ${mode}` };
    }

    try {
      const result = await evalInFrame(Runtime, `
        try {
          window.localStorage.setItem('permissionMode', ${JSON.stringify(mode)});
          window.dispatchEvent(new CustomEvent('localStorageChange', {
            detail: { key: 'permissionMode', value: ${JSON.stringify(mode)} }
          }));
          return JSON.stringify({
            ok: true,
            mode: (window.localStorage && window.localStorage.getItem('permissionMode')) || ${JSON.stringify(mode)}
          });
        } catch (err) {
          return JSON.stringify({
            error: 'local_storage_write_failed',
            detail: String(err && err.message || err)
          });
        }
      `);
      if (!result) return { ok: false, code: 'eval_null', detail: 'No result from frame' };
      const parsed = JSON.parse(result);
      if (parsed.error) {
        return { ok: false, code: parsed.error, detail: parsed.detail || parsed.error };
      }
      console.log(`[${sessionId}] [perm-mode] Continue YOLO selected: ${parsed.mode || mode}`);
      return { ok: true, selected: parsed.mode || mode };
    } catch (e) {
      return { ok: false, code: 'exception', detail: e.message };
    }
  }

  if (agentType !== 'claude') {
    return { ok: false, code: 'not_supported', detail: `Permission mode selection not supported for ${agentType}` };
  }

  const targetMap = {
    default: 'askbeforeedits',
    bypassPermissions: 'bypasspermissions',
  };
  const targetToken = targetMap[mode];
  if (!targetToken) {
    return { ok: false, code: 'invalid_mode', detail: `Unsupported permission mode: ${mode}` };
  }

  try {
    const result = await evalInFrame(Runtime, `
      function norm(text) {
        return String(text || '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '');
      }

      var fieldset = d.querySelector('fieldset[data-permission-mode]');
      if (!fieldset) return JSON.stringify({ error: 'no_fieldset' });

      var currentMode = fieldset.getAttribute('data-permission-mode') || '';
      if (currentMode === ${JSON.stringify(mode)}) {
        return JSON.stringify({ ok: true, already: true, mode: currentMode });
      }

      var trigger = Array.from(fieldset.querySelectorAll('button')).find(function(btn) {
        var label = (btn.textContent || '').trim();
        var title = btn.getAttribute('title') || '';
        return /approval|edit/i.test(title) || /ask|bypass|default|plan/i.test(label);
      });
      if (!trigger) return JSON.stringify({ error: 'no_trigger' });

      trigger.click();

      var menuItems = Array.from(d.querySelectorAll('button[class*="menuItem"], [class*="menuItemV2"]'))
        .filter(function(el) { return !!el.offsetParent; });
      if (menuItems.length === 0) return JSON.stringify({ error: 'no_menu_items' });

      var target = null;
      for (var i = 0; i < menuItems.length; i++) {
        var token = norm(menuItems[i].textContent || '');
        if (token.indexOf(${JSON.stringify(targetToken)}) !== -1) {
          target = menuItems[i];
          break;
        }
      }
      if (!target) {
        return JSON.stringify({
          error: 'no_matching_option',
          available: menuItems.map(function(el) { return (el.textContent || '').replace(/\\s+/g, ' ').trim(); }),
        });
      }

      target.click();
      return JSON.stringify({
        ok: true,
        clicked: (target.textContent || '').replace(/\\s+/g, ' ').trim(),
        mode: fieldset.getAttribute('data-permission-mode') || '',
      });
    `);
    if (!result) return { ok: false, code: 'eval_null', detail: 'No result from frame' };
    const parsed = JSON.parse(result);
    if (parsed.error) {
      return {
        ok: false,
        code: parsed.error,
        detail: parsed.available ? `Available options: ${parsed.available.join(', ')}` : `Permission mode update failed: ${parsed.error}`,
      };
    }
    console.log(`[${sessionId}] [perm-mode] Selected: ${parsed.clicked || parsed.mode || mode}`);
    return { ok: true, selected: parsed.clicked || mode, already: !!parsed.already };
  } catch (e) {
    return { ok: false, code: 'exception', detail: e.message };
  }
}

const PERMISSION_DIALOG_EXPR = `
  var dlg = null;
  var isClaudePermissionPrompt = false;

  // 0. Claude Code specific: permissionRequestContainer is the inline permission prompt
  //    It has buttons like Reject/Run/Allow and a description of what's being requested.
  //    Must check BEFORE generic [class*="permission"] to avoid matching permissionsContainer_07S1Yg
  //    (which is the always-visible permission mode indicator, not a dialog).
  var ccPerm = d.querySelectorAll('[class*="permissionRequestContainer"]');
  for (var pi = 0; pi < ccPerm.length; pi++) {
    var p = ccPerm[pi];
    if (p.offsetParent !== null && p.querySelectorAll('button').length >= 1) {
      dlg = p;
      isClaudePermissionPrompt = true;
      break;
    }
  }

  // 1. role="dialog" — most semantic
  if (!dlg) {
    var dialogs = Array.from(d.querySelectorAll('[role="dialog"]'));
    for (var i = 0; i < dialogs.length; i++) {
      var el = dialogs[i];
      if (el.offsetParent !== null) { dlg = el; break; }
    }
  }

  // 2. class-name heuristics when no role present
  if (!dlg) {
    var pats = ['dialog', 'modal', 'confirm', 'prompt', 'overlay', 'Alert'];
    for (var pti = 0; pti < pats.length && !dlg; pti++) {
      var cands = Array.from(d.querySelectorAll('[class*="' + pats[pti] + '"]'));
      for (var ci = 0; ci < cands.length; ci++) {
        var c = cands[ci];
        if (c.offsetParent !== null && c.querySelectorAll('button').length >= 1) {
          dlg = c; break;
        }
      }
    }
  }

  if (!dlg) return null;

  // Extract the human-readable message
  // For Claude Code permission prompts, prefer permissionRequestDescription or permissionRequestContent
  var msgEl = dlg.querySelector('[class*="permissionRequestDescription"], [class*="permissionRequestContent"]')
           || dlg.querySelector('[class*="Description"], [class*="message"], [class*="title"], [class*="body"], [class*="content"], p');
  var rawMsg = (msgEl ? msgEl.textContent : dlg.textContent);

  // Also grab the tool input/command if present (e.g. the bash command being requested)
  var inputEl = dlg.querySelector('[class*="permissionRequestInput"] pre, [class*="permissionRequestInput"] code, [class*="inputJson"]');
  var inputText = inputEl ? inputEl.textContent.trim() : '';
  var msg = rawMsg.replace(/\\s+/g, ' ').trim();
  if (inputText && !msg.includes(inputText.substring(0, 40))) {
    msg = msg + '\\n' + inputText.substring(0, 500);
  }
  msg = msg.substring(0, 800);

  // Extract buttons as choices — skip copy buttons and icon-only buttons
  var btns = Array.from(dlg.querySelectorAll('button'));
  var choices = [];
  for (var bi = 0; bi < btns.length; bi++) {
    var btn = btns[bi];
    var cls = btn.className || '';
    if (cls.includes('copyButton') || cls.includes('iconButton')) continue;
    var label = (btn.textContent || btn.getAttribute('aria-label') || btn.getAttribute('title') || '').trim();
    if (!label) continue;
    var cid = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || ('choice_' + bi);
    choices.push({ choice_id: cid, label: label });
  }

  if (choices.length === 0) return null;
  var hasRejectChoice = choices.some(function(c) { return /^reject\\b/i.test(c.label); });
  var hasActionChoice = choices.some(function(c) {
    return /^(allow|allow once|always allow|run|always run|approve|accept|deny|cancel|continue|proceed|block|not now)\\b/i.test(c.label);
  });
  var hasPermissionText = /permission|approve|approval|allow|reject|run command\\??|edit file\\??|requires? input|requires? approval|tool call|terminal command|execute|write file|delete file|create file|access to|want to proceed/i.test(msg);
  if (!isClaudePermissionPrompt && !(hasRejectChoice || (hasActionChoice && hasPermissionText))) return null;
  return JSON.stringify({ message: msg, choices: choices });
`;

function _buildPermissionClickExpr(choiceId) {
  return `
    var dlg = null;
    function dispatchPress(el) {
      var w = d.defaultView || (typeof f !== 'undefined' && f && f.contentWindow) || window;
      if (typeof el.focus === 'function') {
        try { el.focus(); } catch (_) {}
      }
      var rect = el.getBoundingClientRect();
      var cx = rect.x + rect.width / 2;
      var cy = rect.y + rect.height / 2;
      var opts = { bubbles: true, cancelable: true, view: w, clientX: cx, clientY: cy, button: 0 };
      if (w.PointerEvent) {
        el.dispatchEvent(new w.PointerEvent('pointerdown', opts));
      }
      el.dispatchEvent(new w.MouseEvent('mousedown', opts));
      if (w.PointerEvent) {
        el.dispatchEvent(new w.PointerEvent('pointerup', opts));
      }
      el.dispatchEvent(new w.MouseEvent('mouseup', opts));
      el.dispatchEvent(new w.MouseEvent('click', opts));
    }
    // Claude Code specific: inline permission prompt
    var ccPerm = d.querySelectorAll('[class*="permissionRequestContainer"]');
    for (var pci = 0; pci < ccPerm.length; pci++) {
      if (ccPerm[pci].offsetParent !== null && ccPerm[pci].querySelectorAll('button').length >= 1) {
        dlg = ccPerm[pci]; break;
      }
    }
    if (!dlg) {
      var dialogs = Array.from(d.querySelectorAll('[role="dialog"]'));
      for (var i = 0; i < dialogs.length; i++) {
        if (dialogs[i].offsetParent !== null) { dlg = dialogs[i]; break; }
      }
    }
    if (!dlg) {
      var pats = ['dialog', 'modal', 'confirm', 'prompt', 'overlay', 'Alert'];
      for (var pti = 0; pti < pats.length && !dlg; pti++) {
        var cands = Array.from(d.querySelectorAll('[class*="' + pats[pti] + '"]'));
        for (var ci = 0; ci < cands.length; ci++) {
          var c = cands[ci];
          if (c.offsetParent !== null && c.querySelectorAll('button').length >= 1) { dlg = c; break; }
        }
      }
    }
    if (!dlg) return 'no-dialog';

    var target = ${JSON.stringify(choiceId)};
    var btns = Array.from(dlg.querySelectorAll('button'));
    var found = null;
    for (var bi = 0; bi < btns.length; bi++) {
      var btn = btns[bi];
      var label = (btn.textContent || btn.getAttribute('aria-label') || btn.getAttribute('title') || '').trim();
      var cid = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      if (cid === target) { found = btn; break; }
    }
    if (!found) return 'no-match';
    if (found.disabled || found.getAttribute('aria-disabled') === 'true') return 'disabled';
    dispatchPress(found);
    return 'clicked';
  `;
}

// ─── Antigravity panel inline permission prompt detection ─────────────────────
//
// Antigravity's side panel renders permission prompts inline in the chat flow
// (not as dialogs/modals). The prompt looks like:
//   "Run command?" / "Edit file?" / "N Steps Require Input"
//   [command/file details]
//   [Always run ~]  [Reject]  [Run Alt+E]
//
// We detect these by looking for visible containers within the panel that have
// both a "Reject" button and at least one other action button (Run, Allow, etc.).

const ANTIGRAVITY_PANEL_PERMISSION_EXPR = `
  function choiceId(label, idx) {
    return label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || ('choice_' + idx);
  }

  // Strategy 0: Page-level "N File(s) With Changes" diff bar with
  //   [Reject all] [Accept all] buttons. This isn't inside the side panel —
  //   it lives in the editor area when Antigravity proposes file edits.
  var fcAccept = null;
  var fcReject = null;
  function fcLabelOf(el) {
    var t = (el.innerText || el.textContent || el.getAttribute('aria-label') || '').trim();
    t = t.replace(/\\s*(Alt|Ctrl|Shift|Cmd|Meta)\\+\\S+$/i, '');
    t = t.replace(/\\s+/g, ' ').trim().toLowerCase();
    return t;
  }
  // Walk same-origin iframes so we cover both workbench-page renders and
  // any nested webviews (kept for cline/roo agents that DO render in iframes).
  function fcCollectDocs(rootDoc) {
    var docs = [rootDoc];
    var stack = [rootDoc];
    while (stack.length) {
      var cur = stack.pop();
      var iframes = cur.querySelectorAll ? cur.querySelectorAll('iframe, frame') : [];
      for (var ii = 0; ii < iframes.length; ii++) {
        var iframe = iframes[ii];
        var rect = iframe.getBoundingClientRect ? iframe.getBoundingClientRect() : null;
        if (rect && (rect.width === 0 || rect.height === 0)) continue;
        var inner = null;
        try { inner = iframe.contentDocument; } catch (_) { inner = null; }
        if (inner && docs.indexOf(inner) === -1) {
          docs.push(inner);
          stack.push(inner);
        }
      }
    }
    return docs;
  }
  var fcDocs = fcCollectDocs(d);
  // Antigravity renders diff-bar buttons as <span class="cursor-pointer"> with
  // no role, not <button>. Match a leaf element whose own text is exactly
  // "accept all" / "reject all" (no nested children) AND looks clickable.
  function fcLooksClickable(el) {
    if (!el) return false;
    if (el.tagName === 'BUTTON' || el.tagName === 'A') return true;
    var role = el.getAttribute && el.getAttribute('role');
    if (role === 'button' || role === 'link') return true;
    var cls = (el.className && el.className.toString) ? el.className.toString() : '';
    if (cls.indexOf('cursor-pointer') !== -1) return true;
    if (el.onclick) return true;
    if (el.tabIndex >= 0) return true;
    return false;
  }
  for (var di = 0; di < fcDocs.length && !(fcAccept && fcReject); di++) {
    var fcDoc = fcDocs[di];
    if (!fcDoc.querySelectorAll) continue;
    var allEls = fcDoc.querySelectorAll('*');
    for (var fi = 0; fi < allEls.length; fi++) {
      var fb = allEls[fi];
      // Leaf-only — avoid container ancestors that include the same text.
      if (fb.children && fb.children.length > 0) continue;
      if (!fb.offsetParent) continue;
      if (fb.disabled || (fb.getAttribute && fb.getAttribute('aria-disabled') === 'true')) continue;
      var ft = fcLabelOf(fb);
      if (ft.length > 30) continue;
      var isAccept = ft === 'accept all' || ft.indexOf('accept all') === 0;
      var isReject = ft === 'reject all' || ft.indexOf('reject all') === 0;
      if (!isAccept && !isReject) continue;
      // Walk up to the nearest clickable ancestor (the span itself often handles
      // the click; for button-style components it may be the parent).
      var clickTarget = fb;
      for (var up = 0; up < 4 && clickTarget; up++) {
        if (fcLooksClickable(clickTarget)) break;
        clickTarget = clickTarget.parentElement;
      }
      if (!clickTarget || !fcLooksClickable(clickTarget)) continue;
      if (isAccept && !fcAccept) fcAccept = clickTarget;
      else if (isReject && !fcReject) fcReject = clickTarget;
      if (fcAccept && fcReject) break;
    }
  }
  if (fcAccept && fcReject) {
    var fcContainer = fcAccept.parentElement;
    while (fcContainer && fcContainer !== d.body && !fcContainer.contains(fcReject)) {
      fcContainer = fcContainer.parentElement;
    }
    var fcMsg = fcContainer
      ? (fcContainer.innerText || '').replace(/\\s+/g, ' ').trim().substring(0, 400)
      : 'Files With Changes';
    return JSON.stringify({
      message: fcMsg || 'Files With Changes',
      choices: [
        { choice_id: 'accept_all', label: 'Accept all' },
        { choice_id: 'reject_all', label: 'Reject all' },
      ],
    });
  }

  // Manager-page sessions don't have .antigravity-agent-side-panel — fall back
  // to scanning the whole body. Strategies 1 and 2 are tight enough (require an
  // exact "Reject" button, or specific prompt text + action buttons) that this
  // is safe.
  var panel = d.querySelector('.antigravity-agent-side-panel') || d.body;
  if (!panel) return null;

  // Strategy 1: Find buttons with "Reject" text — the permission prompt always has one
  var allBtns = Array.from(panel.querySelectorAll('button'));
  var rejectBtn = null;
  for (var ri = 0; ri < allBtns.length; ri++) {
    var rText = (allBtns[ri].textContent || '').trim().toLowerCase();
    if (rText === 'reject') {
      rejectBtn = allBtns[ri]; break;
    }
  }

  // Strategy 2: If no exact "Reject" button, look for buttons/elements near
  // "Run command?" or "Edit file?" or "N Steps Require Input" text patterns
  if (!rejectBtn) {
    // Check for a prompt-like text anywhere in the panel
    var panelText = (panel.innerText || '');
    var hasPromptText = /Run command\\??|Edit file\\??|Steps? Requires? Input|Run tool\\??|Allow .* access|Allow directory/i.test(panelText);
    if (!hasPromptText) return null;

    // Find buttons that look like action buttons (Run, Allow, Reject, Accept, etc.)
    var actionPat = /^(run|reject|allow|accept|deny|cancel|always run|approve|allow once|allow this)/i;
    var actionBtns = allBtns.filter(function(b) {
      var t = (b.textContent || '').trim();
      // Strip keyboard shortcut suffixes
      t = t.replace(/\\s*(Alt|Ctrl|Shift|Cmd|Meta)\\+\\S+$/i, '').trim();
      return actionPat.test(t) && t.length < 30;
    });
    if (actionBtns.length < 2) return null;

    // Use the first reject/deny-like button as anchor, or first action button
    rejectBtn = actionBtns.find(function(b) {
      var t = (b.textContent || '').trim().toLowerCase();
      return t === 'reject' || t === 'deny' || t === 'cancel';
    }) || actionBtns[0];
  }

  if (!rejectBtn) {
    // Diagnostic: when "Files With Changes" text is on the page somewhere but
    // we couldn't reach the Accept all/Reject all buttons (Strategy 0 failed)
    // AND no other panel-style prompt exists (Strategies 1/2 also failed),
    // surface what we DID see so we can debug from logs. Choices=[] keeps
    // auto-approve and the relay UI from acting on it.
    function _fcAnyDocHasFwcText(docs) {
      for (var x = 0; x < docs.length; x++) {
        var body = docs[x].body || docs[x].documentElement;
        if (body && /\\d+\\s+files?\\s+with\\s+changes?/i.test(body.innerText || '')) return true;
      }
      return false;
    }
    if (_fcAnyDocHasFwcText(fcDocs)) {
      var allSeenLabels = [];
      for (var ddi = 0; ddi < fcDocs.length; ddi++) {
        var btns2 = Array.from(fcDocs[ddi].querySelectorAll('button, [role="button"], a, [onclick], [tabindex]'));
        for (var bi2 = 0; bi2 < btns2.length; bi2++) {
          var b2 = btns2[bi2];
          if (!b2.offsetParent) continue;
          var l2 = fcLabelOf(b2);
          if (!l2 || l2.length > 60) continue;
          allSeenLabels.push(l2);
        }
      }
      var iframeUrls = [];
      var dstack = [d];
      while (dstack.length) {
        var dcur = dstack.pop();
        var ifs = dcur.querySelectorAll ? dcur.querySelectorAll('iframe, frame') : [];
        for (var ki = 0; ki < ifs.length; ki++) {
          var ifr = ifs[ki];
          var same = false;
          try { same = !!ifr.contentDocument; } catch (_) { same = false; }
          iframeUrls.push((same ? '[same] ' : '[cross] ') + ((ifr.src || ifr.name || '<no-src>').substring(0, 80)));
          if (same) dstack.push(ifr.contentDocument);
        }
      }
      return JSON.stringify({
        message: '[fwc-diag] docs=' + fcDocs.length + ' iframes=' + JSON.stringify(iframeUrls.slice(0, 12)) + ' labels=' + JSON.stringify(allSeenLabels.slice(0, 40)),
        choices: [],
      });
    }
    return null;
  }

  // Walk up to find the prompt container — look for the nearest ancestor that
  // contains both the reject button and descriptive text
  var container = rejectBtn.parentElement;
  while (container && container !== panel) {
    // Stop when we find a container that has descriptive text beyond just button labels
    var containerText = (container.innerText || '').trim();
    var interactiveCount = container.querySelectorAll('button, select, [role="button"]').length;
    if (
      containerText.length > 30 &&
      interactiveCount >= 2 &&
      /permission required|ran command|run command\\??|edit file\\??|auto-choice|always run|reject|allow|approve/i.test(containerText)
    ) break;
    container = container.parentElement;
  }
  if (!container || container === panel) container = rejectBtn.parentElement;

  // Extract message text — get text before the button row
  var msgParts = [];
  var walker = d.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
  var node;
  while (node = walker.nextNode()) {
    var t = node.textContent.trim();
    // Stop when we hit button text
    if (node.parentElement && node.parentElement.tagName === 'BUTTON') continue;
    // Also skip text inside select/option elements
    if (node.parentElement && (node.parentElement.tagName === 'SELECT' || node.parentElement.tagName === 'OPTION')) continue;
    if (t) msgParts.push(t);
  }
  var msg = msgParts.join(' ').replace(/\\s+/g, ' ').trim().substring(0, 800);

  // Also try to grab command/code content
  var codeEl = container.querySelector('pre, code, [class*="command"], [class*="input"]');
  var codeText = codeEl ? codeEl.textContent.trim() : '';
  if (codeText && !msg.includes(codeText.substring(0, 40))) {
    msg = msg + '\\n' + codeText.substring(0, 500);
  }

  // Extract button choices from the container
  var btns = Array.from(container.querySelectorAll('button, [role="button"]'));
  var choices = [];
  for (var bi = 0; bi < btns.length; bi++) {
    var btn = btns[bi];
    var cls = btn.className || '';
    if (cls.includes('copyButton') || cls.includes('iconButton')) continue;
    var label = (btn.textContent || btn.getAttribute('aria-label') || '').trim();
    if (!label) continue;
    // Strip keyboard shortcut suffixes like "Alt+E", "Ctrl+Enter", "Alt+⏎"
    // Use \\s* (not \\s+) because Antigravity sometimes omits the space before the modifier
    label = label.replace(/\\s*(Alt|Ctrl|Shift|Cmd|Meta)\\+\\S+$/i, '').trim();
    if (!label) continue;
    var cid = choiceId(label, bi);
    choices.push({ choice_id: cid, label: label });
  }

  // Also check for select/dropdown elements (e.g. "Always run" dropdown)
  var selects = Array.from(container.querySelectorAll('select'));
  for (var si = 0; si < selects.length; si++) {
    var sel = selects[si];
    var opts = Array.from(sel.querySelectorAll('option'));
    for (var oi = 0; oi < opts.length; oi++) {
      var optLabel = (opts[oi].textContent || '').trim();
      if (optLabel && optLabel.length < 30) {
        var optCid = choiceId(optLabel, oi);
        // Only add if not already present
        if (!choices.some(function(c) { return c.choice_id === optCid; })) {
          choices.push({ choice_id: optCid, label: optLabel });
        }
      }
    }
  }

  if (choices.some(function(c) { return c.choice_id !== 'open'; })) {
    choices = choices.filter(function(c) { return c.choice_id !== 'open'; });
  }
  if (choices.length < 2) return null;
  return JSON.stringify({ message: msg, choices: choices });
`;

// Click handler for Antigravity panel inline permission prompts
function _buildPanelPermissionClickExpr(choiceId) {
  return `
    function dispatchPress(el) {
      var w = d.defaultView || window;
      if (typeof el.focus === 'function') {
        try { el.focus(); } catch (_) {}
      }
      var rect = el.getBoundingClientRect();
      var cx = rect.x + rect.width / 2;
      var cy = rect.y + rect.height / 2;
      var opts = { bubbles: true, cancelable: true, view: w, clientX: cx, clientY: cy, button: 0 };
      if (w.PointerEvent) {
        el.dispatchEvent(new w.PointerEvent('pointerdown', opts));
      }
      el.dispatchEvent(new w.MouseEvent('mousedown', opts));
      if (w.PointerEvent) {
        el.dispatchEvent(new w.PointerEvent('pointerup', opts));
      }
      el.dispatchEvent(new w.MouseEvent('mouseup', opts));
      el.dispatchEvent(new w.MouseEvent('click', opts));
    }

    var target = ${JSON.stringify(choiceId)};

    // Page-level "N File(s) With Changes" diff bar — Accept all / Reject all.
    // The diff bar can live in a same-origin child iframe inside the panel,
    // so walk into iframe.contentDocument and search there too.
    if (target === 'accept_all' || target === 'reject_all') {
      var wantText = (target === 'accept_all') ? 'accept all' : 'reject all';
      function pageLabelOf(el) {
        var t = (el.innerText || el.textContent || el.getAttribute('aria-label') || '').trim();
        t = t.replace(/\\s*(Alt|Ctrl|Shift|Cmd|Meta)\\+\\S+$/i, '');
        return t.replace(/\\s+/g, ' ').trim().toLowerCase();
      }
      function pageLooksClickable(el) {
        if (!el) return false;
        if (el.tagName === 'BUTTON' || el.tagName === 'A') return true;
        var role = el.getAttribute && el.getAttribute('role');
        if (role === 'button' || role === 'link') return true;
        var cls = (el.className && el.className.toString) ? el.className.toString() : '';
        if (cls.indexOf('cursor-pointer') !== -1) return true;
        if (el.onclick) return true;
        if (el.tabIndex >= 0) return true;
        return false;
      }
      function pageCollectDocs(rootDoc) {
        var docs = [rootDoc];
        var stack = [rootDoc];
        while (stack.length) {
          var cur = stack.pop();
          var iframes = cur.querySelectorAll ? cur.querySelectorAll('iframe, frame') : [];
          for (var ii = 0; ii < iframes.length; ii++) {
            var iframe = iframes[ii];
            var rect = iframe.getBoundingClientRect ? iframe.getBoundingClientRect() : null;
            if (rect && (rect.width === 0 || rect.height === 0)) continue;
            var inner = null;
            try { inner = iframe.contentDocument; } catch (_) { inner = null; }
            if (inner && docs.indexOf(inner) === -1) {
              docs.push(inner);
              stack.push(inner);
            }
          }
        }
        return docs;
      }
      var pageDocs = pageCollectDocs(d);
      for (var pdi = 0; pdi < pageDocs.length; pdi++) {
        if (!pageDocs[pdi].querySelectorAll) continue;
        var allEls = pageDocs[pdi].querySelectorAll('*');
        for (var pbi = 0; pbi < allEls.length; pbi++) {
          var pb = allEls[pbi];
          if (pb.children && pb.children.length > 0) continue;
          if (!pb.offsetParent) continue;
          if (pb.disabled || (pb.getAttribute && pb.getAttribute('aria-disabled') === 'true')) continue;
          var lbl = pageLabelOf(pb);
          if (lbl.length > 30) continue;
          if (lbl !== wantText && lbl.indexOf(wantText) !== 0) continue;
          var clickTarget = pb;
          for (var up = 0; up < 4 && clickTarget; up++) {
            if (pageLooksClickable(clickTarget)) break;
            clickTarget = clickTarget.parentElement;
          }
          if (!clickTarget || !pageLooksClickable(clickTarget)) continue;
          dispatchPress(clickTarget);
          return 'clicked';
        }
      }
      // fall through — maybe the same slug exists inside a panel prompt
    }

    // Manager-page sessions don't have .antigravity-agent-side-panel — fall
    // back to the document body so the same slug-match logic still runs.
    var panel = d.querySelector('.antigravity-agent-side-panel') || d.body;
    if (!panel) return 'no-panel';

    function slugOf(el) {
      var lbl = (el.textContent || el.getAttribute('aria-label') || '').trim();
      lbl = lbl.replace(/\\s*(Alt|Ctrl|Shift|Cmd|Meta)\\+\\S+$/i, '').trim();
      return lbl.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    }

    var allBtns = Array.from(panel.querySelectorAll('button, [role="button"]'));
    var rejectBtn = null;
    for (var ri = 0; ri < allBtns.length; ri++) {
      var rText = (allBtns[ri].textContent || '').trim().toLowerCase();
      if (rText === 'reject' || rText === 'deny' || rText === 'cancel') {
        rejectBtn = allBtns[ri]; break;
      }
    }
    // Fallback: find action-like buttons near prompt text
    if (!rejectBtn) {
      var panelText = (panel.innerText || '');
      var hasPrompt = /Run command\\??|Edit file\\??|Steps? Requires? Input|Run tool\\??|Allow .* access|Allow directory/i.test(panelText);
      if (!hasPrompt) return 'no-dialog';
      var actionPat = /^(run|reject|allow|accept|deny|cancel|always run|approve|allow once|allow this)/i;
      var actionBtns = allBtns.filter(function(b) {
        var t = (b.textContent || '').trim().replace(/\\s*(Alt|Ctrl|Shift|Cmd|Meta)\\+\\S+$/i, '').trim();
        return actionPat.test(t) && t.length < 30;
      });
      if (actionBtns.length < 2) return 'no-dialog';
      rejectBtn = actionBtns[0];
    }

    var container = rejectBtn.parentElement;
    while (container && container !== panel) {
      var containerText = (container.innerText || '').trim();
      var btnCount = container.querySelectorAll('button, [role="button"]').length;
      if (containerText.length > 30 && btnCount >= 2) break;
      container = container.parentElement;
    }
    if (!container || container === panel) container = rejectBtn.parentElement;

    // First try buttons (and role=button — detection includes them, so the
    // click handler must too, or matching choice IDs return 'no-match').
    var btns = Array.from(container.querySelectorAll('button, [role="button"]'));
    var found = null;
    for (var bi = 0; bi < btns.length; bi++) {
      var btn = btns[bi];
      var label = (btn.textContent || btn.getAttribute('aria-label') || '').trim();
      label = label.replace(/\\s*(Alt|Ctrl|Shift|Cmd|Meta)\\+\\S+$/i, '').trim();
      var cid = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      if (cid === target) { found = btn; break; }
    }

    // Then try select/option elements (e.g. "Always run" dropdown)
    if (!found) {
      var selects = Array.from(container.querySelectorAll('select'));
      for (var si = 0; si < selects.length && !found; si++) {
        var opts = Array.from(selects[si].querySelectorAll('option'));
        for (var oi = 0; oi < opts.length; oi++) {
          var optLabel = (opts[oi].textContent || '').trim();
          var optCid = optLabel.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
          if (optCid === target) {
            selects[si].value = opts[oi].value;
            selects[si].dispatchEvent(new Event('change', { bubbles: true }));
            return 'clicked';
          }
        }
      }
    }

    // Fallback: the container walk can stop at a node that doesn't include
    // every button (e.g. when the Run button lives in a sibling/footer
    // container of the Reject button). Scan the whole panel/body for any
    // visible non-disabled button whose slug matches the target.
    if (!found) {
      for (var gi = 0; gi < allBtns.length; gi++) {
        var gb = allBtns[gi];
        if (!gb.offsetParent) continue;
        if (gb.disabled || gb.getAttribute('aria-disabled') === 'true') continue;
        if (slugOf(gb) === target) { found = gb; break; }
      }
    }

    if (!found) {
      // Surface what's available so we can debug "no-match" quickly.
      var available = allBtns
        .filter(function(b){ return b.offsetParent && !b.disabled && b.getAttribute('aria-disabled') !== 'true'; })
        .map(slugOf)
        .filter(function(s){ return s; });
      return 'no-match:' + target + ':[' + available.slice(0, 20).join(',') + ']';
    }
    if (found.disabled || found.getAttribute('aria-disabled') === 'true') return 'disabled';
    dispatchPress(found);
    return 'clicked';
  `;
}

// Returns { message, choices: [{choice_id, label}] } or null if no dialog.
async function detectPermissionDialog(Runtime, agentType) {
  if (agentType === 'gemini') return null;

  // Continue: check for accept/reject tool call and file-change buttons.
  // Multiple blocks may exist in the DOM from previous turns; pick the LAST
  // visible active prompt controls.
  if (isContinueAgentType(agentType)) {
    try {
      const raw = await evalInFrame(Runtime, `
        function hasVisibleBox(el) {
          if (!el || !el.getBoundingClientRect) return false;
          var rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }
        function isVisible(el) {
          if (!el || !hasVisibleBox(el)) return false;
          var style = window.getComputedStyle ? window.getComputedStyle(el) : null;
          if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0' || style.pointerEvents === 'none')) return false;
          return true;
        }
        function norm(text) {
          return String(text || '').replace(/\\s+/g, ' ').trim();
        }
        function controlLabel(el) {
          return norm([
            el && (el.innerText || el.textContent || ''),
            el && el.getAttribute && el.getAttribute('aria-label'),
            el && el.getAttribute && el.getAttribute('title')
          ].filter(Boolean).join(' '));
        }
        function actionForLabel(label) {
          var t = norm(label).toLowerCase();
          if (/^accept\\b|\\baccept\\s+ctrl|\\baccept\\s+changes?\\b/.test(t)) return 'accept';
          if (/^reject\\b|\\breject\\s+ctrl|\\breject\\s+changes?\\b/.test(t)) return 'reject';
          return null;
        }
        var allAccept = d.querySelectorAll('[data-testid^="accept-tool-call-button-"]');
        var acceptBtn = null;
        for (var i = allAccept.length - 1; i >= 0; i--) {
          if (isVisible(allAccept[i])) { acceptBtn = allAccept[i]; break; }
        }
        if (acceptBtn) {
          // Find the matching reject button (same call ID suffix)
          var callId = acceptBtn.getAttribute('data-testid').replace('accept-tool-call-button-', '');
          var rejectBtn = d.querySelector('[data-testid="reject-tool-call-button-' + callId + '"]');
          // Find the last tool-call-title (closest to the active accept button)
          var allTitles = d.querySelectorAll('[data-testid="tool-call-title"]');
          var titleEl = allTitles.length > 0 ? allTitles[allTitles.length - 1] : null;
          var message = titleEl ? (titleEl.textContent || '').trim() : 'Tool call pending';
          return JSON.stringify({
            message: message,
            choices: [
              { choice_id: acceptBtn.getAttribute('data-testid'), label: 'Accept' },
              { choice_id: rejectBtn ? rejectBtn.getAttribute('data-testid') : 'reject-tool-call-button-' + callId, label: 'Reject' },
            ],
          });
        }

        function rootLooksLikeFileChange(root) {
          var text = norm(root && (root.innerText || root.textContent || ''));
          return /\\b\\d+\\s+diffs?\\b|\\bis\\s+editing\\b|\\bContinue\\s+is\\s+editing\\b|\\bediting\\s+[^\\s]+\\.[A-Za-z0-9]{1,8}\\b/i.test(text);
        }
        function collectFileChangeSummary(root) {
          var text = String(root && (root.innerText || root.textContent || '') || '');
          var lines = text.split(/\\n+/).map(norm).filter(Boolean);
          var files = [];
          lines.forEach(function(line) {
            var m = line.match(/(?:^|\\s)([^\\s\\\\/]+\\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|py|cpp|cc|cxx|h|hpp|cs|java|go|rs|rb|php|css|scss|html|xml|yaml|yml|toml|ini|txt))(?:\\s|$)/i);
            if (m && files.indexOf(m[1]) === -1) files.push(m[1]);
          });
          var diff = text.match(/\\b\\d+\\s+diffs?\\b/i);
          var parts = [];
          if (files.length > 0 && files.length <= 10) {
            parts.push(files.slice(0, 3).join(', ') + (files.length > 3 ? ' +' + (files.length - 3) + ' more' : ''));
          }
          if (diff) parts.push(norm(diff[0]));
          return parts.join(' - ');
        }
        var controls = Array.from(d.querySelectorAll('button, [role="button"], [aria-label], [title], a, [class*="button"], [class*="Button"]'))
          .filter(function(el) { return isVisible(el) && !!actionForLabel(controlLabel(el)); });
        var acceptControls = controls.filter(function(el) { return actionForLabel(controlLabel(el)) === 'accept'; });
        for (var a = acceptControls.length - 1; a >= 0; a--) {
          var accept = acceptControls[a];
          var root = accept;
          while (root && root !== d.body) {
            var reject = Array.from(root.querySelectorAll('button, [role="button"], [aria-label], [title], a, [class*="button"], [class*="Button"]'))
              .filter(function(el) { return el !== accept && isVisible(el) && actionForLabel(controlLabel(el)) === 'reject'; })
              .pop();
            if (reject && rootLooksLikeFileChange(root)) {
              var summary = collectFileChangeSummary(root);
              return JSON.stringify({
                message: 'Continue is requesting approval for file changes' + (summary ? ': ' + summary : ''),
                choices: [
                  { choice_id: 'continue-file-change-accept', label: controlLabel(accept) || 'Accept file changes' },
                  { choice_id: 'continue-file-change-reject', label: controlLabel(reject) || 'Reject file changes' },
                ],
              });
            }
            root = root.parentElement;
          }
        }
        return null;
      `);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch { return null; }
  }

  // Antigravity (manager page) and antigravity_panel both render the inline
  // "Run command? / Always run / Reject / Run" prompt at the page level rather
  // than as a modal dialog, so PERMISSION_DIALOG_EXPR misses it. Run the
  // panel-style detector FIRST — its strategy 0 surfaces the "Accept all" /
  // "Reject all" diff bar which always co-exists with the chat-history
  // "Running background command" prompt that PERMISSION_DIALOG_EXPR would
  // otherwise capture and lock onto.
  if (agentType === 'antigravity_panel' || agentType === 'antigravity') {
    try {
      const panelRaw = await evalInPage(Runtime, ANTIGRAVITY_PANEL_PERMISSION_EXPR);
      if (panelRaw) return JSON.parse(panelRaw);
      const pageRaw = await evalInPage(Runtime, PERMISSION_DIALOG_EXPR);
      if (!pageRaw) return null;
      return JSON.parse(pageRaw);
    } catch { return null; }
  }

  try {
    const usePageEval = agentType === 'codex-desktop';
    const evalFn = usePageEval ? evalInPage : evalInFrame;
    const raw = await evalFn(Runtime, PERMISSION_DIALOG_EXPR);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function detectSessionErrorPrompt(Runtime, agentType) {
  if (agentType !== 'continue' && agentType !== 'continue_yolo') return null;
  try {
    const raw = await evalInFrame(Runtime, `
      if (${JSON.stringify(agentType)} === 'continue_yolo') {
        function hasVisibleBox(el) {
          if (!el || !el.getBoundingClientRect) return false;
          var rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }
        function isVisible(el) {
          if (!el || !hasVisibleBox(el)) return false;
          var style = window.getComputedStyle ? window.getComputedStyle(el) : null;
          if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) return false;
          return true;
        }
        function norm(text) {
          return String(text || '').replace(/\\s+/g, ' ').trim();
        }
        function buttonLabel(btn) {
          return norm(btn.innerText || btn.textContent || btn.getAttribute('aria-label') || btn.getAttribute('title') || '');
        }
        function actionIdForLabel(label) {
          var t = norm(label).toLowerCase();
          if (/retry.*last.*message|resubmit.*last.*message|retry/i.test(t)) return 'resubmit_last_message';
          if (/dismiss|close|hide/i.test(t)) return 'dismiss';
          return null;
        }
        function looksLikeErrorText(text) {
          return /temporarily unavailable|service unavailable|error handling|try to submit your message again|something went wrong|request failed|rate limit|timed out|unavailable/i.test(text || '');
        }
        var retryButton = Array.from(d.querySelectorAll('button, [role="button"]')).find(function(el) {
          return isVisible(el) && actionIdForLabel(buttonLabel(el)) === 'resubmit_last_message';
        });
        if (retryButton) {
          var root = retryButton.closest('div');
          while (root && root !== d.body) {
            var dismissButton = Array.from(root.querySelectorAll('button, [role="button"]')).find(function(el) {
              return isVisible(el) && actionIdForLabel(buttonLabel(el)) === 'dismiss';
            });
            var messageEl = root.querySelector('p.thread-message.text-error, p[class*="text-error"], p.thread-message, p');
            var message = norm(messageEl && (messageEl.innerText || messageEl.textContent));
            if (dismissButton && message && looksLikeErrorText(message)) {
              return JSON.stringify({
                title: 'Model response error',
                message: message,
                error_output: null,
                actions: [
                  { action_id: 'resubmit_last_message', label: buttonLabel(retryButton) || 'Retry last message' },
                  { action_id: 'dismiss', label: buttonLabel(dismissButton) || 'Dismiss' }
                ],
                display_mode: 'inline',
                blocking: false,
              });
            }
            root = root.parentElement;
          }
        }
      }
      var ERROR_TITLE = 'Error handling model response';
      function hasVisibleBox(el) {
        if (!el || !el.getBoundingClientRect) return false;
        var rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }
      function isVisible(el) {
        if (!el || !hasVisibleBox(el)) return false;
        var style = window.getComputedStyle ? window.getComputedStyle(el) : null;
        if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) return false;
        return true;
      }
      function norm(text) {
        return String(text || '').replace(/\\s+/g, ' ').trim();
      }
      function buttonLabel(btn) {
        var text = norm(btn.innerText || btn.textContent || btn.getAttribute('aria-label') || btn.getAttribute('title') || '');
        if (!text || text === '×' || text === '✕' || text === '✖') return 'Close';
        return text;
      }
      function actionIdForLabel(label) {
        var t = norm(label).toLowerCase();
        if (!t) return null;
        if (t === 'resubmit last message') return 'resubmit_last_message';
        if (t === 'view logs') return 'view_logs';
        if (t === 'copy output') return 'copy_output';
        if (t === 'close') return 'dismiss';
        return null;
      }
      function knownActionButtons(root) {
        return Array.from(root.querySelectorAll('button')).filter(function(btn) {
          if (!isVisible(btn)) return false;
          var label = buttonLabel(btn);
          return !!actionIdForLabel(label) || /view error output/i.test(label);
        });
      }
      function elementTextLength(el) {
        return norm(el && (el.innerText || el.textContent || '')).length;
      }
      var titleNode = Array.from(d.querySelectorAll('h1, h2, h3, [role="heading"], div, span'))
        .filter(function(el) {
          return isVisible(el) && norm(el.textContent) === ERROR_TITLE;
        })
        .sort(function(a, b) {
          return elementTextLength(a) - elementTextLength(b);
        })[0];
      if (!titleNode) return null;

      var root = titleNode.closest('[role="dialog"]');
      if (!root) {
        var cur = titleNode;
        while (cur && cur !== d.body) {
          var visibleButtons = knownActionButtons(cur);
          if (visibleButtons.length > 0 && cur.getBoundingClientRect && cur.getBoundingClientRect().width > 200) {
            root = cur;
            break;
          }
          cur = cur.parentElement;
        }
      }
      if (!root) return null;

      var title = ERROR_TITLE;
      var buttons = knownActionButtons(root);
      var actions = [];
      var seenActions = {};
      for (var i = 0; i < buttons.length; i++) {
        var label = buttonLabel(buttons[i]);
        var actionId = actionIdForLabel(label);
        if (!actionId || seenActions[actionId]) continue;
        seenActions[actionId] = true;
        actions.push({ action_id: actionId, label: label });
      }
      var rootText = norm(root.innerText || root.textContent || '');

      var textLines = [];
      var seenLines = {};
      Array.from(root.querySelectorAll('p, div, span')).forEach(function(el) {
        if (!isVisible(el)) return;
        if (el === root || el === titleNode) return;
        if (el.closest && el.closest('button')) return;
        var text = norm(el.textContent);
        if (!text) return;
        if (text === title) return;
        if (/^(resubmit last message|view logs|copy output|view error output|close)$/i.test(text)) return;
        if (text === ERROR_TITLE) return;
        if (text.length > 220) return;
        if (seenLines[text]) return;
        seenLines[text] = true;
        textLines.push(text);
      });

      var detailCandidates = [];
      Array.from(root.querySelectorAll('pre, code, textarea, div, span')).forEach(function(el) {
        if (!isVisible(el)) return;
        if (el === root || el === titleNode) return;
        if (el.closest && el.closest('button')) return;
        var text = norm(el.textContent);
        if (!text) return;
        if (text === title) return;
        if (/^(resubmit last message|view logs|copy output|view error output|close)$/i.test(text)) return;
        if (/there was an error handling the response|please try to submit your message again/i.test(text)) return;
        if (text === ERROR_TITLE) return;
        detailCandidates.push(text);
      });
      detailCandidates.sort(function(a, b) { return b.length - a.length; });
      var detail = detailCandidates.find(function(text) {
        return text.length >= 10 && (/temporarily unavailable|\\bref:\\b|service unavailable/i.test(text) || /^".+"$/.test(text));
      }) || detailCandidates.find(function(text) { return text.length >= 20; }) || '';

      var message = textLines.filter(function(text) {
        return /there was an error handling the response|please try to submit your message again/i.test(text);
      }).slice(0, 2).join(' ').trim();
      var firstSentence = rootText.match(/There was an error handling the response from [^.]+\\./i);
      var secondSentence = rootText.match(/Please try to submit your message again\\./i);
      if (firstSentence && secondSentence) {
        message = (firstSentence[0] + ' ' + secondSentence[0]).trim();
      }
      var quotedDetail = rootText.match(/"[^"]*(?:temporarily unavailable|ref:)[^"]*"/i);
      if (quotedDetail && quotedDetail[0]) detail = quotedDetail[0].trim();
      return JSON.stringify({
        title: title,
        message: message || 'There was an error handling the model response.',
        error_output: detail || null,
        actions: actions,
      });
    `);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.title) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function respondToSessionErrorPrompt(Runtime, agentType, actionId, sessionId) {
  if (agentType !== 'continue' && agentType !== 'continue_yolo') {
    return { ok: false, code: 'not_supported', detail: `Session error prompt action not supported for ${agentType}` };
  }
  try {
    const result = await evalInFrame(Runtime, `
      if (${JSON.stringify(agentType)} === 'continue_yolo') {
        function hasVisibleBox(el) {
          if (!el || !el.getBoundingClientRect) return false;
          var rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }
        function isVisible(el) {
          if (!el || !hasVisibleBox(el)) return false;
          var style = window.getComputedStyle ? window.getComputedStyle(el) : null;
          if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) return false;
          return true;
        }
        function norm(text) {
          return String(text || '').replace(/\\s+/g, ' ').trim();
        }
        function buttonLabel(btn) {
          return norm(btn.innerText || btn.textContent || btn.getAttribute('aria-label') || btn.getAttribute('title') || '');
        }
        function actionIdForLabel(label) {
          var t = norm(label).toLowerCase();
          if (/retry.*last.*message|resubmit.*last.*message|retry/i.test(t)) return 'resubmit_last_message';
          if (/dismiss|close|hide/i.test(t)) return 'dismiss';
          return null;
        }
        function clickLikeUser(btn) {
          var rect = btn.getBoundingClientRect();
          var cx = rect.x + rect.width / 2;
          var cy = rect.y + rect.height / 2;
          var w = d.defaultView || f.contentWindow || window;
          var opts = { bubbles: true, cancelable: true, view: w, clientX: cx, clientY: cy, button: 0 };
          try { btn.dispatchEvent(new w.PointerEvent('pointerdown', opts)); } catch {}
          btn.dispatchEvent(new w.MouseEvent('mousedown', opts));
          try { btn.dispatchEvent(new w.PointerEvent('pointerup', opts)); } catch {}
          btn.dispatchEvent(new w.MouseEvent('mouseup', opts));
          btn.dispatchEvent(new w.MouseEvent('click', opts));
        }
        var inlineButtons = Array.from(d.querySelectorAll('button, [role="button"], div, span, a')).filter(function(btn) {
          if (!isVisible(btn)) return false;
          var label = buttonLabel(btn);
          if (actionIdForLabel(label) === ${JSON.stringify(actionId)}) return true;
          var style = window.getComputedStyle ? window.getComputedStyle(btn) : null;
          return !!label && style && style.cursor === 'pointer' && actionIdForLabel(label) === ${JSON.stringify(actionId)};
        });
        if (inlineButtons.length > 0) {
          var target = inlineButtons[0];
          if (target.disabled) return 'disabled';
          clickLikeUser(target);
          return 'clicked';
        }
      }
      var ERROR_TITLE = 'Error handling model response';
      function hasVisibleBox(el) {
        if (!el || !el.getBoundingClientRect) return false;
        var rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }
      function isVisible(el) {
        if (!el || !hasVisibleBox(el)) return false;
        var style = window.getComputedStyle ? window.getComputedStyle(el) : null;
        if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) return false;
        return true;
      }
      function norm(text) {
        return String(text || '').replace(/\\s+/g, ' ').trim();
      }
      function buttonLabel(btn) {
        var text = norm(btn.innerText || btn.textContent || btn.getAttribute('aria-label') || btn.getAttribute('title') || '');
        if (!text || text === '×' || text === '✕' || text === '✖') return 'Close';
        return text;
      }
      function actionIdForLabel(label) {
        var t = norm(label).toLowerCase();
        if (t === 'resubmit last message') return 'resubmit_last_message';
        if (t === 'view logs') return 'view_logs';
        if (t === 'copy output') return 'copy_output';
        if (t === 'close') return 'dismiss';
        return null;
      }
      function knownActionButtons(root) {
        return Array.from(root.querySelectorAll('button')).filter(function(btn) {
          if (!isVisible(btn)) return false;
          var label = buttonLabel(btn);
          return !!actionIdForLabel(label) || /view error output/i.test(label);
        });
      }
      function elementTextLength(el) {
        return norm(el && (el.innerText || el.textContent || '')).length;
      }
      function clickLikeUser(btn) {
        var rect = btn.getBoundingClientRect();
        var cx = rect.x + rect.width / 2;
        var cy = rect.y + rect.height / 2;
        var w = d.defaultView || f.contentWindow || window;
        var opts = { bubbles: true, cancelable: true, view: w, clientX: cx, clientY: cy, button: 0 };
        try { btn.dispatchEvent(new w.PointerEvent('pointerdown', opts)); } catch {}
        btn.dispatchEvent(new w.MouseEvent('mousedown', opts));
        try { btn.dispatchEvent(new w.PointerEvent('pointerup', opts)); } catch {}
        btn.dispatchEvent(new w.MouseEvent('mouseup', opts));
        btn.dispatchEvent(new w.MouseEvent('click', opts));
      }
      var titleNode = Array.from(d.querySelectorAll('h1, h2, h3, [role="heading"], div, span'))
        .filter(function(el) {
          return isVisible(el) && norm(el.textContent) === ERROR_TITLE;
        })
        .sort(function(a, b) {
          return elementTextLength(a) - elementTextLength(b);
        })[0];
      if (!titleNode) return 'no-dialog';
      var root = titleNode.closest('[role="dialog"]');
      if (!root) {
        var cur = titleNode;
        while (cur && cur !== d.body) {
          var visibleButtons = knownActionButtons(cur);
          if (visibleButtons.length > 0 && cur.getBoundingClientRect && cur.getBoundingClientRect().width > 200) { root = cur; break; }
          cur = cur.parentElement;
        }
      }
      if (!root) return 'no-dialog';
      var buttons = knownActionButtons(root);
      var target = null;
      for (var i = 0; i < buttons.length; i++) {
        if (actionIdForLabel(buttonLabel(buttons[i])) === ${JSON.stringify(actionId)}) {
          target = buttons[i];
          break;
        }
      }
      if (!target) return 'no-btn';
      if (target.disabled) return 'disabled';
      clickLikeUser(target);
      return 'clicked';
    `);
    if (result === 'clicked') return { ok: true };
    return { ok: false, code: result === 'disabled' ? 'disabled' : 'click_failed', detail: result };
  } catch (e) {
    console.warn(`[${sessionId}] [error-prompt] action error: ${e.message}`);
    return { ok: false, code: 'exception', detail: e.message };
  }
}

// Clicks the button matching choiceId in the active permission dialog.
// Returns { ok: true } or { ok: false, code, detail }.
async function respondToPermissionDialog(Runtime, agentType, choiceId, sessionId) {
  try {
    let r;
    let verifyAntigravityPanel = false;
    let verifyGenericPrompt = false;
    if (isContinueAgentType(agentType)) {
      // Continue uses data-testid for tool calls, while file-change prompts
      // expose visible Accept/Reject controls. Dispatch the full pointer+mouse
      // sequence so React handlers inside the iframe receive the action.
      r = await evalInFrame(Runtime, `
        var choiceId = ${JSON.stringify(choiceId)};
        function hasVisibleBox(el) {
          if (!el || !el.getBoundingClientRect) return false;
          var rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }
        function isVisible(el) {
          if (!el || !hasVisibleBox(el)) return false;
          var style = window.getComputedStyle ? window.getComputedStyle(el) : null;
          if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0' || style.pointerEvents === 'none')) return false;
          return true;
        }
        function norm(text) {
          return String(text || '').replace(/\\s+/g, ' ').trim();
        }
        function controlLabel(el) {
          return norm([
            el && (el.innerText || el.textContent || ''),
            el && el.getAttribute && el.getAttribute('aria-label'),
            el && el.getAttribute && el.getAttribute('title')
          ].filter(Boolean).join(' '));
        }
        function actionForLabel(label) {
          var t = norm(label).toLowerCase();
          if (/^accept\\b|\\baccept\\s+ctrl|\\baccept\\s+changes?\\b/.test(t)) return 'accept';
          if (/^reject\\b|\\breject\\s+ctrl|\\breject\\s+changes?\\b/.test(t)) return 'reject';
          return null;
        }
        function rootLooksLikeFileChange(root) {
          var text = norm(root && (root.innerText || root.textContent || ''));
          return /\\b\\d+\\s+diffs?\\b|\\bis\\s+editing\\b|\\bContinue\\s+is\\s+editing\\b|\\bediting\\s+[^\\s]+\\.[A-Za-z0-9]{1,8}\\b/i.test(text);
        }
        function candidateControls(root) {
          return Array.from(root.querySelectorAll('button, [role="button"], [aria-label], [title], a, [class*="button"], [class*="Button"]'));
        }
        function findFileChangeButton(action) {
          var controls = candidateControls(d).filter(function(el) {
            return isVisible(el) && actionForLabel(controlLabel(el)) === action;
          });
          for (var i = controls.length - 1; i >= 0; i--) {
            var control = controls[i];
            var root = control;
            while (root && root !== d.body) {
              var opposite = action === 'accept' ? 'reject' : 'accept';
              var paired = candidateControls(root).some(function(el) {
                return el !== control && isVisible(el) && actionForLabel(controlLabel(el)) === opposite;
              });
              if (paired && rootLooksLikeFileChange(root)) return control;
              root = root.parentElement;
            }
          }
          return null;
        }
        var w = d.defaultView || f.contentWindow || window;
        function dispatchShortcut(action) {
          var opts = action === 'accept'
            ? { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, ctrlKey: true, bubbles: true, cancelable: true }
            : { key: 'Backspace', code: 'Backspace', keyCode: 8, which: 8, ctrlKey: true, bubbles: true, cancelable: true };
          d.body.dispatchEvent(new w.KeyboardEvent('keydown', opts));
          d.body.dispatchEvent(new w.KeyboardEvent('keyup', opts));
          return 'clicked';
        }
        function press(btn) {
          var rect = btn.getBoundingClientRect();
          var cx = rect.x + rect.width / 2;
          var cy = rect.y + rect.height / 2;
          var opts = { bubbles: true, cancelable: true, view: w, clientX: cx, clientY: cy, button: 0 };
          if (w.PointerEvent) btn.dispatchEvent(new w.PointerEvent('pointerdown', opts));
          btn.dispatchEvent(new w.MouseEvent('mousedown', opts));
          if (w.PointerEvent) btn.dispatchEvent(new w.PointerEvent('pointerup', opts));
          btn.dispatchEvent(new w.MouseEvent('mouseup', opts));
          btn.dispatchEvent(new w.MouseEvent('click', opts));
        }
        var isFileChange = choiceId.indexOf('continue-file-change-') === 0;
        var isAccept = choiceId.indexOf('accept') !== -1;
        var btn = null;
        if (isFileChange) {
          btn = findFileChangeButton(isAccept ? 'accept' : 'reject');
          if (!btn) return dispatchShortcut(isAccept ? 'accept' : 'reject');
        } else {
          btn = d.querySelector('[data-testid="' + choiceId + '"]');
          if (!btn) {
            // Try finding by partial match (call ID may have changed)
            var prefix = choiceId.split('-').slice(0, -1).join('-');
            var all = d.querySelectorAll('[data-testid^="' + prefix + '"]');
            btn = all.length > 0 ? all[all.length - 1] : null;
          }
          if (!btn) return 'no-btn';
        }
        if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') return 'disabled';
        console.log('[continue-focus] permission:dispatch-pointer-sequence');
        press(btn);
        // Keep the existing tool-call fallback: Ctrl+Enter = Accept.
        if (!isFileChange && isAccept) {
          console.log('[continue-focus] permission:dispatch-ctrl-enter');
          dispatchShortcut('accept');
        }
        return 'clicked';
      `);
    } else if (agentType === 'antigravity_panel' || agentType === 'antigravity') {
      // Try the generic dialog click first, then fall back to the panel-style
      // click — same ordering as detectPermissionDialog so click & detect stay
      // in sync.
      r = await evalInPage(Runtime, _buildPermissionClickExpr(choiceId));
      if (r !== 'clicked') {
        r = await evalInPage(Runtime, _buildPanelPermissionClickExpr(choiceId));
      }
      verifyAntigravityPanel = (r === 'clicked');
    } else {
      const usePageEval = agentType === 'codex-desktop';
      const evalFn = usePageEval ? evalInPage : evalInFrame;
      r = await evalFn(Runtime, _buildPermissionClickExpr(choiceId));
      verifyGenericPrompt = (r === 'clicked');
    }
    if (verifyAntigravityPanel) {
      await new Promise(resolve => setTimeout(resolve, 350));
      const followup = await detectPermissionDialog(Runtime, 'antigravity_panel');
      if (followup && Array.isArray(followup.choices) && followup.choices.some(c => c.choice_id === choiceId)) {
        console.warn(`[${sessionId}] [perm] Antigravity panel prompt persisted after click '${choiceId}'`);
        return { ok: false, code: 'click_not_applied', detail: 'Prompt remained visible after click' };
      }
    }
    if (verifyGenericPrompt) {
      await new Promise(resolve => setTimeout(resolve, 350));
      const followup = await detectPermissionDialog(Runtime, agentType);
      if (followup && Array.isArray(followup.choices) && followup.choices.some(c => c.choice_id === choiceId)) {
        console.warn(`[${sessionId}] [perm] Prompt persisted after click '${choiceId}'`);
        return { ok: false, code: 'click_not_applied', detail: 'Prompt remained visible after click' };
      }
    }
    if (r === 'clicked') {
      console.log(`[${sessionId}] [perm] Clicked choice '${choiceId}'`);
      return { ok: true };
    }
    console.warn(`[${sessionId}] [perm] Click failed: ${r}`);
    return { ok: false, code: 'click_failed', detail: r };
  } catch (e) {
    return { ok: false, code: 'exception', detail: e.message };
  }
}

// ─── Send dispatch (with fallback) ────────────────────────────────────────────

async function sendMessage(Runtime, agentType, text, sessionId) {
  let result;

  if (agentType === 'antigravity') {
    result = await sendAntigravityPrimary(Runtime, text);
    if (!result.ok) {
      console.warn(`[${sessionId}] [sel] Antigravity primary send failed (${result.code}:${result.detail}), trying fallback`);
      result = await sendAntigravityFallback(Runtime, text);
    }
  } else if (agentType === 'antigravity_panel') {
    result = await sendAntigravityPanelPrimary(Runtime, text);
  } else if (agentType === 'codex' || agentType === 'codex-desktop') {
    const usePageEval = agentType === 'codex-desktop';
    result = await sendCodexPrimary(Runtime, text, usePageEval);
    if (!result.ok) {
      console.warn(`[${sessionId}] [sel] Codex primary send failed (${result.code}:${result.detail}), trying fallback`);
      result = await sendCodexFallback(Runtime, text, usePageEval);
    }
  } else if (agentType === 'gemini') {
    result = await sendGeminiPrimary(Runtime, text);
    if (!result.ok) {
      console.warn(`[${sessionId}] [sel] Gemini primary send failed (${result.code}:${result.detail}), trying fallback`);
      result = await sendGeminiFallback(Runtime, text);
    }
  } else if (isRooCodeAgentType(agentType)) {
    result = await sendRooCodePrimary(Runtime, text);
    if (!result.ok) {
      console.warn(`[${sessionId}] [sel] Roo Code primary send failed (${result.code}:${result.detail}), trying fallback`);
      result = await sendRooCodeFallback(Runtime, text);
    }
  } else if (isContinueAgentType(agentType)) {
    result = await sendContinuePrimary(Runtime, text);
    if (!result.ok) {
      console.warn(`[${sessionId}] [sel] Continue primary send failed (${result.code}:${result.detail}), trying fallback`);
      result = await sendContinueFallback(Runtime, text);
    }
  } else {
    result = await sendClaudePrimary(Runtime, text);
    if (!result.ok) {
      console.warn(`[${sessionId}] [sel] Claude primary send failed (${result.code}:${result.detail}), trying fallback`);
      result = await sendClaudeFallback(Runtime, text);
    }
  }

  if (result.ok) {
    resetSendFailures(sessionId);
  } else {
    const f = recordSendFailure(sessionId);
    console.error(`[${sessionId}] [sel] Send failed after all strategies: ${result.code} x${f.sendFails}`);
    await captureDiagnostic(Runtime, sessionId);
  }

  return result;
}

// ─── Codex Desktop config setter (CDP button clicks) ─────────────────────────
//
// Applies model/effort/access changes immediately in the live Codex Desktop UI
// by clicking the relevant toolbar buttons and selecting the desired option.
// Operates on page-level DOM (usePageEval=true).

async function setCodexDesktopConfig(Runtime, { model_id, effort, access_mode, speed }, usePageEval = true) {
  const results = {};
  const evalFn = usePageEval ? evalInPage : evalInFrame;

  async function closeMenus() {
    try {
      await evalFn(Runtime, `
        return (function() {
          var w = d.defaultView || window;
          d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
          d.dispatchEvent(new w.KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
          if (d.activeElement) {
            try { d.activeElement.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true })); } catch (_) {}
          }
          return 'ok';
        })();
      `);
      await new Promise(r => setTimeout(r, 120));
    } catch {}
  }

  async function clickOpenCombinedModelMenu() {
    await closeMenus();
    const triggerClicked = await evalFn(Runtime, `
      return (function() {
        function norm(t) { return String(t || '').replace(/\\s+/g, ' ').trim(); }
        function press(el) {
          var w = d.defaultView || window;
          var rect = el.getBoundingClientRect();
          var opts = { bubbles: true, cancelable: true, view: w, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, button: 0 };
          if (w.PointerEvent) el.dispatchEvent(new w.PointerEvent('pointerdown', opts));
          el.dispatchEvent(new w.MouseEvent('mousedown', opts));
          if (w.PointerEvent) el.dispatchEvent(new w.PointerEvent('pointerup', opts));
          el.dispatchEvent(new w.MouseEvent('mouseup', opts));
          el.dispatchEvent(new w.MouseEvent('click', opts));
        }
        var btns = Array.from(d.querySelectorAll('button'));
        var trigger = btns.slice(-40).find(function(b) {
          var parts = Array.from(b.querySelectorAll('span')).map(function(s) { return norm(s.textContent); }).filter(Boolean);
          var hasModel = parts.some(function(p) { return /^\\d+(?:\\.\\d+)?$/.test(p) || /^gpt[-\\s.]?[\\d.]+$/i.test(p); });
          var hasEffort = parts.some(function(p) { return /^(low|medium|high|extra\\s*high)$/i.test(p); });
          return hasModel && hasEffort;
        });
        if (!trigger) return 'no-trigger';
        press(trigger);
        return 'clicked';
      })();
    `);
    return triggerClicked === 'clicked' ? { ok: true, detail: triggerClicked } : { ok: false, detail: triggerClicked };
  }

  async function clickVisibleMenuItem(optionText) {
    const optLower = optionText.toLowerCase();
    const optStr = JSON.stringify(optLower);
    const optClicked = await evalFn(Runtime, `
      return (function() {
        function norm(t) { return String(t || '').replace(/\\s+/g, ' ').trim(); }
        function press(el) {
          var w = d.defaultView || window;
          var rect = el.getBoundingClientRect();
          var opts = { bubbles: true, cancelable: true, view: w, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, button: 0 };
          if (w.PointerEvent) el.dispatchEvent(new w.PointerEvent('pointerdown', opts));
          el.dispatchEvent(new w.MouseEvent('mousedown', opts));
          if (w.PointerEvent) el.dispatchEvent(new w.PointerEvent('pointerup', opts));
          el.dispatchEvent(new w.MouseEvent('mouseup', opts));
          el.dispatchEvent(new w.MouseEvent('click', opts));
        }
        var target = ${optStr};
        var candidates = Array.from(d.querySelectorAll('[role="menuitem"],[role="option"],[role="listitem"],button'));
        var item = candidates.find(function(el) {
          if (!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)) return false;
          var t = norm(el.innerText || el.textContent || '').toLowerCase();
          var firstLine = t.split(/\\n|\\r/)[0].trim();
          return t === target || firstLine === target ||
            t.indexOf(target + ' ') === 0 ||
            t.replace(/\\s+/g,'') === target.replace(/\\s+/g,'');
        });
        if (!item) return 'no-option';
        press(item);
        return 'clicked';
      })();
    `);
    return { ok: optClicked === 'clicked', detail: optClicked };
  }

  async function clickAnyVisibleModelMenuItem() {
    const optClicked = await evalFn(Runtime, `
      return (function() {
        function norm(t) { return String(t || '').replace(/\\s+/g, ' ').trim(); }
        function press(el) {
          var w = d.defaultView || window;
          var rect = el.getBoundingClientRect();
          var opts = { bubbles: true, cancelable: true, view: w, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, button: 0 };
          if (w.PointerEvent) el.dispatchEvent(new w.PointerEvent('pointerdown', opts));
          el.dispatchEvent(new w.MouseEvent('mousedown', opts));
          if (w.PointerEvent) el.dispatchEvent(new w.PointerEvent('pointerup', opts));
          el.dispatchEvent(new w.MouseEvent('mouseup', opts));
          el.dispatchEvent(new w.MouseEvent('click', opts));
        }
        var candidates = Array.from(d.querySelectorAll('[role="menuitem"],button'));
        var item = candidates.find(function(el) {
          if (!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)) return false;
          return /^GPT[-\\s.]?\\d/i.test(norm(el.innerText || el.textContent || ''));
        });
        if (!item) return 'no-model-menuitem';
        press(item);
        return 'clicked';
      })();
    `);
    return { ok: optClicked === 'clicked', detail: optClicked };
  }

  // Helper: click a trigger button (by pattern on last 40 buttons), then click an option.
  // This is the legacy fallback for older Codex builds with separate model/effort/access buttons.
  async function clickOption(triggerPatternFn, optionText) {
    await closeMenus();
    const triggerClicked = await evalFn(Runtime, `
      return (function() {
        function press(el) {
          var w = d.defaultView || window;
          var rect = el.getBoundingClientRect();
          var opts = { bubbles: true, cancelable: true, view: w, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, button: 0 };
          if (w.PointerEvent) el.dispatchEvent(new w.PointerEvent('pointerdown', opts));
          el.dispatchEvent(new w.MouseEvent('mousedown', opts));
          if (w.PointerEvent) el.dispatchEvent(new w.PointerEvent('pointerup', opts));
          el.dispatchEvent(new w.MouseEvent('mouseup', opts));
          el.dispatchEvent(new w.MouseEvent('click', opts));
        }
        var btns = Array.from(d.querySelectorAll('button'));
        var lastBtns = btns.slice(-40);
        var trigger = lastBtns.find(function(b) {
          var t = (b.textContent || '').trim();
          return (${triggerPatternFn})(t);
        });
        if (!trigger) return 'no-trigger';
        press(trigger);
        return 'clicked';
      })();
    `);
    if (triggerClicked !== 'clicked') return { ok: false, detail: `trigger: ${triggerClicked}` };

    await new Promise(r => setTimeout(r, 350));
    return clickVisibleMenuItem(optionText);
  }

  if (model_id) {
    const label = model_id.toUpperCase().replace(/^GPT-/, 'GPT-');
    const combinedOpen = await clickOpenCombinedModelMenu();
    if (combinedOpen.ok) {
      await new Promise(r => setTimeout(r, 350));
      // New Codex Desktop builds put GPT choices behind the current-model submenu.
      const currentModelMenu = await clickAnyVisibleModelMenuItem();
      if (currentModelMenu.ok) {
        await new Promise(r => setTimeout(r, 250));
        results.model = await clickVisibleMenuItem(label);
      } else {
        results.model = currentModelMenu;
      }
      await closeMenus();
    } else {
      results.model = await clickOption(
        'function(t){ return /^gpt[-\\s.]?[\\d.]+|^o[134][-\\s.]/i.test(t) && t.length < 20; }',
        label
      );
    }
  }

  if (effort) {
    const effortLabel = effort === 'extra-high' ? 'Extra High'
      : effort.charAt(0).toUpperCase() + effort.slice(1);
    const combinedOpen = await clickOpenCombinedModelMenu();
    if (combinedOpen.ok) {
      await new Promise(r => setTimeout(r, 350));
      results.effort = await clickVisibleMenuItem(effortLabel);
      await closeMenus();
    } else {
      results.effort = await clickOption(
        'function(t){ return /^(low|medium|high|extra\\s*high)$/i.test(t); }',
        effortLabel
      );
    }
  }

  if (speed) {
    const speedLabels = {
      standard: 'Standard',
      fast:     'Fast',
    };
    const speedLabel = speedLabels[String(speed).toLowerCase()] || speed;
    const combinedOpen = await clickOpenCombinedModelMenu();
    if (combinedOpen.ok) {
      await new Promise(r => setTimeout(r, 350));
      const speedMenu = await clickVisibleMenuItem('Speed');
      if (speedMenu.ok) {
        await new Promise(r => setTimeout(r, 250));
        results.speed = await clickVisibleMenuItem(speedLabel);
      } else {
        results.speed = speedMenu;
      }
      await closeMenus();
    } else {
      results.speed = await clickOption(
        'function(t){ return /^speed$/i.test(t); }',
        speedLabel
      );
    }
  }

  if (access_mode) {
    const accessLabels = {
      'danger-full-access': 'Full access',
      'workspace-write':    'Workspace write',
      'read-only':          'Read only',
    };
    const accessLabel = accessLabels[access_mode] || access_mode;
    results.access = await clickOption(
      'function(t){ return /access|restricted/i.test(t) && !/add|ide|file$/i.test(t) && t.length < 30; }',
      accessLabel
    );
  }

  return results;
}

// ─── Codex Desktop new thread ─────────────────────────────────────────────────
//
// Clicks the "New thread" button/menu item in Codex Desktop to start a fresh
// conversation. Falls back to Ctrl+Shift+N keyboard shortcut if no button found.

async function newCodexThread(Runtime, usePageEval) {
  const evalFn = usePageEval ? evalInPage : evalInFrame;
  let beforeThreadList = null;
  let beforeDraftState = false;
  try {
    beforeThreadList = await readCodexThreadList(Runtime, usePageEval);
  } catch {}
  try {
    const raw = await evalFn(Runtime, `
      JSON.stringify({
        body: (d.body && d.body.innerText ? d.body.innerText : '').slice(0, 1200)
      })
    `);
    let payload = raw;
    if (typeof raw === 'string') {
      try { payload = JSON.parse(raw); } catch { payload = { body: raw }; }
    }
    const bodyText = payload && typeof payload.body === 'string' ? payload.body : '';
    beforeDraftState = !!(bodyText && /let.?s build|message codex|what can i help|start typing/i.test(bodyText.toLowerCase()));
  } catch {}

  // Codex Desktop can already be on the blank draft/new-chat screen without a
  // persisted thread yet. Treat that as a valid "new chat" state.
  if (beforeDraftState) return true;

  // Try to find and click a "New thread" button
  const res = await evalFn(Runtime, `
    function dispatchPress(el) {
      var w = d.defaultView || window;
      if (typeof el.focus === 'function') {
        try { el.focus(); } catch (_) {}
      }
      var rect = el.getBoundingClientRect();
      var cx = rect.x + rect.width / 2;
      var cy = rect.y + rect.height / 2;
      var opts = { bubbles: true, cancelable: true, view: w, clientX: cx, clientY: cy, button: 0 };
      if (w.PointerEvent) {
        el.dispatchEvent(new w.PointerEvent('pointerdown', opts));
      }
      el.dispatchEvent(new w.MouseEvent('mousedown', opts));
      if (w.PointerEvent) {
        el.dispatchEvent(new w.PointerEvent('pointerup', opts));
      }
      el.dispatchEvent(new w.MouseEvent('mouseup', opts));
      el.dispatchEvent(new w.MouseEvent('click', opts));
    }
    var allEls = Array.from(d.querySelectorAll('button, [role="button"], [role="menuitem"]'));
    var btn = allEls.find(function(el) {
      var t = (el.textContent || el.getAttribute('aria-label') || '').trim().toLowerCase();
      return t === 'new thread' || t === 'new chat' || t === 'new conversation';
    });
    if (btn) { dispatchPress(btn); return 'clicked'; }
    // Also try aria-label="New chat"
    var ariaBtn = d.querySelector('button[aria-label="New chat"], button[aria-label="New thread"]');
    if (ariaBtn) { dispatchPress(ariaBtn); return 'clicked-aria'; }
    return 'not-found';
  `);

  let attempted = res === 'clicked' || res === 'clicked-aria';
  // Fallback: keyboard shortcut (Ctrl+Shift+N is common "new thread" action in Codex)
  try {
    const { Input } = Runtime._cdp || {};
    if (Input) {
      await Input.dispatchKeyEvent({ type: 'keyDown', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17, nativeVirtualKeyCode: 17 });
      await Input.dispatchKeyEvent({ type: 'keyDown', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16, nativeVirtualKeyCode: 16 });
      await Input.dispatchKeyEvent({ type: 'keyDown', key: 'N', code: 'KeyN', windowsVirtualKeyCode: 78, nativeVirtualKeyCode: 78, modifiers: 10 });
      await Input.dispatchKeyEvent({ type: 'keyUp', key: 'N', code: 'KeyN', windowsVirtualKeyCode: 78, nativeVirtualKeyCode: 78, modifiers: 10 });
      await Input.dispatchKeyEvent({ type: 'keyUp', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16, nativeVirtualKeyCode: 16, modifiers: 2 });
      await Input.dispatchKeyEvent({ type: 'keyUp', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17, nativeVirtualKeyCode: 17 });
      attempted = true;
    }
  } catch {}

  if (!attempted) return false;

  for (let i = 0; i < 8; i++) {
    await new Promise(r => setTimeout(r, 300));
    try {
      const afterThreadList = await readCodexThreadList(Runtime, usePageEval);
      const beforeSig = JSON.stringify(beforeThreadList || []);
      const afterSig = JSON.stringify(afterThreadList || []);
      if (afterSig !== beforeSig) return true;
      const activeExists = Array.isArray(afterThreadList) && afterThreadList.some(t => t.active);
      if (activeExists && (!beforeThreadList || !beforeThreadList.some(t => t.active))) return true;
    } catch {}
    try {
      const raw = await evalFn(Runtime, `
        JSON.stringify({
          body: (d.body && d.body.innerText ? d.body.innerText : '').slice(0, 400)
        })
      `);
      const bodyText = typeof raw === 'string'
        ? raw
        : (raw && typeof raw.body === 'string' ? raw.body : '');
      if (bodyText && /what can i help|let.?s build|message codex|start typing/i.test(bodyText.toLowerCase())) {
        return true;
      }
    } catch {}
  }

  return false;
}

// ─── Codex Desktop workspace switching (Epic 3) ──────────────────────────────
//
// Codex Desktop shows the current workspace/folder path and may provide a way
// to switch between recent folders. The workspace is typically shown in the
// title bar or a header area.
//
// We read available workspaces from:
//   1. The sidebar/settings area (recent folders)
//   2. The title bar or header (current folder)
//   3. Navigation or breadcrumb elements

/**
 * Read available workspaces from Codex Desktop.
 * Returns array of { id, title, path, active } or empty array.
 * The current workspace is marked active.
 */
async function readCodexWorkspaces(Runtime, usePageEval) {
  const evalFn = usePageEval ? evalInPage : evalInFrame;
  try {
    const raw = await evalFn(Runtime, `
      return (function() {
        var workspaces = [];

        // Strategy 1: Read from Codex Desktop sidebar cwd groups
        // Each group/cwd contains a folder-row with the workspace name and threads underneath
        var cwdGroups = d.querySelectorAll('[class*="group/cwd"]');
        for (var i = 0; i < cwdGroups.length; i++) {
          var group = cwdGroups[i];
          var folderRow = group.querySelector('[class*="folder-row"]');
          if (!folderRow) continue;
          var nameEl = folderRow.querySelector('.truncate, [class*="whitespace-nowrap"]');
          var title = (nameEl || folderRow).textContent.trim().split('\\n')[0].trim();
          if (!title || title.length > 200) continue;
          // Detect active workspace: the one whose threads are visible/expanded
          var threadList = group.querySelector('[class*="overflow-hidden"]');
          var isActive = threadList ? threadList.scrollHeight > 0 : false;
          workspaces.push({
            id: title,
            title: title.substring(0, 100),
            path: null,
            active: isActive
          });
        }
        if (workspaces.length > 0) return JSON.stringify(workspaces);

        // Strategy 2: Look for folder-row elements outside cwd groups
        var folderRows = d.querySelectorAll('[class*="folder-row"]');
        for (var j = 0; j < folderRows.length; j++) {
          var row = folderRows[j];
          var rowTitle = row.textContent.trim().split('\\n')[0].trim();
          if (rowTitle && rowTitle.length > 0 && rowTitle.length < 200) {
            workspaces.push({
              id: rowTitle,
              title: rowTitle.substring(0, 100),
              path: null,
              active: true
            });
          }
        }
        if (workspaces.length > 0) return JSON.stringify(workspaces);

        // Strategy 3: Fallback — read from terminal prompt path
        var xtermRows = d.querySelector('.xterm-rows');
        if (xtermRows) {
          var rowText = Array.from(xtermRows.children).map(function(r) { return r.textContent; }).join('');
          var pathMatch = rowText.match(/[A-Z]:\\\\[^>]+/);
          if (pathMatch) {
            var p = pathMatch[0];
            workspaces.push({
              id: p,
              title: p.split('\\\\').pop() || p,
              path: p,
              active: true
            });
          }
        }

        return JSON.stringify(workspaces);
      })()
    `);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Switch to a different workspace/folder in Codex Desktop.
 * Attempts to click a folder in the recent list or trigger a folder open action.
 * folderPath is the path string or id from readCodexWorkspaces.
 */
async function switchCodexWorkspace(Runtime, folderPath, usePageEval) {
  const evalFn = usePageEval ? evalInPage : evalInFrame;
  try {
    const raw = await evalFn(Runtime, `
      return (function() {
        var target = ${JSON.stringify(folderPath)};

        // Strategy 1: Click a folder-row in Codex Desktop sidebar by matching workspace name
        var cwdGroups = d.querySelectorAll('[class*="group/cwd"]');
        for (var i = 0; i < cwdGroups.length; i++) {
          var folderRow = cwdGroups[i].querySelector('[class*="folder-row"]');
          if (!folderRow) continue;
          var title = folderRow.textContent.trim().split('\\n')[0].trim();
          if (title === target || title.includes(target)) {
            folderRow.click();
            return JSON.stringify({ ok: true, method: 'cwd-group-click' });
          }
        }

        // Strategy 2: Click "Project actions for {target}" button to open folder management menu
        var actionBtns = Array.from(d.querySelectorAll('button[aria-label]'));
        var actionBtn = actionBtns.find(function(b) {
          var label = b.getAttribute('aria-label') || '';
          return label.includes('Project actions');
        });
        if (actionBtn) {
          actionBtn.click();
          return JSON.stringify({ ok: true, method: 'project-actions-menu', note: 'Project actions menu opened' });
        }

        // Strategy 3: Look for an "Open Folder" button or similar
        var btns = Array.from(d.querySelectorAll('button, [role="button"]'));
        var openBtn = btns.find(function(b) {
          var t = (b.textContent || b.getAttribute('aria-label') || '').trim().toLowerCase();
          return t.includes('open folder') || t.includes('open project') || t.includes('change folder');
        });
        if (openBtn) {
          openBtn.click();
          return JSON.stringify({ ok: true, method: 'open-folder-btn', note: 'System dialog opened — manual selection required' });
        }

        return JSON.stringify({ ok: false, detail: 'workspace-not-found: ' + target });
      })()
    `);
    try { return JSON.parse(raw); } catch { return { ok: false, detail: 'eval-failed' }; }
  } catch (e) {
    return { ok: false, code: 'cdp_error', detail: e.message };
  }
}

// ─── Codex Desktop thread history (Epic 2) ────────────────────────────────────
//
// Codex Desktop (page-level DOM) shows a sidebar/drawer with past conversations.
// Thread list may be accessible via a sidebar toggle or always-visible panel.
// Each thread has a title (typically the first user message or auto-generated).
//
// DOM clues from existing config comments:
//   Conversation: [data-thread-find-target="conversation"]
//   Turns:        [data-content-search-turn-key]
//   Thread IDs may be in the sidebar elements or URL hash

/**
 * Read the list of threads from Codex Desktop sidebar/history.
 * Returns array of { id, title, active, timestamp? } or empty array.
 */
async function readCodexThreadList(Runtime, usePageEval) {
  const evalFn = usePageEval ? evalInPage : evalInFrame;
  try {
    const raw = await evalFn(Runtime, `
      var threads = [];

      // Codex Desktop DOM (confirmed via live CDP inspection 2026-03-22):
      //   <nav> contains action buttons (New thread, Automations, Skills) and thread list
      //   Thread items are <div.group.cursor-interaction.rounded-lg> with text content
      //   Active thread has aria-current="page" on that div
      //   BUT: when Automations/Skills are selected, aria-current="page" moves to
      //   the button, not a thread — so we must not rely on aria-current for discovery.
      //
      // Strategy: directly query all div.group.cursor-interaction.rounded-lg in <nav>.
      // These are thread items (buttons like New thread use <button> tags, not <div>).

      var nav = d.querySelector('nav');
      if (nav) {
        var threadDivs = Array.from(nav.querySelectorAll('div[class*="group"][class*="cursor-interaction"][class*="rounded-lg"]'));
        for (var i = 0; i < threadDivs.length; i++) {
          var clickable = threadDivs[i];
          var fullText = (clickable.textContent || '').trim();
          var lines = fullText.split('\\n').map(function(line) { return line.trim(); }).filter(Boolean);
          var titleLine = lines.find(function(line) { return !/^\\d+[smhd]$/.test(line); }) || fullText;
          // Strip trailing age suffixes like "2d", "15m", "3h" that got concatenated
          var text = titleLine.replace(/\\d+[smhd]$/, '').trim();
          text = text.replace(/[\\uFFFD{}\\]\\[]+/g, ' ').replace(/\\s{2,}/g, ' ').trim();
          if (!text || text.length < 2) continue;
          // Try to extract the age badge from remaining text
          var ageMatch = fullText.match(/(\\d+[smhd])$/);
          var age = ageMatch ? ageMatch[1] : null;
          threads.push({
            id: 'thread-' + threads.length,
            title: text.substring(0, 100),
            age: age,
            active: clickable.getAttribute('aria-current') === 'page',
            index: threads.length
          });
        }
      }

      return JSON.stringify(threads);
    `);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Switch to a specific thread in Codex Desktop by clicking it in the sidebar.
 * threadId can be a data-thread-id, href, or 'thread-N' index pattern.
 */
async function switchCodexThread(Runtime, threadId, usePageEval) {
  const evalFn = usePageEval ? evalInPage : evalInFrame;
  try {
    let beforeThreadList = [];
    try {
      beforeThreadList = await readCodexThreadList(Runtime, usePageEval);
    } catch {}
    const raw = await evalFn(Runtime, `
      (function() {
        function dispatchPress(el) {
          var w = d.defaultView || window;
          if (typeof el.focus === 'function') {
            try { el.focus(); } catch (_) {}
          }
          var rect = el.getBoundingClientRect();
          var cx = rect.x + rect.width / 2;
          var cy = rect.y + rect.height / 2;
          var opts = { bubbles: true, cancelable: true, view: w, clientX: cx, clientY: cy, button: 0 };
          if (w.PointerEvent) {
            el.dispatchEvent(new w.PointerEvent('pointerdown', opts));
          }
          el.dispatchEvent(new w.MouseEvent('mousedown', opts));
          if (w.PointerEvent) {
            el.dispatchEvent(new w.PointerEvent('pointerup', opts));
          }
          el.dispatchEvent(new w.MouseEvent('mouseup', opts));
          el.dispatchEvent(new w.MouseEvent('click', opts));
        }
        var targetId = ${JSON.stringify(threadId)};

        // Strategy 1: Find by data attribute
        var el = d.querySelector('[data-thread-id="' + targetId + '"]') ||
                 d.querySelector('[data-conversation-id="' + targetId + '"]');
        if (el) { dispatchPress(el); return JSON.stringify({ ok: true, method: 'data-attr' }); }

        // Strategy 2: Find by index (thread-N pattern) — matches readCodexThreadList
        var idxMatch = targetId.match(/^thread-(\\d+)$/);
        if (idxMatch) {
          var idx = parseInt(idxMatch[1], 10);

          var clickables = [];
          var nav = d.querySelector('nav');
          if (nav) {
            var threadDivs = Array.from(nav.querySelectorAll('div[class*="group"][class*="cursor-interaction"][class*="rounded-lg"]'));
            for (var i = 0; i < threadDivs.length; i++) {
              var clickable = threadDivs[i];
              var fullText = (clickable.textContent || '').trim();
              var text = fullText.replace(/\\d+[smhd]$/, '').trim();
              if (!text || text.length < 2) continue;
              clickables.push(clickable);
            }
          }

          if (clickables[idx]) {
            dispatchPress(clickables[idx]);
            return JSON.stringify({ ok: true, method: 'index-thread', index: idx });
          }
        }

        return JSON.stringify({ ok: false, detail: 'thread-not-found: ' + targetId });
      })()
    `);
    let initial;
    try { initial = JSON.parse(raw); } catch { initial = null; }
    const attempted = !!initial?.ok || /^thread-\d+$/.test(String(threadId || ''));

    for (let i = 0; i < 8; i++) {
      await new Promise(r => setTimeout(r, 350));
      const idxMatch = String(threadId || '').match(/^thread-(\d+)$/);
      const targetIndex = idxMatch ? parseInt(idxMatch[1], 10) : null;
      const targetTitle = (targetIndex != null && beforeThreadList[targetIndex]?.title) ? beforeThreadList[targetIndex].title : null;
      try {
        const afterThreadList = await readCodexThreadList(Runtime, usePageEval);
        if (targetIndex != null && afterThreadList[targetIndex]?.active) {
          return { ok: true, method: initial.method, verified: 'active-thread' };
        }
        if (JSON.stringify(afterThreadList || []) !== JSON.stringify(beforeThreadList || [])) {
          return { ok: true, method: initial.method, verified: 'thread-list-changed' };
        }
      } catch {}
      try {
        const rawBody = await evalFn(Runtime, `
          JSON.stringify({ body: (d.body && d.body.innerText ? d.body.innerText : '').slice(0, 500) })
        `);
        const bodyText = typeof rawBody === 'string'
          ? rawBody
          : (rawBody && typeof rawBody.body === 'string' ? rawBody.body : '');
        if (bodyText) {
          const lowerBody = bodyText.toLowerCase();
          if (targetTitle && lowerBody.includes(targetTitle.toLowerCase()) && !/let.?s build|enable now/i.test(lowerBody)) {
            return { ok: true, method: initial?.method, verified: 'target-title-visible' };
          }
          if (!/let.?s build|enable now/i.test(lowerBody)) {
            return { ok: true, method: initial?.method, verified: 'body-changed' };
          }
        }
      } catch {}
    }
    if (!attempted) {
      return initial || { ok: false, detail: 'switch-not-attempted' };
    }
    return { ok: false, detail: 'thread-switch-not-observed', method: initial?.method };
  } catch (e) {
    return { ok: false, code: 'cdp_error', detail: e.message };
  }
}

// ─── Codex Panel management (Epic 9) ──────────────────────────────────────────
//
// These functions operate on the Antigravity *workbench page* (type: "page",
// URL contains "workbench.html") to open the Codex extension panel via the
// activity bar, and on the Codex *iframe* to read/switch conversations.
//
// Activity bar: The left-side icon strip in VS Code / Antigravity. Each extension
// view container registers an icon. Codex (openai.chatgpt) has an icon we can
// click to toggle its panel open.
//
// Chat list: The Codex extension webview may contain a sidebar or header with
// a list of past conversations. We read titles and provide switching.

/**
 * Open the Codex extension panel by clicking its activity bar icon.
 * Must be called on the **workbench page** Runtime (not the iframe).
 *
 * Strategy:
 *   1. Find activity bar action with title/aria-label containing "Codex" or "ChatGPT"
 *   2. Click it to toggle the panel open
 *   3. Fallback: look for the view container id pattern
 */
async function openCodexPanel(Runtime) {
  const result = await evalInPage(Runtime, `
    (function() {
      // Strategy 1: Activity bar icon by title/aria-label
      var items = Array.from(d.querySelectorAll(
        '.activitybar .action-item a, ' +
        '.composite.bar .action-item a, ' +
        '[id*="activitybar"] .action-item a'
      ));
      var icon = items.find(function(a) {
        var label = (a.getAttribute('aria-label') || a.title || '').toLowerCase();
        return label.includes('codex') || label.includes('chatgpt') || label.includes('openai');
      });
      if (icon) { icon.click(); return JSON.stringify({ ok: true, method: 'activity-bar-title', detail: icon.getAttribute('aria-label') || icon.title }); }

      // Strategy 2: Look for action item whose associated view container matches openai
      var allActions = Array.from(d.querySelectorAll('.action-item a[role="tab"], .action-item a'));
      icon = allActions.find(function(a) {
        var id = (a.id || a.getAttribute('data-action-id') || '').toLowerCase();
        return id.includes('openai') || id.includes('chatgpt') || id.includes('codex');
      });
      if (icon) { icon.click(); return JSON.stringify({ ok: true, method: 'action-id', detail: icon.id || icon.getAttribute('data-action-id') }); }

      // Strategy 3: Scan all sidebar icons for one whose tooltip/title references Codex
      var badges = Array.from(d.querySelectorAll('.action-item'));
      for (var i = 0; i < badges.length; i++) {
        var a = badges[i].querySelector('a');
        if (!a) continue;
        var allAttrs = '';
        for (var j = 0; j < a.attributes.length; j++) allAttrs += ' ' + a.attributes[j].value.toLowerCase();
        if (allAttrs.includes('openai') || allAttrs.includes('chatgpt') || allAttrs.includes('codex')) {
          a.click();
          return JSON.stringify({ ok: true, method: 'attr-scan', detail: a.id || '' });
        }
      }

      return JSON.stringify({ ok: false, detail: 'no-codex-activity-bar-icon' });
    })()
  `);
  try { return JSON.parse(result); } catch { return { ok: false, detail: 'eval-failed' }; }
}

/**
 * Read the list of conversations/chats from the Codex extension webview.
 * Called on the Codex **iframe** Runtime.
 *
 * Returns array of { id, title, active } or empty array if no chat list found.
 * The chat list may be:
 *   - A sidebar within the webview
 *   - A dropdown/header menu
 *   - Thread items with titles
 */
async function readCodexChatList(Runtime, usePageEval, navigateToList = false) {
  const evalFn = usePageEval ? evalInPage : evalInFrame;

  // Only click Back to navigate to the list when explicitly requested
  // (e.g. from the web UI chat_list_request). During background polling,
  // navigateToList=false so we only read what's already visible — clicking
  // Back during polling would yank the user out of their active conversation.
  if (navigateToList) {
    const needsBack = await evalFn(Runtime, `
      var back = d.querySelector('button[aria-label="Back"]');
      if (back && back.offsetParent !== null) { back.click(); return 'clicked'; }
      return 'already-list';
    `);
    if (needsBack === 'clicked') {
      await new Promise(r => setTimeout(r, 800));
    }
  } else {
    // During background polling, check if we're inside an active conversation
    // (Back button visible = we're in a chat, not on the list).  Return empty
    // so the caller doesn't misinterpret in-chat DOM elements as a chat list.
    const inChat = await evalFn(Runtime, `
      var back = d.querySelector('button[aria-label="Back"]');
      return (back && back.offsetParent !== null) ? 'in-chat' : 'on-list';
    `);
    if (inChat === 'in-chat') return [];
  }

  const raw = await evalFn(Runtime, `
      var chats = [];

      // Strategy 1: Look for conversation/thread list items (sidebar or panel)
      // Common patterns: nav items, list items with conversation titles
      var listItems = d.querySelectorAll(
        '[data-thread-id], ' +
        '[data-conversation-id], ' +
        '[role="listbox"] [role="option"], ' +
        '.conversation-item, .thread-item, .chat-item, ' +
        'nav li a, nav button'
      );
      if (listItems.length > 0) {
        for (var i = 0; i < listItems.length; i++) {
          var el = listItems[i];
          var id = el.getAttribute('data-thread-id') || el.getAttribute('data-conversation-id') || ('idx-' + i);
          var title = (el.textContent || '').trim().substring(0, 100);
          if (!title) continue;
          var active = false;
          try { active = el.classList.contains('active') || el.classList.contains('selected') || el.getAttribute('aria-selected') === 'true' || el.getAttribute('aria-current') === 'true'; } catch(e) {}
          chats.push({ id: id, title: title, active: active });
        }
        if (chats.length > 0) return JSON.stringify(chats);
      }

      // Strategy 2: Look for thread/conversation headings or buttons in a sidebar
      var threadBtns = Array.from(d.querySelectorAll('button, [role="button"], a')).filter(function(el) {
        // Skip tiny buttons (icons), skip the main input area
        if (el.closest('.ProseMirror')) return false;
        var text = (el.textContent || '').trim();
        // Must have some text content and not be a single-char icon
        return text.length > 2 && text.length < 120;
      });
      // Look for a pattern: multiple sibling buttons that look like a conversation list
      var containers = new Map();
      threadBtns.forEach(function(btn) {
        var parent = btn.parentElement;
        if (!parent) return;
        if (!containers.has(parent)) containers.set(parent, []);
        containers.get(parent).push(btn);
      });
      // Find a container with 2+ items that looks like a list
      containers.forEach(function(btns, container) {
        if (btns.length < 2 || chats.length > 0) return;
        btns.forEach(function(btn, idx) {
          var title = (btn.textContent || '').trim().substring(0, 100);
          if (!title) return;
          var active = false;
          try { active = btn.classList.contains('active') || btn.classList.contains('selected') || btn.getAttribute('aria-selected') === 'true'; } catch(e) {}
          chats.push({ id: 'btn-' + idx, title: title, active: active, el_tag: btn.tagName });
        });
      });

      return JSON.stringify(chats);
  `);
  try { return JSON.parse(raw) || []; } catch { return []; }
}

/**
 * Switch to a specific chat/conversation in the Codex extension webview.
 * Called on the Codex iframe Runtime. Clicks the chat item matching the given ID.
 */
async function switchCodexChat(Runtime, chatId, usePageEval) {
  const evalFn = usePageEval ? evalInPage : evalInFrame;
  const raw = await evalFn(Runtime, `
      var targetId = ${JSON.stringify(chatId)};

      // Strategy 1: Find by data attribute
      var el = d.querySelector('[data-thread-id="' + targetId + '"]') ||
               d.querySelector('[data-conversation-id="' + targetId + '"]');
      if (el) { el.click(); return JSON.stringify({ ok: true, method: 'data-attr' }); }

      // Strategy 2: Find by index (idx-N or btn-N pattern)
      var idxMatch = targetId.match(/^(?:idx|btn)-(\\d+)$/);
      if (idxMatch) {
        var idx = parseInt(idxMatch[1], 10);
        // Try same selectors as readCodexChatList
        var items = d.querySelectorAll(
          '[data-thread-id], [data-conversation-id], ' +
          '[role="listbox"] [role="option"], ' +
          '.conversation-item, .thread-item, .chat-item'
        );
        if (items.length > idx) { items[idx].click(); return JSON.stringify({ ok: true, method: 'index-list' }); }

        // Try button-based list
        var threadBtns = Array.from(d.querySelectorAll('button, [role="button"], a')).filter(function(el) {
          if (el.closest('.ProseMirror')) return false;
          var text = (el.textContent || '').trim();
          return text.length > 2 && text.length < 120;
        });
        var containers = new Map();
        threadBtns.forEach(function(btn) {
          var parent = btn.parentElement;
          if (!parent) return;
          if (!containers.has(parent)) containers.set(parent, []);
          containers.get(parent).push(btn);
        });
        var found = false;
        containers.forEach(function(btns) {
          if (found || btns.length < 2) return;
          if (idx < btns.length) { btns[idx].click(); found = true; }
        });
        if (found) return JSON.stringify({ ok: true, method: 'index-btn' });
      }

      return JSON.stringify({ ok: false, detail: 'chat-not-found: ' + targetId });
  `);
  try { return JSON.parse(raw); } catch { return { ok: false, detail: 'eval-failed' }; }
}

/**
 * Start a new chat in the Codex extension panel.
 * For codex (iframe), clicks "New Chat" / "+" / "New Thread" button.
 * For codex-desktop, delegates to newCodexThread.
 */
async function newCodexChat(Runtime, usePageEval) {
  // Reuse existing newCodexThread — same logic applies
  return newCodexThread(Runtime, usePageEval);
}

// ─── Antigravity Panel management (Epic 10) ──────────────────────────────────
//
// These functions operate on the workbench.html page DOM to open/manage the
// Antigravity built-in side panel. The panel lives in the VS Code activity bar
// and its content is rendered directly in the workbench page (not in an iframe).
//
// The activity bar uses VS Code's standard DOM structure:
//   .activitybar .actions-container .action-item a[title*="..."]
//
// The panel itself is inside .antigravity-agent-side-panel and contains:
//   - A header bar with title, "New Chat"/"+" button
//   - A conversation list (when history is available)
//   - The active conversation content (gap-y-3 px-4 flex-col turn container)

/**
 * Detect whether the Antigravity side panel is currently visible/open.
 * Checks both existence and visibility of .antigravity-agent-side-panel.
 */
async function detectAntigravityPanelOpen(Runtime) {
  try {
    const result = await evalInPage(Runtime, `
      var panel = d.querySelector('.antigravity-agent-side-panel');
      if (!panel) return false;
      // Panel exists in DOM but might be hidden (display:none, width:0, etc.)
      var style = window.getComputedStyle(panel);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      if (panel.offsetWidth === 0 && panel.offsetHeight === 0) return false;
      return true;
    `);
    return result === true;
  } catch { return false; }
}

const WORKBENCH_PANE_SUMMARY_EXPR = `
  return (function() {
    function readPane(partSelector) {
      var part = d.querySelector(partSelector);
      if (!part) return null;
      var style = window.getComputedStyle(part);
      var visible = !(style.display === 'none' || style.visibility === 'hidden' || (part.offsetWidth === 0 && part.offsetHeight === 0));
      var text = (part.innerText || '').replace(/\\s+/g, ' ').trim();
      var title = null;
      var titleSelectors = [
        '.composite.title .title-label',
        '.pane-header .title',
        '.pane-header .pane-header-title',
        '.title-label',
        '.monaco-breadcrumbs',
        'h1, h2, h3'
      ];
      for (var i = 0; i < titleSelectors.length && !title; i++) {
        var el = part.querySelector(titleSelectors[i]);
        var candidate = el ? (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim() : '';
        if (candidate) title = candidate;
      }
      if (!title && text) {
        title = text.split(/\\n+/)[0].trim();
      }
      return {
        visible: !!visible,
        title: title || null,
        text: text ? text.slice(0, 800) : ''
      };
    }

    function inferAgent(title, text) {
      var hay = ((title || '') + ' ' + (text || '')).toLowerCase();
      if (!hay) return null;
      if (hay.includes('codex') || hay.includes('gpt-5')) return 'codex';
      if (hay.includes('continue yolo')) return 'continue_yolo';
      if (hay.includes('continue')) return 'continue';
      if (
        hay.includes('antigravity')
        || hay.includes('agent')
        || hay.includes('ask anything, @ to mention')
        || hay.includes('claude')
        || hay.includes('gemini')
        || hay.includes('opus')
        || hay.includes('sonnet')
        || hay.includes('flash')
        || hay.includes('google ai pro')
      ) return 'antigravity_panel';
      return null;
    }

    var sidebar = readPane('.part.sidebar');
    var auxiliary = readPane('.part.auxiliarybar');
    return JSON.stringify({
      sidebar_visible: !!(sidebar && sidebar.visible),
      sidebar_title: (sidebar && sidebar.title) || null,
      sidebar_agent: inferAgent(sidebar && sidebar.title, sidebar && sidebar.text),
      auxiliary_visible: !!(auxiliary && auxiliary.visible),
      auxiliary_title: (auxiliary && auxiliary.title) || null,
      auxiliary_agent: inferAgent(auxiliary && auxiliary.title, auxiliary && auxiliary.text),
    });
  })()
`;

async function readWorkbenchPaneSummary(Runtime) {
  try {
    const raw = await evalInPage(Runtime, WORKBENCH_PANE_SUMMARY_EXPR);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function readAntigravityModelQuota(Runtime) {
  try {
    const raw = await evalInPage(Runtime, READ_ANTIGRAVITY_MODEL_QUOTA_EXPR);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function refreshAntigravityModelQuota(Runtime) {
  try {
    const raw = await evalInPage(Runtime, REFRESH_ANTIGRAVITY_MODEL_QUOTA_EXPR);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function _buildContinueWorkbenchTabExpr(webviewId, actionExpr) {
  return `
    return (function() {
      var webviewId = ${JSON.stringify(webviewId || '')};

      function rect(el) {
        if (!el || !el.getBoundingClientRect) return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
        var r = el.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
      }

      function overlap(a1, a2, b1, b2) {
        return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
      }

      function visibleText(el) {
        return (el.getAttribute('aria-label') || el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
      }

      function resolveIframe() {
        if (!webviewId) return null;
        return d.querySelector('iframe[name="' + webviewId + '"]')
          || d.querySelector('iframe#' + webviewId)
          || null;
      }

      function collectTabs(container) {
        if (!container) return [];
        return Array.from(container.querySelectorAll('[role="tab"], .tab[role="tab"], .tab'))
          .filter(function(tab) {
            var title = visibleText(tab);
            if (!title) return false;
            if (title.length > 180) return false;
            var r = rect(tab);
            return r.width > 20 && r.height > 10;
          });
      }

      function findBestTabContainer() {
        var iframe = resolveIframe();
        if (!iframe) return null;
        var iframeRect = rect(iframe);
        var containers = Array.from(d.querySelectorAll('.tabs-container[role="tablist"], .tabs-container'));
        var best = null;
        var bestScore = null;

        for (var i = 0; i < containers.length; i++) {
          var container = containers[i];
          var tabs = collectTabs(container);
          if (tabs.length === 0) continue;

          var box = rect(container);
          var horizontalOverlap = overlap(box.left, box.right, iframeRect.left, iframeRect.right);
          var verticalGap = Math.abs(iframeRect.top - box.bottom);
          var centerDelta = Math.abs(((box.left + box.right) / 2) - ((iframeRect.left + iframeRect.right) / 2));
          var score = verticalGap + centerDelta + (horizontalOverlap > 0 ? 0 : 10000);

          if (bestScore === null || score < bestScore) {
            best = container;
            bestScore = score;
          }
        }
        return best;
      }

      var tabContainer = findBestTabContainer();
      if (!tabContainer) return JSON.stringify({ ok: false, code: 'no_tab_container', chats: [] });

      var tabs = collectTabs(tabContainer);
      var chats = tabs.map(function(tab, index) {
        return {
          id: 'continue-tab-' + index,
          title: visibleText(tab).substring(0, 120),
          active: tab.getAttribute('aria-selected') === 'true' || tab.classList.contains('active') || tab.classList.contains('selected'),
          index: index
        };
      });

      ${actionExpr}
    })()
  `;
}

async function readContinueWorkbenchChatList(Runtime, webviewId) {
  try {
    const raw = await evalInPage(Runtime, _buildContinueWorkbenchTabExpr(webviewId, `
      return JSON.stringify({ ok: true, chats: chats });
    `));
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed?.chats) ? parsed.chats : [];
  } catch {
    return [];
  }
}

async function switchContinueWorkbenchChat(Runtime, webviewId, chatId) {
  const index = parseInt(String(chatId || '').replace('continue-tab-', ''), 10);
  if (isNaN(index)) {
    return { ok: false, code: 'invalid_chat_id', detail: `Invalid chat ID: ${chatId}` };
  }

  try {
    const raw = await evalInPage(Runtime, _buildContinueWorkbenchTabExpr(webviewId, `
      var targetIndex = ${index};
      if (!tabs[targetIndex]) {
        return JSON.stringify({ ok: false, code: 'chat_not_found', detail: 'tab-not-found' });
      }
      var tab = tabs[targetIndex];
      try { tab.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) {}
      try { tab.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })); } catch (e) {}
      try { tab.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 })); } catch (e) {}
      try { tab.click(); } catch (e) {}
      return JSON.stringify({ ok: true, detail: visibleText(tab) || ('tab-' + targetIndex), chats: chats });
    `));
    return raw ? JSON.parse(raw) : { ok: false, code: 'eval_failed', detail: 'empty-result' };
  } catch (e) {
    return { ok: false, code: 'cdp_error', detail: e.message };
  }
}

/**
 * Open the Antigravity side panel by clicking its activity bar icon.
 * Must be called on the **workbench page** Runtime.
 *
 * Strategies:
 *   1. Click activity bar icon with title/aria-label containing "Agent" or "Antigravity"
 *   2. Look for action items with matching attributes
 *   3. Look for panel toggle buttons
 */
async function openAntigravityPanel(Runtime) {
  try {
    const result = await evalInPage(Runtime, `
      (function() {
        // Strategy 1: Activity bar icon by title/aria-label
        var items = Array.from(d.querySelectorAll(
          '.activitybar .action-item a, ' +
          '.composite.bar .action-item a, ' +
          '[id*="activitybar"] .action-item a'
        ));
        var icon = items.find(function(a) {
          var label = (a.getAttribute('aria-label') || a.title || '').toLowerCase();
          return label.includes('agent') || label.includes('antigravity');
        });
        if (icon) {
          icon.click();
          return JSON.stringify({ ok: true, method: 'activity-bar-title', detail: icon.getAttribute('aria-label') || icon.title });
        }

        // Strategy 2: Look for action item whose id/data-action-id matches antigravity
        var allActions = Array.from(d.querySelectorAll('.action-item a[role="tab"], .action-item a'));
        icon = allActions.find(function(a) {
          var id = (a.id || a.getAttribute('data-action-id') || '').toLowerCase();
          return id.includes('antigravity') || id.includes('agent');
        });
        if (icon) {
          icon.click();
          return JSON.stringify({ ok: true, method: 'action-id', detail: icon.id || icon.getAttribute('data-action-id') });
        }

        // Strategy 3: Scan all sidebar action items for one referencing agent/antigravity
        var badges = Array.from(d.querySelectorAll('.action-item'));
        for (var i = 0; i < badges.length; i++) {
          var a = badges[i].querySelector('a');
          if (!a) continue;
          var allAttrs = '';
          for (var j = 0; j < a.attributes.length; j++) allAttrs += ' ' + a.attributes[j].value.toLowerCase();
          if (allAttrs.includes('antigravity') || allAttrs.includes('agent-side-panel')) {
            a.click();
            return JSON.stringify({ ok: true, method: 'attr-scan', detail: a.id || '' });
          }
        }

        // Strategy 4: Look for a toggle/expand button for the panel
        var toggleBtns = Array.from(d.querySelectorAll('button, [role="button"]'));
        var toggle = toggleBtns.find(function(b) {
          var t = (b.title || b.getAttribute('aria-label') || '').toLowerCase();
          return (t.includes('agent') || t.includes('antigravity')) &&
                 (t.includes('toggle') || t.includes('show') || t.includes('open'));
        });
        if (toggle) {
          toggle.click();
          return JSON.stringify({ ok: true, method: 'toggle-btn', detail: toggle.title || toggle.getAttribute('aria-label') });
        }

        return JSON.stringify({ ok: false, detail: 'no-antigravity-activity-bar-icon' });
      })()
    `);
    try { return JSON.parse(result); } catch { return { ok: false, detail: 'eval-failed' }; }
  } catch (e) {
    return { ok: false, code: 'cdp_error', detail: e.message };
  }
}

/**
 * Read the list of conversations/chats from the Antigravity side panel.
 * The panel may have a conversation history drawer or a list of past chats.
 * Returns array of { id, title, active, index } or empty array.
 */
async function readAntigravityPanelChatList(Runtime) {
  try {
    const raw = await evalInPage(Runtime, `
        var panel = d.querySelector('.antigravity-agent-side-panel');
        if (!panel) return JSON.stringify([]);

        var chats = [];

        // Strategy 1: Look for a conversation list / history section.
        // Common patterns: list items, clickable conversation entries
        var listItems = Array.from(panel.querySelectorAll(
          '[role="listitem"], [role="option"], [role="treeitem"], ' +
          'li, [class*="conversation"], [class*="chat-item"], [class*="history-item"]'
        ));

        for (var i = 0; i < listItems.length; i++) {
          var item = listItems[i];
          var title = (item.textContent || '').trim();
          if (!title || title.length > 200) continue;
          title = title.split('\\n')[0].trim();
          if (!title) continue;

          var isActive = item.classList.contains('active') ||
                         item.classList.contains('selected') ||
                         item.getAttribute('aria-selected') === 'true' ||
                         item.getAttribute('data-active') === 'true';

          chats.push({
            id: 'ag-chat-' + i,
            title: title.substring(0, 100),
            active: isActive,
            index: i
          });
        }

        // Strategy 2: Look for conversation history buttons.
        // These are full-width buttons with "grow" and "cursor-pointer" classes
        // that contain the conversation title and an age indicator.
        if (chats.length === 0) {
          var btns = Array.from(panel.querySelectorAll('button'));
          var chatBtns = btns.filter(function(b) {
            var cls = b.className || '';
            // Match the Antigravity chat history button pattern:
            // full-width, grow, cursor-pointer, flex-row layout
            if (cls.includes('grow') && cls.includes('cursor-pointer') && cls.includes('flex') && cls.includes('w-full')) {
              var t = (b.textContent || '').trim();
              return t.length >= 2 && t.length <= 200;
            }
            return false;
          });

          for (var j = 0; j < chatBtns.length; j++) {
            var btn = chatBtns[j];
            var btnText = (btn.textContent || '').trim();
            // Strip trailing age indicator (e.g. "5d", "2h", "10m")
            var btnTitle = btnText.replace(/\\d+[smhd]$/, '').trim();
            chats.push({
              id: 'ag-chat-' + j,
              title: btnTitle.substring(0, 100),
              active: btn.classList.contains('active') || btn.getAttribute('aria-selected') === 'true',
              index: j
            });
          }
        }

        return JSON.stringify(chats);
    `);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Switch to a specific conversation in the Antigravity side panel.
 * chatId format: 'ag-chat-N' where N is the index from readAntigravityPanelChatList.
 */
async function switchAntigravityPanelChat(Runtime, chatId) {
  const index = parseInt((chatId || '').replace('ag-chat-', ''), 10);
  if (isNaN(index)) {
    return { ok: false, code: 'invalid_chat_id', detail: `Invalid chat ID: ${chatId}` };
  }

  try {
    const result = await evalInPage(Runtime, `
        var panel = d.querySelector('.antigravity-agent-side-panel');
        if (!panel) return 'no-panel';

        var targetIndex = ${index};

        // Strategy 1: Click chat history buttons (full-width grow cursor-pointer)
        var chatBtns = Array.from(panel.querySelectorAll('button')).filter(function(b) {
          var cls = b.className || '';
          if (cls.includes('grow') && cls.includes('cursor-pointer') && cls.includes('w-full')) {
            var t = (b.textContent || '').trim();
            return t.length >= 2 && t.length <= 200;
          }
          return false;
        });

        if (chatBtns[targetIndex]) {
          chatBtns[targetIndex].click();
          return 'clicked-chat-btn';
        }

        // Strategy 2: Click list items (fallback for different DOM structures)
        var listItems = Array.from(panel.querySelectorAll(
          '[role="listitem"], [role="option"], [role="treeitem"], ' +
          'li, [class*="conversation"], [class*="chat-item"], [class*="history-item"]'
        )).filter(function(item) {
          var t = (item.textContent || '').trim();
          return t && t.length <= 200;
        });

        if (listItems[targetIndex]) {
          listItems[targetIndex].click();
          return 'clicked-list-item';
        }

        return 'chat-not-found';
    `);
    if (result && result !== 'no-panel' && result !== 'chat-not-found') {
      return { ok: true, detail: result };
    }
    return { ok: false, code: 'switch_failed', detail: result };
  } catch (e) {
    return { ok: false, code: 'cdp_error', detail: e.message };
  }
}

/**
 * Start a new conversation in the Antigravity side panel.
 * Looks for "New Chat", "New Conversation", or "+" button within the panel.
 */
async function newAntigravityPanelChat(Runtime) {
  try {
    const result = await evalInPage(Runtime, `
        var panel = d.querySelector('.antigravity-agent-side-panel');
        if (!panel) return 'no-panel';

        // Strategy 1: Direct hit — the "new conversation" tooltip anchor
        var newConv = panel.querySelector('[data-tooltip-id="new-conversation-tooltip"]');
        if (newConv) {
          newConv.click();
          return 'clicked-new-conversation-tooltip';
        }

        var allBtns = Array.from(panel.querySelectorAll('button, [role="button"], [role="menuitem"], a[data-tooltip-id]'));

        // Strategy 2: Button/anchor with "New" text
        var newBtn = allBtns.find(function(b) {
          var t = (b.textContent || b.getAttribute('aria-label') || b.title || '').trim().toLowerCase();
          return t === 'new chat' || t === 'new conversation' || t === 'new' ||
                 /new\\s+(chat|conversation|thread)/i.test(t);
        });
        if (newBtn) {
          newBtn.click();
          return 'clicked-new-btn';
        }

        // Strategy 3: "+" button in the panel header
        var plusBtn = allBtns.find(function(b) {
          var t = (b.textContent || b.getAttribute('aria-label') || '').trim();
          return t === '+' || t === 'Add' || /^plus$/i.test(t) ||
                 (b.getAttribute('aria-label') || '').toLowerCase().includes('new');
        });
        if (plusBtn) {
          plusBtn.click();
          return 'clicked-plus';
        }

        // Strategy 4: Icon button/anchor with a plus SVG path
        var iconBtns = allBtns.filter(function(b) {
          return b.querySelector('svg') && (b.textContent || '').trim().length < 5;
        });
        for (var i = 0; i < iconBtns.length; i++) {
          var svg = iconBtns[i].querySelector('svg');
          var paths = svg ? Array.from(svg.querySelectorAll('path, line')) : [];
          var isPlus = paths.some(function(p) {
            var pathD = p.getAttribute('d') || '';
            return pathD.includes('M12 4.5v15') || pathD.includes('M4.5 12h15') ||
                   pathD.includes('M12 5v14') || pathD.includes('M5 12h14') ||
                   pathD.includes('M12 4v16') || pathD.includes('M4 12h16');
          });
          if (isPlus) {
            iconBtns[i].click();
            return 'clicked-svg-plus';
          }
        }

        return 'no-new-button';
    `);
    if (result && result !== 'no-panel' && result !== 'no-new-button') {
      return { ok: true, detail: result };
    }
    return { ok: false, code: 'new_chat_not_found', detail: result };
  } catch (e) {
    return { ok: false, code: 'cdp_error', detail: e.message };
  }
}

// ─── Codex Desktop Skills list ───────────────────────────────────────────────
// Navigates to the Skills tab in Codex Desktop and reads installed/recommended skills.

/**
 * Click the "Skills" button in the Codex Desktop sidebar nav to navigate to it.
 * Returns { ok: true } if found and clicked, or { ok: false } if not found.
 */
async function navigateCodexSkills(Runtime, usePageEval) {
  const evalFn = usePageEval ? evalInPage : evalInFrame;
  try {
    const raw = await evalFn(Runtime, `
      (function() {
        // The nav sidebar has buttons for "New thread", "Automations", "Skills"
        var nav = d.querySelector('nav');
        if (!nav) return JSON.stringify({ ok: false, reason: 'no nav' });
        var buttons = Array.from(nav.querySelectorAll('button'));
        for (var i = 0; i < buttons.length; i++) {
          var text = (buttons[i].textContent || '').trim().toLowerCase();
          if (text === 'skills') {
            buttons[i].click();
            return JSON.stringify({ ok: true });
          }
        }
        // Also check links/anchors
        var links = Array.from(nav.querySelectorAll('a'));
        for (var i = 0; i < links.length; i++) {
          var text = (links[i].textContent || '').trim().toLowerCase();
          if (text === 'skills') {
            links[i].click();
            return JSON.stringify({ ok: true });
          }
        }
        return JSON.stringify({ ok: false, reason: 'skills button not found' });
      })()
    `);
    return JSON.parse(raw || '{"ok":false}');
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

/**
 * Read the skills list from Codex Desktop.
 * Navigates to Skills tab, reads the content, then navigates back to restore
 * the previous view (so thread list is not disrupted).
 * Returns { installed: [...], recommended: [...] }
 */
async function readCodexSkillsList(Runtime, usePageEval) {
  const evalFn = usePageEval ? evalInPage : evalInFrame;

  // Step 1: Navigate to Skills tab
  const navResult = await navigateCodexSkills(Runtime, usePageEval);
  if (!navResult.ok) return { installed: [], recommended: [] };

  // Step 2: Wait a moment for the Skills view to render
  await new Promise(r => setTimeout(r, 600));

  // Step 3: Read skills from the main content area
  try {
    const raw = await evalFn(Runtime, `
      (function() {
        var result = { installed: [], recommended: [] };

        // The Skills page has sections with headings "Installed" and "Recommended"
        // Each skill card has: icon/image, name, description, and an action button
        // Strategy: find all heading elements, then collect cards under each

        var main = d.querySelector('main') || d.querySelector('[role="main"]') || d.body;

        // Find all h2/h3 headings that say "Installed" or "Recommended"
        var headings = Array.from(main.querySelectorAll('h1, h2, h3, h4'));
        var currentSection = null;

        for (var i = 0; i < headings.length; i++) {
          var hText = (headings[i].textContent || '').trim().toLowerCase();
          if (hText === 'installed') currentSection = 'installed';
          else if (hText === 'recommended') currentSection = 'recommended';
        }

        // Strategy: find skill cards — they typically have a consistent structure
        // Look for repeated card-like elements with name + description
        // In the Codex Desktop UI, skills appear as rows/cards with icon, name, description

        // Try to find cards by looking for elements with structured content
        // Each card has: an image/icon, a heading (skill name), a description, and an action button

        // Approach: find all elements that look like list items or cards
        var cards = Array.from(main.querySelectorAll(
          '[class*="card"], [class*="item"], [class*="row"], [class*="skill"]'
        )).filter(function(el) {
          // Must have enough text content to be a skill entry
          var text = (el.textContent || '').trim();
          return text.length > 5 && text.length < 500;
        });

        // If no structured cards found, try a broader approach:
        // Look for elements that contain both a title-like element and a description
        if (cards.length === 0) {
          // Find all button-like or clickable containers that have structured text
          var allEls = Array.from(main.querySelectorAll('div, li, article, section'));
          for (var i = 0; i < allEls.length; i++) {
            var el = allEls[i];
            var children = el.children;
            // A skill card typically has 2-4 child elements (icon, text group, action)
            if (children.length < 2 || children.length > 6) continue;
            // Check for image/icon + text pattern
            var hasImg = el.querySelector('img, svg, [class*="icon"]');
            var textContent = (el.textContent || '').trim();
            if (hasImg && textContent.length > 5 && textContent.length < 300) {
              cards.push(el);
            }
          }
        }

        // Deduplicate: remove cards that are children of other cards
        var filtered = cards.filter(function(card) {
          return !cards.some(function(other) {
            return other !== card && other.contains(card);
          });
        });

        // Determine section for each card based on position relative to headings
        var installedHeading = null, recommendedHeading = null;
        for (var i = 0; i < headings.length; i++) {
          var hText = (headings[i].textContent || '').trim().toLowerCase();
          if (hText === 'installed') installedHeading = headings[i];
          else if (hText === 'recommended') recommendedHeading = headings[i];
        }

        function getRect(el) {
          try { return el.getBoundingClientRect(); } catch(e) { return { top: 0 }; }
        }

        var instY  = installedHeading    ? getRect(installedHeading).top    : -Infinity;
        var recY   = recommendedHeading  ? getRect(recommendedHeading).top  : Infinity;

        filtered.forEach(function(card, idx) {
          var cardY = getRect(card).top;
          // Extract skill name (first heading-like element or bold text)
          var nameEl = card.querySelector('h1, h2, h3, h4, h5, strong, b, [class*="title"], [class*="name"]');
          var name = nameEl ? nameEl.textContent.trim() : '';
          // Extract description
          var descEl = card.querySelector('p, [class*="desc"], [class*="subtitle"]');
          var desc = descEl ? descEl.textContent.trim() : '';
          // If no structured elements found, try splitting text content
          if (!name) {
            var lines = (card.textContent || '').trim().split('\\n').map(function(l) { return l.trim(); }).filter(Boolean);
            name = lines[0] || '';
            desc = lines.slice(1).join(' ').trim();
          }
          if (!name) return;

          // Check for installed indicator (checkmark, ✓, or similar)
          var hasCheck = card.querySelector('[class*="check"], [class*="installed"]');
          var cardText = card.textContent || '';
          var isInstalled = !!hasCheck || /[✓✔☑]/.test(cardText);
          // Check for install/add button (+)
          var hasAdd = card.querySelector('[class*="add"], [class*="install"]');
          var canInstall = !!hasAdd || /^\\+$/.test((card.querySelector('button:last-child') || {}).textContent || '');

          // Extract icon URL if present
          var imgEl = card.querySelector('img');
          var icon = imgEl ? imgEl.src : null;

          var skill = {
            id: 'skill-' + idx,
            name: name.substring(0, 100),
            description: desc.substring(0, 200),
            installed: isInstalled || (cardY < recY),
            icon: icon,
            index: idx
          };

          // Place in correct section based on Y position
          if (recommendedHeading && cardY > recY) {
            result.recommended.push(skill);
          } else {
            result.installed.push(skill);
          }
        });

        return JSON.stringify(result);
      })()
    `);
    const result = JSON.parse(raw || '{"installed":[],"recommended":[]}');
    // Navigate back: click the first thread or "New thread" to restore thread view
    await _navigateCodexBack(evalFn, Runtime);
    return result;
  } catch (e) {
    // Best-effort navigate back even on error
    try { await _navigateCodexBack(evalFn, Runtime); } catch {}
    return { installed: [], recommended: [] };
  }
}

// Codex Desktop native automation detail pane.
// Reads the side pane shown inside a Codex Desktop thread after an automation is
// proposed or selected. This is intentionally non-mutating so polling does not
// move the user between Automations/Skills/thread views.
async function readCodexAutomationView(Runtime, usePageEval) {
  const evalFn = usePageEval ? evalInPage : evalInFrame;
  try {
    const raw = await evalFn(Runtime, `
      (function() {
        function clean(text) {
          return String(text || '').replace(/\\s+/g, ' ').trim();
        }
        function visible(el) {
          if (!el) return false;
          var r = el.getBoundingClientRect();
          var style = window.getComputedStyle(el);
          return r.width >= 220 && r.height >= 160 && style.visibility !== 'hidden' && style.display !== 'none';
        }
        function linesOf(el) {
          return (el.innerText || el.textContent || '')
            .split('\\n')
            .map(function(line) { return clean(line); })
            .filter(Boolean);
        }
        function parseRows(lines, startLabel, endLabels) {
          var start = lines.findIndex(function(line) { return line.toLowerCase() === startLabel.toLowerCase(); });
          if (start < 0) return [];
          var known = ['Status', 'Next run', 'Last ran', 'Chat', 'Interval'];
          var end = lines.length;
          for (var i = start + 1; i < lines.length; i++) {
            if (endLabels.indexOf(lines[i].toLowerCase()) >= 0) {
              end = i;
              break;
            }
          }
          var rows = [];
          for (var j = start + 1; j < end; j++) {
            var line = lines[j];
            var label = null;
            var value = '';
            for (var k = 0; k < known.length; k++) {
              var candidate = known[k];
              if (line === candidate) {
                label = candidate;
                value = lines[j + 1] || '';
                j++;
                break;
              }
              if (line.toLowerCase().startsWith(candidate.toLowerCase() + ' ')) {
                label = candidate;
                value = line.slice(candidate.length).trim();
                break;
              }
            }
            if (label && value && !/^(Status|Details)$/i.test(value)) {
              rows.push({ label: label, value: value });
            }
          }
          return rows;
        }
        function pickTitle(el, lines) {
          var heading = Array.from(el.querySelectorAll('h1,h2,h3')).find(function(h) {
            var text = clean(h.textContent);
            return text && !/^(Status|Details)$/i.test(text);
          });
          if (heading) return clean(heading.textContent).slice(0, 120);
          return (lines.find(function(line) {
            return !/^(Status|Details|Show Automation|Active|Inactive)$/i.test(line);
          }) || '').slice(0, 120);
        }

        var viewportWidth = window.innerWidth || d.documentElement.clientWidth || 0;
        var candidates = Array.from(d.querySelectorAll('aside, [role="complementary"], section, main > div, body > div, div'))
          .filter(visible)
          .map(function(el) {
            var r = el.getBoundingClientRect();
            var text = clean(el.innerText || el.textContent || '');
            var lower = text.toLowerCase();
            var score = 0;
            if (r.left > viewportWidth * 0.45) score += 2;
            if (/\\bshow automation\\b/i.test(text)) score += 8;
            if (/\\bnext run\\b/i.test(text)) score += 4;
            if (/\\blast ran\\b/i.test(text)) score += 4;
            if (/\\binterval\\b/i.test(text)) score += 3;
            if (lower.includes('details')) score += 2;
            if (lower.includes('status')) score += 2;
            if (text.length > 40 && text.length < 2500) score += 1;
            return { el: el, score: score, right: r.right, area: r.width * r.height };
          })
          .filter(function(item) { return item.score >= 8; })
          .sort(function(a, b) {
            return (b.score - a.score) || (b.right - a.right) || (a.area - b.area);
          });

        if (!candidates.length) return JSON.stringify(null);

        var pane = candidates[0].el;
        var lines = linesOf(pane);
        var title = pickTitle(pane, lines);
        if (!title) return JSON.stringify(null);

        var statusIndex = lines.findIndex(function(line) { return /^Status$/i.test(line); });
        var detailsIndex = lines.findIndex(function(line) { return /^Details$/i.test(line); });
        var titleIndex = lines.indexOf(title);
        var descStart = titleIndex >= 0 ? titleIndex + 1 : 1;
        var descEnd = statusIndex >= 0 ? statusIndex : (detailsIndex >= 0 ? detailsIndex : lines.length);
        var description = lines.slice(descStart, descEnd)
          .filter(function(line) { return !/^Show Automation/i.test(line); })
          .join(' ')
          .slice(0, 1200);
        var actionLine = lines.find(function(line) { return /^Show Automation\\b/i.test(line); }) || '';
        var statusRows = parseRows(lines, 'Status', ['details']);
        var detailRows = parseRows(lines, 'Details', []);
        var statusRow = statusRows.find(function(row) { return row.label === 'Status'; });

        return JSON.stringify({
          visible: true,
          title: title,
          description: description,
          status: statusRow ? statusRow.value : '',
          status_rows: statusRows,
          detail_rows: detailRows,
          action_label: actionLine || 'Show Automation',
          updated_at: new Date().toISOString()
        });
      })()
    `);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function clickCodexAutomationAction(Runtime, usePageEval) {
  const evalFn = usePageEval ? evalInPage : evalInFrame;
  try {
    const raw = await evalFn(Runtime, `
      (function() {
        function press(el) {
          if (!el) return false;
          try { el.focus(); } catch (_) {}
          var r = el.getBoundingClientRect();
          var opts = { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
          if (window.PointerEvent) el.dispatchEvent(new PointerEvent('pointerdown', opts));
          el.dispatchEvent(new MouseEvent('mousedown', opts));
          if (window.PointerEvent) el.dispatchEvent(new PointerEvent('pointerup', opts));
          el.dispatchEvent(new MouseEvent('mouseup', opts));
          el.dispatchEvent(new MouseEvent('click', opts));
          return true;
        }
        var controls = Array.from(d.querySelectorAll('button, a, [role="button"]'));
        var target = controls.find(function(el) {
          return /^Show Automation\\b/i.test((el.innerText || el.textContent || el.getAttribute('aria-label') || '').trim());
        });
        return JSON.stringify({ ok: press(target), detail: target ? 'clicked-show-automation' : 'show-automation-not-found' });
      })()
    `);
    return JSON.parse(raw || '{"ok":false,"detail":"no-result"}');
  } catch (e) {
    return { ok: false, detail: e.message };
  }
}

/** Navigate back from Skills/Automations to the thread view by clicking a thread entry. */
async function _navigateCodexBack(evalFn, Runtime) {
  await new Promise(r => setTimeout(r, 100));
  await evalFn(Runtime, `
    (function() {
      var nav = document.querySelector('nav');
      if (!nav) return;
      // Click the first thread entry to go back to thread view
      var threadDivs = nav.querySelectorAll('div[class*="group"][class*="cursor-interaction"][class*="rounded-lg"]');
      if (threadDivs.length > 0) { threadDivs[0].click(); return; }
      // Fallback: click "New thread" button
      var buttons = Array.from(nav.querySelectorAll('button'));
      for (var i = 0; i < buttons.length; i++) {
        if ((buttons[i].textContent || '').trim().toLowerCase() === 'new thread') {
          buttons[i].click();
          return;
        }
      }
    })()
  `);
}

// ─── Close session tab ─────────────────────────────────────────────────────
//
// Clicks the close (X) button on an editor tab in the Antigravity workbench.
// Must be called on the **workbench page** Runtime (not the iframe).
//
// opts.webviewId  — the webview UUID from the CDP target URL (id= param).
//                   Matched against the iframe's name attr, then traced to the
//                   tab via the editor container's aria-flowto.
// opts.chatTitle  — the first ~60 chars of the first user message. Matched
//                   against the tab's aria-label (which shows the truncated title).
//
// Returns { ok: bool, detail: string }

async function closeSessionTab(Runtime, opts) {
  const webviewId = opts.webviewId || '';
  const chatTitle = opts.chatTitle || '';
  const result = await evalInPage(Runtime, `
    (function() {
      var webviewId = ${JSON.stringify(webviewId)};
      var chatTitle = ${JSON.stringify(chatTitle)}.toLowerCase();

      function clickCloseOnTab(tab) {
        var closeBtn = tab.querySelector('[aria-label*="Close"], .codicon-close');
        if (!closeBtn) {
          var actionBar = tab.querySelector('.tab-actions .monaco-action-bar');
          if (actionBar) closeBtn = actionBar.querySelector('a.action-label');
        }
        if (closeBtn) {
          closeBtn.click();
          return true;
        }
        return false;
      }

      var tabs = Array.from(d.querySelectorAll('.tabs-container .tab'));

      // Strategy 1: match via webviewId → find the iframe with that name,
      // walk up to find the editor container's aria-flowto, then find the
      // tab whose data-resource-name points to the same webview panel.
      if (webviewId) {
        // Check if the iframe is in the DOM (active tab)
        var iframe = d.querySelector('iframe[name="' + webviewId + '"]');
        if (iframe) {
          // Walk up to find the editor group container and its active tab
          var container = iframe;
          while (container && !container.classList.contains('editor-group-container')) {
            container = container.parentElement;
          }
          if (container) {
            var groupTabs = Array.from(container.querySelectorAll('.tabs-container .tab'));
            var activeTab = groupTabs.find(function(t) {
              return t.classList.contains('active');
            });
            if (activeTab && clickCloseOnTab(activeTab)) {
              return JSON.stringify({ ok: true, detail: 'iframe-walk: ' + (activeTab.getAttribute('aria-label') || '').substring(0, 60) });
            }
          }
        }

        // Also try: find any webview-editor-element with aria-flowto matching
        var editorEl = d.querySelector('[aria-flowto="' + webviewId + '"]');
        if (editorEl) {
          var container = editorEl;
          while (container && !container.classList.contains('editor-group-container')) {
            container = container.parentElement;
          }
          if (container) {
            var groupTabs = Array.from(container.querySelectorAll('.tabs-container .tab'));
            var activeTab = groupTabs.find(function(t) { return t.classList.contains('active'); });
            if (activeTab && clickCloseOnTab(activeTab)) {
              return JSON.stringify({ ok: true, detail: 'aria-flowto: ' + (activeTab.getAttribute('aria-label') || '').substring(0, 60) });
            }
          }
        }
      }

      // Strategy 2: match by chatTitle prefix against tab aria-label
      if (chatTitle && chatTitle.length > 3) {
        // Tab aria-label is like: "go to the downloads fold…, Editor Group 1"
        // chatTitle is the first 60 chars of the first user message
        // Match the first 20 chars (before truncation with …)
        var prefix = chatTitle.substring(0, 20);
        for (var i = 0; i < tabs.length; i++) {
          var ariaLabel = (tabs[i].getAttribute('aria-label') || '').toLowerCase();
          if (ariaLabel.indexOf(prefix) === 0) {
            if (clickCloseOnTab(tabs[i])) {
              return JSON.stringify({ ok: true, detail: 'chatTitle-match: ' + ariaLabel.substring(0, 60) });
            }
          }
        }
      }

      return JSON.stringify({
        ok: false,
        detail: 'no-match (webviewId=' + webviewId.substring(0, 8) + ' chatTitle=' + chatTitle.substring(0, 20) + ' tabs=' + tabs.length + ')'
      });
    })()
  `);
  try { return JSON.parse(result); } catch { return { ok: false, detail: 'eval-failed' }; }
}

// Override the older closeSessionTab matcher with the same workbench-tab
// locator used for Continue tab enumeration. This is more reliable for
// Continue YOLO editor tabs than walking up from the iframe DOM.
async function closeSessionTab(Runtime, opts) {
  const webviewId = opts.webviewId || '';
  const chatTitle = opts.chatTitle || '';
  try {
    const raw = await evalInPage(Runtime, _buildContinueWorkbenchTabExpr(webviewId, `
      function clickCloseOnTab(tab) {
        if (!tab) return false;
        var closeBtn = tab.querySelector('[aria-label*="Close"], .codicon-close, .monaco-action-bar a.action-label');
        if (!closeBtn) {
          var actions = Array.from(tab.querySelectorAll('a, button, .action-label, .monaco-action-bar *'));
          closeBtn = actions.find(function(el) {
            var label = (el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText || el.textContent || '').toLowerCase();
            var cls = (el.className && typeof el.className === 'string') ? el.className.toLowerCase() : '';
            return label.indexOf('close') >= 0 || cls.indexOf('codicon-close') >= 0;
          }) || null;
        }
        if (!closeBtn) return false;
        try { closeBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })); } catch (e) {}
        try { closeBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 })); } catch (e) {}
        try { closeBtn.click(); } catch (e) {}
        return true;
      }

      var activeTab = tabs.find(function(tab) {
        return tab.getAttribute('aria-selected') === 'true' || tab.classList.contains('active') || tab.classList.contains('selected');
      }) || null;
      var targetTab = activeTab;

      if ((!targetTab || !webviewId) && chatTitle && chatTitle.length > 3) {
        var prefix = chatTitle.toLowerCase().substring(0, 20);
        targetTab = tabs.find(function(tab) {
          return (visibleText(tab) || '').toLowerCase().indexOf(prefix) === 0;
        }) || targetTab;
      }

      if (!targetTab && tabs.length === 1) targetTab = tabs[0];
      if (!targetTab) {
        return JSON.stringify({
          ok: false,
          code: 'tab_not_found',
          detail: 'no-match (webviewId=' + webviewId.substring(0, 8) + ' chatTitle=' + chatTitle.substring(0, 20) + ' tabs=' + tabs.length + ')'
        });
      }

      var title = visibleText(targetTab).substring(0, 120);
      if (!clickCloseOnTab(targetTab)) {
        return JSON.stringify({ ok: false, code: 'close_button_not_found', detail: title || 'close-btn-missing' });
      }
      return JSON.stringify({ ok: true, detail: title || 'closed-tab' });
    `));
    return raw ? JSON.parse(raw) : { ok: false, code: 'eval_failed', detail: 'empty-result' };
  } catch (e) {
    return { ok: false, code: 'cdp_error', detail: e.message };
  }
}

module.exports = {
  detectAgentType,
  detectThinking,
  readMessages,
  readAgentConfig,
  setAgentModel,
  setAgentPermissionMode,
  setAntigravityMode,
  interruptAgent,
  detectPermissionDialog,
  detectSessionErrorPrompt,
  respondToPermissionDialog,
  respondToSessionErrorPrompt,
  sendMessage,
  steerCodexInput,
  getSelectorFailures,
  evalInFrame,
  cacheInnerContextId,
  evalInPage,
  // Roo Code
  readRooCodeMessages,
  detectRooCodeThinking,
  sendRooCodePrimary,
  sendRooCodeFallback,
  readRooCodeConfig,
  setRooCodeModel,
  setRooCodePermissionMode,
  detectRooCodePermissionDialog,
  readAntigravitySessionTitle,
  readAntigravityPanelTitle,
  readAntigravityPanelSummary,
  detectAntigravityPanelHasContent,
  readCodexRateLimit,
  readClaudeRateLimit,
  readRateLimit,
  readAntigravityModelQuota,
  refreshAntigravityModelQuota,
  readCodexNativeQueue,
  readCodexTaskList,
  setCodexDesktopConfig,
  newCodexThread,
  // Epic 2 — Thread history
  readCodexThreadList,
  switchCodexThread,
  // Epic 3 — Workspace switching
  readCodexWorkspaces,
  switchCodexWorkspace,
  // Epic 9 — Codex Panel management
  openCodexPanel,
  readCodexChatList,
  switchCodexChat,
  newCodexChat,
  // Epic 4 — Terminal output
  readCodexTerminalOutput,
  writeCodexTerminalInput,
  // Epic 5 — File changes / diff viewer
  readCodexFileChanges,
  // Epic 6 — Image/file attachment
  injectCodexImage,
  // Epic 7 — Sandbox status
  readCodexSandboxStatus,
  // Epic 10 — Antigravity Panel management
  detectAntigravityPanelOpen,
  openAntigravityPanel,
  readWorkbenchPaneSummary,
  readContinueWorkbenchChatList,
  switchContinueWorkbenchChat,
  readAntigravityPanelChatList,
  switchAntigravityPanelChat,
  newAntigravityPanelChat,
  // Skills — Codex Desktop skills list
  readCodexSkillsList,
  navigateCodexSkills,
  readCodexAutomationView,
  clickCodexAutomationAction,
  // Session close — click the tab/panel close button
  closeSessionTab,
  // Continue extension
  readContinueConfig,
  readContinueConfigFromWorkbench,
  readContinueMessagesFromWorkbench,
  detectContinueThinkingFromWorkbench,
  detectContinuePermissionDialogFromWorkbench,
  evalInWorkbenchWebview,
};
