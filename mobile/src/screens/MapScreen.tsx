import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  ActivityIndicator,
  Alert,
  TextInput,
  FlatList,
  Keyboard,
  Modal,
  ScrollView,
  Share,
  Image,
  Dimensions,
  Platform,
  Pressable,
  Switch,
} from 'react-native';
import { openInMapsWithChoice } from '../utils/maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import PloopMapView, { PloopMarker, PloopPolyline } from '../components/PloopMapView';
import { useMapProvider } from '../context/MapProviderContext';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import { api, DirectionStep, Toilet } from '../services/api';
import { searchNearbyToilets as searchGaodeToilets } from '../services/gaodePoi';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { hapticLight, hapticSuccess, getErrorMessage, isNetworkError, getOxymoronicTagline } from '../utils/engagement';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { PoiClickEvent } from '../native/PoiClickTypes';
import { PoiClickManager } from '../native/PoiClickManager';
import { LoadingBannerWithTrivia } from '../components/LoadingBannerWithTrivia';
import { useMapPreload } from '../context/MapPreloadContext';
import { API_BASE_URL } from '../config/api';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface Landmark {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  types?: string[];
}

type TravelMode = 'driving' | 'walking' | 'bicycling';
type RouteDestination = { latitude: number; longitude: number; title?: string; toiletId?: string };

// Placeholder while waiting for GPS – zoomed-out world view. Never used for fetching toilets.
const WAITING_COORDS = { latitude: 0, longitude: 0 };

/** Maps bracket text in toilet names (e.g. "Happy Toilet", "Hotel") to emoji logos. Keys are lowercase for lookup. */
const BRACKET_TO_EMOJI: Record<string, string> = {
  'happy toilet': '🚽',
  hotel: '🏨',
  hotels: '🏨',
  mall: '🏬',
  'shopping mall': '🏬',
  shopping: '🛒',
  restaurant: '🍽️',
  airport: '✈️',
  mrt: '🚇',
  train: '🚇',
  museum: '🏛️',
  park: '🏞️',
  hospital: '🏥',
  convenience: '🏪',
  gas: '⛽',
  petrol: '⛽',
  office: '🏢',
  gym: '🏋️',
  cinema: '🎬',
  library: '📚',
};

function parseToiletNameAndBadges(name: string): { displayName: string; badges: Array<{ label: string; emoji: string }> } {
  const badges: Array<{ label: string; emoji: string }> = [];
  let displayName = name;
  const matches = [...name.matchAll(/\(([^)]+)\)/g)];
  for (const m of matches) {
    const bracketText = m[1].trim();
    const emoji = BRACKET_TO_EMOJI[bracketText.toLowerCase()] ?? '🏷️';
    badges.push({ label: bracketText, emoji });
    displayName = displayName.replace(m[0], '').trim();
  }
  displayName = displayName.replace(/\s+/g, ' ').trim();
  return { displayName, badges };
}

const SOS_OPTIONS = [
  { id: 'toilet_paper', label: 'Toilet paper', emoji: '🧻', messageText: 'I need toilet paper' },
  { id: 'no_soap', label: 'No soap', emoji: '🧼', messageText: "There's no soap" },
  { id: 'flush', label: 'Flush not working', emoji: '🚿', messageText: "The flush isn't working" },
  { id: 'clog', label: 'Clogged', emoji: '🪠', messageText: 'The toilet is clogged' },
  { id: 'broken_tap', label: 'Broken tap', emoji: '🚰', messageText: 'The tap is broken' },
] as const;

