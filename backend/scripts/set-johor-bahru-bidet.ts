#!/usr/bin/env npx ts-node
/**
 * Set has_bidet = true for all toilets in Johor Bahru area.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... npm run set-johor-bahru-bidet
 *
 * For Render: use TARGET_DATABASE_URL or Render's connection string.
 */

import { Pool } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL || process.env.TARGET_DATABASE_URL;

if (!DATABASE_URL) {
  console.error('Usage: DATABASE_URL=postgresql://... npx ts-node scripts/set-johor-bahru-bidet.ts');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('render.com') ? { rejectUnauthorized: true } : undefined,
});

// Johor Bahru, Malaysia - approximate bounding box
// Center: ~1.4927° N, 103.7414° E
// Box: ~15km radius
const JB_LAT_MIN = 1.35;
const JB_LAT_MAX = 1.65;
const JB_LON_MIN = 103.55;
const JB_LON_MAX = 103.95;

async function main() {
  console.log('Updating toilets in Johor Bahru to has_bidet = true...');

  const result = await pool.query(
    `UPDATE toilets
     SET has_bidet = true, updated_at = now()
     WHERE latitude BETWEEN $1 AND $2
       AND longitude BETWEEN $3 AND $4
       AND is_active = true
     RETURNING id, name, latitude, longitude`,
    [JB_LAT_MIN, JB_LAT_MAX, JB_LON_MIN, JB_LON_MAX]
  );

  const count = result.rowCount ?? 0;
  console.log(`Updated ${count} toilets in Johor Bahru.`);

  if (count > 0) {
    result.rows.slice(0, 5).forEach((r: any) => {
      console.log(`  - ${r.name} (${r.latitude?.toFixed(4)}, ${r.longitude?.toFixed(4)})`);
    });
    if (count > 5) console.log(`  ... and ${count - 5} more`);
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
