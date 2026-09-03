param(
    [string]$AiRoot = (Join-Path $env:USERPROFILE "AI"),
    [switch]$TestDocker,
    [switch]$TestModels
)

. (Join-Path $PSScriptRoot "common.ps1")

$failures = [System.Collections.Generic.List[string]]::new()
$commands = @("git", "gh", "node", "npm", "pnpm", "docker", "dsh", "9router", "gemini", "codex", "claude")

function Invoke-ShipDeBoundedProbe {
    param(
        [Parameter(Mandatory = $true)][string]$CommandText,
        [int]$TimeoutSeconds = 60
    )

    $stdoutPath = Join-Path ([IO.Path]::GetTempPath()) ("shipde-probe-{0}.out" -f [Guid]::NewGuid())
    $stderrPath = Join-Path ([IO.Path]::GetTempPath()) ("shipde-probe-{0}.err" -f [Guid]::NewGuid())
    $encodedCommand = [Convert]::ToBase64String(
        [System.Text.Encoding]::Unicode.GetBytes($CommandText)
    )
    $process = $null
    try {
        $process = Start-Process -FilePath "powershell.exe" -ArgumentList @(
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-EncodedCommand",
            $encodedCommand
        ) -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru -WindowStyle Hidden

        if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
            # Stop the wrapper and every CLI process it spawned. Killing only
            # powershell.exe can leave a detached agent process running.
            $taskKill = Get-Command taskkill.exe -ErrorAction SilentlyContinue
            if ($taskKill) {
                & $taskKill.Source /PID $process.Id /T /F 2>$null | Out-Null
            } else {
                Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
            }
            if (-not $process.HasExited) {
                Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
            }
            $null = $process.WaitForExit(5000)
            return [PSCustomObject]@{
                ExitCode = -1
                TimedOut = $true
                Output = ""
            }
        }

        $stdout = if (Test-Path $stdoutPath) {
            Get-Content $stdoutPath -Raw -ErrorAction SilentlyContinue
        } else {
            ""
        }
        $stderr = if (Test-Path $stderrPath) {
            Get-Content $stderrPath -Raw -ErrorAction SilentlyContinue
        } else {
            ""
        }
        return [PSCustomObject]@{
            ExitCode = $process.ExitCode
            TimedOut = $false
            Output = $stdout + [Environment]::NewLine + $stderr
        }
    } finally {
        if ($process) {
            $process.Dispose()
        }
        Remove-Item -LiteralPath $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "=== COMMANDS ==="
foreach ($command in $commands) {
    $resolved = Get-Command $command -ErrorAction SilentlyContinue
    if ($resolved) {
        Write-Host ("{0,-10} OK  {1}" -f $command, $resolved.Source)
    } else {
        Write-Host ("{0,-10} MISSING" -f $command)
        $failures.Add("Missing command: $command")
    }
}

if (Get-Command node -ErrorAction SilentlyContinue) {
    $nodeVersion = (& node --version).Trim()
    Write-Host ("Node version: {0}" -f $nodeVersion)
    if ($nodeVersion -notmatch "^v24\.") {
        $failures.Add("Node.js $nodeVersion does not match the approved v24 workstation baseline")
    }
}

Write-Host "`n=== GLOBAL NPM VERSIONS ==="
if (Get-Command npm -ErrorAction SilentlyContinue) {
    $npmPackages = @("pnpm", "9router", "@deepseek-ai/dsh", "@google/gemini-cli", "@openai/codex", "@anthropic-ai/claude-code")
    foreach ($package in $npmPackages) {
        $raw = @(& npm list --global $package --depth=0 --json 2>$null) -join "`n"
        $version = $null
        if (-not [string]::IsNullOrWhiteSpace($raw)) {
            try {
                $parsed = $raw | ConvertFrom-Json
                if ($parsed.dependencies) {
                    $property = $parsed.dependencies.PSObject.Properties[$package]
                    if ($property) {
                        $version = [string]$property.Value.version
                    }
                }
            } catch {
                $version = $null
            }
        }
        Write-Host ("{0,-24} {1}" -f $package, $(if ($version) { $version } else { "NOT INSTALLED" }))
    }
}

Write-Host "`n=== OPTIONAL/ALTERNATE CLIENTS ==="
$agyCommand = Get-Command agy -ErrorAction SilentlyContinue
Write-Host ("Antigravity CLI: {0}" -f $(if ($agyCommand) { "OK  $($agyCommand.Source)" } else { "NOT INSTALLED; Gemini CLI fallback remains available" }))

$agentRouterSaved = -not [string]::IsNullOrWhiteSpace(
    [Environment]::GetEnvironmentVariable("AGENTROUTER_API_KEY", "User")
)
Write-Host ("AgentRouter user credential: {0}" -f $(if ($agentRouterSaved) { "CONFIGURED" } else { "NOT CONFIGURED; Claude account authentication will be checked" }))

Write-Host ""
Write-Host "=== AGENT AUTHENTICATION ==="
Write-Host "Bounded agent probes may use one minimal model request for the selected Google and AgentRouter routes."
if (Get-Command codex -ErrorAction SilentlyContinue) {
    $codexProbe = Invoke-ShipDeBoundedProbe -CommandText "& codex login status" -TimeoutSeconds 30
    if ($codexProbe.TimedOut -or $codexProbe.ExitCode -ne 0 -or $codexProbe.Output -match "(?i)not logged in") {
        Write-Host "Codex: NOT AUTHENTICATED"
        $failures.Add("Codex authentication check failed; run codex login")
    } else {
        Write-Host "Codex: AUTHENTICATED"
    }
}

$googleCommand = $null
$googleProbe = $null
if (Get-Command agy -ErrorAction SilentlyContinue) {
    $googleCommand = "agy"
    $googleProbe = Invoke-ShipDeBoundedProbe -CommandText "& agy --print-timeout 45s --print 'Reply exactly: SHIPDE_AUTH_OK' --output-format text" -TimeoutSeconds 60
} elseif (Get-Command gemini -ErrorAction SilentlyContinue) {
    $googleCommand = "gemini"
    $googleProbe = Invoke-ShipDeBoundedProbe -CommandText "& gemini --prompt 'Reply exactly: SHIPDE_AUTH_OK' --output-format text" -TimeoutSeconds 60
}
if ($googleCommand) {
    if ($googleProbe.TimedOut -or $googleProbe.ExitCode -ne 0 -or $googleProbe.Output -notmatch "SHIPDE_AUTH_OK") {
        Write-Host ("{0}: NOT AUTHENTICATED OR UNREACHABLE" -f $googleCommand)
        $failures.Add("$googleCommand authentication smoke test failed")
    } else {
        Write-Host ("{0}: AUTHENTICATED" -f $googleCommand)
    }
}

if (Get-Command claude -ErrorAction SilentlyContinue) {
    $claudeEnvironmentNames = @(
        "ANTHROPIC_AUTH_TOKEN",
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_BASE_URL",
        "ANTHROPIC_MODEL",
        "CLAUDE_CONFIG_DIR",
        "CLAUDE_CODE_USE_VERTEX",
        "ANTHROPIC_VERTEX_PROJECT_ID",
        "ANTHROPIC_VERTEX_BASE_URL",
        "CLOUD_ML_REGION",
        "GOOGLE_APPLICATION_CREDENTIALS",
        "GCLOUD_PROJECT",
        "GOOGLE_CLOUD_PROJECT",
        "CLAUDE_CODE_USE_BEDROCK",
        "CLAUDE_CODE_USE_FOUNDRY",
        "CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST"
    )
    $originalClaudeEnvironment = @{}
    foreach ($name in $claudeEnvironmentNames) {
        $item = Get-Item "Env:$name" -ErrorAction SilentlyContinue
        $originalClaudeEnvironment[$name] = if ($item) { $item.Value } else { $null }
    }

    $claudeHealthy = $false
    try {
        if ($agentRouterSaved) {
            foreach ($name in $claudeEnvironmentNames) {
                Remove-Item "Env:$name" -ErrorAction SilentlyContinue
            }
            $env:ANTHROPIC_AUTH_TOKEN = [Environment]::GetEnvironmentVariable(
                "AGENTROUTER_API_KEY",
                "User"
            )
            $env:ANTHROPIC_BASE_URL = "https://agentrouter.org/"
            $env:ANTHROPIC_MODEL = "claude-opus-4-8"
            $env:CLAUDE_CONFIG_DIR = Join-Path $env:USERPROFILE ".claude-agentrouter-old"
            $claudeProbe = Invoke-ShipDeBoundedProbe -CommandText "& claude -p 'Reply exactly: SHIPDE_AUTH_OK' --model claude-opus-4-8 --output-format text --max-turns 1" -TimeoutSeconds 60
            $claudeHealthy = (
                -not $claudeProbe.TimedOut -and
                $claudeProbe.ExitCode -eq 0 -and
                $claudeProbe.Output -match "SHIPDE_AUTH_OK"
            )
        } else {
            $claudeProbe = Invoke-ShipDeBoundedProbe -CommandText "& claude auth status --text" -TimeoutSeconds 30
            $claudeHealthy = (
                -not $claudeProbe.TimedOut -and
                $claudeProbe.ExitCode -eq 0
            )
        }
    } finally {
        foreach ($name in $claudeEnvironmentNames) {
            $value = $originalClaudeEnvironment[$name]
            if ($null -eq $value) {
                Remove-Item "Env:$name" -ErrorAction SilentlyContinue
            } else {
                Set-Item "Env:$name" -Value $value
            }
        }
    }

    if ($claudeHealthy) {
        Write-Host "Claude: AUTHENTICATED"
    } else {
        Write-Host "Claude: NOT AUTHENTICATED OR UNREACHABLE"
        $failures.Add("Claude authentication check failed")
    }
}

Write-Host "`n=== GITHUB ==="
if (Get-Command gh -ErrorAction SilentlyContinue) {
    & gh auth status
    if ($LASTEXITCODE -ne 0) {
        $failures.Add("GitHub CLI authentication failed")
    }
}

Write-Host "`n=== WORKTREES ==="
$paths = Get-ShipDePaths -AiRoot $AiRoot
foreach ($entry in $paths.GetEnumerator()) {
    if (-not (Test-Path (Join-Path $entry.Value ".git"))) {
        Write-Host ("{0,-8} MISSING  {1}" -f $entry.Key, $entry.Value)
        $failures.Add("Missing worktree: $($entry.Value)")
        continue
    }

    $branch = (& git -C $entry.Value branch --show-current).Trim()
    $status = @(& git -C $entry.Value status --porcelain)
    $state = if ($status.Count -eq 0) { "CLEAN" } else { "DIRTY" }
    Write-Host ("{0,-8} {1,-6} [{2}] {3}" -f $entry.Key, $state, $branch, $entry.Value)
    if ($state -eq "DIRTY") {
        $failures.Add("Dirty worktree: $($entry.Value)")
    }
}

Write-Host "`n=== DOCKER ==="
if (Get-Command docker -ErrorAction SilentlyContinue) {
    & docker compose version
    if ($LASTEXITCODE -ne 0) {
        $failures.Add("Docker Compose plugin is unavailable")
    }
    if ($TestDocker) {
        & docker info --format "Docker server: {{.ServerVersion}}"
        if ($LASTEXITCODE -ne 0) {
            $failures.Add("Docker Desktop is installed but its engine is not reachable")
        }
    }
} else {
    Write-Host "Docker CLI: MISSING"
}

Write-Host "`n=== LOCAL SERVICES ==="
$routerUp = Test-ShipDeTcpPort -HostName "127.0.0.1" -Port 20128
$dshUp = Test-ShipDeTcpPort -HostName "127.0.0.1" -Port 3080
Write-Host ("9Router 20128: {0}" -f $(if ($routerUp) { "UP" } else { "STOPPED" }))
Write-Host ("DSH     3080: {0}" -f $(if ($dshUp) { "UP" } else { "STOPPED" }))

if ($TestModels) {
    if (-not $routerUp) {
        $failures.Add("Cannot test models because 9Router is stopped")
    } else {
        $secureKey = Read-Host "Paste 9Router API key" -AsSecureString
        $keyPtr = [IntPtr]::Zero
        try {
            $keyPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
            $plainKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPtr)
            $headers = @{ Authorization = "Bearer $plainKey" }
            $response = Invoke-RestMethod -Uri "http://127.0.0.1:20128/v1/models" -Headers $headers -Method Get -TimeoutSec 30
            $ids = @($response.data | ForEach-Object { $_.id })
            Write-Host ("Available models: {0}" -f $ids.Count)
            $combo = "shipde-low-risk"
            $candidates = @(
                "oc/deepseek-v4-flash-free",
                "oc/mimo-v2.5-free",
                "oc/nemotron-3-ultra-free"
            )
            foreach ($candidate in @($combo) + $candidates) {
                Write-Host ("{0,-36} {1}" -f $candidate, $(if ($ids -contains $candidate) { "AVAILABLE" } else { "NOT RETURNED" }))
            }
            $smokeModel = if ($ids -contains $combo) {
                $combo
            } else {
                $candidates | Where-Object { $ids -contains $_ } | Select-Object -First 1
            }
            if (-not $smokeModel) {
                throw "No approved Ship De low-risk model is currently available"
            }
            if ($ids -notcontains $combo) {
                Write-Warning "shipde-low-risk combo is not returned; using verified candidate $smokeModel for the smoke test"
            }

            $smokeBody = @{
                model = $smokeModel
                messages = @(
                    @{ role = "user"; content = "Reply exactly: SHIPDE_OK" }
                )
                temperature = 0
                max_tokens = 16
            } | ConvertTo-Json -Depth 5
            $smoke = Invoke-RestMethod `
                -Uri "http://127.0.0.1:20128/v1/chat/completions" `
                -Headers $headers `
                -Method Post `
                -ContentType "application/json" `
                -Body $smokeBody `
                -TimeoutSec 30
            $reply = [string]$smoke.choices[0].message.content
            if ($reply.Trim() -ne "SHIPDE_OK") {
                throw "Model smoke test returned an unexpected response"
            }
            Write-Host ("Model smoke test: PASS ({0})" -f $smokeModel)
        } catch {
            $failures.Add("9Router model request failed: $($_.Exception.Message)")
        } finally {
            if ($keyPtr -ne [IntPtr]::Zero) {
                [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPtr)
            }
            Remove-Variable plainKey, headers, secureKey, smokeBody, smoke, reply -ErrorAction SilentlyContinue
        }
    }
}

