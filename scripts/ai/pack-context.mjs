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

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') {
      continue;
    } else if (arg === '--paths' && i + 1 < argv.length) {
      paths = argv[++i]
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);
    } else if (arg === '--out' && i + 1 < argv.length) {
      out = argv[++i];
    } else if (arg === '--max-tokens' && i + 1 < argv.length) {
      const raw = argv[++i];
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
        throw new Error(`--max-tokens must be a positive integer, got: ${raw}`);
      }
      maxTokens = n;
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown flag: ${arg}`);
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

function writeTempConfig(root, paths, outputFile) {
  const config = buildFocusedConfig(loadBaseConfig(root), paths, outputFile);
  const tmpDir = fs.mkdtempSync(path.join(root, '.repomix-tmp-'));
  const tmpPath = path.join(tmpDir, 'config.json');
  fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2), 'utf8');
  return { tmpDir, tmpPath };
}

function combinedOutput(err) {
  const stderr = err.stderr ? err.stderr.toString() : '';
  const stdout = err.stdout ? err.stdout.toString() : '';
  return `${stdout}\n${stderr}\n${err.message || ''}`;
}

function runRepomix({ root, paths, outputFile, maxTokens }) {
  const entry = resolveRepomixEntry(root);
  const { tmpDir, tmpPath } = writeTempConfig(root, paths, outputFile);
  const args = [entry, '--config', tmpPath];
  if (maxTokens !== null) {
    args.push('--token-budget', String(maxTokens));
  }

  try {
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
  } catch (err) {
    if (err.message === 'secret-check') throw err;
    const text = combinedOutput(err);
    if (looksLikeSecretFailure(text)) throw new Error('secret-check');
    if (looksLikeBudgetFailure(text)) throw new Error('token-budget');
    const error = new Error('repomix-failed');
    error.exitCode = err.status ?? null;
    // Child-process output is intentionally not retained in logs: it can
    // contain packed file paths, contents or detected secret material.
    throw error;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  return null;
}

function countFiles(content) {
  const matches = content.match(/<file\b/g);
  return matches ? matches.length : 0;
}

function removeOutput(outputPath) {
  try {
    fs.rmSync(outputPath, { force: true });
  } catch {
    // best-effort
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

  const outputPath = path.resolve(root, args.out);

  try {
    runRepomix({
      root,
      paths: args.paths,
      outputFile: outputPath,
      maxTokens: args.maxTokens,
    });
  } catch (err) {
    removeOutput(outputPath);
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
    logError(
      `[pack-context] ERROR: repomix failed${err.exitCode !== null ? ` (exit code ${err.exitCode})` : ''}.`,
    );
    return 1;
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
