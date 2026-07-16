#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const CDP = require('../agent-proxy/node_modules/chrome-remote-interface');
const { PNG } = require('../frontend/node_modules/pngjs');
const selectors = require('../agent-proxy/selectors');

const ROOT = path.resolve(__dirname, '..');
const EVIDENCE_ROOT = path.join(ROOT, 'evidence');
const CDP_HOST = '::1';
const CDP_PORT = 9225;

function parseArgs(argv) {
  const options = { kind: '', output: '', resultFile: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--kind' && argv[index + 1]) options.kind = String(argv[++index]);
    else if (arg === '--output' && argv[index + 1]) options.output = path.resolve(argv[++index]);
    else if (arg === '--result-file' && argv[index + 1]) options.resultFile = path.resolve(argv[++index]);
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  if (!['thinking', 'terminal'].includes(options.kind)) throw new Error('--kind must be thinking or terminal');
  if (!options.output || path.extname(options.output).toLowerCase() !== '.png') throw new Error('--output must be a PNG file');
  const relativeOutput = path.relative(EVIDENCE_ROOT, options.output);
  if (relativeOutput.startsWith('..') || path.isAbsolute(relativeOutput)) throw new Error('Output must stay under the evidence tree');
  if (options.resultFile) {
    const relativeResult = path.relative(EVIDENCE_ROOT, options.resultFile);
    if (relativeResult.startsWith('..') || path.isAbsolute(relativeResult)) throw new Error('Result file must stay under the evidence tree');
    if (path.extname(options.resultFile).toLowerCase() !== '.json') throw new Error('Result file must be JSON');
  }
  return options;
}

function hash(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value || ''), 'utf8');
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

