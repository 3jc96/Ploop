/**
 * OnboardingModal — 5-slide first-launch tutorial.
 * Shown once on first load; dismissed state persisted via AsyncStorage.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'ploop.hasSeenOnboarding';
const { width: SCREEN_W } = Dimensions.get('window');

interface Slide {
  emoji: string;
  title: string;
  body: string;
}

const SLIDES: Slide[] = [
  {
    emoji: '🚽',
    title: 'Welcome to Ploop!',
    body: 'Find clean, safe public toilets near you — wherever you are in the world.',
  },
  {
    emoji: '🗺️',
    title: 'Explore the Map',
    body: 'Tap any marker to see ratings, amenities, opening hours, and directions to the nearest loo.',
  },
  {
    emoji: '⭐',
    title: 'Rate & Review',
    body: 'Visited a toilet? Help the community by rating cleanliness, smell, and facilities. Every review counts.',
  },
  {
    emoji: '➕',
    title: 'Add Missing Toilets',
    body: "Can't find a toilet on the map? Add it in seconds so others can benefit from your discovery.",
  },
  {
    emoji: '💩',
    title: 'Play the Poop Game',
    body: 'Catch the falling poop! Compete on the monthly leaderboard and claim bragging rights as the top Plooper.',
  },
];

export function OnboardingModal() {
  const [visible, setVisible] = useState(false);
  const [page, setPage] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((val) => {
      if (!val) setVisible(true);
    }).catch(() => {});
  }, []);

  const dismiss = () => {
    setVisible(false);
    AsyncStorage.setItem(STORAGE_KEY, 'true').catch(() => {});
  };

  const goTo = (index: number) => {
    scrollRef.current?.scrollTo({ x: index * SCREEN_W, animated: true });
    setPage(index);
  };

  const handleScroll = (e: any) => {
    const newPage = Math.round(e.nativeEvent.contentOffset.x / SCREEN_W);
    if (newPage !== page) setPage(newPage);
  };

  const isLast = page === SLIDES.length - 1;

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          {/* Slides */}
          <ScrollView
            ref={scrollRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            scrollEventThrottle={16}
            onScroll={handleScroll}
            style={styles.scroll}
          >
            {SLIDES.map((slide, i) => (
              <View key={i} style={styles.slide}>
                <Text style={styles.emoji}>{slide.emoji}</Text>
                <Text style={styles.title}>{slide.title}</Text>
                <Text style={styles.body}>{slide.body}</Text>
              </View>
            ))}
          </ScrollView>

          {/* Dot indicators */}
          <View style={styles.dots}>
            {SLIDES.map((_, i) => (
              <Pressable key={i} onPress={() => goTo(i)} hitSlop={8}>
                <View style={[styles.dot, i === page && styles.dotActive]} />
              </Pressable>
            ))}
          </View>

          {/* Navigation buttons */}
          <View style={styles.btnRow}>
            {!isLast && (
              <Pressable onPress={dismiss} style={styles.skipBtn}>
                <Text style={styles.skipText}>Skip</Text>
              </Pressable>
            )}
            <Pressable
              onPress={isLast ? dismiss : () => goTo(page + 1)}
              style={[styles.nextBtn, isLast && styles.nextBtnFull]}
            >
              <Text style={styles.nextText}>{isLast ? 'Get Started 🚀' : 'Next'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#fff',
    borderRadius: 24,
    overflow: 'hidden',
    paddingBottom: 24,
  },
  scroll: {
    width: SCREEN_W > 380 ? 380 : SCREEN_W - 48,
  },
  slide: {
    width: SCREEN_W > 380 ? 380 : SCREEN_W - 48,
    paddingHorizontal: 28,
    paddingTop: 40,
    paddingBottom: 16,
    alignItems: 'center',
  },
  emoji: {
    fontSize: 64,
    marginBottom: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0f172a',
    textAlign: 'center',
    marginBottom: 12,
  },
  body: {
    fontSize: 15,
    color: '#475569',
    textAlign: 'center',
    lineHeight: 22,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginTop: 24,
    marginBottom: 20,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#cbd5e1',
  },
  dotActive: {
    width: 22,
    backgroundColor: '#6366f1',
  },
  btnRow: {
    flexDirection: 'row',
    paddingHorizontal: 24,
    gap: 12,
  },
  skipBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
  },
  skipText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#64748b',
  },
  nextBtn: {
    flex: 2,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: '#6366f1',
    alignItems: 'center',
  },
  nextBtnFull: {
    flex: 1,
  },
  nextText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
});
