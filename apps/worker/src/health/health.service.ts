import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { StorageService } from '../storage/storage.service';
import { ReadinessDependencyChecks } from '@shipde/contracts';

@Injectable()
export class HealthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(StorageService) private readonly storage: StorageService
  ) {}

  async checkReadiness(): Promise<{ isReady: boolean; checks: ReadinessDependencyChecks }> {
    const [database, redis, storage] = await Promise.all([
      this.prisma.checkReadiness(),
      this.redis.checkReadiness(),
      this.storage.checkReadiness(),
    ]);

    const checks: ReadinessDependencyChecks = {
      database,
      redis,
      storage,
    };

    const isReady = database === 'up' && redis === 'up' && storage === 'up';
    return { isReady, checks };
  }
}
