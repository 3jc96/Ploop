import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import * as Location from 'expo-location';
import { useNavigation, useRoute } from '@react-navigation/native';
import { api, Toilet } from '../services/api';
import { hapticSuccess } from '../utils/engagement';
import { playFlushSound } from '../utils/flushSound';
import { openInMapsWithChoice } from '../utils/maps';

const RATING_SCORES = [1, 2, 3, 4, 5] as const;

const SOS_OPTIONS = [
  { id: 'toilet_paper', label: 'Toilet paper', emoji: '🧻', messageText: 'I need toilet paper' },
  { id: 'no_soap', label: 'No soap', emoji: '🧼', messageText: "There's no soap" },
  { id: 'flush', label: 'Flush not working', emoji: '🚿', messageText: "The flush isn't working" },
  { id: 'clog', label: 'Clogged', emoji: '🪠', messageText: 'The toilet is clogged' },
  { id: 'broken_tap', label: 'Broken tap', emoji: '🚰', messageText: 'The tap is broken' },
] as const;

export default function ToiletDetailsScreenWeb() {
  const route = useRoute();
  const navigation = useNavigation();
  const { toiletId } = route.params as { toiletId: string };
  const [toilet, setToilet] = useState<Toilet | null>(null);
  const [loading, setLoading] = useState(true);
  const [reviewCleanliness, setReviewCleanliness] = useState<number | null>(null);
  const [reviewSmell, setReviewSmell] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [reviewSuccess, setReviewSuccess] = useState(false);
  const [sosModalOpen, setSosModalOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getToilet(toiletId);
      setToilet(data);
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.error || e?.message || 'Failed to load toilet.');
    } finally {
      setLoading(false);
    }
  }, [toiletId]);

  const submitReview = useCallback(async () => {
    if (!reviewCleanliness && !reviewSmell) {
      Alert.alert('Error', 'Please rate at least cleanliness or smell.');
      return;
    }
    setSubmitting(true);
    try {
      await api.addReview(toiletId, {
        cleanliness_score: reviewCleanliness ?? undefined,
        smell_score: reviewSmell ?? undefined,
      });
      await api.bumpLocalMetric('reviews', 1);
      await hapticSuccess();
      playFlushSound();
      setReviewCleanliness(null);
      setReviewSmell(null);
      setReviewSuccess(true);
      await load();
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.error || e?.message || 'Failed to submit review.');
    } finally {
      setSubmitting(false);
    }
  }, [toiletId, reviewCleanliness, reviewSmell, load]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setReviewSuccess(false);
  }, [toiletId]);

  const openMaps = useCallback(() => {
    if (!toilet) return;
    openInMapsWithChoice(toilet.latitude, toilet.longitude, toilet.name);
  }, [toilet]);

  const shareSosWithFriend = useCallback(
    async (needId: string) => {
      if (!toilet) return;
      const option = SOS_OPTIONS.find((o) => o.id === needId);
      const situationText = option?.messageText ?? option?.label ?? needId;
      // Prefer sender's current GPS for accuracy; fall back to toilet location
      let lat = toilet.latitude;
      let lng = toilet.longitude;
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status === 'granted') {
          const pos = await Location.getCurrentPositionAsync();
          lat = pos.coords.latitude;
          lng = pos.coords.longitude;
        }
      } catch {
        // Use toilet coords
      }
      const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
      const location = toilet.address || toilet.name || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      const message = `Please help! ${situationText} at ${toilet.name}, ${location}. My location: ${mapsUrl}`;
      try {
        await Share.share({ message, title: 'Ploop SOS – Need help' });
        api.track('sos_shared', { toiletId: toilet.id, needType: needId });
        setSosModalOpen(false);
      } catch {
        // User cancelled or share not supported
      }
    },
    [toilet]
  );

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2196F3" />
        <Text style={styles.loadingText}>Loading…</Text>
      </View>
    );
  }

  if (!toilet) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Toilet not found</Text>
        <Pressable
          onPress={() => (navigation as any).goBack?.()}
          style={({ pressed }) => [styles.secondaryBtn, pressed && styles.btnPressed]}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Text style={styles.secondaryBtnText}>Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{toilet.name || 'Untitled Toilet'}</Text>
          {!!toilet.address && <Text style={styles.address}>{toilet.address}</Text>}
          <Pressable
            onPress={() => setSosModalOpen(true)}
            style={({ pressed }) => [styles.sosBtn, pressed && styles.btnPressed]}
            accessibilityRole="button"
            accessibilityLabel="Need help? Notify a friend"
          >
            <Text style={styles.sosBtnEmoji}>🆘</Text>
            <Text style={styles.sosBtnText}>Need help? Notify a friend</Text>
          </Pressable>
        </View>
        <Pressable
          onPress={openMaps}
          style={({ pressed }) => [styles.primaryBtn, pressed && styles.btnPressed]}
          accessibilityRole="button"
          accessibilityLabel="Open in Google Maps"
        >
          <Text style={styles.primaryBtnText}>Open Maps</Text>
        </Pressable>
      </View>

      <Modal visible={sosModalOpen} transparent animationType="fade" onRequestClose={() => setSosModalOpen(false)}>
        <Pressable style={styles.sosBackdrop} onPress={() => setSosModalOpen(false)} />
        <View style={styles.sosModalContent}>
          <View style={styles.sosModalInner}>
            <Text style={styles.sosModalTitle}>What do you need?</Text>
            <Text style={styles.sosModalSubtitle}>Share with a friend so they can help</Text>
            {SOS_OPTIONS.map((opt) => (
              <Pressable
                key={opt.id}
                onPress={() => shareSosWithFriend(opt.id)}
                style={({ pressed }) => [styles.sosOption, pressed && styles.btnPressed]}
              >
                <Text style={styles.sosOptionEmoji}>{opt.emoji}</Text>
                <Text style={styles.sosOptionLabel}>{opt.label}</Text>
              </Pressable>
            ))}
            <Pressable onPress={() => setSosModalOpen(false)} style={({ pressed }) => [styles.sosCancel, pressed && styles.btnPressed]}>
              <Text style={styles.sosCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <View style={styles.section} accessibilityRole="region" accessibilityLabel="Add your review">
        <Text style={styles.sectionTitle}>Add your review</Text>
        <Text style={styles.reviewHint}>Rate at least one to submit.</Text>
        <View style={styles.ratingRow}>
          <Text style={styles.ratingLabel}>Cleanliness</Text>
          <View style={styles.ratingButtons}>
            {RATING_SCORES.map((score) => (
              <Pressable
                key={score}
                onPress={() => setReviewCleanliness(score)}
                style={[
                  styles.ratingBtn,
                  reviewCleanliness === score && styles.ratingBtnActive,
                ]}
              >
                <Text style={[styles.ratingBtnText, reviewCleanliness === score && styles.ratingBtnTextActive]}>
                  {score}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
        <View style={styles.ratingRow}>
          <Text style={styles.ratingLabel}>Smell</Text>
          <View style={styles.ratingButtons}>
            {RATING_SCORES.map((score) => (
              <Pressable
                key={score}
                onPress={() => setReviewSmell(score)}
                style={[
                  styles.ratingBtn,
                  reviewSmell === score && styles.ratingBtnActive,
                ]}
              >
                <Text style={[styles.ratingBtnText, reviewSmell === score && styles.ratingBtnTextActive]}>
                  {score}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
        <Pressable
          onPress={submitReview}
          disabled={submitting || (reviewCleanliness == null && reviewSmell == null)}
          style={({ pressed }) => [
            styles.submitReviewBtn,
            (submitting || (reviewCleanliness == null && reviewSmell == null)) && styles.submitReviewBtnDisabled,
            pressed && !submitting && (reviewCleanliness != null || reviewSmell != null) && styles.btnPressed,
          ]}
        >
          {submitting ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={styles.submitReviewBtnText}>Submit Review</Text>
          )}
        </Pressable>
        {reviewSuccess && (
          <Text style={styles.reviewSuccessText}>Thanks! Your review was submitted.</Text>
        )}
      </View>

      {(toilet.total_reviews ?? 0) === 0 && (
        <View style={styles.importedHintBanner}>
          <Text style={styles.importedHintText}>
            This toilet was imported from public data and has no reviews yet. Please leave a review after your visit to help others!
          </Text>
        </View>
      )}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Scores</Text>
        <View style={styles.rowWrap}>
          <Pill label={`Cleanliness: ${formatScore(toilet.cleanliness_score)}`} />
          <Pill label={`Smell: ${formatScore(toilet.smell_score)}`} />
          <Pill label={`Reviews: ${toilet.total_reviews ?? 0}`} muted />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Amenities</Text>
        <View style={styles.rowWrap}>
          <Pill label={toilet.has_toilet_paper ? 'Toilet paper' : 'No toilet paper'} muted={!toilet.has_toilet_paper} />
          <Pill label={toilet.has_bidet ? 'Bidet' : 'No bidet'} muted={!toilet.has_bidet} />
          <Pill label={toilet.has_seat_warmer ? 'Seat warmer' : 'No seat warmer'} muted={!toilet.has_seat_warmer} />
          <Pill label={toilet.has_hand_soap ? 'Hand soap' : 'No hand soap'} muted={!toilet.has_hand_soap} />
          <Pill label={toilet.has_baby_changing ? 'Baby changing' : 'No baby changing'} muted={!toilet.has_baby_changing} />
          <Pill label={toilet.has_family_room ? 'Family room' : 'No family room'} muted={!toilet.has_family_room} />
          <Pill label={toilet.wheelchair_accessible ? '♿ Accessible' : 'Not accessible'} muted={!toilet.wheelchair_accessible} />
          <Pill label={toilet.pay_to_enter ? 'Paid entry' : 'Free entry'} muted={toilet.pay_to_enter} />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Details</Text>
        <View style={styles.rowWrap}>
          <Pill label={`Type: ${toilet.toilet_type || '—'}`} muted />
          <Pill label={`Stalls: ${toilet.number_of_stalls ?? '—'}`} muted />
        </View>
      </View>

      <View style={styles.footerRow}>
        <Pressable
          onPress={() => load()}
          style={({ pressed }) => [styles.secondaryBtn, pressed && styles.btnPressed]}
          accessibilityRole="button"
          accessibilityLabel="Reload toilet details"
        >
          <Text style={styles.secondaryBtnText}>Reload</Text>
        </Pressable>
        <Pressable
          onPress={() => (navigation as any).goBack?.()}
          style={({ pressed }) => [styles.secondaryBtn, pressed && styles.btnPressed]}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Text style={styles.secondaryBtnText}>Back</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

function formatScore(score: number | string | null | undefined): string {
  if (score == null) return '—';
  const n = typeof score === 'string' ? parseFloat(score) : score;
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(1);
}

function Pill({ label, muted }: { label: string; muted?: boolean }) {
  return (
    <View style={[styles.pill, muted && styles.pillMuted]}>
      <Text style={[styles.pillText, muted && styles.pillTextMuted]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B1020' },
  content: { padding: 16, paddingBottom: 36, gap: 14 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 12, fontSize: 16, color: '#666' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16, gap: 10 },
  subtle: { color: 'rgba(255,255,255,0.72)', fontSize: 12 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  title: { color: '#FFFFFF', fontSize: 20, fontWeight: '800' },
  address: { marginTop: 4, color: 'rgba(255,255,255,0.72)', fontSize: 13, lineHeight: 18 },
  sosBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(251,191,36,0.25)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.5)',
    alignSelf: 'flex-start',
  },
  sosBtnEmoji: { fontSize: 18, marginRight: 8 },
  sosBtnText: { color: '#fbbf24', fontWeight: '700', fontSize: 14 },
  sosBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sosModalContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  sosModalInner: {
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 340,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  sosModalTitle: { color: '#FFFFFF', fontSize: 20, fontWeight: '800', marginBottom: 4 },
  sosModalSubtitle: { color: 'rgba(255,255,255,0.72)', fontSize: 14, marginBottom: 20 },
  sosOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  sosOptionEmoji: { fontSize: 24, marginRight: 12 },
  sosOptionLabel: { color: '#e2e8f0', fontSize: 16, fontWeight: '600' },
  sosCancel: { marginTop: 16, paddingVertical: 12, alignItems: 'center' },
  sosCancelText: { color: 'rgba(255,255,255,0.65)', fontSize: 16, fontWeight: '500' },
  section: {
    borderRadius: 14,
    padding: 14,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  importedHintBanner: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(251,191,36,0.2)',
    borderRadius: 10,
    borderLeftWidth: 4,
    borderLeftColor: '#f59e0b',
  },
  importedHintText: {
    fontSize: 14,
    color: '#fcd34d',
    lineHeight: 20,
  },
  sectionTitle: { color: '#FFFFFF', fontWeight: '800', marginBottom: 10 },
  reviewHint: { color: 'rgba(255,255,255,0.65)', fontSize: 12, marginBottom: 12 },
  ratingRow: { marginBottom: 14 },
  ratingLabel: { color: 'rgba(255,255,255,0.9)', fontSize: 14, fontWeight: '600', marginBottom: 8 },
  ratingButtons: { flexDirection: 'row', gap: 8 },
  ratingBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ratingBtnActive: { backgroundColor: 'rgba(26,115,232,0.4)', borderColor: '#1A73E8' },
  ratingBtnText: { color: 'rgba(255,255,255,0.9)', fontSize: 16, fontWeight: '700' },
  ratingBtnTextActive: { color: '#FFFFFF' },
  submitReviewBtn: {
    marginTop: 4,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#1A73E8',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  submitReviewBtnDisabled: { opacity: 0.5 },
  submitReviewBtnText: { color: '#FFFFFF', fontWeight: '800', fontSize: 15 },
  reviewSuccessText: { marginTop: 10, color: '#4CAF50', fontSize: 13, fontWeight: '600' },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: 'rgba(26,115,232,0.22)' },
  pillMuted: { backgroundColor: 'rgba(255,255,255,0.10)' },
  pillText: { color: '#CFE3FF', fontSize: 12, fontWeight: '600' },
  pillTextMuted: { color: 'rgba(255,255,255,0.78)' },
  primaryBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#1A73E8',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  primaryBtnText: { color: '#FFFFFF', fontWeight: '800', fontSize: 13 },
  secondaryBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  secondaryBtnText: { color: '#FFFFFF', fontWeight: '800', fontSize: 13 },
  btnPressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  footerRow: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end' },
});

