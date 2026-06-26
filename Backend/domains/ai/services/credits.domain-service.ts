// domains/ai/services/credits.domain-service.ts — Unified Credit Operations

import type { PrismaTransactionClient } from '../repositories/song.repository';
import {
  InsufficientCreditsError,
  AccountInactiveError,
  NotFoundError,
} from '@/Backend/domains/shared/errors/domain-errors';
import {
  domainEvents,
  DomainEventNames,
} from '@/Backend/domains/shared/events/event-bus';
import type { GenerationCost } from '../domain/song-generation.entity';

export interface CreditAccount {
  type: 'user' | 'organization';
  id: string;
}

export class CreditsDomainService {
  static async deduct(
    tx: PrismaTransactionClient,
    account: CreditAccount,
    cost: GenerationCost,
    reason: string,
    reference: { type: string; id: string },
  ): Promise<number> {

    // ==============================
    // 🚀 OWNER BYPASS (SaaS FIX)
    // ==============================
    const OWNER_ID = process.env.OWNER_ID;

    if (account.type === 'user' && OWNER_ID && account.id === OWNER_ID) {
      // لا يتم خصم أي رصيد من حسابك
      return cost.credits;
    }

    // ==============================
    // ORGANIZATION FLOW
    // ==============================
    if (account.type === 'organization') {
      const org = await tx.organization.findUnique({
        where: { id: account.id },
        select: { credits: true, isActive: true },
      });

      if (!org) throw new NotFoundError('Organization');
      if (!org.isActive) throw new AccountInactiveError('organization');
      if (org.credits < cost.credits)
        throw new InsufficientCreditsError(cost.credits, org.credits);

      const updated = await tx.organization.update({
        where: { id: account.id },
        data: { credits: { decrement: cost.credits } },
        select: { credits: true },
      });

      await tx.creditLedger.create({
        data: {
          organizationId: account.id,
          type: 'USAGE',
          amount: -cost.credits,
          balanceAfter: updated.credits,
          reason,
          referenceType: reference.type,
          referenceId: reference.id,
        },
      });

      domainEvents.publish(DomainEventNames.CREDITS_DEDUCTED, {
        accountType: 'organization',
        accountId: account.id,
        amount: cost.credits,
        balanceAfter: updated.credits,
        reason,
      });

      return updated.credits;
    }

    // ==============================
    // USER FLOW
    // ==============================
    const user = await tx.user.findUnique({
      where: { id: account.id },
      select: {
        credits: true,
        isActive: true,
        role: true,
      },
    });

    if (!user) throw new NotFoundError('User');
    if (!user.isActive) throw new AccountInactiveError('user');

    if (user.credits < cost.credits) {
      throw new InsufficientCreditsError(cost.credits, user.credits);
    }

    const updated = await tx.user.update({
      where: {
        id: account.id,
        credits: { gte: cost.credits },
      },
      data: {
        credits: { decrement: cost.credits },
      },
      select: { credits: true },
    });

    await tx.creditLedger.create({
      data: {
        userId: account.id,
        type: 'USAGE',
        amount: -cost.credits,
        balanceAfter: updated.credits,
        reason,
        referenceType: reference.type,
        referenceId: reference.id,
      },
    });

    domainEvents.publish(DomainEventNames.CREDITS_DEDUCTED, {
      accountType: 'user',
      accountId: account.id,
      amount: cost.credits,
      balanceAfter: updated.credits,
      reason,
    });

    return updated.credits;
  }

  // ==============================
  // REFUND (UNCHANGED)
  // ==============================
  static async refund(
    tx: PrismaTransactionClient,
    account: CreditAccount,
    cost: GenerationCost,
    reason: string,
    reference: { type: string; id: string },
  ): Promise<void> {

    if (account.type === 'organization') {
      const updated = await tx.organization.update({
        where: { id: account.id },
        data: { credits: { increment: cost.credits } },
        select: { credits: true },
      });

      await tx.creditLedger.create({
        data: {
          organizationId: account.id,
          type: 'REFUND',
          amount: cost.credits,
          balanceAfter: updated.credits,
          reason,
          referenceType: reference.type,
          referenceId: reference.id,
        },
      });
    } else {
      const updated = await tx.user.update({
        where: { id: account.id },
        data: { credits: { increment: cost.credits } },
        select: { credits: true },
      });

      await tx.creditLedger.create({
        data: {
          userId: account.id,
          type: 'REFUND',
          amount: cost.credits,
          balanceAfter: updated.credits,
          reason,
          referenceType: reference.type,
          referenceId: reference.id,
        },
      });
    }

    domainEvents.publish(DomainEventNames.CREDITS_REFUNDED, {
      accountType: account.type,
      accountId: account.id,
      amount: cost.credits,
      reason,
    });
  }
}