const MapScreen: React.FC = () => {
  const navigation = useNavigation();
  const { user } = useAuth();
  const { t, locale, setLocale } = useLanguage();
  const preload = useMapPreload();
  const { provider: mapProvider, simulateChinaLocation, setSimulateChinaLocation, BEIJING_COORDS } = useMapProvider();
  const insets = useSafeAreaInsets();
  const { width, height } = Dimensions.get('window');
  const mapRef = useRef<any>(null);
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [toilets, setToilets] = useState<Toilet[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedToilet, setSelectedToilet] = useState<Toilet | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [landmarks, setLandmarks] = useState<Landmark[]>([]);
  const [landmarkSearchError, setLandmarkSearchError] = useState<string | null>(null);
  const [backendUnreachable, setBackendUnreachable] = useState(false);
  const [backendBannerDismissed, setBackendBannerDismissed] = useState(false);
  const [selectedLandmark, setSelectedLandmark] = useState<Landmark | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [tappedLocation, setTappedLocation] = useState<{
    latitude: number;
    longitude: number;
    place?: any;
    location?: any;
  } | null>(null);
  const [tappedPoiToilet, setTappedPoiToilet] = useState<Toilet | null>(null);
  const [loadingLocationDetails, setLoadingLocationDetails] = useState(false);
  const [viewMode, setViewMode] = useState<'map' | 'list'>('map');
  const handleNativePoiClickRef = useRef<(event: PoiClickEvent) => void>(() => {});
  const [mapReadyNonce, setMapReadyNonce] = useState(0);
  const [nativePoiEnabled, setNativePoiEnabled] = useState(false);
  const [routePolyline, setRoutePolyline] = useState<Array<{ latitude: number; longitude: number }> | null>(null);
  const [routeMeta, setRouteMeta] = useState<{ distanceText?: string; durationText?: string } | null>(null);
  const [routeSteps, setRouteSteps] = useState<DirectionStep[]>([]);
  const [routeFareText, setRouteFareText] = useState<string | null>(null);
  const [showSteps, setShowSteps] = useState(false);
  const [loadingDirections, setLoadingDirections] = useState(false);
  const [travelMode, setTravelMode] = useState<TravelMode>('walking');
  const [navigationActive, setNavigationActive] = useState(false);
  const [followUser, setFollowUser] = useState(true);
  const [routeDestination, setRouteDestination] = useState<RouteDestination | null>(null);
  const locationWatchRef = useRef<Location.LocationSubscription | null>(null);
  const hasEverReceivedLocationRef = useRef(false);
  const navigationActiveRef = useRef(false);
  const followUserRef = useRef(true);
  const travelModeRef = useRef<TravelMode>('walking');
  const routeDestinationRef = useRef<RouteDestination | null>(null);
  const currentCoordsRef = useRef<{ latitude: number; longitude: number } | null>(null);
  const lastLocationStateUpdateRef = useRef<{ atMs: number; coords: { latitude: number; longitude: number } } | null>(
    null
  );
  const lastRerouteAtMsRef = useRef<number>(0);
  const lastNativePoiClickAtRef = useRef<number>(0);
  const lastPoiEventRef = useRef<{ key: string; atMs: number } | null>(null);
  const lastRouteOriginRef = useRef<{ latitude: number; longitude: number } | null>(null);
  const rerouteInFlightRef = useRef(false);
  const routePolylineRef = useRef<Array<{ latitude: number; longitude: number }> | null>(null);
  const offRouteSinceMsRef = useRef<number | null>(null);
  const pendingMapPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestDirectionsToRef = useRef<
    | ((
        dest: RouteDestination,
        opts?: { originOverride?: { latitude: number; longitude: number }; silent?: boolean; fit?: boolean; userInitiated?: boolean }
      ) => Promise<void>)
    | null
  >(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [ploopSoundEnabled, setPloopSoundEnabled] = useState(true);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [favoritesLoaded, setFavoritesLoaded] = useState(false);
  const [savedToilets, setSavedToilets] = useState<Toilet[]>([]);
  const [filterWheelchairOnly, setFilterWheelchairOnly] = useState(false);
  const [filterFreeOnly, setFilterFreeOnly] = useState(false);
  const [filterBidetOnly, setFilterBidetOnly] = useState(false);
  const [minConfidence, setMinConfidence] = useState<number>(0);
  const [listTab, setListTab] = useState<'nearby' | 'saved' | 'lists'>('nearby');
  const [nearbyListLimit, setNearbyListLimit] = useState(10);
  const [collections, setCollections] = useState<Array<{ id: string; name: string; toilets: Array<Pick<Toilet, 'id' | 'name' | 'address' | 'latitude' | 'longitude'>>; createdAt: number }>>([]);
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(null);
  const [collectionsLoaded, setCollectionsLoaded] = useState(false);
  const [collectionModalOpen, setCollectionModalOpen] = useState(false);
  const [collectionModalToilet, setCollectionModalToilet] = useState<Toilet | null>(null);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [sosModalOpen, setSosModalOpen] = useState(false);
  const [localStats, setLocalStats] = useState<{ reviews: number; reports: number; favorites: number }>({
    reviews: 0,
    reports: 0,
    favorites: 0,
  });
  const [renderRegion, setRenderRegion] = useState<{
    latitude: number;
    longitude: number;
    latitudeDelta: number;
    longitudeDelta: number;
  } | null>(null);
  const pendingRegionRef = useRef<any>(null);
  const regionThrottleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRegionCommitAtRef = useRef<number>(0);
  const [arrivalHints, setArrivalHints] = useState<Array<{ id: string; hint_text: string; created_at: string }>>([]);
  const [arrivalHintsLoading, setArrivalHintsLoading] = useState(false);
  const [hintModalOpen, setHintModalOpen] = useState(false);
  const [hintText, setHintText] = useState('');
  const [submittingHint, setSubmittingHint] = useState(false);
  const [suggestionText, setSuggestionText] = useState('');
  const [suggestionSending, setSuggestionSending] = useState(false);
  const [suggestionSuccess, setSuggestionSuccess] = useState(false);

  const oxymoronicTagline = useMemo(() => getOxymoronicTagline(), []);

  const zoomControlsBottom = useMemo(() => {
    const bottomInset = Math.max(insets.bottom, 20);
    const base = bottomInset;
    if (viewMode !== 'map') return base;
    if (navigationActive) return bottomInset;
    // When a bottom sheet/card is open, lift controls well above so they don't block content.
    if (tappedLocation) return base + 240;
    if (selectedToilet) return base + 220;
    return base;
  }, [insets.bottom, navigationActive, selectedToilet, tappedLocation, viewMode]);

  const recenterToUser = useCallback(async () => {
    const coords =
      currentCoordsRef.current ??
      (location?.coords ? { latitude: location.coords.latitude, longitude: location.coords.longitude } : null);
    if (!coords || !mapRef.current) return;

    try {
      setFollowUser(true);
      const cam = await mapRef.current.getCamera();
      mapRef.current.animateCamera(
        {
          ...cam,
          center: { latitude: coords.latitude, longitude: coords.longitude },
          zoom: typeof cam.zoom === 'number' ? Math.max(cam.zoom, 16) : 16,
        },
        { duration: 260 }
      );
    } catch {
      // ignore
    }
  }, [location?.coords]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const v = await AsyncStorage.getItem('settings.ploopSoundEnabled');
        if (!mounted) return;
        setPloopSoundEnabled(v !== 'false');
      } catch {
        // ignore
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stats = await api.getLocalMetrics();
        if (!cancelled) setLocalStats(stats);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Collections (local-first)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem('collections.v1');
        if (!raw) {
          if (!cancelled) setCollections([]);
          return;
        }
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          if (!cancelled) setCollections(parsed);
        }
      } catch {
        if (!cancelled) setCollections([]);
      } finally {
        if (!cancelled) setCollectionsLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const persistCollections = useCallback(async (next: any) => {
    setCollections(next);
    try {
      await AsyncStorage.setItem('collections.v1', JSON.stringify(next));
    } catch {
      // ignore
    }
  }, []);

  const toggleToiletInCollection = useCallback(
    async (collectionId: string, toilet: Toilet) => {
      const next = collections.map((c) => {
        if (c.id !== collectionId) return c;
        const cToilets = c.toilets ?? [];
        const exists = cToilets.some((t) => t.id === toilet.id);
        const toilets = exists
          ? cToilets.filter((t) => t.id !== toilet.id)
          : [
              { id: toilet.id, name: toilet.name, address: toilet.address, latitude: toilet.latitude, longitude: toilet.longitude },
              ...cToilets,
            ];
        return { ...c, toilets };
      });
      await persistCollections(next);
      api.track('collection_toggled', { collectionId, toiletId: toilet.id });
    },
    [collections, persistCollections]
  );

  const createCollection = useCallback(
    async (name: string) => {
      const trimmed = name.trim();
      if (trimmed.length < 2) return;
      const id = `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      const next = [{ id, name: trimmed, toilets: [], createdAt: Date.now() }, ...collections];
      await persistCollections(next);
      api.track('collection_created', { collectionId: id });
      return id;
    },
    [collections, persistCollections]
  );

  // Load favorites (best-effort; no auth yet, device-based)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.listFavorites();
        if (cancelled) return;
        setSavedToilets((res.favorites || []) as any);
        setFavoriteIds(new Set((res.favorites || []).map((t: any) => t.id)));
      } catch {
        // ignore
      } finally {
        if (!cancelled) setFavoritesLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const isFavorite = useCallback((toiletId: string) => favoriteIds.has(toiletId), [favoriteIds]);

  const toggleFavorite = useCallback(
    async (toilet: Toilet) => {
      const already = favoriteIds.has(toilet.id);
      try {
        // optimistic
        setFavoriteIds((prev) => {
          const next = new Set(prev);
          if (already) next.delete(toilet.id);
          else next.add(toilet.id);
          return next;
        });
        if (already) await api.unfavoriteToilet(toilet.id);
        else await api.favoriteToilet(toilet.id);
        await api.bumpLocalMetric('favorites', already ? -1 : 1);
        setLocalStats(await api.getLocalMetrics());
        // Refresh saved list in background (keeps Saved tab accurate)
        try {
          const res = await api.listFavorites();
          setSavedToilets((res.favorites || []) as any);
        } catch {
          // ignore
        }
        api.track('favorite_toggle', { toiletId: toilet.id, to: already ? 'off' : 'on' });
        await (already ? hapticLight() : hapticSuccess());
      } catch (e: any) {
        // rollback
        setFavoriteIds((prev) => {
          const next = new Set(prev);
          if (already) next.add(toilet.id);
          else next.delete(toilet.id);
          return next;
        });
        Alert.alert('Favorites', getErrorMessage(e, 'Failed to update favorite.'));
      }
    },
    [favoriteIds]
  );

  const submitReport = useCallback(async (toilet: Toilet, type: 'closed' | 'out_of_order' | 'no_access' | 'gross' | 'busy' | 'needs_cleaning') => {
    try {
      await api.submitReport(toilet.id, { type });
      await api.bumpLocalMetric('reports', 1);
      setLocalStats(await api.getLocalMetrics());
      await hapticSuccess();
      api.track('report_submitted', { toiletId: toilet.id, type });
      Alert.alert('Thanks', 'Report submitted. This helps everyone.');
    } catch (e: any) {
      Alert.alert('Report', getErrorMessage(e, 'Failed to submit report.'));
    }
  }, []);

  const formatPloopScore = useCallback((n: any) => {
    const v = typeof n === 'number' ? n : parseInt(n || '0', 10);
    if (!Number.isFinite(v)) return null;
    return Math.max(0, Math.min(100, v));
  }, []);

  const shareToilet = useCallback(async (toilet: Toilet) => {
    try {
      const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${toilet.latitude},${toilet.longitude}`;
      await Share.share({
        message: `🚽 ${toilet.name}\n${toilet.address ? `${toilet.address}\n` : ''}${mapsUrl}`,
      });
      api.track('share_toilet', { toiletId: toilet.id });
    } catch {
      // ignore
    }
  }, []);

  const shareSosWithFriend = useCallback(async (toilet: Toilet, needId: string) => {
    const option = SOS_OPTIONS.find((o) => o.id === needId);
    const situationText = option?.messageText ?? option?.label ?? needId;
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
      // use toilet coords
    }
    const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
    const location = toilet.address || toilet.name || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    const message = `Please help! ${situationText} at ${toilet.name}, ${location}. My location: ${mapsUrl}`;
    try {
      await Share.share({ message, title: 'Ploop SOS – Need help' });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      api.track('sos_shared', { toiletId: toilet.id, needType: needId });
      setSosModalOpen(false);
    } catch {
      // User cancelled
    }
  }, []);

  const activeCollection = useMemo(() => {
    if (!activeCollectionId) return null;
    return collections.find((c) => c.id === activeCollectionId) || null;
  }, [activeCollectionId, collections]);

  const unlockedBadges = useMemo(() => {
    const { reviews, reports, favorites } = localStats;
    const badges = [
      { key: 'first_flush', label: 'First Flush', emoji: '🚽', target: 1, current: reviews },
      { key: 'scout', label: 'Scout', emoji: '🔍', target: 3, current: reports },
      { key: 'collector', label: 'Collector', emoji: '⭐', target: 3, current: favorites },
      { key: 'reviewer', label: 'Reviewer', emoji: '📝', target: 3, current: reviews },
      { key: 'hero', label: 'Hero', emoji: '🏆', target: 5, current: Math.min(reviews, reports), needsBoth: true },
    ];
    return badges.map((b) => ({
      ...b,
      ok: b.needsBoth ? reviews >= b.target && reports >= b.target : b.current >= b.target,
      progress: b.needsBoth ? `${Math.min(reviews, reports)}/${b.target}` : `${b.current}/${b.target}`,
    }));
  }, [localStats]);


  // Coords for map display – use real location, or Beijing when simulating China (dev)
  const displayCoords = simulateChinaLocation ? BEIJING_COORDS : (location?.coords ?? WAITING_COORDS);
  const hasRealLocation = !!location?.coords || simulateChinaLocation;

  useEffect(() => {
    navigationActiveRef.current = navigationActive;
  }, [navigationActive]);

  useEffect(() => {
    followUserRef.current = followUser;
  }, [followUser]);

  useEffect(() => {
    travelModeRef.current = travelMode;
  }, [travelMode]);

  useEffect(() => {
    routeDestinationRef.current = routeDestination;
  }, [routeDestination]);

  useEffect(() => {
    routePolylineRef.current = routePolyline;
  }, [routePolyline]);

  useEffect(() => {
    if (simulateChinaLocation) {
      setLocation({ coords: BEIJING_COORDS } as any);
      fetchNearbyToilets(BEIJING_COORDS).catch(() => {});
      setLoading(false);
    } else if (preload) {
      setLocation(preload.location);
      setToilets(preload.toilets);
      setLoading(false);
      hasEverReceivedLocationRef.current = true;
      currentCoordsRef.current = preload.location.coords;
      lastLocationStateUpdateRef.current = { atMs: Date.now(), coords: preload.location.coords };
      startLocationWatch({ highAccuracy: false });
    } else {
      getLocationAndToilets();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- getLocationAndToilets is stable; only re-run when simulateChinaLocation or preload changes
  }, [simulateChinaLocation, preload]);

  // When we first get real location (or simulate China), fly map to user (from zoomed-out placeholder)
  const hasAnimatedToUserRef = useRef(false);
  useEffect(() => {
    if (simulateChinaLocation) hasAnimatedToUserRef.current = false;
  }, [simulateChinaLocation]);
  useEffect(() => {
    const coords = simulateChinaLocation ? BEIJING_COORDS : location?.coords;
    if (coords && !hasAnimatedToUserRef.current && mapRef.current) {
      hasAnimatedToUserRef.current = true;
      mapRef.current.animateToRegion(
        { latitude: coords.latitude, longitude: coords.longitude, latitudeDelta: 0.01, longitudeDelta: 0.01 },
        400
      );
    }
  }, [location?.coords?.latitude, location?.coords?.longitude, simulateChinaLocation, BEIJING_COORDS]);

  useEffect(() => {
    return () => {
      // Cleanup location watch on unmount
      try {
        locationWatchRef.current?.remove();
      } catch {
        // ignore
      } finally {
        locationWatchRef.current = null;
      }
    };
  }, []);

  const metersBetween = useCallback((a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) => {
    const toRad = (x: number) => (x * Math.PI) / 180;
    const R = 6371000;
    const dLat = toRad(b.latitude - a.latitude);
    const dLng = toRad(b.longitude - a.longitude);
    const lat1 = toRad(a.latitude);
    const lat2 = toRad(b.latitude);
    const s =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
    return R * c;
  }, []);

  const fetchNearbyToilets = useCallback(
    async (coords: { latitude: number; longitude: number }) => {
      const cacheKey = `cache.nearbyToilets.v2.${filterWheelchairOnly ? 1 : 0}.${filterFreeOnly ? 1 : 0}.${filterBidetOnly ? 1 : 0}.${minConfidence}.${mapProvider}`;
      const mergeWithGaode = mapProvider === 'amap';

      const mergeAndSort = (backendToilets: Toilet[], gaodeToilets: Toilet[]): Toilet[] => {
        const DEDUPE_METERS = 40;
        const center = { latitude: coords.latitude, longitude: coords.longitude };
        const isNear = (a: Toilet, b: Toilet) =>
          metersBetween({ latitude: a.latitude, longitude: a.longitude }, { latitude: b.latitude, longitude: b.longitude }) < DEDUPE_METERS;
        const gaodeFiltered = gaodeToilets.filter(
          (g) => !backendToilets.some((b) => isNear(g, b))
        );
        const merged = [...backendToilets, ...gaodeFiltered];
        return merged
          .map((t) => ({
            ...t,
            distance: t.distance ?? Math.round(metersBetween(center, { latitude: t.latitude, longitude: t.longitude })),
          }))
          .sort((a, b) => (a.distance ?? 999999) - (b.distance ?? 999999));
      };

      try {
        const [backendRes, gaodeToilets] = await Promise.all([
          api.getNearbyToilets({
            latitude: coords.latitude,
            longitude: coords.longitude,
            radius: 2000,
            wheelchair_accessible: filterWheelchairOnly ? true : undefined,
            free_only: filterFreeOnly ? true : undefined,
            has_bidet: filterBidetOnly ? true : undefined,
            min_confidence: minConfidence > 0 ? minConfidence : undefined,
          }),
          mergeWithGaode
            ? searchGaodeToilets({
                latitude: coords.latitude,
                longitude: coords.longitude,
                radius: 5000,
                limit: 80,
              })
            : Promise.resolve([]),
        ]);

        const backendToilets = backendRes?.toilets ?? [];
        let toilets = mergeWithGaode ? mergeAndSort(backendToilets, gaodeToilets) : backendToilets;
        if (filterBidetOnly) {
          toilets = toilets.filter((t) => t.has_bidet === true);
        }
        setToilets(toilets);
        setBackendUnreachable(false);
        try {
          await AsyncStorage.setItem(
            cacheKey,
            JSON.stringify({ atMs: Date.now(), coords, toilets })
          );
        } catch {
          // ignore cache write failures
        }
      } catch (e: any) {
        if (isNetworkError(e)) setBackendUnreachable(true);
        // If the backend request fails, try cache; when using Amap, also try Gaode-only.
        try {
          const raw = await AsyncStorage.getItem(cacheKey);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed?.toilets)) {
              if (__DEV__) console.log('Using cached toilets (backend request failed).');
              setToilets(parsed.toilets ?? []);
              return;
            }
          }
        } catch {
          // ignore cache read failures
        }
        if (mergeWithGaode) {
          try {
            const gaodeToilets = await searchGaodeToilets({
              latitude: coords.latitude,
              longitude: coords.longitude,
              radius: 5000,
              limit: 80,
            });
            if (gaodeToilets.length > 0) {
              const center = { latitude: coords.latitude, longitude: coords.longitude };
              const sorted = gaodeToilets
                .map((t) => ({ ...t, distance: t.distance ?? Math.round(metersBetween(center, { latitude: t.latitude, longitude: t.longitude })) }))
                .sort((a, b) => (a.distance ?? 999999) - (b.distance ?? 999999));
              setToilets(sorted);
              return;
            }
          } catch {
            // ignore
          }
        }
        throw e;
      }
    },
    [filterFreeOnly, filterWheelchairOnly, filterBidetOnly, minConfidence, mapProvider, metersBetween]
  );

  // Don't fetch until we have real location – getLocationAndToilets will fetch when GPS is ready

  const snapToPolyline = useCallback(
    (
      point: { latitude: number; longitude: number },
      poly: Array<{ latitude: number; longitude: number }>
    ): { snapped: { latitude: number; longitude: number }; distanceMeters: number } => {
      // Use a fast local projection (equirectangular) for segment distance.
      const lat0 = (point.latitude * Math.PI) / 180;
      const toXY = (c: { latitude: number; longitude: number }) => {
        const x = (c.longitude * Math.PI) / 180 * Math.cos(lat0) * 6371000;
        const y = (c.latitude * Math.PI) / 180 * 6371000;
        return { x, y };
      };

      const p = toXY(point);
      let bestD2 = Number.POSITIVE_INFINITY;
      let bestXY = p;

      for (let i = 0; i < poly.length - 1; i++) {
        const a = toXY(poly[i]);
        const b = toXY(poly[i + 1]);
        const abx = b.x - a.x;
        const aby = b.y - a.y;
        const apx = p.x - a.x;
        const apy = p.y - a.y;
        const abLen2 = abx * abx + aby * aby;
        const t = abLen2 > 0 ? Math.max(0, Math.min(1, (apx * abx + apy * aby) / abLen2)) : 0;
        const cx = a.x + t * abx;
        const cy = a.y + t * aby;
        const dx = p.x - cx;
        const dy = p.y - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) {
          bestD2 = d2;
          bestXY = { x: cx, y: cy };
        }
      }

      // Convert snapped XY back to lat/lng
      const snappedLat = (bestXY.y / 6371000) * (180 / Math.PI);
      const snappedLng = (bestXY.x / (6371000 * Math.cos(lat0))) * (180 / Math.PI);
      return {
        snapped: { latitude: snappedLat, longitude: snappedLng },
        distanceMeters: Math.sqrt(bestD2),
      };
    },
    []
  );

  const startLocationWatch = useCallback(
    async (opts?: { highAccuracy?: boolean }) => {
      try {
        locationWatchRef.current?.remove();
      } catch {
        // ignore
      }

      try {
        const bestNavAccuracy = (Location.Accuracy as any).BestForNavigation ?? Location.Accuracy.High;
        locationWatchRef.current = await Location.watchPositionAsync(
          {
            accuracy: opts?.highAccuracy ? bestNavAccuracy : Location.Accuracy.Balanced,
            // Note: `timeInterval` is Android-only; iOS ignores it.
            timeInterval: opts?.highAccuracy ? 700 : 2500,
            distanceInterval: opts?.highAccuracy ? 1 : 5,
          },
          async (pos) => {
            const nowCoords = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
            currentCoordsRef.current = nowCoords;

            if (!hasEverReceivedLocationRef.current) {
              hasEverReceivedLocationRef.current = true;
              lastLocationStateUpdateRef.current = { atMs: Date.now(), coords: nowCoords };
              setLocation(pos); // first fix updates UI
              try {
                await fetchNearbyToilets({
                  latitude: pos.coords.latitude,
                  longitude: pos.coords.longitude,
                });
              } catch {
                // ignore
              } finally {
                setLoading(false);
              }
            } else {
              // Throttle state updates to avoid re-rendering the entire map on every GPS tick.
              const last = lastLocationStateUpdateRef.current;
              const nowMs = Date.now();

              const moved = last ? metersBetween(last.coords, nowCoords) : 9999;
              const elapsed = last ? nowMs - last.atMs : 999999;

              // Update UI location occasionally (and a bit more often when NOT navigating).
              const shouldUpdateLocationState =
                (!navigationActiveRef.current && (elapsed > 8000 || moved > 25)) ||
                (navigationActiveRef.current && elapsed > 20000);

              if (shouldUpdateLocationState) {
                lastLocationStateUpdateRef.current = { atMs: nowMs, coords: nowCoords };
                setLocation(pos);
              }

              // Reroute logic lives here (not in a render-driven effect) to reduce lag.
              const dest = routeDestinationRef.current;
              if (navigationActiveRef.current && dest && lastRouteOriginRef.current) {
                const accuracyM = typeof pos.coords.accuracy === 'number' ? pos.coords.accuracy : undefined;

                const poly = routePolylineRef.current;
                const snap = poly && poly.length > 1 ? snapToPolyline(nowCoords, poly) : null;
                const offRouteMeters = snap?.distanceMeters;

                // Consider us "off route" only if accuracy is reasonably good.
                const canTrust = !accuracyM || accuracyM <= 35;
                const mode = travelModeRef.current;
                const offRouteThreshold =
                  mode === 'driving' ? 45 : 25; // walk/bike: tighter; drive: looser

                const isOffRoute = canTrust && typeof offRouteMeters === 'number' && offRouteMeters > offRouteThreshold;
                if (isOffRoute) {
                  if (offRouteSinceMsRef.current == null) offRouteSinceMsRef.current = nowMs;
                } else {
                  offRouteSinceMsRef.current = null;
                }

                const offRouteForMs = offRouteSinceMsRef.current != null ? nowMs - offRouteSinceMsRef.current : 0;

                // Re-route when clearly off the polyline for a short sustained window,
                // with a cooldown to prevent thrash.
                if (offRouteForMs >= 2500 && !rerouteInFlightRef.current) {
                  const lastRerouteMs = lastRerouteAtMsRef.current;
                  if (nowMs - lastRerouteMs >= 8000) {
                    rerouteInFlightRef.current = true;
                    lastRerouteAtMsRef.current = nowMs;
                    requestDirectionsToRef.current?.(
                      { latitude: dest.latitude, longitude: dest.longitude, title: dest.title },
                      { originOverride: nowCoords, silent: true, fit: false }
                    )
                      .catch(() => {
                        // ignore
                      })
                      .finally(() => {
                        setTimeout(() => {
                          rerouteInFlightRef.current = false;
                        }, 4000);
                      });
                  }
                }
              }
            }

            if (navigationActiveRef.current && followUserRef.current && mapRef.current) {
              try {
                const poly = routePolylineRef.current;
                const snap = poly && poly.length > 1 ? snapToPolyline(nowCoords, poly) : null;
                const useSnapped =
                  snap &&
                  // Only snap when we're already close-ish to the route to avoid "teleporting"
                  snap.distanceMeters <= 25;
                const center = useSnapped ? snap.snapped : nowCoords;

                const cam = await mapRef.current.getCamera();
                mapRef.current.animateCamera(
                  {
                    ...cam,
                    center: {
                      latitude: center.latitude,
                      longitude: center.longitude,
                    },
                    zoom: typeof cam.zoom === 'number' ? Math.max(cam.zoom, 16) : 16,
                  },
                  { duration: 220 }
                );
              } catch {
                // ignore camera errors
              }
            }
          }
        );
      } catch {
        // If watch fails, we still can try one-shot location.
      }
    },
    [fetchNearbyToilets, metersBetween, snapToPolyline]
  );

  // Upgrade / downgrade tracking accuracy based on whether navigation is active
  useEffect(() => {
    // Only restart if we already requested permissions (i.e., app has started)
    if (!location) return;
    startLocationWatch({ highAccuracy: navigationActive });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigationActive]);

  // Refresh toilets when returning to this screen (e.g., after submitting a review)
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        try {
          const coords = simulateChinaLocation ? BEIJING_COORDS : location?.coords;
          if (!coords) return;
          await fetchNearbyToilets(coords);
          if (cancelled) return;
          try {
            const stats = await api.getLocalMetrics();
            if (!cancelled) setLocalStats(stats);
          } catch {
            // ignore
          }
        } catch (e) {
          // Silent: keep existing list if refresh fails
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [filterFreeOnly, filterWheelchairOnly, filterBidetOnly, location?.coords?.latitude, location?.coords?.longitude, minConfidence, simulateChinaLocation, fetchNearbyToilets])
  );

  useEffect(() => {
    if (!settingsOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const stats = await api.getLocalMetrics();
        if (!cancelled) setLocalStats(stats);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [settingsOpen]);

  // When POI sheet is open, resolve toilet by placeId for Save button
  useEffect(() => {
    const placeId = tappedLocation?.place?.placeId ?? tappedLocation?.place?.id;
    if (!placeId) {
      setTappedPoiToilet(null);
      return;
    }
    let cancelled = false;
    api.getToiletByPlaceId(placeId).then((toilet) => {
      if (!cancelled) setTappedPoiToilet(toilet ?? null);
    }).catch(() => {
      if (!cancelled) setTappedPoiToilet(null);
    });
    return () => { cancelled = true; };
  }, [tappedLocation?.place?.placeId, tappedLocation?.place?.id]);

  // Search landmarks only when user has opened search (avoids hitting backend on every map load)
  useEffect(() => {
    if (!showSearch) return;

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (!searchQuery.trim()) {
      searchTimeoutRef.current = setTimeout(async () => {
        await searchLandmarks('');
      }, 300);
      return () => {
        if (searchTimeoutRef.current) {
          clearTimeout(searchTimeoutRef.current);
        }
      };
    }

    searchTimeoutRef.current = setTimeout(async () => {
      await searchLandmarks();
    }, 500);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery, showSearch]);

  const getLocationAndToilets = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Location permission is required to find nearby toilets.');
        setLoading(false);
        return;
      }

      // Start live tracking immediately so location updates work even if the
      // one-shot request times out (common on simulator unless location is set).
      await startLocationWatch({ highAccuracy: false });

      // Fast path: use last known position if available
      try {
        const lastKnown = await Location.getLastKnownPositionAsync({});
        if (lastKnown) {
          setLocation(lastKnown);
          currentCoordsRef.current = { latitude: lastKnown.coords.latitude, longitude: lastKnown.coords.longitude };
          lastLocationStateUpdateRef.current = { atMs: Date.now(), coords: currentCoordsRef.current };
          if (!hasEverReceivedLocationRef.current) {
            hasEverReceivedLocationRef.current = true;
            await fetchNearbyToilets({
              latitude: lastKnown.coords.latitude,
              longitude: lastKnown.coords.longitude,
            });
          }
          setLoading(false);
          return;
        }
      } catch {
        // ignore
      }

      // No last known: show zoomed-out map; watch or getCurrentPosition will update when GPS fixes
      if (!hasEverReceivedLocationRef.current) {
        setLoading(false);
      }

      // Get fresh position in background (6s timeout); watch callback will also update when ready
      const LOCATION_TIMEOUT_MS = 6000;
      try {
        const currentLocation = (await Promise.race([
          Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Location request timed out')), LOCATION_TIMEOUT_MS)
          ),
        ])) as Location.LocationObject;
        if (currentLocation?.coords) {
          setLocation(currentLocation);
          currentCoordsRef.current = { latitude: currentLocation.coords.latitude, longitude: currentLocation.coords.longitude };
          lastLocationStateUpdateRef.current = { atMs: Date.now(), coords: currentCoordsRef.current };
          await fetchNearbyToilets({
            latitude: currentLocation.coords.latitude,
            longitude: currentLocation.coords.longitude,
          });
        }
      } catch {
        // Timeout or error; map already shows with fallback
      }
    } catch (error: any) {
      console.error('Error getting location:', error);
      // Show zoomed-out map; user can retry. Simulator: set Features → Location for real GPS.
    } finally {
      setLoading(false);
    }
  };

  const toiletsWithReviews = useMemo(() => {
    const list = Array.isArray(toilets) ? toilets : [];
    return list
      .filter((t) => (t.total_reviews || 0) > 0)
      .sort((a, b) => (a.distance ?? 999999) - (b.distance ?? 999999));
  }, [toilets]);

  const normalizePhotoUrl = useCallback((raw?: string) => {
    if (!raw) return undefined;
    if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
    if (raw.startsWith('/')) return `${API_BASE_URL}${raw}`;
    return `${API_BASE_URL}/${raw}`;
  }, []);

  const zoomBy = useCallback(async (delta: number) => {
    const ref = mapRef.current;
    if (!ref) return;
    try {
      const cam = await ref.getCamera();
      const currentZoom = typeof cam.zoom === 'number' ? cam.zoom : 14;
      const nextZoom = Math.max(2, Math.min(20, currentZoom + delta));
      ref.animateCamera({ ...cam, zoom: nextZoom }, { duration: 160 });
    } catch (e) {
      // no-op
    }
  }, []);

  const decodePolyline = (encoded: string): Array<{ latitude: number; longitude: number }> => {
    let index = 0;
    const len = encoded.length;
    let lat = 0;
    let lng = 0;
    const coordinates: Array<{ latitude: number; longitude: number }> = [];

    while (index < len) {
      let b = 0;
      let shift = 0;
      let result = 0;
      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const dlat = (result & 1) ? ~(result >> 1) : result >> 1;
      lat += dlat;

      shift = 0;
      result = 0;
      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const dlng = (result & 1) ? ~(result >> 1) : result >> 1;
      lng += dlng;

      coordinates.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
    }

    return coordinates;
  };

  const stripHtml = (input?: string): string | undefined => {
    if (typeof input !== 'string') return undefined;
    const s = input
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim();
    return s ? s : undefined;
  };

  const haversineMeters = (a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) => {
    const toRad = (x: number) => (x * Math.PI) / 180;
    const R = 6371000;
    const dLat = toRad(b.latitude - a.latitude);
    const dLng = toRad(b.longitude - a.longitude);
    const lat1 = toRad(a.latitude);
    const lat2 = toRad(b.latitude);
    const s =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
    return R * c;
  };

  const requestDirectionsTo = useCallback(
    async (
      dest: RouteDestination,
      opts?: { originOverride?: { latitude: number; longitude: number }; silent?: boolean; fit?: boolean; userInitiated?: boolean }
    ) => {
      const origin = opts?.originOverride
        ? opts.originOverride
        : currentCoordsRef.current
          ? currentCoordsRef.current
          : location?.coords
            ? { latitude: location.coords.latitude, longitude: location.coords.longitude }
            : null;

      if (!origin) {
        Alert.alert('Directions', 'Current location not available yet.');
        return;
      }
      try {
        if (!opts?.silent) setLoadingDirections(true);
        const round4 = (n: number) => Math.round(n * 10000) / 10000;
        const cacheKey = `cache.directions.v1.${travelMode}.${round4(origin.latitude)}.${round4(origin.longitude)}.${round4(dest.latitude)}.${round4(dest.longitude)}`;

        let result: any | null = null;
        try {
          result = await api.getDirections({
            originLat: origin.latitude,
            originLng: origin.longitude,
            destLat: dest.latitude,
            destLng: dest.longitude,
            mode: travelMode,
          });
          try {
            await AsyncStorage.setItem(cacheKey, JSON.stringify({ atMs: Date.now(), origin, dest, mode: travelMode, result }));
          } catch {
            // ignore cache write failures
          }
        } catch (e) {
          // If network fails, try cached directions so navigation doesn't break.
          try {
            const raw = await AsyncStorage.getItem(cacheKey);
            if (raw) {
              const parsed = JSON.parse(raw);
              if (parsed?.result) {
                result = parsed.result;
                if (__DEV__) console.log('Using cached directions (network failed).');
              }
            }
          } catch {
            // ignore cache read failures
          }
          if (!result) throw e;
        }
        const points = result.polyline ? decodePolyline(result.polyline) : [];
        setRoutePolyline(points);
        setRouteMeta({ distanceText: result.distanceText, durationText: result.durationText });
        setRouteSteps(Array.isArray(result.steps) ? result.steps : []);
        setRouteFareText(typeof result.transitFareText === 'string' ? result.transitFareText : null);
        setRouteDestination({ latitude: dest.latitude, longitude: dest.longitude, title: dest.title, toiletId: dest.toiletId });
        lastRouteOriginRef.current = origin;
        setNavigationActive(true);
        setFollowUser(true);

        // When the user explicitly starts navigation, collapse other overlays so the map stays usable.
        if (opts?.userInitiated) {
          Keyboard.dismiss();
          setTappedLocation(null);
          setSelectedToilet(null);
          setSelectedLandmark(null);
          setShowSearch(false);
        }

        const shouldFit = opts?.fit !== false;
        if (shouldFit && points.length > 1 && mapRef.current) {
          mapRef.current.fitToCoordinates(points, {
            edgePadding: { top: 120, right: 60, bottom: 220, left: 60 },
            animated: true,
          });
        }
      } catch (e: any) {
        const msg = e?.response?.data?.error || e?.message || 'Failed to load directions.';
        Alert.alert('Directions', msg);
      } finally {
        if (!opts?.silent) setLoadingDirections(false);
      }
    },
    [location?.coords, travelMode]
  );

  const onRegionChangeComplete = useCallback((region: any) => {
    pendingRegionRef.current = region;
    const now = Date.now();
    const elapsed = now - lastRegionCommitAtRef.current;
    // Use longer throttle for Amap – reduces re-renders during pan/zoom
    const throttleMs = mapProvider === 'amap' ? 1100 : 650;
    const commit = () => {
      lastRegionCommitAtRef.current = Date.now();
      setRenderRegion(pendingRegionRef.current);
      pendingRegionRef.current = null;
    };
    if (elapsed > throttleMs) {
      commit();
      return;
    }
    if (!regionThrottleTimerRef.current) {
      regionThrottleTimerRef.current = setTimeout(() => {
        regionThrottleTimerRef.current = null;
        if (pendingRegionRef.current) commit();
      }, throttleMs - elapsed);
    }
  }, [mapProvider]);

  const toiletsToRenderOnMap = useMemo(() => {
    const t = toilets ?? [];
    if (viewMode !== 'map') return t;
    const r = renderRegion;
    if (!r) return t;

    const expand = 1.35;
    const latHalf = (r.latitudeDelta * expand) / 2;
    const lngHalf = (r.longitudeDelta * expand) / 2;
    const minLat = r.latitude - latHalf;
    const maxLat = r.latitude + latHalf;
    const minLng = r.longitude - lngHalf;
    const maxLng = r.longitude + lngHalf;

    let filtered = (Array.isArray(toilets) ? toilets : []).filter((t) => t.latitude >= minLat && t.latitude <= maxLat && t.longitude >= minLng && t.longitude <= maxLng);

    // When zoomed out, cap marker count to keep the map smooth.
    // Use lower cap for Amap (Gaode) – tends to be slower with many markers
    const markerCap = mapProvider === 'amap' ? 50 : 180;
    if (r.longitudeDelta > 0.06 && filtered.length > markerCap) {
      const center = { latitude: r.latitude, longitude: r.longitude };
      filtered = filtered
        .map((t) => ({
          t,
          d: typeof t.distance === 'number' ? t.distance : metersBetween(center, { latitude: t.latitude, longitude: t.longitude }),
        }))
        .sort((a, b) => a.d - b.d)
        .slice(0, markerCap)
        .map((x) => x.t);
    }

    return filtered;
  }, [metersBetween, mapProvider, renderRegion, toilets, viewMode]);

  const mapMarkers = useMemo(() => {
    // Returns either individual toilets or cluster markers (when zoomed out).
    const r = renderRegion;
    if (viewMode !== 'map') return { clusters: [] as any[], toilets: toiletsToRenderOnMap };
    if (!r || r.longitudeDelta < 0.08) return { clusters: [] as any[], toilets: toiletsToRenderOnMap };

    const cellLat = Math.max(0.0025, r.latitudeDelta / 12);
    const cellLng = Math.max(0.0025, r.longitudeDelta / 12);
    const groups = new Map<string, Toilet[]>();

    for (const t of toiletsToRenderOnMap) {
      const key = `${Math.floor(t.latitude / cellLat)}:${Math.floor(t.longitude / cellLng)}`;
      const arr = groups.get(key);
      if (arr) arr.push(t);
      else groups.set(key, [t]);
    }

    const clusters: Array<{ key: string; latitude: number; longitude: number; count: number; toilets: Toilet[] }> = [];
    const singles: Toilet[] = [];

    for (const [key, arr] of groups.entries()) {
      if (arr.length <= 1) {
        singles.push(arr[0]);
        continue;
      }
      const lat = arr.reduce((s, x) => s + x.latitude, 0) / arr.length;
      const lng = arr.reduce((s, x) => s + x.longitude, 0) / arr.length;
      clusters.push({ key, latitude: lat, longitude: lng, count: arr.length, toilets: arr });
    }

    // When zoomed out, prioritize clusters over singles to reduce marker count.
    return { clusters, toilets: singles };
  }, [renderRegion, toiletsToRenderOnMap, viewMode]);

  const nearbyToiletsSorted = useMemo(() => {
    const t = Array.isArray(toilets) ? toilets : [];
    const center = renderRegion
      ? { latitude: renderRegion.latitude, longitude: renderRegion.longitude }
      : location?.coords
        ? { latitude: location.coords.latitude, longitude: location.coords.longitude }
        : null;
    if (!center) return t;
    return [...t]
      .map((toilet) => ({
        ...toilet,
        distance: toilet.distance ?? Math.round(metersBetween(center, { latitude: toilet.latitude, longitude: toilet.longitude })),
      }))
      .sort((a, b) => (a.distance ?? 999999) - (b.distance ?? 999999));
  }, [toilets, renderRegion, location?.coords?.latitude, location?.coords?.longitude, metersBetween]);

  useEffect(() => {
    setNearbyListLimit(10);
  }, [toilets]);

  const arrivalInfo = useMemo(() => {
    if (!navigationActive || !routeDestination) return null;
    const cur =
      currentCoordsRef.current ??
      (location?.coords ? { latitude: location.coords.latitude, longitude: location.coords.longitude } : null);
    if (!cur) return null;
    const meters = metersBetween(cur, { latitude: routeDestination.latitude, longitude: routeDestination.longitude });
    return { meters, active: meters <= 60 };
  }, [location?.coords, metersBetween, navigationActive, routeDestination]);

  const arrivalToilet = useMemo(() => {
    const id = routeDestination?.toiletId;
    if (!id) return null;
    return toilets.find((t) => t.id === id) || savedToilets.find((t) => t.id === id) || null;
  }, [routeDestination?.toiletId, savedToilets, toilets]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const toiletId = routeDestination?.toiletId;
      if (!arrivalInfo?.active || !toiletId) return;
      try {
        setArrivalHintsLoading(true);
        const res = await api.getHints(toiletId);
        if (!cancelled) setArrivalHints(res.hints || []);
      } catch {
        if (!cancelled) setArrivalHints([]);
      } finally {
        if (!cancelled) setArrivalHintsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [arrivalInfo?.active, routeDestination?.toiletId]);

  useEffect(() => {
    requestDirectionsToRef.current = requestDirectionsTo;
  }, [requestDirectionsTo]);

  const clearDirections = useCallback(() => {
    setRoutePolyline(null);
    setRouteMeta(null);
    setRouteSteps([]);
    setRouteFareText(null);
    setShowSteps(false);
    setRouteDestination(null);
    setNavigationActive(false);
    setFollowUser(false);
  }, []);

  // Re-route when travel mode changes while navigating
  useEffect(() => {
    if (!navigationActive || !routeDestination) return;
    requestDirectionsTo(routeDestination, { fit: false, originOverride: currentCoordsRef.current ?? undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [travelMode]);

  const searchLandmarks = async (query?: string) => {
    try {
      setSearchLoading(true);
      setLandmarkSearchError(null);
      const searchTerm = query !== undefined ? query : searchQuery;
      const result = await api.searchLandmarks({
        query: searchTerm,
        latitude: location?.coords.latitude,
        longitude: location?.coords.longitude,
      });
      setLandmarks(result.landmarks || []);
      setBackendUnreachable(false);
    } catch (error: any) {
      if (isNetworkError(error)) setBackendUnreachable(true);
      console.error('Error searching landmarks:', error?.message || error);
      setLandmarks([]);
      setLandmarkSearchError('Search unavailable. Check Wi‑Fi and that the backend is running.');
    } finally {
      setSearchLoading(false);
    }
  };

  const handleLandmarkSelect = async (landmark: Landmark) => {
    Keyboard.dismiss();
    setSelectedLandmark(landmark);
    setSearchQuery('');
    setShowSearch(false);

    try {
      setLoadingLocationDetails(true);
      setSelectedToilet(null);
      setTappedLocation(null);

      // `landmark.id` is treated as a Google Place ID by our backend.
      try {
        const place = await api.getLandmarkDetails(landmark.id);
        setTappedLocation({
          latitude: place.latitude ?? landmark.latitude,
          longitude: place.longitude ?? landmark.longitude,
          location: {
            latitude: place.latitude ?? landmark.latitude,
            longitude: place.longitude ?? landmark.longitude,
            address: place.address ?? landmark.address,
          },
          place: {
            placeId: place.id,
            name: place.name ?? landmark.name,
            address: place.address ?? landmark.address,
            googleRating: place.googleRating,
            googleReviewCount: place.googleReviewCount,
            googleReviews: place.googleReviews,
            openNow: (place as any).openNow,
            weekdayText: (place as any).weekdayText,
          },
        });
        return;
      } catch {
        // ignore; fall back to coordinate-based detection
      }

      const details = await api.getLocationDetails({
        latitude: landmark.latitude,
        longitude: landmark.longitude,
      });
      setTappedLocation({
        latitude: landmark.latitude,
        longitude: landmark.longitude,
        ...details,
      });
    } finally {
      setLoadingLocationDetails(false);
    }
  };

  /**
   * Handle native POI click events (when native module is available)
   */
  const handleNativePoiClick = async (event: PoiClickEvent) => {
    try {
      // Dedupe: the same POI tap can arrive from both native bridge + MapView onPoiClick.
      const key = event.placeId
        ? `pid:${event.placeId}`
        : `ll:${event.latitude.toFixed(5)},${event.longitude.toFixed(5)}`;
      const now = Date.now();
      if (lastPoiEventRef.current && lastPoiEventRef.current.key === key && now - lastPoiEventRef.current.atMs < 650) {
        return;
      }
      lastPoiEventRef.current = { key, atMs: now };

      lastNativePoiClickAtRef.current = Date.now();
      setSelectedToilet(null);
      setSelectedLandmark(null);
      setLoadingLocationDetails(true);

      // Show the bottom sheet immediately for responsiveness, then hydrate with details.
      setTappedLocation({
        latitude: event.latitude,
        longitude: event.longitude,
        location: {
          latitude: event.latitude,
          longitude: event.longitude,
          address: '',
        },
        place: event.placeId
          ? {
              placeId: event.placeId,
              name: event.name,
            }
          : undefined,
      });

      // If native gives us a placeId, use it for Google-Maps-level accuracy.
      if (event.placeId) {
        try {
          const place = await api.getLandmarkDetails(event.placeId);
          if (__DEV__) {
            console.log('[MapScreen] POI placeId success', event.placeId, '→ address:', place?.address ? '✓' : '✗');
          }

          setTappedLocation((prev) => {
            const currentPlaceId = prev?.place?.placeId;
            if (currentPlaceId && currentPlaceId !== event.placeId) return prev;

            return {
              latitude: place.latitude,
              longitude: place.longitude,
              location: {
                latitude: place.latitude,
                longitude: place.longitude,
                address: place.address ?? '',
              },
              place: {
                placeId: place.id,
                name: event.name || place.name || '',
                address: place.address ?? '',
                googleRating: place.googleRating,
                googleReviewCount: place.googleReviewCount,
                googleReviews: place.googleReviews,
                openNow: (place as any).openNow,
                weekdayText: (place as any).weekdayText,
              },
            };
          });

          return;
        } catch (placeErr: any) {
          // 404 or API error: fall back to coordinate-based lookup
          const status = placeErr?.response?.status;
          if (__DEV__) console.log('[MapScreen] getLandmarkDetails failed', status, placeErr?.message, '→ fallback to getLocationDetails');
          if (status === 404 || status === 400) {
            const details = await api.getLocationDetails({
              latitude: event.latitude,
              longitude: event.longitude,
            });
            setTappedLocation({
              latitude: event.latitude,
              longitude: event.longitude,
              ...details,
            });
            return;
          }
          throw placeErr;
        }
      }

      // Fallback: coordinate-based lookup (less accurate than placeId)
      if (__DEV__) console.log('[MapScreen] No placeId, using getLocationDetails', { lat: event.latitude, lng: event.longitude });
      const details = await api.getLocationDetails({
        latitude: event.latitude,
        longitude: event.longitude,
      });

      setTappedLocation({
        latitude: event.latitude,
        longitude: event.longitude,
        ...details,
      });
    } catch (error: any) {
      const isNetwork = error?.code === 'ERR_NETWORK' || error?.message === 'Network Error' || /timeout|exceeded/i.test(error?.message || '');
      if (!isNetwork) console.error('Error handling native POI click:', error?.message || error);
      // Don't fall back to handleMapPress — it would make another backend call and timeout again.
      // tappedLocation is already set with basic info (lat, lng, placeId, name); sheet stays open.
    } finally {
      setLoadingLocationDetails(false);
    }
  };

  useEffect(() => {
    handleNativePoiClickRef.current = handleNativePoiClick;
  }, [handleNativePoiClick]);

  // Wire up native POI taps (Google Maps-level placeId accuracy).
  // This does NOT replace the map visuals; it only makes the built-in POI icons tappable/reliable.
  // Only used when provider is Google; Amap has its own onPressPoi.
  useEffect(() => {
    if (mapProvider !== 'google') {
      setNativePoiEnabled(false);
      return;
    }
    if (!PoiClickManager.isAvailable()) {
      setNativePoiEnabled(false);
      return;
    }

    const unsub = PoiClickManager.addPoiClickListener((ev) => {
      handleNativePoiClickRef.current(ev);
    });

    return () => {
      try {
        unsub();
      } catch {
        // ignore
      }
    };
  }, [mapProvider]);

  useEffect(() => {
    // Disable in list mode to avoid doing native work when the map isn't visible.
    if (viewMode !== 'map') {
      if (PoiClickManager.isAvailable()) {
        try {
          PoiClickManager.disablePoiClicks();
        } catch {
          // ignore
        }
      }
      setNativePoiEnabled(false);
    }
  }, [viewMode]);

  useEffect(() => {
    if (viewMode !== 'map') return;
    if (mapReadyNonce <= 0) return;
    if (mapProvider !== 'google') {
      setNativePoiEnabled(false);
      return;
    }
    if (!PoiClickManager.isAvailable()) {
      setNativePoiEnabled(false);
      return;
    }

    try {
      PoiClickManager.enablePoiClicks(mapRef);
      setNativePoiEnabled(true);
    } catch {
      setNativePoiEnabled(false);
    }
  }, [mapReadyNonce, viewMode, mapProvider]);

  useEffect(() => {
    return () => {
      if (pendingMapPressTimerRef.current) {
        clearTimeout(pendingMapPressTimerRef.current);
        pendingMapPressTimerRef.current = null;
      }
      if (PoiClickManager.isAvailable()) {
        try {
          PoiClickManager.disablePoiClicks();
        } catch {
          // ignore
        }
      }
    };
  }, []);

  /**
   * Handle map press events (fallback when native POI clicks unavailable)
   */
  const handleMapPress = (e: any) => {
    const coordinate = e?.nativeEvent?.coordinate;
    if (!coordinate) return;

    // Debounce slightly: on some platforms, a POI tap can trigger both onPress and onPoiClick.
    // We delay the coordinate-based fallback so onPoiClick (placeId) can cancel it.
    if (pendingMapPressTimerRef.current) {
      clearTimeout(pendingMapPressTimerRef.current);
      pendingMapPressTimerRef.current = null;
    }

    pendingMapPressTimerRef.current = setTimeout(() => {
      pendingMapPressTimerRef.current = null;

      // If a POI click fired very recently, ignore this press to prevent double-handling.
      const elapsed = Date.now() - (lastNativePoiClickAtRef.current || 0);
      if (elapsed >= 0 && elapsed < 450) {
        return;
      }

      (async () => {
        try {
          setLoadingLocationDetails(true);
          setSelectedToilet(null);
          setSelectedLandmark(null);
          setTappedLocation(null);

          // Get location details from Google Places (detects POIs at this location)
          const details = await api.getLocationDetails({
            latitude: coordinate.latitude,
            longitude: coordinate.longitude,
          });
          setTappedLocation({
            latitude: coordinate.latitude,
            longitude: coordinate.longitude,
            ...details,
          });
        } catch (error: any) {
          if (__DEV__) console.error('Error loading location details:', error?.message || error);
          // Show basic info so user can still add/review
          setTappedLocation({
            latitude: coordinate.latitude,
            longitude: coordinate.longitude,
            location: {
              latitude: coordinate.latitude,
              longitude: coordinate.longitude,
              address: `Location at ${coordinate.latitude.toFixed(5)}, ${coordinate.longitude.toFixed(5)}`,
            },
          });
        } finally {
          setLoadingLocationDetails(false);
        }
      })();
    }, 90);
  };

  const isRecentlyServiced = (iso: string): boolean => {
    const d = new Date(iso);
    const now = new Date();
    return (now.getTime() - d.getTime()) < 48 * 60 * 60 * 1000; // 48h
  };

  const formatScore = (score: number | string | null | undefined): string => {
    if (score === null || score === undefined) {
      return 'N/A';
    }
    const numScore = typeof score === 'string' ? parseFloat(score) : score;
    if (isNaN(numScore)) {
      return 'N/A';
    }
    return numScore.toFixed(1);
  };

  const getMarkerColor = (toilet: Toilet): string => {
    const cleanliness = typeof toilet.cleanliness_score === 'string'
      ? parseFloat(toilet.cleanliness_score)
      : toilet.cleanliness_score;
    const smell = typeof toilet.smell_score === 'string'
      ? parseFloat(toilet.smell_score)
      : toilet.smell_score;

    if (cleanliness === null || smell === null) {
      return '#999'; // Gray for no reviews
    }

    const avgScore = (cleanliness + smell) / 2;
    if (avgScore >= 4) return '#4CAF50'; // Green
    if (avgScore >= 3) return '#FFC107'; // Yellow
    if (avgScore >= 2) return '#FF9800'; // Orange
    return '#F44336'; // Red
  };

  // Map shows immediately with displayCoords (fallback when location not yet available)
  return (
    <View style={styles.container}>
      {/* Backend unreachable banner */}
      {!navigationActive && backendUnreachable && !backendBannerDismissed && (
        <View style={[styles.backendBanner, { top: Math.max(insets.top, 8) + 8 }]}>
          <Text style={styles.backendBannerTitle}>Can't reach backend</Text>
          <Text style={styles.backendBannerText}>
            iOS Simulator? Set EXPO_PUBLIC_PLOOP_USE_LOCALHOST=true in .env. Physical device? Set EXPO_PUBLIC_PLOOP_API_URL=http://YOUR_MAC_IP:PORT (ipconfig getifaddr en0). Start backend: npm run start:backend from Ploop. Same WiFi.
          </Text>
          <Text style={styles.backendBannerUrl}>Current: {API_BASE_URL}</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
            <TouchableOpacity style={styles.backendBannerDismiss} onPress={() => getLocationAndToilets()}>
              <Text style={styles.backendBannerDismissText}>{t('retry')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.backendBannerDismiss} onPress={() => setBackendBannerDismissed(true)}>
              <Text style={styles.backendBannerDismissText}>{t('dismiss')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Loading location - emoji, trivia, animation */}
      {loading && !location && (
        <View style={[styles.loadingBanner, { top: Math.max(insets.top, 8) + 8 }]}>
          <LoadingBannerWithTrivia context="location" onRetry={getLocationAndToilets} />
        </View>
      )}

      {/* Tap-away overlay: dismiss keyboard and search dropdown */}
      {!navigationActive && showSearch && (
        <TouchableWithoutFeedback
          onPress={() => {
            Keyboard.dismiss();
            setShowSearch(false);
          }}
        >
          <View style={[StyleSheet.absoluteFill, { zIndex: 100 }]} />
        </TouchableWithoutFeedback>
      )}

      {/* Search Bar - below status bar, with gap for settings button */}
      {!navigationActive && (
        <View style={[styles.searchContainer, { top: Math.max(insets.top, 8) + 8, right: 72 }]}>
          <TextInput
            style={styles.searchInput}
            placeholder={t('searchLandmarksPlaceholder')}
            value={searchQuery}
            onChangeText={setSearchQuery}
            onFocus={() => setShowSearch(true)}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity
              style={styles.clearButton}
              onPress={() => {
                Keyboard.dismiss();
                setSearchQuery('');
                setShowSearch(false);
              }}
            >
              <Text style={styles.clearButtonText}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Top-right Settings button - always visible when not navigating */}
      {!navigationActive && (
        <Pressable
          style={({ pressed }) => [
            styles.topRightButton,
            pressed && styles.settingsButtonPressed,
            { top: Math.max(insets.top, 8) + 8 },
          ]}
          onPress={() => setSettingsOpen(true)}
        >
          <Text style={styles.topRightButtonText}>⋯</Text>
        </Pressable>
      )}

      {/* Search error message */}
      {!navigationActive && showSearch && landmarkSearchError && (
        <View style={[styles.searchResults, { top: Math.max(insets.top, 8) + 8 + 48 }]}>
          <View style={styles.searchErrorBanner}>
            <Text style={styles.searchErrorText}>{landmarkSearchError}</Text>
          </View>
        </View>
      )}

      {/* Search Results Dropdown */}
      {!navigationActive && showSearch && landmarks.length > 0 && (
        <View style={[styles.searchResults, { top: Math.max(insets.top, 8) + 8 + 48 }]}>
          <FlatList
            data={landmarks}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.searchResultItem}
                onPress={() => handleLandmarkSelect(item)}
              >
                <Text style={styles.searchResultName}>{item.name}</Text>
                <Text style={styles.searchResultAddress}>{item.address}</Text>
              </TouchableOpacity>
            )}
            style={styles.searchResultsList}
          />
        </View>
      )}

      {viewMode === 'map' && (
        <View style={styles.mapWrap} pointerEvents="box-none">
          <PloopMapView
            ref={mapRef}
            style={styles.map}
            initialRegion={{
            latitude: displayCoords.latitude,
            longitude: displayCoords.longitude,
            latitudeDelta: hasRealLocation ? 0.01 : 100,
            longitudeDelta: hasRealLocation ? 0.01 : 100,
          }}
          region={
            selectedLandmark
              ? {
                  latitude: selectedLandmark.latitude,
                  longitude: selectedLandmark.longitude,
                  latitudeDelta: 0.005,
                  longitudeDelta: 0.005,
                }
              : undefined
          }
          showsUserLocation
          // Avoid overlapping native map UI; we provide our own recenter button.
          showsMyLocationButton={false}
          mapType="standard"
          pitchEnabled={false}
          rotateEnabled={false}
          scrollEnabled={true}
          zoomEnabled={true}
          // Android-only: hide Google Maps toolbar/zoom UI to avoid overlap.
          toolbarEnabled={false as any}
          zoomControlEnabled={false as any}
          onMapReady={() => setMapReadyNonce((n) => n + 1)}
          onRegionChangeComplete={onRegionChangeComplete}
          onPanDrag={() => {
            // If user manually pans, stop auto-follow to avoid fighting gestures
            if (navigationActive) setFollowUser(false);
          }}
          onPoiClick={(e) => {
            const ne = (e as any)?.nativeEvent;
            if (!ne?.coordinate) return;
            lastNativePoiClickAtRef.current = Date.now();
            if (pendingMapPressTimerRef.current) {
              clearTimeout(pendingMapPressTimerRef.current);
              pendingMapPressTimerRef.current = null;
            }
            handleNativePoiClickRef.current({
              placeId: ne.placeId,
              name: ne.name,
              latitude: ne.coordinate.latitude,
              longitude: ne.coordinate.longitude,
            });
          }}
          onPress={handleMapPress}
          >
          {/* Route polyline (in-app directions) */}
          {routePolyline && routePolyline.length > 1 && (
            <PloopPolyline coordinates={routePolyline} strokeColor="#1A73E8" strokeWidth={6} />
          )}

          {/* Destination marker for active route */}
          {routeDestination && (
            <PloopMarker
              coordinate={{ latitude: routeDestination.latitude, longitude: routeDestination.longitude }}
              title={routeDestination.title || t('destination')}
              tracksViewChanges={false}
              pinColor="#1A73E8"
            />
          )}

          {/* Landmark Marker */}
          {selectedLandmark && (
            <PloopMarker
              coordinate={{
                latitude: selectedLandmark.latitude,
                longitude: selectedLandmark.longitude,
              }}
              title={selectedLandmark.name}
              description={selectedLandmark.address}
              tracksViewChanges={false}
              pinColor="#9C27B0"
              onPress={(e) => {
                if (e.stopPropagation) e.stopPropagation();
                // Open the same bottom sheet details you'd get from tapping a native POI.
                handleLandmarkSelect(selectedLandmark);
              }}
            >
              <View style={styles.landmarkMarkerContainer}>
                <Text style={styles.landmarkMarkerEmoji}>📍</Text>
              </View>
            </PloopMarker>
          )}
          {(mapMarkers?.clusters ?? []).map((c) => (
            <PloopMarker
              key={`cluster-${c.key}`}
              coordinate={{ latitude: c.latitude, longitude: c.longitude }}
              tracksViewChanges={false}
              onPress={(e) => {
                if (e.stopPropagation) e.stopPropagation();
                try {
                  if (!mapRef.current) return;
                  mapRef.current.animateToRegion(
                    {
                      latitude: c.latitude,
                      longitude: c.longitude,
                      latitudeDelta: Math.max(0.004, (renderRegion?.latitudeDelta || 0.02) / 2),
                      longitudeDelta: Math.max(0.004, (renderRegion?.longitudeDelta || 0.02) / 2),
                    },
                    260
                  );
                } catch {
                  // ignore
                }
              }}
            >
              <View style={styles.clusterBubble}>
                <Text style={styles.clusterBubbleText}>{c.count}</Text>
              </View>
            </PloopMarker>
          ))}

          {(mapMarkers?.toilets ?? []).map((toilet) => (
            <PloopMarker
              key={toilet.id}
              coordinate={{
                latitude: toilet.latitude,
                longitude: toilet.longitude,
              }}
              tracksViewChanges={false}
              onPress={(e) => {
                if (e.stopPropagation) e.stopPropagation();
                try {
                  setSelectedToilet(toilet);
                  setTappedLocation(null);
                  api.track('toilet_selected', { source: 'map_marker', toiletId: toilet.id });
                } catch (error) {
                  console.error('Error selecting toilet:', error);
                }
              }}
            >
              <View style={styles.markerContainer}>
                <Text style={styles.markerEmoji}>🚽</Text>
                <View style={[styles.markerBadge, { backgroundColor: getMarkerColor(toilet) }]}>
                  <View style={styles.markerBadgeInner} />
                </View>
              </View>
            </PloopMarker>
          ))}
        </PloopMapView>
        </View>
      )}

      {/* Navigation banner (mode + ETA) - below status bar so it doesn't get cut off */}
      {viewMode === 'map' && navigationActive && routeDestination && (
        <View style={[styles.navBanner, { top: Math.max(insets.top, 12) + 12 }]}>
          <View style={styles.navBannerTop}>
            <Text style={styles.navBannerTitle} numberOfLines={1}>
              {routeDestination.title || t('navigating')}
            </Text>
            <View style={styles.navBannerTopActions}>
              <Pressable
                style={({ pressed }) => [styles.navDetailsButton, pressed && styles.navDetailsButtonPressed]}
                onPress={() => setShowSteps(true)}
              >
                <Text style={styles.navDetailsButtonText}>Details</Text>
              </Pressable>
              <Pressable style={styles.navStopButton} onPress={clearDirections}>
                <Text style={styles.navStopButtonText}>Stop</Text>
              </Pressable>
            </View>
          </View>
          <Text style={styles.navBannerMeta}>
            {routeMeta?.durationText ? `${routeMeta.durationText}` : ''}
            {routeMeta?.distanceText ? ` • ${routeMeta.distanceText}` : ''}
            {!routeMeta?.durationText && !routeMeta?.distanceText ? t('routeReady') : ''}
          </Text>
          <View style={styles.navModeRow}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.navModeScrollContent}
              style={styles.navModeScroll}
            >
              {(
                [
                  { key: 'driving' as const, label: 'Car' },
                  { key: 'walking' as const, label: 'Walk' },
                  { key: 'bicycling' as const, label: 'Bike' },
                ] as const
              ).map((m) => (
                <Pressable
                  key={m.key}
                  style={({ pressed }) => [
                    styles.modeChip,
                    travelMode === m.key && styles.modeChipActive,
                    pressed && styles.modeChipPressed,
                  ]}
                  onPress={() => setTravelMode(m.key)}
                >
                  <Text style={[styles.modeChipText, travelMode === m.key && styles.modeChipTextActive]}>
                    {m.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
            <Pressable
              style={({ pressed }) => [
                styles.followChip,
                followUser && styles.followChipActive,
                pressed && styles.modeChipPressed,
              ]}
              onPress={() => setFollowUser(true)}
            >
              <Text style={[styles.followChipText, followUser && styles.followChipTextActive]}>
                Follow
              </Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* Arrival mode (near destination) */}
      {viewMode === 'map' && navigationActive && routeDestination && arrivalInfo?.active && (
        <View style={[styles.arrivalCard, { bottom: Math.max(insets.bottom, 20) + 160 }]}>
          <View style={styles.arrivalHeader}>
            <Text style={styles.arrivalTitle}>Arriving</Text>
            <Text style={styles.arrivalDistance}>{Math.round(arrivalInfo.meters)}m</Text>
          </View>

          {arrivalToilet && (
            <View style={styles.arrivalMetaRow}>
              <Text style={styles.arrivalMetaText}>
                {arrivalToilet.active_reports ? `${arrivalToilet.active_reports} active report${arrivalToilet.active_reports === 1 ? '' : 's'} • ` : ''}
                {t('ploopScore')} {typeof arrivalToilet.confidence_score === 'number' ? arrivalToilet.confidence_score : formatPloopScore(arrivalToilet.confidence_score)}
              </Text>
            </View>
          )}

          {routeDestination.toiletId && (
            <View style={styles.arrivalHintsBlock}>
              <View style={styles.arrivalHintsHeader}>
                <Text style={styles.arrivalHintsTitle}>Entrance hints</Text>
                <Pressable style={styles.arrivalHintAdd} onPress={() => setHintModalOpen(true)}>
                  <Text style={styles.arrivalHintAddText}>+ Add</Text>
                </Pressable>
              </View>

              {arrivalHintsLoading ? (
                <Text style={styles.arrivalHintsEmpty}>Loading…</Text>
              ) : arrivalHints.length === 0 ? (
                <Text style={styles.arrivalHintsEmpty}>No hints yet. Add one to help others.</Text>
              ) : (
                arrivalHints.slice(0, 2).map((h) => (
                  <Text key={h.id} style={styles.arrivalHintText}>
                    • {h.hint_text}
                  </Text>
                ))
              )}
            </View>
          )}

          {arrivalToilet && (
            <View style={styles.arrivalActionsRow}>
              <Pressable style={styles.arrivalActionChip} onPress={() => submitReport(arrivalToilet, 'busy')}>
                <Text style={styles.arrivalActionChipText}>{t('busy')}</Text>
              </Pressable>
              <Pressable style={styles.arrivalActionChip} onPress={() => submitReport(arrivalToilet, 'gross')}>
                <Text style={styles.arrivalActionChipText}>{t('gross')}</Text>
              </Pressable>
              <Pressable style={styles.arrivalActionChip} onPress={() => submitReport(arrivalToilet, 'needs_cleaning')}>
                <Text style={styles.arrivalActionChipText}>{t('needsCleaning')}</Text>
              </Pressable>
              <Pressable style={styles.arrivalActionChip} onPress={() => submitReport(arrivalToilet, 'closed')}>
                <Text style={styles.arrivalActionChipText}>{t('closed')}</Text>
              </Pressable>
            </View>
          )}
        </View>
      )}

      <Modal visible={hintModalOpen} transparent animationType="fade" onRequestClose={() => setHintModalOpen(false)}>
        <Pressable style={styles.hintBackdrop} onPress={() => setHintModalOpen(false)} />
        <View style={[styles.hintSheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={styles.hintHeaderRow}>
            <Text style={styles.hintTitle}>Add entrance hint</Text>
            <Pressable style={styles.hintClose} onPress={() => setHintModalOpen(false)}>
              <Text style={styles.hintCloseText}>✕</Text>
            </Pressable>
          </View>
          <TextInput
            style={styles.hintInput}
            value={hintText}
            onChangeText={setHintText}
            placeholder="e.g. Inside lobby, elevator to level 2, code 1234"
            multiline
          />
          <Pressable
            style={({ pressed }) => [styles.hintSubmit, pressed && styles.hintSubmitPressed, submittingHint && styles.hintSubmitDisabled]}
            disabled={submittingHint}
            onPress={async () => {
              const toiletId = routeDestination?.toiletId;
              const text = hintText.trim();
              if (!toiletId || text.length < 3) return;
              try {
                setSubmittingHint(true);
                await api.addHint(toiletId, text);
                setHintText('');
                setHintModalOpen(false);
                try {
                  const res = await api.getHints(toiletId);
                  setArrivalHints(res.hints || []);
                } catch {
                  // ignore
                }
                api.track('hint_added', { toiletId });
              } catch (e: any) {
                Alert.alert('Hint', e?.response?.data?.error || e?.message || 'Failed to add hint.');
              } finally {
                setSubmittingHint(false);
              }
            }}
          >
            <Text style={styles.hintSubmitText}>{submittingHint ? 'Submitting…' : 'Submit hint'}</Text>
          </Pressable>
        </View>
      </Modal>

      {/* Directions details bottom sheet */}
      <Modal visible={showSteps} transparent animationType="slide" onRequestClose={() => setShowSteps(false)}>
        <Pressable style={styles.stepsBackdrop} onPress={() => setShowSteps(false)} />
        <View style={[styles.stepsSheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={styles.stepsHandle} />
          <View style={styles.stepsHeaderRow}>
            <Text style={styles.stepsTitle}>Route details</Text>
            <Pressable style={styles.stepsClose} onPress={() => setShowSteps(false)}>
              <Text style={styles.stepsCloseText}>✕</Text>
            </Pressable>
          </View>
          <Text style={styles.stepsSummary}>
            {routeMeta?.durationText ? `${routeMeta.durationText}` : '—'}
            {routeMeta?.distanceText ? ` • ${routeMeta.distanceText}` : ''}
          </Text>

          <ScrollView style={styles.stepsList} contentContainerStyle={{ paddingBottom: 18 }}>
            {routeSteps.length === 0 ? (
              <Text style={styles.stepsEmpty}>No step-by-step details available.</Text>
            ) : (
              routeSteps.map((s, idx) => {
                const isTransit = s.travelMode === 'TRANSIT';
                const isWalk = s.travelMode === 'WALK';
                const icon = isTransit ? '🚌' : isWalk ? '🚶' : s.travelMode === 'DRIVE' ? '🚗' : s.travelMode === 'BICYCLE' ? '🚲' : '➡️';

                const cleanedInstructions = stripHtml(s.instructions);
                const transitLine = s.transit?.lineShortName || s.transit?.lineName;
                const transitTitle = transitLine
                  ? `${transitLine}${s.transit?.headsign ? ` → ${s.transit.headsign}` : ''}`
                  : cleanedInstructions || 'Transit';

                const title = isTransit ? transitTitle : cleanedInstructions || (isWalk ? 'Walk' : 'Continue');

                const subBits: string[] = [];
                if (s.distanceText) subBits.push(s.distanceText);
                if (s.durationText) subBits.push(s.durationText);

                return (
                  <View key={`${idx}-${s.travelMode}`} style={styles.stepCard}>
                    <Text style={styles.stepIcon}>{icon}</Text>
                    <View style={styles.stepBody}>
                      <Text style={styles.stepTitle} numberOfLines={3}>
                        {title}
                      </Text>
                      {subBits.length > 0 ? (
                        <Text style={styles.stepMeta}>{subBits.join(' • ')}</Text>
                      ) : null}

                      {isTransit && (
                        <View style={styles.transitMetaBlock}>
                          {!s.transit?.lineShortName && !s.transit?.lineName && cleanedInstructions ? (
                            <Text style={styles.transitStops}>{cleanedInstructions}</Text>
                          ) : null}
                          {s.transit?.departureStopName && s.transit?.arrivalStopName ? (
                            <Text style={styles.transitStops}>
                              {s.transit.departureStopName} → {s.transit.arrivalStopName}
                            </Text>
                          ) : null}
                          <Text style={styles.transitTimes}>
                            {s.transit?.departureTimeText ? `Departs ${s.transit.departureTimeText}` : ''}
                            {s.transit?.arrivalTimeText ? ` • Arrives ${s.transit.arrivalTimeText}` : ''}
                            {typeof s.transit?.waitMinutes === 'number' ? ` • Wait ${s.transit.waitMinutes} min` : ''}
                          </Text>
                          {typeof s.transit?.stopCount === 'number' ? (
                            <Text style={styles.transitStopsCount}>
                              {s.transit.stopCount} stop{s.transit.stopCount === 1 ? '' : 's'}
                            </Text>
                          ) : null}
                        </View>
                      )}
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>
        </View>
      </Modal>

      {/* Settings modal */}
      <Modal visible={settingsOpen} transparent animationType="fade" onRequestClose={() => setSettingsOpen(false)}>
        <View style={styles.settingsModalContainer}>
          <Pressable style={[StyleSheet.absoluteFill, styles.settingsBackdrop]} onPress={() => setSettingsOpen(false)} />
          <View style={[styles.settingsSheet, { paddingBottom: Math.max(insets.bottom, 16), height: (height - insets.top - insets.bottom) * 0.88 }]}>
          <View style={styles.settingsHeaderRow}>
            <Text style={styles.settingsTitle}>Settings</Text>
            <Pressable style={styles.settingsClose} onPress={() => setSettingsOpen(false)}>
              <Text style={styles.settingsCloseText}>✕</Text>
            </Pressable>
          </View>
          <ScrollView style={styles.settingsScroll} showsVerticalScrollIndicator={true}>
          <Pressable
            style={styles.settingsRow}
            onPress={() => {
              setSettingsOpen(false);
              (navigation as any).navigate('Login');
            }}
          >
            <View style={styles.settingsRowText}>
              <Text style={styles.settingsRowTitle}>{t('account')}</Text>
              <Text style={styles.settingsRowSubtitle}>
                {user ? (user.display_name || user.email) : t('signInToSaveReviews')}
              </Text>
            </View>
            <Text style={styles.settingsRowChevron}>›</Text>
          </Pressable>
          <Pressable
            style={styles.settingsRow}
            onPress={() => {
              setSettingsOpen(false);
              (navigation as any).navigate('PoopGame');
            }}
          >
            <View style={styles.settingsRowText}>
              <Text style={styles.settingsRowTitle}>{t('catchThePoop')}</Text>
              <Text style={styles.settingsRowSubtitle}>{t('playPoopGame')}</Text>
            </View>
            <Text style={styles.settingsRowChevron}>›</Text>
          </Pressable>
          {user?.role === 'admin' && (
            <Pressable
              style={styles.settingsRow}
              onPress={() => {
                setSettingsOpen(false);
                (navigation as any).navigate('Admin');
              }}
            >
              <View style={styles.settingsRowText}>
                <Text style={styles.settingsRowTitle}>{t('admin')}</Text>
                <Text style={styles.settingsRowSubtitle}>{t('analyticsModeration')}</Text>
              </View>
              <Text style={styles.settingsRowChevron}>›</Text>
            </Pressable>
          )}
          <View style={styles.settingsDivider} />
          <View style={styles.settingsRow}>
            <View style={styles.settingsRowText}>
              <Text style={styles.settingsRowTitle}>Startup “ploop” sound</Text>
              <Text style={styles.settingsRowSubtitle}>Plays when the app opens.</Text>
            </View>
            <Switch
              value={ploopSoundEnabled}
              onValueChange={async (next) => {
                setPloopSoundEnabled(next);
                try {
                  await AsyncStorage.setItem('settings.ploopSoundEnabled', next ? 'true' : 'false');
                } catch {
                  // ignore
                }
              }}
            />
          </View>

          {__DEV__ && (
            <View style={styles.settingsRow}>
              <View style={styles.settingsRowText}>
                <Text style={styles.settingsRowTitle}>Simulate China location (dev)</Text>
                <Text style={styles.settingsRowSubtitle}>Spoof to Beijing to test Gaode map & POI</Text>
              </View>
              <Switch
                value={simulateChinaLocation}
                onValueChange={(next) => {
                  setSimulateChinaLocation(next);
                }}
              />
            </View>
          )}

          <View style={styles.settingsDivider} />

          <Text style={styles.settingsSectionTitle}>{t('language')}</Text>
          <View style={styles.settingsRow}>
            <View style={styles.settingsRowText}>
              <Text style={styles.settingsRowTitle}>{locale === 'en' ? t('english') : t('mandarin')}</Text>
              <Text style={styles.settingsRowSubtitle}>
                {locale === 'en' ? t('switchToZh') : t('switchToEn')}
              </Text>
            </View>
          </View>
          <View style={styles.settingsChipsRow}>
            <Pressable
              style={[styles.settingsChip, locale === 'en' && styles.settingsChipActive]}
              onPress={() => setLocale('en')}
            >
              <Text style={[styles.settingsChipText, locale === 'en' && styles.settingsChipTextActive]}>EN</Text>
            </Pressable>
            <Pressable
              style={[styles.settingsChip, locale === 'zh' && styles.settingsChipActive]}
              onPress={() => setLocale('zh')}
            >
              <Text style={[styles.settingsChipText, locale === 'zh' && styles.settingsChipTextActive]}>中文</Text>
            </Pressable>
          </View>
          <Text style={styles.settingsHint}>{t('mapLanguageHint')}</Text>

          <View style={styles.settingsDivider} />

          <Text style={styles.settingsSectionTitle}>{t('filters')}</Text>

          <View style={styles.settingsRow}>
            <View style={styles.settingsRowText}>
              <Text style={styles.settingsRowTitle}>{t('wheelchairAccessibleOnly')}</Text>
              <Text style={styles.settingsRowSubtitle}>{t('showWheelchairToilets')}</Text>
            </View>
            <Switch
              value={filterWheelchairOnly}
              onValueChange={(next) => {
                setFilterWheelchairOnly(next);
                api.track('filters_changed', { wheelchair_only: next, free_only: filterFreeOnly, bidet_only: filterBidetOnly, min_confidence: minConfidence });
              }}
            />
          </View>

          <View style={styles.settingsRow}>
            <View style={styles.settingsRowText}>
              <Text style={styles.settingsRowTitle}>{t('freeOnly')}</Text>
              <Text style={styles.settingsRowSubtitle}>{t('showFreeToilets')}</Text>
            </View>
            <Switch
              value={filterFreeOnly}
              onValueChange={(next) => {
                setFilterFreeOnly(next);
                api.track('filters_changed', { wheelchair_only: filterWheelchairOnly, free_only: next, bidet_only: filterBidetOnly, min_confidence: minConfidence });
              }}
            />
          </View>

          <View style={styles.settingsRow}>
            <View style={styles.settingsRowText}>
              <Text style={styles.settingsRowTitle}>{t('bidetOnly')}</Text>
              <Text style={styles.settingsRowSubtitle}>{t('showBidetToilets')}</Text>
            </View>
            <Switch
              value={filterBidetOnly}
              onValueChange={(next) => {
                setFilterBidetOnly(next);
                api.track('filters_changed', { wheelchair_only: filterWheelchairOnly, free_only: filterFreeOnly, bidet_only: next, min_confidence: minConfidence });
              }}
            />
          </View>

          <View style={styles.settingsRow}>
            <View style={styles.settingsRowText}>
              <Text style={styles.settingsRowTitle}>{t('minPloopScore')}</Text>
              <Text style={styles.settingsRowSubtitle}>{t('hideLowPloopScore')}</Text>
            </View>
          </View>
          <Text style={styles.ploopScoreExplanation}>{t('ploopScoreExplanation')}</Text>
          <View style={styles.settingsChipsRow}>
            {[0, 60, 75, 85].map((v) => (
              <Pressable
                key={v}
                style={({ pressed }) => [
                  styles.settingsChip,
                  minConfidence === v && styles.settingsChipActive,
                  pressed && styles.settingsChipPressed,
                ]}
                onPress={() => {
                  setMinConfidence(v);
                  api.track('filters_changed', { wheelchair_only: filterWheelchairOnly, free_only: filterFreeOnly, bidet_only: filterBidetOnly, min_confidence: v });
                }}
              >
                <Text style={[styles.settingsChipText, minConfidence === v && styles.settingsChipTextActive]}>
                  {v === 0 ? 'Any' : `${v}+`}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.settingsDivider} />
          <Text style={styles.settingsSectionTitle}>{t('suggestionBox')}</Text>
          <View style={styles.suggestionRow}>
            <TextInput
              style={styles.suggestionInput}
              value={suggestionText}
              onChangeText={(v) => setSuggestionText(v.slice(0, 40))}
              placeholder={t('suggestionPlaceholder')}
              maxLength={40}
              editable={!suggestionSending}
            />
            <Pressable
              style={({ pressed }) => [
                styles.suggestionSubmit,
                pressed && styles.hintSubmitPressed,
                (suggestionSending || !suggestionText.trim()) && styles.hintSubmitDisabled,
              ]}
              disabled={suggestionSending || !suggestionText.trim()}
              onPress={async () => {
                const text = suggestionText.trim();
                if (!text || suggestionSending) return;
                try {
                  setSuggestionSending(true);
                  setSuggestionSuccess(false);
                  await api.submitSuggestion(text);
                  setSuggestionText('');
                  setSuggestionSuccess(true);
                  hapticSuccess();
                  setTimeout(() => setSuggestionSuccess(false), 3000);
                } catch (e: any) {
                  Alert.alert(t('error'), t('suggestionError'));
                } finally {
                  setSuggestionSending(false);
                }
              }}
            >
              <Text style={styles.suggestionSubmitText}>
                {suggestionSending ? '…' : suggestionSuccess ? '✓' : t('save')}
              </Text>
            </Pressable>
          </View>
          {suggestionSuccess && <Text style={styles.suggestionSuccessText}>{t('suggestionSent')}</Text>}

          <View style={styles.settingsDivider} />
          <Text style={styles.settingsSectionTitle}>Your Impact</Text>
          <Text style={styles.settingsSectionSubtitle}>Every review and save helps the community find the best spots. Keep it up!</Text>
          <Text style={styles.oxymoronicTagline}>{oxymoronicTagline}</Text>

          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <Text style={styles.statNumber}>{localStats.reviews}</Text>
              <Text style={styles.statLabel}>Reviews</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statNumber}>{localStats.reports}</Text>
              <Text style={styles.statLabel}>Reports</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statNumber}>{localStats.favorites}</Text>
              <Text style={styles.statLabel}>Saves</Text>
            </View>
          </View>

          <View style={styles.badgesRow}>
            {unlockedBadges.map((b) => (
              <View key={b.key} style={[styles.badgePill, !b.ok && styles.badgePillLocked]}>
                <Text style={[styles.badgeText, !b.ok && styles.badgeTextLocked]}>
                  {b.ok ? b.emoji : '🔒'} {b.label} {!b.ok && b.progress ? `(${b.progress})` : ''}
                </Text>
              </View>
            ))}
          </View>
          </ScrollView>
        </View>
        </View>
      </Modal>

      {/* SOS Modal (from toilet card) */}
      <Modal visible={sosModalOpen} transparent animationType="fade" onRequestClose={() => setSosModalOpen(false)}>
        <Pressable style={styles.sosBackdrop} onPress={() => setSosModalOpen(false)} />
        <View style={styles.sosModalContent}>
          <View style={styles.sosModalInner}>
            <Text style={styles.sosModalTitle}>What do you need?</Text>
            <Text style={styles.sosModalSubtitle}>Share with a friend so they can help</Text>
            {selectedToilet &&
              SOS_OPTIONS.map((opt) => (
                <Pressable
                  key={opt.id}
                  style={({ pressed }) => [styles.sosOption, pressed && { opacity: 0.8 }]}
                  onPress={() => shareSosWithFriend(selectedToilet, opt.id)}
                >
                  <Text style={styles.sosOptionEmoji}>{opt.emoji}</Text>
                  <Text style={styles.sosOptionLabel}>{opt.label}</Text>
                </Pressable>
              ))}
            <Pressable style={({ pressed }) => [styles.sosCancel, pressed && { opacity: 0.8 }]} onPress={() => setSosModalOpen(false)}>
              <Text style={styles.sosCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Collections modal (add/remove toilet from lists) */}
      <Modal visible={collectionModalOpen} transparent animationType="fade" onRequestClose={() => setCollectionModalOpen(false)}>
        <Pressable style={styles.hintBackdrop} onPress={() => setCollectionModalOpen(false)} />
        <View style={[styles.hintSheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={styles.hintHeaderRow}>
            <Text style={styles.hintTitle}>{t('lists')}</Text>
            <Pressable style={styles.hintClose} onPress={() => setCollectionModalOpen(false)}>
              <Text style={styles.hintCloseText}>✕</Text>
            </Pressable>
          </View>

          <Text style={styles.collectionsSubtitle}>
            {collectionModalToilet ? `${t('addToCollection')} "${collectionModalToilet.name}"` : t('yourLists')}
          </Text>

          <ScrollView style={{ maxHeight: 240 }} contentContainerStyle={{ paddingBottom: 10 }}>
            {collections.length === 0 ? (
              <Text style={styles.arrivalHintsEmpty}>{t('noListsYet')}</Text>
            ) : (
              collections.map((c) => {
                const checked = !!collectionModalToilet && (c.toilets ?? []).some((t) => t.id === collectionModalToilet.id);
                return (
                  <Pressable
                    key={c.id}
                    style={({ pressed }) => [styles.collectionPickRow, pressed && styles.listItemPressed]}
                    onPress={() => {
                      if (!collectionModalToilet) return;
                      toggleToiletInCollection(c.id, collectionModalToilet);
                    }}
                  >
                    <Text style={styles.collectionPickName}>{c.name}</Text>
                    <Text style={styles.collectionPickRight}>{checked ? '✓' : ''}</Text>
                  </Pressable>
                );
              })
            )}
          </ScrollView>

          <View style={styles.collectionCreateRow}>
            <TextInput
              style={styles.collectionCreateInput}
              value={newCollectionName}
              onChangeText={setNewCollectionName}
              placeholder={t('newListName')}
            />
            <Pressable
              style={({ pressed }) => [styles.collectionCreateButton, pressed && styles.hintSubmitPressed]}
              onPress={async () => {
                const id = await createCollection(newCollectionName);
                setNewCollectionName('');
                if (id && collectionModalToilet) {
                  await toggleToiletInCollection(id, collectionModalToilet);
                }
              }}
            >
              <Text style={styles.collectionCreateButtonText}>{t('create')}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Map provider badge - shows Amap or Google */}
      {viewMode === 'map' && (
        <View style={[styles.mapProviderBadge, { bottom: zoomControlsBottom + 52, left: 12 }]}>
          <Text style={styles.mapProviderBadgeText}>
            {mapProvider === 'amap' ? '高德 Amap' : 'Google'}
          </Text>
        </View>
      )}

      {/* Zoom controls (explicit +/- buttons) - hidden when POI card is open */}
      {viewMode === 'map' && !tappedLocation && !selectedToilet && (
        <View style={[styles.zoomControls, { bottom: zoomControlsBottom }]}>
          <Pressable
            style={({ pressed }) => [styles.zoomButton, pressed && styles.zoomButtonPressed]}
            onPress={recenterToUser}
          >
            <Text style={styles.zoomButtonText}>◎</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.zoomButton, pressed && styles.zoomButtonPressed]}
            onPress={() => zoomBy(1)}
          >
            <Text style={styles.zoomButtonText}>＋</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.zoomButton, pressed && styles.zoomButtonPressed]}
            onPress={() => zoomBy(-1)}
          >
            <Text style={styles.zoomButtonText}>－</Text>
          </Pressable>
        </View>
      )}

      {/* Small strip of places that have Ploop reviews */}
      {viewMode === 'map' && toiletsWithReviews.length > 0 && !tappedLocation && !selectedToilet && !navigationActive && (
        <View style={[styles.reviewStrip, { bottom: Math.max(insets.bottom, 20) + 124 }]}>
          <View style={styles.reviewStripHeader}>
            <Text style={styles.reviewStripTitle}>{t('ploopReviewsNearby')}</Text>
            {routePolyline && (
              <Pressable style={styles.clearRoutePill} onPress={clearDirections}>
                <Text style={styles.clearRoutePillText}>
                  {t('clearRoute')}{routeMeta?.durationText ? ` • ${routeMeta.durationText}` : ''}
                </Text>
              </Pressable>
            )}
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {toiletsWithReviews.slice(0, 12).map((toilet) => {
              const thumb = normalizePhotoUrl(toilet.photos?.[0]?.photo_url);
              return (
                <Pressable
                  key={toilet.id}
                  style={({ pressed }) => [styles.reviewChip, pressed && styles.reviewChipPressed]}
                  onPress={() => {
                    setSelectedToilet(toilet);
                    setTappedLocation(null);
                    if (mapRef.current) {
                      mapRef.current.animateToRegion(
                        {
                          latitude: toilet.latitude,
                          longitude: toilet.longitude,
                          latitudeDelta: 0.006,
                          longitudeDelta: 0.006,
                        },
                        250
                      );
                    }
                  }}
                >
                  {thumb ? (
                    <Image source={{ uri: thumb }} style={styles.reviewChipImage} />
                  ) : (
                    <View style={styles.reviewChipImagePlaceholder}>
                      <Text style={styles.reviewChipImagePlaceholderText}>🚽</Text>
                    </View>
                  )}
                  <View style={styles.reviewChipTextWrap}>
                    <Text style={styles.reviewChipTitle} numberOfLines={2}>
                      {parseToiletNameAndBadges(toilet.name).displayName || toilet.name}
                    </Text>
                    <Text style={styles.reviewChipSubtitle} numberOfLines={1}>
                      {toilet.total_reviews} {toilet.total_reviews === 1 ? t('review') : t('reviews')}
                      {toilet.distance ? ` • ${toilet.distance}m` : ''}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* Selected Toilet Info Card */}
      {selectedToilet && !tappedLocation && !navigationActive && (() => {
          const { displayName, badges } = parseToiletNameAndBadges(selectedToilet.name);
          return (
        <View style={styles.toiletCard}>
          <View style={styles.toiletCardHeaderRow}>
            <Text style={styles.toiletCardName}>{displayName || selectedToilet.name}</Text>
            <Pressable
              style={({ pressed }) => [styles.toiletCardSosButton, pressed && styles.toiletCardIconButtonPressed]}
              onPress={() => setSosModalOpen(true)}
            >
              <Text style={styles.toiletCardSosButtonText}>🆘 SOS</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.toiletCardIconButton, pressed && styles.toiletCardIconButtonPressed]}
              onPress={() => shareToilet(selectedToilet)}
            >
              <Text style={styles.toiletCardIconButtonText}>↗</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.toiletCardIconButton, pressed && styles.toiletCardIconButtonPressed]}
              onPress={() => toggleFavorite(selectedToilet)}
            >
              <Text style={styles.toiletCardIconButtonText}>
                {isFavorite(selectedToilet.id) ? '★' : '☆'}
              </Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.toiletCardIconButton, pressed && styles.toiletCardIconButtonPressed]}
              onPress={() => setSelectedToilet(null)}
              accessibilityLabel="Close"
            >
              <Text style={styles.toiletCardIconButtonText}>✕</Text>
            </Pressable>
          </View>

          {selectedToilet.address && (
            <Text style={styles.toiletCardAddress} numberOfLines={1} ellipsizeMode="tail">
              {selectedToilet.address}
            </Text>
          )}

          <View style={styles.pillsRow}>
            {typeof selectedToilet.confidence_score !== 'undefined' && (
              <View style={styles.pill}>
                <Text style={styles.pillText}>{t('ploopScore')} {formatPloopScore(selectedToilet.confidence_score)}</Text>
              </View>
            )}
            {!!selectedToilet.active_reports && (
              <View style={[styles.pill, styles.pillWarning]}>
                <Text style={[styles.pillText, styles.pillTextWarning]}>
                  {selectedToilet.active_reports} {selectedToilet.active_reports === 1 ? t('reportCount') : t('reportsCount')}
                </Text>
              </View>
            )}
            {selectedToilet.last_serviced_at && isRecentlyServiced(selectedToilet.last_serviced_at) && (
              <View style={[styles.pill, styles.pillServiced]}>
                <Text style={styles.pillText}>✨ {t('recentlyServiced')}</Text>
              </View>
            )}
            {favoritesLoaded && isFavorite(selectedToilet.id) && (
              <View style={[styles.pill, styles.pillFavorite]}>
                <Text style={[styles.pillText, styles.pillTextFavorite]}>{t('saved')}</Text>
              </View>
            )}
          </View>
          <View style={styles.scoreContainer}>
            <View style={styles.scoreItem}>
              <Text style={styles.scoreLabel}>{t('cleanliness')}</Text>
              <Text style={styles.scoreValue}>
                {formatScore(selectedToilet.cleanliness_score)}/5
              </Text>
            </View>
            <View style={styles.scoreItem}>
              <Text style={styles.scoreLabel}>{t('smell')}</Text>
              <Text style={styles.scoreValue}>
                {formatScore(selectedToilet.smell_score)}/5
              </Text>
            </View>
          </View>

          {(selectedToilet.total_reviews ?? 0) === 0 && (
            <Text style={styles.importedHintText}>{t('importedNoReviewsHint')}</Text>
          )}

          <View style={styles.amenitiesContainer}>
            {selectedToilet.has_toilet_paper && (
              <Text style={styles.amenity}>🧻 {t('toiletPaper')}</Text>
            )}
            {selectedToilet.has_hand_soap && (
              <Text style={styles.amenity}>🧼 {t('handSoap')}</Text>
            )}
            {selectedToilet.has_baby_changing && (
              <Text style={styles.amenity}>👶 {t('babyChanging')}</Text>
            )}
            {selectedToilet.has_family_room && (
              <Text style={styles.amenity}>👨‍👩‍👧 {t('familyRoom')}</Text>
            )}
            {selectedToilet.has_bidet && (
              <Text style={styles.amenity}>🚿 {t('bidet')}</Text>
            )}
            {selectedToilet.has_seat_warmer && (
              <Text style={styles.amenity}>🔥 {t('seatWarmer')}</Text>
            )}
            {selectedToilet.wheelchair_accessible && (
              <Text style={styles.amenity}>♿ {t('accessible')}</Text>
            )}
          </View>

          {selectedToilet.distance && (
            <Text style={styles.distanceText}>
              {selectedToilet.distance}{t('metersAway')}
            </Text>
          )}

          {badges.length > 0 && (
            <View style={styles.venueBadgesRow}>
              {badges.map((b, i) => (
                <Text key={i} style={styles.venueBadge}>
                  {b.label} {b.emoji}
                </Text>
              ))}
            </View>
          )}

          <View style={styles.reportRow}>
            <Text style={styles.reportRowLabel}>{t('report')}:</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.reportRowScroll}>
              {(
                [
                  { key: 'busy' as const, label: t('busy') },
                  { key: 'gross' as const, label: t('gross') },
                  { key: 'needs_cleaning' as const, label: t('needsCleaning') },
                  { key: 'closed' as const, label: t('closed') },
                  { key: 'out_of_order' as const, label: t('broken') },
                  { key: 'no_access' as const, label: t('noAccess') },
                ] as const
              ).map((r) => (
                <Pressable
                  key={r.key}
                  style={({ pressed }) => [styles.reportChip, pressed && styles.reportChipPressed]}
                  onPress={() => submitReport(selectedToilet, r.key)}
                >
                  <Text style={styles.reportChipText}>{r.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>

          <View style={styles.cardActionsRow}>
            <TouchableOpacity
              style={[styles.detailsButton, styles.cardActionButton, styles.directionsButton]}
              onPress={() => {
                openInMapsWithChoice(
                  selectedToilet.latitude,
                  selectedToilet.longitude,
                  selectedToilet.name
                );
                api.track('directions_started', { dest: 'toilet', toiletId: selectedToilet.id });
              }}
            >
              <Text style={styles.detailsButtonText}>{t('openInMaps')}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.detailsButton, styles.cardActionButton]}
              onPress={() => {
                (navigation as any).navigate('ToiletDetails', { toiletId: selectedToilet.id });
                setSelectedToilet(null);
                api.track('toilet_details_opened', { toiletId: selectedToilet.id });
              }}
            >
              <Text style={styles.detailsButtonText}>{t('viewDetails')}</Text>
            </TouchableOpacity>
          </View>
        </View>
          );
        })()}

      {/* List View - tabs (Nearby, Saved, Lists) below search bar */}
      {viewMode === 'list' && (
        <View style={styles.listContainer}>
          <View style={[styles.listTabs, { top: Math.max(insets.top, 8) + 8 + 48 }]}>
            <Pressable
              style={({ pressed }) => [
                styles.listTabButton,
                listTab === 'nearby' && styles.listTabButtonActive,
                pressed && styles.listTabButtonPressed,
              ]}
              onPress={() => setListTab('nearby')}
            >
              <Text style={[styles.listTabText, listTab === 'nearby' && styles.listTabTextActive]}>{t('nearby')}</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.listTabButton,
                listTab === 'saved' && styles.listTabButtonActive,
                pressed && styles.listTabButtonPressed,
              ]}
              onPress={async () => {
                setListTab('saved');
                try {
                  const res = await api.listFavorites();
                  setSavedToilets((res.favorites || []) as any);
                } catch {
                  // ignore
                }
              }}
            >
              <Text style={[styles.listTabText, listTab === 'saved' && styles.listTabTextActive]}>{t('saved')}</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.listTabButton,
                listTab === 'lists' && styles.listTabButtonActive,
                pressed && styles.listTabButtonPressed,
              ]}
              onPress={() => {
                setListTab('lists');
                setActiveCollectionId(null);
              }}
            >
              <Text style={[styles.listTabText, listTab === 'lists' && styles.listTabTextActive]}>{t('lists')}</Text>
            </Pressable>
          </View>
          {listTab === 'lists' && activeCollection && (
            <View style={styles.listDetailHeader}>
              <Pressable style={styles.listDetailBack} onPress={() => setActiveCollectionId(null)}>
                <Text style={styles.listDetailBackText}>← {t('lists')}</Text>
              </Pressable>
              <Text style={styles.listDetailTitle} numberOfLines={1}>
                {activeCollection.name}
              </Text>
            </View>
          )}
          <FlatList
            data={
              listTab === 'saved'
                ? (Array.isArray(savedToilets) ? savedToilets : [])
                : listTab === 'lists'
                  ? (activeCollection ? (Array.isArray(activeCollection.toilets) ? activeCollection.toilets : []) : (Array.isArray(collections) ? collections : [])) as any
                  : nearbyToiletsSorted.slice(0, nearbyListLimit)
            }
            keyExtractor={(item) => item.id}
            contentContainerStyle={{
              // Start below search bar + tabs (Nearby, Saved, Lists)
              paddingTop: listTab === 'lists' && activeCollection ? 132 : Math.max(insets.top, 8) + 8 + 48 + 52 + 12,
              // Keep last item above the bottom Map/List + Already Plooping bars
              paddingBottom: Math.max(insets.bottom, 20) + 120,
            }}
            renderItem={({ item }) => (
              listTab === 'lists' && !activeCollection ? (
                <Pressable
                  style={({ pressed }) => [styles.collectionRow, pressed && styles.listItemPressed]}
                  onPress={() => setActiveCollectionId((item as any).id)}
                >
                  <View style={styles.collectionRowText}>
                    <Text style={styles.collectionRowTitle}>{(item as any).name}</Text>
                    <Text style={styles.collectionRowSubtitle}>{((item as any).toilets || []).length} toilets</Text>
                  </View>
                  <Text style={styles.listItemArrow}>→</Text>
                </Pressable>
              ) : (
              <Pressable
                style={({ pressed }) => [
                  styles.listItem,
                  pressed && styles.listItemPressed,
                ]}
                  onPress={async () => {
                    try {
                      const id = (item as any).id as string;
                      const existing =
                        toilets.find((t) => t.id === id) || savedToilets.find((t) => t.id === id) || null;
                      if (existing) {
                        setSelectedToilet(existing);
                        setViewMode('map');
                        api.track('toilet_selected', { source: 'list', toiletId: existing.id });
                        return;
                      }
                      const full = await api.getToilet(id);
                      setSelectedToilet(full as any);
                      setViewMode('map');
                      api.track('toilet_selected', { source: 'list', toiletId: id });
                    } catch {
                      // ignore
                    }
                  }}
              >
                <View style={styles.listItemContent}>
                  <View style={styles.listItemTopRow}>
                    <Text style={styles.listItemName}>{parseToiletNameAndBadges(item.name).displayName || item.name}</Text>
                    <Text style={styles.listItemMetaRight}>
                      {typeof item.confidence_score !== 'undefined' ? `${t('ploopScore')} ${formatPloopScore(item.confidence_score)}` : ''}
                      {!!item.active_reports ? ` • ${item.active_reports} rpt` : ''}
                      {favoritesLoaded && isFavorite(item.id) ? ' • ★' : ''}
                    </Text>
                  </View>
                  {item.address && (
                    <Text style={styles.listItemAddress}>{item.address}</Text>
                  )}
                  <View style={styles.listItemScores}>
                    <Text style={styles.listItemScore}>
                      Cleanliness: {formatScore(item.cleanliness_score)}/5
                    </Text>
                    <Text style={styles.listItemScore}>
                      Smell: {formatScore(item.smell_score)}/5
                    </Text>
                  </View>
                  {item.distance && (
                    <Text style={styles.listItemDistance}>{item.distance}m away</Text>
                  )}
                </View>
                <Text style={styles.listItemArrow}>→</Text>
              </Pressable>
              )
            )}
            ListEmptyComponent={
              <View style={styles.listEmpty}>
                <Text style={styles.listEmptyText}>
                  {listTab === 'saved'
                    ? t('noSavedToilets')
                    : listTab === 'lists'
                      ? (collectionsLoaded ? t('noListsYetShort') : t('loadingLists'))
                      : t('noToiletsNearby')}
                </Text>
              </View>
            }
            ListFooterComponent={
              listTab === 'nearby' && nearbyToiletsSorted.length > nearbyListLimit ? (
                <Pressable
                  style={({ pressed }) => [styles.showMoreButton, pressed && styles.showMoreButtonPressed]}
                  onPress={() => setNearbyListLimit((n) => n + 10)}
                >
                  <Text style={styles.showMoreButtonText}>
                    {t('showMore')} ({nearbyToiletsSorted.length - nearbyListLimit} {t('moreCount')})
                  </Text>
                </Pressable>
              ) : null
            }
          />
        </View>
      )}

      {/* Bottom Navigation Bar - Map/List - hidden when POI card is open */}
      {!tappedLocation && !selectedToilet && (
      <>
      <View style={[styles.viewModeContainer, { bottom: Math.max(insets.bottom, 20) + 52 }]}>
        <Pressable
          style={({ pressed }) => [
            styles.viewModeButton,
            viewMode === 'map' && styles.viewModeButtonActive,
            pressed && styles.viewModeButtonPressed,
          ]}
          onPress={() => setViewMode('map')}
        >
          <Text style={[styles.viewModeButtonText, viewMode === 'map' && styles.viewModeButtonTextActive]}>
            🗺️ {t('map')}
          </Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.viewModeButton,
            viewMode === 'list' && styles.viewModeButtonActive,
            pressed && styles.viewModeButtonPressed,
          ]}
          onPress={() => setViewMode('list')}
        >
          <Text style={[styles.viewModeButtonText, viewMode === 'list' && styles.viewModeButtonTextActive]}>
            📋 {t('list')}
          </Text>
        </Pressable>
      </View>
      <Pressable
        style={({ pressed }) => [
          styles.alreadyPloopingBar,
          { bottom: Math.max(insets.bottom, 20) },
          pressed && styles.viewModeButtonPressed,
        ]}
        onPress={() => (navigation as any).navigate('PoopGame')}
      >
        <Text style={styles.alreadyPloopingBarText}>💩 {t('alreadyPlooping')}</Text>
      </Pressable>
      </>
      )}

      {/* Google Maps Style Bottom Sheet */}
      {viewMode === 'map' && tappedLocation && (
        <View style={styles.bottomSheet}>
          <View style={styles.bottomSheetHandle} />
          
          {/* Header with close button */}
          <View style={styles.bottomSheetHeader}>
            <View style={styles.bottomSheetTitleContainer}>
              <Text style={styles.bottomSheetTitle}>
                {tappedLocation.place?.name || 
                 (tappedLocation.location?.address && !tappedLocation.location.address.includes('Location at') && !tappedLocation.location.address.match(/^-?\d+\.?\d*,\s*-?\d+\.?\d*$/) ? tappedLocation.location.address : null) ||
                 t('location')}
              </Text>
              {loadingLocationDetails && (
                <Text style={styles.bottomSheetAddress}>{t('loadingDetails')}</Text>
              )}
              {!loadingLocationDetails && tappedLocation.place?.address && (
                <Text style={styles.bottomSheetAddress}>{tappedLocation.place.address}</Text>
              )}
              {!loadingLocationDetails && tappedLocation.location?.address && !tappedLocation.place?.address && !tappedLocation.location.address.includes('Location at') && !tappedLocation.location.address.match(/^-?\d+\.?\d*,\s*-?\d+\.?\d*$/) && (
                <Text style={styles.bottomSheetAddress}>{tappedLocation.location.address}</Text>
              )}
              {!loadingLocationDetails && !tappedLocation.place?.address && (!tappedLocation.location?.address || tappedLocation.location.address.includes('Location at') || tappedLocation.location.address.match(/^-?\d+\.?\d*,\s*-?\d+\.?\d*$/)) && (
                <Text style={[styles.bottomSheetAddress, { color: '#94a3b8', fontStyle: 'italic' }]}>
                  {t('detailsUnavailable')}
                </Text>
              )}
            </View>
            <View style={styles.bottomSheetIcons}>
              <TouchableOpacity
                style={styles.iconButton}
                onPress={async () => {
                  try {
                    const place = tappedLocation.place;
                    const location = tappedLocation.location;
                    const name = place?.name || location?.address || t('location');
                    const address = place?.address || location?.address || '';
                    await Share.share({
                      message: `Check out ${name} at ${address}`,
                    });
                  } catch (error) {
                    console.error('Error sharing:', error);
                  }
                }}
              >
                <Text style={styles.iconButtonText}>↗</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.iconButton}
                onPress={async () => {
                  if (tappedPoiToilet) {
                    await toggleFavorite(tappedPoiToilet);
                    return;
                  }
                  const placeId = tappedLocation.place?.placeId ?? tappedLocation.place?.id;
                  if (placeId) {
                    Alert.alert('Save', 'Add this place to Ploop first (leave a review) to save it.');
                  }
                }}
              >
                <Text style={styles.iconButtonText}>
                  {tappedPoiToilet && isFavorite(tappedPoiToilet.id) ? '★' : '🔖'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.iconButton}
                onPress={() => setTappedLocation(null)}
              >
                <Text style={styles.iconButtonText}>✕</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Rating and Info */}
          {tappedLocation.place?.googleRating && (
            <View style={styles.bottomSheetRating}>
              <Text style={styles.ratingValue}>{tappedLocation.place.googleRating.toFixed(1)}</Text>
              <View style={styles.starsContainer}>
                {[1, 2, 3, 4, 5].map((star) => (
                  <Text key={star} style={styles.star}>
                    {star <= Math.floor(tappedLocation.place.googleRating) ? '⭐' : '☆'}
                  </Text>
                ))}
              </View>
              <Text style={styles.reviewCount}>
                ({tappedLocation.place.googleReviewCount || 0})
              </Text>
            </View>
          )}

          {typeof (tappedLocation.place as any)?.openNow === 'boolean' && (
            <View style={styles.openNowRow}>
              <Text style={[styles.openNowPill, (tappedLocation.place as any).openNow ? styles.openNowPillOpen : styles.openNowPillClosed]}>
                {(tappedLocation.place as any).openNow ? 'Open now' : 'Closed now'}
              </Text>
            </View>
          )}

          {/* Action Buttons */}
          <View style={styles.actionButtonsContainer}>
            <TouchableOpacity
              style={styles.bottomSheetActionButton}
              onPress={() => {
                openInMapsWithChoice(
                  tappedLocation.latitude,
                  tappedLocation.longitude,
                  tappedLocation.place?.name || tappedLocation.location?.address || t('destination')
                );
              }}
            >
              <Text style={styles.bottomSheetActionButtonText}>{t('openInMaps')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.bottomSheetActionButton, styles.bottomSheetActionButtonSecondary]}
              onPress={() => {
                (navigation as any).navigate('LocationReview', {
                  latitude: tappedLocation.latitude,
                  longitude: tappedLocation.longitude,
                  placeId: tappedLocation.place?.placeId,
                  placeName: tappedLocation.place?.name,
                  placeAddress: tappedLocation.place?.address || tappedLocation.location?.address,
                });
                setTappedLocation(null);
              }}
            >
              <Text style={[styles.bottomSheetActionButtonText, styles.bottomSheetActionButtonTextSecondary]}>{t('reviewButton')}</Text>
            </TouchableOpacity>
          </View>

          {/* Google Reviews Preview */}
          {tappedLocation.place?.googleReviews && tappedLocation.place.googleReviews.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.reviewsPreview}>
              {tappedLocation.place.googleReviews.slice(0, 3).map((review: any, index: number) => (
                <View key={index} style={styles.reviewPreviewCard}>
                  <Text style={styles.reviewPreviewAuthor}>{review.author}</Text>
                  <Text style={styles.reviewPreviewRating}>⭐ {review.rating}/5</Text>
                  <Text style={styles.reviewPreviewText} numberOfLines={3}>
                    {review.text}
                  </Text>
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      )}

      {/* Loading overlay for location details */}
      {loadingLocationDetails && !tappedLocation && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#fff" />
          <Text style={styles.loadingOverlayText}>{t('loadingLocation')}</Text>
        </View>
      )}

    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingBanner: {
    position: 'absolute',
    left: 16,
    right: 16,
    alignItems: 'center',
    zIndex: 10,
  },
  loadingBannerText: {
    fontSize: 14,
    color: '#64748b',
    marginTop: 8,
    marginBottom: 12,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#666',
  },
  retryButton: {
    marginTop: 20,
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: '#2196F3',
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  mapWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  map: {
    width: '100%',
    height: '100%',
  },
  searchContainer: {
    position: 'absolute',
    left: 12,
    right: 12,
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 6,
    zIndex: 1000,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 6,
      },
      android: {
        elevation: 6,
      },
    }),
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    padding: 0,
  },
  clearButton: {
    marginLeft: 8,
    padding: 4,
  },
  settingsButton: {
    marginLeft: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  settingsButtonPressed: {
    opacity: 0.9,
  },
  settingsButtonText: {
    fontSize: 16,
  },
  topRightButton: {
    position: 'absolute',
    right: 12,
    zIndex: 1001,
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 6,
  },
  topRightButtonText: {
    fontSize: 22,
    fontWeight: '900',
    color: '#111827',
    marginTop: -2,
  },
  clearButtonText: {
    fontSize: 18,
    color: '#999',
  },
  searchResults: {
    position: 'absolute',
    left: 12,
    right: 12,
    backgroundColor: '#fff',
    borderRadius: 12,
    maxHeight: 300,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 6,
    zIndex: 999,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 6,
      },
      android: {
        elevation: 6,
      },
    }),
  },
  backendBanner: {
    position: 'absolute',
    left: 12,
    right: 12,
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 14,
    zIndex: 1000,
    ...Platform.select({ ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 6 }, android: { elevation: 8 } }),
  },
  backendBannerTitle: { fontSize: 14, fontWeight: '700', color: '#fef2f2', marginBottom: 6 },
  backendBannerText: { fontSize: 12, color: '#cbd5e1', marginBottom: 4 },
  backendBannerUrl: { fontSize: 11, color: '#94a3b8', fontFamily: 'monospace', marginBottom: 10 },
  backendBannerDismiss: { alignSelf: 'flex-end', paddingVertical: 6, paddingHorizontal: 12 },
  backendBannerDismissText: { fontSize: 14, color: '#60a5fa', fontWeight: '600' },
  searchErrorBanner: {
    padding: 14,
    backgroundColor: '#fef2f2',
    borderRadius: 8,
  },
  searchErrorText: {
    fontSize: 13,
    color: '#dc2626',
  },
  searchResultsList: {
    borderRadius: 12,
  },
  searchResultItem: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  searchResultName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  searchResultAddress: {
    fontSize: 14,
    color: '#666',
  },
  landmarkMarkerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  landmarkMarkerEmoji: {
    fontSize: 32,
    textAlign: 'center',
  },
  markerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerEmoji: {
    fontSize: 32,
    textAlign: 'center',
  },
  markerBadge: {
    position: 'absolute',
    bottom: -2,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
    elevation: 3,
  },
  markerBadgeInner: {
    flex: 1,
    borderRadius: 4,
  },
  clusterBubble: {
    minWidth: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 6,
  },
  clusterBubbleText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '900',
  },
  toiletCard: {
    position: 'absolute',
    bottom: 80,
    left: 12,
    right: 12,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  toiletCardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  toiletCardName: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 8,
    color: '#333',
    flex: 1,
  },
  toiletCardIconButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  toiletCardIconButtonPressed: {
    opacity: 0.85,
  },
  toiletCardIconButtonText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
  },
  toiletCardSosButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#fef3c7',
    borderWidth: 1,
    borderColor: '#fcd34d',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  toiletCardSosButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#92400e',
  },
  toiletCardAddress: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
  },
  venueBadgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
    alignSelf: 'flex-end',
  },
  venueBadge: {
    fontSize: 13,
    color: '#64748b',
    fontWeight: '500',
  },
  pillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#EEF2FF',
    borderWidth: 1,
    borderColor: '#E0E7FF',
  },
  pillText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#3730A3',
  },
  pillWarning: {
    backgroundColor: '#FEF3C7',
    borderColor: '#FDE68A',
  },
  pillTextWarning: {
    color: '#92400E',
  },
  pillFavorite: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  pillServiced: {
    backgroundColor: '#FEF3C7',
    borderColor: '#FDE68A',
  },
  pillTextFavorite: {
    color: '#065F46',
  },
  scoreContainer: {
    flexDirection: 'row',
    marginBottom: 12,
    gap: 20,
  },
  scoreItem: {
    flex: 1,
  },
  importedHintText: {
    fontSize: 13,
    color: '#92400e',
    lineHeight: 18,
    marginBottom: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: '#fef3c7',
    borderRadius: 8,
  },
  scoreLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
  },
  scoreValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2196F3',
  },
  amenitiesContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 12,
    gap: 8,
  },
  amenity: {
    fontSize: 14,
    color: '#666',
    marginRight: 12,
  },
  distanceText: {
    fontSize: 12,
    color: '#999',
    marginBottom: 12,
  },
  reportRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  reportRowLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#374151',
  },
  reportRowScroll: {
    gap: 8,
    paddingRight: 4,
  },
  reportChip: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  reportChipPressed: {
    opacity: 0.85,
  },
  reportChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#111827',
  },
  detailsButton: {
    backgroundColor: '#2196F3',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  cardActionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  cardActionButton: {
    flex: 1,
  },
  directionsButton: {
    backgroundColor: '#1A73E8',
  },
  detailsButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  listContainer: {
    flex: 1,
    backgroundColor: '#fff',
  },
  listTabs: {
    position: 'absolute',
    top: 10,
    left: 12,
    right: 12,
    zIndex: 10,
    flexDirection: 'row',
    gap: 8,
  },
  listTabButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  listTabButtonActive: {
    backgroundColor: '#111827',
    borderColor: '#111827',
  },
  listTabButtonPressed: {
    opacity: 0.9,
  },
  listTabText: {
    fontSize: 14,
    fontWeight: '900',
    color: '#111827',
  },
  listTabTextActive: {
    color: '#fff',
  },
  listDetailHeader: {
    position: 'absolute',
    top: 62,
    left: 12,
    right: 12,
    zIndex: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  listDetailBack: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  listDetailBackText: {
    fontSize: 12,
    fontWeight: '900',
    color: '#111827',
  },
  listDetailTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '900',
    color: '#111827',
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    backgroundColor: '#fff',
  },
  listItemPressed: {
    backgroundColor: '#f5f5f5',
  },
  listItemContent: {
    flex: 1,
  },
  listItemTopRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 8,
  },
  listItemName: {
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 6,
    color: '#333',
    flex: 1,
  },
  listItemMetaRight: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6B7280',
  },
  listItemAddress: {
    fontSize: 14,
    color: '#666',
    marginBottom: 10,
    lineHeight: 20,
  },
  listItemScores: {
    flexDirection: 'row',
    gap: 15,
    marginBottom: 4,
  },
  listItemScore: {
    fontSize: 13,
    color: '#2196F3',
    fontWeight: '600',
  },
  listItemDistance: {
    fontSize: 13,
    color: '#999',
    marginTop: 4,
  },
  listItemArrow: {
    fontSize: 24,
    color: '#ccc',
    marginLeft: 12,
    fontWeight: '300',
  },
  listEmpty: {
    padding: 40,
    alignItems: 'center',
  },
  listEmptyText: {
    fontSize: 16,
    color: '#999',
  },
  showMoreButton: {
    paddingVertical: 16,
    paddingHorizontal: 24,
    alignItems: 'center',
    marginVertical: 12,
    backgroundColor: '#E8F0FE',
    borderRadius: 12,
    marginHorizontal: 16,
  },
  showMoreButtonPressed: {
    opacity: 0.8,
  },
  showMoreButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1A73E8',
  },
  viewModeContainer: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#fff',
    borderRadius: 25,
    paddingVertical: 6,
    paddingHorizontal: 6,
    zIndex: 20,
    minWidth: 240,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 5,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 4,
      },
      android: {
        elevation: 5,
      },
    }),
  },
  mapProviderBadge: {
    position: 'absolute',
    zIndex: 29,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
    elevation: 4,
  },
  mapProviderBadgeText: {
    fontSize: 12,
    color: '#555',
    fontWeight: '600',
  },
  zoomControls: {
    position: 'absolute',
    left: 12,
    zIndex: 30,
    flexDirection: 'column',
    alignItems: 'center',
    gap: 12,
  },
  zoomButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 5,
  },
  zoomButtonPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  zoomButtonText: {
    fontSize: 22,
    fontWeight: '800',
    color: '#1A73E8',
    marginTop: -1,
  },
  reviewStrip: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 15,
    paddingLeft: 56,
  },
  reviewStripHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  reviewStripTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#333',
  },
  clearRoutePill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#E8F0FE',
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  clearRoutePillText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1A73E8',
  },
  reviewChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 10,
    marginRight: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 4,
    minWidth: 220,
    maxWidth: Dimensions.get('window').width - 44,
  },
  reviewChipPressed: {
    opacity: 0.9,
  },
  reviewChipImage: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#eee',
    marginRight: 10,
  },
  reviewChipImagePlaceholder: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#F2F2F2',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  reviewChipImagePlaceholderText: {
    fontSize: 20,
  },
  reviewChipTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  reviewChipTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#222',
    marginBottom: 2,
  },
  reviewChipSubtitle: {
    fontSize: 12,
    color: '#666',
    fontWeight: '600',
  },
  navBanner: {
    position: 'absolute',
    left: 12,
    right: 12,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 12,
    zIndex: 25,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 6,
  },
  navBannerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  navBannerTopActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  navBannerTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '800',
    color: '#222',
  },
  navBannerMeta: {
    marginTop: 4,
    fontSize: 13,
    color: '#555',
    fontWeight: '700',
  },
  navBannerMetaSecondary: {
    marginTop: 2,
    fontSize: 12,
    color: '#6B7280',
    fontWeight: '700',
  },
  navDetailsButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#EEF2FF',
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  navDetailsButtonPressed: {
    opacity: 0.9,
  },
  navDetailsButtonText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#1A73E8',
  },
  navStopButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
  },
  navStopButtonText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#B91C1C',
  },
  navModeRow: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 44,
  },
  navModeScroll: {
    flex: 1,
    minHeight: 44,
  },
  navModeScrollContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingRight: 8,
  },
  modeChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  modeChipActive: {
    backgroundColor: '#E8F0FE',
    borderColor: '#C7D2FE',
  },
  modeChipPressed: {
    opacity: 0.9,
  },
  modeChipText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#374151',
  },
  modeChipTextActive: {
    color: '#1A73E8',
  },
  followChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    flexShrink: 0,
    marginLeft: 8,
  },
  followChipActive: {
    backgroundColor: '#DCFCE7',
    borderColor: '#86EFAC',
  },
  followChipText: {
    fontSize: 12,
    fontWeight: '900',
    color: '#374151',
  },
  followChipTextActive: {
    color: '#166534',
  },
  stepsBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  stepsSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingTop: 8,
    paddingHorizontal: 14,
    maxHeight: '70%',
  },
  stepsHandle: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#E5E7EB',
    marginBottom: 10,
  },
  stepsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  stepsTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: '#111827',
  },
  stepsClose: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F3F4F6',
  },
  stepsCloseText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111827',
  },
  stepsSummary: {
    fontSize: 13,
    fontWeight: '700',
    color: '#374151',
    marginBottom: 10,
  },
  stepsList: {
    flex: 1,
  },
  stepsEmpty: {
    paddingVertical: 24,
    textAlign: 'center',
    color: '#6B7280',
    fontWeight: '700',
  },
  stepCard: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  stepIcon: {
    width: 28,
    fontSize: 18,
    textAlign: 'center',
    marginTop: 2,
  },
  stepBody: {
    flex: 1,
    minWidth: 0,
  },
  stepTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#111827',
  },
  stepMeta: {
    marginTop: 2,
    fontSize: 12,
    color: '#6B7280',
    fontWeight: '700',
  },
  transitMetaBlock: {
    marginTop: 6,
    padding: 10,
    borderRadius: 12,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  transitStops: {
    fontSize: 12,
    fontWeight: '900',
    color: '#111827',
    marginBottom: 4,
  },
  transitTimes: {
    fontSize: 12,
    fontWeight: '700',
    color: '#374151',
    marginBottom: 2,
  },
  transitStopsCount: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6B7280',
  },
  settingsModalContainer: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  settingsBackdrop: {
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  settingsSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingTop: 10,
    paddingHorizontal: 14,
    width: '100%',
  },
  settingsScroll: {
    flex: 1,
    minHeight: 0,
  },
  settingsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  settingsTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: '#111827',
  },
  settingsClose: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F3F4F6',
  },
  settingsCloseText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111827',
  },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    gap: 12,
  },
  settingsRowText: {
    flex: 1,
    minWidth: 0,
  },
  settingsRowTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#111827',
  },
  settingsRowChevron: {
    fontSize: 18,
    color: '#9ca3af',
    marginLeft: 8,
  },
  settingsRowSubtitle: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: '700',
    color: '#6B7280',
  },
  settingsRowSubtitleMuted: {
    color: '#9CA3AF',
    fontStyle: 'italic',
  },
  settingsDivider: {
    height: 1,
    backgroundColor: '#F3F4F6',
    marginVertical: 8,
  },
  settingsSectionTitle: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.6,
    color: '#6B7280',
    textTransform: 'uppercase',
  },
  oxymoronicTagline: {
    fontSize: 13,
    color: '#94a3b8',
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 12,
  },
  settingsSectionSubtitle: {
    fontSize: 13,
    color: '#9ca3af',
    marginTop: 4,
    marginBottom: 12,
    lineHeight: 18,
  },
  ploopScoreExplanation: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 4,
    marginBottom: 8,
    lineHeight: 17,
    paddingHorizontal: 4,
  },
  settingsChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingBottom: 8,
  },
  settingsHint: {
    fontSize: 12,
    color: '#9CA3AF',
    marginBottom: 14,
    lineHeight: 16,
  },
  settingsChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  settingsChipActive: {
    backgroundColor: '#1A73E8',
    borderColor: '#1A73E8',
  },
  settingsChipPressed: {
    opacity: 0.85,
  },
  settingsChipText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#111827',
  },
  settingsChipTextActive: {
    color: '#fff',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
    marginBottom: 10,
  },
  statCard: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statNumber: {
    fontSize: 18,
    fontWeight: '900',
    color: '#111827',
  },
  statLabel: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: '800',
    color: '#6B7280',
  },
  badgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingBottom: 16,
  },
  badgePill: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#EEF2FF',
    borderWidth: 1,
    borderColor: '#E0E7FF',
  },
  badgePillLocked: {
    backgroundColor: '#F3F4F6',
    borderColor: '#E5E7EB',
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '900',
    color: '#3730A3',
  },
  badgeTextLocked: {
    color: '#6B7280',
  },
  collectionsSubtitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6B7280',
    marginBottom: 10,
  },
  collectionPickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#F9FAFB',
    marginBottom: 8,
  },
  collectionPickName: {
    fontSize: 14,
    fontWeight: '900',
    color: '#111827',
    flex: 1,
  },
  collectionPickRight: {
    fontSize: 16,
    fontWeight: '900',
    color: '#1A73E8',
    width: 24,
    textAlign: 'right',
  },
  collectionCreateRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    marginBottom: 12,
  },
  collectionCreateInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
    backgroundColor: '#fff',
  },
  collectionCreateButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
  },
  collectionCreateButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '900',
  },
  collectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    backgroundColor: '#fff',
  },
  collectionRowText: {
    flex: 1,
    minWidth: 0,
  },
  collectionRowTitle: {
    fontSize: 17,
    fontWeight: '900',
    color: '#111827',
    marginBottom: 4,
  },
  collectionRowSubtitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6B7280',
  },
  viewModeButton: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 20,
    minHeight: 44,
    minWidth: 100,
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewModeButtonActive: {
    backgroundColor: '#2196F3',
  },
  viewModeButtonPressed: {
    opacity: 0.7,
  },
  viewModeButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#666',
  },
  viewModeButtonTextActive: {
    color: '#fff',
  },
  alreadyPloopingBar: {
    position: 'absolute',
    alignSelf: 'center',
    backgroundColor: '#10b981',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
    zIndex: 19,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  alreadyPloopingBarText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  bottomSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 10,
    paddingHorizontal: 20,
    paddingBottom: 30,
    maxHeight: '70%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 10,
  },
  bottomSheetHandle: {
    width: 40,
    height: 4,
    backgroundColor: '#ccc',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 15,
  },
  bottomSheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 15,
  },
  bottomSheetTitleContainer: {
    flex: 1,
    marginRight: 10,
  },
  bottomSheetTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  bottomSheetAddress: {
    fontSize: 14,
    color: '#666',
  },
  bottomSheetIcons: {
    flexDirection: 'row',
    gap: 10,
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#f0f0f0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconButtonText: {
    fontSize: 18,
    color: '#333',
  },
  bottomSheetRating: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 15,
    gap: 8,
  },
  openNowRow: {
    marginBottom: 12,
  },
  openNowPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    overflow: 'hidden',
    fontSize: 12,
    fontWeight: '900',
  },
  openNowPillOpen: {
    backgroundColor: '#ECFDF5',
    color: '#065F46',
  },
  openNowPillClosed: {
    backgroundColor: '#FEF2F2',
    color: '#991B1B',
  },
  ratingValue: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#333',
  },
  starsContainer: {
    flexDirection: 'row',
    gap: 2,
  },
  star: {
    fontSize: 16,
  },
  reviewCount: {
    fontSize: 14,
    color: '#666',
  },
  actionButtonsContainer: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
  },
  bottomSheetActionButton: {
    flex: 1,
    backgroundColor: '#34A853',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  bottomSheetActionButtonSecondary: {
    backgroundColor: '#f0f0f0',
  },
  bottomSheetActionButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  bottomSheetActionButtonTextSecondary: {
    color: '#333',
  },
  reviewsPreview: {
    marginTop: 10,
  },
  reviewPreviewCard: {
    width: 280,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    padding: 12,
    marginRight: 10,
  },
  reviewPreviewAuthor: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  reviewPreviewRating: {
    fontSize: 12,
    color: '#FF9800',
    marginBottom: 6,
  },
  reviewPreviewText: {
    fontSize: 12,
    color: '#333',
    lineHeight: 16,
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingOverlayText: {
    marginTop: 10,
    color: '#fff',
    fontSize: 16,
  },
  debugIndicator: {
    position: 'absolute',
    top: 100,
    right: 12,
    backgroundColor: '#4CAF50',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  debugText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  arrivalCard: {
    position: 'absolute',
    left: 12,
    right: 12,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
  arrivalHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  arrivalTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: '#111827',
  },
  arrivalDistance: {
    fontSize: 14,
    fontWeight: '900',
    color: '#6B7280',
  },
  arrivalMetaRow: {
    marginTop: 4,
    marginBottom: 10,
  },
  arrivalMetaText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#374151',
  },
  arrivalHintsBlock: {
    marginTop: 2,
    marginBottom: 10,
  },
  arrivalHintsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  arrivalHintsTitle: {
    fontSize: 13,
    fontWeight: '900',
    color: '#111827',
  },
  arrivalHintAdd: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#1A73E8',
  },
  arrivalHintAddText: {
    fontSize: 12,
    fontWeight: '900',
    color: '#fff',
  },
  arrivalHintsEmpty: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6B7280',
  },
  arrivalHintText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 4,
  },
  arrivalActionsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  arrivalActionChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    alignItems: 'center',
  },
  arrivalActionChipText: {
    fontSize: 12,
    fontWeight: '900',
    color: '#111827',
  },
  hintBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  sosBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sosModalContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  sosModalInner: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 340,
  },
  sosModalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 4,
    color: '#111',
  },
  sosModalSubtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 20,
  },
  sosOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  sosOptionEmoji: {
    fontSize: 24,
    marginRight: 12,
  },
  sosOptionLabel: {
    fontSize: 16,
    fontWeight: '500',
    color: '#334155',
  },
  sosCancel: {
    marginTop: 16,
    paddingVertical: 12,
    alignItems: 'center',
  },
  sosCancelText: {
    fontSize: 16,
    color: '#64748b',
    fontWeight: '500',
  },
  hintSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingTop: 10,
    paddingHorizontal: 14,
    maxHeight: '55%',
  },
  hintHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  hintTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: '#111827',
  },
  hintClose: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F3F4F6',
  },
  hintCloseText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111827',
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
  },
  suggestionInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#111827',
  },
  suggestionSubmit: {
    backgroundColor: '#1A73E8',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestionSubmitText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  suggestionSuccessText: {
    marginTop: 6,
    fontSize: 13,
    color: '#059669',
  },
  hintInput: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 90,
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 12,
  },
  hintSubmit: {
    backgroundColor: '#1A73E8',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  hintSubmitPressed: {
    opacity: 0.9,
  },
  hintSubmitDisabled: {
    opacity: 0.6,
  },
  hintSubmitText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '900',
  },
});

export default MapScreen;
