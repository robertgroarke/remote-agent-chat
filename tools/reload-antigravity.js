'use strict';

// reload-antigravity.js — Reload Antigravity IDE windows via CDP
//
// Connects to Antigravity's remote debugging port and sends location.reload()
// to each workbench page target. Reloads windows one at a time with verification.
//
// Usage:
//   node tools/reload-antigravity.js [--self-last]
//
// --self-last: If the current window's title is detected, reload it last.
//              Default behavior reloads all windows with a delay between each.
//
// This script is designed to be run as a DETACHED process so it survives
// the reload of the window hosting the Claude Code session that launched it.

const http = require('http');
const WebSocket = require('ws');

const CDP_PORT = parseInt(process.env.CDP_PORT || '9223', 10);
const RELOAD_DELAY_MS = parseInt(process.env.RELOAD_DELAY_MS || '5000', 10);
const VERIFY_TIMEOUT_MS = parseInt(process.env.VERIFY_TIMEOUT_MS || '30000', 10);
const SELF_WINDOW_HINT = process.env.SELF_WINDOW_HINT || 'Remote Agent Chat';

// ── Fetch CDP target list ────────────────────────────────────────────────────

function fetchTargets() {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${CDP_PORT}/json/list`, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error(`Failed to parse target list: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('Timeout fetching targets')); });
  });
}

// ── Find workbench page targets ──────────────────────────────────────────────

function findWorkbenchPages(targets) {
  return targets.filter(t =>
    t.type === 'page' &&
    t.url && t.url.includes('workbench.html')
  );
}

// ── Reload a single target via CDP WebSocket ─────────────────────────────────

function reloadTarget(target) {
  return new Promise((resolve, reject) => {
    const wsUrl = target.webSocketDebuggerUrl;
    if (!wsUrl) return reject(new Error(`No webSocketDebuggerUrl for ${target.title}`));

    log(`  Connecting to ${target.title} (${target.id.substring(0, 8)})...`);
    const ws = new WebSocket(wsUrl);
    let resolved = false;

    ws.on('open', () => {
      log(`  Sending location.reload()...`);
      ws.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression: 'location.reload()' },
      }));
      // The WebSocket will close when the page reloads
      setTimeout(() => {
        if (!resolved) { resolved = true; ws.close(); resolve(); }
      }, 2000);
    });

    ws.on('close', () => {
      if (!resolved) { resolved = true; resolve(); }
    });

    ws.on('error', (err) => {
      if (!resolved) { resolved = true; reject(err); }
    });

    setTimeout(() => {
      if (!resolved) { resolved = true; ws.close(); reject(new Error('Timeout')); }
    }, 10000);
  });
}

// ── Wait for a workbench page to reappear after reload ───────────────────────

async function waitForTarget(titleHint, timeoutMs) {
  const start = Date.now();
  log(`  Waiting for "${titleHint}" to reappear...`);

  while (Date.now() - start < timeoutMs) {
    await sleep(2000);
    try {
      const targets = await fetchTargets();
      const pages = findWorkbenchPages(targets);
      const found = pages.find(p => p.title && p.title.includes(titleHint));
      if (found) {
        log(`  "${titleHint}" is back (${found.id.substring(0, 8)})`);
        return found;
      }
    } catch {
      // CDP port might be temporarily unavailable during reload
    }
  }
  log(`  WARNING: "${titleHint}" did not reappear within ${timeoutMs}ms`);
  return null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  log('=== Antigravity IDE Reload Script ===');
  log(`CDP port: ${CDP_PORT}`);
  log(`Delay between reloads: ${RELOAD_DELAY_MS}ms`);
  log(`Self-window hint: "${SELF_WINDOW_HINT}"`);

  // 1. Discover workbench pages
  let targets;
  try {
    targets = await fetchTargets();
  } catch (e) {
    log(`FATAL: Cannot reach CDP on port ${CDP_PORT}: ${e.message}`);
    process.exit(1);
  }

  const pages = findWorkbenchPages(targets);
  if (pages.length === 0) {
    log('FATAL: No workbench pages found. Is Antigravity running with --remote-debugging-port?');
    process.exit(1);
  }

  log(`Found ${pages.length} workbench page(s):`);
  pages.forEach(p => log(`  - "${p.title}" (${p.id.substring(0, 8)})`));

  // 2. Sort so self-window is last
  const selfIdx = pages.findIndex(p => p.title && p.title.includes(SELF_WINDOW_HINT));
  if (selfIdx > 0) {
    const self = pages.splice(selfIdx, 1)[0];
    pages.push(self);
  } else if (selfIdx === 0 && pages.length > 1) {
    const self = pages.shift();
    pages.push(self);
  }

  log(`Reload order: ${pages.map(p => `"${p.title}"`).join(' → ')}`);

  // 3. Reload each window
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const isLast = i === pages.length - 1;
    const titleHint = page.title.split(' - ')[0].trim();

    log(`\nReloading ${i + 1}/${pages.length}: "${page.title}"`);

    try {
      await reloadTarget(page);
      log(`  Reload sent.`);
    } catch (e) {
      log(`  ERROR reloading: ${e.message}`);
      if (!isLast) continue;
      break;
    }

    if (!isLast) {
      // Wait for it to come back before proceeding
      await waitForTarget(titleHint, VERIFY_TIMEOUT_MS);
      log(`  Waiting ${RELOAD_DELAY_MS}ms before next reload...`);
      await sleep(RELOAD_DELAY_MS);
    } else {
      log(`  (last window — not waiting for verification)`);
    }
  }

  log('\n=== All windows reloaded ===');
  log('The VSIX extension will reload automatically with the new bundle.');
  process.exit(0);
}

main().catch(err => {
  log(`FATAL: ${err.message}`);
  process.exit(1);
});
