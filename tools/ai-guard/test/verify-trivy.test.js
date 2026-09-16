'use strict';

/**
 * TASK-AI-37 — `scripts/verify-trivy.ts`.
 *
 * The thing this suite exists to prove is narrow and specific: an ABSENT
 * scanner must be reported as an operational failure (exit 2), never as a
 * clean scan (exit 0). Reporting a missing binary as "0 vulnerabilities" is
 * the defect this Work Item removes, so every assertion below is written so
 * that a script which silently passes when Trivy is missing fails the suite.
 *
 * `verify-trivy.ts` is TypeScript; `node --test` is plain Node. The suite
 * therefore drives the real module through `tsx`:
 *  - once via `fixtures/trivy-harness.ts`, which exercises every branch with
 *    injected dependencies and prints the real return values as JSON;
 *  - once end to end, running the CLI with `PATH` reduced to the Node
 *    directory so that the outcome does not depend on whether the workstation
 *    happens to have Trivy installed.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'verify-trivy.ts');
const HARNESS = path.join(__dirname, 'fixtures', 'trivy-harness.ts');

// Always launched through `process.execPath`, never through a `.cmd` shim:
// `spawnSync` with `shell: false` cannot execute `.cmd` files on Windows.
function tsxPrefix() {
  const localCli = path.join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  if (fs.existsSync(localCli)) {
    return [localCli];
  }
  const npxCli = path.join(
    path.dirname(process.execPath),
    'node_modules',
    'npm',
    'bin',
    'npx-cli.js'
  );
  assert.ok(
    fs.existsSync(npxCli),
    'neither node_modules/tsx nor npm npx-cli.js is available to run the TypeScript script under test'
  );
  return [npxCli, '--yes', 'tsx'];
}

function runTsx(args, env) {
  const command = process.execPath;
  const prefix = tsxPrefix();
  return spawnSync(command, [...prefix, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
    shell: false,
    timeout: 180000,
    env: { ...process.env, ...env },
  });
}

let harnessCache = null;
function harness() {
  if (harnessCache) return harnessCache;
  const result = runTsx([HARNESS]);
  assert.equal(
    result.error,
    undefined,
    `could not run tsx harness: ${result.error && result.error.message}`
  );
  const stdout = result.stdout || '';
  const match = stdout.match(/---HARNESS-JSON-START---\r?\n([\s\S]*?)\r?\n---HARNESS-JSON-END---/);
  assert.ok(
    match,
    `harness produced no JSON payload (exit ${result.status}).\nstdout:\n${stdout}\nstderr:\n${result.stderr}`
  );
  harnessCache = JSON.parse(match[1]);
  return harnessCache;
}

test('scripts/verify-trivy.ts exists and is the file under test', () => {
  assert.ok(fs.existsSync(SCRIPT), `${SCRIPT} is missing`);
  const source = fs.readFileSync(SCRIPT, 'utf-8');
  assert.ok(source.trim().length > 0, 'verify-trivy.ts is empty');
});

test('a missing scanner is an operational failure, not a clean scan', async (t) => {
  await t.test('runTrivyVerification returns exit 2 when no binary resolves', () => {
    const h = harness();
    assert.deepEqual(h.missingBinary, {
      kind: 'operational',
      exitCode: 2,
      message: 'TRIVY_BINARY_NOT_FOUND',
    });
    assert.notEqual(h.missingBinary.exitCode, 0, 'absent scanner must never report a clean scan');
    assert.notEqual(
      h.missingBinary.exitCode,
      1,
      'absent scanner is not a vulnerability finding either'
    );
  });

  await t.test('getTrivyBinary returns null when every probe fails', () => {
    assert.equal(harness().getBinAbsent, null);
  });

  await t.test('getTrivyBinary returns the PATH name when the probe succeeds', () => {
    assert.equal(harness().getBinOnPath, 'trivy');
  });

  await t.test('the CLI exits 2 end to end with Trivy unreachable', () => {
    // PATH is reduced to the Node directory so this asserts the script, not
    // whatever the workstation happens to have installed.
    const nodeDir = path.dirname(process.execPath);
    const empty = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'trivy-absent-'));
    try {
      const result = runTsx([SCRIPT, '.'], {
        PATH: nodeDir,
        Path: nodeDir,
        TRIVY_BIN: path.join(empty, 'trivy'),
        TEMP: empty,
        TMP: empty,
      });
      assert.equal(result.status, 2, `expected exit 2, got ${result.status}\n${result.stderr}`);
      const combined = `${result.stdout || ''}${result.stderr || ''}`;
      assert.match(combined, /Không tìm thấy native binary Trivy CLI/);
      assert.doesNotMatch(combined, /0 lỗ hổng HIGH\/CRITICAL có bản vá/);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
});

test('the three outcomes stay distinct: clean=0 vulnerable=1 operational=2', async (t) => {
  await t.test('exit code 0 from Trivy maps to a clean outcome', () => {
    assert.deepEqual(harness().mapClean, { kind: 'clean', exitCode: 0 });
    assert.equal(harness().presentBinaryClean.exitCode, 0);
  });

  await t.test('exit code 1 from Trivy maps to a finding, carrying its output', () => {
    const h = harness();
    assert.equal(h.mapFinding.kind, 'finding');
    assert.equal(h.mapFinding.exitCode, 1);
    assert.match(h.mapFinding.findingsOutput, /CVE-2021-23337/);
    assert.equal(h.presentBinaryFinding.exitCode, 1);
  });

  await t.test('any other exit code maps to operational, never to clean', () => {
    const h = harness();
    assert.equal(h.mapOperational.kind, 'operational');
    assert.equal(h.mapOperational.exitCode, 2);
    assert.match(h.mapOperational.message, /flag provided but not defined/);
    assert.equal(h.presentBinaryOperational.exitCode, 2);
  });

  await t.test('a spawn error is operational, never clean', () => {
    assert.equal(harness().mapSpawnError.kind, 'operational');
    assert.equal(harness().mapSpawnError.exitCode, 2);
  });

  await t.test('the three codes are pairwise distinct', () => {
    const h = harness();
    const codes = [h.mapClean.exitCode, h.mapFinding.exitCode, h.mapOperational.exitCode];
    assert.deepEqual(codes, [0, 1, 2]);
    assert.equal(new Set(codes).size, 3, 'clean, vulnerable and operational must not collapse');
  });
});

test('AI-37-R02: secret scanning stays with Gitleaks alone', async (t) => {
  await t.test('the blocking argument vector omits the secret checker', () => {
    const h = harness();
    assert.equal(h.securityChecks, 'vuln,config');
    assert.ok(!h.securityChecks.split(',').includes('secret'));
    assert.ok(!h.fsScanArgs.some((a) => String(a).includes('secret')));
  });

  await t.test('a vector requesting secret scanning is refused', () => {
    assert.match(harness().secretGuard, /AI-37-R02 violation/);
    assert.equal(harness().secretGuardAllowsVulnConfig, 'ALLOWED');
  });

  await t.test('the refusal is operational, so the scan cannot silently proceed', () => {
    assert.equal(harness().mapSecretRejected.exitCode, 2);
  });
});

test('AI-37-R04: the blocking threshold is HIGH,CRITICAL with fixes available', () => {
  const args = harness().fsScanArgs;
  const flag = (name) => args[args.indexOf(name) + 1];
  assert.ok(args.includes('fs'));
  assert.equal(flag('--severity'), 'HIGH,CRITICAL');
  assert.equal(flag('--exit-code'), '1');
  assert.ok(args.includes('--ignore-unfixed'));
  assert.equal(args[args.length - 1], 'tests/fixtures/trivy/clean-lockfile/');
});

test('AI-37-R07: the container fallback is truthful, not a suppressed failure', async (t) => {
  await t.test('no apps/*/Dockerfile exists in this repository right now', () => {
    assert.deepEqual(harness().realAppDockerfiles, []);
  });

  await t.test('no target reports NO_CONTAINER_TARGET and exits 0', () => {
    const h = harness();
    assert.equal(
      h.noContainerTargetMessage,
      'NO_CONTAINER_TARGET: No Dockerfile found in apps/*; container scan skipped'
    );
    assert.equal(h.containerNoTarget.exitCode, 0);
    assert.equal(h.containerNoTarget.message, h.noContainerTargetMessage);
  });

  await t.test('a real target with no scanner is operational, not skipped', () => {
    const outcome = harness().containerTargetScannerClean;
    assert.equal(outcome.exitCode, 0);
    const absent = harness().containerTargetNoScanner;
    assert.equal(absent.exitCode, 2);
    assert.match(absent.message, /CONTAINER_TARGET_PRESENT_BUT_SCANNER_ABSENT/);
    assert.notEqual(
      absent.message,
      harness().noContainerTargetMessage,
      'a present target must not be reported as NO_CONTAINER_TARGET'
    );
  });

  await t.test('a real target with findings blocks on exit 1', () => {
    assert.equal(harness().containerTargetScannerFinds.exitCode, 1);
  });
});

