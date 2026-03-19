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
