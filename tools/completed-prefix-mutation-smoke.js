#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  completedPrefixMutationIndex,
  appendedMutationCandidateStableEnd,
} = require('../agent-proxy/proxy-engine');

const user = { role: 'user', content: 'Run the owned command.' };
const running = {
  role: 'assistant',
  content: 'IN\npowershell -NoProfile -Command "Write-Output RAC_OWNED"',
  content_blocks: [{
    type: 'terminal',
    command: 'powershell -NoProfile -Command "Write-Output RAC_OWNED"',
    stdout: '',
    status: 'running',
  }],
};
const completed = {
  role: 'assistant',
  content: 'IN\npowershell -NoProfile -Command "Write-Output RAC_OWNED"\nOUT\nRAC_OWNED',
  content_blocks: [{
    type: 'terminal',
    command: 'powershell -NoProfile -Command "Write-Output RAC_OWNED"',
    stdout: 'RAC_OWNED',
    status: 'completed',
  }],
};
const finalAnswer = { role: 'assistant', content: 'Command completed.' };

assert.equal(
  completedPrefixMutationIndex([user, running], [user, completed, finalAnswer], 2),
  1,
  'a completed sent tool row must be resynced even when a final assistant tail appends in the same poll',
);
assert.equal(
  completedPrefixMutationIndex([user, running], [user, running, finalAnswer], 2),
  -1,
  'a pure append must not trigger a prefix resync',
);
assert.equal(
  completedPrefixMutationIndex([user, running], [user, completed, finalAnswer], 1),
  -1,
  'mutations outside the already-sent prefix remain pending-tail work',
);
assert.equal(
  completedPrefixMutationIndex(
    [user, { ...running, content: 'same' }],
    [user, { ...completed, content: 'same' }, finalAnswer],
    2,
  ),
  1,
  'content-block-only completion must be detected',
);
assert.equal(
  appendedMutationCandidateStableEnd([user, completed], [user, completed, finalAnswer]),
  2,
  'a same-length completed mutation candidate must survive until the final tail appends',
);
assert.equal(
  appendedMutationCandidateStableEnd([user, running], [user, completed, finalAnswer]),
  -1,
  'an appended tail must not validate a candidate whose prefix changed again',
);
assert.equal(
  appendedMutationCandidateStableEnd([user, completed], [user, completed]),
  -1,
  'a same-length candidate still needs the normal two-poll stabilization path',
);

const engineSource = fs.readFileSync(path.join(__dirname, '..', 'agent-proxy', 'proxy-engine.js'), 'utf8');
const branchToken = 'if (prefixMutationIndex >= 0 || appendedCandidateStableEnd >= 0) {';
assert.equal(engineSource.split(branchToken).length - 1, 1, 'prefix mutation recovery branch must exist exactly once');
const branchIndex = engineSource.indexOf(branchToken);
const regressionIndex = engineSource.indexOf('if (effectiveMessages.length < prevObservedCount)', branchIndex);
const catchIndex = engineSource.indexOf('} catch (e) {', branchIndex);
assert(branchIndex >= 0 && regressionIndex > branchIndex && catchIndex > regressionIndex,
  'prefix mutation recovery must run in the transcript-processing path before regression handling, not in poll error recovery');

console.log('completed prefix mutation smoke: PASS');
