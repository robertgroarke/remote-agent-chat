#!/usr/bin/env node
// Quick E2E selector validation against live CDP targets.
// Usage: node tools/test-selectors-live.js

'use strict';
const CDP = require('chrome-remote-interface');

const CODEX_PORT = 9225;
const AG_PORT    = 9223;

async function evalPage(Runtime, code) {
  const r = await Runtime.evaluate({
    expression: `(function(){ const d = document; ${code} })()`,
    returnByValue: true, awaitPromise: false,
  });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'eval error');
  return r.result?.value;
}

async function evalFrame(Runtime, code) {
  const r = await Runtime.evaluate({
    expression: `(function(){
      const f = document.getElementById('active-frame');
      if (!f || !f.contentDocument) return null;
      const d = f.contentDocument;
      ${code}
    })()`,
    returnByValue: true, awaitPromise: false,
  });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'eval error');
  return r.result?.value;
}

function pass(label) { console.log(`  ✅ ${label}`); }
function fail(label, detail) { console.log(`  ❌ ${label}: ${detail}`); }
function info(label, detail) { console.log(`  ℹ️  ${label}: ${detail}`); }

// ─── Codex Desktop tests ─────────────────────────────────────────────────────

async function testCodexDesktop() {
  console.log('\n═══ Codex Desktop (port 9225) ═══');
  const targets = await CDP.List({ port: CODEX_PORT });
  const page = targets.find(t => t.type === 'page' && t.title === 'Codex');
  if (!page) { fail('Target', 'No Codex page target found'); return; }
  pass(`Target found: ${page.id.substring(0,8)}`);

  const client = await CDP({ port: CODEX_PORT, target: page.id });
  await client.Runtime.enable();
  const R = client.Runtime;

  // 1. Composer detection
  try {
    const has = await evalPage(R, `return !!d.querySelector('.ProseMirror');`);
    has ? pass('ProseMirror composer detected') : fail('ProseMirror', 'not found');
  } catch(e) { fail('ProseMirror', e.message); }

  // 2. Config buttons (model, effort, access)
  try {
    const raw = await evalPage(R, `
      var btns = Array.from(d.querySelectorAll('button'));
      var last25 = btns.slice(-25);
      var model = last25.find(b => /^gpt[-\\s.]?[\\d.]+|^o[134][-\\s.]/i.test((b.textContent||'').trim()));
      var effort = last25.find(b => /^(low|medium|high|extra\\s*high)$/i.test((b.textContent||'').trim()));
      var access = last25.find(b => {
        var t = (b.textContent||'').trim();
        return (/access|restricted/i.test(t) && !/add|ide|file$/i.test(t) && t.length < 30) || /^default\\s+permissions$/i.test(t);
      });
      return JSON.stringify({
        model: model ? model.textContent.trim() : null,
        effort: effort ? effort.textContent.trim() : null,
        access: access ? access.textContent.trim() : null,
        totalButtons: btns.length,
      });
    `);
    const cfg = JSON.parse(raw);
    cfg.model  ? pass(`Model button: "${cfg.model}"`)  : fail('Model button', 'not found');
    cfg.effort ? pass(`Effort button: "${cfg.effort}"`) : fail('Effort button', 'not found');
    cfg.access ? pass(`Access button: "${cfg.access}"`) : fail('Access button', 'not found');
    info('Total buttons', cfg.totalButtons);
  } catch(e) { fail('Config buttons', e.message); }

  // 3. Conversation content
  try {
    const raw = await evalPage(R, `
      var conv = d.querySelector('[data-thread-find-target="conversation"]');
      var turns = d.querySelectorAll('[data-content-search-turn-key]');
      var units = d.querySelectorAll('[data-content-search-unit-key]');
      return JSON.stringify({ hasConversation: !!conv, turns: turns.length, units: units.length });
    `);
    const c = JSON.parse(raw);
    c.hasConversation ? pass('Conversation container found') : info('Conversation', 'no [data-thread-find-target] — may be empty');
    info('Turns', c.turns);
    info('Units', c.units);
  } catch(e) { fail('Conversation', e.message); }

  // 4. Thinking / stop button detection
  try {
    const raw = await evalPage(R, `
      var stopBtn = d.querySelector('button[aria-label*="Stop" i], button[aria-label*="stop" i]');
      var visible = stopBtn && stopBtn.offsetParent !== null;
      return JSON.stringify({ stopBtnExists: !!stopBtn, visible: !!visible });
    `);
    const s = JSON.parse(raw);
    info('Stop button', `exists=${s.stopBtnExists} visible=${s.visible}`);
  } catch(e) { fail('Stop button', e.message); }

  // 5. Thread/sidebar detection (Epic 2)
  try {
    const raw = await evalPage(R, `
      var sidebar = d.querySelector('nav, [class*="sidebar"], [class*="drawer"], [class*="thread-list"], [class*="history"]');
      var threadEls = d.querySelectorAll('[data-thread-id], [data-conversation-id], [class*="thread-item"]');
      return JSON.stringify({ hasSidebar: !!sidebar, sidebarTag: sidebar ? sidebar.tagName : null, threadEls: threadEls.length });
    `);
    const t = JSON.parse(raw);
    t.hasSidebar ? pass(`Sidebar/nav found: <${t.sidebarTag}>`) : info('Sidebar', 'no sidebar/nav/drawer detected');
    info('Thread data-attr elements', t.threadEls);
  } catch(e) { fail('Thread sidebar', e.message); }

  // 6. Workspace / folder info (Epic 3)
  try {
    const raw = await evalPage(R, `
      var title = d.querySelector('title') ? d.querySelector('title').textContent.trim() : '';
      var pathEls = d.querySelectorAll('[class*="breadcrumb"], [class*="path-bar"], [class*="folder-path"], [class*="workspace"]');
      var folderItems = d.querySelectorAll('[data-folder-path], [data-workspace-path], [class*="folder-item"], [class*="recent-project"]');
      return JSON.stringify({ title: title, pathEls: pathEls.length, folderItems: folderItems.length });
    `);
    const w = JSON.parse(raw);
    info('Page title', w.title);
    info('Path/breadcrumb elements', w.pathEls);
    info('Folder/workspace items', w.folderItems);
  } catch(e) { fail('Workspace info', e.message); }

  // 7. Sandbox / status indicators (Epic 7)
  try {
    const raw = await evalPage(R, `
      var sandboxEls = d.querySelectorAll('[class*="sandbox"], [class*="environment"], [data-testid*="sandbox"]');
      var statusEls = d.querySelectorAll('[class*="status"], [class*="progress"], [role="status"]');
      return JSON.stringify({ sandboxEls: sandboxEls.length, statusEls: statusEls.length });
    `);
    const sb = JSON.parse(raw);
    info('Sandbox elements', sb.sandboxEls);
    info('Status/progress elements', sb.statusEls);
  } catch(e) { fail('Sandbox', e.message); }

  // 8. Rate limit scan
  try {
    const raw = await evalPage(R, `
      var text = (d.body ? d.body.innerText : '').substring(0, 10000);
      var rl = /rate.?limit|usage.?limit|too many requests|try again after/i.test(text);
      return JSON.stringify({ rateLimited: rl });
    `);
    const rl = JSON.parse(raw);
    info('Rate limited', rl.rateLimited);
  } catch(e) { fail('Rate limit', e.message); }

  // 9. Permission dialog detection (Epic 1)
  try {
    const raw = await evalPage(R, `
      var approveBtn = Array.from(d.querySelectorAll('button')).find(function(b) {
        var t = (b.textContent || b.getAttribute('aria-label') || '').trim().toLowerCase();
        return t === 'approve' || t === 'allow' || t === 'accept' || t === 'yes';
      });
      var denyBtn = Array.from(d.querySelectorAll('button')).find(function(b) {
        var t = (b.textContent || b.getAttribute('aria-label') || '').trim().toLowerCase();
        return t === 'deny' || t === 'reject' || t === 'decline' || t === 'no';
      });
      return JSON.stringify({ hasApprove: !!approveBtn, hasDeny: !!denyBtn });
    `);
    const p = JSON.parse(raw);
    info('Permission dialog', `approve=${p.hasApprove} deny=${p.hasDeny}`);
  } catch(e) { fail('Permission dialog', e.message); }

  await client.close();
}

