import { Injectable, Inject, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { StorageService } from '../storage/storage.service';
import { RbacService } from '../rbac/rbac.service';
import { ReadinessDependencyChecks } from '@shipde/contracts';

@Injectable()
export class HealthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(StorageService) private readonly storage: StorageService,
    @Optional() @Inject(RbacService) private readonly rbacService?: RbacService
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

    let isRbacReady = true;
    if (this.rbacService) {
      isRbacReady = this.rbacService.isReady();
      checks.rbac = isRbacReady ? 'up' : 'down';
    }

    const isReady = database === 'up' && redis === 'up' && storage === 'up' && isRbacReady;
    return { isReady, checks };
  }
}
