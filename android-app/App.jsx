import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated, PanResponder } from 'react-native';
import { NavigationContainer }        from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar }                  from 'expo-status-bar';
import * as Linking                   from 'expo-linking';
import * as Notifications             from 'expo-notifications';

import LoginScreen        from './screens/LoginScreen';
import SessionListScreen  from './screens/SessionListScreen';
import ChatScreen         from './screens/ChatScreen';
import SettingsScreen     from './screens/SettingsScreen';
import AutomationsScreen  from './screens/AutomationsScreen';
import SkillsScreen       from './screens/SkillsScreen';
import { getStoredJwt }  from './lib/auth';
import { configureNotificationChannels } from './lib/notifications';

// ── Foreground notification handler ───────────────────────────────────────────
// Show an in-app banner instead of the system alert; the banner component below
// handles display. We suppress the system alert when in-app.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: false,   // suppressed — we show our own banner
    shouldPlaySound: true,
    shouldSetBadge:  false,
  }),
});

const Stack  = createNativeStackNavigator();
const prefix = Linking.createURL('/');

const SCREEN_OPTIONS = {
  headerStyle:      { backgroundColor: '#0b0f14' },
  headerTintColor:  '#cdd9e5',
  headerTitleStyle: { fontSize: 16, fontWeight: '600' },
  contentStyle:     { backgroundColor: '#0b0f14' },
  animation:        'slide_from_right',
};

const LINKING = {
  prefixes: [prefix, 'agentchat://'],
  config: {
    screens: {
      Login:       'auth',
      SessionList: 'sessions',
      Chat:        'session/:sessionId',
      Automations: 'automations',
      Settings:    'settings',
    },
  },
};

// ── In-app notification banner ────────────────────────────────────────────────

