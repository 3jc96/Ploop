/**
 * Map provider context – Google Maps first, Gaode (Amap) as fallback in China.
 * Uses Google Maps everywhere; falls back to Amap only when in China mainland
 * (where Google may be blocked). Falls back to Google when Amap unavailable (e.g. Expo Go).
 */
import React, { createContext, useCallback, useContext, useMemo, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

/** Amap requires a development build; Expo Go does not include native modules. */
export const isAmapUnavailable = () => Constants.appOwnership === 'expo';

const SIMULATE_CHINA_KEY = 'settings.simulateChinaLocation';

export type MapProviderType = 'google' | 'amap';

/** Beijing (Tiananmen area) – for dev location spoofing to test Gaode in China */
export const BEIJING_COORDS = { latitude: 39.9042, longitude: 116.4074 };

/** China mainland bounding box (approximate) – WGS84 */
const CHINA_BBOX = {
  minLat: 18.2,
  maxLat: 53.6,
  minLon: 73.4,
  maxLon: 135.1,
};

export function isInChina(lat: number, lon: number): boolean {
  return lat >= CHINA_BBOX.minLat && lat <= CHINA_BBOX.maxLat && lon >= CHINA_BBOX.minLon && lon <= CHINA_BBOX.maxLon;
}

interface MapProviderContextValue {
  provider: MapProviderType;
  isInChina: boolean;
  /** Dev only: spoof location to Beijing for testing Gaode POI in China */
  simulateChinaLocation: boolean;
  setSimulateChinaLocation: (v: boolean) => void;
  BEIJING_COORDS: { latitude: number; longitude: number };
}

const MapProviderContext = createContext<MapProviderContextValue | null>(null);

export function MapProvider({ children }: { children: React.ReactNode }) {
  const [userCoords, setUserCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [simulateChinaLocation, setSimulateChinaLocationState] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(SIMULATE_CHINA_KEY);
        if (!cancelled && stored === 'true') setSimulateChinaLocationState(true);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setSimulateChinaLocation = useCallback((v: boolean) => {
    setSimulateChinaLocationState(v);
    AsyncStorage.setItem(SIMULATE_CHINA_KEY, v ? 'true' : 'false').catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { default: Location } = await import('expo-location');
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== 'granted' || cancelled) return;
        const loc = await Location.getCurrentPositionAsync({});
        if (!cancelled) {
          setUserCoords({
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
          });
        }
      } catch {
        // ignore – will default to Google
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const effectiveCoords = simulateChinaLocation ? BEIJING_COORDS : userCoords;

  // Google first; fall back to Gaode only when in China (where Google may be blocked)
  const provider = useMemo((): MapProviderType => {
    if (!effectiveCoords) return 'google';
    if (isAmapUnavailable()) return 'google';
    return isInChina(effectiveCoords.latitude, effectiveCoords.longitude) ? 'amap' : 'google';
  }, [effectiveCoords]);

  const value = useMemo<MapProviderContextValue>(
    () => ({
      provider,
      isInChina: effectiveCoords ? isInChina(effectiveCoords.latitude, effectiveCoords.longitude) : false,
      simulateChinaLocation,
      setSimulateChinaLocation,
      BEIJING_COORDS,
    }),
    [provider, effectiveCoords, simulateChinaLocation, setSimulateChinaLocation]
  );

  return <MapProviderContext.Provider value={value}>{children}</MapProviderContext.Provider>;
}

export function useMapProvider(): MapProviderContextValue {
  const ctx = useContext(MapProviderContext);
  if (!ctx) {
    return {
      provider: 'google',
      isInChina: false,
      simulateChinaLocation: false,
      setSimulateChinaLocation: () => {},
      BEIJING_COORDS: { latitude: 39.9042, longitude: 116.4074 },
    };
  }
  return ctx;
}
