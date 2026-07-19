'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const esbuild = require('../frontend/node_modules/esbuild');

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function loadModule(relativePath) {
  const source = read(relativePath);
  const transformed = esbuild.transformSync(source, {
    loader: 'js',
    format: 'cjs',
    target: 'es2020',
  }).code;
  const module = { exports: {} };
  Function('module', 'exports', 'require', '__filename', '__dirname', transformed)(
    module,
    module.exports,
    require,
    path.join(ROOT, relativePath),
    path.dirname(path.join(ROOT, relativePath)),
  );
  return module.exports;
}

function luminance(hex) {
  const values = hex.replace('#', '').match(/.{2}/g).map(value => parseInt(value, 16) / 255);
  const linear = values.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(left, right) {
  const a = luminance(left);
  const b = luminance(right);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const web = loadModule('frontend/message-time.js');
const android = loadModule('android-app/lib/message-time.js');
const modules = [web, android];

process.env.TZ = 'America/Los_Angeles';

for (const timestamp of [
  1_720_000_000.125,
  1_720_000_000_125,
  '1720000000.125',
  '2024-07-03T09:46:40.125Z',
]) {
  const expected = '2024-07-03T09:46:40.125Z';
  for (const api of modules) assert.strictEqual(api.parseMessageInstant(timestamp)?.iso, expected);
}

for (const api of modules) {
  assert.strictEqual(api.messageInstant(null), null);
  assert.strictEqual(api.messageInstant({ ts: 0 }), null);
  assert.strictEqual(api.messageInstant({ timestamp: 'malformed' }), null);
  const normalized = api.normalizeMessageTimestamp({
    created_at: '2024-07-03T09:46:40.125Z',
    timestamp: '2020-01-01T00:00:00Z',
    ts: 1,
  });
  assert.strictEqual(normalized.timestamp, '2024-07-03T09:46:40.125Z');
  assert.strictEqual(normalized.timestamp_ms, 1_720_000_000_125);
  assert.strictEqual(normalized.ts, 1_720_000_000.125);

  const repeatedHourA = api.parseMessageInstant('2025-11-02T08:30:00Z');
  const repeatedHourB = api.parseMessageInstant('2025-11-02T09:30:00Z');
  const absoluteA = api.formatAbsoluteMessageTime(repeatedHourA, 'en-US');
  const absoluteB = api.formatAbsoluteMessageTime(repeatedHourB, 'en-US');
  assert.notStrictEqual(absoluteA, absoluteB, 'DST duplicate hour needs a distinct accessible full value');
  assert.match(absoluteA, /PDT|Pacific Daylight Time/);
  assert.match(absoluteB, /PST|Pacific Standard Time/);
  assert.match(absoluteA, /2025-11-02T08:30:00\.000Z/,
    'accessible full timestamp must retain the exact machine-readable instant');

  const sameDay = api.formatVisibleMessageTime(
    api.parseMessageInstant('2026-07-15T11:12:00Z'),
    new Date('2026-07-15T18:00:00Z'),
    'en-US',
  );
  assert.strictEqual(sameDay, 'Jul 15, 4:12 AM',
    'same-day visible timestamps must include an unambiguous calendar date');

  const yesterday = api.formatVisibleMessageTime(
    api.parseMessageInstant('2026-07-14T23:45:00Z'),
    new Date('2026-07-15T18:00:00Z'),
    'en-US',
    'America/Los_Angeles',
  );
  assert.strictEqual(yesterday, 'Jul 14, 4:45 PM');

  const crossMidnight = api.formatVisibleMessageTime(
    api.parseMessageInstant('2026-07-16T07:15:00Z'),
    new Date('2026-07-16T06:30:00Z'),
    'en-US',
    'America/Los_Angeles',
  );
  assert.strictEqual(crossMidnight, 'Jul 16, 12:15 AM');

  const beforeDstGap = api.formatVisibleMessageTime(
    api.parseMessageInstant('2025-03-09T09:30:00Z'),
    new Date('2025-03-09T18:00:00Z'),
    'en-US',
    'America/Los_Angeles',
  );
  const afterDstGap = api.formatVisibleMessageTime(
    api.parseMessageInstant('2025-03-09T10:30:00Z'),
    new Date('2025-03-09T18:00:00Z'),
    'en-US',
    'America/Los_Angeles',
  );
  assert.strictEqual(beforeDstGap, 'Mar 9, 1:30 AM');
  assert.strictEqual(afterDstGap, 'Mar 9, 3:30 AM');

  const longLocale = api.formatVisibleMessageTime(
    api.parseMessageInstant('2026-09-15T11:12:00Z'),
    new Date('2026-09-15T18:00:00Z'),
    'de-DE',
    'America/Los_Angeles',
  );
  assert.match(longLocale, /15\. Sept\./);

  const oldYear = api.formatVisibleMessageTime(
    api.parseMessageInstant('2024-12-31T23:59:00Z'),
    new Date('2025-01-01T12:00:00Z'),
    'en-US',
  );
  assert.match(oldYear, /2024/);
}

const probes = [
  { created_at: '2025-03-08T12:34:56.789Z' },
  { timestamp: 1_741_437_296_789 },
  { ts: 1_741_437_296.789 },
  { ts: 'bad' },
];
for (const probe of probes) {
  const webResult = web.normalizeMessageTimestamp(probe);
  const androidResult = android.normalizeMessageTimestamp(probe);
  assert.deepStrictEqual(webResult, androidResult, 'web and Android normalization must stay identical');
}

const appSource = read('frontend/app.jsx');
const hooksSource = read('frontend/hooks.jsx');
const cssSource = read('frontend/styles.css');
const androidBubble = read('android-app/components/MessageBubble.jsx');
const androidScreen = read('android-app/screens/ChatScreen.jsx');
const protocolSource = read('agent-proxy/protocol.js');
const relaySource = read('relay-server/index.js');
const protocol = require('../agent-proxy/protocol');

assert.match(appSource, /<time[\s\S]*dateTime=\{parsed\.iso\}[\s\S]*aria-label=\{`Sent \$\{absolute\}`\}/);
assert.match(appSource, /message-timestamp-unknown[\s\S]*Sent time unknown/);
assert.match(appSource, /<MessageTimestamp message=\{msg\} \/>/);
assert.match(appSource, /<MessageTimestamp instant=\{stream\?\.startedAtMs\} \/>/);
assert.doesNotMatch(cssSource, /data-layout="(?:codex-terminal|cursor-cards)"\][^\n]*\.message-role\s*\{\s*display:\s*none/);
assert.match(cssSource, /\.message-timestamp\s*\{[\s\S]*font-size:\s*12px[\s\S]*color:\s*var\(--text2\)/);
assert.match(hooksSource, /type: 'send', session, content, client_message_id: cid, created_at: createdAt/);
assert.doesNotMatch(hooksSource, /ts:\s*msg\.ts\s*\|\|\s*Date\.now\(\)/);
assert.match(androidBubble, /accessibilityLabel=\{`Sent \$\{absoluteTimestamp\}`\}/);
assert.match(androidBubble, /visibleTimestamp/);
assert.match(androidScreen, /normalizeTranscriptTimestamps/);
assert.match(androidScreen, /ProvisionalBubble[\s\S]*accessibilityLabel=\{`Sent \$\{absoluteTimestamp\}`\}/);

const proxyMessageBody = protocolSource.slice(
  protocolSource.indexOf('function proxyMessage('),
  protocolSource.indexOf('function messageDelta('),
);
assert.doesNotMatch(proxyMessageBody, /new Date\(\)\.toISOString\(\)/);
const sourceTimedFrame = protocol.proxyMessage('timestamp-smoke', 'assistant', 'redacted', {
  created_at: '2024-07-03T09:46:40.125Z',
});
assert.strictEqual(sourceTimedFrame.created_at, '2024-07-03T09:46:40.125Z');
assert.strictEqual(sourceTimedFrame.message.created_at, '2024-07-03T09:46:40.125Z');
assert.strictEqual(sourceTimedFrame.ts, 1_720_000_000.125);
const missingTimeFrame = protocol.proxyMessage('timestamp-smoke', 'assistant', 'redacted');
assert.ok(!Object.hasOwn(missingTimeFrame, 'created_at'));
assert.ok(!Object.hasOwn(missingTimeFrame, 'ts'));
assert.match(relaySource, /function proxyMessageTimestampSeconds[\s\S]*:\s*0;/);
assert.match(relaySource,
  /insertMessageIdempotent\(\s*id,\s*'user',\s*content,\s*clientMsgId,\s*'accepted',\s*seq,\s*messageTs\s*\)/);
assert.match(relaySource, /const messageTs = clientMessageTs > 0|let messageTs = clientMessageTs > 0/);

const contrastPairs = [
  ['web dark', '#9aa0a6', '#202124'],
  ['web light', '#5f6368', '#ffffff'],
  ['Android dark', '#8b949e', '#0b0f14'],
  ['Android light', '#5f6368', '#ffffff'],
];
for (const [label, foreground, background] of contrastPairs) {
  assert.ok(contrast(foreground, background) >= 4.5, `${label} timestamp contrast must meet WCAG AA`);
}

esbuild.buildSync({
  entryPoints: [path.join(ROOT, 'frontend', 'entry.jsx')],
  bundle: true,
  write: false,
  format: 'iife',
  target: ['chrome90'],
  loader: { '.js': 'jsx' },
});
esbuild.transformSync(androidBubble, { loader: 'jsx', target: 'es2020' });
esbuild.transformSync(androidScreen, { loader: 'jsx', target: 'es2020' });

console.log('Message timestamp contract smoke passed (web + Android, AA contrast, DST, unknown legacy input)');
