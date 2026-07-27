'use strict';

const crypto = require('crypto');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const CDP = require('chrome-remote-interface');

// There is deliberately no implicit browser fallback. A CDP endpoint is an
// owned integration surface, not a license to probe whichever user browser
// happens to expose a debugging port.
const DEFAULT_CDP_PORTS = Object.freeze([]);
const MAX_CDP_RESPONSE_BYTES = 256 * 1024;
const EXTRACTION_SIGNATURE = 'ollama-settings-usage-dom-v2';
const DEFAULT_SOURCE_TIMEOUT_MS = 4500;
const DEFAULT_STAGE_TIMEOUT_MS = 1100;
const OWNED_BROWSER_PORT = 9240;
const OWNED_BROWSER_START_URL = 'https://ollama.com/settings';
const OWNED_BROWSER_START_TIMEOUT_MS = 15_000;
const OWNED_BROWSER_RETRY_COOLDOWN_MS = 30_000;
let ownedBrowserLaunchPromise = null;
let ownedBrowserLastFailureAt = 0;

function safePort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : null;
}

function configuredPorts(value = process.env.RAC_OLLAMA_CDP_PORTS) {
  const requested = String(value || '')
    .split(',')
    .map(item => safePort(item.trim()))
    .filter(Boolean);
  return [...new Set(requested.length > 0 ? requested : DEFAULT_CDP_PORTS)];
}

function effectivePortPolicy(options = {}) {
  const configured = configuredPorts(options.ports);
  const fallback = options.allowFallbackPorts === true
    ? configuredPorts(options.fallbackPorts)
    : [];
  return {
    configured,
    fallback,
    effective: [...new Set([...configured, ...fallback])],
    fallback_policy: fallback.length > 0 ? 'explicit_allowlist' : 'none',
  };
}

function boundedTimeout(value, fallback, minimum = 100, maximum = 5000) {
  return Math.max(minimum, Math.min(maximum, Number(value) || fallback));
}

function deadlineError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function withDeadline(value, timeoutMs, code, onLateValue = null) {
  return new Promise((resolve, reject) => {
    let terminal = false;
    const timer = setTimeout(() => {
      terminal = true;
      reject(deadlineError(code));
    }, Math.max(1, timeoutMs));
    Promise.resolve(value).then(result => {
      if (terminal) {
        try { onLateValue?.(result); } catch {}
        return;
      }
      terminal = true;
      clearTimeout(timer);
      resolve(result);
    }, error => {
      if (terminal) return;
      terminal = true;
      clearTimeout(timer);
      reject(error);
    });
  });
}

function runOwnedBrowserLauncher(port, options = {}) {
  if (process.platform !== 'win32') {
    return Promise.resolve({
      ok: false,
      status: 'unsupported',
      code: 'owned_browser_start_unsupported',
      port,
      elapsed_ms: 0,
    });
  }
  const scriptPath = path.resolve(__dirname, '..', 'tools',
    'launch-verification-browser-headless.ps1');
  const startedAt = Date.now();
  return new Promise(resolve => {
    const child = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden',
      '-ExecutionPolicy', 'Bypass', '-File', scriptPath,
      '-CdpPort', String(port),
      '-StartUrl', OWNED_BROWSER_START_URL,
    ], {
      cwd: path.resolve(__dirname, '..'),
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const finish = (ok, status, code) => resolve({
      ok,
      status,
      code,
      port,
      elapsed_ms: Math.max(0, Date.now() - startedAt),
      visible_windows_opened: 0,
      protected_existing_targets_mutated: 0,
      launcher: 'owned_headless_verification_browser',
    });
    const timer = setTimeout(() => {
      child.kill();
      finish(false, 'failed', 'owned_browser_start_timeout');
    }, Math.max(1000, Number(options.timeoutMs) || OWNED_BROWSER_START_TIMEOUT_MS));
    child.stdout.on('data', chunk => { stdout = `${stdout}${chunk}`.slice(-4000); });
    child.stderr.on('data', chunk => { stderr = `${stderr}${chunk}`.slice(-4000); });
    child.once('error', () => {
      clearTimeout(timer);
      finish(false, 'failed', 'owned_browser_start_failed');
    });
    child.once('exit', code => {
      clearTimeout(timer);
      if (code === 0) {
        const reused = /reused/i.test(stdout);
        finish(true, reused ? 'already_running' : 'started', null);
        return;
      }
      const profileOwned = /profile is already owned/i.test(stderr);
      finish(false, 'failed', profileOwned
        ? 'owned_browser_profile_locked' : 'owned_browser_start_failed');
    });
  });
}

