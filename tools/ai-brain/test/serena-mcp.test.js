'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { assertReadOnlyProject, serverCommand, callSerena, SERENA_REF } = require('../serena-mcp');

const root = path.resolve(__dirname, '../../..');

function project(yml) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serena-'));
  if (yml !== null) {
    fs.mkdirSync(path.join(dir, '.serena'));
    fs.writeFileSync(path.join(dir, '.serena', 'project.yml'), yml);
  }
  return dir;
}

test('the committed Serena project is read-only and TypeScript-backed', () => {
  assertReadOnlyProject(root);
  assert.match(
    fs.readFileSync(path.join(root, '.serena/project.yml'), 'utf8'),
    /^language_servers: \["typescript"\]$/m
  );
});

test('a project without read_only: true is refused before Serena starts', () => {
  assert.throws(() => assertReadOnlyProject(project(null)), /SERENA_PROJECT_MISSING/);
  assert.throws(() => assertReadOnlyProject(project('read_only: false\n')), /SERENA_NOT_READ_ONLY/);
});

test('editing tools are refused without launching Serena', async () => {
  await assert.rejects(
    callSerena(root, [{ name: 'rename_symbol', arguments: {} }]),
    /MUTATION_REFUSED: rename_symbol/
  );
});

test('server runs the pinned ref over stdio with the tools interface and no dashboard', () => {
  const { args } = serverCommand('/repo');
  assert.equal(args[args.indexOf('--from') + 1], process.env.SERENA_FROM || SERENA_REF);
  for (const [flag, value] of [
    ['--project', '/repo'],
    ['--transport', 'stdio'],
    ['--agent-interface', 'tools'],
    ['--enable-web-dashboard', 'false'],
  ]) {
    assert.equal(args[args.indexOf(flag) + 1], value, flag);
  }
});
