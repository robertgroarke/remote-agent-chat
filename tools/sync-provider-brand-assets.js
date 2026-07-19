#!/usr/bin/env node
'use strict';

const path = require('path');
const { syncProviderAssets } = require('./provider-brand-assets');

const root = path.join(__dirname, '..');
const source = path.join(root, 'provider-assets');
const destinations = [
  path.join(root, 'android-app', 'assets', 'providers'),
  path.join(root, 'relay-server', 'public', 'provider-assets'),
];

for (const destination of destinations) {
  const result = syncProviderAssets(source, destination);
  console.log(`[provider-assets] Synced ${result.files.length} files to ${path.relative(root, destination)}`);
}
