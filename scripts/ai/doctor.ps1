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

        # Touching Handle caches it on the object. Without this, Start-Process
        # -PassThru hands back a process whose handle is released on exit, and
        # ExitCode then reads as null rather than the real status -- so every
        # probe compared `-ne 0` and reported failure no matter what happened.
        $null = $process.Handle

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
        # WaitForExit(milliseconds) returns once the process signals, but does
        # not complete the async exit processing that populates ExitCode. Without
        # the parameterless call, ExitCode reads as null, `-ne 0` is true, and
        # every probe reports failure however well the command actually ran.
        $process.WaitForExit()

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

$agentRouterKey = [Environment]::GetEnvironmentVariable("AGENTROUTER_API_KEY", "User")
$agentRouterSaved = -not [string]::IsNullOrWhiteSpace($agentRouterKey)

# Presence is not configuration. A key that is set but rejected reports as
# CONFIGURED under a presence check, so the dashboard and this report both
# advertise a fallback that cannot authenticate -- and the operator finds out
# only after the primary path has already failed. AI-44-R01.
#
# The probe runs the client that will actually carry the fallback rather than
# a hand-built HTTP request. Two earlier attempts here were wrong in ways worth
# recording: /v1/models answers 401 to a real key, a fabricated key and no key
# alike, so it cannot tell a valid credential from an invalid one; and a direct
# POST to /v1/messages does not reproduce the headers Claude Code sends, so its
# 401 says nothing about whether the fallback works. Only the real client does.
# The gateway reports "no available channel" in Chinese. The literal is built
# from code points so this file stays pure ASCII: it carries no byte-order mark,
# and a non-ASCII literal in an unmarked file is read as ANSI by PowerShell and
# breaks the whole script. That happened once already.
$noChannelCn = -join @(0x65E0, 0x53EF, 0x7528, 0x6E20, 0x9053 | ForEach-Object { [char]$_ })
$agentRouterLive = $false
$agentRouterDetail = "NOT CONFIGURED; Claude account authentication will be checked"

# The probe costs one real model request through the gateway, so it uses the
# cheapest model the gateway offers rather than an Opus one. That is not a
# micro-optimisation: a handful of doctor runs on 2026-09-14, while verifying an
# unrelated fix, took the account's budget pool from working to HTTP 402.
#
# Claude Code refuses a model it does not know, and deepseek-v4-flash is a
# gateway id rather than an Anthropic one. A modelPicker row with behavesAs
# maps it onto a model this client does know, which is the supported route for
# exactly this case. The isolated config directory carries that row, so nothing
# about the operator's own setup changes.
#
# If the mapping is ever rejected, the probe says so through the existing
# "model catalog" branch rather than silently reporting a credential fault.
#
# So running the doctor repeatedly drains the operator's budget pool. That is
# not hypothetical: on 2026-09-14 a handful of doctor runs while verifying an
# unrelated fix took the pool from working to HTTP 402. The verdict is cached
# and reused, so the doctor stays free to run as often as anyone likes.
$probeModel = "deepseek-v4-flash"
$probeBehavesAs = "claude-haiku-4-5"
$agentRouterCachePath = Join-Path (Get-ShipDeTempDir) "shipde-agentrouter-probe.json"
$agentRouterCacheMaxAgeMinutes = 15
$agentRouterCached = $null
if ($agentRouterSaved -and (Test-Path -LiteralPath $agentRouterCachePath -PathType Leaf)) {
    try {
        $entry = Get-Content -LiteralPath $agentRouterCachePath -Raw | ConvertFrom-Json
        $observedAt = [DateTime]::Parse($entry.observedAt).ToUniversalTime()
        $ageMinutes = ([DateTime]::UtcNow - $observedAt).TotalMinutes
        # Bound to this exact key. A rotated credential must be re-probed, not
        # answered from the previous one's verdict.
        $keyHash = [BitConverter]::ToString(
            [Security.Cryptography.SHA256]::Create().ComputeHash(
                [Text.Encoding]::UTF8.GetBytes($agentRouterKey)
            )
        ).Replace("-", "").Substring(0, 16)
        if ($ageMinutes -le $agentRouterCacheMaxAgeMinutes -and $entry.keyHash -eq $keyHash) {
            $agentRouterCached = $entry
        }
    } catch {
        # An unreadable cache is no cache. Probe again.
        $agentRouterCached = $null
    }
}

