'use strict';

/**
 * Ship Dễ — 9Router Catalogue Deterministic Batch Runner
 *
 * Requirements:
 * 1. Preflight once per batch (gateway listener, GET /v1/models, auth present).
 *    Gateway dead or HTTP 000 aborts immediately without writing model FAIL rows.
 * 2. Load catalogue once. Queue keyed by harness/accessPath/gateway/upstream/account/quotaScope/modelId.
 * 3. Progressive order: 1 representative model per upstream first. Expand only after content answered.
 *    Proven hard cause (401, 402, 403) defers remaining models within proven shared scope.
 * 4. Adaptive worker pool (start 2, raise to 4/6 on steady metrics, drop on 429/timeout/memory).
 * 5. Parse JSON and SSE. 200 with empty content is FAIL. No HTTP response carries NO httpStatus.
 * 6. Classify on innermost cause (503 wrapping 401, 402, 403, 404, 429).
 * 7. Append each result to JSONL immediately. Restart skips valid results, retries PROBE_INVALID and expired DEFERRED.
 * 8. Stop at stated budget of requests or minutes, checkpoint cleanly.
 * 9. Status is strictly PASS, FAIL, DEFERRED, UNTESTED. Never write verified true.
 */

const fs = require('fs');
const path = require('path');
const { runPreflight } = require('./preflight');
const { loadCatalogue, loadHistory, buildProgressiveQueue } = require('./queue');
const {
  probeModelRequest,
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_READ_TIMEOUT_MS,
} = require('./http-client');
const { AdaptiveWorkerPool } = require('./pool');

const CANONICAL_CLASSIFIER_PATH = path.resolve(__dirname, '..', 'failure-classifier.js');

let _customClassifierLoader = null;
function setClassifierLoader(fn) {
  _customClassifierLoader = fn;
}

let _defaultUpstreamDeferThreshold = 3;
function setUpstreamDeferThreshold(val) {
  _defaultUpstreamDeferThreshold = val;
}

function resolveClassifier(options = {}) {
  const custom = options.classifier || options.failureClassifier;
  if (custom) {
    const classifyFn = typeof custom === 'function' ? custom : custom.classifyFailure;
    if (typeof classifyFn !== 'function') {
      throw new Error(
        'Injected classifier must be a function or an object with a classifyFailure method.'
      );
    }
    return {
      classifyFailure: classifyFn.bind(custom),
      Cause: custom.Cause || {},
      Scope: custom.Scope || {},
    };
  }

  try {
    if (typeof _customClassifierLoader === 'function') {
      return _customClassifierLoader(CANONICAL_CLASSIFIER_PATH);
    }
    return require(CANONICAL_CLASSIFIER_PATH);
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND' || !fs.existsSync(CANONICAL_CLASSIFIER_PATH)) {
      throw new Error(
        `Missing required dependency: canonical failure classifier at '${CANONICAL_CLASSIFIER_PATH}'. ` +
          `Provided by branch 'origin/feat/brain-failure-classes' (PR #144, commit c956913). ` +
          `Ensure PR #144 is merged before running probe-runner, or inject a classifier parameter into runProbeBatch({ classifier }).`
      );
    }
    throw err;
  }
}

/**
 * Appends a single result record to the JSONL output file immediately.
 */
