#!/usr/bin/env node
'use strict';

process.env.VSCODE_PROBE_CDP_PORT = process.env.VSCODE_PROBE_CDP_PORT || '9230';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const CDP = require('../agent-proxy/node_modules/chrome-remote-interface');
const selectors = require('../agent-proxy/selectors');
const guard = require('../agent-proxy/vscode-probe-guard');

const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
const outputPath = outputIndex >= 0 && args[outputIndex + 1]
  ? path.resolve(args[outputIndex + 1]) : '';
const kindIndex = args.indexOf('--kind');
const requestedKind = kindIndex >= 0 && args[kindIndex + 1]
  ? String(args[kindIndex + 1]).trim() : 'all';
const supportedKinds = ['model_effort', 'model_catalog', 'access'];
assert(
  requestedKind === 'all' || supportedKinds.includes(requestedKind),
  `--kind must be one of all, ${supportedKinds.join(', ')}`,
);
const requestedKinds = requestedKind === 'all' ? supportedKinds : [requestedKind];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16);
}

function currentConfig(config) {
  return {
    model_id: String(config?.model_id || ''),
    effort: String(config?.effort || ''),
    permission_mode: String(config?.permission_mode || ''),
    approval_policy: String(config?.approval_policy || ''),
    speed: String(config?.speed || ''),
  };
}

async function pressEscape(Input) {
  await Input.dispatchKeyEvent({
    type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27,
    nativeVirtualKeyCode: 27,
  });
  await Input.dispatchKeyEvent({
    type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27,
    nativeVirtualKeyCode: 27,
  });
}

async function clickAt(Input, point) {
  assert(Number.isFinite(point?.x) && Number.isFinite(point?.y), 'trusted click coordinates are missing');
  await Input.dispatchMouseEvent({ type: 'mouseMoved', x: point.x, y: point.y });
  await Input.dispatchMouseEvent({
    type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1,
  });
  await sleep(60);
  await Input.dispatchMouseEvent({
    type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1,
  });
}

async function readWorkbenchOptionSurfaces(pageTargetId) {
  let pageClient;
  try {
    pageClient = await CDP({ port: guard.CDP_PORT, target: pageTargetId });
    await pageClient.Runtime.enable();
    const evaluated = await pageClient.Runtime.evaluate({
      expression: `(() => {
        function visible(el) {
          if (!el || !el.getBoundingClientRect) return false;
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && style.display !== 'none'
            && style.visibility !== 'hidden' && style.opacity !== '0';
        }
        function bounded(value, limit) {
          return String(value || '').replace(/\\s+/g, ' ').trim().slice(0, limit || 200);
        }
        const surfaceSelector = [
          '.quick-input-widget', '.monaco-dialog-box', '.monaco-menu-container',
          '.context-view', '[role="dialog"]', '[role="listbox"]', '[role="menu"]'
        ].join(',');
        const itemSelector = [
          '.quick-input-list .monaco-list-row', '[role="option"]', '[role="menuitem"]',
          '[role="radio"]', '[aria-checked]'
        ].join(',');
        const surfaces = Array.from(document.querySelectorAll(surfaceSelector)).filter(visible).map(node => ({
          tag: bounded(node.tagName, 20).toLowerCase(),
          class_name: bounded(node.className, 200),
          role: bounded(node.getAttribute('role'), 40),
          aria_label: bounded(node.getAttribute('aria-label'), 160),
          text: bounded(node.innerText || node.textContent, 800),
        }));
        const items = Array.from(document.querySelectorAll(itemSelector)).filter(visible).map(node => ({
          tag: bounded(node.tagName, 20).toLowerCase(),
          role: bounded(node.getAttribute('role'), 40),
          aria_label: bounded(node.getAttribute('aria-label'), 240),
          aria_checked: bounded(node.getAttribute('aria-checked'), 20),
          aria_selected: bounded(node.getAttribute('aria-selected'), 20),
          text: bounded(node.innerText || node.textContent, 240),
        }));
        return { surfaces: surfaces.slice(0, 12), items: items.slice(0, 80) };
      })()`,
      returnByValue: true,
      silent: true,
      userGesture: false,
    });
    if (evaluated.exceptionDetails) throw new Error('workbench option-surface evaluation failed');
    return evaluated.result?.value || { surfaces: [], items: [] };
  } finally {
    await pageClient?.close().catch(() => {});
  }
}

