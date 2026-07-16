#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('../frontend/node_modules/playwright-core');
const fidelity = require('./run-fidelity-regression');
const {
  createProductionLoopbackProxy,
  findChrome,
} = require('./mobile-cold-load-production-e2e');

const ROOT = path.resolve(__dirname, '..');

function valueAfter(argv, flag) {
  const index = argv.indexOf(flag);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : '';
}

async function main(argv = process.argv.slice(2)) {
  const deployEnv = fidelity.loadEnvFile(path.join(ROOT, '.env'));
  const relayEnv = fidelity.loadEnvFile(path.join(ROOT, 'relay-server', '.env'));
  const proxyEnv = fidelity.loadEnvFile(path.join(ROOT, 'agent-proxy', '.env'));
  const upstreamUrl = fidelity.deriveRelayBaseUrl(null, relayEnv, proxyEnv);
  const publicOrigin = new URL(relayEnv.PUBLIC_URL).origin;
  const token = fidelity.buildBearerToken(relayEnv);
  const outputValue = valueAfter(argv, '--output');
  const outputPath = outputValue ? path.resolve(outputValue) : '';
  assert(upstreamUrl?.startsWith('http://'), 'configured production LAN relay URL is required');
  assert(token, 'JWT bearer token could not be built');

  const loopback = await createProductionLoopbackProxy(upstreamUrl, publicOrigin, token);
  const browser = await chromium.launch({
    executablePath: findChrome(),
    headless: true,
    args: ['--disable-gpu', '--no-first-run', '--disable-background-networking'],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const response = await page.goto(loopback.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    assert.equal(response?.status(), 200, 'production app did not load');
    await page.waitForFunction(() => (
      document.querySelectorAll('.session-card').length >= 50
      && document.querySelector('.sidebar-footer')?.textContent?.includes('Relay connected')
    ), null, { timeout: 45000 });
    const cards = page.locator('.session-card');
    const cardCount = await cards.count();
    let continueCard = null;
    let continueSubtitle = '';
    for (let index = 0; index < cardCount; index += 1) {
      const card = cards.nth(index);
      const subtitle = await card.locator('.session-card-sub').innerText().catch(() => '');
      if (/^Continue(?:\s|·|$)/i.test(subtitle.trim())) {
        continueCard = card;
        continueSubtitle = subtitle.trim();
        break;
      }
    }
    assert(continueCard, `no Continue card found among ${cardCount} production sessions`);
    await page.evaluate(() => {
      window.__racThemeSwitch = { started: performance.now(), completed: null };
      const observer = new MutationObserver(() => {
        if (/^continue(?:_yolo)?$/.test(document.querySelector('.messages')?.dataset?.agentType || '')) {
          window.__racThemeSwitch.completed ??= performance.now();
          observer.disconnect();
        }
      });
      observer.observe(document.documentElement, { attributes: true, childList: true, subtree: true });
    });
    await continueCard.click();
    await page.waitForFunction(() => /^continue(?:_yolo)?$/.test(document.querySelector('.messages')?.dataset?.agentType || ''), null, { timeout: 15000 });
    const themeSwitchMs = await page.evaluate(() => Number((
      (window.__racThemeSwitch?.completed || performance.now())
      - window.__racThemeSwitch.started
    ).toFixed(2)));
    assert(themeSwitchMs <= 250, `Continue theme switch took ${themeSwitchMs} ms (target <=250 ms)`);
    const themeRoot = page.locator('.messages[data-agent-type^="continue"]');
    const selectedAgentType = await themeRoot.getAttribute('data-agent-type');
    const computed = await themeRoot.evaluate(root => {
      const style = getComputedStyle(root);
      const sample = root.querySelector('.message-body, .user-text, .content-block-markdown');
      const sampleStyle = sample ? getComputedStyle(sample) : null;
      return {
        body_font: style.getPropertyValue('--harness-body-font').trim(),
        body_size: style.getPropertyValue('--harness-body-size').trim(),
        body_line: style.getPropertyValue('--harness-body-line').trim(),
        code_size: style.getPropertyValue('--harness-code-size').trim(),
        code_line: style.getPropertyValue('--harness-code-line').trim(),
        code_radius: style.getPropertyValue('--harness-code-radius').trim(),
        sample_font_size: sampleStyle?.fontSize || null,
        sample_line_height: sampleStyle?.lineHeight || null,
      };
    });
    assert.equal(computed.body_size, '14px');
    assert.equal(computed.body_line, '21px');
    assert.equal(computed.code_size, '14px');
    assert.equal(computed.code_line, '21px');
    assert.equal(computed.code_radius, '0');
    if (computed.sample_font_size) assert.equal(computed.sample_font_size, '14px');
    if (computed.sample_line_height) assert.equal(computed.sample_line_height, '21px');

    const result = {
      ok: true,
      generated_at: new Date().toISOString(),
      public_origin: publicOrigin,
      production_lan_origin: new URL(upstreamUrl).origin,
      session_cards: cardCount,
      selected_agent_type: selectedAgentType,
      selected_subtitle: continueSubtitle,
      theme_switch_ms: themeSwitchMs,
      theme_switch_target_ms: 250,
      computed,
    };
    const serialized = `${JSON.stringify(result, null, 2)}\n`;
    if (outputPath) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, serialized, 'utf8');
    }
    process.stdout.write(serialized);
    return result;
  } finally {
    await browser.close();
    await loopback.close();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Continue production theme E2E: FAIL (${error.stack || error.message})`);
    process.exitCode = 1;
  });
}

module.exports = { main };
