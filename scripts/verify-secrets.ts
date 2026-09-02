import * as fs from 'fs';
import * as path from 'path';
import { spawnSync, execFileSync } from 'child_process';

export interface SecretRule {
  id: string;
  description: string;
  regex: RegExp;
  keywords?: string[];
}

export interface GitleaksConfig {
  title: string;
  allowlistPaths: RegExp[];
  rules: SecretRule[];
}

export interface GitleaksExecResult {
  success: boolean;
  exitCode: number | null;
  findings: any[];
  operationalError?: string;
}

export const IGNORED_SCAN_NAMES = new Set([
  '.git',
  'node_modules',
  '.next',
  '.turbo',
  '.pnpm-store',
  'dist',
  'build',
  'out',
  '.gemini',
]);

export function isIgnoredScanName(name: string): boolean {
  if (IGNORED_SCAN_NAMES.has(name)) return true;
  if (name.startsWith('.temp-gitleaks')) return true;
  return false;
}

/**
 * Resolve gitleaks executable path if available in PATH or local environment.
 */
export function getGitleaksBinary(): string | null {
  try {
    execFileSync('gitleaks', ['version'], { stdio: 'ignore', shell: false });
    return 'gitleaks';
  } catch {}

  // Check local test path on Windows
  if (process.platform === 'win32' && process.env.TEMP) {
    const localExe = path.join(process.env.TEMP, 'gitleaks', 'gitleaks.exe');
    if (fs.existsSync(localExe)) {
      try {
        execFileSync(localExe, ['version'], { stdio: 'ignore', shell: false });
        return localExe;
      } catch {}
    }
  }

  return null;
}

/**
 * Parse `.gitleaks.toml` file to extract allowlist patterns and secret detection rules.
 */
