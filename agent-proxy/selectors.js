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
  scrollContainer: '.overflow-y-scroll.no-scrollbar.flex-1',  // conversation scroll area
  threadMsg: '.thread-message',                               // assistant message wrapper
  markdownBody: '.sc-eDPEul',                                 // rendered markdown inside thread-message
};

const CONTINUE_FALLBACK = {
  input:   '.tiptap.ProseMirror[contenteditable="true"]',
  sendBtn: 'button[data-testid="submit-input-button"]',
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
        const f = document.getElementById('active-frame');
        if (!f || !f.contentDocument) return JSON.stringify({ error: 'no-active-frame' });
        const d = f.contentDocument;
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
  });
  if (result.exceptionDetails) {
    const desc = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
    throw new Error(`JS exception: ${desc}`);
  }
  return result.result?.value ?? null;
}

// ─── Core frame eval helper ───────────────────────────────────────────────────

async function evalInFrame(Runtime, code) {
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
      // Context may be stale — fall through to the standard path
      Runtime._innerContextId = null;
    } catch {
      Runtime._innerContextId = null;
    }
  }

  const result = await Runtime.evaluate({
    expression: `(function() {
      const f = document.getElementById('active-frame');
      if (!f || !f.contentDocument) return null;
      const d = f.contentDocument;
      ${code}
    })()`,
    returnByValue: true,
    awaitPromise: false,
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
    const handler = (params) => { contexts.push(params.context); };
    Runtime.on('executionContextCreated', handler);
    // Re-trigger context events by disabling then re-enabling Runtime
    Runtime.disable().then(() => Runtime.enable()).then(() => {
      setTimeout(() => {
        try { Runtime.off('executionContextCreated', handler); } catch { }
        // The inner active-frame context has a higher id than the outer webview
        if (contexts.length > 1) {
          contexts.sort((a, b) => b.id - a.id);
          Runtime._innerContextId = contexts[0].id;
        }
        resolve(Runtime._innerContextId || null);
      }, 300);
    }).catch(() => resolve(null));
  });
}

// ─── Agent type detection ─────────────────────────────────────────────────────

async function detectAgentType(Runtime, extensionIdHint) {
  const result = await Runtime.evaluate({
    expression: `(function() {
      const f = document.getElementById('active-frame');
      if (!f || !f.contentDocument) return null;
      const d = f.contentDocument;
      if (d.querySelector('${CLAUDE_PRIMARY.detect}')) return 'claude';
      if (d.querySelector('${CONTINUE_PRIMARY.detect}')) return 'continue';
      if (d.querySelector('${CODEX_PRIMARY.detect}')) return 'codex';
      if (d.querySelector('${GEMINI_PRIMARY.detect}')) return 'gemini';
      if (d.querySelector('${CLAUDE_FALLBACK.detect}')) return 'claude';
      return null;
    })()`,
    returnByValue: true,
    awaitPromise: false,
  });
  const detected = result.result?.value ?? null;
  if (detected) return detected;

  // Last resort: use extension ID hint (covers empty/loading panels)
  const hint = String(extensionIdHint || '').toLowerCase();
  if (hint.includes('gemini') || hint.includes('googlecloud') || hint.includes('geminicodeassist')) return 'gemini';
  if (hint.includes('continue.continue')) return 'continue';
  return null;
}

// ─── Thinking detection ───────────────────────────────────────────────────────

