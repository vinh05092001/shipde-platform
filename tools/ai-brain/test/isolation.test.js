'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  publish,
  buildSanitizedMirror,
  transferReviewedObjects,
  SAFE_MIRROR_CONFIG,
} = require('../publisher');
const {
  getIsolatedLauncher,
  getFolderHash,
  defaultVerifyBoundary,
  buildBoundaryVerifyScript,
  buildWorkerLaunchScript,
  EXPECTED_FIREWALL_RULES,
} = require('../isolation-launcher');

// The host PowerShell is emitted by buildWorkerLaunchScript, not by the
// launcher body itself, so source-text assertions read both production
// functions. Same production source as before, only relocated.
function launcherSource() {
  return getIsolatedLauncher().toString() + '\n' + buildWorkerLaunchScript.toString();
}

const scriptsDir = path.join(__dirname, '../../../scripts/ai/isolation');

// Portable, per-run verdict directory: the test writes the verdict here and
// injects this path into the launcher so the code reads it on every OS. The
// production default (LOCALAPPDATA\ShipDe on Windows) is untouched in the
// launcher; this only overrides it for the test.
const verdictDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-verdict-'));
const verdictPath = path.join(verdictDir, 'isolation-verdict.json');

// Tests that execute PowerShell (parser checks, -WhatIf, secedit filter,
// mocked verifier) run only where a PowerShell binary exists: powershell.exe
// on win32, or pwsh on PATH. Otherwise they skip with a clear reason. The
// tests are not deleted — they still fully run on Windows and on any host with
// pwsh available.
function detectPowerShell() {
  if (process.platform === 'win32') {
    const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', 'exit 0'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    if (r.status === 0) return 'powershell.exe';
  }
  const r = spawnSync('pwsh', ['-NoProfile', '-Command', 'exit 0'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (r.status === 0) return 'pwsh';
  return null;
}
const POWERSHELL_EXE = detectPowerShell();
const psSkip = POWERSHELL_EXE
  ? {}
  : { skip: 'PowerShell binary not available (powershell.exe on win32 or pwsh on PATH)' };
// The -WhatIf provisioning snapshot runs the real worker scripts, which call
// Windows-only cmdlets (Get-LocalUser, secedit, NetFirewall); it needs win32.
const whatIfSkip =
  process.platform === 'win32' && POWERSHELL_EXE
    ? {}
    : { skip: 'WhatIf provisioning snapshot requires Windows PowerShell + Windows cmdlets' };

// Test-only script variant. Production buildBoundaryVerifyScript is left
// unchanged (registry Get-ItemProperty and Get-Acl). Tests substitute those
// calls with fixed literals so the same parser runs under pwsh on Linux,
// where the HKLM provider and Windows SID translation are absent. Nothing is
// read from a variable the production script could also see.
function boundaryTestScript(productionScript, ruleEntries, fwProfilesOn, aces) {
  // Single-quoted here-strings: a rule value contains the SDDL ';' sequence,
  // which a single-quoted literal would treat as a statement separator.
  const q = (value) => "'" + String(value).replace(/'/g, "''") + "'";
  const lit = (value) => "@'\n" + String(value).replace(/'@/g, "'@ ") + "\n'@";
  // PSCustomObject, the same shape Get-ItemProperty returns. A hashtable's
  // PSObject.Properties.Name lists dictionary members, not its keys, so the
  // verifier would never see the rule names.
  const rules =
    '[pscustomobject]@{ ' +
    ruleEntries.map((e) => lit(e.name) + ' = ' + lit(e.value)).join('; ') +
    ' }';
  const profile = fwProfilesOn ? '@{ EnableFirewall = 1 }' : '@{ EnableFirewall = 0 }';
  const aceStmts = aces
    .map((ace) => {
      const translate =
        ace.translatedSid === null
          ? '{ param($t) throw "untranslatable" }'
          : '{ param($t) [pscustomobject]@{ Value = ' + q(ace.translatedSid) + ' } }';
      return (
        '$identity = [pscustomobject]@{ Value = ' +
        q(ace.identity) +
        ' }; $identity | Add-Member -MemberType ScriptMethod -Name Translate -Force -Value ' +
        translate +
        '; $aces += [pscustomobject]@{ IdentityReference = $identity; AccessControlType = ' +
        q(ace.type) +
        '; FileSystemRights = ' +
        Number(ace.rights) +
        '; InheritanceFlags = ' +
        Number(ace.flags) +
        ' }; '
      );
    })
    .join('');
  // A plain array: Windows PowerShell 5.1 throws "Argument types do not
  // match" when @() unrolls a generic List[object].
  const acl = '$aces = @(); ' + aceStmts + '$acl = [pscustomobject]@{ Access = $aces }; ';
  const replacements = [
    [
      '  $val = Get-ItemProperty -Path "$profilePath\\$p" -Name EnableFirewall -ErrorAction SilentlyContinue; ',
      '  $val = ' + profile + '; ',
    ],
    [
      'if (Test-Path $fwRulesPath) { $raw = @(); try { $raw = Get-Item -Path $fwRulesPath -ErrorAction Stop | Get-ItemProperty -ErrorAction Stop } catch {}; ',
      'if ($true) { $raw = ' + rules + '; ',
    ],
    ['$acl = Get-Acl $env:USERPROFILE; ', acl],
  ];
  let script = productionScript;
  for (const [needle, replacement] of replacements) {
    const at = script.indexOf(needle);
    if (at < 0 || script.indexOf(needle, at + needle.length) !== -1) {
      throw new Error('boundary test variant could not uniquely replace a production read');
    }
    script = script.slice(0, at) + replacement + script.slice(at + needle.length);
  }
  return script;
}

function makeTempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-worker-tree-'));
  const git = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8', windowsHide: true });
  git(['init', '-q']);
  git(['config', 'user.email', 'worker@shipde.test']);
  git(['config', 'user.name', 'Worker']);
  fs.writeFileSync(path.join(dir, 'payload.txt'), 'reviewed content\n');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'init']);
  // The worker-writable tree sets a hostile push remote in its own .git/config.
  git(['remote', 'add', 'origin', 'https://attacker.example/loot.git']);
  const sha = git(['rev-parse', 'HEAD']).stdout.trim();
  return { dir, sha };
}

function writeVerdict(obj) {
  fs.writeFileSync(verdictPath, JSON.stringify(obj));
}

test('publisher refusal cases', () => {
  const repo = makeTempRepo();
  const validExpiry = Date.now() + 60000;
  const expiredExpiry = Date.now() - 60000;
  const trustedUrl = 'https://github.com/vinh05092001/shipde-platform.git';

  const full = (extra) =>
    publish(
      Object.assign(
        {
          cwd: repo.dir,
          reviewedSha: repo.sha,
          approvalId: '123',
          expiry: validExpiry,
          verdict: 'PASS',
          testMode: true,
          remoteUrl: trustedUrl,
          // Never touch the operator's real %LOCALAPPDATA% registry: inject a
          // per-test path under the temp repo (absent file must not read it).
          registryPath: path.join(repo.dir, 'approvals.json'),
        },
        extra
      )
    );

  assert.throws(() => publish({}), /PUBLISH_REFUSED: missing cwd/);
  assert.throws(() => publish({ cwd: repo.dir }), /PUBLISH_REFUSED: missing reviewedSha/);
  assert.throws(
    () => publish({ cwd: repo.dir, reviewedSha: repo.sha }),
    /PUBLISH_REFUSED: missing approvalId/
  );
  assert.throws(
    () => publish({ cwd: repo.dir, reviewedSha: repo.sha, approvalId: '123' }),
    /PUBLISH_REFUSED: missing expiry/
  );
  assert.throws(
    () =>
      publish({
        cwd: repo.dir,
        reviewedSha: repo.sha,
        approvalId: '123',
        expiry: expiredExpiry,
        verdict: 'PASS',
        testMode: true,
        remoteUrl: trustedUrl,
      }),
    /PUBLISH_REFUSED: approval expired/
  );
  assert.throws(
    () =>
      publish({
        cwd: repo.dir,
        reviewedSha: repo.sha,
        approvalId: '123',
        expiry: validExpiry,
        verdict: 'FAIL',
        testMode: true,
        remoteUrl: trustedUrl,
      }),
    /PUBLISH_REFUSED: missing PASS verdict/
  );
  assert.throws(
    () => full({ reviewedSha: 'dummy-sha-that-wont-match' }),
    /PUBLISH_REFUSED: SHA mismatch/
  );

  fs.rmSync(repo.dir, { recursive: true, force: true });
});

test('publisher takes the push destination only from trusted controller input (P1)', () => {
  const repo = makeTempRepo(); // .git/config in this tree points at attacker.example
  const trustedUrl = 'https://github.com/vinh05092001/shipde-platform.git';

  const call = (extra) =>
    publish(
      Object.assign(
        {
          cwd: repo.dir,
          reviewedSha: repo.sha,
          approvalId: '123',
          expiry: Date.now() + 60000,
          verdict: 'PASS',
          testMode: true,
          registryPath: path.join(repo.dir, 'approvals.json'),
        },
        extra
      )
    );

  // No trusted remoteUrl: refuse even though the worker tree configured one.
  assert.throws(() => call({}), /PUBLISH_REFUSED: missing remoteUrl/);

  // Trusted remoteUrl wins verbatim; the hostile cwd remote is never consulted.
  const res = call({ remoteUrl: trustedUrl, branch: 'publish-target' });
  assert.strictEqual(res.status, 'published');
  assert.strictEqual(res.remoteUrl, trustedUrl);
  assert.strictEqual(res.branch, 'publish-target');
  assert.strictEqual(res.simulated, true);

  // Non-https and malformed destinations are refused.
  assert.throws(() => call({ remoteUrl: 'http://attacker.example/loot.git' }), /must be https/);
  assert.throws(() => call({ remoteUrl: 'not a url' }), /not a valid URL/);

  // Branch injection through the trusted branch option is refused.
  assert.throws(
    () => call({ remoteUrl: trustedUrl, branch: 'main; rm -rf /' }),
    /PUBLISH_REFUSED: invalid branch name/
  );
  assert.throws(
    () => call({ remoteUrl: trustedUrl, branch: '../evil' }),
    /PUBLISH_REFUSED: invalid branch name/
  );

  fs.rmSync(repo.dir, { recursive: true, force: true });
});

test('publisher validates the approval registry and keeps no argv fallback (P2)', () => {
  const repo = makeTempRepo();
  const regDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-registry-'));
  const regPath = path.join(regDir, 'approvals.json');
  fs.writeFileSync(regPath, JSON.stringify({ 'AP-1': 'APPROVED', 'AP-2': 'REJECTED' }));

  const call = (extra) =>
    publish(
      Object.assign(
        {
          cwd: repo.dir,
          reviewedSha: repo.sha,
          approvalId: '123',
          expiry: Date.now() + 60000,
          verdict: 'PASS',
          testMode: true,
          remoteUrl: 'https://github.com/vinh05092001/shipde-platform.git',
        },
        extra
      )
    );

  // Registry present: unregistered and non-APPROVED ids are refused.
  assert.throws(
    () => call({ approvalId: 'AP-2', registryPath: regPath }),
    /not registered or not APPROVED/
  );
  assert.throws(
    () => call({ approvalId: 'AP-9', registryPath: regPath }),
    /not registered or not APPROVED/
  );

  // A registered APPROVED id passes the gate.
  assert.strictEqual(call({ approvalId: 'AP-1', registryPath: regPath }).status, 'published');

  // Registry absent without testMode: refused, even though this test process's
  // argv naturally contains the word "test" (the old heuristic must not exist).
  assert.throws(
    () => call({ registryPath: path.join(regDir, 'missing.json'), testMode: false }),
    /PUBLISH_REFUSED: approval registry not found/
  );

  fs.rmSync(regDir, { recursive: true, force: true });
  fs.rmSync(repo.dir, { recursive: true, force: true });
});

// The operator's real registry is written by PowerShell tooling, which emits a
// UTF-8 BOM. A BOM must never turn a valid approval into a publisher crash
// (SyntaxError) — the format check is JSON's own, not byte-order trivia.
test('publisher accepts an approval registry saved with a UTF-8 BOM (operator E2E)', () => {
  const repo = makeTempRepo();
  const regDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-registry-'));
  const regPath = path.join(regDir, 'approvals.json');
  fs.writeFileSync(regPath, '\uFEFF' + JSON.stringify({ AP1: 'APPROVED' }), 'utf8');

  const res = publish({
    cwd: repo.dir,
    reviewedSha: repo.sha,
    approvalId: 'AP1',
    expiry: Date.now() + 60000,
    verdict: 'PASS',
    testMode: true,
    registryPath: regPath,
    remoteUrl: 'https://github.com/vinh05092001/shipde-platform.git',
    branch: 'main',
  });
  assert.strictEqual(res.status, 'published');

  fs.rmSync(regDir, { recursive: true, force: true });
  fs.rmSync(repo.dir, { recursive: true, force: true });
});

test('publisher never reads git config or argv (P1/P2 static)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../publisher.js'), 'utf8');
  assert.ok(!src.includes('remote.origin.url'), 'must not read remote.origin.url from the tree');
  // Q4 note: the literal 'config' string appears in publisher.js only as the
  // PATH of the sanitized mirror config (buildSanitizedMirror rewrites the
  // mirror's config file with SAFE_MIRROR_CONFIG before any fetch reads it).
  // git config must never be RUN as a subcommand against the worker tree.
  assert.ok(!src.includes("['config'"), 'must not run git config in the worker-writable tree');
  assert.ok(
    src.includes("path.join(mirrorDir, 'config')"),
    'the only config write targets the sanitized mirror'
  );
  assert.ok(!src.includes('abbrev-ref'), 'must not resolve the branch by running git in cwd');
  assert.ok(!src.includes('process.argv'), 'must not gate on argv');
  assert.ok(!src.includes('NODE_ENV'), 'must not gate on environment heuristics');
  // Q4: the fetch must never run upload-pack against the worker-writable cwd;
  // objects are transferred via the sanitized mirror.
  assert.ok(!src.match(/'fetch',\s*cwd/), 'must not fetch directly from the worker-writable cwd');
  assert.ok(src.includes('transferReviewedObjects('), 'publish must use the sanitized transfer');
});

