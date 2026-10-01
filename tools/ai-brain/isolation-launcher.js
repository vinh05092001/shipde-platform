'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { executableFor } = require('./harness');
const crypto = require('crypto');

const WORKER_USERNAME = 'ShipDeWorker';
// The worker root, defined once. Every component that has to know whether a
// path is inside the worker boundary (the launcher that provisions it, the
// publisher that must never run there, the approval registry that must stay
// operator-side) reads this one definition instead of restating the path.
const WORKER_ROOT = 'C:\\ShipDeWorker';
const DEFAULT_WORKER_TIMEOUT_MS = 30 * 60 * 1000;

/** The worker root for one job: the worker never sees the operator's leaf name. */
function workerRootFor(hostCwd) {
  const jobName = path.basename(String(hostCwd || '')) || 'default';
  if (
    jobName === '.' ||
    jobName === '..' ||
    jobName.includes('/') ||
    jobName.includes('\\') ||
    jobName.includes('*') ||
    jobName.includes('?')
  ) {
    throw new Error('Invalid job name in workerRootFor');
  }
  return path.win32.join(WORKER_ROOT, jobName);
}

/**
 * True when `target` is the worker root or anything under it.
 *
 * Compared as Windows paths on every host, so the answer does not change with
 * the platform the Controller happens to run on. A refusal must be a refusal
 * everywhere, not only where the worker exists.
 */
function isWorkerPath(target) {
  if (!target) return false;
  const root = path.win32.normalize(path.win32.resolve(WORKER_ROOT));
  const full = path.win32.normalize(path.win32.resolve(String(target)));
  if (full.toLowerCase() === root.toLowerCase()) return true;
  const rel = path.win32.relative(root, full);
  return rel !== '' && !rel.startsWith('..') && !path.win32.isAbsolute(rel);
}

function getFolderHash(folder) {
  const files = [];
  function readDir(dir) {
    if (!fs.existsSync(dir)) return;
    const items = fs.readdirSync(dir);
    for (const item of items) {
      const fullPath = path.join(dir, item);
      if (fs.statSync(fullPath).isDirectory()) {
        readDir(fullPath);
      } else {
        files.push(fullPath);
      }
    }
  }
  readDir(folder);
  const fileHashes = [];
  for (const file of files) {
    const hash = crypto.createHash('sha256');
    hash.update(fs.readFileSync(file));
    fileHashes.push(hash.digest('hex'));
  }
  fileHashes.sort();
  const finalHash = crypto.createHash('sha256');
  finalHash.update(fileHashes.join(''), 'utf8');
  return finalHash.digest('hex');
}

function queryWorkerSid() {
  const sidRes = cp.spawnSync(
    'powershell',
    ['-NoProfile', '-Command', `(Get-LocalUser -Name ${WORKER_USERNAME}).SID.Value`],
    { encoding: 'utf8', windowsHide: true }
  );
  return (sidRes.stdout || '').trim();
}

/**
 * Q3: every firewall rule Set-WorkerFirewall.ps1 deterministically creates
 * must still be present (by exact name) with Direction Outbound and Action
 * Block, and the expected protocol. A partially deleted rule set (e.g. only
 * one ShipDe rule left standing) must NOT verify as OK — hence the gate is
 * "$missing.Count -eq 0", never "some rule exists". Block-GitHub-IPs is
 * intentionally absent: its creation depends on live DNS resolution.
 */
const EXPECTED_FIREWALL_RULES = [
  { suffix: 'Block-TCP-IPv4', protocol: 'TCP' },
  { suffix: 'Block-TCP-IPv6-1', protocol: 'TCP' },
  { suffix: 'Block-TCP-IPv6-2', protocol: 'TCP' },
  { suffix: 'Block-TCP-Ports', protocol: 'TCP' },
  { suffix: 'Block-UDP', protocol: 'UDP' },
  { suffix: 'Block-ICMPv4', protocol: 'ICMPv4' },
  { suffix: 'Block-ICMPv6', protocol: 'ICMPv6' },
  { suffix: 'Block-SSH', protocol: 'TCP' },
];

