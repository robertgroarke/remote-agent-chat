import { StyleSheet, useColorScheme } from 'react-native';
import { useMemo } from 'react';

const LIGHT_SURFACES = Object.freeze({
  '#010409': '#f6f8fa',
  '#0b0f14': '#f6f8fa',
  '#0d1117': '#ffffff',
  '#10161d': '#f6f8fa',
  '#11161d': '#ffffff',
  '#111820': '#ffffff',
  '#111a24': '#ffffff',
  '#111c17': '#ffffff',
  '#111f16': '#ffffff',
  '#121820': '#ffffff',
  '#131a23': '#f6f8fa',
  '#161b22': '#ffffff',
  '#181f29': '#f0f2f5',
  '#191320': '#ffffff',
  '#1a1a2e': '#f6f8fa',
  '#1c2128': '#f6f8fa',
  '#202124': '#f6f8fa',
  '#211b10': '#fff8c5',
  '#21262d': '#f0f2f5',
  '#251414': '#ffebe9',
  '#251c1d': '#ffebe9',
  '#283243': '#d0d7de',
  '#2d1518': '#ffebe9',
  '#2d1b00': '#fff8c5',
  '#2d210d': '#fff8c5',
  '#2f6f40': '#dafbe1',
  '#30363d': '#d0d7de',
  '#3a2a1d': '#fff8c5',
  '#3d1a1a': '#ffebe9',
  '#3d1f22': '#ffebe9',
  '#4a1e1c': '#ffebe9',
  '#4b1f22': '#ffebe9',
  '#4b2e0b': '#fff8c5',
  '#0d2138': '#ddf4ff',
  '#1b365d': '#ddf4ff',
  '#1f3b57': '#ddf4ff',
  '#1f3b5b': '#ddf4ff',
  '#123b2a': '#dafbe1',
});

const LIGHT_FOREGROUNDS = Object.freeze({
  '#444c56': '#6e7781',
  '#484f58': '#57606a',
  '#59636e': '#57606a',
  '#5f6368': '#57606a',
  '#6e6e6e': '#57606a',
  '#6e7681': '#57606a',
  '#6f7c8f': '#57606a',
  '#768390': '#57606a',
  '#7d8590': '#57606a',
  '#858585': '#57606a',
  '#888': '#57606a',
  '#8b949e': '#57606a',
  '#91a0b5': '#57606a',
  '#949494': '#57606a',
  '#9d9d9d': '#57606a',
  '#9da7b3': '#57606a',
  '#aaa': '#57606a',
  '#aaaaaa': '#57606a',
  '#afb8c1': '#424a53',
  '#b1bac4': '#424a53',
  '#b5b5b5': '#424a53',
  '#b7b7b7': '#424a53',
  '#c8c8c8': '#24292f',
  '#c9d1d9': '#24292f',
  '#cccccc': '#24292f',
  '#cdd9e5': '#24292f',
  '#d7dde5': '#24292f',
  '#d7dee7': '#24292f',
  '#ddd': '#24292f',
  '#e1e1e1': '#1f2328',
  '#e6edf3': '#1f2328',
  '#e7e7e7': '#1f2328',
  '#ededed': '#1f2328',
  '#eff1f3': '#1f2328',
  '#f0f3f6': '#1f2328',
  '#f0f6fc': '#1f2328',
  '#f2f2f2': '#1f2328',
  '#f2f3f5': '#1f2328',
  '#f3f3f3': '#1f2328',
  '#f4f4f4': '#1f2328',
  '#f5f5f5': '#1f2328',
  '#f6f8fa': '#1f2328',
  '#fafafa': '#1f2328',
  '#58a6ff': '#0969da',
  '#68b3ff': '#0969da',
  '#75beff': '#0969da',
  '#79c0ff': '#0969da',
  '#388bfd': '#0969da',
  '#f85149': '#cf222e',
  '#ff7b72': '#cf222e',
  '#ff8a80': '#cf222e',
  '#f0883e': '#bc4c00',
  '#d29922': '#9a6700',
  '#d9a441': '#9a6700',
  '#f2cc60': '#9a6700',
  '#3fb950': '#1a7f37',
  '#56d364': '#1a7f37',
  '#69c487': '#1a7f37',
});

