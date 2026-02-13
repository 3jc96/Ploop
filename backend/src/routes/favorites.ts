import express, { Request, Response } from 'express';
import { param, validationResult } from 'express-validator';
import pool from '../config/database';

const router = express.Router();

function getDeviceId(req: Request): string | null {
  const raw = (req.header('x-ploop-device-id') || req.header('X-Ploop-Device-Id') || '').trim();
  return raw ? raw : null;
}

// List favorites for this device (returns full toilet rows)
router.get('/', async (req: Request, res: Response) => {
  try {
    const deviceId = getDeviceId(req);
    if (!deviceId) return res.status(400).json({ error: 'Missing X-Ploop-Device-Id' });

    const result = await pool.query(
      `
      SELECT t.*, f.created_at as favorited_at
      FROM toilet_favorites f
      JOIN toilets t ON t.id = f.toilet_id
      WHERE f.device_id = $1 AND t.is_active = true
      ORDER BY f.created_at DESC
      LIMIT 200
      `,
      [deviceId]
    );

    res.json({ favorites: result.rows });
  } catch (e) {
    console.error('Error listing favorites:', e);
    res.status(500).json({ error: 'Failed to list favorites' });
  }
});

// Favorite a toilet
router.post('/:toiletId', [param('toiletId').isUUID()], async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const deviceId = getDeviceId(req);
    if (!deviceId) return res.status(400).json({ error: 'Missing X-Ploop-Device-Id' });

    const { toiletId } = req.params;
    await pool.query(
      `
      INSERT INTO toilet_favorites (device_id, toilet_id)
      VALUES ($1, $2)
      ON CONFLICT (device_id, toilet_id) DO NOTHING
      `,
      [deviceId, toiletId]
    );

    res.status(201).json({ ok: true });
  } catch (e) {
    console.error('Error favoriting:', e);
    res.status(500).json({ error: 'Failed to favorite' });
  }
});

// Unfavorite a toilet
router.delete('/:toiletId', [param('toiletId').isUUID()], async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const deviceId = getDeviceId(req);
    if (!deviceId) return res.status(400).json({ error: 'Missing X-Ploop-Device-Id' });

    const { toiletId } = req.params;
    await pool.query(`DELETE FROM toilet_favorites WHERE device_id = $1 AND toilet_id = $2`, [deviceId, toiletId]);

    res.json({ ok: true });
  } catch (e) {
    console.error('Error unfavoriting:', e);
    res.status(500).json({ error: 'Failed to unfavorite' });
  }
});

export default router;

