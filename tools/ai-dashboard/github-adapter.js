/**
 * Ship Dễ — GitHub CLI Adapter
 * TASK-AI-15: AI15-R01, AI15-R03, AI15-R05, AI15-R06, AI15-AC03
 * Authenticated read-only queries for exact-HEAD Pull Requests, CI checks,
 * and Codex review verdicts. Never prompts for login or fabricates mock PR data.
 */

const { execFile } = require('child_process');

const CMD_TIMEOUT = 8000;
const MAX_BUFFER = 2 * 1024 * 1024;

// AGENTS.md: the only reviewer identity trusted for an authoritative Codex
// verdict. No other bot or human login may be treated as this evidence.
const TRUSTED_CODEX_LOGIN = 'chatgpt-codex-connector[bot]';

/**
 * Maps raw `gh` stderr/stdout/exception text to one of a small set of safe,
 * stable reasons. `gh auth status` failure text can include the logged-in
 * account/user identifier, and any command's raw output can be a multiline
 * diagnostic dump — neither may ever reach the UI. Only these fixed strings
 * are returned; the raw text itself is discarded.
 */
function safeGitHubErrorReason(raw, fallback) {
  const text = typeof raw === 'string' ? raw : '';
  if (/not logged into|auth login|no oauth token|not authenticated/i.test(text)) {
    return 'GitHub CLI unauthenticated (run gh auth login)';
  }
  if (/failed to log in/i.test(text)) {
    return 'GitHub CLI authentication is invalid or expired (run gh auth login)';
  }
  if (/is not recognized|command not found|ENOENT/i.test(text)) {
    return 'GitHub CLI (gh) not found or not on PATH';
  }
  if (/rate limit/i.test(text)) {
    return 'GitHub API rate limit reached';
  }
  if (/permission denied|forbidden|403/i.test(text)) {
    return 'GitHub CLI reported a permission error for this repository';
  }
  if (/timed out|timeout/i.test(text)) {
    return 'GitHub CLI command timed out';
  }
  return fallback || 'GitHub CLI command failed';
}

function runGhCommand(args) {
  return new Promise((resolve) => {
    execFile(
      'gh',
      args,
      { timeout: CMD_TIMEOUT, maxBuffer: MAX_BUFFER },
      (error, stdout, stderr) => {
        if (error) {
          resolve({
            success: false,
            exitCode: error.code || 1,
            stdout: stdout ? stdout.trim() : '',
            stderr: stderr ? stderr.trim() : error.message,
          });
        } else {
          resolve({
            success: true,
            exitCode: 0,
            stdout: stdout ? stdout.trim() : '',
            stderr: '',
          });
        }
      }
    );
  });
}

function parseChecks(rollup) {
  if (!Array.isArray(rollup))
    return {
      list: [],
      summary: 'NO_CHECKS',
      passCount: 0,
      failCount: 0,
      pendingCount: 0,
      totalCount: 0,
    };

  const list = rollup.map((c) => {
    return {
      name: c.name || 'check',
      workflowName: c.workflowName || '',
      status: (c.status || 'UNKNOWN').toUpperCase(),
      conclusion: (
        c.conclusion || (c.status === 'COMPLETED' ? 'NEUTRAL' : 'PENDING')
      ).toUpperCase(),
      detailsUrl: c.detailsUrl || '',
      completedAt: c.completedAt || null,
    };
  });

  const totalCount = list.length;
  const passCount = list.filter((c) => c.conclusion === 'SUCCESS').length;
  const pendingCount = list.filter(
    (c) =>
      c.status !== 'COMPLETED' ||
      c.conclusion === 'PENDING' ||
      c.status === 'IN_PROGRESS' ||
      c.status === 'QUEUED' ||
      c.status === 'WAITING' ||
      c.status === 'REQUESTED'
  ).length;

  // Non-success conclusions when completed are failures (FAILURE, TIMED_OUT, CANCELLED, STARTUP_FAILURE, ACTION_REQUIRED)
  const failCount = list.filter((c) => {
    if (c.status !== 'COMPLETED') return false;
    const conc = c.conclusion;
    return conc !== 'SUCCESS' && conc !== 'NEUTRAL' && conc !== 'SKIPPED';
  }).length;

  let summary = 'PASSED';
  if (totalCount === 0) {
    summary = 'NO_CHECKS';
  } else if (failCount > 0) {
    summary = 'FAILED';
  } else if (pendingCount > 0) {
    summary = 'PENDING';
  } else if (passCount > 0) {
    summary = 'PASSED';
  } else {
    summary = 'NEUTRAL';
  }

  return {
    list,
    summary,
    passCount,
    failCount,
    pendingCount,
    totalCount,
  };
}

