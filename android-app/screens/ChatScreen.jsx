import React, {
  useCallback, useEffect, useLayoutEffect, useRef, useState,
} from 'react';
import {
  View, FlatList, TextInput, TouchableOpacity,
  Text, StyleSheet, KeyboardAvoidingView, Platform,
  ActivityIndicator, Keyboard, Image, Alert,
} from 'react-native';
import * as ImagePicker    from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem     from 'expo-file-system';
import { RelayClient }      from '../lib/relay';
import { getStoredJwt, signOut, RELAY_URL } from '../lib/auth';
import MessageBubble         from '../components/MessageBubble';
import ActivityRow           from '../components/ActivityRow';
import PermissionPrompt      from '../components/PermissionPrompt';
import AgentSettingsSheet    from '../components/AgentSettingsSheet';
import ChatListSheet         from '../components/ChatListSheet';
import ThreadHistorySheet    from '../components/ThreadHistorySheet';
import TerminalViewer        from '../components/TerminalViewer';
import DiffViewer            from '../components/DiffViewer';
import BranchSelectorSheet   from '../components/BranchSelectorSheet';

export default function ChatScreen({ route, navigation }) {
  const { sessionId, title, agentType } = route.params;

  const [messages,  setMessages]  = useState([]);
  const [activity,  setActivity]  = useState(null);
  const [connected, setConnected] = useState(false);
  const [permPrompt, setPermPrompt] = useState(null);   // current permission prompt
  const [input,     setInput]     = useState('');
  const [sendPending,   setSendPending]   = useState(false);   // waiting for echo
  const [failedMsg,     setFailedMsg]     = useState(null);    // { sessionId, text, clientMsgId }
  const [reconnectInfo, setReconnectInfo] = useState(null);  // { attempt, nextRetryMs }
  const [unreadCount,   setUnreadCount]   = useState(0);     // new messages while scrolled up
  const [showJumpBtn,   setShowJumpBtn]   = useState(false); // show jump-to-bottom button
  const [agentConfig,   setAgentConfig]   = useState(null);  // per-session config from relay
  const [settingsOpen,  setSettingsOpen]  = useState(false); // agent settings sheet
  const [attachment,    setAttachment]    = useState(null);  // { uri, name, mimeType, isText?, content? }
  const [uploading,     setUploading]     = useState(false); // file upload in progress
  const [chatListOpen,  setChatListOpen]  = useState(false); // chat list sheet visible
  const [chatList,      setChatList]      = useState([]);    // [{ id, title, active }]
  const [chatListLoading, setChatListLoading] = useState(false);
  const [threadListOpen, setThreadListOpen] = useState(false);
  const [threadList,     setThreadList]     = useState([]);
  const [threadListLoading, setThreadListLoading] = useState(false);
  const [terminalOpen,   setTerminalOpen]   = useState(false);
  const [terminalEntries, setTerminalEntries] = useState([]);
  const [terminalLoading, setTerminalLoading] = useState(false);
  const [diffOpen,       setDiffOpen]       = useState(false);
  const [diffEntries,    setDiffEntries]    = useState([]);
  const [diffLoading,    setDiffLoading]    = useState(false);
  const [branchOpen,     setBranchOpen]     = useState(false);
  const [branchList,     setBranchList]     = useState([]);
  const [branchCurrent,  setBranchCurrent]  = useState('');
  const [branchLoading,  setBranchLoading]  = useState(false);

  const clientRef       = useRef(null);
  const flatListRef     = useRef(null);
  const sendTimer       = useRef(null);
  const isAtBottom      = useRef(true);
  const seenSequences   = useRef(new Set());
  const pendingMsgId    = useRef(null);   // { _id, _text } of in-flight message
  const failedMsgRef    = useRef(null);   // mirrors failedMsg state for use in callbacks
  const messageQueue    = useRef([]);     // offline queue: [{ text, clientMsgId }], max 5
  const scrollMetrics   = useRef({ contentHeight: 0, layoutHeight: 0, offsetY: 0 });
  const configRetryRef  = useRef(null);

  // Keep ref in sync with state for use inside memoized callbacks
  function updateFailedMsg(val) {
    failedMsgRef.current = val;
    setFailedMsg(val);
  }

  // ── Navigation header ───────────────────────────────────────────────────────

  const activityLabel = activity?.label || (activity?.generating ? 'Generating…' : null);

  useLayoutEffect(() => {
    // Derive capabilities from agentType (route param) as primary source,
    // fall back to agentConfig from relay if available
    const caps = agentConfig?.capabilities;
    const at = agentType;
    const hasChatList    = caps?.chat_list    ?? (at === 'codex' || at === 'codex-desktop' || at === 'antigravity_panel');
    const hasOpenPanel   = caps?.open_panel   ?? (at === 'codex' || at === 'antigravity_panel');
    const hasThreadList  = caps?.thread_list  ?? (at === 'codex-desktop');
    const hasTerminal    = caps?.terminal_output ?? (at === 'codex' || at === 'codex-desktop');
    const hasFileChanges = caps?.file_changes ?? (at === 'codex' || at === 'codex-desktop');
    navigation.setOptions({
      headerTitle: () => (
        <View style={{ alignItems: 'center', maxWidth: 120 }}>
          <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }} numberOfLines={1}>{title}</Text>
          {activityLabel ? (
            <Text style={{ color: '#58a6ff', fontSize: 10, fontStyle: 'italic' }} numberOfLines={1}>{activityLabel}</Text>
          ) : null}
        </View>
      ),
      headerRight: () => (
        <View style={hr.row}>
          {hasOpenPanel && (
            <TouchableOpacity
              onPress={() => clientRef.current?.openPanel(sessionId)}
              style={hr.btn}
              activeOpacity={0.7}
            >
              <Text style={hr.btnText}>Panel</Text>
            </TouchableOpacity>
          )}
          {hasThreadList && (
            <TouchableOpacity
              onPress={() => {
                setThreadListOpen(true);
                setThreadListLoading(true);
                clientRef.current?.requestThreadList(sessionId);
              }}
              style={hr.btn}
              activeOpacity={0.7}
            >
              <Text style={hr.btnText}>Threads</Text>
            </TouchableOpacity>
          )}
          {hasTerminal && (
            <TouchableOpacity
              onPress={() => {
                setTerminalOpen(true);
                setTerminalLoading(true);
                clientRef.current?.requestTerminalOutput(sessionId);
              }}
              style={hr.btn}
              activeOpacity={0.7}
            >
              <Text style={hr.btnText}>Term</Text>
            </TouchableOpacity>
          )}
          {hasFileChanges && (
            <TouchableOpacity
              onPress={() => {
                setDiffOpen(true);
                setDiffLoading(true);
                clientRef.current?.requestFileChanges(sessionId);
              }}
              style={hr.btn}
              activeOpacity={0.7}
            >
              <Text style={hr.btnText}>Diff</Text>
            </TouchableOpacity>
          )}
          {hasChatList && (
            <TouchableOpacity
              onPress={() => {
                setChatListOpen(true);
                setChatListLoading(true);
                clientRef.current?.requestChatList(sessionId);
              }}
              style={hr.btn}
              activeOpacity={0.7}
            >
              <Text style={hr.btnText}>Chats</Text>
            </TouchableOpacity>
          )}
          {agentConfig?.capabilities?.branch_list && agentConfig?.branch && agentConfig.branch !== 'unknown' && (
            <TouchableOpacity
              onPress={() => {
                setBranchOpen(true);
                setBranchLoading(true);
                clientRef.current?.requestBranchList(sessionId);
              }}
              style={hr.btn}
              activeOpacity={0.7}
            >
              <Text style={hr.btnText}>⑂ {agentConfig.branch.length > 10 ? agentConfig.branch.substring(0, 10) + '…' : agentConfig.branch}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={() => setSettingsOpen(true)}
            style={hr.btn}
            activeOpacity={0.7}
          >
            <Text style={hr.gearText}>⚙</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => clientRef.current?.interrupt(sessionId)}
            style={hr.btn}
            activeOpacity={0.7}
          >
            <Text style={hr.btnText}>■ Stop</Text>
          </TouchableOpacity>
        </View>
      ),
    });
  }, [navigation, sessionId, title, agentType, agentConfig, activityLabel]);

  // ── Message handler ─────────────────────────────────────────────────────────

  const handleMessage = useCallback((msg) => {
    console.log('[ChatScreen] msg type=', msg.type, 'session=', msg.session_id || msg.session || '');
    switch (msg.type) {
      case '_connected':
        setConnected(true);
        setReconnectInfo(null);
        clientRef.current?.requestHistory(sessionId);
        clientRef.current?.requestAgentConfig(sessionId);
        // Retry config request after 3s if not received
        clearTimeout(configRetryRef.current);
        configRetryRef.current = setTimeout(() => {
          console.log('[ChatScreen] Config retry for', sessionId);
          clientRef.current?.requestAgentConfig(sessionId);
        }, 3000);
        // Retry failed message
        if (failedMsgRef.current && failedMsgRef.current.sessionId === sessionId) {
          const { text, clientMsgId } = failedMsgRef.current;
          updateFailedMsg(null);
          doSend(text, clientMsgId);
        }
        // Flush offline queue
        if (messageQueue.current.length > 0) {
          const queued = [...messageQueue.current];
          messageQueue.current = [];
          // Remove queued placeholders from messages
          setMessages(prev => prev.filter(m => !m._queued));
          for (const item of queued) {
            doSend(item.text, item.clientMsgId);
          }
        }
        break;

      case '_disconnected':
        setConnected(false);
        // Mark pending send as failed
        if (pendingMsgId.current) {
          clearTimeout(sendTimer.current);
          setSendPending(false);
          updateFailedMsg({ sessionId, text: pendingMsgId.current._text, clientMsgId: pendingMsgId.current._id });
          pendingMsgId.current = null;
        }
        if (msg.reason === 'unauthenticated') {
          signOut().then(() => navigation.replace('Login'));
        }
        break;

      case '_reconnecting':
        setReconnectInfo({ attempt: msg.attempt, nextRetryMs: msg.nextRetryMs });
        break;

      case 'history': {
        if (msg.session !== sessionId) break;
        const msgs = (msg.messages || []).filter(m => {
          if (seenSequences.current.has(m.sequence)) return false;
          seenSequences.current.add(m.sequence);
          return true;
        });
        setMessages(prev => mergeSorted([...prev, ...msgs]));
        break;
      }

      case 'message': {
        if (msg.session !== sessionId) break;
        if (msg.sequence != null) {
          if (seenSequences.current.has(msg.sequence)) break;
          seenSequences.current.add(msg.sequence);
        }
        // Detect echo of our sent message
        if (msg.role === 'user' && pendingMsgId.current &&
            (msg.client_msg_id === pendingMsgId.current._id ||
             msg.content === pendingMsgId.current._text)) {
          clearTimeout(sendTimer.current);
          setSendPending(false);
          pendingMsgId.current = null;
        }
        setMessages(prev => mergeSorted([...prev, msg]));
        break;
      }

      case 'status': {
        // Relay sends { type: 'status', session, thinking, label }
        if (msg.session !== sessionId) break;
        if (msg.thinking) {
          setActivity({ generating: true, label: msg.label || 'Thinking' });
        } else {
          setActivity(null);
        }
        break;
      }

      case 'permission_prompt': {
        if (msg.session_id !== sessionId) break;
        setPermPrompt({ ...msg, received_at: Date.now() });
        break;
      }

      case 'permission_prompt_expired': {
        if (msg.session_id !== sessionId) break;
        setPermPrompt(prev => prev?.prompt_id === msg.prompt_id ? null : prev);
        break;
      }

      case 'agent_control_result': {
        const sid = msg.session_id || msg.session;
        if (sid !== sessionId) break;
        if (msg.command === 'permission_response') {
          if (msg.result === 'ok') {
            setPermPrompt(null);
          } else if (msg.result === 'failed') {
            setPermPrompt(prev => prev ? { ...prev, submitting: null, error: msg.error?.message || 'Failed' } : null);
          }
        }
        break;
      }

      case 'connection_ack': {
        // Extract config from initial handshake if available
        if (msg.agent_configs && msg.agent_configs[sessionId]) {
          setAgentConfig(msg.agent_configs[sessionId]);
        }
        break;
      }

      case 'agent_config': {
        const sid = msg.session_id || msg.session;
        console.log('[ChatScreen] agent_config received', sid, 'match=', sid === sessionId, 'caps=', JSON.stringify(msg.capabilities));
        if (sid === sessionId) {
          clearTimeout(configRetryRef.current);
          setAgentConfig(msg);
        }
        break;
      }

      case 'agent_control_result': {
        // Config change acknowledged — refresh config
        const sid = msg.session_id || msg.session;
        if (sid !== sessionId) break;
        if (msg.result === 'ok') {
          clientRef.current?.requestAgentConfig(sessionId);
        } else if (msg.result === 'failed') {
          // Stop any loading spinners on failure
          const cmd = msg.command;
          if (cmd === 'thread_list')     setThreadListLoading(false);
          if (cmd === 'chat_list')       setChatListLoading(false);
          if (cmd === 'terminal_output') setTerminalLoading(false);
          if (cmd === 'file_changes')    setDiffLoading(false);
          if (cmd === 'branch_list')     setBranchLoading(false);
          console.warn('[ChatScreen] control failed:', cmd, msg.error);
        }
        break;
      }

      case 'chat_list': {
        const sid = msg.session_id || msg.session;
        if (sid === sessionId) {
          setChatList(msg.chats || []);
          setChatListLoading(false);
        }
        break;
      }

      case 'thread_list': {
        const sid = msg.session_id || msg.session;
        if (sid === sessionId) {
          setThreadList(msg.threads || []);
          setThreadListLoading(false);
        }
        break;
      }

      case 'branch_list': {
        const sid = msg.session_id || msg.session;
        if (sid === sessionId) {
          setBranchList(msg.branches || []);
          setBranchCurrent(msg.current || '');
          setBranchLoading(false);
        }
        break;
      }

      case 'terminal_output': {
        const sid = msg.session_id || msg.session;
        if (sid === sessionId) {
          setTerminalEntries(msg.entries || []);
          setTerminalLoading(false);
        }
        break;
      }

      case 'file_changes': {
        const sid = msg.session_id || msg.session;
        if (sid === sessionId) {
          setDiffEntries(msg.entries || []);
          setDiffLoading(false);
        }
        break;
      }

      default:
        break;
    }
  }, [sessionId, navigation]);

  // ── Connect on mount ────────────────────────────────────────────────────────

  useEffect(() => {
    const client = new RelayClient(handleMessage);
    clientRef.current = client;
    client.connect();
    return () => {
      client.disconnect();
      clientRef.current = null;
      clearTimeout(sendTimer.current);
      clearTimeout(configRetryRef.current);
    };
  }, [handleMessage]);

  // ── Auto-scroll ─────────────────────────────────────────────────────────────

  const prevMsgCount = useRef(0);
  const historyLoaded = useRef(false);
  useEffect(() => {
    const newCount = messages.length - prevMsgCount.current;
    prevMsgCount.current = messages.length;
    if (messages.length === 0) return;

    // Don't count initial history load as "new" messages
    if (!historyLoaded.current) {
      historyLoaded.current = true;
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: false }), 50);
      return;
    }

    if (isAtBottom.current) {
      setUnreadCount(0);
      setShowJumpBtn(false);
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
    } else if (newCount > 0) {
      setUnreadCount(prev => prev + newCount);
      setShowJumpBtn(true);
    }
  }, [messages]);

  // ── Send message ────────────────────────────────────────────────────────────

  function doSend(text, clientMsgId) {
    const id = clientMsgId || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    pendingMsgId.current = { _id: id, _text: text };
    setSendPending(true);
    updateFailedMsg(null);
    clientRef.current.sendMessage(sessionId, text, id);

    // 5s timeout — mark as failed if no echo
    clearTimeout(sendTimer.current);
    sendTimer.current = setTimeout(() => {
      if (pendingMsgId.current?._id === id) {
        setSendPending(false);
        updateFailedMsg({ sessionId, text, clientMsgId: id });
        pendingMsgId.current = null;
      }
    }, 5_000);
  }

  // ── Attachment helpers ──────────────────────────────────────────────────────

  async function pickImage() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      base64: false,
    });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    const name = asset.fileName || `photo-${Date.now()}.jpg`;
    setAttachment({ uri: asset.uri, name, mimeType: asset.mimeType || 'image/jpeg' });
  }

  async function pickFile() {
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    const isText = isTextFile(asset.name) && (asset.size || 0) < 500 * 1024;
    if (isText) {
      try {
        const content = await FileSystem.readAsStringAsync(asset.uri, { encoding: 'utf8' });
        setAttachment({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType, isText: true, content });
      } catch {
        setAttachment({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType });
      }
    } else {
      setAttachment({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType });
    }
  }

  function showAttachmentPicker() {
    Alert.alert('Attach', null, [
      { text: 'Photo / Gallery', onPress: pickImage },
      { text: 'File', onPress: pickFile },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function uploadAttachment(att) {
    const jwt = await getStoredJwt();
    const base64 = await FileSystem.readAsStringAsync(att.uri, { encoding: FileSystem.EncodingType.Base64 });
    const resp = await fetch(`${RELAY_URL}/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `connect.sid=_; token=${jwt}`,
        'Authorization': `Bearer ${jwt}`,
      },
      body: JSON.stringify({ filename: att.name, content: base64, mimeType: att.mimeType }),
    });
    if (!resp.ok) throw new Error('Upload failed');
    const { url } = await resp.json();
    return url;
  }

  async function handleSend() {
    const text = input.trim();
    if (!text && !attachment) return;
    setInput('');
    Keyboard.dismiss();

    let content = '';

    if (attachment) {
      const att = attachment;
      setAttachment(null);

      if (att.isText && att.content) {
        const lang = getLang(att.name);
        content = `\`${att.name}\`\n\`\`\`${lang}\n${att.content}\n\`\`\``;
        if (text) content += `\n\n${text}`;
      } else {
        // For codex-desktop with send_attachment + image: inject directly
        const caps = agentConfig?.capabilities || {};
        if (caps.send_attachment && (att.mimeType || '').startsWith('image/')) {
          setUploading(true);
          try {
            const base64 = await FileSystem.readAsStringAsync(att.uri, { encoding: FileSystem.EncodingType.Base64 });
            clientRef.current?.sendAttachment(sessionId, base64, att.mimeType, att.name);
            content = text || `[Image: ${att.name}]`;
          } catch {
            Alert.alert('Attachment failed', 'Could not send image to Codex.');
            setInput(text);
            setAttachment(att);
            setUploading(false);
            return;
          }
          setUploading(false);
        } else {
          // Upload binary file/image via relay server
          setUploading(true);
          try {
            const url = await uploadAttachment(att);
            content = `[File: ${att.name}](${url})`;
            if (text) content += `\n\n${text}`;
          } catch {
            Alert.alert('Upload failed', 'Could not upload the file. Try again.');
            setInput(text);
            setAttachment(att);
            setUploading(false);
            return;
          }
          setUploading(false);
        }
      }
    } else {
      content = text;
    }

    // If disconnected or already pending, queue the message (max 5)
    if (!connected || sendPending) {
      if (messageQueue.current.length >= 5) return;
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      messageQueue.current.push({ text: content, clientMsgId: id });
      setMessages(prev => mergeSorted([...prev, {
        role: 'user', content, _queued: true,
        sequence: -(messageQueue.current.length),
        timestamp: new Date().toISOString(),
      }]));
      return;
    }

    doSend(content);
  }

  function handleRetry() {
    if (!failedMsg || !clientRef.current) return;
    const { text, clientMsgId } = failedMsg;
    doSend(text, clientMsgId);
  }

  function handlePermChoice(promptId, choiceId) {
    clientRef.current?.respondToPermission(sessionId, promptId, choiceId);
    setPermPrompt(null);
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <KeyboardAvoidingView
      style={s.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      {!connected && (
        <View style={s.disconnectBanner}>
          <Text style={s.disconnectText}>
            {reconnectInfo && reconnectInfo.attempt >= 5
              ? "Can't reach server — check connection"
              : reconnectInfo
                ? `Reconnecting (attempt ${reconnectInfo.attempt}, retry in ${Math.round(reconnectInfo.nextRetryMs / 1000)}s)…`
                : 'Reconnecting…'}
          </Text>
        </View>
      )}

      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item, i) => (item.sequence != null ? String(item.sequence) : String(i))}
        renderItem={({ item }) => <MessageBubble message={item} />}
        contentContainerStyle={s.messageList}
        onScroll={e => {
          const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
          scrollMetrics.current = {
            contentHeight: contentSize.height,
            layoutHeight: layoutMeasurement.height,
            offsetY: contentOffset.y,
          };
          const distFromBottom = contentSize.height - contentOffset.y - layoutMeasurement.height;
          const wasAtBottom = isAtBottom.current;
          isAtBottom.current = distFromBottom < 80;
          if (!wasAtBottom && isAtBottom.current) {
            setUnreadCount(0);
            setShowJumpBtn(false);
          }
          // Show jump button when scrolled significantly up from bottom
          if (!isAtBottom.current && distFromBottom > 200) {
            setShowJumpBtn(true);
          }
        }}
        scrollEventThrottle={16}
        onContentSizeChange={() => {
          // Re-evaluate bottom state when content size changes (new messages)
          const { contentHeight, layoutHeight, offsetY } = scrollMetrics.current;
          if (contentHeight > 0) {
            const dist = contentHeight - offsetY - layoutHeight;
            // If we were at the bottom before the content grew, stay at bottom
            if (isAtBottom.current) {
              setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 30);
            }
          }
        }}
        ListEmptyComponent={
          <View style={s.emptyList}>
            <Text style={s.emptyText}>No messages yet</Text>
          </View>
        }
      />

      {showJumpBtn && (
        <TouchableOpacity
          style={s.scrollToBottom}
          activeOpacity={0.8}
          onPress={() => {
            flatListRef.current?.scrollToEnd({ animated: true });
            setUnreadCount(0);
            setShowJumpBtn(false);
          }}
        >
          <Text style={s.scrollToBottomText}>
            {unreadCount > 0
              ? `↓ ${unreadCount} new message${unreadCount === 1 ? '' : 's'}`
              : '↓ Jump to newest'}
          </Text>
        </TouchableOpacity>
      )}

      <ActivityRow activity={activity} />
      <PermissionPrompt prompt={permPrompt} onChoice={handlePermChoice} />

      {failedMsg && (
        <TouchableOpacity style={s.failedRow} onPress={handleRetry} activeOpacity={0.7}>
          <Text style={s.failedText}>Send failed — tap to retry</Text>
        </TouchableOpacity>
      )}

      {attachment && (
        <View style={s.attachPreview}>
          {attachment.mimeType?.startsWith('image/') ? (
            <Image source={{ uri: attachment.uri }} style={s.attachThumb} />
          ) : (
            <View style={s.attachFileIcon}>
              <Text style={s.attachFileEmoji}>📄</Text>
            </View>
          )}
          <Text style={s.attachName} numberOfLines={1}>{attachment.name}</Text>
          <TouchableOpacity onPress={() => setAttachment(null)} style={s.attachRemove}>
            <Text style={s.attachRemoveText}>✕</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={s.inputRow}>
        <TouchableOpacity
          style={s.attachBtn}
          onPress={showAttachmentPicker}
          activeOpacity={0.7}
          disabled={uploading}
        >
          <Text style={s.attachBtnText}>📎</Text>
        </TouchableOpacity>
        <TextInput
          style={s.input}
          value={input}
          onChangeText={setInput}
          placeholder="Message…"
          placeholderTextColor="#444c56"
          multiline
          maxLength={4000}
          returnKeyType="default"
        />
        <TouchableOpacity
          style={[s.sendBtn, (!input.trim() && !attachment || sendPending || uploading) && s.sendBtnDisabled]}
          onPress={handleSend}
          disabled={(!input.trim() && !attachment) || sendPending || uploading}
          activeOpacity={0.7}
        >
          {sendPending || uploading ? (
            <ActivityIndicator size="small" color="#58a6ff" />
          ) : (
            <Text style={s.sendBtnText}>↑</Text>
          )}
        </TouchableOpacity>
      </View>

      <AgentSettingsSheet
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        agentType={agentType}
        config={agentConfig}
        relay={clientRef.current}
        sessionId={sessionId}
      />

      <TerminalViewer
        visible={terminalOpen}
        entries={terminalEntries}
        loading={terminalLoading}
        onRefresh={() => {
          setTerminalLoading(true);
          clientRef.current?.requestTerminalOutput(sessionId);
        }}
        onClose={() => setTerminalOpen(false)}
        onSendInput={agentType === 'codex-desktop' ? (text) => {
          clientRef.current?.sendTerminalInput(sessionId, text);
        } : undefined}
      />

      <DiffViewer
        visible={diffOpen}
        entries={diffEntries}
        loading={diffLoading}
        onRefresh={() => {
          setDiffLoading(true);
          clientRef.current?.requestFileChanges(sessionId);
        }}
        onClose={() => setDiffOpen(false)}
      />

      <ThreadHistorySheet
        visible={threadListOpen}
        threads={threadList}
        loading={threadListLoading}
        onSwitch={(threadId) => {
          clientRef.current?.switchThread(sessionId, threadId);
          setThreadListOpen(false);
        }}
        onNew={() => {
          clientRef.current?.newChat(sessionId);
          setThreadListOpen(false);
        }}
        onClose={() => setThreadListOpen(false)}
      />

      <ChatListSheet
        visible={chatListOpen}
        chats={chatList}
        loading={chatListLoading}
        onSwitch={(chatId) => {
          clientRef.current?.switchChat(sessionId, chatId);
          setChatListOpen(false);
        }}
        onNew={() => {
          clientRef.current?.newChat(sessionId);
          setChatListOpen(false);
        }}
        onClose={() => setChatListOpen(false)}
      />

      <BranchSelectorSheet
        visible={branchOpen}
        branches={branchList}
        current={branchCurrent || agentConfig?.branch || ''}
        loading={branchLoading}
        onSwitch={(branchName) => {
          clientRef.current?.switchBranch(sessionId, branchName);
          setBranchOpen(false);
        }}
        onCreate={(branchName) => {
          clientRef.current?.createBranch(sessionId, branchName);
          setBranchOpen(false);
        }}
        onClose={() => setBranchOpen(false)}
      />
    </KeyboardAvoidingView>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const TEXT_EXTS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.json', '.md', '.txt', '.py', '.sh', '.bat',
  '.css', '.html', '.xml', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.env',
  '.sql', '.rs', '.go', '.java', '.kt', '.c', '.cpp', '.h', '.hpp', '.cs',
  '.rb', '.lua', '.swift', '.r', '.m', '.pl', '.php', '.dart',
]);

function isTextFile(name) {
  const ext = (name || '').match(/\.[^.]+$/)?.[0]?.toLowerCase();
  return ext ? TEXT_EXTS.has(ext) : false;
}

function getLang(name) {
  const ext = (name || '').match(/\.([^.]+)$/)?.[1]?.toLowerCase() || '';
  const map = { js: 'javascript', jsx: 'jsx', ts: 'typescript', tsx: 'tsx', py: 'python', sh: 'bash', bat: 'batch', rs: 'rust', rb: 'ruby', kt: 'kotlin', cs: 'csharp', cpp: 'cpp', hpp: 'cpp' };
  return map[ext] || ext;
}

function mergeSorted(msgs) {
  const seen = new Set();
  return msgs
    .filter(m => {
      const key = m.sequence != null ? `seq:${m.sequence}` : `ts:${m.timestamp}:${m.role}:${String(m.content).slice(0, 20)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
}

// ── Styles ────────────────────────────────────────────────────────────────────

const hr = StyleSheet.create({
  row:      { flexDirection: 'row', alignItems: 'center' },
  btn:      { marginRight: 4, paddingVertical: 6, paddingHorizontal: 2 },
  btnText:  { color: '#f85149', fontSize: 11, fontWeight: '600' },
  gearText: { color: '#768390', fontSize: 16 },
});

const s = StyleSheet.create({
  container: {
    flex:            1,
    backgroundColor: '#0b0f14',
  },
  disconnectBanner: {
    backgroundColor: '#2d1b00',
    borderBottomWidth: 1,
    borderBottomColor: '#f0883e',
    paddingVertical:   6,
    alignItems:        'center',
  },
  disconnectText: {
    color:    '#f0883e',
    fontSize: 12,
  },
  messageList: {
    paddingVertical: 12,
    flexGrow:        1,
  },
  emptyList: {
    flex:           1,
    justifyContent: 'center',
    alignItems:     'center',
    paddingTop:     60,
  },
  emptyText: {
    color:    '#444c56',
    fontSize: 14,
  },
  scrollToBottom: {
    alignSelf:        'center',
    backgroundColor:  '#1f4d8a',
    paddingHorizontal: 14,
    paddingVertical:   6,
    borderRadius:     16,
    marginVertical:    4,
  },
  scrollToBottomText: {
    color:      '#cdd9e5',
    fontSize:   12,
    fontWeight:  '600',
  },
  failedRow: {
    backgroundColor: '#3d1a1a',
    borderTopWidth:  1,
    borderTopColor:  '#f85149',
    paddingVertical: 8,
    alignItems:      'center',
  },
  failedText: {
    color:    '#f85149',
    fontSize: 12,
    fontWeight: '600',
  },
  attachPreview: {
    flexDirection:    'row',
    alignItems:       'center',
    backgroundColor:  '#161b22',
    borderTopWidth:   1,
    borderTopColor:   '#30363d',
    paddingHorizontal: 12,
    paddingVertical:   8,
    gap:              8,
  },
  attachThumb: {
    width:        40,
    height:       40,
    borderRadius: 6,
    backgroundColor: '#21262d',
  },
  attachFileIcon: {
    width:           40,
    height:          40,
    borderRadius:    6,
    backgroundColor: '#21262d',
    justifyContent:  'center',
    alignItems:      'center',
  },
  attachFileEmoji: {
    fontSize: 20,
  },
  attachName: {
    flex:     1,
    color:    '#cdd9e5',
    fontSize: 13,
  },
  attachRemove: {
    padding: 4,
  },
  attachRemoveText: {
    color:    '#768390',
    fontSize: 16,
    fontWeight: '600',
  },
  inputRow: {
    flexDirection:   'row',
    alignItems:      'flex-end',
    padding:         10,
    borderTopWidth:  1,
    borderTopColor:  '#30363d',
    backgroundColor: '#161b22',
    gap:             8,
  },
  attachBtn: {
    width:          36,
    height:         40,
    justifyContent: 'center',
    alignItems:     'center',
  },
  attachBtnText: {
    fontSize: 20,
  },
  input: {
    flex:             1,
    minHeight:        40,
    maxHeight:        120,
    backgroundColor:  '#21262d',
    borderRadius:     10,
    borderWidth:      1,
    borderColor:      '#30363d',
    color:            '#cdd9e5',
    fontSize:         14,
    paddingHorizontal: 12,
    paddingVertical:   10,
  },
  sendBtn: {
    width:           40,
    height:          40,
    borderRadius:    20,
    backgroundColor: '#58a6ff',
    justifyContent:  'center',
    alignItems:      'center',
  },
  sendBtnDisabled: {
    backgroundColor: '#21262d',
  },
  sendBtnText: {
    color:      '#0b0f14',
    fontSize:   18,
    fontWeight: '700',
  },
});