test('isolated launcher refuses without fresh CLOSED verdict', () => {
  const launcher = getIsolatedLauncher();

  // Case 1: missing verdict
  if (fs.existsSync(verdictPath)) fs.unlinkSync(verdictPath);
  assert.throws(
    () => launcher({ command: 'echo' }, [], { verdictPath }),
    /ISOLATION_VERDICT_MISSING/
  );

  // Case 2: not CLOSED
  writeVerdict({ verdict: 'OPEN' });
  assert.throws(
    () => launcher({ command: 'echo' }, [], { verdictPath }),
    /ISOLATION_VERDICT_NOT_CLOSED/
  );

  // Case 3: stale verdict (mtime older than 24h)
  const staleTime = new Date(Date.now() - 25 * 60 * 60 * 1000);
  writeVerdict({ verdict: 'CLOSED' });
  fs.utimesSync(verdictPath, staleTime, staleTime);
  assert.throws(
    () => launcher({ command: 'echo' }, [], { verdictPath }),
    /ISOLATION_VERDICT_STALE/
  );

  // Clean up
  if (fs.existsSync(verdictPath)) fs.unlinkSync(verdictPath);
});

// A verdict file written by PowerShell tooling may carry a UTF-8 BOM; the
// launcher must reach the attestation checks, not die in JSON.parse.
test('isolated launcher parses a verdict saved with a UTF-8 BOM', () => {
  const launcher = getIsolatedLauncher();
  fs.writeFileSync(verdictPath, '\uFEFF' + JSON.stringify({ verdict: 'OPEN' }));
  assert.throws(
    () => launcher({ command: 'echo' }, [], { verdictPath }),
    /ISOLATION_VERDICT_NOT_CLOSED/
  );
  if (fs.existsSync(verdictPath)) fs.unlinkSync(verdictPath);
});

