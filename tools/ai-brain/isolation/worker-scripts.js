'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');
const crypto = require('crypto');
const { executableFor } = require('../harness');
const {
  WORKER_USERNAME,
  WORKER_ROOT,
  DEFAULT_WORKER_TIMEOUT_MS,
  EXPECTED_FIREWALL_RULES,
  isWorkerConfigKeyAllowed,
  cleanGitEnv,
  isPathInside,
  workerGitPaths,
  gitConfigCheckTimeoutMs,
  validateConfigFile,
  validateWorkerGitConfig,
  resolveInstalledHook,
  controllerGit,
  hookedControllerGit,
  retargetSharedDepsWorkspaceLinks,
  retainedRootHasOwnWriterRecord,
  commitNativeWriterChanges,
  commitWorkerMetadata,
  isolationVerdictPath,
  stageContextPack,
  workerRootFor,
  isWorkerPath,
  readClosedIsolationVerdict,
  getFolderHash,
  isSecretFileName,
  queryWorkerSid,
} = require('./git-workspace');

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
  const exePrefixArgs = Array.isArray(options.exePrefixArgs) ? options.exePrefixArgs : [];
  const exePrefixArgsStr =
    exePrefixArgs.length > 0 ? exePrefixArgs.map((a) => `"${a}"`).join(' ') + ' ' : '';
  const payloadArgsPath = options.payloadArgsPath;
  const launchResultPath = options.launchResultPath;
  const workerTimeoutMs = options.workerTimeoutMs;
  const adapterId = options.adapterId;
  const isCodex = adapterId === 'codex';
  if (isCodex && (!options.isolationVerdict || options.isolationVerdict.verdict !== 'CLOSED')) {
    throw new Error('CODEX_REQUIRES_ISOLATION');
  }
  const completionNonce = options.completionNonce || crypto.randomBytes(16).toString('hex');
  const tokenBudget = options.tokenBudget || null;
  const markerPath = options.markerPath || path.join(workerRoot, 'run-target.complete.json');
  const usageLogPath =
    options.usageLogPath ||
    path.join(workerRoot, '.shipde', 'worker-output-' + completionNonce + '.log');
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
  const rtkPathPrepend = options.rtkPathPrepend || null;
  const codexLoginProbe = isCodex
    ? `if (-not (Test-Path -LiteralPath "${exeFile}")) {
  @{ nonce = "${completionNonce}"; exitCode = 1; completed = $true; localFailure = "CODEX_NOT_LOGGED_IN"; completedAt = (Get-Date).ToString('o') } | ConvertTo-Json -Depth 5 | Out-File "${markerPath}" -Encoding UTF8
  exit 0
}
& "${exeFile}" ${exePrefixArgsStr}login status *> \`$null
if (-not \`$?) {
  @{ nonce = "${completionNonce}"; exitCode = 1; completed = $true; localFailure = "CODEX_NOT_LOGGED_IN"; completedAt = (Get-Date).ToString('o') } | ConvertTo-Json -Depth 5 | Out-File "${markerPath}" -Encoding UTF8
  exit 0
}
if (\`$LASTEXITCODE -ne 0) {
  @{ nonce = "${completionNonce}"; exitCode = 1; completed = $true; localFailure = "CODEX_NOT_LOGGED_IN"; completedAt = (Get-Date).ToString('o') } | ConvertTo-Json -Depth 5 | Out-File "${markerPath}" -Encoding UTF8
  exit 0
}
`
    : '';

  const configuredNpmDir = options.workerNpmDir || options.npmDir || null;
  const workerNpmSnippet = configuredNpmDir
    ? `\`$workerNpm = "${configuredNpmDir.replace(/\\/g, '\\\\')}"
if (Test-Path \`$workerNpm) {
  \`$env:PATH = "\`$workerNpm;" + \`$env:PATH
}`
    : '';
  const psiNpmSnippet = configuredNpmDir
    ? `if (Test-Path "${configuredNpmDir.replace(/\\/g, '\\\\')}") {
    $psi.EnvironmentVariables["PATH"] = "${configuredNpmDir.replace(/\\/g, '\\\\')};" + $psi.EnvironmentVariables["PATH"]
}`
    : '';
  const configuredCodexHome = options.codexHome || `${workerRoot}\\.codex`;
  const codexHomeSnippet = configuredCodexHome
    ? `\`$workerCodexHome = "${configuredCodexHome.replace(/\\/g, '\\\\')}"
if (-not (Test-Path \`$workerCodexHome)) { New-Item -ItemType Directory -Path \`$workerCodexHome | Out-Null }
\`$env:CODEX_HOME = \`$workerCodexHome`
    : '';

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
    'pnpm_config_verify_deps_before_run',
  ];
  // DS-R04: add only the selected source's credential env to the allowlist
  if (options.adapterId === 'opencode-direct') {
    if (options.credentialEnv) {
      envAllowed.push(options.credentialEnv);
    }
    envAllowed.push('OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX');
  }
  const allowedArray = '@(' + envAllowed.map((k) => `"${k}"`).join(', ') + ')';

  const verdictJson = JSON.stringify(options.isolationVerdict || {});
  const verdictBase64 = Buffer.from(verdictJson, 'utf8').toString('base64');

  return `
$ErrorActionPreference = "Stop"
${credentialLines}$nestedScript = "${workerRoot}\\run-target.ps1"
$verdictBytes = [Convert]::FromBase64String("${verdictBase64}")
$env:SHIPDE_ISOLATION_VERDICT = [Text.Encoding]::UTF8.GetString($verdictBytes)
$markerPath = "${markerPath}"
$completionNonce = "${completionNonce}"
$usageLogPath = '${String(usageLogPath).replace(/'/g, "''")}'
$workerRoot = "${workerRoot}"
$env:HOME = "${workerRoot}"
$env:USERPROFILE = "${workerRoot}"
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
if (-not \`$env:OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX) { \`$env:OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX = "4096" }
\`$env:pnpm_config_verify_deps_before_run = "warn"
${workerNpmSnippet}
${codexHomeSnippet}
if (-not (Test-Path "${workerRoot}\\temp")) { New-Item -ItemType Directory -Path "${workerRoot}\\temp" | Out-Null }
if (-not (Test-Path "${workerRoot}\\.shipde")) { New-Item -ItemType Directory -Path "${workerRoot}\\.shipde" | Out-Null }
Set-Location -Path "${workerRoot}"
\`$env:SHIPDE_RUN_TARGET_PID = "\`$PID"
${codexLoginProbe}
\`$usageLogDir = [System.IO.Path]::GetDirectoryName("${usageLogPath.replace(/\\/g, '\\\\')}")
if (-not (Test-Path \`$usageLogDir)) { New-Item -ItemType Directory -Path \`$usageLogDir | Out-Null }
\`$payloadArgs = @(Get-Content -LiteralPath "${payloadArgsPath}" -Raw | ConvertFrom-Json)
& "${exeFile}" @payloadArgs | Tee-Object -FilePath "${usageLogPath.replace(/\\/g, '\\\\')}"
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
${psiNpmSnippet}
${rtkPathPrepend ? `$psi.EnvironmentVariables["PATH"] = "${rtkPathPrepend.replace(/\\/g, '\\\\')}" + ";" + $psi.EnvironmentVariables["PATH"]` : ''}

$process = [System.Diagnostics.Process]::Start($psi)
$wrapperPid = $process.Id
$wrapperStartTime = $process.StartTime
$usageFile = '${String(options.usageFile || '').replace(/'/g, "''")}'
$usageLogPath = '${String(usageLogPath).replace(/'/g, "''")}'
$usageModel = '${String(options.model || '').replace(/'/g, "''")}'
$usageProvider = '${String(options.upstream || '').replace(/'/g, "''")}'
$script:lastLiveUsageJson = ""
function Write-LiveUsage {
    if ([string]::IsNullOrWhiteSpace($usageFile)) { return }
    try {
        if (-not (Test-Path -LiteralPath $usageLogPath)) { return }
        $events = @(Get-Content -LiteralPath $usageLogPath -Tail 100 -ErrorAction Stop)
        $report = $null
        foreach ($line in $events) {
            try {
                $event = $line | ConvertFrom-Json
                $tokens = $event.tokens
                if ($null -eq $tokens -and $null -ne $event.part) { $tokens = $event.part.tokens }
                if ($null -eq $tokens) { continue }
                $inputTokens = [double]$tokens.input
                $outputTokens = [double]$tokens.output
                $totalTokens = [double]$tokens.total
                $cacheReadTokens = 0
                if ($null -ne $tokens.cache -and $null -ne $tokens.cache.read) {
                    $cacheReadTokens = [double]$tokens.cache.read
                } elseif ($null -ne $tokens.cache -and $null -ne $tokens.cache.read_tokens) {
                    $cacheReadTokens = [double]$tokens.cache.read_tokens
                } elseif ($null -ne $tokens.cacheRead) {
                    $cacheReadTokens = [double]$tokens.cacheRead
                } elseif ($null -ne $tokens.cache_read) {
                    $cacheReadTokens = [double]$tokens.cache_read
                } elseif ($null -ne $tokens.cache_read_tokens) {
                    $cacheReadTokens = [double]$tokens.cache_read_tokens
                }
                $accounted = $inputTokens + $cacheReadTokens + $outputTokens
                $effectiveTotal = [math]::Max($totalTokens, $accounted)
                $report = @{
                    session_id = $(if ($event.sessionID) { $event.sessionID } elseif ($event.sessionId) { $event.sessionId } else { $null })
                    model = $usageModel
                    provider = $usageProvider
                    usage = @{
                        input = $inputTokens
                        cacheRead = $cacheReadTokens
                        cache_read = $cacheReadTokens
                        cache_read_tokens = $cacheReadTokens
                        output = $outputTokens
                        total = $effectiveTotal
                    }
                } | ConvertTo-Json -Depth 5 -Compress
            } catch {}
        }
        if ($null -eq $report) { return }
        if ($script:lastLiveUsageJson -eq $report) { return }
        $script:lastLiveUsageJson = $report
        $temporary = $usageFile + '.live-' + $PID
        [System.IO.File]::WriteAllText($temporary, $report, [System.Text.UTF8Encoding]::new($false))
        Move-Item -LiteralPath $temporary -Destination $usageFile -Force
    } catch {}
}
$stdoutTask = $process.StandardOutput.ReadToEndAsync()
$stderrTask = $process.StandardError.ReadToEndAsync()
$timeoutMs = ${workerTimeoutMs}
$tokenBudgetJson = '${JSON.stringify(tokenBudget || {}).replace(/'/g, "''")}'
$maxTokens = 0
$progressTimeoutMs = ${Number(options.progressTimeoutMs) > 0 ? Number(options.progressTimeoutMs) : 0}
$lastProgressAt = [System.Diagnostics.Stopwatch]::GetTimestamp()
$lastTotalTokens = $null
$lastCumulativeTokens = 0
$lastToolCalls = 0
$lastOutputSignature = ""
try {
    $initFiles = @(Get-ChildItem -LiteralPath $workerRoot -File -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notmatch '[\\/](\.git|node_modules|\.shipde)[\\/]' } | Sort-Object FullName)
    if ($initFiles.Count -gt 0) { $lastOutputSignature = ($initFiles | ForEach-Object { $_.FullName + ':' + $_.Length + ':' + $_.LastWriteTimeUtc.Ticks }) -join '|' }
} catch {}
$requestTooLarge = $false
$requestTooLargeDetail = ""
try {
    $budgetConfig = $tokenBudgetJson | ConvertFrom-Json
    if ($null -ne $budgetConfig.maxTokens) { $maxTokens = [double]$budgetConfig.maxTokens }
} catch {}
$budgetExceeded = $false

function Stop-WorkerTree {
    $stragglers = @(Get-DescendantProcessIds -AncestorPid $wrapperPid -NotBefore $wrapperStartTime.AddSeconds(-2))
    foreach ($stragglerId in $stragglers) { Stop-Process -Id $stragglerId -Force -ErrorAction SilentlyContinue }
    if (-not $process.HasExited) { try { $process.Kill() } catch {} }
    try { & cmd.exe /c "taskkill /PID $wrapperPid /T /F >nul 2>&1" } catch {}
    [void]$process.WaitForExit(10000)
}

# Every process the wrapper started, walked up the parent chain. A process
# that predates the launch is never a descendant even if a recycled pid makes
# it look like one.
function Get-DescendantProcessIds {
    param([int]$AncestorPid, [datetime]$NotBefore)
    $rows = @(Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, CreationDate, Name -ErrorAction SilentlyContinue)
    $children = @{}
    $created = @{}
    foreach ($row in $rows) {
        if ($row.Name -ieq "conhost.exe") { continue }
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

function Read-UsageTotal {
    if ([string]::IsNullOrWhiteSpace($usageFile) -or -not (Test-Path -LiteralPath $usageFile)) { return $null }
    try {
        $report = Get-Content -LiteralPath $usageFile -Raw | ConvertFrom-Json
        $usage = $report.usage
        if ($null -eq $usage) { return $null }
        $reportedTotal = $null
        if ($null -ne $usage.total_tokens) { $reportedTotal = [double]$usage.total_tokens }
        elseif ($null -ne $usage.total) { $reportedTotal = [double]$usage.total }
        if ($null -ne $usage.input_tokens -or $null -ne $usage.cache_read_tokens -or $null -ne $usage.output_tokens) {
            $accounted = [double]$usage.input_tokens + [double]$usage.cache_read_tokens + [double]$usage.output_tokens
            if ($null -ne $reportedTotal) { return [math]::Max($reportedTotal, $accounted) }
            return $accounted
        }
        if ($null -ne $usage.input -or $null -ne $usage.cacheRead -or $null -ne $usage.cache_read -or $null -ne $usage.output) {
            $cacheRead = $usage.cacheRead
            if ($null -eq $cacheRead) { $cacheRead = $usage.cache_read }
            $accounted = [double]$usage.input + [double]$cacheRead + [double]$usage.output
            if ($null -ne $reportedTotal) { return [math]::Max($reportedTotal, $accounted) }
            return $accounted
        }
        if ($null -ne $reportedTotal) { return $reportedTotal }
    } catch {}
    return $null
}

function Update-SessionProgress {
    if ($script:requestTooLarge) { return }
    $script:sessionToolCalls = 0
    $script:sessionCumTokens = 0
    $script:sessionMonotonic = $true
    if ([string]::IsNullOrWhiteSpace($usageLogPath) -or -not (Test-Path -LiteralPath $usageLogPath)) { return }
    try {
        $lines = @()
        $readOk = $false
        try {
            $fs = [System.IO.File]::Open($usageLogPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
            try {
                $sr = New-Object System.IO.StreamReader($fs, [System.Text.Encoding]::UTF8)
                try {
                    $rawContent = $sr.ReadToEnd()
                    if (-not [string]::IsNullOrEmpty($rawContent)) {
                        $lines = @($rawContent -split '\r?\n')
                    }
                    $readOk = $true
                } finally {
                    $sr.Dispose()
                }
            } finally {
                $fs.Dispose()
            }
        } catch {}
        if (-not $readOk) {
            $lines = @(Get-Content -LiteralPath $usageLogPath -ErrorAction SilentlyContinue)
        }
        if ($lines.Count -eq 0) { return }
        $toolCount = 0
        $sumTokens = 0
        $prevStepTokens = $null
        $hasFluctuated = $false
        $found413 = $false
        $detail413 = ""
        foreach ($line in $lines) {
            $trimmed = $line.Trim()
            if ([string]::IsNullOrWhiteSpace($trimmed)) { continue }
            $is413 = $false
            $matchText = ""
            $skipRaw413 = $false
            if ($trimmed.StartsWith('{') -and $trimmed.EndsWith('}')) {
                try {
                    $ev = $trimmed | ConvertFrom-Json
                    if ($null -ne $ev) {
                        if ($ev.type -eq "tool_use" -or ($null -ne $ev.part -and $ev.part.type -eq "tool") -or
                            ($ev.type -eq "item.completed" -and $null -ne $ev.item -and
                             $ev.item.type -eq "command_execution" -and $ev.item.status -eq "completed" -and
                             $null -ne $ev.item.exit_code -and $ev.item.exit_code -eq 0)) {
                            $toolCount++
                        }
                        $err = $null
                        if ($ev.type -eq "error" -and $null -ne $ev.error) { $err = $ev.error }
                        elseif ($null -ne $ev.error) { $err = $ev.error }
                        # A structured event without an error field is worker content (tool input/output,
                        # model text); a branch name or log line inside it must not read as an HTTP 413.
                        if ($null -eq $err -and $ev.type -ne "error") { $skipRaw413 = $true }
                        if ($null -ne $err) {
                            $code = $null
                            if ($null -ne $err.data -and $null -ne $err.data.statusCode) { $code = [int]$err.data.statusCode }
                            elseif ($null -ne $err.statusCode) { $code = [int]$err.statusCode }
                            elseif ($null -ne $err.status) { $code = [int]$err.status }

                            $msg = ""
                            if ($null -ne $err.data -and $null -ne $err.data.message) { $msg = [string]$err.data.message }
                            elseif ($null -ne $err.message) { $msg = [string]$err.message }
                            if ($null -ne $err.data -and $null -ne $err.data.responseBody) {
                                $msg = $msg + " " + [string]$err.data.responseBody
                            }
                            if ($code -eq 413 -or $msg -match '(?i)\b413\b|request.*too.*large|payload.*too.*large|entity.*too.*large|too.*large.*request|tokens?.*per.*minute|\bTPM\b.*limit|limit.*on.*TPM') {
                                $is413 = $true
                                $matchText = if ($msg) { $msg } else { "HTTP status 413" }
                            }
                        }
                        if (-not $is413 -and $ev.type -ne "error" -and $null -eq $ev.error) {
                            $t = $ev.tokens
                            if ($null -eq $t -and $null -ne $ev.part) { $t = $ev.part.tokens }
                            if ($null -ne $t) {
                                $in = [double]$t.input
                                $out = [double]$t.output
                                $tot = [double]$t.total
                                $cr = 0
                                if ($null -ne $t.cache -and $null -ne $t.cache.read) { $cr = [double]$t.cache.read }
                                elseif ($null -ne $t.cache -and $null -ne $t.cache.read_tokens) { $cr = [double]$t.cache.read_tokens }
                                elseif ($null -ne $t.cacheRead) { $cr = [double]$t.cacheRead }
                                elseif ($null -ne $t.cache_read) { $cr = [double]$t.cache_read }
                                elseif ($null -ne $t.cache_read_tokens) { $cr = [double]$t.cache_read_tokens }
                                $stepEffective = [math]::Max($tot, $in + $cr + $out)
                                if ($null -ne $prevStepTokens -and $stepEffective -lt $prevStepTokens) {
                                    $hasFluctuated = $true
                                }
                                $prevStepTokens = $stepEffective
                                $sumTokens += $stepEffective
                            }
                        }
                    }
                } catch {}
            }
            if (-not $is413 -and -not $skipRaw413) {
                if ($trimmed -match '(?i)\b413\b.*(?:request|payload|entity|too\s+large|tpm)|(?:request|payload|entity)\s+(?:is\s+)?too\s+large|\b413\s+Request|\b413\s+Payload|rate\s+limit.*tokens?\s+per\s+minute|\bTPM\b.*limit|limit.*on.*TPM') {
                    $is413 = $true
                    $matchText = $trimmed
                }
            }
            if ($is413) {
                $found413 = $true
                $detail413 = $matchText
            }
        }
        if ($found413) {
            $script:requestTooLarge = $true
            $script:requestTooLargeDetail = if ($detail413.Length -gt 250) { $detail413.Substring(0, 250) } else { $detail413 }
        }
        $script:sessionToolCalls = $toolCount
        $script:sessionCumTokens = $sumTokens
        $script:sessionMonotonic = (-not $hasFluctuated)
    } catch {}
}

# The wrapper is waited on with the bounded wait, then every process it
# started is polled until none remain, all inside the same budget. Waiting for
# the wrapper alone is not enough: a job the wrapper no longer waits for would
# otherwise be reported as finished while it is still running.
$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
$timedOut = $false
$stalled = $false
$progressDetail = ""
$waitSlice = 250
while ($true) {
    Write-LiveUsage
    $totalTokens = Read-UsageTotal
    if ($null -ne $totalTokens -and $maxTokens -gt 0 -and $totalTokens -gt $maxTokens) {
        $budgetExceeded = $true
        Stop-WorkerTree
        break
    }
    Update-SessionProgress
    if ($script:requestTooLarge) {
        Stop-WorkerTree
        break
    }
    if ($progressTimeoutMs -gt 0) {
        $outputSignature = ""
        try {
            $outputFiles = @(Get-ChildItem -LiteralPath $workerRoot -File -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notmatch '[\\/](\.git|node_modules|\.shipde)[\\/]' } | Sort-Object FullName)
            if ($outputFiles.Count -gt 0) { $outputSignature = ($outputFiles | ForEach-Object { $_.FullName + ':' + $_.Length + ':' + $_.LastWriteTimeUtc.Ticks }) -join '|' }
        } catch {}
        $madeProgress = $false
        if ($outputSignature -ne $lastOutputSignature) {
            $lastOutputSignature = $outputSignature
            $madeProgress = $true
        }
        if ($script:sessionToolCalls -gt $lastToolCalls) {
            $lastToolCalls = $script:sessionToolCalls
            $madeProgress = $true
        }
        if ($script:sessionMonotonic -and $script:sessionCumTokens -gt $lastCumulativeTokens) {
            $lastCumulativeTokens = $script:sessionCumTokens
            $madeProgress = $true
        }
        if ($madeProgress) {
            $lastProgressAt = [System.Diagnostics.Stopwatch]::GetTimestamp()
        } elseif (([System.Diagnostics.Stopwatch]::GetTimestamp() - $lastProgressAt) * 1000 / [System.Diagnostics.Stopwatch]::Frequency -ge $progressTimeoutMs) {
            $stalled = $true
            $fileCount = $outputFiles.Count
            $usageState = if ($null -eq $totalTokens) { "unavailable" } else { [string]$totalTokens }
            $progressDetail = "stall detector observed no worker file signature change ($fileCount tracked files), no verified tool progress ($lastToolCalls tool calls), and no monotonic token usage increase (usage=$usageState) for $progressTimeoutMs ms"
            Stop-WorkerTree
            break
        }
    }
    $remaining = $timeoutMs - $stopwatch.ElapsedMilliseconds
    if ($remaining -le 0) { $timedOut = $true; break }
    if ($process.HasExited) { break }
    [void]$process.WaitForExit([math]::Min($waitSlice, $remaining))
}
$quietPolls = 0
if (-not $timedOut -and -not $stalled -and -not $budgetExceeded -and -not $requestTooLarge) {
    while ($true) {
        Write-LiveUsage
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
        $totalTokens = Read-UsageTotal
        if ($null -ne $totalTokens -and $maxTokens -gt 0 -and $totalTokens -gt $maxTokens) {
            $budgetExceeded = $true
            Stop-WorkerTree
            break
        }
        Update-SessionProgress
        if ($script:requestTooLarge) {
            Stop-WorkerTree
            break
        }
        if ($quietPolls -ge 3) { break }
        Start-Sleep -Milliseconds 250
    }
}

if ($timedOut) {
    Stop-WorkerTree
}
if ($stalled) { Stop-WorkerTree }
if ($script:requestTooLarge) { Stop-WorkerTree }
# A writer the operator cannot kill (another user's process) must not hang the
# host forever: the pipes are read with a bound, and a pipe that never closed
# is itself reported as a failure.
$stdout = ""
$stderr = ""
if ($stdoutTask.Wait(15000)) { $stdout = $stdoutTask.Result }
if ($stderrTask.Wait(15000)) { $stderr = $stderrTask.Result } else { $stderr = "[ISOLATION_LAUNCHER] worker output pipes never closed" }

if (-not $script:requestTooLarge) {
    Update-SessionProgress
    if (-not $script:requestTooLarge) {
        # Structured JSON events (tool calls, model text) are worker content, not transport errors.
        $combinedLines = @([regex]::Split(($stdout + [Environment]::NewLine + $stderr), '\\r?\\n') | Where-Object {
            -not ($_.TrimStart().StartsWith('{"type":"') -and -not $_.TrimStart().StartsWith('{"type":"error"'))
        })
        $combined = $combinedLines -join [Environment]::NewLine
        if ($combined -match '(?i)\b413\b.*(?:request|payload|entity|too\s+large|tpm)|(?:request|payload|entity)\s+(?:is\s+)?too\s+large|\b413\s+Request|\b413\s+Payload|rate\s+limit.*tokens?\s+per\s+minute|\bTPM\b.*limit|limit.*on.*TPM') {
            $script:requestTooLarge = $true
            $script:requestTooLargeDetail = "worker output indicated 413 / request too large / TPM limit"
        }
    }
}

# Positive evidence: the marker is written by run-target.ps1 after the payload
# returned, so it can only exist for a job that really ran to its end.
$completed = $false
$markerNonce = ""
$jobExit = -1
$failureReason = ""
$localFailure = ""
if ($budgetExceeded) {
    $failureReason = "TOKEN_BUDGET_EXCEEDED: live worker usage exceeded configured token budget"
} elseif ($timedOut) {
    $failureReason = "[ISOLATION_LAUNCHER] worker timed out after $timeoutMs ms and was killed"
} elseif ($script:requestTooLarge) {
    $failureReason = "REQUEST_TOO_LARGE: $script:requestTooLargeDetail; worker was killed"
} elseif ($stalled) {
    $failureReason = "STALLED_NO_PROGRESS: $progressDetail; worker was killed"
} elseif (Test-Path -LiteralPath $markerPath) {
    try {
        $marker = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json
        if ([string]$marker.nonce -ceq $completionNonce -and $null -ne $marker.exitCode) {
            $completed = $true
            $markerNonce = [string]$marker.nonce
            $jobExit = [int]$marker.exitCode
            if ($null -ne $marker.localFailure) { $localFailure = [string]$marker.localFailure }
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
if ($completed -and -not $timedOut -and -not $budgetExceeded -and -not $script:requestTooLarge) { $exitValue = $jobExit }
if ($failureReason.Length -gt 0) { $stderr = $stderr + [Environment]::NewLine + $failureReason }

Update-SessionProgress
$output = @{
    verifiedToolCalls = $script:sessionToolCalls
    exitCode = $exitValue
    stdout = $stdout
    stderr = $stderr
    timedOut = $timedOut
    budgetExceeded = $budgetExceeded
    requestTooLarge = $script:requestTooLarge
    completed = $completed
    completionNonce = $markerNonce
    failureReason = $failureReason
    progressDetail = $progressDetail
    localFailure = $localFailure
}
$output | ConvertTo-Json -Depth 10 | Out-File "${launchResultPath}" -Encoding UTF8
`;
}

module.exports = {
  buildBoundaryVerifyScript,
  defaultVerifyBoundary,
  buildWorkerLaunchScript,
};
