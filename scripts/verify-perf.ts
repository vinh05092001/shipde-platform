import * as fs from 'fs';
import * as path from 'path';

export interface RouteBudget {
  route: string;
  maxInitialJsBytes: number;
}

export const CRITICAL_ROUTE_BUDGETS: RouteBudget[] = [
  { route: '/', maxInitialJsBytes: 750 * 1024 },
];

export interface PerfVerificationOptions {
  manifestPath?: string;
  rootDir?: string;
  budgets?: RouteBudget[];
}

export function measureRouteInitialJsBytes(
  manifestPath: string,
  route: string,
  webDistDir: string
): number {
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Build manifest not found at: ${manifestPath}`);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const filesToMeasure = new Set<string>();

  // 1. Root main files
  if (Array.isArray(manifest.rootMainFiles)) {
    for (const f of manifest.rootMainFiles) {
      filesToMeasure.add(f);
    }
  }

  // 2. Polyfill files
  if (Array.isArray(manifest.polyfillFiles)) {
    for (const f of manifest.polyfillFiles) {
      filesToMeasure.add(f);
    }
  }

  // 3. Page-specific chunks (if any)
  if (manifest.pages && Array.isArray(manifest.pages[route])) {
    for (const f of manifest.pages[route]) {
      filesToMeasure.add(f);
    }
  }

  let totalBytes = 0;
  for (const relativeFile of filesToMeasure) {
    const fullPath = path.join(webDistDir, relativeFile);
    if (fs.existsSync(fullPath)) {
      totalBytes += fs.statSync(fullPath).size;
    }
  }

  return totalBytes;
}

export function verifyPerformanceBudgets(options: PerfVerificationOptions = {}): {
  passed: boolean;
  details: string[];
  errors: string[];
  measuredSizes: Record<string, number>;
} {
  const rootDir = options.rootDir || process.cwd();
  const webDistDir = options.manifestPath
    ? path.dirname(options.manifestPath)
    : path.join(rootDir, 'apps/web/.next');
  const manifestPath = options.manifestPath || path.join(webDistDir, 'build-manifest.json');
  const budgets = options.budgets || CRITICAL_ROUTE_BUDGETS;

  const details: string[] = [];
  const errors: string[] = [];
  const measuredSizes: Record<string, number> = {};

  if (!fs.existsSync(manifestPath)) {
    return {
      passed: false,
      details,
      errors: [`Next.js build-manifest.json not found at ${manifestPath}. Run 'pnpm build' first.`],
      measuredSizes,
    };
  }

  let allPassed = true;
  for (const b of budgets) {
    try {
      const bytes = measureRouteInitialJsBytes(manifestPath, b.route, webDistDir);
      measuredSizes[b.route] = bytes;
      const kb = (bytes / 1024).toFixed(1);
      const limitKb = (b.maxInitialJsBytes / 1024).toFixed(1);

      if (bytes > b.maxInitialJsBytes) {
        allPassed = false;
        errors.push(
          `Route ${b.route} exceeded JS performance budget: ${kb} KB > ${limitKb} KB (${bytes} bytes > ${b.maxInitialJsBytes} bytes)`
        );
      } else {
        details.push(`Route ${b.route}: ${kb} KB <= ${limitKb} KB budget (PASS)`);
      }
    } catch (err: any) {
      allPassed = false;
      errors.push(`Failed measuring route ${b.route}: ${err.message}`);
    }
  }

  return {
    passed: allPassed && errors.length === 0,
    details,
    errors,
    measuredSizes,
  };
}

if (process.argv[1] && process.argv[1].endsWith('verify-perf.ts')) {
  console.log('================================================================');
  console.log('⚡ SHIP DỄ — BỘ KIỂM SOÁT HIỆU NĂNG TẢI TRANG (PERFORMANCE BUDGETS)');
  console.log('================================================================');

  const result = verifyPerformanceBudgets();
  for (const d of result.details) {
    console.log(` - ${d}`);
  }

  if (!result.passed) {
    console.error('\n❌ PHÁT HIỆN VI PHẠM NGÂN SÁCH HIỆU NĂNG:');
    for (const err of result.errors) {
      console.error(` - ${err}`);
    }
    process.exit(1);
  }

  console.log('\n✅ Ngân sách hiệu năng các tuyến đường trọng yếu (Critical Routes) đạt chuẩn.');
  process.exit(0);
}
