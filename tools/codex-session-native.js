'use strict';

const { CodexAppServerConnection } = require('../agent-proxy/codex-app-server');

const PRESERVED_GOAL_STATUSES = new Set(['blocked', 'budgetLimited', 'complete']);

function goalFromResponse(response) {
  return response?.goal || null;
}

function percent(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function epochSecondsToIso(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return new Date(parsed * 1000).toISOString();
}

function normalizeRateLimitState(response) {
  const primary = response?.rateLimits || {};
  const byLimitId = response?.rateLimitsByLimitId && typeof response.rateLimitsByLimitId === 'object'
    ? Object.values(response.rateLimitsByLimitId)
    : [];
  const buckets = [primary, ...byLimitId];
  const windows = [];
  for (const bucket of buckets) {
    for (const key of ['primary', 'secondary']) {
      const window = bucket?.[key];
      const usedPercent = percent(window?.usedPercent ?? window?.used_percent);
      if (usedPercent == null) continue;
      windows.push({
        usedPercent,
        resetsAt: epochSecondsToIso(window?.resetsAt ?? window?.resets_at),
      });
    }
  }
  const limited = buckets.some(bucket => Boolean(bucket?.rateLimitReachedType ?? bucket?.rate_limit_reached_type))
    || windows.some(window => window.usedPercent >= 100);
  const resetSummary = response?.rateLimitResetCredits || response?.rate_limit_reset_credits || {};
  const resetCreditsAvailable = Math.max(0, Number(
    resetSummary.availableCount ?? resetSummary.available_count,
  ) || 0);
  const resetsAt = windows
    .map(window => window.resetsAt)
    .filter(Boolean)
    .sort()[0] || null;
  return {
    status: 'ready',
    limited,
    reason: limited ? 'usage_limited' : 'available',
    resetsAt,
    resetCreditsAvailable,
    attention: limited && resetCreditsAvailable > 0 ? {
      type: 'codex_rate_limit_reset',
      message: `${resetCreditsAvailable} limit reset${resetCreditsAvailable === 1 ? '' : 's'} available — apply one?`,
      action: 'operator_approval_required',
      autoConsume: false,
    } : null,
  };
}

class NativeCodexSessionManager {
  constructor({ sessionId, cwd, connectionFactory } = {}) {
    this.sessionId = sessionId;
    this.cwd = cwd;
    this.connectionFactory = connectionFactory || (options => new CodexAppServerConnection(options));
    this.connection = null;
  }

  async start() {
    if (this.connection) return this.connection;
    this.connection = this.connectionFactory({
      sessionId: this.sessionId,
      cwd: this.cwd,
      clientName: 'remote-agent-chat-session-manager',
      clientVersion: '1.0.0',
    });
    await this.connection.start();
    return this.connection;
  }

  async readUsageState() {
    const connection = await this.start();
    return normalizeRateLimitState(await connection.readRateLimits());
  }

  async getGoal(threadId) {
    const connection = await this.start();
    return goalFromResponse(await connection.getGoal(threadId));
  }

  async ensureGoal(threadId, objective, status, options = {}) {
    let normalizedObjective = String(objective || '').trim();
    if (!normalizedObjective) return { ok: false, reason: 'goal_objective_missing', goal: null };
    const connection = await this.start();
    const before = goalFromResponse(await connection.getGoal(threadId));
    if (before && before.objective !== normalizedObjective && options.acceptExistingObjective === true) {
      normalizedObjective = before.objective;
    } else if (before && before.objective !== normalizedObjective) {
      return { ok: false, reason: 'goal_objective_mismatch', goal: before };
    }
    let action = 'existing';
    let expectedStatus = before?.status || status;
    if (!before) {
      await connection.setGoal(threadId, status, { objective: normalizedObjective });
      action = 'created';
      expectedStatus = status;
    } else if (options.updateExisting === true
        && before.status !== status
        && !(options.preserveExistingStatuses !== false && PRESERVED_GOAL_STATUSES.has(before.status))) {
      await connection.setGoal(threadId, status);
      action = 'updated';
      expectedStatus = status;
    }
    const goal = goalFromResponse(await connection.getGoal(threadId));
    if (!goal) return { ok: false, reason: 'goal_not_acknowledged', goal: null };
    if (goal.objective !== normalizedObjective) {
      return { ok: false, reason: 'goal_objective_mismatch', goal };
    }
    if (goal.status !== expectedStatus) {
      return { ok: false, reason: 'goal_status_not_acknowledged', goal, expectedStatus };
    }
    return { ok: true, action, goal };
  }

  async clearGoal(threadId) {
    const connection = await this.start();
    let rearchive = false;
    let before;
    try {
      before = goalFromResponse(await connection.getGoal(threadId));
    } catch (originalError) {
      let unarchived = false;
      try {
        await connection.request('thread/unarchive', { threadId });
        unarchived = true;
        before = goalFromResponse(await connection.getGoal(threadId));
      } catch {
        if (unarchived) {
          try { await connection.request('thread/archive', { threadId }); } catch {}
        }
        throw originalError;
      }
      rearchive = true;
    }
    try {
      if (!before) return { ok: true, action: 'already_clear', rearchived: rearchive };
      await connection.clearGoal(threadId);
      const after = goalFromResponse(await connection.getGoal(threadId));
      return after
        ? { ok: false, action: 'clear_not_acknowledged', goal: after, rearchived: rearchive }
        : { ok: true, action: 'cleared', previousStatus: before.status, rearchived: rearchive };
    } finally {
      if (rearchive) await connection.request('thread/archive', { threadId });
    }
  }

  async consumeRateLimitResetCredit(idempotencyKey) {
    const connection = await this.start();
    return connection.consumeRateLimitResetCredit(null, idempotencyKey);
  }

  async close() {
    const connection = this.connection;
    this.connection = null;
    if (connection) await connection.stop();
  }
}

module.exports = {
  NativeCodexSessionManager,
  PRESERVED_GOAL_STATUSES,
  epochSecondsToIso,
  goalFromResponse,
  normalizeRateLimitState,
};
