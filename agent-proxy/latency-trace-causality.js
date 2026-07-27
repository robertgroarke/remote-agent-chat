'use strict';

const crypto = require('crypto');

function nonEmptyString(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return null;
}

function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function contentSha256(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function messageRole(message) {
  return nonEmptyString(message?.role, message?.message?.role);
}

function messageContent(message) {
  if (typeof message?.append === 'string') return message.append;
  if (typeof message?.content === 'string') return message.content;
  if (typeof message?.message?.content === 'string') return message.message.content;
  return '';
}

function normalizeCursor(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const cursor = {
    generation: nonEmptyString(value.generation, value.file_generation),
    message_index: finiteNonNegative(value.message_index),
    start_offset: finiteNonNegative(value.start_offset),
    end_offset: finiteNonNegative(value.end_offset),
  };
  return Object.values(cursor).some(item => item !== null) ? cursor : null;
}

function nativeIdentity(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      native_session_id: null,
      native_turn_id: null,
      process_epoch: null,
      cursor: null,
    };
  }
  const nested = value.message && typeof value.message === 'object' ? value.message : {};
  const stream = value.stream_trace && typeof value.stream_trace === 'object'
    ? value.stream_trace
    : {};
  return {
    native_session_id: nonEmptyString(
      value.native_conversation_id,
      value.native_session_id,
      value.thread_id,
      nested.native_conversation_id,
      nested.native_session_id,
      nested.thread_id,
      stream.native_conversation_id,
      stream.native_session_id,
      stream.thread_id,
      value.session_id,
    ),
    native_turn_id: nonEmptyString(
      value.native_turn_id,
      value.turn_id,
      nested.native_turn_id,
      nested.turn_id,
      stream.native_turn_id,
      stream.turn_id,
    ),
    process_epoch: nonEmptyString(
      value.process_epoch,
      nested.process_epoch,
      stream.process_epoch,
    ),
    cursor: normalizeCursor(
      value.native_source_cursor
      || value.source_cursor
      || nested.native_source_cursor
      || nested.source_cursor
      || stream.native_source_cursor
      || stream.source_cursor,
    ),
  };
}

function identityHasStrongAnchor(identity) {
  return !!(
    identity?.native_turn_id
    || identity?.cursor
  );
}

function identityHasBindingScope(identity) {
  return !!(
    identityHasStrongAnchor(identity)
    || identity?.process_epoch
  );
}

function identityScopeMatches(left, right) {
  return !left?.native_session_id
    || !right?.native_session_id
    || left.native_session_id === right.native_session_id;
}

function strongIdentityMatches(binding, output) {
  if (!binding || !output || !identityScopeMatches(binding, output)) return false;
  if (binding.native_turn_id && output.native_turn_id) {
    return binding.native_turn_id === output.native_turn_id;
  }
  return false;
}

function cursorComparable(left, right) {
  if (!left || !right) return false;
  return !left.generation || !right.generation || left.generation === right.generation;
}

function cursorPosition(cursor) {
  if (!cursor) return null;
  if (cursor.message_index !== null) return { kind: 'message_index', value: cursor.message_index };
  if (cursor.start_offset !== null) return { kind: 'offset', value: cursor.start_offset };
  if (cursor.end_offset !== null) return { kind: 'offset', value: cursor.end_offset };
  return null;
}

function cursorIsAfter(output, user) {
  if (!cursorComparable(output, user)) return false;
  if (output.message_index !== null && user.message_index !== null) {
    return output.message_index > user.message_index;
  }
  const outputOffset = output.start_offset !== null
    ? output.start_offset
    : output.end_offset;
  const userOffset = user.end_offset !== null
    ? user.end_offset
    : user.start_offset;
  return outputOffset !== null && userOffset !== null && outputOffset > userOffset;
}

function bindingIdentity(entry) {
  const receipt = entry?.receiptIdentity;
  if (identityHasBindingScope(receipt)) return receipt;
  const user = entry?.nativeUser?.identity;
  return identityHasBindingScope(user) ? user : null;
}

function bindDeliveryReceipt(entry, receipt) {
  if (!entry || !receipt || typeof receipt !== 'object') return null;
  const identity = nativeIdentity(receipt);
  entry.nativeReceipt = receipt;
  entry.receiptIdentity = identity;
  return identityHasStrongAnchor(identity) ? identity : null;
}

