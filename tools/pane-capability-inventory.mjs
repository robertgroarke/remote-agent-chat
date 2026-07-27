#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  PANE_CLOSED,
  PANE_DEFINITIONS,
  PANE_MINIMIZED,
  PANE_OPEN,
  createPaneLifecycleLedger,
  paneRecord,
  transitionPaneLifecycle,
} from '../frontend/pane-lifecycle.js';

const require = createRequire(import.meta.url);
const { ProxyEngine } = require('../agent-proxy/proxy-engine');
const { BROADCAST_SEND_AGENT_TYPES } = require('../relay-server/broadcast-send-policy');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB_SOURCE_PATH = path.join(ROOT, 'frontend', 'app.jsx');
const ANDROID_SOURCE_ROOTS = [
  path.join(ROOT, 'android-app', 'screens'),
  path.join(ROOT, 'android-app', 'components'),
];
const CONFIG_CAPABILITIES = Object.freeze([
  'set_model',
  'set_mode',
  'permission_mode_change',
  'auto_approve_permissions_toggle',
  'set_codex_config',
  'codex_model_change',
  'codex_effort_change',
  'codex_access_change',
  'codex_speed_change',
  'codex_permission_profile_change',
  'codex_bypass_permissions',
  'set_effort',
  'switch_workspace',
]);

function walkFiles(root, suffix = '.jsx') {
  const rows = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) rows.push(...walkFiles(absolute, suffix));
    else if (entry.isFile() && entry.name.endsWith(suffix)) rows.push(absolute);
  }
  return rows.sort();
}

function sourceBundle(paths) {
  return paths.map(absolute => (
    `\n/* SOURCE ${path.relative(ROOT, absolute).replace(/\\/g, '/')} */\n`
    + fs.readFileSync(absolute, 'utf8')
  )).join('');
}

function captures(source, pattern, projection = value => value) {
  const values = new Set();
  for (const match of source.matchAll(pattern)) values.add(projection(match[1]));
  return values;
}

function union(...sets) {
  return new Set(sets.flatMap(set => [...set]));
}

function buildCapabilities(agentType) {
  return ProxyEngine.prototype._buildCapabilities.call({
    _isGitWorkspace: () => true,
  }, agentType, ROOT);
}

function capabilityDecision(definition, agentType, capabilities) {
  const expression = String(definition.capability || 'always');
  if (expression === 'always') return { applicable: true, reason: 'unconditional surface' };
  if (expression === 'broadcast_send') {
    const applicable = BROADCAST_SEND_AGENT_TYPES.has(agentType);
    return {
      applicable,
      reason: applicable
        ? 'agent type is in BROADCAST_SEND_AGENT_TYPES'
        : 'agent type is absent from BROADCAST_SEND_AGENT_TYPES',
    };
  }
  if (expression === 'agent_config') {
    const enabled = CONFIG_CAPABILITIES.filter(key => capabilities[key] === true);
    return {
      applicable: enabled.length > 0,
      reason: enabled.length > 0
        ? `enabled config capabilities: ${enabled.join(', ')}`
        : 'no advertised agent-configuration capability',
    };
  }
  if (expression.startsWith('agent:')) {
    const requiredAgentType = expression.slice('agent:'.length);
    return {
      applicable: agentType === requiredAgentType,
      reason: agentType === requiredAgentType
        ? `agent type equals ${requiredAgentType}`
        : `surface is specific to ${requiredAgentType}`,
    };
  }
  const keys = expression.split('|').map(value => value.trim()).filter(Boolean);
  const enabled = keys.filter(key => capabilities[key] === true);
  return {
    applicable: enabled.length > 0,
    reason: enabled.length > 0
      ? `advertised capability: ${enabled.join(' | ')}`
      : `capabilities disabled: ${keys.join(' | ')}`,
  };
}

