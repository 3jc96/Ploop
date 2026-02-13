import express, { Request, Response } from 'express';
import { body, param, validationResult } from 'express-validator';
import { v4 as uuidv4 } from 'uuid';
import pool from '../config/database';

const router = express.Router();

function getDeviceId(req: Request): string | null {
  const raw = (req.header('x-ploop-device-id') || req.header('X-Ploop-Device-Id') || '').trim();
  return raw ? raw : null;
}

// List latest hints for a toilet
router.get('/:toiletId', [param('toiletId').isUUID()], async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const { toiletId } = req.params;
    const result = await pool.query(
      `
      SELECT id, hint_text, created_at
      FROM toilet_hints
      WHERE toilet_id = $1
      ORDER BY created_at DESC
      LIMIT 20
      `,
      [toiletId]
    );
    res.json({ toiletId, hints: result.rows });
  } catch (e) {
    console.error('Error listing hints:', e);
    res.status(500).json({ error: 'Failed to list hints' });
  }
});

// Add a hint (device-based; no auth)
router.post(
  '/:toiletId',
  [param('toiletId').isUUID(), body('text').isString().trim().isLength({ min: 3, max: 240 })],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const deviceId = getDeviceId(req);
      if (!deviceId) return res.status(400).json({ error: 'Missing X-Ploop-Device-Id' });

      const { toiletId } = req.params;
      const { text } = req.body as { text: string };

      const id = uuidv4();
      const result = await pool.query(
        `
        INSERT INTO toilet_hints (id, toilet_id, hint_text, created_by_device)
        VALUES ($1, $2, $3, $4)
        RETURNING id, hint_text, created_at
        `,
        [id, toiletId, text.trim(), deviceId]
      );

      res.status(201).json({ hint: result.rows[0] });
    } catch (e) {
      console.error('Error adding hint:', e);
      res.status(500).json({ error: 'Failed to add hint' });
    }
  }
);

export default router;

