#!/usr/bin/env node
'use strict';

/**
 * Ship Dễ — Pack focused repo context with repomix (TASK-AI-158)
 *
 * Produces a token-budgeted, secret-checked XML context file for writer and
 * reviewer prompts. Only the paths given via --paths are packed.
 *
 * Usage:
 *   node scripts/ai/pack-context.mjs --paths "apps/api/src/**,prisma/**" --out ctx.xml
 *   node scripts/ai/pack-context.mjs --paths "docs/**" --out ctx.xml --max-tokens 50000
 *
 * Exit codes:
 *   0  success
 *   1  argument error, repomix failure, secret detected, or token limit exceeded
 *
 * --max-tokens is a hard ceiling enforced by repomix's own tokenizer
 * (--token-budget): an over-budget pack fails non-zero and is never
 * truncated or left behind.
 *
 * The built-in repomix security check (secretlint) excludes files it flags
 * but still exits 0, so this wrapper treats any "suspicious file(s)
 * detected" report as a failure: the command exits non-zero and removes the
 * output file.
 *
 * File contents are never printed to stdout — only a summary line
 * (files packed, estimated tokens, output path).
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');

export function parseArgs(argv) {
  let paths = null;
  let out = null;
  let maxTokens = null;

  const isFlag = (val) => typeof val === 'string' && val.startsWith('-') && !/^-\d+$/.test(val);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') {
      continue;
    } else if (arg === '--paths') {
      if (paths !== null) {
        throw new Error('--paths can only be specified once');
      }
      if (i + 1 >= argv.length || isFlag(argv[i + 1])) {
        throw new Error('--paths requires a value');
      }
      const raw = argv[++i];
      paths = raw
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);
      if (paths.length === 0) {
        throw new Error('--paths is required (comma-separated globs)');
      }
    } else if (arg === '--out') {
      if (out !== null) {
        throw new Error('--out can only be specified once');
      }
      if (i + 1 >= argv.length || isFlag(argv[i + 1])) {
        throw new Error('--out requires a value');
      }
      const raw = argv[++i];
      if (raw.trim() === '') {
        throw new Error('--out requires a non-empty file path');
      }
      out = raw;
    } else if (arg === '--max-tokens') {
      if (maxTokens !== null) {
        throw new Error('--max-tokens can only be specified once');
      }
      if (i + 1 >= argv.length || isFlag(argv[i + 1])) {
        throw new Error('--max-tokens requires a positive integer value');
      }
      const raw = argv[++i];
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
        throw new Error(`--max-tokens must be a positive integer, got: ${raw}`);
      }
      maxTokens = n;
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown flag: ${arg}`);
    } else {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }
  }

  if (!paths || paths.length === 0) {
    throw new Error('--paths is required (comma-separated globs)');
  }
  if (!out) {
    throw new Error('--out is required (output file path)');
  }

  return { paths, out, maxTokens };
}

export function sameFileIdentity(statA, statB) {
  return (
    Boolean(statA) &&
    Boolean(statB) &&
    typeof statA.ino === 'number' &&
    typeof statB.ino === 'number' &&
    statA.ino !== 0 &&
    statB.ino !== 0 &&
    statA.ino === statB.ino &&
    statA.dev === statB.dev
  );
}

export function resolveExistingAncestorsAndAliases(root, outArg) {
  const resolvedLexical = path.resolve(root, outArg);
  let curr = resolvedLexical;
  const nonExistingSegments = [];

  while (true) {
    let exists = false;
    let isLink = false;
    try {
      const lstat = fs.lstatSync(curr);
      exists = true;
      isLink = lstat.isSymbolicLink();
    } catch {
      // path does not exist
    }

    if (exists || isLink) {
      break;
    }

    const parent = path.dirname(curr);
    if (parent === curr) {
      break;
    }
    nonExistingSegments.unshift(path.basename(curr));
    curr = parent;
  }

  let canonicalExisting;
  try {
    canonicalExisting = fs.realpathSync(curr);
  } catch {
    throw new Error(
      `Unsafe output destination: "${outArg}" points through an invalid or broken link`,
    );
  }

  const canonicalTarget =
    nonExistingSegments.length > 0
      ? path.join(canonicalExisting, ...nonExistingSegments)
      : canonicalExisting;

  return { resolvedLexical, canonicalTarget };
}

export function validateOutputPath(root, outArg, inputPaths = []) {
  if (!outArg || typeof outArg !== 'string' || outArg.trim() === '') {
    throw new Error('--out destination is required');
  }

  if (outArg.endsWith('/') || outArg.endsWith('\\')) {
    throw new Error(`Unsafe output destination: "${outArg}" cannot be a directory`);
  }

  const { resolvedLexical, canonicalTarget } = resolveExistingAncestorsAndAliases(root, outArg);
  const canonicalRoot = fs.existsSync(root) ? fs.realpathSync(root) : path.resolve(root);

  const relLexical = path.relative(root, resolvedLexical);
  if (relLexical === '' || relLexical.startsWith('..') || path.isAbsolute(relLexical)) {
    throw new Error(`Unsafe output destination: "${outArg}" resolves outside the repository root`);
  }

  const segmentsLexical = relLexical.split(/[/\\]/);
  if (segmentsLexical.some((seg) => seg.toLowerCase() === '.git')) {
    throw new Error(`Unsafe output destination: "${outArg}" is inside .git`);
  }

  const relCanonical = path.relative(canonicalRoot, canonicalTarget);
  if (relCanonical === '' || relCanonical.startsWith('..') || path.isAbsolute(relCanonical)) {
    throw new Error(`Unsafe output destination: "${outArg}" resolves outside the repository root`);
  }

  const segmentsCanonical = relCanonical.split(/[/\\]/);
  if (segmentsCanonical.some((seg) => seg.toLowerCase() === '.git')) {
    throw new Error(`Unsafe output destination: "${outArg}" is inside .git`);
  }

  let targetStat = null;
  if (fs.existsSync(canonicalTarget)) {
    targetStat = fs.statSync(canonicalTarget);
    if (targetStat.isDirectory()) {
      throw new Error(`Unsafe output destination: "${outArg}" is an existing directory`);
    }
    if (!targetStat.isFile()) {
      throw new Error(`Unsafe output destination: "${outArg}" must be a regular file`);
    }
  }

  const normRelLexical = relLexical.replace(/\\/g, '/');
  const normRelCanonical = relCanonical.replace(/\\/g, '/');

  for (const p of inputPaths) {
    const normP = p.replace(/\\/g, '/');
    const cleanP = normP.replace(/^\.\//, '').replace(/\/+/g, '/');
    const resolvedP = path.resolve(root, p);

    if (
      resolvedP === resolvedLexical ||
      resolvedP === canonicalTarget ||
      normP === normRelLexical ||
      normP === normRelCanonical ||
      cleanP === normRelLexical ||
      cleanP === normRelCanonical
    ) {
      throw new Error(
        `Input/output collision: output destination "${outArg}" is also specified as an input path`,
      );
    }

    if (targetStat && fs.existsSync(resolvedP)) {
      const pCanonical = fs.realpathSync(resolvedP);
      if (pCanonical === canonicalTarget) {
        throw new Error(
          `Input/output collision: output destination "${outArg}" is also specified as an input path`,
        );
      }
      const pStat = fs.statSync(resolvedP);
      if (sameFileIdentity(targetStat, pStat)) {
        throw new Error(
          `Input/output collision: output destination "${outArg}" is also specified as an input path`,
        );
      }
    }

    if (path.matchesGlob) {
      if (
        path.matchesGlob(normRelLexical, normP) ||
        path.matchesGlob(normRelCanonical, normP) ||
        path.matchesGlob(normRelLexical, cleanP) ||
        path.matchesGlob(normRelCanonical, cleanP)
      ) {
        throw new Error(
          `Input/output collision: output destination "${outArg}" matches input pattern "${p}"`,
        );
      }
    }

    if (
      targetStat &&
      typeof fs.globSync === 'function' &&
      (normP.includes('*') || normP.includes('?'))
    ) {
      try {
        const matches = fs.globSync(p, { cwd: root });
        for (const m of matches) {
          const mPath = path.resolve(root, m);
          if (fs.existsSync(mPath)) {
            const mStat = fs.statSync(mPath);
            if (sameFileIdentity(targetStat, mStat)) {
              throw new Error(
                `Input/output collision: output destination "${outArg}" matches input pattern "${p}"`,
              );
            }
          }
        }
      } catch (err) {
        if (err.message && err.message.includes('Input/output collision')) {
          throw err;
        }
      }
    }
  }

  return canonicalTarget;
}

export function estimateTokens(byteLength) {
  return Math.ceil(byteLength / 4);
}

export function looksLikeSecretFailure(text) {
  return /suspicious file\(s\) detected/i.test(text);
}

export function looksLikeBudgetFailure(text) {
  return /exceeds the token budget/i.test(text);
}

export function resolveRepomixEntry(root = REPO_ROOT) {
  const entry = path.join(root, 'node_modules', 'repomix', 'bin', 'repomix.cjs');
  if (!fs.existsSync(entry)) {
    throw new Error(
      'repomix not found. Run `pnpm install` to install the workspace devDependency.',
    );
  }
  return entry;
}

function loadBaseConfig(root) {
  const baseConfigPath = path.join(root, 'repomix.config.json');
  if (!fs.existsSync(baseConfigPath)) return {};
  return JSON.parse(fs.readFileSync(baseConfigPath, 'utf8'));
}

export function buildFocusedConfig(baseConfig, paths, outputFile) {
  return {
    ...baseConfig,
    output: {
      ...(baseConfig.output || {}),
      filePath: outputFile,
      style: 'xml',
      removeComments: false,
    },
    include: paths,
    security: {
      ...(baseConfig.security || {}),
      enableSecurityCheck: true,
    },
  };
}

function combinedOutput(err) {
  const stderr = err.stderr ? err.stderr.toString() : '';
  const stdout = err.stdout ? err.stdout.toString() : '';
  return `${stdout}\n${stderr}\n${err.message || ''}`;
}

function runRepomix({ root, paths, maxTokens }) {
  const entry = resolveRepomixEntry(root);
  const tmpDir = fs.mkdtempSync(path.join(root, '.repomix-tmp-'));
  const tempOutputFile = path.join(tmpDir, 'repomix-output.xml');
  const tmpConfigPath = path.join(tmpDir, 'config.json');

  try {
    const config = buildFocusedConfig(loadBaseConfig(root), paths, tempOutputFile);
    fs.writeFileSync(tmpConfigPath, JSON.stringify(config, null, 2), 'utf8');

    const args = [entry, '--config', tmpConfigPath];
    if (maxTokens !== null) {
      args.push('--token-budget', String(maxTokens));
    }

    const stdout = execFileSync(process.execPath, args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120_000,
      windowsHide: true,
    });
    if (looksLikeSecretFailure(stdout)) {
      throw new Error('secret-check');
    }
    if (!fs.existsSync(tempOutputFile)) {
      throw new Error('output-missing');
    }
    return { tmpDir, tempOutputFile };
  } catch (err) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (err.message === 'secret-check') throw err;
    if (err.message === 'output-missing') throw err;
    const text = combinedOutput(err);
    if (looksLikeSecretFailure(text)) throw new Error('secret-check');
    if (looksLikeBudgetFailure(text)) throw new Error('token-budget');
    const error = new Error('repomix-failed');
    error.exitCode = err.status ?? null;
    throw error;
  }
}

function countFiles(content) {
  const matches = content.match(/<file\b/g);
  return matches ? matches.length : 0;
}

export function publishOutput(
  tempOutputFile,
  outputPath,
  { copyFile = fs.copyFileSync, rename = fs.renameSync } = {},
) {
  const targetDir = path.dirname(outputPath);
  fs.mkdirSync(targetDir, { recursive: true });
  const siblingTemp = path.join(
    targetDir,
    `.${path.basename(outputPath)}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  let published = false;
  try {
    copyFile(tempOutputFile, siblingTemp);
    rename(siblingTemp, outputPath);
    published = true;
  } finally {
    if (!published && fs.existsSync(siblingTemp)) {
      try {
        fs.rmSync(siblingTemp, { force: true });
      } catch {
        // ignore cleanup error
      }
    }
  }
}

export async function main(argv, options = {}) {
  const root = options.root ? path.resolve(options.root) : REPO_ROOT;
  const log = options.log || ((line) => console.log(line));
  const logError = options.logError || ((line) => console.error(line));

  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    logError(`[pack-context] ERROR: ${err.message}`);
    logError(
      'Usage: node scripts/ai/pack-context.mjs --paths <glob,...> --out <file> [--max-tokens N]',
    );
    return 1;
  }

  let outputPath;
  try {
    outputPath = validateOutputPath(root, args.out, args.paths);
  } catch (err) {
    logError(`[pack-context] ERROR: ${err.message}`);
    return 1;
  }

  let repomixResult;
  try {
    repomixResult = runRepomix({
      root,
      paths: args.paths,
      maxTokens: args.maxTokens,
    });
  } catch (err) {
    if (err.message === 'secret-check') {
      logError('[pack-context] FAIL: repomix security check found suspicious content.');
      logError('[pack-context] Review the flagged files before packing.');
      return 1;
    }
    if (err.message === 'token-budget') {
      logError(
        `[pack-context] FAIL: packed output exceeds --max-tokens ${args.maxTokens}.`,
      );
      logError('[pack-context] Narrow --paths or raise the limit.');
      return 1;
    }
    const detail =
      err.exitCode !== null && err.exitCode !== undefined
        ? ` (exit code ${err.exitCode})`
        : err.message && err.message !== 'repomix-failed'
          ? `: ${err.message}`
          : '';
    logError(`[pack-context] ERROR: repomix failed${detail}.`);
    return 1;
  }

  const { tmpDir, tempOutputFile } = repomixResult;
  try {
    publishOutput(tempOutputFile, outputPath, options);
  } catch (err) {
    logError(`[pack-context] ERROR: failed to publish output: ${err.message}`);
    return 1;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  if (!fs.existsSync(outputPath)) {
    logError(`[pack-context] ERROR: repomix did not create output file: ${args.out}`);
    return 1;
  }

  const stat = fs.statSync(outputPath);
  const tokens = estimateTokens(stat.size);
  const fileCount = countFiles(fs.readFileSync(outputPath, 'utf8'));

  log(`[pack-context] OK: ${fileCount} files, ~${tokens} tokens, ${args.out}`);
  return 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isMain) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
