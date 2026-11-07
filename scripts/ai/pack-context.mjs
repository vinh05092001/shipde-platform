#!/usr/bin/env node
'use strict';

/**
 * Ship Dễ — Pack focused repo context with repomix (TASK-AI-158)
 *
 * Reference: github.com/yamadashy/repomix (MIT License) - options, security check and output path handling
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseArgs, sameFileIdentity } from './parse-args.mjs';
import {
  ALLOWED_OUTPUT_DIR,
  DEFAULT_OUTPUT_FILE,
  resolveExistingAncestorsAndAliases,
  validateOutputPath,
} from './output-path.mjs';
import {
  estimateTokens,
  looksLikeSecretFailure,
  looksLikeBudgetFailure,
  resolveRepomixEntry,
  loadBaseConfig,
  buildFocusedConfig,
  combinedOutput,
} from './config.mjs';
import { runRepomix } from './run-repomix.mjs';
import { countFiles, publishOutput } from './publish.mjs';

export {
  parseArgs,
  sameFileIdentity,
  ALLOWED_OUTPUT_DIR,
  DEFAULT_OUTPUT_FILE,
  resolveExistingAncestorsAndAliases,
  validateOutputPath,
  estimateTokens,
  looksLikeSecretFailure,
  looksLikeBudgetFailure,
  resolveRepomixEntry,
  loadBaseConfig,
  buildFocusedConfig,
  combinedOutput,
  runRepomix,
  countFiles,
  publishOutput,
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');

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
