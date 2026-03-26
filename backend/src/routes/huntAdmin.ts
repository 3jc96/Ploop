/**
 * Admin — Golden Toilet Hunt management
 *
 * All routes require admin auth (enforced via router.use).
 *
 * GET  /api/admin/hunt/dashboard            – live hunt status + city progress
 * POST /api/admin/hunt/:huntId/pause        – pause active hunt
 * POST /api/admin/hunt/:huntId/resume       – resume paused hunt
 * POST /api/admin/hunt/:huntId/reroll/:city – re-roll 3 golden toilets for a city
 * POST /api/admin/hunt/notify               – manually send 1-week notification
 * GET  /api/admin/hunt/checkins             – paginated eligible check-ins
 * PATCH /api/admin/hunt/checkins/:id/voucher – mark voucher sent/unsent
 * GET  /api/admin/hunt/checkins/export      – CSV download
 */
import express, { Request, Response } from 'express';
import { param, query, body, validationResult } from 'express-validator';
import { v4 as uuidv4 } from 'uuid';
import pool from '../config/database';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { sendHuntNotifications, nextHuntStart } from '../jobs/goldenToiletHunt';

const router = express.Router();
router.use(requireAuth);
router.use(requireAdmin);

// ── Dashboard ────────────────────────────────────────────────────────────────

router.get('/dashboard', async (_req: Request, res: Response) => {
  try {
    // Most-recent hunt (active or last ended)
    const { rows: hunts } = await pool.query<{
      id: string; month_key: string; starts_at: string; ends_at: string;
      notify_at: string; notified_at: string | null; is_paused: boolean; created_at: string;
    }>(
      `SELECT id, month_key, starts_at, ends_at, notify_at, notified_at, is_paused, created_at
       FROM golden_hunts
       ORDER BY starts_at DESC
       LIMIT 1`,
    );

    if (hunts.length === 0) {
      const next5th = nextHuntStart();
      return res.json({ hunt: null, cities: [], totalFound: 0, totalToilets: 0, nextHuntAt: next5th });
    }

    const hunt = hunts[0];
    const now = new Date();
    const active =
      new Date(hunt.starts_at) <= now &&
      new Date(hunt.ends_at) >= now &&
      !hunt.is_paused;

    // City progress + toilet details
    const { rows: toiletRows } = await pool.query<{
      golden_toilet_id: string; toilet_id: string; city: string;
      toilet_name: string; is_found: boolean; found_at: string | null;
      checkin_count: string;
    }>(
      `SELECT ght.id AS golden_toilet_id, ght.toilet_id, ght.city,
              COALESCE(t.name, 'Unnamed') AS toilet_name,
              ght.is_found, ght.found_at,
              COUNT(ghc.id)::text AS checkin_count
       FROM golden_hunt_toilets ght
       JOIN toilets t ON t.id = ght.toilet_id
       LEFT JOIN golden_hunt_checkins ghc ON ghc.golden_hunt_toilet_id = ght.id
       WHERE ght.hunt_id = $1
       GROUP BY ght.id, ght.toilet_id, ght.city, t.name, ght.is_found, ght.found_at
       ORDER BY ght.city, ght.is_found DESC`,
      [hunt.id],
    );

    // City-level pause/end overrides
    const { rows: cityStatusRows } = await pool.query<{ city: string; is_paused: boolean; is_ended: boolean }>(
      'SELECT city, is_paused, is_ended FROM golden_hunt_city_status WHERE hunt_id = $1',
      [hunt.id],
    );
    const cityStatusMap: Record<string, { isPaused: boolean; isEnded: boolean }> = {};
    for (const s of cityStatusRows) {
      cityStatusMap[s.city] = { isPaused: s.is_paused, isEnded: s.is_ended };
    }

    // Group by city
    const cityMap: Record<string, {
      city: string; total: number; found: number; isPaused: boolean; isEnded: boolean;
      toilets: Array<{ goldenToiletId: string; toiletId: string; name: string; isFound: boolean; foundAt: string | null; checkinCount: number }>;
    }> = {};

    for (const row of toiletRows) {
      if (!cityMap[row.city]) {
        const cs = cityStatusMap[row.city] ?? { isPaused: false, isEnded: false };
        cityMap[row.city] = { city: row.city, total: 0, found: 0, isPaused: cs.isPaused, isEnded: cs.isEnded, toilets: [] };
      }
      cityMap[row.city].total++;
      if (row.is_found) cityMap[row.city].found++;
      cityMap[row.city].toilets.push({
        goldenToiletId: row.golden_toilet_id,
        toiletId: row.toilet_id,
        name: row.toilet_name,
        isFound: row.is_found,
        foundAt: row.found_at,
        checkinCount: parseInt(row.checkin_count, 10),
      });
    }

    const cities = Object.values(cityMap).sort((a, b) => a.city.localeCompare(b.city));
    const totalToilets = cities.reduce((s, c) => s + c.total, 0);
    const totalFound = cities.reduce((s, c) => s + c.found, 0);

    res.json({
      hunt: {
        id: hunt.id,
        monthKey: hunt.month_key,
        startsAt: hunt.starts_at,
        endsAt: hunt.ends_at,
        notifyAt: hunt.notify_at,
        notifiedAt: hunt.notified_at,
        isPaused: hunt.is_paused,
        active,
      },
      cities,
      totalFound,
      totalToilets,
      nextHuntAt: active ? null : nextHuntStart().toISOString(),
    });
  } catch (e) {
    console.error('[HuntAdmin] dashboard error:', e);
    res.status(500).json({ error: 'Failed to load hunt dashboard' });
  }
});

