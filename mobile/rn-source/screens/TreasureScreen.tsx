import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography } from '../theme';
import { Card, ScrollPage } from '../components/ui';
import { useHuntStatus } from '../hooks/useHuntStatus';

function daysRemaining(endsAt: string | null): number | null {
  if (!endsAt) return null;
  const end = new Date(endsAt).getTime();
  if (Number.isNaN(end)) return null;
  return Math.max(0, Math.ceil((end - Date.now()) / 86_400_000));
}

const RANK_EMOJI = ['\ud83e\udd47', '\ud83e\udd48', '\ud83e\udd49'];

export default function TreasureScreen() {
  const { status, leaders, progress, loading, error, totalRemaining } = useHuntStatus();

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.gold} />
      </View>
    );
  }

  const active = status?.active ?? false;
  const remainingByCity = status?.goldenToiletsRemaining ?? {};
  const cities = Object.keys(remainingByCity).sort();
  const endDays = daysRemaining(status?.endsAt ?? null);

  const myFound = progress?.found ?? 0;
  const myTotal = progress?.totalGolden ?? null;
  const progressPct = myTotal && myTotal > 0 ? Math.min(100, (myFound / myTotal) * 100) : 0;

  return (
    <ScrollPage style={styles.container}>
      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <View style={styles.progressCard}>
        <Text style={styles.pcTitle}>Golden Toilet Hunt</Text>
        <Text style={styles.pcSub}>
          {active
            ? 'Find golden toilets \u00b7 win vouchers & prizes'
            : status?.daysUntilStart != null
              ? `Next hunt starts in ${status.daysUntilStart} day${status.daysUntilStart === 1 ? '' : 's'}`
              : 'No active hunt right now'}
        </Text>
        {active && myTotal != null && myTotal > 0 ? (
          <>
            <View style={styles.pcBarTrack}>
              <View style={[styles.pcBarFill, { width: `${progressPct}%` }]} />
            </View>
            <Text style={styles.pcCount}>
              {`${myFound} / ${myTotal} found this hunt`}
              {progress?.percentile != null ? ` \u00b7 \ud83c\udfc6 Top ${progress.percentile}%` : ''}
            </Text>
          </>
        ) : active ? (
          <Text style={styles.pcCount}>
            {`\ud83c\udfc6 ${totalRemaining} golden toilet${totalRemaining === 1 ? '' : 's'} still hidden`}
            {endDays != null ? ` \u00b7 ${endDays} day${endDays === 1 ? '' : 's'} left` : ''}
          </Text>
        ) : null}
      </View>

      {active && cities.length > 0 ? (
        <>
          <Text style={styles.sectionHdr}>Golden toilets by city</Text>
          <View style={styles.group}>
            {cities.map((city) => (
              <View key={city} style={styles.cityRow}>
                <Text style={styles.cityBadge}>{'\ud83c\udfc6'}</Text>
                <View style={styles.cityInfo}>
                  <Text style={styles.cityName}>{city}</Text>
                  <Text style={styles.citySub}>
                    {remainingByCity[city]} still hidden
                  </Text>
                </View>
              </View>
            ))}
          </View>
          <Text style={styles.hint}>
            Golden toilet locations are kept secret. Check in at any toilet during the hunt for a chance to win.
          </Text>
        </>
      ) : null}

      {!active ? (
        <Card title="How it works">
          <Text style={styles.howText}>
            Each month, golden toilets are hidden across cities. Check in at the right ones during an
            active hunt to earn vouchers and prizes. Come back when the next hunt starts!
          </Text>
        </Card>
      ) : null}

      <Text style={styles.sectionHdr}>Leaderboard</Text>
      {leaders.length === 0 ? (
        <View style={styles.group}>
          <Text style={styles.emptyLeader}>
            No golden toilets found yet. Be the first hunter on the board!
          </Text>
        </View>
      ) : (
        <View style={styles.group}>
          {leaders.map((l) => {
            const isMe =
              progress?.rank != null && l.rank === progress.rank && l.found === myFound;
            return (
              <View key={`${l.rank}-${l.displayName}`} style={[styles.leaderRow, isMe && styles.leaderRowMe]}>
                <Text style={styles.leaderRank}>
                  {l.rank <= 3 ? RANK_EMOJI[l.rank - 1] : `#${l.rank}`}
                </Text>
                <View style={styles.leaderInfo}>
                  <Text style={styles.leaderName} numberOfLines={1}>
                    {isMe ? 'You' : l.displayName}
                  </Text>
                  <Text style={styles.leaderSub}>
                    {l.found} found
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      )}

      <View style={{ height: spacing.lg }} />
    </ScrollPage>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.bg2 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg2 },

  errorBox: { backgroundColor: colors.redLight, margin: spacing.sm, padding: spacing.md, borderRadius: radius.lg },
  errorText: { color: colors.red },

  progressCard: {
    backgroundColor: colors.gold,
    margin: spacing.sm,
    borderRadius: radius.card,
    padding: spacing.lg,
  },
  pcTitle: { fontSize: 17, fontWeight: '700', letterSpacing: -0.2, color: colors.white },
  pcSub: { fontSize: 13, color: 'rgba(255,255,255,0.85)', marginTop: 2 },
  pcBarTrack: { height: 6, backgroundColor: 'rgba(255,255,255,0.3)', borderRadius: 3, marginTop: 13 },
  pcBarFill: { height: '100%', backgroundColor: 'rgba(255,255,255,0.9)', borderRadius: 3 },
  pcCount: { fontSize: 12, color: 'rgba(255,255,255,0.8)', marginTop: 6, fontWeight: '500' },

  sectionHdr: {
    fontSize: 19,
    fontWeight: '700',
    letterSpacing: -0.3,
    color: colors.label,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: 7,
  },
  group: {
    backgroundColor: colors.bg,
    marginHorizontal: spacing.sm,
    borderRadius: radius.xl,
    overflow: 'hidden',
  },
  cityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    padding: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  cityBadge: {
    width: 42,
    height: 42,
    textAlign: 'center',
    lineHeight: 42,
    backgroundColor: colors.goldLight,
    borderRadius: radius.lg,
    fontSize: 20,
    overflow: 'hidden',
  },
  cityInfo: { flex: 1 },
  cityName: { fontSize: 15, fontWeight: '500', color: colors.label },
  citySub: { fontSize: 13, color: colors.label2, marginTop: 2 },
  hint: { fontSize: 13, color: colors.label2, paddingHorizontal: spacing.lg, paddingTop: spacing.md, lineHeight: 19 },

  howText: { fontSize: 14, color: colors.label2, lineHeight: 21 },

  leaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    padding: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  leaderRowMe: { backgroundColor: colors.blueLight },
  leaderRank: { width: 36, textAlign: 'center', fontSize: 17, fontWeight: '700', color: colors.label },
  leaderInfo: { flex: 1 },
  leaderName: { fontSize: 15, fontWeight: '500', color: colors.label },
  leaderSub: { fontSize: 13, color: colors.label2, marginTop: 2 },
  emptyLeader: { padding: spacing.lg, textAlign: 'center', color: colors.label3, fontSize: 13 },
});
