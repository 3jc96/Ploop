#!/usr/bin/env npx ts-node
/**
 * Global toilet importer — pulls public toilet data from OpenStreetMap,
 * Refuge Restrooms, and Toilet Map UK for 17 major cities, then rates them
 * based on proximity to 4/5-star hotels and malls (Google Places API) or
 * a city-level safety index fallback.
 *
 * Usage:
 *   npx ts-node scripts/import-global-toilets.ts                  # all cities
 *   npx ts-node scripts/import-global-toilets.ts --city=tokyo     # one city
 *   npx ts-node scripts/import-global-toilets.ts --dry-run        # preview only
 *   npx ts-node scripts/import-global-toilets.ts --skip-places    # skip Google Places (use base score only)
 *
 * Env:
 *   DATABASE_URL or DB_HOST/DB_NAME/DB_USER/DB_PASSWORD
 *   GOOGLE_PLACES_API_KEY (for hotel/mall lookup)
 */
import path from 'path';
import axios, { AxiosError } from 'axios';
import dotenv from 'dotenv';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { CITY_CONFIGS, CityConfig } from './city-configs';

dotenv.config({ path: path.join(__dirname, '../.env') });

// ── CLI flags ──────────────────────────────────────────────────────────────
const DRY_RUN = process.argv.includes('--dry-run');
const SKIP_PLACES = process.argv.includes('--skip-places');
const CITY_FLAG = process.argv.find((a) => a.startsWith('--city='))?.split('=')[1]?.toLowerCase();

const GOOGLE_KEY = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '';

const NEAR_LAT = 0.0002; // ~20 m duplicate detection tolerance
const NEAR_LNG = 0.0002;
const HOTEL_MALL_RADIUS_DEG = 0.001; // ~100 m for hotel/mall proximity check

// ── Types ──────────────────────────────────────────────────────────────────
interface RawToilet {
  lat: number;
  lng: number;
  name: string;
  wheelchair: boolean | null;
  fee: boolean | null;
  hasBidet: boolean | null;
  openingHours: string | null;
  source: string;
  city: string;
}

interface POI {
  lat: number;
  lng: number;
  name: string;
  type: '5star' | '4star' | 'mall';
}

interface RatedToilet extends RawToilet {
  cleanlinessScore: number;
  smellScore: number;
  nearbyPOI: string | null;
}

