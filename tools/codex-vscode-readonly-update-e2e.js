#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const CDP = require('../agent-proxy/node_modules/chrome-remote-interface');
const selectors = require('../agent-proxy/selectors');
const { collectAppVersions } = require('./app-version-inventory');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_PORT = 9223;

function parseArgs(argv) {
  const options = { readOnly: false, output: '', port: DEFAULT_PORT };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--read-only') options.readOnly = true;
    else if (arg === '--output' && argv[index + 1]) options.output = path.resolve(argv[++index]);
    else if (arg === '--port' && argv[index + 1]) options.port = Number(argv[++index]);
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  assert(options.readOnly, 'Codex VS Code update validation requires explicit --read-only');
  assert(Number.isInteger(options.port) && options.port > 0 && options.port <= 65535, '--port must be valid');
  return options;
}

function targetHash(targetId) {
  return crypto.createHash('sha256').update(String(targetId || '')).digest('hex').slice(0, 16);
}

function isCodexFrame(target) {
  return target?.type === 'iframe'
    && /[?&]extensionId=openai\.chatgpt(?:&|$)/i.test(String(target.url || ''));
}

function boundedScalar(value, limit = 120) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

function configInventory(config) {
  const value = config && typeof config === 'object' ? config : {};
  const list = key => Array.isArray(value[key])
    ? value[key].slice(0, 32).map(item => {
        if (typeof item === 'string') return { value: boundedScalar(item) };
        return {
          value: boundedScalar(item?.id || item?.value),
          label: boundedScalar(item?.label || item?.name),
          available: item?.available !== false,
        };
      }).filter(item => item.value)
    : [];
  return {
    model_id: boundedScalar(value.model_id),
    effort: boundedScalar(value.effort),
    permission_mode: boundedScalar(value.permission_mode),
    approval_policy: boundedScalar(value.approval_policy),
    speed: boundedScalar(value.speed),
    observed_at: boundedScalar(value.observed_at),
    provenance: boundedScalar(value.provenance || value.source),
    reported_catalogs: {
      models: list('available_models'),
      efforts: list('available_efforts'),
      permission_modes: list('available_permission_modes'),
      approval_policies: list('available_approval_policies'),
    },
  };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const targets = await CDP.List({ port: options.port });
  const frames = targets.filter(isCodexFrame);
  assert(frames.length > 0, `No Codex extension iframe found on CDP ${options.port}`);

  const probes = [];
  for (const frame of frames) {
    let client;
    try {
      client = await CDP({ port: options.port, target: frame.id });
      await client.Runtime.enable();
      client.Runtime._webviewId = (String(frame.url || '').match(/[?&]id=([0-9a-f-]+)/i) || [])[1] || '';
      await selectors.cacheInnerContextId(client.Runtime);
      const raw = await selectors.evalInFrame(client.Runtime, `
        function visible(el) {
          if (!el || !el.getBoundingClientRect) return false;
          var rect = el.getBoundingClientRect();
          var style = window.getComputedStyle ? window.getComputedStyle(el) : null;
          return rect.width > 0 && rect.height > 0 && (!style || (
            style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0'
          ));
        }
        var composers = Array.from(d.querySelectorAll('.ProseMirror')).filter(visible);
        var conversations = d.querySelectorAll('[data-thread-find-target="conversation"], [data-testid*="conversation"]');
        var composer = composers[0] || null;
        var controlRoot = composer ? composer.parentElement : null;
        for (var depth = 0; controlRoot && depth < 8; depth += 1) {
          var rootRect = controlRoot.getBoundingClientRect();
          var rootButtons = Array.from(controlRoot.querySelectorAll('button')).filter(visible);
          if (rootButtons.length >= 2 && rootButtons.length <= 20 && rootRect.height <= 360) break;
          controlRoot = controlRoot.parentElement;
        }
        var controls = controlRoot ? Array.from(controlRoot.querySelectorAll('button')).filter(visible) : [];
        function bounded(value, limit) {
          return String(value || '').replace(/\\s+/g, ' ').trim().slice(0, limit || 120);
        }
        return JSON.stringify({
          ready_state: d.readyState,
          has_body: !!d.body,
          composer_count: composers.length,
          conversation_root_count: conversations.length,
          visible_button_count: Array.from(d.querySelectorAll('button')).filter(visible).length,
          composer_controls: controls.slice(0, 20).map(function(button, ordinal) {
            return {
              ordinal: ordinal,
              tag: bounded(button.tagName, 20).toLowerCase(),
              test_id: bounded(button.getAttribute('data-testid'), 120),
              role: bounded(button.getAttribute('role') || button.role, 40),
              aria_label: bounded(button.getAttribute('aria-label'), 120),
              aria_haspopup: bounded(button.getAttribute('aria-haspopup'), 40),
              aria_expanded: bounded(button.getAttribute('aria-expanded'), 20),
              disabled: !!button.disabled || button.getAttribute('aria-disabled') === 'true',
              text: bounded(button.innerText || button.textContent, 80)
            };
          })
        });
      `);
      const dom = raw ? JSON.parse(raw) : null;
      const config = await selectors.readAgentConfig(client.Runtime, 'codex', '');
      probes.push({
        target_hash: targetHash(frame.id),
        readable: !!(dom?.has_body && ['interactive', 'complete'].includes(dom.ready_state)),
        composer_present: Number(dom?.composer_count || 0) > 0,
        conversation_surface_present: Number(dom?.conversation_root_count || 0) > 0,
        visible_controls_present: Number(dom?.visible_button_count || 0) > 0,
        composer_controls: Array.isArray(dom?.composer_controls) ? dom.composer_controls : [],
        config_shape_readable: !!(config && typeof config.model_id === 'string'
          && typeof config.permission_mode === 'string'),
        current_config: configInventory(config),
      });
    } finally {
      await client?.close().catch(() => {});
    }
  }

  assert(probes.every(probe => probe.readable), 'At least one Codex iframe DOM was unreadable');
  assert(probes.some(probe => probe.composer_present || probe.conversation_surface_present),
    'Updated Codex frames expose neither a composer nor conversation surface');
  assert(probes.some(probe => probe.config_shape_readable), 'Updated Codex config shape was unreadable');
  const result = {
    ok: true,
    generated_at: new Date().toISOString(),
    harness: 'codex',
    app_version: collectAppVersions().codex,
    cdp_port: options.port,
    target_count: frames.length,
    readable_target_count: probes.filter(probe => probe.readable).length,
    composer_or_conversation_target_count: probes.filter(probe => (
      probe.composer_present || probe.conversation_surface_present
    )).length,
    config_shape_target_count: probes.filter(probe => probe.config_shape_readable).length,
    targets: probes,
    read_only: true,
    transcript_content_captured: false,
    sends: 0,
    controls: 0,
    page_reloads: 0,
    focus_actions: 0,
    visible_windows_opened: 0,
  };
  if (options.output) {
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (require.main === module) {
  main().catch(error => {
    console.error(`Codex VS Code read-only update E2E: FAIL (${error.stack || error.message})`);
    process.exitCode = 1;
  });
}

module.exports = { isCodexFrame, main, parseArgs, targetHash };
