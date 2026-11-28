import { Injectable, Inject, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Worker, Job } from 'bullmq';
import { OutboxStatusEnum } from '@prisma/client';
import { NOTIFICATION_EVENT, NOTIFICATION_QUEUE_NAME } from '@shipde/contracts';
import {
  AppConfig,
  formatStructuredLog,
  normalizeCorrelationId,
  sanitizeErrorMessage,
} from '@shipde/config';
import { PrismaService } from '../prisma/prisma.service';
import { APP_CONFIG } from '../config.token';
import { NotificationProcessor } from './notification.processor';

export interface NotificationJobData {
  outboxId: string;
  attempt?: number;
  correlationId: string;
  eventType: typeof NOTIFICATION_EVENT;
  payload: Record<string, unknown>;
  idempotencyKey?: string;
  traceContext?: Record<string, string>;
}

@Injectable()
export class NotificationsWorker implements OnModuleInit, OnModuleDestroy {
  private worker: Worker<NotificationJobData> | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(NotificationProcessor) private readonly processor: NotificationProcessor
  ) {}

  async onModuleInit(options?: { prefix?: string }): Promise<void> {
    this.worker = new Worker<NotificationJobData>(
      NOTIFICATION_QUEUE_NAME,
      async (job: Job<NotificationJobData>) => {
        await this.handleJob(job.data);
      },
      {
        connection: {
          host: this.config.REDIS_HOST,
          port: this.config.REDIS_PORT,
          password: this.config.REDIS_PASSWORD,
        },
        ...(options?.prefix ? { prefix: options.prefix } : {}),
        concurrency: 2,
      }
    );

    this.worker.on('error', (err: Error) => {
      console.error(
        formatStructuredLog({
          level: 'error',
          service: 'worker',
          message: `NotificationsWorker Redis/BullMQ error: ${sanitizeErrorMessage(err)}`,
        })
      );
    });
  }

  async handleJob(data: NotificationJobData): Promise<void> {
    const correlationId = normalizeCorrelationId(data.correlationId);
    if (data.eventType !== NOTIFICATION_EVENT) {
      throw new Error(`NotificationsWorker rejected unexpected eventType: ${data.eventType}`);
    }

    // Generation guard: ignore stale/replayed jobs whose outbox row is no longer PROCESSING at this attempt
    const activeRow = await this.prisma.outboxEvent.findFirst({
      where: {
        id: data.outboxId,
        event_type: NOTIFICATION_EVENT,
        status: OutboxStatusEnum.PROCESSING,
        ...(data.attempt !== undefined ? { attempts: data.attempt } : {}),
      },
      select: { id: true, attempts: true },
    });
    if (!activeRow) {
      return;
    }

    const result = await this.processor.processEnvelope(data.payload, correlationId);
    if (result.status === 'DEAD_LETTER_INVALID_CONTRACT') {
      await this.prisma.outboxEvent.updateMany({
        where: {
          id: data.outboxId,
          event_type: NOTIFICATION_EVENT,
          status: OutboxStatusEnum.PROCESSING,
          attempts: activeRow.attempts,
        },
        data: {
          status: OutboxStatusEnum.FAILED,
          last_error: sanitizeErrorMessage(result.error || 'INVALID_NOTIFICATION_CONTRACT'),
        },
      });
      return;
    }

    await this.prisma.outboxEvent.updateMany({
      where: {
        id: data.outboxId,
        event_type: NOTIFICATION_EVENT,
        status: OutboxStatusEnum.PROCESSING,
        attempts: activeRow.attempts,
      },
      data: {
        status: OutboxStatusEnum.PUBLISHED,
        published_at: new Date(),
        last_error: null,
      },
    });

    console.log(
      formatStructuredLog({
        level: 'info',
        service: 'worker',
        correlationId,
        message: `Processed notification outbox ${data.outboxId}`,
        metadata: {
          outboxId: data.outboxId,
          status: result.status,
          recipientCount: result.recipientCount,
          resolvedCount: result.resolvedCount,
        },
      })
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }
}
