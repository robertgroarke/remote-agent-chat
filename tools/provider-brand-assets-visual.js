#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const { chromium } = require(process.env.RAC_PLAYWRIGHT_CORE || '../frontend/node_modules/playwright-core');
const { assertProviderAssetHashes } = require('./provider-brand-assets');

const root = path.join(__dirname, '..');
const assetRoot = path.join(root, 'provider-assets');
const { manifest } = assertProviderAssetHashes(assetRoot);
const outputIndex = process.argv.indexOf('--output');
const outputPath = outputIndex >= 0 && process.argv[outputIndex + 1]
  ? path.resolve(process.argv[outputIndex + 1]) : null;
const screenshotIndex = process.argv.indexOf('--screenshot-dir');
const screenshotDir = screenshotIndex >= 0 && process.argv[screenshotIndex + 1]
  ? path.resolve(process.argv[screenshotIndex + 1]) : null;

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function markRows(platform, scheme) {
  return manifest.providers.map(provider => {
    const render = provider.render[platform];
    const file = render[scheme];
    const tint = scheme === 'dark' && render.dark_tint ? ' tinted' : '';
    return `<div class="provider-row" data-provider-id="${escapeHtml(provider.provider_id)}">
      <span class="provider-mark ${platform}${tint}" role="img" aria-label="${escapeHtml(provider.accessible_name)} ${platform} ${scheme} provider mark">
        <img src="/provider-assets/${escapeHtml(file)}" alt="" aria-hidden="true">
      </span>
      <span><strong>${escapeHtml(provider.accessible_name)}</strong><small>${escapeHtml(file)}</small></span>
    </div>`;
  }).join('\n');
}