const LIGHT_BORDERS = Object.freeze({
  ...LIGHT_SURFACES,
  '#444c56': '#afb8c1',
  '#484f58': '#afb8c1',
  '#58a6ff': '#0969da',
  '#68b3ff': '#0969da',
  '#f85149': '#cf222e',
  '#ff7b72': '#cf222e',
  '#f0883e': '#bc4c00',
  '#d29922': '#9a6700',
  '#3fb950': '#1a7f37',
});

const RGBA_LIGHT = Object.freeze({
  'rgba(0,0,0,0.5)': 'rgba(31,35,40,0.18)',
  'rgba(0,0,0,.55)': 'rgba(31,35,40,0.2)',
  'rgba(0,0,0,0.55)': 'rgba(31,35,40,0.2)',
  'rgba(0,0,0,0.6)': 'rgba(31,35,40,0.22)',
  'rgba(0,0,0,0.62)': 'rgba(31,35,40,0.24)',
  'rgba(0, 0, 0, 0.35)': 'rgba(31,35,40,0.14)',
  'rgba(22, 27, 34, 0.3)': 'rgba(255,255,255,0.72)',
  'rgba(22, 27, 34, 0.85)': 'rgba(255,255,255,0.94)',
});

function preserveAlpha(source, replacement) {
  if (!/^#[0-9a-f]{8}$/i.test(source) || !/^#[0-9a-f]{6}$/i.test(replacement)) {
    return replacement;
  }
  return `${replacement}${source.slice(7)}`;
}

export function mapThemeColor(value, property = 'color') {
  if (typeof value !== 'string') return value;
  const normalized = value.trim().toLowerCase();
  if (RGBA_LIGHT[normalized]) return RGBA_LIGHT[normalized];

  const base = /^#[0-9a-f]{8}$/i.test(normalized) ? normalized.slice(0, 7) : normalized;
  const map = property === 'backgroundColor'
    ? LIGHT_SURFACES
    : property === 'borderColor'
      ? LIGHT_BORDERS
      : LIGHT_FOREGROUNDS;
  const replacement = map[normalized] || map[base];
  return replacement ? preserveAlpha(normalized, replacement) : value;
}

export function lightStyleOverride(style) {
  const flat = StyleSheet.flatten(style);
  if (!flat || typeof flat !== 'object') return null;
  const override = {};
  for (const [property, value] of Object.entries(flat)) {
    if (property === 'color' || property.endsWith('Color')) {
      const mapped = mapThemeColor(value, property);
      if (mapped !== value) override[property] = mapped;
    }
  }
  return Object.keys(override).length > 0 ? override : null;
}

export function themedStyleSheet(styles, isLight) {
  if (!isLight) return styles;
  return Object.fromEntries(Object.entries(styles).map(([name, style]) => {
    const override = lightStyleOverride(style);
    return [name, override ? [style, override] : style];
  }));
}

export function useThemedStyles(styles) {
  const isLight = useColorScheme() === 'light';
  return useMemo(() => themedStyleSheet(styles, isLight), [styles, isLight]);
}

export function useAppTheme() {
  const isLight = useColorScheme() === 'light';
  return useMemo(() => ({
    isLight,
    navigation: {
      dark: !isLight,
      colors: {
        primary: isLight ? '#0969da' : '#58a6ff',
        background: isLight ? '#f6f8fa' : '#0b0f14',
        card: isLight ? '#ffffff' : '#0b0f14',
        text: isLight ? '#24292f' : '#cdd9e5',
        border: isLight ? '#d0d7de' : '#30363d',
        notification: isLight ? '#cf222e' : '#f85149',
      },
    },
    statusBar: isLight ? 'dark' : 'light',
    screen: isLight ? '#f6f8fa' : '#0b0f14',
    surface: isLight ? '#ffffff' : '#161b22',
    text: isLight ? '#24292f' : '#cdd9e5',
    muted: isLight ? '#57606a' : '#768390',
    border: isLight ? '#d0d7de' : '#30363d',
    accent: isLight ? '#0969da' : '#58a6ff',
    onAccent: '#0b0f14',
  }), [isLight]);
}
