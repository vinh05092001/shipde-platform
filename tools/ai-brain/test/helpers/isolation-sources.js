'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Returns the combined source text of tools/ai-brain/isolation-launcher.js and
 * every submodule under tools/ai-brain/isolation/*.js so structural/negative
 * source assertions remain active across the modular split (TASK-AI-184).
 */
function readIsolationSources() {
  const brainDir = path.resolve(__dirname, '..', '..');
  const mainFile = path.join(brainDir, 'isolation-launcher.js');
  const subDir = path.join(brainDir, 'isolation');
  const parts = [fs.readFileSync(mainFile, 'utf8')];
  if (fs.existsSync(subDir)) {
    const subs = fs
      .readdirSync(subDir)
      .filter((f) => f.endsWith('.js'))
      .sort();
    for (const f of subs) {
      parts.push(fs.readFileSync(path.join(subDir, f), 'utf8'));
    }
  }
  return parts.join('\n');
}

module.exports = { readIsolationSources };
