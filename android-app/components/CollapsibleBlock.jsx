import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

// Wraps children and collapses if rendered height exceeds maxHeight.
// Shows a fade overlay and "Show more" / "Show less" toggle.
export default function CollapsibleBlock({ maxHeight = 240, children }) {
  const [fullHeight, setFullHeight] = useState(0);
  const [collapsed, setCollapsed] = useState(true);

  const needsCollapse = fullHeight > maxHeight;

  const onLayout = useCallback((e) => {
    const h = e.nativeEvent.layout.height;
    if (h > 0 && fullHeight === 0) {
      setFullHeight(h);
    }
  }, [fullHeight]);

  // First render: measure full height (no clipping)
  if (fullHeight === 0) {
    return (
      <View onLayout={onLayout}>
        {children}
      </View>
    );
  }

  if (!needsCollapse) {
    return <View>{children}</View>;
  }

  return (
    <View>
      <View style={collapsed ? { maxHeight, overflow: 'hidden' } : undefined}>
        {children}
      </View>
      {collapsed && (
        <View style={s.fadeContainer}>
          <View style={s.fadeTop} />
          <View style={s.fadeBottom} />
        </View>
      )}
      <TouchableOpacity
        style={s.toggleBtn}
        onPress={() => setCollapsed(v => !v)}
        activeOpacity={0.7}
      >
        <Text style={s.toggleText}>
          {collapsed ? '▼ Show more' : '▲ Show less'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  fadeContainer: {
    height:     40,
    marginTop: -40,
  },
  fadeTop: {
    flex:            1,
    backgroundColor: 'rgba(22, 27, 34, 0.3)',
  },
  fadeBottom: {
    flex:            1,
    backgroundColor: 'rgba(22, 27, 34, 0.85)',
  },
  toggleBtn: {
    paddingVertical:   6,
    paddingHorizontal: 4,
    alignItems:        'center',
  },
  toggleText: {
    color:      '#58a6ff',
    fontSize:   12,
    fontWeight: '600',
  },
});
