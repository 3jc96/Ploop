/**
 * User suggestions – 40 chars max, sent to admin via email and push notification.
 */
import express, { Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { v4 as uuidv4 } from 'uuid';
import pool from '../config/database';
import { optionalAuth } from '../middleware/auth';
import { sendEmailToAdmins } from '../utils/adminEmail';

const router = express.Router();

async function sendPushToAdmins(title: string, body: string): Promise<void> {
  try {
    const { rows } = await pool.query<{ token: string }>(
      'SELECT token FROM admin_push_tokens WHERE token IS NOT NULL AND token != \'\''
    );
    if (rows.length === 0) return;
    const messages = rows.map((r) => ({
      to: r.token,
      title,
      body,
      sound: 'default',
    }));
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(messages),
    });
    if (!res.ok) console.error('[Suggestions] Push failed:', res.status, await res.text());
  } catch (e) {
    console.error('[Suggestions] Push failed:', e);
  }
}

// POST /api/suggestions – submit a suggestion (40 chars max)
router.post(
  '/',
  [body('text').isString().trim().isLength({ min: 1, max: 40 })],
  optionalAuth,
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      const text = (req.body.text as string).trim();
      const userId = (req as any).user?.id ?? null;
      const deviceId = (req.header('x-ploop-device-id') || req.header('X-Ploop-Device-Id') || '').trim() || null;

      const id = uuidv4();
      await pool.query(
        'INSERT INTO suggestions (id, text, user_id, device_id) VALUES ($1, $2, $3, $4)',
        [id, text, userId, deviceId]
      );

      const subject = `Ploop suggestion: ${text}`;
      const emailBody = `New suggestion from Ploop app:\n\n"${text}"\n\nSubmitted at ${new Date().toISOString()}`;
      sendEmailToAdmins(subject, emailBody).catch(() => {});
      sendPushToAdmins('Ploop suggestion', text).catch(() => {});

      res.status(201).json({ id, ok: true });
    } catch (e) {
      console.error('Suggestions submit:', e);
      res.status(500).json({ error: 'Failed to save suggestion' });
    }
  }
);

export default router;
