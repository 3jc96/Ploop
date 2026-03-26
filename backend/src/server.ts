import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import toiletsRouter from './routes/toilets';
import landmarksRouter from './routes/landmarks';
import directionsRouter from './routes/directions';
import reportsRouter from './routes/reports';
import favoritesRouter from './routes/favorites';
import analyticsRouter from './routes/analytics';
import hintsRouter from './routes/hints';
import authRouter from './routes/auth';
import adminRouter from './routes/admin';
import poopGameRouter from './routes/poopGame';
import suggestionsRouter from './routes/suggestions';
import huntRouter from './routes/hunt';
import huntAdminRouter from './routes/huntAdmin';
import diagnosticsRouter from './routes/diagnostics';
import internalJobsRouter from './routes/internalJobs';
import { optionalAuth } from './middleware/auth';
import { ensureFeatureTables } from './utils/ensureTables';
import { checkDatabase } from './utils/checkDatabase';
import { validateEnv } from './config/validateEnv';
import pool from './config/database';
import { scheduleMonthlyPoopGameTop3Report } from './jobs/monthlyPoopGameTop3';
import { scheduleGoldenToiletHunt } from './jobs/goldenToiletHunt';

dotenv.config();
validateEnv();

// Log unhandled rejections so they don't silently kill the server
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Server] Unhandled rejection at:', promise, 'reason:', reason);
});

const app = express();
const PORT = parseInt(process.env.PORT || '8082', 10);

// Security headers (helmet). Disable contentSecurityPolicy for API (no HTML).
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

// Gzip compression for JSON responses
app.use(compression());

// CORS – allow Expo dev server origins; production adds CORS_ORIGIN
const allowedOrigins = [
  'http://localhost:8081',
  'http://127.0.0.1:8081',
  'http://localhost:19006',
  ...(process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map((o: string) => o.trim()).filter(Boolean) : []),
];

// In dev: allow Expo dev server from LAN (e.g. http://192.168.0.2:8081) so physical devices can reach API
const isDevExpoOrigin = (origin: string) => {
  try {
    const u = new URL(origin);
    const host = u.hostname;
    const port = u.port || '80';
    return (
      (host.startsWith('192.168.') || host.startsWith('10.') || host === '127.0.0.1') &&
      (port === '8081' || port === '19006')
    );
  } catch {
    return false;
  }
};

app.use(cors({
  origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
    if (!origin) cb(null, true);
    else if (allowedOrigins.includes(origin)) cb(null, true);
    else if (process.env.NODE_ENV !== 'production' && isDevExpoOrigin(origin)) cb(null, true);
    else cb(null, false);
  },
  credentials: true,
}));
app.use(express.json({ limit: '512kb' }));
app.use(express.urlencoded({ extended: true, limit: '512kb' }));

// Rate limiting (skip /health, /ready). 300 req/min per IP for 100K users.
const rateLimitMax = parseInt(process.env.RATE_LIMIT_MAX || '300', 10);
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: rateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please try again later.' },
    skip: (req) => req.path === '/health' || req.path === '/ready',
  })
);

// Serve uploaded files
const uploadDir = process.env.UPLOAD_DIR || './uploads';
app.use('/uploads', express.static(path.resolve(uploadDir)));

// Privacy policy (required for App Store)
app.get('/privacy', (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/privacy.html'));
});