export function parseGitleaksConfig(configPath: string): GitleaksConfig {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Gitleaks configuration file not found at ${configPath}`);
  }

  const content = fs.readFileSync(configPath, 'utf-8');
  const allowlistPaths: RegExp[] = [];
  const rules: SecretRule[] = [];

  // Parse [allowlist] paths
  const allowlistMatch = content.match(/\[allowlist\][\s\S]*?paths\s*=\s*\[([\s\S]*?)\]/);
  if (allowlistMatch) {
    const rawPaths = allowlistMatch[1];
    const pathRegex = /'''(.*?)'''|"""(.*?)"""|'([^']*)'|"([^"]*)"/g;
    let m: RegExpExecArray | null;
    while ((m = pathRegex.exec(rawPaths)) !== null) {
      const pattern = m[1] || m[2] || m[3] || m[4];
      if (pattern) {
        allowlistPaths.push(new RegExp(pattern));
      }
    }
  }

  const defaultRules: SecretRule[] = [
    {
      id: 'generic-api-key',
      description: 'Generic High-Entropy Secret or Token',
      regex:
        /(?:api_key|apikey|secret_key|private_key|auth_token|access_token|bearer_token)\s*[:=]\s*['"]([0-9a-zA-Z_\-]{24,})['"]/i,
      keywords: [
        'api_key',
        'apikey',
        'secret_key',
        'private_key',
        'auth_token',
        'access_token',
        'bearer_token',
      ],
    },
    {
      id: 'private-key',
      description: 'Private Key Header',
      regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/,
      keywords: [
        'BEGIN RSA PRIVATE KEY',
        'BEGIN PRIVATE KEY',
        'BEGIN EC PRIVATE KEY',
        'BEGIN DSA PRIVATE KEY',
        'BEGIN OPENSSH PRIVATE KEY',
      ],
    },
    {
      id: 'aws-secret-key',
      description: 'AWS / S3 Secret Key Pattern',
      regex: /(?:aws_secret_access_key|s3_secret_key)\s*[:=]\s*['"][0-9a-zA-Z\/+=]{40}['"]/i,
      keywords: ['aws_secret_access_key', 's3_secret_key'],
    },
  ];

  if (content.includes('[extend]') && /useDefault\s*=\s*true/i.test(content)) {
    rules.push(...defaultRules);
  }

  // Parse [[rules]]
  const ruleBlocks = content.split('[[rules]]').slice(1);
  for (const block of ruleBlocks) {
    const idMatch = block.match(/id\s*=\s*["']([^"']+)["']/);
    const descMatch = block.match(/description\s*=\s*["']([^"']+)["']/);
    const regexMatch = block.match(
      /regex\s*=\s*(?:'''([\s\S]*?)'''|"""([\s\S]*?)"""|"([^"]+)"|'([^']+)')/
    );

    if (idMatch && regexMatch) {
      const id = idMatch[1];
      const description = descMatch ? descMatch[1] : id;
      let rawRegex = regexMatch[1] || regexMatch[2] || regexMatch[3] || regexMatch[4];

      let flags = '';
      if (rawRegex.startsWith('(?i)')) {
        flags += 'i';
        rawRegex = rawRegex.substring(4);
      }

      // Parse keywords if present
      const keywordsMatch = block.match(/keywords\s*=\s*\[([\s\S]*?)\]/);
      const keywords: string[] = [];
      if (keywordsMatch) {
        const kwRegex = /"([^"]+)"|'([^']+)'/g;
        let kw: RegExpExecArray | null;
        while ((kw = kwRegex.exec(keywordsMatch[1])) !== null) {
          keywords.push(kw[1] || kw[2]);
        }
      }

      try {
        rules.push({
          id,
          description,
          regex: new RegExp(rawRegex, flags),
          keywords: keywords.length > 0 ? keywords : undefined,
        });
      } catch (err: any) {
        console.warn(
          `[verify-secrets] Warning: Unable to compile regex for rule ${id}: ${err.message}`
        );
      }
    }
  }

  return {
    title: 'Ship Dễ Secret Detection Rules',
    allowlistPaths,
    rules,
  };
}

export function scanFile(
  filePath: string,
  rules: SecretRule[]
): { file: string; line: number; ruleId: string; description: string }[] {
  const findings: {
    file: string;
    line: number;
    ruleId: string;
    description: string;
  }[] = [];
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const rule of rules) {
        if (rule.regex.test(line)) {
          findings.push({
            file: filePath,
            line: i + 1,
            ruleId: rule.id,
            description: rule.description,
          });
        }
      }
    }
  } catch {
    // Ignore unreadable/binary files
  }
  return findings;
}

function isPathAllowed(relPath: string, allowlistPaths: RegExp[]): boolean {
  const normalized = relPath.replace(/\\/g, '/');
  for (const regex of allowlistPaths) {
    if (regex.test(normalized) || regex.test(relPath)) {
      return true;
    }
  }
  return false;
}

export function walkDir(
  dir: string,
  rootDir: string,
  allowlistPaths: RegExp[],
  fileList: string[] = [],
  fsImpl: { readdirSync: typeof fs.readdirSync } = fs
): string[] {
  const entries = fsImpl.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(rootDir, fullPath);

    if (entry.isDirectory()) {
      if (isIgnoredScanName(entry.name)) {
        continue;
      }
      if (!isPathAllowed(relPath + '/', allowlistPaths)) {
        walkDir(fullPath, rootDir, allowlistPaths, fileList, fsImpl);
      }
    } else if (entry.isFile()) {
      if (isIgnoredScanName(entry.name)) {
        continue;
      }
      if (!isPathAllowed(relPath, allowlistPaths)) {
        fileList.push(fullPath);
      }
    }
  }
  return fileList;
}

export function getGitleaksScanTargets(
  rootDir: string = process.cwd(),
  fsImpl: { readdirSync: typeof fs.readdirSync } = fs
): string[] {
  const targets: string[] = [];

  function hasAnyIgnoredDescendant(dir: string): boolean {
    const entries = fsImpl.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (isIgnoredScanName(entry.name)) {
        return true;
      }
      if (entry.isDirectory()) {
        if (hasAnyIgnoredDescendant(path.join(dir, entry.name))) {
          return true;
        }
      }
    }
    return false;
  }

  function collectSafeTargets(dir: string) {
    const entries = fsImpl.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (isIgnoredScanName(entry.name)) {
        continue;
      }
      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(rootDir, fullPath);

      if (entry.isDirectory()) {
        if (hasAnyIgnoredDescendant(fullPath)) {
          collectSafeTargets(fullPath);
        } else {
          targets.push(relPath);
        }
      } else if (entry.isFile()) {
        targets.push(relPath);
      }
    }
  }

  collectSafeTargets(rootDir);
  return targets;
}

export interface CleanupFsInterface {
  existsSync: (path: fs.PathLike) => boolean;
  unlinkSync?: (path: fs.PathLike) => void;
  rmSync?: (path: fs.PathLike, options?: fs.RmOptions) => void;
}

export function cleanTemporaryFiles(files: string[], fsImpl: CleanupFsInterface = fs): void {
  const errors: Error[] = [];
  for (const file of files) {
    try {
      if (fsImpl.existsSync(file)) {
        if (typeof fsImpl.unlinkSync === 'function') {
          fsImpl.unlinkSync(file);
        } else if (typeof fsImpl.rmSync === 'function') {
          fsImpl.rmSync(file, { recursive: true, force: true });
        } else {
          fs.unlinkSync(file);
        }
      }
    } catch (err: any) {
      console.error(`❌ LỖI XÓA FILE BÁO CÁO TẠM ${file}: ${err.message}`);
      errors.push(err);
    }
  }
  if (errors.length > 0) {
    throw new Error(`Failed to delete temporary files: ${errors.map((e) => e.message).join('; ')}`);
  }
}

export function executeGitleaks(
  gitleaksBin: string,
  args: string[],
  reportPath: string,
  spawnImpl: typeof spawnSync = spawnSync,
  fsImpl: {
    existsSync: typeof fs.existsSync;
    readFileSync: typeof fs.readFileSync;
  } = fs
): GitleaksExecResult {
  let spawnResult;
  try {
    spawnResult = spawnImpl(gitleaksBin, args, {
      stdio: 'pipe',
      encoding: 'utf-8',
      shell: false,
    });
  } catch (err: any) {
    return {
      success: false,
      exitCode: null,
      findings: [],
      operationalError: `Failed to spawn gitleaks process: ${err.message}`,
    };
  }

  if (spawnResult.error) {
    return {
      success: false,
      exitCode: spawnResult.status ?? null,
      findings: [],
      operationalError: `Gitleaks process execution error: ${spawnResult.error.message}`,
    };
  }

  const exitCode = spawnResult.status;

  if (exitCode === 0) {
    return {
      success: true,
      exitCode: 0,
      findings: [],
    };
  }

  if (exitCode === 1) {
    if (!fsImpl.existsSync(reportPath)) {
      const errOutput = (spawnResult.stderr || spawnResult.stdout || '').trim();
      return {
        success: false,
        exitCode: 1,
        findings: [],
        operationalError: `Gitleaks exited with code 1 (findings detected) but report file was not created: ${reportPath}. Output: ${errOutput}`,
      };
    }

    try {
      const content = fsImpl.readFileSync(reportPath, 'utf-8').trim();
      if (!content) {
        return {
          success: false,
          exitCode: 1,
          findings: [],
          operationalError: `Gitleaks report file is empty: ${reportPath}`,
        };
      }
      const parsed = JSON.parse(content);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        return {
          success: false,
          exitCode: 1,
          findings: [],
          operationalError: `Gitleaks report file does not contain a non-empty findings array: ${reportPath}`,
        };
      }
      return {
        success: true,
        exitCode: 1,
        findings: parsed,
      };
    } catch (parseErr: any) {
      return {
        success: false,
        exitCode: 1,
        findings: [],
        operationalError: `Failed to parse Gitleaks report file ${reportPath}: ${parseErr.message}`,
      };
    }
  }

  const stdErr = (spawnResult.stderr || spawnResult.stdout || '').trim();
  return {
    success: false,
    exitCode: exitCode ?? -1,
    findings: [],
    operationalError: `Gitleaks failed with operational exit code ${exitCode}: ${stdErr}`,
  };
}

export function runSecretScan(rootDir: string = process.cwd(), configPath?: string) {
  const tomlPath = configPath || path.join(rootDir, '.gitleaks.toml');
  const config = parseGitleaksConfig(tomlPath);
  const allFiles = walkDir(rootDir, rootDir, config.allowlistPaths);
  const allFindings: {
    file: string;
    line: number;
    ruleId: string;
    description: string;
  }[] = [];

  for (const file of allFiles) {
    const findings = scanFile(file, config.rules);
    allFindings.push(...findings);
  }

  return {
    rulesCount: config.rules.length,
    filesScanned: allFiles.length,
    findings: allFindings,
  };
}

export function runNegativeCliTest(
  gitleaksBin: string,
  dependencies: {
    fsImpl?: typeof fs;
    spawnImpl?: typeof spawnSync;
    rootDir?: string;
  } = {}
): { exitCode: number; message?: string } {
  const fsImpl = dependencies.fsImpl || fs;
  const rootDir = dependencies.rootDir || process.cwd();
  console.log('🧪 Chạy kiểm thử âm tính (Demonstrated Negative Failure Proof)...');
  const tokenHeader = ['ghn', 'live'].join('_');
  const fakeSecretContent = `// Temporary negative test fixture\nconst carrierLiveKey = "${tokenHeader}_98421039841298412";\n`;
  const tempFile = path.join(rootDir, 'test-negative-secret-fixture.js');
  const reportFile = path.join(rootDir, '.temp-gitleaks-negative-report.json');

  fsImpl.writeFileSync(tempFile, fakeSecretContent, 'utf-8');
  const tempFilesToClean = [tempFile, reportFile];
  let outcome: { exitCode: number; message?: string } = {
    exitCode: 2,
    message: 'Uninitialized',
  };

  try {
    const result = executeGitleaks(
      gitleaksBin,
      [
        'dir',
        tempFile,
        '-c',
        path.join(rootDir, '.gitleaks.toml'),
        '--report-path',
        reportFile,
        '--report-format',
        'json',
        '--redact',
        '--verbose',
      ],
      reportFile,
      dependencies.spawnImpl,
      fsImpl
    );

    if (!result.success) {
      console.error(
        `❌ LỖI THỰC THI GITLEAKS (KHÔNG PHẢI PHÁT HIỆN SECRET): ${result.operationalError}`
      );
      outcome = { exitCode: 2, message: result.operationalError };
    } else if (result.findings.length > 0) {
      const targetFinding =
        result.findings.find(
          (f: any) => f.RuleID === 'shipde-carrier-live-token' || f.RuleID === 'carrier-live-token'
        ) || result.findings[0];
      const findingDetails = `[${targetFinding.RuleID}] "${targetFinding.Description}" tại ${targetFinding.File}:${targetFinding.StartLine}`;
      console.error(`🚨 VI PHẠM ĐÃ ĐƯỢC BẮT CHÍNH XÁC QUA RULE: ${findingDetails}`);
      console.error(
        '   [AC-FOUND-01-06 Evidence] Đã chứng minh gate thoát mã lỗi non-zero (exit code 1) khi phát hiện fixture rò rỉ secret thực tế.\n'
      );
      outcome = {
        exitCode: 1,
        message: 'Detected secret finding in negative fixture',
      };
    } else {
      console.error('❌ LỖI: Bộ quét KHÔNG phát hiện được vi phạm trong bài test âm tính!');
      outcome = {
        exitCode: 2,
        message: 'Negative test failed to detect secret',
      };
    }
  } catch (err: any) {
    outcome = {
      exitCode: 2,
      message: `Unexpected error in negative test: ${err.message}`,
    };
  } finally {
    try {
      cleanTemporaryFiles(tempFilesToClean, fsImpl);
    } catch (cleanupErr: any) {
      console.error(`❌ LỖI DỌN DẸP BÁO CÁO TẠM TRONG NEGATIVE TEST: ${cleanupErr.message}`);
      outcome = { exitCode: 2, message: cleanupErr.message };
    }
  }
  return outcome;
}

