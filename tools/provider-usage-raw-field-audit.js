#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  readCursorLocalAuth,
  requestJson,
} = require('../agent-proxy/provider-usage');

const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
const outputPath = outputIndex >= 0 && args[outputIndex + 1]
  ? path.resolve(args[outputIndex + 1]) : null;
const quiet = args.includes('--quiet');

const SENSITIVE_KEY = /(?:token|secret|password|cookie|authorization|email|uuid|account.?id|organization.?id|user.?id|refresh)/i;
const SAFE_STRING_KEY = /(?:currency|status|type|kind|plan|membership|subscription|billing.?cycle|reset|starts?|ends?|expires?|model|provider)/i;
const MONEY_KEY = /(?:spend|credit|limit|bonus|included|allowance|balance|amount|currency|refund|cap)/i;

function safeString(value, key) {
  const text = String(value);
  if (SENSITIVE_KEY.test(key)) return '<redacted>';
  if (!SAFE_STRING_KEY.test(key)) return `<redacted:string:${Buffer.byteLength(text, 'utf8')}>`;
  if (text.length > 120 || /\s+bearer\s+|\bsk-[a-z0-9_-]{8,}|\beyJ[a-z0-9_-]{8,}\./i.test(text)) return '<redacted>';
  return text;
}

function sanitizeRaw(value, key = '') {
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return safeString(value, key);
  if (Array.isArray(value)) return value.slice(0, 128).map(item => sanitizeRaw(item, key));
  if (typeof value !== 'object') return `<redacted:${typeof value}>`;
  return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [
    childKey,
    sanitizeRaw(child, childKey),
  ]));
}

function fieldInventory(value, pointer = '$', rows = []) {
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  rows.push({ path: pointer, type });
  if (Array.isArray(value)) {
    value.forEach((child, index) => fieldInventory(child, `${pointer}[${index}]`, rows));
  } else if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, child]) => fieldInventory(child, `${pointer}.${key}`, rows));
  }
  return rows;
}

function monetaryFields(value) {
  return fieldInventory(value)
    .filter(row => MONEY_KEY.test(row.path))
    .map(row => ({ path: row.path, type: row.type }));
}

function safeProviderLabel(value) {
  const text = typeof value === 'string' ? value.trim().slice(0, 80) : '';
  return text && !/@|\bBearer\b|\bsk-/i.test(text) && /^[\p{L}\p{N} .+_/-]+$/u.test(text)
    ? text : null;
}

function claudeLimitSummary(usage) {
  return (Array.isArray(usage?.limits) ? usage.limits : []).map(limit => ({
    kind: safeProviderLabel(limit?.kind),
    group: safeProviderLabel(limit?.group),
    percent: typeof limit?.percent === 'number' ? limit.percent : null,
    resets_at: typeof limit?.resets_at === 'string' ? limit.resets_at : null,
    model_id: safeProviderLabel(limit?.scope?.model?.id),
    model_name: safeProviderLabel(limit?.scope?.model?.display_name),
    surface: safeProviderLabel(limit?.scope?.surface),
    is_active: limit?.is_active === true,
  }));
}

function secretCandidates(claudeCredentials, cursorAuth) {
  return [
    claudeCredentials?.claudeAiOauth?.accessToken,
    claudeCredentials?.claudeAiOauth?.refreshToken,
    claudeCredentials?.organizationUuid,
    cursorAuth?.token,
    cursorAuth?.email,
  ].filter(value => typeof value === 'string' && value.length >= 8);
}