test('isolated launcher validates every attestation field and the live boundary (P5/P7)', () => {
  const launcher = getIsolatedLauncher();
  const tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-launch-'));
  const fakeSid = 'S-1-5-21-FAKEWORKERSID';
  const validVerdict = () => ({
    verdict: 'CLOSED',
    details: { github_push: 'PASS', operator_profile: 'PASS' },
    timestamp: new Date(Date.now() - 1000).toISOString(),
    sid: fakeSid,
    worktree: tmpCwd,
    policyHash: getFolderHash(path.join(tmpCwd, 'scripts/ai/isolation')),
  });
  const validOpts = () => ({
    cwd: tmpCwd,
    getWorkerSid: () => fakeSid,
    verifyBoundary: () => true,
    verdictPath,
  });
  const launch = (opts) => launcher({ command: 'echo' }, [], opts);

  // worktree missing
  const v1 = validVerdict();
  delete v1.worktree;
  writeVerdict(v1);
  assert.throws(
    () => launch(validOpts()),
    /ISOLATION_VERDICT_INVALID: worktree mismatch or missing/
  );

  // worktree mismatched: the full path is bound, so a leaf collision cannot share the verdict
  const v2 = validVerdict();
  v2.worktree = path.join(path.dirname(tmpCwd), 'other-job');
  writeVerdict(v2);
  assert.throws(
    () => launch(validOpts()),
    /ISOLATION_VERDICT_INVALID: worktree mismatch or missing/
  );

  // timestamp in future or missing
  const v3 = validVerdict();
  v3.timestamp = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  writeVerdict(v3);
  assert.throws(
    () => launch(validOpts()),
    /ISOLATION_VERDICT_INVALID: timestamp in future or missing/
  );
  const v3b = validVerdict();
  delete v3b.timestamp;
  writeVerdict(v3b);
  assert.throws(
    () => launch(validOpts()),
    /ISOLATION_VERDICT_INVALID: timestamp in future or missing/
  );

  // policyHash mismatch or missing
  const v4 = validVerdict();
  v4.policyHash = 'deadbeef';
  writeVerdict(v4);
  assert.throws(
    () => launch(validOpts()),
    /ISOLATION_VERDICT_INVALID: policyHash mismatch or missing/
  );
  const v4b = validVerdict();
  delete v4b.policyHash;
  writeVerdict(v4b);
  assert.throws(
    () => launch(validOpts()),
    /ISOLATION_VERDICT_INVALID: policyHash mismatch or missing/
  );

  // SID mismatch or missing
  const v5 = validVerdict();
  v5.sid = 'S-1-5-21-OTHER';
  writeVerdict(v5);
  assert.throws(() => launch(validOpts()), /ISOLATION_VERDICT_INVALID: SID mismatch or missing/);
  const v5b = validVerdict();
  delete v5b.sid;
  writeVerdict(v5b);
  assert.throws(() => launch(validOpts()), /ISOLATION_VERDICT_INVALID: SID mismatch or missing/);

  // details missing entirely
  const v6 = validVerdict();
  delete v6.details;
  writeVerdict(v6);
  assert.throws(() => launch(validOpts()), /ISOLATION_VERDICT_INVALID: details missing/);

  // details carrying a failing per-check outcome
  const v7 = validVerdict();
  v7.details.github_push = 'FAIL';
  writeVerdict(v7);
  assert.throws(() => launch(validOpts()), /ISOLATION_VERDICT_INVALID: check github_push = FAIL/);

  // boundary absent right now: refuse even with a fully valid verdict
  writeVerdict(validVerdict());
  assert.throws(
    () =>
      launch({
        cwd: tmpCwd,
        getWorkerSid: () => fakeSid,
        verifyBoundary: () => false,
        verdictPath,
      }),
    /ISOLATION_BOUNDARY_MISSING/
  );

  // fully valid verdict passes every gate and only fails afterwards, at
  // provisioning (tmpCwd is not a git repository) — proving validation runs
  // before any provisioning work.
  writeVerdict(validVerdict());
  assert.throws(() => launch(validOpts()), /Could not determine HEAD SHA/);

  if (fs.existsSync(verdictPath)) fs.unlinkSync(verdictPath);
  fs.rmSync(tmpCwd, { recursive: true, force: true });
});

test('launcher default boundary verifier checks every expected firewall rule (P5/Q3)', () => {
  const src = buildBoundaryVerifyScript('S-1-5-21-X', 'ShipDeWorker');
  // P5: reads firewall rules from registry non-elevated
  assert.ok(src.includes('FirewallRules'), 'reads firewall rules from registry');
  assert.ok(src.includes('EnableFirewall'), 'checks firewall profiles are enabled');
  assert.ok(src.includes('Get-Acl $env:USERPROFILE'), 'checks operator profile ACL');
  assert.ok(!src.includes('ShipDeBoundaryTestInput'), 'production script has no test-input seam');
  assert.ok(!/TestInput/.test(src), 'production script accepts no test-input variable');
  assert.ok(
    src.includes('Get-ItemProperty'),
    'production path still reads firewall profiles from the registry'
  );
  assert.ok(src.includes('Deny'), 'requires the Deny ACE');
  assert.ok(src.includes('ShipDe-Worker-'), 'scoped to the worker rule prefix');
  // Q3: every deterministically-created rule is verified by exact name, with
  // Active, Dir, Action and LUAuth (SDDL); the gate is "nothing missing", never
  // "at least one rule exists".
  for (const rule of EXPECTED_FIREWALL_RULES) {
    assert.ok(src.includes(rule.suffix), 'must verify rule ' + rule.suffix);
  }
  assert.ok(src.includes('$fields["Active"] -cne "TRUE"'), 'each rule must be Active=TRUE');
  assert.ok(src.includes('$fields["Dir"] -cne "Out"'), 'each rule must be Dir=Out');
  assert.ok(src.includes('$fields["Action"] -cne "Block"'), 'each rule must be Block');
  assert.ok(src.includes('$fields["LUAuth"]'), 'must check LUAuth SDDL scope');
  assert.ok(src.includes('$fields["Name"] -cne $ruleName'), 'name match is exact field equality');
  assert.ok(
    src.includes('$fields["Protocol"] -cne $wantProto'),
    'protocol match is exact field equality'
  );
  assert.ok(!src.includes('-notlike'), 'must not substring-match registry values');
  assert.ok(src.includes('D:(A;;CC;;;'), 'must compare against the worker SDDL string');
  assert.ok(!src.includes('$rules.Count -ge 1'), 'a partial rule set must not verify');
  assert.ok(src.includes('$missing.Count -eq 0'), 'the gate must be zero missing rules');
  assert.ok(src.includes('FW_OFF'), 'must fail closed when firewall is off');
});

