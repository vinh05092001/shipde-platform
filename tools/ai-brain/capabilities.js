'use strict';

/**
 * Ship Dễ — Capability Registry
 *
 * Work is assigned to a capability, never to a vendor. `author.foundation`
 * describes what the work needs; which account serves it is configuration.
 * That is the whole point: plugging in another free API tomorrow should be a
 * config edit and a qualification run, not a change to any workflow.
 *
 * Two kinds of constraint live here and they are not interchangeable:
 *
 *   capability — can this account do the work at all (JSON schema, tool use,
 *                context window). Failing this makes the account unusable.
 *
 *   permission — is this account *allowed* to touch this work. AGENTS.md bars
 *                the low-risk author from auth, tenancy, money and carrier
 *                side effects regardless of how capable the model is. A model
 *                being good enough is not an argument here.
 *
 * Conflating the two is how a cheap account ends up editing authentication
 * because it benchmarked well.
 */

/** Domains a Work Item can touch. Used for permission, never for capability. */
const RiskDomain = {
  ARCHITECTURE: 'architecture',
  AUTH: 'auth',
  TENANCY: 'tenancy',
  MONEY: 'money',
  CARRIER_SIDE_EFFECTS: 'carrier_side_effects',
  DATABASE_OWNERSHIP: 'database_ownership',
  PRODUCT_UX: 'product_ux',
};

const ALL_RISK_DOMAINS = Object.values(RiskDomain);

/**
 * Roles as AGENTS.md defines them, expressed as requirements rather than names.
 * `forbiddenDomains` mirrors the 9Router stop-list verbatim.
 */
const ROLES = {
  'planner.default': {
    description: 'Chọn đầu mục, soạn Work Item đầy đủ, chỉ định tác giả',
    requires: { jsonSchema: true, tools: false, minContext: 128000 },
    forbiddenDomains: [],
    // A planner that writes production code has stopped being a planner.
    mayWriteCode: false,
    maxParallel: 1,
  },
  'author.foundation': {
    description: 'Đầu mục nền tảng và tính năng dọc, việc xuyên tầng',
    requires: { jsonSchema: true, tools: true, minContext: 200000 },
    forbiddenDomains: [],
    mayWriteCode: true,
    maxParallel: 2,
  },
  'author.lowrisk': {
    description: 'Fixture, mock, type, CRUD nhỏ, test hẹp, lint',
    requires: { jsonSchema: true, tools: true, minContext: 64000 },
    // Verbatim from AGENTS.md: the constrained author must stop at these.
    forbiddenDomains: ALL_RISK_DOMAINS,
    mayWriteCode: true,
    maxParallel: 3,
    // AGENTS.md: two failed attempts escalate; do not keep retrying to save credits.
    maxAttempts: 2,
    escalatesTo: 'author.foundation',
  },
  'reviewer.primary': {
    description: 'Review độc lập, trả PASS / CHANGES_REQUIRED / BLOCKED',
    requires: { jsonSchema: true, tools: true, minContext: 200000 },
    forbiddenDomains: [],
    mayWriteCode: false,
    maxParallel: 2,
  },
  'analyst.default': {
    description: 'Phân tích kiến trúc và dữ liệu, chỉ đọc',
    requires: { jsonSchema: false, tools: true, minContext: 128000 },
    forbiddenDomains: [],
    mayWriteCode: false,
    maxParallel: 2,
  },
};

function listRoles() {
  return Object.keys(ROLES);
}

function getRole(roleId) {
  return ROLES[roleId] || null;
}

/**
 * Why an account cannot serve a role, or null when it can.
 * Returns the first blocking reason so the caller can report something useful
 * instead of "no account available".
 */
function disqualify(role, account, workItem) {
  if (!account) return 'tài khoản không tồn tại';
  if (account.enabled === false) return 'tài khoản đang tắt';

  const caps = account.capabilities || {};
  const need = role.requires || {};

  if (need.jsonSchema && !caps.jsonSchema) return 'không hỗ trợ JSON schema';
  if (need.tools && !caps.tools) return 'không hỗ trợ tool use';
  if (need.minContext && (caps.contextWindow || 0) < need.minContext) {
    return 'cửa sổ ngữ cảnh ' + (caps.contextWindow || 0) + ' < yêu cầu ' + need.minContext;
  }

  // An account may also declare roles it has not qualified for. Promptfoo
  // results are meant to write this field; an unqualified account is refused
  // rather than quietly tried.
  if (Array.isArray(account.qualifiedRoles) && !account.qualifiedRoles.includes(role.id)) {
    return 'chưa vượt bộ kiểm định cho vai trò này';
  }

  // Permission, evaluated last so a capability failure reports the clearer cause.
  const touches = (workItem && workItem.riskDomains) || [];
  const barred = touches.filter((d) => role.forbiddenDomains.includes(d));
  if (barred.length > 0) {
    return 'vai trò bị cấm chạm: ' + barred.join(', ');
  }

  return null;
}

/**
 * Accounts that may serve a role, cheapest first.
 *
 * Cost is the tiebreak rather than the filter: a free account that cannot hold
 * the context is not a saving, it is a retry. Accounts that declare a
 * `preference` win over price, so a plan can pin a role without deleting the
 * alternatives that keep it working when that account runs dry.
 */
function eligibleAccounts(roleId, accounts, workItem) {
  const role = getRole(roleId);
  if (!role) return { role: null, eligible: [], rejected: [] };
  const withId = Object.assign({ id: roleId }, role);

  const eligible = [];
  const rejected = [];

  for (const account of accounts || []) {
    const reason = disqualify(withId, account, workItem);
    if (reason) rejected.push({ account: account.id, reason });
    else eligible.push(account);
  }

  eligible.sort((a, b) => {
    const pa = Number(a.preference || 0);
    const pb = Number(b.preference || 0);
    if (pa !== pb) return pb - pa;
    return estimatedCost(a) - estimatedCost(b);
  });

  return { role: withId, eligible, rejected };
}

/** Blended per-million price, weighted toward input since prompts dominate. */
function estimatedCost(account) {
  const c = (account && account.cost) || {};
  const input = Number(c.inputPerMillion || 0);
  const output = Number(c.outputPerMillion || 0);
  return input * 0.8 + output * 0.2;
}

module.exports = {
  RiskDomain,
  ALL_RISK_DOMAINS,
  ROLES,
  listRoles,
  getRole,
  eligibleAccounts,
  disqualify,
  estimatedCost,
};
