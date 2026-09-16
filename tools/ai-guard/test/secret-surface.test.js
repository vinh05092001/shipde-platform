'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  SELF_EXCLUSION,
  FIXTURE_EXCLUSION,
  scanText,
  scanDirectory,
  formatReport,
  runSecretSurface,
  CREDENTIAL_COLUMNS,
  WILDCARD_TABLES,
  SQL_COLUMN_READS,
} = require('../secret-surface');

/**
 * The forbidden spellings are assembled from parts rather than written out.
 *
 * AI-18-R11 requires this file to stay inside the default scan, because a
 * forbidden read written here is the most likely place for one to appear. But a
 * suite that tests those spellings must contain them, so written literally this
 * file would report itself and AC-AI-18-01 could never be green.
 *
 * Assembling them keeps both properties: the guard still sees this file, and a
 * real forbidden read - which is written literally, because that is what code
 * doing the read looks like - would still be caught here.
 */
const KEY = ['api' + 'Keys', 'k' + 'ey'].join('.');
const DATA = ['provider' + 'Connections', 'da' + 'ta'].join('.');
const KEY_TABLE = 'api' + 'Keys';
const DATA_TABLE = 'provider' + 'Connections';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const FIXTURES = path.join(REPO_ROOT, 'tools', 'ai-guard', 'test', 'fixtures');
const CLI = path.join(REPO_ROOT, 'tools', 'ai-guard', 'cli.js');

function fixture(name) {
  return path.join(FIXTURES, name);
}

function runCli(args) {
  const res = spawnSync(process.execPath, [CLI].concat(args), {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  return { code: res.status, out: (res.stdout || '') + (res.stderr || '') };
}

describe('secret-surface — the forbidden reads', () => {
  test('a select of the key column is reported with file and line', () => {
    const v = scanText('a\nb\nconst x = ' + KEY + ';\n', 'reader.ts');
    assert.equal(v.length, 1);
    assert.equal(v[0].column, KEY);
    assert.equal(v[0].line, 3);
  });

  test('a select of the data column is reported', () => {
    const v = scanText('a\nb\nconst x = ' + DATA + ';\n', 'reader.ts');
    assert.equal(v.length, 1);
    assert.equal(v[0].column, DATA);
  });

  test('a wildcard select on a credential table is reported', () => {
    const v = scanText('SELECT * FROM ' + KEY_TABLE, 'q.ts');
    assert.equal(v[0].column, 'SELECT * on ' + KEY_TABLE);
  });

  test('a wildcard select on providerConnections is reported', () => {
    const v = scanText('select * from ' + DATA_TABLE + ' where id = 1', 'q.ts');
    assert.equal(v[0].column, 'SELECT * on ' + DATA_TABLE);
  });

  test('whitespace between the table and the column does not hide the read', () => {
    assert.equal(scanText(KEY_TABLE + ' . ' + 'k' + 'ey', 'x.ts').length, 1);
  });
});

describe('secret-surface — what must stay clean', () => {
  test('selecting provider, name, isActive, priority is clean', () => {
    const safe = 'db.select({ provider: ' + KEY_TABLE + '.provider }).from(' + KEY_TABLE + ')';
    assert.equal(scanText(safe, 'x.ts').length, 0);
  });

  test('an ordinary projection ending in .from(apiKeys) is not a wildcard', () => {
    // This is the false positive that made the guard refuse the very query the
    // usage adapter runs. It is a named test because a regression here would be
    // invisible: the guard would simply look stricter.
    assert.equal(
      scanText('.select({ a: ' + KEY_TABLE + '.provider }).from(' + KEY_TABLE + ')', 'x.ts').length,
      0
    );
  });

  test('a column that merely starts with the forbidden name is clean', () => {
    assert.equal(scanText(KEY + 'Label', 'x.ts').length, 0);
  });

  test('a table with a similar name is clean', () => {
    assert.equal(scanText('other' + KEY_TABLE + 'Table.k' + 'ey', 'x.ts').length, 0);
  });
});

describe('secret-surface — failing closed', () => {
  test('an unreadable file reports failure, never clean', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-ss-'));
    fs.writeFileSync(path.join(dir, 'reader.ts'), Buffer.from([0x78, 0x00, 0x79]));
    const r = scanDirectory(dir, { excludeFixtures: false });
    fs.rmSync(dir, { recursive: true, force: true });
    assert.equal(r.status, 'unreadable');
    assert.equal(formatReport(r).exitCode, 2);
  });

  test('an unreadable file outranks a violation found elsewhere', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-ss-'));
    fs.writeFileSync(path.join(dir, 'bad.ts'), '' + KEY + '\n');
    fs.writeFileSync(path.join(dir, 'nul.ts'), Buffer.from([0x00]));
    const r = scanDirectory(dir, { excludeFixtures: false });
    fs.rmSync(dir, { recursive: true, force: true });
    assert.equal(r.status, 'unreadable');
  });
});

