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
import { generateXlsx, escapeXml, readXlsx } from './generators/xlsx.generator';
import { generatePdf } from './generators/pdf.generator';
import { parseTtf } from './fonts/ttf';
import { EMBEDDED_FONTS } from './fonts/embedded-fonts';
import { ExportsService } from './exports.service';
import { redactDatabaseUrl } from './exports.util';

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
      store_scopes: ['*'],
      carrier_account_scopes: ['*'],
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
      store_scopes: ['branch-1'],
      carrier_account_scopes: ['ca-1'],
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
      store_scopes: ['*'],
      carrier_account_scopes: ['*'],
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
        const item = { ...data, created_at: new Date() };
        exportJobs.push(item);
        return item;
      },
      update: async ({ where, data }: any) => {
        const idx = exportJobs.findIndex((j) => j.id === where.id);
        if (idx === -1) throw new Error('Not found');
        exportJobs[idx] = { ...exportJobs[idx], ...data };
        return exportJobs[idx];
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (let idx = 0; idx < exportJobs.length; idx++) {
          if (where.id && exportJobs[idx].id !== where.id) continue;
          if (where.merchant_id && exportJobs[idx].merchant_id !== where.merchant_id) continue;
          if (
            where.status &&
            typeof where.status === 'string' &&
            exportJobs[idx].status !== where.status
          )
            continue;
          if (where.status?.in && !where.status.in.includes(exportJobs[idx].status)) continue;
          if (where.created_at?.lt && exportJobs[idx].created_at >= where.created_at.lt) continue;
          exportJobs[idx] = { ...exportJobs[idx], ...data };
          count++;
        }
        return { count };
      },
      deleteMany: async ({ where }: any) => {
        let count = 0;
        for (let idx = exportJobs.length - 1; idx >= 0; idx--) {
          if (where.merchant_id && exportJobs[idx].merchant_id !== where.merchant_id) continue;
          if (where.expires_at?.lt) {
            if (!exportJobs[idx].expires_at || exportJobs[idx].expires_at >= where.expires_at.lt) {
              continue;
            }
          }
          exportJobs.splice(idx, 1);
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

    it('Finding 10: generateXlsx produces conformant OOXML ZIP workbook verified by readXlsx', () => {
      const buf = generateXlsx(mockMetadata, mockHeaders, mockRows);
      assert.strictEqual(buf.length > 0, true);
      assert.strictEqual(buf.readUInt32LE(0), 0x04034b50, 'Must have PKZIP local header signature');

      // Verify with real XLSX reader
      const parsed = readXlsx(buf);
      assert.ok(parsed.sheets.Data, 'Must parse Data worksheet');
      assert.deepStrictEqual(parsed.sheets.Data.headers, ['Tên người dùng', 'Email', 'Ghi chú']);
      assert.strictEqual(parsed.sheets.Data.rows.length, 2);
      assert.strictEqual(parsed.sheets.Data.rows[0]['Tên người dùng'], 'Nguyễn Văn A');
      assert.strictEqual(
        parsed.sheets.Data.rows[1]['Ghi chú'],
        'Có dấu phẩy, nháy "kép" và\nxuống dòng'
      );

      // Verify Metadata sheet
      assert.strictEqual(parsed.metadata['Export ID'], 'exp-test-uuid-001');
      assert.strictEqual(parsed.metadata['Tenant ID'], 'm-tenant-1');
      assert.strictEqual(parsed.metadata['Total Records'], '2');

      // Negative test: readXlsx rejects non-ZIP / legacy XML content
      assert.throws(
        () => readXlsx(Buffer.from('<?xml version="1.0"?><Workbook></Workbook>')),
        /Invalid XLSX package/
      );

      // Negative test: Formula injection in cells is neutralized with single quote prefix
      const injectionHeaders = [{ key: 'val', label: 'Formula Test' }];
      const injectionRows = [
        { val: '=1+2' },
        { val: '+cmd|/c calc' },
        { val: '-5+2' },
        { val: '@SUM(A1:A10)' },
      ];
      const injectionBuf = generateXlsx(mockMetadata, injectionHeaders, injectionRows);
      const parsedInjection = readXlsx(injectionBuf);
      for (let i = 0; i < injectionRows.length; i++) {
        const raw = injectionRows[i].val;
        const cell = parsedInjection.sheets.Data.rows[i]['Formula Test'];
        assert.strictEqual(
          cell.startsWith("'"),
          true,
          `Formula ${raw} must be escaped with leading quote`
        );
      }
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

    it('Finding 4: generatePdf embeds TrueType font programs and maps Vietnamese diacritics via cmap', () => {
      const vnHeaders = [
        { key: 'full_name', label: 'Họ và tên' },
        { key: 'city', label: 'Tỉnh/Thành phố' },
        { key: 'note', label: 'Ghi chú tiếng Việt' },
      ];
      const vnRows = [
        { full_name: 'Nguyễn Văn Đạt', city: 'Hà Nội', note: 'Đơn hàng vận chuyển nhanh' },
        {
          full_name: 'Trần Thị Mỹ Duyên',
          city: 'TP. Hồ Chí Minh',
          note: 'Kiểm tra đối soát thành công',
        },
      ];
      const buf = generatePdf(mockMetadata, vnHeaders, vnRows);
      const latin = buf.toString('latin1');

      // Verify embedded FontFile2 streams exist
      assert.strictEqual(
        latin.includes('/FontFile2'),
        true,
        'Must embed /FontFile2 TrueType font programs'
      );
      assert.strictEqual(latin.includes('/NotoSans-Regular'), true);
      assert.strictEqual(latin.includes('/NotoSans-Bold'), true);
      assert.strictEqual(latin.includes('/CIDFontType2'), true);
      assert.strictEqual(latin.includes('/ToUnicode'), true);

      // Verify TrueType header signature in embedded stream: 0x00010000 (OpenType/TrueType 1.0)
      assert.strictEqual(
        latin.includes('\u0000\u0001\u0000\u0000'),
        true,
        'Embedded stream must contain TrueType sfnt header'
      );

      // Verify font cmap mapping: test actual glyph IDs for Vietnamese characters
      const regularFontData = EMBEDDED_FONTS.find((f) => f.id === 'noto-sans-regular')!;
      const parsedRegular = parseTtf(regularFontData.bytes);

      // Test diacritics: Đ (U+0110), ễ (U+1EC5), ạ (U+1EA1), ơ (U+01A1), ư (U+01B0)
      const testChars = ['Đ', 'ễ', 'ạ', 'ơ', 'ư', 'ắ', 'ộ', 'ỷ'];
      for (const ch of testChars) {
        const cp = ch.codePointAt(0)!;
        const gid = parsedRegular.unicodeToGid.get(cp);
        assert.ok(
          gid !== undefined && gid > 0,
          `Character ${ch} (U+${cp.toString(16)}) must map to non-zero GID`
        );
        // And gidToUnicode must map back
        assert.strictEqual(
          parsedRegular.gidToUnicode.get(gid),
          cp,
          `GID ${gid} must map back to U+${cp.toString(16)}`
        );
      }

      // Verify PDF content stream contains hex-encoded glyph sequences for Vietnamese text
      const nguyenGids = Array.from('Nguyễn').map(
        (ch) => parsedRegular.unicodeToGid.get(ch.codePointAt(0)!) ?? 0
      );
      const nguyenHex = nguyenGids.map((g) => g.toString(16).padStart(4, '0')).join('');
      assert.strictEqual(
        latin.includes(nguyenHex),
        true,
        `PDF stream must contain hex-encoded glyph string for 'Nguyễn' (${nguyenHex})`
      );

      // Verify /ToUnicode CMap block in PDF contains mappings for those glyphs
      for (const gid of nguyenGids) {
        const gidHex = `<${gid.toString(16).padStart(4, '0')}>`;
        assert.strictEqual(
          latin.includes(gidHex),
          true,
          `ToUnicode CMap must contain entry for GID ${gidHex}`
        );
      }

      // Negative test: character outside font falls back to .notdef (GID 0)
      const unmappedCp = 0x10ffff; // unmapped codepoint
      const unmappedGid = parsedRegular.unicodeToGid.get(unmappedCp) ?? 0;
      assert.strictEqual(unmappedGid, 0, 'Unmapped character must fall back to GID 0 (.notdef)');

      // Verify conformant trailer and xref
      assert.strictEqual(latin.startsWith('%PDF-1.4'), true);
      assert.strictEqual(latin.trimEnd().endsWith('%%EOF'), true);
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

    it('Finding 1: Owner unfiltered ledger export cannot be downloaded by restricted branch actor (negative test)', async () => {
      const mockPrisma = createMockPrismaService();
      const mockRbac = createMockRbacService([
        'reconciliation:view_contract_rates',
        'reconciliation:run_review_audit',
      ]);
      const service = new ExportsService(mockPrisma as any, mockRbac as any);

      // Owner creates an unfiltered ledger export
      const ownerActor: ActorContext = {
        userId: 'u-1',
        merchantId: 'm-tenant-1',
        role: 'OWNER',
      };
      const unfiltJob = await service.createExportJob(
        'm-tenant-1',
        ownerActor,
        { resource: ExportResource.LEDGERS, format: ExportFormat.CSV, sync: true },
        '127.0.0.1',
        'corr-owner-unfilt'
      );
      assert.strictEqual(unfiltJob.data.status, ExportJobStatus.COMPLETED);

      // Add a restricted branch user: store_scopes: ['branch-hcm']
      mockPrisma.users.push({
        id: 'u-restricted-branch',
        merchant_id: 'm-tenant-1',
        role: 'STAFF',
        warehouse_scopes: ['*'],
        store_scopes: ['branch-hcm'],
        carrier_account_scopes: ['*'],
        status: 'active',
      });
      const restrictedActor: ActorContext = {
        userId: 'u-restricted-branch',
        merchantId: 'm-tenant-1',
        role: 'STAFF',
      };

      // Restricted user attempting to download owner's unfiltered export MUST BE DENIED
      await assert.rejects(
        async () => {
          await service.downloadExport(
            'm-tenant-1',
            restrictedActor,
            unfiltJob.data.id,
            '127.0.0.1',
            'corr-dl-unfilt-fail'
          );
        },
        (err: any) => {
          assert.strictEqual(err instanceof CanonicalApiException, true);
          assert.strictEqual(err.getStatus(), 403);
          assert.strictEqual(err.code, ExportErrorCode.SCOPE_FORBIDDEN);
          return true;
        }
      );

      // Now owner creates a ledger export filtered to branch-hcm
      const filteredJob = await service.createExportJob(
        'm-tenant-1',
        ownerActor,
        {
          resource: ExportResource.LEDGERS,
          format: ExportFormat.CSV,
          filters: { branch_id: 'branch-hcm' },
          sync: true,
        },
        '127.0.0.1',
        'corr-owner-filt'
      );
      assert.strictEqual(filteredJob.data.status, ExportJobStatus.COMPLETED);

      // Restricted user for branch-hcm CAN download it
      const dlSuccess = await service.downloadExport(
        'm-tenant-1',
        restrictedActor,
        filteredJob.data.id,
        '127.0.0.1',
        'corr-dl-filt-ok'
      );
      assert.ok(dlSuccess.fileBuffer);

      // User restricted to branch-danang CANNOT download the branch-hcm export
      mockPrisma.users.push({
        id: 'u-other-branch',
        merchant_id: 'm-tenant-1',
        role: 'STAFF',
        warehouse_scopes: ['*'],
        store_scopes: ['branch-danang'],
        carrier_account_scopes: ['*'],
        status: 'active',
      });
      const otherBranchActor: ActorContext = {
        userId: 'u-other-branch',
        merchantId: 'm-tenant-1',
        role: 'STAFF',
      };
      await assert.rejects(
        async () => {
          await service.downloadExport(
            'm-tenant-1',
            otherBranchActor,
            filteredJob.data.id,
            '127.0.0.1',
            'corr-dl-other-fail'
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

    it('Finding 2: Actor with empty branch, carrier, or warehouse scopes is denied export (negative test)', async () => {
      const mockPrisma = createMockPrismaService();
      const mockRbac = createMockRbacService([
        'reconciliation:view_contract_rates',
        'iam:shop_config',
      ]);
      const service = new ExportsService(mockPrisma as any, mockRbac as any);

      // User with store_scopes: []
      mockPrisma.users.push({
        id: 'u-empty-branch-scope',
        merchant_id: 'm-tenant-1',
        role: 'STAFF',
        warehouse_scopes: ['*'],
        store_scopes: [],
        carrier_account_scopes: ['*'],
        status: 'active',
      });
      const emptyBranchActor: ActorContext = {
        userId: 'u-empty-branch-scope',
        merchantId: 'm-tenant-1',
        role: 'STAFF',
      };

      await assert.rejects(
        async () => {
          await service.createExportJob(
            'm-tenant-1',
            emptyBranchActor,
            { resource: ExportResource.LEDGERS, format: ExportFormat.CSV, sync: true },
            '127.0.0.1',
            'corr-empty-branch'
          );
        },
        (err: any) => {
          assert.strictEqual(err instanceof CanonicalApiException, true);
          assert.strictEqual(err.getStatus(), 403);
          assert.strictEqual(err.code, ExportErrorCode.SCOPE_FORBIDDEN);
          return true;
        }
      );

      // User with carrier_account_scopes: []
      mockPrisma.users.push({
        id: 'u-empty-carrier-scope',
        merchant_id: 'm-tenant-1',
        role: 'STAFF',
        warehouse_scopes: ['*'],
        store_scopes: ['*'],
        carrier_account_scopes: [],
        status: 'active',
      });
      const emptyCarrierActor: ActorContext = {
        userId: 'u-empty-carrier-scope',
        merchantId: 'm-tenant-1',
        role: 'STAFF',
      };

      await assert.rejects(
        async () => {
          await service.createExportJob(
            'm-tenant-1',
            emptyCarrierActor,
            { resource: ExportResource.LEDGERS, format: ExportFormat.CSV, sync: true },
            '127.0.0.1',
            'corr-empty-carrier'
          );
        },
        (err: any) => {
          assert.strictEqual(err instanceof CanonicalApiException, true);
          assert.strictEqual(err.getStatus(), 403);
          assert.strictEqual(err.code, ExportErrorCode.SCOPE_FORBIDDEN);
          return true;
        }
      );

      // User with warehouse_scopes: [] on LEDGERS
      mockPrisma.users.push({
        id: 'u-empty-wh-scope',
        merchant_id: 'm-tenant-1',
        role: 'STAFF',
        warehouse_scopes: [],
        store_scopes: ['*'],
        carrier_account_scopes: ['*'],
        status: 'active',
      });
      const emptyWhActor: ActorContext = {
        userId: 'u-empty-wh-scope',
        merchantId: 'm-tenant-1',
        role: 'STAFF',
      };

      await assert.rejects(
        async () => {
          await service.createExportJob(
            'm-tenant-1',
            emptyWhActor,
            { resource: ExportResource.LEDGERS, format: ExportFormat.CSV, sync: true },
            '127.0.0.1',
            'corr-empty-wh-ledger'
          );
        },
        (err: any) => {
          assert.strictEqual(err instanceof CanonicalApiException, true);
          assert.strictEqual(err.getStatus(), 403);
          assert.strictEqual(err.code, ExportErrorCode.SCOPE_FORBIDDEN);
          return true;
        }
      );

      // User with warehouse_scopes: [] on WAREHOUSES
      await assert.rejects(
        async () => {
          await service.createExportJob(
            'm-tenant-1',
            emptyWhActor,
            { resource: ExportResource.WAREHOUSES, format: ExportFormat.CSV, sync: true },
            '127.0.0.1',
            'corr-empty-wh-wh'
          );
        },
        (err: any) => {
          assert.strictEqual(err instanceof CanonicalApiException, true);
          assert.strictEqual(err.getStatus(), 403);
          assert.strictEqual(err.code, ExportErrorCode.SCOPE_FORBIDDEN);
          return true;
        }
      );

      // Seed a completed ledger export job for download scope checks
      mockPrisma.exportJobs.push({
        id: 'job-completed-ledger',
        merchant_id: 'm-tenant-1',
        user_id: 'u-1',
        resource: ExportResource.LEDGERS,
        format: ExportFormat.CSV,
        status: ExportJobStatus.COMPLETED,
        filters: {
          __effective_scopes: {
            warehouse_scopes: ['*'],
            store_scopes: ['*'],
            carrier_account_scopes: ['*'],
          },
        },
        file_data: Buffer.from('dummy-ledger-data'),
        created_at: new Date(),
        expires_at: new Date(Date.now() + 86400000),
      });

      // Download negative test: empty branch scopes
      await assert.rejects(
        async () => {
          await service.downloadExport(
            'm-tenant-1',
            emptyBranchActor,
            'job-completed-ledger',
            '127.0.0.1',
            'corr-dl-empty-branch'
          );
        },
        (err: any) => {
          assert.strictEqual(err instanceof CanonicalApiException, true);
          assert.strictEqual(err.getStatus(), 403);
          assert.strictEqual(err.code, ExportErrorCode.SCOPE_FORBIDDEN);
          return true;
        }
      );

      // Download negative test: empty carrier scopes
      await assert.rejects(
        async () => {
          await service.downloadExport(
            'm-tenant-1',
            emptyCarrierActor,
            'job-completed-ledger',
            '127.0.0.1',
            'corr-dl-empty-carrier'
          );
        },
        (err: any) => {
          assert.strictEqual(err instanceof CanonicalApiException, true);
          assert.strictEqual(err.getStatus(), 403);
          assert.strictEqual(err.code, ExportErrorCode.SCOPE_FORBIDDEN);
          return true;
        }
      );

      // Seed a completed warehouse export job
      mockPrisma.exportJobs.push({
        id: 'job-completed-wh',
        merchant_id: 'm-tenant-1',
        user_id: 'u-1',
        resource: ExportResource.WAREHOUSES,
        format: ExportFormat.CSV,
        status: ExportJobStatus.COMPLETED,
        filters: {},
        row_results: [{ status: 'succeeded', entity_id: 'wh-1' }],
        file_data: Buffer.from('dummy-wh-data'),
        created_at: new Date(),
        expires_at: new Date(Date.now() + 86400000),
      });

      // Download negative test: empty warehouse scopes on warehouse export
      await assert.rejects(
        async () => {
          await service.downloadExport(
            'm-tenant-1',
            emptyWhActor,
            'job-completed-wh',
            '127.0.0.1',
            'corr-dl-empty-wh'
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

    it('Finding 3: Audit log metadata always masks PII in filters even for privileged requesters with pii:unmask', async () => {
      const mockPrisma = createMockPrismaService();
      const mockRbac = createMockRbacService(['iam:manage_users', 'pii:unmask']);
      const service = new ExportsService(mockPrisma as any, mockRbac as any);

      const privilegedActor: ActorContext = {
        userId: 'u-1',
        merchantId: 'm-tenant-1',
        role: 'OWNER',
      };

      const job = await service.createExportJob(
        'm-tenant-1',
        privilegedActor,
        {
          resource: ExportResource.USERS,
          format: ExportFormat.CSV,
          filters: {
            email: 'privileged_user@shopde.test',
            phone: '0912345678',
            contact_email: 'admin_contact@shopde.test',
            contact_phone: '+84987654321',
          },
          sync: true,
        },
        '127.0.0.1',
        'corr-audit-mask-test'
      );

      // Check EXPORT_REQUESTED audit log
      const reqAudit = mockPrisma.auditLogs.find(
        (l: any) => l.action === ExportAuditEvent.EXPORT_REQUESTED && l.entity_id === job.data.id
      );
      assert.ok(reqAudit);
      const reqFilters = (reqAudit.new_value as any).filters;
      assert.strictEqual(
        reqFilters.email.includes('privileged_user'),
        false,
        'Audit log must NOT contain plaintext email'
      );
      assert.strictEqual(
        reqFilters.phone.includes('0912345678'),
        false,
        'Audit log must NOT contain plaintext phone'
      );
      assert.strictEqual(
        reqFilters.contact_email.includes('admin_contact'),
        false,
        'Audit log must NOT contain plaintext contact_email'
      );
      assert.strictEqual(
        reqFilters.contact_phone.includes('987654321'),
        false,
        'Audit log must NOT contain plaintext contact_phone'
      );

      // Download and check EXPORT_DOWNLOADED audit log
      await service.downloadExport(
        'm-tenant-1',
        privilegedActor,
        job.data.id,
        '127.0.0.1',
        'corr-dl-mask-test'
      );

      const dlAudit = mockPrisma.auditLogs.find(
        (l: any) => l.action === ExportAuditEvent.EXPORT_DOWNLOADED && l.entity_id === job.data.id
      );
      assert.ok(dlAudit);
      const dlFilters = (dlAudit.new_value as any).filters;
      assert.strictEqual(
        JSON.stringify(dlFilters).includes('privileged_user'),
        false,
        'Download audit log must NOT contain plaintext email'
      );
      assert.strictEqual(
        JSON.stringify(dlFilters).includes('admin_contact'),
        false,
        'Download audit log must NOT contain plaintext contact_email'
      );
      assert.strictEqual(
        JSON.stringify(dlFilters).includes('0912345678'),
        false,
        'Download audit log must NOT contain plaintext phone'
      );
    });

    it('Finding 5: PII marker is atomically persisted with completed file and protects against unmask capability drift', async () => {
      const mockPrisma = createMockPrismaService();
      // Actor initially does NOT have pii:unmask
      const currentPerms = new Set(['iam:manage_users']);
      const dynamicRbac = {
        actorHasPermissions: async (_act: any, perms: string[]) =>
          perms.every((p) => currentPerms.has(p)),
      };
      const service = new ExportsService(mockPrisma as any, dynamicRbac as any);

      const actor: ActorContext = {
        userId: 'u-1',
        merchantId: 'm-tenant-1',
        role: 'STAFF',
      };

      // Hook into prisma.user.findMany to simulate granting pii:unmask mid-generation
      const originalFindMany = mockPrisma.user.findMany;
      mockPrisma.user.findMany = async (args: any) => {
        const result = await originalFindMany(args);
        // Mid-generation grant: permission granted while file generation was underway!
        currentPerms.add('pii:unmask');
        return result;
      };

      const job = await service.createExportJob(
        'm-tenant-1',
        actor,
        { resource: ExportResource.USERS, format: ExportFormat.CSV, sync: true },
        '127.0.0.1',
        'corr-pii-grant-race'
      );

      // Verify the persisted marker remains false (reflecting that file data was generated masked)
      const persisted = mockPrisma.exportJobs.find((j: any) => j.id === job.data.id);
      assert.ok(persisted);
      assert.strictEqual(
        persisted.filters.__unmasked_pii,
        false,
        'Marker must be false because data was generated masked, even though pii:unmask was granted mid-flight'
      );
      assert.strictEqual(
        Buffer.from(persisted.file_data).toString('utf-8').includes('091****678'),
        true,
        'File bytes must contain masked phone'
      );

      // A user without pii:unmask CAN download this export because the file bytes are masked
      const noUnmaskRbac = createMockRbacService(['iam:manage_users']);
      const noUnmaskService = new ExportsService(mockPrisma as any, noUnmaskRbac as any);
      const dlResult = await noUnmaskService.downloadExport(
        'm-tenant-1',
        { userId: 'u-other', merchantId: 'm-tenant-1', role: 'STAFF' },
        job.data.id,
        '127.0.0.1',
        'corr-dl-masked-ok'
      );
      assert.ok(dlResult.fileBuffer);

      // Conversely: start WITH pii:unmask, revoke permission mid-flight
      const currentPerms2 = new Set(['iam:manage_users', 'pii:unmask']);
      const dynamicRbac2 = {
        actorHasPermissions: async (_act: any, perms: string[]) =>
          perms.every((p) => currentPerms2.has(p)),
      };
      const service2 = new ExportsService(mockPrisma as any, dynamicRbac2 as any);
      mockPrisma.user.findMany = async (args: any) => {
        const result = await originalFindMany(args);
        // Revoke pii:unmask mid-generation
        currentPerms2.delete('pii:unmask');
        return result;
      };

      const unmaskedJob = await service2.createExportJob(
        'm-tenant-1',
        actor,
        { resource: ExportResource.USERS, format: ExportFormat.CSV, sync: true },
        '127.0.0.1',
        'corr-pii-revoke-race'
      );
      const persisted2 = mockPrisma.exportJobs.find((j: any) => j.id === unmaskedJob.data.id);
      assert.strictEqual(
        persisted2.filters.__unmasked_pii,
        true,
        'Marker must be true because data was generated unmasked'
      );

      // Now downloading without pii:unmask MUST be rejected with 403 FORBIDDEN
      await assert.rejects(
        async () => {
          await noUnmaskService.downloadExport(
            'm-tenant-1',
            { userId: 'u-other', merchantId: 'm-tenant-1', role: 'STAFF' },
            unmaskedJob.data.id,
            '127.0.0.1',
            'corr-dl-unmasked-fail'
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

    it('Finding 6: Sổ 1 partial recovery calculates received and outstanding amounts separately', async () => {
      const mockPrisma = createMockPrismaService();
      // Replace claims with a partial recovery: 500k accepted, 100k recovered
      mockPrisma.claim.findMany = async () => [
        {
          status: 'ACCEPTED',
          accepted_amount: 500000n,
          recovered_amount: 100000n,
        },
      ];
      const mockRbac = createMockRbacService(['reconciliation:view_contract_rates']);
      const service = new ExportsService(mockPrisma as any, mockRbac as any);

      const actor: ActorContext = {
        userId: 'u-1',
        merchantId: 'm-tenant-1',
        role: 'OWNER',
      };

      const result = await service.createExportJob(
        'm-tenant-1',
        actor,
        { resource: ExportResource.LEDGERS, format: ExportFormat.CSV, sync: true },
        '127.0.0.1',
        'corr-partial-rec'
      );

      const dl = await service.downloadExport(
        'm-tenant-1',
        actor,
        result.data.id,
        '127.0.0.1',
        'corr-dl-partial'
      );
      const csv = dl.fileBuffer.toString('utf-8');
      const dataRows = csv.split('\r\n').filter((l) => l && !l.startsWith('#'));

      const recRow = dataRows.find((r) => r.includes('LEDGER1_RECOVERED_AMOUNT'));
      assert.ok(recRow);
      assert.strictEqual(recRow.includes('100000'), true, 'Recovered amount must be 100000');

      const pendRow = dataRows.find((r) => r.includes('LEDGER1_PENDING_ACCEPTANCE'));
      assert.ok(pendRow);
      assert.strictEqual(
        pendRow.includes('400000'),
        true,
        'Pending acceptance must be 400000 (500000 - 100000)'
      );

      // Negative test: when recovered >= accepted (e.g. 200k recovered, 150k accepted), pending does not become negative
      mockPrisma.claim.findMany = async () => [
        {
          status: 'ACCEPTED',
          accepted_amount: 150000n,
          recovered_amount: 200000n,
        },
      ];
      const resultOver = await service.createExportJob(
        'm-tenant-1',
        actor,
        { resource: ExportResource.LEDGERS, format: ExportFormat.CSV, sync: true },
        '127.0.0.1',
        'corr-partial-over'
      );
      const dlOver = await service.downloadExport(
        'm-tenant-1',
        actor,
        resultOver.data.id,
        '127.0.0.1',
        'corr-dl-partial-over'
      );
      const overRows = dlOver.fileBuffer
        .toString('utf-8')
        .split('\r\n')
        .filter((l) => l && !l.startsWith('#'));
      const pendOverRow = overRows.find((r) => r.includes('LEDGER1_PENDING_ACCEPTANCE'));
      assert.ok(pendOverRow);
      assert.strictEqual(
        pendOverRow.includes(',0,') || pendOverRow.includes('"0"'),
        true,
        'Pending acceptance must remain 0 when recovered >= accepted'
      );

      // Negative test: rejected or non-accepted claims are excluded from Sổ 1
      mockPrisma.claim.findMany = async () => [
        {
          status: 'REJECTED',
          accepted_amount: 500000n,
          recovered_amount: 100000n,
        },
      ];
      const resultRej = await service.createExportJob(
        'm-tenant-1',
        actor,
        { resource: ExportResource.LEDGERS, format: ExportFormat.CSV, sync: true },
        '127.0.0.1',
        'corr-partial-rej'
      );
      const dlRej = await service.downloadExport(
        'm-tenant-1',
        actor,
        resultRej.data.id,
        '127.0.0.1',
        'corr-dl-partial-rej'
      );
      const rejRows = dlRej.fileBuffer
        .toString('utf-8')
        .split('\r\n')
        .filter((l) => l && !l.startsWith('#'));
      const recRejRow = rejRows.find((r) => r.includes('LEDGER1_RECOVERED_AMOUNT'));
      assert.ok(recRejRow);
      assert.strictEqual(
        recRejRow.includes(',0,') || recRejRow.includes('"0"'),
        true,
        'Rejected claim recovered amount must be 0'
      );
    });

    it('Finding 7: Overlapping maintenance during worker processing rejects resurrection', async () => {
      const mockPrisma = createMockPrismaService();
      const mockRbac = createMockRbacService(['iam:manage_users']);
      const service = new ExportsService(mockPrisma as any, mockRbac as any);

      // Create an in-flight job in PROCESSING state
      const targetJob = {
        id: 'job-overlap-worker-race',
        merchant_id: 'm-tenant-1',
        user_id: 'u-1',
        resource: ExportResource.USERS,
        format: ExportFormat.CSV,
        status: ExportJobStatus.PROCESSING,
        filters: {},
        created_at: new Date(Date.now() - 60 * 1000),
        expires_at: new Date(Date.now() + 86400000),
      };
      mockPrisma.exportJobs.push(targetJob);

      // Hook into user.findMany: DURING worker data retrieval, maintenance runs and marks the job FAILED!
      const originalFindMany = mockPrisma.user.findMany;
      mockPrisma.user.findMany = async (args: any) => {
        // Overlapping maintenance fires while worker is generating data!
        const found = mockPrisma.exportJobs.find((j: any) => j.id === 'job-overlap-worker-race');
        if (found) {
          found.status = ExportJobStatus.FAILED;
          found.error_code = ExportErrorCode.PROCESSING_TIMEOUT;
          found.error_message = 'Tác vụ đã bị thu hồi do quá thời gian xử lý';
        }
        return originalFindMany ? originalFindMany(args) : [];
      };

      const actor: ActorContext = {
        userId: 'u-1',
        merchantId: 'm-tenant-1',
        role: 'OWNER',
      };

      // Worker continues processing and attempts completion transition
      await assert.rejects(
        async () => {
          await service.processExportJob(
            'm-tenant-1',
            actor,
            'job-overlap-worker-race',
            { resource: ExportResource.USERS, format: ExportFormat.CSV },
            '127.0.0.1',
            'corr-overlapping-worker'
          );
        },
        (err: any) => {
          assert.strictEqual(err instanceof CanonicalApiException, true);
          assert.strictEqual(err.getStatus(), 408);
          assert.strictEqual(err.code, ExportErrorCode.PROCESSING_TIMEOUT);
          return true;
        }
      );

      // Crucial: The job in the database must REMAIN FAILED and NOT be resurrected to COMPLETED
      const finalRecord = mockPrisma.exportJobs.find(
        (j: any) => j.id === 'job-overlap-worker-race'
      );
      assert.strictEqual(finalRecord.status, ExportJobStatus.FAILED);
      assert.strictEqual(finalRecord.error_code, ExportErrorCode.PROCESSING_TIMEOUT);
    });

    it('Finding 9: Database diagnostics redact credentials in URL using imported redactDatabaseUrl', () => {
      const raw =
        'postgresql://admin:super_secret_password@db.example.com:5432/shipde?sslmode=require';
      const redacted = redactDatabaseUrl(raw);
      assert.strictEqual(redacted.includes('super_secret_password'), false);
      assert.strictEqual(redacted.includes('admin'), false);
      assert.strictEqual(redacted.includes('***:***@db.example.com:5432'), true);

      // Malformed / non-standard string fallback
      const rawFallback = 'postgresql://myuser:secret123@127.0.0.1:5433/db';
      const redactedFallback = redactDatabaseUrl(rawFallback);
      assert.strictEqual(redactedFallback.includes('secret123'), false);
      assert.strictEqual(redactedFallback.includes('myuser'), false);
      assert.strictEqual(redactedFallback.includes('***:***@127.0.0.1:5433'), true);
    });
  });
});
