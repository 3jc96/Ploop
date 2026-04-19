#!/usr/bin/env npx ts-node
/**
 * Import Dallas-area toilets from OpenStreetMap into the Ploop database.
 *
 * Sources:
 *   - Malls → cleanliness 4, smell 4
 *   - Hotels (OSM stars) → 5★=5, 4★=4, 3★=3
 *   - Airport terminals (DFW + Love Field) → 4/4
 *   - Restaurants, cafés, fast food, food courts → scores inferred from venue type + OSM tags
 *     (stars/cuisine/smoking). Seed review text explains that these are heuristics, not live ratings.
 *   - Bars, pubs, biergartens, nightclubs → lower baseline; nightclubs get lower smell
 *
 * Limits (avoid huge Overpass results): IMPORT_DALLAS_MAX_FOOD (default 450), IMPORT_DALLAS_MAX_BARS (default 300)
 *
 * Usage:
 *   DATABASE_URL=postgres://... npx ts-node scripts/import-dallas-pois.ts
 *   DATABASE_URL=postgres://... DRY_RUN=1 npx ts-node scripts/import-dallas-pois.ts
 *   SKIP_SEED_REVIEWS=1  — insert toilets only, no synthetic toilet_reviews rows
 */

import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';

const DATABASE_URL = process.env.DATABASE_URL;
const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
const SKIP_SEED_REVIEWS = process.env.SKIP_SEED_REVIEWS === '1' || process.env.SKIP_SEED_REVIEWS === 'true';
const MAX_FOOD = Math.max(50, parseInt(process.env.IMPORT_DALLAS_MAX_FOOD || '450', 10));
const MAX_BARS = Math.max(30, parseInt(process.env.IMPORT_DALLAS_MAX_BARS || '300', 10));

function clampScore(n: number, lo = 1, hi = 5): number {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

/**
 * Infer cleanliness/smell from OSM tags. Real Google/Yelp reviews are not available in OSM;
 * we approximate "quality of place" from amenity, optional stars, cuisine, and smoking.
 */
function inferScoresFromVenue(tags: Record<string, string>): {
  cleanliness_score: number;
  smell_score: number;
  number_of_stalls: number;
  has_bidet: boolean;
  wheelchair_accessible: boolean;
  review_note: string;
} {
  const amenity = tags.amenity || '';
  const starsRaw = parseFloat(tags.stars || '');
  const smoking = tags.smoking || '';
  let clean = 4;
  let smell = 4;
  let stalls = 4;
  let bidet = false;
  const wheelchair = tags.wheelchair !== 'no';

  if (!Number.isNaN(starsRaw) && starsRaw >= 1) {
    const s = clampScore(starsRaw);
    clean = s;
    smell = s;
    stalls = Math.min(8, 4 + Math.floor(s / 2));
    bidet = s >= 5;
  } else {
    switch (amenity) {
      case 'restaurant':
        clean = 4;
        smell = 4;
        stalls = 4;
        if (tags.cuisine === 'fine_dining' || tags.cuisine === 'french' || tags.cuisine === 'japanese') {
          clean = 5;
          smell = 5;
          stalls = 6;
        }
        break;
      case 'cafe':
      case 'coffee_shop':
        clean = 4;
        smell = 4;
        stalls = 3;
        break;
      case 'fast_food':
        clean = 3;
        smell = 3;
        stalls = 3;
        break;
      case 'food_court':
        clean = 3;
        smell = 3;
        stalls = 6;
        break;
      case 'bar':
      case 'pub':
      case 'biergarten':
        clean = 3;
        smell = 3;
        stalls = 3;
        break;
      case 'nightclub':
        clean = 3;
        smell = 2;
        stalls = 4;
        break;
      default:
        clean = 3;
        smell = 3;
        stalls = 3;
    }
  }

  if (smoking === 'yes' || smoking === 'inside' || smoking === 'dedicated') {
    smell = clampScore(smell - 1);
  }

  const bits = [`amenity=${amenity}`];
  if (tags.cuisine) bits.push(`cuisine=${tags.cuisine}`);
  if (tags.stars) bits.push(`stars=${tags.stars}`);
  const review_note = `Imported from OpenStreetMap. Scores are a heuristic from venue type (${bits.join(', ')}), not live visitor reviews.`;

  return {
    cleanliness_score: clean,
    smell_score: smell,
    number_of_stalls: stalls,
    has_bidet: bidet,
    wheelchair_accessible: wheelchair,
    review_note,
  };
}

// Greater Dallas metro bounding box (minLat, minLon, maxLat, maxLon for Overpass)
const DALLAS_BBOX = '32.5,-97.2,33.2,-96.3';

// DFW Airport bounding box
const DFW_BBOX = '32.84,-97.07,32.92,-96.99';
// Love Field bounding box
const LOVE_BBOX = '32.83,-96.87,32.87,-96.84';

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
  cleanliness_score: number | null;
  smell_score: number | null;
  created_by: string;
  city: string;
  /** When set, a synthetic toilet_reviews row is inserted after a successful toilet insert */
  review_note?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Overpass is rate-limited; space out callers and retry on 429. */
async function overpassQuery(query: string, retries = 4): Promise<any[]> {
  const url = 'https://overpass-api.de/api/interpreter';
  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      body: query,
      headers: { 'Content-Type': 'text/plain' },
    });
    const text = await res.text();
    if (res.status === 429) {
      const waitMs = 8000 * (attempt + 1);
      console.warn(`  Overpass rate limit (429), waiting ${waitMs / 1000}s before retry ${attempt + 1}/${retries}...`);
      await sleep(waitMs);
      continue;
    }
    if (!res.ok) throw new Error(`Overpass API error: ${res.status} ${text.slice(0, 500)}`);
    const json = JSON.parse(text) as { elements?: any[] };
    return json.elements || [];
  }
  throw new Error('Overpass API: too many rate limits; try again in a few minutes or run imports one category at a time.');
}

