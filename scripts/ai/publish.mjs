#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';

export function countFiles(content) {
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
