/**
 * City configurations for global toilet import.
 *
 * Each entry defines the Overpass API bounding box (south, west, north, east),
 * a Numbeo-derived safety index, the resulting base review score, and which
 * supplementary data sources to pull from.
 */

export interface CityConfig {
  name: string;
  /** Overpass bbox: [south, west, north, east] */
  bbox: [number, number, number, number];
  safetyIndex: number;
  baseScore: number;
  sources: Array<'osm' | 'refuge' | 'toiletmap_uk'>;
}

/**
 * Safety → base review score (integer, DB columns are int).
 * Bumped +0.5 then rounded per user request:
 *   75+  → 4
 *   60-75 → 3
 *   45-60 → 3
 *   30-45 → 2
 */
function safetyToBaseScore(safety: number): number {
  if (safety >= 75) return 4;
  if (safety >= 60) return 3;
  if (safety >= 45) return 3;
  return 2;
}

function city(
  name: string,
  bbox: [number, number, number, number],
  safetyIndex: number,
  sources: CityConfig['sources'] = ['osm'],
): CityConfig {
  return { name, bbox, safetyIndex, baseScore: safetyToBaseScore(safetyIndex), sources };
}

export const CITY_CONFIGS: CityConfig[] = [
  // Asia-Pacific
  city('Singapore',      [1.22, 103.60, 1.47, 104.05],    77.4),
  city('Tokyo',          [35.52, 139.55, 35.82, 139.92],   75.2),
  city('Seoul',          [37.43, 126.80, 37.70, 127.18],   75.4),
  city('Hong Kong',      [22.15, 113.83, 22.56, 114.35],   78.5),
  city('Bangkok',        [13.60, 100.35, 13.95, 100.70],   61.4),
  city('Dubai',          [25.00, 55.05, 25.35, 55.40],     83.9),
  city('Kuala Lumpur',   [2.99, 101.55, 3.24, 101.80],     39.8),
  city('Jakarta',        [-6.38, 106.68, -6.08, 106.98],   47.1),
  city('Sydney',         [-33.95, 151.05, -33.75, 151.35], 65.8),

  // China mainland
  city('Shanghai',       [30.95, 121.20, 31.50, 121.80],   65.2),
  city('Beijing',        [39.75, 116.15, 40.20, 116.65],   62.4),
  city('Guangzhou',      [22.95, 113.05, 23.40, 113.60],   60.1),
  city('Shenzhen',       [22.40, 113.75, 22.75, 114.35],   62.8),
  city('Chengdu',        [30.45, 103.90, 30.80, 104.35],   65.0),
  city('Hangzhou',       [30.10, 120.00, 30.50, 120.40],   68.3),
  city('Wuhan',          [30.40, 114.10, 30.80, 114.60],   60.5),
  city('Nanjing',        [31.85, 118.65, 32.25, 119.05],   64.7),
  city('Xi\'an',         [34.15, 108.75, 34.60, 109.20],   62.1),
  city('Chongqing',      [29.40, 106.30, 29.80, 106.80],   60.3),

  // North America
  city('New York',       [40.49, -74.26, 40.92, -73.70],  49.0, ['osm', 'refuge']),
  city('Los Angeles',    [33.70, -118.67, 34.34, -118.15], 46.1, ['osm', 'refuge']),
  city('San Francisco',  [37.70, -122.52, 37.83, -122.35], 39.1, ['osm', 'refuge']),
  city('Dallas',         [32.60, -97.00, 33.05, -96.50],   45.0, ['osm', 'refuge']),
  city('Chicago',        [41.64, -87.84, 42.02, -87.52],  33.9, ['osm', 'refuge']),

  // Europe
  city('London',         [51.28, -0.51, 51.69, 0.33],     44.7, ['osm', 'toiletmap_uk']),
  city('Paris',          [48.81, 2.22, 48.90, 2.47],      41.9),
  city('Berlin',         [52.34, 13.09, 52.68, 13.76],    55.4),
  city('Amsterdam',      [52.29, 4.73, 52.43, 5.02],      73.8),
];
