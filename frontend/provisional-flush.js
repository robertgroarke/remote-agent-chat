'use strict';

export function mergeProvisionalFlushItem(previous, next) {
  const prior = previous && typeof previous === 'object' ? previous : {};
  const candidate = next && typeof next === 'object' ? next : {};
  const hasStreamTrace = candidate.streamTrace != null;
  const hasLatencyTrace = candidate.latencyTrace != null;

  return {
    stream: candidate.stream ?? prior.stream ?? null,
    streamTrace: hasStreamTrace ? candidate.streamTrace : (prior.streamTrace ?? null),
    latencyTrace: hasLatencyTrace ? candidate.latencyTrace : (prior.latencyTrace ?? null),
    receivedAtMs: hasLatencyTrace
      ? (candidate.receivedAtMs ?? null)
      : (prior.latencyTrace != null ? (prior.receivedAtMs ?? null) : null),
  };
}
