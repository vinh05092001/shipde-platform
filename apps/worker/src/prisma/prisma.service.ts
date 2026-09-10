import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
    } catch {
      // Do not abort Worker bootstrap when database is unavailable.
      // Liveness (/health/live) remains available, while readiness (/health/ready) reports 503.
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.$disconnect();
    } catch {
      // Ignore disconnect errors during teardown
    }
  }

  /**
   * Bounded database readiness check.
   */
  async checkReadiness(timeoutMs = 2000): Promise<'up' | 'down'> {
    try {
      const queryPromise = this.$queryRaw`SELECT 1`;
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Database check timeout')), timeoutMs)
      );

      await Promise.race([queryPromise, timeoutPromise]);
      return 'up';
    } catch {
      return 'down';
    }
  }
}
