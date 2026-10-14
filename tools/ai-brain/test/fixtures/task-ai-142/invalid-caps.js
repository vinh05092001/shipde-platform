'use strict';

// Violations: numeric literals assigned to names matching /max(Attempts|Probes)|probeBudget|attempt(s)?Limit|quality/i
const maxAttempts = 5;
const probeBudget = 1000;
const attemptLimit = 3;
const quality = 80;

const config = {
  maxProbes: 10,
  probeBudgetMs: 180000,
  qualityFloor: 90,
};

module.exports = {
  maxAttempts,
  probeBudget,
  attemptLimit,
  quality,
  config,
};
