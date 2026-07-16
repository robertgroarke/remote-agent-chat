#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { chromium } = require('../frontend/node_modules/playwright-core');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
const outputPath = outputIndex >= 0 && args[outputIndex + 1]
  ? path.resolve(args[outputIndex + 1])
  : null;
const cdpUrl = process.env.RAC_VERIFICATION_BROWSER_CDP || 'http://127.0.0.1:9240';

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function parseAssetVersion(url) {
  const match = String(url || '').match(/[?&]v=(build-[a-f0-9]+)/);
  return match ? match[1] : '';
}

function isAccepted(candidate) {
  return candidate.agent_type === 'codex-desktop'
    && candidate.flat_visible > 0
    && candidate.worked_labels === candidate.flat_count
    && candidate.chevrons === candidate.flat_count
    && candidate.generic_count === 0
    && candidate.flat_styles.every(style => (
      style.display === 'flex'
      && style.font_style === 'normal'
      && style.border_top_width === '0px'
      && style.border_left_width === '0px'
      && style.background_color === 'rgba(0, 0, 0, 0)'
    ));
}

async function main() {
  const expectedAsset = fs.readFileSync(path.join(ROOT, 'frontend', 'sw.js'), 'utf8')
    .match(/const ASSET_VERSION = '([^']+)'/)?.[1];
  assert(expectedAsset, 'local frontend service worker is missing its asset version');

  const browser = await chromium.connectOverCDP(cdpUrl);
  let page;
  let original = null;
  let restored = false;
  let finalState = null;
  const candidates = [];
  try {
    const pages = browser.contexts().flatMap(context => context.pages());
    assert.strictEqual(pages.length, 1,
      `expected exactly one persistent verification page, found ${pages.length}`);
    page = pages[0];
    await page.waitForSelector('.session-card', { timeout: 15000 });

    original = await page.evaluate(() => {
      const sidebar = document.querySelector('.sidebar-session-list') || document.querySelector('.sidebar');
      const messages = document.querySelector('.messages');
      return {
        url: location.href,
        visibility: document.visibilityState,
        hasFocus: document.hasFocus(),
        sessionId: document.querySelector('.session-card.active')?.dataset.sessionId || '',
        sidebarScrollTop: sidebar?.scrollTop || 0,
        transcriptScrollTop: messages?.scrollTop || 0,
        agentType: messages?.dataset.agentType || '',
        assetUrl: [...document.scripts].map(script => script.src)
          .find(src => src.includes('/dist/bundle.js')) || '',
      };
    });
    assert(original.sessionId, 'persistent verification page has no selected session');
    assert.strictEqual(parseAssetVersion(original.assetUrl), expectedAsset,
      'persistent production page is not using the exact current asset');

    const candidateIds = await page.evaluate(() => (
      [...document.querySelectorAll('.session-card')]
        .filter(card => {
          const subtitle = (card.querySelector('.session-card-sub')?.textContent || '').trim();
          return subtitle.startsWith('Codex Desktop');
        })
        .map(card => card.dataset.sessionId)
        .filter(Boolean)
    ));
    assert(candidateIds.length > 0, 'no visible Codex Desktop session card is available');

    for (const sessionId of candidateIds) {
      await page.evaluate(id => {
        document.querySelector(`.session-card[data-session-id="${CSS.escape(id)}"]`)?.click();
      }, sessionId);
      await page.waitForFunction(id => (
        document.querySelector('.session-card.active')?.dataset.sessionId === id
      ), sessionId, { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(1800);

      const state = await page.evaluate(() => {
        const root = document.querySelector('.messages');
        const flatRows = [...document.querySelectorAll(
          '.messages div.content-block-thinking-codex-desktop',
        )];
        const allNativeRows = [...document.querySelectorAll(
          '.messages .content-block-thinking-codex-desktop',
        )];
        const genericRows = [...document.querySelectorAll(
          '.messages .content-block-thinking',
        )];
        const visible = node => {
          const rect = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          return rect.width > 0 && rect.height > 0
            && style.display !== 'none' && style.visibility !== 'hidden';
        };
        return {
          agent_type: root?.dataset.agentType || '',
          message_count: document.querySelectorAll('.messages .message').length,
          native_count: allNativeRows.length,
          flat_count: flatRows.length,
          flat_visible: flatRows.filter(visible).length,
          disclosure_count: allNativeRows.filter(node => node.matches('details')).length,
          generic_count: genericRows.length,
          worked_labels: flatRows.filter(node => /^Worked(?:\s+for\b)?/i.test(
            (node.firstElementChild?.textContent || '').trim(),
          )).length,
          chevrons: flatRows.filter(node => (
            node.querySelector('.content-block-thinking-codex-desktop-chevron')
          )).length,
          flat_styles: flatRows.map(node => {
            const style = getComputedStyle(node);
            return {
              display: style.display,
              font_style: style.fontStyle,
              border_top_width: style.borderTopWidth,
              border_left_width: style.borderLeftWidth,
              background_color: style.backgroundColor,
            };
          }),
        };
      });
      candidates.push({ session_sha256: sha256(sessionId), ...state });
      if (isAccepted(state)) break;
    }
  } finally {
    if (page && original?.sessionId) {
      await page.evaluate(id => {
        document.querySelector(`.session-card[data-session-id="${CSS.escape(id)}"]`)?.click();
      }, original.sessionId).catch(() => {});
      await page.waitForFunction(id => (
        document.querySelector('.session-card.active')?.dataset.sessionId === id
      ), original.sessionId, { timeout: 5000 }).catch(() => {});
      await page.evaluate(({ sidebarScrollTop, transcriptScrollTop }) => {
        const sidebar = document.querySelector('.sidebar-session-list') || document.querySelector('.sidebar');
        const messages = document.querySelector('.messages');
        if (sidebar) sidebar.scrollTop = sidebarScrollTop;
        if (messages) messages.scrollTop = transcriptScrollTop;
      }, original).catch(() => {});
      restored = true;
      finalState = await page.evaluate(() => ({
        url: location.href,
        sessionId: document.querySelector('.session-card.active')?.dataset.sessionId || '',
        agentType: document.querySelector('.messages')?.dataset.agentType || '',
        assetUrl: [...document.scripts].map(script => script.src)
          .find(src => src.includes('/dist/bundle.js')) || '',
      })).catch(() => null);
    }
    await browser.close().catch(() => {});
  }

  const accepted = candidates.find(isAccepted);
  assert(accepted, 'no production Codex Desktop transcript proved native Worked-for parity');
  assert(restored, 'the original production-browser selection was not restored');
  assert(finalState, 'final production-browser state could not be read after restoration');
  assert.strictEqual(finalState.url, original.url, 'production-browser URL changed');
  assert.strictEqual(sha256(finalState.sessionId), sha256(original.sessionId),
    'original production-browser session selection changed');
  assert.strictEqual(finalState.agentType, original.agentType,
    'original production-browser agent type changed');
  assert.strictEqual(parseAssetVersion(finalState.assetUrl), expectedAsset,
    'restored production page is not using the exact current asset');

  const result = {
    ok: true,
    generated_at: new Date().toISOString(),
    cdp: cdpUrl,
    pages: 1,
    asset_version: expectedAsset,
    original_session_sha256: sha256(original.sessionId),
    original_agent_type: original.agentType,
    original_visibility: original.visibility,
    original_has_focus: original.hasFocus,
    candidates,
    accepted_session_sha256: accepted.session_sha256,
    restored: true,
    actions: {
      pages_created: 0,
      page_navigations: 0,
      page_reloads: 0,
      focus_api_calls: 0,
      sends: 0,
      harness_controls: 0,
      session_selection_restored: true,
      scroll_positions_restored: true,
      visible_windows_opened: 0,
    },
  };
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, serialized, 'utf8');
  }
  process.stdout.write(serialized);
}

main().catch(error => {
  console.error(`Codex Desktop thinking production E2E: FAIL (${error.stack || error.message || error})`);
  process.exit(1);
});
