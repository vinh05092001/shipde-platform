/**
 * Ship Dễ — Dependency Graph Shadow Test Suite (TASK-AI-33)
 *
 * The register decides and the shadow observes. These tests run against
 * fixture registers in a temp directory, so no test can touch the real one.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const shadow = require('../shadow');
const { parseDependencies } = require('../reconcile');
const graphLib = require('../acceptance/lib/dependency-graph');

const CLI = path.join(__dirname, '..', 'cli.js');
const HEADER =
  '"delivery_order","slice","group","work_item_id","feature_id","feature_name","key_behavior","status","dependencies","work_item_path","branch","pr","codex_verdict","merge_commit"';

function row(order, id, deps) {
  return `"${order}","S00","AI workflow","${id}","","name","behavior","BACKLOG","${deps}","","","","",""`;
}

let dir;
let registerPath;
let shadowPath;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-shadow-'));
  registerPath = path.join(dir, 'register.csv');
  shadowPath = path.join(dir, 'shadow', 'graph.json');
  fs.writeFileSync(
    registerPath,
    [
      HEADER,
      row(1, 'TASK-AI-01', ''),
      row(2, 'TASK-AI-02', 'TASK-AI-01'),
      row(3, 'TASK-AI-03', 'TASK-AI-01; TASK-AI-02; see NOTES.md'),
    ].join('\n') + '\n'
  );
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function runCli(args) {
  return spawnSync(process.execPath, [CLI, 'shadow', ...args], { encoding: 'utf8', cwd: dir });
}

describe('Projection', () => {
  test('projects nodes and the edges the reconciler parses', () => {
    const r = shadow.project({ registerPath, shadowPath });
    assert.equal(r.nodes, 3);
    assert.equal(r.edges, 3);
    const stored = JSON.parse(fs.readFileSync(shadowPath, 'utf8'));
    assert.deepStrictEqual(stored.edges, [
      { from: 'TASK-AI-02', to: 'TASK-AI-01' },
      { from: 'TASK-AI-03', to: 'TASK-AI-01' },
      { from: 'TASK-AI-03', to: 'TASK-AI-02' },
    ]);
  });

  test('a second projection is a byte-identical no-op', () => {
    shadow.project({ registerPath, shadowPath });
    const first = fs.readFileSync(shadowPath);
    const again = shadow.project({ registerPath, shadowPath });
    assert.equal(again.unchanged, true);
    assert.equal(again.written, false);
    assert.ok(first.equals(fs.readFileSync(shadowPath)));
  });

  test('the store carries no timestamp or path', () => {
    shadow.project({ registerPath, shadowPath });
    const stored = JSON.parse(fs.readFileSync(shadowPath, 'utf8'));
    assert.deepStrictEqual(Object.keys(stored).sort(), ['edges', 'nodes']);
  });

  test('dry-run writes nothing', () => {
    const r = shadow.project({ registerPath, shadowPath, dryRun: true });
    assert.equal(r.written, false);
    assert.equal(fs.existsSync(shadowPath), false);
  });
});

describe('Comparison', () => {
  test('an untouched projection agrees', () => {
    shadow.project({ registerPath, shadowPath });
    assert.deepStrictEqual(shadow.compare({ registerPath, shadowPath }).divergences, []);
  });

  test('a dropped edge is MISSING_IN_SHADOW and an invented one EXTRA_IN_SHADOW, named', () => {
    shadow.project({ registerPath, shadowPath });
    const stored = JSON.parse(fs.readFileSync(shadowPath, 'utf8'));
    stored.edges = stored.edges.filter((e) => e.from !== 'TASK-AI-02');
    stored.edges.push({ from: 'TASK-AI-01', to: 'TASK-AI-03' });
    fs.writeFileSync(shadowPath, JSON.stringify(stored));

    const { divergences } = shadow.compare({ registerPath, shadowPath });
    assert.deepStrictEqual(divergences, [
      { type: 'EXTRA_IN_SHADOW', from: 'TASK-AI-01', to: 'TASK-AI-03' },
      { type: 'MISSING_IN_SHADOW', from: 'TASK-AI-02', to: 'TASK-AI-01' },
    ]);
  });
});

describe('The register owns the graph', () => {
  test('project and compare leave the register byte-identical, including a divergent compare', () => {
    const before = fs.readFileSync(registerPath);
    shadow.project({ registerPath, shadowPath });
    fs.writeFileSync(shadowPath, JSON.stringify({ nodes: [], edges: [] }));
    const r = shadow.compare({ registerPath, shadowPath });
    assert.ok(r.divergences.length > 0);
    assert.equal(r.registerSha256, shadow.sha256(before));
    assert.ok(before.equals(fs.readFileSync(registerPath)));
  });

  test('the edge rule is the reconciler parseDependencies, by reference', () => {
    assert.strictEqual(graphLib.parseEdges, parseDependencies);
  });
});

describe('Fail closed', () => {
  test('a missing register is refused, not read as an empty graph', () => {
    assert.throws(
      () => shadow.compare({ registerPath: path.join(dir, 'absent.csv'), shadowPath }),
      shadow.ShadowError
    );
  });

  test('a missing shadow store is refused', () => {
    assert.throws(() => shadow.compare({ registerPath, shadowPath }), shadow.ShadowError);
  });

  test('an unparseable shadow store is refused', () => {
    fs.mkdirSync(path.dirname(shadowPath), { recursive: true });
    fs.writeFileSync(shadowPath, '{not json');
    assert.throws(() => shadow.compare({ registerPath, shadowPath }), shadow.ShadowError);
  });

  test('a register with no rows is refused', () => {
    fs.writeFileSync(registerPath, HEADER + '\n');
    assert.throws(() => shadow.project({ registerPath, shadowPath }), shadow.ShadowError);
  });
});

describe('CLI', () => {
  test('project then compare exits 0 with the agreement line', () => {
    assert.equal(
      runCli(['--project', '--register', registerPath, '--shadow', shadowPath]).status,
      0
    );
    const r = runCli(['--compare', '--register', registerPath, '--shadow', shadowPath]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Shadow agrees with the register: 3 nodes, 3 edges, 0 divergences/);
  });

  test('a divergent compare exits 1 and names the edge', () => {
    fs.mkdirSync(path.dirname(shadowPath), { recursive: true });
    fs.writeFileSync(shadowPath, JSON.stringify({ nodes: [], edges: [] }));
    const r = runCli(['--compare', '--register', registerPath, '--shadow', shadowPath]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /MISSING_IN_SHADOW {2}TASK-AI-02 -> TASK-AI-01/);
  });

  test('a misspelled option is refused with exit 1', () => {
    const r = runCli(['--compare', '--registr', registerPath]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /--registr/);
  });

  test('a value option without a value is refused', () => {
    const r = runCli(['--compare', '--register']);
    assert.equal(r.status, 1);
  });

  test('both or neither of --project and --compare is refused', () => {
    assert.equal(runCli(['--register', registerPath]).status, 1);
    assert.equal(runCli(['--project', '--compare', '--register', registerPath]).status, 1);
  });
});
