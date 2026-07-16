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
const screenshotIndex = args.indexOf('--screenshot');
const screenshotPath = screenshotIndex >= 0 && args[screenshotIndex + 1]
  ? path.resolve(args[screenshotIndex + 1])
  : null;
const cdpUrl = process.env.RAC_VERIFICATION_BROWSER_CDP || 'http://127.0.0.1:9240';

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function parseAssetVersion(url) {
  const match = String(url || '').match(/[?&]v=(build-[a-f0-9]+)/);
  return match ? match[1] : '';
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
  let screenshotCaptured = false;
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
        sessionId: document.querySelector('.session-card.active')?.dataset.sessionId || '',
        sidebarScrollTop: sidebar?.scrollTop || 0,
        transcriptScrollTop: messages?.scrollTop || 0,
        agentType: messages?.dataset.agentType || '',
      };
    });

    const candidateIds = await page.evaluate(() => (
      [...document.querySelectorAll('.session-card')]
        .filter(card => {
          const subtitle = (card.querySelector('.session-card-sub')?.textContent || '').trim();
          return /^Codex(?:\s*·|$)/.test(subtitle)
            && !/^Codex CLI\b|^Codex Desktop\b/.test(subtitle);
        })
        .map(card => card.dataset.sessionId)
        .filter(Boolean)
    ));
    assert(candidateIds.length > 0, 'no visible Codex side-pane session card is available');

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
        const nativeRows = [...document.querySelectorAll('.messages .content-block-thinking-native')];
        const genericRows = [...document.querySelectorAll('.messages .content-block-thinking')];
        return {
          agentType: root?.dataset.agentType || '',
          nativeCount: nativeRows.length,
          genericCount: genericRows.length,
          messageCount: document.querySelectorAll('.messages .message').length,
          nativeVisible: nativeRows.filter(node => {
            const rect = node.getBoundingClientRect();
            const style = getComputedStyle(node);
            return rect.width > 0 && rect.height > 0
              && style.display !== 'none' && style.visibility !== 'hidden';
          }).length,
          nativeDetails: nativeRows.filter(node => node.matches('details') || node.querySelector('details')).length,
          nativeSyntheticLabels: nativeRows.filter(node => (
            /^(Thinking|Reasoning)$/i.test((node.firstElementChild?.textContent || '').trim())
          )).length,
          computedStyles: nativeRows.slice(0, 3).map(node => {
            const style = getComputedStyle(node);
            return {
              font_style: style.fontStyle,
              border_top_width: style.borderTopWidth,
              background_color: style.backgroundColor,
            };
          }),
        };
      });
      candidates.push({ session_hash: hash(sessionId), ...state });

      const accepted = state.agentType === 'codex'
        && state.nativeVisible > 0
        && state.genericCount === 0
        && state.nativeDetails === 0
        && state.nativeSyntheticLabels === 0
        && state.computedStyles.every(style => (
          style.font_style === 'normal'
          && style.border_top_width === '0px'
          && style.background_color === 'rgba(0, 0, 0, 0)'
        ));
      if (!accepted) continue;

      if (screenshotPath) {
        fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
        await page.evaluate(() => {
          document.querySelector('.messages .content-block-thinking-native')
            ?.scrollIntoView({ block: 'center', inline: 'nearest' });
        });
        await page.waitForTimeout(100);
        await page.screenshot({ path: screenshotPath, fullPage: false });
        screenshotCaptured = true;
      }
      break;
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
        sessionId: document.querySelector('.session-card.active')?.dataset.sessionId || '',
        agentType: document.querySelector('.messages')?.dataset.agentType || '',
        assetUrl: [...document.scripts].map(script => script.src)
          .find(src => src.includes('/dist/bundle.js')) || '',
      })).catch(() => null);
    }
    await browser.close().catch(() => {});
  }

  const accepted = candidates.find(candidate => (
    candidate.agentType === 'codex'
    && candidate.nativeVisible > 0
    && candidate.genericCount === 0
    && candidate.nativeDetails === 0
    && candidate.nativeSyntheticLabels === 0
    && candidate.computedStyles.every(style => (
      style.font_style === 'normal'
      && style.border_top_width === '0px'
      && style.background_color === 'rgba(0, 0, 0, 0)'
    ))
  ));
  assert(accepted, 'no production Codex transcript proved native plain-thinking parity');
  assert(restored, 'the original production-browser selection was not restored');

  assert(finalState, 'final production-browser state could not be read after restoration');
  assert.strictEqual(hash(finalState.sessionId), hash(original.sessionId),
    'original production-browser session selection changed');
  assert.strictEqual(finalState.agentType, original.agentType,
    'original production-browser agent type changed');
  assert.strictEqual(parseAssetVersion(finalState.assetUrl), expectedAsset,
    'persistent production page is not using the exact current asset');

  const result = {
    ok: true,
    cdp: cdpUrl,
    pages: 1,
    asset_version: expectedAsset,
    original_session_hash: hash(original.sessionId),
    original_agent_type: original.agentType,
    candidates,
    accepted_session_hash: accepted.session_hash,
    restored: true,
    screenshot_captured: screenshotCaptured,
    actions: {
      pages_created: 0,
      focus_api_calls: 0,
      sends: 0,
      harness_controls: 0,
      session_selection_restored: true,
    },
    generated_at: new Date().toISOString(),
  };
  const serialized = JSON.stringify(result, null, 2) + '\n';
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, serialized, 'utf8');
  }
  process.stdout.write(serialized);
}

main().catch(error => {
  console.error('codex thinking native production e2e: FAIL (' + (error.stack || error.message || error) + ')');
  process.exit(1);
});
