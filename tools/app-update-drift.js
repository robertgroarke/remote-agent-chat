'use strict';

const fs = require('fs');
const path = require('path');

const STATE_SCHEMA_VERSION = 1;
const TRIAGE_HEADING = '## App-update drift sentinel triage';

function detectVersionChanges(previousVersions, currentVersions) {
  const previous = previousVersions && typeof previousVersions === 'object' ? previousVersions : {};
  const current = currentVersions && typeof currentVersions === 'object' ? currentVersions : {};
  if (Object.keys(previous).length === 0) return [];
  return Object.keys(current).sort().filter(harness => (
    Object.prototype.hasOwnProperty.call(previous, harness)
    && String(previous[harness]) !== String(current[harness])
  )).map(harness => ({
    harness,
    previous_version: String(previous[harness]),
    app_version: String(current[harness]),
  }));
}

function loadSentinelState(statePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    return parsed && parsed.schema_version === STATE_SCHEMA_VERSION ? parsed : null;
  } catch {
    return null;
  }
}

function saveSentinelState(statePath, state) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const tempPath = `${statePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify({ schema_version: STATE_SCHEMA_VERSION, ...state }, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, statePath);
}

function oneLine(value, limit = 800) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function formatTriageEntry(entry, ledgerPath) {
  const completedAt = entry.completed_at || new Date().toISOString();
  const stage = entry.failure_stage ? `Stage: ${oneLine(entry.failure_stage, 120)}. ` : '';
  const fixtureDiff = entry.fixture_diff ? `Fixture diff: ${oneLine(entry.fixture_diff, 500)}. ` : '';
  const playbook = Array.isArray(entry.repair_playbook)
    ? `Repair: ${oneLine(entry.repair_playbook.join(' -> '), 800)}. `
    : '';
  return `- [ ] **${completedAt} - ${entry.harness} app update ${entry.previous_app_version} -> ${entry.app_version}: ${String(entry.status).toUpperCase()}** `
    + `Validator \`${entry.validator || 'unavailable'}\` exited ${entry.exit_code ?? 'n/a'} in ${entry.duration_ms || 0} ms. `
    + `${stage}${fixtureDiff}${playbook}${oneLine(entry.detail)} Ledger: \`${ledgerPath}\`.\n`;
}

function appendDriftTriage(backlogPath, entry, ledgerPath) {
  const current = fs.readFileSync(backlogPath, 'utf8');
  const heading = current.includes(TRIAGE_HEADING) ? '' : `\n\n${TRIAGE_HEADING}\n\n`;
  fs.appendFileSync(backlogPath, `${heading}${formatTriageEntry(entry, ledgerPath)}`, 'utf8');
}

function validatorForHarness(validators, harness) {
  return (validators || []).find(validator => validator.harness === harness) || null;
}

module.exports = {
  STATE_SCHEMA_VERSION,
  TRIAGE_HEADING,
  appendDriftTriage,
  detectVersionChanges,
  formatTriageEntry,
  loadSentinelState,
  saveSentinelState,
  validatorForHarness,
};
