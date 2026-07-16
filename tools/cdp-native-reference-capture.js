#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const CDP = require('../agent-proxy/node_modules/chrome-remote-interface');
const { PNG } = require('../frontend/node_modules/pngjs');

const ROOT = path.resolve(__dirname, '..');
const EVIDENCE_ROOT = path.join(ROOT, 'evidence');
const ALLOWED_PORTS = new Set([9223, 9225, 9226, 9227, 9228, 9230]);
const ALLOWED_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

function parseArgs(argv) {
  const options = { readOnly: false, host: '127.0.0.1', port: 0, title: '', urlPrefix: '', output: '', resultFile: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--read-only') options.readOnly = true;
    else if (arg === '--host' && argv[index + 1]) options.host = String(argv[++index]).trim().toLowerCase();
    else if (arg === '--port' && argv[index + 1]) options.port = Number(argv[++index]);
    else if (arg === '--title' && argv[index + 1]) options.title = String(argv[++index]);
    else if (arg === '--url-prefix' && argv[index + 1]) options.urlPrefix = String(argv[++index]);
    else if (arg === '--output' && argv[index + 1]) options.output = path.resolve(argv[++index]);
    else if (arg === '--result-file' && argv[index + 1]) options.resultFile = path.resolve(argv[++index]);
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  if (!options.readOnly) throw new Error('Native reference capture is read-only; pass --read-only explicitly');
  if (!ALLOWED_HOSTS.has(options.host)) throw new Error(`Host ${options.host || '(missing)'} is not an approved loopback CDP host`);
  if (!ALLOWED_PORTS.has(options.port)) throw new Error(`Port ${options.port || '(missing)'} is not an approved local CDP harness port`);
  if (!options.title && !options.urlPrefix) throw new Error('Specify --title and/or --url-prefix to identify one exact page target');
  if (!options.output) throw new Error('--output is required');
  const relativeOutput = path.relative(EVIDENCE_ROOT, options.output);
  if (relativeOutput.startsWith('..') || path.isAbsolute(relativeOutput)) throw new Error('Output must stay under the evidence tree');
  if (path.extname(options.output).toLowerCase() !== '.png') throw new Error('Output must be a PNG file');
  if (options.resultFile) {
    const relativeResult = path.relative(EVIDENCE_ROOT, options.resultFile);
    if (relativeResult.startsWith('..') || path.isAbsolute(relativeResult)) throw new Error('Result file must stay under the evidence tree');
    if (path.extname(options.resultFile).toLowerCase() !== '.json') throw new Error('Result file must be JSON');
  }
  return options;
}

async function capture(options) {
  const httpHost = options.host.includes(':') ? `[${options.host}]` : options.host;
  const response = await fetch(`http://${httpHost}:${options.port}/json/list`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`CDP target inventory returned HTTP ${response.status}`);
  const targets = (await response.json()).filter(target => target.type === 'page'
    && (!options.title || target.title === options.title)
    && (!options.urlPrefix || String(target.url || '').startsWith(options.urlPrefix)));
  if (targets.length !== 1) throw new Error(`Expected one exact page target, found ${targets.length}`);

  const target = targets[0];
  const client = await CDP({ host: options.host, port: options.port, target });
  try {
    await client.Page.enable();
    const before = await client.Runtime.evaluate({
      expression: `({ visibility: document.visibilityState, hasFocus: document.hasFocus(), title: document.title, url: location.href })`,
      returnByValue: true,
    });
    const screenshot = await client.Page.captureScreenshot({
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    });
    const buffer = Buffer.from(screenshot.data, 'base64');
    const png = PNG.sync.read(buffer);
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, buffer);
    return {
      ok: true,
      read_only: true,
      generated_at: new Date().toISOString(),
      host: options.host,
      port: options.port,
      target: { id: target.id, type: target.type, title: target.title, url: target.url },
      page_state_before_capture: before.result.value,
      output: path.relative(ROOT, options.output).replace(/\\/g, '/'),
      sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
      width: png.width,
      height: png.height,
      bytes: buffer.length,
      focus_actions: 0,
      visible_windows_opened: 0,
      mutations: 0,
    };
  } finally {
    await client.close();
  }
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const result = await capture(options);
  if (options.resultFile) {
    fs.mkdirSync(path.dirname(options.resultFile), { recursive: true });
    fs.writeFileSync(options.resultFile, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  }
  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = { ALLOWED_HOSTS, ALLOWED_PORTS, capture, main, parseArgs };
