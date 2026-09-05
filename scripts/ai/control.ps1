param(
    [ValidateSet("Menu", "Resume", "Status", "Prepare", "Start", "Review", "Sync", "Supervise")]
    [string]$Action = "Menu",

    [string]$Repository = "vinh05092001/shipde-platform",
    [string]$AiRoot = (Join-Path $env:USERPROFILE "AI"),

    [ValidateRange(0, [int]::MaxValue)]
    [int]$PullRequestNumber = 0,

    [int]$SupervisorPollIntervalSeconds = 30,
    [int]$SupervisorInactivityTimeoutMinutes = 10,
    [int]$SupervisorMaxNudges = 1
)

. (Join-Path $PSScriptRoot "common.ps1")

$script:RegisterPath = "docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv"
$script:HandoffRoot = Join-Path $AiRoot "handoff"
$script:Paths = Get-ShipDePaths -AiRoot $AiRoot
$script:RequiredPrChecks = @("contract", "application-gate")

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

function ConvertFrom-ShipDeJsonList {
    param(
        [Parameter(Mandatory = $true)]
        [AllowEmptyString()]
        [string]$Json
    )

    if ([string]::IsNullOrWhiteSpace($Json)) {
        return
    }

    # Windows PowerShell 5.1 can emit a JSON array as one pipeline object.
    # Assign first, then enumerate explicitly so [] produces zero records.
    $parsed = $Json | ConvertFrom-Json
    foreach ($item in $parsed) {
        if ($null -eq $item) {
            throw "Controller JSON list contains a null record."
        }
        Write-Output $item
    }
}

function Assert-ShipDePullRequestRecord {
    param(
        [Parameter(Mandatory = $false)]
        [AllowNull()]
        [object]$PullRequest
    )

    if ($null -eq $PullRequest) {
        throw "GitHub returned a null Pull Request record."
    }
    $titleProperty = $PullRequest.PSObject.Properties["title"]
    if (
        -not $titleProperty -or
        $titleProperty.Value -isnot [string] -or
        [string]::IsNullOrWhiteSpace($titleProperty.Value)
    ) {
        throw "GitHub returned a malformed Pull Request record without one nonblank scalar string title."
    }
}

function ConvertFrom-ShipDeMergedPullRequestList {
    param(
        [Parameter(Mandatory = $true)]
        [AllowEmptyString()]
        [string]$Json
    )

    $pullRequests = @(ConvertFrom-ShipDeJsonList -Json $Json)
    foreach ($pullRequest in $pullRequests) {
        Assert-ShipDePullRequestRecord -PullRequest $pullRequest

        $numberProperty = $pullRequest.PSObject.Properties["number"]
        $number = 0
        if (
            -not $numberProperty -or
            $numberProperty.Value -is [System.Array] -or
            -not [int]::TryParse([string]$numberProperty.Value, [ref]$number) -or
            $number -le 0
        ) {
            throw "GitHub returned a malformed merged Pull Request record without one positive scalar integer number."
        }

        Write-Output $pullRequest
    }
}

function Assert-ShipDeJsonListCompatibility {
    $empty = @(ConvertFrom-ShipDeJsonList -Json "[]")
    $single = @(ConvertFrom-ShipDeJsonList -Json '[{"title":"one"}]')
    $multiple = @(ConvertFrom-ShipDeJsonList -Json '[{"title":"one"},{"title":"two"}]')

    if ($empty.Count -ne 0) {
        throw "Controller JSON compatibility check failed for an empty list."
    }
    if ($single.Count -ne 1 -or [string]$single[0].title -ne "one") {
        throw "Controller JSON compatibility check failed for a single-item list."
    }
    if (
        $multiple.Count -ne 2 -or
        [string]$multiple[0].title -ne "one" -or
        [string]$multiple[1].title -ne "two"
    ) {
        throw "Controller JSON compatibility check failed for a multi-item list."
    }

    $nullRejected = $false
    try {
        @(ConvertFrom-ShipDeJsonList -Json "[null]") | Out-Null
    } catch {
        $nullRejected = $true
    }
    if (-not $nullRejected) {
        throw "Controller JSON compatibility check accepted a null list record."
    }

    # Windows PowerShell 5.1 can otherwise wrap the complete merged-PR JSON
    # array as one System.Object[] record. Exercise the exact sync parser.
    $mergedEmpty = @(ConvertFrom-ShipDeMergedPullRequestList -Json "[]")
    $mergedSingle = @(ConvertFrom-ShipDeMergedPullRequestList -Json '[{"number":6,"title":"[TASK-AI-04] one"}]')
    $mergedMultiple = @(ConvertFrom-ShipDeMergedPullRequestList -Json '[{"number":5,"title":"[TASK-AI-03] one"},{"number":6,"title":"[TASK-AI-04] two"}]')
    if ($mergedEmpty.Count -ne 0) {
        throw "Controller merged Pull Request compatibility check failed for an empty list."
    }
    if ($mergedSingle.Count -ne 1 -or [int]$mergedSingle[0].number -ne 6) {
        throw "Controller merged Pull Request compatibility check failed for a single-item list."
    }
    if (
        $mergedMultiple.Count -ne 2 -or
        [int]$mergedMultiple[0].number -ne 5 -or
        [int]$mergedMultiple[1].number -ne 6
    ) {
        throw "Controller merged Pull Request compatibility check failed for a multi-item list."
    }

    foreach ($invalidMergedJson in @(
        '[{"title":"missing number"}]',
        '[{"number":"","title":"blank number"}]',
        '[{"number":"not-a-number","title":"invalid number"}]',
        '[{"number":0,"title":"nonpositive number"}]',
        '[{"number":[6],"title":"array number"}]',
        '[{"number":6,"title":["array title"]}]',
        '[{"number":6,"title":42}]',
        '[{"number":6,"title":{"text":"object title"}}]'
    )) {
        $invalidMergedRejected = $false
        try {
            @(ConvertFrom-ShipDeMergedPullRequestList -Json $invalidMergedJson) | Out-Null
        } catch {
            $invalidMergedRejected = $true
        }
        if (-not $invalidMergedRejected) {
            throw "Controller merged Pull Request compatibility check accepted a malformed record."
        }
    }

    foreach ($invalidRecord in @(
        [PSCustomObject]@{},
        [PSCustomObject]@{ title = $null },
        [PSCustomObject]@{ title = "" },
        [PSCustomObject]@{ title = " " },
        [PSCustomObject]@{ title = @("array title") },
        [PSCustomObject]@{ title = 42 },
        [PSCustomObject]@{ title = [PSCustomObject]@{ text = "object title" } }
    )) {
        $invalidRejected = $false
        try {
            Assert-ShipDePullRequestRecord -PullRequest $invalidRecord
        } catch {
            $invalidRejected = $true
        }
        if (-not $invalidRejected) {
            throw "Controller Pull Request compatibility check accepted an unusable title."
        }
    }
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

    $pullRequests = @(ConvertFrom-ShipDeJsonList -Json ($json -join [Environment]::NewLine))
    foreach ($pullRequest in $pullRequests) {
        Assert-ShipDePullRequestRecord -PullRequest $pullRequest
        Write-Output $pullRequest
    }
}

function Get-ShipDeCheckField {
    param(
        [Parameter(Mandatory = $true)][object]$Check,
        [Parameter(Mandatory = $true)][string]$Field
    )

    $property = $Check.PSObject.Properties[$Field]
    if (-not $property) {
        return ""
    }
    return [string]$property.Value
}

function Get-ShipDeCheckName {
    param([Parameter(Mandatory = $true)][object]$Check)

    $name = Get-ShipDeCheckField -Check $Check -Field "name"
    if (-not [string]::IsNullOrWhiteSpace($name)) {
        return $name
    }
    return Get-ShipDeCheckField -Check $Check -Field "context"
}

