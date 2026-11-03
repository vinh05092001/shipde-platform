import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../..', import.meta.url));

test('TASK-AI-164 delivery order does not collide with merged Work Items', () => {
  const result = spawnSync(
    process.platform === 'win32' ? 'python' : 'python3',
    ['-B', 'docs/product-spec/scripts/validate_docs.py'],
    { cwd: root, encoding: 'utf8' }
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
