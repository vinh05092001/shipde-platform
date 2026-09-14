'use strict';

/**
 * Ship Dễ — Account Registry
 *
 * Holds the accounts the scheduler may dispatch to, so adding a provider is a
 * registry entry rather than a code change. Two stores, deliberately separate:
 *
 *   registry.json  — what an account is: provider, model, capabilities, limits,
 *                    tier. Readable, diffable, safe to show on a dashboard.
 *   secrets.enc    — the credential, AES-256-GCM encrypted, never returned by
 *                    any listing function.
 *
 * The split is not cosmetic. 9router keeps live `sk-ant-oat01-…` and `ghu_…`
 * tokens in plaintext SQLite columns, so anything that opens that database to
 * read usage also sees working credentials. A registry that repeated the
 * mistake would widen the same hole while claiming to be an improvement.
 *
 * `listAccounts` returns secrets as a boolean presence flag and nothing else.
 * A caller that needs the credential must ask for it by name, which makes the
 * few places that legitimately touch one greppable.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const HOME_DIR = path.join(os.homedir(), '.shipde');
const REGISTRY_FILE = path.join(HOME_DIR, 'accounts.registry.json');
const SECRETS_FILE = path.join(HOME_DIR, 'accounts.secrets.enc');
const KEY_FILE = path.join(HOME_DIR, 'accounts.key');

/**
 * Escalation ladder. A tier is only consulted once every account in the tier
 * above it is out of room, which is what keeps paid capacity from being spent
 * while free capacity is still available.
 */
const Tier = {
  LOCAL: 0, // 9router and anything else already paid for
  ACCOUNT: 1, // CLI accounts on existing subscriptions (Gemini, Claude)
  EXTERNAL: 2, // API keys added later, billed per call
};

function ensureDir(target) {
  // The directory that must exist is the one holding the file being written,
  // not always the home directory: honouring options.keyFile while creating
  // only HOME_DIR meant any keyFile outside it failed with ENOENT, and created
  // ~/.shipde as a side effect on the way.
  fs.mkdirSync(target ? path.dirname(target) : HOME_DIR, { recursive: true });
}

/**
 * The encryption key lives in a file rather than the registry, so a leaked
 * registry is inert. SHIPDE_ACCOUNT_KEY overrides it for setups that keep the
 * key outside the filesystem.
 */
function loadKey(options) {
  const fromEnv = process.env.SHIPDE_ACCOUNT_KEY;
  // An exported-but-empty variable means unset, not "set to nothing": that is
  // how shells, CI matrices and .env loaders spell absence, and it carries
  // none of the ambiguity a short key does. Throwing on it would break every
  // secret read on machines that simply export the name.
  const declared = typeof fromEnv === 'string' && fromEnv.trim() !== '';
  if (declared) {
    if (fromEnv.length < 32) {
      throw new Error(
        `SHIPDE_ACCOUNT_KEY phải có độ dài ít nhất 32 ký tự (hiện có ${fromEnv.length})`
      );
    }
    return crypto.createHash('sha256').update(fromEnv).digest();
  }
  const keyFile = (options && options.keyFile) || KEY_FILE;
  ensureDir(keyFile);
  if (!fs.existsSync(keyFile)) {
    const key = crypto.randomBytes(32);
    fs.writeFileSync(keyFile, key.toString('base64'), { mode: 0o600 });
    return key;
  }
  return Buffer.from(fs.readFileSync(keyFile, 'utf8').trim(), 'base64');
}

function encrypt(plain, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    enc.toString('base64'),
  ].join('.');
}

