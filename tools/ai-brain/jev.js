'use strict';

// API contract (HTTP 400 "Too many score levels. Must have at most 10 levels."), not a tuning value.
const JEV_MAX_SCORE_LEVELS = 10;

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');

const Outcome = Object.freeze({
  DECIDED: 'DECIDED',
  UNDECIDED: 'UNDECIDED',
});

const DEFAULT_MIN_CONFIDENCE = 0.7;

// Reasons that mean the advisory provider could not answer (as opposed to answering badly).
const PROVIDER_FAILURE_REASONS = Object.freeze([
  'UNREACHABLE',
  'TIMEOUT',
  'CREDENTIAL_MISSING',
  'INVALID_RESPONSE',
  'NETWORK_ERROR',
]);

/**
 * Name the real cause of a failed advisory call without echoing secrets or response bodies.
 * Returns CREDENTIAL_MISSING, TIMEOUT, HTTP_<status>, INVALID_RESPONSE, NETWORK_ERROR,
 * or UNREACHABLE when the error carries no recognisable cause.
 */
function failureReason(err) {
  const message = String((err && err.message) || '');
  if (message === 'JEV_CREDENTIAL_MISSING') return 'CREDENTIAL_MISSING';
  if (message === 'JEV_TIMEOUT' || (err && err.code === 'ETIMEDOUT')) return 'TIMEOUT';
  const status = /^JEV_HTTP_(\d{3})$/.exec(message);
  if (status) return 'HTTP_' + status[1];
  if (message === 'JEV_INVALID_RESPONSE' || (err && err.name === 'SyntaxError')) {
    return 'INVALID_RESPONSE';
  }
  // Socket-level failures carry a Node error code (ECONNREFUSED, ENOTFOUND, ECONNRESET...).
  if (err && typeof err.code === 'string' && err.code) return 'NETWORK_ERROR';
  return 'UNREACHABLE';
}

function isProviderFailure(reason) {
  const value = String(reason || '');
  return PROVIDER_FAILURE_REASONS.includes(value) || /^HTTP_\d{3}$/.test(value);
}

function undecided(reason) {
  return {
    outcome: Outcome.UNDECIDED,
    choice: null,
    confidence: 0,
    reason,
  };
}

function resolveStorePath(store, options) {
  if (!store || typeof store !== 'string') return null;
  const home = (options && options.home) || os.homedir();
  if (store.startsWith('~/')) return path.join(home, store.slice(2));
  if (store.startsWith('~\\')) return path.join(home, store.slice(2));
  return store;
}

function readCredential(source, options) {
  const cred = (source && source.credential) || {};
  const env = (options && options.env) || process.env;
  if (cred.env && env[cred.env] !== undefined && String(env[cred.env]).trim() !== '') {
    return { present: true, value: String(env[cred.env]).trim(), how: 'env ' + cred.env };
  }
  const storePath = resolveStorePath(cred.store, options);
  if (storePath) {
    try {
      const value = fs.readFileSync(storePath, 'utf8').trim();
      if (value) return { present: true, value, how: 'store ' + cred.store };
    } catch {}
  }
  return {
    present: false,
    value: null,
    how: cred.env ? 'env ' + cred.env + ' unset' : 'credential missing',
  };
}

