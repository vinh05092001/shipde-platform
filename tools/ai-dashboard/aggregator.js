/**
 * Ship Dễ — Multi-Source State Aggregator
 * TASK-AI-15: AI15-R01, AI15-R02, AI15-R05, AI15-AC01..AC06
 * Consolidates truthful register, git, AO, and GitHub observations into a single
 * versioned payload with monotonic revision and source health records.
 */

const path = require('path');
const { loadRegister, deriveGatePipeline } = require('./register-adapter');
const { collectGitState } = require('./git-adapter');
const { collectAoState } = require('./ao-adapter');
const { collectGitHubState } = require('./github-adapter');
const { detectConflicts } = require('./conflict-detector');
const { redactObject } = require('./redaction');

let currentRevision = 1;
let lastAggregatedState = null;

// Per-source freshness thresholds (AI15-R01). A source counts as "live"
// only while its most recent successful observation is recent; beyond that
// it is "stale" (last known values, honestly aged), and beyond the outer
// bound — or when collection itself failed / produced no parseable
// timestamp — it is "unavailable". Nothing here is a fabricated success.
const DEFAULT_FRESHNESS_THRESHOLDS_MS = {
  liveMs: 10 * 1000,   // within ~2 poll cycles of the 5s default interval
  staleMs: 60 * 1000   // within a minute still counts as usable last-known data
};

/**
 * Derives { ageMs, freshness } for one source health record from its real
 * observedAt timestamp — never assumed, never defaulted to "live".
 */
function computeSourceFreshness(observedAt, sourceStatus, thresholds = DEFAULT_FRESHNESS_THRESHOLDS_MS, now = Date.now()) {
  if (sourceStatus === 'unavailable' || !observedAt) {
    return { ageMs: null, freshness: 'unavailable' };
  }

  const observedMs = new Date(observedAt).getTime();
  if (Number.isNaN(observedMs)) {
    return { ageMs: null, freshness: 'unavailable' };
  }

  const ageMs = Math.max(0, now - observedMs);
  let freshness;
  if (ageMs <= thresholds.liveMs) {
    freshness = 'live';
  } else if (ageMs <= thresholds.staleMs) {
    freshness = 'stale';
  } else {
    freshness = 'unavailable';
  }

  return { ageMs, freshness };
}

/**
 * Builds the exact-HEAD GitHub evidence the gate pipeline requires
 * (AI15-R03). Never infers CI/review PASS from the register: this looks
 * only at live GitHub PR data, and only counts as evidence when the PR's
 * head commit exactly matches the local git HEAD observed for the same
 * aggregation cycle.
 */
function buildGitHubEvidence(activeItem, gitData, githubData, githubSourceStatus) {
  if (!activeItem) return null;

  const available = githubSourceStatus === 'live' && Boolean(githubData && githubData.authenticated);
  if (!available) {
    return { available: false, headMatches: false, ciPassed: false, codexPass: false };
  }

  const activeBranch = activeItem.branch || '';
  const activeWorkItemId = activeItem.work_item_id || '';
  const pullRequests = (githubData && githubData.pullRequests) || [];
  const matchingPr = pullRequests.find(pr =>
    pr.headRefName === activeBranch || (pr.title && activeWorkItemId && pr.title.includes(activeWorkItemId))
  );

  if (!matchingPr) {
    return { available: true, headMatches: false, ciPassed: false, codexPass: false };
  }

  const headMatches = Boolean(
    gitData && gitData.headOid && matchingPr.headRefOid && gitData.headOid === matchingPr.headRefOid
  );
  const ciPassed = Boolean(
    headMatches && matchingPr.checks && matchingPr.checks.summary === 'PASSED' && matchingPr.checks.totalCount > 0
  );
  const codexPass = Boolean(
    headMatches && matchingPr.reviews && matchingPr.reviews.trustedCodexVerdict === 'PASS'
  );

  return {
    available: true,
    headMatches,
    ciPassed,
    codexPass,
    prNumber: matchingPr.number
  };
}

function buildActivityStream(gitCommits, aoSessions) {
  const activities = [];

  // Git commits as activity items
  if (Array.isArray(gitCommits)) {
    for (const commit of gitCommits.slice(0, 10)) {
      activities.push({
        id: `commit-${commit.hashShort}`,
        type: 'GIT_COMMIT',
        timestamp: commit.date,
        title: commit.message,
        actor: commit.authorName,
        badge: 'GIT',
        detail: `Commit ${commit.hashShort}`
      });
    }
  }

  // AO session updates as activity items
  if (Array.isArray(aoSessions)) {
    for (const session of aoSessions) {
      if (session.lastActivityAt || session.updatedAt) {
        activities.push({
          id: `ao-${session.id}`,
          type: 'AO_SESSION',
          timestamp: session.lastActivityAt || session.updatedAt,
          title: `Phiên làm việc [${session.id}] — ${session.displayRole} (${session.status})`,
          actor: session.harness,
          badge: 'AO',
          detail: `Nhánh: ${session.branch || 'N/A'}`
        });
      }
    }
  }

  // Sort descending by timestamp
  activities.sort((a, b) => {
    const tA = new Date(a.timestamp).getTime() || 0;
    const tB = new Date(b.timestamp).getTime() || 0;
    return tB - tA;
  });

  return activities.slice(0, 15);
}