if ($agentRouterCached) {
    $agentRouterLive = [bool]$agentRouterCached.live
    $agentRouterDetail = "{0} [cached {1:N0} min ago]" -f `
        $agentRouterCached.detail,
        ([DateTime]::UtcNow - [DateTime]::Parse($agentRouterCached.observedAt).ToUniversalTime()).TotalMinutes
    if (-not $agentRouterLive -and $agentRouterCached.failure) {
        $failures.Add([string]$agentRouterCached.failure)
    }
} elseif ($agentRouterSaved) {
    # An isolated config directory keeps the probe from touching the operator's
    # own Claude Code login.
    $probeDir = Join-Path ([IO.Path]::GetTempPath()) ("shipde-ar-" + [Guid]::NewGuid().ToString("N"))
    $probeScript = Join-Path ([IO.Path]::GetTempPath()) ("shipde-ar-" + [Guid]::NewGuid().ToString("N") + ".ps1")

    # The key is handed over through the inherited environment, never through
    # the command line. An argument is visible in the process table to every
    # process on the machine and is captured by Sysmon/EDR command-line logging
    # and by PowerShell transcription. The same change removes a second fault:
    # a key containing a single quote used to break the generated quoting and
    # was then reported as KEY PRESENT BUT REJECTED.
    $probeBody = @(
        '$env:ANTHROPIC_AUTH_TOKEN = $env:SHIPDE_AR_PROBE_TOKEN'
        '$env:SHIPDE_AR_PROBE_TOKEN = $null'
        '$env:ANTHROPIC_BASE_URL   = "https://agentrouter.org"'
        '$env:ANTHROPIC_API_KEY    = $null'
        '$env:ANTHROPIC_MODEL      = "' + $probeModel + '"'
        '$env:CLAUDE_CONFIG_DIR    = $args[0]'
        '& claude -p "Reply exactly: SHIPDE_AUTH_OK" --model ' + $probeModel + ' --output-format text --max-turns 1 2>&1'
    ) -join [Environment]::NewLine

    $agentRouterFailure = $null
    try {
        # The isolated config declares the gateway model through a modelPicker
        # row. Claude Code refuses an id absent from its own catalog; behavesAs
        # names a model it does know whose client-side handling applies. Without
        # this the probe fails on the catalog rather than on the credential.
        New-Item -ItemType Directory -Path $probeDir -Force | Out-Null
        $probeSettings = [ordered]@{
            modelPicker = [ordered]@{
                options = @(
                    [ordered]@{
                        model     = $probeModel
                        label     = "Ship De health probe"
                        behavesAs = $probeBehavesAs
                    }
                )
            }
        } | ConvertTo-Json -Depth 6
        Set-Content -Path (Join-Path $probeDir "settings.json") -Value $probeSettings -Encoding UTF8

        Set-Content -Path $probeScript -Value $probeBody -Encoding UTF8
        # Start-Process inherits this process's environment, so the child sees
        # the token without it ever appearing in an argument list.
        $env:SHIPDE_AR_PROBE_TOKEN = $agentRouterKey
        $probe = Invoke-ShipDeBoundedProbe `
            -CommandText ("& powershell -NoProfile -ExecutionPolicy Bypass -File '{0}' '{1}'" -f $probeScript, $probeDir) `
            -TimeoutSeconds 90

        $text = [string]$probe.Output
        if ($probe.TimedOut) {
            # AI-44-R01: presence is not configuration. Measured 2026-09-16: a
            # deliberately invalid key makes the probe time out rather than
            # print a 401, so reporting a timeout as CONFIGURED passed a dead
            # key off as a working fallback.
            $agentRouterDetail = "UNAVAILABLE: key present but unverified (probe timed out); the Claude and Codex fallback route is not reported available"
            $agentRouterFailure = "AGENTROUTER_API_KEY could not be verified (probe timed out); treat the AgentRouter fallback as unavailable -- see TASK-AI-44"
        } elseif ($text -match "SHIPDE_AUTH_OK") {
            $agentRouterLive = $true
            $agentRouterDetail = ("AUTHENTICATED via {0}" -f $probeModel)
        } elseif ($text -match "401" -or $text -match "(?i)unauthor") {
            $agentRouterDetail = "KEY PRESENT BUT REJECTED; the Claude and Codex fallback route is unavailable"
            $agentRouterFailure = "AGENTROUTER_API_KEY is rejected by agentrouter.org; renew or remove it -- see TASK-AI-44"
        } elseif ($text -match "402" -or $text -match "(?i)budget pool") {
            # 402 arrives after the key has authenticated, so it is a spending
            # state, not a credential fault. Rotating the key would not fix it
            # and would cost the operator a working credential.
            $agentRouterDetail = "AUTHENTICATED but the budget pool is exhausted (HTTP 402); top up or raise the pool limit on agentrouter.org"
            $agentRouterFailure = "AgentRouter authenticates but its budget pool is exhausted; the Claude and Codex fallback route cannot carry a review until it is topped up"
        } elseif ($text -match "503" -or $text -match $noChannelCn) {
            # A 503 here means the key authenticated and the routing layer had
            # no channel for that model. That is a supply or naming state, not
            # a credential fault, and reporting it as one sends the operator to
            # rotate a working key.
            $agentRouterDetail = ("AUTHENTICATED but no channel for {0} right now (HTTP 503); check Model Status on agentrouter.org" -f $probeModel)
        } elseif ($text -match "(?i)model catalog") {
            $agentRouterDetail = "AUTHENTICATED but Claude Code does not recognise the probe model; map it with modelOverrides"
        } else {
            $agentRouterDetail = "UNAVAILABLE: key present but unverified (unexpected probe output)"
            $agentRouterFailure = "AGENTROUTER_API_KEY could not be verified (unexpected probe output); treat the AgentRouter fallback as unavailable -- see TASK-AI-44"
        }
    } catch {
        $agentRouterDetail = "UNAVAILABLE: key present but unverified ($($_.Exception.Message))"
        $agentRouterFailure = "AGENTROUTER_API_KEY could not be verified (probe error); treat the AgentRouter fallback as unavailable -- see TASK-AI-44"
    } finally {
        # The token lives in this process's environment only for the duration
        # of the probe; anything spawned afterwards must not inherit it.
        $env:SHIPDE_AR_PROBE_TOKEN = $null
        Remove-Item -LiteralPath $probeScript -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $probeDir -Recurse -Force -ErrorAction SilentlyContinue
    }

    if ($agentRouterFailure) { $failures.Add($agentRouterFailure) }

    # Record the verdict so the next run within the window spends nothing. Only
    # the verdict is stored -- never the key. It is bound to a hash of the key so
    # a rotated credential is re-probed rather than answered from the old one.
    try {
        $keyHash = [BitConverter]::ToString(
            [Security.Cryptography.SHA256]::Create().ComputeHash(
                [Text.Encoding]::UTF8.GetBytes($agentRouterKey)
            )
        ).Replace("-", "").Substring(0, 16)
        [ordered]@{
            observedAt = [DateTime]::UtcNow.ToString("o")
            keyHash    = $keyHash
            live       = $agentRouterLive
            detail     = $agentRouterDetail
            failure    = $agentRouterFailure
        } | ConvertTo-Json | Set-Content -LiteralPath $agentRouterCachePath -Encoding UTF8
    } catch {
        # Failing to cache is not a health finding; the probe still ran.
    }
}
Write-Host ("AgentRouter user credential: {0}" -f $agentRouterDetail)
Write-Host ("AgentRouter serves: Claude and Codex through the manual .claude-orchestrator profile (cloud, agentrouter.org, no /v1 in the base URL); review fallback uses the native Claude Code CLI, not this gateway")
Write-Host ("9Router serves:     Gemini and dsh (local, 127.0.0.1:20128) -- a different gateway (NineRouter* symbols in control.ps1)")

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


Write-Host ""
Write-Host "=== CODEX LAUNCH FLAG SURFACE (TASK-AI-16) ==="
if (Get-Command codex -ErrorAction SilentlyContinue) {
    # `ao doctor` reports the whole command line as one opaque failure and
    # blames a CLI version change. Probing the overrides separately says which
    # one is actually refused, which is the difference between a diagnosis and
    # a guess.
    #
    # Only overrides whose value carries no embedded quotes are probed here.
    # Windows PowerShell re-quotes an argument before handing it to a native
    # process and a double quote does not survive that, so a hook override
    # tested from this script would fail on the quoting rather than on the
    # CLI -- a false failure, which is worse than no check at all. The hook
    # schema is verified separately; see TASK-AI-16-FINDINGS.md.
    $simple = [ordered]@{
        "check_for_update_on_startup" = "check_for_update_on_startup=false"
        "notice.hide_rate_limit_model_nudge" = "notice.hide_rate_limit_model_nudge=true"
    }

    $refused = New-Object System.Collections.Generic.List[string]
    foreach ($name in $simple.Keys) {
        $probe = Invoke-ShipDeBoundedProbe -CommandText ("& codex features list -c {0}" -f $simple[$name]) -TimeoutSeconds 30
        if ($probe.TimedOut -or $probe.ExitCode -ne 0) { $refused.Add($name) }
    }

    if ($refused.Count -eq 0) {
        Write-Host "Codex simple overrides: ACCEPTED"
    } else {
        Write-Host ("Codex simple overrides REFUSED: {0}" -f ($refused -join ", "))
        $failures.Add("Codex refused basic config overrides: $($refused -join ', ')")
    }

    # The projects override is the one that actually fails, and its failure mode
    # is specific: backslashes in a Windows path are consumed as escapes, so the
    # value arrives as a string where a map was expected. A forward-slash path
    # parses. Both forms are probed so the report distinguishes "this CLI
    # changed" from "the path separator is wrong".
    $tempPath = $env:TEMP
    if (-not $tempPath) { $tempPath = [System.IO.Path]::GetTempPath().TrimEnd('\') }
    $q = [char]92 + [char]34
    $backForm = 'projects={' + $q + $tempPath + $q + '={trust_level=' + $q + 'trusted' + $q + '}}'
    $fwdForm = 'projects={' + $q + ($tempPath -replace '\\', '/') + $q + '={trust_level=' + $q + 'trusted' + $q + '}}'

    # Single quotes in the generated command keep the backslash-quote pairs
    # literal all the way to the CLI. A double-quoted wrapper would end the
    # string at the first inner quote and the value would arrive truncated.
    $backProbe = Invoke-ShipDeBoundedProbe -CommandText ("& codex features list -c {0}{1}{0}" -f "'", $backForm) -TimeoutSeconds 30
    $fwdProbe = Invoke-ShipDeBoundedProbe -CommandText ("& codex features list -c {0}{1}{0}" -f "'", $fwdForm) -TimeoutSeconds 30

    $backOk = -not ($backProbe.TimedOut -or $backProbe.ExitCode -ne 0)
    $fwdOk = -not ($fwdProbe.TimedOut -or $fwdProbe.ExitCode -ne 0)

    if ($backOk) {
        Write-Host "Codex projects override: ACCEPTED with a backslash path"
    } elseif ($fwdOk) {
        Write-Host "Codex projects override: REFUSED with backslashes, ACCEPTED with forward slashes"
        Write-Host "  Root cause: Windows path separators break config parsing, not a CLI version change."
        Write-Host "  See docs/product-spec/work-items/TASK-AI-16-FINDINGS.md"
        $failures.Add("Codex refuses the projects override when the path contains backslashes; AO must emit a forward-slash path")
    } else {
        Write-Host "Codex projects override: REFUSED in both path forms"
        $failures.Add("Codex refuses the projects override regardless of path separator; the config surface changed")
    }
} else {
    Write-Host "Codex: NOT INSTALLED; launch flag surface not checked"
}

Write-Host ""
Write-Host "=== CODEX HOOK REGISTRATION (TASK-AI-16) ==="
# AI-16-R03: a flag that parses is not a hook that fired. The only evidence
# that a Codex session was observed is a row the daemon wrote, so the ledger
# is read directly and compared against the harnesses already known to work.
$codexActivity = Get-ShipDeAoHarnessActivity -Harness "codex"
if (-not $codexActivity.Verifiable) {
    # AI-16-R04: unreadable is "cannot verify", never a pass.
    Write-Host ("Codex hook registration: CANNOT VERIFY ({0})" -f $codexActivity.Reason)
    $failures.Add("Codex hook registration could not be verified: $($codexActivity.Reason)")
} elseif ($codexActivity.RecentWithActivity -gt 0) {
    Write-Host ("Codex hook registration: VERIFIED ({0} of {1} sessions recorded activity in the last {2}h, last {3})" -f `
        $codexActivity.RecentWithActivity, $codexActivity.Sessions, $codexActivity.WindowHours, $codexActivity.LastActivityAt)
} elseif ($codexActivity.WithActivity -gt 0) {
    # Observed once, but not inside the window. Reporting VERIFIED here is how a
    # health check goes on passing after the thing it checks has stopped: the
    # all-time aggregate can never fall back to zero once any row exists.
    Write-Host ("Codex hook registration: STALE (last activity {0}, none in the last {1}h)" -f `
        $codexActivity.LastActivityAt, $codexActivity.WindowHours)
    $failures.Add("Codex hook registration is stale: last activity $($codexActivity.LastActivityAt), none in the last $($codexActivity.WindowHours)h")
} else {
    # Naming the harnesses that do record activity separates "AO never writes
    # activity here" from "AO writes it for everyone except Codex", which are
    # different faults with different owners.
    $observed = New-Object System.Collections.Generic.List[string]
    foreach ($peer in @("claude-code", "agy")) {
        $peerActivity = Get-ShipDeAoHarnessActivity -Harness $peer
        if ($peerActivity.Verifiable -and $peerActivity.WithActivity -gt 0) {
            $observed.Add(("{0} ({1})" -f $peer, $peerActivity.WithActivity))
        }
    }

    if ($codexActivity.Sessions -eq 0) {
        Write-Host "Codex hook registration: NOT OBSERVED (no Codex session exists in the AO ledger)"
    } else {
        Write-Host ("Codex hook registration: NOT OBSERVED ({0} Codex sessions exist, none recorded activity)" -f `
            $codexActivity.Sessions)
    }
    if ($observed.Count -gt 0) {
        Write-Host ("  Harnesses that do record activity: {0}" -f ($observed -join ", "))
        Write-Host "  The fault is specific to the Codex launch surface, not to hook delivery."
    }
    Write-Host "  See docs/product-spec/work-items/TASK-AI-16-FINDINGS.md"
    $failures.Add("No Codex session has recorded activity in the AO ledger; Codex reviews are running unobserved")
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
            $env:ANTHROPIC_BASE_URL = "https://agentrouter.org"
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

    # A detached HEAD yields no branch name at all, and calling .Trim() on that
    # nothing aborts the doctor before it can print its summary.
    $branch = (@(& git -C $entry.Value branch --show-current) -join "").Trim()
    if ([string]::IsNullOrWhiteSpace($branch)) { $branch = "detached" }
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