// ── Manual start ────────────────────────────────────────────────────────────

router.post(
  '/start',
  [body('durationDays').optional().isInt({ min: 1, max: 90 })],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const durationDays: number = req.body.durationDays ?? 21;
      const now = new Date();
      const startsAt = now;
      const endsAt = new Date(now.getTime() + durationDays * 86_400_000);
      const notifyAt = now; // already started — notify at is now
      const monthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

      // If a hunt for this month already exists, end it first and create a fresh one
      await pool.query(
        `UPDATE golden_hunts SET ends_at = now() WHERE month_key = $1 AND ends_at > now()`,
        [monthKey],
      );
      // Use a unique key if the month already has a record (append timestamp suffix)
      const existing = await pool.query('SELECT id FROM golden_hunts WHERE month_key = $1', [monthKey]);
      const finalKey = existing.rows.length > 0 ? `${monthKey}-${Date.now()}` : monthKey;

      const huntId = uuidv4();
      await pool.query(
        'INSERT INTO golden_hunts (id, month_key, starts_at, ends_at, notify_at) VALUES ($1, $2, $3, $4, $5)',
        [huntId, finalKey, startsAt.toISOString(), endsAt.toISOString(), notifyAt.toISOString()],
      );

      // Place 3 golden toilets per city
      const { rows: cities } = await pool.query<{ city: string }>(
        'SELECT DISTINCT city FROM toilets WHERE city IS NOT NULL AND is_active = true',
      );
      for (const { city } of cities) {
        const { rows: toilets } = await pool.query<{ id: string }>(
          'SELECT id FROM toilets WHERE city = $1 AND is_active = true ORDER BY RANDOM() LIMIT 3',
          [city],
        );
        for (const { id: toiletId } of toilets) {
          await pool.query(
            'INSERT INTO golden_hunt_toilets (id, hunt_id, toilet_id, city) VALUES ($1, $2, $3, $4)',
            [uuidv4(), huntId, toiletId, city],
          );
        }
      }

      console.log(`[HuntAdmin] Manual hunt started: ${finalKey}, ends ${endsAt.toISOString()}`);
      res.status(201).json({ ok: true, huntId, monthKey: finalKey, startsAt, endsAt, cities: cities.length });
    } catch (e) {
      console.error('[HuntAdmin] start error:', e);
      res.status(500).json({ error: 'Failed to start hunt' });
    }
  },
);

// ── Pause / Resume ───────────────────────────────────────────────────────────

router.post('/:huntId/pause', [param('huntId').isUUID()], async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    const { rowCount } = await pool.query(
      'UPDATE golden_hunts SET is_paused = true WHERE id = $1 RETURNING id',
      [req.params.huntId],
    );
    if (!rowCount) return res.status(404).json({ error: 'Hunt not found' });
    res.json({ ok: true, paused: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to pause hunt' });
  }
});

router.post('/:huntId/resume', [param('huntId').isUUID()], async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    const { rowCount } = await pool.query(
      'UPDATE golden_hunts SET is_paused = false WHERE id = $1 RETURNING id',
      [req.params.huntId],
    );
    if (!rowCount) return res.status(404).json({ error: 'Hunt not found' });
    res.json({ ok: true, paused: false });
  } catch (e) {
    res.status(500).json({ error: 'Failed to resume hunt' });
  }
});

