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
# Git hooks are managed by Lefthook (TASK-AI-36), declared in the
# version-controlled lefthook.yml. The bespoke core.hooksPath override this
# replaces is retired rather than merged: while it is set, git ignores the
# Lefthook hook that the rest of this block installs.
& git -C $paths.Main config --unset core.hooksPath 2>$null | Out-Null

# Installation is explicit. Repository supply-chain policy forbids install
# lifecycle scripts (AI-36-R02), so `pnpm install` never registers a hook on
# its own, and a bare `npx lefthook install` is forbidden under AI-TOOL-11
# because it would run whatever version the registry serves today.
$lefthookPackage = Join-Path $paths.Main "node_modules\lefthook"
if (Test-Path -LiteralPath $lefthookPackage) {
    # Requires a prior frozen install: the binary must come from the pinned
    # workspace dependency, never from a network fetch.
    & pnpm --dir $paths.Main exec lefthook install
    if ($LASTEXITCODE -ne 0) {
        throw "Lefthook hook installation failed for $($paths.Main)"
    }
    Write-Host "Installed Lefthook git hooks for $($paths.Main) (pnpm lefthook install)"
} else {
    # Pinned fallback only. Run from the repository root so the pinned
    # package resolves against this checkout.
    Push-Location $paths.Main
    try {
        & npx --yes lefthook@1.11.3 install
        if ($LASTEXITCODE -ne 0) {
            throw "Pinned Lefthook fallback installation failed for $($paths.Main)"
        }
    } finally {
        Pop-Location
    }
    Write-Host "Installed Lefthook git hooks for $($paths.Main) via pinned npx lefthook@1.11.3"
}

$worktrees = @(
    @{ Path = $paths.Claude; Branch = "agent/claude" },
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
        "Claude" { "agent/claude" }
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
