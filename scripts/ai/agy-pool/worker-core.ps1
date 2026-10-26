<#
  worker.ps1 - chay DUOI user agyNN, do Scheduled Task \ShipDe\ShipDe-agyNN goi.
  Doc viec tu C:\Tools\agy-runs\agyNN\job.json ({ "cwd": "...", "prompt": "..." }),
  chay agy, ghi out.txt / err.txt / result.json vao cung thu muc.
  Khong doc, khong ghi token: agy tu lay dang nhap tu Credential Manager cua user nay.
#>
param(
  [Parameter(Mandatory)][string]$Name,
  # Same mailbox root the controller reads (agy-pool-runtime.js runsDir): the
  # scheduled task passes nothing and keeps the deployed C:\Tools layout.
  [string]$RunsDir = $(if ($env:AGY_POOL_RUNS_DIR) { $env:AGY_POOL_RUNS_DIR } else { 'C:\Tools\agy-runs' }),
  [string]$AgyExe = $(if ($env:AGY_POOL_AGY_EXE) { $env:AGY_POOL_AGY_EXE } else { 'C:\Tools\agy\agy.exe' })
)
$ErrorActionPreference = 'Continue'
$run = Join-Path $RunsDir $Name
$job = Get-Content (Join-Path $run 'job.json') -Raw | ConvertFrom-Json
# The controller stamps every job with its configured pool wait (printTimeoutSec);
# a job without one is refused rather than run against an invented limit.
$printTimeout = 0
if (-not [int]::TryParse([string]$job.printTimeoutSec, [ref]$printTimeout) -or $printTimeout -le 0) {
  $refused = [ordered]@{ name = $Name; state = 'error'; exitCode = 1; reason = 'NO_PRINT_TIMEOUT'; finishedAt = (Get-Date).ToString('o') }
  if ($job.jobId) { $refused.jobId = [string]$job.jobId }
  [IO.File]::WriteAllText((Join-Path $run 'result.json'), ($refused | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
  exit 1
}
$printTimeoutArg = "$($printTimeout)s"
$started = Get-Date
$cwd = if ($job.cwd -and (Test-Path $job.cwd)) { $job.cwd } else { $run }
# job.command = 'models' runs `agy models`: it lists the account's models (no model call,
# no quota spent) but prints no quota figures. Anything else runs job.prompt.
if ($job.command -eq 'models') { $agyArgs = @('models') }
elseif ($job.command -eq 'quota') { $agyArgs = @('-p', '/quota', '--output-format', 'json', '--print-timeout', $printTimeoutArg) }
else {
  # JSON output carries per-run token usage; an explicit model tells which quota group
  # (Gemini, or third-party Claude/GPT) the run drew from. agy's default is Gemini.
  $agyArgs = @('-p', ('"' + ($job.prompt -replace '"','\"') + '"'), '--output-format', 'json', '--print-timeout', $printTimeoutArg, '--dangerously-skip-permissions')
  if ($job.model) { $agyArgs += @('--model', [string]$job.model) }
}
$p = Start-Process -FilePath $AgyExe -ArgumentList $agyArgs `
  -WorkingDirectory $cwd -NoNewWindow -Wait -PassThru -RedirectStandardOutput (Join-Path $run 'out.txt') -RedirectStandardError (Join-Path $run 'err.txt')
$all = (Get-Content (Join-Path $run 'out.txt'),(Join-Path $run 'err.txt') -Raw -ErrorAction SilentlyContinue) -join "`n"
# agy's own JSON "status" decides success. Matching words in the text is only a fallback,
# and never the bare word "quota": /quota output and ordinary answers contain it, which
# marked healthy accounts as exhausted.
$agyStatus = $null
try { $agyStatus = [string]((Get-Content (Join-Path $run 'out.txt') -Raw) | ConvertFrom-Json).status } catch { }
$state = if ($all -match 'Authentication required|Please visit the URL to log in') { 'login-required' }
         elseif ($agyStatus -eq 'SUCCESS') { 'ok' }
         elseif ($all -match 'RESOURCE_EXHAUSTED|exhausted your quota|quota exceeded|\b429\b') { 'quota' }
         elseif ($p.ExitCode -eq 0 -and -not $agyStatus) { 'ok' } else { 'error' }
$resultRecord = [ordered]@{ name = $Name; state = $state; exitCode = $p.ExitCode; startedAt = $started.ToString('o'); user = $env:USERNAME }
# Echo the submitted job identity so the controller never takes a late prior run's
# result as the current job's output.
if ($job.jobId) { $resultRecord.jobId = [string]$job.jobId }

# Quota is tracked by observation: agy logs no remaining-credit figure, and reading the
# account token to ask Google directly is ruled out. One line per run; the dashboard
# counts runs in the last 5 h (the Pro window) and the controller reads quota hits.
# A reset time is taken from the refusal text when Google includes one.
$resetAt = $null
if ($state -eq 'quota') {
  if ($all -match '(?i)reset[s]?\s*(?:at|in)?\s*[:=]?\s*"?(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)') { $resetAt = $Matches[1] }
  elseif ($all -match '(?i)retry(?:-after| after| in)\s*[:=]?\s*(\d+)\s*(s|sec|seconds|m|min|minutes|h|hours)?') {
    $n = [int]$Matches[1]; $u = "$($Matches[2])".ToLower()
    $sec = if ($u -like 'h*') { $n * 3600 } elseif ($u -like 'm*') { $n * 60 } else { $n }
    $resetAt = (Get-Date).AddSeconds($sec).ToString('o')
  }
}
$model = if ($job.model) { [string]$job.model } else { 'default' }
$group = if ($model -match '(?i)claude|gpt') { 'external' } else { 'gemini' }
$tokens = $null
try { $j = (Get-Content (Join-Path $run 'out.txt') -Raw) | ConvertFrom-Json; if ($j.usage) { $tokens = [int]$j.usage.total_tokens } } catch { }
$entry = [ordered]@{ startedAt = $started.ToString('o'); finishedAt = (Get-Date).ToString('o'); state = $state; resetAt = $resetAt
  command = $(if ($job.command) { [string]$job.command } else { 'prompt' }); model = $model; group = $group; tokens = $tokens }
if ($job.command -ne 'quota') { Add-Content -Path (Join-Path $run 'runs.jsonl') -Value ($entry | ConvertTo-Json -Compress) -Encoding UTF8 }

# Remaining quota: `agy -p /quota --output-format json` returns the same figures the
# interactive /quota shows (per group, a 5-hour and a weekly bucket), spends no tokens,
# and needs no token handling here. Refreshed after every run so the page stays current.
function Save-Quota([string]$Text) {
  try { $q = $Text | ConvertFrom-Json } catch { return }
  $groups = @()
  foreach ($g in @($q.command.data.groups)) {
    if (-not $g) { continue }
    $gid = if ([string]$g.name -match '(?i)gemini') { 'gemini' } else { 'external' }
    $b5 = @($g.buckets | Where-Object { $_.window -eq '5h' })[0]
    $bw = @($g.buckets | Where-Object { $_.window -eq 'weekly' })[0]
    $groups += [ordered]@{ id = $gid; name = [string]$g.name; models = [string]$g.description
      fiveHour = [ordered]@{ remaining = $b5.remaining_fraction; resetAt = $b5.reset_time }
      weekly = [ordered]@{ remaining = $bw.remaining_fraction; resetAt = $bw.reset_time } }
  }
  if ($groups.Count -eq 0) { return }
  [ordered]@{ observedAt = (Get-Date).ToString('o'); groups = $groups } | ConvertTo-Json -Depth 5 |
    Set-Content (Join-Path $run 'quota.json') -Encoding UTF8
}
if ($job.command -eq 'quota') {
  Save-Quota (Get-Content (Join-Path $run 'out.txt') -Raw)
} elseif ($state -ne 'login-required') {
  $qOut = Join-Path $run 'quota-out.txt'
  Start-Process -FilePath $AgyExe -ArgumentList @('-p', '/quota', '--output-format', 'json', '--print-timeout', $printTimeoutArg) `
    -WorkingDirectory $cwd -NoNewWindow -Wait -RedirectStandardOutput $qOut -RedirectStandardError (Join-Path $run 'quota-err.txt') | Out-Null
  Save-Quota (Get-Content $qOut -Raw -ErrorAction SilentlyContinue)
}

# Agy keeps its Google OAuth credential in this Windows user's Credential Manager.
# After Agy itself has proven the credential works, decode only the ID-token claims
# in memory and persist the verified email. No token or credential blob is logged.
function Save-AuthenticatedIdentity {
  if ($state -ne 'ok') { return }
  if (-not ('ShipDeCredentialReader' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ShipDeCredentialReader {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL {
    public UInt32 Flags, Type; public IntPtr TargetName, Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public UInt32 CredentialBlobSize; public IntPtr CredentialBlob;
    public UInt32 Persist, AttributeCount; public IntPtr Attributes, TargetAlias, UserName;
  }
  [DllImport("advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool CredRead(string target, UInt32 type, UInt32 flags, out IntPtr credential);
  [DllImport("advapi32.dll", SetLastError=true)] public static extern void CredFree(IntPtr buffer);
}
'@
  }
  $ptr = [IntPtr]::Zero; $bytes = $null; $text = $null; $credential = $null; $idToken = $null
  try {
    if (-not [ShipDeCredentialReader]::CredRead('gemini:antigravity', 1, 0, [ref]$ptr)) { return }
    $cred = [Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [type][ShipDeCredentialReader+CREDENTIAL])
    $bytes = New-Object byte[] $cred.CredentialBlobSize
    [Runtime.InteropServices.Marshal]::Copy($cred.CredentialBlob, $bytes, 0, $bytes.Length)
    $text = [Text.Encoding]::UTF8.GetString($bytes).Trim([char]0)
    $credential = $text | ConvertFrom-Json
    $idToken = [string]$credential.id_token
    $parts = $idToken.Split('.')
    if ($parts.Count -ne 3) { return }
    $payloadText = $parts[1].Replace('-', '+').Replace('_', '/')
    while ($payloadText.Length % 4) { $payloadText += '=' }
    $claims = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payloadText)) | ConvertFrom-Json
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    if ([string]$claims.iss -notin @('accounts.google.com', 'https://accounts.google.com')) { return }
    if ([long]$claims.exp -le $now -or $claims.email_verified -ne $true) { return }
    $email = ([string]$claims.email).Trim()
    if ($email -notmatch '^[^\s@]+@[^\s@]+$' -or $email.Length -gt 254) { return }
    $identityPath = Join-Path $run 'identity.json'; $tmpIdentity = "$identityPath.tmp"
    [ordered]@{ label=$email; verifiedAt=[DateTimeOffset]::Now.ToString('o'); source='google-id-token' } |
      ConvertTo-Json | ForEach-Object { [IO.File]::WriteAllText($tmpIdentity, $_, (New-Object Text.UTF8Encoding($false))) }
    Move-Item -LiteralPath $tmpIdentity -Destination $identityPath -Force
  } catch { }
  finally {
    if ($bytes) { [Array]::Clear($bytes, 0, $bytes.Length) }
    $text=$null; $credential=$null; $idToken=$null; $claims=$null
    if ($ptr -ne [IntPtr]::Zero) { [ShipDeCredentialReader]::CredFree($ptr) }
  }
}
Save-AuthenticatedIdentity

# Per-task data is never resumed (dispatch.sh always starts a fresh run), and left
# alone it grew to ~2 GB in a few days on the operator's own profile (scratch 972 MB,
# brain 779 MB, log 211 MB, conversations 98 MB). Login lives in Credential Manager,
# not here, so wiping these keeps the account signed in. bin/, builtin/ and
# settings.json are kept.
$cli = Join-Path $env:USERPROFILE '.gemini\antigravity-cli'
foreach ($d in 'scratch','brain','log','conversations','implicit','annotations','knowledge','cache') {
  Remove-Item -LiteralPath (Join-Path $cli $d) -Recurse -Force -ErrorAction SilentlyContinue
}
Remove-Item -Path (Join-Path $cli 'history.jsonl'), (Join-Path $cli 'conversation_summaries.db*') -Force -ErrorAction SilentlyContinue

# Completion barrier: controllers wait for result.json, so publish it only after
# quota, identity and cleanup are fully committed. Write atomically to avoid reads
# of a partial JSON document.
$resultRecord.finishedAt = (Get-Date).ToString('o')
$resultTmp = Join-Path $run 'result.json.tmp'
[IO.File]::WriteAllText($resultTmp, ($resultRecord | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
Move-Item -LiteralPath $resultTmp -Destination (Join-Path $run 'result.json') -Force