async function capture(options) {
  const targets = (await CDP.List({ host: CDP_HOST, port: CDP_PORT }))
    .filter(target => target.type === 'page' && target.title === 'Codex' && target.url === 'app://-/index.html');
  assert.strictEqual(targets.length, 1, `Expected one exact hidden Codex Desktop page, found ${targets.length}`);
  const target = targets[0];

  const store = JSON.parse(fs.readFileSync(path.join(ROOT, 'agent-proxy', 'session-store.json'), 'utf8'));
  const bindings = Object.values(store.sessions || {}).filter(session =>
    session.agent_type === 'codex-desktop'
      && session.status === 'healthy'
      && Number(session.cdp_port) === CDP_PORT
      && session.target_id === target.id
  );
  assert.strictEqual(bindings.length, 1, `Expected one healthy Codex Desktop binding for ${target.id}, found ${bindings.length}`);

  const client = await CDP({ host: CDP_HOST, port: CDP_PORT, target });
  let disclosure = null;
  let screenshotBuffer = null;
  try {
    await Promise.all([client.Page.enable(), client.Runtime.enable()]);
    const pageState = JSON.parse(await selectors.evalInPage(client.Runtime, `
      return JSON.stringify({
        visibility: d.visibilityState,
        hasFocus: d.hasFocus(),
        title: d.title,
        url: d.location.href,
        theme: d.documentElement.className
      });
    `));
    assert.strictEqual(pageState.visibility, 'hidden', 'Codex Desktop must remain hidden for native capture');
    assert(/electron-light/.test(pageState.theme), `Expected the retained light theme, got ${pageState.theme || '(none)'}`);

    const thinking = await selectors.detectThinking(client.Runtime, 'codex-desktop');
    assert.strictEqual(!!thinking.thinking, false, `Codex Desktop must be idle before capture (reported ${thinking.label || 'thinking'})`);

    const raw = await selectors.evalInPage(client.Runtime, `
      var kind = ${JSON.stringify(options.kind)};
      function norm(value) { return String(value || '').replace(/\\s+/g, ' ').trim(); }
      function category(button) {
        var text = norm(button.innerText || button.textContent);
        if (/^Worked for /i.test(text)) return 'thinking';
        if (/^Ran /i.test(text)) return 'terminal';
        return '';
      }
      function scrollables(button) {
        var seen = [];
        function add(el) { if (el && seen.indexOf(el) === -1) seen.push(el); }
        add(d.scrollingElement || d.documentElement);
        for (var node = button; node && node !== d.body; node = node.parentElement) {
          try {
            var style = d.defaultView.getComputedStyle(node);
            if (/(auto|scroll)/.test(style.overflowY || '') && node.scrollHeight > node.clientHeight) add(node);
          } catch (_) {}
        }
        return seen.map(function(el) { return { el: el, top: el.scrollTop, left: el.scrollLeft }; });
      }
      function ancestrySnapshot(button) {
        var rows = [];
        for (var node = button; node && node !== d.body; node = node.parentElement) {
          rows.push({ node: node, text: String(node.innerText || node.textContent || '').trim() });
        }
        return rows;
      }
      function expandedBody(button, before) {
        for (var index = 0; index < before.length; index++) {
          var row = before[index];
          var text = String(row.node.innerText || row.node.textContent || '').trim();
          var textDelta = text.length - row.text.length;
          if (textDelta > 8 && text.length < 50000) {
            return { root: row.node, text: text, textDelta: textDelta };
          }
        }
        return { root: null, text: '', textDelta: 0 };
      }
      async function pause(ms) { await new Promise(function(resolve) { setTimeout(resolve, ms); }); }

      var candidates = Array.from(d.querySelectorAll('button[aria-expanded]')).filter(function(button) {
        return category(button) === kind;
      });
      if (candidates.length === 0) throw new Error('No native ' + kind + ' disclosure exists');

      var chosen = null;
      var chosenBody = null;
      var originalExpanded = '';
      var toggled = false;
      for (var index = candidates.length - 1; index >= 0; index--) {
        var button = candidates[index];
        var wasExpanded = button.getAttribute('aria-expanded') || '';
        // Terminal grounding needs a measurable, reversible collapsed->expanded
        // transition. An already-open disclosure cannot establish which nearby
        // transcript text belongs to its output without a destructive collapse.
        if (kind === 'terminal' && wasExpanded === 'true') continue;
        var before = ancestrySnapshot(button);
        var didToggle = false;
        if (kind === 'terminal' && wasExpanded !== 'true') {
          button.click();
          didToggle = true;
          await pause(140);
        }
        var body = expandedBody(button, before);
        if (kind === 'thinking' || (body.root && body.textDelta > 8)) {
          chosen = button;
          chosenBody = body;
          originalExpanded = wasExpanded;
          toggled = didToggle;
          break;
        }
        if (didToggle && button.getAttribute('aria-expanded') === 'true') {
          button.click();
          await pause(80);
        }
      }
      if (!chosen) throw new Error('No native terminal disclosure exposed output after expansion');

      var snapshot = scrollables(chosen);
      var headerText = norm(chosen.innerText || chosen.textContent);
      var bodyText = String((chosenBody && chosenBody.text) || '');
      chosen.scrollIntoView({ block: 'center', inline: 'nearest' });
      // Hidden Codex Desktop virtualizes older turn text. Give the retained
      // compositor a bounded settle window after scroll so a native source
      // cannot freeze partially painted placeholder rows.
      await pause(900);
      window.__racCodexDesktopNativeCapture = {
        button: chosen,
        originalExpanded: originalExpanded,
        toggled: toggled,
        snapshot: snapshot
      };
      return JSON.stringify({
        kind: kind,
        candidateCount: candidates.length,
        headerText: headerText,
        bodyText: bodyText,
        bodyTextDelta: (chosenBody && chosenBody.textDelta) || 0,
        originalExpanded: originalExpanded,
        capturedExpanded: chosen.getAttribute('aria-expanded') || '',
        scrollBefore: snapshot.map(function(item) { return { top: item.top, left: item.left }; })
      });
    `, { awaitPromise: true });
    disclosure = JSON.parse(raw);

    const screenshot = await client.Page.captureScreenshot({
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    });
    screenshotBuffer = Buffer.from(screenshot.data, 'base64');

    const restoredRaw = await selectors.evalInPage(client.Runtime, `
      var state = window.__racCodexDesktopNativeCapture;
      if (!state || !state.button) throw new Error('Missing reversible capture state');
      if (state.toggled && state.button.getAttribute('aria-expanded') === 'true') {
        state.button.click();
        await new Promise(function(resolve) { setTimeout(resolve, 100); });
      }
      state.snapshot.forEach(function(item) {
        item.el.scrollTop = item.top;
        item.el.scrollLeft = item.left;
      });
      await new Promise(function(resolve) { setTimeout(resolve, 80); });
      var restored = {
        expanded: state.button.getAttribute('aria-expanded') || '',
        scroll: state.snapshot.map(function(item) {
          return { expectedTop: item.top, actualTop: item.el.scrollTop, expectedLeft: item.left, actualLeft: item.el.scrollLeft };
        })
      };
      delete window.__racCodexDesktopNativeCapture;
      return JSON.stringify(restored);
    `, { awaitPromise: true });
    const restored = JSON.parse(restoredRaw);
    assert.strictEqual(restored.expanded, disclosure.originalExpanded, 'Disclosure expansion state was not restored');
    restored.scroll.forEach(item => {
      assert.strictEqual(item.actualTop, item.expectedTop, 'Codex Desktop vertical scroll was not restored');
      assert.strictEqual(item.actualLeft, item.expectedLeft, 'Codex Desktop horizontal scroll was not restored');
    });

    const png = PNG.sync.read(screenshotBuffer);
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, screenshotBuffer);
    const result = {
      ok: true,
      generated_at: new Date().toISOString(),
      agent: 'codex-desktop',
      kind: options.kind,
      hidden_only: true,
      idle_required: true,
      host: CDP_HOST,
      port: CDP_PORT,
      target_id: target.id,
      session_id: bindings[0].session_id,
      page_state_before_capture: pageState,
      candidates: disclosure.candidateCount,
      native_header_length: disclosure.headerText.length,
      native_header_sha256: hash(disclosure.headerText),
      native_body_length: disclosure.bodyText.length,
      native_body_sha256: hash(disclosure.bodyText),
      native_body_text_delta: disclosure.bodyTextDelta,
      original_expanded: disclosure.originalExpanded,
      captured_expanded: disclosure.capturedExpanded,
      restored_expanded: restored.expanded,
      scroll_restored_exactly: true,
      output: path.relative(ROOT, options.output).replace(/\\/g, '/'),
      sha256: hash(screenshotBuffer),
      width: png.width,
      height: png.height,
      bytes: screenshotBuffer.length,
      sends: 0,
      controls: 0,
      focus_actions: 0,
      visible_windows_opened: 0,
      reversible_dom_actions: options.kind === 'terminal' ? ['expand', 'scroll', 'collapse', 'restore_scroll'] : ['scroll', 'restore_scroll'],
    };
    if (options.resultFile) {
      fs.mkdirSync(path.dirname(options.resultFile), { recursive: true });
      fs.writeFileSync(options.resultFile, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    }
    return result;
  } finally {
    if (disclosure) {
      try {
        await selectors.evalInPage(client.Runtime, `
          var state = window.__racCodexDesktopNativeCapture;
          if (state && state.button) {
            if (state.toggled && state.button.getAttribute('aria-expanded') === 'true') state.button.click();
            state.snapshot.forEach(function(item) { item.el.scrollTop = item.top; item.el.scrollLeft = item.left; });
            delete window.__racCodexDesktopNativeCapture;
          }
          return true;
        `);
      } catch (_) {}
    }
    await client.close();
  }
}

async function main(argv = process.argv.slice(2)) {
  const result = await capture(parseArgs(argv));
  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = { capture, parseArgs };
