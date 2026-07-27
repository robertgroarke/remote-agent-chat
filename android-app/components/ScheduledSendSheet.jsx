import React, { useEffect, useRef, useState } from 'react';
import { Modal, View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Alert } from 'react-native';
import { getStoredJwt, RELAY_URL } from '../lib/auth';

function localDateTimeValue(date) {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function ScheduledSendSheet({ visible, sessionId, initialContent, onCreated, onClose, onMinimize }) {
  const [content, setContent] = useState(initialContent || '');
  const [triggerKind, setTriggerKind] = useState('idle');
  const [deliverAt, setDeliverAt] = useState(() => localDateTimeValue(new Date(Date.now() + 3600000)));
  const [jobs, setJobs] = useState([]);
  const [saving, setSaving] = useState(false);
  const resetOnNextOpenRef = useRef(true);
  const wasVisibleRef = useRef(false);
  useEffect(() => {
    if (visible && !wasVisibleRef.current) {
      if (resetOnNextOpenRef.current) {
        setContent(initialContent || '');
        resetOnNextOpenRef.current = false;
      }
      load();
    }
    wasVisibleRef.current = visible;
  }, [visible, sessionId]);
  function closeExplicitly() {
    resetOnNextOpenRef.current = true;
    onClose();
  }
  async function request(path, options = {}) {
    const jwt = await getStoredJwt();
    if (!jwt) throw new Error('Sign in again to manage scheduled messages.');
    const response = await fetch(`${RELAY_URL}${path}`, {
      ...options, headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    return body;
  }
  async function load() {
    try {
      const body = await request(`/api/scheduled-sends?session_id=${encodeURIComponent(sessionId)}`);
      setJobs((body.scheduled_sends || []).filter(job => job.state === 'pending'));
    } catch (error) { Alert.alert('Scheduled messages', error.message); }
  }
  async function create() {
    if (!content.trim()) return;
    setSaving(true);
    try {
      await request('/api/scheduled-sends', {
        method: 'POST', body: JSON.stringify({
          session_id: sessionId, content, trigger_kind: triggerKind,
          deliver_at: triggerKind === 'at' ? new Date(deliverAt).toISOString() : null,
        }),
      });
      setContent(''); onCreated?.(); await load();
    } catch (error) { Alert.alert('Could not schedule', error.message); } finally { setSaving(false); }
  }
  async function cancel(id) {
    try { await request(`/api/scheduled-sends/${encodeURIComponent(id)}`, { method: 'DELETE' }); await load(); }
    catch (error) { Alert.alert('Could not cancel', error.message); }
  }
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onMinimize || closeExplicitly}>
    <View style={s.backdrop}><View style={s.sheet}>
      <View style={s.header}>
        <Text style={s.title}>Schedule message</Text>
        <View style={s.headerActions}>
          <TouchableOpacity
            style={s.minimize}
            onPress={onMinimize || closeExplicitly}
            accessibilityRole="button"
            accessibilityLabel="Minimize Scheduled send"
            accessibilityState={{ expanded: true }}
            testID="pane-minimize-scheduled-send"
          >
            <Text style={s.minimizeText}>Minimize</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.closeButton} onPress={closeExplicitly} accessibilityLabel="Close scheduled messages">
            <Text style={s.close}>×</Text>
          </TouchableOpacity>
        </View>
      </View>
      <ScrollView contentContainerStyle={s.body}>
        <Text style={s.label}>Message</Text><TextInput style={[s.input, s.message]} multiline value={content} onChangeText={setContent} />
        <Text style={s.label}>Deliver</Text><View style={s.row}>
          <TouchableOpacity style={[s.choice, triggerKind === 'idle' && s.active]} onPress={() => setTriggerKind('idle')}><Text style={s.choiceText}>Next idle</Text></TouchableOpacity>
          <TouchableOpacity style={[s.choice, triggerKind === 'at' && s.active]} onPress={() => setTriggerKind('at')}><Text style={s.choiceText}>At time</Text></TouchableOpacity>
        </View>
        {triggerKind === 'at' && <><Text style={s.label}>Local or ISO time</Text><TextInput style={s.input} value={deliverAt} onChangeText={setDeliverAt} autoCapitalize="none" /></>}
        <TouchableOpacity style={[s.primary, (!content.trim() || saving) && s.disabled]} disabled={!content.trim() || saving} onPress={create}><Text style={s.primaryText}>{saving ? 'Scheduling…' : 'Schedule'}</Text></TouchableOpacity>
        {!!jobs.length && <><Text style={s.label}>Pending</Text>{jobs.map(job => <View style={s.job} key={job.id}><Text style={s.jobText}>{job.trigger_kind === 'idle' ? 'Next idle' : new Date(job.deliver_at).toLocaleString()} · {job.content}</Text><TouchableOpacity onPress={() => cancel(job.id)}><Text style={s.cancel}>Cancel</Text></TouchableOpacity></View>)}</>}
      </ScrollView>
    </View></View>
  </Modal>;
}

const s = StyleSheet.create({
  backdrop:{flex:1,justifyContent:'flex-end',backgroundColor:'rgba(0,0,0,.55)'},sheet:{maxHeight:'45%',backgroundColor:'#161b22',borderTopLeftRadius:16,borderTopRightRadius:16},header:{minHeight:52,flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:12,borderBottomWidth:1,borderBottomColor:'#30363d'},title:{color:'#f0f6fc',fontSize:17,fontWeight:'700',flex:1},headerActions:{flexDirection:'row',alignItems:'center',gap:8},minimize:{minWidth:44,minHeight:44,paddingHorizontal:10,borderWidth:1,borderColor:'#484f58',borderRadius:7,alignItems:'center',justifyContent:'center'},minimizeText:{color:'#f0f6fc',fontSize:11,fontWeight:'700'},closeButton:{minWidth:44,minHeight:44,alignItems:'center',justifyContent:'center'},close:{color:'#8b949e',fontSize:26},body:{padding:16,gap:10},label:{color:'#8b949e',fontSize:12,fontWeight:'700'},input:{color:'#f0f6fc',backgroundColor:'#0d1117',borderWidth:1,borderColor:'#30363d',borderRadius:8,padding:10},message:{minHeight:90,textAlignVertical:'top'},row:{flexDirection:'row',gap:8},choice:{flex:1,padding:10,borderWidth:1,borderColor:'#30363d',borderRadius:8,alignItems:'center'},active:{borderColor:'#58a6ff',backgroundColor:'#1f3b57'},choiceText:{color:'#f0f6fc'},primary:{backgroundColor:'#238636',padding:12,borderRadius:8,alignItems:'center'},disabled:{opacity:.5},primaryText:{color:'#fff',fontWeight:'700'},job:{flexDirection:'row',gap:8,padding:10,borderWidth:1,borderColor:'#30363d',borderRadius:8},jobText:{color:'#c9d1d9',flex:1},cancel:{color:'#f85149',fontWeight:'700'},
});
