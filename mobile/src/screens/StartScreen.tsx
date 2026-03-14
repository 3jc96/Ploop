/**
 * Minimal first screen: no expo-auth-session or other optional native modules.
 * Ensures the app opens even when LoginScreen fails to load (e.g. missing ExpoWebBrowser).
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Platform, Animated } from 'react-native';
import { useNavigation, CommonActions } from '@react-navigation/native';
import { hapticButton, getEmojiTapMessage } from '../utils/engagement';

const TAP_RESET_MS = 2000;

export default function StartScreen() {
  const navigation = useNavigation();
  const [tapCount, setTapCount] = useState(0);
  const [tapMessage, setTapMessage] = useState<string | null>(null);
  const tapTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scaleAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    return () => {
      if (tapTimeoutRef.current) clearTimeout(tapTimeoutRef.current);
    };
  }, []);

  const onEmojiPress = () => {
    hapticButton().catch(() => {});
    const next = tapCount + 1;
    setTapCount(next);
    if (tapTimeoutRef.current) clearTimeout(tapTimeoutRef.current);
    tapTimeoutRef.current = setTimeout(() => {
      setTapCount(0);
      setTapMessage(null);
      tapTimeoutRef.current = null;
    }, TAP_RESET_MS);

    const msg = getEmojiTapMessage(next);
    if (msg) setTapMessage(msg);

    Animated.sequence([
      Animated.timing(scaleAnim, { toValue: 0.9, duration: 80, useNativeDriver: true }),
      Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, friction: 3 }),
    ]).start();
  };

  const goToAdmin = () => {
    hapticButton().catch(() => {});
    (navigation as any).navigate('Admin');
  };

  const goToMap = () => {
    hapticButton().catch(() => {});
    (navigation as any).dispatch(
      CommonActions.reset({ index: 0, routes: [{ name: 'Map' }] })
    );
  };

  const goToLogin = () => {
    hapticButton().catch(() => {});
    (navigation as any).navigate('Login');
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Pressable onPress={onEmojiPress} style={styles.emojiWrap}>
          <Animated.Text style={[styles.emoji, { transform: [{ scale: scaleAnim }] }]}>🚽</Animated.Text>
        </Pressable>
        {tapMessage ? <Text style={styles.tapMessage}>{tapMessage}</Text> : null}
        <Text style={styles.title}>Ploop</Text>
        <Text style={styles.subtitle}>Find toilets near you</Text>
        <Text style={styles.tagline}>Never get caught short.</Text>

        <Pressable
          style={({ pressed }) => [styles.button, styles.primaryButton, pressed && styles.buttonPressed]}
          onPress={goToMap}
        >
          <Text style={styles.primaryButtonText}>Continue as guest</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.button, styles.secondaryButton, pressed && styles.buttonPressed]}
          onPress={goToLogin}
        >
          <Text style={styles.secondaryButtonText}>Create account or sign in</Text>
        </Pressable>
        <Text style={styles.hint}>Use Google or Apple to save & edit your reviews</Text>
        {Platform.OS === 'web' && (
          <Pressable
            style={({ pressed }) => [styles.adminLink, pressed && styles.adminLinkPressed]}
            onPress={goToAdmin}
          >
            <Text style={styles.adminLinkText}>Admin →</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
    backgroundColor: '#f5f5f5',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 28,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  emojiWrap: { marginBottom: 4 },
  emoji: {
    fontSize: 48,
    textAlign: 'center',
  },
  tapMessage: {
    fontSize: 13,
    color: '#6366f1',
    fontStyle: 'italic',
    textAlign: 'center',
    marginBottom: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#333',
    textAlign: 'center',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginBottom: 4,
  },
  tagline: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
    marginBottom: 28,
    fontStyle: 'italic',
  },
  button: {
    height: 50,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  buttonPressed: {
    opacity: 0.9,
  },
  primaryButton: {
    backgroundColor: '#2196F3',
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#2196F3',
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#2196F3',
  },
  hint: {
    fontSize: 12,
    color: '#999',
    textAlign: 'center',
    marginTop: 8,
  },
  adminLink: {
    marginTop: 20,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignSelf: 'center',
  },
  adminLinkPressed: {
    opacity: 0.7,
  },
  adminLinkText: {
    fontSize: 14,
    color: '#6366f1',
    fontWeight: '600',
  },
});
