#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  LATENCY_TRACE_STAGES,
  advanceLatencyTrace,
  normalizeLatencyTrace,
} = require('../shared/latency-trace');
const { LatencyTraceLedger } = require('../relay-server/latency-trace-ledger');
const {
  PHASE2_SOURCE_MANIFEST,
  buildLatencyReport,
  readLedger,
  readLedgerRows,
} = require('./latency-trace-ledger-report');

const ROOT = path.resolve(__dirname, '..');

function completeTrace(agentType, sample, baseAtMs) {
  let trace = {
    trace_id: `latency-${agentType}-${String(sample).padStart(4, '0')}`,
    client_message_id: `cmsg-${agentType}-${String(sample).padStart(4, '0')}`,
    agent_type: agentType,
    stages: {},
  };
  const clockDomainByStage = {
    webui_send: 'browser',
    relay_recv: 'relay',
    proxy_recv: 'proxy',
    harness_delivered: 'proxy',
    agent_first_output: 'proxy',
    relay_broadcast: 'relay',
    webui_render: 'browser',
  };
  const clockOffsetByDomain = { browser: 100, relay: 0, proxy: -50 };
  LATENCY_TRACE_STAGES.forEach((stage, index) => {
    const stageDelay = stage === 'harness_delivered' ? 100 + sample : 5;
    const prior = index === 0 ? baseAtMs : trace.stages[LATENCY_TRACE_STAGES[index - 1]];
    const adjustedAtMs = prior + stageDelay;
    const clockDomain = clockDomainByStage[stage];
    const clockOffsetMs = clockOffsetByDomain[clockDomain];
    const rawAtMs = adjustedAtMs - clockOffsetMs;
    const advanced = advanceLatencyTrace(trace, stage, rawAtMs, {
      source: stage === 'agent_first_output' ? 'stream_trace' : 'smoke',
      clock_domain: clockDomain,
      clock_reference: 'relay',
      clock_status: clockDomain === 'relay' ? 'reference' : 'synchronized',
      raw_at_ms: rawAtMs,
      adjusted_at_ms: adjustedAtMs,
      clock_offset_ms: clockOffsetMs,
      clock_rtt_ms: clockDomain === 'relay' ? 0 : 40,
      clock_uncertainty_ms: clockDomain === 'relay' ? 0 : 20,
      clock_sample_age_ms: clockDomain === 'relay' ? 0 : 10,
      ...(stage === 'agent_first_output' ? {
        source_at: rawAtMs,
        cdpToQueueMs: 2,
        bindingToProxyMs: 3,
        causal_match: 'strong_identity',
      } : {}),
    });
    assert(advanced.ok, `${stage}: ${advanced.code}`);
    trace = advanced.trace;
  });
  return trace;
}

function representativeTopology(sample) {
  return {
    session_temperature: sample % 2 === 0 ? 'cold' : 'warm',
    transcript_state: Math.floor(sample / 2) % 2 === 0 ? 'short' : 'long_resumed',
    delivery_mode: Math.floor(sample / 4) % 2 === 0 ? 'sequential' : 'queued',
    connection_state: Math.floor(sample / 8) % 2 === 0 ? 'stable' : 'reconnect_resync',
    traffic_shape: sample < 10 ? 'direct' : 'goal_loop',
  };
}

