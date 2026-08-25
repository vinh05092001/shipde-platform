param(
    [string]$AiRoot = (Join-Path $env:USERPROFILE "AI"),
    [string]$Repository = "vinh05092001/shipde-platform"
)

. (Join-Path $PSScriptRoot "common.ps1")

Assert-ShipDeCommand git
Assert-ShipDeCommand gh

& gh auth status
if ($LASTEXITCODE -ne 0) {
    throw "GitHub CLI is not authenticated. Run: gh auth login"
}

New-Item -ItemType Directory -Path $AiRoot -Force | Out-Null
$paths = Get-ShipDePaths -AiRoot $AiRoot

if (-not (Test-Path $paths.Main)) {
    & gh repo clone $Repository $paths.Main
    if ($LASTEXITCODE -ne 0) {
        throw "Repository clone failed: $Repository"
    }
}

Assert-ShipDeRepository -Path $paths.Main
Assert-ShipDeClean -Path $paths.Main
Invoke-ShipDeGit -Path $paths.Main -Arguments @("fetch", "origin", "--prune") | Out-Null
$mainBranch = (& git -C $paths.Main branch --show-current).Trim()
if ($mainBranch -ne "main") {
    throw "Integration workspace must remain on main: $($paths.Main)"
}
Invoke-ShipDeGit -Path $paths.Main -Arguments @("merge", "--ff-only", "origin/main") | Out-Null

$worktrees = @(
    @{ Path = $paths.Dsh; Branch = "agent/dsh" },
    @{ Path = $paths.Gemini; Branch = "agent/gemini" },
    @{ Path = $paths.Codex; Branch = "agent/codex-review" }
)

foreach ($worktree in $worktrees) {
    if (Test-Path $worktree.Path) {
        Assert-ShipDeRepository -Path $worktree.Path
        continue
    }

    & git -C $paths.Main show-ref --verify --quiet "refs/heads/$($worktree.Branch)"
    if ($LASTEXITCODE -eq 0) {
        & git -C $paths.Main worktree add $worktree.Path $worktree.Branch
    } else {
        & git -C $paths.Main worktree add -b $worktree.Branch $worktree.Path origin/main
    }
    if ($LASTEXITCODE -ne 0) {
        throw "Cannot create worktree: $($worktree.Path)"
    }
}

Write-Host "`n=== SHIP DE WORKTREES ==="
& git -C $paths.Main worktree list

foreach ($entry in $paths.GetEnumerator()) {
    Assert-ShipDeClean -Path $entry.Value
    $branch = (& git -C $entry.Value branch --show-current).Trim()
    $parkedBranch = switch ($entry.Key) {
        "Dsh" { "agent/dsh" }
        "Gemini" { "agent/gemini" }
        "Codex" { "agent/codex-review" }
        default { "main" }
    }
    if ($branch -eq $parkedBranch) {
        Invoke-ShipDeGit -Path $entry.Value -Arguments @("merge", "--ff-only", "origin/main") | Out-Null
    }
    Write-Host ("{0,-8} {1} [{2}] CLEAN" -f $entry.Key, $entry.Value, $branch)
}
