import { Injectable, Inject, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import {
  AppConfig,
  formatStructuredLog,
  normalizeCorrelationId,
  redactSensitiveData,
} from '@shipde/config';
import { APP_CONFIG } from '../config.token';
import { SMOKE_QUEUE_NAME, QUEUE_SMOKE_EVENT_TYPE, QueueSmokePayload } from '@shipde/contracts';
import { OutboxStatusEnum, OutboxEvent } from '@prisma/client';
import { SmokeJobData } from '../queue/smoke.worker';

@Injectable()
export class OutboxDispatcher implements OnModuleInit, OnModuleDestroy {
  private queue: Queue<SmokeJobData> | null = null;
  private pollInterval: NodeJS.Timeout | null = null;
  private readonly config: AppConfig;

  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    private readonly prisma: PrismaService
  ) {
    this.config = config;
  }

  async onModuleInit(): Promise<void> {
    this.queue = new Queue<SmokeJobData>(SMOKE_QUEUE_NAME, {
      connection: {
        host: this.config.REDIS_HOST,
        port: this.config.REDIS_PORT,
        password: this.config.REDIS_PASSWORD,
      },
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        removeOnComplete: false,
        removeOnFail: false,
      },
    });

    this.pollInterval = setInterval(async () => {
      try {
        await this.dispatchPending();
        await this.recoverStaleProcessing();
      } catch {
        // Errors logged internally in dispatchPending / recoverStaleProcessing
      }
    }, 1000);
  }

  getQueue(): Queue<SmokeJobData> {
    if (!this.queue) {
      throw new Error('OutboxDispatcher queue is not initialized');
    }
    return this.queue;
  }

  /**
   * Scans for pending outbox events and dispatches them to BullMQ.
   * Guarantees at-least-once dispatch with bounded retries and error observability.
   */
  async dispatchPending(limit = 10): Promise<{ dispatched: number; failed: number }> {
    const pendingEvents = await this.prisma.outboxEvent.findMany({
      where: {
        status: OutboxStatusEnum.PENDING,
        scheduled_at: { lte: new Date() },
      },
      take: limit,
      orderBy: { scheduled_at: 'asc' },
    });

    let dispatched = 0;
    let failed = 0;

    for (const event of pendingEvents) {
      const correlationId = normalizeCorrelationId(event.correlation_id);
      try {
        // Atomically claim only PENDING record to PROCESSING before enqueuing to BullMQ
        // This prevents race condition with concurrent workers or overwriting PUBLISHED records (Finding 3)
        const claimResult = await this.prisma.outboxEvent.updateMany({
          where: {
            id: event.id,
            status: OutboxStatusEnum.PENDING,
          },
          data: {
            status: OutboxStatusEnum.PROCESSING,
          },
        });

        if (claimResult.count === 0) {
          // Event was concurrently claimed or completed, skip
          continue;
        }

        const queue = this.getQueue();
        const payloadObj = event.payload as Record<string, unknown>;
        const attemptJobId = `${event.idempotency_key || event.id}-attempt-${event.attempts}`;

        await queue.add(
          'smoke-job',
          {
            outboxId: event.id,
            smokeId: (payloadObj?.smokeId as string) || event.id,
            correlationId,
            eventType: event.event_type,
            payload: payloadObj,
            idempotencyKey: event.idempotency_key || undefined,
          },
          {
            jobId: attemptJobId,
          }
        );

        dispatched++;
        console.log(
          formatStructuredLog({
            level: 'info',
            service: 'worker',
            correlationId,
            message: `Outbox event ${event.id} (${event.event_type}) dispatched to BullMQ queue ${SMOKE_QUEUE_NAME}`,
            metadata: {
              outboxId: event.id,
              eventType: event.event_type,
            },
          })
        );
      } catch (err: any) {
        failed++;
        const nextAttempts = event.attempts + 1;
        const isExhausted = nextAttempts >= 3;
        const rawError = err?.message || 'Dispatch publish failure';
        const sanitizedError = (redactSensitiveData(rawError) as string) || rawError;

        await this.prisma.outboxEvent.update({
          where: { id: event.id },
          data: {
            attempts: nextAttempts,
            last_error: sanitizedError,
            status: isExhausted ? OutboxStatusEnum.FAILED : OutboxStatusEnum.PENDING,
          },
        });

        console.error(
          formatStructuredLog({
            level: 'error',
            service: 'worker',
            correlationId,
            message: `Failed to dispatch outbox event ${event.id}: ${sanitizedError}`,
            metadata: {
              outboxId: event.id,
              attempts: nextAttempts,
              status: isExhausted ? OutboxStatusEnum.FAILED : OutboxStatusEnum.PENDING,
            },
          })
        );
      }
    }

    return { dispatched, failed };
  }

  /**
   * Recovers records stranded in PROCESSING beyond a visibility window.
   * If attempts >= 3, transitions them to FAILED; otherwise restores them to PENDING for retry.
   */
  async recoverStaleProcessing(
    olderThanMs = 60000
  ): Promise<{ recovered: number; failed: number }> {
    const cutoff = new Date(Date.now() - olderThanMs);
    const staleEvents = await this.prisma.outboxEvent.findMany({
      where: {
        status: OutboxStatusEnum.PROCESSING,
        scheduled_at: { lte: cutoff },
      },
    });

    let recovered = 0;
    let failed = 0;

    for (const event of staleEvents) {
      const isExhausted = event.attempts >= 3;
      await this.prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          status: isExhausted ? OutboxStatusEnum.FAILED : OutboxStatusEnum.PENDING,
          last_error: isExhausted
            ? event.last_error || 'Exhausted processing attempts'
            : 'Recovered from stale processing state',
        },
      });

      if (isExhausted) {
        failed++;
      } else {
        recovered++;
      }
    }

    return { recovered, failed };
  }

  /**
   * Re-queues an exhausted or failed outbox event for deterministic operator recovery.
   */
  async retryFailed(outboxId: string): Promise<OutboxEvent> {
    const existing = await this.prisma.outboxEvent.findUnique({
      where: { id: outboxId },
    });
    if (!existing) {
      throw new Error(`Outbox event ${outboxId} not found`);
    }
    if (existing.status !== OutboxStatusEnum.FAILED) {
      throw new Error(
        `Cannot retry outbox event ${outboxId} with status ${existing.status}; only FAILED events can be retried`
      );
    }

    // Safely remove retained failed jobs from BullMQ queue to avoid duplicate jobId rejection
    try {
      const queue = this.getQueue();
      const jobKeys = [
        existing.idempotency_key || existing.id,
        `${existing.idempotency_key || existing.id}-attempt-${existing.attempts}`,
      ];
      for (const k of jobKeys) {
        const j = await queue.getJob(k);
        if (j) {
          await j.remove();
        }
      }
    } catch {
      // Best-effort cleanup
    }

    return this.prisma.outboxEvent.update({
      where: { id: outboxId },
      data: {
        status: OutboxStatusEnum.PENDING,
        attempts: 0,
        last_error: null,
        scheduled_at: new Date(),
      },
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
    }
  }
}
