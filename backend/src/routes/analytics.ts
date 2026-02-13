import express, { Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { v4 as uuidv4 } from 'uuid';
import pool from '../config/database';

const router = express.Router();

// Accept a lightweight analytics event.
// We intentionally keep this permissive and privacy-conscious:
// - device_id is optional (but recommended)
// - payload is arbitrary JSON
router.post(
  '/',
  [
    body('event').isString().trim().notEmpty(),
    body('payload').optional(),
    body('deviceId').optional().isString().trim(),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { event, payload, deviceId } = req.body as { event: string; payload?: any; deviceId?: string };

    try {
      const id = uuidv4();
      await pool.query(
        `
        INSERT INTO analytics_events (id, device_id, event_name, payload)
        VALUES ($1, $2, $3, $4)
        `,
        [id, deviceId || null, event, payload !== undefined ? payload : null]
      );

      res.status(201).json({ ok: true });
    } catch (e) {
      console.error('Error saving analytics event:', e);
      res.status(500).json({ error: 'Failed to save analytics event' });
    }
  }
);

export default router;