function parseReviews(reviews, comments, headSha = null) {
  const result = {
    latestVerdict: 'PENDING',
    trustedCodexVerdict: 'PENDING',
    headShaMatches: null,
    reviewList: [],
    unresolvedThreadsCount: null, // Unverified without GraphQL reviewThreads query; never default 0
    unresolvedThreadsStatus: 'UNVERIFIED',
  };

  const headShaNormalized = (headSha || '').trim().toLowerCase();

  if (Array.isArray(reviews)) {
    result.reviewList = reviews.map((r) => ({
      author: r.author ? r.author.login : 'unknown',
      state: (r.state || 'COMMENTED').toUpperCase(),
      submittedAt: r.submittedAt || null,
      bodyPreview: (r.body || '').substring(0, 150),
    }));

    // Find the exact trusted Codex bot review. Any other login — including
    // one that merely contains "codex" or "bot" — must never be trusted as
    // an authoritative verdict (AGENTS.md single trusted reviewer identity).
    const codexReview = reviews
      .slice()
      .reverse()
      .find((r) => {
        const login = r.author ? r.author.login : '';
        return login === TRUSTED_CODEX_LOGIN;
      });

    if (codexReview) {
      const state = (codexReview.state || '').toUpperCase();
      const body = codexReview.body || '';
      const bodyUpper = body.toUpperCase();
      const reviewCommitId = (
        codexReview.commitId ||
        codexReview.commit_id ||
        (codexReview.commit && codexReview.commit.oid) ||
        ''
      ).toLowerCase();

      // Verify exact-HEAD match if headSha is provided
      let headShaMatches = true;
      if (headShaNormalized) {
        if (reviewCommitId) {
          headShaMatches =
            reviewCommitId === headShaNormalized ||
            headShaNormalized.startsWith(reviewCommitId) ||
            reviewCommitId.startsWith(headShaNormalized);
        } else if (body) {
          const headShort = headShaNormalized.substring(0, 7);
          headShaMatches =
            body.toLowerCase().includes(headShaNormalized) ||
            body.toLowerCase().includes(headShort);
        }
      }

      result.headShaMatches = headShaMatches;

      if (!headShaMatches) {
        // Review was on an older commit, not current HEAD
        result.trustedCodexVerdict = 'STALE_REVIEW';
      } else if (
        state === 'APPROVED' ||
        bodyUpper.includes('VERDICT: PASS') ||
        bodyUpper.includes('**PASS**')
      ) {
        result.trustedCodexVerdict = 'PASS';
      } else if (
        state === 'CHANGES_REQUESTED' ||
        bodyUpper.includes('VERDICT: CHANGES_REQUIRED') ||
        bodyUpper.includes('CHANGES REQUIRED')
      ) {
        result.trustedCodexVerdict = 'CHANGES_REQUIRED';
      } else {
        result.trustedCodexVerdict = state;
      }
    }
  }

  return result;
}

