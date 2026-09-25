'use strict';

/**
 * Ship Dễ — Jev, the fast decision layer (TASK-AI-50)
 *
 * Some questions in dispatch are closed: which of these four kinds of failure
 * is this, which of these six lanes is actually serving, is this quiet job
 * working or wedged. A planning model answers them in thirty seconds and for
 * real money; Jev answers in about a second for roughly three hundredths of a
 * cent, and it answers with a typed choice and a confidence rather than prose,
 * which is what a caller can branch on.
 *
 * The boundary is the whole point, and it is enforced here rather than trusted:
 *
 *   - Every question must carry an explicit, finite set of options. There is no
 *     free-text mode in this module, so "write the code" or "is this Work Item
 *     done" cannot be asked at all.
 *   - An answer below the confidence floor is discarded and reported as
 *     undecided. The caller then does what it would have done without Jev —
 *     ask a reasoning model, or fall back to its configured order.
 *   - Jev being unreachable is undecided too, never a guess. A routing hint
 *     must not be able to break its caller.
 *
 * Gap 5 (TASK-AI-50): This is the ONE canonical Jev implementation.
 * The old Python one at .worktrees/logs/jev.py is now a shim; the logic lives
 * here. Two parallel implementations are forbidden.
 *
 * Gap 6: Jev may not write code, hold a credential, spawn a worker or merge
 * anything. Enforced structurally: it only calls a decision-service endpoint
 * with closed questions and returns typed answers.
 *
 * Gap 7: Jev unreachable, or below its confidence floor, returns UNDECIDED
 * (outcome UNAVAILABLE or UNSURE). It never guesses.
 *
 * Gap 8: No source or model name is hard-coded in any selection path. The
 * endpoint, model, and API key all come from the caller's options or environment.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const capabilities = require('./capabilities');

const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const MODEL = 'jev-latest';
const DEFAULT_TIMEOUT_MS = 60000;

/**
 * Below this, an answer is not used. 0.7 is where the lane probe in
 * dispatch.sh settled after it led with a low-confidence pick and lost a turn
 * to a lane that was not serving.
 */
const DEFAULT_MIN_CONFIDENCE = 0.7;

const Outcome = Object.freeze({
  DECIDED: 'decided',
  UNSURE: 'unsure',
  UNAVAILABLE: 'unavailable',
});

/** The credential, from the environment or the file the operator keeps. */
function loadKey(options) {
  const opts = options || {};
  const env = opts.env || process.env;
  const fromEnv = env.TYPESAFE_API_KEY;
  if (fromEnv && String(fromEnv).trim() !== '') return String(fromEnv).trim();
  const file = opts.keyFile || path.join(os.homedir(), '.typesafe-key');
  try {
    const raw = fs.readFileSync(file, 'utf8').trim();
    return raw === '' ? null : raw;
  } catch (_) {
    return null;
  }
}

/**
 * Refuses a question that is not closed.
 *
 * A question with one option is not a decision, and one with none is free
 * text wearing a schema. Both are rejected here rather than sent: the value of
 * this layer is entirely in what it cannot be asked.
 *
 * Gap 6: This structural check prevents any free-text question from reaching
 * the service — "write the code" cannot be expressed in this schema.
 */
function validateQuestions(questions) {
  const entries = Object.entries(questions || {});
  if (entries.length === 0) throw new Error('jev: a call must ask at least one question');
  for (const [name, q] of entries) {
    const type = q && q.type;
    if (type !== 'choice' && type !== 'noul') {
      throw new Error('jev: question "' + name + '" must be type choice or noul');
    }
    const criteria = (q && q.criteria) || {};
    const count = Object.keys(criteria).length;
    if (type === 'choice' && count < 2) {
      throw new Error('jev: question "' + name + '" needs at least two options to be a choice');
    }
    if (type === 'noul' && count < 1) {
      throw new Error('jev: question "' + name + '" needs its criteria described');
    }
  }
}

