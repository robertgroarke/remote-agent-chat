#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  LATENCY_TRACE_STAGES,
  latencyStageDurations,
  normalizeLatencyTraceTerminal,
  percentile,
} = require('../shared/latency-trace');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_LEDGER = path.join(ROOT, 'data', 'latency-trace-ledger.jsonl');
const REQUIRED_SURFACE_CLASSES = Object.freeze(['codex_cli', 'codex-desktop', 'webview']);
const REQUIRED_EVIDENCE_CONSUMERS = Object.freeze(['web', 'android']);
const LATENCY_STAGE_CLOCK_DOMAINS = Object.freeze({
  webui_send: Object.freeze(['browser', 'android']),
  relay_recv: Object.freeze(['relay']),
  proxy_recv: Object.freeze(['proxy']),
  harness_delivered: Object.freeze(['proxy']),
  agent_first_output: Object.freeze(['proxy']),
  relay_broadcast: Object.freeze(['relay']),
  webui_render: Object.freeze(['browser', 'android']),
});
const TOPOLOGY_DIMENSIONS = Object.freeze({
  session_temperature: Object.freeze(['cold', 'warm']),
  transcript_state: Object.freeze(['short', 'long_resumed']),
  delivery_mode: Object.freeze(['sequential', 'queued']),
  connection_state: Object.freeze(['stable', 'reconnect_resync']),
  traffic_shape: Object.freeze(['direct', 'goal_loop']),
});
const ALLOWED_CAUSAL_MATCHES = Object.freeze([
  'strong_identity',
  'source_cursor',
  'exclusive_native_user_window',
]);
const SCOREBOARD_SOURCES = Object.freeze([
  'evidence/harness-maturity/2026-07-11/antigravity-v2-browser-latency-recovery-result.json',
  'evidence/harness-maturity/2026-07-11/claude-cli-browser-latency-recovery-result.json',
  'evidence/harness-maturity/2026-07-11/codex-cli-browser-latency-recovery-result.json',
  'evidence/harness-maturity/2026-07-11/cursor-browser-latency-recovery-result.json',
  'evidence/harness-maturity/2026-07-11/cursor-cli-browser-latency-recovery-result.json',
]);
const PHASE2_SOURCE_MANIFEST = Object.freeze([
  {
    name: 'production_latency_scoreboard',
    commit: '8cba60f4',
    paths: SCOREBOARD_SOURCES,
  },
  {
    name: 'question_prompt_latency_budgets',
    commit: '713cf02f',
    paths: ['evidence/harness-maturity/2026-07-16/question-prompt-latency-production-50.json'],
  },
  {
    name: 'vscode_question_push_latency',
    commit: '9c7cc9dd',
    paths: ['evidence/harness-maturity/2026-07-16/vscode-question-producer-latency-20.json'],
  },
  {
    name: 'continue_latency_distribution',
    commit: 'f556da6b',
    paths: ['evidence/harness-maturity/2026-07-12/continue-browser-latency-aggregate-result.json'],
  },
]);

function argumentValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function argumentValues(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name && process.argv[index + 1]) {
      values.push(process.argv[index + 1]);
      index += 1;
    }
  }
  return values;
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function finiteValues(values, { allowNegative = false } = {}) {
  return (Array.isArray(values) ? values : [])
    .map(Number)
    .filter(value => Number.isFinite(value) && (allowNegative || value >= 0));
}

function metricStats(values, minimumSamples = 20, { allowNegative = false } = {}) {
  const normalized = finiteValues(values, { allowNegative });
  const minimum = Math.max(1, Number(minimumSamples) || 20);
  const min = normalized.length > 0 ? Math.min(...normalized) : null;
  const max = normalized.length > 0 ? Math.max(...normalized) : null;
  return {
    samples: normalized.length,
    status: normalized.length >= minimum ? 'INCLUDED' : 'PROVISIONAL',
    minimum_samples: minimum,
    min_ms: min,
    max_ms: max,
    spread_ms: min === null || max === null ? null : max - min,
    p50_ms: percentile(normalized, 0.50),
    p95_ms: percentile(normalized, 0.95),
  };
}

