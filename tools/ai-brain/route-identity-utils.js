'use strict';

const crypto = require('crypto');
const ROUTE_IDENTITY_DATA = require('../../config/route-identity.json');

const GATEWAY_PREFIX_SEPARATOR = '::';
const UNKNOWN = 'UNKNOWN';

// Known provider prefixes for 9router, loaded from versioned route identity data.
const DEFAULT_PREFIX_TO_PROVIDER = Object.freeze({
  ...ROUTE_IDENTITY_DATA.prefixToProvider,
});

const PREFIX_PROVIDER_MAP = DEFAULT_PREFIX_TO_PROVIDER;

// Quota group -> quota family aliases, loaded from the same versioned data.
const QUOTA_FAMILY_BY_GROUP = Object.freeze({
  ...ROUTE_IDENTITY_DATA.quotaFamilies,
});

function getQuotaFamily(group) {
  if (group === null || group === undefined) return group;
  return QUOTA_FAMILY_BY_GROUP[group] || group;
}

function escapePart(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/%/g, '%25')
    .replace(/:/g, '%3A')
    .replace(/\u241f/g, '%241F');
}

function unescapePart(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/%3A/g, ':').replace(/%241F/g, '\u241f').replace(/%25/g, '%');
}

const PRIVATE_ACCOUNT_EMAIL_MAP = new Map();
const PRIVATE_SALT = 'shipde-route-identity-salt-v1';

function hashEmail(email) {
  const normalized = String(email || '')
    .trim()
    .toLowerCase();
  return crypto
    .createHash('sha256')
    .update(PRIVATE_SALT + '::' + normalized)
    .digest('hex')
    .slice(0, 10);
}

function registerPrivateEmail(key, email) {
  if (!key || !email) return;
  const k = String(key).trim();
  const e = String(email).trim().toLowerCase();
  if (e.includes('@')) {
    PRIVATE_ACCOUNT_EMAIL_MAP.set(k, e);
    PRIVATE_ACCOUNT_EMAIL_MAP.set(k.toLowerCase(), e);
    const hash = hashEmail(e);
    PRIVATE_ACCOUNT_EMAIL_MAP.set(hash, e);
    PRIVATE_ACCOUNT_EMAIL_MAP.set(e, hash);
  }
}

function getPrivateEmail(key) {
  if (!key) return null;
  const k = String(key).trim();
  return PRIVATE_ACCOUNT_EMAIL_MAP.get(k) || PRIVATE_ACCOUNT_EMAIL_MAP.get(k.toLowerCase()) || null;
}

function maskEmailsInString(str) {
  if (!str || typeof str !== 'string') return str;
  return str.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, (match) => {
    registerPrivateEmail(hashEmail(match), match);
    return hashEmail(match);
  });
}

function sanitizeMetadata(meta) {
  if (!meta || typeof meta !== 'object') return meta;
  const out = {};
  for (const [k, v] of Object.entries(meta)) {
    const safeKey = typeof k === 'string' && k.includes('@') ? maskEmailsInString(k) : k;

    if (
      safeKey === 'realAccountRef' ||
      safeKey === 'accountRef' ||
      safeKey === 'originalQuotaScope'
    ) {
      if (typeof v === 'string' && v.includes('@')) {
        registerPrivateEmail(hashEmail(v), v);
        out[safeKey] = hashEmail(v);
      } else {
        out[safeKey] = v;
      }
    } else if (typeof v === 'string' && v.includes('@')) {
      registerPrivateEmail(hashEmail(v), v);
      out[safeKey] = maskEmailsInString(v);
    } else if (Array.isArray(v)) {
      out[safeKey] = v.map((item) =>
        typeof item === 'object'
          ? sanitizeMetadata(item)
          : typeof item === 'string' && item.includes('@')
            ? (registerPrivateEmail(hashEmail(item), item), hashEmail(item))
            : item
      );
    } else if (v && typeof v === 'object') {
      out[safeKey] = sanitizeMetadata(v);
    } else {
      out[safeKey] = v;
    }
  }
  return out;
}

function getQuotaGroup(id) {
  if (id?.metadata?.quotaGroup) return id.metadata.quotaGroup;
  if (id?.metadata?.quotaFamily) {
    const f = String(id.metadata.quotaFamily).toLowerCase();
    if (f.includes('argon')) return 'argon';
    if (f.includes('gemini')) return 'gemini';
    if (f.includes('claude') || f.includes('gpt') || f.includes('3p') || f.includes('external'))
      return 'external';
    return f;
  }
  const m = String(id?.outboundModelId || id?.configuredModelId || '').toLowerCase();
  if (/argon/i.test(m)) return 'argon';
  if (m.includes('gemini')) return 'gemini';
  const prov = String(id?.upstreamProviderId || id?.sourceId || '').toLowerCase();
  if (prov.includes('antigravity') || prov.includes('agy')) {
    if (m.includes('claude') || m.includes('gpt') || m.includes('opus') || m.includes('sonnet'))
      return 'external';
    return 'external';
  }
  return undefined;
}

function distinguishPathway(identity) {
  if (!identity) return UNKNOWN;
  const h = String(identity.harness || '').toLowerCase();
  const s = String(identity.sourceId || '').toLowerCase();
  const g = String(identity.gatewayId || '').toLowerCase();
  const acc = String(identity.accountRef || identity.account || '').toLowerCase();

  if (h === 'agy-pool' || s.startsWith('agy') || /^agy\d{2}$/i.test(acc)) {
    return 'AGY_POOL';
  }
  if (g === '9router' || s === '9router' || identity.isVia9Router === true) {
    return '9ROUTER';
  }
  return 'DIRECT';
}

function resolveModelPrefix(modelId, customAliases = {}) {
  const m = String(modelId || '').trim();
  if (!m) {
    return { prefix: null, upstreamProviderId: UNKNOWN, outboundModelId: UNKNOWN };
  }

  const slashIdx = m.indexOf('/');
  if (slashIdx === -1) {
    const p = customAliases[m] || DEFAULT_PREFIX_TO_PROVIDER[m] || m;
    return { prefix: null, upstreamProviderId: p, outboundModelId: m };
  }

  const prefix = m.slice(0, slashIdx);
  const remainder = m.slice(slashIdx + 1);
  const resolvedProvider = customAliases[prefix] || DEFAULT_PREFIX_TO_PROVIDER[prefix] || prefix;

  return {
    prefix,
    upstreamProviderId: resolvedProvider,
    outboundModelId: remainder,
  };
}

module.exports = {
  UNKNOWN,
  GATEWAY_PREFIX_SEPARATOR,
  DEFAULT_PREFIX_TO_PROVIDER,
  PREFIX_PROVIDER_MAP,
  QUOTA_FAMILY_BY_GROUP,
  getQuotaFamily,
  escapePart,
  unescapePart,
  distinguishPathway,
  resolveModelPrefix,
  registerPrivateEmail,
  getPrivateEmail,
  hashEmail,
  maskEmailsInString,
  sanitizeMetadata,
  getQuotaGroup,
};
