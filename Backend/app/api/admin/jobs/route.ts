// api/admin/jobs/route.ts — Admin Jobs / Queue Status
// Auth + admin role check handled by global middleware

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/enterprise/core/api-response';
import { z } from 'zod';

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED']).optional(),
});

export async function GET(req: NextRequest) {
  const adminId = req.headers.get('x-user-id');
  if (!adminId) return fail('UNAUTHORIZED', 'Unauthorized', 401);

  try {
    const { searchParams } = new URL(req.url);
    const parsed = querySchema.safeParse(Object.fromEntries(searchParams));
    if (!parsed.success) return fail('VALIDATION_ERROR', 'Invalid query params', 400);

    const { page, limit, status } = parsed.data;
    const skip = (page - 1) * limit;
    const where = status ? { status } : {};

    const [jobs, total, statusCounts] = await Promise.all([
      prisma.aIJob.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          type: true,
          status: true,
          progress: true,
          attempts: true,
          maxAttempts: true,
          error: true,
          queuedAt: true,
          startedAt: true,
          completedAt: true,
          user: { select: { id: true, email: true } },
          song: { select: { id: true, title: true } },
        },
      }),
      prisma.aIJob.count({ where }),
      prisma.aIJob.groupBy({ by: ['status'], _count: true }),
    ]);

    return ok({
      jobs,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
      summary: Object.fromEntries(statusCounts.map(({ status, _count }) => [status, _count])),
    });
  } catch (error) {
    console.error('[admin/jobs] GET error:', error);
    return fail('INTERNAL_ERROR', 'Internal server error', 500);
  }
}
