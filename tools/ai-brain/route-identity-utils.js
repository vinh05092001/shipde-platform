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

const GATEWAY_PORT_HINTS = Object.freeze({
  ...(ROUTE_IDENTITY_DATA.gatewayPortHints || {}),
});

function detectGatewayFromEndpoint(endpoint) {
  const value = String(endpoint || '');
  if (!value) return null;
  for (const [gatewayId, hints] of Object.entries(GATEWAY_PORT_HINTS)) {
    const list = Array.isArray(hints) ? hints : [hints];
    if (list.some((hint) => value.includes(String(hint)))) return gatewayId;
  }
  return null;
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
const PRIVATE_SALT = process.env.SHIPDE_ROUTE_IDENTITY_SALT || 'shipde-route-identity-salt-v1';
const EMAIL_HASH_LENGTH = 16;

function hashEmail(email) {
  const normalized = String(email || '')
    .trim()
    .toLowerCase();
  return crypto
    .createHash('sha256')
    .update(PRIVATE_SALT + '::' + normalized)
    .digest('hex')
    .slice(0, EMAIL_HASH_LENGTH);
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

function lookupProvider(prefix, customAliases) {
  if (customAliases && customAliases[prefix]) return customAliases[prefix];
  return DEFAULT_PREFIX_TO_PROVIDER[prefix] || null;
}

/**
 * Resolve the provider/model split of a model id, modelled on LiteLLM's
 * `get_llm_provider` (https://github.com/BerriAI/litellm, utils.py). When an
 * explicit provider is supplied it wins, and the router prefix is only consumed
 * when it resolves to that same provider; otherwise a slash-namespaced id
 * (`meta-llama/Llama-3.3-70B-Instruct`) is the provider's own model id and is
 * preserved verbatim (BR-ROUTING-06).
 */
function resolveModelPrefix(modelId, customAliases = {}, explicitProvider = null) {
  const m = String(modelId || '').trim();
  const provider = explicitProvider ? String(explicitProvider) : null;
  if (!m) {
    return { prefix: null, upstreamProviderId: provider || UNKNOWN, outboundModelId: UNKNOWN };
  }

  const slashIdx = m.indexOf('/');
  const rawPrefix = slashIdx === -1 ? null : m.slice(0, slashIdx);
  const remainder = slashIdx === -1 ? m : m.slice(slashIdx + 1);
  const resolvedPrefix = rawPrefix ? lookupProvider(rawPrefix, customAliases) : null;

  if (provider) {
    if (rawPrefix && resolvedPrefix === provider) {
      return { prefix: rawPrefix, upstreamProviderId: provider, outboundModelId: remainder };
    }
    return { prefix: null, upstreamProviderId: provider, outboundModelId: m };
  }

  if (!rawPrefix) {
    return {
      prefix: null,
      upstreamProviderId: lookupProvider(m, customAliases) || m,
      outboundModelId: m,
    };
  }

  return {
    prefix: rawPrefix,
    upstreamProviderId: resolvedPrefix || rawPrefix,
    outboundModelId: remainder,
  };
}

module.exports = {
  UNKNOWN,
  GATEWAY_PREFIX_SEPARATOR,
  DEFAULT_PREFIX_TO_PROVIDER,
  PREFIX_PROVIDER_MAP,
  GATEWAY_PORT_HINTS,
  detectGatewayFromEndpoint,
  escapePart,
  unescapePart,
  distinguishPathway,
  resolveModelPrefix,
  registerPrivateEmail,
  getPrivateEmail,
  hashEmail,
  maskEmailsInString,
  sanitizeMetadata,
};
