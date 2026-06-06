'use strict';

// SELECTOR INVARIANTS — read before editing this file.
//
// 1. read*/detect* functions must be pure DOM reads. No clicks, focus,
//    dispatch, execCommand, or Input domain calls. They run from periodic
//    polls and any mutation creates a runaway loop.
//
// 2. Permission/approval/diff state must come from live VISIBLE UI only:
//    modal dialogs (`[role="dialog"]`) or the LAST AI message in
//    `.conversations` (when it is the final bubble and agent is idle).
//    Never scan transcript HISTORY — past resolved tool-call cards
//    retain Run/Cancel buttons and older assistant text contains
//    approval-like words (Run/Allow/Approve/Cancel/wait/approval).
//
// 3. IDs for repeating items (agents, threads, file changes) must hash
//    only STABLE substrings. Never include relative timestamps
//    ("2m ago"), unread badges, last-message previews, or anything else
//    that the UI updates over time. When in doubt, use the row's first
//    line trimmed to 80 chars.
//
// 4. When reading message/bubble text: read innerText verbatim. Do not
//    strip <button>, <svg>, or any element type you don't fully
//    understand — Cursor's tool-call cards are structured around buttons
//    and stripping them destroys content.
//
// 5. Bubbles/items without an explicit known role/type are SKIPPED, not
//    defaulted. Defaulting unknowns to "assistant" / "agent" / "edit"
//    pollutes downstream readers.
//
// 6. Scope queries to the narrowest known root. `d.querySelectorAll`
//    against the whole document is a last resort, not the first try.
//    Prefer `.conversations`, `.agent-sidebar`, `.composer-bar`, etc.

const fs = require('fs');
const path = require('path');

async function evalInPage(Runtime, code, options = {}) {
  const useAsync = !!options.awaitPromise;
  const result = await Runtime.evaluate({
    expression: `(${useAsync ? 'async ' : ''}function() {
      const d = document;
      ${code}
    })()`,
    returnByValue: true,
    awaitPromise: useAsync,
    silent: true,
    userGesture: false,
  });
  if (result.exceptionDetails) {
    const desc = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
    throw new Error(`JS exception: ${desc}`);
  }
  return result.result?.value ?? null;
}

const CURSOR_READ_EXPR = `
  function squash(text) {
    return String(text || '').replace(/\\n{3,}/g, '\\n\\n').trim();
  }
  var msgs = [];
  var root = d.querySelector('.conversations');
  if (!root) return JSON.stringify(msgs);
  var bubbles = Array.from(root.querySelectorAll('.composer-rendered-message'));
  for (var i = 0; i < bubbles.length; i++) {
    var el = bubbles[i];
    var roleAttr = (el.getAttribute('data-message-role') || '').toLowerCase();
    // Only emit messages with an explicit known role. Defaulting unknown
    // bubbles to "assistant" contaminates the transcript with metadata rows
    // and system notices.
    var role;
    if (roleAttr === 'human') role = 'user';
    else if (roleAttr === 'ai') role = 'assistant';
    else continue;
    // Read innerText verbatim. Tool-call cards (.ui-tool-call-card,
    // .ui-shell-tool-call, .ui-edit-tool-call) are structured around buttons;
    // stripping <button> destroys their content. The web UI's markdown
    // renderer collapses harmless button text on its own.
    var text = squash(el.innerText || el.textContent || '');
    if (!text) continue;
    var prev = msgs.length ? msgs[msgs.length - 1] : null;
    if (prev && prev.role === role && prev.content === text) continue;
    msgs.push({ role: role, content: text });
  }
  return JSON.stringify(msgs);
`;

const CURSOR_CONFIG_EXPR = `
  return (function() {
    function norm(t) { return String(t || '').replace(/\\s+/g, ' ').trim(); }
    function isVisible(el) {
      if (!el || !el.getBoundingClientRect) return false;
      var r = el.getBoundingClientRect();
      return r.width > 40 && r.height > 8;
    }
    var trigger = null;
    var host = d.querySelector('.has-composer-editor .composer-bar, .composer-bar.editor');
    var inputs = host
      ? Array.from(host.querySelectorAll('.aislash-editor-input[contenteditable="true"]'))
      : [];
    var input = null;
    for (var ii = inputs.length - 1; ii >= 0; ii--) {
      if (isVisible(inputs[ii])) { input = inputs[ii]; break; }
    }
    if (input) {
      var box = input.closest('.ai-input-full-input-box, .composer-input-blur-wrapper');
      if (box) trigger = box.querySelector('button.ui-model-picker__trigger, .ui-model-picker__trigger');
    }
    if (!trigger && host) {
      trigger = host.querySelector('button.ui-model-picker__trigger, .ui-model-picker__trigger');
    }
    var model = null;
    if (trigger) {
      model = norm(trigger.getAttribute('aria-label') || trigger.textContent || trigger.innerText || '');
      model = model.replace(/^model\\s*/i, '').trim();
    }
    var openList = d.querySelector('[role="listbox"], [role="menu"]');
    if (openList) {
      var selected = openList.querySelector('[aria-selected="true"], [aria-checked="true"]');
      if (selected) model = norm(selected.textContent || selected.getAttribute('aria-label') || '') || model;
    }
    var modeScope = host || d.querySelector('.composer-bar, .has-composer-editor');
    var modeBtn = modeScope
      ? Array.from(modeScope.querySelectorAll('button, [role="tab"], [role="menuitem"]')).find(function(el) {
          var t = norm((el.textContent || '') + ' ' + (el.getAttribute('aria-label') || '')).toLowerCase();
          return /^agent$|^ask$|^edit$|^composer$/.test(t) && t.length < 24;
        })
      : null;
    return JSON.stringify({
      model_id: model || 'unknown',
      mode: modeBtn ? norm(modeBtn.textContent || modeBtn.getAttribute('aria-label') || '') : 'unknown',
    });
  })();
`;

