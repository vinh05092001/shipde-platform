import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { HttpStatus } from '@nestjs/common';
import {
  parseCsv,
  generateCsv,
  parseXlsx,
  generateXlsxTemplate,
  calculateFileHash,
  scanBufferForMalware,
  normalizeRowsWithTemplate,
} from './imports.parser';
import { TEMPLATE_DEFINITIONS } from './imports.constants';
import { validateUploadImportDto, validateImportRow } from './imports.dto';
import { ImportsService } from './imports.service';
import { CanonicalApiException } from '../auth/auth.service';
import { ImportStatus } from '@shipde/contracts';

describe('FEAT-COM-04: Imports Framework Unit Test Suite', () => {
  describe('DTO Validation: validateUploadImportDto', () => {
    it('should validate valid UploadImportDto with template_type', () => {
      const dto = validateUploadImportDto({
        template_type: 'warehouses',
        file_name: 'test.csv',
        content: 'code,name\nWH-01,Test',
      });
      assert.strictEqual(dto.template_type, 'warehouses');
      assert.strictEqual(dto.file_name, 'test.csv');
      assert.strictEqual(dto.content, 'code,name\nWH-01,Test');
    });

    it('should reject missing template_type with 400 VALIDATION_ERROR', () => {
      assert.throws(
        () => validateUploadImportDto({ content: 'test' }),
        (err: any) => {
          assert.strictEqual(err.status, HttpStatus.BAD_REQUEST);
          assert.strictEqual(err.code, 'VALIDATION_ERROR');
          return true;
        }
      );
    });

    it('should reject invalid template_type with 400', () => {
      assert.throws(
        () => validateUploadImportDto({ template_type: 'invalid_type' }),
        (err: any) => {
          assert.strictEqual(err.status, HttpStatus.BAD_REQUEST);
          return true;
        }
      );
    });

    it('should reject non-string types with canonical 400', () => {
      assert.throws(
        () => validateUploadImportDto({ template_type: 12345 }),
        (err: any) => {
          assert.strictEqual(err.status, HttpStatus.BAD_REQUEST);
          return true;
        }
      );
    });
  });

  describe('Parser: CSV and XLSX', () => {
    it('should parse standard CSV with quotes, commas and CRLF', () => {
      const csv =
        'code,name,address_line\r\n"WH-01","Kho Tân Bình, TP.HCM","55 Cộng Hòa"\r\nWH-02,Kho Long Biên,10 Ngô Gia Tự';
      const parsed = parseCsv(csv);
      assert.strictEqual(parsed.headers.length, 3);
      assert.strictEqual(parsed.rows.length, 2);
      assert.strictEqual(parsed.rows[0].code, 'WH-01');
      assert.strictEqual(parsed.rows[0].name, 'Kho Tân Bình, TP.HCM');
      assert.strictEqual(parsed.rows[0].address_line, '55 Cộng Hòa');
      assert.strictEqual(parsed.rows[1].code, 'WH-02');
    });

    it('should handle escaped quotes in CSV', () => {
      const csv = 'code,name\nWH-01,"Kho ""VIP"" Sài Gòn"';
      const parsed = parseCsv(csv);
      assert.strictEqual(parsed.rows[0].name, 'Kho "VIP" Sài Gòn');
    });

    it('should generate properly escaped CSV', () => {
      const headers = ['code', 'name', 'address'];
      const rows = [
        { code: 'WH-01', name: 'Kho Tân Bình, Q.TB', address: '55 Cộng Hòa' },
        { code: 'WH-02', name: 'Kho "VIP"', address: '10 CMT8' },
      ];
      const csv = generateCsv(headers, rows);
      assert.ok(csv.includes('"Kho Tân Bình, Q.TB"'));
      assert.ok(csv.includes('"Kho ""VIP"""'));
    });

    it('should generate and parse XLSX template', () => {
      const template = TEMPLATE_DEFINITIONS.branches;
      const xlsxBuffer = generateXlsxTemplate(template);
      assert.ok(xlsxBuffer.length > 0);

      const parsed = parseXlsx(xlsxBuffer);
      assert.ok(parsed.headers.length >= 8);
      assert.strictEqual(parsed.headers[0], 'code');
      assert.ok(parsed.rows.length >= 2);
      assert.strictEqual(parsed.rows[0].code, 'BR-HCM-01');
    });

    it('should calculate deterministic SHA-256 hash', () => {
      const buf1 = Buffer.from('test content for hash');
      const buf2 = Buffer.from('test content for hash');
      const buf3 = Buffer.from('different content');
      assert.strictEqual(calculateFileHash(buf1), calculateFileHash(buf2));
      assert.notStrictEqual(calculateFileHash(buf1), calculateFileHash(buf3));
    });
  });

  describe('Malware Scanning: scanBufferForMalware', () => {
    it('should pass clean CSV and XLSX buffers', () => {
      const cleanCsv = Buffer.from('code,name\nWH-01,Kho Clean');
      const scan = scanBufferForMalware(cleanCsv);
      assert.strictEqual(scan.safe, true);
    });

    it('should reject Windows PE executable signature (MZ header)', () => {
      const peBuffer = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]);
      const scan = scanBufferForMalware(peBuffer);
      assert.strictEqual(scan.safe, false);
      assert.ok(scan.reason?.includes('PE/EXE'));
    });

    it('should reject Linux ELF executable signature', () => {
      const elfBuffer = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02]);
      const scan = scanBufferForMalware(elfBuffer);
      assert.strictEqual(scan.safe, false);
      assert.ok(scan.reason?.includes('ELF'));
    });

    it('should reject Mach-O executable signature', () => {
      const machoBuffer = Buffer.alloc(8);
      machoBuffer.writeUInt32BE(0xfeedface, 0);
      const scan = scanBufferForMalware(machoBuffer);
      assert.strictEqual(scan.safe, false);
      assert.ok(scan.reason?.includes('Mach-O'));
    });

    it('should reject EICAR antivirus test file', () => {
      const eicarBuffer = Buffer.from(
        'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'
      );
      const scan = scanBufferForMalware(eicarBuffer);
      assert.strictEqual(scan.safe, false);
      assert.ok(scan.reason?.includes('EICAR'));
    });

    it('should reject script injection and malicious formulas', () => {
      const scriptBuffer = Buffer.from('code,name\nWH-01,<script>alert("hack")</script>');
      const scan1 = scanBufferForMalware(scriptBuffer);
      assert.strictEqual(scan1.safe, false);

      const ddeBuffer = Buffer.from("code,name\nWH-01,=cmd|'/c calc'!A1");
      const scan2 = scanBufferForMalware(ddeBuffer);
      assert.strictEqual(scan2.safe, false);
    });
  });

  describe('Row Validation: validateImportRow', () => {
    it('should mark row as VALID when all required fields and formats are correct', () => {
      const template = TEMPLATE_DEFINITIONS.warehouses;
      const seen = new Set<string>();
      const raw = {
        code: 'WH-HCM-01',
        name: 'Kho Quận 1',
        contact_name: 'Nguyễn Văn A',
        contact_phone: '0901234567',
        contact_email: 'a@example.com',
        address_line: '123 Nguyễn Trãi',
        ward: 'Phường 2',
        district: 'Quận 5',
        city: 'TP. Hồ Chí Minh',
      };
      const res = validateImportRow(template, 1, raw, raw, seen);
      assert.strictEqual(res.status, 'VALID');
      assert.strictEqual(res.scopeIdentifier, 'WH-HCM-01');
      assert.strictEqual(res.issues.length, 0);
    });

    it('should mark row as ERROR with MISSING_SCOPE_IDENTIFIER when code is empty', () => {
      const template = TEMPLATE_DEFINITIONS.warehouses;
      const seen = new Set<string>();
      const raw = {
        code: '',
        name: 'Kho Không Mã',
        contact_name: 'Nguyễn Văn A',
        contact_phone: '0901234567',
        address_line: '123 Nguyễn Trãi',
        district: 'Quận 5',
        city: 'TP. Hồ Chí Minh',
      };
      const res = validateImportRow(template, 1, raw, raw, seen);
      assert.strictEqual(res.status, 'ERROR');
      assert.strictEqual(res.scopeIdentifier, null);
      assert.ok(
        res.issues.some((i) => i.code === 'MISSING_SCOPE_IDENTIFIER' && i.severity === 'BLOCKING')
      );
    });

    it('should mark row as ERROR with DUPLICATE_SCOPE_IDENTIFIER when code is repeated', () => {
      const template = TEMPLATE_DEFINITIONS.warehouses;
      const seen = new Set<string>();
      const raw1 = {
        code: 'WH-DUP-01',
        name: 'Kho 1',
        contact_name: 'A',
        contact_phone: '0901234567',
        contact_email: 'a@example.com',
        address_line: '123 ABC',
        ward: 'Phường 1',
        district: 'D1',
        city: 'HCM',
      };
      const raw2 = { ...raw1, name: 'Kho 2' };

      const res1 = validateImportRow(template, 1, raw1, raw1, seen);
      assert.strictEqual(res1.status, 'VALID');

      const res2 = validateImportRow(template, 2, raw2, raw2, seen);
      assert.strictEqual(res2.status, 'ERROR');
      assert.ok(
        res2.issues.some(
          (i) => i.code === 'DUPLICATE_SCOPE_IDENTIFIER' && i.severity === 'BLOCKING'
        )
      );
    });

    it('should mark row as ERROR when phone number format is invalid', () => {
      const template = TEMPLATE_DEFINITIONS.branches;
      const seen = new Set<string>();
      const raw = {
        code: 'BR-01',
        name: 'Chi Nhánh 1',
        contact_phone: '12345',
        address_line: '123 Đường Số 1',
        district: 'Quận 1',
        city: 'TP. Hồ Chí Minh',
      };
      const res = validateImportRow(template, 1, raw, raw, seen);
      assert.strictEqual(res.status, 'ERROR');
      assert.ok(res.issues.some((i) => i.code === 'INVALID_PHONE_FORMAT'));
    });

    it('should mark row as WARNING with DATA_INCOMPLETE when optional fields are missing', () => {
      const template = TEMPLATE_DEFINITIONS.branches;
      const seen = new Set<string>();
      const raw = {
        code: 'BR-02',
        name: 'Chi Nhánh 2',
        address_line: '456 Đường Số 2',
        district: 'Quận 2',
        city: 'TP. Hồ Chí Minh',
      };
      const res = validateImportRow(template, 1, raw, raw, seen);
      assert.strictEqual(res.status, 'WARNING');
      assert.ok(res.issues.some((i) => i.code === 'DATA_INCOMPLETE' && i.severity === 'WARNING'));
      assert.strictEqual(
        res.issues.some((i) => i.severity === 'BLOCKING'),
        false
      );
    });
  });

  describe('ImportsService Operations with Mocks', () => {
    it('should mask audit data removing plaintext PII', () => {
      const fakeService = new ImportsService({} as any, {} as any, {} as any);
      const masked = fakeService.maskAuditData({
        import_id: 'imp-1',
        contact_phone: '0901234567',
        contact_email: 'test@example.com',
        revision: 1,
      });

      assert.strictEqual(masked.import_id, 'imp-1');
      assert.strictEqual(masked.revision, 1);
      assert.notStrictEqual(masked.contact_phone, '0901234567');
      assert.notStrictEqual(masked.contact_email, 'test@example.com');
      assert.ok(masked.contact_phone.includes('***') || masked.contact_phone.includes('**'));
    });

    it('should enforce config MAX_IMPORT_FILE_SIZE_BYTES on upload', async () => {
      const mockConfig: any = {
        MAX_IMPORT_FILE_SIZE_BYTES: 100, // 100 bytes max
        ALLOWED_IMPORT_MIME_TYPES: ['text/csv'],
        MALWARE_SCANNER_ENABLED: true,
      };
      const service = new ImportsService({} as any, {} as any, mockConfig);
      const largeBuffer = Buffer.alloc(200); // 200 bytes

      await assert.rejects(
        async () => {
          await service.uploadAndProcess(
            'tenant-1',
            { userId: 'u1', merchantId: 'tenant-1', role: 'OWNER' } as any,
            { template_type: 'warehouses' },
            largeBuffer,
            'large.csv',
            'text/csv'
          );
        },
        (err: any) => {
          assert.strictEqual(err.status, HttpStatus.BAD_REQUEST);
          assert.strictEqual(err.code, 'FILE_TOO_LARGE');
          return true;
        }
      );
    });

    it('should enforce config ALLOWED_IMPORT_MIME_TYPES on upload', async () => {
      const mockConfig: any = {
        MAX_IMPORT_FILE_SIZE_BYTES: 10000,
        ALLOWED_IMPORT_MIME_TYPES: ['text/csv'],
        MALWARE_SCANNER_ENABLED: true,
      };
      const service = new ImportsService({} as any, {} as any, mockConfig);
      const buf = Buffer.from('test');

      await assert.rejects(
        async () => {
          await service.uploadAndProcess(
            'tenant-1',
            { userId: 'u1', merchantId: 'tenant-1', role: 'OWNER' } as any,
            { template_type: 'warehouses' },
            buf,
            'image.png',
            'image/png'
          );
        },
        (err: any) => {
          assert.strictEqual(err.status, HttpStatus.BAD_REQUEST);
          assert.strictEqual(err.code, 'INVALID_FILE_TYPE');
          return true;
        }
      );
    });

    it('should detect malware and reject upload when scanner is enabled', async () => {
      const mockConfig: any = {
        MAX_IMPORT_FILE_SIZE_BYTES: 10000,
        ALLOWED_IMPORT_MIME_TYPES: ['text/csv'],
        MALWARE_SCANNER_ENABLED: true,
      };
      const service = new ImportsService({} as any, {} as any, mockConfig);
      const eicarBuf = Buffer.from(
        'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'
      );

      await assert.rejects(
        async () => {
          await service.uploadAndProcess(
            'tenant-1',
            { userId: 'u1', merchantId: 'tenant-1', role: 'OWNER' } as any,
            { template_type: 'warehouses' },
            eicarBuf,
            'eicar.csv',
            'text/csv'
          );
        },
        (err: any) => {
          assert.strictEqual(err.status, HttpStatus.BAD_REQUEST);
          assert.strictEqual(err.code, 'MALWARE_DETECTED');
          return true;
        }
      );
    });

    it('should return existing import without duplicate work on identical file checksum (Decision 2)', async () => {
      const mockConfig: any = {
        MAX_IMPORT_FILE_SIZE_BYTES: 10000,
        ALLOWED_IMPORT_MIME_TYPES: ['text/csv'],
        MALWARE_SCANNER_ENABLED: false,
      };
      const existingImport = {
        id: 'imp-existing-1',
        merchant_id: 'tenant-1',
        template_type: 'warehouses',
        file_name: 'test.csv',
        file_size: 50,
        file_hash: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
        mime_type: 'text/csv',
        storage_path: 'local://test',
        status: 'STAGED',
        revision: 1,
        idempotency_key: null,
        total_rows: 1,
        valid_rows: 1,
        error_rows: 0,
        warning_rows: 0,
        control_totals: {},
        created_at: new Date(),
        updated_at: new Date(),
      };

      const mockPrisma: any = {
        import: {
          findFirst: async (args: any) => {
            if (args.where?.file_hash) return existingImport;
            return null;
          },
          findMany: async () => [existingImport],
        },
        importRow: {
          findMany: async () => [],
        },
      };

      const service = new ImportsService(mockPrisma, {} as any, mockConfig);
      const csvBuffer = Buffer.from('test');

      const res = await service.uploadAndProcess(
        'tenant-1',
        { userId: 'u1', merchantId: 'tenant-1', role: 'OWNER' } as any,
        { template_type: 'warehouses' },
        csvBuffer,
        'test.csv',
        'text/csv'
      );

      assert.strictEqual(res.statusCode, HttpStatus.OK);
      assert.strictEqual(res.data.import.id, 'imp-existing-1');
    });

    it('should throw 409 IDEMPOTENCY_CONFLICT when same key is used with different content (Decision 2)', async () => {
      const mockConfig: any = {
        MAX_IMPORT_FILE_SIZE_BYTES: 10000,
        ALLOWED_IMPORT_MIME_TYPES: ['text/csv'],
        MALWARE_SCANNER_ENABLED: false,
      };
      const mockPrisma: any = {
        import: {
          findFirst: async (args: any) => {
            if (args.where?.idempotency_key === 'key-dup') {
              return { id: 'imp-different-hash', file_hash: 'diff-hash' };
            }
            return null;
          },
        },
      };

      const service = new ImportsService(mockPrisma, {} as any, mockConfig);
      const buf = Buffer.from('code,name\nWH-01,Test');

      await assert.rejects(
        async () => {
          await service.uploadAndProcess(
            'tenant-1',
            { userId: 'u1', merchantId: 'tenant-1', role: 'OWNER' } as any,
            { template_type: 'warehouses' },
            buf,
            'test.csv',
            'text/csv',
            'key-dup'
          );
        },
        (err: any) => {
          assert.strictEqual(err.status, HttpStatus.CONFLICT);
          assert.strictEqual(err.code, 'IDEMPOTENCY_CONFLICT');
          return true;
        }
      );
    });

    it('should reject promotion if import status is BLOCKED (400 IMPORT_BLOCKED)', async () => {
      const mockPrisma: any = {
        import: {
          findFirst: async () => ({
            id: 'imp-blocked',
            merchant_id: 'tenant-1',
            template_type: 'warehouses',
            status: ImportStatus.BLOCKED,
            revision: 1,
          }),
        },
      };
      const service = new ImportsService(mockPrisma, {} as any, {} as any);

      await assert.rejects(
        async () => {
          await service.promoteImport('imp-blocked', 'tenant-1', {
            userId: 'u1',
            merchantId: 'tenant-1',
            role: 'OWNER',
          } as any);
        },
        (err: any) => {
          assert.strictEqual(err.status, HttpStatus.BAD_REQUEST);
          assert.strictEqual(err.code, 'IMPORT_BLOCKED');
          return true;
        }
      );
    });

    it('should reject promotion if import revision is not latest (400 REVISION_NOT_LATEST)', async () => {
      const mockPrisma: any = {
        import: {
          findFirst: async (args: any) => {
            if (args.where?.id === 'imp-old-rev') {
              return {
                id: 'imp-old-rev',
                merchant_id: 'tenant-1',
                template_type: 'warehouses',
                status: ImportStatus.STAGED,
                revision: 1,
              };
            }
            if (args.orderBy?.revision === 'desc') {
              return { revision: 2 }; // newer revision exists
            }
            return null;
          },
        },
      };
      const service = new ImportsService(mockPrisma, {} as any, {} as any);

      await assert.rejects(
        async () => {
          await service.promoteImport('imp-old-rev', 'tenant-1', {
            userId: 'u1',
            merchantId: 'tenant-1',
            role: 'OWNER',
          } as any);
        },
        (err: any) => {
          assert.strictEqual(err.status, HttpStatus.BAD_REQUEST);
          assert.strictEqual(err.code, 'REVISION_NOT_LATEST');
          return true;
        }
      );
    });

    it('should reject promotion if actor lacks warehouse scope for any row (403 WAREHOUSE_SCOPE_UNAUTHORIZED)', async () => {
      const mockPrisma: any = {
        import: {
          findFirst: async (args: any) => {
            if (args.where?.id === 'imp-wh-scope') {
              return {
                id: 'imp-wh-scope',
                merchant_id: 'tenant-1',
                template_type: 'warehouses',
                status: ImportStatus.STAGED,
                revision: 1,
              };
            }
            if (args.orderBy?.revision === 'desc') {
              return { revision: 1 };
            }
            return null;
          },
        },
        importRow: {
          findMany: async () => [
            {
              row_number: 1,
              status: 'VALID',
              scope_identifier: 'WH-01',
              normalized_data: { name: 'Kho 1' },
            },
            {
              row_number: 2,
              status: 'VALID',
              scope_identifier: 'WH-02',
              normalized_data: { name: 'Kho 2' },
            },
          ],
        },
        user: {
          findFirst: async () => ({
            role: 'OPS_CSKH',
            warehouse_scopes: ['WH-01'], // Actor only has scope for WH-01! Lacks WH-02!
            store_scopes: [],
          }),
        },
      };
      const service = new ImportsService(mockPrisma, {} as any, {} as any);

      await assert.rejects(
        async () => {
          await service.promoteImport('imp-wh-scope', 'tenant-1', {
            userId: 'u-scoped',
            merchantId: 'tenant-1',
            role: 'OPS_CSKH',
          } as any);
        },
        (err: any) => {
          assert.strictEqual(err.status, HttpStatus.FORBIDDEN);
          assert.strictEqual(err.code, 'WAREHOUSE_SCOPE_UNAUTHORIZED');
          const resp = err.getResponse() as any;
          assert.ok(resp.error.message.includes('WH-02'));
          return true;
        }
      );
    });

    it('should reject promotion if actor lacks branch scope for any row (403 SCOPE_UNAUTHORIZED)', async () => {
      const mockPrisma: any = {
        import: {
          findFirst: async (args: any) => {
            if (args.where?.id === 'imp-br-scope') {
              return {
                id: 'imp-br-scope',
                merchant_id: 'tenant-1',
                template_type: 'branches',
                status: ImportStatus.STAGED,
                revision: 1,
              };
            }
            if (args.orderBy?.revision === 'desc') {
              return { revision: 1 };
            }
            return null;
          },
        },
        importRow: {
          findMany: async () => [
            {
              row_number: 1,
              status: 'VALID',
              scope_identifier: 'BR-01',
              normalized_data: { name: 'Chi nhánh 1' },
            },
            {
              row_number: 2,
              status: 'VALID',
              scope_identifier: 'BR-UNAUTHORIZED',
              normalized_data: { name: 'Chi nhánh 2' },
            },
          ],
        },
        user: {
          findFirst: async () => ({
            role: 'OPS_CSKH',
            store_scopes: ['BR-01'], // Lacks BR-UNAUTHORIZED
            warehouse_scopes: [],
          }),
        },
      };
      const service = new ImportsService(mockPrisma, {} as any, {} as any);

      await assert.rejects(
        async () => {
          await service.promoteImport('imp-br-scope', 'tenant-1', {
            userId: 'u-scoped',
            merchantId: 'tenant-1',
            role: 'OPS_CSKH',
          } as any);
        },
        (err: any) => {
          assert.strictEqual(err.status, HttpStatus.FORBIDDEN);
          assert.strictEqual(err.code, 'SCOPE_UNAUTHORIZED');
          const resp = err.getResponse() as any;
          assert.ok(resp.error.message.includes('BR-UNAUTHORIZED'));
          return true;
        }
      );
    });

    it('should promote revision, mark older PROMOTED as SUPERSEDED, and write audit log', async () => {
      let auditLogCreated: any = null;
      let importUpdated: any = null;
      let supersededCalled = false;
      let upsertedCount = 0;

      const mockPrisma: any = {
        import: {
          findFirst: async (args: any) => {
            if (args.where?.id === 'imp-promote-ok') {
              return {
                id: 'imp-promote-ok',
                merchant_id: 'tenant-1',
                template_type: 'warehouses',
                file_name: 'test.csv',
                file_hash: 'hash-ok',
                status: ImportStatus.STAGED,
                revision: 2,
              };
            }
            if (args.orderBy?.revision === 'desc') {
              return { revision: 2 };
            }
            return null;
          },
          count: async () => 1,
        },
        importRow: {
          findMany: async () => [
            {
              row_number: 1,
              status: 'VALID',
              scope_identifier: 'WH-01',
              normalized_data: {
                name: 'Kho Tân Bình',
                status: 'active',
                is_default: true,
                contact_name: 'Nguyễn Văn A',
                contact_phone: '0901234567',
                contact_email: 'a@example.com',
                address_line: '55 Cộng Hòa',
                district: 'Tân Bình',
                city: 'TP.HCM',
              },
            },
          ],
        },
        user: {
          findFirst: async () => ({
            role: 'OWNER',
            warehouse_scopes: ['*'],
            store_scopes: ['*'],
          }),
        },
        $transaction: async (cb: any) => {
          const tx: any = {
            warehouse: {
              updateMany: async () => {},
              upsert: async () => {
                upsertedCount++;
              },
            },
            import: {
              update: async (args: any) => {
                importUpdated = args;
              },
              updateMany: async () => {
                supersededCalled = true;
              },
            },
            auditLog: {
              create: async (args: any) => {
                auditLogCreated = args;
              },
            },
          };
          return cb(tx);
        },
      };

      const service = new ImportsService(mockPrisma, {} as any, {} as any);

      const result = await service.promoteImport('imp-promote-ok', 'tenant-1', {
        userId: 'owner-id',
        merchantId: 'tenant-1',
        role: 'OWNER',
      } as any);

      assert.strictEqual(result.data.status, ImportStatus.PROMOTED);
      assert.strictEqual(result.data.promoted_rows_count, 1);
      assert.strictEqual(upsertedCount, 1);
      assert.strictEqual(supersededCalled, true);
      assert.ok(importUpdated);
      assert.strictEqual(importUpdated.data.status, ImportStatus.PROMOTED);
      assert.ok(auditLogCreated);
      assert.strictEqual(auditLogCreated.data.action, 'IMPORT_PROMOTED');
      assert.strictEqual(auditLogCreated.data.merchant_id, 'tenant-1');
    });
  });
});
