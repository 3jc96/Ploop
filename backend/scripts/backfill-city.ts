/**
 * Backfill city for existing toilets using reverse geocoding.
 * Run from backend dir: npx ts-node scripts/backfill-city.ts
 * Requires: GOOGLE_PLACES_API_KEY, DATABASE_URL
 */
import pool from '../src/config/database';
import { reverseGeocode } from '../src/utils/geocode';
import { ensureFeatureTables } from '../src/utils/ensureTables';

async function main() {
  console.log('Ensuring schema (city column)...');
  await ensureFeatureTables();

  const result = await pool.query(
    `SELECT id, name, latitude, longitude FROM toilets WHERE (city IS NULL OR city = '') AND is_active = true`
  );
  console.log(`Found ${result.rows.length} toilets without city`);
  let updated = 0;
  for (const row of result.rows) {
    try {
      const geo = await reverseGeocode(row.latitude, row.longitude);
      if (geo.city) {
        await pool.query('UPDATE toilets SET city = $1 WHERE id = $2', [geo.city, row.id]);
        updated++;
        console.log(`  ${row.name} -> ${geo.city}`);
      }
      await new Promise((r) => setTimeout(r, 200)); // rate limit
    } catch (e) {
      console.error(`  ${row.name}:`, e);
    }
  }
  console.log(`Updated ${updated} toilets`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
