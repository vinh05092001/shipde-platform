Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

function Assert-ShipDeCommand {
    param([Parameter(Mandatory = $true)][string]$Name)

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Missing required command: $Name"
    }
}

function Get-ShipDeCanonicalAoExecutablePath {
    param(
        [string]$ProgramFilesRoot = $null
    )

    $roots = @()
    if (-not [string]::IsNullOrWhiteSpace($ProgramFilesRoot)) {
        $roots += $ProgramFilesRoot
    } else {
        foreach ($environmentName in @("ProgramW6432", "ProgramFiles")) {
            $environmentValue = [Environment]::GetEnvironmentVariable($environmentName)
            if (-not [string]::IsNullOrWhiteSpace($environmentValue) -and $roots -notcontains $environmentValue) {
                $roots += $environmentValue
            }
        }
    }

    foreach ($root in $roots) {
        $candidate = [System.IO.Path]::Combine($root, "agent-orchestrator", "resources", "daemon", "ao.exe")
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return (Get-Item -LiteralPath $candidate).FullName
        }
    }
    return $null
}

function Resolve-ShipDeAoExecutable {
    param(
        [scriptblock]$CommandResolver = { Get-Command "ao" -CommandType Application -ErrorAction SilentlyContinue },
        [string]$ProgramFilesRoot = $null
    )

    $command = & $CommandResolver
    if ($null -ne $command) {
        $commandPath = @(
            $command | ForEach-Object {
                foreach ($propertyName in @("Path", "Source", "Definition")) {
                    $property = $_.PSObject.Properties[$propertyName]
                    if ($property -and -not [string]::IsNullOrWhiteSpace([string]$property.Value)) {
                        [string]$property.Value
                        break
                    }
                }
            }
        ) | Select-Object -First 1
        if (-not [string]::IsNullOrWhiteSpace([string]$commandPath)) {
            return [string]$commandPath
        }
    }

    $canonicalPath = Get-ShipDeCanonicalAoExecutablePath -ProgramFilesRoot $ProgramFilesRoot
    if (-not [string]::IsNullOrWhiteSpace($canonicalPath)) {
        return $canonicalPath
    }

    throw "Missing required command: ao. The canonical Windows desktop executable was not found at C:\Program Files\agent-orchestrator\resources\daemon\ao.exe."
}

function Get-ShipDePinnedAoVersion {
    param(
        [string]$ManifestPath = $null
    )

    if ([string]::IsNullOrWhiteSpace($ManifestPath)) {
        $ManifestPath = Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) "tools\ecosystem-manifest.json"
    }
    if (-not (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) {
        throw "Ecosystem manifest not found: $ManifestPath"
    }

    try {
        $manifest = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    } catch {
        throw "Failed to parse ecosystem manifest as JSON: $ManifestPath"
    }

    $runtime = $manifest.orchestrator_runtime
    if ($null -eq $runtime) {
        throw "Ecosystem manifest is missing orchestrator_runtime section: $ManifestPath"
    }
    $pinned = [string]$runtime.pinned_version_or_commit
    if ([string]::IsNullOrWhiteSpace($pinned) -or $pinned -notmatch '^\d+\.\d+\.\d+$') {
        throw "Ecosystem manifest has invalid or missing pinned_version_or_commit for orchestrator_runtime: '$pinned'. Must be an exact semantic version without ranges."
    }

    return $pinned
}

