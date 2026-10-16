'use strict';
const test = require('node:test');
const assert = require('node:assert');
const promptCompiler = require('../prompt-compiler');

const item = {
  id: 'TASK-AI-142',
  allowedPaths: ['tools/ai-brain/prompt-compiler.js'],
  acceptanceCriteria: ['prompt carries token discipline'],
  verification: { command: 'node --test tools/ai-brain/test/x.test.js' },
};

test('compiled writer prompt carries token discipline rules', () => {
  const prompt = String(promptCompiler.compilePrompt(item, { goal: 'g' }));
  assert.match(prompt, /search it first/);
  assert.match(prompt, /read tool with offset and limit/);
  assert.match(prompt, /Run only the named test files/);
  // The isolated worker shell is PowerShell: the rule names no POSIX-only command.
  const rule = prompt.slice(prompt.indexOf('Token discipline'));
  assert.doesNotMatch(rule.split('\n')[0], /sed -n|\| grep -E/);
});