const CURSOR_AGENT_LIST_EXPR = `
  return (function() {
    function norm(t) { return String(t || '').replace(/\\s+/g, ' ').trim(); }
    // Extract the first non-empty line of innerText. Cursor agent rows render
    // the agent title as the first line and a relative-timestamp ("Updated 2m
    // ago") plus last-message preview on subsequent lines. Hashing the whole
    // row produces a different ID every poll as those mutate.
    function firstLine(el) {
      var raw = String(el.innerText || el.textContent || '');
      var lines = raw.split(/\\n+/);
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (line) return line.substring(0, 80);
      }
      return '';
    }
    function slugId(title) {
      var s = norm(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      return s ? ('agent-' + s) : '';
    }
    function pushItem(items, seen, item) {
      if (!item.id || seen[item.id]) return;
      seen[item.id] = true;
      items.push(item);
    }
    var items = [];
    var seen = {};
    var agentsRoot = d.querySelector('.agent-sidebar, [class*="agent-sidebar"], [class*="agents-panel"]');
    // Note: .sidebar2 is the explorer/SCM/etc. sidebar — too broad. Editor tab
    // labels (a.label-name) are file tabs, not agents — never include them.
    if (!agentsRoot) return JSON.stringify([]);
    var rows = Array.from(agentsRoot.querySelectorAll('.monaco-list-row'));
    rows.forEach(function(row, idx) {
      var title = firstLine(row);
      if (!title || title.length < 2) return;
      if (/^search agents/i.test(title)) return;
      var id = slugId(title);
      if (!id) return;
      pushItem(items, seen, {
        id: id,
        title: title,
        active: row.getAttribute('aria-selected') === 'true' || row.classList.contains('sidebar-list-item-selected'),
        index: idx,
        source: 'agent-sidebar',
      });
    });
    return JSON.stringify(items);
  })();
`;

const CURSOR_PERMISSION_EXPR = `
  return (function() {
    function norm(t) { return String(t || '').replace(/\\s+/g, ' ').trim(); }
    function isVisible(el) {
      if (!el || !el.getBoundingClientRect) return false;
      var r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      var st = window.getComputedStyle ? window.getComputedStyle(el) : null;
      return !(st && (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0'));
    }
    // Strip keyboard shortcut suffixes that Cursor appends to button labels.
    // e.g. "Allow\\nShift+Return" becomes "Allow", "Run Return" becomes "Run".
    function stripShortcut(label) {
      return norm(label)
        .replace(/[\\u23CE\\u21B5\\u2B90\\u2386\\u238B\\u2303\\u2325\\u21E7\\u2318]/g, '')
        .replace(/\\s*(?:Shift|Alt|Ctrl|Cmd|Meta)[+][^\\s]*/gi, '')
        .replace(/\\s+/g, ' ')
        .trim();
    }
    function choiceIdFromLabel(label) {
      var t = stripShortcut(label).toLowerCase();
      if (/^allow$|^run$|^run it$|^approve$|^yes$|^continue$|^proceed$/i.test(t)) return 'allow';
      if (/^deny$|^reject$|^no$|^cancel$|^skip$/i.test(t)) return 'deny';
      var slug = t.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      return slug || 'choice';
    }
    function isPermissionButtonLabel(label) {
      var t = stripShortcut(label).toLowerCase();
      if (!t || t.length > 40) return false;
      if (/^shell command options$/i.test(t)) return false;
      if (/^allowlist$/i.test(t)) return false;
      if (t.indexOf('not in allowlist') !== -1) return false;
      return /^allow$|^run$|^run it$|^approve$|^yes$|^continue$|^proceed$|^deny$|^reject$|^no$|^cancel$|^skip$/i.test(t);
    }
    function collectChoices(root) {
      var choices = [];
      var seen = {};
      Array.from(root.querySelectorAll('button, [role="button"]')).forEach(function(btn) {
        if (!isVisible(btn)) return;
        var label = norm(btn.innerText || btn.textContent || btn.getAttribute('aria-label') || '');
        if (!isPermissionButtonLabel(label)) return;
        var cid = choiceIdFromLabel(label);
        if (seen[cid]) return;
        seen[cid] = true;
        choices.push({ choice_id: cid, label: label });
      });
      return choices;
    }
    // STRATEGY 1: Modal dialogs.
    // Cursor permission prompts CAN appear as real modal dialogs. Detect
    // visible modals that contain BOTH an Allow and a Deny choice.
    var dialogs = Array.from(d.querySelectorAll('[role="dialog"], .pretty-dialog, .monaco-dialog-box'));
    for (var i = 0; i < dialogs.length; i++) {
      var dlg = dialogs[i];
      if (!isVisible(dlg)) continue;
      // Skip non-permission dialogs (model picker, settings, palette).
      var cls = String(dlg.className || '').toLowerCase();
      if (cls.indexOf('model-picker') !== -1) continue;
      if (cls.indexOf('quick-input') !== -1) continue;
      if (cls.indexOf('command-palette') !== -1) continue;
      var choices = collectChoices(dlg);
      var hasAllow = choices.some(function(c) { return c.choice_id === 'allow'; });
      var hasDeny = choices.some(function(c) { return c.choice_id === 'deny'; });
      if (hasAllow && hasDeny) {
        return JSON.stringify({
          message: norm(dlg.innerText || dlg.textContent || '').substring(0, 300) || 'Permission required',
          choices: choices,
        });
      }
    }

    function permissionBubble(conv) {
      var allBubbles = Array.from(conv.querySelectorAll('.composer-rendered-message'));
      if (!allBubbles.length) return null;
      var last = allBubbles[allBubbles.length - 1];
      var lastRole = (last.getAttribute('data-message-role') || '').toLowerCase();
      if (lastRole === 'ai') return last;
      // User may have typed "run it" while the pending shell card is still visible.
      for (var bi = allBubbles.length - 2; bi >= 0; bi--) {
        var role = (allBubbles[bi].getAttribute('data-message-role') || '').toLowerCase();
        if (role === 'ai') {
          var pending = allBubbles[bi].querySelector('.ui-shell-tool-call--pending');
          if (pending && isVisible(pending)) return allBubbles[bi];
          return null;
        }
      }
      return null;
    }
    function agentIsGenerating(bubble) {
      if (!bubble) return true;
      var streamEl = bubble.querySelector('[class*="streaming"], [aria-busy="true"], .codicon-loading');
      if (streamEl && isVisible(streamEl)) return true;
      var bar = d.querySelector('.composer-bar, [class*="composer-bar"]');
      if (bar) {
        var hasStop = Array.from(bar.querySelectorAll('button, [role="button"]')).some(function(b) {
          if (!isVisible(b)) return false;
          var a = String(b.getAttribute('aria-label') || '').toLowerCase();
          var c = String(b.className || '').toLowerCase();
          return (a.indexOf('stop') !== -1 && a !== 'stop command') || c.indexOf('stop-generat') !== -1 || c.indexOf('composer-stop') !== -1;
        });
        if (hasStop) return true;
      }
      return false;
    }

    var conv = d.querySelector('.conversations');
    if (!conv) return null;
    var permBubble = permissionBubble(conv);
    if (!permBubble || agentIsGenerating(permBubble)) return null;

    // STRATEGY 3: Pending shell tool card in the permission bubble only.
    // Pending cards carry class ui-shell-tool-call--pending; resolved history
    // cards use --expandable and must not be scanned across the transcript.
    var pendingCard = permBubble.querySelector('.ui-shell-tool-call--pending');
    if (pendingCard && isVisible(pendingCard)) {
      var cardText = norm(pendingCard.innerText || pendingCard.textContent || '');
      var cardChoices = collectChoices(pendingCard);
      var hasAllow = cardChoices.some(function(c) { return c.choice_id === 'allow'; });
      var hasDeny = cardChoices.some(function(c) { return c.choice_id === 'deny'; });
      if (hasAllow && hasDeny) {
        return JSON.stringify({
          message: cardText.substring(0, 300) || 'Shell command approval required',
          choices: cardChoices,
          source: 'shell-card-pending',
        });
      }
    }

    // STRATEGY 2: Inline text approval in the permission bubble (Composer + Agent view).
  // Same DOM in both views; Agent sidebar does not change approval surfaces.
    var allBubbles = Array.from(conv.querySelectorAll('.composer-rendered-message'));
    var lastBubble = allBubbles[allBubbles.length - 1];
    var lastRole = (lastBubble.getAttribute('data-message-role') || '').toLowerCase();
    if (lastRole !== 'ai') return null;

    var lastText = norm(permBubble.innerText || permBubble.textContent || '');
    var tail = lastText.slice(-500);
    if (/pending command|reply with (?:your )?approval|run command[?]|not in allowlist|awaiting (?:your )?approval|needs your approval|approve (?:this )?command/i.test(tail)) {
      return JSON.stringify({
        message: tail.substring(0, 300),
        choices: [
          { choice_id: 'allow', label: 'Run' },
          { choice_id: 'deny', label: 'Skip' },
        ],
        source: 'inline-text',
      });
    }

    return null;
  })();
`;