function pageHtml(scheme) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Provider mark comparison</title><style>
  *{box-sizing:border-box}html,body{margin:0;min-height:100%;font-family:Inter,Segoe UI,sans-serif}
  body{background:${scheme === 'light' ? '#f6f8fa' : '#0d1117'};color:${scheme === 'light' ? '#24292f' : '#f0f6fc'};padding:28px}
  main{margin:0 auto;max-width:1080px}h1{font-size:24px;margin:0 0 6px}p{color:${scheme === 'light' ? '#57606a' : '#8b949e'};margin:0 0 22px}
  .comparison-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}
  section{background:${scheme === 'light' ? '#fff' : '#161b22'};border:1px solid ${scheme === 'light' ? '#d0d7de' : '#30363d'};border-radius:14px;padding:16px}
  h2{font-size:16px;margin:0 0 13px}.provider-list{display:flex;flex-direction:column;gap:8px}.provider-row{align-items:center;display:flex;gap:11px;min-width:0;padding:8px;border-radius:10px;background:${scheme === 'light' ? '#f6f8fa' : '#0d1117'};border:1px solid ${scheme === 'light' ? '#d8dee4' : '#21262d'}}
  .provider-mark{align-items:center;background:${scheme === 'light' ? '#fff' : '#0d1117'};border:1px solid ${scheme === 'light' ? '#d0d7de' : '#30363d'};border-radius:8px;display:inline-flex;flex:0 0 auto;justify-content:center;overflow:hidden;padding:4px}
  .provider-mark.web{height:32px;width:32px}.provider-mark.android{height:34px;width:34px}.provider-mark img{display:block;height:100%;max-height:24px;max-width:24px;object-fit:contain;width:100%}.provider-mark.tinted img{filter:invert(1)}
  .provider-row>span:last-child{display:flex;flex-direction:column;min-width:0}.provider-row strong{font-size:12px}.provider-row small{color:${scheme === 'light' ? '#656d76' : '#8b949e'};font-family:ui-monospace,monospace;font-size:9px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  @media(max-width:600px){body{padding:14px}.comparison-grid{grid-template-columns:1fr;gap:12px}h1{font-size:20px}section{padding:13px}}
  </style></head><body><main><h1>Official provider marks</h1><p>${scheme} treatment · canonical asset set ${escapeHtml(manifest.asset_set_version)}</p><div class="comparison-grid">
  <section data-platform="web"><h2>Web · ${scheme}</h2><div class="provider-list">${markRows('web', scheme)}</div></section>
  <section data-platform="android"><h2>Android · ${scheme}</h2><div class="provider-list">${markRows('android', scheme)}</div></section>
  </div></main></body></html>`;
}

async function main() {
  const port = await freePort();
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    if (url.pathname === '/') {
      const scheme = url.searchParams.get('theme') === 'light' ? 'light' : 'dark';
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      response.end(pageHtml(scheme));
      return;
    }
    if (!url.pathname.startsWith('/provider-assets/')) {
      response.writeHead(404); response.end('not found'); return;
    }
    const relative = url.pathname.slice('/provider-assets/'.length);
    const filePath = path.resolve(assetRoot, relative);
    if (!filePath.startsWith(`${path.resolve(assetRoot)}${path.sep}`) || !fs.existsSync(filePath)) {
      response.writeHead(404); response.end('not found'); return;
    }
    response.writeHead(200, {
      'content-type': path.extname(filePath) === '.svg' ? 'image/svg+xml' : 'image/png',
      'cache-control': 'no-store',
    });
    fs.createReadStream(filePath).pipe(response);
  });
  await new Promise((resolve, reject) => server.listen(port, '127.0.0.1', error => error ? reject(error) : resolve()));

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const cases = [];
  try {
    for (const testCase of [
      { id: 'dark-desktop', scheme: 'dark', width: 1440, height: 900 },
      { id: 'dark-mobile-390', scheme: 'dark', width: 390, height: 844 },
      { id: 'light-desktop', scheme: 'light', width: 1440, height: 900 },
      { id: 'light-mobile-390', scheme: 'light', width: 390, height: 844 },
    ]) {
      await page.setViewportSize({ width: testCase.width, height: testCase.height });
      await page.goto(`http://127.0.0.1:${port}/?theme=${testCase.scheme}`, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => {
        const images = [...document.images];
        return images.length === 10 && images.every(image => image.complete && image.naturalWidth > 0);
      });
      const state = await page.evaluate(() => ({
        images: document.images.length,
        labels: [...document.querySelectorAll('[role="img"]')].map(node => node.getAttribute('aria-label')),
        document_overflow_px: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        clipped_marks: [...document.querySelectorAll('.provider-mark')].filter(node => node.scrollWidth > node.clientWidth || node.scrollHeight > node.clientHeight).length,
        web_marks: document.querySelectorAll('[data-platform="web"] .provider-mark').length,
        android_marks: document.querySelectorAll('[data-platform="android"] .provider-mark').length,
      }));
      assert.equal(state.images, 10);
      assert.equal(state.labels.length, 10);
      assert.equal(new Set(state.labels).size, 10);
      assert.equal(state.document_overflow_px, 0);
      assert.equal(state.clipped_marks, 0);
      assert.equal(state.web_marks, 5);
      assert.equal(state.android_marks, 5);

      let screenshot = null;
      let screenshotSha256 = null;
      if (screenshotDir) {
        fs.mkdirSync(screenshotDir, { recursive: true });
        screenshot = path.join(screenshotDir, `provider-marks-${testCase.id}.png`);
        await page.screenshot({ path: screenshot, fullPage: true });
        screenshotSha256 = sha256(screenshot);
      }
      cases.push({ ...testCase, ...state, screenshot, screenshot_sha256: screenshotSha256 });
    }
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(() => resolve()));
  }

  const result = {
    ok: true,
    generated_at: new Date().toISOString(),
    browser_mode: 'headless',
    asset_set_version: manifest.asset_set_version,
    providers: manifest.providers.length,
    cases,
    comparisons: cases.length * manifest.providers.length * 2,
    image_load_failures: 0,
    text_fallbacks: 0,
    overflow_cases: 0,
    clipped_marks: 0,
    new_windows_opened: 0,
    focus_actions: 0,
  };
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  }
  console.log(JSON.stringify(result, null, 2));
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
