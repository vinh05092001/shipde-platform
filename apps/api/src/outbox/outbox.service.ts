import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, OutboxEvent, OutboxStatusEnum } from '@prisma/client';

@Injectable()
export class OutboxService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persists an outbox event within an existing database transaction client.
   * Proves atomic commit / rollback with application entity mutations.
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
   */
  async createOutboxEvent(data: {
    eventType: string;
    payload: Prisma.InputJsonValue;
    correlationId: string;
    idempotencyKey?: string;
  }): Promise<OutboxEvent> {
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

  async markPublished(id: string): Promise<OutboxEvent> {
    return this.prisma.outboxEvent.update({
      where: { id },
      data: {
        status: OutboxStatusEnum.PUBLISHED,
        published_at: new Date(),
      },
    });
  }

  async recordFailure(id: string, error: string, maxAttempts = 3): Promise<OutboxEvent> {
    const existing = await this.prisma.outboxEvent.findUnique({ where: { id } });
    const nextAttempts = (existing?.attempts || 0) + 1;
    const isExhausted = nextAttempts >= maxAttempts;

    return this.prisma.outboxEvent.update({
      where: { id },
      data: {
        attempts: nextAttempts,
        last_error: error,
        status: isExhausted ? OutboxStatusEnum.FAILED : OutboxStatusEnum.PENDING,
      },
    });
  }
}
