# TASK-AI-48: Paseo execution provider module
# Implements the provider contract using @getpaseo/cli 0.8.0.
# Daemon listens on 127.0.0.1:6767 (paseo start).
# Session = Paseo "agent"; identifier is the agent ID returned by ``paseo run --json``.
#
# This module must NOT reference any AO function. It is dot-sourced by
# Initialize-ShipDeExecutionProvider only when SHIPDE_EXECUTION_PROVIDER=paseo.

# ── helpers ─────────────────────────────────────────────────────────────────

function Invoke-ShipDePaseoNativeCommand {
    param(
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [int]$TimeoutMilliseconds = 30000,
        [scriptblock]$CommandRunner = $null
    )

    if ($null -ne $CommandRunner) {
        return (& $CommandRunner $Arguments)
    }

    $paseoCmd = Get-Command paseo -ErrorAction SilentlyContinue
    if ($null -eq $paseoCmd) {
        return [PSCustomObject]@{
            ExitCode = 1
            Stdout   = ""
            Stderr   = "paseo: command not found in PATH."
        }
    }
    $src = $null
    foreach ($prop in @("Source", "Path", "Definition")) {
        $pv = $paseoCmd.PSObject.Properties[$prop]
        if ($null -ne $pv -and -not [string]::IsNullOrWhiteSpace([string]$pv.Value)) {
            $src = [string]$pv.Value
            break
        }
    }
    if ([string]::IsNullOrWhiteSpace($src)) {
        return [PSCustomObject]@{
            ExitCode = 1
            Stdout   = ""
            Stderr   = "paseo: cannot resolve executable path."
        }
    }
    return (Invoke-ShipDeNativeProcess -FilePath $src -ArgumentList $Arguments -TimeoutMilliseconds $TimeoutMilliseconds)
}

function ConvertFrom-ShipDePaseoJson {
    param(
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Json,
        [Parameter(Mandatory = $true)][string]$Operation
    )
    if ([string]::IsNullOrWhiteSpace($Json)) {
        throw "Paseo returned no JSON for $Operation."
    }
    try {
        if ($PSVersionTable.PSVersion.Major -ge 6) {
            $val = ConvertFrom-Json -InputObject $Json -NoEnumerate
        } else {
            $val = $Json | ConvertFrom-Json
        }
        return ,$val
    } catch {
        throw ("Paseo returned malformed JSON for {0}: {1}" -f $Operation, $_.Exception.Message)
    }
}
# ── provider readiness / version ──────────────────────────────────────────────────

function Test-ShipDePaseoProviderReadiness {
    <#
    Returns @{ Ready = $true } when the daemon is reachable, or @{ Ready = $false; Reason = ... }.
    AI-48-R03: fail fast with named error; no silent fallback.
    AI-48-R04: PROVIDER_UNAVAILABLE vs PROVIDER_UNREACHABLE are distinct.
    #>
    param([scriptblock]$CommandRunner = $null)

    $paseoCmd = Get-Command paseo -ErrorAction SilentlyContinue
    if ($null -eq $paseoCmd) {
        return @{ Ready = $false; Reason = "PROVIDER_UNAVAILABLE: paseo command not found in PATH. Install: npm install -g @getpaseo/cli" }
    }
    try {
        $res = Invoke-ShipDePaseoNativeCommand -Arguments @("status") -CommandRunner $CommandRunner
        if ($res.ExitCode -ne 0) {
            $err = if (-not [string]::IsNullOrWhiteSpace($res.Stderr)) { $res.Stderr.Trim() } else { $res.Stdout.Trim() }
            return @{ Ready = $false; Reason = ("PROVIDER_UNREACHABLE: paseo status failed (exit {0}): {1}. Start daemon: paseo start" -f $res.ExitCode, $err) }
        }
        return @{ Ready = $true }
    } catch {
        return @{ Ready = $false; Reason = ("PROVIDER_UNREACHABLE: paseo status threw: {0}" -f $_.Exception.Message) }
    }
}

function Get-ShipDePaseoProviderExecutablePath {
    $paseoCmd = Get-Command paseo -ErrorAction SilentlyContinue
    if ($null -eq $paseoCmd) { return $null }
    foreach ($prop in @("Source", "Path", "Definition")) {
        $pv = $paseoCmd.PSObject.Properties[$prop]
        if ($null -ne $pv -and -not [string]::IsNullOrWhiteSpace([string]$pv.Value)) {
            return [string]$pv.Value
        }
    }
    return $null
}

