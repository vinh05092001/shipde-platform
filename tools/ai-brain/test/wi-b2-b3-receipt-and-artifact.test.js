'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sourcesApi = require('../sources');
const comboJev = require('../combo-jev-select');
const agyPoolCandidates = require('../agy-pool-candidates');
const { writeReviewManifestAndArtifact } = require('../orchestrate/review-item');
const { candidateKey } = require('../candidates');

function makeQuotaGroups({ gemini = 1.0, claude = 1.0, argon = 1.0 } = {}) {
  return {
    groups: [
      {
        name: 'Gemini Models',
        description: 'Models within this group: Gemini 4 Neon, Gemini 3.8 Flash',
        buckets: [
          { id: 'gemini-weekly', window: 'weekly', remaining_fraction: gemini },
          { id: 'gemini-5h', window: '5h', remaining_fraction: gemini },
        ],
      },
      {
        name: 'Claude and GPT models',
        description: 'Models within this group: Claude Opus 5.5, GPT-OSS 120B',
        buckets: [
          { id: '3p-weekly', window: 'weekly', remaining_fraction: claude },
          { id: '3p-5h', window: '5h', remaining_fraction: claude },
        ],
      },
      {
        name: 'Gemini 4 Argon',
        description: 'Separate Argon bucket',
        buckets: [{ id: 'gemini-argon-wtu-weekly', window: 'weekly', remaining_fraction: argon }],
      },
    ],
  };
}

test('WI-B1 P2 follow-up: buildMemberCandidate and buildAgyMemberCandidate apply modelStemAliases to candidate.modelFamily', () => {
  const reg = sourcesApi.loadSources();
  const built9r = comboJev.buildMemberCandidate(
    { modelId: 'cx/o3-high', base: 'o3', effort: 'high', score: 85, tier: 'T1' },
    { registry: reg, env: { NINEROUTER_API_KEY: 'k' } }
  );
  assert.ok(built9r.candidate);
  assert.equal(built9r.candidate.modelFamily, 'gpt');

  const builtAgy = agyPoolCandidates.buildAgyMemberCandidate(
    {
      modelId: 'agy-pool/o3-high',
      bareModel: 'o3-high',
      accountId: 'agy03',
      bucket: '3p',
      headroom: 0.9,
      headroomStatus: 'open',
    },
    { registry: reg }
  );
  assert.ok(builtAgy.candidate);
  assert.equal(builtAgy.candidate.modelFamily, 'gpt');
});

