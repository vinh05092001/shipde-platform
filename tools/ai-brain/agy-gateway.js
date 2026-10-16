'use strict';

/**
 * OpenAI-compatible HTTP gateway over the agy pool (TASK-AI-142).
 *
 * Hermes speaks POST /v1/chat/completions. Each request runs ONE agy job on a
 * free account that still has quota for the model family. agy cannot run
 * Hermes' tools, so tool calls are emulated: the model is told to answer with a
 * JSON object and the gateway turns that into OpenAI tool_calls.
 * Binds to 127.0.0.1 only and needs AGY_GATEWAY_TOKEN.
 */

const http = require('http');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { familyOf } = require('./agy-quota');

const DEFAULT_PORT = 20140;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_TIMEOUT_MS = 300000;
const MAX_BODY_BYTES = 8 * 1024 * 1024;

function realPool(options) {
  const rt = require('./agy-pool-runtime');
  return {
    accounts: () => rt.discoverAccounts(options),
    models: () => rt.discoverPoolModels(options),
    quota: (id) => rt.quotaReading(id, options),
    readOut: (id) => rt.readOutText(id, options),
    // submitJob blocks, so it runs in a child process to keep the server live.
    submit: (id, job, opts) =>
      new Promise((resolve) => {
        const code =
          "const rt=require('./agy-pool-runtime');const a=JSON.parse(process.argv[1]);" +
          'process.stdout.write(JSON.stringify(rt.submitJob(a.id,a.job,a.opts)))';
        const child = spawn(
          process.execPath,
          ['-e', code, JSON.stringify({ id, job, opts: { ...options, ...opts } })],
          { cwd: __dirname, windowsHide: true }
        );
        let out = '';
        child.stdout.on('data', (d) => (out += d));
        child.on('error', (e) => resolve({ state: 'error', reason: String(e.message) }));
        child.on('close', () => {
          try {
            resolve(JSON.parse(out));
          } catch {
            resolve({ state: 'error', reason: 'CORRUPT_RESULT' });
          }
        });
      }),
  };
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content))
    return content.map((p) => (p && typeof p.text === 'string' ? p.text : '')).join('');
  return content == null ? '' : JSON.stringify(content);
}

function toolList(tools) {
  return (tools || []).map((t) => (t && t.function ? t.function : null)).filter((f) => f && f.name);
}

function buildPrompt(messages, tools) {
  const parts = [
    'You are a read-only reasoning engine. Do NOT use any of your own tools, do NOT edit or create files, do NOT run commands. Answer only from the conversation below.',
  ];
  for (const m of messages || []) {
    const role = String(m.role || 'user');
    if (role === 'tool') {
      parts.push(`=== TOOL RESULT (call ${m.tool_call_id || '?'}) ===\n${textOf(m.content)}`);
    } else if (role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) {
      const calls = m.tool_calls.map((c) => ({
        name: c.function && c.function.name,
        arguments: c.function && c.function.arguments,
      }));
      parts.push(
        `=== ASSISTANT ===\n${textOf(m.content)}\n[tool_calls issued: ${JSON.stringify(calls)}]`
      );
    } else {
      parts.push(`=== ${role.toUpperCase()} ===\n${textOf(m.content)}`);
    }
  }
  const fns = toolList(tools);
  if (fns.length) {
    parts.push(
      '=== AVAILABLE TOOLS ===\n' +
        fns
          .map((f) =>
            JSON.stringify({ name: f.name, description: f.description, parameters: f.parameters })
          )
          .join('\n') +
        '\n=== OUTPUT FORMAT ===\nAnswer with ONLY one JSON object and nothing else: either {"content":"<text>"} to reply, or {"tool_calls":[{"name":"<tool name>","arguments":{...}}]} to call tools. Use only the tool names listed above.'
    );
  }
  return parts.join('\n\n');
}

