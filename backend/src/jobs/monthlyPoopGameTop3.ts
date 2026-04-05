import pool from '../config/database';
import { sendEmailToAdmins } from '../utils/adminEmail';

export type MonthlyWinnerRow = {
  rank: number;
  email: string;
  score: number;
  game_display_name: string | null;
  account_display_name: string | null;
};

/** Calendar month immediately before `now` in UTC (the period we report on). */
export function previousMonthRangeUTC(now = new Date()): {
  start: Date;
  end: Date;
  key: string;
  label: string;
} {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const endMs = Date.UTC(y, m, 1);
  const startMonth = m === 0 ? 11 : m - 1;
  const startYear = m === 0 ? y - 1 : y;
  const startMs = Date.UTC(startYear, startMonth, 1);
  const key = `${startYear}-${String(startMonth + 1).padStart(2, '0')}`;
  const label = `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][startMonth]} ${startYear}`;
  return { start: new Date(startMs), end: new Date(endMs), key, label };
}

const JOB_PREFIX = 'poop_game_monthly_top3:';
const RESET_JOB_PREFIX = 'poop_game_leaderboard_reset:';

/**
 * Idempotency key for the reset at the start of this UTC month (e.g. 2026-03 on 1 Mar 2026).
 */
export function currentMonthResetJobIdUTC(now = new Date()): string {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;
  return `${RESET_JOB_PREFIX}${y}-${String(m).padStart(2, '0')}`;
}

/**
 * Deletes all poop game scores (global leaderboard). Run on the 1st of each month UTC,
 * after {@link runMonthlyPoopGameTop3Report} so the previous month's data is still in DB for the email.
 */
export async function runMonthlyLeaderboardReset(options?: {
  force?: boolean;
}): Promise<{ ok: boolean; skipped?: string; deleted?: number; jobId?: string }> {
  const jobId = currentMonthResetJobIdUTC();

  if (!options?.force) {
    const done = await pool.query('SELECT 1 FROM scheduled_job_runs WHERE job_id = $1', [jobId]);
    if (done.rowCount && done.rowCount > 0) {
      return { ok: true, skipped: 'already_reset', jobId };
    }
  }

  const del = await pool.query('DELETE FROM poop_game_scores');
  const deleted = del.rowCount ?? 0;

  if (!options?.force) {
    await pool.query(
      `INSERT INTO scheduled_job_runs (job_id) VALUES ($1) ON CONFLICT (job_id) DO NOTHING`,
      [jobId]
    );
  }

  console.log(`[MonthlyPoopGame] Leaderboard reset: ${deleted} row(s) removed (${jobId})`);
  return { ok: true, deleted, jobId };
}

/**
 * Top 3 signed-in players by best single score in [start, end).
 * Guests (no user_id) are excluded — no email on file.
 */
export async function queryTop3SignedInWinners(start: Date, end: Date): Promise<MonthlyWinnerRow[]> {
  const result = await pool.query<{
    score: number;
    game_display_name: string | null;
    email: string;
    account_display_name: string | null;
  }>(
    `WITH best_per_user AS (
       SELECT DISTINCT ON (p.user_id)
         p.user_id,
         p.score,
         p.display_name AS game_display_name
       FROM poop_game_scores p
       WHERE p.created_at >= $1::timestamptz
         AND p.created_at < $2::timestamptz
         AND p.user_id IS NOT NULL
       ORDER BY p.user_id, p.score DESC, p.created_at DESC
     )
     SELECT b.score, b.game_display_name, u.email, u.display_name AS account_display_name
     FROM best_per_user b
     JOIN users u ON u.id = b.user_id
     ORDER BY b.score DESC
     LIMIT 3`,
    [start.toISOString(), end.toISOString()]
  );

  return result.rows.map((row, i) => ({
    rank: i + 1,
    email: row.email,
    score: row.score,
    game_display_name: row.game_display_name,
    account_display_name: row.account_display_name,
  }));
}

/**
 * Sends admin email for the previous calendar month (UTC) if not already sent.
 * Call on the 1st of each month (UTC) or via secret HTTP cron.
 */
export async function runMonthlyPoopGameTop3Report(options?: {
  /** If true, send even if job row exists (for testing). */
  force?: boolean;
}): Promise<{ ok: boolean; skipped?: string; sent?: boolean; jobId?: string }> {
  const { start, end, key, label } = previousMonthRangeUTC();
  const jobId = `${JOB_PREFIX}${key}`;

  if (!options?.force) {
    const done = await pool.query('SELECT 1 FROM scheduled_job_runs WHERE job_id = $1', [jobId]);
    if (done.rowCount && done.rowCount > 0) {
      return { ok: true, skipped: 'already_sent', jobId };
    }
  }

  const winners = await queryTop3SignedInWinners(start, end);

  const lastDayPrevMonth = new Date(end.getTime() - 1);
  let body = `Ploop — poop game top players (${label}, UTC)\n`;
  body += `Period: ${start.toISOString().slice(0, 10)} … ${lastDayPrevMonth.toISOString().slice(0, 10)} (UTC dates)\n\n`;

  if (winners.length === 0) {
    body += 'No signed-in scores in this period. (Guest-only play does not include email.)\n';
  } else {
    body += 'Top 3 (signed-in users, by best score in the month):\n\n';
    for (const w of winners) {
      const name = w.game_display_name || w.account_display_name || '—';
      body += `${w.rank}. Score ${w.score} — ${name}\n   Email: ${w.email}\n\n`;
    }
  }

  const mailed = await sendEmailToAdmins(`Ploop monthly game — top 3 (${label})`, body);

  if (mailed && !options?.force) {
    await pool.query(
      `INSERT INTO scheduled_job_runs (job_id) VALUES ($1) ON CONFLICT (job_id) DO NOTHING`,
      [jobId]
    );
  }

  return { ok: true, sent: mailed, jobId };
}

/** Start hourly check: on UTC day 1, send report for previous month, then clear leaderboard (once each). */
export function scheduleMonthlyPoopGameTop3Report(): void {
  const tick = async () => {
    try {
      const now = new Date();
      if (now.getUTCDate() !== 1) return;
      const hourUtc = parseInt(process.env.MONTHLY_POOP_GAME_REPORT_HOUR_UTC || '8', 10);
      if (now.getUTCHours() < hourUtc) return;
      // Report first (reads last month's rows), then reset high scores for the new month.
      const result = await runMonthlyPoopGameTop3Report();
      if (result.sent) console.log('[MonthlyPoopGame] Report sent:', result.jobId);
      else if (result.skipped) console.log('[MonthlyPoopGame] Skip:', result.skipped, result.jobId);

      await runMonthlyLeaderboardReset();
    } catch (e) {
      console.error('[MonthlyPoopGame] Scheduled run failed:', e);
    }
  };

  const hourMs = 60 * 60 * 1000;
  setTimeout(() => {
    tick();
    setInterval(tick, hourMs);
  }, 5000);
}