async function ollamaAudit() {
  try {
    const response = await fetch('http://127.0.0.1:11434/api/ps', {
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) return { status: 'unavailable', http_status: response.status };
    const raw = await response.json();
    const shape = sanitizeRaw(raw);
    return {
      status: 'ok',
      endpoint_scope: 'loopback_only',
      raw_shape: shape,
      field_inventory: fieldInventory(shape),
    };
  } catch (error) {
    return {
      status: 'not_running',
      endpoint_scope: 'loopback_only',
      error_code: error?.cause?.code || error?.code || 'unavailable',
    };
  }
}

async function main() {
  const claudeCredentialsPath = path.join(os.homedir(), '.claude', '.credentials.json');
  const claudeCredentials = JSON.parse(fs.readFileSync(claudeCredentialsPath, 'utf8'));
  const claudeToken = claudeCredentials?.claudeAiOauth?.accessToken;
  assert(claudeToken, 'Claude local OAuth token is unavailable');
  const claudeHeaders = {
    Authorization: `Bearer ${claudeToken}`,
    'anthropic-beta': 'oauth-2025-04-20',
    'User-Agent': 'remote-agent-chat-provider-usage-raw-field-audit',
  };
  const [claudeUsage, claudeProfile, cursorAuth] = await Promise.all([
    requestJson('https://api.anthropic.com/api/oauth/usage', { headers: claudeHeaders }),
    requestJson('https://api.anthropic.com/api/oauth/profile', { headers: claudeHeaders }),
    readCursorLocalAuth({ forcePython: true }),
  ]);
  assert(cursorAuth.token, 'Cursor local access token is unavailable');
  const cursorUsage = await requestJson(
    'https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cursorAuth.token}`,
        'Connect-Protocol-Version': '1',
      },
      body: {},
    },
  );

  const claudeUsageShape = sanitizeRaw(claudeUsage);
  const claudeProfileShape = sanitizeRaw(claudeProfile);
  const cursorUsageShape = sanitizeRaw(cursorUsage);
  const result = {
    ok: true,
    generated_at: new Date().toISOString(),
    mode: 'signed_in_local_read_only_structural_audit',
    raw_response_bodies_persisted: false,
    browser_cookie_import_used: false,
    visible_windows_opened: 0,
    focus_actions: 0,
    providers: {
      claude: {
        source: 'oauth_api',
        semantic_limit_summary: claudeLimitSummary(claudeUsage),
        usage: {
          raw_shape: claudeUsageShape,
          field_inventory: fieldInventory(claudeUsageShape),
          monetary_fields: monetaryFields(claudeUsageShape),
        },
        profile: {
          raw_shape: claudeProfileShape,
          field_inventory: fieldInventory(claudeProfileShape),
        },
      },
      cursor: {
        source: cursorAuth.storageSource === 'python_sqlite' ? 'python_sqlite_connect' : 'local_auth_connect',
        local_account_scope: {
          membership: safeString(cursorAuth.membership || '', 'membership'),
          subscription_status: safeString(cursorAuth.subscriptionStatus || '', 'subscription_status'),
        },
        usage: {
          raw_shape: cursorUsageShape,
          field_inventory: fieldInventory(cursorUsageShape),
          monetary_fields: monetaryFields(cursorUsageShape),
        },
      },
      antigravity: {
        status: 'local_settings_cache_not_available_to_standalone_audit',
        source: 'proxy_owned_antigravity_desktop_settings_cache',
      },
      ollama: await ollamaAudit(),
    },
  };
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  const candidates = secretCandidates(claudeCredentials, cursorAuth);
  assert.strictEqual(candidates.some(secret => serialized.includes(secret)), false,
    'raw-field audit must not persist a local provider secret or account identifier');
  assert.strictEqual(/\bBearer\s+|\bsk-[a-z0-9_-]{8,}|accessToken|refreshToken|cachedEmail/i.test(serialized), false,
    'raw-field audit must not contain credential-shaped fields');
  result.secret_candidates_checked = candidates.length;
  result.secret_matches = 0;
  const output = `${JSON.stringify(result, null, 2)}\n`;
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, output, 'utf8');
  }
  if (!quiet) process.stdout.write(output);
}

main().catch(error => {
  console.error(`provider usage raw-field audit: FAIL (${error.message || error})`);
  process.exit(1);
});