async function main() {
  guard.assertUpdatesDisabled('VS Code Codex disposable menu inventory');
  assert.strictEqual(guard.CDP_PORT, 9230, 'Codex menu inventory is restricted to disposable port 9230');
  const protectedBefore = (await CDP.List({ port: 9223 })).map(target => hash(target.id)).sort();
  const picked = guard.assertTargetSet(await CDP.List({ port: guard.CDP_PORT }), 'codex', 'Codex menu inventory');
  let client;
  try {
    client = await CDP({ port: guard.CDP_PORT, target: picked.frame.id });
    await client.Runtime.enable();
    client.Runtime._webviewId = (String(picked.frame.url || '').match(/[?&]id=([0-9a-f-]+)/i) || [])[1] || '';
    await selectors.cacheInnerContextId(client.Runtime);
    const before = currentConfig(await selectors.readAgentConfig(client.Runtime, 'codex', ''));
    const menus = [];

    for (const kind of requestedKinds) {
      const opened = await selectors.evalInFrame(client.Runtime, `
        function visible(el) {
          if (!el || !el.getBoundingClientRect) return false;
          var rect = el.getBoundingClientRect();
          var style = window.getComputedStyle ? window.getComputedStyle(el) : null;
          return rect.width > 0 && rect.height > 0 && (!style || (
            style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0'
          ));
        }
        function text(el) { return String(el && (el.innerText || el.textContent) || '').replace(/\\s+/g, ' ').trim(); }
        var composer = Array.from(d.querySelectorAll('.ProseMirror')).find(visible);
        if (!composer) return { ok: false, code: 'composer-missing' };
        var root = composer.parentElement;
        for (var depth = 0; root && depth < 8; depth += 1) {
          var rect = root.getBoundingClientRect();
          var buttons = Array.from(root.querySelectorAll('button')).filter(visible);
          if (buttons.length >= 2 && buttons.length <= 20 && rect.height <= 360) break;
          root = root.parentElement;
        }
        var buttons = root ? Array.from(root.querySelectorAll('button')).filter(visible) : [];
        var kind = ${JSON.stringify(kind)};
        var matches = kind === 'model_effort' || kind === 'model_catalog'
          ? buttons.filter(function(button) { return button.getAttribute('aria-haspopup') === 'menu'; })
          : buttons.filter(function(button) {
              var value = text(button);
              return /^(?:Custom|Full access|Read access|Read only|Workspace(?: write)?|Agent|Chat)$/i.test(value);
            });
        if (matches.length !== 1) {
          return { ok: false, code: 'trigger-count', count: matches.length, button_texts: buttons.map(text).slice(0, 20) };
        }
        var trigger = matches[0];
        var value = text(trigger).slice(0, 120);
        var bounds = trigger.getBoundingClientRect();
        return {
          ok: true,
          trigger_text: value,
          aria_haspopup: String(trigger.getAttribute('aria-haspopup') || ''),
          aria_label: String(trigger.getAttribute('aria-label') || '').slice(0, 160),
          title: String(trigger.getAttribute('title') || '').slice(0, 160),
          data_state: String(trigger.getAttribute('data-state') || '').slice(0, 80),
          descendant_text: Array.from(trigger.querySelectorAll('*')).slice(0, 30).map(function(node) {
            var rect = node.getBoundingClientRect();
            return {
              tag: String(node.tagName || '').toLowerCase(),
              text: text(node).slice(0, 120),
              aria_label: String(node.getAttribute('aria-label') || '').slice(0, 120),
              visible: rect.width > 0 && rect.height > 0
            };
          }).filter(function(item) { return item.text || item.aria_label; }),
          x: bounds.left + bounds.width / 2,
          y: bounds.top + bounds.height / 2
        };
      `);
      assert(opened?.ok, `${kind} trigger failed: ${JSON.stringify(opened)}`);
      await clickAt(client.Input, opened);
      await sleep(250);
      const inventory = await selectors.evalInFrame(client.Runtime, `
        function visible(el) {
          if (!el || !el.getBoundingClientRect) return false;
          var rect = el.getBoundingClientRect();
          var style = window.getComputedStyle ? window.getComputedStyle(el) : null;
          return rect.width > 0 && rect.height > 0 && (!style || (
            style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0'
          ));
        }
        function bounded(value, limit) {
          return String(value || '').replace(/\\s+/g, ' ').trim().slice(0, limit || 160);
        }
        var composer = Array.from(d.querySelectorAll('.ProseMirror')).find(visible);
        var root = composer ? composer.parentElement : null;
        for (var depth = 0; root && depth < 8; depth += 1) {
          var rect = root.getBoundingClientRect();
          var buttons = Array.from(root.querySelectorAll('button')).filter(visible);
          if (buttons.length >= 2 && buttons.length <= 20 && rect.height <= 360) break;
          root = root.parentElement;
        }
        var selector = [
          '[role="menuitem"]', '[role="menuitemradio"]', '[role="menuitemcheckbox"]',
          '[role="option"]', '[role="radio"]', '[data-radix-collection-item]',
          '[cmdk-item]', '[aria-checked]', 'button'
        ].join(',');
        var candidates = Array.from(d.querySelectorAll(selector)).filter(function(node) {
          if (!visible(node)) return false;
          var role = String(node.getAttribute('role') || '');
          return role || !root || !root.contains(node);
        });
        var seen = new Set();
        var items = [];
        candidates.forEach(function(node) {
          var value = bounded(node.innerText || node.textContent, 160);
          var role = bounded(node.getAttribute('role'), 40);
          var label = bounded(node.getAttribute('aria-label'), 160);
          var key = [node.tagName, role, value, label].join('|');
          if ((!value && !label) || seen.has(key)) return;
          seen.add(key);
          items.push({
            tag: bounded(node.tagName, 20).toLowerCase(),
            role: role,
            text: value,
            aria_label: label,
            aria_checked: bounded(node.getAttribute('aria-checked'), 20),
            aria_selected: bounded(node.getAttribute('aria-selected'), 20),
            aria_haspopup: bounded(node.getAttribute('aria-haspopup'), 40),
            data_state: bounded(node.getAttribute('data-state'), 40),
            data_value: bounded(node.getAttribute('data-value'), 120),
            tab_index: bounded(node.getAttribute('tabindex'), 20),
            class_name: bounded(node.className, 240),
            child_tags: Array.from(node.children || []).slice(0, 12).map(function(child) {
              return {
                tag: bounded(child.tagName, 20).toLowerCase(),
                class_name: bounded(child.className && child.className.baseVal || child.className, 160),
                aria_label: bounded(child.getAttribute && child.getAttribute('aria-label'), 120),
                data_slot: bounded(child.getAttribute && child.getAttribute('data-slot'), 80)
              };
            }),
            descendant_icons: Array.from(node.querySelectorAll('svg')).slice(0, 8).map(function(icon) {
              return {
                class_name: bounded(icon.className && icon.className.baseVal || icon.className, 160),
                aria_label: bounded(icon.getAttribute('aria-label'), 120),
                data_slot: bounded(icon.getAttribute('data-slot'), 80),
                path_count: icon.querySelectorAll('path').length
              };
            }),
            disabled: !!node.disabled || node.getAttribute('aria-disabled') === 'true'
          });
        });
        var surfaces = Array.from(d.querySelectorAll('[role="menu"], [role="listbox"], [role="dialog"]'))
          .filter(visible).map(function(node) {
            return {
              role: bounded(node.getAttribute('role'), 40),
              aria_label: bounded(node.getAttribute('aria-label'), 160),
              text: bounded(node.innerText || node.textContent, 600)
            };
          });
        return { items: items.slice(0, 80), surfaces: surfaces.slice(0, 10) };
      `);
      let submenu = null;
      if (kind === 'model_catalog') {
        const modelEntry = await selectors.evalInFrame(client.Runtime, `
          function visible(el) {
            if (!el || !el.getBoundingClientRect) return false;
            var rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          }
          function norm(value) { return String(value || '').replace(/\\s+/g, ' ').trim(); }
          var matches = Array.from(d.querySelectorAll('[role="menuitem"]')).filter(function(node) {
            return visible(node) && /^GPT[-\\s.]?\\d/i.test(norm(node.innerText || node.textContent));
          });
          if (matches.length !== 1) return { ok: false, count: matches.length };
          var rect = matches[0].getBoundingClientRect();
          return { ok: true, label: norm(matches[0].innerText || matches[0].textContent), x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        `);
        assert(modelEntry?.ok, `model submenu entry failed: ${JSON.stringify(modelEntry)}`);
        await clickAt(client.Input, modelEntry);
        await sleep(250);
        submenu = await selectors.evalInFrame(client.Runtime, `
          function visible(el) {
            if (!el || !el.getBoundingClientRect) return false;
            var rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          }
          function bounded(value, limit) { return String(value || '').replace(/\\s+/g, ' ').trim().slice(0, limit || 200); }
          var items = Array.from(d.querySelectorAll('[role="menuitem"], [role="option"]')).filter(visible).map(function(node) {
            return {
              text: bounded(node.innerText || node.textContent, 240),
              role: bounded(node.getAttribute('role'), 40),
              disabled: node.getAttribute('aria-disabled') === 'true',
              svg_count: node.querySelectorAll('svg').length
            };
          });
          var surfaces = Array.from(d.querySelectorAll('[role="menu"], [role="listbox"]')).filter(visible).map(function(node) {
            return { role: bounded(node.getAttribute('role'), 40), text: bounded(node.innerText || node.textContent, 800) };
          });
          return { entry: ${JSON.stringify(modelEntry.label)}, items: items.slice(0, 80), surfaces: surfaces.slice(0, 12) };
        `);
        assert((submenu?.items?.length || 0) > 0, 'model submenu did not expose options');
      }
      const workbenchInventory = kind === 'access'
        ? await readWorkbenchOptionSurfaces(picked.page.id)
        : { items: [], surfaces: [] };
      assert(
        (inventory?.items?.length || 0) > 2 || (inventory?.surfaces?.length || 0) > 0
          || (workbenchInventory?.items?.length || 0) > 0
          || (workbenchInventory?.surfaces?.length || 0) > 0,
        `${kind} trusted click did not expose a native option surface`,
      );
      delete opened.x;
      delete opened.y;
      menus.push({ kind, trigger: opened, ...inventory, submenu, workbench: workbenchInventory });
      await pressEscape(client.Input);
      await sleep(100);
    }

    const after = currentConfig(await selectors.readAgentConfig(client.Runtime, 'codex', ''));
    assert.deepStrictEqual(after, before, 'Menu inventory changed disposable Codex config');
    const protectedAfter = (await CDP.List({ port: 9223 })).map(target => hash(target.id)).sort();
    assert.deepStrictEqual(protectedAfter, protectedBefore, 'Protected 9223 target set changed during menu inventory');
    const result = {
      ok: true,
      generated_at: new Date().toISOString(),
      port: guard.CDP_PORT,
      requested_kind: requestedKind,
      frame_hash: hash(picked.frame.id),
      config_before: before,
      config_after: after,
      config_unchanged: true,
      menus,
      protected_target_set_unchanged: true,
      menu_open_clicks: menus.length,
      escape_key_closes: menus.length,
      option_selections: 0,
      sends: 0,
      permission_actions: 0,
      page_reloads: 0,
      focus_actions: 0,
      visible_windows_opened: 0,
    };
    const serialized = `${JSON.stringify(result, null, 2)}\n`;
    if (outputPath) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, serialized, 'utf8');
    }
    process.stdout.write(serialized);
  } finally {
    await client?.close().catch(() => {});
  }
}

main().catch(error => {
  console.error(`VS Code Codex disposable menu inventory: FAIL (${error.stack || error.message})`);
  process.exit(1);
});
