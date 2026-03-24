/**
 * After permission + location: keeps the loading screen ~0.9–3.8s while toilets load in the background.
 * Map appears after that window (or sooner if API finishes after the minimum). MapScreen refetches if toilets were deferred.
 * Shows language picker inline when user hasn't chosen yet (choose while loading).
 */
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { api, type Toilet } from '../services/api';
import { searchNearbyToilets as searchGaodeToilets } from '../services/gaodePoi';
import { useLanguage } from '../context/LanguageContext';
import { useMapProvider } from '../context/MapProviderContext';
import { MapPreloadProvider, type MapPreloadData } from '../context/MapPreloadContext';
import { getOxymoronicTagline } from '../utils/engagement';
import {
  startLoadDiagnostics,
  markPermissionDone,
  startLocationPhase,
  markLocationDone,
  startApiPhase,
  markApiDone,
  finishLoadDiagnostics,
  sendLoadDiagnosticsToBackend,
} from '../utils/loadDiagnostics';

const LOCATION_TIMEOUT_MS = 6000;
/** Minimum splash time after coords (animation + API head start) */
const MIN_LOADING_AFTER_COORDS_MS = 900;
/** Cap splash after coords (~4s max) while toilets load */
const MAX_LOADING_AFTER_COORDS_MS = 3800;
// Fallback when getLastKnownPositionAsync returns null (common on Android) – show map fast, refetch when GPS locks
const FALLBACK_COORDS = { latitude: 37.7749, longitude: -122.4194 };
const LAST_COORDS_KEY = 'ploop.lastKnownCoords';

