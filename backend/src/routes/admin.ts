import express, { Request, Response } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import pool from '../config/database';
import { requireAuth, requireAdmin } from '../middleware/auth';

const router = express.Router();

router.use(requireAuth);
router.use(requireAdmin);

// GET /api/admin/analytics/dashboard – charts & aggregates with date filters
router.get(
  '/analytics/dashboard',
  [
    query('from').optional().isISO8601(),
    query('to').optional().isISO8601(),
    query('groupBy').optional().isIn(['day', 'week', 'month']),
  ],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      const from = req.query.from as string | undefined;
      const to = req.query.to as string | undefined;
      const groupBy = (req.query.groupBy as string) || 'day';

      const fromDate = from ? new Date(from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const toDate = to ? new Date(to) : new Date();
      const fromStr = fromDate.toISOString();
      const toStr = toDate.toISOString();

      const interval = groupBy === 'week' ? 'week' : groupBy === 'month' ? 'month' : 'day';
      const dateTrunc = interval === 'week' ? "date_trunc('week', reviewed_at)::date" : interval === 'month' ? "date_trunc('month', reviewed_at)::date" : "date_trunc('day', reviewed_at)::date";

      // Totals (all-time and in range)
      const [totalsRes, reviewsSeriesRes, toiletsSeriesRes, topToiletsRes, eventsRes, usersSeriesRes] = await Promise.all([
        pool.query(
          `SELECT
            (SELECT COUNT(*)::int FROM users) AS total_users,
            (SELECT COUNT(*)::int FROM toilets WHERE is_active = true) AS total_toilets,
            (SELECT COUNT(*)::int FROM toilet_reviews) AS total_reviews,
            (SELECT COUNT(*)::int FROM toilet_favorites) AS total_favorites`
        ),
        pool.query(
          `SELECT ${dateTrunc} AS period, COUNT(*)::int AS count
           FROM toilet_reviews WHERE reviewed_at >= $1 AND reviewed_at <= $2
           GROUP BY 1 ORDER BY 1`,
          [fromStr, toStr]
        ),
        pool.query(
          `SELECT date_trunc('day', created_at)::date AS period, COUNT(*)::int AS count
           FROM toilets WHERE is_active = true AND created_at >= $1 AND created_at <= $2
           GROUP BY 1 ORDER BY 1`,
          [fromStr, toStr]
        ),
        pool.query(
          `SELECT t.id, t.name, t.address, t.total_reviews, t.cleanliness_score, t.smell_score
           FROM toilets t WHERE t.is_active = true AND t.total_reviews > 0
           ORDER BY t.total_reviews DESC LIMIT 10`
        ),
        pool.query(
          `SELECT event_name, COUNT(*)::int AS count
           FROM analytics_events WHERE created_at >= $1 AND created_at <= $2
           GROUP BY event_name ORDER BY count DESC LIMIT 15`,
          [fromStr, toStr]
        ),
        pool.query(
          `SELECT date_trunc('day', created_at)::date AS period, COUNT(*)::int AS count
           FROM users WHERE created_at >= $1 AND created_at <= $2
           GROUP BY 1 ORDER BY 1`,
          [fromStr, toStr]
        ),
      ]);

      const totals = totalsRes.rows[0] || {};
      let checkInsByHour: Array<{ hour: number; count: number }> = [];
      let checkInsInRange = 0;
      let totalCheckins = 0;
      try {
        const [checkInsHourRes, checkInsRangeRes, checkInsTotalRes] = await Promise.all([
          pool.query(
            `SELECT EXTRACT(HOUR FROM checked_in_at)::int AS hour, COUNT(*)::int AS count
             FROM toilet_checkins WHERE checked_in_at >= $1 AND checked_in_at <= $2
             GROUP BY 1 ORDER BY 1`,
            [fromStr, toStr]
          ),
          pool.query('SELECT COUNT(*)::int AS c FROM toilet_checkins WHERE checked_in_at >= $1 AND checked_in_at <= $2', [fromStr, toStr]),
          pool.query('SELECT COUNT(*)::int AS c FROM toilet_checkins'),
        ]);
        checkInsByHour = (checkInsHourRes.rows || []).map((r: any) => ({ hour: r.hour, count: r.count }));
        checkInsInRange = checkInsRangeRes.rows[0]?.c ?? 0;
        totalCheckins = checkInsTotalRes.rows[0]?.c ?? 0;
      } catch {
        // toilet_checkins table may not exist yet
      }
      const reviewsSeries = (reviewsSeriesRes.rows || []).map((r: any) => ({ period: r.period, count: r.count }));
      const toiletsSeries = (toiletsSeriesRes.rows || []).map((r: any) => ({ period: r.period, count: r.count }));
      const usersSeries = (usersSeriesRes.rows || []).map((r: any) => ({ period: r.period, count: r.count }));
      const topToilets = topToiletsRes.rows || [];
      const eventsByType = (eventsRes.rows || []).map((r: any) => ({ event: r.event_name, count: r.count }));

      // In-range totals
      const [reviewsInRange, toiletsInRange, usersInRange] = await Promise.all([
        pool.query('SELECT COUNT(*)::int AS c FROM toilet_reviews WHERE reviewed_at >= $1 AND reviewed_at <= $2', [fromStr, toStr]),
        pool.query('SELECT COUNT(*)::int AS c FROM toilets WHERE is_active = true AND created_at >= $1 AND created_at <= $2', [fromStr, toStr]),
        pool.query('SELECT COUNT(*)::int AS c FROM users WHERE created_at >= $1 AND created_at <= $2', [fromStr, toStr]),
      ]);

      res.json({
        from: fromStr,
        to: toStr,
        groupBy,
        totals: {
          users: totals.total_users ?? 0,
          toilets: totals.total_toilets ?? 0,
          reviews: totals.total_reviews ?? 0,
          favorites: totals.total_favorites ?? 0,
          checkins: totalCheckins,
        },
        inRange: {
          reviews: reviewsInRange.rows[0]?.c ?? 0,
          toilets: toiletsInRange.rows[0]?.c ?? 0,
          users: usersInRange.rows[0]?.c ?? 0,
          checkins: checkInsInRange,
        },
        checkInsByHour,
        series: {
          reviews: reviewsSeries,
          toilets: toiletsSeries,
          users: usersSeries,
        },
        topToilets,
        eventsByType,
      });
    } catch (e) {
      console.error('Admin analytics:', e);
      res.status(500).json({ error: 'Failed to load analytics' });
    }
  }
);

