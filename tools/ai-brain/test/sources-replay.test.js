'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  onboardSource,
  replayAllSources,
  verifyFixtureSanitization,
  DEFAULT_FIXTURES_DIR,
} = require('../source-onboarding');

describe('TASK-AI-142: Sources replay regression suite', () => {
  test('all source fixture directories pass secret and forbidden word sanitization', () => {
    assert.ok(fs.existsSync(DEFAULT_FIXTURES_DIR), 'fixtures/sources directory must exist');
    const entries = fs.readdirSync(DEFAULT_FIXTURES_DIR, { withFileTypes: true });
    const sourceDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    assert.ok(sourceDirs.length > 0, 'at least one source fixture directory must exist');

    for (const dirName of sourceDirs) {
      const dirPath = path.join(DEFAULT_FIXTURES_DIR, dirName);
      // Must not throw Sanitization violation
      assert.doesNotThrow(
        () => verifyFixtureSanitization(dirPath),
        `Fixture directory ${dirName} must be free of sk-, bearer, @, or token substrings`
      );
    }
  });

  test('replaying 9router from recorded fixtures matches expected.json without network calls', async () => {
    const dir = path.join(DEFAULT_FIXTURES_DIR, '9router');
    assert.ok(fs.existsSync(dir), '9router fixture dir must exist');
    const expected = JSON.parse(fs.readFileSync(path.join(dir, 'expected.json'), 'utf8'));

    // Passing a throwing fetch guarantees no network access happens during replay
    const throwingFetch = () => {
      throw new Error('NETWORK CALL FORBIDDEN DURING REPLAY');
    };

    const outcome = await onboardSource('9router', {
      replay: true,
      record: false,
      fixturesDir: dir,
      fetch: throwingFetch,
    });

    // Step 1 check
    assert.equal(outcome.step1_attach.sourceId, expected.step1_attach.sourceId);
    assert.equal(outcome.step1_attach.endpoint, expected.step1_attach.endpoint);
    assert.equal(outcome.step1_attach.envVar, expected.step1_attach.envVar);

    // Step 2 check
    assert.equal(outcome.step2_models.total, expected.step2_models.total);
    assert.equal(outcome.step2_models.ok, expected.step2_models.ok);

    // Step 3 check
    assert.equal(outcome.step3_probe.probed, expected.step3_probe.probed);
    assert.equal(outcome.step3_probe.live, expected.step3_probe.live);
    assert.equal(outcome.step3_probe.failed, expected.step3_probe.failed);

    // Step 4 & 6 model summary check
    assert.deepEqual(outcome.models, expected.models);

    // Controller visibility count
    const liveExpectedCount = Object.values(expected.models).filter((m) => m.live).length;
    const rankedExpectedCount = Object.values(expected.models).filter((m) => m.inRanking).length;
    const liveActualCount = Object.values(outcome.models).filter((m) => m.live).length;
    const rankedActualCount = Object.values(outcome.models).filter((m) => m.inRanking).length;

    assert.equal(liveActualCount, liveExpectedCount);
    assert.equal(rankedActualCount, rankedExpectedCount);
  });

  test('replayAllSources replays every attached source fixture without network calls', async () => {
    const throwingFetch = () => {
      throw new Error('NETWORK CALL FORBIDDEN DURING REPLAY');
    };

    const all = await replayAllSources({
      fetch: throwingFetch,
    });

    assert.ok(Array.isArray(all));
    assert.ok(all.length >= 1, 'at least 9router should be present in all sources replay');

    const routerEntry = all.find((r) => r.sourceId === '9router');
    assert.ok(routerEntry, '9router must be among replayed sources');
    assert.equal(routerEntry.matchesExpected, true, '9router replay must match expected.json');
  });
});