function ensureOwnedOllamaUsageBrowser(port, options = {}) {
  const now = typeof options.now === 'function' ? options.now : Date.now;
  if (port !== OWNED_BROWSER_PORT) {
    return Promise.resolve({
      ok: false,
      status: 'refused',
      code: 'owned_browser_port_not_allowlisted',
      port,
      elapsed_ms: 0,
    });
  }
  if (ownedBrowserLaunchPromise) return ownedBrowserLaunchPromise;
  if (ownedBrowserLastFailureAt > 0
      && now() - ownedBrowserLastFailureAt < OWNED_BROWSER_RETRY_COOLDOWN_MS) {
    return Promise.resolve({
      ok: false,
      status: 'cooldown',
      code: 'owned_browser_start_cooldown',
      port,
      elapsed_ms: 0,
    });
  }
  const launcher = typeof options.launcher === 'function'
    ? options.launcher : runOwnedBrowserLauncher;
  ownedBrowserLaunchPromise = Promise.resolve(launcher(port, options)).then(result => {
    if (!result?.ok) ownedBrowserLastFailureAt = now();
    return result;
  }, () => {
    ownedBrowserLastFailureAt = now();
    return {
      ok: false,
      status: 'failed',
      code: 'owned_browser_start_failed',
      port,
      elapsed_ms: 0,
    };
  }).finally(() => {
    ownedBrowserLaunchPromise = null;
  });
  return ownedBrowserLaunchPromise;
}

function listTargets(port, options = {}) {
  const timeoutMs = boundedTimeout(options.timeoutMs, 1200, 100, 5000);
  return new Promise((resolve, reject) => {
    const request = http.get({
      hostname: '127.0.0.1',
      port,
      path: '/json/list',
      timeout: timeoutMs,
      headers: { Accept: 'application/json' },
    }, response => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`cdp_http_${response.statusCode || 'error'}`));
        return;
      }
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        body += chunk;
        if (Buffer.byteLength(body, 'utf8') > MAX_CDP_RESPONSE_BYTES) {
          request.destroy(new Error('cdp_response_too_large'));
        }
      });
      response.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (!Array.isArray(parsed)) throw new Error('cdp_targets_malformed');
          resolve(parsed);
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on('timeout', () => request.destroy(deadlineError('cdp_inventory_timeout')));
    request.on('error', reject);
  });
}

function ollamaTargetPath(target) {
  if (target?.type !== 'page') return null;
  try {
    const url = new URL(target.url);
    if (url.protocol !== 'https:' || url.hostname !== 'ollama.com') return null;
    return url.pathname;
  } catch {
    return null;
  }
}

function isOllamaUsageTarget(target) {
  const pathname = ollamaTargetPath(target);
  // Signed-in ollama.com redirects /settings/usage to /settings, which
  // renders the same Usage section; accept both paths.
  return pathname != null && /^\/settings(\/usage)?\/?$/.test(pathname);
}

function isOllamaAuthTarget(target) {
  const pathname = ollamaTargetPath(target);
  return pathname != null && /^\/(?:sign-?in|login|auth)(?:\/|$)/i.test(pathname);
}

