import React, { useEffect, useState } from 'react';
import {
  View, Text, Modal, TouchableOpacity, TouchableWithoutFeedback,
  ScrollView, StyleSheet, ActivityIndicator,
} from 'react-native';
import { RELAY_URL, getStoredJwt } from '../lib/auth';

// ── SessionHistorySheet ─────────────────────────────────────────────────────
// Bottom sheet showing past conversation history with resume capability.
// Fetches from GET /api/sessions/history and lets user pick a session to resume.

export default function SessionHistorySheet({ visible, onResume, onClose }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const jwt = await getStoredJwt();
        const res = await fetch(`${RELAY_URL}/api/sessions/history?limit=30`, {
          headers: { Authorization: `Bearer ${jwt}` },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setSessions(data.sessions || []);
      } catch (e) {
        setError(e.message);
        setSessions([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [visible]);

  function timeAgo(isoStr) {
    if (!isoStr) return '';
    const diff = Date.now() - new Date(isoStr).getTime();
    const mins  = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={s.backdrop} />
      </TouchableWithoutFeedback>

      <View style={s.sheet}>
        <View style={s.header}>
          <Text style={s.title}>Resume Session</Text>
          <TouchableOpacity onPress={onClose} style={s.closeBtn} activeOpacity={0.7}>
            <Text style={s.closeBtnText}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={s.body} contentContainerStyle={s.bodyContent}>
          {loading && (
            <View style={s.loadingRow}>
              <ActivityIndicator size="small" color="#888" />
              <Text style={s.loadingText}>Loading session history…</Text>
            </View>
          )}

          {error && !loading && (
            <Text style={s.errorText}>Failed to load history: {error}</Text>
          )}

          {!loading && !error && sessions.length === 0 && (
            <Text style={s.emptyText}>No past sessions found</Text>
          )}

          {sessions.map((session) => (
            <TouchableOpacity
              key={session.session_id}
              style={s.sessionItem}
              onPress={() => onResume(session)}
              activeOpacity={0.7}
            >
              <Text style={s.sessionPreview} numberOfLines={2}>
                {session.preview || '(empty session)'}
              </Text>
              <View style={s.sessionMeta}>
                <Text style={s.sessionMetaText}>
                  {session.message_count} msg{session.message_count !== 1 ? 's' : ''}
                </Text>
                <Text style={s.sessionMetaText}>
                  {timeAgo(session.last_active_at)}
                </Text>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    backgroundColor: '#1a1a2e',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '70%',
    paddingBottom: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  title: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: '#e6edf3',
  },
  closeBtn: {
    padding: 6,
  },
  closeBtnText: {
    color: '#8b949e',
    fontSize: 16,
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 20,
  },
  loadingText: {
    color: '#8b949e',
    fontSize: 13,
  },
  emptyText: {
    color: '#8b949e',
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 20,
  },
  errorText: {
    color: '#f85149',
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 20,
  },
  sessionItem: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  sessionPreview: {
    fontSize: 13,
    color: '#e6edf3',
    lineHeight: 18,
    marginBottom: 4,
  },
  sessionMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sessionMetaText: {
    fontSize: 11,
    color: '#8b949e',
  },
});
