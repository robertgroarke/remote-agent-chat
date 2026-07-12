#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('../frontend/node_modules/playwright-core');
const fidelity = require('./run-fidelity-regression');

const ROOT = path.resolve(__dirname, '..');
const MESSAGE_COUNT = 3200;
const MAX_FRAME_MS = 100;

function parseArgs(argv) {
  const valueAfter = flag => {
    const index = argv.indexOf(flag);
    return index >= 0 && argv[index + 1] ? argv[index + 1] : '';
  };
  const output = valueAfter('--output');
  return {
    output: output ? path.resolve(output) : '',
    sessionId: valueAfter('--session-id'),
  };
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter(Boolean);
  const executable = candidates.find(candidate => fs.existsSync(candidate));
  if (!executable) throw new Error(`Headless Chrome not found; checked ${candidates.join(', ')}`);
  return executable;
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function productionContent(content, index) {
  if (typeof content === 'string') {
    return `<p>${escapeHtml(content)}</p>`;
  }
  if (content == null) return '<p></p>';
  const serialized = JSON.stringify(content, null, 2);
  return `<details open><summary>Structured content ${index}</summary><pre><code>${escapeHtml(serialized)}</code></pre></details>`;
}

function deterministicMessages() {
  return Array.from({ length: MESSAGE_COUNT }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: null,
    deterministic: true,
  }));
}

function fixtureHtml(styles, inputMessages = deterministicMessages()) {
  const rows = [];
  for (let index = 0; index < inputMessages.length; index++) {
    const message = inputMessages[index] || {};
    const role = message.role === 'user' ? 'user' : 'assistant';
    let body = productionContent(message.content, index);
    if (message.deterministic) {
      const detail = index % 5 === 0
        ? `<details open><summary>Tool ${index}</summary><pre><code>line ${index}\nline ${index + 1}\nline ${index + 2}</code></pre></details>`
        : '';
      const paragraphCount = 1 + (index % 4);
      body = Array.from({ length: paragraphCount }, (_, paragraph) => (
        `<p>Message ${index} paragraph ${paragraph}: deterministic production transcript fixture content.</p>`
      )).join('') + detail;
    }
    rows.push(
      `<div class="message ${role} transcript-virtual-row" data-index="${index}" data-message-key="fixture-${index}">` +
      `<div class="${role}-gutter"></div><div class="${role}-content">` +
      `<div class="message-role">${role}</div>${body}</div></div>`,
    );
  }
  return `<!doctype html><html><head><meta charset="utf-8"><style>${styles}</style><style>
    html,body{margin:0;width:100%;height:100%;background:#0d1117;color:#e6edf3}
    .messages{box-sizing:border-box;width:100%;height:100vh}
  </style></head><body><main class="messages harness-theme">${rows.join('')}</main></body></html>`;
}

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] || 0;
}

async function measure(page, viewport, expectedCount) {
  await page.setViewportSize(viewport);
  const metrics = await page.evaluate(async ({ expectedCount }) => {
    const list = document.querySelector('.messages');
    const rows = Array.from(document.querySelectorAll('.message'));
    const beforeOpen = document.querySelectorAll('details[open]').length;
    const firstText = rows[0]?.textContent || '';
    const lastText = rows[rows.length - 1]?.textContent || '';
    const style = getComputedStyle(rows[0]);
    list.scrollTop = 0;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const frameTimes = [];
    let previous = performance.now();
    const frames = 480;
    for (let frame = 1; frame <= frames; frame++) {
      await new Promise(resolve => requestAnimationFrame(now => {
        frameTimes.push(now - previous);
        previous = now;
        list.scrollTop = (list.scrollHeight - list.clientHeight) * (frame / frames);
        resolve();
      }));
    }
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const afterRows = Array.from(document.querySelectorAll('.message'));
    return {
      count: rows.length,
      count_after: afterRows.length,
      expected_count: expectedCount,
      first_text_preserved: (afterRows[0]?.textContent || '') === firstText,
      last_text_preserved: (afterRows[afterRows.length - 1]?.textContent || '') === lastText,
      first_index: afterRows[0]?.getAttribute('data-index'),
      last_index: afterRows[afterRows.length - 1]?.getAttribute('data-index'),
      details_open_before: beforeOpen,
      details_open_after: document.querySelectorAll('details[open]').length,
      content_visibility: style.contentVisibility,
      intrinsic_block_size: style.containIntrinsicBlockSize || style.containIntrinsicSize,
      frame_times: frameTimes,
      scroll_height: list.scrollHeight,
      final_scroll_top: list.scrollTop,
    };
  }, { expectedCount });

  assert.equal(metrics.count, expectedCount);
  assert.equal(metrics.count_after, expectedCount);
  assert.equal(metrics.first_index, '0');
  assert.equal(metrics.last_index, String(expectedCount - 1));
  assert.equal(metrics.first_text_preserved, true);
  assert.equal(metrics.last_text_preserved, true);
  assert.equal(metrics.details_open_after, metrics.details_open_before);
  assert.equal(metrics.content_visibility, 'auto');

  const frameTimes = metrics.frame_times.slice(2);
  const summary = {
    viewport,
    messages: metrics.count,
    details_open: metrics.details_open_after,
    max_frame_ms: Number(Math.max(...frameTimes).toFixed(2)),
    p95_frame_ms: Number(percentile(frameTimes, 0.95).toFixed(2)),
    frames_over_100ms: frameTimes.filter(value => value > MAX_FRAME_MS).length,
    scroll_height: metrics.scroll_height,
    final_scroll_top: metrics.final_scroll_top,
    content_visibility: metrics.content_visibility,
    intrinsic_block_size: metrics.intrinsic_block_size,
    content_order_preserved: true,
    expanded_state_preserved: true,
  };
  assert.equal(summary.frames_over_100ms, 0, JSON.stringify(summary));
  return summary;
}

