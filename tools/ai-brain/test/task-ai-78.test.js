'use strict';

/**
 * TASK-AI-78 (Gate C) — repo map, scope/drift gate, output virtualization. R-R01..O-R04 are specified
 * in the three module headers; each test below names the rule ids it proves. Hermetic: throwaway git
 * repos and directories under os.tmpdir(), no network, no shared state.
 */

const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const { scrubText } = require('../decisions');
const load = (name) => require(`../${name}`);

const eq = (actual, expected, why) => assert.equal(actual, expected, why);
const ok = (value, why) => assert.ok(value, why);
const same = (actual, expected, why) => assert.deepEqual(actual, expected, why);
const listed = (result) => result.files.map((file) => file.path);
const ids = (result) => result.traced.map((one) => one.acceptanceId);
const FIXTURES = path.join(__dirname, 'fixtures', 'task-ai-78');
const SCOPE = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'scope.json'), 'utf8'));
const scope = (over) => Object.assign({}, SCOPE, over || {});
const map = (repoCwd, over) => load('repo-map').buildRepoMap(Object.assign({ repoCwd }, over));
const expand = (repoCwd, file, reason) => load('repo-map').expand({ repoCwd, file, reason });
const parked = (dir, text, bytes) =>
  load('output-store').virtualize(text, { dir, thresholdBytes: bytes });

const FIXTURE_REPO = {
  'README.md': '# fixture\n',
  'src/beta.js': `'use strict';

function betaHelper(value) {
  const BODY_ONLY_BETA = 'body-marker-beta';
  return value + BODY_ONLY_BETA;
}

module.exports = { betaHelper };
`,
  'src/alpha.js': `'use strict';

const beta = require('./beta');

class AlphaService extends Object {
  greet(loud) { return 'hello ' + beta.betaHelper(loud); }
}

async function alphaRun(times) { return beta.betaHelper(times); }

const alphaArrow = (first, second) => first + second;

const arrowNoBraces = (x) => 'ARROW_NO_BRACES_BODY_SECRET';

module.exports = { AlphaService, alphaRun, alphaArrow };
`,
  'src/gamma.ts': `import { alphaRun } from './alpha';

export interface GammaRow { id: string }

export function gammaPick(rows: GammaRow[]): GammaRow | null {
  const BODY_ONLY_GAMMA = 'body-marker-gamma';
  return alphaRun(rows.length) || BODY_ONLY_GAMMA;
}
`,
};

const KEEP_TEST = "const assert = require('node:assert/strict');\n\ntest('k', () => {\n%s\n});\n";
const MANY = Array.from(
  { length: 20 },
  (unused, at) => `function fn${at}(arg${at}) { return arg${at}; }`
);
// a-big.js is imported, so it ranks first, and it is far too big for the budget F-4 hands it.
const RANK_FIXTURE = {
  'b-small.js': "const big = require('./a-big');\n\nmodule.exports = { big };\n",
  'a-big.js': `${MANY.join('\n')}\n`,
};
const BASE_REPO = {
  'README.md': '# base\n',
  'docs/plan.md': '# plan\n',
  'package.json': '{\n  "name": "fixture",\n  "version": "1.0.0"\n}\n',
  'src/keep.js': 'module.exports = 1;\n',
  'test/keep.test.js': KEEP_TEST.replace('%s', '  assert.equal(1, 1);'),
};

const cleanup = [];
function tmpDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  cleanup.push(dir);
  return dir;
}
after(() => cleanup.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

function writeFiles(dir, files) {
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body, 'utf8');
  }
}

