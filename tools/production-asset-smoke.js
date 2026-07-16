#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const fidelity = require('./run-fidelity-regression');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
const outputPath = outputIndex >= 0 && args[outputIndex + 1] ? path.resolve(args[outputIndex + 1]) : null;
const sourceRootIndex = args.indexOf('--source-root');
const sourceRoot = sourceRootIndex >= 0 && args[sourceRootIndex + 1]
  ? path.resolve(args[sourceRootIndex + 1])
  : ROOT;
const envRootIndex = args.indexOf('--env-root');
const envRoot = envRootIndex >= 0 && args[envRootIndex + 1]
  ? path.resolve(args[envRootIndex + 1])
  : ROOT;

function normalizedText(value) {
  return String(value || '').replace(/\r\n/g, '\n');
}

async function readAsset(baseUrl, assetPath, headers) {
  const startedAt = Date.now();
  const separator = assetPath.includes('?') ? '&' : '?';
  const response = await fetch(baseUrl + assetPath + separator + 'asset_smoke=' + Date.now(), {
    headers,
    cache: 'no-store',
    redirect: 'follow',
  });
  const body = await response.text();
  assert.equal(response.status, 200, assetPath + ' returned HTTP ' + response.status);
  return {
    body,
    elapsed_ms: Date.now() - startedAt,
    bytes: Buffer.byteLength(body),
    content_type: response.headers.get('content-type') || '',
  };
}

async function readBinaryAsset(baseUrl, assetPath, headers) {
  const startedAt = Date.now();
  const separator = assetPath.includes('?') ? '&' : '?';
  const response = await fetch(baseUrl + assetPath + separator + 'asset_smoke=' + Date.now(), {
    headers,
    cache: 'no-store',
    redirect: 'follow',
  });
  const body = Buffer.from(await response.arrayBuffer());
  assert.equal(response.status, 200, assetPath + ' returned HTTP ' + response.status);
  return {
    body,
    elapsed_ms: Date.now() - startedAt,
    bytes: body.length,
    content_type: response.headers.get('content-type') || '',
    sha256: crypto.createHash('sha256').update(body).digest('hex').toUpperCase(),
  };
}

