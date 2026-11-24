'use strict';

/**
 * Ship Dễ — Shared Writer Paths Scope Contract (F2).
 *
 * Single source of truth for parsing, validating, resolving, and diff-checking
 * optional `Writer paths` against a Work Item's `Allowed paths`:
 *   - Absent `Writer paths` -> legacy fallback to `allowedPaths`.
 *   - Present `Writer paths` -> must be a non-empty list of concrete,
 *     repo-relative file paths (no empty values, invalid tokens, absolute
 *     paths, `..` traversal, or globs), every one covered by `allowedPaths`
 *     using the existing `scope-gate` matcher. Any violation fails closed.
 */

const { matchGlobs } = require('./scope-gate');
const { runHardenedGit } = require('./orchestrate/hardened-git');

const GLOB_CHARS = /[*?[\]{}]/;
const DRIVE_PREFIX = /^[A-Za-z]:/;

function scopeError(code, message) {
  const err = new Error(code + ': ' + message);
  err.code = code;
  return err;
}

function normalizeScopeEntry(entry) {
  return String(entry || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '');
}

/**
 * Validates one concrete repo-relative file path. Rejects empty, whitespace,
 * absolute paths, traversal segments, globs, trailing slashes, and non-path prose.
 */
function validateConcreteRepoRelativePath(rawToken) {
  if (typeof rawToken !== 'string') {
    throw scopeError('WRITER_PATHS_INVALID', 'writer path entry must be a string');
  }
  const trimmed = rawToken.trim();
  if (!trimmed) {
    throw scopeError('WRITER_PATHS_INVALID', 'writer path entry cannot be empty');
  }
  if (/[\r\n\t\0]/.test(trimmed)) {
    throw scopeError('WRITER_PATHS_INVALID', 'writer path contains control characters');
  }
  if (trimmed.includes('`')) {
    throw scopeError(
      'WRITER_PATHS_INVALID',
      'writer path contains unbalanced backticks: ' + trimmed
    );
  }
  if (trimmed.startsWith('/') || trimmed.startsWith('\\') || DRIVE_PREFIX.test(trimmed)) {
    throw scopeError('WRITER_PATHS_INVALID', 'writer path must be repo-relative: ' + trimmed);
  }
  if (GLOB_CHARS.test(trimmed)) {
    throw scopeError(
      'WRITER_PATHS_INVALID',
      'writer path must be a concrete file, not a glob: ' + trimmed
    );
  }
  const normalized = trimmed.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized || normalized.endsWith('/')) {
    throw scopeError('WRITER_PATHS_INVALID', 'writer path must name a file: ' + trimmed);
  }
  const segments = normalized.split('/');
  if (segments.some((seg) => !seg || seg === '.' || seg === '..')) {
    throw scopeError(
      'WRITER_PATHS_INVALID',
      'writer path contains invalid or traversal segment: ' + trimmed
    );
  }
  if (/\s/.test(normalized)) {
    throw scopeError('WRITER_PATHS_INVALID', 'writer path contains whitespace: ' + trimmed);
  }
  if (!normalized.includes('/') && !/\.[A-Za-z0-9]+$/.test(normalized)) {
    throw scopeError('WRITER_PATHS_INVALID', 'writer path is not a concrete file path: ' + trimmed);
  }
  return normalized;
}

/**
 * Parses the raw cell value of a `Writer paths` Control row.
 * Never silently drops invalid tokens; fails closed on empty or malformed cells.
 */
function parseWriterPaths(rawValue) {
  if (typeof rawValue !== 'string' || !rawValue.trim()) {
    throw scopeError('WRITER_PATHS_INVALID', 'Writer paths row is present but empty');
  }
  const rawParts = rawValue.split(/[;,]/);
  const out = [];
  const seen = new Set();
  for (const part of rawParts) {
    const trimmed = part.trim();
    if (!trimmed) {
      throw scopeError('WRITER_PATHS_INVALID', 'Writer paths contains an empty entry');
    }
    let unwrapped = trimmed;
    if (trimmed.startsWith('`') && trimmed.endsWith('`') && trimmed.length >= 2) {
      unwrapped = trimmed.slice(1, -1).trim();
    }
    const valid = validateConcreteRepoRelativePath(unwrapped);
    if (!seen.has(valid)) {
      seen.add(valid);
      out.push(valid);
    }
  }
  if (out.length === 0) {
    throw scopeError('WRITER_PATHS_INVALID', 'Writer paths row is present but empty');
  }
  return out;
}

/**
 * Validates an array of writer paths against `allowedPaths` using ONLY the
 * existing `scope-gate.matchGlobs` matcher and exact normalized equality.
 */