function normalizedCompositePhase2Metric(agentType, samples, {
  minimumSamples = 20,
  everySampleHasProxyDeliveryReceipt = null,
} = {}) {
  const values = (Array.isArray(samples) ? samples : [])
    .map(sample => sample?.native_to_browser_paint_ms);
  return {
    integration: 'normalized_composite_stage_source',
    compatibility_verdict: 'compatible_composite_non_adjacent_stage_span',
    ranking_eligible: false,
    exclusion_reason: 'legacy evidence spans agent_first_output through webui_render and cannot rank adjacent stages',
    normalized_stage: {
      from: 'agent_first_output',
      to: 'webui_render',
      key: 'agent_first_output_to_webui_render_ms',
      scope: 'native_event_to_browser_paint',
    },
    metrics: {
      agent_type: agentType || null,
      values_ms: finiteValues(values),
      stats: metricStats(values, minimumSamples),
      ...(everySampleHasProxyDeliveryReceipt === null ? {} : {
        every_sample_has_proxy_delivery_receipt: everySampleHasProxyDeliveryReceipt === true,
      }),
    },
  };
}

function phase2MetricProjection(relativePath, payload, minimumSamples = 20) {
  if (relativePath.endsWith('continue-browser-latency-aggregate-result.json')) {
    return normalizedCompositePhase2Metric(payload.agent_type, payload.samples, {
      minimumSamples,
      everySampleHasProxyDeliveryReceipt: payload.every_sample_has_proxy_delivery_receipt,
    });
  }
  if (relativePath.endsWith('question-prompt-latency-production-50.json')
      || relativePath.endsWith('vscode-question-producer-latency-20.json')) {
    return {
      integration: 'reference_only',
      compatibility_verdict: 'incompatible_prompt_lifecycle_semantics',
      ranking_eligible: false,
      exclusion_reason: 'prompt visibility and acknowledgement timing is not a real-send L0 stage',
      metrics: {
        status: payload.status || null,
        count_per_adapter: payload.count_per_adapter || null,
        summary: payload.summary || {},
      },
    };
  }
  const harness = Array.isArray(payload.harnesses) ? payload.harnesses[0] : null;
  if (!harness) {
    return {
      integration: 'reference_only',
      compatibility_verdict: 'incompatible_missing_native_to_paint_samples',
      ranking_eligible: false,
      exclusion_reason: 'source does not expose native-output to browser-paint samples',
      metrics: { status: payload.status || null },
    };
  }
  return normalizedCompositePhase2Metric(harness.agent_type, harness.samples, {
    minimumSamples,
  });
}

function phase2SourceReceipts(root = ROOT, minimumSamples = 20) {
  return PHASE2_SOURCE_MANIFEST.map(source => {
    const files = source.paths.map(relativePath => {
      const filePath = path.join(root, relativePath);
      if (!fs.existsSync(filePath)) {
        throw new Error(`Phase 2 latency source missing: ${relativePath}`);
      }
      const projection = phase2MetricProjection(relativePath, readJson(filePath), minimumSamples);
      return {
        path: relativePath.replace(/\\/g, '/'),
        sha256: sha256File(filePath),
        ...projection,
      };
    });
    const integrations = [...new Set(files.map(file => file.integration))];
    const verdicts = [...new Set(files.map(file => file.compatibility_verdict))];
    return {
      name: source.name,
      commit: source.commit,
      integration: integrations.length === 1 ? integrations[0] : 'mixed',
      compatibility_verdict: verdicts.length === 1 ? verdicts[0] : 'mixed',
      ranking_eligible: files.every(file => file.ranking_eligible === true),
      files,
    };
  });
}

