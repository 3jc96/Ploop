import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { colors, radius, spacing, typography } from '../theme';
import { Card, DangerButton, NavBar, Pill, PrimaryButton, ScrollPage, Stars } from '../components/ui';
import { fetchToiletById } from '../data/toilets';
import { api, ToiletReview } from '../../src/services/api';

type DesignToilet = Awaited<ReturnType<typeof fetchToiletById>>;

function clampScore(value: number | null): number {
  if (value == null) return 0;
  return Math.max(0, Math.min(5, value));
}

function ScoreBar({ label, value, color }: { label: string; value: number | null; color: string }) {
  const v = clampScore(value);
  return (
    <View style={styles.barRow}>
      <Text style={styles.barLbl}>{label}</Text>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${(v / 5) * 100}%`, backgroundColor: color }]} />
      </View>
      <Text style={styles.barVal}>{value != null ? v.toFixed(1) : '\u2013'}</Text>
    </View>
  );
}

function relativeDate(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return '1 day ago';
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks === 1) return '1 week ago';
  if (weeks < 5) return `${weeks} weeks ago`;
  const months = Math.floor(days / 30);
  return months <= 1 ? '1 month ago' : `${months} months ago`;
}

function amenityList(t: DesignToilet): string[] {
  const raw = t.raw as any;
  const out: string[] = [];
  if (t.wheelchair_accessible) out.push('\u267f Wheelchair');
  if (t.has_toilet_paper) out.push('\ud83e\uddfb Toilet paper');
  if (t.has_hand_soap) out.push('\ud83e\uddfc Hand soap');
  if (t.has_bidet) out.push('\ud83d\udca6 Bidet');
  if (raw?.has_baby_changing) out.push('\ud83c\udf7c Baby change');
  if (raw?.has_family_room) out.push('\ud83d\udc6a Family room');
  if (raw?.has_seat_warmer) out.push('\ud83d\udd25 Seat warmer');
  if (!t.pay_to_enter) out.push('\ud83c\udd93 Free entry');
  return out;
}

export default function ToiletDetailDesignScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const toiletId: string = route.params?.toiletId;

  const [toilet, setToilet] = useState<DesignToilet | null>(null);
  const [reviews, setReviews] = useState<ToiletReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [t, r] = await Promise.all([
          fetchToiletById(toiletId),
          api.getToiletReviews(toiletId).catch(() => ({ reviews: [] as ToiletReview[] })),
        ]);
        if (!active) return;
        setToilet(t);
        setReviews(r.reviews ?? []);
      } catch (e: any) {
        if (active) setError(e?.message ?? 'Failed to load toilet');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [toiletId]);

  if (loading) {
    return (
      <View style={styles.flex}>
        <NavBar title="Toilet" onBack={() => navigation.goBack()} />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.blue} />
        </View>
      </View>
    );
  }

  if (error || !toilet) {
    return (
      <View style={styles.flex}>
        <NavBar title="Toilet" onBack={() => navigation.goBack()} />
        <View style={styles.centered}>
          <Text style={styles.errorText}>{error ?? 'Toilet not found'}</Text>
        </View>
      </View>
    );
  }

  const amenities = amenityList(toilet);
  const shortTitle = toilet.name.split(' ').slice(0, 2).join(' ');

  return (
    <View style={styles.flex}>
      <NavBar title={shortTitle} onBack={() => navigation.goBack()} />
      <ScrollPage style={{ backgroundColor: colors.bg2 }}>
        <View style={styles.hero}>
          <Text style={styles.detName}>{toilet.name}</Text>
          {toilet.address ? <Text style={styles.detAddr}>{toilet.address}</Text> : null}
          {toilet.distance != null ? (
            <Text style={styles.detDist}>
              {toilet.distance < 1000
                ? `${Math.round(toilet.distance)}m away`
                : `${(toilet.distance / 1000).toFixed(1)}km away`}
            </Text>
          ) : null}
          <View style={styles.pills}>
            {!toilet.pay_to_enter ? <Pill label="Free" /> : <Pill label="Paid" />}
            {toilet.wheelchair_accessible ? <Pill label="\u267f Accessible" /> : null}
            {(toilet.raw as any)?.has_baby_changing ? <Pill label="\ud83c\udf7c Baby Change" /> : null}
          </View>
        </View>

        <Card>
          <View style={styles.scoreRow}>
            <Text style={styles.scoreBig}>{toilet.rating != null ? toilet.rating.toFixed(1) : '\u2013'}</Text>
            <View style={styles.scoreDetail}>
              <Stars value={toilet.rating} size={16} />
              <Text style={styles.scoreCnt}>{toilet.total_reviews} reviews</Text>
            </View>
          </View>
          <View style={styles.barRows}>
            <ScoreBar label="Cleanliness" value={toilet.cleanliness_score} color={colors.green} />
            <ScoreBar label="Smell" value={toilet.smell_score} color={colors.star} />
          </View>
        </Card>

        {amenities.length > 0 ? (
          <Card title="Amenities">
            <View style={styles.amenityWrap}>
              {amenities.map((a) => (
                <View key={a} style={styles.amenity}>
                  <Text style={styles.amenityText}>{a}</Text>
                </View>
              ))}
            </View>
          </Card>
        ) : null}

        <Card title="Reviews">
          {reviews.length === 0 ? (
            <Text style={styles.noReviews}>No reviews yet. Be the first.</Text>
          ) : (
            reviews.slice(0, 8).map((rev) => {
              const avg =
                rev.cleanliness_score != null && rev.smell_score != null
                  ? (rev.cleanliness_score + rev.smell_score) / 2
                  : rev.cleanliness_score ?? rev.smell_score ?? null;
              return (
                <View key={rev.id} style={styles.rev}>
                  <View style={styles.revTop}>
                    <Text style={styles.revUser}>{rev.reviewed_by || 'Anonymous'}</Text>
                    <Text style={styles.revDate}>{relativeDate(rev.reviewed_at)}</Text>
                  </View>
                  <Stars value={avg} size={12} />
                  {rev.review_text ? <Text style={styles.revText}>{rev.review_text}</Text> : null}
                </View>
              );
            })
          )}
        </Card>

        <View style={styles.actionStack}>
          <DangerButton label="\ud83c\udd98 Send SOS \u2014 I Need Help" onPress={() => navigation.navigate('SOS')} />
          <PrimaryButton
            label="\u270f\ufe0f Write a Review"
            onPress={() =>
              navigation.navigate('LocationReview', { toiletId: toilet.id, name: toilet.name })
            }
          />
        </View>
        <View style={{ height: spacing.xl }} />
      </ScrollPage>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg2 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorText: { color: colors.red },

  hero: {
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: 18,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  detName: { ...typography.title, color: colors.label, lineHeight: 26 },
  detAddr: { fontSize: 14, color: colors.label2, marginTop: 4 },
  detDist: { fontSize: 14, color: colors.blue, fontWeight: '600', marginTop: 2 },
  pills: { flexDirection: 'row', gap: 7, flexWrap: 'wrap', marginTop: spacing.md },

  scoreRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 14 },
  scoreBig: { fontSize: 52, fontWeight: '700', letterSpacing: -2, lineHeight: 52, color: colors.label },
  scoreDetail: { gap: 4, paddingBottom: 4 },
  scoreCnt: { fontSize: 13, color: colors.label2 },
  barRows: { gap: 10, marginTop: spacing.lg },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  barLbl: { fontSize: 13, color: colors.label2, width: 88 },
  barTrack: { flex: 1, height: 6, backgroundColor: colors.fill, borderRadius: 3, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 3 },
  barVal: { fontSize: 13, fontWeight: '600', width: 26, textAlign: 'right', color: colors.label },

  amenityWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  amenity: { backgroundColor: colors.fill, borderRadius: radius.md, paddingHorizontal: 11, paddingVertical: 8 },
  amenityText: { fontSize: 13, fontWeight: '500', color: colors.label },

  rev: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
  revTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 },
  revUser: { fontSize: 14, fontWeight: '600', color: colors.label },
  revDate: { fontSize: 12, color: colors.label3 },
  revText: { fontSize: 14, color: colors.label2, lineHeight: 22, marginTop: 4 },
  noReviews: { fontSize: 14, color: colors.label3 },

  actionStack: { backgroundColor: colors.bg, marginTop: spacing.sm, padding: spacing.lg, gap: 10 },
});