function sampleReceipt(agentTypes, {
  topology = representativeTopology,
  includeConsumers = true,
  duplicateIndependence = false,
} = {}) {
  return {
    schema_version: 2,
    kind: 'latency_trace_sample_receipt',
    source_build: 'build-latency-smoke',
    served_build: 'build-latency-smoke',
    fixture_cost_policy: {
      model_id: 'gpt-5.4-mini',
      effort: 'low',
      source: 'explicit_owned_fixture',
      lowest_cost_code_path_verified: true,
    },
    samples: agentTypes.flatMap(agentType => Array.from({ length: 20 }, (_, sample) => ({
      trace_id: `latency-${agentType}-${String(sample).padStart(4, '0')}`,
      independence_receipt: {
        session_key: duplicateIndependence && sample < 2
          ? `session-${agentType}-duplicate`
          : `session-${agentType}-${sample}`,
        turn_key: duplicateIndependence && sample < 2
          ? `turn-${agentType}-duplicate`
          : `turn-${agentType}-${sample}`,
      },
      ...(topology ? { topology: topology(sample) } : {}),
      ...(includeConsumers ? {
        evidence_consumers: [sample % 2 === 0 ? 'web' : 'android'],
      } : {}),
      model_receipt: {
        requested_model_id: 'gpt-5.4-mini',
        observed_model_id: 'gpt-5.4-mini',
        requested_effort: 'low',
        observed_effort: 'low',
      },
    }))),
  };
}

function writePhase2SourceFixtures(root) {
  const samples = Array.from({ length: 20 }, (_, index) => ({
    native_to_browser_paint_ms: 100 + index,
  }));
  for (const source of PHASE2_SOURCE_MANIFEST) {
    for (const relativePath of source.paths) {
      let payload;
      if (relativePath.endsWith('continue-browser-latency-aggregate-result.json')) {
        payload = {
          agent_type: 'continue',
          every_sample_has_proxy_delivery_receipt: true,
          samples,
        };
      } else if (relativePath.endsWith('question-prompt-latency-production-50.json')
          || relativePath.endsWith('vscode-question-producer-latency-20.json')) {
        payload = {
          status: 'PASS',
          count_per_adapter: 20,
          summary: { p50_ms: 100, p95_ms: 119 },
        };
      } else {
        payload = {
          status: 'PASS',
          harnesses: [{
            agent_type: 'phase2-smoke',
            samples,
          }],
        };
      }
      const fixturePath = path.join(root, relativePath);
      fs.mkdirSync(path.dirname(fixturePath), { recursive: true });
      fs.writeFileSync(fixturePath, JSON.stringify(payload));
    }
  }
}

