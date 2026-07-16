#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.RAC_PLAYWRIGHT_CORE || '../frontend/node_modules/playwright-core');

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter(Boolean);
  const selected = candidates.find(candidate => fs.existsSync(candidate));
  if (!selected) throw new Error(`Headless Chrome not found; checked ${candidates.join(', ')}`);
  return selected;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function imageDataUrl(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const mime = extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : 'image/png';
  return `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}`;
}

async function makeContactSheet({ images, outputPath, title = 'Operator dogfood evidence' }) {
  if (!Array.isArray(images) || images.length === 0) throw new Error('contact sheet requires at least one image');
  for (const entry of images) {
    if (!fs.existsSync(entry.path)) throw new Error(`contact-sheet image is missing: ${entry.path}`);
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const cards = images.map((entry, index) => `
    <figure>
      <figcaption><strong>${String(index + 1).padStart(2, '0')}</strong> ${escapeHtml(entry.label || path.basename(entry.path))}</figcaption>
      <img src="${imageDataUrl(entry.path)}" alt="${escapeHtml(entry.label || path.basename(entry.path))}">
    </figure>`).join('');
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  html, body { margin: 0; background: #0e141c; color: #eef3f8; font: 14px/1.4 system-ui, sans-serif; }
  body { padding: 24px; }
  h1 { margin: 0 0 18px; font-size: 24px; }
  main { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
  figure { margin: 0; min-width: 0; overflow: hidden; border: 1px solid #405065; border-radius: 10px; background: #151e29; }
  figcaption { padding: 9px 11px; border-bottom: 1px solid #405065; color: #c8d4e3; }
  figcaption strong { margin-right: 7px; color: #82b6ff; }
  img { display: block; width: 100%; height: 460px; object-fit: contain; object-position: top center; background: #0b1017; }
</style></head><body><h1>${escapeHtml(title)}</h1><main>${cards}</main></body></html>`;

  const browser = await chromium.launch({
    executablePath: findChrome(),
    headless: true,
    args: ['--disable-gpu', '--hide-scrollbars'],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
    await page.setContent(html, { waitUntil: 'load' });
    await page.screenshot({ path: outputPath, fullPage: true, animations: 'disabled' });
  } finally {
    await browser.close().catch(() => {});
  }
  return { outputPath, images: images.length };
}

function parseArgs(argv) {
  const options = { title: 'Operator dogfood evidence', outputPath: '', images: [] };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--output' && argv[index + 1]) options.outputPath = path.resolve(argv[++index]);
    else if (arg === '--title' && argv[index + 1]) options.title = argv[++index];
    else if (arg === '--image' && argv[index + 1]) {
      const value = argv[++index];
      const split = value.indexOf('=');
      options.images.push({
        label: split >= 0 ? value.slice(0, split) : path.basename(value),
        path: path.resolve(split >= 0 ? value.slice(split + 1) : value),
      });
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.outputPath) throw new Error('--output is required');
  return options;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const result = await makeContactSheet(options);
  process.stdout.write(`PASS operator dogfood contact sheet (${result.images} images)\n${result.outputPath}\n`);
}

if (require.main === module) main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});

module.exports = { makeContactSheet, parseArgs };
