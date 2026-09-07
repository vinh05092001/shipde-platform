param(
    [ValidateSet("Menu", "Resume", "Status", "Prepare", "Start", "Review", "Sync", "Supervise", "Test")]
    [string]$Action = "Menu",

    [string]$Repository = "vinh05092001/shipde-platform",
    [string]$AiRoot = $(
        $userHome = if (-not [string]::IsNullOrWhiteSpace($env:USERPROFILE)) { $env:USERPROFILE } elseif (-not [string]::IsNullOrWhiteSpace($env:HOME)) { $env:HOME } else { [System.IO.Path]::GetTempPath() }
        Join-Path $userHome "AI"
    ),

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
$script:TrustedCodexReviewerLogins = @("chatgpt-codex-connector[bot]")
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

    # Windows PowerShell 5.1 emits a JSON array as one pipeline object.
    # PowerShell Core (6+) unrolls pipeline arrays by default, unrolling [null] to a bare $null.
    # Passing -NoEnumerate on Core or assigning directly on Windows PowerShell 5.1 preserves
    # the underlying array structure across both runtime environments.
    $parsed = if ($PSVersionTable.PSVersion.Major -ge 6) {
        ConvertFrom-Json -InputObject $Json -NoEnumerate
    } else {
        $Json | ConvertFrom-Json
    }
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

    $prQuery = @'
query($owner: String!, $name: String!, $base: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, baseRefName: $base, first: 50, after: $after) {
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
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
}
'@

    $prNodes = [System.Collections.Generic.List[object]]::new()
    $hasMorePrs = $true
    $prCursor = $null

    while ($hasMorePrs) {
        $prArgs = @(
            "api", "graphql",
            "-F", "owner=$owner",
            "-F", "name=$repoName",
            "-F", "base=main"
        )
        if (-not [string]::IsNullOrWhiteSpace($prCursor)) {
            $prArgs += @("-F", "after=$prCursor")
        }
        $prArgs += @("-f", "query=$prQuery")

        $raw = @(& gh @prArgs 2>$null)
        if ($LASTEXITCODE -ne 0 -or $raw.Count -eq 0) {
            throw "Cannot read open Pull Requests from GitHub via paginated GraphQL API."
        }
        $pageData = (($raw -join [Environment]::NewLine) | ConvertFrom-Json)
        $conn = $pageData.data.repository.pullRequests
        if ($conn -and $conn.nodes) {
            foreach ($n in @($conn.nodes)) {
                if ($n) { $prNodes.Add($n) }
            }
        }
        $hasMorePrs = [bool]($conn.pageInfo.hasNextPage)
        $prCursor = [string]($conn.pageInfo.endCursor)
    }

    foreach ($node in $prNodes) {
        if ($null -eq $node) { continue }

        $checks = [System.Collections.Generic.List[object]]::new()
        if (-not [string]::IsNullOrWhiteSpace([string]$node.headRefOid)) {
            $contextsQuery = @'
query($owner: String!, $name: String!, $oid: GitObjectID!, $after: String) {
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
                  app {
                    slug
                    name
                  }
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
            $hasMoreContexts = $true
            $contextsCursor = $null
            while ($hasMoreContexts) {
                $ctxArgs = @(
                    "api", "graphql",
                    "-F", "owner=$owner",
                    "-F", "name=$repoName",
                    "-F", "oid=$([string]$node.headRefOid)"
                )
                if (-not [string]::IsNullOrWhiteSpace($contextsCursor)) {
                    $ctxArgs += @("-F", "after=$contextsCursor")
                }
                $ctxArgs += @("-f", "query=$contextsQuery")

                $rawCtx = @(& gh @ctxArgs 2>$null)
                if ($LASTEXITCODE -ne 0 -or $rawCtx.Count -eq 0) {
                    throw "Cannot exhaust nested status check contexts for commit $([string]$node.headRefOid)."
                }
                $ctxData = (($rawCtx -join [Environment]::NewLine) | ConvertFrom-Json)
                $commitObj = $ctxData.data.repository.object
                if ($commitObj -and
                    $commitObj.PSObject.Properties['statusCheckRollup'] -and
                    $commitObj.statusCheckRollup -and
                    $commitObj.statusCheckRollup.PSObject.Properties['contexts'] -and
                    $commitObj.statusCheckRollup.contexts) {
                    $contextsConn = $commitObj.statusCheckRollup.contexts
                    if ($contextsConn.nodes) {
                        foreach ($ctx in @($contextsConn.nodes)) {
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
                    $hasMoreContexts = [bool]($contextsConn.pageInfo.hasNextPage)
                    $contextsCursor = [string]($contextsConn.pageInfo.endCursor)
                } else {
                    $hasMoreContexts = $false
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

    $typeName = (Get-ShipDeCheckField -Check $Check -Field "__typename").ToLowerInvariant()
    $hasDetailsUrl = -not [string]::IsNullOrWhiteSpace((Get-ShipDeCheckField -Check $Check -Field "detailsUrl"))
    $hasTargetUrl = -not [string]::IsNullOrWhiteSpace((Get-ShipDeCheckField -Check $Check -Field "targetUrl"))

    # Legacy commit status contexts are not authentic GitHub Actions CheckRuns.
    # Their targetUrl is caller-supplied and must never be treated as proof of GitHub Actions provenance.
    if ($typeName -eq "statuscontext" -or ($hasTargetUrl -and -not $hasDetailsUrl)) {
        $urlText = Get-ShipDeCheckField -Check $Check -Field "targetUrl"
        $uri = $null
        if (-not [string]::IsNullOrWhiteSpace($urlText) -and [Uri]::TryCreate($urlText, [UriKind]::Absolute, [ref]$uri)) {
            return "status-context/$($uri.Host.ToLowerInvariant())"
        }
        return "status-context"
    }

    $appSlug = $null
    $appName = $null
    try {
        if ($Check.checkSuite -and $Check.checkSuite.app) {
            $appSlug = [string](Get-ShipDeObjectProperty -Object $Check.checkSuite.app -Names @("slug"))
            $appName = [string](Get-ShipDeObjectProperty -Object $Check.checkSuite.app -Names @("name"))
        }
    } catch {}

    $hasApp = (-not [string]::IsNullOrWhiteSpace($appSlug)) -or (-not [string]::IsNullOrWhiteSpace($appName))
    $isAppGitHubActions = (-not [string]::IsNullOrWhiteSpace($appSlug) -and $appSlug.ToLowerInvariant() -eq "github-actions") -or
                          (-not [string]::IsNullOrWhiteSpace($appName) -and $appName -ieq "GitHub Actions")

    # If an app identity is explicitly present and is NOT GitHub Actions, reject immediately.
    # A caller-controlled detailsUrl or check name must NEVER forge GitHub Actions provenance.
    if ($hasApp -and -not $isAppGitHubActions) {
        if (-not [string]::IsNullOrWhiteSpace($appSlug)) { return $appSlug.ToLowerInvariant() }
        return $appName.ToLowerInvariant()
    }

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

    if ($isAppGitHubActions) {
        return "github-actions"
    }

    $urlText = Get-ShipDeCheckField -Check $Check -Field "detailsUrl"
    if (-not [string]::IsNullOrWhiteSpace($urlText)) {
        $uri = $null
        if ([Uri]::TryCreate($urlText, [UriKind]::Absolute, [ref]$uri)) {
            return $uri.Host.ToLowerInvariant()
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($typeName)) {
        return $typeName
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
    } catch {
        throw "Codex review output does not contain valid structured JSON satisfying the review schema."
    }

    if (-not $jsonCandidate -or $jsonCandidate -isnot [PSCustomObject]) {
        throw "Codex review output does not contain valid structured JSON satisfying the review schema."
    }

    # Validate additionalProperties: false on the root object
    $allowedRootProperties = @("verdict", "summary", "findings", "report")
    $rootProperties = @($jsonCandidate.PSObject.Properties)
    $rootPropertyNames = @($rootProperties | ForEach-Object { $_.Name })
    foreach ($name in $rootPropertyNames) {
        if (-not ($allowedRootProperties -ccontains $name)) {
            throw "Codex review output contains unauthorized property '$name' violating additionalProperties: false."
        }
    }

    # Validate required properties
    foreach ($required in $allowedRootProperties) {
        if (-not ($rootPropertyNames -ccontains $required)) {
            throw "Codex review output is missing required property '$required'."
        }
    }

    # Validate verdict
    $verdictProp = $jsonCandidate.PSObject.Properties['verdict']
    if ($null -eq $verdictProp -or $null -eq $verdictProp.Value -or $verdictProp.Value -isnot [string]) {
        throw "Codex review verdict must be a non-null string."
    }
    $verdict = [string]$verdictProp.Value
    if (-not (@("PASS", "CHANGES_REQUIRED", "BLOCKED") -ccontains $verdict)) {
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
            if (-not ($allowedFindingProperties -ccontains $fName)) {
                throw "Codex review finding contains unauthorized property '$fName' violating additionalProperties: false."
            }
        }
        foreach ($reqFinding in $allowedFindingProperties) {
            if (-not ($findingPropertyNames -ccontains $reqFinding)) {
                throw "Codex review finding is missing required property '$reqFinding'."
            }
        }

        # Validate priority enum
        $priorityProp = $finding.PSObject.Properties['priority']
        if ($null -eq $priorityProp -or $null -eq $priorityProp.Value -or $priorityProp.Value -isnot [string]) {
            throw "Codex review finding priority must be a string."
        }
        $p = [string]$priorityProp.Value
        if (-not (@("P1", "P2", "P3") -ccontains $p)) {
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
        if ($lineVal -isnot [int] -and $lineVal -isnot [long]) {
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
        Findings = $findings
    }
}

function Get-ShipDeCodexReviewArgs {
    param(
        [Parameter(Mandatory = $true)][string]$SchemaFile,
        [Parameter(Mandatory = $true)][string]$LastMessageFile
    )

    return @("exec", "--sandbox", "read-only", "--output-schema", $SchemaFile, "--output-last-message", $LastMessageFile, "-")
}

function Invoke-ShipDeReview {
    param(
        [int]$PullRequestNumber = 0,
        [switch]$NonInteractive,
        [string]$HandoffRoot = "",
        [scriptblock]$GitPreparer = $null,
        [scriptblock]$CodexExecutor = $null,
        [scriptblock]$CodexInvoker = $null,
        [scriptblock]$CommentPoster = $null,
        [scriptblock]$OpenPrResolver = $null,
        [scriptblock]$PrByNumberResolver = $null,
        [scriptblock]$ItemResolver = $null,
        [scriptblock]$CurrentGhUserResolver = $null
    )
    if ($null -eq $CodexInvoker -and $null -eq $CodexExecutor) {
        Assert-ShipDeCommand codex
    }
    Assert-ShipDeCommand gh

    $targetPrNumber = if ($PullRequestNumber -gt 0) { $PullRequestNumber } elseif ($script:PullRequestNumber -gt 0) { $script:PullRequestNumber } else { 0 }
    $openPrs = if ($null -ne $OpenPrResolver) { @(& $OpenPrResolver) } else { @(Get-ShipDeOpenPullRequests) }
    $pullRequests = @($openPrs | Where-Object {
        Get-ShipDeWorkItemIdFromTitle -Title ([string]$_.title)
    })
    if ($targetPrNumber -gt 0) {
        $pullRequests = @($pullRequests | Where-Object { [int]$_.number -eq $targetPrNumber })
        if ($pullRequests.Count -eq 0) {
            throw "Open implementation Pull Request #$targetPrNumber was not found."
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
    $item = if ($null -ne $ItemResolver) { & $ItemResolver $pr } else { Get-ShipDePrWorkItem -PullRequest $pr }
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

    if ($null -ne $GitPreparer) {
        & $GitPreparer $pr $reviewHeadSha
    } else {
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

        $currentPr = if ($null -ne $PrByNumberResolver) { & $PrByNumberResolver ([int]$pr.number) } else { Get-ShipDePullRequestByNumber -Number ([int]$pr.number) }
        Assert-ShipDeReviewTarget -PullRequest $currentPr -ExpectedHeadSha $reviewHeadSha
        Invoke-ShipDeGit -Path $script:Paths.Codex -Arguments @("switch", "--detach", $reviewHeadSha) | Out-Null

        $detachedHeadSha = (& git -C $script:Paths.Codex rev-parse HEAD).Trim()
        if ($LASTEXITCODE -ne 0 -or $detachedHeadSha -ne $reviewHeadSha) {
            throw "Codex worktree is not detached at the approved head $reviewHeadSha."
        }
    }

    $effectiveHandoffRoot = if (-not [string]::IsNullOrWhiteSpace($HandoffRoot)) { $HandoffRoot } else { $script:HandoffRoot }
    New-Item -ItemType Directory -Path $effectiveHandoffRoot -Force | Out-Null
    $reviewStem = "pr-{0}-{1}-codex-review" -f $pr.number, $reviewHeadSha.Substring(0, 8)
    $reviewFile = Join-Path $effectiveHandoffRoot "$reviewStem.txt"
    $schemaFile = Join-Path $effectiveHandoffRoot "$reviewStem-schema.json"
    $diagnosticFile = Join-Path $effectiveHandoffRoot "$reviewStem-diagnostics.txt"
    $executionFile = Join-Path $effectiveHandoffRoot "$reviewStem-execution.txt"
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
    $codexArgs = Get-ShipDeCodexReviewArgs -SchemaFile $schemaFile -LastMessageFile $reviewFile
    if ($null -ne $CodexInvoker) {
        $exitCode = & $CodexInvoker $codexArgs $reviewPrompt $schemaFile $reviewFile $executionFile $diagnosticFile
        if ($null -eq $exitCode) { $exitCode = 0 }
    } elseif ($null -ne $CodexExecutor) {
        & $CodexExecutor $schemaFile $reviewFile $executionFile $diagnosticFile
        $exitCode = 0
    } else {
        $previousErrorActionPreference = $ErrorActionPreference
        Push-Location $script:Paths.Codex
        try {
            # Non-interactive Codex execution with machine-readable structured output schema.
            # Use read-only sandbox and stdin for the review prompt.
            $ErrorActionPreference = "Continue"
            $reviewPrompt | & codex @codexArgs 1> $executionFile 2> $diagnosticFile
            $exitCode = $LASTEXITCODE
        } finally {
            $ErrorActionPreference = $previousErrorActionPreference
            Pop-Location
        }
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

    $parsedResult = $null
    try {
        $parsedResult = ConvertFrom-ShipDeCodexReviewOutput -OutputText $rawReviewText
    } catch {
        throw "$($_.Exception.Message) Diagnostics: $diagnosticFile"
    }
    $verdict = $parsedResult.Verdict
    $reviewText = $parsedResult.Report

    if ($parsedResult.Findings -and $parsedResult.Findings.Count -gt 0) {
        $missingFindings = @()
        foreach ($f in $parsedResult.Findings) {
            $marker = "{0}:{1}" -f $f.file, $f.line
            if ($reviewText -notmatch [regex]::Escape($marker)) {
                $missingFindings += $f
            }
        }
        if ($missingFindings.Count -gt 0) {
            $formattedMissing = @(
                $missingFindings | ForEach-Object {
                    "- [{0}] {1} - {2}:{3}`n  {4}" -f $_.priority, $_.title, $_.file, $_.line, $_.description
                }
            ) -join "`n`n"
            $reviewText = $reviewText + [Environment]::NewLine + [Environment]::NewLine + "### Structured Findings" + [Environment]::NewLine + [Environment]::NewLine + $formattedMissing
        }
    }

    $currentPr = if ($null -ne $PrByNumberResolver) { & $PrByNumberResolver ([int]$pr.number) } else { Get-ShipDePullRequestByNumber -Number ([int]$pr.number) }
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
            $commentFile = Join-Path $effectiveHandoffRoot (
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

    $item = if ($null -ne $ItemResolver) { & $ItemResolver $pr } else { Get-ShipDePrWorkItem -PullRequest $pr }
    $currentGhUser = ""
    try {
        if ($null -ne $CurrentGhUserResolver) {
            $currentGhUser = (& $CurrentGhUserResolver)
        } else {
            $currentGhUser = (& gh api user --jq .login 2>$null)
        }
        if ($currentGhUser) { $currentGhUser = $currentGhUser.Trim() }
    } catch {}
    $prAuthor = [string](Get-ShipDeObjectProperty -Object $pr -Names @("author"))
    $itemAuthor = if ($item) { [string](Get-ShipDeObjectProperty -Object $item -Names @("Author", "author")) } else { "" }
    $isAuthor = (-not [string]::IsNullOrWhiteSpace($currentGhUser)) -and (
        (![string]::IsNullOrWhiteSpace($prAuthor) -and $prAuthor -ieq $currentGhUser) -or
        (![string]::IsNullOrWhiteSpace($itemAuthor) -and $itemAuthor -ieq $currentGhUser)
    )
    $isTrustedReviewer = (-not [string]::IsNullOrWhiteSpace($currentGhUser)) -and ($script:TrustedCodexReviewerLogins -contains $currentGhUser)

    $shouldPost = $false
    if ($null -ne $CommentPoster) {
        $shouldPost = $true
    } elseif ($isAuthor) {
        Write-Warning "The review was executed under the PR/implementation author account ($currentGhUser). Under repository governance, an author cannot approve their own work or post authoritative Codex review verdicts. Skipping posting to GitHub to prevent invalid durable evidence."
        $shouldPost = $false
    } elseif (-not $isTrustedReviewer) {
        if ($NonInteractive) {
            Write-Warning "The active GitHub user '$currentGhUser' is not in the trusted Codex reviewer allowlist ($($script:TrustedCodexReviewerLogins -join ', ')). Skipping posting to GitHub to prevent unauthoritative review pollution."
            $shouldPost = $false
        } else {
            Write-Warning "The active GitHub user '$currentGhUser' is not in the trusted Codex reviewer allowlist ($($script:TrustedCodexReviewerLogins -join ', ')). A posted review will be non-authoritative."
            $post = Read-Host "Post the non-authoritative Codex review to PR #$($pr.number) anyway? (Y/N)"
            $shouldPost = ($post -match '(?i)^y(?:es)?$')
        }
    } else {
        if ($NonInteractive) {
            $shouldPost = $true
        } else {
            $post = Read-Host "Post the complete Codex review to PR #$($pr.number)? (Y/N)"
            $shouldPost = ($post -match '(?i)^y(?:es)?$')
        }
    }
    if ($shouldPost) {
        foreach ($commentFile in $commentFiles) {
            if ($null -ne $CommentPoster) {
                & $CommentPoster ([int]$pr.number) $commentFile
            } else {
                & gh pr comment $pr.number --repo $Repository --body-file $commentFile
                if ($LASTEXITCODE -ne 0) {
                    throw "Could not post every review comment. Local review files are preserved."
                }
            }
        }
    }

    if ($verdict -eq "CHANGES_REQUIRED") {
        if ($item -and -not $NonInteractive) {
            $fix = Read-Host "Return findings to $($item.Author) now? (Y/N)"
            if ($fix -match '(?i)^y(?:es)?$') {
                Start-ShipDeFixRound -PullRequest $pr -Item $item
            }
        }
    } elseif ($verdict -eq "PASS") {
        Write-Host ([string]$pr.url)
        if ($isAuthor) {
            Write-Warning "PASS verdict was derived by the PR/implementation author ($currentGhUser). Under repository governance, an author cannot approve their own work. This review is non-authoritative and does not satisfy the independent Codex review gate."
        } elseif (-not $isTrustedReviewer) {
            Write-Warning "PASS verdict was derived under '$currentGhUser', which is outside the trusted Codex reviewer allowlist ($($script:TrustedCodexReviewerLogins -join ', ')). It will not be recognized as trusted durable evidence by the supervisor."
        } else {
            Write-Host "PASS recorded for the immutable head above. Only the human merge owner may merge."
        }
    }

    return $verdict
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

    # 2. Enumerate GitHub PR comments with pagination to exhaustion
    $rawComments = @(& gh api "repos/$Repository/issues/$PullRequestNumber/comments" --paginate --slurp 2>$null)
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to query GitHub Pull Request comments for PR #$PullRequestNumber."
    }
    if ($rawComments.Count -gt 0) {
        try {
            $commentPages = (($rawComments -join [Environment]::NewLine) | ConvertFrom-Json)
        } catch {
            throw "Failed to parse GitHub Pull Request comments response for PR #$($PullRequestNumber): $($_.Exception.Message)"
        }
        foreach ($page in @($commentPages)) {
            foreach ($commentObj in @($page)) {
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

function Get-ShipDeGitHubExactHeadCodexFindings {
    param(
        [Parameter(Mandatory = $true)][int]$PullRequestNumber,
        [Parameter(Mandatory = $true)][string]$HeadSha,
        [string]$Repository = "vinh05092001/shipde-platform"
    )

    $findingsList = [System.Collections.Generic.List[string]]::new()

    $rawReviews = @(& gh api "repos/$Repository/pulls/$PullRequestNumber/reviews" --paginate --slurp 2>$null)
    if ($LASTEXITCODE -eq 0 -and $rawReviews.Count -gt 0) {
        try {
            $pages = (($rawReviews -join [Environment]::NewLine) | ConvertFrom-Json)
            foreach ($page in @($pages)) {
                foreach ($review in @($page)) {
                    if ([string]$review.commit_id -ine $HeadSha) { continue }
                    $login = [string]$review.user.login
                    if ($script:TrustedCodexReviewerLogins -notcontains $login) { continue }
                    $body = [string]$review.body
                    if (-not [string]::IsNullOrWhiteSpace($body)) {
                        $findingsList.Add($body)
                    }
                }
            }
        } catch {}
    }

    $rawComments = @(& gh api "repos/$Repository/issues/$PullRequestNumber/comments" --paginate --slurp 2>$null)
    if ($LASTEXITCODE -eq 0 -and $rawComments.Count -gt 0) {
        try {
            $commentPages = (($rawComments -join [Environment]::NewLine) | ConvertFrom-Json)
            foreach ($page in @($commentPages)) {
                foreach ($commentObj in @($page)) {
                    $author = Get-ShipDeObjectProperty -Object $commentObj -Names @("author", "user")
                    $authorLogin = [string](Get-ShipDeObjectProperty -Object $author -Names @("login"))
                    if ($script:TrustedCodexReviewerLogins -notcontains $authorLogin) { continue }
                    $body = [string]$commentObj.body
                    if (-not [string]::IsNullOrWhiteSpace($body) -and $body -match [regex]::Escape($HeadSha)) {
                        $findingsList.Add($body)
                    }
                }
            }
        } catch {}
    }

    if ($findingsList.Count -gt 0) {
        return $findingsList[-1]
    }
    return ""
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

    # Recover exact-commit verdict from GitHub durable review and comment records
    # using newest trusted bot evidence (chatgpt-codex-connector[bot]), rejecting equal-time conflicts.
    # Local Codex CLI / AO results are diagnostic only and must not authorize durable PASS or advance state.
    $githubVerdict = Get-ShipDeGitHubExactHeadCodexVerdict -PullRequestNumber $PullRequestNumber -HeadSha $HeadSha
    if ($githubVerdict) {
        return $githubVerdict
    }

    return $null
}

function Get-ShipDeMergedPullRequests {
    # Query and validate every merged Pull Request before synchronization
    # mutates any worktree. This is the fail-before-sync preflight boundary.
    Assert-ShipDeCommand gh

    $repoParts = $Repository -split '/'
    if ($repoParts.Count -ne 2) {
        throw "Repository must use the owner/name format before reading merged Pull Requests."
    }
    $owner = $repoParts[0]
    $repoName = $repoParts[1]

    $query = @'
query($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: MERGED, baseRefName: "main", first: 50, after: $after) {
      nodes {
        number
        title
        headRefName
        headRefOid
        mergeCommit {
          oid
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

    $mergedNodes = [System.Collections.Generic.List[object]]::new()
    $hasMore = $true
    $cursor = $null

    while ($hasMore) {
        $ghArgs = @(
            "api", "graphql",
            "-F", "owner=$owner",
            "-F", "name=$repoName"
        )
        if (-not [string]::IsNullOrWhiteSpace($cursor)) {
            $ghArgs += @("-F", "after=$cursor")
        }
        $ghArgs += @("-f", "query=$query")

        $raw = @(& gh @ghArgs 2>$null)
        if ($LASTEXITCODE -ne 0 -or $raw.Count -eq 0) {
            throw "Cannot read merged Pull Requests from GitHub via paginated GraphQL API."
        }
        $pageData = (($raw -join [Environment]::NewLine) | ConvertFrom-Json)
        $conn = $pageData.data.repository.pullRequests
        if ($conn -and $conn.nodes) {
            foreach ($n in @($conn.nodes)) {
                if ($n) { $mergedNodes.Add($n) }
            }
        }
        $hasMore = [bool]($conn.pageInfo.hasNextPage)
        $cursor = [string]($conn.pageInfo.endCursor)
    }

    $json = $mergedNodes | ConvertTo-Json -Depth 5
    return @(ConvertFrom-ShipDeMergedPullRequestList -Json $json)
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
$script:SupervisorLockFile = Join-Path $script:HandoffRoot "supervisor.lock"
$script:AoRouterRuntimeFile = Join-Path $script:HandoffRoot "ao-router-runtime.json"
$script:AgentRouterProfile = Join-Path (Get-ShipDeUserHome) ".claude"
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
        if ($PSVersionTable.PSVersion.Major -ge 6) {
            $val = ConvertFrom-Json -InputObject $Json -NoEnumerate
        } else {
            $val = $Json | ConvertFrom-Json
        }
        return ,$val
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
    if ($null -eq $aoProcess) {
        throw "AO router runtime marker process ID $processId is not running. Restart AO through the governed launcher."
    }
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

function ConvertFrom-ShipDeAoSessionResponse {
    param(
        [Parameter(Mandatory = $true)][AllowNull()][object]$Response
    )

    if ($null -eq $Response) {
        throw "AO session ls JSON does not contain a session collection."
    }

    # Explicit Shape 1: Top-level array of sessions
    if ($Response -is [System.Array]) {
        return @($Response)
    }

    if (-not ($Response -is [System.Management.Automation.PSCustomObject] -or $Response -is [System.Collections.IDictionary])) {
        throw "AO session ls JSON does not contain a session collection."
    }

    # If the response is a single worker/session record (e.g. unrolled single-item array from bare JSON)
    $hasSessionId = ($null -ne (Get-ShipDeObjectProperty -Object $Response -Names @("id", "sessionId", "session_id")))
    $hasSessionRole = ($null -ne (Get-ShipDeObjectProperty -Object $Response -Names @("role", "kind", "harness", "status", "state")))
    if ($hasSessionId -and $hasSessionRole) {
        return @($Response)
    }

    # Explicit Shape 2: Observed AO 0.12.12 response { "data": [ ... ], "meta": ... }
    # or nested { "data": { "sessions": [ ... ] } } / { "data": { "items": [ ... ] } }
    $dataProp = $Response.PSObject.Properties["data"]
    if ($null -ne $dataProp) {
        $val = $dataProp.Value
        if ($val -is [System.Array]) {
            return @($val)
        }
        if ($val -is [System.Management.Automation.PSCustomObject]) {
            foreach ($nestedName in @("sessions", "items")) {
                $nestedProp = $val.PSObject.Properties[$nestedName]
                if ($null -ne $nestedProp -and $nestedProp.Value -is [System.Array]) {
                    return @($nestedProp.Value)
                }
            }
        }
    }

    # Explicit Shape 3: Direct { "sessions": [ ... ] } or { "items": [ ... ] }
    foreach ($propName in @("sessions", "items")) {
        $prop = $Response.PSObject.Properties[$propName]
        if ($null -ne $prop -and $prop.Value -is [System.Array]) {
            return @($prop.Value)
        }
    }

    # Explicit Shape 4: Wrapped { "result": [ ... ] } or { "result": { "sessions" | "items" | "data": [ ... ] } }
    $resultProp = $Response.PSObject.Properties["result"]
    if ($null -ne $resultProp) {
        $rVal = $resultProp.Value
        if ($rVal -is [System.Array]) {
            return @($rVal)
        }
        if ($rVal -is [System.Management.Automation.PSCustomObject]) {
            foreach ($nestedName in @("sessions", "items", "data")) {
                $nestedProp = $rVal.PSObject.Properties[$nestedName]
                if ($null -ne $nestedProp -and $nestedProp.Value -is [System.Array]) {
                    return @($nestedProp.Value)
                }
            }
        }
    }

    throw "AO session ls JSON does not contain a session collection."
}

function Get-ShipDeAoSessions {
    param(
        [string]$Project = "shipde-platform",
        [scriptblock]$TextResolver = $null
    )

    $text = if ($null -ne $TextResolver) {
        & $TextResolver $Project
    } else {
        $output = @(& (Get-ShipDeAoInvocationPath) session ls --project $Project --json 2>&1)
        $exitCode = $LASTEXITCODE
        $rawText = Join-ShipDeNativeOutput -Output $output
        if ($exitCode -ne 0) {
            throw "Cannot query AO sessions for project '$Project': $rawText"
        }
        $rawText
    }

    $response = ConvertFrom-ShipDeAoJson -Json $text -Operation "session ls"
    return @(ConvertFrom-ShipDeAoSessionResponse -Response $response)
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
        $canonicalWorktree = Join-Path (Get-ShipDeAoWorktreesDir -Project $Project) $sessionId
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
        [string]$Harness = "",
        [string]$Project = "shipde-platform",
        [switch]$DryRun
    )

    $candidates = if (-not [string]::IsNullOrWhiteSpace($Harness)) { @($Harness) } else { @(Get-ShipDeAoHarnessCandidates -Author $Item.Author) }

    if ($DryRun) {
        $candidate = $candidates[0]
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
            $status = [string](Get-ShipDeObjectProperty -Object $session -Names @("status", "state"))
            if ($status -in @("exited", "terminated", "failed", "completed", "stopped", "pr_open", "parked")) { return $false }
            $role = [string](Get-ShipDeObjectProperty -Object $session -Names @("role", "kind"))
            if ($role -notin @("worker", "")) { return $false }

            $sessionName = Get-ShipDeAoSessionName -Session $session
            if ($sessionName -eq $expectedName) { return $true }

            $sid = Get-ShipDeAoSessionId -Response $session
            if (-not [string]::IsNullOrWhiteSpace($sid)) {
                $candidateWorktree = Join-Path (Get-ShipDeAoWorktreesDir -Project $Project) $sid
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
    foreach ($harness in $candidates) {
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
                    $verifiedHarness = Assert-ShipDeReusedAoSession -SessionDetail $spawnedSession -Item $Item -AllowedHarnesses @($harness) -Project $Project
                    return [PSCustomObject]@{
                        SessionId = $sessionId
                        Harness = $verifiedHarness
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

function Normalize-ShipDeSupervisorState {
    param([AllowNull()][object]$State)

    if ($null -eq $State) {
        return $null
    }

    $now = (Get-Date).ToUniversalTime().ToString("o")
    $normalized = @{
        WorkItemId = ""
        WorkItemPath = ""
        Branch = ""
        Author = ""
        SessionId = $null
        Harness = $null
        State = "STARTED"
        PullRequestNumber = $null
        HeadSha = $null
        StartTime = $now
        LastActivityTime = $now
        CheckpointTime = $now
        NudgeCount = 0
        UnknownPollCount = 0
        RepairCount = 0
        ProviderFailure = $false
        CiGate = $null
        ExactHeadVerdict = $null
        LastCiRepairHead = $null
        LastAcknowledgedCiRepairHead = $null
        LastReviewRepairHead = $null
        LastAcknowledgedReviewRepairHead = $null
        LastReviewTriggeredHead = $null
        LastAcknowledgedReviewTriggerHead = $null
        LastReviewTriggeredAt = $null
        ReviewRequestCommentId = $null
        LastRepairDispatchedAt = $null
        PendingDispatch = $null
        RouterFailure = $null
    }

    if ($State -is [System.Collections.IDictionary]) {
        foreach ($key in $normalized.Keys) {
            if (-not $State.Contains($key)) {
                $State[$key] = $normalized[$key]
            }
        }
        return $State
    } else {
        foreach ($prop in $State.PSObject.Properties) {
            $normalized[$prop.Name] = $prop.Value
        }
    }

    return $normalized
}

function Write-ShipDeSupervisorCheckpoint {
    param([Parameter(Mandatory = $true)][hashtable]$State)

    $normalized = Normalize-ShipDeSupervisorState -State $State
    $normalized.CheckpointTime = (Get-Date).ToUniversalTime().ToString("o")
    $temporaryPath = "$script:SupervisorStateFile.tmp"
    $normalized | ConvertTo-Json -Depth 12 | Set-Content -Path $temporaryPath -Encoding UTF8
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
    return (Normalize-ShipDeSupervisorState -State $stateObject)
}

function Assert-ShipDeSupervisorLock {
    param(
        [string]$LockFile = $script:SupervisorLockFile,
        [string]$WorkItemId = "",
        [int]$CurrentPid = $PID,
        [scriptblock]$ProcessResolver = { param($id) Get-Process -Id $id -ErrorAction SilentlyContinue }
    )

    $lockDir = Split-Path $LockFile -Parent
    if (-not [string]::IsNullOrWhiteSpace($lockDir) -and -not (Test-Path -LiteralPath $lockDir)) {
        New-Item -ItemType Directory -Path $lockDir -Force | Out-Null
    }

    $lockPayload = @{
        process_id = $CurrentPid
        work_item_id = $WorkItemId
        acquired_at = (Get-Date).ToUniversalTime().ToString("o")
        host = $env:COMPUTERNAME
    }
    $lockJson = $lockPayload | ConvertTo-Json

    if (Test-Path -LiteralPath $LockFile) {
        try {
            $lockContent = Get-Content -LiteralPath $LockFile -Raw -Encoding UTF8 | ConvertFrom-Json
            $holderPid = [int](Get-ShipDeObjectProperty -Object $lockContent -Names @("process_id", "processId"))
            $holderWorkItem = [string](Get-ShipDeObjectProperty -Object $lockContent -Names @("work_item_id", "workItemId"))

            if ($holderPid -gt 0 -and $holderPid -ne $CurrentPid) {
                $proc = & $ProcessResolver $holderPid
                if ($null -ne $proc -and -not [bool]$proc.HasExited) {
                    throw "Another supervisor instance (PID $holderPid, Work Item '$holderWorkItem') is actively supervising. Rejecting concurrent supervisor lock."
                }
            }
            Remove-Item -LiteralPath $LockFile -Force -ErrorAction SilentlyContinue
        } catch {
            if ($_.Exception.Message -match "Another supervisor instance") {
                throw
            }
            Remove-Item -LiteralPath $LockFile -Force -ErrorAction SilentlyContinue
        }
    }

    try {
        $fileStream = [System.IO.File]::Open($LockFile, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
        try {
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($lockJson)
            $fileStream.Write($bytes, 0, $bytes.Length)
        } finally {
            $fileStream.Close()
            $fileStream.Dispose()
        }
    } catch [System.IO.IOException] {
        if (Test-Path -LiteralPath $LockFile) {
            try {
                $existing = Get-Content -LiteralPath $LockFile -Raw -Encoding UTF8 | ConvertFrom-Json
                $holderPid = [int](Get-ShipDeObjectProperty -Object $existing -Names @("process_id", "processId"))
                $holderWorkItem = [string](Get-ShipDeObjectProperty -Object $existing -Names @("work_item_id", "workItemId"))
                if ($holderPid -gt 0 -and $holderPid -ne $CurrentPid) {
                    $proc = & $ProcessResolver $holderPid
                    if ($null -ne $proc -and -not [bool]$proc.HasExited) {
                        throw "Another supervisor instance (PID $holderPid, Work Item '$holderWorkItem') is actively supervising. Rejecting concurrent supervisor lock."
                    }
                }
            } catch {
                if ($_.Exception.Message -match "Another supervisor instance") { throw }
            }
        }
        throw "Failed to acquire exclusive supervisor lock '$LockFile': $($_.Exception.Message)"
    }
}

function Update-ShipDeSupervisorLock {
    param(
        [string]$LockFile = $script:SupervisorLockFile,
        [string]$WorkItemId = "",
        [int]$CurrentPid = $PID
    )

    if (Test-Path -LiteralPath $LockFile) {
        try {
            $lockPayload = @{
                process_id = $CurrentPid
                work_item_id = $WorkItemId
                acquired_at = (Get-Date).ToUniversalTime().ToString("o")
                host = $env:COMPUTERNAME
            }
            $lockPayload | ConvertTo-Json | Set-Content -LiteralPath $LockFile -Encoding UTF8
        } catch {}
    }
}

function Release-ShipDeSupervisorLock {
    param(
        [string]$LockFile = $script:SupervisorLockFile,
        [int]$CurrentPid = $PID
    )

    if (Test-Path -LiteralPath $LockFile) {
        try {
            $lockContent = Get-Content -LiteralPath $LockFile -Raw -Encoding UTF8 | ConvertFrom-Json
            $holderPid = [int](Get-ShipDeObjectProperty -Object $lockContent -Names @("process_id", "processId"))
            if ($holderPid -eq $CurrentPid -or $holderPid -le 0) {
                Remove-Item -LiteralPath $LockFile -Force -ErrorAction SilentlyContinue
            }
        } catch {
            Remove-Item -LiteralPath $LockFile -Force -ErrorAction SilentlyContinue
        }
    }
}

function Request-ShipDeCodexBotReview {
    param(
        [Parameter(Mandatory = $true)][int]$PullRequestNumber,
        [Parameter(Mandatory = $true)][string]$HeadSha,
        [string]$Repository = "vinh05092001/shipde-platform",
        [scriptblock]$CommentsFinder = $null,
        [scriptblock]$CommentPoster = $null
    )

    # 1. Idempotently check if an exact-HEAD "@codex review" request comment already exists
    $existingComments = @()
    if ($null -ne $CommentsFinder) {
        $existingComments = @(& $CommentsFinder $PullRequestNumber)
    } else {
        $raw = @(& gh api "repos/$Repository/issues/$PullRequestNumber/comments" --paginate --slurp 2>$null)
        if ($LASTEXITCODE -eq 0 -and $raw.Count -gt 0) {
            try {
                $pages = (($raw -join [Environment]::NewLine) | ConvertFrom-Json)
                foreach ($page in @($pages)) {
                    foreach ($c in @($page)) {
                        $existingComments += $c
                    }
                }
            } catch {}
        }
    }

    foreach ($comm in $existingComments) {
        $body = [string](Get-ShipDeObjectProperty -Object $comm -Names @("body"))
        if (-not [string]::IsNullOrWhiteSpace($body) -and $body -match '(?i)@codex\s+review' -and $body -match [regex]::Escape($HeadSha)) {
            $existingId = [string](Get-ShipDeObjectProperty -Object $comm -Names @("id", "databaseId"))
            if (-not [string]::IsNullOrWhiteSpace($existingId)) {
                Write-Host ("[SUPERVISOR] Found existing @codex review request comment {0} for exact HEAD {1} on PR #{2}." -f $existingId, $HeadSha, $PullRequestNumber)
                return $existingId
            }
        }
    }

    # 2. Post exact-HEAD "@codex review" request
    $requestBody = "@codex review $HeadSha"
    Write-Host ("[SUPERVISOR] Posting exact-HEAD '@codex review' request for PR #{0} at {1}..." -f $PullRequestNumber, $HeadSha)

    if ($null -ne $CommentPoster) {
        $newId = & $CommentPoster $PullRequestNumber $requestBody
        if ([string]::IsNullOrWhiteSpace($newId)) {
            throw "Comment poster failed to return a comment ID for PR #$PullRequestNumber."
        }
        return [string]$newId
    }

    $rawPost = @(& gh api "repos/$Repository/issues/$PullRequestNumber/comments" -f body=$requestBody 2>&1)
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        $err = Join-ShipDeNativeOutput -Output $rawPost
        throw "Failed to post '@codex review' request to PR #$($PullRequestNumber): $err"
    }

    $postText = ($rawPost -join [Environment]::NewLine).Trim()
    $postedObj = $null
    try {
        $postedObj = $postText | ConvertFrom-Json
    } catch {
        throw "Failed to parse GitHub response after posting review request: $($_.Exception.Message)"
    }

    $commentId = [string](Get-ShipDeObjectProperty -Object $postedObj -Names @("id", "databaseId"))
    if ([string]::IsNullOrWhiteSpace($commentId)) {
        throw "GitHub response did not contain a valid comment ID."
    }

    Write-Host ("[SUPERVISOR] Successfully posted @codex review request comment {0} on PR #{1} for exact HEAD {2}." -f $commentId, $PullRequestNumber, $HeadSha)
    return $commentId
}

function Start-ShipDeExternalCodexReview {
    param(
        [Parameter(Mandatory = $true)][int]$PullRequestNumber,
        [Parameter(Mandatory = $true)][string]$HeadSha,
        [string]$Repository = "vinh05092001/shipde-platform",
        [scriptblock]$ReviewInvoker = $null
    )

    try {
        if ($null -ne $ReviewInvoker) {
            $res = & $ReviewInvoker $PullRequestNumber $HeadSha
            if ($res -is [string] -and (-not [string]::IsNullOrWhiteSpace($res)) -and $res -ne "True" -and $res -ne "False") {
                return $res
            }
            return if ($res -eq $true) { "comment-mocked" } else { $null }
        }
        $commentId = Request-ShipDeCodexBotReview -PullRequestNumber $PullRequestNumber -HeadSha $HeadSha -Repository $Repository
        return $commentId
    } catch {
        Write-Warning ("External Codex review request failed for PR #{0}: {1}" -f $PullRequestNumber, $_.Exception.Message)
        return $null
    }
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
        "pr_open" { return "PARKED" }
        "parked" { return "PARKED" }
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

function Stop-ShipDeAoSession {
    param(
        [Parameter(Mandatory = $true)][string]$SessionId,
        [string]$Project = "shipde-platform"
    )

    $output = @(& (Get-ShipDeAoInvocationPath) session kill $SessionId --project $Project 2>&1)
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        $text = Join-ShipDeNativeOutput -Output $output
        throw "Could not kill/archive AO session $($SessionId): $text"
    }
}

function Test-ShipDeSupervisorSessionOwnership {
    param(
        [Parameter(Mandatory = $true)][object]$Session,
        [Parameter(Mandatory = $true)][object]$Item,
        [string]$Project = "shipde-platform"
    )

    $sid = Get-ShipDeAoSessionId -Response $Session
    $sessionName = Get-ShipDeAoSessionName -Session $Session
    $expectedName = Get-ShipDeAoWorkerName -Item $Item

    # 1. Does session name match expected worker name?
    if (-not [string]::IsNullOrWhiteSpace($sessionName) -and $sessionName -eq $expectedName) {
        return $true
    }

    # 2. Check title / prompt / description in session properties
    $promptText = [string](Get-ShipDeObjectProperty -Object $Session -Names @("prompt", "title", "description", "name"))
    if ($promptText -match [regex]::Escape($Item.WorkItemId)) {
        return $true
    }

    # 3. Check worktree git commits and branch
    $worktree = [string](Get-ShipDeObjectProperty -Object $Session -Names @("worktree", "worktreePath", "worktree_path", "workingDir", "path"))
    if ([string]::IsNullOrWhiteSpace($worktree) -and -not [string]::IsNullOrWhiteSpace($sid)) {
        $worktree = Join-Path (Get-ShipDeAoWorktreesDir -Project $Project) $sid
    }
    if (-not [string]::IsNullOrWhiteSpace($worktree) -and (Test-Path -LiteralPath (Join-Path $worktree ".git"))) {
        $worktreeBranch = (& git -C $worktree rev-parse --abbrev-ref HEAD 2>$null).Trim()
        if ($worktreeBranch -ceq $Item.Branch) {
            # Check if git commit log contains Work Item ID
            $logMatches = (& git -C $worktree log -n 10 --grep="$($Item.WorkItemId)" --oneline 2>$null)
            if (-not [string]::IsNullOrWhiteSpace($logMatches)) {
                return $true
            }
        }
    }

    return $false
}

function Ensure-ShipDeRepairWorker {
    param(
        [Parameter(Mandatory = $true)][hashtable]$State,
        [Parameter(Mandatory = $true)][object]$PullRequest,
        [string]$Project = "shipde-platform",
        [scriptblock]$WorkerStarter = $null,
        [scriptblock]$SessionReleaser = $null,
        [scriptblock]$SessionDetailResolver = $null,
        [scriptblock]$SessionsResolver = $null,
        [scriptblock]$OwnershipVerifier = $null,
        [scriptblock]$CheckpointWriter = $null
    )

    $item = [PSCustomObject]@{
        WorkItemId = [string]$State["WorkItemId"]
        WorkItemPath = [string]$State["WorkItemPath"]
        Branch = [string]$State["Branch"]
        Author = [string]$State["Author"]
    }
    if ([string]::IsNullOrWhiteSpace($item.Author)) {
        $resolvedItem = Get-ShipDePrWorkItem -PullRequest $PullRequest
        if ($resolvedItem) {
            $item.Author = $resolvedItem.Author
            $State["Author"] = $resolvedItem.Author
        }
    }

    # Requirement 4: When a trusted CHANGES_REQUIRED verdict arrives, select only the author-allowed agy harness
    $allowedHarnesses = @(Get-ShipDeAoHarnessCandidates -Author $item.Author)
    $targetHarness = $allowedHarnesses[0]

    # Requirement 3: Check if currently bound session is valid and allowed, asserting only when repair is needed
    $currentSessionId = if ($State.ContainsKey("SessionId") -and $null -ne $State["SessionId"]) { [string]$State["SessionId"] } else { "" }
    if (-not [string]::IsNullOrWhiteSpace($currentSessionId)) {
        $detail = if ($null -ne $SessionDetailResolver) { & $SessionDetailResolver $currentSessionId $Project } else { Get-ShipDeAoSessionById -SessionId $currentSessionId -Project $Project }
        if ($null -ne $detail) {
            $harness = [string](Get-ShipDeObjectProperty -Object $detail -Names @("harness"))
            if ($allowedHarnesses -contains $harness) {
                $verifiedHarness = Assert-ShipDeReusedAoSession -SessionDetail $detail -Item $item -AllowedHarnesses $allowedHarnesses -Project $Project
                $State["Harness"] = $verifiedHarness
                return $currentSessionId
            }
        }
    }

    # Discover existing sessions in AO project that may own the worktree/branch
    $allSessions = if ($null -ne $SessionsResolver) { @(& $SessionsResolver $Project) } else { @(Get-ShipDeAoSessions -Project $Project) }
    $matchingDisallowedParked = @()
    $matchingAllowed = @()

    foreach ($cand in $allSessions) {
        $isTerm = [bool](Get-ShipDeObjectProperty -Object $cand -Names @("isTerminated", "is_terminated"))
        $status = [string](Get-ShipDeObjectProperty -Object $cand -Names @("status", "state"))
        if ($isTerm -or $status -in @("terminated", "failed", "completed", "stopped")) {
            continue
        }

        $sid = Get-ShipDeAoSessionId -Response $cand
        $candDetail = if ($null -ne $SessionDetailResolver) { & $SessionDetailResolver $sid $Project } else { Get-ShipDeAoSessionById -SessionId $sid -Project $Project }
        $sessionToCheck = if ($candDetail) { $candDetail } else { $cand }

        # Check if this session owns the worktree or matches the branch
        $ownsWorktree = $false
        $sessionBranch = [string](Get-ShipDeObjectProperty -Object $sessionToCheck -Names @("branch", "headBranch", "head_branch"))
        if ($sessionBranch -ceq $item.Branch) {
            $ownsWorktree = $true
        } else {
            $candWorktree = [string](Get-ShipDeObjectProperty -Object $sessionToCheck -Names @("worktree", "worktreePath", "worktree_path", "workingDir", "path"))
            if ([string]::IsNullOrWhiteSpace($candWorktree) -and -not [string]::IsNullOrWhiteSpace($sid)) {
                $candWorktree = Join-Path (Get-ShipDeAoWorktreesDir -Project $Project) $sid
            }
            if (-not [string]::IsNullOrWhiteSpace($candWorktree) -and (Test-Path -LiteralPath (Join-Path $candWorktree ".git"))) {
                $worktreeBranch = (& git -C $candWorktree rev-parse --abbrev-ref HEAD 2>$null).Trim()
                if ($worktreeBranch -ceq $item.Branch) {
                    $ownsWorktree = $true
                }
            }
        }

        if ($ownsWorktree) {
            $harness = [string](Get-ShipDeObjectProperty -Object $sessionToCheck -Names @("harness"))
            if ($allowedHarnesses -contains $harness) {
                $matchingAllowed += $sessionToCheck
            } else {
                $matchingDisallowedParked += $sessionToCheck
            }
        }
    }

    if ($matchingAllowed.Count -eq 1) {
        $sid = Get-ShipDeAoSessionId -Response $matchingAllowed[0]
        $detail = if ($null -ne $SessionDetailResolver) { & $SessionDetailResolver $sid $Project } else { Get-ShipDeAoSessionById -SessionId $sid -Project $Project }
        $verifiedHarness = Assert-ShipDeReusedAoSession -SessionDetail $detail -Item $item -AllowedHarnesses $allowedHarnesses -Project $Project
        $State["SessionId"] = $sid
        $State["Harness"] = $verifiedHarness
        return $sid
    } elseif ($matchingAllowed.Count -gt 1) {
        throw "Multiple eligible AO worker sessions found for branch '$($item.Branch)'. Failing closed."
    }

    # Requirement 5: If a parked disallowed session owns the worktree, prove ownership, release it, then spawn agy
    if ($matchingDisallowedParked.Count -gt 0) {
        foreach ($disallowed in $matchingDisallowedParked) {
            $sid = Get-ShipDeAoSessionId -Response $disallowed
            $harness = [string](Get-ShipDeObjectProperty -Object $disallowed -Names @("harness"))

            $proven = if ($null -ne $OwnershipVerifier) {
                & $OwnershipVerifier $disallowed $item $Project
            } else {
                Test-ShipDeSupervisorSessionOwnership -Session $disallowed -Item $item -Project $Project
            }

            if (-not $proven) {
                # Requirement 5: If ownership cannot be proven, return BLOCKED with the exact session ID
                $State["State"] = "BLOCKED"
                if ($null -ne $CheckpointWriter) { & $CheckpointWriter $State } else { Write-ShipDeSupervisorCheckpoint -State $State }
                throw "BLOCKED: Parked disallowed AO session '$sid' (harness: $harness) owns worktree for branch '$($item.Branch)' but supervisor ownership could not be proven."
            }

            # Requirement 5 & 6: Safely release/archive only that session, never run claude-code and agy concurrently
            Write-Host ("[SUPERVISOR] Proven supervisor ownership for parked disallowed session '{0}' (harness: {1}). Releasing session before spawning {2}..." -f $sid, $harness, $targetHarness)
            try {
                if ($null -ne $SessionReleaser) {
                    & $SessionReleaser $sid $Project
                } else {
                    Stop-ShipDeAoSession -SessionId $sid -Project $Project
                }
            } catch {
                throw "Failed to safely release disallowed AO session '$sid': $($_.Exception.Message)"
            }

            # Verify session is terminated before spawning replacement worker
            $postKillDetail = if ($null -ne $SessionDetailResolver) { & $SessionDetailResolver $sid $Project } else { Get-ShipDeAoSessionById -SessionId $sid -Project $Project }
            if ($null -ne $postKillDetail) {
                $isTerm = [bool](Get-ShipDeObjectProperty -Object $postKillDetail -Names @("isTerminated", "is_terminated"))
                $postStatus = [string](Get-ShipDeObjectProperty -Object $postKillDetail -Names @("status", "state"))
                if (-not $isTerm -and $postStatus -notin @("terminated", "failed", "completed", "stopped", "exited", "pr_open", "parked")) {
                    throw "Disallowed AO session '$sid' remained active after release attempt. Failing closed before spawning replacement worker."
                }
            }
        }
    }

    # Requirement 4 & 5: Spawn agy for the repair
    Write-Host ("[SUPERVISOR] Spawning {0} worker for repair on branch '{1}'..." -f $targetHarness, $item.Branch)
    $prompt = New-ShipDeAuthorPrompt -Item $item
    $spawned = if ($null -ne $WorkerStarter) {
        & $WorkerStarter $item $prompt
    } else {
        Start-ShipDeAoWorker -Item $item -Prompt $prompt -Project $Project -Harness $targetHarness
    }

    $State["SessionId"] = [string]$spawned.SessionId
    $State["Harness"] = [string]$spawned.Harness
    $State["State"] = "STARTED"
    if ($null -ne $CheckpointWriter) { & $CheckpointWriter $State } else { Write-ShipDeSupervisorCheckpoint -State $State }
    return [string]$spawned.SessionId
}

function Invoke-ShipDeSupervisorLoop {
    param(
        [Parameter(Mandatory = $true)][hashtable]$State,
        [string]$Project = "shipde-platform",
        [int]$PollIntervalSeconds = 30,
        [int]$InactivityTimeoutMinutes = 10,
        [int]$MaxNudges = 1,
        [int]$ReviewTimeoutMinutes = 20,
        [int]$MaxRepairBudget = 10,
        [scriptblock]$PrResolver = $null,
        [scriptblock]$ExternalReviewLauncher = $null,
        [scriptblock]$BotReviewRequester = $null,
        [scriptblock]$SleepHandler = $null,
        [scriptblock]$CheckpointWriter = $null,
        [scriptblock]$VerdictResolver = $null,
        [scriptblock]$WorkerStarter = $null,
        [scriptblock]$SessionReleaser = $null,
        [scriptblock]$OwnershipVerifier = $null,
        [scriptblock]$MessageSender = $null,
        [scriptblock]$SessionsResolver = $null,
        [scriptblock]$SessionDetailResolver = $null
    )

    Assert-ShipDeSupervisorMaxNudges -MaxNudges $MaxNudges

    $State = Normalize-ShipDeSupervisorState -State $State

    while ($true) {
        $sessionId = if ($State.ContainsKey("SessionId") -and $null -ne $State["SessionId"]) { [string]$State["SessionId"] } else { "" }
        $session = if (-not [string]::IsNullOrWhiteSpace($sessionId)) {
            if ($null -ne $SessionDetailResolver) { & $SessionDetailResolver $sessionId $Project } else { Get-ShipDeAoSessionById -SessionId $sessionId -Project $Project }
        } else {
            $null
        }
        $pullRequest = if ($null -ne $PrResolver) {
            & $PrResolver ([string]$State.WorkItemId) ([string]$State.Branch)
        } else {
            Get-ShipDeOpenPullRequestForWorkItem -WorkItemId ([string]$State.WorkItemId) -Branch ([string]$State.Branch)
        }

        if (-not [string]::IsNullOrWhiteSpace($sessionId) -and $null -eq $session) {
            # Requirement 5: Recovery for a checkpoint whose SessionId no longer exists
            if ($null -ne $pullRequest -and -not [bool]$pullRequest.isDraft) {
                $hasPendingDispatch = ($null -ne $State.PendingDispatch)
                $ciFailing = $false
                if ($null -ne $pullRequest.statusCheckRollup -and @($pullRequest.statusCheckRollup).Count -gt 0) {
                    $gate = Get-ShipDePrGate -PullRequest $pullRequest
                    if ($gate -eq "FAILED") {
                        $ciFailing = $true
                    }
                }
                $reviewRequiresChanges = ([string]$State.ExactHeadVerdict -eq "CHANGES_REQUIRED")
                $hasPendingRepair = ($hasPendingDispatch -or $ciFailing -or $reviewRequiresChanges)

                if ($hasPendingRepair) {
                    $State.State = "BLOCKED"
                    if ($null -ne $CheckpointWriter) { & $CheckpointWriter $State } else { Write-ShipDeSupervisorCheckpoint -State $State }
                    throw "AO session '$sessionId' no longer exists while implementation or repair work is pending for PR #$($pullRequest.number). Stopping BLOCKED for human action."
                }

                Write-Host ("[SUPERVISOR] Checkpoint AO session '{0}' no longer exists, but PR #{1} is open with no pending repair. Clearing SessionId/Harness and resuming PR-only review." -f $sessionId, $pullRequest.number)
                $State.SessionId = $null
                $State.Harness = $null
                $sessionId = ""
                $activity = "EXTERNAL"
            } else {
                $activity = "MISSING"
            }
        } else {
            $activity = if ($null -ne $session) {
                Get-ShipDeSessionActivityState -Session $session
            } elseif (-not [string]::IsNullOrWhiteSpace($sessionId)) {
                "MISSING"
            } else {
                "EXTERNAL"
            }
        }

        $previousActivity = [string]$State.State
        $State.State = $activity
        $State.ProviderFailure = $false
        if ($previousActivity -ne $activity) {
            $displaySessionId = if (-not [string]::IsNullOrWhiteSpace($sessionId)) { $sessionId } else { "external" }
            Write-Host ("[SUPERVISOR] {0} session {1}: {2} -> {3}" -f (Get-Date).ToUniversalTime().ToString("o"), $displaySessionId, $previousActivity, $activity)
        }
        if ($null -ne $CheckpointWriter) { & $CheckpointWriter $State } else { Write-ShipDeSupervisorCheckpoint -State $State }

        if ($activity -in @("FAILED", "STOPPED", "MISSING")) {
            if ($activity -in @("FAILED", "STOPPED")) {
                $routerFailure = Get-ShipDeAgentRouterFailureSince -Since ([string]$State.StartTime)
                if ($routerFailure) {
                    $State.RouterFailure = $routerFailure
                    if ($null -ne $CheckpointWriter) { & $CheckpointWriter $State } else { Write-ShipDeSupervisorCheckpoint -State $State }
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

        if ($null -ne $State.PendingDispatch) {
            $pType = [string](Get-ShipDeObjectProperty -Object $State.PendingDispatch -Names @("Type", "type"))
            $pHead = [string](Get-ShipDeObjectProperty -Object $State.PendingDispatch -Names @("Head", "head"))
            $curHead = if ($pullRequest) { [string]$pullRequest.headRefOid } else { "" }

            $isAlreadyAcknowledged = switch ($pType) {
                "CI_REPAIR" { [string]$State.LastAcknowledgedCiRepairHead -eq $pHead }
                "REVIEW_REPAIR" { [string]$State.LastAcknowledgedReviewRepairHead -eq $pHead }
                "REVIEW_TRIGGER" { [string]$State.LastAcknowledgedReviewTriggerHead -eq $pHead }
                default { $false }
            }

            if ($isAlreadyAcknowledged -or [string]::IsNullOrWhiteSpace($curHead) -or $pHead -ne $curHead) {
                $State.PendingDispatch = $null
                if ($null -ne $CheckpointWriter) { & $CheckpointWriter $State } else { Write-ShipDeSupervisorCheckpoint -State $State }
            } else {
                switch ($pType) {
                    "CI_REPAIR" {
                        $message = "CI failed for PR #$($pullRequest.number) at exact HEAD $curHead. Inspect the failing checks, repair this same Work Item, run governed verification, commit, and push. Do not merge."
                        $targetSessionId = Ensure-ShipDeRepairWorker -State $State -PullRequest $pullRequest -Project $Project -WorkerStarter $WorkerStarter -SessionReleaser $SessionReleaser -SessionDetailResolver $SessionDetailResolver -SessionsResolver $SessionsResolver -OwnershipVerifier $OwnershipVerifier -CheckpointWriter $CheckpointWriter
                        $delivered = $false
                        if (-not [string]::IsNullOrWhiteSpace($targetSessionId)) {
                            $delivered = if ($null -ne $MessageSender) { & $MessageSender $targetSessionId $message } else { Send-ShipDeAoMessage -SessionId $targetSessionId -Message $message }
                        } else {
                            Write-Host ("[SUPERVISOR] CI failed for PR #{0} at exact HEAD {1}. In external review mode; awaiting author repair." -f $pullRequest.number, $curHead)
                            $delivered = $true
                        }
                        if (-not $delivered) {
                            throw "Cannot route unacknowledged CI repair back to the implementation worker during crash recovery."
                        }

                        $State.LastCiRepairHead = $curHead
                        $State.LastAcknowledgedCiRepairHead = $curHead
                        $State.PendingDispatch = $null
                        $State.LastRepairDispatchedAt = (Get-Date).ToUniversalTime().ToString("o")
                        $State.LastActivityTime = (Get-Date).ToUniversalTime().ToString("o")
                        $State.NudgeCount = 0
                        if ($null -ne $CheckpointWriter) { & $CheckpointWriter $State } else { Write-ShipDeSupervisorCheckpoint -State $State }
                    }
                    "REVIEW_REPAIR" {
                        $findingsText = ""
                        try {
                            $findingsText = Get-ShipDeGitHubExactHeadCodexFindings -PullRequestNumber ([int]$pullRequest.number) -HeadSha $curHead -Repository "vinh05092001/shipde-platform"
                        } catch {}
                        $message = "Independent Codex review requires changes on PR #$($pullRequest.number) at exact HEAD $curHead."
                        if (-not [string]::IsNullOrWhiteSpace($findingsText)) {
                            $message += "`n`nReview findings:`n$findingsText`n`nRepair this same branch, run all governed checks, commit, push, and stop before merge."
                        } else {
                            $message += " Read the durable review findings, repair the same branch, run all governed checks, commit, push, and stop before merge."
                        }

                        $targetSessionId = Ensure-ShipDeRepairWorker -State $State -PullRequest $pullRequest -Project $Project -WorkerStarter $WorkerStarter -SessionReleaser $SessionReleaser -SessionDetailResolver $SessionDetailResolver -SessionsResolver $SessionsResolver -OwnershipVerifier $OwnershipVerifier -CheckpointWriter $CheckpointWriter
                        $delivered = $false
                        if (-not [string]::IsNullOrWhiteSpace($targetSessionId)) {
                            $delivered = if ($null -ne $MessageSender) { & $MessageSender $targetSessionId $message } else { Send-ShipDeAoMessage -SessionId $targetSessionId -Message $message }
                        } else {
                            Write-Host ("[SUPERVISOR] PR #{0} at exact HEAD {1} requires changes. External review findings posted to PR; awaiting author repair." -f $pullRequest.number, $curHead)
                            $delivered = $true
                        }
                        if (-not $delivered) {
                            throw "Cannot route unacknowledged review findings back to the implementation worker during crash recovery."
                        }

                        $State.LastReviewRepairHead = $curHead
                        $State.LastAcknowledgedReviewRepairHead = $curHead
                        $State.PendingDispatch = $null
                        $State.LastRepairDispatchedAt = (Get-Date).ToUniversalTime().ToString("o")
                        $State.LastActivityTime = (Get-Date).ToUniversalTime().ToString("o")
                        $State.NudgeCount = 0
                        if ($null -ne $CheckpointWriter) { & $CheckpointWriter $State } else { Write-ShipDeSupervisorCheckpoint -State $State }
                    }
                    "REVIEW_TRIGGER" {
                        $commentId = $null
                        try {
                            if ($null -ne $BotReviewRequester) {
                                $commentId = & $BotReviewRequester ([int]$pullRequest.number) $curHead
                            } elseif ($null -ne $ExternalReviewLauncher) {
                                $commentId = & $ExternalReviewLauncher ([int]$pullRequest.number) $curHead
                            } else {
                                $commentId = Request-ShipDeCodexBotReview -PullRequestNumber ([int]$pullRequest.number) -HeadSha $curHead -Repository "vinh05092001/shipde-platform"
                            }
                        } catch {
                            $commentId = $null
                        }

                        if ([string]::IsNullOrWhiteSpace($commentId)) {
                            $State.PendingDispatch = $null
                            if ($null -ne $CheckpointWriter) { & $CheckpointWriter $State } else { Write-ShipDeSupervisorCheckpoint -State $State }
                            throw "Unacknowledged review trigger could not post or find exact-HEAD bot review request on PR #$($pullRequest.number) at exact HEAD $curHead."
                        }

                        $State.ReviewRequestCommentId = [string]$commentId
                        $State.LastReviewTriggeredHead = $curHead
                        $State.LastAcknowledgedReviewTriggerHead = $curHead
                        $State.PendingDispatch = $null
                        $State.LastReviewTriggeredAt = (Get-Date).ToUniversalTime().ToString("o")
                        if ($null -ne $CheckpointWriter) { & $CheckpointWriter $State } else { Write-ShipDeSupervisorCheckpoint -State $State }
                    }
                    "NUDGE" {
                        $message = "Continue the assigned Work Item autonomously. If genuinely blocked, report one concrete blocker. Do not wait for routine confirmation."
                        $delivered = $false
                        if (-not [string]::IsNullOrWhiteSpace($sessionId)) {
                            $delivered = if ($null -ne $MessageSender) { & $MessageSender $sessionId $message } else { Send-ShipDeAoMessage -SessionId $sessionId -Message $message }
                        }
                        if ($delivered) {
                            $State.NudgeCount = [int]$State.NudgeCount + 1
                            $State.PendingDispatch = $null
                            $State.LastActivityTime = (Get-Date).ToUniversalTime().ToString("o")
                            if ($null -ne $CheckpointWriter) { & $CheckpointWriter $State } else { Write-ShipDeSupervisorCheckpoint -State $State }
                        } else {
                            throw "Cannot deliver unacknowledged nudge during crash recovery."
                        }
                    }
                    default {
                        $State.PendingDispatch = $null
                        if ($null -ne $CheckpointWriter) { & $CheckpointWriter $State } else { Write-ShipDeSupervisorCheckpoint -State $State }
                    }
                }
            }
        }

        $workerActionExpected = $false
        if ($pullRequest) {
            $headSha = [string]$pullRequest.headRefOid
            if ([string]$State.HeadSha -ne $headSha) {
                $State.ExactHeadVerdict = $null
                $State.ReviewRequestCommentId = $null
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
                if ($activity -in @("COMPLETED", "PARKED")) {
                    throw "AO worker is $activity while PR #$($pullRequest.number) is still draft. Mark the same PR ready before review."
                }
            } elseif ($gate -eq "FAILED") {
                $workerActionExpected = $true
                if ([string]$State.LastAcknowledgedCiRepairHead -ne $headSha) {
                    $State.RepairCount = [int]$State.RepairCount + 1
                    if ([int]$State.RepairCount -gt $MaxRepairBudget) {
                        throw "Supervisor repair budget exhausted ($([int]$State.RepairCount) repairs dispatched exceeds max budget $MaxRepairBudget for Work Item '$($State.WorkItemId)'). Stopping fail-closed for human intervention."
                    }
                    $State.PendingDispatch = @{
                        Type = "CI_REPAIR"
                        Head = $headSha
                        Time = (Get-Date).ToUniversalTime().ToString("o")
                    }
                    if ($null -ne $CheckpointWriter) { & $CheckpointWriter $State } else { Write-ShipDeSupervisorCheckpoint -State $State }

                    $message = "CI failed for PR #$($pullRequest.number) at exact HEAD $headSha. Inspect the failing checks, repair this same Work Item, run governed verification, commit, and push. Do not merge."
                    $targetSessionId = Ensure-ShipDeRepairWorker -State $State -PullRequest $pullRequest -Project $Project -WorkerStarter $WorkerStarter -SessionReleaser $SessionReleaser -SessionDetailResolver $SessionDetailResolver -SessionsResolver $SessionsResolver -OwnershipVerifier $OwnershipVerifier -CheckpointWriter $CheckpointWriter
                    $delivered = $false
                    if (-not [string]::IsNullOrWhiteSpace($targetSessionId)) {
                        $delivered = if ($null -ne $MessageSender) { & $MessageSender $targetSessionId $message } else { Send-ShipDeAoMessage -SessionId $targetSessionId -Message $message }
                    } else {
                        Write-Host ("[SUPERVISOR] CI failed for PR #{0} at exact HEAD {1}. In external review mode; awaiting author repair." -f $pullRequest.number, $headSha)
                        $delivered = $true
                    }
                    if (-not $delivered) {
                        throw "Cannot route CI failure back to the implementation worker."
                    }

                    $State.LastCiRepairHead = $headSha
                    $State.LastAcknowledgedCiRepairHead = $headSha
                    $State.PendingDispatch = $null
                    $State.LastRepairDispatchedAt = (Get-Date).ToUniversalTime().ToString("o")
                    $State.LastActivityTime = (Get-Date).ToUniversalTime().ToString("o")
                    $State.NudgeCount = 0
                    if ($null -ne $CheckpointWriter) { & $CheckpointWriter $State } else { Write-ShipDeSupervisorCheckpoint -State $State }
                }
            } elseif ($gate -eq "GREEN") {
                $verdict = if ($null -ne $VerdictResolver) {
                    & $VerdictResolver ([int]$pullRequest.number) $headSha $sessionId
                } else {
                    Get-ShipDeExactHeadCodexVerdict -PullRequestNumber ([int]$pullRequest.number) -HeadSha $headSha -SessionId $sessionId
                }
                $State.ExactHeadVerdict = $verdict

                if ($verdict -eq "PASS") {
                    if ($null -ne $CheckpointWriter) { & $CheckpointWriter $State } else { Write-ShipDeSupervisorCheckpoint -State $State }
                    return "READY_FOR_HUMAN_MERGE"
                }
                if ($verdict -eq "BLOCKED") {
                    if ($null -ne $CheckpointWriter) { & $CheckpointWriter $State } else { Write-ShipDeSupervisorCheckpoint -State $State }
                    throw "Independent Codex review returned durable BLOCKED for PR #$($pullRequest.number) at exact HEAD $headSha. Stopping fail-closed for human action."
                }
                if ($verdict -eq "CHANGES_REQUIRED") {
                    $workerActionExpected = $true
                    if ([string]$State.LastAcknowledgedReviewRepairHead -ne $headSha) {
                        $State.RepairCount = [int]$State.RepairCount + 1
                        if ([int]$State.RepairCount -gt $MaxRepairBudget) {
                            throw "Supervisor repair budget exhausted ($([int]$State.RepairCount) repairs dispatched exceeds max budget $MaxRepairBudget for Work Item '$($State.WorkItemId)'). Stopping fail-closed for human intervention."
                        }
                        $State.PendingDispatch = @{
                            Type = "REVIEW_REPAIR"
                            Head = $headSha
                            Time = (Get-Date).ToUniversalTime().ToString("o")
                        }
                        if ($null -ne $CheckpointWriter) { & $CheckpointWriter $State } else { Write-ShipDeSupervisorCheckpoint -State $State }

                        $findingsText = ""
                        try {
                            $findingsText = Get-ShipDeGitHubExactHeadCodexFindings -PullRequestNumber ([int]$pullRequest.number) -HeadSha $headSha -Repository "vinh05092001/shipde-platform"
                        } catch {}

                        $message = "Independent Codex review requires changes on PR #$($pullRequest.number) at exact HEAD $headSha."
                        if (-not [string]::IsNullOrWhiteSpace($findingsText)) {
                            $message += "`n`nReview findings:`n$findingsText`n`nRepair this same branch, run all governed checks, commit, push, and stop before merge."
                        } else {
                            $message += " Read the durable review findings, repair the same branch, run all governed checks, commit, push, and stop before merge."
                        }

                        $targetSessionId = Ensure-ShipDeRepairWorker -State $State -PullRequest $pullRequest -Project $Project -WorkerStarter $WorkerStarter -SessionReleaser $SessionReleaser -SessionDetailResolver $SessionDetailResolver -SessionsResolver $SessionsResolver -OwnershipVerifier $OwnershipVerifier -CheckpointWriter $CheckpointWriter
                        $delivered = $false
                        if (-not [string]::IsNullOrWhiteSpace($targetSessionId)) {
                            $delivered = if ($null -ne $MessageSender) { & $MessageSender $targetSessionId $message } else { Send-ShipDeAoMessage -SessionId $targetSessionId -Message $message }
                        } else {
                            Write-Host ("[SUPERVISOR] PR #{0} at exact HEAD {1} requires changes. External review findings posted to PR; awaiting author repair." -f $pullRequest.number, $headSha)
                            $delivered = $true
                        }
                        if (-not $delivered) {
                            throw "Cannot route review findings back to the implementation worker."
                        }

                        $State.LastReviewRepairHead = $headSha
                        $State.LastAcknowledgedReviewRepairHead = $headSha
                        $State.PendingDispatch = $null
                        $State.LastRepairDispatchedAt = (Get-Date).ToUniversalTime().ToString("o")
                        $State.LastActivityTime = (Get-Date).ToUniversalTime().ToString("o")
                        $State.NudgeCount = 0
                        if ($null -ne $CheckpointWriter) { & $CheckpointWriter $State } else { Write-ShipDeSupervisorCheckpoint -State $State }
                    }
                } elseif ([string]$State.LastAcknowledgedReviewTriggerHead -ne $headSha) {
                    $State.PendingDispatch = @{
                        Type = "REVIEW_TRIGGER"
                        Head = $headSha
                        Time = (Get-Date).ToUniversalTime().ToString("o")
                    }
                    if ($null -ne $CheckpointWriter) { & $CheckpointWriter $State } else { Write-ShipDeSupervisorCheckpoint -State $State }

                    Write-Host ("[SUPERVISOR] PR #{0} is CI GREEN at {1}. Requesting governed exact-HEAD @codex review..." -f $pullRequest.number, $headSha)
                    $commentId = $null
                    try {
                        if ($null -ne $BotReviewRequester) {
                            $commentId = & $BotReviewRequester ([int]$pullRequest.number) $headSha
                        } elseif ($null -ne $ExternalReviewLauncher) {
                            $commentId = & $ExternalReviewLauncher ([int]$pullRequest.number) $headSha
                        } else {
                            $commentId = Request-ShipDeCodexBotReview -PullRequestNumber ([int]$pullRequest.number) -HeadSha $headSha -Repository "vinh05092001/shipde-platform"
                        }
                    } catch {
                        Write-Warning ("[SUPERVISOR] Failed to request @codex review for PR #{0}: {1}" -f $pullRequest.number, $_.Exception.Message)
                        $commentId = $null
                    }

                    if ([string]::IsNullOrWhiteSpace($commentId)) {
                        $State.PendingDispatch = $null
                        if ($null -ne $CheckpointWriter) { & $CheckpointWriter $State } else { Write-ShipDeSupervisorCheckpoint -State $State }
                        throw "CI is green but the trusted GitHub @codex review request comment could not be created or found for PR #$($pullRequest.number) at exact HEAD $headSha. Stopped fail-closed."
                    }

                    $State.ReviewRequestCommentId = [string]$commentId
                    $State.LastReviewTriggeredHead = $headSha
                    $State.LastAcknowledgedReviewTriggerHead = $headSha
                    $State.PendingDispatch = $null
                    $State.LastReviewTriggeredAt = (Get-Date).ToUniversalTime().ToString("o")
                    if ($null -ne $CheckpointWriter) { & $CheckpointWriter $State } else { Write-ShipDeSupervisorCheckpoint -State $State }
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
                $State.PendingDispatch = @{
                    Type = "NUDGE"
                    Time = (Get-Date).ToUniversalTime().ToString("o")
                }
                if ($null -ne $CheckpointWriter) { & $CheckpointWriter $State } else { Write-ShipDeSupervisorCheckpoint -State $State }

                $message = "Continue the assigned Work Item autonomously. If genuinely blocked, report one concrete blocker. Do not wait for routine confirmation."
                $delivered = $false
                if (-not [string]::IsNullOrWhiteSpace($sessionId)) {
                    $delivered = if ($null -ne $MessageSender) { & $MessageSender $sessionId $message } else { Send-ShipDeAoMessage -SessionId $sessionId -Message $message }
                }
                if (-not $delivered) {
                    throw "AO worker is idle and could not be nudged."
                }

                $State.NudgeCount = [int]$State.NudgeCount + 1
                $State.PendingDispatch = $null
                $State.LastActivityTime = (Get-Date).ToUniversalTime().ToString("o")
                if ($null -ne $CheckpointWriter) { & $CheckpointWriter $State } else { Write-ShipDeSupervisorCheckpoint -State $State }
            }
        } elseif ($activity -in @("COMPLETED", "PARKED") -and ((-not $pullRequest) -or $workerActionExpected)) {
            if (-not $pullRequest) {
                $statusDesc = if ($activity -eq "PARKED") { "parked" } else { "completed" }
                throw "AO worker is $statusDesc but no open Pull Request was found for Work Item '$($State.WorkItemId)' on branch '$($State.Branch)'."
            }
            if ($pullRequest.isDraft) {
                $statusDesc = if ($activity -eq "PARKED") { "parked" } else { "completed" }
                throw "AO worker is $statusDesc while PR #$($pullRequest.number) is still draft. Mark the same PR ready before review."
            }
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
                Write-Host ("[SUPERVISOR] Repair was dispatched at {0}. Permitting reactivation window for {1} worker." -f $State.LastRepairDispatchedAt, $activity)
            } else {
                throw "AO worker is in state $activity while governed implementation or repair work is still required."
            }
        } elseif ($activity -eq "PARKED" -and (-not $pullRequest)) {
            throw "AO worker is parked but no open Pull Request was found for Work Item '$($State.WorkItemId)' on branch '$($State.Branch)'."
        }

        if ($null -ne $CheckpointWriter) { & $CheckpointWriter $State } else { Write-ShipDeSupervisorCheckpoint -State $State }
        if ($null -ne $SleepHandler) {
            & $SleepHandler $PollIntervalSeconds
        } else {
            Start-Sleep -Seconds $PollIntervalSeconds
        }
    }
}

function Assert-ShipDeSupervisorCompatibility {
    # Requirement 4: Snapshot real production supervisor state file before running tests
    $realStateFile = $script:SupervisorStateFile
    $realStateFileExisted = Test-Path -LiteralPath $realStateFile
    $realStateFileBytes = if ($realStateFileExisted) { [System.IO.File]::ReadAllBytes($realStateFile) } else { $null }
    $realStateFileMtime = if ($realStateFileExisted) { (Get-Item -LiteralPath $realStateFile).LastWriteTimeUtc } else { $null }

    # Requirement 3: Snapshot script paths and environment in finally
    $origHandoffRoot = $script:HandoffRoot
    $origSupervisorStateFile = $script:SupervisorStateFile
    $origSupervisorLockFile = $script:SupervisorLockFile
    $origAoRouterRuntimeFile = $script:AoRouterRuntimeFile
    $origAgentRouterProfile = $script:AgentRouterProfile
    $origExpectedAoVersion = $script:ExpectedAoVersion
    $origAoExecutablePath = $script:AoExecutablePath

    $origEnvClaudeConfig = $env:CLAUDE_CONFIG_DIR
    $origEnvBaseUrl = $env:ANTHROPIC_BASE_URL
    $origEnvAuthToken = $env:ANTHROPIC_AUTH_TOKEN
    $origEnvApiKey = $env:ANTHROPIC_API_KEY

    # Requirement 2: Run the entire compatibility/test suite under a unique temporary HandoffRoot and SupervisorStateFile
    $compatSuiteTempRoot = Join-Path (Get-ShipDeTempDir) "task-ai-06-compat-$([Guid]::NewGuid().ToString('N'))"
    New-Item -ItemType Directory -Path $compatSuiteTempRoot -Force | Out-Null
    $compatHandoffRoot = Join-Path $compatSuiteTempRoot "handoff"
    New-Item -ItemType Directory -Path $compatHandoffRoot -Force | Out-Null

    $script:HandoffRoot = $compatHandoffRoot
    $script:SupervisorStateFile = Join-Path $compatHandoffRoot "supervisor-state.json"
    $script:SupervisorLockFile = Join-Path $compatHandoffRoot "supervisor.lock"
    $script:AoRouterRuntimeFile = Join-Path $compatHandoffRoot "ao-router-runtime.json"

    # Silence all host output during startup self-tests to prevent leaking PASS,
    # CHANGES_REQUIRED, PR data, and reconstructed-checkpoint messages
    # before the real supervisor banner is printed.
    $startupSelfTestHostLeaks = [System.Collections.Generic.List[string]]::new()
    function Write-Host {
        param([Parameter(ValueFromRemainingArguments = $true)]$Arguments)
        $msg = if ($null -ne $Arguments) { $Arguments -join " " } else { "" }
        $startupSelfTestHostLeaks.Add($msg)
    }
    function Write-Warning {
        param([Parameter(ValueFromRemainingArguments = $true)]$Arguments)
        $msg = if ($null -ne $Arguments) { $Arguments -join " " } else { "" }
        $startupSelfTestHostLeaks.Add("WARNING: $msg")
    }

    try {
        $aoFixtureRoot = Join-Path (Get-ShipDeTempDir) "task-ai-06-ao-$([Guid]::NewGuid().ToString('N'))"
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

        # TASK-AI-06 behavioral bootstrap regression suite:
        # Exercises start-agent-orchestrator.ps1 through injected seams (-ProcessStarter,
        # -StatusProbe, -EndpointTester, -VersionProbe, -ProfilePath, -AiRoot) to verify:
        # 1. Manifest pin bypass prevention: contradicting ExpectedAoVersion is rejected fail-closed.
        # 2. Pre-creation failure & original error preservation: launcher preserves original error and cleans up.
        # 3. Early process exit detection: detects exited process and records exit code without leaving marker.
        # 4. Successful startup & live process marker binding: binds verified live daemon identity.
        $behavioralTestRoot = Join-Path (Get-ShipDeTempDir) "task-ai-06-behavioral-$([Guid]::NewGuid().ToString('N'))"
        $behavioralAiRoot = Join-Path $behavioralTestRoot "AI"
        $behavioralProfile = Join-Path $behavioralTestRoot ".claude"
        $behavioralSettings = Join-Path $behavioralProfile "settings.json"
        $behavioralMarker = Join-Path $behavioralAiRoot "handoff\ao-router-runtime.json"
        $savedClaudeConfigDir = $env:CLAUDE_CONFIG_DIR
        $savedAnthropicBaseUrl = $env:ANTHROPIC_BASE_URL
        $savedAnthropicAuthToken = $env:ANTHROPIC_AUTH_TOKEN
        $savedAnthropicApiKey = $env:ANTHROPIC_API_KEY
        try {
            New-Item -ItemType Directory -Path $behavioralProfile -Force | Out-Null
            Set-Content -Path $behavioralSettings -Value '{"env":{"ANTHROPIC_BASE_URL":"http://localhost:20128/v1"}}' -Encoding UTF8

            # 1. Manifest bypass prevention
            $manifestBypassCaught = $false
            try {
                & (Join-Path $PSScriptRoot "start-agent-orchestrator.ps1") `
                    -ExpectedAoVersion "0.12.99" `
                    -ProfilePath $behavioralProfile `
                    -AiRoot $behavioralAiRoot
            } catch {
                $manifestBypassCaught = $_.Exception.Message -match "contradicts canonical manifest pin"
            }
            if (-not $manifestBypassCaught) {
                throw "AO bootstrap behavioral regression: caller-supplied ExpectedAoVersion contradicting manifest pin was not rejected."
            }

            # 2. Pre-creation failure & original error preservation
            $preCreationCaught = $false
            try {
                & (Join-Path $PSScriptRoot "start-agent-orchestrator.ps1") `
                    -AoExecutable $aoFixturePath `
                    -ProfilePath $behavioralProfile `
                    -AiRoot $behavioralAiRoot `
                    -VersionProbe { param($p) return [PSCustomObject]@{ Text = "ao version $script:ExpectedAoVersion"; ExitCode = 0 } } `
                    -EndpointTester { return $true } `
                    -ExistingProcessResolver { param($p) return @() } `
                    -ProcessStarter { param($p, $a) throw "Simulated pre-creation failure: process cannot be spawned" }
            } catch {
                $preCreationCaught = $_.Exception.Message -match "Simulated pre-creation failure: process cannot be spawned"
            }
            if (-not $preCreationCaught) {
                throw "AO bootstrap behavioral regression: pre-creation failure did not preserve original error."
            }
            if (Test-Path -LiteralPath $behavioralMarker) {
                throw "AO bootstrap behavioral regression: runtime marker was created despite pre-creation failure."
            }

            # 3. Early process exit detection and cleanup
            $earlyExitCaught = $false
            try {
                & (Join-Path $PSScriptRoot "start-agent-orchestrator.ps1") `
                    -AoExecutable $aoFixturePath `
                    -ProfilePath $behavioralProfile `
                    -AiRoot $behavioralAiRoot `
                    -VersionProbe { param($p) return [PSCustomObject]@{ Text = "ao version $script:ExpectedAoVersion"; ExitCode = 0 } } `
                    -EndpointTester { return $true } `
                    -ExistingProcessResolver { param($p) return @() } `
                    -ProcessStarter { param($p, $a) return [PSCustomObject]@{ Id = 71099; HasExited = $true; ExitCode = 42; Path = $p; ProcessName = "ao"; StartTime = (Get-Date) } } `
                    -StatusProbe { param($p) return @() } `
                    -StartupTimeoutSeconds 2
            } catch {
                $earlyExitCaught = $_.Exception.Message -match "Agent Orchestrator exited during startup with code 42"
            }
            if (-not $earlyExitCaught) {
                throw "AO bootstrap behavioral regression: early process exit was not detected with exit code."
            }
            if (Test-Path -LiteralPath $behavioralMarker) {
                throw "AO bootstrap behavioral regression: runtime marker was left behind after early exit."
            }

            # 4. Successful startup and live daemon identity marker binding
            $liveStartTime = (Get-Date).ToUniversalTime().AddSeconds(-5)
            & (Join-Path $PSScriptRoot "start-agent-orchestrator.ps1") `
                -AoExecutable $aoFixturePath `
                -ProfilePath $behavioralProfile `
                -AiRoot $behavioralAiRoot `
                -VersionProbe { param($p) return [PSCustomObject]@{ Text = "ao version $script:ExpectedAoVersion"; ExitCode = 0 } } `
                -EndpointTester { return $true } `
                -ExistingProcessResolver { param($p) return @() } `
                -ProcessStarter { param($p, $a) return [PSCustomObject]@{ Id = 71100; HasExited = $false; Path = $p; ProcessName = "ao"; StartTime = $liveStartTime } } `
                -StatusProbe { param($p) return '{"state":"ready"}' } 6>$null

            if (-not (Test-Path -LiteralPath $behavioralMarker)) {
                throw "AO bootstrap behavioral regression: runtime marker was not created on successful launch."
            }
            $writtenMarker = Get-Content -LiteralPath $behavioralMarker -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($writtenMarker.marker_version -ne 2 -or
                $writtenMarker.process_id -ne 71100 -or
                $writtenMarker.ao_version -ne $script:ExpectedAoVersion -or
                $writtenMarker.ao_executable -ne (Get-Item -LiteralPath $aoFixturePath).FullName -or
                $writtenMarker.base_url -ne "http://localhost:20128/v1") {
                throw "AO bootstrap behavioral regression: written marker properties did not bind to verified daemon identity."
            }
        } finally {
            if ($null -ne $savedClaudeConfigDir) { $env:CLAUDE_CONFIG_DIR = $savedClaudeConfigDir } else { Remove-Item Env:CLAUDE_CONFIG_DIR -ErrorAction SilentlyContinue }
            if ($null -ne $savedAnthropicBaseUrl) { $env:ANTHROPIC_BASE_URL = $savedAnthropicBaseUrl } else { Remove-Item Env:ANTHROPIC_BASE_URL -ErrorAction SilentlyContinue }
            if ($null -ne $savedAnthropicAuthToken) { $env:ANTHROPIC_AUTH_TOKEN = $savedAnthropicAuthToken } else { Remove-Item Env:ANTHROPIC_AUTH_TOKEN -ErrorAction SilentlyContinue }
            if ($null -ne $savedAnthropicApiKey) { $env:ANTHROPIC_API_KEY = $savedAnthropicApiKey } else { Remove-Item Env:ANTHROPIC_API_KEY -ErrorAction SilentlyContinue }
            if (Test-Path -LiteralPath $behavioralTestRoot) {
                Remove-Item -LiteralPath $behavioralTestRoot -Recurse -Force -ErrorAction SilentlyContinue
            }
        }

        if ($env:CLAUDE_CONFIG_DIR -ne $savedClaudeConfigDir) {
            throw "AO bootstrap behavioral regression: CLAUDE_CONFIG_DIR was not restored after self-tests."
        }
        if ($env:ANTHROPIC_BASE_URL -ne $savedAnthropicBaseUrl) {
            throw "AO bootstrap behavioral regression: ANTHROPIC_BASE_URL was not restored after self-tests."
        }
        if ($env:ANTHROPIC_AUTH_TOKEN -ne $savedAnthropicAuthToken) {
            throw "AO bootstrap behavioral regression: ANTHROPIC_AUTH_TOKEN was not restored after self-tests."
        }
        if ($env:ANTHROPIC_API_KEY -ne $savedAnthropicApiKey) {
            throw "AO bootstrap behavioral regression: ANTHROPIC_API_KEY was not restored after self-tests."
        }

        $bootstrapExecutable = Join-Path (Get-ShipDeTempDir) "task-ai-06-ao-marker-$([Guid]::NewGuid().ToString('N'))\ao.exe"
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
            [PSCustomObject]@{ name = "contract"; workflowName = "Current application"; conclusion = "SUCCESS"; startedAt = "2026-09-06T01:05:00Z" },
            [PSCustomObject]@{ name = "application-gate"; workflowName = "Current application"; conclusion = "SUCCESS"; startedAt = "2026-09-06T01:05:00Z" },
            [PSCustomObject]@{ context = "external/security"; targetUrl = "https://security.example.com/runs/1"; state = "FAILURE"; createdAt = "2026-09-06T01:00:00Z" },
            [PSCustomObject]@{ context = "external/security"; targetUrl = "https://security.example.com/runs/2"; state = "SUCCESS"; createdAt = "2026-09-06T01:05:00Z" }
        )
    }
    if ((Get-ShipDePrGate -PullRequest $statusContextRerunFixture) -ne "GREEN") {
        throw "GitHub StatusContext createdAt superseded attempt compatibility test failed."
    }

    # Finding 2 regression test: Legacy status contexts cannot forge required GitHub Actions checks via caller-controlled targetUrl
    $statusContextForgingFixture = [PSCustomObject]@{
        statusCheckRollup = @(
            [PSCustomObject]@{ context = "contract"; targetUrl = "https://github.com/org/repo/actions/runs/1"; state = "SUCCESS"; createdAt = "2026-09-06T01:05:00Z" },
            [PSCustomObject]@{ context = "application-gate"; targetUrl = "https://github.com/org/repo/actions/runs/2"; state = "SUCCESS"; createdAt = "2026-09-06T01:05:00Z" }
        )
    }
    if ((Get-ShipDePrGate -PullRequest $statusContextForgingFixture) -ne "PENDING") {
        throw "Legacy StatusContext check forging prevention compatibility test failed."
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

    # Finding 13 tests: Resume SPAWNING checkpoints with matching open PR without duplicate spawn,
    # preserving unrelated open PRs (e.g. PR #8) and uncheckpointed state
    $spawnRestartState = @{
        WorkItemId = "TASK-AI-06"
        WorkItemPath = "docs/product-spec/work-items/TASK-AI-06.md"
        Branch = "feat/task-ai-06-orchestrator-supervisor"
        Author = "GEMINI"
        State = "SPAWNING"
    }
    $simulatedMatchingPr = [PSCustomObject]@{
        number = 9
        title = "[TASK-AI-06] Governed AO supervisor with AgentRouter fallback"
        headRefName = "feat/task-ai-06-orchestrator-supervisor"
        isCrossRepository = $false
        headRepository = "vinh05092001/shipde-platform"
        headRefOid = "fb02d345bbffeb40b21a75bcf6c296a12f49c575"
    }
    $simulatedUnrelatedPr = [PSCustomObject]@{
        number = 8
        title = "[TASK-FOUND-03] API worker infrastructure"
        headRefName = "feat/task-found-03-api-worker-infrastructure"
        isCrossRepository = $false
        headRepository = "vinh05092001/shipde-platform"
        headRefOid = "8973b5f9227181c00fa88bfbc7e5c1d6368d37aa"
    }
    $workerSpawnStats = @{ Count = 0 }
    $checkpointWriteStats = @{ Count = 0; LastState = $null }
    $reusedSessionResult = & {
        Initialize-ShipDeSupervisorState `
            -State $spawnRestartState `
            -Repository "vinh05092001/shipde-platform" `
            -OpenPrResolver { @($simulatedMatchingPr, $simulatedUnrelatedPr) } `
            -ActiveWorkersResolver { @() } `
            -CodexParker { } `
            -WorkerStarter {
                param($it, $pr)
                $workerSpawnStats.Count++
                throw "WorkerStarter must NOT be invoked when matching implementation PR already exists!"
            } `
            -CheckpointWriter {
                param($s)
                $checkpointWriteStats.Count++
                $checkpointWriteStats.LastState = $s
            }
    } 6>$null

    if (
        $null -eq $reusedSessionResult -or
        $reusedSessionResult.State -ne "STARTED" -or
        $reusedSessionResult.PullRequestNumber -ne 9 -or
        $reusedSessionResult.HeadSha -ne "fb02d345bbffeb40b21a75bcf6c296a12f49c575" -or
        $workerSpawnStats.Count -ne 0 -or
        $checkpointWriteStats.Count -ne 1
    ) {
        throw "SPAWNING state recovery with matching PR #9 and unrelated PR #8 failed: did not recover PR #9 without spawning duplicate worker."
    }

    # Governed missing-checkpoint recovery tests:
    # 1. No checkpoint + PR #8 and #9 open + selector 9 => recover only #9 without duplicate spawn
    $mockItem9 = [PSCustomObject]@{
        WorkItemId = "TASK-AI-06"
        WorkItemPath = "docs/product-spec/work-items/TASK-AI-06.md"
        Branch = "feat/task-ai-06-orchestrator-supervisor"
        Author = "GEMINI"
    }
    $mockItem8 = [PSCustomObject]@{
        WorkItemId = "TASK-FOUND-03"
        WorkItemPath = "docs/product-spec/work-items/TASK-FOUND-03.md"
        Branch = "feat/task-found-03-api-worker-infrastructure"
        Author = "GEMINI"
    }

    $missingCpSpawnStats = @{ Count = 0 }
    $missingCpCheckpointStats = @{ Count = 0; LastState = $null }
    $recoveredSelectedResult = & {
        Initialize-ShipDeSupervisorState `
            -State $null `
            -PullRequestNumber 9 `
            -Repository "vinh05092001/shipde-platform" `
            -OpenPrResolver { @($simulatedMatchingPr, $simulatedUnrelatedPr) } `
            -ActiveWorkersResolver { @() } `
            -PrWorkItemResolver {
                param($pr)
                if ($pr.number -eq 9) { return $mockItem9 }
                if ($pr.number -eq 8) { return $mockItem8 }
                return $null
            } `
            -CodexParker { } `
            -WorkerStarter {
                param($it, $pr)
                $missingCpSpawnStats.Count++
                throw "WorkerStarter must NOT be called when recovering missing checkpoint from open PR!"
            } `
            -CheckpointWriter {
                param($s)
                $missingCpCheckpointStats.Count++
                $missingCpCheckpointStats.LastState = $s
            }
    } 6>$null

    if (
        $null -eq $recoveredSelectedResult -or
        $recoveredSelectedResult.State -ne "STARTED" -or
        $recoveredSelectedResult.WorkItemId -ne "TASK-AI-06" -or
        $recoveredSelectedResult.PullRequestNumber -ne 9 -or
        $recoveredSelectedResult.HeadSha -ne "fb02d345bbffeb40b21a75bcf6c296a12f49c575" -or
        $missingCpSpawnStats.Count -ne 0 -or
        $missingCpCheckpointStats.Count -ne 1 -or
        $null -eq $missingCpCheckpointStats.LastState -or
        $missingCpCheckpointStats.LastState.PullRequestNumber -ne 9
    ) {
        throw "Missing checkpoint recovery with selector 9 failed: did not reconstruct state for PR #9 properly without duplicate spawn."
    }

    # 2. No checkpoint + PR #8 and #9 open + no selector => fail closed
    $noSelectorFailClosedCaught = $false
    try {
        Initialize-ShipDeSupervisorState `
            -State $null `
            -PullRequestNumber 0 `
            -Repository "vinh05092001/shipde-platform" `
            -OpenPrResolver { @($simulatedMatchingPr, $simulatedUnrelatedPr) } `
            -WorkerStarter {
                param($it, $pr)
                throw "WorkerStarter must NOT be called when failing closed!"
            } `
            -CheckpointWriter { param($s) } | Out-Null
    } catch {
        if ($_.Exception.Message -match "Supply -PullRequestNumber to recover one exact Work Item") {
            $noSelectorFailClosedCaught = $true
        }
    }
    if (-not $noSelectorFailClosedCaught) {
        throw "Missing checkpoint with multiple open PRs and no selector fail-closed test failed: expected exception."
    }

    # 3. No checkpoint + invalid selector => fail closed
    $invalidSelectorCaught = $false
    try {
        Initialize-ShipDeSupervisorState `
            -State $null `
            -PullRequestNumber 999 `
            -Repository "vinh05092001/shipde-platform" `
            -OpenPrResolver { @($simulatedMatchingPr, $simulatedUnrelatedPr) } `
            -WorkerStarter { param($it, $pr) throw "Should not spawn" } `
            -CheckpointWriter { param($s) } | Out-Null
    } catch {
        if ($_.Exception.Message -match "Open implementation Pull Request #999 was not found") {
            $invalidSelectorCaught = $true
        }
    }
    if (-not $invalidSelectorCaught) {
        throw "Missing checkpoint with invalid selector fail-closed test failed: expected exception."
    }

    # Acceptance test 1: missing SessionId under StrictMode
    & {
        Set-StrictMode -Version Latest
        $rawIncomplete = @{
            WorkItemId = "TASK-AI-06"
            Branch = "feat/task-ai-06-orchestrator-supervisor"
            State = "STARTED"
        }
        $missingKeyThrows = $false
        try {
            $val = $rawIncomplete.SessionId
        } catch {
            $missingKeyThrows = $_.Exception.Message -match "The property 'SessionId' cannot be found on this object"
        }
        if (-not $missingKeyThrows) {
            throw "Test setup precondition failed: raw incomplete state did not trigger PropertyNotFoundStrict."
        }

        $normalizedState = Normalize-ShipDeSupervisorState -State $rawIncomplete
        if ($null -ne $normalizedState.SessionId) {
            throw "Normalized state SessionId was expected to be null."
        }
        if ($normalizedState.WorkItemId -ne "TASK-AI-06" -or $normalizedState.Branch -ne "feat/task-ai-06-orchestrator-supervisor") {
            throw "Normalized state did not preserve input properties."
        }
        $null = $normalizedState.PendingDispatch
        $null = $normalizedState.CiGate
        $null = $normalizedState.ExactHeadVerdict
        $null = $normalizedState.LastReviewTriggeredHead
        $null = $normalizedState.Harness

        $greenPr = [PSCustomObject]@{
            number = 9
            title = "[TASK-AI-06] Governed AO supervisor with AgentRouter fallback"
            headRefName = "feat/task-ai-06-orchestrator-supervisor"
            headRefOid = "fb02d345bbffeb40b21a75bcf6c296a12f49c575"
            isDraft = $false
            isCrossRepository = $false
            headRepository = "vinh05092001/shipde-platform"
            statusCheckRollup = @(
                [PSCustomObject]@{ name = "contract"; workflowName = "Current application"; conclusion = "SUCCESS"; startedAt = "2026-09-06T01:00:00Z" },
                [PSCustomObject]@{ name = "application-gate"; workflowName = "Current application"; conclusion = "SUCCESS"; startedAt = "2026-09-06T01:00:00Z" }
            )
        }
        $loopResult = Invoke-ShipDeSupervisorLoop `
            -State $rawIncomplete `
            -PrResolver { param($w, $b) return $greenPr } `
            -VerdictResolver { param($prNum, $head, $sId) return "PASS" } `
            -SleepHandler { param($i) } `
            -CheckpointWriter { param($s) }
        if ($loopResult -ne "READY_FOR_HUMAN_MERGE") {
            throw "Invoke-ShipDeSupervisorLoop failed to handle incomplete state under StrictMode."
        }
    }

    # Acceptance test 2: external lifecycle review (green PR triggers non-interactive review when SessionId is null)
    & {
        $externalState = @{
            WorkItemId = "TASK-AI-06"
            Branch = "feat/task-ai-06-orchestrator-supervisor"
            SessionId = $null
            State = "STARTED"
            PullRequestNumber = 9
            HeadSha = "fb02d345bbffeb40b21a75bcf6c296a12f49c575"
        }
        $greenPr = [PSCustomObject]@{
            number = 9
            title = "[TASK-AI-06] Governed AO supervisor with AgentRouter fallback"
            headRefName = "feat/task-ai-06-orchestrator-supervisor"
            headRefOid = "fb02d345bbffeb40b21a75bcf6c296a12f49c575"
            isDraft = $false
            isCrossRepository = $false
            headRepository = "vinh05092001/shipde-platform"
            statusCheckRollup = @(
                [PSCustomObject]@{ name = "contract"; workflowName = "Current application"; conclusion = "SUCCESS"; startedAt = "2026-09-06T01:00:00Z" },
                [PSCustomObject]@{ name = "application-gate"; workflowName = "Current application"; conclusion = "SUCCESS"; startedAt = "2026-09-06T01:00:00Z" }
            )
        }
        $externalLauncherCalls = [System.Collections.Generic.List[object]]::new()
        $writtenCheckpoints = [System.Collections.Generic.List[object]]::new()
        $pollStats = @{ Count = 0 }

        $loopResult = Invoke-ShipDeSupervisorLoop `
            -State $externalState `
            -PrResolver { param($w, $b) return $greenPr } `
            -ExternalReviewLauncher {
                param($prNumber, $head)
                $externalLauncherCalls.Add([PSCustomObject]@{ PrNumber = $prNumber; HeadSha = $head })
                return $true
            } `
            -VerdictResolver {
                param($prNumber, $head, $sId)
                if ($pollStats.Count -eq 0) { return $null }
                return "PASS"
            } `
            -SleepHandler {
                param($interval)
                $pollStats.Count++
            } `
            -CheckpointWriter {
                param($s)
                $writtenCheckpoints.Add($s)
            }

        if ($loopResult -ne "READY_FOR_HUMAN_MERGE") {
            throw "External lifecycle review failed: expected READY_FOR_HUMAN_MERGE, got '$loopResult'."
        }
        if ($externalLauncherCalls.Count -ne 1) {
            throw "External lifecycle review failed: ExternalReviewLauncher was called $($externalLauncherCalls.Count) times; expected 1."
        }
        if ($externalLauncherCalls[0].PrNumber -ne 9 -or $externalLauncherCalls[0].HeadSha -ne "fb02d345bbffeb40b21a75bcf6c296a12f49c575") {
            throw "External lifecycle review failed: launcher received incorrect PR number or head SHA."
        }
        $lastCp = $writtenCheckpoints[-1]
        if ($lastCp.LastReviewTriggeredHead -ne "fb02d345bbffeb40b21a75bcf6c296a12f49c575" -or
            $lastCp.LastAcknowledgedReviewTriggerHead -ne "fb02d345bbffeb40b21a75bcf6c296a12f49c575" -or
            $lastCp.ExactHeadVerdict -ne "PASS") {
            throw "External lifecycle review failed: checkpoint was not properly updated with review trigger head and PASS verdict."
        }
    }

    # Acceptance test 3: no interactive prompt (Invoke-ShipDeReview -NonInteractive runs without Read-Host)
    & {
        $testHandoffDir = Join-Path (Get-ShipDeTempDir) "task-ai-06-test-handoff-$([Guid]::NewGuid().ToString('N'))"
        try {
            New-Item -ItemType Directory -Path $testHandoffDir -Force | Out-Null
            $testPrNumber = 99999
            $testHeadSha = "aabbccddeeff00112233445566778899aabbccdd"
            $reviewPr = [PSCustomObject]@{
                number = $testPrNumber
                title = "[TASK-AI-06] Governed AO supervisor with AgentRouter fallback"
                headRefName = "feat/task-ai-06-orchestrator-supervisor"
                headRefOid = $testHeadSha
                isDraft = $false
                isCrossRepository = $false
                headRepository = "vinh05092001/shipde-platform"
                statusCheckRollup = @(
                    [PSCustomObject]@{ name = "contract"; workflowName = "Current application"; conclusion = "SUCCESS"; startedAt = "2026-09-06T01:00:00Z" },
                    [PSCustomObject]@{ name = "application-gate"; workflowName = "Current application"; conclusion = "SUCCESS"; startedAt = "2026-09-06T01:00:00Z" }
                )
                url = "https://github.com/vinh05092001/shipde-platform/pull/$testPrNumber"
            }
            $mockItem = [PSCustomObject]@{
                WorkItemId = "TASK-AI-06"
                Branch = "feat/task-ai-06-orchestrator-supervisor"
                Author = "GEMINI"
            }
            $postedComments = [System.Collections.Generic.List[string]]::new()
            $gitPrepStats = @{ Prepared = $false }

            # Test CHANGES_REQUIRED: must post review comment and return verdict without prompting for fix round
            $changesVerdict = Invoke-ShipDeReview `
                -PullRequestNumber $testPrNumber `
                -NonInteractive `
                -HandoffRoot $testHandoffDir `
                -OpenPrResolver { return @($reviewPr) } `
                -PrByNumberResolver { param($n) return $reviewPr } `
                -ItemResolver { param($p) return $mockItem } `
                -GitPreparer { param($p, $sha) $gitPrepStats.Prepared = $true } `
                -CodexExecutor {
                    param($schemaFile, $reviewFile, $execFile, $diagFile)
                    $fixture = '{"verdict":"CHANGES_REQUIRED","summary":"Changes required","findings":[{"priority":"P1","file":"scripts/ai/control.ps1","line":10,"title":"Test finding","description":"Must be fixed"}],"report":"## Review Report`n`n- [P1] Test finding`n`nVerdict: CHANGES_REQUIRED"}'
                    [System.IO.File]::WriteAllText($reviewFile, $fixture, [System.Text.UTF8Encoding]::new($false))
                } `
                -CommentPoster {
                    param($prNum, $commentFile)
                    $postedComments.Add((Get-Content $commentFile -Raw -Encoding UTF8))
                }

            if ($changesVerdict -ne "CHANGES_REQUIRED") {
                throw "Non-interactive review failed: expected CHANGES_REQUIRED, got '$changesVerdict'."
            }
            if (-not $gitPrepStats.Prepared) {
                throw "Non-interactive review failed: GitPreparer was not invoked."
            }
            if ($postedComments.Count -eq 0) {
                throw "Non-interactive review failed: review comments were not posted."
            }
            if ($postedComments[0] -notmatch "Test finding") {
                throw "Non-interactive review failed: posted comment did not contain expected review findings."
            }

            # Test PASS: must post review comment and return PASS without Read-Host
            $passComments = [System.Collections.Generic.List[string]]::new()
            $passVerdict = Invoke-ShipDeReview `
                -PullRequestNumber $testPrNumber `
                -NonInteractive `
                -HandoffRoot $testHandoffDir `
                -OpenPrResolver { return @($reviewPr) } `
                -PrByNumberResolver { param($n) return $reviewPr } `
                -ItemResolver { param($p) return $mockItem } `
                -CurrentGhUserResolver { return "chatgpt-codex-connector[bot]" } `
                -GitPreparer { param($p, $sha) } `
                -CodexExecutor {
                    param($schemaFile, $reviewFile, $execFile, $diagFile)
                    $fixture = '{"verdict":"PASS","summary":"All requirements satisfied","findings":[],"report":"## Review Report`n`nAll checks passed.`n`nVerdict: PASS"}'
                    [System.IO.File]::WriteAllText($reviewFile, $fixture, [System.Text.UTF8Encoding]::new($false))
                } `
                -CommentPoster {
                    param($prNum, $commentFile)
                    $passComments.Add((Get-Content $commentFile -Raw -Encoding UTF8))
                }

            if ($passVerdict -ne "PASS") {
                throw "Non-interactive review failed: expected PASS, got '$passVerdict'."
            }
            if ($passComments.Count -eq 0) {
                throw "Non-interactive review failed: PASS review comment was not posted."
            }
        } finally {
            if (Test-Path -LiteralPath $testHandoffDir) {
                Remove-Item -LiteralPath $testHandoffDir -Recurse -Force -ErrorAction SilentlyContinue
            }
        }
    }

    # Behavioral test: validate exact Codex argument vector, read-only sandbox, and structured final-message parsing
    & {
        $testSchemaFile = "C:\fake\review-schema.json"
        $testOutputFile = "C:\fake\review-output.json"
        $actualArgs = Get-ShipDeCodexReviewArgs -SchemaFile $testSchemaFile -LastMessageFile $testOutputFile
        $expectedArgs = @("exec", "--sandbox", "read-only", "--output-schema", $testSchemaFile, "--output-last-message", $testOutputFile, "-")

        if ($actualArgs.Count -ne $expectedArgs.Count) {
            throw "Behavioral test failed: Codex argument vector length mismatch ($($actualArgs.Count) vs $($expectedArgs.Count))."
        }
        for ($i = 0; $i -lt $expectedArgs.Count; $i++) {
            if ($actualArgs[$i] -ne $expectedArgs[$i]) {
                throw "Behavioral test failed: Codex argument vector mismatch at index $i. Expected '$($expectedArgs[$i])', got '$($actualArgs[$i])'."
            }
        }

        if ($actualArgs -contains "review") {
            throw "Behavioral test failed: Codex argument vector must not contain the 'review' subcommand."
        }
        $sandboxIdx = [array]::IndexOf($actualArgs, "--sandbox")
        if ($sandboxIdx -lt 0 -or $sandboxIdx -ge $actualArgs.Count - 1 -or $actualArgs[$sandboxIdx + 1] -ne "read-only") {
            throw "Behavioral test failed: Codex argument vector must include '--sandbox read-only'."
        }

        # Invocation test: Invoke-ShipDeReview passing exact argument vector to invoker and parsing final message
        $capturedInvokerArgs = $null
        $capturedInvokerPrompt = $null
        $testHandoffDir2 = Join-Path (Get-ShipDeTempDir) "task-ai-06-behavioral-handoff-$([Guid]::NewGuid().ToString('N'))"
        try {
            New-Item -ItemType Directory -Path $testHandoffDir2 -Force | Out-Null
            $invokerComments = [System.Collections.Generic.List[string]]::new()
            $samplePrNumber = 99998
            $samplePr = [PSCustomObject]@{
                number = $samplePrNumber
                title = "[TASK-AI-06] Governed AO supervisor with AgentRouter fallback"
                headRefName = "feat/task-ai-06-orchestrator-supervisor"
                headRefOid = "fb02d345bbffeb40b21a75bcf6c296a12f49c575"
                isDraft = $false
                isCrossRepository = $false
                headRepository = "vinh05092001/shipde-platform"
                statusCheckRollup = @(
                    [PSCustomObject]@{ name = "contract"; workflowName = "Current application"; conclusion = "SUCCESS"; startedAt = "2026-09-06T01:00:00Z" },
                    [PSCustomObject]@{ name = "application-gate"; workflowName = "Current application"; conclusion = "SUCCESS"; startedAt = "2026-09-06T01:00:00Z" }
                )
                url = "https://github.com/vinh05092001/shipde-platform/pull/$samplePrNumber"
            }
            $sampleItem = [PSCustomObject]@{
                WorkItemId = "TASK-AI-06"
                Branch = "feat/task-ai-06-orchestrator-supervisor"
                Author = "GEMINI"
            }

            $invokerVerdict = Invoke-ShipDeReview `
                -PullRequestNumber $samplePrNumber `
                -NonInteractive `
                -HandoffRoot $testHandoffDir2 `
                -OpenPrResolver { return @($samplePr) } `
                -PrByNumberResolver { param($n) return $samplePr } `
                -ItemResolver { param($p) return $sampleItem } `
                -CurrentGhUserResolver { return "chatgpt-codex-connector[bot]" } `
                -GitPreparer { param($p, $sha) } `
                -CodexInvoker {
                    param($argsVector, $stdinPrompt, $sFile, $rFile, $eFile, $dFile)
                    $script:capturedInvokerArgs = @($argsVector)
                    $script:capturedInvokerPrompt = $stdinPrompt
                    $sampleValidJson = '{"verdict":"CHANGES_REQUIRED","summary":"Actionable findings discovered","findings":[{"priority":"P1","file":"scripts/ai/control.ps1","line":1255,"title":"Exact codex syntax","description":"Use codex exec without review subcommand"}],"report":"## Review Report`n`n- [P1] Exact codex syntax - scripts/ai/control.ps1:1255`n  Use codex exec without review subcommand`n`nVerdict: CHANGES_REQUIRED"}'
                    [System.IO.File]::WriteAllText($rFile, $sampleValidJson, [System.Text.UTF8Encoding]::new($false))
                    [System.IO.File]::WriteAllText($eFile, "sample stdout", [System.Text.UTF8Encoding]::new($false))
                    [System.IO.File]::WriteAllText($dFile, "sample stderr", [System.Text.UTF8Encoding]::new($false))
                    return 0
                } `
                -CommentPoster {
                    param($prNum, $commentFile)
                    $invokerComments.Add((Get-Content $commentFile -Raw -Encoding UTF8))
                }

            if ($invokerVerdict -ne "CHANGES_REQUIRED") {
                throw "Behavioral test failed: expected CHANGES_REQUIRED verdict, got '$invokerVerdict'."
            }
            if ($null -eq $script:capturedInvokerArgs -or $script:capturedInvokerArgs -contains "review" -or $script:capturedInvokerArgs -notcontains "--sandbox") {
                throw "Behavioral test failed: Codex invoker did not receive expected arguments without review subcommand."
            }
            if ([string]::IsNullOrWhiteSpace($script:capturedInvokerPrompt) -or $script:capturedInvokerPrompt -notmatch "detached HEAD") {
                throw "Behavioral test failed: Codex review prompt was not supplied to stdin."
            }
            if ($invokerComments.Count -eq 0 -or $invokerComments[0] -notmatch "Exact codex syntax") {
                throw "Behavioral test failed: review comments did not include parsed structured findings."
            }

            # Failure preservation test: verify diagnostics are preserved and reported on exit failure
            $failureHandledCorrectly = $false
            try {
                Invoke-ShipDeReview `
                    -PullRequestNumber $samplePrNumber `
                    -NonInteractive `
                    -HandoffRoot $testHandoffDir2 `
                    -OpenPrResolver { return @($samplePr) } `
                    -PrByNumberResolver { param($n) return $samplePr } `
                    -ItemResolver { param($p) return $sampleItem } `
                    -CurrentGhUserResolver { return "chatgpt-codex-connector[bot]" } `
                    -GitPreparer { param($p, $sha) } `
                    -CodexInvoker {
                        param($argsVector, $stdinPrompt, $sFile, $rFile, $eFile, $dFile)
                        [System.IO.File]::WriteAllText($dFile, "Simulated failure diagnostics", [System.Text.UTF8Encoding]::new($false))
                        return 2
                    } `
                    -CommentPoster { param($prNum, $commentFile) }
            } catch {
                if ($_.Exception.Message -match "Codex review failed with exit code 2.*Diagnostics: .*pr-$samplePrNumber-.*-diagnostics\.txt") {
                    $failureHandledCorrectly = $true
                }
            }
            if (-not $failureHandledCorrectly) {
                throw "Behavioral test failed: execution failure did not preserve and report diagnostics path."
            }
        } finally {
            if (Test-Path -LiteralPath $testHandoffDir2) {
                Remove-Item -LiteralPath $testHandoffDir2 -Recurse -Force -ErrorAction SilentlyContinue
            }
        }

        # Strict schema parser validation: verify parser was not weakened to accept arbitrary prose
        $proseWasRejected = $false
        try {
            ConvertFrom-ShipDeCodexReviewOutput -OutputText "This is prose without JSON`n`nVerdict: PASS" | Out-Null
        } catch {
            $proseWasRejected = $true
        }
        if (-not $proseWasRejected) {
            throw "Behavioral test failed: ConvertFrom-ShipDeCodexReviewOutput was weakened to accept prose."
        }
    }

    # Acceptance test 4: no duplicate worker (PR-only recovery when no reusable AO session exists)
    & {
        $workerStarterStats = @{ Called = $false }
        $checkpointSavedStats = @{ State = $null }
        $reconstructed = Initialize-ShipDeSupervisorState `
            -State $null `
            -PullRequestNumber 9 `
            -Repository "vinh05092001/shipde-platform" `
            -OpenPrResolver { @($simulatedMatchingPr, $simulatedUnrelatedPr) } `
            -ActiveWorkersResolver { @() } `
            -PrWorkItemResolver {
                param($pr)
                if ($pr.number -eq 9) { return $mockItem9 }
                return $null
            } `
            -WorkerStarter {
                param($it, $pr)
                $workerStarterStats.Called = $true
                throw "WorkerStarter must NEVER be called when recovering state for existing open PR!"
            } `
            -CheckpointWriter {
                param($s)
                $checkpointSavedStats.State = $s
            }

        if ($workerStarterStats.Called) {
            throw "No duplicate worker test failed: WorkerStarter was invoked."
        }
        if ($null -eq $reconstructed) {
            throw "No duplicate worker test failed: reconstructed state was null."
        }
        if ($reconstructed.State -ne "STARTED" -or
            $reconstructed.WorkItemId -ne "TASK-AI-06" -or
            $reconstructed.PullRequestNumber -ne 9 -or
            $null -ne $reconstructed.SessionId -or
            $null -ne $reconstructed.Harness) {
            throw "No duplicate worker test failed: reconstructed state properties mismatch."
        }
        $savedState = $checkpointSavedStats.State
        if ($null -eq $savedState -or $savedState.PullRequestNumber -ne 9 -or $null -ne $savedState.SessionId) {
            throw "No duplicate worker test failed: saved checkpoint did not match reconstructed state."
        }
        # StrictMode validation: verify all 27 properties can be accessed on reconstructed state
        & {
            Set-StrictMode -Version Latest
            $null = $reconstructed.SessionId
            $null = $reconstructed.Harness
            $null = $reconstructed.PendingDispatch
            $null = $reconstructed.CiGate
            $null = $reconstructed.ExactHeadVerdict
            $null = $reconstructed.LastReviewTriggeredHead
            $null = $reconstructed.LastAcknowledgedReviewTriggerHead
            $null = $reconstructed.LastCiRepairHead
            $null = $reconstructed.LastReviewRepairHead
            $null = $reconstructed.RouterFailure
        }
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
    $temporaryPath = Join-Path (Get-ShipDeTempDir) "supervisor-test-$(Get-Random).json"
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

    $scriptRepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
    $aiToolchainPath = Join-Path $scriptRepoRoot "docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md"
    if (Test-Path $aiToolchainPath) {
        $aiToolchainContent = Get-Content $aiToolchainPath -Raw -Encoding UTF8
        if ($aiToolchainContent -match "every approved router fallback is treated as exhausted and delivery stops fail-closed") {
            throw "AI-TOOLCHAIN-DECISIONS.md policy regression test failed: contradictory fallback exhaustion statement found."
        }
        if ($aiToolchainContent -notmatch "In accordance with AI-SUP-18, bounded 9Router error records are diagnostic metadata") {
            throw "AI-TOOLCHAIN-DECISIONS.md policy regression test failed: AI-SUP-18 harmonization missing."
        }
    }

    # Pinned AO 0.12.12 session list behavioral fixtures (AC-AI-63 / TASK-AI-06):
    $ao01212ObservedNonEmptyJson = @'
{
  "data": [
    {
      "id": "shipde-platform-3",
      "projectId": "shipde-platform",
      "role": "worker",
      "status": "exited",
      "harness": "claude-code",
      "isTerminated": false,
      "lastActivityAt": "2026-09-07T07:20:49.1217509Z",
      "createdAt": "2026-09-05T05:32:08.7228602Z",
      "updatedAt": "2026-09-07T07:24:59.1438863Z"
    }
  ],
  "meta": {
    "hiddenTerminatedCount": 0,
    "hiddenOrchestratorCount": 2
  }
}
'@

    $nonEmptySessions = @(Get-ShipDeAoSessions -Project "shipde-platform" -TextResolver { param($p) return $ao01212ObservedNonEmptyJson })
    if ($nonEmptySessions.Count -ne 1) {
        throw "AO 0.12.12 observed non-empty session collection fixture failed: expected 1 session, got $($nonEmptySessions.Count)."
    }
    $observedSession = $nonEmptySessions[0]
    if ((Get-ShipDeAoSessionId -Response $observedSession) -ne "shipde-platform-3" -or
        [string]$observedSession.projectId -ne "shipde-platform" -or
        [string]$observedSession.role -ne "worker" -or
        [string]$observedSession.harness -ne "claude-code" -or
        [string]$observedSession.status -ne "exited" -or
        [bool]$observedSession.isTerminated -ne $false) {
        throw "AO 0.12.12 observed non-empty session collection properties verification failed."
    }

    $ao01212ObservedEmptyJson = @'
{
  "data": [],
  "meta": {
    "hiddenTerminatedCount": 0,
    "hiddenOrchestratorCount": 0
  }
}
'@

    $emptySessions = @(Get-ShipDeAoSessions -Project "shipde-platform" -TextResolver { param($p) return $ao01212ObservedEmptyJson })
    if ($emptySessions.Count -ne 0) {
        throw "AO 0.12.12 observed empty session collection fixture failed: expected 0 sessions, got $($emptySessions.Count)."
    }

    # Already-supported shapes:
    # 1. Bare array
    $bareSessions = @(Get-ShipDeAoSessions -Project "shipde-platform" -TextResolver { param($p) return '[{"id":"bare-1","role":"worker"}]' })
    if ($bareSessions.Count -ne 1 -or (Get-ShipDeAoSessionId -Response $bareSessions[0]) -ne "bare-1") {
        throw "Bare array session collection fixture failed."
    }

    # 2. Wrapped result array
    $resultSessions = @(Get-ShipDeAoSessions -Project "shipde-platform" -TextResolver { param($p) return '{"result":[{"id":"res-1","role":"worker"}]}' })
    if ($resultSessions.Count -ne 1 -or (Get-ShipDeAoSessionId -Response $resultSessions[0]) -ne "res-1") {
        throw "Result array session collection fixture failed."
    }

    # 3. Wrapped result with nested sessions
    $resultNestedSessions = @(Get-ShipDeAoSessions -Project "shipde-platform" -TextResolver { param($p) return '{"result":{"sessions":[{"id":"nested-1","role":"worker"}]}}' })
    if ($resultNestedSessions.Count -ne 1 -or (Get-ShipDeAoSessionId -Response $resultNestedSessions[0]) -ne "nested-1") {
        throw "Result nested sessions collection fixture failed."
    }

    # 4. Top-level sessions
    $directSessions = @(Get-ShipDeAoSessions -Project "shipde-platform" -TextResolver { param($p) return '{"sessions":[{"id":"dir-1","role":"worker"}]}' })
    if ($directSessions.Count -ne 1 -or (Get-ShipDeAoSessionId -Response $directSessions[0]) -ne "dir-1") {
        throw "Direct sessions collection fixture failed."
    }

    # Fail-closed checks:
    # 1. Unrelated array rejected
    $unrelatedArrayRejected = $false
    try {
        Get-ShipDeAoSessions -Project "shipde-platform" -TextResolver { param($p) return '{"logs":["log line 1","log line 2"],"errors":["err 1"]}' } | Out-Null
    } catch {
        $unrelatedArrayRejected = $_.Exception.Message -match "AO session ls JSON does not contain a session collection"
    }
    if (-not $unrelatedArrayRejected) {
        throw "Fail-closed check failed: unrelated array was accepted as session collection."
    }

    # 2. Missing collection rejected
    $missingCollectionRejected = $false
    try {
        Get-ShipDeAoSessions -Project "shipde-platform" -TextResolver { param($p) return '{"meta":{"count":0}}' } | Out-Null
    } catch {
        $missingCollectionRejected = $_.Exception.Message -match "AO session ls JSON does not contain a session collection"
    }
    if (-not $missingCollectionRejected) {
        throw "Fail-closed check failed: missing session collection was accepted."
    }

    # 3. Log-contaminated JSON rejected
    $logContaminatedRejected = $false
    try {
        Get-ShipDeAoSessions -Project "shipde-platform" -TextResolver { param($p) return "time=2026-09-07 level=INFO msg=ready`n" + $ao01212ObservedNonEmptyJson } | Out-Null
    } catch {
        $logContaminatedRejected = $true
    }
    if (-not $logContaminatedRejected) {
        throw "Fail-closed check failed: log-contaminated JSON was accepted."
    }

    # 4. Non-JSON string rejected
    $malformedRejected = $false
    try {
        Get-ShipDeAoSessions -Project "shipde-platform" -TextResolver { param($p) return "not json at all" } | Out-Null
    } catch {
        $malformedRejected = $true
    }
    if (-not $malformedRejected) {
        throw "Fail-closed check failed: malformed JSON was accepted."
    }
    # Finding 2 regression test: Legacy StatusContext targetUrl must never forge github-actions
    $forgedStatusContext = [PSCustomObject]@{
        __typename = "StatusContext"
        context = "contract"
        state = "SUCCESS"
        targetUrl = "https://github.com/vinh05092001/shipde-platform/actions/runs/99999"
    }
    $forgedProvider = Get-ShipDeCheckProvider -Check $forgedStatusContext
    if ($forgedProvider.StartsWith("github-actions", [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "StatusContext provider security regression: forged targetUrl was classified as github-actions."
    }

    # Finding 4 regression test: AO 0.12.12 session with status=exited, isTerminated=false must not be treated as active worker
    $exitedSessionObj = $observedSession
    $activeFromExited = @(@($exitedSessionObj) | Where-Object {
        $isTerm = [bool](Get-ShipDeObjectProperty -Object $_ -Names @("isTerminated", "is_terminated"))
        $role = [string](Get-ShipDeObjectProperty -Object $_ -Names @("role", "kind"))
        $status = [string](Get-ShipDeObjectProperty -Object $_ -Names @("status", "state"))
        (-not $isTerm) -and ($role -in @("worker", "")) -and ($status -notin @("exited", "terminated", "failed", "completed", "stopped"))
    })
    if ($activeFromExited.Count -ne 0) {
        throw "AO session activity resolution failed: exited session with isTerminated=false was treated as active worker."
    }

    # Finding 5 regression test: Persisted PendingDispatch state is safely acknowledged on recovery without duplicate replay
    $pendingNudgeState = @{
        WorkItemId = "TASK-AI-06"
        Branch = "feat/task-ai-06-orchestrator-supervisor"
        State = "IDLE"
        PendingDispatch = @{ Type = "NUDGE"; Time = (Get-Date).ToUniversalTime().ToString("o") }
        NudgeCount = 0
    }
    $pendingNudgeState = Normalize-ShipDeSupervisorState -State $pendingNudgeState
    $recoveredLoopState = $null
    try {
        Invoke-ShipDeSupervisorLoop `
            -State $pendingNudgeState `
            -PrResolver { return $null } `
            -SleepHandler { param($i) throw "STOP_LOOP" } `
            -CheckpointWriter { param($s) $recoveredLoopState = $s } | Out-Null
    } catch {}
    if ($null -ne $recoveredLoopState) {
        if ($recoveredLoopState.NudgeCount -lt 1 -or $null -ne $recoveredLoopState.PendingDispatch) {
            throw "PendingDispatch recovery regression: Nudge intent was not acknowledged or PendingDispatch was not cleared."
        }
    }

    # 1. Single-supervisor locking behavioral test
    $testLockFile = Join-Path (Get-ShipDeTempDir) "supervisor-test-$([Guid]::NewGuid().ToString('N')).lock"
    try {
        Assert-ShipDeSupervisorLock -LockFile $testLockFile -WorkItemId "TASK-AI-06" -CurrentPid 12345
        if (-not (Test-Path -LiteralPath $testLockFile)) {
            throw "Single-supervisor locking test failed: lock file was not created."
        }
        $mockActiveProc = [PSCustomObject]@{ Id = 12345; HasExited = $false }
        $lockRejected = $false
        try {
            Assert-ShipDeSupervisorLock -LockFile $testLockFile -WorkItemId "TASK-AI-07" -CurrentPid 67890 -ProcessResolver { param($id) return $mockActiveProc }
        } catch {
            $lockRejected = $_.Exception.Message -match "Another supervisor instance"
        }
        if (-not $lockRejected) {
            throw "Single-supervisor locking test failed: concurrent active lock was not rejected."
        }
        Assert-ShipDeSupervisorLock -LockFile $testLockFile -WorkItemId "TASK-AI-06" -CurrentPid 67890 -ProcessResolver { param($id) return $null }
        Release-ShipDeSupervisorLock -LockFile $testLockFile -CurrentPid 67890
        if (Test-Path -LiteralPath $testLockFile) {
            throw "Single-supervisor locking test failed: lock file was not removed on release."
        }
    } finally {
        if (Test-Path -LiteralPath $testLockFile) {
            Remove-Item -LiteralPath $testLockFile -Force -ErrorAction SilentlyContinue
        }
    }

    # 2. Stale-HEAD rejection & review verdict matching test
    $testOldHeadSha = "1111111111111111111111111111111111111111"
    $testNewHeadSha = "2222222222222222222222222222222222222222"
    $staleHeadPr = [PSCustomObject]@{
        number = 9
        title = "[TASK-AI-06] Test PR"
        headRefName = "feat/task-ai-06-orchestrator-supervisor"
        headRefOid = $testNewHeadSha
        isDraft = $false
        isCrossRepository = $false
        headRepository = "vinh05092001/shipde-platform"
        statusCheckRollup = @(
            [PSCustomObject]@{ name = "contract"; workflowName = "Current application"; conclusion = "SUCCESS"; startedAt = "2026-09-06T01:05:00Z" },
            [PSCustomObject]@{ name = "application-gate"; workflowName = "Current application"; conclusion = "SUCCESS"; startedAt = "2026-09-06T01:05:00Z" }
        )
    }
    $stateWithStaleVerdict = @{
        WorkItemId = "TASK-AI-06"
        Branch = "feat/task-ai-06-orchestrator-supervisor"
        HeadSha = $testOldHeadSha
        ExactHeadVerdict = "PASS"
        State = "STARTED"
    }
    $stateWithStaleVerdict = Normalize-ShipDeSupervisorState -State $stateWithStaleVerdict
    $recoveredLoopStaleState = $null
    try {
        Invoke-ShipDeSupervisorLoop `
            -State $stateWithStaleVerdict `
            -PrResolver { param($w, $b) return $staleHeadPr } `
            -VerdictResolver { param($p, $h, $s) return $null } `
            -ExternalReviewLauncher { param($p, $h) return $true } `
            -SleepHandler { param($i) throw "STOP_LOOP" } `
            -CheckpointWriter { param($s) $recoveredLoopStaleState = $s } | Out-Null
    } catch {}
    if ($null -ne $recoveredLoopStaleState) {
        if ($recoveredLoopStaleState.HeadSha -ne $testNewHeadSha -or $null -ne $recoveredLoopStaleState.ExactHeadVerdict) {
            throw "Stale-HEAD rejection test failed: old PASS verdict was not invalidated upon new HEAD."
        }
    }

    # 3. Bot review timeout test
    $reviewTimeoutState = @{
        WorkItemId = "TASK-AI-06"
        Branch = "feat/task-ai-06-orchestrator-supervisor"
        State = "STARTED"
        HeadSha = $testNewHeadSha
        LastReviewTriggeredHead = $testNewHeadSha
        LastAcknowledgedReviewTriggerHead = $testNewHeadSha
        LastReviewTriggeredAt = (Get-Date).ToUniversalTime().AddMinutes(-25).ToString("o")
    }
    $reviewTimeoutCaught = $false
    try {
        Invoke-ShipDeSupervisorLoop `
            -State $reviewTimeoutState `
            -ReviewTimeoutMinutes 20 `
            -PrResolver { param($w, $b) return $staleHeadPr } `
            -VerdictResolver { param($p, $h, $s) return $null } `
            -SleepHandler { param($i) throw "STOP_LOOP" } `
            -CheckpointWriter { param($s) } | Out-Null
    } catch {
        $reviewTimeoutCaught = $_.Exception.Message -match "AO Codex review timed out after 20 minute\(s\)"
    }
    if (-not $reviewTimeoutCaught) {
        throw "Bot review timeout test failed: 25-minute elapsed review did not trigger fail-closed timeout."
    }

    # 4. No-duplicate dispatch behavioral test (CI repair, review repair, review trigger, and nudge)
    $ciFailingPr = [PSCustomObject]@{
        number = 9
        title = "[TASK-AI-06] Test PR"
        headRefName = "feat/task-ai-06-orchestrator-supervisor"
        headRefOid = $testNewHeadSha
        isDraft = $false
        isCrossRepository = $false
        headRepository = "vinh05092001/shipde-platform"
        statusCheckRollup = @(
            [PSCustomObject]@{ name = "contract"; workflowName = "Current application"; conclusion = "FAILURE"; startedAt = "2026-09-06T01:05:00Z" }
        )
    }
    $noDupState = @{
        WorkItemId = "TASK-AI-06"
        Branch = "feat/task-ai-06-orchestrator-supervisor"
        State = "STARTED"
        LastAcknowledgedCiRepairHead = $testNewHeadSha
    }
    $noDupState = Normalize-ShipDeSupervisorState -State $noDupState
    $noDupStats = @{ Iterations = 0 }
    try {
        Invoke-ShipDeSupervisorLoop `
            -State $noDupState `
            -PrResolver { param($w, $b) return $ciFailingPr } `
            -SleepHandler {
                param($i)
                $noDupStats.Iterations++
                if ($noDupStats.Iterations -ge 2) { throw "STOP_LOOP" }
            } `
            -CheckpointWriter { param($s) } | Out-Null
    } catch {}
    if ($noDupState.RepairCount -ne 0) {
        throw "No-duplicate CI repair test failed: repair was dispatched again for already-acknowledged HEAD."
    }

    # 5. Repair budget exhaustion test
    $exhaustedBudgetState = @{
        WorkItemId = "TASK-AI-06"
        Branch = "feat/task-ai-06-orchestrator-supervisor"
        State = "STARTED"
        RepairCount = 5
    }
    $exhaustedBudgetState = Normalize-ShipDeSupervisorState -State $exhaustedBudgetState
    $budgetCaught = $false
    try {
        Invoke-ShipDeSupervisorLoop `
            -State $exhaustedBudgetState `
            -MaxRepairBudget 5 `
            -PrResolver { param($w, $b) return $ciFailingPr } `
            -SleepHandler { param($i) throw "STOP_LOOP" } `
            -CheckpointWriter { param($s) } | Out-Null
    } catch {
        $budgetCaught = $_.Exception.Message -match "Supervisor repair budget exhausted"
    }
    if (-not $budgetCaught) {
        throw "Repair budget exhaustion test failed: exceeding MaxRepairBudget did not stop fail-closed."
    }

    # Real-response regression fixture: AO 0.12.12 session with status=pr_open, isTerminated=false, harness=claude-code, author=GEMINI
    $ao01212ObservedPrOpenJson = @'
{
  "data": [
    {
      "id": "shipde-platform-3",
      "projectId": "shipde-platform",
      "role": "worker",
      "status": "pr_open",
      "harness": "claude-code",
      "isTerminated": false,
      "lastActivityAt": "2026-09-07T07:20:49.1217509Z",
      "createdAt": "2026-09-05T05:32:08.7228602Z",
      "updatedAt": "2026-09-07T07:24:59.1438863Z"
    }
  ],
  "meta": {
    "hiddenTerminatedCount": 0,
    "hiddenOrchestratorCount": 0
  }
}
'@

    # 1. pr_open is a parked/handoff lifecycle state, not an actively executing worker
    $prOpenSessions = @(Get-ShipDeAoSessions -Project "shipde-platform" -TextResolver { param($p) return $ao01212ObservedPrOpenJson })
    if ($prOpenSessions.Count -ne 1) {
        throw "AO 0.12.12 observed pr_open session collection fixture failed: expected 1 session."
    }
    $prOpenSession = $prOpenSessions[0]
    $prOpenActivity = Get-ShipDeSessionActivityState -Session $prOpenSession
    if ($prOpenActivity -ne "PARKED") {
        throw "AO 0.12.12 pr_open session activity state test failed: expected PARKED, got '$prOpenActivity'."
    }

    # Active workers resolver must exclude pr_open and parked sessions
    $activeFromPrOpen = @(@($prOpenSession) | Where-Object {
        $isTerm = [bool](Get-ShipDeObjectProperty -Object $_ -Names @("isTerminated", "is_terminated"))
        $role = [string](Get-ShipDeObjectProperty -Object $_ -Names @("role", "kind"))
        $status = [string](Get-ShipDeObjectProperty -Object $_ -Names @("status", "state"))
        (-not $isTerm) -and ($role -in @("worker", "")) -and ($status -notin @("exited", "terminated", "failed", "completed", "stopped", "pr_open", "parked"))
    })
    if ($activeFromPrOpen.Count -ne 0) {
        throw "AO session activity resolution failed: pr_open session was treated as active worker."
    }

    # 2 & 3. Explicit PR-only review proceeds without binding an implementation session,
    # and Assert-ShipDeReusedAoSession is not called until a worker is actually needed for a repair.
    $prRecoveryItem = [PSCustomObject]@{
        WorkItemId = "TASK-AI-06"
        WorkItemPath = "docs/product-spec/work-items/TASK-AI-06.md"
        Branch = "feat/task-ai-06-orchestrator-supervisor"
        Author = "GEMINI"
    }
    $prRecoveryPr = [PSCustomObject]@{
        number = 9
        title = "[TASK-AI-06] Governed AO supervisor with AgentRouter fallback"
        headRefName = "feat/task-ai-06-orchestrator-supervisor"
        headRefOid = "f43becbba10ea06edc9961862deb412ffefe888e"
        isDraft = $false
        isCrossRepository = $false
        headRepository = "vinh05092001/shipde-platform"
        statusCheckRollup = @(
            [PSCustomObject]@{ name = "contract"; workflowName = "Current application"; conclusion = "SUCCESS"; startedAt = "2026-09-06T01:00:00Z" },
            [PSCustomObject]@{ name = "application-gate"; workflowName = "Current application"; conclusion = "SUCCESS"; startedAt = "2026-09-06T01:00:00Z" }
        )
    }
    $reconstructedPrOnlyState = Initialize-ShipDeSupervisorState `
        -State $null `
        -PullRequestNumber 9 `
        -Repository "vinh05092001/shipde-platform" `
        -OpenPrResolver { @($prRecoveryPr) } `
        -ActiveWorkersResolver { @() } `
        -PrWorkItemResolver { param($pr) return $prRecoveryItem } `
        -WorkerStarter { param($it, $pr) throw "WorkerStarter must NOT be called for PR-only recovery!" } `
        -CheckpointWriter { param($s) }

    if ($null -eq $reconstructedPrOnlyState -or
        $null -ne $reconstructedPrOnlyState.SessionId -or
        $null -ne $reconstructedPrOnlyState.Harness -or
        $reconstructedPrOnlyState.PullRequestNumber -ne 9 -or
        $reconstructedPrOnlyState.HeadSha -ne "f43becbba10ea06edc9961862deb412ffefe888e" -or
        $reconstructedPrOnlyState.State -ne "STARTED") {
        throw "Explicit PR-only review state initialization failed: bound session prematurely or set invalid properties."
    }

    # 4 & 5. When a trusted CHANGES_REQUIRED verdict arrives:
    # 5a. If ownership cannot be proven, return BLOCKED with the exact session ID.
    $unprovenBlockedCaught = $false
    try {
        Ensure-ShipDeRepairWorker `
            -State $reconstructedPrOnlyState `
            -PullRequest $prRecoveryPr `
            -Project "shipde-platform" `
            -SessionsResolver { param($p) return $prOpenSessions } `
            -SessionDetailResolver { param($id, $p) return [PSCustomObject]@{ id = "shipde-platform-3"; branch = "feat/task-ai-06-orchestrator-supervisor"; harness = "claude-code"; status = "pr_open" } } `
            -OwnershipVerifier { param($sess, $item, $proj) return $false } `
            -CheckpointWriter { param($s) } | Out-Null
    } catch {
        if ($_.Exception.Message -match "BLOCKED:.*shipde-platform-3") {
            $unprovenBlockedCaught = $true
        }
    }
    if (-not $unprovenBlockedCaught) {
        throw "Unproven ownership of parked disallowed session test failed: did not return BLOCKED with exact session ID."
    }
    if ($reconstructedPrOnlyState["State"] -ne "BLOCKED") {
        throw "Unproven ownership of parked disallowed session test failed: state was not set to BLOCKED."
    }

    # Reset state for proven ownership test
    $reconstructedPrOnlyState["State"] = "STARTED"

    # 5b & 6. When ownership is proven: safely release/archive only that session, then spawn agy.
    # Never run claude-code and agy concurrently on the same branch/worktree.
    $releasedDisallowedSessions = [System.Collections.Generic.List[string]]::new()
    $spawnedHarnessHistory = [System.Collections.Generic.List[object]]::new()
    $concurrencyViolationObserved = $false

    $repairSessionId = Ensure-ShipDeRepairWorker `
        -State $reconstructedPrOnlyState `
        -PullRequest $prRecoveryPr `
        -Project "shipde-platform" `
        -SessionsResolver { param($p) return $prOpenSessions } `
        -SessionDetailResolver { param($id, $p) return [PSCustomObject]@{ id = "shipde-platform-3"; branch = "feat/task-ai-06-orchestrator-supervisor"; harness = "claude-code"; status = "pr_open" } } `
        -OwnershipVerifier { param($sess, $item, $proj) return $true } `
        -SessionReleaser {
            param($sid, $proj)
            $releasedDisallowedSessions.Add($sid)
        } `
        -WorkerStarter {
            param($item, $prompt)
            # Concurrency check: shipde-platform-3 MUST be released before agy is spawned
            if (-not $releasedDisallowedSessions.Contains("shipde-platform-3")) {
                $script:concurrencyViolationObserved = $true
            }
            $spawnedHarnessHistory.Add([PSCustomObject]@{ Author = $item.Author; Harness = "agy" })
            return [PSCustomObject]@{ SessionId = "shipde-platform-4"; Harness = "agy" }
        } `
        -CheckpointWriter { param($s) }

    if ($concurrencyViolationObserved) {
        throw "Concurrency violation test failed: agy worker was started before parked claude-code session was safely released."
    }
    if ($releasedDisallowedSessions.Count -ne 1 -or $releasedDisallowedSessions[0] -ne "shipde-platform-3") {
        throw "Disallowed session release test failed: shipde-platform-3 was not released."
    }
    if ($spawnedHarnessHistory.Count -ne 1 -or $spawnedHarnessHistory[0].Harness -ne "agy") {
        throw "Repair harness selection test failed: author GEMINI must select agy harness."
    }
    if ($repairSessionId -ne "shipde-platform-4" -or $reconstructedPrOnlyState["SessionId"] -ne "shipde-platform-4" -or $reconstructedPrOnlyState["Harness"] -ne "agy") {
        throw "Repair session binding test failed: state was not updated to new agy session."
    }

    # End-to-end loop test: PR-only state + CHANGES_REQUIRED verdict safely recovers with agy worker and then completes on PASS
    & {
        $loopE2eState = @{
            WorkItemId = "TASK-AI-06"
            WorkItemPath = "docs/product-spec/work-items/TASK-AI-06.md"
            Branch = "feat/task-ai-06-orchestrator-supervisor"
            Author = "GEMINI"
            State = "STARTED"
            PullRequestNumber = 9
            HeadSha = "f43becbba10ea06edc9961862deb412ffefe888e"
            SessionId = $null
            Harness = $null
        }
        $e2eReleasedSessions = [System.Collections.Generic.List[string]]::new()
        $e2eDeliveredMessages = [System.Collections.Generic.List[object]]::new()
        $e2eCheckpoints = [System.Collections.Generic.List[object]]::new()
        $loopStats = @{ Iterations = 0 }

        $e2eResult = Invoke-ShipDeSupervisorLoop `
            -State $loopE2eState `
            -PrResolver { param($w, $b) return $prRecoveryPr } `
            -VerdictResolver {
                param($prNum, $head, $sId)
                if ($loopStats.Iterations -eq 0) { return "CHANGES_REQUIRED" }
                return "PASS"
            } `
            -SessionsResolver { param($p) return $prOpenSessions } `
            -SessionDetailResolver {
                param($id, $p)
                if ($id -eq "shipde-platform-3") {
                    return [PSCustomObject]@{ id = "shipde-platform-3"; branch = "feat/task-ai-06-orchestrator-supervisor"; harness = "claude-code"; status = "pr_open" }
                }
                if ($id -eq "shipde-platform-4") {
                    return [PSCustomObject]@{ id = "shipde-platform-4"; branch = "feat/task-ai-06-orchestrator-supervisor"; harness = "agy"; status = "idle" }
                }
                return $null
            } `
            -OwnershipVerifier { param($sess, $item, $proj) return $true } `
            -SessionReleaser { param($sid, $proj) $e2eReleasedSessions.Add($sid) } `
            -WorkerStarter {
                param($item, $prompt)
                return [PSCustomObject]@{ SessionId = "shipde-platform-4"; Harness = "agy" }
            } `
            -MessageSender {
                param($sid, $msg)
                $e2eDeliveredMessages.Add([PSCustomObject]@{ SessionId = $sid; Message = $msg })
                return $true
            } `
            -SleepHandler {
                param($interval)
                $loopStats.Iterations++
            } `
            -CheckpointWriter {
                param($s)
                $e2eCheckpoints.Add($s)
            }

        if ($e2eResult -ne "READY_FOR_HUMAN_MERGE") {
            throw "End-to-end loop test failed: expected READY_FOR_HUMAN_MERGE, got '$e2eResult'."
        }
        if ($e2eReleasedSessions.Count -ne 1 -or $e2eReleasedSessions[0] -ne "shipde-platform-3") {
            throw "End-to-end loop test failed: shipde-platform-3 was not safely released."
        }
        if ($e2eDeliveredMessages.Count -ne 1 -or $e2eDeliveredMessages[0].SessionId -ne "shipde-platform-4") {
            throw "End-to-end loop test failed: review findings message was not delivered to newly spawned agy worker."
        }
        $finalE2eState = $e2eCheckpoints[-1]
        if ($null -eq $finalE2eState -or $finalE2eState.SessionId -ne "shipde-platform-4" -or $finalE2eState.Harness -ne "agy") {
            throw "End-to-end loop test failed: final checkpoint state does not reflect newly bound agy worker."
        }
    }

    # ------------------------------------------------------------------------------------------------
    # TASK-AI-06 Round 19 Regression Test Suite:
    # 1. Untrusted skipped posting does NOT acknowledge review trigger or start bot-wait timer
    # 2. Exact-HEAD bot request created once and persists comment ID idempotently
    # 3. Timeout starts only after successful bot request creation
    # 4. Trusted CHANGES_REQUIRED automatically dispatches all findings to agy
    # 5. Crash/restart during PendingDispatch does not drop repairs and does not duplicate
    # 6. Bounded PARKED lifecycle fail-closed validation
    # ------------------------------------------------------------------------------------------------

    # Test 1: Untrusted skipped posting does NOT acknowledge review trigger or start bot-wait timer
    & {
        $testPr = [PSCustomObject]@{
            number = 9
            headRefOid = "c0ffee112233445566778899aabbccddeeff0011"
            isDraft = $false
            title = "[TASK-AI-06] Test PR"
            headRefName = "feat/task-ai-06-orchestrator-supervisor"
            headRepository = "vinh05092001/shipde-platform"
            isCrossRepository = $false
            statusCheckRollup = @(
                [PSCustomObject]@{
                    name = "contract"
                    conclusion = "SUCCESS"
                    checkSuite = [PSCustomObject]@{ app = [PSCustomObject]@{ slug = "github-actions"; name = "GitHub Actions" } }
                },
                [PSCustomObject]@{
                    name = "application-gate"
                    conclusion = "SUCCESS"
                    checkSuite = [PSCustomObject]@{ app = [PSCustomObject]@{ slug = "github-actions"; name = "GitHub Actions" } }
                }
            )
        }
        $stateUntrusted = @{
            WorkItemId = "TASK-AI-06"
            Branch = "feat/task-ai-06-orchestrator-supervisor"
            State = "STARTED"
            HeadSha = "c0ffee112233445566778899aabbccddeeff0011"
            PullRequestNumber = 9
            LastAcknowledgedReviewTriggerHead = $null
            LastReviewTriggeredAt = $null
            ReviewRequestCommentId = $null
        }

        $caughtUntrusted = $false
        try {
            Invoke-ShipDeSupervisorLoop `
                -State $stateUntrusted `
                -PrResolver { param($w, $b) return $testPr } `
                -VerdictResolver { param($n, $h, $s) return $null } `
                -BotReviewRequester { param($n, $h) return $null } `
                -SleepHandler { param($s) throw "LOOP_END" } `
                -CheckpointWriter { param($s) }
        } catch {
            if ($_.Exception.Message -match "could not be created or found") {
                $caughtUntrusted = $true
            }
        }
        if (-not $caughtUntrusted) {
            throw "Regression Test 1 failed: untrusted review requester did not fail closed."
        }
        if (-not [string]::IsNullOrWhiteSpace($stateUntrusted.LastAcknowledgedReviewTriggerHead)) {
            throw "Regression Test 1 failed: LastAcknowledgedReviewTriggerHead was acknowledged on skipped review request."
        }
        if (-not [string]::IsNullOrWhiteSpace($stateUntrusted.LastReviewTriggeredAt)) {
            throw "Regression Test 1 failed: LastReviewTriggeredAt timer was started on skipped review request."
        }
        if (-not [string]::IsNullOrWhiteSpace($stateUntrusted.ReviewRequestCommentId)) {
            throw "Regression Test 1 failed: ReviewRequestCommentId was populated on skipped review request."
        }
    }

    # Test 2: Exact-HEAD bot request created once and persists comment ID idempotently
    & {
        $postStats = @{ Count = 0 }
        $postedCommentsStore = [System.Collections.Generic.List[object]]::new()
        $mockPoster = {
            param($prNum, $body)
            $postStats.Count++
            $newId = "comment-bot-12345"
            $postedCommentsStore.Add([PSCustomObject]@{
                id = $newId
                body = $body
            })
            return $newId
        }
        $mockFinder = {
            param($prNum)
            return @($postedCommentsStore)
        }

        # First call creates the comment
        $commentId1 = Request-ShipDeCodexBotReview -PullRequestNumber 9 -HeadSha "aabbcc001122" -CommentPoster $mockPoster -CommentsFinder $mockFinder
        if ($commentId1 -ne "comment-bot-12345") {
            throw "Regression Test 2 failed: Request-ShipDeCodexBotReview did not return expected comment ID on creation."
        }
        if ($postedCommentsStore.Count -ne 1) {
            throw "Regression Test 2 failed: Comment was not added to store."
        }

        # Second call with same exact HEAD must find existing comment without invoking poster again
        $commentId2 = Request-ShipDeCodexBotReview -PullRequestNumber 9 -HeadSha "aabbcc001122" -CommentPoster { throw "Poster must not be called when comment exists" } -CommentsFinder $mockFinder
        if ($commentId2 -ne "comment-bot-12345") {
            throw "Regression Test 2 failed: Idempotent lookup did not find existing comment ID."
        }

        # Verify loop integration persists ReviewRequestCommentId and advances state
        $testPr2 = [PSCustomObject]@{
            number = 9
            headRefOid = "aabbcc001122"
            isDraft = $false
            title = "[TASK-AI-06] Test PR"
            headRefName = "feat/task-ai-06-orchestrator-supervisor"
            headRepository = "vinh05092001/shipde-platform"
            isCrossRepository = $false
            statusCheckRollup = @(
                [PSCustomObject]@{ name = "contract"; conclusion = "SUCCESS"; checkSuite = [PSCustomObject]@{ app = [PSCustomObject]@{ slug = "github-actions"; name = "GitHub Actions" } } },
                [PSCustomObject]@{ name = "application-gate"; conclusion = "SUCCESS"; checkSuite = [PSCustomObject]@{ app = [PSCustomObject]@{ slug = "github-actions"; name = "GitHub Actions" } } }
            )
        }
        $stateBotSuccess = @{
            WorkItemId = "TASK-AI-06"
            Branch = "feat/task-ai-06-orchestrator-supervisor"
            State = "STARTED"
            HeadSha = "aabbcc001122"
            PullRequestNumber = 9
        }
        $loopStopped = $false
        try {
            Invoke-ShipDeSupervisorLoop `
                -State $stateBotSuccess `
                -PrResolver { param($w, $b) return $testPr2 } `
                -VerdictResolver { param($n, $h, $s) return $null } `
                -BotReviewRequester { param($n, $h) return "comment-bot-12345" } `
                -SleepHandler { param($s) throw "STOP_LOOP" } `
                -CheckpointWriter { param($s) }
        } catch {
            if ($_.Exception.Message -match "STOP_LOOP") { $loopStopped = $true }
        }
        if (-not $loopStopped) {
            throw "Regression Test 2 failed: Supervisor loop did not progress to sleep handler after posting review request."
        }
        if ($stateBotSuccess.ReviewRequestCommentId -ne "comment-bot-12345") {
            throw "Regression Test 2 failed: ReviewRequestCommentId was not persisted in supervisor state."
        }
        if ($stateBotSuccess.LastAcknowledgedReviewTriggerHead -ne "aabbcc001122") {
            throw "Regression Test 2 failed: LastAcknowledgedReviewTriggerHead was not acknowledged."
        }
        if ([string]::IsNullOrWhiteSpace($stateBotSuccess.LastReviewTriggeredAt)) {
            throw "Regression Test 2 failed: LastReviewTriggeredAt was not recorded."
        }
    }

    # Test 3: Timeout starts only after successful bot request creation
    & {
        $testPr3 = [PSCustomObject]@{
            number = 9
            headRefOid = "112233445566"
            isDraft = $false
            title = "[TASK-AI-06] Test PR"
            headRefName = "feat/task-ai-06-orchestrator-supervisor"
            headRepository = "vinh05092001/shipde-platform"
            isCrossRepository = $false
            statusCheckRollup = @(
                [PSCustomObject]@{ name = "contract"; conclusion = "SUCCESS"; checkSuite = [PSCustomObject]@{ app = [PSCustomObject]@{ slug = "github-actions"; name = "GitHub Actions" } } },
                [PSCustomObject]@{ name = "application-gate"; conclusion = "SUCCESS"; checkSuite = [PSCustomObject]@{ app = [PSCustomObject]@{ slug = "github-actions"; name = "GitHub Actions" } } }
            )
        }
        $expiredTime = (Get-Date).ToUniversalTime().AddMinutes(-25).ToString("o")
        $stateTimedOut = @{
            WorkItemId = "TASK-AI-06"
            Branch = "feat/task-ai-06-orchestrator-supervisor"
            State = "STARTED"
            HeadSha = "112233445566"
            PullRequestNumber = 9
            ReviewRequestCommentId = "comment-existing-1"
            LastReviewTriggeredHead = "112233445566"
            LastAcknowledgedReviewTriggerHead = "112233445566"
            LastReviewTriggeredAt = $expiredTime
        }
        $timedOutCaught = $false
        try {
            Invoke-ShipDeSupervisorLoop `
                -State $stateTimedOut `
                -ReviewTimeoutMinutes 20 `
                -PrResolver { param($w, $b) return $testPr3 } `
                -VerdictResolver { param($n, $h, $s) return $null } `
                -SleepHandler { param($s) throw "SHOULD_NOT_SLEEP" } `
                -CheckpointWriter { param($s) }
        } catch {
            if ($_.Exception.Message -match "timed out after 20 minute\(s\)") {
                $timedOutCaught = $true
            }
        }
        if (-not $timedOutCaught) {
            throw "Regression Test 3 failed: Supervisor did not enforce timeout from LastReviewTriggeredAt."
        }
    }

    # Test 4: Trusted CHANGES_REQUIRED automatically dispatches all findings to agy
    & {
        $testPr4 = [PSCustomObject]@{
            number = 9
            headRefOid = "445566778899"
            isDraft = $false
            title = "[TASK-AI-06] Test PR"
            headRefName = "feat/task-ai-06-orchestrator-supervisor"
            headRepository = "vinh05092001/shipde-platform"
            isCrossRepository = $false
            statusCheckRollup = @(
                [PSCustomObject]@{ name = "contract"; conclusion = "SUCCESS"; checkSuite = [PSCustomObject]@{ app = [PSCustomObject]@{ slug = "github-actions"; name = "GitHub Actions" } } },
                [PSCustomObject]@{ name = "application-gate"; conclusion = "SUCCESS"; checkSuite = [PSCustomObject]@{ app = [PSCustomObject]@{ slug = "github-actions"; name = "GitHub Actions" } } }
            )
        }
        $stateChangesReq = @{
            WorkItemId = "TASK-AI-06"
            Branch = "feat/task-ai-06-orchestrator-supervisor"
            Author = "GEMINI"
            State = "STARTED"
            HeadSha = "445566778899"
            PullRequestNumber = 9
            LastAcknowledgedReviewRepairHead = $null
        }
        $t4Released = [System.Collections.Generic.List[string]]::new()
        $t4DispatchedMessages = [System.Collections.Generic.List[object]]::new()
        $t4MockSessions = @(
            [PSCustomObject]@{ id = "session-claude-old"; role = "worker"; harness = "claude-code"; branch = "feat/task-ai-06-orchestrator-supervisor"; status = "pr_open"; isTerminated = $false }
        )

        try {
            Invoke-ShipDeSupervisorLoop `
                -State $stateChangesReq `
                -PrResolver { param($w, $b) return $testPr4 } `
                -VerdictResolver { param($n, $h, $s) return "CHANGES_REQUIRED" } `
                -SessionsResolver { param($p) return $t4MockSessions } `
                -SessionDetailResolver {
                    param($id, $p)
                    $isTerm = ($t4Released -contains $id)
                    $st = if ($isTerm) { "terminated" } else { "pr_open" }
                    return [PSCustomObject]@{ id = $id; harness = "claude-code"; branch = "feat/task-ai-06-orchestrator-supervisor"; status = $st; isTerminated = $isTerm }
                } `
                -OwnershipVerifier { param($sess, $item, $p) return $true } `
                -SessionReleaser { param($sid, $p) $t4Released.Add($sid) } `
                -WorkerStarter {
                    param($item, $prompt)
                    return [PSCustomObject]@{ SessionId = "session-agy-new"; Harness = "agy" }
                } `
                -MessageSender {
                    param($sid, $msg)
                    $t4DispatchedMessages.Add([PSCustomObject]@{ SessionId = $sid; Message = $msg })
                    return $true
                } `
                -SleepHandler { param($s) throw "STOP_T4" } `
                -CheckpointWriter { param($s) }
        } catch {}

        if ($t4Released.Count -ne 1 -or $t4Released[0] -ne "session-claude-old") {
            throw "Regression Test 4 failed: claude-code session was not safely released before agy dispatch."
        }
        if ($t4DispatchedMessages.Count -ne 1 -or $t4DispatchedMessages[0].SessionId -ne "session-agy-new") {
            throw "Regression Test 4 failed: changes required message was not dispatched to agy."
        }
        if ($stateChangesReq.LastAcknowledgedReviewRepairHead -ne "445566778899") {
            throw "Regression Test 4 failed: LastAcknowledgedReviewRepairHead was not acknowledged."
        }
    }

    # Test 5: Crash/restart during PendingDispatch does not drop repairs and does not duplicate
    & {
        # 5A: Unacknowledged crash -> delivers repair and acknowledges
        $t5Pr = [PSCustomObject]@{
            number = 9
            headRefOid = "556677889900"
            isDraft = $false
            title = "[TASK-AI-06] Test PR"
            headRefName = "feat/task-ai-06-orchestrator-supervisor"
            headRepository = "vinh05092001/shipde-platform"
            isCrossRepository = $false
            statusCheckRollup = @(
                [PSCustomObject]@{ name = "contract"; conclusion = "SUCCESS"; checkSuite = [PSCustomObject]@{ app = [PSCustomObject]@{ slug = "github-actions"; name = "GitHub Actions" } } },
                [PSCustomObject]@{ name = "application-gate"; conclusion = "SUCCESS"; checkSuite = [PSCustomObject]@{ app = [PSCustomObject]@{ slug = "github-actions"; name = "GitHub Actions" } } }
            )
        }
        $statePendingCrash = @{
            WorkItemId = "TASK-AI-06"
            Branch = "feat/task-ai-06-orchestrator-supervisor"
            Author = "GEMINI"
            State = "STARTED"
            HeadSha = "556677889900"
            PullRequestNumber = 9
            PendingDispatch = @{ Type = "CI_REPAIR"; Head = "556677889900"; Time = (Get-Date).ToUniversalTime().ToString("o") }
            LastAcknowledgedCiRepairHead = $null
        }
        $t5Delivered = [System.Collections.Generic.List[object]]::new()
        try {
            Invoke-ShipDeSupervisorLoop `
                -State $statePendingCrash `
                -PrResolver { param($w, $b) return $t5Pr } `
                -SessionsResolver { param($p) return @() } `
                -SessionDetailResolver { param($id, $p) return $null } `
                -WorkerStarter { param($i, $p) return [PSCustomObject]@{ SessionId = "sess-agy-5"; Harness = "agy" } } `
                -MessageSender {
                    param($sid, $msg)
                    $t5Delivered.Add([PSCustomObject]@{ SessionId = $sid; Message = $msg })
                    return $true
                } `
                -SleepHandler { param($s) throw "STOP_T5" } `
                -CheckpointWriter { param($s) }
        } catch {
            if ($_.Exception.Message -ne "STOP_T5") {
                throw "TEST 5A CAUGHT UNEXPECTED ERROR: $($_.Exception.Message)"
            }
        }

        if ($t5Delivered.Count -ne 1) {
            throw "Regression Test 5A failed: Unacknowledged crash did not deliver pending CI repair."
        }
        if ($statePendingCrash.LastAcknowledgedCiRepairHead -ne "556677889900") {
            throw "Regression Test 5A failed: Unacknowledged crash did not acknowledge HEAD after delivery."
        }
        if ($null -ne $statePendingCrash.PendingDispatch) {
            throw "Regression Test 5A failed: PendingDispatch was not cleared after delivery."
        }

        # 5B: Already acknowledged crash -> clears PendingDispatch without duplicate delivery
        $stateAlreadyAck = @{
            WorkItemId = "TASK-AI-06"
            Branch = "feat/task-ai-06-orchestrator-supervisor"
            Author = "GEMINI"
            State = "STARTED"
            HeadSha = "556677889900"
            PullRequestNumber = 9
            PendingDispatch = @{ Type = "CI_REPAIR"; Head = "556677889900"; Time = (Get-Date).ToUniversalTime().ToString("o") }
            LastAcknowledgedCiRepairHead = "556677889900"
        }
        $t5bDelivered = [System.Collections.Generic.List[object]]::new()
        try {
            $null = Invoke-ShipDeSupervisorLoop `
                -State $stateAlreadyAck `
                -PrResolver { param($w, $b) return $t5Pr } `
                -MessageSender { param($sid, $msg) $t5bDelivered.Add($msg); return $true } `
                -VerdictResolver { param($n, $h, $s) return "PASS" } `
                -SleepHandler { param($s) throw "STOP_T5B" } `
                -CheckpointWriter { param($s) }
        } catch {}

        if ($t5bDelivered.Count -ne 0) {
            throw "Regression Test 5B failed: Already acknowledged pending dispatch re-delivered duplicate message."
        }
        if ($null -ne $stateAlreadyAck.PendingDispatch) {
            throw "Regression Test 5B failed: PendingDispatch was not cleared for already acknowledged intent."
        }
    }

    # Test 6: Bounded PARKED lifecycle validation
    & {
        # 6A: PARKED without open PR throws fail-closed
        $stateParkedNoPr = @{
            WorkItemId = "TASK-AI-06"
            Branch = "feat/task-ai-06-orchestrator-supervisor"
            State = "STARTED"
            SessionId = "sess-parked-1"
        }
        $parkedNoPrCaught = $false
        try {
            Invoke-ShipDeSupervisorLoop `
                -State $stateParkedNoPr `
                -SessionDetailResolver { param($id, $p) return [PSCustomObject]@{ status = "parked" } } `
                -PrResolver { param($w, $b) return $null } `
                -SleepHandler { param($s) throw "LOOP" } `
                -CheckpointWriter { param($s) }
        } catch {
            if ($_.Exception.Message -match "AO worker is parked but no open Pull Request was found") {
                $parkedNoPrCaught = $true
            }
        }
        if (-not $parkedNoPrCaught) {
            throw "Regression Test 6A failed: Parked worker without open PR did not fail closed."
        }

        # 6B: PARKED with draft PR throws fail-closed
        $draftPr = [PSCustomObject]@{
            number = 9
            headRefOid = "667788990011"
            isDraft = $true
            title = "[TASK-AI-06] Draft PR"
            headRefName = "feat/task-ai-06-orchestrator-supervisor"
            headRepository = "vinh05092001/shipde-platform"
            isCrossRepository = $false
            statusCheckRollup = @(
                [PSCustomObject]@{ name = "contract"; conclusion = "SUCCESS"; checkSuite = [PSCustomObject]@{ app = [PSCustomObject]@{ slug = "github-actions"; name = "GitHub Actions" } } },
                [PSCustomObject]@{ name = "application-gate"; conclusion = "SUCCESS"; checkSuite = [PSCustomObject]@{ app = [PSCustomObject]@{ slug = "github-actions"; name = "GitHub Actions" } } }
            )
        }
        $stateParkedDraft = @{
            WorkItemId = "TASK-AI-06"
            Branch = "feat/task-ai-06-orchestrator-supervisor"
            State = "STARTED"
            SessionId = "sess-parked-2"
        }
        $parkedDraftCaught = $false
        try {
            Invoke-ShipDeSupervisorLoop `
                -State $stateParkedDraft `
                -SessionDetailResolver { param($id, $p) return [PSCustomObject]@{ status = "parked" } } `
                -PrResolver { param($w, $b) return $draftPr } `
                -SleepHandler { param($s) throw "LOOP" } `
                -CheckpointWriter { param($s) }
        } catch {
            if ($_.Exception.Message -match "while PR #9 is still draft") {
                $parkedDraftCaught = $true
            }
        }
        if (-not $parkedDraftCaught) {
            throw "Regression Test 6B failed: Parked worker with draft PR did not fail closed."
        }

        # 6C: PARKED when repair is required outside grace window throws fail-closed
        $failedPr = [PSCustomObject]@{
            number = 9
            headRefOid = "778899001122"
            isDraft = $false
            title = "[TASK-AI-06] Failed CI PR"
            headRefName = "feat/task-ai-06-orchestrator-supervisor"
            headRepository = "vinh05092001/shipde-platform"
            isCrossRepository = $false
            statusCheckRollup = @(
                [PSCustomObject]@{ name = "contract"; conclusion = "FAILURE"; checkSuite = [PSCustomObject]@{ app = [PSCustomObject]@{ slug = "github-actions"; name = "GitHub Actions" } } }
            )
        }
        $stateParkedExpired = @{
            WorkItemId = "TASK-AI-06"
            Branch = "feat/task-ai-06-orchestrator-supervisor"
            Author = "GEMINI"
            State = "STARTED"
            SessionId = "sess-parked-3"
            HeadSha = "778899001122"
            LastAcknowledgedCiRepairHead = "778899001122"
            LastRepairDispatchedAt = (Get-Date).ToUniversalTime().AddMinutes(-5).ToString("o")
        }
        $parkedExpiredCaught = $false
        try {
            Invoke-ShipDeSupervisorLoop `
                -State $stateParkedExpired `
                -SessionDetailResolver { param($id, $p) return [PSCustomObject]@{ status = "parked" } } `
                -PrResolver { param($w, $b) return $failedPr } `
                -SleepHandler { param($s) throw "LOOP" } `
                -CheckpointWriter { param($s) }
        } catch {
            if ($_.Exception.Message -match "while governed implementation or repair work is still required") {
                $parkedExpiredCaught = $true
            }
        }
        if (-not $parkedExpiredCaught) {
            throw "Regression Test 6C failed: Parked worker when repair work is required outside grace window did not fail closed."
        }
    }

    # ------------------------------------------------------------------------------------------------
    # TASK-AI-06 Round 20 Regression Test Suite: Missing Checkpoint SessionId Recovery (Requirement 5)
    # 5.1: Initialize-ShipDeSupervisorState with nonexistent SessionId, open PR, no pending repair
    #      clears SessionId/Harness, sets State = STARTED, keeps PR/HeadSha, resumes PR-only review
    # 5.2: Initialize-ShipDeSupervisorState with nonexistent SessionId, open PR, pending dispatch
    #      sets State = BLOCKED and throws fail-closed error
    # 5.3: Initialize-ShipDeSupervisorState with nonexistent SessionId, open PR, failing CI
    #      sets State = BLOCKED and throws fail-closed error
    # 5.4: Initialize-ShipDeSupervisorState with nonexistent SessionId, open PR, CHANGES_REQUIRED
    #      sets State = BLOCKED and throws fail-closed error
    # 5.5: Initialize-ShipDeSupervisorState with nonexistent SessionId, NO open PR
    #      sets State = MISSING and throws fail-closed error
    # 5.6: Invoke-ShipDeSupervisorLoop with nonexistent SessionId, open PR, no pending repair
    #      clears SessionId/Harness, transitions to EXTERNAL, returns READY_FOR_HUMAN_MERGE on PASS
    # 5.7: Invoke-ShipDeSupervisorLoop with nonexistent SessionId, open PR, failing CI
    #      sets State = BLOCKED and throws fail-closed error
    # ------------------------------------------------------------------------------------------------

    $req5Pr = [PSCustomObject]@{
        number = 9
        headRefOid = "8899aabbccddeeff00112233445566778899aabb"
        isDraft = $false
        title = "[TASK-AI-06] Test PR"
        headRefName = "feat/task-ai-06-orchestrator-supervisor"
        headRepository = "vinh05092001/shipde-platform"
        isCrossRepository = $false
        statusCheckRollup = @(
            [PSCustomObject]@{ name = "contract"; conclusion = "SUCCESS"; startedAt = "2026-09-06T01:00:00Z"; checkSuite = [PSCustomObject]@{ app = [PSCustomObject]@{ slug = "github-actions"; name = "GitHub Actions" } } },
            [PSCustomObject]@{ name = "application-gate"; conclusion = "SUCCESS"; startedAt = "2026-09-06T01:00:00Z"; checkSuite = [PSCustomObject]@{ app = [PSCustomObject]@{ slug = "github-actions"; name = "GitHub Actions" } } }
        )
    }

    $req5FailedPr = [PSCustomObject]@{
        number = 9
        headRefOid = "8899aabbccddeeff00112233445566778899aabb"
        isDraft = $false
        title = "[TASK-AI-06] Test PR"
        headRefName = "feat/task-ai-06-orchestrator-supervisor"
        headRepository = "vinh05092001/shipde-platform"
        isCrossRepository = $false
        statusCheckRollup = @(
            [PSCustomObject]@{ name = "contract"; conclusion = "FAILURE"; startedAt = "2026-09-06T01:00:00Z"; checkSuite = [PSCustomObject]@{ app = [PSCustomObject]@{ slug = "github-actions"; name = "GitHub Actions" } } }
        )
    }

    # 5.1: Initialize-ShipDeSupervisorState with nonexistent SessionId, open PR, no pending repair -> clears SessionId/Harness, resumes PR-only review
    & {
        $state51 = @{
            WorkItemId = "TASK-AI-06"
            Branch = "feat/task-ai-06-orchestrator-supervisor"
            Author = "GEMINI"
            State = "STARTED"
            SessionId = "sess-nonexistent-1"
            Harness = "agy"
            PullRequestNumber = 9
            HeadSha = "8899aabbccddeeff00112233445566778899aabb"
        }
        $writtenCheckpoints51 = [System.Collections.Generic.List[object]]::new()
        $res51 = Initialize-ShipDeSupervisorState `
            -State $state51 `
            -Repository "vinh05092001/shipde-platform" `
            -OpenPrResolver { return @($req5Pr) } `
            -SessionDetailResolver { param($id, $p) return $null } `
            -WorkerStarter { param($i, $p) throw "WorkerStarter must NOT be called" } `
            -CheckpointWriter { param($s) $writtenCheckpoints51.Add($s) }

        if ($null -eq $res51 -or $null -ne $res51["SessionId"] -or $null -ne $res51["Harness"] -or $res51["State"] -ne "STARTED" -or $res51["PullRequestNumber"] -ne 9) {
            throw "Requirement 5.1 failed: Initialize-ShipDeSupervisorState did not clear SessionId/Harness and resume PR-only review."
        }
        if ($writtenCheckpoints51.Count -eq 0 -or $null -ne $writtenCheckpoints51[-1]["SessionId"]) {
            throw "Requirement 5.1 failed: Cleared state was not persisted to checkpoint."
        }
    }

    # 5.2: Initialize-ShipDeSupervisorState with nonexistent SessionId, open PR, pending dispatch -> BLOCKED fail-closed
    & {
        $state52 = @{
            WorkItemId = "TASK-AI-06"
            Branch = "feat/task-ai-06-orchestrator-supervisor"
            Author = "GEMINI"
            State = "STARTED"
            SessionId = "sess-nonexistent-2"
            Harness = "agy"
            PendingDispatch = @{ Type = "CI_REPAIR"; Head = "8899aabbccddeeff00112233445566778899aabb" }
        }
        $writtenCheckpoints52 = [System.Collections.Generic.List[object]]::new()
        $blockedCaught52 = $false
        try {
            Initialize-ShipDeSupervisorState `
                -State $state52 `
                -Repository "vinh05092001/shipde-platform" `
                -OpenPrResolver { return @($req5Pr) } `
                -SessionDetailResolver { param($id, $p) return $null } `
                -CheckpointWriter { param($s) $writtenCheckpoints52.Add($s) } | Out-Null
        } catch {
            if ($_.Exception.Message -match "Stopping BLOCKED for human action") {
                $blockedCaught52 = $true
            }
        }
        if (-not $blockedCaught52) {
            throw "Requirement 5.2 failed: Did not stop BLOCKED for pending dispatch."
        }
        if ($writtenCheckpoints52.Count -eq 0 -or $writtenCheckpoints52[-1]["State"] -ne "BLOCKED") {
            throw "Requirement 5.2 failed: BLOCKED state was not persisted to checkpoint."
        }
    }

    # 5.3: Initialize-ShipDeSupervisorState with nonexistent SessionId, open PR, failing CI -> BLOCKED fail-closed
    & {
        $state53 = @{
            WorkItemId = "TASK-AI-06"
            Branch = "feat/task-ai-06-orchestrator-supervisor"
            Author = "GEMINI"
            State = "STARTED"
            SessionId = "sess-nonexistent-3"
            Harness = "agy"
        }
        $writtenCheckpoints53 = [System.Collections.Generic.List[object]]::new()
        $blockedCaught53 = $false
        try {
            Initialize-ShipDeSupervisorState `
                -State $state53 `
                -Repository "vinh05092001/shipde-platform" `
                -OpenPrResolver { return @($req5FailedPr) } `
                -SessionDetailResolver { param($id, $p) return $null } `
                -CheckpointWriter { param($s) $writtenCheckpoints53.Add($s) } | Out-Null
        } catch {
            if ($_.Exception.Message -match "Stopping BLOCKED for human action") {
                $blockedCaught53 = $true
            }
        }
        if (-not $blockedCaught53) {
            throw "Requirement 5.3 failed: Did not stop BLOCKED for failing CI."
        }
        if ($writtenCheckpoints53.Count -eq 0 -or $writtenCheckpoints53[-1]["State"] -ne "BLOCKED") {
            throw "Requirement 5.3 failed: BLOCKED state was not persisted to checkpoint."
        }
    }

    # 5.4: Initialize-ShipDeSupervisorState with nonexistent SessionId, open PR, CHANGES_REQUIRED verdict -> BLOCKED fail-closed
    & {
        $state54 = @{
            WorkItemId = "TASK-AI-06"
            Branch = "feat/task-ai-06-orchestrator-supervisor"
            Author = "GEMINI"
            State = "STARTED"
            SessionId = "sess-nonexistent-4"
            Harness = "agy"
            ExactHeadVerdict = "CHANGES_REQUIRED"
        }
        $writtenCheckpoints54 = [System.Collections.Generic.List[object]]::new()
        $blockedCaught54 = $false
        try {
            Initialize-ShipDeSupervisorState `
                -State $state54 `
                -Repository "vinh05092001/shipde-platform" `
                -OpenPrResolver { return @($req5Pr) } `
                -SessionDetailResolver { param($id, $p) return $null } `
                -CheckpointWriter { param($s) $writtenCheckpoints54.Add($s) } | Out-Null
        } catch {
            if ($_.Exception.Message -match "Stopping BLOCKED for human action") {
                $blockedCaught54 = $true
            }
        }
        if (-not $blockedCaught54) {
            throw "Requirement 5.4 failed: Did not stop BLOCKED for CHANGES_REQUIRED."
        }
        if ($writtenCheckpoints54.Count -eq 0 -or $writtenCheckpoints54[-1]["State"] -ne "BLOCKED") {
            throw "Requirement 5.4 failed: BLOCKED state was not persisted to checkpoint."
        }
    }

    # 5.5: Initialize-ShipDeSupervisorState with nonexistent SessionId, NO open PR -> MISSING fail-closed
    & {
        $state55 = @{
            WorkItemId = "TASK-AI-06"
            Branch = "feat/task-ai-06-orchestrator-supervisor"
            Author = "GEMINI"
            State = "STARTED"
            SessionId = "sess-nonexistent-5"
            Harness = "agy"
        }
        $writtenCheckpoints55 = [System.Collections.Generic.List[object]]::new()
        $missingCaught55 = $false
        try {
            Initialize-ShipDeSupervisorState `
                -State $state55 `
                -Repository "vinh05092001/shipde-platform" `
                -OpenPrResolver { return @() } `
                -SessionDetailResolver { param($id, $p) return $null } `
                -CheckpointWriter { param($s) $writtenCheckpoints55.Add($s) } | Out-Null
        } catch {
            if ($_.Exception.Message -match "no open PR for TASK-AI-06 was found") {
                $missingCaught55 = $true
            }
        }
        if (-not $missingCaught55) {
            throw "Requirement 5.5 failed: Did not stop fail-closed when no PR was found."
        }
        if ($writtenCheckpoints55.Count -eq 0 -or $writtenCheckpoints55[-1]["State"] -ne "MISSING") {
            throw "Requirement 5.5 failed: MISSING state was not persisted to checkpoint."
        }
    }

    # 5.6: Invoke-ShipDeSupervisorLoop with nonexistent SessionId, open PR, no pending repair -> resumes PR-only, returns READY_FOR_HUMAN_MERGE
    & {
        $state56 = @{
            WorkItemId = "TASK-AI-06"
            Branch = "feat/task-ai-06-orchestrator-supervisor"
            Author = "GEMINI"
            State = "STARTED"
            SessionId = "sess-nonexistent-6"
            Harness = "agy"
            PullRequestNumber = 9
            HeadSha = "8899aabbccddeeff00112233445566778899aabb"
        }
        $writtenCheckpoints56 = [System.Collections.Generic.List[object]]::new()
        $loopResult56 = Invoke-ShipDeSupervisorLoop `
            -State $state56 `
            -SessionDetailResolver { param($id, $p) return $null } `
            -PrResolver { param($w, $b) return $req5Pr } `
            -VerdictResolver { param($n, $h, $s) return "PASS" } `
            -SleepHandler { param($s) throw "SHOULD_NOT_SLEEP" } `
            -CheckpointWriter { param($s) $writtenCheckpoints56.Add($s) }

        if ($loopResult56 -ne "READY_FOR_HUMAN_MERGE") {
            throw "Requirement 5.6 failed: Expected READY_FOR_HUMAN_MERGE, got '$loopResult56'."
        }
        if ($null -ne $state56.SessionId -or $null -ne $state56.Harness) {
            throw "Requirement 5.6 failed: SessionId and Harness were not cleared."
        }
    }

    # 5.7: Invoke-ShipDeSupervisorLoop with nonexistent SessionId, open PR, failing CI -> BLOCKED fail-closed
    & {
        $state57 = @{
            WorkItemId = "TASK-AI-06"
            Branch = "feat/task-ai-06-orchestrator-supervisor"
            Author = "GEMINI"
            State = "STARTED"
            SessionId = "sess-nonexistent-7"
            Harness = "agy"
            PullRequestNumber = 9
            HeadSha = "8899aabbccddeeff00112233445566778899aabb"
        }
        $writtenCheckpoints57 = [System.Collections.Generic.List[object]]::new()
        $blockedCaught57 = $false
        try {
            Invoke-ShipDeSupervisorLoop `
                -State $state57 `
                -SessionDetailResolver { param($id, $p) return $null } `
                -PrResolver { param($w, $b) return $req5FailedPr } `
                -SleepHandler { param($s) throw "LOOP" } `
                -CheckpointWriter { param($s) $writtenCheckpoints57.Add($s) } | Out-Null
        } catch {
            if ($_.Exception.Message -match "Stopping BLOCKED for human action") {
                $blockedCaught57 = $true
            }
        }
        if (-not $blockedCaught57) {
            throw "Requirement 5.7 failed: Did not stop BLOCKED in Invoke-ShipDeSupervisorLoop for pending repair."
        }
        if ($state57.State -ne "BLOCKED") {
            throw "Requirement 5.7 failed: State was not set to BLOCKED."
        }
    }

    # Startup self-test host output leak assertion (AC-AI-63 / TASK-AI-06):
    # Verify that all production-looking messages generated during self-tests
    # (PASS, CHANGES_REQUIRED, PR data, reconstructed-checkpoint notices)
    # were completely intercepted by the local Write-Host suppressor and
    # none were leaked to the host prior to the supervisor banner.
    $productionPatterns = @(
        '(?i)\b(PASS|CHANGES_REQUIRED)\b',
        '(?i)PR\s*#\d+',
        '(?i)\[SUPERVISOR\]',
        '(?i)Reconstructed missing checkpoint'
    )
    $interceptedLeakedMessages = @($startupSelfTestHostLeaks | Where-Object {
        $msg = $_
        foreach ($pat in $productionPatterns) {
            if ($msg -match $pat) { return $true }
        }
        return $false
    })
    if ($interceptedLeakedMessages.Count -eq 0) {
        throw "Startup self-test host output leak assertion failed: self-tests did not exercise supervisor host-writing code through the silenced interceptor."
    }
} finally {
    # Requirement 3: Restore all script paths/state/environment in finally
    $script:HandoffRoot = $origHandoffRoot
    $script:SupervisorStateFile = $origSupervisorStateFile
    $script:SupervisorLockFile = $origSupervisorLockFile
    $script:AoRouterRuntimeFile = $origAoRouterRuntimeFile
    $script:AgentRouterProfile = $origAgentRouterProfile
    $script:ExpectedAoVersion = $origExpectedAoVersion
    $script:AoExecutablePath = $origAoExecutablePath

    if ($null -ne $origEnvClaudeConfig) { $env:CLAUDE_CONFIG_DIR = $origEnvClaudeConfig } else { Remove-Item Env:CLAUDE_CONFIG_DIR -ErrorAction SilentlyContinue }
    if ($null -ne $origEnvBaseUrl) { $env:ANTHROPIC_BASE_URL = $origEnvBaseUrl } else { Remove-Item Env:ANTHROPIC_BASE_URL -ErrorAction SilentlyContinue }
    if ($null -ne $origEnvAuthToken) { $env:ANTHROPIC_AUTH_TOKEN = $origEnvAuthToken } else { Remove-Item Env:ANTHROPIC_AUTH_TOKEN -ErrorAction SilentlyContinue }
    if ($null -ne $origEnvApiKey) { $env:ANTHROPIC_API_KEY = $origEnvApiKey } else { Remove-Item Env:ANTHROPIC_API_KEY -ErrorAction SilentlyContinue }

    if (Test-Path -LiteralPath $compatSuiteTempRoot) {
        Remove-Item -LiteralPath $compatSuiteTempRoot -Recurse -Force -ErrorAction SilentlyContinue
    }

    # Requirement 4: Add an integration assertion that Action Test and startup compatibility
    # leave the real supervisor-state.json byte-for-byte and mtime unchanged.
    if ($realStateFileExisted) {
        if (-not (Test-Path -LiteralPath $realStateFile)) {
            throw "Integration assertion failed: real supervisor state file was deleted during tests: $realStateFile"
        }
        $postBytes = [System.IO.File]::ReadAllBytes($realStateFile)
        $postMtime = (Get-Item -LiteralPath $realStateFile).LastWriteTimeUtc
        if ($postBytes.Length -ne $realStateFileBytes.Length) {
            throw "Integration assertion failed: real supervisor state file byte count changed from $($realStateFileBytes.Length) to $($postBytes.Length) during tests: $realStateFile"
        }
        for ($bi = 0; $bi -lt $postBytes.Length; $bi++) {
            if ($postBytes[$bi] -ne $realStateFileBytes[$bi]) {
                throw "Integration assertion failed: real supervisor state file byte-for-byte mismatch at offset $bi during tests: $realStateFile"
            }
        }
        if ($postMtime -ne $realStateFileMtime) {
            throw "Integration assertion failed: real supervisor state file mtime changed from $($realStateFileMtime.ToString('o')) to $($postMtime.ToString('o')) during tests: $realStateFile"
        }
    } else {
        if (Test-Path -LiteralPath $realStateFile) {
            throw "Integration assertion failed: real supervisor state file was created during tests where none existed: $realStateFile"
        }
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
            @(Get-ShipDeAoSessions -Project "shipde-platform" | Where-Object {
                $isTerm = [bool](Get-ShipDeObjectProperty -Object $_ -Names @("isTerminated", "is_terminated"))
                $role = [string](Get-ShipDeObjectProperty -Object $_ -Names @("role", "kind"))
                $status = [string](Get-ShipDeObjectProperty -Object $_ -Names @("status", "state"))
                (-not $isTerm) -and ($role -in @("worker", "")) -and ($status -notin @("exited", "terminated", "failed", "completed", "stopped", "pr_open", "parked"))
            })
        },
        [int]$PullRequestNumber = 0,
        [string]$Repository = "vinh05092001/shipde-platform",
        [scriptblock]$PrWorkItemResolver = { param($pr) Get-ShipDePrWorkItem -PullRequest $pr },
        [scriptblock]$SessionDetailResolver = $null
    )

    $sessionId = $null
    $workItemId = $null
    $stateValue = $null
    $branch = $null
    $workItemPath = $null
    $author = $null

    if ($null -ne $State) {
        $State = Normalize-ShipDeSupervisorState -State $State
        $sessionId = [string]$State["SessionId"]
        $workItemId = [string]$State["WorkItemId"]
        $stateValue = [string]$State["State"]
        $branch = [string]$State["Branch"]
        $workItemPath = [string]$State["WorkItemPath"]
        $author = [string]$State["Author"]
    }

    if (-not [string]::IsNullOrWhiteSpace($workItemId)) {
        if (-not [string]::IsNullOrWhiteSpace($sessionId)) {
            $sessDetail = if ($null -ne $SessionDetailResolver) {
                & $SessionDetailResolver $sessionId "shipde-platform"
            } else {
                Get-ShipDeAoSessionById -SessionId $sessionId -Project "shipde-platform"
            }

            if ($null -ne $sessDetail) {
                Write-Host "[SUPERVISOR] Resuming $workItemId in AO session $sessionId."
                return $State
            }

            # Requirement 5: Checkpoint SessionId no longer exists
            $openPrs = @(& $OpenPrResolver)
            $matchingPrs = @($openPrs | Where-Object {
                (Get-ShipDeWorkItemIdFromTitle -Title ([string]$_.title)) -eq $workItemId -and
                [string]$_.headRefName -ceq $branch
            })

            if ($matchingPrs.Count -eq 1 -and -not [bool]$matchingPrs[0].isDraft) {
                $matchedPr = $matchingPrs[0]
                Assert-ShipDeGovernedPullRequest -PullRequest $matchedPr -WorkItemId $workItemId -Branch $branch -ExpectedRepository $Repository

                $hasPendingDispatch = ($null -ne $State["PendingDispatch"])
                $ciFailing = $false
                if ($null -ne $matchedPr.statusCheckRollup -and @($matchedPr.statusCheckRollup).Count -gt 0) {
                    $gate = Get-ShipDePrGate -PullRequest $matchedPr
                    if ($gate -eq "FAILED") {
                        $ciFailing = $true
                    }
                }
                $reviewRequiresChanges = ([string]$State["ExactHeadVerdict"] -eq "CHANGES_REQUIRED")
                $hasPendingRepair = ($hasPendingDispatch -or $ciFailing -or $reviewRequiresChanges)

                if ($hasPendingRepair) {
                    $State["State"] = "BLOCKED"
                    $State["PullRequestNumber"] = [int]$matchedPr.number
                    $State["HeadSha"] = [string]$matchedPr.headRefOid
                    & $CheckpointWriter $State
                    throw "Checkpoint AO session '$sessionId' no longer exists while implementation or repair work is pending for PR #$($matchedPr.number). Stopping BLOCKED for human action."
                }

                Write-Host ("[SUPERVISOR] Checkpoint AO session '{0}' no longer exists, but PR #{1} is open with no pending repair. Clearing SessionId/Harness and resuming PR-only review." -f $sessionId, $matchedPr.number)
                $State["SessionId"] = $null
                $State["Harness"] = $null
                $State["PullRequestNumber"] = [int]$matchedPr.number
                $State["HeadSha"] = [string]$matchedPr.headRefOid
                $State["State"] = "STARTED"
                & $CheckpointWriter $State
                return $State
            } else {
                $State["State"] = "MISSING"
                & $CheckpointWriter $State
                throw "Checkpoint AO session '$sessionId' no longer exists and no open PR for $workItemId was found. Stopping fail-closed."
            }
        } elseif ([int]$State["PullRequestNumber"] -gt 0) {
            Write-Host "[SUPERVISOR] Resuming PR-only supervisor state for PR #$($State['PullRequestNumber']) ($workItemId)."
            return $State
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($workItemId) -and $stateValue -eq "SPAWNING") {
        $openPrs = @(& $OpenPrResolver)
        $matchingPrs = @($openPrs | Where-Object {
            (Get-ShipDeWorkItemIdFromTitle -Title ([string]$_.title)) -eq $workItemId -and
            [string]$_.headRefName -ceq $branch
        })

        if ($matchingPrs.Count -eq 1) {
            $matchedPr = $matchingPrs[0]
            Assert-ShipDeGovernedPullRequest -PullRequest $matchedPr -WorkItemId $workItemId -Branch $branch -ExpectedRepository $Repository
            $recoveredSessionId = $null
            $recoveredHarness = $null
            $expectedWorkerName = Get-ShipDeAoWorkerName -Item ([PSCustomObject]@{ WorkItemId = $workItemId })
            $activeSessions = @(& $ActiveWorkersResolver)
            $matchingSessions = @()
            foreach ($candSession in $activeSessions) {
                $candName = Get-ShipDeAoSessionName -Session $candSession
                if (-not [string]::IsNullOrWhiteSpace($candName) -and $candName -eq $expectedWorkerName) {
                    $matchingSessions += $candSession
                    continue
                }
                $sid = Get-ShipDeAoSessionId -Response $candSession
                if (-not [string]::IsNullOrWhiteSpace($sid)) {
                    $candidateWorktree = Join-Path (Get-ShipDeAoWorktreesDir -Project "shipde-platform") $sid
                    if (Test-Path -LiteralPath (Join-Path $candidateWorktree ".git")) {
                        $worktreeBranch = (& git -C $candidateWorktree rev-parse --abbrev-ref HEAD 2>$null).Trim()
                        if ($worktreeBranch -ceq $branch) {
                            $matchingSessions += $candSession
                            continue
                        }
                    }
                }
            }
            if ($matchingSessions.Count -gt 1) {
                throw "Multiple active AO worker sessions match expected worker name '$expectedWorkerName' or branch '$branch' during SPAWNING recovery."
            }
            if ($matchingSessions.Count -eq 1) {
                $recoveredSessionId = Get-ShipDeAoSessionId -Response $matchingSessions[0]
                $sessionDetail = Get-ShipDeAoSessionById -SessionId $recoveredSessionId -Project "shipde-platform"
                $candidates = if (-not [string]::IsNullOrWhiteSpace($author)) { @(Get-ShipDeAoHarnessCandidates -Author $author) } else { @("agy", "claude-code", "open-code") }
                $recoveredHarness = Assert-ShipDeReusedAoSession -SessionDetail $sessionDetail -Item ([PSCustomObject]@{ WorkItemId = $workItemId; Branch = $branch }) -AllowedHarnesses $candidates -Project "shipde-platform"
            }

            if ($State -is [System.Collections.IDictionary]) {
                if ($recoveredSessionId) {
                    $State["SessionId"] = $recoveredSessionId
                    $State["Harness"] = $recoveredHarness
                }
                $State["PullRequestNumber"] = [int]$matchedPr.number
                $State["HeadSha"] = [string]$matchedPr.headRefOid
                $State["State"] = "STARTED"
            } else {
                if ($recoveredSessionId) {
                    $State.SessionId = $recoveredSessionId
                    $State.Harness = $recoveredHarness
                }
                $State.PullRequestNumber = [int]$matchedPr.number
                $State.HeadSha = [string]$matchedPr.headRefOid
                $State.State = "STARTED"
            }
            $State = Normalize-ShipDeSupervisorState -State $State
            & $CheckpointWriter $State
            return $State
        } elseif ($matchingPrs.Count -gt 1) {
            throw "Multiple open implementation Pull Requests match $workItemId on $branch during SPAWNING recovery."
        }

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
        $State = Normalize-ShipDeSupervisorState -State $State
        & $CheckpointWriter $State
        return $State
    }

    $openImplementationPullRequests = @(& $OpenPrResolver | Where-Object {
        Get-ShipDeWorkItemIdFromTitle -Title ([string]$_.title)
    })

    if ($PullRequestNumber -gt 0) {
        $matchingSelectedPrs = @($openImplementationPullRequests | Where-Object { [int]$_.number -eq $PullRequestNumber })
        if ($matchingSelectedPrs.Count -eq 0) {
            throw "Open implementation Pull Request #$PullRequestNumber was not found among open implementation PRs. Failing closed."
        }
        $selectedPr = $matchingSelectedPrs[0]
        $item = & $PrWorkItemResolver $selectedPr
        if (-not $item) {
            throw "Cannot resolve governed Work Item assignment for PR #$($selectedPr.number)."
        }
        Assert-ShipDeGovernedPullRequest -PullRequest $selectedPr -WorkItemId $item.WorkItemId -Branch $item.Branch -ExpectedRepository $Repository

        $headSha = if ($selectedPr.headRefOid) { [string]$selectedPr.headRefOid } else { "" }
        if ([string]::IsNullOrWhiteSpace($headSha)) {
            try {
                $headSha = (& gh pr view ([int]$selectedPr.number) --repo $Repository --json headRefOid --jq .headRefOid 2>$null)
                if ($headSha) { $headSha = $headSha.Trim() }
            } catch {}
        }

        # Requirement 2 & 3: Explicit PR-only review proceeds without binding an implementation session,
        # and Assert-ShipDeReusedAoSession is not called until a worker is actually needed for a repair.
        $reconstructedState = @{
            WorkItemId = $item.WorkItemId
            WorkItemPath = $item.WorkItemPath
            Branch = $item.Branch
            Author = $item.Author
            State = "STARTED"
            PullRequestNumber = [int]$selectedPr.number
            HeadSha = $headSha
            StartTime = (Get-Date).ToUniversalTime().ToString("o")
            LastActivityTime = (Get-Date).ToUniversalTime().ToString("o")
            NudgeCount = 0
            SessionId = $null
            Harness = $null
        }
        $reconstructedState = Normalize-ShipDeSupervisorState -State $reconstructedState
        Write-Host "[SUPERVISOR] Initialized PR-only review for PR #$($selectedPr.number) ($($item.WorkItemId)) on $($item.Branch) without binding an implementation session."
        & $CheckpointWriter $reconstructedState
        return $reconstructedState
    }

    if ($openImplementationPullRequests.Count -gt 0) {
        $openSummary = @($openImplementationPullRequests | ForEach-Object {
            "#{0} {1}" -f $_.number, $_.title
        }) -join "; "
        throw "Open implementation Pull Request(s) exist without a resumable supervisor checkpoint: $openSummary. Supply -PullRequestNumber to recover one exact Work Item or resume it before consuming another prepared row."
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
        SessionId = $null
        Harness = $null
    }
    $State = Normalize-ShipDeSupervisorState -State $State
    & $CheckpointWriter $State

    $prompt = New-ShipDeAuthorPrompt -Item $item
    & $CodexParker
    $spawned = & $WorkerStarter $item $prompt
    $State["Harness"] = $spawned.Harness
    $State["SessionId"] = $spawned.SessionId
    $State["State"] = "STARTED"
    $State = Normalize-ShipDeSupervisorState -State $State
    & $CheckpointWriter $State
    return $State
}

function Invoke-ShipDeSupervise {
    param(
        [int]$PullRequestNumber = 0
    )

    Write-Host "SHIP DE DETERMINISTIC ORCHESTRATOR SUPERVISOR"
    Assert-ShipDeSupervisorMaxNudges -MaxNudges $SupervisorMaxNudges

    # Finding 3: Acquire exclusive supervisor lock BEFORE any stateful startup operations
    # (AO restart, checkpoint initialization, Codex parking, worker spawning)
    Assert-ShipDeSupervisorLock -WorkItemId ""
    try {
        Assert-ShipDeAoCommand
        Assert-ShipDeAoVersion
        Ensure-ShipDeAgentRouterRuntime

        $state = Read-ShipDeSupervisorCheckpoint
        $state = Initialize-ShipDeSupervisorState -State $state -PullRequestNumber $PullRequestNumber -Repository $Repository
        if ($null -eq $state) {
            return
        }

        Update-ShipDeSupervisorLock -WorkItemId ([string]$state.WorkItemId)

        $result = Invoke-ShipDeSupervisorLoop -State $state -PollIntervalSeconds $SupervisorPollIntervalSeconds -InactivityTimeoutMinutes $SupervisorInactivityTimeoutMinutes -MaxNudges $SupervisorMaxNudges -ReviewTimeoutMinutes $SupervisorReviewTimeoutMinutes

        if ($result -eq "READY_FOR_HUMAN_MERGE") {
            Write-Host ("[SUPERVISOR] PR #{0} at {1} has CI GREEN and durable exact-HEAD Codex PASS." -f $state.PullRequestNumber, $state.HeadSha)
            Write-Host "[SUPERVISOR] Human merge is required. No automatic merge was attempted."
            return
        }
        throw "Unexpected supervisor result: $result"
    } finally {
        Release-ShipDeSupervisorLock
    }
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
        } elseif ($exactVerdict -eq "BLOCKED") {
            throw "Independent Codex review returned durable BLOCKED for PR #$($pr.number) at exact HEAD $headSha. Stopping fail-closed for human action."
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
                "7" { Invoke-ShipDeSupervise -PullRequestNumber $PullRequestNumber }
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
    "Supervise" { Invoke-ShipDeSupervise -PullRequestNumber $PullRequestNumber }
    "Test" { Write-Host "ALL SUPERVISOR BEHAVIORAL TESTS PASSED"; return }
    default { Show-ShipDeMenu }
}
