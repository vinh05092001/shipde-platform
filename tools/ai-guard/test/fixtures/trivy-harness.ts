/**
 * In-process harness for `scripts/verify-trivy.ts`.
 *
 * `verify-trivy.ts` is TypeScript and the toolchain test runner is plain
 * `node --test`, so the suite spawns this file once through `tsx`, exercises
 * every branch with injected dependencies, and prints one JSON object on
 * stdout between the markers below. The test asserts on that object.
 *
 * Nothing here stubs the module under test: every value printed is produced by
 * `scripts/verify-trivy.ts` itself, so deleting or neutering that file makes
 * this harness fail to load and the suite fail.
 */
import * as path from 'path';
import {
  TRIVY_PINNED_VERSION,
  TRIVY_SECURITY_CHECKS,
  NO_CONTAINER_TARGET_MESSAGE,
  buildFsScanArgs,
  assertNoSecretScanning,
  findAppDockerfiles,
  executeTrivy,
  getTrivyBinary,
  runContainerTargetStep,
  runTrivyVerification,
} from '../../../../scripts/verify-trivy.js';

type SpawnResult = {
  status: number | null;
  error?: Error;
  stdout?: string | null;
  stderr?: string | null;
};

function fakeSpawn(result: SpawnResult) {
  return (() => result) as never;
}

const silent = { log: () => {}, error: () => {} };
const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');

const out: Record<string, unknown> = {};

out.pinnedVersion = TRIVY_PINNED_VERSION;
out.securityChecks = TRIVY_SECURITY_CHECKS;
out.noContainerTargetMessage = NO_CONTAINER_TARGET_MESSAGE;
out.fsScanArgs = buildFsScanArgs('tests/fixtures/trivy/clean-lockfile/');

// AI-37-R02 — the guard rejects an argument vector carrying `secret`.
try {
  assertNoSecretScanning(['fs', '--security-checks', 'vuln,config,secret', '.']);
  out.secretGuard = 'NOT_REJECTED';
} catch (err) {
  out.secretGuard = (err as Error).message;
}
out.secretGuardAllowsVulnConfig = (() => {
  try {
    assertNoSecretScanning(buildFsScanArgs('.'));
    return 'ALLOWED';
  } catch {
    return 'WRONGLY_REJECTED';
  }
})();

// executeTrivy exit-code mapping: 0 / 1 / anything else.
out.mapClean = executeTrivy('trivy', buildFsScanArgs('.'), fakeSpawn({ status: 0 }));
out.mapFinding = executeTrivy(
  'trivy',
  buildFsScanArgs('.'),
  fakeSpawn({ status: 1, stdout: 'CVE-2021-23337 lodash 4.17.20 -> 4.17.21' })
);
out.mapOperational = executeTrivy(
  'trivy',
  buildFsScanArgs('.'),
  fakeSpawn({ status: 2, stderr: 'flag provided but not defined' })
);
out.mapSpawnError = executeTrivy(
  'trivy',
  buildFsScanArgs('.'),
  fakeSpawn({ status: null, error: new Error('ENOENT') })
);
out.mapSecretRejected = executeTrivy(
  'trivy',
  ['fs', '--security-checks', 'vuln,config,secret', '.'],
  fakeSpawn({ status: 0 })
);

// A missing binary must be operational (2), never a clean scan (0).
out.missingBinary = runTrivyVerification([], {
  rootDir: repoRoot,
  getBin: () => null,
  logger: silent,
});
out.presentBinaryClean = runTrivyVerification([], {
  rootDir: repoRoot,
  getBin: () => 'trivy',
  spawnImpl: fakeSpawn({ status: 0 }),
  logger: silent,
});
out.presentBinaryFinding = runTrivyVerification([], {
  rootDir: repoRoot,
  getBin: () => 'trivy',
  spawnImpl: fakeSpawn({ status: 1, stdout: 'CVE-2021-23337' }),
  logger: silent,
});
out.presentBinaryOperational = runTrivyVerification([], {
  rootDir: repoRoot,
  getBin: () => 'trivy',
  spawnImpl: fakeSpawn({ status: 3, stderr: 'db download failed' }),
  logger: silent,
});

// getTrivyBinary resolves nothing when every probe throws.
out.getBinAbsent = getTrivyBinary(
  () => {
    throw new Error('not found');
  },
  { existsSync: () => false },
  {},
  'linux'
);
out.getBinOnPath = getTrivyBinary(() => undefined, { existsSync: () => false }, {}, 'linux');

// AI-37-R07 — container target enumeration against the real repository tree.
out.realAppDockerfiles = findAppDockerfiles(repoRoot);
out.containerNoTarget = runContainerTargetStep({
  rootDir: repoRoot,
  fsImpl: { existsSync: () => false, readdirSync: (() => []) as never },
  logger: silent,
});
const syntheticFs = {
  existsSync: (p: unknown) => String(p).includes('apps'),
  readdirSync: (() => [{ name: 'api', isDirectory: () => true }]) as never,
};
out.containerTargetNoScanner = runContainerTargetStep({
  rootDir: repoRoot,
  fsImpl: syntheticFs,
  getBin: () => null,
  logger: silent,
});
out.containerTargetScannerFinds = runContainerTargetStep({
  rootDir: repoRoot,
  fsImpl: syntheticFs,
  getBin: () => 'trivy',
  spawnImpl: fakeSpawn({ status: 1, stdout: 'Failures: 2 (HIGH: 2, CRITICAL: 0)' }),
  logger: silent,
});
out.containerTargetScannerClean = runContainerTargetStep({
  rootDir: repoRoot,
  fsImpl: syntheticFs,
  getBin: () => 'trivy',
  spawnImpl: fakeSpawn({ status: 0 }),
  logger: silent,
});

process.stdout.write('---HARNESS-JSON-START---\n');
process.stdout.write(JSON.stringify(out));
process.stdout.write('\n---HARNESS-JSON-END---\n');