function Invoke-ShipDeNativeProcess {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$ArgumentList = @(),
        [string]$WorkingDirectory = $null,
        [int]$TimeoutMilliseconds = 30000,
        [string]$StandardInput = $null
    )

    $psi = [System.Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = $FilePath
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    if ($null -ne $StandardInput) {
        $psi.RedirectStandardInput = $true
    }
    if (-not [string]::IsNullOrWhiteSpace($WorkingDirectory)) {
        $psi.WorkingDirectory = $WorkingDirectory
    }

    $argListProp = [System.Diagnostics.ProcessStartInfo].GetProperty("ArgumentList")
    if ($null -ne $argListProp) {
        $argCollection = $argListProp.GetValue($psi, $null)
        foreach ($arg in $ArgumentList) {
            if ($null -ne $arg) {
                [void]$argCollection.Add([string]$arg)
            }
        }
    } else {
        $formattedArgs = [System.Collections.Generic.List[string]]::new()
        foreach ($arg in $ArgumentList) {
            if ($null -eq $arg) { continue }
            $str = [string]$arg
            if ($str -match '[\s"]') {
                $escaped = $str -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1'
                $formattedArgs.Add("`"$escaped`"")
            } else {
                $formattedArgs.Add($str)
            }
        }
        $psi.Arguments = ($formattedArgs -join " ")
    }

    $proc = [System.Diagnostics.Process]::new()
    $proc.StartInfo = $psi

    $started = $false
    try {
        $started = $proc.Start()
    } catch {
        return [PSCustomObject]@{
            ExitCode = 1
            Stdout = ""
            Stderr = "Failed to start process '$FilePath': $($_.Exception.Message)"
        }
    }
    if (-not $started) {
        return [PSCustomObject]@{
            ExitCode = 1
            Stdout = ""
            Stderr = "Failed to start process '$FilePath'."
        }
    }

    if ($null -ne $StandardInput) {
        $proc.StandardInput.Write($StandardInput)
        $proc.StandardInput.Close()
    }

    $stdoutTask = $proc.StandardOutput.ReadToEndAsync()
    $stderrTask = $proc.StandardError.ReadToEndAsync()

    if ($TimeoutMilliseconds -gt 0) {
        $exited = $proc.WaitForExit($TimeoutMilliseconds)
        if (-not $exited) {
            try { $proc.Kill() } catch {}
            return [PSCustomObject]@{
                ExitCode = 1
                Stdout = ""
                Stderr = "Process '$FilePath' timed out after $TimeoutMilliseconds ms."
            }
        }
    } else {
        $proc.WaitForExit()
    }

    $stdout = $stdoutTask.GetAwaiter().GetResult()
    $stderr = $stderrTask.GetAwaiter().GetResult()

    return [PSCustomObject]@{
        ExitCode = [int]$proc.ExitCode
        Stdout = if ($null -ne $stdout) { $stdout } else { "" }
        Stderr = if ($null -ne $stderr) { $stderr } else { "" }
    }
}

function Get-ShipDeAoVersionProbe {
    param([Parameter(Mandatory = $true)][string]$AoExecutable)

    $res = Invoke-ShipDeNativeProcess -FilePath $AoExecutable -ArgumentList @("version")
    $text = if (-not [string]::IsNullOrWhiteSpace($res.Stdout)) { $res.Stdout.Trim() } else { $res.Stderr.Trim() }
    return [PSCustomObject]@{
        Text = $text
        ExitCode = $res.ExitCode
    }
}

function Assert-ShipDeAoVersionEvidence {
    param(
        [Parameter(Mandatory = $true)][string]$AoExecutable,
        [Parameter(Mandatory = $true)][string]$ExpectedVersion,
        [AllowEmptyString()][string]$VersionText = $null,
        [int]$VersionExitCode = 0,
        [string]$ProgramFilesRoot = $null,
        [scriptblock]$ProductVersionReader = $null
    )

    if ([string]::IsNullOrWhiteSpace($ExpectedVersion) -or $ExpectedVersion -notmatch '^\d+\.\d+\.\d+$') {
        throw "Expected AO version must be an exact semantic version without ranges: '$ExpectedVersion'"
    }

    if (-not $PSBoundParameters.ContainsKey('VersionText')) {
        $probe = Get-ShipDeAoVersionProbe -AoExecutable $AoExecutable
        $VersionText = $probe.Text
        $VersionExitCode = $probe.ExitCode
    }
    if ($VersionExitCode -ne 0) {
        throw "Cannot determine AO version: $VersionText"
    }

    $trimmedLines = @(
        $VersionText -split "`r?`n" |
            ForEach-Object { $_.Trim() } |
            Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    )
    if ($trimmedLines.Count -eq 0) {
        throw "AO version '$VersionText' is missing or unverifiable."
    }
    $prefixedLines = @($trimmedLines | Where-Object { $_ -match '(?i)^\s*ao\s+version(?:\s|$)' })
    $versionLines = if ($prefixedLines.Count -gt 0) { $prefixedLines } else { $trimmedLines }
    $versionMetadataText = $versionLines -join [Environment]::NewLine

    $semanticPattern = '(?<![0-9A-Za-z])v?(?<version>\d+\.\d+\.\d+(?:\+[0-9A-Za-z.-]+)?)(?![0-9A-Za-z])'
    $semanticVersions = @(
        [regex]::Matches($versionMetadataText, $semanticPattern) |
            ForEach-Object { $_.Groups["version"].Value } |
            Select-Object -Unique
    )
    if ($semanticVersions.Count -gt 1) {
        throw "AO returned ambiguous semantic build metadata '$versionMetadataText'."
    }
    if ($semanticVersions.Count -eq 1) {
        $semanticVersion = [string]$semanticVersions[0]
        $semanticCore = ($semanticVersion -split '\+', 2)[0]
        if ($semanticCore -ne $ExpectedVersion) {
            throw "AO version '$semanticVersion' does not match pinned version $ExpectedVersion."
        }
        return [PSCustomObject]@{
            EffectiveVersion = $ExpectedVersion
            ReportedVersion = $semanticVersion
            BinaryVersion = $null
            Source = "semantic-build-metadata"
            Executable = $AoExecutable
        }
    }

    if ($versionMetadataText -notmatch '(?i)(?<![0-9A-Za-z-])dev(?![0-9A-Za-z-])') {
        throw "AO version '$versionMetadataText' is missing or unverifiable."
    }

    $canonicalPath = Get-ShipDeCanonicalAoExecutablePath -ProgramFilesRoot $ProgramFilesRoot
    if ([string]::IsNullOrWhiteSpace($canonicalPath) -or
        -not [string]::Equals($canonicalPath, $AoExecutable, [StringComparison]::OrdinalIgnoreCase)) {
        throw "AO reported dev from a non-canonical executable; its pinned version is unverifiable."
    }

    if ($null -ne $ProductVersionReader) {
        $productVersion = [string](& $ProductVersionReader $AoExecutable)
    } else {
        try {
            $productVersion = [string](Get-Item -LiteralPath $AoExecutable -ErrorAction Stop).VersionInfo.ProductVersion
            if ([string]::IsNullOrWhiteSpace($productVersion)) {
                $desktopExe = Join-Path (Split-Path (Split-Path (Split-Path $AoExecutable -Parent) -Parent) -Parent) "agent-orchestrator.exe"
                if (Test-Path -LiteralPath $desktopExe -PathType Leaf) {
                    $productVersion = [string](Get-Item -LiteralPath $desktopExe -ErrorAction Stop).VersionInfo.ProductVersion
                }
            }
        } catch {
            throw "AO ProductVersion could not be read from canonical executable '$AoExecutable'."
        }
    }
    if ([string]::IsNullOrWhiteSpace($productVersion) -or $productVersion -notmatch '^\d+\.\d+\.\d+$') {
        throw "AO ProductVersion '$productVersion' is missing or malformed; expected exact pinned version $ExpectedVersion."
    }
    if ($productVersion -cne $ExpectedVersion) {
        throw "AO ProductVersion '$productVersion' does not match pinned version $ExpectedVersion."
    }

    return [PSCustomObject]@{
        EffectiveVersion = $ExpectedVersion
        ReportedVersion = "dev"
        BinaryVersion = $productVersion
        Source = "windows-product-version"
        Executable = $AoExecutable
    }
}

function Get-ShipDeTempDir {
    if (-not [string]::IsNullOrWhiteSpace($env:TEMP) -and (Test-Path -LiteralPath $env:TEMP)) {
        return $env:TEMP
    }
    return [System.IO.Path]::GetTempPath()
}

function Get-ShipDeUserHome {
    if (-not [string]::IsNullOrWhiteSpace($env:USERPROFILE)) {
        return $env:USERPROFILE
    }
    if (-not [string]::IsNullOrWhiteSpace($env:HOME)) {
        return $env:HOME
    }
    return [System.IO.Path]::GetTempPath()
}

function Get-ShipDeAoWorktreesDir {
    param([string]$Project = "")

    $userHome = Get-ShipDeUserHome
    $base = Join-Path (Join-Path (Join-Path $userHome ".ao") "data") "worktrees"
    if (-not [string]::IsNullOrWhiteSpace($Project)) {
        return (Join-Path $base $Project)
    }
    return $base
}

function Get-ShipDePaths {
    param([string]$AiRoot = $(
        $userHome = Get-ShipDeUserHome
        Join-Path $userHome "AI"
    ))

    return [ordered]@{
        Main   = Join-Path $AiRoot "shipde-platform"
        Claude = Join-Path $AiRoot "shipde-claude"
        Dsh    = Join-Path $AiRoot "shipde-dsh"
        Gemini = Join-Path $AiRoot "shipde-gemini"
        Codex  = Join-Path $AiRoot "shipde-codex"
    }
}

function Invoke-ShipDeGit {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [switch]$AllowFailure
    )

    & git -C $Path @Arguments
    $exitCode = $LASTEXITCODE
    if (-not $AllowFailure -and $exitCode -ne 0) {
        throw "Git command failed in ${Path}: git $($Arguments -join ' ')"
    }
    return $exitCode
}

function Assert-ShipDeRepository {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path (Join-Path $Path ".git"))) {
        throw "Not a Git worktree: $Path"
    }
}

function Assert-ShipDeClean {
    param([Parameter(Mandatory = $true)][string]$Path)

    $status = @(& git -C $Path status --porcelain)
    if ($LASTEXITCODE -ne 0) {
        throw "Cannot read Git status: $Path"
    }
    if ($status.Count -gt 0) {
        throw "Worktree is dirty; inspect it without reset: $Path"
    }
}

function Test-ShipDeTcpPort {
    param(
        [Parameter(Mandatory = $true)][string]$HostName,
        [Parameter(Mandatory = $true)][int]$Port,
        [int]$TimeoutMs = 1500
    )

    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        $async = $client.BeginConnect($HostName, $Port, $null, $null)
        if (-not $async.AsyncWaitHandle.WaitOne($TimeoutMs)) {
            return $false
        }
        $client.EndConnect($async)
        return $true
    } catch {
        return $false
    } finally {
        $client.Dispose()
    }
}

function Get-ShipDeObjectProperty {
    param(
        [AllowNull()][object]$Object,
        [Parameter(Mandatory = $true)][string[]]$Names
    )
    if ($null -eq $Object) {
        return $null
    }
    if ($Object -is [System.Collections.IDictionary]) {
        foreach ($name in $Names) {
            if ($Object.Contains($name)) {
                return $Object[$name]
            }
        }
    }
    foreach ($name in $Names) {
        $property = $Object.PSObject.Properties[$name]
        if ($property) {
            return $property.Value
        }
    }
    return $null
}

function Get-ShipDeProcessIdentity {
    param([AllowNull()][object]$Process)

    if ($null -eq $Process) {
        return $null
    }

    try {
        $refreshMethod = $Process.PSObject.Methods['Refresh']
        if ($refreshMethod) {
            $Process.Refresh()
        }
        if ([bool]$Process.HasExited) {
            return $null
        }

        $processId = 0
        if (-not [int]::TryParse([string]$Process.Id, [ref]$processId) -or $processId -le 0) {
            return $null
        }

        $pathProperty = $Process.PSObject.Properties['Path']
        $processPath = if ($pathProperty) { [string]$pathProperty.Value } else { "" }
        if ([string]::IsNullOrWhiteSpace($processPath)) {
            $mainModule = $Process.PSObject.Properties['MainModule']
            if ($mainModule -and $mainModule.Value) {
                $processPath = [string]$mainModule.Value.FileName
            }
        }
        if ([string]::IsNullOrWhiteSpace($processPath)) {
            return $null
        }

        $startTime = [DateTime]$Process.StartTime
        return [PSCustomObject]@{
            Id = $processId
            Name = [string]$Process.ProcessName
            Path = $processPath
            StartTimeUtc = $startTime.ToUniversalTime().ToString('o')
        }
    } catch {
        # Process identity is security-sensitive. An inaccessible or exited
        # process is unverifiable, not evidence that the marker is valid.
        return $null
    }
}

function Get-ShipDeAoDatabasePath {
    $userHome = Get-ShipDeUserHome
    return (Join-Path (Join-Path (Join-Path $userHome ".ao") "data") "ao.db")
}

function Get-ShipDeAoHarnessActivity {
    param(
        [Parameter(Mandatory = $true)][string]$Harness,
        [string]$DatabasePath = $null,
        # An all-time aggregate answers "was this harness ever observed", which
        # stays true forever once it has been true once. The question a health
        # check is asking is whether it is observed now, so activity is counted
        # inside a window and the all-time figure is kept only as context.
        [int]$WindowHours = 24
    )

    # AI-16-R03: hook registration is only real once the daemon has written an
    # activity row. A launch command that exits zero proves the flags parsed,
    # not that the session was ever observed, so the evidence is read from
    # ao.db rather than inferred from an exit code.
    #
    # AI-16-R04: every path that cannot read the ledger returns Verifiable
    # $false with the reason. A missing database, a stopped daemon that never
    # created one, or an absent Node runtime are all "cannot verify" — none of
    # them may be reported as a pass.
    if ([string]::IsNullOrWhiteSpace($DatabasePath)) {
        $DatabasePath = Get-ShipDeAoDatabasePath
    }

    $unverifiable = {
        param([string]$Reason)
        [PSCustomObject]@{
            Harness        = $Harness
            Verifiable     = $false
            Reason         = $Reason
            Sessions       = 0
            WithActivity   = 0
            LastActivityAt = $null
        }
    }

    if (-not (Test-Path -LiteralPath $DatabasePath -PathType Leaf)) {
        return (& $unverifiable "AO ledger not found at $DatabasePath; the daemon has not run on this machine")
    }
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        return (& $unverifiable "node is not on PATH, so the AO ledger cannot be read")
    }

    # node:sqlite opens the live database read-only; the daemon keeps it in WAL
    # mode, so this neither blocks it nor writes to it.
    $readerPath = Join-Path (Get-ShipDeTempDir) ("shipde-ao-activity-{0}.js" -f [Guid]::NewGuid())
    $reader = @'
const { DatabaseSync } = require('node:sqlite');
const [dbPath, harness, windowHours] = process.argv.slice(2);
const db = new DatabaseSync(dbPath, { readOnly: true });
const row = db
  .prepare(
    'SELECT COUNT(*) AS sessions, ' +
      'SUM(CASE WHEN activity_last_at IS NOT NULL THEN 1 ELSE 0 END) AS withActivity, ' +
      'MAX(activity_last_at) AS lastActivityAt, ' +
      'SUM(CASE WHEN activity_last_at IS NOT NULL ' +
      "AND activity_last_at >= datetime('now', ?) THEN 1 ELSE 0 END) AS recentWithActivity " +
      'FROM sessions WHERE harness = ?'
  )
  .get('-' + windowHours + ' hours', harness);
process.stdout.write(
  JSON.stringify({
    sessions: row.sessions || 0,
    withActivity: row.withActivity || 0,
    recentWithActivity: row.recentWithActivity || 0,
    windowHours: Number(windowHours),
    lastActivityAt: row.lastActivityAt || null,
  })
);
'@

    try {
        Set-Content -LiteralPath $readerPath -Value $reader -Encoding utf8
        $raw = (@(& node $readerPath $DatabasePath $Harness $WindowHours 2>$null) -join "")
        if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($raw)) {
            return (& $unverifiable "AO ledger at $DatabasePath could not be read")
        }
        $parsed = $raw | ConvertFrom-Json
        return [PSCustomObject]@{
            Harness        = $Harness
            Verifiable     = $true
            Reason         = $null
            Sessions           = [int]$parsed.sessions
            WithActivity       = [int]$parsed.withActivity
            RecentWithActivity = [int]$parsed.recentWithActivity
            WindowHours        = [int]$parsed.windowHours
            LastActivityAt     = $parsed.lastActivityAt
        }
    } catch {
        return (& $unverifiable "AO ledger at $DatabasePath could not be read: $($_.Exception.Message)")
    } finally {
        Remove-Item -LiteralPath $readerPath -Force -ErrorAction SilentlyContinue
    }
}
