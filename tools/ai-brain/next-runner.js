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

function getOpenRuns(options, deps) {
  const opts = options || {};
  const d = deps || {};
  const rootDir = path.resolve(opts.rootDir || (d && d.rootDir) || process.cwd());
  const intakeBase =
    opts.intakeDir ||
    (d && d.intakeDir) ||
    path.join(rootDir, 'tools', 'ai-brain', 'data', 'intake');
  const now = typeof d.now === 'function' ? d.now() : d.now || opts.now || Date.now();
  const ttlMs = opts.ttlMs || (d && d.ttlMs) || 4 * 60 * 60 * 1000;

  const openRuns = [];
  try {
    if (!fs.existsSync(intakeBase)) return openRuns;
    const entries = fs.readdirSync(intakeBase);
    for (const entry of entries) {
      const runDir = path.join(intakeBase, entry);
      let stat;
      try {
        stat = fs.statSync(runDir);
      } catch (_) {
        continue;
      }
      if (!stat.isDirectory()) continue;

      let workItemId = null;
      const specsFile = path.join(runDir, 'specs.json');
      if (fs.existsSync(specsFile)) {
        try {
          const specs = JSON.parse(fs.readFileSync(specsFile, 'utf8'));
          if (Array.isArray(specs) && specs[0] && specs[0].id) {
            workItemId = specs[0].id;
          }
        } catch (_) {}
      }
      if (!workItemId) {
        const lastDash = entry.lastIndexOf('-');
        if (lastDash > 0) {
          workItemId = entry.slice(0, lastDash);
        }
      }
      if (!workItemId) continue;

      if (now - stat.mtimeMs > ttlMs) continue;

      let terminal = false;
      const runDecDir = path.join(runDir, 'decisions');
      if (fs.existsSync(runDecDir)) {
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
      if (!terminal && fs.existsSync(checkpointFile)) {
        try {
          const ckpt = JSON.parse(fs.readFileSync(checkpointFile, 'utf8'));
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

function findNextWorkItem(options, deps) {
  const opts = options || {};
  const d = deps || {};
  const rootDir = path.resolve(opts.rootDir || process.cwd());
  const now = typeof d.now === 'function' ? d.now() : d.now || opts.now || Date.now();
  const decisionRecords = collectAllDecisionRecords(opts, d);
  const terminalWorkItems = opts.terminalWorkItems || d.terminalWorkItems || new Map();

  let items = [];
  if (Array.isArray(d.items)) {
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

  const byId = new Map();
  for (const it of items) {
    if (it && it.work_item_id) {
      byId.set(it.work_item_id, it);
    }
  }

  const skipped = [];
  let selected = null;

  for (const item of items) {
    const id = item.work_item_id;
    if (!id) continue;
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
    if (isReadyForAuthor || isBacklog) {
      selected = item;
      break;
    }

    skipped.push({
      id,
      reason: `status ${status} is not ready for author`,
    });
  }

  return { item: selected, skipped };
}

async function awaitIntakeExecution(intakeResult) {
  let childExitCode = 0;
  if (intakeResult && intakeResult.child && typeof intakeResult.child.on === 'function') {
    childExitCode = await new Promise((resolve) => {
      let settled = false;
      const done = (code) => {
        if (!settled) {
          settled = true;
          resolve(typeof code === 'number' ? code : 0);
        }
      };
      intakeResult.child.on('close', (code) => done(code));
      intakeResult.child.on('exit', (code) => done(code));
      intakeResult.child.on('error', () => done(1));
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

  const primaryDecisionDir = opts.decisionDir || d.decisionDir || decisions.DEFAULT_DIR;

  try {
    const intakeResult = await runIntakeFn(
      {
        workItem: item.work_item_id,
        run: true,
        publish: opts.publish,
        decisionDir: primaryDecisionDir,
      },
      intakeDeps
    );

    const { exitCode, outcome } = await awaitIntakeExecution(intakeResult);

    const stage =
      outcome === 'completed' || outcome === 'published'
        ? decisions.Stage.COMPLETED
        : outcome === 'refused'
          ? decisions.Stage.REFUSED
          : decisions.Stage.FAILED;

    decisions.recordDecision(
      {
        stage,
        workItemId: item.work_item_id,
        outcome,
        exitCode,
      },
      logOpts
    );

    return {
      success: exitCode === 0 && (outcome === 'completed' || outcome === 'published'),
      outcome,
      exitCode,
      intakeResult,
    };
  } catch (err) {
    const isRefusal =
      err &&
      (err.code === 'INTAKE_INCOMPLETE' ||
        String(err.code || '').startsWith('ISOLATION_') ||
        err.code === 'BASE_SHA_NOT_IN_LOCAL_MAIN');
    const outcome = isRefusal ? 'refused' : 'failed';
    const stage = isRefusal ? decisions.Stage.REFUSED : decisions.Stage.FAILED;

    decisions.recordDecision(
      {
        stage,
        workItemId: item.work_item_id,
        outcome,
        detail: err && err.message,
        code: err && err.code,
      },
      logOpts
    );

    return { success: false, outcome, exitCode: 1, error: err };
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

  let iteration = 0;
  while (iteration < maxIterations) {
    iteration += 1;
    const now = getNow();
    const logOpts = { dir: opts.decisionDir || d.decisionDir || decisions.DEFAULT_DIR, now };

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
    const findResult = findNextWorkItem({ ...opts, now, terminalWorkItems }, d);
    for (const s of findResult.skipped) {
      log(`Skipped ${s.id}: ${s.reason}`);
    }

    if (!findResult.item) {
      // TASK-AI-141 Part B: qualification is a separate, bounded controller
      // slot. It is offered only when the product register has no ready item;
      // the slot callback owns the isolated worker/reviewer path and cannot
      // turn a qualification run into a product Work Item.
      const qualificationSlot = opts.qualificationSlot || d.qualificationSlot;
      if (typeof qualificationSlot === 'function') {
        const qualification = await qualificationSlot({ now, iteration });
        if (qualification && qualification.ran === true) {
          log('QUALIFICATION_SLOT: ' + (qualification.status || 'completed'));
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

    const item = findResult.item;
    log(`Next Work Item: ${item.work_item_id} (status: ${item.status})`);

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
    const ceilingStatus = checkCeiling({ ...opts, now }, d);
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

    const outcome = execResult.outcome || 'completed';
    terminalWorkItems.set(item.work_item_id, outcome);
    log(`Work Item ${item.work_item_id} ended with terminal state ${outcome}.`);

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
    ran: true,
    status: execResult.outcome,
    exitCode: execResult.exitCode,
  };
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
  const stopFile = args['stop-file'] || args.stopFile;
  const decisionDir = args['decision-dir'] || args.decisionDir;
  const json = Boolean(args.json);

  return runNext(
    {
      rootDir,
      registerPath,
      run,
      loop,
      stopFile,
      decisionDir,
      json,
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
  CONCURRENCY_CEILING,
  loadConfig,
  getPollingInterval,
  getAllDecisionDirs,
  collectAllDecisionRecords,
  getOpenRuns,
  isOpenRun,
};
