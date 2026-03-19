/**
 * Public endpoints for diagnostics and crash reports (no auth required).
 * Mobile app sends load diagnostics and crash reports for admin visibility.
 */
import express, { Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { v4 as uuidv4 } from 'uuid';
import pool from '../config/database';

const router = express.Router();

// POST /api/diagnostics – load timing (permission, location, API)
router.post(
  '/diagnostics',
  [
    body('platform').isString().trim().notEmpty(),
    body('permissionMs').optional().isInt({ min: 0 }),
    body('locationSource').optional().isString().trim(),
    body('locationMs').optional().isInt({ min: 0 }),
    body('apiMs').optional().isInt({ min: 0 }),
    body('totalMs').optional().isInt({ min: 0 }),
    body('success').optional().isBoolean(),
    body('deviceId').optional().isString().trim(),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { platform, permissionMs, locationSource, locationMs, apiMs, totalMs, success, deviceId } = req.body;

    try {
      const id = uuidv4();
      await pool.query(
        `INSERT INTO load_diagnostics (id, device_id, platform, permission_ms, location_source, location_ms, api_ms, total_ms, success)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [id, deviceId || null, platform, permissionMs ?? null, locationSource || null, locationMs ?? null, apiMs ?? null, totalMs ?? null, success ?? null]
      );
      res.status(201).json({ ok: true });
    } catch (e) {
      console.error('Error saving load diagnostics:', e);
      res.status(500).json({ error: 'Failed to save diagnostics' });
    }
  }
);

// POST /api/crash-reports – from AppErrorBoundary
router.post(
  '/crash-reports',
  [
    body('errorMessage').isString().trim().notEmpty(),
    body('errorStack').optional().isString(),
    body('componentStack').optional().isString(),
    body('platform').optional().isString().trim(),
    body('appVersion').optional().isString().trim(),
    body('deviceId').optional().isString().trim(),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { errorMessage, errorStack, componentStack, platform, appVersion, deviceId } = req.body;

    try {
      const id = uuidv4();
      await pool.query(
        `INSERT INTO crash_reports (id, device_id, platform, app_version, error_message, error_stack, component_stack)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, deviceId || null, platform || null, appVersion || null, errorMessage, errorStack || null, componentStack || null]
      );
      res.status(201).json({ ok: true });
    } catch (e) {
      console.error('Error saving crash report:', e);
      res.status(500).json({ error: 'Failed to save crash report' });
    }
  }
);

export default router;
