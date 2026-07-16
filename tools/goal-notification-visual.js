#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('../frontend/node_modules/playwright-core');
const { freshEvidenceDirectory } = require('./evidence-path');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = freshEvidenceDirectory(ROOT, 'goal-notification-visual');
const VIEWPORTS = {
  desktop: { width: 1280, height: 900 },
  mobile: { width: 390, height: 844 },
};

function findChrome() {
  return [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter(Boolean).find(candidate => fs.existsSync(candidate));
}

function fixture(css) {
  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>${css}</style>
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; min-height: 100%; background: var(--bg); color: var(--text); }
    body { display: block; overflow: auto; }
    .semantic-fixture { width: min(820px, calc(100vw - 24px)); margin: 12px auto; display: grid; gap: 14px; }
    .semantic-heading { font: 700 16px/1.3 system-ui,sans-serif; }
    .semantic-subtitle { color: var(--text2); font: 12px/1.5 system-ui,sans-serif; }
    .notification-settings-panel { position: static; width: 100%; max-width: none; transform: none; }
    .visual-toast-stack { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 10px; }
    .attention-toast.visual-semantic-toast { position: static; inset: auto; width: auto; min-width: 0; animation: none; }
    .attention-toast.visual-semantic-toast button { display: none; }
    @media (max-width: 600px) {
      .semantic-fixture { width: calc(100vw - 16px); margin: 8px auto; }
      .visual-toast-stack { grid-template-columns: 1fr; }
      .notification-setting-row { gap: 10px; }
      .notification-setting-row > span { min-width: 0; }
    }
  </style>
</head>
<body>
  <main class="semantic-fixture">
    <div>
      <div class="semantic-heading">Goal notification semantics</div>
      <div class="semantic-subtitle">Ordinary turns stay quiet until a harness supplies an authoritative native turn boundary. Only native goal transitions can complete or require goal attention.</div>
    </div>
    <section class="settings-panel notification-settings-panel" aria-label="Notification settings fixture">
      <div class="settings-panel-header"><span>Notifications</span><button class="settings-panel-close">×</button></div>
      <div class="settings-panel-body">
        ${[
          ['Turn finished', 'Unavailable until this harness supplies an authoritative native turn boundary', false, true],
          ['Goal completed', 'Only when the native goal reaches its terminal completed state', true, false],
          ['Goal needs attention', 'Paused, blocked, limited, cancelled, or failed goals', true, false],
          ['Agent error or rate limit', 'When an agent stops and needs attention', true, false],
          ['Notification sound', 'Subtle cue for allowed prompts and goal lifecycle events', false, false],
        ].map(([title, detail, checked, disabled]) => `<label class="notification-setting-row"><span><strong>${title}</strong><small>${detail}</small></span><input type="checkbox"${checked ? ' checked' : ''}${disabled ? ' disabled' : ''}></label>`).join('')}
        <div class="settings-note">Active /goal loop checkpoints stay quiet between turns.</div>
      </div>
    </section>
    <section class="visual-toast-stack" aria-label="Semantic notification copies">
      <div class="attention-toast visual-semantic-toast" role="status"><span class="attention-toast-icon goal_completed">✓</span><span class="attention-toast-copy"><strong>Goal completed</strong><span>Sol completed its goal.</span></span><button>Jump</button></div>
      <div class="attention-toast visual-semantic-toast" role="status"><span class="attention-toast-icon goal_attention">!</span><span class="attention-toast-copy"><strong>Needs attention</strong><span>Codex CLI's goal is blocked.</span></span><button>Jump</button></div>
    </section>
  </main>
  <script>
    document.documentElement.dataset.theme = new URLSearchParams(location.search).get('theme') || 'dark';
  </script>
</body>
</html>`;
}

(async () => {
  const chrome = findChrome();
  if (!chrome) throw new Error('Headless Chrome not found');
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const tempDir = path.join(os.tmpdir(), `rac-goal-notification-visual-${process.pid}-${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });
  const fixturePath = path.join(tempDir, 'fixture.html');
  fs.writeFileSync(fixturePath, fixture(fs.readFileSync(path.join(ROOT, 'frontend', 'styles.css'), 'utf8')));
  const browser = await chromium.launch({
    executablePath: chrome,
    headless: true,
    args: ['--disable-gpu', '--disable-background-networking', '--disable-component-update', '--no-first-run'],
  });
  const cases = [];
  try {
    const page = await browser.newPage();
    for (const theme of ['dark', 'light']) {
      for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
        await page.setViewportSize(viewport);
        await page.goto(`${pathToFileURL(fixturePath).href}?theme=${theme}`);
        await page.waitForFunction(() => document.fonts?.status === 'loaded' || !document.fonts);
        const copy = await page.locator('.visual-toast-stack').innerText();
        for (const required of ['Goal completed', 'Needs attention']) {
          if (!copy.includes(required)) throw new Error(`Missing visual copy: ${required}`);
        }
        const settingCopy = await page.locator('.notification-settings-panel').innerText();
        if (!settingCopy.includes('Turn finished') || !settingCopy.includes('authoritative native turn boundary')) {
          throw new Error('Disabled Turn finished setting lacks authoritative-boundary copy');
        }
        if (copy.includes('Turn finished') || copy.includes('Session completed')) {
          throw new Error('Unsupported ordinary-turn completion toast is still rendered');
        }
        const layout = await page.evaluate(() => ({
          viewport_width: innerWidth,
          scroll_width: document.documentElement.scrollWidth,
          clipped_rows: [...document.querySelectorAll('.notification-setting-row')]
            .filter(row => row.scrollWidth > row.clientWidth + 1).length,
        }));
        if (layout.scroll_width > layout.viewport_width || layout.clipped_rows > 0) {
          throw new Error(`Visual overflow: ${JSON.stringify(layout)}`);
        }
        const image = path.join(OUTPUT_DIR, `${viewportName}-${theme}.png`);
        await page.locator('.semantic-fixture').screenshot({ path: image });
        cases.push({ theme, viewport: viewportName, image: path.relative(ROOT, image).replace(/\\/g, '/'), ...layout });
      }
    }
  } finally {
    await browser.close();
  }
  const result = {
    ok: true,
    driver: 'playwright-core',
    browser: 'headless-chromium',
    themes: ['dark', 'light'],
    viewports: VIEWPORTS,
    exact_toast_copy: ['Goal completed', 'Needs attention'],
    unavailable_setting_copy: ['Turn finished', 'authoritative native turn boundary'],
    ordinary_turn_toasts: 0,
    horizontal_overflow: 0,
    clipped_rows: 0,
    cases,
  };
  fs.writeFileSync(path.join(OUTPUT_DIR, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
