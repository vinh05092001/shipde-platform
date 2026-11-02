
    $env:SHIPDE_SKIP_STARTUP_COMPAT = "1"
    . "C:\Users\gumac\AI\shipde-platform\.worktrees\p-task-ai-166\scripts\ai\control.ps1" -Action "Test" | Out-Null
    function Get-ShipDePullRequestByNumber {
        param([int]$Number)
        return @{ title = "[TASK-AI-133] Test PR" }
    }
    $env:SHIPDE_DECISION_DIR = "C:\Users\gumac\AI\shipde-platform\.worktrees\p-task-ai-166\.upstream-tmp\task-ai-133\control-ps1-1793615049303-kpqz7m\decisions"
    $res = Get-ShipDeExactHeadReviewManifestVerdict -HeadSha "cbb4f926a5e3284243036e031e692bff3f5f4ba0" -PullRequestNumber 1 -RepoDir "C:\Users\gumac\AI\shipde-platform\.worktrees\p-task-ai-166\.upstream-tmp\task-ai-133\control-ps1-1793615049303-kpqz7m\repo"
    Write-Output "VERDICT_RESULT:$res"
  