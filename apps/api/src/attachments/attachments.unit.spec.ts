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
  detectBufferContentType,
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

// Canonical valid binary buffers for tests
const validPngBuffer = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89,
]);
const validPdfBuffer = Buffer.from('%PDF-1.4 test document content');
const validJpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const validCsvBuffer = Buffer.from('id,name,value\n1,box,100\n');

describe('FEAT-COM-06: Attachments Unit Test Suite', () => {
  const maxSizeBytes = 10 * 1024 * 1024; // 10MB

  describe('DTO Validation: validateUploadAttachmentDto', () => {
    it('should validate valid image upload payload', () => {
      const content = validPngBuffer.toString('base64');
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
      assert.strictEqual(res.buffer.length, validPngBuffer.length);
    });

    it('should validate valid PDF document upload payload', () => {
      const content = validPdfBuffer.toString('base64');
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
        const content = validPngBuffer.toString('base64');
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
          file_name: 'large.png',
          mime_type: 'image/png',
          content_base64: oversizedContent,
        },
        smallLimit
      );
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.errorCode, 'FILE_TOO_LARGE');
    });

    it('should reject invalid entity_type with VALIDATION_ERROR', () => {
      const content = validPngBuffer.toString('base64');
      const res = validateUploadAttachmentDto(
        {
          file_name: 'valid.png',
          mime_type: 'image/png',
          content_base64: content,
          entity_type: 'MALICIOUS_TYPE',
        },
        maxSizeBytes
      );
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.errorCode, 'VALIDATION_ERROR');
    });

    it('Finding 1: should detect and reject executable (MZ) disguised as image', () => {
      const disguisedExe = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]);
      const res = validateUploadAttachmentDto(
        {
          file_name: 'innocent.png',
          mime_type: 'image/png',
          content_base64: disguisedExe.toString('base64'),
        },
        maxSizeBytes
      );
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.errorCode, 'INVALID_FILE_TYPE');
    });

    it('Finding 1: should detect and reject script payload disguised as text/csv', () => {
      const maliciousScript = Buffer.from('<script>alert("xss")</script>');
      const res = validateUploadAttachmentDto(
        {
          file_name: 'statement.csv',
          mime_type: 'text/csv',
          content_base64: maliciousScript.toString('base64'),
        },
        maxSizeBytes
      );
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.errorCode, 'INVALID_FILE_TYPE');
    });

    it('Finding 1: should reject MIME type mismatch where buffer does not match declared type', () => {
      // PDF buffer sent with image/png MIME type
      const res = validateUploadAttachmentDto(
        {
          file_name: 'fake_image.png',
          mime_type: 'image/png',
          content_base64: validPdfBuffer.toString('base64'),
        },
        maxSizeBytes
      );
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.errorCode, 'INVALID_FILE_TYPE');
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
      const res = validateBulkDeleteDto({ ids: ['11111111-1111-1111-1111-111111111111'] });
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.errorCode, 'CONFIRMATION_REQUIRED');
    });

    it('validateBulkDeleteDto rejects empty ids array', () => {
      const res = validateBulkDeleteDto({ ids: [], confirm: true });
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.errorCode, 'VALIDATION_ERROR');
    });

    it('validateBulkDeleteDto rejects invalid UUID format in ids', () => {
      const res = validateBulkDeleteDto({ ids: ['not-a-valid-uuid'], confirm: true });
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.errorCode, 'VALIDATION_ERROR');
    });
  });

  describe('Audit Log Masking: maskAttachmentAuditValue', () => {
    it('masks sensitive fields including phone and email', () => {
      assert.strictEqual(maskAttachmentAuditValue('phone', '0901234567'), '090****567');
      assert.strictEqual(
        maskAttachmentAuditValue('email', 'admin@example.com'),
        'a***n@example.com'
      );
      assert.strictEqual(maskAttachmentAuditValue('contact_phone', '0912345678'), '091****678');
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
          status: 'active',
          store_scopes: ['*'],
          warehouse_scopes: ['*'],
        },
        {
          id: 'u-scoped-hcm',
          role: 'WAREHOUSE',
          status: 'active',
          store_scopes: ['branch-hcm'],
          warehouse_scopes: ['wh-hcm-01'],
        },
        {
          id: 'u-empty-scopes',
          role: 'WAREHOUSE',
          status: 'active',
          store_scopes: [],
          warehouse_scopes: [],
        },
      ];

      const mockWarehouses = [
        { id: 'wh-hcm-01', code: 'wh-hcm-01', merchant_id: 'm-tenant-1' },
        { id: 'wh-danang', code: 'wh-danang', merchant_id: 'm-tenant-1' },
      ];

      const mockBranches = [{ id: 'branch-hcm', code: 'branch-hcm', merchant_id: 'm-tenant-1' }];

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
                  if (cond.NOT) {
                    if (cond.NOT.warehouse_id === null && cond.NOT.branch_id === null) {
                      if (a.warehouse_id === null && a.branch_id === null) return false;
                    }
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
        warehouse: {
          findFirst: async ({ where }: any) => {
            return (
              mockWarehouses.find((w) => {
                if (where.merchant_id && w.merchant_id !== where.merchant_id) return false;
                if (where.OR) {
                  return where.OR.some(
                    (orClause: any) => orClause.id === w.id || orClause.code === w.code
                  );
                }
                return true;
              }) || null
            );
          },
        },
        branch: {
          findFirst: async ({ where }: any) => {
            return (
              mockBranches.find((b) => {
                if (where.merchant_id && b.merchant_id !== where.merchant_id) return false;
                if (where.OR) {
                  return where.OR.some(
                    (orClause: any) => orClause.id === b.id || orClause.code === b.code
                  );
                }
                return true;
              }) || null
            );
          },
        },
        returnRecord: {
          findFirst: async ({ where }: any) => {
            if (where.merchant_id === 'm-tenant-1') {
              return {
                id: '11111111-1111-1111-1111-111111111111',
                tracking_code: 'ret-12345',
                return_warehouse_id: 'wh-hcm-01',
              };
            }
            return null;
          },
        },
        order: {
          findFirst: async ({ where }: any) => null,
        },
        shipment: {
          findFirst: async ({ where }: any) => null,
        },
        claim: {
          findFirst: async ({ where }: any) => null,
        },
        discrepancy: {
          findFirst: async ({ where }: any) => null,
        },
        carrierStatement: {
          findFirst: async ({ where }: any) => null,
        },
        auditLog: {
          create: async ({ data }: any) => {
            const row = { id: `audit-${Date.now()}`, ...data, created_at: new Date() };
            auditLogs.push(row);
            return row;
          },
        },
        $transaction: async (fn: any) => fn(mockPrisma),
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

      const mockRbac: any = {
        getActorPermissions: async (actor: ActorContext) => {
          if (actor.role === 'OWNER') {
            return [
              'iam:shop_config',
              'order:view_create',
              'shipment:receive_return',
              'claim:verify_submit',
              'reconciliation:import_settlement_bank',
              'reconciliation:run_review_audit',
              'shipment:create_update',
              'shipment:track_exceptions',
              'iam:shop_view',
            ];
          }
          if (actor.role === 'WAREHOUSE') {
            return ['order:view_create', 'shipment:receive_return', 'shipment:track_exceptions'];
          }
          return [];
        },
        actorHasPermissions: async (actor: ActorContext, perms: string[]) => {
          const held = await mockRbac.getActorPermissions(actor);
          return perms.every((p: string) => held.includes(p));
        },
      };

      const config = createMockAppConfig();
      const service = new AttachmentsService(mockPrisma, mockStorage, config, mockRbac);

      return { service, mockPrisma, mockStorage, mockRbac, attachmentsTable, auditLogs, s3Storage };
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
      const buffer = validPngBuffer;
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

      // Verify audit log includes correlation_id
      const audit = auditLogs.find((a) => a.action === 'ATTACHMENT_UPLOADED');
      assert.ok(audit);
      assert.strictEqual(audit.entity_id, result.id);
      assert.ok(audit.reason.includes('corr-01'));
    });

    it('AC-COM-06-02: Upload with valid matching client checksum succeeds', async () => {
      const { service } = setupService();
      const buffer = validJpegBuffer;
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
      const buffer = validJpegBuffer;
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
      const { service, mockPrisma } = setupService();
      // Add warehouse to mock
      mockPrisma.warehouse.findFirst = async () => ({
        id: 'wh-danang-02',
        code: 'wh-danang-02',
        merchant_id: 'm-tenant-1',
      });

      const buffer = validPngBuffer;

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
      const buffer = validPngBuffer;

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
      const buffer = validPngBuffer;
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
      const buffer = validPngBuffer;

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
      const buffer = validPngBuffer;
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
      const buffer = validPngBuffer;
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
      const buffer = validPngBuffer;
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
      const buffer = validPdfBuffer;
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
      assert.strictEqual(dl.buffer.toString(), validPdfBuffer.toString());

      // Verify access audit
      const audit = auditLogs.find((a) => a.action === 'ATTACHMENT_ACCESSED');
      assert.ok(audit);
      assert.strictEqual(audit.entity_id, att.id);
      assert.ok(audit.reason.includes('corr-dl'));
    });

    it('Finding 1: Download rejects QUARANTINED attachment with 403 ATTACHMENT_QUARANTINED', async () => {
      const { service, mockPrisma } = setupService();
      const buffer = validPdfBuffer;
      const att = await service.uploadAttachment(
        ownerActor,
        {
          file_name: 'quarantined.pdf',
          mime_type: 'application/pdf',
          content_base64: buffer.toString('base64'),
        },
        buffer,
        '127.0.0.1',
        'c'
      );

      // Finding 1: Exercise quarantine lifecycle method
      await service.quarantineAttachment(
        ownerActor,
        att.id,
        'Malware suspected by safety scanner',
        'corr-quar'
      );

      await assert.rejects(
        async () => {
          await service.downloadAttachment(ownerActor, att.id, '127.0.0.1', 'corr-quarantine');
        },
        (err: any) => {
          assert.strictEqual(err.code, 'ATTACHMENT_QUARANTINED');
          assert.strictEqual(err.getStatus(), 403);
          return true;
        }
      );
    });

    it('Finding 5: Download fails closed and does not return content if audit logging throws', async () => {
      const { service, mockPrisma } = setupService();
      const buffer = validPdfBuffer;
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

      // Force auditLog.create to throw
      mockPrisma.auditLog.create = async () => {
        throw new Error('Database connection failed during audit write');
      };

      await assert.rejects(
        async () => {
          await service.downloadAttachment(ownerActor, att.id, '127.0.0.1', 'corr-audit-fail');
        },
        (err: any) => {
          assert.strictEqual(err.code, 'AUDIT_LOG_FAILED');
          assert.strictEqual(err.getStatus(), 503);
          return true;
        }
      );
    });

    it('AC-COM-06-15: Delete attachment with confirm: true marks DELETED and removes from S3', async () => {
      const { service, s3Storage, auditLogs } = setupService();
      const buffer = validPngBuffer;
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

    it('Finding 5 & 6: Delete attachment persists deletion intent and audit before S3; leaves PENDING_DELETION on S3 failure', async () => {
      const { service, mockStorage, mockPrisma, auditLogs } = setupService();
      const buffer = validPngBuffer;
      const att = await service.uploadAttachment(
        ownerActor,
        {
          file_name: 'keep.png',
          mime_type: 'image/png',
          content_base64: buffer.toString('base64'),
        },
        buffer,
        '127.0.0.1',
        'c'
      );

      // Mock S3 failure on deletion
      mockStorage.deleteObject = async () => {
        throw new Error('S3 error');
      };

      await assert.rejects(
        async () => {
          await service.deleteAttachment(ownerActor, att.id, true, '127.0.0.1', 'c');
        },
        (err: any) => {
          assert.strictEqual(err.code, 'STORAGE_UNAVAILABLE');
          assert.strictEqual(err.getStatus(), 503);
          return true;
        }
      );

      // Verify DB row was updated to PENDING_DELETION and durable audit log was written
      const row = await mockPrisma.attachment.findFirst({ where: { id: att.id } });
      assert.strictEqual(row?.status, 'PENDING_DELETION');

      const audit = auditLogs.find((a) => a.action === 'ATTACHMENT_DELETED');
      assert.ok(audit, 'Durable deletion audit log must be persisted');

      // Verify cannot download pending deletion attachment
      await assert.rejects(
        async () => {
          await service.downloadAttachment(ownerActor, att.id, '127.0.0.1', 'c');
        },
        (err: any) => {
          assert.strictEqual(err.code, 'ATTACHMENT_UNAVAILABLE');
          return true;
        }
      );

      // Verify retry with working S3 completes deletion
      mockStorage.deleteObject = async () => {};
      const retryDel = await service.deleteAttachment(
        ownerActor,
        att.id,
        true,
        '127.0.0.1',
        'c-retry'
      );
      assert.strictEqual(retryDel.success, true);
      const finalizedRow = await mockPrisma.attachment.findFirst({ where: { id: att.id } });
      assert.strictEqual(finalizedRow?.status, 'DELETED');
    });

    it('AC-COM-06-16: Delete attachment without confirm: true throws 400 CONFIRMATION_REQUIRED', async () => {
      const { service } = setupService();
      const buffer = validPngBuffer;
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

    it('Finding 4: Retention purge requires iam:shop_config capability', async () => {
      const { service } = setupService();
      await assert.rejects(
        async () => {
          // scopedActor is WAREHOUSE and lacks iam:shop_config
          await service.purgeExpiredRetention(
            scopedActor,
            { dry_run: false },
            '127.0.0.1',
            'corr-purge'
          );
        },
        (err: any) => {
          assert.strictEqual(err.code, 'FORBIDDEN');
          assert.strictEqual(err.getStatus(), 403);
          return true;
        }
      );
    });

    it('AC-COM-06-19: Retention purge job processes expired items and reports truthful per-row results', async () => {
      const { service, mockPrisma, s3Storage } = setupService();
      const buffer = validPngBuffer;

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
      const buffer = validPngBuffer;

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
      const buffer = validPngBuffer;

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

    it('Finding 3: Upload with derived entity scope outside actor warehouse scope throws 403 SCOPE_FORBIDDEN', async () => {
      const { service, mockPrisma } = setupService();
      // Configure shipment to belong to Da Nang warehouse
      mockPrisma.shipment.findFirst = async () => ({
        id: 'shipment-danang-1',
        merchant_id: 'm-tenant-1',
        warehouse_id: 'wh-danang-02',
        branch_id: null,
      });

      const buffer = validPngBuffer;

      // scopedActor only has wh-hcm-01 scope
      await assert.rejects(
        async () => {
          await service.uploadAttachment(
            scopedActor,
            {
              file_name: 'evidence.png',
              mime_type: 'image/png',
              content_base64: buffer.toString('base64'),
              entity_type: 'SHIPMENT',
              entity_id: 'shipment-danang-1',
              // Note: warehouse_id is omitted by caller to try bypassing scope check
            },
            buffer,
            '127.0.0.1',
            'corr-scope-derive'
          );
        },
        (err: any) => {
          assert.strictEqual(err.code, 'SCOPE_FORBIDDEN');
          assert.strictEqual(err.getStatus(), 403);
          return true;
        }
      );
    });

    it('Finding 10: List attachments filters per-dimension and excludes rows in forbidden branch despite authorized warehouse', async () => {
      const { service, attachmentsTable } = setupService();

      // Row 1: Authorized warehouse AND authorized branch
      attachmentsTable.push({
        id: 'att-both-ok',
        merchant_id: 'm-tenant-1',
        file_name: 'ok.png',
        file_size: BigInt(100),
        mime_type: 'image/png',
        checksum_sha256: 'hash-ok',
        storage_key: 'merchants/m-tenant-1/attachments/att-both-ok/ok.png',
        storage_bucket: 'test-bucket',
        entity_type: 'GENERAL',
        warehouse_id: 'wh-hcm-01', // in scopedActor warehouse_scopes
        branch_id: 'branch-hcm', // in scopedActor store_scopes
        status: 'ACTIVE',
        created_at: new Date(),
        updated_at: new Date(),
      });

      // Row 2: Authorized warehouse BUT forbidden branch
      attachmentsTable.push({
        id: 'att-wh-ok-branch-forbidden',
        merchant_id: 'm-tenant-1',
        file_name: 'bad_branch.png',
        file_size: BigInt(100),
        mime_type: 'image/png',
        checksum_sha256: 'hash-bad',
        storage_key: 'merchants/m-tenant-1/attachments/att-bad/bad.png',
        storage_bucket: 'test-bucket',
        entity_type: 'GENERAL',
        warehouse_id: 'wh-hcm-01', // in warehouse scope
        branch_id: 'br-hanoi-forbidden', // NOT in store scope!
        status: 'ACTIVE',
        created_at: new Date(),
        updated_at: new Date(),
      });

      const listRes = await service.listAttachments(scopedActor, {}, 'corr-list-dim');
      assert.strictEqual(listRes.data.length, 1);
      assert.strictEqual(listRes.data[0].id, 'att-both-ok');
    });

    it('Finding 6: reconcilePendingDeletions retries S3 removal and cleans up pending deletion records', async () => {
      const { service, attachmentsTable, s3Storage } = setupService();

      const key = 'merchants/m-tenant-1/attachments/att-pending/del.png';
      s3Storage.set(key, { body: validPngBuffer, contentType: 'image/png' });

      attachmentsTable.push({
        id: 'att-pending',
        merchant_id: 'm-tenant-1',
        file_name: 'del.png',
        file_size: BigInt(100),
        mime_type: 'image/png',
        checksum_sha256: 'hash-p',
        storage_key: key,
        storage_bucket: 'test-bucket',
        entity_type: 'GENERAL',
        warehouse_id: null,
        branch_id: null,
        status: 'PENDING_DELETION',
        created_at: new Date(),
        updated_at: new Date(),
      });

      const reconcileRes = await service.reconcilePendingDeletions(ownerActor, 'corr-rec');
      assert.strictEqual(reconcileRes.reconciled, 1);
      assert.strictEqual(reconcileRes.failed, 0);

      const updated = attachmentsTable.find((a) => a.id === 'att-pending');
      assert.strictEqual(updated?.status, 'DELETED');
      assert.strictEqual(s3Storage.has(key), false);
    });
  });
});