Write-Host "`n=== GOVERNED ECOSYSTEM & HEALTH CHECKS ==="
$ecosystemScript = Join-Path $PSScriptRoot "ecosystem.ps1"
if (Test-Path -LiteralPath $ecosystemScript) {
    try {
        & $ecosystemScript -Action Validate | Out-Null
        Write-Host "Ecosystem manifest & profiles: VALIDATED (37 adopted tools, 9 profiles)"
    } catch {
        Write-Host "Ecosystem manifest & profiles: INVALID"
        $failures.Add("Ecosystem validation failed")
    }
}

# AI-TOOL-02: Optional services and MCP servers must be stopped by default
$unmanagedMcp = @(Get-Process -Name "*playwright-mcp*", "*devtools-mcp*" -ErrorAction SilentlyContinue)
if ($unmanagedMcp.Count -gt 0 -and [string]::IsNullOrWhiteSpace($env:SHIPDE_ACTIVE_PROFILE)) {
    Write-Host ("Warning: {0} optional MCP processes are running without an active profile" -f $unmanagedMcp.Count)
    $failures.Add("Optional MCP servers must remain stopped by default when no profile is active")
} else {
    Write-Host "Optional MCP servers: STOPPED (Default Safe)"
}

# Workspace path containment check
$rootCanonical = (Resolve-Path $AiRoot -ErrorAction SilentlyContinue).Path
$pathsOutside = [System.Collections.Generic.List[string]]::new()
foreach ($entry in $paths.GetEnumerator()) {
    $targetPath = (Resolve-Path $entry.Value -ErrorAction SilentlyContinue).Path
    if ($targetPath -and -not $targetPath.StartsWith($rootCanonical, [System.StringComparison]::OrdinalIgnoreCase)) {
        $pathsOutside.Add("$($entry.Key): $targetPath")
    }
}
if ($pathsOutside.Count -gt 0) {
    Write-Host "Workspace containment: VIOLATION (Paths escape approved AI root)"
    $failures.Add("Configured paths must remain inside approved AI workspace: $($pathsOutside -join '; ')")
} else {
    Write-Host ("Workspace containment: VERIFIED (All worktrees reside inside {0})" -f $AiRoot)
}

if ($failures.Count -gt 0) {
    Write-Host "`n=== ACTION REQUIRED ==="
    $failures | ForEach-Object { Write-Host "- $_" }
    exit 1
}

Write-Host "`nSHIP DE AI SETUP: HEALTHY"
