#!/usr/bin/env npx ts-node
/**
 * Import public toilet locations at China's international airports into Ploop.
 *
 * Sources OpenStreetMap for:
 *   - Actual amenity=toilets nodes/ways inside international airport bboxes
 *   - Falls back to aeroway=terminal centroids when no toilet nodes exist
 *
 * Scores: cleanliness 4, smell 4 (international airports)
 * Deduplication: skips any existing record within 0.0002° (~22 m)
 *
 * Usage:
 *   DATABASE_URL=postgres://... npx ts-node scripts/import-china-airports.ts
 *   DATABASE_URL=postgres://... DRY_RUN=1 npx ts-node scripts/import-china-airports.ts
 */

import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';

const DATABASE_URL = process.env.DATABASE_URL;
const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

interface AirportDef {
  name: string;
  iata: string;
  city: string;
  /** minLat,minLon,maxLat,maxLon */
  bbox: string;
}

// Major international airports in mainland China
const CHINA_INTERNATIONAL_AIRPORTS: AirportDef[] = [
  { name: 'Beijing Capital International Airport', iata: 'PEK', city: 'Beijing', bbox: '40.02,116.55,40.10,116.63' },
  { name: 'Beijing Daxing International Airport',  iata: 'PKX', city: 'Beijing', bbox: '39.48,116.38,39.54,116.44' },
  { name: 'Shanghai Pudong International Airport', iata: 'PVG', city: 'Shanghai', bbox: '31.13,121.77,31.20,121.85' },
  { name: 'Shanghai Hongqiao International Airport', iata: 'SHA', city: 'Shanghai', bbox: '31.18,121.31,31.22,121.36' },
  { name: 'Guangzhou Baiyun International Airport', iata: 'CAN', city: 'Guangzhou', bbox: '23.37,113.28,23.43,113.34' },
  { name: 'Shenzhen Bao\'an International Airport',  iata: 'SZX', city: 'Shenzhen', bbox: '22.60,113.80,22.65,113.84' },
  { name: 'Chengdu Tianfu International Airport',   iata: 'TFU', city: 'Chengdu', bbox: '30.29,104.43,30.35,104.49' },
  { name: 'Chengdu Shuangliu International Airport', iata: 'CTU', city: 'Chengdu', bbox: '30.56,103.94,30.60,103.98' },
  { name: 'Kunming Changshui International Airport', iata: 'KMG', city: 'Kunming', bbox: '25.09,102.91,25.14,102.96' },
  { name: 'Xi\'an Xianyang International Airport',   iata: 'XIY', city: "Xi'an", bbox: '34.43,108.74,34.47,108.78' },
  { name: 'Hangzhou Xiaoshan International Airport', iata: 'HGH', city: 'Hangzhou', bbox: '30.22,120.41,30.26,120.44' },
  { name: 'Nanjing Lukou International Airport',     iata: 'NKG', city: 'Nanjing', bbox: '31.73,118.86,31.77,118.90' },
  { name: 'Chongqing Jiangbei International Airport', iata: 'CKG', city: 'Chongqing', bbox: '29.71,106.63,29.75,106.67' },
  { name: 'Wuhan Tianhe International Airport',      iata: 'WUH', city: 'Wuhan', bbox: '30.77,114.19,30.81,114.23' },
  { name: 'Sanya Phoenix International Airport',     iata: 'SYX', city: 'Sanya', bbox: '18.30,109.40,18.34,109.43' },
  { name: 'Xiamen Gaoqi International Airport',      iata: 'XMN', city: 'Xiamen', bbox: '24.54,118.12,24.57,118.14' },
  { name: 'Qingdao Jiaodong International Airport',  iata: 'TAO', city: 'Qingdao', bbox: '36.26,120.37,36.30,120.41' },
  { name: 'Urumqi Diwopu International Airport',     iata: 'URC', city: 'Urumqi', bbox: '43.89,87.46,43.92,87.49' },
  { name: 'Harbin Taiping International Airport',    iata: 'HRB', city: 'Harbin', bbox: '45.62,126.24,45.64,126.27' },
  { name: 'Zhengzhou Xinzheng International Airport', iata: 'CGO', city: 'Zhengzhou', bbox: '34.51,113.83,34.54,113.86' },
];

