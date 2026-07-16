#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const ANDROID_ROOT = path.join(ROOT, 'android-app');

function parseArgs(argv) {
  const options = {
    canonicalRoot: '',
    outputDir: '',
    manifest: '',
    requireClean: false,
    requireDetached: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--canonical-root' && next) options.canonicalRoot = path.resolve(argv[++index]);
    else if (arg === '--output-dir' && next) options.outputDir = path.resolve(argv[++index]);
    else if (arg === '--manifest' && next) options.manifest = path.resolve(argv[++index]);
    else if (arg === '--require-clean') options.requireClean = true;
    else if (arg === '--require-detached') options.requireDetached = true;
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  assert(options.canonicalRoot, '--canonical-root is required');
  assert(options.outputDir, '--output-dir is required');
  assert(options.manifest, '--manifest is required');
  assert.notStrictEqual(path.resolve(options.canonicalRoot), ROOT,
    'canonical checkout must be distinct from the isolated export worktree');
  return options;
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function normalizedText(value) {
  return String(value || '').replace(/\r\n/g, '\n');
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trimEnd();
}

function trackedStatus(cwd) {
  const raw = git(['status', '--porcelain=v2', '--untracked-files=no'], cwd);
  return {
    head: git(['rev-parse', 'HEAD'], cwd),
    byte_count: Buffer.byteLength(raw, 'utf8'),
    sha256: sha256(Buffer.from(raw, 'utf8')),
  };
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function walkFiles(directory) {
  const files = [];
  const visit = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) visit(full);
      else files.push(full);
    }
  };
  visit(directory);
  return files.sort((left, right) => left.localeCompare(right));
}

function outputInventory(outputDir) {
  const files = walkFiles(outputDir).map(file => {
    const bytes = fs.readFileSync(file);
    return {
      path: path.relative(outputDir, file).replace(/\\/g, '/'),
      bytes: bytes.length,
      sha256: sha256(bytes),
    };
  });
  const tree = crypto.createHash('sha256');
  for (const file of files) tree.update(`${file.path}\0${file.bytes}\0${file.sha256}\n`);
  return { files, tree_sha256: tree.digest('hex') };
}