async function detectThinking(Runtime, agentType) {
  if (agentType === 'continue') return detectContinueThinking(Runtime);
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
        // Codex shows a stop button (aria-label contains "stop") while generating.
        // Also check if the send button SVG changed from arrow to square (stop icon).
        var isThinking = false;
        var stopBtn = d.querySelector('button[aria-label*="Stop" i], button[aria-label*="stop" i]');
        if (stopBtn && stopBtn.offsetParent !== null) {
          isThinking = true;
        }
        // Check for visible "Thinking" or "Generating" text — Codex shows this
        // as a spinner label even when no stop button is present.
        if (!isThinking) {
          var spans = d.querySelectorAll('span');
          for (var si = 0; si < spans.length; si++) {
            var st = (spans[si].textContent || '').trim();
            if ((st === 'Thinking' || st === 'Generating') && spans[si].offsetParent !== null && spans[si].children.length === 0) {
              isThinking = true;
              break;
            }
          }
        }
        // Fallback: check send button opacity — when generating, it may have full opacity
        // with a different SVG. The idle send button has opacity-50.
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
                var svg = lastBtn.querySelector('svg path');
                // Idle send arrow: "M9.334" (old) or "M4.5 5.75" (new).
                // Stop icon uses a rect or a very different path (e.g. square).
                // Only trigger thinking if we see a STOP icon, not just an unknown send arrow.
                if (svg) {
                  var pathD = svg.getAttribute('d') || '';
                  var isKnownSendArrow = pathD.startsWith('M9.334') || pathD.startsWith('M4.5 5.75') || pathD.startsWith('M4.5 ');
                  if (!isKnownSendArrow) isThinking = true;
                }
                // Also check for rect-based stop icon (square)
                var stopRect = lastBtn.querySelector('svg rect');
                if (stopRect) isThinking = true;
              }
            }
          }
        }

        if (!isThinking) return JSON.stringify({ thinking: false, label: '' });

        // Enhanced activity detection: extract granular activity label + command content.
        var label = 'Generating';
        var thinkingContent = '';
        try {
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
        } catch(e) {}

        return JSON.stringify({ thinking: true, label: label, thinkingContent: thinkingContent });
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
            var children = openDetails.childNodes;
            for (var ci = 0; ci < children.length; ci++) {
              var child = children[ci];
              if (child.nodeName.toUpperCase() === 'SUMMARY') continue;
              var txt = (child.innerText || child.textContent || '').trim();
              if (txt) result.thinkingContent += (result.thinkingContent ? '\\n' : '') + txt;
            }
            if (result.thinkingContent.length > 2000) result.thinkingContent = result.thinkingContent.substring(0, 2000) + '…';
          } catch(e) {}
          return JSON.stringify(result);
        }
        // Spinner visible but no open thinking details = generating after thinking
        if (result.spinnerVerb) {
          result.thinking = true;
          result.label = result.spinnerVerb;
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
                if (li < prefixLen || li >= maxOrig - suffixLen) {
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
              body = lines.join('\\n');
            } else if (!bodyEl.querySelector('.monaco-diff-editor')) {
              body = bodyEl.textContent.trim();
            }
          }
        }
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
  try {
    const count = await evalInFrame(Runtime, `
      window.__rac_exp = Array.from(d.querySelectorAll('details:not([open])')).filter(function(el) {
        var s = el.querySelector('summary');
        return s && /^\\d+\\s+lines?(?:\\s+of\\s+output)?$/i.test(s.textContent.trim());
      });
      window.__rac_exp.forEach(function(el) {
        el.open = true;
        // NOTE: do NOT dispatch synthetic click events here — they can propagate
        // focus to the host BrowserWindow, causing focus-stealing between
        // multiple Antigravity windows.  Setting el.open = true is sufficient
        // to expose the DOM content for reading.
      });
      return window.__rac_exp.length;
    `);
    const n = Number(count) || 0;
    if (n === 0) return 0;
    // Poll until all expanded details have non-summary DOM content (React lazy render).
    // Up to 20 × 150 ms = 3 s total.
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 150));
      const ready = await evalInFrame(Runtime, `
        var all = window.__rac_exp || [];
        var done = all.every(function(el) {
          return Array.from(el.childNodes).some(function(n) {
            return n.nodeName.toUpperCase() !== 'SUMMARY' && (n.textContent || '').trim().length > 0;
          });
        });
        return done;
      `).catch(() => true); // if eval fails, stop waiting
      if (ready) break;
    }
    return n;
  } catch {
    return 0;
  }
}

