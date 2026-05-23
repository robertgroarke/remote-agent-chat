#!/usr/bin/env node
'use strict';

const fixtures = require('./cdp-regression-fixtures');
const fidelity = require('./run-fidelity-regression');

function parseArgs(argv) {
  const options = {
    fixture: null,
    json: false,
    runId: null,
    surface: null,
    tail: null,
    relayBaseUrl: null,
    relayDb: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--fixture' && argv[i + 1]) {
      options.fixture = argv[++i];
      continue;
    }
    if (arg === '--run-id' && argv[i + 1]) {
      options.runId = argv[++i];
      continue;
    }
    if (arg === '--surface' && argv[i + 1]) {
      options.surface = argv[++i];
      continue;
    }
    if (arg === '--tail' && argv[i + 1]) {
      options.tail = Math.max(1, parseInt(argv[++i], 10) || 0) || null;
      continue;
    }
    if (arg === '--relay-base-url' && argv[i + 1]) {
      options.relayBaseUrl = argv[++i];
      continue;
    }
    if (arg === '--relay-db' && argv[i + 1]) {
      options.relayDb = argv[++i];
      continue;
    }
  }

  return options;
}

function resolveTarget(surface, targetsByPort) {
  if (surface === 'codex-desktop') {
    return Array.isArray(targetsByPort.codexDesktop)
      ? targetsByPort.codexDesktop.find((t) => t.type === 'page' && t.title === 'Codex')
      : null;
  }
  if (surface === 'antigravity_panel') {
    return Array.isArray(targetsByPort.antigravity)
      ? fidelity.findWorkbenchTarget(targetsByPort.antigravity)
      : null;
  }
  if (surface === 'antigravity-v2') {
    return Array.isArray(targetsByPort.antigravityV2)
      ? fidelity.findAntigravityV2Target(targetsByPort.antigravityV2)
      : null;
  }
  return Array.isArray(targetsByPort.antigravity)
    ? fidelity.findFirstMatchingTarget(targetsByPort.antigravity, fidelity.PATTERNS[surface] || [])
    : null;
}

function printHuman(result) {
  console.log(`${result.status.toUpperCase()} ${result.surface}.${result.fixture_id}.${result.run_id}`);
  console.log(result.detail);
  if (result.native_evidence) {
    console.log('\nNative evidence:');
    console.log(JSON.stringify(result.native_evidence, null, 2));
  }
  if (result.webui_evidence) {
    console.log('\nWebUI evidence:');
    console.log(JSON.stringify(result.webui_evidence, null, 2));
  }
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (!options.surface) throw new Error('Missing --surface <SURFACE>');

  if (!options.fixture) {
    if (options.surface === 'antigravity-v2') {
      const results = fixtures.evaluateAntigravityV2StructuralFixtures();
      const failed = results.filter(result => result.status !== 'pass');
      const summary = {
        surface: options.surface,
        status: failed.length ? 'fail_fixture' : 'pass',
        passed: results.length - failed.length,
        failed: failed.length,
        fixtures: results,
      };
      if (options.json) process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
      else {
        console.log(`${summary.status.toUpperCase()} ${options.surface} structural fixtures: ${summary.passed} passed, ${summary.failed} failed`);
        failed.forEach(result => console.log(`FAIL ${result.fixture_id}: ${result.failures.join('; ')}`));
      }
      if (failed.length) process.exitCode = 1;
      return summary;
    }
    const summary = {
      surface: options.surface,
      status: 'pass',
      passed: 0,
      failed: 0,
      detail: 'No default structural fixtures are defined for this surface; use --fixture and --run-id for live transcript checks.',
    };
    if (options.json) process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
    else console.log(`PASS ${options.surface}: ${summary.detail}`);
    return summary;
  }

  if (!options.runId) throw new Error('Missing --run-id <RUN_ID>');

  const fixture = fixtures.getFixture(options.fixture);
  if (!fixture) throw new Error(`Unknown fixture: ${options.fixture}`);
  if (!fixture.surfaces.includes(options.surface)) {
    throw new Error(`${fixture.id} does not apply to surface ${options.surface}`);
  }
  if (fixture.kind !== 'message' && fixture.kind !== 'manual') {
    throw new Error(`${fixture.id} is a ${fixture.kind} fixture and does not use transcript checks`);
  }

  const relayEnv = fidelity.loadEnvFile(require('path').join(__dirname, '..', 'relay-server', '.env'));
  const proxyEnv = fidelity.loadEnvFile(require('path').join(__dirname, '..', 'agent-proxy', '.env'));
  const relayBaseUrls = fidelity.deriveRelayBaseUrls(options.relayBaseUrl, relayEnv, proxyEnv);
  const bearerToken = fidelity.buildBearerToken(relayEnv);
  const relayDbPath = fidelity.findRelayDbPath(options.relayDb);
  const dbReader = fidelity.createDbReader(relayDbPath);
  const targetsByPort = await fidelity.listTargetsByPort();
  const sessions = fidelity.listSessions();
  const target = resolveTarget(options.surface, targetsByPort);

  if (!target) {
    throw new Error(`No live target found for surface ${options.surface}`);
  }

  const mappedSession = fidelity.matchSessionByTarget(sessions, options.surface, target.id, target.title || target.url || options.surface);
  const nativeMessages = fidelity.normalizeMessages(
    await fidelity.collectNativeTranscript(options.surface, target, mappedSession?.session_id),
    options.tail
  );
  const webuiResult = await fidelity.readWebuiHistory(mappedSession, {
    relayBaseUrls,
    bearerToken,
    dbReader,
    options,
  });

  const webuiMessages = fidelity.normalizeMessages(webuiResult.messages || [], options.tail);
  const nativeEval = fixtures.evaluateFixtureMessages(nativeMessages, fixture.id, options.runId);
  const webuiEval = fixtures.evaluateFixtureMessages(webuiMessages, fixture.id, options.runId);

  const pass = nativeEval.pass && webuiEval.pass;
  const result = {
    surface: options.surface,
    fixture_id: fixture.id,
    run_id: fixtures.normalizeRunId(options.runId),
    status: pass ? 'pass' : 'fail_fixture',
    detail: pass
      ? `Fixture ${fixture.id} ${options.runId} was found in both native and WebUI transcripts`
      : `Fixture ${fixture.id} ${options.runId} missing in ${[
          nativeEval.pass ? null : 'native',
          webuiEval.pass ? null : 'webui',
        ].filter(Boolean).join(' and ')}`,
    native_evidence: {
      mapped_session: mappedSession?.session_id || null,
      transcript_count: nativeMessages.length,
      evaluation: nativeEval,
      sample_last_native: nativeMessages.length ? nativeMessages[nativeMessages.length - 1].content.slice(0, 220) : null,
    },
    webui_evidence: {
      source: webuiResult.source || null,
      transcript_count: webuiMessages.length,
      evaluation: webuiEval,
      sample_last_webui: webuiMessages.length ? webuiMessages[webuiMessages.length - 1].content.slice(0, 220) : null,
    },
  };

  if (dbReader) dbReader.close();

  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return result;
  }
  printHuman(result);
  if (!pass) process.exitCode = 1;
  return result;
}

if (require.main === module) {
  main().catch((error) => {
    console.error('FATAL:', error.message);
    process.exitCode = 1;
  });
}

