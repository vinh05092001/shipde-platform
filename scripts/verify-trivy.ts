import * as fs from 'fs';
import * as path from 'path';
import { spawnSync, execFileSync } from 'child_process';

/**
 * Ship Dễ — Trivy vulnerability / misconfiguration / SBOM gate driver.
 *
 * Contract taken from `docs/product-spec/work-items/TASK-AI-37.md`:
 *  - `AI-37-R02` Trivy runs with `--security-checks vuln,config` only. Secret
 *    scanning stays with Gitleaks; `secret` is never passed here.
 *  - `AI-37-R04` Blocking threshold is `--exit-code 1 --severity HIGH,CRITICAL
 *    --ignore-unfixed`.
 *  - `AI-37-R05` Fail closed. Operational faults — and a MISSING BINARY is an
 *    operational fault, not a clean scan — exit `2`.
 *  - `AI-37-R07` When `apps/*` carry no Dockerfile the container step reports
 *    `NO_CONTAINER_TARGET` and exits `0`.
 *
 * Exit codes are the whole point of this file and are kept distinct:
 *   0 = scan ran and found nothing actionable
 *   1 = scan ran and found an actionable HIGH/CRITICAL vulnerability
 *   2 = the scan did not run, or did not finish (operational failure)
 */

export const TRIVY_PINNED_VERSION = '0.60.0';

/** `AI-37-R02` — `secret` is deliberately absent. */
export const TRIVY_SECURITY_CHECKS = 'vuln,config';

/** `AI-37-R07` — the exact string the container step emits with no target. */
export const NO_CONTAINER_TARGET_MESSAGE =
  'NO_CONTAINER_TARGET: No Dockerfile found in apps/*; container scan skipped';

export const EXIT_CLEAN = 0;
export const EXIT_FINDING = 1;
export const EXIT_OPERATIONAL = 2;

export type TrivyOutcomeKind = 'clean' | 'finding' | 'operational';

export interface TrivyOutcome {
  kind: TrivyOutcomeKind;
  exitCode: number;
  message?: string;
  findingsOutput?: string;
}

export interface SpawnLike {
  (
    command: string,
    args: string[],
    options: { stdio: 'pipe'; encoding: 'utf-8'; shell: false; cwd?: string }
  ): {
    status: number | null;
    error?: Error;
    stdout?: string | null;
    stderr?: string | null;
  };
}

/**
 * Resolve the Trivy executable. Returns `null` when it is genuinely absent —
 * callers must translate that into exit `2`, never into a pass.
 */
export function getTrivyBinary(
  execImpl: (file: string, args: string[], options: object) => unknown = execFileSync,
  fsImpl: { existsSync: (p: fs.PathLike) => boolean } = fs,
  env: NodeJS.ProcessEnv = process.env,
  platform: string = process.platform
): string | null {
  try {
    execImpl('trivy', ['--version'], { stdio: 'ignore', shell: false });
    return 'trivy';
  } catch {
    // fall through to the explicitly provisioned locations below
  }

  const candidates: string[] = [];
  if (env.TRIVY_BIN) {
    candidates.push(env.TRIVY_BIN);
  }
  if (platform === 'win32' && env.TEMP) {
    candidates.push(path.join(env.TEMP, 'trivy', 'trivy.exe'));
  }
  if (platform !== 'win32') {
    candidates.push('/usr/local/bin/trivy');
  }

  for (const candidate of candidates) {
    try {
      if (!fsImpl.existsSync(candidate)) continue;
      execImpl(candidate, ['--version'], { stdio: 'ignore', shell: false });
      return candidate;
    } catch {
      // try the next candidate
    }
  }

  return null;
}

/**
 * `AI-37-R04` / `AI-37-R02` — the argument vector for a blocking filesystem scan.
 */
export function buildFsScanArgs(target: string): string[] {
  return [
    'fs',
    '--security-checks',
    TRIVY_SECURITY_CHECKS,
    '--exit-code',
    '1',
    '--severity',
    'HIGH,CRITICAL',
    '--ignore-unfixed',
    target,
  ];
}