function deriveOverallStatus(sources, conflicts) {
  const statuses = Object.values(sources).map(s => s.status);

  if (conflicts && conflicts.some(c => c.severity === 'error')) {
    return 'conflict';
  }

  if (statuses.every(s => s === 'live')) {
    return 'live';
  }

  if (statuses.every(s => s === 'unavailable')) {
    return 'unavailable';
  }

  if (statuses.some(s => s === 'unavailable' || s === 'partial')) {
    return 'partial';
  }

  if (statuses.some(s => s === 'stale')) {
    return 'stale';
  }

  return 'live';
}

async function aggregateCockpitState(options = {}) {
  const rootDir = options.rootDir || process.cwd();
  const csvPath = options.csvPath || path.join(rootDir, 'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv');
  const repo = options.repo || 'vinh05092001/shipde-platform';

  const gitPromise = options.mockGit ? Promise.resolve(options.mockGit) : collectGitState(rootDir);
  const aoPromise = options.mockAo ? Promise.resolve(options.mockAo) : collectAoState('shipde-platform');
  const githubPromise = options.mockGitHub ? Promise.resolve(options.mockGitHub) : collectGitHubState(repo);

  const [gitResult, aoResult, githubResult] = await Promise.all([
    gitPromise,
    aoPromise,
    githubPromise
  ]);

  const preferredBranch = gitResult?.data?.currentBranch || null;
  const registerResult = options.mockRegister ? options.mockRegister : loadRegister(csvPath, preferredBranch, rootDir);

  const observationTime = options.now || Date.now();
  const freshnessThresholds = options.freshnessThresholdsMs || DEFAULT_FRESHNESS_THRESHOLDS_MS;

  function withFreshness(health) {
    const { ageMs, freshness } = computeSourceFreshness(health.observedAt, health.status, freshnessThresholds, observationTime);
    return Object.assign({}, health, { ageMs, freshness });
  }

  const sources = {
    register: withFreshness(registerResult.health),
    git: withFreshness(gitResult.health),
    ao: withFreshness(aoResult.health),
    github: withFreshness(githubResult.health)
  };

  const conflicts = detectConflicts(
    registerResult.data,
    gitResult.data,
    aoResult.data,
    githubResult.data
  );

  const overallStatus = deriveOverallStatus(sources, conflicts);
  const activity = buildActivityStream(gitResult.data.recentCommits, aoResult.data.sessions);

  // AI15-R03: recompute the gate pipeline from live, exact-HEAD GitHub
  // evidence rather than trusting the register-only pipeline embedded in
  // registerResult.data (which cannot see git/GitHub and reports downstream
  // gates as unavailable on its own).
  const githubEvidence = buildGitHubEvidence(
    registerResult.data.activeItem,
    gitResult.data,
    githubResult.data,
    sources.github.status
  );
  const gatePipeline = deriveGatePipeline(registerResult.data.activeItem, githubEvidence);

  const revision = currentRevision++;

  const rawState = {
    schemaVersion: '3.3.0',
    revision,
    observedAt: new Date().toISOString(),
    overallStatus,
    sources,
    conflicts,
    workItems: {
      total: registerResult.data.total,
      mergedCount: registerResult.data.mergedCount,
      completionPercent: registerResult.data.completionPercent,
      byStatus: registerResult.data.byStatus,
      bySlice: registerResult.data.bySlice,
      activeItem: registerResult.data.activeItem,
      gatePipeline,
      items: registerResult.data.items
    },
    sessions: aoResult.data.sessions,
    daemon: aoResult.data.daemon,
    git: gitResult.data,
    github: githubResult.data,
    activity
  };

  lastAggregatedState = redactObject(rawState);
  return lastAggregatedState;
}

function getLastAggregatedState() {
  return lastAggregatedState;
}

function resetRevisionForTest(val = 1) {
  currentRevision = val;
  lastAggregatedState = null;
}

module.exports = {
  aggregateCockpitState,
  getLastAggregatedState,
  resetRevisionForTest,
  buildGitHubEvidence,
  buildActivityStream,
  deriveOverallStatus,
  computeSourceFreshness,
  DEFAULT_FRESHNESS_THRESHOLDS_MS
};