// String.raw so the regex escapes below (\r, \s, \$, \., \n) reach the page
// verbatim instead of being cooked by template-literal escape processing.
const EXTRACT_USAGE_EXPRESSION = String.raw`(() => {
  const sourceReceipt = {
    extraction_signature: '${EXTRACTION_SIGNATURE}',
    ready_state: document.readyState,
    visibility_state: document.visibilityState,
    active_element_tag: document.activeElement?.tagName || null,
    page_path: location.pathname,
    navigation_actions: 0,
    click_actions: 0,
    focus_actions: 0,
  };
  const observer = new MutationObserver(() => {});
  observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  const bodyText = String(document.body?.innerText || '').replace(/\r/g, '');
  const authRequired = !!document.querySelector(
    'input[type="password"], form[action*="login" i], form[action*="signin" i], form[action*="sign-in" i]'
  ) || /\b(?:sign in|log in)\b.{0,80}\b(?:ollama|account|continue)\b/i.test(bodyText);
  if (authRequired) {
    observer.disconnect();
    return {
      ok: false,
      code: 'usage_auth_required',
      message: 'The owned Ollama usage surface requires sign-in.',
      source_receipt: sourceReceipt,
    };
  }
  function lane(label, nextLabel) {
    const lower = bodyText.toLowerCase();
    const start = lower.indexOf(label.toLowerCase());
    if (start < 0) return null;
    const next = nextLabel ? lower.indexOf(nextLabel.toLowerCase(), start + label.length) : -1;
    const segment = bodyText.slice(start, next > start ? next : start + 500);
    const used = segment.match(/([0-9]+(?:\.[0-9]+)?)\s*%\s*used/i);
    const reset = segment.match(/resets?\s+in\s+([^\n·|]{1,80})/i);
    return used ? {
      used_percent: Number(used[1]),
      reset_description: reset ? reset[1].trim().replace(/[.\s]+$/, '') : null,
    } : null;
  }
  const session = lane('Session usage', 'Weekly usage');
  const weekly = lane('Weekly usage', 'Extra usage');
  const planMatch = bodyText.match(/Cloud usage\s*\(([^)\n]{1,60})\)/i);
  const balanceMatch = bodyText.match(/Balance remaining\s*\$\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i);
  const noSubscription = /no cloud subscription|cloud subscription required|upgrade to (?:a )?(?:cloud|pro|max) plan/i.test(bodyText);
  let autoReloadEnabled = null;
  for (const label of document.querySelectorAll('label')) {
    if (!/auto[- ]?reload/i.test(label.innerText || label.textContent || '')) continue;
    const input = label.querySelector('input[type="checkbox"]')
      || (label.htmlFor ? document.getElementById(label.htmlFor) : null);
    if (input && typeof input.checked === 'boolean') autoReloadEnabled = input.checked;
    break;
  }
  const mutationRecords = observer.takeRecords().length;
  observer.disconnect();
  sourceReceipt.dom_mutation_records = mutationRecords;
  sourceReceipt.page_state_unchanged = document.readyState === sourceReceipt.ready_state
    && document.visibilityState === sourceReceipt.visibility_state
    && (document.activeElement?.tagName || null) === sourceReceipt.active_element_tag;
  if (!session && !weekly && !noSubscription) {
    return {
      ok: false,
      code: 'usage_dom_unrecognized',
      message: 'The existing Ollama usage page did not expose recognizable quota lanes.',
      source_receipt: sourceReceipt,
    };
  }
  return {
    ok: true,
    subscription_state: noSubscription ? 'none' : 'active',
    plan: planMatch ? planMatch[1].trim() : null,
    session,
    weekly,
    prepaid_balance: balanceMatch ? Number(balanceMatch[1].replace(/,/g, '')) : null,
    auto_reload_enabled: autoReloadEnabled,
    captured_at: new Date().toISOString(),
    source_receipt: sourceReceipt,
  };
})()`;

function publicFailure(code, message, context = {}) {
  return {
    ok: false,
    source: 'owned_ollama_usage_surface',
    lifecycle_status: context.lifecycleStatus || 'unavailable',
    code,
    message,
    attempt_id: context.attemptId || null,
    attempted_at: context.attemptedAt || null,
    next_action: context.nextAction || 'connect_owned_cloud_source',
    extraction_signature: EXTRACTION_SIGNATURE,
    configured_ports: context.portPolicy?.configured || [],
    fallback_ports: context.portPolicy?.fallback || [],
    effective_ports: context.portPolicy?.effective || [],
    fallback_policy: context.portPolicy?.fallback_policy || 'none',
    attempts: (context.attempts || []).slice(-8),
    supervision: context.supervision ? {
      status: context.supervision.status || 'unknown',
      code: context.supervision.code || null,
      port: safePort(context.supervision.port),
      elapsed_ms: Math.max(0, Number(context.supervision.elapsed_ms) || 0),
      visible_windows_opened: 0,
      protected_existing_targets_mutated: 0,
    } : null,
  };
}