function readLedger(ledgerPath) {
  if (!fs.existsSync(ledgerPath)) {
    return { total_rows: 0, measured_rows: [], terminal_rows: [] };
  }
  const measuredRows = [];
  const terminalRows = [];
  const traceIds = new Set();
  for (const [index, line] of fs.readFileSync(ledgerPath, 'utf8').split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch (error) {
      throw new Error(`Malformed ledger JSON at line ${index + 1}: ${error.message}`);
    }
    const measured = latencyStageDurations(row);
    if (row.sample_kind !== 'real_webui_send') {
      throw new Error(`Non-real sample in production ledger at line ${index + 1}`);
    }
    const terminal = measured.ok ? null : normalizeLatencyTraceTerminal(row);
    if (!measured.ok && !terminal.ok) {
      throw new Error(
        `Invalid latency ledger row at line ${index + 1}: `
        + `measured=${measured.code}, terminal=${terminal.code}`,
      );
    }
    if (terminal?.ok) {
      const allowedTerminalFields = new Set([
        'schema_version',
        'trace_id',
        'client_message_id',
        'agent_type',
        'surface_class',
        'reason',
        'terminal_at_ms',
        'stages_completed',
        'sample_kind',
        'measurement_status',
        'recorded_at',
      ]);
      const unexpected = Object.keys(row).filter(key => !allowedTerminalFields.has(key));
      if (unexpected.length > 0) {
        throw new Error(
          `Terminal latency row at line ${index + 1} has unexpected fields: `
          + unexpected.sort().join(', '),
        );
      }
      if (row.measurement_status !== 'unmeasured') {
        throw new Error(`Terminal latency row at line ${index + 1} is not marked unmeasured`);
      }
    }
    const traceId = measured.ok ? measured.trace.trace_id : terminal.terminal.trace_id;
    if (traceIds.has(traceId)) {
      throw new Error(`Duplicate trace_id in ledger: ${traceId}`);
    }
    traceIds.add(traceId);
    if (measured.ok) {
      measuredRows.push({
        ...row,
        ...measured.trace,
        durations_ms: measured.durations,
        raw_durations_ms: measured.raw_durations,
      });
    } else {
      terminalRows.push({
        ...terminal.terminal,
        sample_kind: 'real_webui_send',
        measurement_status: 'unmeasured',
        recorded_at: row.recorded_at,
      });
    }
  }
  return {
    total_rows: measuredRows.length + terminalRows.length,
    measured_rows: measuredRows,
    terminal_rows: terminalRows,
  };
}

function readLedgerRows(ledgerPath) {
  return readLedger(ledgerPath).measured_rows;
}

function privacyCleanReceiptPath(filePath, root = ROOT) {
  const relative = path.relative(root, filePath).replace(/\\/g, '/');
  return relative && !relative.startsWith('../') && relative !== '..'
    ? relative
    : `[external]/${path.basename(filePath)}`;
}

function readSampleReceipts(receiptPaths = [], root = ROOT) {
  const byTraceId = new Map();
  const files = [];
  for (const requestedPath of receiptPaths) {
    const filePath = path.resolve(requestedPath);
    if (!fs.existsSync(filePath)) throw new Error(`Sample receipt missing: ${requestedPath}`);
    const payload = readJson(filePath);
    const samples = Array.isArray(payload.samples) ? payload.samples : null;
    if (!samples) throw new Error(`Sample receipt has no samples array: ${requestedPath}`);
    const receiptPath = privacyCleanReceiptPath(filePath, root);
    const costPolicy = payload.fixture_cost_policy && typeof payload.fixture_cost_policy === 'object'
      && !Array.isArray(payload.fixture_cost_policy)
      ? {
        model_id: payload.fixture_cost_policy.model_id || null,
        effort: payload.fixture_cost_policy.effort || null,
        source: payload.fixture_cost_policy.source || null,
        lowest_cost_code_path_verified:
          payload.fixture_cost_policy.lowest_cost_code_path_verified === true,
      }
      : null;
    files.push({
      path: receiptPath,
      sha256: sha256File(filePath),
      samples: samples.length,
      agent_type: payload.agent_type || null,
      surface_class: payload.surface_class || null,
      source_build: payload.source_build || null,
      served_build: payload.served_build || null,
      sampling_topology: payload.sampling_topology || null,
      fixture_cost_policy: costPolicy,
      evidence_consumers: Array.isArray(payload.evidence_consumers)
        ? payload.evidence_consumers
        : [],
    });
    for (const sample of samples) {
      const traceId = String(sample?.trace_id || '').trim();
      if (!traceId) throw new Error(`Sample receipt row missing trace_id: ${requestedPath}`);
      if (byTraceId.has(traceId)) {
        throw new Error(`Duplicate trace_id across sample receipts: ${traceId}`);
      }
      byTraceId.set(traceId, {
        receipt_path: receiptPath,
        payload,
        sample,
      });
    }
  }
  return { byTraceId, files };
}

