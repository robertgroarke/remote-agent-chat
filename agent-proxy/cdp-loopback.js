'use strict';

const CODEX_DESKTOP_CDP_PORT = 9225;

function normalizeHost(value) {
  const host = String(value || '').trim();
  return host || null;
}

function requireLoopbackHost(value) {
  const host = normalizeHost(value);
  if (!host) return null;
  if (host !== '127.0.0.1' && host !== '::1') {
    throw new Error(`CDP host must be an explicit loopback address, received ${host}`);
  }
  return host;
}

function hostCandidatesForPort(port, explicitHost = null, env = process.env) {
  const requested = requireLoopbackHost(explicitHost);
  if (requested) return [requested];

  if (Number(port) === CODEX_DESKTOP_CDP_PORT) {
    const configured = requireLoopbackHost(env.CODEX_DESKTOP_CDP_HOST);
    if (configured) return [configured];
    // Codex Desktop 26.707.8479.0 binds its debugger to IPv6 loopback on
    // Windows. Older builds used IPv4. Probe both without widening beyond the
    // local machine or requiring an app restart.
    return ['::1', '127.0.0.1'];
  }

  // Preserve chrome-remote-interface's existing default for every other app.
  return [null];
}

function optionsForHost(options, host) {
  if (!host) return { ...options };
  return { ...options, host };
}

function aggregateError(action, port, attempts) {
  const detail = attempts
    .map(({ host, error }) => `${host || 'default'}: ${error.message || error}`)
    .join(' | ');
  const error = new Error(`${action} failed on port ${port} (${detail})`);
  error.code = attempts[attempts.length - 1]?.error?.code;
  error.attempts = attempts.map(({ host, error: cause }) => ({
    host: host || null,
    code: cause?.code || null,
    message: cause?.message || String(cause),
  }));
  return error;
}

async function listCdpTargets(CDP, options) {
  const port = Number(options?.port);
  const attempts = [];
  for (const host of hostCandidatesForPort(port, options?.host)) {
    try {
      const targets = await CDP.List(optionsForHost(options, host));
      return targets.map(target => ({ ...target, _cdpHost: host || null }));
    } catch (error) {
      attempts.push({ host, error });
    }
  }
  throw aggregateError('CDP target listing', port, attempts);
}

async function connectCdpTarget(CDP, options) {
  const port = Number(options?.port);
  const attempts = [];
  for (const host of hostCandidatesForPort(port, options?.host)) {
    try {
      return await CDP(optionsForHost(options, host));
    } catch (error) {
      attempts.push({ host, error });
    }
  }
  throw aggregateError('CDP target connection', port, attempts);
}

module.exports = {
  CODEX_DESKTOP_CDP_PORT,
  hostCandidatesForPort,
  listCdpTargets,
  connectCdpTarget,
};