// ── Re-roll city ─────────────────────────────────────────────────────────────

router.post(
  '/:huntId/reroll/:city',
  [param('huntId').isUUID(), param('city').isString().trim().notEmpty()],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const { huntId, city } = req.params;
    const decodedCity = decodeURIComponent(city);
    try {
      // Delete existing golden toilets for this city in this hunt
      await pool.query(
        'DELETE FROM golden_hunt_toilets WHERE hunt_id = $1 AND city = $2',
        [huntId, decodedCity],
      );

      // Pick 3 new random toilets
      const { rows: toilets } = await pool.query<{ id: string }>(
        'SELECT id FROM toilets WHERE city = $1 AND is_active = true ORDER BY RANDOM() LIMIT 3',
        [decodedCity],
      );

      if (toilets.length === 0) return res.status(404).json({ error: `No active toilets in ${decodedCity}` });

      for (const { id: toiletId } of toilets) {
        await pool.query(
          'INSERT INTO golden_hunt_toilets (id, hunt_id, toilet_id, city) VALUES ($1, $2, $3, $4)',
          [uuidv4(), huntId, toiletId, decodedCity],
        );
      }

      res.json({ ok: true, city: decodedCity, count: toilets.length });
    } catch (e) {
      console.error('[HuntAdmin] reroll error:', e);
      res.status(500).json({ error: 'Failed to re-roll golden toilets' });
    }
  },
);

// ── City-level pause / resume / end ──────────────────────────────────────────

const cityActionValidator = [param('huntId').isUUID(), param('city').isString().trim().notEmpty()];

async function setCityStatus(
  huntId: string, city: string,
  isPaused: boolean, isEnded: boolean,
  res: Response,
) {
  try {
    await pool.query(
      `INSERT INTO golden_hunt_city_status (hunt_id, city, is_paused, is_ended, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (hunt_id, city) DO UPDATE
         SET is_paused = EXCLUDED.is_paused,
             is_ended  = EXCLUDED.is_ended,
             updated_at = now()`,
      [huntId, city, isPaused, isEnded],
    );
    res.json({ ok: true, city, isPaused, isEnded });
  } catch (e) {
    console.error('[HuntAdmin] city status error:', e);
    res.status(500).json({ error: 'Failed to update city status' });
  }
}

router.post('/:huntId/cities/:city/pause', cityActionValidator, async (req: Request, res: Response) => {
  if (!validationResult(req).isEmpty()) return res.status(400).json({ error: 'Invalid params' });
  await setCityStatus(req.params.huntId, decodeURIComponent(req.params.city), true, false, res);
});

router.post('/:huntId/cities/:city/resume', cityActionValidator, async (req: Request, res: Response) => {
  if (!validationResult(req).isEmpty()) return res.status(400).json({ error: 'Invalid params' });
  await setCityStatus(req.params.huntId, decodeURIComponent(req.params.city), false, false, res);
});

router.post('/:huntId/cities/:city/end', cityActionValidator, async (req: Request, res: Response) => {
  if (!validationResult(req).isEmpty()) return res.status(400).json({ error: 'Invalid params' });
  await setCityStatus(req.params.huntId, decodeURIComponent(req.params.city), false, true, res);
});

// ── Manual notification ──────────────────────────────────────────────────────

router.post('/notify', async (_req: Request, res: Response) => {
  try {
    // Find the next or current hunt
    const { rows } = await pool.query<{ id: string; month_key: string; starts_at: string }>(
      `SELECT id, month_key, starts_at FROM golden_hunts
       WHERE starts_at >= now() OR (starts_at <= now() AND ends_at >= now())
       ORDER BY starts_at ASC LIMIT 1`,
    );

    if (rows.length === 0) return res.status(404).json({ error: 'No upcoming or active hunt found' });

    const hunt = rows[0];
    // Force re-send by deleting the idempotency record
    await pool.query(
      'DELETE FROM scheduled_job_runs WHERE job_id = $1',
      [`golden_hunt_notify:${hunt.month_key}`],
    );
    await pool.query('UPDATE golden_hunts SET notified_at = NULL WHERE id = $1', [hunt.id]);

    await sendHuntNotifications({ id: hunt.id, monthKey: hunt.month_key, startsAt: new Date(hunt.starts_at) });
    res.json({ ok: true, sentFor: hunt.month_key });
  } catch (e) {
    console.error('[HuntAdmin] notify error:', e);
    res.status(500).json({ error: 'Failed to send notifications' });
  }
});

