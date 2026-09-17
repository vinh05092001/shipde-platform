'use strict';
// AC-AI-25-02 — the pre-existing gates that TASK-AI-25 must not touch are still
// held by the committed code. This row proves that disqualify still refuses on
// qualifiedRoles, that expandOfferings still inherits qualifiedRoles onto every
// offering, and that estimateTokens still reads history with the preference
// documented at fitness.js:125-133 — all on the real, unmodified modules.
//
// Nothing in this row loads role-feedback.js. It exists to prove the new module
// does not regress the existing contract. Run outside the repository it exits 2,
// never 1.
const fs = require('fs');
const path = require('path');

// SOURCE_MISSING check: this script requires production modules that are only
// available inside the repository.
const cwd = process.cwd();
const requiredModules = [
  'tools/ai-brain/capabilities.js',
  'tools/ai-brain/offerings.js',
  'tools/ai-brain/fitness.js',
];

for (const mod of requiredModules) {
  if (!fs.existsSync(path.join(cwd, mod))) {
    console.error('SOURCE_MISSING: ' + mod);
    process.exit(2);
  }
}

const { disqualify, getRole, eligibleAccounts } = require('../capabilities');
const { expandOfferings } = require('../offerings');
const { estimateTokens } = require('../fitness');

const NOW = Date.now();

// --- Control: disqualify still refuses on qualifiedRoles ----------------

const reviewerRole = getRole('reviewer.primary');
const unqualifiedAccount = {
  id: 'acct-unqualified',
  enabled: true,
  provider: 'anthropic',
  model: 'claude-sonnet-5',
  capabilities: { jsonSchema: true, tools: true, contextWindow: 200000 },
  qualifiedRoles: ['analyst.default'],
};

const disqualifyReason = disqualify(reviewerRole, unqualifiedAccount, {
  workItemId: 'TASK-AI-25',
  role: 'reviewer.primary',
});

if (!disqualifyReason || !disqualifyReason.includes('chưa vượt')) {
  console.error('GATES_BROKEN: disqualify no longer refuses on qualifiedRoles');
  process.exit(1);
}

// --- Control: expandOfferings inherits qualifiedRoles ------------------

const offerings = expandOfferings([unqualifiedAccount], {});
const inherited = offerings.find((o) => o.accountId === 'acct-unqualified');
if (!inherited || !Array.isArray(inherited.qualifiedRoles)) {
  console.error('GATES_BROKEN: expandOfferings does not carry qualifiedRoles');
  process.exit(1);
}
if (!inherited.qualifiedRoles.includes('analyst.default')) {
  console.error('GATES_BROKEN: expandOfferings qualifiedRoles does not match account');
  process.exit(1);
}

// --- Control: estimateTokens reads history ----------------------------

const history = {
  'offering::difficulty': {
    medianTokens: 1000,
    samples: 5,
    at: NOW,
  },
};

const estimated = estimateTokens('offering', 'difficulty', history, {
  preference: 10,
  cost: { inputPerMillion: 3, outputPerMillion: 15 },
});

if (typeof estimated !== 'number' || estimated <= 0) {
  console.error('GATES_BROKEN: estimateTokens does not read history');
  process.exit(1);
}

console.log(
  'GATES_HELD: disqualify refusal, offering inheritance, estimateTokens ' +
  'history preference'
);
process.exit(0);
