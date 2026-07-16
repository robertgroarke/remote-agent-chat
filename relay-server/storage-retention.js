'use strict';

const fs = require('fs');
const path = require('path');

function pruneDirectory(directory, options = {}) {
  const now = Number(options.now) || Date.now();
  const maxAgeMs = Math.max(0, Number(options.maxAgeMs) || 0);
  const maxBytes = Math.max(0, Number(options.maxBytes) || 0);
  const maxFiles = Math.max(0, Number(options.maxFiles) || 0);
  const result = { scanned: 0, removed: 0, removedBytes: 0, retained: 0, retainedBytes: 0 };
  if (!directory || !fs.existsSync(directory)) return result;

  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const filePath = path.join(directory, entry.name);
    try {
      const stat = fs.statSync(filePath);
      files.push({ filePath, name: entry.name, bytes: stat.size, mtimeMs: stat.mtimeMs });
    } catch {}
  }
  result.scanned = files.length;
  files.sort((left, right) => right.mtimeMs - left.mtimeMs || left.name.localeCompare(right.name));

  let retainedBytes = 0;
  let retainedFiles = 0;
  for (const file of files) {
    const expired = maxAgeMs > 0 && now - file.mtimeMs > maxAgeMs;
    const exceedsFiles = maxFiles > 0 && retainedFiles >= maxFiles;
    const exceedsBytes = maxBytes > 0 && retainedBytes + file.bytes > maxBytes;
    if (expired || exceedsFiles || exceedsBytes) {
      try {
        fs.unlinkSync(file.filePath);
        result.removed += 1;
        result.removedBytes += file.bytes;
        continue;
      } catch {}
    }
    retainedFiles += 1;
    retainedBytes += file.bytes;
  }
  result.retained = retainedFiles;
  result.retainedBytes = retainedBytes;
  return result;
}

module.exports = { pruneDirectory };
