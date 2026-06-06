#!/usr/bin/env node
'use strict';
// Web/API E2E: relay send + REST /api/sessions/.../messages verify (throwaway).
const { spawn } = require('child_process');
const path = require('path');

const child = spawn(
  process.execPath,
  [path.join(__dirname, 'cursor-live-e2e.js'), '--send-live', '--verify-rest', ...process.argv.slice(2)],
  { stdio: 'inherit', env: process.env }
);
child.on('exit', (code) => process.exit(code ?? 1));
