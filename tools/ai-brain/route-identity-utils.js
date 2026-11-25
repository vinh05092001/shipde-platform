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

function maskEmailsInString(str) {
  if (!str || typeof str !== 'string') return str;
  return str.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, (match) => {
    registerPrivateEmail(hashEmail(match), match);
    return hashEmail(match);
  });
}

module.exports = {
  UNKNOWN,
  GATEWAY_PREFIX_SEPARATOR,
  DEFAULT_PREFIX_TO_PROVIDER,
  PREFIX_PROVIDER_MAP,
  GATEWAY_PORT_HINTS,
  escapePart,
  unescapePart,
  registerPrivateEmail,
  hashEmail,
  maskEmailsInString,
};
