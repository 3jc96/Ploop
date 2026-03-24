#!/usr/bin/env npx ts-node
/**
 * Extract Singapore addresses from Book1.pdf — the whole document is a bidet-toilet
 * crowd list — and import toilets (has_bidet always true for this source).
 *
 * BOOK1_PDF=../data/book1/Book1.pdf  (default)
 * DATABASE_URL=postgres://...
 * GOOGLE_PLACES_API_KEY=...         (Geocoding API)
 *
 * npx ts-node scripts/import-book1-bidet-pdf.ts --dry-run
 *
 * If a toilet already exists within ~20m, no duplicate row: sets has_bidet true,
 * merges wheelchair hints from remark text, and adds one 4★/4★ review per toilet
 * per run (reviewed_by book1_pdf).
 */
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import dotenv from 'dotenv';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';

dotenv.config({ path: path.join(__dirname, '../.env') });

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse') as (b: Buffer) => Promise<{ text: string }>;

const DRY_RUN = process.argv.includes('--dry-run');
const BOOK1_PDF = path.resolve(
  process.env.BOOK1_PDF || path.join(__dirname, '../../data/book1/Book1.pdf')
);
const GOOGLE_KEY = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;

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

function flattenPdfText(text: string): string {
  let s = text.replace(/\f/g, '\n').replace(/\r/g, '\n');
  s = s.replace(/\s+/g, ' ').trim();
  const loc = s.indexOf('Location');
  if (loc >= 0) s = s.slice(loc);
  return s;
}

/** Fix letter splits when PDF extraction breaks words (add more [broken] → [fixed] as needed). */
function repairPdfWordBreaks(s: string): string {
  return s.replace(/Compassval\s+e\s+Bow/gi, 'Compassvale Bow');
}

/** Text before "Singapore XXXXXX" for one row (venue + remarks + street prefix). */
function splitByPostcodes(flat: string): Array<{ before: string; postcode: string }> {
  const parts = flat.split(/Singapore (\d{6})/);
  const out: Array<{ before: string; postcode: string }> = [];
  for (let i = 1; i < parts.length; i += 2) {
    const postcode = parts[i];
    const before = parts[i - 1] || '';
    if (!/^\d{6}$/.test(postcode)) continue;
    out.push({ before, postcode });
  }
  return out;
}

function geocodeQueryForRow(before: string, postcode: string): string {
  const words = before.split(/\s+/).filter(Boolean);
  const tail = words.slice(-24).join(' ');
  return `${tail} Singapore ${postcode}`.replace(/\s+/g, ' ').trim();
}