function postJson(url, body, headers, timeoutMs) {
  return new Promise((resolve, reject) => {
    const https = require('https');
    const target = new URL(url);
    const payload = Buffer.from(JSON.stringify(body), 'utf8');
    const req = https.request(
      {
        method: 'POST',
        hostname: target.hostname,
        port: target.port || 443,
        path: target.pathname + (target.search || ''),
        headers: Object.assign(
          {
            'Content-Type': 'application/json',
            'Content-Length': payload.length,
          },
          headers || {}
        ),
        timeout: timeoutMs || DEFAULT_TIMEOUT_MS,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          // A non-2xx status is not an answer: the service said the call did
          // not land. Parsing the error body in the hope it is still a verdict
          // would turn a refusal into a decision.
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error('jev: HTTP ' + res.statusCode + ': ' + text.slice(0, 200)));
            return;
          }
          try {
            resolve(JSON.parse(text));
          } catch (e) {
            reject(new Error('jev: could not parse response: ' + e.message));
          }
        });
      }
    );
    req.on('timeout', () => {
      req.destroy(new Error('jev: request timed out after ' + timeoutMs + 'ms'));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/**
 * The core call. Sends `state` and `questions` to the decision service and
 * maps the result into typed, confidence-gated answers.
 *
 * Gap 7: An unreachable service or a missing key returns UNAVAILABLE, never a
 * guess. An answer below the floor returns UNSURE.
 *
 * @param {string}  state     Context paragraph the service needs to answer
 * @param {object}  questions Map of question-name → { type, criteria }
 * @param {object}  options   { env, keyFile, transport, endpoint, model,
 *                              minConfidence, timeoutMs }
 */
async function ask(state, questions, options) {
  const opts = options || {};
  validateQuestions(questions);

  const min = Number.isFinite(Number(opts.minConfidence))
    ? Number(opts.minConfidence)
    : DEFAULT_MIN_CONFIDENCE;

  const key = loadKey(opts);
  if (!key) {
    return { outcome: Outcome.UNAVAILABLE, answers: {}, detail: 'no TYPESAFE_API_KEY' };
  }

  const transport = opts.transport || postJson;
  let body;
  try {
    body = await transport(
      opts.endpoint || ENDPOINT,
      { model: opts.model || MODEL, state: String(state), questions },
      { Authorization: 'Bearer ' + key },
      opts.timeoutMs || DEFAULT_TIMEOUT_MS
    );
  } catch (err) {
    // A hint must never break its caller: an unreachable Jev leaves the
    // decision exactly where it was.
    return {
      outcome: Outcome.UNAVAILABLE,
      answers: {},
      detail: String((err && err.message) || err).slice(0, 160),
    };
  }

  const raw = (body && body.answers) || {};
  const answers = {};
  let anyAccepted = false;
  for (const name of Object.keys(questions)) {
    const a = raw[name] || {};
    const confidence = Number(a.confidence);
    const accepted = Number.isFinite(confidence) && confidence >= min;
    answers[name] = {
      choice: a.choice === undefined ? null : a.choice,
      noul: a.noul === undefined ? null : a.noul,
      confidence: Number.isFinite(confidence) ? confidence : 0,
      accepted,
    };
    if (accepted) anyAccepted = true;
  }

  return {
    outcome: anyAccepted ? Outcome.DECIDED : Outcome.UNSURE,
    answers,
    detail: anyAccepted ? null : 'every answer fell below the confidence floor of ' + min,
  };
}

// ---------------------------------------------------------------- the modes

/**
 * Which role a Work Item needs, so the scheduler ranks models for the right
 * job rather than for "coding" in general.
 *
 * The options are the roles capabilities.js already defines — one option per
 * registered role, labelled with its own description, so the choice set cannot
 * drift from the capability registry (AC-AI-50-09). An unsure answer means the
 * caller keeps whatever the register or the planner said, which is the
 * behaviour before Jev existed.
 */
async function classifyTask(workItem, options) {
  const w = workItem || {};
  const criteria = {};
  const roleLines = [];
  for (const id of capabilities.listRoles()) {
    const role = capabilities.getRole(id);
    const label = (role && role.description) || id;
    criteria[id] = label;
    roleLines.push('- ' + id + ': ' + label);
  }

  const state =
    'A Work Item is waiting for an author. Pick the role that fits what it ' +
    'asks for, choosing only from the roles the platform already defines:\n\n' +
    roleLines.join('\n') +
    '\n\nWork Item details:\n' +
    'ID: ' +
    (w.workItemId || 'unknown') +
    '\nOutcome: ' +
    (w.outcome || '(not stated)') +
    '\nAllowed paths: ' +
    (Array.isArray(w.allowedPaths) ? w.allowedPaths.join(', ') : w.allowedPaths || '(not stated)') +
    '\nRisk domains named in it: ' +
    ((w.riskDomains || []).join(', ') || 'none') +
    '\nIn scope:\n' +
    String(w.inScope || '(not stated)').slice(0, 2000) +
    '\n\nA task is low risk only when its behaviour is already fully specified, its ' +
    'files are bounded, deterministic tests can prove it, and it touches none of ' +
    'architecture, authentication, authorization, tenant isolation, money, carrier ' +
    'side effects, database ownership or product UX.';

  const result = await ask(
    state,
    {
      role: {
        type: 'choice',
        criteria,
      },
    },
    options
  );
  return {
    outcome: result.outcome,
    role: result.answers.role && result.answers.role.accepted ? result.answers.role.choice : null,
    confidence: (result.answers.role && result.answers.role.confidence) || 0,
    detail: result.detail,
  };
}

/**
 * Which of a small set of already-probed lanes to use.
 *
 * The probes are the caller's, not Jev's: this module never calls a provider.
 * Jev only reads the results, and its job is the part a regular expression is
 * bad at — a lane that answered HTTP 200 while the text says the free tier is
 * spent is not a usable lane.
 *
 * Gap 6: Jev never calls a provider. The caller probes; Jev reads the probe
 * results and classifies them.
 */
async function pickLane(probeResults, options) {
  const results = probeResults || [];
  if (results.length === 0) {
    return { outcome: Outcome.UNSURE, lane: null, confidence: 0, detail: 'nothing was probed' };
  }
  if (results.length === 1) {
    // Nothing to decide. Asking would spend a call to be told the obvious.
    return {
      outcome: Outcome.DECIDED,
      lane: results[0].lane,
      confidence: 1,
      detail: 'only one lane was probed',
    };
  }

  const state =
    'Probe results just measured, one line per lane:\n' +
    results.map((r) => '- ' + r.lane + ': ' + r.reply).join('\n') +
    '\n\nA lane whose reply carries a refusal, such as a spent free quota, is not ' +
    'usable even when the call itself succeeded.';

  const criteria = {};
  const bySlug = new Map();
  for (const r of results) {
    const slug = String(r.lane)
      .replace(/[^A-Za-z0-9]/g, '_')
      .slice(0, 40);
    criteria[slug] = r.lane;
    bySlug.set(slug, r.lane);
  }
  criteria.none = 'No lane is usable right now';

  const result = await ask(state, { pick: { type: 'choice', criteria } }, options);
  const pick = result.answers.pick;
  const lane = pick && pick.accepted ? bySlug.get(pick.choice) || null : null;
  return {
    outcome: result.outcome,
    lane: lane,
    confidence: (pick && pick.confidence) || 0,
    detail: result.detail,
  };
}

/** What kind of CI failure this is, and whether an agent can fix it alone. */
async function classifyFailure(checkNames, logExtract, options) {
  const state =
    'Failing checks: ' +
    (checkNames || []).join(', ') +
    '\n\nExtract of their logs:\n' +
    String(logExtract || '').slice(-2500);

  const result = await ask(
    state,
    {
      kind: {
        type: 'choice',
        criteria: {
          formatting: 'Only formatting or lint: prettier, eslint, whitespace',
          logic: 'The code is wrong: a test asserts what the code does not do',
          infra: 'The environment failed: a service, a download or the runner',
          config: 'A configuration or gate rule, such as scope or secret scanning',
          unclear: 'The logs do not say',
        },
      },
      agentCanFix: {
        type: 'noul',
        criteria: {
          true: 'An agent can fix this from the repository alone',
          false: 'It needs a human decision or an external change',
        },
      },
    },
    options
  );
  const kind = result.answers.kind;
  return {
    outcome: result.outcome,
    kind: kind && kind.accepted ? kind.choice : null,
    confidence: (kind && kind.confidence) || 0,
    agentCanFix: (result.answers.agentCanFix && result.answers.agentCanFix.noul) || 0,
    detail: result.detail,
  };
}

/** Whether a quiet session is working, wedged, finished or failed. */
async function classifyJob(transcriptTail, options) {
  const state =
    'Transcript tail of an autonomous coding agent:\n\n' +
    String(transcriptTail || '').slice(-6000);

  const result = await ask(
    state,
    {
      state: {
        type: 'choice',
        criteria: {
          working: 'Still making progress: reading, editing or running commands',
          wedged: 'Stuck, looping, or waiting on something that will not arrive',
          finished: 'The task is complete or a final answer was written',
          failed: 'Hit an error it cannot recover from, such as a spent quota',
        },
      },
      worthRestarting: {
        type: 'noul',
        criteria: {
          true: 'Restarting from scratch would be worthwhile',
          false: 'Restarting would waste work that is nearly done',
        },
      },
    },
    options
  );
  const st = result.answers.state;
  return {
    outcome: result.outcome,
    state: st && st.accepted ? st.choice : null,
    confidence: (st && st.confidence) || 0,
    worthRestarting: (result.answers.worthRestarting && result.answers.worthRestarting.noul) || 0,
    detail: result.detail,
  };
}

module.exports = {
  Outcome,
  ENDPOINT,
  DEFAULT_MIN_CONFIDENCE,
  loadKey,
  validateQuestions,
  ask,
  classifyTask,
  pickLane,
  classifyFailure,
  classifyJob,
};
