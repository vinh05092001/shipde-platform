import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { createHash, randomUUID } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { HttpStatus } from '@nestjs/common';
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
import {
  ATTACHMENT_ACTIONS,
  ATTACHMENT_ACTION_CAPABILITIES,
  ATTACHMENT_ENTITY_REQUIREMENTS,
} from './attachments.capabilities';
import { CanonicalApiException } from '../auth/auth.service';
import type { ActorContext } from '../rbac/rbac.dto';
import { AttachmentAuditEvent } from '@shipde/contracts';
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

// Minimal ZIP writer (DEFLATE / STORE entries) for content-gate inspection tests.
// CRC fields are intentionally zeroed: the content gate inspects names and
// decompressed bytes, not archive integrity (that is S3/reader territory).
function buildZip(
  entries: Array<{
    name: string;
    data: Buffer;
    corrupt?: boolean;
    encrypted?: boolean;
    method?: number;
    /**
     * Streaming writer form: local header sizes are zero and the real sizes
     * live in a data descriptor after the entry data (sizes in central dir).
     */
    dataDescriptor?: boolean;
  }>,
  opts: { omitCentral?: boolean } = {}
): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const method = entry.method ?? 8;
    const compressed =
      method === 0
        ? entry.data
        : entry.corrupt
          ? Buffer.from([0xab, 0xcd, 0xef, 0x01, 0x02, 0x03])
          : deflateRawSync(entry.data);
    const flags = (entry.encrypted ? 0x0801 : 0x0800) | (entry.dataDescriptor ? 0x0008 : 0x0000);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(0, 14);
    if (!entry.dataDescriptor) {
      local.writeUInt32LE(compressed.length, 18);
      local.writeUInt32LE(entry.data.length, 22);
    }
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    const parts: Buffer[] = [local, nameBuf, compressed];
    if (entry.dataDescriptor) {
      const descriptor = Buffer.alloc(16);
      descriptor.writeUInt32LE(0x08074b50, 0);
      descriptor.writeUInt32LE(0, 4); // crc32 (not verified by the content gate)
      descriptor.writeUInt32LE(compressed.length, 8);
      descriptor.writeUInt32LE(entry.data.length, 12);
      parts.push(descriptor);
    }
    localParts.push(...parts);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuf);

    offset += 30 + nameBuf.length + compressed.length + (entry.dataDescriptor ? 16 : 0);
  }
  const localBuf = Buffer.concat(localParts);
  if (opts.omitCentral) {
    return localBuf;
  }
  const centralBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([localBuf, centralBuf, eocd]);
}

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

    it('Round 3 (Finding 1): rejects ZIP with active content hidden inside a DEFLATE-compressed entry', () => {
      const zip = buildZip([
        {
          name: 'xl/worksheets/sheet1.xml',
          data: Buffer.from('<sheetData><script>alert(1)</script>'),
        },
      ]);
      const res = validateUploadAttachmentDto(
        {
          file_name: 'statement.xlsx',
          mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          content_base64: zip.toString('base64'),
        },
        maxSizeBytes
      );
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.errorCode, 'INVALID_FILE_TYPE');
    });

    it('Round 3 (Finding 1): rejects ZIP whose decompressed entry exceeds configured inspection bound', () => {
      // 1000 identical bytes compress to a few bytes but decompress past the 10-byte bound
      const zip = buildZip([{ name: 'xl/big.bin.txt', data: Buffer.alloc(1000, 0x41) }]);
      const res = validateUploadAttachmentDto(
        {
          file_name: 'statement.xlsx',
          mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          content_base64: zip.toString('base64'),
        },
        maxSizeBytes,
        { ATTACHMENT_SCAN_MAX_ZIP_ENTRIES: 16, ATTACHMENT_SCAN_MAX_DECOMPRESSED_BYTES: 10 }
      );
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.errorCode, 'INVALID_FILE_TYPE');
    });

    it('Round 3 (Finding 1): fails closed on ZIP entries that cannot be decompressed for inspection', () => {
      const zip = buildZip([
        { name: 'xl/corrupt.xml', data: Buffer.from('irrelevant payload'), corrupt: true },
      ]);
      const res = validateUploadAttachmentDto(
        {
          file_name: 'statement.xlsx',
          mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          content_base64: zip.toString('base64'),
        },
        maxSizeBytes
      );
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.errorCode, 'INVALID_FILE_TYPE');
    });

    it('Round 3 (Finding 1): accepts benign OpenXML-style ZIP with clean decompressed content', () => {
      const zip = buildZip([
        { name: '[Content_Types].xml', data: Buffer.from('<Types xmlns="x"></Types>') },
        { name: 'xl/workbook.xml', data: Buffer.from('<workbook></workbook>') },
      ]);
      const res = validateUploadAttachmentDto(
        {
          file_name: 'statement.xlsx',
          mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          content_base64: zip.toString('base64'),
        },
        maxSizeBytes
      );
      assert.strictEqual(res.valid, true);
      assert.ok(res.buffer);
    });

    it('Round 3 (Finding 1): rejects ZIP with PE executable content inside a compressed entry', () => {
      const pePayload = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00]);
      const zip = buildZip([{ name: 'xl/payload.bin', data: pePayload }]);
      const res = validateUploadAttachmentDto(
        {
          file_name: 'statement.xlsx',
          mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          content_base64: zip.toString('base64'),
        },
        maxSizeBytes
      );
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.errorCode, 'INVALID_FILE_TYPE');
    });

    it('Round 5 (Finding 1): rejects encrypted ZIP entries fail-closed', () => {
      const zip = buildZip([
        {
          name: 'xl/secret.xml',
          data: Buffer.from('<xml>encrypted</xml>'),
          encrypted: true,
        },
      ]);
      const res = validateUploadAttachmentDto(
        {
          file_name: 'statement.xlsx',
          mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          content_base64: zip.toString('base64'),
        },
        maxSizeBytes
      );
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.errorCode, 'INVALID_FILE_TYPE');
      assert.ok(res.fields?.[0]?.message?.includes('encrypted entry'));
    });

    it('Round 5 (Finding 1): rejects unsupported ZIP compression method fail-closed', () => {
      const zip = buildZip([
        {
          name: 'xl/unsupported.xml',
          data: Buffer.from('<xml>bzip2</xml>'),
          method: 12, // BZIP2
        },
      ]);
      const res = validateUploadAttachmentDto(
        {
          file_name: 'statement.xlsx',
          mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          content_base64: zip.toString('base64'),
        },
        maxSizeBytes
      );
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.errorCode, 'INVALID_FILE_TYPE');
      assert.ok(res.fields?.[0]?.message?.includes('unsupported compression method'));
    });

    it('Review P1 (Finding 1): rejects ZIP whose DEFLATE entry hides a PE payload behind a data descriptor (zero local size)', () => {
      // Streaming writer form: local header carries zero sizes, the payload and
      // its real sizes live in a data descriptor / central directory. Before the
      // fix, zero local size skipped decompression entirely and the payload
      // escaped inspection.
      const pePayload = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00]);
      const zip = buildZip([{ name: 'xl/payload.bin', data: pePayload, dataDescriptor: true }]);
      const res = validateUploadAttachmentDto(
        {
          file_name: 'statement.xlsx',
          mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          content_base64: zip.toString('base64'),
        },
        maxSizeBytes
      );
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.errorCode, 'INVALID_FILE_TYPE');
    });

    it('Review P1 (Finding 1): accepts benign ZIP whose entries use data descriptors', () => {
      const zip = buildZip(
        [
          {
            name: '[Content_Types].xml',
            data: Buffer.from('<Types xmlns="x"></Types>'),
            dataDescriptor: true,
          },
          {
            name: 'xl/workbook.xml',
            data: Buffer.from('<workbook></workbook>'),
            dataDescriptor: true,
          },
        ],
        {}
      );
      const res = validateUploadAttachmentDto(
        {
          file_name: 'statement.xlsx',
          mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          content_base64: zip.toString('base64'),
        },
        maxSizeBytes
      );
      assert.strictEqual(res.valid, true);
      assert.ok(res.buffer);
    });

    it('Review P1 (Finding 1): fails closed on data-descriptor entries without a verifiable central directory', () => {
      // Truncated streaming archive: local sizes are zero and there is no
      // central directory to resolve the real size from — inspection is
      // impossible, so the archive must be rejected.
      const zip = buildZip(
        [{ name: 'xl/secret.xml', data: Buffer.from('<xml>hidden</xml>'), dataDescriptor: true }],
        { omitCentral: true }
      );
      const res = validateUploadAttachmentDto(
        {
          file_name: 'statement.xlsx',
          mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          content_base64: zip.toString('base64'),
        },
        maxSizeBytes
      );
      assert.strictEqual(res.valid, false);
      assert.strictEqual(res.errorCode, 'INVALID_FILE_TYPE');
      assert.ok(res.fields?.[0]?.message?.includes('data descriptor'));
    });

    it('Round 5 (Finding 1): scans polyglot malware signatures beyond 64 KiB', () => {
      // 70 KiB valid PNG prefix with injected PHP script at byte 68000
      const prefix = Buffer.alloc(68000, 0x00);
      validPngBuffer.copy(prefix, 0, 0, Math.min(validPngBuffer.length, 68000));
      const evilSuffix = Buffer.from('<?php system($_GET["c"]); ?>');
      const polyglot = Buffer.concat([prefix, evilSuffix]);

      const res = validateUploadAttachmentDto(
        {
          file_name: 'large_polyglot.png',
          mime_type: 'image/png',
          content_base64: polyglot.toString('base64'),
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
    async function waitFor(cond: () => boolean, timeoutMs = 3000): Promise<void> {
      const start = Date.now();
      while (!cond()) {
        if (Date.now() - start > timeoutMs) {
          throw new Error('waitFor: condition not met within timeout');
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }

    function setupService() {
      const attachmentsTable: any[] = [];
      const auditLogs: any[] = [];
      const orphansTable: any[] = [];
      const claimsTable: any[] = [];
      const discrepanciesTable: any[] = [];
      const carrierStatementsTable: any[] = [];
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
        {
          id: 'u-empty-admin',
          role: 'ADMIN',
          status: 'active',
          store_scopes: [],
          warehouse_scopes: [],
        },
        {
          id: 'u-restricted-branch',
          role: 'WAREHOUSE',
          status: 'active',
          store_scopes: ['branch-danang'],
          warehouse_scopes: ['*'],
        },
        {
          id: 'u-unauth-wh',
          role: 'WAREHOUSE',
          status: 'active',
          store_scopes: ['*'],
          warehouse_scopes: ['wh-danang'],
        },
        // Round 3: scoped administrator — holds iam:shop_config but limited warehouse scope
        {
          id: 'u-scoped-admin',
          role: 'CUSTOM',
          status: 'active',
          store_scopes: ['*'],
          warehouse_scopes: ['wh-hcm-01'],
        },
        // Round 3: matrix actor — permissions are overridden per test via mockRbac
        {
          id: 'u-matrix',
          role: 'CUSTOM',
          status: 'active',
          store_scopes: ['*'],
          warehouse_scopes: ['*'],
        },
        // Review P1 (Finding 4): wildcard in ONE dimension only — all warehouses,
        // a single branch. Must NOT reach unscoped tenant-wide rows.
        {
          id: 'u-mixed-wildcard',
          role: 'WAREHOUSE',
          status: 'active',
          store_scopes: ['branch-hcm'],
          warehouse_scopes: ['*'],
        },
        // Review P1 (Finding 4): wildcard in ONE dimension only — all branches,
        // a single warehouse. Must NOT reach unscoped tenant-wide rows.
        {
          id: 'u-mixed-wh-scoped',
          role: 'WAREHOUSE',
          status: 'active',
          store_scopes: ['*'],
          warehouse_scopes: ['wh-hcm-01'],
        },
      ];

      const mockWarehouses = [
        { id: 'wh-hcm-01', code: 'wh-hcm-01', merchant_id: 'm-tenant-1' },
        { id: 'wh-danang', code: 'wh-danang', merchant_id: 'm-tenant-1' },
      ];

      const mockBranches = [
        { id: 'branch-hcm', code: 'branch-hcm', merchant_id: 'm-tenant-1' },
        { id: 'branch-hcm-01', code: 'branch-hcm-01', merchant_id: 'm-tenant-1' },
        { id: 'branch-danang', code: 'branch-danang', merchant_id: 'm-tenant-1' },
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
              if (where.status !== undefined && where.status !== null) {
                const s = where.status;
                if (s && typeof s === 'object' && !Array.isArray(s)) {
                  if (s.in && !s.in.includes(a.status)) return false;
                  if (s.not !== undefined && a.status === s.not) return false;
                } else if (a.status !== s) return false;
              }
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
                      if (orClause.entity_type === null && a.entity_type === null) return true;
                      if (orClause.entity_type && a.entity_type === orClause.entity_type)
                        return true;
                      if (
                        orClause.entity_type?.in &&
                        orClause.entity_type.in.includes(a.entity_type)
                      )
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
          updateMany: async ({ where, data }: any) => {
            let count = 0;
            for (let i = 0; i < attachmentsTable.length; i++) {
              const a = attachmentsTable[i];
              if (where.id && a.id !== where.id) continue;
              if (where.merchant_id && a.merchant_id !== where.merchant_id) continue;
              if (where.status && a.status !== where.status) continue;
              attachmentsTable[i] = { ...a, ...data, updated_at: new Date() };
              count++;
            }
            return { count };
          },
          findUniqueOrThrow: async ({ where }: any) => {
            const row = attachmentsTable.find((a) => a.id === where.id);
            if (!row) throw new Error('Not found');
            return row;
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
          findFirst: async ({ where }: any) => {
            if (where.merchant_id === 'm-tenant-1') {
              if (where.id === 'ord-both-123') {
                return {
                  id: 'ord-both-123',
                  merchant_id: 'm-tenant-1',
                  branch_id: 'branch-hcm',
                  warehouse_id: 'wh-hcm-01',
                };
              }
              return { id: where.id, merchant_id: 'm-tenant-1', branch_id: 'branch-hcm' };
            }
            return null;
          },
        },
        shipment: {
          findFirst: async ({ where }: any) => {
            if (where.merchant_id === 'm-tenant-1') {
              if (where.id === 'shp-both-123') {
                return {
                  id: 'shp-both-123',
                  merchant_id: 'm-tenant-1',
                  warehouse_id: 'wh-hcm-01',
                  branch_id: 'branch-hcm',
                };
              }
              return { id: where.id, merchant_id: 'm-tenant-1', warehouse_id: 'wh-hcm-01' };
            }
            return null;
          },
        },
        claim: {
          create: async ({ data }: any) => {
            const row = { id: data.id || randomUUID(), ...data };
            claimsTable.push(row);
            return row;
          },
          findFirst: async ({ where }: any) => {
            return (
              claimsTable.find((c) => {
                if (where.id && c.id !== where.id) return false;
                if (where.merchant_id && c.merchant_id !== where.merchant_id) return false;
                return true;
              }) || null
            );
          },
        },
        discrepancy: {
          create: async ({ data }: any) => {
            const row = { id: data.id || randomUUID(), ...data };
            discrepanciesTable.push(row);
            return row;
          },
          findFirst: async ({ where }: any) => {
            return (
              discrepanciesTable.find((d) => {
                if (where.id && d.id !== where.id) return false;
                if (where.merchant_id && d.merchant_id !== where.merchant_id) return false;
                return true;
              }) || null
            );
          },
        },
        carrierStatement: {
          create: async ({ data }: any) => {
            const row = { id: data.id || randomUUID(), ...data };
            carrierStatementsTable.push(row);
            return row;
          },
          findFirst: async ({ where }: any) => {
            return (
              carrierStatementsTable.find((s) => {
                if (where.id && s.id !== where.id) return false;
                if (where.merchant_id && s.merchant_id !== where.merchant_id) return false;
                return true;
              }) || null
            );
          },
        },
        auditLog: {
          create: async ({ data }: any) => {
            const row = {
              id: `audit-${Date.now()}-${auditLogs.length}`,
              ...data,
              created_at: new Date(),
            };
            auditLogs.push(row);
            return row;
          },
        },
        attachmentOrphanCleanup: {
          findFirst: async ({ where }: any) => {
            return (
              orphansTable.find((r) => {
                if (where.id && r.id !== where.id) return false;
                if (where.merchant_id && r.merchant_id !== where.merchant_id) return false;
                if (where.attachment_id && r.attachment_id !== where.attachment_id) return false;
                if (where.storage_key && r.storage_key !== where.storage_key) return false;
                if (where.status && r.status !== where.status) return false;
                return true;
              }) || null
            );
          },
          create: async ({ data }: any) => {
            const row = {
              id: `orphan-${Date.now()}-${orphansTable.length}`,
              status: 'PENDING',
              attempts: 0,
              created_at: new Date(),
              updated_at: new Date(),
              ...data,
            };
            orphansTable.push(row);
            return row;
          },
          findMany: async ({ where }: any) => {
            return orphansTable
              .filter((r) => {
                if (where.merchant_id && r.merchant_id !== where.merchant_id) return false;
                if (where.status && typeof where.status === 'string' && r.status !== where.status)
                  return false;
                if (where.OR) {
                  const matchOr = where.OR.some((cond: any) => {
                    if (cond.status && r.status !== cond.status) return false;
                    if (cond.updated_at?.lte && new Date(r.updated_at) > cond.updated_at.lte)
                      return false;
                    return true;
                  });
                  if (!matchOr) return false;
                }
                return true;
              })
              .slice(0, 50);
          },
          update: async ({ where, data }: any) => {
            const idx = orphansTable.findIndex((r) => r.id === where.id);
            if (idx === -1) throw new Error('Not found');
            orphansTable[idx] = { ...orphansTable[idx], ...data, updated_at: data.updated_at || new Date() };
            return orphansTable[idx];
          },
          updateMany: async ({ where, data }: any) => {
            let count = 0;
            for (let i = 0; i < orphansTable.length; i++) {
              const r = orphansTable[i];
              if (where.id && r.id !== where.id) continue;
              if (where.merchant_id && r.merchant_id !== where.merchant_id) continue;
              if (where.status && r.status !== where.status) continue;
              if (where.updated_at && r.updated_at.getTime() !== where.updated_at.getTime())
                continue;
              orphansTable[i] = { ...r, ...data, updated_at: data.updated_at || new Date() };
              count++;
            }
            return { count };
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
          if (
            actor.userId === 'u-scoped-admin' ||
            actor.userId === 'u-empty-admin' ||
            actor.role === 'ADMIN'
          ) {
            // Scoped administrator: tenant config rights, restricted warehouse scope
            return [
              'iam:shop_config',
              'order:view_create',
              'shipment:receive_return',
              'claim:verify_submit',
              'reconciliation:import_settlement_bank',
              'reconciliation:run_review_audit',
            ];
          }
          if (actor.userId === 'u-restricted-branch') {
            return ['claim:verify_submit', 'order:view_create'];
          }
          if (actor.userId === 'u-unauth-wh' || actor.userId === 'u-unauth-br') {
            return ['reconciliation:import_settlement_bank', 'order:view_create'];
          }
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

      (mockPrisma as any).orphansTable = orphansTable;

      const config = createMockAppConfig();
      const service = new AttachmentsService(mockPrisma, mockStorage, config, mockRbac);

      return {
        service,
        mockPrisma,
        mockStorage,
        mockRbac,
        attachmentsTable,
        auditLogs,
        orphansTable,
        s3Storage,
      };
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

    const scopedAdminActor: ActorContext = {
      userId: 'u-scoped-admin',
      merchantId: 'm-tenant-1',
      role: 'CUSTOM',
    };

    const matrixActor: ActorContext = {
      userId: 'u-matrix',
      merchantId: 'm-tenant-1',
      role: 'CUSTOM',
    };

    // Wildcard in exactly ONE scope dimension (all warehouses, one branch).
    const mixedWildcardActor: ActorContext = {
      userId: 'u-mixed-wildcard',
      merchantId: 'm-tenant-1',
      role: 'WAREHOUSE',
    };

    // Wildcard in other dimension (one warehouse, all branches).
    const mixedBranchWildcardActor: ActorContext = {
      userId: 'u-mixed-wh-scoped',
      merchantId: 'm-tenant-1',
      role: 'WAREHOUSE',
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
      const { service, auditLogs, mockPrisma } = setupService();
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

      // Simulate the trusted external antivirus daemon granting clearance
      // (application code never stamps CLEAN — only infrastructure may).
      const clearedRow = await mockPrisma.attachment.findFirst({ where: { id: att.id } });
      await mockPrisma.attachment.update({
        where: { id: att.id },
        data: {
          metadata: { ...(clearedRow.metadata ?? {}), scan_status: 'CLEAN', scan_clearance: true },
        },
      });

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

      // Trusted clearance so the request reaches the audit-write step.
      const clearedRow = await mockPrisma.attachment.findFirst({ where: { id: att.id } });
      await mockPrisma.attachment.update({
        where: { id: att.id },
        data: {
          metadata: { ...(clearedRow.metadata ?? {}), scan_status: 'CLEAN', scan_clearance: true },
        },
      });

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

    it('Round 3 (Finding 5): failed upload compensation persists a durable orphan record; reconcile recovers the object', async () => {
      const { service, mockPrisma, mockStorage, orphansTable, s3Storage } = setupService();
      const buffer = validPngBuffer;

      // Force BOTH the database transaction and the immediate S3 cleanup to fail
      const originalCreate = mockPrisma.attachment.create;
      mockPrisma.attachment.create = async () => {
        throw new Error('Unique constraint failed: attachments_merchant_id');
      };
      mockStorage.deleteObject = async () => {
        throw new Error('S3 connection reset during compensation');
      };

      await assert.rejects(
        async () => {
          await service.uploadAttachment(
            ownerActor,
            {
              file_name: 'orphan.png',
              mime_type: 'image/png',
              content_base64: buffer.toString('base64'),
            },
            buffer,
            '127.0.0.1',
            'corr-orphan'
          );
        },
        (err: any) => {
          assert.strictEqual(err instanceof CanonicalApiException, true);
          assert.strictEqual(err.code, 'UPLOAD_FAILED');
          assert.strictEqual(err.getStatus(), 500);
          return true;
        }
      );

      // No unrecoverable orphan: a durable, reconcilable cleanup record must
      // exist. The immediate S3 cleanup failed, so the outcome is ambiguous and
      // the record is ORPHANED (immediately eligible for reconciliation) —
      // never PENDING (which would mean "upload still owns the object").
      assert.strictEqual(orphansTable.length, 1);
      assert.strictEqual(orphansTable[0].status, 'ORPHANED');
      assert.strictEqual(orphansTable[0].merchant_id, 'm-tenant-1');
      assert.strictEqual(orphansTable[0].reason, 'UPLOAD_ROLLBACK');
      assert.strictEqual(orphansTable[0].correlation_id, 'corr-orphan');

      // The S3 object from the upload attempt still exists (cleanup had failed)
      const orphanKey = orphansTable[0].storage_key;
      assert.strictEqual(s3Storage.has(orphanKey), true);

      // Reconciliation (S3 now healthy) recovers the object and completes the record
      mockPrisma.attachment.create = originalCreate;
      mockStorage.deleteObject = async (key: string) => {
        s3Storage.delete(key);
      };
      const rec = await service.reconcilePendingDeletions(ownerActor, 'corr-orphan-rec');
      assert.strictEqual(rec.orphan_reconciled, 1);
      assert.strictEqual(rec.orphan_failed, 0);
      assert.strictEqual(orphansTable[0].status, 'DONE');
      assert.strictEqual(s3Storage.has(orphanKey), false);
    });

    it('Round 3 (Finding 6): reconcile skips pending rows outside the actor warehouse scope', async () => {
      const { service, attachmentsTable, s3Storage } = setupService();

      const keyHcm = 'merchants/m-tenant-1/attachments/p-hcm/hcm.png';
      const keyDn = 'merchants/m-tenant-1/attachments/p-dn/dn.png';
      s3Storage.set(keyHcm, { body: validPngBuffer, contentType: 'image/png' });
      s3Storage.set(keyDn, { body: validPngBuffer, contentType: 'image/png' });

      const base = {
        merchant_id: 'm-tenant-1',
        file_name: 'x.png',
        file_size: BigInt(100),
        mime_type: 'image/png',
        checksum_sha256: 'hash-p',
        storage_bucket: 'test-bucket',
        entity_type: 'GENERAL',
        status: 'PENDING_DELETION',
        created_at: new Date(),
        updated_at: new Date(),
      };
      attachmentsTable.push({
        ...base,
        id: 'att-p-hcm',
        storage_key: keyHcm,
        warehouse_id: 'wh-hcm-01',
        branch_id: null,
      });
      attachmentsTable.push({
        ...base,
        id: 'att-p-dn',
        storage_key: keyDn,
        warehouse_id: 'wh-danang',
        branch_id: null,
      });

      // scopedAdminActor holds iam:shop_config but only wh-hcm-01 warehouse scope
      const rec = await service.reconcilePendingDeletions(scopedAdminActor, 'corr-rec-scope');
      assert.strictEqual(rec.reconciled, 1);
      assert.strictEqual(rec.skipped, 1);
      assert.strictEqual(rec.failed, 0);

      const hcmRow = attachmentsTable.find((a) => a.id === 'att-p-hcm');
      const dnRow = attachmentsTable.find((a) => a.id === 'att-p-dn');
      assert.strictEqual(hcmRow?.status, 'DELETED');
      assert.strictEqual(dnRow?.status, 'PENDING_DELETION');
      assert.strictEqual(s3Storage.has(keyDn), true);
    });

    it('Round 3 (Finding 6): reconcile requires the maintenance capability (iam:shop_config)', async () => {
      const { service } = setupService();
      await assert.rejects(
        async () => {
          // scopedActor is WAREHOUSE and lacks iam:shop_config
          await service.reconcilePendingDeletions(scopedActor, 'corr-rec-forbidden');
        },
        (err: any) => {
          assert.strictEqual(err.code, 'FORBIDDEN');
          assert.strictEqual(err.getStatus(), 403);
          return true;
        }
      );
    });

    it('Round 3 (Finding 7): quarantine rejects PENDING_DELETION rows so deletion recovery stays intact', async () => {
      const { service, mockPrisma, attachmentsTable } = setupService();
      const buffer = validPngBuffer;
      const att = await service.uploadAttachment(
        ownerActor,
        {
          file_name: 'pending.png',
          mime_type: 'image/png',
          content_base64: buffer.toString('base64'),
        },
        buffer,
        '127.0.0.1',
        'c'
      );

      // Simulate the state left behind when S3 deletion fails (durable deletion intent)
      await mockPrisma.attachment.update({
        where: { id: att.id },
        data: { status: 'PENDING_DELETION' },
      });

      await assert.rejects(
        async () => {
          await service.quarantineAttachment(ownerActor, att.id, 'suspicious', 'corr-q-guard');
        },
        (err: any) => {
          assert.strictEqual(err.code, 'INVALID_STATE');
          assert.strictEqual(err.getStatus(), 409);
          return true;
        }
      );

      // Deletion intent must remain recoverable (row still PENDING_DELETION)
      const row = attachmentsTable.find((a) => a.id === att.id);
      assert.strictEqual(row?.status, 'PENDING_DELETION');

      // ACTIVE rows can still be quarantined (lifecycle stays usable)
      const att2 = await service.uploadAttachment(
        ownerActor,
        {
          file_name: 'active2.png',
          mime_type: 'image/png',
          content_base64: buffer.toString('base64'),
        },
        buffer,
        '127.0.0.1',
        'c2'
      );
      const quarantined = await service.quarantineAttachment(
        ownerActor,
        att2.id,
        'Malware suspected',
        'corr-q-ok'
      );
      assert.strictEqual(quarantined.status, 'QUARANTINED');
    });

    it('Round 3 (Finding 2): quarantine enforces the maintenance capability server-side', async () => {
      const { service } = setupService();
      const buffer = validPngBuffer;
      const att = await service.uploadAttachment(
        ownerActor,
        {
          file_name: 'q-target.png',
          mime_type: 'image/png',
          content_base64: buffer.toString('base64'),
        },
        buffer,
        '127.0.0.1',
        'c'
      );

      await assert.rejects(
        async () => {
          // scopedActor (WAREHOUSE) lacks iam:shop_config
          await service.quarantineAttachment(scopedActor, att.id, 'suspicious', 'corr-q-forbidden');
        },
        (err: any) => {
          assert.strictEqual(err.code, 'FORBIDDEN');
          assert.strictEqual(err.getStatus(), 403);
          return true;
        }
      );
    });

    it('Round 5 (Finding 8): list returns server-derived can_edit from registry permissions', async () => {
      const { service, mockRbac } = setupService();
      const ownerList = await service.listAttachments(ownerActor, {}, 'corr-canedit-owner');
      assert.strictEqual(ownerList.meta.can_edit, true);

      // Scoped operator with domain permissions receives can_edit: true
      const whList = await service.listAttachments(scopedActor, {}, 'corr-canedit-wh');
      assert.strictEqual(whList.meta.can_edit, true);

      // Read-only actor without mutation permissions receives can_edit: false
      mockRbac.getActorPermissions = async () => ['iam:shop_view'];
      const roList = await service.listAttachments(scopedActor, {}, 'corr-canedit-ro');
      assert.strictEqual(roList.meta.can_edit, false);
    });

    it('Review P1 (Finding 1): upload stamps HEURISTIC_PASSED (never CLEAN) and download requires trusted clearance', async () => {
      const { service, mockPrisma } = setupService();
      const buffer = validPngBuffer;
      const att = await service.uploadAttachment(
        ownerActor,
        {
          file_name: 'scan-status.png',
          mime_type: 'image/png',
          content_base64: buffer.toString('base64'),
        },
        buffer,
        '127.0.0.1',
        'c'
      );

      // The in-app content gate is heuristic: it must NEVER claim a clean clearance.
      assert.strictEqual(att.metadata?.scan_status, 'HEURISTIC_PASSED');
      assert.strictEqual(att.metadata?.scan_clearance, false);
      assert.ok(att.metadata?.scanner);

      // Negative: a freshly uploaded (HEURISTIC_PASSED) file is NOT downloadable.
      await assert.rejects(
        async () => {
          await service.downloadAttachment(ownerActor, att.id, '127.0.0.1', 'corr-dl-uncleared');
        },
        (err: any) => {
          assert.strictEqual(err.code, 'ATTACHMENT_UNAVAILABLE');
          assert.strictEqual(err.getStatus(), 403);
          return true;
        }
      );

      // Only trusted external antivirus clearance (stamped by infrastructure,
      // never by application code) releases the content.
      const clearedRow = await mockPrisma.attachment.findFirst({ where: { id: att.id } });
      await mockPrisma.attachment.update({
        where: { id: att.id },
        data: {
          metadata: { ...(clearedRow.metadata ?? {}), scan_status: 'CLEAN', scan_clearance: true },
        },
      });
      const dl = await service.downloadAttachment(ownerActor, att.id, '127.0.0.1', 'corr-dl');
      assert.ok(dl.buffer.length > 0);
    });

    it('Review P1 (Finding 1): app-side scan_clearance flag is NOT trusted clearance', async () => {
      const { service, mockPrisma } = setupService();
      const buffer = validPngBuffer;
      const att = await service.uploadAttachment(
        ownerActor,
        {
          file_name: 'uncleared.png',
          mime_type: 'image/png',
          content_base64: buffer.toString('base64'),
        },
        buffer,
        '127.0.0.1',
        'c'
      );

      // Simulate a tampered or buggy writer flipping the application-side flag
      // without any trusted antivirus clearance: download must still refuse.
      await mockPrisma.attachment.update({
        where: { id: att.id },
        data: { metadata: { scan_status: 'HEURISTIC_PASSED', scan_clearance: true } as any },
      });

      await assert.rejects(
        async () => {
          await service.downloadAttachment(ownerActor, att.id, '127.0.0.1', 'corr-dl-unverified');
        },
        (err: any) => {
          assert.strictEqual(err.code, 'ATTACHMENT_UNAVAILABLE');
          assert.strictEqual(err.getStatus(), 403);
          return true;
        }
      );
    });

    it('Round 3 (Finding 2): capability matrix — every action maps to its registry capabilities and entity requirements hold', async () => {
      const { service, mockRbac } = setupService();

      for (const action of ATTACHMENT_ACTIONS) {
        const caps = ATTACHMENT_ACTION_CAPABILITIES[action];
        assert.ok(caps.length > 0, `action ${action} must map to at least one capability`);

        // Each mapped capability alone must satisfy the action
        for (const cap of caps) {
          mockRbac.getActorPermissions = async () => [cap];
          const scopes = await service.getActorScopes(matrixActor);
          service.verifyAttachmentCapabilities(scopes, action);
        }

        // An actor without any mapped capability is rejected
        mockRbac.getActorPermissions = async () => ['audit:view'];
        const deniedScopes = await service.getActorScopes(matrixActor);
        assert.throws(
          () => service.verifyAttachmentCapabilities(deniedScopes, action),
          (err: any) => err.code === 'FORBIDDEN' && err.getStatus() === 403
        );
      }

      // Entity-type requirements: each required capability suffices; unrelated ones do not
      for (const [entity, requiredCaps] of Object.entries(ATTACHMENT_ENTITY_REQUIREMENTS)) {
        for (const cap of requiredCaps) {
          mockRbac.getActorPermissions = async () => ['iam:shop_view', cap];
          const scopes = await service.getActorScopes(matrixActor);
          service.verifyAttachmentCapabilities(scopes, 'GET', entity);
        }

        mockRbac.getActorPermissions = async () => ['iam:shop_view', 'audit:view'];
        const deniedScopes = await service.getActorScopes(matrixActor);
        assert.throws(
          () => service.verifyAttachmentCapabilities(deniedScopes, 'GET', entity),
          (err: any) => err.code === 'FORBIDDEN'
        );
      }

      // iam:shop_config authorizes every entity type
      mockRbac.getActorPermissions = async () => ['iam:shop_config'];
      const adminScopes = await service.getActorScopes(matrixActor);
      for (const entity of Object.keys(ATTACHMENT_ENTITY_REQUIREMENTS)) {
        service.verifyAttachmentCapabilities(adminScopes, 'DELETE', entity);
      }
    });

    it('Round 3 (Finding 8): bulk delete failures return fixed canonical messages, never exception-derived text', async () => {
      const { service, mockPrisma } = setupService();
      const buffer = validPngBuffer;
      const att = await service.uploadAttachment(
        ownerActor,
        {
          file_name: 'bulk-secret.png',
          mime_type: 'image/png',
          content_base64: buffer.toString('base64'),
        },
        buffer,
        '127.0.0.1',
        'c'
      );

      // Force the durable deletion-intent transaction to fail with a distinctive, secret-looking message
      const originalUpdate = mockPrisma.attachment.update;
      mockPrisma.$transaction = async (fn: any) => {
        const failingPrisma = {
          ...mockPrisma,
          attachment: {
            ...mockPrisma.attachment,
            update: async () => {
              throw new Error(
                'FATAL SECRET: connection pool pg://user:password@10.0.0.5:5432 detail'
              );
            },
          },
        };
        return fn(failingPrisma);
      };

      const res = await service.bulkDeleteAttachments(
        ownerActor,
        { ids: [att.id], confirm: true },
        '127.0.0.1',
        'corr-bulk-secret'
      );

      mockPrisma.$transaction = originalUpdate;
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.failure_count, 1);
      const failed = res.results.find((r) => r.id === att.id);
      assert.strictEqual(failed?.status, 'FAILED');
      assert.strictEqual(failed?.code, 'DELETE_ERROR');
      assert.ok(failed?.message?.length > 0);
      assert.ok(!failed?.message?.includes('FATAL SECRET'));
      assert.ok(!failed?.message?.includes('pg://'));
      // Row unchanged (deletion intent was never persisted)
      const row = await mockPrisma.attachment.findFirst({ where: { id: att.id } });
      assert.strictEqual(row?.status, 'ACTIVE');
    });

    it('Round 5 (Finding 2): list applies entity authorization to discovery and counts', async () => {
      const { service, mockPrisma, mockRbac } = setupService();

      // Seed a RETURN attachment and a STATEMENT attachment
      await mockPrisma.attachment.create({
        data: {
          id: 'att-return-1',
          merchant_id: 'm-tenant-1',
          file_name: 'return.png',
          file_size: BigInt(100),
          mime_type: 'image/png',
          checksum_sha256: 'abc',
          storage_key: 'key-ret',
          storage_bucket: 'b',
          entity_type: 'RETURN',
          entity_id: 'ret-1',
          status: 'ACTIVE',
          retention_days: 90,
          expires_at: new Date(Date.now() + 86400000),
          warehouse_id: 'wh-hcm-01',
          branch_id: 'branch-hcm',
          metadata: { scan_status: 'CLEAN' },
        },
      });

      await mockPrisma.attachment.create({
        data: {
          id: 'att-stmt-1',
          merchant_id: 'm-tenant-1',
          file_name: 'statement.xlsx',
          file_size: BigInt(200),
          mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          checksum_sha256: 'def',
          storage_key: 'key-stmt',
          storage_bucket: 'b',
          entity_type: 'STATEMENT',
          entity_id: 'stmt-1',
          status: 'ACTIVE',
          retention_days: 90,
          expires_at: new Date(Date.now() + 86400000),
          warehouse_id: 'wh-hcm-01',
          branch_id: 'branch-hcm',
          metadata: { scan_status: 'CLEAN' },
        },
      });

      // Actor with only shipment:receive_return (no reconciliation capability, no iam:shop_config)
      const returnActor: ActorContext = {
        userId: 'u-scoped-hcm',
        merchantId: 'm-tenant-1',
        role: 'WAREHOUSE',
      };
      mockRbac.getActorPermissions = async () => ['shipment:receive_return'];

      // Listing without entity filter must exclude STATEMENT and count only RETURN
      const list = await service.listAttachments(returnActor, {}, 'corr-ent-list');
      assert.strictEqual(list.meta.total, 1);
      assert.strictEqual(list.data.length, 1);
      assert.strictEqual(list.data[0].id, 'att-return-1');

      // Listing with explicit entity_type: STATEMENT must fail closed (0 results)
      const stmtList = await service.listAttachments(
        returnActor,
        { entity_type: 'STATEMENT' },
        'corr-ent-stmt'
      );
      assert.strictEqual(stmtList.meta.total, 0);
      assert.strictEqual(stmtList.data.length, 0);
    });

    it('Round 5 (Finding 3): upload creates recoverable orphan intent before S3 write and marks it DONE on commit', async () => {
      const { service, mockPrisma } = setupService();
      const buffer = validPngBuffer;

      const att = await service.uploadAttachment(
        ownerActor,
        {
          file_name: 'orphan-intent.png',
          mime_type: 'image/png',
          content_base64: buffer.toString('base64'),
        },
        buffer,
        '127.0.0.1',
        'corr-orphan-intent'
      );

      assert.ok(att.id);
      const orphans = await mockPrisma.attachmentOrphanCleanup.findMany({
        where: { merchant_id: ownerActor.merchantId },
      });
      assert.ok(orphans.length > 0);
      const record = orphans.find((o: any) => o.storage_key.includes(att.id));
      assert.ok(record);
      assert.strictEqual(record.status, 'DONE');
      assert.strictEqual(record.reason, 'UPLOAD_ROLLBACK');
    });

    it('Round 5 (Finding 5): quarantine atomically conditions on ACTIVE and rejects non-active state', async () => {
      const { service, mockPrisma } = setupService();
      const buffer = validPngBuffer;
      const att = await service.uploadAttachment(
        ownerActor,
        {
          file_name: 'concurrent-q.png',
          mime_type: 'image/png',
          content_base64: buffer.toString('base64'),
        },
        buffer,
        '127.0.0.1',
        'c'
      );

      // Concurrent deletion commits PENDING_DELETION
      await mockPrisma.attachment.update({
        where: { id: att.id },
        data: { status: 'PENDING_DELETION' },
      });

      const auditCountBefore = (mockPrisma.auditLog as any).length || 0;

      await assert.rejects(
        async () => {
          await service.quarantineAttachment(ownerActor, att.id, 'quarantine test', 'corr-q-race');
        },
        (err: any) => {
          assert.strictEqual(err.code, 'INVALID_STATE');
          assert.strictEqual(err.getStatus(), 409);
          return true;
        }
      );

      // Verify row remains PENDING_DELETION and was NOT overwritten
      const checkRow = await mockPrisma.attachment.findFirst({ where: { id: att.id } });
      assert.strictEqual(checkRow?.status, 'PENDING_DELETION');
    });

    it('Round 5 (Finding 8): domain mutation permissions grant can_edit: true in list', async () => {
      const { service, mockRbac } = setupService();
      const domainActor: ActorContext = {
        userId: 'u-scoped-hcm',
        merchantId: 'm-tenant-1',
        role: 'WAREHOUSE',
      };
      mockRbac.getActorPermissions = async () => ['order:view_create'];

      const res = await service.listAttachments(domainActor, {}, 'corr-canedit-domain');
      assert.strictEqual(res.meta.can_edit, true);
    });

    it('Round 5 (Finding 10): entity resolution derives and validates both warehouse_id and branch_id', async () => {
      const { service } = setupService();
      const buffer = validPngBuffer;

      // 1. ORDER derives both branch_id (branch-hcm) and warehouse_id (wh-hcm-01)
      const orderAtt = await service.uploadAttachment(
        ownerActor,
        {
          file_name: 'order_evidence.png',
          mime_type: 'image/png',
          content_base64: buffer.toString('base64'),
          entity_type: 'ORDER',
          entity_id: 'ord-both-123',
        },
        buffer,
        '127.0.0.1',
        'corr-order-derive'
      );
      assert.strictEqual(orderAtt.branch_id, 'branch-hcm');
      assert.strictEqual(orderAtt.warehouse_id, 'wh-hcm-01');

      // Mismatched warehouse for order throws 400
      await assert.rejects(
        async () => {
          await service.uploadAttachment(
            ownerActor,
            {
              file_name: 'order_mismatch.png',
              mime_type: 'image/png',
              content_base64: buffer.toString('base64'),
              entity_type: 'ORDER',
              entity_id: 'ord-both-123',
              warehouse_id: 'wh-danang',
            },
            buffer,
            '127.0.0.1',
            'corr-order-mismatch'
          );
        },
        (err: any) => {
          assert.strictEqual(err.code, 'VALIDATION_ERROR');
          return true;
        }
      );

      // 2. SHIPMENT derives both warehouse_id (wh-hcm-01) and branch_id (branch-hcm)
      const shipAtt = await service.uploadAttachment(
        ownerActor,
        {
          file_name: 'ship_evidence.png',
          mime_type: 'image/png',
          content_base64: buffer.toString('base64'),
          entity_type: 'SHIPMENT',
          entity_id: 'shp-both-123',
        },
        buffer,
        '127.0.0.1',
        'corr-ship-derive'
      );
      assert.strictEqual(shipAtt.warehouse_id, 'wh-hcm-01');
      assert.strictEqual(shipAtt.branch_id, 'branch-hcm');
    });

    it('Round 5 (Finding 11): listAttachments with status ALL includes all statuses', async () => {
      const { service, mockPrisma } = setupService();

      await mockPrisma.attachment.create({
        data: {
          id: 'att-all-active',
          merchant_id: 'm-tenant-1',
          file_name: 'active.png',
          file_size: BigInt(100),
          mime_type: 'image/png',
          checksum_sha256: '111',
          storage_key: 'k-1',
          storage_bucket: 'b',
          entity_type: 'GENERAL',
          status: 'ACTIVE',
          retention_days: 90,
          expires_at: new Date(Date.now() + 86400000),
          warehouse_id: 'wh-hcm-01',
          branch_id: 'branch-hcm',
          metadata: { scan_status: 'CLEAN' },
        },
      });

      await mockPrisma.attachment.create({
        data: {
          id: 'att-all-quarantined',
          merchant_id: 'm-tenant-1',
          file_name: 'quarantined.png',
          file_size: BigInt(100),
          mime_type: 'image/png',
          checksum_sha256: '222',
          storage_key: 'k-2',
          storage_bucket: 'b',
          entity_type: 'GENERAL',
          status: 'QUARANTINED',
          retention_days: 90,
          expires_at: new Date(Date.now() + 86400000),
          warehouse_id: 'wh-hcm-01',
          branch_id: 'branch-hcm',
          metadata: { scan_status: 'CLEAN' },
        },
      });

      const res = await service.listAttachments(ownerActor, { status: 'ALL' }, 'corr-all');
      assert.ok(res.data.some((a) => a.id === 'att-all-active'));
      assert.ok(res.data.some((a) => a.id === 'att-all-quarantined'));
    });

    it('Round 5 (Finding 13 & 15): scoped reconciliation discovers eligible rows and persists audit before deletion', async () => {
      const { service, mockPrisma, mockStorage, auditLogs } = setupService();

      // Seed pending deletion row and S3 object
      const key = 'merchants/m-tenant-1/attachments/att-pending-scope/file.png';
      mockStorage.putObject(key, Buffer.from('test'), 'image/png');
      await mockPrisma.attachment.create({
        data: {
          id: 'att-pending-scope',
          merchant_id: 'm-tenant-1',
          file_name: 'file.png',
          file_size: BigInt(4),
          mime_type: 'image/png',
          checksum_sha256: '333',
          storage_key: key,
          storage_bucket: 'b',
          entity_type: 'GENERAL',
          status: 'PENDING_DELETION',
          retention_days: 90,
          expires_at: new Date(Date.now() + 86400000),
          warehouse_id: 'wh-hcm-01',
          branch_id: 'branch-hcm',
          metadata: { scan_status: 'CLEAN' },
        },
      });

      // Seed orphan cleanup row
      const orphanKey = 'merchants/m-tenant-1/attachments/att-orphan-aud/file.png';
      mockStorage.putObject(orphanKey, Buffer.from('orphan'), 'image/png');
      await mockPrisma.attachmentOrphanCleanup.create({
        data: {
          id: 'orphan-aud-1',
          merchant_id: 'm-tenant-1',
          storage_key: orphanKey,
          storage_bucket: 'b',
          reason: 'UPLOAD_ROLLBACK',
          // ORPHANED = the upload explicitly declared the object unreferenced
          // (a fresh PENDING record is owned by a live upload and not eligible).
          status: 'ORPHANED',
        },
      });

      const outcome = await service.reconcilePendingDeletions(ownerActor, 'corr-rec-5');
      assert.strictEqual(outcome.reconciled, 1);
      assert.strictEqual(outcome.orphan_reconciled, 1);

      // Verify audit log exists for orphan cleanup
      const orphanAudit = auditLogs.find(
        (a: any) => a.action === AttachmentAuditEvent.ATTACHMENT_ORPHAN_CLEANED
      );
      assert.ok(orphanAudit);
    });

    // ========================================================================
    // Review P1 (Finding 2): Orphan reconciliation ownership and atomic claim interleaving
    // ========================================================================
    it('Review P1 (Finding 2): reconciler ignores in-flight PENDING uploads within grace period and does not delete their objects', async () => {
      const { service, mockPrisma, mockStorage, s3Storage } = setupService();

      const liveKey = 'merchants/m-tenant-1/attachments/att-live/file.png';
      await mockStorage.putObject(liveKey, Buffer.from('live-upload-bytes'), 'image/png');

      // Seed a fresh PENDING intent created just now (in-flight upload)
      await mockPrisma.attachmentOrphanCleanup.create({
        data: {
          id: 'orphan-live-1',
          merchant_id: 'm-tenant-1',
          storage_key: liveKey,
          storage_bucket: 'b',
          reason: 'UPLOAD_ROLLBACK',
          status: 'PENDING',
          updated_at: new Date(),
        },
      });

      // Reconciler runs concurrently while upload is still in progress
      const outcome = await service.reconcilePendingDeletions(ownerActor, 'corr-rec-live');
      assert.strictEqual(outcome.orphan_reconciled, 0);

      // S3 object must remain intact — not deleted
      assert.strictEqual(s3Storage.has(liveKey), true);

      // Record remains PENDING (owned by upload)
      const record = await mockPrisma.attachmentOrphanCleanup.findMany({
        where: { id: 'orphan-live-1' },
      });
      assert.strictEqual(record[0].status, 'PENDING');
    });

    it('Review P1 (Finding 2): committed upload marks cleanup DONE; reconciler ignores DONE records', async () => {
      const { service, mockPrisma, mockStorage, s3Storage } = setupService();

      const doneKey = 'merchants/m-tenant-1/attachments/att-done/file.png';
      await mockStorage.putObject(doneKey, Buffer.from('committed-bytes'), 'image/png');

      await mockPrisma.attachmentOrphanCleanup.create({
        data: {
          id: 'orphan-done-1',
          merchant_id: 'm-tenant-1',
          storage_key: doneKey,
          storage_bucket: 'b',
          reason: 'UPLOAD_ROLLBACK',
          status: 'DONE',
        },
      });

      const outcome = await service.reconcilePendingDeletions(ownerActor, 'corr-rec-done');
      assert.strictEqual(outcome.orphan_reconciled, 0);
      assert.strictEqual(s3Storage.has(doneKey), true);
    });

    it('Review P1 (Finding 2): atomic claim skips record if concurrent upload finalized to DONE', async () => {
      const { service, mockPrisma, mockStorage, s3Storage } = setupService();

      const key = 'merchants/m-tenant-1/attachments/att-race/file.png';
      await mockStorage.putObject(key, Buffer.from('race-bytes'), 'image/png');

      // Stale pending record (> 900s ago)
      const staleDate = new Date(Date.now() - 1000 * 1000);
      await mockPrisma.attachmentOrphanCleanup.create({
        data: {
          id: 'orphan-stale-race',
          merchant_id: 'm-tenant-1',
          storage_key: key,
          storage_bucket: 'b',
          reason: 'UPLOAD_ROLLBACK',
          status: 'PENDING',
          created_at: staleDate,
          updated_at: staleDate,
        },
      });

      // Interleaving simulation: before reconciler executes atomic claim,
      // upload transaction commits and updates status PENDING -> DONE
      const origUpdateMany = mockPrisma.attachmentOrphanCleanup.updateMany;
      mockPrisma.attachmentOrphanCleanup.updateMany = async (args: any) => {
        // Upload concurrently finalized
        const r = (mockPrisma as any).orphansTable?.find((o: any) => o.id === 'orphan-stale-race');
        if (r) r.status = 'DONE';
        // Claim against status === 'PENDING' will now match 0 rows
        return origUpdateMany(args);
      };

      const outcome = await service.reconcilePendingDeletions(ownerActor, 'corr-rec-race');
      // Reconciler skipped because claim returned count 0
      assert.strictEqual(outcome.orphan_reconciled, 0);
      // Object was NOT destroyed
      assert.strictEqual(s3Storage.has(key), true);
    });

    // ========================================================================
    // Review P1 (Finding 3): Ambiguous storage failure recovery
    // ========================================================================
    it('Review P1 (Finding 3): putObject exception after writing bytes leaves cleanup record ORPHANED and recoverable', async () => {
      const { service, mockPrisma, mockStorage, s3Storage } = setupService();
      const buffer = validPngBuffer;

      // Mock storage writes the bytes to S3, but then loses the connection and throws
      mockStorage.putObject = async (key: string, body: Buffer, contentType: string) => {
        s3Storage.set(key, { body, contentType });
        const err: any = new Error('ECONNRESET: S3 socket closed abruptly after writing payload');
        err.name = 'StorageNetworkError';
        throw err;
      };

      // Upload fails closed with STORAGE_UNAVAILABLE
      await assert.rejects(
        async () => {
          await service.uploadAttachment(
            ownerActor,
            {
              file_name: 'ambiguous_upload.png',
              mime_type: 'image/png',
              content_base64: buffer.toString('base64'),
            },
            buffer,
            '127.0.0.1',
            'corr-ambiguous'
          );
        },
        (err: any) => {
          assert.strictEqual(err.code, 'STORAGE_UNAVAILABLE');
          assert.strictEqual(err.getStatus(), 503);
          return true;
        }
      );

      // Verify NO active attachment row was created in DB
      const attachments = await mockPrisma.attachment.findMany({
        where: { merchant_id: ownerActor.merchantId },
      });
      assert.strictEqual(attachments.length, 0);

      // Verify the orphan cleanup intent is ORPHANED (NOT DONE)
      const orphans = await mockPrisma.attachmentOrphanCleanup.findMany({
        where: { merchant_id: ownerActor.merchantId },
      });
      assert.strictEqual(orphans.length, 1);
      assert.strictEqual(orphans[0].status, 'ORPHANED');
      assert.strictEqual(orphans[0].reason, 'UPLOAD_ROLLBACK');

      // Verify orphaned bytes exist in storage
      const orphanKey = orphans[0].storage_key;
      assert.strictEqual(s3Storage.has(orphanKey), true);

      // Restore healthy storage operations
      mockStorage.putObject = async (key: string, body: Buffer, contentType: string) => {
        s3Storage.set(key, { body, contentType });
      };

      // Reconciliation discovers the ORPHANED record and deletes the orphaned bytes
      const outcome = await service.reconcilePendingDeletions(ownerActor, 'corr-rec-ambiguous');
      assert.strictEqual(outcome.orphan_reconciled, 1);
      assert.strictEqual(s3Storage.has(orphanKey), false);

      const finalOrphan = await mockPrisma.attachmentOrphanCleanup.findMany({
        where: { id: orphans[0].id },
      });
      assert.strictEqual(finalOrphan[0].status, 'DONE');
    });

    // ========================================================================
    // Review P1 (Finding 4): Consistent scope authorization & empty scopes
    // ========================================================================
    it('Review P1 (Finding 4): actor with wildcard in one dimension only is denied unscoped attachment across all actions', async () => {
      const { service, mockPrisma, mockStorage } = setupService();

      const unscopedId = randomUUID();
      // Seed an unscoped attachment (warehouse_id: null, branch_id: null)
      const unscopedAtt = await mockPrisma.attachment.create({
        data: {
          id: unscopedId,
          merchant_id: 'm-tenant-1',
          file_name: 'tenant_contract.pdf',
          file_size: BigInt(1234),
          mime_type: 'application/pdf',
          checksum_sha256: 'abc123sha',
          storage_key: `merchants/m-tenant-1/attachments/${unscopedId}/abc.pdf`,
          storage_bucket: 'b',
          entity_type: 'GENERAL',
          status: 'ACTIVE',
          retention_days: 90,
          expires_at: new Date(Date.now() + 86400000),
          warehouse_id: null,
          branch_id: null,
          metadata: { scan_status: 'CLEAN', scan_clearance: true },
        },
      });

      await mockStorage.putObject(
        unscopedAtt.storage_key,
        Buffer.from('unscoped-content'),
        'application/pdf'
      );

      const actorsToTest = [
        { name: 'all warehouses, one branch', actor: mixedWildcardActor },
        { name: 'one warehouse, all branches', actor: mixedBranchWildcardActor },
      ];

      for (const { name, actor } of actorsToTest) {
        // 1. GET by ID -> denied
        await assert.rejects(
          async () => {
            await service.getAttachment(actor, unscopedAtt.id, 'corr-get');
          },
          (err: any) => {
            assert.strictEqual(err.code, 'SCOPE_FORBIDDEN', `${name} should be denied GET`);
            assert.strictEqual(err.getStatus(), 403);
            return true;
          }
        );

        // 2. DOWNLOAD by ID -> denied
        await assert.rejects(
          async () => {
            await service.downloadAttachment(actor, unscopedAtt.id, '127.0.0.1', 'corr-dl');
          },
          (err: any) => {
            assert.strictEqual(err.code, 'SCOPE_FORBIDDEN', `${name} should be denied DOWNLOAD`);
            assert.strictEqual(err.getStatus(), 403);
            return true;
          }
        );

        // 3. DELETE by ID -> denied
        await assert.rejects(
          async () => {
            await service.deleteAttachment(actor, unscopedAtt.id, true, '127.0.0.1', 'corr-del');
          },
          (err: any) => {
            assert.strictEqual(err.code, 'SCOPE_FORBIDDEN', `${name} should be denied DELETE`);
            assert.strictEqual(err.getStatus(), 403);
            return true;
          }
        );

        // 4. UPLOAD unscoped -> denied
        await assert.rejects(
          async () => {
            await service.uploadAttachment(
              actor,
              {
                file_name: 'attempt_unscoped.png',
                mime_type: 'image/png',
                content_base64: validPngBuffer.toString('base64'),
                entity_type: 'GENERAL',
              },
              validPngBuffer,
              '127.0.0.1',
              'corr-upload'
            );
          },
          (err: any) => {
            assert.strictEqual(
              err.code,
              'SCOPE_FORBIDDEN',
              `${name} should be denied unscoped upload`
            );
            assert.strictEqual(err.getStatus(), 403);
            return true;
          }
        );

        // 5. LIST discovery -> unscoped row is NOT returned
        const listRes = await service.listAttachments(actor, {}, 'corr-list');
        assert.strictEqual(
          listRes.data.some((a) => a.id === unscopedAtt.id),
          false,
          `${name} must not discover unscoped row`
        );
      }
    });

    it('Review P1 (Finding 4): actor with completely empty scopes denies all actions', async () => {
      const { service, mockPrisma } = setupService();

      const scopedId = randomUUID();
      const scopedAtt = await mockPrisma.attachment.create({
        data: {
          id: scopedId,
          merchant_id: 'm-tenant-1',
          file_name: 'wh_doc.png',
          file_size: BigInt(500),
          mime_type: 'image/png',
          checksum_sha256: 'xyz',
          storage_key: `merchants/m-tenant-1/attachments/${scopedId}/wh_doc.png`,
          storage_bucket: 'b',
          entity_type: 'GENERAL',
          status: 'ACTIVE',
          retention_days: 90,
          expires_at: new Date(Date.now() + 86400000),
          warehouse_id: 'wh-hcm-01',
          branch_id: null,
          metadata: { scan_status: 'CLEAN', scan_clearance: true },
        },
      });

      // 1. checkAttachmentScope directly returns false
      const scopes = await service.getActorScopes(emptyScopeActor);
      assert.strictEqual(service.checkAttachmentScope(scopedAtt, scopes), false);

      // 2. GET -> denied
      await assert.rejects(
        async () => {
          await service.getAttachment(emptyScopeActor, scopedAtt.id, 'c');
        },
        (err: any) => {
          assert.strictEqual(err.code, 'SCOPE_FORBIDDEN');
          return true;
        }
      );

      // 3. UPLOAD -> denied
      await assert.rejects(
        async () => {
          await service.uploadAttachment(
            emptyScopeActor,
            {
              file_name: 'test.png',
              mime_type: 'image/png',
              content_base64: validPngBuffer.toString('base64'),
              warehouse_id: 'wh-hcm-01',
            },
            validPngBuffer,
            '127.0.0.1',
            'c'
          );
        },
        (err: any) => {
          assert.strictEqual(err.code, 'SCOPE_FORBIDDEN');
          return true;
        }
      );

      // 4. LIST -> returns empty immediately
      const listRes = await service.listAttachments(emptyScopeActor, {}, 'c');
      assert.strictEqual(listRes.data.length, 0);
      assert.strictEqual(listRes.meta.total, 0);
    });

    // ========================================================================
    // Review P1 (Finding 5): Audit records mask sensitive user-controlled text
    // ========================================================================
    it('Review P1 (Finding 5): upload, download, quarantine and delete audit logs do not contain plaintext PII, filenames or storage keys', async () => {
      const { service, mockPrisma, auditLogs } = setupService();
      const sensitiveFileName = 'customer_phone_0901234567_secret_pass.png';
      const buffer = validPngBuffer;

      // 1. Upload with sensitive filename and metadata
      const att = await service.uploadAttachment(
        ownerActor,
        {
          file_name: sensitiveFileName,
          mime_type: 'image/png',
          content_base64: buffer.toString('base64'),
          entity_type: 'GENERAL',
          metadata: {
            contact_phone: '0901234567',
            customer_email: 'buyer@test.com',
            free_note: 'Call customer at 0909888777 for delivery',
          },
        },
        buffer,
        '127.0.0.1',
        'corr-aud-test'
      );

      // Assert storage key uses opaque hash, NOT sensitive filename
      assert.strictEqual(att.storage_key.includes(sensitiveFileName), false);

      // Check upload audit log
      const uploadAudit = auditLogs.find(
        (a) => a.action === AttachmentAuditEvent.ATTACHMENT_UPLOADED
      );
      assert.ok(uploadAudit);
      assert.strictEqual(uploadAudit.entity_id, att.id); // Opaque UUID
      assert.strictEqual(uploadAudit.reason.includes(sensitiveFileName), false);
      assert.strictEqual(JSON.stringify(uploadAudit.new_value).includes(sensitiveFileName), false);
      assert.strictEqual(JSON.stringify(uploadAudit.new_value).includes(att.storage_key), false);

      // 2. Download after clearance
      await mockPrisma.attachment.update({
        where: { id: att.id },
        data: { metadata: { scan_status: 'CLEAN', scan_clearance: true } },
      });

      await service.downloadAttachment(ownerActor, att.id, '127.0.0.1', 'corr-aud-dl');
      const dlAudit = auditLogs.find((a) => a.action === AttachmentAuditEvent.ATTACHMENT_ACCESSED);
      assert.ok(dlAudit);
      assert.strictEqual(dlAudit.entity_id, att.id);
      assert.strictEqual(dlAudit.reason.includes(sensitiveFileName), false);
      assert.strictEqual(JSON.stringify(dlAudit.new_value).includes(sensitiveFileName), false);
      assert.strictEqual(JSON.stringify(dlAudit.new_value).includes(att.storage_key), false);

      // 3. Quarantine with free-text reason containing email and phone
      const sensitiveReason =
        'Detected virus from attacker@evil.org, contact +84912345678 immediately!';
      await service.quarantineAttachment(ownerActor, att.id, sensitiveReason, 'corr-aud-q');
      const qAudit = auditLogs.find(
        (a) => a.action === AttachmentAuditEvent.ATTACHMENT_QUARANTINED
      );
      assert.ok(qAudit);
      assert.strictEqual(qAudit.entity_id, att.id);
      assert.strictEqual(qAudit.reason.includes(sensitiveFileName), false);
      // Redaction in new_value: arbitrary free-text reason omitted; allowlisted reason_code persisted
      const qNewValue = qAudit.new_value;
      assert.strictEqual(qNewValue.reason, undefined);
      assert.strictEqual(qNewValue.reason_code, 'MANUAL_SECURITY_REVIEW');
      assert.strictEqual(JSON.stringify(qAudit).includes('attacker@evil.org'), false);
      assert.strictEqual(JSON.stringify(qAudit).includes('+84912345678'), false);

      // 4. Delete attachment
      await service.deleteAttachment(ownerActor, att.id, true, '127.0.0.1', 'corr-aud-del');
      const delAudit = auditLogs.find((a) => a.action === AttachmentAuditEvent.ATTACHMENT_DELETED);
      assert.ok(delAudit);
      assert.strictEqual(delAudit.entity_id, att.id);
      assert.strictEqual(delAudit.reason.includes(sensitiveFileName), false);
      assert.strictEqual(JSON.stringify(delAudit.new_value).includes(sensitiveFileName), false);
      assert.strictEqual(JSON.stringify(delAudit.old_value).includes(sensitiveFileName), false);
    });

    // ========================================================================
    // Review P1 (Finding 6): Quarantined files retention lifecycle and failure recovery
    // ========================================================================
    it('Review P1 (Finding 6): retention purge discovers and purges expired QUARANTINED evidence', async () => {
      const { service, mockPrisma, mockStorage, s3Storage, auditLogs } = setupService();

      const qKey = 'merchants/m-tenant-1/attachments/att-q-expired/file.png';
      await mockStorage.putObject(qKey, Buffer.from('malicious-payload'), 'image/png');

      const pastExpiry = new Date(Date.now() - 3600 * 1000); // Expired 1 hour ago
      const qAtt = await mockPrisma.attachment.create({
        data: {
          id: 'att-q-expired',
          merchant_id: 'm-tenant-1',
          file_name: 'suspicious.png',
          file_size: BigInt(100),
          mime_type: 'image/png',
          checksum_sha256: 'mal-sha',
          storage_key: qKey,
          storage_bucket: 'b',
          entity_type: 'GENERAL',
          status: 'QUARANTINED',
          retention_days: 30,
          expires_at: pastExpiry,
          warehouse_id: 'wh-hcm-01',
          branch_id: 'branch-hcm',
          metadata: { scan_status: 'QUARANTINED' },
        },
      });

      // Execute retention purge
      const purgeOutcome = await service.purgeExpiredRetention(
        ownerActor,
        {},
        '127.0.0.1',
        'corr-ret-q'
      );

      assert.strictEqual(purgeOutcome.success, true);
      assert.strictEqual(purgeOutcome.success_count, 1);
      assert.ok(purgeOutcome.succeeded_ids.includes(qAtt.id));

      // S3 object deleted
      assert.strictEqual(s3Storage.has(qKey), false);

      // Attachment transitioned to DELETED in DB
      const row = await mockPrisma.attachment.findFirst({ where: { id: qAtt.id } });
      assert.strictEqual(row?.status, 'DELETED');

      // Purge audit log persisted with masked metadata
      const purgeAudit = auditLogs.find(
        (a: any) => a.action === AttachmentAuditEvent.ATTACHMENT_PURGED && a.entity_id === qAtt.id
      );
      assert.ok(purgeAudit);
      assert.strictEqual(purgeAudit.old_value?.status, 'QUARANTINED');
      assert.strictEqual(purgeAudit.new_value?.status, 'PENDING_DELETION');
    });

    it('Review P1 (Finding 6): retention purge failure recovery leaves QUARANTINED row PENDING_DELETION and reconciler completes it', async () => {
      const { service, mockPrisma, mockStorage, s3Storage } = setupService();

      const qKey = 'merchants/m-tenant-1/attachments/att-q-recover/file.png';
      await mockStorage.putObject(qKey, Buffer.from('payload-to-recover'), 'image/png');

      const pastExpiry = new Date(Date.now() - 3600 * 1000);
      const qAtt = await mockPrisma.attachment.create({
        data: {
          id: 'att-q-recover',
          merchant_id: 'm-tenant-1',
          file_name: 'recover.png',
          file_size: BigInt(200),
          mime_type: 'image/png',
          checksum_sha256: 'rec-sha',
          storage_key: qKey,
          storage_bucket: 'b',
          entity_type: 'GENERAL',
          status: 'QUARANTINED',
          retention_days: 30,
          expires_at: pastExpiry,
          warehouse_id: 'wh-hcm-01',
          branch_id: 'branch-hcm',
          metadata: { scan_status: 'QUARANTINED' },
        },
      });

      // Storage delete fails during purge
      const origDelete = mockStorage.deleteObject;
      mockStorage.deleteObject = async () => {
        throw new Error('S3 connection timeout during retention delete');
      };

      const purgeOutcome = await service.purgeExpiredRetention(
        ownerActor,
        {},
        '127.0.0.1',
        'corr-ret-fail'
      );
      assert.strictEqual(purgeOutcome.failure_count, 1);
      assert.ok(purgeOutcome.failed_ids.includes(qAtt.id));

      // Row remained in PENDING_DELETION state
      const rowPending = await mockPrisma.attachment.findFirst({ where: { id: qAtt.id } });
      assert.strictEqual(rowPending?.status, 'PENDING_DELETION');
      assert.strictEqual(s3Storage.has(qKey), true);

      // Storage becomes healthy again; run reconciliation
      mockStorage.deleteObject = origDelete;
      const recOutcome = await service.reconcilePendingDeletions(ownerActor, 'corr-rec-retry');
      assert.strictEqual(recOutcome.reconciled, 1);

      // Final status is DELETED and S3 storage object is removed
      assert.strictEqual(s3Storage.has(qKey), false);
      const rowDeleted = await mockPrisma.attachment.findFirst({ where: { id: qAtt.id } });
      assert.strictEqual(rowDeleted?.status, 'DELETED');
    });

    // ========================================================================
    // Review Round 2 (Finding 10): Scoped administrators cannot bypass restrictions by ID
    // ========================================================================
    it('Review Round 2 (Finding 10): scoped administrator is denied access to attachments outside warehouse/branch scope by ID', async () => {
      const { service, mockPrisma, mockStorage } = setupService();

      // Administrator has iam:shop_config but is scoped to wh-hcm-01 only
      const scopedAdminActor: ActorContext = {
        merchantId: 'm-tenant-1',
        userId: 'u-scoped-admin',
        role: 'ADMIN',
        warehouseScopes: ['wh-hcm-01'],
        storeScopes: ['*'],
      };

      const whBAttId = randomUUID();
      const whBAtt = await mockPrisma.attachment.create({
        data: {
          id: whBAttId,
          merchant_id: 'm-tenant-1',
          file_name: 'wh_b_doc.png',
          file_size: BigInt(200),
          mime_type: 'image/png',
          checksum_sha256: 'hash-wh-b',
          storage_key: `merchants/m-tenant-1/attachments/${whBAttId}/wh_b_doc.png`,
          storage_bucket: 'test-bucket',
          entity_type: 'GENERAL',
          status: 'ACTIVE',
          retention_days: 90,
          expires_at: new Date(Date.now() + 86400000),
          warehouse_id: 'wh-danang-02', // Different warehouse!
          branch_id: null,
          metadata: { scan_status: 'CLEAN', scan_clearance: true },
        },
      });
      await mockStorage.putObject(whBAtt.storage_key, Buffer.from('wh-b-data'), 'image/png');

      const scopes = await service.getActorScopes(scopedAdminActor);
      assert.strictEqual(service.checkAttachmentScope(whBAtt, scopes), false);

      // 1. GET by ID -> denied with 403 SCOPE_FORBIDDEN
      await assert.rejects(
        async () => {
          await service.getAttachment(scopedAdminActor, whBAttId, 'corr-admin-get');
        },
        (err: any) => {
          assert.strictEqual(err.code, 'SCOPE_FORBIDDEN');
          assert.strictEqual(err.getStatus(), 403);
          return true;
        }
      );

      // 2. DOWNLOAD by ID -> denied with 403 SCOPE_FORBIDDEN
      await assert.rejects(
        async () => {
          await service.downloadAttachment(scopedAdminActor, whBAttId, '127.0.0.1', 'corr-admin-dl');
        },
        (err: any) => {
          assert.strictEqual(err.code, 'SCOPE_FORBIDDEN');
          assert.strictEqual(err.getStatus(), 403);
          return true;
        }
      );

      // 3. DELETE by ID -> denied with 403 SCOPE_FORBIDDEN
      await assert.rejects(
        async () => {
          await service.deleteAttachment(scopedAdminActor, whBAttId, true, '127.0.0.1', 'corr-admin-del');
        },
        (err: any) => {
          assert.strictEqual(err.code, 'SCOPE_FORBIDDEN');
          assert.strictEqual(err.getStatus(), 403);
          return true;
        }
      );
    });

    it('Review Round 2 (Finding 10): empty scopes deny all access across all endpoints even with iam:shop_config', async () => {
      const { service, mockPrisma, mockStorage } = setupService();

      const emptyAdminActor: ActorContext = {
        merchantId: 'm-tenant-1',
        userId: 'u-empty-admin',
        role: 'ADMIN',
        warehouseScopes: [],
        storeScopes: [],
      };

      const attId = randomUUID();
      const att = await mockPrisma.attachment.create({
        data: {
          id: attId,
          merchant_id: 'm-tenant-1',
          file_name: 'test.png',
          file_size: BigInt(200),
          mime_type: 'image/png',
          checksum_sha256: 'hash-test',
          storage_key: `merchants/m-tenant-1/attachments/${attId}/test.png`,
          storage_bucket: 'test-bucket',
          entity_type: 'GENERAL',
          status: 'ACTIVE',
          retention_days: 90,
          expires_at: new Date(Date.now() + 86400000),
          warehouse_id: 'wh-hcm-01',
          branch_id: 'branch-1',
          metadata: { scan_status: 'CLEAN', scan_clearance: true },
        },
      });
      await mockStorage.putObject(att.storage_key, Buffer.from('data'), 'image/png');

      // GET -> denied
      await assert.rejects(
        async () => {
          await service.getAttachment(emptyAdminActor, attId, 'corr-empty-get');
        },
        (err: any) => {
          assert.strictEqual(err.code, 'SCOPE_FORBIDDEN');
          return true;
        }
      );

      // DOWNLOAD -> denied
      await assert.rejects(
        async () => {
          await service.downloadAttachment(emptyAdminActor, attId, '127.0.0.1', 'corr-empty-dl');
        },
        (err: any) => {
          assert.strictEqual(err.code, 'SCOPE_FORBIDDEN');
          return true;
        }
      );

      // DELETE -> denied
      await assert.rejects(
        async () => {
          await service.deleteAttachment(emptyAdminActor, attId, true, '127.0.0.1', 'corr-empty-del');
        },
        (err: any) => {
          assert.strictEqual(err.code, 'SCOPE_FORBIDDEN');
          return true;
        }
      );

      // LIST -> returns empty
      const listRes = await service.listAttachments(emptyAdminActor, {}, 'corr-empty-list');
      assert.strictEqual(listRes.data.length, 0);
      assert.strictEqual(listRes.meta.total, 0);
    });

    // ========================================================================
    // Review Round 2 (Finding 9): Parent branch & warehouse scope derivation and validation
    // ========================================================================
    it('Review Round 2 (Finding 9): CLAIM derives branch_id; rejects conflicting branch and unauthorized branch', async () => {
      const { service, mockPrisma } = setupService();

      const claimId = randomUUID();
      await mockPrisma.claim.create({
        data: {
          id: claimId,
          merchant_id: 'm-tenant-1',
          warehouse_id: 'wh-hcm-01',
          branch_id: 'branch-hcm-01',
          shipment_id: randomUUID(),
          claim_type: 'LOST',
          deadline_at: new Date(Date.now() + 86400000),
        },
      });

      // 1. Conflicting branch throws 400 VALIDATION_ERROR
      await assert.rejects(
        async () => {
          await service.uploadAttachment(
            ownerActor,
            {
              file_name: 'claim_proof.png',
              mime_type: 'image/png',
              content_base64: validPngBuffer.toString('base64'),
              entity_type: 'CLAIM',
              entity_id: claimId,
              branch_id: 'branch-danang',
            },
            validPngBuffer,
            '127.0.0.1',
            'corr-claim-mismatch'
          );
        },
        (err: any) => {
          assert.strictEqual(err.code, 'VALIDATION_ERROR');
          assert.strictEqual(err.getStatus(), 400);
          const errMsg = (err.getResponse?.() as any)?.error?.message || '';
          assert.ok(errMsg.includes('Chi nhánh không khớp'));
          return true;
        }
      );

      // 2. Actor lacking branch scope throws 403 SCOPE_FORBIDDEN
      const restrictedBranchActor: ActorContext = {
        merchantId: 'm-tenant-1',
        userId: 'u-restricted-branch',
        role: 'WAREHOUSE',
        warehouseScopes: ['*'],
        storeScopes: ['branch-other'], // Does not have branch-hcm-01
      };
      await assert.rejects(
        async () => {
          await service.uploadAttachment(
            restrictedBranchActor,
            {
              file_name: 'claim_proof.png',
              mime_type: 'image/png',
              content_base64: validPngBuffer.toString('base64'),
              entity_type: 'CLAIM',
              entity_id: claimId,
            },
            validPngBuffer,
            '127.0.0.1',
            'corr-claim-forbidden'
          );
        },
        (err: any) => {
          assert.strictEqual(err.code, 'SCOPE_FORBIDDEN');
          assert.strictEqual(err.getStatus(), 403);
          return true;
        }
      );

      // 3. Successful upload derives both warehouse_id and branch_id
      const uploadRes = await service.uploadAttachment(
        ownerActor,
        {
          file_name: 'claim_proof.png',
          mime_type: 'image/png',
          content_base64: validPngBuffer.toString('base64'),
          entity_type: 'CLAIM',
          entity_id: claimId,
        },
        validPngBuffer,
        '127.0.0.1',
        'corr-claim-ok'
      );
      assert.strictEqual(uploadRes.warehouse_id, 'wh-hcm-01');
      assert.strictEqual(uploadRes.branch_id, 'branch-hcm-01');
    });

    it('Review Round 2 (Finding 9): DISCREPANCY derives branch_id; rejects conflicting and unauthorized branch', async () => {
      const { service, mockPrisma } = setupService();

      const discId = randomUUID();
      await mockPrisma.discrepancy.create({
        data: {
          id: discId,
          merchant_id: 'm-tenant-1',
          warehouse_id: 'wh-hcm-01',
          branch_id: 'branch-hcm-01',
          shipment_id: randomUUID(),
          tracking_code: 'TRK-DISC-01',
          type: 'COD_MISMATCH',
        },
      });

      // Conflicting branch
      await assert.rejects(
        async () => {
          await service.uploadAttachment(
            ownerActor,
            {
              file_name: 'disc_proof.png',
              mime_type: 'image/png',
              content_base64: validPngBuffer.toString('base64'),
              entity_type: 'DISCREPANCY',
              entity_id: discId,
              branch_id: 'branch-danang',
            },
            validPngBuffer,
            '127.0.0.1',
            'corr-disc-bad'
          );
        },
        (err: any) => {
          assert.strictEqual(err.code, 'VALIDATION_ERROR');
          assert.strictEqual(err.getStatus(), 400);
          const errMsg = (err.getResponse?.() as any)?.error?.message || '';
          assert.ok(errMsg.includes('Chi nhánh không khớp'));
          return true;
        }
      );
    });

    it('Review Round 2 (Finding 9): STATEMENT derives both warehouse and branch; validates caller scopes', async () => {
      const { service, mockPrisma } = setupService();

      const stmtId = randomUUID();
      await mockPrisma.carrierStatement.create({
        data: {
          id: stmtId,
          merchant_id: 'm-tenant-1',
          carrier_account_id: randomUUID(),
          period_start: new Date('2026-01-01'),
          period_end: new Date('2026-01-31'),
          checksum: 'sha-stmt-1',
          file_storage_key: 'statements/1.xlsx',
          warehouse_id: 'wh-hcm-01',
          branch_id: 'branch-hcm-01',
        },
      });

      // 1. Conflicting warehouse throws 400 VALIDATION_ERROR
      await assert.rejects(
        async () => {
          await service.uploadAttachment(
            ownerActor,
            {
              file_name: 'stmt_doc.png',
              mime_type: 'image/png',
              content_base64: validPngBuffer.toString('base64'),
              entity_type: 'STATEMENT',
              entity_id: stmtId,
              warehouse_id: 'wh-danang',
            },
            validPngBuffer,
            '127.0.0.1',
            'corr-stmt-wh-bad'
          );
        },
        (err: any) => {
          assert.strictEqual(err.code, 'VALIDATION_ERROR');
          assert.strictEqual(err.getStatus(), 400);
          const errMsg = (err.getResponse?.() as any)?.error?.message || '';
          assert.ok(errMsg.includes('Kho không khớp'));
          return true;
        }
      );

      // 2. Conflicting branch throws 400 VALIDATION_ERROR
      await assert.rejects(
        async () => {
          await service.uploadAttachment(
            ownerActor,
            {
              file_name: 'stmt_doc.png',
              mime_type: 'image/png',
              content_base64: validPngBuffer.toString('base64'),
              entity_type: 'STATEMENT',
              entity_id: stmtId,
              branch_id: 'branch-danang',
            },
            validPngBuffer,
            '127.0.0.1',
            'corr-stmt-br-bad'
          );
        },
        (err: any) => {
          assert.strictEqual(err.code, 'VALIDATION_ERROR');
          assert.strictEqual(err.getStatus(), 400);
          const errMsg = (err.getResponse?.() as any)?.error?.message || '';
          assert.ok(errMsg.includes('Chi nhánh không khớp'));
          return true;
        }
      );

      // 3. Unauthorized warehouse actor throws 403 SCOPE_FORBIDDEN
      const unauthWhActor: ActorContext = {
        merchantId: 'm-tenant-1',
        userId: 'u-unauth-wh',
        role: 'WAREHOUSE',
        warehouseScopes: ['wh-other'],
        storeScopes: ['*'],
      };
      await assert.rejects(
        async () => {
          await service.uploadAttachment(
            unauthWhActor,
            {
              file_name: 'stmt_doc.png',
              mime_type: 'image/png',
              content_base64: validPngBuffer.toString('base64'),
              entity_type: 'STATEMENT',
              entity_id: stmtId,
            },
            validPngBuffer,
            '127.0.0.1',
            'corr-stmt-wh-forbidden'
          );
        },
        (err: any) => {
          assert.strictEqual(err.code, 'SCOPE_FORBIDDEN');
          assert.strictEqual(err.getStatus(), 403);
          return true;
        }
      );

      // 4. Successful upload derives both
      const stmtUpload = await service.uploadAttachment(
        ownerActor,
        {
          file_name: 'stmt_doc.png',
          mime_type: 'image/png',
          content_base64: validPngBuffer.toString('base64'),
          entity_type: 'STATEMENT',
          entity_id: stmtId,
        },
        validPngBuffer,
        '127.0.0.1',
        'corr-stmt-derived'
      );
      assert.strictEqual(stmtUpload.warehouse_id, 'wh-hcm-01');
      assert.strictEqual(stmtUpload.branch_id, 'branch-hcm-01');
    });

    // ========================================================================
    // Review Round 2 (Finding 2): Cleanup ownership fencing — claim first, upload commit second, deletion third
    // ========================================================================
    it('Review Round 2 (Finding 2): claim first, upload commit second, deletion third fences uploader', async () => {
      const { service, mockPrisma, mockStorage, s3Storage } = setupService();

      // Step 1: An in-flight upload started, S3 object written, and orphan intent created
      const intentId = randomUUID();
      const storageKey = `merchants/m-tenant-1/attachments/${intentId}/stale_upload.png`;
      await mockStorage.putObject(storageKey, validPngBuffer, 'image/png');
      const staleDate = new Date(Date.now() - 1000 * 1000); // Exceeded grace period

      const orphanIntent = await mockPrisma.attachmentOrphanCleanup.create({
        data: {
          id: intentId,
          merchant_id: 'm-tenant-1',
          storage_key: storageKey,
          status: 'PENDING',
          attempts: 0,
          reason: 'upload_in_flight',
          created_at: staleDate,
          updated_at: staleDate,
        },
      });

      // Step 2 (CLAIM FIRST): Reconciler runs and atomically claims the stale PENDING intent
      const claim = await mockPrisma.attachmentOrphanCleanup.updateMany({
        where: {
          id: orphanIntent.id,
          merchant_id: 'm-tenant-1',
          status: 'PENDING',
        },
        data: { status: 'RECONCILING', attempts: 1 },
      });
      assert.strictEqual(claim.count, 1, 'Reconciler must successfully claim the stale upload');

      // Step 3 (UPLOAD COMMIT SECOND): The slow uploader tries to finalize inside its transaction
      // The conditional updateMany({ where: { status: 'PENDING' }, data: { status: 'DONE' } }) fails
      await assert.rejects(
        async () => {
          await mockPrisma.$transaction(async (tx: any) => {
            const finalized = await tx.attachmentOrphanCleanup.updateMany({
              where: { id: orphanIntent.id, status: 'PENDING' },
              data: { status: 'DONE' },
            });
            if (finalized.count === 0) {
              throw new CanonicalApiException(
                HttpStatus.CONFLICT,
                'UPLOAD_EXPIRED',
                'Upload session expired and was claimed for cleanup. Please retry upload.'
              );
            }
            // Attachment creation would happen here, but transaction aborts
            await tx.attachment.create({
              data: {
                id: intentId,
                merchant_id: 'm-tenant-1',
                file_name: 'stale_upload.png',
                file_size: BigInt(validPngBuffer.length),
                mime_type: 'image/png',
                checksum_sha256: 'xyz',
                storage_key: storageKey,
                storage_bucket: 'test-bucket',
                entity_type: 'GENERAL',
                status: 'ACTIVE',
                retention_days: 90,
                expires_at: new Date(Date.now() + 86400000),
              },
            });
          });
        },
        (err: any) => {
          assert.strictEqual(err.code, 'UPLOAD_EXPIRED');
          assert.strictEqual(err.getStatus(), 409);
          return true;
        }
      );

      // Verify no ACTIVE attachment row was committed
      const attRow = await mockPrisma.attachment.findFirst({ where: { id: intentId } });
      assert.strictEqual(attRow, null, 'Uploader transaction must have rolled back completely');

      // Step 4 (DELETION THIRD): Reconciler completes storage deletion and sets cleanup to DONE
      await mockStorage.deleteObject(storageKey);
      await mockPrisma.attachmentOrphanCleanup.updateMany({
        where: { id: orphanIntent.id, status: 'RECONCILING' },
        data: { status: 'DONE' },
      });

      assert.strictEqual(s3Storage.has(storageKey), false, 'S3 object must be deleted by reconciler');
      const finalIntent = await mockPrisma.attachmentOrphanCleanup.findFirst({ where: { id: intentId } });
      assert.strictEqual(finalIntent?.status, 'DONE');
    });

    // ========================================================================
    // Review Round 2 (Finding 8): Crashed reconciler recovery and restart coverage
    // ========================================================================
    it('Review Round 2 (Finding 8): crashed reconciler permanently stranded cleanup is recovered on restart', async () => {
      const { service, mockPrisma, mockStorage, s3Storage, auditLogs } = setupService();

      const crashedIntentId = randomUUID();
      const storageKey = `merchants/m-tenant-1/attachments/${crashedIntentId}/crashed_reconcile.png`;
      await mockStorage.putObject(storageKey, validPngBuffer, 'image/png');
      const expiredDate = new Date(Date.now() - 1000 * 1000); // 1000s ago (> 900s grace period)

      // Simulate a crashed reconciler: status is durably RECONCILING, but process died
      await mockPrisma.attachmentOrphanCleanup.create({
        data: {
          id: crashedIntentId,
          merchant_id: 'm-tenant-1',
          storage_key: storageKey,
          status: 'RECONCILING',
          attempts: 1,
          reason: 'upload_in_flight',
          created_at: expiredDate,
          updated_at: expiredDate,
        },
      });

      // An active RECONCILING claim from another live reconciler (within grace period)
      const activeIntentId = randomUUID();
      const activeKey = `merchants/m-tenant-1/attachments/${activeIntentId}/active_reconcile.png`;
      await mockStorage.putObject(activeKey, validPngBuffer, 'image/png');
      await mockPrisma.attachmentOrphanCleanup.create({
        data: {
          id: activeIntentId,
          merchant_id: 'm-tenant-1',
          storage_key: activeKey,
          status: 'RECONCILING',
          attempts: 1,
          reason: 'upload_in_flight',
          created_at: new Date(),
          updated_at: new Date(), // Fresh!
        },
      });

      // Reconciler restarts and runs
      const outcome = await service.reconcilePendingDeletions(ownerActor, 'corr-restart');
      assert.strictEqual(outcome.orphan_reconciled, 1, 'Must recover exactly the 1 expired crashed claim');

      // The crashed record is now DONE, and its S3 object is removed
      const recoveredRecord = await mockPrisma.attachmentOrphanCleanup.findFirst({ where: { id: crashedIntentId } });
      assert.strictEqual(recoveredRecord?.status, 'DONE');
      assert.strictEqual(s3Storage.has(storageKey), false, 'Orphan S3 object must be deleted');

      // Audit log was created
      const orphanAudit = auditLogs.find((a) => a.action === AttachmentAuditEvent.ATTACHMENT_ORPHAN_CLEANED && a.entity_id === crashedIntentId);
      assert.ok(orphanAudit);

      // The active fresh RECONCILING record was untouched
      const activeRecord = await mockPrisma.attachmentOrphanCleanup.findFirst({ where: { id: activeIntentId } });
      assert.strictEqual(activeRecord?.status, 'RECONCILING', 'Active lease within grace period must NOT be stolen');
      assert.strictEqual(s3Storage.has(activeKey), true, 'Active lease object must not be deleted');
    });

    // ========================================================================
    // Review Round 2 (Finding 5): Zero plaintext secrets in quarantine audit text
    // ========================================================================
    it('Review Round 2 (Finding 5): quarantine audit metadata omits arbitrary text and preserves zero plaintext secrets', async () => {
      const { service, mockPrisma, auditLogs } = setupService();

      const attId = randomUUID();
      await mockPrisma.attachment.create({
        data: {
          id: attId,
          merchant_id: 'm-tenant-1',
          file_name: 'suspicious.png',
          file_size: BigInt(300),
          mime_type: 'image/png',
          checksum_sha256: 'sha-suspicious',
          storage_key: `merchants/m-tenant-1/attachments/${attId}/suspicious.png`,
          storage_bucket: 'test-bucket',
          entity_type: 'GENERAL',
          status: 'ACTIVE',
          retention_days: 90,
          expires_at: new Date(Date.now() + 86400000),
          warehouse_id: 'wh-hcm-01',
          branch_id: 'branch-1',
          metadata: { scan_status: 'HEURISTIC_PASSED' },
        },
      });

      // Quarantine with reason containing raw passwords, API keys, and JWT tokens
      const hostileReason =
        'Security alert: password=MySecretPassword123! token=ghp_abcdef1234567890 api_key=sk-live-9876543210 credential=super_secret';
      await service.quarantineAttachment(ownerActor, attId, hostileReason, 'corr-hostile-q');

      const qAudit = auditLogs.find(
        (a) => a.action === AttachmentAuditEvent.ATTACHMENT_QUARANTINED && a.entity_id === attId
      );
      assert.ok(qAudit);

      const auditStr = JSON.stringify(qAudit);
      assert.strictEqual(auditStr.includes('MySecretPassword123!'), false, 'Password must not appear in audit log');
      assert.strictEqual(auditStr.includes('ghp_abcdef1234567890'), false, 'Token must not appear in audit log');
      assert.strictEqual(auditStr.includes('sk-live-9876543210'), false, 'API key must not appear in audit log');
      assert.strictEqual(auditStr.includes('super_secret'), false, 'Credential must not appear in audit log');

      // The new_value contains only allowlisted reason_code, no arbitrary reason property
      const newVal = qAudit.new_value;
      assert.strictEqual(newVal.status, 'QUARANTINED');
      assert.strictEqual(newVal.reason, undefined);
      assert.strictEqual(newVal.reason_code, 'MANUAL_SECURITY_REVIEW');

      // When caller supplies an allowlisted reason code, it is preserved as reason_code
      const attId2 = randomUUID();
      await mockPrisma.attachment.create({
        data: {
          id: attId2,
          merchant_id: 'm-tenant-1',
          file_name: 'malware.png',
          file_size: BigInt(300),
          mime_type: 'image/png',
          checksum_sha256: 'sha-malware',
          storage_key: `merchants/m-tenant-1/attachments/${attId2}/malware.png`,
          storage_bucket: 'test-bucket',
          entity_type: 'GENERAL',
          status: 'ACTIVE',
          retention_days: 90,
          expires_at: new Date(Date.now() + 86400000),
          warehouse_id: 'wh-hcm-01',
          branch_id: 'branch-1',
        },
      });
      await service.quarantineAttachment(ownerActor, attId2, 'MALWARE_SUSPECTED', 'corr-malware-q');
      const qAudit2 = auditLogs.find(
        (a) => a.action === AttachmentAuditEvent.ATTACHMENT_QUARANTINED && a.entity_id === attId2
      );
      assert.ok(qAudit2);
      assert.strictEqual(qAudit2.new_value.reason_code, 'MALWARE_SUSPECTED');
    });
  });
});
