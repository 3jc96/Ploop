#!/usr/bin/env npx ts-node
/**
 * Rate venue toilets in New York, San Francisco, Dallas, and Los Angeles
 * using OpenStreetMap (Overpass) data.
 *
 * Rating rules (per user spec):
 *   - Max toilet score is 4 (no 5-star ratings)
 *   - Score = OSM stars tag - 1 when available, else amenity-type heuristic
 *   - Cleanliness score === Smell score (always the same)
 *   - Bars, restaurants, cafes → pay_to_enter = true + purchase disclaimer
 *   - Hotels, malls          → pay_to_enter = false
 *
 * Deduplication: ~20 m tolerance.  Existing toilets nearby get a new review
 * (updating their average scores) + notes/pay_to_enter updated; no duplicate
 * row is created.
 *
 * Usage:
 *   DATABASE_URL=postgres://... npx ts-node scripts/import-us-venue-toilets.ts
 *   DRY_RUN=1 npx ts-node scripts/import-us-venue-toilets.ts
 *   CITY=dallas npx ts-node scripts/import-us-venue-toilets.ts
 *   MAX_PER_TYPE=100 npx ts-node scripts/import-us-venue-toilets.ts
 */

import path from 'path';
import dotenv from 'dotenv';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';

dotenv.config({ path: path.join(__dirname, '../.env') });

// ── Config ────────────────────────────────────────────────────────────────────
const DATABASE_URL = process.env.DATABASE_URL;
const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
const CITY_FILTER = (process.env.CITY || '').toLowerCase();
const MAX_PER_TYPE = Math.max(10, parseInt(process.env.MAX_PER_TYPE || '80', 10));

/** ~20 m duplicate-detection tolerance (degrees) */
const NEAR = 0.0002;

const PURCHASE_DISCLAIMER =
  'Note: Restrooms may require a purchase or be for customers only.';

const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

// ── City definitions ──────────────────────────────────────────────────────────
interface CityDef {
  name: string;
  dbCity: string;
  /** [south, west, north, east] */
  bbox: [number, number, number, number];
}

const CITIES: CityDef[] = [
  // North America
  { name: 'New York',      dbCity: 'New York',      bbox: [40.49, -74.26, 40.92, -73.70] },
  { name: 'San Francisco', dbCity: 'San Francisco', bbox: [37.70, -122.52, 37.83, -122.35] },
  { name: 'Dallas',        dbCity: 'Dallas',        bbox: [32.60, -97.00,  33.05, -96.50] },
  { name: 'Los Angeles',   dbCity: 'Los Angeles',   bbox: [33.70, -118.67, 34.34, -118.15] },
  // China mainland
  { name: 'Shanghai',      dbCity: 'Shanghai',      bbox: [30.95, 121.20, 31.50, 121.80] },
  { name: 'Beijing',       dbCity: 'Beijing',       bbox: [39.75, 116.15, 40.20, 116.65] },
  { name: 'Guangzhou',     dbCity: 'Guangzhou',     bbox: [22.95, 113.05, 23.40, 113.60] },
  { name: 'Shenzhen',      dbCity: 'Shenzhen',      bbox: [22.40, 113.75, 22.75, 114.35] },
  { name: 'Chengdu',       dbCity: 'Chengdu',       bbox: [30.45, 103.90, 30.80, 104.35] },
  { name: 'Hangzhou',      dbCity: 'Hangzhou',      bbox: [30.10, 120.00, 30.50, 120.40] },
  { name: 'Wuhan',         dbCity: 'Wuhan',         bbox: [30.40, 114.10, 30.80, 114.60] },
  { name: 'Nanjing',       dbCity: 'Nanjing',       bbox: [31.85, 118.65, 32.25, 119.05] },
  { name: "Xi'an",         dbCity: "Xi'an",         bbox: [34.15, 108.75, 34.60, 109.20] },
  { name: 'Chongqing',     dbCity: 'Chongqing',     bbox: [29.40, 106.30, 29.80, 106.80] },
];