function publicErrorCode(error, fallback = 'cdp_endpoint_unavailable') {
  const code = String(error?.code || error?.message || fallback).slice(0, 80);
  if (code === 'cdp_inventory_timeout') return code;
  if (/ECONNREFUSED|ECONNRESET|ENOTFOUND|EHOSTUNREACH|socket hang up/i.test(code)) {
    return 'cdp_endpoint_unavailable';
  }
  if (/^cdp_http_/.test(code)) return 'cdp_endpoint_invalid';
  if (code === 'cdp_targets_malformed' || code === 'cdp_response_too_large') return code;
  return /^[a-z0-9_.-]{1,80}$/i.test(code) ? code : fallback;
}

function failureForAttempts(attempts, context) {
  const auth = attempts.find(attempt => attempt.status === 'auth_required');
  if (auth) {
    return publicFailure(
      auth.code || 'usage_auth_required',
      'Ollama Cloud monitoring is not connected: the owned usage surface requires sign-in.',
      { ...context, lifecycleStatus: 'auth_required', nextAction: 'sign_in_owned_cloud_source', attempts },
    );
  }
  const error = attempts.find(attempt => attempt.status === 'error');
  if (error) {
    const timeout = /timeout/.test(error.code || '');
    return publicFailure(
      error.code || 'usage_source_error',
      timeout
        ? 'Ollama Cloud monitoring did not settle before its safe deadline.'
        : 'Ollama Cloud monitoring could not read the owned usage surface.',
      {
        ...context,
        lifecycleStatus: 'error',
        nextAction: timeout ? 'retry_cloud_source' : 'review_cloud_source_diagnostic',
        attempts,
      },
    );
  }
  const reachable = attempts.some(attempt => attempt.reachable === true);
  const supervision = context.supervision;
  const supervisionFailed = supervision && supervision.ok !== true;
  const unavailableCode = supervisionFailed
    ? (supervision.code || 'owned_browser_not_running')
    : 'cdp_endpoint_unavailable';
  return publicFailure(
    reachable ? 'usage_target_absent' : unavailableCode,
    reachable
      ? 'Ollama Cloud monitoring is not connected: no allowlisted usage target exists in the owned browser.'
      : supervision?.status === 'starting'
        ? 'The owned Ollama usage browser is starting headlessly; retry this source shortly.'
        : 'Ollama Cloud monitoring is not connected: the owned usage browser is not running.',
    {
      ...context,
      lifecycleStatus: 'unavailable',
      nextAction: reachable ? 'open_usage_in_owned_cloud_source' : 'start_owned_cloud_source',
      attempts,
    },
  );
}