function nonEmptyReceiptKey(value) {
  const normalized = String(value || '').trim();
  return normalized.length > 0 && normalized.length <= 160 ? normalized : null;
}

function receiptModelReasons(record) {
  const fatal = [];
  const provisional = [];
  const model = record?.sample?.model_receipt;
  if (!model || typeof model !== 'object' || Array.isArray(model)) {
    fatal.push('model_receipt_missing');
    return { fatal, provisional };
  }
  const requestedModel = nonEmptyReceiptKey(model.requested_model_id);
  const observedModel = nonEmptyReceiptKey(model.observed_model_id || model.effective_model_id);
  if (!requestedModel || !observedModel) {
    fatal.push('requested_or_observed_model_missing');
  } else if (requestedModel !== observedModel) {
    fatal.push('requested_observed_model_mismatch');
  }
  const effortUnsupported = model.effort_status === 'unsupported'
    || model.requested_effort_status === 'unsupported'
    || model.observed_effort_status === 'unsupported';
  const requestedEffort = nonEmptyReceiptKey(model.requested_effort);
  const observedEffort = nonEmptyReceiptKey(model.observed_effort);
  if (!effortUnsupported && (!requestedEffort || !observedEffort)) {
    fatal.push('requested_or_observed_effort_missing');
  } else if (!effortUnsupported && requestedEffort !== observedEffort) {
    fatal.push('requested_observed_effort_mismatch');
  }
  if (requestedEffort && ['xhigh', 'max', 'ultra'].includes(requestedEffort.toLowerCase())) {
    fatal.push('expensive_fixture_effort_forbidden');
  }
  const policy = record?.payload?.fixture_cost_policy;
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    provisional.push('fixture_cost_policy_missing');
  } else {
    if (!nonEmptyReceiptKey(policy.source)) provisional.push('fixture_cost_policy_source_missing');
    if (requestedModel && nonEmptyReceiptKey(policy.model_id) !== requestedModel) {
      fatal.push('fixture_cost_policy_model_mismatch');
    }
    if (requestedEffort && nonEmptyReceiptKey(policy.effort) !== requestedEffort) {
      fatal.push('fixture_cost_policy_effort_mismatch');
    }
    if (policy.lowest_cost_code_path_verified !== true) {
      provisional.push('cheap_model_selection_not_explicitly_verified');
    }
  }
  return { fatal, provisional };
}

