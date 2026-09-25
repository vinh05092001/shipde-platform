'use strict';

/**
 * Ship Dễ — 9Router Catalogue Deterministic Batch Runner
 */

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
const {
  classifyFailure,
  Cause,
  Scope,
  HumanAction,
  parseResetTime,
  DEFAULT_COOLDOWNS,
} = require('./failure-classifier');
const { AdaptiveWorkerPool } = require('./pool');

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
  classifyFailure,
  Cause,
  Scope,
  HumanAction,
  parseResetTime,
  DEFAULT_COOLDOWNS,
  AdaptiveWorkerPool,
};
