/**
 * Golden Toilet Hunt — monthly treasure hunt.
 *
 * Schedule:
 *   - 7 days before the 5th: push + email notification to all users
 *   - 5th of each month: 3 random golden toilets placed per city
 *   - Hunt runs 5th–26th (21 days)
 *
 * Check-in rules:
 *   - Max 2 distinct golden toilet check-ins per device per day
 *   - First check-in on a toilet marks it as "found"
 *   - Admin + user notified on eligible check-in
 */
import pool from '../config/database';
import { sendEmailToUser } from '../utils/adminEmail';
import { v4 as uuidv4 } from 'uuid';

const GOLDEN_PER_CITY = 3;
const HUNT_DURATION_DAYS = 21;
const NOTIFY_DAYS_BEFORE = 7;

// Next hunt start = 5th of current month if today < 5th, else 5th of next month (UTC)
export function nextHuntStart(now = new Date()): Date {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  if (d < 5) return new Date(Date.UTC(y, m, 5));
  return new Date(Date.UTC(y, m + 1, 5)); // JS handles month=12 overflow
}

function huntDates(startsAt: Date) {
  const endsAt = new Date(startsAt.getTime() + HUNT_DURATION_DAYS * 86_400_000);
  const notifyAt = new Date(startsAt.getTime() - NOTIFY_DAYS_BEFORE * 86_400_000);
  const monthKey = `${startsAt.getUTCFullYear()}-${String(startsAt.getUTCMonth() + 1).padStart(2, '0')}`;
  return { endsAt, notifyAt, monthKey };
}

// ── Push helpers ────────────────────────────────────────────────────────────

async function sendPushToUsers(title: string, body: string, deviceIds?: string[]): Promise<void> {
  try {
    const query = deviceIds
      ? 'SELECT push_token FROM user_push_tokens WHERE device_id = ANY($1) AND push_token != \'\''
      : 'SELECT push_token FROM user_push_tokens WHERE push_token != \'\'';
    const params = deviceIds ? [deviceIds] : [];
    const { rows } = await pool.query<{ push_token: string }>(query, params);
    if (rows.length === 0) return;

    const chunkSize = 100;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const messages = rows.slice(i, i + chunkSize).map((r) => ({
        to: r.push_token,
        title,
        body,
        sound: 'default',
      }));
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messages),
      });
      if (!res.ok) console.error('[GoldenHunt] Push batch failed:', res.status);
    }
  } catch (e) {
    console.error('[GoldenHunt] sendPushToUsers failed:', e);
  }
}

async function sendBulkEmailToAllUsers(subject: string, text: string): Promise<void> {
  try {
    const { rows } = await pool.query<{ email: string }>(
      'SELECT DISTINCT email FROM users WHERE email IS NOT NULL AND email != \'\''
    );
    for (const { email } of rows) {
      await sendEmailToUser(email, subject, text);
      await new Promise((r) => setTimeout(r, 50)); // Avoid SMTP throttle
    }
    console.log(`[GoldenHunt] Bulk email sent to ${rows.length} users`);
  } catch (e) {
    console.error('[GoldenHunt] Bulk email failed:', e);
  }
}

// ── Core jobs ───────────────────────────────────────────────────────────────

/** Place 3 random golden toilets per city for a new hunt month. Idempotent. */
export async function placeGoldenToilets(
  monthKey: string,
  startsAt: Date,
  endsAt: Date,
  notifyAt: Date,
): Promise<{ ok: boolean; skipped?: string; huntId?: string }> {
  const existing = await pool.query('SELECT id FROM golden_hunts WHERE month_key = $1', [monthKey]);
  if (existing.rows.length > 0) return { ok: true, skipped: 'already_placed', huntId: existing.rows[0].id };

  const huntId = uuidv4();
  await pool.query(
    'INSERT INTO golden_hunts (id, month_key, starts_at, ends_at, notify_at) VALUES ($1, $2, $3, $4, $5)',
    [huntId, monthKey, startsAt.toISOString(), endsAt.toISOString(), notifyAt.toISOString()],
  );

  const { rows: cities } = await pool.query<{ city: string }>(
    'SELECT DISTINCT city FROM toilets WHERE city IS NOT NULL AND is_active = true',
  );

  for (const { city } of cities) {
    const { rows: toilets } = await pool.query<{ id: string }>(
      'SELECT id FROM toilets WHERE city = $1 AND is_active = true ORDER BY RANDOM() LIMIT $2',
      [city, GOLDEN_PER_CITY],
    );
    for (const { id: toiletId } of toilets) {
      await pool.query(
        'INSERT INTO golden_hunt_toilets (id, hunt_id, toilet_id, city) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
        [uuidv4(), huntId, toiletId, city],
      );
    }
  }

  console.log(`[GoldenHunt] Placed ${GOLDEN_PER_CITY} golden toilets × ${cities.length} cities for ${monthKey}`);
  return { ok: true, huntId };
}

