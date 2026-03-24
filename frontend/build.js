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
const path = require('path');

const isWatch = process.argv.includes('--watch');

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

main().catch(err => {
  console.error(err);
  process.exit(1);
});
