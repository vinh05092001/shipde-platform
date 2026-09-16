'use strict';

/**
 * Ship Dễ — Staged secret scanner (AI-36-R05).
 *
 * The authoritative secret gate is Gitleaks 8.24.0, and it runs in CI. It does
 * not run on a developer workstation, because on a clean Windows checkout there
 * is no Gitleaks binary on PATH and `pnpm security:secrets` answers with the
 * operational exit code 2 — an answer a pre-commit hook cannot act on, since it
 * distinguishes neither "clean" nor "leaked". A hook wired to that command
 * either blocks every commit on every clean workstation or is ignored.
 *
 * So this scanner exists as local defense in depth, in Node, with no binary
 * dependency. It evaluates `.gitleaks.toml` rules against the *git index*, not
 * the working tree: what a commit records is the staged blob, so a secret staged
 * and then edited or deleted on disk is still the secret about to enter history.
 * That is the case `git diff`-free working-tree scanners miss.
 *
 * Frozen output surface — exactly three first-line shapes, and the exit code
 * follows from the first line alone:
 *
 *   STAGED_SCAN_CLEAN: 0 secrets detected      exit 0
 *   STAGED_SECRET_DETECTED: <file>             exit 1
 *   STAGED_SCAN_BUDGET_EXCEEDED: <detail>      exit 2
 *   STAGED_SCAN_ERROR: <detail>                exit 2
 *
 * Like the secret-surface guard, this one reports a file, a line and a rule id
 * and never the matched value: a tool that quotes a credential to prove the
 * credential leaked has leaked it a second time, into the terminal and the hook
 * log (AI-18-R05).
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

/** A NUL byte, spelled without writing one into this file's own bytes. */
const NUL = String.fromCharCode(0);

/** AI-36-R05: 5000ms execution budget, 512MB memory budget, both overridable. */
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_BYTES = 536870912;

/**
 * Built-in rules, used when the repository being scanned has no
 * `.gitleaks.toml` and merged with it when it has one (`[extend] useDefault`).
 *
 * A pre-commit hook runs in whatever repository the developer is committing to,
 * including a freshly initialised one, so falling back to "no rules" would make
 * the common case a scanner that cannot detect anything while still exiting 0.
 *
 * The patterns are credential *shapes*, never credential values. None of them
 * matches its own source text: `ghp_[0-9a-zA-Z]{36}` requires 36 characters
 * after the prefix and this file contains no such run.
 */
const DEFAULT_RULES = Object.freeze([
  { id: 'github-pat', pattern: /\bghp_[0-9a-zA-Z]{36}\b/ },
  { id: 'github-oauth', pattern: /\bgho_[0-9a-zA-Z]{36}\b/ },
  { id: 'github-app-token', pattern: /\b(?:ghu|ghs)_[0-9a-zA-Z]{36}\b/ },
  { id: 'github-fine-grained-pat', pattern: /\bgithub_pat_[0-9a-zA-Z_]{22,}\b/ },
  { id: 'aws-access-key-id', pattern: /\b(?:A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/ },
  { id: 'slack-token', pattern: /\bxox[baprs]-[0-9a-zA-Z-]{10,}/ },
  { id: 'stripe-secret-key', pattern: /\b(?:sk|rk)_(?:live|test)_[0-9a-zA-Z]{16,}\b/ },
  { id: 'openai-api-key', pattern: /\bsk-[A-Za-z0-9]{32,}\b/ },
  { id: 'private-key', pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/ },
]);

/**
 * Read the budgets from the environment (AC-AI-36-11).
 *
 * A value that is absent, empty, non-numeric or non-positive falls back to the
 * default rather than to zero: a typo in an environment variable must not
 * silently turn the scanner into something that reports every commit as over
 * budget, nor into something with no budget at all.
 */
function parseBudgets(env) {
  const source = env || {};
  function positiveNumber(raw, fallback) {
    if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return n;
  }
  return {
    timeoutMs: positiveNumber(source.AI_GUARD_STAGED_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    maxBytes: positiveNumber(source.AI_GUARD_STAGED_MAX_BYTES, DEFAULT_MAX_BYTES),
  };
}

/**
 * Strip TOML comments from a line without cutting inside a quoted string.
 */
function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === '#') return line.slice(0, i);
  }
  return line;
}

