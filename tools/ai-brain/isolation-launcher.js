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
  const jobName = path.win32.basename(String(hostCwd || '')) || 'default';
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

const EXERCISE_CASES = path.join(__dirname, 'exercise', 'e1-branch-name.cases.json');
const EXERCISE_RUNNER = path.join('tools', 'ai-brain', 'test', 'e1-branch-name.test.js');
const THROWS = 'THROWS:';

function exerciseCasesPath(exerciseName) {
  const name = String(exerciseName || 'e1-branch-name').trim();
  if (name === 'e1' || name === 'e1-branch-name' || name === 'true' || !name) {
    return EXERCISE_CASES;
  }
  const candidate = path.join(__dirname, 'exercise', `${name}.cases.json`);
  if (fs.existsSync(candidate)) return candidate;
  return EXERCISE_CASES;
}

/**
 * Captures fail-before host-side in workerRoot at the pinned base SHA.
 *
 * Runs the exercise runner command (node --test tools/ai-brain/test/e1-branch-name.test.js)
 * in workerRoot before the agent begins work. Because tools/ai-brain/branch-name.js
 * does not exist at the base SHA, the command exits non-zero (missing module error).
 * This real captured execution transcript provides honest fail-before evidence.
 */
function captureFailBefore(workerRoot, options) {
  const o = options || {};
  const spawn = o.spawnSync || cp.spawnSync;
  const runnerRel = path.join('tools', 'ai-brain', 'test', 'e1-branch-name.test.js');
  const runnerPosix = runnerRel.replace(/\\/g, '/');
  const runnerFull = path.join(workerRoot, runnerRel);
  if (!fs.existsSync(runnerFull)) {
    throw new Error('FAIL_BEFORE_RUNNER_MISSING: ' + runnerFull);
  }

  const baseSha = o.baseSha ? String(o.baseSha).trim() : null;
  if (baseSha) {
    const nulDevice = process.platform === 'win32' ? 'NUL' : '/dev/null';
    const normWorkerRoot = path.resolve(workerRoot).replace(/\\/g, '/');
    const ancestryCheck = spawn(
      'git',
      [
        '-c',
        'safe.directory=' + normWorkerRoot,
        '-c',
        'core.hooksPath=' + nulDevice,
        '-c',
        'core.fsmonitor=false',
        '-c',
        'core.attributesFile=' + nulDevice,
        'merge-base',
        '--is-ancestor',
        baseSha,
        'HEAD',
      ],
      {
        cwd: workerRoot,
        windowsHide: true,
        env: Object.assign({}, process.env, {
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_CONFIG_GLOBAL: nulDevice,
          GIT_CONFIG_SYSTEM: nulDevice,
        }),
      }
    );
    if (!ancestryCheck || ancestryCheck.status !== 0) {
      const err = new Error(
        'FAIL_BEFORE_ANCESTRY_MISMATCH: base SHA ' +
          baseSha +
          ' is not an ancestor of worker root HEAD'
      );
      err.code = 'FAIL_BEFORE_ANCESTRY_MISMATCH';
      throw err;
    }
  }

  const command =
    (o.verification && o.verification.command) || o.exerciseCommand || `node --test ${runnerPosix}`;

  const childEnv = Object.assign({}, process.env, o.env || {});
  delete childEnv.NODE_TEST_CONTEXT;
  delete childEnv.NODE_TEST_WORKER_ID;

  let res;
  if (!o.verification && !o.exerciseCommand) {
    const execPath = o.nodePath || process.execPath;
    res = spawn(execPath, ['--test', runnerPosix], {
      cwd: workerRoot,
      env: childEnv,
      encoding: 'utf8',
      windowsHide: true,
      timeout: o.timeoutMs || 30000,
      maxBuffer: 16 * 1024 * 1024,
    });
  } else {
    res = spawn(command, {
      cwd: workerRoot,
      env: childEnv,
      encoding: 'utf8',
      shell: true,
      windowsHide: true,
      timeout: o.timeoutMs || 30000,
      maxBuffer: 16 * 1024 * 1024,
    });
  }

  const stdout = String((res && res.stdout) || '');
  const stderr = String((res && res.stderr) || '');
  const exitCode = res ? (res.status !== null && res.status !== undefined ? res.status : -1) : -1;
  const output = (stdout + (stderr ? (stdout ? '\n' : '') + stderr : '')).slice(-2000);

  return {
    command,
    exitCode,
    stdout,
    stderr,
    output,
    capturedAt: new Date().toISOString(),
    pass: exitCode === 0,
    ancestry: true,
  };
}

