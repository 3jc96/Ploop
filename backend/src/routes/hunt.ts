/**
 * Golden Toilet Hunt API
 *
 * GET  /api/hunt/status                  – hunt state + countdown/remaining counts
 * GET  /api/hunt/leaderboard             – top hunters by golden toilets found
 * GET  /api/hunt/me                      – current user/device hunt progress + rank
 * POST /api/hunt/register-push-token     – register device push token for notifications
 * POST /api/hunt/admin/place             – (admin) manually trigger golden toilet placement
 */
import express, { Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { v4 as uuidv4 } from 'uuid';
import pool from '../config/database';
import { optionalAuth, requireAdmin } from '../middleware/auth';
import { nextHuntStart, placeGoldenToilets } from '../jobs/goldenToiletHunt';

const router = express.Router();

const HUNT_DURATION_DAYS = 21;
const NOTIFY_DAYS_BEFORE = 7;

// GET /api/hunt/status
router.get('/status', optionalAuth, async (_req: Request, res: Response) => {
  try {
    const now = new Date();

    // Check for active hunt
    const { rows: activeHunts } = await pool.query<{
      id: string; month_key: string; starts_at: string; ends_at: string;
    }>(
      'SELECT id, month_key, starts_at, ends_at FROM golden_hunts WHERE starts_at <= now() AND ends_at >= now() LIMIT 1',
    );

    if (activeHunts.length > 0) {
      const hunt = activeHunts[0];
      const { rows: cityRows } = await pool.query<{ city: string; remaining: string }>(
        `SELECT city,
                SUM(CASE WHEN is_found THEN 0 ELSE 1 END)::int AS remaining
         FROM golden_hunt_toilets
         WHERE hunt_id = $1
         GROUP BY city
         ORDER BY city`,
        [hunt.id],
      );
      const goldenToiletsRemaining: Record<string, number> = {};
      for (const row of cityRows) {
        goldenToiletsRemaining[row.city] = parseInt(row.remaining, 10);
      }
      return res.json({
        active: true,
        daysUntilStart: null,
        goldenToiletsRemaining,
        startsAt: null,
        endsAt: hunt.ends_at,
      });
    }

    // Not active — compute countdown
    const next5th = nextHuntStart(now);
    const diffMs = next5th.getTime() - now.getTime();
    const daysUntilStart = Math.ceil(diffMs / 86_400_000);

    res.json({
      active: false,
      daysUntilStart,
      goldenToiletsRemaining: null,
      startsAt: next5th.toISOString(),
      endsAt: null,
    });
  } catch (e) {
    console.error('[Hunt] status error:', e);
    res.status(500).json({ error: 'Failed to fetch hunt status' });
  }
});

// GET /api/hunt/leaderboard — top hunters by distinct golden toilets found.
// Aggregates golden_hunt_checkins by hunter (user_id when present, else device_id).
router.get('/leaderboard', optionalAuth, async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Math.max(parseInt((req.query.limit as string) || '20', 10) || 20, 1), 100);
    const scope = (req.query.scope as string) === 'all' ? 'all' : 'current';

    // Restrict to current/most-recent hunt unless scope=all
    let huntFilter = '';
    const params: any[] = [limit];
    if (scope === 'current') {
      const { rows: hunts } = await pool.query<{ id: string }>(
        `SELECT id FROM golden_hunts
         ORDER BY (starts_at <= now() AND ends_at >= now()) DESC, starts_at DESC
         LIMIT 1`,
      );
      if (hunts.length > 0) {
        huntFilter = 'WHERE ghc.hunt_id = $2';
        params.push(hunts[0].id);
      }
    }

    const { rows } = await pool.query<{
      hunter_key: string;
      display_name: string | null;
      found: number;
      last_found: string;
    }>(
      `SELECT
         COALESCE(ghc.user_id::text, 'device:' || ghc.device_id) AS hunter_key,
         COALESCE(MAX(ghc.user_name), 'Anonymous hunter') AS display_name,
         COUNT(DISTINCT ghc.golden_hunt_toilet_id)::int AS found,
         MAX(ghc.checked_in_at) AS last_found
       FROM golden_hunt_checkins ghc
       ${huntFilter}
       GROUP BY hunter_key
       ORDER BY found DESC, last_found ASC
       LIMIT $1`,
      params,
    );

    const leaders = rows.map((r, i) => ({
      rank: i + 1,
      displayName: r.display_name || 'Anonymous hunter',
      found: r.found,
      lastFoundAt: r.last_found,
    }));

    res.json({ scope, leaders });
  } catch (e) {
    console.error('[Hunt] leaderboard error:', e);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

// GET /api/hunt/me — the caller's hunt progress (found count + rank) for the
// current/most-recent hunt. Identified by user_id (if logged in) or device id.
router.get('/me', optionalAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id ?? null;
    const deviceId = (req.header('x-ploop-device-id') || req.header('X-Ploop-Device-Id') || '').trim();
    if (!userId && !deviceId) {
      return res.json({ found: 0, totalGolden: null, rank: null, percentile: null });
    }

    const { rows: hunts } = await pool.query<{ id: string }>(
      `SELECT id FROM golden_hunts
       ORDER BY (starts_at <= now() AND ends_at >= now()) DESC, starts_at DESC
       LIMIT 1`,
    );
    if (hunts.length === 0) {
      return res.json({ found: 0, totalGolden: null, rank: null, percentile: null });
    }
    const huntId = hunts[0].id;

    const hunterKey = userId ? `${userId}` : `device:${deviceId}`;
    const matchExpr = userId
      ? `ghc.user_id = $2`
      : `(ghc.user_id IS NULL AND ghc.device_id = $2)`;
    const matchVal = userId ? userId : deviceId;

    const { rows: foundRows } = await pool.query<{ found: number }>(
      `SELECT COUNT(DISTINCT ghc.golden_hunt_toilet_id)::int AS found
       FROM golden_hunt_checkins ghc
       WHERE ghc.hunt_id = $1 AND ${matchExpr}`,
      [huntId, matchVal],
    );
    const found = foundRows[0]?.found ?? 0;

    const { rows: totalRows } = await pool.query<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM golden_hunt_toilets WHERE hunt_id = $1`,
      [huntId],
    );
    const totalGolden = totalRows[0]?.total ?? 0;

    // Rank among all hunters this hunt
    const { rows: rankRows } = await pool.query<{ hunter_key: string; found: number }>(
      `SELECT COALESCE(ghc.user_id::text, 'device:' || ghc.device_id) AS hunter_key,
              COUNT(DISTINCT ghc.golden_hunt_toilet_id)::int AS found
       FROM golden_hunt_checkins ghc
       WHERE ghc.hunt_id = $1
       GROUP BY hunter_key
       ORDER BY found DESC`,
      [huntId],
    );
    const totalHunters = rankRows.length;
    const idx = rankRows.findIndex((r) => r.hunter_key === hunterKey);
    const rank = idx >= 0 ? idx + 1 : null;
    const percentile =
      rank != null && totalHunters > 0 ? Math.max(1, Math.round((rank / totalHunters) * 100)) : null;

    res.json({ found, totalGolden, rank, percentile, totalHunters });
  } catch (e) {
    console.error('[Hunt] me error:', e);
    res.status(500).json({ error: 'Failed to fetch hunt progress' });
  }
});

// POST /api/hunt/register-push-token
router.post(
  '/register-push-token',
  [body('pushToken').isString().trim().notEmpty()],
  optionalAuth,
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const pushToken = (req.body.pushToken as string).trim();
      const deviceId = (req.header('x-ploop-device-id') || req.header('X-Ploop-Device-Id') || '').trim();
      if (!deviceId) return res.status(400).json({ error: 'Missing X-Ploop-Device-Id header' });

      const userId = (req as any).user?.id ?? null;

      await pool.query(
        `INSERT INTO user_push_tokens (device_id, user_id, push_token, updated_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (device_id) DO UPDATE
           SET push_token = EXCLUDED.push_token,
               user_id = COALESCE(EXCLUDED.user_id, user_push_tokens.user_id),
               updated_at = now()`,
        [deviceId, userId, pushToken],
      );

      res.status(201).json({ ok: true });
    } catch (e) {
      console.error('[Hunt] register-push-token error:', e);
      res.status(500).json({ error: 'Failed to register push token' });
    }
  },
);

// POST /api/hunt/admin/place — manual trigger for testing / emergency placement
router.post('/admin/place', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    const startsAt = new Date(Date.UTC(y, m, 5));
    const endsAt = new Date(startsAt.getTime() + HUNT_DURATION_DAYS * 86_400_000);
    const notifyAt = new Date(startsAt.getTime() - NOTIFY_DAYS_BEFORE * 86_400_000);
    const monthKey = `${y}-${String(m + 1).padStart(2, '0')}`;

    const result = await placeGoldenToilets(monthKey, startsAt, endsAt, notifyAt);
    res.json(result);
  } catch (e) {
    console.error('[Hunt] admin/place error:', e);
    res.status(500).json({ error: 'Failed to place golden toilets' });
  }
});

export default router;
