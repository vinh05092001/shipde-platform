'use strict';
const { sanitizeErrorSnippet } = require('./quota-scan');
const { safeText, errorText } = require('./coordinator-text');
const {
  POLICY,
  DAY_MS,
  family,
  writerAlive,
  canReroute,
  chooseWriter,
  reviewPrompt,
} = require('./coordinator-policy');
const { rememberAuthor, observeQuota } = require('./coordinator-quota-state');

function resetStateWindows(state, now) {
  state.items ||= {};
  state.launches ||= [];
  state.exhausted ||= [];
  state.launches = state.launches.filter((launch) => now - launch.at < POLICY.launchWindowMs);
  state.exhausted = state.exhausted.filter((row) => row.until > now);
}

async function doRefresh(state, now, deps, save) {
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
}

async function routeItem(item, current, candidates, state, deps, now, save) {
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
}

module.exports = { resetStateWindows, doRefresh, routeItem };