// ── Check-ins list ───────────────────────────────────────────────────────────

router.get(
  '/checkins',
  [
    query('offset').optional().isInt({ min: 0 }),
    query('limit').optional().isInt({ min: 1, max: 200 }),
    query('huntId').optional().isUUID(),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const offset = parseInt((req.query.offset as string) || '0', 10);
      const limit = parseInt((req.query.limit as string) || '100', 10);
      const huntId = req.query.huntId as string | undefined;

      const whereClause = huntId ? 'WHERE ghc.hunt_id = $3' : '';
      const params: any[] = [limit, offset, ...(huntId ? [huntId] : [])];

      const { rows } = await pool.query(
        `SELECT ghc.id, ghc.hunt_id, gh.month_key,
                ghc.user_name, ghc.user_email, ghc.device_id,
                ghc.checked_in_at, ghc.voucher_sent, ghc.voucher_sent_at,
                t.name AS toilet_name, ghc.toilet_id,
                ght.city
         FROM golden_hunt_checkins ghc
         JOIN golden_hunts gh ON gh.id = ghc.hunt_id
         JOIN golden_hunt_toilets ght ON ght.id = ghc.golden_hunt_toilet_id
         JOIN toilets t ON t.id = ghc.toilet_id
         ${whereClause}
         ORDER BY ghc.checked_in_at DESC
         LIMIT $1 OFFSET $2`,
        params,
      );

      const { rows: totalRows } = await pool.query(
        `SELECT COUNT(*)::int AS total FROM golden_hunt_checkins ghc ${huntId ? 'WHERE ghc.hunt_id = $1' : ''}`,
        huntId ? [huntId] : [],
      );

      res.json({ checkins: rows, total: totalRows[0].total, offset, limit });
    } catch (e) {
      console.error('[HuntAdmin] checkins error:', e);
      res.status(500).json({ error: 'Failed to fetch check-ins' });
    }
  },
);

// ── Mark voucher sent/unsent ─────────────────────────────────────────────────

router.patch(
  '/checkins/:id/voucher',
  [param('id').isUUID(), body('sent').isBoolean()],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const sent = Boolean(req.body.sent);
      const { rowCount } = await pool.query(
        `UPDATE golden_hunt_checkins
         SET voucher_sent = $1, voucher_sent_at = $2
         WHERE id = $3`,
        [sent, sent ? new Date().toISOString() : null, req.params.id],
      );
      if (!rowCount) return res.status(404).json({ error: 'Check-in not found' });
      res.json({ ok: true, voucherSent: sent });
    } catch (e) {
      res.status(500).json({ error: 'Failed to update voucher status' });
    }
  },
);

// ── CSV export ───────────────────────────────────────────────────────────────

router.get('/checkins/export', async (_req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT gh.month_key, ght.city, t.name AS toilet_name,
              ghc.user_name, ghc.user_email, ghc.device_id,
              ghc.checked_in_at, ghc.voucher_sent, ghc.voucher_sent_at
       FROM golden_hunt_checkins ghc
       JOIN golden_hunts gh ON gh.id = ghc.hunt_id
       JOIN golden_hunt_toilets ght ON ght.id = ghc.golden_hunt_toilet_id
       JOIN toilets t ON t.id = ghc.toilet_id
       ORDER BY ghc.checked_in_at DESC`,
    );

    const header = 'Month,City,Toilet,Name,Email,Device,Checked In At,Voucher Sent,Voucher Sent At\n';
    const csvRows = rows.map((r) =>
      [
        r.month_key,
        r.city,
        `"${(r.toilet_name || '').replace(/"/g, '""')}"`,
        `"${(r.user_name || '').replace(/"/g, '""')}"`,
        r.user_email || '',
        r.device_id || '',
        r.checked_in_at ? new Date(r.checked_in_at).toISOString() : '',
        r.voucher_sent ? 'Yes' : 'No',
        r.voucher_sent_at ? new Date(r.voucher_sent_at).toISOString() : '',
      ].join(',')
    );

    const csv = header + csvRows.join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="ploop-golden-hunt-checkins.csv"`);
    res.send(csv);
  } catch (e) {
    console.error('[HuntAdmin] export error:', e);
    res.status(500).json({ error: 'Failed to export' });
  }
});

export default router;
