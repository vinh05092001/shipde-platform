'use strict';

/**
 * Ship Dễ — Sweep Import (TASK-AI-142 T3)
 *
 * Ingests external model/provider sweep results (from logs/night/sweep-*.json)
 * into the Controller's route evidence and candidate exclusion store.
 *
 * Maps probe failures directly to canonical reason codes:
 *   401 → AUTH
 *   402 → QUOTA
 *   403 tier → TIER
 *   429 → RATE
 *   451 → REGION
 *   503 không có kênh → NO_CHANNEL
 *
 * Generated capability evidence is stored in evidenceData.combinations,
 * in the exact shape consumed by probe-order.js and route-evidence.js.
 */

const fs = require('fs');
const path = require('path');
const evidence = require('./evidence');
const sources = require('./sources');
const { candidateKey } = require('./discovery/identity');

const SWEEP_STATUS_CODES = {
  AUTH: 'AUTH',
  QUOTA: 'QUOTA',
  TIER: 'TIER',
  RATE: 'RATE',
  REGION: 'REGION',
  NO_CHANNEL: 'NO_CHANNEL',
};

function classifySweepRow(row) {
  if (!row) return null;
  const statusStr = String(row.status || '').toUpperCase();
  const errStr = String(row.err || '');

  if (
    statusStr === 'SKIP' ||
    statusStr.startsWith('SKIP') ||
    row.probed === false ||
    row.unprobed === true
  ) {
    return null;
  }

  if (statusStr === 'TOOLS_OK') {
    return {
      status: 'passed',
      code: 'OK',
      reason: 'TOOLS_OK',
      httpStatus: 200,
      level: 1,
      proofLevel: 'API_PASS',
    };
  }

  if (statusStr === 'PASSED' || statusStr === 'OK') {
    return {
      status: 'passed',
      code: 'OK',
      reason: statusStr,
      httpStatus: 200,
    };
  }

  let httpStatus = null;
  const statusMatch = statusStr.match(/HTTP_(\d{3})/);
  if (statusMatch) {
    httpStatus = parseInt(statusMatch[1], 10);
  }

  // Check if err contains an embedded upstream HTTP status e.g. [402], [401], etc.
  const innerMatch = errStr.match(/\[(\d{3})\]/);
  const innerStatus = innerMatch ? parseInt(innerMatch[1], 10) : null;

  if (statusStr === 'NO_TOOL_CALL') {
    return {
      status: 'failed',
      code: 'NO_TOOL_CALL',
      reason: 'NO_TOOL_CALL',
      httpStatus: httpStatus || 200,
    };
  }

  const effectiveStatus = innerStatus || httpStatus;

  // 401 → AUTH
  if (effectiveStatus === 401 || /unauthorized|invalid[_\s]api[_\s]key/i.test(errStr)) {
    return {
      status: 'failed',
      code: SWEEP_STATUS_CODES.AUTH,
      reason: SWEEP_STATUS_CODES.AUTH,
      httpStatus: httpStatus || 401,
    };
  }

  // 402 → QUOTA
  // Or balance insufficient / recharge / out of credits
  if (
    effectiveStatus === 402 ||
    /balance is insufficient|recharge your account|insufficient_credits|out of credits|insufficient quota/i.test(
      errStr
    )
  ) {
    return {
      status: 'failed',
      code: SWEEP_STATUS_CODES.QUOTA,
      reason: SWEEP_STATUS_CODES.QUOTA,
      httpStatus: httpStatus || 402,
    };
  }

  // 451 → REGION (or region/country/geo error message)
  if (
    effectiveStatus === 451 ||
    /region|country|geo[_\s]blocked|not supported in your country|unavailable for legal reasons/i.test(
      errStr
    )
  ) {
    return {
      status: 'failed',
      code: SWEEP_STATUS_CODES.REGION,
      reason: SWEEP_STATUS_CODES.REGION,
      httpStatus: httpStatus || 451,
    };
  }

  // 403 → TIER only with tier/plan evidence; a generic forbidden stays a nonspecific HTTP_403 failure.
  if (
    /ultra and power plans|deposit required|requires an active paid plan|upgrade your plan|plan does not include|subscription|tier/i.test(
      errStr
    )
  ) {
    return {
      status: 'failed',
      code: SWEEP_STATUS_CODES.TIER,
      reason: SWEEP_STATUS_CODES.TIER,
      httpStatus: httpStatus || 403,
    };
  }

  // 429 → RATE
  if (effectiveStatus === 429 || /rate limit|too many requests/i.test(errStr)) {
    return {
      status: 'failed',
      code: SWEEP_STATUS_CODES.RATE,
      reason: SWEEP_STATUS_CODES.RATE,
      httpStatus: httpStatus || 429,
    };
  }

  // Missing channel evidence → NO_CHANNEL (TASK-AI-142 P1)
  // Require evidence of a missing channel before assigning that code
  const hasMissingChannelEvidence =
    statusStr === 'NO_CHANNEL' ||
    /no[_\s]channel|model_not_found|no healthy upstream|không có kênh/i.test(errStr) ||
    /no[_\s]channel|model_not_found|no healthy upstream|không có kênh/i.test(statusStr);

  if (hasMissingChannelEvidence) {
    return {
      status: 'failed',
      code: SWEEP_STATUS_CODES.NO_CHANNEL,
      reason: SWEEP_STATUS_CODES.NO_CHANNEL,
      httpStatus: httpStatus || 503,
    };
  }

  return {
    status: 'failed',
    code: statusStr || (httpStatus ? `HTTP_${httpStatus}` : 'FAILED'),
    reason: statusStr || (httpStatus ? `HTTP_${httpStatus}` : 'FAILED'),
    httpStatus: httpStatus || 500,
  };
}

