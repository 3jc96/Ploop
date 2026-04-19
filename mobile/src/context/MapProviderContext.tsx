/**
 * Map provider context – Google Maps by default; prompts user to switch to Gaode
 * (Amap) when their location is detected inside China mainland.
 *
 * The prompt is shown once and the answer is persisted in AsyncStorage.
 * Provider remains Google until the user explicitly accepts the switch.
 */
import React, { createContext, useCallback, useContext, useMemo, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

/** Amap requires a development build; Expo Go does not include native modules. */
export const isAmapUnavailable = () => Constants.appOwnership === 'expo';

const SIMULATE_CHINA_KEY = 'settings.simulateChinaLocation';
/** 'amap' | 'google' | unset — persisted so the prompt is only shown once */
const CHINA_PREF_KEY = 'settings.chinaMapsPreference';

export type MapProviderType = 'google' | 'amap';
type ChinaPref = 'amap' | 'google' | null; // null = not yet decided

/** Beijing (Tiananmen area) – for dev location spoofing */
export const BEIJING_COORDS = { latitude: 39.9042, longitude: 116.4074 };

/** China mainland bounding box (approximate) – WGS84 */
const CHINA_BBOX = { minLat: 18.2, maxLat: 53.6, minLon: 73.4, maxLon: 135.1 };

export function isInChina(lat: number, lon: number): boolean {
  return (
    lat >= CHINA_BBOX.minLat &&
    lat <= CHINA_BBOX.maxLat &&
    lon >= CHINA_BBOX.minLon &&
    lon <= CHINA_BBOX.maxLon
  );
}

interface MapProviderContextValue {
  provider: MapProviderType;
  isInChina: boolean;
  /** True when the user is in China and hasn't yet been asked which map to use */
  showChinaMapPrompt: boolean;
  /** Call with true to switch to Gaode, false to stay on Google. Saves preference. */
  respondToChinaPrompt: (useAmap: boolean) => void;
  simulateChinaLocation: boolean;
  setSimulateChinaLocation: (v: boolean) => void;
  BEIJING_COORDS: { latitude: number; longitude: number };
  /** Called by AppLoadingGate after it resolves the user's location, so the China check fires even on first launch */
  notifyLocation: (lat: number, lon: number) => void;
}

const MapProviderContext = createContext<MapProviderContextValue | null>(null);

export function MapProvider({ children }: { children: React.ReactNode }) {
  const [userCoords, setUserCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [simulateChinaLocation, setSimulateChinaLocationState] = useState(false);
  const [chinaPref, setChinaPref] = useState<ChinaPref>(null);
  /** true once we know the pref has been loaded from storage (avoids premature prompt) */
  const [prefLoaded, setPrefLoaded] = useState(false);

  // Load persisted settings once
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [simulate, pref] = await Promise.all([
          AsyncStorage.getItem(SIMULATE_CHINA_KEY),
          AsyncStorage.getItem(CHINA_PREF_KEY),
        ]);
        if (cancelled) return;
        if (simulate === 'true') setSimulateChinaLocationState(true);
        if (pref === 'amap' || pref === 'google') setChinaPref(pref);
      } catch {
        // ignore
      } finally {
        if (!cancelled) setPrefLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const setSimulateChinaLocation = useCallback((v: boolean) => {
    setSimulateChinaLocationState(v);
    AsyncStorage.setItem(SIMULATE_CHINA_KEY, v ? 'true' : 'false').catch(() => {});
  }, []);

  const notifyLocation = useCallback((lat: number, lon: number) => {
    setUserCoords({ latitude: lat, longitude: lon });
  }, []);

  // Fetch location once to decide if we're in China
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { default: Location } = await import('expo-location');
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== 'granted' || cancelled) return;
        const loc = await Location.getCurrentPositionAsync({});
        if (!cancelled) {
          setUserCoords({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
        }
      } catch {
        // ignore – defaults to Google
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const effectiveCoords = simulateChinaLocation ? BEIJING_COORDS : userCoords;
  const userIsInChina = effectiveCoords
    ? isInChina(effectiveCoords.latitude, effectiveCoords.longitude)
    : false;

  // Show the prompt when: location confirmed in China + Amap is available + no saved preference yet
  const showChinaMapPrompt =
    prefLoaded && userIsInChina && !isAmapUnavailable() && chinaPref === null;

  const respondToChinaPrompt = useCallback((useAmap: boolean) => {
    const pref: ChinaPref = useAmap ? 'amap' : 'google';
    setChinaPref(pref);
    AsyncStorage.setItem(CHINA_PREF_KEY, pref).catch(() => {});
  }, []);

  const provider = useMemo((): MapProviderType => {
    if (isAmapUnavailable()) return 'google';
    if (chinaPref === 'amap') return 'amap';
    // simulateChinaLocation in dev always uses Amap (override for testing)
    if (simulateChinaLocation) return 'amap';
    return 'google';
  }, [chinaPref, simulateChinaLocation]);

  const value = useMemo<MapProviderContextValue>(
    () => ({
      provider,
      isInChina: userIsInChina,
      showChinaMapPrompt,
      respondToChinaPrompt,
      simulateChinaLocation,
      setSimulateChinaLocation,
      BEIJING_COORDS,
      notifyLocation,
    }),
    [provider, userIsInChina, showChinaMapPrompt, respondToChinaPrompt, simulateChinaLocation, setSimulateChinaLocation, notifyLocation],
  );

  return <MapProviderContext.Provider value={value}>{children}</MapProviderContext.Provider>;
}

export function useMapProvider(): MapProviderContextValue {
  const ctx = useContext(MapProviderContext);
  if (!ctx) {
    return {
      provider: 'google',
      isInChina: false,
      showChinaMapPrompt: false,
      respondToChinaPrompt: () => {},
      simulateChinaLocation: false,
      setSimulateChinaLocation: () => {},
      BEIJING_COORDS: { latitude: 39.9042, longitude: 116.4074 },
      notifyLocation: () => {},
    };
  }
  return ctx;
}
