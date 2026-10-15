'use strict';

// Violations: object/array literals pairing model IDs with numbers (scores)
const DIRECT_PAIR = {
  'gpt-4o': 85,
  'claude-3-5': 92,
};

const OBJECT_ENTRY = {
  model: 'gemini-3.8-flash-high',
  quality: 84,
};

const ARRAY_PAIR = ['gpt-4o', 90];

module.exports = {
  DIRECT_PAIR,
  OBJECT_ENTRY,
  ARRAY_PAIR,
};