async function collectGitHubState(repo = 'vinh05092001/shipde-platform') {
  const startTime = Date.now();

  try {
    // 1. Check authentication status first
    const authRes = await runGhCommand(['auth', 'status']);
    if (!authRes.success) {
      return {
        health: {
          name: 'github',
          status: 'unavailable',
          observedAt: new Date().toISOString(),
          latencyMs: Date.now() - startTime,
          provenance: 'gh auth status',
          impact: 'GitHub CLI unauthenticated; Pull Request and CI gates unavailable',
          error: safeGitHubErrorReason(authRes.stderr, 'gh auth status failed'),
        },
        data: {
          authenticated: false,
          repo,
          pullRequests: [],
        },
      };
    }

    // 2. Fetch open PRs for repository
    const prListRes = await runGhCommand([
      'pr',
      'list',
      '--repo',
      repo,
      '--state',
      'open',
      '--json',
      'number,title,headRefName,baseRefName,state,url,headRefOid',
    ]);

    if (!prListRes.success) {
      return {
        health: {
          name: 'github',
          status: 'unavailable',
          observedAt: new Date().toISOString(),
          latencyMs: Date.now() - startTime,
          provenance: `gh pr list --repo ${repo}`,
          impact: 'Cannot list pull requests from GitHub repository',
          error: safeGitHubErrorReason(prListRes.stderr, 'gh pr list failed'),
        },
        data: {
          authenticated: true,
          repo,
          pullRequests: [],
        },
      };
    }

    let rawPrs = [];
    try {
      rawPrs = JSON.parse(prListRes.stdout);
    } catch {
      rawPrs = [];
    }

    if (!Array.isArray(rawPrs)) rawPrs = [];

    // 3. For each PR (or primary PRs), fetch detailed rollup
    const detailedPrs = await Promise.all(
      rawPrs.map(async (pr) => {
        const viewRes = await runGhCommand([
          'pr',
          'view',
          String(pr.number),
          '--repo',
          repo,
          '--json',
          'number,title,state,statusCheckRollup,reviews,reviewRequests,comments,headRefOid,mergeable,url',
        ]);

        if (viewRes.success) {
          try {
            // The response has to be parsed before it can be read. Without this
            // line every successful `gh pr view` threw a ReferenceError that the
            // catch below swallowed into checks: ERROR, so an open PR with green
            // checks and a Codex PASS was reported as having neither.
            const detail = JSON.parse(viewRes.stdout);
            const headOid = detail.headRefOid || pr.headRefOid || '';
            const checks = parseChecks(detail.statusCheckRollup);
            const reviewInfo = parseReviews(detail.reviews, detail.comments, headOid);

            return {
              number: detail.number,
              title: detail.title,
              state: detail.state,
              url: detail.url,
              headRefName: pr.headRefName,
              headRefOid: detail.headRefOid || pr.headRefOid || '',
              headRefOidShort: (detail.headRefOid || pr.headRefOid || '').substring(0, 7),
              mergeable: detail.mergeable || 'UNKNOWN',
              checks,
              reviews: reviewInfo,
            };
          } catch (e) {
            return {
              number: pr.number,
              title: pr.title,
              state: pr.state,
              url: pr.url,
              headRefName: pr.headRefName,
              headRefOid: pr.headRefOid || '',
              headRefOidShort: (pr.headRefOid || '').substring(0, 7),
              mergeable: 'UNKNOWN',
              checks: { list: [], summary: 'ERROR', passCount: 0, totalCount: 0 },
              reviews: { latestVerdict: 'ERROR', trustedCodexVerdict: 'UNKNOWN', reviewList: [] },
            };
          }
        }

        return {
          number: pr.number,
          title: pr.title,
          state: pr.state,
          url: pr.url,
          headRefName: pr.headRefName,
          headRefOid: pr.headRefOid || '',
          headRefOidShort: (pr.headRefOid || '').substring(0, 7),
          mergeable: 'UNKNOWN',
          checks: { list: [], summary: 'UNAVAILABLE', passCount: 0, totalCount: 0 },
          reviews: { latestVerdict: 'UNAVAILABLE', trustedCodexVerdict: 'UNKNOWN', reviewList: [] },
        };
      })
    );

    return {
      health: {
        name: 'github',
        status: 'live',
        observedAt: new Date().toISOString(),
        latencyMs: Date.now() - startTime,
        provenance: `gh CLI (authenticated as repo ${repo})`,
        impact: 'None — Pull Request and CI observations verified',
        error: null,
      },
      data: {
        authenticated: true,
        repo,
        pullRequests: detailedPrs,
      },
    };
  } catch (err) {
    return {
      health: {
        name: 'github',
        status: 'unavailable',
        observedAt: new Date().toISOString(),
        latencyMs: Date.now() - startTime,
        provenance: 'gh CLI',
        impact: 'GitHub adapter execution failed',
        error: safeGitHubErrorReason(err.message, 'gh CLI execution failed'),
      },
      data: {
        authenticated: false,
        repo,
        pullRequests: [],
      },
    };
  }
}

module.exports = {
  runGhCommand,
  parseChecks,
  parseReviews,
  collectGitHubState,
  TRUSTED_CODEX_LOGIN,
  safeGitHubErrorReason,
};