function analyzeSourceMap(mapPath) {
  const sourceMap = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  assert(Array.isArray(sourceMap.sources), 'export source map has no sources array');
  assert(Array.isArray(sourceMap.sourcesContent), 'export source map has no sourcesContent array');
  const firstParty = [];
  const outside = [];
  for (let index = 0; index < sourceMap.sources.length; index += 1) {
    const source = String(sourceMap.sources[index] || '').replace(/\\/g, '/').replace(/^\u0000/, '');
    if (!source || source.includes('/node_modules/') || source.startsWith('polyfill:') || source === 'external-require') continue;
    const relative = source.replace(/^\/+/, '');
    const resolved = path.resolve(ANDROID_ROOT, relative);
    if (!isInside(ANDROID_ROOT, resolved) || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      outside.push(source);
      continue;
    }
    const disk = normalizedText(fs.readFileSync(resolved, 'utf8'));
    const mapped = normalizedText(sourceMap.sourcesContent[index]);
    assert.strictEqual(mapped, disk, `mapped first-party source does not match active worktree: ${source}`);
    firstParty.push({
      source,
      path: path.relative(ROOT, resolved).replace(/\\/g, '/'),
      sha256: sha256(Buffer.from(disk, 'utf8')),
    });
  }
  assert(firstParty.some(row => row.path === 'android-app/index.js'), 'local Expo entrypoint missing from source map');
  assert(firstParty.some(row => row.path === 'android-app/App.jsx'), 'local App.jsx missing from source map');
  assert.deepStrictEqual(outside, [], `first-party sources escaped active worktree: ${outside.join(', ')}`);
  const roots = [...new Set(firstParty.map(row => {
    const relative = row.path.replace(/^android-app\//, '');
    return relative.includes('/') ? `android-app/${relative.split('/')[0]}` : 'android-app';
  }))].sort();
  const sourceTree = crypto.createHash('sha256');
  for (const row of firstParty.sort((left, right) => left.path.localeCompare(right.path))) {
    sourceTree.update(`${row.path}\0${row.sha256}\n`);
  }
  return {
    source_map_modules: sourceMap.sources.length,
    first_party_sources: firstParty,
    first_party_source_count: firstParty.length,
    first_party_source_roots: roots,
    first_party_source_tree_sha256: sourceTree.digest('hex'),
    outside_first_party_sources: outside,
  };
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const activeRoot = path.resolve(git(['rev-parse', '--show-toplevel'], ROOT));
  assert.strictEqual(activeRoot.toLowerCase(), ROOT.toLowerCase(), 'tool is not running from its active worktree root');
  if (options.requireClean) {
    assert.strictEqual(git(['status', '--porcelain=v2', '--untracked-files=no'], ROOT), '',
      'active worktree has tracked changes; commit before exact-source export');
  }
  if (options.requireDetached) {
    const symbolic = spawnSync('git', ['symbolic-ref', '-q', 'HEAD'], {
      cwd: ROOT, encoding: 'utf8', shell: false, windowsHide: true,
    });
    assert.notStrictEqual(symbolic.status, 0, 'exact-source export worktree must be detached');
  }

  const packageJson = JSON.parse(fs.readFileSync(path.join(ANDROID_ROOT, 'package.json'), 'utf8'));
  assert.strictEqual(packageJson.main, 'index.js', 'Expo main must be the repository-local index.js');
  const entrypoint = path.resolve(ANDROID_ROOT, packageJson.main);
  assert(isInside(ANDROID_ROOT, entrypoint) && fs.existsSync(entrypoint),
    'resolved Expo entrypoint escaped or is missing from the active worktree');

  const activeBefore = trackedStatus(ROOT);
  const canonicalBefore = trackedStatus(options.canonicalRoot);
  const expoCli = path.join(ANDROID_ROOT, 'node_modules', 'expo', 'bin', 'cli');
  assert(fs.existsSync(expoCli), 'local Expo CLI is missing; install Android dependencies first');
  const exported = spawnSync(process.execPath, [
    expoCli, 'export', '--platform', 'android', '--source-maps',
    '--output-dir', options.outputDir, '--clear',
  ], {
    cwd: ANDROID_ROOT,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 180_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  const exportLog = `${exported.stdout || ''}\n${exported.stderr || ''}`;
  assert(!exported.error, `Expo export failed to run: ${exported.error?.message || 'unknown error'}`);
  assert.strictEqual(exported.status, 0, `Expo export failed:\n${exportLog.slice(-5000)}`);
  const moduleMatch = exportLog.match(/\(([\d,]+) modules\)/);
  assert(moduleMatch, 'Expo export log did not report a module count');

  const inventory = outputInventory(options.outputDir);
  const bundle = inventory.files.find(file => file.path.endsWith('.hbc'));
  const sourceMapFile = inventory.files.find(file => file.path.endsWith('.hbc.map'));
  assert(bundle, 'Hermes bundle missing from export');
  assert(sourceMapFile, 'Hermes source map missing from export');
  const sourceAnalysis = analyzeSourceMap(path.join(options.outputDir, ...sourceMapFile.path.split('/')));
  const activeAfter = trackedStatus(ROOT);
  const canonicalAfter = trackedStatus(options.canonicalRoot);
  assert.deepStrictEqual(activeAfter, activeBefore,
    'Android export changed the detached active worktree tracked status or HEAD');
  assert.deepStrictEqual(canonicalAfter, canonicalBefore,
    'isolated Android export changed the canonical checkout tracked status or HEAD');

  const result = {
    ok: true,
    generated_at: new Date().toISOString(),
    source_commit: git(['rev-parse', 'HEAD'], ROOT),
    active_worktree_root: ROOT,
    detached_head_required: options.requireDetached,
    tracked_clean_required: options.requireClean,
    entrypoint: {
      package_main: packageJson.main,
      resolved_relative: path.relative(ROOT, entrypoint).replace(/\\/g, '/'),
      inside_active_worktree: isInside(ROOT, entrypoint),
      sha256: sha256(fs.readFileSync(entrypoint)),
    },
    export: {
      module_count: Number(moduleMatch[1].replace(/,/g, '')),
      bundle,
      source_map: sourceMapFile,
      file_count: inventory.files.length,
      tree_sha256: inventory.tree_sha256,
    },
    source_map: sourceAnalysis,
    active_worktree: {
      root: ROOT,
      tracked_status_before: activeBefore,
      tracked_status_after: activeAfter,
      byte_for_byte_unchanged: true,
    },
    canonical_checkout: {
      root: options.canonicalRoot,
      tracked_status_before: canonicalBefore,
      tracked_status_after: canonicalAfter,
      byte_for_byte_unchanged: true,
    },
    automation: {
      headless_cli_only: true,
      visible_windows_opened: 0,
      focus_actions: 0,
      production_mutations: 0,
    },
  };
  fs.mkdirSync(path.dirname(options.manifest), { recursive: true });
  fs.writeFileSync(options.manifest, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({
    ok: true,
    source_commit: result.source_commit,
    module_count: result.export.module_count,
    bundle_bytes: result.export.bundle.bytes,
    bundle_sha256: result.export.bundle.sha256,
    first_party_source_count: result.source_map.first_party_source_count,
    first_party_source_roots: result.source_map.first_party_source_roots,
    outside_first_party_sources: result.source_map.outside_first_party_sources,
    active_worktree_unchanged: true,
    canonical_checkout_unchanged: true,
    manifest: options.manifest,
  }, null, 2)}\n`);
  return result;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Android clean-worktree export contract: FAIL (${error.stack || error.message})`);
    process.exitCode = 1;
  }
}

module.exports = { analyzeSourceMap, isInside, main, parseArgs };
