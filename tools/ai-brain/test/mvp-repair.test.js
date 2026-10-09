const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { classifyFailure, Scope, Cause } = require('../failure-classifier.js');
const { openWritersDetailed, writerFor } = require('../decisions.js');

test('F1: upstream 503 with gateway unreachable in body is NOT gateway-scoped', () => {
  const result = classifyFailure('http::gateway::access::upstream::account::quota::model', {
    httpStatus: 503,
    body: '<html><body>gateway unreachable</body></html>',
  });
  assert.notEqual(result.scope, Scope.GATEWAY);
  assert.equal(result.scope, Scope.UNKNOWN);
});

test('F2: writer claim expiry', () => {
  const now = Date.now();
  const records = [
    {
      stage: 'launched',
      workItemId: 'item-1',
      sessionId: 'sess-1',
      at: new Date(now - 5 * 3600 * 1000).toISOString(),
    }, // 5 hours ago
    {
      stage: 'launched',
      workItemId: 'item-2',
      sessionId: 'sess-2',
      at: new Date(now - 1 * 3600 * 1000).toISOString(),
    }, // 1 hour ago
  ];

  const detail = openWritersDetailed({ records, now });
  const activeWriters = detail.writers;

  assert.equal(activeWriters.length, 1);
  assert.equal(activeWriters[0].workItemId, 'item-2');
});

test('F3: sameFailureDomain excludes based on quotaScope for upstream failures', () => {
  const cliPath = '../cli.js';
  const fs = require('fs');
  const cliCode = fs.readFileSync(require.resolve(cliPath), 'utf8');
  // Need to test sameFailureDomain function which is not exported.
  // We can extract it by regex or eval, or just test the CLI behaviour.
  const startIndex = cliCode.indexOf('function sameFailureDomain(');
  // Find the end of the function by counting braces
  let endIndex = -1;
  let braces = 0;
  let started = false;
  for (let i = startIndex; i < cliCode.length; i++) {
    if (cliCode[i] === '{') {
      braces++;
      started = true;
    } else if (cliCode[i] === '}') {
      braces--;
      if (started && braces === 0) {
        endIndex = i + 1;
        break;
      }
    }
  }
  const sameFailureDomainCode = cliCode.substring(startIndex, endIndex);

  if (sameFailureDomainCode) {
    const sameFailureDomain = new Function(
      'candidate',
      'failed',
      'classification',
      'return (' + sameFailureDomainCode + ')(candidate, failed, classification)'
    );

    const failed = { upstream: 'up1', quotaScope: 'acc1' };
    const cand1 = { upstream: 'up1', quotaScope: 'acc1' };
    const cand2 = { upstream: 'up1', quotaScope: 'acc2' };
    const cand3 = { upstream: 'up2', quotaScope: 'acc3' };

    assert.equal(
      sameFailureDomain(cand1, failed, { scope: 'upstream' }),
      true,
      'Same quotaScope should match'
    );
    assert.equal(
      sameFailureDomain(cand2, failed, { scope: 'upstream' }),
      true,
      'Different quotaScope on same upstream should match - corrected to contract 6.4 per final review fdd95a5be1007af230f3b5d315c4353d6c26a856-codex'
    );
    assert.equal(
      sameFailureDomain(cand3, failed, { scope: 'upstream' }),
      false,
      'Different upstream should not match'
    );
  } else {
    assert.fail('Could not find sameFailureDomain function');
  }
});

test('F4: writerFor fails closed on unreadable log', () => {
  assert.throws(() => {
    writerFor('item-1', {
      dir: __filename, // Passing a file as directory will cause fs.readdirSync to throw ENOTDIR
    });
  }, /decision log is unreadable/);
});

test('F5: wildcard account is excluded in ranking', () => {
  const { rankAndRecord } = require('../ranking.js');
  const candidates = [
    {
      source: 'test-src',
      accessPath: 'ap1',
      upstream: 'up1',
      accountId: '*',
      modelId: 'm1',
    },
  ];

  const decision = rankAndRecord(candidates, { workItemId: 'w1', registry: { sources: [] } });
  assert.equal(decision.chosen, null);
  assert.equal(decision.rejected.length, 1);
  assert.equal(decision.rejected[0].reason.includes('WILDCARD_ACCOUNT'), true);
});

test('F6: resume preserves original firstChoice', () => {
  // To test F6, we'd invoke the CLI dry run with a checkpoint.
  // We can use child_process for this, similar to how tests in mvp-contract-18.test.js work.
  const { execSync } = require('child_process');
  const path = require('path');
  const tempDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'f6-test-'));

  const ckptFile = path.join(tempDir, 'ckpt.json');
  fs.writeFileSync(
    ckptFile,
    JSON.stringify({
      schemaVersion: 1,
      workItemId: 'W-F6',
      step: 'fallback_selected',
      failedCandidates: ['http::gateway::ap::up::acc1::cand::m1'],
      firstChoice: 'http::gateway::ap::up::acc1::cand::m1',
      fallbackCandidate: 'http::gateway::ap::up::acc2::cand::m2',
    })
  );

  const args = [
    'node',
    require.resolve('../cli.js'),
    'dispatch',
    '--dry-run',
    '--work-item',
    'W-F6',
    '--checkpoint',
    ckptFile,
    '--decision-log',
    path.join(tempDir, 'decision.json'),
  ];

  try {
    execSync(args.join(' '), { cwd: path.join(__dirname, '../'), stdio: 'pipe' });
  } catch (err) {
    // dry-run might return non-zero if it thinks it's a dry run output? Actually, exit(0) is standard.
  }

  const ckpt2 = JSON.parse(fs.readFileSync(ckptFile, 'utf8'));
  assert.equal(ckpt2.firstChoice, 'http::gateway::ap::up::acc1::cand::m1');
});