async function readOllamaCloudUsageFromExistingChrome(options = {}) {
  const targetLister = typeof options.listTargets === 'function' ? options.listTargets : listTargets;
  const cdpClientFactory = typeof options.cdpClientFactory === 'function' ? options.cdpClientFactory : CDP;
  const portPolicy = effectivePortPolicy(options);
  const ports = portPolicy.effective;
  const attempts = [];
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const startedAtMs = now();
  const attemptedAt = new Date(startedAtMs).toISOString();
  const attemptId = String(options.attemptId || `ollama-cloud-${startedAtMs}-${crypto.randomBytes(5).toString('hex')}`)
    .replace(/[^a-z0-9_.-]/gi, '_').slice(0, 100);
  const sourceTimeoutMs = boundedTimeout(options.sourceTimeoutMs, DEFAULT_SOURCE_TIMEOUT_MS, 250, 5000);
  const stageTimeoutMs = boundedTimeout(options.stageTimeoutMs || options.timeoutMs,
    DEFAULT_STAGE_TIMEOUT_MS, 100, sourceTimeoutMs);
  const context = { attemptId, attemptedAt, portPolicy, supervision: null };
  if (ports.length === 0) {
    return publicFailure(
      'cdp_not_configured',
      'Ollama Cloud monitoring is not connected: no owned browser endpoint is configured.',
      { ...context, lifecycleStatus: 'unavailable', nextAction: 'configure_owned_cloud_source', attempts },
    );
  }
  const deadlineAt = startedAtMs + sourceTimeoutMs;
  const remainingMs = () => Math.max(1, deadlineAt - now());
  const readInventories = () => Promise.all(ports.map(async port => {
    const inventoryStartedAt = now();
    try {
      const targets = await withDeadline(
        targetLister(port, { ...options, timeoutMs: Math.min(stageTimeoutMs, remainingMs()) }),
        Math.min(stageTimeoutMs, remainingMs()),
        'cdp_inventory_timeout',
      );
      return { port, targets, elapsed_ms: Math.max(0, now() - inventoryStartedAt) };
    } catch (error) {
      return {
        port,
        error,
        elapsed_ms: Math.max(0, now() - inventoryStartedAt),
      };
    }
  }));
  let inventories = await readInventories();
  const allEndpointsUnavailable = inventories.every(inventory => inventory.error);
  const ownedStart = typeof options.ensureOwnedBrowser === 'function'
    ? options.ensureOwnedBrowser
    : options.ensureOwnedBrowser === false
      ? null
      : targetLister === listTargets
        && process.platform === 'win32'
        && ports.length === 1
        && ports[0] === OWNED_BROWSER_PORT
        ? ensureOwnedOllamaUsageBrowser
        : null;
  if (allEndpointsUnavailable && ownedStart) {
    const supervisionStartedAt = now();
    try {
      context.supervision = await withDeadline(
        ownedStart(ports[0], options.supervisorOptions || {}),
        Math.min(2500, remainingMs()),
        'owned_browser_start_timeout',
      );
    } catch (error) {
      context.supervision = {
        ok: false,
        status: 'starting',
        code: publicErrorCode(error, 'owned_browser_start_timeout'),
        port: ports[0],
        elapsed_ms: Math.max(0, now() - supervisionStartedAt),
      };
    }
    if (context.supervision?.ok) {
      inventories = await readInventories();
    } else if (context.supervision?.status !== 'starting'
        && options.suppressSupervisorWarning !== true) {
      console.warn('[ollama-cloud] owned usage browser unavailable', {
        port: ports[0],
        code: context.supervision?.code || 'owned_browser_start_failed',
      });
    }
  }
  let selected = null;
  for (const inventory of inventories) {
    if (inventory.error) {
      attempts.push({
        port: inventory.port,
        status: /timeout/.test(publicErrorCode(inventory.error)) ? 'error' : 'unavailable',
        code: publicErrorCode(inventory.error),
        reachable: false,
        elapsed_ms: inventory.elapsed_ms,
      });
      continue;
    }
    const before = inventory.targets;
    const target = before.find(isOllamaUsageTarget);
    if (!target) {
      const authRequired = before.some(isOllamaAuthTarget);
      attempts.push({
        port: inventory.port,
        status: authRequired ? 'auth_required' : 'unavailable',
        code: authRequired ? 'usage_auth_required' : 'usage_target_absent',
        reachable: true,
        ollama_origin_targets: before.filter(targetItem => ollamaTargetPath(targetItem) != null).length,
        usage_targets: 0,
        elapsed_ms: inventory.elapsed_ms,
      });
      continue;
    }
    if (!selected) selected = { port: inventory.port, before, target, inventory };
  }
  if (!selected && context.supervision?.ok !== true && context.supervision) {
    attempts.push({
      port: context.supervision.port || ports[0],
      status: 'unavailable',
      code: context.supervision.code || 'owned_browser_not_running',
      reachable: false,
      elapsed_ms: Math.max(0, Number(context.supervision.elapsed_ms) || 0),
    });
  }
  if (!selected) return failureForAttempts(attempts, context);

  const { port, before, target, inventory } = selected;
  let client;
  const sourceStartedAt = now();
  try {
    client = await withDeadline(
      cdpClientFactory({ host: '127.0.0.1', port, target: target.id }),
      Math.min(stageTimeoutMs, remainingMs()),
      'cdp_attach_timeout',
      lateClient => lateClient?.close?.().catch?.(() => {}),
    );
    await withDeadline(
      client.Runtime.enable(),
      Math.min(stageTimeoutMs, remainingMs()),
      'cdp_runtime_enable_timeout',
    );
    const evaluated = await withDeadline(
      client.Runtime.evaluate({
        expression: EXTRACT_USAGE_EXPRESSION,
        returnByValue: true,
        awaitPromise: false,
        userGesture: false,
      }),
      Math.min(stageTimeoutMs, remainingMs()),
      'usage_evaluation_timeout',
    );
    if (evaluated?.exceptionDetails) throw deadlineError('usage_dom_evaluation_failed');
    const receipt = evaluated?.result?.value;
    if (!receipt?.ok) {
      attempts.push({
        port,
        status: receipt?.code === 'usage_auth_required' ? 'auth_required' : 'error',
        code: receipt?.code === 'usage_dom_unrecognized' ? 'usage_schema_drift'
          : String(receipt?.code || 'usage_schema_drift').slice(0, 80),
        reachable: true,
        ollama_origin_targets: before.filter(targetItem => ollamaTargetPath(targetItem) != null).length,
        usage_targets: before.filter(isOllamaUsageTarget).length,
        elapsed_ms: Math.max(0, now() - sourceStartedAt),
      });
      return failureForAttempts(attempts, context);
    }
    const after = await withDeadline(
      targetLister(port, { ...options, timeoutMs: Math.min(stageTimeoutMs, remainingMs()) }),
      Math.min(stageTimeoutMs, remainingMs()),
      'cdp_inventory_timeout',
    );
    const beforeIds = before.map(item => item.id).sort();
    const afterIds = after.map(item => item.id).sort();
    const afterTarget = after.find(item => item.id === target.id);
    if (!afterTarget || !isOllamaUsageTarget(afterTarget)) {
      const authAfter = (afterTarget && isOllamaAuthTarget(afterTarget))
        || after.some(isOllamaAuthTarget);
      attempts.push({
        port,
        status: authAfter ? 'auth_required' : 'error',
        code: authAfter ? 'usage_auth_required'
          : (afterTarget ? 'usage_redirected' : 'usage_target_lost'),
        reachable: true,
        elapsed_ms: Math.max(0, now() - sourceStartedAt),
      });
      return failureForAttempts(attempts, context);
    }
    const targetInventoryStable = beforeIds.length === afterIds.length
      && beforeIds.every((id, index) => id === afterIds[index]);
    attempts.push({
      port,
      status: 'fresh',
      code: null,
      reachable: true,
      ollama_origin_targets: before.filter(targetItem => ollamaTargetPath(targetItem) != null).length,
      usage_targets: before.filter(isOllamaUsageTarget).length,
      elapsed_ms: Math.max(0, now() - sourceStartedAt),
    });
    return {
      ...receipt,
      source: 'owned_signed_in_ollama_usage_surface',
      lifecycle_status: 'fresh',
      attempt_id: attemptId,
      attempted_at: attemptedAt,
      next_action: 'none',
      extraction_signature: EXTRACTION_SIGNATURE,
      configured_ports: portPolicy.configured,
      fallback_ports: portPolicy.fallback,
      effective_ports: portPolicy.effective,
      fallback_policy: portPolicy.fallback_policy,
      attempts: attempts.slice(-8),
      supervision: context.supervision,
      source_receipt: {
        ...receipt.source_receipt,
        extraction_signature: EXTRACTION_SIGNATURE,
        cdp_port: port,
        existing_target_id_preserved: afterIds.includes(target.id),
        target_inventory_stable: targetInventoryStable,
        targets_created: Math.max(0, afterIds.filter(id => !beforeIds.includes(id)).length),
      },
    };
  } catch (error) {
    const code = publicErrorCode(error, 'usage_surface_failed');
    attempts.push({
      port,
      status: /timeout|failed|malformed|too_large/.test(code) ? 'error' : 'unavailable',
      code,
      reachable: inventory?.targets != null,
      elapsed_ms: Math.max(0, now() - sourceStartedAt),
    });
    return failureForAttempts(attempts, context);
  } finally {
    if (client) {
      await withDeadline(client.close().catch(() => {}), Math.min(250, remainingMs()),
        'cdp_close_timeout').catch(() => {});
    }
  }
}

module.exports = {
  EXTRACTION_SIGNATURE,
  EXTRACT_USAGE_EXPRESSION,
  configuredPorts,
  ensureOwnedOllamaUsageBrowser,
  effectivePortPolicy,
  isOllamaAuthTarget,
  isOllamaUsageTarget,
  listTargets,
  readOllamaCloudUsageFromExistingChrome,
  runOwnedBrowserLauncher,
  withDeadline,
};