function bindNativeUser(entries, message, sequence) {
  if (messageRole(message) !== 'user') return { ok: false, code: 'not_user' };
  const content = messageContent(message);
  if (!content) return { ok: false, code: 'user_content_missing' };
  const fingerprint = contentSha256(content);
  const candidates = entries.filter(entry => (
    entry?.delivered === true
    && !entry.nativeUser
    && entry.contentSha256 === fingerprint
  ));
  if (candidates.length !== 1) {
    return {
      ok: false,
      code: candidates.length === 0 ? 'user_trace_not_found' : 'user_trace_ambiguous',
      candidates: candidates.length,
    };
  }
  const selected = candidates[0];
  const identity = nativeIdentity(message);
  const observedSequence = finiteNonNegative(sequence);
  selected.nativeUser = {
    identity,
    observed_sequence: observedSequence,
    source_message_id: nonEmptyString(
      message?.source_message_id,
      message?.native_source_id,
      message?.message?.source_message_id,
      message?.message?.native_source_id,
    ),
    content_sha256: fingerprint,
  };

  for (const entry of entries) {
    if (entry === selected || !entry?.nativeUser || entry.completed === true) continue;
    const priorSequence = entry.nativeUser.observed_sequence;
    if (priorSequence !== null && observedSequence !== null && priorSequence < observedSequence) {
      entry.nativeUser.closed_at_sequence = observedSequence;
    }
    const priorIdentity = bindingIdentity(entry);
    const selectedIdentity = bindingIdentity(selected);
    const independentlyDisambiguated = (
      priorIdentity
      && selectedIdentity
      && (
        (priorIdentity.native_turn_id && selectedIdentity.native_turn_id
          && priorIdentity.native_turn_id !== selectedIdentity.native_turn_id)
        || (priorIdentity.process_epoch && selectedIdentity.process_epoch
          && priorIdentity.process_epoch !== selectedIdentity.process_epoch)
        || (priorIdentity.cursor && selectedIdentity.cursor
          && cursorComparable(priorIdentity.cursor, selectedIdentity.cursor))
      )
    );
    if (!independentlyDisambiguated) {
      entry.overlapAmbiguous = true;
      selected.overlapAmbiguous = true;
    }
  }
  return { ok: true, entry: selected };
}

function selectCausalEntry(entries, message, sequence) {
  if (messageRole(message) !== 'assistant' || !messageContent(message)) {
    return { ok: false, code: 'not_assistant_output' };
  }
  const candidates = entries.filter(entry => (
    entry?.delivered === true
    && entry.completed !== true
    && entry.firstOutputUnresolved !== true
  ));
  if (candidates.length === 0) return { ok: false, code: 'no_delivered_trace' };
  const outputIdentity = nativeIdentity(message);
  const strongMatches = candidates.filter(entry => (
    strongIdentityMatches(bindingIdentity(entry), outputIdentity)
  ));
  if (strongMatches.length === 1) {
    return { ok: true, entry: strongMatches[0], match: 'strong_identity' };
  }
  if (strongMatches.length > 1) {
    return { ok: false, code: 'strong_identity_ambiguous', candidates: strongMatches.length };
  }

  if (outputIdentity.cursor) {
    const cursorMatches = candidates.filter(entry => {
      const identity = entry.nativeUser?.identity || entry.receiptIdentity;
      const cursor = identity?.cursor;
      return cursor
        && identityScopeMatches(identity, outputIdentity)
        && cursorIsAfter(outputIdentity.cursor, cursor);
    });
    if (cursorMatches.length > 0) {
      cursorMatches.sort((left, right) => {
        const leftPosition = cursorPosition(
          left.nativeUser?.identity?.cursor || left.receiptIdentity?.cursor,
        );
        const rightPosition = cursorPosition(
          right.nativeUser?.identity?.cursor || right.receiptIdentity?.cursor,
        );
        if (!leftPosition || !rightPosition || leftPosition.kind !== rightPosition.kind) return 0;
        return rightPosition.value - leftPosition.value;
      });
      const best = cursorMatches[0];
      const bestPosition = cursorPosition(
        best.nativeUser?.identity?.cursor || best.receiptIdentity?.cursor,
      );
      const tied = cursorMatches.filter(entry => {
        const position = cursorPosition(
          entry.nativeUser?.identity?.cursor || entry.receiptIdentity?.cursor,
        );
        return position && bestPosition
          && position.kind === bestPosition.kind
          && position.value === bestPosition.value;
      });
      if (tied.length === 1) {
        return { ok: true, entry: best, match: 'source_cursor' };
      }
      return { ok: false, code: 'source_cursor_ambiguous', candidates: tied.length };
    }
  }

  const observedSequence = finiteNonNegative(sequence);
  const sequenceMatches = candidates.filter(entry => {
    const user = entry.nativeUser;
    if (!user || entry.overlapAmbiguous === true || observedSequence === null) return false;
    if (!identityScopeMatches(user.identity, outputIdentity)) return false;
    if (user.identity?.process_epoch && outputIdentity.process_epoch
        && user.identity.process_epoch !== outputIdentity.process_epoch) return false;
    if (user.identity?.native_turn_id && outputIdentity.native_turn_id
        && user.identity.native_turn_id !== outputIdentity.native_turn_id) return false;
    if (user.observed_sequence === null || observedSequence <= user.observed_sequence) return false;
    return user.closed_at_sequence === undefined || observedSequence < user.closed_at_sequence;
  });
  if (sequenceMatches.length === 1) {
    return { ok: true, entry: sequenceMatches[0], match: 'exclusive_native_user_window' };
  }
  return {
    ok: false,
    code: sequenceMatches.length > 1 ? 'native_user_window_ambiguous' : 'causal_identity_missing',
    candidates: sequenceMatches.length,
  };
}

