#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { buildPlan, parseArgs, representativeImages } = require('./operator-dogfood');

const ROOT = path.resolve(__dirname, '..');

const source = parseArgs(['--mode', 'source', '--run-id', 'runner-smoke', '--output-dir', path.join(ROOT, 'tmp-run')]);
assert.strictEqual(source.mode, 'source');
assert.strictEqual(source.readOnly, false);
assert.strictEqual(source.maxMinutes, 10);
assert.strictEqual(source.publish, false);
assert.strictEqual(source.temporalDurationMs, 5_000);
assert.deepStrictEqual(buildPlan(source).map(step => step.id), [
  'manifest_guard',
  'manifest_guard_adversarial',
  'manifest_snapshot',
  'seeded_discovery',
  'android_parity',
  'chat_stability_seed_contract',
  'chat_stability_prompt_lifecycle',
  'chat_stability_health_projection',
  'chat_stability_temporal',
]);

assert.throws(
  () => parseArgs(['--mode', 'post-deploy']),
  /requires --read-only/,
  'post-deploy mode must fail closed without an explicit read-only contract',
);
const postDeploy = parseArgs([
  '--mode', 'post-deploy', '--read-only', '--run-id', 'post-smoke', '--output-dir', path.join(ROOT, 'tmp-post'),
  '--source-root', path.join(ROOT, 'exact-source'),
  '--env-root', path.join(ROOT, 'exact-env'),
]);
assert.strictEqual(postDeploy.maxMinutes, 25);
assert.strictEqual(postDeploy.sourceRoot, path.join(ROOT, 'exact-source'));
assert.strictEqual(postDeploy.envRoot, path.join(ROOT, 'exact-env'));
assert.deepStrictEqual(buildPlan(postDeploy).map(step => step.id).slice(-2), [
  'production_asset_identity',
  'production_passive_surface',
]);
assert.deepStrictEqual(
  buildPlan(postDeploy).find(step => step.id === 'production_asset_identity').args.slice(0, 4),
  ['--source-root', path.join(ROOT, 'exact-source'), '--env-root', path.join(ROOT, 'exact-env')],
  'post-deploy asset identity did not use the explicit clean source and environment roots',
);

const canary = parseArgs([
  '--mode', 'canary', '--read-only', '--no-publish', '--run-id', 'canary-smoke',
  '--output-dir', path.join(ROOT, 'tmp-canary'), '--trigger-source', 'scheduled_task',
]);
assert.strictEqual(canary.maxMinutes, 5);
assert.strictEqual(canary.temporalDurationMs, 120_000);
assert.strictEqual(canary.triggerSource, 'scheduled_task');
assert.deepStrictEqual(buildPlan(canary).map(step => step.id), [
  'manifest_guard',
  'manifest_guard_adversarial',
  'manifest_snapshot',
  'chat_stability_seed_contract',
  'chat_stability_prompt_lifecycle',
  'chat_stability_health_projection',
  'chat_stability_temporal',
  'production_asset_identity',
]);

const weekly = parseArgs([
  '--mode', 'weekly', '--read-only', '--no-publish', '--run-id', 'weekly-smoke',
  '--output-dir', path.join(ROOT, 'tmp-weekly'),
]);
assert.strictEqual(weekly.temporalDurationMs, 2 * 60 * 60 * 1000);
assert.deepStrictEqual(buildPlan(weekly).map(step => step.id), [
  'manifest_guard',
  'manifest_guard_adversarial',
  'manifest_snapshot',
  'chat_stability_seed_contract',
  'chat_stability_prompt_lifecycle',
  'chat_stability_health_projection',
  'chat_stability_temporal',
  'production_asset_identity',
]);
assert.deepStrictEqual(
  buildPlan(postDeploy).find(step => step.id === 'production_passive_surface').args.slice(0, 5),
  ['--read-only-production', '--env-root', path.join(ROOT, 'exact-env'), '--source-root', path.join(ROOT, 'exact-source')],
  'post-deploy passive browser step did not use explicit environment and clean source roots',
);

const full = parseArgs([
  '--mode', 'full', '--read-only', '--run-id', 'full-smoke', '--output-dir', path.join(ROOT, 'tmp-full'),
]);
assert.strictEqual(full.maxMinutes, 150);
assert.deepStrictEqual(buildPlan(full).map(step => step.id).slice(-3), [
  'route_render_desktop',
  'route_render_mobile',
  'visual_regression',
]);

const images = Array.from({ length: 100 }, (_, index) => `image-${String(index).padStart(3, '0')}.png`);
const selected = representativeImages(images);
assert.strictEqual(selected.length, 48);
assert.strictEqual(selected[0], images[0]);
assert.strictEqual(selected[selected.length - 1], images[images.length - 1]);

const runnerSource = fs.readFileSync(path.join(ROOT, 'tools', 'operator-dogfood.js'), 'utf8');
const passiveSource = fs.readFileSync(path.join(ROOT, 'tools', 'operator-dogfood-production-passive-e2e.js'), 'utf8');
assert(runnerSource.includes('windowsHide: true'), 'child tools must remain hidden');
assert(runnerSource.includes('chat_stability_temporal'), 'dogfood plan must execute the temporal canary');
assert(runnerSource.includes('chat_stability_prompt_lifecycle'), 'dogfood plan must exercise answer, cancel, and interrupt headlessly');
assert(runnerSource.includes('acquireDogfoodLocks'), 'dogfood plan must coordinate with production operations');
assert(runnerSource.includes("options.mode !== 'source' && !options.readOnly"), 'production modes must fail closed');
assert(runnerSource.includes('manifest_rows_visited_in_built_ui: 0'), 'source runs must not overclaim built coverage');
assert(runnerSource.includes("production_mutations: 0"), 'runner evidence must declare the production mutation count');
assert(runnerSource.includes('source_root: options.sourceRoot'), 'runner evidence must record its source authority');
assert(!runnerSource.includes("goal-notification-production-browser-e2e.js"),
  'bounded post-deploy dogfood must not call the navigating notification probe');
for (const forbidden of ['page.goto(', 'page.route(', 'setExtraHTTPHeaders(', '.click(', '.fill(', '.press(']) {
  assert(!passiveSource.includes(forbidden), `passive production dogfood contains forbidden action ${forbidden}`);
}
assert(passiveSource.includes('page.request.get('), 'passive production dogfood must use request-context reads');
assert(passiveSource.includes('pages.length, 1'), 'passive production dogfood must fail closed on extra pages');

console.log('PASS operator dogfood bounded runner contract');