async function main() {
  const localWorker = fs.readFileSync(path.join(sourceRoot, 'frontend', 'sw.js'), 'utf8');
  const assetVersion = localWorker.match(/const ASSET_VERSION = '([^']+)'/)?.[1];
  const cacheName = localWorker.match(/const CACHE_NAME = '([^']+)'/)?.[1];
  assert(assetVersion, 'local service worker is missing ASSET_VERSION');
  assert.strictEqual(cacheName, `agent-chat-${assetVersion}`,
    'local service-worker cache generation is not derived from its asset version');
  const relaySource = fs.readFileSync(path.join(sourceRoot, 'relay-server', 'index.js'), 'utf8');
  assert(
    relaySource.includes("app.use('/', requireBrowserOrBearerAuth, express.static(PUBLIC_DIR"),
    'static app shell must use the browser-redirect-or-bearer auth gate',
  );
  assert(
    relaySource.includes('if (!token) return requireAuth(req, res, next);'),
    'tokenless browser navigation must retain the OAuth redirect path',
  );
  assert(
    relaySource.includes('return requireAnyAuth(req, res, next);'),
    'explicit bearer/query tokens must retain native/headless authentication',
  );
  const deployEnv = fidelity.loadEnvFile(path.join(envRoot, '.env'));
  const relayEnv = fidelity.loadEnvFile(path.join(envRoot, 'relay-server', '.env'));
  const proxyEnv = fidelity.loadEnvFile(path.join(envRoot, 'agent-proxy', '.env'));
  const configuredBase = fidelity.deriveRelayBaseUrl(null, relayEnv, proxyEnv);
  const deployHost = deployEnv.DEPLOY_HOST || 'tower';
  const candidates = [...new Set([
    'http://' + deployHost + ':3500',
    configuredBase,
  ].filter(Boolean).map(value => value.replace(/\/+$/, '')))];
  const token = fidelity.buildBearerToken(relayEnv);
  const headers = token ? { Authorization: 'Bearer ' + token } : {};

  let baseUrl = '';
  let index = null;
  const attempts = [];
  for (const candidate of candidates) {
    try {
      const response = await readAsset(candidate, '/', headers);
      if (response.body.includes(`styles.css?v=${assetVersion}`)) {
        baseUrl = candidate;
        index = response;
        break;
      }
      attempts.push({ origin: new URL(candidate).origin, result: 'app_shell_marker_missing' });
    } catch (error) {
      attempts.push({ origin: new URL(candidate).origin, result: error.message });
    }
  }
  assert(baseUrl && index, 'no production origin served the current app shell: ' + JSON.stringify(attempts));
  const styles = await readAsset(baseUrl, `/styles.css?v=${assetVersion}`, headers);
  const bundle = await readAsset(baseUrl, `/dist/bundle.js?v=${assetVersion}`, headers);
  const worker = await readAsset(baseUrl, '/sw.js', headers);
  const apk = await readBinaryAsset(baseUrl, '/agent-chat.apk', headers);
  const localApk = fs.readFileSync(path.join(sourceRoot, 'relay-server', 'public', 'agent-chat.apk'));
  const localApkSha256 = crypto.createHash('sha256').update(localApk).digest('hex').toUpperCase();

  assert(index.body.includes(`styles.css?v=${assetVersion}`), 'production HTML has a stale stylesheet key');
  assert(index.body.includes(`bundle.js?v=${assetVersion}`), 'production HTML has a stale bundle key');
  assert(worker.body.includes(`CACHE_NAME = '${cacheName}'`), 'production service worker has a stale cache generation');
  assert(worker.body.includes(`ASSET_VERSION = '${assetVersion}'`), 'production service worker is missing the immutable asset version');
  assert(worker.body.includes("self.addEventListener('push'"), 'production service worker is missing Web Push handling');
  assert(worker.body.includes("url.pathname.startsWith('/api/')"),
    'production service worker may cache authenticated API GETs');
  assert.strictEqual(
    normalizedText(worker.body),
    normalizedText(localWorker),
    'production service worker differs semantically from the exact source root',
  );
  assert.equal(apk.bytes, localApk.length, 'production APK byte length differs from the built release');
  assert.equal(apk.sha256, localApkSha256, 'production APK hash differs from the built release');
  for (const marker of [
    'content-block-plan', 'content-block-queued-message', 'content-block-notice', 'content-block-tool-result',
    'content-block-thinking-native', 'content-block-thinking-codex-desktop', 'content-block-terminal-codex-desktop',
    'permission-key-hint', 'permission-keyboard-help', 'interrupt-confirm-inline',
    'attention-toast', 'hamburger-attention',
    'composer-skin-codex-cli', 'composer-skin-claude', 'composer-skin-cursor', 'composer-skin-codex',
    'fleet-broadcast', 'fleet-broadcast-receipts',
    'transcript-search-view', 'transcript-search-result', 'search-match',
    'session-export-actions',
    'scheduled-send-panel', 'scheduled-send-row', 'schedule-send-btn',
  ]) {
    assert(styles.body.includes(marker), 'production stylesheet is missing ' + marker);
  }
  for (const marker of ['--terminal-bg: #f6f8fa', '--syntax-keyword: #cf222e', 'harness-theme-claude_cli']) {
    assert(styles.body.includes(marker), 'production stylesheet is missing light block palette marker ' + marker);
  }
  for (const marker of [
    'queued_message', 'tool_result', 'content-block-plan', 'content-block-notice',
    'content-block-thinking-native', 'content-block-thinking-codex-desktop', 'content-block-terminal-codex-desktop',
    'proxy_send_result', 'agent_started', 'Native user turn delivered',
    'Native launch accepted; user-turn receipt pending', 'offline_queued', 'web-hb-',
    'Esc return to composer', 'Press Esc again or Enter to interrupt',
    'Question needs an answer', 'Turn finished', 'Goal completed', 'Goal needs attention',
    'semantic_notification', 'goal_attention',
    'Notification sound', 'completion_sound',
    'App update validated.', 'App update drift validation failed.',
    'Broadcast prompt', 'SEND TO ', 'fleet-broadcast-receipts',
    'Transcript search', '/api/search/messages', 'around_id',
    'Download Markdown', 'Download JSON', '/api/sessions/${encodeURIComponent(', ')}/export',
    'Show test sessions', 'include_test=', 'show-test-sessions',
    'Schedule message', '/api/scheduled-sends', 'When session is next idle', 'At a specific time',
    'data-composer-skin',
  ]) {
    assert(bundle.body.includes(marker), 'production bundle is missing ' + marker);
  }

  const parsed = new URL(baseUrl);
  const result = {
    ok: true,
    source_root: sourceRoot,
    origin: parsed.origin,
    origin_attempts: attempts,
    cache_key: assetVersion,
    service_worker_cache: cacheName,
    service_worker_sha256: crypto.createHash('sha256').update(worker.body).digest('hex').toUpperCase(),
    assets: {
      index: { elapsed_ms: index.elapsed_ms, bytes: index.bytes },
      styles: { elapsed_ms: styles.elapsed_ms, bytes: styles.bytes },
      bundle: { elapsed_ms: bundle.elapsed_ms, bytes: bundle.bytes },
      service_worker: { elapsed_ms: worker.elapsed_ms, bytes: worker.bytes },
      android_apk: { elapsed_ms: apk.elapsed_ms, bytes: apk.bytes, sha256: apk.sha256 },
    },
    markers: [
      'tool_result', 'plan', 'queued_message', 'notice', 'content-block-thinking-native', 'content-block-thinking-codex-desktop', 'content-block-terminal-codex-desktop',
      'proxy_send_result', 'agent_started', 'delivered',
      'permission-key-hint', 'permission-keyboard-help', 'Esc return to composer',
      'interrupt-confirm-inline', 'Press Esc again or Enter to interrupt',
      'attention-toast', 'hamburger-attention', 'Question needs an answer',
      'Turn finished', 'Goal completed', 'Goal needs attention', 'semantic_notification', 'goal_attention',
      'Notification sound', 'completion_sound',
      'App update validated.', 'App update drift validation failed.',
      'Broadcast prompt', 'fleet-broadcast-receipts',
      'Transcript search', '/api/search/messages', 'around_id',
      'Download Markdown', 'Download JSON', 'session-export-actions',
      'Show test sessions', 'show-test-sessions',
      'Schedule message', '/api/scheduled-sends', 'When session is next idle', 'At a specific time',
      'scheduled-send-panel', 'scheduled-send-row', 'schedule-send-btn',
      'composer-skin-codex-cli', 'composer-skin-claude', 'composer-skin-cursor', 'composer-skin-codex', 'data-composer-skin',
    ],
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
  console.error('production asset smoke: FAIL (' + (error.stack || error.message || error) + ')');
  process.exit(1);
});
