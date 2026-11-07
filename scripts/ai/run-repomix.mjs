#!/usr/bin/env node
'use strict';

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import {
  estimateTokens,
  looksLikeSecretFailure,
  looksLikeBudgetFailure,
  resolveRepomixEntry,
  loadBaseConfig,
  buildFocusedConfig,
  combinedOutput,
} from './config.mjs';

export function runRepomix({ root, paths, maxTokens }) {
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
