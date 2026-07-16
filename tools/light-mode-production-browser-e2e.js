#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const CDP = require('../agent-proxy/node_modules/chrome-remote-interface');

const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
const screenshotIndex = args.indexOf('--screenshot');
const sessionIndex = args.indexOf('--session');
const outputPath = outputIndex >= 0 && args[outputIndex + 1] ? path.resolve(args[outputIndex + 1]) : null;
const screenshotPath = screenshotIndex >= 0 && args[screenshotIndex + 1] ? path.resolve(args[screenshotIndex + 1]) : null;
const sessionId = sessionIndex >= 0 && args[sessionIndex + 1]
  ? args[sessionIndex + 1]
  : '37587dfa-8bfe-40ab-83c3-6a0b911b3892';
const cdp = process.env.RAC_VERIFICATION_BROWSER_CDP || 'http://127.0.0.1:9240';

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function rgb(text) {
  const match = String(text || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  return match ? match.slice(1).map(Number) : null;
}

(async () => {
  const endpoint = new URL(cdp);
  const port = Number(endpoint.port || 9240);
  const pages = (await CDP.List({ host: endpoint.hostname, port })).filter(target => target.type === 'page');
  assert.strictEqual(pages.length, 1, `expected one persistent verification page, found ${pages.length}`);
  const client = await CDP({ host: endpoint.hostname, port, target: pages[0].id });
  try {
    await Promise.all([client.Page.enable(), client.Runtime.enable()]);
    await client.Runtime.evaluate({
      expression: `(() => {
        localStorage.setItem('remote-agent-chat-theme', 'light');
        const next = new URL(location.origin + '/');
        next.searchParams.set('session', ${JSON.stringify(sessionId)});
        location.replace(next.href);
        return true;
      })()`,
      returnByValue: true,
    });

    let snapshot = null;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      await wait(250);
      try {
        const evaluated = await client.Runtime.evaluate({
          expression: `(() => {
            const selectors = ['.content-block-terminal .content-block-pre', '.content-block-tool-result .content-block-pre', '.code-block pre'];
            const blocks = selectors.map(selector => {
              const element = Array.from(document.querySelectorAll(selector)).find(node => {
                const rect = node.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
              });
              if (!element) return { selector, found: false };
              const style = getComputedStyle(element);
              const rect = element.getBoundingClientRect();
              return {
                selector,
                found: true,
                background: style.backgroundColor,
                color: style.color,
                border: style.borderColor,
                text: (element.innerText || '').slice(0, 160),
                rect: { x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height }
              };
            });
            return {
              ready: document.documentElement.dataset.theme === 'light' && document.querySelectorAll('.session-card').length > 0,
              theme: document.documentElement.dataset.theme,
              session_cards: document.querySelectorAll('.session-card').length,
              blocks,
              title: document.title,
              href: location.href
            };
          })()`,
          returnByValue: true,
        });
        snapshot = evaluated?.result?.value;
        if (snapshot?.ready && snapshot.blocks.some(block => block.found)) break;
      } catch {}
    }
    assert(snapshot?.ready, 'authenticated production page did not become light-mode ready');
    const found = snapshot.blocks.filter(block => block.found);
    assert(found.length > 0, 'selected production transcript had no terminal/tool/code block in its loaded tail');
    for (const block of found) {
      const background = rgb(block.background);
      const color = rgb(block.color);
      assert(background && background.every(channel => channel >= 230), `${block.selector} background is not light: ${block.background}`);
      assert(color && color.every(channel => channel <= 90), `${block.selector} text is not dark: ${block.color}`);
    }

    if (screenshotPath) {
      const block = found[0];
      const shot = await client.Page.captureScreenshot({
        format: 'png',
        captureBeyondViewport: true,
        clip: {
          x: Math.max(0, block.rect.x - 12),
          y: Math.max(0, block.rect.y - 40),
          width: Math.min(1000, block.rect.width + 24),
          height: Math.min(700, block.rect.height + 52),
          scale: 1,
        },
      });
      fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
      fs.writeFileSync(screenshotPath, Buffer.from(shot.data, 'base64'));
    }

    const result = {
      ok: true,
      cdp,
      pages: pages.length,
      reused_existing_page: true,
      focus_action: false,
      theme: snapshot.theme,
      session_cards: snapshot.session_cards,
      session_id: sessionId,
      blocks: found.map(({ rect, ...block }) => block),
      screenshot: screenshotPath ? path.relative(path.resolve(__dirname, '..'), screenshotPath) : null,
      generated_at: new Date().toISOString(),
    };
    const serialized = JSON.stringify(result, null, 2) + '\n';
    if (outputPath) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, serialized);
    }
    process.stdout.write(serialized);
  } finally {
    await client.close().catch(() => {});
  }
})().catch(error => {
  console.error(`Light-mode production browser E2E: FAIL (${error.stack || error.message || error})`);
  process.exit(1);
});
