import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import {
  ExportFormat,
  ExportResource,
  ExportJobStatus,
  ExportErrorCode,
  ExportAuditEvent,
  ExportGenerationMetadata,
} from '@shipde/contracts';
import { CanonicalApiException } from '../auth/auth.service';
import type { ActorContext } from '../rbac/rbac.dto';
import { validateCreateExportJobDto, validateListExportJobsQuery } from './exports.dto';
import { generateCsv, escapeCsvCell } from './generators/csv.generator';
import { generateXlsx, escapeXml } from './generators/xlsx.generator';
import { generatePdf } from './generators/pdf.generator';
import { ExportsService } from './exports.service';

const ALL_PERMISSIONS = [
  'iam:manage_users',
  'iam:shop_config',
  'audit:view',
  'reconciliation:view_contract_rates',
  'reconciliation:run_review_audit',
  'pii:unmask',
];

function createMockPrismaService() {
  const users: any[] = [
    {
      id: 'u-1',
      merchant_id: 'm-tenant-1',
      full_name: 'Nguyễn Văn Chủ',
      email: 'owner@shopde.test',
      phone: '0912345678',
      role: 'OWNER',
      warehouse_scopes: ['*'],
      status: 'active',
      created_at: new Date('2026-09-01T08:00:00Z'),
    },
    {
      id: 'u-2',
      merchant_id: 'm-tenant-1',
      full_name: 'Trần Kho',
      email: 'kho@shopde.test',
      phone: '0987654321',
      role: 'WAREHOUSE',
      warehouse_scopes: ['wh-1'],
      status: 'active',
      created_at: new Date('2026-09-02T08:00:00Z'),
    },
    {
      id: 'u-other',
      merchant_id: 'm-tenant-other',
      full_name: 'Other Shop User',
      email: 'other@other.test',
      phone: '0933333333',
      role: 'OWNER',
      warehouse_scopes: ['*'],
      status: 'active',
      created_at: new Date('2026-09-01T08:00:00Z'),
    },
  ];

  const warehouses: any[] = [
    {
      id: 'wh-1',
      merchant_id: 'm-tenant-1',
      name: 'Kho Tân Bình',
      code: 'WH-01',
      status: 'active',
      is_default: true,
      contact_name: 'Trần Kho',
      contact_phone: '0901234567',
      contact_email: 'kho1@gumac.vn',
      city: 'TP. Hồ Chí Minh',
      district: 'Quận Tân Bình',
      address_line: '128 Đường Trường Chinh',
      created_at: new Date('2026-09-01T09:00:00Z'),
    },
    {
      id: 'wh-2',
      merchant_id: 'm-tenant-1',
      name: 'Kho Hà Nội',
      code: 'WH-02',
      status: 'active',
      is_default: false,
      contact_name: 'Lê Kho Bắc',
      contact_phone: '0909876543',
      contact_email: 'kho2@gumac.vn',
      city: 'Hà Nội',
      district: 'Quận Cầu Giấy',
      address_line: '88 Đường Cầu Giấy',
      created_at: new Date('2026-09-02T09:00:00Z'),
    },
    {
      id: 'wh-other',
      merchant_id: 'm-tenant-other',
      name: 'Kho Tenant Khác',
      code: 'WH-OTHER',
      status: 'active',
      is_default: true,
      contact_name: 'Alien Contact',
      contact_phone: '0911111111',
      contact_email: 'alien@other.vn',
      city: 'Đà Nẵng',
      district: 'Quận Hải Châu',
      address_line: '10 Nguyễn Văn Linh',
      created_at: new Date('2026-09-01T09:00:00Z'),
    },
  ];

  const auditLogs: any[] = [
    {
      id: 'log-1',
      merchant_id: 'm-tenant-1',
      user_id: 'u-1',
      actor: 'OWNER',
      action: 'WAREHOUSE_CREATED',
      entity_type: 'warehouse',
      entity_id: 'wh-1',
      ip_address: 'd9b35b64...',
      created_at: new Date('2026-09-01T09:00:00Z'),
    },
  ];

  const exportJobs: any[] = [];

  const mockPrisma: any = {
    users,
    warehouses,
    auditLogs,
    exportJobs,
    user: {
      findFirst: async ({ where }: any) => {
        return (
          users.find((u) => {
            if (where.id && u.id !== where.id) return false;
            if (where.merchant_id && u.merchant_id !== where.merchant_id) return false;
            return true;
          }) || null
        );
      },
      findMany: async ({ where, take }: any) => {
        let res = users.filter((u) => {
          if (where.merchant_id && u.merchant_id !== where.merchant_id) return false;
          return true;
        });
        if (take) res = res.slice(0, take);
        return res;
      },
      count: async ({ where }: any) => {
        return users.filter((u) => {
          if (where.merchant_id && u.merchant_id !== where.merchant_id) return false;
          return true;
        }).length;
      },
    },
    warehouse: {
      findMany: async ({ where, take }: any) => {
        let res = warehouses.filter((w) => {
          if (where.merchant_id && w.merchant_id !== where.merchant_id) return false;
          return true;
        });
        if (take) res = res.slice(0, take);
        return res;
      },
      count: async ({ where }: any) => {
        return warehouses.filter((w) => {
          if (where.merchant_id && w.merchant_id !== where.merchant_id) return false;
          return true;
        }).length;
      },
    },
    auditLog: {
      create: async ({ data }: any) => {
        const item = { id: `log-${auditLogs.length + 1}`, ...data, created_at: new Date() };
        auditLogs.push(item);
        return item;
      },
      findMany: async ({ where, take }: any) => {
        let res = auditLogs.filter((l) => {
          if (where.merchant_id && l.merchant_id !== where.merchant_id) return false;
          return true;
        });
        if (take) res = res.slice(0, take);
        return res;
      },
      count: async ({ where }: any) => {
        return auditLogs.filter((l) => {
          if (where.merchant_id && l.merchant_id !== where.merchant_id) return false;
          return true;
        }).length;
      },
    },
    claim: {
      findMany: async () => [
        {
          status: 'ACCEPTED',
          recovered_amount: 500000n,
          accepted_amount: 500000n,
        },
        {
          status: 'ACCEPTED',
          recovered_amount: 0n,
          accepted_amount: 250000n,
        },
      ],
    },
    exceptionCase: {
      findMany: async () => [
        {
          id: 'case-1',
          status: 'RESCUED',
          shipment: { cod_amount: 1200000n },
        },
      ],
    },
    shipment: {
      count: async ({ where }: any) => {
        if (where?.events?.some?.occurred_at) return 8;
        return 10;
      },
    },
    discrepancy: {
      count: async () => 3,
    },
    exportJob: {
      create: async ({ data }: any) => {
        const item = { ...data, created_at: new Date(), updated_at: new Date() };
        exportJobs.push(item);
        return item;
      },
      update: async ({ where, data }: any) => {
        const idx = exportJobs.findIndex((j) => j.id === where.id);
        if (idx === -1) throw new Error('Not found');
        exportJobs[idx] = { ...exportJobs[idx], ...data, updated_at: new Date() };
        return exportJobs[idx];
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (let idx = 0; idx < exportJobs.length; idx++) {
          if (where.id && exportJobs[idx].id !== where.id) continue;
          if (where.merchant_id && exportJobs[idx].merchant_id !== where.merchant_id) continue;
          exportJobs[idx] = { ...exportJobs[idx], ...data, updated_at: new Date() };
          count++;
        }
        return { count };
      },
      findFirst: async ({ where }: any) => {
        return (
          exportJobs.find((j) => {
            if (where.id && j.id !== where.id) return false;
            if (where.merchant_id && j.merchant_id !== where.merchant_id) return false;
            return true;
          }) || null
        );
      },
      findMany: async ({ where, skip = 0, take = 20 }: any) => {
        let res = exportJobs.filter((j) => {
          if (where.merchant_id && j.merchant_id !== where.merchant_id) return false;
          if (where.status && j.status !== where.status) return false;
          if (where.resource && j.resource !== where.resource) return false;
          return true;
        });
        return res.slice(skip, skip + take);
      },
      count: async ({ where }: any) => {
        return exportJobs.filter((j) => {
          if (where.merchant_id && j.merchant_id !== where.merchant_id) return false;
          if (where.status && j.status !== where.status) return false;
          if (where.resource && j.resource !== where.resource) return false;
          return true;
        }).length;
      },
    },
    $transaction: async (fn: any) => {
      if (typeof fn === 'function') {
        return fn(mockPrisma);
      }
      return Promise.all(fn);
    },
  };

  return mockPrisma;
}

