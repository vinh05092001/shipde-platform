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
        $candidate = Join-Path $root "agent-orchestrator\resources\daemon\ao.exe"
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

function Get-ShipDeAoVersionProbe {
    param([Parameter(Mandatory = $true)][string]$AoExecutable)

    $output = @(& $AoExecutable version 2>&1)
    return [PSCustomObject]@{
        Text = (@($output | ForEach-Object { [string]$_ }) -join [Environment]::NewLine).Trim()
        ExitCode = $LASTEXITCODE
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

    if ($null -eq $VersionText) {
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

function Get-ShipDePaths {
    param([string]$AiRoot = (Join-Path $env:USERPROFILE "AI"))

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
    foreach ($name in $Names) {
        $property = $Object.PSObject.Properties[$name]
        if ($property) {
            return $property.Value
        }
    }
    return $null
}
