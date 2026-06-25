// api/admin/users/route.ts — Admin Users Management
// Protected by global middleware (ADMIN/SUPER_ADMIN role check)

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { ok, fail, paginated } from '@/enterprise/core/api-response';

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  tier: z.enum(['FREE', 'STARTER', 'PRO', 'BUSINESS', 'ENTERPRISE']).optional(),
  role: z.enum(['USER', 'ADMIN', 'SUPER_ADMIN']).optional(),
});

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const parsed = querySchema.safeParse(Object.fromEntries(searchParams));
    if (!parsed.success) return fail('VALIDATION_ERROR', 'Invalid query params', 400);

    const { page, limit, search, tier, role } = parsed.data;
    const skip = (page - 1) * limit;

    const where = {
      ...(search && {
        OR: [
          { email: { contains: search, mode: 'insensitive' as const } },
          { name: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
      ...(tier && { tier }),
      ...(role && { role }),
    };

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, email: true, name: true, avatar: true,
          role: true, tier: true, credits: true,
          totalSongsGenerated: true, isActive: true,
          createdAt: true, lastLoginAt: true,
          _count: { select: { songs: true } },
        },
      }),
      prisma.user.count({ where }),
    ]);

    return paginated(users, total, page, limit);
  } catch (error) {
    console.error('[admin/users] GET error:', error);
    return fail('INTERNAL_ERROR', 'Internal server error', 500);
  }
}

const updateUserSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(['USER', 'ADMIN', 'SUPER_ADMIN']).optional(),
  tier: z.enum(['FREE', 'STARTER', 'PRO', 'BUSINESS', 'ENTERPRISE']).optional(),
  isActive: z.boolean().optional(),
  credits: z.number().int().min(0).optional(),
});

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = updateUserSchema.safeParse(body);
    if (!parsed.success) return fail('VALIDATION_ERROR', 'Invalid data', 400, parsed.error.errors);

    const { userId, ...data } = parsed.data;

    const user = await prisma.user.update({
      where: { id: userId },
      data,
      select: { id: true, email: true, role: true, tier: true, isActive: true, credits: true },
    });

    // Audit log
    prisma.auditLog.create({
      data: {
        userId: req.headers.get('x-user-id') || undefined,
        action: 'ADMIN_UPDATE_USER',
        entity: 'User',
        entityId: userId,
        details: data,
        ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown',
      },
    }).catch(() => {});

    return ok(user);
  } catch (error) {
    console.error('[admin/users] PATCH error:', error);
    return fail('INTERNAL_ERROR', 'Internal server error', 500);
  }
}
