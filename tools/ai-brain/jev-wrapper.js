'use strict';
const jev = require('./jev');

// Share the local wrapper's policy without requiring ignored .oc files in tests.
async function run(question, options = {}) {
  const { source, ...opts } = options;
  return jev.advise(question, {
    ...opts,
    minConfidence: source?.minConfidence ?? opts.minConfidence,
    ask: opts.ask || (!question.skipReason && jev.buildJevAsk(source, opts)),
  });
}

module.exports = { run };
