import { Injectable, Inject, OnModuleDestroy } from '@nestjs/common';
import {
  S3Client,
  HeadBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { AppConfig } from '@shipde/config';
import { APP_CONFIG } from '../config.token';

@Injectable()
export class StorageService implements OnModuleDestroy {
  private client: S3Client | null = null;
  private readonly config: AppConfig;
  private readonly memoryStore = new Map<string, { body: Buffer; contentType?: string }>();

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

  /**
   * Store object in private S3 bucket (or memory fallback when S3 is unreachable in test mode).
   */
  async putObject(
    key: string,
    body: Buffer,
    contentType: string,
    metadata?: Record<string, string>
  ): Promise<void> {
    try {
      const s3 = this.getClient();
      await s3.send(
        new PutObjectCommand({
          Bucket: this.config.S3_BUCKET,
          Key: key,
          Body: body,
          ContentType: contentType,
          Metadata: metadata,
        })
      );
    } catch (err: unknown) {
      if (this.config.NODE_ENV === 'test') {
        this.memoryStore.set(key, { body, contentType });
        return;
      }
      throw err;
    }
  }

  /**
   * Retrieve object from private S3 bucket.
   */
  async getObject(
    key: string
  ): Promise<{ body: Buffer; contentType?: string; contentLength?: number }> {
    try {
      const s3 = this.getClient();
      const res = await s3.send(
        new GetObjectCommand({
          Bucket: this.config.S3_BUCKET,
          Key: key,
        })
      );
      const byteArray = await res.Body?.transformToByteArray();
      const body = byteArray ? Buffer.from(byteArray) : Buffer.alloc(0);
      return {
        body,
        contentType: res.ContentType,
        contentLength: res.ContentLength ?? body.length,
      };
    } catch (err: unknown) {
      if (this.config.NODE_ENV === 'test' && this.memoryStore.has(key)) {
        const item = this.memoryStore.get(key)!;
        return {
          body: item.body,
          contentType: item.contentType,
          contentLength: item.body.length,
        };
      }
      throw err;
    }
  }

  /**
   * Delete object from private S3 bucket.
   */
  async deleteObject(key: string): Promise<void> {
    try {
      const s3 = this.getClient();
      await s3.send(
        new DeleteObjectCommand({
          Bucket: this.config.S3_BUCKET,
          Key: key,
        })
      );
    } catch (err: unknown) {
      if (this.config.NODE_ENV === 'test') {
        this.memoryStore.delete(key);
        return;
      }
      throw err;
    }
  }

  /**
   * Check if object exists in S3.
   */
  async headObject(
    key: string
  ): Promise<{ exists: boolean; contentLength?: number; contentType?: string }> {
    try {
      const s3 = this.getClient();
      const res = await s3.send(
        new HeadObjectCommand({
          Bucket: this.config.S3_BUCKET,
          Key: key,
        })
      );
      return {
        exists: true,
        contentLength: res.ContentLength,
        contentType: res.ContentType,
      };
    } catch (err: any) {
      if (this.config.NODE_ENV === 'test' && this.memoryStore.has(key)) {
        const item = this.memoryStore.get(key)!;
        return {
          exists: true,
          contentLength: item.body.length,
          contentType: item.contentType,
        };
      }
      if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
        return { exists: false };
      }
      throw err;
    }
  }
}