function appendRecord(outPath, record) {
  if (!outPath) return;
  const dir = path.dirname(outPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Enforce invariant: status must be one of PASS, FAIL, DEFERRED, UNTESTED, PROBE_INVALID, UNSUPPORTED_BY_PROBE
  const validStatuses = new Set([
    'PASS',
    'FAIL',
    'DEFERRED',
    'UNTESTED',
    'PROBE_INVALID',
    'UNSUPPORTED_BY_PROBE',
  ]);
  if (!validStatuses.has(record.status)) {
    throw new Error(
      `INVALID_STATUS: \`${record.status}\` is not permitted. Must be PASS, FAIL, DEFERRED, UNTESTED, PROBE_INVALID, UNSUPPORTED_BY_PROBE.`
    );
  }

  // Enforce invariant: Never write verified true
  if ('verified' in record) {
    delete record.verified;
  }

  // Enforce invariant: Never write API key or secrets
  delete record.apiKey;
  delete record.token;
  delete record.authorization;

  const line = JSON.stringify(record) + '\n';
  fs.appendFileSync(outPath, line, 'utf8');
}

/**
 * Executes a deterministic batch probe run.
 *
 * @param {Object} options
 * @param {string} [options.gatewayUrl='http://127.0.0.1:20128']
 * @param {string} [options.apiKey] - Bearer token (reads from NINEROUTER_API_KEY if omitted)
 * @param {string|Array|Object} [options.catalogue] - Catalogue file path, items, or auto-fetch
 * @param {string} [options.outPath] - Path to append results JSONL
 * @param {number} [options.maxRequests=0] - Request budget
 * @param {number} [options.maxMinutes=0] - Time budget in minutes
 * @param {number} [options.concurrency=2] - Initial concurrency
 * @param {number} [options.maxConcurrency=6] - Max concurrency
 * @param {number} [options.connectTimeoutMs=1000] - Separate connect timeout
 * @param {number} [options.readTimeoutMs=15000] - Separate read timeout
 * @returns {Promise<Object>} Batch execution summary
 */
async function runProbeBatch(options = {}) {
  const startTime = Date.now();
  const classifier = resolveClassifier(options);
  const classifyFailure = classifier.classifyFailure;
  const Scope = classifier.Scope || {};
  const Cause = classifier.Cause || {};

  const HARD_CAUSES = new Set([
    Cause.UPSTREAM_CREDIT_EXHAUSTED || 'upstream_credit_exhausted',
    Cause.UPSTREAM_MONTHLY_LIMIT || 'upstream_monthly_limit',
    Cause.UPSTREAM_ENTITLEMENT || 'upstream_entitlement',
    Cause.UPSTREAM_CREDENTIAL || 'upstream_credential',
  ]);

  const gatewayUrl = options.gatewayUrl || 'http://127.0.0.1:20128';
  const apiKey = options.apiKey || process.env.NINEROUTER_API_KEY;
  const outPath =
    options.outPath || path.join(process.cwd(), 'tools', 'ai-brain', 'data', 'probe-results.jsonl');
  const connectTimeoutMs = options.connectTimeoutMs || DEFAULT_CONNECT_TIMEOUT_MS;
  const readTimeoutMs = options.readTimeoutMs || DEFAULT_READ_TIMEOUT_MS;

  // 1. Preflight once per batch.
  // Gateway dead or HTTP 000 aborts immediately without writing model FAIL rows.
  const preflightResult = await runPreflight({
    gatewayUrl,
    apiKey,
    connectTimeoutMs,
  });

  // 2. Load catalogue once.
  let rawCatalogue = options.catalogue;
  if (!rawCatalogue) {
    // If not provided, use models returned by preflight GET /v1/models
    rawCatalogue = preflightResult.models || [];
  }
  const allItems = loadCatalogue(rawCatalogue);

  // 3. Load previous history for restart skipping and retry
  const history = loadHistory(outPath);

  // 4. Progressive queue building
  const { eligible, representatives, remainingByUpstream } = buildProgressiveQueue(
    allItems,
    history,
    startTime
  );

  const pool = new AdaptiveWorkerPool({
    concurrency: options.concurrency || 2,
    maxConcurrency: options.maxConcurrency || 6,
    maxRequests: options.maxRequests || 0,
    maxMinutes: options.maxMinutes || 0,
  });

  const summary = {
    totalCatalogueModels: allItems.length,
    alreadyCompleted: allItems.length - eligible.length,
    probedCount: 0,
    passedCount: 0,
    failedCount: 0,
    deferredCount: 0,
    stoppedDueToBudget: false,
    budgetReason: null,
    durationMs: 0,
    outPath,
  };

  if (eligible.length === 0) {
    summary.durationMs = Date.now() - startTime;
    return summary;
  }

  // Active work queue
  // Initially populated with representative models (1 per upstream)
  const activeQueue = [...representatives];

  // Upstreams that have answered with content and are already expanded
  const expandedUpstreams = new Set();
  // Upstreams that failed with proven hard cause and are deferred
  const deferredUpstreams = new Set();

  const deferThreshold =
    typeof options.upstreamDeferThreshold === 'number'
      ? options.upstreamDeferThreshold
      : _defaultUpstreamDeferThreshold;

  const upstreamFailuresByCause = new Map();

  function markRemainingAsDeferred(upstream, classification) {
    const remaining = remainingByUpstream.get(upstream) || [];
    for (const item of remaining) {
      const deferredRow = {
        key: item.key,
        harness: item.harness,
        accessPath: item.accessPath,
        gateway: item.gateway,
        upstream: item.upstream,
        account: item.account,
        quotaScope: item.quotaScope,
        modelId: item.modelId,
        status: 'DEFERRED',
        ts: new Date().toISOString(),
        latencyMs: null,
        cause: classification.cause,
        scope: classification.scope,
        cooldownMs: classification.cooldownMs,
        cooldownExpiresAt: classification.resetTime
          ? new Date(classification.resetTime).toISOString()
          : classification.cooldownMs
            ? new Date(Date.now() + classification.cooldownMs).toISOString()
            : null,
        reason: `Deferred due to upstream failure: ${classification.cause}`,
      };
      appendRecord(outPath, deferredRow);
      summary.deferredCount++;
      history.set(item.key, deferredRow);
    }
    remainingByUpstream.set(upstream, []);

    for (let i = activeQueue.length - 1; i >= 0; i--) {
      if (activeQueue[i].upstream === upstream) {
        const item = activeQueue.splice(i, 1)[0];
        const deferredRow = {
          key: item.key,
          harness: item.harness,
          accessPath: item.accessPath,
          gateway: item.gateway,
          upstream: item.upstream,
          account: item.account,
          quotaScope: item.quotaScope,
          modelId: item.modelId,
          status: 'DEFERRED',
          ts: new Date().toISOString(),
          latencyMs: null,
          cause: classification.cause,
          scope: classification.scope,
          cooldownMs: classification.cooldownMs,
          cooldownExpiresAt: classification.resetTime
            ? new Date(classification.resetTime).toISOString()
            : classification.cooldownMs
              ? new Date(Date.now() + classification.cooldownMs).toISOString()
              : null,
          reason: `Deferred due to upstream failure: ${classification.cause}`,
        };
        appendRecord(outPath, deferredRow);
        summary.deferredCount++;
        history.set(item.key, deferredRow);
      }
    }
  }

  return new Promise((resolve) => {
    function maybeDone() {
      if (pool.activeWorkers === 0 && (activeQueue.length === 0 || !pool.canStartNewRequest())) {
        summary.stoppedDueToBudget = pool.stoppedDueToBudget;
        summary.budgetReason = pool.budgetReason;
        summary.durationMs = Date.now() - startTime;
        return resolve(summary);
      }
    }

    function pump() {
      while (
        activeQueue.length > 0 &&
        pool.activeWorkers < pool.currentConcurrency &&
        pool.canStartNewRequest()
      ) {
        const item = activeQueue.shift();
        if (deferredUpstreams.has(item.upstream)) {
          continue;
        }
        executeTask(item);
      }
      maybeDone();
    }

    async function executeTask(item) {
      pool.beginRequest();
      summary.probedCount++;

      let outcome;
      try {
        outcome = await probeModelRequest({
          gatewayUrl,
          apiKey,
          modelId: item.modelId,
          connectTimeoutMs,
          readTimeoutMs,
        });
      } catch (err) {
        outcome = {
          ok: false,
          httpStatus: undefined,
          status: 'FAIL',
          networkError: true,
          error: err.message,
          latencyMs: 0,
          body: '',
        };
      }

      pool.recordOutcome(outcome);

      const upstream = item.upstream;
      const isRepresentative = !expandedUpstreams.has(upstream) && !deferredUpstreams.has(upstream);

      if (outcome.ok && outcome.status === 'PASS') {
        // Model answered with content or tool_calls!
        const passRow = {
          key: item.key,
          harness: item.harness,
          accessPath: item.accessPath,
          gateway: item.gateway,
          upstream: item.upstream,
          account: item.account,
          quotaScope: item.quotaScope,
          modelId: item.modelId,
          status: 'PASS',
          ts: new Date().toISOString(),
          latencyMs: outcome.latencyMs,
          httpStatus: outcome.httpStatus || 200,
          cause: null,
          scope: null,
          cooldownMs: null,
          cooldownExpiresAt: null,
          reason: null,
          content: outcome.content ? outcome.content.slice(0, 200) : '',
          responseKind: outcome.responseKind || 'text',
          toolCalls: outcome.toolCalls,
          finishReason: outcome.finishReason,
        };

        appendRecord(outPath, passRow);
        summary.passedCount++;
        history.set(item.key, passRow);

        // Expand inside this upstream if this was the representative
        if (isRepresentative && !expandedUpstreams.has(upstream)) {
          expandedUpstreams.add(upstream);
          const remaining = remainingByUpstream.get(upstream) || [];
          remainingByUpstream.set(upstream, []);
          for (const rem of remaining) {
            activeQueue.push(rem);
          }
        }
      } else if (outcome.status === 'PROBE_INVALID') {
        // Probe configuration issue (e.g., token budget too small) - record for retry
        const probeInvalidRow = {
          key: item.key,
          harness: item.harness,
          accessPath: item.accessPath,
          gateway: item.gateway,
          upstream: item.upstream,
          account: item.account,
          quotaScope: item.quotaScope,
          modelId: item.modelId,
          status: 'PROBE_INVALID',
          ts: new Date().toISOString(),
          latencyMs: outcome.latencyMs,
          httpStatus: outcome.httpStatus,
          cause: null,
          scope: null,
          cooldownMs: 5 * 60 * 1000, // 5 min cooldown before retry
          cooldownExpiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
          reason: outcome.reason,
          finishReason: outcome.finishReason,
          probeInvalid: true,
        };

        appendRecord(outPath, probeInvalidRow);
        summary.failedCount++; // Count as failed for budget but retryable
        history.set(item.key, probeInvalidRow);

        // Don't expand or defer on PROBE_INVALID - just this model needs retry
        if (isRepresentative) {
          const remaining = remainingByUpstream.get(upstream) || [];
          if (remaining.length > 0) {
            const nextRep = remaining.shift();
            remainingByUpstream.set(upstream, remaining);
            activeQueue.push(nextRep);
          }
        }
      } else if (outcome.status === 'UNSUPPORTED_BY_PROBE') {
        // Model type not supported by chat/completions probe (decisions, embeddings, image, audio)
        const unsupportedRow = {
          key: item.key,
          harness: item.harness,
          accessPath: item.accessPath,
          gateway: item.gateway,
          upstream: item.upstream,
          account: item.account,
          quotaScope: item.quotaScope,
          modelId: item.modelId,
          status: 'UNSUPPORTED_BY_PROBE',
          ts: new Date().toISOString(),
          latencyMs: outcome.latencyMs,
          httpStatus: outcome.httpStatus,
          cause: 'unsupported_by_probe',
          scope: 'model',
          cooldownMs: null,
          cooldownExpiresAt: null,
          reason: outcome.reason,
        };

        appendRecord(outPath, unsupportedRow);
        // Not counted as failed - it's a known limitation
        history.set(item.key, unsupportedRow);

        // Don't expand or defer on UNSUPPORTED_BY_PROBE
        if (isRepresentative) {
          const remaining = remainingByUpstream.get(upstream) || [];
          if (remaining.length > 0) {
            const nextRep = remaining.shift();
            remainingByUpstream.set(upstream, remaining);
            activeQueue.push(nextRep);
          }
        }
      } else {
        // Model failed with a real error
        const classification = classifyFailure({
          httpStatus: outcome.innerError?.innerStatus ?? outcome.httpStatus,
          body: outcome.innerError?.innerMessage
            ? `${outcome.innerError.innerMessage}\n${outcome.body || outcome.error || ''}`
            : outcome.body || outcome.error || '',
          stderr: outcome.error || '',
        });

        const failRow = {
          key: item.key,
          harness: item.harness,
          accessPath: item.accessPath,
          gateway: item.gateway,
          upstream: item.upstream,
          account: item.account,
          quotaScope: item.quotaScope,
          modelId: item.modelId,
          status: 'FAIL',
          ts: new Date().toISOString(),
          latencyMs: outcome.latencyMs,
          cause: classification.cause,
          scope: classification.scope,
          cooldownMs: classification.cooldownMs,
          cooldownExpiresAt: classification.resetTime
            ? new Date(classification.resetTime).toISOString()
            : classification.cooldownMs
              ? new Date(Date.now() + classification.cooldownMs).toISOString()
              : null,
          reason: outcome.reason || classification.cause,
        };

        // Network or process failure with no HTTP response carries NO httpStatus
        if (typeof outcome.httpStatus === 'number') {
          failRow.httpStatus = outcome.httpStatus;
        }

        appendRecord(outPath, failRow);
        summary.failedCount++;
        history.set(item.key, failRow);

        const isUpstreamScope = classification.scope === (Scope.UPSTREAM || 'upstream');
        let shouldDeferUpstream = false;

        if (isUpstreamScope) {
          if (!upstreamFailuresByCause.has(upstream)) {
            upstreamFailuresByCause.set(upstream, new Map());
          }
          const causeMap = upstreamFailuresByCause.get(upstream);
          if (!causeMap.has(classification.cause)) {
            causeMap.set(classification.cause, new Set());
          }
          const failedModels = causeMap.get(classification.cause);
          failedModels.add(item.modelId);

          if (failedModels.size >= deferThreshold) {
            shouldDeferUpstream = true;
          }
        }

        if (shouldDeferUpstream) {
          // Defer all remaining models in this proven shared scope
          deferredUpstreams.add(upstream);
          markRemainingAsDeferred(upstream, classification);
        } else {
          // If this upstream has not expanded yet (representative probe phase),
          // keep probing the others by promoting the next candidate!
          if (!expandedUpstreams.has(upstream) && !deferredUpstreams.has(upstream)) {
            const remaining = remainingByUpstream.get(upstream) || [];
            if (remaining.length > 0) {
              const nextRep = remaining.shift();
              remainingByUpstream.set(upstream, remaining);
              activeQueue.push(nextRep);
            }
          }
        }
      }

      pump();
    }

    pump();
  });
}

module.exports = {
  runProbeBatch,
  appendRecord,
  resolveClassifier,
  CANONICAL_CLASSIFIER_PATH,
  setClassifierLoader,
  setUpstreamDeferThreshold,
  UPSTREAM_DEFER_THRESHOLD: 3,
};
