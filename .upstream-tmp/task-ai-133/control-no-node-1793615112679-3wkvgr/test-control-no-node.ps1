
    $env:SHIPDE_SKIP_STARTUP_COMPAT = "1"
    . "C:\Users\gumac\AI\shipde-platform\.worktrees\p-task-ai-166\scripts\ai\control.ps1" -Action "Test" | Out-Null
    function Get-ShipDePullRequestByNumber {
        param([int]$Number)
        return @{ title = "[TASK-AI-133] Test PR" }
    }
    $env:SHIPDE_DECISION_DIR = "C:\Users\gumac\AI\shipde-platform\.worktrees\p-task-ai-166\.upstream-tmp\task-ai-133\control-no-node-1793615112679-3wkvgr\decisions"
    $env:PATH = "C:\Users\gumac\AI\shipde-platform\.worktrees\p-task-ai-166\.upstream-tmp\task-ai-133\control-no-node-1793615112679-3wkvgr\empty-bin"
    $res = Get-ShipDeExactHeadReviewManifestVerdict -HeadSha "a534db789d8909d86b11dc818defc39864b0c1bc" -PullRequestNumber 1 -RepoDir "C:\Users\gumac\AI\shipde-platform\.worktrees\p-task-ai-166\.upstream-tmp\task-ai-133\control-no-node-1793615112679-3wkvgr\repo"
    Write-Output "VERDICT_NO_NODE:$res"
  