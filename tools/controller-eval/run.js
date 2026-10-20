'use strict';
// Runs eval.yaml through promptfoo's library API. The CLI always runs its
// SQLite migrations, which fail on Linux in 0.120.0 (wrong drizzle path);
// evaluate() without writeLatestResults never touches the database.
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const promptfoo = require('promptfoo');
const render = require('./render');

async function main() {
  const config = yaml.load(fs.readFileSync(path.join(__dirname, 'eval.yaml'), 'utf8'));
  const prompts = config.prompts.map((p) => {
    const fn = render[p.id.split(':').pop()];
    if (typeof fn !== 'function') throw new Error('Unknown prompt function: ' + p.id);
    return { raw: p.label, label: p.label, function: fn };
  });
  const run = await promptfoo.evaluate(
    { ...config, prompts, writeLatestResults: false },
    { cache: false, maxConcurrency: 4 }
  );
  // evaluate() returns an Eval record; the plain summary carries stats/results.
  const summary = typeof run.toEvaluateSummary === 'function' ? await run.toEvaluateSummary() : run;
  const { successes, failures, errors } = summary.stats;
  for (const r of summary.results.filter((r) => !r.success)) {
    console.error(
      'FAIL',
      r.prompt.label,
      '|',
      r.testCase.description,
      '|',
      r.error || r.gradingResult?.reason
    );
  }
  console.log(`CONTROLLER_PROMPT_EVAL: ${successes} passed, ${failures} failed, ${errors} errors`);
  process.exitCode = failures + errors === 0 && successes > 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
