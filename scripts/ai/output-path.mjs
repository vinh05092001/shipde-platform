#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { sameFileIdentity } from './parse-args.mjs';

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

export const ALLOWED_OUTPUT_DIR = '.context-packs';
export const DEFAULT_OUTPUT_FILE = path.join(ALLOWED_OUTPUT_DIR, 'context.xml');

export function validateOutputPath(root, outArg = DEFAULT_OUTPUT_FILE, inputPaths = []) {
  if (!outArg || typeof outArg !== 'string' || outArg.trim() === '') {
    outArg = DEFAULT_OUTPUT_FILE;
  }

  if (outArg.endsWith('/') || outArg.endsWith('\\')) {
    throw new Error(`Unsafe output destination: "${outArg}" cannot be a directory`);
  }

  const resolvedLexical = path.resolve(root, outArg);
  if (fs.existsSync(resolvedLexical) && fs.statSync(resolvedLexical).isDirectory()) {
    throw new Error(`Unsafe output destination: "${outArg}" is an existing directory`);
  }

  const rawSegments = outArg.split(/[/\\]/);
  if (rawSegments.some((seg) => seg.toLowerCase() === '.git')) {
    throw new Error(`Unsafe output destination: "${outArg}" is inside .git`);
  }

  const { canonicalTarget } = resolveExistingAncestorsAndAliases(root, outArg);
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

  // ALLOWLIST: Destination parent must resolve inside ONE fixed output directory (.context-packs)
  const allowedDir = path.resolve(root, ALLOWED_OUTPUT_DIR);
  fs.mkdirSync(allowedDir, { recursive: true });
  const canonicalAllowedDir = fs.realpathSync(allowedDir);

  const parentLexical = path.dirname(resolvedLexical);
  let curr = parentLexical;
  const missingSegments = [];
  while (!fs.existsSync(curr) && path.dirname(curr) !== curr) {
    missingSegments.unshift(path.basename(curr));
    curr = path.dirname(curr);
  }
  let canonicalParent;
  try {
    const canonicalAncestor = fs.realpathSync(curr);
    canonicalParent =
      missingSegments.length > 0
        ? path.join(canonicalAncestor, ...missingSegments)
        : canonicalAncestor;
  } catch {
    throw new Error(`Unsafe output destination: "${outArg}" parent could not be resolved`);
  }

  const isCaseInsensitive = process.platform === 'win32' || process.platform === 'darwin';
  const normAllowed = isCaseInsensitive ? canonicalAllowedDir.toLowerCase() : canonicalAllowedDir;
  const normParent = isCaseInsensitive ? canonicalParent.toLowerCase() : canonicalParent;
  const relToAllowed = path.relative(normAllowed, normParent);

  const isInsideAllowed =
    relToAllowed === '' || (!relToAllowed.startsWith('..') && !path.isAbsolute(relToAllowed));
  if (!isInsideAllowed) {
    throw new Error(
      `Unsafe output destination: "${outArg}" must resolve inside ${ALLOWED_OUTPUT_DIR}`,
    );
  }

  const targetParentCanonical = path.dirname(canonicalTarget);
  const normTargetParent = isCaseInsensitive
    ? targetParentCanonical.toLowerCase()
    : targetParentCanonical;
  const relTargetToAllowed = path.relative(normAllowed, normTargetParent);
  const isTargetInsideAllowed =
    relTargetToAllowed === '' ||
    (!relTargetToAllowed.startsWith('..') && !path.isAbsolute(relTargetToAllowed));
  if (!isTargetInsideAllowed) {
    throw new Error(
      `Unsafe output destination: "${outArg}" must resolve inside ${ALLOWED_OUTPUT_DIR}`,
    );
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