// GET /api/admin/reviews – list recent reviews for moderation (paginated)
router.get(
  '/reviews',
  [
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('offset').optional().isInt({ min: 0 }),
  ],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      const limit = Math.min(Number(req.query.limit) || 100, 500);
      const offset = Number(req.query.offset) || 0;
      const result = await pool.query(
        `SELECT r.id, r.toilet_id, r.cleanliness_score, r.smell_score, r.review_text, r.reviewed_at, r.reviewed_by, r.user_id,
                u.email AS user_email, u.display_name AS user_display_name,
                t.name AS toilet_name, t.address AS toilet_address
         FROM toilet_reviews r
         LEFT JOIN users u ON r.user_id = u.id
         LEFT JOIN toilets t ON r.toilet_id = t.id
         ORDER BY r.reviewed_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      );
      const countResult = await pool.query('SELECT COUNT(*)::int AS total FROM toilet_reviews');
      res.json({
        reviews: result.rows,
        total: countResult.rows[0]?.total ?? 0,
      });
    } catch (e) {
      console.error('Admin list reviews:', e);
      res.status(500).json({ error: 'Failed to list reviews' });
    }
  }
);

// PATCH /api/admin/reviews/:id – edit a review (moderation) and optionally the toilet name
router.patch(
  '/reviews/:id',
  [
    param('id').isUUID(),
    body('cleanliness_score').optional().isInt({ min: 1, max: 5 }),
    body('smell_score').optional().isInt({ min: 1, max: 5 }),
    body('review_text').optional().isString().trim(),
    body('reviewed_by').optional().isString().trim(),
    body('toilet_name').optional().isString().trim(),
  ],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      const { id } = req.params;
      const { cleanliness_score, smell_score, review_text, reviewed_by, toilet_name } = req.body;

      const updates: string[] = [];
      const values: any[] = [];
      let idx = 1;
      if (cleanliness_score !== undefined) {
        updates.push(`cleanliness_score = $${idx++}`);
        values.push(cleanliness_score);
      }
      if (smell_score !== undefined) {
        updates.push(`smell_score = $${idx++}`);
        values.push(smell_score);
      }
      if (review_text !== undefined) {
        updates.push(`review_text = $${idx++}`);
        values.push(review_text);
      }
      if (reviewed_by !== undefined) {
        updates.push(`reviewed_by = $${idx++}`);
        values.push(reviewed_by);
      }
      if (updates.length === 0 && !toilet_name) {
        return res.status(400).json({ error: 'No fields to update' });
      }

      if (updates.length > 0) {
        values.push(id);
        const result = await pool.query(
          `UPDATE toilet_reviews SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
          values
        );
        if (result.rowCount === 0) {
          return res.status(404).json({ error: 'Review not found' });
        }
      }

      if (toilet_name !== undefined && toilet_name !== '') {
        const reviewRow = await pool.query(
          'SELECT toilet_id FROM toilet_reviews WHERE id = $1',
          [id]
        );
        if (reviewRow.rows.length > 0) {
          await pool.query(
            'UPDATE toilets SET name = $1, updated_at = now() WHERE id = $2',
            [toilet_name.trim(), reviewRow.rows[0].toilet_id]
          );
        }
      }

      const reviewResult = await pool.query(
        'SELECT * FROM toilet_reviews WHERE id = $1',
        [id]
      );
      if (reviewResult.rows.length === 0) {
        return res.status(404).json({ error: 'Review not found' });
      }
      res.json({ review: reviewResult.rows[0] });
    } catch (e) {
      console.error('Admin update review:', e);
      res.status(500).json({ error: 'Failed to update review' });
    }
  }
);