// ── Database ───────────────────────────────────────────────────────────────
function createImportPool(): Pool {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    return new Pool({
      connectionString: databaseUrl,
      ssl: databaseUrl.includes('render.com') ? { rejectUnauthorized: false } : undefined,
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

// ── Utilities ──────────────────────────────────────────────────────────────
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function degDistance(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  return Math.abs(a.lat - b.lat) + Math.abs(a.lng - b.lng);
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 1 — Fetch toilets
// ═══════════════════════════════════════════════════════════════════════════

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

async function queryOverpass(query: string): Promise<any> {
  const maxRetries = 4;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const endpoint = OVERPASS_ENDPOINTS[attempt % OVERPASS_ENDPOINTS.length];
    try {
      const res = await axios.post(
        endpoint,
        `data=${encodeURIComponent(query)}`,
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 150_000 },
      );
      return res.data;
    } catch (e: any) {
      const status = e?.response?.status;
      console.warn(`  [OSM] Attempt ${attempt + 1}/${maxRetries} failed (${status || e?.code}) on ${endpoint}`);
      if (attempt < maxRetries - 1) {
        const delay = (attempt + 1) * 15_000;
        console.log(`  [OSM] Waiting ${delay / 1000}s before retry…`);
        await sleep(delay);
      }
    }
  }
  return null;
}

async function fetchOsmToilets(cfg: CityConfig): Promise<RawToilet[]> {
  const [south, west, north, east] = cfg.bbox;
  const query = `
    [out:json][timeout:90];
    (
      node["amenity"="toilets"](${south},${west},${north},${east});
      way["amenity"="toilets"](${south},${west},${north},${east});
      relation["amenity"="toilets"](${south},${west},${north},${east});
    );
    out center;
  `;

  console.log(`  [OSM] Querying toilets for ${cfg.name}…`);
  const data = await queryOverpass(query);
  if (!data) {
    console.warn(`  [OSM] All retries failed for ${cfg.name}, skipping OSM data.`);
    return [];
  }

  const elements: any[] = data?.elements || [];
  const toilets: RawToilet[] = [];

  for (const el of elements) {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (lat == null || lng == null) continue;

    const tags = el.tags || {};
    const bidetTag = tags['toilets:bidet'];

    toilets.push({
      lat,
      lng,
      name: tags.name || tags['name:en'] || '',
      wheelchair: tags.wheelchair === 'yes' ? true : tags.wheelchair === 'no' ? false : null,
      fee: tags.fee === 'yes' ? true : tags.fee === 'no' ? false : null,
      hasBidet: bidetTag === 'yes' ? true : bidetTag === 'no' ? false : null,
      openingHours: tags.opening_hours || null,
      source: 'osm_import',
      city: cfg.name,
    });
  }

  console.log(`  [OSM] ${cfg.name}: ${toilets.length} toilets`);
  return toilets;
}

async function fetchRefugeToilets(cfg: CityConfig): Promise<RawToilet[]> {
  const centerLat = (cfg.bbox[0] + cfg.bbox[2]) / 2;
  const centerLng = (cfg.bbox[1] + cfg.bbox[3]) / 2;
  const toilets: RawToilet[] = [];
  let page = 1;
  const perPage = 100;

  console.log(`  [Refuge] Querying toilets near ${cfg.name}…`);

  while (page <= 10) {
    try {
      const res = await axios.get('https://www.refugerestrooms.org/api/v1/restrooms/by_location', {
        params: { lat: centerLat, lng: centerLng, per_page: perPage, page },
        timeout: 30_000,
      });
      const data: any[] = res.data || [];
      if (data.length === 0) break;

      for (const r of data) {
        if (r.latitude == null || r.longitude == null) continue;
        const lat = parseFloat(r.latitude);
        const lng = parseFloat(r.longitude);
        if (isNaN(lat) || isNaN(lng)) continue;
        // Only keep if within city bbox
        if (lat < cfg.bbox[0] || lat > cfg.bbox[2] || lng < cfg.bbox[1] || lng > cfg.bbox[3]) continue;

        toilets.push({
          lat,
          lng,
          name: r.name || '',
          wheelchair: r.accessible === true ? true : null,
          fee: null,
          hasBidet: null,
          openingHours: null,
          source: 'refuge_import',
          city: cfg.name,
        });
      }

      if (data.length < perPage) break;
      page++;
      await sleep(500);
    } catch (e: any) {
      console.warn(`  [Refuge] Page ${page} failed for ${cfg.name}: ${e?.message}`);
      break;
    }
  }

  console.log(`  [Refuge] ${cfg.name}: ${toilets.length} toilets`);
  return toilets;
}

async function fetchToiletMapUK(cfg: CityConfig): Promise<RawToilet[]> {
  // The Toilet Map UK API is GraphQL at https://www.toiletmap.org.uk/api
  // REST endpoints /api/toilets and /api/toilets.json no longer exist.
  const GQL_ENDPOINT = 'https://www.toiletmap.org.uk/api';
  const PAGE_SIZE = 100; // API enforces max 100 per page
  const toilets: RawToilet[] = [];
  let page = 1;
  let totalPages = 1;

  // Note: openingTimes is a custom scalar that fails to resolve server-side — excluded intentionally.
  const query = 'query GetLoos($page: Int!, $limit: Int!) { loos(filters: { active: true }, pagination: { page: $page, limit: $limit }) { ... on LooSearchResponse { total pages page loos { id name location { lat lng } accessible noPayment babyChange urinalOnly active } } } }';

  console.log(`  [ToiletMapUK] Querying GraphQL for ${cfg.name}…`);

  while (page <= totalPages) {
    try {
      const res = await axios.post(
        GQL_ENDPOINT,
        { query, variables: { page, limit: PAGE_SIZE } },
        { headers: { 'Content-Type': 'application/json' }, timeout: 60_000 },
      );
      const resp = res.data?.data?.loos;
      if (!resp) {
        console.warn(`  [ToiletMapUK] Unexpected response on page ${page}: ${JSON.stringify(res.data).slice(0, 200)}`);
        break;
      }

      totalPages = resp.pages ?? 1;

      for (const t of resp.loos ?? []) {
        // Data cleaning — skip urinal-only entries (not full sit-down toilets)
        if (t.urinalOnly === true) continue;
        // Skip inactive entries (active filter should catch this, but belt-and-braces)
        if (t.active === false) continue;

        const lat = t.location?.lat;
        const lng = t.location?.lng;
        if (lat == null || lng == null || isNaN(lat) || isNaN(lng)) continue;

        // Filter to city bbox
        if (lat < cfg.bbox[0] || lat > cfg.bbox[2] || lng < cfg.bbox[1] || lng > cfg.bbox[3]) continue;

        // noPayment: true → free (fee=false), false → paid (fee=true), null → unknown (fee=null)
        const fee = t.noPayment === true ? false : t.noPayment === false ? true : null;

        // accessible: treat null as unknown (not false)
        const wheelchair = t.accessible === true ? true : t.accessible === false ? false : null;

        // Sanitise name — strip generic unhelpful names
        let name = (t.name || '').trim();
        const genericNames = /^(public toilet|toilets?|wc|restroom|lavatory)$/i;
        if (genericNames.test(name)) name = '';

        toilets.push({
          lat,
          lng,
          name,
          wheelchair,
          fee,
          hasBidet: null, // ToiletMapUK doesn't track bidets
          openingHours: null, // openingTimes scalar not available via API
          source: 'toiletmap_uk',
          city: cfg.name,
        });
      }

      console.log(`  [ToiletMapUK] Page ${page}/${totalPages} — ${toilets.length} in-bbox so far`);
      page++;
      if (page <= totalPages) await sleep(300);
    } catch (e: any) {
      console.warn(`  [ToiletMapUK] Page ${page} failed: ${e?.message}`);
      break;
    }
  }

  console.log(`  [ToiletMapUK] ${cfg.name}: ${toilets.length} toilets`);
  return toilets;
}

/** Fetch all toilet data for a single city from configured sources. */
async function fetchToiletsForCity(cfg: CityConfig): Promise<RawToilet[]> {
  const all: RawToilet[] = [];

  if (cfg.sources.includes('osm')) {
    all.push(...(await fetchOsmToilets(cfg)));
    await sleep(1000); // Overpass rate limit
  }

  if (cfg.sources.includes('refuge')) {
    all.push(...(await fetchRefugeToilets(cfg)));
  }

  if (cfg.sources.includes('toiletmap_uk')) {
    all.push(...(await fetchToiletMapUK(cfg)));
  }

  // Dedupe by proximity (~20m)
  const unique: RawToilet[] = [];
  for (const t of all) {
    const dup = unique.find(
      (u) => Math.abs(u.lat - t.lat) < NEAR_LAT && Math.abs(u.lng - t.lng) < NEAR_LNG,
    );
    if (!dup) {
      unique.push(t);
    } else if (!dup.name && t.name) {
      dup.name = t.name;
    }
  }

  console.log(`  [Dedup] ${cfg.name}: ${all.length} → ${unique.length} unique toilets`);
  return unique;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 2 — Fetch hotels and malls via Google Places API
// ═══════════════════════════════════════════════════════════════════════════

async function fetchPOIsForCity(cfg: CityConfig): Promise<POI[]> {
  if (!GOOGLE_KEY || SKIP_PLACES) {
    console.log(`  [Places] Skipped for ${cfg.name} (no key or --skip-places)`);
    return [];
  }

  const pois: POI[] = [];
  const queries: Array<{ q: string; type: POI['type'] }> = [
    { q: `5 star hotel in ${cfg.name}`, type: '5star' },
    { q: `4 star hotel in ${cfg.name}`, type: '4star' },
    { q: `shopping mall in ${cfg.name}`, type: 'mall' },
  ];

  for (const { q, type } of queries) {
    try {
      let nextPageToken: string | undefined;
      let pages = 0;

      do {
        const params: Record<string, string> = {
          query: q,
          key: GOOGLE_KEY,
        };
        if (nextPageToken) {
          params.pagetoken = nextPageToken;
          await sleep(2000); // Google requires delay before using pagetoken
        }

        const res = await axios.get('https://maps.googleapis.com/maps/api/place/textsearch/json', {
          params,
          timeout: 30_000,
        });

        const results: any[] = res.data?.results || [];
        for (const r of results) {
          const loc = r.geometry?.location;
          if (!loc) continue;
          pois.push({
            lat: loc.lat,
            lng: loc.lng,
            name: r.name || '',
            type,
          });
        }

        nextPageToken = res.data?.next_page_token;
        pages++;
        await sleep(200);
      } while (nextPageToken && pages < 3);

      console.log(`  [Places] ${cfg.name} "${q}": ${pois.filter((p) => p.type === type).length} results`);
    } catch (e: any) {
      const status = (e as AxiosError)?.response?.status;
      console.warn(`  [Places] Query "${q}" failed (${status}): ${e?.message}`);
    }
  }

  return pois;
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 3 — Rate each toilet
// ═══════════════════════════════════════════════════════════════════════════

function rateToilets(toilets: RawToilet[], pois: POI[], baseScore: number): RatedToilet[] {
  return toilets.map((t) => {
    // Check proximity to 5-star hotels first, then 4-star/mall
    let cleanlinessScore = baseScore;
    let smellScore = baseScore;
    let nearbyPOI: string | null = null;

    for (const poi of pois) {
      const dist = degDistance(t, poi);
      if (dist > HOTEL_MALL_RADIUS_DEG) continue;

      if (poi.type === '5star') {
        cleanlinessScore = 5;
        smellScore = 5;
        nearbyPOI = `5★ ${poi.name}`;
        break;
      } else if (poi.type === '4star' && cleanlinessScore < 4) {
        cleanlinessScore = 4;
        smellScore = 4;
        nearbyPOI = `4★ ${poi.name}`;
      } else if (poi.type === 'mall' && cleanlinessScore < 4) {
        cleanlinessScore = 4;
        smellScore = 4;
        nearbyPOI = `Mall: ${poi.name}`;
      }
    }

    return { ...t, cleanlinessScore, smellScore, nearbyPOI };
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 4 — Database insert / update
// ═══════════════════════════════════════════════════════════════════════════

async function insertToilets(pool: Pool, toilets: RatedToilet[]): Promise<void> {
  let inserted = 0;
  let matched = 0;
  let reviewsAdded = 0;
  let skipped = 0;
  const reviewAddedThisRun = new Set<string>();

  for (const t of toilets) {
    try {
      // Duplicate check
      const existing = await pool.query<{ id: string }>(
        `SELECT id FROM toilets
         WHERE is_active = true
           AND ABS(latitude - $1::double precision) < $3
           AND ABS(longitude - $2::double precision) < $4
         ORDER BY ABS(latitude - $1::double precision) + ABS(longitude - $2::double precision)
         LIMIT 1`,
        [t.lat, t.lng, NEAR_LAT, NEAR_LNG],
      );

      if (existing.rows.length > 0) {
        const toiletId = existing.rows[0].id;
        matched++;

        // Merge: set bidet if confirmed, merge wheelchair
        const updates: string[] = ['updated_at = CURRENT_TIMESTAMP'];
        const params: any[] = [toiletId];
        let idx = 2;

        if (t.hasBidet === true) {
          updates.push(`has_bidet = true`);
        }
        if (t.wheelchair === true) {
          updates.push(`wheelchair_accessible = wheelchair_accessible OR true`);
        }

        await pool.query(`UPDATE toilets SET ${updates.join(', ')} WHERE id = $1`, params);

        // One review per toilet per run
        if (!reviewAddedThisRun.has(toiletId)) {
          await pool.query(
            `INSERT INTO toilet_reviews (id, toilet_id, cleanliness_score, smell_score, review_text, reviewed_by)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              uuidv4(),
              toiletId,
              t.cleanlinessScore,
              t.smellScore,
              reviewText(t),
              t.source,
            ],
          );
          reviewAddedThisRun.add(toiletId);
          reviewsAdded++;
        }
        continue;
      }

      // Insert new toilet
      const newId = uuidv4();
      const toiletName = t.name || `Public Toilet (${t.city})`;
      const normalizedName = toiletName.toLowerCase().trim().replace(/\s+/g, ' ');

      await pool.query(
        `INSERT INTO toilets (
          id, name, address, latitude, longitude, location,
          has_toilet_paper, has_bidet, has_seat_warmer, has_hand_soap,
          wheelchair_accessible, pay_to_enter,
          toilet_type, number_of_stalls, normalized_name, created_by, city
        )
        VALUES (
          $1, $2, $3, $4, $5, ST_SetSRID(ST_MakePoint($5, $4), 4326)::geography,
          false, $6, false, false,
          $7, $8,
          'sit', 1, $9, $10, $11
        )`,
        [
          newId,
          toiletName,
          `${t.city}`, // address placeholder — city name
          t.lat,
          t.lng,
          t.hasBidet === true ? true : t.hasBidet === false ? false : null,
          t.wheelchair === true,
          t.fee === true,
          normalizedName,
          t.source,
          t.city,
        ],
      );

      // Add initial review
      await pool.query(
        `INSERT INTO toilet_reviews (id, toilet_id, cleanliness_score, smell_score, review_text, reviewed_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [uuidv4(), newId, t.cleanlinessScore, t.smellScore, reviewText(t), t.source],
      );

      inserted++;
      reviewsAdded++;
      if (inserted % 100 === 0) console.log(`    Inserted ${inserted}…`);
    } catch (e: any) {
      skipped++;
      if (skipped <= 5) console.warn(`    Skip: ${t.name || 'unnamed'} — ${e?.message}`);
    }
  }

  console.log(
    `  [DB] New: ${inserted}, Matched existing: ${matched}, Reviews added: ${reviewsAdded}, Skipped: ${skipped}`,
  );
}

function reviewText(t: RatedToilet): string {
  const parts: string[] = [];
  if (t.nearbyPOI) parts.push(`Near ${t.nearbyPOI}.`);
  if (t.hasBidet === true) parts.push('Bidet available.');
  if (t.wheelchair === true) parts.push('Wheelchair accessible.');
  if (t.fee === true) parts.push('Paid entry.');
  if (t.openingHours) parts.push(`Hours: ${t.openingHours}`);
  parts.push(`Data source: ${t.source.replace('_', ' ')}.`);
  return parts.join(' ') || `Imported from ${t.source}.`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  const cities = CITY_FLAG
    ? CITY_CONFIGS.filter((c) => c.name.toLowerCase().includes(CITY_FLAG))
    : CITY_CONFIGS;

  if (cities.length === 0) {
    console.error(`No city matched "${CITY_FLAG}". Available: ${CITY_CONFIGS.map((c) => c.name).join(', ')}`);
    process.exit(1);
  }

  console.log(`\n🚽 Global Toilet Import — ${cities.length} cities${DRY_RUN ? ' (DRY RUN)' : ''}\n`);

  const pool = DRY_RUN ? (null as unknown as Pool) : createImportPool();
  let totalInserted = 0;

  const failed: string[] = [];

  for (const cfg of cities) {
    console.log(`\n═══ ${cfg.name} (safety ${cfg.safetyIndex} → base ${cfg.baseScore}) ═══`);

    try {
      // Phase 1: Fetch toilets
      const rawToilets = await fetchToiletsForCity(cfg);
      if (rawToilets.length === 0) {
        console.log('  No toilets found, skipping.');
        continue;
      }

      // Phase 2: Fetch hotels/malls
      const pois = await fetchPOIsForCity(cfg);

      // Phase 3: Rate
      const rated = rateToilets(rawToilets, pois, cfg.baseScore);

      const upgraded = rated.filter((t) => t.nearbyPOI);
      console.log(
        `  [Rate] ${rated.length} toilets rated. ${upgraded.length} upgraded (near hotel/mall), ${rated.length - upgraded.length} at base ${cfg.baseScore}`,
      );

      if (DRY_RUN) {
        console.log('  [DRY RUN] Sample (first 5):');
        rated.slice(0, 5).forEach((t) =>
          console.log(
            `    ${t.name || '(unnamed)'} — ${t.cleanlinessScore}/${t.smellScore}${t.nearbyPOI ? ` [${t.nearbyPOI}]` : ''} bidet=${t.hasBidet ?? '?'}`,
          ),
        );
        totalInserted += rated.length;
        continue;
      }

      // Phase 4: Insert into DB
      await insertToilets(pool, rated);
      totalInserted += rated.length;
    } catch (e: any) {
      console.error(`  ✖ ${cfg.name} failed: ${e?.message}`);
      failed.push(cfg.name);
    }
  }

  if (failed.length > 0) {
    console.log(`\n⚠ Failed cities (re-run with --city=NAME): ${failed.join(', ')}`);
  }

  if (!DRY_RUN && pool) await pool.end();

  console.log(`\n✅ Done. Processed ${totalInserted} toilets across ${cities.length} cities.\n`);
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
