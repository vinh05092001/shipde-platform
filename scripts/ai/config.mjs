#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';

export function estimateTokens(byteLength) {
  return Math.ceil(byteLength / 4);
}

export function looksLikeSecretFailure(text) {
  return /suspicious file\(s\) detected/i.test(text);
}

export function looksLikeBudgetFailure(text) {
  return /exceeds the token budget/i.test(text);
}

export function resolveRepomixEntry(root = '') {
  const rootPath = root ? path.resolve(root) : '';
  const entry = path.join(rootPath, 'node_modules', 'repomix', 'bin', 'repomix.cjs');
  if (!fs.existsSync(entry)) {
    throw new Error(
      'repomix not found. Run `pnpm install` to install the workspace devDependency.',
    );
  }
  return entry;
}

export function loadBaseConfig(root) {
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

export function combinedOutput(err) {
  const stderr = err.stderr ? err.stderr.toString() : '';
  const stdout = err.stdout ? err.stdout.toString() : '';
  return `${stdout}\n${stderr}\n${err.message || ''}`;
}
