const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');

const root = __dirname;
if (!process.argv[2]) throw new Error('Usage: node --experimental-vm-modules exports.files.spec.cjs <fixture-dir> [reviewed-pdf-generator.ts]');
const output = path.resolve(process.argv[2]);
fs.mkdirSync(output, { recursive: true });

function createLoader(overrides = new Map()) {
  const cache = new Map();
  return async function load(file) {
    if (cache.has(file)) return cache.get(file);
    const source = overrides.get(file) || fs.readFileSync(file, 'utf8');
    const mod = new vm.SourceTextModule(stripTypeScriptTypes(source, { mode: 'transform' }), {
      identifier: file,
    });
    cache.set(file, mod);
    await mod.link(async (specifier, referencing) => {
      if (specifier.startsWith('node:')) {
        const namespace = await import(specifier);
        return new vm.SyntheticModule(Object.keys(namespace), function () {
          for (const key of Object.keys(namespace)) this.setExport(key, namespace[key]);
        });
      }
      return load(path.resolve(path.dirname(referencing.identifier), `${specifier}.ts`));
    });
    return mod;
  };
}

async function main() {
  const load = createLoader();
  const pdf = await load(path.join(root, 'generators/pdf.generator.ts'));
  const xlsx = await load(path.join(root, 'generators/xlsx.generator.ts'));
  const util = await load(path.join(root, 'exports.util.ts'));
  await pdf.evaluate();
  await xlsx.evaluate();
  await util.evaluate();
  const metadata = (format, rows) => ({
    export_id: '11111111-1111-4111-8111-111111111111',
    generated_at: '2026-11-02T00:00:00Z',
    merchant_id: '22222222-2222-4222-8222-222222222222',
    requested_by: '33333333-3333-4333-8333-333333333333',
    user_role: 'OWNER', resource: 'warehouses', format, filters: {},
    rule_version: 'fixture-v1', total_rows: rows.length,
    succeeded_rows: rows.length, failed_rows: 0,
    checksum_sha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex'),
  });
  const workbookRows = [
    { name: 'Nguyễn Văn Đạt', value: '9007199254740993', note: '=1+1' },
    { name: 'Trần Thị Mỹ Duyên', value: 42, note: 'A & B <C> "D"' },
  ];
  const workbookHeaders = [
    { key: 'name', label: 'Họ và tên' },
    { key: 'value', label: 'Giá trị' },
    { key: 'note', label: 'Ghi chú' },
  ];
  fs.writeFileSync(path.join(output, 'warehouse.xlsx'), xlsx.namespace.generateXlsx(
    metadata('xlsx', workbookRows), workbookHeaders, workbookRows
  ));
  const vietnameseRows = [
    { full_name: 'Nguyễn Văn Đạt', city: 'Hà Nội', note: 'Đơn hàng vận chuyển nhanh' },
    { full_name: 'Trần Thị Mỹ Duyên', city: 'TP. Hồ Chí Minh', note: 'Kiểm tra đối soát thành công' },
  ];
  const vietnameseHeaders = [
    { key: 'full_name', label: 'Họ và tên' },
    { key: 'city', label: 'Tỉnh/Thành phố' },
    { key: 'note', label: 'Ghi chú tiếng Việt' },
  ];
  fs.writeFileSync(path.join(output, 'vietnamese.pdf'), pdf.namespace.generatePdf(
    metadata('pdf', vietnameseRows), vietnameseHeaders, vietnameseRows
  ));
  const noteHeaders = [{ key: 'note', label: 'Ghi chú' }];
  const longRows = [{ note: Array.from({ length: 80 }, (_, i) =>
    `Dòng ${String(i).padStart(3, '0')} Nguyễn Văn Đạt`).join('\n') }];
  fs.writeFileSync(path.join(output, 'long-row.pdf'), pdf.namespace.generatePdf(
    metadata('pdf', longRows), noteHeaders, longRows
  ));
  const wideRows = [{ note: 'M'.repeat(12000) }];
  fs.writeFileSync(path.join(output, 'wide-row.pdf'), pdf.namespace.generatePdf(
    metadata('pdf', wideRows), noteHeaders, wideRows
  ));
  const legacyFile = process.argv[3] ? path.resolve(process.argv[3]) : undefined;
  if (legacyFile && fs.existsSync(legacyFile)) {
    const legacySource = fs.readFileSync(legacyFile, 'utf8')
      .replace('import { ExportGenerationMetadata }', 'import type { ExportGenerationMetadata }')
      .replace('EMBEDDED_FONTS, EmbeddedFont', 'EMBEDDED_FONTS, type EmbeddedFont')
      .replace('parseTtf, TtfFont', 'parseTtf, type TtfFont');
    const legacy = await createLoader(new Map([
      [path.join(root, 'generators/pdf.generator.ts'), legacySource],
    ]))(path.join(root, 'generators/pdf.generator.ts'));
    await legacy.evaluate();
    fs.writeFileSync(path.join(output, 'legacy-wide-row.pdf'), legacy.namespace.generatePdf(
      metadata('pdf', wideRows), noteHeaders, wideRows
    ));
  }
  for (const input of [
    'postgresql://diagnostic-user:diagnostic-secret@db.example.test:5432/db',
    'postgresql://diagnostic-user@db.example.test:bad-port/db',
    'postgresql://db.example.test/db?password=diagnostic-secret',
  ]) {
    const redacted = util.namespace.redactDatabaseUrl(input);
    assert.equal(redacted.includes('diagnostic-user'), false);
    assert.equal(redacted.includes('diagnostic-secret'), false);
  }
  let closes = 0;
  const diagnosticUrl = 'postgresql://diagnostic-user:diagnostic-secret@db.example.test/db';
  await assert.rejects(util.namespace.handleUnavailableDatabase(diagnosticUrl, async () => { closes++; }, true),
    (err) => closes === 1 && !(err instanceof ReferenceError) &&
      !err.message.includes('diagnostic-user') && !err.message.includes('diagnostic-secret'));
  console.log('Actual source generators produced XLSX/PDF fixtures; diagnostic negatives passed.');
}
main().catch((err) => { console.error(err); process.exitCode = 1; });