function assessLedgerRow(row, receiptRecord) {
  const fatalReasons = [];
  const provisionalReasons = [];
  const addFatal = reason => {
    if (!fatalReasons.includes(reason)) fatalReasons.push(reason);
  };
  const addProvisional = reason => {
    if (!provisionalReasons.includes(reason)) provisionalReasons.push(reason);
  };
  const sources = row.stage_sources && typeof row.stage_sources === 'object'
    ? Object.values(row.stage_sources)
    : [];
  if (sources.some(source => (
    Number.isFinite(Number(source?.clock_adjustment_ms))
    && Number(source.clock_adjustment_ms) !== 0
  ))) {
    addFatal('legacy_clamped_clock_row');
  }
  const clockReceipts = {};
  for (const stage of LATENCY_TRACE_STAGES) {
    const source = row.stage_sources?.[stage];
    const expectedDomains = LATENCY_STAGE_CLOCK_DOMAINS[stage] || [];
    const domain = String(source?.clock_domain || '');
    const status = String(source?.clock_status || '');
    const rawAtMs = Number(row.raw_stages?.[stage]);
    const adjustedAtMs = Number(row.stages?.[stage]);
    const offsetMs = Number(source?.clock_offset_ms);
    const rttMs = Number(source?.clock_rtt_ms);
    const uncertaintyMs = Number(source?.clock_uncertainty_ms);
    const sampleAgeMs = Number(source?.clock_sample_age_ms);
    clockReceipts[stage] = {
      domain: domain || null,
      status: status || null,
      raw_at_ms: Number.isFinite(rawAtMs) ? rawAtMs : null,
      adjusted_at_ms: Number.isFinite(adjustedAtMs) ? adjustedAtMs : null,
      offset_ms: Number.isFinite(offsetMs) ? offsetMs : null,
      rtt_ms: Number.isFinite(rttMs) ? rttMs : null,
      uncertainty_ms: Number.isFinite(uncertaintyMs) ? uncertaintyMs : null,
      sample_age_ms: Number.isFinite(sampleAgeMs) ? sampleAgeMs : null,
    };
    if (!expectedDomains.includes(domain)) {
      addFatal(`clock_domain_invalid:${stage}`);
      continue;
    }
    if (!Number.isFinite(rawAtMs) || !Number.isFinite(adjustedAtMs)) {
      addFatal(`clock_raw_or_adjusted_timestamp_missing:${stage}`);
      continue;
    }
    if (domain === 'relay') {
      if (status !== 'reference') addFatal(`clock_status_invalid:${stage}:${status || 'missing'}`);
      if (!Number.isFinite(offsetMs) || offsetMs !== 0 || rawAtMs !== adjustedAtMs) {
        addFatal(`relay_clock_reference_invalid:${stage}`);
      }
      continue;
    }
    if (status !== 'synchronized') addFatal(`clock_status_invalid:${stage}:${status || 'missing'}`);
    if (![offsetMs, rttMs, uncertaintyMs, sampleAgeMs].every(Number.isFinite)) {
      addFatal(`clock_sample_incomplete:${stage}`);
    }
    if (Number.isFinite(offsetMs)
        && Math.abs((rawAtMs + offsetMs) - adjustedAtMs) > 0.001) {
      addFatal(`clock_offset_timestamp_mismatch:${stage}`);
    }
  }
  const causalMatch = row.stage_sources?.agent_first_output?.causal_match || null;
  if (!ALLOWED_CAUSAL_MATCHES.includes(causalMatch)) {
    addFatal('causal_match_missing_or_ambiguous');
  }

  let topology = null;
  let evidenceConsumers = [];
  let independenceKey = null;
  if (!receiptRecord) {
    addFatal('sample_receipt_missing');
  } else {
    const { payload, sample } = receiptRecord;
    if (payload.agent_type && payload.agent_type !== row.agent_type) {
      addFatal('sample_receipt_agent_type_mismatch');
    }
    if (payload.surface_class && payload.surface_class !== row.surface_class) {
      addFatal('sample_receipt_surface_class_mismatch');
    }
    const sourceBuild = nonEmptyReceiptKey(payload.source_build);
    const servedBuild = nonEmptyReceiptKey(payload.served_build);
    if (!sourceBuild || !servedBuild) {
      addFatal('source_or_served_build_receipt_missing');
    } else if (sourceBuild !== servedBuild) {
      addFatal('source_served_build_mismatch');
    }
    const modelReasons = receiptModelReasons(receiptRecord);
    modelReasons.fatal.forEach(addFatal);
    modelReasons.provisional.forEach(addProvisional);

    const independence = sample.independence_receipt;
    const sessionKey = nonEmptyReceiptKey(independence?.session_key);
    const turnKey = nonEmptyReceiptKey(independence?.turn_key);
    if (!sessionKey || !turnKey) {
      addFatal('independent_session_turn_receipt_missing');
    } else {
      independenceKey = `${sessionKey}\u0000${turnKey}`;
    }

    topology = sample.topology && typeof sample.topology === 'object'
      && !Array.isArray(sample.topology)
      ? sample.topology
      : null;
    if (!topology) {
      addProvisional('topology_receipt_missing');
      if (payload.sampling_topology === 'fresh_owned_background_session_per_send') {
        addProvisional('legacy_single_topology_cold_short_sequential_stable_direct');
      }
    } else {
      for (const [dimension, allowed] of Object.entries(TOPOLOGY_DIMENSIONS)) {
        if (!allowed.includes(topology[dimension])) {
          addProvisional(`topology_${dimension}_missing_or_invalid`);
        }
      }
    }

    const rawConsumers = Array.isArray(sample.evidence_consumers)
      ? sample.evidence_consumers
      : (Array.isArray(payload.evidence_consumers) ? payload.evidence_consumers : []);
    evidenceConsumers = [...new Set(rawConsumers.map(value => String(value || '').trim()).filter(Boolean))];
    if (evidenceConsumers.length === 0) {
      addProvisional('evidence_consumer_receipt_missing');
    } else if (evidenceConsumers.some(value => !REQUIRED_EVIDENCE_CONSUMERS.includes(value))) {
      addProvisional('evidence_consumer_receipt_invalid');
    }
  }
  return {
    row,
    receiptRecord,
    causalMatch,
    clockReceipts,
    topology,
    evidenceConsumers,
    independenceKey,
    fatalReasons,
    provisionalReasons,
    disposition: null,
  };
}