function readCursorSettingsModels() {
  try {
    const appData = process.env.APPDATA || '';
    if (!appData) return [];
    const settingsPath = path.join(appData, 'Cursor', 'User', 'settings.json');
    if (!fs.existsSync(settingsPath)) return [];
    const data = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const models = [];
    const push = (id, label) => {
      const v = String(id || '').trim();
      if (!v) return;
      models.push({ id: v, label: String(label || v).trim() || v });
    };
    if (typeof data['cursor.model'] === 'string') push(data['cursor.model'], data['cursor.model']);
    if (typeof data['cursor.chat.model'] === 'string') push(data['cursor.chat.model'], data['cursor.chat.model']);
    if (Array.isArray(data['cursor.chat.availableModels'])) {
      data['cursor.chat.availableModels'].forEach(m => {
        if (typeof m === 'string') push(m, m);
        else if (m && typeof m === 'object') push(m.id || m.name, m.label || m.name || m.id);
      });
    }
    return models;
  } catch {
    return [];
  }
}

async function readCursorMessages(Runtime) {
  const raw = await evalInPage(Runtime, CURSOR_READ_EXPR, { awaitPromise: true });
  return raw || '[]';
}

const CURSOR_FIND_COMPOSER_INPUT = `
  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    var r = el.getBoundingClientRect();
    return r.width > 40 && r.height > 8;
  }
  function composerHost() {
    return d.querySelector(
      '.has-composer-editor .composer-bar, .editor-group-container.has-composer-editor .composer-bar, .composer-bar.editor'
    );
  }
  function findComposerInput() {
    var host = composerHost();
    var all = host
      ? Array.from(host.querySelectorAll('.aislash-editor-input[contenteditable="true"]'))
      : Array.from(d.querySelectorAll('.aislash-editor-input[contenteditable="true"]'));
    for (var i = all.length - 1; i >= 0; i--) {
      if (isVisible(all[i])) return all[i];
    }
    return null;
  }
  function clearComposerDom(input) {
    if (!input) return;
    input.focus();
    try {
      d.execCommand('selectAll', false, null);
      d.execCommand('delete', false, null);
    } catch (_) {}
    while (input.firstChild) input.removeChild(input.firstChild);
    input.textContent = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function findComposerFooter(input) {
    if (!input) return null;
    return input.closest('.composer-input-blur-wrapper, .ai-input-full-input-box');
  }
`;

async function dispatchTrustedEnter(Input) {
  await Input.dispatchKeyEvent({
    type: 'keyDown',
    key: 'Enter',
    code: 'Enter',
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
  });
  await Input.dispatchKeyEvent({
    type: 'keyUp',
    key: 'Enter',
    code: 'Enter',
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
  });
}

