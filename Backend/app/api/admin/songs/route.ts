// api/admin/songs/route.ts — Admin Songs Management
// Auth + admin role check handled by global middleware

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { ok, fail, paginated } from '@/enterprise/core/api-response';

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED']).optional(),
  userId: z.string().uuid().optional(),
  search: z.string().optional(),
});

export async function GET(req: NextRequest) {
  const adminId = req.headers.get('x-user-id');
  if (!adminId) return fail('UNAUTHORIZED', 'Unauthorized', 401);

  try {
    const { searchParams } = new URL(req.url);
    const parsed = querySchema.safeParse(Object.fromEntries(searchParams));
    if (!parsed.success) return fail('VALIDATION_ERROR', 'Invalid query params', 400);

    const { page, limit, status, userId, search } = parsed.data;
    const skip = (page - 1) * limit;

    const where = {
      ...(status && { status }),
      ...(userId && { userId }),
      ...(search && {
        OR: [
          { title: { contains: search, mode: 'insensitive' as const } },
          { user: { email: { contains: search, mode: 'insensitive' as const } } },
        ],
      }),
    };

    const [songs, total] = await Promise.all([
      prisma.song.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          title: true,
          genre: true,
          mood: true,
          language: true,
          status: true,
          progress: true,
          audioUrl: true,
          duration: true,
          createdAt: true,
          updatedAt: true,
          user: { select: { id: true, email: true, name: true } },
          _count: { select: { aiJobs: true } },
        },
      }),
      prisma.song.count({ where }),
    ]);

    return paginated(songs, total, page, limit);
  } catch (error) {
    console.error('[admin/songs] GET error:', error);
    return fail('INTERNAL_ERROR', 'Internal server error', 500);
  }
}

export async function DELETE(req: NextRequest) {
  const adminId = req.headers.get('x-user-id');
  if (!adminId) return fail('UNAUTHORIZED', 'Unauthorized', 401);

  try {
    const { searchParams } = new URL(req.url);
    const songId = searchParams.get('id');
    if (!songId) return fail('VALIDATION_ERROR', 'Missing song id', 400);

    await prisma.song.delete({ where: { id: songId } });

    prisma.auditLog.create({
      data: { userId: adminId, action: 'ADMIN_DELETE_SONG', entity: 'Song', entityId: songId },
    }).catch(() => {});

    return ok({ message: 'Song deleted' });
  } catch (error) {
    console.error('[admin/songs] DELETE error:', error);
    return fail('INTERNAL_ERROR', 'Internal server error', 500);
  }
}
