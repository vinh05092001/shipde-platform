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
      getGitleaksBinary,
      isIgnoredScanName,
      getGitleaksScanTargets,
      cleanTemporaryFiles,
      runCliVerification,
      walkDir,
    } = await import(pathToFileURL(verifySecretsScript).href);

    const gitleaksBin = getGitleaksBinary();
    assert(
      gitleaksBin !== null && gitleaksBin !== undefined && gitleaksBin.length > 0,
      'Gitleaks native binary must be installed and accessible in PATH for test suite'
    );

    // 5a. Shell-metacharacter path safety (No command injection)
    const metacharFixture = path.join(rootDir, '.temp-gitleaks-test-$(echo_safe)-fixture.js');
    const metacharReport = path.join(rootDir, '.temp-gitleaks-test-metachar-report.json');
    fs.writeFileSync(
      metacharFixture,
      '// Safe file with shell metacharacters in filename\nconst safeConst = 12345;\n',
      'utf-8'
    );
    try {
      const metacharResult = executeGitleaks(
        gitleaksBin,
        [
          'dir',
          metacharFixture,
          '-c',
          rootConfigPath,
          '--report-path',
          metacharReport,
          '--report-format',
          'json',
          '--redact',
        ],
        metacharReport
      );
      assert(
        metacharResult.success && metacharResult.exitCode === 0,
        'Gitleaks CLI executes safely on paths containing shell metacharacters without command injection'
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
      getGitleaksScanTargets(rootDir, mockFailingFs as any);
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
      walkDir(rootDir, rootDir, [], [], mockFailingFs as any);
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
      path.join(rootDir, '.temp-nonexistent-report.json')
    );
    assert(
      !failResult.success && typeof failResult.operationalError === 'string',
      'executeGitleaks fails closed when scanner binary fails to spawn'
    );

    // 5e. Scanner operational failure on invalid flags (non-zero exit code)
    const invalidFlagResult = executeGitleaks(
      gitleaksBin,
      ['--invalid-flag-that-does-not-exist-xyz'],
      path.join(rootDir, '.temp-invalid-flag-report.json')
    );
    assert(
      !invalidFlagResult.success && typeof invalidFlagResult.operationalError === 'string',
      'executeGitleaks fails closed on non-zero operational exit codes'
    );

    // 5f. Missing report file when scanner exits code 1 (fail-closed)
    const missingReportPath = path.join(rootDir, '.temp-nonexistent-finding-report.json');
    const mockSpawnExit1 = () => ({
      status: 1,
      stdout: '',
      stderr: 'simulated finding output',
      error: undefined,
    });
    const missingReportResult = executeGitleaks(
      gitleaksBin,
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
      gitleaksBin,
      ['dir', '.'],
      path.join(rootDir, '.temp-empty-report.json'),
      mockSpawnExit1 as any,
      { existsSync: () => true, readFileSync: () => '   ' } as any
    );
    assert(
      !emptyReportResult.success && Boolean(emptyReportResult.operationalError?.includes('empty')),
      'executeGitleaks fails closed when exit code 1 occurs but report file is empty'
    );

    // 5h. Malformed report JSON handling (fail-closed)
    const malformedReportResult = executeGitleaks(
      gitleaksBin,
      ['dir', '.'],
      path.join(rootDir, '.temp-malformed-report.json'),
      mockSpawnExit1 as any,
      { existsSync: () => true, readFileSync: () => '{ invalid json :::' } as any
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
    const mockFsWithLockedSecretReport = {
      ...fs,
      existsSync: (p: string) => (String(p).includes('.temp-gitleaks') ? true : fs.existsSync(p)),
      unlinkSync: (p: string) => {
        if (String(p).includes('.temp-gitleaks')) {
          throw new Error('EPERM: cannot delete temporary report on secret finding branch');
        }
        fs.unlinkSync(p);
      },
    };
    const secretFoundCleanupFailResult = runCliVerification(['--test-negative'], {
      fsImpl: mockFsWithLockedSecretReport as any,
      rootDir,
      getBin: () => gitleaksBin,
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
      rootDir,
      getBin: () => gitleaksBin,
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

    // 5j-3. Successful cleanup test -> verifies temporary report removal and unpolluted filesystem
    const trackedTempFiles: string[] = [];
    const testTempReport = path.join(rootDir, '.temp-gitleaks-success-cleanup-test.json');
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
    const dummyTempReport = path.join(rootDir, '.temp-gitleaks-dummy-scan.json');
    fs.writeFileSync(dummyTempReport, '[]', 'utf-8');
    try {
      const targets = getGitleaksScanTargets(rootDir);
      const includesTemp = targets.some((t: string) => t.includes('.temp-gitleaks'));
      assert(
        !includesTemp,
        'getGitleaksScanTargets strictly excludes .temp-gitleaks files from scan targets'
      );
    } finally {
      cleanTemporaryFiles([dummyTempReport]);
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
