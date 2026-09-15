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
  /(?:^|[\\/])dist[\\/]/,
  /(?:^|[\\/])\.turbo[\\/]/,
  /(?:^|[\\/])coverage[\\/]/,
  /(?:^|[\\/])\.git[\\/]/,
  /(?:^|[\\/])\.gemini[\\/]/,
  /pnpm-lock\.yaml$/,
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

function getSafeDirectoryArgs(cwd: string): string[] {
  const normalizedCwd = path.resolve(cwd).replace(/\\/g, '/');
  const safeDirs = new Set<string>([normalizedCwd]);
  const dotGitPath = path.join(cwd, '.git');
  try {
    if (fs.existsSync(dotGitPath)) {
      const stat = fs.statSync(dotGitPath);
      if (stat.isFile()) {
        const dotGitContent = fs.readFileSync(dotGitPath, 'utf-8');
        const match = dotGitContent.match(/gitdir:\s*(.+)/i);
        if (match && match[1]) {
          const gitDirPath = path.resolve(cwd, match[1].trim()).replace(/\\/g, '/');
          safeDirs.add(gitDirPath);
          const parts = gitDirPath.split('/');
          const worktreesIdx = parts.lastIndexOf('worktrees');
          if (worktreesIdx > 0 && parts[worktreesIdx - 1] === '.git') {
            const parentRepo = parts.slice(0, worktreesIdx - 1).join('/');
            if (parentRepo) safeDirs.add(parentRepo);
          }
        }
      }
    }
  } catch {}

  const args: string[] = [];
  for (const dir of safeDirs) {
    args.push('-c', `safe.directory=${dir}`);
  }
  return args;
}

function execSafeGit(
  args: string[],
  options: { cwd: string; encoding?: BufferEncoding; stdio?: any }
): Buffer | string {
  const safeArgs = getSafeDirectoryArgs(options.cwd);
  return execFileSync('git', [...safeArgs, ...args], options as any);
}

function tryResolveMergeBase(cand: string, rootDir: string): string | null {
  try {
    execSafeGit(['rev-parse', '--verify', '--quiet', `${cand}^{commit}`], {
      cwd: rootDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const mergeBase = (
      execSafeGit(['merge-base', cand, 'HEAD'], {
        cwd: rootDir,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }) as string
    ).trim();

    if (mergeBase) {
      return mergeBase;
    }
  } catch {
    // Cannot resolve candidate
  }
  return null;
}

export function resolveGitBase(baseRefCandidate?: string, rootDir: string = process.cwd()): string {
  const explicitCandidate = baseRefCandidate?.trim() || process.env.BASE_SHA?.trim();

  // 1. If an explicit candidate or BASE_SHA is supplied, it is authoritative and MUST resolve.
  if (explicitCandidate) {
    const resolved = tryResolveMergeBase(explicitCandidate, rootDir);
    if (resolved) {
      return resolved;
    }
    throw new Error(
      `[verify-formatting] Explicitly supplied base '${explicitCandidate}' is invalid or cannot be resolved to a merge-base with HEAD.`
    );
  }

  // 2. Only when NO explicit candidate was provided, try fallback candidates in order.
  const fallbackCandidates: string[] = [];
  if (process.env.GITHUB_BASE_REF?.trim()) {
    fallbackCandidates.push(`origin/${process.env.GITHUB_BASE_REF.trim()}`);
    fallbackCandidates.push(process.env.GITHUB_BASE_REF.trim());
  }
  fallbackCandidates.push('origin/main');
  fallbackCandidates.push('main');
  fallbackCandidates.push('HEAD~1');

  for (const cand of fallbackCandidates) {
    const resolved = tryResolveMergeBase(cand, rootDir);
    if (resolved) {
      return resolved;
    }
  }

  throw new Error(
    `[verify-formatting] Không thể xác định Git merge-base từ các ứng viên fallback: ${fallbackCandidates.join(
      ', '
    )}. Hãy kiểm tra git fetch/checkout.`
  );
}

export function getChangedFiles(baseRef?: string, rootDir: string = process.cwd()): string[] {
  const changedFiles = new Set<string>();

  // 1. Resolve merge base (fails closed if unable to find a valid commit)
  const base = resolveGitBase(baseRef, rootDir);

  // 2. Diff between merge base and HEAD
  try {
    const diffBuffer = execSafeGit(['diff', '--name-only', '-z', '--diff-filter=d', base, 'HEAD'], {
      cwd: rootDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as Buffer;
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
    const statusBuffer = execSafeGit(['status', '--porcelain', '-z', '-uall'], {
      cwd: rootDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as Buffer;
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
      endOfLine: 'auto',
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
  rootDir: string = process.cwd(),
  baseRef?: string
): Promise<{
  totalFiles: number;
  unformattedFiles: FormatCheckResult[];
  checkedFiles: string[];
}> {
  const candidates = (targetFiles || getChangedFiles(baseRef, rootDir)).filter(
    (f) => isPrettierSupported(f) && fs.existsSync(path.isAbsolute(f) ? f : path.join(rootDir, f))
  );

  // .prettierignore is honoured, and it has to be.
  //
  // It excludes docs/ and scripts/ai/ on the stated grounds that those are
  // governed by the Python and JSON-schema validators instead. `prettier
  // --write` obeys that exclusion and will not reformat them. A check that
  // ignored the file would therefore demand a shape the project's own
  // formatter refuses to produce — an unsatisfiable gate, which is what it had
  // become: a Pull Request touching a Work Item document failed here with no
  // command available to fix it.
  const ignorePath = path.join(rootDir, '.prettierignore');
  const filesToCheck: string[] = [];
  for (const f of candidates) {
    const fullPath = path.isAbsolute(f) ? f : path.join(rootDir, f);
    try {
      const info = await prettier.getFileInfo(fullPath, { ignorePath });
      if (info.ignored) continue;
    } catch {
      // If the ignore file cannot be read, check the file rather than skip it.
    }
    filesToCheck.push(f);
  }

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
      let executionError: any = null;

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
      } catch (err: any) {
        executionError = err;
      } finally {
        if (fs.existsSync(tempFixture)) {
          try {
            fs.unlinkSync(tempFixture);
          } catch (cleanupErr: any) {
            console.error(`❌ LỖI XÓA FIXTURE ÂM TÍNH: ${cleanupErr.message}`);
            executionError = cleanupErr;
          }
        }
      }

      if (executionError) {
        console.error(
          `❌ LỖI THỰC THI/CẤU HÌNH TRONG BÀI TEST ÂM TÍNH (exit code 2): ${executionError?.message || executionError}`
        );
        process.exit(2);
      }

      if (detected) {
        console.error(`🚨 VI PHẠM ĐÃ ĐƯỢC BẮT CHÍNH XÁC: ${errorDetail}`);
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

    try {
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
        `✅ Hoàn tất: Tất cả ${totalFiles} tệp tin thay đổi tuân thủ 100% chuẩn định dạng Prettier (tôn trọng .prettierignore).\n`
      );
      process.exit(0);
    } catch (err: any) {
      console.error(`❌ LỖI HỆ THỐNG / THỰC THI (exit code 2): ${err.message || err}`);
      process.exit(2);
    }
  })();
}
