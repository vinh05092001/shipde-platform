'use strict';

// TASK-AI-232: the PR contract scales evidence to the risk of the change.
// Tier A (maintenance) needs no Work Item file or register row; Tier B keeps
// the full Work Item contract. Each case runs the real Python validator in a
// disposable Git repository with an immutable base commit.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repo = path.resolve(__dirname, '..', '..', '..');
const VALIDATOR = 'docs/product-spec/scripts/validate_pr_contract.py';
const POLICY = 'docs/product-spec/scripts/pr_contract_policy.json';
const REGISTER = 'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv';
const python = ['python', 'python3'].find(
  (cmd) => spawnSync(cmd, ['--version'], { encoding: 'utf8' }).status === 0
);

const HEADER =
  '"delivery_order","slice","group","work_item_id","feature_id","feature_name","key_behavior","status","dependencies","work_item_path","branch","pr","codex_verdict","merge_commit"';
const row = (order, id, status, wiPath, pr = '', merge = '') =>
  [order, 'S00', 'AI workflow', id, '', 'n', 'k', status, '', wiPath, 'b', pr, '', merge]
    .map((v) => `"${v}"`)
    .join(',');

const MAINTENANCE_BODY =
  '## Goal\nRemove shipped history.\n\n## Scope\nOnly listed files.\n\n## Verification\nvalidators pass\n\nReview status: READY_FOR_CODEX\n';
const WORK_ITEM_BODY = (id) =>
  [
    '## Work Item',
    id,
    '## Source requirements',
    '## Scope integrity',
    '## Implementation',
    '## Acceptance evidence',
    '## Verification',
    '## Safety and recovery',
    '## Documentation and traceability',
    '## Risks and limitations',
    '## Codex review',
    'Review status: READY_FOR_CODEX',
  ].join('\n');

function makeRepo({ withPolicy = true, policyText } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-contract-232-'));
  const g = (...args) => {
    const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    return r.stdout.trim();
  };
  const write = (rel, content) => {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };
  const remove = (rel) => fs.rmSync(path.join(dir, rel));
  g('init', '-q', '-b', 'main');
  g('config', 'user.name', 'Contract Test');
  g('config', 'user.email', 'contract@example.invalid');
  g('config', 'core.autocrlf', 'false');
  write(VALIDATOR, fs.readFileSync(path.join(repo, VALIDATOR)));
  if (withPolicy) write(POLICY, policyText ?? fs.readFileSync(path.join(repo, POLICY)));
  write(
    REGISTER,
    [
      HEADER,
      row(1, 'TASK-AI-1', 'MERGED', 'docs/product-spec/work-items/TASK-AI-1.md', '10', 'a1'),
      row(2, 'TASK-AI-2', 'SUPERSEDED', 'docs/product-spec/work-items/TASK-AI-2.md'),
      row(3, 'TASK-AI-3', 'READY_FOR_AUTHOR', 'docs/product-spec/work-items/TASK-AI-3.md'),
    ].join('\n') + '\n'
  );
  for (const n of [1, 2, 3])
    write(`docs/product-spec/work-items/TASK-AI-${n}.md`, `# TASK-AI-${n}\n`);
  write('docs/notes.md', 'old note\n');
  write('apps/api/src/auth.ts', 'export const a = 1;\n');
  write('.github/workflows/ci.yml', 'name: ci\n');
  g('add', '-A');
  g('commit', '-qm', 'base');
  const base = g('rev-parse', 'HEAD');
  g('checkout', '-q', '-b', 'pr');
  const clearPaths = (ids) => {
    const text = fs.readFileSync(path.join(dir, REGISTER), 'utf8');
    let out = text;
    for (const id of ids) out = out.replace(`"docs/product-spec/work-items/${id}.md"`, '""');
    write(REGISTER, out);
  };
  const run = (title, body) => {
    g('add', '-A');
    g('commit', '-qm', 'change', '--allow-empty');
    const head = g('rev-parse', 'HEAD');
    const event = path.join(dir, 'event.json');
    fs.writeFileSync(
      event,
      JSON.stringify({
        pull_request: { title, body, base: { ref: 'main', sha: base }, head: { sha: head } },
      })
    );
    const res = spawnSync(python, [path.join(dir, VALIDATOR), '--event', event], {
      cwd: dir,
      encoding: 'utf8',
    });
    fs.rmSync(event);
    return { status: res.status, out: res.stdout + res.stderr };
  };
  const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
  return { dir, g, write, remove, clearPaths, run, cleanup };
}

