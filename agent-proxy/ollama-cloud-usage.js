'use strict';

const http = require('http');
const CDP = require('chrome-remote-interface');

const DEFAULT_CDP_PORTS = Object.freeze([9222]);
const MAX_CDP_RESPONSE_BYTES = 256 * 1024;

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

function listTargets(port, options = {}) {
  const timeoutMs = Math.max(250, Math.min(5000, Number(options.timeoutMs) || 1200));
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
    request.on('timeout', () => request.destroy(new Error('cdp_timeout')));
    request.on('error', reject);
  });
}

function isOllamaUsageTarget(target) {
  if (target?.type !== 'page') return false;
  try {
    const url = new URL(target.url);
    // Signed-in ollama.com redirects /settings/usage to /settings, which
    // renders the same Usage section; accept both paths.
    return url.protocol === 'https:'
      && url.hostname === 'ollama.com'
      && /^\/settings(\/usage)?\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

// String.raw so the regex escapes below (\r, \s, \$, \., \n) reach the page
// verbatim instead of being cooked by template-literal escape processing.
const EXTRACT_USAGE_EXPRESSION = String.raw`(() => {
  const sourceReceipt = {
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

function publicFailure(code, message, attempts = []) {
  return {
    ok: false,
    code,
    message,
    attempts: attempts.slice(-8),
  };
}

async function readOllamaCloudUsageFromExistingChrome(options = {}) {
  const ports = configuredPorts(options.ports);
  const attempts = [];
  for (const port of ports) {
    let before;
    try {
      before = await listTargets(port, options);
    } catch (error) {
      attempts.push({ port, status: 'unavailable', code: String(error?.message || 'cdp_unavailable').slice(0, 80) });
      continue;
    }
    const target = before.find(isOllamaUsageTarget);
    if (!target) {
      attempts.push({ port, status: 'unavailable', code: 'usage_target_absent' });
      continue;
    }
    let client;
    try {
      client = await CDP({ host: '127.0.0.1', port, target: target.id });
      await client.Runtime.enable();
      const evaluated = await client.Runtime.evaluate({
        expression: EXTRACT_USAGE_EXPRESSION,
        returnByValue: true,
        awaitPromise: false,
        userGesture: false,
      });
      if (evaluated?.exceptionDetails) throw new Error('usage_dom_evaluation_failed');
      const receipt = evaluated?.result?.value;
      const after = await listTargets(port, options);
      const beforeIds = before.map(item => item.id).sort();
      const afterIds = after.map(item => item.id).sort();
      const targetInventoryStable = beforeIds.length === afterIds.length
        && beforeIds.every((id, index) => id === afterIds[index]);
      if (!receipt?.ok) {
        attempts.push({ port, status: 'unavailable', code: String(receipt?.code || 'usage_dom_unrecognized').slice(0, 80) });
        continue;
      }
      return {
        ...receipt,
        source: 'existing_signed_in_ollama_usage_surface',
        source_receipt: {
          ...receipt.source_receipt,
          cdp_port: port,
          existing_target_id_preserved: afterIds.includes(target.id),
          target_inventory_stable: targetInventoryStable,
          targets_created: Math.max(0, afterIds.filter(id => !beforeIds.includes(id)).length),
        },
      };
    } catch (error) {
      attempts.push({ port, status: 'unavailable', code: String(error?.message || 'usage_surface_failed').slice(0, 80) });
    } finally {
      if (client) await client.close().catch(() => {});
    }
  }
  return publicFailure(
    'existing_usage_surface_unavailable',
    'Cloud usage unavailable: no readable, already-open signed-in Ollama usage page was found.',
    attempts,
  );
}

module.exports = {
  EXTRACT_USAGE_EXPRESSION,
  configuredPorts,
  isOllamaUsageTarget,
  listTargets,
  readOllamaCloudUsageFromExistingChrome,
};
