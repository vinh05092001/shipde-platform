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
const path = require('path');

const decisions = require('./decisions');
const { parseDependencies } = require('./reconcile');
const { CONCURRENCY_CEILING } = require('./scheduler');
const evidenceApi = require('./evidence');
const intakeApi = require('./intake');

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getEarliestResetTime(evidenceData, now) {
  let earliest = null;
  if (!evidenceData) return null;

  if (evidenceData.cooldowns) {
    for (const cd of Object.values(evidenceData.cooldowns)) {
      if (!cd || cd.status !== 'blocked') continue;
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
  const maxWriters =
    ceiling.maxWriters !== undefined
      ? ceiling.maxWriters
      : ceiling.maxImplementationAgents !== undefined
        ? ceiling.maxImplementationAgents
        : 2;
  const maxReviewers =
    ceiling.maxReviewers !== undefined
      ? ceiling.maxReviewers
      : ceiling.maxReviewAgents !== undefined
        ? ceiling.maxReviewAgents
        : 2;

  const decisionOpts = {
    dir: opts.decisionDir || (d && d.decisionDir) || decisions.DEFAULT_DIR,
    now: typeof d.now === 'function' ? d.now() : d.now || opts.now || Date.now(),
  };

  const writersDetailed =
    typeof d.openWritersDetailed === 'function'
      ? d.openWritersDetailed(decisionOpts)
      : decisions.openWritersDetailed(decisionOpts);
  const reviewersDetailed =
    typeof d.openReviewersDetailed === 'function'
      ? d.openReviewersDetailed(decisionOpts)
      : decisions.openReviewersDetailed(decisionOpts);

  const writersCount =
    (writersDetailed && writersDetailed.writers && writersDetailed.writers.length) || 0;
  const reviewersCount =
    (reviewersDetailed && reviewersDetailed.reviewers && reviewersDetailed.reviewers.length) || 0;

  if (writersCount >= maxWriters) {
    return {
      allowed: false,
      reason: 'WRITER_CEILING_REACHED',
      detail: `active writers (${writersCount}) reached ceiling (${maxWriters})`,
      writersCount,
      reviewersCount,
      maxWriters,
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
  const decisionDir = opts.decisionDir || d.decisionDir || decisions.DEFAULT_DIR;

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
    const activeWriter = writerFn(id, { dir: decisionDir, now });
    const isOpen = typeof d.isOpenRun === 'function' ? d.isOpenRun(id) : false;
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

async function nextLoop(options, deps) {
  const opts = options || {};
  const d = deps || {};
  const rootDir = path.resolve(opts.rootDir || process.cwd());
  const log = d.log || console.log;
  const sleepFn = d.sleep || defaultSleep;
  const getNow = typeof d.now === 'function' ? d.now : () => d.now || Date.now();
  const maxIterations = opts.maxIterations !== undefined ? Number(opts.maxIterations) : Infinity;

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
          stage: 'stopped',
          detail: 'STOP_FILE_EXISTS',
          stopFile: stopFilePath,
        },
        logOpts
      );
      log(`Stop file exists: ${stopFilePath}. Stopping cleanly.`);
      return { stopped: true, reason: 'STOP_FILE_EXISTS', iteration };
    }

    // 2. Find next work item
    const findResult = findNextWorkItem({ ...opts, now }, d);
    for (const s of findResult.skipped) {
      log(`Skipped ${s.id}: ${s.reason}`);
    }

    if (!findResult.item) {
      decisions.recordDecision(
        {
          stage: decisions.Stage.REFUSED || 'refused',
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
          stage: decisions.Stage.COOLED || 'cooled',
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
          : opts.pollIntervalMs || 5000;
      await sleepFn(waitMs);
      if (opts.stopOnUnavailable || maxIterations <= 1) {
        return {
          stopped: true,
          reason: 'ALL_LANES_UNAVAILABLE',
          earliestResetTime: laneStatus.earliestResetTime,
          waitMs,
          iteration,
        };
      }
      continue;
    }

    // 4. Check ceiling
    const ceilingStatus = checkCeiling({ ...opts, now }, d);
    if (!ceilingStatus.allowed) {
      decisions.recordDecision(
        {
          stage: decisions.Stage.REFUSED || 'refused',
          detail: ceilingStatus.reason,
          workItemId: item.work_item_id,
        },
        logOpts
      );
      log(`Ceiling reached: ${ceilingStatus.detail}. Waiting.`);
      const waitMs = opts.pollIntervalMs || 5000;
      await sleepFn(waitMs);
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
        stage: decisions.Stage.SELECTED || 'selected',
        workItemId: item.work_item_id,
      },
      logOpts
    );

    const runIntakeFn = d.runIntake || intakeApi.runIntake;
    const intakeResult = await runIntakeFn(
      {
        workItem: item.work_item_id,
        run: true,
        publish: opts.publish,
      },
      d
    );

    if (intakeResult && intakeResult.child && typeof intakeResult.child.on === 'function') {
      await new Promise((resolve) => {
        intakeResult.child.on('close', resolve);
        intakeResult.child.on('exit', resolve);
        intakeResult.child.on('error', resolve);
      });
    }

    const terminalOutcome = (intakeResult && intakeResult.status) || 'completed';
    decisions.recordDecision(
      {
        stage:
          terminalOutcome === 'refused' || terminalOutcome === 'blocked'
            ? decisions.Stage.FAILED
            : decisions.Stage.COMPLETED,
        workItemId: item.work_item_id,
        outcome: terminalOutcome,
      },
      { dir: opts.decisionDir || d.decisionDir || decisions.DEFAULT_DIR, now: getNow() }
    );
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
        stage: 'stopped',
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
        stage: decisions.Stage.REFUSED || 'refused',
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
        stage: decisions.Stage.COOLED || 'cooled',
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
        stage: decisions.Stage.REFUSED || 'refused',
        detail: ceilingStatus.reason,
        workItemId: item.work_item_id,
      },
      logOpts
    );
    log(`Ceiling reached: ${ceilingStatus.detail}`);
    return { run: false, reason: ceilingStatus.reason, detail: ceilingStatus.detail };
  }

  // 5. Call intake --run
  decisions.recordDecision(
    {
      stage: decisions.Stage.SELECTED || 'selected',
      workItemId: item.work_item_id,
    },
    logOpts
  );

  const runIntakeFn = d.runIntake || intakeApi.runIntake;
  const intakeResult = await runIntakeFn(
    {
      workItem: item.work_item_id,
      run: true,
      publish: opts.publish,
    },
    d
  );

  return { item, intakeResult, ran: true };
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
};
