// middleware/rate-limit.ts — Production Rate Limiter
// Uses ioredis (same instance as BullMQ) instead of @upstash/redis
// Falls back to in-memory store in dev / when Redis unavailable

import { NextRequest } from 'next/server';
import { redis } from '@/lib/redis';

interface RateLimitOptions {
  max: number;
  window: number; // seconds
}

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  reset: number;
}

// ─── In-memory fallback ───────────────────────────────────────────────────────

const memStore = new Map<string, { count: number; reset: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of memStore) {
    if (now > v.reset) memStore.delete(k);
  }
}, 5 * 60 * 1000);

// ─── Key builder ──────────────────────────────────────────────────────────────

function buildKey(req: NextRequest): string {
  const ip =
    req.headers.get('x-real-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    'unknown';
  // Hash IP for privacy — not stored raw
  const salt = process.env.JWT_SECRET || 'dev';
  let hash = 0;
  for (let i = 0; i < ip.length + salt.length; i++) {
    const ch = (ip + salt).charCodeAt(i);
    hash = ((hash << 5) - hash + ch) | 0;
  }
  return `rl:${Math.abs(hash).toString(16)}:${req.nextUrl.pathname}`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function rateLimit(
  req: NextRequest,
  options: RateLimitOptions
): Promise<RateLimitResult> {
  const key = buildKey(req);
  const now = Date.now();
  const windowMs = options.window * 1000;

  try {
    if (redis) {
      // Use atomic Lua script to avoid race conditions
      const lua = `
        local key = KEYS[1]
        local max = tonumber(ARGV[1])
        local ttl = tonumber(ARGV[2])
        local current = redis.call('GET', key)
        if current == false then
          redis.call('SET', key, 1, 'PX', ttl)
          return {1, max - 1}
        end
        local count = tonumber(current)
        if count >= max then
          return {0, 0}
        end
        redis.call('INCR', key)
        return {1, max - count - 1}
      `;

      const result = await redis.eval(lua, 1, key, options.max, windowMs) as [number, number];
      const allowed = result[0] === 1;
      const remaining = result[1];

      return { success: allowed, remaining, reset: now + windowMs };
    }
  } catch (err) {
    console.error('[rate-limit] Redis error, using memory fallback:', err);
  }

  // In-memory fallback
  const entry = memStore.get(key);
  if (!entry || now > entry.reset) {
    memStore.set(key, { count: 1, reset: now + windowMs });
    return { success: true, remaining: options.max - 1, reset: now + windowMs };
  }
  if (entry.count >= options.max) {
    return { success: false, remaining: 0, reset: entry.reset };
  }
  entry.count++;
  return { success: true, remaining: options.max - entry.count, reset: entry.reset };
}