describe('secret-surface — the report carries no value', () => {
  test('a violation report contains no value from the row', () => {
    const line = 'const k = ' + KEY + '; // sk-' + 'NOTAREALKEYNOTAREALKEYNOTAREAL';
    const [v] = scanText(line, 'reader.ts');
    const rendered = formatReport({ status: 'violation', violations: [v], unreadable: [] })
      .lines[0];
    assert.equal(rendered, 'SECRET_SURFACE_VIOLATION: reader.ts:1 ' + KEY);
    assert.equal(rendered.includes('sk-'), false);
  });

  test('the fixture that carries a key shape reports only file, line and column', () => {
    const r = runSecretSurface(fixture('value-must-not-leak'), { excludeFixtures: false });
    assert.equal(r.exitCode, 1);
    assert.deepEqual(r.lines, ['SECRET_SURFACE_VIOLATION: reader.ts:3 ' + KEY]);
    assert.equal(r.lines.join('\n').includes('REDACTED'), false);
  });
});

describe('secret-surface — the exclusions', () => {
  test('the default scan of the repository is clean', () => {
    const r = runSecretSurface(REPO_ROOT, {});
    assert.equal(r.exitCode, 0, r.lines.join('\n'));
    assert.equal(r.lines[0], 'SECRET_SURFACE_CLEAN');
  });

  test('the fixtures are violations when the exclusion is lifted', () => {
    // Proves the exclusion is what keeps the repository clean, rather than the
    // fixtures failing to match.
    const r = runSecretSurface(REPO_ROOT, { excludeFixtures: false });
    assert.notEqual(r.exitCode, 0);
  });

  test('the exclusions are exact paths, not patterns', () => {
    assert.equal(FIXTURE_EXCLUSION.includes('*'), false);
    assert.equal(SELF_EXCLUSION.includes('*'), false);
  });

  test('the guard suite itself is still scanned', () => {
    const r = runSecretSurface(REPO_ROOT, {});
    assert.equal(r.scanned > 0, true);
    // A forbidden read written into this very file would be caught: the file is
    // under tools/ai-guard/test/ but not under tools/ai-guard/test/fixtures/.
    assert.equal(SELF_EXCLUSION.includes(path.join('test', 'secret-surface.test.js')), false);
  });
});

