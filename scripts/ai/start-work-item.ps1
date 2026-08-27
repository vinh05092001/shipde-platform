param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern("^(FEAT-[A-Z0-9-]+|TASK-FOUND-[0-9]+|TASK-AI-[0-9]+)$")]
    [string]$WorkItemId,

    [Parameter(Mandatory = $true)]
    [ValidatePattern("^[a-z0-9]+(?:-[a-z0-9]+)*$")]
    [string]$Slug,

    [Parameter(Mandatory = $true)]
    [ValidateSet("GEMINI", "9ROUTER")]
    [string]$Author,

    [string]$Branch,

    [string]$AiRoot = (Join-Path $env:USERPROFILE "AI")
)

. (Join-Path $PSScriptRoot "common.ps1")

Assert-ShipDeCommand git
$paths = Get-ShipDePaths -AiRoot $AiRoot
$workspace = if ($Author -eq "GEMINI") { $paths.Gemini } else { $paths.Dsh }
$expectedSuffix = "$($WorkItemId.ToLowerInvariant())-$Slug"
if ([string]::IsNullOrWhiteSpace($Branch)) {
    $Branch = "feat/$expectedSuffix"
}
if ($Branch -notmatch "^(feat|fix)/$([regex]::Escape($expectedSuffix))$") {
    throw "Branch must be feat/$expectedSuffix or fix/$expectedSuffix"
}
$branch = $Branch

Assert-ShipDeRepository -Path $workspace
Assert-ShipDeClean -Path $workspace
Invoke-ShipDeGit -Path $workspace -Arguments @("fetch", "origin", "--prune") | Out-Null

& git -C $workspace ls-remote --exit-code --heads origin "refs/heads/$branch" | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "Prepared remote branch is missing: origin/$branch. Codex must prepare and push the Work Item first."
}

& git -C $workspace show-ref --verify --quiet "refs/heads/$branch"
if ($LASTEXITCODE -eq 0) {
    Invoke-ShipDeGit -Path $workspace -Arguments @("switch", $branch) | Out-Null
    Invoke-ShipDeGit -Path $workspace -Arguments @("merge", "--ff-only", "origin/$branch") | Out-Null
} else {
    Invoke-ShipDeGit -Path $workspace -Arguments @("switch", "--track", "-c", $branch, "origin/$branch") | Out-Null
}

$workItem = Join-Path $workspace "docs\product-spec\work-items\$WorkItemId.md"
if (-not (Test-Path $workItem)) {
    throw "Prepared Work Item file is missing: $workItem"
}

$workItemText = Get-Content $workItem -Raw -Encoding UTF8
if ($workItemText -notmatch [regex]::Escape("Assigned author") -or $workItemText -notmatch $Author) {
    throw "Work Item does not visibly assign author $Author. Stop and return it to Codex planning."
}

$promptName = if ($Author -eq "GEMINI") { "GEMINI-START-PROMPT.md" } else { "NINEROUTER-START-PROMPT.md" }
$promptPath = Join-Path $workspace "docs\product-spec\docs\10-ai-collaboration\$promptName"

Write-Host "WORK ITEM READY"
Write-Host "Workspace : $workspace"
Write-Host "Branch    : $branch"
Write-Host "Work Item : $workItem"
Write-Host "Prompt    : $promptPath"
Write-Host "Open only this workspace in the assigned author app."

