import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { createHash } from 'node:crypto';
import {
  validateUploadAttachmentDto,
  validateDeleteAttachmentDto,
  validateBulkDeleteDto,
  maskAttachmentAuditValue,
  maskAttachmentAuditObject,
  sanitizeFileName,
} from './attachments.dto';
import { AttachmentsService } from './attachments.service';
import { CanonicalApiException } from '../auth/auth.service';
import type { ActorContext } from '../rbac/rbac.dto';
import { AppConfig, validateConfig } from '@shipde/config';

function createMockAppConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const base = validateConfig({
    NODE_ENV: 'test',
    PORT: '3001',
    WORKER_HEALTH_PORT: '3002',
    DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/shipde_dev',
    REDIS_HOST: 'localhost',
    REDIS_PORT: '6379',
    S3_ENDPOINT: 'http://localhost:9000',
    S3_REGION: 'us-east-1',
    S3_ACCESS_KEY: 'minioadmin',
    S3_SECRET_KEY: 'minioadmin',
    S3_BUCKET: 'test-bucket',
    S3_FORCE_PATH_STYLE: 'true',
    CARRIER_MODE: 'disabled',
    MAX_ATTACHMENT_SIZE_BYTES: '10485760',
    ATTACHMENT_DEFAULT_RETENTION_DAYS: '90',
    ATTACHMENT_DOWNLOAD_TTL_SECONDS: '300',
  });
  return { ...base, ...overrides };
}

