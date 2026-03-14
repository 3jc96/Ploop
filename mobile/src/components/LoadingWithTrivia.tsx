/**
 * Fun loading state: colorful emoji, rotating message, bathroom trivia, and animated bar.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { getLoadingMessage, getRandomTrivia, type LoadingContext } from '../utils/engagement';

interface LoadingWithTriviaProps {
  context?: LoadingContext;
  message?: string;
  emoji?: string;
  showTrivia?: boolean;
  style?: object;
}

const TRIVIA_DELAY_MS = 800;

export function LoadingWithTrivia({
  context = 'generic',
  message: overrideMessage,
  emoji: overrideEmoji,
  showTrivia = true,
  style,
}: LoadingWithTriviaProps) {
  const [msg] = useState(() => getLoadingMessage(context));
  const [trivia, setTrivia] = useState<string | null>(null);
  const barAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!showTrivia) return;
    const t = setTimeout(() => setTrivia(getRandomTrivia()), TRIVIA_DELAY_MS);
    return () => clearTimeout(t);
  }, [showTrivia]);

  // Use opacity pulse with native driver (width animation blocks JS thread)
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(barAnim, {
          toValue: 0.4,
          duration: 600,
          useNativeDriver: true,
        }),
        Animated.timing(barAnim, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [barAnim]);

  const message = overrideMessage ?? msg.text;
  const emoji = overrideEmoji ?? msg.emoji;

  const barOpacity = barAnim;

  return (
    <View style={[styles.container, style]}>
      <Text style={styles.emoji}>{emoji}</Text>
      <Text style={styles.message}>{message}</Text>
      {trivia && (
        <View style={styles.triviaBox}>
          <Text style={styles.triviaLabel}>💡 Did you know?</Text>
          <Text style={styles.triviaText}>{trivia}</Text>
        </View>
      )}
      <View style={styles.barTrack}>
        <Animated.View style={[styles.barFill, { opacity: barOpacity }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  emoji: {
    fontSize: 56,
    marginBottom: 12,
  },
  message: {
    fontSize: 16,
    color: '#64748b',
    textAlign: 'center',
    marginBottom: 20,
  },
  triviaBox: {
    backgroundColor: '#f1f5f9',
    borderRadius: 12,
    padding: 14,
    marginBottom: 20,
    maxWidth: 320,
  },
  triviaLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6366f1',
    marginBottom: 6,
  },
  triviaText: {
    fontSize: 14,
    color: '#475569',
    lineHeight: 20,
  },
  barTrack: {
    width: 200,
    height: 6,
    backgroundColor: '#e2e8f0',
    borderRadius: 3,
    overflow: 'hidden',
  },
  barFill: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: '100%',
    backgroundColor: '#6366f1',
    borderRadius: 3,
  },
});
