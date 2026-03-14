/**
 * Compact loading banner: emoji, rotating message, toilet trivia quiz, and pulse animation.
 * For use in MapScreen and other overlay loading states.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, TouchableOpacity } from 'react-native';
import { getLoadingMessage, getTriviaQuestionExcluding, hapticButton, type LoadingContext, type TriviaQuestion } from '../utils/engagement';

interface LoadingBannerWithTriviaProps {
  context?: LoadingContext;
  onRetry?: () => void;
}

const TRIVIA_DELAY_MS = 800;
const MESSAGE_ROTATE_MS = 3500;
const NEXT_QUESTION_DELAY_MS = 1500;

export function LoadingBannerWithTrivia({
  context = 'location',
  onRetry,
}: LoadingBannerWithTriviaProps) {
  const [msg, setMsg] = useState(() => getLoadingMessage(context));
  const [current, setCurrent] = useState<{ question: TriviaQuestion; index: number } | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [seenIndices, setSeenIndices] = useState<Set<number>>(() => new Set());
  const nextTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const emojiBounce = useRef(new Animated.Value(1)).current;

  // Load first question after delay
  useEffect(() => {
    const t = setTimeout(() => {
      const result = getTriviaQuestionExcluding(new Set());
      setCurrent(result);
    }, TRIVIA_DELAY_MS);
    return () => clearTimeout(t);
  }, []);

  // Rotate messages
  useEffect(() => {
    const pool = context === 'location'
      ? [
          { emoji: '📍', text: 'Getting your coordinates…' },
          { emoji: '🧭', text: 'Pinpointing your position…' },
          { emoji: '🌍', text: 'Zeroing in…' },
          { emoji: '📡', text: 'Finding you…' },
          { emoji: '🚀', text: 'Almost there…' },
        ]
      : [
          { emoji: '🚽', text: 'Finding the nearest throne…' },
          { emoji: '🌀', text: 'Searching for relief…' },
          { emoji: '📍', text: 'Almost there…' },
          { emoji: '🧭', text: 'Zeroing in on bathrooms…' },
        ];
    const id = setInterval(() => {
      setMsg(pool[Math.floor(Math.random() * pool.length)]);
    }, MESSAGE_ROTATE_MS);
    return () => clearInterval(id);
  }, [context]);

  const handleAnswer = (index: number) => {
    if (selectedIndex !== null || !current) return;
    hapticButton();
    setSelectedIndex(index);
    if (index === current.question.correctIndex) {
      setScore((s) => s + 1);
    }
    const nextSeen = new Set(seenIndices);
    nextSeen.add(current.index);
    setSeenIndices(nextSeen);
    if (nextTimeoutRef.current) clearTimeout(nextTimeoutRef.current);
    nextTimeoutRef.current = setTimeout(() => {
      let next = getTriviaQuestionExcluding(nextSeen);
      if (!next) {
        setSeenIndices(new Set());
        next = getTriviaQuestionExcluding(new Set());
      }
      if (next) setCurrent(next);
      setSelectedIndex(null);
      nextTimeoutRef.current = null;
    }, NEXT_QUESTION_DELAY_MS);
  };

  useEffect(() => () => {
    if (nextTimeoutRef.current) clearTimeout(nextTimeoutRef.current);
  }, []);

  // Pulse animation on progress bar
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 0.5,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [pulseAnim]);

  // Emoji bounce
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(emojiBounce, {
          toValue: 1.15,
          duration: 400,
          useNativeDriver: true,
        }),
        Animated.timing(emojiBounce, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [emojiBounce]);

  const question = current?.question;
  const isAnswered = selectedIndex !== null;
  const getOptionStyle = (index: number) => {
    if (!isAnswered) return styles.option;
    const correct = question?.correctIndex === index;
    const chosen = selectedIndex === index;
    if (chosen && correct) return [styles.option, styles.optionCorrect];
    if (chosen && !correct) return [styles.option, styles.optionWrong];
    if (correct) return [styles.option, styles.optionReveal];
    return [styles.option, styles.optionDisabled];
  };

  return (
    <View style={styles.banner}>
      <Animated.Text style={[styles.emoji, { transform: [{ scale: emojiBounce }] }]}>
        {msg.emoji}
      </Animated.Text>
      <Text style={styles.message}>{msg.text}</Text>
      {question && (
        <View style={styles.triviaBox}>
          <View style={styles.triviaHeader}>
            <Text style={styles.triviaLabel}>🚽 Toilet Trivia</Text>
            <Text style={styles.scoreText}>{score} ✓</Text>
          </View>
          <Text style={styles.triviaQuestion}>{question.question}</Text>
          {question.options.map((opt, i) => (
            <TouchableOpacity
              key={i}
              style={getOptionStyle(i)}
              onPress={() => handleAnswer(i)}
              disabled={isAnswered}
              activeOpacity={isAnswered ? 1 : 0.7}
            >
              <Text style={styles.optionText}>{opt}</Text>
              {isAnswered && question.correctIndex === i && (
                <Text style={styles.optionIcon}>✓</Text>
              )}
              {isAnswered && selectedIndex === i && question.correctIndex !== i && (
                <Text style={styles.optionIconWrong}>✗</Text>
              )}
            </TouchableOpacity>
          ))}
        </View>
      )}
      <View style={styles.barTrack}>
        <Animated.View style={[styles.barFill, { opacity: pulseAnim }]} />
      </View>
      {onRetry && (
        <TouchableOpacity style={styles.retryButton} onPress={onRetry}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
  },
  emoji: {
    fontSize: 48,
    marginBottom: 8,
  },
  message: {
    fontSize: 15,
    color: '#475569',
    fontWeight: '500',
    textAlign: 'center',
    marginBottom: 12,
  },
  triviaBox: {
    backgroundColor: '#f1f5f9',
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
    alignSelf: 'stretch',
  },
  triviaHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  triviaLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6366f1',
  },
  scoreText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#22c55e',
  },
  triviaQuestion: {
    fontSize: 13,
    color: '#334155',
    fontWeight: '600',
    marginBottom: 10,
    lineHeight: 18,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 8,
    borderWidth: 2,
    borderColor: '#e2e8f0',
  },
  optionCorrect: {
    borderColor: '#22c55e',
    backgroundColor: '#dcfce7',
  },
  optionWrong: {
    borderColor: '#ef4444',
    backgroundColor: '#fee2e2',
  },
  optionReveal: {
    borderColor: '#22c55e',
    backgroundColor: '#dcfce7',
  },
  optionDisabled: {
    opacity: 0.7,
  },
  optionText: {
    fontSize: 14,
    color: '#334155',
    flex: 1,
  },
  optionIcon: {
    fontSize: 18,
    color: '#22c55e',
    fontWeight: '700',
    marginLeft: 8,
  },
  optionIconWrong: {
    fontSize: 18,
    color: '#ef4444',
    fontWeight: '700',
    marginLeft: 8,
  },
  barTrack: {
    width: 180,
    height: 5,
    backgroundColor: '#e2e8f0',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 12,
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
  retryButton: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    backgroundColor: '#2196F3',
    borderRadius: 10,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});