function decrypt(stored, key) {
  const [ivB64, tagB64, dataB64] = String(stored || '').split('.');
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('Bản mã hỏng hoặc sai định dạng');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function writeJson(file, value) {
  ensureDir();
  fs.writeFileSync(file, JSON.stringify(value, null, 2), { mode: 0o600 });
}

function loadRegistry(options) {
  const file = (options && options.registryFile) || REGISTRY_FILE;
  const raw = readJson(file, { version: 1, accounts: [] });
  return Array.isArray(raw.accounts) ? raw.accounts : [];
}

function saveRegistry(accounts, options) {
  const file = (options && options.registryFile) || REGISTRY_FILE;
  writeJson(file, { version: 1, updatedAt: new Date().toISOString(), accounts });
}

function loadSecrets(options) {
  const file = (options && options.secretsFile) || SECRETS_FILE;
  return readJson(file, {});
}

function saveSecrets(map, options) {
  const file = (options && options.secretsFile) || SECRETS_FILE;
  writeJson(file, map);
}

const ID_RE = /^[a-z0-9][a-z0-9._-]{1,63}$/;

function validateAccount(account) {
  const errors = [];
  if (!account || typeof account !== 'object') return ['Tài khoản không hợp lệ'];
  if (!ID_RE.test(String(account.id || '')))
    errors.push('id phải là chữ thường, số, . _ - (2-64 ký tự)');
  if (!account.provider) errors.push('thiếu provider');
  // An account declares either one model or a models[] list. Requiring the
  // singular field predates multi-model accounts and rejected every real one.
  const hasModels = Array.isArray(account.models) && account.models.length > 0;
  if (!account.model && !hasModels) errors.push('thiếu model hoặc models[]');
  if (hasModels) {
    account.models.forEach((m, i) => {
      const name = typeof m === 'string' ? m : m && m.model;
      if (!name) errors.push('models[' + i + '] thiếu tên model');
    });
  }

  const caps = account.capabilities || {};
  if (!Number.isFinite(Number(caps.contextWindow)) || Number(caps.contextWindow) <= 0) {
    errors.push('capabilities.contextWindow phải là số dương');
  }
  if (account.tier !== undefined && ![0, 1, 2].includes(Number(account.tier))) {
    errors.push('tier phải là 0 (local), 1 (account) hoặc 2 (external)');
  }

  // A credential that arrives inside the registry object would be written to
  // the readable file. Refuse it rather than silently relocating it.
  for (const forbidden of ['apiKey', 'token', 'accessToken', 'secret', 'password']) {
    if (account[forbidden] !== undefined) {
      errors.push('không được đặt "' + forbidden + '" trong registry — dùng setSecret()');
    }
  }
  return errors;
}

/** Registry entries with secrets reduced to a presence flag. */
function listAccounts(options) {
  const accounts = loadRegistry(options);
  const secrets = loadSecrets(options);
  return accounts.map((a) =>
    Object.assign({}, a, {
      tier: Number(a.tier || 0),
      hasSecret: Boolean(secrets[a.id]),
      // Guards against an older registry written before validation existed.
      apiKey: undefined,
      token: undefined,
    })
  );
}

function addAccount(account, options) {
  const errors = validateAccount(account);
  if (errors.length > 0) {
    const err = new Error('Tài khoản không hợp lệ: ' + errors.join('; '));
    err.details = errors;
    throw err;
  }
  const accounts = loadRegistry(options);
  if (accounts.some((a) => a.id === account.id)) {
    throw new Error('Đã có tài khoản id "' + account.id + '"');
  }
  const entry = Object.assign({ enabled: true, tier: Tier.EXTERNAL, limits: {} }, account);
  accounts.push(entry);
  saveRegistry(accounts, options);
  return entry;
}

function updateAccount(id, patch, options) {
  const accounts = loadRegistry(options);
  const idx = accounts.findIndex((a) => a.id === id);
  if (idx === -1) throw new Error('Không có tài khoản "' + id + '"');
  const merged = Object.assign({}, accounts[idx], patch, { id });
  const errors = validateAccount(merged);
  if (errors.length > 0) throw new Error('Cập nhật không hợp lệ: ' + errors.join('; '));
  accounts[idx] = merged;
  saveRegistry(accounts, options);
  return merged;
}

function removeAccount(id, options) {
  const accounts = loadRegistry(options);
  const next = accounts.filter((a) => a.id !== id);
  saveRegistry(next, options);

  const secrets = loadSecrets(options);
  if (secrets[id]) {
    delete secrets[id];
    saveSecrets(secrets, options);
  }
  return accounts.length !== next.length;
}

function setSecret(id, value, options) {
  if (!value || typeof value !== 'string')
    throw new Error('Giá trị bí mật phải là chuỗi khác rỗng');
  const accounts = loadRegistry(options);
  if (!accounts.some((a) => a.id === id)) throw new Error('Không có tài khoản "' + id + '"');

  const key = (options && options.key) || loadKey(options);
  const secrets = loadSecrets(options);
  secrets[id] = encrypt(value, key);
  saveSecrets(secrets, options);
  return true;
}

/**
 * Returns the decrypted credential. Deliberately the only way to obtain one,
 * so every call site is easy to find and review.
 */
function getSecret(id, options) {
  const secrets = loadSecrets(options);
  if (!secrets[id]) return null;
  const key = (options && options.key) || loadKey(options);
  return decrypt(secrets[id], key);
}

function hasSecret(id, options) {
  return Boolean(loadSecrets(options)[id]);
}

/**
 * Groups accounts into escalation tiers, lowest first.
 * The scheduler walks these in order and only descends when the tier above it
 * has nothing dispatchable left.
 */
function tiersOf(accounts) {
  const byTier = new Map();
  for (const a of accounts) {
    const t = Number(a.tier || 0);
    if (!byTier.has(t)) byTier.set(t, []);
    byTier.get(t).push(a);
  }
  return [...byTier.keys()]
    .sort((x, y) => x - y)
    .map((t) => ({ tier: t, accounts: byTier.get(t) }));
}

module.exports = {
  Tier,
  HOME_DIR,
  REGISTRY_FILE,
  SECRETS_FILE,
  KEY_FILE,
  loadKey,
  listAccounts,
  addAccount,
  updateAccount,
  removeAccount,
  setSecret,
  getSecret,
  hasSecret,
  validateAccount,
  tiersOf,
  loadRegistry,
  saveRegistry,
};
