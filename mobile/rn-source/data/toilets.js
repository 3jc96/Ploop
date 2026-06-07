/**
 * Live toilet data for the design screens.
 * Replaces the mock TOILETS array with Ploop API calls.
 */
import * as Location from 'expo-location';
import { api } from '../../src/services/api';

// Backend (/api/toilets) caps radius at 10 km and limit at 100.
const DEFAULT_RADIUS_M = 10_000;
const DEFAULT_LIMIT = 100;

function toNumber(value) {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : null;
}

/** Map a backend Toilet row into the shape design screens expect. */
export function mapToiletForDesign(toilet) {
  const cleanliness = toNumber(toilet.cleanliness_score);
  const smell = toNumber(toilet.smell_score);
  const rating =
    cleanliness != null && smell != null
      ? Math.round(((cleanliness + smell) / 2) * 10) / 10
      : cleanliness ?? smell ?? null;

  return {
    id: toilet.id,
    name: toilet.name,
    address: toilet.address ?? '',
    latitude: toilet.latitude,
    longitude: toilet.longitude,
    lat: toilet.latitude,
    lng: toilet.longitude,
    rating,
    cleanliness_score: cleanliness,
    smell_score: smell,
    total_reviews: toilet.total_reviews ?? 0,
    distance: toilet.distance ?? null,
    wheelchair_accessible: !!toilet.wheelchair_accessible,
    pay_to_enter: !!toilet.pay_to_enter,
    has_toilet_paper: !!toilet.has_toilet_paper,
    has_hand_soap: !!toilet.has_hand_soap,
    has_bidet: !!toilet.has_bidet,
    confidence_score: toilet.confidence_score ?? null,
    last_serviced_at: toilet.last_serviced_at ?? null,
    photos: toilet.photos ?? [],
    raw: toilet,
  };
}

async function getCurrentCoords() {
  // Reuse permission already granted by the map; only prompt if undetermined.
  let granted = false;
  try {
    const current = await Location.getForegroundPermissionsAsync();
    granted = current.status === 'granted';
    if (!granted && current.canAskAgain !== false) {
      const requested = await Location.requestForegroundPermissionsAsync();
      granted = requested.status === 'granted';
    }
  } catch {
    granted = false;
  }
  if (!granted) {
    throw new Error('Location permission is required to load nearby toilets.');
  }

  // Fast path: last known position (instant, same as the map screen).
  try {
    const last = await Location.getLastKnownPositionAsync();
    if (last?.coords) {
      return { latitude: last.coords.latitude, longitude: last.coords.longitude };
    }
  } catch {
    // fall through to a fresh fix
  }

  // Fallback: fresh fix (slower). Lowest accuracy keeps it quick.
  const position = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Low,
  });
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
  };
}

/**
 * Collapse toilets that represent the same physical place. The API can return
 * several near-identical rows for one location (re-imports, duplicate submits),
 * which shows up as repeated entries in the Nearby list.
 */
function dedupeToilets(list) {
  const isBetter = (candidate, current) => {
    const cReviews = candidate.total_reviews ?? 0;
    const curReviews = current.total_reviews ?? 0;
    if (cReviews !== curReviews) return cReviews > curReviews;
    const cConf = candidate.confidence_score ?? 0;
    const curConf = current.confidence_score ?? 0;
    if (cConf !== curConf) return cConf > curConf;
    const cDist = candidate.distance ?? Infinity;
    const curDist = current.distance ?? Infinity;
    return cDist < curDist;
  };

  const locationKey = (t) => {
    const name = String(t.name ?? '').trim().toLowerCase();
    const address = String(t.address ?? '').trim().toLowerCase();
    if (name || address) return `na:${name}|${address}`;
    // Fall back to coordinates rounded to ~11 m so the same spot collapses.
    const lat = t.latitude != null ? Number(t.latitude).toFixed(4) : '?';
    const lng = t.longitude != null ? Number(t.longitude).toFixed(4) : '?';
    return `geo:${lat},${lng}`;
  };

  const byId = new Map();
  for (const t of list) {
    if (t.id == null) continue;
    if (!byId.has(t.id)) byId.set(t.id, t);
  }

  const byLocation = new Map();
  for (const t of byId.values()) {
    const key = locationKey(t);
    const existing = byLocation.get(key);
    if (!existing || isBetter(t, existing)) byLocation.set(key, t);
  }

  return Array.from(byLocation.values());
}

/**
 * Fetch nearby toilets from the Ploop API.
 * @param {{ latitude?: number, longitude?: number, radius?: number, limit?: number }} [params]
 */
export async function fetchNearbyToilets(params = {}) {
  const coords =
    params.latitude != null && params.longitude != null
      ? { latitude: params.latitude, longitude: params.longitude }
      : await getCurrentCoords();

  const { toilets } = await api.getNearbyToilets({
    latitude: coords.latitude,
    longitude: coords.longitude,
    radius: params.radius ?? DEFAULT_RADIUS_M,
    limit: params.limit ?? DEFAULT_LIMIT,
    wheelchair_accessible: params.wheelchair_accessible,
    free_only: params.free_only,
    min_confidence: params.min_confidence,
    has_bidet: params.has_bidet,
  });

  return dedupeToilets(toilets.map(mapToiletForDesign));
}

/** Fetch a single toilet by id. */
export async function fetchToiletById(id) {
  const toilet = await api.getToilet(id);
  return mapToiletForDesign(toilet);
}

/** Super Toilet of the Day for the user's region. */
export async function fetchSuperToiletOfTheDay(params = {}) {
  const result = await api.getSuperToiletOfTheDay(params);
  if (!result?.toilet) return null;
  return {
    region: result.region,
    date: result.date,
    toilet: mapToiletForDesign(result.toilet),
  };
}

/**
 * @deprecated Design mock export — use fetchNearbyToilets() instead.
 * Kept so imports do not break while screens migrate off static data.
 */
export const TOILETS = [];