async function fetchProductionMessages(sessionId) {
  assert(sessionId, 'production session id is required');
  const relayEnv = fidelity.loadEnvFile(path.join(ROOT, 'relay-server', '.env'));
  const proxyEnv = fidelity.loadEnvFile(path.join(ROOT, 'agent-proxy', '.env'));
  const token = fidelity.buildBearerToken(relayEnv);
  assert(token, 'JWT_SECRET + ALLOWED_EMAIL are required for production history');
  const attempts = [];
  for (const base of fidelity.deriveRelayBaseUrls(null, relayEnv, proxyEnv)) {
    const url = `${base}/api/sessions/${encodeURIComponent(sessionId)}/messages?full=true`;
    try {
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) {
        attempts.push(`${new URL(base).origin}: HTTP ${response.status}`);
        continue;
      }
      const text = await response.text();
      const payload = JSON.parse(text);
      const messages = Array.isArray(payload.messages) ? payload.messages : [];
      assert(messages.length >= 3000, `real session has only ${messages.length} messages`);
      return {
        messages,
        metadata: {
          session_id: sessionId,
          message_count: messages.length,
          payload_bytes: Buffer.byteLength(text),
        },
      };
    } catch (error) {
      attempts.push(`${new URL(base).origin}: ${error.message}`);
    }
  }
  throw new Error(`production transcript fetch failed (${attempts.join('; ')})`);
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const styles = fs.readFileSync(path.join(ROOT, 'frontend', 'styles.css'), 'utf8');
  const production = options.sessionId
    ? await fetchProductionMessages(options.sessionId)
    : null;
  const messages = production ? production.messages : deterministicMessages();
  const browser = await chromium.launch({
    executablePath: findChrome(),
    headless: true,
    args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
  });
  try {
    async function measureFresh(viewport) {
      const page = await browser.newPage({ viewport });
      try {
        await page.setContent(fixtureHtml(styles, messages), { waitUntil: 'load' });
        return await measure(page, viewport, messages.length);
      } finally {
        await page.close();
      }
    }
    const desktop = await measureFresh({ width: 1280, height: 900 });
    const mobile = await measureFresh({ width: 390, height: 844 });
    const result = {
      ok: true,
      generated_at: new Date().toISOString(),
      fixture: production
        ? 'real production transcript content rendered in production-shaped virtual rows'
        : 'production transcript DOM with deterministic mixed-height messages',
      source: production ? production.metadata : { message_count: messages.length },
      target_max_frame_ms: MAX_FRAME_MS,
      desktop,
      mobile,
    };
    const serialized = JSON.stringify(result, null, 2) + '\n';
    if (options.output) {
      fs.mkdirSync(path.dirname(options.output), { recursive: true });
      fs.writeFileSync(options.output, serialized);
    }
    process.stdout.write(serialized);
    return result;
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Transcript virtualization E2E: FAIL (${error.stack || error.message})`);
    process.exitCode = 1;
  });
}

module.exports = { main, fixtureHtml, measure, fetchProductionMessages };
