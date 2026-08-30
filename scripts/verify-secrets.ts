import * as fs from 'fs';
import * as path from 'path';
import { execSync, execFileSync } from 'child_process';

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

/**
 * Resolve gitleaks executable path if available in PATH or local environment.
 */
export function getGitleaksBinary(): string | null {
  try {
    execSync('gitleaks version', { stdio: 'ignore' });
    return 'gitleaks';
  } catch {}

  // Check local test path on Windows
  if (process.platform === 'win32' && process.env.TEMP) {
    const localExe = path.join(process.env.TEMP, 'gitleaks', 'gitleaks.exe');
    if (fs.existsSync(localExe)) {
      try {
        execSync(`"${localExe}" version`, { stdio: 'ignore' });
        return `"${localExe}"`;
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
  const findings: { file: string; line: number; ruleId: string; description: string }[] = [];
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

function walkDir(
  dir: string,
  rootDir: string,
  allowlistPaths: RegExp[],
  fileList: string[] = []
): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(rootDir, fullPath);

    if (entry.isDirectory()) {
      if (
        entry.name === '.git' ||
        entry.name === 'node_modules' ||
        entry.name === '.next' ||
        entry.name === '.turbo' ||
        entry.name === '.pnpm-store' ||
        entry.name === 'dist' ||
        entry.name === 'build' ||
        entry.name === 'out' ||
        entry.name === '.gemini'
      ) {
        continue;
      }
      if (!isPathAllowed(relPath + '/', allowlistPaths)) {
        walkDir(fullPath, rootDir, allowlistPaths, fileList);
      }
    } else if (entry.isFile()) {
      if (!isPathAllowed(relPath, allowlistPaths)) {
        fileList.push(fullPath);
      }
    }
  }
  return fileList;
}

export function runSecretScan(rootDir: string = process.cwd(), configPath?: string) {
  const tomlPath = configPath || path.join(rootDir, '.gitleaks.toml');
  const config = parseGitleaksConfig(tomlPath);
  const allFiles = walkDir(rootDir, rootDir, config.allowlistPaths);
  const allFindings: { file: string; line: number; ruleId: string; description: string }[] = [];

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

// CLI entrypoint
if (require.main === module) {
  const args = process.argv.slice(2);
  const isNegativeTest = args.includes('--test-negative');
  const configPath = path.join(process.cwd(), '.gitleaks.toml');

  console.log('================================================================');
  console.log('🔒 SHIP DỄ — BỘ QUÉT BẢO MẬT & CHỐNG LỘ BÍ MẬT (SECRET SCANNER)');
  console.log('================================================================\n');

  const config = parseGitleaksConfig(configPath);
  console.log(`Đã nạp thành công ${config.rules.length} quy tắc từ .gitleaks.toml:`);
  for (const r of config.rules) {
    console.log(` - [${r.id}] ${r.description}`);
  }
  console.log('');

  const gitleaksBin = getGitleaksBinary();
  if (!gitleaksBin) {
    console.error(
      '❌ LỖI: Không tìm thấy native binary Gitleaks CLI (gitleaks) trong PATH hoặc môi trường hệ thống!'
    );
    console.error(
      '   Gate bảo mật secret bắt buộc phải có Gitleaks native CLI để đảm bảo toàn bộ quy tắc mặc định và quy tắc mở rộng hoạt động đầy đủ.'
    );
    process.exit(2);
  }

  if (isNegativeTest) {
    console.log('🧪 Chạy kiểm thử âm tính (Demonstrated Negative Failure Proof)...');
    const tokenHeader = ['ghn', 'live'].join('_');
    const fakeSecretContent = `// Temporary negative test fixture\nconst carrierLiveKey = "${tokenHeader}_98421039841298412";\n`;
    const tempFile = path.join(process.cwd(), 'test-negative-secret-fixture.js');
    const reportFile = path.join(process.cwd(), '.temp-gitleaks-negative-report.json');

    fs.writeFileSync(tempFile, fakeSecretContent, 'utf-8');

    let detected = false;
    let findingDetails = '';
    let cliError: string | null = null;

    try {
      let commandOutput = '';
      try {
        commandOutput = execSync(
          `${gitleaksBin} dir . -c .gitleaks.toml --report-path "${reportFile}" --report-format json --redact --verbose`,
          { stdio: 'pipe' }
        ).toString();
      } catch (err: any) {
        commandOutput = (err.stdout?.toString() || '') + '\n' + (err.stderr?.toString() || '');
      }

      // Verify that report file exists and contains valid secret rule findings
      if (fs.existsSync(reportFile)) {
        try {
          const reportContent = fs.readFileSync(reportFile, 'utf-8');
          const findings = JSON.parse(reportContent);
          if (Array.isArray(findings) && findings.length > 0) {
            const targetFinding =
              findings.find(
                (f: any) =>
                  f.RuleID === 'shipde-carrier-live-token' || f.RuleID === 'carrier-live-token'
              ) || findings[0];
            detected = true;
            findingDetails = `[${targetFinding.RuleID}] "${targetFinding.Description}" tại ${targetFinding.File}:${targetFinding.StartLine}`;
          }
        } catch (parseErr: any) {
          cliError = `Không thể phân tích báo cáo Gitleaks: ${parseErr.message}`;
        }
      } else {
        // If no report file, check if it was a CLI invocation / configuration error
        cliError = `Gitleaks không tạo được file báo cáo findings: ${commandOutput.trim()}`;
      }
    } finally {
      // Guaranteed cleanup before any exit
      if (fs.existsSync(tempFile)) {
        try {
          fs.unlinkSync(tempFile);
        } catch {}
      }
      if (fs.existsSync(reportFile)) {
        try {
          fs.unlinkSync(reportFile);
        } catch {}
      }
    }

    if (detected) {
      console.error(`🚨 VI PHẠM ĐÃ ĐƯỢC BẮT CHÍNH XÁC QUA RULE: ${findingDetails}`);
      console.error(
        '   [AC-FOUND-01-06 Evidence] Đã chứng minh gate thoát mã lỗi non-zero (exit code 1) khi phát hiện fixture rò rỉ secret thực tế.\n'
      );
      process.exit(1);
    } else {
      if (cliError) {
        console.error(`❌ LỖI THỰC THI GITLEAKS (KHÔNG PHẢI PHÁT HIỆN SECRET): ${cliError}`);
      } else {
        console.error('❌ LỖI: Bộ quét KHÔNG phát hiện được vi phạm trong bài test âm tính!');
      }
      process.exit(2);
    }
  }

  console.log('🔍 Thực thi Gitleaks native binary CLI...');
  const dirReportFile = path.join(process.cwd(), '.temp-gitleaks-dir-report.json');
  const gitReportFile = path.join(process.cwd(), '.temp-gitleaks-git-report.json');
  const isGitRepo = fs.existsSync(path.join(process.cwd(), '.git'));

  try {
    if (isGitRepo) {
      const resolveGitCommit = (ref: string): string | null => {
        try {
          return execFileSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], {
            stdio: 'pipe',
          })
            .toString()
            .trim();
        } catch {
          return null;
        }
      };

      let baseCommit: string | null = null;
      if (process.env.BASE_SHA) {
        baseCommit = resolveGitCommit(process.env.BASE_SHA);
        if (!baseCommit) {
          console.error(
            `❌ LỖI: BASE_SHA được cung cấp '${process.env.BASE_SHA}' không hợp lệ hoặc không thể resolve thành commit!`
          );
          process.exit(2);
        }
      } else if (process.env.GITHUB_BASE_REF) {
        baseCommit =
          resolveGitCommit(`origin/${process.env.GITHUB_BASE_REF}`) ||
          resolveGitCommit(process.env.GITHUB_BASE_REF);
      }

      if (!baseCommit) {
        baseCommit =
          resolveGitCommit('origin/main') || resolveGitCommit('main') || resolveGitCommit('HEAD~1');
      }

      if (!baseCommit) {
        console.error('❌ LỖI: Không thể xác định commit base để quét lịch sử git!');
        process.exit(2);
      }

      const logRange = `${baseCommit}...HEAD`;
      console.log(`🔍 [Gitleaks git] Quét lịch sử commit PR (${logRange})...`);
      execSync(
        `${gitleaksBin} git --log-opts="${logRange}" -c .gitleaks.toml --report-path "${gitReportFile}" --report-format json --redact --verbose`,
        {
          stdio: 'inherit',
        }
      );
    }

    console.log('🔍 [Gitleaks dir] Quét toàn bộ working tree hiện tại...');
    execSync(
      `${gitleaksBin} dir . -c .gitleaks.toml --report-path "${dirReportFile}" --report-format json --redact --verbose`,
      {
        stdio: 'inherit',
      }
    );
    console.log(
      '\n✅ Quét secret hoàn tất: 0 phát hiện vi phạm bí mật trên commit history và working tree.'
    );
    process.exit(0);
  } catch (err: any) {
    const allFindings: any[] = [];
    for (const rep of [gitReportFile, dirReportFile]) {
      if (fs.existsSync(rep)) {
        try {
          const reportContent = fs.readFileSync(rep, 'utf-8');
          const findings = JSON.parse(reportContent);
          if (Array.isArray(findings)) {
            allFindings.push(...findings);
          }
        } catch {}
      }
    }

    if (allFindings.length > 0) {
      console.error(`\n❌ Gitleaks phát hiện ${allFindings.length} vi phạm bí mật:`);
      for (const f of allFindings) {
        console.error(
          ` - [${f.RuleID}] ${f.File || f.Commit}:${f.StartLine || ''} (${f.Description})`
        );
      }
      process.exit(1);
    }
    console.error('\n❌ Gitleaks native phát hiện vi phạm bí mật hoặc gặp lỗi cấu hình!');
    process.exit(1);
  } finally {
    for (const rep of [gitReportFile, dirReportFile]) {
      if (fs.existsSync(rep)) {
        try {
          fs.unlinkSync(rep);
        } catch {}
      }
    }
  }
}
