param(
    [switch]$Apply,
    [switch]$InstallDocker,
    [string]$Profile = "ALL",
    [string[]]$Tools,
    [string]$ManifestPath = (Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) "tools\ecosystem-manifest.json")
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $ManifestPath)) {
    throw "Manifest not found: $ManifestPath"
}

$manifest = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$adopted = @($manifest.adopted)

function Get-ShipDeNpmGlobalVersion {
    param([Parameter(Mandatory = $true)][string]$PackageName)

    $raw = @(& npm list --global $PackageName --depth=0 --json 2>$null) -join "`n"
    if ([string]::IsNullOrWhiteSpace($raw)) {
        return $null
    }
    try {
        $parsed = $raw | ConvertFrom-Json
        if (-not $parsed.dependencies) { return $null }
        $prop = $parsed.dependencies.PSObject.Properties[$PackageName]
        if (-not $prop) { return $null }
        return [string]$prop.Value.version
    } catch {
        return $null
    }
}

Write-Host "================================================================"
Write-Host "SHIP DE - GOVERNED ECOSYSTEM INSTALLER"
Write-Host "================================================================"
Write-Host ("Manifest: {0}" -f $ManifestPath)
Write-Host ("Mode    : {0}" -f $(if ($Apply) { "APPLY (Execution)" } else { "PREVIEW ONLY (Dry Run)" }))

$installedTools = [System.Collections.Generic.List[object]]::new()
$missingMachineTools = [System.Collections.Generic.List[object]]::new()
$deferredDependencies = [System.Collections.Generic.List[object]]::new()
$integratedAssets = [System.Collections.Generic.List[object]]::new()

# Mapping for npm global package names
$npmPackageMap = @{
    "pnpm"             = "pnpm"
    "nine-router"      = "9router"
    "deepseek-harness" = "@deepseek-ai/dsh"
    "gemini-cli"       = "@google/gemini-cli"
    "codex-cli"        = "@openai/codex"
    "claude-code"      = "@anthropic-ai/claude-code"
    "playwright-cli"   = "@playwright/cli"
    "promptfoo"        = "promptfoo"
}

# Mapping for CLI executable command names
$cliCommandMap = @{
    "git"              = "git"
    "gh"               = "gh"
    "node"             = "node"
    "pnpm"             = "pnpm"
    "docker-compose"   = "docker"
    "nine-router"      = "9router"
    "deepseek-harness" = "dsh"
    "gemini-cli"       = "gemini"
    "antigravity-cli"  = "agy"
    "codex-cli"        = "codex"
    "claude-code"      = "claude"
    "playwright-cli"   = "playwright-cli"
    "gitleaks"         = "gitleaks"
    "promptfoo"        = "promptfoo"
    "trivy"            = "trivy"
}

foreach ($tool in $adopted) {
    if ($Tools -and $Tools.Count -gt 0 -and $tool.id -notin $Tools) {
        continue
    }

    $toolId = [string]$tool.id
    $blockingPolicy = [string]$tool.blocking_policy

    # 1. Project dependencies deferred to later foundation items (TASK-FOUND-03 / TASK-FOUND-04)
    if ($blockingPolicy -match "^DEFERRED_TO_FOUNDATION") {
        $deferredDependencies.Add($tool)
        continue
    }

    # 2. Workspace baseline, datasets, guidance, on-demand MCPs, or pnpm-workspace packages
    if ($tool.kind -in @("workspace", "guidance", "dataset", "mcp-server") -or $tool.install_method -eq "pnpm-workspace") {
        $integratedAssets.Add($tool)
        continue
    }

    # 3. Check machine-level CLI / package
    $commandName = $cliCommandMap[$toolId]
    $resolvedCmd = if ($commandName) { Get-Command $commandName -ErrorAction SilentlyContinue } else { $null }

    if ($resolvedCmd) {
        $installedTools.Add([PSCustomObject]@{
            Tool = $tool
            Status = "INSTALLED"
            Location = $resolvedCmd.Source
        })
    } elseif ($npmPackageMap.ContainsKey($toolId)) {
        $pkgName = $npmPackageMap[$toolId]
        $npmVer = Get-ShipDeNpmGlobalVersion -PackageName $pkgName
        if ($npmVer) {
            $installedTools.Add([PSCustomObject]@{
                Tool = $tool
                Status = "INSTALLED"
                Location = "npm global: $pkgName@$npmVer"
            })
        } else {
            $missingMachineTools.Add($tool)
        }
    } else {
        $missingMachineTools.Add($tool)
    }
}

