'use strict';
// AC-AI-44-01 — an AgentRouter key that the probe cannot verify is reported as
// UNAVAILABLE and records a failure, never as CONFIGURED.
//
// Drives the shipped probe block in scripts/ai/doctor.ps1 (lines 136-324) across
// timeout, unexpected probe output, exception, authenticated, no-key, cached
// replay, 401, 402, 503 and catalog mismatch scenarios.
//
// Asserts that each unverified arm records exactly one failure, that cached
// unverified verdicts replay without re-probing, and that no recorded failure,
// detail or cache field leaks secret key material.
//
// Exit codes: 0 the invariant holds - 1 violation detected - 2 cannot measure.

const fs = require('fs');
const cp = require('child_process');
const crypto = require('crypto');
const os = require('os');
const path = require('path');

const DOCTOR = 'scripts/ai/doctor.ps1';

if (!fs.existsSync(DOCTOR)) {
  console.error('SOURCE_MISSING: run from the repository root (' + DOCTOR + ')');
  process.exit(2);
}

const doctor = fs.readFileSync(DOCTOR, 'utf8');

// 1. Sanity check: doctor.ps1 must not contain stale CONFIGURED-but-unverified text anywhere
if (doctor.includes('CONFIGURED but unverified')) {
  console.error('VIOLATION: doctor.ps1 contains stale "CONFIGURED but unverified" text');
  process.exit(1);
}

const lines = doctor.split(/\r?\n/);
const block = lines.slice(135, 323).join('\r\n');

function computeKeyHash(key) {
  return crypto.createHash('sha256').update(key, 'utf8').digest('hex').toUpperCase().substring(0, 16);
}

function getPowershellCmd() {
  if (process.platform === 'win32') {
    try {
      const probe = cp.spawnSync('pwsh.exe', ['-v'], { encoding: 'utf8', stdio: 'ignore' });
      if (probe.status === 0) return 'pwsh.exe';
    } catch {}
    return 'powershell.exe';
  }
  return 'pwsh';
}

const psCmd = getPowershellCmd();

function runScenarioOnBlock(codeBlock, scenario, secretKey, setupCache = null) {
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-ac44-'));
  const psScriptPath = path.join(testDir, 'harness.ps1');

  if (setupCache) {
    const cachePath = path.join(testDir, 'shipde-agentrouter-probe.json');
    fs.writeFileSync(cachePath, JSON.stringify(setupCache), 'utf8');
  }

  const harnessPs1 = [
    'param([string]$Scenario, [string]$SecretKey, [string]$TempDir)',
    'function Get-ShipDeTempDir { return $TempDir }',
    '$failures = [System.Collections.Generic.List[string]]::new()',
    'if ($Scenario -ne "no_key") { $agentRouterKey = $SecretKey } else { $agentRouterKey = $null }',
    '$script:probeCalled = $false',
    'function Invoke-ShipDeBoundedProbe {',
    '    param([string]$CommandText, [int]$TimeoutSeconds = 60)',
    '    $script:probeCalled = $true',
    '    if ($Scenario -eq "timeout") {',
    '        return [pscustomobject]@{ Output = ""; TimedOut = $true; ExitCode = $null }',
    '    }',
    '    if ($Scenario -eq "unexpected") {',
    '        return [pscustomobject]@{ Output = "UNEXPECTED_RAW_OUTPUT_FROM_GATEWAY"; TimedOut = $false; ExitCode = 0 }',
    '    }',
    '    if ($Scenario -eq "exception") {',
    '        throw "connection reset by peer"',
    '    }',
    '    if ($Scenario -eq "auth_ok") {',
    '        return [pscustomobject]@{ Output = "SHIPDE_AUTH_OK"; TimedOut = $false; ExitCode = 0 }',
    '    }',
    '    if ($Scenario -eq "401") {',
    '        return [pscustomobject]@{ Output = "HTTP 401 Unauthorized"; TimedOut = $false; ExitCode = 1 }',
    '    }',
    '    if ($Scenario -eq "402") {',
    '        return [pscustomobject]@{ Output = "HTTP 402 budget pool exhausted"; TimedOut = $false; ExitCode = 1 }',
    '    }',
    '    if ($Scenario -eq "503") {',
    '        return [pscustomobject]@{ Output = "HTTP 503 service unavailable"; TimedOut = $false; ExitCode = 1 }',
    '    }',
    '    if ($Scenario -eq "catalog") {',
    '        return [pscustomobject]@{ Output = "error: model catalog does not recognise model"; TimedOut = $false; ExitCode = 1 }',
    '    }',
    '    throw ("Unknown scenario: " + $Scenario)',
    '}',
    codeBlock,
    '[ordered]@{',
    '    live = $agentRouterLive',
    '    detail = $agentRouterDetail',
    '    failure = $agentRouterFailure',
    '    failures = @($failures)',
    '    probeCalled = $script:probeCalled',
    '} | ConvertTo-Json -Compress'
  ].join('\r\n');

  fs.writeFileSync(psScriptPath, harnessPs1, 'utf8');

  const res = cp.spawnSync(psCmd, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psScriptPath, '-Scenario', scenario, '-SecretKey', secretKey || '', '-TempDir', testDir], { encoding: 'utf8' });

  let cacheContent = null;
  const cachePath = path.join(testDir, 'shipde-agentrouter-probe.json');
  if (fs.existsSync(cachePath)) {
    const raw = fs.readFileSync(cachePath, 'utf8').replace(/^\uFEFF/, '');
    cacheContent = JSON.parse(raw);
  }

  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch {}

  if (res.status !== 0) {
    throw new Error(`Harness execution failed for ${scenario}: ${res.stderr || res.stdout}`);
  }

  const cleanOut = res.stdout.trim().replace(/^\uFEFF/, '');
  const result = JSON.parse(cleanOut);
  result.cache = cacheContent;
  return result;
}