function buildBoundaryVerifyScript(sid, username, expectedRules) {
  const safeSid = String(sid || '').replace(/'/g, "''");
  const safeUsername = String(username || '').replace(/'/g, "''");
  const rules = expectedRules || EXPECTED_FIREWALL_RULES;
  const expectedList = rules
    .map((r) => "@{ n = '" + r.suffix + "'; p = '" + r.protocol + "' }")
    .join(', ');
  // P5/Q3: read firewall rules from registry (non-elevated) instead of CIM.
  // Registry values contain LUAuth=SDDL which CIM requires elevation to read.
  // Firewall profiles must be enabled; fail closed if any profile has EnableFirewall=0.
  return (
    "$fwRulesPath = 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\SharedAccess\\Parameters\\FirewallPolicy\\FirewallRules'; " +
    "$profilePath = 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\SharedAccess\\Parameters\\FirewallPolicy'; " +
    "$profiles = @('DomainProfile', 'StandardProfile', 'PublicProfile'); " +
    '$fwOn = $true; ' +
    'foreach ($p in $profiles) { ' +
    '  $val = Get-ItemProperty -Path "$profilePath\\$p" -Name EnableFirewall -ErrorAction SilentlyContinue; ' +
    '  if (-not $val -or $val.EnableFirewall -ne 1) { $fwOn = $false; break; } ' +
    '}; ' +
    "if (-not $fwOn) { 'FW_OFF' } else { " +
    "$prefix = 'ShipDe-Worker-" +
    safeUsername +
    "'; " +
    '$expected = @(' +
    expectedList +
    '); ' +
    '$missing = @(); ' +
    'if (Test-Path $fwRulesPath) { ' +
    '$raw = @(); try { $raw = Get-Item -Path $fwRulesPath -ErrorAction Stop | Get-ItemProperty -ErrorAction Stop } catch {}; ' +
    'foreach ($e in $expected) { ' +
    '$ruleName = $prefix + "-" + $e.n; ' +
    '$found = $false; ' +
    'foreach ($propName in $raw.PSObject.Properties.Name) { ' +
    '$val = [string]$raw.$propName; ' +
    'if ([string]::IsNullOrEmpty($val)) { continue }; ' +
    '$fields = @{}; ' +
    'foreach ($part in ($val -split "\\|")) { ' +
    '  $eq = $part.IndexOf("="); ' +
    '  if ($eq -lt 1) { continue }; ' +
    '  $k = $part.Substring(0, $eq); ' +
    '  if (-not $fields.ContainsKey($k)) { $fields[$k] = $part.Substring($eq + 1) }; ' +
    '}; ' +
    'if ($fields["Name"] -cne $ruleName) { continue }; ' +
    'if ($fields["Active"] -cne "TRUE") { continue }; ' +
    'if ($fields["Dir"] -cne "Out") { continue }; ' +
    'if ($fields["Action"] -cne "Block") { continue }; ' +
    '$wantProto = $null; ' +
    'if ($e.p -eq "TCP") { $wantProto = "6" } ' +
    'elseif ($e.p -eq "UDP") { $wantProto = "17" } ' +
    'elseif ($e.p -eq "ICMPv4") { $wantProto = "1" } ' +
    'elseif ($e.p -eq "ICMPv6") { $wantProto = "58" }; ' +
    'if ($null -eq $wantProto -or $fields["Protocol"] -cne $wantProto) { continue }; ' +
    "$expectedLuAuth = 'D:(A;;CC;;;" +
    safeSid +
    ")'; " +
    'if ($fields["LUAuth"] -cne $expectedLuAuth) { continue }; ' +
    '$found = $true; break; ' +
    '}; ' +
    'if (-not $found) { $missing += $e.n }; ' +
    '}; ' +
    '} else { $missing = $expected.n }; ' +
    '$acl = Get-Acl $env:USERPROFILE; ' +
    '$deny = @($acl.Access | Where-Object { ' +
    '$ace = $_; ' +
    '$sidOk = $false; ' +
    "try { $sidOk = ($ace.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -eq '" +
    safeSid +
    "') } catch { $sidOk = $false }; " +
    '$r = 0; try { $r = [int]$ace.FileSystemRights } catch {}; ' +
    '$rightsOk = ((($r -band 2032127) -eq 2032127) -or ((($r -band 1) -ne 0) -and (($r -band 2) -ne 0))); ' +
    '$flagsOk = (([int]$ace.InheritanceFlags -band 3) -eq 3); ' +
    "($sidOk -and ($ace.AccessControlType -eq 'Deny') -and $rightsOk -and $flagsOk) }); " +
    "if ($missing.Count -eq 0 -and $deny.Count -ge 1) { 'OK' } else { 'MISSING:' + ($missing -join ',') }" +
    '}'
  );
}

/**
 * P5: re-verify the OS boundary at launch. The verdict file alone is not
 * evidence — a firewall rule or operator-profile Deny ACE deleted inside the
 * 24h freshness window must still block the launch. Runs on the operator
 * side; injectable via options.verifyBoundary so tests stay deterministic.
 * Q3: verifies the full expected rule set, not "at least one rule".
 */
function defaultVerifyBoundary(sid, username) {
  const res = cp.spawnSync(
    'powershell',
    ['-NoProfile', '-Command', buildBoundaryVerifyScript(sid, username)],
    {
      encoding: 'utf8',
      windowsHide: true,
    }
  );
  return (res.stdout || '').trim() === 'OK';
}

/**
 * Builds the host-side PowerShell script that starts the worker process.
 * Pure: it only returns text, so tests can generate and parse the exact script
 * a real launch would write without provisioning a worker or starting a
 * process.
 *
 * Escaping contract: a backtick-escaped `$` is only valid INSIDE the
 * double-quoted here-string that builds run-target.ps1, where it emits a
 * literal `$env:HOME` for the worker. Outside a here-string `` `$false `` is
 * the string "$false", not the boolean $false, and PowerShell then tries to
 * run it as a command — which aborts the host script under
 * `$ErrorActionPreference = "Stop"` before the worker is ever started.
 *
 * Completion contract: run-target.ps1 writes a nonce-bound marker file only
 * AFTER the payload command returned, carrying the payload's own exit code.
 * The host copies that marker into the host-owned launch result, so a result
 * that reports success always carries positive evidence that the job ran to
 * its end. The host waits for the wrapper process AND every process it
 * started, inside workerTimeoutMs, and fails closed on timeout or a missing
 * marker.
 */
function buildWorkerLaunchScript(options) {
  const credPath = options.credPath;
  const workerRoot = options.workerRoot;
  const workerUsername = options.workerUsername || WORKER_USERNAME;
  const exeFile = options.exeFile;
  const payloadArgsPath = options.payloadArgsPath;
  const launchResultPath = options.launchResultPath;
  const workerTimeoutMs = options.workerTimeoutMs;
  const completionNonce = options.completionNonce || crypto.randomBytes(16).toString('hex');
  const markerPath = options.markerPath || path.join(workerRoot, 'run-target.complete.json');
  // Test-only seam. The generated host script normally impersonates the worker
  // with the DPAPI credential; a regression test executes the SAME generated
  // script end to end as the current user, so this option drops only the
  // credential and impersonation lines. Production never sets it.
  const runAsCurrentUser = Boolean(options.runAsCurrentUser);
  const credentialLines = runAsCurrentUser
    ? ''
    : `$sec = Get-Content "${credPath}" | ConvertTo-SecureString
$cred = New-Object System.Management.Automation.PSCredential("${workerUsername}", $sec)

`;
  const impersonationLines = runAsCurrentUser
    ? ''
    : `$psi.UserName = "${workerUsername}"
$psi.Password = $sec
`;

  const safeWorkerRootForGit = workerRoot.replace(/\\/g, '/');

  const envAllowed = [
    'PATH',
    'SystemRoot',
    'SystemDrive',
    'ALLUSERSPROFILE',
    'APPDATA',
    'LOCALAPPDATA',
    'ProgramData',
    'ProgramFiles',
    'ProgramFiles(x86)',
    'CommonProgramFiles',
    'CommonProgramFiles(x86)',
    'PUBLIC',
    'PATHEXT',
  ];
  if (options.adapterId === 'opencode-direct') {
    envAllowed.push('NINEROUTER_API_KEY');
  }
  const allowedArray = '@(' + envAllowed.map((k) => `"${k}"`).join(', ') + ')';

  return `
$ErrorActionPreference = "Stop"
${credentialLines}$nestedScript = "${workerRoot}\\run-target.ps1"
$markerPath = "${markerPath}"
$completionNonce = "${completionNonce}"
$wrapperPid = 0
$wrapperStartTime = Get-Date
@"
\`$ErrorActionPreference = "Stop"
\`$env:HOME = "${workerRoot}"
\`$env:USERPROFILE = "${workerRoot}"
\`$env:GH_CONFIG_DIR = "${workerRoot}\\.config\\gh"
\`$env:GIT_CONFIG_GLOBAL = "NUL"
\`$env:GIT_CONFIG_COUNT = "1"
\`$env:GIT_CONFIG_KEY_0 = "safe.directory"
\`$env:GIT_CONFIG_VALUE_0 = "${safeWorkerRootForGit}"
\`$env:TEMP = "${workerRoot}\\temp"
\`$env:TMP = "${workerRoot}\\temp"
if (-not (Test-Path "${workerRoot}\\temp")) { New-Item -ItemType Directory -Path "${workerRoot}\\temp" | Out-Null }
Set-Location -Path "${workerRoot}"
\`$env:SHIPDE_RUN_TARGET_PID = "\`$PID"
\`$payloadArgs = @(Get-Content -LiteralPath "${payloadArgsPath}" -Raw | ConvertFrom-Json)
& "${exeFile}" @payloadArgs
\`$jobExit = \`$LASTEXITCODE
if (\`$null -eq \`$jobExit) { exit 1 }
@{ nonce = "${completionNonce}"; exitCode = [int]\`$jobExit; completedAt = (Get-Date).ToString('o') } | ConvertTo-Json -Depth 5 | Out-File "${markerPath}" -Encoding UTF8
exit \`$jobExit
"@ | Out-File $nestedScript -Encoding UTF8

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = "powershell.exe"
$psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -File \`"$nestedScript\`""
${impersonationLines}$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$psi.WorkingDirectory = "${workerRoot}"
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true

# Clear environment to avoid leaking operator tokens (F4)
$psi.EnvironmentVariables.Clear()
# PATHEXT is not a secret and must survive the scrub: without it PowerShell's
# call operator falls off the CreateProcess path for an absolute .exe, returns
# before the job ran and leaves the payload orphaned — a green result for a
# job that never finished.
$allowed = ${allowedArray}
foreach ($key in $allowed) {
    if ([Environment]::GetEnvironmentVariable($key)) {
        $psi.EnvironmentVariables[$key] = [Environment]::GetEnvironmentVariable($key)
    }
}

$process = [System.Diagnostics.Process]::Start($psi)
$wrapperPid = $process.Id
$wrapperStartTime = $process.StartTime
$stdoutTask = $process.StandardOutput.ReadToEndAsync()
$stderrTask = $process.StandardError.ReadToEndAsync()
$timeoutMs = ${workerTimeoutMs}

# Every process the wrapper started, walked up the parent chain. A process
# that predates the launch is never a descendant even if a recycled pid makes
# it look like one.
function Get-DescendantProcessIds {
    param([int]$AncestorPid, [datetime]$NotBefore)
    $rows = @(Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, CreationDate -ErrorAction SilentlyContinue)
    $children = @{}
    $created = @{}
    foreach ($row in $rows) {
        $rowPid = [int]$row.ProcessId
        $created[$rowPid] = $row.CreationDate
        $rowParent = [int]$row.ParentProcessId
        if (-not $children.ContainsKey($rowParent)) { $children[$rowParent] = @() }
        $children[$rowParent] += $rowPid
    }
    $found = @()
    $queue = New-Object System.Collections.Queue
    $queue.Enqueue($AncestorPid)
    $seen = @{}
    $seen[$AncestorPid] = $true
    while ($queue.Count -gt 0) {
        $currentPid = $queue.Dequeue()
        if (-not $children.ContainsKey($currentPid)) { continue }
        foreach ($childPid in $children[$currentPid]) {
            if ($seen.ContainsKey($childPid)) { continue }
            $seen[$childPid] = $true
            $queue.Enqueue($childPid)
            if ($created.ContainsKey($childPid) -and $null -ne $created[$childPid] -and $created[$childPid] -ge $NotBefore) { $found += $childPid }
        }
    }
    return $found
}

# The wrapper is waited on with the bounded wait, then every process it
# started is polled until none remain, all inside the same budget. Waiting for
# the wrapper alone is not enough: a job the wrapper no longer waits for would
# otherwise be reported as finished while it is still running.
$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
$timedOut = -not $process.WaitForExit($timeoutMs)
$quietPolls = 0
if (-not $timedOut) {
    while ($true) {
        $remaining = $timeoutMs - $stopwatch.ElapsedMilliseconds
        if ($remaining -le 0) { $timedOut = $true; break }
        $pidRecycled = $false
        try {
            $holder = Get-Process -Id $wrapperPid -ErrorAction SilentlyContinue
            if ($null -ne $holder -and [math]::Abs(($holder.StartTime - $wrapperStartTime).TotalSeconds) -gt 5) {
                $pidRecycled = $true
            }
        } catch {
            # The pid cannot be attributed to this launch any more, so nothing
            # found under it can be trusted as this launch's descendant.
            $pidRecycled = $true
        }
        if ($pidRecycled) {
            $quietPolls = $quietPolls + 1
        } else {
            $leftovers = @(Get-DescendantProcessIds -AncestorPid $wrapperPid -NotBefore $wrapperStartTime.AddSeconds(-2))
            if ($leftovers.Count -eq 0) { $quietPolls = $quietPolls + 1 } else { $quietPolls = 0 }
        }
        if ($quietPolls -ge 3) { break }
        Start-Sleep -Milliseconds 250
    }
}

if ($timedOut) {
    $stragglers = @(Get-DescendantProcessIds -AncestorPid $wrapperPid -NotBefore $wrapperStartTime.AddSeconds(-2))
    foreach ($stragglerId in $stragglers) { Stop-Process -Id $stragglerId -Force -ErrorAction SilentlyContinue }
    if (-not $process.HasExited) { try { $process.Kill() } catch {} }
    # taskkill's own text must never reach this script's error stream: under
    # $ErrorActionPreference = "Stop" a single stderr line would abort the host
    # before the result is written. cmd.exe swallows it instead.
    try { & cmd.exe /c "taskkill /PID $wrapperPid /T /F >nul 2>&1" } catch {}
    [void]$process.WaitForExit(10000)
}
# A writer the operator cannot kill (another user's process) must not hang the
# host forever: the pipes are read with a bound, and a pipe that never closed
# is itself reported as a failure.
$stdout = ""
$stderr = ""
if ($stdoutTask.Wait(15000)) { $stdout = $stdoutTask.Result }
if ($stderrTask.Wait(15000)) {
    $stderr = $stderrTask.Result
} else {
    $stderr = "[ISOLATION_LAUNCHER] worker output pipes never closed"
}

# Positive evidence: the marker is written by run-target.ps1 after the payload
# returned, so it can only exist for a job that really ran to its end.
$completed = $false
$markerNonce = ""
$jobExit = -1
$failureReason = ""
if ($timedOut) {
    $failureReason = "[ISOLATION_LAUNCHER] worker timed out after $timeoutMs ms and was killed"
} elseif (Test-Path -LiteralPath $markerPath) {
    try {
        $marker = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json
        if ([string]$marker.nonce -ceq $completionNonce -and $null -ne $marker.exitCode) {
            $completed = $true
            $markerNonce = [string]$marker.nonce
            $jobExit = [int]$marker.exitCode
        } else {
            $failureReason = "[ISOLATION_LAUNCHER] completion marker does not belong to this launch"
        }
    } catch {
        $failureReason = "[ISOLATION_LAUNCHER] completion marker unreadable: " + $_.Exception.Message
    }
} else {
    $failureReason = "[ISOLATION_LAUNCHER] the worker job never wrote its completion marker"
}
$exitValue = -1
if ($completed -and -not $timedOut) { $exitValue = $jobExit }
if ($failureReason.Length -gt 0) { $stderr = $stderr + [Environment]::NewLine + $failureReason }

$output = @{
    exitCode = $exitValue
    stdout = $stdout
    stderr = $stderr
    timedOut = $timedOut
    completed = $completed
    completionNonce = $markerNonce
    failureReason = $failureReason
}
$output | ConvertTo-Json -Depth 10 | Out-File "${launchResultPath}" -Encoding UTF8
`;
}

function appendGitInfoExclude(workerRoot, entries) {
  const excludePath = path.join(workerRoot, '.git', 'info', 'exclude');
  fs.mkdirSync(path.dirname(excludePath), { recursive: true });
  const existing = fs.existsSync(excludePath) ? fs.readFileSync(excludePath, 'utf8') : '';
  const present = new Set(
    existing
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
  );
  const missing = entries.filter((entry) => !present.has(entry));
  if (missing.length === 0) return;
  const prefix = existing.length > 0 && !/\r?\n$/.test(existing) ? '\n' : '';
  fs.appendFileSync(excludePath, prefix + missing.join('\n') + '\n', 'utf8');
}

function getIsolatedLauncher() {
  return function isolatedLauncher(adapter, args, options) {
    if (args && !Array.isArray(args)) {
      if (args.killTree) {
        return require('./harness').runHarness(adapter, args, options);
      }
      args = [];
    }
    const opts = options || {};

    // The verdict path is injectable so tests can write the verdict where the
    // code reads it on every OS. The production default is unchanged on Windows
    // (LOCALAPPDATA\ShipDe\isolation-verdict.json); LOCALAPPDATA is unset on
    // non-Windows, so production there resolves to a relative path, exactly as
    // before this opt was added.
    const verdictPath =
      opts.verdictPath ||
      path.join(process.env.LOCALAPPDATA || '', 'ShipDe', 'isolation-verdict.json');
    if (!fs.existsSync(verdictPath)) {
      throw new Error('ISOLATION_VERDICT_MISSING: Cannot find ' + verdictPath);
    }
    const stat = fs.statSync(verdictPath);
    if (Date.now() - stat.mtimeMs > 24 * 60 * 60 * 1000) {
      throw new Error('ISOLATION_VERDICT_STALE: ' + verdictPath + ' is older than 24h');
    }
    const verdictText = fs.readFileSync(verdictPath, 'utf8');
    const verdictData = JSON.parse(
      verdictText.charCodeAt(0) === 0xfeff ? verdictText.slice(1) : verdictText
    );
    if (verdictData.verdict !== 'CLOSED') {
      throw new Error('ISOLATION_VERDICT_NOT_CLOSED: Last verdict was ' + verdictData.verdict);
    }

    const hostCwd = opts.cwd || process.cwd();
    const jobName = path.basename(hostCwd) || 'default';
    const workerRoot = opts.workerRoot || workerRootFor(hostCwd);

    // P5: bind the FULL host worktree path, not just the worker-root leaf, so
    // two jobs sharing a directory leaf cannot share one attestation.
    if (
      !verdictData.worktree ||
      String(verdictData.worktree).toLowerCase() !== String(hostCwd).toLowerCase()
    ) {
      throw new Error('ISOLATION_VERDICT_INVALID: worktree mismatch or missing');
    }
    if (!verdictData.timestamp || new Date(verdictData.timestamp).getTime() > Date.now()) {
      throw new Error('ISOLATION_VERDICT_INVALID: timestamp in future or missing');
    }
    const policyHash = getFolderHash(path.join(hostCwd, 'scripts/ai/isolation'));
    if (!verdictData.policyHash || verdictData.policyHash !== policyHash) {
      throw new Error('ISOLATION_VERDICT_INVALID: policyHash mismatch or missing');
    }
    const getWorkerSid =
      typeof opts.getWorkerSid === 'function' ? opts.getWorkerSid : queryWorkerSid;
    const currentSid = getWorkerSid();
    if (!verdictData.sid || verdictData.sid !== currentSid) {
      throw new Error('ISOLATION_VERDICT_INVALID: SID mismatch or missing');
    }
    // P5: per-check granularity — the verdict must carry every isolation
    // check's outcome and each one must be PASS, not just the summary verdict.
    if (!verdictData.details || typeof verdictData.details !== 'object') {
      throw new Error('ISOLATION_VERDICT_INVALID: details missing');
    }
    for (const [key, value] of Object.entries(verdictData.details)) {
      if (!/^PASS/.test(String(value))) {
        throw new Error('ISOLATION_VERDICT_INVALID: check ' + key + ' = ' + value);
      }
    }
    // P5: re-verify the boundary is still physically present right now.
    const verifyBoundary =
      typeof opts.verifyBoundary === 'function' ? opts.verifyBoundary : defaultVerifyBoundary;
    if (!verifyBoundary(currentSid, WORKER_USERNAME, opts)) {
      throw new Error(
        'ISOLATION_BOUNDARY_MISSING: firewall rules or operator-profile Deny ACL absent; rerun Set-WorkerFirewall.ps1/Set-WorkerAcl.ps1'
      );
    }

    // Provision worktree using a clean clone checked out at the caller's
    // pinned base SHA (AI-64-R15). The operator worktree's current HEAD is not
    // a base: it moves under the operator's feet, and a worker provisioned at
    // "whatever HEAD was" is not a reproducible run. An absent or malformed pin
    // stops the run before the worker root is created.
    const baseSha = opts.baseSha || null;
    if (!baseSha) {
      throw new Error('ISOLATION_BASE_SHA_MISSING: the caller must pin the base SHA to provision');
    }
    if (!/^[0-9a-f]{40}$/i.test(String(baseSha))) {
      throw new Error('ISOLATION_BASE_SHA_INVALID: not a 40-character commit: ' + baseSha);
    }
    const headSha = String(baseSha);
    if (fs.existsSync(workerRoot)) {
      fs.rmSync(workerRoot, { recursive: true, force: true });
    }

    // Q5: --no-hardlinks — a local clone hardlinks .git/objects files to
    // the operator repo; the worker root is outside the operator profile and
    // the worker is granted Modify, so a hardlinked object could be
    // rewritten in place to corrupt the OPERATOR repo's objects.
    const cloneRes = cp.spawnSync(
      'git',
      ['clone', '--no-checkout', '--no-hardlinks', hostCwd, workerRoot],
      {
        windowsHide: true,
      }
    );
    if (cloneRes.status !== 0) throw new Error('Failed to clone repository');

    const checkoutRes = cp.spawnSync('git', ['checkout', headSha], {
      cwd: workerRoot,
      windowsHide: true,
    });
    if (checkoutRes.status !== 0) throw new Error('Failed to checkout HEAD SHA in worker root');

    if (adapter.id === 'opencode-direct') {
      const sources = require('./sources.json');
      const routerSource = sources.sources.find((s) => s.id === '9router');
      if (!routerSource) {
        throw new Error('OPENCODE_DIRECT_LAUNCH_FAILED: 9router source not found in sources.json');
      }

      const configPath = path.join(workerRoot, 'opencode.json');
      const configData = JSON.stringify({
        provider: {
          '9router': {
            options: {
              baseURL: routerSource.endpoint,
              apiKey: `{env:${routerSource.credential.env}}`,
            },
          },
        },
      });
      fs.writeFileSync(configPath, configData, 'utf8');
      appendGitInfoExclude(workerRoot, ['opencode.json']);
    }

    const credPath = path.join(process.env.LOCALAPPDATA || '', 'ShipDe', 'WorkerUser.cred');

    const exe = executableFor(adapter.command, opts);
    const fullArgs = exe.prefixArgs.concat(args);

    // Q6: the launch result is written to a HOST-OWNED directory outside
    // workerRoot. Inside workerRoot a worker child that survives the main
    // process could overwrite launch-result.json and forge the telemetry the
    // node parent reads. LOCALAPPDATA\ShipDe\launch-results is operator-only.
    const launchResultDir = path.join(
      process.env.LOCALAPPDATA || 'C:\\temp',
      'ShipDe',
      'launch-results'
    );
    fs.mkdirSync(launchResultDir, { recursive: true });
    const launchResultPath = path.join(launchResultDir, jobName + '-' + Date.now() + '.json');

    // P6: the worker wait is bounded. A hung worker is killed after the
    // timeout instead of blocking the controller forever.
    const workerTimeoutMs =
      Number.isFinite(Number(opts.workerTimeoutMs)) && Number(opts.workerTimeoutMs) > 0
        ? Number(opts.workerTimeoutMs)
        : DEFAULT_WORKER_TIMEOUT_MS;

    // Bound to THIS launch: run-target.ps1 can only write a marker carrying
    // this nonce, so a leftover marker from an earlier job can never satisfy
    // the completion gate below.
    const completionNonce = crypto.randomBytes(16).toString('hex');
    const payloadDir = path.join(workerRoot, '.shipde');
    fs.mkdirSync(payloadDir, { recursive: true });
    appendGitInfoExclude(workerRoot, ['.shipde/']);
    const payloadArgsPath = path.join(payloadDir, 'launch-args-' + completionNonce + '.json');
    fs.writeFileSync(payloadArgsPath, JSON.stringify(fullArgs), 'utf8');

    const scriptContent = buildWorkerLaunchScript({
      credPath,
      workerRoot,
      workerUsername: WORKER_USERNAME,
      exeFile: exe.file,
      payloadArgsPath,
      launchResultPath,
      workerTimeoutMs,
      completionNonce,
      adapterId: adapter.id,
    });

    const tempScript = path.join(
      process.env.TEMP || 'C:\\temp',
      'isolated-launch-' + Date.now() + '.ps1'
    );
    fs.writeFileSync(tempScript, scriptContent, 'utf8');

    const hostRes = cp.spawnSync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tempScript],
      {
        encoding: 'utf8',
        windowsHide: true,
        timeout: workerTimeoutMs + 120000,
        maxBuffer: 16 * 1024 * 1024,
      }
    );

    try {
      fs.unlinkSync(tempScript);
    } catch (e) {}

    return readLaunchResult(launchResultPath, completionNonce, hostRes);
  };
}

