import express, { Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import bcrypt from 'bcrypt';
import { OAuth2Client } from 'google-auth-library';
import appleSignin from 'apple-signin-auth';
import pool from '../config/database';
import { signToken } from '../middleware/auth';
import { requireAuth } from '../middleware/auth';

const BCRYPT_ROUNDS = 10;

const router = express.Router();

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_ANDROID_CLIENT_ID = process.env.GOOGLE_ANDROID_CLIENT_ID || '';
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

function isAdmin(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  return ADMIN_EMAILS.includes(normalized);
}

const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';

// POST /api/auth/google – verify Google id_token (or exchange code), create/find user, return JWT
router.post(
  '/google',
  [
    body('id_token').optional().isString(),
    body('code').optional().isString(),
    body('redirect_uri').optional().isString(),
    body('code_verifier').optional().isString(),
  ],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      let id_token = req.body.id_token;
      const { code, redirect_uri, code_verifier } = req.body;

      if (!id_token && code) {
        if (!GOOGLE_CLIENT_SECRET || !redirect_uri) {
          return res.status(400).json({
            error: 'redirect_uri required when using code exchange',
            hint: 'Ensure GOOGLE_CLIENT_SECRET is set on Render. Mobile sends redirect_uri from the OAuth flow.',
          });
        }
        const oauth2 = new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, redirect_uri);
        try {
          const { tokens } = await oauth2.getToken({ code, codeVerifier: code_verifier });
          id_token = tokens.id_token;
        } catch (tokenErr: any) {
          const msg = tokenErr?.message || String(tokenErr);
          console.error('Google token exchange error:', msg, { redirect_uri });
          if (msg.includes('redirect_uri_mismatch')) {
            return res.status(400).json({
              error: 'redirect_uri_mismatch',
              hint: `Add this exact URI to Google Console → Credentials → OAuth client → Authorized redirect URIs: ${redirect_uri}`,
            });
          }
          if (msg.includes('invalid_grant') || msg.includes('code') || msg.includes('expired')) {
            return res.status(400).json({
              error: 'Invalid or expired authorization code',
              hint: 'Try signing in again. The code may have expired (they last ~10 min) or was already used.',
            });
          }
          throw tokenErr;
        }
        if (!id_token) {
          return res.status(400).json({ error: 'Google did not return an id_token' });
        }
      }

      if (!id_token) {
        return res.status(400).json({ error: 'id_token or code required' });
      }
      if (!GOOGLE_CLIENT_ID) {
        return res.status(503).json({ error: 'Google Sign-In not configured (GOOGLE_CLIENT_ID)' });
      }
      const allowedAudiences = [GOOGLE_CLIENT_ID];
      if (GOOGLE_ANDROID_CLIENT_ID) allowedAudiences.push(GOOGLE_ANDROID_CLIENT_ID);
      const client = new OAuth2Client();
      const ticket = await client.verifyIdToken({ idToken: id_token, audience: allowedAudiences });
      const payload = ticket.getPayload();
      if (!payload || !payload.sub) {
        return res.status(400).json({ error: 'Invalid Google token' });
      }
      const email = payload.email || `${payload.sub}@google.oauth`;
      const display_name = payload.name || null;
      const provider_id = payload.sub;

      const existing = await pool.query(
        'SELECT id, email, display_name, role FROM users WHERE provider = $1 AND provider_id = $2',
        ['google', provider_id]
      );
      let userId: string;
      let role: string;
      if (existing.rows.length > 0) {
        const row = existing.rows[0];
        userId = row.id;
        role = row.role;
        if (display_name && row.display_name !== display_name) {
          await pool.query(
            'UPDATE users SET display_name = $1, updated_at = now() WHERE id = $2',
            [display_name, userId]
          );
        }
      } else {
        role = isAdmin(email) ? 'admin' : 'user';
        const insert = await pool.query(
          `INSERT INTO users (email, display_name, provider, provider_id, role)
           VALUES ($1, $2, 'google', $3, $4)
           RETURNING id`,
          [email, display_name, provider_id, role]
        );
        userId = insert.rows[0].id;
      }

      const token = signToken({ userId, email, role });
      return res.json({
        token,
        user: { id: userId, email, display_name, role },
      });
    } catch (e: any) {
      const msg = e?.message || String(e);
      console.error('Google auth error:', msg);
      if (msg.includes('ECONNREFUSED') || msg.includes('ETIMEDOUT') || msg.includes('timeout')) {
        return res.status(503).json({
          error: 'Backend could not reach Google',
          hint: 'Render free tier may be cold-starting. Wait 30–60s and try again.',
        });
      }
      if (/wrong recipient|audience|verifyIdToken/i.test(msg)) {
        return res.status(401).json({
          error: 'Google token verification failed',
          hint: 'For native Android sign-in: add GOOGLE_ANDROID_CLIENT_ID to Render env and redeploy. Ensure both Web and Android OAuth client IDs are in Google Cloud Console.',
        });
      }
      return res.status(401).json({ error: 'Google sign-in failed' });
    }
  }
);