/**
 * `AI-37-R02` guard: refuse to run an argument vector that would turn Trivy into
 * a second secret-scanning authority alongside Gitleaks.
 */
export function assertNoSecretScanning(args: string[]): void {
  const idx = args.indexOf('--security-checks');
  const checks = idx >= 0 ? (args[idx + 1] ?? '') : '';
  if (
    checks
      .split(',')
      .map((c) => c.trim())
      .includes('secret')
  ) {
    throw new Error(
      'AI-37-R02 violation: Trivy secret scanning is forbidden; Gitleaks is the sole secret authority'
    );
  }
}

/**
 * `AI-37-R07` — enumerate `apps/<name>/Dockerfile` from the filesystem.
 */
export function findAppDockerfiles(
  rootDir: string,
  fsImpl: {
    existsSync: (p: fs.PathLike) => boolean;
    readdirSync: typeof fs.readdirSync;
  } = fs
): string[] {
  const appsDir = path.join(rootDir, 'apps');
  if (!fsImpl.existsSync(appsDir)) {
    return [];
  }
  let entries: fs.Dirent[];
  try {
    entries = fsImpl.readdirSync(appsDir, { withFileTypes: true }) as fs.Dirent[];
  } catch {
    return [];
  }
  const found: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dockerfile = path.join(appsDir, entry.name, 'Dockerfile');
    if (fsImpl.existsSync(dockerfile)) {
      found.push(dockerfile);
    }
  }
  return found.sort();
}

/**
 * Run Trivy once and translate its process result into the three-way outcome.
 * A spawn failure or any exit code other than 0/1 is operational (`AI-37-R05`).
 */
export function executeTrivy(
  trivyBin: string,
  args: string[],
  spawnImpl: SpawnLike = spawnSync as unknown as SpawnLike,
  cwd?: string
): TrivyOutcome {
  try {
    assertNoSecretScanning(args);
  } catch (err) {
    return {
      kind: 'operational',
      exitCode: EXIT_OPERATIONAL,
      message: (err as Error).message,
    };
  }

  let result;
  try {
    result = spawnImpl(trivyBin, args, {
      stdio: 'pipe',
      encoding: 'utf-8',
      shell: false,
      cwd,
    });
  } catch (err) {
    return {
      kind: 'operational',
      exitCode: EXIT_OPERATIONAL,
      message: `Failed to spawn trivy process: ${(err as Error).message}`,
    };
  }

  if (result.error) {
    return {
      kind: 'operational',
      exitCode: EXIT_OPERATIONAL,
      message: `Trivy process execution error: ${result.error.message}`,
    };
  }

  const stdout = (result.stdout ?? '').toString();
  const stderr = (result.stderr ?? '').toString();

  if (result.status === 0) {
    return { kind: 'clean', exitCode: EXIT_CLEAN };
  }

  if (result.status === 1) {
    return {
      kind: 'finding',
      exitCode: EXIT_FINDING,
      message: 'Actionable HIGH/CRITICAL vulnerability detected',
      findingsOutput: (stdout || stderr).trim(),
    };
  }

  return {
    kind: 'operational',
    exitCode: EXIT_OPERATIONAL,
    message: `Trivy failed with operational exit code ${result.status}: ${(stderr || stdout).trim()}`,
  };
}

export interface TrivyCliDependencies {
  rootDir?: string;
  fsImpl?: {
    existsSync: (p: fs.PathLike) => boolean;
    readdirSync: typeof fs.readdirSync;
  };
  spawnImpl?: SpawnLike;
  getBin?: () => string | null;
  logger?: Pick<Console, 'log' | 'error'>;
}

/**
 * The container step (`AI-37-R07`). Truthful "no target" is exit `0`; a real
 * target that Trivy cannot be run against is exit `2`, never a silent pass.
 */
