param(
    [Parameter(Mandatory = $true)][ValidateRange(1, 999999)][int]$PullRequest,
    [string]$Repository = "vinh05092001/shipde-platform",
    [string]$AiRoot = (Join-Path $env:USERPROFILE "AI")
)

. (Join-Path $PSScriptRoot "common.ps1")

Assert-ShipDeCommand git
Assert-ShipDeCommand gh
$paths = Get-ShipDePaths -AiRoot $AiRoot
Assert-ShipDeRepository -Path $paths.Codex
Assert-ShipDeClean -Path $paths.Codex
Invoke-ShipDeGit -Path $paths.Codex -Arguments @("fetch", "origin", "--prune") | Out-Null

$json = & gh pr view $PullRequest --repo $Repository --json number,title,url,state,isDraft,baseRefName,headRefName,headRefOid,statusCheckRollup
if ($LASTEXITCODE -ne 0) {
    throw "Cannot read Pull Request #$PullRequest"
}
$pr = $json | ConvertFrom-Json

$prompt = @"
Perform an independent review of Pull Request #$($pr.number):
$($pr.url)

Repository: $Repository
Base: $($pr.baseRefName)
Head: $($pr.headRefName)
Reviewed commit: $($pr.headRefOid)

Read AGENTS.md, the prepared Work Item and docs/product-spec/docs/10-ai-collaboration/CODEX-REVIEW-PROMPT.md from the PR head.
Do not edit the author branch, do not merge and do not rely on author chat history.
Inspect the full diff, CI evidence, business completeness, security, tenancy, external side effects, UX states and acceptance matrix.
Return findings by severity with file evidence, then exactly one verdict: PASS, CHANGES_REQUIRED or BLOCKED.
"@

Write-Host "=== PULL REQUEST ==="
Write-Host ("#{0} {1}" -f $pr.number, $pr.title)
Write-Host ("URL    : {0}" -f $pr.url)
Write-Host ("Commit : {0}" -f $pr.headRefOid)
Write-Host "`n=== CHECKS ==="
$pr.statusCheckRollup | ForEach-Object {
    Write-Host ("{0,-42} {1}" -f $_.name, $_.conclusion)
}
Write-Host "`n=== REVIEW PROMPT ==="
Write-Host $prompt

if (Get-Command Set-Clipboard -ErrorAction SilentlyContinue) {
    Set-Clipboard -Value $prompt
    Write-Host "`nPrompt copied to clipboard. Paste it into a fresh Codex task opened at: $($paths.Codex)"
}

