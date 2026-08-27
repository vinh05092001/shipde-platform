param(
    [string]$Repository = "vinh05092001/shipde-platform",
    [switch]$Apply
)

. (Join-Path $PSScriptRoot "common.ps1")

Assert-ShipDeCommand gh
& gh auth status
if ($LASTEXITCODE -ne 0) {
    throw "GitHub CLI is not authenticated"
}

$requiredChecks = @("contract", "application-gate")
$payload = [ordered]@{
    required_status_checks = [ordered]@{
        strict = $true
        contexts = $requiredChecks
    }
    enforce_admins = $true
    required_pull_request_reviews = [ordered]@{
        dismiss_stale_reviews = $false
        require_code_owner_reviews = $false
        required_approving_review_count = 0
        require_last_push_approval = $false
    }
    restrictions = $null
    required_linear_history = $true
    allow_force_pushes = $false
    allow_deletions = $false
    block_creations = $false
    required_conversation_resolution = $true
    lock_branch = $false
    allow_fork_syncing = $false
}
$json = $payload | ConvertTo-Json -Depth 10

Write-Host "Repository      : $Repository"
Write-Host "Protected branch: main"
Write-Host "Required checks : $($requiredChecks -join ', ')"
Write-Host "Pull requests   : required (0 mandatory approvals)"
Write-Host "Merge method    : squash only"
Write-Host "Delete branch   : after merge"

if (-not $Apply) {
    Write-Host "`nPREVIEW ONLY. Re-run with -Apply after the workflow PR is merged and both required checks have appeared."
    exit 0
}

$json | & gh api --method PUT -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28" "repos/$Repository/branches/main/protection" --input - | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "Branch protection failed. Confirm repository admin permission and GitHub plan support."
}

& gh repo edit $Repository --enable-squash-merge --enable-merge-commit=false --enable-rebase-merge=false --delete-branch-on-merge
if ($LASTEXITCODE -ne 0) {
    throw "Repository merge setting update failed"
}

Write-Host "MAIN PROTECTION APPLIED"

