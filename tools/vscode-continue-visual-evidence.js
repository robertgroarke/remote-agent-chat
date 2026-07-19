#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const CDP = require(path.join(__dirname, '..', 'agent-proxy', 'node_modules', 'chrome-remote-interface'));
const selectors = require(path.join(__dirname, '..', 'agent-proxy', 'selectors'));

function parseArgs(argv) {
  const options = { port: 9230, screenshot: '', resultFile: '', sessionId: '' };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--port') options.port = Number(argv[++index]);
    else if (arg === '--screenshot') options.screenshot = path.resolve(argv[++index]);
    else if (arg === '--result-file') options.resultFile = path.resolve(argv[++index]);
    else if (arg === '--session-id') options.sessionId = String(argv[++index] || '');
  }
  if (options.port !== 9230) throw new Error(`Continue visual evidence is restricted to disposable port 9230, got ${options.port}`);
  if (!options.screenshot || !options.resultFile) throw new Error('Usage: --screenshot <png> --result-file <json> [--session-id <id>]');
  return options;
}

function isContinueTarget(target) {
  return target?.type === 'iframe' && /[?&]extensionId=Continue\.continue(?:&|$)/i.test(String(target.url || ''));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const protectedTargets = await CDP.List({ port: 9223 });
  const targets = await CDP.List({ port: options.port });
  const frames = targets.filter(isContinueTarget);
  if (frames.length !== 1) throw new Error(`Expected one disposable Continue iframe, found ${frames.length}`);
  const workbenches = targets.filter(target => target?.type === 'page' && /workbench\.html/i.test(String(target.url || '')));
  if (workbenches.length !== 1) throw new Error(`Expected one disposable VS Code workbench, found ${workbenches.length}`);

  const client = await CDP({ port: options.port, target: frames[0].id });
  try {
    await client.Runtime.enable();
    await client.Page.enable();
    client.Runtime._webviewId = (frames[0].url.match(/[?&]id=([0-9a-f-]+)/i) || [])[1] || '';
    await selectors.cacheInnerContextId(client.Runtime);

    const messages = JSON.parse(await selectors.readMessages(
      client.Runtime,
      'continue',
      options.sessionId || 'continue-visual-evidence'
    ) || '[]');
    const native = await selectors.evalInFrame(client.Runtime, `
      function norm(value) { return String(value || '').replace(/\\s+/g, ' ').trim(); }
      function describe(el) {
        if (!el) return null;
        var rect = el.getBoundingClientRect();
        var style = getComputedStyle(el);
        return {
          tag: el.tagName,
          testid: el.getAttribute('data-testid') || '',
          role: el.getAttribute('role') || '',
          class_name: String(el.className || '').slice(0, 400),
          text: norm(el.innerText || el.textContent).slice(0, 4000),
          html: String(el.outerHTML || '').slice(0, 12000),
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          style: {
            font_family: style.fontFamily,
            font_size: style.fontSize,
            font_weight: style.fontWeight,
            line_height: style.lineHeight,
            letter_spacing: style.letterSpacing,
            color: style.color,
            background_color: style.backgroundColor
          }
        };
      }
      var scroll = d.querySelector('[data-testid="scroll-container"]')
        || Array.from(d.querySelectorAll('main div')).find(function(el) {
          var cls = String(el.className || '');
          return /overflow-y-(?:auto|scroll)/.test(cls) && /flex-1/.test(cls);
        });
      var terminal = Array.from(d.querySelectorAll('[data-testid="terminal-container"]'));
      var toolTitles = Array.from(d.querySelectorAll('[data-testid="tool-call-title"]'));
      var actions = Array.from(d.querySelectorAll('[data-testid="performing-actions"]'));
      var threadMessages = Array.from(d.querySelectorAll('.thread-message'));
      return {
        viewport: { width: innerWidth, height: innerHeight },
        scroll: describe(scroll),
        counts: {
          terminals: terminal.length,
          tool_titles: toolTitles.length,
          performing_actions: actions.length,
          thread_messages: threadMessages.length
        },
        latest_terminal: describe(terminal[terminal.length - 1]),
        latest_tool_title: describe(toolTitles[toolTitles.length - 1]),
        latest_performing_actions: describe(actions[actions.length - 1]),
        latest_thread_message: describe(threadMessages[threadMessages.length - 1])
      };
    `);

    const pageClient = await CDP({ port: options.port, target: workbenches[0].id });
    let shot;
    try {
      await pageClient.Page.enable();
      shot = await pageClient.Page.captureScreenshot({ format: 'png', fromSurface: true, captureBeyondViewport: false });
    } finally {
      await pageClient.close();
    }
    fs.mkdirSync(path.dirname(options.screenshot), { recursive: true });
    fs.writeFileSync(options.screenshot, Buffer.from(shot.data, 'base64'));

    const contentBlocks = messages.flatMap(message => Array.isArray(message.content_blocks) ? message.content_blocks : []);
    const result = {
      ok: messages.length > 0 && native?.counts?.thread_messages > 0,
      port: options.port,
      target_id: frames[0].id,
      protected_9223_targets: protectedTargets.length,
      messages: messages.length,
      content_block_types: contentBlocks.map(block => block?.type).filter(Boolean),
      native,
      screenshot: path.basename(options.screenshot),
      completed_at: new Date().toISOString(),
    };
    fs.mkdirSync(path.dirname(options.resultFile), { recursive: true });
    fs.writeFileSync(options.resultFile, `${JSON.stringify(result, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ok) process.exitCode = 1;
  } finally {
    await client.close();
  }
}

main().catch(error => {
  console.error('FAIL', error.message);
  process.exit(1);
});
