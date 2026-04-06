#!/usr/bin/env npx ts-node
/**
 * Import Dallas-area toilets from OpenStreetMap into the Ploop database.
 *
 * Sources:
 *   - Malls in nice areas → cleanliness 4, smell 4, toilet paper + soap
 *   - Hotels by star rating → 5★=5, 4★=4, 3★=3
 *   - Airport terminals (DFW + Love Field) → cleanliness 4, smell 4 (rounded from 3.5)
 *
 * Usage:
 *   DATABASE_URL=postgres://... npx ts-node scripts/import-dallas-pois.ts
 *   DATABASE_URL=postgres://... DRY_RUN=1 npx ts-node scripts/import-dallas-pois.ts
 */

import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';

const DATABASE_URL = process.env.DATABASE_URL;
const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

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
}

async function overpassQuery(query: string): Promise<any[]> {
  const url = 'https://overpass-api.de/api/interpreter';
  const res = await fetch(url, {
    method: 'POST',
    body: query,
    headers: { 'Content-Type': 'text/plain' },
  });
  if (!res.ok) throw new Error(`Overpass API error: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { elements?: any[] };
  return json.elements || [];
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
        });
      }
    }
  }
  console.log(`  Found ${records.length} airport toilet/terminal location(s).`);
  return records;
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
          $6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'ploop_import'
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
        ]
      );
      if (res.rowCount && res.rowCount > 0) {
        imported++;
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

  const [malls, hotels, airports] = await Promise.all([
    fetchMalls(),
    fetchHotels(),
    fetchAirports(),
  ]);

  const all = [...malls, ...hotels, ...airports];
  console.log(`\nTotal records to import: ${all.length} (${malls.length} malls, ${hotels.length} hotels, ${airports.length} airport locations)`);

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
