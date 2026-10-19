'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const evidence = require('../evidence');
const routing = require('../routing');

const launchFault = {
  status: 'failed',
  source: 'launch-failure',
  scope: 'unknown',
  cause: 'unknown',
  stderr: 'writeUsageReportFromHarnessResult is not defined',
};
const harnessFault = { status: 'failed', scope: 'harness', cause: 'launch_config' };
const modelFault = {
  status: 'failed',
  source: 'launch-failure',
  scope: 'model',
  cause: 'alias_mismatch',
};
const workFault = { status: 'failed', source: 'work-item', proofLevel: 'WORK_ITEM_PASS' };

test('launcher and harness faults are not quality failures of the model', () => {
  assert.equal(evidence.isQualityFailure(launchFault), false);
  assert.equal(evidence.isQualityFailure(harnessFault), false);
  assert.equal(evidence.isQualityFailure({ status: 'passed' }), false);
});

test('model-scoped and work failures still count against the model', () => {
  assert.equal(evidence.isQualityFailure(modelFault), true);
  assert.equal(evidence.isQualityFailure(workFault), true);
});

test('reliability ignores launches that never reached the model', () => {
  const reliability = routing.reliabilityScoreOf;
  assert.equal(typeof reliability, 'function');
  assert.equal(reliability({ evidence: [{ status: 'passed' }, launchFault, harnessFault] }), 100);
  assert.equal(reliability({ evidence: [{ status: 'passed' }, workFault] }), 50);
});
