// api/payments/webhook/route.ts — Stripe Webhook Handler (Production)
// Verifies Stripe signature, processes subscription events atomically

import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { prisma } from '@/lib/prisma';
import { EnterpriseBillingService } from '@/enterprise/services/billing.service';
import type { SubscriptionTier } from '@prisma/client';

// Bypass body parsing — Stripe needs raw body for signature verification
export const runtime = 'nodejs';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2023-10-16',
});

const TIER_MAP: Record<string, SubscriptionTier> = {
  starter: 'STARTER',
  pro: 'PRO',
  business: 'BUSINESS',
  enterprise: 'ENTERPRISE',
};

export async function POST(req: NextRequest) {
  const sig = req.headers.get('stripe-signature');
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !secret) {
    console.error('[webhook] Missing stripe-signature or STRIPE_WEBHOOK_SECRET');
    return NextResponse.json({ error: 'Webhook configuration error' }, { status: 400 });
  }

  let event: Stripe.Event;

  try {
    const body = await req.text();
    event = stripe.webhooks.constructEvent(body, sig, secret);
  } catch (err) {
    console.error('[webhook] Signature verification failed:', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  // Idempotency — skip already-processed events
  const existing = await prisma.webhookEvent.findUnique({ where: { eventId: event.id } });
  if (existing?.processed) {
    return NextResponse.json({ received: true, skipped: 'already processed' });
  }

  // Record event (idempotency guard)
  await prisma.webhookEvent.upsert({
    where: { eventId: event.id },
    create: { provider: 'stripe', eventId: event.id, type: event.type, payload: event as object },
    update: {},
  });

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.userId;
        const tierKey = session.metadata?.tier?.toLowerCase();
        const orgId = session.metadata?.organizationId || undefined;

        if (!userId || !tierKey) break;

        const tier = TIER_MAP[tierKey];
        if (!tier) break;

        await EnterpriseBillingService.activateSubscription({
          userId,
          tier,
          providerId: session.subscription as string,
          organizationId: orgId,
        });

        console.log(`[webhook] Activated ${tier} for user ${userId}`);
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        const userId = sub.metadata?.userId;
        const tierKey = sub.metadata?.tier?.toLowerCase();

        if (!userId || !tierKey) break;

        const tier = TIER_MAP[tierKey];
        if (!tier) break;

        await prisma.user.update({ where: { id: userId }, data: { tier } });
        await prisma.subscription.updateMany({
          where: { userId, providerId: sub.id },
          data: {
            status: sub.status,
            currentPeriodEnd: new Date(sub.current_period_end * 1000),
          },
        });
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const userId = sub.metadata?.userId;
        if (!userId) break;

        await prisma.user.update({ where: { id: userId }, data: { tier: 'FREE' } });
        await prisma.subscription.updateMany({
          where: { userId, providerId: sub.id },
          data: { status: 'canceled', canceledAt: new Date() },
        });

        console.log(`[webhook] Subscription canceled for user ${userId}`);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const subId = invoice.subscription as string;
        if (subId) {
          await prisma.subscription.updateMany({
            where: { providerId: subId },
            data: { status: 'past_due' },
          });
        }
        break;
      }
    }

    // Mark processed
    await prisma.webhookEvent.update({
      where: { eventId: event.id },
      data: { processed: true, processedAt: new Date() },
    });

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error(`[webhook] Processing error for ${event.type}:`, err);
    await prisma.webhookEvent.update({
      where: { eventId: event.id },
      data: { error: (err as Error).message },
    });
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
  }
}
