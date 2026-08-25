param(
    [string]$AiRoot = (Join-Path $env:USERPROFILE "AI"),
    [switch]$TestModels
)

. (Join-Path $PSScriptRoot "common.ps1")

$failures = [System.Collections.Generic.List[string]]::new()
$commands = @("git", "gh", "node", "npm", "dsh", "9router")

Write-Host "=== COMMANDS ==="
foreach ($command in $commands) {
    $resolved = Get-Command $command -ErrorAction SilentlyContinue
    if ($resolved) {
        Write-Host ("{0,-10} OK  {1}" -f $command, $resolved.Source)
    } else {
        Write-Host ("{0,-10} MISSING" -f $command)
        $failures.Add("Missing command: $command")
    }
}

Write-Host "`n=== GITHUB ==="
if (Get-Command gh -ErrorAction SilentlyContinue) {
    & gh auth status
    if ($LASTEXITCODE -ne 0) {
        $failures.Add("GitHub CLI authentication failed")
    }
}

Write-Host "`n=== WORKTREES ==="
$paths = Get-ShipDePaths -AiRoot $AiRoot
foreach ($entry in $paths.GetEnumerator()) {
    if (-not (Test-Path (Join-Path $entry.Value ".git"))) {
        Write-Host ("{0,-8} MISSING  {1}" -f $entry.Key, $entry.Value)
        $failures.Add("Missing worktree: $($entry.Value)")
        continue
    }

    $branch = (& git -C $entry.Value branch --show-current).Trim()
    $status = @(& git -C $entry.Value status --porcelain)
    $state = if ($status.Count -eq 0) { "CLEAN" } else { "DIRTY" }
    Write-Host ("{0,-8} {1,-6} [{2}] {3}" -f $entry.Key, $state, $branch, $entry.Value)
    if ($state -eq "DIRTY") {
        $failures.Add("Dirty worktree: $($entry.Value)")
    }
}

Write-Host "`n=== LOCAL SERVICES ==="
$routerUp = Test-ShipDeTcpPort -HostName "127.0.0.1" -Port 20128
$dshUp = Test-ShipDeTcpPort -HostName "127.0.0.1" -Port 3080
Write-Host ("9Router 20128: {0}" -f $(if ($routerUp) { "UP" } else { "STOPPED" }))
Write-Host ("DSH     3080: {0}" -f $(if ($dshUp) { "UP" } else { "STOPPED" }))

if ($TestModels) {
    if (-not $routerUp) {
        $failures.Add("Cannot test models because 9Router is stopped")
    } else {
        $secureKey = Read-Host "Paste 9Router API key" -AsSecureString
        $keyPtr = [IntPtr]::Zero
        try {
            $keyPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
            $plainKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPtr)
            $headers = @{ Authorization = "Bearer $plainKey" }
            $response = Invoke-RestMethod -Uri "http://127.0.0.1:20128/v1/models" -Headers $headers -Method Get
            $ids = @($response.data | ForEach-Object { $_.id })
            Write-Host ("Available models: {0}" -f $ids.Count)
            $combo = "shipde-low-risk"
            $candidates = @(
                "oc/deepseek-v4-flash-free",
                "oc/mimo-v2.5-free",
                "oc/nemotron-3-ultra-free"
            )
            foreach ($candidate in @($combo) + $candidates) {
                Write-Host ("{0,-36} {1}" -f $candidate, $(if ($ids -contains $candidate) { "AVAILABLE" } else { "NOT RETURNED" }))
            }
            $smokeModel = if ($ids -contains $combo) {
                $combo
            } else {
                $candidates | Where-Object { $ids -contains $_ } | Select-Object -First 1
            }
            if (-not $smokeModel) {
                throw "No approved Ship De low-risk model is currently available"
            }
            if ($ids -notcontains $combo) {
                Write-Warning "shipde-low-risk combo is not returned; using verified candidate $smokeModel for the smoke test"
            }

            $smokeBody = @{
                model = $smokeModel
                messages = @(
                    @{ role = "user"; content = "Reply exactly: SHIPDE_OK" }
                )
                temperature = 0
                max_tokens = 16
            } | ConvertTo-Json -Depth 5
            $smoke = Invoke-RestMethod `
                -Uri "http://127.0.0.1:20128/v1/chat/completions" `
                -Headers $headers `
                -Method Post `
                -ContentType "application/json" `
                -Body $smokeBody
            $reply = [string]$smoke.choices[0].message.content
            if ($reply.Trim() -ne "SHIPDE_OK") {
                throw "Model smoke test returned an unexpected response"
            }
            Write-Host ("Model smoke test: PASS ({0})" -f $smokeModel)
        } catch {
            $failures.Add("9Router model request failed: $($_.Exception.Message)")
        } finally {
            if ($keyPtr -ne [IntPtr]::Zero) {
                [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPtr)
            }
            Remove-Variable plainKey, headers, secureKey, smokeBody, smoke, reply -ErrorAction SilentlyContinue
        }
    }
}

if ($failures.Count -gt 0) {
    Write-Host "`n=== ACTION REQUIRED ==="
    $failures | ForEach-Object { Write-Host "- $_" }
    exit 1
}

Write-Host "`nSHIP DE AI SETUP: HEALTHY"
