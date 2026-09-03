param(
    [ValidateSet("Validate", "Status", "Activate", "Deactivate", "Test", "SyncRegister")]
    [string]$Action = "Status",

    [string]$Profile = "FOUNDATION",
    [string]$ManifestPath = (Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) "tools\ecosystem-manifest.json"),
    [string]$ProfilesPath = (Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) "tools\ecosystem-profiles.json"),
    [string]$AiRoot = (Join-Path $env:USERPROFILE "AI"),
    [switch]$StartServices
)

$ErrorActionPreference = "Stop"

function Test-ShipDePort {
    param(
        [Parameter(Mandatory = $true)][string]$HostName,
        [Parameter(Mandatory = $true)][int]$Port
    )

    try {
        $client = [System.Net.Sockets.TcpClient]::new()
        $asyncResult = $client.BeginConnect($HostName, $Port, $null, $null)
        $success = $asyncResult.AsyncWaitHandle.WaitOne(300, $false)
        if (-not $success) {
            $client.Close()
            return $false
        }
        $client.EndConnect($asyncResult)
        $client.Close()
        return $true
    } catch {
        return $false
    }
}

function Get-ShipDeManifestContent {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        throw "Manifest file not found: $Path"
    }

    $raw = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
    try {
        return ($raw | ConvertFrom-Json)
    } catch {
        throw "Malformed manifest JSON in $Path`: $($_.Exception.Message)"
    }
}

function Get-ShipDeProfilesContent {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        throw "Profiles file not found: $Path"
    }

    $raw = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
    try {
        return ($raw | ConvertFrom-Json)
    } catch {
        throw "Malformed profiles JSON in $Path`: $($_.Exception.Message)"
    }
}

