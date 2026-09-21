'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_POOL_SIZE = 4;

function poolRoot(env = process.env) {
  return path.resolve(env.SHIPDE_AGY_POOL_ROOT || path.join(os.homedir(), '.shipde', 'agy-pool'));
}

function buildProfiles(env = process.env) {
  const root = poolRoot(env);
  return Array.from({ length: DEFAULT_POOL_SIZE }, (_, index) => {
    const number = index + 1;
    return {
      id: `agy-${number}`,
      label: `Gemini Worker ${number}`,
      home: path.join(root, 'profiles', `agy-${number}`),
    };
  });
}

function ensureProfiles(profiles) {
  for (const profile of profiles) {
    fs.mkdirSync(path.join(profile.home, '.gemini', 'antigravity-cli'), { recursive: true });
  }
}

function authEvidence(profile) {
  const candidates = [
    path.join(profile.home, '.gemini', 'oauth_creds.json'),
    path.join(profile.home, '.gemini', 'google_accounts.json'),
    path.join(profile.home, '.gemini', 'antigravity-cli', 'oauth_token'),
    path.join(profile.home, 'antigravity-oauth-token'),
    path.join(profile.home, 'jetski-standalone-oauth-token'),
    path.join(profile.home, 'oauth_token'),
    path.join(profile.home, 'google_accounts.json'),
  ];
  const present = candidates.filter((candidate) => {
    try {
      return fs.statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
  return {
    state: present.length > 0 ? 'credential-present' : 'login-required',
    evidenceCount: present.length,
  };
}

function publicProfile(profile, runtime = null) {
  const auth = authEvidence(profile);
  return {
    id: profile.id,
    label: profile.label,
    home: profile.home,
    authState: auth.state,
    authEvidenceCount: auth.evidenceCount,
    runtime,
  };
}

function resolveProfile(profiles, profileId) {
  const profile = profiles.find((candidate) => candidate.id === profileId);
  if (!profile) throw new Error(`Unknown Agy profile: ${profileId}`);
  return profile;
}

function appendAudit(root, record) {
  const auditDir = path.join(root, 'audit');
  fs.mkdirSync(auditDir, { recursive: true });
  fs.appendFileSync(
    path.join(auditDir, 'agy-pool.jsonl'),
    `${JSON.stringify({ ...record, observedAt: new Date().toISOString() })}\n`,
    { encoding: 'utf8' }
  );
}

module.exports = {
  DEFAULT_POOL_SIZE,
  appendAudit,
  authEvidence,
  buildProfiles,
  ensureProfiles,
  poolRoot,
  publicProfile,
  resolveProfile,
};
