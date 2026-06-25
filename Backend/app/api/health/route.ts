// api/health/route.ts — Production Health Check
// Used by Render health checks + monitoring

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { redis } from '@/lib/redis';

export const dynamic = 'force-dynamic';

export async function GET() {
  const checks: Record<string, 'ok' | 'error'> = {};
  let allOk = true;

  // DB check
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = 'ok';
  } catch {
    checks.database = 'error';
    allOk = false;
  }

  // Redis check
  if (redis) {
    try {
      await redis.ping();
      checks.redis = 'ok';
    } catch {
      checks.redis = 'error';
      // Redis optional — don't fail overall health
    }
  } else {
    checks.redis = 'error';
  }

  return NextResponse.json(
    {
      status: allOk ? 'healthy' : 'degraded',
      checks,
      version: process.env.npm_package_version || '1.0.0',
      timestamp: new Date().toISOString(),
    },
    { status: allOk ? 200 : 503 }
  );
}