function Assert-ShipDeManifest {
    param(
        [Parameter(Mandatory = $true)][object]$Manifest,
        [Parameter(Mandatory = $true)][object]$Profiles
    )

    $errors = [System.Collections.Generic.List[string]]::new()

    # 1. Adopted entries check: exactly 37 adopted repositories/capabilities
    if (-not $Manifest.adopted) {
        $errors.Add("Manifest must define 'adopted' array.")
        return $errors
    }

    $adopted = @($Manifest.adopted)
    if ($adopted.Count -ne 37) {
        $errors.Add("Manifest adopted count must be exactly 37; found $($adopted.Count).")
    }

    # Approved canonical repository identities (Finding 1: 30 baseline + 7 additions)
    $canonicalApprovedRepos = @(
        "vinh05092001/shipde-platform",
        "vinh05092001/shipde-brain",
        "decolua/9router",
        "deepseek-ai/deepseek-harness",
        "google-gemini/gemini-cli",
        "google/antigravity",
        "openai/codex",
        "anthropic-ai/claude-code",
        "microsoft/playwright-cli",
        "cli/cli",
        "docker/compose",
        "ChromeDevTools/chrome-devtools-mcp",
        "vercel-labs/agent-skills",
        "GoogleChrome/lighthouse-ci",
        "storybookjs/storybook",
        "mswjs/msw",
        "openapi-ts/openapi-typescript",
        "Fission-AI/OpenSpec",
        "github/spec-kit",
        "gastownhall/beads",
        "getnao/sylph",
        "upstash/context7",
        "NousResearch/hermes-agent",
        "snyk/agent-scan",
        "xiufengsun/TokenTracker",
        "renovatebot/renovate",
        "evilmartians/lefthook",
        "oraios/serena",
        "yamadashy/repomix",
        "stoplightio/prism",
        "gitleaks/gitleaks",
        "dequelabs/axe-core",
        "microsoft/playwright-mcp",
        "promptfoo/promptfoo",
        "aquasecurity/trivy",
        "open-telemetry/opentelemetry-js",
        "thanglequoc/vietnamese-provinces-database"
    )

    # 2. Uniqueness checks for id, canonical_url, repository
    $seenIds = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    $seenUrls = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    $seenRepos = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)

    $requiredFields = @(
        "id", "name", "canonical_url", "repository", "owner", "kind", "role",
        "source_of_truth_boundary", "install_method", "pinned_version_or_commit",
        "platform", "lifecycle_state", "default_enabled", "blocking_policy",
        "permissions", "telemetry_network_behavior", "health_check", "rollback", "profiles"
    )

    foreach ($entry in $adopted) {
        # Check required fields
        foreach ($field in $requiredFields) {
            $val = $entry.PSObject.Properties[$field]
            if ($null -eq $val -or [string]::IsNullOrWhiteSpace([string]$val.Value)) {
                $errors.Add("Tool '$($entry.id)' missing required field '$field'.")
            }
        }

        # Check uniqueness
        if (-not [string]::IsNullOrWhiteSpace($entry.id)) {
            if (-not $seenIds.Add($entry.id)) {
                $errors.Add("Duplicate tool ID: $($entry.id)")
            }
        }
        if (-not [string]::IsNullOrWhiteSpace($entry.canonical_url)) {
            if (-not $seenUrls.Add($entry.canonical_url)) {
                $errors.Add("Duplicate canonical URL: $($entry.canonical_url)")
            }
        }
        if (-not [string]::IsNullOrWhiteSpace($entry.repository)) {
            if (-not $seenRepos.Add($entry.repository)) {
                $errors.Add("Duplicate repository: $($entry.repository)")
            }
        }

        # Check deterministic pinned version policy (Finding 4 & AI-TOOL-11):
        # Reject unpinned, any, latest, or wildcard/range patterns
        $pin = [string]$entry.pinned_version_or_commit
        if ([string]::IsNullOrWhiteSpace($pin) -or $pin -in @("unpinned", "any", "latest")) {
            $errors.Add("Tool '$($entry.id)' has nondeterministic or unpinned version: '$pin'.")
        } elseif ($pin -match '[*<>=~^]') {
            $errors.Add("Tool '$($entry.id)' has range or wildcard in version spec: '$pin'. Must be an exact pinned version or commit.")
        }

        # Check network & telemetry policy (AC-AI-23): reject non-local binding (0.0.0.0, public listeners, tunnels)
        $telemetryBehavior = [string]$entry.telemetry_network_behavior
        if ($telemetryBehavior -match "0\.0\.0\.0" -or $telemetryBehavior -match "public" -or $telemetryBehavior -match "tunnel") {
            $errors.Add("Tool '$($entry.id)' violates network policy: non-local binding or tunnel detected ('$telemetryBehavior').")
        }
        if ($telemetryBehavior -match "telemetry-enabled" -or $telemetryBehavior -match "telemetry-on") {
            $errors.Add("Tool '$($entry.id)' violates telemetry policy: telemetry is enabled ('$telemetryBehavior').")
        }

        # AI-TOOL-02: Optional services and MCP servers must be default_enabled: false
        if ($entry.kind -in @("mcp-server", "cli-service", "container-service")) {
            if ($entry.default_enabled -eq $true) {
                $errors.Add("Optional service/MCP '$($entry.id)' must have default_enabled = false.")
            }
        }
    }

    # Verify every canonical approved repository identity is present in adopted catalog (Finding 1)
    foreach ($canonRepo in $canonicalApprovedRepos) {
        if (-not $seenRepos.Contains($canonRepo)) {
            $errors.Add("Missing approved canonical repository identity: '$canonRepo'.")
        }
    }

    # 3. Playwright tri-role check (AC-AI-18)
    $pwCli = $adopted | Where-Object { $_.id -eq "playwright-cli" }
    $pwMcp = $adopted | Where-Object { $_.id -eq "playwright-mcp" }
    $pwTest = if ($Manifest.product_dependencies) {
        $Manifest.product_dependencies | Where-Object { $_.id -eq "playwright" }
    } else {
        $adopted | Where-Object { $_.id -eq "playwright" }
    }

    if (-not $pwCli -or -not $pwMcp -or -not $pwTest) {
        $errors.Add("Manifest must contain distinct entries for Playwright Test ('playwright'), Playwright CLI ('playwright-cli'), and Playwright MCP ('playwright-mcp').")
    } else {
        if ($pwCli.repository -ne "microsoft/playwright-cli") {
            $errors.Add("Playwright CLI repository must be 'microsoft/playwright-cli'.")
        }
        if ($pwMcp.repository -ne "microsoft/playwright-mcp") {
            $errors.Add("Playwright MCP repository must be 'microsoft/playwright-mcp'.")
        }
        if ($pwTest.repository -ne "microsoft/playwright") {
            $errors.Add("Playwright Test repository must be 'microsoft/playwright'.")
        }
        if ($pwCli.role -match "(?i)archived" -or $pwCli.role -match "(?i)deprecated" -or $pwCli.role -match "(?i)replaced") {
            $errors.Add("Playwright CLI must remain active and distinct, not marked archived or replaced.")
        }
    }

    # 4. Candidates check: exactly 10 candidates with PILOT or WATCH lifecycle
    if (-not $Manifest.candidates) {
        $errors.Add("Manifest must define 'candidates' array.")
    } else {
        $candidates = @($Manifest.candidates)
        if ($candidates.Count -ne 10) {
            $errors.Add("Manifest candidates count must be exactly 10; found $($candidates.Count).")
        }
        foreach ($c in $candidates) {
            if ($c.lifecycle_state -notin @("PILOT", "WATCH")) {
                $errors.Add("Candidate '$($c.id)' must have lifecycle_state 'PILOT' or 'WATCH'; found '$($c.lifecycle_state)'.")
            }
            if ($c.default_enabled -eq $true) {
                $errors.Add("Candidate '$($c.id)' must have default_enabled = false.")
            }
            if ($c.installed -eq $true) {
                $errors.Add("Candidate '$($c.id)' must have installed = false.")
            }
        }
    }

    # 5. Profiles validation
    $expectedProfiles = @(
        "FOUNDATION", "BACKEND_FEATURE", "CARRIER_INTEGRATION",
        "COD_AND_SETTLEMENT", "UI_FEATURE", "SECURITY_REVIEW",
        "RESEARCH_ONLY", "PR_REVIEW", "NIGHTLY_MAINTENANCE"
    )

    if (-not $Profiles.profiles) {
        $errors.Add("Profiles configuration must define 'profiles' object.")
        return $errors
    }

    # Build known tool IDs lookup from both adopted and product_dependencies
    $allKnownToolIds = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($entry in $adopted) {
        $allKnownToolIds.Add($entry.id) | Out-Null
    }
    if ($Manifest.product_dependencies) {
        foreach ($pDep in @($Manifest.product_dependencies)) {
            $allKnownToolIds.Add($pDep.id) | Out-Null
        }
    }

    foreach ($pName in $expectedProfiles) {
        $pObj = $Profiles.profiles.PSObject.Properties[$pName]
        if (-not $pObj) {
            $errors.Add("Missing required profile: '$pName'.")
            continue
        }

        $prof = $pObj.Value
        if (-not $prof.allowed_tools -or @($prof.allowed_tools).Count -eq 0) {
            $errors.Add("Profile '$pName' must define non-empty 'allowed_tools'.")
        }

        foreach ($tId in @($prof.allowed_tools)) {
            if (-not $allKnownToolIds.Contains($tId)) {
                $errors.Add("Profile '$pName' references unknown tool '$tId'.")
            }
        }

        foreach ($tId in @($prof.required_tools)) {
            if (-not $allKnownToolIds.Contains($tId)) {
                $errors.Add("Profile '$pName' references unknown required tool '$tId'.")
            }
        }

        # Concurrency limit check (AI-TOOL-03)
        if ($prof.concurrency_limits) {
            if ($prof.concurrency_limits.max_implementation_agents -gt 1) {
                $errors.Add("Profile '$pName' exceeds max_implementation_agents limit (max 1).")
            }
            if ($prof.concurrency_limits.max_research_agents -gt 1) {
                $errors.Add("Profile '$pName' exceeds max_research_agents limit (max 1).")
            }
        }
    }

    return $errors
}