Write-Host "`n=== 1. ALREADY INSTALLED MACHINE TOOLS (PRESERVED WITHOUT UPGRADE) ==="
if ($installedTools.Count -eq 0) {
    Write-Host "None"
} else {
    foreach ($item in $installedTools) {
        Write-Host ("  [OK] {0,-22} {1}" -f $item.Tool.name, $item.Location)
    }
}

Write-Host "`n=== 2. DEFERRED PROJECT DEPENDENCIES (AC-AI-24: NOT TOUCHED) ==="
foreach ($tool in $deferredDependencies) {
    Write-Host ("  [DEFERRED] {0,-26} [Owner: {1}]" -f $tool.name, $tool.blocking_policy)
}
Write-Host "  (Package manifests and lockfiles remain completely unmodified.)"

Write-Host "`n=== 3. INTEGRATED ASSETS & ON-DEMAND PROTOCOLS ==="
foreach ($tool in $integratedAssets) {
    Write-Host ("  [ASSET] {0,-26} [{1} | {2}]" -f $tool.name, $tool.kind, $tool.lifecycle_state)
}

Write-Host "`n=== 4. MISSING MACHINE-LEVEL TOOLS PLAN ==="
if ($missingMachineTools.Count -eq 0) {
    Write-Host "No missing machine-level tool. All required machine tools are present."
} else {
    foreach ($tool in $missingMachineTools) {
        $spec = if ($npmPackageMap.ContainsKey($tool.id)) {
            "npm install --global $($npmPackageMap[$tool.id])@$($tool.pinned_version_or_commit)"
        } elseif ($tool.install_method -eq "winget") {
            "winget install $($tool.id)"
        } else {
            "Manual/System install: $($tool.install_method)"
        }
        Write-Host ("  [INSTALL] {0,-22} -> {1}" -f $tool.name, $spec)
    }
}

if (-not $Apply) {
    Write-Host "`n================================================================"
    Write-Host "INFO: PREVIEW ONLY (AC-AI-19): No machine or repository mutation occurred."
    Write-Host "To execute installation of missing machine tools, re-run with -Apply."
    Write-Host "================================================================"
    exit 0
}

# Execution path with -Apply (AC-AI-20)
Write-Host "`n================================================================"
Write-Host "EXECUTING INSTALLATION (-Apply)"
Write-Host "================================================================"

foreach ($tool in $missingMachineTools) {
    $toolId = [string]$tool.id
    if ($npmPackageMap.ContainsKey($toolId)) {
        $pkgName = $npmPackageMap[$toolId]
        $spec = if ($tool.pinned_version_or_commit -and $tool.pinned_version_or_commit -ne "latest") {
            "$pkgName@$($tool.pinned_version_or_commit)"
        } else {
            "$pkgName@latest"
        }
        Write-Host ("Installing npm CLI package: {0}" -f $spec)
        & npm install --global $spec --fetch-retries=3 --fetch-timeout=120000
        if ($LASTEXITCODE -ne 0) {
            throw "Installation failed for $spec. Stopping immediately without partial state corruption."
        }
    } elseif ($tool.install_method -eq "winget" -and $toolId -eq "docker-compose" -and $InstallDocker) {
        Write-Host "Installing Docker Desktop via winget..."
        & winget install --exact --id Docker.DockerDesktop --accept-package-agreements --accept-source-agreements
        if ($LASTEXITCODE -ne 0) {
            throw "Docker Desktop installation failed."
        }
    } else {
        Write-Host ("Skipping manual/system tool: {0} ({1})" -f $tool.name, $tool.install_method)
    }
}

Write-Host "`nECOSYSTEM INSTALLATION COMPLETE:"
Write-Host "  - Only missing approved tools were installed"
Write-Host "  - Existing tools were not upgraded"
Write-Host "  - No user sign-in or secret access was performed"
Write-Host "  - Deferred project dependencies were not touched"
exit 0