/** Send 1-week-before notifications to all users. Idempotent via scheduled_job_runs. */
export async function sendHuntNotifications(hunt: {
  id: string;
  monthKey: string;
  startsAt: Date;
}): Promise<void> {
  const jobId = `golden_hunt_notify:${hunt.monthKey}`;
  const done = await pool.query('SELECT 1 FROM scheduled_job_runs WHERE job_id = $1', [jobId]);
  if (done.rowCount && done.rowCount > 0) return;

  const dateStr = hunt.startsAt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
  const pushTitle = '🚽 Golden Toilet Hunt in 1 week!';
  const pushBody = `Starts ${dateStr}. Find hidden golden toilets to win a $10 voucher!`;
  const emailSubject = `Ploop Golden Toilet Hunt – starts ${dateStr}`;
  const emailText = [
    `The Ploop Golden Toilet Hunt begins ${dateStr}!`,
    '',
    'Three golden toilets are hidden in each city. Find them and check in to be eligible for a $10 voucher.',
    '',
    `Rules:`,
    `• Hunt runs 3 weeks (${dateStr} to the 26th)`,
    `• Max 2 golden toilet check-ins per day`,
    `• First come, first served — find them before anyone else!`,
    '',
    'Open the Ploop app on hunt day to start hunting!',
    '',
    '– The Ploop Team',
  ].join('\n');

  await sendPushToUsers(pushTitle, pushBody);
  await sendBulkEmailToAllUsers(emailSubject, emailText);

  await pool.query('INSERT INTO scheduled_job_runs (job_id) VALUES ($1) ON CONFLICT DO NOTHING', [jobId]);
  await pool.query('UPDATE golden_hunts SET notified_at = now() WHERE id = $1', [hunt.id]);
  console.log(`[GoldenHunt] Notifications sent for ${hunt.monthKey}`);
}

// ── Check-in handler (called from toilets route) ─────────────────────────────

export interface GoldenCheckinResult {
  isGolden: true;
  eligible: boolean;
  toiletName: string;
  city: string;
}

/**
 * Called after a successful new check-in. Returns golden result if the toilet
 * is a golden hunt toilet, otherwise null.
 */
