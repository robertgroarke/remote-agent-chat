'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const {
  ollamaReceiptStatePath,
  readOllamaRequestReceipts,
  requestLoopbackJson,
  writeOllamaRequestReceipt,
} = require('../agent-proxy/provider-usage');

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--model') options.model = argv[++index];
    else if (arg === '--surface') options.surface = argv[++index];
    else if (arg === '--base-url') options.baseUrl = argv[++index];
    else if (arg === '--receipt-path') options.receiptPath = argv[++index];
    else if (arg === '--output') options.output = argv[++index];
    else if (arg === '--timeout-ms') options.timeoutMs = Number(argv[++index]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function loopbackBaseUrl(value = 'http://127.0.0.1:11434') {
  let base;
  try { base = new URL(String(value).includes('://') ? String(value) : `http://${value}`); } catch {
    throw new Error('Ollama canary endpoint is invalid.');
  }
  if (base.protocol !== 'http:'
      || !new Set(['127.0.0.1', 'localhost', '::1', '[::1]']).has(base.hostname)
      || base.username || base.password || base.search || base.hash) {
    throw new Error('Ollama canary endpoint must remain loopback-only.');
  }
  return base;
}

function postLoopbackJson(pathname, body, options = {}) {
  const base = loopbackBaseUrl(options.baseUrl);
  const target = new URL(pathname, `${base.origin}/`);
  const encoded = Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const request = http.request(target, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Content-Length': encoded.length,
        'User-Agent': 'Remote-Agent-Chat-Owned-Ollama-Canary/1.0',
      },
      timeout: Math.max(1_000, Number(options.timeoutMs) || 180_000),
    }, response => {
      let bytes = 0;
      const chunks = [];
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes <= MAX_RESPONSE_BYTES) chunks.push(chunk);
      });
      response.on('end', () => {
        if (bytes > MAX_RESPONSE_BYTES) {
          reject(new Error('Ollama canary response exceeded the bounded response limit.'));
          return;
        }
        const statusCode = Number(response.statusCode) || 0;
        if (statusCode < 200 || statusCode >= 300) {
          reject(new Error(`Ollama canary returned HTTP ${statusCode || 'error'}.`));
          return;
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
        } catch {
          reject(new Error('Ollama canary returned malformed JSON.'));
        }
      });
    });
    request.on('timeout', () => request.destroy(new Error('Ollama canary request timed out.')));
    request.on('error', reject);
    request.end(encoded);
  });
}

function loadedModelNames(snapshot) {
  return (Array.isArray(snapshot?.models) ? snapshot.models : [])
    .map(item => String(item?.name || item?.model || ''))
    .filter(Boolean);
}

async function waitForUnloaded(model, options) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const snapshot = await requestLoopbackJson('/api/ps', options);
    if (!loadedModelNames(snapshot).includes(model)) return snapshot;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Owned Ollama canary model did not unload within five seconds.');
}

function reportContainsContent(report, promptContent, responseContent) {
  const serialized = JSON.stringify(report);
  return serialized.includes(promptContent)
    || (responseContent.length >= 4 && serialized.includes(responseContent));
}

async function runCanary(options = {}) {
  const base = loopbackBaseUrl(options.baseUrl);
  const model = String(options.model || '').trim();
  const surface = String(options.surface || 'remote_agent_chat_owned_canary').trim();
  if (!model || /:cloud$/i.test(model)) throw new Error('An installed local Ollama model is required.');
  if (!/^[a-z0-9][a-z0-9._:/-]*$/i.test(surface)) throw new Error('Canary surface identifier is invalid.');
  const requestOptions = { ...options, baseUrl: base.origin };
  const tags = await requestLoopbackJson('/api/tags', requestOptions);
  const installed = (Array.isArray(tags?.models) ? tags.models : []).find(item => item?.name === model);
  if (!installed || Number(installed.size) < 1024 * 1024) {
    throw new Error('The requested local Ollama model is not installed.');
  }
  const before = await requestLoopbackJson('/api/ps', requestOptions);
  const beforeLoaded = loadedModelNames(before);
  if (beforeLoaded.length > 0) throw new Error('Ollama runtime is not idle; owned canary refused to displace loaded models.');

  const contentCanary = `rac_ollama_canary_${crypto.randomBytes(12).toString('hex')}`;
  const promptContent = `Return only this identifier: ${contentCanary}`;
  let terminal = null;
  let receipt = null;
  let during = null;
  let after = null;
  try {
    terminal = await postLoopbackJson('/api/generate', {
      model,
      prompt: promptContent,
      stream: false,
      keep_alive: '30s',
      options: { temperature: 0, num_predict: 32 },
    }, requestOptions);
    receipt = writeOllamaRequestReceipt(terminal, {
      model,
      surface,
      capturedAt: new Date().toISOString(),
    }, options);
    during = await requestLoopbackJson('/api/ps', requestOptions);
  } finally {
    try {
      await postLoopbackJson('/api/generate', { model, keep_alive: 0, stream: false }, requestOptions);
      after = await waitForUnloaded(model, requestOptions);
    } catch (error) {
      if (terminal) throw error;
    }
  }
  const responseContent = String(terminal?.response || '').trim();
  const persistedText = fs.readFileSync(ollamaReceiptStatePath(options), 'utf8');
  if (persistedText.includes(promptContent)
      || (responseContent.length >= 4 && persistedText.includes(responseContent))) {
    throw new Error('Owned Ollama receipt state retained prompt or response content.');
  }
  const persistedReceipts = readOllamaRequestReceipts(options);
  const report = {
    ok: true,
    generated_at: new Date().toISOString(),
    endpoint_scope: 'loopback_only',
    endpoint_host: base.hostname,
    model,
    surface,
    terminal_response_observed: terminal?.done === true,
    receipt,
    receipt_count: persistedReceipts.length,
    preloaded_model_count: beforeLoaded.length,
    lifecycle_loaded_model_observed: loadedModelNames(during).includes(model),
    lifecycle_unloaded_after: !loadedModelNames(after).includes(model),
    prompt_content_persisted: false,
    response_content_persisted: false,
    visible_windows_opened: 0,
    focus_actions: 0,
    protected_sessions_touched: 0,
  };
  if (!report.terminal_response_observed
      || !report.lifecycle_loaded_model_observed
      || !report.lifecycle_unloaded_after
      || reportContainsContent(report, promptContent, responseContent)) {
    throw new Error('Owned Ollama canary acceptance failed.');
  }
  return report;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = await runCanary(options);
  const output = `${JSON.stringify(report, null, 2)}\n`;
  if (options.output) {
    const target = path.resolve(options.output);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, output, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  }
  process.stdout.write(output);
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  loopbackBaseUrl,
  postLoopbackJson,
  runCanary,
};
