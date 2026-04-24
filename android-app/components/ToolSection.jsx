import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
} from 'react-native';

// Collapsible tool-use section within a message.
// Props:
//   name    — tool name string
//   input   — tool input object or string
//   output  — tool result string (optional)
//   isError — boolean
export default function ToolSection({ name, input, output, isError }) {
  const [open, setOpen] = useState(false);

  const preview = buildPreview(name, input);
  const inputStr  = typeof input  === 'string' ? input  : JSON.stringify(input,  null, 2);
  const outputStr = typeof output === 'string' ? output : (output != null ? JSON.stringify(output, null, 2) : null);

  return (
    <View style={s.container}>
      <TouchableOpacity style={s.header} onPress={() => setOpen(v => !v)} activeOpacity={0.7}>
        <Text style={s.icon}>{isError ? '✗' : '⚙'}</Text>
        <Text style={s.name} numberOfLines={1}>{name}</Text>
        {!!preview && !open && (
          <Text style={s.preview} numberOfLines={1}>{preview}</Text>
        )}
        <Text style={s.chevron}>{open ? '▲' : '▼'}</Text>
      </TouchableOpacity>

      {open && (
        <View style={s.body}>
          <Text style={s.sectionLabel}>Input</Text>
          <Text style={s.code}>{inputStr}</Text>
          {outputStr != null && (
            <>
              <Text style={[s.sectionLabel, { marginTop: 8 }]}>Output</Text>
              <Text style={[s.code, isError && s.codeError]}>{outputStr}</Text>
            </>
          )}
        </View>
      )}
    </View>
  );
}

function buildPreview(name, input) {
  if (!input) return null;
  if (typeof input === 'string') return input.slice(0, 60);
  // Bash: show command
  if (input.command) return input.command.split('\n')[0].slice(0, 60);
  // File tools: show path
  if (input.path)    return input.path;
  if (input.file_path) return input.file_path;
  // Fallback: first string value
  const first = Object.values(input).find(v => typeof v === 'string');
  return first ? first.slice(0, 60) : null;
}

const s = StyleSheet.create({
  container: {
    backgroundColor: '#1c2128',
    borderRadius:    8,
    borderWidth:     1,
    borderColor:     '#30363d',
    marginVertical:  4,
    overflow:        'hidden',
  },
  header: {
    flexDirection:  'row',
    alignItems:     'center',
    padding:        10,
    gap:            6,
  },
  icon: {
    color:    '#768390',
    fontSize: 13,
  },
  name: {
    color:      '#cdd9e5',
    fontSize:   13,
    fontWeight: '500',
    flexShrink: 0,
  },
  preview: {
    flex:     1,
    color:    '#768390',
    fontSize: 12,
    fontStyle: 'italic',
  },
  chevron: {
    color:    '#444c56',
    fontSize: 10,
  },
  body: {
    borderTopWidth: 1,
    borderTopColor: '#30363d',
    padding:        10,
  },
  sectionLabel: {
    color:        '#768390',
    fontSize:     11,
    fontWeight:   '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom:  4,
  },
  code: {
    fontFamily:      'monospace',
    fontSize:        12,
    color:           '#adbac7',
    backgroundColor: '#0b0f14',
    borderRadius:    4,
    padding:         8,
  },
  codeError: {
    color: '#f85149',
  },
});
