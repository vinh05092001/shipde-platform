Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

function Assert-ShipDeCommand {
    param([Parameter(Mandatory = $true)][string]$Name)

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Missing required command: $Name"
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