# Git hook manager check (TASK-AI-36)
#
# Hooks are declared in the version-controlled lefthook.yml and installed by
# Lefthook into the repository git common dir, so one installation covers
# every worktree of the repository. The bespoke core.hooksPath override this
# replaced is retired: while it is set, git ignores the Lefthook hook, so its
# presence is reported as a failure rather than silently tolerated.
#
# The binary is resolved through the workspace pin. `npx lefthook` without a
# version would run whatever the registry serves today, which AI-TOOL-11
# forbids, so a missing pin is a failure and not a fallback.
# The probes target the checkout this script belongs to, not the integration
# baseline: each checkout installs its own node_modules, and the binary the
# developer commits through is the one that has to resolve.
$currentRepoRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$lefthookBinaryText = ""
$lefthookBinaryOk = $false
if (Get-Command pnpm -ErrorAction SilentlyContinue) {
    $lefthookBinaryProbe = Invoke-ShipDeBoundedProbe -CommandText ("& pnpm --dir '{0}' exec lefthook version" -f $currentRepoRoot) -TimeoutSeconds 60
    $lefthookBinaryText = ([string]$lefthookBinaryProbe.Output).Trim()
    if ((-not $lefthookBinaryProbe.TimedOut) -and $lefthookBinaryProbe.ExitCode -eq 0 -and $lefthookBinaryText -match '1\.11\.3') {
        $lefthookBinaryOk = $true
    }
}
if ($lefthookBinaryOk) {
    Write-Host "PASS lefthook: binary resolves from the workspace pin (1.11.3)"
} else {
    Write-Host "FAIL lefthook: the pinned binary 1.11.3 does not resolve from the workspace install"
    Write-Host "  Remediation: pnpm install --frozen-lockfile"
    $failures.Add("Lefthook binary does not resolve to the pinned 1.11.3 from the workspace install; run pnpm install --frozen-lockfile")
}

