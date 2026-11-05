import { Injectable, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { tenantRlsExtension } from './tenant-rls.extension';

function createExtendedClient(client: PrismaClient) {
  return client.$extends(tenantRlsExtension(client));
}

export type ExtendedPrismaClient = ReturnType<typeof createExtendedClient>;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  /**
   * Client extended with the tenant RLS pilot (TASK-AI-154). Services that
   * read or write RLS-protected tenant-owned tables (currently: orders) must
   * use this client so the Postgres policy applies on top of the
   * service-level merchant_id filters.
   */
  readonly extended: ExtendedPrismaClient;

  /**
   * No constructor parameters: Nest must be able to instantiate this
   * provider without any injection token, otherwise bootstrap fails with
   * "Nest can't resolve dependencies of the PrismaService" and the HTTP
   * server (including /health/live) never starts. Tests that need custom
   * datasource options use `PrismaService.withOptions(...)`.
   */
  constructor(@Optional() options?: ConstructorParameters<typeof PrismaClient>[0]) {
    super(options);
    this.extended = createExtendedClient(this);
  }

  async onModuleInit(): Promise<void> {
    // Non-blocking initial connection: do not await $connect() during module bootstrap.
    // A slow, unreachable, or blackholed database must never block Nest bootstrap
    // or prevent the HTTP server from immediately serving /health/live.
    void this.$connect().catch(() => {
      // Detached connect failure is handled gracefully; readiness probe will report down.
    });
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
   * Executes a lightweight SELECT 1 with an internal timeout.
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