async function overpassQuery(query: string): Promise<any[]> {
  const url = 'https://overpass-api.de/api/interpreter';
  const res = await fetch(url, {
    method: 'POST',
    body: query,
    headers: { 'Content-Type': 'text/plain' },
  });
  if (!res.ok) throw new Error(`Overpass error: ${res.status}`);
  const json = (await res.json()) as { elements?: any[] };
  return json.elements || [];
}

function coordsOf(el: any): { lat: number; lon: number } | null {
  if (el.type === 'node') return { lat: el.lat, lon: el.lon };
  if (el.center) return { lat: el.center.lat, lon: el.center.lon };
  return null;
}

async function fetchAirportToilets(airport: AirportDef): Promise<any[]> {
  const [minLat, minLon, maxLat, maxLon] = airport.bbox.split(',').map(Number);

  // First try actual toilet nodes
  const toiletEls = await overpassQuery(`
    [out:json][timeout:30];
    (
      node["amenity"="toilets"](${minLat},${minLon},${maxLat},${maxLon});
      way["amenity"="toilets"](${minLat},${minLon},${maxLat},${maxLon});
    );
    out center body;
  `);

  if (toiletEls.length > 0) return toiletEls;

  // Fallback: terminal building centroids
  return overpassQuery(`
    [out:json][timeout:30];
    (
      way["aeroway"="terminal"](${minLat},${minLon},${maxLat},${maxLon});
      node["aeroway"="terminal"](${minLat},${minLon},${maxLat},${maxLon});
    );
    out center body;
  `);
}

async function main() {
  if (!DATABASE_URL && !DRY_RUN) {
    console.error('Usage: DATABASE_URL=postgres://... npx ts-node scripts/import-china-airports.ts');
    process.exit(1);
  }

  const allRecords: any[] = [];

  for (const airport of CHINA_INTERNATIONAL_AIRPORTS) {
    console.log(`Querying ${airport.name} (${airport.iata})...`);
    try {
      const elements = await fetchAirportToilets(airport);
      if (elements.length === 0) {
        // No OSM data — insert one representative record at bbox center
        const [minLat, minLon, maxLat, maxLon] = airport.bbox.split(',').map(Number);
        allRecords.push({
          id: uuidv4(),
          name: `${airport.name} (${airport.iata}) - Terminal Restroom`,
          address: null,
          latitude: (minLat + maxLat) / 2,
          longitude: (minLon + maxLon) / 2,
          city: airport.city,
          source: 'fallback_center',
        });
        console.log(`  No OSM data — using bbox center.`);
      } else {
        for (const el of elements) {
          const coords = coordsOf(el);
          if (!coords) continue;
          const tags = el.tags || {};
          const label = tags.name || tags['name:en'] || tags.ref || 'Terminal Restroom';
          allRecords.push({
            id: uuidv4(),
            name: `${airport.name} (${airport.iata}) - ${label}`,
            address: null,
            latitude: coords.lat,
            longitude: coords.lon,
            city: airport.city,
            source: 'osm',
          });
        }
        console.log(`  Found ${elements.length} location(s).`);
      }
    } catch (e: any) {
      console.warn(`  Failed for ${airport.iata}:`, e?.message);
    }

    // Be polite to Overpass API
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log(`\nTotal records: ${allRecords.length}`);

  if (DRY_RUN) {
    console.log('\nDRY_RUN — sample:');
    console.log(JSON.stringify(allRecords.slice(0, 5), null, 2));
    return;
  }

  const pool = new Pool({ connectionString: DATABASE_URL });
  let imported = 0;
  let skipped = 0;

  for (const t of allRecords) {
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
          true,true,false,true,false,'sit',20,4,4,$6,'import_china_airports',$7
        WHERE NOT EXISTS (
          SELECT 1 FROM toilets
          WHERE ABS(latitude  - $4::double precision) < 0.0002
            AND ABS(longitude - $5::double precision) < 0.0002
        )`,
        [t.id, t.name, t.address, t.latitude, t.longitude, normalizedName, t.city]
      );
      if (res.rowCount && res.rowCount > 0) {
        imported++;
      } else {
        skipped++;
        console.log(`  Duplicate skipped: ${t.name}`);
      }
    } catch (e: any) {
      if (e?.code === '23505') { skipped++; }
      else { console.warn(`  Error inserting ${t.name}:`, e?.message); skipped++; }
    }
  }

  console.log(`\nDone. Imported: ${imported}, Skipped: ${skipped}`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
