/**
 * Live toilet data for the design screens.
 * Replaces the mock TOILETS array with Ploop API calls.
 */
import * as Location from 'expo-location';
import { api } from '../../src/services/api';

const DEFAULT_RADIUS_M = 100_000;
const DEFAULT_LIMIT = 500;

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
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') {
    throw new Error('Location permission is required to load nearby toilets.');
  }
  const position = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
  };
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

  return toilets.map(mapToiletForDesign);
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
