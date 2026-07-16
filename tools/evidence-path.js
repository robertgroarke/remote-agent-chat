'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_TIME_ZONE = 'America/Los_Angeles';

function evidenceDate(now = new Date(), timeZone = process.env.RAC_EVIDENCE_TIME_ZONE || DEFAULT_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function currentEvidenceRoot(repoRoot, category = 'harness-maturity', options = {}) {
  return path.join(
    path.resolve(repoRoot),
    'evidence',
    category,
    evidenceDate(options.now, options.timeZone),
  );
}

function runSuffix(now = new Date()) {
  return now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 17);
}

function availablePath(candidate, options = {}) {
  if (!fs.existsSync(candidate)) return candidate;
  const parsed = path.parse(candidate);
  const suffix = runSuffix(options.now || new Date());
  for (let attempt = 1; attempt <= 999; attempt += 1) {
    const counter = attempt === 1 ? '' : `-${attempt}`;
    const next = path.join(parsed.dir, `${parsed.name}-run-${suffix}${counter}${parsed.ext}`);
    if (!fs.existsSync(next)) return next;
  }
  throw new Error(`Unable to allocate immutable evidence path beside ${candidate}`);
}

function freshEvidencePath(repoRoot, filename, options = {}) {
  return availablePath(
    path.join(currentEvidenceRoot(repoRoot, options.category, options), filename),
    options,
  );
}

function freshEvidenceDirectory(repoRoot, dirname, options = {}) {
  return availablePath(
    path.join(currentEvidenceRoot(repoRoot, options.category, options), dirname),
    options,
  );
}

module.exports = {
  DEFAULT_TIME_ZONE,
  availablePath,
  currentEvidenceRoot,
  evidenceDate,
  freshEvidenceDirectory,
  freshEvidencePath,
};