function _collapseOutputDetails(Runtime) {
  evalInFrame(Runtime, `
    if (window.__rac_exp) {
      window.__rac_exp.forEach(function(el) { el.open = false; });
      window.__rac_exp = null;
    }
  `).catch(() => {});
}

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
      var cmdEls = el.querySelectorAll('[class*="group/command"]');
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
      var fileDiff = el.querySelector('[class*="group/file-diff"], [class*="thread-diff"]');
      if (fileDiff) {
        var fnameBtns = fileDiff.querySelectorAll('button[data-state]');
        var seenFiles = {};
        fnameBtns.forEach(function(fb) {
          var visSpan = fb.querySelector('span:not(.hidden):not([class*="hidden"])');
          var fname = visSpan ? visSpan.textContent.trim() : (fb.textContent || '').trim();
          // De-duplicate filename (responsive span renders name twice)
          if (fname && fname.length > 4) {
            var fhalf = Math.floor(fname.length / 2);
            if (fname.substring(0, fhalf) === fname.substring(fhalf)) fname = fname.substring(0, fhalf);
          }
          if (fname && fname.length < 200 && !seenFiles[fname]) {
            seenFiles[fname] = true;
            var diffContent = _extractDiffFromShadow(el);
            var block = '[Edit ' + fname + ']\\n';
            if (diffContent) block += diffContent + '\\n';
            block += '[end]';
            pendingAssistant.push(block);
          }
        });
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

async function readCodexMessages(Runtime, sessionId, usePageEval) {
  // Keep background polling read-only.
  // Expanding/collapsing Codex disclosure rows during every poll causes visible
  // UI thrash in the desktop app, so we only read what is already rendered.
  try {
    const raw = usePageEval
      ? await evalInPage(Runtime, CODEX_READ_EXPR)
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
      return '\\n' + fence + lang + '\\n' + (codeEl || node).textContent.trim() + '\\n' + fence + '\\n';
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
      return '\\n' + fence + lang + '\\n' + (codeEl || node).textContent.trim() + '\\n' + fence + '\\n';
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

  var scrollContainer = d.querySelector('${CONTINUE_PRIMARY.scrollContainer}');
  if (!scrollContainer) return JSON.stringify([]);

  var msgs = [];
  var children = Array.from(scrollContainer.children);

  for (var i = 0; i < children.length; i++) {
    var child = children[i];

    // User turn: contains a non-main input box
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
      // Use textContent (not innerText) to avoid triggering layout reflow
      // which causes Continue's scroll position to reset to top.
      var text = markdown ? (markdown.textContent || '').trim() : '';

      // Tool call blocks are siblings of .thread-message (div.py-1).
      var toolSummary = '';
      var py1 = child.querySelector('.py-1');
      if (py1) {
        toolSummary = (py1.textContent || '').trim().split('\\n')[0].substring(0, 120);
      }

      // Combine text response + tool summary
      if (text && toolSummary) {
        text = toolSummary + '\\n' + text;
      } else if (!text && toolSummary) {
        text = toolSummary;
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

async function detectContinueThinking(Runtime) {
  try {
    const raw = await evalInFrame(Runtime, `
      // Continue shows a stop button while the model is generating.
      // The submit button text changes or a loading indicator appears.
      var submitBtns = d.querySelectorAll('[data-testid="submit-input-button"]');
      var lastSubmit = submitBtns[submitBtns.length - 1];
      if (!lastSubmit) return JSON.stringify({ thinking: false, label: '' });

      // Check if the button shows a stop icon (pause/stop SVG) or is disabled
      var isDisabled = lastSubmit.disabled;
      var svgPaths = lastSubmit.querySelectorAll('svg path');
      var hasStopIcon = false;
      for (var i = 0; i < svgPaths.length; i++) {
        var pathD = svgPaths[i].getAttribute('d') || '';
        // Stop icons typically use rect/square paths, not arrow paths
        if (pathD.includes('M6') && pathD.includes('18') && !pathD.includes('M12')) {
          hasStopIcon = true;
          break;
        }
      }

      // Also check for any visible loading/spinner elements near the conversation
      var spinners = d.querySelectorAll('[class*=animate-spin], [class*=loading], [class*=spinner]');
      var hasSpinner = false;
      for (var i = 0; i < spinners.length; i++) {
        if (spinners[i].offsetParent !== null) { hasSpinner = true; break; }
      }

      var thinking = hasStopIcon || hasSpinner;
      return JSON.stringify({ thinking: thinking, label: thinking ? 'Generating' : '' });
    `);
    try { return JSON.parse(raw); } catch { return { thinking: false, label: '' }; }
  } catch {
    return { thinking: false, label: '' };
  }
}

async function sendContinuePrimary(Runtime, text) {
  // Set text in the main TipTap editor via execCommand
  const set = await evalInFrame(Runtime, `
    var input = d.querySelector('${CONTINUE_PRIMARY.input}');
    if (!input) return 'no-input';
    input.focus();
    // TipTap/ProseMirror: use execCommand to insert text so the editor state updates
    d.execCommand('selectAll', false, null);
    d.execCommand('delete', false, null);
    var ok = d.execCommand('insertText', false, ${JSON.stringify(text)});
    if (!ok) {
      // Fallback: set innerHTML and dispatch input event
      input.innerHTML = '<p>' + ${JSON.stringify(text)}.replace(/\\n/g, '</p><p>') + '</p>';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return 'ok';
  `);
  if (set !== 'ok') return { ok: false, code: 'input_not_found', detail: set };

  // Wait for TipTap to process the input
  await new Promise(r => setTimeout(r, 200));

  // Click the last submit button (the main one)
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
  const result = await evalInFrame(Runtime, `
    var input = d.querySelector('${CONTINUE_FALLBACK.input}');
    if (!input) return 'no-input';
    input.focus();
    d.execCommand('selectAll', false, null);
    d.execCommand('delete', false, null);
    var ok = d.execCommand('insertText', false, ${JSON.stringify(text)});
    if (!ok) {
      input.textContent = ${JSON.stringify(text)};
      input.dispatchEvent(new Event('input', { bubbles: true }));
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
      return '\\n' + fence + lang + '\\n' + (codeEl || node).textContent.trim() + '\\n' + fence + '\\n';
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
      return '\\n' + fence + lang + '\\n' + (codeEl || node).textContent.trim() + '\\n' + fence + '\\n';
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
      if (!panel) return JSON.stringify({ thinking: false, label: '' });
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
      return JSON.stringify({ thinking: isThinking, label: isThinking ? 'Working' : '' });
    `);
    try { return JSON.parse(raw); } catch { return { thinking: false, label: '' }; }
  } catch {
    return { thinking: false, label: '' };
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
      // The model name sits in a div.min-w-0 in the toolbar left-div (confirmed by DOM inspection).
      // Strategy: find Send button, walk up to toolbar, parse innerText lines.
      var model = null;
      var sendBtn = Array.from(d.querySelectorAll('button')).find(function(b){ return b.textContent.trim() === 'Send'; });
      if (sendBtn) {
        var toolbar = sendBtn.parentElement;
        while (toolbar && toolbar.querySelectorAll('button').length < 3) {
          toolbar = toolbar.parentElement;
        }
        if (toolbar) {
          var lines = toolbar.innerText.split('\\n').map(function(s){ return s.trim(); }).filter(Boolean);
          // Match only lines that look like model names (contain known model keywords,
          // are short enough to not be description text, and aren't UI labels).
          var knownLabels = ['Planning', 'Fast', 'Send', 'Conversation mode', 'Model', 'Mode'];
          var modelPat = /gemini|claude|gpt|flash|pro|mini|sonnet|opus|haiku/i;
          var modelLines = lines.filter(function(l) {
            return knownLabels.indexOf(l) === -1 && l.length > 2 && l.length < 60 && modelPat.test(l);
          });
          if (modelLines.length > 0) model = modelLines[0];
        }
      }

      // --- Conversation mode ---
      // The Planning button ([role="button"][aria-haspopup="dialog"]) has a sibling [role="dialog"]
      // that contains 'Planning' and 'Fast' items.  The active item has bg-gray-500/20 in className.
      var mode = 'unknown';
      var planBtn = Array.from(d.querySelectorAll('[role="button"][aria-haspopup="dialog"]')).find(function(el) {
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
  if (agentType === 'continue')           return readContinueMessages(Runtime, sessionId);
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
    : agentType; // 'continue', 'gemini', 'claude', 'codex' pass through
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
// Reads model, effort, and access level from the Codex (openai.chatgpt) composer
// toolbar buttons.  These values are displayed as read-only — Codex does not
// expose its settings via in-DOM dropdowns (they use VS Code host APIs instead).

const READ_CODEX_CONFIG_EXPR = `
  var config = { model_id: null, effort: null, access: null };
  var btns = Array.from(d.querySelectorAll('button'));
  var lastBtns = btns.slice(-25);

  // Model: button text matching GPT-x.x or o1/o3/o4 patterns in composer area
  var modelBtn = lastBtns.find(function(b) {
    var t = (b.textContent || '').trim();
    return /^gpt[-\\s.]?[\\d.]+|^o[134][-\\s.]/i.test(t) && t.length < 20;
  });
  if (modelBtn) config.model_id = modelBtn.textContent.trim();

  // Effort level: Low / Medium / High / Extra High button
  var effortBtn = lastBtns.find(function(b) {
    return /^(low|medium|high|extra\s*high)$/i.test((b.textContent || '').trim());
  });
  if (effortBtn) config.effort = effortBtn.textContent.trim();

  // Access mode: "Full access", "Read access", "Default permissions", etc.
  var accessBtn = lastBtns.find(function(b) {
    var t = (b.textContent || '').trim();
    return (/access|restricted/i.test(t) && !/add|ide|file$/i.test(t) && t.length < 30) ||
           /^default\\s+permissions$/i.test(t);
  });
  if (accessBtn) config.access = accessBtn.textContent.trim();

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
        results.push({
          file: headerText,
          content: codeContent ? codeContent.textContent.trim().substring(0, 8000) : '',
          type: 'diff',
          panelVisible: isVisible
        });
      }
    }

    // If no individual files found but panel has content, grab the raw text
    if (results.length === 0 && isVisible) {
      var panelText = diffPanel.textContent.trim();
      if (panelText && !panelText.includes('No unstaged changes')) {
        results.push({
          file: null,
          content: panelText.substring(0, 8000),
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
        results.push({
          file: fileMatch ? fileMatch[1] : null,
          content: text.substring(0, 8000),
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

  var rateWordPat = /rate.?limit|usage.?limit|too many requests|blocked until|available after|quota exceeded/i;
  var resetWordPat = /try again after|available after|reset(s)? (on|at|after)|blocked until|quota exceeded/i;
  var conv = d.querySelector('[data-thread-find-target="conversation"]');

  // Scan only short, visible, status-like UI text outside the transcript.
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
    var header = null;
    var spans = d.querySelectorAll('span');
    for (var i = 0; i < spans.length; i++) {
      if (/\\d+ out of \\d+ tasks/.test(spans[i].textContent.trim())) { header = spans[i]; break; }
    }
    if (!header) return null;
    var headerText = header.textContent.trim();
    var match = headerText.match(/(\\d+) out of (\\d+)/);
    var planItems = d.querySelectorAll('div[id^="plan-item-"]');
    if (planItems.length === 0) return null;
    var tasks = [];
    for (var j = 0; j < planItems.length; j++) {
      var item = planItems[j];
      var rect = item.getBoundingClientRect();
      if (rect.height <= 0) continue;
      // Second child is the task description span (first child is the number+icon)
      var descSpan = item.children.length > 1 ? item.children[1] : null;
      var text = descSpan ? descSpan.textContent.trim() : item.textContent.trim().replace(/^\\d+\\.\\s*/, '');
      var hasSpinner = !!item.querySelector('[class*="animate-spin"]');
      var hasLineThrough = descSpan ? (descSpan.className || '').toString().indexOf('line-through') >= 0 : false;
      var state = hasSpinner ? 'in_progress' : hasLineThrough ? 'completed' : 'pending';
      tasks.push({ index: j, text: text, state: state });
    }
    // Mark completed tasks based on header count (Codex marks first N as completed)
    var completedCount = match ? parseInt(match[1]) : 0;
    for (var k = 0; k < tasks.length; k++) {
      if (tasks[k].state === 'pending' && k < completedCount) tasks[k].state = 'completed';
    }
    return JSON.stringify({ completed: completedCount, total: match ? parseInt(match[2]) : tasks.length, tasks: tasks });
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
  if (agentType === 'continue') return null; // Continue uses local models — no rate limiting
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
  if (agentType === 'continue') {
    try {
      const raw = await evalInFrame(Runtime, `
        var btn = d.querySelector('[data-testid="model-select-button"]');
        if (!btn) return JSON.stringify({ model: 'unknown', available_models: [] });
        var model_id = btn.textContent.trim();
        // Open dropdown to scrape available models
        btn.click();
        return JSON.stringify({ open: true, model: model_id });
      `);
      let parsed = { model: 'unknown', available_models: [] };
      if (raw) {
        var r = JSON.parse(raw);
        parsed.model = r.model;
        if (r.open) {
          await new Promise(res => setTimeout(res, 300));
          const modelsRaw = await evalInFrame(Runtime, `
            var opts = Array.from(d.querySelectorAll('.truncate, div[class*="option"], [role="option"], [role="menuitem"]'));
            var models = [];
            for (var i = 0; i < opts.length; i++) {
              var textEl = opts[i].querySelector('.truncate') || opts[i];
              var t = textEl.textContent.trim().replace(/\\n/g, '').replace(/\\r/g, '');
              if (t && opts[i].offsetParent !== null && !models.includes(t)) {
                if (t.length < 50 && !t.includes("Select model") && !t.includes("Add Chat model")) {
                  models.push(t);
                }
              }
            }
            if (models.length === 0) {
              models = Array.from(d.querySelectorAll('h3')).map(function(el) { return el.textContent.trim(); }).filter(Boolean).slice(0, 50);
            }
            // Close dropdown
            var menuBtn = d.querySelector('[data-testid="model-select-button"]');
            if (menuBtn) menuBtn.click();
            return JSON.stringify({ available_models: models });
          `);
          if (modelsRaw) {
            var m = JSON.parse(modelsRaw);
            parsed.available_models = m.available_models || [];
          }
        }
      }
      return {
        model_id:          parsed.model || 'unknown',
        mode:              'unknown',
        permission_mode:   'unknown',
        available_models:  parsed.available_models || [],
        file_access_scope: workspacePath || 'unknown',
      };
    } catch {
      return { model_id: 'unknown', permission_mode: 'unknown', available_models: [], file_access_scope: workspacePath || 'unknown' };
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

  if (agentType === 'codex' || agentType === 'codex-desktop') {
    const usePageEval = agentType === 'codex-desktop';
    const cfg = await readCodexConfig(Runtime, usePageEval);
    const result = {
      model_id:          cfg?.model_id  || 'unknown',
      permission_mode:   cfg?.access    || 'unknown',
      effort:            cfg?.effort    || 'unknown',
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
    const raw = await evalInFrame(Runtime, `
      var btn = d.querySelector('[data-testid="model-select-button"]');
      if (!btn) return JSON.stringify({ error: 'no-model-btn' });
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
        if (menuBtn) menuBtn.click(); // close dropdown
        return JSON.stringify({ error: 'option_not_found', available: available });
      }
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

const PERMISSION_DIALOG_EXPR = `
  var dlg = null;

  // 0. Claude Code specific: permissionRequestContainer is the inline permission prompt
  //    It has buttons like Reject/Run/Allow and a description of what's being requested.
  //    Must check BEFORE generic [class*="permission"] to avoid matching permissionsContainer_07S1Yg
  //    (which is the always-visible permission mode indicator, not a dialog).
  var ccPerm = d.querySelectorAll('[class*="permissionRequestContainer"]');
  for (var pi = 0; pi < ccPerm.length; pi++) {
    var p = ccPerm[pi];
    if (p.offsetParent !== null && p.querySelectorAll('button').length >= 1) {
      dlg = p; break;
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
  return JSON.stringify({ message: msg, choices: choices });
`;

function _buildPermissionClickExpr(choiceId) {
  return `
    var dlg = null;
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
    found.click();
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
  var panel = d.querySelector('.antigravity-agent-side-panel');
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

  if (!rejectBtn) return null;

  // Walk up to find the prompt container — look for the nearest ancestor that
  // contains both the reject button and descriptive text
  var container = rejectBtn.parentElement;
  while (container && container !== panel) {
    // Stop when we find a container that has descriptive text beyond just button labels
    var containerText = (container.innerText || '').trim();
    if (containerText.length > 30 && container.querySelectorAll('button').length >= 2) break;
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
  var btns = Array.from(container.querySelectorAll('button'));
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
    var cid = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || ('choice_' + bi);
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
        var optCid = optLabel.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
        // Only add if not already present
        if (!choices.some(function(c) { return c.choice_id === optCid; })) {
          choices.push({ choice_id: optCid, label: optLabel });
        }
      }
    }
  }

  if (choices.length < 2) return null;
  return JSON.stringify({ message: msg, choices: choices });
`;

// Click handler for Antigravity panel inline permission prompts
function _buildPanelPermissionClickExpr(choiceId) {
  return `
    var panel = d.querySelector('.antigravity-agent-side-panel');
    if (!panel) return 'no-panel';

    var allBtns = Array.from(panel.querySelectorAll('button'));
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
      if (containerText.length > 30 && container.querySelectorAll('button').length >= 2) break;
      container = container.parentElement;
    }
    if (!container || container === panel) container = rejectBtn.parentElement;

    var target = ${JSON.stringify(choiceId)};

    // First try buttons
    var btns = Array.from(container.querySelectorAll('button'));
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

    if (!found) return 'no-match';
    if (found.disabled || found.getAttribute('aria-disabled') === 'true') return 'disabled';
    // Dispatch full pointer+mouse event sequence for React compatibility
    var rect = found.getBoundingClientRect();
    var cx = rect.x + rect.width / 2;
    var cy = rect.y + rect.height / 2;
    var opts = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy, button: 0 };
    found.dispatchEvent(new PointerEvent('pointerdown', opts));
    found.dispatchEvent(new MouseEvent('mousedown', opts));
    found.dispatchEvent(new PointerEvent('pointerup', opts));
    found.dispatchEvent(new MouseEvent('mouseup', opts));
    found.dispatchEvent(new MouseEvent('click', opts));
    return 'clicked';
  `;
}

// Returns { message, choices: [{choice_id, label}] } or null if no dialog.
async function detectPermissionDialog(Runtime, agentType) {
  if (agentType === 'gemini') return null;

  // Continue: check for accept/reject tool call buttons.
  // Multiple tool-call blocks may exist in the DOM from previous turns;
  // pick the LAST visible accept button (the active permission prompt).
  if (agentType === 'continue') {
    try {
      const raw = await evalInFrame(Runtime, `
        var allAccept = d.querySelectorAll('[data-testid^="accept-tool-call-button-"]');
        var acceptBtn = null;
        for (var i = allAccept.length - 1; i >= 0; i--) {
          if (allAccept[i].offsetParent !== null) { acceptBtn = allAccept[i]; break; }
        }
        if (!acceptBtn) return null;
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
      `);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch { return null; }
  }

  // Antigravity panel: use panel-specific inline prompt detection
  if (agentType === 'antigravity_panel') {
    try {
      const raw = await evalInPage(Runtime, ANTIGRAVITY_PANEL_PERMISSION_EXPR);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch { return null; }
  }

  try {
    const usePageEval = agentType === 'codex-desktop' || agentType === 'antigravity';
    const evalFn = usePageEval ? evalInPage : evalInFrame;
    const raw = await evalFn(Runtime, PERMISSION_DIALOG_EXPR);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Clicks the button matching choiceId in the active permission dialog.
// Returns { ok: true } or { ok: false, code, detail }.
async function respondToPermissionDialog(Runtime, agentType, choiceId, sessionId) {
  try {
    let r;
    if (agentType === 'continue') {
      // Continue uses data-testid for accept/reject buttons.
      // Simple .click() doesn't trigger React's synthetic event system inside
      // the iframe — dispatch the full pointer+mouse event sequence instead.
      r = await evalInFrame(Runtime, `
        var btn = d.querySelector('[data-testid="${choiceId}"]');
        if (!btn) {
          // Try finding by partial match (call ID may have changed)
          var prefix = '${choiceId}'.split('-').slice(0, -1).join('-');
          var all = d.querySelectorAll('[data-testid^="' + prefix + '"]');
          btn = all.length > 0 ? all[all.length - 1] : null;
        }
        if (!btn) return 'no-btn';
        if (btn.disabled) return 'disabled';
        var rect = btn.getBoundingClientRect();
        var cx = rect.x + rect.width / 2;
        var cy = rect.y + rect.height / 2;
        var w = d.defaultView || f.contentWindow || window;
        var opts = { bubbles: true, cancelable: true, view: w, clientX: cx, clientY: cy, button: 0 };
        btn.dispatchEvent(new w.PointerEvent('pointerdown', opts));
        btn.dispatchEvent(new w.MouseEvent('mousedown', opts));
        btn.dispatchEvent(new w.PointerEvent('pointerup', opts));
        btn.dispatchEvent(new w.MouseEvent('mouseup', opts));
        btn.dispatchEvent(new w.MouseEvent('click', opts));
        // Fallback: also try the keyboard shortcut (Ctrl+Enter = Accept)
        var isAccept = '${choiceId}'.indexOf('accept') !== -1;
        if (isAccept) {
          var kbOpts = { key: 'Enter', code: 'Enter', keyCode: 13, ctrlKey: true, bubbles: true, cancelable: true };
          d.body.dispatchEvent(new w.KeyboardEvent('keydown', kbOpts));
          d.body.dispatchEvent(new w.KeyboardEvent('keyup', kbOpts));
        }
        return 'clicked';
      `);
    } else if (agentType === 'antigravity_panel') {
      r = await evalInPage(Runtime, _buildPanelPermissionClickExpr(choiceId));
    } else {
      const usePageEval = agentType === 'codex-desktop' || agentType === 'antigravity';
      const evalFn = usePageEval ? evalInPage : evalInFrame;
      r = await evalFn(Runtime, _buildPermissionClickExpr(choiceId));
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
  } else if (agentType === 'continue') {
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

async function setCodexDesktopConfig(Runtime, { model_id, effort, access_mode }) {
  const results = {};

  // Helper: click a trigger button (by pattern on last 25 buttons), then click an option
  async function clickOption(triggerPatternFn, optionText) {
    const optLower = optionText.toLowerCase();
    const triggerClicked = await evalInPage(Runtime, `
      (function() {
        var btns = Array.from(d.querySelectorAll('button'));
        var lastBtns = btns.slice(-30);
        var trigger = lastBtns.find(function(b) {
          var t = (b.textContent || '').trim();
          return (${triggerPatternFn})(t);
        });
        if (!trigger) return 'no-trigger';
        trigger.click();
        return 'clicked';
      })()
    `);
    if (triggerClicked !== 'clicked') return { ok: false, detail: `trigger: ${triggerClicked}` };

    await new Promise(r => setTimeout(r, 350));

    const optStr = JSON.stringify(optLower);
    const optClicked = await evalInPage(Runtime, `
      (function() {
        var target = ${optStr};
        var candidates = Array.from(d.querySelectorAll('[role="option"],[role="menuitem"],[role="listitem"]'));
        if (candidates.length === 0) candidates = Array.from(d.querySelectorAll('button'));
        var item = candidates.find(function(el) {
          var t = (el.textContent || '').trim().toLowerCase();
          return t === target || t.replace(/\\s+/g,'') === target.replace(/\\s+/g,'');
        });
        if (!item) return 'no-option';
        item.click();
        return 'clicked';
      })()
    `);
    return { ok: optClicked === 'clicked', detail: optClicked };
  }

  if (model_id) {
    const label = model_id.toUpperCase().replace(/^GPT-/, 'GPT-');
    results.model = await clickOption(
      'function(t){ return /^gpt[-\\s.]?[\\d.]+|^o[134][-\\s.]/i.test(t) && t.length < 20; }',
      label
    );
  }

  if (effort) {
    const effortLabel = effort === 'extra-high' ? 'Extra High'
      : effort.charAt(0).toUpperCase() + effort.slice(1);
    results.effort = await clickOption(
      'function(t){ return /^(low|medium|high|extra\\s*high)$/i.test(t); }',
      effortLabel
    );
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

  // Try to find and click a "New thread" button
  const res = await evalFn(Runtime, `
    var allEls = Array.from(d.querySelectorAll('button, [role="button"], [role="menuitem"]'));
    var btn = allEls.find(function(el) {
      var t = (el.textContent || el.getAttribute('aria-label') || '').trim().toLowerCase();
      return t === 'new thread' || t === 'new chat' || t === 'new conversation';
    });
    if (btn) { btn.click(); return 'clicked'; }
    // Also try aria-label="New chat"
    var ariaBtn = d.querySelector('button[aria-label="New chat"], button[aria-label="New thread"]');
    if (ariaBtn) { ariaBtn.click(); return 'clicked-aria'; }
    return 'not-found';
  `);

  if (res === 'clicked') return true;

  // Fallback: keyboard shortcut (Ctrl+N is common "new" action in Codex)
  try {
    const { Input } = Runtime._cdp || {};
    if (Input) {
      await evalFn(Runtime, `
        d.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'n', code: 'KeyN', ctrlKey: true, shiftKey: true, bubbles: true
        }));
      `);
      return true;
    }
  } catch {}

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
          // Strip trailing age suffixes like "2d", "15m", "3h" that got concatenated
          var text = fullText.replace(/\\d+[smhd]$/, '').trim();
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
    const raw = await evalFn(Runtime, `
      (function() {
        var targetId = ${JSON.stringify(threadId)};

        // Strategy 1: Find by data attribute
        var el = d.querySelector('[data-thread-id="' + targetId + '"]') ||
                 d.querySelector('[data-conversation-id="' + targetId + '"]');
        if (el) { el.click(); return JSON.stringify({ ok: true, method: 'data-attr' }); }

        // Strategy 2: Find by index (thread-N pattern) — matches readCodexThreadList
        var idxMatch = targetId.match(/^thread-(\\d+)$/);
        if (idxMatch) {
          var idx = parseInt(idxMatch[1], 10);

          // Build same thread list as readCodexThreadList to find by index
          var clickables = [];
          var active = d.querySelector('[aria-current="page"]');
          if (active) {
            var wrapper = active.parentElement;
            var container = wrapper ? wrapper.parentElement : null;
            if (container) {
              Array.from(container.children).forEach(function(sib) {
                var c = sib.querySelector('[class*="cursor-interaction"]');
                if (c && (c.textContent || '').trim().length > 1) clickables.push(c);
              });
            }
          }
          // Fallback: overflow-hidden wrappers in nav
          if (clickables.length === 0) {
            var nav = d.querySelector('nav');
            if (nav) {
              Array.from(nav.querySelectorAll('[class*="overflow-hidden"][class*="will-change"]')).forEach(function(w) {
                var c = w.querySelector('[class*="cursor-interaction"]');
                if (c && (c.textContent || '').trim().length > 1) clickables.push(c);
              });
            }
          }

          if (clickables[idx]) {
            clickables[idx].click();
            return JSON.stringify({ ok: true, method: 'index-thread' });
          }
        }

        return JSON.stringify({ ok: false, detail: 'thread-not-found: ' + targetId });
      })()
    `);
    try { return JSON.parse(raw); } catch { return { ok: false, detail: 'eval-failed' }; }
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
async function readCodexChatList(Runtime, usePageEval) {
  const evalFn = usePageEval ? evalInPage : evalInFrame;

  // If we're in a chat (Back button visible), click Back to show the list
  const needsBack = await evalFn(Runtime, `
    var back = d.querySelector('button[aria-label="Back"]');
    if (back && back.offsetParent !== null) { back.click(); return 'clicked'; }
    return 'already-list';
  `);
  if (needsBack === 'clicked') {
    await new Promise(r => setTimeout(r, 800));
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

module.exports = {
  detectAgentType,
  detectThinking,
  readMessages,
  readAgentConfig,
  setAgentModel,
  setAntigravityMode,
  interruptAgent,
  detectPermissionDialog,
  respondToPermissionDialog,
  sendMessage,
  steerCodexInput,
  getSelectorFailures,
  evalInFrame,
  cacheInnerContextId,
  evalInPage,
  readAntigravitySessionTitle,
  readAntigravityPanelTitle,
  detectAntigravityPanelHasContent,
  readCodexRateLimit,
  readClaudeRateLimit,
  readRateLimit,
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
  readAntigravityPanelChatList,
  switchAntigravityPanelChat,
  newAntigravityPanelChat,
  // Skills — Codex Desktop skills list
  readCodexSkillsList,
  navigateCodexSkills,
  // Session close — click the tab/panel close button
  closeSessionTab,
  // Continue extension
  readContinueConfig,
};