function metersBetween(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number }
): number {
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
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

async function saveLastCoords(coords: { latitude: number; longitude: number }): Promise<void> {
  try {
    await AsyncStorage.setItem(LAST_COORDS_KEY, JSON.stringify(coords));
  } catch {
    // non-critical
  }
}

async function loadLastCoords(): Promise<{ latitude: number; longitude: number } | null> {
  try {
    const raw = await AsyncStorage.getItem(LAST_COORDS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (isValidCoord(parsed)) return parsed;
  } catch {
    // ignore
  }
  return null;
}

function isValidCoord(c: { latitude: number; longitude: number }): boolean {
  return (
    typeof c.latitude === 'number' &&
    typeof c.longitude === 'number' &&
    Number.isFinite(c.latitude) &&
    Number.isFinite(c.longitude) &&
    Math.abs(c.latitude) <= 90 &&
    Math.abs(c.longitude) <= 180
  );
}

function sanitizeToiletList(
  coords: { latitude: number; longitude: number },
  list: Toilet[]
): Toilet[] {
  return list.filter(
    (t) =>
      t &&
      typeof t.latitude === 'number' &&
      typeof t.longitude === 'number' &&
      Number.isFinite(t.latitude) &&
      Number.isFinite(t.longitude)
  );
}

async function fetchMergedToilets(
  coords: { latitude: number; longitude: number },
  mergeWithGaode: boolean
): Promise<Toilet[]> {
  if (!isValidCoord(coords)) return [];
  const [backendRes, gaodeToilets] = await Promise.all([
    api.getNearbyToilets({
      latitude: coords.latitude,
      longitude: coords.longitude,
      radius: 2000,
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
  const backendToilets = sanitizeToiletList(coords, backendRes?.toilets ?? []);
  const gaodeSanitized = sanitizeToiletList(coords, Array.isArray(gaodeToilets) ? gaodeToilets : []);
  const DEDUPE_METERS = 40;
  const mergeAndSort = (bt: Toilet[], gt: Toilet[]): Toilet[] => {
    const isNear = (a: Toilet, b: Toilet) =>
      metersBetween(
        { latitude: a.latitude, longitude: a.longitude },
        { latitude: b.latitude, longitude: b.longitude }
      ) < DEDUPE_METERS;
    const gaodeFiltered = gt.filter((g) => !bt.some((b) => isNear(g, b)));
    const merged = [...bt, ...gaodeFiltered];
    return merged
      .map((t) => ({
        ...t,
        distance:
          t.distance ??
          Math.round(metersBetween(coords, { latitude: t.latitude, longitude: t.longitude })),
      }))
      .sort((a, b) => (a.distance ?? 999999) - (b.distance ?? 999999));
  };
  try {
    return mergeWithGaode ? mergeAndSort(backendToilets, gaodeSanitized) : backendToilets;
  } catch {
    return backendToilets;
  }
}

async function waitForToiletsWithSplashBudget(
  coords: { latitude: number; longitude: number },
  mergeWithGaode: boolean,
  isStale: () => boolean,
  onProgress: (pct: number) => void
): Promise<{ toilets: Toilet[]; toiletsDeferred: boolean }> {
  if (!isValidCoord(coords)) {
    return { toilets: [], toiletsDeferred: true };
  }
  const t0 = Date.now();
  startApiPhase();
  let resolved: Toilet[] | null = null;
  fetchMergedToilets(coords, mergeWithGaode)
    .then((t) => {
      resolved = t;
    })
    .catch(() => {
      // Leave null so caller can defer refetch on map; avoid treating errors as "empty list"
      resolved = null;
    });

  await sleep(MIN_LOADING_AFTER_COORDS_MS);
  if (isStale()) {
    markApiDone();
    return { toilets: [], toiletsDeferred: true };
  }

  onProgress(70);

  while (Date.now() - t0 < MAX_LOADING_AFTER_COORDS_MS) {
    if (resolved !== null) {
      markApiDone();
      onProgress(100);
      return { toilets: resolved, toiletsDeferred: false };
    }
    const elapsed = Date.now() - t0;
    onProgress(50 + Math.min(45, Math.floor((elapsed / MAX_LOADING_AFTER_COORDS_MS) * 45)));
    await sleep(80);
    if (isStale()) {
      markApiDone();
      return { toilets: [], toiletsDeferred: true };
    }
  }

  markApiDone();
  onProgress(100);
  return {
    toilets: resolved ?? [],
    toiletsDeferred: resolved === null,
  };
}

export function AppLoadingGate({ children }: { children: React.ReactNode }) {
  const { t, locale, localeStatus, setLocale } = useLanguage();
  const { provider: mapProvider, simulateChinaLocation, BEIJING_COORDS } = useMapProvider();
  const [tagline] = useState(() => getOxymoronicTagline());
  const [loadStatus, setLoadStatus] = useState<'loading' | 'ready' | 'failed' | 'denied'>('loading');
  const [loadAttempts, setLoadAttempts] = useState(0);
  const [loadProgress, setLoadProgress] = useState(0);
  const [preloadData, setPreloadData] = useState<MapPreloadData | null>(null);
  /** Bumped when this load run is superseded or the gate unmounts — avoids setState after stale async work */
  const loadGenerationRef = useRef(0);

  const runFullLoad = useCallback(async () => {
    const myGeneration = ++loadGenerationRef.current;
    const isStale = () => loadGenerationRef.current !== myGeneration;

    setLoadStatus('loading');
    setLoadAttempts((a) => a + 1);
    setLoadProgress(0);
    startLoadDiagnostics();

    try {
      if (simulateChinaLocation) {
        markPermissionDone();
        startLocationPhase();
        markLocationDone('currentPosition');
        const mergeWithGaode = mapProvider === 'amap';
        if (!isStale()) setLoadProgress(45);
        const apiResult = await waitForToiletsWithSplashBudget(
          BEIJING_COORDS,
          mergeWithGaode,
          isStale,
          (pct) => {
            if (!isStale()) setLoadProgress(pct);
          }
        );
        if (isStale()) return;
        setPreloadData({
          location: { coords: BEIJING_COORDS } as Location.LocationObject,
          toilets: apiResult.toilets,
          toiletsDeferred: apiResult.toiletsDeferred,
        });
        setLoadStatus('ready');
        const diag = finishLoadDiagnostics(true);
        sendLoadDiagnosticsToBackend(diag);
        return;
      }

      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        markPermissionDone();
        if (!isStale()) setLoadProgress(25);
        if (isStale()) return;
        if (status !== 'granted') {
          setLoadStatus('denied');
          setPreloadData(null);
          const diag = finishLoadDiagnostics(false);
          sendLoadDiagnosticsToBackend(diag);
          return;
        }

        startLocationPhase();
        let coords: { latitude: number; longitude: number } | null = null;
        let locationSource: 'lastKnown' | 'currentPosition' | 'timeout' = 'currentPosition';
        // Android: use longer maxAge to increase cache hit (getLastKnown often null on Android)
        const lastKnownMaxAge = Platform.OS === 'android' ? 300000 : 60000; // 5 min vs 1 min
        try {
          const lastKnown = await Location.getLastKnownPositionAsync({ maxAge: lastKnownMaxAge });
          if (lastKnown?.coords) {
            coords = {
              latitude: lastKnown.coords.latitude,
              longitude: lastKnown.coords.longitude,
            };
            locationSource = 'lastKnown';
            saveLastCoords(coords);
          }
        } catch {
          // ignore
        }
        let preliminary = false;
        if (!coords) {
          // Android: when lastKnown is null, don't block 5–10s. Use last-cached or fallback coords, show map fast, refetch when GPS locks.
          if (Platform.OS === 'android') {
            const cachedCoords = await loadLastCoords();
            coords = cachedCoords ?? FALLBACK_COORDS;
            preliminary = true;
            markLocationDone('timeout'); // we're not waiting for GPS
          } else {
            const accuracy = Location.Accuracy.Balanced;
            try {
              const pos = await Promise.race([
                Location.getCurrentPositionAsync({ accuracy }),
                new Promise<never>((_, reject) =>
                  setTimeout(() => reject(new Error('timeout')), LOCATION_TIMEOUT_MS)
                ),
              ]);
              if (pos?.coords) {
                coords = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
                locationSource = 'currentPosition';
                saveLastCoords(coords);
              }
            } catch {
              locationSource = 'timeout';
              coords = FALLBACK_COORDS;
              preliminary = true;
            }
            markLocationDone(locationSource);
          }
        } else {
          markLocationDone(locationSource);
        }

        if (isStale()) return;
        if (!coords) {
          setLoadStatus('denied');
          setPreloadData(null);
          const diag = finishLoadDiagnostics(false);
          sendLoadDiagnosticsToBackend(diag);
          return;
        }

        const mergeWithGaode = mapProvider === 'amap';
        if (!isStale()) setLoadProgress(45);
        const apiResult = await waitForToiletsWithSplashBudget(
          coords,
          mergeWithGaode,
          isStale,
          (pct) => {
            if (!isStale()) setLoadProgress(pct);
          }
        );
        if (isStale()) return;

        setPreloadData({
          location: { coords } as Location.LocationObject,
          toilets: apiResult.toilets,
          preliminary: preliminary || undefined,
          toiletsDeferred: apiResult.toiletsDeferred,
        });
        setLoadStatus('ready');
        const diag = finishLoadDiagnostics(true);
        sendLoadDiagnosticsToBackend(diag);
      } catch {
        if (!isStale()) {
          setLoadStatus('failed');
          setPreloadData(null);
          const diag = finishLoadDiagnostics(false);
          sendLoadDiagnosticsToBackend(diag);
        }
      }
    } finally {
      // no-op
    }
  }, [simulateChinaLocation, BEIJING_COORDS, mapProvider]);

  useEffect(() => {
    runFullLoad();
    return () => {
      loadGenerationRef.current += 1;
    };
  }, [runFullLoad]);

  const allReady =
    (loadStatus === 'ready' || loadStatus === 'denied') &&
    localeStatus !== 'needsPick';

  if (allReady) {
    return (
      <MapPreloadProvider value={preloadData}>
        {children}
      </MapPreloadProvider>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.emoji}>🚽</Text>
      <Text style={styles.title}>Ploop</Text>

      <View style={styles.languageSection}>
        {localeStatus === 'needsPick' ? (
          <>
            <Text style={styles.languagePrompt}>{t('chooseLanguage')}</Text>
            <View style={styles.languageButtons}>
              <Pressable
                style={({ pressed }) => [styles.langButton, pressed && styles.langButtonPressed]}
                onPress={() => setLocale('en')}
              >
                <Text style={styles.langButtonText}>English</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.langButton, pressed && styles.langButtonPressed]}
                onPress={() => setLocale('zh')}
              >
                <Text style={styles.langButtonText}>中文</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <View style={styles.languageButtons}>
            <Pressable
              style={({ pressed }) => [
                styles.langToggle,
                locale === 'en' && styles.langToggleActive,
                pressed && styles.langTogglePressed,
              ]}
              onPress={() => setLocale('en')}
            >
              <Text style={styles.langToggleText}>English</Text>
            </Pressable>
            <Text style={styles.langDivider}>|</Text>
            <Pressable
              style={({ pressed }) => [
                styles.langToggle,
                locale === 'zh' && styles.langToggleActive,
                pressed && styles.langTogglePressed,
              ]}
              onPress={() => setLocale('zh')}
            >
              <Text style={styles.langToggleText}>中文</Text>
            </Pressable>
          </View>
        )}
      </View>

      {loadStatus === 'loading' ? (
        <>
          <View style={styles.barTrack}>
            <View style={[styles.barFill, { width: `${loadProgress}%` }]} />
          </View>
          <Text style={styles.percent}>{loadProgress}%</Text>
          <Text style={styles.message}>
            {loadAttempts > 1
              ? t('connectingAttempt').replace('{n}', String(loadAttempts))
              : t('betterThanYouThink')}
          </Text>
          <Text style={styles.hint}>
            {loadProgress >= 45 ? t('fetchingToilets') : t('loadingLocation')}
          </Text>
        </>
      ) : loadStatus === 'failed' ? (
        <>
          <Text style={styles.message}>{t('couldNotReachPloop')}</Text>
          <Text style={styles.hint}>{t('serverMayBeStarting')}</Text>
          <Pressable
            style={({ pressed }) => [styles.retryButton, pressed && styles.retryButtonPressed]}
            onPress={runFullLoad}
          >
            <Text style={styles.retryButtonText}>{t('retry')}</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text style={styles.message}>{t('loadingLocation')}</Text>
          <Text style={styles.hint}>{tagline}</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    padding: 24,
  },
  emoji: {
    fontSize: 48,
    marginBottom: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#333',
    marginBottom: 24,
  },
  languageSection: {
    marginBottom: 24,
    alignItems: 'center',
  },
  languagePrompt: {
    fontSize: 16,
    color: '#555',
    marginBottom: 12,
  },
  languageButtons: {
    flexDirection: 'row',
    gap: 16,
  },
  langButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    backgroundColor: '#2196F3',
    borderRadius: 12,
    minWidth: 100,
    alignItems: 'center',
  },
  langButtonPressed: {
    opacity: 0.85,
  },
  langButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  langToggle: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  langToggleActive: {
    backgroundColor: '#e0e7ff',
  },
  langTogglePressed: {
    opacity: 0.8,
  },
  langToggleText: {
    fontSize: 14,
    color: '#333',
  },
  langDivider: {
    fontSize: 14,
    color: '#94a3b8',
    marginHorizontal: 4,
  },
  message: {
    fontSize: 16,
    color: '#555',
    textAlign: 'center',
    marginBottom: 8,
  },
  barTrack: {
    width: 220,
    height: 8,
    backgroundColor: '#e2e8f0',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 8,
  },
  barFill: {
    height: '100%',
    backgroundColor: '#2196F3',
    borderRadius: 4,
  },
  percent: {
    fontSize: 14,
    color: '#888',
    marginBottom: 12,
  },
  hint: {
    fontSize: 14,
    color: '#888',
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 24,
    paddingVertical: 12,
    paddingHorizontal: 24,
    backgroundColor: '#2196F3',
    borderRadius: 8,
  },
  retryButtonPressed: {
    opacity: 0.8,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
