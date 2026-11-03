import type { ModuleMetadata } from '@nestjs/common';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import {
  createLocalTestDatabase,
  createValidTestConfig,
  isLocalTestDb,
  type LocalTestDatabase,
} from '@shipde/testkit';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import { StorageService } from '../src/storage/storage.service';
import { APP_CONFIG } from '../src/config.token';
import { RateLimitService } from '../src/auth/rate-limit.service';

export {
  describeDatabaseTarget,
  isLocalTestDb,
  skipLocalDbTest,
  LOCAL_DB_CONNECTION_REASON,
  skipSecretsScanWhenGitleaksMissing,
} from '@shipde/testkit';

/** Test-only override: production PrismaService and default CI providers are unchanged. */
export function createApiTestModule(metadata: ModuleMetadata): TestingModuleBuilder {
  const builder = Test.createTestingModule(metadata);
  if (!isLocalTestDb()) return builder;
  if (process.env.NODE_ENV === 'production')
    throw new Error('TEST_DB=local is forbidden in production');
  let database: Promise<LocalTestDatabase<PrismaService>> | undefined;
  return (
    builder
      .overrideProvider(APP_CONFIG)
      .useValue(createValidTestConfig({ CARRIER_MODE: 'disabled' }))
      .overrideProvider(PrismaService)
      .useFactory({
        async factory() {
          // Several Nest modules provide PrismaService; all must use the same database.
          database ??= createLocalTestDatabase(PrismaService);
          const db = await database;
          db.prisma.onModuleDestroy = db.close;
          const originalCheckReadiness = db.prisma.checkReadiness.bind(db.prisma);
          db.prisma.checkReadiness = (timeoutMs = 15_000) => originalCheckReadiness(timeoutMs);
          return db.prisma;
        },
      })
      // Run the actual service's no-Redis backend. Distributed/Lua behavior remains CI-only.
      .overrideProvider(RateLimitService)
      .useValue(new RateLimitService())
      .overrideProvider(RedisService)
      .useValue({
        getClient() {
          // Unexpected infrastructure usage must not open sockets or fake readiness.
          throw new Error('TEST_DB=local: Redis is unavailable');
        },
        async checkReadiness() {
          return 'down';
        },
      })
      .overrideProvider(StorageService)
      .useValue({
        getClient() {
          throw new Error('TEST_DB=local: MinIO requires CI');
        },
        async checkReadiness() {
          return 'down';
        },
      })
  );
}