function finalizeRowAssessments(assessments) {
  const independentGroups = new Map();
  for (const assessment of assessments) {
    if (!assessment.independenceKey) continue;
    const key = `${assessment.row.surface_class}\u0000${assessment.independenceKey}`;
    if (!independentGroups.has(key)) independentGroups.set(key, []);
    independentGroups.get(key).push(assessment);
  }
  for (const group of independentGroups.values()) {
    if (group.length < 2) continue;
    for (const assessment of group) {
      if (!assessment.fatalReasons.includes('duplicate_session_turn_receipt')) {
        assessment.fatalReasons.push('duplicate_session_turn_receipt');
      }
    }
  }
  for (const assessment of assessments) {
    assessment.fatalReasons.sort();
    assessment.provisionalReasons.sort();
    assessment.disposition = assessment.fatalReasons.length > 0
      ? 'excluded'
      : (assessment.provisionalReasons.length > 0 ? 'provisional' : 'included');
  }
  return assessments;
}

function serializeAssessment(assessment) {
  return {
    trace_id: assessment.row.trace_id,
    agent_type: assessment.row.agent_type,
    surface_class: assessment.row.surface_class,
    disposition: assessment.disposition,
    reasons: [...assessment.fatalReasons, ...assessment.provisionalReasons],
    receipt_path: assessment.receiptRecord?.receipt_path || null,
    causal_match: assessment.causalMatch,
    clock_receipts: assessment.clockReceipts,
    topology: assessment.topology,
    evidence_consumers: assessment.evidenceConsumers,
  };
}

function summarizeSurface(rows, surfaceClass, {
  allowRanking = false,
  minimumSamples = 20,
  rankingStatus = 'withheld',
} = {}) {
  const selected = rows.filter(row => row.surface_class === surfaceClass);
  const stageMetrics = {};
  const rawStageMetrics = {};
  for (let index = 1; index < LATENCY_TRACE_STAGES.length; index += 1) {
    const from = LATENCY_TRACE_STAGES[index - 1];
    const to = LATENCY_TRACE_STAGES[index];
    const key = `${from}_to_${to}_ms`;
    const values = selected.map(row => row.durations_ms[key]);
    const rawValues = selected.map(row => row.raw_durations_ms?.[key]);
    stageMetrics[key] = metricStats(values, minimumSamples);
    rawStageMetrics[key] = metricStats(rawValues, minimumSamples, { allowNegative: true });
  }
  const dominant = allowRanking
    ? (Object.entries(stageMetrics)
      .sort((left, right) => (right[1].p95_ms ?? -1) - (left[1].p95_ms ?? -1))[0] || null)
    : null;
  const totals = selected.map(row => row.durations_ms.total_ms);
  return {
    surface_class: surfaceClass,
    samples: selected.length,
    agent_types: [...new Set(selected.map(row => row.agent_type))].sort(),
    ranking_status: allowRanking ? 'eligible' : rankingStatus,
    dominant_stage: dominant?.[0] || null,
    dominant_stage_p95_ms: dominant?.[1]?.p95_ms ?? null,
    total: metricStats(totals, minimumSamples),
    stages: stageMetrics,
    raw_clock_stages: rawStageMetrics,
  };
}

function buildTopologyCoverage(assessments) {
  return Object.fromEntries(Object.entries(TOPOLOGY_DIMENSIONS).map(([dimension, required]) => {
    const observed = [...new Set(assessments
      .map(assessment => assessment.topology?.[dimension])
      .filter(Boolean))]
      .sort();
    return [
      dimension,
      {
        required,
        observed,
        missing: required.filter(value => !observed.includes(value)),
        pass: required.every(value => observed.includes(value)),
      },
    ];
  }));
}

