import express, { Request, Response } from 'express';
import { body, param, validationResult } from 'express-validator';
import { v4 as uuidv4 } from 'uuid';
import pool from '../config/database';

const router = express.Router();

const REPORT_TYPES = ['closed', 'out_of_order', 'no_access', 'gross', 'busy'] as const;
type ReportType = (typeof REPORT_TYPES)[number];

function getDeviceId(req: Request): string | null {
  const raw = (req.header('x-ploop-device-id') || req.header('X-Ploop-Device-Id') || '').trim();
  return raw ? raw : null;
}

function expiryFor(type: ReportType): number {
  // seconds
  switch (type) {
    case 'busy':
      return 45 * 60; // 45m
    case 'gross':
      return 6 * 60 * 60; // 6h
    case 'closed':
      return 10 * 60 * 60; // 10h
    case 'out_of_order':
      return 18 * 60 * 60; // 18h
    case 'no_access':
      return 24 * 60 * 60; // 24h
    default:
      return 6 * 60 * 60;
  }
}

// List active reports for a toilet
router.get('/:toiletId', [param('toiletId').isUUID()], async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const { toiletId } = req.params;
    const result = await pool.query(
      `
      SELECT report_type, COUNT(*)::int as count, MAX(created_at) as last_at
      FROM toilet_reports
      WHERE toilet_id = $1 AND expires_at > now()
      GROUP BY report_type
      ORDER BY count DESC
      `,
      [toiletId]
    );

    res.json({ toiletId, reports: result.rows });
  } catch (e) {
    console.error('Error listing reports:', e);
    res.status(500).json({ error: 'Failed to list reports' });
  }
});

// Submit a report for a toilet
router.post(
  '/:toiletId',
  [
    param('toiletId').isUUID(),
    body('type').isIn(REPORT_TYPES as unknown as string[]),
    body('note').optional().isString().trim().isLength({ max: 240 }),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const deviceId = getDeviceId(req);
      if (!deviceId) return res.status(400).json({ error: 'Missing X-Ploop-Device-Id' });

      const { toiletId } = req.params;
      const { type, note } = req.body as { type: ReportType; note?: string };

      // Basic anti-spam: per-device cooldown per toilet+type
      const cooldownSeconds = 60 * 10; // 10 min
      const recent = await pool.query(
        `
        SELECT 1
        FROM toilet_reports
        WHERE toilet_id = $1
          AND report_type = $2
          AND reported_by_device = $3
          AND created_at > now() - ($4 || ' seconds')::interval
        LIMIT 1
        `,
        [toiletId, type, deviceId, cooldownSeconds]
      );
      if (recent.rows.length > 0) {
        return res.status(429).json({ error: 'Please wait before submitting the same report again.' });
      }

      const id = uuidv4();
      const expiresSeconds = expiryFor(type);
      const result = await pool.query(
        `
        INSERT INTO toilet_reports (id, toilet_id, report_type, note, reported_by_device, expires_at)
        VALUES ($1, $2, $3, $4, $5, now() + ($6 || ' seconds')::interval)
        RETURNING *
        `,
        [id, toiletId, type, note || null, deviceId, expiresSeconds]
      );

      res.status(201).json({ report: result.rows[0] });
    } catch (e) {
      console.error('Error submitting report:', e);
      res.status(500).json({ error: 'Failed to submit report' });
    }
  }
);

export default router;

