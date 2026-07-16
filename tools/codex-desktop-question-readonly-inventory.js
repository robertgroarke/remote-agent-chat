#!/usr/bin/env node
'use strict';

const assert = require('assert');
const CDP = require('../agent-proxy/node_modules/chrome-remote-interface');
const selectors = require('../agent-proxy/selectors');
const { listCdpTargets, connectCdpTarget } = require('../agent-proxy/cdp-loopback');

const PORT = Number(process.env.CODEX_DESKTOP_CDP_PORT || 9225);

function canonicalTarget(target) {
  return target?.type === 'page' && /^app:\/\/-\/index\.html(?:[?#]|$)/i.test(String(target.url || ''));
}

(async () => {
  assert.deepStrictEqual(process.argv.slice(2), ['--read-only'], 'explicit --read-only is required');
  const targets = (await listCdpTargets(CDP, { port: PORT })).filter(canonicalTarget);
  assert.strictEqual(targets.length, 1, `expected one canonical Codex Desktop page, found ${targets.length}`);
  const client = await connectCdpTarget(CDP, {
    port: PORT,
    host: targets[0]._cdpHost,
    target: targets[0].id,
  });
  try {
    await client.Runtime.enable();
    const inventory = await selectors.evalInPage(client.Runtime, `
      function visible(el) {
        if (!el || !el.isConnected) return false;
        var style = getComputedStyle(el);
        var rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      }
      function clean(value, max) {
        return String(value || '').replace(/\\s+/g, ' ').trim().substring(0, max || 160);
      }
      function metadata(el) {
        return {
          tag: el.tagName || '',
          role: clean(el.getAttribute('role'), 40),
          testid: clean(el.getAttribute('data-testid'), 120),
          aria: clean(el.getAttribute('aria-label'), 160),
          title: clean(el.getAttribute('title'), 160),
          text: clean(el.innerText || el.textContent, 160),
          disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
          selected: el.getAttribute('aria-selected') === 'true' || el.getAttribute('aria-checked') === 'true'
        };
      }
      var controls = Array.from(d.querySelectorAll('button,[role="button"],[role="menuitem"],[role="option"],[role="tab"]'))
        .filter(visible).map(metadata)
        .filter(function(item) { return item.testid || item.aria || item.title || item.text; })
        .slice(0, 160);
      var inputs = Array.from(d.querySelectorAll('input,textarea,[contenteditable="true"]'))
        .filter(visible).map(function(el) {
          return {
            tag: el.tagName || '',
            type: clean(el.getAttribute('type'), 40),
            testid: clean(el.getAttribute('data-testid'), 120),
            aria: clean(el.getAttribute('aria-label'), 160),
            placeholder: clean(el.getAttribute('placeholder'), 160),
            secret: String(el.getAttribute('type') || '').toLowerCase() === 'password'
          };
        }).slice(0, 40);
      var containers = Array.from(d.querySelectorAll('[role="dialog"],[role="tabpanel"],[role="radiogroup"],[role="group"]'))
        .filter(visible).map(function(el) {
          return {
            role: clean(el.getAttribute('role'), 40),
            testid: clean(el.getAttribute('data-testid'), 120),
            aria: clean(el.getAttribute('aria-label'), 160)
          };
        }).slice(0, 40);
      return {
        route: String(location.pathname || '') + String(location.search || '') + String(location.hash || ''),
        visibility: d.visibilityState,
        focused: d.hasFocus(),
        controls: controls,
        inputs: inputs,
        containers: containers
      };
    `);
    console.log(JSON.stringify({
      ok: true,
      read_only: true,
      cdp_port: PORT,
      target_count: targets.length,
      transcript_content_captured: false,
      mutations: 0,
      focus_actions: 0,
      visible_windows_opened: 0,
      inventory,
    }, null, 2));
  } finally {
    await client.close();
  }
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
