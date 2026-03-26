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

  // Toilet check-ins: for analytics by time of day (one per device per toilet per day)
  await safe(`
    CREATE TABLE IF NOT EXISTS toilet_checkins (
      id uuid PRIMARY KEY,
      toilet_id uuid NOT NULL,
      device_id text NOT NULL,
      user_id uuid NULL,
      checked_in_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await safe(`
    CREATE INDEX IF NOT EXISTS idx_toilet_checkins_toilet
    ON toilet_checkins (toilet_id, checked_in_at);
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
        ALTER TABLE toilets ADD COLUMN IF NOT EXISTS city text;
        CREATE INDEX IF NOT EXISTS idx_toilets_google_place_id ON toilets (google_place_id);
        CREATE INDEX IF NOT EXISTS idx_toilets_city ON toilets (city) WHERE city IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_toilets_active ON toilets (is_active) WHERE is_active = true;
      END IF;
    END $$;
  `);

  // Index on toilet_photos.toilet_id for LATERAL join in nearby query
  await safe(`
    CREATE INDEX IF NOT EXISTS idx_toilet_photos_toilet_id ON toilet_photos (toilet_id, uploaded_at DESC);
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

  // Idempotent scheduled jobs (e.g. monthly poop-game winner email)
  await safe(`
    CREATE TABLE IF NOT EXISTS scheduled_job_runs (
      job_id text PRIMARY KEY,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  // User suggestions (40 chars) – sent to admin via email + push
  await safe(`
    CREATE TABLE IF NOT EXISTS suggestions (
      id uuid PRIMARY KEY,
      text text NOT NULL,
      user_id uuid REFERENCES users(id) ON DELETE SET NULL,
      device_id text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await safe(`CREATE INDEX IF NOT EXISTS idx_suggestions_created ON suggestions (created_at DESC);`);

  // Admin push tokens for suggestion notifications
  await safe(`
    CREATE TABLE IF NOT EXISTS admin_push_tokens (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email text NOT NULL,
      token text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await safe(`CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_push_tokens_token ON admin_push_tokens (token);`);

  // Load diagnostics: per-session timing (perm, location, api) for Android vs iOS debugging
  await safe(`
    CREATE TABLE IF NOT EXISTS load_diagnostics (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      device_id text NULL,
      platform text NOT NULL,
      permission_ms int,
      location_source text,
      location_ms int,
      api_ms int,
      total_ms int,
      success boolean,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await safe(`CREATE INDEX IF NOT EXISTS idx_load_diagnostics_platform ON load_diagnostics (platform, created_at DESC);`);
  await safe(`CREATE INDEX IF NOT EXISTS idx_load_diagnostics_created ON load_diagnostics (created_at DESC);`);

  // Crash reports: from AppErrorBoundary and unhandled errors
  await safe(`
    CREATE TABLE IF NOT EXISTS crash_reports (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      device_id text NULL,
      platform text NULL,
      app_version text NULL,
      error_message text,
      error_stack text,
      component_stack text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await safe(`CREATE INDEX IF NOT EXISTS idx_crash_reports_created ON crash_reports (created_at DESC);`);

  // Golden toilet hunt: monthly treasure hunt
  await safe(`
    CREATE TABLE IF NOT EXISTS golden_hunts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      month_key varchar(7) NOT NULL UNIQUE,
      starts_at timestamptz NOT NULL,
      ends_at timestamptz NOT NULL,
      notify_at timestamptz NOT NULL,
      notified_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await safe(`CREATE INDEX IF NOT EXISTS idx_golden_hunts_starts ON golden_hunts (starts_at);`);

  await safe(`
    CREATE TABLE IF NOT EXISTS golden_hunt_toilets (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      hunt_id uuid NOT NULL REFERENCES golden_hunts(id),
      toilet_id uuid NOT NULL REFERENCES toilets(id),
      city text NOT NULL,
      is_found boolean NOT NULL DEFAULT false,
      found_at timestamptz,
      UNIQUE(hunt_id, toilet_id)
    );
  `);
  await safe(`CREATE INDEX IF NOT EXISTS idx_golden_hunt_toilets_hunt ON golden_hunt_toilets (hunt_id);`);
  await safe(`CREATE INDEX IF NOT EXISTS idx_golden_hunt_toilets_toilet ON golden_hunt_toilets (toilet_id);`);

  // User push tokens: for hunt notifications to all users (not just admins)
  await safe(`
    CREATE TABLE IF NOT EXISTS user_push_tokens (
      device_id text PRIMARY KEY,
      user_id uuid REFERENCES users(id) ON DELETE SET NULL,
      push_token text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await safe(`CREATE INDEX IF NOT EXISTS idx_user_push_tokens_user ON user_push_tokens (user_id) WHERE user_id IS NOT NULL;`);

  // Pause support for golden hunts
  await safe(`
    DO $$
    BEGIN
      IF to_regclass('public.golden_hunts') IS NOT NULL THEN
        ALTER TABLE golden_hunts ADD COLUMN IF NOT EXISTS is_paused boolean NOT NULL DEFAULT false;
      END IF;
    END $$;
  `);

  // Eligible golden check-ins: admin tracks + voucher workflow
  await safe(`
    CREATE TABLE IF NOT EXISTS golden_hunt_checkins (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      hunt_id uuid NOT NULL REFERENCES golden_hunts(id),
      golden_hunt_toilet_id uuid NOT NULL REFERENCES golden_hunt_toilets(id),
      toilet_id uuid NOT NULL REFERENCES toilets(id),
      user_id uuid REFERENCES users(id) ON DELETE SET NULL,
      device_id text NOT NULL,
      user_name text,
      user_email text,
      checked_in_at timestamptz NOT NULL DEFAULT now(),
      voucher_sent boolean NOT NULL DEFAULT false,
      voucher_sent_at timestamptz
    );
  `);
  await safe(`CREATE INDEX IF NOT EXISTS idx_golden_hunt_checkins_hunt ON golden_hunt_checkins (hunt_id, checked_in_at DESC);`);
  await safe(`CREATE INDEX IF NOT EXISTS idx_golden_hunt_checkins_toilet ON golden_hunt_checkins (golden_hunt_toilet_id);`);

  // One-time city name normalization: rename Malay "Singapura" -> "Singapore"
  await safe(`UPDATE toilets SET city = 'Singapore' WHERE city = 'Singapura'`);

  // Per-city pause/end overrides for golden hunts
  await safe(`
    CREATE TABLE IF NOT EXISTS golden_hunt_city_status (
      hunt_id uuid NOT NULL REFERENCES golden_hunts(id) ON DELETE CASCADE,
      city text NOT NULL,
      is_paused boolean NOT NULL DEFAULT false,
      is_ended boolean NOT NULL DEFAULT false,
      updated_at timestamptz DEFAULT now(),
      PRIMARY KEY (hunt_id, city)
    );
  `);
}

