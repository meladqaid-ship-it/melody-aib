// api/payments/billing/route.ts — Current Billing Info

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ok, fail } from '@/enterprise/core/api-response';

export async function GET(req: NextRequest) {
  const userId = req.headers.get('x-user-id');
  if (!userId) return fail('UNAUTHORIZED', 'Unauthorized', 401);

  try {
    const [user, subscription, recentPayments] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { tier: true, credits: true },
      }),
      prisma.subscription.findFirst({
        where: { userId, status: { in: ['active', 'trialing'] } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.payment.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ]);

    return ok({ tier: user?.tier || 'FREE', credits: user?.credits || 0, subscription, payments: recentPayments });
  } catch (error) {
    console.error('[billing] GET error:', error);
    return fail('INTERNAL_ERROR', 'Internal server error', 500);
  }
}
