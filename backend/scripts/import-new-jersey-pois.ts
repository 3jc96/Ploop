#!/usr/bin/env npx ts-node
/**
 * Import New Jersey toilets from OpenStreetMap for restaurants, malls, and hotels.
 *
 * Baseline review scores (cleanliness = smell):
 *   - Restaurants, malls, hotels (default) → 3/5
 *   - 5-star hotels (OSM stars ≥ 4.5, or rounded to 5) → 4/5
 *
 * Usage:
 *   DATABASE_URL=postgres://... npx ts-node scripts/import-new-jersey-pois.ts
 *   DRY_RUN=1 npx ts-node scripts/import-new-jersey-pois.ts
 *   SKIP_SEED_REVIEWS=1 npx ts-node scripts/import-new-jersey-pois.ts
 *
 * Limits (Overpass rate limits): IMPORT_NJ_MAX_RESTAURANTS (default 600),
 *   IMPORT_NJ_MAX_MALLS (200), IMPORT_NJ_MAX_HOTELS (400)
 */

import path from 'path';
import dotenv from 'dotenv';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';

dotenv.config({ path: path.join(__dirname, '../.env') });

const DATABASE_URL = process.env.DATABASE_URL;
const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
const SKIP_SEED_REVIEWS = process.env.SKIP_SEED_REVIEWS === '1' || process.env.SKIP_SEED_REVIEWS === 'true';

const MAX_RESTAURANTS = Math.max(50, parseInt(process.env.IMPORT_NJ_MAX_RESTAURANTS || '600', 10));
const MAX_MALLS = Math.max(20, parseInt(process.env.IMPORT_NJ_MAX_MALLS || '200', 10));
const MAX_HOTELS = Math.max(20, parseInt(process.env.IMPORT_NJ_MAX_HOTELS || '400', 10));

const CITY = 'New Jersey';

/** Regional bboxes (south, west, north, east) — whole-state queries often fail on Overpass */
const NJ_REGIONS: Array<{ name: string; bbox: [number, number, number, number] }> = [
  { name: 'North NJ', bbox: [40.45, -74.85, 41.36, -73.89] },
  { name: 'Central NJ', bbox: [39.85, -75.35, 40.45, -74.15] },
  { name: 'South NJ', bbox: [38.93, -75.59, 39.85, -74.35] },
];

/** Way/relation queries often 406 on public Overpass; nodes-only is reliable. */
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

const BASE_SCORE = 3;
const FIVE_STAR_HOTEL_SCORE = 4;

const REVIEW_NOTE_BASE =
  'Imported from OpenStreetMap (New Jersey). Baseline 3/5 cleanliness and smell — not from live visitor reviews.';

interface ToiletRecord {
  id: string;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  has_toilet_paper: boolean;
  has_hand_soap: boolean;
  has_bidet: boolean;
  wheelchair_accessible: boolean;
  pay_to_enter: boolean;
  toilet_type: 'sit' | 'squat' | 'both';
  number_of_stalls: number;
  cleanliness_score: number;
  smell_score: number;
  created_by: string;
  city: string;
  review_note: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function overpassQuery(query: string, retries = 5): Promise<any[]> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(OVERPASS_URL, {
        method: 'POST',
        body: query.replace(/\s+/g, ' ').trim(),
        headers: {
          'Content-Type': 'text/plain',
          Accept: '*/*',
          'User-Agent': 'Ploop-NJ-Importer/1.0',
        },
        signal: AbortSignal.timeout(120_000),
      });
      const text = await res.text();
      if (res.status === 429) {
        const waitMs = 15_000 * (attempt + 1);
        console.warn(`  Overpass rate limit (429), waiting ${waitMs / 1000}s…`);
        await sleep(waitMs);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
      const json = JSON.parse(text) as { elements?: any[] };
      return json.elements || [];
    } catch (e: any) {
      if (attempt < retries - 1) {
        console.warn(`  Overpass attempt ${attempt + 1} failed: ${e?.message}`);
        await sleep(10_000 * (attempt + 1));
      } else {
        throw e;
      }
    }
  }
  throw new Error('Overpass API: all retries failed.');
}

