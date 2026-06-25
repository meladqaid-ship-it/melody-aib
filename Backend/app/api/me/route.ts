// api/me/route.ts — Fixed
// Uses x-user-id header injected by middleware (no DB call for auth check)
// Returns unified ApiResponse format

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/enterprise/core/api-response';

const updateProfileSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  avatar: z.string().url().optional(),
});

function getUserIdFromRequest(req: NextRequest): string | null {
  // Injected by global middleware after JWT verification
  return req.headers.get('x-user-id') || null;
}

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return fail('UNAUTHORIZED', 'Unauthorized', 401);

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
        role: true,
        tier: true,
        credits: true,
        totalSongsGenerated: true,
        isActive: true,
        emailVerified: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
        subscriptions: {
          select: { tier: true, status: true, currentPeriodEnd: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!user || !user.isActive) return fail('UNAUTHORIZED', 'Unauthorized', 401);

    const { subscriptions, ...rest } = user;
    return ok({ ...rest, subscription: subscriptions[0] ?? null });
  } catch (error) {
    console.error('[api/me] GET error:', error);
    return fail('INTERNAL_ERROR', 'Internal server error', 500);
  }
}

export async function PATCH(req: NextRequest) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return fail('UNAUTHORIZED', 'Unauthorized', 401);

  try {
    const body = await req.json();
    const parsed = updateProfileSchema.safeParse(body);
    if (!parsed.success) {
      return fail('VALIDATION_ERROR', 'Validation failed', 400, parsed.error.errors);
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: parsed.data,
      select: { id: true, email: true, name: true, avatar: true, updatedAt: true },
    });

    prisma.auditLog.create({
      data: {
        userId,
        action: 'PROFILE_UPDATED',
        entity: 'User',
        entityId: userId,
        details: parsed.data,
        ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown',
      },
    }).catch(() => {});

    return ok(updated);
  } catch (error) {
    console.error('[api/me] PATCH error:', error);
    return fail('INTERNAL_ERROR', 'Internal server error', 500);
  }
}
