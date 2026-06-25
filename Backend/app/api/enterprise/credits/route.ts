// api/enterprise/credits/route.ts — Credits Management API

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { CreditsService } from '@/enterprise/services/credits.service';
import { ok, fail } from '@/enterprise/core/api-response';

function getUserId(req: NextRequest) {
  return req.headers.get('x-user-id') || null;
}

// GET /api/enterprise/credits — get balance + history
export async function GET(req: NextRequest) {
  const userId = getUserId(req);
  if (!userId) return fail('UNAUTHORIZED', 'Unauthorized', 401);

  const orgId = req.headers.get('x-organization-id') || undefined;

  try {
    const [balance, history] = await Promise.all([
      CreditsService.getBalance({ userId, organizationId: orgId }),
      CreditsService.history({ userId, organizationId: orgId, limit: 20 }),
    ]);

    return ok({ balance, history });
  } catch (error) {
    console.error('[credits] GET error:', error);
    return fail('INTERNAL_ERROR', 'Internal server error', 500);
  }
}

const grantSchema = z.object({
  amount: z.number().int().positive(),
  reason: z.string().min(1),
  targetUserId: z.string().uuid().optional(),
  organizationId: z.string().uuid().optional(),
});

// POST /api/enterprise/credits — admin grant credits
export async function POST(req: NextRequest) {
  const role = req.headers.get('x-user-role') || '';
  if (!['ADMIN', 'SUPER_ADMIN'].includes(role)) {
    return fail('FORBIDDEN', 'Admin access required', 403);
  }

  try {
    const body = await req.json();
    const parsed = grantSchema.safeParse(body);
    if (!parsed.success) return fail('VALIDATION_ERROR', 'Invalid data', 400, parsed.error.errors);

    const { amount, reason, targetUserId, organizationId } = parsed.data;

    const newBalance = await CreditsService.grant({
      userId: targetUserId,
      organizationId,
      amount,
      reason,
    });

    return ok({ newBalance, granted: amount, reason });
  } catch (error) {
    console.error('[credits] POST error:', error);
    return fail('INTERNAL_ERROR', 'Internal server error', 500);
  }
}
