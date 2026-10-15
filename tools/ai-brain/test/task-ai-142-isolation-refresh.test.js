'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { assertIsolationFresh, ISOLATION_VERDICT_MAX_AGE_MS } = require('../intake');

for (const scenario of ['stale-valid', 'runner-fails', 'not-closed', 'fresh', 'missing-valid']) {
  test(`isolation refresh: ${scenario}`, (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'isolation-refresh-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const verdictPath = path.join(root, 'verdict.json');
    const now = Date.now();
    if (scenario !== 'missing-valid') {
      fs.writeFileSync(verdictPath, JSON.stringify({ verdict: 'CLOSED' }));
      if (scenario !== 'fresh') {
        const old = new Date(now - ISOLATION_VERDICT_MAX_AGE_MS * 2);
        fs.utimesSync(verdictPath, old, old);
      }
    }
    let calls = 0;
    const options = {
      root,
      verdictPath,
      now,
      stat: fs.statSync,
      isAncestorOf: () => true,
      decisionDir: path.join(root, 'decisions'),
      refreshRunner(command, args, config) {
        calls++;
        assert.equal(command, 'powershell');
        assert.deepEqual(args, [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          path.join(root, 'scripts/ai/isolation/Test-WorkerIsolation.ps1'),
        ]);
        assert.equal(config.cwd, root);
        assert.ok(config.timeout > 0);
        if (scenario === 'runner-fails') return { status: 7, stderr: 'verifier refused' };
        fs.writeFileSync(
          verdictPath,
          JSON.stringify({ verdict: scenario === 'not-closed' ? 'PARTIAL' : 'CLOSED' })
        );
        fs.utimesSync(verdictPath, new Date(now), new Date(now));
        return { status: 0, stderr: '' };
      },
    };
    if (scenario === 'runner-fails') {
      assert.throws(
        () => assertIsolationFresh(options),
        (error) =>
          error.code === 'ISOLATION_VERDICT_STALE' &&
          error.refreshExitCode === 7 &&
          /verifier refused/.test(error.message)
      );
    } else if (scenario === 'not-closed') {
      assert.throws(() => assertIsolationFresh(options), { code: 'ISOLATION_VERDICT_NOT_CLOSED' });
    } else {
      assert.doesNotThrow(() => assertIsolationFresh(options));
    }
    assert.equal(calls, scenario === 'fresh' ? 0 : 1);
    if (calls) {
      const records = fs
        .readdirSync(options.decisionDir)
        .map((file) => fs.readFileSync(path.join(options.decisionDir, file), 'utf8'))
        .join('');
      assert.match(
        records,
        new RegExp(
          scenario === 'runner-fails' || scenario === 'not-closed'
            ? 'ISOLATION_VERDICT_REFRESH_FAILED'
            : 'ISOLATION_VERDICT_REFRESHED'
        )
      );
    }
  });
}