function withHistoryCursor(message, index, generation = null) {
  const existing = nativeIdentity(message);
  if (existing.cursor) return message;
  return {
    ...message,
    source_cursor: {
      ...(generation ? { generation } : {}),
      message_index: index,
    },
  };
}

function canonicalAssistantForEntry(entry, messages, generation = null) {
  if (!entry || !Array.isArray(messages) || !entry.contentSha256) {
    return { ok: false, code: 'canonical_input_invalid' };
  }
  const matchingUsers = [];
  messages.forEach((message, index) => {
    if (messageRole(message) !== 'user') return;
    if (contentSha256(messageContent(message)) !== entry.contentSha256) return;
    matchingUsers.push({ message: withHistoryCursor(message, index, generation), index });
  });
  if (matchingUsers.length !== 1) {
    return {
      ok: false,
      code: matchingUsers.length === 0 ? 'canonical_user_not_found' : 'canonical_user_ambiguous',
      candidates: matchingUsers.length,
    };
  }
  const user = matchingUsers[0];
  const receiptIdentity = bindingIdentity(entry);
  const userIdentity = nativeIdentity(user.message);
  if (receiptIdentity?.native_turn_id && userIdentity.native_turn_id
      && receiptIdentity.native_turn_id !== userIdentity.native_turn_id) {
    return { ok: false, code: 'canonical_user_turn_mismatch' };
  }
  for (let index = user.index + 1; index < messages.length; index += 1) {
    const message = withHistoryCursor(messages[index], index, generation);
    const role = messageRole(message);
    if (role === 'user') return { ok: false, code: 'canonical_no_output_before_next_user' };
    if (role !== 'assistant' || !messageContent(message)) continue;
    const assistantIdentity = nativeIdentity(message);
    if (userIdentity.native_turn_id && assistantIdentity.native_turn_id
        && userIdentity.native_turn_id !== assistantIdentity.native_turn_id) {
      continue;
    }
    return {
      ok: true,
      user: user.message,
      assistant: message,
      user_index: user.index,
      assistant_index: index,
    };
  }
  return { ok: false, code: 'canonical_assistant_not_found' };
}

module.exports = {
  bindDeliveryReceipt,
  bindNativeUser,
  canonicalAssistantForEntry,
  contentSha256,
  identityHasStrongAnchor,
  messageContent,
  messageRole,
  nativeIdentity,
  normalizeCursor,
  selectCausalEntry,
  strongIdentityMatches,
};