function venueNameGuessWithPostcode(before: string, postcode: string): string {
  const t = before.replace(/\s+/g, ' ').trim();
  const streetMatch = t.match(/^(.+?)(?=\d[\d\s,#.-]{4,}(?:Rd|Ave|St\.|St |Dr\.|Dr |Way|Bow|Cres|Cl |Close|Central|Road|Highway|ECP|Link|Walk|Terrace)\b)/i);
  let name = (streetMatch ? streetMatch[1] : t).trim();
  name = name.replace(/[!,.:;]\s*$/, '').trim();
  if (name.length > 120) name = name.slice(0, 117) + '…';
  if (name.length < 2) name = `Bidet spot (${postcode})`;
  return name;
}

/** Entire Book1 PDF is bidet listings — always true for imports. */
const BOOK1_HAS_BIDET = true;

function wheelchairHintFromBefore(before: string): boolean {
  const s = before.toLowerCase();
  return /\bhandicap\b/.test(s) || /\bwheelchair\b/.test(s) || /\belderly\b/.test(s);
}

/**
 * PDF merges Location + Remarks + street prefix into `before`. Strip venue name and
 * trailing street fragment so review_text is mostly the remarks column.
 */
function remarksForReview(before: string, venueName: string): string {
  const full = before.replace(/\s+/g, ' ').trim();
  const streetRe =
    /\d[\d\s,#.-]{4,}(?:Rd|Ave|St\.|St |Dr\.|Dr |Way|Bow|Cres|Cl |Close|Central|Road|Highway|ECP|Link|Walk|Terrace|Blk|Drive|Dr |MRT)\b/i;
  const idx = full.search(streetRe);
  const head = idx > 0 ? full.slice(0, idx).trim() : full;

  let vn = venueName.replace(/…$/u, '').trim();
  let remarks = head;
  if (vn.length >= 2) {
    const lh = head.toLowerCase();
    const lv = vn.toLowerCase();
    if (lh.startsWith(lv)) {
      remarks = head.slice(vn.length).replace(/^[\s,.:;-]+/u, '').trim();
    }
  }
  if (!remarks) remarks = head;
  remarks = remarks.replace(/[!,.:;]\s*$/u, '').trim();
  const body = remarks.slice(0, 1800);
  if (!body) return 'No separate remarks parsed from source PDF.';
  return body;
}

async function geocodeAddress(address: string): Promise<{ lat: number; lng: number; formatted: string } | null> {
  if (!GOOGLE_KEY) return null;
  try {
    const res = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
      params: { address, key: GOOGLE_KEY, region: 'sg' },
    });
    if (res.data?.status !== 'OK' || !res.data?.results?.[0]?.geometry?.location) return null;
    const loc = res.data.results[0].geometry.location;
    return {
      lat: loc.lat,
      lng: loc.lng,
      formatted: res.data.results[0].formatted_address as string,
    };
  } catch {
    return null;
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  if (!fs.existsSync(BOOK1_PDF)) {
    console.error('PDF not found:', BOOK1_PDF);
    process.exit(1);
  }

  const buf = fs.readFileSync(BOOK1_PDF);
  const { text } = await pdfParse(buf);
  const flat = repairPdfWordBreaks(flattenPdfText(text));
  const chunks = splitByPostcodes(flat);

  const rows = chunks
    .map(({ before, postcode }) => {
      const q = geocodeQueryForRow(before, postcode);
      if (/LocationRemarksAddress/i.test(q)) return null;
      if (!/\d/.test(q)) return null;
      const name = venueNameGuessWithPostcode(before, postcode);
      return {
        geocodeQuery: q,
        name,
        remarksText: remarksForReview(before, name),
        wheelchair_accessible: wheelchairHintFromBefore(before),
        postcode,
      };
    })
    .filter(Boolean) as Array<{
    geocodeQuery: string;
    name: string;
    remarksText: string;
    wheelchair_accessible: boolean;
    postcode: string;
  }>;

  // Dedupe by postcode + similar query
  const seen = new Set<string>();
  const unique: typeof rows = [];
  for (const r of rows) {
    const k = `${r.postcode}:${r.geocodeQuery.slice(-40)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(r);
  }

  console.log(`Extracted ${unique.length} candidate rows from PDF.`);

  if (DRY_RUN) {
    console.log('DRY_RUN sample (5):');
    unique.slice(0, 5).forEach((r) => console.log(' ', r.name, '|', r.geocodeQuery));
    return;
  }

  if (!GOOGLE_KEY) {
    console.error('Set GOOGLE_PLACES_API_KEY (or GOOGLE_MAPS_API_KEY) for geocoding.');
    process.exit(1);
  }

  const pool = createImportPool();
  let imported = 0;
  let existingMatched = 0;
  let reviewsAdded = 0;
  let geoFail = 0;
  /** At most one 4/4 book1 review per toilet per run (PDF can repeat the same place). */
  const reviewAddedThisRun = new Set<string>();

  const NEAR_LAT = 0.0002;
  const NEAR_LNG = 0.0002;
  const REVIEW_BY = 'book1_pdf';

  for (const r of unique) {
    const geo = await geocodeAddress(r.geocodeQuery);
    await sleep(120);
    if (!geo) {
      geoFail++;
      console.warn('  Geocode miss:', r.geocodeQuery.slice(0, 70) + '…');
      continue;
    }

    const normalizedName = r.name.toLowerCase().trim().replace(/\s+/g, ' ');

    try {
      const existing = await pool.query<{ id: string }>(
        `SELECT id FROM toilets
         WHERE is_active = true
           AND ABS(latitude - $1::double precision) < $3
           AND ABS(longitude - $2::double precision) < $4
         ORDER BY ABS(latitude - $1::double precision) + ABS(longitude - $2::double precision)
         LIMIT 1`,
        [geo.lat, geo.lng, NEAR_LAT, NEAR_LNG]
      );

      if (existing.rows.length > 0) {
        const toiletId = existing.rows[0].id;
        existingMatched++;
        await pool.query(
          `UPDATE toilets SET
             has_bidet = true,
             wheelchair_accessible = wheelchair_accessible OR $2::boolean,
             updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [toiletId, r.wheelchair_accessible]
        );

        if (!reviewAddedThisRun.has(toiletId)) {
          await pool.query(
            `INSERT INTO toilet_reviews (id, toilet_id, cleanliness_score, smell_score, review_text, reviewed_by)
             VALUES ($1, $2, 4, 4, $3, $4)`,
            [uuidv4(), toiletId, r.remarksText, REVIEW_BY]
          );
          reviewAddedThisRun.add(toiletId);
          reviewsAdded++;
        }
        continue;
      }

      const newId = uuidv4();
      const res = await pool.query(
        `INSERT INTO toilets (
          id, name, address, latitude, longitude, location,
          has_toilet_paper, has_bidet, has_seat_warmer, has_hand_soap,
          wheelchair_accessible, pay_to_enter,
          toilet_type, number_of_stalls, normalized_name, created_by, city
        )
        VALUES ($1, $2, $3, $4, $5, ST_SetSRID(ST_MakePoint($5, $4), 4326)::geography,
          false, $6, false, false,
          $7, false,
          'sit', 1, $8, 'book1_pdf', 'Singapore')`,
        [
          newId,
          r.name,
          geo.formatted,
          geo.lat,
          geo.lng,
          BOOK1_HAS_BIDET,
          r.wheelchair_accessible,
          normalizedName,
        ]
      );
      if (res.rowCount && res.rowCount > 0) {
        imported++;
        await pool.query(
          `INSERT INTO toilet_reviews (id, toilet_id, cleanliness_score, smell_score, review_text, reviewed_by)
           VALUES ($1, $2, 4, 4, $3, $4)`,
          [uuidv4(), newId, r.remarksText, REVIEW_BY]
        );
        if (imported % 25 === 0) console.log(`  Imported ${imported}…`);
      }
    } catch (e: any) {
      console.warn('  Skip', r.name, e?.message);
    }
  }

  await pool.end();
  console.log(
    `Done. New toilets: ${imported}, matched existing (bidet/wheelchair merged): ${existingMatched}, new 4★/4★ reviews (one per toilet per run): ${reviewsAdded}, geocode failed: ${geoFail}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