describe('FEAT-COM-06: Attachments Unit Test Suite', () => {
  const maxSizeBytes = 10 * 1024 * 1024; // 10MB

  describe('DTO Validation: validateUploadAttachmentDto', () => {
    it('should validate valid image upload payload', () => {
      const content = Buffer.from('fake image content').toString('base64');
      const res = validateUploadAttachmentDto(
        {
          file_name: 'damaged_box.png',
          mime_type: 'image/png',
          content_base64: content,
          entity_type: 'RETURN',
        },
        maxSizeBytes
      );
      assert.strictEqual(res.valid, true);
      assert.ok(res.buffer);
      assert.strictEqual(res.buffer.toString(), 'fake image content');
    });

    it('should validate valid PDF document upload payload', () => {
      const content = Buffer.from('%PDF-1.4 test document').toString('base64');
      const res = validateUploadAttachmentDto(
        {
          file_name: 'carrier_claim.pdf',
          mime_type: 'application/pdf',
          content_base64: content,
          entity_type: 'CLAIM',
        },
        maxSizeBytes
      );
      assert.strictEqual(res.valid, true);
      assert.ok(res.buffer);
    });

    it('should reject disallowed file extensions (.exe, .html, .svg) with INVALID_FILE_TYPE', () => {
      const dangerousFiles = ['malware.exe', 'script.html', 'vector.svg', 'payload.sh'];
      for (const fileName of dangerousFiles) {
        const content = Buffer.from('dangerous content').toString('base64');
        const res = validateUploadAttachmentDto(
          {
            file_name: fileName,
            mime_type: 'image/png',
            content_base64: content,
          },
          maxSizeBytes
        );
        assert.strictEqual(res.valid, false);
        assert.strictEqual(res.errorCode, 'INVALID_FILE_TYPE');
      }
    });

    it('should reject unapproved MIME types with INVALID_FILE_TYPE', () => {
      const content = Buffer.from('raw binary').toString('base64');
      const res = validateUploadAttachmentDto(
        {
          file_name: 'test.zip',
          mime_type: 'application/zip',
          content_base64: content,
        },
        maxSizeBytes
      );
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.errorCode, 'INVALID_FILE_TYPE');
    });

    it('should reject empty file content with EMPTY_FILE', () => {
      const res = validateUploadAttachmentDto(
        {
          file_name: 'empty.png',
          mime_type: 'image/png',
          content_base64: '',
        },
        maxSizeBytes
      );
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.errorCode, 'EMPTY_FILE');
    });

    it('should reject file exceeding configured maximum size with FILE_TOO_LARGE', () => {
      const smallLimit = 50;
      const oversizedContent = Buffer.alloc(100, 'x').toString('base64');
      const res = validateUploadAttachmentDto(
        {
          file_name: 'big.png',
          mime_type: 'image/png',
          content_base64: oversizedContent,
        },
        smallLimit
      );
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.errorCode, 'FILE_TOO_LARGE');
    });

    it('should reject invalid entity_type with VALIDATION_ERROR', () => {
      const content = Buffer.from('valid content').toString('base64');
      const res = validateUploadAttachmentDto(
        {
          file_name: 'evidence.png',
          mime_type: 'image/png',
          content_base64: content,
          entity_type: 'UNKNOWN_ENTITY',
        },
        maxSizeBytes
      );
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.errorCode, 'VALIDATION_ERROR');
    });
  });

  describe('DTO Validation: validateDeleteAttachmentDto and validateBulkDeleteDto', () => {
    it('validateDeleteAttachmentDto rejects when confirm is not true', () => {
      const res = validateDeleteAttachmentDto({});
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.errorCode, 'CONFIRMATION_REQUIRED');
    });

    it('validateDeleteAttachmentDto passes when confirm is true', () => {
      const res = validateDeleteAttachmentDto({ confirm: true });
      assert.strictEqual(res.valid, true);
    });

    it('validateBulkDeleteDto rejects without confirm', () => {
      const res = validateBulkDeleteDto({
        ids: ['11111111-1111-1111-1111-111111111111'],
      });
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.errorCode, 'CONFIRMATION_REQUIRED');
    });

    it('validateBulkDeleteDto rejects empty ids array', () => {
      const res = validateBulkDeleteDto({
        ids: [],
        confirm: true,
      });
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.errorCode, 'VALIDATION_ERROR');
    });

    it('validateBulkDeleteDto rejects invalid UUID format in ids', () => {
      const res = validateBulkDeleteDto({
        ids: ['not-a-valid-uuid'],
        confirm: true,
      });
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.errorCode, 'VALIDATION_ERROR');
    });
  });

  describe('Audit Log Masking: maskAttachmentAuditValue', () => {
    it('masks sensitive fields including phone and email', () => {
      assert.strictEqual(maskAttachmentAuditValue('phone', '0901234567'), '090****567');
      assert.strictEqual(
        maskAttachmentAuditValue('contact_email', 'ops@shipde.vn'),
        'o*s@shipde.vn'
      );
    });

    it('recursively masks sensitive fields in metadata object', () => {
      const meta = {
        scan_agent: 'Device-Camera-01',
        customer_phone: '0987654321',
        details: {
          recipient_phone: '0912345678',
          verified: true,
        },
      };
      const masked = maskAttachmentAuditObject(meta) as any;
      assert.strictEqual(masked.scan_agent, 'Device-Camera-01');
      assert.strictEqual(masked.customer_phone, '098****321');
      assert.strictEqual(masked.details.recipient_phone, '091****678');
      assert.strictEqual(masked.details.verified, true);
    });
  });

  describe('AttachmentsService Operations', () => {
    function setupService() {
      const attachmentsTable: any[] = [];
      const auditLogs: any[] = [];
      const s3Storage = new Map<string, { body: Buffer; contentType?: string }>();

      const mockUsers: any[] = [
        {
          id: 'u-owner-1',
          role: 'OWNER',
          store_scopes: ['*'],
          warehouse_scopes: ['*'],
        },
        {
          id: 'u-scoped-hcm',
          role: 'WAREHOUSE',
          store_scopes: ['branch-hcm'],
          warehouse_scopes: ['wh-hcm-01'],
        },
        {
          id: 'u-empty-scopes',
          role: 'WAREHOUSE',
          store_scopes: [],
          warehouse_scopes: [],
        },
      ];

      const mockPrisma: any = {
        attachment: {
          create: async ({ data }: any) => {
            const row = {
              id: data.id || `att-${Date.now()}`,
              ...data,
              created_at: new Date(),
              updated_at: new Date(),
            };
            attachmentsTable.push(row);
            return row;
          },
          findFirst: async ({ where }: any) => {
            return (
              attachmentsTable.find((a) => {
                if (where.id && a.id !== where.id) return false;
                if (where.merchant_id && a.merchant_id !== where.merchant_id) return false;
                if (where.status?.not && a.status === where.status.not) return false;
                return true;
              }) || null
            );
          },
          findMany: async ({ where, skip, take, orderBy }: any) => {
            let filtered = attachmentsTable.filter((a) => {
              if (where.merchant_id && a.merchant_id !== where.merchant_id) return false;
              if (where.status && a.status !== where.status) return false;
              if (where.entity_type && a.entity_type !== where.entity_type) return false;
              if (where.entity_id && a.entity_id !== where.entity_id) return false;
              if (where.warehouse_id && a.warehouse_id !== where.warehouse_id) return false;
              if (where.branch_id && a.branch_id !== where.branch_id) return false;
              if (where.expires_at?.lte && new Date(a.expires_at) > where.expires_at.lte)
                return false;

              if (where.AND) {
                for (const cond of where.AND) {
                  if (cond.OR) {
                    const matchOr = cond.OR.some((orClause: any) => {
                      if (orClause.warehouse_id === null && a.warehouse_id === null) return true;
                      if (
                        orClause.warehouse_id?.in &&
                        orClause.warehouse_id.in.includes(a.warehouse_id)
                      )
                        return true;
                      if (orClause.branch_id === null && a.branch_id === null) return true;
                      if (orClause.branch_id?.in && orClause.branch_id.in.includes(a.branch_id))
                        return true;
                      return false;
                    });
                    if (!matchOr) return false;
                  }
                }
              }
              return true;
            });

            if (skip !== undefined && take !== undefined) {
              filtered = filtered.slice(skip, skip + take);
            }
            return filtered;
          },
          count: async ({ where }: any) => {
            const list = await mockPrisma.attachment.findMany({ where });
            return list.length;
          },
          update: async ({ where, data }: any) => {
            const idx = attachmentsTable.findIndex((a) => a.id === where.id);
            if (idx === -1) throw new Error('Not found');
            attachmentsTable[idx] = { ...attachmentsTable[idx], ...data, updated_at: new Date() };
            return attachmentsTable[idx];
          },
        },
        user: {
          findFirst: async ({ where }: any) => {
            return mockUsers.find((u) => u.id === where.id) || null;
          },
        },
        auditLog: {
          create: async ({ data }: any) => {
            const row = { id: `audit-${Date.now()}`, ...data, created_at: new Date() };
            auditLogs.push(row);
            return row;
          },
        },
      };

      const mockStorage: any = {
        putObject: async (key: string, body: Buffer, contentType: string) => {
          s3Storage.set(key, { body, contentType });
        },
        getObject: async (key: string) => {
          const item = s3Storage.get(key);
          if (!item) {
            const err: any = new Error('NoSuchKey');
            err.name = 'NoSuchKey';
            throw err;
          }
          return {
            body: item.body,
            contentType: item.contentType,
            contentLength: item.body.length,
          };
        },
        deleteObject: async (key: string) => {
          s3Storage.delete(key);
        },
        headObject: async (key: string) => {
          return { exists: s3Storage.has(key) };
        },
      };

      const config = createMockAppConfig();
      const service = new AttachmentsService(mockPrisma, mockStorage, config);

      return { service, mockPrisma, mockStorage, attachmentsTable, auditLogs, s3Storage };
    }

    const ownerActor: ActorContext = {
      userId: 'u-owner-1',
      merchantId: 'm-tenant-1',
      role: 'OWNER',
    };

    const scopedActor: ActorContext = {
      userId: 'u-scoped-hcm',
      merchantId: 'm-tenant-1',
      role: 'WAREHOUSE',
    };

    const emptyScopeActor: ActorContext = {
      userId: 'u-empty-scopes',
      merchantId: 'm-tenant-1',
      role: 'WAREHOUSE',
    };

    const foreignTenantActor: ActorContext = {
      userId: 'u-foreign-1',
      merchantId: 'm-tenant-2',
      role: 'OWNER',
    };

    it('AC-COM-06-01: Uploads valid attachment, stores in S3 and writes audit log', async () => {
      const { service, auditLogs, s3Storage } = setupService();
      const buffer = Buffer.from('valid png image bytes');
      const result = await service.uploadAttachment(
        ownerActor,
        {
          file_name: 'return_proof.png',
          mime_type: 'image/png',
          content_base64: buffer.toString('base64'),
          entity_type: 'RETURN',
          entity_id: 'ret-12345',
        },
        buffer,
        '192.168.1.10',
        'corr-01'
      );

      assert.ok(result.id);
      assert.strictEqual(result.file_name, 'return_proof.png');
      assert.strictEqual(result.status, 'ACTIVE');
      assert.strictEqual(result.checksum_sha256, createHash('sha256').update(buffer).digest('hex'));
      assert.strictEqual(result.entity_type, 'RETURN');
      assert.strictEqual(result.entity_id, 'ret-12345');

      // Verify S3 storage
      assert.strictEqual(s3Storage.has(result.storage_key), true);

      // Verify audit log
      const audit = auditLogs.find((a) => a.action === 'ATTACHMENT_UPLOADED');
      assert.ok(audit);
      assert.strictEqual(audit.entity_id, result.id);
    });

    it('AC-COM-06-02: Upload with valid matching client checksum succeeds', async () => {
      const { service } = setupService();
      const buffer = Buffer.from('verified package photo');
      const expectedChecksum = createHash('sha256').update(buffer).digest('hex');

      const result = await service.uploadAttachment(
        ownerActor,
        {
          file_name: 'photo.jpg',
          mime_type: 'image/jpeg',
          content_base64: buffer.toString('base64'),
          checksum_sha256: expectedChecksum,
        },
        buffer,
        '127.0.0.1',
        'corr-02'
      );

      assert.strictEqual(result.checksum_sha256, expectedChecksum);
    });

    it('AC-COM-06-03: Upload with mismatched client checksum throws 400 CHECKSUM_MISMATCH', async () => {
      const { service } = setupService();
      const buffer = Buffer.from('some data');
      const mismatchedChecksum = '0000000000000000000000000000000000000000000000000000000000000000';

      await assert.rejects(
        async () => {
          await service.uploadAttachment(
            ownerActor,
            {
              file_name: 'photo.jpg',
              mime_type: 'image/jpeg',
              content_base64: buffer.toString('base64'),
              checksum_sha256: mismatchedChecksum,
            },
            buffer,
            '127.0.0.1',
            'corr-03'
          );
        },
        (err: any) => {
          assert.strictEqual(err instanceof CanonicalApiException, true);
          assert.strictEqual(err.code, 'CHECKSUM_MISMATCH');
          assert.strictEqual(err.getStatus(), 400);
          return true;
        }
      );
    });

    it('AC-COM-06-04: Upload to unauthorized warehouse outside actor scope throws 403 SCOPE_FORBIDDEN', async () => {
      const { service } = setupService();
      const buffer = Buffer.from('warehouse item');

      await assert.rejects(
        async () => {
          await service.uploadAttachment(
            scopedActor, // Only has scope for wh-hcm-01
            {
              file_name: 'item.png',
              mime_type: 'image/png',
              content_base64: buffer.toString('base64'),
              warehouse_id: 'wh-danang-02', // Unauthorized warehouse
            },
            buffer,
            '127.0.0.1',
            'corr-04'
          );
        },
        (err: any) => {
          assert.strictEqual(err instanceof CanonicalApiException, true);
          assert.strictEqual(err.code, 'SCOPE_FORBIDDEN');
          assert.strictEqual(err.getStatus(), 403);
          return true;
        }
      );
    });

    it('AC-COM-06-05: Upload to authorized warehouse inside actor scope succeeds', async () => {
      const { service } = setupService();
      const buffer = Buffer.from('hcm warehouse item');

      const result = await service.uploadAttachment(
        scopedActor,
        {
          file_name: 'item.png',
          mime_type: 'image/png',
          content_base64: buffer.toString('base64'),
          warehouse_id: 'wh-hcm-01', // Authorized
        },
        buffer,
        '127.0.0.1',
        'corr-05'
      );

      assert.strictEqual(result.warehouse_id, 'wh-hcm-01');
    });

    it('AC-COM-06-07: List attachments returns paginated results', async () => {
      const { service } = setupService();
      const buffer = Buffer.from('sample');
      await service.uploadAttachment(
        ownerActor,
        { file_name: 'f1.png', mime_type: 'image/png', content_base64: buffer.toString('base64') },
        buffer,
        '127.0.0.1',
        'c1'
      );
      await service.uploadAttachment(
        ownerActor,
        { file_name: 'f2.png', mime_type: 'image/png', content_base64: buffer.toString('base64') },
        buffer,
        '127.0.0.1',
        'c2'
      );

      const list = await service.listAttachments(ownerActor, { page: 1, limit: 10 }, 'corr-list');
      assert.strictEqual(list.success, true);
      assert.strictEqual(list.data.length, 2);
      assert.strictEqual(list.meta.total, 2);
    });

    it('AC-COM-06-08: List attachments with FEAT-RBAC-02 warehouse scope filters out unauthorized items', async () => {
      const { service } = setupService();
      const buffer = Buffer.from('data');

      // Attachment for wh-hcm-01
      await service.uploadAttachment(
        ownerActor,
        {
          file_name: 'hcm.png',
          mime_type: 'image/png',
          content_base64: buffer.toString('base64'),
          warehouse_id: 'wh-hcm-01',
        },
        buffer,
        '127.0.0.1',
        'c-hcm'
      );

      // Attachment for wh-danang
      await service.uploadAttachment(
        ownerActor,
        {
          file_name: 'danang.png',
          mime_type: 'image/png',
          content_base64: buffer.toString('base64'),
          warehouse_id: 'wh-danang',
        },
        buffer,
        '127.0.0.1',
        'c-dn'
      );

      // Scoped actor to HCM only sees HCM attachment
      const res = await service.listAttachments(scopedActor, {}, 'corr-scoped-list');
      assert.strictEqual(res.data.length, 1);
      assert.strictEqual(res.data[0].warehouse_id, 'wh-hcm-01');
    });

    it('AC-COM-06-09: Actor with empty scopes receives empty list (fail-closed)', async () => {
      const { service } = setupService();
      const buffer = Buffer.from('data');
      await service.uploadAttachment(
        ownerActor,
        {
          file_name: 'test.png',
          mime_type: 'image/png',
          content_base64: buffer.toString('base64'),
        },
        buffer,
        '127.0.0.1',
        'c'
      );

      const res = await service.listAttachments(emptyScopeActor, {}, 'corr-empty');
      assert.strictEqual(res.data.length, 0);
      assert.strictEqual(res.meta.total, 0);
    });

    it('AC-COM-06-11: Cross-tenant getAttachment throws 404 ATTACHMENT_NOT_FOUND', async () => {
      const { service } = setupService();
      const buffer = Buffer.from('tenant 1 file');
      const att = await service.uploadAttachment(
        ownerActor,
        { file_name: 't1.png', mime_type: 'image/png', content_base64: buffer.toString('base64') },
        buffer,
        '127.0.0.1',
        'c'
      );

      await assert.rejects(
        async () => {
          await service.getAttachment(foreignTenantActor, att.id, 'corr-cross');
        },
        (err: any) => {
          assert.strictEqual(err.code, 'ATTACHMENT_NOT_FOUND');
          assert.strictEqual(err.getStatus(), 404);
          return true;
        }
      );
    });

    it('AC-COM-06-12: Get attachment outside warehouse scope throws 403 SCOPE_FORBIDDEN', async () => {
      const { service } = setupService();
      const buffer = Buffer.from('danang file');
      const att = await service.uploadAttachment(
        ownerActor,
        {
          file_name: 'danang.png',
          mime_type: 'image/png',
          content_base64: buffer.toString('base64'),
          warehouse_id: 'wh-danang',
        },
        buffer,
        '127.0.0.1',
        'c'
      );

      await assert.rejects(
        async () => {
          await service.getAttachment(scopedActor, att.id, 'corr-scope-get');
        },
        (err: any) => {
          assert.strictEqual(err.code, 'SCOPE_FORBIDDEN');
          assert.strictEqual(err.getStatus(), 403);
          return true;
        }
      );
    });

    it('AC-COM-06-13: Download attachment returns buffer and creates ATTACHMENT_ACCESSED audit log', async () => {
      const { service, auditLogs } = setupService();
      const buffer = Buffer.from('binary download content');
      const att = await service.uploadAttachment(
        ownerActor,
        {
          file_name: 'doc.pdf',
          mime_type: 'application/pdf',
          content_base64: buffer.toString('base64'),
        },
        buffer,
        '127.0.0.1',
        'c'
      );

      const dl = await service.downloadAttachment(ownerActor, att.id, '10.0.0.1', 'corr-dl');
      assert.strictEqual(dl.fileName, 'doc.pdf');
      assert.strictEqual(dl.mimeType, 'application/pdf');
      assert.strictEqual(dl.buffer.toString(), 'binary download content');

      // Verify access audit
      const audit = auditLogs.find((a) => a.action === 'ATTACHMENT_ACCESSED');
      assert.ok(audit);
      assert.strictEqual(audit.entity_id, att.id);
    });

    it('AC-COM-06-15: Delete attachment with confirm: true marks DELETED and removes from S3', async () => {
      const { service, s3Storage, auditLogs } = setupService();
      const buffer = Buffer.from('to delete');
      const att = await service.uploadAttachment(
        ownerActor,
        { file_name: 'del.png', mime_type: 'image/png', content_base64: buffer.toString('base64') },
        buffer,
        '127.0.0.1',
        'c'
      );

      assert.strictEqual(s3Storage.has(att.storage_key), true);

      const del = await service.deleteAttachment(ownerActor, att.id, true, '127.0.0.1', 'corr-del');
      assert.strictEqual(del.success, true);
      assert.strictEqual(s3Storage.has(att.storage_key), false);

      const audit = auditLogs.find((a) => a.action === 'ATTACHMENT_DELETED');
      assert.ok(audit);

      // Verify cannot get deleted attachment
      await assert.rejects(async () => {
        await service.getAttachment(ownerActor, att.id, 'c');
      });
    });

    it('AC-COM-06-16: Delete attachment without confirm: true throws 400 CONFIRMATION_REQUIRED', async () => {
      const { service } = setupService();
      const buffer = Buffer.from('content');
      const att = await service.uploadAttachment(
        ownerActor,
        {
          file_name: 'nodelete.png',
          mime_type: 'image/png',
          content_base64: buffer.toString('base64'),
        },
        buffer,
        '127.0.0.1',
        'c'
      );

      await assert.rejects(
        async () => {
          await service.deleteAttachment(ownerActor, att.id, false, '127.0.0.1', 'c');
        },
        (err: any) => {
          assert.strictEqual(err.code, 'CONFIRMATION_REQUIRED');
          assert.strictEqual(err.getStatus(), 400);
          return true;
        }
      );
    });

    it('AC-COM-06-19: Retention purge job processes expired items and reports truthful per-row results', async () => {
      const { service, mockPrisma, s3Storage } = setupService();
      const buffer = Buffer.from('expired file');

      // Create an expired attachment directly in DB
      const expiredAtt = await mockPrisma.attachment.create({
        data: {
          id: '11111111-1111-1111-1111-111111111111',
          merchant_id: ownerActor.merchantId,
          file_name: 'expired.png',
          file_size: BigInt(buffer.length),
          mime_type: 'image/png',
          checksum_sha256: createHash('sha256').update(buffer).digest('hex'),
          storage_key: 'merchants/m-tenant-1/attachments/expired/expired.png',
          storage_bucket: 'test-bucket',
          entity_type: 'GENERAL',
          uploaded_by: 'u-owner-1',
          status: 'ACTIVE',
          retention_days: 30,
          expires_at: new Date(Date.now() - 1000 * 60 * 60 * 24), // Expired 1 day ago
        },
      });
      await service['storage'].putObject(expiredAtt.storage_key, buffer, 'image/png');

      const purgeRes = await service.purgeExpiredRetention(
        ownerActor,
        { dry_run: false },
        '127.0.0.1',
        'corr-purge'
      );

      assert.strictEqual(purgeRes.total, 1);
      assert.strictEqual(purgeRes.success_count, 1);
      assert.strictEqual(purgeRes.failure_count, 0);
      assert.strictEqual(purgeRes.succeeded_ids[0], expiredAtt.id);
      assert.strictEqual(s3Storage.has(expiredAtt.storage_key), false);
    });

    it('AC-COM-06-20: Bulk delete attachments returns partitioned results', async () => {
      const { service } = setupService();
      const buffer = Buffer.from('bulk item');

      const att1 = await service.uploadAttachment(
        ownerActor,
        { file_name: 'b1.png', mime_type: 'image/png', content_base64: buffer.toString('base64') },
        buffer,
        '127.0.0.1',
        'c'
      );

      const res = await service.bulkDeleteAttachments(
        ownerActor,
        {
          ids: [att1.id, '99999999-9999-9999-9999-999999999999'], // 1 valid, 1 not found
          confirm: true,
        },
        '127.0.0.1',
        'corr-bulk'
      );

      assert.strictEqual(res.total, 2);
      assert.strictEqual(res.success_count, 1);
      assert.strictEqual(res.failure_count, 1);
      assert.strictEqual(res.succeeded_ids.includes(att1.id), true);
      assert.strictEqual(res.failed_ids.includes('99999999-9999-9999-9999-999999999999'), true);
      assert.strictEqual(res.results.find((r) => r.id === att1.id)?.status, 'SUCCEEDED');
      assert.strictEqual(
        res.results.find((r) => r.id === '99999999-9999-9999-9999-999999999999')?.code,
        'ATTACHMENT_NOT_FOUND'
      );
    });

    it('AC-COM-06-24: Storage failure throws 503 STORAGE_UNAVAILABLE', async () => {
      const { service, mockStorage } = setupService();
      mockStorage.putObject = async () => {
        throw new Error('S3 connection timeout');
      };
      const buffer = Buffer.from('content');

      await assert.rejects(
        async () => {
          await service.uploadAttachment(
            ownerActor,
            {
              file_name: 'f.png',
              mime_type: 'image/png',
              content_base64: buffer.toString('base64'),
            },
            buffer,
            '127.0.0.1',
            'c'
          );
        },
        (err: any) => {
          assert.strictEqual(err.code, 'STORAGE_UNAVAILABLE');
          assert.strictEqual(err.getStatus(), 503);
          return true;
        }
      );
    });
  });
});