function postJson(url, body, headers, options) {
  const client = options && options.httpClient;
  if (typeof client === 'function') return client(url, body, headers);

  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (err) {
      reject(err);
      return;
    }
    const payload = JSON.stringify(body);
    const transport = parsed.protocol === 'http:' ? http : https;
    const req = transport.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'POST',
        timeout: (options && options.timeoutMs) || 30000,
        headers: Object.assign(
          {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(payload),
          },
          headers || {}
        ),
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          text += chunk;
        });
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error('JEV_HTTP_' + res.statusCode));
            return;
          }
          try {
            resolve(JSON.parse(text));
          } catch {
            reject(new Error('JEV_INVALID_RESPONSE'));
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('JEV_TIMEOUT')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function normalizeAdvice(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  if (raw.choice !== undefined || raw.confidence !== undefined) return raw;
  if (raw.answers && typeof raw.answers === 'object') {
    const dimensions = ['qualityImportance', 'latencyImportance', 'costImportance'];
    const scores = {};
    for (const name of dimensions) {
      const answer = raw.answers[name];
      if (answer && answer.type === 'score') {
        scores[name] = {
          score: answer.score,
          distribution: answer.distribution || answer.probabilities,
          confidence: answer.confidence,
        };
      }
    }
    if (Object.keys(scores).length) {
      const legacy = raw.answers.weightProfile;
      return {
        scores,
        choice: legacy && legacy.choice,
        confidence: legacy && legacy.confidence,
        probabilities: legacy && legacy.probabilities,
        jevModel: raw.model || null,
        usage: raw.usage || null,
      };
    }
    const answer =
      raw.answers.weightProfile ||
      raw.answers.advisory ||
      raw.answers.choice ||
      raw.answers[Object.keys(raw.answers)[0]];
    if (answer && typeof answer === 'object' && answer.type === 'choice') {
      return {
        choice: answer.choice,
        confidence: answer.confidence,
        probabilities: answer.probabilities,
        jevModel: raw.model || null,
        usage: raw.usage || null,
      };
    }
  }
  const answer = raw.answer || raw.decision || raw.result || raw.data || null;
  if (answer && typeof answer === 'object') {
    return {
      choice:
        answer.choice !== undefined
          ? answer.choice
          : answer.option !== undefined
            ? answer.option
            : answer.value,
      confidence: answer.confidence,
      probabilities: answer.probabilities,
      reason: answer.reason || answer.rationale || raw.reason || null,
    };
  }
  return raw;
}

function advisoryNamesIdentity(raw) {
  if (!raw || typeof raw !== 'object') return false;
  const prohibited = [
    'model',
    'modelId',
    'provider',
    'account',
    'accountId',
    'gateway',
    'upstream',
    'candidate',
    'candidateKey',
  ];
  return prohibited.some((field) => raw[field] !== undefined && raw[field] !== null);
}

function buildJevAsk(source, options) {
  if (!source || source.kind !== 'decision-service') return null;
  const env = (options && options.env) || process.env;
  const endpoint = (env && env.JEV_ENDPOINT) || source.endpoint;
  if (!endpoint) return null;
  if (!source.model || typeof source.model !== 'string') return null;
  if (source.mayWriteCode === true) return null;
  const credential = readCredential(source, options);
  if (!credential.present) {
    return async () => {
      throw new Error('JEV_CREDENTIAL_MISSING');
    };
  }
  return async (question) => {
    const criteria = {};
    for (const option of question.options || []) {
      const value = String(option);
      criteria[value] = 'Choose ' + value + ' when it best fits the supplied state.';
    }
    const questionKey =
      question.kind === 'select-eligible-model' ? 'eligibleModel' : 'weightProfile';
    const questions = {
      [questionKey]: {
        type: 'choice',
        instructions: question.prompt,
        criteria,
      },
    };
    if (question.kind === 'assess-task-profile') {
      for (const dimension of question.scoreDimensions || []) {
        const name = dimension.name;
        const state = question.state || {};
        // The JEV API accepts at most JEV_MAX_SCORE_LEVELS levels; scores are only
        // used as ratios between dimensions, so the scale itself carries no meaning.
        const levels = Array.from({ length: JEV_MAX_SCORE_LEVELS }, (_, score) => {
          const third = JEV_MAX_SCORE_LEVELS / 3;
          const emphasis = score < third ? 'low' : score < 2 * third ? 'moderate' : 'high';
          return (
            score +
            ': ' +
            emphasis +
            ' priority for ' +
            name.replace('Importance', '') +
            ' given task class ' +
            String(state.taskClass || 'unknown') +
            ', difficulty ' +
            String(state.difficulty || 'unknown') +
            ', risks ' +
            ((state.riskDomains || []).join(', ') || 'none') +
            ', deadline priority ' +
            String(state.latencyPriority || 'normal') +
            ', deadline/expected duration ' +
            String(state.deadline || state.expectedDuration || 'unspecified') +
            ', budget ' +
            String(state.costCeiling === undefined ? 'unspecified' : state.costCeiling)
          );
        });
        // The API's ScoreQuestion takes the ordered rubric as `criteria` (index = score);
        // an unknown `levels` field leaves `criteria` missing and the API answers HTTP 422.
        questions[name] = { type: 'score', instructions: dimension.instructions, criteria: levels };
      }
    }
    const raw = await postJson(
      endpoint,
      {
        model: source.model,
        state: question.evidence,
        questions,
      },
      { authorization: 'Bearer ' + credential.value },
      options
    );
    return normalizeAdvice(raw);
  };
}

const buildAskFromSource = buildJevAsk;

function validateClosedQuestion(question) {
  const q = question || {};
  const options = Array.isArray(q.options) ? q.options : [];
  if (options.length < 2) return 'INSUFFICIENT_OPTIONS';
  const seen = new Set();
  for (const option of options) {
    const value = String(option || '').trim();
    if (!value || seen.has(value)) return 'MALFORMED_OPTIONS';
    seen.add(value);
  }
  if (!q.evidence || String(q.evidence).trim() === '') return 'INSUFFICIENT_EVIDENCE';
  return null;
}

async function advise(question, options) {
  const invalid = validateClosedQuestion(question);
  if (invalid) return undecided(invalid);

  const opts = options || {};
  const minConfidence = Number.isFinite(Number(opts.minConfidence))
    ? Number(opts.minConfidence)
    : DEFAULT_MIN_CONFIDENCE;
  const ask = opts.ask;
  if (typeof ask !== 'function') return undecided('UNREACHABLE');

  let raw;
  try {
    raw = await ask({
      kind: question.kind || 'advisory',
      prompt: String(question.prompt || ''),
      evidence: String(question.evidence),
      options: question.options.slice(),
      state: question.state,
      scoreDimensions: question.scoreDimensions,
    });
  } catch (err) {
    return undecided(failureReason(err));
  }

  if (!raw || typeof raw !== 'object') return undecided('MALFORMED_OUTPUT');
  if (advisoryNamesIdentity(raw)) return undecided('IDENTITY_PROHIBITED');
  if (raw.scores && typeof raw.scores === 'object') {
    const scoreNames = ['qualityImportance', 'latencyImportance', 'costImportance'];
    const scores = {};
    let confidentDimensions = 0;
    for (const name of scoreNames) {
      const item = raw.scores[name];
      const score = Number(item && item.score);
      const confidence = Number(item && item.confidence);
      if (!Number.isFinite(score) || score < 0 || score > 10 || !Number.isFinite(confidence)) {
        return Object.assign(undecided('MALFORMED_OUTPUT'), {
          choice: raw.choice || null,
          scores: Object.keys(scores).length ? scores : null,
        });
      }
      if (confidence >= minConfidence) confidentDimensions += 1;
      scores[name] = { score, confidence, distribution: item.distribution || null };
    }
    if (confidentDimensions === 0) {
      return Object.assign(undecided('LOW_CONFIDENCE'), {
        choice: raw.choice || null,
        confidence: Math.min(...scoreNames.map((name) => scores[name].confidence)),
        scores,
        jevModel: raw.jevModel || null,
        usage: raw.usage || null,
      });
    }
    return {
      outcome: Outcome.DECIDED,
      choice: raw.choice || null,
      confidence: Math.min(...scoreNames.map((name) => scores[name].confidence)),
      scores,
      jevModel: raw.jevModel || null,
      usage: raw.usage || null,
    };
  }
  const choice = raw.choice === undefined ? null : String(raw.choice);
  const confidence = Number(raw.confidence);
  if (!question.options.includes(choice)) return undecided('MALFORMED_OUTPUT');
  if (!Number.isFinite(confidence)) return undecided('MALFORMED_OUTPUT');
  if (confidence < minConfidence) return undecided('LOW_CONFIDENCE');

  return {
    outcome: Outcome.DECIDED,
    choice,
    confidence,
    probabilities:
      raw.probabilities && typeof raw.probabilities === 'object' ? raw.probabilities : undefined,
    jevModel: raw.jevModel || null,
    usage: raw.usage || null,
    reason: raw.reason || null,
  };
}

async function adviseOrReason(question, options) {
  const result = await advise(question, options);
  if (result.outcome !== Outcome.UNDECIDED) {
    return Object.assign({ handledBy: 'jev' }, result);
  }
  const controller = options && options.reasoningController;
  if (typeof controller !== 'function') {
    return Object.assign({ handledBy: 'none' }, result);
  }
  const fallback = await controller(question, result);
  return {
    outcome: fallback && fallback.outcome ? fallback.outcome : Outcome.DECIDED,
    choice: fallback && fallback.choice !== undefined ? fallback.choice : null,
    confidence: fallback && fallback.confidence !== undefined ? fallback.confidence : null,
    reason: fallback && fallback.reason ? fallback.reason : result.reason,
    handledBy: 'reasoning-controller',
    jev: result,
  };
}

function roleQuestion(workItem, roles) {
  const ids = Object.keys(roles || {});
  return {
    kind: 'classify-work-item-role',
    prompt: 'Pick the registered role for this Work Item.',
    evidence: JSON.stringify(workItem || {}),
    options: ids,
  };
}

function transcriptQuestion(transcript, states) {
  return {
    kind: 'classify-transcript',
    prompt: 'Classify this transcript state.',
    evidence: String(transcript || ''),
    options: states || ['RUNNING_WITH_PROGRESS', 'STALLED', 'FAILED', 'COMPLETED'],
  };
}

module.exports = {
  Outcome,
  DEFAULT_MIN_CONFIDENCE,
  PROVIDER_FAILURE_REASONS,
  failureReason,
  isProviderFailure,
  readCredential,
  buildJevAsk,
  buildAskFromSource,
  advise,
  adviseOrReason,
  roleQuestion,
  transcriptQuestion,
  normalizeAdvice,
};
