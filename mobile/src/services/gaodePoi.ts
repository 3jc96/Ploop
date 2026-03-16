/**
 * Gaode (高德) POI search – fetches nearby public toilets in China.
 * Uses the Web Service API: https://restapi.amap.com/v3/place/around
 *
 * Requires a Gaode Web Service key (enable "Web服务" in Gaode console).
 * Can use the same key as the map SDK if Web Service is enabled.
 */
import Constants from 'expo-constants';
import type { Toilet } from './api';

const GAODE_AROUND_URL = 'https://restapi.amap.com/v3/place/around';

export interface GaodePoiResult {
  id: string;
  name: string;
  address?: string;
  location: string; // "lng,lat"
  distance?: string; // meters
  type?: string;
}

/** Keywords indicating quality venues (hotels, malls) – toilets here get default 4–5 star scores */
const QUALITY_VENUE_KEYWORDS = [
  '酒店', '宾馆', '饭店', '度假村', '国际酒店', '五星', '四星', '星级',
  '商城', '商场', '购物中心', '购物广场', '百货', '大厦', '写字楼',
  '希尔顿', '万豪', '香格里拉', '洲际', '凯悦', '喜来登', '万达', '恒隆',
];

function isQualityVenue(poi: GaodePoiResult): boolean {
  const text = `${poi.name || ''} ${poi.type || ''} ${poi.address || ''}`;
  return QUALITY_VENUE_KEYWORDS.some((kw) => text.includes(kw));
}

function getGaodeWebKey(): string | null {
  const key =
    (typeof process !== 'undefined' && (process as any).env?.EXPO_PUBLIC_GAODE_WEB_KEY) ||
    (Constants.expoConfig?.extra as Record<string, unknown>)?.gaodeWebKey ||
    null;
  return typeof key === 'string' && key.length > 0 ? key : null;
}

/**
 * Convert Gaode POI to Ploop Toilet format.
 * Quality venues (hotels, malls) get default 4–5 star scores; others use placeholder values.
 */
function toToilet(poi: GaodePoiResult, center: { latitude: number; longitude: number }): Toilet {
  const [lng, lat] = poi.location.split(',').map(Number);
  const distanceM = poi.distance ? parseInt(poi.distance, 10) : undefined;
  const quality = isQualityVenue(poi);
  const cleanliness_score = quality ? 4.5 : null;
  const smell_score = quality ? 4.5 : null;
  const total_reviews = quality ? 1 : 0;
  return {
    id: `gaode_${poi.id}`,
    name: poi.name || '公厕',
    address: poi.address,
    latitude: lat,
    longitude: lng,
    distance: distanceM,
    cleanliness_score,
    smell_score,
    total_reviews,
    has_toilet_paper: quality,
    has_hand_soap: quality,
    has_bidet: false,
    has_seat_warmer: false,
    number_of_stalls: 0,
    toilet_type: 'both',
    pay_to_enter: false,
    wheelchair_accessible: false,
  };
}

export interface SearchNearbyToiletsParams {
  latitude: number;
  longitude: number;
  radius?: number; // meters, max 50000
  limit?: number; // max ~200 (25 per page * 8 pages)
}

/**
 * Fetch nearby public toilets from Gaode POI.
 * Returns empty array if key is missing or request fails.
 */
export async function searchNearbyToilets(params: SearchNearbyToiletsParams): Promise<Toilet[]> {
  const key = getGaodeWebKey();
  if (!key) return [];

  const { latitude, longitude, radius = 5000, limit = 100 } = params;
  const location = `${longitude},${latitude}`;

  const allPois: GaodePoiResult[] = [];
  const offset = 25;
  let page = 1;

  try {
    while (allPois.length < limit) {
      const url = new URL(GAODE_AROUND_URL);
      url.searchParams.set('key', key);
      url.searchParams.set('location', location);
      url.searchParams.set('keywords', '公厕');
      url.searchParams.set('radius', String(Math.min(radius, 50000)));
      url.searchParams.set('sortrule', 'distance');
      url.searchParams.set('offset', String(offset));
      url.searchParams.set('page', String(page));

      const res = await fetch(url.toString(), { method: 'GET' });
      const data = await res.json();

      if (data.status !== '1') {
        if (page === 1) console.warn('[Gaode POI]', data.info || data.message || 'Request failed');
        break;
      }

      const pois = Array.isArray(data.pois) ? data.pois : [];
      if (pois.length === 0) break;

      for (const p of pois) {
        if (p.id && p.name && p.location) {
          allPois.push({
            id: p.id,
            name: p.name,
            address: p.address,
            location: p.location,
            distance: p.distance,
            type: p.type,
          });
        }
      }

      if (pois.length < offset) break;
      page++;
      if (page > 8) break; // Gaode max ~200 results
    }

    return allPois.slice(0, limit).map((p) => toToilet(p, { latitude, longitude }));
  } catch (e) {
    console.warn('[Gaode POI]', e);
    return [];
  }
}

/**
 * Check if a toilet is from Gaode POI (not in Ploop backend).
 */
export function isGaodeToilet(toilet: Toilet): boolean {
  return toilet.id.startsWith('gaode_');
}