test('Set-WorkerFirewall passes -LocalUser as an SDDL string and fails closed without the user', () => {
  const src = fs.readFileSync(path.join(scriptsDir, 'Set-WorkerFirewall.ps1'), 'utf8');

  // The SDDL string is built once from the resolved SID.
  assert.ok(
    src.includes('$LocalUserSddl = "D:(A;;CC;;;$Sid)"'),
    'SDDL string must be built once from the resolved SID'
  );

  // Every -LocalUser argument is the SDDL variable — never a bare SID and
  // never the username (New-NetFirewallRule rejects both with 0x80070057).
  const localUserArgs = src.match(/-LocalUser\s+\$\S+/g) || [];
  assert.ok(localUserArgs.length > 0, 'expected -LocalUser arguments in Set-WorkerFirewall.ps1');
  for (const arg of localUserArgs) {
    assert.strictEqual(
      arg,
      '-LocalUser $LocalUserSddl',
      'every -LocalUser must be $LocalUserSddl, got: ' + arg
    );
  }
  assert.ok(!src.includes('-LocalUser $Sid'), 'must not pass a bare SID to -LocalUser');
  assert.ok(
    !src.match(/-LocalUser \$Username/),
    'must not pass the username to -LocalUser (0x80070057)'
  );

  // The username fallback is gone: a missing user is a hard failure before
  // any rule is created, not a warning that continues with a bogus value.
  assert.ok(!src.includes('$Sid = $Username'), 'username fallback for the SID must be gone');
  assert.match(
    src,
    /if \(-not \$User\) \{\s*\r?\n\s*Write-Error "User \$Username does not exist/,
    'missing user must fail closed with Write-Error'
  );

  // Idempotency: existing ShipDe-Worker-<user>-* rules are removed before
  // creation so a partial previous run cannot leave stale allow rules.
  assert.match(
    src,
    /Get-NetFirewallRule -DisplayName "\$RulePrefix\*"[^|]*\|\s*Remove-NetFirewallRule/,
    'must clean up existing prefixed rules before creating new ones'
  );
  assert.ok(
    src.indexOf('| Remove-NetFirewallRule') < src.indexOf('New-NetFirewallRule -DisplayName'),
    'cleanup must run before the first New-NetFirewallRule'
  );
});

test(
  'boundary verifier rejects a partial or wrong-direction firewall rule set (Q3)',
  psSkip,
  () => {
    const sid = 'S-1-5-21-BOUNDARYTEST';
    const script = buildBoundaryVerifyScript(sid, 'ShipDeWorker');

    // Registry-style rule value: v2.30|Action=Block|Active=TRUE|Dir=Out|Protocol=6|...|Name=...|LUAuth=...
    const ruleValue = (name, protocolNum, active = 'TRUE', dir = 'Out', luAuth) => {
      return (
        'v2.30|Action=Block|Active=' +
        active +
        '|Dir=' +
        dir +
        '|Protocol=' +
        protocolNum +
        '|RA4=Any|RA6=Any|Edge=NO|Profile=Any|Platform=2:6:7|Name=' +
        name +
        '|LUAuth=' +
        (luAuth || 'D:(A;;CC;;;' + sid + ')') +
        '|'
      );
    };

    const runWithRegistry = (ruleEntries, fwProfilesOn, aceType) => {
      // Test-only variant: the production script's Get-ItemProperty / Get-Acl
      // reads are replaced with these literals. On Linux pwsh there is no
      // HKLM: drive and Windows SID translation is unavailable.
      const mockScript = boundaryTestScript(script, ruleEntries, fwProfilesOn, [
        {
          identity: sid,
          type: aceType,
          rights: 2032127,
          flags: 3,
          translatedSid: sid,
        },
      ]);
      const res = spawnSync(POWERSHELL_EXE, ['-NoProfile', '-Command', mockScript], {
        encoding: 'utf8',
        windowsHide: true,
      });
      assert.strictEqual(res.status, 0, 'mocked registry verifier failed: ' + res.stderr);
      return (res.stdout || '').trim();
    };

    const allRulesOk = [
      {
        name: 'ShipDe-Worker-ShipDeWorker-Block-TCP-IPv4',
        value: ruleValue('ShipDe-Worker-ShipDeWorker-Block-TCP-IPv4', '6'),
      },
      {
        name: 'ShipDe-Worker-ShipDeWorker-Block-TCP-IPv6-1',
        value: ruleValue('ShipDe-Worker-ShipDeWorker-Block-TCP-IPv6-1', '6'),
      },
      {
        name: 'ShipDe-Worker-ShipDeWorker-Block-TCP-IPv6-2',
        value: ruleValue('ShipDe-Worker-ShipDeWorker-Block-TCP-IPv6-2', '6'),
      },
      {
        name: 'ShipDe-Worker-ShipDeWorker-Block-TCP-Ports',
        value: ruleValue('ShipDe-Worker-ShipDeWorker-Block-TCP-Ports', '6'),
      },
      {
        name: 'ShipDe-Worker-ShipDeWorker-Block-UDP',
        value: ruleValue('ShipDe-Worker-ShipDeWorker-Block-UDP', '17'),
      },
      {
        name: 'ShipDe-Worker-ShipDeWorker-Block-ICMPv4',
        value: ruleValue('ShipDe-Worker-ShipDeWorker-Block-ICMPv4', '1'),
      },
      {
        name: 'ShipDe-Worker-ShipDeWorker-Block-ICMPv6',
        value: ruleValue('ShipDe-Worker-ShipDeWorker-Block-ICMPv6', '58'),
      },
      {
        name: 'ShipDe-Worker-ShipDeWorker-Block-SSH',
        value: ruleValue('ShipDe-Worker-ShipDeWorker-Block-SSH', '6'),
      },
    ];

    // Full deterministic rule set + Deny ACE: OK.
    assert.strictEqual(runWithRegistry(allRulesOk, true, 'Deny'), 'OK');

    // Partial set (Block-UDP removed): MISSING must name the absent rule.
    const partialBook = allRulesOk.filter((r) => r.name !== 'ShipDe-Worker-ShipDeWorker-Block-UDP');
    assert.strictEqual(runWithRegistry(partialBook, true, 'Deny'), 'MISSING:Block-UDP');

    // All rules present but one has Active=FALSE (disabled): still rejected.
    const disabledBook = allRulesOk.map((r) =>
      r.name === 'ShipDe-Worker-ShipDeWorker-Block-TCP-IPv4'
        ? {
            name: r.name,
            value: ruleValue('ShipDe-Worker-ShipDeWorker-Block-TCP-IPv4', '6', 'FALSE'),
          }
        : r
    );
    assert.strictEqual(runWithRegistry(disabledBook, true, 'Deny'), 'MISSING:Block-TCP-IPv4');

    // All rules present but one has wrong direction (Inbound instead of Out): still rejected.
    const inboundBook = allRulesOk.map((r) =>
      r.name === 'ShipDe-Worker-ShipDeWorker-Block-TCP-IPv4'
        ? {
            name: r.name,
            value: ruleValue('ShipDe-Worker-ShipDeWorker-Block-TCP-IPv4', '6', 'TRUE', 'In'),
          }
        : r
    );
    assert.strictEqual(runWithRegistry(inboundBook, true, 'Deny'), 'MISSING:Block-TCP-IPv4');

    // All rules present but one has wrong protocol: still rejected.
    const protoBook = allRulesOk.map((r) =>
      r.name === 'ShipDe-Worker-ShipDeWorker-Block-UDP'
        ? { name: r.name, value: ruleValue('ShipDe-Worker-ShipDeWorker-Block-UDP', '6') } // TCP instead of UDP
        : r
    );
    assert.strictEqual(runWithRegistry(protoBook, true, 'Deny'), 'MISSING:Block-UDP');

    // Protocol is exact field equality, not a substring: Protocol=17 (UDP) must
    // not satisfy ICMPv4 (1), and Protocol=60 must not satisfy TCP (6).
    const icmpAsUdp = allRulesOk.map((r) =>
      r.name === 'ShipDe-Worker-ShipDeWorker-Block-ICMPv4'
        ? { name: r.name, value: ruleValue('ShipDe-Worker-ShipDeWorker-Block-ICMPv4', '17') }
        : r
    );
    assert.strictEqual(runWithRegistry(icmpAsUdp, true, 'Deny'), 'MISSING:Block-ICMPv4');

    const tcpAs60 = allRulesOk.map((r) =>
      r.name === 'ShipDe-Worker-ShipDeWorker-Block-TCP-IPv4'
        ? { name: r.name, value: ruleValue('ShipDe-Worker-ShipDeWorker-Block-TCP-IPv4', '60') }
        : r
    );
    assert.strictEqual(runWithRegistry(tcpAs60, true, 'Deny'), 'MISSING:Block-TCP-IPv4');

    // Name match is the parsed Name field only. A value whose Name merely
    // contains the expected name, or that embeds Name=<expected> as a token
    // outside the Name field, must not match.
    const containedName = allRulesOk.map((r) =>
      r.name === 'ShipDe-Worker-ShipDeWorker-Block-TCP-IPv4'
        ? {
            name: r.name,
            value: ruleValue('Fake-ShipDe-Worker-ShipDeWorker-Block-TCP-IPv4-Copy', '6'),
          }
        : r
    );
    assert.strictEqual(runWithRegistry(containedName, true, 'Deny'), 'MISSING:Block-TCP-IPv4');

    const embeddedNameToken = allRulesOk.map((r) =>
      r.name === 'ShipDe-Worker-ShipDeWorker-Block-TCP-IPv4'
        ? {
            name: r.name,
            value:
              'v2.30|Action=Block|Active=TRUE|Dir=Out|Protocol=6|Name=evil|Name=ShipDe-Worker-ShipDeWorker-Block-TCP-IPv4|LUAuth=D:(A;;CC;;;' +
              sid +
              ')|',
          }
        : r
    );
    assert.strictEqual(runWithRegistry(embeddedNameToken, true, 'Deny'), 'MISSING:Block-TCP-IPv4');

    // Full rule set but no Deny ACE on the operator profile: rejected.
    assert.ok(runWithRegistry(allRulesOk, true, 'Allow') !== 'OK');

    // Full rule set but rules scoped to another user's SDDL: rejected. The
    // verifier must check LUAuth (as SDDL), not just name/direction/action.
    const wrongSidBook = allRulesOk.map((r) => ({
      name: r.name,
      value: ruleValue(
        r.name.replace('ShipDe-Worker-ShipDeWorker-', ''),
        r.value.match(/Protocol=(\d+)/)[1],
        'TRUE',
        'Out',
        'D:(A;;CC;;;S-1-5-21-SOMEONEELSE)'
      ),
    }));
    assert.strictEqual(
      runWithRegistry(wrongSidBook, true, 'Deny'),
      'MISSING:Block-TCP-IPv4,Block-TCP-IPv6-1,Block-TCP-IPv6-2,Block-TCP-Ports,Block-UDP,Block-ICMPv4,Block-ICMPv6,Block-SSH'
    );

    // Firewall profile OFF: must fail closed.
    assert.strictEqual(runWithRegistry(allRulesOk, false, 'Deny'), 'FW_OFF');
  }
);

test('boundary verifier reads firewall rules from registry non-elevated (P5/Q3)', psSkip, () => {
  const sid = 'S-1-5-21-FAKEWORKERSID-1017';
  const script = buildBoundaryVerifyScript(sid, 'ShipDeWorker');

  // Registry-style rule value format: v2.30|Action=Block|Active=TRUE|Dir=Out|Protocol=6|...|Name=...|LUAuth=...
  const ruleValue = (name, protocolNum, active = 'TRUE', luAuth) => {
    return (
      'v2.30|Action=Block|Active=' +
      active +
      '|Dir=Out|Protocol=' +
      protocolNum +
      '|RA4=Any|RA6=Any|Edge=NO|Profile=Any|Platform=2:6:7|' +
      'Name=' +
      name +
      '|LUAuth=' +
      (luAuth || 'D:(A;;CC;;;' + sid + ')') +
      '|'
    );
  };

  const runWithRegistry = (ruleEntries, fwProfilesOn, aceType) => {
    const mockScript = boundaryTestScript(script, ruleEntries, fwProfilesOn, [
      {
        identity: sid,
        type: aceType,
        rights: 2032127,
        flags: 3,
        translatedSid: sid,
      },
    ]);
    const res = spawnSync(POWERSHELL_EXE, ['-NoProfile', '-Command', mockScript], {
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.strictEqual(res.status, 0, 'mocked registry verifier failed: ' + res.stderr);
    return (res.stdout || '').trim();
  };

  const allRulesOk = [
    {
      name: 'ShipDe-Worker-ShipDeWorker-Block-TCP-IPv4',
      value: ruleValue('ShipDe-Worker-ShipDeWorker-Block-TCP-IPv4', '6'),
    },
    {
      name: 'ShipDe-Worker-ShipDeWorker-Block-TCP-IPv6-1',
      value: ruleValue('ShipDe-Worker-ShipDeWorker-Block-TCP-IPv6-1', '6'),
    },
    {
      name: 'ShipDe-Worker-ShipDeWorker-Block-TCP-IPv6-2',
      value: ruleValue('ShipDe-Worker-ShipDeWorker-Block-TCP-IPv6-2', '6'),
    },
    {
      name: 'ShipDe-Worker-ShipDeWorker-Block-TCP-Ports',
      value: ruleValue('ShipDe-Worker-ShipDeWorker-Block-TCP-Ports', '6'),
    },
    {
      name: 'ShipDe-Worker-ShipDeWorker-Block-UDP',
      value: ruleValue('ShipDe-Worker-ShipDeWorker-Block-UDP', '17'),
    },
    {
      name: 'ShipDe-Worker-ShipDeWorker-Block-ICMPv4',
      value: ruleValue('ShipDe-Worker-ShipDeWorker-Block-ICMPv4', '1'),
    },
    {
      name: 'ShipDe-Worker-ShipDeWorker-Block-ICMPv6',
      value: ruleValue('ShipDe-Worker-ShipDeWorker-Block-ICMPv6', '58'),
    },
    {
      name: 'ShipDe-Worker-ShipDeWorker-Block-SSH',
      value: ruleValue('ShipDe-Worker-ShipDeWorker-Block-SSH', '6'),
    },
  ];

  // All rules OK + firewall on + Deny ACE: OK.
  assert.strictEqual(runWithRegistry(allRulesOk, true, 'Deny'), 'OK');

  // One rule missing: MISSING must name the absent rule.
  const partialRules = allRulesOk.filter((r) => r.name !== 'ShipDe-Worker-ShipDeWorker-Block-UDP');
  assert.strictEqual(runWithRegistry(partialRules, true, 'Deny'), 'MISSING:Block-UDP');

  // Wrong SID in LUAuth: all rules fail the LUAuth check.
  const wrongSidRules = allRulesOk.map((r) => ({
    name: r.name,
    value: ruleValue(
      r.name.replace('ShipDe-Worker-ShipDeWorker-', ''),
      r.value.match(/Protocol=(\d+)/)[1],
      'TRUE',
      'D:(A;;CC;;;S-1-5-21-WRONG)'
    ),
  }));
  assert.strictEqual(
    runWithRegistry(wrongSidRules, true, 'Deny'),
    'MISSING:Block-TCP-IPv4,Block-TCP-IPv6-1,Block-TCP-IPv6-2,Block-TCP-Ports,Block-UDP,Block-ICMPv4,Block-ICMPv6,Block-SSH'
  );

  // Rule disabled (Active=FALSE): treated as missing.
  const disabledRules = allRulesOk.map((r) => ({
    name: r.name,
    value: ruleValue(
      r.name.replace('ShipDe-Worker-ShipDeWorker-', ''),
      r.value.match(/Protocol=(\d+)/)[1],
      'FALSE'
    ),
  }));
  assert.strictEqual(
    runWithRegistry(disabledRules, true, 'Deny'),
    'MISSING:Block-TCP-IPv4,Block-TCP-IPv6-1,Block-TCP-IPv6-2,Block-TCP-Ports,Block-UDP,Block-ICMPv4,Block-ICMPv6,Block-SSH'
  );

  // Firewall profile OFF: must fail closed with FW_OFF.
  assert.strictEqual(runWithRegistry(allRulesOk, false, 'Deny'), 'FW_OFF');

  // No Deny ACE on operator profile: rejected.
  assert.ok(runWithRegistry(allRulesOk, true, 'Allow') !== 'OK');
});

test(
  'Deny ACE must match by translated SID, exact equality, type and rights (NTAccount)',
  psSkip,
  () => {
    const sid = 'S-1-5-21-FAKEWORKERSID-1017';
    const script = buildBoundaryVerifyScript(sid, 'ShipDeWorker');

    // Registry-style rule value: all eight worker rules present and healthy.
    const ruleValue = (name, protocolNum) =>
      'v2.30|Action=Block|Active=TRUE|Dir=Out|Protocol=' +
      protocolNum +
      '|RA4=Any|RA6=Any|Edge=NO|Profile=Any|Platform=2:6:7|Name=' +
      name +
      '|LUAuth=D:(A;;CC;;;' +
      sid +
      ')|';
    const allRulesOk = [
      ['Block-TCP-IPv4', '6'],
      ['Block-TCP-IPv6-1', '6'],
      ['Block-TCP-IPv6-2', '6'],
      ['Block-TCP-Ports', '6'],
      ['Block-UDP', '17'],
      ['Block-ICMPv4', '1'],
      ['Block-ICMPv6', '58'],
      ['Block-SSH', '6'],
    ].map(([n, p]) => ({
      name: 'ShipDe-Worker-ShipDeWorker-' + n,
      value: ruleValue('ShipDe-Worker-ShipDeWorker-' + n, p),
    }));

    // ACE injected by replacing Get-Acl in a test-only script variant: an
    // NTAccount value (not a SID) whose Translate() resolves to an arbitrary
    // SID the test controls. translatedSid = null simulates an untranslatable
    // account (Translate throws).
    const runWithAce = (ace, translatedSid) => {
      const mockScript = boundaryTestScript(script, allRulesOk, true, [
        {
          identity: ace.identity,
          type: ace.type,
          rights: ace.rights,
          flags: ace.flags,
          translatedSid: translatedSid,
        },
      ]);
      const res = spawnSync(POWERSHELL_EXE, ['-NoProfile', '-Command', mockScript], {
        encoding: 'utf8',
        windowsHide: true,
      });
      assert.strictEqual(res.status, 0, 'mocked ACL verifier failed: ' + res.stderr);
      return (res.stdout || '').trim();
    };

    // Deny ACE presented as an NTAccount name whose SID equals the worker SID: OK.
    assert.strictEqual(
      runWithAce(
        {
          identity: 'DESKTOP-VI13KA6\\ShipDeWorker',
          type: 'Deny',
          rights: 2032127,
          flags: 3,
        },
        sid
      ),
      'OK'
    );

    // At least Read+Write rights also count (not only FullControl).
    assert.strictEqual(
      runWithAce(
        {
          identity: 'DESKTOP-VI13KA6\\ShipDeWorker',
          type: 'Deny',
          rights: 3,
          flags: 3,
        },
        sid
      ),
      'OK'
    );

    // A different SID that merely CONTAINS the worker SID as a prefix: must NOT match.
    assert.notStrictEqual(
      runWithAce(
        {
          identity: 'DESKTOP-VI13KA6\\ShipDeWorker',
          type: 'Deny',
          rights: 2032127,
          flags: 3,
        },
        sid + '-99'
      ),
      'OK'
    );

    // Untranslatable identity (Translate throws): does NOT count as a match.
    assert.notStrictEqual(
      runWithAce(
        {
          identity: 'DESKTOP-VI13KA6\\ShipDeWorker',
          type: 'Deny',
          rights: 2032127,
          flags: 3,
        },
        null
      ),
      'OK'
    );

    // Allow ACE with a matching SID: does NOT count.
    assert.notStrictEqual(
      runWithAce(
        {
          identity: 'DESKTOP-VI13KA6\\ShipDeWorker',
          type: 'Allow',
          rights: 2032127,
          flags: 3,
        },
        sid
      ),
      'OK'
    );

    // Deny ACE without full container+object inheritance: does NOT count.
    assert.notStrictEqual(
      runWithAce(
        {
          identity: 'DESKTOP-VI13KA6\\ShipDeWorker',
          type: 'Deny',
          rights: 2032127,
          flags: 1,
        },
        sid
      ),
      'OK'
    );
  }
);
test('launcher bounds the worker wait with a timeout and kills on expiry (P6)', () => {
  const src = launcherSource();
  assert.match(src, /WaitForExit\(\$timeoutMs\)/);
  assert.match(src, /\.Kill\(\)/);
  assert.match(src, /timedOut/);
  assert.match(src, /workerTimeoutMs/);
});

test(
  'secedit deny-logon provisioning and revert match by SID with asterisk prefixes (P3)',
  psSkip,
  () => {
    const extractFn = (file, name) => {
      const src = fs.readFileSync(path.join(scriptsDir, file), 'utf8');
      const re = new RegExp('# ' + name + '-begin[^\\n]*\\r?\\n([\\s\\S]*?)# ' + name + '-end');
      const m = re.exec(src);
      assert.ok(m, name + ' extraction marker missing in ' + file);
      return m[1];
    };
    const remaining = extractFn('Remove-WorkerIsolation.ps1', 'Get-RemainingDenyRdpTokens');
    const hasToken = extractFn('New-WorkerUser.ps1', 'Test-HasDenyRdpToken');

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-secedit-'));
    const tmpPs1 = path.join(tmp, 'check.ps1');
    fs.writeFileSync(
      tmpPs1,
      [
        remaining,
        hasToken,
        "$rem = Get-RemainingDenyRdpTokens -ExistingValue '*S-1-5-21-A, ShipDeWorker,*S-1-5-21-B' -Sid 'S-1-5-21-A' -Username 'ShipDeWorker'",
        "$hasTrue = Test-HasDenyRdpToken -ExistingValue '*s-1-5-21-a,ShipDeWorker' -Sid 'S-1-5-21-A' -Username 'ShipDeWorker'",
        "$hasFalse = Test-HasDenyRdpToken -ExistingValue '*S-1-5-21-B' -Sid 'S-1-5-21-A' -Username 'ShipDeWorker'",
        "$empty = Get-RemainingDenyRdpTokens -ExistingValue 'ShipDeWorker' -Sid '' -Username 'ShipDeWorker'",
        '@{',
        '  remaining = (@($rem) -join "|")',
        '  hasTrue = [bool]$hasTrue',
        '  hasFalse = [bool]$hasFalse',
        '  emptyCount = @($empty).Count',
        '} | ConvertTo-Json',
        '',
      ].join('\n'),
      'utf8'
    );
    const res = spawnSync(
      POWERSHELL_EXE,
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tmpPs1],
      { encoding: 'utf8', windowsHide: true }
    );
    assert.strictEqual(res.status, 0, 'secedit filter script failed: ' + res.stderr);
    const out = JSON.parse(res.stdout);
    // The asterisk-prefixed worker SID is matched and removed; other SIDs survive.
    assert.strictEqual(out.remaining, '*S-1-5-21-B');
    // Re-provisioning detects an existing SID entry (case-insensitive, '*' stripped).
    assert.strictEqual(out.hasTrue, true);
    assert.strictEqual(out.hasFalse, false);
    // Removing the only entry empties the right instead of dropping the line.
    assert.strictEqual(out.emptyCount, 0);

    // Fail-closed and empty-clear statics on both scripts.
    const removeSrc = fs.readFileSync(path.join(scriptsDir, 'Remove-WorkerIsolation.ps1'), 'utf8');
    assert.match(removeSrc, /SeDenyRemoteInteractiveLogonRight = "/);
    assert.match(removeSrc, /LASTEXITCODE -ne 0/);
    const newSrc = fs.readFileSync(path.join(scriptsDir, 'New-WorkerUser.ps1'), 'utf8');
    assert.match(newSrc, /\*\$UserSid/);
    assert.match(newSrc, /LASTEXITCODE -ne 0/);

    fs.rmSync(tmp, { recursive: true, force: true });
  }
);

test('isolated launcher credentials never appear in plain env dumps', () => {
  const launcherStr = launcherSource();
  assert.ok(
    launcherStr.includes('Get-Content "${credPath}" | ConvertTo-SecureString'),
    'Uses secure string conversion from file'
  );
  assert.ok(
    !launcherStr.includes('ConvertTo-SecureString -AsPlainText'),
    'Never uses AsPlainText inside launcher'
  );
  assert.ok(launcherStr.includes('$psi.EnvironmentVariables.Clear()'), 'Env inheritance blocked');
});

test('PowerShell parser check on scripts', psSkip, () => {
  const scripts = fs.readdirSync(scriptsDir).filter((f) => f.endsWith('.ps1'));

  for (const script of scripts) {
    const fullPath = path.join(scriptsDir, script);
    const res = spawnSync(
      POWERSHELL_EXE,
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `
      $err = $null
      $ast = [System.Management.Automation.Language.Parser]::ParseFile("${fullPath}", [ref]$null, [ref]$err)
      if ($err.Count -gt 0) { exit 1 } else { exit 0 }
    `,
      ],
      { encoding: 'utf8', windowsHide: true }
    );

    assert.strictEqual(
      res.status,
      0,
      `${script} should pass PowerShell parser. Errors: ${res.stderr}`
    );
  }
});

test('PowerShell WhatIf runs without changes', whatIfSkip, () => {
  const scripts = fs.readdirSync(scriptsDir).filter((f) => f.endsWith('.ps1'));

  for (const script of scripts) {
    const fullPath = path.join(scriptsDir, script);

    // F11: State snapshot before
    const usersBefore = spawnSync(POWERSHELL_EXE, ['-c', '(Get-LocalUser).Name'], {
      encoding: 'utf8',
      windowsHide: true,
    }).stdout;
    const rulesBefore = spawnSync(POWERSHELL_EXE, ['-c', '(Get-NetFirewallRule).Name'], {
      encoding: 'utf8',
      windowsHide: true,
    }).stdout;

    const res = spawnSync(
      POWERSHELL_EXE,
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', fullPath, '-WhatIf'],
      { encoding: 'utf8', windowsHide: true }
    );

    assert.strictEqual(res.status, 0, `${script} -WhatIf should exit 0. Errors: ${res.stderr}`);

    // F11: State snapshot after
    const usersAfter = spawnSync(POWERSHELL_EXE, ['-c', '(Get-LocalUser).Name'], {
      encoding: 'utf8',
      windowsHide: true,
    }).stdout;
    const rulesAfter = spawnSync(POWERSHELL_EXE, ['-c', '(Get-NetFirewallRule).Name'], {
      encoding: 'utf8',
      windowsHide: true,
    }).stdout;

    assert.strictEqual(usersBefore, usersAfter, `User state changed after -WhatIf for ${script}`);
    assert.strictEqual(
      rulesBefore,
      rulesAfter,
      `Firewall state changed after -WhatIf for ${script}`
    );
  }
});

test(
  'deny-RDP secedit ensure runs on every invocation, outside the user-existence branches (Q1)',
  psSkip,
  () => {
    const file = path.join(scriptsDir, 'New-WorkerUser.ps1');
    const newSrc = fs.readFileSync(file, 'utf8');

    // Static: the ensure is guarded by $UserSid (resolved in BOTH the
    // existing-user and the creation branch), not by user creation.
    assert.match(newSrc, /if \(\$UserSid\)/);

    // Structural, via the PowerShell AST: every secedit call must be OUTSIDE
    // the `if ($User)` user-existence statement. If the ensure were nested in
    // the creation branch (the Q1 bug), the secedit calls would have the
    // `if ($User)` statement among their ancestors.
    const res = spawnSync(
      POWERSHELL_EXE,
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `
      $errs = $null
      $ast = [System.Management.Automation.Language.Parser]::ParseFile("${file}", [ref]$null, [ref]$errs)
      if ($errs.Count -gt 0) { $errs | ForEach-Object { Write-Error $_.Message }; exit 1 }
      $seceditCalls = $ast.FindAll({ param($a) $a -is [System.Management.Automation.Language.CommandAst] -and $a.GetCommandName() -eq 'secedit' }, $true)
      $anyInsideUserBranch = $false
      foreach ($cmd in $seceditCalls) {
        $parent = $cmd.Parent
        while ($parent) {
          if ($parent -is [System.Management.Automation.Language.IfStatementAst]) {
            $cond = $parent.Clauses[0].Item1.Extent.Text
            if ($cond -eq '$User') { $anyInsideUserBranch = $true }
          }
          $parent = $parent.Parent
        }
      }
      @{ count = $seceditCalls.Count; anyInsideUserBranch = [bool]$anyInsideUserBranch } | ConvertTo-Json
      `,
      ],
      { encoding: 'utf8', windowsHide: true }
    );
    assert.strictEqual(res.status, 0, 'AST check failed: ' + res.stderr);
    const out = JSON.parse(res.stdout);
    // secedit /export and secedit /configure both live in the hoisted block.
    assert.strictEqual(out.count, 2);
    // Neither is nested inside `if ($User)` — the ensure covers re-provisioning.
    assert.strictEqual(out.anyInsideUserBranch, false);
  }
);

test(
  'Get-UpdatedDenyRdpValue appends without a leading comma on an empty exported right (Q2)',
  psSkip,
  () => {
    const extractFn = (name) => {
      const src = fs.readFileSync(path.join(scriptsDir, 'New-WorkerUser.ps1'), 'utf8');
      const re = new RegExp('# ' + name + '-begin[^\\n]*\\r?\\n([\\s\\S]*?)# ' + name + '-end');
      const m = re.exec(src);
      assert.ok(m, name + ' extraction marker missing in New-WorkerUser.ps1');
      return m[1];
    };

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-q2-'));
    const tmpPs1 = path.join(tmp, 'check.ps1');
    fs.writeFileSync(
      tmpPs1,
      [
        extractFn('Test-HasDenyRdpToken'),
        extractFn('Get-UpdatedDenyRdpValue'),
        "$empty = Get-UpdatedDenyRdpValue -ExistingValue '' -Sid 'S-1-5-21-W' -Username 'ShipDeWorker'",
        "$nonEmpty = Get-UpdatedDenyRdpValue -ExistingValue '*S-1-5-21-A' -Sid 'S-1-5-21-W' -Username 'ShipDeWorker'",
        "$present = Get-UpdatedDenyRdpValue -ExistingValue '*S-1-5-21-W' -Sid 'S-1-5-21-W' -Username 'ShipDeWorker'",
        "$presentByName = Get-UpdatedDenyRdpValue -ExistingValue 'ShipDeWorker' -Sid 'S-1-5-21-W' -Username 'ShipDeWorker'",
        '@{',
        '  empty = [string]$empty',
        '  nonEmpty = [string]$nonEmpty',
        '  present = ($null -eq $present)',
        '  presentByName = ($null -eq $presentByName)',
        '} | ConvertTo-Json',
        '',
      ].join('\n'),
      'utf8'
    );
    const res = spawnSync(
      POWERSHELL_EXE,
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tmpPs1],
      { encoding: 'utf8', windowsHide: true }
    );
    assert.strictEqual(res.status, 0, 'Q2 check script failed: ' + res.stderr);
    const out = JSON.parse(res.stdout);
    // Empty exported right: appended as '*SID' with NO leading comma.
    assert.strictEqual(out.empty, '*S-1-5-21-W');
    assert.ok(!out.empty.startsWith(','), 'no leading comma on empty exported right');
    // Non-empty exported right: appended after the existing value.
    assert.strictEqual(out.nonEmpty, '*S-1-5-21-A,*S-1-5-21-W');
    // Idempotency: already-present token (by SID or name) returns null so the
    // caller skips secedit /configure entirely.
    assert.strictEqual(out.present, true);
    assert.strictEqual(out.presentByName, true);

    fs.rmSync(tmp, { recursive: true, force: true });
  }
);

