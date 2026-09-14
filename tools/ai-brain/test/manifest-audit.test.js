'use strict';

/**
 * Ship Dễ — manifest audit, the two directions it can be wrong in
 *
 * The audit exists to stop the manifest claiming more than is true. These
 * tests cover the ways it failed to do that, each of which was found by
 * review rather than by the audit itself.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { auditManifest } = require('../manifest-audit');

function entry(over) {
  return Object.assign(
    {
      id: 'thing',
      name: 'Thing',
      repository: 'owner/thing',
      role: 'A tool',
      install_method: 'system',
      pinned_version_or_commit: '1.0.0',
      lifecycle_state: 'ADOPTED',
      blocking_policy: 'NON_BLOCKING',
    },
    over
  );
}

function audit(entries, opts) {
  return auditManifest({ adopted: entries }, Object.assign({ onPath: () => false }, opts || {}));
}

function codes(result) {
  return result.findings.map((f) => f.code);
}

describe('A tool the CI runner provides is not a missing tool', () => {
  // gitleaks is installed at the pinned version by two workflows and enforced
  // as a blocking gate on every Pull Request. `where gitleaks` asks this
  // machine, sees nothing, and the audit raised QUALITY_GATE_MISSING against a
  // gate that was running at that moment.
  let dir;

  function withWorkflow(body) {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-manifest-'));
    fs.mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.github', 'workflows', 'security.yml'), body);
    return dir;
  }

  test('a ci-provisioned gate installed by a workflow reads as present', () => {
    const root = withWorkflow(
      'jobs:\n  scan:\n    steps:\n      - name: Install Pinned Gitleaks\n' +
        '        run: curl -sSL https://example/gitleaks.tar.gz | tar -xz gitleaks\n'
    );
    const r = audit([entry({ id: 'gitleaks', install_method: 'ci-provisioned' })], {
      rootDir: root,
    });
    assert.deepStrictEqual(codes(r), []);
    assert.strictEqual(r.rows[0].present, true);
  });

  test('a ci-provisioned gate no workflow installs is still reported missing', () => {
    const root = withWorkflow('jobs:\n  scan:\n    steps:\n      - run: echo nothing here\n');
    const r = audit([entry({ id: 'gitleaks', install_method: 'ci-provisioned' })], {
      rootDir: root,
    });
    assert.ok(codes(r).includes('QUALITY_GATE_MISSING'));
  });
});

describe('Understating reality is a finding too', () => {
  // Every other rule catches the manifest claiming more than is true. PENDING
  // produced no finding under any condition, so demoting a record removed it
  // from the audit's reach — a way to reach zero findings without matching
  // anything to reality.
  test('a tool declared PENDING while present is reported', () => {
    const r = audit([entry({ id: 'present-thing', lifecycle_state: 'PENDING' })], {
      onPath: () => true,
    });
    assert.ok(codes(r).includes('DECLARED_PENDING_BUT_PRESENT'));
    assert.strictEqual(r.findings[0].severity, 'warn');
  });

  test('a tool declared PENDING and genuinely absent stays silent', () => {
    const r = audit([entry({ id: 'absent-thing', lifecycle_state: 'PENDING' })]);
    assert.deepStrictEqual(codes(r), []);
  });
});

describe('A workspace entry names a checkout, not any package.json', () => {
  // The check tested for rootDir/package.json, which is true whenever the
  // audit runs at all, so every workspace entry read as present. shipde-brain
  // has never been created and still reported present.
  test('a sibling checkout that does not exist reads as absent', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-ws-'));
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'something-else' }));
    const r = audit(
      [entry({ id: 'never-created', install_method: 'workspace', lifecycle_state: 'PENDING' })],
      {
        rootDir: root,
      }
    );
    assert.strictEqual(r.rows[0].present, false);
  });

  test('this repository identifies itself by manifest name, not directory name', () => {
    // A git worktree lives under a generated path, so the directory name is
    // not the repository's name.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-generated-'));
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'shipde-platform' }));
    const r = audit(
      [
        entry({
          id: 'shipde-platform',
          install_method: 'workspace',
          lifecycle_state: 'INTEGRATED',
        }),
      ],
      { rootDir: root }
    );
    assert.strictEqual(r.rows[0].present, true);
    assert.deepStrictEqual(codes(r), []);
  });
});

describe('A version written down by hand is still checked', () => {
  // observed_version_or_commit was free text nothing read, so a note taken
  // once drifted silently against the pin it was meant to track.
  test('an observed version that differs from the pin is reported', () => {
    const r = audit([
      entry({
        id: 'codex-cli',
        pinned_version_or_commit: '0.151.0',
        observed_version_or_commit: '0.154.0',
      }),
    ]);
    assert.ok(codes(r).includes('PINNED_VERSION_DRIFT'));
    const f = r.findings.find((x) => x.code === 'PINNED_VERSION_DRIFT');
    assert.strictEqual(f.severity, 'warn');
    assert.deepStrictEqual(f.evidence, { pinned: '0.151.0', observed: '0.154.0' });
  });

  test('an observed version matching the pin says nothing', () => {
    const r = audit([
      entry({
        id: 'thing',
        pinned_version_or_commit: '1.0.0',
        observed_version_or_commit: '1.0.0',
      }),
    ]);
    assert.ok(!codes(r).includes('PINNED_VERSION_DRIFT'));
  });

  test('no observed version recorded is not a finding', () => {
    const r = audit([entry({ id: 'thing' })]);
    assert.ok(!codes(r).includes('PINNED_VERSION_DRIFT'));
  });
});

describe('The CI probe fails safe, and survives an awkward id', () => {
  test('an unreadable workflows directory is unverifiable, not absent', () => {
    // null means "cannot tell". Returning false would let a missing blocking
    // gate go quiet on any checkout without .github/workflows.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-nowf-'));
    const r = audit([entry({ id: 'gitleaks', install_method: 'ci-provisioned' })], {
      rootDir: root,
    });
    assert.strictEqual(r.rows[0].present, null);
    assert.deepStrictEqual(codes(r), []);
  });

  test('an id containing regex metacharacters does not throw', () => {
    // An exception here would take the whole audit run down.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-meta-'));
    fs.mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true });
    fs.writeFileSync(
      path.join(root, '.github', 'workflows', 'w.yml'),
      'steps:\n  - run: curl -sSL install gitleaks\n'
    );
    assert.doesNotThrow(() => {
      const r = audit([entry({ id: 'a+b(c)', install_method: 'ci-provisioned' })], {
        rootDir: root,
      });
      assert.strictEqual(r.rows[0].present, false);
    });
  });
});
