export const GOAL_CONTROL_SLASH_COMMANDS = Object.freeze([
  { command: '/goal resume', action: 'resume', detail: 'Resume the current Codex goal through native goal control.' },
  { command: '/goal pause', action: 'pause', detail: 'Pause the current Codex goal through native goal control.' },
]);

export function classifyGoalCommandIntent(rawText, options = {}) {
  const text = typeof rawText === 'string' ? rawText : '';
  const trimmed = text.trim();
  const attachmentCount = Math.max(0, Number(options.attachmentCount) || 0);
  if (!trimmed || attachmentCount > 0 || /[\r\n]/.test(trimmed)) {
    return { kind: 'chat', text: trimmed };
  }
  const normalized = trimmed.toLowerCase();
  const supported = GOAL_CONTROL_SLASH_COMMANDS.find(item => item.command === normalized);
  if (supported) {
    return {
      kind: 'goal_control',
      action: supported.action,
      command: supported.command,
      text: trimmed,
    };
  }
  if (/^\/goal(?:\s|$)/i.test(trimmed)) {
    return { kind: 'unsupported_goal_control', command: trimmed, text: trimmed };
  }
  return { kind: 'chat', text: trimmed };
}

export function satisfiedGoalCommandLabel(action, goalState) {
  const state = String(goalState || '').trim().toLowerCase();
  if (action === 'resume' && state === 'active') return 'Already active';
  if (action === 'pause' && state === 'paused') return 'Already paused';
  return '';
}