test('publisher object transfer never executes a hostile uploadpack.packObjectsHook planted in the worker tree (Q4)', () => {
  const repo = makeTempRepo();
  const marker = path.join(
    os.tmpdir(),
    'shipde-q4-marker-' + Date.now() + '-' + process.pid + '.txt'
  );
  const g = (args) =>
    spawnSync('git', args, { cwd: repo.dir, encoding: 'utf8', windowsHide: true });

  // The worker-writable tree plants a hostile upload-pack hook and enables
  // filter negotiation in its own .git/config.
  g(['config', 'uploadpack.packObjectsHook', 'touch ' + marker]);
  g(['config', 'uploadpack.allowFilter', 'true']);
  g(['config', 'uploadpackfilter.blob.allow', 'true']);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-q4-'));
  const cleanDir = path.join(tmp, 'clean.git');
  fs.mkdirSync(cleanDir);
  const initRes = spawnSync('git', ['init', '-q', '--bare', cleanDir], {
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.strictEqual(initRes.status, 0, 'clean clone init failed: ' + initRes.stderr);

  // The production transfer path: mirror the worker tree with a LOCAL clone
  // (no upload-pack), sanitize the mirror's config, then fetch from the
  // mirror. upload-pack never reads the worker-writable config.
  transferReviewedObjects(repo.dir, repo.sha, cleanDir, tmp);

  // The reviewed objects arrived intact.
  const shaRes = spawnSync('git', ['rev-parse', 'refs/heads/temp-push'], {
    cwd: cleanDir,
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.strictEqual(shaRes.status, 0, 'temp-push missing in clean clone');
  assert.strictEqual(shaRes.stdout.trim(), repo.sha);

  // The hostile hook never executed.
  assert.strictEqual(fs.existsSync(marker), false, 'hostile packObjectsHook was executed');

  // The mirror's config carries no uploadpack keys at all.
  const mirrorCfg = fs.readFileSync(path.join(tmp, 'source-mirror', 'config'), 'utf8');
  assert.strictEqual(mirrorCfg, SAFE_MIRROR_CONFIG);
  assert.ok(!/uploadpack/i.test(mirrorCfg), 'mirror config must not carry uploadpack keys');

  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(repo.dir, { recursive: true, force: true });
});

test('launcher clones the worker root without hardlinks so the worker cannot mutate operator objects (Q5)', () => {
  const launcherSrc = getIsolatedLauncher().toString();
  // The flag is asserted on the production launcher.
  assert.match(
    launcherSrc,
    /'clone', '--no-checkout', '--no-hardlinks'/,
    'the launcher must clone with --no-hardlinks'
  );

  // Behavioral: a clone with the launcher's exact flags shares no inodes
  // with the source repo, while a plain local clone does (contrast proof).
  const src = makeTempRepo();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-q5-'));
  const dstNoHl = path.join(tmp, 'dst-no-hardlinks');
  const dstHl = path.join(tmp, 'dst-hardlinks');

  const cloneRes = spawnSync(
    'git',
    ['clone', '--no-checkout', '--no-hardlinks', src.dir, dstNoHl],
    { encoding: 'utf8', windowsHide: true }
  );
  assert.strictEqual(cloneRes.status, 0, 'no-hardlinks clone failed: ' + cloneRes.stderr);

  const looseNlinks = (dir) => {
    const nlinks = [];
    const walk = (d) => {
      for (const f of fs.readdirSync(d)) {
        const p = path.join(d, f);
        if (fs.statSync(p).isDirectory()) walk(p);
        else if (f.length === 38) nlinks.push(fs.statSync(p).nlink); // loose object file
      }
    };
    walk(dir);
    return nlinks;
  };

  const dstObjects = looseNlinks(path.join(dstNoHl, '.git', 'objects'));
  assert.ok(dstObjects.length > 0, 'expected loose object files in the clone');
  for (const n of dstObjects) {
    assert.strictEqual(n, 1, 'cloned object file must not share an inode with the operator repo');
  }

  // Contrast: without --no-hardlinks the clone DOES share inodes with the
  // source — proving the flag is what breaks the sharing.
  const plainCloneRes = spawnSync('git', ['clone', '--no-checkout', src.dir, dstHl], {
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.strictEqual(plainCloneRes.status, 0, 'plain clone failed: ' + plainCloneRes.stderr);
  const plainNlinks = looseNlinks(path.join(dstHl, '.git', 'objects'));
  assert.ok(
    plainNlinks.some((n) => n > 1),
    'plain local clone is expected to hardlink (contrast proof for the flag)'
  );

  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(src.dir, { recursive: true, force: true });
});

test('launcher writes and reads the launch result outside the worker-writable root (Q6)', () => {
  const launcherStr = launcherSource();
  // The result file is no longer written into workerRoot...
  assert.ok(
    !launcherStr.includes('workerRoot}\\launch-result.json'),
    'launch result must not be written into workerRoot'
  );
  assert.ok(
    !launcherStr.includes("path.join(workerRoot, 'launch-result.json')"),
    'launch result must not be read from workerRoot'
  );
  // ...but into a host-owned operator directory outside workerRoot.
  assert.ok(
    launcherStr.includes('launch-results'),
    'launch result directory must be host-owned (LOCALAPPDATA ShipDe launch-results)'
  );
  assert.match(launcherStr, /Out-File "\$\{launchResultPath\}"/);
  assert.match(launcherStr, /existsSync\(launchResultPath\)/);
});

test('Test-WorkerIsolation guards GetOwner call with fail-closed existence re-check (race condition fix)', () => {
  const script = fs.readFileSync(path.join(scriptsDir, 'Test-WorkerIsolation.ps1'), 'utf8');

  // The GetOwner call must be inside a try/catch to handle processes that exit
  // between enumeration and the GetOwner invocation (HRESULT 0x80041002).
  assert.ok(
    script.includes('Invoke-CimMethod') && script.includes('GetOwner'),
    'script must call Invoke-CimMethod GetOwner'
  );

  // Static: the GetOwner call is wrapped with -ErrorAction Stop and caught
  assert.match(
    script,
    /Invoke-CimMethod\s+-InputObject\s+\$proc\s+-MethodName\s+GetOwner\s+-ErrorAction\s+Stop/,
    'GetOwner must use -ErrorAction Stop for catchable exception'
  );

  // Static: the catch block re-checks existence with Get-Process
  assert.ok(
    script.includes('Get-Process -Id $proc.ProcessId -ErrorAction SilentlyContinue'),
    'catch block must re-check process existence with Get-Process'
  );

  // Static: the catch block checks if the process still exists ($null -eq $stillExists or similar)
  assert.ok(
    script.match(/\$null\s*-eq\s+\$stillExists/) || script.match(/\$stillExists\s*-eq\s+\$null/),
    'catch block must check if Get-Process returned null (process vanished)'
  );

  // Static: a vanished process is skipped (continue)
  assert.ok(
    script.match(/if\s*\(\s*\$null\s*-eq\s+\$stillExists\s*\)\s*\{[^}]*continue[^}]*\}/s) ||
      script.match(/if\s*\(\s*\$stillExists\s*-eq\s+\$null\s*\)\s*\{[^}]*continue[^}]*\}/s),
    'vanished process must be skipped with continue'
  );

  // Static: a live process with unknown owner is treated as possible worker (added to $lingering)
  assert.ok(
    script.match(/\}\s*else\s*\{[^}]*\$lingering\s*\+=\s*\$proc[^}]*\}/s) ||
      script.match(/\}\s*else\s*\{[^}]*\$lingering\s*\+=\s+\$proc[^}]*\}/s),
    'live process with unknown owner must be added to $lingering (fail-closed)'
  );

  // Static: the script logs when a live process has unknown owner
  assert.ok(
    script.includes('Unknown owner') && script.includes('treating as possible worker'),
    'must log when treating unknown-owner live process as possible worker'
  );

  // Static: the script does NOT use the vulnerable pattern of piping directly
  // to Where-Object with GetOwner (the original race condition)
  assert.ok(
    !script.match(
      /Get-CimInstance\s+Win32_Process\s*\|\s*Where-Object\s*\{[^}]*Invoke-CimMethod[^}]*\}/
    ),
    'must not use vulnerable pipe pattern that races on process exit'
  );

  // Static: enumeration failure sets verdict to PARTIAL (fail-closed)
  // Assert the actual wiring: the catch of the enumeration sets $enumerationFailed,
  // and that flag leads to $Verdict = "PARTIAL" in the block right after
  assert.match(
    script,
    /\$enumerationFailed\s*=\s*\$true[\s\S]*?if\s*\(\s*\$enumerationFailed\s*\)\s*\{\s*\$Verdict\s*=\s*"PARTIAL"\s*\}/,
    'enumerationFailed must be set to $true and then checked to set $Verdict = "PARTIAL"'
  );
  // Static: "CLOSED" must never be assigned after the lingering block
  const lingeringBlockIdx = script.indexOf('if ($lingering)');
  const closedAfterLingering = script.indexOf('$Verdict = "CLOSED"', lingeringBlockIdx);
  assert.strictEqual(
    closedAfterLingering,
    -1,
    'CLOSED must never be assigned after the lingering process check'
  );

  // F2: PID 0 and 4 exclusion - verify exactly those two PIDs are excluded
  assert.match(script, /\bProcessId\s*-eq\s*0\b/, 'must exclude PID 0 (System Idle Process)');
  assert.match(script, /\bProcessId\s*-eq\s*4\b/, 'must exclude PID 4 (System)');
  // Verify the exclusion comment mentions kernel pseudo-processes
  assert.ok(
    script.includes('kernel pseudo-processes') ||
      (script.includes('PID 0') && script.includes('PID 4')),
    'must have a comment explaining why PID 0 and 4 are excluded'
  );

  // F3: $results must be initialized before use so missing result file cannot throw
  // before the verdict JSON is written
  assert.match(
    script,
    /\$results\s*=\s*\$null\s*\r?\n\s*if\s*\(Test-Path\s+\$TestResultPath\)/,
    '$results must be initialized to $null before the Test-Path check'
  );
  // Verify $results is referenced in $Output (line ~277)
  assert.ok(
    script.includes('$Output') && script.includes('details = $results'),
    '$results must be referenced in the $Output hashtable'
  );
});

