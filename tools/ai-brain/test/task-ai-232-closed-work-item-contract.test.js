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
const GOVERNANCE_BODY =
  '## Goal\nReconcile declared governance artifacts.\n\n## Scope\nExact declared paths only.\n\n## Preservation\nNo product behavior, CI pins or gate commands altered.\n\n## Verification\nfocused tests and validators pass\n\nReview status: READY_FOR_CODEX\n';
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
  write('AGENTS.md', '# agents\n');
  write('docs/product-spec/docs/10-ai-collaboration/WORK-ITEM-TEMPLATE.md', '# template\n');
  write('docs/product-spec/evidence/CURRENT-IMPLEMENTATION-INVENTORY.md', '# inventory\n');
  write(
    'docs/product-spec/docs/10-ai-collaboration/repo-integration/GROUP-8-CONDITIONAL.md',
    '# g8\n'
  );
  write(
    'tools/ai-brain/data/tool-manifest.json',
    JSON.stringify(
      [
        {
          id: 'gitleaks',
          repo: 'gitleaks/gitleaks',
          gate: true,
          command: 'security:secrets',
          installed: true,
          evidenceRef: 'package.json:scripts.security:secrets',
        },
        {
          id: 'nock',
          repo: 'nock/nock',
          gate: false,
          command: null,
          installed: false,
          evidenceRef: 'docs/product-spec/docs/10-ai-collaboration/REPOSITORY-CLI-MANIFEST.md',
        },
      ],
      null,
      2
    ) + '\n'
  );
  write(
    'tools/ecosystem-manifest.json',
    JSON.stringify(
      {
        orchestrator_runtime: { id: 'agent-orchestrator', pinned_version_or_commit: '0.13.0' },
        adopted: [
          {
            id: 'semgrep',
            pinned_version_or_commit: '1.181.0',
            install_method: 'ci-provisioned',
            blocking_policy: 'BLOCKING_GATE',
            health_check: 'pnpm security:semgrep',
            lifecycle_state: 'ADOPTED',
            default_enabled: true,
            source_of_truth_boundary: 'Original boundary.',
          },
        ],
        product_dependencies: [{ id: 'node', pinned_version_or_commit: '24.15.0' }],
        candidates: [{ id: 'nock', lifecycle_state: 'WATCH' }],
      },
      null,
      2
    ) + '\n'
  );
  write('tools/ai-brain/acceptance/ac-31-05-gate-rule.js', 'module.exports = {};\n');
  write('tools/ai-brain/acceptance/ac-31-03-live.js', 'module.exports = { live: true };\n');
  write('apps/web/src/components/SourceMatchingTab.tsx', 'export const Dead = () => null;\n');
  write('apps/web/src/components/LiveButton.tsx', 'export const Live = () => null;\n');
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
  // check() evaluates the already-committed HEAD; run() commits the work tree first.
  const check = (title, body) => {
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
  const run = (title, body) => {
    g('add', '-A');
    g('commit', '-qm', 'change', '--allow-empty');
    return check(title, body);
  };
  const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
  return { dir, g, write, remove, clearPaths, run, check, cleanup };
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

scenario('AC3: a fenced block holding only the review marker is not evidence', (r) => {
  r.write('docs/notes.md', 'new note\n');
  const body =
    '## Goal\nRefresh notes.\n\n## Scope\nOne doc.\n\n## Verification\n```\nReview status: READY_FOR_CODEX\n```\n\nReview status: READY_FOR_CODEX\n';
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
  // Evaluate the committed symlink directly: staging the work tree again would undo it
  // on platforms where core.symlinks differs (Linux CI vs Windows).
  const res = r.check('docs: link notes', MAINTENANCE_BODY);
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

// Governance v2: Tier G (protected governance, PR-only evidence) exempts only
// declared non-product operations from TASK-AI generation while enforcing
// preservation evidence, manifest invariants, and strict Tier B on everything else.
scenario('v2: editing root AGENTS.md and WORK-ITEM-TEMPLATE.md passes as Tier G', (r) => {
  r.write('AGENTS.md', '# agents updated\n');
  r.write('docs/product-spec/docs/10-ai-collaboration/WORK-ITEM-TEMPLATE.md', '# template v2\n');
  const res = r.run('docs: update AGENTS and template', GOVERNANCE_BODY);
  assert.equal(res.status, 0, res.out);
  assert.match(res.out, /Tier G/);
});

scenario('v2 negative: Tier G fails without ## Preservation section', (r) => {
  r.write('AGENTS.md', '# agents updated\n');
  const res = r.run('docs: update AGENTS without preservation', MAINTENANCE_BODY);
  assert.equal(res.status, 1);
  assert.match(res.out, /missing or empty protected governance PR section: ## Preservation/);
});

scenario(
  'v2: deleting declared dead web component and updating real inventory passes as Tier G',
  (r) => {
    r.remove('apps/web/src/components/SourceMatchingTab.tsx');
    r.write('docs/product-spec/evidence/CURRENT-IMPLEMENTATION-INVENTORY.md', '# updated\n');
    const res = r.run('chore(web): delete unused SourceMatchingTab', GOVERNANCE_BODY);
    assert.equal(res.status, 0, res.out);
    assert.match(res.out, /Tier G/);
  }
);

scenario(
  'v2: deleting declared dead acceptance script and reconciling manifests passes as Tier G',
  (r) => {
    r.remove('tools/ai-brain/acceptance/ac-31-05-gate-rule.js');
    r.write(
      'tools/ai-brain/data/tool-manifest.json',
      JSON.stringify(
        [
          {
            id: 'gitleaks',
            repo: 'gitleaks/gitleaks',
            gate: true,
            command: 'security:secrets',
            installed: true,
            evidenceRef: 'package.json:scripts.security:secrets',
          },
        ],
        null,
        2
      ) + '\n'
    );
    const eco = JSON.parse(
      fs.readFileSync(path.join(r.dir, 'tools/ecosystem-manifest.json'), 'utf8')
    );
    eco.adopted[0].source_of_truth_boundary = 'Clarified CI vs local boundary.';
    eco.candidates = [];
    r.write('tools/ecosystem-manifest.json', JSON.stringify(eco, null, 2) + '\n');
    r.write(
      'docs/product-spec/docs/10-ai-collaboration/repo-integration/GROUP-8-CONDITIONAL.md',
      '# g8 v2\n'
    );
    const res = r.run(
      'chore(tools): prune dead acceptance and reconcile manifests',
      GOVERNANCE_BODY
    );
    assert.equal(res.status, 0, res.out);
    assert.match(res.out, /Tier G/);
  }
);

scenario(
  'v2 negative: deleting a live acceptance script outside declared list stays Tier B',
  (r) => {
    r.remove('tools/ai-brain/acceptance/ac-31-03-live.js');
    const res = r.run('chore(tools): delete live acceptance', GOVERNANCE_BODY);
    assert.equal(res.status, 1);
    assert.match(
      res.out,
      /Tier B: path outside maintenance scope: tools\/ai-brain\/acceptance\/ac-31-03-live\.js/
    );
  }
);

scenario(
  'v2 negative: changing CI pin in ecosystem-manifest.json fails manifest invariant',
  (r) => {
    const eco = JSON.parse(
      fs.readFileSync(path.join(r.dir, 'tools/ecosystem-manifest.json'), 'utf8')
    );
    eco.adopted[0].pinned_version_or_commit = '9.9.9';
    r.write('tools/ecosystem-manifest.json', JSON.stringify(eco, null, 2) + '\n');
    const res = r.run('chore(tools): bump semgrep pin', GOVERNANCE_BODY);
    assert.equal(res.status, 1);
    assert.match(
      res.out,
      /cannot change protected ecosystem fields on semgrep: \['pinned_version_or_commit'\]/
    );
  }
);

scenario(
  'v2 negative: changing gate command in tool-manifest.json fails manifest invariant',
  (r) => {
    const tm = JSON.parse(
      fs.readFileSync(path.join(r.dir, 'tools/ai-brain/data/tool-manifest.json'), 'utf8')
    );
    tm[0].command = 'echo bypassed';
    r.write('tools/ai-brain/data/tool-manifest.json', JSON.stringify(tm, null, 2) + '\n');
    const res = r.run('chore(tools): alter gitleaks command', GOVERNANCE_BODY);
    assert.equal(res.status, 1);
    assert.match(
      res.out,
      /cannot change protected tool-manifest fields on gitleaks: \['command'\]/
    );
  }
);

scenario(
  'v2 negative: prepending duplicate semgrep entry in ecosystem-manifest.json fails closed',
  (r) => {
    const eco = JSON.parse(
      fs.readFileSync(path.join(r.dir, 'tools/ecosystem-manifest.json'), 'utf8')
    );
    eco.adopted.unshift({ ...eco.adopted[0], pinned_version_or_commit: '9.9.9' });
    r.write('tools/ecosystem-manifest.json', JSON.stringify(eco, null, 2) + '\n');
    const res = r.run('chore(tools): shadow semgrep pin via duplicate', GOVERNANCE_BODY);
    assert.equal(res.status, 1);
    assert.match(res.out, /duplicate id in head ecosystem-manifest\.adopted: semgrep/);
  }
);

scenario(
  'v2 negative: prepending duplicate gitleaks entry in tool-manifest.json fails closed',
  (r) => {
    const tm = JSON.parse(
      fs.readFileSync(path.join(r.dir, 'tools/ai-brain/data/tool-manifest.json'), 'utf8')
    );
    tm.unshift({ ...tm[0], command: 'echo shadowed' });
    r.write('tools/ai-brain/data/tool-manifest.json', JSON.stringify(tm, null, 2) + '\n');
    const res = r.run('chore(tools): shadow gitleaks via duplicate', GOVERNANCE_BODY);
    assert.equal(res.status, 1);
    assert.match(res.out, /duplicate id in head tool-manifest\.json: gitleaks/);
  }
);

scenario('v2 negative: modifying a delete-only dead web component stays Tier B', (r) => {
  r.write('apps/web/src/components/SourceMatchingTab.tsx', 'export const Edited = () => null;\n');
  const res = r.run('chore(web): edit dead component', GOVERNANCE_BODY);
  assert.equal(res.status, 1);
  assert.match(
    res.out,
    /Tier B: protected path: apps\/web\/src\/components\/SourceMatchingTab\.tsx/
  );
});

scenario(
  'v2 negative: deleting an undeclared web component stays Tier B (no blanket delete-only)',
  (r) => {
    r.remove('apps/web/src/components/LiveButton.tsx');
    const res = r.run('chore(web): delete undeclared component', GOVERNANCE_BODY);
    assert.equal(res.status, 1);
    assert.match(res.out, /Tier B: protected path: apps\/web\/src\/components\/LiveButton\.tsx/);
  }
);

scenario('v2 negative: renaming a declared dead web component into docs stays Tier B', (r) => {
  r.g('mv', 'apps/web/src/components/SourceMatchingTab.tsx', 'docs/SourceMatchingTab.tsx');
  const res = r.run('chore(web): move dead component', GOVERNANCE_BODY);
  assert.equal(res.status, 1);
  assert.match(
    res.out,
    /Tier B: protected path: apps\/web\/src\/components\/SourceMatchingTab\.tsx/
  );
});

scenario('v2 negative: deleting root AGENTS.md stays Tier B (only M is allowed)', (r) => {
  r.remove('AGENTS.md');
  const res = r.run('chore: delete agents', GOVERNANCE_BODY);
  assert.equal(res.status, 1);
  assert.match(res.out, /Tier B: protected path: AGENTS\.md/);
});

scenario('v2 negative: deleting a workflow or auth file stays Tier B', (r) => {
  r.remove('.github/workflows/ci.yml');
  const res = r.run('chore: delete workflow', GOVERNANCE_BODY);
  assert.equal(res.status, 1);
  assert.match(res.out, /Tier B: protected path: \.github\/workflows\/ci\.yml/);
});

scenario('v2 negative: mixing scoped governance with apps/api edit stays Tier B', (r) => {
  r.write('AGENTS.md', '# agents updated\n');
  r.write('apps/api/src/auth.ts', 'export const a = 99;\n');
  const res = r.run('chore: update agents and auth', GOVERNANCE_BODY);
  assert.equal(res.status, 1);
  assert.match(res.out, /Tier B: protected path: apps\/api\/src\/auth\.ts/);
});

test(
  'v2 negative: v1 policy declaring scoped_governance_rules fails closed',
  { skip: !python },
  () => {
    const p = JSON.parse(fs.readFileSync(path.join(repo, POLICY), 'utf8'));
    p.version = 1;
    const r = makeRepo({ policyText: JSON.stringify(p) });
    try {
      r.write('AGENTS.md', '# edited\n');
      const res = r.run('docs: edit agents', GOVERNANCE_BODY);
      assert.equal(res.status, 1);
      assert.match(res.out, /v1 must not declare scoped_governance_rules/);
    } finally {
      r.cleanup();
    }
  }
);

test(
  'v2 negative: v2 policy missing scoped_governance_rules fails closed',
  { skip: !python },
  () => {
    const p = JSON.parse(fs.readFileSync(path.join(repo, POLICY), 'utf8'));
    delete p.scoped_governance_rules;
    const r = makeRepo({ policyText: JSON.stringify(p) });
    try {
      r.write('docs/notes.md', 'x\n');
      const res = r.run('docs: edit notes', MAINTENANCE_BODY);
      assert.equal(res.status, 1);
      assert.match(res.out, /v2 requires non-empty scoped_governance_rules/);
    } finally {
      r.cleanup();
    }
  }
);

test(
  'v2 negative: invalid scoped_governance_rules kind in base policy fails closed',
  { skip: !python },
  () => {
    const basePolicy = JSON.parse(fs.readFileSync(path.join(repo, POLICY), 'utf8'));
    basePolicy.scoped_governance_rules = [{ path: 'AGENTS.md', kinds: ['R'] }];
    const r = makeRepo({ policyText: JSON.stringify(basePolicy) });
    try {
      r.write('AGENTS.md', '# edited\n');
      const res = r.run('docs: edit agents', GOVERNANCE_BODY);
      assert.equal(res.status, 1);
      assert.match(
        res.out,
        /unreadable contract input: base policy scoped_governance_rules\[0\]\.kinds is invalid/
      );
    } finally {
      r.cleanup();
    }
  }
);

test(
  'v2 negative: modifying policy/validator from v1 or v2 base stays strictly Tier B (no self-bootstrap)',
  { skip: !python },
  () => {
    const v2Policy = JSON.parse(fs.readFileSync(path.join(repo, POLICY), 'utf8'));
    const v1Policy = { ...v2Policy, version: 1 };
    delete v1Policy.scoped_governance_rules;
    delete v1Policy.governance_body_headings;
    const r = makeRepo({ policyText: JSON.stringify(v1Policy, null, 2) + '\n' });
    try {
      r.write(POLICY, JSON.stringify(v2Policy, null, 2) + '\n');
      const res = r.run('chore(governance): attempt self-upgrade without WI', GOVERNANCE_BODY);
      assert.equal(res.status, 1, res.out);
      assert.match(
        res.out,
        /Tier B: protected path: docs\/product-spec\/scripts\/pr_contract_policy\.json/
      );
    } finally {
      r.cleanup();
    }
  }
);