function Get-ShipDeCheckResult {
    param([Parameter(Mandatory = $true)][object]$Check)

    $conclusion = (Get-ShipDeCheckField -Check $Check -Field "conclusion").ToUpperInvariant()
    if (-not [string]::IsNullOrWhiteSpace($conclusion)) {
        if ($conclusion -eq "SUCCESS") { return "SUCCESS" }
        if ($conclusion -in @("SKIPPED", "NEUTRAL")) { return "NEUTRAL" }
        return "FAILED"
    }

    $state = (Get-ShipDeCheckField -Check $Check -Field "state").ToUpperInvariant()
    if (-not [string]::IsNullOrWhiteSpace($state)) {
        if ($state -eq "SUCCESS") { return "SUCCESS" }
        if ($state -in @("ERROR", "FAILURE")) { return "FAILED" }
        return "PENDING"
    }

    return "PENDING"
}

function Get-ShipDePrGate {
    param([Parameter(Mandatory = $true)][object]$PullRequest)

    $checks = @($PullRequest.statusCheckRollup)
    if ($checks.Count -eq 0) {
        return "PENDING"
    }

    $failed = @($checks | Where-Object {
        (Get-ShipDeCheckResult -Check $_) -eq "FAILED"
    })
    if ($failed.Count -gt 0) {
        return "FAILED"
    }

    foreach ($requiredName in $script:RequiredPrChecks) {
        $matches = @($checks | Where-Object {
            (Get-ShipDeCheckName -Check $_) -eq $requiredName
        })
        if ($matches.Count -eq 0) {
            return "PENDING"
        }

        $results = @($matches | ForEach-Object {
            Get-ShipDeCheckResult -Check $_
        })
        if (@($results | Where-Object { $_ -in @("FAILED", "NEUTRAL") }).Count -gt 0) {
            return "FAILED"
        }
        if (@($results | Where-Object { $_ -ne "SUCCESS" }).Count -gt 0) {
            return "PENDING"
        }
    }

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

function Get-ShipDePullRequestByNumber {
    param([Parameter(Mandatory = $true)][int]$Number)

    $matches = @(Get-ShipDeOpenPullRequests | Where-Object {
        [int]$_.number -eq $Number
    })
    if ($matches.Count -gt 1) {
        throw "GitHub returned duplicate Pull Request #$Number records."
    }
    return $matches | Select-Object -First 1
}

function Assert-ShipDeReviewTarget {
    param(
        [Parameter(Mandatory = $true)][object]$PullRequest,
        [Parameter(Mandatory = $true)][string]$ExpectedHeadSha
    )

    if (-not $PullRequest) {
        throw "Pull Request closed or disappeared before review completed."
    }
    if ($PullRequest.isDraft) {
        throw "Pull Request #$($PullRequest.number) is draft. Finish it and mark it ready before continuing."
    }
    if ([string]$PullRequest.headRefOid -ne $ExpectedHeadSha) {
        throw "Pull Request head moved. Discard this review attempt and rerun against the new CI-approved head."
    }

    $gate = Get-ShipDePrGate -PullRequest $PullRequest
    if ($gate -ne "GREEN") {
        throw "Pull Request checks are no longer green for immutable head $ExpectedHeadSha (gate: $gate)."
    }
}

function Invoke-ShipDeReview {
    Assert-ShipDeCommand codex
    Assert-ShipDeCommand gh
    $pullRequests = @(Get-ShipDeOpenPullRequests | Where-Object {
        Get-ShipDeWorkItemIdFromTitle -Title ([string]$_.title)
    })
    if ($PullRequestNumber -gt 0) {
        $pullRequests = @($pullRequests | Where-Object { [int]$_.number -eq $PullRequestNumber })
        if ($pullRequests.Count -eq 0) {
            throw "Open implementation Pull Request #$PullRequestNumber was not found."
        }
    }
    if ($pullRequests.Count -eq 0) {
        Write-Host "No implementation Pull Request is ready. Starting or preparing the next item instead."
        Invoke-ShipDeStart
        return
    }
    if ($pullRequests.Count -gt 1) {
        throw "More than one active implementation Pull Request exists. Supply -PullRequestNumber to select one exact review target."
    }

    $pr = $pullRequests[0]
    Write-Host ("PR #{0}: {1}" -f $pr.number, $pr.title)
    if ($pr.isDraft) {
        Write-Host ("BLOCKED: PR #{0} is still draft. Finish the same Work Item and mark the PR ready; no new item was started." -f $pr.number)
        Write-Host ([string]$pr.url)
        return
    }

    $gate = Get-ShipDePrGate -PullRequest $pr
    Write-Host ("CI gate: {0}" -f $gate)
    if ($gate -ne "GREEN") {
        Write-Host "Codex review did not start because both contract and application-gate must complete successfully."
        Write-Host ([string]$pr.url)
        return
    }

    $reviewHeadSha = [string]$pr.headRefOid
    if ($reviewHeadSha -notmatch '^[0-9a-fA-F]{40,64}$') {
        throw "Pull Request did not provide a valid immutable head SHA."
    }

    Assert-ShipDeRepository -Path $script:Paths.Codex
    Assert-ShipDeClean -Path $script:Paths.Codex
    Invoke-ShipDeGit -Path $script:Paths.Codex -Arguments @("fetch", "origin", "--prune") | Out-Null
    Invoke-ShipDeGit -Path $script:Paths.Codex -Arguments @(
        "fetch",
        "origin",
        ("refs/pull/{0}/head" -f $pr.number)
    ) | Out-Null

    $fetchedHeadSha = (& git -C $script:Paths.Codex rev-parse FETCH_HEAD).Trim()
    if ($LASTEXITCODE -ne 0 -or $fetchedHeadSha -ne $reviewHeadSha) {
        throw "Fetched PR head does not match the CI-approved head $reviewHeadSha."
    }

    $currentPr = Get-ShipDePullRequestByNumber -Number ([int]$pr.number)
    Assert-ShipDeReviewTarget -PullRequest $currentPr -ExpectedHeadSha $reviewHeadSha
    Invoke-ShipDeGit -Path $script:Paths.Codex -Arguments @("switch", "--detach", $reviewHeadSha) | Out-Null

    $detachedHeadSha = (& git -C $script:Paths.Codex rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0 -or $detachedHeadSha -ne $reviewHeadSha) {
        throw "Codex worktree is not detached at the approved head $reviewHeadSha."
    }

    New-Item -ItemType Directory -Path $script:HandoffRoot -Force | Out-Null
    $reviewStem = "pr-{0}-{1}-codex-review" -f $pr.number, $reviewHeadSha.Substring(0, 8)
    $reviewFile = Join-Path $script:HandoffRoot "$reviewStem.txt"
    $diagnosticFile = Join-Path $script:HandoffRoot "$reviewStem-diagnostics.txt"
    Push-Location $script:Paths.Codex
    $previousErrorActionPreference = $ErrorActionPreference
    try {
        # Codex emits progress diagnostics on native stderr. Keep those in a
        # separate local file so GitHub receives only the final review.
        $ErrorActionPreference = "Continue"
        $output = @(& codex review --base origin/main 2> $diagnosticFile)
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
        Pop-Location
    }

    if ($exitCode -ne 0) {
        throw "Codex review failed with exit code $exitCode. Diagnostics: $diagnosticFile"
    }
    if ($output.Count -eq 0) {
        throw "Codex returned no final review. Diagnostics: $diagnosticFile"
    }

    $currentPr = Get-ShipDePullRequestByNumber -Number ([int]$pr.number)
    Assert-ShipDeReviewTarget -PullRequest $currentPr -ExpectedHeadSha $reviewHeadSha

    $reviewText = $output -join [Environment]::NewLine
    $targetHeader = '**Review target:** `{0}`' -f $reviewHeadSha
    if ($reviewText -notmatch [regex]::Escape($reviewHeadSha)) {
        $reviewText = $targetHeader + [Environment]::NewLine + [Environment]::NewLine + $reviewText
        $output = @($reviewText -split '\r?\n')
    }
    $output | Set-Content -Path $reviewFile -Encoding UTF8
    $output | ForEach-Object { Write-Host $_ }
    $nonEmptyReviewLines = @($reviewText -split '\r?\n' | Where-Object {
        -not [string]::IsNullOrWhiteSpace($_)
    })
    if ($nonEmptyReviewLines.Count -lt 2) {
        throw "Codex review output is incomplete. No verdict was accepted or posted."
    }

    # A verdict is trustworthy only when it is the sole standalone verdict
    # marker and the final non-empty line of a non-empty report.
    $verdictPattern = '(?im)^[\t ]*(?:\*\*)?(?:(?:FINAL[\t ]+)?VERDICT[\t ]*:[\t ]*)?(PASS|CHANGES_REQUIRED|BLOCKED)(?:\*\*)?[\t ]*$'
    $verdictMatches = [regex]::Matches($reviewText, $verdictPattern)
    $terminalVerdict = [regex]::Match(
        [string]$nonEmptyReviewLines[$nonEmptyReviewLines.Count - 1],
        '(?i)^[\t ]*(?:\*\*)?(?:(?:FINAL[\t ]+)?VERDICT[\t ]*:[\t ]*)?(PASS|CHANGES_REQUIRED|BLOCKED)(?:\*\*)?[\t ]*$'
    )
    if ($verdictMatches.Count -ne 1 -or -not $terminalVerdict.Success) {
        throw "Codex review output is incomplete or ambiguous. The final non-empty line must contain the only PASS, CHANGES_REQUIRED or BLOCKED verdict. Nothing was posted."
    }
    $verdict = $terminalVerdict.Groups[1].Value.ToUpperInvariant()

    # GitHub limits one comment to 65,536 bytes. Keep the complete local report,
    # and split large reports into safe ordered comments without dropping text.
    $commentFiles = [System.Collections.Generic.List[string]]::new()
    $reviewByteCount = [System.Text.Encoding]::UTF8.GetByteCount($reviewText)
    if ($reviewByteCount -le 60000) {
        $commentFiles.Add($reviewFile)
    } else {
        $reviewParts = [System.Collections.Generic.List[string]]::new()
        $maxPartCharacters = 14000
        $offset = 0
        while ($offset -lt $reviewText.Length) {
            $partLength = [Math]::Min($maxPartCharacters, $reviewText.Length - $offset)
            if (
                $offset + $partLength -lt $reviewText.Length -and
                [char]::IsHighSurrogate($reviewText[$offset + $partLength - 1]) -and
                [char]::IsLowSurrogate($reviewText[$offset + $partLength])
            ) {
                $partLength--
            }
            $reviewParts.Add($reviewText.Substring($offset, $partLength))
            $offset += $partLength
        }

        for ($partIndex = 0; $partIndex -lt $reviewParts.Count; $partIndex++) {
            $commentFile = Join-Path $script:HandoffRoot (
                "{0}-github-part-{1:D2}-of-{2:D2}.txt" -f $reviewStem, ($partIndex + 1), $reviewParts.Count
            )
            $commentText = (
                "Codex review for PR #{0}, immutable head {1} - part {2} of {3}" -f
                $pr.number,
                $reviewHeadSha,
                ($partIndex + 1),
                $reviewParts.Count
            ) + [Environment]::NewLine + [Environment]::NewLine + $reviewParts[$partIndex]
            if ([System.Text.Encoding]::UTF8.GetByteCount($commentText) -gt 60000) {
                throw "Internal error: a Codex review comment part exceeds the safe GitHub size."
            }
            $commentText | Set-Content -Path $commentFile -Encoding UTF8
            $commentFiles.Add($commentFile)
        }
    }

    Write-Host ("Review target : {0}" -f $reviewHeadSha)
    Write-Host ("Review file   : {0}" -f $reviewFile)
    Write-Host ("Diagnostics   : {0}" -f $diagnosticFile)
    Write-Host ("Verdict       : {0}" -f $verdict)
    Write-Host ("GitHub parts  : {0}" -f $commentFiles.Count)
    $post = Read-Host "Post the complete Codex review to PR #$($pr.number)? (Y/N)"
    if ($post -match '(?i)^y(?:es)?$') {
        foreach ($commentFile in $commentFiles) {
            & gh pr comment $pr.number --repo $Repository --body-file $commentFile
            if ($LASTEXITCODE -ne 0) {
                throw "Could not post every review comment. Local review files are preserved."
            }
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
        Write-Host ([string]$pr.url)
        Write-Host "PASS recorded for the immutable head above. Only the human merge owner may merge."
    }
}

function Get-ShipDeExactHeadCodexVerdict {
    param(
        [Parameter(Mandatory = $true)][int]$PullRequestNumber,
        [Parameter(Mandatory = $true)][string]$HeadSha,
        [string]$MergeCommitOid
    )

    if ([string]::IsNullOrWhiteSpace($HeadSha)) {
        return $null
    }

    # 1. Check local handoff files for an exact-HEAD review with terminal verdict
    $handoffFiles = @(Get-ChildItem -Path $script:HandoffRoot -Filter "pr-$PullRequestNumber-*-review*.txt" -ErrorAction SilentlyContinue)
    foreach ($hf in $handoffFiles) {
        $content = Get-Content -LiteralPath $hf.FullName -Raw -Encoding UTF8 -ErrorAction SilentlyContinue
        if ($content) {
            $matchesTarget = $false
            $targetMatch = [regex]::Match($content, '(?im)^\s*(?:\*\*)?(?:Review target|Reviewed exact head|Reviewed immutable head)\s*:\s*(?:\*\*)?\s*`?([a-f0-9]{7,40})`?')
            if (-not $targetMatch.Success) {
                $targetMatch = [regex]::Match($content, '(?im)Reviewed PR #\d+ at\s+`?([a-f0-9]{7,40})`?')
            }
            if ($targetMatch.Success) {
                $targetSha = $targetMatch.Groups[1].Value
                if ($HeadSha.StartsWith($targetSha, [System.StringComparison]::OrdinalIgnoreCase) -or $targetSha.StartsWith($HeadSha, [System.StringComparison]::OrdinalIgnoreCase)) {
                    $matchesTarget = $true
                }
            } elseif ($hf.Name -match ("pr-{0}-([a-f0-9]{{7,40}})" -f $PullRequestNumber)) {
                $targetSha = $matches[1]
                if ($HeadSha.StartsWith($targetSha, [System.StringComparison]::OrdinalIgnoreCase)) {
                    $matchesTarget = $true
                }
            }

            if ($matchesTarget) {
                $lines = @($content -split '\r?\n' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
                if ($lines.Count -gt 0) {
                    $lastLine = $lines[-1].Trim()
                    if ($lastLine -match '(?i)^(?:(?:\*\*)?(?:(?:FINAL[\t ]+)?VERDICT[\t ]*:[\t ]*)?(PASS|CHANGES_REQUIRED|BLOCKED)(?:\*\*)?)$') {
                        return $matches[1].ToUpperInvariant()
                    }
                }
            }
        }
    }

    # 2. Check GitHub PR comments for a Codex review for HeadSha
    try {
        $rawComments = & gh pr view $PullRequestNumber --repo $Repository --json comments 2>$null
        if ($rawComments) {
            $parsed = ($rawComments -join [Environment]::NewLine) | ConvertFrom-Json
            if ($parsed -and $parsed.comments) {
                foreach ($commentObj in @($parsed.comments)) {
                    $body = [string]$commentObj.body
                    if ([string]::IsNullOrWhiteSpace($body)) { continue }
                    $targetMatch = [regex]::Match($body, '(?im)(?:\*\*)?(?:Review target|Reviewed exact head|Reviewed immutable head)\s*:\s*(?:\*\*)?\s*`?([a-f0-9]{7,40})`?')
                    if (-not $targetMatch.Success) {
                        $targetMatch = [regex]::Match($body, '(?im)immutable head\s+`?([a-f0-9]{7,40})`?')
                    }
                    if (-not $targetMatch.Success) {
                        $targetMatch = [regex]::Match($body, '(?im)Reviewed PR #\d+ at\s+`?([a-f0-9]{7,40})`?')
                    }

                    if ($targetMatch.Success) {
                        $targetSha = $targetMatch.Groups[1].Value
                        if ($HeadSha.StartsWith($targetSha, [System.StringComparison]::OrdinalIgnoreCase) -or $targetSha.StartsWith($HeadSha, [System.StringComparison]::OrdinalIgnoreCase)) {
                            $lines = @($body -split '\r?\n' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
                            if ($lines.Count -gt 0) {
                                $lastLine = $lines[-1].Trim()
                                if ($lastLine -match '(?i)^(?:(?:\*\*)?(?:(?:FINAL[\t ]+)?VERDICT[\t ]*:[\t ]*)?(PASS|CHANGES_REQUIRED|BLOCKED)(?:\*\*)?)$') {
                                    return $matches[1].ToUpperInvariant()
                                }
                            }
                        }
                    }
                }
            }
        }
    } catch {}

    return $null
}

function Get-ShipDeMergedPullRequests {
    # Query and validate every merged Pull Request before synchronization
    # mutates any worktree. This is the fail-before-sync preflight boundary.
    $rawJson = @(& gh pr list --repo $Repository --state merged --json number,title,headRefName,headRefOid,mergeCommit --limit 100 2>$null) -join "`n"
    if ($LASTEXITCODE -ne 0) {
        throw "Cannot read merged Pull Requests from GitHub."
    }
    if ([string]::IsNullOrWhiteSpace($rawJson)) {
        return @()
    }

    return @(ConvertFrom-ShipDeMergedPullRequestList -Json $rawJson)
}

function Sync-ShipDeRegister {
    param(
        [string]$Workspace = $script:Paths.Main,
        [string]$RegisterRelativePath = $script:RegisterPath,
        [switch]$CheckOnly,
        [Parameter(Mandatory = $false)]
        [AllowEmptyCollection()]
        [object[]]$MergedPullRequests
    )

    $fullRegisterPath = Join-Path $Workspace $RegisterRelativePath
    if (-not (Test-Path -LiteralPath $fullRegisterPath)) {
        return
    }

    # If workspace is the protected main worktree, prevent leaving main dirty
    $isMainWorkspace = ($Workspace -eq $script:Paths.Main)

    # Direct callers retain fail-closed behavior. Invoke-ShipDeSync supplies
    # the already validated preflight snapshot so no query occurs after merge.
    $mergedPrs = if ($PSBoundParameters.ContainsKey("MergedPullRequests")) {
        @($MergedPullRequests)
    } else {
        @(Get-ShipDeMergedPullRequests)
    }
    if ($mergedPrs.Count -eq 0) {
        return
    }

    $rawRows = @(Import-Csv -Path $fullRegisterPath)
    $modified = $false

    foreach ($pr in $mergedPrs) {
        $workItemId = Get-ShipDeWorkItemIdFromTitle -Title ([string]$pr.title)
        if ([string]::IsNullOrWhiteSpace($workItemId)) {
            continue
        }

        $row = $rawRows | Where-Object { $_.work_item_id -eq $workItemId } | Select-Object -First 1
        if ($row) {
            $mergeCommit = if ($pr.mergeCommit -and $pr.mergeCommit.oid) { [string]$pr.mergeCommit.oid } else { "" }
            $prNumberStr = "#{0}" -f $pr.number

            $headSha = if ($pr.headRefOid) { [string]$pr.headRefOid } else { "" }
            if ([string]::IsNullOrWhiteSpace($headSha)) {
                try {
                    $headSha = (& gh pr view ([int]$pr.number) --repo $Repository --json headRefOid --jq .headRefOid 2>$null)
                    if ($headSha) { $headSha = $headSha.Trim() }
                } catch {}
            }

            # Reconcile verdict only from durable exact-HEAD review evidence; fail closed when absent without stale fallback (Finding 1)
            $exactVerdict = Get-ShipDeExactHeadCodexVerdict -PullRequestNumber ([int]$pr.number) -HeadSha $headSha -MergeCommitOid $mergeCommit
            $verdict = if ($exactVerdict -eq "PASS") { "PASS" } else { "" }
            if ([string]::IsNullOrWhiteSpace($verdict)) {
                Write-Warning ("No durable exact-HEAD Codex review PASS found for merged PR #{0} ({1}) at head {2}. Retaining empty verdict (fail-closed)." -f $pr.number, $workItemId, $headSha)
            }

            if ($row.status -ne "MERGED" -or $row.pr -ne $prNumberStr -or $row.codex_verdict -ne $verdict -or $row.merge_commit -ne $mergeCommit) {
                $row.status = "MERGED"
                $row.pr = $prNumberStr
                $row.codex_verdict = $verdict
                if (-not [string]::IsNullOrWhiteSpace($mergeCommit)) {
                    $row.merge_commit = $mergeCommit
                }
                $modified = $true
                Write-Host ("Reconciled merged Work Item {0} (PR #{1}) -> {2} [Verdict: {3}]" -f $workItemId, $pr.number, $mergeCommit, $(if ($verdict) { $verdict } else { "NONE" }))
            }
        }
    }

    if ($modified) {
        if ($isMainWorkspace -or $CheckOnly) {
            Write-Warning "Register synchronization detected merge evidence, but protected main worktree is not edited directly to prevent dirty state."
            Write-Host "Reconcile register changes through an author/planner worktree Pull Request."
        } else {
            $rawRows | Export-Csv -Path $fullRegisterPath -NoTypeInformation -Encoding UTF8
            Write-Host "Register synchronized from merged GitHub Pull Requests with verified review evidence."
        }
    }
}

function Invoke-ShipDeSync {
    Assert-ShipDeRepository -Path $script:Paths.Main
    Assert-ShipDeClean -Path $script:Paths.Main

    # Complete the external-data preflight before the first Git operation can
    # update main or any parked worktree.
    $mergedPullRequests = @(Get-ShipDeMergedPullRequests)

    Invoke-ShipDeGit -Path $script:Paths.Main -Arguments @("fetch", "origin", "--prune") | Out-Null
    Invoke-ShipDeGit -Path $script:Paths.Main -Arguments @("switch", "main") | Out-Null
    Invoke-ShipDeGit -Path $script:Paths.Main -Arguments @("merge", "--ff-only", "origin/main") | Out-Null

    # Reconcile from the immutable preflight snapshot; never leave protected
    # main dirty and never re-query GitHub after worktree synchronization starts.
    Sync-ShipDeRegister -Workspace $script:Paths.Main -CheckOnly -MergedPullRequests $mergedPullRequests

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

function Assert-ShipDeSyncPreflightOrdering {
    $syncAst = (Get-Command Invoke-ShipDeSync -CommandType Function).ScriptBlock.Ast
    $preflightCommands = @($syncAst.FindAll({
        param($node)
        $node -is [System.Management.Automation.Language.CommandAst] -and
        $node.GetCommandName() -eq "Get-ShipDeMergedPullRequests"
    }, $true))
    $gitCommands = @($syncAst.FindAll({
        param($node)
        $node -is [System.Management.Automation.Language.CommandAst] -and
        $node.GetCommandName() -eq "Invoke-ShipDeGit"
    }, $true))

    if ($preflightCommands.Count -ne 1 -or $gitCommands.Count -eq 0) {
        throw "Controller sync preflight ordering check could not identify the required command boundary."
    }

    $firstGitCommand = $gitCommands |
        Sort-Object -Property { $_.Extent.StartOffset } |
        Select-Object -First 1
    if ($preflightCommands[0].Extent.StartOffset -ge $firstGitCommand.Extent.StartOffset) {
        throw "Controller sync preflight must complete before any worktree Git operation."
    }
}

function Show-ShipDeStatus {
    Write-Host "=== WORKTREES ==="
    foreach ($entry in $script:Paths.GetEnumerator()) {
        if (-not (Test-Path (Join-Path $entry.Value ".git"))) {
            Write-Host ("{0,-8} MISSING {1}" -f $entry.Key, $entry.Value)
            continue
        }
        $branchRaw = & git -C $entry.Value branch --show-current 2>$null
        $branch = if ($null -ne $branchRaw) { ([string]$branchRaw).Trim() } else { "" }
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

# ============================================================================
# SUPERVISOR FUNCTIONS (TASK-AI-06)
# Deterministic AO control. AO is launched through the existing AgentRouter
# Claude profile by start-agent-orchestrator.ps1.
# ============================================================================

$script:SupervisorStateFile = Join-Path $script:HandoffRoot "supervisor-state.json"
$script:AoRouterRuntimeFile = Join-Path $script:HandoffRoot "ao-router-runtime.json"
$script:AgentRouterProfile = Join-Path $env:USERPROFILE ".claude"
$script:AgentRouterPort = 20128

function Assert-ShipDeAoCommand {
    if (-not (Get-Command "ao" -ErrorAction SilentlyContinue)) {
        throw "Missing required command: ao. Install the AO CLI before supervisor mode."
    }
}

function Join-ShipDeNativeOutput {
    param([AllowNull()][object[]]$Output)
    return (@($Output | ForEach-Object { [string]$_ }) -join [Environment]::NewLine).Trim()
}

function ConvertFrom-ShipDeAoJson {
    param(
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Json,
        [Parameter(Mandatory = $true)][string]$Operation
    )
    if ([string]::IsNullOrWhiteSpace($Json)) {
        throw "AO returned no JSON for $Operation."
    }
    try {
        return $Json | ConvertFrom-Json
    } catch {
        throw ("AO returned malformed JSON for {0}: {1}" -f $Operation, $_.Exception.Message)
    }
}

function Get-ShipDeObjectProperty {
    param(
        [AllowNull()][object]$Object,
        [Parameter(Mandatory = $true)][string[]]$Names
    )
    if ($null -eq $Object) {
        return $null
    }
    foreach ($name in $Names) {
        $property = $Object.PSObject.Properties[$name]
        if ($property) {
            return $property.Value
        }
    }
    return $null
}

function Get-ShipDeAoSessionPayload {
    param([Parameter(Mandatory = $true)][object]$Response)

    foreach ($candidate in @(
        $Response,
        (Get-ShipDeObjectProperty -Object $Response -Names @("session")),
        (Get-ShipDeObjectProperty -Object $Response -Names @("result", "data"))
    )) {
        if ($null -eq $candidate) {
            continue
        }
        $nestedSession = Get-ShipDeObjectProperty -Object $candidate -Names @("session")
        if ($nestedSession) {
            return $nestedSession
        }
        $id = Get-ShipDeObjectProperty -Object $candidate -Names @("id", "sessionId", "session_id")
        if (-not [string]::IsNullOrWhiteSpace([string]$id)) {
            return $candidate
        }
    }
    throw "AO JSON does not contain a session payload."
}

function Get-ShipDeAoSessionId {
    param([Parameter(Mandatory = $true)][object]$Response)

    $session = Get-ShipDeAoSessionPayload -Response $Response
    $id = Get-ShipDeObjectProperty -Object $session -Names @("id", "sessionId", "session_id")
    if ([string]::IsNullOrWhiteSpace([string]$id)) {
        throw "AO session payload does not contain an ID."
    }
    return [string]$id
}

function Test-ShipDeAoReadiness {
    try {
        $output = @(& ao status --json 2>&1)
        $exitCode = $LASTEXITCODE
        $text = Join-ShipDeNativeOutput -Output $output
        if ($exitCode -ne 0) {
            return @{ Ready = $false; Reason = ("ao status failed with exit code {0}: {1}" -f $exitCode, $text) }
        }
        $status = ConvertFrom-ShipDeAoJson -Json $text -Operation "status"
        return @{ Ready = $true; Status = $status }
    } catch {
        return @{ Ready = $false; Reason = $_.Exception.Message }
    }
}

function Assert-ShipDeAgentRouterProfile {
    $settingsPath = Join-Path $script:AgentRouterProfile "settings.json"
    if (-not (Test-Path $settingsPath)) {
        throw "AgentRouter Claude profile is missing: $settingsPath"
    }
    try {
        $config = Get-Content $settingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
    } catch {
        throw "AgentRouter Claude profile contains invalid JSON: $settingsPath"
    }

    $baseUrl = [string]$config.env.ANTHROPIC_BASE_URL
    $uri = $null
    if (
        [string]::IsNullOrWhiteSpace($baseUrl) -or
        -not [Uri]::TryCreate($baseUrl, [UriKind]::Absolute, [ref]$uri) -or
        $uri.Scheme -ne "http" -or
        $uri.Host -notin @("localhost", "127.0.0.1") -or
        $uri.Port -ne $script:AgentRouterPort -or
        $uri.AbsolutePath.TrimEnd('/') -ne "/v1" -or
        -not [string]::IsNullOrWhiteSpace($uri.Query) -or
        -not [string]::IsNullOrWhiteSpace($uri.Fragment) -or
        -not [string]::IsNullOrWhiteSpace($uri.UserInfo)
    ) {
        throw "AgentRouter Claude profile must use http://localhost:$($script:AgentRouterPort)/v1."
    }
    if (-not (Test-ShipDeTcpPort -HostName "127.0.0.1" -Port $script:AgentRouterPort)) {
        throw "AgentRouter is not listening on 127.0.0.1:$($script:AgentRouterPort)."
    }
    if (-not (Test-Path $script:AoRouterRuntimeFile)) {
        throw "AO router runtime marker is missing. Start AO with scripts/ai/start-agent-orchestrator.ps1."
    }
    try {
        $runtime = Get-Content $script:AoRouterRuntimeFile -Raw -Encoding UTF8 | ConvertFrom-Json
    } catch {
        throw "AO router runtime marker is malformed. Restart AO through the governed launcher."
    }
    if ([string]$runtime.profile -ne $script:AgentRouterProfile -or [string]$runtime.base_url -ne $baseUrl) {
        throw "AO was not launched with the current AgentRouter Claude profile."
    }

    $processId = 0
    if (-not [int]::TryParse([string]$runtime.process_id, [ref]$processId) -or $processId -le 0) {
        throw "AO router runtime marker does not contain a valid process ID."
    }
    $aoProcess = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if ($null -eq $aoProcess -or $aoProcess.ProcessName -ne "agent-orchestrator") {
        throw "AO router runtime marker is stale. Restart AO through the governed launcher."
    }
}

function Ensure-ShipDeAgentRouterRuntime {
    try {
        Assert-ShipDeAgentRouterProfile
        $readiness = Test-ShipDeAoReadiness
        if ($readiness.Ready) {
            return
        }
        throw $readiness.Reason
    } catch {
        Write-Warning ("AO is not ready through AgentRouter: {0}" -f $_.Exception.Message)
    }

    $launcherPath = Join-Path $PSScriptRoot "start-agent-orchestrator.ps1"
    if (-not (Test-Path -LiteralPath $launcherPath)) {
        throw "Governed AO launcher is missing: $launcherPath"
    }

    Write-Host "[SUPERVISOR] Starting AO through the AgentRouter Claude profile..."
    try {
        & $launcherPath -AiRoot $AiRoot -AgentRouterPort $script:AgentRouterPort -Restart
    } catch {
        throw "The governed AO launcher failed: $($_.Exception.Message)"
    }

    Assert-ShipDeAgentRouterProfile
    $readiness = Test-ShipDeAoReadiness
    if (-not $readiness.Ready) {
        throw "AO is not ready after governed restart: $($readiness.Reason)"
    }
}

function Get-ShipDeAoSessionById {
    param(
        [Parameter(Mandatory = $true)][string]$SessionId,
        [string]$Project = "shipde-platform"
    )

    $output = @(& ao session get $SessionId --project $Project --json 2>&1)
    $exitCode = $LASTEXITCODE
    $text = Join-ShipDeNativeOutput -Output $output
    if ($exitCode -ne 0) {
        return $null
    }
    $response = ConvertFrom-ShipDeAoJson -Json $text -Operation "session get"
    return Get-ShipDeAoSessionPayload -Response $response
}

function Get-ShipDeNextPreparedItem {
    $items = @(Get-ShipDePreparedItems)
    if ($items.Count -eq 0) {
        return $null
    }
    return $items[0]
}

function Get-ShipDeAoWorkerName {
    param([Parameter(Mandatory = $true)][object]$Item)

    $name = ("{0}-worker" -f $Item.WorkItemId.ToLowerInvariant())
    if ($name.Length -gt 20) {
        $name = $name.Substring(0, 20)
    }
    return $name
}

function New-ShipDeAuthorPrompt {
    param([Parameter(Mandatory = $true)][object]$Item)

    return @"
Implement $($Item.WorkItemId) on branch $($Item.Branch).
Read AGENTS.md, $($Item.WorkItemPath), and the complete author prompt under docs/product-spec/docs/10-ai-collaboration before editing.
Continue autonomously through implementation, deterministic verification, commit, push, and Pull Request creation or update.
Use only the Work Item's allowed paths. Do not merge. Do not start another Work Item.
When CI or an exact-HEAD review requests changes, repair the same branch and re-run its full governed verification.
"@
}

function Get-ShipDeAoHarnessCandidates {
    param([Parameter(Mandatory = $true)][string]$Author)

    switch ($Author.ToUpperInvariant()) {
        "GEMINI" { return @("agy", "gemini") }
        "9ROUTER" { return @("claude-code") }
        default { throw "Unsupported implementation author: $Author" }
    }
}

function New-ShipDeAoSpawnArguments {
    param(
        [Parameter(Mandatory = $true)][object]$Item,
        [Parameter(Mandatory = $true)][string]$Harness,
        [Parameter(Mandatory = $true)][string]$Prompt,
        [string]$Project = "shipde-platform"
    )

    $name = Get-ShipDeAoWorkerName -Item $Item
    $mode = if ($Harness -eq "claude-code") { "chat" } else { "tui" }

    return @(
        "spawn",
        "--project", $Project,
        "--kind", "worker",
        "--name", $name,
        "--mode", $mode,
        "--branch", $Item.Branch,
        "--harness", $Harness,
        "--prompt", $Prompt
    )
}

function Get-ShipDeAoSessions {
    param([string]$Project = "shipde-platform")

    $output = @(& ao session ls --project $Project --json 2>&1)
    $exitCode = $LASTEXITCODE
    $text = Join-ShipDeNativeOutput -Output $output
    if ($exitCode -ne 0) {
        throw "Cannot query AO sessions for project '$Project': $text"
    }

    $response = ConvertFrom-ShipDeAoJson -Json $text -Operation "session ls"
    if ($response -is [System.Array]) {
        return @($response)
    }

    foreach ($candidate in @(
        $response,
        (Get-ShipDeObjectProperty -Object $response -Names @("result", "data"))
    )) {
        if ($null -eq $candidate) {
            continue
        }
        if ($candidate -is [System.Array]) {
            return @($candidate)
        }
        $sessions = Get-ShipDeObjectProperty -Object $candidate -Names @("sessions", "items")
        if ($null -ne $sessions) {
            return @($sessions)
        }
    }
    throw "AO session ls JSON does not contain a session collection."
}

function Get-ShipDeAoSessionName {
    param([Parameter(Mandatory = $true)][object]$Session)

    return [string](Get-ShipDeObjectProperty -Object $Session -Names @("name", "displayName", "display_name"))
}

function Start-ShipDeAoWorker {
    param(
        [Parameter(Mandatory = $true)][object]$Item,
        [Parameter(Mandatory = $true)][string]$Prompt,
        [string]$Project = "shipde-platform",
        [switch]$DryRun
    )

    $failures = [System.Collections.Generic.List[string]]::new()
    foreach ($harness in @(Get-ShipDeAoHarnessCandidates -Author $Item.Author)) {
        $arguments = New-ShipDeAoSpawnArguments -Item $Item -Harness $harness -Prompt $Prompt -Project $Project
        if ($DryRun) {
            Write-Host ("[SUPERVISOR][DRY-RUN] ao {0}" -f ($arguments -join " "))
            return [PSCustomObject]@{ SessionId = "dry-run-$($Item.WorkItemId.ToLowerInvariant())"; Harness = $harness }
        }

        $beforeIds = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
        foreach ($session in @(Get-ShipDeAoSessions -Project $Project)) {
            try {
                $null = $beforeIds.Add((Get-ShipDeAoSessionId -Response $session))
            } catch {}
        }

        $output = @(& ao @arguments 2>&1)
        $exitCode = $LASTEXITCODE
        $text = Join-ShipDeNativeOutput -Output $output
        if ($exitCode -eq 0) {
            $expectedName = Get-ShipDeAoWorkerName -Item $Item
            for ($attempt = 0; $attempt -lt 10; $attempt++) {
                $matches = @(
                    Get-ShipDeAoSessions -Project $Project | Where-Object {
                        $sessionId = Get-ShipDeAoSessionId -Response $_
                        -not $beforeIds.Contains($sessionId) -and
                        (Get-ShipDeAoSessionName -Session $_) -eq $expectedName
                    }
                )
                if ($matches.Count -gt 1) {
                    throw "AO created multiple sessions named '$expectedName'; refusing an ambiguous worker binding."
                }
                if ($matches.Count -eq 1) {
                    return [PSCustomObject]@{
                        SessionId = Get-ShipDeAoSessionId -Response $matches[0]
                        Harness = $harness
                    }
                }
                Start-Sleep -Milliseconds 500
            }
            throw "AO spawn succeeded but the new session '$expectedName' could not be identified through ao session ls. Output: $text"
        }
        $failures.Add(("{0} => exit {1}: {2}" -f $harness, $exitCode, $text))
    }

    throw "No eligible AO implementation harness could be started. $($failures -join ' | ')"
}

function Send-ShipDeAoMessage {
    param(
        [Parameter(Mandatory = $true)][string]$SessionId,
        [Parameter(Mandatory = $true)][string]$Message
    )

    $output = @(& ao send --session $SessionId --message $Message 2>&1)
    if ($LASTEXITCODE -ne 0) {
        Write-Warning ("AO message failed for {0}: {1}" -f $SessionId, (Join-ShipDeNativeOutput -Output $output))
        return $false
    }
    return $true
}

function Start-ShipDeAoReview {
    param([Parameter(Mandatory = $true)][string]$SessionId)

    $output = @(& ao review trigger $SessionId 2>&1)
    if ($LASTEXITCODE -ne 0) {
        Write-Warning ("AO Codex review trigger failed: {0}" -f (Join-ShipDeNativeOutput -Output $output))
        return $false
    }
    return $true
}

function Write-ShipDeSupervisorCheckpoint {
    param([Parameter(Mandatory = $true)][hashtable]$State)

    $State.CheckpointTime = (Get-Date).ToUniversalTime().ToString("o")
    $temporaryPath = "$script:SupervisorStateFile.tmp"
    $State | ConvertTo-Json -Depth 12 | Set-Content -Path $temporaryPath -Encoding UTF8
    Move-Item -LiteralPath $temporaryPath -Destination $script:SupervisorStateFile -Force
}

function Read-ShipDeSupervisorCheckpoint {
    if (-not (Test-Path $script:SupervisorStateFile)) {
        return $null
    }
    try {
        $stateObject = Get-Content $script:SupervisorStateFile -Raw -Encoding UTF8 | ConvertFrom-Json
    } catch {
        throw "Supervisor checkpoint is malformed. Preserve it for diagnosis and stop fail-closed."
    }
    $state = @{}
    foreach ($property in $stateObject.PSObject.Properties) {
        $state[$property.Name] = $property.Value
    }
    return $state
}

function Get-ShipDeSessionActivityState {
    param([AllowNull()][object]$Session)

    if ($null -eq $Session) {
        return "MISSING"
    }
    $status = Get-ShipDeObjectProperty -Object $Session -Names @(
        "activity", "activityState", "activity_state", "status", "state", "derivedStatus"
    )
    if ($status -isnot [string] -and $null -ne $status) {
        $status = Get-ShipDeObjectProperty -Object $status -Names @("state", "status", "name", "value")
    }
    if ($status -isnot [string]) {
        $status = ""
    }
    switch ($status.ToLowerInvariant()) {
        "idle" { return "IDLE" }
        "waiting_for_input" { return "IDLE" }
        "input_needed" { return "IDLE" }
        "active" { return "ACTIVE" }
        "busy" { return "ACTIVE" }
        "running" { return "ACTIVE" }
        "completed" { return "COMPLETED" }
        "done" { return "COMPLETED" }
        "failed" { return "FAILED" }
        "error" { return "FAILED" }
        "stopped" { return "STOPPED" }
        "exited" { return "STOPPED" }
        default { return "UNKNOWN" }
    }
}

function Test-ShipDeSessionProviderFailure {
    param([AllowNull()][object]$Session)

    if ($null -eq $Session) {
        return $false
    }
    $text = $Session | ConvertTo-Json -Depth 20
    return [regex]::IsMatch(
        $text,
        '(?i)(quota (?:exceeded|exhausted)|usage[ _-]?limit|rate[ _-]?limit|too many requests|out of credits|insufficient credits|model unavailable|authentication failed|unauthorized|forbidden|(?:http|status|code)[^0-9]{0,8}(?:401|403|429)\b)'
    )
}

function Get-ShipDeOpenPullRequestForWorkItem {
    param([Parameter(Mandatory = $true)][string]$WorkItemId)

    $matches = @(Get-ShipDeOpenPullRequests | Where-Object {
        (Get-ShipDeWorkItemIdFromTitle -Title ([string]$_.title)) -eq $WorkItemId
    })
    if ($matches.Count -eq 0) {
        return $null
    }
    return $matches[0]
}

function Invoke-ShipDeSupervisorLoop {
    param(
        [Parameter(Mandatory = $true)][hashtable]$State,
        [string]$Project = "shipde-platform",
        [int]$PollIntervalSeconds = 30,
        [int]$InactivityTimeoutMinutes = 10,
        [int]$MaxNudges = 1
    )

    if (-not $State.ContainsKey("LastActivityTime")) {
        $State.LastActivityTime = (Get-Date).ToUniversalTime().ToString("o")
    }
    if (-not $State.ContainsKey("NudgeCount")) {
        $State.NudgeCount = 0
    }
    if (-not $State.ContainsKey("UnknownPollCount")) {
        $State.UnknownPollCount = 0
    }

    while ($true) {
        $session = Get-ShipDeAoSessionById -SessionId ([string]$State.SessionId) -Project $Project
        $activity = Get-ShipDeSessionActivityState -Session $session
        $pullRequest = Get-ShipDeOpenPullRequestForWorkItem -WorkItemId ([string]$State.WorkItemId)

        $previousActivity = [string]$State.State
        $State.State = $activity
        $State.ProviderFailure = Test-ShipDeSessionProviderFailure -Session $session
        if ($previousActivity -ne $activity) {
            Write-Host ("[SUPERVISOR] {0} session {1}: {2} -> {3}" -f (Get-Date).ToUniversalTime().ToString("o"), $State.SessionId, $previousActivity, $activity)
        }
        Write-ShipDeSupervisorCheckpoint -State $State

        if ($State.ProviderFailure) {
            throw "AgentRouter exhausted its approved fallback routes for session $($State.SessionId)."
        }

        if ($activity -in @("FAILED", "STOPPED", "MISSING")) {
            throw "AO worker ended before the governed lifecycle completed. State: $activity"
        }

        if ($pullRequest) {
            $headSha = [string]$pullRequest.headRefOid
            $State.PullRequestNumber = [int]$pullRequest.number
            $State.HeadSha = $headSha
            $gate = Get-ShipDePrGate -PullRequest $pullRequest
            $State.CiGate = $gate

            if ($gate -eq "FAILED") {
                if ([string]$State.LastCiRepairHead -ne $headSha) {
                    $message = "CI failed for PR #$($pullRequest.number) at exact HEAD $headSha. Inspect the failing checks, repair this same Work Item, run governed verification, commit, and push. Do not merge."
                    if (-not (Send-ShipDeAoMessage -SessionId ([string]$State.SessionId) -Message $message)) {
                        throw "Cannot route CI failure back to the implementation worker."
                    }
                    $State.LastCiRepairHead = $headSha
                }
            } elseif ($gate -eq "GREEN" -and -not $pullRequest.isDraft) {
                $verdict = Get-ShipDeExactHeadCodexVerdict -PullRequestNumber ([int]$pullRequest.number) -HeadSha $headSha
                $State.ExactHeadVerdict = $verdict

                if ($verdict -eq "PASS") {
                    Write-ShipDeSupervisorCheckpoint -State $State
                    return "READY_FOR_HUMAN_MERGE"
                }
                if ($verdict -eq "CHANGES_REQUIRED") {
                    if ([string]$State.LastReviewRepairHead -ne $headSha) {
                        $message = "Independent Codex review requires changes on PR #$($pullRequest.number) at exact HEAD $headSha. Read the durable review findings, repair the same branch, run all governed checks, commit, push, and stop before merge."
                        if (-not (Send-ShipDeAoMessage -SessionId ([string]$State.SessionId) -Message $message)) {
                            throw "Cannot route review findings back to the implementation worker."
                        }
                        $State.LastReviewRepairHead = $headSha
                    }
                } elseif ([string]$State.LastReviewTriggeredHead -ne $headSha) {
                    if (-not (Start-ShipDeAoReview -SessionId ([string]$State.SessionId))) {
                        throw "CI is green but the independent Codex review could not be started."
                    }
                    $State.LastReviewTriggeredHead = $headSha
                }
            } elseif ($gate -eq "GREEN" -and $pullRequest.isDraft) {
                $State.CiGate = "GREEN_DRAFT"
                if ($activity -eq "COMPLETED") {
                    throw "AO worker completed while PR #$($pullRequest.number) is still draft. Mark the same PR ready before review."
                }
            }
            $State.LastActivityTime = (Get-Date).ToUniversalTime().ToString("o")
            $State.NudgeCount = 0
        } elseif ($activity -eq "ACTIVE") {
            $State.LastActivityTime = (Get-Date).ToUniversalTime().ToString("o")
            $State.NudgeCount = 0
            $State.UnknownPollCount = 0
        } elseif ($activity -eq "IDLE") {
            $State.UnknownPollCount = 0
            $lastActivity = [DateTime]::Parse([string]$State.LastActivityTime).ToUniversalTime()
            $idleDuration = (Get-Date).ToUniversalTime() - $lastActivity
            if ($idleDuration.TotalMinutes -ge $InactivityTimeoutMinutes) {
                if ([int]$State.NudgeCount -ge $MaxNudges) {
                    throw "AO worker is stalled after $MaxNudges bounded nudge attempt(s)."
                }
                $message = "Continue the assigned Work Item autonomously. If genuinely blocked, report one concrete blocker. Do not wait for routine confirmation."
                if (-not (Send-ShipDeAoMessage -SessionId ([string]$State.SessionId) -Message $message)) {
                    throw "AO worker is idle and could not be nudged."
                }
                $State.NudgeCount = [int]$State.NudgeCount + 1
                $State.LastActivityTime = (Get-Date).ToUniversalTime().ToString("o")
            }
        } elseif ($activity -eq "COMPLETED") {
            throw "AO worker completed without creating a governed Pull Request."
        } elseif ($activity -eq "UNKNOWN") {
            $State.UnknownPollCount = [int]$State.UnknownPollCount + 1
            if ([int]$State.UnknownPollCount -ge 3) {
                throw "AO returned an unknown session state for 3 consecutive polls."
            }
        }

        Write-ShipDeSupervisorCheckpoint -State $State
        Start-Sleep -Seconds $PollIntervalSeconds
    }
}

function Assert-ShipDeSupervisorCompatibility {
    $plain = ConvertFrom-ShipDeAoJson -Json '{"id":"ao-1"}' -Operation "self-test"
    if ((Get-ShipDeAoSessionId -Response $plain) -ne "ao-1") {
        throw "AO plain session JSON compatibility test failed."
    }
    $wrapped = ConvertFrom-ShipDeAoJson -Json '{"result":{"session":{"id":"ao-2"}}}' -Operation "self-test"
    if ((Get-ShipDeAoSessionId -Response $wrapped) -ne "ao-2") {
        throw "AO wrapped session JSON compatibility test failed."
    }

    $fixtureItem = [PSCustomObject]@{
        WorkItemId = "TASK-AI-06"
        Branch = "feat/task-ai-06-orchestrator-supervisor"
    }
    $spawnArgs = New-ShipDeAoSpawnArguments -Item $fixtureItem -Harness "agy" -Prompt "fixture" -Project "shipde-platform"
    if (
        $spawnArgs[0] -ne "spawn" -or
        $spawnArgs -contains "--json" -or
        $spawnArgs -contains "--worktree" -or
        $spawnArgs -contains "--prompt-file" -or
        ($spawnArgs[0..1] -join " ") -eq "session spawn"
    ) {
        throw "AO spawn command compatibility test failed."
    }

    $stateRoundTrip = @{ TestField = "test-value"; NestedObject = @{ Inner = 123 } }
    $temporaryPath = Join-Path $env:TEMP "supervisor-test-$(Get-Random).json"
    try {
        $stateRoundTrip | ConvertTo-Json -Depth 10 | Set-Content -Path $temporaryPath -Encoding UTF8
        $restored = Get-Content $temporaryPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($restored.TestField -ne "test-value" -or $restored.NestedObject.Inner -ne 123) {
            throw "Supervisor checkpoint round-trip test failed."
        }
    } finally {
        if (Test-Path $temporaryPath) {
            Remove-Item $temporaryPath -Force
        }
    }
}

function Invoke-ShipDeSupervise {
    Write-Host "SHIP DE DETERMINISTIC ORCHESTRATOR SUPERVISOR"
    Assert-ShipDeAoCommand
    Ensure-ShipDeAgentRouterRuntime

    $state = Read-ShipDeSupervisorCheckpoint
    if ($state -and $state.SessionId -and $state.WorkItemId) {
        Write-Host "[SUPERVISOR] Resuming $($state.WorkItemId) in AO session $($state.SessionId)."
    } else {
        $openImplementationPullRequests = @(Get-ShipDeOpenPullRequests | Where-Object {
            Get-ShipDeWorkItemIdFromTitle -Title ([string]$_.title)
        })
        if ($openImplementationPullRequests.Count -gt 0) {
            $openSummary = @($openImplementationPullRequests | ForEach-Object {
                "#{0} {1}" -f $_.number, $_.title
            }) -join "; "
            throw "Open implementation Pull Request(s) exist without a resumable supervisor checkpoint: $openSummary. Resume or recover that Work Item before consuming another prepared row."
        }

        $item = Get-ShipDeNextPreparedItem
        if (-not $item) {
            Write-Host "[SUPERVISOR] No prepared dependency-ready remote Work Item exists."
            return
        }

        $prompt = New-ShipDeAuthorPrompt -Item $item
        Park-ShipDeCodex
        $spawned = Start-ShipDeAoWorker -Item $item -Prompt $prompt
        $state = @{
            WorkItemId = $item.WorkItemId
            WorkItemPath = $item.WorkItemPath
            Branch = $item.Branch
            Author = $item.Author
            Harness = $spawned.Harness
            SessionId = $spawned.SessionId
            State = "STARTED"
            StartTime = (Get-Date).ToUniversalTime().ToString("o")
            LastActivityTime = (Get-Date).ToUniversalTime().ToString("o")
            NudgeCount = 0
        }
        Write-ShipDeSupervisorCheckpoint -State $state
    }

    $result = Invoke-ShipDeSupervisorLoop -State $state -PollIntervalSeconds $SupervisorPollIntervalSeconds -InactivityTimeoutMinutes $SupervisorInactivityTimeoutMinutes -MaxNudges $SupervisorMaxNudges

    if ($result -eq "READY_FOR_HUMAN_MERGE") {
        Write-Host ("[SUPERVISOR] PR #{0} at {1} has CI GREEN and durable exact-HEAD Codex PASS." -f $state.PullRequestNumber, $state.HeadSha)
        Write-Host "[SUPERVISOR] Human merge is required. No automatic merge was attempted."
        return
    }
    throw "Unexpected supervisor result: $result"
}

function Invoke-ShipDeResume {
    $pullRequests = @(Get-ShipDeOpenPullRequests | Where-Object {
        Get-ShipDeWorkItemIdFromTitle -Title ([string]$_.title)
    })
    if ($pullRequests.Count -gt 0) {
        $pr = $pullRequests[0]
        $headSha = if ($pr.headRefOid) { [string]$pr.headRefOid } else { "" }
        if ([string]::IsNullOrWhiteSpace($headSha)) {
            try {
                $headSha = (& gh pr view ([int]$pr.number) --repo $Repository --json headRefOid --jq .headRefOid 2>$null)
                if ($headSha) { $headSha = $headSha.Trim() }
            } catch {}
        }

        $exactVerdict = Get-ShipDeExactHeadCodexVerdict -PullRequestNumber ([int]$pr.number) -HeadSha $headSha
        if ($exactVerdict -eq "CHANGES_REQUIRED") {
            $item = Get-ShipDePrWorkItem -PullRequest $pr
            if ($item) {
                Write-Host ("PR #{0} has exact-head Codex verdict CHANGES_REQUIRED for head {1}." -f $pr.number, $headSha)
                Write-Host ("Routing to fix round for {0}..." -f $item.Author)
                Start-ShipDeFixRound -PullRequest $pr -Item $item
                return
            }
        } elseif ($exactVerdict -eq "PASS") {
            Write-Host ("PR #{0} has exact-head Codex verdict PASS for head {1}. Awaiting human merge." -f $pr.number, $headSha)
            return
        }

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
        Write-Host "7. Supervise (unattended automation)"
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
                "7" { Invoke-ShipDeSupervise }
                "0" { return }
                default { Write-Warning "Invalid choice." }
            }
        } catch {
            Write-Host ("STOPPED SAFELY: {0}" -f $_.Exception.Message) -ForegroundColor Red
        }
        Read-Host "Press Enter to return"
    }
}

Assert-ShipDeJsonListCompatibility
Assert-ShipDeSyncPreflightOrdering
Assert-ShipDeSupervisorCompatibility
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
    "Supervise" { Invoke-ShipDeSupervise }
    default { Show-ShipDeMenu }
}