export function runContainerTargetStep(deps: TrivyCliDependencies = {}): TrivyOutcome {
  const rootDir = deps.rootDir ?? process.cwd();
  const fsImpl = deps.fsImpl ?? fs;
  const logger = deps.logger ?? console;

  const dockerfiles = findAppDockerfiles(rootDir, fsImpl);
  if (dockerfiles.length === 0) {
    logger.log(NO_CONTAINER_TARGET_MESSAGE);
    return { kind: 'clean', exitCode: EXIT_CLEAN, message: NO_CONTAINER_TARGET_MESSAGE };
  }

  const getBin = deps.getBin ?? getTrivyBinary;
  const trivyBin = getBin();
  if (!trivyBin) {
    const message = `CONTAINER_TARGET_PRESENT_BUT_SCANNER_ABSENT: ${dockerfiles.length} Dockerfile(s) under apps/* cannot be scanned`;
    logger.error(`❌ ${message}`);
    return { kind: 'operational', exitCode: EXIT_OPERATIONAL, message };
  }

  for (const dockerfile of dockerfiles) {
    const outcome = executeTrivy(
      trivyBin,
      ['config', '--exit-code', '1', '--severity', 'HIGH,CRITICAL', dockerfile],
      deps.spawnImpl,
      rootDir
    );
    if (outcome.kind !== 'clean') {
      logger.error(`❌ Trivy config scan không sạch trên ${dockerfile}: ${outcome.message ?? ''}`);
      return outcome;
    }
  }

  logger.log(`✅ Quét cấu hình container hoàn tất trên ${dockerfiles.length} Dockerfile.`);
  return { kind: 'clean', exitCode: EXIT_CLEAN };
}

/**
 * CLI driver. Returns the outcome instead of exiting so that tests can assert
 * the exit code without killing the test process.
 */
export function runTrivyVerification(
  args: string[] = process.argv.slice(2),
  deps: TrivyCliDependencies = {}
): TrivyOutcome {
  const rootDir = deps.rootDir ?? process.cwd();
  const logger = deps.logger ?? console;
  const getBin = deps.getBin ?? getTrivyBinary;

  logger.log('================================================================');
  logger.log('🛡️  SHIP DỄ — BỘ QUÉT LỖ HỔNG & CẤU HÌNH PHỤ THUỘC (TRIVY)');
  logger.log('================================================================\n');

  if (args.includes('--container-target')) {
    return runContainerTargetStep({ ...deps, rootDir });
  }

  const trivyBin = getBin();
  if (!trivyBin) {
    logger.error(
      `❌ LỖI: Không tìm thấy native binary Trivy CLI (trivy, pin ${TRIVY_PINNED_VERSION}) trong PATH hoặc môi trường hệ thống!`
    );
    logger.error(
      '   Đây là LỖI VẬN HÀNH (exit 2), KHÔNG phải kết quả quét sạch. Gate fail-closed theo AI-37-R05: bộ quét vắng mặt không bao giờ được báo cáo là 0 lỗ hổng.'
    );
    return {
      kind: 'operational',
      exitCode: EXIT_OPERATIONAL,
      message: 'TRIVY_BINARY_NOT_FOUND',
    };
  }

  const target = args.find((a) => !a.startsWith('--')) ?? '.';
  const scanArgs = buildFsScanArgs(target);
  logger.log(`🔍 Thực thi: trivy ${scanArgs.join(' ')}`);

  const outcome = executeTrivy(trivyBin, scanArgs, deps.spawnImpl, rootDir);

  if (outcome.kind === 'operational') {
    logger.error(`❌ LỖI VẬN HÀNH TRIVY (KHÔNG PHẢI PHÁT HIỆN LỖ HỔNG): ${outcome.message}`);
    return outcome;
  }

  if (outcome.kind === 'finding') {
    logger.error('\n❌ Trivy phát hiện lỗ hổng HIGH/CRITICAL đã có bản vá:');
    if (outcome.findingsOutput) {
      logger.error(outcome.findingsOutput);
    }
    return outcome;
  }

  logger.log('\n✅ Quét Trivy hoàn tất: 0 lỗ hổng HIGH/CRITICAL có bản vá.');
  return outcome;
}

// CLI entrypoint
if (require.main === module) {
  const outcome = runTrivyVerification();
  process.exit(outcome.exitCode);
}