function coordsOf(el: any): { lat: number; lon: number } | null {
  if (el.type === 'node') return { lat: el.lat, lon: el.lon };
  if (el.center) return { lat: el.center.lat, lon: el.center.lon };
  return null;
}

function hotelScores(tags: Record<string, string>): { clean: number; smell: number; note: string } {
  const starsRaw = parseFloat(tags.stars || '');
  const isFiveStar = !Number.isNaN(starsRaw) && (starsRaw >= 4.5 || Math.round(starsRaw) >= 5);
  if (isFiveStar) {
    return {
      clean: FIVE_STAR_HOTEL_SCORE,
      smell: FIVE_STAR_HOTEL_SCORE,
      note: `Imported from OpenStreetMap (5-star hotel, stars=${tags.stars}). Baseline 4/5 cleanliness and smell — not from live visitor reviews.`,
    };
  }
  const starSuffix = tags.stars ? ` (stars=${tags.stars})` : '';
  return {
    clean: BASE_SCORE,
    smell: BASE_SCORE,
    note: `Imported from OpenStreetMap (hotel${starSuffix}). Baseline 3/5 cleanliness and smell — not from live visitor reviews.`,
  };
}

type NewToiletFields = Omit<
  ToiletRecord,
  'id' | 'city' | 'has_toilet_paper' | 'has_hand_soap' | 'toilet_type' | 'pay_to_enter'
> & { pay_to_enter?: boolean };

function baseRecord(partial: NewToiletFields): ToiletRecord {
  const { pay_to_enter = false, ...rest } = partial;
  return {
    id: uuidv4(),
    city: CITY,
    has_toilet_paper: true,
    has_hand_soap: true,
    pay_to_enter,
    toilet_type: 'sit',
    ...rest,
  };
}

