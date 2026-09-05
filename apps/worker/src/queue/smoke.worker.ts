import { Injectable, Inject, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Worker, Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { AppConfig, formatStructuredLog, normalizeCorrelationId } from '@shipde/config';
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
    private readonly prisma: PrismaService
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

    this.worker.on('failed', (job, err) => {
      const correlationId = job?.data?.correlationId || normalizeCorrelationId();
      console.error(
        formatStructuredLog({
          level: 'error',
          service: 'worker',
          correlationId,
          message: `Job ${job?.id} in ${SMOKE_QUEUE_NAME} failed: ${err.message}`,
        })
      );
    });
  }

  async processJob(job: Job<SmokeJobData>): Promise<{ success: boolean; duplicate: boolean }> {
    const data = job.data;
    const correlationId = normalizeCorrelationId(data.correlationId);

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

    // Idempotency & Deduplication Guard
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

      // Execute deterministic smoke side effect: transition outbox event to PUBLISHED
      await this.prisma.outboxEvent.update({
        where: { id: data.outboxId },
        data: {
          status: OutboxStatusEnum.PUBLISHED,
          published_at: new Date(),
          attempts: { increment: 1 },
        },
      });
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
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }
}
