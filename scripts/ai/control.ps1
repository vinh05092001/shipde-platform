param(
    [ValidateSet("Menu", "Resume", "Status", "Prepare", "Start", "Review", "Sync", "Supervise")]
    [string]$Action = "Menu",

    [string]$Repository = "vinh05092001/shipde-platform",
    [string]$AiRoot = (Join-Path $env:USERPROFILE "AI"),

    [ValidateRange(0, [int]::MaxValue)]
    [int]$PullRequestNumber = 0,

    [int]$SupervisorPollIntervalSeconds = 30,
    [int]$SupervisorInactivityTimeoutMinutes = 10,
    [ValidateRange(1, 1)]
    [int]$SupervisorMaxNudges = 1,
    [int]$SupervisorReviewTimeoutMinutes = 20
)

. (Join-Path $PSScriptRoot "common.ps1")

$script:RegisterPath = "docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv"
$script:HandoffRoot = Join-Path $AiRoot "handoff"
$script:Paths = Get-ShipDePaths -AiRoot $AiRoot
$script:RequiredPrChecks = @("contract", "application-gate")
$script:RequiredPrCheckProviderPrefix = "github-actions"
$repoOwner = if ($Repository -match '^([^/]+)/') { $matches[1] } else { "" }
$script:TrustedCodexReviewerLogins = @("chatgpt-codex-connector[bot]")
if (-not [string]::IsNullOrWhiteSpace($repoOwner) -and $script:TrustedCodexReviewerLogins -notcontains $repoOwner) {
    $script:TrustedCodexReviewerLogins += $repoOwner
}
$script:NineRouterPinnedVersion = "0.5.55"

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

function ConvertFrom-ShipDeRegisterCsv {
    param([Parameter(Mandatory = $true)][string]$CsvText)

    if ([string]::IsNullOrWhiteSpace($CsvText)) {
        return @()
    }
    return @($CsvText | ConvertFrom-Csv)
}

function Get-ShipDeRowsAtRef {
    param(
        [Parameter(Mandatory = $true)][string]$Ref,
        [scriptblock]$TextResolver = { param($r, $p) Get-ShipDeTextAtRef -Ref $r -Path $p }
    )

    $csv = & $TextResolver $Ref $script:RegisterPath
    return ConvertFrom-ShipDeRegisterCsv -CsvText $csv
}

function Get-ShipDeWorkItemIdFromTitle {
    param([Parameter(Mandatory = $true)][string]$Title)

    $match = [regex]::Match($Title, '^\[(?<id>(?:FEAT-[A-Z0-9-]+|TASK-(?:FOUND|AI)-[0-9]+))\]')
    if (-not $match.Success) {
        return $null
    }
    return $match.Groups["id"].Value
}

function Get-ShipDeControlCellValue {
    param(
        [Parameter(Mandatory = $true)][string]$Markdown,
        [Parameter(Mandatory = $true)][string]$FieldName
    )

    $pattern = '(?im)^\|\s*' + [regex]::Escape($FieldName) + '\s*\|\s*(?<val>[^|\r\n]*)\|'
    $match = [regex]::Match($Markdown, $pattern)
    if (-not $match.Success) {
        return $null
    }
    return $match.Groups["val"].Value.Trim()
}

function Get-ShipDeAssignment {
    param(
        [Parameter(Mandatory = $true)][string]$Ref,
        [Parameter(Mandatory = $true)][object]$Row,
        [scriptblock]$TextResolver = { param($r, $p) Get-ShipDeTextAtRef -Ref $r -Path $p }
    )

    $path = [string]$Row.work_item_path
    $workItemText = & $TextResolver $Ref $path
    if ([string]::IsNullOrWhiteSpace($workItemText)) {
        return $null
    }

    $authorCell = Get-ShipDeControlCellValue -Markdown $workItemText -FieldName "Assigned author"
    if ([string]::IsNullOrWhiteSpace($authorCell)) {
        return $null
    }
    $authorMatch = [regex]::Match($authorCell, '^`?(?<author>GEMINI|9ROUTER)\b`?(?:\s+.*)?$')
    if (-not $authorMatch.Success) {
        return $null
    }

    $idCell = Get-ShipDeControlCellValue -Markdown $workItemText -FieldName "Work Item ID"
    if ([string]::IsNullOrWhiteSpace($idCell)) {
        return $null
    }
    $idMatch = [regex]::Match($idCell, '^`?(?<id>FEAT-[A-Z0-9-]+|TASK-(?:FOUND|AI)-[0-9]+)`?$')
    if (-not $idMatch.Success -or $idMatch.Groups["id"].Value -ne [string]$Row.work_item_id) {
        return $null
    }

    $statusCell = Get-ShipDeControlCellValue -Markdown $workItemText -FieldName "Status"
    if ([string]::IsNullOrWhiteSpace($statusCell)) {
        return $null
    }
    $statusMatch = [regex]::Match($statusCell, '^`?(?<status>[A-Z_]+)`?$')
    if (-not $statusMatch.Success -or $statusMatch.Groups["status"].Value -ne [string]$Row.status) {
        return $null
    }

    $branchCell = Get-ShipDeControlCellValue -Markdown $workItemText -FieldName "Branch"
    if ([string]::IsNullOrWhiteSpace($branchCell)) {
        return $null
    }
    $branchMatch = [regex]::Match($branchCell, '^`?(?<branch>[^`\s]+)`?$')
    if (-not $branchMatch.Success) {
        return $null
    }
    $declaredBranch = $branchMatch.Groups["branch"].Value.Trim()

    $riskCell = Get-ShipDeControlCellValue -Markdown $workItemText -FieldName "Risk"
    if ([string]::IsNullOrWhiteSpace($riskCell)) {
        return $null
    }
    $riskMatch = [regex]::Match($riskCell, '^`?(?<risk>LOW|MEDIUM|HIGH)`?$')
    if (-not $riskMatch.Success) {
        return $null
    }

    $pathsCell = Get-ShipDeControlCellValue -Markdown $workItemText -FieldName "Allowed paths"
    if ([string]::IsNullOrWhiteSpace($pathsCell)) {
        return $null
    }

    $rowBranch = if ($Row.branch) { ([string]$Row.branch).Trim() } else { "" }
    if ([string]::IsNullOrWhiteSpace($rowBranch) -or $rowBranch -ne $declaredBranch) {
        return $null
    }

    $expectedRef = if ($Ref.StartsWith("origin/")) { "origin/$declaredBranch" } else { $declaredBranch }
    if ($Ref -ne $expectedRef) {
        return $null
    }

    $branch = $declaredBranch
    $leaf = Split-Path $branch -Leaf
    $prefix = "$(([string]$Row.work_item_id).ToLowerInvariant())-"
    if (-not $leaf.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $null
    }

    $order = 0
    $orderText = if ($Row.delivery_order) { ([string]$Row.delivery_order).Trim() } else { "" }
    if ([string]::IsNullOrWhiteSpace($orderText) -or -not [int]::TryParse($orderText, [ref]$order) -or $order -lt 0) {
        throw "Delivery order '$orderText' for Work Item '$([string]$Row.work_item_id)' is invalid or non-numeric. Failing closed."
    }

    return [PSCustomObject]@{
        DeliveryOrder = $order
        WorkItemId = [string]$Row.work_item_id
        WorkItemPath = [string]$Row.work_item_path
        Branch = $branch
        Slug = $leaf.Substring($prefix.Length)
        Author = $authorMatch.Groups["author"].Value.ToUpperInvariant()
        Ref = $Ref
    }
}

