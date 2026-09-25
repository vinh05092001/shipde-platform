'use strict';

/**
 * Ship Dễ — 9Router Catalogue Deterministic Batch Runner
 */

const path = require('path');
const { runProbeBatch, appendRecord } = require('./runner');
const { runPreflight } = require('./preflight');
const {
  buildQueueKey,
  parseQueueKey,
  normalizeCandidate,
  loadCatalogue,
  loadHistory,
  isCooldownExpired,
  shouldProbe,
  buildProgressiveQueue,
} = require('./queue');
const {
  probeModelRequest,
  parseResponseContent,
  resolveUrl,
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_READ_TIMEOUT_MS,
} = require('./http-client');
const { AdaptiveWorkerPool } = require('./pool');

const CANONICAL_CLASSIFIER_PATH = path.resolve(__dirname, '..', 'failure-classifier.js');

let canonicalClassifier = null;
try {
  canonicalClassifier = require(CANONICAL_CLASSIFIER_PATH);
} catch {
  // Canonical classifier lives on origin/feat/brain-failure-classes (PR #144).
  // It will be loaded once PR #144 merges into this branch.
}

module.exports = {
  runProbeBatch,
  appendRecord,
  runPreflight,
  buildQueueKey,
  parseQueueKey,
  normalizeCandidate,
  loadCatalogue,
  loadHistory,
  isCooldownExpired,
  shouldProbe,
  buildProgressiveQueue,
  probeModelRequest,
  parseResponseContent,
  resolveUrl,
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_READ_TIMEOUT_MS,
  AdaptiveWorkerPool,
  CANONICAL_CLASSIFIER_PATH,
  ...(canonicalClassifier || {}),
};
