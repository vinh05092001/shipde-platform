import { Injectable, Inject, OnModuleDestroy } from '@nestjs/common';
import { S3Client, HeadBucketCommand } from '@aws-sdk/client-s3';
import { AppConfig } from '@shipde/config';
import { APP_CONFIG } from '../config.token';

@Injectable()
export class StorageService implements OnModuleDestroy {
  private client: S3Client | null = null;
  private readonly config: AppConfig;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.config = config;
  }

  getClient(): S3Client {
    if (!this.client) {
      this.client = new S3Client({
        endpoint: this.config.S3_ENDPOINT,
        region: this.config.S3_REGION,
        credentials: {
          accessKeyId: this.config.S3_ACCESS_KEY,
          secretAccessKey: this.config.S3_SECRET_KEY,
        },
        forcePathStyle: this.config.S3_FORCE_PATH_STYLE,
      });
    }
    return this.client;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      this.client.destroy();
      this.client = null;
    }
  }

  /**
   * Bounded S3 storage readiness check.
   * Executes HeadBucketCommand scoped to the configured bucket with an internal timeout (Finding 9).
   */
  async checkReadiness(timeoutMs = 2000): Promise<'up' | 'down'> {
    try {
      const s3 = this.getClient();
      const checkPromise = s3.send(
        new HeadBucketCommand({
          Bucket: this.config.S3_BUCKET,
        })
      );
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('S3 check timeout')), timeoutMs)
      );

      await Promise.race([checkPromise, timeoutPromise]);
      return 'up';
    } catch {
      return 'down';
    }
  }
}
