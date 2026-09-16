'use strict';

/**
 * Ship Dễ — Secret surface guard.
 *
 * 9Router stores provider credentials in plaintext in a database Ship Dễ does
 * not own and cannot fix. What Ship Dễ can control is whether its own code ever
 * reads those columns. This guard scans Ship Dễ source and fails closed when it
 * finds such a read.
 *
 * Forbidden reads:
 *   - `apiKeys.key`
 *   - `providerConnections.data`
 *   - `SELECT *` against either table, which reaches those columns implicitly
 *     without naming them.
 *
 * The guard reports a file, a line and a column name. It never reports a value,
 * because a tool that quotes a credential to prove a credential was exposed has
 * exposed it again (AI-18-R05).
 */

const fs = require('fs');
const path = require('path');

/**
 * The guard's own negative fixtures live here and are violations by
 * construction. The exclusion is this exact path and not a broad pattern such
 * as every directory named `test`: a broad skip would also blind the guard to a
 * forbidden read written into `tools/ai-guard/test/secret-surface.test.js`,
 * which is the more likely place for one to appear (AI-18-R11).
 */
const FIXTURE_EXCLUSION = path.join('tools', 'ai-guard', 'test', 'fixtures');

/**
 * This file is excluded from the default scan because it is the file that
 * defines the forbidden spellings: it necessarily contains them, in its
 * patterns and in the comments that explain them. Without this exclusion the
 * guard reports itself and a clean repository is unreachable.
 *
 * Like the fixture exclusion this is an exact path, not a pattern, and it is
 * the narrowest possible: every other file under tools/ai-guard/ is still
 * scanned, including the suite that tests this one.
 */
const SELF_EXCLUSION = path.join('tools', 'ai-guard', 'secret-surface.js');

const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  '.worktrees',
  'dist',
  'build',
  '.next',
]);

const SCANNED_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx']);

