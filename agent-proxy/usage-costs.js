'use strict';

const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');

const COST_SCHEMA_VERSION = 2;
const PRICING_CATALOG_VERSION = 'wincodexbar-0.42.0-0303e423-2026-07-14';
const DEFAULT_MAX_BYTES_PER_REFRESH = 8 * 1024 * 1024;
const MAX_JSONL_LINE_BYTES = 2 * 1024 * 1024;
const MAX_RECORDS = 250000;
const MAX_DETAIL_PAGE_ROWS = 256;
const MAX_DETAIL_QUERY_CACHE = 8;
const LOCAL_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

function calendarDay(value, timeZone = LOCAL_TIME_ZONE) {
  const timestamp = typeof value === 'number' ? value : Date.parse(value || '');
  if (!Number.isFinite(timestamp)) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(timestamp)).filter(part => part.type !== 'literal')
    .map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

const CODEX_PRICING = Object.freeze({
  'gpt-5.5': { input: 5, cached: 0.5, output: 30 },
  'gpt-5.5-pro': { input: 30, cached: 30, output: 180 },
  'gpt-5.6-sol': { input: 5, cached: 0.5, output: 30, long: { input: 10, cached: 1, output: 45 } },
  'gpt-5.6-terra': { input: 2.5, cached: 0.25, output: 15, long: { input: 5, cached: 0.5, output: 22.5 } },
  'gpt-5.6-luna': { input: 1, cached: 0.1, output: 6, long: { input: 2, cached: 0.2, output: 9 } },
});

const CLAUDE_PRICING = Object.freeze({
  'claude-fable-5': { input: 10, cacheCreate: 12.5, cached: 1, output: 50 },
  'claude-haiku-4-5': { input: 1, cacheCreate: 1.25, cached: 0.1, output: 5 },
  'claude-opus-4-5': { input: 5, cacheCreate: 6.25, cached: 0.5, output: 25 },
  'claude-opus-4-6': { input: 5, cacheCreate: 6.25, cached: 0.5, output: 25 },
  'claude-opus-4-7': { input: 5, cacheCreate: 6.25, cached: 0.5, output: 25 },
  'claude-opus-4-8': { input: 5, cacheCreate: 6.25, cached: 0.5, output: 25 },
  'claude-sonnet-4-5': {
    input: 3, cacheCreate: 3.75, cached: 0.3, output: 15,
    threshold: 200000, long: { input: 6, cacheCreate: 7.5, cached: 0.6, output: 22.5 },
  },
  'claude-sonnet-4-6': {
    input: 3, cacheCreate: 3.75, cached: 0.3, output: 15,
    threshold: 200000, long: { input: 6, cacheCreate: 7.5, cached: 0.6, output: 22.5 },
  },
});

function finiteToken(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 0;
}

function safeModel(value) {
  const text = String(value || '').trim().slice(0, 120);
  return text && /^[a-z0-9._:/+\-]+$/i.test(text)
    && !/^(?:sk-|bearer)|^eyj[a-z0-9_-]{8,}\./i.test(text) ? text : 'unknown';
}

function safeProject(value) {
  const text = String(value || '').trim();
  if (!text) return 'Unknown project';
  const base = path.basename(text.replace(/[\\/]+$/, '')) || text;
  const sanitized = base.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
  return sanitized && !sanitized.includes('@')
    && !/(?:^|\s)(?:sk-|bearer\s+)|eyj[a-z0-9_-]{8,}\./i.test(sanitized)
    ? sanitized : 'Private project';
}

