/**
 * Blocks the app until backend is reachable AND location + toilets are loaded.
 * Shows language picker inline when user hasn't chosen yet (choose while loading).
 * MapScreen consumes preloaded data via MapPreloadContext to skip its own loading.
 */
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import * as Location from 'expo-location';
import { api, type Toilet } from '../services/api';
import { searchNearbyToilets as searchGaodeToilets } from '../services/gaodePoi';
import { useLanguage } from '../context/LanguageContext';
import { useMapProvider } from '../context/MapProviderContext';
import { MapPreloadProvider, type MapPreloadData } from '../context/MapPreloadContext';
import { getOxymoronicTagline } from '../utils/engagement';

const HEALTH_TIMEOUT_MS = 8000;
const PROGRESS_INTERVAL_MS = 150;
const PROGRESS_CAP = 95;
const LOCATION_TIMEOUT_MS = 6000;

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

export function AppLoadingGate({ children }: { children: React.ReactNode }) {
  const { t, locale, localeStatus, setLocale } = useLanguage();
  const { provider: mapProvider, simulateChinaLocation, BEIJING_COORDS } = useMapProvider();
  const [tagline] = useState(() => getOxymoronicTagline());
  const [backendStatus, setBackendStatus] = useState<'checking' | 'ready' | 'failed'>('checking');
  const [backendAttempts, setBackendAttempts] = useState(0);
  const [backendProgress, setBackendProgress] = useState(0);
  const backendStartRef = useRef<number>(0);
  const [preloadData, setPreloadData] = useState<MapPreloadData | null>(null);
  const [locationStatus, setLocationStatus] = useState<'pending' | 'loading' | 'ready' | 'denied'>('pending');

  const runHealthCheck = useCallback(async () => {
    setBackendStatus('checking');
    setBackendAttempts((a) => a + 1);
    setBackendProgress(0);
    backendStartRef.current = Date.now();
    const ok = await api.checkHealth(HEALTH_TIMEOUT_MS);
    if (ok) {
      setBackendProgress(100);
      setBackendStatus('ready');
    } else {
      setBackendStatus('failed');
    }
  }, []);

  useEffect(() => {
    runHealthCheck();
  }, [runHealthCheck]);

  useEffect(() => {
    if (backendStatus !== 'checking') return;
    const interval = setInterval(() => {
      const elapsed = Date.now() - backendStartRef.current;
      const pct = Math.min(PROGRESS_CAP, Math.round((elapsed / HEALTH_TIMEOUT_MS) * PROGRESS_CAP));
      setBackendProgress(pct);
    }, PROGRESS_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [backendStatus]);

  useEffect(() => {
    if (backendStatus !== 'ready') return;

    let cancelled = false;
    (async () => {
      if (simulateChinaLocation) {
        setLocationStatus('loading');
        try {
          const coords = BEIJING_COORDS;
          const mergeWithGaode = mapProvider === 'amap';
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
          const backendToilets = backendRes?.toilets ?? [];
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
          const toilets = mergeWithGaode ? mergeAndSort(backendToilets, gaodeToilets) : backendToilets;
          if (!cancelled) {
            setPreloadData({
              location: { coords } as Location.LocationObject,
              toilets,
            });
            setLocationStatus('ready');
          }
        } catch {
          if (!cancelled) {
            setPreloadData({
              location: { coords: BEIJING_COORDS } as Location.LocationObject,
              toilets: [],
            });
            setLocationStatus('ready');
          }
        }
        return;
      }

      setLocationStatus('loading');
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;
        if (status !== 'granted') {
          setLocationStatus('denied');
          setPreloadData(null);
          return;
        }

        let coords: { latitude: number; longitude: number } | null = null;
        try {
          const lastKnown = await Location.getLastKnownPositionAsync({});
          if (lastKnown?.coords) {
            coords = {
              latitude: lastKnown.coords.latitude,
              longitude: lastKnown.coords.longitude,
            };
          }
        } catch {
          // ignore
        }
        if (!coords) {
          const pos = await Promise.race([
            Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('timeout')), LOCATION_TIMEOUT_MS)
            ),
          ]);
          if (pos?.coords) {
            coords = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
          }
        }

        if (cancelled || !coords) {
          setLocationStatus('denied');
          setPreloadData(null);
          return;
        }

        const mergeWithGaode = mapProvider === 'amap';
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
        const backendToilets = backendRes?.toilets ?? [];
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
                Math.round(metersBetween(coords!, { latitude: t.latitude, longitude: t.longitude })),
            }))
            .sort((a, b) => (a.distance ?? 999999) - (b.distance ?? 999999));
        };
        const toilets = mergeWithGaode ? mergeAndSort(backendToilets, gaodeToilets) : backendToilets;

        if (!cancelled) {
          setPreloadData({
            location: { coords } as Location.LocationObject,
            toilets,
          });
          setLocationStatus('ready');
        }
      } catch {
        if (!cancelled) {
          setLocationStatus('denied');
          setPreloadData(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [backendStatus, simulateChinaLocation, BEIJING_COORDS, mapProvider]);

  const allReady =
    backendStatus === 'ready' &&
    (locationStatus === 'ready' || locationStatus === 'denied') &&
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

      {backendStatus === 'checking' ? (
        <>
          <Text style={styles.message}>
            {backendAttempts > 1
              ? t('connectingAttempt').replace('{n}', String(backendAttempts))
              : t('betterThanYouThink')}
          </Text>
          <View style={styles.barTrack}>
            <View style={[styles.barFill, { width: `${backendProgress}%` }]} />
          </View>
          <Text style={styles.percent}>{backendProgress}%</Text>
          {locationStatus === 'loading' && (
            <Text style={styles.hint}>{t('loadingLocation')}</Text>
          )}
          {locationStatus === 'pending' && backendStatus === 'checking' && (
            <Text style={styles.hint}>{tagline}</Text>
          )}
        </>
      ) : backendStatus === 'failed' ? (
        <>
          <Text style={styles.message}>{t('couldNotReachPloop')}</Text>
          <Text style={styles.hint}>{t('serverMayBeStarting')}</Text>
          <Pressable
            style={({ pressed }) => [styles.retryButton, pressed && styles.retryButtonPressed]}
            onPress={runHealthCheck}
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
