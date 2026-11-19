const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runOrchestration } = require('../orchestrate');
const { candidateKey } = require('../discovery/identity');
for (const mode of ['rounds', 'duration'])
  test('deadline wrapping preserves a missing launcher refusal', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'item-no-launcher-'));
    try {
      const result = await runOrchestration('fixture without launcher', {
        cwd: root,
        decisionDir: path.join(root, 'decisions'),
        evidenceDir: path.join(root, 'evidence'),
        registry: { sources: [] },
        candidates: [],
        specs: [{ id: 'FIXTURE-NO-LAUNCHER', files: [] }],
      });
      assert.match(result.outcomes[0].reason, /^LAUNCHER_MISSING:/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
