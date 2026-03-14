/**
 * Tracks last-viewed toilet for "You're here" and post-use prompts.
 * Set when user opens toilet details; Map screens use it to show contextual prompts.
 */
import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

export type LastViewedToilet = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
};

type YouAreHereContextValue = {
  lastViewedToilet: LastViewedToilet | null;
  setLastViewedToilet: (t: LastViewedToilet | null) => void;
  dismissedYouAreHere: Set<string>;
  dismissedPostUse: Set<string>;
  dismissYouAreHere: (toiletId: string) => void;
  dismissPostUse: (toiletId: string) => void;
};

const YouAreHereContext = createContext<YouAreHereContextValue | null>(null);

export function YouAreHereProvider({ children }: { children: React.ReactNode }) {
  const [lastViewedToilet, setLastViewedToiletState] = useState<LastViewedToilet | null>(null);
  const [dismissedYouAreHere, setDismissedYouAreHere] = useState<Set<string>>(new Set());
  const [dismissedPostUse, setDismissedPostUse] = useState<Set<string>>(new Set());

  const setLastViewedToilet = useCallback((t: LastViewedToilet | null) => {
    setLastViewedToiletState(t);
  }, []);

  const dismissYouAreHere = useCallback((toiletId: string) => {
    setDismissedYouAreHere((prev) => new Set(prev).add(toiletId));
  }, []);

  const dismissPostUse = useCallback((toiletId: string) => {
    setDismissedPostUse((prev) => new Set(prev).add(toiletId));
  }, []);

  const value = useMemo<YouAreHereContextValue>(
    () => ({
      lastViewedToilet,
      setLastViewedToilet,
      dismissedYouAreHere,
      dismissedPostUse,
      dismissYouAreHere,
      dismissPostUse,
    }),
    [lastViewedToilet, dismissedYouAreHere, dismissedPostUse, setLastViewedToilet, dismissYouAreHere, dismissPostUse]
  );

  return (
    <YouAreHereContext.Provider value={value}>
      {children}
    </YouAreHereContext.Provider>
  );
}

export function useYouAreHere(): YouAreHereContextValue | null {
  return useContext(YouAreHereContext);
}

/** Haversine distance in meters */
export function distanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
