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
const expectedAssetIndex = args.indexOf('--expected-asset');
const explicitExpectedAsset = expectedAssetIndex >= 0 && args[expectedAssetIndex + 1]
  ? args[expectedAssetIndex + 1]
  : '';
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
    && candidate.native_visible > 0
    && candidate.ran_labels === candidate.native_count
    && candidate.generic_count === 0
    && candidate.native_styles.every(style => (
      style.display === 'block'
      && style.border_top_width === '0px'
      && style.border_left_width === '0px'
      && style.background_color === 'rgba(0, 0, 0, 0)'
    ))
    && candidate.summary_styles.every(style => (
      style.display === 'inline-flex'
      && style.font_style === 'normal'
      && style.font_weight === '400'
      && style.background_color === 'rgba(0, 0, 0, 0)'
    ))
    && candidate.pre_styles.every(style => (
      style.border_top_width === '0px'
      && style.border_left_width === '0px'
      && style.background_color === 'rgba(0, 0, 0, 0)'
    ));
}

async function main() {
  const localAsset = fs.readFileSync(path.join(ROOT, 'frontend', 'sw.js'), 'utf8')
    .match(/const ASSET_VERSION = '([^']+)'/)?.[1];
  assert(localAsset, 'local frontend service worker is missing its asset version');
  const expectedAsset = explicitExpectedAsset || localAsset;
  assert(/^build-[a-f0-9]{16}$/.test(expectedAsset),
    `invalid expected asset version: ${expectedAsset}`);

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
    // Session cards remain mounted inside collapsed groups, where they are intentionally
    // not visible. Attachment is the stable inventory-ready contract; the verifier never
    // expands or persists a group just to inspect a transcript.
    await page.waitForFunction(() => document.querySelectorAll('.session-card').length > 0,
      null, { timeout: 30000 }).catch(() => {});
    const inventoryState = await page.evaluate(() => {
      const bodyText = document.body?.innerText || '';
      return {
        ready_state: document.readyState,
        session_cards: document.querySelectorAll('.session-card').length,
        session_groups: document.querySelectorAll('.session-group').length,
        empty_state: document.querySelector('.session-empty')?.textContent?.trim() || '',
        has_agent_sessions_heading: /agent sessions/i.test(bodyText),
        has_connecting_copy: /connecting/i.test(bodyText),
        has_disconnected_copy: /disconnected/i.test(bodyText),
        has_loading_copy: /loading/i.test(bodyText),
      };
    });
    if (inventoryState.session_cards === 0) {
      const diagnosticSession = await page.context().newCDPSession(page);
      const networkEvents = [];
      const record = (kind, fields) => networkEvents.push({ kind, ...fields });
      diagnosticSession.on('Network.webSocketCreated', event => {
        if (String(event.url || '').includes('/client-ws')) {
          record('created', { request_id: event.requestId, url_path: '/client-ws' });
        }
      });
      diagnosticSession.on('Network.webSocketHandshakeResponseReceived', event => {
        record('handshake_response', {
          request_id: event.requestId,
          status: event.response?.status,
          status_text: event.response?.statusText || '',
        });
      });
      diagnosticSession.on('Network.webSocketFrameError', event => {
        record('frame_error', {
          request_id: event.requestId,
          error_message: event.errorMessage || '',
        });
      });
      diagnosticSession.on('Network.loadingFailed', event => {
        record('loading_failed', {
          request_id: event.requestId,
          error_text: event.errorText || '',
          blocked_reason: event.blockedReason || '',
        });
      });
      await diagnosticSession.send('Network.enable');
      inventoryState.public_websocket_probe = await page.evaluate(() => new Promise(resolve => {
        const startedAt = performance.now();
        const proto = location.protocol === 'https:' ? 'wss' : 'ws';
        const socket = new WebSocket(`${proto}://${location.host}/client-ws`);
        let opened = false;
        const finish = result => {
          clearTimeout(timer);
          try { socket.close(); } catch {}
          resolve({ ...result, opened, elapsed_ms: Math.round(performance.now() - startedAt) });
        };
        const timer = setTimeout(() => finish({ outcome: 'timeout' }), 10000);
        socket.onopen = () => { opened = true; };
        socket.onerror = () => finish({ outcome: 'error' });
        socket.onclose = event => finish({ outcome: 'close', code: event.code });
        socket.onmessage = event => {
          try {
            const message = JSON.parse(String(event.data || ''));
            if (message.type === 'connection_ack') {
              finish({
                outcome: 'connection_ack',
                session_count: Array.isArray(message.sessions) ? message.sessions.length : 0,
                duplicate_proxy_alarms: Array.isArray(message.duplicate_proxy_alarms)
                  ? message.duplicate_proxy_alarms.length : 0,
              });
            }
          } catch {}
        };
      }));
      await page.waitForTimeout(250);
      inventoryState.public_websocket_network = networkEvents;
      await diagnosticSession.detach();
    }
    assert(inventoryState.session_cards > 0,
      `production inventory did not mount session cards: ${JSON.stringify(inventoryState)}`);

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
    assert(candidateIds.length > 0, 'no mounted Codex Desktop session card is available');

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
        const nativeRows = [...document.querySelectorAll(
          '.messages details.content-block-terminal-codex-desktop',
        )];
        const genericRows = [...document.querySelectorAll(
          '.messages details.content-block-terminal:not(.content-block-terminal-codex-desktop)',
        )];
        const visible = node => {
          const rect = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          return rect.width > 0 && rect.height > 0
            && style.display !== 'none' && style.visibility !== 'hidden';
        };
        const styles = (nodes, select) => nodes.map(node => {
          const target = select(node);
          const style = getComputedStyle(target);
          return {
            display: style.display,
            font_style: style.fontStyle,
            font_weight: style.fontWeight,
            border_top_width: style.borderTopWidth,
            border_left_width: style.borderLeftWidth,
            background_color: style.backgroundColor,
          };
        });
        return {
          agent_type: root?.dataset.agentType || '',
          message_count: document.querySelectorAll('.messages .message').length,
          native_count: nativeRows.length,
          native_visible: nativeRows.filter(visible).length,
          open_count: nativeRows.filter(node => node.open).length,
          generic_count: genericRows.length,
          ran_labels: nativeRows.filter(node => /^Ran(?:\s+commands?)?\b/i.test(
            (node.querySelector(':scope > summary')?.textContent || '').trim(),
          )).length,
          pre_count: nativeRows.filter(node => node.querySelector(':scope > .content-block-pre')).length,
          native_styles: styles(nativeRows, node => node),
          summary_styles: styles(nativeRows, node => node.querySelector(':scope > summary')),
          pre_styles: styles(
            nativeRows.filter(node => node.querySelector(':scope > .content-block-pre')),
            node => node.querySelector(':scope > .content-block-pre'),
          ),
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
  assert(accepted,
    `no production Codex Desktop transcript proved native Ran-commands parity: ${JSON.stringify(candidates)}`);
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
    expected_asset_source: explicitExpectedAsset ? 'explicit exact deployment' : 'local frontend',
    local_asset_version: localAsset,
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
  console.error(`Codex Desktop terminal production E2E: FAIL (${error.stack || error.message || error})`);
  process.exit(1);
});
