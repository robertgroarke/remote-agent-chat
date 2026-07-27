import React from 'react';
import {
  Modal, View, Text, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet,
} from 'react-native';

const VIEWABLE_EXTENSIONS = new Set([
  'md', 'txt', 'json', 'js', 'jsx', 'ts', 'tsx', 'py', 'html', 'css',
  'yml', 'yaml', 'toml', 'sh', 'bat', 'ps1', 'cfg', 'conf', 'ini',
  'xml', 'csv', 'log', 'env', 'gitignore', 'dockerignore', 'sql',
  'java', 'c', 'h', 'cpp', 'hpp', 'cs', 'go', 'rs', 'rb', 'php', 'swift',
  'kt', 'scala', 'r', 'lua', 'vim', 'zsh', 'bash', 'fish',
]);

function isViewableFile(name) {
  const value = String(name || '');
  const extension = value.split('.').pop().toLowerCase();
  return value.startsWith('.') || VIEWABLE_EXTENSIONS.has(extension);
}

function parentPath(path) {
  const parts = String(path || '.').replace(/\\/g, '/').split('/').filter(Boolean);
  parts.pop();
  return parts.join('/') || '.';
}

function childPath(path, name) {
  return !path || path === '.' ? name : `${path.replace(/\\/g, '/')}/${name}`;
}

function formatSize(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return '';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export default function FileBrowserSheet({
  visible, listing, viewingFile, fileContent, loading, error,
  onNavigate, onOpenFile, onBack, onRefresh, onClose, onMinimize,
}) {
  const currentPath = listing?.path || '.';
  const entries = listing?.entries || [];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      presentationStyle="overFullScreen"
      onRequestClose={onMinimize || onClose}
    >
      <View style={s.backdrop}>
      <View style={s.container}>
        <View style={s.header}>
          <TouchableOpacity
            style={s.headerButton}
            onPress={viewingFile ? onBack : onClose}
            accessibilityRole="button"
          >
            <Text style={s.headerAction}>{viewingFile ? 'Back' : 'Close'}</Text>
          </TouchableOpacity>
          <Text style={s.title} numberOfLines={1}>{viewingFile || 'Workspace Files'}</Text>
          <View style={s.headerActions}>
            <TouchableOpacity
              style={s.minimizeButton}
              onPress={onMinimize || onClose}
              accessibilityRole="button"
              accessibilityLabel="Minimize Workspace files"
              accessibilityState={{ expanded: true }}
              testID="pane-minimize-file-browser"
            >
              <Text style={s.minimizeText}>Minimize</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.headerButton} onPress={onRefresh} accessibilityRole="button" disabled={loading}>
              <Text style={[s.headerAction, loading && s.disabled]}>Refresh</Text>
            </TouchableOpacity>
          </View>
        </View>

        {!!error && <Text style={s.error} accessibilityRole="alert">{error}</Text>}
        {loading && <ActivityIndicator style={s.loading} color="#58a6ff" />}

        {viewingFile ? (
          <ScrollView style={s.preview} contentContainerStyle={s.previewContent}>
            {fileContent?.truncated && (
              <Text style={s.truncated}>Preview truncated by the desktop file-size limit.</Text>
            )}
            <Text style={s.code} selectable>{fileContent?.content ?? (loading ? '' : 'No content')}</Text>
          </ScrollView>
        ) : (
          <>
            <View style={s.pathRow}>
              <TouchableOpacity onPress={() => onNavigate('.')} accessibilityRole="button">
                <Text style={s.rootButton}>root</Text>
              </TouchableOpacity>
              <Text style={s.path} numberOfLines={1}>/{currentPath === '.' ? '' : currentPath}</Text>
            </View>
            <ScrollView style={s.list} contentContainerStyle={s.listContent}>
              {currentPath !== '.' && (
                <EntryRow
                  name=".."
                  type="directory"
                  onPress={() => onNavigate(parentPath(currentPath))}
                />
              )}
              {!loading && entries.length === 0 && <Text style={s.empty}>Empty directory</Text>}
              {entries.map(entry => (
                <EntryRow
                  key={`${entry.type}:${entry.name}`}
                  name={entry.name}
                  type={entry.type}
                  size={entry.size}
                  viewable={entry.type === 'directory' || isViewableFile(entry.name)}
                  onPress={() => {
                    const path = childPath(currentPath, entry.name);
                    if (entry.type === 'directory') onNavigate(path);
                    else if (isViewableFile(entry.name)) onOpenFile(path);
                  }}
                />
              ))}
            </ScrollView>
          </>
        )}
      </View>
      </View>
    </Modal>
  );
}

function EntryRow({ name, type, size, viewable = true, onPress }) {
  const directory = type === 'directory';
  return (
    <TouchableOpacity
      style={s.entry}
      onPress={viewable ? onPress : undefined}
      disabled={!viewable}
      accessibilityRole="button"
      accessibilityLabel={`${directory ? 'Folder' : 'File'} ${name}`}
      accessibilityState={{ disabled: !viewable }}
    >
      <Text style={s.entryIcon}>{directory ? 'DIR' : 'FILE'}</Text>
      <Text style={[s.entryName, !viewable && s.disabled]} numberOfLines={2}>{name}</Text>
      {!directory && <Text style={s.entrySize}>{formatSize(size)}</Text>}
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  container: {
    minHeight: 240,
    maxHeight: '45%',
    backgroundColor: '#0d1117',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: 'hidden',
  },
  header: {
    height: 56,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#30363d',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headerButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  headerAction: { color: '#58a6ff', fontSize: 13, fontWeight: '700' },
  title: { color: '#f0f6fc', fontSize: 14, fontWeight: '700', flex: 1, textAlign: 'center', marginHorizontal: 4 },
  minimizeButton: {
    minWidth: 44,
    minHeight: 44,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: '#484f58',
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  minimizeText: { color: '#f0f6fc', fontSize: 10, fontWeight: '700' },
  disabled: { opacity: 0.45 },
  loading: { marginVertical: 8 },
  error: { color: '#ff7b72', backgroundColor: '#2d1518', padding: 10, fontSize: 12 },
  pathRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, backgroundColor: '#161b22' },
  rootButton: { color: '#58a6ff', fontWeight: '700' },
  path: { color: '#8b949e', marginLeft: 4, flex: 1, fontFamily: 'monospace', fontSize: 12 },
  list: { flex: 1 },
  listContent: { padding: 10 },
  entry: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#30363d',
    paddingHorizontal: 6,
    paddingVertical: 8,
  },
  entryIcon: { color: '#8b949e', fontSize: 10, fontWeight: '800', width: 38 },
  entryName: { color: '#cdd9e5', flex: 1, fontSize: 14 },
  entrySize: { color: '#768390', fontSize: 11, marginLeft: 8 },
  empty: { color: '#768390', textAlign: 'center', padding: 28 },
  preview: { flex: 1 },
  previewContent: { padding: 14 },
  truncated: { color: '#d29922', backgroundColor: '#2d2414', padding: 9, marginBottom: 10, borderRadius: 6 },
  code: { color: '#cdd9e5', fontFamily: 'monospace', fontSize: 12, lineHeight: 18 },
});