// Root endpoint – API discovery and documentation
app.get('/', (req, res) => {
  res.json({
    name: 'Ploop API',
    version: '1.0.0',
    description: 'Toilet finder API - Phase 1',
    endpoints: {
      health: '/health',
      ready: '/ready',
      auth: '/api/auth',
      authGoogle: 'POST /api/auth/google',
      authApple: 'POST /api/auth/apple',
      authRegister: 'POST /api/auth/register',
      authLogin: 'POST /api/auth/login',
      authMe: 'GET /api/auth/me',
      toilets: '/api/toilets',
      toiletByPlace: '/api/toilets/by-place/:placeId',
      toiletReviews: 'GET /api/toilets/:id/reviews',
      addReview: 'POST /api/toilets/:id/review',
      updateReview: 'PATCH /api/toilets/:id/reviews/:reviewId',
      deleteReview: 'DELETE /api/toilets/:id/reviews/:reviewId',
      checkDuplicate: '/api/toilets/check-duplicate',
      searchNames: '/api/toilets/search-names',
      uploadPhoto: '/api/toilets/:id/photo',
      landmarks: '/api/landmarks/search',
      adminDashboard: 'GET /api/admin/analytics/dashboard',
      adminReviews: 'GET/PATCH/DELETE /api/admin/reviews',
      landmarkDetails: '/api/landmarks/:placeId',
      locationDetails: '/api/landmarks/location/details',
      directions: '/api/directions',
      reports: '/api/reports/:toiletId',
      favorites: '/api/favorites',
      favoriteToilet: '/api/favorites/:toiletId',
      hints: '/api/hints/:toiletId',
      analytics: '/api/analytics',
      documentation: 'See README.md for full API documentation',
    },
    example: {
      getNearbyToilets: '/api/toilets?latitude=37.7749&longitude=-122.4194&radius=1000&limit=50',
      getToilet: '/api/toilets/:id',
      createToilet: 'POST /api/toilets',
      updateToilet: 'PUT /api/toilets/:id',
    },
  });
});

// Health check – lightweight, for load balancers and client probes
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Readiness – checks DB connection; for K8s/deployment probes
app.get('/ready', async (req, res) => {
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    res.json({ status: 'ready', db: 'connected' });
  } catch (e) {
    res.status(503).json({ status: 'not ready', db: 'disconnected', error: (e as Error).message });
  }
});

// Optional auth: parse JWT when present so routes can use req.user
app.use(optionalAuth);

// API routes
app.use('/api/auth', authRouter);
app.use('/api/toilets', toiletsRouter);
app.use('/api/landmarks', landmarksRouter);
app.use('/api/directions', directionsRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/favorites', favoritesRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/hints', hintsRouter);
app.use('/api/admin', adminRouter);
app.use('/api/poop-game', poopGameRouter);
app.use('/api/suggestions', suggestionsRouter);
app.use('/api/hunt', huntRouter);
app.use('/api/admin/hunt', huntAdminRouter);
app.use('/api/internal', internalJobsRouter);
app.use('/api', diagnosticsRouter);

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  });
});

/**
 * Pings own /health every 14 minutes on Render free/hobby tier to prevent sleep.
 * Only active in production and when RENDER_EXTERNAL_URL or SELF_PING_URL is set.
 * No-op in dev (no env var set).
 */
function scheduleKeepAlive(port: number): void {
  const selfUrl = process.env.RENDER_EXTERNAL_URL || process.env.SELF_PING_URL;
  if (!selfUrl || process.env.NODE_ENV !== 'production') return;
  const pingUrl = `${selfUrl.replace(/\/$/, '')}/health`;
  const INTERVAL_MS = 14 * 60 * 1000; // 14 minutes (Render free sleeps at 15)
  setInterval(async () => {
    try {
      const res = await fetch(pingUrl);
      if (!res.ok) console.warn(`[KeepAlive] Ping returned ${res.status}`);
    } catch (e: any) {
      console.warn('[KeepAlive] Ping failed:', e?.message);
    }
  }, INTERVAL_MS);
  console.log(`[KeepAlive] Pinging ${pingUrl} every 14 min to prevent sleep`);
}

// Bootstrap: verify DB → ensure tables → start server
async function start(): Promise<void> {
  try {
    await checkDatabase();
    console.log('[DB] Connection OK');
  } catch (e) {
    console.error('[DB] Startup failed:', (e as Error).message);
    process.exit(1);
  }

  try {
    await ensureFeatureTables();
  } catch (e) {
    console.error('Warning: failed to ensure feature tables. Some features may not work.', e);
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚽 Ploop API server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`(Listening on all interfaces so your phone can connect when on the same Wi‑Fi)`);
    scheduleMonthlyPoopGameTop3Report();
    scheduleGoldenToiletHunt();
    scheduleKeepAlive(PORT);
  });

  function shutdown(signal: string) {
    console.log(`\n[Server] ${signal} received, shutting down...`);
    server.close(() => {
      pool.end().then(() => {
        console.log('[Server] Shutdown complete');
        process.exit(0);
      }).catch((err) => {
        console.error('[Server] Error closing pool:', err);
        process.exit(1);
      });
    });
    setTimeout(() => {
      console.error('[Server] Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch((e) => {
  console.error('[Server] Fatal startup error:', e);
  process.exit(1);
});