function exerciseLifecycle(agentType, definition) {
  const sessionId = `inventory:${agentType}`;
  const payload = {
    agent_type: agentType,
    pane_id: definition.id,
    scroll_anchor: 37,
    draft: 'retained',
    filter: 'all',
    selection: 'fixture-row',
    expanded: true,
  };
  let ledger = createPaneLifecycleLedger();
  ledger = transitionPaneLifecycle(ledger, {
    session_id: sessionId,
    pane_id: definition.id,
    action: 'open',
    payload,
  });
  assert.equal(paneRecord(ledger, sessionId, definition.id).state, PANE_OPEN);
  ledger = transitionPaneLifecycle(ledger, {
    session_id: sessionId,
    pane_id: definition.id,
    action: 'minimize',
  });
  let record = paneRecord(ledger, sessionId, definition.id);
  assert.equal(record.state, PANE_MINIMIZED);
  assert.deepEqual(record.payload, payload);
  ledger = transitionPaneLifecycle(ledger, {
    session_id: sessionId,
    pane_id: definition.id,
    action: 'restore',
  });
  record = paneRecord(ledger, sessionId, definition.id);
  assert.equal(record.state, PANE_OPEN);
  assert.deepEqual(record.payload, payload);
  ledger = transitionPaneLifecycle(ledger, {
    session_id: sessionId,
    pane_id: definition.id,
    action: 'close',
  });
  record = paneRecord(ledger, sessionId, definition.id);
  assert.equal(record.state, PANE_CLOSED);
  assert.equal(record.payload, null);
  return ['closed', 'open', 'minimized', 'open', 'closed'];
}

