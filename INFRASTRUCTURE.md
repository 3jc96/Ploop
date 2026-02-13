# Ploop Backend Infrastructure

Production-ready architecture for 100K+ users. Designed for reliability, observability, and horizontal scaling.

---

## Architecture Overview

```
┌─────────────────┐     ┌──────────────────────────────────┐
│  Mobile / Web   │────▶│  Node.js API (Express)            │
│  (Expo/React)   │     │  - Rate limiting (300 req/min)    │
│                 │     │  - Compression (gzip)             │
│  httpClient     │     │  - Helmet security headers       │
│  - Retry 3x     │     │  - /health, /ready probes        │
│  - Expo backoff │     └────────────┬─────────────────────┘
│  - Cache fallback│                 │
└─────────────────┘                  ▼
                          ┌──────────────────┐
                          │  PostgreSQL      │
                          │  - Connection    │
                          │    pool (50 max) │
                          │  - GIST spatial  │
                          │    indexes       │
                          └──────────────────┘
```

---

## Client Resilience (Mobile)

The app is designed to avoid network-error dead ends:

| Layer | Behavior |
|-------|----------|
| **httpClient** | Retries GET/HEAD 3× with exponential backoff (500ms → 1s → 2s) on network errors (ECONNREFUSED, ETIMEDOUT, 5xx, 429) |
| **Network detection** | `isNetworkError()` recognizes ECONNREFUSED, ETIMEDOUT, ENOTFOUND, ERR_NETWORK, etc. |
| **Cache fallback** | Failed toilet fetches fall back to last cached result in AsyncStorage |
| **Backend banner** | Shows “Can't reach backend” with Retry when network errors occur; dismissible |
| **Health check** | `api.checkHealth()` probes `/health` before critical flows |

### Configuration

- **iOS Simulator**: `EXPO_PUBLIC_PLOOP_USE_LOCALHOST=true` in `mobile/.env` → uses `localhost:PORT`
- **Physical device**: `EXPO_PUBLIC_PLOOP_API_URL=http://YOUR_MAC_IP:PORT` (same Wi‑Fi)
- **Port**: Backend `PORT` and mobile URL must match (e.g. 3000 if 8082 is blocked)

---

## Backend Hardening

| Feature | Config | Purpose |
|---------|--------|---------|
| **Rate limit** | `RATE_LIMIT_MAX=300` (default) | 300 req/min per IP; /health, /ready excluded |
| **Compression** | gzip | Smaller JSON payloads |
| **Helmet** | contentSecurityPolicy off for API | Security headers without breaking API |
| **Body limit** | 512kb | Prevents large payload DoS |
| **Graceful shutdown** | SIGTERM/SIGINT | Closes server, drains DB pool, exits within 10s |

---

## Database

| Setting | Default | Purpose |
|---------|---------|---------|
| `DB_POOL_MAX` | 50 | Connections per Node process; scale horizontally for more |
| `idleTimeoutMillis` | 30s | Release idle connections |
| `connectionTimeoutMillis` | 5s | Fail fast on DB unreachable |

### Indexes (ensureTables)

- `idx_toilets_location_gist` – PostGIS spatial for nearby queries
- `idx_toilets_google_place_id`, `idx_toilets_active`
- `idx_toilet_reports_toilet_active`, `idx_toilet_hints_toilet`
- `idx_toilet_favorites_device`, `idx_analytics_events_name_time`
- `idx_users_provider_id`, `idx_users_email`

### Scaling

- One Node process ~50–100 pooled connections
- 100K users, ~1% concurrent ≈ 1000 connections → run ~10–20 Node instances behind a load balancer
- Use `DB_POOL_MAX` to tune per instance; total pool size = instances × `DB_POOL_MAX`

---

## Health & Readiness

| Endpoint | Purpose | Used by |
|----------|---------|---------|
| `GET /health` | Liveness; no DB check | Load balancers, client probes |
| `GET /ready` | DB connectivity check | Kubernetes readiness probe |

---

## Deployment Checklist

1. Set `NODE_ENV=production`
2. Set `JWT_SECRET` (min 32 chars) for auth
3. Set `EXPO_PUBLIC_PLOOP_API_URL` to your production API URL in mobile build
4. Configure `CORS_ORIGIN` for your frontend origin(s)
5. Use managed Postgres (e.g. RDS, Supabase) with connection pooling (PgBouncer) for high scale
6. Put API behind HTTPS (nginx, Cloudflare, etc.)
7. Run multiple Node instances behind a load balancer for horizontal scaling

---

## Local Development

```bash
# From Ploop/
npm run start:backend   # Backend on PORT (default 8082)
npm run start:mobile    # Expo on 8081
# Or both: npm start
```

- Backend listens on `0.0.0.0` so devices on same Wi‑Fi can connect
- `curl http://localhost:PORT/health` to verify
- See `BACKEND_CONNECTIVITY.md` for troubleshooting
