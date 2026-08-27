import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..');
const CATALOG_PATH = path.join(ROOT, 'docs/product-spec/docs/01-product/MASTER-FEATURE-CATALOG.md');
const INVENTORY_PATH = path.join(
  ROOT,
  'docs/product-spec/evidence/CURRENT-IMPLEMENTATION-INVENTORY.md'
);

const VALID_CLASSIFICATIONS = new Set(['REAL', 'PARTIAL', 'DEMO_ONLY', 'ABSENT']);

export function validateInventory(): {
  success: boolean;
  totalCatalog: number;
  totalInventory: number;
  classifications: Record<string, number>;
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

  return {
    success: errors.length === 0,
    totalCatalog: catalogIds.size,
    totalInventory: inventoryIds.size,
    classifications: classificationCounts,
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
  console.log('Phân bố thực tế:');
  console.log(` - REAL:      ${result.classifications.REAL || 0}`);
  console.log(` - PARTIAL:   ${result.classifications.PARTIAL || 0}`);
  console.log(` - DEMO_ONLY: ${result.classifications.DEMO_ONLY || 0}`);
  console.log(` - ABSENT:    ${result.classifications.ABSENT || 0}\n`);

  if (!result.success) {
    console.error('❌ Phát hiện lỗi trong bảng phân loại:');
    for (const err of result.errors) {
      console.error(` - ${err}`);
    }
    process.exit(1);
  }

  console.log(
    '✅ Hoàn hảo: Tất cả 130 tính năng được định danh chính xác 1:1 với phân loại hợp lệ!\n'
  );
  process.exit(0);
}
