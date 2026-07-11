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
  function composerTabTitle(group) {
    if (!group) return '';
    var tab = group.querySelector('.tabs-container .tab.active.selected, .tabs-container .tab[aria-selected="true"], .tabs-container .tab.selected, .tabs-container .tab.active');
    if (!tab) return '';
    return norm((tab.querySelector('.label-name') || tab).textContent || tab.getAttribute('aria-label') || '');
  }
  function selectedComposerGroup() {
    var groups = Array.from(d.querySelectorAll('.editor-group-container.has-composer-editor'));
    // A newly-created Cursor Agent has no sidebar row until its first send.
    // Its exact active "New Agent" editor tab is therefore the only native
    // identity available and must outrank the stale previously-selected row.
    var blankGroups = groups.filter(function(group) { return composerTabTitle(group) === 'New Agent'; });
    if (blankGroups.length === 1) return blankGroups[0];
    var selected = d.querySelector('.agent-sidebar-cell[data-selected="true"]');
    var title = selected ? norm((selected.querySelector('.agent-sidebar-cell-text') || {}).textContent) : '';
    if (title) {
      var matches = groups.filter(function(group) { return composerTabTitle(group) === title; });
      if (matches.length === 1) return matches[0];
    }
    return groups.length === 1 ? groups[0] : null;
  }
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
    var messageKind = String(node.getAttribute('data-message-kind') || '').toLowerCase();
    if (messageKind === 'tool') return 'tool_call';
    if (messageKind === 'thinking') return 'thinking';
    if (messageKind === 'edit' || messageKind === 'file_change' || messageKind === 'file_changes') return 'file_changes';
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
      var action = node.querySelector('.ui-tool-call-line-action');
      var details = node.querySelector('.ui-tool-call-line-details');
      if (action || details) {
        var lineTitle = norm((action ? action.innerText : '') + ' ' + (details ? details.innerText : ''));
        if (lineTitle) title = lineTitle.substring(0, 160);
      }
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
        var directKind = classifyNode(node);
        if (directKind === 'tool_call' || directKind === 'file_changes') {
          seen.push(node);
          blocks.push(nodeToBlock(node, directKind));
          return;
        }
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
  var group = selectedComposerGroup();
  var root = group ? group.querySelector('.conversations') : d.querySelector('.conversations');
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
    function norm(t) { return String(t || '').replace(/[\\u200B-\\u200D\\uFEFF]/g, '').replace(/\\s+/g, ' ').trim(); }
    function isVisible(el) {
      if (!el || !el.getBoundingClientRect) return false;
      var r = el.getBoundingClientRect();
      return r.width > 40 && r.height > 8;
    }
    function selectedComposerGroup() {
      var groups = Array.from(d.querySelectorAll('.editor-group-container.has-composer-editor'));
      function tabTitle(group) {
        var tab = group.querySelector('.tabs-container .tab.active.selected, .tabs-container .tab[aria-selected="true"], .tabs-container .tab.selected, .tabs-container .tab.active');
        return tab ? norm((tab.querySelector('.label-name') || tab).textContent || tab.getAttribute('aria-label') || '') : '';
      }
      var blankGroups = groups.filter(function(group) { return tabTitle(group) === 'New Agent'; });
      if (blankGroups.length === 1) return blankGroups[0];
      var selected = d.querySelector('.agent-sidebar-cell[data-selected="true"]');
      var title = selected ? norm((selected.querySelector('.agent-sidebar-cell-text') || {}).textContent) : '';
      if (title) {
        var matches = groups.filter(function(group) { return tabTitle(group) === title; });
        return matches.length === 1 ? matches[0] : null;
      }
      return groups.length === 1 ? groups[0] : null;
    }
    function stripMarkup(value) {
      return norm(String(value || '').replace(/<[^>]*>/g, ''));
    }
    function modelPickerProps(trigger) {
      if (!trigger) return null;
      var key = Object.keys(trigger).find(function(k) { return k.indexOf('__reactFiber$') === 0; });
      var fiber = key ? trigger[key] : null;
      var depth = 0;
      while (fiber && depth++ < 40) {
        var props = fiber.memoizedProps;
        if (props && Array.isArray(props.models)) return props;
        fiber = fiber.return;
      }
      return null;
    }
    var group = selectedComposerGroup();
    var trigger = group ? group.querySelector('button.ui-model-picker__trigger, .ui-model-picker__trigger') : null;
    var host = group ? group.querySelector(
      '.agent-prompt-input-root, .ui-prompt-input, .agent-conversation-composer, .has-composer-editor .composer-bar, .composer-bar.editor, .composer-bar'
    ) : null;
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
    var model = null;
    if (trigger) {
      model = norm(trigger.getAttribute('aria-label') || trigger.textContent || trigger.innerText || '');
      model = model.replace(/^model\\s*/i, '').trim();
    }
    var props = modelPickerProps(trigger);
    var availableModels = [];
    var currentId = model || 'unknown';
    var currentMatch = null;
    if (props && Array.isArray(props.models)) {
      props.models.forEach(function(nativeModel) {
        var variants = Array.isArray(nativeModel.variants) ? nativeModel.variants : [];
        variants.forEach(function(variant) {
          var variantLabel = stripMarkup(variant.displayNameOutsidePicker || variant.displayName || nativeModel.clientDisplayName || nativeModel.name);
          if (variantLabel === model) currentMatch = { nativeModel: nativeModel, variant: variant, label: variantLabel };
        });
        if (nativeModel.defaultOn === false || nativeModel.name === 'default') return;
        var preferred = variants.find(function(variant) { return variant.isDefaultNonMaxConfig; }) || variants[0];
        if (!preferred) return;
        var label = stripMarkup(preferred.displayNameOutsidePicker || preferred.displayName || nativeModel.clientDisplayName || nativeModel.name);
        var id = norm(preferred.variantStringRepresentation || preferred.legacySlug || nativeModel.name);
        if (id && label) availableModels.push({ id: id, label: label });
      });
    }
    if (currentMatch) {
      currentId = norm(currentMatch.variant.variantStringRepresentation || currentMatch.variant.legacySlug || currentMatch.nativeModel.name) || currentId;
      if (!availableModels.some(function(item) { return item.id === currentId; })) {
        availableModels.unshift({ id: currentId, label: currentMatch.label });
      }
    }
    var modeScope = host || group;
    var modeBtn = modeScope
      ? Array.from(modeScope.querySelectorAll('button, [role="tab"], [role="menuitem"]')).find(function(el) {
          var text = norm((el.textContent || '') + ' ' + (el.getAttribute('aria-label') || '')).toLowerCase();
          return /^agent$|^ask$|^edit$|^composer$/.test(text) && text.length < 24;
        })
      : null;
    return JSON.stringify({
      model_id: currentId,
      mode: modeBtn ? norm(modeBtn.textContent || modeBtn.getAttribute('aria-label') || '') : 'unknown',
      available_models: availableModels,
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
    function occurrenceId(nodes, index, title, readTitle, newestFirst) {
      var base = slugId(title);
      if (!base) return '';
      var same = [];
      nodes.forEach(function(node, nodeIndex) {
        if (norm(readTitle(node)).toLowerCase() === norm(title).toLowerCase()) same.push(nodeIndex);
      });
      var position = same.indexOf(index);
      if (position < 0 || same.length < 2) return base;
      var ordinal = newestFirst ? same.length - position : position + 1;
      return ordinal > 1 ? base + '--' + ordinal : base;
    }
    function titleOfCell(cell) {
      var textEl = cell.querySelector('.agent-sidebar-cell-text, .agent-sidebar-cell-content');
      return stripAge(textEl ? firstLine(textEl) : firstLine(cell));
    }
    function titleOfRow(row) { return stripAge(firstLine(row)); }
    function titleOfTab(tab) {
      var label = stripAge(firstLine(tab.querySelector('.label-name') || tab));
      var aria = stripAge(tab.getAttribute('aria-label') || '');
      return label || aria;
    }
    var resourceTabs = Array.from(d.querySelectorAll('.tabs-container .tab[data-resource-name]'));
    function resourceKeyForTitle(title) {
      var matches = resourceTabs.filter(function(tab) {
        return norm(titleOfTab(tab)).toLowerCase() === norm(title).toLowerCase();
      });
      var selected = matches.filter(function(tab) {
        return tab.getAttribute('aria-selected') === 'true'
          || tab.classList.contains('selected')
          || tab.classList.contains('active');
      });
      var tab = selected.length === 1 ? selected[0] : (matches.length === 1 ? matches[0] : null);
      var key = tab ? norm(tab.getAttribute('data-resource-name') || '') : '';
      return /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(key) ? key : '';
    }
    function pushItem(items, seen, item) {
      if (!item.id || seen[item.id]) return;
      seen[item.id] = true;
      items.push(item);
    }
    function isNoiseTitle(title) {
      if (!title || title.length < 2) return true;
      return /^(new agent|automations|customize|no agents yet|search agents|agents|workspaces?)$/i.test(title)
        || /^review:\s*/i.test(title);
    }
    var items = [];
    var seen = {};
    var explicitActiveId = '';
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
        var id = occurrenceId(glassBtns, idx, title, agentTitleFromButton, true);
        if (!id) return;
        var item = btn.closest('.ui-sidebar-menu-item') || btn;
        var explicitlySelected = item.getAttribute('aria-selected') === 'true'
          || item.getAttribute('data-selected') === 'true'
          || btn.getAttribute('aria-selected') === 'true'
          || btn.getAttribute('data-selected') === 'true';
        var active = explicitlySelected;
        if (activeTitle && norm(title).toLowerCase() === norm(activeTitle).toLowerCase()) active = true;
        if (item.getAttribute('aria-selected') === 'true' || /selected|active|current/i.test(String(item.className || '') + ' ' + String(btn.className || ''))) {
          active = true;
        }
        if (explicitlySelected) explicitActiveId = id;
        pushItem(items, seen, {
          id: id,
          cache_key: resourceKeyForTitle(title),
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
        var title = titleOfCell(cell);
        if (isNoiseTitle(title)) return;
        var id = occurrenceId(cells, idx, title, titleOfCell, true);
        if (!id) return;
        var explicitlySelected = cell.getAttribute('data-selected') === 'true'
          || cell.getAttribute('aria-selected') === 'true';
        var active = explicitlySelected || /selected|active|current/i.test(String(cell.className || ''));
        if (!active && activeTitle && norm(title).toLowerCase() === norm(activeTitle).toLowerCase()) active = true;
        if (explicitlySelected) explicitActiveId = id;
        pushItem(items, seen, {
          id: id,
          cache_key: resourceKeyForTitle(title),
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
        var title = titleOfRow(row);
        if (isNoiseTitle(title)) return;
        var id = occurrenceId(rows, idx, title, titleOfRow, true);
        if (!id) return;
        var active = row.getAttribute('aria-selected') === 'true' || row.classList.contains('sidebar-list-item-selected');
        if (!active && activeTitle && norm(title).toLowerCase() === norm(activeTitle).toLowerCase()) active = true;
        pushItem(items, seen, {
          id: id,
          cache_key: resourceKeyForTitle(title),
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
      var title = titleOfTab(tab);
      if (isNoiseTitle(title)) return;
      // Skip obvious file tabs.
      if (/\\.[a-z0-9]{1,8}$/i.test(title)) return;
      if (title.indexOf('/') !== -1 || title.indexOf('\\\\') !== -1) return;
      var id = occurrenceId(editorTabs, idx, title, titleOfTab, false);
      if (!id) return;
      var active = tab.classList.contains('active') || tab.classList.contains('selected') || tab.getAttribute('aria-selected') === 'true';
      if (!active && activeTitle && norm(title).toLowerCase() === norm(activeTitle).toLowerCase()) active = true;
      pushItem(items, seen, {
        id: id,
        cache_key: resourceKeyForTitle(title),
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
          cache_key: resourceKeyForTitle(activeTitle),
          title: activeTitle,
          active: true,
          index: 0,
          source: 'title-tab',
        });
      }
    }

    // Cursor can show multiple editor groups whose tabs are all locally
    // active/selected.  The Agents sidebar's data-selected row is the single
    // workspace-level identity and must win over those per-group tab states.
    if (explicitActiveId) {
      items.forEach(function(it) { it.active = it.id === explicitActiveId; });
    } else if (activeTitle) {
      var normalizedActiveTitle = norm(activeTitle).toLowerCase();
      var activeBaseId = slugId(activeTitle);
      var activeItem = items.find(function(it) {
        return it.id === activeBaseId && norm(it.title).toLowerCase() === normalizedActiveTitle;
      }) || items.find(function(it) {
        return norm(it.title).toLowerCase() === normalizedActiveTitle;
      });
      if (activeItem) items.forEach(function(it) { it.active = it === activeItem; });
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
      if (r.width <= 0 || r.height <= 0 || r.bottom <= 0 || r.right <= 0
        || r.top >= window.innerHeight || r.left >= window.innerWidth) return false;
      var st = window.getComputedStyle ? window.getComputedStyle(el) : null;
      return !(st && (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0'));
    }
    function tabTitle(group) {
      var tab = group && group.querySelector('.tabs-container .tab.active.selected, .tabs-container .tab[aria-selected="true"], .tabs-container .tab.selected, .tabs-container .tab.active');
      return tab ? norm((tab.querySelector('.label-name') || tab).textContent || tab.getAttribute('aria-label') || '') : '';
    }
    function selectedGroup() {
      var groups = Array.from(d.querySelectorAll('.editor-group-container.has-composer-editor'));
      var blank = groups.filter(function(group) { return tabTitle(group) === 'New Agent'; });
      var selected = d.querySelector('.agent-sidebar-cell[data-selected="true"]');
      var title = selected ? norm((selected.querySelector('.agent-sidebar-cell-text') || {}).textContent) : '';
      var matches = title ? groups.filter(function(group) { return tabTitle(group) === title; }) : [];
      if (matches.length === 1) return matches[0];
      if (!title && blank.length === 1) return blank[0];
      return groups.length === 1 ? groups[0] : null;
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
    var group = selectedGroup();
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
      var bar = group ? group.querySelector('.composer-bar, [class*="composer-bar"]') : null;
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

    var conv = group ? group.querySelector('.conversations') : null;
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
    if (/pending command|pending (?:your )?approval|reply with (?:your )?approval|reply with approve\b|run command[?]|not in allowlist|awaiting (?:your )?approval|needs your approval|approve (?:this )?command|please approve(?:\s+(?:this|it))?(?:\s+and\s+(?:i['?]?ll\s+)?execute(?:\s+it)?)?/i.test(tail)) {
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
  function cursorNorm(t) { return String(t || '').replace(/\\s+/g, ' ').trim(); }
  function composerTabTitle(group) {
    if (!group) return '';
    var tab = group.querySelector('.tabs-container .tab.active.selected, .tabs-container .tab[aria-selected="true"], .tabs-container .tab.selected, .tabs-container .tab.active');
    return tab ? cursorNorm((tab.querySelector('.label-name') || tab).textContent || tab.getAttribute('aria-label') || '') : '';
  }
  function selectedComposerGroup() {
    var groups = Array.from(d.querySelectorAll('.editor-group-container.has-composer-editor'));
    var blankGroups = groups.filter(function(group) { return composerTabTitle(group) === 'New Agent'; });
    if (typeof cursorPreferBlankComposer !== 'undefined' && cursorPreferBlankComposer && blankGroups.length === 1) return blankGroups[0];
    var selected = d.querySelector('.agent-sidebar-cell[data-selected="true"]');
    var title = selected ? cursorNorm((selected.querySelector('.agent-sidebar-cell-text') || {}).textContent) : '';
    if (title) {
      var matches = groups.filter(function(group) { return composerTabTitle(group) === title; });
      if (matches.length === 1) return matches[0];
    }
    if (!title && blankGroups.length === 1) return blankGroups[0];
    return groups.length === 1 ? groups[0] : null;
  }
  function composerHost() {
    var group = selectedComposerGroup();
    return group ? group.querySelector(
      '.agent-prompt-input-root, .ui-prompt-input, .agent-conversation-composer, .has-composer-editor .composer-bar, .editor-group-container.has-composer-editor .composer-bar, .composer-bar.editor, .composer-bar'
    ) : null;
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

async function focusComposerInput(Runtime, preferBlankComposer = false) {
  return evalInPage(Runtime, `
    var cursorPreferBlankComposer = ${JSON.stringify(!!preferBlankComposer)};
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

async function sendCursorMessage(Runtime, cdpClient, text, options = {}) {
  const Input = cdpClient && cdpClient.Input;
  const preferBlankComposer = options.preferBlankComposer === true;
  const scopePrefix = `var cursorPreferBlankComposer = ${JSON.stringify(preferBlankComposer)};`;
  const focus = await focusComposerInput(Runtime, preferBlankComposer);
  if (focus !== 'ok') return { ok: false, code: 'input_not_found', detail: focus };

  let set = 'empty';
  if (Input && typeof Input.insertText === 'function' && typeof Input.dispatchKeyEvent === 'function') {
    try {
      await clearComposerViaInput(Input);
      await evalInPage(Runtime, `
        ${scopePrefix}
        ${CURSOR_FIND_COMPOSER_INPUT}
        clearComposerDom(findComposerInput());
        return 'ok';
      `);
      await Input.insertText({ text: String(text || '') });
      await new Promise(r => setTimeout(r, 150));
      set = await evalInPage(Runtime, `
        ${scopePrefix}
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
      ${scopePrefix}
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
    await focusComposerInput(Runtime, preferBlankComposer);
    // Refuse a busy composer, then use trusted Enter. DOM .click() on Cursor's
    // React submit can clear the editor without creating a native user turn.
    const submitState = await evalInPage(Runtime, `
      ${scopePrefix}
      ${CURSOR_FIND_COMPOSER_INPUT}
      function isVisible(el) {
        if (!el || !el.getBoundingClientRect) return false;
        var r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      }
      var input = findComposerInput();
      var footer = findComposerFooter(input);
      var btn = footer ? footer.querySelector('.ui-prompt-input-submit-button') : null;
      if (!btn || !isVisible(btn)) return 'enter-ready';
      var aria = String(btn.getAttribute('aria-label') || '').toLowerCase();
      if (aria.includes('stop')) return 'stop-visible';
      return 'enter-ready';
    `);
    if (submitState === 'stop-visible') return { ok: false, code: 'agent_busy', detail: 'Cursor stop control is visible' };
    await dispatchTrustedEnter(Input);
    const wanted = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    for (let attempt = 0; attempt < 20; attempt++) {
      await new Promise(r => setTimeout(r, 250));
      const observed = await evalInPage(Runtime, `
        ${scopePrefix}
        ${CURSOR_FIND_COMPOSER_INPUT}
        function norm(t) { return String(t || '').replace(/\\s+/g, ' ').trim(); }
        var wanted = ${JSON.stringify(wanted)};
        var selectedGroup = selectedComposerGroup();
        var root = selectedGroup ? selectedGroup.querySelector('.conversations') : null;
        if (root) {
          var humans = Array.from(root.querySelectorAll('.composer-rendered-message[data-message-role="human"]'));
          for (var i = humans.length - 1; i >= 0; i--) {
            var ht = norm(humans[i].innerText || humans[i].textContent || '');
            if (ht && (ht === wanted || ht.indexOf(wanted) >= 0 || wanted.indexOf(ht) >= 0)) return 'seen-transcript';
          }
        }
        return 'pending';
      `);
      if (observed === 'seen-transcript') return { ok: true, method: 'cdp_enter' };
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
  const Input = cdpClient && cdpClient.Input;
  async function waitForSettledTranscript() {
    let previous = '';
    let stableSamples = 0;
    for (let attempt = 0; attempt < 30; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 500));
      const state = await detectCursorThinking(Runtime);
      const current = await readCursorMessages(Runtime);
      if (!state?.thinking && current === previous) stableSamples += 1;
      else stableSamples = 0;
      if (stableSamples >= 20) return true;
      previous = current;
    }
    return false;
  }
  try {
    const raw = await evalInPage(Runtime, `
      function isVisible(el) {
        if (!el || !el.getBoundingClientRect) return false;
        var rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0
          && rect.bottom > 0 && rect.right > 0
          && rect.top < window.innerHeight && rect.left < window.innerWidth;
      }
      function norm(t) { return String(t || '').replace(/\\s+/g, ' ').trim(); }
      function tabTitle(group) {
        var tab = group && group.querySelector('.tabs-container .tab.active.selected, .tabs-container .tab[aria-selected="true"], .tabs-container .tab.selected, .tabs-container .tab.active');
        return tab ? norm((tab.querySelector('.label-name') || tab).textContent || tab.getAttribute('aria-label') || '') : '';
      }
      function selectedGroup() {
        var groups = Array.from(d.querySelectorAll('.editor-group-container.has-composer-editor'));
        var blank = groups.filter(function(group) { return tabTitle(group) === 'New Agent'; });
        var selected = d.querySelector('.agent-sidebar-cell[data-selected="true"]');
        var title = selected ? norm((selected.querySelector('.agent-sidebar-cell-text') || {}).textContent) : '';
        var matches = title ? groups.filter(function(group) { return tabTitle(group) === title; }) : [];
        if (matches.length === 1) return matches[0];
        if (!title && blank.length === 1) return blank[0];
        return groups.length === 1 ? groups[0] : null;
      }
      var group = selectedGroup();
      if (!group) return JSON.stringify({ status: 'ambiguous-group' });
      // Glass TipTap submit button doubles as Stop while generating.
      var submitStop = Array.from(group.querySelectorAll('.ui-prompt-input-submit-button')).find(function(button) {
        return isVisible(button) && String(button.getAttribute('aria-label') || '').toLowerCase().includes('stop');
      });
      if (submitStop) {
        var aria = String(submitStop.getAttribute('aria-label') || '').toLowerCase();
        if (aria.includes('stop')) {
          var rect = submitStop.getBoundingClientRect();
          return JSON.stringify({ status: 'point', source: 'submit-stop', x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
        }
      }
      // Cursor 3.5 renders the active composer Stop as a div.stop-button
      // containing a codicon-debug-stop span, with no button role or aria label.
      var nativeStops = Array.from(group.querySelectorAll('.stop-button, [class*="stop-button"], .codicon-debug-stop')).map(function(candidate) {
        return candidate.closest('.stop-button, [class*="stop-button"]') || candidate;
      }).filter(function(candidate, index, all) {
        return all.indexOf(candidate) === index && isVisible(candidate) && !candidate.closest('.ui-shell-tool-call');
      }).sort(function(a, b) {
        return b.getBoundingClientRect().top - a.getBoundingClientRect().top;
      });
      if (nativeStops.length) {
        var nativeRect = nativeStops[0].getBoundingClientRect();
        return JSON.stringify({ status: 'point', source: 'native-stop', x: nativeRect.left + nativeRect.width / 2, y: nativeRect.top + nativeRect.height / 2 });
      }
      var btns = Array.from(group.querySelectorAll('button, [role="button"]')).filter(function(b) {
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
        btns = Array.from(group.querySelectorAll('button[aria-label*="Stop"], button[aria-label*="stop"]')).filter(function(b) {
          if (!isVisible(b)) return false;
          var aria = String(b.getAttribute('aria-label') || '').toLowerCase();
          return aria.includes('stop') && aria !== 'stop command' && !b.closest('.ui-shell-tool-call');
        });
      }
      if (btns.length) {
        var btnRect = btns[0].getBoundingClientRect();
        return JSON.stringify({ status: 'point', source: 'stop-button', x: btnRect.left + btnRect.width / 2, y: btnRect.top + btnRect.height / 2 });
      }
      return JSON.stringify({ status: 'no-btn' });
    `);
    const activation = raw ? JSON.parse(raw) : { status: 'no-btn' };
    if (activation.status === 'point' && Input && typeof Input.dispatchMouseEvent === 'function') {
      await Input.dispatchMouseEvent({ type: 'mousePressed', x: activation.x, y: activation.y, button: 'left', clickCount: 1 });
      await Input.dispatchMouseEvent({ type: 'mouseReleased', x: activation.x, y: activation.y, button: 'left', clickCount: 1 });
      if (await waitForSettledTranscript()) return { ok: true, method: `trusted_${activation.source}` };
    }
  } catch (e) {
    console.warn(`[${sessionId}] [interrupt] Cursor stop error: ${e.message}`);
  }
  if (Input && typeof Input.dispatchKeyEvent === 'function') {
    try {
      await Input.dispatchKeyEvent({ type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
      await Input.dispatchKeyEvent({ type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
      if (await waitForSettledTranscript()) return { ok: true, method: 'cdp_escape' };
    } catch (_) {}
  }
  return { ok: false, code: 'interrupt_not_confirmed', detail: 'Cursor remained active after trusted Stop/Escape' };
}

async function readCursorConfig(Runtime) {
  try {
    const raw = await evalInPage(Runtime, CURSOR_CONFIG_EXPR);
    const parsed = raw ? JSON.parse(raw) : {};
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
    (Array.isArray(parsed.available_models) ? parsed.available_models : []).forEach(add);
    if (domModel && !available_models.some(m => m.id === domModel)) add({ id: domModel, label: domModel });
    if (!available_models.length) settingsModels.forEach(add);
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
  const requested = String(modelId || '').trim();
  if (!requested) return { ok: false, detail: 'empty-model' };
  const agents = await readCursorAgentList(Runtime);
  const activeAgents = agents.filter(agent => agent && agent.active);
  if (activeAgents.length === 1) {
    const focused = await switchCursorAgent(Runtime, activeAgents[0].id);
    if (!focused.ok) return { ok: false, detail: `agent-focus-${focused.detail || 'failed'}` };
  }
  const openedRaw = await evalInPage(Runtime, `
    return (function() {
      function norm(t) { return String(t || '').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\\s+/g, ' ').trim(); }
      function stripMarkup(value) {
        return norm(String(value || '').replace(/<[^>]*>/g, ''));
      }
      var selected = d.querySelector('.agent-sidebar-cell[data-selected="true"]');
      var title = selected ? norm((selected.querySelector('.agent-sidebar-cell-text') || {}).textContent) : '';
      var groups = Array.from(d.querySelectorAll('.editor-group-container.has-composer-editor'));
      var matches = title ? groups.filter(function(group) {
        return Array.from(group.querySelectorAll('.tab[aria-selected="true"]')).some(function(tab) {
          return norm(tab.textContent) === title;
        });
      }) : groups;
      if (matches.length !== 1) return JSON.stringify({ status: 'no-selected-group', matches: matches.length });
      var trigger = matches[0].querySelector('button.ui-model-picker__trigger, .ui-model-picker__trigger');
      if (!trigger) return JSON.stringify({ status: 'no-trigger' });
      var key = Object.keys(trigger).find(function(k) { return k.indexOf('__reactFiber$') === 0; });
      var fiber = key ? trigger[key] : null;
      var props = null;
      var depth = 0;
      while (fiber && depth++ < 40) {
        if (fiber.memoizedProps && Array.isArray(fiber.memoizedProps.models)) {
          props = fiber.memoizedProps;
          break;
        }
        fiber = fiber.return;
      }
      var wanted = ${JSON.stringify(requested)};
      var wantedNorm = norm(wanted).toLowerCase();
      var found = null;
      if (props) {
        props.models.some(function(nativeModel) {
          return (nativeModel.variants || []).some(function(variant) {
            var id = norm(variant.variantStringRepresentation || variant.legacySlug || nativeModel.name);
            var legacy = norm(variant.legacySlug || '');
            var label = stripMarkup(variant.displayNameOutsidePicker || variant.displayName || nativeModel.clientDisplayName || nativeModel.name);
            if (id.toLowerCase() === wantedNorm || legacy.toLowerCase() === wantedNorm || label.toLowerCase() === wantedNorm) {
              found = {
                id: id,
                label: label,
                nativeName: nativeModel.name,
                isDefaultNonMax: !!variant.isDefaultNonMaxConfig,
              };
              return true;
            }
            return false;
          });
        });
      }
      if (!found) return JSON.stringify({ status: 'unknown-model' });
      var before = norm(trigger.textContent || trigger.innerText || '');
      if (before === found.label) return JSON.stringify({
        status: 'already-selected',
        id: found.id,
        label: found.label,
        nativeName: found.nativeName,
      });
      trigger.click();
      return JSON.stringify({
        status: 'opened',
        id: found.id,
        label: found.label,
        nativeName: found.nativeName,
        isDefaultNonMax: found.isDefaultNonMax,
      });
    })();
  `);
  const opened = openedRaw ? JSON.parse(openedRaw) : { status: 'no-result' };
  if (opened.status === 'already-selected') {
    return { ok: true, detail: opened.status, model_id: opened.id, label: opened.label };
  }
  if (opened.status !== 'opened') return { ok: false, detail: opened.status };
  await new Promise(res => setTimeout(res, 300));
  let pick = await evalInPage(Runtime, `
    function norm(t) { return String(t || '').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\\s+/g, ' ').trim(); }
    var wanted = ${JSON.stringify(opened.label)};
    var items = Array.from(d.querySelectorAll('.ui-menu__row')).filter(function(el) {
      var r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    var matches = items.filter(function(el) {
      var name = el.querySelector('.ui-model-picker__item-content-name');
      return name && norm(name.textContent || '') === wanted;
    });
    if (matches.length === 1) {
      (matches[0].querySelector('.ui-menu__item-content') || matches[0]).click();
      return 'picked';
    }
    var nativeName = ${JSON.stringify(opened.nativeName)};
    var nativeRow = items.find(function(el) {
      return el.getAttribute('data-testid') === 'model-item-' + nativeName;
    });
    if (nativeRow && ${JSON.stringify(opened.isDefaultNonMax)}) {
      var reset = nativeRow.querySelector('[data-testid="reset-parameters-btn"]');
      if (reset) {
        reset.click();
        return 'reset-parameters';
      }
    }
    var selected = d.querySelector('.agent-sidebar-cell[data-selected="true"]');
    var title = selected ? norm((selected.querySelector('.agent-sidebar-cell-text') || {}).textContent) : '';
    var groups = Array.from(d.querySelectorAll('.editor-group-container.has-composer-editor'));
    var group = groups.find(function(g) {
      return Array.from(g.querySelectorAll('.tab[aria-selected="true"]')).some(function(tab) {
        return norm(tab.textContent) === title;
      });
    });
    var trigger = group ? group.querySelector('.ui-model-picker__trigger') : null;
    if (trigger && trigger.getAttribute('aria-expanded') === 'true') trigger.click();
    if (matches.length > 1) return 'ambiguous';
    return 'not-found';
  `);
  if (pick === 'reset-parameters') {
    await new Promise(res => setTimeout(res, 250));
    pick = await evalInPage(Runtime, `
      function norm(t) { return String(t || '').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\\s+/g, ' ').trim(); }
      var wanted = ${JSON.stringify(opened.label)};
      var matches = Array.from(d.querySelectorAll('.ui-menu__row')).filter(function(el) {
        var r = el.getBoundingClientRect();
        var name = el.querySelector('.ui-model-picker__item-content-name');
        return r.width > 0 && r.height > 0 && name && norm(name.textContent || '') === wanted;
      });
      if (matches.length !== 1) return matches.length > 1 ? 'ambiguous-after-reset' : 'not-found-after-reset';
      (matches[0].querySelector('.ui-menu__item-content') || matches[0]).click();
      return 'picked';
    `);
  }
  if (pick !== 'picked') return { ok: false, detail: pick };
  let verified = false;
  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise(res => setTimeout(res, 100));
    const current = await evalInPage(Runtime, `
      function norm(t) { return String(t || '').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\\s+/g, ' ').trim(); }
      var selected = d.querySelector('.agent-sidebar-cell[data-selected="true"]');
      var title = selected ? norm((selected.querySelector('.agent-sidebar-cell-text') || {}).textContent) : '';
      var groups = Array.from(d.querySelectorAll('.editor-group-container.has-composer-editor'));
      var matches = groups.filter(function(group) {
        return Array.from(group.querySelectorAll('.tab[aria-selected="true"]')).some(function(tab) {
          return norm(tab.textContent) === title;
        });
      });
      var trigger = matches.length === 1 ? matches[0].querySelector('.ui-model-picker__trigger') : null;
      return trigger ? norm(trigger.textContent || trigger.innerText || '') : 'unknown';
    `);
    if (current === opened.label) {
      verified = true;
      break;
    }
  }
  return {
    ok: verified,
    detail: verified ? 'picked-and-verified' : 'selection-not-observed',
    model_id: opened.id,
    label: opened.label,
  };
}

async function readCursorAgentList(Runtime) {
  try {
    const raw = await evalInPage(Runtime, CURSOR_AGENT_LIST_EXPR);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function cursorAgentEditorFocused(Runtime, expectedTitle) {
  try {
    return !!(await evalInPage(Runtime, `
      function norm(t) { return String(t || '').replace(/\\s+/g, ' ').trim().toLowerCase(); }
      var expected = norm(${JSON.stringify(expectedTitle || '')});
      if (!expected) return false;
      var groups = Array.from(d.querySelectorAll('.editor-group-container.has-composer-editor'));
      return groups.some(function(group) {
        var tab = group.querySelector('.tabs-container .tab[aria-selected="true"], .tabs-container .tab.active.selected, .tabs-container .tab.selected, .tabs-container .tab.active');
        if (!tab) return false;
        var label = tab.querySelector('.label-name') || tab;
        var title = norm(label.textContent || tab.getAttribute('aria-label') || '');
        return title === expected && !/^review:\\s*/i.test(title);
      });
    `));
  } catch {
    return false;
  }
}

async function switchCursorAgent(Runtime, agentId) {
  const currentAgents = await readCursorAgentList(Runtime);
  const currentActive = currentAgents.filter(agent => agent && agent.active);
  if (currentActive.length === 1
      && currentActive[0].id === agentId
      && await cursorAgentEditorFocused(Runtime, currentActive[0].title)) {
    return { ok: true, detail: 'already_active' };
  }
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
      function occurrenceId(nodes, index, title, readTitle, newestFirst) {
        var base = slugId(title);
        if (!base) return '';
        var same = [];
        nodes.forEach(function(node, nodeIndex) {
          if (norm(readTitle(node)).toLowerCase() === norm(title).toLowerCase()) same.push(nodeIndex);
        });
        var position = same.indexOf(index);
        if (position < 0 || same.length < 2) return base;
        var ordinal = newestFirst ? same.length - position : position + 1;
        return ordinal > 1 ? base + '--' + ordinal : base;
      }
      function titleOfButton(btn) {
        var label = btn.querySelector(
          '.ui-sidebar-menu-button-label, .ui-sidebar-label-row-title, .ui-sidebar-menu-button-content, .ui-sidebar-label-row-text'
        );
        return stripAge(label ? firstLine(label) : firstLine(btn));
      }
      function titleOfCell(cell) {
        var textEl = cell.querySelector('.agent-sidebar-cell-text, .agent-sidebar-cell-content');
        return stripAge(textEl ? firstLine(textEl) : firstLine(cell));
      }
      function titleOfRow(row) { return stripAge(firstLine(row)); }
      function titleOfTab(tab) {
        var label = stripAge(firstLine(tab.querySelector('.label-name') || tab));
        var aria = stripAge(tab.getAttribute('aria-label') || '');
        return label || aria;
      }
      var targetId = ${JSON.stringify(agentId)};

      // Glass sidebar first (Cursor 3.5+ Agents window).
      var glassBtns = Array.from(d.querySelectorAll('.glass-sidebar-agent-menu-btn'));
      for (var g = 0; g < glassBtns.length; g++) {
        var gTitle = titleOfButton(glassBtns[g]);
        if (occurrenceId(glassBtns, g, gTitle, titleOfButton, true) === targetId) {
          glassBtns[g].click();
          return 'clicked-glass';
        }
      }

      // Unified / classic agent sidebar cells.
      var cells = Array.from(d.querySelectorAll('.agent-sidebar-cell'));
      for (var c = 0; c < cells.length; c++) {
        var cTitle = titleOfCell(cells[c]);
        if (occurrenceId(cells, c, cTitle, titleOfCell, true) === targetId) {
          cells[c].click();
          return 'clicked-cell';
        }
      }

      var agentsRoot = d.querySelector('.agent-sidebar, .unified-agents-sidebar, [class*="agent-sidebar"], [class*="agents-panel"]');
      if (agentsRoot) {
        var rows = Array.from(agentsRoot.querySelectorAll('.monaco-list-row'));
        for (var i = 0; i < rows.length; i++) {
          var title = titleOfRow(rows[i]);
          if (!title) continue;
          if (occurrenceId(rows, i, title, titleOfRow, true) === targetId) {
            rows[i].click();
            return 'clicked-sidebar';
          }
        }
      }

      // Editor tabs hosting agent transcripts.
      var tabs = Array.from(d.querySelectorAll('.tabs-container .tab'));
      for (var t = 0; t < tabs.length; t++) {
        var tabTitle = titleOfTab(tabs[t]);
        if (occurrenceId(tabs, t, tabTitle, titleOfTab, false) === targetId) {
          tabs[t].click();
          return 'clicked-tab';
        }
      }
      return 'not-found';
    })();
  `);
  const ok = raw === 'clicked-sidebar' || raw === 'clicked-glass' || raw === 'clicked-cell' || raw === 'clicked-tab';
  if (!ok) return { ok: false, detail: raw || 'not-found' };
  for (let attempt = 0; attempt < 20; attempt++) {
    const agents = await readCursorAgentList(Runtime);
    const active = agents.filter(agent => agent && agent.active);
    if (active.length === 1
        && active[0].id === agentId
        && await cursorAgentEditorFocused(Runtime, active[0].title)) {
      return { ok: true, detail: 'clicked_and_active' };
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  return { ok: false, detail: `clicked but active agent did not settle on ${agentId}` };
}

async function newCursorAgent(Runtime, Input) {
  const raw = await evalInPage(Runtime, `
    function norm(t) { return String(t || '').replace(/\\s+/g, ' ').trim(); }
    function isVisible(el) {
      if (!el || !el.getBoundingClientRect) return false;
      var r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }
    var sidebar = d.querySelector('.unified-agents-sidebar, .agent-sidebar');
    if (!sidebar) return 'no-agents-sidebar';
    var groups = Array.from(d.querySelectorAll('.editor-group-container.has-composer-editor'));
    var activeBlank = groups.filter(function(group) {
      var tab = group.querySelector('.tabs-container .tab.active.selected, .tabs-container .tab[aria-selected="true"], .tabs-container .tab.selected, .tabs-container .tab.active');
      var title = tab ? norm((tab.querySelector('.label-name') || tab).textContent || tab.getAttribute('aria-label') || '') : '';
      if (title !== 'New Agent') return false;
      var input = Array.from(group.querySelectorAll(
        '.ui-prompt-input-editor__input[contenteditable="true"], .tiptap.ProseMirror[contenteditable="true"], .aislash-editor-input[contenteditable="true"]'
      )).find(isVisible);
      return !!input && group.querySelectorAll('.composer-rendered-message').length === 0;
    });
    if (activeBlank.length === 1) {
      return JSON.stringify({ status: 'already-ready', source: 'active-empty-group' });
    }
    // Cursor keeps at most one pristine empty Agent editor. Reusing that
    // native tab is equivalent to New Agent and avoids creating duplicates.
    var emptyTabs = Array.from(d.querySelectorAll('.tabs-container .tab')).filter(function(tab) {
      if (!isVisible(tab)) return false;
      var title = norm((tab.querySelector('.label-name') || tab).textContent || tab.getAttribute('aria-label') || '');
      return title === 'New Agent' && !!tab.querySelector('.composer-empty-chat');
    });
    if (emptyTabs.length === 1) {
      emptyTabs[0].scrollIntoView({ block: 'nearest', inline: 'nearest' });
      var emptyRect = emptyTabs[0].getBoundingClientRect();
      return JSON.stringify({ status: 'point', source: 'empty-tab', x: emptyRect.left + emptyRect.width / 2, y: emptyRect.top + emptyRect.height / 2 });
    }
    var candidates = Array.from(sidebar.querySelectorAll('a, button, [role="button"], [data-click-ready="true"], .ui-sidebar-menu-button, .ui-icon-button, .cursor-pointer'));
    var btn = candidates.find(function(el) {
      var aria = norm(el.getAttribute('aria-label') || '');
      var text = norm(el.textContent || '');
      var exact = aria === 'New Agent' || text === 'New Agent';
      return exact && (isVisible(el) || (el.classList.contains('agent-sidebar-new-agent-button') && el.getAttribute('data-click-ready') === 'true'));
    });
    if (btn) {
      if (isVisible(btn)) {
        btn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        var btnRect = btn.getBoundingClientRect();
        return JSON.stringify({ status: 'point', source: 'new-agent-button', x: btnRect.left + btnRect.width / 2, y: btnRect.top + btnRect.height / 2 });
      }
      btn.click();
      return JSON.stringify({ status: 'clicked-dom', source: 'hidden-new-agent-button' });
    }
    return JSON.stringify({ status: 'not-found' });
  `);
  let activation = null;
  try { activation = raw ? JSON.parse(raw) : null; } catch { activation = null; }
  if (activation?.status === 'already-ready') {
    return { ok: true, detail: 'new-agent-empty-and-ready' };
  }
  if (activation?.status === 'point') {
    if (!Input || typeof Input.dispatchMouseEvent !== 'function') {
      return { ok: false, detail: 'trusted-input-unavailable' };
    }
    await Input.dispatchMouseEvent({ type: 'mouseMoved', x: activation.x, y: activation.y });
    await Input.dispatchMouseEvent({ type: 'mousePressed', x: activation.x, y: activation.y, button: 'left', clickCount: 1 });
    await Input.dispatchMouseEvent({ type: 'mouseReleased', x: activation.x, y: activation.y, button: 'left', clickCount: 1 });
  } else if (activation?.status !== 'clicked-dom') {
    return { ok: false, detail: activation?.status || 'not-found' };
  }

  let lastState = null;
  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 100));
    const stateRaw = await evalInPage(Runtime, `
      return (function() {
        function norm(t) { return String(t || '').replace(/\\s+/g, ' ').trim(); }
        function isVisible(el) {
          if (!el || !el.getBoundingClientRect) return false;
          var r = el.getBoundingClientRect();
          return r.width > 40 && r.height > 8;
        }
        var groups = Array.from(d.querySelectorAll('.editor-group-container.has-composer-editor'));
        var blank = groups.filter(function(group) {
          var tab = group.querySelector('.tabs-container .tab.active.selected, .tabs-container .tab[aria-selected="true"], .tabs-container .tab.selected, .tabs-container .tab.active');
          var title = tab ? norm((tab.querySelector('.label-name') || tab).textContent || tab.getAttribute('aria-label') || '') : '';
          return title === 'New Agent';
        });
        if (blank.length !== 1) return JSON.stringify({ status: 'waiting-for-new-agent', matches: blank.length });
        var group = blank[0];
        var input = Array.from(group.querySelectorAll(
          '.ui-prompt-input-editor__input[contenteditable="true"], .tiptap.ProseMirror[contenteditable="true"], .aislash-editor-input[contenteditable="true"]'
        )).find(isVisible);
        var messages = group.querySelectorAll('.composer-rendered-message').length;
        return JSON.stringify({
          status: input && messages === 0 ? 'ready' : 'waiting-for-empty-composer',
          input: !!input,
          messages: messages,
        });
      })();
    `);
    try { lastState = stateRaw ? JSON.parse(stateRaw) : null; } catch { lastState = null; }
    if (lastState?.status === 'ready') {
      return { ok: true, detail: 'new-agent-empty-and-ready' };
    }
  }
  return { ok: false, detail: lastState?.status || 'new-agent-did-not-settle' };
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
  const terminal = await ensureCursorTerminalVisible(Runtime, cdpClient);
  if (!terminal?.ok) return { ok: false, detail: terminal?.method || 'no-terminal' };
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
        return r.width > 0 && r.height > 0
          && r.bottom > 0 && r.right > 0
          && r.top < window.innerHeight && r.left < window.innerWidth;
      }
      function norm(t) { return String(t || '').replace(/\\s+/g, ' ').trim(); }
      function tabTitle(group) {
        var tab = group && group.querySelector('.tabs-container .tab.active.selected, .tabs-container .tab[aria-selected="true"], .tabs-container .tab.selected, .tabs-container .tab.active');
        return tab ? norm((tab.querySelector('.label-name') || tab).textContent || tab.getAttribute('aria-label') || '') : '';
      }
      function selectedGroup() {
        var groups = Array.from(d.querySelectorAll('.editor-group-container.has-composer-editor'));
        var blank = groups.filter(function(group) { return tabTitle(group) === 'New Agent'; });
        var selected = d.querySelector('.agent-sidebar-cell[data-selected="true"]');
        var title = selected ? norm((selected.querySelector('.agent-sidebar-cell-text') || {}).textContent) : '';
        var matches = title ? groups.filter(function(group) { return tabTitle(group) === title; }) : [];
        if (matches.length === 1) return matches[0];
        if (!title && blank.length === 1) return blank[0];
        return groups.length === 1 ? groups[0] : null;
      }
      var thinking = false;
      var label = '';
      var group = selectedGroup();
      if (!group) return JSON.stringify({ thinking: false, label: '', ambiguous: true });
      var conv = group.querySelector('.conversations');
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
      var submitStop = Array.from(group.querySelectorAll('.ui-prompt-input-submit-button')).find(function(button) {
        return isVisible(button) && String(button.getAttribute('aria-label') || '').toLowerCase().includes('stop');
      });
      if (!thinking && submitStop) {
        thinking = true;
        label = 'Generating';
      }
      var nativeStop = Array.from(group.querySelectorAll('.stop-button, [class*="stop-button"], .codicon-debug-stop')).map(function(candidate) {
        return candidate.closest('.stop-button, [class*="stop-button"]') || candidate;
      }).find(function(candidate) {
        return isVisible(candidate) && !candidate.closest('.ui-shell-tool-call');
      });
      if (!thinking && nativeStop) {
        thinking = true;
        label = 'Generating';
      }
      var composer = group.querySelector('.agent-prompt-input-root, .ui-prompt-input, .composer-bar, [class*="composer-bar"]');
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
