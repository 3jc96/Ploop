import express, { Request, Response } from 'express';
import { body, query, validationResult } from 'express-validator';
import pool from '../config/database';
import { v4 as uuidv4 } from 'uuid';
import { optionalAuth } from '../middleware/auth';

const router = express.Router();

// POST /api/poop-game/scores – submit a score
router.post(
  '/scores',
  [
    body('score').isInt({ min: 0 }),
    body('display_name').optional().isString().trim().isLength({ max: 64 }),
  ],
  optionalAuth,
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      const { score, display_name } = req.body;
      const userId = (req as any).user?.id ?? null;
      const deviceId = (req.header('x-ploop-device-id') || req.header('X-Ploop-Device-Id') || '').trim() || null;
      const name = display_name?.trim() || (req as any).user?.display_name || (req as any).user?.email || 'Anonymous';

      // Allow duplicate names – always insert new score
      const id = uuidv4();
      await pool.query(
        `INSERT INTO poop_game_scores (id, score, display_name, user_id, device_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, score, name, userId, deviceId]
      );

      res.status(201).json({ id, score, display_name: name });
    } catch (e) {
      console.error('Poop game submit score:', e);
      res.status(500).json({ error: 'Failed to save score' });
    }
  }
);

// GET /api/poop-game/scores – global leaderboard
router.get(
  '/scores',
  [query('limit').optional().isInt({ min: 1, max: 100 })],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      const limit = Number(req.query.limit) || 50;

      const result = await pool.query(
        `SELECT score, display_name, created_at
         FROM poop_game_scores
         ORDER BY score DESC, created_at ASC
         LIMIT $1`,
        [limit]
      );

      res.json({ scores: result.rows });
    } catch (e) {
      console.error('Poop game leaderboard:', e);
      res.status(500).json({ error: 'Failed to load leaderboard' });
    }
  }
);

export default router;
