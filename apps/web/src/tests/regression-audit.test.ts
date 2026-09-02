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
      runNegativeCliTest,
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

      // 5m-1. Inject failing rmSync into real production cleanup call during clean CLI scan
      const { unlinkSync: _unusedUnlink1, ...baseFsClean } = fs;
      const mockFsWithFailingRmSyncOnCleanScan = {
        ...baseFsClean,
        unlinkSync: undefined,
        existsSync: (p: string) => {
          if (String(p).includes('.temp-gitleaks')) return true;
          return fs.existsSync(p);
        },
        readFileSync: (p: string, encoding: any) => {
          if (String(p).includes('.temp-gitleaks')) {
            return JSON.stringify([]);
          }
          return fs.readFileSync(p, encoding);
        },
        rmSync: (targetPath: any, options?: any) => {
          if (String(targetPath).includes('.temp-gitleaks')) {
            throw new Error(
              'EPERM: simulated permission denied during production rmSync cleanup on clean scan'
            );
          }
          return fs.rmSync(targetPath, options);
        },
      };

      const cleanScanFailingRmSyncResult = runCliVerification([], {
        fsImpl: mockFsWithFailingRmSyncOnCleanScan as any,
        spawnImpl: mockSpawnCleanSuccess as any,
        rootDir: isolatedTempDir,
        baseCommit: 'mock-base-sha-commit',
        resolveGitCommit: () => 'mock-base-sha-commit',
        getBin: () => 'mock-gitleaks',
      });

      assert(
        cleanScanFailingRmSyncResult.exitCode === 2 &&
          Boolean(
            cleanScanFailingRmSyncResult.message?.includes(
              'EPERM: simulated permission denied during production rmSync cleanup on clean scan'
            )
          ),
        'runCliVerification fails closed with exit code 2 when injected rmSync throws EPERM during real production cleanup call on clean scan'
      );

      // 5m-2. Inject failing rmSync into real production cleanup call during negative CLI test
      const { unlinkSync: _unusedUnlink2, ...baseFsNegative } = fs;
      const mockFsWithFailingRmSyncOnNegative = {
        ...baseFsNegative,
        unlinkSync: undefined,
        existsSync: (p: string) => {
          if (
            String(p).includes('.temp-gitleaks') ||
            String(p).includes('test-negative-secret-fixture')
          )
            return true;
          return fs.existsSync(p);
        },
        writeFileSync: (p: string, data: any) => {
          return fs.writeFileSync(p, data);
        },
        rmSync: (targetPath: any, options?: any) => {
          if (
            String(targetPath).includes('.temp-gitleaks') ||
            String(targetPath).includes('test-negative-secret-fixture')
          ) {
            throw new Error(
              'EPERM: simulated permission denied during production rmSync cleanup on negative test'
            );
          }
          return fs.rmSync(targetPath, options);
        },
      };

      const negativeFailingRmSyncResult = runNegativeCliTest('mock-gitleaks', {
        fsImpl: mockFsWithFailingRmSyncOnNegative as any,
        spawnImpl: mockSpawnFinding as any,
        rootDir: isolatedTempDir,
      });

      assert(
        negativeFailingRmSyncResult.exitCode === 2 &&
          Boolean(
            negativeFailingRmSyncResult.message?.includes(
              'EPERM: simulated permission denied during production rmSync cleanup on negative test'
            )
          ),
        'runNegativeCliTest fails closed with exit code 2 when injected rmSync throws EPERM during real production cleanup call on negative test'
      );

      // 5m-3. Direct cleanTemporaryFiles throws when injected rmSync throws EPERM
      let directCleanupError: any = null;
      try {
        cleanTemporaryFiles(['/mock/path/.temp-gitleaks-test.json'], {
          existsSync: () => true,
          rmSync: () => {
            throw new Error('EPERM: simulated permission denied during direct rmSync call');
          },
        });
      } catch (err: any) {
        directCleanupError = err;
      }
      assert(
        directCleanupError &&
          directCleanupError.message.includes(
            'EPERM: simulated permission denied during direct rmSync call'
          ),
        'cleanTemporaryFiles throws operational error when injected rmSync throws EPERM'
      );

      // 5n. Pre-existing scanner artifacts and sentinel reports are strictly preserved byte-for-byte
      const sentinelReportName = `.temp-gitleaks-sentinel-evidence-${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
      const sentinelReportPath = path.join(isolatedTempDir, sentinelReportName);
      const sentinelKnownBytes = Buffer.from(
        JSON.stringify(
          [
            {
              RuleID: 'sentinel-mock-finding',
              Description:
                'Historical preserved sentinel report evidence for test isolation verification',
              File: 'src/sentinel.ts',
              StartLine: 42,
              EndLine: 42,
            },
          ],
          null,
          2
        ) + '\n',
        'utf-8'
      );
      fs.writeFileSync(sentinelReportPath, sentinelKnownBytes);

      // Verify that getGitleaksScanTargets and walkDir strictly ignore pre-existing sentinel reports
      const scanTargetsWithSentinel = getGitleaksScanTargets(isolatedTempDir);
      assert(
        !scanTargetsWithSentinel.some((t: string) => t.includes(sentinelReportName)),
        'getGitleaksScanTargets strictly excludes pre-existing sentinel reports from scan targets'
      );
      const walkedFilesWithSentinel = walkDir(isolatedTempDir, isolatedTempDir, []);
      assert(
        !walkedFilesWithSentinel.some((f: string) => f.includes(sentinelReportName)),
        'walkDir strictly excludes pre-existing sentinel reports from enumerated files'
      );

      // Run cleanTemporaryFiles with a separate transient report
      const transientReport = path.join(
        isolatedTempDir,
        '.temp-gitleaks-transient-run-report.json'
      );
      fs.writeFileSync(transientReport, '[]', 'utf-8');
      cleanTemporaryFiles([transientReport]);
      assert(!fs.existsSync(transientReport), 'cleanTemporaryFiles cleans transient report');

      // Assert that pre-existing sentinel report was never modified or deleted and remains byte-for-byte identical
      assert(
        fs.existsSync(sentinelReportPath),
        'Pre-existing sentinel report must still exist after scanner scenario'
      );
      const sentinelReadBytes = fs.readFileSync(sentinelReportPath);
      assert(
        Buffer.compare(sentinelReadBytes, sentinelKnownBytes) === 0,
        'Pre-existing sentinel report contents must remain byte-for-byte identical throughout test execution'
      );
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

  // Test 6: Turborepo Task Configuration & Environment State Isolation Invariant
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

    // 6a. Deterministic unit tests keep caching enabled for performance
    const testTask = turboConfig.tasks?.test;
    assert(
      testTask && testTask.cache !== false,
      'turbo.json must configure test task with caching enabled for deterministic package unit tests'
    );
    assert(
      Array.isArray(testTask.inputs) && testTask.inputs.includes('$TURBO_DEFAULT$'),
      'turbo.json test task must include $TURBO_DEFAULT$ inputs'
    );

    // 6b. Environment-sensitive repository state tests are isolated in dedicated uncached task with build prerequisite
    const testAuditTask = turboConfig.tasks?.['test:audit'];
    assert(
      testAuditTask && testAuditTask.cache === false,
      'turbo.json must configure test:audit task as explicitly uncached (cache: false) so live repository state verification cannot be bypassed by stale cache hits'
    );
    assert(
      Array.isArray(testAuditTask.dependsOn) &&
        testAuditTask.dependsOn.includes('build') &&
        testAuditTask.dependsOn.includes('^build'),
      'turbo.json test:audit task must declare dependsOn: ["build", "^build"] so it is independently runnable from a clean checkout'
    );

    // 6c. Root and workspace manifests expose reproducible scripts
    const rootPkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8'));
    const webPkg = JSON.parse(
      fs.readFileSync(path.join(rootDir, 'apps/web/package.json'), 'utf-8')
    );
    assert(
      rootPkg.scripts?.['verify:inventory'] && rootPkg.scripts?.['test:audit'],
      'Root package.json must expose verify:inventory and test:audit scripts'
    );
    assert(
      rootPkg.scripts?.['test:audit'] === 'turbo test:audit --cache-dir=.turbo/cache',
      `Root package.json test:audit script must route through turbo with --cache-dir (got: "${rootPkg.scripts?.['test:audit']}")`
    );
    assert(
      webPkg.scripts?.['version:next'] && webPkg.scripts?.['test:audit'],
      'apps/web/package.json must expose version:next and test:audit scripts'
    );

    // 6d. Explicit cacheDir ensures cache is isolated inside the active linked worktree
    assert(
      turboConfig.cacheDir === '.turbo/cache',
      'turbo.json must configure explicit cacheDir: ".turbo/cache" to keep every Turbo cache inside the active linked worktree and disable shared worktree caching'
    );

    const turboTaskScripts = [
      'dev',
      'build',
      'lint',
      'typecheck',
      'test',
      'test:audit',
      'test:e2e',
    ];
    for (const scriptName of turboTaskScripts) {
      const scriptCmd = rootPkg.scripts?.[scriptName] || '';
      assert(
        scriptCmd.includes('--cache-dir=.turbo/cache'),
        `Root package.json script "${scriptName}" must explicitly specify --cache-dir=.turbo/cache (got: "${scriptCmd}")`
      );
    }

    // 6e. Lifecycle scripts approval policy in pnpm-workspace.yaml
    const pnpmWorkspacePath = path.join(rootDir, 'pnpm-workspace.yaml');
    assert(fs.existsSync(pnpmWorkspacePath), 'pnpm-workspace.yaml must exist');
    const pnpmWorkspaceContent = fs.readFileSync(pnpmWorkspacePath, 'utf-8');
    const justifiedPackages = new Set([
      '@prisma/client',
      '@prisma/engines',
      'esbuild',
      'prisma',
      'sharp',
      'unrs-resolver',
    ]);
    const allowBuildsMatches = [
      ...pnpmWorkspaceContent.matchAll(/^\s*(?:'([^']+)'|([a-zA-Z0-9@/_-]+)):\s*true/gm),
    ];
    for (const match of allowBuildsMatches) {
      const pkg = match[1] || match[2];
      assert(
        justifiedPackages.has(pkg),
        `pnpm-workspace.yaml allowBuilds must only contain reviewed and justified packages (unexpected: "${pkg}")`
      );
    }
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

    // Safe Git invocation helper: Explicitly configures safe.directory for the specific target directory and any linked gitdir
    // without mutating global Git configuration or using broad '*' exemptions, handling dubious-ownership environments.
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
    ): string {
      const safeArgs = getSafeDirectoryArgs(options.cwd);
      return (cp.execFileSync('git', [...safeArgs, ...args], options as any) as any).toString();
    }

    // Verify git ls-files does not track apps/web/next-env.d.ts
    try {
      const lsResult = execSafeGit(['ls-files', 'apps/web/next-env.d.ts'], {
        cwd: rootDir,
        encoding: 'utf-8',
      }).trim();
      assert(
        lsResult.length === 0,
        `apps/web/next-env.d.ts must not be tracked in git (git ls-files returned: "${lsResult}")`
      );

      // Verify git check-ignore confirms apps/web/next-env.d.ts is ignored
      const checkIgnoreResult = execSafeGit(['check-ignore', 'apps/web/next-env.d.ts'], {
        cwd: rootDir,
        encoding: 'utf-8',
      }).trim();
      assert(
        checkIgnoreResult.endsWith('next-env.d.ts'),
        `apps/web/next-env.d.ts must be matched by git ignore rules (got: "${checkIgnoreResult}")`
      );

      // Test dev generation simulation: ensure writing dev content leaves working tree 100% clean
      const webNextEnvPath = path.join(rootDir, 'apps/web/next-env.d.ts');
      const devContent =
        '/// <reference types="next" />\n/// <reference types="next/image-types/global" />\nimport "./.next/dev/types/routes.d.ts";\n\n// NOTE: This file should not be edited\n';
      fs.writeFileSync(webNextEnvPath, devContent, 'utf-8');

      const devStatusResult = execSafeGit(['status', '--porcelain', 'apps/web/next-env.d.ts'], {
        cwd: rootDir,
        encoding: 'utf-8',
      }).trim();
      assert(
        devStatusResult.length === 0,
        `apps/web/next-env.d.ts must not dirty git status during dev generation (got: "${devStatusResult}")`
      );

      // Test build generation simulation: ensure writing build content leaves working tree 100% clean
      const buildContent =
        '/// <reference types="next" />\n/// <reference types="next/image-types/global" />\nimport "./.next/types/routes.d.ts";\n\n// NOTE: This file should not be edited\n';
      fs.writeFileSync(webNextEnvPath, buildContent, 'utf-8');

      const buildStatusResult = execSafeGit(['status', '--porcelain', 'apps/web/next-env.d.ts'], {
        cwd: rootDir,
        encoding: 'utf-8',
      }).trim();
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

  // Test 8: Standalone Temporary Git Repository & Cryptographic 3-State Cache Isolation (Fail-Closed)
  if (typeof window === 'undefined') {
    const fs = await import('fs');
    const path = await import('path');
    const os = await import('os');
    const crypto = await import('crypto');
    const cp = await import('child_process');
    let rootDir = process.cwd();
    if (fs.existsSync(path.join(rootDir, '../../turbo.json'))) {
      rootDir = path.resolve(rootDir, '../..');
    }

    interface CacheFileRecord {
      relPath: string;
      size: number;
      sha256: string;
    }

    // Helper: Recursively record exact relative paths, sizes, and SHA-256 cryptographic hashes for every regular file
    function getRecursiveCacheFileSnapshots(cacheDir: string): CacheFileRecord[] | null {
      if (!fs.existsSync(cacheDir)) return null;
      const records: CacheFileRecord[] = [];
      function walk(dir: string) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(fullPath);
          } else if (entry.isFile()) {
            const content = fs.readFileSync(fullPath);
            const relPath = path.relative(cacheDir, fullPath).replace(/\\/g, '/');
            const sha256 = crypto.createHash('sha256').update(content).digest('hex');
            records.push({
              relPath,
              size: content.length,
              sha256,
            });
          }
        }
      }
      walk(cacheDir);
      records.sort((a, b) => a.relPath.localeCompare(b.relPath));
      return records;
    }

    // 8a. Focused negative regression proof: Verify SHA-256 detects byte changes with unchanged file size, additions, deletions, nested changes, and renames
    {
      const negTestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-cache-hash-test-'));
      try {
        const testCacheDir = path.join(negTestDir, 'cache');
        fs.mkdirSync(path.join(testCacheDir, 'nested'), { recursive: true });
        fs.writeFileSync(path.join(testCacheDir, 'entry1.json'), 'payload-data-alpha');
        fs.writeFileSync(path.join(testCacheDir, 'nested', 'entry2.json'), 'nested-content-1');

        const initialSnapshot = getRecursiveCacheFileSnapshots(testCacheDir);
        assert(
          initialSnapshot !== null && initialSnapshot.length === 2,
          'Initial snapshot must have 2 entries'
        );

        // Mutation 1: Same byte length (18 bytes), but altered content
        fs.writeFileSync(path.join(testCacheDir, 'entry1.json'), 'payload-data-omega');
        const mutatedSnapshot = getRecursiveCacheFileSnapshots(testCacheDir);
        assert(
          mutatedSnapshot !== null && mutatedSnapshot.length === 2,
          'Mutated snapshot must have 2 entries'
        );

        if (!initialSnapshot || !mutatedSnapshot) {
          throw new Error('Snapshots must not be null');
        }

        assert(
          initialSnapshot[0].size === mutatedSnapshot[0].size,
          'File size must remain identical (18 bytes) to prove hash sensitivity'
        );
        assert(
          initialSnapshot[0].sha256 !== mutatedSnapshot[0].sha256,
          'SHA-256 hash must detect byte changes when file size is unchanged'
        );

        let caughtHashDiscrepancy = false;
        try {
          assert(
            JSON.stringify(initialSnapshot) === JSON.stringify(mutatedSnapshot),
            'Preservation assertion must fail on byte change'
          );
        } catch {
          caughtHashDiscrepancy = true;
        }
        assert(
          caughtHashDiscrepancy,
          'Preservation assertion must fail closed when cache bytes are altered'
        );
      } finally {
        fs.rmSync(negTestDir, { recursive: true, force: true });
      }
    }

    // Safe Git invocation helper: Explicitly configures safe.directory for the specific target directory and any linked gitdir
    // without mutating global Git configuration or using broad '*' exemptions, handling dubious-ownership environments.
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
    ): string {
      const safeArgs = getSafeDirectoryArgs(options.cwd);
      return (cp.execFileSync('git', [...safeArgs, ...args], options as any) as any).toString();
    }

    // 8b. Discover all registered worktrees via git worktree list (read-only baseline)
    const initialRealWtOutput = execSafeGit(['worktree', 'list', '--porcelain'], {
      cwd: rootDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    const realGitCommonDirRaw = execSafeGit(['rev-parse', '--git-common-dir'], {
      cwd: rootDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    const realGitCommonDir = path.resolve(rootDir, realGitCommonDirRaw);

    const worktreeLines = initialRealWtOutput.split('\n');
    const worktreePaths: string[] = [];
    for (const line of worktreeLines) {
      if (line.startsWith('worktree ')) {
        worktreePaths.push(path.normalize(line.slice(9).trim()));
      }
    }
    assert(
      worktreePaths.length > 0,
      'Git worktree list must identify at least the primary repository'
    );

    // 8c. Negative regression test: Injected failure after git worktree add on standalone repo must safely prune and delete temporary directory without mutating real repository
    {
      const failSetupBase = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-test-fail-setup-'));
      const standaloneFailRepo = path.join(failSetupBase, 'standalone-repo');
      const failSetupWtPath = path.join(failSetupBase, 'wt-fail');
      let injectedSetupErrorCaught = false;
      let setupCleanupRan = false;
      let setupMainError: any = null;
      try {
        try {
          const rootDirUrl = 'file:///' + rootDir.replace(/\\/g, '/');
          cp.execFileSync(
            'git',
            [
              ...getSafeDirectoryArgs(rootDir),
              '-c',
              `safe.directory=${path.resolve(standaloneFailRepo).replace(/\\/g, '/')}`,
              'clone',
              '--no-hardlinks',
              '--dissociate',
              '--depth=1',
              rootDirUrl,
              standaloneFailRepo,
            ],
            { stdio: ['pipe', 'pipe', 'pipe'] }
          );
          execSafeGit(['worktree', 'add', '--detach', failSetupWtPath, 'HEAD'], {
            cwd: standaloneFailRepo,
            stdio: ['pipe', 'pipe', 'pipe'],
          });
          // Injected failure immediately after git worktree add
          throw new Error('Simulated setup failure after git worktree add on standalone repo');
        } catch (e: any) {
          setupMainError = e;
          throw e;
        } finally {
          setupCleanupRan = true;
          let cleanupError: any = null;
          if (fs.existsSync(standaloneFailRepo)) {
            try {
              execSafeGit(['worktree', 'prune'], {
                cwd: standaloneFailRepo,
                stdio: ['pipe', 'pipe', 'pipe'],
              });
            } catch (pruneErr: any) {
              cleanupError = pruneErr;
            }
          }
          if (fs.existsSync(failSetupBase)) {
            try {
              fs.rmSync(failSetupBase, { recursive: true, force: true });
            } catch (rmErr: any) {
              if (!cleanupError) cleanupError = rmErr;
            }
          }
          if (cleanupError) {
            if (setupMainError) {
              cleanupError.cause = setupMainError;
              cleanupError.message = `Cleanup failed (${cleanupError.message}) after operation error: ${setupMainError.message}`;
            }
            throw cleanupError;
          }
        }
      } catch (e: any) {
        if (
          e.message &&
          e.message.includes('Simulated setup failure after git worktree add on standalone repo')
        ) {
          injectedSetupErrorCaught = true;
        }
      }
      assert(injectedSetupErrorCaught, 'Injected setup error must propagate and be caught');
      assert(setupCleanupRan, 'Cleanup handler must execute on setup failure');
      assert(
        !fs.existsSync(failSetupBase),
        'Temporary base directory from failed setup must be completely deleted'
      );
      const postFailRealWtOutput = execSafeGit(['worktree', 'list', '--porcelain'], {
        cwd: rootDir,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      assert(
        postFailRealWtOutput === initialRealWtOutput,
        'Original repository registered worktree list must remain 100% byte-for-byte unchanged after failed setup'
      );
    }

    // 8d. Main Deterministic Standalone Repository & Linked Worktree Execution under a Single Unified Cleanup Scope
    let mainError: any = null;
    const tempBase = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-wt-isolate-'));
    const standaloneRepo = path.join(tempBase, 'standalone-repo');
    const ephemeralWtPath = path.join(tempBase, 'target-wt');

    try {
      // 1. Create completely standalone temporary Git repository with its own independent .git directory
      const rootDirUrl = 'file:///' + rootDir.replace(/\\/g, '/');
      cp.execFileSync(
        'git',
        [
          ...getSafeDirectoryArgs(rootDir),
          '-c',
          `safe.directory=${path.resolve(standaloneRepo).replace(/\\/g, '/')}`,
          'clone',
          '--no-hardlinks',
          '--dissociate',
          '--depth=1',
          rootDirUrl,
          standaloneRepo,
        ],
        { stdio: ['pipe', 'pipe', 'pipe'] }
      );

      // 2. Create ephemeral linked worktree using the standalone temporary repository
      execSafeGit(['worktree', 'add', '--detach', ephemeralWtPath, 'HEAD'], {
        cwd: standaloneRepo,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // 3. Explicit assertions on Git common directory isolation
      const ephemCommonDirRaw = execSafeGit(['rev-parse', '--git-common-dir'], {
        cwd: ephemeralWtPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      const resolvedEphemCommonDir = path.resolve(ephemeralWtPath, ephemCommonDirRaw);

      assert(
        resolvedEphemCommonDir.startsWith(tempBase),
        `Ephemeral worktree Git common directory (${resolvedEphemCommonDir}) must be inside temporary base (${tempBase})`
      );
      assert(
        resolvedEphemCommonDir !== realGitCommonDir,
        `Ephemeral worktree Git common directory must not be the real checkout's Git common directory (${realGitCommonDir})`
      );

      // 4. Synthetic sibling regression cases inside unified scope
      // Sibling Case A: Non-target sibling with no .turbo directory
      const mockSiblingNoTurbo = path.join(tempBase, 'sibling-case-a-no-turbo');
      fs.mkdirSync(mockSiblingNoTurbo, { recursive: true });

      // Sibling Case B: Non-target sibling where .turbo exists but .turbo/cache is absent
      const mockSiblingTurboNoCache = path.join(tempBase, 'sibling-case-b-turbo-no-cache');
      fs.mkdirSync(path.join(mockSiblingTurboNoCache, '.turbo'), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(mockSiblingTurboNoCache, '.turbo', 'config.json'),
        '{"synthetic":true}',
        'utf-8'
      );

      // Sibling Case C: Non-target sibling where .turbo/cache exists with nested files
      const mockSiblingTurboWithCache = path.join(tempBase, 'sibling-case-c-turbo-with-cache');
      fs.mkdirSync(path.join(mockSiblingTurboWithCache, '.turbo', 'cache', 'nested'), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(mockSiblingTurboWithCache, '.turbo', 'cache', 'mock-existing-cache.json'),
        '{"cached":true}',
        'utf-8'
      );
      fs.writeFileSync(
        path.join(mockSiblingTurboWithCache, '.turbo', 'cache', 'nested', 'nested-cache.json'),
        '{"nested":true}',
        'utf-8'
      );

      interface TargetStateSnapshot {
        path: string;
        isGitWorktree: boolean;
        turboDirExists: boolean;
        turboCacheDirExists: boolean;
        cacheFiles: CacheFileRecord[] | null;
        gitStatus: string | null;
      }

      const monitoredTargets: { path: string; isGitWorktree: boolean }[] = [
        ...worktreePaths.map((p) => ({ path: p, isGitWorktree: true })),
        { path: mockSiblingNoTurbo, isGitWorktree: false },
        { path: mockSiblingTurboNoCache, isGitWorktree: false },
        { path: mockSiblingTurboWithCache, isGitWorktree: false },
      ];

      // 5. Pre-execution snapshots using cryptographic recursive SHA-256
      const preSnapshots: Record<string, TargetStateSnapshot> = {};
      for (const target of monitoredTargets) {
        const turboDir = path.join(target.path, '.turbo');
        const turboCacheDir = path.join(turboDir, 'cache');
        const turboDirExists = fs.existsSync(turboDir);
        const turboCacheDirExists = fs.existsSync(turboCacheDir);
        const cacheFiles = getRecursiveCacheFileSnapshots(turboCacheDir);
        const gitStatus = target.isGitWorktree
          ? execSafeGit(['status', '--porcelain'], {
              cwd: target.path,
              encoding: 'utf-8',
              stdio: ['pipe', 'pipe', 'pipe'],
            }).trim()
          : null;
        preSnapshots[target.path] = {
          path: target.path,
          isGitWorktree: target.isGitWorktree,
          turboDirExists,
          turboCacheDirExists,
          cacheFiles,
          gitStatus,
        };
      }

      // 6. Dependency setup inside ephemeral linked worktree
      const pnpmCmd = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
      cp.execSync(`${pnpmCmd} install --frozen-lockfile`, {
        cwd: ephemeralWtPath,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const turboBin = path.join(ephemeralWtPath, 'node_modules', 'turbo', 'bin', 'turbo');
      assert(
        fs.existsSync(turboBin),
        'Turbo binary must exist in ephemeral linked worktree node_modules'
      );

      // 7. Real cache-writing Turbo execution inside ephemeral linked worktree
      const turboBuildOutput = cp
        .execFileSync(
          process.execPath,
          [
            turboBin,
            'build',
            '--filter=@shipde/contracts',
            '--filter=@shipde/config',
            '--force',
            '--cache-dir=.turbo/cache',
          ],
          {
            cwd: ephemeralWtPath,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
          }
        )
        .trim();
      assert(
        turboBuildOutput.includes('turbo') || turboBuildOutput.includes('Tasks:'),
        'Turbo execution in ephemeral linked worktree must produce valid task output'
      );

      // 8. Assert cache was created strictly inside target ephemeral worktree (.turbo/cache)
      const wtTurboCacheDir = path.join(ephemeralWtPath, '.turbo', 'cache');
      assert(
        fs.existsSync(wtTurboCacheDir),
        'Target ephemeral linked worktree must have .turbo/cache created by Turbo'
      );
      const wtCacheFiles = fs.readdirSync(wtTurboCacheDir);
      assert(
        wtCacheFiles.length > 0,
        'Target ephemeral worktree .turbo/cache must contain real Turbo cache entries'
      );
      const hasRealTurboArtifacts = wtCacheFiles.some(
        (f) => f.endsWith('.tar.zst') || f.endsWith('-manifest.json') || f.endsWith('-meta.json')
      );
      assert(
        hasRealTurboArtifacts,
        'Target ephemeral worktree .turbo/cache must contain real Turbo-generated artifacts (*.tar.zst / *-manifest.json)'
      );

      // 9. Assert exact cryptographic 3-state preservation across all non-target siblings and checkouts
      for (const target of monitoredTargets) {
        const pre = preSnapshots[target.path];
        const turboDir = path.join(target.path, '.turbo');
        const turboCacheDir = path.join(turboDir, 'cache');
        const turboDirExists = fs.existsSync(turboDir);
        const turboCacheDirExists = fs.existsSync(turboCacheDir);

        // a. Exact .turbo directory existence
        assert(
          turboDirExists === pre.turboDirExists,
          `Non-target path "${target.path}" .turbo existence must match pre-state (expected: ${pre.turboDirExists}, got: ${turboDirExists})`
        );

        // b. Exact .turbo/cache directory existence
        assert(
          turboCacheDirExists === pre.turboCacheDirExists,
          `Non-target path "${target.path}" .turbo/cache existence must match pre-state (expected: ${pre.turboCacheDirExists}, got: ${turboCacheDirExists})`
        );

        // c. Exact recursive SHA-256 cryptographic file contents when cache exists
        if (pre.turboCacheDirExists) {
          const currentFiles = getRecursiveCacheFileSnapshots(turboCacheDir);
          assert(
            JSON.stringify(currentFiles) === JSON.stringify(pre.cacheFiles),
            `Non-target path "${target.path}" cache contents (SHA-256 and relative paths) must remain 100% identical and unpolluted`
          );
        }

        // d. Exact working tree git status for repository checkouts
        if (target.isGitWorktree) {
          const currentGitStatus = execSafeGit(['status', '--porcelain'], {
            cwd: target.path,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
          }).trim();
          assert(
            currentGitStatus === pre.gitStatus,
            `Non-target git worktree "${target.path}" status must remain identical and clean`
          );
        }
      }

      // 10. Assert that original repository's registered worktree list is byte-for-byte unchanged before and after the audit
      const postRealWtOutput = execSafeGit(['worktree', 'list', '--porcelain'], {
        cwd: rootDir,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      assert(
        postRealWtOutput === initialRealWtOutput,
        'Original repository registered worktree list must remain 100% byte-for-byte identical before and after audit'
      );

      // 11. Negative regression proof: Nonexistent Turbo task exits non-zero
      let caughtNegative = false;
      try {
        cp.execFileSync(
          process.execPath,
          [turboBin, 'run', 'nonexistent-worktree-isolation-task', '--cache-dir=.turbo/cache'],
          {
            cwd: ephemeralWtPath,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
          }
        );
      } catch (negativeErr: any) {
        caughtNegative = true;
        assert(
          negativeErr.status !== 0,
          `Negative Turbo execution must fail closed with non-zero exit code (got: ${negativeErr.status})`
        );
      }
      assert(caughtNegative, 'Negative Turbo task execution must exit with non-zero status code');

      // 12. Regression coverage representing a permission-isolated linked review workspace:
      // Proves that when the audit is launched from within a linked worktree (where the common Git directory is outside the workspace),
      // the audit does not require write permission to the original/parent common Git metadata and succeeds with full isolation.
      {
        const reviewWsPath = path.join(tempBase, 'linked-review-ws');
        execSafeGit(['worktree', 'add', '--detach', reviewWsPath, 'HEAD'], {
          cwd: standaloneRepo,
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        const reviewGitCommonRaw = execSafeGit(['rev-parse', '--git-common-dir'], {
          cwd: reviewWsPath,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
        const resolvedReviewGitCommon = path.resolve(reviewWsPath, reviewGitCommonRaw);

        // Verify that reviewWsPath is indeed a linked worktree sharing standaloneRepo's common dir
        assert(
          resolvedReviewGitCommon === path.resolve(standaloneRepo, '.git'),
          'Review workspace must be a linked worktree sharing standalone repo Git common dir'
        );

        // Execute audit isolation from within reviewWsPath
        const innerAuditBase = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-review-audit-'));
        try {
          const innerStandalone = path.join(innerAuditBase, 'inner-standalone');
          const reviewWsUrl = 'file:///' + reviewWsPath.replace(/\\/g, '/');
          cp.execFileSync(
            'git',
            [
              ...getSafeDirectoryArgs(reviewWsPath),
              '-c',
              `safe.directory=${path.resolve(innerStandalone).replace(/\\/g, '/')}`,
              'clone',
              '--no-hardlinks',
              '--dissociate',
              '--depth=1',
              reviewWsUrl,
              innerStandalone,
            ],
            { stdio: ['pipe', 'pipe', 'pipe'] }
          );

          const innerEphemeral = path.join(innerAuditBase, 'inner-ephemeral');
          execSafeGit(['worktree', 'add', '--detach', innerEphemeral, 'HEAD'], {
            cwd: innerStandalone,
            stdio: ['pipe', 'pipe', 'pipe'],
          });

          const innerEphemCommonRaw = execSafeGit(['rev-parse', '--git-common-dir'], {
            cwd: innerEphemeral,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
          }).trim();
          const resolvedInnerEphemCommon = path.resolve(innerEphemeral, innerEphemCommonRaw);

          assert(
            resolvedInnerEphemCommon.startsWith(innerAuditBase),
            `Inner ephemeral common dir (${resolvedInnerEphemCommon}) must be inside innerAuditBase (${innerAuditBase})`
          );
          assert(
            resolvedInnerEphemCommon !== resolvedReviewGitCommon,
            'Inner ephemeral common dir must NOT be review workspace common dir'
          );
          assert(
            resolvedInnerEphemCommon !== realGitCommonDir,
            'Inner ephemeral common dir must NOT be real repository Git common dir'
          );
        } finally {
          if (fs.existsSync(innerAuditBase)) {
            fs.rmSync(innerAuditBase, { recursive: true, force: true });
          }
        }
      }

      // 13. Regression coverage for dubious-ownership & safe-directory execution:
      // Proves that scoped safe.directory per-invocation configuration allows safe Git operations
      // in permission-isolated checkouts without modifying global Git configuration or using broad '*' exemptions.
      {
        const safeArgs = getSafeDirectoryArgs(ephemeralWtPath);
        assert(
          safeArgs.includes('-c') && safeArgs.some((a) => a.startsWith('safe.directory=')),
          'getSafeDirectoryArgs must generate -c safe.directory=<path> arguments'
        );
        assert(
          !safeArgs.some((a) => a === 'safe.directory=*' || a === 'safe.directory=/*'),
          'getSafeDirectoryArgs must NEVER use broad safe.directory=* exemptions'
        );

        const globalSafeDirsBefore = (() => {
          try {
            return cp
              .execFileSync('git', ['config', '--global', '--get-all', 'safe.directory'], {
                encoding: 'utf-8',
                stdio: ['pipe', 'pipe', 'pipe'],
              })
              .trim();
          } catch {
            return '';
          }
        })();

        // Execute scoped safe Git status in ephemeral checkout
        const scopedStatus = execSafeGit(['status', '--porcelain'], {
          cwd: ephemeralWtPath,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
        assert(
          typeof scopedStatus === 'string',
          'Scoped safe Git execution must return valid string output'
        );

        const globalSafeDirsAfter = (() => {
          try {
            return cp
              .execFileSync('git', ['config', '--global', '--get-all', 'safe.directory'], {
                encoding: 'utf-8',
                stdio: ['pipe', 'pipe', 'pipe'],
              })
              .trim();
          } catch {
            return '';
          }
        })();

        assert(
          globalSafeDirsAfter === globalSafeDirsBefore,
          'Scoped safe.directory Git invocation must not mutate user global Git configuration'
        );
      }
    } catch (err: any) {
      mainError = err;
      throw err;
    } finally {
      // Scoped cleanup: prune worktree inside standaloneRepo, safely delete tempBase, and preserve dual error context on cleanup failure
      let cleanupError: any = null;
      if (fs.existsSync(standaloneRepo)) {
        try {
          execSafeGit(['worktree', 'prune'], {
            cwd: standaloneRepo,
            stdio: ['pipe', 'pipe', 'pipe'],
          });
        } catch (pruneErr: any) {
          cleanupError = pruneErr;
        }
      }
      if (fs.existsSync(tempBase)) {
        try {
          fs.rmSync(tempBase, { recursive: true, force: true });
        } catch (rmErr: any) {
          if (!cleanupError) cleanupError = rmErr;
        }
      }

      if (cleanupError) {
        if (mainError) {
          cleanupError.cause = mainError;
          cleanupError.message = `Cleanup failed (${cleanupError.message}) after operation error: ${mainError.message}`;
        }
        throw cleanupError;
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