function matchCandidatesForRow(row, candidatePool) {
  if (!Array.isArray(candidatePool) || candidatePool.length === 0) return [];
  const rowModel = String(row.model || '');
  const rowSource = String(row.source || '');
  const rowAccount = row.accountId || row.account;
  const rowQuotaScope = row.quotaScope;
  const classification = classifySweepRow(row);

  const matches = candidatePool.filter((c) => {
    // 1. Gateway match (TASK-AI-142 P1)
    // Candidate matching must require the gateway to match; a direct provider probe
    // must not attach to a router candidate using that upstream.
    const cGateway = c.gateway || '';
    const isDirectCandidate =
      !cGateway || cGateway === 'direct' || cGateway === c.upstream || cGateway === c.source;
    if (row.gateway !== undefined && row.gateway !== null) {
      const isDirectRow = !row.gateway || row.gateway === 'direct';
      if (isDirectRow ? !isDirectCandidate : cGateway !== row.gateway) {
        return false;
      }
    } else {
      if (cGateway && cGateway !== 'direct' && cGateway !== rowSource) {
        return false;
      }
    }

    // 2. Source / Upstream match
    const cSource = c.source || c.sourceId || '';
    const cUpstream = c.upstream || '';
    const srcMatch = cSource === rowSource || cGateway === rowSource || cUpstream === rowSource;
    if (!srcMatch) return false;

    // 2. Model match
    const cModel = c.modelId || c.model || '';
    const modelMatch =
      cModel === rowModel ||
      cModel.endsWith('/' + rowModel) ||
      rowModel.endsWith('/' + cModel) ||
      (cUpstream && rowModel === `${cUpstream}/${cModel}`) ||
      (cGateway && rowModel === `${cGateway}/${cModel}`);
    if (!modelMatch) return false;

    // 3. Account match (if row specifies an account)
    if (rowAccount) {
      const cAccount = c.accountId !== undefined ? c.accountId : c.account;
      // An account-scoped failure belongs to that exact account; a wildcard or unnamed
      // candidate account represents other accounts too and must not inherit it.
      // A row's evidence belongs to that exact account; a wildcard or unnamed candidate
      // account represents other accounts too and must not inherit it.
      if (cAccount !== rowAccount) {
        return false;
      }
    }

    // 4. Harness / access path match (if row specifies them): evidence belongs to the probed route only
    if (row.harness && c.harness && c.harness !== row.harness) return false;
    const rowAccessPath = row.accessPath || row.endpoint;
    if (rowAccessPath && c.accessPath && c.accessPath !== rowAccessPath) return false;

    // 5. Quota scope match (if row specifies quota scope)
    if (rowQuotaScope) {
      if (c.quotaScope && c.quotaScope !== rowQuotaScope) {
        return false;
      }
    }

    return true;
  });

  // Ambiguous attribution returns null (not []): the caller must record no route evidence,
  // rather than falling back to a synthetic default route that may coincide with a candidate.

  // A failure whose row does not name its harness/access path cannot be attributed to one of
  // several distinct credential paths; attribute it to none rather than to all.
  // Applies to successes too: a pass that names no path or account cannot clear another one's cooldown.
  if (classification) {
    const distinctPaths = new Set(matches.map((c) => `${c.harness || ''}|${c.accessPath || ''}`));
    if (distinctPaths.size > 1 && (!row.harness || !(row.accessPath || row.endpoint))) {
      return null;
    }
  }

  // A row is evidence for exactly one route. Several matches (different quota scopes,
  // upstreams sharing a model suffix, accounts or paths) mean the row does not establish
  // which route it probed, so it is attributed to none.
  // Candidates that differ only in how a direct gateway is spelled ('' / 'direct' / the source id)
  // are aliases of one route, not distinct routes.
  const routeIdentity = (c) => {
    const g = c.gateway || '';
    const direct = !g || g === 'direct' || g === c.upstream || g === c.source;
    return [
      c.harness || '',
      c.accessPath || '',
      direct ? 'direct' : g,
      c.upstream || '',
      c.accountId !== undefined ? c.accountId : c.account,
      c.quotaScope || '',
      c.modelId || c.model || '',
    ].join('|');
  };
  if (new Set(matches.map(routeIdentity)).size > 1) return null;

  if (classification && !rowAccount) {
    const distinctAccounts = new Set(
      matches
        .map((c) => (c.accountId !== undefined ? c.accountId : c.account))
        .filter((a) => a !== undefined && a !== null && a !== '*')
    );
    if (distinctAccounts.size > 1) {
      return null;
    }
    // A wildcard or unnamed candidate account does not identify one credential either.
    if (
      matches.some((c) => {
        const a = c.accountId !== undefined ? c.accountId : c.account;
        return a === undefined || a === null || a === '' || a === '*';
      })
    ) {
      return null;
    }
  }

  return matches;
}

