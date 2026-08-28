import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..');
const CATALOG_PATH = path.join(ROOT, 'docs/product-spec/docs/01-product/MASTER-FEATURE-CATALOG.md');
const INVENTORY_PATH = path.join(
  ROOT,
  'docs/product-spec/evidence/CURRENT-IMPLEMENTATION-INVENTORY.md'
);
const PRISMA_SCHEMA_PATH = path.join(ROOT, 'prisma/schema.prisma');
const GAPS_DOC_PATH = path.join(ROOT, 'docs/product-spec/evidence/PROTOTYPE-GAPS-AND-RISKS.md');

const VALID_CLASSIFICATIONS = new Set(['REAL', 'PARTIAL', 'DEMO_ONLY', 'ABSENT']);

function getDirectFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => path.join(dir, e.name));
}

function getAllFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isFile()) files.push(full);
    else if (e.isDirectory()) files.push(...getAllFiles(full));
  }
  return files;
}

export function validateInventory(): {
  success: boolean;
  totalCatalog: number;
  totalInventory: number;
  classifications: Record<string, number>;
  prismaModelsCount: number;
  areaValidations: { area: string; declared: number; actual: number }[];
  errors: string[];
} {
  const errors: string[] = [];

  // 1. Extract feature IDs from catalog
  const catalogContent = fs.readFileSync(CATALOG_PATH, 'utf-8');
  const catalogIds = new Set<string>();
  const catalogRegex = /\|\s*(FEAT-[A-Z]+-[0-9]{2})\s*\|/g;
  let match: RegExpExecArray | null;

  while ((match = catalogRegex.exec(catalogContent)) !== null) {
    catalogIds.add(match[1]);
  }

  // 2. Extract feature IDs and classifications from inventory
  const inventoryContent = fs.readFileSync(INVENTORY_PATH, 'utf-8');
  const inventoryIds = new Map<string, string>();
  const inventoryRegex = /\|\s*`(FEAT-[A-Z]+-[0-9]{2})`\s*\|\s*[^|]+\|\s*`?([A-Z_]+)`?\s*\|/g;

  const classificationCounts: Record<string, number> = {
    REAL: 0,
    PARTIAL: 0,
    DEMO_ONLY: 0,
    ABSENT: 0,
  };

  while ((match = inventoryRegex.exec(inventoryContent)) !== null) {
    const featId = match[1];
    const classification = match[2];

    if (inventoryIds.has(featId)) {
      errors.push(`Duplicate feature ID in inventory: ${featId}`);
    }

    if (!VALID_CLASSIFICATIONS.has(classification)) {
      errors.push(`Invalid classification for ${featId}: ${classification}`);
    } else {
      classificationCounts[classification] = (classificationCounts[classification] || 0) + 1;
    }

    inventoryIds.set(featId, classification);
  }

  // 3. Verify exact 1:1 match
  for (const catId of catalogIds) {
    if (!inventoryIds.has(catId)) {
      errors.push(`Missing catalog ID in inventory: ${catId}`);
    }
  }

  for (const invId of inventoryIds.keys()) {
    if (!catalogIds.has(invId)) {
      errors.push(`Unknown feature ID in inventory: ${invId}`);
    }
  }

  // 4. Verify Executive Summary text vs Table consistency
  const summaryMatches = {
    real: inventoryContent.match(/`REAL`\s*\((\d+)\s*\/\s*130\s*features\)/),
    partial: inventoryContent.match(/`PARTIAL`\s*\((\d+)\s*\/\s*130\s*features\)/),
    demo: inventoryContent.match(/`DEMO_ONLY`\s*\((\d+)\s*\/\s*130\s*features\)/),
    absent: inventoryContent.match(/`ABSENT`\s*\((\d+)\s*\/\s*130\s*features\)/),
  };

  if (summaryMatches.real && Number(summaryMatches.real[1]) !== classificationCounts.REAL) {
    errors.push(
      `Summary text REAL count (${summaryMatches.real[1]}) does not match table count (${classificationCounts.REAL})`
    );
  }
  if (
    summaryMatches.partial &&
    Number(summaryMatches.partial[1]) !== classificationCounts.PARTIAL
  ) {
    errors.push(
      `Summary text PARTIAL count (${summaryMatches.partial[1]}) does not match table count (${classificationCounts.PARTIAL})`
    );
  }
  if (summaryMatches.demo && Number(summaryMatches.demo[1]) !== classificationCounts.DEMO_ONLY) {
    errors.push(
      `Summary text DEMO_ONLY count (${summaryMatches.demo[1]}) does not match table count (${classificationCounts.DEMO_ONLY})`
    );
  }
  if (summaryMatches.absent && Number(summaryMatches.absent[1]) !== classificationCounts.ABSENT) {
    errors.push(
      `Summary text ABSENT count (${summaryMatches.absent[1]}) does not match table count (${classificationCounts.ABSENT})`
    );
  }

  // 5. Verify Prisma Schema models count against schema.prisma
  const prismaContent = fs.readFileSync(PRISMA_SCHEMA_PATH, 'utf-8');
  const prismaModels = prismaContent.match(/^model\s+\w+/gm) || [];
  const actualModelCount = prismaModels.length;

  if (actualModelCount !== 17) {
    errors.push(`Expected 17 models in schema.prisma, found ${actualModelCount}`);
  }

  const inventorySchemaMatch = inventoryContent.match(/schema\.prisma[^\n]*?(\d+)\s+models/);
  if (inventorySchemaMatch && Number(inventorySchemaMatch[1]) !== actualModelCount) {
    errors.push(
      `CURRENT-IMPLEMENTATION-INVENTORY.md references ${inventorySchemaMatch[1]} Prisma models, but schema.prisma has ${actualModelCount}`
    );
  }

  const gapsContent = fs.readFileSync(GAPS_DOC_PATH, 'utf-8');
  const gapsSchemaMatch = gapsContent.match(
    /schema\.prisma[^\n]*?(\d+)\s+(?:domain|PostgreSQL)\s+models/
  );
  if (gapsSchemaMatch && Number(gapsSchemaMatch[1]) !== actualModelCount) {
    errors.push(
      `PROTOTYPE-GAPS-AND-RISKS.md references ${gapsSchemaMatch[1]} Prisma models, but schema.prisma has ${actualModelCount}`
    );
  }

  // 6. Verify Tracked Application Areas table file counts against actual disk filesystem
  const areaValidations: { area: string; declared: number; actual: number }[] = [];

  const areaCalculators: Record<string, () => number> = {
    'App Routes & Shell': () => getDirectFiles(path.join(ROOT, 'src/app')).length,
    'UI Tab Workspaces': () => {
      const compFiles = getDirectFiles(path.join(ROOT, 'src/components'));
      return compFiles.filter((f) => {
        const b = path.basename(f);
        return b.endsWith('Tab.tsx') || b === 'SettingsWorkspace.tsx';
      }).length;
    },
    'UI Modals & Forms': () => {
      const compModals = getDirectFiles(path.join(ROOT, 'src/components')).filter((f) =>
        path.basename(f).endsWith('Modal.tsx')
      );
      const formFiles = getDirectFiles(path.join(ROOT, 'src/components/forms'));
      return compModals.length + formFiles.length;
    },
    'UI Primitives': () => getDirectFiles(path.join(ROOT, 'src/components/ui')).length,
    'Auth UI': () => getDirectFiles(path.join(ROOT, 'src/components/auth')).length,
    'UI Mock Data & Types': () => {
      const compFiles = getDirectFiles(path.join(ROOT, 'src/components'));
      return compFiles.filter((f) => {
        const b = path.basename(f);
        return b === 'mock-data.ts' || b === 'types.ts';
      }).length;
    },
    'Context & State': () => getDirectFiles(path.join(ROOT, 'src/context')).length,
    'Core Domain Engines': () => getDirectFiles(path.join(ROOT, 'src/core')).length,
    Adapters: () => getDirectFiles(path.join(ROOT, 'src/adapters')).length,
    'Server & In-Memory DB': () => getDirectFiles(path.join(ROOT, 'src/server')).length,
    'API Route Handlers': () =>
      getAllFiles(path.join(ROOT, 'src/app/api')).filter((f) => path.basename(f) === 'route.ts')
        .length,
    'Data Stores & Services': () => getDirectFiles(path.join(ROOT, 'src/services')).length,
    'Types & Error Catalog': () => getDirectFiles(path.join(ROOT, 'src/types')).length,
    'Database Schema': () => getDirectFiles(path.join(ROOT, 'prisma')).length,
    'Verification & Tests': () => getDirectFiles(path.join(ROOT, 'src/tests')).length,
    'Automation & Scripts': () => getAllFiles(path.join(ROOT, 'scripts')).length,
  };

  const areaRowRegex = /\|\s*\*\*([^*]+)\*\*\s*\|\s*`([^`]+)`[^|]*\|\s*(\d+)\s*\|/g;
  let areaMatch: RegExpExecArray | null;

  while ((areaMatch = areaRowRegex.exec(inventoryContent)) !== null) {
    const areaName = areaMatch[1].trim();
    const declaredCount = Number(areaMatch[3]);

    if (areaCalculators[areaName]) {
      const actualCount = areaCalculators[areaName]();
      areaValidations.push({ area: areaName, declared: declaredCount, actual: actualCount });
      if (declaredCount !== actualCount) {
        errors.push(
          `Area "${areaName}" declares ${declaredCount} files in inventory table, but disk has ${actualCount} files`
        );
      }
    }
  }

  if (areaValidations.length < Object.keys(areaCalculators).length) {
    errors.push(
      `Expected ${Object.keys(areaCalculators).length} application areas in inventory table, found ${areaValidations.length}`
    );
  }

  return {
    success: errors.length === 0,
    totalCatalog: catalogIds.size,
    totalInventory: inventoryIds.size,
    classifications: classificationCounts,
    prismaModelsCount: actualModelCount,
    areaValidations,
    errors,
  };
}

if (require.main === module) {
  console.log('================================================================');
  console.log('📊 SHIP DỄ — KIỂM TOÁN TÍNH TOÀN VẸN BẢNG PHÂN LOẠI TÍNH NĂNG');
  console.log('================================================================\n');

  const result = validateInventory();
  console.log(`Danh mục gốc: ${result.totalCatalog} tính năng`);
  console.log(`Bảng phân loại: ${result.totalInventory} tính năng`);
  console.log(`Số mô hình Prisma: ${result.prismaModelsCount} models`);
  console.log('Phân bố thực tế:');
  console.log(` - REAL:      ${result.classifications.REAL || 0}`);
  console.log(` - PARTIAL:   ${result.classifications.PARTIAL || 0}`);
  console.log(` - DEMO_ONLY: ${result.classifications.DEMO_ONLY || 0}`);
  console.log(` - ABSENT:    ${result.classifications.ABSENT || 0}\n`);

  console.log('Kiểm toán số lượng tệp theo từng vùng ứng dụng (Tracked Areas):');
  for (const a of result.areaValidations) {
    const matchIcon = a.declared === a.actual ? '✓' : '✗';
    console.log(
      ` - ${matchIcon} [${a.area}]: Khai báo ${a.declared} tệp | Thực tế ${a.actual} tệp`
    );
  }
  console.log('');

  if (!result.success) {
    console.error('❌ Phát hiện lỗi trong bảng phân loại:');
    for (const err of result.errors) {
      console.error(` - ${err}`);
    }
    process.exit(1);
  }

  console.log(
    '✅ Hoàn hảo: Tất cả 130 tính năng, 17 mô hình Prisma, và 16 vùng ứng dụng khớp 100% với cây mã nguồn!\n'
  );
  process.exit(0);
}
