import { Injectable, Inject, OnModuleDestroy } from '@nestjs/common';
import { S3Client, HeadBucketCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import * as fs from 'fs';
import * as path from 'path';
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

  /**
   * Puts an object into private S3 storage (FEAT-COM-04).
   * Falls back gracefully to local disk storage, actually persisting bytes so raw files are never lost.
   * Throws if both S3 and local disk persistence fail.
   */
  async putObject(
    key: string,
    body: Buffer | Uint8Array | string,
    contentType?: string
  ): Promise<string> {
    try {
      const s3 = this.getClient();
      await s3.send(
        new PutObjectCommand({
          Bucket: this.config.S3_BUCKET,
          Key: key,
          Body: body,
          ContentType: contentType,
        })
      );
      return `s3://${this.config.S3_BUCKET}/${key}`;
    } catch (s3Err) {
      try {
        const localBaseDir = process.env.LOCAL_STORAGE_DIR || path.join(process.cwd(), '.storage');
        const targetPath = path.join(localBaseDir, key);
        await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
        const buf = Buffer.isBuffer(body)
          ? body
          : typeof body === 'string'
            ? Buffer.from(body, 'utf8')
            : Buffer.from(body);
        await fs.promises.writeFile(targetPath, buf);
        return `local://${key}`;
      } catch (localErr) {
        throw new Error(
          `Storage persistence failed: S3 error: ${(s3Err as Error).message}; local error: ${(localErr as Error).message}`
        );
      }
    }
  }
}
