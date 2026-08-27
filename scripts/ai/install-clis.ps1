param(
    [switch]$Apply,
    [switch]$InstallDocker
)

. (Join-Path $PSScriptRoot "common.ps1")

Assert-ShipDeCommand git
Assert-ShipDeCommand gh
Assert-ShipDeCommand node
Assert-ShipDeCommand npm

function Get-ShipDeGlobalNpmVersion {
    param([Parameter(Mandatory = $true)][string]$PackageName)

    $raw = @(& npm list --global $PackageName --depth=0 --json 2>$null) -join "`n"
    if ([string]::IsNullOrWhiteSpace($raw)) {
        return $null
    }

    try {
        $parsed = $raw | ConvertFrom-Json
        if (-not $parsed.dependencies) {
            return $null
        }
        $property = $parsed.dependencies.PSObject.Properties[$PackageName]
        if (-not $property) {
            return $null
        }
        return [string]$property.Value.version
    } catch {
        return $null
    }
}

$npmTools = @(
    [ordered]@{
        Name = "pnpm"
        Command = "pnpm"
        Package = "pnpm"
        InstallSpec = "pnpm@11"
        RequiredVersion = "^11\."
    },
    [ordered]@{
        Name = "9Router"
        Command = "9router"
        Package = "9router"
        InstallSpec = "9router@latest"
        RequiredVersion = $null
    },
    [ordered]@{
        Name = "DeepSeek Harness"
        Command = "dsh"
        Package = "@deepseek-ai/dsh"
        InstallSpec = "@deepseek-ai/dsh@0.1.1-rc.2"
        RequiredVersion = "^0\.1\.1-rc\.2$"
    },
    [ordered]@{
        Name = "Gemini CLI"
        Command = "gemini"
        Package = "@google/gemini-cli"
        InstallSpec = "@google/gemini-cli@latest"
        RequiredVersion = $null
    },
    [ordered]@{
        Name = "Codex CLI"
        Command = "codex"
        Package = "@openai/codex"
        InstallSpec = "@openai/codex@latest"
        RequiredVersion = $null
    },
    [ordered]@{
        Name = "Claude Code"
        Command = "claude"
        Package = "@anthropic-ai/claude-code"
        InstallSpec = "@anthropic-ai/claude-code@latest"
        RequiredVersion = $null
    }
)

$failures = [System.Collections.Generic.List[string]]::new()
$planned = [System.Collections.Generic.List[object]]::new()

$nodeVersion = (& node --version).Trim()
Write-Host ("Node.js             {0}" -f $nodeVersion)
if ($nodeVersion -notmatch "^v24\.") {
    $failures.Add("Node.js $nodeVersion is not the approved major v24 used by the Ship De workstation")
}

Write-Host "=== GLOBAL NPM CLI INVENTORY ==="
foreach ($tool in $npmTools) {
    $version = Get-ShipDeGlobalNpmVersion -PackageName $tool.Package
    $command = Get-Command $tool.Command -ErrorAction SilentlyContinue

    if ($version) {
        $versionState = if ($tool.RequiredVersion -and $version -notmatch $tool.RequiredVersion) {
            "VERSION_MISMATCH"
        } else {
            "INSTALLED"
        }
        Write-Host ("{0,-20} {1,-18} {2}" -f $tool.Name, $versionState, $version)

        if ($versionState -eq "VERSION_MISMATCH") {
            $failures.Add("$($tool.Name) is $version; expected $($tool.InstallSpec). Upgrade only in a dedicated reviewed setup task.")
        }
        if (-not $command) {
            $failures.Add("$($tool.Package) is installed but '$($tool.Command)' is not on PATH. Open a new PowerShell window and inspect npm prefix.")
        }
        continue
    }

    Write-Host ("{0,-20} {1,-18} {2}" -f $tool.Name, "MISSING", $tool.InstallSpec)
    $planned.Add($tool)
}

$dockerCommand = Get-Command docker -ErrorAction SilentlyContinue
Write-Host "`n=== DOCKER DESKTOP ==="
if ($dockerCommand) {
    Write-Host ("Docker CLI          INSTALLED          {0}" -f $dockerCommand.Source)
    & docker compose version
    if ($LASTEXITCODE -ne 0) {
        $failures.Add("Docker Compose plugin is unavailable")
    }
} else {
    Write-Host "Docker Desktop      MISSING"
    if (-not $InstallDocker) {
        $failures.Add("Docker Desktop is missing. Re-run with -InstallDocker; add -Apply to install it.")
    }
}

Write-Host "`n=== ACTION PLAN ==="
if ($planned.Count -eq 0) {
    Write-Host "No missing npm CLI package. Installed tools are not upgraded."
} else {
    $planned | ForEach-Object { Write-Host ("npm install --global {0}" -f $_.InstallSpec) }
}
if (-not $dockerCommand -and $InstallDocker) {
    Write-Host "winget install --exact --id Docker.DockerDesktop"
}

if (-not $Apply) {
    Write-Host "`nPREVIEW ONLY. Re-run with -Apply after reviewing the plan."
    if ($failures.Count -gt 0) {
        Write-Host "`n=== CURRENT GAPS ==="
        $failures | ForEach-Object { Write-Host "- $_" }
    }
    exit 0
}

if ($failures.Count -gt 0) {
    Write-Host "`n=== BLOCKED ==="
    $failures | ForEach-Object { Write-Host "- $_" }
    exit 1
}

if ($planned.Count -gt 0) {
    Write-Host "`n=== INSTALLING MISSING NPM CLIS ==="
    foreach ($tool in $planned) {
        Write-Host ("Installing {0}: {1}" -f $tool.Name, $tool.InstallSpec)
        & npm install `
            --global `
            $tool.InstallSpec `
            --registry=https://registry.npmjs.org/ `
            --fetch-retries=5 `
            --fetch-retry-factor=2 `
            --fetch-retry-mintimeout=20000 `
            --fetch-retry-maxtimeout=120000 `
            --fetch-timeout=600000
        if ($LASTEXITCODE -ne 0) {
            throw "Installation failed: $($tool.InstallSpec). Existing tools were not upgraded; retry this one package after checking npm connectivity."
        }
    }
}

$dockerWasInstalled = $false
if (-not $dockerCommand -and $InstallDocker) {
    Assert-ShipDeCommand winget
    Write-Host "`n=== INSTALLING DOCKER DESKTOP ==="
    & winget install --exact --id Docker.DockerDesktop --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) {
        throw "Docker Desktop installation failed"
    }
    $dockerWasInstalled = $true
}

Write-Host "`n=== POST-INSTALL CHECK ==="
$postFailures = [System.Collections.Generic.List[string]]::new()
foreach ($tool in $npmTools) {
    $version = Get-ShipDeGlobalNpmVersion -PackageName $tool.Package
    if (-not $version) {
        $postFailures.Add("Missing after installation: $($tool.Package)")
        continue
    }
    if ($tool.RequiredVersion -and $version -notmatch $tool.RequiredVersion) {
        $postFailures.Add("Unexpected version after installation: $($tool.Package) $version")
    }
    Write-Host ("{0,-20} {1}" -f $tool.Name, $version)
}

if ($postFailures.Count -gt 0) {
    $postFailures | ForEach-Object { Write-Host "- $_" }
    exit 1
}

if ($dockerWasInstalled) {
    Write-Host "`nDocker Desktop was installed. Restart Windows if requested, start Docker Desktop, accept its terms, then open a new PowerShell window."
}

Write-Host "`nCLI INSTALLATION COMPLETE"
Write-Host "No account sign-in or API key was performed. Continue with WINDOWS-SETUP-RUNBOOK.md."
