import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { colors, radius, spacing, typography } from '../theme';
import { Chip, Stars, Tag } from '../components/ui';
import { fetchNearbyToilets } from '../data/toilets';

type Filter = 'all' | 'free' | 'accessible' | 'bidet' | 'top';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'free', label: 'Free' },
  { id: 'accessible', label: '\u267f Accessible' },
  { id: 'bidet', label: '\ud83d\udeBF Bidet' },
  { id: 'top', label: '\u2b50 4+' },
];

type DesignToilet = Awaited<ReturnType<typeof fetchNearbyToilets>>[number];

function metersLabel(distance: number | null): string {
  if (distance == null) return '';
  if (distance < 1000) return `${Math.round(distance)} m`;
  return `${(distance / 1000).toFixed(1)} km`;
}

function ToiletRow({ toilet, onPress }: { toilet: DesignToilet; onPress: () => void }) {
  const free = !toilet.pay_to_enter;
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <View style={styles.rowIcon}>
        <Text style={styles.rowIconText}>{'\ud83d\udeBD'}</Text>
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowName} numberOfLines={1}>
          {toilet.name}
        </Text>
        <View style={styles.rowMeta}>
          {toilet.distance != null ? (
            <Text style={styles.rowDist}>{metersLabel(toilet.distance)}</Text>
          ) : null}
          <Stars value={toilet.rating} size={11} />
          {toilet.rating != null ? <Text style={styles.rnum}>{toilet.rating.toFixed(1)}</Text> : null}
          {free ? <Tag label="Free" variant="free" /> : null}
          {toilet.wheelchair_accessible ? <Tag label="\u267f" variant="accent" /> : null}
        </View>
      </View>
      <Text style={styles.chev}>{'\u203a'}</Text>
    </Pressable>
  );
}

export default function NearbyScreen() {
  const navigation = useNavigation<any>();
  const [filter, setFilter] = useState<Filter>('all');
  const [toilets, setToilets] = useState<DesignToilet[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      // Backend caps radius at 10 km and limit at 100.
      const data = await fetchNearbyToilets({ radius: 10_000, limit: 100 });
      setToilets(data);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load toilets');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    let list = toilets;
    if (filter === 'free') list = list.filter((t) => !t.pay_to_enter);
    else if (filter === 'accessible') list = list.filter((t) => t.wheelchair_accessible);
    else if (filter === 'bidet') list = list.filter((t) => t.has_bidet);
    else if (filter === 'top') list = list.filter((t) => (t.rating ?? 0) >= 4);
    return [...list].sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
  }, [toilets, filter]);

  const groups = useMemo(() => {
    const near: DesignToilet[] = [];
    const mid: DesignToilet[] = [];
    const far: DesignToilet[] = [];
    for (const t of filtered) {
      const d = t.distance ?? Infinity;
      if (d <= 500) near.push(t);
      else if (d <= 1000) mid.push(t);
      else far.push(t);
    }
    return { near, mid, far };
  }, [filtered]);

  const openDetail = (t: DesignToilet) =>
    navigation.navigate('ToiletDetailDesign', { toiletId: t.id, name: t.name });

  const renderGroup = (label: string, list: DesignToilet[]) => {
    if (list.length === 0) return null;
    return (
      <>
        <Text style={styles.listHdr}>{label}</Text>
        <View style={styles.group}>
          {list.map((t) => (
            <ToiletRow key={t.id} toilet={t} onPress={() => openDetail(t)} />
          ))}
        </View>
      </>
    );
  };

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chips}
        contentContainerStyle={styles.chipsContent}
      >
        {FILTERS.map((f) => (
          <Chip key={f.id} label={f.label} active={filter === f.id} onPress={() => setFilter(f.id)} />
        ))}
      </ScrollView>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.blue} />
        </View>
      ) : (
        <ScrollView
          style={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}
        >
          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
              <Pressable style={styles.retry} onPress={() => load()}>
                <Text style={styles.retryText}>Try again</Text>
              </Pressable>
            </View>
          ) : null}

          {filtered.length === 0 && !error ? (
            <Text style={styles.empty}>No toilets match this filter.</Text>
          ) : null}

          {renderGroup('Within 500 m', groups.near)}
          {renderGroup('500 m \u2013 1 km', groups.mid)}
          {renderGroup('Further away', groups.far)}
          <View style={{ height: spacing.sm }} />
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg2 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  chips: {
    backgroundColor: colors.bg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
    flexGrow: 0,
  },
  chipsContent: { gap: 7, paddingHorizontal: spacing.lg, paddingVertical: 10 },
  list: { flex: 1 },
  listHdr: {
    ...typography.sectionLabel,
    color: colors.label2,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: 7,
  },
  group: {
    backgroundColor: colors.bg,
    marginHorizontal: spacing.sm,
    borderRadius: radius.xl,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingHorizontal: spacing.lg,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.separator,
  },
  rowIcon: {
    width: 42,
    height: 42,
    backgroundColor: colors.blueLight,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowIconText: { fontSize: 20 },
  rowBody: { flex: 1, minWidth: 0 },
  rowName: { ...typography.body, fontWeight: '500', color: colors.label },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3, flexWrap: 'wrap' },
  rowDist: { fontSize: 13, color: colors.blue, fontWeight: '600' },
  rnum: { fontSize: 13, color: colors.label2 },
  chev: { color: colors.label3, fontSize: 20 },
  errorBox: {
    backgroundColor: colors.redLight,
    margin: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.lg,
  },
  errorText: { color: colors.red },
  retry: {
    marginTop: 10,
    alignSelf: 'flex-start',
    backgroundColor: colors.blue,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  retryText: { color: colors.white, fontWeight: '600' },
  empty: { textAlign: 'center', color: colors.label3, marginTop: spacing.xxl },
});
