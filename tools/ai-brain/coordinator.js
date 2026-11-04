'use strict';
const { sanitizeErrorSnippet } = require('./quota-scan');
const { safeText, errorText } = require('./coordinator-text');
const {
  POLICY,
  DAY_MS,
  family,
  writerAlive,
  canReroute,
  quotaFromLog,
  chooseWriter,
  reviewPrompt,
  partitionFindings,
  unionRegister,
  protectedFile,
  privateFile,
  preflight,
} = require('./coordinator-policy');
const { rememberAuthor, observeQuota } = require('./coordinator-quota-state');
const { metricsSummary, metricsKey, validMetric } = require('./coordinator-metrics');
const { resetStateWindows, doRefresh, routeItem } = require('./coordinator-tick-core');
const { applyVerdict, runReview } = require('./coordinator-tick-review');

async function coordinatorTick(items, state, deps) {
  const now = Number(deps.now ?? Date.now());
  resetStateWindows(state, now);
  const save = async () => deps.save?.(state);
  await doRefresh(state, now, deps, save);
  for (const item of items) {
    const current = (state.items[item.id] ||= {
      rounds: 0,
      failedWriters: [],
      writer: item.writer,
    });
    rememberAuthor(current, item.writer);
    rememberAuthor(current, current.writer);
    if (
      ['PASS', 'STUCK', 'LAUNCH_PENDING', 'LAUNCH_UNKNOWN', 'REVIEW_PENDING'].includes(
        current.status
      )
    )
      continue;
    if (writerAlive(current.writer, { ...deps, now })) continue;
    if (current.lanes) {
      if (current.lanes.some((lane) => !rememberAuthor(current, lane.writer))) {
        current.status = 'STUCK';
        current.error = 'WRITER_FAMILY_UNKNOWN';
        await save();
        continue;
      }
      const result = await deps.collectLanes(item, current.lanes);
      if (result.state === 'pending') continue;
      if (result.state !== 'merged') {
        current.status = 'STUCK';
        current.error = result.reason;
        await save();
        continue;
      }
      current.lanes = null;
      current.reviewedSha = null;
    }
    let observed = await deps.inspect(item);
    await observeQuota(current.writer, state, deps, now);
    if (observed.dirty && current.writer?.cannotCommit) {
      await deps.commit(item, current.writer);
      observed = await deps.inspect(item);
      if (observed.dirty) {
        current.status = 'STUCK';
        current.error = 'COMMIT_HANDOFF_INCOMPLETE';
        await save();
        continue;
      }
    } else if (observed.dirty) {
      current.status = 'STUCK';
      current.error = 'DIRTY_OUTPUT_WITHOUT_COMMIT_HANDOFF';
      await save();
      continue;
    }
    const candidates = await deps.candidates(item);
    if (!observed.sha || observed.sha === current.reviewedSha) {
      await routeItem(item, current, candidates, state, deps, now, save);
      await save();
      continue;
    }
    if ((current.rounds || 0) >= POLICY.maxRounds) {
      current.status = 'STUCK';
      await save();
      continue;
    }
    const prepared = await deps.prepare(item);
    const reviewOut = await runReview(
      item,
      current,
      deps,
      state,
      candidates,
      observed,
      prepared,
      now,
      save
    );
    if (!reviewOut) continue;
    const { result, sha } = reviewOut;
    applyVerdict(current, result, sha, now);
    await deps.history(item, {
      ...result,
      round: current.rounds,
      writer: current.writer?.model || 'unknown',
    });
    await deps.metrics({
      time: new Date(now).toISOString(),
      item: item.id,
      pr: item.pr,
      round: current.rounds,
      sha,
      writer: current.writer?.model || 'unknown',
      verdict: result.verdict,
      tokens: result.tokens ?? null,
      ciRed: Boolean(result.ciRed),
    });
    if (result.verdict === 'CHANGES_REQUIRED' && current.writer?.model)
      (current.failedWriters ||= []).push(current.writer.model);
    await save();
    if (current.status === 'CHANGES_REQUIRED') {
      const lanes = item.fanout ? partitionFindings(result.findings) : [];
      if (lanes.length > 1 && deps.fanout) {
        current.status = 'LAUNCH_PENDING';
        await save();
        current.lanes = await deps.fanout(item, lanes, candidates, state);
        current.status = 'WRITING';
        await save();
      } else await routeItem(item, current, candidates, state, deps, now, save);
    }
  }
  await save();
  return state;
}
module.exports = {
  POLICY,
  family,
  writerAlive,
  canReroute,
  quotaFromLog,
  chooseWriter,
  reviewPrompt,
  partitionFindings,
  unionRegister,
  protectedFile,
  privateFile,
  preflight,
  metricsSummary,
  metricsKey,
  validMetric,
  coordinatorTick,
};
