'use strict';

/**
 * Ship Dễ — Capacity Adapter
 *
 * Turns the measured token ledgers into the question the operator actually
 * asks: how much work can still be dispatched, and which model runs out next.
 *
 * Accounts come from the registry when one exists. When it does not — which is
 * the state today — they are derived from 9router's provider connections so
 * the panel shows something true rather than nothing. A derived account
 * declares no limits, so every model reads as `unknown` budget, and the panel
 * says so plainly instead of implying capacity nobody measured.
 *
 * Only counters are read. The registry deliberately holds no credentials and
 * the router's secret columns are never selected.
 */

const { collectRouterUsage, collectClaudeUsage } = require('./usage-adapter');
const { runwayReport, Difficulty } = require('../ai-brain/fitness');
const { expandOfferings, headroomForAll } = require('../ai-brain/offerings');
const { readIdentity } = require('../ai-brain/agy-identity');
const { usableReadings } = require('../ai-brain/quota-store');

let listAccounts = null;
try {
  ({ listAccounts } = require('../ai-brain/accounts'));
} catch (e) {
  listAccounts = null;
}

const DEFAULT_CAPS = { jsonSchema: true, tools: true, contextWindow: 200000 };

/**
 * Synthesises one usage event per recorded request so the quota windows have
 * something to count. Timestamps are spread across the day rather than stacked
 * on one instant, which keeps a per-minute limit from reading as exhausted
 * purely because history was replayed.
 */
function eventsFromProvider(provider, now) {
  const count = Math.min(provider.requests || 0, 500);
  const perEvent = count > 0 ? (provider.tokens || 0) / count : 0;
  const span = 24 * 60 * 60 * 1000;
  const events = [];
  for (let i = 0; i < count; i += 1) {
    events.push({
      at: now - Math.floor((span * (i + 1)) / (count + 1)),
      tokens: perEvent,
      cost: (provider.cost || 0) / Math.max(count, 1),
    });
  }
  return events;
}

/** Registry accounts, or a best-effort view derived from the router. */
function resolveAccounts(router, options) {
  const opts = options || {};
  if (Array.isArray(opts.accounts)) return { accounts: opts.accounts, derived: false };

  let registered = [];
  if (listAccounts) {
    try {
      registered = listAccounts(opts.registryOptions);
    } catch (e) {
      registered = [];
    }
  }
  if (registered.length > 0) return { accounts: registered, derived: false };

  if (!router || !router.available) return { accounts: [], derived: true };

  const accounts = (router.connections || []).map((c) => ({
    id: c.provider,
    provider: c.provider,
    model: c.provider + '/default',
    enabled: c.active,
    capabilities: DEFAULT_CAPS,
    cost: {},
    // No tier, grade or limit is invented here. Every one of those is a
    // declaration the operator has not made yet, and guessing them would be
    // the same fabrication this panel exists to replace.
    tier: 0,
    limits: {},
  }));
  return { accounts, derived: true };
}

function collectCapacity(options) {
  const opts = options || {};
  const now = opts.now || Date.now();
  const difficulty = Number(opts.difficulty) || Difficulty.STANDARD;

  const router = opts.router || collectRouterUsage(opts.routerDbPath);
  const claude = opts.claude || collectClaudeUsage(opts.claudeProjectsDir);
  const { accounts, derived } = resolveAccounts(router, opts);

  if (accounts.length === 0) {
    return {
      health: {
        status: 'unavailable',
        observedAt: new Date(now).toISOString(),
        impact: 'Chưa có tài khoản nào được đăng ký và không đọc được sổ 9router',
      },
      data: null,
    };
  }

  const eventsByAccount = {};
  if (router && router.available) {
    for (const p of router.providers) {
      eventsByAccount[p.provider] = eventsFromProvider(p, now);
    }
  }

  // What the providers themselves last said was left. Read from the cache the
  // `quota` command fills, never by calling a CLI here: that call takes tens of
  // seconds and someone is waiting for this page. A reading the cache refuses
  // is reported as a refusal rather than dropped, so the panel can say why a
  // figure is missing instead of showing a gap that looks like zero.
  const identity = opts.identity || readIdentity({ home: opts.home });
  const { reported, problems } = opts.reported
    ? { reported: opts.reported, problems: opts.reportedProblems || {} }
    : usableReadings(identity, { home: opts.home, now });

  const offerings = expandOfferings(accounts);
  const headrooms = headroomForAll(offerings, eventsByAccount, opts.eventsByOffering || {}, {
    now,
    reported,
  });
  const report = runwayReport(offerings, difficulty, headrooms, opts.history || {}, opts.fitness);

  // Claude Code work never passes through the router, so its spend is reported
  // beside the pool rather than folded into it: adding the two would imply a
  // shared budget that does not exist.
  const claudeSide = claude && claude.available
    ? {
        available: true,
        messages: claude.totals.messages,
        tokens:
          claude.totals.input + claude.totals.output + claude.totals.cacheWrite + claude.totals.cacheRead,
        costEstimate: claude.totals.cost,
        cacheHitRate: claude.cacheHitRate,
      }
    : { available: false, reason: (claude && claude.reason) || 'không đọc được' };

  return {
    health: {
      status: derived ? 'degraded' : 'live',
      observedAt: new Date(now).toISOString(),
      impact: derived
        ? 'Chưa đăng ký tài khoản nào; đang suy ra từ kết nối 9router, nên hạn mức và cấp độ đều chưa rõ'
        : null,
    },
    data: Object.assign({}, report, {
      derivedFromRouter: derived,
      claude: claudeSide,
      // The vendor's own figures, and the reason each missing one is missing.
      // Shown beside our accounting rather than merged into it: one is a
      // percentage of an undisclosed ceiling, the other a token count, and
      // presenting them as one number would invent a ceiling neither knows.
      vendorQuota: {
        identity: identity.known
          ? { known: true, email: identity.email }
          : { known: false, reason: identity.reason },
        accounts: Object.entries(reported).map(([accountId, q]) => ({
          accountId,
          account: q.account && q.account.known ? q.account.email : null,
          // An operator-written name for the account. Kept separate from the
          // identity because it is not evidence of anything: nothing verifies
          // it, and it does not change when the account does.
          label: q.label || null,
          observedAt: q.cachedAt || q.observedAt || null,
          rows: q.rows,
        })),
        problems: Object.entries(problems).map(([accountId, p]) => ({
          accountId,
          reason: p.reason,
          switched: Boolean(p.switched),
        })),
      },
    }),
  };
}

module.exports = { collectCapacity, eventsFromProvider, resolveAccounts };
