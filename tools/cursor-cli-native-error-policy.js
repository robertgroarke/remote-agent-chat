'use strict';

const assert = require('assert');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const EVIDENCE_ROOT = path.join(ROOT, 'evidence');
const DISPOSABLE_WORKSPACE = path.resolve('C:/temp/cursor-test');

function parseArgs(argv) {
  const options = { probeLiveAuthFailure: false, workspace: '', screenshot: '', resultFile: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--probe-live-auth-failure') options.probeLiveAuthFailure = true;
    else if (arg === '--workspace') options.workspace = path.resolve(argv[++index] || '');
    else if (arg === '--screenshot') options.screenshot = path.resolve(argv[++index] || '');
    else if (arg === '--result-file') options.resultFile = path.resolve(argv[++index] || '');
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  assert(options.probeLiveAuthFailure, 'Explicit --probe-live-auth-failure is required');
  assert.equal(options.workspace.toLowerCase(), DISPOSABLE_WORKSPACE.toLowerCase(),
    `Cursor CLI native error is restricted to ${DISPOSABLE_WORKSPACE}`);
  for (const [label, output, extension] of [
    ['screenshot', options.screenshot, '.png'],
    ['result-file', options.resultFile, '.json'],
  ]) {
    assert(output, `--${label} is required`);
    const relative = path.relative(EVIDENCE_ROOT, output);
    assert(relative && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
      `${label} must stay under the evidence tree`);
    assert.equal(path.extname(output).toLowerCase(), extension, `${label} must use ${extension}`);
  }
  return options;
}

module.exports = { DISPOSABLE_WORKSPACE, EVIDENCE_ROOT, parseArgs };
