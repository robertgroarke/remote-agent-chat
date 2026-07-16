#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { LatestSessionOperationQueue } = require('../agent-proxy/latest-session-operation-queue');

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function tick() {
  await new Promise(resolve => setImmediate(resolve));
}

async function main() {
  const started = [];
  const superseded = [];
  const first = deferred();
  const latest = deferred();
  const otherSession = deferred();
  const queue = new LatestSessionOperationQueue({
    onSupersede: operation => superseded.push(operation.requestId),
  });

  const firstResult = queue.enqueue('session-a', { requestId: 'first' }, async () => {
    started.push('first');
    await first.promise;
    return 'first-complete';
  });
  const skippedResult = queue.enqueue('session-a', { requestId: 'skipped' }, async () => {
    started.push('skipped');
  });
  const latestResult = queue.enqueue('session-a', { requestId: 'latest' }, async () => {
    started.push('latest');
    await latest.promise;
    return 'latest-complete';
  });
  const otherResult = queue.enqueue('session-b', { requestId: 'other' }, async () => {
    started.push('other');
    await otherSession.promise;
  });

  await tick();
  assert.deepStrictEqual(started, ['first', 'other'], 'sessions did not run independently or same-session work overlapped');
  assert.deepStrictEqual(superseded, ['skipped'], 'intermediate same-session operation was not superseded');
  assert.deepStrictEqual(await skippedResult, { superseded: true });
  assert.strictEqual(queue.size, 2, 'active session state was not bounded to active queues');

  first.resolve();
  await tick();
  assert.deepStrictEqual(started, ['first', 'other', 'latest'], 'latest queued operation did not start after the active operation');
  assert.strictEqual((await firstResult).value, 'first-complete');

  latest.resolve();
  otherSession.resolve();
  assert.strictEqual((await latestResult).value, 'latest-complete');
  await otherResult;
  await tick();
  assert.strictEqual(queue.size, 0, 'completed per-session queue state was retained');

  const stressGate = deferred();
  let stressExecuted = 0;
  let stressSuperseded = 0;
  const stressQueue = new LatestSessionOperationQueue({
    onSupersede: () => { stressSuperseded += 1; },
  });
  const stressResults = [stressQueue.enqueue('stress-session', { requestId: 'stress-0' }, async () => {
    stressExecuted += 1;
    await stressGate.promise;
  })];
  for (let index = 1; index <= 2000; index += 1) {
    stressResults.push(stressQueue.enqueue('stress-session', { requestId: `stress-${index}` }, async () => {
      stressExecuted += 1;
    }));
  }
  assert.strictEqual(stressQueue.size, 1, 'rapid input grew per-session queue state');
  assert.strictEqual(stressExecuted, 1, 'rapid queued input overlapped the active operation');
  assert.strictEqual(stressSuperseded, 1999, 'queue retained more than the latest waiting operation');
  stressGate.resolve();
  await Promise.all(stressResults);
  await tick();
  assert.strictEqual(stressExecuted, 2, 'latest waiting operation did not execute after stress');
  assert.strictEqual(stressQueue.size, 0, 'stress queue state was retained after completion');

  console.log('PASS latest-session operation queue serializes, supersedes, and releases state');
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