test('the pinned version matches tools/ecosystem-manifest.json', () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, 'tools', 'ecosystem-manifest.json'), 'utf-8')
  );
  const trivy = manifest.adopted.find((t) => t.id === 'trivy');
  assert.ok(trivy, 'trivy entry missing from the ecosystem manifest');
  assert.equal(harness().pinnedVersion, trivy.pinned_version_or_commit);
});

test('AC-AI-37-07 acceptance script rejects a tampered copy of the real manifest', async (t) => {
  const script = path.join(
    REPO_ROOT,
    'tools',
    'ai-brain',
    'acceptance',
    'ac-37-07-forbidden-lifecycle.js'
  );

  await t.test('it exits 1 and names the forbidden script when run at the repo root', () => {
    const result = spawnSync(process.execPath, [script], {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
      shell: false,
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /FORBIDDEN_LIFECYCLE_SCRIPT: detected preinstall/);
  });

  await t.test('it exits 2, not 1, when run outside the repository', () => {
    const outside = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'ac-37-07-outside-'));
    try {
      const result = spawnSync(process.execPath, [script], {
        cwd: outside,
        encoding: 'utf-8',
        shell: false,
      });
      assert.equal(result.status, 2, `expected exit 2 outside the repo, got ${result.status}`);
      assert.match(result.stderr, /SOURCE_MISSING: package\.json/);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  await t.test('the real root manifest is genuinely clean', () => {
    const root = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf-8'));
    const forbidden = ['preinstall', 'install', 'postinstall', 'prepare'];
    assert.deepEqual(
      forbidden.filter((s) => root.scripts && root.scripts[s]),
      []
    );
  });
});