export function runCliVerification(
  args: string[] = process.argv.slice(2),
  dependencies: {
    fsImpl?: typeof fs;
    spawnImpl?: typeof spawnSync;
    getBin?: typeof getGitleaksBinary;
    rootDir?: string;
    baseCommit?: string | null;
    resolveGitCommit?: (ref: string) => string | null;
  } = {}
): {
  exitCode: number;
  message?: string;
} {
  const fsImpl = dependencies.fsImpl || fs;
  const rootDir = dependencies.rootDir || process.cwd();
  const getBin = dependencies.getBin || getGitleaksBinary;
  const isNegativeTest = args.includes('--test-negative');
  const configPath = path.join(rootDir, '.gitleaks.toml');

  console.log('================================================================');
  console.log('🔒 SHIP DỄ — BỘ QUÉT BẢO MẬT & CHỐNG LỘ BÍ MẬT (SECRET SCANNER)');
  console.log('================================================================\n');

  let config;
  try {
    config = parseGitleaksConfig(configPath);
  } catch (err: any) {
    console.error(`❌ LỖI NẠP CẤU HÌNH GITLEAKS: ${err.message}`);
    return {
      exitCode: 2,
      message: `Configuration load failure: ${err.message}`,
    };
  }

  console.log(`Đã nạp thành công ${config.rules.length} quy tắc từ .gitleaks.toml:`);
  for (const r of config.rules) {
    console.log(` - [${r.id}] ${r.description}`);
  }
  console.log('');

  const gitleaksBin = getBin();
  if (!gitleaksBin) {
    console.error(
      '❌ LỖI: Không tìm thấy native binary Gitleaks CLI (gitleaks) trong PATH hoặc môi trường hệ thống!'
    );
    console.error(
      '   Gate bảo mật secret bắt buộc phải có Gitleaks native CLI để đảm bảo toàn bộ quy tắc mặc định và quy tắc mở rộng hoạt động đầy đủ.'
    );
    return { exitCode: 2, message: 'Gitleaks binary not found' };
  }

  if (isNegativeTest) {
    return runNegativeCliTest(gitleaksBin, {
      fsImpl,
      spawnImpl: dependencies.spawnImpl,
      rootDir,
    });
  }

  console.log('🔍 Thực thi Gitleaks native binary CLI...');
  const tempFilesToClean: string[] = [];
  let outcome: { exitCode: number; message?: string } = {
    exitCode: 2,
    message: 'Scan incomplete',
  };

  try {
    let hasOperationalError = false;
    let hasFinding = false;

    const isGitRepo =
      fsImpl.existsSync(path.join(rootDir, '.git')) || dependencies.baseCommit !== undefined;
    if (isGitRepo) {
      const resolveGitCommit =
        dependencies.resolveGitCommit ||
        ((ref: string): string | null => {
          try {
            const normalizedRootDir = path.resolve(rootDir).replace(/\\/g, '/');
            return execFileSync(
              'git',
              [
                '-c',
                `safe.directory=${normalizedRootDir}`,
                'rev-parse',
                '--verify',
                '--quiet',
                `${ref}^{commit}`,
              ],
              {
                stdio: 'pipe',
                shell: false,
                cwd: rootDir,
              }
            )
              .toString()
              .trim();
          } catch {
            return null;
          }
        });

      let baseCommit: string | null =
        dependencies.baseCommit !== undefined ? dependencies.baseCommit : null;

      if (dependencies.baseCommit === undefined) {
        if (process.env.BASE_SHA) {
          baseCommit = resolveGitCommit(process.env.BASE_SHA);
          if (!baseCommit) {
            console.error(
              `❌ LỖI: BASE_SHA được cung cấp '${process.env.BASE_SHA}' không hợp lệ hoặc không thể resolve thành commit!`
            );
            outcome = { exitCode: 2, message: 'Invalid BASE_SHA' };
            hasOperationalError = true;
          }
        } else if (process.env.GITHUB_BASE_REF) {
          baseCommit =
            resolveGitCommit(`origin/${process.env.GITHUB_BASE_REF}`) ||
            resolveGitCommit(process.env.GITHUB_BASE_REF);
        }

        if (!hasOperationalError && !baseCommit) {
          baseCommit =
            resolveGitCommit('origin/main') ||
            resolveGitCommit('main') ||
            resolveGitCommit('HEAD~1');
        }

        if (!hasOperationalError && !baseCommit) {
          console.error('❌ LỖI: Không thể xác định commit base để quét lịch sử git!');
          outcome = { exitCode: 2, message: 'Cannot resolve base commit' };
          hasOperationalError = true;
        }
      }

      if (!hasOperationalError && baseCommit) {
        const logRange = `${baseCommit}...HEAD`;
        console.log(`🔍 [Gitleaks git] Quét lịch sử commit PR (${logRange})...`);
        const gitReportFile = path.join(rootDir, '.temp-gitleaks-git-report.json');
        tempFilesToClean.push(gitReportFile);

        const gitResult = executeGitleaks(
          gitleaksBin,
          [
            'git',
            `--log-opts=${logRange}`,
            '-c',
            configPath,
            '--report-path',
            gitReportFile,
            '--report-format',
            'json',
            '--redact',
            '--verbose',
          ],
          gitReportFile,
          dependencies.spawnImpl,
          fsImpl
        );

        if (!gitResult.success) {
          console.error(`❌ LỖI THỰC THI GITLEAKS TRÊN LỊCH SỬ GIT: ${gitResult.operationalError}`);
          outcome = { exitCode: 2, message: gitResult.operationalError };
          hasOperationalError = true;
        } else if (gitResult.findings.length > 0) {
          console.error(
            `\n❌ Gitleaks phát hiện ${gitResult.findings.length} vi phạm bí mật trong lịch sử git:`
          );
          for (const f of gitResult.findings) {
            console.error(
              ` - [${f.RuleID}] ${f.File || f.Commit}:${f.StartLine || ''} (${f.Description})`
            );
          }
          outcome = { exitCode: 1, message: 'Secrets detected in git history' };
          hasFinding = true;
        }
      }
    }

    if (!hasOperationalError) {
      console.log('🔍 [Gitleaks dir] Quét working tree các thư mục và tệp mã nguồn...');
      let scanTargets: string[] = [];
      try {
        scanTargets = getGitleaksScanTargets(rootDir, fsImpl);
      } catch (err: any) {
        console.error(`❌ LỖI ENUMERATION THƯ MỤC KHI QUÉT SECRET: ${err.message}`);
        outcome = {
          exitCode: 2,
          message: `Directory enumeration failed: ${err.message}`,
        };
        hasOperationalError = true;
      }

      if (!hasOperationalError) {
        if (scanTargets.length === 0) {
          console.error(
            '❌ LỖI: Không tìm thấy bất kỳ target hợp lệ nào để quét trong working tree!'
          );
          outcome = { exitCode: 2, message: 'No valid scan targets found' };
          hasOperationalError = true;
        } else {
          const allDirFindings: any[] = [];

          for (let idx = 0; idx < scanTargets.length; idx++) {
            const target = scanTargets[idx];
            const targetReport = path.join(rootDir, `.temp-gitleaks-target-${idx}-report.json`);
            tempFilesToClean.push(targetReport);

            const dirResult = executeGitleaks(
              gitleaksBin,
              [
                'dir',
                path.resolve(rootDir, target),
                '-c',
                configPath,
                '--report-path',
                targetReport,
                '--report-format',
                'json',
                '--redact',
                '--verbose',
              ],
              targetReport,
              dependencies.spawnImpl,
              fsImpl
            );

            if (!dirResult.success) {
              console.error(
                `❌ LỖI THỰC THI GITLEAKS TRÊN TARGET "${target}": ${dirResult.operationalError}`
              );
              outcome = { exitCode: 2, message: dirResult.operationalError };
              hasOperationalError = true;
              break;
            }

            if (dirResult.findings.length > 0) {
              allDirFindings.push(...dirResult.findings);
            }
          }

          if (!hasOperationalError) {
            if (allDirFindings.length > 0) {
              console.error(
                `\n❌ Gitleaks phát hiện ${allDirFindings.length} vi phạm bí mật trong working tree:`
              );
              for (const f of allDirFindings) {
                console.error(
                  ` - [${f.RuleID}] ${f.File || f.Commit}:${f.StartLine || ''} (${f.Description})`
                );
              }
              outcome = {
                exitCode: 1,
                message: 'Secrets detected in working tree',
              };
            } else if (!hasFinding) {
              console.log(
                '\n✅ Quét secret hoàn tất: 0 phát hiện vi phạm bí mật trên commit history và working tree.'
              );
              outcome = { exitCode: 0 };
            }
          }
        }
      }
    }
  } catch (err: any) {
    outcome = {
      exitCode: 2,
      message: `Unexpected operational error: ${err.message}`,
    };
  } finally {
    try {
      cleanTemporaryFiles(tempFilesToClean, fsImpl);
    } catch (cleanupErr: any) {
      console.error(`❌ LỖI DỌN DẸP BÁO CÁO TẠM: ${cleanupErr.message}`);
      outcome = { exitCode: 2, message: cleanupErr.message };
    }
  }
  return outcome;
}

// CLI entrypoint
if (require.main === module) {
  const outcome = runCliVerification();
  process.exit(outcome.exitCode);
}
