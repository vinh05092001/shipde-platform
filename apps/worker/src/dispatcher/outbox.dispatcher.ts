import { Injectable, Inject, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import {
  AppConfig,
  formatStructuredLog,
  normalizeCorrelationId,
  redactSensitiveData,
  sanitizeErrorMessage,
  getTracer,
  withSpan,
  injectTraceContext,
} from '@shipde/config';
import { APP_CONFIG } from '../config.token';
import { SMOKE_QUEUE_NAME, QUEUE_SMOKE_EVENT_TYPE } from '@shipde/contracts';
import { OutboxStatusEnum, OutboxEvent } from '@prisma/client';
import { SmokeJobData } from '../queue/smoke.worker';

@Injectable()
export class OutboxDispatcher implements OnModuleInit, OnModuleDestroy {
  private queue: Queue<SmokeJobData> | null = null;
  private pollInterval: NodeJS.Timeout | null = null;
  private isTickRunning = false;
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

    // Serialize interval ticks to prevent overlapping execution (Finding 5)
    this.pollInterval = setInterval(async () => {
      if (this.isTickRunning) {
        return;
      }
      this.isTickRunning = true;
      try {
        await this.dispatchPending();
        await this.recoverStaleProcessing();
      } catch {
        // Errors logged internally in dispatchPending / recoverStaleProcessing
      } finally {
        this.isTickRunning = false;
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
   * Guarantees at-least-once dispatch with bounded retries and OpenTelemetry distributed tracing (Finding 10).
   */
  async dispatchPending(limit = 10): Promise<{ dispatched: number; failed: number }> {
    const tracer = getTracer('shipde-worker');
    return withSpan(tracer, 'outbox.dispatch_pending', async () => {
      const now = new Date();
      const pendingEvents = await this.prisma.outboxEvent.findMany({
        where: {
          event_type: QUEUE_SMOKE_EVENT_TYPE,
          status: OutboxStatusEnum.PENDING,
          scheduled_at: { lte: now },
        },
        take: limit,
        orderBy: { scheduled_at: 'asc' },
      });

      let dispatched = 0;
      let failed = 0;

      for (const event of pendingEvents) {
        const correlationId = normalizeCorrelationId(event.correlation_id);
        try {
          // Atomically claim only PENDING record to PROCESSING and record processing-start timestamp
          const claimResult = await this.prisma.outboxEvent.updateMany({
            where: {
              id: event.id,
              status: OutboxStatusEnum.PENDING,
            },
            data: {
              status: OutboxStatusEnum.PROCESSING,
              scheduled_at: new Date(),
            },
          });

          if (claimResult.count === 0) {
            // Event was concurrently claimed or completed, skip
            continue;
          }

          const queue = this.getQueue();
          const payloadObj = event.payload as Record<string, unknown>;
          const attemptJobId = `${event.idempotency_key || event.id}-del-${event.attempts}-${Date.now()}`;

          // Inject active trace context into job carrier
          const traceCarrier: Record<string, string> = {};
          injectTraceContext(traceCarrier);

          await queue.add(
            'smoke-job',
            {
              outboxId: event.id,
              smokeId: (payloadObj?.smokeId as string) || event.id,
              correlationId,
              eventType: event.event_type,
              payload: payloadObj,
              idempotencyKey: event.idempotency_key || undefined,
              traceContext: traceCarrier,
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
                queue: SMOKE_QUEUE_NAME,
                jobId: attemptJobId,
              },
            })
          );
        } catch (err: unknown) {
          failed++;
          const errorMessage = sanitizeErrorMessage(err);
          console.error(
            formatStructuredLog({
              level: 'error',
              service: 'worker',
              correlationId,
              message: `Failed to dispatch outbox event ${event.id}: ${errorMessage}`,
              metadata: { outboxId: event.id, error: errorMessage },
            })
          );

          try {
            const nextAttempts = event.attempts + 1;
            const isExhausted = nextAttempts >= 3;
            await this.prisma.outboxEvent.updateMany({
              where: {
                id: event.id,
                status: OutboxStatusEnum.PROCESSING,
              },
              data: {
                status: isExhausted ? OutboxStatusEnum.FAILED : OutboxStatusEnum.PENDING,
                attempts: nextAttempts,
                last_error: errorMessage,
                scheduled_at: new Date(
                  Date.now() + Math.min(1000 * Math.pow(2, nextAttempts), 30000)
                ),
              },
            });
          } catch (updateErr: unknown) {
            console.error(
              formatStructuredLog({
                level: 'error',
                service: 'worker',
                correlationId,
                message: `Failed to revert outbox event ${event.id} status after dispatch failure: ${sanitizeErrorMessage(updateErr)}`,
                metadata: { outboxId: event.id, error: sanitizeErrorMessage(updateErr) },
              })
            );
          }
        }
      }

      return { dispatched, failed };
    });
  }

  /**
   * Recovers records stranded in PROCESSING beyond a visibility window.
   * Includes observed scheduled_at and attempts in the conditional update to prevent regressing
   * fresh claims or concurrent publications (Finding 5).
   */
  async recoverStaleProcessing(
    olderThanMs = 60000
  ): Promise<{ recovered: number; failed: number }> {
    const cutoff = new Date(Date.now() - olderThanMs);
    const staleEvents = await this.prisma.outboxEvent.findMany({
      where: {
        event_type: QUEUE_SMOKE_EVENT_TYPE,
        status: OutboxStatusEnum.PROCESSING,
        scheduled_at: { lte: cutoff },
      },
    });

    let recovered = 0;
    let failed = 0;

    for (const event of staleEvents) {
      const nextAttempts = event.attempts + 1;
      const isExhausted = nextAttempts >= 3;
      // Atomically transition ONLY if still in PROCESSING state with observed scheduled_at and attempts (Finding 5)
      const updateResult = await this.prisma.outboxEvent.updateMany({
        where: {
          id: event.id,
          status: OutboxStatusEnum.PROCESSING,
          scheduled_at: event.scheduled_at,
          attempts: event.attempts,
        },
        data: {
          status: isExhausted ? OutboxStatusEnum.FAILED : OutboxStatusEnum.PENDING,
          attempts: nextAttempts,
          last_error: isExhausted
            ? event.last_error || 'Exhausted processing attempts'
            : 'Recovered from stale processing state',
          scheduled_at: isExhausted
            ? new Date()
            : new Date(Date.now() + Math.min(1000 * Math.pow(2, nextAttempts), 30000)),
        },
      });

      if (updateResult.count > 0) {
        if (isExhausted) {
          failed++;
        } else {
          recovered++;
        }
      }
    }

    return { recovered, failed };
  }

  /**
   * Manually resets a FAILED outbox event back to PENDING.
   * Uses an atomic conditional FAILED-to-PENDING claim to prevent republishing completed events (Finding 1).
   * Uses exact match or delimited prefix cleanup to avoid prefix collisions (Finding 4).
   */
  async retryFailed(outboxId: string): Promise<OutboxEvent> {
    // 1. Atomically claim FAILED -> PENDING
    const claim = await this.prisma.outboxEvent.updateMany({
      where: {
        id: outboxId,
        status: OutboxStatusEnum.FAILED,
      },
      data: {
        status: OutboxStatusEnum.PENDING,
        attempts: 0,
        last_error: null,
        scheduled_at: new Date(),
      },
    });

    if (claim.count === 0) {
      const existing = await this.prisma.outboxEvent.findUnique({
        where: { id: outboxId },
      });
      if (!existing) {
        throw new Error(`Outbox event ${outboxId} not found`);
      }
      throw new Error(
        `Cannot retry outbox event ${outboxId} with status ${existing.status}; only FAILED events can be retried`
      );
    }

    // 2. Safely purge retained jobs from BullMQ queue using exact match or delimited prefix (Finding 4)
    try {
      const queue = this.getQueue();
      const existing = await this.prisma.outboxEvent.findUnique({
        where: { id: outboxId },
      });
      if (existing) {
        const baseKey = existing.idempotency_key || existing.id;
        const jobs = await queue.getJobs(['failed', 'completed', 'waiting', 'active', 'delayed']);
        for (const j of jobs) {
          // Exact match or delimited prefix (e.g. order-1-del-... or order-1:...)
          // NEVER match order-10 when baseKey is order-1
          const isExactOrDelimited =
            j.id === baseKey ||
            j.id?.startsWith(`${baseKey}-del-`) ||
            j.id?.startsWith(`${baseKey}:`);
          if (
            isExactOrDelimited ||
            j.data?.outboxId === existing.id ||
            (j.data?.idempotencyKey && j.data.idempotencyKey === baseKey)
          ) {
            await j.remove();
          }
        }
      }
    } catch {
      // Best-effort cleanup
    }

    // Note: The returned record is a best-effort snapshot; the event may be claimed concurrently by dispatchPending().
    const record = await this.prisma.outboxEvent.findUnique({
      where: { id: outboxId },
    });
    if (!record) {
      throw new Error(`Outbox event ${outboxId} not found`);
    }
    return record;
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
