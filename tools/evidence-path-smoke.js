#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  currentEvidenceRoot,
  evidenceDate,
  freshEvidenceDirectory,
  freshEvidencePath,
} = require('./evidence-path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-evidence-path-'));
const now = new Date('2026-07-16T19:20:21.123Z');

try {
  assert.strictEqual(evidenceDate(now, 'America/Los_Angeles'), '2026-07-16');
  assert.strictEqual(evidenceDate(now, 'Pacific/Kiritimati'), '2026-07-17');

  const dateRoot = currentEvidenceRoot(tempRoot, 'harness-maturity', {
    now,
    timeZone: 'America/Los_Angeles',
  });
  assert.strictEqual(dateRoot, path.join(tempRoot, 'evidence', 'harness-maturity', '2026-07-16'));
  fs.mkdirSync(dateRoot, { recursive: true });

  const original = path.join(dateRoot, 'result.json');
  fs.writeFileSync(original, 'immutable\n', 'utf8');
  const next = freshEvidencePath(tempRoot, 'result.json', {
    now,
    timeZone: 'America/Los_Angeles',
  });
  assert.strictEqual(next, path.join(dateRoot, 'result-run-20260716192021123.json'));
  assert.strictEqual(fs.readFileSync(original, 'utf8'), 'immutable\n');

  const visualRoot = path.join(dateRoot, 'visuals');
  fs.mkdirSync(visualRoot);
  assert.strictEqual(
    freshEvidenceDirectory(tempRoot, 'visuals', { now, timeZone: 'America/Los_Angeles' }),
    path.join(dateRoot, 'visuals-run-20260716192021123'),
  );
  console.log('evidence path immutability smoke: PASS');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
