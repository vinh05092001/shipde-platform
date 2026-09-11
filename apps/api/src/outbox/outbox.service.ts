import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, OutboxEvent, OutboxStatusEnum } from '@prisma/client';
import { QUEUE_SMOKE_EVENT_TYPE } from '@shipde/contracts';

@Injectable()
export class OutboxService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persists an outbox event within an existing database transaction client.
   * Proves atomic commit / rollback with application entity mutations.
   * Strictly enforces event allowlist to prevent unprocessable events (Finding 6).
   */
  async createWithinTransaction(
    tx: Prisma.TransactionClient,
    data: {
      eventType: string;
      payload: Prisma.InputJsonValue;
      correlationId: string;
      idempotencyKey?: string;
    }
  ): Promise<OutboxEvent> {
    if (data.eventType !== QUEUE_SMOKE_EVENT_TYPE) {
      throw new Error(
        `Unsupported outbox event type: '${data.eventType}'. Foundation dispatcher only processes '${QUEUE_SMOKE_EVENT_TYPE}'.`
      );
    }

    return tx.outboxEvent.create({
      data: {
        event_type: data.eventType,
        payload: data.payload,
        correlation_id: data.correlationId,
        idempotency_key: data.idempotencyKey,
        status: OutboxStatusEnum.PENDING,
      },
    });
  }

  /**
   * Directly creates an outbox event using default client transaction.
   * Strictly enforces event allowlist to prevent unprocessable events (Finding 6).
   */
  async createOutboxEvent(data: {
    eventType: string;
    payload: Prisma.InputJsonValue;
    correlationId: string;
    idempotencyKey?: string;
  }): Promise<OutboxEvent> {
    if (data.eventType !== QUEUE_SMOKE_EVENT_TYPE) {
      throw new Error(
        `Unsupported outbox event type: '${data.eventType}'. Foundation dispatcher only processes '${QUEUE_SMOKE_EVENT_TYPE}'.`
      );
    }

    return this.prisma.outboxEvent.create({
      data: {
        event_type: data.eventType,
        payload: data.payload,
        correlation_id: data.correlationId,
        idempotency_key: data.idempotencyKey,
        status: OutboxStatusEnum.PENDING,
      },
    });
  }

  async getPendingEvents(limit = 10): Promise<OutboxEvent[]> {
    return this.prisma.outboxEvent.findMany({
      where: {
        status: OutboxStatusEnum.PENDING,
        scheduled_at: { lte: new Date() },
      },
      take: limit,
      orderBy: { scheduled_at: 'asc' },
    });
  }

  /**
   * Atomically transitions an outbox event to PUBLISHED state.
   * Strictly requires in-flight status (PENDING or PROCESSING) to prevent regressing or corrupting states (Finding 3).
   */
  async markPublished(id: string): Promise<OutboxEvent> {
    const updateResult = await this.prisma.outboxEvent.updateMany({
      where: {
        id,
        status: { in: [OutboxStatusEnum.PENDING, OutboxStatusEnum.PROCESSING] },
      },
      data: {
        status: OutboxStatusEnum.PUBLISHED,
        published_at: new Date(),
        last_error: null,
      },
    });

    if (updateResult.count === 0) {
      const existing = await this.prisma.outboxEvent.findUnique({ where: { id } });
      if (!existing) {
        throw new Error(`Outbox event ${id} not found`);
      }
      if (existing.status === OutboxStatusEnum.PUBLISHED) {
        return existing;
      }
      throw new Error(
        `Cannot mark outbox event ${id} as PUBLISHED from invalid status ${existing.status}`
      );
    }

    return this.prisma.outboxEvent.findUniqueOrThrow({ where: { id } });
  }

  /**
   * Records failure and schedules bounded retry.
   * Uses atomic conditional predicate requiring in-flight status to ensure that a late failure
   * can NEVER regress a concurrently PUBLISHED event to PENDING or FAILED (Finding 3).
   */
  async recordFailure(id: string, error: string, maxAttempts = 3): Promise<OutboxEvent> {
    const existing = await this.prisma.outboxEvent.findUnique({ where: { id } });
    if (!existing) {
      throw new Error(`Outbox event ${id} not found`);
    }
    if (existing.status === OutboxStatusEnum.PUBLISHED) {
      throw new Error(`Cannot record failure for outbox event ${id}: already PUBLISHED`);
    }

    const nextAttempts = existing.attempts + 1;
    const isExhausted = nextAttempts >= maxAttempts;

    const updateResult = await this.prisma.outboxEvent.updateMany({
      where: {
        id,
        status: { in: [OutboxStatusEnum.PENDING, OutboxStatusEnum.PROCESSING] },
        attempts: existing.attempts,
      },
      data: {
        attempts: nextAttempts,
        last_error: error,
        status: isExhausted ? OutboxStatusEnum.FAILED : OutboxStatusEnum.PENDING,
      },
    });

    if (updateResult.count === 0) {
      const current = await this.prisma.outboxEvent.findUniqueOrThrow({ where: { id } });
      if (current.status === OutboxStatusEnum.PUBLISHED) {
        throw new Error(`Cannot record failure for outbox event ${id}: already PUBLISHED`);
      }
      throw new Error(
        `Failed to record failure for outbox event ${id} due to concurrent state transition`
      );
    }

    return this.prisma.outboxEvent.findUniqueOrThrow({ where: { id } });
  }
}
