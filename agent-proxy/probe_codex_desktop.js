#!/usr/bin/env node
// probe_codex_desktop.js — A12-03 DOM inspection probe for Codex Desktop
//
// Connects to Codex Desktop via CDP on port 9225, enumerates targets,
// and probes the DOM to identify selectors for message reading, sending,
// activity detection, rate limits, and config reading.
//
// Usage: node probe_codex_desktop.js
//
// Findings (2026-03-21):
//
// CDP Target:
//   - Port: 9225
//   - Type: "page"
//   - URL: "app://-/index.html?hostId=local"
//   - Title: "Codex"
//   - Target filter: type === "page" && url.startsWith("app://")
//
// Conversation Container:
//   - Scroll area: div[class*="overflow-y-auto"][class*="scrollbar-gutter"]
//   - Content wrapper: div[data-thread-find-target="conversation"]
//   - Turns: div[data-content-search-turn-key] — one per user/assistant exchange
//   - Units: div[data-content-search-unit-key] — one per message
//     Format: "{turnId}:{index}:{role}" e.g. "019d0ca7-...:0:user", "019d0ca7-...:1:assistant"
//
// Message Reading (existing CODEX_READ_EXPR works):
//   - User: [data-content-search-unit-key$=":user"] → .whitespace-pre-wrap for text
//   - Assistant: [data-content-search-unit-key$=":assistant"] → p, li, pre, h1-h4 for content
//   - Uses evalInPage (page-level DOM, no active-frame)
//
// Composer:
//   - Input: .ProseMirror (contenteditable div)
//   - Send button: last button in ancestor container with 4+ buttons
//     Classes include "rounded-full", "size-token-button-composer"
//     SVG path starts with "M9.33467" (upward arrow)
//   - Container: nearest ancestor matching [class*="rounded-3xl"]
//
// Config Buttons (in composer toolbar):
//   - Model: button text "GPT-5.4" (matches /^gpt[-\s.]?[\d.]+/i)
//   - Effort: button text "Medium" (matches /^(low|medium|high|extra\s*high)$/i)
//   - Access: button text "Default permissions" — NOTE: does NOT match existing
//     /access|restricted/i regex. Also seen: "Full access", "Read access".
//     Desktop variant uses "Default permissions" as default state.
//   - Other buttons in area: "Local" (networking?), "master" (branch), "Unstaged"
//
// Thread Sidebar:
//   - Workspace groups: [role="listitem"][aria-label] (e.g. aria-label="Playground")
//   - Thread items: [role="listitem"] without aria-label, text = title + age
//
// Thinking/Activity Detection:
//   - When idle: send button has upward-arrow SVG, opacity-50 class
//   - When generating: send button likely changes to stop icon (square SVG)
//     and opacity changes. No stop button with aria-label found when idle.
//   - Approach: detect send button SVG change or check for stop aria-label
//
// Rate Limit:
//   - Banner text contains patterns like "rate limit resets at 3:42 AM"
//   - Existing READ_CODEX_RATE_LIMIT_EXPR scans body innerText — works on desktop DOM
//   - No rate limit currently active, so banner not present to verify exact text
//
// Access Mode Labels (Codex Desktop):
//   - "Default permissions" (default)
//   - "Full access" (danger-full-access)
//   - "Read access" / "Read only" (read-only)
//   - Need to add "Default permissions" → "default" mapping

'use strict';

const CDP = require('chrome-remote-interface');

const PORT = 9225;