// ── Venue categories ─────────────────────────────────────────────────────────
type VenueCategory = 'restaurant' | 'bar' | 'cafe' | 'hotel' | 'mall';

interface OsmVenue {
  name: string;
  lat: number;
  lng: number;
  category: VenueCategory;
  tags: Record<string, string>;
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Derive toilet score from an OSM venue.
 *
 * Priority:
 *   1. OSM `stars` tag → stars - 1, capped 1-4
 *   2. OSM `rating` tag (0-10 scale) → (rating/10 * 5) - 1, capped 1-4
 *   3. Amenity-type heuristic (same as import-dallas-pois.ts)
 *
 * Rules: max = 4 (no 5-star toilet ratings), min = 1, cleanliness === smell.
 */
function venueScore(venue: OsmVenue): number {
  const { tags } = venue;

  // OSM stars (e.g. "4", "4.5", "3")
  const starsRaw = parseFloat(tags.stars || '');
  if (!isNaN(starsRaw) && starsRaw >= 1) {
    return clamp(Math.round(starsRaw) - 1, 1, 4);
  }

  // OSM rating on 0-10 scale (less common)
  const ratingRaw = parseFloat(tags.rating || '');
  if (!isNaN(ratingRaw) && ratingRaw > 0) {
    const fiveStar = (ratingRaw / 10) * 5;
    return clamp(Math.round(fiveStar) - 1, 1, 4);
  }

  // Amenity-type heuristic
  const cuisine = tags.cuisine || '';
  const smoking = tags.smoking || '';

  let score: number;
  switch (venue.category) {
    case 'hotel':
      score = 3; // generic hotel without star tag
      break;
    case 'mall':
      score = 3;
      break;
    case 'restaurant':
      // Fine-dining cuisines tend to have better restrooms
      if (['fine_dining', 'french', 'japanese', 'sushi'].includes(cuisine)) {
        score = 4;
      } else {
        score = 3;
      }
      break;
    case 'cafe':
      score = 3;
      break;
    case 'bar':
      score = 2;
      break;
    default:
      score = 2;
  }

  // Smoking indoors lowers smell score (but since cleanliness===smell we clamp after)
  if (['yes', 'inside', 'dedicated'].includes(smoking)) {
    score = clamp(score - 1, 1, 4);
  }

  return clamp(score, 1, 4);
}

function requiresPurchase(category: VenueCategory): boolean {
  return category === 'restaurant' || category === 'bar' || category === 'cafe';
}

function defaultStalls(category: VenueCategory): number {
  switch (category) {
    case 'mall':       return 12;
    case 'hotel':      return 6;
    case 'restaurant': return 4;
    case 'cafe':       return 2;
    case 'bar':        return 3;
    default:           return 3;
  }
}

// ── Overpass fetching ─────────────────────────────────────────────────────────
async function overpassQuery(query: string): Promise<any[]> {
  const maxRetries = 4;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const url = OVERPASS_URLS[attempt % OVERPASS_URLS.length];
    try {
      const res = await fetch(url, {
        method: 'POST',
        body: query,
        headers: { 'Content-Type': 'text/plain' },
        signal: AbortSignal.timeout(90_000),
      });
      if (res.status === 429) {
        const wait = 10_000 * (attempt + 1);
        console.warn(`  [OSM] Rate limit, waiting ${wait / 1000}s…`);
        await sleep(wait);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as { elements?: any[] };
      return json.elements || [];
    } catch (e: any) {
      if (attempt < maxRetries - 1) {
        console.warn(`  [OSM] Attempt ${attempt + 1} failed: ${e?.message}. Retrying…`);
        await sleep(8_000 * (attempt + 1));
      } else {
        console.warn(`  [OSM] All retries failed: ${e?.message}`);
      }
    }
  }
  return [];
}

function coordsOf(el: any): { lat: number; lng: number } | null {
  if (el.type === 'node') return { lat: el.lat, lng: el.lon };
  if (el.center) return { lat: el.center.lat, lng: el.center.lon };
  return null;
}

async function fetchVenues(city: CityDef, category: VenueCategory): Promise<OsmVenue[]> {
  const [s, w, n, e] = city.bbox;

  let osmFilters: string;
  switch (category) {
    case 'restaurant':
      osmFilters = `
        node["amenity"="restaurant"]["name"](${s},${w},${n},${e});
        way["amenity"="restaurant"]["name"](${s},${w},${n},${e});
        node["amenity"="fast_food"]["name"](${s},${w},${n},${e});
        way["amenity"="fast_food"]["name"](${s},${w},${n},${e});
        node["amenity"="food_court"]["name"](${s},${w},${n},${e});
        way["amenity"="food_court"]["name"](${s},${w},${n},${e});`;
      break;
    case 'bar':
      osmFilters = `
        node["amenity"="bar"]["name"](${s},${w},${n},${e});
        way["amenity"="bar"]["name"](${s},${w},${n},${e});
        node["amenity"="pub"]["name"](${s},${w},${n},${e});
        way["amenity"="pub"]["name"](${s},${w},${n},${e});
        node["amenity"="nightclub"]["name"](${s},${w},${n},${e});
        way["amenity"="nightclub"]["name"](${s},${w},${n},${e});`;
      break;
    case 'cafe':
      osmFilters = `
        node["amenity"="cafe"]["name"](${s},${w},${n},${e});
        way["amenity"="cafe"]["name"](${s},${w},${n},${e});
        node["amenity"="coffee_shop"]["name"](${s},${w},${n},${e});
        way["amenity"="coffee_shop"]["name"](${s},${w},${n},${e});`;
      break;
    case 'hotel':
      osmFilters = `
        node["tourism"="hotel"]["name"](${s},${w},${n},${e});
        way["tourism"="hotel"]["name"](${s},${w},${n},${e});
        node["tourism"="motel"]["name"](${s},${w},${n},${e});
        way["tourism"="motel"]["name"](${s},${w},${n},${e});`;
      break;
    case 'mall':
      osmFilters = `
        node["shop"="mall"]["name"](${s},${w},${n},${e});
        way["shop"="mall"]["name"](${s},${w},${n},${e});
        relation["shop"="mall"]["name"](${s},${w},${n},${e});
        node["shop"="department_store"]["name"](${s},${w},${n},${e});
        way["shop"="department_store"]["name"](${s},${w},${n},${e});`;
      break;
  }

  const query = `[out:json][timeout:90];\n(\n${osmFilters}\n);\nout center body;`;
  const elements = await overpassQuery(query);

  const venues: OsmVenue[] = [];
  for (const el of elements) {
    const coords = coordsOf(el);
    if (!coords) continue;
    const tags = el.tags || {};
    const name = tags.name || tags['name:en'] || '';
    if (!name) continue;
    venues.push({ name, lat: coords.lat, lng: coords.lng, category, tags });
  }

  // Cap to MAX_PER_TYPE (sort by name so output is deterministic)
  venues.sort((a, b) => a.name.localeCompare(b.name));
  return venues.slice(0, MAX_PER_TYPE);
}

// ── Database helpers ──────────────────────────────────────────────────────────
function createPool(): Pool {
  if (DATABASE_URL) {
    return new Pool({
      connectionString: DATABASE_URL,
      ssl: DATABASE_URL.includes('render.com') ? { rejectUnauthorized: false } : undefined,
    });
  }
  return new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'ploop',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
  });
}

