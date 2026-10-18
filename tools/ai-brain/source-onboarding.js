'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const sourcesApi = require('./sources');
const routeProbe = require('./route-probe');
const routeHealth = require('./route-health');
const priorsApi = require('./priors');
const candidatesApi = require('./candidates');
const routing = require('./routing');
const orchestrateApi = require('./orchestrate');

const DEFAULT_FIXTURES_DIR = path.join(__dirname, 'test', 'fixtures', 'sources');

/**
 * Sanitize a string to eliminate any secret API keys, bearer tokens, full email addresses,
 * or request IDs, without altering model names (such as "tokenrouter" or "@cf/...") or usage metrics.
 */
function sanitizeText(str, env) {
  if (typeof str !== 'string') return str;
  let out = str;

  // Redact Bearer tokens
  out = out.replace(/Bearer\s+[a-zA-Z0-9_.\-]+/gi, 'Bearer [AUTH]');

  // Redact sk- style keys
  out = out.replace(/sk-[a-zA-Z0-9_\-]+/gi, '[KEY]');

  // Redact exact secret values from any environment variable ending in _API_KEY, _TOKEN, _SECRET
  const envObj = env || process.env;
  if (envObj && typeof envObj === 'object') {
    for (const [k, v] of Object.entries(envObj)) {
      if (typeof v === 'string' && v.length >= 8 && /(API_KEY|TOKEN|SECRET)$/i.test(k)) {
        const escaped = v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        out = out.replace(new RegExp(escaped, 'g'), '[REDACTED_SECRET]');
      }
    }
  }

  // Redact full email addresses (preserve @ in model names like @cf/...)
  out = out.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[REDACTED_EMAIL]');

  // Redact request IDs
  out = out.replace(/chatcmpl-[a-zA-Z0-9_\-]+/gi, 'chatcmpl-[REDACTED]');
  out = out.replace(/req_[a-zA-Z0-9_\-]+/gi, 'req_[REDACTED]');

  return out;
}

/**
 * Deep sanitization of objects/arrays before writing to fixture files.
 */
function sanitizeFixtureData(data, env) {
  if (data === null || data === undefined) return data;
  if (typeof data === 'string') return sanitizeText(data, env);
  if (typeof data === 'number' || typeof data === 'boolean') return data;
  if (Array.isArray(data)) return data.map((item) => sanitizeFixtureData(item, env));
  if (typeof data === 'object') {
    const copy = {};
    for (const [k, v] of Object.entries(data)) {
      // Redact authorization headers or secret key fields
      if (/authorization|apikey|api_key|secret/i.test(k)) {
        copy[k] = '[AUTH]';
        continue;
      }
      copy[k] = sanitizeFixtureData(v, env);
    }
    return copy;
  }
  return data;
}

/**
 * Converts a model id into a safe filename for fixture storage.
 */
