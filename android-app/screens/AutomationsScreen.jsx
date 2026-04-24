import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, TextInput, ScrollView, TouchableOpacity, Switch, Modal,
  StyleSheet, ActivityIndicator, Alert, RefreshControl,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getStoredJwt, RELAY_URL } from '../lib/auth';

// ── WebSocket-based automations API (bypasses Cloudflare Access) ────────────

function useAutomationsRelay() {
  const wsRef = useRef(null);
  const pendingRef = useRef(null);  // { resolve, reject, timeout }

  async function ensureConnected() {
    if (wsRef.current?.readyState === WebSocket.OPEN) return wsRef.current;
    return new Promise(async (resolve, reject) => {
      const jwt = await getStoredJwt();
      if (!jwt) { reject(new Error('Not authenticated')); return; }
      const wsBase = RELAY_URL.replace(/^http/, 'ws');
      const ws = new WebSocket(`${wsBase}/client-ws?token=${encodeURIComponent(jwt)}`);
      const timeout = setTimeout(() => { ws.close(); reject(new Error('Connection timeout')); }, 8000);
      ws.onopen = () => { clearTimeout(timeout); wsRef.current = ws; resolve(ws); };
      ws.onerror = () => { clearTimeout(timeout); reject(new Error('Connection failed')); };
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type?.startsWith('automations_') && pendingRef.current) {
            clearTimeout(pendingRef.current.timeout);
            if (msg.type === 'automations_error') {
              pendingRef.current.reject(new Error(msg.error));
            } else {
              pendingRef.current.resolve(msg);
            }
            pendingRef.current = null;
          }
        } catch {}
      };
      ws.onclose = () => { wsRef.current = null; };
    });
  }

  async function send(msg) {
    const ws = await ensureConnected();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { reject(new Error('Request timeout')); pendingRef.current = null; }, 10000);
      pendingRef.current = { resolve, reject, timeout };
      ws.send(JSON.stringify(msg));
    });
  }

  function close() {
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
  }

  return { send, close };
}

// ── Agent identity (mirrors web AGENT_CONFIG) ──────────────────────────────

const AGENT_CONFIG = {
  claude:            { name: 'Claude Code',     color: '#cc785c', abbr: 'CC' },
  'claude-desktop':  { name: 'Claude Desktop',  color: '#cc785c', abbr: 'CD' },
  codex:             { name: 'Codex',            color: '#10a37f', abbr: 'CX' },
  'codex-desktop':   { name: 'Codex Desktop',   color: '#10a37f', abbr: 'CX' },
  gemini:            { name: 'Gemini',           color: '#4285f4', abbr: 'GC' },
  antigravity:       { name: 'Antigravity',      color: '#a855f7', abbr: 'AG' },
  antigravity_panel: { name: 'Antigravity Chat', color: '#a855f7', abbr: 'AC' },
};

const CATEGORY_ICONS = {
  'Status reports': '📊',
  'Release prep':   '🚀',
  'Code quality':   '🔍',
  'Documentation':  '📝',
  'General':        '⚙',
};

const SCHEDULE_LABELS = {
  daily:    'Daily',
  weekdays: 'Weekdays',
  weekly:   'Weekly',
  custom:   'Custom',
};

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const CATEGORIES = Object.keys(CATEGORY_ICONS);
const AGENT_TYPES = Object.keys(AGENT_CONFIG);
const SCHEDULES = ['daily', 'weekdays', 'weekly', 'custom'];

// ── Screen ──────────────────────────────────────────────────────────────────