function coordsOf(el: any): { lat: number; lon: number } | null {
  if (el.type === 'node') return { lat: el.lat, lon: el.lon };
  if (el.center) return { lat: el.center.lat, lon: el.center.lon };
  return null;
}

/** Fetch malls in the Dallas metro area */
async function fetchMalls(): Promise<ToiletRecord[]> {
  console.log('Fetching Dallas malls from OSM...');
  const [minLat, minLon, maxLat, maxLon] = DALLAS_BBOX.split(',').map(Number);
  const elements = await overpassQuery(`
    [out:json][timeout:60];
    (
      node["shop"="mall"](${minLat},${minLon},${maxLat},${maxLon});
      way["shop"="mall"](${minLat},${minLon},${maxLat},${maxLon});
      relation["shop"="mall"](${minLat},${minLon},${maxLat},${maxLon});
    );
    out center body;
  `);

  const records: ToiletRecord[] = [];
  for (const el of elements) {
    const coords = coordsOf(el);
    if (!coords) continue;
    const tags = el.tags || {};
    const name = tags.name || tags['name:en'] || 'Mall';
    records.push({
      id: uuidv4(),
      name: `${name} - Public Restroom`,
      address: tags['addr:full'] || tags['addr:street'] || null,
      latitude: coords.lat,
      longitude: coords.lon,
      has_toilet_paper: true,
      has_hand_soap: true,
      has_bidet: false,
      wheelchair_accessible: true,
      pay_to_enter: false,
      toilet_type: 'sit',
      number_of_stalls: 10,
      cleanliness_score: 4,
      smell_score: 4,
      created_by: 'import_dallas_malls',
      city: 'Dallas',
      review_note:
        'Imported from OpenStreetMap (mall). Baseline scores for a typical shopping mall restroom, not from visitor reviews.',
    });
  }
  console.log(`  Found ${records.length} mall(s).`);
  return records;
}