export async function handleGoldenCheckin(
  toiletId: string,
  deviceId: string,
  userId: string | null,
): Promise<GoldenCheckinResult | null> {
  // Is there an active (non-paused) hunt?
  const { rows: hunts } = await pool.query<{ id: string }>(
    'SELECT id FROM golden_hunts WHERE starts_at <= now() AND ends_at >= now() AND is_paused = false LIMIT 1',
  );
  if (hunts.length === 0) return null;
  const huntId = hunts[0].id;

  // Is this toilet in the hunt?
  const { rows: goldenRows } = await pool.query<{
    id: string; city: string; is_found: boolean; name: string;
  }>(
    `SELECT ght.id, ght.city, ght.is_found, t.name
     FROM golden_hunt_toilets ght
     JOIN toilets t ON t.id = ght.toilet_id
     WHERE ght.hunt_id = $1 AND ght.toilet_id = $2`,
    [huntId, toiletId],
  );
  if (goldenRows.length === 0) return null;
  const golden = goldenRows[0];

  // Is this city paused or ended?
  const { rows: cityStatus } = await pool.query<{ is_paused: boolean; is_ended: boolean }>(
    'SELECT is_paused, is_ended FROM golden_hunt_city_status WHERE hunt_id = $1 AND city = $2',
    [huntId, golden.city],
  );
  if (cityStatus.length > 0 && (cityStatus[0].is_paused || cityStatus[0].is_ended)) return null;

  // Only the very first check-in on a toilet (globally) is voucher-eligible
  const isFirstFinder = !golden.is_found;

  // Mark toilet as found on first ever check-in
  if (isFirstFinder) {
    await pool.query('UPDATE golden_hunt_toilets SET is_found = true, found_at = now() WHERE id = $1', [golden.id]);
  }

  // Record the check-in for admin tracking (all check-ins, but voucher only for first finder)
  const eligible = isFirstFinder;
  if (eligible) {
    let userName: string | null = null;
    let userEmail: string | null = null;
    if (userId) {
      const { rows: uRows } = await pool.query<{ email: string; display_name: string | null }>(
        'SELECT email, display_name FROM users WHERE id = $1', [userId],
      );
      userEmail = uRows[0]?.email ?? null;
      userName = uRows[0]?.display_name ?? null;
    }
    await pool.query(
      `INSERT INTO golden_hunt_checkins
         (hunt_id, golden_hunt_toilet_id, toilet_id, user_id, device_id, user_name, user_email)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [huntId, golden.id, toiletId, userId, deviceId, userName, userEmail],
    ).catch(() => {});
    notifyCheckin(golden.name, golden.city, userEmail, deviceId).catch(() => {});
  }

  return { isGolden: true, eligible, toiletName: golden.name, city: golden.city };
}

async function notifyCheckin(
  toiletName: string,
  city: string,
  userEmail: string | null,
  deviceId: string,
): Promise<void> {
  const adminEmail = process.env.ADMIN_GOLDEN_TOILET_EMAIL || 'admin@ploop-app.com';
  const adminEmails = [
    ...new Set([
      ...(process.env.ADMIN_EMAILS || '').split(',').map((e) => e.trim()).filter(Boolean),
      adminEmail,
    ]),
  ];

  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (host && user && pass) {
    const nodemailer = await import('nodemailer');
    const transporter = nodemailer.default.createTransport({
      host,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user, pass },
    });
    const from = process.env.SMTP_FROM || user || 'noreply@ploop.app';

    for (const to of adminEmails) {
      await transporter.sendMail({
        from, to,
        subject: `[Ploop] Golden Toilet check-in — ${toiletName}`,
        text: [
          'A golden toilet has been checked into!',
          '',
          `Toilet:  ${toiletName}`,
          `City:    ${city}`,
          `User:    ${userEmail ?? '(anonymous)'}`,
          `Device:  ${deviceId}`,
          `Time:    ${new Date().toISOString()}`,
          '',
          'Review eligibility for the $10 voucher.',
        ].join('\n'),
      }).catch(() => {});
    }

    if (userEmail) {
      await transporter.sendMail({
        from, to: userEmail,
        subject: 'You found a Ploop Golden Toilet! 🚽🏆',
        text: [
          `Congratulations! You checked into a golden toilet:`,
          `  ${toiletName} — ${city}`,
          '',
          'You are eligible for a $10 voucher. Our team will be in touch shortly.',
          '',
          '– The Ploop Team',
        ].join('\n'),
      }).catch(() => {});
    }
  }

  // Push to user's device
  await sendPushToUsers(
    'You found a Golden Toilet! 🏆',
    `${toiletName} in ${city} — you're eligible for a $10 voucher!`,
    [deviceId],
  );
}

// ── Scheduler ───────────────────────────────────────────────────────────────

export function scheduleGoldenToiletHunt(): void {
  const tick = async () => {
    try {
      const now = new Date();
      const todayUTC = now.getUTCDate();
      const y = now.getUTCFullYear();
      const m = now.getUTCMonth();

      // Place golden toilets on the 5th of each month
      if (todayUTC === 5) {
        const startsAt = new Date(Date.UTC(y, m, 5));
        const { endsAt, notifyAt, monthKey } = huntDates(startsAt);
        const result = await placeGoldenToilets(monthKey, startsAt, endsAt, notifyAt);
        if (result.ok && !result.skipped) console.log(`[GoldenHunt] Hunt created for ${monthKey}`);
      }

      // Send 1-week notification (7 days before the next 5th)
      const next5th = nextHuntStart(now);
      const notifyDay = new Date(next5th.getTime() - NOTIFY_DAYS_BEFORE * 86_400_000);
      if (
        now.getUTCDate() === notifyDay.getUTCDate() &&
        now.getUTCMonth() === notifyDay.getUTCMonth() &&
        now.getUTCFullYear() === notifyDay.getUTCFullYear()
      ) {
        const { endsAt, notifyAt, monthKey } = huntDates(next5th);
        // Ensure hunt record exists (for idempotency key)
        let huntId: string;
        const existing = await pool.query('SELECT id FROM golden_hunts WHERE month_key = $1', [monthKey]);
        if (existing.rows.length === 0) {
          huntId = uuidv4();
          await pool.query(
            'INSERT INTO golden_hunts (id, month_key, starts_at, ends_at, notify_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING',
            [huntId, monthKey, next5th.toISOString(), endsAt.toISOString(), notifyAt.toISOString()],
          );
        } else {
          huntId = existing.rows[0].id;
        }
        await sendHuntNotifications({ id: huntId, monthKey, startsAt: next5th });
      }
    } catch (e) {
      console.error('[GoldenHunt] Scheduled tick failed:', e);
    }
  };

  const hourMs = 60 * 60 * 1000;
  setTimeout(() => {
    tick();
    setInterval(tick, hourMs);
  }, 6000);
}
