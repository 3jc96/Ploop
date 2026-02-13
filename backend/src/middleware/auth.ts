import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AuthUser } from '../types/auth';

const JWT_SECRET = process.env.JWT_SECRET || 'ploop-dev-secret-change-in-production';
const JWT_ISSUER = 'ploop-api';

export function signToken(payload: { userId: string; email: string; role: string }): string {
  return jwt.sign(
    { sub: payload.userId, email: payload.email, role: payload.role },
    JWT_SECRET,
    { expiresIn: '30d', issuer: JWT_ISSUER }
  );
}

export function verifyToken(token: string): { userId: string; email: string; role: string } | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET, { issuer: JWT_ISSUER }) as {
      sub: string;
      email: string;
      role: string;
    };
    return { userId: decoded.sub, email: decoded.email, role: decoded.role };
  } catch {
    return null;
  }
}

/** Attach user to req if valid Bearer token present; req.user may be undefined. */
export function optionalAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const payload = verifyToken(token);
    if (payload) {
      req.user = {
        id: payload.userId,
        email: payload.email,
        display_name: null,
        role: payload.role as 'user' | 'admin',
      };
    }
  }
  next();
}

/** Require authentication; 401 if no valid token. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  next();
}

/** Require admin role; call after requireAuth. 403 if not admin. */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || req.user.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
}
