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
  assert.match(prompt, /do not read entire large files/);
  assert.match(prompt, /grep -n/);
  assert.match(prompt, /sed -n 'A,Bp'/);
  assert.match(prompt, /\^ℹ \(tests\|pass\|fail\)/);
  assert.match(prompt, /full tools\/ai-brain\/test suite at most once/);
});