/**
 * Reads the host-owned launch result for one launch.
 *
 * Q6: the file comes from LOCALAPPDATA\ShipDe\launch-results, never from
 * worker-writable workerRoot. PowerShell 5.1 writes it with a UTF-8 BOM, which
 * JSON.parse rejects, so the BOM is stripped exactly as it is for the verdict
 * and the approvals registry. Nothing here may fall back to the host process
 * status, which can be 0 for a job that never ran: an absent, unparsable,
 * timed-out or unproven result is a failed launch (exitCode -1), and only a
 * completed job carrying THIS launch's nonce returns the job's own exit code.
 */
function readLaunchResult(launchResultPath, completionNonce, hostRes) {
  const hostFailure = (reason) => ({
    exitCode: -1,
    stdout: (hostRes && hostRes.stdout) || '',
    stderr: [reason, String((hostRes && hostRes.stderr) || '').trim()].filter(Boolean).join('\n'),
    timedOut: Boolean(hostRes && hostRes.signal === 'SIGTERM'),
  });

  let resJson = null;
  try {
    if (!fs.existsSync(launchResultPath)) {
      throw new Error('the host script never wrote it');
    }
    const resultText = fs.readFileSync(launchResultPath, 'utf8');
    resJson = JSON.parse(resultText.charCodeAt(0) === 0xfeff ? resultText.slice(1) : resultText);
  } catch (e) {
    return hostFailure('[ISOLATION_LAUNCHER] launch result unreadable: ' + e.message);
  }

  const jobExit = Number(resJson.exitCode);
  if (
    resJson.timedOut === true ||
    resJson.completed !== true ||
    resJson.completionNonce !== completionNonce ||
    !Number.isFinite(jobExit)
  ) {
    return {
      exitCode: -1,
      stdout: String(resJson.stdout || ''),
      stderr: String(resJson.stderr || ''),
      timedOut: resJson.timedOut === true,
    };
  }

  return {
    exitCode: jobExit,
    stdout: String(resJson.stdout || ''),
    stderr: String(resJson.stderr || ''),
    timedOut: false,
    completionNonce: resJson.completionNonce,
  };
}

module.exports = {
  getIsolatedLauncher,
  getFolderHash,
  defaultVerifyBoundary,
  buildBoundaryVerifyScript,
  buildWorkerLaunchScript,
  workerRootFor,
  isWorkerPath,
  WORKER_USERNAME,
  WORKER_ROOT,
  readLaunchResult,
  EXPECTED_FIREWALL_RULES,
  DEFAULT_WORKER_TIMEOUT_MS,
};
