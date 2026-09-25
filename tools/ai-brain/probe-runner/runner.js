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
const { classifyFailure, Scope, Cause } = require('./failure-classifier');
const { AdaptiveWorkerPool } = require('./pool');

const HARD_CAUSES = new Set([
  Cause.UPSTREAM_CREDIT_EXHAUSTED,
  Cause.UPSTREAM_MONTHLY_LIMIT,
  Cause.UPSTREAM_ENTITLEMENT,
  Cause.UPSTREAM_CREDENTIAL,
]);

/**
 * Appends a single result record to the JSONL output file immediately.
 */
function appendRecord(outPath, record) {
  if (!outPath) return;
  const dir = path.dirname(outPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Enforce invariant: status must be one of PASS, FAIL, DEFERRED, UNTESTED
  const validStatuses = new Set(['PASS', 'FAIL', 'DEFERRED', 'UNTESTED']);
  if (!validStatuses.has(record.status)) {
    throw new Error(
      `INVALID_STATUS: \`${record.status}\` is not permitted. Must be PASS, FAIL, DEFERRED, UNTESTED.`
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
        // Model answered with content!
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
      } else {
        // Model failed
        const classification = classifyFailure({
          httpStatus: outcome.httpStatus,
          body: outcome.body || outcome.error || '',
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

        // Check if this was a representative model failing
        if (isRepresentative) {
          const isHardCause =
            HARD_CAUSES.has(classification.cause) ||
            outcome.httpStatus === 401 ||
            outcome.httpStatus === 402 ||
            outcome.httpStatus === 403;
          const isProvenSharedScope = classification.scope === Scope.UPSTREAM;

          if (isHardCause && isProvenSharedScope) {
            // Defer all remaining models in this proven shared scope
            deferredUpstreams.add(upstream);
            markRemainingAsDeferred(upstream, classification);
          } else {
            // Not a proven shared hard cause (e.g. 404 one model only, empty content, etc.)
            // Only this failing model failed!
            // Try promoting the next candidate from this upstream as representative
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
};