/**
 * Materialises the exercise's runner INSIDE the worker root, from the committed
 * case data, AFTER the worker root has been provisioned.
 *
 * Keeps the runner untracked by adding it to .git/info/exclude in the worker clone,
 * and captures fail-before at the base SHA in the provisioned tree.
 */
function materialiseExercise(workerRoot, options) {
  const o = options || {};
  if (!workerRoot) {
    throw new Error(
      'EXERCISE_ROOT_MISSING: the exercise runner may only be written into a worker root'
    );
  }
  const root = path.resolve(workerRoot);
  const checkWorker = (o && o.isWorkerPath) || isWorkerPath;
  if (!checkWorker(root)) {
    throw new Error('EXERCISE_ROOT_INVALID: refusing to write the runner outside the worker root');
  }
  const target = path.join(root, EXERCISE_RUNNER);
  if (path.relative(root, target).startsWith('..') || !path.isAbsolute(target)) {
    throw new Error('EXERCISE_ROOT_INVALID: refusing to write the runner outside the worker root');
  }
  const casesFile = exerciseCasesPath(o.exercise);
  if (!fs.existsSync(casesFile)) {
    throw new Error('EXERCISE_CASES_MISSING: ' + casesFile);
  }
  const cases = JSON.parse(fs.readFileSync(casesFile, 'utf8'));
  if (!Array.isArray(cases) || cases.length === 0) {
    throw new Error('EXERCISE_CASES_EMPTY: ' + casesFile);
  }
  const body = [
    "'use strict';",
    '',
    '// Materialised inside the worker root from tools/ai-brain/exercise/e1-branch-name.cases.json.',
    '// Never committed: the test:brain glob would pick this file up on the integration',
    '// branch. Run it with: node --test tools/ai-brain/test/e1-branch-name.test.js',
    '',
    "const { test } = require('node:test');",
    "const assert = require('node:assert/strict');",
    "const cases = require('../exercise/e1-branch-name.cases.json');",
    "const { normalizeWorkItemBranch } = require('../branch-name');",
    '',
    'const THROWS = ' + JSON.stringify(THROWS) + ';',
    '',
    'for (const c of cases) {',
    '  test(c.name, () => {',
    '    if (typeof c.expect === "string" && c.expect.startsWith(THROWS)) {',
    '      const code = c.expect.slice(THROWS.length);',
    '      assert.throws(',
    '        () => normalizeWorkItemBranch(c.workItemId, c.kind, c.outcome),',
    '        (err) => {',
    '          const named = String((err && err.code) || "") + " " + String((err && err.message) || "");',
    '          assert.ok(',
    '            named.includes(code),',
    '            "expected the thrown error to be " + code + ", got: " + named',
    '          );',
    '          return true;',
    '        }',
    '      );',
    '      return;',
    '    }',
    '    assert.equal(normalizeWorkItemBranch(c.workItemId, c.kind, c.outcome), c.expect);',
    '  });',
    '}',
    '',
  ].join('\n');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, body, 'utf8');

  // Keep it untracked in git
  appendGitInfoExclude(root, ['tools/ai-brain/test/e1-branch-name.test.js']);

  let failBefore = null;
  if (!o.skipFailBefore) {
    try {
      failBefore = captureFailBefore(root, o);
    } catch (err) {
      if (err && err.code === 'FAIL_BEFORE_ANCESTRY_MISMATCH') {
        throw err;
      }
      failBefore = {
        command:
          (o.verification && o.verification.command) ||
          'node --test tools/ai-brain/test/e1-branch-name.test.js',
        exitCode: -1,
        stdout: '',
        stderr: String((err && err.message) || err),
        output: String((err && err.message) || err),
        capturedAt: new Date().toISOString(),
        pass: false,
        error: String((err && err.message) || err),
      };
    }
  }

  return { path: target, cases: cases.length, failBefore };
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

    // Distinguish initial launch of a work item vs repair round explicitly:
    // (1) Initial launch (no repair context, retainWorkerHead is not provided):
    //     always re-provision a fresh worker root at the pinned base SHA
    //     (delete + git clone --no-checkout --no-hardlinks + checkout inside the fresh clone),
    //     regardless of what an earlier run left in workerRoot.
    // (2) Repair round (retainWorkerHead is provided, e.g. <40-char sha>):
    //     keep the existing root only if a hardened read (clean GIT_CONFIG_GLOBAL/SYSTEM=NUL,
    //     -c core.hooksPath=NUL -c core.fsmonitor=false -c core.attributesFile=NUL) shows
    //     HEAD == that sha; never run checkout or any tree-mutating git in a retained root;
    //     mismatch -> structured WORKER_HEAD_MISMATCH failure for that repair attempt.
    const nulDevice = process.platform === 'win32' ? 'NUL' : '/dev/null';
    const retainWorkerHead =
      typeof opts.retainWorkerHead === 'string'
        ? opts.retainWorkerHead.trim()
        : opts.retainWorkerHead
          ? headSha
          : null;

    if (retainWorkerHead) {
      let retainedHeadSha = null;
      if (fs.existsSync(workerRoot) && fs.existsSync(path.join(workerRoot, '.git'))) {
        try {
          const { withCleanGitEnv, safeGit } = require('./supervisor');
          retainedHeadSha = withCleanGitEnv(
            workerRoot,
            (safeGitDir) => {
              const curHeadRes = safeGit(
                safeGitDir,
                workerRoot,
                ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'],
                20000
              );
              if (curHeadRes && curHeadRes.status === 0 && curHeadRes.stdout) {
                return curHeadRes.stdout.trim();
              }
              return null;
            },
            { workerWritable: true }
          );
        } catch {
          retainedHeadSha = null;
        }
      }

      if (!retainedHeadSha || retainedHeadSha.toLowerCase() !== retainWorkerHead.toLowerCase()) {
        const err = new Error(
          'WORKER_HEAD_MISMATCH: retained worker root HEAD (' +
            (retainedHeadSha || 'unknown') +
            ') does not match requested SHA ' +
            retainWorkerHead
        );
        err.code = 'WORKER_HEAD_MISMATCH';
        throw err;
      }
      // Matching HEAD: retain worker root and its commits as-is. NEVER run checkout.
    } else {
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
          env: Object.assign({}, process.env, {
            GIT_CONFIG_NOSYSTEM: '1',
            GIT_CONFIG_GLOBAL: nulDevice,
            GIT_CONFIG_SYSTEM: nulDevice,
          }),
        }
      );
      if (cloneRes.status !== 0) throw new Error('Failed to clone repository');

      const { getEffectiveEolConfig } = require('./supervisor');
      const eolConfig = getEffectiveEolConfig(hostCwd, opts);

      const normWorkerRoot = path.resolve(workerRoot).replace(/\\/g, '/');
      const checkoutArgs = [
        '-c',
        'core.hooksPath=' + nulDevice,
        '-c',
        'core.fsmonitor=false',
        '-c',
        'core.attributesFile=' + nulDevice,
        '-c',
        'diff.external=',
        '-c',
        'safe.directory=' + normWorkerRoot,
      ];
      if (process.platform === 'win32') {
        checkoutArgs.push('-c', 'core.filemode=false');
      }
      if (eolConfig.autocrlf !== null) {
        checkoutArgs.push('-c', 'core.autocrlf=' + eolConfig.autocrlf);
      }
      if (eolConfig.eol !== null) {
        checkoutArgs.push('-c', 'core.eol=' + eolConfig.eol);
      }
      const targetBranch =
        opts.branch || (opts.workItemId ? 'feat/' + String(opts.workItemId).toLowerCase() : null);

      if (targetBranch) {
        checkoutArgs.push('checkout', '-B', targetBranch, headSha);
      } else {
        checkoutArgs.push('checkout', headSha);
      }

      const checkoutRes = cp.spawnSync('git', checkoutArgs, {
        cwd: workerRoot,
        windowsHide: true,
        env: Object.assign({}, process.env, {
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_CONFIG_GLOBAL: nulDevice,
          GIT_CONFIG_SYSTEM: nulDevice,
        }),
      });
      if (checkoutRes.status !== 0) {
        throw new Error(
          'ISOLATION_CHECKOUT_FAILED: Failed to checkout HEAD SHA in worker root: ' + headSha
        );
      }

      if (targetBranch) {
        cp.spawnSync('git', ['update-ref', 'refs/remotes/origin/' + targetBranch, headSha], {
          cwd: workerRoot,
          windowsHide: true,
          env: Object.assign({}, process.env, {
            GIT_CONFIG_NOSYSTEM: '1',
            GIT_CONFIG_GLOBAL: nulDevice,
            GIT_CONFIG_SYSTEM: nulDevice,
          }),
        });
      }

      if (eolConfig.autocrlf !== null) {
        cp.spawnSync('git', ['config', 'core.autocrlf', eolConfig.autocrlf], {
          cwd: workerRoot,
          windowsHide: true,
          env: Object.assign({}, process.env, {
            GIT_CONFIG_NOSYSTEM: '1',
            GIT_CONFIG_GLOBAL: nulDevice,
            GIT_CONFIG_SYSTEM: nulDevice,
          }),
        });
      }
      if (eolConfig.eol !== null) {
        cp.spawnSync('git', ['config', 'core.eol', eolConfig.eol], {
          cwd: workerRoot,
          windowsHide: true,
          env: Object.assign({}, process.env, {
            GIT_CONFIG_NOSYSTEM: '1',
            GIT_CONFIG_GLOBAL: nulDevice,
            GIT_CONFIG_SYSTEM: nulDevice,
          }),
        });
      }
      if (process.platform === 'win32') {
        cp.spawnSync('git', ['config', 'core.filemode', 'false'], {
          cwd: workerRoot,
          windowsHide: true,
          env: Object.assign({}, process.env, {
            GIT_CONFIG_NOSYSTEM: '1',
            GIT_CONFIG_GLOBAL: nulDevice,
            GIT_CONFIG_SYSTEM: nulDevice,
          }),
        });
      }

      // Provisioning must end with HEAD == requested base SHA exactly, verified with a hardened rev-parse;
      // any mismatch is a hard structured failure (PROVISION_BASE_MISMATCH) before the agent starts.
      const { withCleanGitEnv, safeGit } = require('./supervisor');
      let provisionedHeadSha = null;
      try {
        provisionedHeadSha = withCleanGitEnv(
          workerRoot,
          (safeGitDir) => {
            const curHeadRes = safeGit(
              safeGitDir,
              workerRoot,
              ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'],
              20000
            );
            if (curHeadRes && curHeadRes.status === 0 && curHeadRes.stdout) {
              return curHeadRes.stdout.trim();
            }
            return null;
          },
          { workerWritable: true }
        );
      } catch {
        provisionedHeadSha = null;
      }

      if (!provisionedHeadSha) {
        const revRes = (opts.spawnSync || cp.spawnSync)(
          'git',
          [
            '-c',
            'safe.directory=' + normWorkerRoot,
            '-c',
            'core.hooksPath=' + nulDevice,
            '-c',
            'core.fsmonitor=false',
            '-c',
            'core.attributesFile=' + nulDevice,
            'rev-parse',
            '--verify',
            '--quiet',
            'HEAD^{commit}',
          ],
          {
            cwd: workerRoot,
            encoding: 'utf8',
            windowsHide: true,
            env: Object.assign({}, process.env, {
              GIT_CONFIG_NOSYSTEM: '1',
              GIT_CONFIG_GLOBAL: nulDevice,
              GIT_CONFIG_SYSTEM: nulDevice,
            }),
          }
        );
        if (revRes && revRes.status === 0 && revRes.stdout) {
          provisionedHeadSha = revRes.stdout.trim();
        }
      }

      if (!provisionedHeadSha || provisionedHeadSha.toLowerCase() !== headSha.toLowerCase()) {
        const err = new Error(
          'PROVISION_BASE_MISMATCH: provisioned worker root HEAD (' +
            (provisionedHeadSha || 'unknown') +
            ') does not match requested base SHA ' +
            headSha
        );
        err.code = 'PROVISION_BASE_MISMATCH';
        throw err;
      }
    }

    if (adapter.id === 'opencode-direct') {
      const sourcesModule = require('./sources');
      const sources = require('./sources.json');
      const routerSource = sources.sources.find((s) => s.id === '9router');
      if (!routerSource) {
        throw new Error('OPENCODE_DIRECT_LAUNCH_FAILED: 9router source not found in sources.json');
      }

      // Extract pinned model id from args or options (the exact --model string opencode receives)
      const modelIdx = Array.isArray(args) ? args.indexOf('--model') : -1;
      const pinnedModel =
        modelIdx !== -1 && modelIdx + 1 < args.length
          ? args[modelIdx + 1]
          : (opts && opts.pinnedModel) || (opts && opts.model) || null;

      // Derive provider id directly from the exact --model string opencode receives
      const providerId =
        (pinnedModel && sourcesModule.providerFromPrefix(pinnedModel)) ||
        sourcesModule.providerFromPrefix(routerSource.modelPrefix) ||
        sourcesModule.providerFromPrefix(routerSource) ||
        routerSource.id;

      if (pinnedModel) {
        const derivedFromModel = sourcesModule.providerFromPrefix(pinnedModel);
        if (derivedFromModel && derivedFromModel !== providerId) {
          throw new Error(
            `OPENCODE_DIRECT_LAUNCH_FAILED: provider mismatch between model prefix '${derivedFromModel}' and provider '${providerId}'`
          );
        }
      }

      const modelsMap = {};
      if (pinnedModel) {
        modelsMap[pinnedModel] = { id: pinnedModel, name: pinnedModel };
        const prefixWithSlash = providerId + '/';
        if (pinnedModel.startsWith(prefixWithSlash)) {
          const relativeId = pinnedModel.slice(prefixWithSlash.length);
          if (relativeId) {
            modelsMap[relativeId] = { id: relativeId, name: relativeId };
          }
        }
      }

      const configPath = path.join(workerRoot, 'opencode.json');
      const configData = JSON.stringify({
        $schema: 'https://opencode.ai/config.json',
        provider: {
          [providerId]: {
            npm: '@ai-sdk/openai-compatible',
            name: routerSource.label || providerId,
            options: {
              baseURL: routerSource.endpoint,
              apiKey: `{env:${routerSource.credential.env}}`,
            },
            models: modelsMap,
          },
        },
      });
      fs.writeFileSync(configPath, configData, 'utf8');
      appendGitInfoExclude(workerRoot, ['opencode.json']);
    }

    let exerciseResult = null;
    if (opts.exercise) {
      exerciseResult = materialiseExercise(workerRoot, {
        exercise: opts.exercise,
        baseSha: headSha,
        spawnSync: opts.spawnSync,
        isWorkerPath: opts.isWorkerPath,
      });
      appendGitInfoExclude(workerRoot, ['tools/ai-brain/test/e1-branch-name.test.js']);
    }

    if (typeof opts.onProvisioned === 'function') {
      const hookRes = opts.onProvisioned(workerRoot, {
        baseSha: headSha,
        exercise: opts.exercise,
        exerciseResult,
        adapter,
        args,
      });
      if (hookRes && !exerciseResult) {
        exerciseResult = hookRes;
      }
    }

    // Final pre-launch check: verify HEAD has not moved from base SHA (or retained head) before agent starts
    const expectedActiveSha = retainWorkerHead || headSha;
    const { withCleanGitEnv, safeGit } = require('./supervisor');
    let preLaunchHead = null;
    try {
      preLaunchHead = withCleanGitEnv(
        workerRoot,
        (safeGitDir) => {
          const curHeadRes = safeGit(
            safeGitDir,
            workerRoot,
            ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'],
            20000
          );
          if (curHeadRes && curHeadRes.status === 0 && curHeadRes.stdout) {
            return curHeadRes.stdout.trim();
          }
          return null;
        },
        { workerWritable: true }
      );
    } catch {
      preLaunchHead = null;
    }
    if (!preLaunchHead) {
      const normWorker = path.resolve(workerRoot).replace(/\\/g, '/');
      const revRes = (opts.spawnSync || cp.spawnSync)(
        'git',
        [
          '-c',
          'safe.directory=' + normWorker,
          '-c',
          'core.hooksPath=' + nulDevice,
          '-c',
          'core.fsmonitor=false',
          '-c',
          'core.attributesFile=' + nulDevice,
          'rev-parse',
          '--verify',
          '--quiet',
          'HEAD^{commit}',
        ],
        {
          cwd: workerRoot,
          encoding: 'utf8',
          windowsHide: true,
          env: Object.assign({}, process.env, {
            GIT_CONFIG_NOSYSTEM: '1',
            GIT_CONFIG_GLOBAL: nulDevice,
            GIT_CONFIG_SYSTEM: nulDevice,
          }),
        }
      );
      if (revRes && revRes.status === 0 && revRes.stdout) {
        preLaunchHead = revRes.stdout.trim();
      }
    }
    if (!preLaunchHead || preLaunchHead.toLowerCase() !== expectedActiveSha.toLowerCase()) {
      const code = retainWorkerHead ? 'WORKER_HEAD_MISMATCH' : 'PROVISION_BASE_MISMATCH';
      const err = new Error(
        code +
          ': worker root HEAD before agent start (' +
          (preLaunchHead || 'unknown') +
          ') does not match requested SHA ' +
          expectedActiveSha
      );
      err.code = code;
      throw err;
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
    appendGitInfoExclude(workerRoot, [
      '.shipde/',
      'run-target.ps1',
      'run-target.complete.json',
      'temp/',
      '.config/',
      '.local/',
      'Microsoft/',
    ]);
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

    const launchResult = readLaunchResult(launchResultPath, completionNonce, hostRes);
    if (exerciseResult) {
      launchResult.exercise = exerciseResult;
      launchResult.failBefore = exerciseResult.failBefore;
    }
    return launchResult;
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
  appendGitInfoExclude,
  materialiseExercise,
  captureFailBefore,
  WORKER_USERNAME,
  WORKER_ROOT,
  readLaunchResult,
  EXPECTED_FIREWALL_RULES,
  DEFAULT_WORKER_TIMEOUT_MS,
};
