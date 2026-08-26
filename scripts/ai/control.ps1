param(
    [ValidateSet("Menu", "Resume", "Status", "Prepare", "Start", "Review", "Sync")]
    [string]$Action = "Menu",

    [string]$Repository = "vinh05092001/shipde-platform",
    [string]$AiRoot = (Join-Path $env:USERPROFILE "AI")
)

. (Join-Path $PSScriptRoot "common.ps1")

$script:RegisterPath = "docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv"
$script:HandoffRoot = Join-Path $AiRoot "handoff"
$script:Paths = Get-ShipDePaths -AiRoot $AiRoot

function Get-ShipDeTextAtRef {
    param(
        [Parameter(Mandatory = $true)][string]$Ref,
        [Parameter(Mandatory = $true)][string]$Path
    )

    $spec = "{0}:{1}" -f $Ref, $Path
    $lines = @(& git -C $script:Paths.Main show $spec 2>$null)
    if ($LASTEXITCODE -ne 0) {
        return $null
    }
    return ($lines -join "`n")
}

function Get-ShipDeRowsAtRef {
    param([Parameter(Mandatory = $true)][string]$Ref)

    $csv = Get-ShipDeTextAtRef -Ref $Ref -Path $script:RegisterPath
    if ([string]::IsNullOrWhiteSpace($csv)) {
        return @()
    }
    return @($csv | ConvertFrom-Csv)
}

function Get-ShipDeWorkItemIdFromTitle {
    param([Parameter(Mandatory = $true)][string]$Title)

    $match = [regex]::Match($Title, '^\[(?<id>(?:FEAT-[A-Z0-9-]+|TASK-(?:FOUND|AI)-[0-9]+))\]')
    if (-not $match.Success) {
        return $null
    }
    return $match.Groups["id"].Value
}

function Get-ShipDeAssignment {
    param(
        [Parameter(Mandatory = $true)][string]$Ref,
        [Parameter(Mandatory = $true)][object]$Row
    )

    $workItemText = Get-ShipDeTextAtRef -Ref $Ref -Path ([string]$Row.work_item_path)
    if ([string]::IsNullOrWhiteSpace($workItemText)) {
        return $null
    }

    $authorMatch = [regex]::Match(
        $workItemText,
        '(?im)^\|\s*Assigned author\s*\|\s*`?(?<author>GEMINI|9ROUTER)`?\s*\|'
    )
    if (-not $authorMatch.Success) {
        return $null
    }

    $branch = [string]$Row.branch
    if ([string]::IsNullOrWhiteSpace($branch)) {
        $branch = $Ref -replace '^origin/', ''
    }

    $leaf = Split-Path $branch -Leaf
    $prefix = "$(([string]$Row.work_item_id).ToLowerInvariant())-"
    if (-not $leaf.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $null
    }

    return [PSCustomObject]@{
        DeliveryOrder = [int]$Row.delivery_order
        WorkItemId = [string]$Row.work_item_id
        WorkItemPath = [string]$Row.work_item_path
        Branch = $branch
        Slug = $leaf.Substring($prefix.Length)
        Author = $authorMatch.Groups["author"].Value.ToUpperInvariant()
        Ref = $Ref
    }
}