function Get-ShipDePaseoProviderVersion {
    try {
        $res = Invoke-ShipDePaseoNativeCommand -Arguments @("--version")
        if ($res.ExitCode -eq 0) { return $res.Stdout.Trim() }
        return "unknown"
    } catch { return "unknown" }
}
# ── session ID / name helpers ─────────────────────────────────────────────────────────

function Get-ShipDePaseoSessionId {
    param([Parameter(Mandatory = $true)][object]$Response)
    $id = Get-ShipDeObjectProperty -Object $Response -Names @("id", "agentId", "agent_id")
    if ([string]::IsNullOrWhiteSpace([string]$id)) {
        throw "Paseo agent response does not contain an ID."
    }
    return [string]$id
}

function Get-ShipDePaseoSessionName {
    param([Parameter(Mandatory = $true)][object]$Response)
    $name = Get-ShipDeObjectProperty -Object $Response -Names @("title", "name", "displayName", "display_name")
    return [string]$name
}

# ── session list / query ────────────────────────────────────────────────────────────

function Get-ShipDePaseoSessions {
    param([string]$Project = "shipde-platform")
    $res = Invoke-ShipDePaseoNativeCommand -Arguments @("ls", "--json")
    if ($res.ExitCode -ne 0) {
        $err = if (-not [string]::IsNullOrWhiteSpace($res.Stderr)) { $res.Stderr.Trim() } else { $res.Stdout.Trim() }
        throw "Cannot query Paseo agents: $err"
    }
    if ([string]::IsNullOrWhiteSpace($res.Stdout)) { return @() }
    $parsed = ConvertFrom-ShipDePaseoJson -Json $res.Stdout -Operation "ls"
    if ($parsed -is [System.Array]) { return @($parsed) }
    $agents = Get-ShipDeObjectProperty -Object $parsed -Names @("agents", "items", "data")
    if ($null -ne $agents) { return @($agents) }
    return @($parsed)
}

function Get-ShipDePaseoSessionById {
    param(
        [Parameter(Mandatory = $true)][string]$SessionId,
        [string]$Project = "shipde-platform"
    )
    $res = Invoke-ShipDePaseoNativeCommand -Arguments @("inspect", $SessionId, "--json")
    if ($res.ExitCode -ne 0) {
        $combined = (([string]$res.Stdout) + " " + ([string]$res.Stderr)).Trim()
        $isNotFound = ($combined -match "(?i)\bNOT_FOUND\b" -or $combined -match "(?i)\b404\b" -or
                       $combined -match "(?i)\bnot found\b" -or $combined -match "(?i)\bdoes not exist\b")
        if ($isNotFound) { return $null }
        $diag = if (-not [string]::IsNullOrWhiteSpace($res.Stderr)) { $res.Stderr.Trim() } else { $res.Stdout.Trim() }
        throw "Paseo agent query failed for ''$SessionId'' (exit $($res.ExitCode)): $diag"
    }
    if ([string]::IsNullOrWhiteSpace($res.Stdout)) {
        throw "Paseo agent query succeeded (exit 0) but returned empty output for ''$SessionId''."
    }
    return ConvertFrom-ShipDePaseoJson -Json $res.Stdout.Trim() -Operation "inspect"
}
# ── messaging / control ──────────────────────────────────────────────────────────────────

function Send-ShipDePaseoMessage {
    param(
        [Parameter(Mandatory = $true)][string]$SessionId,
        [Parameter(Mandatory = $true)][string]$Message
    )
    $res = Invoke-ShipDePaseoNativeCommand -Arguments @("send", $SessionId, "--prompt", $Message, "--no-wait") -TimeoutMilliseconds 60000
    if ($res.ExitCode -ne 0) {
        $err = if (-not [string]::IsNullOrWhiteSpace($res.Stderr)) { $res.Stderr.Trim() } else { $res.Stdout.Trim() }
        throw "Paseo send failed for agent ''$SessionId'' (exit $($res.ExitCode)): $err"
    }
    return $true
}

function Stop-ShipDePaseoSession {
    param(
        [Parameter(Mandatory = $true)][string]$SessionId,
        [string]$Project = "shipde-platform"
    )
    $res = Invoke-ShipDePaseoNativeCommand -Arguments @("stop", $SessionId)
    if ($res.ExitCode -ne 0) {
        $err = if (-not [string]::IsNullOrWhiteSpace($res.Stderr)) { $res.Stderr.Trim() } else { $res.Stdout.Trim() }
        throw "Paseo stop failed for agent ''$SessionId'' (exit $($res.ExitCode)): $err"
    }
    return $true
}