/** Ensure columns added after the initial schema exist (idempotent). */
async function ensureColumns(pool: Pool): Promise<void> {
  await pool.query(`
    DO $$
    BEGIN
      IF to_regclass('public.toilets') IS NOT NULL THEN
        ALTER TABLE toilets ADD COLUMN IF NOT EXISTS notes text;
        ALTER TABLE toilets ADD COLUMN IF NOT EXISTS google_place_id text;
        ALTER TABLE toilets ADD COLUMN IF NOT EXISTS city text;
        CREATE INDEX IF NOT EXISTS idx_toilets_google_place_id ON toilets (google_place_id);
        CREATE INDEX IF NOT EXISTS idx_toilets_city ON toilets (city) WHERE city IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_toilets_active ON toilets (is_active) WHERE is_active = true;
      END IF;
    END $$;
  `);
  console.log('  [DB] Schema verified.');
}

async function verifyCityCoverage(pool: Pool, dbCity: string): Promise<void> {
  const res = await pool.query<{ total: string; avg_clean: string; avg_smell: string }>(
    `SELECT COUNT(*) AS total,
            ROUND(AVG(cleanliness_score)::numeric, 2) AS avg_clean,
            ROUND(AVG(smell_score)::numeric, 2) AS avg_smell
     FROM toilets WHERE is_active = true AND city = $1`,
    [dbCity],
  );
  const r = res.rows[0];
  console.log(
    `  [Coverage] ${dbCity}: ${r.total} active toilets | avg cleanliness=${r.avg_clean} smell=${r.avg_smell}`,
  );
}

