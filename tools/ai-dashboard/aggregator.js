/**
 * Ship Dễ — Multi-Source State Aggregator
 * TASK-AI-15: AI15-R01, AI15-R02, AI15-R05, AI15-AC01..AC06
 * Consolidates truthful register, git, Paseo, and GitHub observations into a single
 * versioned payload with monotonic revision and source health records.
 */

const path = require('path');
const { loadRegister, deriveGatePipeline } = require('./register-adapter');
const { collectGitState } = require('./git-adapter');
const { collectPaseoState } = require('./paseo-adapter');
const { collectGitHubState } = require('./github-adapter');
const { collectUsageState } = require('./usage-adapter');
const { collectCapacity } = require('./capacity-adapter');
const { collectAgyPoolState } = require('./agy-pool-adapter');
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

  // Paseo agent updates as activity items (the source key stays 'ao')
  if (Array.isArray(aoSessions)) {
    for (const session of aoSessions) {
      if (session.lastActivityAt || session.updatedAt) {
        activities.push({
          id: `ao-${session.id}`,
          type: 'AO_SESSION',
          timestamp: session.lastActivityAt || session.updatedAt,
          title: `Agent Paseo [${session.id}] — ${session.displayRole} (${session.status})`,
          actor: session.harness,
          badge: 'Paseo',
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

/**
 * A stable fingerprint of the session fields the cockpit displays.
 *
 * Ordered by id rather than by arrival so a reordered list is not mistaken for
 * a changed one, and joined with a separator that cannot occur in the values.
 */
function sessionSignature(sessions) {
  return (sessions || [])
    .map((s) =>
      [s.id, s.status, s.activity, s.role, s.category, s.branch, s.terminated]
        .map((v) => (v === undefined || v === null ? '' : String(v)))
        .join('')
    )
    .sort()
    .join('');
}

function hasStateChanged(prevState, candidate) {
  if (!prevState) return true;

  if (prevState.overallStatus !== candidate.overallStatus) return true;

  for (const key of ['register', 'git', 'ao', 'github', 'agyPool']) {
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
  // Counting sessions answers "did one appear or disappear", which is not the
  // question. A session that changes status, activity, role or branch without
  // the count moving is the ordinary case — a worker going from active to
  // exited — and comparing lengths reports no change, so the panel keeps
  // showing the old state until something unrelated happens to move a
  // different field. The signature covers what the panel actually renders.
  if (sessionSignature(prevState.sessions) !== sessionSignature(candidate.sessions)) return true;
  if (prevState.git?.headOid !== candidate.git?.headOid) return true;
  if (prevState.git?.dirtyCount !== candidate.git?.dirtyCount) return true;
  if (prevState.github?.authenticated !== candidate.github?.authenticated) return true;
  if (JSON.stringify(prevState.agyPool) !== JSON.stringify(candidate.agyPool)) return true;

  const prevPrs = prevState.github?.pullRequests || [];
  const nextPrs = candidate.github?.pullRequests || [];
  if (prevPrs.length !== nextPrs.length) return true;
  if (prevPrs[0]?.checks?.summary !== nextPrs[0]?.checks?.summary) return true;
  if (prevPrs[0]?.reviews?.trustedCodexVerdict !== nextPrs[0]?.reviews?.trustedCodexVerdict)
    return true;

  return false;
}

// Per-source refresh windows. The dispatcher's own logs are cheap and stay live; the three
// collectors that spawn processes (gh, git, ao) are throttled because their subjects do not
// change between one five-second poll and the next.
const SOURCE_TTL_MS = {
  git: 20000,
  // Paseo replaced AO; the key stays 'ao' so every consumer of sources.ao keeps working.
  ao: 15000,
  github: 45000,
  // Quota ledgers and capacity are re-derived from files that change at most
  // once per turn, so a 5s poll re-reading them was pure waste.
  usage: 30000,
  capacity: 30000,
  agyPool: 15000,
};
const sourceCache = new Map();

function cachedCollect(name, run) {
  const ttl = SOURCE_TTL_MS[name] || 0;
  const now = Date.now();
  const hit = sourceCache.get(name);

  // Fresh enough: serve what we have.
  if (hit && hit.value !== undefined && now - hit.at < ttl) return Promise.resolve(hit.value);

  // A refresh is already running. Serve the previous answer if there is one, otherwise wait
  // for it. Without this check every poll started another collector while the first was
  // still running, so throttling turned into pile-up and the server used twice the CPU.
  if (hit && hit.inflight) {
    return hit.value !== undefined ? Promise.resolve(hit.value) : hit.inflight;
  }

  const inflight = Promise.resolve()
    .then(run)
    .then((value) => {
      sourceCache.set(name, { at: Date.now(), value, inflight: null });
      return value;
    })
    .catch((err) => {
      const prev = sourceCache.get(name);
      if (prev && prev.value !== undefined) {
        // Keep the last good answer rather than dropping the source to unavailable.
        sourceCache.set(name, { at: Date.now(), value: prev.value, inflight: null });
        return prev.value;
      }
      sourceCache.set(name, { at: 0, value: undefined, inflight: null });
      throw err;
    });

  sourceCache.set(name, {
    at: hit ? hit.at : 0,
    value: hit ? hit.value : undefined,
    inflight,
  });
  return hit && hit.value !== undefined ? Promise.resolve(hit.value) : inflight;
}

async function aggregateCockpitState(options = {}) {
  const rootDir = options.rootDir || process.cwd();
  const csvPath =
    options.csvPath ||
    path.join(rootDir, 'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv');
  const repo = options.repo || 'vinh05092001/shipde-platform';

  const gitPromise = options.mockGit
    ? Promise.resolve(options.mockGit)
    : cachedCollect('git', () => collectGitState(rootDir));
  const aoPromise = options.mockAo
    ? Promise.resolve(options.mockAo)
    : cachedCollect('ao', () => collectPaseoState());
  const githubPromise = options.mockGitHub
    ? Promise.resolve(options.mockGitHub)
    : cachedCollect('github', () => collectGitHubState(repo));

  const usagePromise = options.mockUsage
    ? Promise.resolve(options.mockUsage)
    : cachedCollect('usage', () => collectUsageState(options.usageOptions));

  const capacityPromise = options.mockCapacity
    ? Promise.resolve(options.mockCapacity)
    : cachedCollect('capacity', () => Promise.resolve(collectCapacity(options.capacityOptions)));

  const agyPoolPromise = options.mockAgyPool
    ? Promise.resolve(options.mockAgyPool)
    : cachedCollect('agyPool', () => Promise.resolve(collectAgyPoolState(options.agyPoolOptions)));

  let [gitResult, aoResult, githubResult, usageResult, capacityResult, agyPoolResult] =
    await Promise.all([
      gitPromise,
      aoPromise,
      githubPromise,
      usagePromise,
      capacityPromise,
      agyPoolPromise,
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
        impact: 'Paseo unavailable; serving cached last-known state (AI15-R01)',
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

  // A source served from the TTL cache is deliberately re-queried only once per
  // TTL, so judging it against the 5s poll cadence labelled every cached source
  // "stale" while it was exactly on schedule. Its window widens to its TTL; a
  // source that misses several refreshes still ages out.
  function withFreshness(health, key) {
    const ttl = options.freshnessThresholdsMs ? 0 : SOURCE_TTL_MS[key] || 0;
    const thresholds = ttl
      ? {
          liveMs: Math.max(freshnessThresholds.liveMs, ttl + 10000),
          staleMs: Math.max(freshnessThresholds.staleMs, ttl * 3),
        }
      : freshnessThresholds;
    const { ageMs, freshness } = computeSourceFreshness(
      health.observedAt,
      health.status,
      thresholds,
      observationTime
    );
    return Object.assign({ name: key }, health, { ageMs, freshness });
  }

  const sources = {
    register: withFreshness(registerResult.health, 'register'),
    git: withFreshness(gitResult.health, 'git'),
    ao: withFreshness(aoResult.health, 'ao'),
    github: withFreshness(githubResult.health, 'github'),
    usage: withFreshness(usageResult.health, 'usage'),
    capacity: withFreshness(capacityResult.health, 'capacity'),
    agyPool: withFreshness(agyPoolResult.health, 'agyPool'),
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
    capacity: capacityResult.data,
    agyPool: agyPoolResult.data,
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
