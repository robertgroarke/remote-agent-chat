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
//    Prefer `.conversations`, glass/agent sidebars, `.composer-bar`, etc.
//
// 7. Cursor 3.5+ Agents/"glass" UI: agent rows live in
//    `.glass-sidebar-agent-menu-btn` (not `.agent-sidebar .monaco-list-row`).
//    Live composer input is TipTap `.ui-prompt-input-editor__input`, not only
//    `.aislash-editor-input`. Tool/thinking cards often sit as siblings of
//    `.composer-rendered-message` inside `.composer-human-ai-pair-container`.

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
  function norm(t) { return String(t || '').replace(/\\s+/g, ' ').trim(); }
  // Convert Cursor .markdown-root HTML into GFM so the web UI can render
  // tables/lists/code the way the Agents window shows them. innerText alone
  // flattens tables into one run-on line.
  function htmlToMarkdown(root) {
    if (!root) return '';
    function walk(node) {
      if (!node) return '';
      if (node.nodeType === 3) return node.textContent || '';
      if (node.nodeType !== 1) return '';
      var tag = node.tagName.toLowerCase();
      if (tag === 'br') return '\\n';
      if (tag === 'script' || tag === 'style' || tag === 'svg') return '';
      if (tag === 'table') {
        var rows = Array.from(node.querySelectorAll('tr')).map(function(tr) {
          return Array.from(tr.querySelectorAll('th,td')).map(function(cell) {
            return String(cell.innerText || '').trim().replace(/\\|/g, '\\\\|').replace(/\\n+/g, ' ');
          });
        }).filter(function(r) { return r.length > 0; });
        if (!rows.length) return '';
        var header = rows[0];
        var sep = header.map(function() { return '---'; });
        var body = rows.slice(1);
        return ['| ' + header.join(' | ') + ' |', '| ' + sep.join(' | ') + ' |']
          .concat(body.map(function(row) { return '| ' + row.join(' | ') + ' |'; }))
          .join('\\n') + '\\n\\n';
      }
      if (tag === 'thead' || tag === 'tbody' || tag === 'tr' || tag === 'th' || tag === 'td') {
        return Array.from(node.childNodes).map(walk).join('');
      }
      var kids = Array.from(node.childNodes).map(walk).join('');
      if (tag === 'p') return kids.trim() + '\\n\\n';
      if (/^h[1-6]$/.test(tag)) return Array(Number(tag[1]) + 1).join('#') + ' ' + kids.trim() + '\\n\\n';
      if (tag === 'li') {
        var parent = node.parentElement && node.parentElement.tagName.toLowerCase();
        var prefix = parent === 'ol' ? '1. ' : '- ';
        return prefix + kids.trim().replace(/\\n+/g, ' ') + '\\n';
      }
      if (tag === 'ul' || tag === 'ol') return kids + '\\n';
      if (tag === 'pre') return '\`\`\`\\n' + String(node.innerText || '').replace(/\\n+$/, '') + '\\n\`\`\`\\n\\n';
      if (tag === 'code') {
        if (node.parentElement && node.parentElement.tagName.toLowerCase() === 'pre') return kids;
        return '\`' + kids + '\`';
      }
      if (tag === 'strong' || tag === 'b') return '**' + kids + '**';
      if (tag === 'em' || tag === 'i') return '*' + kids + '*';
      if (tag === 'a') return '[' + kids + '](' + (node.getAttribute('href') || '') + ')';
      if (tag === 'blockquote') {
        return kids.split('\\n').map(function(l) { return '> ' + l; }).join('\\n') + '\\n\\n';
      }
      if (tag === 'hr') return '\\n---\\n\\n';
      return kids;
    }
    return squash(walk(root));
  }
  function classifyNode(node) {
    if (!node || node.nodeType !== 1) return null;
    var cls = String(node.className || '');
    if (/ui-thinking-collapsible/.test(cls)) return 'thinking';
    if (/ui-edit-tool-call/.test(cls)) return 'file_changes';
    if (/ui-shell-tool-call/.test(cls)) return 'tool_call';
    if (/ui-tool-call-card/.test(cls)) return 'tool_call';
    if (/ui-step-group-collapsible/.test(cls)) {
      var stepHdr = norm((node.querySelector('.ui-collapsible-header') || {}).innerText || '');
      // Step-group headers titled Thought/Thinking are thinking chips, not tools.
      if (/^thought\\b|^thinking\\b/i.test(stepHdr)) return 'thinking';
      return 'tool_call';
    }
    if (/\\bui-collapsible\\b/.test(cls) && node.querySelector(':scope > .ui-collapsible-header')) {
      var hdr = norm((node.querySelector(':scope > .ui-collapsible-header') || {}).innerText || '');
      // Cursor Agents shows "Worked for Xm" as a subtle status chip, not a tool card.
      if (/^worked\\b/i.test(hdr) || /^taking longer\\b/i.test(hdr)) return 'status';
      if (/^thought\\b|^thinking\\b/i.test(hdr)) return 'thinking';
      if (/explor|edit|search|ran |running|command|read |grep|glob|shell|creating|editing|monitored|background/i.test(hdr)) return 'tool_call';
      return 'status';
    }
    return null;
  }
  function blockStatus(node, kind) {
    var cls = String(node.className || '');
    if (/--pending|streaming|generating|running|--with-stop/i.test(cls)) return 'running';
    if (/failed|error|cancelled|canceled/i.test(cls + ' ' + (node.innerText || ''))) return 'failed';
    if (kind === 'thinking' || kind === 'tool_call' || kind === 'file_changes') return 'completed';
    return undefined;
  }
  function nodeToBlock(node, kind) {
    var headerEl = node.querySelector('.ui-collapsible-header');
    var title = norm(headerEl ? headerEl.innerText : '') || norm(String(node.innerText || '').split('\\n')[0] || '').substring(0, 120);
    // Shell tool cards expose a short description line; prefer that over the
    // full header dump (command args + "+N" counters).
    if (kind === 'tool_call') {
      var desc = node.querySelector('.ui-shell-tool-call__line-description, .ui-tool-call-card__title, .ui-step-group-collapsible .ui-collapsible-header');
      if (desc) {
        var descTitle = norm(desc.innerText || '');
        if (descTitle) title = descTitle.substring(0, 160);
      } else if (headerEl) {
        // Keep "Ran …" / "Explored …" first line + short summary when present.
        var headerLines = String(headerEl.innerText || '').split('\\n').map(function(l) { return l.trim(); }).filter(Boolean);
        if (headerLines.length >= 2) title = norm(headerLines.slice(0, 2).join(' — ')).substring(0, 160);
      }
    }
    var bodyEl = null;
    if (headerEl && headerEl.parentElement) {
      bodyEl = Array.from(headerEl.parentElement.children).find(function(c) {
        return c !== headerEl && /content|body|details/i.test(String(c.className || ''));
      }) || null;
    }
    // Prefer an explicit body/details pane. Cursor often keeps Thought/Worked/Ran
    // chips header-only (or with an empty details pane), and innerText of the
    // whole node is just the header with different newlines — treat that as no body
    // so the web UI can render Agents-style chips instead of empty <details>.
    var body = squash(bodyEl ? (bodyEl.innerText || '') : '');
    if (norm(body) === title) body = '';
    if (!body) {
      var full = squash(node.innerText || '');
      var fullNorm = norm(full);
      if (fullNorm && fullNorm !== title) {
        if (fullNorm.indexOf(title) === 0) body = squash(fullNorm.slice(title.length));
        else body = full;
      }
      if (norm(body) === title) body = '';
    }
    // Header-only shell/step cards: drop body that is only a whitespace variant of the title.
    if ((kind === 'tool_call' || kind === 'thinking') && body && norm(body) === norm(title)) body = '';
    if (kind === 'status') {
      return { type: 'status', title: title || 'Status', content: '', collapsed: true };
    }
    if (kind === 'thinking') {
      return { type: 'thinking', title: title || 'Thinking', content: body, collapsed: true, status: blockStatus(node, kind) };
    }
    if (kind === 'file_changes') {
      var files = [];
      var pathMatch = String(node.innerText || '').match(/([^\\s\\\\/]+\\.[a-z0-9]{1,12})\\b/i);
      if (pathMatch) files.push({ path: pathMatch[1] });
      return {
        type: 'file_changes',
        title: title || 'File changes',
        content: body,
        summary: title,
        files: files,
        status: blockStatus(node, kind),
        collapsed: true,
      };
    }
    return {
      type: 'tool_call',
      title: title || 'Tool',
      label: title || 'Tool',
      content: body,
      status: blockStatus(node, kind),
      collapsed: true,
    };
  }
  function markdownFromBubble(el) {
    // Prefer Cursor's rendered markdown root so tables/lists survive.
    var mdRoot = el.querySelector('.markdown-root');
    if (mdRoot) return htmlToMarkdown(mdRoot);
    var clone = el.cloneNode(true);
    clone.querySelectorAll(
      '.ui-thinking-collapsible, .ui-edit-tool-call, .ui-shell-tool-call, .ui-tool-call-card, .ui-step-group-collapsible, .ui-collapsible'
    ).forEach(function(n) { n.remove(); });
    return squash(clone.innerText || clone.textContent || '');
  }
  function collectStructuredFromRoot(rootEl) {
    var blocks = [];
    var markdownParts = [];
    var seen = [];
    function already(node) {
      return seen.some(function(s) { return s === node || (s.contains && s.contains(node)); });
    }
    function visit(node) {
      if (!node || node.nodeType !== 1) return;
      if (already(node)) return;
      var roleAttr = (node.getAttribute('data-message-role') || '').toLowerCase();
      if (node.classList && node.classList.contains('composer-rendered-message') && roleAttr === 'ai') {
        // Nested structured cards inside the bubble first, then remaining markdown.
        var nested = [];
        Array.from(node.querySelectorAll(
          '.ui-thinking-collapsible, .ui-edit-tool-call, .ui-shell-tool-call, .ui-tool-call-card, .ui-step-group-collapsible, .ui-collapsible'
        )).forEach(function(card) {
          if (already(card)) return;
          if (nested.some(function(n) { return n.contains(card); })) return;
          nested.push(card);
        });
        nested.forEach(function(card) {
          var kind = classifyNode(card);
          if (!kind) return;
          seen.push(card);
          blocks.push(nodeToBlock(card, kind));
        });
        var md = markdownFromBubble(node);
        if (md) {
          markdownParts.push(md);
          blocks.push({ type: 'markdown', content: md });
        }
        seen.push(node);
        return;
      }
      var kind = classifyNode(node);
      if (kind) {
        seen.push(node);
        blocks.push(nodeToBlock(node, kind));
        return;
      }
      Array.from(node.children || []).forEach(visit);
    }
    Array.from(rootEl.children || []).forEach(visit);
    // Also catch direct structured siblings that visit may miss when nested wrappers exist.
    Array.from(rootEl.querySelectorAll(
      '.ui-thinking-collapsible, .ui-edit-tool-call, .ui-shell-tool-call, .ui-tool-call-card, .ui-step-group-collapsible, .ui-collapsible'
    )).forEach(function(card) {
      if (already(card)) return;
      if (seen.some(function(s) { return s.contains && s.contains(card); })) return;
      var kind = classifyNode(card);
      if (!kind) return;
      seen.push(card);
      blocks.push(nodeToBlock(card, kind));
    });
    return { blocks: blocks, content: squash(markdownParts.join('\\n\\n')) };
  }
  function pushMsg(msgs, msg) {
    if (!msg) return;
    if (msg.role === 'user') {
      if (!msg.content) return;
    } else if (msg.role === 'assistant') {
      var hasBlocks = Array.isArray(msg.content_blocks) && msg.content_blocks.length > 0;
      if (!msg.content && !hasBlocks) return;
      if (!msg.content && hasBlocks) {
        msg.content = msg.content_blocks.filter(function(b) {
          return b.type === 'markdown' || (b.content && b.type !== 'status');
        }).map(function(b) {
          return squash(b.content || b.title || b.label || '');
        }).filter(Boolean).join('\\n\\n');
      }
    } else return;
    var prev = msgs.length ? msgs[msgs.length - 1] : null;
    if (prev && prev.role === msg.role && prev.content === msg.content
      && JSON.stringify(prev.content_blocks || null) === JSON.stringify(msg.content_blocks || null)) {
      return;
    }
    msgs.push(msg);
  }

  var msgs = [];
  var root = d.querySelector('.conversations');
  if (!root) return JSON.stringify(msgs);

  var pairs = Array.from(root.querySelectorAll('.composer-human-ai-pair-container'));
  if (pairs.length) {
    pairs.forEach(function(pair) {
      // Cursor keeps many empty pair shells in the DOM; skip them.
      if (!squash(pair.innerText || pair.textContent || '')) return;
      Array.from(pair.querySelectorAll('.composer-rendered-message[data-message-role="human"]')).forEach(function(el) {
        pushMsg(msgs, { role: 'user', content: squash(el.innerText || el.textContent || '') });
      });
      var structured = collectStructuredFromRoot(pair);
      // Prefer structured assistant turn when tools/thinking exist; otherwise
      // fall back to plain AI bubble text so empty pairs still show replies.
      if (structured.blocks.length > 0) {
        var onlyMarkdown = structured.blocks.every(function(b) { return b.type === 'markdown'; });
        pushMsg(msgs, {
          role: 'assistant',
          content: structured.content || '',
          // Keep status chips + markdown together; drop content_blocks only when
          // there is nothing but plain markdown.
          content_blocks: onlyMarkdown ? undefined : structured.blocks,
        });
      } else {
        Array.from(pair.querySelectorAll('.composer-rendered-message[data-message-role="ai"]')).forEach(function(el) {
          pushMsg(msgs, { role: 'assistant', content: squash(el.innerText || el.textContent || '') });
        });
      }
    });
    return JSON.stringify(msgs);
  }

  // Legacy flat transcript (no pair containers).
  var bubbles = Array.from(root.querySelectorAll('.composer-rendered-message'));
  for (var i = 0; i < bubbles.length; i++) {
    var el = bubbles[i];
    var roleAttr = (el.getAttribute('data-message-role') || '').toLowerCase();
    var role;
    if (roleAttr === 'human') role = 'user';
    else if (roleAttr === 'ai') role = 'assistant';
    else continue;
    if (role === 'user') {
      pushMsg(msgs, { role: role, content: squash(el.innerText || el.textContent || '') });
      continue;
    }
    var structuredBubble = collectStructuredFromRoot(el);
    if (structuredBubble.blocks.some(function(b) { return b.type !== 'markdown'; })) {
      pushMsg(msgs, {
        role: 'assistant',
        content: structuredBubble.content || squash(el.innerText || ''),
        content_blocks: structuredBubble.blocks,
      });
    } else {
      pushMsg(msgs, { role: 'assistant', content: squash(el.innerText || el.textContent || '') });
    }
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
    var host = d.querySelector(
      '.agent-prompt-input-root, .ui-prompt-input, .agent-conversation-composer, .has-composer-editor .composer-bar, .composer-bar.editor, .composer-bar'
    );
    var inputSelectors = '.ui-prompt-input-editor__input[contenteditable="true"], .tiptap.ProseMirror[contenteditable="true"], .aislash-editor-input[contenteditable="true"]';
    var inputs = host
      ? Array.from(host.querySelectorAll(inputSelectors))
      : [];
    var input = null;
    for (var ii = inputs.length - 1; ii >= 0; ii--) {
      if (isVisible(inputs[ii]) && !/readonly/i.test(String(inputs[ii].className || ''))) { input = inputs[ii]; break; }
    }
    if (input) {
      var box = input.closest('.ui-prompt-input, .ai-input-full-input-box, .composer-input-blur-wrapper, .agent-prompt-input-root');
      if (box) trigger = box.querySelector('button.ui-model-picker__trigger, .ui-model-picker__trigger, [class*="model-picker"]');
    }
    if (!trigger && host) {
      trigger = host.querySelector('button.ui-model-picker__trigger, .ui-model-picker__trigger, [class*="model-picker"]');
    }
    if (!trigger) {
      trigger = d.querySelector('button.ui-model-picker__trigger, .ui-model-picker__trigger');
    }
    var model = null;
    if (trigger) {
      model = norm(trigger.getAttribute('aria-label') || trigger.textContent || trigger.innerText || '');
      model = model.replace(/^model\\s*/i, '').trim();
    }
    // Glass toolbar often shows the model name as plain text near the submit button.
    if (!model || model === 'unknown') {
      var toolbar = d.querySelector('.ui-prompt-input-toolbar, .ui-prompt-input__container, .agent-prompt-input-root');
      if (toolbar) {
        var t = norm(toolbar.innerText || '');
        var m = t.match(/Cursor[^\\n]{0,80}|GPT[^\\n]{0,40}|Claude[^\\n]{0,40}|Gemini[^\\n]{0,40}|Grok[^\\n]{0,40}/i);
        if (m) model = norm(m[0]);
      }
    }
    var openList = d.querySelector('[role="listbox"], [role="menu"]');
    if (openList) {
      var selected = openList.querySelector('[aria-selected="true"], [aria-checked="true"]');
      if (selected) model = norm(selected.textContent || selected.getAttribute('aria-label') || '') || model;
    }
    var modeScope = host || d.querySelector('.composer-bar, .has-composer-editor, .agent-conversation-composer');
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
    // Strip trailing relative age suffixes Cursor appends ("1m", "19d", "2h", "43d").
    function stripAge(title) {
      return norm(title).replace(/\\s+\\d+[smhdw]$/i, '').trim();
    }
    function firstLine(el) {
      var raw = String(el.innerText || el.textContent || '');
      var lines = raw.split(/\\n+/);
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (line) return line.substring(0, 80);
      }
      return '';
    }
    function agentTitleFromButton(btn) {
      var label = btn.querySelector(
        '.ui-sidebar-menu-button-label, .ui-sidebar-label-row-title, .ui-sidebar-menu-button-content, .ui-sidebar-label-row-text'
      );
      var raw = label ? firstLine(label) : firstLine(btn);
      return stripAge(raw);
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
    function isNoiseTitle(title) {
      if (!title || title.length < 2) return true;
      return /^(new agent|automations|customize|no agents yet|search agents|agents|workspaces?)$/i.test(title);
    }
    var items = [];
    var seen = {};
    var activeTitle = '';
    var tabTitleEl = d.querySelector('.chat-title-tab-title, .chat-title-tab-trigger .chat-title-tab-title');
    if (tabTitleEl) activeTitle = stripAge(firstLine(tabTitleEl));
    if (!activeTitle) {
      var tabTrigger = d.querySelector('.chat-title-tab-trigger');
      if (tabTrigger) {
        activeTitle = stripAge(firstLine(tabTrigger).replace(/^chat title\\.?\\s*/i, ''));
      }
    }

    // Active title from glass chat tab OR selected editor agent tabs.
    if (!activeTitle) {
      var selectedTabs = Array.from(d.querySelectorAll('.tabs-container .tab.active.selected, .tabs-container .tab.selected, .tabs-container .tab.active'));
      for (var ti = 0; ti < selectedTabs.length; ti++) {
        var tLabel = stripAge(firstLine(selectedTabs[ti].querySelector('.label-name') || selectedTabs[ti]));
        var tAria = stripAge(selectedTabs[ti].getAttribute('aria-label') || '');
        var cand = tLabel || tAria;
        if (cand && !isNoiseTitle(cand) && !/\\.[a-z0-9]{1,8}$/i.test(cand) && cand.indexOf('/') === -1 && cand.indexOf('\\\\') === -1) {
          activeTitle = cand;
          break;
        }
      }
    }

    // Cursor 3.5+ glass Agents sidebar (visible even when classic .agent-sidebar is absent).
    var glassBtns = Array.from(d.querySelectorAll('.glass-sidebar-agent-menu-btn'));
    if (glassBtns.length) {
      glassBtns.forEach(function(btn, idx) {
        var title = agentTitleFromButton(btn);
        if (isNoiseTitle(title)) return;
        var id = slugId(title);
        if (!id) return;
        var active = false;
        if (activeTitle && norm(title).toLowerCase() === norm(activeTitle).toLowerCase()) active = true;
        var item = btn.closest('.ui-sidebar-menu-item') || btn;
        if (item.getAttribute('aria-selected') === 'true' || /selected|active|current/i.test(String(item.className || '') + ' ' + String(btn.className || ''))) {
          active = true;
        }
        pushItem(items, seen, {
          id: id,
          title: title,
          active: active,
          index: idx,
          source: 'glass-sidebar',
        });
      });
    }

    // Classic / unified Agents sidebar cells (workbench window).
    var cells = Array.from(d.querySelectorAll('.agent-sidebar-cell, .unified-agents-sidebar .agent-sidebar-cell'));
    if (cells.length) {
      cells.forEach(function(cell, idx) {
        var textEl = cell.querySelector('.agent-sidebar-cell-text, .agent-sidebar-cell-content');
        var title = stripAge(textEl ? firstLine(textEl) : firstLine(cell));
        if (isNoiseTitle(title)) return;
        var id = slugId(title);
        if (!id) return;
        var active = /selected|active|current/i.test(String(cell.className || ''));
        if (!active && activeTitle && norm(title).toLowerCase() === norm(activeTitle).toLowerCase()) active = true;
        pushItem(items, seen, {
          id: id,
          title: title,
          active: active,
          index: items.length + idx,
          source: 'agent-sidebar-cell',
        });
      });
    }

    // Legacy monaco agent sidebar rows.
    var agentsRoot = d.querySelector('.agent-sidebar, .unified-agents-sidebar, [class*="agent-sidebar"], [class*="agents-panel"]');
    if (agentsRoot) {
      var rows = Array.from(agentsRoot.querySelectorAll('.monaco-list-row'));
      rows.forEach(function(row, idx) {
        var title = stripAge(firstLine(row));
        if (isNoiseTitle(title)) return;
        var id = slugId(title);
        if (!id) return;
        var active = row.getAttribute('aria-selected') === 'true' || row.classList.contains('sidebar-list-item-selected');
        if (!active && activeTitle && norm(title).toLowerCase() === norm(activeTitle).toLowerCase()) active = true;
        pushItem(items, seen, {
          id: id,
          title: title,
          active: active,
          index: items.length + idx,
          source: 'agent-sidebar',
        });
      });
    }

    // Editor-group agent tabs (composer editors opened as tabs).
    var editorTabs = Array.from(d.querySelectorAll('.tabs-container .tab'));
    editorTabs.forEach(function(tab, idx) {
      var label = stripAge(firstLine(tab.querySelector('.label-name') || tab));
      var aria = stripAge(tab.getAttribute('aria-label') || '');
      var title = label || aria;
      if (isNoiseTitle(title)) return;
      // Skip obvious file tabs.
      if (/\\.[a-z0-9]{1,8}$/i.test(title)) return;
      if (title.indexOf('/') !== -1 || title.indexOf('\\\\') !== -1) return;
      var id = slugId(title);
      if (!id) return;
      var active = tab.classList.contains('active') || tab.classList.contains('selected') || tab.getAttribute('aria-selected') === 'true';
      if (!active && activeTitle && norm(title).toLowerCase() === norm(activeTitle).toLowerCase()) active = true;
      pushItem(items, seen, {
        id: id,
        title: title,
        active: active,
        index: items.length + idx,
        source: 'editor-tab',
      });
    });

    // Fallback: at least expose the active chat title tab so remote UI can show a thread.
    if (!items.length && activeTitle && !isNoiseTitle(activeTitle)) {
      var tid = slugId(activeTitle);
      if (tid) {
        pushItem(items, seen, {
          id: tid,
          title: activeTitle,
          active: true,
          index: 0,
          source: 'title-tab',
        });
      }
    }

    // Ensure exactly one active when we know the title tab.
    if (activeTitle) {
      var matched = false;
      items.forEach(function(it) {
        if (norm(it.title).toLowerCase() === norm(activeTitle).toLowerCase()) {
          it.active = true;
          matched = true;
        } else if (matched) {
          it.active = false;
        }
      });
      if (matched) {
        items.forEach(function(it) {
          if (norm(it.title).toLowerCase() !== norm(activeTitle).toLowerCase()) it.active = false;
        });
      }
    }
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
      '.agent-prompt-input-root, .ui-prompt-input, .agent-conversation-composer, .has-composer-editor .composer-bar, .editor-group-container.has-composer-editor .composer-bar, .composer-bar.editor, .composer-bar'
    );
  }
  function findComposerInput() {
    var host = composerHost();
    var selectors = [
      '.ui-prompt-input-editor__input[contenteditable="true"]',
      '.tiptap.ProseMirror.ui-prompt-input-editor__input[contenteditable="true"]',
      '.tiptap.ProseMirror[contenteditable="true"]',
      '.aislash-editor-input[contenteditable="true"]',
      '.aislash-editor-input',
    ].join(', ');
    var all = host
      ? Array.from(host.querySelectorAll(selectors))
      : Array.from(d.querySelectorAll(selectors));
    for (var i = all.length - 1; i >= 0; i--) {
      var el = all[i];
      if (!isVisible(el)) continue;
      // Skip readonly transcript mirrors of prior human prompts.
      if (/readonly/i.test(String(el.className || ''))) continue;
      if (el.closest && el.closest('.ui-prompt-input-tiptap-readonly, .aislash-editor-input-readonly, .composer-human-message')) continue;
      var ce = el.getAttribute('contenteditable');
      if (ce && String(ce).toLowerCase() === 'false') continue;
      return el;
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
    return input.closest('.ui-prompt-input, .agent-prompt-input-root, .composer-input-blur-wrapper, .ai-input-full-input-box');
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
    // Prefer explicit TipTap submit when it is a Send control; fall back to Enter.
    const clicked = await evalInPage(Runtime, `
      function isVisible(el) {
        if (!el || !el.getBoundingClientRect) return false;
        var r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      }
      var btn = d.querySelector('.ui-prompt-input-submit-button');
      if (!btn || !isVisible(btn)) return 'no-btn';
      var aria = String(btn.getAttribute('aria-label') || '').toLowerCase();
      if (aria.includes('stop')) return 'stop-visible';
      btn.click();
      return 'clicked';
    `);
    if (clicked !== 'clicked') {
      await dispatchTrustedEnter(Input);
    }
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
      return { ok: true, method: clicked === 'clicked' ? 'submit_button' : 'cdp_enter' };
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
      // Glass TipTap submit button doubles as Stop while generating.
      var submitStop = d.querySelector('.ui-prompt-input-submit-button');
      if (submitStop && isVisible(submitStop)) {
        var aria = String(submitStop.getAttribute('aria-label') || '').toLowerCase();
        if (aria.includes('stop')) { submitStop.click(); return 'clicked-submit-stop'; }
      }
      var scope = d.querySelector('.agent-prompt-input-root, .ui-prompt-input, .composer-bar, [class*="composer-bar"], .has-composer-editor, .agent-conversation-composer') || d;
      var btns = Array.from(scope.querySelectorAll('button, [role="button"]')).filter(function(b) {
        if (!isVisible(b)) return false;
        if (b.closest && b.closest('.ui-shell-tool-call')) return false;
        var aria = String(b.getAttribute('aria-label') || '').toLowerCase();
        var cls = String(b.className || '').toLowerCase();
        return (aria.includes('stop') && aria !== 'stop command') || cls.includes('stop-generat') || cls.includes('composer-stop') || cls.includes('submit-button');
      }).filter(function(b) {
        var aria = String(b.getAttribute('aria-label') || '').toLowerCase();
        return aria.includes('stop');
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
    if (r === 'clicked' || r === 'clicked-submit-stop') return { ok: true, method: 'stop_button' };
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
      function stripAge(title) {
        return norm(title).replace(/\\s+\\d+[smhdw]$/i, '').trim();
      }
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
      function titleOfButton(btn) {
        var label = btn.querySelector(
          '.ui-sidebar-menu-button-label, .ui-sidebar-label-row-title, .ui-sidebar-menu-button-content, .ui-sidebar-label-row-text'
        );
        return stripAge(label ? firstLine(label) : firstLine(btn));
      }
      var targetId = ${JSON.stringify(agentId)};

      // Glass sidebar first (Cursor 3.5+ Agents window).
      var glassBtns = Array.from(d.querySelectorAll('.glass-sidebar-agent-menu-btn'));
      for (var g = 0; g < glassBtns.length; g++) {
        var gTitle = titleOfButton(glassBtns[g]);
        if (slugId(gTitle) === targetId) {
          glassBtns[g].click();
          return 'clicked-glass';
        }
      }

      // Unified / classic agent sidebar cells.
      var cells = Array.from(d.querySelectorAll('.agent-sidebar-cell'));
      for (var c = 0; c < cells.length; c++) {
        var textEl = cells[c].querySelector('.agent-sidebar-cell-text, .agent-sidebar-cell-content');
        var cTitle = stripAge(textEl ? firstLine(textEl) : firstLine(cells[c]));
        if (slugId(cTitle) === targetId) {
          cells[c].click();
          return 'clicked-cell';
        }
      }

      var agentsRoot = d.querySelector('.agent-sidebar, .unified-agents-sidebar, [class*="agent-sidebar"], [class*="agents-panel"]');
      if (agentsRoot) {
        var rows = Array.from(agentsRoot.querySelectorAll('.monaco-list-row'));
        for (var i = 0; i < rows.length; i++) {
          var title = stripAge(firstLine(rows[i]));
          if (!title) continue;
          if (slugId(title) === targetId) {
            rows[i].click();
            return 'clicked-sidebar';
          }
        }
      }

      // Editor tabs hosting agent transcripts.
      var tabs = Array.from(d.querySelectorAll('.tabs-container .tab'));
      for (var t = 0; t < tabs.length; t++) {
        var label = stripAge(firstLine(tabs[t].querySelector('.label-name') || tabs[t]));
        var aria = stripAge(tabs[t].getAttribute('aria-label') || '');
        var tabTitle = label || aria;
        if (slugId(tabTitle) === targetId) {
          tabs[t].click();
          return 'clicked-tab';
        }
      }
      return 'not-found';
    })();
  `);
  const ok = raw === 'clicked-sidebar' || raw === 'clicked-glass' || raw === 'clicked-cell' || raw === 'clicked-tab';
  return { ok, detail: ok ? 'clicked' : (raw || 'not-found') };
}

async function newCursorAgent(Runtime) {
  const raw = await evalInPage(Runtime, `
    function isVisible(el) {
      if (!el || !el.getBoundingClientRect) return false;
      var r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }
    var candidates = Array.from(d.querySelectorAll('a, button, [role="button"], .ui-sidebar-menu-button, .ui-icon-button'));
    var btn = candidates.find(function(el) {
      if (!isVisible(el)) return false;
      var t = ((el.getAttribute('aria-label') || '') + ' ' + (el.textContent || '')).toLowerCase();
      return /new agent/.test(t);
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
    function labelOf(el) {
      return norm(el.innerText || el.textContent || el.getAttribute('aria-label') || '');
    }
    // Find Keep/Undo controls, then climb to the compact action bar
    // ("1 File Undo Keep Review") — never use the whole .composer-bar.editor
    // which also contains the transcript.
    var keepBtns = Array.from(d.querySelectorAll('button, [role="button"], a, div, span')).filter(function(el) {
      return isVisible(el) && !inConversations(el) && /^keep$/i.test(labelOf(el));
    });
    var out = [];
    var seen = {};
    keepBtns.forEach(function(keepBtn, sidx) {
      var bar = keepBtn.parentElement;
      for (var depth = 0; bar && depth < 8; depth++) {
        var text = norm(bar.innerText || '');
        var hasUndo = /\\bundo\\b/i.test(text);
        var hasKeep = /\\bkeep\\b/i.test(text);
        // Compact bar: Keep+Undo and short enough that it is not the transcript host.
        if (hasUndo && hasKeep && text.length > 0 && text.length < 120) break;
        bar = bar.parentElement;
      }
      if (!bar || inConversations(bar)) return;
      var barText = norm(bar.innerText || '');
      if (barText.length >= 120) return;
      var path = '';
      var fileMatch = barText.match(/([A-Za-z0-9_./\\\\-]+\\.[a-z0-9]{1,12})\\b/);
      if (fileMatch) path = fileMatch[1];
      if (!path) {
        var fileCount = barText.match(/(\\d+)\\s*files?/i);
        path = fileCount ? (fileCount[1] + '-files') : ('pending-' + sidx);
      }
      var id = stableId(path);
      if (seen[id]) return;
      seen[id] = true;
      out.push({
        id: id,
        path: path,
        summary: barText.substring(0, 200),
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
      function isVisible(el) {
        if (!el || !el.getBoundingClientRect) return false;
        var r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      }
      function inConversations(el) {
        return !!(el && el.closest && el.closest('.conversations'));
      }
      function labelOf(el) {
        return norm(el.innerText || el.textContent || el.getAttribute('aria-label') || '');
      }
      var wanted = ${JSON.stringify(changeId)};
      var action = ${JSON.stringify(action)};
      var re = action === 'accept'
        ? /^accept$|^accept all$|^approve$|^keep$/i
        : /^reject$|^reject all$|^discard$|^undo$/i;

      function findCompactBars() {
        var keeps = Array.from(d.querySelectorAll('button, [role="button"], a, div, span')).filter(function(el) {
          return isVisible(el) && !inConversations(el) && /^keep$/i.test(labelOf(el));
        });
        var bars = [];
        var seen = {};
        keeps.forEach(function(keepBtn) {
          var bar = keepBtn.parentElement;
          for (var depth = 0; bar && depth < 8; depth++) {
            var text = norm(bar.innerText || '');
            if (/\\bundo\\b/i.test(text) && /\\bkeep\\b/i.test(text) && text.length > 0 && text.length < 120) break;
            bar = bar.parentElement;
          }
          if (!bar || inConversations(bar) || norm(bar.innerText || '').length >= 120) return;
          if (seen[bar]) return;
          seen[bar] = true;
          bars.push(bar);
        });
        return bars;
      }

      function pickBtn(root) {
        var found = null;
        Array.from(root.querySelectorAll('button, [role="button"], a, div, span')).forEach(function(b) {
          if (found || !isVisible(b) || inConversations(b)) return;
          if (re.test(labelOf(b))) found = b;
        });
        return found;
      }

      var bars = findCompactBars();
      for (var i = 0; i < bars.length; i++) {
        var btn = pickBtn(bars[i]);
        if (btn) { btn.click(); return 'clicked-live'; }
      }

      // Fallback: edit tool cards in transcript (older Cursor builds).
      var cards = Array.from(d.querySelectorAll('.ui-edit-tool-call'));
      for (var c = 0; c < cards.length; c++) {
        var cbtn = pickBtn(cards[c]);
        if (cbtn) { cbtn.click(); return 'clicked-card'; }
      }
      return 'no-btn';
    })();
  `);
  return raw === 'clicked-live' || raw === 'clicked-card';
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
        }
        // Live shell/tool cards often sit outside the AI bubble but inside the pair.
        var lastPair = null;
        var pairs = conv.querySelectorAll('.composer-human-ai-pair-container');
        if (pairs.length) lastPair = pairs[pairs.length - 1];
        if (!thinking && lastPair) {
          var running = lastPair.querySelector(
            '.ui-shell-tool-call--with-stop, .ui-shell-tool-call--pending, [class*="streaming"], [aria-busy="true"], .codicon-loading'
          );
          if (running && isVisible(running)) {
            thinking = true;
            label = 'Generating';
          }
          var editing = Array.from(lastPair.querySelectorAll('.ui-collapsible-header')).some(function(h) {
            return /^editing\\b/i.test(String(h.innerText || '').trim());
          });
          if (editing) { thinking = true; label = 'Generating'; }
        }
      }
      var submitStop = d.querySelector('.ui-prompt-input-submit-button');
      if (!thinking && submitStop && isVisible(submitStop)) {
        var aria = String(submitStop.getAttribute('aria-label') || '').toLowerCase();
        if (aria.includes('stop')) {
          thinking = true;
          label = 'Generating';
        }
      }
      var composer = d.querySelector('.agent-prompt-input-root, .ui-prompt-input, .composer-bar, [class*="composer-bar"]');
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
