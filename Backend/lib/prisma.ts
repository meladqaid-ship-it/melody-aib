// lib/prisma.ts — Prisma Singleton (Production-Safe)
// Prevents "Too many connections" on Neon serverless / Render cold starts
// Uses global singleton pattern recommended by Prisma docs for Next.js

import { PrismaClient } from '@prisma/client';

const LOG_LEVELS =
  process.env.NODE_ENV === 'development'
    ? (['query', 'error', 'warn'] as const)
    : (['error'] as const);

function createPrismaClient() {
  const client = new PrismaClient({
    log: [...LOG_LEVELS],
    // Neon/Render: shorter connection timeout to fail fast on misconfiguration
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
  });

  // Graceful shutdown — prevents connection pool leak on SIGTERM (Render restart)
  process.on('beforeExit', async () => {
    await client.$disconnect();
  });

  return client;
}

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

// Reuse across hot reloads in dev; create fresh in production
export const prisma = global.__prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  global.__prisma = prisma;
}
