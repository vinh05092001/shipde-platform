/**
 * Ship Dễ — Multi-Source Conflict Detector
 * TASK-AI-15: AI15-R02, AI15-AC06
 * Compares register, git, Paseo agents, and GitHub PR states side by side
 * to detect operational conflicts without silently promoting any state.
 */

function detectConflicts(registerData, gitData, aoData, githubData) {
  const conflicts = [];
  const activeItem = registerData?.activeItem;

  if (!activeItem) return conflicts;

  const activeBranch = activeItem.branch || '';
  const activeWorkItemId = activeItem.work_item_id || '';
  const registerStatus = activeItem.status || '';

  // 1. Branch conflict: Register expected branch vs current git branch
  if (activeBranch && gitData?.currentBranch) {
    if (gitData.currentBranch !== 'unknown' && gitData.currentBranch !== activeBranch) {
      conflicts.push({
        id: 'CONFLICT_BRANCH_MISMATCH',
        severity: 'warning',
        title: `Nhánh làm việc không khớp (${activeWorkItemId})`,
        description: `Register quy định nhánh "${activeBranch}", nhưng worktree hiện tại đang ở nhánh "${gitData.currentBranch}".`,
        sources: [
          { name: 'register', value: activeBranch },
          { name: 'git', value: gitData.currentBranch },
        ],
        impact: 'Cần kiểm tra xem có đang thực hiện code sai nhánh hay không',
      });
    }
  }

  // 2. Dirty worktree conflict during review state
  if (
    (registerStatus === 'READY_FOR_CODEX' || registerStatus === 'CHANGES_REQUIRED') &&
    gitData?.dirtyCount > 0
  ) {
    conflicts.push({
      id: 'CONFLICT_DIRTY_WORKTREE_IN_REVIEW',
      severity: 'error',
      title: `Worktree chưa commit khi đang review (${activeWorkItemId})`,
      description: `Task đang ở trạng thái ${registerStatus} nhưng worktree có ${gitData.dirtyCount} tệp tin chưa commit.`,
      sources: [
        { name: 'register', value: registerStatus },
        { name: 'git', value: `${gitData.dirtyCount} dirty files` },
      ],
      impact: 'Review độc lập của Codex yêu cầu commit HEAD bất biến và worktree sạch',
    });
  }

  // 3. GitHub PR HEAD commit divergence
  if (githubData?.pullRequests && githubData.pullRequests.length > 0) {
    const matchingPr = githubData.pullRequests.find(
      (pr) => pr.headRefName === activeBranch || (pr.title && pr.title.includes(activeWorkItemId))
    );

    if (matchingPr && gitData?.headOid && matchingPr.headRefOid) {
      if (matchingPr.headRefOid !== gitData.headOid) {
        conflicts.push({
          id: 'CONFLICT_PR_HEAD_DIVERGENCE',
          severity: 'warning',
          title: `Lệch commit HEAD giữa Local và PR #${matchingPr.number}`,
          description: `Commit HEAD cục bộ (${gitData.headOidShort}) khác với commit HEAD trên GitHub PR #${matchingPr.number} (${matchingPr.headRefOidShort}).`,
          sources: [
            { name: 'git_local', value: gitData.headOid },
            { name: 'github_pr', value: matchingPr.headRefOid },
          ],
          impact: 'Các kiểm tra CI trên GitHub có thể đang chạy trên phiên bản commit cũ hơn',
        });
      }
    }
  }

  // 4. AO session vs Register branch alignment
  if (aoData?.sessions && aoData.sessions.length > 0) {
    const activeAuthorSession = aoData.sessions.find(
      (s) => s.roleCategory === 'AUTHOR' && !s.isTerminated
    );
    if (activeAuthorSession && activeBranch && activeAuthorSession.branch) {
      if (
        activeAuthorSession.branch !== activeBranch &&
        !activeAuthorSession.branch.includes(activeWorkItemId.toLowerCase())
      ) {
        conflicts.push({
          id: 'CONFLICT_AO_BRANCH_MISMATCH',
          severity: 'info',
          title: `Agent Paseo đang làm việc trên nhánh khác`,
          description: `Agent Paseo ${activeAuthorSession.id} gắn với nhánh "${activeAuthorSession.branch}", trong khi task active hiện tại là "${activeBranch}".`,
          sources: [
            { name: 'register', value: activeBranch },
            { name: 'ao', value: activeAuthorSession.branch },
          ],
          impact: 'Có thể có nhiều phiên song song hoặc phiên trước chưa đồng bộ',
        });
      }
    }
  }

  return conflicts;
}

module.exports = {
  detectConflicts,
};
