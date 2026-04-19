import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Location from 'expo-location';
import Constants from 'expo-constants';
import { useNavigation } from '@react-navigation/native';
import { useJsApiLoader, GoogleMap, Marker } from '@react-google-maps/api';
import { api, Toilet } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useMapPreload } from '../context/MapPreloadContext';
import { openInMapsWithChoice } from '../utils/maps';

type Coords = { latitude: number; longitude: number };

const MAP_WRAPPER_HEIGHT = 420;
const MAP_CONTAINER_STYLE = { width: '100%', height: '100%', minHeight: MAP_WRAPPER_HEIGHT };

export default function MapScreenWeb() {
  const navigation = useNavigation();
  const { user } = useAuth();
  const preload = useMapPreload();
  const [coords, setCoords] = useState<Coords | null>(null);
  /** True when we need the user to grant location or retry (no coordinates to show nearby data). */
  const [needsLocation, setNeedsLocation] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [toilets, setToilets] = useState<Toilet[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [selectedToiletId, setSelectedToiletId] = useState<string | null>(null);
  // When user clicks a point on the map we resolve the place and show Add/Review
  const [clickedPlace, setClickedPlace] = useState<{
    placeId: string;
    name: string;
    address: string;
    latitude: number;
    longitude: number;
  } | null>(null);
  const [clickedPlaceLoading, setClickedPlaceLoading] = useState(false);

  // Google POI search: find a place to add or leave a review
  const [placeSearchQuery, setPlaceSearchQuery] = useState('');
  const [placeSearchResults, setPlaceSearchResults] = useState<Array<{ id: string; name: string; address: string; latitude: number; longitude: number }>>([]);
  const [placeSearchLoading, setPlaceSearchLoading] = useState(false);
  const [showPlaceSearch, setShowPlaceSearch] = useState(false);
  const placeSearchTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);


  const LOCATION_TIMEOUT_MS = 6000;
  const LOCATION_MAX_AGE_MS = 60000;

  // Prefer env; then app.json extra (expoConfig or manifest); then __EXPO_CONFIG__ (web)
  const googleMapsApiKey =
    (typeof process !== 'undefined' && (process as any).env?.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY) ||
    (Constants.expoConfig?.extra as any)?.googleMapsApiKey ||
    (Constants as any).manifest?.extra?.googleMapsApiKey ||
    (Constants as any).manifest2?.extra?.googleMapsApiKey ||
    (typeof window !== 'undefined' && (window as any).__EXPO_CONFIG__?.extra?.googleMapsApiKey) ||
    '';
  const { isLoaded: isMapLoaded, loadError: mapLoadError } = useJsApiLoader({
    googleMapsApiKey,
    id: 'ploop-web-map',
    version: 'weekly',
    preventGoogleFontsLoading: true,
  });

  const fetchNearby = useCallback(
    async (c: Coords) => {
      setErr(null);
      setLoading(true);
      try {
        const res = await api.getNearbyToilets({ latitude: c.latitude, longitude: c.longitude, radius: 2500, limit: 80 });
        setToilets(res.toilets || []);
      } catch (e: any) {
        setErr(e?.response?.data?.error || e?.message || 'Failed to load nearby toilets (is the backend running?)');
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const tryUserLocation = useCallback(async () => {
    setLoading(true);
    setErr(null);
    setLocationError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocationError('Location permission was denied. Allow location for this site in your browser (address bar or site settings).');
        setCoords(null);
        setNeedsLocation(true);
        setToilets([]);
        return;
      }
      // Try cached position first (fast; works if user was recently located)
      let pos: Location.LocationObject | null = null;
      try {
        pos = await Location.getLastKnownPositionAsync({ maxAge: LOCATION_MAX_AGE_MS });
      } catch {
        // ignore
      }
      if (pos && pos.coords) {
        const c = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
        setCoords(c);
        setNeedsLocation(false);
        setLocationError(null);
        await fetchNearby(c);
        setLoading(false);
        return;
      }
      // Otherwise get fresh position with timeout so we don't hang
      const posPromise = Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Location request timed out. Try again or allow location in browser.')), LOCATION_TIMEOUT_MS)
      );
      pos = await Promise.race([posPromise, timeoutPromise]);
      if (pos && pos.coords) {
        const c = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
        setCoords(c);
        setNeedsLocation(false);
        setLocationError(null);
        await fetchNearby(c);
      } else {
        throw new Error('Could not get position');
      }
    } catch (e: any) {
      const msg = e?.message || 'Could not get your location.';
      setLocationError(msg);
      setCoords(null);
      setNeedsLocation(true);
      setToilets([]);
    } finally {
      setLoading(false);
    }
  }, [fetchNearby]);

  // Use preloaded data from AppLoadingGate when available
  useEffect(() => {
    if (preload) {
      const c = {
        latitude: preload.location.coords.latitude,
        longitude: preload.location.coords.longitude,
      };
      setCoords(c);
      setToilets(preload.toilets);
      setLoading(false);
      setNeedsLocation(false);
      setLocationError(null);
      // Web has no useFocusEffect refetch: if gate timed out before API, load pins now
      if (
        preload.toiletsDeferred &&
        Number.isFinite(c.latitude) &&
        Number.isFinite(c.longitude)
      ) {
        fetchNearby(c).catch(() => {});
      }
    }
  }, [preload, fetchNearby]);

  useEffect(() => {
    if (preload) return;
    let cancelled = false;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;
        if (status === 'granted') {
          let pos: Location.LocationObject | null = null;
          try {
            pos = await Location.getLastKnownPositionAsync({ maxAge: LOCATION_MAX_AGE_MS });
          } catch {
            // ignore
          }
          if (pos?.coords && !cancelled) {
            const c = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
            setCoords(c);
            setNeedsLocation(false);
            setLocationError(null);
            await fetchNearby(c);
            return;
          }
          const posPromise = Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Timed out')), LOCATION_TIMEOUT_MS)
          );
          pos = await Promise.race([posPromise, timeoutPromise]);
          if (cancelled) return;
          if (pos?.coords) {
            const c = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
            setCoords(c);
            setNeedsLocation(false);
            setLocationError(null);
            await fetchNearby(c);
            return;
          }
        }
        setCoords(null);
        setNeedsLocation(true);
        setLocationError(status === 'denied' ? 'Location permission denied.' : 'Could not get your location.');
        setToilets([]);
      } catch (e: any) {
        if (cancelled) return;
        setLocationError(e?.message || 'Location unavailable.');
        setCoords(null);
        setNeedsLocation(true);
        setToilets([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchNearby, preload]);

  const filtered = useMemo(() => toilets, [toilets]);

  const selectedToilet = useMemo(
    () => (selectedToiletId ? filtered.find((t) => t.id === selectedToiletId) ?? null : null),
    [selectedToiletId, filtered]
  );

  const openInMaps = useCallback((t: Toilet) => {
    openInMapsWithChoice(t.latitude, t.longitude, t.name);
  }, []);

  // Search Google places (landmarks) so user can add or review a POI
  useEffect(() => {
    if (placeSearchTimeoutRef.current) clearTimeout(placeSearchTimeoutRef.current);
    if (!placeSearchQuery.trim() || !coords) {
      setPlaceSearchResults([]);
      return;
    }
    placeSearchTimeoutRef.current = setTimeout(async () => {
      setPlaceSearchLoading(true);
      try {
        const { landmarks } = await api.searchLandmarks({
          query: placeSearchQuery.trim(),
          latitude: coords.latitude,
          longitude: coords.longitude,
        });
        setPlaceSearchResults(landmarks || []);
      } catch (e) {
        setPlaceSearchResults([]);
      } finally {
        setPlaceSearchLoading(false);
      }
    }, 400);
    return () => {
      if (placeSearchTimeoutRef.current) clearTimeout(placeSearchTimeoutRef.current);
    };
  }, [placeSearchQuery, coords]);

  const handlePlaceSelect = useCallback(
    async (place: { id: string; name: string; address: string; latitude: number; longitude: number }) => {
      try {
        const existing = await api.getToiletByPlaceId(place.id);
        if (existing) {
          (navigation as any).navigate('ToiletDetails', { toiletId: existing.id });
        } else {
          (navigation as any).navigate('LocationReview', {
            placeId: place.id,
            placeName: place.name,
            placeAddress: place.address,
            latitude: place.latitude,
            longitude: place.longitude,
          });
        }
        setShowPlaceSearch(false);
        setPlaceSearchQuery('');
        setPlaceSearchResults([]);
        setClickedPlace(null);
      } catch (e) {
        (navigation as any).navigate('LocationReview', {
          placeId: place.id,
          placeName: place.name,
          placeAddress: place.address,
          latitude: place.latitude,
          longitude: place.longitude,
        });
        setShowPlaceSearch(false);
        setPlaceSearchQuery('');
        setPlaceSearchResults([]);
        setClickedPlace(null);
      }
    },
    [navigation]
  );

  const handleMapClick = useCallback(
    async (e: { latLng?: { lat: () => number; lng: () => number } }) => {
      if (!e.latLng || !coords) return;
      const lat = typeof e.latLng.lat === 'function' ? e.latLng.lat() : (e.latLng as any).lat;
      const lng = typeof e.latLng.lng === 'function' ? e.latLng.lng() : (e.latLng as any).lng;
      setClickedPlaceLoading(true);
      setClickedPlace(null);
      setSelectedToiletId(null);
      try {
        const details = await api.getLocationDetails({ latitude: lat, longitude: lng });
        if (details.place && details.place.placeId) {
          setClickedPlace({
            placeId: details.place.placeId,
            name: details.place.name,
            address: details.place.address || '',
            latitude: lat,
            longitude: lng,
          });
        }
      } catch {
        setClickedPlace(null);
      } finally {
        setClickedPlaceLoading(false);
      }
    },
    [coords]
  );

  // On web, ScrollView needs a bounded height to scroll; parent flex can give 0. Use a wrapper with explicit height.
  const scrollWrapperStyle = Platform.OS === 'web' ? styles.scrollWrapperWeb : styles.scrollWrapper;

  return (
    <View style={scrollWrapperStyle}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, (selectedToilet || clickedPlace) && styles.scrollContentWithBar]}
        showsVerticalScrollIndicator={true}
      >
      <View style={styles.blueHeader}>
        <View style={styles.blueHeaderTextBlock}>
          <View style={styles.blueHeaderRow}>
            <Text style={styles.blueHeaderTitle}>Ploop – Find Toilets</Text>
            <View style={styles.headerActions}>
              <Pressable
                onPress={() =>
                  user
                    ? (navigation as any).navigate('PoopGame')
                    : (navigation as any).navigate('Login', { returnTo: 'PoopGame' })
                }
                style={({ pressed }) => [styles.accountBtn, pressed && styles.btnPressed]}
                accessibilityRole="button"
                accessibilityLabel="Already Plooping - Play game"
              >
                <Text style={styles.accountBtnText}>💩 Already Plooping</Text>
              </Pressable>
              <Pressable
                onPress={() => (navigation as any).navigate('Login')}
                style={({ pressed }) => [styles.accountBtn, pressed && styles.btnPressed]}
                accessibilityRole="button"
                accessibilityLabel={user ? 'Account' : 'Sign in'}
              >
                <Text style={styles.accountBtnText} numberOfLines={1}>{user ? (user.display_name || user.email || 'Account') : 'Sign in'}</Text>
              </Pressable>
              {user?.role === 'admin' && (
                <Pressable
                  onPress={() => (navigation as any).navigate('Admin')}
                  style={({ pressed }) => [styles.adminBtn, pressed && styles.btnPressed]}
                  accessibilityRole="button"
                  accessibilityLabel="Admin"
                >
                  <Text style={styles.adminBtnText}>Admin</Text>
                </Pressable>
              )}
            </View>
          </View>
          <Text style={styles.bannerText}>
            {coords
              ? `Using your location • ${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)}`
              : needsLocation || locationError
                ? locationError || 'Turn on location to see nearby toilets.'
                : 'Getting your location…'}
          </Text>
          {needsLocation && !loading && (
            <Text style={styles.bannerTip}>
              Click “Use my location” to retry. Allow location for this site (browser address bar or site settings). Chrome on localhost usually works; Safari may require HTTPS.
            </Text>
          )}
        </View>
        {needsLocation && !loading && (
          <Pressable
            onPress={tryUserLocation}
            style={({ pressed }) => [styles.bannerBtn, pressed && styles.btnPressed]}
            accessibilityRole="button"
            accessibilityLabel="Use my location"
          >
            <Text style={styles.bannerBtnText}>Use my location</Text>
          </Pressable>
        )}
      </View>

      <View style={styles.poiSection}>
        <Pressable
          onPress={() => setShowPlaceSearch((v) => !v)}
          style={({ pressed }) => [styles.poiToggle, pressed && styles.btnPressed]}
          accessibilityRole="button"
          accessibilityLabel="Find a Google place to add or review"
        >
          <Text style={styles.poiToggleText}>
            {showPlaceSearch ? '▼ Hide' : '▶ Add or review a Google place (search by name)'}
          </Text>
        </Pressable>
        {showPlaceSearch && (
          <View style={styles.poiSearchBox}>
            <Text style={styles.poiSearchLabel}>
              Preferred: click a place on the map below — a bar will appear so you can “Add / Review”. Or search by name here:
            </Text>
            <TextInput
              value={placeSearchQuery}
              onChangeText={setPlaceSearchQuery}
              placeholder="e.g. Starbucks Union Square, SFO Terminal 3"
              autoCorrect={false}
              style={styles.searchInput}
              accessibilityLabel="Search for a place"
            />
            {placeSearchLoading && (
              <View style={styles.poiLoadingRow}>
                <ActivityIndicator size="small" />
                <Text style={styles.subtle}>Searching…</Text>
              </View>
            )}
            {!placeSearchLoading && placeSearchResults.length > 0 && (
              <View style={styles.poiResults}>
                {placeSearchResults.slice(0, 8).map((place) => (
                  <Pressable
                    key={place.id}
                    onPress={() => handlePlaceSelect(place)}
                    style={({ pressed }) => [styles.poiResultItem, pressed && styles.btnPressed]}
                    accessibilityRole="button"
                    accessibilityLabel={`Add or review ${place.name}`}
                  >
                    <Text style={styles.poiResultName} numberOfLines={1}>{place.name}</Text>
                    {place.address ? (
                      <Text style={styles.poiResultAddress} numberOfLines={1}>{place.address}</Text>
                    ) : null}
                    <Text style={styles.poiResultAction}>Add / Review →</Text>
                  </Pressable>
                ))}
              </View>
            )}
            {!placeSearchLoading && placeSearchQuery.trim() && placeSearchResults.length === 0 && (
              <Text style={styles.subtle}>No places found. Try a different search.</Text>
            )}
          </View>
        )}
      </View>

      {err ? (
        <View style={styles.center}>
          <Text style={styles.errorTitle}>Couldn’t load toilets</Text>
          <Text style={styles.errorBody}>{err}</Text>
          {coords && (
            <Pressable
              onPress={() => fetchNearby(coords)}
              style={({ pressed }) => [styles.primaryBtn, pressed && styles.btnPressed]}
              accessibilityRole="button"
              accessibilityLabel="Try again"
            >
              <Text style={styles.primaryBtnText}>Try again</Text>
            </Pressable>
          )}
        </View>
      ) : (
        <View style={styles.mapAndList}>
          <View style={styles.mapSection}>
            <Text style={styles.mapSectionTitle}>Live map</Text>
            <Text style={styles.mapSectionHint}>Click a place on the map to add or review it.</Text>
            {googleMapsApiKey && isMapLoaded && coords ? (
              <View style={[styles.mapWrapper, { height: MAP_WRAPPER_HEIGHT }]}>
                <GoogleMap
                mapContainerStyle={{ width: '100%', height: `${MAP_WRAPPER_HEIGHT}px` }}
                center={{ lat: coords.latitude, lng: coords.longitude }}
                zoom={14}
                onClick={handleMapClick}
                options={{
                  zoomControl: true,
                  mapTypeControl: true,
                  fullscreenControl: true,
                  streetViewControl: false,
                }}
              >
                {filtered.map((t) => (
                  <Marker
                    key={t.id}
                    position={{ lat: t.latitude, lng: t.longitude }}
                    title={t.name || 'Toilet'}
                    onClick={() => setSelectedToiletId((id) => (id === t.id ? null : t.id))}
                  />
                ))}
              </GoogleMap>
              </View>
            ) : (
              <View style={styles.mapPlaceholder}>
                <Text style={styles.mapPlaceholderText}>
                  {mapLoadError
                    ? 'Map failed to load. Check console.'
                    : !googleMapsApiKey
                      ? 'Map unavailable (set EXPO_PUBLIC_GOOGLE_MAPS_API_KEY or add key in app.json extra).'
                        : !isMapLoaded
                        ? 'Loading map…'
                        : needsLocation
                          ? 'Allow location to show the map here.'
                          : 'Getting location…'}
                </Text>
              </View>
            )}
          </View>
          <View style={styles.listContent}>
            {loading ? (
              <View style={styles.center}>
                <ActivityIndicator size="small" color="#6366f1" />
                <Text style={[styles.subtle, { marginTop: 8 }]}>Loading toilets…</Text>
              </View>
            ) : filtered.length === 0 ? (
              <View style={styles.center}>
                <Text style={styles.subtle}>No toilets found.</Text>
              </View>
            ) : (
              filtered.map((item) => (
                <View
                  key={item.id}
                  style={[
                    styles.card,
                    selectedToiletId === item.id && styles.cardSelected,
                  ]}
                >
                  <View style={styles.cardTopRow}>
                    <Text style={styles.cardTitle} numberOfLines={1}>
                      {item.name || 'Untitled Toilet'}
                    </Text>
                    <View style={styles.cardActions}>
                      <Pressable
                        onPress={() => (navigation as any).navigate('ToiletDetails', { toiletId: item.id })}
                        style={({ pressed }) => [styles.detailsBtn, pressed && styles.btnPressed]}
                        accessibilityRole="button"
                        accessibilityLabel="View details and add review"
                      >
                        <Text style={styles.detailsBtnText}>Details & review</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => openInMaps(item)}
                        style={({ pressed }) => [styles.linkBtn, pressed && styles.btnPressed]}
                        accessibilityRole="button"
                        accessibilityLabel={`Open ${item.name} in Google Maps`}
                      >
                        <Text style={styles.linkBtnText}>Maps</Text>
                      </Pressable>
                    </View>
                  </View>
                  {!!item.address && (
                    <Text style={styles.cardSub} numberOfLines={2}>
                      {item.address}
                    </Text>
                  )}
                  <View style={styles.badgesRow}>
                    <Badge label={`Clean ${formatScore(item.cleanliness_score)}`} />
                    <Badge label={`Smell ${formatScore(item.smell_score)}`} />
                    {item.wheelchair_accessible ? <Badge label="♿ Accessible" /> : <Badge label="Not accessible" muted />}
                    {item.pay_to_enter ? <Badge label="Paid" muted /> : <Badge label="Free" />}
                  </View>
                </View>
              ))
            )}
          </View>
        </View>
      )}
      </ScrollView>

      {/* Sticky bottom bar when a toilet marker is selected */}
      {selectedToilet && (
        <View style={styles.selectedBar} pointerEvents="box-none">
          <View style={styles.selectedBarInner}>
            <Text style={styles.selectedBarTitle} numberOfLines={1}>
              {selectedToilet.name || 'Toilet'}
            </Text>
            <View style={styles.selectedBarActions}>
              <Pressable
                onPress={() => (navigation as any).navigate('ToiletDetails', { toiletId: selectedToilet.id })}
                style={({ pressed }) => [styles.selectedBarBtnPrimary, pressed && styles.btnPressed]}
                accessibilityRole="button"
                accessibilityLabel="View details and add review"
              >
                <Text style={styles.selectedBarBtnPrimaryText}>Details & review</Text>
              </Pressable>
              <Pressable
                onPress={() => setSelectedToiletId(null)}
                style={({ pressed }) => [styles.selectedBarClose, pressed && styles.btnPressed]}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <Text style={styles.selectedBarCloseText}>✕</Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}

      {/* Sticky bottom bar when user clicks a point on the map (Google POI) – add or review */}
      {clickedPlace && (
        <View style={styles.selectedBar} pointerEvents="box-none">
          <View style={styles.selectedBarInner}>
            <Text style={styles.selectedBarTitle} numberOfLines={1}>
              {clickedPlace.name}
            </Text>
            <View style={styles.selectedBarActions}>
              <Pressable
                onPress={() =>
                  handlePlaceSelect({
                    id: clickedPlace.placeId,
                    name: clickedPlace.name,
                    address: clickedPlace.address,
                    latitude: clickedPlace.latitude,
                    longitude: clickedPlace.longitude,
                  })
                }
                style={({ pressed }) => [styles.selectedBarBtnPrimary, pressed && styles.btnPressed]}
                accessibilityRole="button"
                accessibilityLabel="Add or review this place"
              >
                <Text style={styles.selectedBarBtnPrimaryText}>Add / Review</Text>
              </Pressable>
              <Pressable
                onPress={() => setClickedPlace(null)}
                style={({ pressed }) => [styles.selectedBarClose, pressed && styles.btnPressed]}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <Text style={styles.selectedBarCloseText}>✕</Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

function formatScore(score: number | string | null | undefined): string {
  if (score == null) return '—';
  const n = typeof score === 'string' ? parseFloat(score) : score;
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(1);
}

function Badge({ label, muted }: { label: string; muted?: boolean }) {
  return (
    <View style={[styles.badge, muted && styles.badgeMuted]}>
      <Text style={[styles.badgeText, muted && styles.badgeTextMuted]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scrollWrapper: { flex: 1, minHeight: 0, backgroundColor: '#0B1020' },
  scrollWrapperWeb: {
    flex: 1,
    minHeight: 0,
    backgroundColor: '#0B1020',
    height: '100vh',
    maxHeight: '100vh',
    overflow: 'hidden',
  } as any,
  scrollView: {
    flex: 1,
    ...(Platform.OS === 'web' ? { height: '100%', overflow: 'auto' as const } : {}),
  } as any,
  scrollContent: { flexGrow: 1, paddingBottom: 40 },
  scrollContentWithBar: { paddingBottom: 88 },
  header: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 10 },
  title: { fontSize: 22, fontWeight: '700', color: '#FFFFFF' },
  subtle: { marginTop: 4, color: 'rgba(255,255,255,0.72)', fontSize: 12 },
  headerLocationBtn: { marginTop: 8, alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: '#1A73E8' },
  blueHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(26,115,232,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(26,115,232,0.35)',
  },
  blueHeaderTextBlock: { flex: 1 },
  blueHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  blueHeaderTitle: { fontSize: 18, fontWeight: '700', color: '#FFFFFF', marginBottom: 4 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  accountBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.25)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.5)', maxWidth: 180 },
  accountBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },
  adminBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: '#6366f1' },
  adminBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(26,115,232,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(26,115,232,0.35)',
  },
  bannerTextBlock: { flex: 1 },
  bannerText: { color: 'rgba(255,255,255,0.9)', fontSize: 13 },
  bannerTip: { marginTop: 6, color: 'rgba(255,255,255,0.65)', fontSize: 11, lineHeight: 16 },
  bannerBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: '#1A73E8' },
  bannerBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },
  searchRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingBottom: 10 },
  searchInput: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    color: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  refreshBtn: {
    height: 40,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: '#1A73E8',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  refreshText: { color: '#FFFFFF', fontWeight: '700' },
  btnPressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  poiSection: { marginHorizontal: 16, marginBottom: 12 },
  poiToggle: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(26,115,232,0.2)',
    borderWidth: 1,
    borderColor: 'rgba(26,115,232,0.4)',
  },
  poiToggleText: { color: '#90CAF9', fontWeight: '700', fontSize: 13 },
  poiSearchBox: { marginTop: 10, padding: 12, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.06)', gap: 10 },
  poiSearchLabel: { color: 'rgba(255,255,255,0.8)', fontSize: 12, lineHeight: 18 },
  poiLoadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  poiResults: { gap: 8 },
  poiResultItem: {
    padding: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  poiResultName: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  poiResultAddress: { color: 'rgba(255,255,255,0.65)', fontSize: 12, marginTop: 2 },
  poiResultAction: { color: '#64B5F6', fontSize: 12, marginTop: 6, fontWeight: '600' },
  mapAndList: {},
  mapSection: { width: '100%' },
  mapSectionTitle: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4, color: 'rgba(255,255,255,0.85)', fontSize: 14, fontWeight: '700' },
  mapSectionHint: { paddingHorizontal: 16, paddingBottom: 6, color: 'rgba(255,255,255,0.6)', fontSize: 12 },
  mapWrapper: { width: '100%', minHeight: 420, backgroundColor: 'rgba(0,0,0,0.2)' },
  mapPlaceholder: { width: '100%', height: 280, backgroundColor: 'rgba(0,0,0,0.15)', justifyContent: 'center', alignItems: 'center', borderRadius: 8, marginHorizontal: 16, marginBottom: 8 },
  mapPlaceholderText: { color: 'rgba(255,255,255,0.7)', fontSize: 14 },
  cardSelected: { borderColor: '#1A73E8', borderWidth: 2 },
  center: { alignItems: 'center', justifyContent: 'center', padding: 16, gap: 10 },
  errorTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '700', marginBottom: 2 },
  errorBody: { color: 'rgba(255,255,255,0.75)', fontSize: 13, textAlign: 'center' },
  primaryBtn: { marginTop: 6, backgroundColor: '#1A73E8', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10 },
  primaryBtnText: { color: '#FFFFFF', fontWeight: '700' },
  listContent: { padding: 16, paddingBottom: 40, gap: 12 },
  card: {
    borderRadius: 14,
    padding: 14,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  cardTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  cardTitle: { flex: 1, color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  cardActions: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  detailsBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: '#1A73E8' },
  detailsBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 12 },
  cardSub: { marginTop: 6, color: 'rgba(255,255,255,0.70)', fontSize: 13, lineHeight: 18 },
  badgesRow: { marginTop: 10, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  badge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: 'rgba(26,115,232,0.22)' },
  badgeMuted: { backgroundColor: 'rgba(255,255,255,0.10)' },
  badgeText: { color: '#CFE3FF', fontSize: 12, fontWeight: '600' },
  badgeTextMuted: { color: 'rgba(255,255,255,0.75)' },
  linkBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.10)' },
  linkBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 12 },
  selectedBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 24,
    backgroundColor: 'rgba(11, 16, 32, 0.97)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(26,115,232,0.4)',
    boxShadow: '0 -4px 20px rgba(0,0,0,0.3)',
  } as any,
  selectedBarInner: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  selectedBarTitle: {
    flex: 1,
    minWidth: 120,
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  selectedBarActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  selectedBarBtnPrimary: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#1A73E8',
  },
  selectedBarBtnPrimaryText: { color: '#FFFFFF', fontWeight: '800', fontSize: 13 },
  selectedBarBtnSecondary: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  selectedBarBtnSecondaryText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },
  selectedBarClose: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  selectedBarCloseText: { color: 'rgba(255,255,255,0.8)', fontSize: 16, fontWeight: '600' },
});