function gitRepo(files) {
  const dir = tmpDir('ai78-repo-');
  const git = (...args) => {
    const safe = ['-c', 'safe.directory=*', '-c', 'commit.gpgsign=false'];
    const who = ['-c', 'user.email=test@shipde.local', '-c', 'user.name=Test'];
    const res = cp.spawnSync('git', [...safe, ...who, ...args], {
      cwd: dir,
      encoding: 'utf8',
      windowsHide: true,
    });
    if (res.status !== 0) throw new Error(`git ${args.join(' ')}: ${res.stderr}`);
    return String(res.stdout || '').trim();
  };
  git('init', '-b', 'main');
  writeFiles(dir, files);
  git('add', '-A');
  git('commit', '-m', 'fixture');
  const commit = (message) => {
    git('add', '-A');
    git('commit', '-m', message);
    return git('rev-parse', 'HEAD');
  };
  const remove = (rel) => fs.rmSync(path.join(dir, rel));
  return { dir, git, commit, remove, write: (more) => writeFiles(dir, more) };
}

function diffCase(change, over, options) {
  const repo = gitRepo(BASE_REPO);
  const base = repo.git('rev-parse', 'HEAD');
  const files = Object.assign({}, change);
  const drop = files.remove;
  delete files.remove;
  repo.write(files);
  if (drop) repo.remove(drop);
  const head = Object.keys(files).length === 0 && !drop ? base : repo.commit('candidate change');
  const input = { repoCwd: repo.dir, base, head, scope: scope(over) };
  return load('scope-gate').checkDiff(Object.assign(input, options));
}