/** Fetch hotels in Dallas metro with star ratings */
async function fetchHotels(): Promise<ToiletRecord[]> {
  console.log('Fetching Dallas hotels from OSM...');
  const [minLat, minLon, maxLat, maxLon] = DALLAS_BBOX.split(',').map(Number);
  const elements = await overpassQuery(`
    [out:json][timeout:60];
    (
      node["tourism"="hotel"]["stars"](${minLat},${minLon},${maxLat},${maxLon});
      way["tourism"="hotel"]["stars"](${minLat},${minLon},${maxLat},${maxLon});
    );
    out center body;
  `);

  const records: ToiletRecord[] = [];
  for (const el of elements) {
    const coords = coordsOf(el);
    if (!coords) continue;
    const tags = el.tags || {};
    const starsRaw = parseFloat(tags.stars || '0');
    const stars = Math.round(starsRaw); // normalise "4.5" → 5, "3.5" → 4

    let score: number | null = null;
    let stalls = 4;
    if (stars >= 5) { score = 5; stalls = 8; }
    else if (stars === 4) { score = 4; stalls = 6; }
    else if (stars === 3) { score = 3; stalls = 4; }
    else continue; // skip unrated or <3 star hotels

    const name = tags.name || tags['name:en'] || 'Hotel';
    records.push({
      id: uuidv4(),
      name: `${name} - Guest Restroom`,
      address: tags['addr:full'] || tags['addr:street'] || null,
      latitude: coords.lat,
      longitude: coords.lon,
      has_toilet_paper: true,
      has_hand_soap: true,
      has_bidet: stars >= 5,
      wheelchair_accessible: true,
      pay_to_enter: false,
      toilet_type: 'sit',
      number_of_stalls: stalls,
      cleanliness_score: score,
      smell_score: score,
      created_by: 'import_dallas_hotels',
      city: 'Dallas',
      review_note: `Imported from OpenStreetMap (hotel, stars=${tags.stars}). Scores follow the mapped star rating, not live reviews.`,
    });
  }
  console.log(`  Found ${records.length} hotel(s) with star ratings.`);
  return records;
}

/** Fetch airport terminal toilets (DFW + Love Field) */
async function fetchAirports(): Promise<ToiletRecord[]> {
  console.log('Fetching Dallas airport terminals from OSM...');

  const airports: Array<{ bbox: string; name: string }> = [
    { bbox: DFW_BBOX, name: 'Dallas/Fort Worth International Airport' },
    { bbox: LOVE_BBOX, name: 'Dallas Love Field' },
  ];

  const records: ToiletRecord[] = [];

  for (const airport of airports) {
    const [minLat, minLon, maxLat, maxLon] = airport.bbox.split(',').map(Number);
    // Try to get actual toilet nodes inside the airport first
    const toiletEls = await overpassQuery(`
      [out:json][timeout:30];
      (
        node["amenity"="toilets"](${minLat},${minLon},${maxLat},${maxLon});
        way["amenity"="toilets"](${minLat},${minLon},${maxLat},${maxLon});
      );
      out center body;
    `);

    if (toiletEls.length > 0) {
      for (const el of toiletEls) {
        const coords = coordsOf(el);
        if (!coords) continue;
        const tags = el.tags || {};
        const label = tags.name || tags.ref || 'Terminal Restroom';
        records.push({
          id: uuidv4(),
          name: `${airport.name} - ${label}`,
          address: null,
          latitude: coords.lat,
          longitude: coords.lon,
          has_toilet_paper: true,
          has_hand_soap: true,
          has_bidet: false,
          wheelchair_accessible: true,
          pay_to_enter: false,
          toilet_type: 'sit',
          number_of_stalls: 15,
          cleanliness_score: 4,  // 3.5 rounded up; stored as numeric in DB
          smell_score: 4,
          created_by: 'import_dallas_airports',
          city: 'Dallas',
          review_note:
            'Imported from OpenStreetMap (airport). Baseline scores for a major airport restroom, not from visitor reviews.',
        });
      }
    } else {
      // Fallback: use the terminal building centroid
      const terminalEls = await overpassQuery(`
        [out:json][timeout:30];
        (
          way["aeroway"="terminal"](${minLat},${minLon},${maxLat},${maxLon});
          node["aeroway"="terminal"](${minLat},${minLon},${maxLat},${maxLon});
        );
        out center body;
      `);
      for (const el of terminalEls) {
        const coords = coordsOf(el);
        if (!coords) continue;
        const tags = el.tags || {};
        const label = tags.name || tags.ref || 'Terminal Restroom';
        records.push({
          id: uuidv4(),
          name: `${airport.name} - ${label}`,
          address: null,
          latitude: coords.lat,
          longitude: coords.lon,
          has_toilet_paper: true,
          has_hand_soap: true,
          has_bidet: false,
          wheelchair_accessible: true,
          pay_to_enter: false,
          toilet_type: 'sit',
          number_of_stalls: 15,
          cleanliness_score: 4,
          smell_score: 4,
          created_by: 'import_dallas_airports',
          city: 'Dallas',
          review_note:
            'Imported from OpenStreetMap (airport). Baseline scores for a major airport restroom, not from visitor reviews.',
        });
      }
    }
  }
  console.log(`  Found ${records.length} airport toilet/terminal location(s).`);
  return records;
}