function safeModelFilename(modelId) {
  return String(modelId || '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Step 1: Gắn
 */
function step1Attach(source, env) {
  const endpoint = source.endpoint || '';
  const credential = source.credential || {};
  const envVar = credential.env || '';
  const keyPresent = Boolean(env && envVar && env[envVar]);
  return {
    sourceId: source.id,
    label: source.label || source.id,
    endpoint,
    envVar,
    keyPresent,
    harness: source.harness || 'paseo',
    kind: source.kind || 'provider',
  };
}

/**
 * Step 2: Danh sách model
 */
async function step2ListModels(source, env, options) {
  const o = options || {};
  const fixturesDir = o.fixturesDir || path.join(DEFAULT_FIXTURES_DIR, source.id);

  if (o.replay) {
    const modelsFile = path.join(fixturesDir, 'models.json');
    if (!fs.existsSync(modelsFile)) {
      throw new Error(`Fixture models.json không tồn tại: ${modelsFile}`);
    }
    const raw = JSON.parse(fs.readFileSync(modelsFile, 'utf8'));
    const models = Array.isArray(raw) ? raw : (raw && raw.data) || [];
    return {
      total: models.length,
      models: models.map((m) => (typeof m === 'string' ? m : m.id || m.model || String(m))),
      fromFixture: true,
      ok: true,
    };
  }

  // Live recording
  const endpoint = String(source.endpoint || '').replace(/\/+$/, '');
  const url = `${endpoint}/models`;
  const envVar = (source.credential && source.credential.env) || '';
  const apiKey = (env && env[envVar]) || '';
  if (!apiKey) {
    return {
      total: 0,
      models: [],
      ok: false,
      reason: `AUTH_MISSING: Biến môi trường ${envVar} chưa được thiết lập`,
    };
  }

  const fetchFn = o.fetch || globalThis.fetch;
  try {
    const res = await fetchFn(url, {
      headers: {
        authorization: `Bearer ${apiKey}`,
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const cause = routeProbe.classifyProbeFailure({ status: res.status, body });
      return {
        total: 0,
        models: [],
        ok: false,
        status: res.status,
        reason: `HTTP_${res.status}: ${routeProbe.failureReason(cause) || 'FETCH_FAILED'}`,
      };
    }
    const data = await res.json();
    const list = Array.isArray(data.data) ? data.data : Array.isArray(data) ? data : [];
    const modelIds = list.map((m) => m.id || m.model || String(m));
    return {
      total: modelIds.length,
      models: modelIds,
      ok: true,
    };
  } catch (err) {
    return {
      total: 0,
      models: [],
      ok: false,
      reason: `NETWORK_ERROR: ${err && err.message}`,
    };
  }
}

/**
 * Step 3: Gọi thử
 */
async function step3ProbeModels(source, modelsToProbe, env, options) {
  const o = options || {};
  const fixturesDir = o.fixturesDir || path.join(DEFAULT_FIXTURES_DIR, source.id);
  const results = [];

  if (o.replay) {
    for (const modelId of modelsToProbe) {
      const filename = `chat-${safeModelFilename(modelId)}.json`;
      const fixturePath = path.join(fixturesDir, filename);
      if (fs.existsSync(fixturePath)) {
        const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
        results.push({
          modelId,
          ok: Boolean(fixture.ok),
          status:
            fixture.status !== undefined && Number.isFinite(Number(fixture.status))
              ? Number(fixture.status)
              : fixture.ok
                ? 200
                : 500,
          body: fixture.body || '',
          cause: fixture.cause || (fixture.ok ? null : 'PROBE_FAILED'),
          fromFixture: true,
        });
      } else {
        // Fallback if individual model chat fixture not present
        results.push({
          modelId,
          ok: false,
          status: 404,
          body: 'Fixture not found',
          cause: 'FIXTURE_NOT_FOUND',
          fromFixture: true,
        });
      }
    }
    return results;
  }

  // Live probe: run concurrently bounded by dispatch.maxConcurrentProbes
  const registry = o.registry || sourcesApi.loadSources();
  const dispatchConfig = sourcesApi.getDispatchConfig(registry, o);
  const maxConcurrent = Math.max(1, dispatchConfig.maxConcurrentProbes || 1);

  const queue = [...modelsToProbe];
  const probeOne = async (modelId) => {
    const candidate = {
      harness: source.harness || 'paseo',
      accessPath: source.endpoint,
      gateway: source.id,
      upstream: candidatesApi.parsePrefix
        ? candidatesApi.parsePrefix(modelId)?.upstream || source.id
        : source.id,
      accountId: `${source.id}-${((source.credential && source.credential.env) || 'key').toLowerCase().replace(/_/g, '-')}`,
      quotaScope: `${source.id}-${((source.credential && source.credential.env) || 'key').toLowerCase().replace(/_/g, '-')}`,
      modelId,
    };
    candidate.candidateKey = candidatesApi.candidateKey(candidate);

    const apiKeyEnv = (source.credential && source.credential.env) || '';
    const probeRes = await routeProbe.probeRoute(candidate, apiKeyEnv, env, {
      timeoutMs: o.timeoutMs || dispatchConfig.probeTimeoutMs || 8000,
      fetch: o.fetch,
    });

    let isOk = probeRes.ok;
    let status = probeRes.status;
    let body = probeRes.body || '';

    // 9router stream SSE returns 200 with data: chunk — mark as alive
    if (status === 200) {
      isOk = true;
    }

    const cause = isOk ? null : routeProbe.classifyProbeFailure({ status, body });
    return {
      modelId,
      ok: isOk,
      status,
      body,
      cause: cause ? routeProbe.failureReason(cause) : null,
      rawCause: cause,
      candidate,
    };
  };

  const pool = [];
  const worker = async () => {
    while (queue.length > 0) {
      const modelId = queue.shift();
      const res = await probeOne(modelId);
      results.push(res);
    }
  };

  for (let i = 0; i < maxConcurrent && i < modelsToProbe.length; i++) {
    pool.push(worker());
  }
  await Promise.all(pool);

  const byModel = new Map(results.map((r) => [r.modelId, r]));
  return modelsToProbe.map((m) => byModel.get(m)).filter(Boolean);
}

/**
 * Step 4: Chấm điểm
 */
function step4ScoreModels(probedResults, priors) {
  const scored = [];
  for (const item of probedResults) {
    const prior = priorsApi.priorFor({ modelId: item.modelId }, 'writer', priors);
    if (!prior || prior.priorUnknown || prior.score === null) {
      scored.push({
        modelId: item.modelId,
        resolvedModelId: item.modelId,
        isAlias: false,
        status: item.ok ? 'QUALITY_UNKNOWN' : 'PROBE_FAILED',
        tier: 'UNKNOWN',
        score: null,
        bonus: 0,
        priorUnknown: true,
        httpStatus: item.status,
        live: item.ok,
      });
    } else {
      scored.push({
        modelId: item.modelId,
        resolvedModelId: item.modelId,
        isAlias: false,
        canonical: prior.canonical,
        tier: prior.tier,
        score: prior.score,
        bonus: prior.bonus,
        liveBench: prior.liveBench || null,
        status: item.ok ? 'SCORED' : 'PROBE_FAILED',
        priorUnknown: false,
        httpStatus: item.status,
        live: item.ok,
      });
    }
  }
  return scored;
}

/**
 * Step 5: Ghi bằng chứng
 */
function step5RecordEvidence(source, probedResults, options) {
  const o = options || {};
  const tmpHealthFile =
    o.routeHealthFile || path.join(os.tmpdir(), `onboard-health-${Date.now()}.json`);
  const store = o.routeHealth || { version: 1, paths: {}, events: [] };
  const records = [];

  for (const p of probedResults) {
    const candidate = p.candidate || {
      harness: source.harness || 'paseo',
      accessPath: source.endpoint,
      gateway: source.id,
      upstream: candidatesApi.parsePrefix
        ? candidatesApi.parsePrefix(p.modelId)?.upstream || source.id
        : source.id,
      accountId: `${source.id}-${((source.credential && source.credential.env) || 'key').toLowerCase().replace(/_/g, '-')}`,
      quotaScope: `${source.id}-${((source.credential && source.credential.env) || 'key').toLowerCase().replace(/_/g, '-')}`,
      modelId: p.modelId,
    };
    if (!candidate.candidateKey) candidate.candidateKey = candidatesApi.candidateKey(candidate);

    const rec = routeHealth.rememberProbe(
      candidate,
      { ok: p.ok, status: p.status, body: p.body },
      {
        routeHealth: store,
        routeHealthFile: tmpHealthFile,
        persistRouteHealth: o.persistRouteHealth === true,
        now: o.now || Date.now(),
      }
    );
    records.push({
      modelId: p.modelId,
      candidateKey: candidate.candidateKey,
      status: rec ? rec.status : 'RECORDED',
    });
  }

  return {
    recorded: records.length,
    records,
    healthFile: tmpHealthFile,
  };
}

/**
 * Step 6: Kiểm Controller thấy
 */
async function step6ControllerVisibility(source, liveModels, registry, priors, options) {
  const o = options || {};
  const catalogue = liveModels;
  const sourceModels = { [source.id]: liveModels };
  const env = Object.assign({}, process.env, o.env);

  const envVar = source.credential && source.credential.env;
  const prevEnvVal = envVar ? process.env[envVar] : undefined;
  if (envVar && env[envVar] && !process.env[envVar]) {
    process.env[envVar] = env[envVar];
  }

  try {
    const buildOpts = {
      registry,
      catalogue,
      sourceModels,
      enforceProofFloors: true,
      ranking: { priors: priors || priorsApi.loadPriors() },
      env,
    };

    // 1. Generate candidates via orchestrate.js:3127 buildCandidates
    const candidates = orchestrateApi.buildCandidates(buildOpts, null);
    const sourceCandidates = candidates.filter(
      (c) => c.gateway === source.id || c.sourceId === source.id || c.source === source.id
    );

    // 2. Select candidate via orchestrate.js:3248 selectCandidateForProfile
    const item = {
      id: 'GOAL-ONBOARD-STEP6',
      role: 'writer',
    };
    const selectResult = await orchestrateApi.selectCandidateForProfile(
      item,
      candidates,
      [],
      null,
      buildOpts,
      { skipDecisionLog: true, logDir: null },
      o.now || Date.now(),
      { attempt: 1 }
    );

    const rankResult = (selectResult && selectResult.result) || {};
    const rankedList = rankResult.ranking || [];
    const rankedKeySet = new Set(
      rankedList.map((r) => r.candidateKey || candidatesApi.candidateKey(r))
    );
    const rejectedList = rankResult.rejected || [];
    const rejectedMap = new Map(rejectedList.map((r) => [r.candidateKey, r]));

    const visibility = [];
    for (const m of liveModels) {
      const cands = sourceCandidates.filter((c) => c.modelId === m);
      if (cands.length === 0) {
        visibility.push({
          modelId: m,
          inRanking: false,
          layer: 'candidates.js (Candidate Generation)',
          reason: 'GATEWAY_PREFIX_OR_ROUTE_UNMATCHED',
        });
        continue;
      }

      const inRank = cands.some((c) =>
        rankedKeySet.has(c.candidateKey || candidatesApi.candidateKey(c))
      );
      if (inRank) {
        const rankedItem = rankedList.find((r) =>
          cands.some(
            (c) =>
              (c.candidateKey || candidatesApi.candidateKey(c)) ===
              (r.candidateKey || candidatesApi.candidateKey(r))
          )
        );
        visibility.push({
          modelId: m,
          inRanking: true,
          score: rankedItem ? rankedItem.score : 0,
          harness: rankedItem ? rankedItem.harness : cands[0].harness,
        });
      } else {
        const rej = cands
          .map((c) => rejectedMap.get(c.candidateKey || candidatesApi.candidateKey(c)))
          .find(Boolean);
        visibility.push({
          modelId: m,
          inRanking: false,
          layer: rej ? 'routing.js (Policy / Floor Filter)' : 'routing.js (Unknown)',
          reason: rej ? rej.reasonCode || rej.reason || 'REJECTED' : 'UNRANKED',
        });
      }
    }

    return {
      candidatesGenerated: sourceCandidates.length,
      rankingTotal: rankedList.length,
      visibility,
    };
  } finally {
    if (envVar) {
      if (prevEnvVal === undefined) {
        delete process.env[envVar];
      } else {
        process.env[envVar] = prevEnvVal;
      }
    }
  }
}

/**
 * Main Onboard execution for a single source.
 */
async function onboardSource(sourceId, options) {
  const o = options || {};
  const registry = o.registry || sourcesApi.loadSources();
  const source = sourcesApi.getSource(sourceId, registry);
  if (!source) {
    throw new Error(`Nguồn "${sourceId}" không tìm thấy trong sources.json`);
  }

  // Load windows environment and probe fallback if not present
  try {
    const winEnvLoader =
      'C:/Users/gumac/AI/shipde-platform/.worktrees/logs/hermes-brain/load-win-env';
    if (fs.existsSync(winEnvLoader + '.js')) {
      require(winEnvLoader).loadWindowsEnv(process.env);
    }
  } catch (_) {}
  if (!process.env.NINEROUTER_API_KEY) {
    try {
      const probeSh = 'C:/Users/gumac/AI/shipde-platform/.worktrees/logs/probe-models.sh';
      if (fs.existsSync(probeSh)) {
        const m = fs.readFileSync(probeSh, 'utf8').match(/NINEROUTER_API_KEY:-([^}\r\n]+)/);
        if (m) process.env.NINEROUTER_API_KEY = m[1].trim();
      }
    } catch (_) {}
  }

  const env = Object.assign({}, process.env, o.env);
  if (o.replay && source.credential && source.credential.env && !env[source.credential.env]) {
    env[source.credential.env] = 'mock-replay-key';
  }
  const priors = o.priors || priorsApi.loadPriors();
  const fixturesDir = o.fixturesDir || path.join(DEFAULT_FIXTURES_DIR, source.id);

  // Step 1: Gắn
  const step1 = step1Attach(source, env);

  // Step 2: Danh sách model
  const step2 = await step2ListModels(source, env, {
    replay: o.replay,
    fixturesDir,
    fetch: o.fetch,
  });

  const isLeaderboardModel = (m) => {
    const p = priorsApi.priorFor({ modelId: m }, 'writer', priors);
    if (p && !p.priorUnknown && p.score !== null) return true;
    const stripped = m.replace(/-(?:mini|nano)$/, '');
    if (stripped !== m) {
      const p2 = priorsApi.priorFor({ modelId: stripped }, 'writer', priors);
      return Boolean(p2 && !p2.priorUnknown && p2.score !== null);
    }
    return false;
  };

  // Determine models to probe
  let modelsToProbe = [];
  if (o.replay) {
    // In replay, read existing chat fixtures or expected.json
    if (fs.existsSync(fixturesDir)) {
      const expectedFile = path.join(fixturesDir, 'expected.json');
      if (fs.existsSync(expectedFile)) {
        try {
          const expected = JSON.parse(fs.readFileSync(expectedFile, 'utf8'));
          if (expected.models) modelsToProbe = Object.keys(expected.models);
        } catch (_) {}
      }
      if (modelsToProbe.length === 0) {
        const files = fs.readdirSync(fixturesDir);
        modelsToProbe = files
          .filter((f) => f.startsWith('chat-') && f.endsWith('.json'))
          .map((f) => f.slice(5, -5));
      }
    }
  } else if (Array.isArray(o.models) && o.models.length > 0) {
    modelsToProbe = o.models;
  } else if (Array.isArray(step2.models)) {
    // 1. All models belonging to router upstreams that match live leaderboard priors
    const routerPrefixes = new Set(['ag', 'tokenrouter', 'gcli', 'gh']);
    const scored = step2.models.filter(
      (m) => routerPrefixes.has(m.split('/')[0]) && isLeaderboardModel(m)
    );
    // 2. Representative sample for distinct error domains and unranked aliases
    const otherPrefixes = new Set();
    const errorSamples = [];
    for (const m of step2.models) {
      const prefix = candidatesApi.parsePrefix
        ? candidatesApi.parsePrefix(m)?.upstream
        : m.split('/')[0];
      if (
        prefix &&
        !routerPrefixes.has(prefix) &&
        !otherPrefixes.has(prefix) &&
        otherPrefixes.size < 6
      ) {
        otherPrefixes.add(prefix);
        errorSamples.push(m);
      }
    }

    // Bare/unprefixed model (e.g. vinh) to test candidate generation layer refusal
    const unrouted = step2.models.find((m) => !m.includes('/'));
    if (unrouted) errorSamples.push(unrouted);

    // Unranked aliases under router prefixes to test unranked candidate handling
    const unrankedRouter = step2.models.filter(
      (m) => routerPrefixes.has(m.split('/')[0]) && !isLeaderboardModel(m)
    );
    for (const m of unrankedRouter) {
      if (errorSamples.length >= 15) break;
      errorSamples.push(m);
    }

    // Negative probe to test nonexistent model handling
    errorSamples.push(`${source.id}/nonexistent-probe-test`);

    modelsToProbe = Array.from(new Set([...scored, ...errorSamples]));
  }

  // Step 3: Gọi thử
  const step3 = await step3ProbeModels(source, modelsToProbe, env, {
    replay: o.replay,
    fixturesDir,
    timeoutMs: o.timeoutMs,
    fetch: o.fetch,
  });

  // Step 4: Chấm điểm
  const step4 = step4ScoreModels(step3, priors);

  // Step 5: Ghi bằng chứng
  const step5 = step5RecordEvidence(source, step3, {
    routeHealthFile: o.routeHealthFile,
    persistRouteHealth: o.persistRouteHealth,
    now: o.now,
  });

  // Step 6: Kiểm Controller thấy
  const liveModels = step3.filter((p) => p.ok).map((p) => p.modelId);
  const step6 = await step6ControllerVisibility(source, liveModels, registry, priors, {
    ...o,
    env,
  });

  // Summary object
  const modelsSummary = {};
  for (const p of step3) {
    const sc = step4.find((s) => s.modelId === p.modelId);
    const vis = step6.visibility.find((v) => v.modelId === p.modelId);
    modelsSummary[p.modelId] = {
      live: p.ok,
      httpStatus: p.status,
      cause: p.cause || null,
      score: sc ? sc.score : null,
      status: sc ? sc.status : 'UNKNOWN',
      inRanking: vis ? vis.inRanking : false,
      filterLayer: vis && !vis.inRanking ? vis.layer : null,
      filterReason: vis && !vis.inRanking ? vis.reason : null,
    };
  }

  const result = {
    sourceId: source.id,
    step1_attach: sanitizeFixtureData(step1, env),
    step2_models: {
      total: step2.total,
      ok: step2.ok,
      reason: step2.reason || null,
    },
    step3_probe: {
      probed: step3.length,
      live: liveModels.length,
      failed: step3.length - liveModels.length,
    },
    step4_scoring: sanitizeFixtureData(step4, env),
    step5_evidence: {
      recorded: step5.recorded,
    },
    step6_controller: sanitizeFixtureData(step6, env),
    models: sanitizeFixtureData(modelsSummary, env),
  };

  // If recording, write fixtures to directory
  if (o.record) {
    fs.mkdirSync(fixturesDir, { recursive: true });

    // 1. Write models.json
    const cleanModels = (step2.models || []).map((m) => sanitizeText(m, env));
    fs.writeFileSync(
      path.join(fixturesDir, 'models.json'),
      JSON.stringify(cleanModels, null, 2),
      'utf8'
    );

    // 2. Remove any obsolete chat fixtures before writing
    const existingChatFiles = fs
      .readdirSync(fixturesDir)
      .filter((f) => f.startsWith('chat-') && f.endsWith('.json'));
    for (const f of existingChatFiles) {
      try {
        fs.unlinkSync(path.join(fixturesDir, f));
      } catch (_) {}
    }

    // Write chat-*.json
    for (const p of step3) {
      const filename = `chat-${safeModelFilename(p.modelId)}.json`;
      const cleanBody = sanitizeText(
        typeof p.body === 'string' ? p.body : JSON.stringify(p.body),
        env
      );
      const chatFixture = {
        modelId: p.modelId,
        status: p.status,
        ok: p.ok,
        cause: p.cause || null,
        body: cleanBody,
      };
      fs.writeFileSync(
        path.join(fixturesDir, filename),
        JSON.stringify(chatFixture, null, 2),
        'utf8'
      );
    }

    // 3. Write expected.json
    fs.writeFileSync(
      path.join(fixturesDir, 'expected.json'),
      JSON.stringify(result, null, 2),
      'utf8'
    );

    // Verify sanitization
    verifyFixtureSanitization(fixturesDir, env);
  }

  return result;
}

/**
 * Asserts that no sensitive tokens, keys, emails or credentials remain in fixtures.
 */
function verifyFixtureSanitization(dir, env) {
  const envObj = env || process.env;
  const files = fs.readdirSync(dir);
  for (const f of files) {
    const fullPath = path.join(dir, f);
    if (fs.statSync(fullPath).isFile()) {
      const content = fs.readFileSync(fullPath, 'utf8');
      const skMatch = content.match(/sk-[a-zA-Z0-9_\-]+/i);
      if (skMatch) {
        throw new Error(
          `Sanitization violation in ${fullPath}: matched secret key pattern at position ${skMatch.index}`
        );
      }
      const bearerMatch = content.match(/Bearer\s+[a-zA-Z0-9_.\-]{8,}/i);
      if (bearerMatch && !bearerMatch[0].includes('[AUTH]')) {
        throw new Error(
          `Sanitization violation in ${fullPath}: matched unredacted Bearer token at position ${bearerMatch.index}`
        );
      }
      const emailMatch = content.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i);
      if (emailMatch) {
        throw new Error(
          `Sanitization violation in ${fullPath}: matched email pattern at position ${emailMatch.index}`
        );
      }
      if (envObj) {
        for (const [k, v] of Object.entries(envObj)) {
          if (typeof v === 'string' && v.length >= 8 && /(API_KEY|TOKEN|SECRET)$/i.test(k)) {
            if (content.includes(v)) {
              throw new Error(`Sanitization violation in ${fullPath}: leaked secret value of ${k}`);
            }
          }
        }
      }
    }
  }
}

/**
 * Replay all sources under fixtures/sources/
 */
async function replayAllSources(options) {
  const o = options || {};
  const fixturesRoot = o.fixturesDir || DEFAULT_FIXTURES_DIR;
  if (!fs.existsSync(fixturesRoot)) {
    return [];
  }

  const entries = fs.readdirSync(fixturesRoot, { withFileTypes: true });
  const sourceDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);

  const results = [];
  for (const id of sourceDirs) {
    const dir = path.join(fixturesRoot, id);
    const expectedFile = path.join(dir, 'expected.json');
    let expected = null;
    if (fs.existsSync(expectedFile)) {
      expected = JSON.parse(fs.readFileSync(expectedFile, 'utf8'));
    }

    const outcome = await onboardSource(id, {
      ...o,
      replay: true,
      record: false,
      fixturesDir: dir,
    });

    results.push({
      sourceId: id,
      outcome,
      expected,
      matchesExpected: expected
        ? JSON.stringify(outcome.models) === JSON.stringify(expected.models)
        : null,
    });
  }

  return results;
}

/**
 * CLI Handler for `sources onboard`
 */
async function runSourcesOnboardCli(args) {
  const target = args._[2];
  const isAll = Boolean(args.all || target === 'all' || target === '--all');
  const isRecord = Boolean(args.record);
  const isReplay = Boolean(args.replay) || (!isRecord && !isAll);
  const isJson = Boolean(args.json);

  // Load windows environment if available
  try {
    const winEnvLoader =
      'C:/Users/gumac/AI/shipde-platform/.worktrees/logs/hermes-brain/load-win-env';
    if (fs.existsSync(winEnvLoader + '.js')) {
      require(winEnvLoader).loadWindowsEnv(process.env);
    }
  } catch (_) {
    // ignore
  }
  if (!process.env.NINEROUTER_API_KEY) {
    try {
      const probeSh = 'C:/Users/gumac/AI/shipde-platform/.worktrees/logs/probe-models.sh';
      if (fs.existsSync(probeSh)) {
        const m = fs.readFileSync(probeSh, 'utf8').match(/NINEROUTER_API_KEY:-([^}\r\n]+)/);
        if (m) process.env.NINEROUTER_API_KEY = m[1].trim();
      }
    } catch (_) {}
  }

  if (isAll) {
    const allResults = await replayAllSources({
      replay: true,
    });

    if (isJson) {
      console.log(JSON.stringify(allResults, null, 2));
      return 0;
    }

    console.log('');
    console.log('='.repeat(80));
    console.log('  BẢNG TỔNG NGUỒN ĐÃ GẮN (SOURCES REPLAY)');
    console.log('='.repeat(80));
    console.log(
      'Nguồn'.padEnd(16) + '| Sống/Tổng'.padEnd(14) + '| Lý do chết'.padEnd(30) + '| Xếp hạng'
    );
    console.log('-'.repeat(80));

    for (const r of allResults) {
      const oc = r.outcome;
      const liveCount = oc.step3_probe ? oc.step3_probe.live : 0;
      const totalCount = oc.step3_probe ? oc.step3_probe.probed : 0;
      const deadCauses =
        Object.values(oc.models || {})
          .filter((m) => !m.live && m.cause)
          .map((m) => m.cause)
          .filter((v, i, a) => a.indexOf(v) === i)
          .join(', ') || 'Không';
      const inRankCount = Object.values(oc.models || {}).filter((m) => m.inRanking).length;
      const rankStatus = inRankCount > 0 ? `CÓ (${inRankCount} model)` : 'KHÔNG';

      console.log(
        r.sourceId.padEnd(16) +
          `| ${liveCount}/${totalCount}`.padEnd(14) +
          `| ${deadCauses.slice(0, 28)}`.padEnd(30) +
          `| ${rankStatus}`
      );
    }
    console.log('='.repeat(80));
    console.log('');
    return 0;
  }

  if (!target) {
    console.error(
      'Dùng: sources onboard <sourceId> [--record|--replay] [--json] | sources onboard --all --replay'
    );
    return 2;
  }

  try {
    const outcome = await onboardSource(target, {
      record: isRecord,
      replay: isReplay,
      env: process.env,
    });

    if (isJson) {
      console.log(JSON.stringify(outcome, null, 2));
      return 0;
    }

    console.log('');
    console.log('='.repeat(70));
    console.log(`  ONBOARDING NGUỒN: ${outcome.sourceId} (${isRecord ? 'RECORD LIVE' : 'REPLAY'})`);
    console.log('='.repeat(70));

    // Step 1
    console.log('\n[Bước 1: Gắn]');
    console.log(`  Endpoint      : ${outcome.step1_attach.endpoint}`);
    console.log(
      `  Credential Var: ${outcome.step1_attach.envVar} (có trong env: ${outcome.step1_attach.keyPresent})`
    );
    console.log(`  Harness       : ${outcome.step1_attach.harness}`);

    // Step 2
    console.log('\n[Bước 2: Danh sách model]');
    console.log(`  Tổng số model : ${outcome.step2_models.total}`);
    if (!outcome.step2_models.ok) {
      console.log(`  Lỗi           : ${outcome.step2_models.reason}`);
    }

    // Step 3
    console.log('\n[Bước 3: Gọi thử]');
    console.log(
      `  Số model probe: ${outcome.step3_probe.probed} (Sống: ${outcome.step3_probe.live}, Lỗi: ${outcome.step3_probe.failed})`
    );

    // Step 4 & 6 detail per model
    console.log('\n[Bước 4-6: Chi tiết model, chấm điểm & Controller]');
    console.log(
      '  ' +
        'Model ID'.padEnd(30) +
        'Status'.padEnd(10) +
        'Score'.padEnd(10) +
        'Ranking'.padEnd(12) +
        'Lý do / Lớp loại'
    );
    console.log('  ' + '-'.repeat(75));

    for (const [mId, mData] of Object.entries(outcome.models)) {
      const statusStr = mData.live ? '200 OK' : `${mData.httpStatus || 'ERR'}`;
      const scoreStr = mData.score !== null ? String(mData.score) : 'UNKNOWN';
      const rankStr = mData.inRanking ? 'CÓ' : 'KHÔNG';
      const reasonStr = mData.inRanking
        ? 'Vào bảng xếp hạng'
        : mData.filterLayer
          ? `[${mData.filterLayer}] ${mData.filterReason}`
          : mData.cause || 'Không sống';

      console.log(
        '  ' +
          mId.padEnd(30) +
          statusStr.padEnd(10) +
          scoreStr.padEnd(10) +
          rankStr.padEnd(12) +
          reasonStr
      );
    }

    console.log('\n' + '='.repeat(70));
    console.log('Hoàn thành 6 bước onboarding cho ' + outcome.sourceId);
    console.log('='.repeat(70) + '\n');
    return 0;
  } catch (err) {
    console.error(`Lỗi onboarding nguồn "${target}":`, err.message);
    return 1;
  }
}

module.exports = {
  onboardSource,
  replayAllSources,
  runSourcesOnboardCli,
  sanitizeText,
  sanitizeFixtureData,
  verifyFixtureSanitization,
  step4ScoreModels,
  step6ControllerVisibility,
  DEFAULT_FIXTURES_DIR,
};