function extractJson(text) {
  const s = String(text || '').trim();
  const candidates = [s];
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) candidates.push(fence[1].trim());
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a >= 0 && b > a) candidates.push(s.slice(a, b + 1));
  for (const c of candidates) {
    try {
      const v = JSON.parse(c);
      if (v && typeof v === 'object' && !Array.isArray(v)) return v;
    } catch {}
  }
  return null;
}

function interpret(text, tools) {
  const names = new Set(toolList(tools).map((f) => f.name));
  if (names.size) {
    const obj = extractJson(text);
    if (obj && Array.isArray(obj.tool_calls)) {
      const valid = obj.tool_calls.filter((c) => c && names.has(c.name));
      if (valid.length)
        return {
          tool_calls: valid.map((c) => ({
            id: 'call_' + crypto.randomBytes(8).toString('hex'),
            type: 'function',
            function: {
              name: c.name,
              arguments:
                typeof c.arguments === 'string' ? c.arguments : JSON.stringify(c.arguments || {}),
            },
          })),
        };
    }
    if (obj && typeof obj.content === 'string') return { content: obj.content };
  }
  return { content: String(text || '').trim() };
}

function errorBody(status, type, message) {
  return { status, body: { error: { message, type, code: type } } };
}

function mapPoolFailure(result) {
  const reason = String((result && result.reason) || '');
  const state = result && result.state;
  if (state === 'quota')
    return errorBody(429, 'quota_exceeded', `agy pool quota: ${reason || 'exhausted'}`);
  if (state === 'login-required')
    return errorBody(401, 'login_required', 'agy account needs login');
  if (/TIMEOUT/.test(reason)) return errorBody(504, 'timeout', `agy pool timeout: ${reason}`);
  return errorBody(502, 'pool_error', `agy pool error: ${reason || state || 'unknown'}`);
}

