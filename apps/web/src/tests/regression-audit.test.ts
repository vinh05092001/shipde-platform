// ============================================================================
// Ship Dễ — Regression Audit Test Suite
// Kiểm toán hồi quy tính nhất quán dữ liệu, phân quyền và luật nghiệp vụ
// ============================================================================

import {
  MASTER_SHIPMENTS,
  MASTER_EXCEPTIONS,
  MASTER_DISCREPANCIES,
  MASTER_CLAIMS,
  getUnifiedMetrics,
} from '../services/unifiedDataStore';
import { MakerCheckerEngine } from '../core/maker-checker';
import { DiscrepancyResolution } from '../types/domain';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`❌ FAILED: ${message}`);
  }
  console.log(`✅ PASS: ${message}`);
}

async function runRegressionSuite() {
  console.log('\n================================================================');
  console.log('🏁 CHẠY KIỂM TOÁN HỒI QUY DỮ LIỆU & QUY TẮC NGHIỆP VỤ SHIP DỄ');
  console.log('================================================================\n');

  // Test 1: Data Count Invariants
  const metrics = getUnifiedMetrics();
  assert(
    metrics.totalShipments === 50,
    `Tổng số bưu kiện trong kho dữ liệu chuẩn là 50 (Thực tế: ${metrics.totalShipments})`
  );
  assert(
    MASTER_SHIPMENTS.length === 50,
    `Danh sách bưu kiện đồng bộ 100% với metrics (50 bản ghi)`
  );
  assert(
    metrics.openExceptionsCount ===
      MASTER_EXCEPTIONS.filter((e) => e.status === 'OPEN' || e.status === 'ASSIGNED').length,
    `Badge Hộp việc và danh sách sự cố mở khớp số lượng (${metrics.openExceptionsCount})`
  );
  assert(
    metrics.openDiscrepanciesCount ===
      MASTER_DISCREPANCIES.filter((d) => d.status === 'OPEN').length,
    `Badge Khoản lệch và bảng đối soát khớp số lượng (${metrics.openDiscrepanciesCount})`
  );

  // Test 2: Maker-Checker Segregation of Duties (BR-12)
  const mcEngine = new MakerCheckerEngine();
  const disc1 = MASTER_DISCREPANCIES[0]; // created_by_user = 'usr_02' (CSKH Hoa)

  // Case 2a: User CSKH Hoa cố gắng tự duyệt chênh lệch do chính mình tạo -> Bị chặn
  let selfApprovalBlocked = false;
  const mockShipment = {
    id: 'shp_001',
    merchant_id: 'merc_01',
    order_id: 'ord_01',
    order_code: 'ORD_01',
    carrier_code: 'GHN' as any,
    carrier_account_id: 'acc_01',
    tracking_code: disc1.tracking_code,
    current_status: 'delivered' as any,
    declared_weight_g: 350,
    quoted_fee: 22000,
    cod_amount: 450000,
    created_at: new Date(),
    version: 1,
    last_modified_by: 'usr_02',
  };

  try {
    mcEngine.resolveDiscrepancy(
      {
        id: disc1.id,
        merchant_id: 'merc_01',
        shipment_id: 'shp_001',
        statement_row_id: 'stmt_01',
        type: disc1.type as any,
        tracking_code: disc1.tracking_code,
        amount: 7000,
        status: DiscrepancyResolution.OPEN,
        created_by_user: 'usr_02',
        version: 1,
        created_at: new Date(),
      },
      mockShipment,
      {
        discrepancy_id: disc1.id,
        resolution: DiscrepancyResolution.CONFIRMED,
        reason: 'Tôi tự duyệt',
        user_id: 'usr_02', // Cố tình tự duyệt
        user_name: 'Trần Thị Hoa',
        expected_version: 1,
      }
    );
  } catch (err: any) {
    if (
      err.code === 'self_approval_forbidden' ||
      err.message?.includes('tách quyền') ||
      err.message?.includes('không thể tự duyệt')
    ) {
      selfApprovalBlocked = true;
    }
  }
  assert(
    selfApprovalBlocked,
    'Quy tắc BR-12: Chặn tuyệt đối người tạo (CSKH) tự duyệt khoản chênh lệch tài chính'
  );

  // Case 2b: Kế toán viên độc lập (usr_03) duyệt chênh lệch -> Thành công
  const testDiscrepancy = {
    id: disc1.id,
    merchant_id: 'merc_01',
    shipment_id: 'shp_001',
    tracking_code: disc1.tracking_code,
    type: disc1.type as any,
    amount: 7000,
    status: DiscrepancyResolution.OPEN,
    created_by_user: 'usr_02',
    version: 1,
    created_at: new Date(),
  };

  const resolved = mcEngine.resolveDiscrepancy(testDiscrepancy as any, mockShipment, {
    discrepancy_id: disc1.id,
    resolution: DiscrepancyResolution.CONFIRMED,
    reason: 'Đã xác minh bảng kê hợp đồng',
    user_id: 'usr_03', // Kế toán duyệt
    user_name: 'Lê Minh Kế Toán',
    expected_version: 1,
  });
  assert(
    resolved.status === DiscrepancyResolution.CONFIRMED && resolved.version === 2,
    'Kế toán viên độc lập duyệt chênh lệch thành công và tăng version lên 2'
  );

  // Test 3: Total Discrepancy Sum Consistency
  const sumAmount = MASTER_DISCREPANCIES.reduce((sum, d) => sum + d.discrepancy_amount, 0);
  assert(
    sumAmount === 1978000,
    `Tổng số tiền lệch D1..D7 tính toán chính xác từ từng dòng: 1.978.000 đ (Thực tế: ${sumAmount.toLocaleString('vi-VN')} đ)`
  );

  // Test 4: Build artifact preservation invariant
  if (typeof window === 'undefined') {
    const fs = await import('fs');
    const path = await import('path');
    let webDir = process.cwd();
    if (
      !fs.existsSync(path.join(webDir, '.next')) &&
      fs.existsSync(path.join(webDir, 'apps', 'web', '.next'))
    ) {
      webDir = path.join(webDir, 'apps', 'web');
    }
    const nextDir = path.join(webDir, '.next');
    assert(fs.existsSync(nextDir), 'apps/web/.next build directory must exist and be preserved');
    const prerenderManifest = path.join(nextDir, 'prerender-manifest.json');
    assert(
      fs.existsSync(prerenderManifest),
      'apps/web/.next/prerender-manifest.json must exist and remain uncorrupted'
    );
    const buildManifest = path.join(nextDir, 'build-manifest.json');
    assert(
      fs.existsSync(buildManifest),
      'apps/web/.next/build-manifest.json must exist and remain uncorrupted'
    );
  }

  // Test 5: Secret Scanner Robustness, Shell-Metacharacter Safety, Fail-Closed & Mock-Injected Negative Proofs
  if (typeof window === 'undefined') {
    const fs = await import('fs');
    const path = await import('path');
    const os = await import('os');
    let rootDir = process.cwd();
    if (fs.existsSync(path.join(rootDir, '../../scripts/verify-secrets.ts'))) {
      rootDir = path.resolve(rootDir, '../..');
    }
    const verifySecretsScript = path.join(rootDir, 'scripts', 'verify-secrets.ts');
    const rootConfigPath = path.join(rootDir, '.gitleaks.toml');

    assert(
      fs.existsSync(verifySecretsScript) && fs.existsSync(rootConfigPath),
      'verify-secrets.ts and .gitleaks.toml must exist in repository root'
    );

    const { pathToFileURL } = await import('url');
    const {
      executeGitleaks,
      isIgnoredScanName,
      getGitleaksScanTargets,
      cleanTemporaryFiles,
      runCliVerification,
      walkDir,
    } = await import(pathToFileURL(verifySecretsScript).href);

    // Snapshot initial temporary files in root directory to distinguish pre-existing artifacts from newly created ones
    const initialTempReports = new Set(
      fs
        .readdirSync(rootDir)
        .filter(
          (entry: string) =>
            entry.startsWith('.temp-gitleaks') || entry.startsWith('test-negative-secret-fixture')
        )
    );

    // Create an isolated temporary directory for running all CLI and scanner regression tests
    const isolatedTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-scanner-test-'));
    const isolatedConfigPath = path.join(isolatedTempDir, '.gitleaks.toml');
    fs.copyFileSync(rootConfigPath, isolatedConfigPath);
    // Create a dummy safe source file in isolatedTempDir so target scanning finds safe targets
    fs.mkdirSync(path.join(isolatedTempDir, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(isolatedTempDir, 'src', 'safe.ts'),
      'export const safeValue = 123;\n',
      'utf-8'
    );

    try {
      // 5a. Shell-metacharacter path safety (No command injection)
      const metacharFixture = path.join(
        isolatedTempDir,
        '.temp-gitleaks-test-$(echo_safe)-fixture.js'
      );
      const metacharReport = path.join(isolatedTempDir, '.temp-gitleaks-test-metachar-report.json');
      fs.writeFileSync(
        metacharFixture,
        '// Safe file with shell metacharacters in filename\nconst safeConst = 12345;\n',
        'utf-8'
      );
      try {
        let capturedArgs: string[] = [];
        let capturedOptions: any = {};
        const mockSafeSpawn = (bin: string, args: string[], options: any) => {
          capturedArgs = args;
          capturedOptions = options;
          return {
            status: 0,
            stdout: '',
            stderr: '',
            error: undefined,
          };
        };
        const metacharResult = executeGitleaks(
          'mock-gitleaks',
          [
            'dir',
            metacharFixture,
            '-c',
            isolatedConfigPath,
            '--report-path',
            metacharReport,
            '--report-format',
            'json',
            '--redact',
          ],
          metacharReport,
          mockSafeSpawn as any
        );
        assert(
          metacharResult.success &&
            metacharResult.exitCode === 0 &&
            capturedOptions.shell === false &&
            capturedArgs.includes(metacharFixture),
          'Gitleaks CLI executes safely on paths containing shell metacharacters without command injection (shell: false)'
        );
      } finally {
        cleanTemporaryFiles([metacharFixture, metacharReport]);
      }

      // 5b. Deterministic fail-closed on directory enumeration failure (DI mock)
      let readdirThrown = false;
      try {
        const mockFailingFs = {
          readdirSync: () => {
            throw new Error('EACCES: permission denied, scan directory unreadable');
          },
        };
        getGitleaksScanTargets(isolatedTempDir, mockFailingFs as any);
      } catch (err: any) {
        if (err.message.includes('EACCES')) {
          readdirThrown = true;
        }
      }
      assert(
        readdirThrown,
        'getGitleaksScanTargets fails closed and throws operational error when directory enumeration fails'
      );

      // 5c. Deterministic fail-closed on walkDir failure (DI mock)
      let walkDirThrown = false;
      try {
        const mockFailingFs = {
          readdirSync: () => {
            throw new Error('ENOENT: directory missing during walk');
          },
        };
        walkDir(isolatedTempDir, isolatedTempDir, [], [], mockFailingFs as any);
      } catch (err: any) {
        if (err.message.includes('ENOENT')) {
          walkDirThrown = true;
        }
      }
      assert(
        walkDirThrown,
        'walkDir fails closed and throws operational error when directory enumeration fails'
      );

      // 5d. Scanner operational failure handling (fail-closed on spawn error)
      const failResult = executeGitleaks(
        'nonexistent-gitleaks-binary-xyz',
        ['dir', '.'],
        path.join(isolatedTempDir, '.temp-nonexistent-report.json')
      );
      assert(
        !failResult.success && typeof failResult.operationalError === 'string',
        'executeGitleaks fails closed when scanner binary fails to spawn'
      );

      // 5e. Scanner operational failure on invalid flags (non-zero exit code)
      const mockSpawnExit2 = () => ({
        status: 2,
        stdout: '',
        stderr: 'unknown flag --invalid-flag-that-does-not-exist-xyz',
        error: undefined,
      });
      const invalidFlagResult = executeGitleaks(
        'mock-gitleaks',
        ['--invalid-flag-that-does-not-exist-xyz'],
        path.join(isolatedTempDir, '.temp-invalid-flag-report.json'),
        mockSpawnExit2 as any
      );
      assert(
        !invalidFlagResult.success && typeof invalidFlagResult.operationalError === 'string',
        'executeGitleaks fails closed on non-zero operational exit codes'
      );

      // 5f. Missing report file when scanner exits code 1 (fail-closed)
      const missingReportPath = path.join(isolatedTempDir, '.temp-nonexistent-finding-report.json');
      const mockSpawnExit1 = () => ({
        status: 1,
        stdout: '',
        stderr: 'simulated finding output',
        error: undefined,
      });
      const missingReportResult = executeGitleaks(
        'mock-gitleaks',
        ['dir', '.'],
        missingReportPath,
        mockSpawnExit1 as any,
        { existsSync: () => false, readFileSync: () => '' } as any
      );
      assert(
        !missingReportResult.success &&
          Boolean(missingReportResult.operationalError?.includes('report file was not created')),
        'executeGitleaks fails closed when exit code 1 occurs but report file is missing'
      );

      // 5g. Empty report file when scanner exits code 1 (fail-closed)
      const emptyReportResult = executeGitleaks(
        'mock-gitleaks',
        ['dir', '.'],
        path.join(isolatedTempDir, '.temp-empty-report.json'),
        mockSpawnExit1 as any,
        { existsSync: () => true, readFileSync: () => '   ' } as any
      );
      assert(
        !emptyReportResult.success &&
          Boolean(emptyReportResult.operationalError?.includes('empty')),
        'executeGitleaks fails closed when exit code 1 occurs but report file is empty'
      );

      // 5h. Malformed report JSON handling (fail-closed)
      const malformedReportResult = executeGitleaks(
        'mock-gitleaks',
        ['dir', '.'],
        path.join(isolatedTempDir, '.temp-malformed-report.json'),
        mockSpawnExit1 as any,
        {
          existsSync: () => true,
          readFileSync: () => '{ invalid json :::',
        } as any
      );
      assert(
        !malformedReportResult.success &&
          Boolean(malformedReportResult.operationalError?.includes('Failed to parse')),
        'executeGitleaks fails closed when report file contains malformed JSON'
      );

      // 5i. Deterministic cleanup failure handling in cleanTemporaryFiles (fail-closed)
      let cleanupFailedClosed = false;
      try {
        const mockUnlinkFailingFs = {
          existsSync: () => true,
          unlinkSync: () => {
            throw new Error('EBUSY: resource locked');
          },
        };
        cleanTemporaryFiles(['/mock/path/temp.json'], mockUnlinkFailingFs as any);
      } catch (err: any) {
        if (err.message.includes('EBUSY')) {
          cleanupFailedClosed = true;
        }
      }
      assert(
        cleanupFailedClosed,
        'cleanTemporaryFiles fails closed and throws operational error when unlinking reports fails'
      );

      // 5j-1. Secret found plus cleanup failure -> operational failure (exit code 2) must override finding (exit code 1)
      const mockSpawnFinding = () => ({
        status: 1,
        stdout: '',
        stderr: '',
        error: undefined,
      });
      const mockFsWithLockedSecretReport = {
        ...fs,
        existsSync: (p: string) => (String(p).includes('.temp-gitleaks') ? true : fs.existsSync(p)),
        readFileSync: (p: string, opt: any) =>
          String(p).includes('.temp-gitleaks-negative-report.json')
            ? JSON.stringify([
                {
                  RuleID: 'shipde-carrier-live-token',
                  Description: 'Live carrier token',
                  File: 'test.js',
                  StartLine: 1,
                },
              ])
            : fs.readFileSync(p, opt),
        unlinkSync: (p: string) => {
          if (String(p).includes('.temp-gitleaks')) {
            throw new Error('EPERM: cannot delete temporary report on secret finding branch');
          }
          fs.unlinkSync(p);
        },
      };
      const secretFoundCleanupFailResult = runCliVerification(['--test-negative'], {
        fsImpl: mockFsWithLockedSecretReport as any,
        spawnImpl: mockSpawnFinding as any,
        rootDir: isolatedTempDir,
        getBin: () => 'mock-gitleaks',
      });
      assert(
        secretFoundCleanupFailResult.exitCode === 2 &&
          Boolean(secretFoundCleanupFailResult.message?.includes('cannot delete temporary report')),
        'runCliVerification overrides finding (exit code 1) with exit code 2 when report cleanup fails after secret finding'
      );

      // 5j-2. Clean scan plus cleanup failure -> operational failure (exit code 2) must override clean result (exit code 0)
      const mockSpawnCleanSuccess = () => ({
        status: 0,
        stdout: '',
        stderr: '',
        error: undefined,
      });
      const mockFsWithLockedCleanReport = {
        ...fs,
        existsSync: (p: string) => (String(p).includes('.temp-gitleaks') ? true : fs.existsSync(p)),
        readFileSync: (p: string, opt: any) =>
          String(p).includes('.temp-gitleaks') ? '[]' : fs.readFileSync(p, opt),
        unlinkSync: (p: string) => {
          if (String(p).includes('.temp-gitleaks')) {
            throw new Error('EBUSY: resource locked on clean scan report cleanup');
          }
          fs.unlinkSync(p);
        },
      };
      const cleanScanCleanupFailResult = runCliVerification([], {
        fsImpl: mockFsWithLockedCleanReport as any,
        spawnImpl: mockSpawnCleanSuccess as any,
        rootDir: isolatedTempDir,
        baseCommit: 'mock-base-sha-commit',
        resolveGitCommit: () => 'mock-base-sha-commit',
        getBin: () => 'mock-gitleaks',
      });
      assert(
        cleanScanCleanupFailResult.exitCode === 2 &&
          Boolean(
            cleanScanCleanupFailResult.message?.includes(
              'resource locked on clean scan report cleanup'
            )
          ),
        'runCliVerification overrides clean result (exit code 0) with exit code 2 when report cleanup fails on clean scan'
      );

      // 5j-3. Successful cleanup test -> verifies temporary report removal in isolated directory
      const testTempReport = path.join(isolatedTempDir, '.temp-gitleaks-success-cleanup-test.json');
      fs.writeFileSync(testTempReport, '[]', 'utf-8');
      assert(fs.existsSync(testTempReport), 'Temporary test report must exist before cleanup');
      cleanTemporaryFiles([testTempReport]);
      assert(
        !fs.existsSync(testTempReport),
        'cleanTemporaryFiles must delete temporary report on successful cleanup'
      );

      // 5k. Ignored paths and generated artifact filtering
      assert(
        isIgnoredScanName('.temp-gitleaks-target-0-report.json') &&
          isIgnoredScanName('.temp-gitleaks-git-report.json') &&
          isIgnoredScanName('.temp-gitleaks-negative-report.json'),
        'Temporary gitleaks report filenames are strictly excluded from scanner directory walking'
      );
      assert(
        isIgnoredScanName('.next') &&
          isIgnoredScanName('.turbo') &&
          isIgnoredScanName('.pnpm-store') &&
          isIgnoredScanName('dist') &&
          isIgnoredScanName('node_modules'),
        'Generated build outputs (.next, .turbo, .pnpm-store, dist, node_modules) are strictly excluded from scanner directory walking'
      );
      // 5l. Target discovery excludes temporary reports
      const dummyTempReport = path.join(isolatedTempDir, '.temp-gitleaks-dummy-scan.json');
      fs.writeFileSync(dummyTempReport, '[]', 'utf-8');
      try {
        const targets = getGitleaksScanTargets(isolatedTempDir);
        const includesTemp = targets.some((t: string) => t.includes('.temp-gitleaks'));
        assert(
          !includesTemp,
          'getGitleaksScanTargets strictly excludes .temp-gitleaks files from scan targets'
        );
      } finally {
        cleanTemporaryFiles([dummyTempReport]);
      }
    } finally {
      // Guarantee real filesystem cleanup of the isolated temporary directory
      fs.rmSync(isolatedTempDir, { recursive: true, force: true });
      assert(
        !fs.existsSync(isolatedTempDir),
        `Isolated temporary directory ${isolatedTempDir} must be completely deleted after test run`
      );
    }

    // Assert that the test run left zero new temporary secret scanner reports or fixtures
    const rootDirEntries = fs.readdirSync(rootDir);
    const newlyCreatedTempReports = rootDirEntries.filter(
      (entry: string) =>
        (entry.startsWith('.temp-gitleaks') || entry.startsWith('test-negative-secret-fixture')) &&
        !initialTempReports.has(entry)
    );
    assert(
      newlyCreatedTempReports.length === 0,
      `Repository root must contain zero new temporary secret scanner reports or fixtures created by test run (found: ${newlyCreatedTempReports.join(', ')})`
    );
  }

  // Test 6: Turborepo Test Cache Configuration Invariant
  if (typeof window === 'undefined') {
    const fs = await import('fs');
    const path = await import('path');
    let rootDir = process.cwd();
    if (fs.existsSync(path.join(rootDir, '../../turbo.json'))) {
      rootDir = path.resolve(rootDir, '../..');
    }
    const turboJsonPath = path.join(rootDir, 'turbo.json');
    assert(fs.existsSync(turboJsonPath), 'turbo.json must exist in repository root');
    const turboConfig = JSON.parse(fs.readFileSync(turboJsonPath, 'utf-8'));
    const testTask = turboConfig.tasks?.test;
    assert(
      testTask && testTask.cache === false,
      'turbo.json must configure test task as uncached (cache: false) to prevent environment-sensitive repository state tests from being bypassed by stale cache replays'
    );
  }

  // Test 7: Next.js next-env.d.ts Stability Invariant Across Dev and Build
  if (typeof window === 'undefined') {
    const fs = await import('fs');
    const path = await import('path');
    const cp = await import('child_process');
    let rootDir = process.cwd();
    if (fs.existsSync(path.join(rootDir, '../../turbo.json'))) {
      rootDir = path.resolve(rootDir, '../..');
    }

    const gitignorePath = path.join(rootDir, '.gitignore');
    assert(fs.existsSync(gitignorePath), '.gitignore must exist in root');
    const gitignoreContent = fs.readFileSync(gitignorePath, 'utf-8');
    const gitignoreLines = gitignoreContent.split('\n').map((l) => l.trim());
    assert(
      gitignoreLines.includes('next-env.d.ts'),
      '.gitignore must ignore next-env.d.ts to prevent command-specific generated variants from dirtying git'
    );

    const webTsconfigPath = path.join(rootDir, 'apps/web/tsconfig.json');
    assert(fs.existsSync(webTsconfigPath), 'apps/web/tsconfig.json must exist');
    const tsconfig = JSON.parse(fs.readFileSync(webTsconfigPath, 'utf-8'));
    assert(
      tsconfig.include &&
        tsconfig.include.includes('next-env.d.ts') &&
        tsconfig.include.includes('.next/types/**/*.ts') &&
        tsconfig.include.includes('.next/dev/types/**/*.ts'),
      'apps/web/tsconfig.json must include next-env.d.ts and both dev/prod next route types'
    );

    // Verify git ls-files does not track apps/web/next-env.d.ts
    try {
      const lsResult = cp
        .execFileSync('git', ['ls-files', 'apps/web/next-env.d.ts'], {
          cwd: rootDir,
          encoding: 'utf-8',
        })
        .trim();
      assert(
        lsResult.length === 0,
        `apps/web/next-env.d.ts must not be tracked in git (git ls-files returned: "${lsResult}")`
      );

      // Verify git check-ignore confirms apps/web/next-env.d.ts is ignored
      const checkIgnoreResult = cp
        .execFileSync('git', ['check-ignore', 'apps/web/next-env.d.ts'], {
          cwd: rootDir,
          encoding: 'utf-8',
        })
        .trim();
      assert(
        checkIgnoreResult.endsWith('next-env.d.ts'),
        `apps/web/next-env.d.ts must be matched by git ignore rules (got: "${checkIgnoreResult}")`
      );

      // Test dev generation simulation: ensure writing dev content leaves working tree 100% clean
      const webNextEnvPath = path.join(rootDir, 'apps/web/next-env.d.ts');
      const devContent =
        '/// <reference types="next" />\n/// <reference types="next/image-types/global" />\nimport "./.next/dev/types/routes.d.ts";\n\n// NOTE: This file should not be edited\n';
      fs.writeFileSync(webNextEnvPath, devContent, 'utf-8');

      const devStatusResult = cp
        .execFileSync('git', ['status', '--porcelain', 'apps/web/next-env.d.ts'], {
          cwd: rootDir,
          encoding: 'utf-8',
        })
        .trim();
      assert(
        devStatusResult.length === 0,
        `apps/web/next-env.d.ts must not dirty git status during dev generation (got: "${devStatusResult}")`
      );

      // Test build generation simulation: ensure writing build content leaves working tree 100% clean
      const buildContent =
        '/// <reference types="next" />\n/// <reference types="next/image-types/global" />\nimport "./.next/types/routes.d.ts";\n\n// NOTE: This file should not be edited\n';
      fs.writeFileSync(webNextEnvPath, buildContent, 'utf-8');

      const buildStatusResult = cp
        .execFileSync('git', ['status', '--porcelain', 'apps/web/next-env.d.ts'], {
          cwd: rootDir,
          encoding: 'utf-8',
        })
        .trim();
      assert(
        buildStatusResult.length === 0,
        `apps/web/next-env.d.ts must not dirty git status during build generation (got: "${buildStatusResult}")`
      );
    } catch (e: any) {
      if (e.message && e.message.includes('not a git repository')) {
        // Safe fallback in environments without git
      } else {
        throw e;
      }
    }
  }

  console.log('\n================================================================');
  console.log('🎉 TẤT CẢ CÁC BÀI KIỂM TOÁN HỒI QUY ĐẠT 100%');
  console.log('================================================================\n');
}

runRegressionSuite().catch((e) => {
  console.error(e);
  process.exit(1);
});
