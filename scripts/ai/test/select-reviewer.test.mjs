import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  selectReviewer,
  parseCandidate,
  checkIndependence,
  getSelectionApiStub,
} from '../select-reviewer.mjs';

describe('select-reviewer', () => {
  const writerCandidate = {
    harness: 'cli-harness-a',
    accessPath: 'path-direct',
    gateway: 'gw-one',
    upstream: 'upstream-alpha',
    account: 'acc-author-01',
    quotaScope: 'scope-a',
    modelId: 'synthetic-model-x',
    candidateKey: 'cli-harness-a::path-direct::gw-one::upstream-alpha::acc-author-01::scope-a::synthetic-model-x',
  };

  it('disqualifies reviewer sharing the same upstream', () => {
    const reviewerSameUpstream = {
      harness: 'cli-harness-b',
      accessPath: 'path-direct',
      gateway: 'gw-two',
      upstream: 'upstream-alpha', // same upstream
      account: 'acc-reviewer-02',
      quotaScope: 'scope-b',
      modelId: 'synthetic-model-y',
    };

    const check = checkIndependence(parseCandidate(writerCandidate), parseCandidate(reviewerSameUpstream));
    assert.equal(check.independent, false);
    assert.ok(check.reason.includes('SAME_UPSTREAM'), `Reason should mention SAME_UPSTREAM: ${check.reason}`);

    const result = selectReviewer({
      writer: writerCandidate,
      candidates: [reviewerSameUpstream],
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.verdict, 'BLOCKED');
    assert.ok(result.reason.includes('SAME_UPSTREAM'));
  });

  it('disqualifies reviewer sharing the same account, model, or gateway', () => {
    const reviewerSameAccount = {
      harness: 'cli-harness-b',
      accessPath: 'path-direct',
      gateway: 'gw-two',
      upstream: 'upstream-beta',
      account: 'acc-author-01', // same account
      quotaScope: 'scope-b',
      modelId: 'synthetic-model-y',
    };
    const resAccount = checkIndependence(parseCandidate(writerCandidate), parseCandidate(reviewerSameAccount));
    assert.equal(resAccount.independent, false);
    assert.ok(resAccount.reason.includes('SAME_ACCOUNT'));

    const reviewerSameModel = {
      harness: 'cli-harness-b',
      accessPath: 'path-direct',
      gateway: 'gw-two',
      upstream: 'upstream-beta',
      account: 'acc-reviewer-02',
      quotaScope: 'scope-b',
      modelId: 'synthetic-model-x', // same model
    };
    const resModel = checkIndependence(parseCandidate(writerCandidate), parseCandidate(reviewerSameModel));
    assert.equal(resModel.independent, false);
    assert.ok(resModel.reason.includes('SAME_MODEL'));

    const reviewerSameGateway = {
      harness: 'cli-harness-b',
      accessPath: 'path-direct',
      gateway: 'gw-one', // same gateway
      upstream: 'upstream-beta',
      account: 'acc-reviewer-02',
      quotaScope: 'scope-b',
      modelId: 'synthetic-model-y',
    };
    const resGateway = checkIndependence(parseCandidate(writerCandidate), parseCandidate(reviewerSameGateway));
    assert.equal(resGateway.independent, false);
    assert.ok(resGateway.reason.includes('SAME_GATEWAY'));
  });

  it('selects an independent reviewer candidate successfully', () => {
    const independentReviewer = {
      harness: 'cli-harness-b',
      accessPath: 'path-alt',
      gateway: 'gw-two',
      upstream: 'upstream-beta',
      account: 'acc-reviewer-02',
      quotaScope: 'scope-b',
      modelId: 'synthetic-model-y',
      qualifiedRoles: ['reviewer'],
    };

    const result = selectReviewer({
      writer: writerCandidate,
      candidates: [independentReviewer],
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, 'SELECTED');
    assert.equal(result.reviewer.upstream, 'upstream-beta');
    assert.equal(result.reviewer.account, 'acc-reviewer-02');
  });

  it('returns BLOCKED when no candidates remain in the pool', () => {
    const result = selectReviewer({
      writer: writerCandidate,
      candidates: [],
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.verdict, 'BLOCKED');
    assert.ok(result.reason.includes('NO_REVIEWER_CANDIDATE'));
  });

  it('reports stub status "chưa nối" when selection API is not merged', () => {
    const stub = getSelectionApiStub();
    assert.equal(stub.status, 'UNCONNECTED');
    assert.ok(stub.note.includes('chưa nối'));

    const result = selectReviewer({
      writer: writerCandidate,
      selectionApi: stub,
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 'BLOCKED');
    assert.ok(result.reason.includes('chưa nối'));
  });
});
