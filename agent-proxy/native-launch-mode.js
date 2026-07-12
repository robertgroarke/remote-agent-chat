'use strict';

function normalizeNativeLaunchMode(value, fallback = 'foreground') {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'background' || normalized === 'foreground') return normalized;
  return fallback === 'background' ? 'background' : 'foreground';
}

function backgroundNativeLaunchResult(agentType) {
  return {
    pid: null,
    agentType: String(agentType || 'cli'),
    backgroundMode: true,
    nativeCliWindowOpened: false,
  };
}

function nativeLaunchState(result) {
  const background = result?.backgroundMode === true;
  return {
    mode: background ? 'background' : 'foreground',
    status: background ? 'background_ready' : 'native_window_opened',
    windowOpened: !background,
  };
}

module.exports = {
  normalizeNativeLaunchMode,
  backgroundNativeLaunchResult,
  nativeLaunchState,
};
