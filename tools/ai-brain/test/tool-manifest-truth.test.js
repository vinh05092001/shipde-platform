'use strict';

// GOAL-AUTOCLAW-REPOS-1 — AC-1/AC-2/AC-4 truth checks for tools/ai-brain/data/tool-manifest.json.
//
// The manifest is the machine-readable inventory of adopted repositories and tools. This test
// re-reads the repository's real files instead of trusting the manifest's own claims:
//   * AC-1: every entry has `installed` as a boolean (never "UNKNOWN") and an `evidenceRef` that
//     points at a file that actually exists in this repository.
//   * AC-1 (strong): every entry with `installed: true` cites a package.json, and the cited key
//     really contains the dependency/script that the entry claims — compared against an explicit
//     expectation table, in both directions, so a false `true` and an unverified `true` both fail.
//   * AC-2: every gate entry has a runnable command, or is explicitly marked blocked with a reason.
//   * AC-4: the check only reads files; it installs nothing and runs no external tool.

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const TOOL_MANIFEST_PATH = path.join(__dirname, '..', 'data', 'tool-manifest.json');

function readManifest() {
  const raw = fs.readFileSync(TOOL_MANIFEST_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  assert.ok(Array.isArray(parsed), 'tool-manifest.json must be an array');
  return parsed;
}

// Every entry that legitimately claims `installed: true` must prove itself here: the cited file
// exists, the cited path resolves, and the named member is really present.
const INSTALLED_EXPECTATIONS = {
  eslint: { file: 'package.json', section: 'devDependencies', member: 'eslint' },
  lefthook: { file: 'package.json', section: 'devDependencies', member: 'lefthook' },
  supertest: { file: 'apps/api/package.json', section: 'devDependencies', member: 'supertest' },
  gitleaks: { file: 'package.json', section: 'scripts', member: 'security:secrets' },
  msw: { file: 'packages/testkit/package.json', section: 'dependencies', member: 'msw' },
  nestjs: { file: 'apps/api/package.json', section: 'dependencies', member: '@nestjs/common' },
  node: { file: 'package.json', section: 'engines', member: 'node' },
  'opentelemetry-js': {
    file: 'apps/api/package.json',
    section: 'dependencies',
    member: '@opentelemetry/api',
  },
  'openapi-typescript': {
    file: 'package.json',
    section: 'devDependencies',
    member: 'openapi-typescript',
  },
  pnpm: { file: 'package.json', section: 'packageManager', member: null, pattern: /^pnpm@\d+/ },
  prettier: { file: 'package.json', section: 'devDependencies', member: 'prettier' },
  prisma: { file: 'package.json', section: 'devDependencies', member: 'prisma' },
  turbo: { file: 'package.json', section: 'devDependencies', member: 'turbo' },
};

function readJson(relativePath) {
  const absolute = path.join(REPO_ROOT, relativePath);
  assert.ok(fs.existsSync(absolute), `expected repository file to exist: ${relativePath}`);
  return JSON.parse(fs.readFileSync(absolute, 'utf8'));
}

describe('GOAL-AUTOCLAW-REPOS-1 — tool-manifest truth (AC-1, AC-2, AC-4)', () => {
  test('the manifest exists and is valid JSON', () => {
    assert.ok(fs.existsSync(TOOL_MANIFEST_PATH), 'tool-manifest.json must exist');
    const manifest = readManifest();
    assert.ok(manifest.length > 0, 'the manifest must not be empty');
  });

  test('AC-1: every installed flag is a boolean and never the string UNKNOWN', () => {
    const raw = fs.readFileSync(TOOL_MANIFEST_PATH, 'utf8');
    assert.ok(
      !raw.includes('"UNKNOWN"'),
      'the manifest text must not contain any "UNKNOWN" installed value'
    );
    for (const entry of readManifest()) {
      assert.strictEqual(
        typeof entry.installed,
        'boolean',
        `${entry.id}: installed must be true or false, got ${JSON.stringify(entry.installed)}`
      );
    }
  });

  test('AC-1: every evidenceRef names a real file in this repository', () => {
    for (const entry of readManifest()) {
      assert.ok(
        typeof entry.evidenceRef === 'string' && entry.evidenceRef.trim().length > 0,
        `${entry.id}: evidenceRef must be a non-empty string`
      );
      const filePart = entry.evidenceRef.split(':')[0].split('#')[0].trim();
      const resolved = path.join(REPO_ROOT, filePart);
      assert.ok(
        fs.existsSync(resolved),
        `${entry.id}: evidenceRef points at a missing file: ${filePart}`
      );
    }
  });

  test('AC-1: every installed:true entry cites a package.json it can actually prove', () => {
    for (const entry of readManifest()) {
      if (entry.installed !== true) continue;
      assert.ok(
        entry.evidenceRef.includes('package.json'),
        `${entry.id}: an installed entry must cite a package.json, got ${entry.evidenceRef}`
      );
    }
  });

  test('AC-1: installed:true claims match the real contents of the cited package.json files', () => {
    const manifest = readManifest();
    const claimedTrue = manifest
      .filter((entry) => entry.installed === true)
      .map((entry) => entry.id)
      .sort();
    const expectedTrue = Object.keys(INSTALLED_EXPECTATIONS).sort();
    assert.deepStrictEqual(
      claimedTrue,
      expectedTrue,
      'the set of installed entries must equal the verified expectation table'
    );

    for (const [id, expect] of Object.entries(INSTALLED_EXPECTATIONS)) {
      const pkg = readJson(expect.file);
      const section = pkg[expect.section];
      if (expect.member === null) {
        assert.match(
          String(section || ''),
          expect.pattern,
          `${id}: ${expect.file}.${expect.section} must match ${expect.pattern}`
        );
        continue;
      }
      assert.ok(
        section && typeof section === 'object',
        `${id}: ${expect.file} has no ${expect.section} section`
      );
      assert.ok(
        Object.prototype.hasOwnProperty.call(section, expect.member),
        `${id}: ${expect.file}.${expect.section} does not declare ${expect.member}`
      );
    }
  });

  test('AC-1: pnpm is pinned by packageManager and node by engines', () => {
    const pkg = readJson('package.json');
    assert.match(
      String(pkg.packageManager || ''),
      /^pnpm@\d+/,
      'package.json must pin pnpm via packageManager'
    );
    assert.ok(
      String(pkg.engines?.node || '').length > 0,
      'package.json must declare a node engine'
    );

    const byId = Object.fromEntries(readManifest().map((entry) => [entry.id, entry]));
    assert.equal(byId.pnpm.installed, true, 'pnpm must be installed:true');
    assert.equal(byId.pnpm.evidenceRef, 'package.json:packageManager');
    assert.equal(byId.node.installed, true, 'node must be installed:true');
    assert.equal(byId.node.evidenceRef, 'package.json:engines');
  });

  test('AC-2: every gate entry has a runnable command or an explicit blocked reason', () => {
    const gates = readManifest().filter((entry) => entry.gate === true);
    assert.ok(
      gates.length >= 2,
      'the manifest must carry at least gitleaks and agent-scan as gates'
    );

    for (const entry of gates) {
      const hasCommand = typeof entry.command === 'string' && entry.command.trim().length > 0;
      const reason = entry.blockedReason || entry.note;
      const blockedWithReason =
        entry.blocked === true && typeof reason === 'string' && reason.trim().length > 0;
      assert.ok(
        hasCommand || blockedWithReason,
        `${entry.id}: a gate needs a command, or blocked:true with a reason`
      );
      if (!hasCommand) {
        assert.equal(
          entry.command,
          null,
          `${entry.id}: an unavailable gate must have command null`
        );
      }
    }
  });

  test('AC-2: gitleaks runs a real repository script and agent-scan is a blocked, non-passing gate', () => {
    const byId = Object.fromEntries(readManifest().map((entry) => [entry.id, entry]));

    const gitleaks = byId.gitleaks;
    assert.ok(gitleaks, 'gitleaks must be declared');
    assert.equal(gitleaks.gate, true, 'gitleaks must be a gate');
    assert.equal(gitleaks.command, 'security:secrets', 'gitleaks must run the secrets gate script');
    const pkg = readJson('package.json');
    assert.ok(
      pkg.scripts && pkg.scripts['security:secrets'],
      'package.json must define the security:secrets script gitleaks runs'
    );

    const agentScan = byId['agent-scan'];
    assert.ok(agentScan, 'agent-scan must be declared');
    assert.equal(agentScan.gate, true, 'agent-scan must be a gate');
    assert.equal(agentScan.command, null, 'agent-scan has no runnable command on this host');
    assert.equal(agentScan.blocked, true, 'agent-scan must be marked blocked');
    assert.ok(
      typeof agentScan.blockedReason === 'string' && agentScan.blockedReason.length > 0,
      'agent-scan must carry a blockedReason'
    );
    assert.equal(agentScan.installed, false, 'agent-scan is not installed here');
  });

  test('AC-4: no entry asks for an install — the manifest only records evidence', () => {
    const forbidden = /pnpm add|npm i |npm install|pip install|winget install|choco install/;
    for (const entry of readManifest()) {
      const fields = [entry.command, entry.evidenceRef, entry.note, entry.blockedReason]
        .filter((value) => typeof value === 'string')
        .join(' ');
      assert.ok(!forbidden.test(fields), `${entry.id}: the manifest must not request an install`);
    }
  });
});
