import pool from '../config/database';

/**
 * Best-effort schema bootstrap for local/dev.
 *
 * This repo currently doesn't include migrations. To keep development unblocked,
 * we create any new feature tables idempotently (CREATE TABLE IF NOT EXISTS).
 *
 * NOTE: We avoid extensions and server-side UUID generation; IDs are generated
 * in the Node process and inserted as UUID values.
 */
export async function ensureFeatureTables(): Promise<void> {
  const safe = async (sql: string) => {
    try {
      await pool.query(sql);
    } catch (e: any) {
      // During ts-node-dev hot reload, multiple processes can race to create the same
      // table/type. Postgres can transiently throw duplicate type errors. Ignore those.
      if (e?.code === '23505') return;
      throw e;
    }
  };

  // Reports: fast, expiring “closed/busy/etc” signals
  await safe(`
    CREATE TABLE IF NOT EXISTS toilet_reports (
      id uuid PRIMARY KEY,
      toilet_id uuid NOT NULL,
      report_type text NOT NULL,
      note text NULL,
      reported_by_device text NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL
    );
  `);

  await safe(`
    CREATE INDEX IF NOT EXISTS idx_toilet_reports_toilet_active
    ON toilet_reports (toilet_id, expires_at);
  `);

  // Community hints: short “how to find entrance / floor / code”
  await safe(`
    CREATE TABLE IF NOT EXISTS toilet_hints (
      id uuid PRIMARY KEY,
      toilet_id uuid NOT NULL,
      hint_text text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      created_by_device text NULL
    );
  `);

  await safe(`
    CREATE INDEX IF NOT EXISTS idx_toilet_hints_toilet
    ON toilet_hints (toilet_id, created_at DESC);
  `);

  // Favorites: per-device saved toilets (no auth yet)
  await safe(`
    CREATE TABLE IF NOT EXISTS toilet_favorites (
      device_id text NOT NULL,
      toilet_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (device_id, toilet_id)
    );
  `);

  await safe(`
    CREATE INDEX IF NOT EXISTS idx_toilet_favorites_device
    ON toilet_favorites (device_id);
  `);

  // Analytics: privacy-conscious event stream (no PII required)
  await safe(`
    CREATE TABLE IF NOT EXISTS analytics_events (
      id uuid PRIMARY KEY,
      device_id text NULL,
      event_name text NOT NULL,
      payload jsonb NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  await safe(`
    CREATE INDEX IF NOT EXISTS idx_analytics_events_name_time
    ON analytics_events (event_name, created_at);
  `);

  // Bind toilets to Google Places POIs + indexes for scale
  await safe(`
    DO $$
    BEGIN
      IF to_regclass('public.toilets') IS NOT NULL THEN
        ALTER TABLE toilets ADD COLUMN IF NOT EXISTS google_place_id text;
        ALTER TABLE toilets ADD COLUMN IF NOT EXISTS has_baby_changing boolean DEFAULT false;
        ALTER TABLE toilets ADD COLUMN IF NOT EXISTS has_family_room boolean DEFAULT false;
        ALTER TABLE toilets ADD COLUMN IF NOT EXISTS last_serviced_at timestamptz;
        CREATE INDEX IF NOT EXISTS idx_toilets_google_place_id ON toilets (google_place_id);
        CREATE INDEX IF NOT EXISTS idx_toilets_active ON toilets (is_active) WHERE is_active = true;
      END IF;
    END $$;
  `);

  // Spatial index for PostGIS ST_DWithin nearby queries (no-op if missing or not geography)
  try {
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_toilets_location_gist ON toilets USING GIST (location);
    `);
  } catch (e: any) {
    if (e?.code !== '42703' && e?.code !== '42P01') console.warn('[DB] Could not create spatial index:', e?.message);
  }

  // Users: for Google/Apple sign-in and review ownership
  await safe(`
    CREATE TABLE IF NOT EXISTS users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email text NOT NULL,
      display_name text,
      provider text NOT NULL,
      provider_id text NOT NULL,
      role text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(provider, provider_id)
    );
  `);
  await safe(`
    CREATE INDEX IF NOT EXISTS idx_users_provider_id ON users (provider, provider_id);
    CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
  `);

  // Email auth: add password_hash for provider='email'
  await safe(`
    DO $$
    BEGIN
      IF to_regclass('public.users') IS NOT NULL THEN
        ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash text;
      END IF;
    END $$;
  `);

  // Link toilet_reviews to users (optional: anonymous reviews keep user_id NULL)
  await safe(`
    DO $$
    BEGIN
      IF to_regclass('public.toilet_reviews') IS NOT NULL THEN
        ALTER TABLE toilet_reviews ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE SET NULL;
        CREATE INDEX IF NOT EXISTS idx_toilet_reviews_user_id ON toilet_reviews (user_id);
      END IF;
    END $$;
  `);

  // Poop game: global leaderboard scores
  await safe(`
    CREATE TABLE IF NOT EXISTS poop_game_scores (
      id uuid PRIMARY KEY,
      score int NOT NULL,
      display_name text,
      user_id uuid REFERENCES users(id) ON DELETE SET NULL,
      device_id text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await safe(`
    CREATE INDEX IF NOT EXISTS idx_poop_game_scores_score ON poop_game_scores (score DESC);
    CREATE INDEX IF NOT EXISTS idx_poop_game_scores_created ON poop_game_scores (created_at DESC);
  `);
}

