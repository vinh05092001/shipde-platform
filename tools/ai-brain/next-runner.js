'use strict';

/**
 * Ship Dễ — Controller Next Runner (TASK-AI-132)
 *
 * Picks the next dependency-ready Work Item and runs it through intake,
 * with no supervisor dispatch.
 *
 * Enforces:
 *   NX-R01: dependency gating, unmerged dependencies skipped, BLOCKED skipped,
 *           claimed skipped, returns first ready item in register order.
 *   NX-R02: --run calls intake --run, enforces concurrency ceiling (at most 2
 *           active writers and 2 active reviewers read from existing ceiling data).
 *   NX-R03: --loop repeats after each item reaches terminal state (published,
 *           merged, blocked or refused). Stops cleanly on NO_READY_ITEM,
 *           ALL_LANES_UNAVAILABLE (waits until reset time) or stop file.
 *           Writes decision record every iteration with no busy loop.
 *   NX-R04: never alters Work Item product meaning, never edits register
 *           except through existing status-transition code path. BLOCKED items
 *           are never picked.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const decisions = require('./decisions');
const { parseDependencies } = require('./reconcile');
const { CONCURRENCY_CEILING, DEFAULTS, isGovernedDecision } = require('./scheduler');
const evidenceApi = require('./evidence');
const intakeApi = require('./intake');
const sourcesApi = require('./sources');

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadConfig(rootDir) {
  const dirs = [
    rootDir ? path.join(path.resolve(rootDir), '.shipde') : null,
    path.join(os.homedir(), '.shipde'),
  ].filter(Boolean);

  for (const dir of dirs) {
    const cfgPath = path.join(dir, 'config.json');
    try {
      if (fs.existsSync(cfgPath)) {
        return JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      }
    } catch (_) {}
  }
  return {};
}

function getPollingInterval(options, deps) {
  const opts = options || {};
  const d = deps || {};
  if (typeof opts.pollIntervalMs === 'number') return opts.pollIntervalMs;
  if (typeof d.pollIntervalMs === 'number') return d.pollIntervalMs;
  const cfg = d.config || opts.config || loadConfig(opts.rootDir);
  if (cfg && typeof cfg.pollIntervalMs === 'number') {
    return cfg.pollIntervalMs;
  }
  return 5000;
}

function getAllDecisionDirs(options, deps) {
  const opts = options || {};
  const d = deps || {};
  const rootDir = path.resolve(opts.rootDir || (d && d.rootDir) || process.cwd());
  const dirs = new Set();

  const primaryDir = opts.decisionDir || (d && d.decisionDir) || decisions.DEFAULT_DIR;
  dirs.add(path.resolve(primaryDir));

  if (Array.isArray(opts.decisionDirs)) {
    for (const dir of opts.decisionDirs) if (dir) dirs.add(path.resolve(dir));
  }
  if (Array.isArray(d.decisionDirs)) {
    for (const dir of d.decisionDirs) if (dir) dirs.add(path.resolve(dir));
  }

  // Scan intake per-run decision dirs
  const intakeBase =
    opts.intakeDir ||
    (d && d.intakeDir) ||
    path.join(rootDir, 'tools', 'ai-brain', 'data', 'intake');
  try {
    if (fs.existsSync(intakeBase)) {
      const entries = fs.readdirSync(intakeBase);
      for (const entry of entries) {
        const runDecDir = path.join(intakeBase, entry, 'decisions');
        try {
          if (fs.existsSync(runDecDir)) {
            dirs.add(path.resolve(runDecDir));
          }
        } catch (_) {}
      }
    }
  } catch (_) {}

  return Array.from(dirs);
}

function collectAllDecisionRecords(options, deps) {
  const opts = options || {};
  const d = deps || {};
  if (Array.isArray(opts.records)) return { records: opts.records, readable: true, damaged: [] };
  if (Array.isArray(d.records)) return { records: d.records, readable: true, damaged: [] };

  const allDirs = getAllDecisionDirs(opts, deps);
  const now = typeof d.now === 'function' ? d.now() : d.now || opts.now || Date.now();
  const days = opts.days || 7;

  const allRecords = [];
  const damaged = [];
  let readable = true;

  for (const dir of allDirs) {
    const detail = decisions.readDecisionsDetailed({ dir, days, now });
    if (!detail.readable) {
      readable = false;
    }
    if (detail.damaged && detail.damaged.length > 0) {
      damaged.push(...detail.damaged);
    }
    if (Array.isArray(detail.records)) {
      allRecords.push(...detail.records);
    }
  }

  allRecords.sort((a, b) => new Date(a.at || 0).getTime() - new Date(b.at || 0).getTime());
  return { records: allRecords, readable, damaged };
}

function parsePid(val) {
  if (typeof val === 'number' && Number.isInteger(val) && val > 0) return val;
  if (typeof val === 'string' && /^\d+$/.test(val.trim())) {
    const num = parseInt(val.trim(), 10);
    if (!Number.isNaN(num) && num > 0) return num;
  }
  return null;
}

let goalsApi = null;
function getPidAliveHelper(deps) {
  if (deps && typeof deps.isPidAlive === 'function') {
    return deps.isPidAlive;
  }
  if (deps && typeof deps.checkAlive === 'function') {
    return deps.checkAlive;
  }
  if (!goalsApi) {
    try {
      goalsApi = require('./goals');
    } catch (_) {}
  }
  if (goalsApi && typeof goalsApi.isPidAlive === 'function') {
    return goalsApi.isPidAlive;
  }
  return function defaultIsPidAlive(pid) {
    if (!pid || typeof pid !== 'number') return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (err) {
      return err && err.code === 'EPERM';
    }
  };
}

function resolveRunPid(runDir, workItemId, rootDir, opts, d, fsApi = fs) {
  // 1. Check run.lock inside runDir
  const runLockFile = path.join(runDir, 'run.lock');
  if (fsApi.existsSync(runLockFile)) {
    try {
      const content = fsApi.readFileSync(runLockFile, 'utf8').trim();
      try {
        const parsed = JSON.parse(content);
        const pid = parsePid(parsed && (parsed.pid != null ? parsed.pid : parsed));
        if (pid != null) return pid;
      } catch (_) {
        const pid = parsePid(content);
        if (pid != null) return pid;
      }
    } catch (_) {}
  }

  // 2. Check checkpoint.json inside runDir
  const checkpointFile = path.join(runDir, 'checkpoint.json');
  if (fsApi.existsSync(checkpointFile)) {
    try {
      const ckpt = JSON.parse(fsApi.readFileSync(checkpointFile, 'utf8'));
      const pid = parsePid(ckpt && ckpt.pid);
      if (pid != null) return pid;
    } catch (_) {}
  }

  // 3. Goal run lock in data/goals/<goalId>/run.lock
  const goalsDir =
    (opts && (opts.goalsDir || opts['goals-dir'])) ||
    (d && (d.goalsDir || d['goals-dir'])) ||
    path.join(rootDir, 'data', 'goals');

  if (workItemId && typeof workItemId === 'string' && workItemId.startsWith('GOAL-')) {
    const afterPrefix = workItemId.slice(5);
    const lastDash = afterPrefix.lastIndexOf('-');
    const goalId = lastDash > 0 ? afterPrefix.slice(0, lastDash) : afterPrefix;
    if (goalId) {
      const candidates = [
        path.join(goalsDir, goalId, 'run.lock'),
        path.join(goalsDir, goalId.toLowerCase(), 'run.lock'),
        path.join(goalsDir, goalId.toUpperCase(), 'run.lock'),
      ];
      for (const cand of candidates) {
        if (fsApi.existsSync(cand)) {
          try {
            const data = JSON.parse(fsApi.readFileSync(cand, 'utf8'));
            const pid = parsePid(data && (data.pid != null ? data.pid : data));
            if (pid != null) return pid;
          } catch (_) {}
        }
      }
    }
  }

  // 4. Scan goalsDir if workItemId is found in any goal.json
  try {
    if (fsApi.existsSync(goalsDir)) {
      const gEntries = fsApi.readdirSync(goalsDir);
      for (const g of gEntries) {
        const lockPath = path.join(goalsDir, g, 'run.lock');
        if (!fsApi.existsSync(lockPath)) continue;
        const gJsonPath = path.join(goalsDir, g, 'goal.json');
        if (fsApi.existsSync(gJsonPath)) {
          try {
            const gData = JSON.parse(fsApi.readFileSync(gJsonPath, 'utf8'));
            if (Array.isArray(gData.items) && gData.items.includes(workItemId)) {
              const lData = JSON.parse(fsApi.readFileSync(lockPath, 'utf8'));
              const pid = parsePid(lData && (lData.pid != null ? lData.pid : lData));
              if (pid != null) return pid;
            }
          } catch (_) {}
        }
      }
    }
  } catch (_) {}

  return null;
}

function getOpenRuns(options, deps) {
  const opts = options || {};
  const d = deps || {};
  if (Array.isArray(opts.openRuns)) return opts.openRuns;
  if (Array.isArray(d.openRuns)) return d.openRuns;
  if (typeof d.getOpenRuns === 'function') return d.getOpenRuns(options, deps);
  if (
    (Array.isArray(opts.records) || Array.isArray(d.records)) &&
    !opts.intakeDir &&
    !d.intakeDir
  ) {
    return [];
  }
  const fsApi = (d && d.fs) || (opts && opts.fs) || fs;
  const rootDir = path.resolve(opts.rootDir || (d && d.rootDir) || process.cwd());
  const intakeBase =
    opts.intakeDir ||
    (d && d.intakeDir) ||
    path.join(rootDir, 'tools', 'ai-brain', 'data', 'intake');
  const now = typeof d.now === 'function' ? d.now() : d.now || opts.now || Date.now();
  const ttlMs = opts.ttlMs || (d && d.ttlMs) || 4 * 60 * 60 * 1000;
  const checkAlive =
    (d && (d.isPidAlive || d.checkAlive)) ||
    (opts && (opts.isPidAlive || opts.checkAlive)) ||
    getPidAliveHelper(d);

  const openRuns = [];
  try {
    if (!fsApi.existsSync(intakeBase)) return openRuns;
    const entries = fsApi.readdirSync(intakeBase);
    for (const entry of entries) {
      const runDir = path.join(intakeBase, entry);
      let stat;
      try {
        stat = fsApi.statSync(runDir);
      } catch (_) {
        continue;
      }
      if (!stat.isDirectory()) continue;

      let workItemId = null;
      const specsFile = path.join(runDir, 'specs.json');
      if (fsApi.existsSync(specsFile)) {
        try {
          const specs = JSON.parse(fsApi.readFileSync(specsFile, 'utf8'));
          if (Array.isArray(specs) && specs[0] && specs[0].id) {
            workItemId = specs[0].id;
          }
        } catch (_) {}
      }
      if (!workItemId) {
        const match = entry.match(/^(.*)-\d{4}-\d{2}-\d{2}T/);
        if (match) {
          workItemId = match[1];
        } else {
          const lastDash = entry.lastIndexOf('-');
          if (lastDash > 0) {
            workItemId = entry.slice(0, lastDash);
          }
        }
      }
      if (!workItemId) continue;

      const pid = resolveRunPid(runDir, workItemId, rootDir, opts, d, fsApi);
      if (pid != null) {
        if (!checkAlive(pid)) {
          continue;
        }
      } else {
        if (now - stat.mtimeMs > ttlMs) continue;
      }

      let terminal = false;
      const runDecDir = path.join(runDir, 'decisions');
      if (fsApi.existsSync(runDecDir)) {
        try {
          const detail = decisions.readDecisionsDetailed({ dir: runDecDir, now });
          const recs = detail.records || [];
          for (const r of recs) {
            if (
              r.workItemId === workItemId &&
              (r.stage === decisions.Stage.COMPLETED ||
                r.stage === decisions.Stage.FAILED ||
                r.stage === decisions.Stage.REFUSED)
            ) {
              terminal = true;
              break;
            }
          }
        } catch (_) {}
      }

      const checkpointFile = path.join(runDir, 'checkpoint.json');
      if (!terminal && fsApi.existsSync(checkpointFile)) {
        try {
          const ckpt = JSON.parse(fsApi.readFileSync(checkpointFile, 'utf8'));
          if (
            ckpt &&
            (ckpt.completed ||
              ckpt.status === 'completed' ||
              ckpt.status === 'failed' ||
              ckpt.status === 'refused')
          ) {
            terminal = true;
          }
        } catch (_) {}
      }

      if (!terminal) {
        openRuns.push({
          workItemId,
          runDir,
          entry,
          mtimeMs: stat.mtimeMs,
          ...(pid != null ? { pid } : {}),
        });
      }
    }
  } catch (_) {}

  return openRuns;
}

function isOpenRun(workItemId, options, deps) {
  const d = deps || {};
  if (typeof d.isOpenRun === 'function') {
    return d.isOpenRun(workItemId);
  }
  const openRuns = getOpenRuns(options, deps);
  return openRuns.some((r) => r.workItemId === workItemId);
}

function getEarliestResetTime(evidenceData, now) {
  let earliest = null;
  if (!evidenceData) return null;

  if (evidenceData.cooldowns) {
    for (const cd of Object.values(evidenceData.cooldowns)) {
      if (!cd || (cd.status !== 'blocked' && cd.lastStatus !== 'blocked')) continue;
      let resetAt = null;
      if (cd.resetTime) {
        resetAt =
          typeof cd.resetTime === 'number' ? cd.resetTime : new Date(cd.resetTime).getTime();
      } else if (cd.cooldownUntil) {
        resetAt =
          typeof cd.cooldownUntil === 'number'
            ? cd.cooldownUntil
            : new Date(cd.cooldownUntil).getTime();
      } else if (cd.blockedAt && cd.cooldownMs) {
        resetAt = new Date(cd.blockedAt).getTime() + cd.cooldownMs;
      }
      if (resetAt && resetAt > now) {
        if (earliest === null || resetAt < earliest) {
          earliest = resetAt;
        }
      }
    }
  }

  if (evidenceData.upstreamStatus) {
    for (const us of Object.values(evidenceData.upstreamStatus)) {
      if (!us || us.lastStatus !== 'blocked') continue;
      let resetAt = null;
      if (us.resetTime) {
        resetAt =
          typeof us.resetTime === 'number' ? us.resetTime : new Date(us.resetTime).getTime();
      }
      if (resetAt && resetAt > now) {
        if (earliest === null || resetAt < earliest) {
          earliest = resetAt;
        }
      }
    }
  }

  return earliest;
}

function checkCandidateLanes(options, deps) {
  const d = deps || {};
  if (typeof d.checkCandidateLanes === 'function') {
    return d.checkCandidateLanes(options);
  }
  const opts = options || {};
  const evidenceData =
    d.evidenceData ||
    opts.evidenceData ||
    (opts.evidenceDir && fs.existsSync(opts.evidenceDir)
      ? evidenceApi.loadEvidence(opts.evidenceDir)
      : null);
  const candidates = d.candidates || opts.candidates;
  const now = typeof d.now === 'function' ? d.now() : d.now || opts.now || Date.now();

  if (opts.allLanesUnavailable || d.allLanesUnavailable) {
    const earliestResetTime =
      d.earliestResetTime ||
      opts.earliestResetTime ||
      getEarliestResetTime(evidenceData, now) ||
      now + 60000;
    return {
      available: false,
      reason: 'ALL_LANES_UNAVAILABLE',
      earliestResetTime,
    };
  }

  if (Array.isArray(candidates) && candidates.length > 0 && evidenceData) {
    const blockedList = [];
    const unblockedList = [];
    for (const c of candidates) {
      const blocked = evidenceApi.isCandidateBlocked(evidenceData, c, { now });
      if (blocked.blocked) {
        blockedList.push({ candidate: c, status: blocked });
      } else {
        unblockedList.push(c);
      }
    }
    if (unblockedList.length === 0 && blockedList.length > 0) {
      const earliestResetTime =
        getEarliestResetTime(evidenceData, now) ||
        d.earliestResetTime ||
        opts.earliestResetTime ||
        now + 60000;
      return {
        available: false,
        reason: 'ALL_LANES_UNAVAILABLE',
        earliestResetTime,
        blockedList,
      };
    }
  }

  return { available: true };
}

function checkCeiling(options, deps) {
  const d = deps || {};
  const opts = options || {};
  const ceiling = d.ceiling || opts.ceiling || CONCURRENCY_CEILING;

  const requestedMaxWriters =
    ceiling.maxWriters !== undefined
      ? ceiling.maxWriters
      : ceiling.maxImplementationAgents !== undefined
        ? ceiling.maxImplementationAgents
        : DEFAULTS.maxImplementationAgents;

  const maxReviewers =
    ceiling.maxReviewers !== undefined
      ? ceiling.maxReviewers
      : ceiling.maxReviewAgents !== undefined
        ? ceiling.maxReviewAgents
        : DEFAULTS.maxReviewAgents;

  // Governed decision clamp for implementation/writer ceiling
  const decisionCandidate =
    opts.governedDecision ||
    (d && d.governedDecision) ||
    (ceiling && ceiling.governedDecision) ||
    null;
  const decisionValid = isGovernedDecision(decisionCandidate);
  let maxWriters = DEFAULTS.maxImplementationAgents;
  if (Number.isFinite(requestedMaxWriters)) {
    if (requestedMaxWriters <= 1) {
      maxWriters = Math.max(0, requestedMaxWriters);
    } else if (decisionValid) {
      maxWriters = requestedMaxWriters;
    } else {
      maxWriters = DEFAULTS.maxImplementationAgents;
    }
  }

  const now = typeof d.now === 'function' ? d.now() : d.now || opts.now || Date.now();
  const decisionRecords = collectAllDecisionRecords(opts, d);
  const log = d.log || console.log;

  const writersDetailed =
    typeof d.openWritersDetailed === 'function'
      ? d.openWritersDetailed({
          records: decisionRecords.records,
          readable: decisionRecords.readable,
          now,
        })
      : decisions.openWritersDetailed({
          records: decisionRecords.records,
          readable: decisionRecords.readable,
          now,
        });

  const reviewersDetailed =
    typeof d.openReviewersDetailed === 'function'
      ? d.openReviewersDetailed({
          records: decisionRecords.records,
          readable: decisionRecords.readable,
          now,
        })
      : decisions.openReviewersDetailed({
          records: decisionRecords.records,
          readable: decisionRecords.readable,
          now,
        });

  for (const stale of (writersDetailed && writersDetailed.stale) || []) {
    log(`Ignoring stale writer ${stale.workItemId} (last activity ${stale.since}).`);
  }
  for (const stale of (reviewersDetailed && reviewersDetailed.stale) || []) {
    log(
      `Ignoring stale reviewer ${stale.workItemId} (${stale.sessionId || stale.reviewer || stale.role || 'unknown'}; last activity ${stale.lastActivity}).`
    );
  }

  const writersCount =
    (writersDetailed && writersDetailed.writers && writersDetailed.writers.length) || 0;
  const reviewersCount =
    (reviewersDetailed && reviewersDetailed.reviewers && reviewersDetailed.reviewers.length) || 0;

  // Also include active open runs from intake that are not already in writersDetailed
  const openRuns = getOpenRuns(opts, d);
  const openWriterIds = new Set(
    ((writersDetailed && writersDetailed.writers) || []).map((w) => w.workItemId)
  );
  let unrecordedRuns = 0;
  for (const r of openRuns) {
    if (!openWriterIds.has(r.workItemId)) {
      openWriterIds.add(r.workItemId);
      unrecordedRuns++;
    }
  }
  const effectiveWritersCount = writersCount + unrecordedRuns;

  if (effectiveWritersCount >= maxWriters) {
    return {
      allowed: false,
      reason: 'WRITER_CEILING_REACHED',
      detail: `active writers (${effectiveWritersCount}) reached ceiling (${maxWriters})`,
      activeWriters: effectiveWritersCount,
      maxWriters,
      activeReviewers: reviewersCount,
      maxReviewers,
    };
  }

  if (reviewersCount >= maxReviewers) {
    return {
      allowed: false,
      reason: 'REVIEWER_CEILING_REACHED',
      detail: `active reviewers (${reviewersCount}) reached ceiling (${maxReviewers})`,
      writersCount,
      reviewersCount,
      maxWriters,
      maxReviewers,
    };
  }

  return {
    allowed: true,
    writersCount,
    reviewersCount,
    maxWriters,
    maxReviewers,
  };
}

function readRegisterItems(opts, d, rootDir, force) {
  let items = [];
  if (!force && Array.isArray(d.items)) {
    items = d.items;
  } else if (typeof d.readRegister === 'function') {
    items = d.readRegister();
  } else {
    const csvPath = opts.registerPath
      ? path.resolve(rootDir, opts.registerPath)
      : path.join(
          rootDir,
          'docs',
          'product-spec',
          'docs',
          '10-ai-collaboration',
          'FEATURE-DELIVERY-REGISTER.csv'
        );
    try {
      const content = fs.readFileSync(csvPath, 'utf8');
      const adapter = require('../ai-dashboard/register-adapter');
      items = adapter.parseRegisterCsv(content, rootDir) || [];
    } catch {
      const adapter = require('../ai-dashboard/register-adapter');
      const reg = adapter.loadRegister(csvPath, null, rootDir);
      items = (reg && reg.data && reg.data.items) || [];
    }
  }
  return items;
}

function findNextWorkItem(options, deps) {
  const opts = options || {};
  const d = deps || {};
  const rootDir = path.resolve(opts.rootDir || process.cwd());
  const now = typeof d.now === 'function' ? d.now() : d.now || opts.now || Date.now();
  const decisionRecords = collectAllDecisionRecords(opts, d);
  const terminalWorkItems = opts.terminalWorkItems || d.terminalWorkItems || new Map();

  // Sync merged PRs from GitHub into the register only when the caller asks
  // (the `next --run` command). Library callers and tests never touch GitHub
  // or rewrite the repository register as a side effect.
  if (opts.syncRegister === true || d.syncRegister === true) {
    try {
      const { syncMergedPullRequestsToRegister } = require('./reconcile');
      syncMergedPullRequestsToRegister(opts, d);
    } catch (_) {}
  }

  const items = readRegisterItems(opts, d, rootDir, opts.forceRegisterRead === true);

  const byId = new Map();
  for (const it of items) {
    if (it && it.work_item_id) {
      byId.set(it.work_item_id, it);
    }
  }

  const skipped = [];
  let selected = null;
  let planCandidate = null;
  const priority = (item) =>
    /^FEAT-/.test(String(item.work_item_id || ''))
      ? 0
      : /^TASK-AI-/.test(String(item.work_item_id || ''))
        ? 2
        : 1;
  const orderedItems = items.slice().sort((a, b) => priority(a) - priority(b));

  const requestedId = opts.workItem || opts['work-item'];
  for (const item of orderedItems) {
    const id = item.work_item_id;
    if (!id) continue;
    if (requestedId && id !== requestedId) continue;
    const status = String(item.status || '').trim();

    // Already merged items are completed
    if (status === 'MERGED') {
      continue;
    }

    // Check if item already reached a terminal outcome in this session
    if (terminalWorkItems.has(id)) {
      skipped.push({
        id,
        reason: `terminal state reached in this session (${terminalWorkItems.get(id)})`,
      });
      continue;
    }

    // 1. Items marked BLOCKED are never picked (NX-R04)
    if (status.startsWith('BLOCKED')) {
      skipped.push({
        id,
        reason: `BLOCKED with reason: ${status}`,
      });
      continue;
    }

    // 2. Dependencies check: every dependency must be MERGED
    const depList = parseDependencies(item.dependencies);
    const unmergedDeps = [];
    for (const depId of depList) {
      const depItem = byId.get(depId);
      if (!depItem || String(depItem.status || '').trim() !== 'MERGED') {
        unmergedDeps.push(depId);
      }
    }
    if (unmergedDeps.length > 0) {
      skipped.push({
        id,
        reason: `dependency not merged (${unmergedDeps.join(', ')})`,
      });
      continue;
    }

    // 3. Open run or writer claim check
    const writerFn = d.writerFor || decisions.writerFor;
    const activeWriter = writerFn(id, {
      records: decisionRecords.records,
      readable: decisionRecords.readable,
      now,
    });
    const isOpen = isOpenRun(id, opts, d);
    if (activeWriter || isOpen) {
      const claimDetail = activeWriter
        ? `claimed by session ${activeWriter.sessionId || 'active'}`
        : 'claimed by open run';
      skipped.push({
        id,
        reason: claimDetail,
      });
      continue;
    }

    // 4. Status check: READY_FOR_AUTHOR or BACKLOG (with all dependencies MERGED)
    const isReadyForAuthor = status === 'READY_FOR_AUTHOR';
    const isBacklog = status === 'BACKLOG';
    if (isReadyForAuthor) {
      if (!selected) selected = item;
      if (opts.loop || opts.planAhead === true) continue;
      break;
    }
    if (isBacklog) {
      if (!opts.loop && opts.planAhead !== true) {
        selected = item;
        break;
      }
      const workItemPath = path.join(rootDir, 'docs', 'product-spec', 'work-items', id + '.md');
      if (fs.existsSync(workItemPath)) {
        if (!planCandidate) planCandidate = item;
        break;
      }
      if (!planCandidate) planCandidate = item;
      continue;
    }

    skipped.push({
      id,
      reason: `status ${status} is not ready for author`,
    });
  }

  return { item: selected || planCandidate, planCandidate, skipped };
}

async function awaitIntakeExecution(intakeResult) {
  let childExitCode = 0;
  if (intakeResult && intakeResult.child && typeof intakeResult.child.on === 'function') {
    childExitCode = await new Promise((resolve) => {
      let settled = false;
      const done = (code) => {
        if (!settled) {
          settled = true;
          resolve(typeof code === 'number' ? code : 1);
        }
      };
      intakeResult.child.on('close', (code) => done(code));
      if (!intakeResult.child.stderr) intakeResult.child.on('exit', (code) => done(code));
      intakeResult.child.on('error', (err) => {
        intakeResult.reason = decisions.scrubText(String(err.message || err));
        done(1);
      });
    });
  } else if (intakeResult && typeof intakeResult.exitCode === 'number') {
    childExitCode = intakeResult.exitCode;
  }

  let terminalOutcome;
  if (childExitCode !== 0) {
    terminalOutcome = 'failed';
  } else if (
    intakeResult &&
    intakeResult.status &&
    intakeResult.status !== 'launched' &&
    intakeResult.status !== 'prepared'
  ) {
    terminalOutcome = intakeResult.status;
  } else {
    terminalOutcome = 'completed';
  }

  return { exitCode: childExitCode, outcome: terminalOutcome };
}

async function executeIntakeForItem(item, options, deps, logOpts) {
  const opts = options || {};
  const d = deps || {};
  const runIntakeFn = d.runIntake || intakeApi.runIntake;
  const intakeDeps = d.intakeDeps || {};

  try {
    const intakeResult = await runIntakeFn(
      {
        workItem: item.work_item_id,
        run: true,
        publish: opts.publish,
        externalWorkers:
          opts.externalWorkers ||
          opts['external-workers'] ||
          (d.config || opts.config || loadConfig(opts.rootDir)).externalWorkers,
        // Intake owns the brain decision stream for this run.
        // Runner status decisions continue to use logOpts above.
      },
      intakeDeps
    );

    const { exitCode, outcome } = await awaitIntakeExecution(intakeResult);
    const stderrTail = intakeResult.stderrTail
      ? decisions.scrubText(String(intakeResult.stderrTail)).slice(-16000)
      : null;
    let reason =
      intakeResult && (intakeResult.reason || intakeResult.message || intakeResult.error);

    let checkpointData = null;
    if (intakeResult && intakeResult.checkpoint && typeof intakeResult.checkpoint === 'object') {
      checkpointData = intakeResult.checkpoint;
    } else {
      const checkpointFile =
        intakeResult && intakeResult.runFiles && intakeResult.runFiles.checkpoint;
      if (checkpointFile) {
        try {
          if (typeof checkpointFile === 'object') {
            checkpointData = checkpointFile;
          } else if (fs.existsSync(checkpointFile)) {
            checkpointData = JSON.parse(fs.readFileSync(checkpointFile, 'utf8'));
          }
        } catch (_) {}
      }
    }

    if (outcome !== 'completed' && outcome !== 'published') {
      if (!reason && checkpointData) {
        const step = checkpointData.liveSteps && checkpointData.liveSteps[item.work_item_id];
        const failures = (step && step.failures) || [];
        const failure = failures[failures.length - 1];
        reason = (step && step.reason) || (failure && (failure.reason || failure.cause));
        if (!reason) {
          const itemOutcome = (checkpointData.outcomes || []).find(
            (entry) => entry.workItemId === item.work_item_id
          );
          reason = itemOutcome && itemOutcome.reason;
        }
      }
      reason = reason || intakeResult.stderrTail;
      reason = decisions
        .scrubText(
          require('./route-probe').failureReason(
            reason || `INTAKE_${String(outcome).toUpperCase()}: child exit code ${exitCode}`
          )
        )
        .slice(0, 500);
    }

    let isBlockedNoRoute = false;
    let triedRoutes = [];
    if (checkpointData) {
      const itemOutcome = (checkpointData.outcomes || []).find(
        (entry) => entry.workItemId === item.work_item_id
      );
      if (
        checkpointData.status === 'BLOCKED_NO_ROUTE' ||
        (itemOutcome &&
          (itemOutcome.status === 'BLOCKED_NO_ROUTE' ||
            itemOutcome.reasonCode === 'BLOCKED_NO_ROUTE'))
      ) {
        isBlockedNoRoute = true;
        if (itemOutcome && Array.isArray(itemOutcome.triedRoutes)) {
          triedRoutes = itemOutcome.triedRoutes;
        } else if (checkpointData.triedRoutes && Array.isArray(checkpointData.triedRoutes)) {
          triedRoutes = checkpointData.triedRoutes;
        }
      }
    }

    if (!isBlockedNoRoute) {
      if (
        intakeResult &&
        (intakeResult.status === 'BLOCKED_NO_ROUTE' ||
          intakeResult.reasonCode === 'BLOCKED_NO_ROUTE' ||
          intakeResult.isBlockedNoRoute)
      ) {
        isBlockedNoRoute = true;
        if (Array.isArray(intakeResult.triedRoutes)) {
          triedRoutes = intakeResult.triedRoutes;
        }
      } else if (
        /BLOCKED_NO_ROUTE/.test(String(reason || '')) ||
        /NO_ELIGIBLE_CANDIDATE/.test(String(reason || ''))
      ) {
        isBlockedNoRoute = true;
      }
    }

    const finalOutcome = isBlockedNoRoute ? 'blocked_no_route' : outcome;

    const stage = isBlockedNoRoute
      ? decisions.Stage.COOLED
      : finalOutcome === 'completed' || finalOutcome === 'published'
        ? decisions.Stage.COMPLETED
        : finalOutcome === 'refused'
          ? decisions.Stage.REFUSED
          : decisions.Stage.FAILED;

    decisions.recordDecision(
      {
        stage,
        workItemId: item.work_item_id,
        outcome: finalOutcome,
        exitCode,
        detail: isBlockedNoRoute ? reason || 'BLOCKED_NO_ROUTE' : reason || undefined,
        stderrTail: stderrTail || undefined,
        triedRoutes: triedRoutes.length > 0 ? triedRoutes : undefined,
      },
      logOpts
    );

    return {
      success: exitCode === 0 && (finalOutcome === 'completed' || finalOutcome === 'published'),
      outcome: finalOutcome,
      exitCode,
      intakeResult,
      reason: reason || (isBlockedNoRoute ? 'BLOCKED_NO_ROUTE' : null),
      stderrTail,
      isBlockedNoRoute,
      triedRoutes,
    };
  } catch (err) {
    const isNoRoute =
      err &&
      (err.code === 'BLOCKED_NO_ROUTE' ||
        err.code === 'NO_ELIGIBLE_CANDIDATE' ||
        /BLOCKED_NO_ROUTE|NO_ELIGIBLE_CANDIDATE/.test(String(err.message || '')));
    const isRefusal =
      !isNoRoute &&
      err &&
      (err.code === 'INTAKE_INCOMPLETE' ||
        err.code === 'PROOF_FLOOR_NOT_MET' ||
        String(err.code || '').startsWith('ISOLATION_') ||
        err.code === 'BASE_SHA_NOT_IN_LOCAL_MAIN');
    const outcome = isNoRoute ? 'blocked_no_route' : isRefusal ? 'refused' : 'failed';
    const stage = isNoRoute
      ? decisions.Stage.COOLED
      : isRefusal
        ? decisions.Stage.REFUSED
        : decisions.Stage.FAILED;
    const reason = decisions
      .scrubText(String((err && (err.message || err.code)) || 'INTAKE_EXECUTION_ERROR'))
      .slice(0, 500);

    decisions.recordDecision(
      {
        stage,
        workItemId: item.work_item_id,
        outcome,
        detail: reason,
        code: err && err.code,
        triedRoutes: (err && err.triedRoutes) || undefined,
      },
      logOpts
    );

    return {
      success: false,
      outcome,
      exitCode: 1,
      error: err,
      reason,
      isBlockedNoRoute: isNoRoute,
      triedRoutes: (err && err.triedRoutes) || [],
    };
  }
}

async function nextLoop(options, deps) {
  const opts = options || {};
  const d = deps || {};
  const rootDir = path.resolve(opts.rootDir || process.cwd());
  const log = d.log || console.log;
  const sleepFn = d.sleep || defaultSleep;
  const getNow = typeof d.now === 'function' ? d.now : () => d.now || Date.now();
  const maxIterations = opts.maxIterations !== undefined ? Number(opts.maxIterations) : Infinity;
  const pollIntervalMs = getPollingInterval(opts, d);
  const terminalWorkItems = opts.terminalWorkItems || d.terminalWorkItems || new Map();
  const noRouteWaitTracker = opts.noRouteWaitTracker || d.noRouteWaitTracker || new Map();

  const dispatchConfig =
    (sourcesApi &&
      sourcesApi.getDispatchConfig &&
      sourcesApi.getDispatchConfig(opts.registry || d.registry, opts)) ||
    {};
  const blockedNoRouteTimeoutMs =
    opts.blockedNoRouteTimeoutMs !== undefined
      ? Number(opts.blockedNoRouteTimeoutMs)
      : d.blockedNoRouteTimeoutMs !== undefined
        ? Number(d.blockedNoRouteTimeoutMs)
        : Number(dispatchConfig.blockedNoRouteTimeoutMs);
  const blockedNoRoutePollIntervalMs =
    opts.blockedNoRoutePollIntervalMs !== undefined
      ? Number(opts.blockedNoRoutePollIntervalMs)
      : d.blockedNoRoutePollIntervalMs !== undefined
        ? Number(d.blockedNoRoutePollIntervalMs)
        : Number(dispatchConfig.blockedNoRoutePollIntervalMs);

  let iteration = 0;
  while (iteration < maxIterations) {
    iteration += 1;
    const now = getNow();
    const logOpts = { dir: opts.decisionDir || d.decisionDir || decisions.DEFAULT_DIR, now };

    if (typeof d.refreshRouteHealth === 'function') {
      await d.refreshRouteHealth({ now, iteration });
    }

    // 1. Check stop file
    const stopFilePath = opts.stopFile
      ? path.resolve(rootDir, opts.stopFile)
      : path.join(rootDir, '.stop');
    const hasStopFile =
      typeof d.existsSync === 'function' ? d.existsSync(stopFilePath) : fs.existsSync(stopFilePath);
    if (hasStopFile) {
      decisions.recordDecision(
        {
          stage: decisions.Stage.REFUSED,
          detail: 'STOP_FILE_EXISTS',
          stopFile: stopFilePath,
        },
        logOpts
      );
      log(`Stop file exists: ${stopFilePath}. Stopping cleanly.`);
      return { stopped: true, reason: 'STOP_FILE_EXISTS', iteration };
    }

    // 2. Find next work item
    const findResult = findNextWorkItem({ ...opts, loop: true, now, terminalWorkItems }, d);
    for (const s of findResult.skipped) {
      log(`Skipped ${s.id}: ${s.reason}`);
    }

    if (!findResult.item) {
      const requestedId = opts.workItem || opts['work-item'];
      if (requestedId) {
        log(`NO_READY_ITEM: requested Work Item ${requestedId} is unavailable or blocked.`);
        return { stopped: true, reason: 'NO_READY_ITEM', workItemId: requestedId, iteration };
      }
      const qualificationSlot = opts.qualificationSlot || d.qualificationSlot;
      if (typeof qualificationSlot === 'function') {
        const qualification = await qualificationSlot({ now, iteration, reason: 'NO_READY_ITEM' });
        if (qualification && qualification.ran === true) {
          log('QUALIFICATION_SLOT: ' + (qualification.status || 'completed'));
          if (opts.workItem || opts['work-item']) {
            return {
              stopped: true,
              reason: 'WORK_ITEM_NOT_EXECUTED',
              workItemId: requestedId,
              iteration,
              qualification,
            };
          }
          if (iteration < maxIterations) {
            await sleepFn(pollIntervalMs);
            continue;
          }
          return { completed: true, iterations: iteration, qualification };
        }
      }
      decisions.recordDecision(
        {
          stage: decisions.Stage.REFUSED,
          detail: 'NO_READY_ITEM',
        },
        logOpts
      );
      log('NO_READY_ITEM: no ready work item found. Stopping cleanly.');
      return { stopped: true, reason: 'NO_READY_ITEM', iteration, skipped: findResult.skipped };
    }

    // Planning stays a separate lane. Schedule one item ahead while a ready
    // author item runs, independently of the implementation ceiling.
    // With no author-ready item, findNextWorkItem exposes the backlog planner
    // candidate as `item`; the sequential planning path below owns that run.
    // Parallel planning is only for a distinct item while an author runs.
    const planningItem =
      findResult.item && findResult.item.status === 'READY_FOR_AUTHOR'
        ? findResult.planCandidate
        : null;
    let parallelPlanning = null;
    if (planningItem) {
      const planning = require('./work-item-planner');
      const planningPromise = planning.planWorkItem(
        planningItem.work_item_id,
        { rootDir, run: true },
        planningDepsFor(d, opts, rootDir)
      );
      const authorItem = findResult.item;
      if (authorItem && authorItem !== planningItem) {
        // Keep the author lane moving without awaiting planner completion.
        parallelPlanning = planningPromise;
      } else {
        try {
          const result = await planningPromise;
          if (!result || result.status !== 'READY_FOR_AUTHOR') {
            terminalWorkItems.set(planningItem.work_item_id, 'planning-blocked');
          }
          if (iteration < maxIterations) {
            await sleepFn(pollIntervalMs);
            continue;
          }
          return { completed: true, iterations: iteration, planning: result };
        } catch (err) {
          terminalWorkItems.set(planningItem.work_item_id, 'planning-failed');
          log(`Planning ${planningItem.work_item_id} failed: ${err.message}`);
          return {
            stopped: true,
            reason: 'PLANNING_FAILED',
            workItemId: planningItem.work_item_id,
          };
        }
      }
    }

    const item = findResult.item;
    log(`Next Work Item: ${item.work_item_id} (status: ${item.status})`);

    // TASK-AI-141 G: when the selected dependency-ready backlog item has no
    // Work Item document, plan it before attempting author intake. Planning is
    // a separate lane and is not counted against the implementation ceiling.
    const workItemPath = path.join(
      rootDir,
      'docs',
      'product-spec',
      'work-items',
      item.work_item_id + '.md'
    );
    if (String(item.status).trim() === 'BACKLOG') {
      try {
        const planning = require('./work-item-planner');
        const planned = await planning.planWorkItem(
          item.work_item_id,
          { rootDir, run: true, reviewExisting: fs.existsSync(workItemPath) },
          planningDepsFor(d, opts, rootDir)
        );
        const governed =
          planned &&
          planned.status === 'READY_FOR_AUTHOR' &&
          planned.governed === true &&
          planned.independentReview === 'PASS' &&
          planned.merged === true;
        const outcome = governed ? 'planned' : 'blocked';
        if (outcome !== 'planned') terminalWorkItems.set(item.work_item_id, outcome);
        decisions.recordDecision(
          {
            stage: outcome === 'planned' ? decisions.Stage.COMPLETED : decisions.Stage.REFUSED,
            workItemId: item.work_item_id,
            detail: outcome === 'planned' ? 'WORK_ITEM_PLANNED' : 'PLANNING_BLOCKED',
            status: governed ? 'READY_FOR_AUTHOR' : 'BLOCKED',
            reason: governed
              ? undefined
              : (planned && planned.reason) ||
                'Planning did not return governed merge and exact independent PASS evidence.',
          },
          logOpts
        );
        log(`Planning ${item.work_item_id} ended with ${outcome}.`);
        if (!governed) {
          if (iteration < maxIterations) await sleepFn(pollIntervalMs);
          continue;
        }
        // A governed merge must update the durable register. Re-read it before
        // authoring so the normal dependency and status gates remain authoritative.
        const refreshed = findNextWorkItem(
          { ...opts, loop: true, now, terminalWorkItems, forceRegisterRead: true },
          d
        );
        const refreshedItem = refreshed.item;
        if (
          !refreshedItem ||
          refreshedItem.work_item_id !== item.work_item_id ||
          String(refreshedItem.status || '').trim() !== 'READY_FOR_AUTHOR'
        ) {
          terminalWorkItems.set(item.work_item_id, 'planning-register-not-ready');
          decisions.recordDecision(
            {
              stage: decisions.Stage.REFUSED,
              workItemId: item.work_item_id,
              detail: 'PLANNING_REGISTER_NOT_READY',
            },
            logOpts
          );
          return {
            stopped: true,
            reason: 'PLANNING_REGISTER_NOT_READY',
            workItemId: item.work_item_id,
          };
        }
        // Keep the re-read row local; the register snapshot remains immutable.
        findResult.item = refreshedItem;
      } catch (err) {
        terminalWorkItems.set(item.work_item_id, 'planning-failed');
        decisions.recordDecision(
          {
            stage: decisions.Stage.FAILED,
            workItemId: item.work_item_id,
            detail: err && err.code ? err.code : 'PLANNING_FAILED',
            reason: err && err.message,
          },
          logOpts
        );
        log(`Planning ${item.work_item_id} failed: ${err && err.message ? err.message : err}`);
        return { stopped: true, reason: 'PLANNING_FAILED', workItemId: item.work_item_id };
      }
    }

    // Helper to join parallel planning on any loop exit path
    async function joinParallelPlanning() {
      if (!parallelPlanning) return null;
      try {
        const result = await parallelPlanning;
        parallelPlanning = null;
        if (!result || result.status !== 'READY_FOR_AUTHOR') {
          terminalWorkItems.set(planningItem.work_item_id, 'planning-blocked');
          decisions.recordDecision(
            {
              stage: decisions.Stage.REFUSED,
              workItemId: planningItem.work_item_id,
              detail: 'PLANNING_BLOCKED',
              status: 'BLOCKED',
              reason: (result && result.reason) || 'Planning did not return READY_FOR_AUTHOR.',
            },
            logOpts
          );
        } else {
          const plannedRow = readRegisterItems(opts, d, rootDir, true).find(
            (row) => row.work_item_id === planningItem.work_item_id
          );
          if (!plannedRow || String(plannedRow.status || '').trim() !== 'READY_FOR_AUTHOR') {
            terminalWorkItems.set(planningItem.work_item_id, 'planning-register-not-ready');
            decisions.recordDecision(
              {
                stage: decisions.Stage.REFUSED,
                workItemId: planningItem.work_item_id,
                detail: 'PLANNING_REGISTER_NOT_READY',
              },
              logOpts
            );
            return {
              stopped: true,
              reason: 'PLANNING_REGISTER_NOT_READY',
              workItemId: planningItem.work_item_id,
            };
          }
        }
        log(`Planning ${planningItem.work_item_id} completed in parallel.`);
        return { ok: true, result };
      } catch (err) {
        parallelPlanning = null;
        terminalWorkItems.set(planningItem.work_item_id, 'planning-failed');
        decisions.recordDecision(
          {
            stage: decisions.Stage.FAILED,
            workItemId: planningItem.work_item_id,
            detail: err && err.code ? err.code : 'PLANNING_FAILED',
            reason: err && err.message,
          },
          logOpts
        );
        log(`Planning ${planningItem.work_item_id} failed: ${err.message}`);
        return {
          stopped: true,
          reason: 'PLANNING_FAILED',
          workItemId: planningItem.work_item_id,
        };
      }
    }

    try {
      // 3. Check candidate lanes
      const laneStatus = checkCandidateLanes({ ...opts, now }, d);
      if (!laneStatus.available) {
        decisions.recordDecision(
          {
            stage: decisions.Stage.COOLED,
            detail: 'ALL_LANES_UNAVAILABLE',
            earliestResetTime: laneStatus.earliestResetTime,
            workItemId: item.work_item_id,
          },
          logOpts
        );
        log(
          `ALL_LANES_UNAVAILABLE: waiting until earliest reset time ${laneStatus.earliestResetTime}`
        );
        const waitMs =
          laneStatus.earliestResetTime && laneStatus.earliestResetTime > now
            ? laneStatus.earliestResetTime - now
            : pollIntervalMs;
        await sleepFn(waitMs);
        return {
          stopped: true,
          reason: 'ALL_LANES_UNAVAILABLE',
          earliestResetTime: laneStatus.earliestResetTime,
          waitMs,
          iteration,
        };
      }

      // 4. Check ceiling
      const ceilingStatus = checkCeiling(opts, d);
      if (!ceilingStatus.allowed) {
        decisions.recordDecision(
          {
            stage: decisions.Stage.REFUSED,
            detail: ceilingStatus.reason,
            workItemId: item.work_item_id,
          },
          logOpts
        );
        log(`Ceiling reached: ${ceilingStatus.detail}. Waiting.`);
        await sleepFn(pollIntervalMs);
        if (maxIterations <= 1) {
          return {
            stopped: true,
            reason: ceilingStatus.reason,
            detail: ceilingStatus.detail,
            iteration,
          };
        }
        if (opts.workItem || opts['work-item']) {
          return {
            stopped: true,
            reason: ceilingStatus.reason,
            detail: ceilingStatus.detail,
            iteration,
          };
        }
        continue;
      }

      // 5. Run item through intake --run
      decisions.recordDecision(
        {
          stage: decisions.Stage.SELECTED,
          workItemId: item.work_item_id,
        },
        logOpts
      );

      const execResult = await executeIntakeForItem(item, opts, d, {
        dir: opts.decisionDir || d.decisionDir || decisions.DEFAULT_DIR,
        now: getNow(),
      });

      const proofFloorRefusal = Boolean(
        (execResult.error &&
          (execResult.error.code === 'PROOF_FLOOR_NOT_MET' ||
            /PROOF_FLOOR_NOT_MET/.test(String(execResult.error.message || '')))) ||
        (execResult.intakeResult &&
          (execResult.intakeResult.reason === 'PROOF_FLOOR_NOT_MET' ||
            /PROOF_FLOOR_NOT_MET/.test(JSON.stringify(execResult.intakeResult))))
      );
      if (proofFloorRefusal) {
        const qualificationSlot = opts.qualificationSlot || d.qualificationSlot;
        if (typeof qualificationSlot === 'function') {
          const qualificationCeiling =
            typeof d.checkCeiling === 'function'
              ? d.checkCeiling({ ...opts, now }, d)
              : checkCeiling({ ...opts, now }, d);
          if (!qualificationCeiling.allowed) {
            log(`Qualification slot skipped: ${qualificationCeiling.reason}.`);
            if (opts.workItem || opts['work-item']) {
              return {
                stopped: true,
                reason: qualificationCeiling.reason,
                workItemId: item.work_item_id,
                iteration,
              };
            }
            continue;
          }
          const qualification = await qualificationSlot({
            now,
            iteration,
            workItem: item,
            reason: 'PROOF_FLOOR_NOT_MET',
            ceiling: qualificationCeiling,
          });
          if (qualification && qualification.ran === true) {
            log('QUALIFICATION_SLOT: ' + (qualification.status || 'completed'));
            if (opts.workItem || opts['work-item']) {
              if (iteration < maxIterations) {
                await sleepFn(pollIntervalMs);
                continue;
              }
              return {
                stopped: true,
                reason: 'WORK_ITEM_NOT_EXECUTED',
                workItemId: item.work_item_id,
                iteration,
                qualification,
              };
            }
            if (iteration < maxIterations) {
              await sleepFn(pollIntervalMs);
              continue;
            }
            return { completed: true, iterations: iteration, qualification };
          }
        }
      }

      if (execResult.isBlockedNoRoute) {
        const itemId = item.work_item_id;
        const currentNow = getNow();
        if (!noRouteWaitTracker.has(itemId)) {
          noRouteWaitTracker.set(itemId, currentNow);
        }
        const firstBlockedAt = noRouteWaitTracker.get(itemId);
        const elapsed = currentNow - firstBlockedAt;

        const triedSummary =
          Array.isArray(execResult.triedRoutes) && execResult.triedRoutes.length > 0
            ? execResult.triedRoutes
                .map(
                  (r) =>
                    `${r.candidateKey || r.route || r.offeringId || r.key}: ${r.reason || r.reasonCode || r.cause || 'failed'}`
                )
                .join('; ')
            : execResult.reason || 'no eligible route available';

        if (elapsed >= blockedNoRouteTimeoutMs) {
          log(
            `BLOCKED_NO_ROUTE_TIMEOUT: Work Item ${itemId} exceeded waiting timeout of ${blockedNoRouteTimeoutMs}ms (waited ${elapsed}ms). Stopping loop.`
          );
          decisions.recordDecision(
            {
              stage: decisions.Stage.FAILED,
              workItemId: itemId,
              detail: 'BLOCKED_NO_ROUTE_TIMEOUT',
              elapsedMs: elapsed,
              timeoutMs: blockedNoRouteTimeoutMs,
              triedRoutes: execResult.triedRoutes,
            },
            logOpts
          );
          terminalWorkItems.set(itemId, 'blocked_no_route_timeout');
          return {
            stopped: true,
            reason: 'BLOCKED_NO_ROUTE_TIMEOUT',
            workItemId: itemId,
            elapsedMs: elapsed,
            timeoutMs: blockedNoRouteTimeoutMs,
            iteration,
            triedRoutes: execResult.triedRoutes,
          };
        }

        log(
          `BLOCKED_NO_ROUTE: Work Item ${itemId} has no available routes (${triedSummary}). Waited ${elapsed}ms / ${blockedNoRouteTimeoutMs}ms. Waiting ${blockedNoRoutePollIntervalMs}ms before retry...`
        );

        try {
          const quotaScan = d.quotaScan || require('./quota-scan');
          if (quotaScan && typeof quotaScan.scanAllQuotas === 'function') {
            await quotaScan.scanAllQuotas({ ifDue: true, cwd: rootDir }).catch(() => {});
          }
        } catch (_) {}

        await sleepFn(blockedNoRoutePollIntervalMs);
        if (opts.workItem || opts['work-item']) {
          if (iteration < maxIterations) {
            continue;
          }
          return {
            stopped: true,
            reason: 'BLOCKED_NO_ROUTE',
            workItemId: itemId,
            elapsedMs: elapsed,
            iteration,
            triedRoutes: execResult.triedRoutes,
          };
        }
        continue;
      }

      noRouteWaitTracker.delete(item.work_item_id);

      const outcome = execResult.outcome || 'completed';
      terminalWorkItems.set(item.work_item_id, outcome);
      const refusal = execResult.error || execResult.intakeResult || {};
      const refusalReasons = Array.isArray(refusal.reasons)
        ? refusal.reasons
        : Array.isArray(refusal.rejected)
          ? refusal.rejected
          : [];
      const reasonCounts = new Map();
      for (const rejected of refusalReasons) {
        const reason = String(
          (rejected && (rejected.reasonCode || rejected.reason || rejected.code)) || rejected
        );
        reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
      }
      const reasonSummary = reasonCounts.size
        ? `; refusal reasons: ${Array.from(reasonCounts, ([reason, count]) => `${reason} (${count})`).join(', ')}`
        : execResult.reason || refusal.message || refusal.error || refusal.reason || '';
      log(
        `Work Item ${item.work_item_id} ended with terminal state ${outcome}${reasonSummary ? `; ${reasonSummary}` : ''}.`
      );

      if (opts.workItem || opts['work-item']) {
        return {
          completed: true,
          iterations: iteration,
          workItemId: item.work_item_id,
          outcome,
          execution: execResult,
        };
      }
    } finally {
      if (parallelPlanning) {
        const planOutcome = await joinParallelPlanning();
        if (planOutcome && planOutcome.stopped) {
          return planOutcome;
        }
      }
    }

    if (iteration < maxIterations) {
      await sleepFn(pollIntervalMs);
    }
  }

  return { completed: true, iterations: iteration };
}

async function runNext(options, deps) {
  const opts = options || {};
  const d = deps || {};
  const rootDir = path.resolve(opts.rootDir || process.cwd());
  const log = d.log || console.log;
  const now = typeof d.now === 'function' ? d.now() : d.now || opts.now || Date.now();
  const logOpts = { dir: opts.decisionDir || d.decisionDir || decisions.DEFAULT_DIR, now };

  if (opts.loop) {
    return nextLoop(opts, d);
  }

  // 1. Check stop file
  const stopFilePath = opts.stopFile
    ? path.resolve(rootDir, opts.stopFile)
    : path.join(rootDir, '.stop');
  const hasStopFile =
    typeof d.existsSync === 'function' ? d.existsSync(stopFilePath) : fs.existsSync(stopFilePath);
  if (hasStopFile) {
    decisions.recordDecision(
      {
        stage: decisions.Stage.REFUSED,
        detail: 'STOP_FILE_EXISTS',
        stopFile: stopFilePath,
      },
      logOpts
    );
    log(`Stop file exists: ${stopFilePath}. Stopping.`);
    return { stopped: true, reason: 'STOP_FILE_EXISTS' };
  }

  // Auto-refresh stale model priors in next --run without blocking on network error
  if (opts.run) {
    try {
      const priorsApi = require('./priors');
      const currentPriors = d.priors || priorsApi.loadPriors();
      if (priorsApi.arePriorsStale(currentPriors, now)) {
        if (typeof d.refreshPriors === 'function') {
          await d.refreshPriors().catch(() => {});
        } else {
          await priorsApi.refreshPriors({ root: rootDir }).catch(() => {});
        }
      }
    } catch (_) {}
  }

  // 2. Find next work item
  const findResult = findNextWorkItem(opts, d);
  for (const s of findResult.skipped) {
    log(`Skipped ${s.id}: ${s.reason}`);
  }

  if (!findResult.item) {
    decisions.recordDecision(
      {
        stage: decisions.Stage.REFUSED,
        detail: 'NO_READY_ITEM',
      },
      logOpts
    );
    log('NO_READY_ITEM: no ready work item found');
    return { item: null, reason: 'NO_READY_ITEM', skipped: findResult.skipped };
  }

  const item = findResult.item;
  log(`Next Work Item: ${item.work_item_id} (status: ${item.status})`);

  if (!opts.run) {
    if (opts.json) {
      log(JSON.stringify({ item, skipped: findResult.skipped }, null, 2));
    }
    return { item, skipped: findResult.skipped };
  }

  // 3. If --run, check candidate lanes availability
  const laneStatus = checkCandidateLanes(opts, d);
  if (!laneStatus.available) {
    decisions.recordDecision(
      {
        stage: decisions.Stage.COOLED,
        detail: 'ALL_LANES_UNAVAILABLE',
        earliestResetTime: laneStatus.earliestResetTime,
        workItemId: item.work_item_id,
      },
      logOpts
    );
    log(`ALL_LANES_UNAVAILABLE: earliest reset time is ${laneStatus.earliestResetTime}`);
    return {
      run: false,
      reason: 'ALL_LANES_UNAVAILABLE',
      earliestResetTime: laneStatus.earliestResetTime,
    };
  }

  // 4. Check concurrency ceiling (NX-R02)
  const ceilingFn = typeof d.checkCeiling === 'function' ? d.checkCeiling : checkCeiling;
  const ceilingStatus = ceilingFn(opts, d);
  if (!ceilingStatus.allowed) {
    decisions.recordDecision(
      {
        stage: decisions.Stage.REFUSED,
        detail: ceilingStatus.reason,
        workItemId: item.work_item_id,
      },
      logOpts
    );
    log(`Ceiling reached: ${ceilingStatus.detail}`);
    return { run: false, reason: ceilingStatus.reason, detail: ceilingStatus.detail };
  }

  // 5. Call intake --run and await terminal outcome
  decisions.recordDecision(
    {
      stage: decisions.Stage.SELECTED,
      workItemId: item.work_item_id,
    },
    logOpts
  );

  const execResult = await executeIntakeForItem(item, opts, d, {
    dir: opts.decisionDir || d.decisionDir || decisions.DEFAULT_DIR,
    now: Date.now(),
  });

  return {
    item,
    intakeResult: execResult.intakeResult,
    reason: execResult.reason || (execResult.error && execResult.error.message) || null,
    ran: true,
    status: execResult.outcome,
    exitCode: execResult.exitCode,
    isBlockedNoRoute: Boolean(execResult.isBlockedNoRoute),
    triedRoutes: execResult.triedRoutes || [],
  };
}

/**
 * Planning dependencies for the governed planning lane. Injected dependencies
 * (tests, embedding callers) win; otherwise the real services are built from the
 * Controller's own machinery so an unattended loop does not stop at the first plan.
 */