function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-latency-trace-smoke-'));
  try {
    assert.throws(
      () => buildLatencyReport([], {
        phase2SourceRoot: path.join(tempRoot, 'missing-phase2-sources'),
      }),
      /Phase 2 latency source missing/,
    );
    writePhase2SourceFixtures(tempRoot);
    const buildSmokeLatencyReport = (rows, options) => buildLatencyReport(rows, {
      phase2SourceRoot: tempRoot,
      ...options,
    });
    const ledgerPath = path.join(tempRoot, 'latency-trace-ledger.jsonl');
    const ledger = new LatencyTraceLedger(ledgerPath);
    const agentTypes = ['codex_cli', 'codex-desktop', 'codex'];
    for (const agentType of agentTypes) {
      for (let sample = 0; sample < 20; sample += 1) {
        const trace = completeTrace(agentType, sample, 1_000_000 + sample * 1_000);
        const appended = ledger.append(trace);
        assert.strictEqual(appended.appended, true);
        assert.strictEqual(appended.row.sample_kind, 'real_webui_send');
        assert.strictEqual(appended.row.session_id, undefined);
        assert.strictEqual(appended.row.content, undefined);
        assert.strictEqual(ledger.append(trace).duplicate, true);
      }
    }
    assert.strictEqual(fs.readFileSync(ledgerPath, 'utf8').trim().split(/\r?\n/).length, 60);

    const restarted = new LatencyTraceLedger(ledgerPath);
    assert.strictEqual(restarted.loadDiagnostics.valid_rows, 60);
    const firstTrace = completeTrace('codex_cli', 0, 1_000_000);
    assert.strictEqual(restarted.append(firstTrace).duplicate, true);

    const terminalLedgerPath = path.join(tempRoot, 'latency-trace-terminal-ledger.jsonl');
    const terminalLedger = new LatencyTraceLedger(terminalLedgerPath);
    const terminal = {
      trace_id: 'latency-terminal-smoke-0001',
      client_message_id: 'cmsg-terminal-smoke-0001',
      agent_type: 'codex_cli',
      reason: 'causal_identity_ambiguous',
      terminal_at_ms: Date.now(),
      stages_completed: ['webui_send', 'relay_recv', 'proxy_recv', 'harness_delivered'],
      session_id: 'must-not-persist',
      content: 'must-not-persist',
    };
    const appendedTerminal = terminalLedger.appendTerminal(terminal);
    assert.strictEqual(appendedTerminal.appended, true);
    assert.strictEqual(appendedTerminal.row.measurement_status, 'unmeasured');
    assert.strictEqual(appendedTerminal.row.session_id, undefined);
    assert.strictEqual(appendedTerminal.row.content, undefined);
    assert.strictEqual(terminalLedger.appendTerminal(terminal).duplicate, true);
    const restartedTerminalLedger = new LatencyTraceLedger(terminalLedgerPath);
    assert.strictEqual(restartedTerminalLedger.loadDiagnostics.valid_rows, 1);
    assert.strictEqual(restartedTerminalLedger.appendTerminal(terminal).duplicate, true);
    assert.strictEqual(restartedTerminalLedger.readRows().length, 0);

    const rows = readLedgerRows(ledgerPath);
    const receiptPath = path.join(tempRoot, 'representative-sample-receipt.json');
    fs.writeFileSync(receiptPath, JSON.stringify(sampleReceipt(agentTypes)));
    const mixedLedgerPath = path.join(tempRoot, 'latency-trace-mixed-ledger.jsonl');
    fs.writeFileSync(
      mixedLedgerPath,
      fs.readFileSync(ledgerPath, 'utf8') + fs.readFileSync(terminalLedgerPath, 'utf8'),
    );
    const mixedLedger = readLedger(mixedLedgerPath);
    assert.strictEqual(mixedLedger.total_rows, 61);
    assert.strictEqual(mixedLedger.measured_rows.length, 60);
    assert.strictEqual(mixedLedger.terminal_rows.length, 1);
    assert.strictEqual(readLedgerRows(mixedLedgerPath).length, 60);
    const mixedReport = buildSmokeLatencyReport(mixedLedger.measured_rows, {
      ledgerPath: mixedLedgerPath,
      ledgerRowCount: mixedLedger.total_rows,
      terminalRows: mixedLedger.terminal_rows,
      minPerSurface: 20,
      sampleReceiptPaths: [receiptPath],
    });
    assert.strictEqual(mixedReport.status, 'PASS');
    assert.strictEqual(mixedReport.ledger_rows, 61);
    assert.strictEqual(mixedReport.measured_ledger_rows, 60);
    assert.strictEqual(mixedReport.terminal_ledger_rows, 1);
    assert.strictEqual(mixedReport.row_disposition_counts.terminal, 1);
    assert.deepStrictEqual(mixedReport.terminal_reason_counts, {
      causal_identity_ambiguous: 1,
    });
    assert.deepStrictEqual(mixedReport.terminal_surface_counts, { codex_cli: 1 });

    const terminalWithContentPath = path.join(tempRoot, 'latency-terminal-with-content.jsonl');
    const terminalWithContent = JSON.parse(fs.readFileSync(terminalLedgerPath, 'utf8').trim());
    terminalWithContent.content = 'must-be-rejected';
    fs.writeFileSync(terminalWithContentPath, `${JSON.stringify(terminalWithContent)}\n`);
    assert.throws(
      () => readLedger(terminalWithContentPath),
      /unexpected fields: content/,
    );
    const report = buildSmokeLatencyReport(rows, {
      ledgerPath,
      minPerSurface: 20,
      sampleReceiptPaths: [receiptPath],
    });
    assert.strictEqual(report.status, 'PASS');
    assert.strictEqual(report.can_rank_dominant_stages, true);
    assert.strictEqual(report.can_prioritize_p3_3, true);
    assert(report.surface_table.every(row => (
      row.samples === 20
      && row.dominant_stage
      && row.total.min_ms !== null
      && row.total.max_ms !== null
      && row.total.spread_ms !== null
      && Object.values(row.raw_clock_stages).every(metric => metric.samples === 20)
    )));
    assert.strictEqual(report.clock_policy.reference_clock, 'relay');
    assert.strictEqual(report.clock_policy.ranking_bucket, 'relay_adjusted_synchronized');
    assert.strictEqual(report.row_disposition_counts.included, 60);
    assert.strictEqual(report.row_disposition_counts.provisional, 0);
    assert.strictEqual(report.row_disposition_counts.excluded, 0);
    assert(Object.values(report.coverage).every(surface => (
      surface.pass
      && surface.independent_valid_real_sends === 20
      && surface.topology_gate_pass
      && surface.consumer_gate_pass
    )));
    assert.strictEqual(report.phase2_stage_sources.length, 4);
    assert.strictEqual(report.phase2_integration_gate.pass, true);
    assert.strictEqual(
      report.phase2_stage_sources.filter(source => (
        source.integration === 'normalized_composite_stage_source'
      )).length,
      2,
    );
    assert.strictEqual(
      report.phase2_stage_sources.filter(source => source.integration === 'reference_only').length,
      2,
    );
    assert(report.phase2_stage_sources
      .flatMap(source => source.files)
      .every(file => file.compatibility_verdict && file.ranking_eligible === false));

    const clockAdjustedRows = JSON.parse(JSON.stringify(rows));
    clockAdjustedRows[0].stage_sources.proxy_recv.clock_adjustment_ms = 50;
    const clockAdjustedReport = buildSmokeLatencyReport(clockAdjustedRows, {
      ledgerPath,
      minPerSurface: 20,
      sampleReceiptPaths: [receiptPath],
    });
    assert.strictEqual(clockAdjustedReport.status, 'INCOMPLETE');
    assert.strictEqual(clockAdjustedReport.can_rank_dominant_stages, false);
    assert.strictEqual(clockAdjustedReport.can_prioritize_p3_3, false);
    assert.strictEqual(clockAdjustedReport.row_disposition_counts.excluded, 1);
    assert(clockAdjustedReport.row_dispositions.excluded[0].reasons.includes('legacy_clamped_clock_row'));
    assert(clockAdjustedReport.surface_table.every(row => row.dominant_stage === null));

    const skewedRows = JSON.parse(JSON.stringify(rows));
    skewedRows[0].stage_sources.webui_send.clock_status = 'skew_threshold_exceeded';
    const skewedReport = buildSmokeLatencyReport(skewedRows, {
      ledgerPath,
      minPerSurface: 20,
      sampleReceiptPaths: [receiptPath],
    });
    assert.strictEqual(skewedReport.status, 'INCOMPLETE');
    assert(skewedReport.row_dispositions.excluded[0].reasons
      .includes('clock_status_invalid:webui_send:skew_threshold_exceeded'));

    const singleTopologyPath = path.join(tempRoot, 'single-topology-receipt.json');
    fs.writeFileSync(singleTopologyPath, JSON.stringify(sampleReceipt(agentTypes, {
      topology: () => ({
        session_temperature: 'cold',
        transcript_state: 'short',
        delivery_mode: 'sequential',
        connection_state: 'stable',
        traffic_shape: 'direct',
      }),
    })));
    const singleTopologyReport = buildSmokeLatencyReport(rows, {
      ledgerPath,
      minPerSurface: 20,
      sampleReceiptPaths: [singleTopologyPath],
    });
    assert.strictEqual(singleTopologyReport.status, 'INCOMPLETE');
    assert.strictEqual(singleTopologyReport.row_disposition_counts.included, 60);
    assert(Object.values(singleTopologyReport.coverage).every(surface => (
      surface.sample_gate_pass && !surface.topology_gate_pass
    )));
    assert(singleTopologyReport.surface_table.every(row => row.dominant_stage === null));

    const provisionalPath = path.join(tempRoot, 'provisional-receipt.json');
    fs.writeFileSync(provisionalPath, JSON.stringify(sampleReceipt(['codex_cli'], {
      topology: null,
      includeConsumers: false,
    })));
    const provisionalReport = buildSmokeLatencyReport(
      rows.filter(row => row.surface_class === 'codex_cli'),
      {
        ledgerPath,
        minPerSurface: 20,
        sampleReceiptPaths: [provisionalPath],
      },
    );
    assert.strictEqual(provisionalReport.status, 'INCOMPLETE');
    assert.strictEqual(provisionalReport.row_disposition_counts.provisional, 20);
    assert(provisionalReport.row_dispositions.provisional.every(row => (
      row.reasons.includes('topology_receipt_missing')
      && row.reasons.includes('evidence_consumer_receipt_missing')
    )));

    const duplicatePath = path.join(tempRoot, 'duplicate-independence-receipt.json');
    fs.writeFileSync(duplicatePath, JSON.stringify(sampleReceipt(agentTypes, {
      duplicateIndependence: true,
    })));
    const duplicateReport = buildSmokeLatencyReport(rows, {
      ledgerPath,
      minPerSurface: 20,
      sampleReceiptPaths: [duplicatePath],
    });
    assert.strictEqual(duplicateReport.status, 'INCOMPLETE');
    assert.strictEqual(duplicateReport.row_disposition_counts.excluded, 6);
    assert(duplicateReport.row_dispositions.excluded.every(row => (
      row.reasons.includes('duplicate_session_turn_receipt')
    )));

    const regression = normalizeLatencyTrace({
      trace_id: 'latency-regression-smoke',
      agent_type: 'codex_cli',
      stages: { webui_send: 200, relay_recv: 100 },
    });
    assert.strictEqual(regression.ok, false);
    assert.strictEqual(regression.code, 'stage_regressed:relay_recv');

    const proxySource = fs.readFileSync(path.join(ROOT, 'agent-proxy', 'proxy-engine.js'), 'utf8');
    const relaySource = fs.readFileSync(path.join(ROOT, 'relay-server', 'index.js'), 'utf8');
    const frontendSource = fs.readFileSync(path.join(ROOT, 'frontend', 'hooks.jsx'), 'utf8');
    assert(/_registerSendLatencyTrace/.test(proxySource));
    assert(/_attachFirstOutputLatencyTrace/.test(proxySource));
    assert(/latency_trace_complete/.test(relaySource));
    assert(/latency-trace-ledger\.jsonl/.test(relaySource));
    assert(/createWebuiLatencyTrace/.test(frontendSource));
    assert(/recordLatencyTraceAfterPaint/.test(frontendSource));
    assert(/__RAC_LATENCY_TRACES__/.test(frontendSource));

    console.log(JSON.stringify({
      ok: true,
      ledger_rows: rows.length,
      deterministic_fixture_rows_per_surface: 20,
      acceptance_real_send_evidence: false,
      surface_classes: report.surface_table.map(row => row.surface_class),
      representative_topology_gate: true,
      single_topology_ranking_refused: true,
      clock_adjusted_ranking_refused: true,
      duplicate_independence_ranking_refused: true,
      provisional_reason_accounting: true,
      phase2_stage_sources: report.phase2_stage_sources.map(source => ({
        name: source.name,
        commit: source.commit,
        integration: source.integration,
      })),
      restart_dedup: true,
      terminal_restart_dedup: true,
      terminal_privacy_clean: true,
      mixed_terminal_report_rows: mixedReport.ledger_rows,
      mixed_terminal_excluded_from_ranking: mixedReport.measured_ledger_rows === rows.length,
      terminal_privacy_field_rejected: true,
      privacy_fields_persisted: [
        'trace_id', 'client_message_id', 'agent_type', 'surface_class',
        'stages', 'raw_stages', 'stage_sources', 'durations_ms', 'raw_durations_ms',
      ],
      forbidden_persisted_fields: ['session_id', 'content'],
    }, null, 2));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(`Latency trace ledger smoke: FAIL (${error.stack || error.message})`);
  process.exit(1);
}
