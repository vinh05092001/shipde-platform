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
const { collectUsageState } = require('./usage-adapter');
const { detectConflicts } = require('./conflict-detector');
const { redactObject } = require('./redaction');

let currentRevision = 1;
let lastAggregatedState = null;

// AI15-R01: Caching last-known healthy state for sources when temporary
// adapter failures or timeouts occur, honest aging rather than dropping data.
const lastKnownSourceData = {
  git: null,
  ao: null,
  github: null,
  register: null,
};

let previousSourceStatuses = {
  register: null,
  git: null,
  ao: null,
  github: null,
};

// Per-source freshness thresholds (AI15-R01). A source counts as "live"
// only while its most recent successful observation is recent; beyond that
// it is "stale" (last known values, honestly aged), and beyond the outer
// bound — or when collection itself failed / produced no parseable
// timestamp — it is "unavailable". Nothing here is a fabricated success.
const DEFAULT_FRESHNESS_THRESHOLDS_MS = {
  liveMs: 10 * 1000, // within ~2 poll cycles of the 5s default interval
  staleMs: 60 * 1000, // within a minute still counts as usable last-known data
};

/**
 * Derives { ageMs, freshness } for one source health record from its real
 * observedAt timestamp — never assumed, never defaulted to "live".
 */
function computeSourceFreshness(
  observedAt,
  sourceStatus,
  thresholds = DEFAULT_FRESHNESS_THRESHOLDS_MS,
  now = Date.now()
) {
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
function buildGitHubEvidence(activeItem, gitData, githubData, githubSource) {
  if (!activeItem) return null;

  const isHealthObj = typeof githubSource === 'object' && githubSource !== null;
  const status = isHealthObj ? githubSource.status : githubSource;
  const freshness = isHealthObj
    ? githubSource.freshness || githubSource.status
    : status === 'live'
      ? 'live'
      : 'unavailable';

  const isLive = status === 'live' && freshness === 'live';
  const authenticated = Boolean(githubData && githubData.authenticated);
  if (!isLive || !authenticated) {
    return {
      available: false,
      freshness,
      headMatches: false,
      ciPassed: false,
      codexPass: false,
      mergeable: false,
      unresolvedThreadsVerified: false,
      readyForMerge: false,
    };
  }

  const activeBranch = activeItem.branch || '';
  const activeWorkItemId = activeItem.work_item_id || '';
  const pullRequests = (githubData && githubData.pullRequests) || [];
  const matchingPr = pullRequests.find(
    (pr) =>
      pr.headRefName === activeBranch ||
      (pr.title && activeWorkItemId && pr.title.includes(activeWorkItemId))
  );

  if (!matchingPr) {
    return {
      available: true,
      freshness: 'live',
      headMatches: false,
      ciPassed: false,
      codexPass: false,
      mergeable: false,
      unresolvedThreadsVerified: false,
      readyForMerge: false,
    };
  }

  const headMatches = Boolean(
    gitData && gitData.headOid && matchingPr.headRefOid && gitData.headOid === matchingPr.headRefOid
  );
  const ciPassed = Boolean(
    headMatches &&
    matchingPr.checks &&
    matchingPr.checks.summary === 'PASSED' &&
    (matchingPr.checks.totalCount > 0 ||
      (matchingPr.checks.passCount && matchingPr.checks.passCount > 0)) &&
    (matchingPr.checks.failCount === undefined || matchingPr.checks.failCount === 0) &&
    (matchingPr.checks.pendingCount === undefined || matchingPr.checks.pendingCount === 0)
  );
  const codexPass = Boolean(
    headMatches &&
    matchingPr.reviews &&
    matchingPr.reviews.trustedCodexVerdict === 'PASS' &&
    matchingPr.reviews.headShaMatches !== false
  );
  const mergeable = Boolean(headMatches && matchingPr.mergeable === 'MERGEABLE');
  const unresolvedThreadsVerified = Boolean(
    matchingPr.reviews && matchingPr.reviews.unresolvedThreadsCount === 0
  );
  const readyForMerge = Boolean(
    headMatches && ciPassed && codexPass && mergeable && unresolvedThreadsVerified && isLive
  );

  return {
    available: true,
    freshness: 'live',
    headMatches,
    ciPassed,
    codexPass,
    mergeable,
    unresolvedThreadsVerified,
    readyForMerge,
    prNumber: matchingPr.number,
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
        detail: `Commit ${commit.hashShort}`,
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
          detail: `Nhánh: ${session.branch || 'N/A'}`,
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
  if (conflicts && conflicts.some((c) => c.severity === 'error')) {
    return 'conflict';
  }

  const effectiveStatuses = Object.values(sources).map((s) => {
    // If source collection failed or freshness is unavailable
    if (s.status === 'unavailable' || s.freshness === 'unavailable') return 'unavailable';
    // If partial
    if (s.status === 'partial') return 'partial';
    // If freshness or status is stale
    if (s.freshness === 'stale' || s.status === 'stale') return 'stale';
    return 'live';
  });

  if (effectiveStatuses.every((s) => s === 'live')) {
    return 'live';
  }

  if (effectiveStatuses.every((s) => s === 'unavailable')) {
    return 'unavailable';
  }

  if (effectiveStatuses.some((s) => s === 'unavailable' || s === 'partial')) {
    return 'partial';
  }

  if (effectiveStatuses.some((s) => s === 'stale')) {
    return 'stale';
  }

  return 'live';
}

function detectRecoveryTransitions(sources, observationTime) {
  const recoveries = [];
  for (const [key, src] of Object.entries(sources)) {
    const prev = previousSourceStatuses[key];
    const currEffective =
      src.status === 'live' && src.freshness === 'live' ? 'live' : src.status || 'unavailable';
    if (prev && prev !== 'live' && currEffective === 'live') {
      recoveries.push({
        id: `recovery-${key}-${observationTime}`,
        type: 'SOURCE_RECOVERY',
        timestamp: new Date(observationTime).toISOString(),
        title: `Nguồn dữ liệu [${key.toUpperCase()}] đã phục hồi trạng thái LIVE`,
        actor: 'SYSTEM',
        badge: 'RECOVERY',
        detail: `Kết nối và dữ liệu từ ${src.provenance || key} đã bình thường trở lại`,
      });
    }
    previousSourceStatuses[key] = currEffective;
  }
  return recoveries;
}

function hasStateChanged(prevState, candidate) {
  if (!prevState) return true;

  if (prevState.overallStatus !== candidate.overallStatus) return true;

  for (const key of ['register', 'git', 'ao', 'github']) {
    const p = prevState.sources[key];
    const n = candidate.sources[key];
    if (!p || !n) return true;
    if (p.status !== n.status || p.freshness !== n.freshness) return true;
  }

  if (prevState.workItems?.mergedCount !== candidate.workItems?.mergedCount) return true;
  if (prevState.workItems?.total !== candidate.workItems?.total) return true;
  if (
    prevState.workItems?.activeItem?.work_item_id !== candidate.workItems?.activeItem?.work_item_id
  )
    return true;
  if (prevState.workItems?.activeItem?.status !== candidate.workItems?.activeItem?.status)
    return true;
  if (
    prevState.workItems?.gatePipeline?.currentGate !==
    candidate.workItems?.gatePipeline?.currentGate
  )
    return true;

  if ((prevState.conflicts || []).length !== (candidate.conflicts || []).length) return true;
  if ((prevState.sessions || []).length !== (candidate.sessions || []).length) return true;
  if (prevState.git?.headOid !== candidate.git?.headOid) return true;
  if (prevState.git?.dirtyCount !== candidate.git?.dirtyCount) return true;
  if (prevState.github?.authenticated !== candidate.github?.authenticated) return true;

  const prevPrs = prevState.github?.pullRequests || [];
  const nextPrs = candidate.github?.pullRequests || [];
  if (prevPrs.length !== nextPrs.length) return true;
  if (prevPrs[0]?.checks?.summary !== nextPrs[0]?.checks?.summary) return true;
  if (prevPrs[0]?.reviews?.trustedCodexVerdict !== nextPrs[0]?.reviews?.trustedCodexVerdict)
    return true;

  return false;
}

async function aggregateCockpitState(options = {}) {
  const rootDir = options.rootDir || process.cwd();
  const csvPath =
    options.csvPath ||
    path.join(rootDir, 'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv');
  const repo = options.repo || 'vinh05092001/shipde-platform';

  const gitPromise = options.mockGit ? Promise.resolve(options.mockGit) : collectGitState(rootDir);
  const aoPromise = options.mockAo
    ? Promise.resolve(options.mockAo)
    : collectAoState('shipde-platform');
  const githubPromise = options.mockGitHub
    ? Promise.resolve(options.mockGitHub)
    : collectGitHubState(repo);

  const usagePromise = options.mockUsage
    ? Promise.resolve(options.mockUsage)
    : collectUsageState(options.usageOptions);

  let [gitResult, aoResult, githubResult, usageResult] = await Promise.all([
    gitPromise,
    aoPromise,
    githubPromise,
    usagePromise,
  ]);

  // Handle cached last-known state on failure (AI15-R01)
  if (gitResult.health.status === 'unavailable' && lastKnownSourceData.git) {
    gitResult = {
      health: Object.assign({}, gitResult.health, {
        status: 'stale',
        impact: 'Git query unavailable; serving cached last-known state (AI15-R01)',
        observedAt: lastKnownSourceData.git.health.observedAt,
      }),
      data: lastKnownSourceData.git.data,
    };
  } else if (gitResult.health.status === 'live') {
    lastKnownSourceData.git = gitResult;
  }

  if (aoResult.health.status === 'unavailable' && lastKnownSourceData.ao) {
    aoResult = {
      health: Object.assign({}, aoResult.health, {
        status: 'stale',
        impact: 'Agent Orchestrator unavailable; serving cached last-known state (AI15-R01)',
        observedAt: lastKnownSourceData.ao.health.observedAt,
      }),
      data: lastKnownSourceData.ao.data,
    };
  } else if (aoResult.health.status === 'live') {
    lastKnownSourceData.ao = aoResult;
  }

  if (githubResult.health.status === 'unavailable' && lastKnownSourceData.github) {
    githubResult = {
      health: Object.assign({}, githubResult.health, {
        status: 'stale',
        impact: 'GitHub CLI unavailable; serving cached last-known state (AI15-R01)',
        observedAt: lastKnownSourceData.github.health.observedAt,
      }),
      data: lastKnownSourceData.github.data,
    };
  } else if (githubResult.health.status === 'live') {
    lastKnownSourceData.github = githubResult;
  }

  if (usageResult.health.status === 'unavailable' && lastKnownSourceData.usage) {
    usageResult = {
      health: Object.assign({}, usageResult.health, {
        status: 'stale',
        impact: 'Token ledgers unreadable; serving cached last-known usage (AI15-R01)',
        observedAt: lastKnownSourceData.usage.health.observedAt,
      }),
      data: lastKnownSourceData.usage.data,
    };
  } else if (usageResult.health.status === 'live') {
    lastKnownSourceData.usage = usageResult;
  }

  const preferredBranch = gitResult?.data?.currentBranch || null;
  let registerResult = options.mockRegister
    ? options.mockRegister
    : loadRegister(csvPath, preferredBranch, rootDir);

  if (registerResult.health.status === 'unavailable' && lastKnownSourceData.register) {
    registerResult = {
      health: Object.assign({}, registerResult.health, {
        status: 'stale',
        impact: 'Register CSV unreadable; serving cached last-known state (AI15-R01)',
        observedAt: lastKnownSourceData.register.health.observedAt,
      }),
      data: lastKnownSourceData.register.data,
    };
  } else if (registerResult.health.status === 'live') {
    lastKnownSourceData.register = registerResult;
  }

  const observationTime = options.now || Date.now();
  const freshnessThresholds = options.freshnessThresholdsMs || DEFAULT_FRESHNESS_THRESHOLDS_MS;

  function withFreshness(health) {
    const { ageMs, freshness } = computeSourceFreshness(
      health.observedAt,
      health.status,
      freshnessThresholds,
      observationTime
    );
    return Object.assign({}, health, { ageMs, freshness });
  }

  const sources = {
    register: withFreshness(registerResult.health),
    git: withFreshness(gitResult.health),
    ao: withFreshness(aoResult.health),
    github: withFreshness(githubResult.health),
    usage: withFreshness(usageResult.health),
  };

  const conflicts = detectConflicts(
    registerResult.data,
    gitResult.data,
    aoResult.data,
    githubResult.data
  );

  const overallStatus = deriveOverallStatus(sources, conflicts);

  const recoveryEvents = detectRecoveryTransitions(sources, observationTime);
  let activity = buildActivityStream(gitResult.data.recentCommits, aoResult.data.sessions);
  if (recoveryEvents.length > 0) {
    activity = recoveryEvents.concat(activity).slice(0, 15);
  }

  // AI15-R03: recompute the gate pipeline from live, exact-HEAD GitHub
  // evidence rather than trusting the register-only pipeline embedded in
  // registerResult.data.
  const githubEvidence = buildGitHubEvidence(
    registerResult.data.activeItem,
    gitResult.data,
    githubResult.data,
    sources.github
  );
  const gatePipeline = deriveGatePipeline(registerResult.data.activeItem, githubEvidence);

  const candidateState = {
    schemaVersion: '3.3.0',
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
      items: registerResult.data.items,
    },
    sessions: aoResult.data.sessions,
    daemon: aoResult.data.daemon,
    usage: usageResult.data,
    git: gitResult.data,
    github: githubResult.data,
  };

  const changed = hasStateChanged(lastAggregatedState, candidateState);
  if (changed) {
    currentRevision++;
  }
  const revision = currentRevision;

  const rawState = Object.assign({}, candidateState, {
    revision,
    observedAt: new Date(observationTime).toISOString(),
    activity,
  });

  lastAggregatedState = redactObject(rawState);
  return lastAggregatedState;
}

function getLastAggregatedState() {
  return lastAggregatedState;
}

function resetRevisionForTest(val = 1) {
  currentRevision = val;
  lastAggregatedState = null;
  lastKnownSourceData.git = null;
  lastKnownSourceData.ao = null;
  lastKnownSourceData.github = null;
  lastKnownSourceData.register = null;
  previousSourceStatuses = { register: null, git: null, ao: null, github: null };
}

module.exports = {
  aggregateCockpitState,
  getLastAggregatedState,
  resetRevisionForTest,
  buildGitHubEvidence,
  buildActivityStream,
  deriveOverallStatus,
  computeSourceFreshness,
  DEFAULT_FRESHNESS_THRESHOLDS_MS,
};