test('WI-B2: verifyAgyServedIdentity reports group evidence only, never model identity, and fails closed on foreign drain or missing proof', () => {
  // Snapshots at 1900 and 3100 bracket a run from 2000 to 3000.
  const before = { ...makeQuotaGroups({ gemini: 1.0, claude: 0.8, argon: 1.0 }), at: 1900 };
  const afterMatched = { ...makeQuotaGroups({ gemini: 1.0, claude: 0.76, argon: 1.0 }), at: 3100 };
  const receipt = { accountId: 'agy03', jobId: 'agy03/run-1' };
  const common = {
    requestedModel: 'claude-opus-5.5',
    expectedBucket: '3p',
    receipt,
    accountId: 'agy03',
    runStartedAt: 2000,
    runEndedAt: 3000,
  };

  const okRes = agyPoolCandidates.verifyAgyServedIdentity({
    ...common,
    quotaBefore: before,
    quotaAfter: afterMatched,
  });
  assert.equal(okRes.ok, true);
  assert.equal(okRes.verified, false, 'group evidence is not model identity');
  assert.equal(okRes.modelVerified, false);
  assert.equal(okRes.groupVerified, true);
  assert.equal(okRes.servedModel, null);
  assert.equal(okRes.evidenceKind, 'requested+group-delta');
  assert.equal(okRes.delta, 0.04);

  // Zero delta (unchanged bucket) -> fail-closed AGY_GROUP_DELTA_UNOBSERVED
  const unchanged = agyPoolCandidates.verifyAgyServedIdentity({
    ...common,
    quotaBefore: before,
    quotaAfter: { ...before, at: 3100 },
  });
  assert.equal(unchanged.ok, false);
  assert.equal(unchanged.verified, false);
  assert.equal(unchanged.error, 'AGY_GROUP_DELTA_UNOBSERVED');
  assert.equal(unchanged.evidenceKind, 'requested+group-unchanged');

  // Foreign bucket drained (even when expected bucket also drained) -> fail-closed mismatch
  const afterBothDrained = {
    ...makeQuotaGroups({ gemini: 0.92, claude: 0.76, argon: 1.0 }),
    at: 3100,
  };
  const noisy = agyPoolCandidates.verifyAgyServedIdentity({
    ...common,
    quotaBefore: before,
    quotaAfter: afterBothDrained,
  });
  assert.equal(noisy.ok, false);
  assert.equal(noisy.verified, false);
  assert.equal(noisy.error, 'AGY_GROUP_DELTA_MISMATCH');
  assert.equal(noisy.foreignDrainedBucket, 'gemini');

  // Missing quotaAfter -> fail-closed
  const missing = agyPoolCandidates.verifyAgyServedIdentity({
    ...common,
    quotaBefore: before,
    quotaAfter: null,
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.error, 'AGY_QUOTA_PROOF_MISSING');
});

test('WI-B3: writeReviewManifestAndArtifact records Reviewer not run when verification fails before calling reviewer', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-wib3-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const repoDir = path.join(dir, 'repo');
  const outDir = path.join(dir, 'out');
  fs.mkdirSync(repoDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });

  const git = (...args) => {
    const r = cp.spawnSync('git', args, { cwd: repoDir, encoding: 'utf8' });
    assert.equal(r.status, 0);
    return r.stdout.trim();
  };
  git('init');
  git('config', 'user.email', 'test@shipde.local');
  git('config', 'user.name', 'Test');
  fs.writeFileSync(path.join(repoDir, 'f.txt'), '1\n');
  git('add', 'f.txt');
  git('commit', '-m', 'base');
  const baseSha = git('rev-parse', 'HEAD');
  fs.writeFileSync(path.join(repoDir, 'f.txt'), '2\n');
  git('add', 'f.txt');
  git('commit', '-m', 'head');
  const headSha = git('rev-parse', 'HEAD');

  const res = writeReviewManifestAndArtifact({
    dir: outDir,
    repoCwd: repoDir,
    workItemId: 'TASK-AI-187',
    baseSha,
    reviewedSha: headSha,
    writerCandidateKey: candidateKey({
      harness: 'opencode-direct',
      accessPath: 'http://127.0.0.1:20128/v1',
      gateway: '9router',
      upstream: 'bzl',
      accountId: '9router',
      quotaScope: '9router:bzl',
      modelId: 'bzl/glm-5.3',
    }),
    reviewerCandidateKey: candidateKey({
      harness: 'opencode-direct',
      accessPath: 'http://127.0.0.1:20128/v1',
      gateway: '9router',
      upstream: 'gcli',
      accountId: '9router',
      quotaScope: '9router:gcli',
      modelId: 'gcli/grok-4.7',
    }),
    verdict: 'CHANGES_REQUIRED',
    findings: [],
    tests: [{ command: 'node --test', result: 'fail', summary: 'VERIFICATION_EXIT' }],
    roundNumber: 4,
    reviewerNotRunReason: 'VERIFICATION_EXIT',
  });

  assert.ok(res && res.artifactPath);
  const md = fs.readFileSync(res.artifactPath, 'utf8');
  assert.match(md, /Reviewer not run: VERIFICATION_EXIT/);
  assert.doesNotMatch(md, /No open findings\./);

  // Reviewer ran or failed mid-review (e.g. REVIEWER_TIMEOUT) -> 'No reviewer verdict: REVIEWER_TIMEOUT'
  const resTimeout = writeReviewManifestAndArtifact({
    dir: outDir,
    repoCwd: repoDir,
    workItemId: 'TASK-AI-187',
    baseSha,
    reviewedSha: headSha,
    writerCandidateKey: candidateKey({
      harness: 'opencode-direct',
      accessPath: 'http://127.0.0.1:20128/v1',
      gateway: '9router',
      upstream: 'bzl',
      accountId: '9router',
      quotaScope: '9router:bzl',
      modelId: 'bzl/glm-5.3',
    }),
    reviewerCandidateKey: candidateKey({
      harness: 'opencode-direct',
      accessPath: 'http://127.0.0.1:20128/v1',
      gateway: '9router',
      upstream: 'gcli',
      accountId: '9router',
      quotaScope: '9router:gcli',
      modelId: 'gcli/grok-4.7',
    }),
    verdict: 'CHANGES_REQUIRED',
    findings: [],
    tests: [{ command: 'node --test', result: 'pass', summary: 'ok' }],
    roundNumber: 4,
    reviewerNotRunReason: 'REVIEWER_TIMEOUT',
  });
  const mdTimeout = fs.readFileSync(resTimeout.artifactPath, 'utf8');
  assert.match(mdTimeout, /No reviewer verdict: REVIEWER_TIMEOUT/);
  assert.doesNotMatch(mdTimeout, /Reviewer not run:/);
});
