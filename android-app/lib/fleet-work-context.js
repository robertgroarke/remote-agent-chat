'use strict';

const CODEX_GOAL_AGENT_TYPES = new Set(['codex', 'codex_cli', 'codex-desktop']);
const ACTIVE_ACTIVITY_KINDS = new Set([
  'thinking', 'generating', 'reading_files', 'running_command', 'applying_patch', 'working',
]);
const ACTIVE_TASK_STATES = new Set(['active', 'in_progress', 'in-progress', 'working', 'running']);
const PENDING_TASK_STATES = new Set(['pending', 'queued', 'todo', 'not_started', 'not-started']);
const COMPLETE_TASK_STATES = new Set(['completed', 'complete', 'done', 'passed', 'success', 'succeeded']);
const TERMINAL_TASK_STATES = new Set([...COMPLETE_TASK_STATES, 'cancelled', 'canceled', 'failed', 'skipped']);
const GENERIC_ACTIVITY_LABELS = new Set([
  '', 'active', 'idle', 'ready', 'thinking', 'generating', 'working', 'busy', 'connected',
]);
const MAX_CONTEXT_TEXT = 240;
const MAX_CONTEXT_LABEL = 32;
const MAX_CONTEXT_SOURCE = 48;
const DURATION_ONLY_RE = /^(?=.*\d)(?:(?:\d+)\s*d\s*)?(?:(?:\d+)\s*h\s*)?(?:(?:\d+)\s*m\s*)?(?:(?:\d+)\s*s)?$/i;
const DURATION_LIKE_RE = /^[+-]?\d+\s*[dhms]\b/i;
const AGE_ONLY_RE = /^(?:just now|today|yesterday|(?:\d+|an?|one)\s+(?:seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?)\s+ago)$/i;
const GOAL_STATUS_ONLY_RE = /^(?:pursuing goal|paused goal|goal (?:paused|blocked|usage limited|rate limited|limited|budget limited|achieved|cancelled|canceled|stopped|failed)|idle|ready|connected|awaiting live update)$/i;
const PLACEHOLDER_ONLY_RE = /^(?:no (?:recent message|current work|data|activity)(?: reported)?|unavailable|unknown|not available)$/i;
const SURFACE_LABEL_ONLY_RE = /^(?:remote agent chat|(?:antigravity|claude(?: code)?|cline|codex|continue|cursor|gemini|roo code)\s+(?:harness|workspace))$/i;
const GOAL_STATE_ALIASES = Object.freeze({
  active: 'active',
  running: 'active',
  working: 'active',
  pursuing: 'active',
  pursuing_goal: 'active',
  paused: 'paused',
  pause: 'paused',
  paused_goal: 'paused',
  blocked: 'blocked',
  goal_blocked: 'blocked',
  needs_attention: 'blocked',
  waiting_for_user: 'blocked',
  usagelimited: 'usageLimited',
  usage_limited: 'usageLimited',
  goal_usage_limited: 'usageLimited',
  rate_limited: 'usageLimited',
  goal_rate_limited: 'usageLimited',
  budgetlimited: 'budgetLimited',
  budget_limited: 'budgetLimited',
  goal_limited: 'budgetLimited',
  goal_budget_limited: 'budgetLimited',
  complete: 'complete',
  completed: 'complete',
  achieved: 'complete',
  goal_achieved: 'complete',
  cancelled: 'cancelled',
  canceled: 'cancelled',
  stopped: 'cancelled',
  goal_cancelled: 'cancelled',
  goal_canceled: 'cancelled',
  goal_stopped: 'cancelled',
  failed: 'failed',
  failure: 'failed',
  goal_failed: 'failed',
});

function normalizedAgentType(value) {
  return String(value || '').trim().toLowerCase();
}

function goalLifecycleSupported(agentType, capabilities) {
  if (capabilities && typeof capabilities.goal_lifecycle === 'boolean') {
    return capabilities.goal_lifecycle;
  }
  return CODEX_GOAL_AGENT_TYPES.has(normalizedAgentType(agentType));
}

