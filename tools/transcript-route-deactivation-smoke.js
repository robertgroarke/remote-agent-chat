#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(ROOT, 'frontend', 'app.jsx'), 'utf8').replace(/\r\n/g, '\n');
const start = app.indexOf('function useTranscriptWindow');
const end = app.indexOf('function QueuedItem', start);
assert(start >= 0 && end > start, 'unable to isolate useTranscriptWindow');
const hook = app.slice(start, end);

assert(hook.includes('const enabledRef = React.useRef(enabled);')
  && hook.includes('enabledRef.current = enabled;'),
'transcript window must expose current route activity to queued measurement callbacks');
assert(hook.includes('const onMeasure = React.useCallback((index, key, rawHeight) => {\n    if (!enabledRef.current) return;'),
  'row measurements must stop immediately after the chat route deactivates');
assert(hook.includes('if (!enabledRef.current) {\n        pendingAnchorDeltaRef.current = 0;\n        return;'),
  'a measurement frame queued before navigation must fail closed after route deactivation');
assert(hook.includes('if (enabled || !measureFrameRef.current) return;')
  && hook.includes('cancelAnimationFrame(measureFrameRef.current);'),
  'route deactivation must cancel the pending transcript measurement frame');

console.log('PASS transcript route deactivation cancels stale measurement work');
