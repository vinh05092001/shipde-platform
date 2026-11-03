import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../..', import.meta.url));

const python = ['python', 'python3'].find(
  (cmd) => spawnSync(cmd, ['--version'], { encoding: 'utf8' }).status === 0
);

test('TASK-AI-164 delivery order does not collide with merged Work Items', () => {
  const registerPath = resolve(
    root,
    'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv'
  );
  const registerText = readFileSync(registerPath, 'utf8');
  const lines = registerText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const rows = lines.slice(1).map((line) => {
    const match = line.match(/^"(\d+)",(?:"[^"]*",){2}"([^"]+)"/);
    return { order: match ? match[1] : null, workItemId: match ? match[2] : null };
  });
  const orders = rows.map((r) => r.order).filter(Boolean);
  assert.equal(
    orders.length,
    new Set(orders).size,
    'Delivery orders in register must be strictly unique to prevent validate_docs failure'
  );
  const item164 = rows.find((r) => r.workItemId === 'TASK-AI-164');
  assert.ok(item164, 'TASK-AI-164 must exist in register');
  assert.ok(item164.order, 'TASK-AI-164 must have a valid delivery order');

  if (python) {
    const result = spawnSync(
      python,
      ['-B', 'docs/product-spec/scripts/validate_docs.py'],
      { cwd: root, encoding: 'utf8' }
    );
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }
});
