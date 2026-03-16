#!/usr/bin/env npx ts-node
/**
 * Import toilets from OpenStreetMap (Overpass API) into the Ploop database.
 *
 * Fetches amenity=toilets from OSM for a bounding box or region.
 * Usage:
 *   DATABASE_URL=postgres://... npx ts-node scripts/import-toilets-from-osm.ts
 *   DATABASE_URL=postgres://... BBOX="116.2,39.8,116.6,40.0" npx ts-node scripts/import-toilets-from-osm.ts  # Beijing area
 *   DATABASE_URL=postgres://... REGION=china npx ts-node scripts/import-toilets-from-osm.ts
 *
 * BBOX format: minLon,minLat,maxLon,maxLat (WGS84)
 * REGION: china, singapore, hongkong, or custom bbox
 */

import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';

const DATABASE_URL = process.env.DATABASE_URL;
const BBOX = process.env.BBOX; // minLon,minLat,maxLon,maxLat
const REGION = process.env.REGION || 'china';
const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

const REGIONS: Record<string, string> = {
  china: '73.4,18.2,135.1,53.6', // China mainland (large)
  beijing: '115.4,39.4,117.5,41.1',
  shanghai: '120.8,30.6,122.0,31.6',
  guangzhou: '113.0,22.4,114.5,23.6',
  shenzhen: '113.7,22.4,114.6,22.9',
  singapore: '103.6,1.1,104.1,1.5',
  hongkong: '113.8,22.1,114.4,22.6',
};

function getBbox(): string {
  if (BBOX) return BBOX;
  return REGIONS[REGION.toLowerCase()] || REGIONS.china;
}

async function fetchFromOverpass(bbox: string): Promise<any[]> {
  const [minLon, minLat, maxLon, maxLat] = bbox.split(',').map(Number);
  const query = `
    [out:json][timeout:60];
    (
      node["amenity"="toilets"](${minLat},${minLon},${maxLat},${maxLon});
      way["amenity"="toilets"](${minLat},${minLon},${maxLat},${maxLon});
    );
    out center body;
  `;

  const url = 'https://overpass-api.de/api/interpreter';
  const res = await fetch(url, {
    method: 'POST',
    body: query,
    headers: { 'Content-Type': 'text/plain' },
  });

  if (!res.ok) throw new Error(`Overpass API error: ${res.status}`);
  const json = (await res.json()) as { elements?: any[] };
  const elements = json.elements || [];

  const toilets: Array<{
    id: string;
    name: string;
    address: string | null;
    latitude: number;
    longitude: number;
    has_toilet_paper: boolean;
    has_bidet: boolean;
    wheelchair_accessible: boolean;
    fee: boolean;
  }> = [];

  for (const el of elements) {
    const tags = el.tags || {};
    let lat: number, lon: number;

    if (el.type === 'node') {
      lat = el.lat;
      lon = el.lon;
    } else if (el.type === 'way' && el.center) {
      lat = el.center.lat;
      lon = el.center.lon;
    } else continue;

    const name =
      tags.name ||
      tags['name:en'] ||
      tags['name:zh'] ||
      (tags.fee === 'yes' ? 'Paid toilet' : 'Public toilet');

    const wheelchair = tags.wheelchair === 'yes' || tags.wheelchair === 'designated';
    const fee = tags.fee === 'yes';
    const toiletPaper = tags.toilets_paper === 'yes' || tags.toilet_paper === 'yes';
    const bidet = tags.bidet === 'yes';

    toilets.push({
      id: uuidv4(),
      name: String(name).slice(0, 255),
      address: tags['addr:street'] || tags.address || null,
      latitude: lat,
      longitude: lon,
      has_toilet_paper: toiletPaper,
      has_bidet: bidet,
      wheelchair_accessible: wheelchair,
      fee,
    });
  }

  return toilets;
}

async function main() {
  if (!DATABASE_URL && !DRY_RUN) {
    console.error('Usage: DATABASE_URL=postgres://... [BBOX=minLon,minLat,maxLon,maxLat] [REGION=china|beijing|shanghai|...] npx ts-node scripts/import-toilets-from-osm.ts');
    process.exit(1);
  }

  const bbox = getBbox();
  console.log(`Fetching toilets from OSM (bbox: ${bbox}, region: ${REGION})...`);

  const toilets = await fetchFromOverpass(bbox);
  console.log(`Found ${toilets.length} toilets from OpenStreetMap.`);

  if (toilets.length === 0) {
    console.log('No toilets to import.');
    return;
  }

  if (DRY_RUN) {
    console.log('DRY_RUN: would import', toilets.length, 'toilets. First 5:', toilets.slice(0, 5));
    return;
  }

  const pool = new Pool({ connectionString: DATABASE_URL });

  let imported = 0;
  let skipped = 0;

  for (const t of toilets) {
    try {
      const normalizedName = t.name.toLowerCase().trim().replace(/\s+/g, ' ');
      const res = await pool.query(
        `INSERT INTO toilets (
          id, name, address, latitude, longitude, location,
          has_toilet_paper, has_bidet, wheelchair_accessible, pay_to_enter,
          toilet_type, number_of_stalls, normalized_name, created_by
        )
        SELECT $1, $2, $3, $4, $5, ST_SetSRID(ST_MakePoint($5, $4), 4326)::geography,
          $6, $7, $8, $9, 'sit', 1, $10, 'osm_import'
        WHERE NOT EXISTS (
          SELECT 1 FROM toilets
          WHERE ABS(latitude - $4::double precision) < 0.0001
            AND ABS(longitude - $5::double precision) < 0.0001
            AND normalized_name = $10
        )`,
        [
          t.id,
          t.name,
          t.address,
          t.latitude,
          t.longitude,
          t.has_toilet_paper,
          t.has_bidet,
          t.wheelchair_accessible,
          t.fee,
          normalizedName,
        ]
      );
      if (res.rowCount && res.rowCount > 0) {
        imported++;
        if (imported % 50 === 0) console.log(`  Imported ${imported}/${toilets.length}...`);
      } else {
        skipped++;
      }
    } catch (e: any) {
      if (e?.code === '23505') {
        skipped++;
      } else {
        console.warn(`  Skip ${t.name}:`, e?.message);
        skipped++;
      }
    }
  }

  console.log(`Done. Imported: ${imported}, Skipped: ${skipped}`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
