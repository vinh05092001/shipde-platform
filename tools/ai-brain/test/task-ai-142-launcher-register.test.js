'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ensureGoalRegistrationInWorker } = require('../isolation-launcher');

for (const eol of ['\n', '\r\n']) {
  for (const existing of ['header', 'dependencies', 'prefix', 'exact']) {
    test(`launcher copies only the exact register item (${JSON.stringify(eol)}, ${existing})`, (t) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-register-'));
      t.after(() => fs.rmSync(root, { recursive: true, force: true }));
      const regRel = path.join(
        'docs',
        'product-spec',
        'docs',
        '10-ai-collaboration',
        'FEATURE-DELIVERY-REGISTER.csv'
      );
      const host = path.join(root, 'host');
      const worker = path.join(root, 'worker');
      const header = '"dependencies","work_item_id","feature_name"';
      const item1 = '"","GOAL-X-1","Name, with ""quotes""' + eol + 'and a newline"';
      const item2 = '"GOAL-X-1","GOAL-X-2","Second"';
      const item10 = '"GOAL-X-1","GOAL-X-10","Tenth"';
      const rows = { header: [], dependencies: [item2, item10], prefix: [item10], exact: [item1] };
      const before = [header, ...rows[existing]].join(eol);
      for (const [dir, content] of [
        [host, [header, item2, item10, item1].join(eol) + eol],
        [worker, before],
      ]) {
        const file = path.join(dir, regRel);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content);
      }

      ensureGoalRegistrationInWorker(host, worker, 'GOAL-X-1');
      const expected = existing === 'exact' ? before : before + eol + item1 + eol;
      assert.equal(fs.readFileSync(path.join(worker, regRel), 'utf8'), expected);
      ensureGoalRegistrationInWorker(host, worker, 'GOAL-X-1');
      assert.equal(fs.readFileSync(path.join(worker, regRel), 'utf8'), expected);
    });
  }
}