function normalizeCodexModel(value) {
  let model = safeModel(value).toLowerCase().replace(/^openai\//, '');
  model = model.replace(/-(?:fast|priority|spark|smoke)$/, '');
  if (model === 'gpt-5.6' || /^gpt-5\.6(?:-codex)?(?:-\d{4}-\d{2}-\d{2})?$/.test(model)) return 'gpt-5.6-sol';
  for (const family of ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5-pro', 'gpt-5.5']) {
    if (model === family || model.startsWith(`${family}-codex`) || model.startsWith(`${family}-20`)) return family;
  }
  return model;
}

function normalizeClaudeModel(value) {
  let model = safeModel(value).toLowerCase().replace(/^anthropic\./, '');
  const nested = model.split('.').filter(part => part.startsWith('claude-')).at(-1);
  if (nested) model = nested;
  model = model.replace(/-v\d+:\d+$/, '');
  if (/claude-fable-5/.test(model)) return 'claude-fable-5';
  if (/claude-haiku-4[-.]?5/.test(model)) return 'claude-haiku-4-5';
  for (const version of ['8', '7', '6', '5']) {
    if (new RegExp(`claude-opus-4[-.]?${version}`).test(model)) return `claude-opus-4-${version}`;
  }
  if (/claude-sonnet-4[-.]?6/.test(model)) return 'claude-sonnet-4-6';
  if (/claude-sonnet-4[-.]?5/.test(model)) return 'claude-sonnet-4-5';
  return model.replace(/-\d{8}$/, '');
}

function codexSpeed(model, serviceTier = '') {
  const value = `${model} ${serviceTier}`.toLowerCase();
  return /fast|priority|spark|smoke/.test(value) ? 'fast/priority' : 'standard';
}

function priceRecord(providerId, modelValue, tokens) {
  const input = finiteToken(tokens.input);
  const cached = Math.min(input, finiteToken(tokens.cached));
  const output = finiteToken(tokens.output);
  const cacheCreate = Math.min(input, finiteToken(tokens.cacheCreate));
  if (providerId === 'openai-codex') {
    const model = normalizeCodexModel(modelValue);
    const found = CODEX_PRICING[model];
    const fallback = !found;
    const catalog = found || CODEX_PRICING['gpt-5.6-sol'];
    const rates = input > 272000 && catalog.long ? catalog.long : catalog;
    const nonCached = Math.max(0, input - cached);
    const cost = (nonCached * rates.input + cached * rates.cached + output * rates.output) / 1_000_000;
    return {
      model,
      costUsd: cost,
      pricingProvenance: fallback ? 'unknown_fallback:gpt-5.6-sol' : `catalog:${PRICING_CATALOG_VERSION}`,
      unknown: fallback,
    };
  }
  const model = normalizeClaudeModel(modelValue);
  const found = CLAUDE_PRICING[model];
  const fallback = !found;
  const catalog = found || CLAUDE_PRICING['claude-sonnet-4-6'];
  const rates = catalog.threshold && input > catalog.threshold ? catalog.long : catalog;
  const cacheRead = Math.max(0, cached - cacheCreate);
  const nonCached = Math.max(0, input - cached);
  const cost = (nonCached * rates.input + cacheCreate * rates.cacheCreate
    + cacheRead * rates.cached + output * rates.output) / 1_000_000;
  return {
    model,
    costUsd: cost,
    pricingProvenance: fallback ? 'unknown_fallback:claude-sonnet-4-6' : `catalog:${PRICING_CATALOG_VERSION}`,
    unknown: fallback,
  };
}

function recordId(providerId, nativeId, line) {
  const identity = nativeId ? `${providerId}:${nativeId}` : `${providerId}:line:${line}`;
  return crypto.createHash('sha256').update(identity).digest('hex');
}

function parseTimestamp(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function usageFields(value) {
  const input = finiteToken(value?.input_tokens ?? value?.inputTokens ?? value?.input);
  const cacheRead = finiteToken(value?.cache_read_input_tokens ?? value?.cacheReadInputTokens);
  const cacheCreate = finiteToken(value?.cache_creation_input_tokens ?? value?.cacheCreationInputTokens);
  const reportedCached = finiteToken(value?.cached_input_tokens ?? value?.cachedInputTokens ?? value?.cached);
  const cached = reportedCached || cacheRead + cacheCreate;
  return {
    input: Math.max(input, input + (reportedCached ? 0 : cached)),
    cached,
    cacheCreate,
    output: finiteToken(value?.output_tokens ?? value?.outputTokens ?? value?.output),
  };
}

function parseCostLine(providerId, line, previousContext = {}) {
  let item;
  try { item = JSON.parse(line); } catch { return { context: previousContext, record: null, malformed: true }; }
  const context = { ...previousContext };
  if (providerId === 'openai-codex') {
    const payload = item?.payload || {};
    if (item?.type === 'session_meta') {
      context.project = safeProject(payload.cwd || payload.project_root || payload.project);
    }
    if (item?.type === 'turn_context') {
      context.model = safeModel(payload.model || payload.info?.model || context.model);
      context.project = safeProject(payload.cwd || payload.project_root || payload.project || context.project);
      context.serviceTier = String(payload.service_tier || payload.serviceTier || context.serviceTier || '');
    }
    if (item?.type !== 'event_msg' || payload?.type !== 'token_count') return { context, record: null };
    const usage = payload.info?.last_token_usage || payload.info?.lastTokenUsage
      || payload.last_token_usage || payload.usage || payload.token_usage;
    const tokens = usageFields(usage);
    if (tokens.input + tokens.output === 0) return { context, record: null };
    const timestamp = parseTimestamp(item.timestamp || payload.timestamp);
    if (!timestamp) return { context, record: null };
    const rawModel = safeModel(usage?.model || payload.model || context.model);
    const pricing = priceRecord(providerId, rawModel, tokens);
    return { context, record: {
      id: recordId(providerId, payload.id || payload.request_id || payload.message_id, line),
      provider_id: providerId, timestamp, day: calendarDay(timestamp), model: pricing.model,
      project: safeProject(context.project), speed: codexSpeed(rawModel, usage?.service_tier || context.serviceTier),
      tokens, cost_usd: pricing.costUsd, pricing_provenance: pricing.pricingProvenance,
      unknown_model: pricing.unknown ? rawModel : null,
    } };
  }
  const message = item?.message || item?.payload?.message || {};
  if (item?.type !== 'assistant' || !message?.usage) return { context, record: null };
  const tokens = usageFields(message.usage);
  if (tokens.input + tokens.output === 0) return { context, record: null };
  const timestamp = parseTimestamp(item.timestamp || message.created_at || item.created_at);
  if (!timestamp) return { context, record: null };
  const rawModel = safeModel(message.model || item.model);
  const pricing = priceRecord(providerId, rawModel, tokens);
  return { context, record: {
    id: recordId(providerId, message.id || item.uuid || item.requestId, line),
    provider_id: providerId, timestamp, day: calendarDay(timestamp), model: pricing.model,
    project: safeProject(item.cwd || item.project || context.project),
    speed: /priority|fast/i.test(String(message.usage.service_tier || message.service_tier || ''))
      ? 'fast/priority' : 'standard',
    tokens, cost_usd: pricing.costUsd, pricing_provenance: pricing.pricingProvenance,
    unknown_model: pricing.unknown ? rawModel : null,
  } };
}

async function discoverJsonl(root) {
  const files = [];
  async function visit(directory) {
    let entries;
    try { entries = await fsp.readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.jsonl')) files.push(target);
    }
  }
  await visit(root);
  return files.sort();
}

function emptyState() {
  return { version: COST_SCHEMA_VERSION, files: {}, records: {} };
}

function emptyTotals() {
  return { input: 0, cached: 0, output: 0, cost_usd: 0, records: 0 };
}

function addTotals(target, record) {
  target.input += record.tokens.input;
  target.cached += record.tokens.cached;
  target.output += record.tokens.output;
  target.cost_usd += record.cost_usd;
  target.records += 1;
}

function aggregateRecords(records, nowMs, maxDays = 365, filters = {}) {
  const until = calendarDay(nowMs);
  const sinceDate = new Date(`${until}T12:00:00.000Z`);
  sinceDate.setUTCDate(sinceDate.getUTCDate() - Math.max(0, maxDays - 1));
  const since = sinceDate.toISOString().slice(0, 10);
  const included = records.filter(record => (
    record.day >= since && record.day <= until
    && (!filters.providerId || record.provider_id === filters.providerId)
    && (!filters.project || record.project === filters.project)
  ));
  const total = emptyTotals();
  const buckets = { provider: new Map(), model: new Map(), project: new Map(), day: new Map(), speed: new Map(), daily: new Map() };
  const unknown = new Map();
  for (const record of included) {
    addTotals(total, record);
    for (const [kind, key] of [
      ['provider', record.provider_id], ['model', `${record.provider_id}|${record.model}`],
      ['project', `${record.provider_id}|${record.project}`], ['day', record.day], ['speed', record.speed],
      ['daily', `${record.day}|${record.provider_id}|${record.model}|${record.project}|${record.speed}`],
    ]) {
      if (!buckets[kind].has(key)) buckets[kind].set(key, emptyTotals());
      addTotals(buckets[kind].get(key), record);
    }
    if (record.unknown_model) unknown.set(`${record.provider_id}|${record.unknown_model}`, {
      provider_id: record.provider_id, model: record.unknown_model,
      fallback: record.pricing_provenance.replace(/^unknown_fallback:/, ''),
    });
  }
  const rows = (map, fields) => [...map.entries()].map(([key, totals]) => {
    const values = key.split('|');
    const row = { ...totals, cost_usd: Number(totals.cost_usd.toFixed(8)) };
    fields.forEach((field, index) => { row[field] = values[index]; });
    return row;
  }).sort((left, right) => fields.map(field => String(left[field] || '')).join('|')
    .localeCompare(fields.map(field => String(right[field] || '')).join('|')));
  return {
    range: { days: maxDays, since, until },
    tokens: { input: total.input, cached: total.cached, output: total.output },
    cost_usd: Number(total.cost_usd.toFixed(8)), records: total.records,
    by_provider: rows(buckets.provider, ['provider_id']),
    by_model: rows(buckets.model, ['provider_id', 'model']),
    by_project: rows(buckets.project, ['provider_id', 'project']),
    by_day: rows(buckets.day, ['day']),
    by_speed: rows(buckets.speed, ['speed']),
    daily_breakdown: rows(buckets.daily, ['day', 'provider_id', 'model', 'project', 'speed']),
    unknown_models: [...unknown.values()].sort((a, b) => a.model.localeCompare(b.model)),
  };
}

class LocalUsageCostScanner {
  constructor(options = {}) {
    this.roots = options.roots || [
      { providerId: 'openai-codex', root: path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'sessions') },
      { providerId: 'anthropic-claude', root: path.join(os.homedir(), '.claude', 'projects') },
    ];
    const stateDirectory = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.remote-agent-chat'), 'RemoteAgentChat');
    this.checkpointPath = options.checkpointPath || path.join(stateDirectory, 'provider-cost-checkpoint-v1.json');
    this.maxBytesPerRefresh = Math.max(1024, Number(options.maxBytesPerRefresh) || DEFAULT_MAX_BYTES_PER_REFRESH);
    this.now = typeof options.now === 'function' ? options.now : Date.now;
    this.state = null;
    this.status = 'not-started';
    this.lastResult = null;
    this.inFlight = null;
    this.detailRecords = null;
    this.detailGeneratedAt = null;
    this.detailNowMs = null;
    this.detailAggregateCache = new Map();
  }

  async load() {
    if (this.state) return;
    try {
      const parsed = JSON.parse(await fsp.readFile(this.checkpointPath, 'utf8'));
      this.state = parsed?.version === COST_SCHEMA_VERSION && parsed.files && parsed.records ? parsed : emptyState();
    } catch {
      this.state = emptyState();
    }
  }

  async save() {
    await fsp.mkdir(path.dirname(this.checkpointPath), { recursive: true });
    const temporary = `${this.checkpointPath}.${process.pid}.tmp`;
    await fsp.writeFile(temporary, `${JSON.stringify(this.state)}\n`, { encoding: 'utf8', mode: 0o600 });
    await fsp.rename(temporary, this.checkpointPath);
  }

  snapshot() {
    if (this.lastResult) return this.status === 'scanning'
      ? { ...this.lastResult, status: 'scanning', last_good_generated_at: this.lastResult.generated_at }
      : this.lastResult;
    return {
      schema_version: COST_SCHEMA_VERSION,
      catalog_version: PRICING_CATALOG_VERSION,
      label: 'Local estimated API-equivalent cost',
      status: this.status,
      generated_at: null,
      range: { days: 365, since: null, until: null },
      tokens: { input: 0, cached: 0, output: 0 },
      cost_usd: 0,
      records: 0,
      by_provider: [], by_model: [], by_project: [], by_day: [], by_speed: [], daily_breakdown: [],
      unknown_models: [],
      scan: { files_total: 0, files_complete: 0, bytes_read: 0, checkpoint_hash: null },
    };
  }

  async detailPage(options = {}) {
    await this.load();
    const days = Math.max(1, Math.min(365, Number(options.days) || 365));
    const pageSize = Math.max(1, Math.min(MAX_DETAIL_PAGE_ROWS, Number(options.pageSize) || MAX_DETAIL_PAGE_ROWS));
    const offset = /^\d{1,9}$/.test(String(options.cursor ?? '0')) ? Number(options.cursor || 0) : 0;
    const requestedProviderId = String(options.providerId || '').trim();
    if (requestedProviderId && !['openai-codex', 'anthropic-claude'].includes(requestedProviderId)) {
      const error = new Error('Invalid provider cost-detail filter.');
      error.code = 'invalid_provider_filter';
      throw error;
    }
    const providerId = requestedProviderId;
    const project = String(options.project || '').trim();
    if (project.length > 100) {
      const error = new Error('Invalid project cost-detail filter.');
      error.code = 'invalid_project_filter';
      throw error;
    }
    if (!this.detailRecords) {
      this.detailNowMs = this.now();
      this.detailGeneratedAt = this.lastResult?.generated_at || new Date(this.detailNowMs).toISOString();
      this.detailRecords = Object.values(this.state.records || {});
      this.detailAggregateCache.clear();
    }
    const queryKey = JSON.stringify([days, providerId, project]);
    let aggregate = this.detailAggregateCache.get(queryKey);
    if (!aggregate) {
      aggregate = aggregateRecords(this.detailRecords, this.detailNowMs, days, {
        providerId: providerId || null,
        project: project || null,
      });
      this.detailAggregateCache.set(queryKey, aggregate);
      while (this.detailAggregateCache.size > MAX_DETAIL_QUERY_CACHE) {
        this.detailAggregateCache.delete(this.detailAggregateCache.keys().next().value);
      }
    }
    const rows = aggregate.daily_breakdown;
    const pageRows = rows.slice(offset, offset + pageSize);
    const nextOffset = offset + pageRows.length;
    return {
      schema_version: 1,
      status: ['ready', 'partial', 'stale'].includes(this.status) ? this.status : 'stale',
      generated_at: this.detailGeneratedAt,
      query: { days, provider_id: providerId || null, project: project || null },
      summary: {
        range: aggregate.range,
        tokens: aggregate.tokens,
        cost_usd: aggregate.cost_usd,
        records: aggregate.records,
        by_model: aggregate.by_model,
        by_day: aggregate.by_day,
      },
      rows: pageRows,
      pagination: {
        cursor: String(offset),
        next_cursor: nextOffset < rows.length ? String(nextOffset) : null,
        page_size: pageSize,
        returned_rows: pageRows.length,
        total_rows: rows.length,
      },
    };
  }

  refresh(options = {}) {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this._refresh(options).finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  async _refresh(options) {
    await this.load();
    this.status = 'scanning';
    const signal = options.signal || null;
    const files = [];
    for (const spec of this.roots) {
      for (const file of await discoverJsonl(spec.root)) {
        try {
          const stats = await fsp.stat(file);
          const fileKey = crypto.createHash('sha256').update(`${spec.providerId}\0${file}`).digest('hex');
          files.push({ ...spec, file, fileKey, stats });
        } catch {}
      }
    }
    // A partial dashboard should be useful immediately. New/current session
    // files therefore consume the bounded byte budget before older archives;
    // durable offsets still make every subsequent pass incremental.
    files.sort((left, right) => right.stats.mtimeMs - left.stats.mtimeMs
      || left.file.localeCompare(right.file));
    let bytesRead = 0;
    let malformedLines = 0;
    let cancelled = false;
    let checkpointChanged = false;
    for (const spec of files) {
      if (signal?.aborted) { cancelled = true; break; }
      if (bytesRead >= this.maxBytesPerRefresh) break;
      const { stats, fileKey } = spec;
      const previousCheckpoint = this.state.files[fileKey] || null;
      let checkpoint = previousCheckpoint || {
        provider_id: spec.providerId, offset: 0, size: 0, context: {}, record_ids: [],
      };
      let fileChanged = !previousCheckpoint;
      if (stats.size < checkpoint.offset) {
        for (const id of checkpoint.record_ids || []) {
          const record = this.state.records[id];
          if (!record) continue;
          const owners = Array.isArray(record.file_keys)
            ? record.file_keys.filter(key => key !== fileKey)
            : (record.file_key && record.file_key !== fileKey ? [record.file_key] : []);
          if (owners.length === 0) delete this.state.records[id];
          else this.state.records[id] = { ...record, file_keys: owners, file_key: undefined };
        }
        checkpoint = { provider_id: spec.providerId, offset: 0, size: 0, context: {}, record_ids: [] };
        fileChanged = true;
      }
      while (checkpoint.offset < stats.size && bytesRead < this.maxBytesPerRefresh) {
        if (signal?.aborted) { cancelled = true; break; }
        const remaining = Math.min(stats.size - checkpoint.offset, this.maxBytesPerRefresh - bytesRead, 1024 * 1024);
        const handle = await fsp.open(spec.file, 'r');
        let buffer;
        try {
          buffer = Buffer.alloc(remaining);
          const result = await handle.read(buffer, 0, remaining, checkpoint.offset);
          buffer = buffer.subarray(0, result.bytesRead);
        } finally {
          await handle.close();
        }
        if (buffer.length === 0) break;
        const lastNewline = buffer.lastIndexOf(0x0a);
        if (lastNewline < 0) {
          if (buffer.length >= MAX_JSONL_LINE_BYTES) {
            checkpoint.offset += buffer.length;
            bytesRead += buffer.length;
            malformedLines += 1;
            fileChanged = true;
          }
          break;
        }
        const complete = buffer.subarray(0, lastNewline + 1);
        const lines = complete.toString('utf8').split(/\r?\n/);
        for (const line of lines) {
          if (!line) continue;
          const parsed = parseCostLine(spec.providerId, line, checkpoint.context);
          checkpoint.context = parsed.context;
          if (parsed.malformed) malformedLines += 1;
          if (parsed.record) {
            const existing = this.state.records[parsed.record.id];
            if (!existing) {
              if (Object.keys(this.state.records).length >= MAX_RECORDS) continue;
              this.state.records[parsed.record.id] = { ...parsed.record, file_keys: [fileKey] };
            } else {
              const owners = new Set(Array.isArray(existing.file_keys)
                ? existing.file_keys
                : [existing.file_key].filter(Boolean));
              owners.add(fileKey);
              this.state.records[parsed.record.id] = { ...existing, file_keys: [...owners], file_key: undefined };
            }
            if (!checkpoint.record_ids.includes(parsed.record.id)) checkpoint.record_ids.push(parsed.record.id);
          }
        }
        checkpoint.offset += complete.length;
        bytesRead += complete.length;
        fileChanged = true;
        if (cancelled || complete.length < buffer.length) break;
        await new Promise(resolve => setImmediate(resolve));
      }
      checkpoint.size = stats.size;
      checkpoint.mtime_ms = Math.round(stats.mtimeMs);
      this.state.files[fileKey] = checkpoint;
      checkpointChanged ||= fileChanged;
      if (cancelled) break;
    }
    if (checkpointChanged) await this.save();
    const complete = files.filter(spec => {
      return (this.state.files[spec.fileKey]?.offset || 0) >= (this.state.files[spec.fileKey]?.size || 0);
    }).length;
    const completedAt = this.now();
    const completedRecords = Object.values(this.state.records);
    const aggregate = aggregateRecords(completedRecords, completedAt, 365);
    const checkpointHash = crypto.createHash('sha256').update(JSON.stringify({
      files: Object.entries(this.state.files).map(([key, value]) => [key, value.offset, value.size]).sort(),
      records: Object.keys(this.state.records).sort(),
    })).digest('hex');
    this.status = cancelled ? 'cancelled' : (complete === files.length ? 'ready' : 'partial');
    this.lastResult = {
      schema_version: COST_SCHEMA_VERSION,
      catalog_version: PRICING_CATALOG_VERSION,
      label: 'Local estimated API-equivalent cost',
      status: this.status,
      generated_at: new Date(completedAt).toISOString(),
      ...aggregate,
      scan: {
        files_total: files.length,
        files_complete: complete,
        bytes_read: bytesRead,
        malformed_lines: malformedLines,
        checkpoint_hash: checkpointHash,
      },
    };
    this.detailRecords = completedRecords;
    this.detailGeneratedAt = this.lastResult.generated_at;
    this.detailNowMs = completedAt;
    this.detailAggregateCache.clear();
    return this.lastResult;
  }
}

module.exports = {
  COST_SCHEMA_VERSION,
  LocalUsageCostScanner,
  MAX_DETAIL_PAGE_ROWS,
  PRICING_CATALOG_VERSION,
  aggregateRecords,
  calendarDay,
  normalizeClaudeModel,
  normalizeCodexModel,
  parseCostLine,
  priceRecord,
};
