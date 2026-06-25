// infrastructure/queue/generation-queue.ts — Fixed
// Problem: was creating a NEW ioredis connection per Queue instantiation
// using raw URL parsing, incompatible with the shared redis singleton.
// Fix: use the shared redis singleton from lib/redis.ts for BullMQ.
// This eliminates the "duplicate ioredis instance" warning and ensures
// the same connection pool is reused.

import { Queue, type JobsOptions } from 'bullmq';
import { redis } from '@/lib/redis';
import { prisma } from '@/lib/prisma';

export const GENERATION_QUEUE_NAME = 'melody-ai-generation';
export const GENERATION_JOB_NAME = 'process-song';

export interface EnqueueGenerationJobInput {
  aiJobId: string;
  songId: string;
  userId: string;
  organizationId?: string;
  generationInput: Record<string, unknown>;
}

class GenerationQueue {
  private queue: Queue | null = null;

  private getQueue(): Queue {
    if (!redis) {
      throw new Error('FATAL: Redis is not configured — cannot create generation queue');
    }

    if (!this.queue) {
      this.queue = new Queue(GENERATION_QUEUE_NAME, {
        connection: redis,
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2500 },
          removeOnComplete: { count: 500 },
          removeOnFail: { count: 1000 },
        },
      });

      this.queue.on('error', (err) => {
        console.error('[generation-queue] Queue error:', err.message);
      });
    }

    return this.queue;
  }

  async enqueue(input: EnqueueGenerationJobInput, options?: JobsOptions): Promise<void> {
    await this.getQueue().add(GENERATION_JOB_NAME, input, options);
  }

  /** Re-enqueue QUEUED AIJobs that disappeared from BullMQ (after crashes) */
  async reconcileOrphanedJobs(olderThanMs = 5 * 60 * 1000): Promise<{ reconciled: number }> {
    if (!redis) return { reconciled: 0 };

    const cutoff = new Date(Date.now() - olderThanMs);

    const staleJobs = await prisma.aIJob.findMany({
      where: { status: 'QUEUED', createdAt: { lt: cutoff } },
      select: { id: true, songId: true, userId: true, organizationId: true, input: true },
      take: 100,
    });

    if (!staleJobs.length) return { reconciled: 0 };

    const queue = this.getQueue();
    const active = await queue.getJobs(['active', 'waiting', 'delayed']);
    const queuedIds = new Set(
      active.map((j) => (j.data as { aiJobId?: string }).aiJobId).filter(Boolean)
    );

    let reconciled = 0;
    for (const job of staleJobs) {
      if (queuedIds.has(job.id) || !job.songId) continue;
      await queue.add(GENERATION_JOB_NAME, {
        aiJobId: job.id,
        songId: job.songId,
        userId: job.userId,
        organizationId: job.organizationId ?? undefined,
        generationInput: job.input as Record<string, unknown>,
      });
      reconciled++;
    }

    return { reconciled };
  }

  async getStats() {
    const q = this.getQueue();
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      q.getWaitingCount(),
      q.getActiveCount(),
      q.getCompletedCount(),
      q.getFailedCount(),
      q.getDelayedCount(),
    ]);
    return { waiting, active, completed, failed, delayed };
  }

  async close() {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
    }
  }
}

export const generationQueue = new GenerationQueue();
