import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View, useColorScheme } from 'react-native';

const PROVIDER_MARK_ASSETS = Object.freeze({
  'openai-codex': Object.freeze({
    accessibleName: 'OpenAI',
    light: require('../assets/providers/openai-light.png'),
    dark: require('../assets/providers/openai-dark.png'),
  }),
  'anthropic-claude': Object.freeze({
    accessibleName: 'Anthropic Claude',
    light: require('../assets/providers/claude-color.png'),
    dark: require('../assets/providers/claude-color.png'),
  }),
  cursor: Object.freeze({
    accessibleName: 'Cursor',
    light: require('../assets/providers/cursor-light.png'),
    dark: require('../assets/providers/cursor-dark.png'),
  }),
  'google-antigravity': Object.freeze({
    accessibleName: 'Google Antigravity',
    light: require('../assets/providers/antigravity-color.png'),
    dark: require('../assets/providers/antigravity-color.png'),
  }),
  'ollama-local': Object.freeze({
    accessibleName: 'Ollama',
    light: require('../assets/providers/ollama-light.png'),
    dark: require('../assets/providers/ollama-light.png'),
    darkTint: '#ffffff',
  }),
});

export function resolveProviderMark(providerId, colorScheme = 'dark') {
  const mark = PROVIDER_MARK_ASSETS[String(providerId || '')];
  if (!mark) return null;
  const scheme = colorScheme === 'light' ? 'light' : 'dark';
  return {
    accessibleName: mark.accessibleName,
    source: mark[scheme],
    tintColor: scheme === 'dark' ? mark.darkTint || null : null,
  };
}

export default function ProviderMark({ providerId, providerName, colorScheme = null }) {
  const systemColorScheme = useColorScheme();
  const scheme = colorScheme === 'light' || colorScheme === 'dark'
    ? colorScheme
    : systemColorScheme === 'light' ? 'light' : 'dark';
  const mark = resolveProviderMark(providerId, scheme);
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [providerId, scheme]);

  const accessibleName = mark?.accessibleName || String(providerName || 'Unknown provider');
  return (
    <View
      style={[s.tile, scheme === 'light' ? s.tileLight : s.tileDark]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${accessibleName} provider mark${failed || !mark ? ' unavailable' : ''}`}
    >
      {mark && !failed ? (
        <Image
          source={mark.source}
          resizeMode="contain"
          style={[s.image, mark.tintColor ? { tintColor: mark.tintColor } : null]}
          accessible={false}
          onError={() => setFailed(true)}
        />
      ) : (
        <Text style={[s.fallback, scheme === 'light' ? s.fallbackLight : s.fallbackDark]} numberOfLines={3} accessible={false}>
          {accessibleName}
        </Text>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  tile: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    padding: 4,
  },
  tileDark: { backgroundColor: '#0d1117', borderColor: '#30363d' },
  tileLight: { backgroundColor: '#ffffff', borderColor: '#d0d7de' },
  image: { width: 24, height: 24 },
  fallback: { fontSize: 7, lineHeight: 8, fontWeight: '700', textAlign: 'center' },
  fallbackDark: { color: '#f0f6fc' },
  fallbackLight: { color: '#24292f' },
});