# Staged-scanner readiness (AI-36-R05). The pre-commit secret scan runs in
# Node and must answer without the Gitleaks binary being on PATH. Exit 0
# (clean) and exit 1 (a secret is staged) are both the scanner working; exit
# 2 is the scanner reporting it could not answer, which the hook cannot act
# on and which would silently pass every commit if it were read as success.
$stagedScannerPath = Join-Path $currentRepoRoot "tools\ai-guard\cli.js"
$stagedScannerOk = $false
if (Test-Path -LiteralPath $stagedScannerPath) {
    $stagedScannerProbe = Invoke-ShipDeBoundedProbe -CommandText ("& node '{0}' staged-secrets --root '{1}'" -f $stagedScannerPath, $currentRepoRoot) -TimeoutSeconds 60
    if ((-not $stagedScannerProbe.TimedOut) -and ($stagedScannerProbe.ExitCode -eq 0 -or $stagedScannerProbe.ExitCode -eq 1)) {
        $stagedScannerOk = $true
    }
}
if ($stagedScannerOk) {
    Write-Host "PASS lefthook: staged secret scanner is ready (node tools/ai-guard/cli.js staged-secrets)"
} else {
    Write-Host "FAIL lefthook: staged secret scanner did not answer"
    Write-Host "  Remediation: node tools/ai-guard/cli.js staged-secrets --root <repo>"
    $failures.Add("Staged secret scanner is not ready; the pre-commit secret gate cannot answer")
}

