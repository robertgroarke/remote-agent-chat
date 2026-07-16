'use strict';

const fs = require('fs');

function readTail(filePath, maxBytes) {
  const stat = fs.statSync(filePath);
  const length = Math.min(stat.size, maxBytes);
  const buffer = Buffer.allocUnsafe(length);
  const handle = fs.openSync(filePath, 'r');
  try { fs.readSync(handle, buffer, 0, length, stat.size - length); } finally { fs.closeSync(handle); }
  return buffer;
}

function appendBoundedFileSync(filePath, value, maxBytes = 1024 * 1024) {
  let data = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  const limit = Math.max(1024, Number(maxBytes) || 1024 * 1024);
  let currentBytes = 0;
  try { currentBytes = fs.statSync(filePath).size; } catch {}
  if (currentBytes + data.length > limit) {
    try {
      const retained = fs.existsSync(filePath) ? readTail(filePath, Math.floor(limit / 2)) : Buffer.alloc(0);
      fs.writeFileSync(`${filePath}.1`, retained);
    } catch {}
    fs.writeFileSync(filePath, '');
    currentBytes = 0;
  }
  if (data.length > limit) data = data.subarray(data.length - limit);
  fs.appendFileSync(filePath, data);
  return Math.min(limit, currentBytes + data.length);
}

module.exports = { appendBoundedFileSync };