describe('TASK-AI-78 Gate C: repo map, scope gate, output store', () => {
  test('R-R01/R-R02: the map lists signatures and edges, and stays inside its token budget', () => {
    const repoMap = load('repo-map');
    const dir = gitRepo(FIXTURE_REPO).dir;
    const full = map(dir, { budgetTokens: 100000 });
    eq(full.ok, true);
    for (const rel of ['src/alpha.js', 'src/beta.js', 'src/gamma.ts']) {
      ok(full.text.includes(`### ${rel}`), `${rel} must be mapped`);
    }
    eq(full.text.includes('README.md'), false, 'non-code files are not mapped');
    ok(full.text.includes('function betaHelper(value)'));
    ok(full.text.includes('class AlphaService extends Object'));
    ok(full.text.includes('greet(loud)'));
    ok(full.text.includes('const alphaArrow = (first, second) =>'));
    ok(full.text.includes('export function gammaPick(rows: GammaRow[])'));
    eq(full.text.includes('BODY_ONLY'), false, 'a function body never reaches the map');
    eq(full.text.includes('return value +'), false);
    const alpha = full.files.find((file) => file.path === 'src/alpha.js');
    same(alpha.exports, ['AlphaService', 'alphaRun', 'alphaArrow']);
    ok(alpha.requires.includes('./beta'));
    same(alpha.deps, ['src/beta.js']);
    const gamma = full.files.find((file) => file.path === 'src/gamma.ts');
    same(gamma.exports, ['GammaRow', 'gammaPick']);
    same(listed(map(dir, { paths: ['src/beta.js'] })), ['src/beta.js']);

    eq(repoMap.estimateTokens('abcd'), 1);
    eq(full.tokens, repoMap.estimateTokens(full.text));
    ok(full.tokens <= full.budgetTokens);
    eq(full.truncated, false);
    same(listed(full), ['src/alpha.js', 'src/beta.js', 'src/gamma.ts']);
    const second = full.text.indexOf('### ', full.text.indexOf('### ') + 1);
    const head = repoMap.estimateTokens(full.text.slice(0, second));
    const tight = map(dir, { budgetTokens: head + 1 });
    same(listed(tight), ['src/alpha.js'], 'only the top rank fits');
    eq(tight.truncated, true);
    eq(tight.omitted, 2);
    eq(tight.text.includes('src/gamma.ts'), false, 'the lowest rank goes first');
    eq(map(dir, { budgetTokens: 1 }).omitted, 3);
  });

  test('R-R03/R-R04: the cache is keyed by the git tree, and expand needs a reason', () => {
    const repoMap = load('repo-map');
    const repo = gitRepo(FIXTURE_REPO);
    const first = map(repo.dir, { budgetTokens: 100000 });
    const cache = path.join(repo.dir, '.git', 'shipde-repo-map', `${first.tree}.json`);
    eq(first.cacheHit, false);
    eq(first.cachePath, cache);
    fs.writeFileSync(cache, JSON.stringify({ version: 1, tree: first.tree, files: [] }), 'utf8');
    const hit = map(repo.dir, { budgetTokens: 100000 });
    eq(hit.cacheHit, true, 'the same tree is served out of the cache file');
    eq(hit.files.length, 0);
    fs.rmSync(cache);
    const rebuilt = map(repo.dir, { budgetTokens: 100000 });
    eq(rebuilt.cacheHit, false, 'no cache file is a miss');
    const more = FIXTURE_REPO['src/beta.js'] + '\nfunction betaAdded() { return 1; }\n';
    repo.write({ 'src/beta.js': more });
    eq(rebuilt.text.includes('betaAdded'), false, 'the map reads the committed blob');
    repo.commit('add betaAdded');
    const third = map(repo.dir, { budgetTokens: 100000 });
    eq(third.cacheHit, false, 'a changed tree is a cache miss');
    ok(third.text.includes('betaAdded'));
    ok(third.cachePath !== first.cachePath);

    eq(expand(repo.dir, 'src/alpha.js').code, 'REASON_REQUIRED');
    eq(expand(repo.dir, 'src/alpha.js', ' ').code, 'REASON_REQUIRED');
    const block = expand(repo.dir, 'src/alpha.js', 'R-R01 check call sites');
    eq(block.reason, 'R-R01 check call sites');
    ok(block.signatures.includes('async function alphaRun(times)'));
    eq(block.text.includes('BODY_ONLY'), false, 'expand is still signatures only');
    eq(expand(repo.dir, 'src/nope.js', 'x').code, 'FILE_NOT_FOUND');
    fs.writeFileSync(path.join(repo.dir, 'src', 'loose.js'), 'module.exports = {};\n', 'utf8');
    eq(expand(repo.dir, 'src/loose.js', 'x').code, 'NOT_TRACKED');
  });

  test('S-R01: every scope field is required, and a malformed value is refused by name', () => {
    const scopeGate = load('scope-gate');
    const parsed = scopeGate.parseScope(SCOPE);
    eq(parsed.ok, true);
    eq(parsed.scope.workItemId, 'TASK-AI-78');
    eq(scopeGate.parseScope(parsed.scope).ok, true, 'parseScope is idempotent');
    eq(scopeGate.parseScope({ workItemId: 'TASK-AI-78', scope: SCOPE }).ok, true);
    const wanted = 'workItemId acceptanceIds ownedGlobs forbiddenGlobs testCommands';
    const numbers = 'maxDiffLines repairBudget maxToolCalls';
    for (const field of `${wanted} ${numbers}`.split(' ')) {
      const broken = Object.assign({}, SCOPE);
      delete broken[field];
      const res = scopeGate.parseScope(broken);
      eq(res.code, 'SCOPE_INVALID', `${field} must be required`);
      ok(res.problems.includes(field), `${field} must be named`);
    }
    const bad = '{"maxDiffLines":0} {"repairBudget":-1} {"maxToolCalls":0} {"acceptanceIds":[]}';
    for (const patch of bad.split(' ')) {
      eq(scopeGate.parseScope(Object.assign({}, SCOPE, JSON.parse(patch))).code, 'SCOPE_INVALID');
    }
  });

  test('S-R02: an in-scope diff passes; every other refusal lands by name', () => {
    const scopeGate = load('scope-gate');
    const clean = diffCase({ 'src/keep.js': 'module.exports = 2;\n' });
    eq(clean.ok, true);
    eq(clean.code, 'DIFF_OK');
    eq(clean.workItemId, 'TASK-AI-78');
    const both = diffCase({ 'README.md': '# drifted\n', 'docs/plan.md': '# plan v2\n' });
    eq(both.code, 'FORBIDDEN_PATH', 'precedence puts FORBIDDEN_PATH first');
    ok(both.refusals.some((one) => one.code === 'OUT_OF_OWNERSHIP'));
    eq(diffCase({ 'README.md': '# drifted\n' }).code, 'OUT_OF_OWNERSHIP');
    const dep = diffCase({ 'package.json': '{"name":"f","dependencies":{"left-pad":"1.0.0"}}' });
    eq(dep.code, 'DEPENDENCY_ADDED');
    eq(dep.reason, 'manifest');
    eq(diffCase({ 'package-lock.json': '{}' }).code, 'DEPENDENCY_ADDED');
    const owned = ['src/**', 'test/**', 'package.json', 'package-lock.json'];
    const allow = { allowDependencies: true, ownedGlobs: owned };
    eq(diffCase({ 'package-lock.json': '{}' }, allow).ok, true);
    const fat = diffCase({ 'src/keep.js': 'module.exports = 2;\n' }, { maxDiffLines: 1 });
    eq(fat.code, 'DIFF_BUDGET_EXCEEDED');
    const weak = KEEP_TEST.replace('%s', '  void 1;');
    const gone = diffCase({ 'test/keep.test.js': weak });
    eq(gone.code, 'ASSERTION_WEAKENED');
    eq(gone.removed, 1);
    eq(gone.added, 0);
    const back = KEEP_TEST.replace('%s', '  void 1;\n  assert.equal(1, 1);');
    eq(diffCase({ 'test/keep.test.js': back }).ok, true, 'an assertion returned is not weakening');
    eq(diffCase({}, null, { claim: { status: 'SUCCESS' } }).code, 'NO_EVIDENCE');
    const repo = gitRepo(BASE_REPO);
    fs.mkdirSync(path.join(repo.dir, 'reports'), { recursive: true });
    fs.writeFileSync(path.join(repo.dir, 'reports', 'test.log'), 'pass 3\n', 'utf8');
    const sha = repo.git('rev-parse', 'HEAD');
    const idle = { repoCwd: repo.dir, base: sha, head: sha, scope: scope() };
    const reports = ['reports/test.log', 'reports/missing.log'];
    const claim = { status: 'success' };
    const proven = scopeGate.checkDiff({ ...idle, claim, testReports: reports });
    eq(proven.ok, true);
    same(proven.testReports, ['reports/test.log']);
    eq(scopeGate.checkDiff(idle).ok, true, 'only a SUCCESS claim needs evidence');
    eq(diffCase({}, null, { repoCwd: '' }).code, 'DIFF_INPUT_INVALID');
    eq(diffCase({}, null, { scope: { workItemId: 'x' } }).code, 'SCOPE_INVALID');
  });

  test('S-R03: every writer action traces to a declared id and none may own the branch', () => {
    const scopeGate = load('scope-gate');
    const read = { kind: 'read', acceptanceId: 'R-R01' };
    const edit = { kind: 'edit', acceptanceId: 'S-R02' };
    const run = { kind: 'test', acceptanceId: 'O-R03' };
    const traced = scopeGate.checkTrace([read, edit, run], SCOPE);
    eq(traced.ok, true);
    same(ids(traced), ['R-R01', 'S-R02', 'O-R03']);
    const strayOne = { kind: 'edit', acceptanceId: 'O-R99' };
    const stray = scopeGate.checkTrace([read, edit, strayOne], SCOPE);
    eq(stray.code, 'UNTRACED_ACTION');
    eq(stray.acceptanceId, 'O-R99');
    eq(scopeGate.checkTrace([{ kind: 'edit' }], SCOPE).code, 'UNTRACED_ACTION');
    eq(scopeGate.checkTrace([{}], SCOPE).code, 'UNTRACED_ACTION');
    eq(scopeGate.checkTrace([read], { workItemId: 'x' }).code, 'SCOPE_INVALID');
    for (const kind of ['push', 'open_pr', 'merge', 'change_candidate', 'openPR', 'open-pr']) {
      const res = scopeGate.checkTrace([{ kind, acceptanceId: 'R-R01' }], SCOPE);
      eq(res.code, 'FORBIDDEN_ACTION', kind);
      eq(res.kind, scopeGate.normaliseKind(kind));
    }
  });

  test('O-R01/O-R02: small output passes through; large output parks redacted under its sha256', () => {
    const outputStore = load('output-store');
    const dir = tmpDir('ai78-out-');
    const small = 'line 1\nline 2\n';
    eq(outputStore.virtualize(small, { dir }), small);
    same(fs.readdirSync(dir), [], 'nothing is written under the threshold');
    const rows = Array.from({ length: 130 }, (unused, at) => `row ${at + 1} ${'x'.repeat(60)}`);
    const big = `${rows.join('\n')}\n`;
    const first = parked(dir, big);
    eq(first.sha256.length, 64);
    eq(first.handle, first.sha256);
    eq(first.summary.lines, 130);
    eq(first.summary.bytes, Buffer.byteLength(big, 'utf8'));
    eq(first.summary.omittedLines, 50);
    same(first.summary.head.split('\n'), rows.slice(0, 40));
    eq(fs.readFileSync(path.join(dir, `${first.sha256}.txt`), 'utf8'), big);
    eq(parked(dir, big).sha256, first.sha256, 'the same text parks once');
    eq(parked(dir, 'a\n'.repeat(50), 10).summary.lines, 50, 'thresholdBytes is honoured');

    const secrets = ['openai sk-ABCDEF0123456789abcDEF0123', 'github ghp_0123456789abcdefghijABC'];
    secrets.push('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature');
    const filler = Array.from({ length: 120 }, (unused, at) => `filler ${at} ${'y'.repeat(50)}`);
    const text = `${secrets.concat(filler).join('\n')}\n`;
    const sealed = parked(dir, text, 1024);
    const onDisk = fs.readFileSync(path.join(dir, `${sealed.sha256}.txt`), 'utf8');
    for (const secret of secrets) eq(onDisk.includes(secret.split(' ').pop()), false, secret);
    eq(onDisk.includes('Bearer'), false);
    ok(onDisk.includes('[REDACTED_SECRET]'));
    eq(onDisk, scrubText(text), 'the shared scrubber, not a second regex set');
    eq(sealed.summary.head.includes('sk-ABCDEF'), false, 'the summary is redacted too');
    eq(outputStore.read(sealed.handle, { dir }).text.includes('sk-ABCDEF'), false);
    eq(outputStore.read(sealed.handle).ok, true, 'a handle resolves without the dir');
  });

  test('O-R03: read returns a grep or line-range slice, clipped to whole lines and maxBytes', () => {
    const outputStore = load('output-store');
    const dir = tmpDir('ai78-read-');
    const rows = Array.from({ length: 200 }, (unused, at) => `line ${at + 1} ${'z'.repeat(40)}`);
    const artifact = parked(dir, `${rows.join('\n')}\n`, 512);
    const greped = outputStore.read(artifact.handle, { dir, grep: 'line 42 ' });
    eq(greped.matched, 1);
    eq(greped.matches[0].line, 42);
    const ranged = outputStore.read(artifact.handle, { dir, startLine: 10, endLine: 14 });
    same(ranged.lines, rows.slice(9, 14));
    const bounded = outputStore.read(artifact.handle, { dir, maxBytes: 100 });
    eq(bounded.truncated, true);
    eq(bounded.lines.length, 2);
    ok(bounded.bytes <= 100);
    eq(outputStore.read('not-a-handle', { dir }).code, 'HANDLE_INVALID');
    eq(outputStore.read('a'.repeat(64), { dir }).code, 'ARTIFACT_NOT_FOUND');
  });

  test('O-R04: rotate drops the oldest artifacts past the limits and only inside dir', () => {
    const outputStore = load('output-store');
    const dir = tmpDir('ai78-rot-');
    const ages = [3, 0.5, 0.25];
    const pads = [1, 2, 3].map((at) => `${`pad ${at} `.repeat(100)}\n`);
    const artifacts = pads.map((text) => parked(dir, text, 64));
    const hour = 60 * 60 * 1000;
    const now = Date.now();
    artifacts.forEach((artifact, at) => {
      const when = new Date(now - ages[at] * hour);
      fs.utimesSync(path.join(dir, `${artifact.sha256}.txt`), when, when);
    });
    const outside = path.join(tmpDir('ai78-rot-out-'), `${artifacts[0].sha256}.txt`);
    fs.writeFileSync(outside, 'untouched', 'utf8');
    const nested = path.join(dir, 'nested');
    fs.mkdirSync(nested);
    const aged = outputStore.rotate({ dir, maxAgeMs: 90 * 60 * 1000, maxBytes: 10 ** 7 });
    same(aged.deleted, [`${artifacts[0].sha256}.txt`], 'only the oldest is past maxAgeMs');
    eq(fs.existsSync(path.join(dir, `${artifacts[0].sha256}.txt`)), false);
    eq(fs.existsSync(nested), true, 'rotate never descends into a subdirectory');
    eq(fs.readFileSync(outside, 'utf8'), 'untouched', 'rotate only deletes inside dir');
    const sized = outputStore.rotate({ dir, maxAgeMs: 10 ** 9, maxBytes: 1000 });
    same(sized.deleted, [`${artifacts[1].sha256}.txt`]);
    ok(sized.bytes <= 1000);
    eq(outputStore.read(artifacts[1].handle, { dir }).code, 'ARTIFACT_NOT_FOUND');
    same(outputStore.rotate({ dir: tmpDir('ai78-rot-empty-') }).deleted, []);
  });

  test('F1 (O-R03): read() never returns more than maxBytes, not even for one long line', () => {
    const outputStore = load('output-store');
    const dir = tmpDir('ai78-f1-');
    const artifact = parked(dir, `${'X'.repeat(5000)}\nsecond line\n`, 64);
    const slice = outputStore.read(artifact.handle, { dir, maxBytes: 50 });
    eq(slice.ok, true);
    eq(slice.truncated, true);
    ok(slice.bytes <= 50, `maxBytes 50 respected, got ${slice.bytes}`);
    ok(slice.text.length < 5000, 'the oversized line is clipped, never returned whole');
    ok(outputStore.read(artifact.handle, { dir, maxBytes: 1 }).bytes <= 1);
  });

  test('F2 (R-R01): an expression-bodied arrow contributes its signature and never its body', () => {
    const dir = gitRepo(FIXTURE_REPO).dir;
    const built = map(dir, { budgetTokens: 100000 });
    eq(
      built.text.includes('ARROW_NO_BRACES_BODY_SECRET'),
      false,
      'no concise arrow body in the map'
    );
    ok(built.text.includes('const arrowNoBraces = (x) =>'));
  });

  test('F3 (S-R02): deleting a test file is ASSERTION_WEAKENED, not a clean pass', () => {
    const gone = diffCase({ remove: 'test/keep.test.js' });
    eq(gone.code, 'ASSERTION_WEAKENED');
    ok(gone.removed > 0, 'the assertions the deleted file carried are reported as removed');
    eq(gone.added, 0);
  });

  test('F4 (R-R02): the budget is never exceeded and an oversized top-rank file is skipped', () => {
    const dir = gitRepo(FIXTURE_REPO).dir;
    const starved = map(dir, { budgetTokens: 10 });
    eq(starved.text, '', 'a budget below the header emits nothing at all');
    eq(starved.tokens, 0);
    eq(starved.truncated, true);
    eq(starved.omitted, 3);
    for (const budget of [1, 12, 40, 90, 300]) {
      const sized = map(dir, { budgetTokens: budget });
      ok(sized.tokens <= budget, `budget ${budget} respected, got ${sized.tokens}`);
      eq(sized.files.length + sized.omitted, 3, 'every file is kept or reported omitted');
    }
    const ranked = map(gitRepo(RANK_FIXTURE).dir, { budgetTokens: 60 });
    same(listed(ranked), ['b-small.js'], 'the oversized top-rank file is skipped, not starved');
    eq(ranked.omitted, 1);
    ok(ranked.tokens <= 60);
  });

  test('F5 (S-R02): optionalDependencies and peerDependencies are DEPENDENCY_ADDED too', () => {
    for (const field of ['optionalDependencies', 'peerDependencies']) {
      const added = `{\n  "name": "fixture",\n  "${field}": { "left-pad": "1.0.0" }\n}\n`;
      const res = diffCase({ 'package.json': added });
      eq(res.code, 'DEPENDENCY_ADDED', field);
      eq(res.reason, 'manifest', field);
    }
  });

  test('N1 (S-R02): a rename is judged as delete(old) + add(new) for assertions and lines', () => {
    const scopeGate = load('scope-gate');
    // The assertions move out of the renamed path: the loss must still be caught.
    const hollow =
      "const assert = require('node:assert/strict');\n\ntest('k', () => {\n  void 1;\n});\n";
    const stripped = diffCase({ remove: 'test/keep.test.js', 'test/renamed.test.js': hollow });
    eq(stripped.code, 'ASSERTION_WEAKENED');
    ok(stripped.removed > 0, 'the assertions the pre-image carried are reported as removed');
    // The same rename with every assertion intact is not weakening.
    const intact = diffCase({
      remove: 'test/keep.test.js',
      'test/renamed.test.js': KEEP_TEST.replace('%s', '  assert.equal(1, 1);'),
    });
    eq(intact.code, 'DIFF_OK', 'a rename that keeps its assertions is not weakening');

    // Lines changed inside a renamed file count toward the diff budget.
    const repo = gitRepo(BASE_REPO);
    const rows = Array.from({ length: 120 }, (unused, at) => `const row${at} = ${at};`);
    repo.write({ 'src/service.js': `${rows.join('\n')}\n` });
    const base = repo.commit('add service');
    repo.write({
      'src/service.js': '',
      'src/service-v2.js': `${rows.join('\n')}\nconst extra = 1;\n`,
    });
    const head = repo.commit('rename and extend service');
    const renamed = scopeGate.checkDiff({
      repoCwd: repo.dir,
      base,
      head,
      scope: scope({ maxDiffLines: 100 }),
    });
    eq(renamed.code, 'DIFF_BUDGET_EXCEEDED', 'a rename cannot hide its line changes');
    ok(
      renamed.diffLines > 100,
      `expected the renamed lines to be counted, got ${renamed.diffLines}`
    );
  });

  test('N2 (S-R02): renaming a forbidden or unowned path into an owned one is still drift', () => {
    const smuggled = diffCase({ remove: 'docs/plan.md', 'src/plan.md': '# plan\n' });
    eq(smuggled.code, 'FORBIDDEN_PATH');
    eq(smuggled.path, 'docs/plan.md', 'the pre-image is judged, not only the destination');
    const hijacked = diffCase({ remove: 'README.md', 'src/readme.md': '# base\n' });
    eq(hijacked.code, 'OUT_OF_OWNERSHIP');
    eq(hijacked.path, 'README.md', 'the pre-image is judged, not only the destination');
    const allowed = diffCase({ remove: 'src/keep.js', 'src/keep2.js': 'module.exports = 2;\n' });
    eq(allowed.ok, true, 'a rename inside the owned globs is still allowed');
  });
});
