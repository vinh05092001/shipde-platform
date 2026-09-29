'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { executableFor } = require('./harness');
const crypto = require('crypto');

const WORKER_USERNAME = 'ShipDeWorker';
const DEFAULT_WORKER_TIMEOUT_MS = 30 * 60 * 1000;

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
  const sidRes = spawnSync(
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
  const res = spawnSync(
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
 */
function buildWorkerLaunchScript(options) {
  const credPath = options.credPath;
  const workerRoot = options.workerRoot;
  const workerUsername = options.workerUsername || WORKER_USERNAME;
  const exeFile = options.exeFile;
  const psArgs = options.psArgs;
  const launchResultPath = options.launchResultPath;
  const workerTimeoutMs = options.workerTimeoutMs;

  return `
$ErrorActionPreference = "Stop"
$sec = Get-Content "${credPath}" | ConvertTo-SecureString
$cred = New-Object System.Management.Automation.PSCredential("${workerUsername}", $sec)

$nestedScript = "${workerRoot}\\run-target.ps1"
@"
\`$env:HOME = "${workerRoot}"
\`$env:USERPROFILE = "${workerRoot}"
\`$env:GH_CONFIG_DIR = "${workerRoot}\\.config\\gh"
\`$env:GIT_CONFIG_GLOBAL = "${workerRoot}\\.gitconfig"
\`$env:TEMP = "${workerRoot}\\temp"
\`$env:TMP = "${workerRoot}\\temp"
if (-not (Test-Path "${workerRoot}\\temp")) { New-Item -ItemType Directory -Path "${workerRoot}\\temp" | Out-Null }
Set-Location -Path "${workerRoot}"
& "${exeFile}" ${psArgs}
"@ | Out-File $nestedScript -Encoding UTF8

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = "powershell.exe"
$psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -File \`"$nestedScript\`""
$psi.UserName = "${workerUsername}"
$psi.Password = $sec
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$psi.WorkingDirectory = "${workerRoot}"
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true

# Clear environment to avoid leaking operator tokens (F4)
$psi.EnvironmentVariables.Clear()
$allowed = @("PATH", "SystemRoot", "SystemDrive", "ALLUSERSPROFILE", "APPDATA", "LOCALAPPDATA", "ProgramData", "ProgramFiles", "ProgramFiles(x86)", "CommonProgramFiles", "CommonProgramFiles(x86)", "PUBLIC")
foreach ($key in $allowed) {
    if ([Environment]::GetEnvironmentVariable($key)) {
        $psi.EnvironmentVariables[$key] = [Environment]::GetEnvironmentVariable($key)
    }
}

$process = [System.Diagnostics.Process]::Start($psi)
$stdoutTask = $process.StandardOutput.ReadToEndAsync()
$stderrTask = $process.StandardError.ReadToEndAsync()
$timeoutMs = ${workerTimeoutMs}
$timedOut = -not $process.WaitForExit($timeoutMs)
if ($timedOut) {
    $process.Kill()
    $process.WaitForExit()
}
$stdout = $stdoutTask.Result
$stderr = $stderrTask.Result
if ($timedOut) {
    $stderr += "[ISOLATION_LAUNCHER] worker timed out after $timeoutMs ms and was killed"
}

$output = @{
    exitCode = $process.ExitCode
    stdout = $stdout
    stderr = $stderr
    timedOut = $timedOut
}
$output | ConvertTo-Json -Depth 10 | Out-File "${launchResultPath}" -Encoding UTF8
`;
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
    const workerRoot = `C:\\ShipDeWorker\\${jobName}`;

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

    // Provision worktree using clean clone at the reviewed SHA
    if (fs.existsSync(workerRoot)) {
      fs.rmSync(workerRoot, { recursive: true, force: true });
    }
    const headShaRes = spawnSync('git', ['rev-parse', 'HEAD'], {
      cwd: hostCwd,
      encoding: 'utf8',
      windowsHide: true,
    });
    const headSha = headShaRes.stdout.trim();
    if (headShaRes.status !== 0 || !headSha) throw new Error('Could not determine HEAD SHA');

    // Q5: --no-hardlinks — a local clone hardlinks .git/objects files to
    // the operator repo; the worker root is outside the operator profile and
    // the worker is granted Modify, so a hardlinked object could be
    // rewritten in place to corrupt the OPERATOR repo's objects.
    const cloneRes = spawnSync(
      'git',
      ['clone', '--no-checkout', '--no-hardlinks', hostCwd, workerRoot],
      {
        windowsHide: true,
      }
    );
    if (cloneRes.status !== 0) throw new Error('Failed to clone repository');

    const checkoutRes = spawnSync('git', ['checkout', headSha], {
      cwd: workerRoot,
      windowsHide: true,
    });
    if (checkoutRes.status !== 0) throw new Error('Failed to checkout HEAD SHA in worker root');

    const credPath = path.join(process.env.LOCALAPPDATA || '', 'ShipDe', 'WorkerUser.cred');

    const exe = executableFor(adapter.command, opts);
    const fullArgs = exe.prefixArgs.concat(args);

    const psArgs = fullArgs.map((a) => `'` + String(a).replace(/'/g, `''`) + `'`).join(', ');

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

    const scriptContent = buildWorkerLaunchScript({
      credPath,
      workerRoot,
      workerUsername: WORKER_USERNAME,
      exeFile: exe.file,
      psArgs,
      launchResultPath,
      workerTimeoutMs,
    });

    const tempScript = path.join(
      process.env.TEMP || 'C:\\temp',
      'isolated-launch-' + Date.now() + '.ps1'
    );
    fs.writeFileSync(tempScript, scriptContent, 'utf8');

    const hostRes = spawnSync(
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

    try {
      // Q6: read the result from the host-owned path, never from
      // worker-writable workerRoot.
      if (fs.existsSync(launchResultPath)) {
        const resJson = JSON.parse(fs.readFileSync(launchResultPath, 'utf8'));
        return {
          exitCode: resJson.exitCode,
          stdout: resJson.stdout,
          stderr: resJson.stderr,
          timedOut: Boolean(resJson.timedOut),
        };
      }
    } catch (e) {}

    return {
      exitCode: hostRes.status === null ? -1 : hostRes.status,
      stdout: hostRes.stdout || '',
      stderr: hostRes.stderr || 'Failed to read launch result',
      timedOut: hostRes.signal === 'SIGTERM',
    };
  };
}

module.exports = {
  getIsolatedLauncher,
  getFolderHash,
  defaultVerifyBoundary,
  buildBoundaryVerifyScript,
  buildWorkerLaunchScript,
  EXPECTED_FIREWALL_RULES,
  DEFAULT_WORKER_TIMEOUT_MS,
};