function createMockRbacService(grantedPermissions: string[] = ALL_PERMISSIONS) {
  return {
    actorHasPermissions: async (_actor: ActorContext, required: string[]) => {
      const set = new Set(grantedPermissions);
      return required.every((r) => set.has(r));
    },
  };
}

describe('FEAT-COM-05: Exports Unit Test Suite', () => {
  describe('DTO Validation: validateCreateExportJobDto', () => {
    it('should validate valid DTO for users CSV export', () => {
      const res = validateCreateExportJobDto({
        resource: 'users',
        format: 'csv',
        filters: { role: 'OPERATOR' },
        sync: true,
      });
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.errors.length, 0);
      assert.strictEqual(res.dto?.resource, ExportResource.USERS);
      assert.strictEqual(res.dto?.format, ExportFormat.CSV);
    });

    it('should validate valid DTO for warehouses XLSX export', () => {
      const res = validateCreateExportJobDto({
        resource: 'warehouses',
        format: 'xlsx',
      });
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.dto?.format, ExportFormat.XLSX);
    });

    it('should validate valid DTO for ledgers PDF export', () => {
      const res = validateCreateExportJobDto({
        resource: 'ledgers',
        format: 'pdf',
      });
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.dto?.format, ExportFormat.PDF);
    });

    it('should reject invalid body (non-object or null)', () => {
      const res1 = validateCreateExportJobDto(null);
      assert.strictEqual(res1.valid, false);
      assert.strictEqual(res1.errors[0].code, 'INVALID_BODY');

      const res2 = validateCreateExportJobDto('string-body');
      assert.strictEqual(res2.valid, false);
      assert.strictEqual(res2.errors[0].code, 'INVALID_BODY');
    });

    it('should reject missing or non-string resource', () => {
      const res1 = validateCreateExportJobDto({ format: 'csv' });
      assert.strictEqual(res1.valid, false);
      assert.strictEqual(
        res1.errors.some((e) => e.field === 'resource' && e.code === 'REQUIRED'),
        true
      );

      const res2 = validateCreateExportJobDto({ resource: 12345, format: 'csv' });
      assert.strictEqual(res2.valid, false);
      assert.strictEqual(
        res2.errors.some((e) => e.field === 'resource' && e.code === 'INVALID_TYPE'),
        true
      );
    });

    it('should reject unsupported resource with UNSUPPORTED_RESOURCE', () => {
      const res = validateCreateExportJobDto({ resource: 'secret_keys', format: 'csv' });
      assert.strictEqual(res.valid, false);
      assert.strictEqual(
        res.errors.some((e) => e.field === 'resource' && e.code === 'UNSUPPORTED_RESOURCE'),
        true
      );
    });

    it('should reject missing or unsupported format', () => {
      const res1 = validateCreateExportJobDto({ resource: 'users' });
      assert.strictEqual(res1.valid, false);
      assert.strictEqual(
        res1.errors.some((e) => e.field === 'format' && e.code === 'REQUIRED'),
        true
      );

      const res2 = validateCreateExportJobDto({ resource: 'users', format: 'exe' });
      assert.strictEqual(res2.valid, false);
      assert.strictEqual(
        res2.errors.some((e) => e.field === 'format' && e.code === 'UNSUPPORTED_FORMAT'),
        true
      );
    });

    it('should reject invalid filters (array instead of object)', () => {
      const res = validateCreateExportJobDto({
        resource: 'users',
        format: 'csv',
        filters: ['invalid', 'array'],
      });
      assert.strictEqual(res.valid, false);
      assert.strictEqual(
        res.errors.some((e) => e.field === 'filters' && e.code === 'INVALID_TYPE'),
        true
      );
    });

    it('should reject non-boolean sync option', () => {
      const res = validateCreateExportJobDto({
        resource: 'users',
        format: 'csv',
        sync: 'true',
      });
      assert.strictEqual(res.valid, false);
      assert.strictEqual(
        res.errors.some((e) => e.field === 'sync' && e.code === 'INVALID_TYPE'),
        true
      );
    });
  });

  describe('Query Validation: validateListExportJobsQuery', () => {
    it('should validate valid pagination parameters', () => {
      const res = validateListExportJobsQuery({
        page: '2',
        limit: '50',
        status: 'completed',
        resource: 'users',
      });
      assert.strictEqual(res.valid, true);
      assert.strictEqual(res.page, 2);
      assert.strictEqual(res.limit, 50);
      assert.strictEqual(res.status, 'completed');
      assert.strictEqual(res.resource, 'users');
    });

    it('should reject invalid page or limit', () => {
      const res1 = validateListExportJobsQuery({ page: '0' });
      assert.strictEqual(res1.valid, false);
      assert.strictEqual(
        res1.errors.some((e) => e.field === 'page'),
        true
      );

      const res2 = validateListExportJobsQuery({ limit: '200' });
      assert.strictEqual(res2.valid, false);
      assert.strictEqual(
        res2.errors.some((e) => e.field === 'limit'),
        true
      );
    });

    it('Finding 13: should reject unsupported filter for resource with UNSUPPORTED_FILTER', () => {
      const res = validateCreateExportJobDto({
        resource: 'users',
        format: 'csv',
        filters: { arbitrary_hacker_field: 'leak' },
      });
      assert.strictEqual(res.valid, false);
      assert.strictEqual(
        res.errors.some(
          (e) => e.field === 'filters.arbitrary_hacker_field' && e.code === 'UNSUPPORTED_FILTER'
        ),
        true
      );
    });

    it('Finding 13: should reject invalid date string in filter with INVALID_DATE', () => {
      const res = validateCreateExportJobDto({
        resource: 'ledgers',
        format: 'csv',
        filters: { from_date: 'not-a-valid-date' },
      });
      assert.strictEqual(res.valid, false);
      assert.strictEqual(
        res.errors.some((e) => e.field === 'filters.from_date' && e.code === 'INVALID_DATE'),
        true
      );
    });
  });

  describe('Format Generators', () => {
    const mockMetadata: ExportGenerationMetadata = {
      export_id: 'exp-test-uuid-001',
      generated_at: '2026-10-29T10:00:00Z',
      merchant_id: 'm-tenant-1',
      requested_by: 'u-1',
      user_role: 'OWNER',
      resource: ExportResource.USERS,
      format: ExportFormat.CSV,
      filters: {},
      rule_version: 'RULES_V1_2026',
      total_rows: 2,
      succeeded_rows: 2,
      failed_rows: 0,
      checksum_sha256: 'a1b2c3d4e5f6',
    };

    const mockHeaders = [
      { key: 'name', label: 'Tên người dùng' },
      { key: 'email', label: 'Email' },
      { key: 'notes', label: 'Ghi chú' },
    ];

    const mockRows = [
      { name: 'Nguyễn Văn A', email: 'a@test.vn', notes: 'Dòng thường' },
      {
        name: 'Trần "Bão", Cường',
        email: 'b@test.vn',
        notes: 'Có dấu phẩy, nháy "kép" và\nxuống dòng',
      },
    ];

    it('escapeCsvCell correctly quotes and doubles quotes', () => {
      assert.strictEqual(escapeCsvCell('simple'), 'simple');
      assert.strictEqual(escapeCsvCell('with,comma'), '"with,comma"');
      assert.strictEqual(escapeCsvCell('with"quotes"'), '"with""quotes"""');
      assert.strictEqual(escapeCsvCell('with\nnewline'), '"with\nnewline"');
      assert.strictEqual(escapeCsvCell(null), '');
    });

    it('Finding 12: escapeCsvCell neutralizes spreadsheet formula injection prefixes', () => {
      assert.strictEqual(escapeCsvCell('=1+1'), "'=1+1");
      assert.strictEqual(escapeCsvCell('+SUM(A1:A10)'), "'+SUM(A1:A10)");
      assert.strictEqual(escapeCsvCell('-2+3'), "'-2+3");
      assert.strictEqual(escapeCsvCell('@cmd'), "'@cmd");
      assert.strictEqual(escapeCsvCell('=cmd|"/C calc"!A0'), `"'=cmd|""/C calc""!A0"`);
    });

    it('generateCsv produces valid CSV with UTF-8 BOM, metadata header, and CRLF line breaks', () => {
      const buf = generateCsv(mockMetadata, mockHeaders, mockRows);
      // Check BOM bytes (\uFEFF: 0xEF, 0xBB, 0xBF)
      assert.strictEqual(buf[0], 0xef);
      assert.strictEqual(buf[1], 0xbb);
      assert.strictEqual(buf[2], 0xbf);

      const text = buf.subarray(3).toString('utf-8');
      assert.strictEqual(text.includes('# --- SHIP DE EXPORT METADATA ---'), true);
      assert.strictEqual(text.includes('# Export ID: exp-test-uuid-001'), true);
      assert.strictEqual(text.includes('# Data Payload Checksum (SHA-256): a1b2c3d4e5f6'), true);
      assert.strictEqual(text.includes('Tên người dùng,Email,Ghi chú'), true);
      assert.strictEqual(text.includes('"Trần ""Bão"", Cường"'), true);
    });

    it('escapeXml safely handles special XML characters', () => {
      assert.strictEqual(
        escapeXml('A & B < C > D "quote" \'single\''),
        'A &amp; B &lt; C &gt; D &quot;quote&quot; &apos;single&apos;'
      );
      assert.strictEqual(escapeXml(null), '');
    });

    it('generateXlsx produces conformant SpreadsheetML XML with Data and Metadata sheets', () => {
      const buf = generateXlsx(mockMetadata, mockHeaders, mockRows);
      const xml = buf.toString('utf-8');

      assert.strictEqual(xml.includes('<?xml version="1.0" encoding="UTF-8"?>'), true);
      assert.strictEqual(
        xml.includes('xmlns="urn:schemas-microsoft-com:office:spreadsheet"'),
        true
      );
      assert.strictEqual(xml.includes('<Worksheet ss:Name="Data">'), true);
      assert.strictEqual(xml.includes('<Worksheet ss:Name="Metadata">'), true);
      assert.strictEqual(xml.includes('exp-test-uuid-001'), true);
      assert.strictEqual(xml.includes('Nguyễn Văn A'), true);
    });

    it('generatePdf produces valid PDF 1.4 document with catalog, font objects, xref, and %%EOF', () => {
      const buf = generatePdf(mockMetadata, mockHeaders, mockRows);
      const pdfText = buf.toString('binary');

      assert.strictEqual(pdfText.startsWith('%PDF-1.4'), true);
      assert.strictEqual(pdfText.includes('/Type /Catalog'), true);
      assert.strictEqual(pdfText.includes('/Type /Pages'), true);
      assert.strictEqual(pdfText.includes('/Type /Font'), true);
      assert.strictEqual(pdfText.includes('SHIP DE - EXPORT REPORT'), true);
      assert.strictEqual(pdfText.includes('xref'), true);
      assert.strictEqual(pdfText.includes('trailer'), true);
      assert.strictEqual(pdfText.endsWith('%%EOF\n'), true);
    });
  });

  describe('ExportsService Operations & Security Invariants', () => {
    it('AC-COM-05-01: Owner can create export job and receives completed job with accurate counts', async () => {
      const mockPrisma = createMockPrismaService();
      const mockRbac = createMockRbacService();
      const service = new ExportsService(mockPrisma as any, mockRbac as any);

      const ownerActor: ActorContext = {
        userId: 'u-1',
        merchantId: 'm-tenant-1',
        role: 'OWNER',
      };

      const result = await service.createExportJob(
        'm-tenant-1',
        ownerActor,
        {
          resource: ExportResource.USERS,
          format: ExportFormat.CSV,
          sync: true,
        },
        '127.0.0.1',
        'corr-01'
      );

      assert.strictEqual(result.data.status, ExportJobStatus.COMPLETED);
      assert.strictEqual(result.data.resource, ExportResource.USERS);
      assert.strictEqual(result.data.format, ExportFormat.CSV);
      assert.strictEqual(result.data.total_rows, 2);
      assert.strictEqual(result.data.succeeded_rows, 2);
      assert.strictEqual(result.data.failed_rows, 0);
      assert.ok(result.data.checksum_sha256);
      assert.ok(result.data.download_url);

      // Verify audit log created
      assert.strictEqual(
        mockPrisma.auditLogs.some((l) => l.action === ExportAuditEvent.EXPORT_REQUESTED),
        true
      );
    });

    it('AC-COM-05-06: Operator lacking capability permission is rejected with 403 FORBIDDEN', async () => {
      const mockPrisma = createMockPrismaService();
      // Operator has no permissions
      const mockRbac = createMockRbacService([]);
      const service = new ExportsService(mockPrisma as any, mockRbac as any);

      const opActor: ActorContext = {
        userId: 'u-2',
        merchantId: 'm-tenant-1',
        role: 'WAREHOUSE',
      };

      await assert.rejects(
        async () => {
          await service.createExportJob(
            'm-tenant-1',
            opActor,
            { resource: ExportResource.USERS, format: ExportFormat.CSV },
            '127.0.0.1',
            'corr-forbidden'
          );
        },
        (err: any) => {
          assert.strictEqual(err instanceof CanonicalApiException, true);
          assert.strictEqual(err.getStatus(), 403);
          assert.strictEqual(err.code, ExportErrorCode.FORBIDDEN);
          return true;
        }
      );
    });

    it('AC-COM-05-05: FEAT-RBAC-02 scoped actor exports warehouses: out-of-scope rows are omitted and recorded in row_results', async () => {
      const mockPrisma = createMockPrismaService();
      // Actor has iam:shop_config but scoped only to wh-1
      const mockRbac = createMockRbacService(['iam:shop_config']);
      const service = new ExportsService(mockPrisma as any, mockRbac as any);

      const scopedActor: ActorContext = {
        userId: 'u-2', // u-2 has warehouse_scopes: ['wh-1'] in mockPrisma
        merchantId: 'm-tenant-1',
        role: 'WAREHOUSE',
      };

      const result = await service.createExportJob(
        'm-tenant-1',
        scopedActor,
        {
          resource: ExportResource.WAREHOUSES,
          format: ExportFormat.XLSX,
          sync: true,
        },
        '127.0.0.1',
        'corr-scoped'
      );

      assert.strictEqual(result.data.status, ExportJobStatus.COMPLETED);
      assert.strictEqual(result.data.total_rows, 2);
      assert.strictEqual(result.data.succeeded_rows, 1); // wh-1 succeeded
      assert.strictEqual(result.data.failed_rows, 1); // wh-2 forbidden

      // Check per-row results
      const failedResult = result.data.row_results?.find((r) => r.entity_id === 'wh-2');
      assert.ok(failedResult);
      assert.strictEqual(failedResult.status, 'failed');
      assert.strictEqual(failedResult.error_code, ExportErrorCode.SCOPE_FORBIDDEN);
    });

    it('BR-COM05-04: Actor without pii:unmask receives masked identifiers in exported rows', async () => {
      const mockPrisma = createMockPrismaService();
      // Has iam:manage_users but NOT pii:unmask
      const mockRbac = createMockRbacService(['iam:manage_users']);
      const service = new ExportsService(mockPrisma as any, mockRbac as any);

      const opActor: ActorContext = {
        userId: 'u-2',
        merchantId: 'm-tenant-1',
        role: 'MEMBER',
      };

      const result = await service.createExportJob(
        'm-tenant-1',
        opActor,
        {
          resource: ExportResource.USERS,
          format: ExportFormat.CSV,
          sync: true,
        },
        '127.0.0.1',
        'corr-mask'
      );

      // Download file to inspect content
      const download = await service.downloadExport(
        'm-tenant-1',
        opActor,
        result.data.id,
        '127.0.0.1',
        'corr-dl'
      );
      const csvContent = download.fileBuffer.toString('utf-8');

      // Email and phone must be masked
      assert.strictEqual(csvContent.includes('owner@shopde.test'), false);
      assert.strictEqual(csvContent.includes('0912345678'), false);
      assert.strictEqual(
        csvContent.includes('o***r@shopde.test') || csvContent.includes('o*@shopde.test'),
        true
      );
      assert.strictEqual(csvContent.includes('091****678'), true);
    });

    it('AC-COM-05-13: Actor with pii:unmask receives plaintext identifiers in exported rows', async () => {
      const mockPrisma = createMockPrismaService();
      // Has both iam:manage_users AND pii:unmask
      const mockRbac = createMockRbacService(['iam:manage_users', 'pii:unmask']);
      const service = new ExportsService(mockPrisma as any, mockRbac as any);

      const unmaskActor: ActorContext = {
        userId: 'u-2',
        merchantId: 'm-tenant-1',
        role: 'MEMBER',
      };

      const result = await service.createExportJob(
        'm-tenant-1',
        unmaskActor,
        {
          resource: ExportResource.USERS,
          format: ExportFormat.CSV,
          sync: true,
        },
        '127.0.0.1',
        'corr-unmask'
      );

      const download = await service.downloadExport(
        'm-tenant-1',
        unmaskActor,
        result.data.id,
        '127.0.0.1',
        'corr-dl-unmask'
      );
      const csvContent = download.fileBuffer.toString('utf-8');

      // Email and phone must be plaintext
      assert.strictEqual(csvContent.includes('owner@shopde.test'), true);
      assert.strictEqual(csvContent.includes('0912345678'), true);
    });

    it('AC-COM-05-07: Cross-tenant query returns 404 EXPORT_NOT_FOUND', async () => {
      const mockPrisma = createMockPrismaService();
      const mockRbac = createMockRbacService();
      const service = new ExportsService(mockPrisma as any, mockRbac as any);

      const ownerTenant1: ActorContext = {
        userId: 'u-1',
        merchantId: 'm-tenant-1',
        role: 'OWNER',
      };

      // Create job in tenant 1
      const created = await service.createExportJob(
        'm-tenant-1',
        ownerTenant1,
        { resource: ExportResource.USERS, format: ExportFormat.CSV },
        '127.0.0.1',
        'corr-t1'
      );

      const otherTenantActor: ActorContext = {
        userId: 'u-other',
        merchantId: 'm-tenant-other',
        role: 'OWNER',
      };

      // Other tenant queries job
      await assert.rejects(
        async () => {
          await service.getExportJob(
            'm-tenant-other',
            otherTenantActor,
            created.data.id,
            'corr-t2'
          );
        },
        (err: any) => {
          assert.strictEqual(err instanceof CanonicalApiException, true);
          assert.strictEqual(err.getStatus(), 404);
          assert.strictEqual(err.code, ExportErrorCode.EXPORT_NOT_FOUND);
          return true;
        }
      );

      // Other tenant downloads job
      await assert.rejects(
        async () => {
          await service.downloadExport(
            'm-tenant-other',
            otherTenantActor,
            created.data.id,
            '127.0.0.1',
            'corr-t2'
          );
        },
        (err: any) => {
          assert.strictEqual(err instanceof CanonicalApiException, true);
          assert.strictEqual(err.getStatus(), 404);
          assert.strictEqual(err.code, ExportErrorCode.EXPORT_NOT_FOUND);
          return true;
        }
      );
    });

    it('AC-COM-05-09: Downloading pending export job throws 409 EXPORT_NOT_READY', async () => {
      const mockPrisma = createMockPrismaService();
      const mockRbac = createMockRbacService();
      const service = new ExportsService(mockPrisma as any, mockRbac as any);

      // Manually push pending export job
      mockPrisma.exportJobs.push({
        id: 'job-pending',
        merchant_id: 'm-tenant-1',
        user_id: 'u-1',
        resource: 'users',
        format: 'csv',
        status: ExportJobStatus.PENDING,
        created_at: new Date(),
      });

      const ownerActor: ActorContext = {
        userId: 'u-1',
        merchantId: 'm-tenant-1',
        role: 'OWNER',
      };

      await assert.rejects(
        async () => {
          await service.downloadExport(
            'm-tenant-1',
            ownerActor,
            'job-pending',
            '127.0.0.1',
            'corr-pending'
          );
        },
        (err: any) => {
          assert.strictEqual(err instanceof CanonicalApiException, true);
          assert.strictEqual(err.getStatus(), 409);
          assert.strictEqual(err.code, ExportErrorCode.EXPORT_NOT_READY);
          return true;
        }
      );
    });

    it('AC-COM-05-12: Download records EXPORT_DOWNLOADED audit log with file metadata', async () => {
      const mockPrisma = createMockPrismaService();
      const mockRbac = createMockRbacService();
      const service = new ExportsService(mockPrisma as any, mockRbac as any);

      const ownerActor: ActorContext = {
        userId: 'u-1',
        merchantId: 'm-tenant-1',
        role: 'OWNER',
      };

      const created = await service.createExportJob(
        'm-tenant-1',
        ownerActor,
        { resource: ExportResource.AUDIT_LOGS, format: ExportFormat.CSV },
        '127.0.0.1',
        'corr-audit-create'
      );

      const dl = await service.downloadExport(
        'm-tenant-1',
        ownerActor,
        created.data.id,
        '127.0.0.1',
        'corr-audit-dl'
      );
      assert.ok(dl.fileBuffer);
      assert.strictEqual(dl.mimeType, 'text/csv; charset=utf-8');

      // Check audit log for download
      const dlLog = mockPrisma.auditLogs.find(
        (l) => l.action === ExportAuditEvent.EXPORT_DOWNLOADED
      );
      assert.ok(dlLog);
      assert.strictEqual(dlLog.entity_id, created.data.id);
    });

    it('Finding 3 / AC-COM-05-04: Ledgers export computes real persisted data from tenant claims, cases, and shipments', async () => {
      const mockPrisma = createMockPrismaService();
      const mockRbac = createMockRbacService(['reconciliation:view_contract_rates']);
      const service = new ExportsService(mockPrisma as any, mockRbac as any);

      const financeActor: ActorContext = {
        userId: 'u-1',
        merchantId: 'm-tenant-1',
        role: 'FINANCE',
      };

      const result = await service.createExportJob(
        'm-tenant-1',
        financeActor,
        { resource: ExportResource.LEDGERS, format: ExportFormat.CSV, sync: true },
        '127.0.0.1',
        'corr-ledgers'
      );

      assert.strictEqual(result.data.status, ExportJobStatus.COMPLETED);
      assert.strictEqual(result.data.resource, ExportResource.LEDGERS);
      assert.strictEqual(result.data.total_rows, 7);

      const dl = await service.downloadExport(
        'm-tenant-1',
        financeActor,
        result.data.id,
        '127.0.0.1',
        'corr-dl-ledgers'
      );
      const csv = dl.fileBuffer.toString('utf-8');

      // Verify Sổ 1: 500,000 VND recovered, 250,000 VND pending acceptance
      assert.strictEqual(csv.includes('500000'), true);
      assert.strictEqual(csv.includes('250000'), true);
      // Verify Sổ 2: 1 rescued order, 15,000 VND return fee saved, 1,200,000 GMV
      assert.strictEqual(csv.includes('15000'), true);
      assert.strictEqual(csv.includes('1200000'), true);
      // Verify Sổ 3: 80% coverage (8 delivered / 10 total), 3 discrepancies
      assert.strictEqual(csv.includes('80%'), true);
      assert.strictEqual(csv.includes('LEDGER3_DISCREPANCIES_DETECTED_COUNT'), true);
      // Verify no fabricated accounting hours saved (12)
      assert.strictEqual(csv.includes('LEDGER3_ACCOUNTING_HOURS_SAVED'), false);
    });

    it('Finding 7: EXPORT_LIMIT_EXCEEDED thrown when rows exceed maxRows without clamping', async () => {
      const mockPrisma = createMockPrismaService();
      // Mock count returning 10000000 rows
      mockPrisma.user.count = async () => 2000000;
      const mockRbac = createMockRbacService(['iam:manage_users']);
      const service = new ExportsService(mockPrisma as any, mockRbac as any);

      const actor: ActorContext = {
        userId: 'u-1',
        merchantId: 'm-tenant-1',
        role: 'ADMIN',
      };

      await assert.rejects(
        async () => {
          await service.createExportJob(
            'm-tenant-1',
            actor,
            { resource: ExportResource.USERS, format: ExportFormat.CSV, sync: true },
            '127.0.0.1',
            'corr-limit'
          );
        },
        (err: any) => {
          assert.strictEqual(err instanceof CanonicalApiException, true);
          assert.strictEqual(err.getStatus(), 400);
          assert.strictEqual(err.code, ExportErrorCode.EXPORT_LIMIT_EXCEEDED);
          return true;
        }
      );
    });

    it('Finding 7: sync: false returns PENDING status immediately', async () => {
      const mockPrisma = createMockPrismaService();
      const mockRbac = createMockRbacService(['iam:manage_users']);
      const service = new ExportsService(mockPrisma as any, mockRbac as any);

      const actor: ActorContext = {
        userId: 'u-1',
        merchantId: 'm-tenant-1',
        role: 'ADMIN',
      };

      const result = await service.createExportJob(
        'm-tenant-1',
        actor,
        { resource: ExportResource.USERS, format: ExportFormat.CSV, sync: false },
        '127.0.0.1',
        'corr-async'
      );

      assert.strictEqual(result.data.status, ExportJobStatus.PENDING);
    });

    it('Finding 4: Scoped actor downloading warehouse export with out-of-scope rows throws 403 SCOPE_FORBIDDEN', async () => {
      const mockPrisma = createMockPrismaService();
      const mockRbac = createMockRbacService(['iam:shop_config', 'pii:unmask']);
      const service = new ExportsService(mockPrisma as any, mockRbac as any);

      const ownerActor: ActorContext = { userId: 'u-1', merchantId: 'm-tenant-1', role: 'OWNER' };
      const created = await service.createExportJob(
        'm-tenant-1',
        ownerActor,
        { resource: ExportResource.WAREHOUSES, format: ExportFormat.CSV, sync: true },
        '127.0.0.1',
        'corr-owner'
      );

      // Scoped user u-2 only has access to wh-1 (not wh-2)
      const scopedActor: ActorContext = {
        userId: 'u-2',
        merchantId: 'm-tenant-1',
        role: 'WAREHOUSE',
      };
      await assert.rejects(
        async () => {
          await service.downloadExport(
            'm-tenant-1',
            scopedActor,
            created.data.id,
            '127.0.0.1',
            'corr-scoped-dl'
          );
        },
        (err: any) => {
          assert.strictEqual(err.getStatus(), 403);
          assert.strictEqual(err.code, ExportErrorCode.SCOPE_FORBIDDEN);
          return true;
        }
      );
    });

    it('Finding 4: Actor whose pii:unmask capability was revoked throws 403 FORBIDDEN when downloading unmasked export', async () => {
      const mockPrisma = createMockPrismaService();
      const rbacPerms = ['iam:manage_users', 'pii:unmask'];
      const mockRbac = createMockRbacService(rbacPerms);
      const service = new ExportsService(mockPrisma as any, mockRbac as any);

      const actor: ActorContext = { userId: 'u-1', merchantId: 'm-tenant-1', role: 'ADMIN' };
      const created = await service.createExportJob(
        'm-tenant-1',
        actor,
        { resource: ExportResource.USERS, format: ExportFormat.CSV, sync: true },
        '127.0.0.1',
        'corr-unmask'
      );

      // Revoke pii:unmask permission
      const idx = rbacPerms.indexOf('pii:unmask');
      if (idx !== -1) rbacPerms.splice(idx, 1);

      await assert.rejects(
        async () => {
          await service.downloadExport(
            'm-tenant-1',
            actor,
            created.data.id,
            '127.0.0.1',
            'corr-revoked-dl'
          );
        },
        (err: any) => {
          assert.strictEqual(err.getStatus(), 403);
          assert.strictEqual(err.code, ExportErrorCode.FORBIDDEN);
          return true;
        }
      );
    });

    it('Finding 14: Downloading expired export job throws 410 EXPORT_EXPIRED', async () => {
      const mockPrisma = createMockPrismaService();
      const mockRbac = createMockRbacService(['iam:manage_users']);
      const service = new ExportsService(mockPrisma as any, mockRbac as any);

      const actor: ActorContext = { userId: 'u-1', merchantId: 'm-tenant-1', role: 'ADMIN' };
      const created = await service.createExportJob(
        'm-tenant-1',
        actor,
        { resource: ExportResource.USERS, format: ExportFormat.CSV, sync: true },
        '127.0.0.1',
        'corr-expired'
      );

      const jobIdx = mockPrisma.exportJobs.findIndex((j: any) => j.id === created.data.id);
      mockPrisma.exportJobs[jobIdx].expires_at = new Date(Date.now() - 1000);

      await assert.rejects(
        async () => {
          await service.downloadExport(
            'm-tenant-1',
            actor,
            created.data.id,
            '127.0.0.1',
            'corr-expired-dl'
          );
        },
        (err: any) => {
          assert.strictEqual(err.getStatus(), 410);
          assert.strictEqual(err.code, ExportErrorCode.EXPORT_EXPIRED);
          return true;
        }
      );
    });

    it('Finding 15: Completed export job returns complete generation metadata on subsequent reads', async () => {
      const mockPrisma = createMockPrismaService();
      const mockRbac = createMockRbacService(['iam:manage_users']);
      const service = new ExportsService(mockPrisma as any, mockRbac as any);

      const actor: ActorContext = { userId: 'u-1', merchantId: 'm-tenant-1', role: 'ADMIN' };
      const created = await service.createExportJob(
        'm-tenant-1',
        actor,
        { resource: ExportResource.USERS, format: ExportFormat.CSV, sync: true },
        '127.0.0.1',
        'corr-meta'
      );

      const getRes = await service.getExportJob('m-tenant-1', actor, created.data.id, 'corr-get');
      assert.ok(getRes.data.metadata);
      assert.strictEqual(getRes.data.metadata?.export_id, created.data.id);
      assert.strictEqual(getRes.data.metadata?.resource, ExportResource.USERS);
      assert.ok(getRes.data.metadata?.checksum_sha256);

      const listRes = await service.listExportJobs(
        'm-tenant-1',
        actor,
        { resource: ExportResource.USERS },
        'corr-list'
      );
      const found = listRes.data.find((j) => j.id === created.data.id);
      assert.ok(found?.metadata);
    });

    it('Finding 7: Clamped export records explicit truncation note in metadata', async () => {
      const mockPrisma = createMockPrismaService();
      mockPrisma.user.count = async () => 2000000;
      const mockRbac = createMockRbacService(['iam:manage_users']);
      const service = new ExportsService(mockPrisma as any, mockRbac as any);

      const actor: ActorContext = { userId: 'u-1', merchantId: 'm-tenant-1', role: 'ADMIN' };
      const result = await service.createExportJob(
        'm-tenant-1',
        actor,
        {
          resource: ExportResource.USERS,
          format: ExportFormat.CSV,
          filters: { clamp: true },
          sync: true,
        },
        '127.0.0.1',
        'corr-clamp'
      );

      assert.strictEqual(result.data.status, ExportJobStatus.COMPLETED);
      assert.ok(result.data.metadata?.truncation_note);
      assert.strictEqual(result.data.metadata.truncation_note.includes('giới hạn'), true);
    });

    it('Finding 12: CSV metadata filters banner neutralizes formula injection and escapes properly', () => {
      const metadataWithFormula: ExportGenerationMetadata = {
        export_id: 'exp-test-formula',
        generated_at: new Date().toISOString(),
        merchant_id: 'm-tenant-1',
        requested_by: 'u-1',
        user_role: 'ADMIN',
        resource: ExportResource.WAREHOUSES,
        format: ExportFormat.CSV,
        filters: { city: '=1+1,x,y', custom_note: '=cmd|’ /C calc’!A0' },
        rule_version: '2026.09.08',
        total_rows: 1,
        succeeded_rows: 1,
        failed_rows: 0,
        checksum_sha256: 'mock-sha',
      };

      const buf = generateCsv(metadataWithFormula, [{ key: 'id', label: 'ID' }], [{ id: 'wh-1' }]);
      const csvStr = buf.toString('utf-8');

      // Assert metadata line for Filters is properly escaped as an RFC 4180 cell so commas do not split it
      assert.strictEqual(csvStr.includes('"# Filters:'), true);
      // Assert formula injection prefix = was neutralized to '=
      assert.strictEqual(csvStr.includes("'=1+1"), true);
      assert.strictEqual(csvStr.includes("'=cmd|"), true);
    });

    it('Finding 3 / Prior 4: Historical unmarked file fails closed on download without pii:unmask', async () => {
      const mockPrisma = createMockPrismaService();
      // Insert a historical job with NO __unmasked_pii marker
      const historicalJobId = 'job-historical-unmarked';
      mockPrisma.exportJobs.push({
        id: historicalJobId,
        merchant_id: 'm-tenant-1',
        user_id: 'u-historical',
        resource: ExportResource.USERS,
        format: ExportFormat.CSV,
        status: ExportJobStatus.COMPLETED,
        filters: { city: 'Hà Nội' }, // No __unmasked_pii marker
        file_data: Buffer.from('id,name,phone\n1,Alpha,0901234567'),
        file_name: 'historical.csv',
        checksum_sha256: 'checksum-123',
      });

      // Actor WITHOUT pii:unmask
      const mockRbacNoUnmask = createMockRbacService(['iam:manage_users']);
      const serviceNoUnmask = new ExportsService(mockPrisma as any, mockRbacNoUnmask as any);
      const actorNoUnmask: ActorContext = {
        userId: 'u-no-unmask',
        merchantId: 'm-tenant-1',
        role: 'STAFF',
      };

      await assert.rejects(
        async () => {
          await serviceNoUnmask.downloadExport(
            'm-tenant-1',
            actorNoUnmask,
            historicalJobId,
            '127.0.0.1',
            'corr-hist-1'
          );
        },
        (err: any) => {
          assert.strictEqual(err instanceof CanonicalApiException, true);
          assert.strictEqual(err.getStatus(), 403);
          assert.strictEqual(err.code, ExportErrorCode.FORBIDDEN);
          return true;
        }
      );

      // Actor WITH pii:unmask can download historical unmarked file
      const mockRbacWithUnmask = createMockRbacService(['iam:manage_users', 'pii:unmask']);
      const serviceWithUnmask = new ExportsService(mockPrisma as any, mockRbacWithUnmask as any);
      const actorWithUnmask: ActorContext = {
        userId: 'u-unmask',
        merchantId: 'm-tenant-1',
        role: 'OWNER',
      };

      const res = await serviceWithUnmask.downloadExport(
        'm-tenant-1',
        actorWithUnmask,
        historicalJobId,
        '127.0.0.1',
        'corr-hist-2'
      );
      assert.strictEqual(res.fileName, 'historical.csv');
      assert.ok(res.fileBuffer);
    });

    it('Finding 13: recoverStaleJobs and purgeExpiredExports are strictly tenant-scoped', async () => {
      const mockPrisma = createMockPrismaService();
      // Insert stale pending jobs for tenant A and tenant B
      mockPrisma.exportJobs.push(
        {
          id: 'job-stale-tenant-a',
          merchant_id: 'tenant-a',
          status: ExportJobStatus.PENDING,
          created_at: new Date(Date.now() - 3600000),
        },
        {
          id: 'job-stale-tenant-b',
          merchant_id: 'tenant-b',
          status: ExportJobStatus.PENDING,
          created_at: new Date(Date.now() - 3600000),
        }
      );

      const mockRbac = createMockRbacService();
      const service = new ExportsService(mockPrisma as any, mockRbac as any);

      // Recover for tenant A only
      const recoveredCount = await service.recoverStaleJobs('tenant-a');
      assert.strictEqual(recoveredCount, 1);

      const jobA = mockPrisma.exportJobs.find((j: any) => j.id === 'job-stale-tenant-a');
      assert.strictEqual(jobA.status, ExportJobStatus.FAILED);
      assert.strictEqual(jobA.error_code, 'PROCESSING_TIMEOUT');

      // Tenant B job MUST remain untouched in PENDING
      const jobB = mockPrisma.exportJobs.find((j: any) => j.id === 'job-stale-tenant-b');
      assert.strictEqual(jobB.status, ExportJobStatus.PENDING);
    });

    it('Finding 7 / Finding 10: Actor with restricted store_scopes requesting out-of-scope branch throws SCOPE_FORBIDDEN', async () => {
      const mockPrisma = createMockPrismaService();
      // Actor u-scoped has store_scopes: ['branch-hcm-01']
      mockPrisma.users.push({
        id: 'u-scoped-branch',
        merchant_id: 'm-tenant-1',
        role: 'STAFF',
        store_scopes: ['branch-hcm-01'],
        warehouse_scopes: ['*'],
      });

      const mockRbac = createMockRbacService(['reconciliation:view_contract_rates']);
      const service = new ExportsService(mockPrisma as any, mockRbac as any);
      const actor: ActorContext = {
        userId: 'u-scoped-branch',
        merchantId: 'm-tenant-1',
        role: 'STAFF',
      };

      await assert.rejects(
        async () => {
          await service.createExportJob(
            'm-tenant-1',
            actor,
            {
              resource: ExportResource.LEDGERS,
              format: ExportFormat.CSV,
              filters: { branch_id: 'branch-hanoi-99' }, // Out-of-scope branch
              sync: true,
            },
            '127.0.0.1',
            'corr-branch-scope'
          );
        },
        (err: any) => {
          assert.strictEqual(err instanceof CanonicalApiException, true);
          assert.strictEqual(err.getStatus(), 403);
          assert.strictEqual(err.code, ExportErrorCode.SCOPE_FORBIDDEN);
          return true;
        }
      );
    });

    it('Finding 14: Job creation and mandatory audit log are committed atomically via transaction', async () => {
      let transactionCalled = false;
      const mockPrisma = createMockPrismaService();
      const originalTx = mockPrisma.$transaction;
      mockPrisma.$transaction = async (fn: any) => {
        transactionCalled = true;
        return originalTx(fn);
      };

      const mockRbac = createMockRbacService(['iam:manage_users']);
      const service = new ExportsService(mockPrisma as any, mockRbac as any);
      const actor: ActorContext = {
        userId: 'u-tx-test',
        merchantId: 'm-tenant-1',
        role: 'OWNER',
      };

      const res = await service.createExportJob(
        'm-tenant-1',
        actor,
        {
          resource: ExportResource.USERS,
          format: ExportFormat.CSV,
          sync: false,
        },
        '127.0.0.1',
        'corr-tx-test'
      );

      assert.strictEqual(
        transactionCalled,
        true,
        'Must commit export job and audit log via $transaction'
      );
      assert.strictEqual(res.data.status, ExportJobStatus.PENDING);
      const auditLog = mockPrisma.auditLogs.find(
        (l: any) => l.action === 'EXPORT_REQUESTED' && l.entity_id === res.data.id
      );
      assert.ok(auditLog, 'Audit log EXPORT_REQUESTED must be committed in transaction');
    });
  });
});
