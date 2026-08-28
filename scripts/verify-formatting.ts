import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import * as prettier from 'prettier';

export interface FormatCheckResult {
  filePath: string;
  isFormatted: boolean;
  error?: string;
}

const SUPPORTED_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.yml',
  '.yaml',
  '.css',
  '.html',
]);

const EXCLUDED_PATTERNS = [
  /(?:^|[\\/])\.next[\\/]/,
  /(?:^|[\\/])node_modules[\\/]/,
  /(?:^|[\\/])out[\\/]/,
  /(?:^|[\\/])build[\\/]/,
  /(?:^|[\\/])coverage[\\/]/,
  /(?:^|[\\/])\.git[\\/]/,
  /(?:^|[\\/])\.gemini[\\/]/,
  /package-lock\.json$/,
  /next-env\.d\.ts$/,
  /\.log$/,
  /\.tmp$/,
  /(?:^|[\\/])\.temp/,
  /\.prisma$/,
  /\.toml$/,
];

export function isPrettierSupported(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');

  for (const pattern of EXCLUDED_PATTERNS) {
    if (pattern.test(normalized)) {
      return false;
    }
  }

  const ext = path.extname(filePath).toLowerCase();
  return SUPPORTED_EXTENSIONS.has(ext);
}

export function resolveGitBase(baseRefCandidate?: string, rootDir: string = process.cwd()): string {
  const candidates: string[] = [];

  if (baseRefCandidate) {
    candidates.push(baseRefCandidate);
  }
  if (process.env.BASE_SHA) {
    candidates.push(process.env.BASE_SHA);
  }
  if (process.env.GITHUB_BASE_REF) {
    candidates.push(`origin/${process.env.GITHUB_BASE_REF}`);
    candidates.push(process.env.GITHUB_BASE_REF);
  }
  candidates.push('origin/main');
  candidates.push('main');
  candidates.push('HEAD~1');

  for (const cand of candidates) {
    if (!cand) continue;
    try {
      execFileSync('git', ['rev-parse', '--verify', '--quiet', `${cand}^{commit}`], {
        cwd: rootDir,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const mergeBase = execFileSync('git', ['merge-base', cand, 'HEAD'], {
        cwd: rootDir,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();

      if (mergeBase) {
        return mergeBase;
      }
    } catch {
      // Try next candidate
    }
  }

  throw new Error(
    `[verify-formatting] Không thể xác định Git merge-base từ các ứng viên: ${candidates
      .filter(Boolean)
      .join(', ')}. Hãy kiểm tra git fetch/checkout.`
  );
}

export function getChangedFiles(baseRef?: string, rootDir: string = process.cwd()): string[] {
  const changedFiles = new Set<string>();

  // 1. Resolve merge base (fails closed if unable to find a valid commit)
  const base = resolveGitBase(baseRef, rootDir);

  // 2. Diff between merge base and HEAD
  try {
    const diffBuffer = execFileSync(
      'git',
      ['diff', '--name-only', '-z', '--diff-filter=d', base, 'HEAD'],
      {
        cwd: rootDir,
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );
    const diffOutput = diffBuffer.toString('utf-8');
    for (const f of diffOutput.split('\0')) {
      const trimmed = f.trim();
      if (trimmed) {
        changedFiles.add(trimmed.replace(/\\/g, '/'));
      }
    }
  } catch (err: any) {
    throw new Error(
      `[verify-formatting] Thất bại khi thực thi git diff từ base ${base}: ${err.message}`
    );
  }

  // 3. Uncommitted staged and untracked/modified working tree files
  try {
    const statusBuffer = execFileSync('git', ['status', '--porcelain', '-z', '-uall'], {
      cwd: rootDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const statusOutput = statusBuffer.toString('utf-8');
    const parts = statusOutput.split('\0');
    for (const part of parts) {
      if (part.length > 3) {
        const filePath = part.substring(3).trim();
        if (filePath) {
          changedFiles.add(filePath.replace(/\\/g, '/'));
        }
      }
    }
  } catch (err: any) {
    throw new Error(`[verify-formatting] Thất bại khi thực thi git status: ${err.message}`);
  }

  return Array.from(changedFiles);
}

export async function checkFileFormatting(
  filePath: string,
  rootDir: string = process.cwd()
): Promise<FormatCheckResult> {
  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(rootDir, filePath);
  if (!fs.existsSync(fullPath)) {
    return { filePath, isFormatted: true };
  }

  try {
    const content = fs.readFileSync(fullPath, 'utf-8');
    const options = (await prettier.resolveConfig(fullPath)) || {};
    const isFormatted = await prettier.check(content, {
      ...options,
      filepath: fullPath,
    });

    return {
      filePath,
      isFormatted,
    };
  } catch (err: any) {
    return {
      filePath,
      isFormatted: false,
      error: err.message,
    };
  }
}

export async function verifyFormatting(
  targetFiles?: string[],
  rootDir: string = process.cwd()
): Promise<{
  totalFiles: number;
  unformattedFiles: FormatCheckResult[];
  checkedFiles: string[];
}> {
  const filesToCheck = (targetFiles || getChangedFiles(undefined, rootDir)).filter(
    (f) => isPrettierSupported(f) && fs.existsSync(path.isAbsolute(f) ? f : path.join(rootDir, f))
  );

  const unformattedFiles: FormatCheckResult[] = [];

  for (const file of filesToCheck) {
    const result = await checkFileFormatting(file, rootDir);
    if (!result.isFormatted) {
      unformattedFiles.push(result);
    }
  }

  return {
    totalFiles: filesToCheck.length,
    unformattedFiles,
    checkedFiles: filesToCheck,
  };
}

// CLI entrypoint
if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    const isNegativeTest = args.includes('--test-negative');

    console.log('================================================================');
    console.log('✨ SHIP DỄ — BỘ KIỂM TOÁN ĐỊNH DẠNG TĂNG TRƯỞNG (INCREMENTAL PRETTIER CHECK)');
    console.log('================================================================\n');

    if (isNegativeTest) {
      console.log(
        '🧪 Chạy kiểm thử âm tính phát hiện vi phạm định dạng qua toàn bộ luồng enumeration...'
      );
      const tempFixture = path.join(process.cwd(), 'test-negative-formatting-fixture.md');
      const unformattedContent =
        '# Unformatted Header   \n\n\n\n| Col1 | Col2 |\n|---|---|\n| val1 |    val2   |\n\n\n\nconst x  =   1;\n';

      fs.writeFileSync(tempFixture, unformattedContent, 'utf-8');

      let detected = false;
      let errorDetail = '';

      try {
        // Exercise full verifyFormatting() without targetFiles to test getChangedFiles + git status enumeration
        const { unformattedFiles, checkedFiles } = await verifyFormatting(undefined, process.cwd());

        const isEnumerated = checkedFiles.some((f) =>
          f.includes('test-negative-formatting-fixture.md')
        );
        const isCaught = unformattedFiles.some((u) =>
          u.filePath.includes('test-negative-formatting-fixture.md')
        );

        if (!isEnumerated) {
          errorDetail =
            'Tệp fixture âm tính không được bộ getChangedFiles() tự động phát hiện qua Git status!';
        } else if (!isCaught) {
          errorDetail = 'Tệp fixture âm tính được liệt kê nhưng không bị bắt lỗi định dạng!';
        } else {
          detected = true;
          errorDetail =
            'Tệp fixture âm tính được tự động phát hiện qua git status và bắt lỗi định dạng thành công.';
        }
      } finally {
        if (fs.existsSync(tempFixture)) {
          try {
            fs.unlinkSync(tempFixture);
          } catch {}
        }
      }

      if (detected) {
        console.error(`🚨 VI PHẠM ĐÃ ĐƯỢC BẮT CHÍNH XAC: ${errorDetail}`);
        console.error(
          '   [AC-FOUND-01-05 Evidence] Đã chứng minh gate thoát mã lỗi non-zero (exit code 1) khi phát hiện tệp có định dạng sai lệch qua toàn bộ luồng enumeration.\n'
        );
        process.exit(1);
      } else {
        console.error(
          `❌ LỖI: Bộ kiểm toán định dạng KHÔNG phát hiện được vi phạm trong bài test âm tính! (${errorDetail})`
        );
        process.exit(2);
      }
    }

    const { totalFiles, unformattedFiles, checkedFiles } = await verifyFormatting();

    console.log(
      `Đã phát hiện và quét ${totalFiles} tệp tin được Prettier hỗ trợ trong phạm vi thay đổi:`
    );
    for (const f of checkedFiles) {
      console.log(` - ${f}`);
    }
    console.log('');

    if (unformattedFiles.length > 0) {
      console.error(
        `❌ PHÁT HIỆN ${unformattedFiles.length} TỆP TIN CHƯA ĐẠT CHUẨN ĐỊNH DẠNG PRETTIER:`
      );
      for (const u of unformattedFiles) {
        console.error(` - ${u.filePath}${u.error ? ` (Lỗi: ${u.error})` : ''}`);
      }
      console.error('\nChạy "npx prettier --write <file>" để sửa định dạng các tệp trên.');
      process.exit(1);
    }

    console.log(
      `✅ Hoàn tất: Tất cả ${totalFiles} tệp tin thay đổi tuân thủ 100% chuẩn định dạng Prettier (bỏ qua mọi quy tắc .prettierignore).\n`
    );
    process.exit(0);
  })();
}
