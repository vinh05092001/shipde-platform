'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  dispatchCommand,
  getCandidateRouteHealthRecord,
  candidateExclusionReason,
  isCandidateRouteEligible,
} = require('../cli');
const { candidateKey } = require('../discovery/identity');
const routeHealthApi = require('../route-health');

function makeCandidate(modelId, upstream, accountId = 'acc1', cost = 1, quality = 90) {
  const c = {
    harness: 'hermes',
    accessPath: 'cli',
    gateway: '9router',
    upstream,
    accountId,
    quotaScope: accountId,
    modelId,
    cost,
    quality,
    qualifiedRoles: ['author.foundation'],
  };
  c.candidateKey = candidateKey(c);
  return c;
}

describe('TASK-AI-171: Route-health lookup helper with upstream failure precedence', () => {
  const candidateA = makeCandidate('m-alpha', 'ag');
  const candidateB = makeCandidate('m-beta', 'other-provider', 'acc2', 2, 80);

  test('upstream failure is never masked by gateway AVAILABLE', () => {
    const store = {
      version: 1,
      paths: {
        'm-alpha|9router': { modelId: 'm-alpha', routeId: '9router', status: 'AVAILABLE' },
        'm-alpha|ag': {
          modelId: 'm-alpha',
          routeId: 'ag',
          status: 'UPSTREAM_CREDENTIAL',
          reason: 'No active credentials for provider: ag',
        },
      },
      events: [],
    };

    const rec = getCandidateRouteHealthRecord(store, candidateA, routeHealthApi);
    assert.ok(rec);
    assert.equal(rec.status, 'UPSTREAM_CREDENTIAL');

    const eligible = isCandidateRouteEligible(
      store,
      candidateA,
      { allowUnprobedCandidates: true },
      routeHealthApi
    );
    assert.equal(eligible, false);

    const reason = candidateExclusionReason(store, candidateA, routeHealthApi);
    assert.equal(reason, 'UPSTREAM_CREDENTIAL');
  });

  test('precedence rule: newer scoped failure beats stale AVAILABLE (unavailable wins)', () => {
    const storeRev = {
      version: 1,
      paths: {
        'm-alpha|ag': {
          modelId: 'm-alpha',
          routeId: 'ag',
          status: 'COOLDOWN',
          reason: 'Transient 503',
        },
        'm-alpha|9router': { modelId: 'm-alpha', routeId: '9router', status: 'AVAILABLE' },
      },
      events: [],
    };
    const rec = getCandidateRouteHealthRecord(storeRev, candidateA, routeHealthApi);
    assert.ok(rec);
    assert.equal(rec.status, 'COOLDOWN');
  });

  test('no whole-gateway block: unrelated upstream on same gateway remains eligible', () => {
    const store = {
      version: 1,
      paths: {
        'm-alpha|9router': { modelId: 'm-alpha', routeId: '9router', status: 'AVAILABLE' },
        'm-alpha|ag': {
          modelId: 'm-alpha',
          routeId: 'ag',
          status: 'UPSTREAM_CREDENTIAL',
        },
        'm-beta|9router': { modelId: 'm-beta', routeId: '9router', status: 'AVAILABLE' },
      },
      events: [],
    };

    // Candidate A (upstream ag) is blocked
    assert.equal(
      isCandidateRouteEligible(
        store,
        candidateA,
        { allowUnprobedCandidates: true },
        routeHealthApi
      ),
      false
    );

    // Candidate B (upstream other-provider on same 9router gateway) remains eligible
    assert.equal(
      isCandidateRouteEligible(
        store,
        candidateB,
        { allowUnprobedCandidates: true },
        routeHealthApi
      ),
      true
    );
  });

  test('dry-run dispatch excludes candidate A with upstream reason and chooses candidate B', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hlookup-'));
    try {
      const hFile = path.join(dir, 'h.json');
      const qFile = path.join(dir, 'q.json');
      fs.writeFileSync(qFile, '{}');
      routeHealthApi.saveStore(hFile, {
        version: 1,
        paths: {
          'm-alpha|9router': { modelId: 'm-alpha', routeId: '9router', status: 'AVAILABLE' },
          'm-alpha|ag': {
            modelId: 'm-alpha',
            routeId: 'ag',
            status: 'UPSTREAM_CREDENTIAL',
            reason: 'No active credentials for provider: ag',
          },
          'm-beta|9router': { modelId: 'm-beta', routeId: '9router', status: 'AVAILABLE' },
        },
        events: [],
      });

      const res = dispatchCommand(
        { 'dry-run': true, json: true, item: 'TASK-AI-171-TEST' },
        {
          candidates: [candidateA, candidateB],
          now: Date.now(),
          quotaStateFile: qFile,
          routeHealthFile: hFile,
          home: dir,
          decisionDir: dir,
          evidenceDir: dir,
          allowUnprobedCandidates: true,
          exit: () => {},
          log: () => {},
        }
      );

      const rej = res?.decision?.rejected?.find((r) => r.offeringId === candidateA.candidateKey);
      assert.equal(rej?.reason, 'UPSTREAM_CREDENTIAL');
      assert.equal(res?.decision?.chosen, candidateB.candidateKey);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