const secretKey = 'TEST_SECRET_AGENTROUTER_KEY_999';

// 2. Control assertion: detector must catch a tampered block where timeout arm was reverted
const unverifiedTimeoutPattern =
  /(\$agentRouterDetail = "UNAVAILABLE: key present but unverified \(probe timed out\)[^"]*"\r?\n\s*)(\$agentRouterFailure = "[^"]*")/;
const tamperedBlock = block.replace(
  unverifiedTimeoutPattern,
  '$agentRouterDetail = "CONFIGURED but unverified (probe timed out); the Claude and Codex fallback route will be attempted"\r\n            $agentRouterFailure = $null'
);
if (tamperedBlock === block) {
  console.error('CONTROL_FAILED: could not construct tampered block for control test');
  process.exit(2);
}
const tamperedResult = runScenarioOnBlock(tamperedBlock, 'timeout', secretKey);
if (tamperedResult.failures.length !== 0 || !tamperedResult.detail.includes('CONFIGURED but unverified')) {
  console.error('CONTROL_FAILED: tampered block did not reproduce un-failed state');
  process.exit(2);
}
console.log('CONTROL: removed fail-closed timeout arm detected in tampered copy (' + tamperedResult.detail + ')');

// 3. Shipped block scenarios
const scenarios = [
  { name: 'timeout', expectedLive: false, expectedFailures: 1, detailSubstring: 'UNAVAILABLE: key present but unverified (probe timed out)' },
  { name: 'unexpected', expectedLive: false, expectedFailures: 1, detailSubstring: 'UNAVAILABLE: key present but unverified (unexpected probe output)' },
  { name: 'exception', expectedLive: false, expectedFailures: 1, detailSubstring: 'UNAVAILABLE: key present but unverified' },
  { name: 'auth_ok', expectedLive: true, expectedFailures: 0, detailSubstring: 'AUTHENTICATED via deepseek-v4-flash' },
  { name: 'no_key', expectedLive: false, expectedFailures: 0, detailSubstring: 'NOT CONFIGURED' },
  { name: '401', expectedLive: false, expectedFailures: 1, detailSubstring: 'KEY PRESENT BUT REJECTED' },
  { name: '402', expectedLive: false, expectedFailures: 1, detailSubstring: 'budget pool is exhausted' },
  { name: '503', expectedLive: false, expectedFailures: 0, detailSubstring: 'no channel for deepseek-v4-flash' },
  { name: 'catalog', expectedLive: false, expectedFailures: 0, detailSubstring: 'does not recognise the probe model' },
];