// POST /api/auth/apple – verify Apple id_token (identity token), create/find user, return JWT
router.post(
  '/apple',
  [
    body('id_token').isString().notEmpty(),
    body('name').optional().isString(),
  ],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      const { id_token, name } = req.body;
      const applePayload = await appleSignin.verifyIdToken(id_token, {
        audience: process.env.APPLE_CLIENT_ID || undefined,
        ignoreExpiration: false,
      });
      const sub = applePayload.sub;
      const email = (applePayload.email as string) || `${sub}@apple.private`;
      const display_name = name || null;

      const existing = await pool.query(
        'SELECT id, email, display_name, role FROM users WHERE provider = $1 AND provider_id = $2',
        ['apple', sub]
      );
      let userId: string;
      let role: string;
      if (existing.rows.length > 0) {
        const row = existing.rows[0];
        userId = row.id;
        role = row.role;
        if (display_name && row.display_name !== display_name) {
          await pool.query(
            'UPDATE users SET display_name = $1, updated_at = now() WHERE id = $2',
            [display_name, userId]
          );
        }
      } else {
        role = isAdmin(email) ? 'admin' : 'user';
        const insert = await pool.query(
          `INSERT INTO users (email, display_name, provider, provider_id, role)
           VALUES ($1, $2, 'apple', $3, $4)
           RETURNING id`,
          [email, display_name, sub, role]
        );
        userId = insert.rows[0].id;
      }

      const token = signToken({ userId, email, role });
      return res.json({
        token,
        user: { id: userId, email, display_name, role },
      });
    } catch (e) {
      console.error('Apple auth error:', e);
      res.status(401).json({ error: 'Apple sign-in failed' });
    }
  }
);

// POST /api/auth/register – create user with email/password
router.post(
  '/register',
  [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('display_name').isString().trim().notEmpty().withMessage('Name is required'),
  ],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      const { email, password, display_name } = req.body;
      const emailLower = String(email).trim().toLowerCase();
      const existing = await pool.query(
        'SELECT id FROM users WHERE provider = $1 AND provider_id = $2',
        ['email', emailLower]
      );
      if (existing.rows.length > 0) {
        return res.status(409).json({ error: 'Email already registered. Try signing in.' });
      }
      const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      const role = isAdmin(emailLower) ? 'admin' : 'user';
      const insert = await pool.query(
        `INSERT INTO users (email, display_name, provider, provider_id, password_hash, role)
         VALUES ($1, $2, 'email', $3, $4, $5)
         RETURNING id`,
        [emailLower, display_name?.trim() || null, emailLower, hash, role]
      );
      const userId = insert.rows[0].id;
      const token = signToken({ userId, email: emailLower, role });
      return res.json({
        token,
        user: { id: userId, email: emailLower, display_name: display_name?.trim() || null, role },
      });
    } catch (e) {
      console.error('Register error:', e);
      res.status(500).json({ error: 'Registration failed' });
    }
  }
);

// POST /api/auth/login – sign in with email/password
router.post(
  '/login',
  [
    body('email').isEmail().normalizeEmail(),
    body('password').isString().notEmpty(),
  ],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      const { email, password } = req.body;
      const emailLower = String(email).trim().toLowerCase();
      const [row] = (
        await pool.query(
          'SELECT id, email, display_name, password_hash, role FROM users WHERE provider = $1 AND provider_id = $2',
          ['email', emailLower]
        )
      ).rows;
      if (!row || !row.password_hash) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }
      const ok = await bcrypt.compare(password, row.password_hash);
      if (!ok) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }
      const token = signToken({ userId: row.id, email: row.email, role: row.role });
      return res.json({
        token,
        user: { id: row.id, email: row.email, display_name: row.display_name, role: row.role },
      });
    } catch (e) {
      console.error('Login error:', e);
      res.status(500).json({ error: 'Sign-in failed' });
    }
  }
);

// GET /api/auth/me – return current user (requires Auth header)
router.get('/me', requireAuth, async (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  const [row] = (
    await pool.query(
      'SELECT id, email, display_name, role FROM users WHERE id = $1',
      [req.user.id]
    )
  ).rows;
  if (!row) return res.status(404).json({ error: 'User not found' });
  res.json({ user: { id: row.id, email: row.email, display_name: row.display_name, role: row.role } });
});

export default router;
