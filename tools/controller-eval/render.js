'use strict';
// Renders the real Controller prompts so promptfoo can assert their contract.
// Offline: the echo provider returns the prompt unchanged; no model is called.
const { compilePrompt, compileReviewPrompt } = require('../ai-brain/prompt-compiler');

const ctx = (vars) => ({
  goal: vars.goal,
  pinpoint: false,
  recordTools: false,
  logOpts: null,
  rootDir: process.cwd(),
});

function author({ vars }) {
  return compilePrompt(vars.item, ctx(vars));
}

function review({ vars }) {
  return compileReviewPrompt(vars.item, {
    ...ctx(vars),
    headSha: 'b'.repeat(40),
    baseSha: 'a'.repeat(40),
    diffText: vars.diffText,
    verdictFile: 'verdict.json',
  });
}

module.exports = { author, review };
