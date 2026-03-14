#!/usr/bin/env npx ts-node
/**
 * Import toilets from a source database (e.g. local) to Render's database.
 *
 * Usage:
 *   SOURCE_DATABASE_URL=postgres://user:pass@localhost:5432/ploop \
 *   TARGET_DATABASE_URL=postgres://user:pass@dpg-xxx.render.com/ploop \
 *   npx ts-node scripts/import-toilets-to-render.ts
 *
 * Get TARGET_DATABASE_URL from Render Dashboard → ploop-db → Connection String (External).
 */

import { Pool } from 'pg';

const SOURCE = process.env.SOURCE_DATABASE_URL;
const TARGET = process.env.TARGET_DATABASE_URL;

if (!SOURCE || !TARGET) {
  console.error('Usage: SOURCE_DATABASE_URL=... TARGET_DATABASE_URL=... npx ts-node scripts/import-toilets-to-render.ts');
  console.error('Get TARGET_DATABASE_URL from Render → ploop-db → Connection String (External)');
  process.exit(1);
}

const sourcePool = new Pool({ connectionString: SOURCE });
const targetPool = new Pool({
  connectionString: TARGET,
  ssl: { rejectUnauthorized: true },
});

async function main() {
  console.log('Fetching toilets from source...');
  const res = await sourcePool.query(`
    SELECT id, name, address, latitude, longitude,
           cleanliness_score, smell_score, total_reviews,
           has_toilet_paper, has_bidet, has_seat_warmer, has_hand_soap,
           has_baby_changing, has_family_room,
           number_of_stalls, toilet_type, pay_to_enter, entry_fee, wheelchair_accessible,
           created_at, updated_at, created_by, is_active, normalized_name, google_place_id
    FROM toilets
    WHERE is_active = true
  `);

  const toilets = res.rows;
  console.log(`Found ${toilets.length} toilets to import.`);

  if (toilets.length === 0) {
    console.log('No toilets to import.');
    await sourcePool.end();
    await targetPool.end();
    return;
  }

  let imported = 0;
  let skipped = 0;

  for (const t of toilets) {
    try {
      await targetPool.query(
        `INSERT INTO toilets (
          id, name, address, latitude, longitude, location,
          cleanliness_score, smell_score, total_reviews,
          has_toilet_paper, has_bidet, has_seat_warmer, has_hand_soap,
          has_baby_changing, has_family_room,
          number_of_stalls, toilet_type, pay_to_enter, entry_fee, wheelchair_accessible,
          created_at, updated_at, created_by, is_active, normalized_name, google_place_id
        ) VALUES (
          $1, $2, $3, $4, $5, ST_SetSRID(ST_MakePoint($5, $4), 4326)::geography,
          $6, $7, $8, $9, $10, $11, $12,
          COALESCE($13, false), COALESCE($14, false),
          $15, $16, $17, $18, $19,
          $20, $21, $22, COALESCE($23, true), $24, $25
        )
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          address = EXCLUDED.address,
          latitude = EXCLUDED.latitude,
          longitude = EXCLUDED.longitude,
          location = EXCLUDED.location,
          updated_at = EXCLUDED.updated_at
        `,
        [
          t.id, t.name, t.address, t.latitude, t.longitude,
          t.cleanliness_score ?? 0, t.smell_score ?? 0, t.total_reviews ?? 0,
          t.has_toilet_paper ?? false, t.has_bidet ?? false, t.has_seat_warmer ?? false, t.has_hand_soap ?? false,
          t.has_baby_changing ?? false, t.has_family_room ?? false,
          t.number_of_stalls ?? 1, t.toilet_type ?? 'sit', t.pay_to_enter ?? false, t.entry_fee ?? null, t.wheelchair_accessible ?? false,
          t.created_at, t.updated_at, t.created_by, t.is_active, t.normalized_name, t.google_place_id ?? null,
        ]
      );
      imported++;
      if (imported % 10 === 0) console.log(`  Imported ${imported}/${toilets.length}...`);
    } catch (e: any) {
      if (e?.code === '42703') {
        console.warn(`  Skipping ${t.name} (column missing in target):`, e.message);
        skipped++;
      } else {
        throw e;
      }
    }
  }

  console.log(`Done. Imported: ${imported}, Skipped: ${skipped}`);
  await sourcePool.end();
  await targetPool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