function createGateway(opts) {
  const o = opts || {};
  const token = o.token;
  if (!token) throw new Error('AGY_GATEWAY_TOKEN is not set; refusing to start the agy gateway.');
  const pool = o.pool || realPool(o.poolOptions);
  const defaultTimeout = Number(o.timeoutMs) > 0 ? Number(o.timeoutMs) : DEFAULT_TIMEOUT_MS;
  const busy = new Set();
  const workDir = o.workDir || path.join(os.tmpdir(), 'agy-gateway');

  // Accounts with an unreadable quota are allowed but rank last, because the
  // pool's out.txt holds the latest job output rather than a quota table.
  function pickAccount(model) {
    const family = familyOf(model);
    let best = null;
    for (const id of pool.accounts()) {
      if (busy.has(id)) continue;
      let remaining = null;
      try {
        const q = pool.quota(id);
        if (q && q.available) {
          const rows = (q.rows || []).filter(
            (r) => (!family || r.family === family) && r.window === 'weekly'
          );
          const known = rows.filter((r) => r.known && Number.isFinite(r.remainingPercent));
          if (known.length) remaining = Math.min(...known.map((r) => r.remainingPercent));
        }
      } catch {}
      if (remaining !== null && remaining <= 0) continue;
      const score = remaining === null ? 0 : remaining;
      if (!best || score > best.score) best = { id, score };
    }
    if (best) busy.add(best.id);
    return best && best.id;
  }

  async function complete(req) {
    const model = req.model;
    if (!model || !Array.isArray(req.messages))
      return errorBody(400, 'invalid_request', 'model and messages are required');
    const account = pickAccount(model);
    if (!account) return errorBody(429, 'quota_exceeded', 'no agy account is free with quota left');
    try {
      const timeoutMs = Number(req.timeout_ms) > 0 ? Number(req.timeout_ms) : defaultTimeout;
      const job = {
        candidateKey: 'agy-gateway',
        harness: 'agy-pool',
        accountId: account,
        model,
        cwd: workDir,
        prompt: buildPrompt(req.messages, req.tools),
      };
      const result = await pool.submit(account, job, { timeoutMs });
      if (!result || result.state !== 'ok' || result.exitCode !== 0) return mapPoolFailure(result);
      const picked = interpret(pool.readOut(account), req.tools);
      const message = picked.tool_calls
        ? { role: 'assistant', content: null, tool_calls: picked.tool_calls }
        : { role: 'assistant', content: picked.content };
      const body = {
        id: 'chatcmpl-' + crypto.randomBytes(8).toString('hex'),
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{ index: 0, message, finish_reason: picked.tool_calls ? 'tool_calls' : 'stop' }],
      };
      if (result.usage && typeof result.usage === 'object') body.usage = result.usage;
      return { status: 200, body };
    } finally {
      busy.delete(account);
    }
  }

  function send(res, status, body) {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  function sendSse(res, body) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const choice = body.choices[0];
    const chunk = (delta, finish) => ({
      id: body.id,
      object: 'chat.completion.chunk',
      created: body.created,
      model: body.model,
      choices: [{ index: 0, delta, finish_reason: finish }],
    });
    const delta = { role: 'assistant' };
    if (choice.message.tool_calls)
      delta.tool_calls = choice.message.tool_calls.map((c, index) => ({ index, ...c }));
    else delta.content = choice.message.content;
    res.write(`data: ${JSON.stringify(chunk(delta, null))}\n\n`);
    res.write(`data: ${JSON.stringify(chunk({}, choice.finish_reason))}\n\n`);
    res.end('data: [DONE]\n\n');
  }

  const server = http.createServer((req, res) => {
    const given = Buffer.from(String(req.headers.authorization || ''));
    const want = Buffer.from(`Bearer ${token}`);
    if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) {
      const e = errorBody(401, 'invalid_api_key', 'missing or invalid bearer token');
      return send(res, e.status, e.body);
    }
    const url = String(req.url || '').split('?')[0];
    if (req.method === 'GET' && url === '/v1/models') {
      let ids = [];
      try {
        ids = pool.models() || [];
      } catch {}
      return send(res, 200, {
        object: 'list',
        data: ids.map((id) => ({ id, object: 'model', owned_by: 'agy-pool' })),
      });
    }
    if (req.method === 'POST' && url === '/v1/chat/completions') {
      let size = 0;
      const chunks = [];
      req.on('data', (d) => {
        size += d.length;
        if (size > MAX_BODY_BYTES) req.destroy();
        else chunks.push(d);
      });
      req.on('end', async () => {
        let payload;
        try {
          payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          const e = errorBody(400, 'invalid_request', 'body is not valid JSON');
          return send(res, e.status, e.body);
        }
        try {
          const r = await complete(payload || {});
          if (r.status === 200 && payload.stream) return sendSse(res, r.body);
          return send(res, r.status, r.body);
        } catch (err) {
          const e = errorBody(500, 'internal_error', String((err && err.message) || err));
          return send(res, e.status, e.body);
        }
      });
      return undefined;
    }
    const e = errorBody(404, 'not_found', 'unknown route');
    return send(res, e.status, e.body);
  });
  return { server, complete };
}

function start(opts) {
  try {
    return startUnsafe(opts);
  } catch (err) {
    return Promise.reject(err);
  }
}

function startUnsafe(opts) {
  const o = opts || {};
  const gw = createGateway({
    ...o,
    token: o.token === undefined ? process.env.AGY_GATEWAY_TOKEN : o.token,
  });
  const port = o.port === undefined ? Number(process.env.AGY_GATEWAY_PORT) || DEFAULT_PORT : o.port;
  return new Promise((resolve, reject) => {
    gw.server.once('error', reject);
    gw.server.listen(port, DEFAULT_HOST, () => resolve(gw.server));
  });
}

module.exports = {
  createGateway,
  start,
  buildPrompt,
  interpret,
  DEFAULT_PORT,
  DEFAULT_HOST,
  DEFAULT_TIMEOUT_MS,
};

if (require.main === module) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--port');
  start({ port: i >= 0 ? Number(argv[i + 1]) : undefined }).then(
    (s) => console.log(`agy-gateway listening on http://${DEFAULT_HOST}:${s.address().port}/v1`),
    (e) => {
      console.error(e.message);
      process.exit(1);
    }
  );
}