function buildConsumerCoverage(assessments) {
  const observed = [...new Set(assessments.flatMap(assessment => assessment.evidenceConsumers))].sort();
  return {
    required: REQUIRED_EVIDENCE_CONSUMERS,
    observed,
    missing: REQUIRED_EVIDENCE_CONSUMERS.filter(value => !observed.includes(value)),
    pass: REQUIRED_EVIDENCE_CONSUMERS.every(value => observed.includes(value)),
  };
}

function buildPhase2IntegrationGate(sources) {
  const files = sources.flatMap(source => source.files);
  const normalized = files.filter(file => file.integration === 'normalized_composite_stage_source');
  const references = files.filter(file => file.integration === 'reference_only');
  const expectedNormalized = SCOREBOARD_SOURCES.length + 1;
  const expectedReferences = 2;
  const compatibilityComplete = files.every(file => (
    typeof file.compatibility_verdict === 'string'
    && file.compatibility_verdict.length > 0
  ));
  return {
    expected_normalized_composite_files: expectedNormalized,
    normalized_composite_files: normalized.length,
    expected_reference_only_files: expectedReferences,
    reference_only_files: references.length,
    compatibility_verdicts_complete: compatibilityComplete,
    normalized_sources_ranking_eligible: false,
    pass: normalized.length === expectedNormalized
      && references.length === expectedReferences
      && compatibilityComplete,
  };
}

function buildLatencyReport(rows, {
  minPerSurface = 20,
  ledgerPath = DEFAULT_LEDGER,
  root = ROOT,
  phase2SourceRoot = root,
  sampleReceiptPaths = [],
  ledgerRowCount = null,
  terminalRows = [],
} = {}) {
  const minimum = Math.max(1, Number(minPerSurface) || 20);
  const receiptIndex = readSampleReceipts(sampleReceiptPaths, root);
  const assessments = finalizeRowAssessments(rows.map(row => (
    assessLedgerRow(row, receiptIndex.byTraceId.get(row.trace_id))
  )));
  const includedAssessments = assessments.filter(row => row.disposition === 'included');
  const provisionalAssessments = assessments.filter(row => row.disposition === 'provisional');
  const excludedAssessments = assessments.filter(row => row.disposition === 'excluded');
  const coverage = {};
  for (const surfaceClass of REQUIRED_SURFACE_CLASSES) {
    const surfaceAssessments = assessments.filter(row => row.row.surface_class === surfaceClass);
    const included = surfaceAssessments.filter(row => row.disposition === 'included');
    const topology = buildTopologyCoverage(included);
    const evidenceConsumers = buildConsumerCoverage(included);
    const sampleGatePass = included.length >= minimum;
    coverage[surfaceClass] = {
      ledger_rows: surfaceAssessments.length,
      included_rows: included.length,
      provisional_rows: surfaceAssessments.filter(row => row.disposition === 'provisional').length,
      excluded_rows: surfaceAssessments.filter(row => row.disposition === 'excluded').length,
      independent_valid_real_sends: included.length,
      required_independent_valid_real_sends: minimum,
      sample_gate_pass: sampleGatePass,
      topology,
      topology_gate_pass: Object.values(topology).every(entry => entry.pass),
      evidence_consumers: evidenceConsumers,
      consumer_gate_pass: evidenceConsumers.pass,
    };
    coverage[surfaceClass].pass = coverage[surfaceClass].sample_gate_pass
      && coverage[surfaceClass].topology_gate_pass
      && coverage[surfaceClass].consumer_gate_pass;
  }
  const phase2StageSources = phase2SourceReceipts(phase2SourceRoot, minimum);
  const phase2IntegrationGate = buildPhase2IntegrationGate(phase2StageSources);
  const coveragePass = Object.values(coverage).every(entry => entry.pass);
  const status = coveragePass && phase2IntegrationGate.pass ? 'PASS' : 'INCOMPLETE';
  const rankingAllowed = status === 'PASS';
  const includedRows = includedAssessments.map(assessment => assessment.row);
  const terminalReasonCounts = {};
  const terminalSurfaceCounts = {};
  for (const terminal of terminalRows) {
    terminalReasonCounts[terminal.reason] = (terminalReasonCounts[terminal.reason] || 0) + 1;
    terminalSurfaceCounts[terminal.surface_class] =
      (terminalSurfaceCounts[terminal.surface_class] || 0) + 1;
  }
  return {
    schema_version: 2,
    generated_at: new Date().toISOString(),
    status,
    can_rank_dominant_stages: rankingAllowed,
    can_prioritize_p3_3: rankingAllowed,
    ranking_policy: rankingAllowed
      ? 'all required integrity, sample, topology, consumer, and Phase 2 integration gates passed'
      : 'withheld until every required surface and Phase 2 integration gate passes',
    ledger_path: privacyCleanReceiptPath(path.resolve(ledgerPath), root),
    ledger_rows: Number.isInteger(ledgerRowCount) ? ledgerRowCount : rows.length,
    measured_ledger_rows: rows.length,
    terminal_ledger_rows: terminalRows.length,
    terminal_reason_counts: Object.fromEntries(Object.entries(terminalReasonCounts).sort()),
    terminal_surface_counts: Object.fromEntries(Object.entries(terminalSurfaceCounts).sort()),
    sample_contract: 'relay-finalized real WebUI sends only; content and session identifiers are not persisted',
    clock_policy: {
      reference_clock: 'relay',
      ranking_bucket: 'relay_adjusted_synchronized',
      raw_observations_retained: true,
      legacy_clamped_rows_excluded: true,
      stale_unsynchronized_high_rtt_and_skew_threshold_rows_excluded: true,
    },
    required_surface_classes: REQUIRED_SURFACE_CLASSES,
    required_evidence_consumers: REQUIRED_EVIDENCE_CONSUMERS,
    topology_dimensions: TOPOLOGY_DIMENSIONS,
    minimum_real_sends_per_surface: minimum,
    sample_receipts: receiptIndex.files,
    row_disposition_counts: {
      included: includedAssessments.length,
      provisional: provisionalAssessments.length,
      excluded: excludedAssessments.length,
      terminal: terminalRows.length,
    },
    row_dispositions: {
      included: includedAssessments.map(serializeAssessment),
      provisional: provisionalAssessments.map(serializeAssessment),
      excluded: excludedAssessments.map(serializeAssessment),
    },
    coverage,
    surface_table: REQUIRED_SURFACE_CLASSES.map(surfaceClass => summarizeSurface(
      includedRows,
      surfaceClass,
      {
        allowRanking: rankingAllowed,
        minimumSamples: minimum,
        rankingStatus: 'withheld_by_global_gate',
      },
    )),
    preliminary_surface_table: REQUIRED_SURFACE_CLASSES.map(surfaceClass => summarizeSurface(
      rows,
      surfaceClass,
      {
        allowRanking: false,
        minimumSamples: minimum,
        rankingStatus: 'preliminary_not_for_ranking',
      },
    )),
    phase2_integration_gate: phase2IntegrationGate,
    phase2_stage_sources: phase2StageSources,
  };
}

