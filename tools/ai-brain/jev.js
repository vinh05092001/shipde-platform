'use strict';

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

const DEFAULT_HTTP_TIMEOUT_MS = 30000;

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
        // A fresh socket per request: the Controller blocks its event loop
        // during spawnSync worker runs, so a pooled keep-alive socket may have
        // been closed by the server and would fail with ECONNRESET.
        agent: false,
        timeout: (options && options.timeoutMs) || DEFAULT_HTTP_TIMEOUT_MS,
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

function normalizeAdvice(raw, key) {
  if (!raw || typeof raw !== 'object') return raw;
  if (raw.choice !== undefined || raw.confidence !== undefined) return raw;
  if (raw.answers && typeof raw.answers === 'object') {
    const answer = key
      ? raw.answers[key]
      : raw.answers.weightProfile ||
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

function questionKey(question) {
  if (question && question.key) return question.key;
  if (question && question.kind === 'select-combo-member') return 'comboMember';
  if (question && question.kind === 'select-eligible-model') return 'eligibleModel';
  return 'weightProfile';
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
    const providedCriteria =
      question.criteria &&
      typeof question.criteria === 'object' &&
      !Array.isArray(question.criteria)
        ? question.criteria
        : null;
    for (const option of question.options || []) {
      const value = String(option);
      const custom =
        providedCriteria && Object.prototype.hasOwnProperty.call(providedCriteria, value)
          ? providedCriteria[value]
          : null;
      criteria[value] =
        typeof custom === 'string' && custom.trim()
          ? custom.trim()
          : 'Choose ' + value + ' when it best fits the supplied state.';
    }
    const key = questionKey(question);
    const questions = {
      [key]: {
        type: 'choice',
        instructions: question.prompt,
        criteria,
      },
    };
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
    return normalizeAdvice(raw, key);
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
  question = question || {};
  const opts = options || {};
  const started = Date.now();
  let called = false;
  let observed;
  const result = await evaluateAdvice(question, {
    ...opts,
    ask:
      typeof opts.ask === 'function'
        ? async (q) => {
            called = true;
            observed = await opts.ask(q);
            return observed;
          }
        : undefined,
  });
  const usage = Object.fromEntries(
    Object.entries(observed?.usage || {}).filter(
      ([key, value]) =>
        /^(input|output|total|prompt|completion|cache_read|cache_write)_tokens$/.test(key) &&
        typeof value === 'number' &&
        Number.isFinite(value) &&
        value >= 0
    )
  );
  const turn = {
    called,
    callReason: called ? 'CLOSED_QUESTION' : result.reason,
    questionKind: question.kind || 'advisory',
    questionKey: questionKey(question),
    questionType: 'choice',
    outcome: result.outcome,
    reason: result.outcome === Outcome.DECIDED ? 'VALID_ADVICE' : result.reason,
    confidence:
      typeof observed?.confidence === 'number' && Number.isFinite(observed.confidence)
        ? observed.confidence
        : null,
    latencyMs: Date.now() - started,
    usage: Object.keys(usage).length ? usage : null,
  };
  if (typeof opts.recordTurn === 'function') opts.recordTurn(turn);
  return { ...result, turn };
}

async function evaluateAdvice(question, options) {
  if (/^[A-Z][A-Z0-9_]*$/.test(question.skipReason || '')) return undecided(question.skipReason);
  const invalid = validateClosedQuestion(question);
  if (invalid) return undecided(invalid);

  const opts = options || {};
  const minConfidence =
    opts.minConfidence != null && Number.isFinite(Number(opts.minConfidence))
      ? Number(opts.minConfidence)
      : DEFAULT_MIN_CONFIDENCE;
  const ask = opts.ask;
  if (typeof ask !== 'function') return undecided('UNREACHABLE');

  let raw;
  try {
    const askPayload = {
      kind: question.kind || 'advisory',
      key: questionKey(question),
      prompt: String(question.prompt || ''),
      evidence: String(question.evidence),
      options: question.options.slice(),
      state: question.state,
    };
    if (
      question.criteria &&
      typeof question.criteria === 'object' &&
      !Array.isArray(question.criteria)
    ) {
      const sanitized = {};
      for (const option of question.options) {
        const value = String(option);
        if (
          Object.prototype.hasOwnProperty.call(question.criteria, value) &&
          typeof question.criteria[value] === 'string' &&
          question.criteria[value].trim()
        ) {
          sanitized[value] = question.criteria[value].trim();
        }
      }
      if (Object.keys(sanitized).length > 0) askPayload.criteria = sanitized;
    }
    raw = await ask(askPayload);
  } catch (err) {
    return undecided(failureReason(err));
  }

  if (!raw || typeof raw !== 'object') return undecided('MALFORMED_OUTPUT');
  if (advisoryNamesIdentity(raw)) return undecided('IDENTITY_PROHIBITED');
  const choice = raw.choice === undefined ? null : String(raw.choice);
  const confidence = Number(raw.confidence);
  if (!question.options.includes(choice)) return undecided('MALFORMED_OUTPUT');
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return undecided('MALFORMED_OUTPUT');
  }
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

module.exports = {
  DEFAULT_HTTP_TIMEOUT_MS,
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
  normalizeAdvice,
};
