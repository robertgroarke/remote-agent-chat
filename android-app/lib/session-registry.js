// Normalized session inventory used by the Android relay client. Keep this
// contract in parity with frontend/session-registry.js.

import { isLowSignalChatTitle } from './session-title.js';

const UNSAFE_PATCH_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function sessionRegistryId(value) {
  return typeof value === 'string' ? value : (value?.session_id || value?.id || '');
}

export function sessionRegistryValueEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (left == null || right == null || typeof left !== typeof right) return false;
  if (typeof left !== 'object') return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) {
      if (!sessionRegistryValueEqual(left[index], right[index])) return false;
    }
    return true;
  }
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  for (const key of leftKeys) {
    if (!Object.prototype.hasOwnProperty.call(right, key)
      || !sessionRegistryValueEqual(left[key], right[key])) return false;
  }
  return true;
}

export function createSessionRegistry(items = []) {
  const list = [];
  const order = [];
  const byId = Object.create(null);
  const indexById = Object.create(null);
  for (const item of Array.isArray(items) ? items : []) {
    const id = sessionRegistryId(item);
    if (!id || Object.prototype.hasOwnProperty.call(byId, id)) continue;
    indexById[id] = list.length;
    order.push(id);
    byId[id] = item;
    list.push(item);
  }
  return { byId, indexById, order, list };
}

function titleResetRequested(value) {
  return value?.is_new_chat_draft === true || value?.is_list_view === true;
}

function preserveDurableSessionTitle(previousItem, incomingItem) {
  if (!previousItem || typeof previousItem !== 'object'
    || !incomingItem || typeof incomingItem !== 'object'
    || titleResetRequested(incomingItem)
    || isLowSignalChatTitle(previousItem.chat_title)
    || !isLowSignalChatTitle(incomingItem.chat_title)) {
    return incomingItem;
  }
  return {
    ...incomingItem,
    chat_title: previousItem.chat_title,
    chat_title_source: previousItem.chat_title_source || incomingItem.chat_title_source || null,
  };
}

export function reconcileSessionRegistry(previous, items) {
  const prior = previous?.byId ? previous : createSessionRegistry();
  const incoming = Array.isArray(items) ? items : [];
  const list = [];
  const order = [];
  const byId = Object.create(null);
  const indexById = Object.create(null);
  let changed = incoming.length !== prior.list.length;
  for (const item of incoming) {
    const id = sessionRegistryId(item);
    if (!id || Object.prototype.hasOwnProperty.call(byId, id)) continue;
    const previousItem = prior.byId[id];
    const protectedItem = preserveDurableSessionTitle(previousItem, item);
    const nextItem = previousItem !== undefined && sessionRegistryValueEqual(previousItem, protectedItem)
      ? previousItem
      : protectedItem;
    indexById[id] = list.length;
    order.push(id);
    byId[id] = nextItem;
    list.push(nextItem);
    if (!Object.is(nextItem, previousItem) || prior.order[list.length - 1] !== id) changed = true;
  }
  if (list.length !== incoming.length || list.length !== prior.list.length) changed = true;
  return changed ? { byId, indexById, order, list } : prior;
}

export function patchSessionRegistry(previous, message) {
  const prior = previous?.byId ? previous : createSessionRegistry();
  const id = message?.session_id || message?.session || '';
  if (!id || !Object.prototype.hasOwnProperty.call(prior.byId, id)) return prior;
  const current = prior.byId[id];
  const base = current && typeof current === 'object' ? current : { session_id: id };
  const patch = message?.patch && typeof message.patch === 'object' ? message.patch : {};
  const removedFields = Array.isArray(message?.removed_fields) ? message.removed_fields : [];
  const resetTitle = titleResetRequested(patch);
  const preserveTitle = !resetTitle
    && !isLowSignalChatTitle(base.chat_title)
    && (!Object.prototype.hasOwnProperty.call(patch, 'chat_title') || isLowSignalChatTitle(patch.chat_title));
  let next = base;
  for (const [key, value] of Object.entries(patch)) {
    if (UNSAFE_PATCH_KEYS.has(key) || key === 'session_id' || key === 'id') continue;
    if (preserveTitle && (key === 'chat_title' || key === 'chat_title_source')) continue;
    if (sessionRegistryValueEqual(next[key], value)) continue;
    if (next === base) next = { ...base };
    next[key] = value;
  }
  for (const key of removedFields) {
    if (typeof key !== 'string' || UNSAFE_PATCH_KEYS.has(key) || key === 'session_id' || key === 'id') continue;
    if (preserveTitle && (key === 'chat_title' || key === 'chat_title_source')) continue;
    if (!Object.prototype.hasOwnProperty.call(next, key)) continue;
    if (next === base) next = { ...base };
    delete next[key];
  }
  if (next === base) return prior;
  next.session_id = id;
  const index = prior.indexById[id];
  const list = prior.list.slice();
  list[index] = next;
  const byId = Object.assign(Object.create(null), prior.byId);
  byId[id] = next;
  return {
    byId,
    indexById: prior.indexById,
    order: prior.order,
    list,
  };
}
