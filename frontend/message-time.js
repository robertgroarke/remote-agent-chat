'use strict';

export function parseMessageInstant(value) {
  if (value == null || value === '') return null;
  let epochMs = null;
  if (typeof value === 'number' || (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim()))) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) epochMs = numeric > 1e12 ? numeric : numeric * 1000;
  } else {
    const parsed = Date.parse(String(value));
    if (Number.isFinite(parsed) && parsed > 0) epochMs = parsed;
  }
  if (!Number.isFinite(epochMs) || epochMs <= 0) return null;
  const date = new Date(epochMs);
  if (Number.isNaN(date.getTime())) return null;
  return {
    epoch_ms: date.getTime(),
    epoch_seconds: date.getTime() / 1000,
    iso: date.toISOString(),
  };
}

export function messageInstant(message) {
  if (!message || typeof message !== 'object') return null;
  return parseMessageInstant(message.created_at)
    || parseMessageInstant(message.timestamp)
    || parseMessageInstant(message.ts)
    || null;
}

export function normalizeMessageTimestamp(message) {
  if (!message || typeof message !== 'object') return message;
  const instant = messageInstant(message);
  if (!instant) return message;
  if (
    message.timestamp === instant.iso
    && message.timestamp_ms === instant.epoch_ms
    && Number(message.ts) === instant.epoch_seconds
  ) return message;
  return {
    ...message,
    ts: instant.epoch_seconds,
    timestamp: instant.iso,
    timestamp_ms: instant.epoch_ms,
  };
}

export function normalizeTranscriptTimestamps(messages) {
  if (!Array.isArray(messages)) return [];
  let changed = false;
  const normalized = messages.map(message => {
    const next = normalizeMessageTimestamp(message);
    if (next !== message) changed = true;
    return next;
  });
  return changed ? normalized : messages;
}

function calendarYear(date, timeZone) {
  return new Intl.DateTimeFormat('en-US-u-ca-gregory', {
    year: 'numeric',
    ...(timeZone ? { timeZone } : {}),
  }).format(date);
}

export function formatVisibleMessageTime(instant, now = new Date(), locale = undefined, timeZone = undefined) {
  const parsed = instant && typeof instant === 'object' && Number.isFinite(instant.epoch_ms)
    ? instant
    : parseMessageInstant(instant);
  if (!parsed) return '';
  const date = new Date(parsed.epoch_ms);
  const options = {
    ...(calendarYear(date, timeZone) === calendarYear(now, timeZone) ? {} : { year: 'numeric' }),
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    ...(timeZone ? { timeZone } : {}),
  };
  return new Intl.DateTimeFormat(locale, options).format(date);
}

export function formatAbsoluteMessageTime(instant, locale = undefined, timeZone = undefined) {
  const parsed = instant && typeof instant === 'object' && Number.isFinite(instant.epoch_ms)
    ? instant
    : parseMessageInstant(instant);
  if (!parsed) return '';
  const localized = new Intl.DateTimeFormat(locale, {
    dateStyle: 'full',
    timeStyle: 'long',
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(parsed.epoch_ms));
  return `${localized} (${parsed.iso})`;
}