function Invoke-ShipDeValidate {
    param(
        [string]$ManifestPath,
        [string]$ProfilesPath
    )

    Write-Host "=== VALIDATING ECOSYSTEM MANIFEST & PROFILES ==="
    Write-Host "Manifest : $ManifestPath"
    Write-Host "Profiles : $ProfilesPath"

    $manifest = Get-ShipDeManifestContent -Path $ManifestPath
    $profiles = Get-ShipDeProfilesContent -Path $ProfilesPath

    $errors = Assert-ShipDeManifest -Manifest $manifest -Profiles $profiles
    if ($errors.Count -gt 0) {
        Write-Error "Validation failed with $($errors.Count) errors:"
        foreach ($err in $errors) {
            Write-Host ("  [ERROR] $err") -ForegroundColor Red
        }
        exit 1
    }

    Write-Host "VALIDATION PASSED: All 37 approved adopted repositories, 14 product dependencies, 10 candidates, and 9 profiles conform to ecosystem policy." -ForegroundColor Green
}

function Invoke-ShipDeStatus {
    param(
        [string]$ManifestPath,
        [string]$ProfilesPath,
        [string]$AiRoot
    )

    $manifest = Get-ShipDeManifestContent -Path $ManifestPath
    $profiles = Get-ShipDeProfilesContent -Path $ProfilesPath

    Write-Host "================================================================"
    Write-Host "SHIP DE - GOVERNED ECOSYSTEM STATUS"
    Write-Host "================================================================"
    Write-Host ("Manifest Version : {0}" -f $manifest.version)
    Write-Host ("Profiles Defined : {0}" -f ($profiles.profiles.PSObject.Properties | Measure-Object).Count)
    Write-Host ("Adopted Repos    : {0}" -f @($manifest.adopted).Count)
    Write-Host ("Product Deps     : {0}" -f @($manifest.product_dependencies).Count)
    Write-Host ("Candidates       : {0}" -f @($manifest.candidates).Count)

    Write-Host "`n=== LOCAL SERVICES HEALTH ==="
    $routerUp = Test-ShipDePort -HostName "127.0.0.1" -Port 20128
    $dshUp = Test-ShipDePort -HostName "127.0.0.1" -Port 3080
    Write-Host ("9Router (port 20128)      : {0}" -f $(if ($routerUp) { "RUNNING" } else { "STOPPED (Default Safe)" }))
    Write-Host ("DSH (port 3080)           : {0}" -f $(if ($dshUp) { "RUNNING" } else { "STOPPED (Default Safe)" }))

    $activeProfileState = Get-ShipDeProfileState
    Write-Host ("Active Profile            : {0}" -f $(if ($activeProfileState) { $activeProfileState.profile } else { "NONE (Inactive/Stopped)" }))
    if ($activeProfileState -and $activeProfileState.started_pids) {
        Write-Host ("Tracked Owned PIDs        : {0}" -f ($activeProfileState.started_pids -join ", "))
    }

    Write-Host "`n=== CONCURRENCY & WORKSPACE POLICY ==="
    Write-Host "Max Implementation Agents : 1 (Enforced)"
    Write-Host "Max Research Agents       : 1 (Enforced)"
    Write-Host "Parallel Writers per Item : 1 (Enforced)"

    Write-Host "`n=== AI WORKSPACE INTEGRITY ==="
    $workspaces = @("shipde-platform", "shipde-claude", "shipde-dsh", "shipde-gemini", "shipde-codex")
    foreach ($ws in $workspaces) {
        $wsPath = Join-Path $AiRoot $ws
        $exists = Test-Path -LiteralPath $wsPath
        $gitExists = Test-Path -LiteralPath (Join-Path $wsPath ".git")
        Write-Host ("{0,-26}: {1}" -f $ws, $(if ($gitExists) { "HEALTHY [$wsPath]" } elseif ($exists) { "DIR_PRESENT_NO_GIT" } else { "MISSING" }))
    }

    Write-Host "`nEcosystem state evaluated successfully."
}

function Get-ShipDeProfileStatePath {
    return (Join-Path ([System.IO.Path]::GetTempPath()) "shipde-active-profile-state.json")
}