async function probe() {
  console.log(`\n=== Codex Desktop CDP Probe (port ${PORT}) ===\n`);

  // Step 1: List all targets
  console.log('--- Targets ---');
  const targets = await CDP.List({ port: PORT });
  for (const t of targets) {
    console.log(`  type=${t.type}  title="${t.title}"  url=${t.url}`);
  }

  // Step 2: Connect to the page target
  const pageTarget = targets.find(t => t.type === 'page' && t.url.startsWith('app://'));
  if (!pageTarget) {
    console.error('No page target found!');
    process.exit(1);
  }
  console.log(`\nConnecting to: ${pageTarget.id} (${pageTarget.title})\n`);

  const client = await CDP({ port: PORT, target: pageTarget.id });
  const { Runtime } = client;

  // Step 3: Probe DOM structure
  console.log('--- DOM Structure ---');
  const structure = await eval_(Runtime, `
    var result = {};
    result.title = document.title;
    result.bodyChildCount = document.body.children.length;
    result.rootId = document.querySelector('#root') ? true : false;
    result.proseMirror = !!document.querySelector('.ProseMirror');
    result.unitElements = document.querySelectorAll('[data-content-search-unit-key]').length;
    result.turnElements = document.querySelectorAll('[data-content-search-turn-key]').length;
    result.conversationArea = !!document.querySelector('[data-thread-find-target="conversation"]');
    result.threadItems = document.querySelectorAll('[role="listitem"]').length;
    return JSON.stringify(result, null, 2);
  `);
  console.log(structure);

  // Step 4: Read messages
  console.log('\n--- Messages ---');
  const messages = await eval_(Runtime, `
    var unitEls = Array.from(document.querySelectorAll('[data-content-search-unit-key]'));
    var msgs = unitEls.map(function(el) {
      var key = el.getAttribute('data-content-search-unit-key');
      var role = key.split(':').pop();
      var text = el.innerText.trim().substring(0, 200);
      return { key: key, role: role, preview: text };
    });
    return JSON.stringify(msgs, null, 2);
  `);
  console.log(messages);

  // Step 5: Config buttons
  console.log('\n--- Config Buttons ---');
  const config = await eval_(Runtime, `
    var btns = Array.from(document.querySelectorAll('button'));
    var last25 = btns.slice(-25);
    var relevant = last25.filter(function(b) {
      var t = b.textContent.trim();
      return t.length > 0 && t.length < 30;
    }).map(function(b) {
      return { text: b.textContent.trim(), ariaLabel: b.getAttribute('aria-label') };
    });
    return JSON.stringify(relevant, null, 2);
  `);
  console.log(config);

  // Step 6: Send button info
  console.log('\n--- Send Button ---');
  const sendBtn = await eval_(Runtime, `
    var pm = document.querySelector('.ProseMirror');
    if (!pm) return JSON.stringify({ error: 'no ProseMirror' });
    var container = pm.parentElement;
    while (container && container !== document.body) {
      if (container.querySelectorAll('button').length >= 4) break;
      container = container.parentElement;
    }
    var btns = Array.from(container.querySelectorAll('button'));
    var last = btns[btns.length - 1];
    return JSON.stringify({
      containerBtnCount: btns.length,
      ariaLabel: last.getAttribute('aria-label'),
      classes: last.className.substring(0, 200),
      disabled: last.disabled,
      hasSvg: !!last.querySelector('svg'),
      svgPathPrefix: last.querySelector('svg path') ? last.querySelector('svg path').getAttribute('d').substring(0, 40) : null
    }, null, 2);
  `);
  console.log(sendBtn);

  // Step 7: Rate limit check
  console.log('\n--- Rate Limit ---');
  const rl = await eval_(Runtime, `
    var allText = document.body.innerText;
    var pat = /rate.?limit|usage.?limit|too many requests|try again after|resets? (on|at|after)/i;
    return JSON.stringify({ detected: pat.test(allText) });
  `);
  console.log(rl);

  await client.close();
  console.log('\n=== Probe complete ===');
}

async function eval_(Runtime, code) {
  const result = await Runtime.evaluate({
    expression: `(function() { ${code} })()`,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    return `ERROR: ${result.exceptionDetails.exception?.description || result.exceptionDetails.text}`;
  }
  return result.result?.value ?? 'null';
}

probe().catch(err => {
  console.error('Probe failed:', err.message);
  process.exit(1);
});
