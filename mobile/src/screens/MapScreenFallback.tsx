/**
 * Fallback map screen when react-native-maps is not available (e.g. Expo Go
 * with a react-native-maps version that doesn't match Expo Go's native binary).
 * Shows a list of nearby toilets and a note to use a dev build for the full map.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Location from 'expo-location';
import { useNavigation } from '@react-navigation/native';
import { api, Toilet } from '../services/api';
import { getErrorMessage, hapticButton, getOxymoronicTagline } from '../utils/engagement';
import { openInMapsWithChoice } from '../utils/maps';

const DEFAULT_COORDS = { latitude: 37.7749, longitude: -122.4194 };

export default function MapScreenFallback() {
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [usedDefaultLocation, setUsedDefaultLocation] = useState(false);
  const [toilets, setToilets] = useState<Toilet[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const navigation = useNavigation();

  const fetchNearby = useCallback(async (c: { latitude: number; longitude: number }, isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    setErr(null);
    try {
      const res = await api.getNearbyToilets({
        latitude: c.latitude,
        longitude: c.longitude,
        radius: 2500,
        limit: 80,
      });
      setToilets(res.toilets || []);
    } catch (e: any) {
      setErr(getErrorMessage(e, 'Failed to load nearby toilets. Is the backend running?'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const onRefresh = useCallback(() => {
    if (!coords) return;
    setRefreshing(true);
    fetchNearby(coords, true);
  }, [coords, fetchNearby]);

  const tryUserLocation = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setCoords(DEFAULT_COORDS);
        setUsedDefaultLocation(true);
        await fetchNearby(DEFAULT_COORDS);
        return;
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const c = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
      setCoords(c);
      setUsedDefaultLocation(false);
      await fetchNearby(c);
    } catch {
      setCoords(DEFAULT_COORDS);
      setUsedDefaultLocation(true);
      await fetchNearby(DEFAULT_COORDS);
    }
  }, [fetchNearby]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;
        if (status === 'granted') {
          const pos = await Location.getCurrentPositionAsync({});
          if (cancelled) return;
          const c = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
          setCoords(c);
          setUsedDefaultLocation(false);
          await fetchNearby(c);
          return;
        }
        setCoords(DEFAULT_COORDS);
        setUsedDefaultLocation(true);
        await fetchNearby(DEFAULT_COORDS);
      } catch {
        if (cancelled) return;
        setCoords(DEFAULT_COORDS);
        setUsedDefaultLocation(true);
        await fetchNearby(DEFAULT_COORDS);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchNearby]);

  const filtered = useMemo(() => {
    const t = Array.isArray(toilets) ? toilets : [];
    const q = query.trim().toLowerCase();
    if (!q) return t;
    return t.filter(
      (t) =>
        (t.name || '').toLowerCase().includes(q) ||
        (t.address || '').toLowerCase().includes(q)
    );
  }, [query, toilets]);

  const openInMaps = useCallback((t: Toilet) => {
    openInMapsWithChoice(t.latitude, t.longitude, t.name);
  }, []);

  const onPressToilet = useCallback(
    (toiletId: string) => {
      hapticButton();
      (navigation as any).navigate('ToiletDetails', { toiletId });
    },
    [navigation]
  );

  const onPressAddToilet = useCallback(() => {
    hapticButton();
    (navigation as any).navigate('AddToilet', {});
  }, [navigation]);

  const renderItem = useCallback(
    ({ item }: { item: Toilet }) => (
      <Pressable
        style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
        onPress={() => onPressToilet(item.id)}
      >
        <Text style={styles.cardTitle} numberOfLines={1}>
          {item.name || 'Unnamed'}
        </Text>
        {item.address ? (
          <Text style={styles.cardAddress} numberOfLines={2}>
            {item.address}
          </Text>
        ) : null}
        <View style={styles.cardRow}>
          <Text style={styles.cardScore}>
            Clean {item.cleanliness_score ?? '—'} · Smell {item.smell_score ?? '—'}
          </Text>
          <Pressable
            onPress={() => openInMaps(item)}
            style={({ pressed }) => [styles.mapLink, pressed && styles.mapLinkPressed]}
          >
            <Text style={styles.mapLinkText}>Open in Maps</Text>
          </Pressable>
        </View>
      </Pressable>
    ),
    [onPressToilet, openInMaps]
  );

  return (
    <View style={styles.container}>
      <View style={styles.banner}>
        <Text style={styles.bannerText}>
          List view (Expo Go). For the full map, run: npx expo run:ios
        </Text>
      </View>
      {usedDefaultLocation && (
        <View style={styles.defaultBanner}>
          <Text style={styles.defaultBannerText}>Using default location</Text>
          <Pressable onPress={tryUserLocation} style={styles.useLocationBtn}>
            <Text style={styles.useLocationBtnText}>Use my location</Text>
          </Pressable>
        </View>
      )}
      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search toilets..."
          placeholderTextColor="#999"
          value={query}
          onChangeText={setQuery}
        />
        <Pressable
          onPress={onPressAddToilet}
          style={({ pressed }) => [styles.addBtn, pressed && styles.addBtnPressed]}
        >
          <Text style={styles.addBtnText}>Add toilet</Text>
        </Pressable>
      </View>
      {err ? (
        <View style={styles.errBox}>
          <Text style={styles.errText}>{err}</Text>
        </View>
      ) : null}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#2196F3" />
          <Text style={styles.loadingText}>Loading…</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#60a5fa" />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyEmoji}>📍</Text>
              <Text style={styles.emptyTitle}>No toilets nearby yet</Text>
              <Text style={styles.emptySub}>Be the first to add one — you’ll help everyone out.</Text>
              <Text style={styles.emptyTagline}>{getOxymoronicTagline()}</Text>
              <Pressable
                onPress={onPressAddToilet}
                style={({ pressed }) => [styles.emptyButton, pressed && styles.addBtnPressed]}
              >
                <Text style={styles.emptyButtonText}>Add the first toilet</Text>
              </Pressable>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B1020' },
  banner: {
    backgroundColor: '#1a237e',
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  bannerText: { color: '#fff', fontSize: 12 },
  defaultBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e3a5f',
    paddingVertical: 6,
    paddingHorizontal: 12,
    gap: 8,
  },
  defaultBannerText: { color: '#b0bec5', fontSize: 12, flex: 1 },
  useLocationBtn: { paddingVertical: 4, paddingHorizontal: 10, backgroundColor: '#2196f3', borderRadius: 6 },
  useLocationBtnText: { color: '#fff', fontWeight: '600', fontSize: 12 },
  searchRow: { flexDirection: 'row', padding: 10, gap: 8, alignItems: 'center' },
  searchInput: {
    flex: 1,
    backgroundColor: '#1e293b',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 16,
  },
  addBtn: { paddingVertical: 10, paddingHorizontal: 14, backgroundColor: '#22c55e', borderRadius: 8 },
  addBtnPressed: { opacity: 0.9 },
  addBtnText: { color: '#fff', fontWeight: '600' },
  errBox: { padding: 12, backgroundColor: '#7f1d1d', marginHorizontal: 10, marginBottom: 8, borderRadius: 8 },
  errText: { color: '#fca5a5', fontSize: 14 },
  loadingText: { marginTop: 12, fontSize: 16, color: '#94a3b8' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  listContent: { padding: 10, paddingBottom: 24 },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
  },
  cardPressed: { opacity: 0.9 },
  cardTitle: { color: '#fff', fontSize: 16, fontWeight: '600', marginBottom: 4 },
  cardAddress: { color: '#94a3b8', fontSize: 13, marginBottom: 8 },
  cardRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardScore: { color: '#cbd5e1', fontSize: 12 },
  mapLink: { paddingVertical: 4, paddingHorizontal: 8 },
  mapLinkPressed: { opacity: 0.8 },
  mapLinkText: { color: '#60a5fa', fontSize: 12 },
  emptyContainer: {
    paddingVertical: 48,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  emptyEmoji: { fontSize: 56, marginBottom: 16 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: '#e2e8f0', marginBottom: 8, textAlign: 'center' },
  emptySub: { fontSize: 14, color: '#94a3b8', textAlign: 'center', marginBottom: 12 },
  emptyTagline: { fontSize: 12, color: '#64748b', fontStyle: 'italic', textAlign: 'center', marginBottom: 24 },
  emptyButton: { backgroundColor: '#22c55e', paddingVertical: 14, paddingHorizontal: 24, borderRadius: 12 },
  emptyButtonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
});
