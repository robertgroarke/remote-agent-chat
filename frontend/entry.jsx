// entry.jsx — esbuild entry point for Agent Chat frontend
//
// Imports all modules in dependency order. esbuild bundles them into a single
// dist/bundle.js, eliminating the need for Babel Standalone in the browser.
//
// CDN globals (React, ReactDOM, DOMPurify, marked, hljs) are NOT bundled —
// they're loaded from <script> tags in index.html and accessed as window globals.

// App (transitively imports file-utils, markdown, hooks)
import './app.jsx';

// PWA init (service worker registration, standalone detection)
import './init.js';
