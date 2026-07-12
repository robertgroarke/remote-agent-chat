#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { validateAttachmentPayload } = require('../agent-proxy/proxy-engine');

const relaySource = fs.readFileSync(path.join(__dirname, '..', 'relay-server', 'index.js'), 'utf8');
const selectorSource = fs.readFileSync(path.join(__dirname, '..', 'agent-proxy', 'selectors.js'), 'utf8');
for (const field of ['data', 'mime_type', 'filename']) {
  assert(
    relaySource.includes(`...(msg.${field} != null ? { ${field}: msg.${field} } : {})`),
    `relay must preserve send_attachment field ${field}`,
  );
}
assert(
  /async function injectCodexImage[\s\S]*?const raw = await evalFn\(Runtime, `\s*return \(async function\(\)/.test(selectorSource),
  'Codex image injection must return its inner result through the frame evaluator',
);

const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const valid = validateAttachmentPayload(pixel, 'image/png', 'pixel.png');
assert.deepEqual(
  { ok: valid.ok, mime_type: valid.mime_type, filename: valid.filename, size: valid.size },
  { ok: true, mime_type: 'image/png', filename: 'pixel.png', size: 68 },
);
assert.equal(validateAttachmentPayload('', 'image/png', 'empty.png').code, 'invalid_message');
assert.equal(validateAttachmentPayload('not base64', 'image/png', 'bad.png').code, 'invalid_base64');
assert.equal(validateAttachmentPayload(pixel, 'text/plain', 'pixel.txt').code, 'invalid_mime_type');
const oversized = Buffer.alloc(10 * 1024 * 1024 + 1).toString('base64');
assert.equal(validateAttachmentPayload(oversized, 'image/png', 'huge.png').code, 'attachment_too_large');

console.log(JSON.stringify({
  ok: true,
  forwarded_fields: ['data', 'mime_type', 'filename'],
  valid_image_bytes: valid.size,
  invalid_payloads_rejected: 4,
}, null, 2));