/** Named restaurants, cafés, fast food, food courts (requires name tag in OSM). */
async function fetchFoodAndDrink(): Promise<ToiletRecord[]> {
  console.log('Fetching Dallas restaurants, cafés, fast food, food courts from OSM...');
  const [minLat, minLon, maxLat, maxLon] = DALLAS_BBOX.split(',').map(Number);
  const elements = await overpassQuery(`
    [out:json][timeout:120];
    (
      node["amenity"="restaurant"]["name"](${minLat},${minLon},${maxLat},${maxLon});
      way["amenity"="restaurant"]["name"](${minLat},${minLon},${maxLat},${maxLon});
      node["amenity"="cafe"]["name"](${minLat},${minLon},${maxLat},${maxLon});
      way["amenity"="cafe"]["name"](${minLat},${minLon},${maxLat},${maxLon});
      node["amenity"="coffee_shop"]["name"](${minLat},${minLon},${maxLat},${maxLon});
      way["amenity"="coffee_shop"]["name"](${minLat},${minLon},${maxLat},${maxLon});
      node["amenity"="fast_food"]["name"](${minLat},${minLon},${maxLat},${maxLon});
      way["amenity"="fast_food"]["name"](${minLat},${minLon},${maxLat},${maxLon});
      node["amenity"="food_court"]["name"](${minLat},${minLon},${maxLat},${maxLon});
      way["amenity"="food_court"]["name"](${minLat},${minLon},${maxLat},${maxLon});
    );
    out center;
  `);

  const records: ToiletRecord[] = [];
  for (const el of elements) {
    const coords = coordsOf(el);
    if (!coords) continue;
    const tags = el.tags || {};
    const placeName = tags.name || tags['name:en'];
    if (!placeName) continue;
    const inferred = inferScoresFromVenue(tags);
    const suffix =
      tags.amenity === 'fast_food'
        ? 'Restroom'
        : tags.amenity === 'cafe' || tags.amenity === 'coffee_shop'
          ? 'Restroom'
          : tags.amenity === 'food_court'
            ? 'Restroom'
            : 'Customer restroom';

    records.push({
      id: uuidv4(),
      name: `${placeName} - ${suffix}`,
      address:
        tags['addr:full'] ||
        tags['addr:street'] ||
        (tags['addr:housenumber'] && tags['addr:street']
          ? `${tags['addr:housenumber']} ${tags['addr:street']}`
          : null),
      latitude: coords.lat,
      longitude: coords.lon,
      has_toilet_paper: true,
      has_hand_soap: true,
      has_bidet: inferred.has_bidet,
      wheelchair_accessible: inferred.wheelchair_accessible,
      pay_to_enter: false,
      toilet_type: 'sit',
      number_of_stalls: inferred.number_of_stalls,
      cleanliness_score: inferred.cleanliness_score,
      smell_score: inferred.smell_score,
      created_by: 'import_dallas_food_drink',
      city: 'Dallas',
      review_note: inferred.review_note,
    });
  }
  const capped = records.slice(0, MAX_FOOD);
  console.log(`  Found ${records.length} food/drink venue(s), importing up to ${MAX_FOOD} → ${capped.length}.`);
  return capped;
}