function NotificationBanner({ notification, onDismiss, onPress }) {
  const opacity    = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-60)).current;
  const translateX = useRef(new Animated.Value(0)).current;

  // Swipe-to-dismiss
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 10 || g.dy < -10,
      onPanResponderMove: (_, g) => {
        if (g.dy < 0) translateY.setValue(g.dy);       // swipe up
        else translateX.setValue(g.dx);                  // swipe left/right
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy < -30 || Math.abs(g.dx) > 80) {
          dismiss();
        } else {
          Animated.parallel([
            Animated.spring(translateY, { toValue: 0, useNativeDriver: true }),
            Animated.spring(translateX, { toValue: 0, useNativeDriver: true }),
          ]).start();
        }
      },
    })
  ).current;

  useEffect(() => {
    if (!notification) return;
    translateX.setValue(0);
    // Slide in
    Animated.parallel([
      Animated.timing(opacity,    { toValue: 1, duration: 250, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]).start();
    // Auto-dismiss after 5s
    const timer = setTimeout(() => dismiss(), 5_000);
    return () => clearTimeout(timer);
  }, [notification]);

  function dismiss() {
    Animated.parallel([
      Animated.timing(opacity,    { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: -60, duration: 200, useNativeDriver: true }),
    ]).start(() => onDismiss());
  }

  if (!notification) return null;

  const { title, body, data } = notification.request.content;
  const sessionName = data?.session_name;
  const activityType = data?.activity_type; // 'generating', 'idle', 'rate_limit', etc.

  const activityIcon = activityType === 'generating' ? '●'
    : activityType === 'rate_limit' ? '⏳'
    : activityType === 'idle' ? '✓'
    : '💬';

  return (
    <Animated.View
      style={[bs.banner, { opacity, transform: [{ translateY }, { translateX }] }]}
      {...panResponder.panHandlers}
    >
      <TouchableOpacity style={bs.inner} onPress={() => { dismiss(); onPress(notification); }} activeOpacity={0.85}>
        <Text style={bs.activityIcon}>{activityIcon}</Text>
        <View style={bs.textCol}>
          {!!sessionName && <Text style={bs.sessionName} numberOfLines={1}>{sessionName}</Text>}
          {!!title && <Text style={bs.title} numberOfLines={1}>{title}</Text>}
          {!!body  && <Text style={bs.body}  numberOfLines={2}>{body}</Text>}
        </View>
        <TouchableOpacity onPress={dismiss} style={bs.closeBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={bs.closeX}>✕</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    </Animated.View>
  );
}

const bs = StyleSheet.create({
  banner: {
    position:        'absolute',
    top:             48,
    left:            12,
    right:           12,
    zIndex:          999,
    backgroundColor: '#1c2128',
    borderRadius:    12,
    borderWidth:     1,
    borderColor:     '#58a6ff',
    shadowColor:     '#000',
    shadowOffset:    { width: 0, height: 4 },
    shadowOpacity:   0.4,
    shadowRadius:    8,
    elevation:       8,
  },
  inner: {
    flexDirection: 'row',
    alignItems:    'center',
    padding:       12,
  },
  activityIcon: {
    fontSize:    16,
    color:       '#58a6ff',
    marginRight: 10,
  },
  textCol: {
    flex: 1,
    gap:  2,
  },
  sessionName: {
    color:      '#58a6ff',
    fontSize:   11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  title: {
    color:      '#cdd9e5',
    fontWeight: '600',
    fontSize:   14,
  },
  body: {
    color:    '#768390',
    fontSize: 13,
  },
  closeBtn: {
    paddingLeft: 10,
  },
  closeX: {
    color:    '#444c56',
    fontSize: 14,
  },
});

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [initialRoute, setInitialRoute] = useState(null);
  const [banner,       setBanner]       = useState(null);
  const navigationRef = React.useRef(null);

  // Configure notification channels on startup
  useEffect(() => { configureNotificationChannels(); }, []);

  // Determine start screen based on stored JWT validity
  useEffect(() => {
    getStoredJwt().then(token => {
      setInitialRoute(token ? 'SessionList' : 'Login');
    });
  }, []);

  // Foreground notification — show in-app banner
  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener(notification => {
      setBanner(notification);
    });
    return () => sub.remove();
  }, []);

  // Background / killed — notification tap → navigate to session
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(response => {
      const data = response.notification.request.content.data;
      navigateToSession(data);
    });
    return () => sub.remove();
  }, []);

  function navigateToSession(data) {
    if (data?.session_id && navigationRef.current) {
      navigationRef.current.navigate('Chat', {
        sessionId: data.session_id,
        title:     data.session_name || 'Chat',
      });
    }
  }

  if (!initialRoute) return null;

  return (
    <View style={{ flex: 1 }}>
      <NavigationContainer ref={navigationRef} linking={LINKING}>
        <StatusBar style="light" />
        <Stack.Navigator initialRouteName={initialRoute} screenOptions={SCREEN_OPTIONS}>
          <Stack.Screen
            name="Login"
            component={LoginScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="SessionList"
            component={SessionListScreen}
            options={({ navigation }) => ({
              title:       'Agent Chat',
              headerLeft:  () => null,
              headerRight: () => (
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <TouchableOpacity
                    onPress={() => navigation.navigate('Settings')}
                    style={{ marginRight: 4, padding: 8 }}
                  >
                    <Text style={{ color: '#cdd9e5', fontSize: 22 }}>⚙</Text>
                  </TouchableOpacity>
                </View>
              ),
            })}
          />
          <Stack.Screen
            name="Chat"
            component={ChatScreen}
          />
          <Stack.Screen
            name="Automations"
            component={AutomationsScreen}
            options={{ title: 'Automations' }}
          />
          <Stack.Screen
            name="Skills"
            component={SkillsScreen}
            options={{ title: 'Skills' }}
          />
          <Stack.Screen
            name="Settings"
            component={SettingsScreen}
            options={{ title: 'Settings' }}
          />
        </Stack.Navigator>
      </NavigationContainer>

      {/* Foreground notification banner — rendered outside NavigationContainer so it floats above all screens */}
      <NotificationBanner
        notification={banner}
        onDismiss={() => setBanner(null)}
        onPress={n => navigateToSession(n.request.content.data)}
      />
    </View>
  );
}
