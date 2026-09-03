param(
    [switch]$Apply,
    [switch]$InstallDocker,
    [string]$Profile = "ALL",
    [string[]]$Tools,
    [string]$ManifestPath = (Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) "tools\ecosystem-manifest.json"),
    [string]$ProfilesPath = (Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) "tools\ecosystem-profiles.json")
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $ManifestPath)) {
    throw "Manifest not found: $ManifestPath"
}

$repoRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$manifest = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$adopted = @($manifest.adopted)

$profileFilter = $null
$requiredToolIds = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)

if ($Profile -and $Profile -ne "ALL") {
    if (-not (Test-Path -LiteralPath $ProfilesPath)) {
        throw "Profiles configuration not found: $ProfilesPath"
    }
    $profilesConfig = Get-Content -LiteralPath $ProfilesPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $pObj = $profilesConfig.profiles.PSObject.Properties[$Profile]
    if (-not $pObj) {
        throw "Profile '$Profile' is not defined in $ProfilesPath."
    }
    $profileFilter = @($pObj.Value.allowed_tools)
    foreach ($rId in @($pObj.Value.required_tools)) {
        $requiredToolIds.Add($rId) | Out-Null
    }
}

# Preload global npm package inventory once (fast, 0 network overhead)
$globalNpmPackages = @{}
try {
    $raw = @(& npm list --global --depth=0 --json 2>$null) -join "`n"
    if (-not [string]::IsNullOrWhiteSpace($raw)) {
        $parsed = $raw | ConvertFrom-Json
        if ($parsed.dependencies) {
            foreach ($prop in $parsed.dependencies.PSObject.Properties) {
                $globalNpmPackages[$prop.Name] = [string]$prop.Value.version
            }
        }
    }
} catch {
    # npm unavailable or error
}

function Get-ShipDeNpmGlobalVersion {
    param([Parameter(Mandatory = $true)][string]$PackageName)

    if ($globalNpmPackages.ContainsKey($PackageName)) {
        return $globalNpmPackages[$PackageName]
    }
    return $null
}

Write-Host "================================================================"
Write-Host "SHIP DE - GOVERNED ECOSYSTEM INSTALLER"
Write-Host "================================================================"
Write-Host ("Manifest: {0}" -f $ManifestPath)
Write-Host ("Profile : {0}" -f $Profile)
Write-Host ("Mode    : {0}" -f $(if ($Apply) { "APPLY (Execution)" } else { "PREVIEW ONLY (Dry Run)" }))

$installedTools = [System.Collections.Generic.List[object]]::new()
$missingMachineTools = [System.Collections.Generic.List[object]]::new()
$deferredDependencies = [System.Collections.Generic.List[object]]::new()
$integratedAssets = [System.Collections.Generic.List[object]]::new()

# Mapping for npm global package names
$npmPackageMap = @{
    "nine-router"      = "9router"
    "deepseek-harness" = "@deepseek-ai/dsh"
    "gemini-cli"       = "@google/gemini-cli"
    "codex-cli"        = "@openai/codex"
    "claude-code"      = "@anthropic-ai/claude-code"
    "playwright-cli"   = "@playwright/cli"
    "promptfoo"        = "promptfoo"
    "context7"         = "context7"
    "agent-scan"       = "agent-scan"
    "renovate"         = "renovate"
    "repomix"          = "repomix"
    "prism"            = "@stoplight/prism-cli"
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
    "context7"         = "context7"
    "agent-scan"       = "agent-scan"
    "renovate"         = "renovate"
    "lefthook"         = "lefthook"
    "repomix"          = "repomix"
    "prism"            = "prism"
}

# 1. Process deferred product dependencies from manifest
if ($manifest.product_dependencies) {
    foreach ($pDep in @($manifest.product_dependencies)) {
        if ($profileFilter -and $pDep.id -notin $profileFilter) {
            continue
        }
        if ($Tools -and $Tools.Count -gt 0 -and $pDep.id -notin $Tools) {
            continue
        }
        if ($pDep.lifecycle_state -eq "DEFERRED" -or $pDep.foundation_item -match "^TASK-FOUND-(03|04)") {
            $deferredDependencies.Add($pDep)
        }
    }
}

# 2. Process adopted ecosystem repositories
foreach ($tool in $adopted) {
    if ($profileFilter -and $tool.id -notin $profileFilter) {
        continue
    }
    if ($Tools -and $Tools.Count -gt 0 -and $tool.id -notin $Tools) {
        continue
    }

    $toolId = [string]$tool.id
    $blockingPolicy = [string]$tool.blocking_policy

    # Deferred project dependencies
    if ($blockingPolicy -match "^DEFERRED_TO_FOUNDATION") {
        $deferredDependencies.Add($tool)
        continue
    }

    # Workspace baseline, datasets, guidance, on-demand MCPs, or tools/libraries
    if ($tool.kind -in @("workspace", "guidance", "dataset", "mcp-server", "tool", "library") -or $tool.install_method -in @("workspace", "pinned-snapshot", "npx-on-demand")) {
        $verified = $false
        $checkReason = "No health check defined"
        if ($tool.health_check) {
            try {
                $checkCmd = [string]$tool.health_check
                if ($checkCmd.StartsWith("Test-Path ")) {
                    $testPath = $checkCmd.Substring(10).Trim().Trim('"').Trim("'")
                    $fullPath = if ([System.IO.Path]::IsPathRooted($testPath)) { $testPath } else { Join-Path $repoRoot $testPath }
                    $verified = Test-Path -LiteralPath $fullPath
                    $checkReason = if ($verified) { "Path verified: $testPath" } else { "Path missing: $testPath" }
                } elseif ($checkCmd.StartsWith("Get-Command ")) {
                    $cmdName = $checkCmd.Substring(12).Trim().Trim('"').Trim("'")
                    $cmdResolved = Get-Command $cmdName -ErrorAction SilentlyContinue
                    $verified = ($null -ne $cmdResolved)
                    $checkReason = if ($verified) { "Command found: $cmdName" } else { "Command missing: $cmdName" }
                } else {
                    $verified = ($tool.lifecycle_state -in @("INSTALLED", "INTEGRATED"))
                    $checkReason = "Lifecycle: $($tool.lifecycle_state)"
                }
            } catch {
                $verified = $false
                $checkReason = "Health check threw error: $_"
            }
        }
        $integratedAssets.Add([PSCustomObject]@{
            Tool = $tool
            Status = $(if ($verified) { "VERIFIED" } else { "PENDING_VERIFICATION" })
            Details = $checkReason
        })
        continue
    }

    # Check machine-level CLI / package
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
        Write-Host ("  [OK] {0,-24} {1}" -f $item.Tool.name, $item.Location)
    }
}