# ── naming / routing ──────────────────────────────────────────────────────────────────

function Get-ShipDePaseoWorkerName {
    param([Parameter(Mandatory = $true)][object]$Item)
    $name = ("{0}-worker" -f $Item.WorkItemId.ToLowerInvariant())
    if ($name.Length -gt 20) { $name = $name.Substring(0, 20) }
    return $name
}

function Get-ShipDePaseoHarnessCandidates {
    param([Parameter(Mandatory = $true)][string]$Author)
    switch ($Author.ToUpperInvariant()) {
        "GEMINI"  { return @("codex", "claude") }
        "CLAUDE"  { return @("claude", "codex") }
        "9ROUTER" { return @("claude") }
        default   { return @("codex", "claude") }
    }
}

function Get-ShipDePaseoWorktreesDir {
    param([string]$Project = "shipde-platform")
    $userHome = Get-ShipDeUserHome
    return Join-Path (Join-Path $userHome ".paseo") "worktrees"
}
# ── session ownership / validation ─────────────────────────────────────────────────────────

function Test-ShipDePaseoSupervisorSessionOwnership {
    param(
        [Parameter(Mandatory = $true)][object]$Session,
        [Parameter(Mandatory = $true)][object]$Item,
        [string]$Project = "shipde-platform"
    )
    $expectedTitle = Get-ShipDePaseoWorkerName -Item $Item
    $sessionTitle  = Get-ShipDeObjectProperty -Object $Session -Names @("title", "name", "displayName", "display_name")
    if ([string]$sessionTitle -eq $expectedTitle) { return $true }

    $sid = Get-ShipDeObjectProperty -Object $Session -Names @("id", "agentId", "agent_id")
    if (-not [string]::IsNullOrWhiteSpace([string]$sid)) {
        $worktreesRoot = Get-ShipDePaseoWorktreesDir -Project $Project
        $candidateWorktree = Join-Path $worktreesRoot ([string]$sid)
        if (Test-Path -LiteralPath (Join-Path $candidateWorktree ".git")) {
            $wBranch = (& git -C $candidateWorktree rev-parse --abbrev-ref HEAD 2>`$null).Trim()
            if ($wBranch -ceq $Item.Branch) { return $true }
        }
    }
    return $false
}

function Assert-ShipDePaseoReusedSession {
    param(
        [Parameter(Mandatory = $true)][object]$SessionDetail,
        [Parameter(Mandatory = $true)][object]$Item,
        [Parameter(Mandatory = $true)][string[]]$AllowedHarnesses,
        [string]$Project = "shipde-platform"
    )
    if ($null -eq $SessionDetail) {
        throw "Cannot validate reused Paseo agent: details could not be retrieved. Failing closed."
    }
    $status = [string](Get-ShipDeObjectProperty -Object $SessionDetail -Names @("status", "state"))
    if ($status -in @("deleted", "archived", "error")) {
        throw "Reused Paseo agent has terminal status ''$status''. Failing closed."
    }
    $provider = [string](Get-ShipDeObjectProperty -Object $SessionDetail -Names @("provider", "harness", "engine"))
    if (-not [string]::IsNullOrWhiteSpace($provider) -and $AllowedHarnesses.Count -gt 0) {
        if (-not ($AllowedHarnesses -contains $provider)) {
            throw "Reused Paseo agent provider ''$provider'' does not match allowed providers ($($AllowedHarnesses -join '', '')). Failing closed."
        }
    }
    $verifiedProvider = if (-not [string]::IsNullOrWhiteSpace($provider)) { $provider } else { $AllowedHarnesses[0] }

    $branch   = [string](Get-ShipDeObjectProperty -Object $SessionDetail -Names @("branch", "headBranch", "head_branch"))
    $sessionId = [string](Get-ShipDeObjectProperty -Object $SessionDetail -Names @("id", "agentId", "agent_id"))

    if ([string]::IsNullOrWhiteSpace($branch) -and -not [string]::IsNullOrWhiteSpace($sessionId)) {
        $worktreesRoot = Get-ShipDePaseoWorktreesDir -Project $Project
        $candidateWorktree = Join-Path $worktreesRoot $sessionId
        if (Test-Path -LiteralPath (Join-Path $candidateWorktree ".git")) {
            try { $branch = (& git -C $candidateWorktree rev-parse --abbrev-ref HEAD 2>`$null).Trim() } catch {}
        }
    }
    if ([string]::IsNullOrWhiteSpace($branch)) {
        Write-Host ("[BLOCKED] Recovery target missing: branch for Paseo agent ''{0}''. Stopping fail-closed." -f $sessionId)
        throw "Reused Paseo agent does not have a resolvable branch. Failing closed."
    }
    if ($branch -cne $Item.Branch) {
        throw "Reused Paseo agent branch ''$branch'' does not match expected branch ''$($Item.Branch)''. Failing closed."
    }
    return $verifiedProvider
}
# ── worker spawn ─────────────────────────────────────────────────────────────────────────────