export default function AutomationsScreen({ navigation }) {
  const [automations, setAutomations] = useState([]);
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editTarget, setEditTarget]   = useState(null); // null = new, object = edit
  const relay = useRef(useAutomationsRelay()).current;

  async function fetchAutomations() {
    try {
      const data = await relay.send({ type: 'automations_list' });
      setAutomations(data.automations || []);
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useFocusEffect(useCallback(() => { fetchAutomations(); return () => relay.close(); }, []));

  function handleRefresh() {
    setRefreshing(true);
    fetchAutomations();
  }

  function openCreate() {
    setEditTarget(null);
    setModalVisible(true);
  }

  function openEdit(automation) {
    setEditTarget(automation);
    setModalVisible(true);
  }

  async function handleRun(automation) {
    try {
      await relay.send({ type: 'automations_run', id: automation.id });
      Alert.alert('Running', `"${automation.name}" sent to agent`);
    } catch (e) {
      Alert.alert('Error', e.message);
    }
  }

  async function handleToggle(automation) {
    try {
      await relay.send({ type: 'automations_update', id: automation.id, enabled: !automation.enabled });
      fetchAutomations();
    } catch (e) {
      Alert.alert('Error', e.message);
    }
  }

  async function handleSave(form) {
    const isNew = !editTarget?.id;
    try {
      if (isNew) {
        await relay.send({ type: 'automations_create', ...form });
      } else {
        await relay.send({ type: 'automations_update', id: editTarget.id, ...form });
      }
      setModalVisible(false);
      fetchAutomations();
    } catch (e) {
      Alert.alert('Error', e.message);
    }
  }

  async function handleDelete(automation) {
    Alert.alert('Delete', `Delete "${automation.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          try {
            await relay.send({ type: 'automations_delete', id: automation.id });
            setModalVisible(false);
            fetchAutomations();
          } catch (e) {
            Alert.alert('Error', e.message);
          }
        },
      },
    ]);
  }

  // Group by category
  const categories = {};
  for (const auto of automations) {
    const cat = auto.category || 'General';
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(auto);
  }

  return (
    <View style={s.container}>
      <ScrollView
        contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#68b3ff" />}
      >
        <View style={s.header}>
          <View style={s.headerText}>
            <Text style={s.title}>Automations</Text>
            <Text style={s.subtitle}>Schedule recurring prompts to your agents.</Text>
          </View>
          <TouchableOpacity style={s.newBtn} onPress={openCreate} activeOpacity={0.7}>
            <Text style={s.newBtnText}>+ New</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <ActivityIndicator color="#68b3ff" style={{ marginTop: 40 }} />
        ) : automations.length === 0 ? (
          <View style={s.empty}>
            <Text style={s.emptyIcon}>⚙</Text>
            <Text style={s.emptyTitle}>No automations yet</Text>
            <Text style={s.emptyDesc}>Create your first automation to schedule recurring prompts.</Text>
            <TouchableOpacity style={s.newBtn} onPress={openCreate} activeOpacity={0.7}>
              <Text style={s.newBtnText}>+ New automation</Text>
            </TouchableOpacity>
          </View>
        ) : (
          Object.entries(categories).map(([cat, items]) => (
            <View key={cat} style={s.categorySection}>
              <Text style={s.categoryTitle}>{cat}</Text>
              {items.map(auto => (
                <AutomationCard
                  key={auto.id}
                  automation={auto}
                  onEdit={() => openEdit(auto)}
                  onRun={() => handleRun(auto)}
                  onToggle={() => handleToggle(auto)}
                />
              ))}
            </View>
          ))
        )}
      </ScrollView>

      <AutomationModal
        visible={modalVisible}
        automation={editTarget}
        onSave={handleSave}
        onDelete={handleDelete}
        onClose={() => setModalVisible(false)}
      />
    </View>
  );
}

// ── AutomationCard ──────────────────────────────────────────────────────────

function AutomationCard({ automation, onEdit, onRun, onToggle }) {
  const icon = CATEGORY_ICONS[automation.category] || '⚙';
  const scheduleLabel = SCHEDULE_LABELS[automation.schedule] || automation.schedule;
  const agentCfg = AGENT_CONFIG[automation.target_agent_type] || { name: 'Agent', color: '#8b949e', abbr: 'AG' };

  return (
    <TouchableOpacity
      style={[s.card, !automation.enabled && s.cardDisabled]}
      onPress={onEdit}
      activeOpacity={0.7}
    >
      <View style={s.cardIcon}><Text style={s.cardIconText}>{icon}</Text></View>
      <View style={s.cardBody}>
        <Text style={s.cardName} numberOfLines={1}>{automation.name}</Text>
        {!!automation.description && (
          <Text style={s.cardDesc} numberOfLines={2}>{automation.description}</Text>
        )}
        <View style={s.cardMeta}>
          <Text style={[s.cardAgent, { color: agentCfg.color }]}>{agentCfg.abbr}</Text>
          <Text style={s.cardSchedule}>
            {scheduleLabel} {String(automation.cron_hour).padStart(2, '0')}:{String(automation.cron_minute).padStart(2, '0')}
          </Text>
        </View>
      </View>
      <View style={s.cardActions}>
        <TouchableOpacity style={s.cardActionBtn} onPress={onRun} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={s.runIcon}>▶</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.cardActionBtn} onPress={onToggle} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={[s.toggleIcon, automation.enabled && s.toggleOn]}>
            {automation.enabled ? '●' : '○'}
          </Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

// ── AutomationModal ─────────────────────────────────────────────────────────

function AutomationModal({ visible, automation, onSave, onDelete, onClose }) {
  const isNew = !automation?.id;
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setForm({
        name:              automation?.name || '',
        description:       automation?.description || '',
        category:          automation?.category || 'General',
        prompt:            automation?.prompt || '',
        schedule:          automation?.schedule || 'daily',
        cron_hour:         String(automation?.cron_hour ?? 9),
        cron_minute:       String(automation?.cron_minute ?? 0),
        cron_days:         automation?.cron_days || [1,2,3,4,5],
        target_agent_type: automation?.target_agent_type || 'claude',
        enabled:           automation?.enabled !== false,
      });
      setSaving(false);
    }
  }, [visible, automation]);

  function setField(key, value) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  function toggleDay(day) {
    setForm(prev => {
      const days = prev.cron_days.includes(day)
        ? prev.cron_days.filter(d => d !== day)
        : [...prev.cron_days, day].sort();
      return { ...prev, cron_days: days };
    });
  }

  async function handleSubmit() {
    if (!form.name.trim() || !form.prompt.trim()) {
      Alert.alert('Error', 'Name and prompt are required');
      return;
    }
    setSaving(true);
    await onSave({
      ...form,
      cron_hour:   parseInt(form.cron_hour) || 0,
      cron_minute: parseInt(form.cron_minute) || 0,
    });
    setSaving(false);
  }

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={m.overlay}>
        <View style={m.modal}>
          <View style={m.header}>
            <Text style={m.headerTitle}>{isNew ? 'New Automation' : 'Edit Automation'}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={m.closeX}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={m.body} contentContainerStyle={m.bodyContent}>
            <Text style={m.label}>Name</Text>
            <TextInput style={m.input} value={form.name} onChangeText={v => setField('name', v)} placeholder="e.g. Daily standup summary" placeholderTextColor="#6f7c8f" />

            <Text style={m.label}>Description</Text>
            <TextInput style={m.input} value={form.description} onChangeText={v => setField('description', v)} placeholder="Brief description (optional)" placeholderTextColor="#6f7c8f" />

            <Text style={m.label}>Category</Text>
            <View style={m.chipRow}>
              {CATEGORIES.map(cat => (
                <TouchableOpacity
                  key={cat}
                  style={[m.chip, form.category === cat && m.chipActive]}
                  onPress={() => setField('category', cat)}
                >
                  <Text style={[m.chipText, form.category === cat && m.chipTextActive]}>
                    {CATEGORY_ICONS[cat]} {cat}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={m.label}>Prompt</Text>
            <TextInput
              style={[m.input, m.textArea]}
              value={form.prompt}
              onChangeText={v => setField('prompt', v)}
              placeholder="The prompt to send to the agent..."
              placeholderTextColor="#6f7c8f"
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />

            <Text style={m.label}>Target Agent</Text>
            <View style={m.chipRow}>
              {AGENT_TYPES.map(key => {
                const cfg = AGENT_CONFIG[key];
                return (
                  <TouchableOpacity
                    key={key}
                    style={[m.chip, form.target_agent_type === key && { borderColor: cfg.color, backgroundColor: cfg.color + '18' }]}
                    onPress={() => setField('target_agent_type', key)}
                  >
                    <Text style={[m.chipText, form.target_agent_type === key && { color: cfg.color }]}>
                      {cfg.abbr}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={m.label}>Schedule</Text>
            <View style={m.chipRow}>
              {SCHEDULES.map(sched => (
                <TouchableOpacity
                  key={sched}
                  style={[m.chip, form.schedule === sched && m.chipActive]}
                  onPress={() => setField('schedule', sched)}
                >
                  <Text style={[m.chipText, form.schedule === sched && m.chipTextActive]}>
                    {SCHEDULE_LABELS[sched]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={m.timeRow}>
              <View style={m.timeField}>
                <Text style={m.label}>Hour (0-23)</Text>
                <TextInput style={m.input} value={form.cron_hour} onChangeText={v => setField('cron_hour', v)} keyboardType="numeric" />
              </View>
              <View style={m.timeField}>
                <Text style={m.label}>Minute (0-59)</Text>
                <TextInput style={m.input} value={form.cron_minute} onChangeText={v => setField('cron_minute', v)} keyboardType="numeric" />
              </View>
            </View>

            {(form.schedule === 'custom' || form.schedule === 'weekly') && (
              <>
                <Text style={m.label}>Days</Text>
                <View style={m.chipRow}>
                  {DAY_NAMES.map((name, i) => (
                    <TouchableOpacity
                      key={i}
                      style={[m.dayChip, form.cron_days?.includes(i) && m.dayChipActive]}
                      onPress={() => toggleDay(i)}
                    >
                      <Text style={[m.dayText, form.cron_days?.includes(i) && m.dayTextActive]}>{name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            <View style={m.enabledRow}>
              <Text style={m.enabledLabel}>Enabled</Text>
              <Switch
                value={form.enabled}
                onValueChange={v => setField('enabled', v)}
                trackColor={{ false: '#283243', true: '#2a7bd8' }}
                thumbColor={form.enabled ? '#68b3ff' : '#6f7c8f'}
              />
            </View>
          </ScrollView>

          <View style={m.footer}>
            {!isNew && (
              <TouchableOpacity style={m.deleteBtn} onPress={() => onDelete(automation)}>
                <Text style={m.deleteBtnText}>Delete</Text>
              </TouchableOpacity>
            )}
            <View style={{ flex: 1 }} />
            <TouchableOpacity style={m.cancelBtn} onPress={onClose}>
              <Text style={m.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[m.saveBtn, (saving || !form.name?.trim() || !form.prompt?.trim()) && m.saveBtnDisabled]}
              onPress={handleSubmit}
              disabled={saving || !form.name?.trim() || !form.prompt?.trim()}
            >
              <Text style={m.saveBtnText}>{saving ? 'Saving...' : isNew ? 'Create' : 'Save'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0f14' },
  scroll: { paddingBottom: 24 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 16, borderBottomWidth: 1, borderBottomColor: '#283243',
  },
  headerText: { flex: 1 },
  title: { color: '#d7dee7', fontSize: 20, fontWeight: '700' },
  subtitle: { color: '#91a0b5', fontSize: 13, marginTop: 4 },
  newBtn: {
    backgroundColor: '#68b3ff', paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 6,
  },
  newBtnText: { color: '#0b0f14', fontWeight: '700', fontSize: 13 },

  empty: { alignItems: 'center', padding: 40, gap: 12 },
  emptyIcon: { fontSize: 40, opacity: 0.5 },
  emptyTitle: { color: '#d7dee7', fontSize: 16, fontWeight: '600' },
  emptyDesc: { color: '#91a0b5', fontSize: 13, textAlign: 'center', maxWidth: 300 },

  categorySection: { paddingHorizontal: 16, paddingTop: 20 },
  categoryTitle: {
    color: '#91a0b5', fontSize: 12, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10,
  },

  card: {
    backgroundColor: '#131a23', borderWidth: 1, borderColor: '#283243',
    borderRadius: 10, padding: 14, marginBottom: 10,
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
  },
  cardDisabled: { opacity: 0.5 },
  cardIcon: {
    width: 36, height: 36, borderRadius: 8, backgroundColor: '#181f29',
    alignItems: 'center', justifyContent: 'center',
  },
  cardIconText: { fontSize: 20 },
  cardBody: { flex: 1, minWidth: 0 },
  cardName: { color: '#d7dee7', fontSize: 14, fontWeight: '600' },
  cardDesc: { color: '#91a0b5', fontSize: 12, marginTop: 4 },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  cardAgent: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  cardSchedule: { color: '#6f7c8f', fontSize: 11 },
  cardActions: { flexDirection: 'column', gap: 6 },
  cardActionBtn: {
    width: 28, height: 28, borderWidth: 1, borderColor: '#283243',
    borderRadius: 6, alignItems: 'center', justifyContent: 'center',
  },
  runIcon: { color: '#46c37b', fontSize: 12 },
  toggleIcon: { color: '#6f7c8f', fontSize: 14 },
  toggleOn: { color: '#46c37b' },
});

const m = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modal: {
    backgroundColor: '#11161d', borderTopLeftRadius: 16, borderTopRightRadius: 16,
    maxHeight: '90%', borderWidth: 1, borderColor: '#283243',
  },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 16, borderBottomWidth: 1, borderBottomColor: '#283243',
  },
  headerTitle: { color: '#d7dee7', fontSize: 16, fontWeight: '600' },
  closeX: { color: '#91a0b5', fontSize: 18, padding: 4 },
  body: { maxHeight: 500 },
  bodyContent: { padding: 16, gap: 6 },
  label: {
    color: '#91a0b5', fontSize: 11, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 8,
  },
  input: {
    backgroundColor: '#0b0f14', borderWidth: 1, borderColor: '#283243',
    color: '#d7dee7', padding: 10, borderRadius: 6, fontSize: 13, marginTop: 4,
  },
  textArea: { minHeight: 80, textAlignVertical: 'top' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  chip: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6,
    borderWidth: 1, borderColor: '#283243', backgroundColor: '#0b0f14',
  },
  chipActive: { borderColor: '#68b3ff', backgroundColor: 'rgba(104,179,255,0.12)' },
  chipText: { color: '#91a0b5', fontSize: 12 },
  chipTextActive: { color: '#68b3ff' },
  timeRow: { flexDirection: 'row', gap: 12, marginTop: 4 },
  timeField: { flex: 1 },
  dayChip: {
    width: 38, height: 32, borderRadius: 6, borderWidth: 1, borderColor: '#283243',
    backgroundColor: '#0b0f14', alignItems: 'center', justifyContent: 'center',
  },
  dayChipActive: { borderColor: '#68b3ff', backgroundColor: '#68b3ff' },
  dayText: { color: '#91a0b5', fontSize: 11, fontWeight: '600' },
  dayTextActive: { color: '#0b0f14' },
  enabledRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 12, paddingVertical: 8,
  },
  enabledLabel: { color: '#d7dee7', fontSize: 14, fontWeight: '600' },
  footer: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 16, borderTopWidth: 1, borderTopColor: '#283243',
  },
  deleteBtn: {
    borderWidth: 1, borderColor: '#f26d78', paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 6,
  },
  deleteBtnText: { color: '#f26d78', fontSize: 13 },
  cancelBtn: {
    borderWidth: 1, borderColor: '#283243', paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 6,
  },
  cancelBtnText: { color: '#91a0b5', fontSize: 13 },
  saveBtn: {
    backgroundColor: '#68b3ff', paddingHorizontal: 18, paddingVertical: 8,
    borderRadius: 6,
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { color: '#0b0f14', fontSize: 13, fontWeight: '700' },
});
