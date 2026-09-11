import * as fs from 'fs';
import * as path from 'path';

export interface A11yCheckResult {
  file: string;
  violations: string[];
}

export function scanFileForA11y(filePath: string): string[] {
  const content = fs.readFileSync(filePath, 'utf8');
  const violations: string[] = [];

  // 1. Check <img> tags without alt attribute
  const imgWithoutAlt = /<img(?![^>]*\balt=)[^>]*>/gi;
  if (imgWithoutAlt.test(content)) {
    violations.push('Found <img> tag missing required alt attribute');
  }

  // 2. Check empty buttons without text or aria-label
  const emptyButton = /<button(?![^>]*\baria-label=)[^>]*>\s*<\/button>/gi;
  if (emptyButton.test(content)) {
    violations.push('Found empty <button> tag without accessible text or aria-label');
  }

  // 3. Check interactive elements with aria-hidden="true" (blocks assistive tech)
  const hiddenInteractive =
    /<(?:button|a|input|select|textarea)[^>]*\baria-hidden=["']true["'][^>]*>/gi;
  if (hiddenInteractive.test(content)) {
    violations.push('Found interactive element incorrectly marked with aria-hidden="true"');
  }

  // 4. Check icon-only buttons without accessible name
  const iconOnlyButton =
    /<button(?![^>]*\b(?:aria-label|title)=)[^>]*>\s*<[A-Z][a-zA-Z0-9]*(?:Icon)?(?:\s+[^>]*)?\/>\s*<\/button>/gi;
  if (iconOnlyButton.test(content)) {
    violations.push('Found icon-only button without accessible name (missing aria-label or title)');
  }

  return violations;
}

export function runA11yScan(rootDir: string = process.cwd()): {
  passed: boolean;
  results: A11yCheckResult[];
} {
  const results: A11yCheckResult[] = [];
  const targetDirs = [
    path.join(rootDir, 'packages/ui/src'),
    path.join(rootDir, 'apps/web/src/components'),
  ];

  for (const dir of targetDirs) {
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir, { recursive: true }) as string[];
      for (const file of files) {
        if (typeof file === 'string' && (file.endsWith('.tsx') || file.endsWith('.jsx'))) {
          const fullPath = path.join(dir, file);
          if (fs.statSync(fullPath).isFile()) {
            const violations = scanFileForA11y(fullPath);
            if (violations.length > 0) {
              results.push({ file: path.relative(rootDir, fullPath), violations });
            }
          }
        }
      }
    }
  }

  return {
    passed: results.length === 0,
    results,
  };
}

if (process.argv[1] && process.argv[1].endsWith('verify-a11y.ts')) {
  console.log('================================================================');
  console.log('♿ SHIP DỄ — BỘ KIỂM TRA TRUY CẬP KHUYẾT TẬT (ACCESSIBILITY / A11Y GATE)');
  console.log('================================================================');

  const { passed, results } = runA11yScan();
  if (!passed) {
    console.error('\n❌ PHÁT HIỆN LỖI KHẢ NĂNG TRUY CẬP (A11Y):');
    for (const res of results) {
      console.error(`- ${res.file}:`);
      for (const v of res.violations) {
        console.error(`    ${v}`);
      }
    }
    process.exit(1);
  }

  console.log('\n✅ Tất cả thành phần UI tuân thủ tiêu chuẩn Accessibility (A11y).');
  process.exit(0);
}