function Get-ShipDePreparedItems {
    Assert-ShipDeRepository -Path $script:Paths.Main
    Invoke-ShipDeGit -Path $script:Paths.Main -Arguments @("fetch", "origin", "--prune") | Out-Null

    $refs = @(& git -C $script:Paths.Main for-each-ref `
        "--format=%(refname:short)" `
        "refs/remotes/origin/feat" `
        "refs/remotes/origin/fix")
    if ($LASTEXITCODE -ne 0) {
        throw "Cannot enumerate prepared remote branches."
    }

    $items = [System.Collections.Generic.List[object]]::new()
    foreach ($ref in $refs) {
        if ([string]::IsNullOrWhiteSpace($ref) -or $ref -eq "origin/HEAD") {
            continue
        }
        $rows = Get-ShipDeRowsAtRef -Ref $ref
        foreach ($row in $rows | Where-Object { $_.status -eq "READY_FOR_AUTHOR" }) {
            $assignment = Get-ShipDeAssignment -Ref $ref -Row $row
            if ($assignment) {
                $items.Add($assignment)
            }
        }
    }

    return @($items | Sort-Object DeliveryOrder, WorkItemId -Unique)
}

function Get-ShipDeOpenPullRequests {
    Assert-ShipDeCommand gh
    $json = & gh pr list `
        --repo $Repository `
        --base main `
        --state open `
        --limit 30 `
        --json number,title,url,isDraft,headRefName,headRefOid,statusCheckRollup
    if ($LASTEXITCODE -ne 0) {
        throw "Cannot read open Pull Requests from GitHub."
    }
    return @($json | ConvertFrom-Json)
}

function Get-ShipDePrGate {
    param([Parameter(Mandatory = $true)][object]$PullRequest)

    $checks = @($PullRequest.statusCheckRollup)
    $pending = @($checks | Where-Object {
        [string]::IsNullOrWhiteSpace([string]$_.conclusion) -and $_.status -ne "COMPLETED"
    })
    $failed = @($checks | Where-Object {
        -not [string]::IsNullOrWhiteSpace([string]$_.conclusion) -and
        $_.conclusion -notin @("SUCCESS", "SKIPPED", "NEUTRAL")
    })

    if ($failed.Count -gt 0) { return "FAILED" }
    if ($pending.Count -gt 0 -or $checks.Count -eq 0) { return "PENDING" }
    return "GREEN"
}

function Set-ShipDeClipboard {
    param([Parameter(Mandatory = $true)][string]$Text)

    if (-not (Get-Command Set-Clipboard -ErrorAction SilentlyContinue)) {
        throw "Set-Clipboard is unavailable in this PowerShell session."
    }
    Set-Clipboard -Value $Text
}

function Start-ShipDeTerminal {
    param(
        [Parameter(Mandatory = $true)][string]$Workspace,
        [Parameter(Mandatory = $true)][string]$Command
    )

    $escapedWorkspace = $Workspace.Replace("'", "''")
    $scriptBlock = "Set-Location -LiteralPath '$escapedWorkspace'; $Command"
    $encodedCommand = [Convert]::ToBase64String(
        [System.Text.Encoding]::Unicode.GetBytes($scriptBlock)
    )
    Start-Process `
        -FilePath "powershell.exe" `
        -WorkingDirectory $Workspace `
        -ArgumentList @("-NoExit", "-ExecutionPolicy", "Bypass", "-EncodedCommand", $encodedCommand) | Out-Null
}

function Park-ShipDeCodex {
    Assert-ShipDeRepository -Path $script:Paths.Codex
    Assert-ShipDeClean -Path $script:Paths.Codex
    Invoke-ShipDeGit -Path $script:Paths.Codex -Arguments @("fetch", "origin", "--prune") | Out-Null
    Invoke-ShipDeGit -Path $script:Paths.Codex -Arguments @("switch", "agent/codex-review") | Out-Null
}

function Invoke-ShipDePrepare {
    Assert-ShipDeCommand codex
    Park-ShipDeCodex

    $prompt = @"
Prepare the next dependency-ready Ship De Work Item. Do not implement production code.

Read AGENTS.md and docs/product-spec/docs/10-ai-collaboration/CODEX-PLANNING-PROMPT.md completely.
Select the earliest dependency-ready row, create and push exactly one prepared feature branch, fill its Work Item, assign GEMINI or 9ROUTER, set READY_FOR_AUTHOR, and stop. Do not open the implementation PR and do not implement application code.

When finished, return only: Work Item ID, branch, assigned author, Work Item path, readiness evidence and blockers.
"@

    Set-ShipDeClipboard -Text $prompt
    Start-ShipDeTerminal -Workspace $script:Paths.Codex -Command "codex"
    Write-Host "Codex planning opened. The exact planning prompt is on the clipboard."
    Write-Host "Paste once, let Codex push the prepared branch, then run Resume again."
}

function Get-ShipDePromptForItem {
    param([Parameter(Mandatory = $true)][object]$Item)

    $workspace = if ($Item.Author -eq "GEMINI") { $script:Paths.Gemini } else { $script:Paths.Dsh }
    $promptName = if ($Item.Author -eq "GEMINI") { "GEMINI-START-PROMPT.md" } else { "NINEROUTER-START-PROMPT.md" }
    $promptPath = Join-Path $workspace "docs\product-spec\docs\10-ai-collaboration\$promptName"
    if (-not (Test-Path $promptPath)) {
        throw "Author prompt is missing after branch checkout: $promptPath"
    }

    $prompt = Get-Content $promptPath -Raw -Encoding UTF8
    $prompt = $prompt.Replace("<WORK_ITEM_ID>", $Item.WorkItemId)
    $prompt = $prompt.Replace("<BRANCH>", $Item.Branch)
    return $prompt
}

function Start-ShipDeAssignedAuthor {
    param([Parameter(Mandatory = $true)][object]$Item)

    Park-ShipDeCodex
    $startScript = Join-Path $PSScriptRoot "start-work-item.ps1"
    & $startScript `
        -WorkItemId $Item.WorkItemId `
        -Slug $Item.Slug `
        -Author $Item.Author `
        -Branch $Item.Branch `
        -AiRoot $AiRoot

    $workspace = if ($Item.Author -eq "GEMINI") { $script:Paths.Gemini } else { $script:Paths.Dsh }
    $prompt = Get-ShipDePromptForItem -Item $Item
    Set-ShipDeClipboard -Text $prompt

    if ($Item.Author -eq "GEMINI") {
        if (Get-Command agy -ErrorAction SilentlyContinue) {
            Start-ShipDeTerminal -Workspace $workspace -Command "agy"
        } elseif (Get-Command gemini -ErrorAction SilentlyContinue) {
            Start-ShipDeTerminal -Workspace $workspace -Command "gemini"
        } else {
            throw "Neither Antigravity CLI (agy) nor Gemini CLI is available."
        }
    } else {
        Assert-ShipDeCommand 9router
        Assert-ShipDeCommand dsh
        if (-not (Test-ShipDeTcpPort -HostName "127.0.0.1" -Port 20128)) {
            Start-ShipDeTerminal -Workspace $workspace -Command "9router"
        }
        if (-not (Test-ShipDeTcpPort -HostName "127.0.0.1" -Port 3080)) {
            Start-ShipDeTerminal -Workspace $workspace -Command "dsh web"
            Start-Sleep -Seconds 2
        }
        Start-Process "http://127.0.0.1:3080" | Out-Null
    }

    Write-Host "ASSIGNED AUTHOR STARTED"
    Write-Host ("Work Item : {0}" -f $Item.WorkItemId)
    Write-Host ("Author    : {0}" -f $Item.Author)
    Write-Host ("Branch    : {0}" -f $Item.Branch)
    Write-Host "The exact implementation prompt is on the clipboard. Paste once and let the author stop after opening the PR."
}

function Invoke-ShipDeStart {
    $items = @(Get-ShipDePreparedItems)
    if ($items.Count -eq 0) {
        Write-Host "No READY_FOR_AUTHOR branch was found. Starting Codex planning instead."
        Invoke-ShipDePrepare
        return
    }

    if ($items.Count -gt 1) {
        Write-Warning "Multiple prepared items were found. The earliest delivery order will be started; later items remain untouched."
    }
    Start-ShipDeAssignedAuthor -Item $items[0]
}

function Get-ShipDePrWorkItem {
    param([Parameter(Mandatory = $true)][object]$PullRequest)

    $workItemId = Get-ShipDeWorkItemIdFromTitle -Title ([string]$PullRequest.title)
    if ([string]::IsNullOrWhiteSpace($workItemId)) {
        return $null
    }

    $ref = "origin/$($PullRequest.headRefName)"
    $rows = Get-ShipDeRowsAtRef -Ref $ref
    $row = $rows | Where-Object { $_.work_item_id -eq $workItemId } | Select-Object -First 1
    if (-not $row) {
        return $null
    }
    return Get-ShipDeAssignment -Ref $ref -Row $row
}

function Start-ShipDeFixRound {
    param(
        [Parameter(Mandatory = $true)][object]$PullRequest,
        [Parameter(Mandatory = $true)][object]$Item
    )

    $workspace = if ($Item.Author -eq "GEMINI") { $script:Paths.Gemini } else { $script:Paths.Dsh }
    Assert-ShipDeClean -Path $workspace
    Invoke-ShipDeGit -Path $workspace -Arguments @("fetch", "origin", "--prune") | Out-Null
    Invoke-ShipDeGit -Path $workspace -Arguments @("switch", $Item.Branch) | Out-Null
    Invoke-ShipDeGit -Path $workspace -Arguments @("merge", "--ff-only", "origin/$($Item.Branch)") | Out-Null

    $promptName = if ($Item.Author -eq "GEMINI") { "GEMINI-START-PROMPT.md" } else { "NINEROUTER-START-PROMPT.md" }
    $promptPath = Join-Path $workspace "docs\product-spec\docs\10-ai-collaboration\$promptName"
    $text = Get-Content $promptPath -Raw -Encoding UTF8
    $section = ($text -split "## Review-fix prompt", 2)[1]
    if ([string]::IsNullOrWhiteSpace($section)) {
        throw "Review-fix prompt is missing: $promptPath"
    }
    $prompt = $section.Replace("<WORK_ITEM_ID>", $Item.WorkItemId).Replace("<PR_URL>", [string]$PullRequest.url)
    Set-ShipDeClipboard -Text $prompt

    if ($Item.Author -eq "GEMINI") {
        $command = if (Get-Command agy -ErrorAction SilentlyContinue) { "agy" } else { "gemini" }
        Start-ShipDeTerminal -Workspace $workspace -Command $command
    } else {
        Assert-ShipDeCommand 9router
        Assert-ShipDeCommand dsh
        if (-not (Test-ShipDeTcpPort -HostName "127.0.0.1" -Port 20128)) {
            Start-ShipDeTerminal -Workspace $workspace -Command "9router"
        }
        if (-not (Test-ShipDeTcpPort -HostName "127.0.0.1" -Port 3080)) {
            Start-ShipDeTerminal -Workspace $workspace -Command "dsh web"
            Start-Sleep -Seconds 2
        }
        Start-Process "http://127.0.0.1:3080" | Out-Null
    }
    Write-Host "Correction prompt copied and the same author reopened on the same branch."
}

function Invoke-ShipDeReview {
    Assert-ShipDeCommand codex
    Assert-ShipDeCommand gh
    $pullRequests = @(Get-ShipDeOpenPullRequests | Where-Object {
        -not $_.isDraft -and (Get-ShipDeWorkItemIdFromTitle -Title ([string]$_.title))
    })
    if ($pullRequests.Count -eq 0) {
        Write-Host "No implementation Pull Request is ready. Starting or preparing the next item instead."
        Invoke-ShipDeStart
        return
    }
    if ($pullRequests.Count -gt 1) {
        throw "More than one active implementation Pull Request exists. Park extras before automated routing."
    }

    $pr = $pullRequests[0]
    $gate = Get-ShipDePrGate -PullRequest $pr
    Write-Host ("PR #{0}: {1}" -f $pr.number, $pr.title)
    Write-Host ("CI gate: {0}" -f $gate)
    if ($gate -ne "GREEN") {
        Start-Process ([string]$pr.url) | Out-Null
        Write-Host "Codex review did not start because required checks are not green."
        return
    }

    Assert-ShipDeRepository -Path $script:Paths.Codex
    Assert-ShipDeClean -Path $script:Paths.Codex
    Invoke-ShipDeGit -Path $script:Paths.Codex -Arguments @("fetch", "origin", "--prune") | Out-Null
    Invoke-ShipDeGit -Path $script:Paths.Codex -Arguments @("switch", "--detach", "origin/$($pr.headRefName)") | Out-Null

    New-Item -ItemType Directory -Path $script:HandoffRoot -Force | Out-Null
    $reviewFile = Join-Path $script:HandoffRoot ("pr-{0}-{1}-codex-review.txt" -f $pr.number, $pr.headRefOid.Substring(0, 8))
    Push-Location $script:Paths.Codex
    $previousErrorActionPreference = $ErrorActionPreference
    try {
        # Windows PowerShell 5.1 wraps native stderr as NativeCommandError.
        # Codex writes harmless startup/status text to stderr, so capture it
        # without allowing the global Stop preference to abort the review.
        $ErrorActionPreference = "Continue"
        $output = @(& codex review --base origin/main 2>&1)
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
        Pop-Location
    }
    $output | Set-Content -Path $reviewFile -Encoding UTF8
    $output | ForEach-Object { Write-Host $_ }
    if ($exitCode -ne 0) {
        throw "Codex review failed with exit code $exitCode. Output: $reviewFile"
    }

    $verdictMatches = [regex]::Matches(($output -join "`n"), '(?im)\b(PASS|CHANGES_REQUIRED|BLOCKED)\b')
    $verdict = if ($verdictMatches.Count -gt 0) {
        $verdictMatches[$verdictMatches.Count - 1].Groups[1].Value.ToUpperInvariant()
    } else {
        "UNKNOWN"
    }

    Write-Host ("Review file: {0}" -f $reviewFile)
    Write-Host ("Verdict    : {0}" -f $verdict)
    $post = Read-Host "Post this Codex review to PR #$($pr.number)? (Y/N)"
    if ($post -match '(?i)^y(?:es)?$') {
        & gh pr comment $pr.number --repo $Repository --body-file $reviewFile
        if ($LASTEXITCODE -ne 0) {
            throw "Could not post the review comment. The local review file is preserved."
        }
    }

    if ($verdict -eq "CHANGES_REQUIRED") {
        $item = Get-ShipDePrWorkItem -PullRequest $pr
        if ($item) {
            $fix = Read-Host "Return findings to $($item.Author) now? (Y/N)"
            if ($fix -match '(?i)^y(?:es)?$') {
                Start-ShipDeFixRound -PullRequest $pr -Item $item
            }
        }
    } elseif ($verdict -eq "PASS") {
        Start-Process ([string]$pr.url) | Out-Null
        Write-Host "PASS recorded. Only the human merge owner may merge."
    }
}

function Invoke-ShipDeSync {
    Assert-ShipDeRepository -Path $script:Paths.Main
    Assert-ShipDeClean -Path $script:Paths.Main
    Invoke-ShipDeGit -Path $script:Paths.Main -Arguments @("fetch", "origin", "--prune") | Out-Null
    Invoke-ShipDeGit -Path $script:Paths.Main -Arguments @("switch", "main") | Out-Null
    Invoke-ShipDeGit -Path $script:Paths.Main -Arguments @("merge", "--ff-only", "origin/main") | Out-Null

    $parked = [ordered]@{
        Claude = "agent/claude"
        Dsh = "agent/dsh"
        Gemini = "agent/gemini"
        Codex = "agent/codex-review"
    }
    foreach ($name in $parked.Keys) {
        $workspace = $script:Paths[$name]
        Assert-ShipDeRepository -Path $workspace
        Assert-ShipDeClean -Path $workspace
        Invoke-ShipDeGit -Path $workspace -Arguments @("switch", $parked[$name]) | Out-Null
        Invoke-ShipDeGit -Path $workspace -Arguments @("merge", "--ff-only", "origin/main") | Out-Null
    }
    Write-Host "All clean worktrees are parked and synchronized with origin/main."
}

function Show-ShipDeStatus {
    Write-Host "=== WORKTREES ==="
    foreach ($entry in $script:Paths.GetEnumerator()) {
        if (-not (Test-Path (Join-Path $entry.Value ".git"))) {
            Write-Host ("{0,-8} MISSING {1}" -f $entry.Key, $entry.Value)
            continue
        }
        $branch = (& git -C $entry.Value branch --show-current).Trim()
        if ([string]::IsNullOrWhiteSpace($branch)) { $branch = "DETACHED" }
        $dirty = @(& git -C $entry.Value status --porcelain).Count -gt 0
        Write-Host ("{0,-8} {1,-8} [{2}]" -f $entry.Key, $(if ($dirty) { "DIRTY" } else { "CLEAN" }), $branch)
    }

    Write-Host "`n=== SERVICES ==="
    Write-Host ("9Router : {0}" -f $(if (Test-ShipDeTcpPort -HostName "127.0.0.1" -Port 20128) { "UP" } else { "STOPPED" }))
    Write-Host ("DSH     : {0}" -f $(if (Test-ShipDeTcpPort -HostName "127.0.0.1" -Port 3080) { "UP" } else { "STOPPED" }))

    Write-Host "`n=== OPEN PULL REQUESTS ==="
    $pullRequests = @(Get-ShipDeOpenPullRequests)
    if ($pullRequests.Count -eq 0) {
        Write-Host "None"
    } else {
        foreach ($pr in $pullRequests) {
            Write-Host ("#{0,-4} {1,-8} {2}" -f $pr.number, (Get-ShipDePrGate -PullRequest $pr), $pr.title)
        }
    }

    Write-Host "`n=== PREPARED ITEMS ==="
    $items = @(Get-ShipDePreparedItems)
    if ($items.Count -eq 0) {
        Write-Host "None"
    } else {
        foreach ($item in $items) {
            Write-Host ("{0,-18} {1,-9} {2}" -f $item.WorkItemId, $item.Author, $item.Branch)
        }
    }
}

function Invoke-ShipDeResume {
    $pullRequests = @(Get-ShipDeOpenPullRequests | Where-Object {
        Get-ShipDeWorkItemIdFromTitle -Title ([string]$_.title)
    })
    if ($pullRequests.Count -gt 0) {
        Invoke-ShipDeReview
        return
    }

    $items = @(Get-ShipDePreparedItems)
    if ($items.Count -gt 0) {
        Invoke-ShipDeStart
        return
    }

    Invoke-ShipDePrepare
}

function Show-ShipDeMenu {
    while ($true) {
        Clear-Host
        Write-Host "SHIP DE - HUMAN-GATED SEMI-AUTOMATIC CONTROL"
        Write-Host "1. Continue pipeline (recommended)"
        Write-Host "2. Status"
        Write-Host "3. Prepare next Work Item"
        Write-Host "4. Start prepared author"
        Write-Host "5. Run Codex review"
        Write-Host "6. Sync after human merge"
        Write-Host "0. Exit"
        $choice = Read-Host "Choose"
        try {
            switch ($choice) {
                "1" { Invoke-ShipDeResume }
                "2" { Show-ShipDeStatus }
                "3" { Invoke-ShipDePrepare }
                "4" { Invoke-ShipDeStart }
                "5" { Invoke-ShipDeReview }
                "6" { Invoke-ShipDeSync }
                "0" { return }
                default { Write-Warning "Invalid choice." }
            }
        } catch {
            Write-Host ("STOPPED SAFELY: {0}" -f $_.Exception.Message) -ForegroundColor Red
        }
        Read-Host "Press Enter to return"
    }
}

Assert-ShipDeCommand git
Assert-ShipDeCommand gh
New-Item -ItemType Directory -Path $script:HandoffRoot -Force | Out-Null

switch ($Action) {
    "Resume" { Invoke-ShipDeResume }
    "Status" { Show-ShipDeStatus }
    "Prepare" { Invoke-ShipDePrepare }
    "Start" { Invoke-ShipDeStart }
    "Review" { Invoke-ShipDeReview }
    "Sync" { Invoke-ShipDeSync }
    default { Show-ShipDeMenu }
}