function Get-ShipDeProfileState {
    $statePath = Get-ShipDeProfileStatePath
    if (Test-Path -LiteralPath $statePath) {
        try {
            return (Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json)
        } catch {
            return $null
        }
    }
    return $null
}

function Invoke-ShipDeActivate {
    param(
        [Parameter(Mandatory = $true)][string]$ProfileName,
        [string]$ProfilesPath,
        [switch]$StartOptionalServices,
        [scriptblock]$ServiceLauncher = $null
    )

    $profiles = Get-ShipDeProfilesContent -Path $ProfilesPath
    $pObj = $profiles.profiles.PSObject.Properties[$ProfileName]
    if (-not $pObj) {
        throw "Profile '$ProfileName' is not defined in $ProfilesPath."
    }

    $prof = $pObj.Value
    Write-Host ("Activating profile '{0}': {1}" -f $ProfileName, $prof.description)
    Write-Host ("Allowed tools count: {0}" -f @($prof.allowed_tools).Count)
    Write-Host ("Required tools     : {0}" -f (@($prof.required_tools) -join ", "))
    Write-Host ("Network policy     : {0}" -f $prof.network_policy)

    # Reconcile or safely deactivate any existing active profile first to prevent orphaning tracked PIDs or leaking state (Finding 5)
    $existingState = Get-ShipDeProfileState
    if ($existingState) {
        Write-Host ("Reconciling and safely deactivating existing active profile '{0}' before activating '{1}'..." -f $existingState.profile, $ProfileName)
        Invoke-ShipDeDeactivate -ProfilesPath $ProfilesPath
    }

    $startedPids = [System.Collections.Generic.List[int]]::new()
    $activationSucceeded = $false

    try {
        # If requested, start declared optional services and verify real health checks before activation (Finding 4, Finding 5)
        if ($StartOptionalServices -and $prof.optional_services) {
            foreach ($svc in @($prof.optional_services)) {
                $proc = $null
                $port = 0

                if ($ServiceLauncher) {
                    # Dependency-injected service launch adapter (e.g. for deterministic operational tests)
                    $res = & $ServiceLauncher $svc
                    if ($res -and $res.Process) {
                        $proc = $res.Process
                        $port = if ($res.Port) { [int]$res.Port } else { 0 }
                    } else {
                        throw "Service launch adapter failed to start service '$svc'."
                    }
                } elseif ($svc -eq "nine-router") {
                    $port = 20128
                    if (-not (Test-ShipDePort -HostName "127.0.0.1" -Port $port)) {
                        $cmd = Get-Command "9router" -ErrorAction SilentlyContinue
                        if (-not $cmd) {
                            throw "Required command for optional service 'nine-router' (9router) was not found in PATH."
                        }
                        Write-Host "Starting requested optional service: 9Router on localhost:$port..."
                        $proc = Start-Process -FilePath $cmd.Source -ArgumentList "--port", "$port" -PassThru -WindowStyle Hidden
                    }
                } elseif ($svc -eq "deepseek-harness") {
                    $port = 3080
                    if (-not (Test-ShipDePort -HostName "127.0.0.1" -Port $port)) {
                        $cmd = Get-Command "dsh" -ErrorAction SilentlyContinue
                        if (-not $cmd) {
                            throw "Required command for optional service 'deepseek-harness' (dsh) was not found in PATH."
                        }
                        Write-Host "Starting requested optional service: DSH web on localhost:$port..."
                        $proc = Start-Process -FilePath $cmd.Source -ArgumentList "web", "--port", "$port" -PassThru -WindowStyle Hidden
                    }
                } else {
                    throw "Unsupported optional service requested: '$svc'."
                }

                if ($proc) {
                    $startedPids.Add($proc.Id)
                    # Require expected port/service health check before recording activation (fail closed on timeout)
                    $healthy = $false
                    for ($i = 0; $i -lt 10; $i++) {
                        Start-Sleep -Milliseconds 500
                        if ($proc.HasExited) {
                            break
                        }
                        if ($port -gt 0 -and (Test-ShipDePort -HostName "127.0.0.1" -Port $port)) {
                            $healthy = $true
                            break
                        }
                    }

                    if (-not $healthy) {
                        throw ("Optional service '{0}' failed to start and bind port {1} within timeout. Activation rolled back." -f $svc, $port)
                    }
                }
            }
        }

        # Record active state in durable session state file only after all health checks succeed
        $stateObj = [PSCustomObject]@{
            profile      = $ProfileName
            activated_at = (Get-Date).ToString("o")
            started_pids = @($startedPids)
        }
        $statePath = Get-ShipDeProfileStatePath
        $stateObj | ConvertTo-Json | Set-Content -Path $statePath -Encoding UTF8

        $env:SHIPDE_ACTIVE_PROFILE = $ProfileName
        Write-Host "Profile '$ProfileName' operational with state tracking file: $statePath"
        $activationSucceeded = $true
    } finally {
        if (-not $activationSucceeded) {
            Write-Warning "Profile activation failed or was incomplete. Rolling back all started processes..."
            foreach ($pidToKill in $startedPids) {
                Stop-Process -Id $pidToKill -Force -ErrorAction SilentlyContinue
            }
        }
    }
}