async function focusComposerInput(Runtime) {
  return evalInPage(Runtime, `
    ${CURSOR_FIND_COMPOSER_INPUT}
    var input = findComposerInput();
    if (!input) return 'no-input';
    input.scrollIntoView({ block: 'nearest' });
    input.focus();
    input.click();
    return 'ok';
  `);
}

async function clearComposerViaInput(Input) {
  await Input.dispatchKeyEvent({ type: 'keyDown', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17, nativeVirtualKeyCode: 17, modifiers: 2 });
  await Input.dispatchKeyEvent({ type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65, modifiers: 2 });
  await Input.dispatchKeyEvent({ type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65, modifiers: 2 });
  await Input.dispatchKeyEvent({ type: 'keyUp', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17, nativeVirtualKeyCode: 17, modifiers: 0 });
  await Input.dispatchKeyEvent({ type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 });
  await Input.dispatchKeyEvent({ type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 });
}

async function sendCursorMessage(Runtime, cdpClient, text) {
  const Input = cdpClient && cdpClient.Input;
  const focus = await focusComposerInput(Runtime);
  if (focus !== 'ok') return { ok: false, code: 'input_not_found', detail: focus };

  let set = 'empty';
  if (Input && typeof Input.insertText === 'function' && typeof Input.dispatchKeyEvent === 'function') {
    try {
      await clearComposerViaInput(Input);
      await evalInPage(Runtime, `
        ${CURSOR_FIND_COMPOSER_INPUT}
        clearComposerDom(findComposerInput());
        return 'ok';
      `);
      await Input.insertText({ text: String(text || '') });
      await new Promise(r => setTimeout(r, 150));
      set = await evalInPage(Runtime, `
        ${CURSOR_FIND_COMPOSER_INPUT}
        function norm(t) { return String(t || '').replace(/\\s+/g, ' ').trim(); }
        var input = findComposerInput();
        if (!input) return 'no-input';
        var visible = norm(input.innerText || input.textContent || '');
        return visible.length > 0 ? 'ok' : 'empty';
      `);
    } catch (_) {
      set = 'empty';
    }
  }

  if (set !== 'ok') {
    set = await evalInPage(Runtime, `
      ${CURSOR_FIND_COMPOSER_INPUT}
      var input = findComposerInput();
      if (!input) return 'no-input';
      clearComposerDom(input);
      var ok = false;
      try {
        var ev = new InputEvent('beforeinput', { inputType: 'insertText', data: ${JSON.stringify(text)}, bubbles: true, cancelable: true, composed: true });
        input.dispatchEvent(ev);
        if ((input.innerText || input.textContent || '').trim().length > 0) ok = true;
      } catch (_) {}
      if (!ok) ok = d.execCommand('insertText', false, ${JSON.stringify(text)});
      if (!ok) {
        input.textContent = ${JSON.stringify(text)};
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return ((input.innerText || input.textContent || '').trim().length > 0) ? 'ok' : 'empty';
    `);
  }
  if (set !== 'ok') return { ok: false, code: 'input_not_found', detail: set };

  await new Promise(r => setTimeout(r, 200));

  if (!Input || typeof Input.dispatchKeyEvent !== 'function') {
    return { ok: false, code: 'not_supported', detail: 'CDP Input domain required for Cursor send' };
  }

  try {
    await focusComposerInput(Runtime);
    await dispatchTrustedEnter(Input);
    await new Promise(r => setTimeout(r, 700));
    const wanted = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    const observed = await evalInPage(Runtime, `
      ${CURSOR_FIND_COMPOSER_INPUT}
      function norm(t) { return String(t || '').replace(/\\s+/g, ' ').trim(); }
      var wanted = ${JSON.stringify(wanted)};
      var root = d.querySelector('.conversations');
      if (root) {
        var humans = Array.from(root.querySelectorAll('.composer-rendered-message[data-message-role="human"]'));
        for (var i = humans.length - 1; i >= 0; i--) {
          var ht = norm(humans[i].innerText || humans[i].textContent || '');
          if (ht && (ht === wanted || ht.indexOf(wanted) >= 0 || wanted.indexOf(ht) >= 0)) return 'seen-transcript';
        }
      }
      var input = findComposerInput();
      if (input && norm(input.innerText || input.textContent || '').length === 0) return 'cleared-input';
      return 'pending';
    `);
    if (observed === 'seen-transcript' || observed === 'cleared-input') {
      return { ok: true, method: 'cdp_enter' };
    }
  } catch (e) {
    return { ok: false, code: 'send_failed', detail: e.message || 'enter_failed' };
  }

  return { ok: false, code: 'send_failed', detail: 'submit not observed after Enter' };
}

async function steerCursorInput(Runtime, text, cdpClient = null) {
  const Input = cdpClient && cdpClient.Input;
  const focus = await focusComposerInput(Runtime);
  if (focus !== 'ok') return { ok: false, code: 'input_not_found', detail: focus };
  if (Input && typeof Input.insertText === 'function') {
    try {
      await clearComposerViaInput(Input);
      await Input.insertText({ text: String(text || '') });
      return { ok: true };
    } catch (_) {}
  }
  const set = await evalInPage(Runtime, `
    ${CURSOR_FIND_COMPOSER_INPUT}
    var input = findComposerInput();
    if (!input) return 'no-input';
    input.focus();
    d.execCommand('selectAll', false, null);
    d.execCommand('delete', false, null);
    d.execCommand('insertText', false, ${JSON.stringify(text)});
    return 'ok';
  `);
  if (set !== 'ok') return { ok: false, code: 'input_not_found', detail: set };
  return { ok: true };
}