async function upsertVenueToilet(
  pool: Pool,
  venue: OsmVenue,
  dbCity: string,
  reviewedThisRun: Set<string>,
): Promise<'inserted' | 'updated' | 'skipped'> {
  const score = venueScore(venue);
  const purchase = requiresPurchase(venue.category);
  const notes = purchase ? PURCHASE_DISCLAIMER : null;

  const starLabel = venue.tags.stars ? ` (OSM stars=${venue.tags.stars})` : '';
  const reviewText = [
    `Venue: ${venue.name} [${venue.category}]${starLabel}.`,
    `Toilet score ${score}/4 — derived from venue type/OSM stars (no 5-star ratings; cleanliness=smell).`,
    notes,
    `Imported by import_us_venue_toilets.`,
  ]
    .filter(Boolean)
    .join(' ');

  // ── Duplicate check (~20 m) ──────────────────────────────────────────────
  const existing = await pool.query<{ id: string }>(
    `SELECT id FROM toilets
     WHERE is_active = true
       AND ABS(latitude  - $1::double precision) < $3
       AND ABS(longitude - $2::double precision) < $4
     ORDER BY ABS(latitude - $1::double precision) + ABS(longitude - $2::double precision)
     LIMIT 1`,
    [venue.lat, venue.lng, NEAR, NEAR],
  );

  if (existing.rows.length > 0) {
    const toiletId = existing.rows[0].id;

    // Update notes + pay_to_enter on the existing record
    await pool.query(
      `UPDATE toilets
       SET notes        = COALESCE($2, notes),
           pay_to_enter = CASE WHEN $3 THEN true ELSE pay_to_enter END,
           city         = COALESCE(city, $4),
           updated_at   = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [toiletId, notes, purchase, dbCity],
    );

    // One review per toilet per script run to update score averages
    if (!reviewedThisRun.has(toiletId)) {
      await pool.query(
        `INSERT INTO toilet_reviews
           (id, toilet_id, cleanliness_score, smell_score, review_text, reviewed_by)
         VALUES ($1, $2, $3, $4, $5, 'import_us_venue_toilets')`,
        [uuidv4(), toiletId, score, score, reviewText],
      );
      reviewedThisRun.add(toiletId);
    }
    return 'updated';
  }

  // ── Insert new toilet ────────────────────────────────────────────────────
  const newId = uuidv4();
  const toiletName = `${venue.name} - Restroom`;
  const normalizedName = toiletName.toLowerCase().trim().replace(/\s+/g, ' ');
  const stalls = defaultStalls(venue.category);
  const hasBidet = score >= 4; // only top-rated venues presumed to have bidet
  const addr =
    venue.tags['addr:full'] ||
    (venue.tags['addr:housenumber'] && venue.tags['addr:street']
      ? `${venue.tags['addr:housenumber']} ${venue.tags['addr:street']}`
      : null) ||
    venue.tags['addr:street'] ||
    dbCity;

  await pool.query(
    `INSERT INTO toilets (
       id, name, address, latitude, longitude, location,
       has_toilet_paper, has_hand_soap, has_bidet, has_seat_warmer,
       wheelchair_accessible, pay_to_enter,
       toilet_type, number_of_stalls,
       cleanliness_score, smell_score,
       normalized_name, created_by, city, notes
     )
     VALUES (
       $1, $2, $3, $4, $5, ST_SetSRID(ST_MakePoint($5, $4), 4326)::geography,
       true, true, $6, false,
       true, $7,
       'sit', $8,
       $9, $10,
       $11, 'import_us_venue_toilets', $12, $13
     )`,
    [
      newId,
      toiletName,
      addr,
      venue.lat,
      venue.lng,
      hasBidet,
      purchase,
      stalls,
      score,
      score,
      normalizedName,
      dbCity,
      notes,
    ],
  );

  // Seed review (triggers score recalculation)
  await pool.query(
    `INSERT INTO toilet_reviews
       (id, toilet_id, cleanliness_score, smell_score, review_text, reviewed_by)
     VALUES ($1, $2, $3, $4, $5, 'import_us_venue_toilets')`,
    [uuidv4(), newId, score, score, reviewText],
  );

  reviewedThisRun.add(newId);
  return 'inserted';
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const cities = CITY_FILTER
    ? CITIES.filter((c) => c.name.toLowerCase().includes(CITY_FILTER))
    : CITIES;

  if (cities.length === 0) {
    console.error(
      `No city matched "${CITY_FILTER}". Available: ${CITIES.map((c) => c.name).join(', ')}`,
    );
    process.exit(1);
  }

  console.log(
    `\n=== US Venue Toilet Import${DRY_RUN ? ' (DRY RUN)' : ''} — ${cities.length} cit${cities.length === 1 ? 'y' : 'ies'} ===`,
  );
  console.log('Rating: venue score = OSM stars - 1 (max 4, min 1). Cleanliness = Smell.\n');

  const pool = DRY_RUN ? (null as unknown as Pool) : createPool();
  const reviewedThisRun = new Set<string>();

  if (!DRY_RUN) {
    await ensureColumns(pool);
  }

  let totalInserted = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;

  const CATEGORIES: VenueCategory[] = ['restaurant', 'bar', 'cafe', 'hotel', 'mall'];

  for (const city of cities) {
    console.log(`\n--- ${city.name} ---`);

    if (!DRY_RUN) {
      await verifyCityCoverage(pool, city.dbCity);
    }

    for (const category of CATEGORIES) {
      console.log(`  Fetching ${category}s…`);
      const venues = await fetchVenues(city, category);
      const purchase = requiresPurchase(category);
      console.log(
        `    ${venues.length} venues (pay_to_enter=${purchase}, disclaimer=${purchase})`,
      );

      if (DRY_RUN) {
        venues.slice(0, 3).forEach((v) => {
          const s = venueScore(v);
          const star = v.tags.stars ? ` [OSM ★${v.tags.stars}]` : '';
          console.log(
            `    [DRY] ${v.name}${star} → score ${s}/4${purchase ? ' + disclaimer' : ''}`,
          );
        });
        totalInserted += venues.length;
        await sleep(1000);
        continue;
      }

      for (const venue of venues) {
        try {
          const result = await upsertVenueToilet(pool, venue, city.dbCity, reviewedThisRun);
          if (result === 'inserted') totalInserted++;
          else if (result === 'updated') totalUpdated++;
          else totalSkipped++;
        } catch (e: any) {
          console.warn(`    Error: ${venue.name} — ${e?.message}`);
          totalSkipped++;
        }
      }

      await sleep(3000); // Overpass rate-limit pause between category queries
    }

    if (!DRY_RUN) {
      console.log('  [Post-import]');
      await verifyCityCoverage(pool, city.dbCity);
    }
  }

  if (!DRY_RUN && pool) await pool.end();

  console.log(
    `\nDone. Inserted: ${totalInserted} | Updated: ${totalUpdated} | Skipped/errors: ${totalSkipped}\n`,
  );
  console.log('Score mapping (OSM stars → toilet score):');
  [5, 4, 3, 2].forEach((s) => console.log(`  OSM ★${s} → ${clamp(s - 1, 1, 4)}/4`));
  console.log('  (no OSM stars) → heuristic by amenity type (restaurant=3, bar=2, hotel=3, mall=3)');
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