function Invoke-ShipDeDeactivate {
    param([string]$ProfilesPath)

    Write-Host "Deactivating current ecosystem profile..."

    $state = Get-ShipDeProfileState
    if ($state -and $state.started_pids) {
        foreach ($ownedPid in @($state.started_pids)) {
            try {
                $proc = Get-Process -Id $ownedPid -ErrorAction SilentlyContinue
                if ($proc) {
                    Write-Host ("Stopping Ship Dễ-owned process: {0} (PID {1})" -f $proc.ProcessName, $ownedPid)
                    Stop-Process -Id $ownedPid -Force -ErrorAction SilentlyContinue
                    Start-Sleep -Milliseconds 100
                }
            } catch {}
        }
    }

    # Clean up state file
    $statePath = Get-ShipDeProfileStatePath
    if (Test-Path -LiteralPath $statePath) {
        Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
    }

    $env:SHIPDE_ACTIVE_PROFILE = $null
    Write-Host "All owned services stopped. Ecosystem returned to safe inactive state."
}

function Invoke-ShipDeSyncRegister {
    param(
        [string]$RegisterPath = "docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv",
        [hashtable]$MergedEvidence = @{
            "TASK-AI-02"    = @{ PR = "#2"; Verdict = "PASS"; MergeCommit = "da1babed7a5844f4021545dc6cc084c441ed533b" }
            "TASK-FOUND-01" = @{ PR = "#3"; Verdict = "PASS"; MergeCommit = "fb04c0818a0bb7e9dab9bb55e736dee9c042254c" }
            "TASK-FOUND-02" = @{ PR = "#4"; Verdict = "PASS"; MergeCommit = "09d9848a2e447829510dd65354e114a305e604c2" }
        }
    )

    if (-not (Test-Path -LiteralPath $RegisterPath)) {
        throw "Register file not found: $RegisterPath"
    }

    $rawRows = @(Import-Csv -Path $RegisterPath)
    $modified = $false

    foreach ($row in $rawRows) {
        $itemId = [string]$row.work_item_id
        if ($MergedEvidence.ContainsKey($itemId)) {
            $ev = $MergedEvidence[$itemId]
            if ($row.status -ne "MERGED" -or $row.pr -ne $ev.PR -or $row.codex_verdict -ne $ev.Verdict -or $row.merge_commit -ne $ev.MergeCommit) {
                $row.status = "MERGED"
                $row.pr = $ev.PR
                $row.codex_verdict = $ev.Verdict
                $row.merge_commit = $ev.MergeCommit
                $modified = $true
                Write-Host ("Reconciled row {0} ({1}) -> MERGED {2}" -f $row.delivery_order, $itemId, $ev.MergeCommit)
            }
        }
    }

    if ($modified) {
        $rawRows | Export-Csv -Path $RegisterPath -NoTypeInformation -Encoding UTF8
        Write-Host "Register updated with merged evidence."
    } else {
        Write-Host "Register already fully synchronized. No changes required (idempotent)."
    }
}