async function interruptCursor(Runtime, cdpClient, sessionId) {
  try {
    const r = await evalInPage(Runtime, `
      function isVisible(el) {
        if (!el || !el.getBoundingClientRect) return false;
        var rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }
      var scope = d.querySelector('.composer-bar, [class*="composer-bar"], .has-composer-editor') || d;
      var btns = Array.from(scope.querySelectorAll('button, [role="button"]')).filter(function(b) {
        if (!isVisible(b)) return false;
        if (b.closest && b.closest('.ui-shell-tool-call')) return false;
        var aria = String(b.getAttribute('aria-label') || '').toLowerCase();
        var cls = String(b.className || '').toLowerCase();
        return (aria.includes('stop') && aria !== 'stop command') || cls.includes('stop-generat') || cls.includes('composer-stop');
      });
      if (!btns.length) {
        btns = Array.from(d.querySelectorAll('button[aria-label*="Stop"], button[aria-label*="stop"]')).filter(function(b) {
          if (!isVisible(b)) return false;
          var aria = String(b.getAttribute('aria-label') || '').toLowerCase();
          return aria.includes('stop') && aria !== 'stop command' && !b.closest('.ui-shell-tool-call');
        });
      }
      if (btns.length) { btns[0].click(); return 'clicked'; }
      return 'no-btn';
    `);
    if (r === 'clicked') return { ok: true, method: 'stop_button' };
  } catch (e) {
    console.warn(`[${sessionId}] [interrupt] Cursor stop error: ${e.message}`);
  }
  const Input = cdpClient && cdpClient.Input;
  if (Input && typeof Input.dispatchKeyEvent === 'function') {
    try {
      await Input.dispatchKeyEvent({ type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
      await Input.dispatchKeyEvent({ type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
      return { ok: true, method: 'cdp_escape' };
    } catch (_) {}
  }
  return { ok: false, code: 'agent_not_active', detail: 'No generation stop control visible' };
}

async function readCursorConfig(Runtime) {
  try {
    let raw = await evalInPage(Runtime, CURSOR_CONFIG_EXPR);
    let parsed = raw ? JSON.parse(raw) : {};
    if (!parsed.model_id || parsed.model_id === 'unknown') {
      const fallback = await evalInPage(Runtime, `
        function norm(t) { return String(t || '').replace(/\\s+/g, ' ').trim(); }
        var tr = d.querySelector('.ui-model-picker__trigger, button.ui-model-picker__trigger');
        if (!tr) {
          var inputs = Array.from(d.querySelectorAll('.aislash-editor-input[contenteditable="true"]'));
          for (var i = inputs.length - 1; i >= 0; i--) {
            var box = inputs[i].closest('.ai-input-full-input-box');
            if (box) { tr = box.querySelector('.ui-model-picker__trigger'); if (tr) break; }
          }
        }
        return JSON.stringify({
          model_id: tr ? norm(tr.textContent || tr.innerText || '') : 'unknown',
          mode: 'unknown',
        });
      `);
      if (fallback) parsed = { ...parsed, ...JSON.parse(fallback) };
    }
    const domModel = parsed.model_id && parsed.model_id !== 'unknown' ? parsed.model_id : null;
    const settingsModels = readCursorSettingsModels();
    const available_models = [];
    const seen = new Set();
    const add = (m) => {
      const id = String(m.id || m).trim();
      if (!id || seen.has(id.toLowerCase())) return;
      seen.add(id.toLowerCase());
      available_models.push(typeof m === 'object' ? m : { id, label: id });
    };
    if (domModel) add({ id: domModel, label: domModel });
    settingsModels.forEach(add);
    return {
      model_id: domModel || (settingsModels[0]?.id) || 'unknown',
      mode: parsed.mode || 'unknown',
      available_models,
      available_modes: [],
    };
  } catch {
    return { model_id: 'unknown', mode: 'unknown', available_models: readCursorSettingsModels() };
  }
}

async function setCursorModel(Runtime, modelId) {
  const label = String(modelId || '').trim();
  if (!label) return { ok: false, detail: 'empty-model' };
  const r = await evalInPage(Runtime, `
    function press(el) {
      if (!el) return false;
      el.click();
      return true;
    }
    var trigger = d.querySelector('button.ui-model-picker__trigger, .ui-model-picker__trigger');
    if (!trigger) return 'no-trigger';
    press(trigger);
    return 'opened';
  `);
  if (r !== 'opened') return { ok: false, detail: r };
  await new Promise(res => setTimeout(res, 300));
  const pick = await evalInPage(Runtime, `
    var wanted = ${JSON.stringify(label)}.toLowerCase();
    var items = Array.from(d.querySelectorAll('[role="menuitem"], [role="option"], button, .action-label'));
    var match = items.find(function(el) {
      var t = (el.textContent || el.getAttribute('aria-label') || '').trim().toLowerCase();
      return t === wanted || t.includes(wanted);
    });
    if (match) { match.click(); return 'picked'; }
    return 'not-found';
  `);
  return { ok: pick === 'picked', detail: pick };
}

async function readCursorAgentList(Runtime) {
  try {
    const raw = await evalInPage(Runtime, CURSOR_AGENT_LIST_EXPR);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function switchCursorAgent(Runtime, agentId) {
  const raw = await evalInPage(Runtime, `
    return (function() {
      function norm(t) { return String(t || '').replace(/\\s+/g, ' ').trim(); }
      function firstLine(el) {
        var raw = String(el.innerText || el.textContent || '');
        var lines = raw.split(/\\n+/);
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          if (line) return line.substring(0, 80);
        }
        return '';
      }
      function slugId(title) {
        var s = norm(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        return s ? ('agent-' + s) : '';
      }
      var targetId = ${JSON.stringify(agentId)};
      var agentsRoot = d.querySelector('.agent-sidebar, [class*="agent-sidebar"], [class*="agents-panel"]');
      if (!agentsRoot) return 'not-found';
      var rows = Array.from(agentsRoot.querySelectorAll('.monaco-list-row'));
      for (var i = 0; i < rows.length; i++) {
        var title = firstLine(rows[i]);
        if (!title) continue;
        if (slugId(title) === targetId) {
          rows[i].click();
          return 'clicked-sidebar';
        }
      }
      return 'not-found';
    })();
  `);
  const ok = raw === 'clicked-sidebar';
  return { ok, detail: ok ? 'clicked' : (raw || 'not-found') };
}

async function newCursorAgent(Runtime) {
  const raw = await evalInPage(Runtime, `
    var btn = Array.from(d.querySelectorAll('a, button, [role="button"]')).find(function(el) {
      var t = (el.getAttribute('aria-label') || '') + ' ' + (el.textContent || '');
      return /new agent/i.test(t);
    });
    if (btn) { btn.click(); return 'clicked'; }
    return 'not-found';
  `);
  const ok = raw === 'clicked';
  return { ok, detail: ok ? 'clicked' : (raw || 'not-found') };
}

async function readCursorRateLimit(Runtime) {
  try {
    const raw = await evalInPage(Runtime, `
      return (function() {
        function norm(t) { return String(t || '').replace(/\\s+/g, ' ').trim(); }
        function isVisible(el) {
          if (!el || !el.getBoundingClientRect) return false;
          var r = el.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) return false;
          var st = window.getComputedStyle ? window.getComputedStyle(el) : null;
          return !(st && (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0'));
        }
        var re = /rate limit|usage limit|fast request|too many requests|quota exceeded/i;
        // Never scan d.body — chat history and resolved cards can contain those words.
        var roots = Array.from(d.querySelectorAll(
          '[role="alert"], [role="status"], .notification-toast, .monaco-notification, [role="dialog"], .pretty-dialog'
        ));
        for (var i = 0; i < roots.length; i++) {
          var el = roots[i];
          if (!isVisible(el)) continue;
          if (el.closest && el.closest('.conversations')) continue;
          var text = norm(el.innerText || el.textContent || '');
          if (!re.test(text)) continue;
          var m = text.match(/(rate limit[^\\n]{0,120}|usage limit[^\\n]{0,120}|fast request[^\\n]{0,120})/i);
          return JSON.stringify({ rate_limited: true, until_text: m ? m[0].trim() : text.substring(0, 120) });
        }
        return JSON.stringify({ rate_limited: false });
      })();
    `);
    return raw ? JSON.parse(raw) : { rate_limited: false };
  } catch {
    return { rate_limited: false };
  }
}

const CURSOR_FILE_CHANGES_EXPR = `
  return (function() {
    function norm(t) { return String(t || '').replace(/\\s+/g, ' ').trim(); }
    function isVisible(el) {
      if (!el || !el.getBoundingClientRect) return false;
      var r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }
    function inConversations(el) {
      return !!(el && el.closest && el.closest('.conversations'));
    }
    function stableId(path) {
      var base = String(path || 'pending').substring(0, 80);
      return 'file-' + base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    }
    function findActionBtn(root, re) {
      var candidates = Array.from(root.querySelectorAll('button, [role="button"], a, span, div'));
      for (var i = candidates.length - 1; i >= 0; i--) {
        var b = candidates[i];
        if (!isVisible(b) || inConversations(b)) continue;
        var label = norm(b.innerText || b.textContent || b.getAttribute('aria-label') || '');
        if (re.test(label)) return b;
      }
      return null;
    }
    // Live panel-level Undo/Keep bar only — transcript edit cards are history.
    var scopes = Array.from(d.querySelectorAll(
      '.composer-bar, .has-composer-editor .composer-bar, .composer-pane, [class*="composer-footer"], [class*="edit-toolbar"]'
    ));
    var host = d.querySelector('.has-composer-editor');
    if (host && scopes.indexOf(host) === -1) scopes.push(host);
    var out = [];
    var seen = {};
    scopes.forEach(function(scope, sidx) {
      if (!scope || inConversations(scope)) return;
      var keepBtn = findActionBtn(scope, /^keep$/i);
      var undoBtn = findActionBtn(scope, /^undo$/i);
      if (!keepBtn || !undoBtn) return;
      var bar = keepBtn.closest('.composer-bar, [class*="composer"], [class*="diff"], [class*="edit-toolbar"]') || scope;
      if (inConversations(bar)) return;
      var barText = norm(bar.innerText || bar.textContent || '');
      var path = '';
      var fileMatch = barText.match(/([^\\s]+\\.[a-z0-9]{1,8})\\b/i);
      if (fileMatch) path = fileMatch[1];
      else {
        var line = barText.split(/\\n+/).map(function(l) { return l.trim(); }).find(function(l) {
          return l && !/^(undo|keep|review|\\d+\\s*files?)$/i.test(l);
        });
        path = line ? line.substring(0, 80) : ('pending-' + sidx);
      }
      var id = stableId(path);
      if (seen[id]) return;
      seen[id] = true;
      out.push({
        id: id,
        path: path,
        summary: barText.substring(0, 500),
        status: 'pending',
        can_accept: true,
        can_reject: true,
      });
    });
    return JSON.stringify(out);
  })();
`;

async function readCursorFileChanges(Runtime) {
  try {
    const raw = await evalInPage(Runtime, CURSOR_FILE_CHANGES_EXPR);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function respondCursorFileChange(Runtime, changeId, action) {
  const raw = await evalInPage(Runtime, `
    return (function() {
      function norm(t) { return String(t || '').replace(/\\s+/g, ' ').trim(); }
      function stableId(path, idx) {
        var base = String(path || ('change-' + idx));
        return 'file-' + base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      }
      var wanted = ${JSON.stringify(changeId)};
      var action = ${JSON.stringify(action)};
      var re = action === 'accept' ? /^accept$|^accept all$|^approve$|^keep$/i : /^reject$|^reject all$|^discard$|^undo$/i;
      var cards = Array.from(d.querySelectorAll('.ui-edit-tool-call, .ui-tool-call-card.ui-edit-tool-call, .ui-tool-call-card'));
      var card = cards.find(function(c, idx) {
        var lines = (c.innerText || c.textContent || '').trim().split('\\n');
        var path = (lines[0] || '').trim();
        var dataId = c.getAttribute('data-change-id') || c.getAttribute('data-file') || c.getAttribute('data-path');
        var id = dataId ? String(dataId) : stableId(path, idx);
        return id === wanted || path === wanted;
      });
      function pickBtn(root) {
        var found = null;
        Array.from(root.querySelectorAll('button, [role="button"], a, span, div')).forEach(function(b) {
          if (found) return;
          var label = norm(b.innerText || b.textContent || b.getAttribute('aria-label') || '');
          if (re.test(label)) found = b;
        });
        return found;
      }
      if (!card) return 'no-card';
      var btn = pickBtn(card) || pickBtn(d);
      if (!btn) return 'no-btn';
      btn.click();
      return 'clicked';
    })();
  `);
  return raw === 'clicked';
}

async function acceptCursorFileChange(Runtime, changeId) {
  const ok = await respondCursorFileChange(Runtime, changeId, 'accept');
  return { ok, detail: ok ? 'clicked' : 'no-btn' };
}

async function rejectCursorFileChange(Runtime, changeId) {
  const ok = await respondCursorFileChange(Runtime, changeId, 'reject');
  return { ok, detail: ok ? 'clicked' : 'no-btn' };
}

const CURSOR_TERMINAL_READ_EXPR = `
  var results = [];
  function norm(t) { return String(t || '').replace(/\\s+/g, ' ').trim(); }
  function joinRowTexts(rowsEl) {
    if (!rowsEl) return '';
    return Array.from(rowsEl.children).map(function(r) { return r.textContent; }).filter(function(t) { return t.trim(); }).join('\\n');
  }
  var best = '';
  var rowNodes = Array.from(d.querySelectorAll('.xterm-rows'));
  rowNodes.forEach(function(rows) {
    var t = joinRowTexts(rows);
    if (t.length > best.length) best = t;
  });
  function looksLikeTerminalText(t) {
    if (!t || t.length < 2) return false;
    if (/\\.xterm\\s|scrollbar|background:\\s*#|\\.xterm-scrollable/.test(t)) return false;
    return true;
  }
  var termRoots = Array.from(d.querySelectorAll(
    '.integrated-terminal, .pane-body.integrated-terminal, .terminal-outer-container, .terminal-group'
  ));
  termRoots.forEach(function(root) {
    var rows = root.querySelector('.xterm-rows');
    var t = joinRowTexts(rows);
    if (looksLikeTerminalText(t) && t.length > best.length) best = t;
    if (!t) {
      var screen = root.querySelector('.xterm-screen');
      var st = screen ? norm(screen.innerText || screen.textContent || '') : '';
      if (looksLikeTerminalText(st) && st.length > best.length) best = st;
    }
  });
  if (best) {
    results.push({
      command: null,
      output: best.substring(0, 8000),
      turnId: '__live_terminal__',
      live: true
    });
  }
  return JSON.stringify(results);
`;

async function ensureCursorTerminalVisible(Runtime, cdpClient) {
  const hasTerm = await evalInPage(Runtime, `
    return !!d.querySelector('.xterm-rows, .xterm-helper-textarea');
  `);
  if (hasTerm) return { ok: true, method: 'already_open' };

  const clicked = await evalInPage(Runtime, `
    var tabs = Array.from(d.querySelectorAll('[role="tab"], .action-label, a.label-name'));
    var term = tabs.find(function(el) {
      var t = (el.getAttribute('aria-label') || el.textContent || '').trim();
      return /^terminal$/i.test(t);
    });
    if (term) { term.click(); return 'tab'; }
    return 'none';
  `);
  if (clicked === 'tab') {
    await new Promise((r) => setTimeout(r, 600));
    const ok = await evalInPage(Runtime, `return !!d.querySelector('.xterm-rows');`);
    if (ok) return { ok: true, method: 'tab_click' };
  }

  const Input = cdpClient && cdpClient.Input;
  if (Input && typeof Input.dispatchKeyEvent === 'function') {
    try {
      const mod = 2;
      await Input.dispatchKeyEvent({ type: 'keyDown', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17, nativeVirtualKeyCode: 17, modifiers: mod });
      await Input.dispatchKeyEvent({ type: 'keyDown', key: '`', code: 'Backquote', windowsVirtualKeyCode: 192, nativeVirtualKeyCode: 192, modifiers: mod });
      await Input.dispatchKeyEvent({ type: 'keyUp', key: '`', code: 'Backquote', windowsVirtualKeyCode: 192, nativeVirtualKeyCode: 192, modifiers: mod });
      await Input.dispatchKeyEvent({ type: 'keyUp', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17, nativeVirtualKeyCode: 17, modifiers: 0 });
      await new Promise((r) => setTimeout(r, 800));
      const ok = await evalInPage(Runtime, `return !!d.querySelector('.xterm-rows');`);
      if (ok) return { ok: true, method: 'ctrl_backtick' };
    } catch (_) {}
  }
  return { ok: false, method: 'no_terminal' };
}

// xterm.js draws to canvas in Cursor 3.5 — no buffer on window, no row text in DOM.
// Relay advertises terminal_output: false for cursor; this read remains for diagnostics only.
async function readCursorTerminalOutput(Runtime) {
  try {
    const raw = await evalInPage(Runtime, CURSOR_TERMINAL_READ_EXPR);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeCursorTerminalInput(Runtime, cdpClient, text) {
  await ensureCursorTerminalVisible(Runtime, cdpClient);
  const Input = cdpClient && cdpClient.Input;
  const r = await evalInPage(Runtime, `
    var ta = d.querySelector('.xterm-helper-textarea');
    if (!ta) return 'no-terminal';
    ta.focus();
    return 'focused';
  `);
  if (r !== 'focused') return { ok: false, detail: r };
  if (!Input || typeof Input.insertText !== 'function' || typeof Input.dispatchKeyEvent !== 'function') {
    return { ok: false, detail: 'no-input-domain' };
  }
  try {
    const payload = String(text || '');
    if (payload) await Input.insertText({ text: payload });
    await Input.dispatchKeyEvent({
      type: 'keyDown',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    });
    await Input.dispatchKeyEvent({
      type: 'keyUp',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, detail: e.message || 'input_failed' };
  }
}

async function detectCursorPermissionDialog(Runtime) {
  try {
    const raw = await evalInPage(Runtime, CURSOR_PERMISSION_EXPR);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function respondCursorPermissionDialog(Runtime, choiceId, cdpClient = null) {
  const raw = await evalInPage(Runtime, `
    return (function() {
      function norm(t) { return String(t || '').replace(/\\s+/g, ' ').trim(); }
      function stripShortcut(label) {
        return norm(label)
          .replace(/[\\u23CE\\u21B5\\u2B90\\u2386\\u238B\\u2303\\u2325\\u21E7\\u2318]/g, '')
          .replace(/\\s*(?:Shift|Alt|Ctrl|Cmd|Meta)[+][^\\s]*/gi, '')
          .replace(/\\s+/g, ' ')
          .trim();
      }
      function isVisible(el) {
        if (!el || !el.getBoundingClientRect) return false;
        var r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      }
      function labelMatches(btn, wanted) {
        var label = stripShortcut(btn.innerText || btn.textContent || btn.getAttribute('aria-label') || '').toLowerCase();
        if (wanted === 'allow' && /^allow$|^run$|^run it$|^approve$|^yes$|^continue$/i.test(label)) return true;
        if (wanted === 'deny' && /^deny$|^reject$|^no$|^cancel$|^skip$/i.test(label)) return true;
        var slug = label.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
        return slug === wanted;
      }
      var wanted = ${JSON.stringify(choiceId)};
      var roots = Array.from(d.querySelectorAll('[role="dialog"], .pretty-dialog, .monaco-dialog-box'));
      for (var ri = 0; ri < roots.length; ri++) {
        var root = roots[ri];
        if (!isVisible(root)) continue;
        var btns = Array.from(root.querySelectorAll('button, [role="button"], a, span')).filter(isVisible);
        for (var bi = 0; bi < btns.length; bi++) {
          if (labelMatches(btns[bi], wanted)) {
            btns[bi].click();
            return 'clicked-dialog';
          }
        }
      }
      var conv = d.querySelector('.conversations');
      if (conv) {
        var pendingCard = conv.querySelector('.ui-shell-tool-call--pending');
        if (pendingCard && isVisible(pendingCard)) {
          var cardBtns = Array.from(pendingCard.querySelectorAll('button, [role="button"]')).filter(isVisible);
          for (var ci = 0; ci < cardBtns.length; ci++) {
            if (labelMatches(cardBtns[ci], wanted)) {
              cardBtns[ci].click();
              return 'clicked-shell-card';
            }
          }
        }
      }
      return 'not-found';
    })();
  `);
  if (raw === 'clicked-dialog' || raw === 'clicked-shell-card') return true;
  if (!cdpClient) return false;
  const allow = choiceId === 'allow' || choiceId === 'yes' || choiceId === 'run';
  const text = allow ? 'run it' : (choiceId === 'deny' ? 'no, do not run the command' : String(choiceId || 'no'));
  const sent = await sendCursorMessage(Runtime, cdpClient, text);
  return !!sent.ok;
}

async function detectCursorThinking(Runtime) {
  try {
    const raw = await evalInPage(Runtime, `
      function isVisible(el) {
        if (!el || !el.getBoundingClientRect) return false;
        var r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      }
      var thinking = false;
      var label = '';
      var conv = d.querySelector('.conversations');
      if (conv) {
        var lastAi = conv.querySelector('.composer-rendered-message[data-message-role="ai"]:last-of-type');
        if (lastAi) {
          var stream = lastAi.querySelector('[class*="streaming"], [class*="generating"], [aria-busy="true"], .codicon-loading');
          if (stream && isVisible(stream)) {
            thinking = true;
            label = 'Generating';
          }
          // Do not match collapsible "Thought/Working" header text alone — it remains
          // in history after interrupt. Only live stream/busy markers count.
        }
      }
      var composer = d.querySelector('.composer-bar, [class*="composer-bar"]');
      if (!thinking && composer) {
        var stopBtn = Array.from(composer.querySelectorAll('button, [role="button"]')).find(function(b) {
          if (!isVisible(b)) return false;
          var aria = String(b.getAttribute('aria-label') || '').toLowerCase();
          var cls = String(b.className || '').toLowerCase();
          return (aria.includes('stop') && aria !== 'stop command') || cls.includes('stop-generat') || cls.includes('composer-stop');
        });
        if (stopBtn) {
          thinking = true;
          label = 'Generating';
        }
      }
      return JSON.stringify({ thinking: thinking, label: label });
    `);
    return raw ? JSON.parse(raw) : { thinking: false, label: '' };
  } catch {
    return { thinking: false, label: '' };
  }
}

module.exports = {
  readCursorMessages,
  sendCursorMessage,
  steerCursorInput,
  interruptCursor,
  readCursorConfig,
  setCursorModel,
  readCursorAgentList,
  switchCursorAgent,
  newCursorAgent,
  readCursorRateLimit,
  readCursorFileChanges,
  respondCursorFileChange,
  acceptCursorFileChange,
  rejectCursorFileChange,
  ensureCursorTerminalVisible,
  readCursorTerminalOutput,
  writeCursorTerminalInput,
  detectCursorPermissionDialog,
  respondCursorPermissionDialog,
  detectCursorThinking,
  readCursorSettingsModels,
};
