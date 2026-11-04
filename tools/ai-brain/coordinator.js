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

async function coordinatorTick(items, state, deps) {
  const now = Number(deps.now ?? Date.now());
  state.items ||= {};
  state.launches ||= [];
  state.exhausted ||= [];
  state.launches = state.launches.filter((launch) => now - launch.at < POLICY.launchWindowMs);
  state.exhausted = state.exhausted.filter((row) => row.until > now);
  const save = async () => deps.save?.(state);
  if (state.lastRefreshAt == null || now - state.lastRefreshAt >= DAY_MS) {
    state.lastRefreshAt = now;
    await save();
    try {
      state.lastRefresh = await deps.refresh();
    } catch (error) {
      state.lastRefresh = { ok: false, error: error.code || 'REFRESH_FAILED' };
    }
    await save();
  }
  const route = async (item, current, candidates) => {
    if (!canReroute(current, { ...deps, now })) return;
    const choice = chooseWriter(candidates, {
      now,
      configured: deps.configured,
      exhausted: state.exhausted,
      launches: state.launches,
      failedWriters: current.failedWriters,
      highRisk: item.risk === 'HIGH',
    });
    if (!choice) {
      current.status = 'NO_ELIGIBLE_WRITER';
      return;
    }
    current.lastRouteAt = now;
    // Reserve before the external launch; crash recovery must not double-launch.
    current.writer = { ...choice, log: deps.launchLog?.(item), reservedAt: now };
    rememberAuthor(current, choice);
    current.status = 'LAUNCH_PENDING';
    state.launches.push({ at: now, model: choice.model, item: item.id });
    await save();
    try {
      const handle = await deps.launch(item, choice);
      if (!handle?.pid && !handle?.log) throw new Error('LAUNCH_UNBOUND');
      current.writer = { ...current.writer, ...handle };
      current.status = 'WRITING';
    } catch (error) {
      current.status = 'LAUNCH_UNKNOWN';
      current.error = errorText(error);
    }
    await save();
  };
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
      await route(item, current, candidates);
      await save();
      continue;
    }
    if ((current.rounds || 0) >= POLICY.maxRounds) {
      current.status = 'STUCK';
      await save();
      continue;
    }
    const prepared = await deps.prepare(item);
    let result,
      sha = prepared.sha || observed.sha;
    if (!prepared.ok)
      result = {
        verdict: 'CHANGES_REQUIRED',
        sha,
        reason: prepared.reason,
        findings: [{ text: prepared.reason }],
        tokens: 0,
      };
    else {
      await deps.push(item, sha);
      const ci = await deps.ci(item, sha);
      if (ci.sha !== sha || ci.state === 'pending') {
        current.status = 'WAITING_CI';
        await save();
        continue;
      }
      if (ci.state === 'red')
        result = {
          verdict: 'CHANGES_REQUIRED',
          sha,
          reason: ci.reason || 'CI_RED',
          findings: [{ text: ci.reason || 'CI_RED' }],
          tokens: 0,
          ciRed: true,
        };
      else if (ci.state !== 'green') {
        current.status = 'STUCK';
        current.error = 'CI_UNKNOWN';
        await save();
        continue;
      } else {
        const writerFamily = current.writer?.family || family(current.writer?.model);
        if (!writerFamily) {
          current.status = 'STUCK';
          current.error = 'WRITER_FAMILY_UNKNOWN';
          await save();
          continue;
        }
        const reviewerCandidates = await deps.candidates(item, 'reviewer');
        const reviewer = chooseWriter(reviewerCandidates, {
          now,
          configured: deps.configured,
          excludeFamilies: current.authorFamilies,
          exhausted: state.exhausted,
          highRisk: item.risk === 'HIGH',
        });
        if (!reviewer) {
          current.status = 'NO_INDEPENDENT_REVIEWER';
          await save();
          continue;
        }
        current.status = 'REVIEW_PENDING';
        await save();
        try {
          result = await deps.review(
            item,
            reviewer,
            reviewPrompt(item, sha, current.previous),
            sha
          );
        } catch (error) {
          result = { verdict: 'BLOCKED', sha, reason: error.code || 'REVIEW_FAILED', tokens: null };
        }
        if (
          result.sha !== sha ||
          !['PASS', 'CHANGES_REQUIRED', 'BLOCKED'].includes(result.verdict) ||
          (result.verdict === 'PASS' &&
            result.findings?.some((finding) => !finding.closed && finding.severity !== 'P2'))
        )
          result = {
            verdict: 'BLOCKED',
            sha,
            reason: 'REVIEW_INVALID_OR_STALE',
            tokens: result.tokens ?? null,
          };
      }
    }
    current.rounds = (current.rounds || 0) + 1;
    current.lastVerdict = result.verdict;
    current.reviewedSha = sha;
    current.previous = safeText(
      sanitizeErrorSnippet(
        result.text || result.reason || JSON.stringify(result.findings || []),
        20000
      )
    );
    current.status =
      result.verdict === 'PASS'
        ? 'PASS'
        : result.verdict === 'BLOCKED' || current.rounds >= POLICY.maxRounds
          ? 'STUCK'
          : 'CHANGES_REQUIRED';
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
      } else await route(item, current, candidates);
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
