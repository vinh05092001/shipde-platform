import { Injectable, Inject, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfig } from '@shipde/config';
import { APP_CONFIG } from '../config.token';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private client: Redis | null = null;
  private readonly config: AppConfig;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.config = config;
  }

  getClient(): Redis {
    if (!this.client) {
      this.client = new Redis({
        host: this.config.REDIS_HOST,
        port: this.config.REDIS_PORT,
        password: this.config.REDIS_PASSWORD,
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        connectTimeout: 2000,
        retryStrategy: () => null,
      });
      this.client.on('error', () => {
        // Prevent unhandled error event on connection loss/refusal
      });
    }
    return this.client;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      try {
        await this.client.quit();
      } catch {
        this.client.disconnect();
      }
      this.client = null;
    }
  }

  /**
   * Bounded Redis readiness check.
   */
  async checkReadiness(timeoutMs = 2000): Promise<'up' | 'down'> {
    try {
      const redis = this.getClient();
      if (redis.status !== 'ready') {
        await redis.connect();
      }

      const pingPromise = redis.ping();
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Redis check timeout')), timeoutMs)
      );

      const res = await Promise.race([pingPromise, timeoutPromise]);
      return res === 'PONG' ? 'up' : 'down';
    } catch {
      return 'down';
    }
  }
}
