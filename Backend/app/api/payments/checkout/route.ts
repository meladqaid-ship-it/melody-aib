// api/payments/checkout/route.ts — Stripe Checkout

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { EnterpriseBillingService } from '@/enterprise/services/billing.service';
import { ok, fail } from '@/enterprise/core/api-response';
import type { SubscriptionTier } from '@prisma/client';

const checkoutSchema = z.object({
  tier: z.enum(['STARTER', 'PRO', 'BUSINESS', 'ENTERPRISE']),
  organizationId: z.string().uuid().optional(),
});

export async function POST(req: NextRequest) {
  const userId = req.headers.get('x-user-id');
  const userEmail = req.headers.get('x-user-email');
  if (!userId || !userEmail) return fail('UNAUTHORIZED', 'Unauthorized', 401);

  try {
    const body = await req.json();
    const parsed = checkoutSchema.safeParse(body);
    if (!parsed.success) return fail('VALIDATION_ERROR', 'Invalid data', 400, parsed.error.errors);

    if (!process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY.startsWith('sk_test_placeholder')) {
      return fail('STRIPE_NOT_CONFIGURED', 'Payment system is not configured yet', 503);
    }

    const session = await EnterpriseBillingService.createCheckout({
      userId,
      email: userEmail,
      tier: parsed.data.tier as SubscriptionTier,
      organizationId: parsed.data.organizationId,
    });

    return ok({ url: session.url });
  } catch (error) {
    console.error('[checkout] error:', error);
    return fail('INTERNAL_ERROR', 'Failed to create checkout session', 500);
  }
}
