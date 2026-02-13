/**
 * Verify database connection with retries on startup.
 * Helps surface DB config issues immediately instead of mysterious failures on first request.
 */
import pool from '../config/database';

const RETRY_ATTEMPTS = 5;
const RETRY_DELAY_MS = 2000;

export async function checkDatabase(): Promise<void> {
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      const client = await pool.connect();
      await client.query('SELECT 1');
      client.release();
      return;
    } catch (e: any) {
      const msg = e?.message || String(e);
      console.error(
        `[DB] Connection attempt ${attempt}/${RETRY_ATTEMPTS} failed:`,
        msg
      );
      if (attempt < RETRY_ATTEMPTS) {
        console.log(`[DB] Retrying in ${RETRY_DELAY_MS / 1000}s...`);
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      } else {
        throw new Error(
          `Database unreachable after ${RETRY_ATTEMPTS} attempts. ` +
            `Check Postgres is running and backend/.env (DB_HOST, DB_NAME, DB_USER, DB_PASSWORD). ` +
            `Error: ${msg}`
        );
      }
    }
  }
}