function Start-ShipDePaseoWorker {
    param(
        [Parameter(Mandatory = $true)][object]$Item,
        [Parameter(Mandatory = $true)][string]$Prompt,
        [string]$Harness = "",
        [string]$Project = "shipde-platform",
        [switch]$DryRun
    )

    $candidates   = if (-not [string]::IsNullOrWhiteSpace($Harness)) { @($Harness) } else { @(Get-ShipDePaseoHarnessCandidates -Author $Item.Author) }
    $expectedTitle = Get-ShipDePaseoWorkerName -Item $Item

    if ($DryRun) {
        Write-Host ("[SUPERVISOR][DRY-RUN] paseo run --background --title {0} --provider {1} <prompt>" -f $expectedTitle, $candidates[0])
        return [PSCustomObject]@{ SessionId = "dry-run-$($Item.WorkItemId.ToLowerInvariant())"; Harness = $candidates[0] }
    }

    # Reuse any live agent with the matching title
    $existingAgents = @(
        Get-ShipDePaseoSessions -Project $Project | Where-Object {
            $s = [string](Get-ShipDeObjectProperty -Object $_ -Names @("status", "state"))
            if ($s -in @("deleted", "archived", "error")) { return $false }
            $t = [string](Get-ShipDeObjectProperty -Object $_ -Names @("title", "name"))
            return $t -eq $expectedTitle
        }
    )

    if ($existingAgents.Count -eq 1) {
        $agentId  = Get-ShipDePaseoSessionId -Response $existingAgents[0]
        $detail   = Get-ShipDePaseoSessionById -SessionId $agentId -Project $Project
        $vProv    = Assert-ShipDePaseoReusedSession -SessionDetail $detail -Item $Item -AllowedHarnesses $candidates -Project $Project
        Write-Host "[SUPERVISOR] Verified and bound existing Paseo agent ''$agentId'' (provider: $vProv) for ''$expectedTitle''."
        return [PSCustomObject]@{ SessionId = $agentId; Harness = $vProv }
    } elseif ($existingAgents.Count -gt 1) {
        throw "Multiple existing Paseo agents found for worker ''$expectedTitle''. Cannot safely bind to an ambiguous worker."
    }

    $failures = [System.Collections.Generic.List[string]]::new()
    foreach ($harness in $candidates) {
        $arguments = @(
            "run",
            "--background",
            "--title", $expectedTitle,
            "--provider", $harness,
            "--new-workspace", "worktree",
            "--worktree-mode", "checkout-branch",
            "--branch", $Item.Branch,
            "--json",
            $Prompt
        )
        Write-Host ("[SUPERVISOR] Spawning Paseo agent: title={0} provider={1}" -f $expectedTitle, $harness)
        $res = Invoke-ShipDePaseoNativeCommand -Arguments $arguments -TimeoutMilliseconds 60000
        if ($res.ExitCode -eq 0 -and -not [string]::IsNullOrWhiteSpace($res.Stdout)) {
            try {
                $parsed  = ConvertFrom-ShipDePaseoJson -Json $res.Stdout.Trim() -Operation "run"
                $agentId = Get-ShipDePaseoSessionId -Response $parsed
                Write-Host ("[SUPERVISOR] Paseo agent spawned: id={0} provider={1}" -f $agentId, $harness)
                return [PSCustomObject]@{ SessionId = $agentId; Harness = $harness }
            } catch {
                $failures.Add(("provider={0}: JSON parse failed: {1}" -f $harness, $_.Exception.Message))
            }
        } else {
            $err = if (-not [string]::IsNullOrWhiteSpace($res.Stderr)) { $res.Stderr.Trim() } else { $res.Stdout.Trim() }
            $failures.Add(("provider={0}: exit {1}: {2}" -f $harness, $res.ExitCode, $err))
        }
    }

    throw ("Failed to spawn Paseo agent for Work Item ''{0}''. Attempts: {1}" -f $Item.WorkItemId, ($failures -join "; "))
}
