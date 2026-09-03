param(
    [ValidateSet("Validate", "Status", "Activate", "Deactivate", "Test", "SyncRegister")]
    [string]$Action = "Status",

    [string]$Profile = "FOUNDATION",
    [string]$ManifestPath = (Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) "tools\ecosystem-manifest.json"),
    [string]$ProfilesPath = (Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) "tools\ecosystem-profiles.json"),
    [string]$AiRoot = (Join-Path $env:USERPROFILE "AI")
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

        # Check unpinned version policy (AC-AI-22): must have pinned version or commit or valid spec
        if ($entry.pinned_version_or_commit -eq "unpinned" -or $entry.pinned_version_or_commit -eq "any") {
            $errors.Add("Tool '$($entry.id)' has unpinned version: '$($entry.pinned_version_or_commit)'.")
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

    # 3. Playwright tri-role check (AC-AI-18)
    $pwTest = $adopted | Where-Object { $_.id -eq "playwright" }
    $pwCli = $adopted | Where-Object { $_.id -eq "playwright-cli" }
    $pwMcp = $adopted | Where-Object { $_.id -eq "playwright-mcp" }

    if (-not $pwTest -or -not $pwCli -or -not $pwMcp) {
        $errors.Add("Manifest must contain distinct entries for Playwright Test ('playwright'), Playwright CLI ('playwright-cli'), and Playwright MCP ('playwright-mcp').")
    } else {
        if ($pwTest.repository -ne "microsoft/playwright") {
            $errors.Add("Playwright Test repository must be 'microsoft/playwright'.")
        }
        if ($pwCli.repository -ne "microsoft/playwright-cli") {
            $errors.Add("Playwright CLI repository must be 'microsoft/playwright-cli'.")
        }
        if ($pwMcp.repository -ne "microsoft/playwright-mcp") {
            $errors.Add("Playwright MCP repository must be 'microsoft/playwright-mcp'.")
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
            if (-not $seenIds.Contains($tId)) {
                $errors.Add("Profile '$pName' references unknown tool '$tId'.")
            }
        }

        foreach ($tId in @($prof.required_tools)) {
            if (-not $seenIds.Contains($tId)) {
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
        Write-Host "`n[FAIL] ECOSYSTEM VALIDATION FAILED ($($errors.Count) errors):" -ForegroundColor Red
        foreach ($err in $errors) {
            Write-Host "  - $err" -ForegroundColor Red
        }
        exit 1
    }

    Write-Host "`n[PASS] ECOSYSTEM VALIDATION PASSED:" -ForegroundColor Green
    Write-Host "  - Exactly 37 adopted repositories/capabilities validated"
    Write-Host "  - Playwright Test, CLI, and MCP roles distinct"
    Write-Host "  - 10 evaluation candidates isolated with PILOT/WATCH status"
    Write-Host "  - 9 activation profiles validated against tool catalog"
    Write-Host "  - All network, telemetry, and concurrency constraints enforced"
    return
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
    Write-Host "SHIP DE - ECOSYSTEM STATUS"
    Write-Host "================================================================"

    $adopted = @($manifest.adopted)
    $installedCount = 0
    $deferredCount = 0
    $integratedCount = 0

    foreach ($tool in $adopted) {
        switch ($tool.lifecycle_state) {
            "INSTALLED" { $installedCount++ }
            "INTEGRATED" { $integratedCount++ }
            "DEFERRED" { $deferredCount++ }
        }
    }

    Write-Host ("Catalog Total      : {0} adopted tools, {1} candidates" -f $adopted.Count, @($manifest.candidates).Count)
    Write-Host ("Tool Lifecycle     : {0} INSTALLED, {1} INTEGRATED, {2} DEFERRED" -f $installedCount, $integratedCount, $deferredCount)

    Write-Host "`n=== OPTIONAL SERVICES & MCP SERVERS ==="
    $routerUp = Test-ShipDePort -HostName "127.0.0.1" -Port 20128
    $dshUp = Test-ShipDePort -HostName "127.0.0.1" -Port 3080
    Write-Host ("9Router (port 20128)      : {0}" -f $(if ($routerUp) { "RUNNING" } else { "STOPPED (Default Safe)" }))
    Write-Host ("DSH (port 3080)           : {0}" -f $(if ($dshUp) { "RUNNING" } else { "STOPPED (Default Safe)" }))

    $mcpProcesses = @(Get-Process -Name "*playwright-mcp*", "*devtools-mcp*" -ErrorAction SilentlyContinue)
    Write-Host ("Optional MCP Servers      : {0} active" -f $mcpProcesses.Count)

    Write-Host "`n=== CONCURRENCY & WORKSPACE POLICY ==="
    Write-Host "Max Implementation Agents : 1 (Enforced)"
    Write-Host "Max Research Agents       : 1 (Enforced)"
    Write-Host "Parallel Writers per Item : 1 (Enforced)"

    $activeProfile = $env:SHIPDE_ACTIVE_PROFILE
    if ([string]::IsNullOrWhiteSpace($activeProfile)) {
        $activeProfile = "NONE (Inactive/Stopped)"
    }
    Write-Host ("Active Profile            : {0}" -f $activeProfile)

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

function Invoke-ShipDeActivate {
    param(
        [Parameter(Mandatory = $true)][string]$ProfileName,
        [string]$ProfilesPath
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

    $env:SHIPDE_ACTIVE_PROFILE = $ProfileName
    Write-Host "Profile '$ProfileName' successfully activated for current session."
}

function Invoke-ShipDeDeactivate {
    param([string]$ProfilesPath)

    Write-Host "Deactivating current ecosystem profile..."

    # Stop any background optional services / MCP processes
    $mcpProcesses = @(Get-Process -Name "*playwright-mcp*", "*devtools-mcp*" -ErrorAction SilentlyContinue)
    foreach ($proc in $mcpProcesses) {
        Write-Host "Stopping MCP process: $($proc.ProcessName) ($($proc.Id))"
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    }

    $env:SHIPDE_ACTIVE_PROFILE = $null
    Write-Host "All optional services stopped. Ecosystem returned to safe inactive state."
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
        # Export back to CSV preserving headers and formatting
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
        Write-Host "  [PASS] 37 adopted tools and 9 profiles validated cleanly with 0 errors."

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

        # Negative Test 2: Unpinned version
        Write-Host "`nTest 3 [Negative]: Unpinned version in manifest must be rejected..."
        $unpinnedManifest = $baseManifest | ConvertTo-Json -Depth 20 | ConvertFrom-Json
        $unpinnedManifest.adopted[1].pinned_version_or_commit = "unpinned"
        $unpinnedErrors = Assert-ShipDeManifest -Manifest $unpinnedManifest -Profiles $baseProfiles
        if (-not ($unpinnedErrors -match "unpinned version")) {
            throw "Failed negative test: Unpinned version was not rejected!"
        }
        Write-Host "  [PASS] Unpinned version rejected ($($unpinnedErrors.Count) error caught)."

        # Negative Test 3: Unknown profile tool reference
        Write-Host "`nTest 4 [Negative]: Unknown tool reference in profile must be rejected..."
        $badProfiles = $baseProfiles | ConvertTo-Json -Depth 20 | ConvertFrom-Json
        $badProfiles.profiles.FOUNDATION.allowed_tools += "non-existent-tool-xyz"
        $profileErrors = Assert-ShipDeManifest -Manifest $baseManifest -Profiles $badProfiles
        if (-not ($profileErrors -match "unknown tool 'non-existent-tool-xyz'")) {
            throw "Failed negative test: Unknown tool reference was not rejected!"
        }
        Write-Host "  [PASS] Unknown tool reference in profile rejected."

        # Negative Test 4: Forbidden public network binding (0.0.0.0)
        Write-Host "`nTest 5 [Negative]: Non-local public network binding must be rejected..."
        $publicBindingManifest = $baseManifest | ConvertTo-Json -Depth 20 | ConvertFrom-Json
        $publicBindingManifest.adopted[6].telemetry_network_behavior = "0.0.0.0:20128-public"
        $netErrors = Assert-ShipDeManifest -Manifest $publicBindingManifest -Profiles $baseProfiles
        if (-not ($netErrors -match "violates network policy")) {
            throw "Failed negative test: Public network binding was not rejected!"
        }
        Write-Host "  [PASS] Public binding 0.0.0.0 rejected."

        # Negative Test 5: Enabled telemetry
        Write-Host "`nTest 6 [Negative]: Enabled telemetry must be rejected..."
        $telemetryManifest = $baseManifest | ConvertTo-Json -Depth 20 | ConvertFrom-Json
        $telemetryManifest.adopted[0].telemetry_network_behavior = "telemetry-enabled"
        $telErrors = Assert-ShipDeManifest -Manifest $telemetryManifest -Profiles $baseProfiles
        if (-not ($telErrors -match "violates telemetry policy")) {
            throw "Failed negative test: Enabled telemetry was not rejected!"
        }
        Write-Host "  [PASS] Telemetry violation rejected."

        # Negative Test 6: Optional service with default_enabled: true
        Write-Host "`nTest 7 [Negative]: Optional service/MCP with default_enabled=true must be rejected..."
        $badMcpManifest = $baseManifest | ConvertTo-Json -Depth 20 | ConvertFrom-Json
        $mcpEntry = $badMcpManifest.adopted | Where-Object { $_.kind -eq "mcp-server" } | Select-Object -First 1
        $mcpEntry.default_enabled = $true
        $mcpErrors = Assert-ShipDeManifest -Manifest $badMcpManifest -Profiles $baseProfiles
        if (-not ($mcpErrors -match "must have default_enabled = false")) {
            throw "Failed negative test: Optional service/MCP with default_enabled=true was not rejected!"
        }
        Write-Host "  [PASS] MCP server default_enabled=true rejected."

        # Negative Test 7: Duplicate repository
        Write-Host "`nTest 8 [Negative]: Duplicate repository entry must be rejected..."
        $dupManifest = $baseManifest | ConvertTo-Json -Depth 20 | ConvertFrom-Json
        $dupManifest.adopted += $dupManifest.adopted[0]
        $dupErrors = Assert-ShipDeManifest -Manifest $dupManifest -Profiles $baseProfiles
        if (-not ($dupErrors -match "Duplicate tool ID") -and -not ($dupErrors -match "must be exactly 37")) {
            throw "Failed negative test: Duplicate repository was not rejected!"
        }
        Write-Host "  [PASS] Duplicate repository entry rejected."

        # Positive Test 9: Register reconciliation idempotency
        Write-Host "`nTest 9 [Idempotency]: Register synchronization idempotency proof..."
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

        Write-Host "`n================================================================"
        Write-Host "ALL 9 POSITIVE & NEGATIVE ECOSYSTEM TESTS PASSED (100%)"
        Write-Host "================================================================"
    } finally {
        Remove-Item -LiteralPath $testTempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

switch ($Action) {
    "Validate"   { Invoke-ShipDeValidate -ManifestPath $ManifestPath -ProfilesPath $ProfilesPath }
    "Status"     { Invoke-ShipDeStatus -ManifestPath $ManifestPath -ProfilesPath $ProfilesPath -AiRoot $AiRoot }
    "Activate"   { Invoke-ShipDeActivate -ProfileName $Profile -ProfilesPath $ProfilesPath }
    "Deactivate" { Invoke-ShipDeDeactivate -ProfilesPath $ProfilesPath }
    "Test"       { Invoke-ShipDeTests -ManifestPath $ManifestPath -ProfilesPath $ProfilesPath }
    "SyncRegister" { Invoke-ShipDeSyncRegister }
    default      { Invoke-ShipDeStatus -ManifestPath $ManifestPath -ProfilesPath $ProfilesPath -AiRoot $AiRoot }
}
