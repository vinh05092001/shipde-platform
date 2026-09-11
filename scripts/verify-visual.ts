import * as fs from 'fs';
import * as path from 'path';

export interface VisualSurfaceBaseline {
  id: string;
  component: string;
  filePath: string;
  viewport: { width: number; height: number };
  requiredVisualTokens: string[];
  layoutType: string;
}

export interface VisualBaselineCatalog {
  version: string;
  generatedAt: string;
  surfaces: VisualSurfaceBaseline[];
}

export interface VisualVerificationResult {
  passed: boolean;
  totalSurfaces: number;
  verifiedSurfaces: string[];
  errors: string[];
}

export const DEFAULT_BASELINE_PATH = path.resolve(
  process.cwd(),
  'tests/visual-baselines/critical-surfaces.json'
);

export function runVisualVerification(
  baselinePath: string = DEFAULT_BASELINE_PATH,
  rootDir: string = process.cwd()
): VisualVerificationResult {
  const errors: string[] = [];
  const verifiedSurfaces: string[] = [];

  if (!fs.existsSync(baselinePath)) {
    return {
      passed: false,
      totalSurfaces: 0,
      verifiedSurfaces,
      errors: [`Visual baseline catalog not found at: ${baselinePath}`],
    };
  }

  let catalog: VisualBaselineCatalog;
  try {
    const raw = fs.readFileSync(baselinePath, 'utf-8');
    catalog = JSON.parse(raw);
  } catch (err: any) {
    return {
      passed: false,
      totalSurfaces: 0,
      verifiedSurfaces,
      errors: [`Failed to parse visual baseline JSON: ${err.message}`],
    };
  }

  if (!Array.isArray(catalog.surfaces) || catalog.surfaces.length === 0) {
    return {
      passed: false,
      totalSurfaces: 0,
      verifiedSurfaces,
      errors: [`Visual baseline catalog contains no surface entries.`],
    };
  }

  for (const surface of catalog.surfaces) {
    const fullPath = path.isAbsolute(surface.filePath)
      ? surface.filePath
      : path.join(rootDir, surface.filePath);

    if (!fs.existsSync(fullPath)) {
      errors.push(
        `Visual surface ${surface.id} (${surface.component}) missing source file: ${surface.filePath}`
      );
      continue;
    }

    const content = fs.readFileSync(fullPath, 'utf-8');
    const missingTokens: string[] = [];
    for (const token of surface.requiredVisualTokens) {
      if (!content.includes(token)) {
        missingTokens.push(token);
      }
    }

    if (missingTokens.length > 0) {
      errors.push(
        `Visual surface regression in ${surface.id} (${surface.component}): missing visual tokens [${missingTokens.join(
          ', '
        )}]`
      );
    } else {
      verifiedSurfaces.push(surface.id);
    }
  }

  return {
    passed: errors.length === 0,
    totalSurfaces: catalog.surfaces.length,
    verifiedSurfaces,
    errors,
  };
}

if (process.argv[1] && process.argv[1].endsWith('verify-visual.ts')) {
  console.log('================================================================');
  console.log('👁️ SHIP DỄ — BỘ KIỂM TOÁN GIAO DIỆN VÀ HÌNH ẢNH (VISUAL GATE)');
  console.log('================================================================');

  const result = runVisualVerification();
  console.log(
    `Đã kiểm toán ${result.verifiedSurfaces.length}/${result.totalSurfaces} bề mặt giao diện.`
  );

  if (!result.passed) {
    console.error('\n❌ PHÁT HIỆN LỖI HỒI QUY HÌNH ẢNH / VISUAL BASELINE:');
    for (const err of result.errors) {
      console.error(` - ${err}`);
    }
    process.exit(1);
  }

  console.log('\n✅ Tất cả bề mặt giao diện trọng yếu khớp 100% với Visual Baseline.');
  process.exit(0);
}
