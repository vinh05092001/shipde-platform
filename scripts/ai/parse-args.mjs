#!/usr/bin/env node
'use strict';

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
