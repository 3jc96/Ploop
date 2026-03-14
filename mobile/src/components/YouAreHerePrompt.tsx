/**
 * "You're here" and "Post-use" contextual prompts when user is near or has left a viewed toilet.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useYouAreHere, distanceMeters, type LastViewedToilet } from '../context/YouAreHereContext';

const NEAR_M = 40;
const WAS_NEAR_M = 50;
const LEFT_M = 100;

type UserCoords = { latitude: number; longitude: number };

export function useYouAreHerePrompt(userCoords: UserCoords | null) {
  const ctx = useYouAreHere();
  const [showYouAreHere, setShowYouAreHere] = useState(false);
  const [showPostUse, setShowPostUse] = useState(false);
  const wasNearRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!ctx || !userCoords || !ctx.lastViewedToilet) {
      setShowYouAreHere(false);
      setShowPostUse(false);
      return;
    }

    const t = ctx.lastViewedToilet;
    const dist = distanceMeters(
      userCoords.latitude,
      userCoords.longitude,
      t.latitude,
      t.longitude
    );

    if (dist < WAS_NEAR_M) {
      wasNearRef.current.add(t.id);
    }

    if (dist < NEAR_M && !ctx.dismissedYouAreHere.has(t.id)) {
      setShowYouAreHere(true);
      setShowPostUse(false);
      return;
    }

    if (dist > LEFT_M && wasNearRef.current.has(t.id) && !ctx.dismissedPostUse.has(t.id)) {
      setShowYouAreHere(false);
      setShowPostUse(true);
      return;
    }

    setShowYouAreHere(false);
    setShowPostUse(false);
  }, [userCoords, ctx?.lastViewedToilet, ctx?.dismissedYouAreHere, ctx?.dismissedPostUse]);

  return { showYouAreHere, showPostUse, toilet: ctx?.lastViewedToilet ?? null, ctx: ctx ?? null };
}

export function YouAreHerePromptBanner({
  showYouAreHere,
  showPostUse,
  toilet,
  ctx,
  onRateNow,
}: {
  showYouAreHere: boolean;
  showPostUse: boolean;
  toilet: LastViewedToilet | null;
  ctx: ReturnType<typeof useYouAreHere> | null;
  onRateNow: () => void;
}) {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  if (!toilet || !ctx) return null;
  if (!showYouAreHere && !showPostUse) return null;

  const handleRateNow = () => {
    onRateNow();
    (navigation as any).navigate('ToiletDetails', { toiletId: toilet.id });
    if (showYouAreHere) ctx.dismissYouAreHere(toilet.id);
    if (showPostUse) ctx.dismissPostUse(toilet.id);
  };

  const handleLater = () => {
    if (showYouAreHere) ctx.dismissYouAreHere(toilet.id);
    if (showPostUse) ctx.dismissPostUse(toilet.id);
  };

  const title = showYouAreHere ? "Looks like you're here! 🎯" : 'Just used a toilet?';
  const subtitle = showYouAreHere
    ? 'How was it? Quick rating?'
    : 'Drop a quick rating — it helps others.';

  return (
    <View style={[styles.banner, styles.bannerAbsolute, { top: Math.max(insets.top, 8) + 60 }]}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
      <View style={styles.actions}>
        <Pressable style={({ pressed }) => [styles.primaryBtn, pressed && styles.btnPressed]} onPress={handleRateNow}>
          <Text style={styles.primaryBtnText}>Rate now</Text>
        </Pressable>
        <Pressable style={({ pressed }) => [styles.secondaryBtn, pressed && styles.btnPressed]} onPress={handleLater}>
          <Text style={styles.secondaryBtnText}>Maybe later</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bannerAbsolute: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 100,
  },
  banner: {
    backgroundColor: '#6366f1',
    borderRadius: 12,
    padding: 16,
    margin: 12,
    marginBottom: 8,
  },
  title: { fontSize: 16, fontWeight: '700', color: '#fff', marginBottom: 4 },
  subtitle: { fontSize: 14, color: 'rgba(255,255,255,0.9)', marginBottom: 12 },
  actions: { flexDirection: 'row', gap: 10 },
  primaryBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#fff',
    alignItems: 'center',
  },
  primaryBtnText: { color: '#6366f1', fontWeight: '700', fontSize: 14 },
  secondaryBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
  },
  secondaryBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  btnPressed: { opacity: 0.9 },
});