async function fetchMalls(): Promise<ToiletRecord[]> {
  console.log('Fetching New Jersey malls from OSM…');
  const records: ToiletRecord[] = [];
  const seen = new Set<string>();

  for (const region of NJ_REGIONS) {
    const [minLat, minLon, maxLat, maxLon] = region.bbox;
    console.log(`  ${region.name}…`);
    const elements = await overpassQuery(`
      [out:json][timeout:90];
      node["shop"="mall"]["name"](${minLat},${minLon},${maxLat},${maxLon});
      out body;
    `);
    await sleep(5000);

    for (const el of elements) {
      const coords = coordsOf(el);
      if (!coords) continue;
      const tags = el.tags || {};
      const name = tags.name || tags['name:en'];
      if (!name) continue;
      const key = `${coords.lat.toFixed(4)},${coords.lon.toFixed(4)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      records.push(
        baseRecord({
          name: `${name} - Public Restroom`,
        address: tags['addr:full'] || tags['addr:street'] || null,
        latitude: coords.lat,
        longitude: coords.lon,
        has_bidet: false,
        wheelchair_accessible: tags.wheelchair !== 'no',
        number_of_stalls: 10,
        cleanliness_score: BASE_SCORE,
        smell_score: BASE_SCORE,
        created_by: 'import_nj_malls',
        review_note:
          'Imported from OpenStreetMap (mall). Baseline 3/5 cleanliness and smell — not from live visitor reviews.',
      })
    );
  }
  }

  const capped = records.slice(0, MAX_MALLS);
  console.log(`  Found ${records.length} mall(s), importing up to ${MAX_MALLS} → ${capped.length}.`);
  return capped;
}

async function fetchHotels(): Promise<ToiletRecord[]> {
  console.log('Fetching New Jersey hotels from OSM…');
  const records: ToiletRecord[] = [];
  const seen = new Set<string>();

  for (const region of NJ_REGIONS) {
    const [minLat, minLon, maxLat, maxLon] = region.bbox;
    console.log(`  ${region.name}…`);
    const elements = await overpassQuery(`
      [out:json][timeout:90];
      node["tourism"="hotel"]["name"](${minLat},${minLon},${maxLat},${maxLon});
      out body;
    `);
    await sleep(5000);

  for (const el of elements) {
    const coords = coordsOf(el);
    if (!coords) continue;
    const tags = el.tags || {};
    const name = tags.name || tags['name:en'];
    if (!name) continue;
    const key = `${coords.lat.toFixed(4)},${coords.lon.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const scores = hotelScores(tags);
    const starsRaw = parseFloat(tags.stars || '');
    const isFiveStar = !Number.isNaN(starsRaw) && (starsRaw >= 4.5 || Math.round(starsRaw) >= 5);
    records.push(
      baseRecord({
        name: `${name} - Guest Restroom`,
        address: tags['addr:full'] || tags['addr:street'] || null,
        latitude: coords.lat,
        longitude: coords.lon,
        has_bidet: isFiveStar,
        wheelchair_accessible: tags.wheelchair !== 'no',
        number_of_stalls: isFiveStar ? 8 : 4,
        cleanliness_score: scores.clean,
        smell_score: scores.smell,
        created_by: 'import_nj_hotels',
        review_note: scores.note,
      })
    );
  }
  }

  const capped = records.slice(0, MAX_HOTELS);
  console.log(`  Found ${records.length} hotel(s), importing up to ${MAX_HOTELS} → ${capped.length}.`);
  return capped;
}

async function fetchRestaurants(): Promise<ToiletRecord[]> {
  console.log('Fetching New Jersey restaurants from OSM…');
  const records: ToiletRecord[] = [];
  const seen = new Set<string>();

  for (const region of NJ_REGIONS) {
    const [minLat, minLon, maxLat, maxLon] = region.bbox;
    console.log(`  ${region.name}…`);
    const elements = await overpassQuery(`
      [out:json][timeout:120];
      node["amenity"="restaurant"]["name"](${minLat},${minLon},${maxLat},${maxLon});
      out body;
    `);
    await sleep(5000);

  for (const el of elements) {
    const coords = coordsOf(el);
    if (!coords) continue;
    const tags = el.tags || {};
    const name = tags.name || tags['name:en'];
    if (!name) continue;
    const key = `${coords.lat.toFixed(4)},${coords.lon.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    records.push(
      baseRecord({
        name: `${name} - Customer Restroom`,
        address:
          tags['addr:full'] ||
          tags['addr:street'] ||
          (tags['addr:housenumber'] && tags['addr:street']
            ? `${tags['addr:housenumber']} ${tags['addr:street']}`
            : null),
        latitude: coords.lat,
        longitude: coords.lon,
        has_bidet: false,
        wheelchair_accessible: tags.wheelchair !== 'no',
        number_of_stalls: 4,
        cleanliness_score: BASE_SCORE,
        smell_score: BASE_SCORE,
        created_by: 'import_nj_restaurants',
        review_note: REVIEW_NOTE_BASE,
        pay_to_enter: true,
      })
    );
  }
  }

  records.sort((a, b) => a.name.localeCompare(b.name));
  const capped = records.slice(0, MAX_RESTAURANTS);
  console.log(
    `  Found ${records.length} restaurant(s), importing up to ${MAX_RESTAURANTS} → ${capped.length}.`
  );
  return capped;
}

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

async function insertToilets(pool: Pool, toilets: ToiletRecord[]): Promise<{ imported: number; skipped: number }> {
  let imported = 0;
  let skipped = 0;

  for (const t of toilets) {
    try {
      const normalizedName = t.name.toLowerCase().trim().replace(/\s+/g, ' ');
      const res = await pool.query(
        `INSERT INTO toilets (
          id, name, address, latitude, longitude, location,
          has_toilet_paper, has_hand_soap, has_bidet,
          wheelchair_accessible, pay_to_enter,
          toilet_type, number_of_stalls,
          cleanliness_score, smell_score,
          normalized_name, created_by, city
        )
        SELECT $1,$2,$3,$4,$5,ST_SetSRID(ST_MakePoint($5,$4),4326)::geography,
          $6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17
        WHERE NOT EXISTS (
          SELECT 1 FROM toilets
          WHERE ABS(latitude  - $4::double precision) < 0.0002
            AND ABS(longitude - $5::double precision) < 0.0002
        )`,
        [
          t.id,
          t.name,
          t.address,
          t.latitude,
          t.longitude,
          t.has_toilet_paper,
          t.has_hand_soap,
          t.has_bidet,
          t.wheelchair_accessible,
          t.pay_to_enter,
          t.toilet_type,
          t.number_of_stalls,
          t.cleanliness_score,
          t.smell_score,
          normalizedName,
          t.created_by,
          t.city,
        ]
      );
      if (res.rowCount && res.rowCount > 0) {
        imported++;
        if (!SKIP_SEED_REVIEWS) {
          try {
            await pool.query(
              `INSERT INTO toilet_reviews (id, toilet_id, cleanliness_score, smell_score, review_text, reviewed_by)
               VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)`,
              [t.id, t.cleanliness_score, t.smell_score, t.review_note, t.created_by]
            );
            await pool.query(
              `UPDATE toilets SET total_reviews = (SELECT COUNT(*)::int FROM toilet_reviews WHERE toilet_id = $1) WHERE id = $1`,
              [t.id]
            );
          } catch (re) {
            console.warn(`  Seed review skipped for ${t.name}:`, (re as Error)?.message);
          }
        }
      } else {
        skipped++;
      }
    } catch (e: any) {
      if (e?.code === '23505') skipped++;
      else {
        console.warn(`  Error inserting ${t.name}:`, e?.message);
        skipped++;
      }
    }
  }
  return { imported, skipped };
}

async function main(): Promise<void> {
  if (!DATABASE_URL && !process.env.DB_HOST && !DRY_RUN) {
    console.error(
      'Usage: DATABASE_URL=postgres://... npx ts-node scripts/import-new-jersey-pois.ts (or set DB_HOST/DB_NAME/DB_USER)'
    );
    process.exit(1);
  }

  console.log('\n=== New Jersey venue import ===');
  console.log('Scores: restaurants/malls/hotels → 3/5; 5-star hotels → 4/5\n');

  const malls = await fetchMalls();
  await sleep(4000);
  const hotels = await fetchHotels();
  await sleep(4000);
  const restaurants = await fetchRestaurants();

  const fiveStarHotels = hotels.filter((h) => h.cleanliness_score === FIVE_STAR_HOTEL_SCORE).length;
  const all = [...malls, ...hotels, ...restaurants];
  console.log(
    `\nTotal: ${all.length} (malls=${malls.length}, hotels=${hotels.length} [${fiveStarHotels} at 4/5], restaurants=${restaurants.length})`
  );

  if (DRY_RUN) {
    console.log('\nDRY_RUN — sample records:');
    const sample = [...hotels.filter((h) => h.cleanliness_score === 4).slice(0, 2), ...malls.slice(0, 1), ...restaurants.slice(0, 2)];
    console.log(JSON.stringify(sample, null, 2));
    return;
  }

  const pool = createPool();

  const { imported, skipped } = await insertToilets(pool, all);
  const coverage = await pool.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM toilets WHERE is_active = true AND city = $1`,
    [CITY]
  );
  console.log(`\nDone. Imported: ${imported}, Skipped (duplicates/errors): ${skipped}`);
  console.log(`Active toilets in ${CITY}: ${coverage.rows[0]?.total ?? '0'}`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
