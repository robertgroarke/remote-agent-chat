import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, ActivityIndicator,
  StyleSheet,
} from 'react-native';
import {
  signInWithGoogle, statusCodes,
  signInWithCustomTab, storeJwtDirectly,
} from '../lib/auth';

export default function LoginScreen({ navigation, route }) {
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  // Handle deep-link JWT from "Link App" button in web UI (agentchat://auth?jwt=...)
  useEffect(() => {
    const jwt = route?.params?.jwt;
    if (!jwt) return;
    setLoading(true);
    storeJwtDirectly(jwt)
      .then(() => navigation.replace('SessionList'))
      .catch(err => { setError(err.message || 'Link failed'); setLoading(false); });
  }, [route?.params?.jwt]);

  // Primary: native Google Sign-In
  async function handleSignIn() {
    setError(null);
    setLoading(true);
    try {
      await signInWithGoogle();
      navigation.replace('SessionList');
    } catch (err) {
      if (err.code === statusCodes.SIGN_IN_CANCELLED) {
        // User cancelled — not an error
      } else if (err.code === statusCodes.IN_PROGRESS) {
        setError('Sign-in already in progress');
      } else if (err.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        setError('Google Play Services not available');
      } else {
        setError(err.message || 'Sign-in failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  // Fallback: Chrome Custom Tab flow (for users who prefer web flow)
  async function handleFallbackSignIn() {
    setError(null);
    setLoading(true);
    try {
      await signInWithCustomTab();
      navigation.replace('SessionList');
    } catch (err) {
      setError(err.message || 'Sign-in failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={s.container}>
      <View style={s.card}>
        <Text style={s.title}>Agent Chat</Text>
        <Text style={s.subtitle}>Remote access to your AI coding agents</Text>

        {error && (
          <View style={s.errorBox}>
            <Text style={s.errorText}>{error}</Text>
          </View>
        )}

        <TouchableOpacity
          style={[s.button, loading && s.buttonDisabled]}
          onPress={handleSignIn}
          disabled={loading}
          activeOpacity={0.8}
        >
          {loading ? (
            <ActivityIndicator color="#0b0f14" size="small" />
          ) : (
            <Text style={s.buttonText}>Sign in with Google</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={s.fallbackLink}
          onPress={handleFallbackSignIn}
          disabled={loading}
        >
          <Text style={s.fallbackText}>Sign in via browser instead</Text>
        </TouchableOpacity>

        <Text style={s.hint}>
          Uses the same Google account as the web dashboard.
        </Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex:            1,
    backgroundColor: '#0b0f14',
    justifyContent:  'center',
    alignItems:      'center',
    padding:         24,
  },
  card: {
    width:           '100%',
    maxWidth:        360,
    backgroundColor: '#161b22',
    borderRadius:    12,
    padding:         32,
    alignItems:      'center',
    borderWidth:     1,
    borderColor:     '#30363d',
  },
  title: {
    fontSize:   28,
    fontWeight: '700',
    color:      '#cdd9e5',
    marginBottom: 8,
  },
  subtitle: {
    fontSize:     14,
    color:        '#768390',
    textAlign:    'center',
    marginBottom: 32,
  },
  errorBox: {
    backgroundColor: '#3d1a1a',
    borderColor:     '#f85149',
    borderWidth:     1,
    borderRadius:    8,
    padding:         12,
    marginBottom:    16,
    width:           '100%',
  },
  errorText: {
    color:    '#f85149',
    fontSize: 13,
  },
  button: {
    backgroundColor: '#58a6ff',
    borderRadius:    8,
    paddingVertical: 14,
    paddingHorizontal: 32,
    width:           '100%',
    alignItems:      'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color:      '#0b0f14',
    fontWeight: '700',
    fontSize:   15,
  },
  fallbackLink: {
    marginTop: 16,
    padding:   8,
  },
  fallbackText: {
    color:    '#58a6ff',
    fontSize: 13,
  },
  hint: {
    marginTop: 20,
    fontSize:  12,
    color:     '#444c56',
    textAlign: 'center',
  },
});
