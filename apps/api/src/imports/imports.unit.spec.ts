import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import * as zlib from 'node:zlib';
import { HttpStatus } from '@nestjs/common';
import {
  parseCsv,
  generateCsv,
  parseXlsx,
  generateXlsxTemplate,
  createZipArchive,
  unpackZipArchive,
  calculateFileHash,
  scanBufferForMalware,
  normalizeRowsWithTemplate,
  DuplicateHeaderMappingError,
} from './imports.parser';
import { TEMPLATE_DEFINITIONS } from './imports.constants';
import { validateUploadImportDto, validateImportRow } from './imports.dto';
import { ImportsService } from './imports.service';
import { CanonicalApiException } from '../auth/auth.service';
import { ImportStatus, ImportAuditEvent } from '@shipde/contracts';

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

      // Verify PKZIP CRC-32 is not 0 (Finding 5)
      const crc32 = xlsxBuffer.readUInt32LE(14);
      assert.notStrictEqual(crc32, 0, 'PKZIP local header must have a valid non-zero CRC-32');

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

  describe('Parser regression: ZIP integrity, sparse-cell bounds, and structural row preservation', () => {
    // Builds a minimal ZIP using the STORED (method 0) compression so the test can
    // independently control the recorded CRC-32 / uncompressed size fields.
    function buildStoredZip(
      files: Array<{ name: string; data: Buffer }>,
      overrides?: { corruptCrc?: boolean; wrongUncompSize?: number }
    ): Buffer {
      const parts: Buffer[] = [];
      const cdEntries: Buffer[] = [];
      let offset = 0;
      for (const file of files) {
        const nameBuf = Buffer.from(file.name, 'utf8');
        let crc = zlib.crc32(file.data) >>> 0;
        let uncompSize = file.data.length;
        if (overrides?.corruptCrc) crc = (crc ^ 0xdeadbeef) >>> 0;
        if (overrides?.wrongUncompSize !== undefined) uncompSize = overrides.wrongUncompSize;

        const lh = Buffer.alloc(30);
        lh.writeUInt32LE(0x04034b50, 0);
        lh.writeUInt16LE(20, 4);
        lh.writeUInt16LE(0, 6);
        lh.writeUInt16LE(0, 8); // stored
        lh.writeUInt32LE(crc, 14);
        lh.writeUInt32LE(file.data.length, 18);
        lh.writeUInt32LE(uncompSize, 22);
        lh.writeUInt16LE(nameBuf.length, 26);
        const localEntry = Buffer.concat([lh, nameBuf, file.data]);
        parts.push(localEntry);

        const cd = Buffer.alloc(46);
        cd.writeUInt32LE(0x02014b50, 0);
        cd.writeUInt16LE(20, 4);
        cd.writeUInt16LE(20, 6);
        cd.writeUInt16LE(0, 8);
        cd.writeUInt16LE(0, 10);
        cd.writeUInt32LE(crc, 16);
        cd.writeUInt32LE(file.data.length, 20);
        cd.writeUInt32LE(uncompSize, 24);
        cd.writeUInt16LE(nameBuf.length, 28);
        cd.writeUInt32LE(offset, 42);
        cdEntries.push(Buffer.concat([cd, nameBuf]));
        offset += localEntry.length;
      }
      const cdBuf = Buffer.concat(cdEntries);
      const eocd = Buffer.alloc(22);
      eocd.writeUInt32LE(0x06054b50, 0);
      eocd.writeUInt16LE(files.length, 8);
      eocd.writeUInt16LE(files.length, 10);
      eocd.writeUInt32LE(cdBuf.length, 12);
      eocd.writeUInt32LE(offset, 16);
      return Buffer.concat([...parts, cdBuf, eocd]);
    }

    function sheetXml(sheetRows: string): string {
      return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${sheetRows}</sheetData>
</worksheet>`;
    }

    const cleanSheet = sheetXml(
      '<row r="1"><c r="A1" t="inlineStr"><is><t>code</t></is></c><c r="B1" t="inlineStr"><is><t>name</t></is></c></row>' +
        '<row r="2"><c r="A2" t="inlineStr"><is><t>WH-01</t></is></c><c r="B2" t="inlineStr"><is><t>Kho Test</t></is></c></row>'
    );

    it('should accept a stored ZIP entry whose CRC-32 and size are independently valid', () => {
      const buf = buildStoredZip([{ name: 'xl/worksheets/sheet1.xml', data: Buffer.from(cleanSheet) }]);
      const parsed = parseXlsx(buf);
      assert.strictEqual(parsed.headers[0], 'code');
      assert.strictEqual(parsed.rows[0].code, 'WH-01');
    });

    it('should reject a ZIP entry whose recorded CRC-32 does not match the content', () => {
      const buf = buildStoredZip(
        [{ name: 'xl/worksheets/sheet1.xml', data: Buffer.from(cleanSheet) }],
        { corruptCrc: true }
      );
      assert.throws(() => parseXlsx(buf), (err: any) => /CRC-32/.test(err.message));
    });

    it('should reject a ZIP entry whose declared uncompressed size does not match', () => {
      const buf = buildStoredZip(
        [{ name: 'xl/worksheets/sheet1.xml', data: Buffer.from(cleanSheet) }],
        { wrongUncompSize: Buffer.from(cleanSheet).length + 4 }
      );
      assert.throws(() => parseXlsx(buf), (err: any) => /size mismatch/.test(err.message));
    });

    it('should reject a tiny XLSX with an out-of-bounds sparse cell reference (memory exhaustion)', () => {
      const maliciousSheet = sheetXml(
        '<row r="1"><c r="A1" t="inlineStr"><is><t>code</t></is></c></row>' +
          '<row r="2"><c r="ZZZZZZ1" t="inlineStr"><is><t>x</t></is></c></row>'
      );
      const buf = createZipArchive([
        { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(maliciousSheet) },
      ]);
      assert.throws(() => parseXlsx(buf), (err: any) => /maximum supported column/.test(err.message));
    });

    it('should reject an XLSX sheet whose total cell count exceeds the bound', () => {
      // 300 rows x 400 cells = 120,000 cells > 100,000 bound.
      let rows = '';
      for (let r = 1; r <= 300; r++) {
        let cells = '';
        for (let c = 0; c < 400; c++) {
          const letters =
            String.fromCharCode(Math.floor(c / 26) + 65) + String.fromCharCode((c % 26) + 65);
          cells += `<c r="${letters}${r}"/>`;
        }
        rows += `<row r="${r}">${cells}</row>`;
      }
      const buf = createZipArchive([
        { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheetXml(rows)) },
      ]);
      assert.throws(() => parseXlsx(buf), (err: any) => /too many cells/.test(err.message));
    });

    it('should reject a ZIP archive with more entries than the bound (MAX_ZIP_ENTRIES)', () => {
      const files = Array.from({ length: 105 }, (_, i) => ({
        name: `file_${i}.txt`,
        data: Buffer.from(`entry ${i}`),
      }));
      const buf = createZipArchive(files);
      assert.throws(() => unpackZipArchive(buf), (err: any) => /too many files/.test(err.message));
    });

    it('should reject a ZIP entry claiming uncompressed size exceeding MAX_UNCOMPRESSED_ENTRY_SIZE', () => {
      const buf = buildStoredZip(
        [{ name: 'huge.txt', data: Buffer.from('small content') }],
        { wrongUncompSize: 11 * 1024 * 1024 }
      );
      assert.throws(
        () => unpackZipArchive(buf),
        (err: any) => /exceeds maximum allowed uncompressed size/.test(err.message)
      );
    });

    it('should preserve a CSV row whose declared columns are empty but carries a surplus value', () => {
      // Header width 2; the data row has its declared columns empty and a 3rd value.
      const parsed = parseCsv('code,name\n,,surplus-value');
      assert.strictEqual(parsed.rows.length, 1, 'Row must not disappear from parsing');
      assert.strictEqual(parsed.rows[0].code, '');
      assert.strictEqual(parsed.rows[0].name, '');
      assert.strictEqual(parsed.rows[0].__extra_2, 'surplus-value');
    });

    it('should keep well-formed CSV rows and headers unchanged when preserving surplus values', () => {
      const parsed = parseCsv('code,name\nWH-01,Kho A\nWH-02,Kho B');
      assert.strictEqual(parsed.rows.length, 2);
      assert.strictEqual(parsed.rows[0].code, 'WH-01');
      assert.strictEqual(parsed.rows[1].name, 'Kho B');
      assert.ok(!('__extra_2' in parsed.rows[0]));
    });

    it('should flag rows wider than the CSV field bound with a bounded overflow marker', () => {
      const wideRow = Array(10_002).fill('x').join(',');
      const parsed = parseCsv(`code,name\n${wideRow}`);
      assert.strictEqual(parsed.rows.length, 1);
      assert.strictEqual(parsed.rows[0].__extra_overflow, '1');
      assert.ok(
        Object.keys(parsed.rows[0]).filter((k) => k.startsWith('__extra_')).length <= 11,
        'Retained surplus columns must be bounded'
      );
    });

    it('should reject CSV files with more rows than the parsing bound', () => {
      const rows = Array.from({ length: 50_000 }, (_, i) => `WH-${i},Name ${i}`).join('\n');
      assert.throws(() => parseCsv(`code,name\n${rows}`), (err: any) => /too many rows/.test(err.message));
    });

    it('should preserve XLSX surplus cells beyond the header width', () => {
      const sheet = sheetXml(
        '<row r="1"><c r="A1" t="inlineStr"><is><t>code</t></is></c><c r="B1" t="inlineStr"><is><t>name</t></is></c></row>' +
          '<row r="2"><c r="A2" t="inlineStr"><is><t>WH-01</t></is></c><c r="B2" t="inlineStr"><is><t>Kho</t></is></c><c r="C2" t="inlineStr"><is><t>surplus-xlsx</t></is></c></row>'
      );
      const buf = createZipArchive([
        { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheet) },
      ]);
      const parsed = parseXlsx(buf);
      assert.strictEqual(parsed.rows[0].__extra_2, 'surplus-xlsx');
    });

    it('should reject ambiguous header mappings where two columns supply one template field', () => {
      const template = TEMPLATE_DEFINITIONS.branches;
      assert.throws(
        () =>
          normalizeRowsWithTemplate(
            template,
            ['code', 'Mã chi nhánh', 'name', 'address_line', 'district', 'city'],
            [{ code: 'BR-01', 'Mã chi nhánh': 'BR-OTHER', name: 'CN 1', address_line: '123 A', district: 'Q1', city: 'HCM' }]
          ),
        (err: any) => err instanceof DuplicateHeaderMappingError
      );
    });

    it('should not flag a single diacritic-free alias as ambiguous', () => {
      const template = TEMPLATE_DEFINITIONS.branches;
      const { normalizedRows } = normalizeRowsWithTemplate(
        template,
        ['Ma chi nhanh', 'Ten chi nhanh', 'address_line', 'district', 'city'],
        [{ 'Ma chi nhanh': 'BR-01', 'Ten chi nhanh': 'CN 1', address_line: '123 A', district: 'Q1', city: 'HCM' }]
      );
      assert.strictEqual(normalizedRows[0].mappedData.code, 'BR-01');
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

    it('should mark a row with surplus columns as ERROR with a blocking structural EXTRA_COLUMNS issue', () => {
      const template = TEMPLATE_DEFINITIONS.warehouses;
      const seen = new Set<string>();
      const raw = {
        code: 'WH-X1',
        name: 'Kho Có Cột Phụ',
        contact_name: 'Nguyễn Văn A',
        contact_phone: '0901234567',
        address_line: '123 Nguyễn Trãi',
        district: 'Quận 5',
        city: 'TP. Hồ Chí Minh',
        __extra_7: 'du-lieu-vuot-header',
      };
      const res = validateImportRow(template, 1, raw, raw, seen);
      assert.strictEqual(res.status, 'ERROR');
      const extraIssue = res.issues.find((i) => i.code === 'EXTRA_COLUMNS');
      assert.ok(extraIssue, 'EXTRA_COLUMNS structural issue must be reported');
      assert.strictEqual(extraIssue!.severity, 'BLOCKING');
    });

    it('should surface a missing-identifier error (not silent disappearance) for a row whose declared columns are all empty but has surplus data', () => {
      const template = TEMPLATE_DEFINITIONS.warehouses;
      const seen = new Set<string>();
      const raw = {
        code: '',
        name: '',
        contact_name: '',
        contact_phone: '',
        address_line: '',
        district: '',
        city: '',
        __extra_3: 'du-lieu-ngoai-header',
      };
      const res = validateImportRow(template, 2, raw, raw, seen);
      assert.strictEqual(res.status, 'ERROR');
      assert.ok(
        res.issues.some(
          (i) => i.code === 'MISSING_SCOPE_IDENTIFIER' && i.severity === 'BLOCKING'
        )
      );
      assert.ok(res.issues.some((i) => i.code === 'EXTRA_COLUMNS'));
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

    it('should reject claimed MIME text/csv-unapproved when allowlist allows text/csv (exact match, Finding 4)', async () => {
      const mockConfig: any = {
        MAX_IMPORT_FILE_SIZE_BYTES: 10000,
        ALLOWED_IMPORT_MIME_TYPES: ['text/csv'],
        MALWARE_SCANNER_ENABLED: false,
      };
      const service = new ImportsService({} as any, {} as any, mockConfig);
      await assert.rejects(
        async () => {
          await service.uploadAndProcess(
            'tenant-1',
            { userId: 'u1', merchantId: 'tenant-1', role: 'OWNER' } as any,
            { template_type: 'warehouses' },
            Buffer.from('code,name\nWH-01,Kho A'),
            'file.csv',
            'text/csv-unapproved'
          );
        },
        (err: any) => {
          assert.strictEqual(err.status, HttpStatus.BAD_REQUEST);
          assert.strictEqual(err.code, 'INVALID_FILE_TYPE');
          return true;
        }
      );
    });

    it('should reject extension and MIME mismatch (e.g. .csv with xlsx MIME or .xlsx with csv MIME)', async () => {
      const mockConfig: any = {
        MAX_IMPORT_FILE_SIZE_BYTES: 10000,
        ALLOWED_IMPORT_MIME_TYPES: [
          'text/csv',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ],
        MALWARE_SCANNER_ENABLED: false,
      };
      const service = new ImportsService({} as any, {} as any, mockConfig);
      await assert.rejects(
        async () => {
          await service.uploadAndProcess(
            'tenant-1',
            { userId: 'u1', merchantId: 'tenant-1', role: 'OWNER' } as any,
            { template_type: 'warehouses' },
            Buffer.from('code,name\nWH-01,Kho A'),
            'file.csv',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          );
        },
        (err: any) => {
          assert.strictEqual(err.status, HttpStatus.BAD_REQUEST);
          assert.strictEqual(err.code, 'INVALID_FILE_TYPE');
          return true;
        }
      );
    });

    it('should detect and reject deflated EICAR malware inside an XLSX entry (Finding 7)', async () => {
      const mockConfig: any = {
        MAX_IMPORT_FILE_SIZE_BYTES: 100000,
        ALLOWED_IMPORT_MIME_TYPES: [
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ],
        MALWARE_SCANNER_ENABLED: true,
      };
      const service = new ImportsService({} as any, {} as any, mockConfig);
      const eicarPayload = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
      const maliciousXlsx = createZipArchive([
        {
          name: 'xl/worksheets/sheet1.xml',
          data: Buffer.from(
            '<?xml version="1.0" encoding="UTF-8"?><worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>code</t></is></c></row></sheetData></worksheet>'
          ),
        },
        {
          name: 'xl/drawings/payload.xml',
          data: Buffer.from(eicarPayload),
        },
      ]);

      await assert.rejects(
        async () => {
          await service.uploadAndProcess(
            'tenant-1',
            { userId: 'u1', merchantId: 'tenant-1', role: 'OWNER' } as any,
            { template_type: 'warehouses' },
            maliciousXlsx,
            'workbook.xlsx',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          );
        },
        (err: any) => {
          assert.strictEqual(err.status, HttpStatus.BAD_REQUEST);
          assert.strictEqual(err.code, 'MALWARE_DETECTED');
          const resp = err.getResponse() as any;
          assert.ok(resp?.error?.message?.includes('xl/drawings/payload.xml'));
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
        $transaction: async (cb: any) => cb(mockPrisma),
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
        $transaction: async (cb: any) => cb(mockPrisma),
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

    it('should bind newly supplied idempotency key on replay and reject different content with that key (Finding 6)', async () => {
      const mockConfig: any = {
        MAX_IMPORT_FILE_SIZE_BYTES: 10000,
        ALLOWED_IMPORT_MIME_TYPES: ['text/csv'],
        MALWARE_SCANNER_ENABLED: false,
      };
      const dbImports: any[] = [];
      const contentA = Buffer.from('code,name\nWH-01,Content A');
      const hashA = calculateFileHash(contentA);
      const contentB = Buffer.from('code,name\nWH-01,Content B');

      const mockPrisma: any = {
        import: {
          findFirst: async (args: any) => {
            if (args.where?.idempotency_key && args.where?.file_hash?.not) {
              return (
                dbImports.find(
                  (i) =>
                    i.merchant_id === args.where.merchant_id &&
                    i.idempotency_key === args.where.idempotency_key &&
                    i.file_hash !== args.where.file_hash.not
                ) || null
              );
            }
            if (args.where?.idempotency_key) {
              return (
                dbImports.find(
                  (i) =>
                    i.merchant_id === args.where.merchant_id &&
                    i.idempotency_key === args.where.idempotency_key
                ) || null
              );
            }
            if (args.where?.file_hash) {
              return (
                dbImports.find(
                  (i) =>
                    i.merchant_id === args.where.merchant_id &&
                    i.file_hash === args.where.file_hash
                ) || null
              );
            }
            return null;
          },
          create: async (args: any) => {
            const record = {
              id: `imp-${dbImports.length + 1}`,
              created_at: new Date(),
              updated_at: new Date(),
              ...args.data,
            };
            dbImports.push(record);
            return record;
          },
          update: async (args: any) => {
            const found = dbImports.find((i) => i.id === args.where.id);
            if (found) {
              Object.assign(found, args.data);
            }
            return found;
          },
          findMany: async () => dbImports,
        },
        importRow: {
          findMany: async () => [],
        },
        auditLog: {
          create: async () => {},
        },
        $transaction: async (cb: any) => cb(mockPrisma),
      };

      const mockStorage: any = {
        putObject: async (key: string) => `local://${key}`,
      };

      const service = new ImportsService(mockPrisma, mockStorage, mockConfig);

      // Step 1: Upload content A with K1
      const res1 = await service.uploadAndProcess(
        'tenant-1',
        { userId: 'u1', merchantId: 'tenant-1', role: 'OWNER' } as any,
        { template_type: 'warehouses' },
        contentA,
        'a.csv',
        'text/csv',
        'K1'
      );
      assert.strictEqual(res1.statusCode, HttpStatus.ACCEPTED);
      assert.strictEqual(dbImports[0].idempotency_key, 'K1');

      // Step 2: Replay content A with K2 -> should bind K2
      const res2 = await service.uploadAndProcess(
        'tenant-1',
        { userId: 'u1', merchantId: 'tenant-1', role: 'OWNER' } as any,
        { template_type: 'warehouses' },
        contentA,
        'a.csv',
        'text/csv',
        'K2'
      );
      assert.strictEqual(res2.statusCode, HttpStatus.OK);

      // Verify K2 was bound in dbImports
      const k2Bound = dbImports.some((i) => i.idempotency_key === 'K2' && i.file_hash === hashA);
      assert.ok(k2Bound, 'K2 must be persisted and associated with content A');

      // Step 3: Upload different content B with K2 -> MUST throw 409 IDEMPOTENCY_CONFLICT
      await assert.rejects(
        async () => {
          await service.uploadAndProcess(
            'tenant-1',
            { userId: 'u1', merchantId: 'tenant-1', role: 'OWNER' } as any,
            { template_type: 'warehouses' },
            contentB,
            'b.csv',
            'text/csv',
            'K2'
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
        $transaction: async (cb: any) => cb(mockPrisma),
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
        $transaction: async (cb: any) => cb(mockPrisma),
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
          update: async () => ({}),
          updateMany: async () => ({ count: 0 }),
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
        $transaction: async (cb: any) => cb(mockPrisma),
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
          update: async () => ({}),
          updateMany: async () => ({ count: 0 }),
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
        $transaction: async (cb: any) => cb(mockPrisma),
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
            ...mockPrisma,
            warehouse: {
              count: async () => 1,
              findMany: async () => [],
              findUnique: async () => null,
              updateMany: async () => {},
              upsert: async () => {
                upsertedCount++;
              },
            },
            import: {
              ...mockPrisma.import,
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

    it('should reject promotion when multiple rows have is_default=true (BR-BRANCH-03)', async () => {
      const mockPrisma: any = {
        import: {
          findFirst: async (args: any) => {
            if (args.where?.id === 'imp-multi-default') {
              return {
                id: 'imp-multi-default',
                merchant_id: 'tenant-1',
                template_type: 'branches',
                file_name: 'test.csv',
                file_hash: 'hash-ok',
                status: ImportStatus.STAGED,
                revision: 1,
              };
            }
            if (args.orderBy?.revision === 'desc') {
              return { revision: 1 };
            }
            return null;
          },
          update: async () => ({}),
          updateMany: async () => ({ count: 0 }),
        },
        importRow: {
          findMany: async () => [
            {
              row_number: 1,
              status: 'VALID',
              scope_identifier: 'BR-01',
              normalized_data: { name: 'CN 1', is_default: true },
            },
            {
              row_number: 2,
              status: 'VALID',
              scope_identifier: 'BR-02',
              normalized_data: { name: 'CN 2', is_default: true },
            },
          ],
        },
        user: {
          findFirst: async () => ({
            role: 'OWNER',
            store_scopes: ['*'],
            warehouse_scopes: ['*'],
          }),
        },
        $transaction: async (cb: any) => cb(mockPrisma),
      };

      const service = new ImportsService(mockPrisma, {} as any, {} as any);

      await assert.rejects(
        async () => {
          await service.promoteImport('imp-multi-default', 'tenant-1', {
            userId: 'u1',
            merchantId: 'tenant-1',
            role: 'OWNER',
          } as any);
        },
        (err: any) => {
          assert.strictEqual(err.status, HttpStatus.BAD_REQUEST);
          assert.strictEqual(err.code, 'MULTIPLE_DEFAULT_BRANCHES');
          return true;
        }
      );
    });

    it('should assign first branch as default on initial branch import with multiple rows and no explicit default (Finding 2)', async () => {
      const upsertedBranches: any[] = [];
      const mockPrisma: any = {
        import: {
          findFirst: async (args: any) => {
            if (args.where?.id === 'imp-initial-branches') {
              return {
                id: 'imp-initial-branches',
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
          update: async () => ({}),
          updateMany: async () => ({ count: 0 }),
        },
        importRow: {
          findMany: async () => [
            {
              row_number: 1,
              status: 'VALID',
              scope_identifier: 'BR-01',
              normalized_data: { name: 'CN 1' },
            },
            {
              row_number: 2,
              status: 'VALID',
              scope_identifier: 'BR-02',
              normalized_data: { name: 'CN 2' },
            },
          ],
        },
        user: {
          findFirst: async () => ({
            role: 'OWNER',
            store_scopes: ['*'],
            warehouse_scopes: ['*'],
          }),
        },
        branch: {
          findMany: async () => [],
          count: async (args: any) => {
            if (args.where?.status === 'ACTIVE' && args.where?.is_default) {
              return upsertedBranches.filter((b) => b.is_default).length;
            }
            return upsertedBranches.length;
          },
          upsert: async (args: any) => {
            upsertedBranches.push(args.create);
            return { id: `br-${upsertedBranches.length}`, ...args.create };
          },
          update: async () => {},
          updateMany: async () => {},
        },
        auditLog: {
          create: async () => {},
        },
        $transaction: async (cb: any) => cb(mockPrisma),
      };

      const service = new ImportsService(mockPrisma, {} as any, {} as any);
      const res = await service.promoteImport('imp-initial-branches', 'tenant-1', {
        userId: 'u1',
        merchantId: 'tenant-1',
        role: 'OWNER',
      } as any);

      assert.strictEqual(res.data.status, ImportStatus.PROMOTED);
      assert.strictEqual(upsertedBranches.length, 2);
      assert.strictEqual(upsertedBranches[0].code, 'BR-01');
      assert.strictEqual(upsertedBranches[0].is_default, true);
      assert.strictEqual(upsertedBranches[1].code, 'BR-02');
      assert.strictEqual(upsertedBranches[1].is_default, false);
    });

    it('should reject promotion if actor has empty store_scopes (403 SCOPE_UNAUTHORIZED)', async () => {
      const mockPrisma: any = {
        import: {
          findFirst: async () => ({
            id: 'imp-br',
            merchant_id: 'tenant-1',
            template_type: 'branches',
            status: ImportStatus.STAGED,
            revision: 1,
          }),
        },
        importRow: {
          findMany: async () => [
            { row_number: 1, status: 'VALID', scope_identifier: 'BR-01', normalized_data: { name: 'CN 1' } },
          ],
        },
        user: {
          findFirst: async () => ({
            role: 'OPS_CSKH',
            store_scopes: [],
            warehouse_scopes: [],
          }),
        },
        $transaction: async (cb: any) => cb(mockPrisma),
      };

      const service = new ImportsService(mockPrisma, {} as any, {} as any);
      await assert.rejects(
        async () => {
          await service.promoteImport('imp-br', 'tenant-1', {
            userId: 'u-empty',
            merchantId: 'tenant-1',
            role: 'OPS_CSKH',
          } as any);
        },
        (err: any) => {
          assert.strictEqual(err.status, HttpStatus.FORBIDDEN);
          assert.strictEqual(err.code, 'SCOPE_UNAUTHORIZED');
          return true;
        }
      );
    });

    it('should reject promotion if OWNER has empty store_scopes proving no OWNER bypass', async () => {
      const mockPrisma: any = {
        import: {
          findFirst: async () => ({
            id: 'imp-br-owner',
            merchant_id: 'tenant-1',
            template_type: 'branches',
            status: ImportStatus.STAGED,
            revision: 1,
          }),
        },
        importRow: {
          findMany: async () => [
            { row_number: 1, status: 'VALID', scope_identifier: 'BR-01', normalized_data: { name: 'CN 1' } },
          ],
        },
        user: {
          findFirst: async () => ({
            role: 'OWNER',
            store_scopes: [],
            warehouse_scopes: [],
          }),
        },
        $transaction: async (cb: any) => cb(mockPrisma),
      };

      const service = new ImportsService(mockPrisma, {} as any, {} as any);
      await assert.rejects(
        async () => {
          await service.promoteImport('imp-br-owner', 'tenant-1', {
            userId: 'u-owner-empty',
            merchantId: 'tenant-1',
            role: 'OWNER',
          } as any);
        },
        (err: any) => {
          assert.strictEqual(err.status, HttpStatus.FORBIDDEN);
          assert.strictEqual(err.code, 'SCOPE_UNAUTHORIZED');
          return true;
        }
      );
    });

    it('should reject promotion if actor lacks scope for displaced default branch (403 SCOPE_UNAUTHORIZED)', async () => {
      const mockPrisma: any = {
        import: {
          findFirst: async () => ({
            id: 'imp-br-displace',
            merchant_id: 'tenant-1',
            template_type: 'branches',
            status: ImportStatus.STAGED,
            revision: 1,
          }),
        },
        importRow: {
          findMany: async () => [
            { row_number: 1, status: 'VALID', scope_identifier: 'BR-02', normalized_data: { name: 'CN 2', is_default: true } },
          ],
        },
        branch: {
          findMany: async () => [
            { id: 'br-1', code: 'BR-01', name: 'CN 1', is_default: true, status: 'ACTIVE' },
          ],
        },
        user: {
          findFirst: async () => ({
            role: 'OPS_CSKH',
            store_scopes: ['BR-02'],
            warehouse_scopes: [],
          }),
        },
        $transaction: async (cb: any) => cb(mockPrisma),
      };

      const service = new ImportsService(mockPrisma, {} as any, {} as any);
      await assert.rejects(
        async () => {
          await service.promoteImport('imp-br-displace', 'tenant-1', {
            userId: 'u-displace',
            merchantId: 'tenant-1',
            role: 'OPS_CSKH',
          } as any);
        },
        (err: any) => {
          assert.strictEqual(err.status, HttpStatus.FORBIDDEN);
          assert.strictEqual(err.code, 'SCOPE_UNAUTHORIZED');
          const resp = err.getResponse() as any;
          assert.ok(resp?.error?.message?.includes('BR-01'));
          return true;
        }
      );
    });

    it('should preserve warehouse fields on partial warehouse update and record correlationId in audit log', async () => {
      let updatedWhData: any = null;
      const capturedAuditLogs: any[] = [];

      const existingWarehouse = {
        id: 'wh-1',
        merchant_id: 'tenant-1',
        code: 'WH-01',
        name: 'Kho Gốc',
        status: 'active',
        is_default: true,
        contact_name: 'Nguyễn Văn Cũ',
        contact_phone: '0901111111',
        contact_email: 'cu@example.com',
        address_line: '123 Đường Cũ',
        ward: 'Phường 1',
        district: 'Quận 1',
        city: 'TP.HCM',
        postal_code: '700000',
        cutoff_time: '17:00',
      };

      const mockPrisma: any = {
        import: {
          findFirst: async () => ({
            id: 'imp-wh-partial',
            merchant_id: 'tenant-1',
            template_type: 'warehouses',
            status: ImportStatus.STAGED,
            revision: 1,
          }),
          update: async () => ({}),
          updateMany: async () => ({ count: 0 }),
        },
        importRow: {
          findMany: async () => [
            {
              row_number: 1,
              status: 'VALID',
              scope_identifier: 'WH-01',
              normalized_data: {
                name: 'Kho Mới Đổi Tên',
                contact_phone: '0909999999',
              },
            },
          ],
        },
        user: {
          findFirst: async () => ({
            role: 'OWNER',
            store_scopes: ['*'],
            warehouse_scopes: ['*'],
          }),
        },
        warehouse: {
          findMany: async () => [existingWarehouse],
          count: async () => 1,
          update: async (args: any) => {
            updatedWhData = args.data;
            return { ...existingWarehouse, ...args.data };
          },
        },
        auditLog: {
          create: async (args: any) => {
            capturedAuditLogs.push(args.data);
          },
        },
        $transaction: async (cb: any) => cb(mockPrisma),
      };

      const service = new ImportsService(mockPrisma, {} as any, {} as any);
      await service.promoteImport(
        'imp-wh-partial',
        'tenant-1',
        { userId: 'u1', merchantId: 'tenant-1', role: 'OWNER' } as any,
        'corr-id-test-123'
      );

      assert.strictEqual(updatedWhData.name, 'Kho Mới Đổi Tên');
      assert.strictEqual(updatedWhData.contact_phone, '0909999999');
      assert.strictEqual(updatedWhData.address_json.ward, 'Phường 1');
      assert.strictEqual(updatedWhData.address_json.district, 'Quận 1');
      assert.strictEqual(updatedWhData.address_json.city, 'TP.HCM');

      const whAudit = capturedAuditLogs.find((l) => l.action === 'WAREHOUSE_UPDATED');
      assert.ok(whAudit, 'WAREHOUSE_UPDATED audit log must be recorded');
      assert.strictEqual(whAudit.reason, 'correlation_id:corr-id-test-123');
      assert.ok(whAudit.new_value.contact_phone.includes('****'));
      assert.strictEqual(whAudit.new_value.contact_phone.includes('0909999999'), false);

      const promoAudit = capturedAuditLogs.find((l) => l.action === ImportAuditEvent.IMPORT_PROMOTED);
      assert.ok(promoAudit, 'IMPORT_PROMOTED audit log must be recorded');
      assert.strictEqual(promoAudit.reason, 'correlation_id:corr-id-test-123');
    });

    it('should update legacy phone and address fields on branch update and normalize status to uppercase', async () => {
      let updatedBrData: any = null;

      const existingBranch = {
        id: 'br-1',
        merchant_id: 'tenant-1',
        code: 'BR-01',
        name: 'Chi Nhánh Cũ',
        status: 'ACTIVE',
        is_default: true,
        phone: '0901111111',
        contact_phone: '0901111111',
        address: '123 Đường Cũ',
        address_line: '123 Đường Cũ',
      };

      const mockPrisma: any = {
        import: {
          findFirst: async () => ({
            id: 'imp-br-update',
            merchant_id: 'tenant-1',
            template_type: 'branches',
            status: ImportStatus.STAGED,
            revision: 1,
          }),
          update: async () => ({}),
          updateMany: async () => ({ count: 0 }),
        },
        importRow: {
          findMany: async () => [
            {
              row_number: 1,
              status: 'VALID',
              scope_identifier: 'BR-01',
              normalized_data: {
                contact_phone: '0908888888',
                address_line: '456 Đường Mới',
                status: 'active',
              },
            },
          ],
        },
        user: {
          findFirst: async () => ({
            role: 'OWNER',
            store_scopes: ['*'],
            warehouse_scopes: ['*'],
          }),
        },
        branch: {
          findMany: async () => [existingBranch],
          count: async () => 1,
          update: async (args: any) => {
            updatedBrData = args.data;
            return { ...existingBranch, ...args.data };
          },
        },
        auditLog: {
          create: async () => {},
        },
        $transaction: async (cb: any) => cb(mockPrisma),
      };

      const service = new ImportsService(mockPrisma, {} as any, {} as any);
      await service.promoteImport('imp-br-update', 'tenant-1', {
        userId: 'u1',
        merchantId: 'tenant-1',
        role: 'OWNER',
      } as any);

      assert.strictEqual(updatedBrData.contact_phone, '0908888888');
      assert.strictEqual(updatedBrData.phone, '0908888888');
      assert.strictEqual(updatedBrData.address_line, '456 Đường Mới');
      assert.strictEqual(updatedBrData.address, '456 Đường Mới');
      assert.strictEqual(updatedBrData.status, 'ACTIVE');
    });

    it('should preserve existing branch data on partial update without destructive null overwrites', async () => {
      let updatedData: any = null;
      const existingBranch = {
        id: 'branch-1',
        merchant_id: 'tenant-1',
        code: 'BR-01',
        name: 'Chi Nhánh Cũ',
        phone: '0901234567',
        contact_phone: '0901234567',
        address: '123 Đường Cũ',
        address_line: '123 Đường Cũ',
        is_default: true,
        status: 'ACTIVE',
      };

      const mockPrisma: any = {
        import: {
          findFirst: async (args: any) => {
            if (args.where?.id === 'imp-partial') {
              return {
                id: 'imp-partial',
                merchant_id: 'tenant-1',
                template_type: 'branches',
                file_name: 'test.csv',
                file_hash: 'hash-ok',
                status: ImportStatus.STAGED,
                revision: 2,
              };
            }
            if (args.orderBy?.revision === 'desc') return { revision: 2 };
            return null;
          },
        },
        importRow: {
          findMany: async () => [
            {
              row_number: 1,
              status: 'VALID',
              scope_identifier: 'BR-01',
              normalized_data: {
                name: 'Chi Nhánh Mới Cập Nhật',
                // phone, address, is_default omitted
              },
            },
          ],
        },
        user: {
          findFirst: async () => ({
            role: 'OWNER',
            store_scopes: ['*'],
            warehouse_scopes: ['*'],
          }),
        },
        $transaction: async (cb: any) => {
          const tx: any = {
            ...mockPrisma,
            branch: {
              findUnique: async () => existingBranch,
              findMany: async () => [existingBranch],
              count: async () => 1,
              updateMany: async () => {},
              update: async (args: any) => {
                updatedData = args.data;
                return { ...existingBranch, ...args.data };
              },
            },
            import: {
              ...mockPrisma.import,
              update: async () => {},
              updateMany: async () => {},
            },
            auditLog: {
              create: async () => {},
            },
          };
          return cb(tx);
        },
      };

      const service = new ImportsService(mockPrisma, {} as any, {} as any);

      await service.promoteImport('imp-partial', 'tenant-1', {
        userId: 'u1',
        merchantId: 'tenant-1',
        role: 'OWNER',
      } as any);

      assert.ok(updatedData);
      assert.strictEqual(updatedData.name, 'Chi Nhánh Mới Cập Nhật');
      // Existing phone, address, and is_default must not be overwritten with null/defaults
      assert.strictEqual(updatedData.contact_phone, undefined);
      assert.strictEqual(updatedData.address_line, undefined);
      assert.strictEqual(updatedData.is_default, undefined);
    });

    it('should reject promotion when deactivating current default warehouse and designating existing inactive warehouse as default with omitted status (DEFAULT_WAREHOUSE_MUST_BE_ACTIVE)', async () => {
      const mockPrisma: any = {
        import: {
          findFirst: async (args: any) => {
            if (args.where?.id === 'imp-wh-inactive-def') {
              return {
                id: 'imp-wh-inactive-def',
                merchant_id: 'tenant-1',
                template_type: 'warehouses',
                file_name: 'test.csv',
                file_hash: 'hash-wh',
                status: ImportStatus.STAGED,
                revision: 1,
              };
            }
            if (args.orderBy?.revision === 'desc') {
              return { revision: 1 };
            }
            return null;
          },
          update: async () => ({}),
          updateMany: async () => ({ count: 0 }),
        },
        importRow: {
          findMany: async () => [
            {
              row_number: 1,
              status: 'VALID',
              scope_identifier: 'WH-A',
              normalized_data: { name: 'Kho A', status: 'inactive' },
            },
            {
              row_number: 2,
              status: 'VALID',
              scope_identifier: 'WH-B',
              normalized_data: { name: 'Kho B', is_default: true },
            },
          ],
        },
        user: {
          findFirst: async () => ({
            role: 'OWNER',
            store_scopes: ['*'],
            warehouse_scopes: ['*'],
          }),
        },
        $transaction: async (cb: any) => {
          const tx = {
            ...mockPrisma,
            warehouse: {
              findMany: async () => [
                { id: 'wh-1', code: 'WH-A', status: 'active', is_default: true },
                { id: 'wh-2', code: 'WH-B', status: 'inactive', is_default: false },
              ],
            },
          };
          return cb(tx);
        },
      };

      const service = new ImportsService(mockPrisma, {} as any, {} as any);

      await assert.rejects(
        async () => {
          await service.promoteImport('imp-wh-inactive-def', 'tenant-1', {
            userId: 'u1',
            merchantId: 'tenant-1',
            role: 'OWNER',
          } as any);
        },
        (err: any) => {
          assert.strictEqual(err.status, HttpStatus.BAD_REQUEST);
          assert.strictEqual(err.code, 'DEFAULT_WAREHOUSE_MUST_BE_ACTIVE');
          return true;
        }
      );
    });

    it('should reject promotion when deactivating current default branch and designating existing inactive branch as default with omitted status (DEFAULT_BRANCH_MUST_BE_ACTIVE)', async () => {
      const mockPrisma: any = {
        import: {
          findFirst: async (args: any) => {
            if (args.where?.id === 'imp-br-inactive-def') {
              return {
                id: 'imp-br-inactive-def',
                merchant_id: 'tenant-1',
                template_type: 'branches',
                file_name: 'test.csv',
                file_hash: 'hash-br',
                status: ImportStatus.STAGED,
                revision: 1,
              };
            }
            if (args.orderBy?.revision === 'desc') {
              return { revision: 1 };
            }
            return null;
          },
          update: async () => ({}),
          updateMany: async () => ({ count: 0 }),
        },
        importRow: {
          findMany: async () => [
            {
              row_number: 1,
              status: 'VALID',
              scope_identifier: 'BR-A',
              normalized_data: { name: 'Chi Nhanh A', status: 'INACTIVE' },
            },
            {
              row_number: 2,
              status: 'VALID',
              scope_identifier: 'BR-B',
              normalized_data: { name: 'Chi Nhanh B', is_default: true },
            },
          ],
        },
        user: {
          findFirst: async () => ({
            role: 'OWNER',
            store_scopes: ['*'],
            warehouse_scopes: ['*'],
          }),
        },
        $transaction: async (cb: any) => {
          const tx = {
            ...mockPrisma,
            branch: {
              findMany: async () => [
                { id: 'br-1', code: 'BR-A', status: 'ACTIVE', is_default: true },
                { id: 'br-2', code: 'BR-B', status: 'INACTIVE', is_default: false },
              ],
            },
          };
          return cb(tx);
        },
      };

      const service = new ImportsService(mockPrisma, {} as any, {} as any);

      await assert.rejects(
        async () => {
          await service.promoteImport('imp-br-inactive-def', 'tenant-1', {
            userId: 'u1',
            merchantId: 'tenant-1',
            role: 'OWNER',
          } as any);
        },
        (err: any) => {
          assert.strictEqual(err.status, HttpStatus.BAD_REQUEST);
          assert.strictEqual(err.code, 'DEFAULT_BRANCH_MUST_BE_ACTIVE');
          return true;
        }
      );
    });

    it('should reject promotion when deactivating current default warehouse without replacement (CANNOT_DEACTIVATE_DEFAULT_WAREHOUSE)', async () => {
      const mockPrisma: any = {
        import: {
          findFirst: async (args: any) => {
            if (args.where?.id === 'imp-wh-deact') {
              return {
                id: 'imp-wh-deact',
                merchant_id: 'tenant-1',
                template_type: 'warehouses',
                file_name: 'test.csv',
                status: ImportStatus.STAGED,
                revision: 1,
              };
            }
            if (args.orderBy?.revision === 'desc') return { revision: 1 };
            return null;
          },
        },
        importRow: {
          findMany: async () => [
            {
              row_number: 1,
              status: 'VALID',
              scope_identifier: 'WH-A',
              normalized_data: { name: 'Kho A', status: 'inactive', is_default: false },
            },
          ],
        },
        user: {
          findFirst: async () => ({
            role: 'OWNER',
            store_scopes: ['*'],
            warehouse_scopes: ['*'],
          }),
        },
        $transaction: async (cb: any) => {
          const tx = {
            ...mockPrisma,
            warehouse: {
              findMany: async () => [
                { id: 'wh-1', code: 'WH-A', status: 'active', is_default: true },
              ],
            },
          };
          return cb(tx);
        },
      };

      const service = new ImportsService(mockPrisma, {} as any, {} as any);

      await assert.rejects(
        async () => {
          await service.promoteImport('imp-wh-deact', 'tenant-1', {
            userId: 'u1',
            merchantId: 'tenant-1',
            role: 'OWNER',
          } as any);
        },
        (err: any) => {
          assert.strictEqual(err.status, HttpStatus.BAD_REQUEST);
          assert.strictEqual(err.code, 'CANNOT_DEACTIVATE_DEFAULT_WAREHOUSE');
          return true;
        }
      );
    });

    it('should reject promotion when removing default status without replacement (CANNOT_REMOVE_DEFAULT_STATUS)', async () => {
      const mockPrisma: any = {
        import: {
          findFirst: async (args: any) => {
            if (args.where?.id === 'imp-wh-rm-def') {
              return {
                id: 'imp-wh-rm-def',
                merchant_id: 'tenant-1',
                template_type: 'warehouses',
                file_name: 'test.csv',
                status: ImportStatus.STAGED,
                revision: 1,
              };
            }
            if (args.orderBy?.revision === 'desc') return { revision: 1 };
            return null;
          },
        },
        importRow: {
          findMany: async () => [
            {
              row_number: 1,
              status: 'VALID',
              scope_identifier: 'WH-A',
              normalized_data: { name: 'Kho A', is_default: false },
            },
          ],
        },
        user: {
          findFirst: async () => ({
            role: 'OWNER',
            store_scopes: ['*'],
            warehouse_scopes: ['*'],
          }),
        },
        $transaction: async (cb: any) => {
          const tx = {
            ...mockPrisma,
            warehouse: {
              findMany: async () => [
                { id: 'wh-1', code: 'WH-A', status: 'active', is_default: true },
              ],
            },
          };
          return cb(tx);
        },
      };

      const service = new ImportsService(mockPrisma, {} as any, {} as any);

      await assert.rejects(
        async () => {
          await service.promoteImport('imp-wh-rm-def', 'tenant-1', {
            userId: 'u1',
            merchantId: 'tenant-1',
            role: 'OWNER',
          } as any);
        },
        (err: any) => {
          assert.strictEqual(err.status, HttpStatus.BAD_REQUEST);
          assert.strictEqual(err.code, 'CANNOT_REMOVE_DEFAULT_STATUS');
          return true;
        }
      );
    });

    it('should delete uploaded object from storage when registration transaction fails (compensating deletion)', async () => {
      const mockConfig: any = {
        MAX_IMPORT_FILE_SIZE_BYTES: 10000,
        ALLOWED_IMPORT_MIME_TYPES: ['text/csv'],
        MALWARE_SCANNER_ENABLED: false,
      };
      let deletedPath: string | null = null;
      const mockStorage: any = {
        putObject: async () => 's3://bucket/imports/merchant-1/warehouses/rev1_test.dat',
        deleteObject: async (p: string) => {
          deletedPath = p;
        },
      };
      const mockPrisma: any = {
        import: {
          findFirst: async () => null,
          create: async () => {
            throw new Error('Database transaction abort');
          },
        },
        $transaction: async (cb: any) => cb(mockPrisma),
      };

      const service = new ImportsService(mockPrisma, mockStorage, mockConfig);
      const csvBuffer = Buffer.from('code,name\nWH-1,Test');

      await assert.rejects(
        async () => {
          await service.uploadAndProcess(
            'merchant-1',
            { userId: 'u1', merchantId: 'merchant-1', role: 'OWNER' } as any,
            { template_type: 'warehouses' },
            csvBuffer,
            'test.csv',
            'text/csv'
          );
        },
        (err: any) => {
          assert.strictEqual(err.message, 'Database transaction abort');
          return true;
        }
      );

      assert.strictEqual(
        deletedPath,
        's3://bucket/imports/merchant-1/warehouses/rev1_test.dat',
        'Storage object must be deleted when registration rolls back'
      );
    });

    it('should persist FAILED status outside the rolled-back transaction when processing encounters an empty file', async () => {
      const mockConfig: any = {
        MAX_IMPORT_FILE_SIZE_BYTES: 10000,
        ALLOWED_IMPORT_MIME_TYPES: ['text/csv'],
        MALWARE_SCANNER_ENABLED: false,
      };
      let persistedStatus: string | null = null;
      let persistedErrorCode: string | null = null;
      let auditActionLogged: string | null = null;

      const importRecord = {
        id: 'imp-empty-1',
        merchant_id: 'merchant-1',
        template_type: 'warehouses',
        file_name: 'empty.csv',
        storage_path: 'local://empty.csv',
        status: ImportStatus.UPLOADED,
        revision: 1,
      };

      const mockStorage: any = {
        getObject: async () => Buffer.from(''),
      };

      const mockPrisma: any = {
        import: {
          findFirst: async () => importRecord,
          update: async ({ data }: any) => {
            persistedStatus = data.status;
            persistedErrorCode = data.control_totals?.error_code;
          },
        },
        auditLog: {
          create: async ({ data }: any) => {
            auditActionLogged = data.action;
          },
        },
        $transaction: async (cb: any) => cb(mockPrisma),
      };

      const service = new ImportsService(mockPrisma, mockStorage, mockConfig);
      await service.processImport('merchant-1', 'imp-empty-1', {
        userId: 'u1',
        merchantId: 'merchant-1',
        role: 'OWNER',
      } as any);

      assert.strictEqual(persistedStatus, ImportStatus.FAILED);
      assert.strictEqual(persistedErrorCode, 'EMPTY_FILE');
      assert.strictEqual(auditActionLogged, ImportAuditEvent.IMPORT_PROCESSING_FAILED);
    });

    it('should capture actual source headers, aliases, and unmapped columns in headerMapping', () => {
      const template = TEMPLATE_DEFINITIONS['warehouses'];
      const rawHeaders = ['Ma kho', 'Ten kho hang', 'Cột phụ không liên quan'];
      const rawRows = [
        {
          'Ma kho': 'WH-01',
          'Ten kho hang': 'Kho Tân Bình',
          'Cột phụ không liên quan': 'Ghi chú thêm',
        },
      ];

      const { normalizedRows, headerMapping } = normalizeRowsWithTemplate(
        template,
        rawHeaders,
        rawRows
      );

      assert.strictEqual(normalizedRows.length, 1);
      assert.strictEqual(normalizedRows[0].mappedData['code'], 'WH-01');
      assert.strictEqual(normalizedRows[0].mappedData['name'], 'Kho Tân Bình');

      const codeMapping = headerMapping.find((m) => m.field === 'code');
      assert.ok(codeMapping, 'Mapping for code must exist');
      assert.strictEqual(codeMapping.source_header, 'Ma kho');
      assert.strictEqual(codeMapping.recognized, true);

      const unmappedCol = headerMapping.find((m) => m.source_header === 'Cột phụ không liên quan');
      assert.ok(unmappedCol, 'Unmapped column must be retained in header mapping');
      assert.strictEqual(unmappedCol.recognized, false);
      assert.strictEqual(unmappedCol.rule, 'Bỏ qua (không thuộc mẫu)');
    });

    it('should return paginated imports with limit, offset, and total count in metadata', async () => {
      const mockImports = [
        {
          id: 'imp-1',
          merchant_id: 'merchant-1',
          template_type: 'warehouses',
          file_name: 'test.csv',
          file_size: 100,
          file_hash: 'hash1',
          mime_type: 'text/csv',
          status: ImportStatus.STAGED,
          revision: 1,
          total_rows: 5,
          valid_rows: 5,
          error_rows: 0,
          warning_rows: 0,
          control_totals: {},
          created_at: new Date(),
          updated_at: new Date(),
          promoted_at: null,
        },
      ];
      let querySkip = 0;
      let queryTake = 0;
      const mockPrisma: any = {
        import: {
          findMany: async (args: any) => {
            querySkip = args.skip;
            queryTake = args.take;
            return mockImports;
          },
          count: async () => 45,
        },
      };
      const service = new ImportsService(mockPrisma, {} as any, {} as any);
      const res = await service.listImports(
        'merchant-1',
        { limit: 20, offset: 20 },
        'test-correlation-id'
      );

      assert.strictEqual(queryTake, 20);
      assert.strictEqual(querySkip, 20);
      assert.strictEqual(res.meta.total, 45);
      assert.strictEqual(res.meta.correlation_id, 'test-correlation-id');
      assert.strictEqual(res.data.length, 1);
    });
  });
});
