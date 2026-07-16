#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
  AGENTS,
  BLOCKS,
  VIEWPORTS,
  THEMES,
  captureAll,
  parseArgs,
} = require('./visual-regression');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'data', 'nightly-visual-regression');

function parseReadOnly(argv) {
  const accepted = new Set(['--read-only']);
  for (const arg of argv) {
    if (!accepted.has(arg)) throw new Error(`Unknown argument: ${arg}`);
  }
  return { readOnly: argv.includes('--read-only') };
}

async function main(argv = process.argv.slice(2)) {
  const { readOnly } = parseReadOnly(argv);
  if (!readOnly) {
    throw new Error('Nightly visual regression is compare-only; pass --read-only explicitly');
  }
  const pending = [...AGENTS];
  const slices = [];
  const workers = Array.from({ length: Math.min(3, AGENTS.length) }, async () => {
    while (pending.length) {
      const agent = pending.shift();
      const outputDir = path.join(OUTPUT_DIR, agent);
      const options = parseArgs([
        '--agent', agent,
        '--output-dir', outputDir,
        '--result-file', path.join(outputDir, 'visual-regression-result.json'),
      ]);
      slices.push(await captureAll(options));
    }
  });
  await Promise.all(workers);
  const result = {
    ok: slices.every(slice => slice.ok),
    cases: slices.flatMap(slice => slice.cases),
    slices: slices.map(slice => ({ ok: slice.ok, cases: slice.cases.length })),
  };
  const resultFile = path.join(OUTPUT_DIR, 'visual-regression-result.json');
  fs.mkdirSync(path.dirname(resultFile), { recursive: true });
  fs.writeFileSync(resultFile, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  const summary = {
    ok: result.ok,
    read_only: true,
    agents: AGENTS.length,
    blocks: BLOCKS.length,
    viewports: Object.keys(VIEWPORTS).length,
    themes: THEMES.length,
    cases: result.cases.length,
    passed: result.cases.filter(row => row.status === 'pass').length,
    failed: result.cases.filter(row => row.status === 'fail').length,
    missing: result.cases.filter(row => row.status === 'missing-golden').length,
    worker_count: workers.length,
    result_file: path.relative(ROOT, resultFile),
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!result.ok) process.exitCode = 1;
  return summary;
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = { OUTPUT_DIR, main, parseReadOnly };