Write-Host "`n=== 2. DEFERRED PROJECT DEPENDENCIES (AC-AI-24: NOT TOUCHED) ==="
if ($deferredDependencies.Count -eq 0) {
    Write-Host "None"
} else {
    foreach ($tool in $deferredDependencies) {
        Write-Host ("  [DEFERRED] {0,-26} [Owner: {1}]" -f $tool.name, $(if ($tool.foundation_item) { $tool.foundation_item } else { $tool.blocking_policy }))
    }
    Write-Host "  (Package manifests and lockfiles remain completely unmodified.)"
}

Write-Host "`n=== 3. ADOPTED ASSETS, GUIDANCE & ON-DEMAND PROTOCOLS ==="
if ($integratedAssets.Count -eq 0) {
    Write-Host "None"
} else {
    foreach ($item in $integratedAssets) {
        Write-Host ("  [{0,-20}] {1,-26} ({2})" -f $item.Status, $item.Tool.name, $item.Details)
    }
}

Write-Host "`n=== 4. MISSING MACHINE-LEVEL TOOLS PLAN ==="
if ($missingMachineTools.Count -eq 0) {
    Write-Host "No missing machine-level tools. All required machine tools are present."
} else {
    foreach ($tool in $missingMachineTools) {
        $spec = if ($npmPackageMap.ContainsKey($tool.id)) {
            "npm install --global $($npmPackageMap[$tool.id])@$($tool.pinned_version_or_commit)"
        } elseif ($tool.install_method -eq "winget") {
            "winget install $($tool.id)"
        } else {
            "Manual/System install: $($tool.install_method)"
        }
        $isReq = $requiredToolIds.Contains($tool.id)
        Write-Host ("  [INSTALL{0}] {1,-22} -> {2}" -f $(if ($isReq) { "-REQUIRED" } else { "-OPTIONAL" }), $tool.name, $spec)
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

$executionFailed = $false
$failedTools = [System.Collections.Generic.List[string]]::new()

foreach ($tool in $missingMachineTools) {
    $toolId = [string]$tool.id
    $isReq = $requiredToolIds.Contains($toolId)

    if ($npmPackageMap.ContainsKey($toolId)) {
        $pkgName = $npmPackageMap[$toolId]
        $pin = [string]$tool.pinned_version_or_commit
        if ([string]::IsNullOrWhiteSpace($pin) -or $pin -in @("latest", "unpinned", "any") -or $pin -match '[*<>=~^]') {
            throw "Tool '$($toolId)' has nondeterministic version spec '$($pin)'. AI-TOOL-11 strictly forbids fallback to latest."
        }
        $spec = "$pkgName@$pin"
        Write-Host ("Installing npm CLI package: {0}" -f $spec)
        & npm install --global $spec --fetch-retries=3 --fetch-timeout=120000
        if ($LASTEXITCODE -ne 0) {
            Write-Error "Installation failed for $spec."
            $executionFailed = $true
            $failedTools.Add("$($toolId) ($spec)")
            continue
        }
        $installedVer = Get-ShipDeNpmGlobalVersion -PackageName $pkgName
        if ($installedVer -ne $pin) {
            Write-Error "Post-install verification failed for $($toolId): expected '$pin', got '$installedVer'."
            $executionFailed = $true
            $failedTools.Add("$($toolId) (version mismatch)")
        }
    } elseif ($tool.install_method -eq "winget" -and $toolId -eq "docker-compose" -and $InstallDocker) {
        Write-Host "Installing Docker Desktop via winget..."
        & winget install --exact --id Docker.DockerDesktop --accept-package-agreements --accept-source-agreements
        if ($LASTEXITCODE -ne 0) {
            Write-Error "Docker Desktop installation failed."
            $executionFailed = $true
            $failedTools.Add("docker-compose")
        }
    } else {
        Write-Host ("Skipping manual/system tool: {0} ({1})" -f $tool.name, $tool.install_method)
        if ($isReq) {
            Write-Warning "Required tool '$($toolId)' is a manual/system installation and cannot be auto-installed."
            $executionFailed = $true
            $failedTools.Add("$($toolId) (unsupported automatic install)")
        }
    }
}

if ($executionFailed) {
    Write-Error ("Ecosystem installation finished with failures: {0}" -f ($failedTools -join ", "))
    exit 1
}

Write-Host "`nECOSYSTEM INSTALLATION COMPLETE:"
Write-Host "  - Only missing approved tools were installed"
Write-Host "  - Existing tools were not upgraded"
Write-Host "  - Pinned versions strictly verified without latest fallback"
Write-Host "  - No user sign-in or secret access was performed"
Write-Host "  - Deferred project dependencies were not touched"
exit 0