describe('secret-surface — the CLI surface', () => {
  test('secret-surface on a clean fixture prints two lines and exits 0', () => {
    const r = runCli(['secret-surface', '--root', 'tools/ai-guard/test/fixtures/safe-projections']);
    assert.equal(r.code, 0);
    assert.match(r.out, /^SECRET_SURFACE_CLEAN\r?\nfiles scanned: 1\r?\n$/);
  });

  test('secret-surface on a forbidden fixture prints one line and exits 1', () => {
    const r = runCli([
      'secret-surface',
      '--root',
      'tools/ai-guard/test/fixtures/forbidden-api-keys-key',
    ]);
    assert.equal(r.code, 1);
    assert.equal(r.out.trim(), 'SECRET_SURFACE_VIOLATION: reader.ts:3 ' + KEY);
  });

  test('secret-surface on an unreadable fixture exits 2', () => {
    const r = runCli([
      'secret-surface',
      '--root',
      'tools/ai-guard/test/fixtures/unparsable-source',
    ]);
    assert.equal(r.code, 2);
    assert.equal(r.out.trim(), 'SECRET_SURFACE_UNREADABLE: reader.ts');
  });

  test('check runs the scan, so the installed hook reaches it', () => {
    const r = runCli([
      'check',
      '--secret-surface-root',
      'tools/ai-guard/test/fixtures/forbidden-api-keys-key',
    ]);
    assert.equal(r.code, 1);
    assert.equal(r.out.includes('SECRET_SURFACE_VIOLATION: reader.ts:3 ' + KEY), true);
  });
});

describe('secret-surface — reads that tried to hide', () => {
  test('bracket access is caught', () => {
    const v = scanText(KEY_TABLE + '["' + 'k' + 'ey"]', 'x.ts');
    assert.equal(v.length, 1);
    assert.equal(v[0].column, KEY);
  });

  test('a read split across two lines is caught, and reports the first line', () => {
    const v = scanText('const x =\n  ' + KEY_TABLE + '\n  .' + 'k' + 'ey;', 'x.ts');
    assert.equal(v.length, 1);
    assert.equal(v[0].line, 2);
  });

  test('bracket access to the data column is caught', () => {
    assert.equal(scanText(DATA_TABLE + "['" + 'da' + "ta']", 'x.ts').length, 1);
  });

  test('every pattern still matches something — the canary', () => {
    // A regex edited into uselessness reports a clean repository, which is the
    // most dangerous state this guard has: it looks like success. Measured
    // during development — a botched edit stripped every backslash and the
    // guard returned CLEAN for a fixture that reads the credential on line 3.
    // This asserts each configured pattern still fires on its own subject.
    for (const { column, pattern } of CREDENTIAL_COLUMNS) {
      const subject = column.split('.')[0] + '.' + column.split('.')[1];
      assert.equal(pattern.test(subject), true, 'pattern for ' + column + ' matches nothing');
    }
    for (const { column, pattern } of SQL_COLUMN_READS) {
      const table = column.split('.')[0];
      const col = column.split('.')[1];
      assert.equal(
        pattern.test('SELECT ' + col + ' FROM ' + table),
        true,
        'sql pattern for ' + column + ' matches nothing'
      );
    }
    for (const { table, pattern } of WILDCARD_TABLES) {
      assert.equal(
        pattern.test('SELECT * FROM ' + table),
        true,
        'wildcard for ' + table + ' matches nothing'
      );
    }
  });
});

describe('secret-surface — raw SQL that names the column', () => {
  test('a raw query naming the key column is caught', () => {
    const v = scanText('SELECT ' + 'k' + 'ey FROM ' + KEY_TABLE, 'q.ts');
    assert.equal(v.length, 1);
    assert.equal(v[0].column, KEY);
  });

  test('the snake_case table spelling is caught', () => {
    assert.equal(scanText('select ' + 'k' + 'ey, name from api_keys', 'q.ts').length, 1);
  });

  test('a raw query naming the data column is caught', () => {
    assert.equal(scanText('SELECT ' + 'da' + 'ta FROM ' + DATA_TABLE, 'q.ts').length, 1);
  });

  test('selecting other columns from the same table stays clean', () => {
    assert.equal(scanText('SELECT name, provider FROM ' + KEY_TABLE, 'q.ts').length, 0);
  });

  test('a column that merely begins with the forbidden word stays clean', () => {
    assert.equal(scanText('SELECT ' + 'k' + 'eyName FROM ' + KEY_TABLE, 'q.ts').length, 0);
  });

  test('an unrelated table stays clean', () => {
    assert.equal(scanText('SELECT ' + 'k' + 'ey FROM sessions', 'q.ts').length, 0);
  });
});