// DELETE /api/admin/reviews/:id – remove a review (moderation)
router.delete(
  '/reviews/:id',
  [param('id').isUUID()],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      const { id } = req.params;
      const result = await pool.query('DELETE FROM toilet_reviews WHERE id = $1 RETURNING id', [id]);
      if (result.rowCount === 0) {
        return res.status(404).json({ error: 'Review not found' });
      }
      res.json({ ok: true, deleted: id });
    } catch (e) {
      console.error('Admin delete review:', e);
      res.status(500).json({ error: 'Failed to delete review' });
    }
  }
);

// GET /api/admin/diagnostics – load diagnostics (Android vs iOS timing)
router.get('/diagnostics', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.query?.limit) || 100, 500);
    const platform = req.query?.platform as string | undefined;
    const result = platform
      ? await pool.query(
          `SELECT id, device_id, platform, permission_ms, location_source, location_ms, api_ms, total_ms, success, created_at
           FROM load_diagnostics WHERE platform = $2 ORDER BY created_at DESC LIMIT $1`,
          [limit, platform]
        )
      : await pool.query(
          `SELECT id, device_id, platform, permission_ms, location_source, location_ms, api_ms, total_ms, success, created_at
           FROM load_diagnostics ORDER BY created_at DESC LIMIT $1`,
          [limit]
        );
    const summary = await pool.query(
      `SELECT platform,
              COUNT(*)::int AS count,
              ROUND(AVG(permission_ms))::int AS avg_perm_ms,
              ROUND(AVG(location_ms))::int AS avg_loc_ms,
              ROUND(AVG(api_ms))::int AS avg_api_ms,
              ROUND(AVG(total_ms))::int AS avg_total_ms
       FROM load_diagnostics
       WHERE created_at >= now() - interval '7 days'
       GROUP BY platform`
    );
    res.json({
      summary: summary.rows,
      recent: result.rows,
    });
  } catch (e) {
    console.error('Admin get diagnostics:', e);
    res.status(500).json({ error: 'Failed to load diagnostics' });
  }
});

// GET /api/admin/crash-reports – recent crash reports
router.get('/crash-reports', async (_req: Request, res: Response) => {
  try {
    const limit = Math.min(Number((_req as any).query?.limit) || 50, 200);
    const result = await pool.query(
      `SELECT id, device_id, platform, app_version, error_message, error_stack, component_stack, created_at
       FROM crash_reports
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );
    res.json({ crashReports: result.rows });
  } catch (e) {
    console.error('Admin get crash reports:', e);
    res.status(500).json({ error: 'Failed to load crash reports' });
  }
});

// POST /api/admin/register-push-token – store Expo push token for suggestion notifications
router.post(
  '/register-push-token',
  [body('token').isString().trim().notEmpty()],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      const token = (req.body.token as string).trim();
      const user = (req as any).user;
      const email = user?.email?.toLowerCase?.() || '';
      if (!email) return res.status(400).json({ error: 'User email required' });
      await pool.query(
        `INSERT INTO admin_push_tokens (email, token) VALUES ($1, $2)
         ON CONFLICT (token) DO UPDATE SET email = EXCLUDED.email, created_at = now()`,
        [email, token]
      );
      res.json({ ok: true });
    } catch (e) {
      console.error('Admin register push token:', e);
      res.status(500).json({ error: 'Failed to register push token' });
    }
  }
);

export default router;