function scenario(name, fn) {
  test(name, { skip: !python }, () => {
    const r = makeRepo();
    try {
      fn(r);
    } finally {
      r.cleanup();
    }
  });
}

scenario('AC3: a docs-only maintenance PR passes with no Work Item file or register row', (r) => {
  r.write('docs/notes.md', 'new note\n');
  const res = r.run('docs: refresh the operator notes', MAINTENANCE_BODY);
  assert.equal(res.status, 0, res.out);
  assert.match(res.out, /Tier A/);
});

scenario('AC3: maintenance evidence sections are required', (r) => {
  r.write('docs/notes.md', 'new note\n');
  const res = r.run(
    'docs: refresh the operator notes',
    'Some text\nReview status: READY_FOR_CODEX'
  );
  assert.equal(res.status, 1);
  assert.match(res.out, /missing or empty maintenance PR section: ## Goal/);
});

scenario('AC4: deleting terminal Work Items and clearing exactly their paths passes', (r) => {
  r.remove('docs/product-spec/work-items/TASK-AI-1.md');
  r.remove('docs/product-spec/work-items/TASK-AI-2.md');
  r.clearPaths(['TASK-AI-1', 'TASK-AI-2']);
  const res = r.run('chore: delete shipped Work Items', MAINTENANCE_BODY);
  assert.equal(res.status, 0, res.out);
  assert.match(res.out, /Tier A/);
});

scenario('AC2: chore title editing apps/api is Tier B and fails without a Work Item', (r) => {
  r.write('apps/api/src/auth.ts', 'export const a = 2;\n');
  const res = r.run('chore: tidy auth', MAINTENANCE_BODY);
  assert.equal(res.status, 1);
  assert.match(res.out, /Tier B: protected path: apps\/api\/src\/auth.ts/);
});

scenario('AC2: docs title editing .github is Tier B', (r) => {
  r.write('.github/workflows/ci.yml', 'name: ci2\n');
  const res = r.run('docs: fix workflow comment', MAINTENANCE_BODY);
  assert.equal(res.status, 1);
  assert.match(res.out, /Tier B: protected path: \.github/);
});

scenario('AC2: renaming a workflow into docs is Tier B (old path is protected)', (r) => {
  r.g('mv', '.github/workflows/ci.yml', 'docs/ci.yml');
  const res = r.run('docs: move workflow note', MAINTENANCE_BODY);
  assert.equal(res.status, 1);
  assert.match(res.out, /Tier B: protected path: \.github\/workflows\/ci.yml/);
});

scenario('AC2: copying a workflow into docs is Tier B', (r) => {
  r.write('docs/ci-copy.yml', 'name: ci\n');
  const res = r.run('docs: copy workflow', MAINTENANCE_BODY);
  // Copies are detected with their source path (--find-copies-harder); the protected source forces Tier B.
  assert.equal(res.status, 1);
  assert.match(res.out, /Tier B/);
});

scenario('AC2: copying docs into a new workflow is Tier B', (r) => {
  r.write('.github/workflows/notes.yml', 'old note\n');
  const res = r.run('docs: add workflow', MAINTENANCE_BODY);
  assert.equal(res.status, 1);
  assert.match(res.out, /Tier B: protected path: \.github\/workflows\/notes.yml/);
});

scenario('AC5: a PR editing the policy to claim maintenance stays Tier B', (r) => {
  const policy = JSON.parse(fs.readFileSync(path.join(r.dir, POLICY), 'utf8'));
  policy.maintenance_paths.push('apps/**');
  policy.protected_paths = policy.protected_paths.filter((p) => p !== 'apps/**');
  r.write(POLICY, JSON.stringify(policy));
  r.write('apps/api/src/auth.ts', 'export const a = 3;\n');
  const res = r.run('chore: widen maintenance', MAINTENANCE_BODY);
  assert.equal(res.status, 1);
  assert.match(res.out, /Tier B/);
});

scenario('AC4: historical metadata drift on a cleared row fails', (r) => {
  r.remove('docs/product-spec/work-items/TASK-AI-1.md');
  const text = fs
    .readFileSync(path.join(r.dir, REGISTER), 'utf8')
    .replace(
      '"MERGED","","docs/product-spec/work-items/TASK-AI-1.md","b","10"',
      '"MERGED","","","b","99"'
    );
  r.write(REGISTER, text);
  const res = r.run('chore: delete shipped Work Item', MAINTENANCE_BODY);
  assert.equal(res.status, 1);
  assert.match(res.out, /changed \['pr'\]/);
});

scenario('AC4: deleting an active Work Item fails', (r) => {
  r.remove('docs/product-spec/work-items/TASK-AI-3.md');
  r.clearPaths(['TASK-AI-3']);
  const res = r.run('chore: delete Work Item', MAINTENANCE_BODY);
  assert.equal(res.status, 1);
  assert.match(res.out, /still active \(READY_FOR_AUTHOR\)/);
});

scenario('AC4: a deleted Work Item still listed in the register fails', (r) => {
  r.remove('docs/product-spec/work-items/TASK-AI-1.md');
  const res = r.run('chore: delete Work Item', MAINTENANCE_BODY);
  assert.equal(res.status, 1);
  assert.match(res.out, /deleted Work Item still listed in register/);
});

scenario('AC4: clearing a path without deleting the file fails', (r) => {
  r.clearPaths(['TASK-AI-1']);
  const res = r.run('chore: clear register path', MAINTENANCE_BODY);
  assert.equal(res.status, 1);
  assert.match(res.out, /cleared without deleting its file/);
});

scenario('AC4: an unrelated register change fails', (r) => {
  const text = fs
    .readFileSync(path.join(r.dir, REGISTER), 'utf8')
    .replace('"READY_FOR_AUTHOR"', '"MERGED"');
  r.write(REGISTER, text);
  const res = r.run('chore: sync register', MAINTENANCE_BODY);
  assert.equal(res.status, 1);
  assert.match(res.out, /changed \['status'\]/);
});

scenario('AC4: editing an active Work Item file is Tier B', (r) => {
  r.write('docs/product-spec/work-items/TASK-AI-3.md', '# TASK-AI-3 edited\n');
  const res = r.run('docs: edit Work Item', MAINTENANCE_BODY);
  assert.equal(res.status, 1);
  assert.match(res.out, /Tier B: Work Item file M/);
});

scenario('AC5: a tracked .env is refused even in maintenance scope', (r) => {
  r.write('docs/.env', 'X=1\n');
  const res = r.run('docs: add env', MAINTENANCE_BODY);
  assert.equal(res.status, 1);
});

scenario('AC5: a maintenance title cannot also name a Work Item', (r) => {
  r.write('docs/notes.md', 'new note\n');
  const res = r.run('docs: TASK-AI-9 notes', MAINTENANCE_BODY);
  assert.equal(res.status, 1);
  assert.match(res.out, /must not name a Work Item/);
});

scenario('Tier B success: one Work Item file, its row and full evidence still pass', (r) => {
  r.write('docs/product-spec/work-items/TASK-AI-3.md', '# TASK-AI-3 edited\n');
  r.write('apps/api/src/auth.ts', 'export const a = 4;\n');
  const res = r.run('[TASK-AI-3] Change auth', WORK_ITEM_BODY('TASK-AI-3'));
  assert.equal(res.status, 0, res.out);
  assert.match(res.out, /Tier B/);
});

scenario('Tier B: two Work Items in one PR still fail', (r) => {
  r.write('docs/product-spec/work-items/TASK-AI-3.md', '# edited\n');
  r.write('docs/product-spec/work-items/TASK-AI-1.md', '# edited\n');
  const res = r.run('[TASK-AI-3] Change two', WORK_ITEM_BODY('TASK-AI-3'));
  assert.equal(res.status, 1);
  assert.match(res.out, /multiple Work Items changed/);
});

scenario('AC3: empty maintenance sections fail', (r) => {
  r.write('docs/notes.md', 'new note\n');
  const body = '## Goal\n\n## Scope\n\n## Verification\n\nReview status: READY_FOR_CODEX\n';
  const res = r.run('docs: refresh notes', body);
  assert.equal(res.status, 1);
  assert.match(res.out, /missing or empty maintenance PR section: ## Goal/);
});

scenario('AC3: a Verification section holding only the review marker fails', (r) => {
  r.write('docs/notes.md', 'new note\n');
  const body =
    '## Goal\nRefresh notes.\n\n## Scope\nOne doc.\n\n## Verification\nReview status: READY_FOR_CODEX\n';
  const res = r.run('docs: refresh notes', body);
  assert.equal(res.status, 1);
  assert.match(res.out, /missing or empty maintenance PR section: ## Verification/);
});

scenario('AC3: a Verification section holding only an empty code block fails', (r) => {
  r.write('docs/notes.md', 'new note\n');
  const body =
    '## Goal\nRefresh notes.\n\n## Scope\nOne doc.\n\n## Verification\n```\n```\n\nReview status: READY_FOR_CODEX\n';
  const res = r.run('docs: refresh notes', body);
  assert.equal(res.status, 1);
  assert.match(res.out, /missing or empty maintenance PR section: ## Verification/);
});

scenario('AC3: verification evidence inside a code block counts', (r) => {
  r.write('docs/notes.md', 'new note\n');
  const body =
    '## Goal\nRefresh notes.\n\n## Scope\nOne doc.\n\n## Verification\n```\npython docs/product-spec/scripts/validate_docs.py  # PASS\n```\n\nReview status: READY_FOR_CODEX\n';
  const res = r.run('docs: refresh notes', body);
  assert.equal(res.status, 0, res.out);
});

scenario('AC3: headings only mentioned in prose or code do not count', (r) => {
  r.write('docs/notes.md', 'new note\n');
  const body =
    'This PR has a ## Goal, ## Scope and ## Verification.\n\n```\n## Goal\nfake\n## Scope\nfake\n## Verification\nfake\n```\n\nReview status: READY_FOR_CODEX\n';
  const res = r.run('docs: refresh notes', body);
  assert.equal(res.status, 1);
  assert.match(res.out, /missing or empty maintenance PR section: ## Goal/);
});

const registerWith = (r, transform) => {
  const file = path.join(r.dir, REGISTER);
  fs.writeFileSync(file, transform(fs.readFileSync(file, 'utf8')));
};

scenario('AC4: an extra register column on a cleaned row fails closed', (r) => {
  r.remove('docs/product-spec/work-items/TASK-AI-1.md');
  r.clearPaths(['TASK-AI-1']);
  registerWith(r, (t) => t.replace('"10","","a1"', '"10","","a1","extra"'));
  const res = r.run('chore: delete shipped Work Item', MAINTENANCE_BODY);
  assert.equal(res.status, 1);
  assert.match(res.out, /head register record 2 has 15 fields, header has 14/);
});

scenario('AC4: a missing register column fails closed', (r) => {
  r.remove('docs/product-spec/work-items/TASK-AI-1.md');
  r.clearPaths(['TASK-AI-1']);
  registerWith(r, (t) => t.replace('"10","","a1"', '"10",""'));
  const res = r.run('chore: delete shipped Work Item', MAINTENANCE_BODY);
  assert.equal(res.status, 1);
  assert.match(res.out, /head register record 2 has 13 fields/);
});

scenario('AC4: a duplicate register header fails closed', (r) => {
  r.remove('docs/product-spec/work-items/TASK-AI-1.md');
  r.clearPaths(['TASK-AI-1']);
  registerWith(r, (t) => t.replace('"merge_commit"', '"status"'));
  const res = r.run('chore: delete shipped Work Item', MAINTENANCE_BODY);
  assert.equal(res.status, 1);
  assert.match(res.out, /head register header has empty or duplicate columns/);
});

test('AC5: renaming a tracked .env away is refused on the source side', { skip: !python }, () => {
  const r = makeRepo();
  try {
    // Seed a tracked docs/.env on the base side, then rename it in the PR.
    r.g('checkout', '-q', 'main');
    r.write('docs/.env', 'X=1\n');
    r.g('add', '-A');
    r.g('commit', '-qm', 'seed env');
    const base = r.g('rev-parse', 'HEAD');
    r.g('checkout', '-q', '-B', 'pr2', base);
    r.g('mv', 'docs/.env', 'docs/env-notes.txt');
    r.g('commit', '-qm', 'rename env');
    const head = r.g('rev-parse', 'HEAD');
    const event = path.join(r.dir, 'event2.json');
    fs.writeFileSync(
      event,
      JSON.stringify({
        pull_request: {
          title: 'docs: rename env',
          body: MAINTENANCE_BODY,
          base: { ref: 'main', sha: base },
          head: { sha: head },
        },
      })
    );
    const res = spawnSync(python, [path.join(r.dir, VALIDATOR), '--event', event], {
      cwd: r.dir,
      encoding: 'utf8',
    });
    assert.equal(res.status, 1, res.stdout);
    assert.match(res.stdout, /tracked \.env file is prohibited/);
  } finally {
    r.cleanup();
  }
});

scenario('AC1: a type change (file to symlink) is Tier B', (r) => {
  const link = spawnSync('git', ['hash-object', '-w', '--stdin'], {
    cwd: r.dir,
    input: 'other.md',
    encoding: 'utf8',
  }).stdout.trim();
  r.g('update-index', '--cacheinfo', `120000,${link},docs/notes.md`);
  r.g('commit', '-qm', 'symlink');
  // Make the work tree agree with the committed symlink so run() stages nothing new.
  r.g('-c', 'core.symlinks=false', 'checkout', '--', 'docs/notes.md');
  const res = r.run('docs: link notes', MAINTENANCE_BODY);
  assert.equal(res.status, 1);
  assert.match(res.out, /Tier B: type change: docs\/notes.md/);
});

scenario('AC2: a nested AGENTS.md is protected', (r) => {
  r.write('docs/product-spec/AGENTS.md', '# contract\n');
  const res = r.run('docs: edit contract', MAINTENANCE_BODY);
  assert.equal(res.status, 1);
  assert.match(res.out, /Tier B: protected path: docs\/product-spec\/AGENTS.md/);
});

test('AC5: without a base policy every PR is Tier B (bootstrap)', { skip: !python }, () => {
  const r = makeRepo({ withPolicy: false });
  try {
    r.write('docs/notes.md', 'new note\n');
    const res = r.run('docs: refresh notes', MAINTENANCE_BODY);
    assert.equal(res.status, 1);
    assert.match(res.out, /Tier B: no contract policy at the base commit/);
  } finally {
    r.cleanup();
  }
});

test('AC5: a malformed base policy fails closed', { skip: !python }, () => {
  const r = makeRepo({ policyText: '{not json' });
  try {
    r.write('docs/notes.md', 'new note\n');
    const res = r.run('docs: refresh notes', MAINTENANCE_BODY);
    assert.equal(res.status, 1);
    assert.match(res.out, /unreadable contract input: base policy is not valid JSON/);
  } finally {
    r.cleanup();
  }
});

test('AC5: an unknown base commit fails closed', { skip: !python }, () => {
  const r = makeRepo();
  try {
    const event = path.join(r.dir, 'bad-event.json');
    fs.writeFileSync(
      event,
      JSON.stringify({
        pull_request: {
          title: 'docs: x',
          body: MAINTENANCE_BODY,
          base: { ref: 'main', sha: '0'.repeat(40) },
          head: { sha: 'HEAD' },
        },
      })
    );
    const res = spawnSync(python, [path.join(r.dir, VALIDATOR), '--event', event], {
      cwd: r.dir,
      encoding: 'utf8',
    });
    assert.equal(res.status, 1);
    assert.match(res.stdout, /unreadable contract input/);
  } finally {
    r.cleanup();
  }
});
