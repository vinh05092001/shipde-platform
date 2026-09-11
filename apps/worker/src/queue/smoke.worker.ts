import { Injectable, Inject, Optional, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Worker, Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import {
  AppConfig,
  formatStructuredLog,
  normalizeCorrelationId,
  redactSensitiveData,
} from '@shipde/config';
import { APP_CONFIG } from '../config.token';
import { SMOKE_QUEUE_NAME, QUEUE_SMOKE_EVENT_TYPE } from '@shipde/contracts';
import { OutboxStatusEnum } from '@prisma/client';

export interface SmokeJobData {
  outboxId?: string;
  smokeId: string;
  correlationId: string;
  eventType?: string;
  payload?: Record<string, unknown>;
  idempotencyKey?: string;
}

@Injectable()
export class SmokeWorker implements OnModuleInit, OnModuleDestroy {
  private worker: Worker<SmokeJobData> | null = null;
  private readonly config: AppConfig;
  public processedCount = 0;
  public duplicateCount = 0;

  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    private readonly prisma: PrismaService,
    @Optional() private readonly redisService?: RedisService
  ) {
    this.config = config;
  }

  async onModuleInit(): Promise<void> {
    this.worker = new Worker<SmokeJobData>(
      SMOKE_QUEUE_NAME,
      async (job: Job<SmokeJobData>) => {
        return this.processJob(job);
      },
      {
        connection: {
          host: this.config.REDIS_HOST,
          port: this.config.REDIS_PORT,
          password: this.config.REDIS_PASSWORD,
        },
        concurrency: 1,
      }
    );

    this.worker.on('failed', async (job, err) => {
      await this.handleJobFailure(job, err);
    });
  }

  async processJob(job: Job<SmokeJobData>): Promise<{ success: boolean; duplicate: boolean }> {
    const data = job.data;
    const correlationId = normalizeCorrelationId(data.correlationId);

    // Restrict foundation worker strictly to QUEUE_SMOKE_EVENT_TYPE (P2 Finding 5)
    if (data.eventType && data.eventType !== QUEUE_SMOKE_EVENT_TYPE) {
      console.warn(
        formatStructuredLog({
          level: 'warn',
          service: 'worker',
          correlationId,
          message: `SmokeWorker ignoring unsupported event type '${data.eventType}' for job ${job.id}`,
          metadata: {
            jobId: job.id,
            eventType: data.eventType,
            outboxId: data.outboxId,
          },
        })
      );
      return { success: false, duplicate: false };
    }

    console.log(
      formatStructuredLog({
        level: 'info',
        service: 'worker',
        correlationId,
        message: `Processing smoke job ${job.id} for event ${data.eventType || QUEUE_SMOKE_EVENT_TYPE}`,
        metadata: {
          jobId: job.id,
          smokeId: data.smokeId,
          outboxId: data.outboxId,
        },
      })
    );

    const jobId = job.id || data.smokeId;
    const dedupKey = `smoke:dedup:${jobId}`;

    // 1. Redis Deduplication Guard (AC-FOUND-03-10)
    if (this.redisService) {
      try {
        const redis = this.redisService.getClient();
        if (redis.status !== 'ready') {
          await redis.connect();
        }
        const acquired = await redis.set(dedupKey, '1', 'EX', 86400, 'NX');
        if (!acquired) {
          // Reconcile against durable database state before acknowledging duplicate (Finding 4)
          // If outbox event is not yet PUBLISHED (e.g. process crashed before committing),
          // do NOT drop the work as a duplicate; fall through to process the durable effect.
          if (data.outboxId) {
            const outboxRecord = await this.prisma.outboxEvent.findUnique({
              where: { id: data.outboxId },
            });
            if (outboxRecord && outboxRecord.status === OutboxStatusEnum.PUBLISHED) {
              this.duplicateCount++;
              console.log(
                formatStructuredLog({
                  level: 'warn',
                  service: 'worker',
                  correlationId,
                  message: `Duplicate job ${job.id} skipped via Redis deduplication key ${dedupKey}.`,
                  metadata: {
                    jobId: job.id,
                    dedupKey,
                  },
                })
              );
              return { success: true, duplicate: true };
            }
          } else {
            this.duplicateCount++;
            return { success: true, duplicate: true };
          }
        }
      } catch {
        // Fall through to database guard if Redis fails
      }
    }

    try {
      // 2. Database Outbox State Deduplication Guard
      if (data.outboxId) {
        const outboxRecord = await this.prisma.outboxEvent.findUnique({
          where: { id: data.outboxId },
        });

        if (outboxRecord && outboxRecord.status === OutboxStatusEnum.PUBLISHED) {
          this.duplicateCount++;
          console.log(
            formatStructuredLog({
              level: 'warn',
              service: 'worker',
              correlationId,
              message: `Duplicate job ${job.id} received for already published outbox event ${data.outboxId}. Acknowledged without duplicating side effects.`,
              metadata: {
                outboxId: data.outboxId,
                status: outboxRecord.status,
              },
            })
          );
          return { success: true, duplicate: true };
        }

        // Execute deterministic smoke side effect: transition outbox event to PUBLISHED atomically
        // Requiring status === PROCESSING prevents read-check-write race between concurrent deliveries (P1 Finding 4)
        const claimEffect = await this.prisma.outboxEvent.updateMany({
          where: {
            id: data.outboxId,
            status: OutboxStatusEnum.PROCESSING,
          },
          data: {
            status: OutboxStatusEnum.PUBLISHED,
            published_at: new Date(),
            attempts: { increment: 1 },
            last_error: null,
          },
        });

        if (claimEffect.count === 0) {
          // Another concurrent delivery already committed the effect to PUBLISHED
          this.duplicateCount++;
          console.log(
            formatStructuredLog({
              level: 'warn',
              service: 'worker',
              correlationId,
              message: `Duplicate job ${job.id} detected via atomic database claim guard for outbox event ${data.outboxId}. Side effects already committed.`,
              metadata: {
                outboxId: data.outboxId,
              },
            })
          );
          return { success: true, duplicate: true };
        }
      }

      this.processedCount++;
      console.log(
        formatStructuredLog({
          level: 'info',
          service: 'worker',
          correlationId,
          message: `Successfully executed deterministic smoke effect for job ${job.id}`,
          metadata: {
            jobId: job.id,
            smokeId: data.smokeId,
            outboxId: data.outboxId,
          },
        })
      );

      return { success: true, duplicate: false };
    } catch (err) {
      // Clear Redis dedup key on failure so retry attempt can acquire it
      if (this.redisService) {
        try {
          await this.redisService.getClient().del(dedupKey);
        } catch {
          // ignore
        }
      }
      throw err;
    }
  }

  /**
   * Handles job failure lifecycle: records bounded attempts and sanitized error metadata,
   * leaves transient retries in PROCESSING (or recoverable), and transitions exhausted failures to FAILED.
   */
  async handleJobFailure(job: Job<SmokeJobData> | undefined, err: Error): Promise<void> {
    if (!job) return;
    const correlationId = job.data?.correlationId || normalizeCorrelationId();
    const maxAttempts = job.opts?.attempts ?? 3;
    const attempts = job.attemptsMade || 1;
    const isExhausted = attempts >= maxAttempts;
    const rawError = err?.message || 'Unknown handler failure';
    const sanitizedError = (redactSensitiveData(rawError) as string) || rawError;

    console.error(
      formatStructuredLog({
        level: 'error',
        service: 'worker',
        correlationId,
        message: `Job ${job.id} in ${SMOKE_QUEUE_NAME} failed (attempt ${attempts}/${maxAttempts}): ${sanitizedError}`,
        metadata: {
          jobId: job.id,
          outboxId: job.data?.outboxId,
          attempts,
          isExhausted,
        },
      })
    );

    // If transient failure, clean up Redis dedup key so retry can proceed
    if (!isExhausted && this.redisService) {
      try {
        const dedupKey = `smoke:dedup:${job.id || job.data?.smokeId}`;
        await this.redisService.getClient().del(dedupKey);
      } catch {
        // ignore
      }
    }

    if (job.data?.outboxId) {
      try {
        await this.prisma.outboxEvent.update({
          where: { id: job.data.outboxId },
          data: {
            attempts,
            last_error: sanitizedError,
            status: isExhausted ? OutboxStatusEnum.FAILED : OutboxStatusEnum.PROCESSING,
          },
        });
      } catch (dbErr: any) {
        console.error(
          formatStructuredLog({
            level: 'error',
            service: 'worker',
            correlationId,
            message: `Failed to update outbox event failure state for ${job.data.outboxId}: ${dbErr.message}`,
          })
        );
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }
}
