/**
 * Golden Toilet Hunt API
 *
 * GET  /api/hunt/status                  – hunt state + countdown/remaining counts
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
