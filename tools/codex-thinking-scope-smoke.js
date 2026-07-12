#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'agent-proxy', 'selectors.js'), 'utf8');
const detector = source.match(
  /if \(agentType === 'codex' \|\| agentType === 'codex-desktop'\)([\s\S]*?)if \(agentType === 'claude'/,
);
assert(detector, 'Codex thinking detector block not found');
assert(
  detector[1].includes("d.querySelectorAll('span[class*=\"loading-shimmer\"]')"),
  'Codex thinking detection must include visible queued-task shimmers outside the conversation root',
);
assert(
  !detector[1].includes("convForShimmer.querySelectorAll('span[class*=\"loading-shimmer\"]')"),
  'Codex thinking shimmer detection must not be limited to the conversation root',
);
assert(
  detector[1].includes('shimmers[si].offsetParent !== null'),
  'Codex thinking detection must retain the visible-element gate',
);

console.log(JSON.stringify({
  ok: true,
  selector_scope: 'document',
  historical_plain_text_excluded: true,
  visibility_gate: 'offsetParent',
}, null, 2));