# Hook installation status across governed worktrees. Scoped per worktree with
# -C, like every other git call in this file: an unscoped git config reads
# whatever directory the operator ran the doctor from.
$lefthookHookInstalled = New-Object System.Collections.Generic.List[string]
$lefthookHookMissing = New-Object System.Collections.Generic.List[string]
$hooksPathOverrides = New-Object System.Collections.Generic.List[string]
foreach ($entry in $paths.GetEnumerator()) {
    if (-not (Test-Path -LiteralPath (Join-Path $entry.Value ".git"))) { continue }
    $hooksPathHere = (@(& git -C $entry.Value config core.hooksPath 2>$null) -join "").Trim()
    if ($hooksPathHere) { $hooksPathOverrides.Add(("{0}={1}" -f $entry.Key, $hooksPathHere)) }
    $commonDirHere = (@(& git -C $entry.Value rev-parse --path-format=absolute --git-common-dir 2>$null) -join "").Trim()
    $hookFileHere = if ($commonDirHere) { Join-Path $commonDirHere "hooks\pre-commit" } else { $null }
    # A file in the hook directory is not a hook manager. A stale hand-written
    # pre-commit would otherwise report as installed while the Lefthook config
    # never runs, which is the failure this check exists to catch.
    $hookTextHere = if ($hookFileHere -and (Test-Path -LiteralPath $hookFileHere)) { Get-Content -LiteralPath $hookFileHere -Raw } else { "" }
    if ($hookTextHere -match "call_lefthook") {
        $lefthookHookInstalled.Add($entry.Key)
    } else {
        $lefthookHookMissing.Add($entry.Key)
    }
}
if ($hooksPathOverrides.Count -gt 0) {
    Write-Host ("FAIL lefthook: core.hooksPath override is set ({0}); git would ignore the Lefthook hook" -f ($hooksPathOverrides -join ", "))
    Write-Host "  Remediation: git -C <worktree> config --unset core.hooksPath; pnpm lefthook install"
    $failures.Add("core.hooksPath is still set in: $($hooksPathOverrides -join ', '); it shadows the Lefthook pre-commit hook")
}
if ($lefthookHookInstalled.Count -eq 0 -and $lefthookHookMissing.Count -eq 0) {
    Write-Host "PASS lefthook: CANNOT VERIFY (no git worktree under the approved AI root)"
} elseif ($lefthookHookMissing.Count -eq 0) {
    Write-Host ("PASS lefthook: pre-commit hook installed in all {0} worktrees (git common dir)" -f $lefthookHookInstalled.Count)
} else {
    Write-Host ("FAIL lefthook: pre-commit hook NOT installed for: {0}" -f ($lefthookHookMissing -join ", "))
    Write-Host "  Remediation: pnpm install --frozen-lockfile; pnpm lefthook install"
    $failures.Add("Lefthook pre-commit hook is not installed for: $($lefthookHookMissing -join ', '); run pnpm lefthook install")
}

if ($failures.Count -gt 0) {
    Write-Host "`n=== ACTION REQUIRED ==="
    $failures | ForEach-Object { Write-Host "- $_" }
    exit 1
}

Write-Host "`nSHIP DE AI SETUP: HEALTHY"