for (const sc of scenarios) {
  const res = runScenarioOnBlock(block, sc.name, secretKey);
  if (res.live !== sc.expectedLive) {
    console.error(`SCENARIO_FAILED: ${sc.name} expected live=${sc.expectedLive}, got ${res.live}`);
    process.exit(1);
  }
  if (res.failures.length !== sc.expectedFailures) {
    console.error(`SCENARIO_FAILED: ${sc.name} expected failures=${sc.expectedFailures}, got ${res.failures.length}`);
    process.exit(1);
  }
  if (!res.detail.includes(sc.detailSubstring)) {
    console.error(`SCENARIO_FAILED: ${sc.name} detail mismatch: "${res.detail}" does not contain "${sc.detailSubstring}"`);
    process.exit(1);
  }

  // Strict secret isolation: secret key must never appear in detail, failure, or cache fields
  if (res.detail.includes(secretKey)) {
    console.error(`SECRET_LEAK: ${sc.name} detail contains secret key!`);
    process.exit(1);
  }
  if (res.failure && res.failure.includes(secretKey)) {
    console.error(`SECRET_LEAK: ${sc.name} failure contains secret key!`);
    process.exit(1);
  }
  for (const f of res.failures) {
    if (f.includes(secretKey)) {
      console.error(`SECRET_LEAK: ${sc.name} failures list contains secret key!`);
      process.exit(1);
    }
  }
  if (res.cache) {
    if (res.cache.detail && res.cache.detail.includes(secretKey)) {
      console.error(`SECRET_LEAK: ${sc.name} cache.detail contains secret key!`);
      process.exit(1);
    }
    if (res.cache.failure && res.cache.failure.includes(secretKey)) {
      console.error(`SECRET_LEAK: ${sc.name} cache.failure contains secret key!`);
      process.exit(1);
    }
    if (res.cache.keyHash && res.cache.keyHash.includes(secretKey)) {
      console.error(`SECRET_LEAK: ${sc.name} cache.keyHash contains secret key!`);
      process.exit(1);
    }
  }
}

// 4. Cached replay scenario
const cachedSetup = {
  observedAt: new Date(Date.now() - 60000).toISOString(),
  keyHash: computeKeyHash(secretKey),
  live: false,
  detail: 'UNAVAILABLE: key present but unverified (probe timed out); the Claude and Codex fallback route is not reported available',
  failure: 'AGENTROUTER_API_KEY could not be verified (probe timed out); treat the AgentRouter fallback as unavailable -- see TASK-AI-44'
};
const cachedRes = runScenarioOnBlock(block, 'cached_replay', secretKey, cachedSetup);
if (cachedRes.probeCalled !== false) {
  console.error('CACHED_REPLAY_FAILED: probe was called despite valid cache');
  process.exit(1);
}
if (cachedRes.live !== false || cachedRes.failures.length !== 1 || !cachedRes.detail.includes('[cached')) {
  console.error('CACHED_REPLAY_FAILED: cached replay did not produce expected unverified failure', cachedRes);
  process.exit(1);
}
if (cachedRes.detail.includes(secretKey) || (cachedRes.failure && cachedRes.failure.includes(secretKey))) {
  console.error('SECRET_LEAK: cached replay leaked secret key!');
  process.exit(1);
}

console.log('SANITY OK: no stale CONFIGURED-but-unverified text in doctor.ps1');
console.log('AC-AI-44-01 held: all unverified arms fail-closed, cached replay verified, zero secret leaks');
process.exit(0);
