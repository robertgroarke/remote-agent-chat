'use strict';

const PROTECTED_CODEX_DESKTOP_CDP_PORTS = new Set([9223, 9225, 9240]);

function normalizedCapabilities(capabilities) {
  return capabilities && typeof capabilities === 'object' && !Array.isArray(capabilities)
    ? capabilities
    : {};
}

function codexDesktopThreadControlPolicy({
  agentType,
  capabilities,
  session,
} = {}) {
  const caps = normalizedCapabilities(capabilities);
  const isCodexDesktop = agentType === 'codex-desktop';
  const cdpPort = Number(session?.cdp_port ?? session?.cdpPort ?? 0);
  const protectedTarget = isCodexDesktop && (
    !Number.isInteger(cdpPort)
    || cdpPort <= 0
    || PROTECTED_CODEX_DESKTOP_CDP_PORTS.has(cdpPort)
  );
  const revalidationRestricted = isCodexDesktop && (
    caps.write_restricted_due_to_revalidation === true
    || caps.read_only_due_to_revalidation === true
    || !!caps.write_capability_gate
  );
  const nativeSwitchAdvertised = caps.switch_thread === true;
  const nativeSwitchEnabled = isCodexDesktop
    ? nativeSwitchAdvertised && !protectedTarget && !revalidationRestricted
    : nativeSwitchAdvertised;

  const reasons = [];
  if (protectedTarget) {
    reasons.push(Number.isInteger(cdpPort) && cdpPort > 0
      ? `protected Codex Desktop session on CDP ${cdpPort}`
      : 'Codex Desktop session ownership is not proven');
  }
  if (revalidationRestricted) {
    const exactGate = String(caps.write_capability_gate || '').trim();
    const version = String(caps.revalidation_version || '').trim();
    reasons.push(exactGate || (
      `Codex Desktop${version ? ` ${version}` : ''} has not passed full write revalidation`
    ));
  } else if (isCodexDesktop && !nativeSwitchAdvertised) {
    reasons.push('native thread switching is not advertised by this session');
  }

  return {
    threadListAvailable: caps.thread_list === true,
    localArchiveViewEnabled: isCodexDesktop && caps.thread_list === true,
    nativeSwitchAdvertised,
    nativeSwitchEnabled,
    protectedTarget,
    revalidationRestricted,
    selectionMode: nativeSwitchEnabled ? 'native' : 'client_local_readonly',
    reason: reasons.join('; '),
    notice: nativeSwitchEnabled
      ? 'Selecting a chat switches the owned Codex Desktop session.'
      : [
          'Selecting a non-active chat opens its read-only archive in RAC only.',
          'Codex Desktop stays on its native chat.',
          reasons.length ? `Native switching is disabled: ${reasons.join('; ')}.` : '',
        ].filter(Boolean).join(' '),
  };
}

module.exports = {
  PROTECTED_CODEX_DESKTOP_CDP_PORTS,
  codexDesktopThreadControlPolicy,
};
