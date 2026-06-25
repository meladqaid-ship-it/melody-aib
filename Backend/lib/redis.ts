// lib/redis.ts — Single Redis Client (ioredis)
// BullMQ requires ioredis with maxRetriesPerRequest: null
// Rate limiter uses @upstash/redis separately (different connection)
// This file exports the SINGLE ioredis instance for BullMQ + general use.

import Redis from 'ioredis';

let redis: Redis | null = null;

function createRedisClient(): Redis | null {
  const url = process.env.REDIS_URL;
  if (!url) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[redis] FATAL: REDIS_URL not set in production');
    } else {
      console.warn('[redis] REDIS_URL not set — queue features disabled in dev');
    }
    return null;
  }

  const client = new Redis(url, {
    // Required by BullMQ — disables automatic retry on blocked commands
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
    // Reconnect with exponential backoff (max 30s)
    retryStrategy: (times) => Math.min(times * 500, 30_000),
    // TLS for rediss:// URLs (Upstash, Redis Cloud, etc.)
    ...(url.startsWith('rediss://') ? { tls: {} } : {}),
  });

  client.on('connect', () => console.log('[redis] Connected'));
  client.on('ready', () => console.log('[redis] Ready'));
  client.on('error', (err) => console.error('[redis] Error:', err.message));
  client.on('close', () => console.warn('[redis] Connection closed'));
  client.on('reconnecting', () => console.log('[redis] Reconnecting...'));

  return client;
}

// Singleton: reuse across hot reloads in dev
declare global {
  // eslint-disable-next-line no-var
  var __redis: Redis | null | undefined;
}

if (!global.__redis) {
  global.__redis = createRedisClient();
}

redis = global.__redis ?? null;

export { redis };
export default redis;
