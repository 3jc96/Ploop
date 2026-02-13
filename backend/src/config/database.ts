import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// Pool sizing for scale: 100K users, ~1% concurrent = ~1000 connections.
const poolMax = parseInt(process.env.DB_POOL_MAX || '50', 10);

// Render, Railway, etc. provide DATABASE_URL; otherwise use individual DB_* vars
const databaseUrl = process.env.DATABASE_URL;
const poolConfig = databaseUrl
  ? {
      connectionString: databaseUrl,
      ssl: databaseUrl.includes('render.com') ? { rejectUnauthorized: false } : undefined,
      max: Math.min(poolMax, 100),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      allowExitOnIdle: false,
    }
  : {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'ploop',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || '',
      max: Math.min(poolMax, 100),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      allowExitOnIdle: false,
    };

const pool = new Pool(poolConfig as any);

pool.on('error', (err) => {
  console.error('[DB] Unexpected error on idle client (pool will reconnect):', err.message);
  // Do NOT exit - pg Pool automatically removes bad clients and creates new ones.
  // Exiting on transient errors (network blip, Postgres restart) would kill the server.
});

export default pool;


