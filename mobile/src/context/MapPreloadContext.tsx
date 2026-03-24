/**
 * Holds preloaded location and toilets from AppLoadingGate.
 * MapScreen consumes this to skip its initial loading when data is ready.
 */
import React, { createContext, useContext } from 'react';
import type { Toilet } from '../services/api';
import type * as Location from 'expo-location';

export interface MapPreloadData {
  location: Location.LocationObject;
  toilets: Toilet[];
  /** When true, coords are a fallback (e.g. default); MapScreen will refetch when real location arrives */
  preliminary?: boolean;
  /**
   * When true, gate showed the map before toilets loaded; MapScreen should fetch pins (e.g. useFocusEffect).
   * When false/undefined and toilets.length > 0, data came from the gate in one shot (legacy / future use).
   */
  toiletsDeferred?: boolean;
}

const MapPreloadContext = createContext<MapPreloadData | null>(null);

export function MapPreloadProvider({
  value,
  children,
}: {
  value: MapPreloadData | null;
  children: React.ReactNode;
}) {
  return (
    <MapPreloadContext.Provider value={value}>
      {children}
    </MapPreloadContext.Provider>
  );
}

export function useMapPreload() {
  return useContext(MapPreloadContext);
}