const CREDENTIAL_COLUMNS = [
  {
    column: 'apiKeys.key',
    // Dot access and bracket access, with any whitespace between the table and
    // the column, a newline included. Measured: without the newline case a read
    // split across two lines by a formatter was invisible, and without the
    // bracket case the subscript spelling was invisible.
    pattern: /\bapiKeys\s*(?:\.\s*key\b|\[\s*['"`]key['"`]\s*\])/,
  },
  {
    column: 'providerConnections.data',
    pattern: /\bproviderConnections\s*(?:\.\s*data\b|\[\s*['"`]data['"`]\s*\])/,
  },
];

const WILDCARD_TABLES = [
  {
    table: 'apiKeys',
    // Two spellings and no more: the SQL wildcard, and a builder chain whose
    // select() names nothing before .from(apiKeys). A bare `.from(apiKeys)` is
    // deliberately NOT matched - every ordinary projection ends that way,
    // including the safe one the usage adapter uses, and matching it made this
    // guard refuse the exact query this Work Item exists to permit.
    pattern:
      /select\s+\*\s+from\s+["'`[]?apiKeys\b|\.select\s*\(\s*\)\s*\.from\s*\(\s*apiKeys\s*\)/i,
  },
  {
    table: 'providerConnections',
    pattern:
      /select\s+\*\s+from\s+["'`[]?providerConnections\b|\.select\s*\(\s*\)\s*\.from\s*\(\s*providerConnections\s*\)/i,
  },
];

/**
 * One source text's violations, in line order.
 */

/**
 * Raw SQL that names the credential column explicitly.
 *
 * Found by an independent review after the first version shipped: the guard
 * caught `SELECT *` and JavaScript property access, so `SELECT key FROM apiKeys`
 * — a direct read of the credential, written as plainly as it can be written —
 * walked straight through. The wildcard rule existed because a wildcard reaches
 * the column without naming it; naming it was never covered.
 *
 * The select list is bounded by the FROM so a query selecting other columns
 * from the same table stays clean, and the column is matched on a word boundary
 * so `keyName` and `keyId` are not credentials.
 */
const SQL_COLUMN_READS = [
  {
    column: 'apiKeys.key',
    pattern:
      /\bselect\b(?![\s\S]*?\bfrom\b[\s\S]*?\bfrom\b)[\s\S]{0,200}?\bkey\b[\s\S]{0,200}?\bfrom\s+["'`\[]?api_?keys\b/i,
  },
  {
    column: 'providerConnections.data',
    pattern:
      /\bselect\b[\s\S]{0,200}?\bdata\b[\s\S]{0,200}?\bfrom\s+["'`\[]?provider_?connections\b/i,
  },
];

/**
 * Line number of a character offset, 1-based.
 */
function lineAt(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (text.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

/**
 * One source text's violations, in the order they appear.
 *
 * The scan runs over the whole text rather than line by line, because a read
 * split across two lines by a formatter - `apiKeys` on one line and `.key` on
 * the next - is the same read, and a line-by-line scan cannot see it. The line
 * number reported is the line the match starts on.
 */
function scanText(text, displayPath) {
  const found = [];

  function collect(pattern, column) {
    const rx = new RegExp(
      pattern.source,
      pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g'
    );
    let m;
    while ((m = rx.exec(text)) !== null) {
      found.push({ index: m.index, file: displayPath, line: lineAt(text, m.index), column });
      if (m.index === rx.lastIndex) rx.lastIndex += 1;
    }
  }

  for (const { column, pattern } of CREDENTIAL_COLUMNS) collect(pattern, column);
  for (const { table, pattern } of WILDCARD_TABLES) collect(pattern, 'SELECT * on ' + table);
  for (const { column, pattern } of SQL_COLUMN_READS) collect(pattern, column);

  found.sort((x, y) => x.index - y.index);
  return found.map((f) => ({ file: f.file, line: f.line, column: f.column }));
}

function collectFiles(rootDir, options) {
  const opts = options || {};
  const excludeFixtures = opts.excludeFixtures !== false;
  const out = [];

  function walk(absoluteDir) {
    let entries;
    try {
      entries = fs.readdirSync(absoluteDir, { withFileTypes: true });
    } catch (err) {
      out.push({ absolute: absoluteDir, unreadable: true });
      return;
    }
    for (const entry of entries) {
      const absolute = path.join(absoluteDir, entry.name);
      const relative = path.relative(rootDir, absolute);
      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
        if (excludeFixtures && relative === FIXTURE_EXCLUSION) continue;
        walk(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!SCANNED_EXTENSIONS.has(path.extname(entry.name))) continue;
      if (excludeFixtures && relative === SELF_EXCLUSION) continue;
      // Forward slashes always: a report that differs by platform cannot be
      // asserted by an acceptance row.
      out.push({ absolute, relative: relative.split(path.sep).join('/') });
    }
  }

  walk(rootDir);
  return out;
}

/**
 * Scan a directory tree.
 *
 * `unreadable` outranks `violation`, which outranks `clean`: a file the guard
 * could not read is a gap in the evidence, not an absence of findings, and
 * reporting it as clean would be the precise failure AI-18-R03 forbids.
 */
function scanDirectory(rootDir, options) {
  const files = collectFiles(rootDir, options);

  const violations = [];
  const unreadable = [];
  let scanned = 0;

  for (const file of files) {
    if (file.unreadable) {
      unreadable.push({
        file: path.relative(rootDir, file.absolute) || path.basename(file.absolute),
      });
      continue;
    }
    let text;
    try {
      text = fs.readFileSync(file.absolute, 'utf8');
    } catch (err) {
      unreadable.push({ file: file.relative });
      continue;
    }
    if (text.indexOf('\u0000') !== -1) {
      // A source file carrying a NUL byte is not text this guard can judge.
      unreadable.push({ file: file.relative });
      continue;
    }
    scanned += 1;
    violations.push.apply(violations, scanText(text, file.relative));
  }

  let status = 'clean';
  if (violations.length > 0) status = 'violation';
  if (unreadable.length > 0) status = 'unreadable';

  return { status, scanned, violations, unreadable };
}

/**
 * The frozen output surface (AI-18-R12). Exactly three shapes exist, and the
 * exit code follows from the first line alone. Keeping the file count off the
 * first line is what lets an acceptance row assert an exact string rather than
 * a string with a number in it.
 */
function formatReport(result) {
  if (result.status === 'unreadable') {
    return {
      exitCode: 2,
      lines: result.unreadable.map((u) => 'SECRET_SURFACE_UNREADABLE: ' + u.file),
    };
  }
  if (result.status === 'violation') {
    return {
      exitCode: 1,
      lines: result.violations.map(
        (v) => 'SECRET_SURFACE_VIOLATION: ' + v.file + ':' + v.line + ' ' + v.column
      ),
    };
  }
  return {
    exitCode: 0,
    lines: ['SECRET_SURFACE_CLEAN', 'files scanned: ' + result.scanned],
  };
}

function runSecretSurface(rootDir, options) {
  const result = scanDirectory(rootDir, options);
  return Object.assign({}, result, formatReport(result));
}

module.exports = {
  FIXTURE_EXCLUSION,
  SELF_EXCLUSION,
  CREDENTIAL_COLUMNS,
  WILDCARD_TABLES,
  SQL_COLUMN_READS,
  scanText,
  scanDirectory,
  formatReport,
  runSecretSurface,
};