function planningDepsFor(d, opts, rootDir) {
  if (d && d.planningDeps) return d.planningDeps;
  if (d && typeof d.runPlanning === 'function') return d;
  const planning = require('./work-item-planner');
  return planning.defaultPlanningDeps(
    rootDir,
    Object.assign({}, d || {}, {
      externalWorkers: (opts && (opts.externalWorkers || opts['external-workers'])) || undefined,
      decisionDir: (opts && opts.decisionDir) || undefined,
    })
  );
}

function nextCommand(args, deps) {
  const rootDir = args.root || process.cwd();
  const registerArg = args.register || args.csv;
  const registerPath = registerArg
    ? path.resolve(rootDir, registerArg)
    : path.join(
        rootDir,
        'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv'
      );
  const run = Boolean(args.run);
  const loop = Boolean(args.loop);
  const workItem = args['work-item'] || args.workItem;
  const stopFile = args['stop-file'] || args.stopFile;
  const decisionDir = args['decision-dir'] || args.decisionDir;
  const json = Boolean(args.json);

  return runNext(
    {
      rootDir,
      registerPath,
      run,
      syncRegister: run && args['sync-register'] !== false,
      loop,
      workItem,
      stopFile,
      decisionDir,
      json,
      runPlanning: deps && deps.runPlanning,
      planningDeps: deps && deps.planningDeps,
      ...args,
    },
    deps
  );
}

module.exports = {
  findNextWorkItem,
  checkCeiling,
  checkCandidateLanes,
  getEarliestResetTime,
  runNext,
  nextLoop,
  nextCommand,
  executeIntakeForItem,
  CONCURRENCY_CEILING,
  loadConfig,
  getPollingInterval,
  getAllDecisionDirs,
  collectAllDecisionRecords,
  getOpenRuns,
  isOpenRun,
};