function validateWriterPaths(writerPaths, allowedPaths) {
  if (!Array.isArray(writerPaths) || writerPaths.length === 0) {
    throw scopeError('WRITER_PATHS_INVALID', 'writerPaths must be a non-empty array when declared');
  }
  if (!Array.isArray(allowedPaths) || allowedPaths.length === 0) {
    throw scopeError('WRITER_PATHS_OUTSIDE_ALLOWED_PATHS', 'allowedPaths missing or empty');
  }
  const normAllowed = allowedPaths.map(normalizeScopeEntry).filter(Boolean);
  if (normAllowed.length === 0) {
    throw scopeError('WRITER_PATHS_OUTSIDE_ALLOWED_PATHS', 'allowedPaths missing or empty');
  }
  const out = [];
  const seen = new Set();
  for (const entry of writerPaths) {
    const valid = validateConcreteRepoRelativePath(entry);
    const covered = normAllowed.includes(valid) || matchGlobs(normAllowed, valid);
    if (!covered) {
      throw scopeError(
        'WRITER_PATHS_OUTSIDE_ALLOWED_PATHS',
        `writer path ${valid} is outside allowed paths`
      );
    }
    if (!seen.has(valid)) {
      seen.add(valid);
      out.push(valid);
    }
  }
  return out;
}

/**
 * Resolves the effective editable scope for a writer or repair round.
 * - `writerPaths` absent (undefined/null) -> legacy fallback to `allowedPaths`.
 * - `writerPaths` present -> strictly validated subset of `allowedPaths` (fails closed).
 */
function effectiveWriterScope(item) {
  const i = item && typeof item === 'object' ? item : {};
  const allowed = Array.isArray(i.allowedPaths) ? i.allowedPaths.slice() : [];
  if (i.writerPaths === undefined || i.writerPaths === null) {
    return allowed;
  }
  return validateWriterPaths(i.writerPaths, allowed);
}

function isPathCoveredByScope(filePath, scopePaths) {
  const normFile = normalizeScopeEntry(filePath);
  const normScope = (Array.isArray(scopePaths) ? scopePaths : [])
    .map(normalizeScopeEntry)
    .filter(Boolean);
  if (!normFile || normScope.length === 0) return false;
  return normScope.includes(normFile) || matchGlobs(normScope, normFile);
}

function parseNameStatusZ(raw) {
  const tokens = String(raw || '')
    .split('\0')
    .filter(Boolean);
  const paths = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const status = tokens[i];
    if (!/^[A-Z]/.test(status) || !tokens[i + 1]) continue;
    const isRenameOrCopy = status[0] === 'R' || status[0] === 'C';
    paths.push(tokens[i + 1]);
    if (isRenameOrCopy && tokens[i + 2]) {
      paths.push(tokens[i + 2]);
      i += 2;
    } else {
      i += 1;
    }
  }
  return [...new Set(paths.map(normalizeScopeEntry).filter(Boolean))];
}

/**
 * Checks a worker turn's committed diff (`baseSha..headSha`) against the
 * effective writer scope (writerPaths when declared, else allowedPaths).
 * Compares ONLY against this turn's `baseSha`, never `origin/main`.
 */
function checkWriterCommitDiff({ workerRoot, baseSha, headSha, writerPaths, allowedPaths }) {
  const scope = effectiveWriterScope({ writerPaths, allowedPaths });
  if (scope.length === 0) {
    return { ok: false, code: 'WRITER_SCOPE_EMPTY', offending: [] };
  }
  if (!baseSha || !headSha || baseSha === headSha) {
    return { ok: true, files: [], scope };
  }
  const res = runHardenedGit(workerRoot, ['diff', '--name-status', '-M', '-z', baseSha, headSha]);
  if (res.error || res.status !== 0) {
    return {
      ok: false,
      code: 'WRITER_DIFF_CHECK_FAILED',
      detail: String(res.stderr || (res.error && res.error.message) || 'git diff failed').trim(),
      offending: [],
    };
  }
  const files = parseNameStatusZ(res.stdout);
  const offending = files.filter((f) => !isPathCoveredByScope(f, scope));
  if (offending.length > 0) {
    return { ok: false, code: 'WRITER_DIFF_OUTSIDE_SCOPE', files, offending, scope };
  }
  return { ok: true, files, scope };
}

module.exports = {
  validateConcreteRepoRelativePath,
  parseWriterPaths,
  validateWriterPaths,
  effectiveWriterScope,
  isPathCoveredByScope,
  checkWriterCommitDiff,
};
