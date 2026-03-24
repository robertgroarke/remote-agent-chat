import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, ActivityIndicator, RefreshControl, Image,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { RelayClient } from '../lib/relay';
import { getStoredJwt } from '../lib/auth';

export default function SkillsScreen({ route, navigation }) {
  const { sessionId } = route.params || {};
  const [skills, setSkills]     = useState(null); // { installed: [], recommended: [] }
  const [loading, setLoading]   = useState(true);
  const [connected, setConnected] = useState(false);
  const clientRef = useRef(null);

  const handleMessage = useCallback((msg) => {
    switch (msg.type) {
      case '_connected':
        setConnected(true);
        // Request skills once connected
        if (sessionId) {
          clientRef.current?.requestSkillList(sessionId);
          // Timeout: if no response in 8s, stop loading
          setTimeout(() => setLoading(prev => prev ? false : prev), 8000);
        }
        break;
      case '_disconnected':
        setConnected(false);
        break;
      case 'skill_list': {
        const sid = msg.session_id || msg.session;
        if (sid === sessionId || !sessionId) {
          setSkills({ installed: msg.installed || [], recommended: msg.recommended || [] });
          setLoading(false);
        }
        break;
      }
      case 'agent_control_result': {
        if (msg.command === 'skill_list') setLoading(false);
        break;
      }
      default:
        break;
    }
  }, [sessionId]);

  useFocusEffect(
    useCallback(() => {
      const client = new RelayClient(handleMessage);
      clientRef.current = client;
      client.connect();
      return () => {
        client.disconnect();
        clientRef.current = null;
      };
    }, [handleMessage])
  );

  function refresh() {
    setLoading(true);
    if (sessionId) clientRef.current?.requestSkillList(sessionId);
  }

  const installed   = skills?.installed   || [];
  const recommended = skills?.recommended || [];

  return (
    <ScrollView
      style={s.container}
      contentContainerStyle={s.content}
      refreshControl={
        <RefreshControl refreshing={loading && !!skills} onRefresh={refresh} tintColor="#58a6ff" />
      }
    >
      {!connected && (
        <View style={s.banner}>
          <Text style={s.bannerText}>Connecting to relay…</Text>
        </View>
      )}

      <Text style={s.title}>Skills</Text>
      <Text style={s.subtitle}>Give Codex superpowers.</Text>

      {loading && !skills && (
        <View style={s.loadingWrap}>
          <ActivityIndicator color="#58a6ff" size="large" />
          <Text style={s.loadingText}>Loading skills…</Text>
        </View>
      )}

      {!loading && installed.length === 0 && recommended.length === 0 && (
        <View style={s.emptyWrap}>
          <Text style={s.emptyIcon}>⚙</Text>
          <Text style={s.emptyText}>No skills found</Text>
          <Text style={s.emptySub}>Make sure Codex Desktop is running and connected.</Text>
        </View>
      )}

      {installed.length > 0 && (
        <View style={s.section}>
          <Text style={s.sectionTitle}>Installed</Text>
          {installed.map((skill, i) => (
            <View key={skill.id || i} style={s.card}>
              <View style={s.cardIcon}>
                {skill.icon ? (
                  <Image source={{ uri: skill.icon }} style={s.cardImg} />
                ) : (
                  <Text style={s.cardPlaceholder}>⚙</Text>
                )}
              </View>
              <View style={s.cardBody}>
                <Text style={s.cardName} numberOfLines={1}>{skill.name}</Text>
                {skill.description ? <Text style={s.cardDesc} numberOfLines={2}>{skill.description}</Text> : null}
              </View>
              <Text style={s.checkmark}>✓</Text>
            </View>
          ))}
        </View>
      )}

      {recommended.length > 0 && (
        <View style={s.section}>
          <Text style={s.sectionTitle}>Recommended</Text>
          {recommended.map((skill, i) => (
            <View key={skill.id || i} style={s.card}>
              <View style={s.cardIcon}>
                {skill.icon ? (
                  <Image source={{ uri: skill.icon }} style={s.cardImg} />
                ) : (
                  <Text style={s.cardPlaceholder}>⚙</Text>
                )}
              </View>
              <View style={s.cardBody}>
                <Text style={s.cardName} numberOfLines={1}>{skill.name}</Text>
                {skill.description ? <Text style={s.cardDesc} numberOfLines={2}>{skill.description}</Text> : null}
              </View>
              <View style={s.addBtn}>
                <Text style={s.addBtnText}>+</Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0b0f14',
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  banner: {
    backgroundColor: '#2d1b00',
    borderBottomWidth: 1,
    borderBottomColor: '#f0883e',
    paddingVertical: 8,
    alignItems: 'center',
    marginHorizontal: -20,
    marginTop: -20,
    marginBottom: 16,
  },
  bannerText: {
    color: '#f0883e',
    fontSize: 13,
  },
  title: {
    color: '#cdd9e5',
    fontSize: 24,
    fontWeight: '600',
    marginBottom: 4,
  },
  subtitle: {
    color: '#768390',
    fontSize: 14,
    marginBottom: 24,
  },
  loadingWrap: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  loadingText: {
    color: '#768390',
    fontSize: 14,
    marginTop: 12,
  },
  emptyWrap: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyIcon: {
    fontSize: 40,
    marginBottom: 12,
  },
  emptyText: {
    color: '#cdd9e5',
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 6,
  },
  emptySub: {
    color: '#768390',
    fontSize: 13,
    textAlign: 'center',
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    color: '#768390',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    marginBottom: 2,
    gap: 14,
  },
  cardIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#161b22',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  cardImg: {
    width: 40,
    height: 40,
    borderRadius: 10,
  },
  cardPlaceholder: {
    fontSize: 18,
    color: '#768390',
  },
  cardBody: {
    flex: 1,
  },
  cardName: {
    color: '#cdd9e5',
    fontSize: 14,
    fontWeight: '500',
  },
  cardDesc: {
    color: '#768390',
    fontSize: 12,
    marginTop: 2,
  },
  checkmark: {
    color: '#3fb950',
    fontSize: 16,
    fontWeight: '600',
  },
  addBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#30363d',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnText: {
    color: '#768390',
    fontSize: 16,
  },
});