function unquote(raw) {
  const value = raw.trim();
  if (value.startsWith("'''") && value.endsWith("'''") && value.length >= 6) {
    return value.slice(3, -3);
  }
  if (value.startsWith('"""') && value.endsWith('"""') && value.length >= 6) {
    return value.slice(3, -3);
  }
  if (
    value.length >= 2 &&
    (value[0] === "'" || value[0] === '"') &&
    value[value.length - 1] === value[0]
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Compile a Gitleaks rule regex as a JavaScript RegExp.
 *
 * Gitleaks patterns are Go RE2 and commonly open with the inline flag group
 * `(?i)`, which JavaScript does not accept anywhere. Measured: without this
 * translation every `[[rules]]` entry in this repository's own `.gitleaks.toml`
 * — all of which start with `(?i)` — failed to compile and was silently
 * dropped, leaving the scanner running on built-in rules only while still
 * reporting success.
 */
function compile(source) {
  let body = String(source);
  let flags = '';
  const inline = /^\(\?([ims]+)\)/.exec(body);
  if (inline) {
    body = body.slice(inline[0].length);
    if (inline[1].includes('i')) flags += 'i';
    if (inline[1].includes('s')) flags += 's';
    if (inline[1].includes('m')) flags += 'm';
  }
  try {
    return new RegExp(body, flags);
  } catch (err) {
    // An unparseable rule is dropped rather than fatal. A `.gitleaks.toml`
    // written for Go's RE2 can contain syntax JavaScript rejects; losing that
    // one rule is a smaller failure than a hook that refuses every commit.
    return null;
  }
}

/**
 * A deliberately small `.gitleaks.toml` reader.
 *
 * It extracts exactly what this scanner acts on — the `[[rules]]` ids and
 * regexes, and the top-level `[allowlist]` regexes, stopwords and paths — and
 * ignores everything else. It is not a TOML implementation and does not pretend
 * to be one: the authoritative evaluation of that file is Gitleaks itself, in
 * CI. Anything this reader misses makes the local hook more permissive than CI,
 * never less, so the authoritative gate stays the strict one.
 */
function parseGitleaksConfig(text) {
  const rules = [];
  const allowlist = { regexes: [], stopwords: [], paths: [] };

  let section = null;
  let current = null;
  let arrayTarget = null;
  let block = null; // { key, buffer } for a triple-quoted value spanning lines

  const lines = String(text).split(/\r?\n/);

  for (const rawLine of lines) {
    if (block) {
      const end = rawLine.indexOf("'''");
      if (end === -1) {
        block.buffer.push(rawLine);
        continue;
      }
      block.buffer.push(rawLine.slice(0, end));
      const value = block.buffer.join('\n');
      if (block.target) block.target.push(value);
      else if (block.assign) block.assign(value);
      block = null;
      continue;
    }

    const line = stripComment(rawLine);
    const trimmed = line.trim();

    if (arrayTarget) {
      if (trimmed.startsWith(']')) {
        arrayTarget = null;
        continue;
      }
      if (trimmed === '') continue;
      const item = trimmed.replace(/,\s*$/, '');
      if (item.startsWith("'''") && !(item.endsWith("'''") && item.length >= 6)) {
        block = { buffer: [item.slice(3)], target: arrayTarget };
        continue;
      }
      if (item !== '') arrayTarget.push(unquote(item));
      continue;
    }

    if (trimmed === '') continue;

    if (trimmed.startsWith('[')) {
      if (trimmed === '[[rules]]') {
        current = { id: null, regex: null, allowlistRegexes: [] };
        rules.push(current);
        section = 'rules';
      } else if (trimmed === '[rules.allowlist]') {
        section = 'rules.allowlist';
      } else if (trimmed === '[allowlist]') {
        section = 'allowlist';
        current = null;
      } else {
        section = trimmed;
        if (!trimmed.startsWith('[rules')) current = null;
      }
      continue;
    }

    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const rest = trimmed.slice(eq + 1).trim();

    if (rest === '[') {
      if (section === 'allowlist' && key === 'regexes') arrayTarget = allowlist.regexes;
      else if (section === 'allowlist' && key === 'stopwords') arrayTarget = allowlist.stopwords;
      else if (section === 'allowlist' && key === 'paths') arrayTarget = allowlist.paths;
      else if (section === 'rules.allowlist' && key === 'regexes' && current)
        arrayTarget = current.allowlistRegexes;
      else arrayTarget = [];
      continue;
    }

    if (rest.startsWith("'''") && !(rest.endsWith("'''") && rest.length >= 6)) {
      const captured = current;
      const capturedKey = key;
      const capturedSection = section;
      block = {
        buffer: [rest.slice(3)],
        assign: (value) => {
          if (capturedSection === 'rules' && captured && capturedKey === 'regex')
            captured.regex = value;
        },
      };
      continue;
    }

    const value = unquote(rest);
    if (section === 'rules' && current) {
      if (key === 'id') current.id = value;
      if (key === 'regex') current.regex = value;
    }
  }

  const compiled = [];
  for (const rule of rules) {
    if (!rule.regex) continue;
    const pattern = compile(rule.regex);
    if (!pattern) continue;
    const ruleAllow = [];
    for (const source of rule.allowlistRegexes) {
      const rx = compile(source);
      if (rx) ruleAllow.push(rx);
    }
    compiled.push({ id: rule.id || 'unnamed-rule', pattern, allowlist: ruleAllow });
  }

  return {
    rules: compiled,
    allowlist: {
      regexes: allowlist.regexes.map((s) => compile(s)).filter(Boolean),
      stopwords: allowlist.stopwords.slice(),
      paths: allowlist.paths.map((s) => compile(s)).filter(Boolean),
    },
  };
}

const EMPTY_ALLOWLIST = Object.freeze({ regexes: [], stopwords: [], paths: [] });

/**
 * Rules for a repository: its `.gitleaks.toml` when it has one, always merged
 * with the built-ins, which is what `[extend] useDefault = true` means.
 */
function loadRules(rootDir) {
  const configPath = path.join(rootDir, '.gitleaks.toml');
  let text = null;
  try {
    text = fs.readFileSync(configPath, 'utf8');
  } catch (err) {
    return {
      rules: DEFAULT_RULES.map((r) => ({ id: r.id, pattern: r.pattern, allowlist: [] })),
      allowlist: EMPTY_ALLOWLIST,
      configPath: null,
    };
  }
  const parsed = parseGitleaksConfig(text);
  const rules = parsed.rules.concat(
    DEFAULT_RULES.map((r) => ({ id: r.id, pattern: r.pattern, allowlist: [] }))
  );
  return { rules, allowlist: parsed.allowlist, configPath };
}

function lineAt(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (text.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

function lineTextAt(text, index) {
  const start = text.lastIndexOf('\n', index) + 1;
  let end = text.indexOf('\n', index);
  if (end === -1) end = text.length;
  return text.slice(start, end);
}

function isPathAllowlisted(filePath, allowlist) {
  const list = (allowlist && allowlist.paths) || [];
  return list.some((rx) => rx.test(filePath));
}

/**
 * One staged blob's findings, in the order they appear.
 *
 * The allowlist is evaluated against the matched line and not the whole blob,
 * matching `.gitleaks.toml`'s own `regexTarget = "line"`: a repository that
 * exempts one fixture line must not thereby exempt every secret in the file
 * that fixture lives in.
 */
function scanContent(text, filePath, rules, allowlist) {
  const allow = allowlist || EMPTY_ALLOWLIST;
  if (isPathAllowlisted(filePath, allow)) return [];

  const found = [];
  for (const rule of rules) {
    const rx = new RegExp(
      rule.pattern.source,
      rule.pattern.flags.includes('g') ? rule.pattern.flags : rule.pattern.flags + 'g'
    );
    let m;
    while ((m = rx.exec(text)) !== null) {
      const matched = m[0];
      const line = lineTextAt(text, m.index);
      const exempt =
        (allow.stopwords || []).some((word) => matched.includes(word)) ||
        (allow.regexes || []).some((r) => r.test(line)) ||
        (rule.allowlist || []).some((r) => r.test(matched) || r.test(line));
      if (!exempt) {
        found.push({
          index: m.index,
          file: filePath,
          line: lineAt(text, m.index),
          rule: rule.id,
        });
      }
      if (m.index === rx.lastIndex) rx.lastIndex += 1;
    }
  }

  found.sort((a, b) => a.index - b.index);
  return found.map((f) => ({ file: f.file, line: f.line, rule: f.rule }));
}

class BudgetExceeded extends Error {
  constructor(detail) {
    super(detail);
    this.name = 'BudgetExceeded';
    this.detail = detail;
  }
}

function git(args, cwd, budget) {
  const remaining = budget.deadline - Date.now();
  if (remaining <= 0) {
    throw new BudgetExceeded('timeout ' + budget.timeoutMs + 'ms exceeded');
  }
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      timeout: remaining,
      maxBuffer: budget.maxBytes,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    if (err && (err.code === 'ETIMEDOUT' || err.signal === 'SIGTERM')) {
      throw new BudgetExceeded('timeout ' + budget.timeoutMs + 'ms exceeded');
    }
    if (err && err.code === 'ENOBUFS') {
      throw new BudgetExceeded('staged content exceeds ' + budget.maxBytes + ' bytes');
    }
    throw err;
  }
}

/**
 * Names of the files staged in the index.
 *
 * A repository with no commit yet has no HEAD to diff against, and `git diff
 * --cached` there is an error, not an empty result — which is precisely the
 * state of every freshly initialised fixture repository. In that case the index
 * *is* the staged set, so `git ls-files --cached` answers the same question.
 */
function stagedPaths(cwd, budget) {
  let hasHead = true;
  try {
    git(['rev-parse', '--verify', '--quiet', 'HEAD'], cwd, budget);
  } catch (err) {
    if (err instanceof BudgetExceeded) throw err;
    hasHead = false;
  }
  const out = hasHead
    ? git(['diff', '--cached', '--name-only', '--diff-filter=ACMR'], cwd, budget)
    : git(['ls-files', '--cached'], cwd, budget);
  return out
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

/**
 * Scan the git index of `cwd`.
 *
 * Content comes from `git show :<path>`, the staged blob, so a fixture staged
 * and then deleted from disk is still scanned (AC-AI-36-10).
 */
function scanStagedIndex(cwd, options) {
  const opts = options || {};
  const budgets = parseBudgets(opts.env || process.env);
  const budget = {
    timeoutMs: budgets.timeoutMs,
    maxBytes: budgets.maxBytes,
    deadline: Date.now() + budgets.timeoutMs,
  };

  let ruleSet;
  try {
    ruleSet = loadRules(opts.rulesRoot || cwd);
  } catch (err) {
    return {
      status: 'error',
      detail: 'cannot load rules: ' + err.message,
      scanned: 0,
      findings: [],
    };
  }

  let paths;
  try {
    paths = stagedPaths(cwd, budget);
  } catch (err) {
    if (err instanceof BudgetExceeded) {
      return { status: 'budget', detail: err.detail, scanned: 0, findings: [] };
    }
    return {
      status: 'error',
      detail: 'not a git repository or git unavailable',
      scanned: 0,
      findings: [],
    };
  }

  const findings = [];
  let scanned = 0;
  let bytes = 0;

  for (const file of paths) {
    let content;
    try {
      content = git(['show', ':' + file], cwd, budget);
    } catch (err) {
      if (err instanceof BudgetExceeded) {
        return { status: 'budget', detail: err.detail, scanned, findings: [] };
      }
      // An unreadable index entry (a submodule gitlink, for instance) is not a
      // blob this scanner can judge, and is not evidence of a secret.
      continue;
    }
    bytes += Buffer.byteLength(content, 'utf8');
    if (bytes > budget.maxBytes) {
      return {
        status: 'budget',
        detail: 'staged content exceeds ' + budget.maxBytes + ' bytes',
        scanned,
        findings: [],
      };
    }
    if (content.indexOf(NUL) !== -1) continue;
    scanned += 1;
    findings.push.apply(findings, scanContent(content, file, ruleSet.rules, ruleSet.allowlist));
  }

  if (Date.now() > budget.deadline) {
    return {
      status: 'budget',
      detail: 'timeout ' + budget.timeoutMs + 'ms exceeded',
      scanned,
      findings: [],
    };
  }

  return {
    status: findings.length > 0 ? 'detected' : 'clean',
    detail: null,
    scanned,
    findings,
  };
}

/**
 * The frozen output surface. The exit code follows from the first line alone,
 * and the first line of a detection carries the file and nothing else, so an
 * acceptance row can assert an exact string rather than a string with a line
 * number in it.
 */
function formatReport(result) {
  if (result.status === 'budget') {
    return { exitCode: 2, lines: ['STAGED_SCAN_BUDGET_EXCEEDED: ' + result.detail] };
  }
  if (result.status === 'error') {
    return { exitCode: 2, lines: ['STAGED_SCAN_ERROR: ' + result.detail] };
  }
  if (result.status === 'detected') {
    const lines = [];
    for (const f of result.findings) {
      lines.push('STAGED_SECRET_DETECTED: ' + f.file);
      lines.push('  rule: ' + f.rule + ' line: ' + f.line);
    }
    return { exitCode: 1, lines };
  }
  return {
    exitCode: 0,
    lines: ['STAGED_SCAN_CLEAN: 0 secrets detected', 'staged files scanned: ' + result.scanned],
  };
}

function runStagedSecrets(cwd, options) {
  const result = scanStagedIndex(cwd, options);
  return Object.assign({}, result, formatReport(result));
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_BYTES,
  DEFAULT_RULES,
  parseBudgets,
  parseGitleaksConfig,
  loadRules,
  scanContent,
  scanStagedIndex,
  formatReport,
  runStagedSecrets,
};
