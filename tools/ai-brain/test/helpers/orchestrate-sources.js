'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Returns the combined source text of tools/ai-brain/orchestrate.js and every
 * submodule under tools/ai-brain/orchestrate/*.js so structural/negative source
 * assertions remain active across the modular split (TASK-AI-183).
 */
function readOrchestrateSources() {
  const brainDir = path.resolve(__dirname, '..', '..');
  const mainFile = path.join(brainDir, 'orchestrate.js');
  const subDir = path.join(brainDir, 'orchestrate');
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

module.exports = { readOrchestrateSources };