// The exact PowerShell a real launch writes, generated without provisioning a
// worker, cloning anything or starting a process. The values are inert: this
// text is only ever parsed, never executed as a launch.
const LAUNCH_SCRIPT = buildWorkerLaunchScript({
  credPath: 'C:\\Users\\operator\\AppData\\Local\\ShipDe\\WorkerUser.cred',
  workerRoot: 'C:\\ShipDeWorker\\probe',
  workerUsername: 'ShipDeWorker',
  exeFile: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
  psArgs: "'-NoProfile', '-NonInteractive', '-EncodedCommand', 'QUJDRA=='",
  launchResultPath: 'C:\\Users\\operator\\AppData\\Local\\ShipDe\\launch-results\\probe-0.json',
  workerTimeoutMs: 600000,
});

// ProcessStartInfo flags that must be set from the boolean variables. A
// backtick-escaped `$false` is the string "$false": PowerShell parses it, then
// tries to run it as a command, and $ErrorActionPreference = "Stop" turns that
// into a terminating error which kills the host script before
// [System.Diagnostics.Process]::Start($psi) — the worker never starts.
const BOOLEAN_PSI_FLAGS = {
  UseShellExecute: 'false',
  CreateNoWindow: 'true',
  RedirectStandardOutput: 'true',
  RedirectStandardError: 'true',
};

