/**
 * Secured maintenance endpoints (cron / manual). Not listed on public API index.
 */
import express, { Request, Response } from 'express';
import { runMonthlyPoopGameTop3Report } from '../jobs/monthlyPoopGameTop3';

const router = express.Router();

function authorize(req: Request): boolean {
  const secret = process.env.MONTHLY_POOP_GAME_REPORT_SECRET;
  if (!secret || secret.length < 8) return false;
  const header =
    (req.header('x-ploop-monthly-secret') || '').trim() ||
    (req.header('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  return header === secret;
}

// POST /api/internal/monthly-poop-game-report — previous month top 3 (idempotent)
router.post('/monthly-poop-game-report', async (req: Request, res: Response) => {
  if (!authorize(req)) {
    return res.status(404).json({ error: 'Not found' });
  }
  const force = req.query.force === '1' || req.body?.force === true;
  try {
    const result = await runMonthlyPoopGameTop3Report({ force });
    res.json(result);
  } catch (e) {
    console.error('[InternalJobs] monthly-poop-game-report:', e);
    res.status(500).json({ error: 'Failed to run report' });
  }
});

export default router;