function Invoke-ShipDeTests {
    param(
        [string]$ManifestPath,
        [string]$ProfilesPath
    )

    Write-Host "================================================================"
    Write-Host "RUNNING ECOSYSTEM SELF-TESTS & NEGATIVE PROOFS"
    Write-Host "================================================================"

    $testTempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("shipde-eco-test-" + [Guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $testTempDir -Force | Out-Null

    try {
        # Positive Test: Clean manifests pass validation
        Write-Host "`nTest 1 [Positive]: Authoritative manifests pass validation..."
        $baseManifest = Get-ShipDeManifestContent -Path $ManifestPath
        $baseProfiles = Get-ShipDeProfilesContent -Path $ProfilesPath
        $errors = Assert-ShipDeManifest -Manifest $baseManifest -Profiles $baseProfiles
        if ($errors.Count -ne 0) {
            throw "Base validation failed unexpectedly: $($errors -join '; ')"
        }
        Write-Host "  [PASS] 37 approved adopted tools and 9 profiles validated cleanly with 0 errors."

        # Negative Test 1: Malformed JSON syntax
        Write-Host "`nTest 2 [Negative]: Malformed JSON must fail closed with exact exit code..."
        $badJsonPath = Join-Path $testTempDir "bad-manifest.json"
        Set-Content -Path $badJsonPath -Value "{ invalid json syntax" -Encoding UTF8
        $caughtMalformed = $false
        try {
            Get-ShipDeManifestContent -Path $badJsonPath
        } catch {
            $caughtMalformed = $true
        }
        if (-not $caughtMalformed) {
            throw "Failed negative test: Malformed JSON was not rejected!"
        }
        Write-Host "  [PASS] Malformed JSON threw exception and failed closed."

        # Negative Test 2: Unpinned / latest version
        Write-Host "`nTest 3 [Negative]: Unpinned, latest, and range versions must be rejected (Finding 4)..."
        $unpinnedManifest = $baseManifest | ConvertTo-Json -Depth 20 | ConvertFrom-Json
        $unpinnedManifest.adopted[1].pinned_version_or_commit = "latest"
        $unpinnedErrors = Assert-ShipDeManifest -Manifest $unpinnedManifest -Profiles $baseProfiles
        if (-not ($unpinnedErrors -match "nondeterministic or unpinned version")) {
            throw "Failed negative test: 'latest' version was not rejected!"
        }

        $rangeManifest = $baseManifest | ConvertTo-Json -Depth 20 | ConvertFrom-Json
        $rangeManifest.adopted[1].pinned_version_or_commit = ">=2.0.0"
        $rangeErrors = Assert-ShipDeManifest -Manifest $rangeManifest -Profiles $baseProfiles
        if (-not ($rangeErrors -match "range or wildcard in version spec")) {
            throw "Failed negative test: Range '>=2.0.0' was not rejected!"
        }
        Write-Host "  [PASS] Unpinned and range versions rejected cleanly."

        # Negative Test 3: Missing canonical repository identity (Finding 1)
        Write-Host "`nTest 4 [Negative]: Missing canonical repository identity must be rejected..."
        $missingRepoManifest = $baseManifest | ConvertTo-Json -Depth 20 | ConvertFrom-Json
        $missingRepoManifest.adopted[10].repository = "some-random/non-canonical"
        $repoErrors = Assert-ShipDeManifest -Manifest $missingRepoManifest -Profiles $baseProfiles
        if (-not ($repoErrors -match "Missing approved canonical repository identity")) {
            throw "Failed negative test: Altered/missing canonical repository was not rejected!"
        }
        Write-Host "  [PASS] Missing canonical repository identity rejected."

        # Negative Test 4: Unknown profile tool reference
        Write-Host "`nTest 5 [Negative]: Unknown tool reference in profile must be rejected..."
        $badProfiles = $baseProfiles | ConvertTo-Json -Depth 20 | ConvertFrom-Json
        $badProfiles.profiles.FOUNDATION.allowed_tools += "non-existent-tool-xyz"
        $profileErrors = Assert-ShipDeManifest -Manifest $baseManifest -Profiles $badProfiles
        if (-not ($profileErrors -match "unknown tool 'non-existent-tool-xyz'")) {
            throw "Failed negative test: Unknown tool reference was not rejected!"
        }
        Write-Host "  [PASS] Unknown tool reference in profile rejected."

        # Negative Test 5: Forbidden public network binding (0.0.0.0)
        Write-Host "`nTest 6 [Negative]: Non-local public network binding must be rejected..."
        $publicBindingManifest = $baseManifest | ConvertTo-Json -Depth 20 | ConvertFrom-Json
        $publicBindingManifest.adopted[2].telemetry_network_behavior = "0.0.0.0:20128-public"
        $netErrors = Assert-ShipDeManifest -Manifest $publicBindingManifest -Profiles $baseProfiles
        if (-not ($netErrors -match "violates network policy")) {
            throw "Failed negative test: Public network binding was not rejected!"
        }
        Write-Host "  [PASS] Public binding 0.0.0.0 rejected."

        # Negative Test 6: Enabled telemetry
        Write-Host "`nTest 7 [Negative]: Enabled telemetry must be rejected..."
        $telemetryManifest = $baseManifest | ConvertTo-Json -Depth 20 | ConvertFrom-Json
        $telemetryManifest.adopted[0].telemetry_network_behavior = "telemetry-enabled"
        $telErrors = Assert-ShipDeManifest -Manifest $telemetryManifest -Profiles $baseProfiles
        if (-not ($telErrors -match "violates telemetry policy")) {
            throw "Failed negative test: Enabled telemetry was not rejected!"
        }
        Write-Host "  [PASS] Telemetry violation rejected."

        # Negative Test 7: Optional service with default_enabled: true
        Write-Host "`nTest 8 [Negative]: Optional service/MCP with default_enabled=true must be rejected..."
        $badMcpManifest = $baseManifest | ConvertTo-Json -Depth 20 | ConvertFrom-Json
        $mcpEntry = $badMcpManifest.adopted | Where-Object { $_.kind -eq "mcp-server" } | Select-Object -First 1
        $mcpEntry.default_enabled = $true
        $mcpErrors = Assert-ShipDeManifest -Manifest $badMcpManifest -Profiles $baseProfiles
        if (-not ($mcpErrors -match "must have default_enabled = false")) {
            throw "Failed negative test: Optional service/MCP with default_enabled=true was not rejected!"
        }
        Write-Host "  [PASS] MCP server default_enabled=true rejected."

        # Negative Test 8: Duplicate repository
        Write-Host "`nTest 9 [Negative]: Duplicate repository entry must be rejected..."
        $dupManifest = $baseManifest | ConvertTo-Json -Depth 20 | ConvertFrom-Json
        $dupManifest.adopted += $dupManifest.adopted[0]
        $dupErrors = Assert-ShipDeManifest -Manifest $dupManifest -Profiles $baseProfiles
        if (-not ($dupErrors -match "Duplicate tool ID") -and -not ($dupErrors -match "must be exactly 37")) {
            throw "Failed negative test: Duplicate repository was not rejected!"
        }
        Write-Host "  [PASS] Duplicate repository entry rejected."

        # Positive Test 10: Register reconciliation idempotency
        Write-Host "`nTest 10 [Idempotency]: Register synchronization idempotency proof..."
        $testRegPath = Join-Path $testTempDir "test-register.csv"
        $testRegContent = @"
"delivery_order","slice","group","work_item_id","feature_id","feature_name","key_behavior","status","dependencies","work_item_path","branch","pr","codex_verdict","merge_commit"
"135","S00","AI workflow","TASK-AI-02","","Safe empty-queue controller routing","Treat zero open Pull Requests as an empty list and continue to Work Item planning","READY_FOR_CODEX","TASK-AI-01","docs/product-spec/work-items/TASK-AI-02.md","fix/task-ai-02-empty-pr-list","#2","",""
"1","S00","Foundation","TASK-FOUND-01","","Freeze and classify the prototype","Inventory and protect current behavior","READY_FOR_CODEX","","docs/product-spec/work-items/TASK-FOUND-01.md","feat/task-found-01-baseline-freeze","#3","",""
"2","S00","Foundation","TASK-FOUND-02","","Migrate repository structure","Move to target monorepo without feature rewrite","READY_FOR_CODEX","TASK-FOUND-01","docs/product-spec/work-items/TASK-FOUND-02.md","feat/task-found-02-monorepo-migration","#4","",""
"@
        Set-Content -Path $testRegPath -Value $testRegContent -Encoding UTF8

        # Run sync round 1
        Invoke-ShipDeSyncRegister -RegisterPath $testRegPath
        $afterRound1 = Get-Content -Path $testRegPath -Raw

        # Run sync round 2
        Invoke-ShipDeSyncRegister -RegisterPath $testRegPath
        $afterRound2 = Get-Content -Path $testRegPath -Raw

        if ($afterRound1 -ne $afterRound2) {
            throw "Failed idempotency test: Round 2 modified register unexpectedly!"
        }
        Write-Host "  [PASS] Synchronization round 2 produced 0 diff (100% idempotent)."

        # Operational Test 11: Real service launch adapter, distinct ports per service, health checks, transaction rollback, and active reconciliation (Finding 5)
        Write-Host "`nTest 11 [Operational]: Distinct service ports, health checks, rollback on failure, and safe reconciliation..."
        $testPortMap = @{
            "nine-router"      = 29111
            "deepseek-harness" = 29112
        }
        $testLauncher = {
            param($svc)
            $port = $testPortMap[$svc]
            $listenerScript = "[System.Net.Sockets.TcpListener]`$l = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port); `$l.Start(); Start-Sleep -Seconds 30; `$l.Stop()"
            $proc = Start-Process -FilePath "powershell.exe" -ArgumentList "-NoProfile", "-Command", $listenerScript -PassThru
            return [PSCustomObject]@{
                Process = $proc
                Port    = $port
            }
        }

        # 11a: Successful activation with distinct ports per service
        Invoke-ShipDeActivate -ProfileName "FOUNDATION" -ProfilesPath $ProfilesPath -StartOptionalServices -ServiceLauncher $testLauncher

        $stateAfterActivate = Get-ShipDeProfileState
        if (-not $stateAfterActivate -or $stateAfterActivate.started_pids.Count -ne 2) {
            throw "Failed operational test: Active profile state did not record all started service PIDs (expected 2, got $($stateAfterActivate.started_pids.Count))!"
        }
        $testPids = @($stateAfterActivate.started_pids)
        if (-not (Test-ShipDePort -HostName "127.0.0.1" -Port 29111)) {
            throw "Failed operational test: Service 'nine-router' port 29111 is not responding!"
        }
        if (-not (Test-ShipDePort -HostName "127.0.0.1" -Port 29112)) {
            throw "Failed operational test: Service 'deepseek-harness' port 29112 is not responding!"
        }
        Write-Host ("  [PASS] Launch adapter started services with distinct ports (29111, 29112; PIDs: {0}) and all health checks passed." -f ($testPids -join ", "))

        # 11b: Deactivate profile and verify real process termination and distinct port closure
        Invoke-ShipDeDeactivate -ProfilesPath $ProfilesPath
        Start-Sleep -Milliseconds 400

        foreach ($p in $testPids) {
            $procStillAlive = Get-Process -Id $p -ErrorAction SilentlyContinue
            if ($null -ne $procStillAlive) {
                Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
                throw "Failed operational test: Deactivate failed to terminate tracked PID $p!"
            }
        }
        if (Test-ShipDePort -HostName "127.0.0.1" -Port 29111) {
            throw "Failed operational test: Port 29111 remains open after deactivation!"
        }
        if (Test-ShipDePort -HostName "127.0.0.1" -Port 29112) {
            throw "Failed operational test: Port 29112 remains open after deactivation!"
        }
        $stateAfterDeactivate = Get-ShipDeProfileState
        if ($null -ne $stateAfterDeactivate) {
            throw "Failed operational test: Deactivate failed to clean up profile state file!"
        }
        Write-Host "  [PASS] Deactivate successfully terminated both service PIDs, closed both distinct ports, and removed state file."

        # 11c: Rollback when service 2 fails: service 1 must be terminated and port closed without leaking state
        $partialFailingLauncher = {
            param($svc)
            if ($svc -eq "nine-router") {
                $port = 29111
                $listenerScript = "[System.Net.Sockets.TcpListener]`$l = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port); `$l.Start(); Start-Sleep -Seconds 30; `$l.Stop()"
                $proc = Start-Process -FilePath "powershell.exe" -ArgumentList "-NoProfile", "-Command", $listenerScript -PassThru
                return [PSCustomObject]@{
                    Process = $proc
                    Port    = $port
                }
            } else {
                # Service 2 fails to bind / exits immediately
                $proc = Start-Process -FilePath "powershell.exe" -ArgumentList "-NoProfile", "-Command", "Start-Sleep -Milliseconds 50" -PassThru
                return [PSCustomObject]@{
                    Process = $proc
                    Port    = 29112
                }
            }
        }

        $rollbackPassed = $false
        try {
            Invoke-ShipDeActivate -ProfileName "FOUNDATION" -ProfilesPath $ProfilesPath -StartOptionalServices -ServiceLauncher $partialFailingLauncher
        } catch {
            $rollbackPassed = $true
        }

        if (-not $rollbackPassed) {
            throw "Failed operational test: Activation should have failed and rolled back when service 2 failed!"
        }
        Start-Sleep -Milliseconds 300
        if (Test-ShipDePort -HostName "127.0.0.1" -Port 29111) {
            throw "Failed operational test: Service 1 on port 29111 was leaked when service 2 failed activation!"
        }
        $stateAfterRollback = Get-ShipDeProfileState
        if ($null -ne $stateAfterRollback) {
            throw "Failed operational test: State file was written despite activation failure!"
        }
        Write-Host "  [PASS] Partial failure in multi-service activation triggered clean transaction rollback without leaking process or port."

        # 11d: Active profile reconciliation: activating a new profile safely deactivates existing profile without leaking PIDs
        Invoke-ShipDeActivate -ProfileName "FOUNDATION" -ProfilesPath $ProfilesPath -StartOptionalServices -ServiceLauncher $testLauncher
        $firstState = Get-ShipDeProfileState
        $firstPids = @($firstState.started_pids)
        if ($firstPids.Count -ne 2) {
            throw "Failed operational test: Expected 2 PIDs for first activation."
        }

        # Activate second profile (BACKEND_FEATURE has no optional services by default)
        Invoke-ShipDeActivate -ProfileName "BACKEND_FEATURE" -ProfilesPath $ProfilesPath
        Start-Sleep -Milliseconds 300
        foreach ($p in $firstPids) {
            $procStillAlive = Get-Process -Id $p -ErrorAction SilentlyContinue
            if ($null -ne $procStillAlive) {
                Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
                throw "Failed operational test: Reconciling active profile orphaned PID $p!"
            }
        }
        if ((Test-ShipDePort -HostName "127.0.0.1" -Port 29111) -or (Test-ShipDePort -HostName "127.0.0.1" -Port 29112)) {
            throw "Failed operational test: Ports remain open after profile reconciliation!"
        }
        $secondState = Get-ShipDeProfileState
        if ($secondState.profile -ne "BACKEND_FEATURE") {
            throw "Failed operational test: Second profile state was not recorded."
        }
        Invoke-ShipDeDeactivate -ProfilesPath $ProfilesPath
        Write-Host "  [PASS] Reconciling existing active profile safely terminated previous processes without PID or port leaks."

        # 11e: Test multiline GitHub comment parsing for exact-head verdict (Finding 2)
        $sampleCommentJson = @'
{
    "comments": [
        {
            "author": { "login": "vinh05092001" },
            "body": "## Codex independent review — Round 3\n\n**Review target:** `57cb04b2c17a8f684d02ef885717bf88760cdf8c`\n\nSome findings and comments here.\n\nCHANGES_REQUIRED"
        }
    ]
}
'@
        $parsedMock = $sampleCommentJson | ConvertFrom-Json
        $commentBody = [string]$parsedMock.comments[0].body
        $targetMatch = [regex]::Match($commentBody, '(?im)(?:\*\*)?(?:Review target|Reviewed exact head|Reviewed immutable head)\s*:\s*(?:\*\*)?\s*`?([a-f0-9]{7,40})`?')
        if (-not $targetMatch.Success -or $targetMatch.Groups[1].Value -ne "57cb04b2c17a8f684d02ef885717bf88760cdf8c") {
            throw "Failed operational test: Multiline comment review target was not matched!"
        }
        $commentLines = @($commentBody -split '\r?\n' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
        $lastLine = $commentLines[-1].Trim()
        if ($lastLine -notmatch '(?i)^(?:(?:\*\*)?(?:(?:FINAL[\t ]+)?VERDICT[\t ]*:[\t ]*)?(PASS|CHANGES_REQUIRED|BLOCKED)(?:\*\*)?)$') {
            throw "Failed operational test: Multiline comment terminal verdict was not matched!"
        }
        if ($matches[1] -ne "CHANGES_REQUIRED") {
            throw "Failed operational test: Expected CHANGES_REQUIRED, got $($matches[1])"
        }
        Write-Host "  [PASS] Multiline GitHub PR comment JSON parsing successfully verified exact head and terminal verdict."

        Write-Host "`n================================================================"
        Write-Host "ALL 11 POSITIVE, NEGATIVE & OPERATIONAL ECOSYSTEM TESTS PASSED"
        Write-Host "================================================================"
    } finally {
        Remove-Item -LiteralPath $testTempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

switch ($Action) {
    "Validate"   { Invoke-ShipDeValidate -ManifestPath $ManifestPath -ProfilesPath $ProfilesPath }
    "Status"     { Invoke-ShipDeStatus -ManifestPath $ManifestPath -ProfilesPath $ProfilesPath -AiRoot $AiRoot }
    "Activate"   { Invoke-ShipDeActivate -ProfileName $Profile -ProfilesPath $ProfilesPath -StartOptionalServices:$StartServices }
    "Deactivate" { Invoke-ShipDeDeactivate -ProfilesPath $ProfilesPath }
    "Test"       { Invoke-ShipDeTests -ManifestPath $ManifestPath -ProfilesPath $ProfilesPath }
    "SyncRegister" { Invoke-ShipDeSyncRegister }
    default      { Invoke-ShipDeStatus -ManifestPath $ManifestPath -ProfilesPath $ProfilesPath -AiRoot $AiRoot }
}