// A backtick-escaped `$` is legitimate only INSIDE the double-quoted
// here-string that builds run-target.ps1, where it emits a literal
// `$env:HOME`. This split keeps here-string bodies and everything else apart so
// the escaping contract can be asserted on both sides.
function splitHereStrings(script) {
  const inside = [];
  const outside = [];
  let inHereString = false;
  let opened = 0;
  for (const line of script.split('\n')) {
    const trimmed = line.trim();
    if (!inHereString) {
      if (trimmed.startsWith('@"')) {
        inHereString = true;
        opened += 1;
      }
      outside.push(line);
      continue;
    }
    inside.push(line);
    if (trimmed.startsWith('"@')) inHereString = false;
  }
  assert.strictEqual(inHereString, false, 'unterminated here-string in the generated script');
  return { inside: inside.join('\n'), outside: outside.join('\n'), opened };
}

test('generated launch script has no backtick-escaped $ outside a here-string', () => {
  const { inside, outside, opened } = splitHereStrings(LAUNCH_SCRIPT);

  // Anti-vacuity: the split must find the here-string, and its escapes must
  // still be there — they are the correct ones.
  assert.ok(opened >= 1, 'expected at least one here-string in the generated script');
  assert.match(
    inside,
    /`\$env:HOME = "C:\\ShipDeWorker\\probe"/,
    'escaped $env:HOME must survive inside the here-string'
  );

  const offenders = outside.split('\n').filter((line) => line.indexOf('`$') !== -1);
  assert.deepStrictEqual(
    offenders,
    [],
    'no line outside a here-string may contain a backtick-escaped $: ' + offenders.join(' | ')
  );

  for (const [prop, variable] of Object.entries(BOOLEAN_PSI_FLAGS)) {
    assert.match(
      LAUNCH_SCRIPT,
      new RegExp('^\\$psi\\.' + prop + ' = \\$' + variable + '$', 'm'),
      '$psi.' + prop + ' must be assigned the boolean variable $' + variable
    );
  }
});

test(
  'generated launch script parses clean and its ProcessStartInfo flags are booleans, not strings',
  psSkip,
  () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-launch-script-'));
    const scriptPath = path.join(tmp, 'isolated-launch.ps1');
    fs.writeFileSync(scriptPath, LAUNCH_SCRIPT, 'utf8');

    // Parses the generated script with the PowerShell AST parser and reports,
    // per ProcessStartInfo flag, the node the right-hand side parses to and what
    // that text evaluates to. Only the four boolean literals are ever
    // evaluated, so no statement of the generated script can run.
    const probePath = path.join(tmp, 'parse-probe.ps1');
    fs.writeFileSync(
      probePath,
      [
        'param([Parameter(Mandatory = $true)][string]$Path)',
        '$ErrorActionPreference = "Stop"',
        '$text = Get-Content -LiteralPath $Path -Raw',
        '$errors = $null',
        '$ast = [System.Management.Automation.Language.Parser]::ParseInput($text, [ref]$null, [ref]$errors)',
        '$assignments = @{}',
        'foreach ($t in @("' + Object.keys(BOOLEAN_PSI_FLAGS).join('", "') + '")) {',
        '  $assignments[$t] = @{ count = 0; right = ""; nodeType = ""; variable = $null; evaluated = "" }',
        '}',
        '$ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.AssignmentStatementAst] }, $true) | ForEach-Object {',
        '  $left = $_.Left.Extent.Text',
        '  foreach ($t in $assignments.Keys) {',
        "    if ($left -ne ('$psi.' + $t)) { continue }",
        '    $node = $_.Right',
        '    while ($node -is [System.Management.Automation.Language.CommandExpressionAst]) { $node = $node.Expression }',
        '    $variable = $null',
        '    if ($node -is [System.Management.Automation.Language.VariableExpressionAst]) { $variable = $node.VariablePath.UserPath }',
        '    $rhs = $_.Right.Extent.Text',
        '    $evaluated = "NOT_EVALUATED"',
        "    if (@('$false', '$true', '`$false', '`$true') -contains $rhs) {",
        '      try { $evaluated = (Invoke-Expression $rhs).GetType().FullName } catch { $evaluated = "ERROR:" + $_.Exception.GetType().Name }',
        '    }',
        '    $slot = $assignments[$t]',
        '    $slot.count = $slot.count + 1',
        '    if ($slot.count -eq 1) {',
        '      $slot.right = $rhs',
        '      $slot.nodeType = $node.GetType().Name',
        '      $slot.variable = $variable',
        '      $slot.evaluated = $evaluated',
        '    }',
        '  }',
        '}',
        '@{ parseErrors = @($errors | ForEach-Object { $_.Message }); assignments = $assignments } | ConvertTo-Json -Depth 6',
        '',
      ].join('\n'),
      'utf8'
    );

    const res = spawnSync(
      POWERSHELL_EXE,
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', probePath, '-Path', scriptPath],
      { encoding: 'utf8', windowsHide: true }
    );
    assert.strictEqual(res.status, 0, 'parse probe failed: ' + res.stderr + res.stdout);
    const report = JSON.parse(res.stdout);

    assert.deepStrictEqual(
      report.parseErrors,
      [],
      'the generated launch script must parse without errors'
    );

    for (const [prop, variable] of Object.entries(BOOLEAN_PSI_FLAGS)) {
      const flag = report.assignments[prop];
      assert.ok(flag, '$psi.' + prop + ' must be assigned in the generated script');
      assert.strictEqual(flag.count, 1, '$psi.' + prop + ' must be assigned exactly once');
      assert.strictEqual(
        flag.right,
        '$' + variable,
        '$psi.' +
          prop +
          ' must be assigned the bare variable $' +
          variable +
          ', not "' +
          flag.right +
          '"'
      );
      assert.strictEqual(
        flag.variable,
        variable,
        '$psi.' + prop + ' must parse to the $' + variable + ' variable, not ' + flag.nodeType
      );
      assert.strictEqual(
        flag.evaluated,
        'System.Boolean',
        '$psi.' + prop + ' right-hand side must be a Boolean, got ' + flag.evaluated
      );
    }

    fs.rmSync(tmp, { recursive: true, force: true });
  }
);
