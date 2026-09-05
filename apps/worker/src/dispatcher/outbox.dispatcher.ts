import { Injectable, Inject, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { AppConfig, formatStructuredLog, normalizeCorrelationId } from '@shipde/config';
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
      } catch {
        // Errors logged internally in dispatchPending
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
        const queue = this.getQueue();
        const payloadObj = event.payload as Record<string, unknown>;

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
            jobId: event.idempotency_key || event.id,
          }
        );

        // Mark as PROCESSING
        await this.prisma.outboxEvent.update({
          where: { id: event.id },
          data: { status: OutboxStatusEnum.PROCESSING },
        });

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

        await this.prisma.outboxEvent.update({
          where: { id: event.id },
          data: {
            attempts: nextAttempts,
            last_error: err.message,
            status: isExhausted ? OutboxStatusEnum.FAILED : OutboxStatusEnum.PENDING,
          },
        });

        console.error(
          formatStructuredLog({
            level: 'error',
            service: 'worker',
            correlationId,
            message: `Failed to dispatch outbox event ${event.id}: ${err.message}`,
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
