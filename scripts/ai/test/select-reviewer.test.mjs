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

  it('disqualifies reviewer sharing writer upstream, account, model, or gateway (BLOCKED)', () => {
    const sameUpstream = {
      harness: 'cli-harness-b',
      accessPath: 'path-direct',
      gateway: 'gw-two',
      upstream: 'upstream-alpha',
      account: 'acc-reviewer-02',
      quotaScope: 'scope-b',
      modelId: 'synthetic-model-y',
    };
    const sameAccount = {
      harness: 'cli-harness-b',
      accessPath: 'path-direct',
      gateway: 'gw-two',
      upstream: 'upstream-beta',
      account: 'acc-author-01',
      quotaScope: 'scope-b',
      modelId: 'synthetic-model-y',
    };
    const sameModel = {
      harness: 'cli-harness-b',
      accessPath: 'path-direct',
      gateway: 'gw-two',
      upstream: 'upstream-beta',
      account: 'acc-reviewer-02',
      quotaScope: 'scope-b',
      modelId: 'synthetic-model-x',
    };
    const sameGateway = {
      harness: 'cli-harness-b',
      accessPath: 'path-direct',
      gateway: 'gw-one',
      upstream: 'upstream-beta',
      account: 'acc-reviewer-02',
      quotaScope: 'scope-b',
      modelId: 'synthetic-model-y',
    };

    assert.equal(checkIndependence(parseCandidate(writerCandidate), parseCandidate(sameUpstream)).independent, false);
    assert.ok(checkIndependence(parseCandidate(writerCandidate), parseCandidate(sameUpstream)).reason.includes('SAME_UPSTREAM'));
    assert.equal(checkIndependence(parseCandidate(writerCandidate), parseCandidate(sameAccount)).independent, false);
    assert.ok(checkIndependence(parseCandidate(writerCandidate), parseCandidate(sameAccount)).reason.includes('SAME_ACCOUNT'));
    assert.equal(checkIndependence(parseCandidate(writerCandidate), parseCandidate(sameModel)).independent, false);
    assert.ok(checkIndependence(parseCandidate(writerCandidate), parseCandidate(sameModel)).reason.includes('SAME_MODEL'));
    assert.equal(checkIndependence(parseCandidate(writerCandidate), parseCandidate(sameGateway)).independent, false);
    assert.ok(checkIndependence(parseCandidate(writerCandidate), parseCandidate(sameGateway)).reason.includes('SAME_GATEWAY'));

    const result = selectReviewer({
      writer: writerCandidate,
      candidates: [sameUpstream, sameAccount, sameModel, sameGateway],
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.verdict, 'BLOCKED');
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

  it('reports stub status "chưa nối" when selection API is not merged (BLOCKED)', () => {
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