function parseArgs(argv) {
  const options = { output: '', allowIncomplete: false };
  for (let index = 2; index < argv.length; index += 1) {
    if (argv[index] === '--output') options.output = path.resolve(argv[++index]);
    else if (argv[index] === '--allow-incomplete') options.allowIncomplete = true;
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv);
  const webSource = fs.readFileSync(WEB_SOURCE_PATH, 'utf8');
  const androidPaths = ANDROID_SOURCE_ROOTS.flatMap(root => walkFiles(root));
  const androidSource = sourceBundle(androidPaths);

  const webBoundaries = captures(
    webSource,
    /<PaneLifecycleBoundary\b[^>]*\bpaneId="([^"]+)"/g,
  );
  const webMinimizeControls = captures(
    webSource,
    /<PaneMinimizeButton\b[^>]*\bpaneId="([^"]+)"/g,
  );
  const webRouteBranches = captures(webSource, /\bdata-pane-id="([^"]+)"/g);
  const webRenderBranches = union(webBoundaries, webMinimizeControls, webRouteBranches);
  const androidCoordinatedPanes = captures(
    androidSource,
    /useAndroidPane\(\s*paneLifecycle\s*,\s*updatePaneLifecycle\s*,\s*sessionId\s*,\s*'([^']+)'\s*\)/g,
  );
  const androidMinimizeControls = captures(
    androidSource,
    /\btestID="pane-minimize-([^"]+)"/g,
  );
  const paneDefinitionIds = new Set(PANE_DEFINITIONS.map(definition => definition.id));
  const androidRouteBranches = new Set([...captures(
    androidSource,
    /\btestID="(route-[^"]+)"/g,
  )].filter(id => paneDefinitionIds.has(id)));
  const androidRenderBranches = union(androidCoordinatedPanes, androidRouteBranches);
  const agentTypes = [...BROADCAST_SEND_AGENT_TYPES].sort();

  assert(agentTypes.length > 0, 'BROADCAST_SEND_AGENT_TYPES must not be empty');
  assert.equal(new Set(PANE_DEFINITIONS.map(row => row.id)).size, PANE_DEFINITIONS.length,
    'pane definitions must use unique stable IDs');

  const capabilitiesByAgent = Object.fromEntries(
    agentTypes.map(agentType => [agentType, buildCapabilities(agentType)]),
  );
  const matrix = [];
  const failures = [];
  let lifecycleCells = 0;
  let naCells = 0;

  for (const agentType of agentTypes) {
    const capabilities = capabilitiesByAgent[agentType];
    for (const definition of PANE_DEFINITIONS) {
      const capability = capabilityDecision(definition, agentType, capabilities);
      for (const platform of ['web', 'android']) {
        const platformEnabled = definition[platform] === true;
        const row = {
          agent_type: agentType,
          pane_id: definition.id,
          label: definition.label,
          classification: definition.classification,
          capability_expression: definition.capability,
          platform,
          status: '',
          reason: '',
          render_branch: false,
          minimize_control: false,
          lifecycle: [],
        };
        if (!platformEnabled) {
          row.status = 'N/A';
          row.reason = definition[`${platform}_na`]
            || `pane registry marks ${platform} unsupported for this surface`;
          naCells += 1;
          matrix.push(row);
          continue;
        }
        if (!capability.applicable) {
          row.status = 'N/A';
          row.reason = capability.reason;
          naCells += 1;
          matrix.push(row);
          continue;
        }

        const renderBranches = platform === 'web' ? webRenderBranches : androidRenderBranches;
        const minimizeControls = platform === 'web' ? webMinimizeControls : androidMinimizeControls;
        row.render_branch = renderBranches.has(definition.id);
        if (definition.classification === 'full-route') {
          row.minimize_control = false;
          row.lifecycle = ['route', 'back-to-chat'];
          const source = platform === 'web' ? webSource : androidSource;
          const branchMarker = platform === 'web'
            ? `data-pane-id="${definition.id}"`
            : `testID="${definition.id}"`;
          const branchIndex = source.indexOf(branchMarker);
          const branchWindow = branchIndex < 0 ? '' : source.slice(branchIndex, branchIndex + 6_000);
          const hasBackToChat = branchWindow.includes('Back to chat');
          if (!row.render_branch || !hasBackToChat) {
            row.status = 'FAIL';
            row.reason = [
              !row.render_branch ? 'actual full-route render branch not discovered' : '',
              !hasBackToChat ? 'Back to chat action not discovered' : '',
            ].filter(Boolean).join('; ');
            failures.push({ ...row });
          } else {
            row.status = 'TESTED';
            row.reason = `${capability.reason}; full-route branch and Back to chat discovered`;
          }
          matrix.push(row);
          continue;
        }

        row.minimize_control = minimizeControls.has(definition.id);
        if (!row.render_branch || !row.minimize_control) {
          row.status = 'FAIL';
          row.reason = [
            !row.render_branch ? 'actual coordinated render branch not discovered' : '',
            !row.minimize_control ? 'labelled minimize control not discovered' : '',
          ].filter(Boolean).join('; ');
          failures.push({ ...row });
        } else {
          row.lifecycle = exerciseLifecycle(agentType, definition);
          row.status = 'TESTED';
          row.reason = `${capability.reason}; generated lifecycle passed`;
          lifecycleCells += 1;
        }
        matrix.push(row);
      }
    }
  }

  const receipt = {
    result: failures.length === 0 ? 'PASS' : 'FAIL',
    checked_at: new Date().toISOString(),
    source_truth: {
      capabilities: 'ProxyEngine.prototype._buildCapabilities',
      advertised_agent_types: 'relay-server/broadcast-send-policy.js:BROADCAST_SEND_AGENT_TYPES',
      pane_registry: 'frontend/pane-lifecycle.js:PANE_DEFINITIONS',
      web_render_source: path.relative(ROOT, WEB_SOURCE_PATH).replace(/\\/g, '/'),
      android_render_sources: androidPaths.map(value => path.relative(ROOT, value).replace(/\\/g, '/')),
      hand_authored_agent_fixture: false,
    },
    counts: {
      advertised_agent_types: agentTypes.length,
      pane_definitions: PANE_DEFINITIONS.length,
      matrix_cells: matrix.length,
      lifecycle_tested_cells: lifecycleCells,
      explicit_na_cells: naCells,
      failed_cells: failures.length,
      web_render_pane_ids: webRenderBranches.size,
      android_render_pane_ids: androidRenderBranches.size,
    },
    advertised_agent_types: agentTypes,
    discovered: {
      web_boundaries: [...webBoundaries].sort(),
      web_minimize_controls: [...webMinimizeControls].sort(),
      web_route_branches: [...webRouteBranches].sort(),
      android_coordinated_panes: [...androidCoordinatedPanes].sort(),
      android_minimize_controls: [...androidMinimizeControls].sort(),
      android_route_branches: [...androidRouteBranches].sort(),
    },
    capabilities_by_agent: capabilitiesByAgent,
    failures,
    matrix,
  };

  if (options.output) {
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  }
  console.log(JSON.stringify({
    result: receipt.result,
    checked_at: receipt.checked_at,
    counts: receipt.counts,
    advertised_agent_types: receipt.advertised_agent_types,
    discovered: receipt.discovered,
    failures: failures.slice(0, 40),
    output: options.output || null,
  }, null, 2));
  if (failures.length > 0 && !options.allowIncomplete) process.exitCode = 1;
}

main();