/** Bars, pubs, biergartens, nightclubs (named only). */
async function fetchBarsAndNightlife(): Promise<ToiletRecord[]> {
  console.log('Fetching Dallas bars, pubs, nightclubs from OSM...');
  const [minLat, minLon, maxLat, maxLon] = DALLAS_BBOX.split(',').map(Number);
  const elements = await overpassQuery(`
    [out:json][timeout:120];
    (
      node["amenity"="bar"]["name"](${minLat},${minLon},${maxLat},${maxLon});
      way["amenity"="bar"]["name"](${minLat},${minLon},${maxLat},${maxLon});
      node["amenity"="pub"]["name"](${minLat},${minLon},${maxLat},${maxLon});
      way["amenity"="pub"]["name"](${minLat},${minLon},${maxLat},${maxLon});
      node["amenity"="biergarten"]["name"](${minLat},${minLon},${maxLat},${maxLon});
      way["amenity"="biergarten"]["name"](${minLat},${minLon},${maxLat},${maxLon});
      node["amenity"="nightclub"]["name"](${minLat},${minLon},${maxLat},${maxLon});
      way["amenity"="nightclub"]["name"](${minLat},${minLon},${maxLat},${maxLon});
    );
    out center;
  `);

  const records: ToiletRecord[] = [];
  for (const el of elements) {
    const coords = coordsOf(el);
    if (!coords) continue;
    const tags = el.tags || {};
    const placeName = tags.name || tags['name:en'];
    if (!placeName) continue;
    const inferred = inferScoresFromVenue(tags);
    records.push({
      id: uuidv4(),
      name: `${placeName} - Restroom`,
      address: tags['addr:full'] || tags['addr:street'] || null,
      latitude: coords.lat,
      longitude: coords.lon,
      has_toilet_paper: true,
      has_hand_soap: true,
      has_bidet: inferred.has_bidet,
      wheelchair_accessible: inferred.wheelchair_accessible,
      pay_to_enter: false,
      toilet_type: 'sit',
      number_of_stalls: inferred.number_of_stalls,
      cleanliness_score: inferred.cleanliness_score,
      smell_score: inferred.smell_score,
      created_by: 'import_dallas_bars',
      city: 'Dallas',
      review_note: inferred.review_note,
    });
  }
  const capped = records.slice(0, MAX_BARS);
  console.log(`  Found ${records.length} bar/nightlife venue(s), importing up to ${MAX_BARS} → ${capped.length}.`);
  return capped;
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
          t.id, t.name, t.address, t.latitude, t.longitude,
          t.has_toilet_paper, t.has_hand_soap, t.has_bidet,
          t.wheelchair_accessible, t.pay_to_enter,
          t.toilet_type, t.number_of_stalls,
          t.cleanliness_score, t.smell_score,
          normalizedName,
          t.created_by,
          t.city,
        ]
      );
      if (res.rowCount && res.rowCount > 0) {
        imported++;
        if (!SKIP_SEED_REVIEWS && t.review_note && t.cleanliness_score != null && t.smell_score != null) {
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
        console.log(`  Duplicate skipped: ${t.name}`);
      }
    } catch (e: any) {
      if (e?.code === '23505') {
        skipped++;
      } else {
        console.warn(`  Error inserting ${t.name}:`, e?.message);
        skipped++;
      }
    }
  }
  return { imported, skipped };
}

async function main() {
  if (!DATABASE_URL && !DRY_RUN) {
    console.error('Usage: DATABASE_URL=postgres://... npx ts-node scripts/import-dallas-pois.ts');
    process.exit(1);
  }

  // Run sequentially with pauses — parallel Overpass calls often hit 429 rate limits.
  const malls = await fetchMalls();
  await sleep(3000);
  const hotels = await fetchHotels();
  await sleep(3000);
  const airports = await fetchAirports();
  await sleep(3000);
  const food = await fetchFoodAndDrink();
  await sleep(3000);
  const bars = await fetchBarsAndNightlife();

  const all = [...malls, ...hotels, ...airports, ...food, ...bars];
  console.log(
    `\nTotal records to import: ${all.length} (malls=${malls.length}, hotels=${hotels.length}, airports=${airports.length}, food=${food.length}, bars=${bars.length})`
  );

  if (DRY_RUN) {
    console.log('\nDRY_RUN mode — sample output:');
    console.log(JSON.stringify(all.slice(0, 5), null, 2));
    return;
  }

  const pool = new Pool({ connectionString: DATABASE_URL });
  const { imported, skipped } = await insertToilets(pool, all);
  console.log(`\nDone. Imported: ${imported}, Skipped (duplicates/errors): ${skipped}`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
