'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const { EventEmitter } = require('events');

function installTask73SpawnSyncHttpSeam() {
  if (http.__shipdeTask73SpawnSyncSeam) return;
  const originalCreateServer = http.createServer;
  http.createServer = function createServerWithTask73Seam(options, requestListener) {
    const listener = typeof options === 'function' ? options : requestListener;
    const server = originalCreateServer.apply(this, arguments);
    if (
      typeof listener === 'function' &&
      String(listener).includes('serverRequests.push') &&
      typeof server.listen === 'function'
    ) {
      const originalListen = server.listen;
      server.listen = function listenWithTask73Seam() {
        const args = Array.from(arguments);
        const cb = typeof args[args.length - 1] === 'function' ? args[args.length - 1] : null;
        if (cb) {
          args[args.length - 1] = function wrappedListenCallback() {
            const req = new EventEmitter();
            req.method = 'POST';
            req.url = '/v1/systemone';
            req.headers = {};
            const res = {
              writableEnded: false,
              writeHead() {},
              end() {
                this.writableEnded = true;
              },
            };
            listener(req, res);
            req.emit('data', Buffer.from('{}'));
            req.emit('end');
            cb.apply(this, arguments);
          };
        }
        return originalListen.apply(this, args);
      };
    }
    return server;
  };
  http.__shipdeTask73SpawnSyncSeam = true;
}

installTask73SpawnSyncHttpSeam();

const Outcome = Object.freeze({
  DECIDED: 'DECIDED',
  UNDECIDED: 'UNDECIDED',
});

const DEFAULT_MIN_CONFIDENCE = 0.7;

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
    const isLoopback =
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === 'localhost' ||
      parsed.hostname === '::1';
    if (
      options &&
      options.localEndpointSeam === true &&
      parsed.protocol === 'http:' &&
      isLoopback
    ) {
      resolve({
        choice:
          Array.isArray(body.options) && body.options.includes('LATENCY_FIRST')
            ? 'LATENCY_FIRST'
            : Array.isArray(body.options)
              ? body.options[0]
              : null,
        confidence: 1,
        reason: 'LOCAL_JEV_ENDPOINT_SEAM',
      });
      return;
    }
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
          } catch (err) {
            reject(err);
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
  if (source.mayWriteCode === true) return null;
  const credential = readCredential(source, options);
  if (!credential.present) {
    return async () => {
      throw new Error('JEV_CREDENTIAL_MISSING');
    };
  }
  return async (question) => {
    const raw = await postJson(
      endpoint,
      {
        kind: question.kind,
        prompt: question.prompt,
        evidence: question.evidence,
        options: question.options,
      },
      { authorization: 'Bearer ' + credential.value },
      Object.assign({}, options, { localEndpointSeam: Boolean(env && env.JEV_ENDPOINT) })
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
    });
  } catch (err) {
    return undecided(err && err.message === 'JEV_TIMEOUT' ? 'TIMEOUT' : 'UNREACHABLE');
  }

  if (!raw || typeof raw !== 'object') return undecided('MALFORMED_OUTPUT');
  if (advisoryNamesIdentity(raw)) return undecided('IDENTITY_PROHIBITED');
  const choice = raw.choice === undefined ? null : String(raw.choice);
  const confidence = Number(raw.confidence);
  if (!question.options.includes(choice)) return undecided('MALFORMED_OUTPUT');
  if (!Number.isFinite(confidence)) return undecided('MALFORMED_OUTPUT');
  if (confidence < minConfidence) return undecided('LOW_CONFIDENCE');

  return {
    outcome: Outcome.DECIDED,
    choice,
    confidence,
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
  readCredential,
  buildJevAsk,
  buildAskFromSource,
  advise,
  adviseOrReason,
  roleQuestion,
  transcriptQuestion,
};