function main() {
  const ledgerPath = path.resolve(argumentValue('--ledger', DEFAULT_LEDGER));
  const outputPath = argumentValue('--output');
  const minPerSurface = Number(argumentValue('--min-per-surface', '20'));
  const sampleReceiptPaths = argumentValues('--sample-receipt').map(receiptPath => path.resolve(receiptPath));
  const ledger = readLedger(ledgerPath);
  const report = buildLatencyReport(ledger.measured_rows, {
    minPerSurface,
    ledgerPath,
    sampleReceiptPaths,
    ledgerRowCount: ledger.total_rows,
    terminalRows: ledger.terminal_rows,
  });
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) {
    const resolvedOutput = path.resolve(outputPath);
    fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true });
    fs.writeFileSync(resolvedOutput, serialized, 'utf8');
  }
  process.stdout.write(serialized);
  if (report.status !== 'PASS' && !process.argv.includes('--allow-incomplete')) process.exitCode = 1;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Latency trace ledger report: FAIL (${error.stack || error.message})`);
    process.exitCode = 1;
  }
}

module.exports = {
  ALLOWED_CAUSAL_MATCHES,
  PHASE2_SOURCE_MANIFEST,
  REQUIRED_EVIDENCE_CONSUMERS,
  REQUIRED_SURFACE_CLASSES,
  TOPOLOGY_DIMENSIONS,
  assessLedgerRow,
  buildLatencyReport,
  metricStats,
  phase2SourceReceipts,
  readLedger,
  readLedgerRows,
  readSampleReceipts,
  summarizeSurface,
};
