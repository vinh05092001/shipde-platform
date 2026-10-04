'use strict';

/**
 * Ship Dễ — TASK-AI-78 (Gate C): token-budgeted repository map. Matrix: test/task-ai-78.test.js.
 * Per tracked .js/.ts-family file: path, exported symbols, one signature line per function/class, and
 * import edges. No bodies. No daemon, no database.
 *
 * R-R01 buildRepoMap({repoCwd, paths?, budgetTokens=1500}) lists path, exports, signature lines, edges;
 *   a function body is never emitted, including the concise body of an expression-bodied arrow.
 * R-R02 tokens = ceil(chars/4) never exceeds budgetTokens (an unbudgetable header emits nothing); the
 *   walk keeps the longest prefix that fits, so the lowest rank goes first (rank = inbound import edges,
 *   then path), while a file too big for any budget is skipped rather than ending the walk.
 * R-R03 Cached at <git-common-dir>/shipde-repo-map/<tree>.json (<tree> = the HEAD tree hash), so a new
 *   tree is a miss. A restricted request (paths) never touches the shared cache.
 * R-R04 expand({repoCwd, file, reason}) returns one file's unbudgeted signature block, else REASON_REQUIRED.
 */

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const CACHE_DIR_NAME = 'shipde-repo-map';
const CACHE_VERSION = 1;
const CODE_EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx'];
const MAX_SIGNATURE_CHARS = 160;
const CLASS_HEADER = /^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s/;
const DECLARATIONS = [
  /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*\w+\s*(?:<[^>]*>)?\s*\(/,
  /^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+\w+/,
  /^(?:export\s+)?(?:const|let|var)\s+\w+\s*(?::[^=]+)?=\s*(?:async\s*)?(?:function\b|\(|\w+\s*=>)/,
  /^(?:export\s+)?(?:declare\s+)?(?:interface|enum|namespace|module)\s+\w+/,
  /^(?:export\s+)?(?:declare\s+)?type\s+\w+\s*(?:<[^>]*>)?\s*=/,
];
const METHOD = /^(?:(?:static|async|get|set)\s+|\*\s*)*\w+\s*\([^)]*\)\s*[:{]/;
const EXPORT_DECL =
  /^export\s+(?:default\s+)?(?:async\s+)?(?:declare\s+)?(?:function|class|const|interface|type)\s+(\w+)/;
const EXPORT_LIST = /^export\s*\{([^}]*)\}/;
const EXPORT_ASSIGN = /^(?:module\.)?exports\.(\w+)\s*=/;
const EXPORTS_OBJECT = /^(?:module\.)?exports\s*=\s*\{/;
const SPECIFIERS = /\b(?:require\(|from\s*|import\s*\(\s*)(['"])([^'"]+)\1/g;
const KEYWORDS = new Set('if for while switch return new do else try catch'.split(' '));
const aliased = (part) => part.trim().split(' as ').pop();
const STRING_LITERAL = /(['"`])(?:\\.|(?!\1)[^\\])*\1/g;

function git(args, cwd) {
  const opts = { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 268435456 };
  const res = cp.spawnSync('git', ['-c', 'safe.directory=*', ...args], opts);
  if (res.error || res.status !== 0) {
    const detail = String(res.stderr || (res.error && res.error.message) || 'git failed');
    return { ok: false, stdout: '', stderr: detail.trim() };
  }
  return { ok: true, stdout: res.stdout || '', stderr: '' };
}

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const forward = (value) => value.split('\\').join('/');
const codeFile = (rel) => CODE_EXTENSIONS.includes(path.posix.extname(rel).toLowerCase());

/** R-R02 token estimate: ceil(chars / 4). */
const estimateTokens = (text) => Math.ceil(String(text == null ? '' : text).length / 4);
const named = (v) => typeof v === 'string' && v.trim() !== '';
const refuse = (code, extra) => Object.assign({ ok: false, code }, extra);

/**
 * Line view of one source file: comments stripped, strings kept (import specifiers live in strings) and
 * the brace depth in force when the line starts. A map is a summary, so this is a scanner, not a parser.
 */
function scanLines(source) {
  const blank = (block) => block.replace(/[^\n]/g, ' ');
  const text = source.replace(/\/\*[\s\S]*?\*\//g, blank).split('\n');
  const lines = text.map((line) => line.replace(/\/\/.*$/, '').trim());
  let depth = 0;
  return lines.map((line) => {
    const start = depth;
    for (const c of line.replace(STRING_LITERAL, '')) {
      if (c === '{') depth += 1;
      else if (c === '}') depth = Math.max(0, depth - 1);
    }
    return { text: line, depth: start };
  });
}

/**
 * R-R01 signature line only. A body starts at the first `{`, or — for an arrow function with a concise
 * body and therefore no brace — right after `=>`. Either way no body character is ever emitted.
 */
function signatureOf(line) {
  const flat = line.replace(/\s+/g, ' ').trim();
  const brace = flat.indexOf('{');
  const arrow = flat.indexOf('=>');
  let out = flat;
  if (arrow >= 0 && (brace < 0 || arrow < brace)) out = flat.slice(0, arrow + 2);
  else if (brace >= 0) out = flat.slice(0, brace);
  out = out.replace(/\s+$/, '');
  return out.length > MAX_SIGNATURE_CHARS ? out.slice(0, MAX_SIGNATURE_CHARS - 3) + '...' : out;
}

/** Keys of a `module.exports = { ... }` object, single-line or one entry per line. */
function moduleExportKeys(lines, startIndex) {
  const keys = [];
  for (let i = startIndex; i < lines.length; i += 1) {
    const line = lines[i];
    if (i > startIndex && line.depth === 0) break;
    const text = i === startIndex ? line.text.replace(/^[^=]*=\s*\{/, '') : line.text;
    for (const part of text.split(',')) {
      const key = /^\w+/.exec(part.trim());
      if (key && !KEYWORDS.has(key[0]) && !keys.includes(key[0])) keys.push(key[0]);
    }
  }
  return keys;
}

function collectSpecifiers(source) {
  const found = [];
  const rx = new RegExp(SPECIFIERS.source, 'g');
  let match = rx.exec(source);
  while (match) {
    if (match[2] && !found.includes(match[2])) found.push(match[2]);
    match = rx.exec(source);
  }
  return found;
}

/** R-R01 resolve a relative specifier against the tracked set, trying extensions and index files. */
function depCandidates(fromRel, spec) {
  if (typeof spec !== 'string' || !spec.startsWith('.')) return [];
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec));
  if (base.startsWith('..') || base.startsWith('/')) return [];
  const suffixed = CODE_EXTENSIONS.map((ext) => base + ext);
  const indexed = suffixed.map((ext) => `${base}/index${ext}`);
  return [base].concat(suffixed, indexed);
}

/** R-R01 one blob -> path, signature lines, exported symbols, import edges. Bodies never included. */
function analyseFile(rel, source) {
  const lines = scanLines(source);
  const signatures = [];
  const exportsList = [];
  const add = (value) => {
    if (value && !signatures.includes(value)) signatures.push(value);
  };
  const named = (value) => {
    if (value && !exportsList.includes(value)) exportsList.push(value);
  };
  let inClassBody = false;
  for (let i = 0; i < lines.length; i += 1) {
    const { text, depth } = lines[i];
    if (!text) continue;
    if (depth === 0) {
      inClassBody = CLASS_HEADER.test(text);
      if (DECLARATIONS.some((re) => re.test(text))) add(signatureOf(text));
      if (EXPORTS_OBJECT.test(text)) moduleExportKeys(lines, i).forEach(named);
      const declared = EXPORT_DECL.exec(text) || EXPORT_ASSIGN.exec(text);
      const listed = EXPORT_LIST.exec(text);
      if (declared) named(declared[1]);
      if (listed) listed[1].split(',').map(aliased).forEach(named);
    } else if (inClassBody && depth === 1 && METHOD.test(text)) {
      add(signatureOf(text));
    }
  }
  const joined = lines.map((line) => line.text).join('\n');
  const requires = collectSpecifiers(joined);
  return { path: rel, signatures, exports: exportsList, requires, deps: [] };
}

function linkDeps(files) {
  const known = new Set(files.map((file) => file.path));
  for (const file of files) {
    for (const spec of file.requires) {
      const hit = depCandidates(file.path, spec).find((one) => known.has(one));
      if (hit && hit !== file.path && !file.deps.includes(hit)) file.deps.push(hit);
    }
  }
  return files;
}

/** R-R02 rank = inbound import edges, then path ascending. */
function rankFiles(files) {
  const inbound = new Map();
  for (const file of files) {
    for (const dep of file.deps) inbound.set(dep, (inbound.get(dep) || 0) + 1);
  }
  for (const file of files) file.inbound = inbound.get(file.path) || 0;
  files.sort((a, b) => b.inbound - a.inbound || compare(a.path, b.path));
  return files;
}

function renderFile(file) {
  const out = [`### ${file.path} (inbound: ${file.inbound})`];
  out.push(...file.signatures.map((sig) => '  ' + sig));
  if (file.exports.length) out.push('  exports: ' + file.exports.join(', '));
  if (file.requires.length) out.push('  requires: ' + file.requires.join(' '));
  return out.join('\n');
}

const renderHeader = (tree, count) =>
  `// shipde repo map | tree ${tree} | ${count} code file(s) | signatures only, no bodies`;

function cacheFilePath(repoCwd, tree) {
  const out = git(['rev-parse', '--git-common-dir'], repoCwd);
  if (!out.ok) return null;
  const rel = out.stdout.trim();
  const common = path.isAbsolute(rel) ? rel : path.resolve(repoCwd, rel);
  return path.join(common, CACHE_DIR_NAME, `${tree}.json`);
}

function readCache(file, tree) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    const usable = parsed && parsed.version === CACHE_VERSION && parsed.tree === tree;
    return usable && Array.isArray(parsed.files) ? parsed.files : null;
  } catch {
    return null;
  }
}

function readTrackedFiles(repoCwd, paths) {
  const out = git(['ls-files', '-z'], repoCwd);
  if (!out.ok) return { ok: false, stderr: out.stderr };
  const wanted = (Array.isArray(paths) ? paths : []).filter(Boolean).map(forward);
  const tracked = out.stdout.split('\0').filter(Boolean).map(forward).filter(codeFile);
  const files = [];
  for (const rel of tracked) {
    if (wanted.length && !wanted.some((one) => rel === one || rel.startsWith(one + '/'))) continue;
    // The committed blob, not the worktree: the map must describe the tree it is keyed by.
    const blob = git(['show', `HEAD:${rel}`], repoCwd);
    if (blob.ok) files.push(analyseFile(rel, blob.stdout));
  }
  return { ok: true, files };
}

/**
 * R-R02 walk the ranked list and keep the longest prefix that fits budgetTokens, so the lowest-ranked
 * files are the ones dropped. A single file that cannot fit even an otherwise empty map is skipped
 * instead of ending the walk, so one oversized file cannot starve everything below it. When the header
 * alone busts the budget nothing at all is emitted. tokens can never exceed budgetTokens.
 */
function applyBudget(files, tree, budgetTokens) {
  const header = renderHeader(tree, files.length);
  const done = (kept, omitted, text) => ({ files: kept, omitted, text, truncated: omitted > 0 });
  if (estimateTokens(header) > budgetTokens) return done([], files.length, '');
  const kept = [];
  let text = header;
  let skipped = 0;
  for (let at = 0; at < files.length; at += 1) {
    const file = files[at];
    const block = `${text}\n${renderFile(file)}`;
    if (estimateTokens(block) > budgetTokens) {
      if (estimateTokens(renderFile(file)) <= budgetTokens) {
        return done(kept, skipped + files.length - at, text);
      }
      skipped += 1;
      continue;
    }
    text = block;
    kept.push(file);
  }
  return done(kept, skipped, text);
}

/** R-R01/R-R02/R-R03 budgeted repository map over the tracked code files of one tree. */
function buildRepoMap(options) {
  const opts = options || {};
  if (!named(opts.repoCwd)) return refuse('REPO_REQUIRED');
  const repoCwd = path.resolve(opts.repoCwd);
  const treeOut = git(['rev-parse', 'HEAD^{tree}'], repoCwd);
  if (!treeOut.ok) return refuse('NOT_A_GIT_REPO', { stderr: treeOut.stderr });
  const tree = treeOut.stdout.trim();
  const ask = Number.isFinite(opts.budgetTokens) && opts.budgetTokens > 0;
  const budgetTokens = ask ? Math.floor(opts.budgetTokens) : 1500;

  const restricted = Array.isArray(opts.paths) && opts.paths.length > 0;
  const cachePath = restricted ? null : cacheFilePath(repoCwd, tree);
  let files = readCache(cachePath, tree);
  const cacheHit = files !== null;
  if (!files) {
    const read = readTrackedFiles(repoCwd, opts.paths);
    if (!read.ok) return refuse('TRACKED_FILES_UNAVAILABLE', { stderr: read.stderr });
    files = rankFiles(linkDeps(read.files));
    if (cachePath) {
      const payload = { version: CACHE_VERSION, tree, files };
      fs.mkdirSync(path.dirname(cachePath), { recursive: true });
      fs.writeFileSync(cachePath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
    }
  }
  const budget = applyBudget(files, tree, budgetTokens);
  const head = { ok: true, tree, budgetTokens, tokens: estimateTokens(budget.text) };
  return Object.assign(head, budget, { cachePath, cacheHit });
}

/** R-R04 unbudgeted signature block for exactly one file, with a mandatory stated reason. */
function expand(options) {
  const opts = options || {};
  if (typeof opts.reason !== 'string' || !opts.reason.trim())
    return { ok: false, code: 'REASON_REQUIRED' };
  if (typeof opts.repoCwd !== 'string' || !opts.repoCwd.trim())
    return { ok: false, code: 'REPO_REQUIRED' };
  if (typeof opts.file !== 'string' || !opts.file.trim())
    return { ok: false, code: 'FILE_REQUIRED' };
  const repoCwd = path.resolve(opts.repoCwd);
  const rel = opts.file.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!git(['ls-files', '--error-unmatch', '-z', '--', rel], repoCwd).ok) {
    return fs.existsSync(path.resolve(repoCwd, rel))
      ? { ok: false, code: 'NOT_TRACKED' }
      : { ok: false, code: 'FILE_NOT_FOUND' };
  }
  const blob = git(['show', `HEAD:${rel}`], repoCwd);
  if (!blob.ok) return { ok: false, code: 'FILE_NOT_FOUND', stderr: blob.stderr };
  const analysed = analyseFile(rel, blob.stdout);
  const text = renderFile(Object.assign({}, analysed, { inbound: 0 }));
  return Object.assign({ ok: true, file: rel, reason: opts.reason.trim() }, analysed, { text });
}

module.exports = {
  buildRepoMap,
  expand,
  estimateTokens,
  scanLines,
  CACHE_DIR_NAME,
  CACHE_VERSION,
  CODE_EXTENSIONS,
};