function timestampMs(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function firstTimestamp(...values) {
  for (const value of values) {
    const parsed = timestampMs(value);
    if (parsed) return new Date(parsed).toISOString();
  }
  return null;
}

function containsCredentialShape(value) {
  return /(?:\bbearer\s+[a-z0-9._~+/=-]{8,}|\b(?:api[_ -]?key|password|passwd|secret|access[_ -]?token|refresh[_ -]?token)\s*[:=]\s*\S+|\bsk-[a-z0-9_-]{8,})/i.test(value);
}

function rejectedDisplayTextReason(value) {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  if (!text) return 'empty';
  if (DURATION_ONLY_RE.test(text)) return 'duration_only';
  if (DURATION_LIKE_RE.test(text)) return 'duration_malformed';
  if (AGE_ONLY_RE.test(text)) return 'age_only';
  if (GOAL_STATUS_ONLY_RE.test(text)) return 'status_only';
  if (PLACEHOLDER_ONLY_RE.test(text)) return 'placeholder_only';
  if (SURFACE_LABEL_ONLY_RE.test(text)) return 'surface_label_only';
  return '';
}

function boundedDisplayText(value, maximum = MAX_CONTEXT_TEXT) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  let text = String(value)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text || containsCredentialShape(text)) return '';
  if (rejectedDisplayTextReason(text)) return '';
  if (/^[{[]\s*["']?[\w.-]+["']?\s*:/.test(text)) return '';
  if (/^(?:powershell|pwsh|cmd(?:\.exe)?|bash|sh|zsh|fish)\s+-/i.test(text)) return '';
  text = text.replace(/^(?:[-*•]\s+|#{1,6}\s+)/, '').trim();
  return text.slice(0, maximum).trim();
}

function normalizeGoalState(value) {
  const compact = String(value || '')
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!compact) return 'unknown';
  return GOAL_STATE_ALIASES[compact] || GOAL_STATE_ALIASES[compact.replace(/_/g, '')] || 'unknown';
}

function coherentGoalState(goal) {
  for (const candidate of [goal?.state, goal?.status, goal?.raw_state, goal?.native_state]) {
    const state = normalizeGoalState(candidate);
    if (state !== 'unknown') return state;
  }
  return 'unknown';
}

function taskState(task) {
  return String(task?.state || task?.status || '').trim().toLowerCase();
}

function taskText(task) {
  return boundedDisplayText(
    task?.subject || task?.text || task?.content || task?.description || task?.label,
  );
}

function normalizeProgress(completed, total) {
  const normalizedTotal = Number(total);
  const normalizedCompleted = Number(completed);
  if (!Number.isInteger(normalizedTotal) || normalizedTotal <= 0) return null;
  if (!Number.isInteger(normalizedCompleted) || normalizedCompleted < 0) return null;
  return {
    completed: Math.min(normalizedCompleted, normalizedTotal),
    total: normalizedTotal,
  };
}

function explicitGoalProgress(goal) {
  const value = Number(goal?.progress_percent ?? goal?.percent_complete ?? goal?.percent ?? goal?.progress);
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, value <= 1 ? value * 100 : value));
}

function normalizeFleetWorkContext(value, options = {}) {
  if (!value || typeof value !== 'object') return null;
  const kind = String(value.kind || '').trim().toLowerCase().replace(/[^a-z_]/g, '').slice(0, 24);
  if (!kind || (kind === 'goal' && options.goalCapable === false)) return null;
  const label = boundedDisplayText(value.label, MAX_CONTEXT_LABEL);
  const text = boundedDisplayText(value.text);
  const source = boundedDisplayText(value.source, MAX_CONTEXT_SOURCE).replace(/\s+/g, '_').toLowerCase();
  if (!label || !text || !source) return null;
  const goalState = kind === 'goal' ? coherentGoalState(value) : 'unknown';
  if (kind === 'goal' && goalState === 'unknown') return null;
  const progress = normalizeProgress(value.completed, value.total);
  const percent = Number(value.percent);
  return {
    kind,
    label,
    text,
    source,
    updated_at: firstTimestamp(value.updated_at) || null,
    ...(progress || {}),
    ...(Number.isFinite(percent) ? { percent: Math.max(0, Math.min(100, percent)) } : {}),
    ...(kind === 'goal' ? { state: goalState } : (value.state ? { state: boundedDisplayText(value.state, 32).toLowerCase() } : {})),
    ...(value.diagnostic_reason ? { diagnostic_reason: String(value.diagnostic_reason).slice(0, 64) } : {}),
  };
}

function latestUserRequestFromMessages(messages) {
  const rows = Array.isArray(messages) ? messages : [];
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const message = rows[index];
    if (String(message?.role || '').toLowerCase() !== 'user') continue;
    const text = boundedDisplayText(message?.content || message?.text);
    if (!text) continue;
    return {
      text,
      updated_at: firstTimestamp(
        message?.timestamp,
        message?.created_at,
        message?.ts,
        message?.server_ts,
      ),
    };
  }
  return null;
}

function planLabel(agentType, taskCount) {
  const type = normalizedAgentType(agentType);
  if (type === 'claude' || type === 'claude_cli' || type === 'claude-desktop') {
    return taskCount > 1 ? 'Tasks' : 'Task';
  }
  if (['antigravity', 'antigravity_panel', 'antigravity-v2', 'gemini', 'continue', 'continue_yolo', 'roo_code', 'cline'].includes(type)) {
    return 'Task';
  }
  return taskCount > 1 ? 'Tasks' : 'Plan';
}

function structuredTaskCandidate(agentType, activity) {
  const taskList = activity?.task_list;
  const tasks = Array.isArray(taskList?.tasks) ? taskList.tasks : [];
  const useful = tasks.filter(task => taskText(task));
  if (useful.length > 0) {
    const active = useful.find(task => ACTIVE_TASK_STATES.has(taskState(task)));
    const pending = useful.find(task => PENDING_TASK_STATES.has(taskState(task)));
    const selected = active || pending;
    if (selected) {
      const explicitTotal = Number(taskList.total);
      const total = Number.isInteger(explicitTotal) && explicitTotal > 0 ? explicitTotal : tasks.length;
      const explicitCompleted = Number(taskList.completed);
      const completed = Number.isInteger(explicitCompleted) && explicitCompleted >= 0
        ? explicitCompleted
        : tasks.filter(task => COMPLETE_TASK_STATES.has(taskState(task))).length;
      return {
        kind: 'plan',
        label: planLabel(agentType, total),
        text: taskText(selected),
        source: 'task_list',
        updated_at: firstTimestamp(selected.updated_at, selected.updatedAt, taskList.updated_at, activity.updated_at),
        ...normalizeProgress(completed, total),
      };
    }
  }

  const step = activity?.step;
  const stepState = taskState(step);
  const stepValue = typeof step === 'object'
    ? (step?.text || step?.content || step?.description || step?.label || step?.name)
    : step;
  const text = boundedDisplayText(stepValue);
  if (text && !TERMINAL_TASK_STATES.has(stepState)) {
    return {
      kind: 'plan',
      label: planLabel(agentType, 1),
      text,
      source: 'step',
      updated_at: firstTimestamp(step?.updated_at, step?.updatedAt, activity.updated_at),
    };
  }
  return null;
}

function currentCandidate(activity) {
  const current = activity?.current;
  if (!current || typeof current !== 'object') return null;
  const text = boundedDisplayText(current.label || current.title || current.name);
  if (!text) return null;
  const kind = String(current.kind || '').trim().toLowerCase();
  const responseLike = ['response', 'thinking', 'generating', 'message'].includes(kind);
  return {
    kind: responseLike ? 'response' : 'activity',
    label: responseLike ? 'Current response' : 'Current activity',
    text,
    source: kind ? `current_${kind}` : 'current',
    updated_at: firstTimestamp(current.updated_at, current.since, activity.updated_at),
  };
}

function contextCardCandidate(agentType, activity) {
  const card = activity?.context_card;
  if (!card || typeof card !== 'object') return null;
  const text = boundedDisplayText(card.task || card.title || card.mode || card.label || card.text);
  if (!text) return null;
  return {
    kind: 'task',
    label: planLabel(agentType, 1),
    text,
    source: 'context_card',
    updated_at: firstTimestamp(card.updated_at, activity.updated_at),
  };
}

function requestCandidate(latestUserRequest) {
  const value = typeof latestUserRequest === 'string'
    ? { text: latestUserRequest }
    : latestUserRequest;
  const text = boundedDisplayText(value?.text || value?.content);
  if (!text) return null;
  return {
    kind: 'request',
    label: 'Request',
    text,
    source: 'latest_user_request',
    updated_at: firstTimestamp(value?.updated_at, value?.timestamp, value?.created_at),
  };
}

function activityCandidate(activity) {
  const label = boundedDisplayText(activity?.label, 160);
  if (!label || GENERIC_ACTIVITY_LABELS.has(label.toLowerCase())) return null;
  return {
    kind: 'activity',
    label: 'Current activity',
    text: label,
    source: 'activity_label',
    updated_at: firstTimestamp(activity?.updated_at, activity?.started_at, activity?.since),
  };
}

function goalCandidate(activity, goalCapable) {
  if (!goalCapable || !activity?.goal || typeof activity.goal !== 'object') return null;
  const goal = activity.goal;
  const text = boundedDisplayText(goal.objective || goal.text);
  if (!text) return null;
  const state = coherentGoalState(goal);
  if (state === 'unknown') return null;
  const progress = normalizeProgress(goal.completed, goal.total);
  const percent = explicitGoalProgress(goal);
  return {
    kind: 'goal',
    label: 'Goal',
    text,
    source: 'goal',
    updated_at: firstTimestamp(goal.updated_at, goal.observed_at, activity.updated_at),
    ...(progress || {}),
    ...(percent == null ? {} : { percent }),
    state,
  };
}

function newerCandidate(first, second) {
  if (!first) return second;
  if (!second) return first;
  const firstMs = timestampMs(first.updated_at);
  const secondMs = timestampMs(second.updated_at);
  return secondMs > firstMs && firstMs > 0 ? second : first;
}

function projectFleetWorkContext(options = {}) {
  const activity = options.activity && typeof options.activity === 'object' ? options.activity : {};
  const goalCapable = goalLifecycleSupported(options.agentType, options.capabilities);
  if (options.preferProvided !== false) {
    const provided = normalizeFleetWorkContext(activity.work_context, { goalCapable });
    if (provided) return provided;
  }

  const goal = goalCandidate(activity, goalCapable);
  if (goal) return normalizeFleetWorkContext(goal, { goalCapable });

  const plan = structuredTaskCandidate(options.agentType, activity);
  const current = currentCandidate(activity);
  const contextCard = contextCardCandidate(options.agentType, activity);
  const request = requestCandidate(options.latestUserRequest);
  const activityFallback = activityCandidate(activity);
  const active = ACTIVE_ACTIVITY_KINDS.has(String(activity.kind || '').toLowerCase());
  let selected = plan || contextCard;
  if (active && current) selected = newerCandidate(selected, current);
  if (!selected) selected = current || contextCard || request || activityFallback;
  if (!selected && request) selected = request;
  if (!selected) {
    selected = {
      kind: 'empty',
      label: 'Current work',
      text: 'Current work unavailable',
      source: 'none',
      updated_at: firstTimestamp(activity.updated_at),
      diagnostic_reason: 'no_authoritative_work_context',
    };
  }
  return normalizeFleetWorkContext(selected, { goalCapable });
}

module.exports = {
  CODEX_GOAL_AGENT_TYPES,
  MAX_CONTEXT_TEXT,
  boundedDisplayText,
  coherentGoalState,
  goalLifecycleSupported,
  latestUserRequestFromMessages,
  normalizeFleetWorkContext,
  normalizeGoalState,
  projectFleetWorkContext,
  rejectedDisplayTextReason,
  timestampMs,
};
