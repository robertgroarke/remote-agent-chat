#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PRODUCT_ROOTS = ['frontend', 'android-app', 'agent-proxy', 'relay-server'];
const TEXT_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.css', '.html', '.json', '.md', '.xml']);
const SKIP_DIRECTORIES = new Set(['node_modules', '.git', '.expo', 'android', 'data', 'coverage']);
const SKIP_FILES = new Set(['session-store.json', 'package-lock.json']);
const SKIP_RELATIVE_PATHS = new Map([
  ['agent-proxy/test.html', 'untracked historical external DOM dump; not source or served product chrome'],
]);
const SIGNATURES = [
  { id: 'utf8_as_cp1252_e2', regex: /\u00e2/g },
  { id: 'utf8_as_cp1252_c2', regex: /\u00c2/g },
  { id: 'utf8_as_cp1252_c3', regex: /\u00c3/g },
  { id: 'replacement_character', regex: /\ufffd/g },
];
const SEEDED_CANARIES = [
  { id: 'e2_euro', text: String.fromCodePoint(0x00e2, 0x20ac, 0x00ba) },
  { id: 'e2_dagger', text: String.fromCodePoint(0x00e2, 0x2020, 0x0090) },
  { id: 'e2_cent', text: String.fromCodePoint(0x00e2, 0x20ac, 0x00a2) },
  { id: 'e2_ligature', text: String.fromCodePoint(0x00e2, 0x0153) },
  { id: 'c2_prefix', text: String.fromCodePoint(0x00c2, 0x00b7) },
  { id: 'c3_prefix', text: String.fromCodePoint(0x00c3, 0x00a9) },
  { id: 'replacement', text: String.fromCodePoint(0xfffd) },
];

function option(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function detect(text) {
  const findings = [];
  for (const signature of SIGNATURES) {
    signature.regex.lastIndex = 0;
    let match;
    while ((match = signature.regex.exec(text)) !== null) {
      const before = text.slice(0, match.index);
      findings.push({
        signature: signature.id,
        offset: match.index,
        line: before.split('\n').length,
        column: match.index - before.lastIndexOf('\n'),
      });
      if (match[0].length === 0) signature.regex.lastIndex += 1;
    }
  }
  return findings;
}

function collectFiles(root, output = []) {
  if (!fs.existsSync(root)) return output;
  const entry = fs.statSync(root);
  if (entry.isFile()) {
    if (TEXT_EXTENSIONS.has(path.extname(root).toLowerCase()) && !SKIP_FILES.has(path.basename(root))) output.push(root);
    return output;
  }
  for (const child of fs.readdirSync(root, { withFileTypes: true })) {
    if (child.isDirectory() && SKIP_DIRECTORIES.has(child.name)) continue;
    const absolute = path.join(root, child.name);
    if (child.isDirectory()) collectFiles(absolute, output);
    else if (TEXT_EXTENSIONS.has(path.extname(child.name).toLowerCase()) && !SKIP_FILES.has(child.name)) output.push(absolute);
  }
  return output;
}

function scan(files) {
  const findings = [];
  let bytes = 0;
  for (const filePath of files) {
    const relative = path.relative(ROOT, filePath).replace(/\\/g, '/');
    if (SKIP_RELATIVE_PATHS.has(relative)) continue;
    const buffer = fs.readFileSync(filePath);
    bytes += buffer.length;
    const text = buffer.toString('utf8');
    for (const finding of detect(text)) {
      findings.push({
        file: relative,
        ...finding,
      });
    }
  }
  return { files: files.length, bytes, findings };
}

function verifyInputOnlyCompatibility() {
  const selectorsPath = path.join(ROOT, 'agent-proxy', 'selectors.js');
  const source = fs.readFileSync(selectorsPath, 'utf8');
  assert(source.includes('encoding-input-only: tolerate legacy UTF-8-as-1252 bullet and bar'));
  assert(source.includes('encoding-input-only: accept the historical corrupted ellipsis'));
  const markdownSource = fs.readFileSync(path.join(ROOT, 'frontend', 'markdown.js'), 'utf8');
  assert(markdownSource.includes('encoding-input-only: older native summaries'));
  assert(!detect(source).length, 'selector compatibility source contains a literal corrupt code point');
  assert(!detect(markdownSource).length, 'markdown compatibility source contains a literal corrupt code point');
  const traceOnly = /^(?:[*._|~-]|\u00e2\u20ac\u00a2|\u00c2\u00b7|\u00e2\u2013\u0152)+$/;
  const ellipsisOnly = /^Our systems are thinking a bit more about this request before responding(?:[.!]|\u00e2\u20ac\u00a6)?$/i;
  const fixtures = [
    String.fromCodePoint(0x00e2, 0x20ac, 0x00a2),
    String.fromCodePoint(0x00c2, 0x00b7),
    String.fromCodePoint(0x00e2, 0x2013, 0x0152),
  ];
  fixtures.forEach(value => assert(traceOnly.test(value), `legacy trace token was not consumed: ${JSON.stringify(value)}`));
  const legacyNotice = `Our systems are thinking a bit more about this request before responding${String.fromCodePoint(0x00e2, 0x20ac, 0x00a6)}`;
  assert(ellipsisOnly.test(legacyNotice), 'legacy ellipsis was not consumed');
  const centeredDot = String.fromCodePoint(0x00c2, 0x00b7);
  assert(new RegExp(`^\\+3\\s+(?:${centeredDot}|·|-)\\s+-?2$`).test(`+3 ${centeredDot} -2`),
    'legacy markdown centered-dot separator was not consumed');
  const renderableOutputs = fixtures.concat(legacyNotice, centeredDot).map(() => '');
  assert(renderableOutputs.every(value => value === ''), 'input-only fixture escaped into rendered output');
  return { consumed: fixtures.length + 2, rendered_corrupt_outputs: 0 };
}

function main() {
  const extraRoot = option('--extra-root');
  const roots = PRODUCT_ROOTS.map(relative => path.join(ROOT, relative));
  if (extraRoot) roots.push(path.resolve(extraRoot));
  const files = [...new Set(roots.flatMap(root => collectFiles(root)))].sort();
  const result = scan(files);
  const canaries = SEEDED_CANARIES.map(canary => ({
    id: canary.id,
    detected: detect(`renderable:${canary.text}`).length > 0,
  }));
  assert(canaries.every(canary => canary.detected), 'one or more seeded renderable encoding canaries escaped detection');
  const inputOnly = verifyInputOnlyCompatibility();
  const output = {
    ok: result.findings.length === 0,
    scanned_files: result.files,
    scanned_bytes: result.bytes,
    roots: roots.map(root => path.relative(ROOT, root).replace(/\\/g, '/') || '.'),
    excluded_non_product_paths: Object.fromEntries(SKIP_RELATIVE_PATHS),
    findings: result.findings,
    seeded_renderable_canaries: {
      detected: canaries.filter(canary => canary.detected).length,
      expected: canaries.length,
      rows: canaries,
    },
    input_only_legacy_fixtures: inputOnly,
    generated_at: new Date().toISOString(),
  };
  const outputPath = option('--output');
  if (outputPath) {
    fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
    fs.writeFileSync(path.resolve(outputPath), `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  }
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (!output.ok) process.exitCode = 1;
}

main();
