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
  EXPECTED_FIREWALL_RULES,
} = require('../isolation-launcher');

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
  assert.ok(src.includes('Get-NetFirewallRule'), 'checks worker firewall rules');
  assert.ok(src.includes('Get-Acl'), 'checks operator profile ACL');
  assert.ok(src.includes('Deny'), 'requires the Deny ACE');
  assert.ok(src.includes('ShipDe-Worker-'), 'scoped to the worker rule prefix');
  // Q3: every deterministically-created rule is verified by exact name, with
  // direction, action and protocol; the gate is "nothing missing", never
  // "at least one rule exists".
  for (const rule of EXPECTED_FIREWALL_RULES) {
    assert.ok(src.includes(rule.suffix), 'must verify rule ' + rule.suffix);
    assert.ok(src.includes("'" + rule.protocol + "'"), 'must check protocol ' + rule.protocol);
  }
  assert.ok(src.includes("$r.Direction -ne 'Outbound'"), 'each rule must be Outbound');
  assert.ok(src.includes("$r.Action -ne 'Block'"), 'each rule must be Block');
  assert.ok(src.includes('Get-NetFirewallSecurityFilter'), 'checks rule LocalUser SDDL scope');
  assert.ok(src.includes('D:(A;;CC;;;'), 'must compare against the worker SDDL string');
  assert.ok(!src.includes('$rules.Count -ge 1'), 'a partial rule set must not verify');
  assert.ok(src.includes('$missing.Count -eq 0'), 'the gate must be zero missing rules');
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

    const fullBook = {
      'ShipDe-Worker-ShipDeWorker-Block-TCP-IPv4': {
        Direction: 'Outbound',
        Action: 'Block',
        Protocol: 'TCP',
      },
      'ShipDe-Worker-ShipDeWorker-Block-TCP-IPv6-1': {
        Direction: 'Outbound',
        Action: 'Block',
        Protocol: 'TCP',
      },
      'ShipDe-Worker-ShipDeWorker-Block-TCP-IPv6-2': {
        Direction: 'Outbound',
        Action: 'Block',
        Protocol: 'TCP',
      },
      'ShipDe-Worker-ShipDeWorker-Block-TCP-Ports': {
        Direction: 'Outbound',
        Action: 'Block',
        Protocol: 'TCP',
      },
      'ShipDe-Worker-ShipDeWorker-Block-UDP': {
        Direction: 'Outbound',
        Action: 'Block',
        Protocol: 'UDP',
      },
      'ShipDe-Worker-ShipDeWorker-Block-ICMPv4': {
        Direction: 'Outbound',
        Action: 'Block',
        Protocol: 'ICMPv4',
      },
      'ShipDe-Worker-ShipDeWorker-Block-ICMPv6': {
        Direction: 'Outbound',
        Action: 'Block',
        Protocol: 'ICMPv6',
      },
      'ShipDe-Worker-ShipDeWorker-Block-SSH': {
        Direction: 'Outbound',
        Action: 'Block',
        Protocol: 'TCP',
      },
    };

    const runWith = (ruleBook, aceType, sddl) => {
      const entries = Object.keys(ruleBook)
        .map(
          (name) =>
            "'" +
            name +
            "' = @{ Direction = '" +
            ruleBook[name].Direction +
            "'; Action = '" +
            ruleBook[name].Action +
            "'; Protocol = '" +
            ruleBook[name].Protocol +
            "' }"
        )
        .join('; ');
      const mockScript =
        '$ruleBook = @{ ' +
        entries +
        ' }\n' +
        'function Get-NetFirewallRule {\n' +
        '  param([string]$DisplayName, $ErrorAction)\n' +
        '  if ($ruleBook.ContainsKey($DisplayName)) {\n' +
        '    [pscustomobject]@{ DisplayName = $DisplayName; Direction = $ruleBook[$DisplayName].Direction; Action = $ruleBook[$DisplayName].Action; Protocol = $ruleBook[$DisplayName].Protocol }\n' +
        '  }\n' +
        '}\n' +
        'function Get-NetFirewallPortFilter { process { [pscustomobject]@{ Protocol = $_.Protocol } } }\n' +
        // Get-NetFirewallSecurityFilter reports LocalUser as the SDDL string
        // the rule was created with (Set-WorkerFirewall.ps1 -LocalUser).
        "function Get-NetFirewallSecurityFilter { process { [pscustomobject]@{ LocalUser = '" +
        (sddl === undefined ? 'D:(A;;CC;;;' + sid + ')' : sddl) +
        "' } } }\n" +
        "function Get-Acl { param($path) [pscustomobject]@{ Access = @([pscustomobject]@{ IdentityReference = [pscustomobject]@{ Value = '" +
        sid +
        "' }; AccessControlType = '" +
        aceType +
        "' }) } }\n" +
        script;
      const res = spawnSync(POWERSHELL_EXE, ['-NoProfile', '-Command', mockScript], {
        encoding: 'utf8',
        windowsHide: true,
      });
      assert.strictEqual(res.status, 0, 'mocked verifier failed: ' + res.stderr);
      return (res.stdout || '').trim();
    };

    // Full deterministic rule set + Deny ACE: OK.
    assert.strictEqual(runWith(fullBook, 'Deny'), 'OK');

    // Partial set (Block-UDP removed): MISSING must name the absent rule.
    const partialBook = Object.assign({}, fullBook);
    delete partialBook['ShipDe-Worker-ShipDeWorker-Block-UDP'];
    assert.strictEqual(runWith(partialBook, 'Deny'), 'MISSING:Block-UDP');

    // All rules present but one has the wrong direction: still rejected.
    const inboundBook = Object.assign({}, fullBook, {
      'ShipDe-Worker-ShipDeWorker-Block-TCP-IPv4': {
        Direction: 'Inbound',
        Action: 'Block',
        Protocol: 'TCP',
      },
    });
    assert.strictEqual(runWith(inboundBook, 'Deny'), 'MISSING:Block-TCP-IPv4');

    // All rules present but one has the wrong protocol: still rejected.
    const protoBook = Object.assign({}, fullBook, {
      'ShipDe-Worker-ShipDeWorker-Block-UDP': {
        Direction: 'Outbound',
        Action: 'Block',
        Protocol: 'TCP',
      },
    });
    assert.strictEqual(runWith(protoBook, 'Deny'), 'MISSING:Block-UDP');

    // Full rule set but no Deny ACE on the operator profile: rejected.
    assert.ok(runWith(fullBook, 'Allow') !== 'OK');

    // Full rule set but rules scoped to another user's SDDL: rejected. The
    // verifier must check LocalUser (as SDDL), not just name/direction/action.
    assert.strictEqual(
      runWith(fullBook, 'Deny', 'D:(A;;CC;;;S-1-5-21-SOMEONEELSE)'),
      'MISSING:Block-TCP-IPv4,Block-TCP-IPv6-1,Block-TCP-IPv6-2,Block-TCP-Ports,Block-UDP,Block-ICMPv4,Block-ICMPv6,Block-SSH'
    );
  }
);

test('launcher bounds the worker wait with a timeout and kills on expiry (P6)', () => {
  const src = getIsolatedLauncher().toString();
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
  const launcherStr = getIsolatedLauncher().toString();
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
  const launcherStr = getIsolatedLauncher().toString();
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
  assert.ok(
    script.includes('$enumerationFailed') && script.includes('$Verdict = "PARTIAL"'),
    'enumeration failure must set verdict to PARTIAL'
  );
});