function importSweep(sweepInput, options = {}) {
  let sweepObj;
  if (typeof sweepInput === 'string') {
    const raw = fs.readFileSync(sweepInput, 'utf8').replace(/^\uFEFF/, '');
    sweepObj = JSON.parse(raw);
  } else {
    sweepObj = sweepInput;
  }

  const rows = Array.isArray(sweepObj?.rows) ? sweepObj.rows : [];
  const at = sweepObj?.at || new Date(options.now ?? Date.now()).toISOString();
  const evidenceDir =
    options.evidenceDir || options['evidence-dir'] || path.join(__dirname, 'data', 'evidence');
  const evidenceData = options.evidenceData || evidence.loadEvidence(evidenceDir);
  const registry = options.registry || sources.loadSources(options.sourceOpts);

  let importedCount = 0;
  let passedCount = 0;
  let failedCount = 0;
  const breakdown = {
    AUTH: 0,
    QUOTA: 0,
    TIER: 0,
    RATE: 0,
    REGION: 0,
    NO_CHANNEL: 0,
    OTHER: 0,
  };

  const dispatchConfig =
    typeof sources.getDispatchConfig === 'function'
      ? sources.getDispatchConfig(registry, options)
      : (registry && registry.dispatch) || {};
  const rateLimitCooldownMs = Number(
    options.rateLimitCooldownMs ??
      options['rate-limit-cooldown-ms'] ??
      options.rateCooldownMs ??
      dispatchConfig.rateLimitCooldownMs ??
      dispatchConfig.rateCooldownMs ??
      registry?.dispatch?.rateLimitCooldownMs
  );

  let candidatePool = Array.isArray(options.candidates)
    ? options.candidates
    : Array.isArray(options.candidateList)
      ? options.candidateList
      : null;

  if (!candidatePool) {
    try {
      const candidatesApi = require('./candidates');
      const accountsApi = require('./accounts');
      const accounts =
        options.accounts ||
        (typeof accountsApi.listAccounts === 'function' ? accountsApi.listAccounts() : []);
      candidatePool = candidatesApi.generateCandidates({
        registry,
        accounts: Array.isArray(accounts) ? accounts : [],
        catalogue: (options.discoveryCatalogue && options.discoveryCatalogue.candidates) || [],
        evidenceData,
      });
    } catch {
      candidatePool = null;
    }
  }

  for (const row of rows) {
    if (!row || !row.source) continue;
    // P1 Finding 2: Skip all unprobed rows
    const statusUpper = String(row.status || '').toUpperCase();
    if (
      statusUpper === 'SKIP' ||
      statusUpper.startsWith('SKIP') ||
      row.unprobed === true ||
      row.probed === false
    ) {
      continue;
    }

    const classification = classifySweepRow(row);
    if (!classification) continue;

    importedCount++;
    if (classification.status === 'passed') {
      passedCount++;
    } else {
      failedCount++;
      if (breakdown[classification.code] !== undefined) {
        breakdown[classification.code]++;
      } else {
        breakdown.OTHER++;
      }
    }

    const src = sources.getSource(row.source, registry) || {};
    let upstream = row.source;
    let modelId = row.model || '';

    if (src.kind === 'router' && row.model && row.model.includes('/')) {
      const parts = row.model.split('/');
      upstream = parts[0];
      modelId = row.model;
    } else if (src.reachedVia && src.routerAlias) {
      upstream = src.routerAlias;
    }

    const sourceId = src.id || row.source;
    // The route comes from the row or the registry entry, never from a guessed default.
    const defaultHarness = row.harness || src.harness || '';
    const defaultAccessPath =
      row.accessPath || row.endpoint || src.accessPath || src.endpoint || '';
    const defaultGateway = src.kind === 'router' ? sourceId : src.reachedVia || sourceId || '';

    // Match candidate(s) from candidatePool or dispatch config (P1 Finding 3)
    const matchedCandidates = matchCandidatesForRow(row, candidatePool);
    if (matchedCandidates === null) continue;
    // Without a matching candidate, the row or the registry must establish the harness and
    // access path; otherwise record no route evidence.
    if (matchedCandidates.length === 0 && !(defaultHarness && defaultAccessPath)) {
      continue;
    }
    const targetRoutes = [];

    if (matchedCandidates.length > 0) {
      for (const cand of matchedCandidates) {
        const cKey = cand.candidateKey || candidateKey(cand);
        targetRoutes.push({
          harness: cand.harness || defaultHarness,
          accessPath: cand.accessPath || defaultAccessPath,
          gateway: cand.gateway || defaultGateway,
          upstream: cand.upstream || upstream,
          accountId: cand.accountId !== undefined ? cand.accountId : cand.account,
          quotaScope: cand.quotaScope !== undefined ? cand.quotaScope : cand.accountId || upstream,
          modelId: cand.modelId || cand.model || modelId,
          source: cand.source || row.source,
          candidateKey: cKey,
        });
      }
    } else {
      let accountId = row.accountId || row.account;
      let quotaScope = row.quotaScope;

      const isAccountScoped =
        classification.status === 'failed' &&
        (classification.code === SWEEP_STATUS_CODES.AUTH ||
          classification.code === SWEEP_STATUS_CODES.QUOTA ||
          classification.code === SWEEP_STATUS_CODES.RATE ||
          classification.code === SWEEP_STATUS_CODES.TIER);

      // Fail closed: an account-scoped failure that names no account and matches no candidate
      // establishes no exact credential path, so it creates no route evidence.
      if (isAccountScoped && !accountId) {
        continue;
      }

      if (!accountId) {
        if (src.kind === 'router') {
          const upstreamSrc = (registry.sources || []).find(
            (s) =>
              s && s.reachedVia === sourceId && (s.routerAlias === upstream || s.id === upstream)
          );
          if (upstreamSrc) {
            const upstreamAccounts = (upstreamSrc.accounts || []).filter(Boolean);
            if (upstreamAccounts.length > 1) {
              continue;
            }
            accountId = upstreamSrc.id;
            quotaScope =
              quotaScope || (upstreamSrc.quota?.scope === 'account' ? upstreamSrc.id : upstream);
          }
        } else {
          // Only a single registered account identifies the credential; never invent one.
          const srcAccounts = (src.accounts || []).filter(Boolean);
          if (srcAccounts.length !== 1) {
            continue;
          }
          accountId = srcAccounts[0];
        }
      }

      if (!accountId) {
        continue;
      }

      if (!quotaScope) {
        if (src.kind === 'router') {
          quotaScope = upstream;
        } else if (src.quota?.scope === 'account' && accountId) {
          quotaScope = accountId;
        } else {
          quotaScope = accountId || sourceId;
        }
      }

      const routeObj = {
        harness: defaultHarness,
        accessPath: defaultAccessPath,
        gateway: defaultGateway,
        upstream,
        accountId,
        quotaScope: quotaScope || upstream || sourceId,
        modelId,
        source: row.source,
      };
      routeObj.candidateKey = candidateKey(routeObj);
      targetRoutes.push(routeObj);
    }

    // Build evidence item matching probe-order and route-evidence expectations
    const evItem = {
      status: classification.status,
      cause: classification.status === 'failed' ? classification.code : undefined,
      reason: classification.reason,
      code: classification.code,
      httpStatus: classification.httpStatus,
      observedAt: at,
      ts: at,
      elapsedMs: typeof row.ms === 'number' ? row.ms : undefined,
      level: classification.level,
      proofLevel: classification.proofLevel,
    };

    for (const route of targetRoutes) {
      const {
        harness,
        accessPath,
        gateway,
        upstream: routeUpstream,
        accountId,
        quotaScope,
        modelId: routeModelId,
        candidateKey: rKey,
      } = route;

      const cKey = rKey || candidateKey(route);

      // P1 Finding 4: Match the FULL route identity
      evidenceData.combinations = evidenceData.combinations || [];
      let combo = evidenceData.combinations.find((c) => {
        if (c.candidateKey && cKey) {
          return c.candidateKey === cKey;
        }
        return (
          (c.harness || '') === (harness || '') &&
          (c.accessPath || '') === (accessPath || '') &&
          (c.gateway || '') === (gateway || '') &&
          (c.upstream || '') === (routeUpstream || '') &&
          (c.accountId || c.account || '*') === (accountId || '*') &&
          (c.quotaScope || '') === (quotaScope || '') &&
          (c.model === routeModelId || c.modelId === routeModelId)
        );
      });

      if (!combo) {
        combo = {
          harness,
          accessPath,
          gateway,
          upstream: routeUpstream,
          accountId,
          quotaScope,
          model: routeModelId,
          modelId: routeModelId,
          source: row.source,
          sourceId: row.source,
          candidateKey: cKey,
          evidence: [],
        };
        evidenceData.combinations.push(combo);
      }

      combo.evidence = combo.evidence || [];
      combo.evidence.push(evItem);

      // Candidate key variants for direct HTTP, opencode-direct, paseo, etc.
      const modelVariants = new Set([routeModelId]);
      if (routeModelId.includes('/')) {
        modelVariants.add(routeModelId.split('/').slice(1).join('/'));
      }
      if (!routeModelId.startsWith(`${row.source}/`)) {
        modelVariants.add(`${row.source}/${routeModelId}`);
      }
      if (src.modelPrefix && !routeModelId.startsWith(src.modelPrefix)) {
        modelVariants.add(`${src.modelPrefix}${routeModelId}`);
      }

      // Reconcile cooldowns against later successes (TASK-AI-142 P1)
      if (classification.status === 'passed') {
        if (evidenceData.cooldowns) {
          const passTime = new Date(at).getTime();

          // A pass disproves only what it demonstrates: a generic OK does not prove tool calling,
          // so it cannot lift a NO_TOOL_CALL exclusion; only TOOLS_OK (API_PASS proof) can.
          const provesTools = classification.proofLevel === 'API_PASS';
          const shouldClear = (cd) => {
            if (!cd) return false;
            if (cd.cause === 'NO_TOOL_CALL' && !provesTools) return false;
            const blockedTime = cd.blockedAt ? new Date(cd.blockedAt).getTime() : 0;
            return isNaN(blockedTime) || isNaN(passTime) || passTime >= blockedTime;
          };

          // Only the route this row establishes: never widen to sibling harnesses or endpoints
          // (an independently authenticated credential path must not inherit this evidence).
          const validHarnesses = new Set([harness].filter(Boolean));
          const validAccessPaths = new Set([accessPath].filter(Boolean));
          // The established route's own quota scope only; no alternative scopes.
          const validQuotaScopes = new Set([quotaScope].filter(Boolean));

          for (const mVar of modelVariants) {
            const cKeyVariants = new Set();
            if (cKey) cKeyVariants.add(cKey);
            if (combo.candidateKey) cKeyVariants.add(combo.candidateKey);

            for (const h of validHarnesses) {
              for (const aPath of validAccessPaths) {
                for (const qScope of validQuotaScopes) {
                  cKeyVariants.add(
                    candidateKey({
                      harness: h,
                      accessPath: aPath,
                      gateway,
                      upstream: routeUpstream,
                      accountId,
                      quotaScope: qScope,
                      modelId: mVar,
                    })
                  );
                }
              }
            }

            for (const k of cKeyVariants) {
              if (shouldClear(evidenceData.cooldowns[k])) {
                delete evidenceData.cooldowns[k];
              }
            }

            const modelScopeKey = `model::${routeUpstream}::${mVar}`;
            if (shouldClear(evidenceData.cooldowns[modelScopeKey])) {
              delete evidenceData.cooldowns[modelScopeKey];
            }

            const globalModelKey = `model::::${mVar}`;
            if (shouldClear(evidenceData.cooldowns[globalModelKey])) {
              delete evidenceData.cooldowns[globalModelKey];
            }
          }

          // Reconcile any existing candidate cooldowns matching this route
          for (const [key, cd] of Object.entries(evidenceData.cooldowns)) {
            if (!key.includes('::')) continue;
            const parts = key.split('::');
            if (parts.length === 7) {
              const [
                keyHarness,
                keyAccessPath,
                keyGateway,
                keyUpstream,
                keyAccount,
                keyQuota,
                keyModel,
              ] = parts;
              if (keyHarness !== harness || keyAccessPath !== accessPath) continue;
              const modelMatches = modelVariants.has(keyModel) || keyModel === routeModelId;
              // Full route identity, no wildcards: a pass clears only its own route's exclusion.

              const upstreamMatches = keyUpstream === (routeUpstream || '');

              const gatewayMatches = keyGateway === (gateway || '');

              const accountMatches = keyAccount === (accountId || '');

              const quotaMatches = keyQuota === (quotaScope || '');

              if (
                modelMatches &&
                upstreamMatches &&
                gatewayMatches &&
                accountMatches &&
                quotaMatches
              ) {
                if (shouldClear(cd)) {
                  delete evidenceData.cooldowns[key];
                }
              }
            }
          }
        }
      } else if (classification.status === 'failed') {
        evidenceData.cooldowns = evidenceData.cooldowns || {};
        const failTime = new Date(at).getTime();

        const isRateFailure =
          classification.code === SWEEP_STATUS_CODES.RATE ||
          classification.code === 'RATE' ||
          classification.code === 'HTTP_429';

        const isGenericServerError =
          classification.code === 'HTTP_500' ||
          classification.code === 'HTTP_503' ||
          classification.code === 'HTTP_502' ||
          classification.code === 'HTTP_504' ||
          /^HTTP_5\d\d$/.test(classification.code) ||
          (classification.httpStatus >= 500 &&
            classification.httpStatus < 600 &&
            classification.code !== SWEEP_STATUS_CODES.NO_CHANNEL);

        const transientCooldownMs = Number(
          options.transientCooldownMs ??
            options['transient-cooldown-ms'] ??
            dispatchConfig.transientCooldownMs ??
            registry?.dispatch?.transientCooldownMs
        );

        let failureCooldownMs = null;
        if (isRateFailure && Number.isFinite(rateLimitCooldownMs) && rateLimitCooldownMs > 0) {
          failureCooldownMs = rateLimitCooldownMs;
        } else if (
          isGenericServerError &&
          Number.isFinite(transientCooldownMs) &&
          transientCooldownMs > 0
        ) {
          failureCooldownMs = transientCooldownMs;
        }

        const resetTime =
          failureCooldownMs !== null && !isNaN(failTime)
            ? new Date(failTime + failureCooldownMs).toISOString()
            : undefined;

        // Generic HTTP_500/HTTP_503 transient failures must not exclude a route indefinitely
        // (TASK-AI-142 P1). Only record candidate cooldown if finite cooldown is configured.
        // Likewise a RATE failure without a configured finite rate-limit cooldown must not become
        // a permanent exclusion.
        const shouldRecordCandidateCooldown =
          (!isGenericServerError && !isRateFailure) || failureCooldownMs !== null;

        // A later success withholds this failure only if it disproves it: tool-calling failures
        // need tool-calling proof, not a generic OK.
        const needsToolProof = classification.code === 'NO_TOOL_CALL';
        const isSuccess = (ev) =>
          ev &&
          (needsToolProof
            ? ev.status === 'TOOLS_OK' || ev.proofLevel === 'API_PASS'
            : ev.status === 'passed' ||
              ev.status === 'OK' ||
              ev.status === 'TOOLS_OK' ||
              ev.level === 1);

        const hasNewerSuccessForCandidate = (candKey) => {
          if (isNaN(failTime)) return false;
          if (combo && Array.isArray(combo.evidence)) {
            for (const ev of combo.evidence) {
              if (!isSuccess(ev)) continue;
              const evTime = new Date(ev.observedAt || ev.ts).getTime();
              if (!isNaN(evTime) && evTime > failTime) return true;
            }
          }
          if (Array.isArray(evidenceData?.combinations)) {
            for (const c of evidenceData.combinations) {
              if (!c || !Array.isArray(c.evidence)) continue;
              const keyMatches = c.candidateKey && candKey && c.candidateKey === candKey;
              // Full route identity: a success on another credential path proves nothing here.
              const routeMatches =
                (c.harness || '') === (harness || '') &&
                (c.accessPath || '') === (accessPath || '') &&
                (c.gateway || '') === (gateway || '') &&
                (c.upstream || '') === (routeUpstream || '') &&
                (c.accountId || c.account || '*') === (accountId || '*') &&
                (c.quotaScope || '') === (quotaScope || '') &&
                (c.model === routeModelId || c.modelId === routeModelId);
              if (keyMatches || routeMatches) {
                for (const ev of c.evidence) {
                  if (!isSuccess(ev)) continue;
                  const evTime = new Date(ev.observedAt || ev.ts).getTime();
                  if (!isNaN(evTime) && evTime > failTime) return true;
                }
              }
            }
          }
          return false;
        };

        const hasNewerSuccessForModel = (modelName, upstreamName) => {
          if (isNaN(failTime)) return false;
          if (!Array.isArray(evidenceData?.combinations)) return false;
          for (const c of evidenceData.combinations) {
            if (!c || !Array.isArray(c.evidence)) continue;
            const modelMatches = c.model === modelName || c.modelId === modelName;
            if (!modelMatches) continue;
            if (upstreamName && c.upstream && c.upstream !== upstreamName) continue;
            for (const ev of c.evidence) {
              if (!isSuccess(ev)) continue;
              const evTime = new Date(ev.observedAt || ev.ts).getTime();
              if (!isNaN(evTime) && evTime > failTime) return true;
            }
          }
          return false;
        };

        const isExistingCooldownNewer = (cd) => {
          if (!cd || !cd.blockedAt) return false;
          const blockedTime = new Date(cd.blockedAt).getTime();
          return !isNaN(blockedTime) && !isNaN(failTime) && blockedTime > failTime;
        };

        // Account-scoped causes and router NO_CHANNEL are never model-wide, whatever the row claims:
        // they describe one account or one gateway, not the model.
        const isModelWide =
          Boolean(
            row.scope === 'model' ||
            row.modelWide === true ||
            classification.scope === 'model' ||
            classification.isModelWide === true
          ) &&
          classification.code !== SWEEP_STATUS_CODES.NO_CHANNEL &&
          classification.code !== SWEEP_STATUS_CODES.AUTH &&
          classification.code !== SWEEP_STATUS_CODES.QUOTA &&
          classification.code !== SWEEP_STATUS_CODES.RATE &&
          classification.code !== SWEEP_STATUS_CODES.TIER;

        const isAccountScoped =
          classification.code === SWEEP_STATUS_CODES.AUTH ||
          classification.code === SWEEP_STATUS_CODES.QUOTA ||
          classification.code === SWEEP_STATUS_CODES.RATE ||
          classification.code === SWEEP_STATUS_CODES.TIER;

        // Only the route this row establishes: never widen to sibling harnesses or endpoints
        // (an independently authenticated credential path must not inherit this evidence).
        const validHarnesses = new Set([harness].filter(Boolean));
        const validAccessPaths = new Set([accessPath].filter(Boolean));
        // The established route's own quota scope only; no alternative scopes.
        const validQuotaScopes = new Set([quotaScope].filter(Boolean));

        for (const mVar of modelVariants) {
          // Only use model-wide exclusion when the probe establishes a model-wide condition
          if (isModelWide && !isGenericServerError) {
            const globalModelKey = `model::::${mVar}`;
            if (
              !hasNewerSuccessForModel(mVar, null) &&
              !isExistingCooldownNewer(evidenceData.cooldowns[globalModelKey])
            ) {
              evidenceData.cooldowns[globalModelKey] = {
                lastStatus: 'blocked',
                failCount: (evidenceData.cooldowns[globalModelKey]?.failCount || 0) + 1,
                blockedAt: at,
                blockReason: classification.reason,
                cause: classification.code,
                scope: 'model',
                modelId: mVar,
                upstream: '',
                source: row.source,
                cooldownMs: failureCooldownMs,
                ...(resetTime ? { resetTime } : {}),
              };
            }
          }

          // Upstream-scoped cooldown: only when condition is upstream/model-wide and NOT an account-scoped failure
          if (!isAccountScoped && !isGenericServerError && isModelWide) {
            const modelScopeKey = `model::${routeUpstream}::${mVar}`;
            if (
              !hasNewerSuccessForModel(mVar, routeUpstream) &&
              !isExistingCooldownNewer(evidenceData.cooldowns[modelScopeKey])
            ) {
              evidenceData.cooldowns[modelScopeKey] = {
                lastStatus: 'blocked',
                failCount: (evidenceData.cooldowns[modelScopeKey]?.failCount || 0) + 1,
                blockedAt: at,
                blockReason: classification.reason,
                cause: classification.code,
                scope: 'model',
                modelId: mVar,
                upstream: routeUpstream,
                source: row.source,
                cooldownMs: failureCooldownMs,
                ...(resetTime ? { resetTime } : {}),
              };
            }
          }

          // Explicit candidateKeys (keep account-scoped failures scoped to the affected route)
          const cKeyVariants = new Set();
          if (cKey) cKeyVariants.add(cKey);
          if (combo.candidateKey) cKeyVariants.add(combo.candidateKey);

          for (const h of validHarnesses) {
            for (const aPath of validAccessPaths) {
              for (const qScope of validQuotaScopes) {
                cKeyVariants.add(
                  candidateKey({
                    harness: h,
                    accessPath: aPath,
                    gateway,
                    upstream: routeUpstream,
                    accountId,
                    quotaScope: qScope,
                    modelId: mVar,
                  })
                );
              }
            }
          }

          if (shouldRecordCandidateCooldown) {
            for (const k of cKeyVariants) {
              if (
                hasNewerSuccessForCandidate(k) ||
                isExistingCooldownNewer(evidenceData.cooldowns[k])
              ) {
                continue;
              }
              evidenceData.cooldowns[k] = {
                lastStatus: 'blocked',
                failCount: (evidenceData.cooldowns[k]?.failCount || 0) + 1,
                blockedAt: at,
                blockReason: classification.reason,
                cause: classification.code,
                scope: 'candidate',
                modelId: mVar,
                upstream: routeUpstream,
                source: row.source,
                cooldownMs: failureCooldownMs,
                ...(resetTime ? { resetTime } : {}),
              };
            }
          }
        }
      }
    }
  }

  if (options.persist !== false && evidenceDir) {
    evidence.saveEvidence(evidenceDir, evidenceData);
  }

  return {
    imported: importedCount,
    passed: passedCount,
    failed: failedCount,
    breakdown,
    evidenceData,
  };
}

function runSweepImport(filePath, options = {}) {
  const resolved = path.resolve(filePath);
  const result = importSweep(resolved, options);
  console.log(
    `Sweep imported: ${result.imported} probe records from ${filePath}\n` +
      `  Passed: ${result.passed}\n` +
      `  Failed: ${result.failed} (AUTH: ${result.breakdown.AUTH}, QUOTA: ${result.breakdown.QUOTA}, TIER: ${result.breakdown.TIER}, RATE: ${result.breakdown.RATE}, REGION: ${result.breakdown.REGION}, NO_CHANNEL: ${result.breakdown.NO_CHANNEL})`
  );
  return result;
}

module.exports = {
  SWEEP_STATUS_CODES,
  classifySweepRow,
  importSweep,
  runSweepImport,
};
