#!/usr/bin/env node
// build.js — esbuild bundler for Agent Chat frontend
//
// Compiles JSX → JS and bundles all frontend modules into a single file.
// Eliminates the need for Babel Standalone in the browser, allowing the
// CSP to drop 'unsafe-eval' (SEC-05).
//
// Usage:
//   node build.js           # one-shot build
//   node build.js --watch   # rebuild on file changes

'use strict';

const esbuild = require('esbuild');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const isWatch = process.argv.includes('--watch');
const publicDir = path.join(__dirname, '..', 'relay-server', 'public');

function copyFile(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, canonicalAssetBytes(fs.readFileSync(source)));
}

function canonicalAssetBytes(value) {
  return Buffer.from(Buffer.from(value).toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
}

function computeAssetVersion(styles, bundle) {
  const digest = crypto.createHash('sha256')
    .update(canonicalAssetBytes(styles))
    .update(canonicalAssetBytes(bundle))
    .digest('hex')
    .slice(0, 16);
  return `build-${digest}`;
}

function stampAssetIdentity() {
  const stylesPath = path.join(__dirname, 'styles.css');
  const bundlePath = path.join(__dirname, 'dist', 'bundle.js');
  const assetVersion = computeAssetVersion(
    fs.readFileSync(stylesPath),
    fs.readFileSync(bundlePath),
  );
  const cacheName = `agent-chat-${assetVersion}`;

  const indexPath = path.join(__dirname, 'index.html');
  const nextIndex = fs.readFileSync(indexPath, 'utf8')
    .replace(/\/styles\.css\?v=[^"']+/g, `/styles.css?v=${assetVersion}`)
    .replace(/\/dist\/bundle\.js\?v=[^"']+/g, `/dist/bundle.js?v=${assetVersion}`);
  fs.writeFileSync(indexPath, nextIndex, 'utf8');

  const workerPath = path.join(__dirname, 'sw.js');
  const nextWorker = fs.readFileSync(workerPath, 'utf8')
    .replace(/const CACHE_NAME = '[^']+';/, `const CACHE_NAME = '${cacheName}';`)
    .replace(/const ASSET_VERSION = '[^']+';/, `const ASSET_VERSION = '${assetVersion}';`);
  fs.writeFileSync(workerPath, nextWorker, 'utf8');
  console.log(`[build] Asset identity ${assetVersion}`);
}

function syncPublicAssets() {
  const assets = ['index.html', 'styles.css', 'app.jsx', 'hooks.jsx', 'file-utils.js', 'fleet-activity.js', 'host-resources.js', 'markdown.js', 'message-delta.js', 'message-time.js', 'navigation-epoch.js', 'provider-usage.js', 'semantic-notifications.js', 'session-pins.js', 'session-registry.js', 'session-title.js', 'state-sequence.js', 'title-disclosure.jsx', 'transcript-cache.js', 'workspace-groups.js', 'broadcast-send-policy.js', 'sw.js'];
  for (const asset of assets) {
    copyFile(path.join(__dirname, asset), path.join(publicDir, asset));
  }
  copyFile(path.join(__dirname, 'dist', 'bundle.js'), path.join(publicDir, 'dist', 'bundle.js'));
  console.log('[build] Synced relay-server/public assets');
}

const syncPublicAssetsPlugin = {
  name: 'sync-public-assets',
  setup(build) {
    build.onEnd(result => {
      if (result.errors.length === 0) {
        stampAssetIdentity();
        syncPublicAssets();
      }
    });
  },
};

const buildOptions = {
  entryPoints: [path.join(__dirname, 'entry.jsx')],
  bundle: true,
  outfile: path.join(__dirname, 'dist', 'bundle.js'),
  format: 'iife',
  // React, ReactDOM, DOMPurify, marked, hljs stay as CDN globals
  external: [],
  loader: { '.js': 'jsx' },
  jsx: 'transform',
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment',
  target: ['es2020'],
  minify: !isWatch,
  sourcemap: isWatch ? 'inline' : false,
  logLevel: 'info',
  // Treat CDN globals as externals that esbuild won't try to resolve
  define: {},
  plugins: [syncPublicAssetsPlugin],
};

async function main() {
  if (isWatch) {
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();
    console.log('[build] Watching for changes...');
  } else {
    await esbuild.build(buildOptions);
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  canonicalAssetBytes,
  computeAssetVersion,
};
