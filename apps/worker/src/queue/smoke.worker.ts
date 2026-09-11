import { Injectable, Inject, Optional, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Worker, Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import {
  AppConfig,
  formatStructuredLog,
  normalizeCorrelationId,
  redactSensitiveData,
  getTracer,
  withSpan,
} from '@shipde/config';
import { APP_CONFIG } from '../config.token';
import { SMOKE_QUEUE_NAME, QUEUE_SMOKE_EVENT_TYPE } from '@shipde/contracts';
import { OutboxStatusEnum } from '@prisma/client';

export interface SmokeJobData {
  outboxId: string;
  smokeId: string;
  correlationId: string;
  eventType?: string;
  payload?: Record<string, unknown>;
  idempotencyKey?: string;
  traceContext?: Record<string, string>;
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
    const initialCorrelationId = normalizeCorrelationId(data?.correlationId);

    // 1. Restrict foundation worker strictly to QUEUE_SMOKE_EVENT_TYPE (Finding 4)
    if (data?.eventType !== QUEUE_SMOKE_EVENT_TYPE) {
      console.warn(
        formatStructuredLog({
          level: 'warn',
          service: 'worker',
          correlationId: initialCorrelationId,
          message: `SmokeWorker ignoring unsupported or missing event type '${data?.eventType}' for job ${job.id}`,
          metadata: {
            jobId: job.id,
            eventType: data?.eventType,
            outboxId: data?.outboxId,
          },
        })
      );
      return { success: false, duplicate: false };
    }

    // 2. Strictly require durable outboxId (Finding 2)
    if (!data?.outboxId) {
      console.error(
        formatStructuredLog({
          level: 'error',
          service: 'worker',
          correlationId: initialCorrelationId,
          message: `SmokeWorker rejected job ${job.id}: missing required durable outboxId`,
          metadata: {
            jobId: job.id,
            data,
          },
        })
      );
      return { success: false, duplicate: false };
    }

    // 3. Load durable outbox record from database (Finding 2)
    let outboxRecord = null;
    try {
      outboxRecord = await this.prisma.outboxEvent.findUnique({
        where: { id: data.outboxId },
      });
    } catch {
      // Invalid UUID or database query error
      outboxRecord = null;
    }

    if (!outboxRecord) {
      console.error(
        formatStructuredLog({
          level: 'error',
          service: 'worker',
          correlationId: initialCorrelationId,
          message: `SmokeWorker rejected job ${job.id}: durable outbox event ${data.outboxId} not found in database`,
          metadata: {
            jobId: job.id,
            outboxId: data.outboxId,
          },
        })
      );
      return { success: false, duplicate: false };
    }

    if (outboxRecord.event_type !== QUEUE_SMOKE_EVENT_TYPE) {
      console.error(
        formatStructuredLog({
          level: 'error',
          service: 'worker',
          correlationId: initialCorrelationId,
          message: `SmokeWorker rejected job ${job.id}: durable outbox event ${data.outboxId} has unsupported type '${outboxRecord.event_type}'`,
          metadata: {
            jobId: job.id,
            outboxId: data.outboxId,
            eventType: outboxRecord.event_type,
          },
        })
      );
      return { success: false, duplicate: false };
    }

    // Derive correlationId and payload strictly from durable outbox record (Finding 2)
    const correlationId = normalizeCorrelationId(outboxRecord.correlation_id || data.correlationId);
    const payload = (outboxRecord.payload as Record<string, unknown>) || data.payload;

    const tracer = getTracer('shipde-worker');
    return withSpan(
      tracer,
      'smoke.process',
      async () => {
        console.log(
          formatStructuredLog({
            level: 'info',
            service: 'worker',
            correlationId,
            message: `Processing smoke job ${job.id} for outbox event ${data.outboxId}`,
            metadata: {
              jobId: job.id,
              smokeId: data.smokeId,
              outboxId: data.outboxId,
            },
          })
        );

        const jobId = job.id || data.smokeId;
        const dedupKey = `smoke:dedup:${jobId}`;

        // 4. Redis Deduplication Guard (AC-FOUND-03-10)
        if (this.redisService) {
          try {
            const redis = this.redisService.getClient();
            if (redis.status !== 'ready') {
              await redis.connect();
            }
            const acquired = await redis.set(dedupKey, '1', 'EX', 86400, 'NX');
            if (!acquired) {
              // Reconcile against durable database state before acknowledging duplicate
              if (outboxRecord.status === OutboxStatusEnum.PUBLISHED) {
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
            }
          } catch {
            // Fall through to database guard if Redis fails
          }
        }

        try {
          // 5. Database Outbox State Deduplication Guard
          if (outboxRecord.status === OutboxStatusEnum.PUBLISHED) {
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
          const claimEffect = await this.prisma.outboxEvent.updateMany({
            where: {
              id: data.outboxId,
              event_type: QUEUE_SMOKE_EVENT_TYPE,
              status: { in: [OutboxStatusEnum.PROCESSING, OutboxStatusEnum.PENDING] },
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
                payload,
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
      },
      {
        'job.id': job.id || '',
        'outbox.id': data.outboxId || '',
        correlation_id: correlationId,
      }
    );
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
        const updateResult = await this.prisma.outboxEvent.updateMany({
          where: {
            id: job.data.outboxId,
            event_type: QUEUE_SMOKE_EVENT_TYPE,
            status: OutboxStatusEnum.PROCESSING,
          },
          data: {
            attempts,
            last_error: sanitizedError,
            status: isExhausted ? OutboxStatusEnum.FAILED : OutboxStatusEnum.PROCESSING,
          },
        });

        if (updateResult.count === 0) {
          console.log(
            formatStructuredLog({
              level: 'warn',
              service: 'worker',
              correlationId,
              message: `Ignoring late failure update for outbox event ${job.data.outboxId}: already transitioned out of PROCESSING`,
              metadata: {
                outboxId: job.data.outboxId,
                jobId: job.id,
              },
            })
          );
        }
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