function Get-ShipDePreparedAssignments {
    param(
        [Parameter(Mandatory = $true)][string[]]$Refs,
        [scriptblock]$RowResolver = { param($r) Get-ShipDeRowsAtRef -Ref $r },
        [scriptblock]$TextResolver = { param($r, $p) Get-ShipDeTextAtRef -Ref $r -Path $p }
    )

    $items = [System.Collections.Generic.List[object]]::new()
    foreach ($ref in $Refs) {
        if ([string]::IsNullOrWhiteSpace($ref) -or $ref -eq "origin/HEAD") {
            continue
        }
        $rows = & $RowResolver $ref
        foreach ($row in @($rows | Where-Object { [string]$_.status -eq "READY_FOR_AUTHOR" })) {
            $assignment = Get-ShipDeAssignment -Ref $ref -Row $row -TextResolver $TextResolver
            if ($assignment) {
                $items.Add($assignment)
            }
        }
    }

    $seenIds = [System.Collections.Generic.Dictionary[string, object]]::new([System.StringComparer]::OrdinalIgnoreCase)
    $seenOrders = [System.Collections.Generic.Dictionary[int, object]]::new()

    foreach ($item in $items) {
        if ($seenIds.ContainsKey($item.WorkItemId)) {
            $prev = $seenIds[$item.WorkItemId]
            throw "Duplicate prepared Work Item ID collision detected: '$($item.WorkItemId)' declared on '$($item.Ref)' and '$($prev.Ref)'. Failing closed."
        }
        if ($seenOrders.ContainsKey($item.DeliveryOrder)) {
            $prev = $seenOrders[$item.DeliveryOrder]
            throw "Duplicate prepared delivery order collision detected: delivery order $($item.DeliveryOrder) declared on '$($item.WorkItemId)' ($($item.Ref)) and '$($prev.WorkItemId)' ($($prev.Ref)). Failing closed."
        }
        $seenIds[$item.WorkItemId] = $item
        $seenOrders[$item.DeliveryOrder] = $item
    }

    return @($items | Sort-Object DeliveryOrder, WorkItemId)
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

    return Get-ShipDePreparedAssignments -Refs $refs
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

    $repoParts = $Repository -split '/'
    if ($repoParts.Count -ne 2) {
        throw "Repository must use the owner/name format before reading open Pull Requests."
    }
    $owner = $repoParts[0]
    $repoName = $repoParts[1]

    $query = @'
query($owner: String!, $name: String!, $base: String!, $endCursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, baseRefName: $base, first: 50, after: $endCursor) {
      nodes {
        number
        title
        url
        isDraft
        headRefName
        headRefOid
        isCrossRepository
        headRepository {
          nameWithOwner
        }
        headRepositoryOwner {
          login
        }
        commits(last: 1) {
          nodes {
            commit {
              statusCheckRollup {
                contexts(first: 100) {
                  pageInfo {
                    hasNextPage
                    endCursor
                  }
                  nodes {
                    __typename
                    ... on CheckRun {
                      name
                      status
                      conclusion
                      startedAt
                      completedAt
                      detailsUrl
                      checkSuite {
                        workflowRun {
                          workflow {
                            name
                          }
                        }
                      }
                    }
                    ... on StatusContext {
                      context
                      state
                      targetUrl
                      createdAt
                    }
                  }
                }
              }
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
}
'@

    $raw = @(& gh api graphql --paginate --slurp `
        -F owner=$owner `
        -F name=$repoName `
        -F base="main" `
        -f query=$query 2>$null)

    if ($LASTEXITCODE -ne 0 -or $raw.Count -eq 0) {
        throw "Cannot read open Pull Requests from GitHub via paginated GraphQL API."
    }

    $pages = (($raw -join [Environment]::NewLine) | ConvertFrom-Json)
    foreach ($page in @($pages)) {
        $nodes = $page.data.repository.pullRequests.nodes
        foreach ($node in @($nodes)) {
            if ($null -eq $node) { continue }

            $checks = [System.Collections.Generic.List[object]]::new()
            $commitNodes = $node.commits.nodes
            if ($commitNodes -and $commitNodes.Count -gt 0) {
                $commit = $commitNodes[0].commit
                if ($commit -and
                    $commit.PSObject.Properties['statusCheckRollup'] -and
                    $commit.statusCheckRollup -and
                    $commit.statusCheckRollup.PSObject.Properties['contexts'] -and
                    $commit.statusCheckRollup.contexts -and
                    $commit.statusCheckRollup.contexts.PSObject.Properties['nodes'] -and
                    $commit.statusCheckRollup.contexts.nodes) {
                    $rollupContexts = $commit.statusCheckRollup.contexts.nodes
                    if ($rollupContexts) {
                        foreach ($ctx in @($rollupContexts)) {
                            if ($ctx) {
                                $wfName = $null
                                try {
                                    if ($ctx.checkSuite -and
                                        $ctx.checkSuite.workflowRun -and
                                        $ctx.checkSuite.workflowRun.workflow -and
                                        $ctx.checkSuite.workflowRun.workflow.name) {
                                        $wfName = [string]$ctx.checkSuite.workflowRun.workflow.name
                                    }
                                } catch {}
                                if (-not [string]::IsNullOrWhiteSpace($wfName) -and -not $ctx.PSObject.Properties['workflowName']) {
                                    $ctx | Add-Member -NotePropertyName "workflowName" -NotePropertyValue $wfName -Force
                                }
                                $checks.Add($ctx)
                            }
                        }
                    }

                    $hasMoreContexts = $false
                    $contextsCursor = $null
                    if ($commit.statusCheckRollup.contexts.PSObject.Properties['pageInfo'] -and
                        $commit.statusCheckRollup.contexts.pageInfo) {
                        $hasMoreContexts = [bool]$commit.statusCheckRollup.contexts.pageInfo.hasNextPage
                        $contextsCursor = [string]$commit.statusCheckRollup.contexts.pageInfo.endCursor
                    }

                    while ($hasMoreContexts -and -not [string]::IsNullOrWhiteSpace($contextsCursor)) {
                        $nestedQuery = @'
query($owner: String!, $name: String!, $oid: GitObjectID!, $after: String!) {
  repository(owner: $owner, name: $name) {
    object(oid: $oid) {
      ... on Commit {
        statusCheckRollup {
          contexts(first: 100, after: $after) {
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              __typename
              ... on CheckRun {
                name
                status
                conclusion
                startedAt
                completedAt
                detailsUrl
                checkSuite {
                  workflowRun {
                    workflow {
                      name
                    }
                  }
                }
              }
              ... on StatusContext {
                context
                state
                targetUrl
                createdAt
              }
            }
          }
        }
      }
    }
  }
}
'@
                        $nestedRaw = @(& gh api graphql `
                            -F owner=$owner `
                            -F name=$repoName `
                            -F oid=([string]$node.headRefOid) `
                            -F after=$contextsCursor `
                            -f query=$nestedQuery 2>$null)
                        if ($LASTEXITCODE -ne 0 -or $nestedRaw.Count -eq 0) {
                            throw "Cannot exhaust nested status check contexts for commit $([string]$node.headRefOid)."
                        }
                        $nestedData = (($nestedRaw -join [Environment]::NewLine) | ConvertFrom-Json)
                        $nestedRollup = $nestedData.data.repository.object.statusCheckRollup.contexts
                        if ($nestedRollup -and $nestedRollup.nodes) {
                            foreach ($nestedCtx in @($nestedRollup.nodes)) {
                                if ($nestedCtx) {
                                    $wfName = $null
                                    try {
                                        if ($nestedCtx.checkSuite -and
                                            $nestedCtx.checkSuite.workflowRun -and
                                            $nestedCtx.checkSuite.workflowRun.workflow -and
                                            $nestedCtx.checkSuite.workflowRun.workflow.name) {
                                            $wfName = [string]$nestedCtx.checkSuite.workflowRun.workflow.name
                                        }
                                    } catch {}
                                    if (-not [string]::IsNullOrWhiteSpace($wfName) -and -not $nestedCtx.PSObject.Properties['workflowName']) {
                                        $nestedCtx | Add-Member -NotePropertyName "workflowName" -NotePropertyValue $wfName -Force
                                    }
                                    $checks.Add($nestedCtx)
                                }
                            }
                        }
                        $hasMoreContexts = [bool]$nestedRollup.pageInfo.hasNextPage
                        $contextsCursor = [string]$nestedRollup.pageInfo.endCursor
                    }
                }
            }

            $headRepoName = ""
            if ($node.PSObject.Properties['headRepository'] -and $node.headRepository -and
                $node.headRepository.PSObject.Properties['nameWithOwner'] -and $node.headRepository.nameWithOwner) {
                $headRepoName = [string]$node.headRepository.nameWithOwner
            }
            $headRepoOwner = ""
            if ($node.PSObject.Properties['headRepositoryOwner'] -and $node.headRepositoryOwner -and
                $node.headRepositoryOwner.PSObject.Properties['login'] -and $node.headRepositoryOwner.login) {
                $headRepoOwner = [string]$node.headRepositoryOwner.login
            }
            $isCrossRepo = $false
            if ($node.PSObject.Properties['isCrossRepository'] -and $null -ne $node.isCrossRepository) {
                $isCrossRepo = [bool]$node.isCrossRepository
            }

            $pullRequest = [PSCustomObject]@{
                number = [int]$node.number
                title = [string]$node.title
                url = [string]$node.url
                isDraft = [bool]$node.isDraft
                headRefName = [string]$node.headRefName
                headRefOid = [string]$node.headRefOid
                isCrossRepository = $isCrossRepo
                headRepository = $headRepoName
                headRepositoryOwner = $headRepoOwner
                statusCheckRollup = $checks.ToArray()
            }

            Assert-ShipDePullRequestRecord -PullRequest $pullRequest
            Write-Output $pullRequest
        }
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

function Get-ShipDeCheckProvider {
    param([Parameter(Mandatory = $true)][object]$Check)

    $workflowName = Get-ShipDeCheckField -Check $Check -Field "workflowName"
    if ([string]::IsNullOrWhiteSpace($workflowName)) {
        try {
            if ($Check.checkSuite -and
                $Check.checkSuite.workflowRun -and
                $Check.checkSuite.workflowRun.workflow -and
                $Check.checkSuite.workflowRun.workflow.name) {
                $workflowName = [string]$Check.checkSuite.workflowRun.workflow.name
            }
        } catch {}
    }
    if (-not [string]::IsNullOrWhiteSpace($workflowName)) {
        return "github-actions/$workflowName"
    }

    $urlText = Get-ShipDeCheckField -Check $Check -Field "detailsUrl"
    if ([string]::IsNullOrWhiteSpace($urlText)) {
        $urlText = Get-ShipDeCheckField -Check $Check -Field "targetUrl"
    }
    $uri = $null
    if ([Uri]::TryCreate($urlText, [UriKind]::Absolute, [ref]$uri)) {
        if ($uri.Host -eq "github.com" -and $uri.AbsolutePath -match '/actions/runs/') {
            return "github-actions"
        }
        return $uri.Host.ToLowerInvariant()
    }

    $typeName = Get-ShipDeCheckField -Check $Check -Field "__typename"
    if (-not [string]::IsNullOrWhiteSpace($typeName)) {
        return $typeName.ToLowerInvariant()
    }
    return "unknown"
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

    # GitHub can retain superseded attempts for one check name on the same
    # immutable head. Only the newest attempt for each name is authoritative.
    $latestByName = @{}
    foreach ($check in @($PullRequest.statusCheckRollup)) {
        $name = Get-ShipDeCheckName -Check $check
        if ([string]::IsNullOrWhiteSpace($name)) { continue }

        $timestampText = Get-ShipDeCheckField -Check $check -Field "startedAt"
        if ([string]::IsNullOrWhiteSpace($timestampText)) {
            $timestampText = Get-ShipDeCheckField -Check $check -Field "completedAt"
        }
        if ([string]::IsNullOrWhiteSpace($timestampText)) {
            $timestampText = Get-ShipDeCheckField -Check $check -Field "createdAt"
        }
        $provider = Get-ShipDeCheckProvider -Check $check
        $key = "{0}`n{1}" -f $name, $provider
        $timestamp = [DateTime]::MinValue
        $parsedTimestamp = [DateTime]::MinValue
        if (
            -not [string]::IsNullOrWhiteSpace($timestampText) -and
            [DateTime]::TryParse($timestampText, [ref]$parsedTimestamp)
        ) {
            $timestamp = $parsedTimestamp.ToUniversalTime()
        }
        if ($latestByName.ContainsKey($key)) {
            if (
                $timestamp -eq [DateTime]::MinValue -or
                $latestByName[$key].Timestamp -eq [DateTime]::MinValue -or
                $timestamp -eq $latestByName[$key].Timestamp
            ) {
                throw "GitHub returned ambiguous attempts for check '$name' from provider '$provider'."
            }
            if ($timestamp -lt $latestByName[$key].Timestamp) {
                continue
            }
        }
        $latestByName[$key] = @{ Check = $check; Timestamp = $timestamp; Provider = $provider }
    }
    $checks = @($latestByName.Values | ForEach-Object { $_.Check })
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
            (Get-ShipDeCheckName -Check $_) -eq $requiredName -and
            (Get-ShipDeCheckProvider -Check $_).StartsWith(
                $script:RequiredPrCheckProviderPrefix,
                [System.StringComparison]::OrdinalIgnoreCase
            )
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

function ConvertFrom-ShipDeCodexReviewOutput {
    param(
        [Parameter(Mandatory = $true)][string]$OutputText
    )

    if ([string]::IsNullOrWhiteSpace($OutputText)) {
        throw "Codex review output is empty."
    }

    $jsonCandidate = $null
    try {
        $jsonCandidate = $OutputText.Trim() | ConvertFrom-Json
    } catch {}

    if (-not $jsonCandidate) {
        $jsonBlockMatch = [regex]::Match($OutputText, '(?s)```(?:json)?\s*(\{.*?\})\s*```')
        if ($jsonBlockMatch.Success) {
            try {
                $jsonCandidate = $jsonBlockMatch.Groups[1].Value.Trim() | ConvertFrom-Json
            } catch {}
        }
    }

    if (-not $jsonCandidate -or $jsonCandidate -isnot [PSCustomObject]) {
        throw "Codex review output does not contain valid structured JSON satisfying the review schema."
    }

    # Validate additionalProperties: false on the root object
    $allowedRootProperties = @("verdict", "summary", "findings", "report")
    $rootProperties = @($jsonCandidate.PSObject.Properties)
    $rootPropertyNames = @($rootProperties | ForEach-Object { $_.Name })
    foreach ($name in $rootPropertyNames) {
        if ($allowedRootProperties -notcontains $name) {
            throw "Codex review output contains unauthorized property '$name' violating additionalProperties: false."
        }
    }

    # Validate required properties
    foreach ($required in $allowedRootProperties) {
        if ($rootPropertyNames -notcontains $required) {
            throw "Codex review output is missing required property '$required'."
        }
    }

    # Validate verdict
    $verdictProp = $jsonCandidate.PSObject.Properties['verdict']
    if ($null -eq $verdictProp -or $null -eq $verdictProp.Value -or $verdictProp.Value -isnot [string]) {
        throw "Codex review verdict must be a non-null string."
    }
    $verdict = [string]$verdictProp.Value
    if ($verdict -notin @("PASS", "CHANGES_REQUIRED", "BLOCKED")) {
        throw "Codex review verdict '$verdict' does not belong to the declared enum ['PASS', 'CHANGES_REQUIRED', 'BLOCKED']."
    }

    # Validate summary
    $summaryProp = $jsonCandidate.PSObject.Properties['summary']
    if ($null -eq $summaryProp -or $null -eq $summaryProp.Value -or $summaryProp.Value -isnot [string]) {
        throw "Codex review summary must be a non-null string."
    }
    $summary = [string]$summaryProp.Value
    if ([string]::IsNullOrWhiteSpace($summary)) {
        throw "Codex review summary cannot be empty."
    }

    # Validate report
    $reportProp = $jsonCandidate.PSObject.Properties['report']
    if ($null -eq $reportProp -or $null -eq $reportProp.Value -or $reportProp.Value -isnot [string]) {
        throw "Codex review report must be a non-null string."
    }
    $report = [string]$reportProp.Value
    if ([string]::IsNullOrWhiteSpace($report)) {
        throw "Codex review report cannot be empty."
    }

    # Validate findings (array of objects)
    $findingsProp = $jsonCandidate.PSObject.Properties['findings']
    if ($null -eq $findingsProp -or $null -eq $findingsProp.Value) {
        throw "Codex review findings must be an array, not null."
    }
    if ($findingsProp.Value -isnot [System.Array] -and $findingsProp.Value -isnot [System.Collections.IList]) {
        throw "Codex review findings must be an array."
    }
    $findings = @($findingsProp.Value)

    $allowedFindingProperties = @("priority", "file", "line", "title", "description")
    foreach ($finding in $findings) {
        if ($null -eq $finding -or $finding -isnot [PSCustomObject]) {
            throw "Codex review finding must be an object."
        }
        $findingProperties = @($finding.PSObject.Properties)
        $findingPropertyNames = @($findingProperties | ForEach-Object { $_.Name })
        foreach ($fName in $findingPropertyNames) {
            if ($allowedFindingProperties -notcontains $fName) {
                throw "Codex review finding contains unauthorized property '$fName' violating additionalProperties: false."
            }
        }
        foreach ($reqFinding in $allowedFindingProperties) {
            if ($findingPropertyNames -notcontains $reqFinding) {
                throw "Codex review finding is missing required property '$reqFinding'."
            }
        }

        # Validate priority enum
        $priorityProp = $finding.PSObject.Properties['priority']
        if ($null -eq $priorityProp -or $null -eq $priorityProp.Value -or $priorityProp.Value -isnot [string]) {
            throw "Codex review finding priority must be a string."
        }
        $p = [string]$priorityProp.Value
        if ($p -notin @("P1", "P2", "P3")) {
            throw "Codex review finding priority '$p' must be P1, P2, or P3."
        }

        # Validate file
        $fileProp = $finding.PSObject.Properties['file']
        if ($null -eq $fileProp -or $null -eq $fileProp.Value -or $fileProp.Value -isnot [string] -or [string]::IsNullOrWhiteSpace([string]$fileProp.Value)) {
            throw "Codex review finding file must be a non-empty string."
        }

        # Validate line
        $lineProp = $finding.PSObject.Properties['line']
        if ($null -eq $lineProp -or $null -eq $lineProp.Value) {
            throw "Codex review finding line must be an integer."
        }
        $lineVal = $lineProp.Value
        $parsedLine = 0
        if ($lineVal -isnot [int] -and $lineVal -isnot [long] -and (-not [int]::TryParse([string]$lineVal, [ref]$parsedLine))) {
            throw "Codex review finding line must be an integer; got '$lineVal'."
        }

        # Validate title
        $titleProp = $finding.PSObject.Properties['title']
        if ($null -eq $titleProp -or $null -eq $titleProp.Value -or $titleProp.Value -isnot [string] -or [string]::IsNullOrWhiteSpace([string]$titleProp.Value)) {
            throw "Codex review finding title must be a non-empty string."
        }

        # Validate description
        $descProp = $finding.PSObject.Properties['description']
        if ($null -eq $descProp -or $null -eq $descProp.Value -or $descProp.Value -isnot [string] -or [string]::IsNullOrWhiteSpace([string]$descProp.Value)) {
            throw "Codex review finding description must be a non-empty string."
        }
    }

    if ($verdict -eq "PASS") {
        if ($findings.Count -gt 0) {
            throw "Codex review PASS verdict contradicts present findings ($($findings.Count) finding(s) reported)."
        }
    }

    if ($verdict -eq "CHANGES_REQUIRED") {
        if ($findings.Count -eq 0) {
            throw "Codex review CHANGES_REQUIRED verdict requires at least one finding."
        }
    }

    return [PSCustomObject]@{
        Verdict = $verdict
        Report = $report
        Summary = $summary
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
    $item = Get-ShipDePrWorkItem -PullRequest $pr
    if (-not $item) {
        throw "Cannot resolve governed Work Item assignment for PR #$($pr.number)."
    }
    Assert-ShipDeGovernedPullRequest -PullRequest $pr -WorkItemId $item.WorkItemId -Branch $item.Branch -ExpectedRepository $Repository

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
    $schemaFile = Join-Path $script:HandoffRoot "$reviewStem-schema.json"
    $diagnosticFile = Join-Path $script:HandoffRoot "$reviewStem-diagnostics.txt"
    $executionFile = Join-Path $script:HandoffRoot "$reviewStem-execution.txt"
    $schemaJson = '{"type":"object","properties":{"verdict":{"type":"string","enum":["PASS","CHANGES_REQUIRED","BLOCKED"]},"summary":{"type":"string"},"findings":{"type":"array","items":{"type":"object","properties":{"priority":{"type":"string","enum":["P1","P2","P3"]},"file":{"type":"string"},"line":{"type":"integer"},"title":{"type":"string"},"description":{"type":"string"}},"required":["priority","file","line","title","description"],"additionalProperties":false}},"report":{"type":"string"}},"required":["verdict","summary","findings","report"],"additionalProperties":false}'

    $reviewPrompt = @"
Perform an independent, read-only code review of Pull Request #$($pr.number) at the exact detached HEAD $reviewHeadSha.

Review only the changes introduced against the merge base with origin/main. Inspect the full diff with git diff origin/main...HEAD and inspect any surrounding code needed to validate correctness. Do not modify files.

Report every actionable correctness, security, governance, lifecycle, or test-coverage problem as a prioritized finding with an exact file and line reference.

Provide your review output strictly conforming to the declared JSON schema:
- verdict: exactly one of PASS, CHANGES_REQUIRED, BLOCKED. Use CHANGES_REQUIRED when at least one actionable finding remains. Use BLOCKED only when the review cannot be completed. Otherwise use PASS.
- summary: concise high-level summary.
- findings: array of structured findings with priority (P1, P2, P3), file, line, title, description (empty array if no actionable findings).
- report: full markdown review report.

IMPORTANT: You MUST respond ONLY with valid JSON satisfying the schema. Do not wrap in markdown fences or include surrounding prose.
"@

    # A stale file from a failed attempt must never satisfy the verdict parser.
    Remove-Item -Path $reviewFile -Force -ErrorAction SilentlyContinue
    Remove-Item -Path $schemaFile -Force -ErrorAction SilentlyContinue
    Remove-Item -Path $diagnosticFile -Force -ErrorAction SilentlyContinue
    Remove-Item -Path $executionFile -Force -ErrorAction SilentlyContinue
    [System.IO.File]::WriteAllText($schemaFile, $schemaJson, [System.Text.UTF8Encoding]::new($false))
    $previousErrorActionPreference = $ErrorActionPreference
    Push-Location $script:Paths.Codex
    try {
        # The non-interactive review subcommand accepts an explicit JSON schema
        # and writes the structured model message atomically.
        $ErrorActionPreference = "Continue"
        $reviewPrompt | & codex exec review --output-schema $schemaFile --output-last-message $reviewFile - 1> $executionFile 2> $diagnosticFile
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
        Pop-Location
    }

    if ($exitCode -ne 0) {
        throw "Codex review failed with exit code $exitCode. Diagnostics: $diagnosticFile"
    }
    if (-not (Test-Path -LiteralPath $reviewFile)) {
        throw "Codex returned no final review. Diagnostics: $diagnosticFile"
    }

    $rawReviewText = Get-Content -LiteralPath $reviewFile -Raw
    if ([string]::IsNullOrWhiteSpace($rawReviewText)) {
        throw "Codex returned an empty final review. Diagnostics: $diagnosticFile"
    }

    $parsedResult = ConvertFrom-ShipDeCodexReviewOutput -OutputText $rawReviewText
    $verdict = $parsedResult.Verdict
    $reviewText = $parsedResult.Report

    $currentPr = Get-ShipDePullRequestByNumber -Number ([int]$pr.number)
    Assert-ShipDeReviewTarget -PullRequest $currentPr -ExpectedHeadSha $reviewHeadSha

    $targetHeader = '**Review target:** `{0}`' -f $reviewHeadSha
    if ($reviewText -notmatch [regex]::Escape($reviewHeadSha)) {
        $reviewText = $targetHeader + [Environment]::NewLine + [Environment]::NewLine + $reviewText
    }
    if ($reviewText -notmatch "(?im)^Verdict:\s*$verdict") {
        $reviewText = $reviewText + [Environment]::NewLine + [Environment]::NewLine + "Verdict: $verdict"
    }
    $output = @($reviewText -split '\r?\n')
    $output | Set-Content -Path $reviewFile -Encoding UTF8
    $output | ForEach-Object { Write-Host $_ }

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
    Write-Host ("Execution log : {0}" -f $executionFile)
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

function Get-ShipDeAoVerdictFromReviewResponse {
    param(
        [Parameter(Mandatory = $true)][object]$Response,
        [Parameter(Mandatory = $true)][int]$PullRequestNumber,
        [Parameter(Mandatory = $true)][string]$HeadSha
    )

    $reviews = @(Get-ShipDeObjectProperty -Object $Response -Names @("reviews"))
    $matches = @($reviews | Where-Object {
        [int](Get-ShipDeObjectProperty -Object $_ -Names @("prNumber", "pr_number")) -eq $PullRequestNumber -and
        [string](Get-ShipDeObjectProperty -Object $_ -Names @("targetSha", "target_sha")) -ieq $HeadSha
    })
    if ($matches.Count -gt 1) {
        throw "AO returned multiple review records for PR #$PullRequestNumber at exact HEAD $HeadSha."
    }
    if ($matches.Count -eq 0) {
        return $null
    }

    $review = $matches[0]
    $reviewStatus = ([string](Get-ShipDeObjectProperty -Object $review -Names @("status", "state"))).ToLowerInvariant()
    switch ($reviewStatus) {
        "needs_review" { return $null }
        "ineligible" { throw "AO marked PR #$PullRequestNumber at exact HEAD $HeadSha ineligible for review." }
        "running" {}
        "up_to_date" {}
        "changes_requested" {}
        default { throw "AO returned unsupported review state '$reviewStatus' for exact HEAD $HeadSha." }
    }
    $run = Get-ShipDeObjectProperty -Object $review -Names @("latestRun", "latest_run")
    if ($null -eq $run) {
        throw "AO review state '$reviewStatus' has no latest run for exact HEAD $HeadSha."
    }
    $harness = [string](Get-ShipDeObjectProperty -Object $run -Names @("harness"))
    if ($harness -ne "codex") {
        throw "AO exact-HEAD review used unsupported reviewer '$harness'; Codex is required."
    }
    $status = ([string](Get-ShipDeObjectProperty -Object $run -Names @("status"))).ToLowerInvariant()
    $verdict = [string](Get-ShipDeObjectProperty -Object $run -Names @("verdict"))
    if ($status -in @("failed", "cancelled")) {
        throw "AO Codex review ended without an acceptable verdict. State: $status"
    }
    if ($status -eq "running") {
        if ($reviewStatus -ne "running") {
            throw "AO review state '$reviewStatus' conflicts with a running Codex run."
        }
        return $null
    }
    if ($status -notin @("complete", "completed", "delivered")) {
        throw "AO Codex review returned unsupported terminal state '$status'."
    }
    switch ($verdict.ToLowerInvariant()) {
        "approved" {
            if ($reviewStatus -ne "up_to_date") {
                throw "AO approved run conflicts with review state '$reviewStatus'."
            }
            return "PASS"
        }
        "changes_requested" {
            if ($reviewStatus -ne "changes_requested") {
                throw "AO changes-requested run conflicts with review state '$reviewStatus'."
            }
            return "CHANGES_REQUIRED"
        }
        "blocked" {
            return "BLOCKED"
        }
        default { throw "AO Codex review completed without a governed verdict." }
    }
}

function Get-ShipDeAoExactHeadCodexVerdict {
    param(
        [Parameter(Mandatory = $true)][string]$SessionId,
        [Parameter(Mandatory = $true)][int]$PullRequestNumber,
        [Parameter(Mandatory = $true)][string]$HeadSha
    )

$output = @(& (Get-ShipDeAoInvocationPath) review ls $SessionId --json 2>&1)
    $exitCode = $LASTEXITCODE
    $text = Join-ShipDeNativeOutput -Output $output
    if ($exitCode -ne 0) {
        throw "Cannot read AO review records for session '$SessionId': $text"
    }
    $response = ConvertFrom-ShipDeAoJson -Json $text -Operation "review ls"
    return Get-ShipDeAoVerdictFromReviewResponse -Response $response -PullRequestNumber $PullRequestNumber -HeadSha $HeadSha
}

function Get-ShipDeGitHubExactHeadCodexVerdict {
    param(
        [Parameter(Mandatory = $true)][int]$PullRequestNumber,
        [Parameter(Mandatory = $true)][string]$HeadSha
    )

    if ($Repository -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$') {
        throw "Repository must use the owner/name form before reading GitHub reviews."
    }

    $candidates = [System.Collections.Generic.List[object]]::new()

    # 1. Enumerate GitHub Reviews
    $raw = @(& gh api "repos/$Repository/pulls/$PullRequestNumber/reviews" --paginate --slurp 2>$null)
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to query GitHub Pull Request reviews for PR #$PullRequestNumber."
    }
    if ($raw.Count -gt 0) {
        try {
            $pages = (($raw -join [Environment]::NewLine) | ConvertFrom-Json)
        } catch {
            throw "Failed to parse GitHub Pull Request review response for PR #$($PullRequestNumber): $($_.Exception.Message)"
        }
        foreach ($page in @($pages)) {
            foreach ($review in @($page)) {
                if ([string]$review.commit_id -ine $HeadSha) { continue }
                $login = [string]$review.user.login
                if ($script:TrustedCodexReviewerLogins -notcontains $login) { continue }
                $submittedAtStr = [string](Get-ShipDeObjectProperty -Object $review -Names @("submitted_at", "submittedAt"))
                $submittedAt = [DateTime]::MinValue
                if (-not [string]::IsNullOrWhiteSpace($submittedAtStr)) {
                    [void][DateTime]::TryParse($submittedAtStr, [ref]$submittedAt)
                }
                $revVerdict = $null
                switch (([string]$review.state).ToUpperInvariant()) {
                    "APPROVED" { $revVerdict = "PASS" }
                    "CHANGES_REQUESTED" { $revVerdict = "CHANGES_REQUIRED" }
                    "COMMENTED" {
                        $reviewBody = [string]$review.body
                        if (-not [string]::IsNullOrWhiteSpace($reviewBody)) {
                            $lines = @($reviewBody -split '\r?\n' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
                            if ($lines.Count -gt 0) {
                                $lastLine = $lines[-1].Trim()
                                if ($lastLine -match '(?i)^(?:(?:\*\*)?(?:(?:FINAL[\t ]+)?VERDICT[\t ]*:[\t ]*)?(PASS|CHANGES_REQUIRED|BLOCKED)(?:\*\*)?)$') {
                                    $revVerdict = $matches[1].ToUpperInvariant()
                                }
                            }
                        }
                    }
                    default {
                        # Explicitly ignore DISMISSED, PENDING, and any non-governed/non-terminal state.
                    }
                }
                if ($revVerdict) {
                    $candidates.Add([PSCustomObject]@{
                        Id = [string]$review.id
                        CreatedAt = $submittedAt.ToUniversalTime()
                        Verdict = $revVerdict
                    })
                }
            }
        }
    }

    # 2. Enumerate GitHub PR comments
    $rawComments = @(& gh pr view $PullRequestNumber --repo $Repository --json comments 2>$null)
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to query GitHub Pull Request comments for PR #$PullRequestNumber."
    }
    if ($rawComments.Count -gt 0) {
        try {
            $parsed = ($rawComments -join [Environment]::NewLine) | ConvertFrom-Json
        } catch {
            throw "Failed to parse GitHub Pull Request comments response for PR #$($PullRequestNumber): $($_.Exception.Message)"
        }
        if ($parsed -and $parsed.comments) {
            foreach ($commentObj in @($parsed.comments)) {
                $author = Get-ShipDeObjectProperty -Object $commentObj -Names @("author", "user")
                $authorLogin = [string](Get-ShipDeObjectProperty -Object $author -Names @("login"))
                if ($script:TrustedCodexReviewerLogins -notcontains $authorLogin) { continue }
                $body = [string]$commentObj.body
                if ([string]::IsNullOrWhiteSpace($body)) { continue }
                $targetMatch = [regex]::Match($body, '(?im)(?:\*\*)?(?:Review target|Reviewed exact head|Reviewed immutable head|Reviewed commit)\s*:\s*(?:\*\*)?\s*`?([a-f0-9]{7,40})`?')
                if (-not $targetMatch.Success) {
                    $targetMatch = [regex]::Match($body, '(?im)immutable head\s+`?([a-f0-9]{7,40})`?')
                }
                if (-not $targetMatch.Success) {
                    $targetMatch = [regex]::Match($body, '(?im)Reviewed PR #\d+ at\s+`?([a-f0-9]{7,40})`?')
                }

                if ($targetMatch.Success) {
                    $targetSha = $targetMatch.Groups[1].Value
                    $shaMatches = $false
                    if ($targetSha.Length -eq 40) {
                        $shaMatches = ($targetSha -ieq $HeadSha)
                    } elseif ($targetSha.Length -ge 7 -and $HeadSha.StartsWith($targetSha, [System.StringComparison]::OrdinalIgnoreCase)) {
                        try {
                            $resolvedSha = (& git rev-parse --verify "$targetSha^{commit}" 2>$null).Trim()
                            if ($LASTEXITCODE -eq 0 -and $resolvedSha -ieq $HeadSha) {
                                $shaMatches = $true
                            }
                        } catch {}
                    }

                    if ($shaMatches) {
                        $lines = @($body -split '\r?\n' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
                        if ($lines.Count -gt 0) {
                            $lastLine = $lines[-1].Trim()
                            if ($lastLine -match '(?i)^(?:(?:\*\*)?(?:(?:FINAL[\t ]+)?VERDICT[\t ]*:[\t ]*)?(PASS|CHANGES_REQUIRED|BLOCKED)(?:\*\*)?)$') {
                                $cVerdict = $matches[1].ToUpperInvariant()
                                $createdAtStr = [string](Get-ShipDeObjectProperty -Object $commentObj -Names @("createdAt", "created_at"))
                                $createdTime = [DateTime]::MinValue
                                if (-not [string]::IsNullOrWhiteSpace($createdAtStr)) {
                                    [void][DateTime]::TryParse($createdAtStr, [ref]$createdTime)
                                }
                                $cId = [string](Get-ShipDeObjectProperty -Object $commentObj -Names @("id", "databaseId"))
                                $candidates.Add([PSCustomObject]@{
                                    Id = $cId
                                    CreatedAt = $createdTime.ToUniversalTime()
                                    Verdict = $cVerdict
                                })
                            }
                        }
                    }
                }
            }
        }
    }

    if ($candidates.Count -gt 0) {
        $sortedCandidates = @($candidates | Sort-Object -Property @{ Expression = { $_.CreatedAt }; Descending = $true }, @{ Expression = { $_.Id }; Descending = $true })
        $newest = $sortedCandidates[0]
        $equalTimeCandidates = @($sortedCandidates | Where-Object { $_.CreatedAt -eq $newest.CreatedAt })
        $conflicting = @($equalTimeCandidates | Where-Object { $_.Verdict -ne $newest.Verdict })
        if ($conflicting.Count -gt 0) {
            throw "Conflicting Codex review verdicts with identical timestamp for exact HEAD $HeadSha."
        }
        return [string]$newest.Verdict
    }

    return $null
}

function Get-ShipDeExactHeadCodexVerdict {
    param(
        [Parameter(Mandatory = $true)][int]$PullRequestNumber,
        [Parameter(Mandatory = $true)][string]$HeadSha,
        [string]$MergeCommitOid,
        [string]$SessionId
    )

    if ([string]::IsNullOrWhiteSpace($HeadSha)) {
        return $null
    }

    # AO-triggered Codex reviews are recorded in AO's review contract rather
    # than in the manual handoff files used by Invoke-ShipDeReview.
    if (-not [string]::IsNullOrWhiteSpace($SessionId)) {
        $aoVerdict = Get-ShipDeAoExactHeadCodexVerdict -SessionId $SessionId -PullRequestNumber $PullRequestNumber -HeadSha $HeadSha
        if ($aoVerdict) {
            return $aoVerdict
        }
    }

    # Recover exact-commit verdict from GitHub durable review and comment records
    # using newest trusted evidence, rejecting equal-time conflicts.
    $githubVerdict = Get-ShipDeGitHubExactHeadCodexVerdict -PullRequestNumber $PullRequestNumber -HeadSha $HeadSha
    if ($githubVerdict) {
        return $githubVerdict
    }

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
$script:ExpectedAoVersion = Get-ShipDePinnedAoVersion
$script:AoExecutablePath = $null

function Assert-ShipDeAoCommand {
    $script:AoExecutablePath = Resolve-ShipDeAoExecutable
    return $script:AoExecutablePath
}

function Get-ShipDeAoInvocationPath {
    if ([string]::IsNullOrWhiteSpace([string]$script:AoExecutablePath)) {
        $script:AoExecutablePath = Assert-ShipDeAoCommand
    }
    return $script:AoExecutablePath
}

function Assert-ShipDeAoVersion {
    $aoExecutable = Get-ShipDeAoInvocationPath
    $probe = Get-ShipDeAoVersionProbe -AoExecutable $aoExecutable
    return (Assert-ShipDeAoVersionEvidence `
        -AoExecutable $aoExecutable `
        -ExpectedVersion $script:ExpectedAoVersion `
        -VersionText $probe.Text `
        -VersionExitCode $probe.ExitCode)
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
$output = @(& (Get-ShipDeAoInvocationPath) status --json 2>&1)
        $exitCode = $LASTEXITCODE
        $text = Join-ShipDeNativeOutput -Output $output
        if ($exitCode -ne 0) {
            return @{ Ready = $false; Reason = ("ao status failed with exit code {0}: {1}" -f $exitCode, $text) }
        }
        $status = ConvertFrom-ShipDeAoJson -Json $text -Operation "status"
        $state = [string](Get-ShipDeObjectProperty -Object $status -Names @("state"))
        if ($state -ne "ready") {
            return @{
                Ready = $false
                Reason = "AO status state is '$state', not 'ready'."
                Status = $status
            }
        }
        return @{ Ready = $true; Status = $status }
    } catch {
        return @{ Ready = $false; Reason = $_.Exception.Message }
    }
}

function Test-ShipDeAgentRouterEndpoint {
    param([Parameter(Mandatory = $true)][int]$Port)

    if (-not (Test-ShipDeTcpPort -HostName "127.0.0.1" -Port $Port)) {
        return $false
    }
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -Method Get -TimeoutSec 5
        $version = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/version" -Method Get -TimeoutSec 6
        return (
            $health.ok -eq $true -and
            [string]$version.currentVersion -eq $script:NineRouterPinnedVersion
        )
    } catch {
        return $false
    }
}

function Assert-ShipDeAoRuntimeMarker {
    param(
        [Parameter(Mandatory = $true)][object]$Runtime,
        [Parameter(Mandatory = $true)][string]$ExpectedProfile,
        [Parameter(Mandatory = $true)][string]$ExpectedBaseUrl,
        [Parameter(Mandatory = $true)][string]$ExpectedVersion,
        [Parameter(Mandatory = $true)][string]$ExpectedExecutable,
        [scriptblock]$ProcessResolver = { param($id) Get-Process -Id $id -ErrorAction SilentlyContinue }
    )

    if ([int]$Runtime.marker_version -ne 2) {
        throw "AO router runtime marker is stale. Restart AO through the governed launcher."
    }
    if ([string]$Runtime.profile -ne $ExpectedProfile -or [string]$Runtime.base_url -ne $ExpectedBaseUrl) {
        throw "AO was not launched with the current AgentRouter Claude profile."
    }
    if ([string]$Runtime.ao_version -ne $ExpectedVersion) {
        throw "AO CLI runtime marker version does not match pinned version $ExpectedVersion."
    }
    $versionSource = [string]$Runtime.ao_version_source
    if ($versionSource -notin @("semantic-build-metadata", "windows-product-version")) {
        throw "AO runtime marker has an unsupported version evidence source."
    }
    if ($versionSource -eq "windows-product-version" -and [string]$Runtime.ao_binary_version -ne $ExpectedVersion) {
        throw "AO binary runtime marker version does not match pinned version $ExpectedVersion."
    }

    $clearedOverrides = @($Runtime.credential_overrides_cleared)
    foreach ($requiredOverride in @("ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY")) {
        if ($clearedOverrides -notcontains $requiredOverride) {
            throw "AO runtime marker does not prove that $requiredOverride was cleared before launch."
        }
    }

    $processId = 0
    if (-not [int]::TryParse([string]$Runtime.process_id, [ref]$processId) -or $processId -le 0) {
        throw "AO router runtime marker does not contain a valid process ID."
    }
    if ([string]::IsNullOrWhiteSpace([string]$Runtime.ao_executable) -or
        -not [StringComparer]::OrdinalIgnoreCase.Equals([string]$Runtime.ao_executable, $ExpectedExecutable) -or
        [string]::IsNullOrWhiteSpace([string]$Runtime.process_path) -or
        -not [StringComparer]::OrdinalIgnoreCase.Equals([string]$Runtime.process_path, [string]$Runtime.ao_executable) -or
        [string]::IsNullOrWhiteSpace([string]$Runtime.process_name) -or
        [string]::IsNullOrWhiteSpace([string]$Runtime.process_start_time)) {
        throw "AO router runtime marker identity cannot be verified. Restart AO through the governed launcher."
    }

    $markerTimeStyles = [Globalization.DateTimeStyles]::AssumeUniversal -bor [Globalization.DateTimeStyles]::AdjustToUniversal
    $markerStartTime = [DateTime]::MinValue
    $markerStartTimeValid = $true
    try {
        $markerStartTime = [DateTime]::Parse([string]$Runtime.process_start_time, [Globalization.CultureInfo]::InvariantCulture, $markerTimeStyles)
    } catch {
        $markerStartTimeValid = $false
    }
    if (-not $markerStartTimeValid) {
        throw "AO router runtime marker identity cannot be verified. Restart AO through the governed launcher."
    }
    $markerWrittenAt = [DateTime]::MinValue
    $markerWrittenAtValid = $true
    try {
        $markerWrittenAt = [DateTime]::Parse([string]$Runtime.started_at, [Globalization.CultureInfo]::InvariantCulture, $markerTimeStyles)
    } catch {
        $markerWrittenAtValid = $false
    }
    if (-not $markerWrittenAtValid -or
        $markerWrittenAt.ToUniversalTime() -lt $markerStartTime.ToUniversalTime()) {
        throw "AO router runtime marker is stale. Restart AO through the governed launcher."
    }

    $aoProcess = & $ProcessResolver $processId
    $identity = Get-ShipDeProcessIdentity -Process $aoProcess
    if ($null -eq $identity) {
        throw "AO router runtime marker identity cannot be verified. Restart AO through the governed launcher."
    }
    if (
        $identity.Id -ne $processId -or
        [string]$identity.Name -cne [string]$Runtime.process_name -or
        -not [StringComparer]::OrdinalIgnoreCase.Equals([string]$identity.Path, [string]$Runtime.process_path) -or
        [DateTime]::Parse([string]$identity.StartTimeUtc, [Globalization.CultureInfo]::InvariantCulture, $markerTimeStyles).Ticks -ne $markerStartTime.ToUniversalTime().Ticks
    ) {
        throw "AO router runtime marker identity cannot be verified. Restart AO through the governed launcher."
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
    if (-not (Test-ShipDeAgentRouterEndpoint -Port $script:AgentRouterPort)) {
        throw "Port $($script:AgentRouterPort) is not serving the expected local 9Router health and version contract."
    }
    if (-not (Test-Path $script:AoRouterRuntimeFile)) {
        throw "AO router runtime marker is missing. Start AO with scripts/ai/start-agent-orchestrator.ps1."
    }
    try {
        $runtime = Get-Content $script:AoRouterRuntimeFile -Raw -Encoding UTF8 | ConvertFrom-Json
    } catch {
        throw "AO router runtime marker is malformed. Restart AO through the governed launcher."
    }
    Assert-ShipDeAoRuntimeMarker `
        -Runtime $runtime `
        -ExpectedProfile $script:AgentRouterProfile `
        -ExpectedBaseUrl $baseUrl `
        -ExpectedVersion $script:ExpectedAoVersion `
        -ExpectedExecutable (Get-ShipDeAoInvocationPath)
}

function Ensure-ShipDeAgentRouterRuntime {
    param(
        [scriptblock]$ProfileValidator = { Assert-ShipDeAgentRouterProfile },
        [scriptblock]$ReadinessResolver = { Test-ShipDeAoReadiness },
        [scriptblock]$Launcher = {
            param($Path, $Root, $Port, $Version)
            & $Path -AiRoot $Root -AgentRouterPort $Port -ExpectedAoVersion $Version -Restart
        }
    )

    try {
        & $ProfileValidator
        $readiness = & $ReadinessResolver
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
        & $Launcher $launcherPath $AiRoot $script:AgentRouterPort $script:ExpectedAoVersion
    } catch {
        throw "The governed AO launcher failed: $($_.Exception.Message)"
    }

    & $ProfileValidator
    $readiness = & $ReadinessResolver
    if (-not $readiness.Ready) {
        throw "AO is not ready after governed restart: $($readiness.Reason)"
    }
}

function Get-ShipDeAoSessionById {
    param(
        [Parameter(Mandatory = $true)][string]$SessionId,
        [string]$Project = "shipde-platform"
    )

$output = @(& (Get-ShipDeAoInvocationPath) session get $SessionId --project $Project --json 2>&1)
    $exitCode = $LASTEXITCODE
    $text = Join-ShipDeNativeOutput -Output $output
    if ($exitCode -ne 0) {
        return $null
    }
    $response = ConvertFrom-ShipDeAoJson -Json $text -Operation "session get"
    return Get-ShipDeAoSessionPayload -Response $response
}

function Get-ShipDeNextPreparedItem {
    param([object[]]$Items = $null)

    if ($null -eq $Items) {
        $Items = @(Get-ShipDePreparedItems)
    }
    if ($Items.Count -eq 0) {
        return $null
    }
    return $Items[0]
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
        "GEMINI" { return @("agy") }
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

$output = @(& (Get-ShipDeAoInvocationPath) session ls --project $Project --json 2>&1)
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

function Assert-ShipDeReusedAoSession {
    param(
        [Parameter(Mandatory = $true)][object]$SessionDetail,
        [Parameter(Mandatory = $true)][object]$Item,
        [Parameter(Mandatory = $true)][string[]]$AllowedHarnesses,
        [string]$Project = "shipde-platform"
    )

    if ($null -eq $SessionDetail) {
        throw "Cannot validate reused AO session: session details could not be retrieved. Failing closed."
    }

    $kind = [string](Get-ShipDeObjectProperty -Object $SessionDetail -Names @("kind", "role", "type", "workerKind", "worker_kind"))
    if ($kind -ne "worker") {
        throw "Reused AO session kind '$kind' is invalid; expected 'worker'. Failing closed."
    }

    $harness = [string](Get-ShipDeObjectProperty -Object $SessionDetail -Names @("harness"))
    if (-not ($AllowedHarnesses -contains $harness)) {
        throw "Reused AO session harness '$harness' does not match allowed harnesses ($($AllowedHarnesses -join ', ')). Failing closed."
    }

    $branch = [string](Get-ShipDeObjectProperty -Object $SessionDetail -Names @("branch", "headBranch", "head_branch"))
    $worktree = [string](Get-ShipDeObjectProperty -Object $SessionDetail -Names @("worktree", "worktreePath", "worktree_path", "workingDir", "working_directory", "path"))
    $sessionId = [string](Get-ShipDeObjectProperty -Object $SessionDetail -Names @("id", "sessionId", "session_id"))

    if ([string]::IsNullOrWhiteSpace($worktree) -and -not [string]::IsNullOrWhiteSpace($sessionId)) {
        $canonicalWorktree = Join-Path (Join-Path (Join-Path $env:USERPROFILE ".ao\data\worktrees") $Project) $sessionId
        if (Test-Path -LiteralPath $canonicalWorktree) {
            $worktree = (Get-Item -LiteralPath $canonicalWorktree).FullName
        }
    }

    if ([string]::IsNullOrWhiteSpace($worktree)) {
        throw "Reused AO session does not have an active worktree path. Failing closed."
    }

    if ([string]::IsNullOrWhiteSpace($branch) -and (Test-Path -LiteralPath (Join-Path $worktree ".git"))) {
        try {
            $branch = (& git -C $worktree rev-parse --abbrev-ref HEAD 2>$null).Trim()
        } catch {}
    }

    if ($branch -cne $Item.Branch) {
        throw "Reused AO session branch '$branch' does not match expected branch '$($Item.Branch)'. Failing closed."
    }

    return $harness
}

function Start-ShipDeAoWorker {
    param(
        [Parameter(Mandatory = $true)][object]$Item,
        [Parameter(Mandatory = $true)][string]$Prompt,
        [string]$Project = "shipde-platform",
        [switch]$DryRun
    )

    if ($DryRun) {
        $candidate = @(Get-ShipDeAoHarnessCandidates -Author $Item.Author)[0]
        $arguments = New-ShipDeAoSpawnArguments -Item $Item -Harness $candidate -Prompt $Prompt -Project $Project
        Write-Host ("[SUPERVISOR][DRY-RUN] ao {0}" -f ($arguments -join " "))
        return [PSCustomObject]@{ SessionId = "dry-run-$($Item.WorkItemId.ToLowerInvariant())"; Harness = $candidate }
    }

    $expectedName = Get-ShipDeAoWorkerName -Item $Item
    $existingSessions = @(
        Get-ShipDeAoSessions -Project $Project | Where-Object {
            $session = $_
            $isTerm = [bool](Get-ShipDeObjectProperty -Object $session -Names @("isTerminated", "is_terminated"))
            if ($isTerm) { return $false }
            $role = [string](Get-ShipDeObjectProperty -Object $session -Names @("role", "kind"))
            if ($role -notin @("worker", "")) { return $false }

            $sessionName = Get-ShipDeAoSessionName -Session $session
            if ($sessionName -eq $expectedName) { return $true }

            $sid = Get-ShipDeAoSessionId -Response $session
            if (-not [string]::IsNullOrWhiteSpace($sid)) {
                $candidateWorktree = Join-Path (Join-Path (Join-Path $env:USERPROFILE ".ao\data\worktrees") $Project) $sid
                if (Test-Path -LiteralPath (Join-Path $candidateWorktree ".git")) {
                    $worktreeBranch = (& git -C $candidateWorktree rev-parse --abbrev-ref HEAD 2>$null).Trim()
                    if ($worktreeBranch -ceq $Item.Branch) {
                        return $true
                    }
                }
            }
            return $false
        }
    )
    if ($existingSessions.Count -eq 1) {
        $sessionId = Get-ShipDeAoSessionId -Response $existingSessions[0]
        $sessionDetail = Get-ShipDeAoSessionById -SessionId $sessionId -Project $Project
        $candidates = @(Get-ShipDeAoHarnessCandidates -Author $Item.Author)
        $verifiedHarness = Assert-ShipDeReusedAoSession -SessionDetail $sessionDetail -Item $Item -AllowedHarnesses $candidates -Project $Project
        Write-Host "[SUPERVISOR] Verified and bound existing governed AO session '$sessionId' (harness: $verifiedHarness) for worker '$expectedName'."
        return [PSCustomObject]@{
            SessionId = $sessionId
            Harness = $verifiedHarness
        }
    } elseif ($existingSessions.Count -gt 1) {
        throw "Multiple existing AO sessions found for worker '$expectedName'. Cannot safely bind to an ambiguous worker."
    }

    $failures = [System.Collections.Generic.List[string]]::new()
    foreach ($harness in @(Get-ShipDeAoHarnessCandidates -Author $Item.Author)) {
        $arguments = New-ShipDeAoSpawnArguments -Item $Item -Harness $harness -Prompt $Prompt -Project $Project

        $beforeIds = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
        foreach ($session in @(Get-ShipDeAoSessions -Project $Project)) {
            try {
                $null = $beforeIds.Add((Get-ShipDeAoSessionId -Response $session))
            } catch {}
        }

        $output = @(& (Get-ShipDeAoInvocationPath) @arguments 2>&1)
        $exitCode = $LASTEXITCODE
        $text = Join-ShipDeNativeOutput -Output $output
        if ($exitCode -eq 0) {
            for ($attempt = 0; $attempt -lt 10; $attempt++) {
                $newSessions = @(
                    Get-ShipDeAoSessions -Project $Project | Where-Object {
                        $sessionId = Get-ShipDeAoSessionId -Response $_
                        -not $beforeIds.Contains($sessionId)
                    }
                )
                if ($newSessions.Count -gt 1) {
                    throw "AO created or exposed multiple new sessions after spawn; refusing an ambiguous worker binding."
                }
                if ($newSessions.Count -eq 1) {
                    $sessionId = Get-ShipDeAoSessionId -Response $newSessions[0]
                    $spawnedSession = Get-ShipDeAoSessionById -SessionId $sessionId -Project $Project
                    $expectedName = Get-ShipDeAoWorkerName -Item $Item
                    $actualName = Get-ShipDeAoSessionName -Session $spawnedSession
                    if ($actualName -ne $expectedName) {
                        throw "The unique new AO session '$sessionId' is named '$actualName', not governed worker '$expectedName'."
                    }
                    return [PSCustomObject]@{
                        SessionId = $sessionId
                        Harness = $harness
                    }
                }
                Start-Sleep -Milliseconds 500
            }
            throw "AO spawn succeeded but one unique new session could not be identified through before/after session snapshots. Output: $text"
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

    $output = @(& (Get-ShipDeAoInvocationPath) send --session $SessionId --message $Message 2>&1)
    if ($LASTEXITCODE -ne 0) {
        Write-Warning ("AO message failed for {0}: {1}" -f $SessionId, (Join-ShipDeNativeOutput -Output $output))
        return $false
    }
    return $true
}

function Start-ShipDeAoReview {
    param([Parameter(Mandatory = $true)][string]$SessionId)

    $output = @(& (Get-ShipDeAoInvocationPath) review trigger $SessionId 2>&1)
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
        "waiting_input" { return "WAITING_INPUT" }
        "waiting_for_input" { return "WAITING_INPUT" }
        "input_needed" { return "WAITING_INPUT" }
        "blocked" { return "BLOCKED" }
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

function Get-ShipDeAgentRouterFailureSince {
    param([Parameter(Mandatory = $true)][string]$Since)

    $sinceDate = [DateTime]::MinValue
    if (-not [DateTime]::TryParse($Since, [ref]$sinceDate)) {
        throw "Supervisor start time is invalid; cannot bound 9Router diagnostics."
    }
    $encodedStart = [Uri]::EscapeDataString($sinceDate.ToUniversalTime().ToString("o"))
    $uri = "http://127.0.0.1:$($script:AgentRouterPort)/api/usage/request-details?status=error&startDate=$encodedStart&page=1&pageSize=100"
    try {
        $response = Invoke-RestMethod -Uri $uri -Method Get -TimeoutSec 10
    } catch {
        throw "Cannot read bounded 9Router failure diagnostics: $($_.Exception.Message)"
    }

    $details = @(Get-ShipDeObjectProperty -Object $response -Names @("details", "items"))
    if ($details.Count -eq 0) {
        return $null
    }
    $datedDetails = @($details | ForEach-Object {
        $timestampText = [string](Get-ShipDeObjectProperty -Object $_ -Names @("timestamp", "createdAt", "created_at"))
        $timestamp = [DateTime]::MinValue
        $parsed = [DateTime]::MinValue
        if ([DateTime]::TryParse($timestampText, [ref]$parsed)) {
            $timestamp = $parsed.ToUniversalTime()
        }
        [PSCustomObject]@{ Detail = $_; Timestamp = $timestamp }
    })
    $latest = @($datedDetails | Sort-Object Timestamp -Descending | Select-Object -First 1)
    if ($latest.Count -eq 0) {
        return $null
    }
    return [PSCustomObject]@{
        Timestamp = [string](Get-ShipDeObjectProperty -Object $latest[0].Detail -Names @("timestamp", "createdAt", "created_at"))
        Provider = [string](Get-ShipDeObjectProperty -Object $latest[0].Detail -Names @("provider"))
        Model = [string](Get-ShipDeObjectProperty -Object $latest[0].Detail -Names @("model"))
        Status = [string](Get-ShipDeObjectProperty -Object $latest[0].Detail -Names @("status"))
    }
}

function Assert-ShipDeSupervisorMaxNudges {
    param([int]$MaxNudges)

    if ($MaxNudges -ne 1) {
        throw "SupervisorMaxNudges must be exactly 1 in accordance with AI-SUP-09; received $MaxNudges."
    }
}

function Assert-ShipDeGovernedPullRequest {
    param(
        [Parameter(Mandatory = $true)][object]$PullRequest,
        [Parameter(Mandatory = $true)][string]$WorkItemId,
        [Parameter(Mandatory = $true)][string]$Branch,
        [string]$ExpectedRepository = $Repository
    )

    $isCross = $false
    if ($PullRequest.PSObject.Properties['isCrossRepository'] -and $null -ne $PullRequest.isCrossRepository) {
        $isCross = [bool]$PullRequest.isCrossRepository
    }
    if ($isCross) {
        throw "Open PR for $WorkItemId originates from a cross-repository fork, which is not governed."
    }

    if ([string]::IsNullOrWhiteSpace($ExpectedRepository)) {
        throw "ExpectedRepository must not be null or empty when validating governed Pull Request."
    }

    $headRepo = if ($PullRequest.PSObject.Properties['headRepository'] -and $PullRequest.headRepository) {
        [string]$PullRequest.headRepository
    } else {
        ""
    }
    $headRepo = $headRepo.Trim()

    if ([string]::IsNullOrWhiteSpace($headRepo)) {
        throw "Open PR for $WorkItemId has an unverifiable head repository (null or empty); expected governed repository '$ExpectedRepository'."
    }

    if ($headRepo -ne $ExpectedRepository) {
        throw "Open PR for $WorkItemId originates from head repository '$headRepo', expected governed repository '$ExpectedRepository'."
    }

    if ([string]$PullRequest.headRefName -cne $Branch) {
        throw "Open PR for $WorkItemId does not use exact governed branch '$Branch'."
    }
}

function Get-ShipDeOpenPullRequestForWorkItem {
    param(
        [Parameter(Mandatory = $true)][string]$WorkItemId,
        [Parameter(Mandatory = $true)][string]$Branch
    )

    $workItemMatches = @(Get-ShipDeOpenPullRequests | Where-Object {
        (Get-ShipDeWorkItemIdFromTitle -Title ([string]$_.title)) -eq $WorkItemId
    })
    if ($workItemMatches.Count -eq 0) {
        return $null
    }
    if ($workItemMatches.Count -ne 1) {
        throw "Expected exactly one open PR for $WorkItemId; found $($workItemMatches.Count)."
    }
    $pr = $workItemMatches[0]
    Assert-ShipDeGovernedPullRequest -PullRequest $pr -WorkItemId $WorkItemId -Branch $Branch -ExpectedRepository $Repository
    return $pr
}

function Invoke-ShipDeSupervisorLoop {
    param(
        [Parameter(Mandatory = $true)][hashtable]$State,
        [string]$Project = "shipde-platform",
        [int]$PollIntervalSeconds = 30,
        [int]$InactivityTimeoutMinutes = 10,
        [int]$MaxNudges = 1,
        [int]$ReviewTimeoutMinutes = 20
    )

    Assert-ShipDeSupervisorMaxNudges -MaxNudges $MaxNudges

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
        $pullRequest = Get-ShipDeOpenPullRequestForWorkItem -WorkItemId ([string]$State.WorkItemId) -Branch ([string]$State.Branch)

        $previousActivity = [string]$State.State
        $State.State = $activity
        $State.ProviderFailure = $false
        if ($previousActivity -ne $activity) {
            Write-Host ("[SUPERVISOR] {0} session {1}: {2} -> {3}" -f (Get-Date).ToUniversalTime().ToString("o"), $State.SessionId, $previousActivity, $activity)
        }
        Write-ShipDeSupervisorCheckpoint -State $State

        if ($activity -in @("FAILED", "STOPPED", "MISSING")) {
            if ($activity -in @("FAILED", "STOPPED")) {
                $routerFailure = Get-ShipDeAgentRouterFailureSince -Since ([string]$State.StartTime)
                if ($routerFailure) {
                    $State.RouterFailure = $routerFailure
                    Write-ShipDeSupervisorCheckpoint -State $State
                    throw "AO worker ended in state $activity. 9Router recorded a failed request for $($routerFailure.Provider)/$($routerFailure.Model), but that diagnostic alone does not prove complete fallback exhaustion."
                }
            }
            throw "AO worker ended before the governed lifecycle completed. State: $activity"
        }
        if ($activity -eq "BLOCKED") {
            throw "AO worker is blocked on a permission or approval decision. Human input is required; the supervisor will not inject a response."
        }
        if ($activity -eq "UNKNOWN") {
            $State.UnknownPollCount = [int]$State.UnknownPollCount + 1
            if ([int]$State.UnknownPollCount -ge 3) {
                throw "AO returned an unknown session state for 3 consecutive polls."
            }
        } else {
            $State.UnknownPollCount = 0
        }

        $workerActionExpected = $false
        if ($pullRequest) {
            $headSha = [string]$pullRequest.headRefOid
            if ([string]$State.HeadSha -ne $headSha) {
                $State.ExactHeadVerdict = $null
            }
            $State.PullRequestNumber = [int]$pullRequest.number
            $State.HeadSha = $headSha
            $gate = Get-ShipDePrGate -PullRequest $pullRequest
            $State.CiGate = $gate

            if ($pullRequest.isDraft) {
                $workerActionExpected = $true
                if ($gate -eq "GREEN") {
                    $State.CiGate = "GREEN_DRAFT"
                }
                if ($activity -eq "COMPLETED") {
                    throw "AO worker completed while PR #$($pullRequest.number) is still draft. Mark the same PR ready before review."
                }
            } elseif ($gate -eq "FAILED") {
                $workerActionExpected = $true
                if ([string]$State.LastCiRepairHead -ne $headSha) {
                    $State.LastCiRepairHead = $headSha
                    $State.LastRepairDispatchedAt = (Get-Date).ToUniversalTime().ToString("o")
                    $State.LastActivityTime = (Get-Date).ToUniversalTime().ToString("o")
                    $State.NudgeCount = 0
                    Write-ShipDeSupervisorCheckpoint -State $State

                    $message = "CI failed for PR #$($pullRequest.number) at exact HEAD $headSha. Inspect the failing checks, repair this same Work Item, run governed verification, commit, and push. Do not merge."
                    if (-not (Send-ShipDeAoMessage -SessionId ([string]$State.SessionId) -Message $message)) {
                        throw "Cannot route CI failure back to the implementation worker."
                    }
                }
            } elseif ($gate -eq "GREEN") {
                $verdict = Get-ShipDeExactHeadCodexVerdict -PullRequestNumber ([int]$pullRequest.number) -HeadSha $headSha -SessionId ([string]$State.SessionId)
                $State.ExactHeadVerdict = $verdict

                if ($verdict -eq "PASS") {
                    Write-ShipDeSupervisorCheckpoint -State $State
                    return "READY_FOR_HUMAN_MERGE"
                }
                if ($verdict -eq "BLOCKED") {
                    Write-ShipDeSupervisorCheckpoint -State $State
                    throw "Independent Codex review returned durable BLOCKED for PR #$($pullRequest.number) at exact HEAD $headSha. Stopping fail-closed for human action."
                }
                if ($verdict -eq "CHANGES_REQUIRED") {
                    $workerActionExpected = $true
                    if ([string]$State.LastReviewRepairHead -ne $headSha) {
                        $State.LastReviewRepairHead = $headSha
                        $State.LastRepairDispatchedAt = (Get-Date).ToUniversalTime().ToString("o")
                        $State.LastActivityTime = (Get-Date).ToUniversalTime().ToString("o")
                        $State.NudgeCount = 0
                        Write-ShipDeSupervisorCheckpoint -State $State

                        $message = "Independent Codex review requires changes on PR #$($pullRequest.number) at exact HEAD $headSha. Read the durable review findings, repair the same branch, run all governed checks, commit, push, and stop before merge."
                        if (-not (Send-ShipDeAoMessage -SessionId ([string]$State.SessionId) -Message $message)) {
                            throw "Cannot route review findings back to the implementation worker."
                        }
                    }
                } elseif ([string]$State.LastReviewTriggeredHead -ne $headSha) {
                    $State.LastReviewTriggeredHead = $headSha
                    $State.LastReviewTriggeredAt = (Get-Date).ToUniversalTime().ToString("o")
                    Write-ShipDeSupervisorCheckpoint -State $State

                    if (-not (Start-ShipDeAoReview -SessionId ([string]$State.SessionId))) {
                        throw "CI is green but the independent Codex review could not be started."
                    }
                } else {
                    if ([string]::IsNullOrWhiteSpace([string]$State.LastReviewTriggeredAt)) {
                        $State.LastReviewTriggeredAt = (Get-Date).ToUniversalTime().ToString("o")
                    }
                    $reviewStarted = [DateTime]::MinValue
                    if (-not [DateTime]::TryParse([string]$State.LastReviewTriggeredAt, [ref]$reviewStarted)) {
                        throw "Supervisor review checkpoint timestamp is invalid."
                    }
                    $reviewElapsed = (Get-Date).ToUniversalTime() - $reviewStarted.ToUniversalTime()
                    if ($reviewElapsed.TotalMinutes -ge $ReviewTimeoutMinutes) {
                        throw "AO Codex review timed out after $ReviewTimeoutMinutes minute(s) for exact HEAD $headSha."
                    }
                }
            }
        }

        if ($activity -eq "ACTIVE") {
            $State.LastActivityTime = (Get-Date).ToUniversalTime().ToString("o")
            $State.NudgeCount = 0
            $State.LastRepairDispatchedAt = $null
        } elseif ($activity -in @("IDLE", "WAITING_INPUT") -and ((-not $pullRequest) -or $workerActionExpected)) {
            $lastActivity = [DateTime]::Parse([string]$State.LastActivityTime).ToUniversalTime()
            $idleDuration = (Get-Date).ToUniversalTime() - $lastActivity
            if ($idleDuration.TotalMinutes -ge $InactivityTimeoutMinutes) {
                if ([int]$State.NudgeCount -ge $MaxNudges) {
                    throw "AO worker is stalled after $MaxNudges bounded nudge attempt(s)."
                }
                $State.NudgeCount = [int]$State.NudgeCount + 1
                $State.LastActivityTime = (Get-Date).ToUniversalTime().ToString("o")
                Write-ShipDeSupervisorCheckpoint -State $State

                $message = "Continue the assigned Work Item autonomously. If genuinely blocked, report one concrete blocker. Do not wait for routine confirmation."
                if (-not (Send-ShipDeAoMessage -SessionId ([string]$State.SessionId) -Message $message)) {
                    throw "AO worker is idle and could not be nudged."
                }
            }
        } elseif ($activity -eq "COMPLETED" -and ((-not $pullRequest) -or $workerActionExpected)) {
            $reactivationGraceSeconds = 120
            $inReactivationWindow = $false
            if (-not [string]::IsNullOrWhiteSpace([string]$State.LastRepairDispatchedAt)) {
                $dispatchedTime = [DateTime]::MinValue
                if ([DateTime]::TryParse([string]$State.LastRepairDispatchedAt, [ref]$dispatchedTime)) {
                    $elapsed = (Get-Date).ToUniversalTime() - $dispatchedTime.ToUniversalTime()
                    if ($elapsed.TotalSeconds -ge 0 -and $elapsed.TotalSeconds -lt $reactivationGraceSeconds) {
                        $inReactivationWindow = $true
                    }
                }
            }

            if ($inReactivationWindow) {
                Write-Host ("[SUPERVISOR] Repair was dispatched at {0}. Permitting reactivation window for completed worker." -f $State.LastRepairDispatchedAt)
            } else {
                throw "AO worker completed while governed implementation or repair work is still required."
            }
        }

        Write-ShipDeSupervisorCheckpoint -State $State
        Start-Sleep -Seconds $PollIntervalSeconds
    }
}

function Assert-ShipDeSupervisorCompatibility {
    $aoFixtureRoot = Join-Path $env:TEMP "task-ai-06-ao-$([Guid]::NewGuid().ToString('N'))"
    $aoFixturePath = Join-Path $aoFixtureRoot "agent-orchestrator\resources\daemon\ao.exe"
    try {
        New-Item -ItemType Directory -Path (Split-Path $aoFixturePath -Parent) -Force | Out-Null
        New-Item -ItemType File -Path $aoFixturePath -Force | Out-Null

        $resolvedCanonicalAo = Resolve-ShipDeAoExecutable `
            -CommandResolver { return $null } `
            -ProgramFilesRoot $aoFixtureRoot
        if ($resolvedCanonicalAo -ne (Get-Item -LiteralPath $aoFixturePath).FullName) {
            throw "AO PATH-absence canonical discovery compatibility test failed."
        }

        $semanticEvidence = Assert-ShipDeAoVersionEvidence `
            -AoExecutable $resolvedCanonicalAo `
            -ExpectedVersion $script:ExpectedAoVersion `
            -VersionText "ao version $($script:ExpectedAoVersion)+desktop.1" `
            -ProgramFilesRoot $aoFixtureRoot `
            -ProductVersionReader { throw "ProductVersion must not be consulted when AO returns semantic build metadata." }
        if ($semanticEvidence.Source -ne "semantic-build-metadata" -or $semanticEvidence.EffectiveVersion -ne $script:ExpectedAoVersion) {
            throw "AO semantic build metadata preference compatibility test failed."
        }

        $devEvidence = Assert-ShipDeAoVersionEvidence `
            -AoExecutable $resolvedCanonicalAo `
            -ExpectedVersion $script:ExpectedAoVersion `
            -VersionText "ao version dev" `
            -ProgramFilesRoot $aoFixtureRoot `
            -ProductVersionReader { param($path) return $script:ExpectedAoVersion }
        if ($devEvidence.Source -ne "windows-product-version" -or $devEvidence.BinaryVersion -ne $script:ExpectedAoVersion) {
            throw "AO dev ProductVersion compatibility test failed."
        }

        $plainDevEvidence = Assert-ShipDeAoVersionEvidence `
            -AoExecutable $resolvedCanonicalAo `
            -ExpectedVersion $script:ExpectedAoVersion `
            -VersionText "dev" `
            -ProgramFilesRoot $aoFixtureRoot `
            -ProductVersionReader { param($path) return $script:ExpectedAoVersion }
        if ($plainDevEvidence.Source -ne "windows-product-version" -or $plainDevEvidence.BinaryVersion -ne $script:ExpectedAoVersion) {
            throw "AO plain dev ProductVersion compatibility test failed."
        }

        $launcherScript = Get-Content -LiteralPath (Join-Path $PSScriptRoot "start-agent-orchestrator.ps1") -Raw -Encoding UTF8
        if ($launcherScript -match 'Start-Process\s+-FilePath\s+\$AoExecutable\b') {
            throw "Production regression: start-agent-orchestrator.ps1 passes empty `$AoExecutable parameter instead of resolved `$aoExecutablePath to Start-Process."
        }

        # TASK-AI-06 bootstrap regressions: preserve launcher failures and bind
        # the marker to the exact live AO process before Supervise can reuse it.
        $routerInitialization = $launcherScript.IndexOf('$routerProcess = $null', [StringComparison]::Ordinal)
        $routerStartupBranch = $launcherScript.IndexOf('if (-not (Test-AgentRouterEndpoint))', [StringComparison]::Ordinal)
        if ($routerInitialization -lt 0 -or $routerStartupBranch -lt 0 -or $routerInitialization -gt $routerStartupBranch) {
            throw "AO bootstrap regression: routerProcess is not initialized before the startup branch."
        }
        $firstLauncherThrow = $launcherScript.IndexOf('throw ', [StringComparison]::Ordinal)
        $routerCleanupHelper = $launcherScript.IndexOf('function Stop-StartedRouterProcess', [StringComparison]::Ordinal)
        $routerCleanupCalls = ([regex]::Matches($launcherScript, 'Stop-StartedRouterProcess\s+-Process\s+\$routerProcess')).Count
        $unsafeRouterDereferences = ([regex]::Matches($launcherScript, '\$routerProcess\.HasExited')).Count
        if ($firstLauncherThrow -lt 0 -or $routerInitialization -gt $firstLauncherThrow -or $routerCleanupHelper -lt 0 -or $routerCleanupCalls -lt 3 -or $unsafeRouterDereferences -ne 0) {
            throw "AO bootstrap regression: routerProcess is not initialized and cleaned up safely on every launcher path."
        }
        $processStarterInvocationForCleanup = $launcherScript.IndexOf('& $ProcessStarter', [StringComparison]::Ordinal)
        $aoStartupTryForCleanup = $launcherScript.IndexOf('try {', $processStarterInvocationForCleanup, [StringComparison]::Ordinal)
        $launcherCleanupStart = $launcherScript.IndexOf('} catch {', $aoStartupTryForCleanup, [StringComparison]::Ordinal)
        $aoProcessInitialization = $launcherScript.IndexOf('$aoProcess = $null', [StringComparison]::Ordinal)
        $aoIdentityInitialization = $launcherScript.IndexOf('$aoIdentity = $null', [StringComparison]::Ordinal)
        $temporaryPathInitialization = $launcherScript.IndexOf('$temporaryPath = $null', [StringComparison]::Ordinal)
        $aoCleanupReference = $launcherScript.IndexOf('$aoProcess -and', $launcherCleanupStart, [StringComparison]::Ordinal)
        $routerCleanupReference = $launcherScript.IndexOf('Stop-StartedRouterProcess -Process $routerProcess', $launcherCleanupStart, [StringComparison]::Ordinal)
        $temporaryPathCleanupReference = $launcherScript.IndexOf('$temporaryPath)', $launcherCleanupStart, [StringComparison]::Ordinal)
        $runtimePathCleanupReference = $launcherScript.IndexOf('Remove-Item -LiteralPath $runtimePath', $launcherCleanupStart, [StringComparison]::Ordinal)
        if ($processStarterInvocationForCleanup -lt 0 -or $aoStartupTryForCleanup -lt 0 -or $launcherCleanupStart -lt 0 -or
            $aoProcessInitialization -lt 0 -or $aoProcessInitialization -gt $aoCleanupReference -or
            $aoIdentityInitialization -lt 0 -or $aoIdentityInitialization -gt $launcherCleanupStart -or
            $temporaryPathInitialization -lt 0 -or $temporaryPathInitialization -gt $temporaryPathCleanupReference -or
            $routerCleanupReference -lt 0 -or $routerInitialization -gt $routerCleanupReference -or
            $runtimePathCleanupReference -lt 0) {
            throw "AO bootstrap regression: cleanup references state that is not initialized before the governed launcher catch."
        }
        $controllerScript = Get-Content -LiteralPath (Join-Path $PSScriptRoot "control.ps1") -Raw -Encoding UTF8
        $finallyIndex = $controllerScript.IndexOf('} finally {', [StringComparison]::Ordinal)
        $finallyStateInitialization = $controllerScript.IndexOf('$previousErrorActionPreference = $ErrorActionPreference', [StringComparison]::Ordinal)
        if ($finallyIndex -lt 0 -or $finallyStateInitialization -lt 0 -or $finallyStateInitialization -gt $finallyIndex) {
            throw "Controller regression: finally restores state that was not initialized before entering the protected operation."
        }
        $aoInitialization = $launcherScript.IndexOf('$aoProcess = $null', [StringComparison]::Ordinal)
        $processStarterInvocation = $launcherScript.IndexOf('& $ProcessStarter', [StringComparison]::Ordinal)
        $startupTry = $launcherScript.IndexOf('try {', $processStarterInvocation, [StringComparison]::Ordinal)
        if ($aoInitialization -lt 0 -or $processStarterInvocation -lt 0 -or $startupTry -lt 0 -or $aoInitialization -gt $startupTry) {
            throw "AO bootstrap regression: launcher failure before process creation is not covered by the startup catch."
        }
        $startupCatch = $launcherScript.IndexOf('} catch {', $startupTry, [StringComparison]::Ordinal)
        $startupRethrow = $launcherScript.IndexOf('    throw', $startupCatch, [StringComparison]::Ordinal)
        if ($startupCatch -lt 0 -or $startupRethrow -lt 0) {
            throw "AO bootstrap regression: original launcher startup error is not rethrown."
        }
        $liveProcessResolution = $launcherScript.IndexOf('Get-LiveAoProcess', [StringComparison]::Ordinal)
        $markerProcessBinding = $launcherScript.IndexOf('process_id = $aoIdentity.Id', [StringComparison]::Ordinal)
        if ($liveProcessResolution -lt 0 -or $markerProcessBinding -lt 0 -or $liveProcessResolution -gt $markerProcessBinding) {
            throw "AO bootstrap regression: runtime marker is not bound to the verified live daemon process."
        }

        $bootstrapExecutable = Join-Path $env:TEMP "task-ai-06-ao-marker-$([Guid]::NewGuid().ToString('N'))\ao.exe"
        $bootstrapStartTime = (Get-Date).ToUniversalTime().AddMinutes(-1)
        $bootstrapProcess = [PSCustomObject]@{
            Id = 61006
            HasExited = $false
            ProcessName = "ao"
            Path = $bootstrapExecutable
            StartTime = $bootstrapStartTime
        }
        $bootstrapMarker = [PSCustomObject]@{
            marker_version = 2
            process_id = $bootstrapProcess.Id
            process_name = $bootstrapProcess.ProcessName
            process_path = $bootstrapProcess.Path
            process_start_time = $bootstrapStartTime.ToString("o")
            profile = "C:\fixture\.claude"
            base_url = "http://localhost:20128/v1"
            ao_version = $script:ExpectedAoVersion
            ao_binary_version = $null
            ao_version_source = "semantic-build-metadata"
            ao_executable = $bootstrapExecutable
            credential_overrides_cleared = @("ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY")
            started_at = (Get-Date).ToUniversalTime().ToString("o")
        }
        Assert-ShipDeAoRuntimeMarker `
            -Runtime $bootstrapMarker `
            -ExpectedProfile "C:\fixture\.claude" `
            -ExpectedBaseUrl "http://localhost:20128/v1" `
            -ExpectedVersion $script:ExpectedAoVersion `
            -ExpectedExecutable $bootstrapExecutable `
            -ProcessResolver { param($id) $bootstrapProcess }

        $staleMarkerRejected = $false
        try {
            $staleProcess = [PSCustomObject]@{
                Id = $bootstrapProcess.Id
                HasExited = $false
                ProcessName = "ao"
                Path = "$bootstrapExecutable.stale"
                StartTime = $bootstrapStartTime
            }
            Assert-ShipDeAoRuntimeMarker `
                -Runtime $bootstrapMarker `
                -ExpectedProfile "C:\fixture\.claude" `
                -ExpectedBaseUrl "http://localhost:20128/v1" `
                -ExpectedVersion $script:ExpectedAoVersion `
                -ExpectedExecutable $bootstrapExecutable `
                -ProcessResolver { param($id) $staleProcess } | Out-Null
        } catch {
            $staleMarkerRejected = $_.Exception.Message -match "identity cannot be verified"
        }
        if (-not $staleMarkerRejected) {
            throw "AO bootstrap regression: a live AO with a stale marker was accepted."
        }

        $duplicateLaunches = @{ Count = 0 }
        Ensure-ShipDeAgentRouterRuntime `
            -ProfileValidator { } `
            -ReadinessResolver { return @{ Ready = $true } } `
            -Launcher { $duplicateLaunches.Count++ }
        if ($duplicateLaunches.Count -ne 0) {
            throw "AO bootstrap regression: a governed ready AO would be launched a second time."
        }

        $mismatchedProductVersionRejected = $false
        try {
            Assert-ShipDeAoVersionEvidence `
                -AoExecutable $resolvedCanonicalAo `
                -ExpectedVersion $script:ExpectedAoVersion `
                -VersionText "ao version dev" `
                -ProgramFilesRoot $aoFixtureRoot `
                -ProductVersionReader { param($path) return "0.12.11" } | Out-Null
        } catch {
            $mismatchedProductVersionRejected = $true
        }
        if (-not $mismatchedProductVersionRejected) {
            throw "AO mismatched ProductVersion fail-closed compatibility test failed."
        }

        $unverifiableVersionRejected = $false
        try {
            Assert-ShipDeAoVersionEvidence `
                -AoExecutable $resolvedCanonicalAo `
                -ExpectedVersion $script:ExpectedAoVersion `
                -VersionText "ao version dev" `
                -ProgramFilesRoot $aoFixtureRoot `
                -ProductVersionReader { param($path) return "not-a-version" } | Out-Null
        } catch {
            $unverifiableVersionRejected = $true
        }
        if (-not $unverifiableVersionRejected) {
            throw "AO malformed ProductVersion fail-closed compatibility test failed."
        }

        $missingProductVersionRejected = $false
        try {
            Assert-ShipDeAoVersionEvidence `
                -AoExecutable $resolvedCanonicalAo `
                -ExpectedVersion $script:ExpectedAoVersion `
                -VersionText "ao version dev" `
                -ProgramFilesRoot $aoFixtureRoot `
                -ProductVersionReader { param($path) return "" } | Out-Null
        } catch {
            $missingProductVersionRejected = $true
        }
        if (-not $missingProductVersionRejected) {
            throw "AO missing ProductVersion fail-closed compatibility test failed."
        }

        $missingVersionRejected = $false
        try {
            Assert-ShipDeAoVersionEvidence `
                -AoExecutable $resolvedCanonicalAo `
                -ExpectedVersion $script:ExpectedAoVersion `
                -VersionText "" `
                -ProgramFilesRoot $aoFixtureRoot | Out-Null
        } catch {
            $missingVersionRejected = $true
        }
        if (-not $missingVersionRejected) {
            throw "AO missing version fail-closed compatibility test failed."
        }

        $versionRangeRejected = $false
        try {
            Assert-ShipDeAoVersionEvidence `
                -AoExecutable $resolvedCanonicalAo `
                -ExpectedVersion "^$($script:ExpectedAoVersion)" `
                -VersionText "ao version $($script:ExpectedAoVersion)" `
                -ProgramFilesRoot $aoFixtureRoot | Out-Null
        } catch {
            $versionRangeRejected = $true
        }
        if (-not $versionRangeRejected) {
            throw "AO version range fail-closed compatibility test failed."
        }

        $newerVersionRejected = $false
        try {
            Assert-ShipDeAoVersionEvidence `
                -AoExecutable $resolvedCanonicalAo `
                -ExpectedVersion $script:ExpectedAoVersion `
                -VersionText "ao version 0.12.99" `
                -ProgramFilesRoot $aoFixtureRoot | Out-Null
        } catch {
            $newerVersionRejected = $true
        }
        if (-not $newerVersionRejected) {
            throw "AO newer version fail-closed compatibility test failed."
        }

        $canonicalPinned = Get-ShipDePinnedAoVersion
        if ($canonicalPinned -ne "0.12.12" -or $canonicalPinned -ne $script:ExpectedAoVersion) {
            throw "Canonical pinned AO version test failed: expected 0.12.12, got $canonicalPinned"
        }
    } finally {
        if (Test-Path -LiteralPath $aoFixtureRoot) {
            Remove-Item -LiteralPath $aoFixtureRoot -Recurse -Force
        }
    }

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
    $geminiHarnesses = @(Get-ShipDeAoHarnessCandidates -Author "GEMINI")
    if ($geminiHarnesses.Count -ne 1 -or $geminiHarnesses[0] -ne "agy") {
        throw "AO Gemini author harness compatibility test failed."
    }

    $waitingFixture = [PSCustomObject]@{ activity = [PSCustomObject]@{ state = "waiting_input" } }
    $blockedFixture = [PSCustomObject]@{ activity = [PSCustomObject]@{ state = "blocked" } }
    if ((Get-ShipDeSessionActivityState -Session $waitingFixture) -ne "WAITING_INPUT") {
        throw "AO waiting_input activity compatibility test failed."
    }
    if ((Get-ShipDeSessionActivityState -Session $blockedFixture) -ne "BLOCKED") {
        throw "AO blocked activity compatibility test failed."
    }

    $reviewHead = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    $reviewFixture = ConvertFrom-ShipDeAoJson -Json '{"reviews":[{"prNumber":9,"targetSha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","status":"up_to_date","latestRun":{"harness":"codex","status":"complete","verdict":"approved"}}]}' -Operation "self-test"
    $reviewVerdict = Get-ShipDeAoVerdictFromReviewResponse -Response $reviewFixture -PullRequestNumber 9 -HeadSha $reviewHead
    if ($reviewVerdict -ne "PASS") {
        throw "AO exact-HEAD review record compatibility test failed."
    }

    $rerunFixture = [PSCustomObject]@{
        statusCheckRollup = @(
            [PSCustomObject]@{ name = "contract"; workflowName = "Current application"; conclusion = "FAILURE"; startedAt = "2026-09-06T01:00:00Z" },
            [PSCustomObject]@{ name = "contract"; workflowName = "Current application"; conclusion = "SUCCESS"; startedAt = "2026-09-06T01:05:00Z" },
            [PSCustomObject]@{ name = "application-gate"; workflowName = "Current application"; conclusion = "SUCCESS"; startedAt = "2026-09-06T01:05:00Z" }
        )
    }
    if ((Get-ShipDePrGate -PullRequest $rerunFixture) -ne "GREEN") {
        throw "GitHub superseded check-attempt compatibility test failed."
    }
    $ambiguousRerunFixture = [PSCustomObject]@{
        statusCheckRollup = @(
            [PSCustomObject]@{ name = "contract"; workflowName = "Current application"; conclusion = "FAILURE" },
            [PSCustomObject]@{ name = "contract"; workflowName = "Current application"; conclusion = "SUCCESS"; startedAt = "2026-09-06T01:05:00Z" },
            [PSCustomObject]@{ name = "application-gate"; workflowName = "Current application"; conclusion = "SUCCESS"; startedAt = "2026-09-06T01:05:00Z" }
        )
    }
    $ambiguousRerunRejected = $false
    try {
        Get-ShipDePrGate -PullRequest $ambiguousRerunFixture | Out-Null
    } catch {
        $ambiguousRerunRejected = $true
    }
    if (-not $ambiguousRerunRejected) {
        throw "GitHub ambiguous check-attempt compatibility test failed."
    }

    $statusContextRerunFixture = [PSCustomObject]@{
        statusCheckRollup = @(
            [PSCustomObject]@{ context = "contract"; targetUrl = "https://github.com/org/repo/actions/runs/1"; state = "FAILURE"; createdAt = "2026-09-06T01:00:00Z" },
            [PSCustomObject]@{ context = "contract"; targetUrl = "https://github.com/org/repo/actions/runs/2"; state = "SUCCESS"; createdAt = "2026-09-06T01:05:00Z" },
            [PSCustomObject]@{ context = "application-gate"; targetUrl = "https://github.com/org/repo/actions/runs/3"; state = "SUCCESS"; createdAt = "2026-09-06T01:05:00Z" }
        )
    }
    if ((Get-ShipDePrGate -PullRequest $statusContextRerunFixture) -ne "GREEN") {
        throw "GitHub StatusContext createdAt superseded attempt compatibility test failed."
    }

    $emptyRollupFixture = [PSCustomObject]@{
        statusCheckRollup = @()
    }
    if ((Get-ShipDePrGate -PullRequest $emptyRollupFixture) -ne "PENDING") {
        throw "Empty status check rollup compatibility test failed."
    }

    $nestedWorkflowCheck = [PSCustomObject]@{
        name = "gate"
        checkSuite = [PSCustomObject]@{
            workflowRun = [PSCustomObject]@{
                workflow = [PSCustomObject]@{
                    name = "Application CI"
                }
            }
        }
    }
    if ((Get-ShipDeCheckProvider -Check $nestedWorkflowCheck) -ne "github-actions/Application CI") {
        throw "Check provider workflow identity preservation compatibility test failed."
    }

    $workflowCollisionFixture = [PSCustomObject]@{
        statusCheckRollup = @(
            [PSCustomObject]@{ name = "contract"; workflowName = "Workflow A"; conclusion = "SUCCESS"; startedAt = "2026-09-06T01:00:00Z" },
            [PSCustomObject]@{ name = "contract"; workflowName = "Workflow B"; conclusion = "FAILURE"; startedAt = "2026-09-06T01:05:00Z" },
            [PSCustomObject]@{ name = "application-gate"; workflowName = "Workflow A"; conclusion = "SUCCESS"; startedAt = "2026-09-06T01:00:00Z" }
        )
    }
    if ((Get-ShipDePrGate -PullRequest $workflowCollisionFixture) -ne "FAILED") {
        throw "Workflow collision gate test failed: failed job in different workflow was improperly suppressed."
    }

    $governedTestPr = [PSCustomObject]@{
        number = 99
        title = "feat: TASK-AI-99"
        headRefName = "feat/task-ai-99-governed"
        isCrossRepository = $false
        headRepository = "vinh05092001/shipde-platform"
    }
    Assert-ShipDeGovernedPullRequest -PullRequest $governedTestPr -WorkItemId "TASK-AI-99" -Branch "feat/task-ai-99-governed" -ExpectedRepository "vinh05092001/shipde-platform"

    $crossRepoTestPr = [PSCustomObject]@{
        number = 99
        title = "feat: TASK-AI-99"
        headRefName = "feat/task-ai-99-governed"
        isCrossRepository = $true
        headRepository = "forker/shipde-platform"
    }
    $crossRepoCaught = $false
    try {
        Assert-ShipDeGovernedPullRequest -PullRequest $crossRepoTestPr -WorkItemId "TASK-AI-99" -Branch "feat/task-ai-99-governed" -ExpectedRepository "vinh05092001/shipde-platform"
    } catch {
        $crossRepoCaught = $true
    }
    if (-not $crossRepoCaught) {
        throw "Cross-repository pull request rejection test failed."
    }

    $wrongRepoTestPr = [PSCustomObject]@{
        number = 99
        title = "feat: TASK-AI-99"
        headRefName = "feat/task-ai-99-governed"
        isCrossRepository = $false
        headRepository = "attacker/shipde-platform"
    }
    $wrongRepoCaught = $false
    try {
        Assert-ShipDeGovernedPullRequest -PullRequest $wrongRepoTestPr -WorkItemId "TASK-AI-99" -Branch "feat/task-ai-99-governed" -ExpectedRepository "vinh05092001/shipde-platform"
    } catch {
        $wrongRepoCaught = $true
    }
    if (-not $wrongRepoCaught) {
        throw "Wrong head repository pull request rejection test failed."
    }

    $wrongBranchTestPr = [PSCustomObject]@{
        number = 99
        title = "feat: TASK-AI-99"
        headRefName = "feat/wrong-branch"
        isCrossRepository = $false
        headRepository = "vinh05092001/shipde-platform"
    }
    $wrongBranchCaught = $false
    try {
        Assert-ShipDeGovernedPullRequest -PullRequest $wrongBranchTestPr -WorkItemId "TASK-AI-99" -Branch "feat/task-ai-99-governed" -ExpectedRepository "vinh05092001/shipde-platform"
    } catch {
        $wrongBranchCaught = $true
    }
    if (-not $wrongBranchCaught) {
        throw "Wrong head branch pull request rejection test failed."
    }

    $nullRepoTestPr = [PSCustomObject]@{
        number = 99
        title = "feat: TASK-AI-99"
        headRefName = "feat/task-ai-99-governed"
        isCrossRepository = $false
        headRepository = $null
    }
    $nullRepoCaught = $false
    try {
        Assert-ShipDeGovernedPullRequest -PullRequest $nullRepoTestPr -WorkItemId "TASK-AI-99" -Branch "feat/task-ai-99-governed" -ExpectedRepository "vinh05092001/shipde-platform"
    } catch {
        $nullRepoCaught = $true
    }
    if (-not $nullRepoCaught) {
        throw "Null head repository pull request rejection test failed."
    }

    $emptyRepoTestPr = [PSCustomObject]@{
        number = 99
        title = "feat: TASK-AI-99"
        headRefName = "feat/task-ai-99-governed"
        isCrossRepository = $false
        headRepository = ""
    }
    $emptyRepoCaught = $false
    try {
        Assert-ShipDeGovernedPullRequest -PullRequest $emptyRepoTestPr -WorkItemId "TASK-AI-99" -Branch "feat/task-ai-99-governed" -ExpectedRepository "vinh05092001/shipde-platform"
    } catch {
        $emptyRepoCaught = $true
    }
    if (-not $emptyRepoCaught) {
        throw "Empty head repository pull request rejection test failed."
    }

    $whitespaceRepoTestPr = [PSCustomObject]@{
        number = 99
        title = "feat: TASK-AI-99"
        headRefName = "feat/task-ai-99-governed"
        isCrossRepository = $false
        headRepository = "   "
    }
    $whitespaceRepoCaught = $false
    try {
        Assert-ShipDeGovernedPullRequest -PullRequest $whitespaceRepoTestPr -WorkItemId "TASK-AI-99" -Branch "feat/task-ai-99-governed" -ExpectedRepository "vinh05092001/shipde-platform"
    } catch {
        $whitespaceRepoCaught = $true
    }
    if (-not $whitespaceRepoCaught) {
        throw "Whitespace head repository pull request rejection test failed."
    }

    $partialRepoTestPr = [PSCustomObject]@{
        number = 99
        title = "feat: TASK-AI-99"
        headRefName = "feat/task-ai-99-governed"
        isCrossRepository = $false
        headRepository = "shipde-platform"
    }
    $partialRepoCaught = $false
    try {
        Assert-ShipDeGovernedPullRequest -PullRequest $partialRepoTestPr -WorkItemId "TASK-AI-99" -Branch "feat/task-ai-99-governed" -ExpectedRepository "vinh05092001/shipde-platform"
    } catch {
        $partialRepoCaught = $true
    }
    if (-not $partialRepoCaught) {
        throw "Partial head repository pull request rejection test failed."
    }

    $testRegisterCsv = @"
delivery_order,work_item_id,feature_id,status,branch,work_item_path,title
10,TASK-AI-91,,BACKLOG,feat/task-ai-91-one,docs/product-spec/work-items/TASK-AI-91.md,Backlog item
20,TASK-AI-92,,READY_FOR_AUTHOR,feat/task-ai-92-two,docs/product-spec/work-items/TASK-AI-92.md,Ready item
30,TASK-AI-93,,READY_FOR_AUTHOR,feat/task-ai-93-mismatched,docs/product-spec/work-items/TASK-AI-93.md,Mismatched item
"@
    $testTextResolver = {
        param($ref, $path)
        if ($path -eq $script:RegisterPath) {
            return $testRegisterCsv
        }
        if ($path -eq "docs/product-spec/work-items/TASK-AI-92.md") {
            return "| Field | Value |`n| Work Item ID | ``TASK-AI-92`` |`n| Status | ``READY_FOR_AUTHOR`` |`n| Assigned author | ``GEMINI`` |`n| Branch | ``feat/task-ai-92-two`` |`n| Risk | ``LOW`` |`n| Allowed paths | ``scripts/ai/*`` |`n"
        }
        if ($path -eq "docs/product-spec/work-items/TASK-AI-93.md") {
            return "| Field | Value |`n| Work Item ID | ``TASK-AI-93`` |`n| Status | ``READY_FOR_AUTHOR`` |`n| Assigned author | UNKNOWN |`n| Branch | ``feat/task-ai-93-mismatched`` |`n| Risk | ``LOW`` |`n| Allowed paths | ``scripts/ai/*`` |`n"
        }
        return $null
    }
    $testRefs = @("origin/feat/task-ai-92-two", "origin/feat/task-ai-93-mismatched")
    $resolvedRows = @(Get-ShipDeRowsAtRef -Ref "origin/feat/task-ai-92-two" -TextResolver $testTextResolver)
    if ($resolvedRows.Count -ne 3) {
        throw "Delivery register row resolver compatibility test failed: incorrect count."
    }
    $discoveredAssignments = @(Get-ShipDePreparedAssignments -Refs $testRefs -RowResolver { param($r) Get-ShipDeRowsAtRef -Ref $r -TextResolver $testTextResolver } -TextResolver $testTextResolver)
    if ($discoveredAssignments.Count -ne 1 -or $discoveredAssignments[0].WorkItemId -ne "TASK-AI-92" -or $discoveredAssignments[0].Author -ne "GEMINI") {
        throw "Delivery register assignment discovery compatibility test failed."
    }
    $selectedNextItem = Get-ShipDeNextPreparedItem -Items $discoveredAssignments
    if ($null -eq $selectedNextItem -or $selectedNextItem.WorkItemId -ne "TASK-AI-92") {
        throw "Delivery register next prepared item selection compatibility test failed."
    }

    $invalidOrderRegisterCsv = @"
delivery_order,work_item_id,feature_id,status,branch,work_item_path,title
not_a_number,TASK-AI-94,,READY_FOR_AUTHOR,feat/task-ai-94-four,docs/product-spec/work-items/TASK-AI-94.md,Invalid order item
"@
    $invalidOrderTextResolver = {
        param($ref, $path)
        if ($path -eq $script:RegisterPath) { return $invalidOrderRegisterCsv }
        if ($path -eq "docs/product-spec/work-items/TASK-AI-94.md") {
            return "| Field | Value |`n| Work Item ID | ``TASK-AI-94`` |`n| Status | ``READY_FOR_AUTHOR`` |`n| Assigned author | ``GEMINI`` |`n| Branch | ``feat/task-ai-94-four`` |`n| Risk | ``LOW`` |`n| Allowed paths | ``scripts/ai/*`` |`n"
        }
        return $null
    }
    $invalidOrderRejected = $false
    try {
        Get-ShipDePreparedAssignments -Refs @("origin/feat/task-ai-94-four") -RowResolver { param($r) Get-ShipDeRowsAtRef -Ref $r -TextResolver $invalidOrderTextResolver } -TextResolver $invalidOrderTextResolver | Out-Null
    } catch {
        $invalidOrderRejected = $true
    }
    if (-not $invalidOrderRejected) {
        throw "Delivery register non-numeric delivery_order fail-closed compatibility test failed."
    }

    $negativeOrderRegisterCsv = @"
delivery_order,work_item_id,feature_id,status,branch,work_item_path,title
-5,TASK-AI-95,,READY_FOR_AUTHOR,feat/task-ai-95-five,docs/product-spec/work-items/TASK-AI-95.md,Negative order item
"@
    $negativeOrderTextResolver = {
        param($ref, $path)
        if ($path -eq $script:RegisterPath) { return $negativeOrderRegisterCsv }
        if ($path -eq "docs/product-spec/work-items/TASK-AI-95.md") {
            return "| Field | Value |`n| Work Item ID | ``TASK-AI-95`` |`n| Status | ``READY_FOR_AUTHOR`` |`n| Assigned author | ``GEMINI`` |`n| Branch | ``feat/task-ai-95-five`` |`n| Risk | ``LOW`` |`n| Allowed paths | ``scripts/ai/*`` |`n"
        }
        return $null
    }
    $negativeOrderRejected = $false
    try {
        Get-ShipDePreparedAssignments -Refs @("origin/feat/task-ai-95-five") -RowResolver { param($r) Get-ShipDeRowsAtRef -Ref $r -TextResolver $negativeOrderTextResolver } -TextResolver $negativeOrderTextResolver | Out-Null
    } catch {
        $negativeOrderRejected = $true
    }
    if (-not $negativeOrderRejected) {
        throw "Delivery register negative delivery_order fail-closed compatibility test failed."
    }

    $mismatchedBranchRegisterCsv = @"
delivery_order,work_item_id,feature_id,status,branch,work_item_path,title
35,TASK-AI-96,,READY_FOR_AUTHOR,feat/task-ai-96-declared,docs/product-spec/work-items/TASK-AI-96.md,Mismatched branch item
"@
    $mismatchedBranchTextResolver = {
        param($ref, $path)
        if ($path -eq $script:RegisterPath) { return $mismatchedBranchRegisterCsv }
        if ($path -eq "docs/product-spec/work-items/TASK-AI-96.md") {
            return "| Field | Value |`n| Work Item ID | ``TASK-AI-96`` |`n| Status | ``READY_FOR_AUTHOR`` |`n| Assigned author | ``GEMINI`` |`n| Branch | ``feat/task-ai-96-declared`` |`n| Risk | ``LOW`` |`n| Allowed paths | ``scripts/ai/*`` |`n"
        }
        return $null
    }
    $mismatchedRefAssignments = @(Get-ShipDePreparedAssignments -Refs @("origin/feat/task-ai-96-different") -RowResolver { param($r) Get-ShipDeRowsAtRef -Ref $r -TextResolver $mismatchedBranchTextResolver } -TextResolver $mismatchedBranchTextResolver)
    if ($mismatchedRefAssignments.Count -ne 0) {
        throw "Assignment branch binding test failed: mismatched ref was accepted."
    }

    $dupIdRef1 = "origin/feat/task-ai-92-one"
    $dupIdRef2 = "origin/feat/task-ai-92-two"
    $dupIdTextResolver = {
        param($ref, $path)
        if ($path -eq $script:RegisterPath) {
            return @"
delivery_order,work_item_id,feature_id,status,branch,work_item_path,title
20,TASK-AI-92,,READY_FOR_AUTHOR,feat/task-ai-92-one,docs/product-spec/work-items/TASK-AI-92.md,Ready item
"@
        }
        if ($path -eq "docs/product-spec/work-items/TASK-AI-92.md") {
            $branch = if ($ref -eq $dupIdRef1) { "feat/task-ai-92-one" } else { "feat/task-ai-92-two" }
            return "| Field | Value |`n| Work Item ID | ``TASK-AI-92`` |`n| Status | ``READY_FOR_AUTHOR`` |`n| Assigned author | ``GEMINI`` |`n| Branch | ``$branch`` |`n| Risk | ``LOW`` |`n| Allowed paths | ``scripts/ai/*`` |`n"
        }
        return $null
    }
    $dupIdCaught = $false
    try {
        Get-ShipDePreparedAssignments -Refs @($dupIdRef1, $dupIdRef2) `
            -RowResolver {
                param($r)
                $b = if ($r -eq $dupIdRef1) { "feat/task-ai-92-one" } else { "feat/task-ai-92-two" }
                @( [PSCustomObject]@{ delivery_order = "20"; work_item_id = "TASK-AI-92"; status = "READY_FOR_AUTHOR"; branch = $b; work_item_path = "docs/product-spec/work-items/TASK-AI-92.md" } )
            } `
            -TextResolver $dupIdTextResolver | Out-Null
    } catch {
        if ($_.Exception.Message -match "Duplicate prepared Work Item ID collision detected") {
            $dupIdCaught = $true
        }
    }
    if (-not $dupIdCaught) {
        throw "Duplicate prepared Work Item ID collision test failed: expected exception."
    }

    $dupOrderCaught = $false
    try {
        Get-ShipDePreparedAssignments -Refs @("origin/feat/task-ai-92-two", "origin/feat/task-ai-97-seven") `
            -RowResolver {
                param($r)
                if ($r -eq "origin/feat/task-ai-92-two") {
                    @( [PSCustomObject]@{ delivery_order = "20"; work_item_id = "TASK-AI-92"; status = "READY_FOR_AUTHOR"; branch = "feat/task-ai-92-two"; work_item_path = "docs/product-spec/work-items/TASK-AI-92.md" } )
                } else {
                    @( [PSCustomObject]@{ delivery_order = "20"; work_item_id = "TASK-AI-97"; status = "READY_FOR_AUTHOR"; branch = "feat/task-ai-97-seven"; work_item_path = "docs/product-spec/work-items/TASK-AI-97.md" } )
                }
            } `
            -TextResolver {
                param($r, $p)
                if ($p -eq "docs/product-spec/work-items/TASK-AI-92.md") {
                    return "| Field | Value |`n| Work Item ID | ``TASK-AI-92`` |`n| Status | ``READY_FOR_AUTHOR`` |`n| Assigned author | ``GEMINI`` |`n| Branch | ``feat/task-ai-92-two`` |`n| Risk | ``LOW`` |`n| Allowed paths | ``scripts/ai/*`` |`n"
                }
                if ($p -eq "docs/product-spec/work-items/TASK-AI-97.md") {
                    return "| Field | Value |`n| Work Item ID | ``TASK-AI-97`` |`n| Status | ``READY_FOR_AUTHOR`` |`n| Assigned author | ``GEMINI`` |`n| Branch | ``feat/task-ai-97-seven`` |`n| Risk | ``LOW`` |`n| Allowed paths | ``scripts/ai/*`` |`n"
                }
                return $null
            } | Out-Null
    } catch {
        if ($_.Exception.Message -match "Duplicate prepared delivery order collision detected") {
            $dupOrderCaught = $true
        }
    }
    if (-not $dupOrderCaught) {
        throw "Duplicate prepared delivery order collision test failed: expected exception."
    }

    $realTaskAi06ControlTable = @'
## Control

| Field           | Value                                                                                                                                               |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Work Item ID    | `TASK-AI-06`                                                                                                                                        |
| Feature ID      | `N/A`                                                                                                                                               |
| Status          | `READY_FOR_AUTHOR`                                                                                                                                  |
| Delivery order  | `139`                                                                                                                                               |
| Dependencies    | `TASK-AI-05` merged through PR #7 as `a344b69af3c1c9dc4469d0ccdefe15c130bb2188`                                                                     |
| Assigned author | `GEMINI` (requires architectural decisions for supervisor design and AO integration)                                                                |
| Risk            | `HIGH`                                                                                                                                              |
| Allowed paths   | `scripts/ai/*.ps1`; `docs/product-spec/work-items/TASK-AI-*.md`; `docs/product-spec/docs/10-ai-collaboration/*.md`; `tools/ecosystem-manifest.json` |
| Reviewer        | `Codex — fresh independent task using Sol High; no routed or self-review verdict`                                                                   |
| Branch          | `feat/task-ai-06-orchestrator-supervisor`                                                                                                           |
| Pull Request    | `#9`                                                                                                                                                |
'@
    $realTaskAi06Row = [PSCustomObject]@{
        delivery_order = "139"
        work_item_id = "TASK-AI-06"
        work_item_path = "docs/product-spec/work-items/TASK-AI-06.md"
        branch = "feat/task-ai-06-orchestrator-supervisor"
        status = "READY_FOR_AUTHOR"
    }
    $taskAi06DirectAssignment = Get-ShipDeAssignment `
        -Ref "origin/feat/task-ai-06-orchestrator-supervisor" `
        -Row $realTaskAi06Row `
        -TextResolver { param($r, $p) return $realTaskAi06ControlTable }
    if (
        $null -eq $taskAi06DirectAssignment -or
        $taskAi06DirectAssignment.WorkItemId -ne "TASK-AI-06" -or
        $taskAi06DirectAssignment.Author -ne "GEMINI" -or
        $taskAi06DirectAssignment.Branch -ne "feat/task-ai-06-orchestrator-supervisor" -or
        $taskAi06DirectAssignment.DeliveryOrder -ne 139 -or
        $taskAi06DirectAssignment.Slug -ne "orchestrator-supervisor"
    ) {
        throw "TASK-AI-06 real control-table content parsing compatibility test failed."
    }

    $realTaskAi06Discovered = @(Get-ShipDePreparedAssignments `
        -Refs @("origin/feat/task-ai-06-orchestrator-supervisor") `
        -RowResolver { param($r) return @($realTaskAi06Row) } `
        -TextResolver { param($r, $p) return $realTaskAi06ControlTable })
    if (
        $realTaskAi06Discovered.Count -ne 1 -or
        $realTaskAi06Discovered[0].WorkItemId -ne "TASK-AI-06" -or
        $realTaskAi06Discovered[0].Author -ne "GEMINI" -or
        $realTaskAi06Discovered[0].DeliveryOrder -ne 139
    ) {
        throw "TASK-AI-06 real control-table discovery compatibility test failed."
    }

    $realTaskAi06File = Join-Path $PSScriptRoot "../../docs/product-spec/work-items/TASK-AI-06.md"
    if (-not (Test-Path $realTaskAi06File)) {
        $realTaskAi06File = "docs/product-spec/work-items/TASK-AI-06.md"
    }
    if (Test-Path $realTaskAi06File) {
        $realFileContent = Get-Content $realTaskAi06File -Raw -Encoding UTF8
        $realStatusMatch = [regex]::Match($realFileContent, '(?im)^\|\s*Status\s*\|\s*`?(?<status>[A-Z_]+)`?\s*\|')
        if ($realStatusMatch.Success) {
            $liveTaskAi06Row = [PSCustomObject]@{
                delivery_order = "139"
                work_item_id = "TASK-AI-06"
                work_item_path = "docs/product-spec/work-items/TASK-AI-06.md"
                branch = "feat/task-ai-06-orchestrator-supervisor"
                status = $realStatusMatch.Groups["status"].Value
            }
            $liveTaskAi06Assignment = Get-ShipDeAssignment `
                -Ref "origin/feat/task-ai-06-orchestrator-supervisor" `
                -Row $liveTaskAi06Row `
                -TextResolver { param($r, $p) return $realFileContent }
            if (
                $null -eq $liveTaskAi06Assignment -or
                $liveTaskAi06Assignment.WorkItemId -ne "TASK-AI-06" -or
                $liveTaskAi06Assignment.Author -ne "GEMINI" -or
                $liveTaskAi06Assignment.Branch -ne "feat/task-ai-06-orchestrator-supervisor" -or
                $liveTaskAi06Assignment.DeliveryOrder -ne 139 -or
                $liveTaskAi06Assignment.Slug -ne "orchestrator-supervisor"
            ) {
                throw "Direct TASK-AI-06.md file parsing compatibility test failed."
            }

            $liveMismatchedRow = [PSCustomObject]@{
                delivery_order = "139"
                work_item_id = "TASK-AI-06"
                work_item_path = "docs/product-spec/work-items/TASK-AI-06.md"
                branch = "feat/task-ai-06-orchestrator-supervisor"
                status = "STATUS_MISMATCH_PROBE"
            }
            $liveMismatchedAssignment = Get-ShipDeAssignment `
                -Ref "origin/feat/task-ai-06-orchestrator-supervisor" `
                -Row $liveMismatchedRow `
                -TextResolver { param($r, $p) return $realFileContent }
            if ($null -ne $liveMismatchedAssignment) {
                throw "Direct TASK-AI-06.md status mismatch fail-closed compatibility test failed."
            }
        }
    }

    # Finding 3 tests: Validate reused AO sessions before binding
    $sessionFixtureItem = [PSCustomObject]@{
        WorkItemId = "TASK-AI-06"
        Branch = "feat/task-ai-06-orchestrator-supervisor"
        Author = "GEMINI"
    }
    $validSessionDetail = [PSCustomObject]@{
        kind = "worker"
        branch = "feat/task-ai-06-orchestrator-supervisor"
        harness = "agy"
        worktree = "C:\Users\gumac\.ao\data\worktrees\shipde-platform\shipde-platform-3"
    }
    $verifiedH = Assert-ShipDeReusedAoSession -SessionDetail $validSessionDetail -Item $sessionFixtureItem -AllowedHarnesses @("agy")
    if ($verifiedH -ne "agy") {
        throw "Valid reused AO session verification test failed."
    }

    $nullSessionCaught = $false
    try {
        Assert-ShipDeReusedAoSession -SessionDetail $null -Item $sessionFixtureItem -AllowedHarnesses @("agy") | Out-Null
    } catch {
        $nullSessionCaught = $true
    }
    if (-not $nullSessionCaught) {
        throw "Null reused AO session detail rejection test failed."
    }

    $wrongKindCaught = $false
    try {
        $wrongKindDetail = [PSCustomObject]@{
            kind = "orchestrator"
            branch = "feat/task-ai-06-orchestrator-supervisor"
            harness = "agy"
            worktree = "C:\worktree"
        }
        Assert-ShipDeReusedAoSession -SessionDetail $wrongKindDetail -Item $sessionFixtureItem -AllowedHarnesses @("agy") | Out-Null
    } catch {
        $wrongKindCaught = $true
    }
    if (-not $wrongKindCaught) {
        throw "Wrong kind reused AO session rejection test failed."
    }

    $mismatchedBranchSessionCaught = $false
    try {
        $mismatchedBranchDetail = [PSCustomObject]@{
            kind = "worker"
            branch = "feat/other-branch"
            harness = "agy"
            worktree = "C:\worktree"
        }
        Assert-ShipDeReusedAoSession -SessionDetail $mismatchedBranchDetail -Item $sessionFixtureItem -AllowedHarnesses @("agy") | Out-Null
    } catch {
        $mismatchedBranchSessionCaught = $true
    }
    if (-not $mismatchedBranchSessionCaught) {
        throw "Mismatched branch reused AO session rejection test failed."
    }

    $mismatchedHarnessSessionCaught = $false
    try {
        $mismatchedHarnessDetail = [PSCustomObject]@{
            kind = "worker"
            branch = "feat/task-ai-06-orchestrator-supervisor"
            harness = "claude-code"
            worktree = "C:\worktree"
        }
        Assert-ShipDeReusedAoSession -SessionDetail $mismatchedHarnessDetail -Item $sessionFixtureItem -AllowedHarnesses @("agy") | Out-Null
    } catch {
        $mismatchedHarnessSessionCaught = $true
    }
    if (-not $mismatchedHarnessSessionCaught) {
        throw "Mismatched harness reused AO session rejection test failed."
    }

    $missingWorktreeSessionCaught = $false
    try {
        $missingWorktreeDetail = [PSCustomObject]@{
            kind = "worker"
            branch = "feat/task-ai-06-orchestrator-supervisor"
            harness = "agy"
            worktree = ""
        }
        Assert-ShipDeReusedAoSession -SessionDetail $missingWorktreeDetail -Item $sessionFixtureItem -AllowedHarnesses @("agy") | Out-Null
    } catch {
        $missingWorktreeSessionCaught = $true
    }
    if (-not $missingWorktreeSessionCaught) {
        throw "Missing worktree reused AO session rejection test failed."
    }

    # Finding 4 tests: Resume SPAWNING checkpoints before rejecting open PRs
    $spawnRestartState = @{
        WorkItemId = "TASK-AI-06"
        WorkItemPath = "docs/product-spec/work-items/TASK-AI-06.md"
        Branch = "feat/task-ai-06-orchestrator-supervisor"
        Author = "GEMINI"
        State = "SPAWNING"
    }
    $simulatedPr = [PSCustomObject]@{
        number = 9
        title = "[TASK-AI-06] Governed AO supervisor with AgentRouter fallback"
        headRefName = "feat/task-ai-06-orchestrator-supervisor"
        isCrossRepository = $false
        headRepository = "vinh05092001/shipde-platform"
    }
    $workerSpawnStats = @{ Count = 0 }
    $reusedSessionResult = Initialize-ShipDeSupervisorState `
        -State $spawnRestartState `
        -OpenPrResolver { @($simulatedPr) } `
        -CodexParker { } `
        -WorkerStarter {
            param($it, $pr)
            $workerSpawnStats.Count++
            return [PSCustomObject]@{ SessionId = "recovered-ao-session-99"; Harness = "agy" }
        } `
        -CheckpointWriter { param($s) }

    if (
        $null -eq $reusedSessionResult -or
        $reusedSessionResult.State -ne "STARTED" -or
        $reusedSessionResult.SessionId -ne "recovered-ao-session-99" -or
        $reusedSessionResult.Harness -ne "agy" -or
        $workerSpawnStats.Count -ne 1
    ) {
        throw "SPAWNING state recovery with open PR test failed: did not bind existing session properly."
    }

    # Negative test: Null state with open implementation PR must fail closed
    $nullStateWithPrCaught = $false
    try {
        Initialize-ShipDeSupervisorState `
            -State $null `
            -OpenPrResolver { @($simulatedPr) } `
            -WorkerStarter { param($it, $pr) throw "Should not spawn" } `
            -CheckpointWriter { param($s) } | Out-Null
    } catch {
        if ($_.Exception.Message -match "Open implementation Pull Request\(s\) exist without a resumable supervisor checkpoint") {
            $nullStateWithPrCaught = $true
        }
    }
    if (-not $nullStateWithPrCaught) {
        throw "Null state with open implementation PR fail-closed test failed: expected exception."
    }

    # Finding 5 tests: Enforce one-nudge limit
    Assert-ShipDeSupervisorMaxNudges -MaxNudges 1

    foreach ($invalidNudges in @(0, -1, 2, 5)) {
        $nudgesCaught = $false
        try {
            Assert-ShipDeSupervisorMaxNudges -MaxNudges $invalidNudges
        } catch {
            $nudgesCaught = $true
        }
        if (-not $nudgesCaught) {
            throw "SupervisorMaxNudges rejection test failed for invalid value $invalidNudges."
        }
    }

    $structuredReviewFixture = '{"verdict":"CHANGES_REQUIRED","summary":"Changes required on error handling","findings":[{"priority":"P1","file":"test.ps1","line":10,"title":"Unhandled error","description":"Missing catch block"}],"report":"## Report`nMissing catch block`n`nVerdict: CHANGES_REQUIRED"}'
    $parsedStructuredReview = ConvertFrom-ShipDeCodexReviewOutput -OutputText $structuredReviewFixture
    if ($parsedStructuredReview.Verdict -ne "CHANGES_REQUIRED" -or [string]::IsNullOrWhiteSpace($parsedStructuredReview.Report)) {
        throw "Structured Codex review output parser compatibility test failed."
    }

    $unstructuredReviewRejected = $false
    try {
        ConvertFrom-ShipDeCodexReviewOutput -OutputText "Some human text review without valid JSON`n`nPASS" | Out-Null
    } catch {
        $unstructuredReviewRejected = $true
    }
    if (-not $unstructuredReviewRejected) {
        throw "Structured Codex review output parser failed shut test: unstructured text was accepted."
    }

    $stubPassRejected = $false
    try {
        ConvertFrom-ShipDeCodexReviewOutput -OutputText '{"verdict":"PASS"}' | Out-Null
    } catch {
        $stubPassRejected = $true
    }
    if (-not $stubPassRejected) {
        throw "Structured Codex review output parser failed shut test: stub PASS without summary/report was accepted."
    }

    $contradictoryPassRejected = $false
    try {
        ConvertFrom-ShipDeCodexReviewOutput -OutputText '{"verdict":"PASS","summary":"All good","report":"Full report","findings":[{"priority":"P1","file":"test.ps1","line":1,"title":"Bug","description":"Description"}]}' | Out-Null
    } catch {
        $contradictoryPassRejected = $true
    }
    if (-not $contradictoryPassRejected) {
        throw "Structured Codex review output parser failed shut test: contradictory PASS with P1 finding was accepted."
    }

    $realFailingReviewFixture = @"
The patch introduces multiple fail-open paths capable of accepting incomplete or stale review evidence, and its provider-routing policy is internally contradictory. Work Item validation and runtime version enforcement are also insufficient for the governed unattended workflow.

Full review comments:

- [P1] Reject review output that fails the declared schema — C:\Users\gumac\AI\shipde-codex\scripts\ai\control.ps1:683-685
  If Codex exits successfully but writes only `{"verdict":"PASS"}` or a plain final `PASS`, this parser accepts it despite the required summary/report fields, allowing an empty or malformed review to authorize the gate. Validate the complete payload against the schema and remove the non-schema fallbacks required to satisfy [AI-SUP-14 and AC-AI-60](docs/product-spec/work-items/TASK-AI-06.md#L173-L204).

- [P1] Fail closed when either GitHub evidence query fails — C:\Users\gumac\AI\shipde-codex\scripts\ai\control.ps1:1066-1067
  When the reviews API transiently fails, returns malformed data, or loses authentication, this branch silently skips it and can still return an older `PASS` from the comments query; the comments query suppresses failures similarly. Because multiple verdicts can exist for one head, incomplete evidence collection cannot establish the newest durable verdict and must stop fail-closed before satisfying the exact-HEAD merge rule in [AGENTS.md](AGENTS.md#L40-L41).
"@
    $proseWithActionableFindingsRejected = $false
    try {
        ConvertFrom-ShipDeCodexReviewOutput -OutputText $realFailingReviewFixture | Out-Null
    } catch {
        $proseWithActionableFindingsRejected = $true
    }
    if (-not $proseWithActionableFindingsRejected) {
        throw "Structured Codex review output parser failed shut test: non-schema prose with prioritized lines was accepted."
    }

    $missingFindingsRejected = $false
    try {
        ConvertFrom-ShipDeCodexReviewOutput -OutputText '{"verdict":"PASS","summary":"All gates and requirements verified.","report":"## Review Report`n`nAll checks passed."}' | Out-Null
    } catch {
        $missingFindingsRejected = $true
    }
    if (-not $missingFindingsRejected) {
        throw "Structured Codex review output parser failed shut test: missing findings property was accepted."
    }

    $extraPropertyRejected = $false
    try {
        ConvertFrom-ShipDeCodexReviewOutput -OutputText '{"verdict":"PASS","summary":"All gates and requirements verified.","findings":[],"report":"## Review Report`n`nAll checks passed.","unauthorizedProperty":"fail"}' | Out-Null
    } catch {
        $extraPropertyRejected = $true
    }
    if (-not $extraPropertyRejected) {
        throw "Structured Codex review output parser failed shut test: unauthorized property was accepted violating additionalProperties: false."
    }

    $validPassFixture = '{"verdict":"PASS","summary":"All gates and requirements verified.","findings":[],"report":"## Review Report`n`nAll checks passed."}'
    $parsedValidPass = ConvertFrom-ShipDeCodexReviewOutput -OutputText $validPassFixture
    if ($parsedValidPass.Verdict -ne "PASS" -or [string]::IsNullOrWhiteSpace($parsedValidPass.Summary) -or [string]::IsNullOrWhiteSpace($parsedValidPass.Report)) {
        throw "Valid structured PASS review output parser compatibility test failed."
    }

    if ($script:NineRouterPinnedVersion -ne "0.5.55") {
        throw "9Router pinned version compatibility test failed: expected 0.5.55."
    }

    $dismissedReviewFixture = [PSCustomObject]@{
        state = "DISMISSED"
        body = "Looks good!`n`nPASS"
        user = [PSCustomObject]@{ login = "chatgpt-codex-connector[bot]" }
        commit_id = "test-sha"
    }
    $dismissedVerdict = $null
    switch (([string]$dismissedReviewFixture.state).ToUpperInvariant()) {
        "APPROVED" { $dismissedVerdict = "PASS" }
        "CHANGES_REQUESTED" { $dismissedVerdict = "CHANGES_REQUIRED" }
        "COMMENTED" {
            $b = [string]$dismissedReviewFixture.body
            if ($b -match '(?i)(PASS|CHANGES_REQUIRED|BLOCKED)') { $dismissedVerdict = $matches[1] }
        }
    }
    if ($null -ne $dismissedVerdict) {
        throw "Dismissed review state compatibility test failed: DISMISSED was accepted as terminal evidence."
    }

    $conflictCand1 = [PSCustomObject]@{ Id = "1"; CreatedAt = [DateTime]::Parse("2026-09-06T00:00:00Z"); Verdict = "PASS" }
    $conflictCand2 = [PSCustomObject]@{ Id = "2"; CreatedAt = [DateTime]::Parse("2026-09-06T00:00:00Z"); Verdict = "CHANGES_REQUIRED" }
    $conflictCandidates = @($conflictCand1, $conflictCand2)
    $sortedConflict = @($conflictCandidates | Sort-Object -Property @{ Expression = { $_.CreatedAt }; Descending = $true }, @{ Expression = { $_.Id }; Descending = $true })
    $newestC = $sortedConflict[0]
    $equalTimeC = @($sortedConflict | Where-Object { $_.CreatedAt -eq $newestC.CreatedAt })
    $differingEqualTimeC = @($equalTimeC | Where-Object { $_.Verdict -ne $newestC.Verdict })
    if ($differingEqualTimeC.Count -eq 0) {
        throw "Equal-time verdict conflict compatibility test failed: expected rejection."
    }

    $stateRoundTrip = @{ TestField = "test-value"; NestedObject = @{ Inner = 123 } }
    $temporaryPath = Join-Path $env:TEMP "supervisor-test-$(Get-Random).json"
    try {
        $stateRoundTrip | ConvertTo-Json -Depth 10 | Set-Content -Path $temporaryPath -Encoding UTF8
        $restored = Get-Content $temporaryPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($restored.TestField -ne "test-value" -or $restored.NestedObject.Inner -ne 123) {
            throw "Supervisor checkpoint round-trip test failed."
        }

        # Test SPAWNING state intent persistence round-trip
        $spawningIntent = @{
            WorkItemId = "TASK-AI-06"
            Branch = "feat/task-ai-06-orchestrator-supervisor"
            State = "SPAWNING"
            StartTime = (Get-Date).ToUniversalTime().ToString("o")
        }
        $spawningIntent | ConvertTo-Json -Depth 5 | Set-Content -Path $temporaryPath -Encoding UTF8
        $restoredIntent = Get-Content $temporaryPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($restoredIntent.State -ne "SPAWNING" -or $restoredIntent.WorkItemId -ne "TASK-AI-06") {
            throw "Supervisor SPAWNING state checkpoint round-trip test failed."
        }
    } finally {
        if (Test-Path $temporaryPath) {
            Remove-Item $temporaryPath -Force
        }
    }

    if (Test-Path "AGENTS.md") {
        $rootAgentsText = Get-Content "AGENTS.md" -Raw -Encoding UTF8
        if ($rootAgentsText -notmatch "In unattended supervisor mode") {
            throw "Root AGENTS.md regression test failed: unattended supervisor contract harmonization missing."
        }
        if ($rootAgentsText -notmatch "final Pull Request merge") {
            throw "Root AGENTS.md regression test failed: human merge gate contract missing."
        }
    }

    $aiToolchainPath = "docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md"
    if (Test-Path $aiToolchainPath) {
        $aiToolchainContent = Get-Content $aiToolchainPath -Raw -Encoding UTF8
        if ($aiToolchainContent -match "every approved router fallback is treated as exhausted and delivery stops fail-closed") {
            throw "AI-TOOLCHAIN-DECISIONS.md policy regression test failed: contradictory fallback exhaustion statement found."
        }
        if ($aiToolchainContent -notmatch "In accordance with AI-SUP-18, bounded 9Router error records are diagnostic metadata") {
            throw "AI-TOOLCHAIN-DECISIONS.md policy regression test failed: AI-SUP-18 harmonization missing."
        }
    }
}

function Initialize-ShipDeSupervisorState {
    param(
        [object]$State,
        [scriptblock]$OpenPrResolver = { @(Get-ShipDeOpenPullRequests) },
        [scriptblock]$NextItemResolver = { Get-ShipDeNextPreparedItem },
        [scriptblock]$WorkerStarter = { param($item, $prompt) Start-ShipDeAoWorker -Item $item -Prompt $prompt },
        [scriptblock]$CheckpointWriter = { param($s) Write-ShipDeSupervisorCheckpoint -State $s },
        [scriptblock]$CodexParker = { Park-ShipDeCodex },
        [scriptblock]$ActiveWorkersResolver = {
            try {
                @(Get-ShipDeAoSessions -Project "shipde-platform" | Where-Object {
                    $isTerm = [bool](Get-ShipDeObjectProperty -Object $_ -Names @("isTerminated", "is_terminated"))
                    $role = [string](Get-ShipDeObjectProperty -Object $_ -Names @("role", "kind"))
                    (-not $isTerm) -and ($role -in @("worker", ""))
                })
            } catch { @() }
        }
    )

    $sessionId = $null
    $workItemId = $null
    $stateValue = $null
    $branch = $null
    $workItemPath = $null
    $author = $null

    if ($null -ne $State) {
        if ($State -is [System.Collections.IDictionary]) {
            if ($State.ContainsKey("SessionId")) { $sessionId = [string]$State["SessionId"] }
            if ($State.ContainsKey("WorkItemId")) { $workItemId = [string]$State["WorkItemId"] }
            if ($State.ContainsKey("State")) { $stateValue = [string]$State["State"] }
            if ($State.ContainsKey("Branch")) { $branch = [string]$State["Branch"] }
            if ($State.ContainsKey("WorkItemPath")) { $workItemPath = [string]$State["WorkItemPath"] }
            if ($State.ContainsKey("Author")) { $author = [string]$State["Author"] }
        } else {
            if ($null -ne $State.PSObject.Properties["SessionId"]) { $sessionId = [string]$State.SessionId }
            if ($null -ne $State.PSObject.Properties["WorkItemId"]) { $workItemId = [string]$State.WorkItemId }
            if ($null -ne $State.PSObject.Properties["State"]) { $stateValue = [string]$State.State }
            if ($null -ne $State.PSObject.Properties["Branch"]) { $branch = [string]$State.Branch }
            if ($null -ne $State.PSObject.Properties["WorkItemPath"]) { $workItemPath = [string]$State.WorkItemPath }
            if ($null -ne $State.PSObject.Properties["Author"]) { $author = [string]$State.Author }
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($sessionId) -and -not [string]::IsNullOrWhiteSpace($workItemId)) {
        Write-Host "[SUPERVISOR] Resuming $workItemId in AO session $sessionId."
        return $State
    }

    if (-not [string]::IsNullOrWhiteSpace($workItemId) -and $stateValue -eq "SPAWNING") {
        Write-Host "[SUPERVISOR] Resuming spawn intent for $workItemId on $branch."
        $item = [PSCustomObject]@{
            WorkItemId = $workItemId
            WorkItemPath = $workItemPath
            Branch = $branch
            Author = $author
        }
        $prompt = New-ShipDeAuthorPrompt -Item $item
        & $CodexParker
        $spawned = & $WorkerStarter $item $prompt
        if ($State -is [System.Collections.IDictionary]) {
            $State["Harness"] = $spawned.Harness
            $State["SessionId"] = $spawned.SessionId
            $State["State"] = "STARTED"
        } else {
            $State.Harness = $spawned.Harness
            $State.SessionId = $spawned.SessionId
            $State.State = "STARTED"
        }
        & $CheckpointWriter $State
        return $State
    }

    $openImplementationPullRequests = @(& $OpenPrResolver | Where-Object {
        Get-ShipDeWorkItemIdFromTitle -Title ([string]$_.title)
    })
    if ($openImplementationPullRequests.Count -gt 0) {
        $openSummary = @($openImplementationPullRequests | ForEach-Object {
            "#{0} {1}" -f $_.number, $_.title
        }) -join "; "
        throw "Open implementation Pull Request(s) exist without a resumable supervisor checkpoint: $openSummary. Resume or recover that Work Item before consuming another prepared row."
    }

    $activeAoWorkers = @(& $ActiveWorkersResolver)
    if ($activeAoWorkers.Count -gt 0) {
        $workerSummary = @($activeAoWorkers | ForEach-Object { Get-ShipDeAoSessionId -Response $_ }) -join ", "
        throw "Active or idle AO worker session(s) exist without a resumable checkpoint ($workerSummary). Resume or recover that session before consuming another prepared row."
    }

    $item = & $NextItemResolver
    if (-not $item) {
        Write-Host "[SUPERVISOR] No prepared dependency-ready remote Work Item exists."
        return $null
    }

    $State = @{
        WorkItemId = $item.WorkItemId
        WorkItemPath = $item.WorkItemPath
        Branch = $item.Branch
        Author = $item.Author
        State = "SPAWNING"
        StartTime = (Get-Date).ToUniversalTime().ToString("o")
        LastActivityTime = (Get-Date).ToUniversalTime().ToString("o")
        NudgeCount = 0
    }
    & $CheckpointWriter $State

    $prompt = New-ShipDeAuthorPrompt -Item $item
    & $CodexParker
    $spawned = & $WorkerStarter $item $prompt
    $State.Harness = $spawned.Harness
    $State.SessionId = $spawned.SessionId
    $State.State = "STARTED"
    & $CheckpointWriter $State
    return $State
}

function Invoke-ShipDeSupervise {
    Write-Host "SHIP DE DETERMINISTIC ORCHESTRATOR SUPERVISOR"
    Assert-ShipDeSupervisorMaxNudges -MaxNudges $SupervisorMaxNudges
    Assert-ShipDeAoCommand
    Assert-ShipDeAoVersion
    Ensure-ShipDeAgentRouterRuntime

    $state = Read-ShipDeSupervisorCheckpoint
    $state = Initialize-ShipDeSupervisorState -State $state
    if ($null -eq $state) {
        return
    }

    $result = Invoke-ShipDeSupervisorLoop -State $state -PollIntervalSeconds $SupervisorPollIntervalSeconds -InactivityTimeoutMinutes $SupervisorInactivityTimeoutMinutes -MaxNudges $SupervisorMaxNudges -ReviewTimeoutMinutes $SupervisorReviewTimeoutMinutes

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
    if ($PullRequestNumber -gt 0) {
        $pullRequests = @($pullRequests | Where-Object { [int]$_.number -eq $PullRequestNumber })
        if ($pullRequests.Count -eq 0) {
            throw "Open implementation Pull Request #$PullRequestNumber was not found."
        }
    }
    if ($pullRequests.Count -gt 1) {
        throw "More than one active implementation Pull Request exists. Supply -PullRequestNumber to select one exact review target."
    }

    if ($pullRequests.Count -eq 1) {
        $pr = $pullRequests[0]
        $item = Get-ShipDePrWorkItem -PullRequest $pr
        if (-not $item) {
            throw "Cannot resolve governed Work Item assignment for PR #$($pr.number)."
        }
        Assert-ShipDeGovernedPullRequest -PullRequest $pr -WorkItemId $item.WorkItemId -Branch $item.Branch -ExpectedRepository $Repository

        $headSha = if ($pr.headRefOid) { [string]$pr.headRefOid } else { "" }
        if ([string]::IsNullOrWhiteSpace($headSha)) {
            try {
                $headSha = (& gh pr view ([int]$pr.number) --repo $Repository --json headRefOid --jq .headRefOid 2>$null)
                if ($headSha) { $headSha = $headSha.Trim() }
            } catch {}
        }

        $exactVerdict = Get-ShipDeExactHeadCodexVerdict -PullRequestNumber ([int]$pr.number) -HeadSha $headSha
        if ($exactVerdict -eq "CHANGES_REQUIRED") {
            Write-Host ("PR #{0} has exact-head Codex verdict CHANGES_REQUIRED for head {1}." -f $pr.number, $headSha)
            Write-Host ("Routing to fix round for {0}..." -f $item.Author)
            Start-ShipDeFixRound -PullRequest $pr -Item $item
            return
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