// ─── Antigravity tests ───────────────────────────────────────────────────────

async function testAntigravity() {
  console.log('\n═══ Antigravity (port 9223) ═══');
  const targets = await CDP.List({ port: AG_PORT });

  // Workbench page
  const workbench = targets.find(t => t.type === 'page' && t.url?.includes('workbench.html'));
  if (!workbench) { fail('Workbench', 'No workbench page found'); return; }
  pass(`Workbench page: ${workbench.id.substring(0,8)} "${workbench.title?.substring(0,50)}"`);

  const client = await CDP({ port: AG_PORT, target: workbench.id });
  await client.Runtime.enable();
  const R = client.Runtime;

  // 1. Side panel detection
  try {
    const raw = await evalPage(R, `
      var panel = d.querySelector('.antigravity-agent-side-panel');
      if (!panel) return JSON.stringify({ exists: false });
      var style = window.getComputedStyle(panel);
      var visible = style.display !== 'none' && style.visibility !== 'hidden' && panel.offsetWidth > 0;
      var turnContainer = null;
      var divs = Array.from(panel.querySelectorAll('div'));
      for (var i = 0; i < divs.length; i++) {
        var cls = divs[i].className || '';
        if (cls.includes('gap-y-3') && cls.includes('px-4') && cls.includes('flex-col')) {
          turnContainer = divs[i]; break;
        }
      }
      return JSON.stringify({
        exists: true, visible: visible,
        width: panel.offsetWidth, height: panel.offsetHeight,
        hasTurnContainer: !!turnContainer,
        turnCount: turnContainer ? turnContainer.children.length : 0,
      });
    `);
    const p = JSON.parse(raw);
    if (p.exists) {
      pass(`Side panel exists (visible=${p.visible}, ${p.width}x${p.height})`);
      p.hasTurnContainer ? pass(`Turn container found (${p.turnCount} turns)`) : info('Turn container', 'not found');
    } else {
      info('Side panel', '.antigravity-agent-side-panel not in DOM');
    }
  } catch(e) { fail('Side panel', e.message); }

  // 2. Activity bar icons (Epic 10)
  try {
    const raw = await evalPage(R, `
      var items = Array.from(d.querySelectorAll(
        '.activitybar .action-item a, .composite.bar .action-item a, [id*="activitybar"] .action-item a'
      ));
      var labels = items.map(function(a) {
        return { label: a.getAttribute('aria-label') || a.title || '', id: a.id || '' };
      }).filter(function(x) { return x.label; });
      return JSON.stringify({ count: items.length, labels: labels.slice(0, 15) });
    `);
    const ab = JSON.parse(raw);
    info('Activity bar items', ab.count);
    for (const item of ab.labels) {
      const isAgent = /agent|antigravity|chat/i.test(item.label);
      const isCodex = /codex|chatgpt|openai/i.test(item.label);
      if (isAgent) pass(`Activity bar: "${item.label}" (Agent panel icon)`);
      else if (isCodex) pass(`Activity bar: "${item.label}" (Codex panel icon)`);
      else info('Activity bar', `"${item.label}"`);
    }
  } catch(e) { fail('Activity bar', e.message); }

  // 3. Panel chat list / new chat buttons (Epic 10)
  try {
    const raw = await evalPage(R, `
      var panel = d.querySelector('.antigravity-agent-side-panel');
      if (!panel) return JSON.stringify({ noPanel: true });
      var btns = Array.from(panel.querySelectorAll('button, [role="button"]'));
      var btnTexts = btns.map(function(b) {
        return (b.textContent || b.getAttribute('aria-label') || '').trim().substring(0, 50);
      }).filter(function(t) { return t; });
      var listItems = Array.from(panel.querySelectorAll(
        '[role="listitem"], [role="option"], li, [class*="conversation"], [class*="chat-item"]'
      ));
      return JSON.stringify({ buttons: btnTexts.slice(0, 10), listItems: listItems.length });
    `);
    const pc = JSON.parse(raw);
    if (pc.noPanel) {
      info('Panel chat controls', 'panel not present');
    } else {
      info('Panel buttons', JSON.stringify(pc.buttons));
      info('Panel list items', pc.listItems);
    }
  } catch(e) { fail('Panel chat controls', e.message); }

  // 4. Claude Code iframe
  const claudeFrame = targets.find(t => t.type === 'iframe' && t.url?.includes('Anthropic.claude-code'));
  if (claudeFrame) {
    pass(`Claude Code iframe: ${claudeFrame.id.substring(0,8)}`);
  } else {
    info('Claude Code iframe', 'not found');
  }

  // 5. Codex extension iframe
  const codexFrame = targets.find(t => t.type === 'iframe' && (t.url?.includes('openai.chatgpt') || t.url?.includes('openai')));
  if (codexFrame) {
    pass(`Codex iframe: ${codexFrame.id.substring(0,8)}`);
  } else {
    info('Codex iframe', 'not open');
  }

  await client.close();
}

// ─── Run ─────────────────────────────────────────────────────────────────────

(async () => {
  console.log('🔍 Live CDP Selector Validation\n');
  try { await testCodexDesktop(); } catch(e) { console.log(`\n❌ Codex Desktop test crashed: ${e.message}`); }
  try { await testAntigravity(); } catch(e) { console.log(`\n❌ Antigravity test crashed: ${e.message}`); }
  console.log('\n✅ Done.');
})();
