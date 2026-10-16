'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const { createGateway } = require('../agy-gateway');

const TOKEN = 'test-token';
const ROW = (pct) => ({
  available: true,
  rows: [{ family: 'gemini', window: 'weekly', remainingPercent: pct, known: true }],
});

function fakePool(spec) {
  const s = spec || {};
  const outs = {};
  const used = [];
  return {
    used,
    accounts: () => s.accounts || ['agy01', 'agy02'],
    models: () => ['gemini-x', 'gemini-y'],
    quota: (id) => (s.quota && s.quota[id]) || ROW(50),
    readOut: (id) => outs[id] || '',
    submit: async (id, job) => {
      used.push(id);
      await new Promise((r) => setTimeout(r, s.delayMs || 0));
      outs[id] = typeof s.out === 'function' ? s.out(job) : s.out || 'hello';
      return s.result || { state: 'ok', exitCode: 0 };
    },
  };
}

async function withGateway(pool, fn) {
  const gw = createGateway({ token: TOKEN, pool });
  await new Promise((r) => gw.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${gw.server.address().port}`;
  try {
    await fn(base);
  } finally {
    gw.server.close();
  }
}

const call = (base, body, token) =>
  fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token === undefined ? TOKEN : token}` },
    body: JSON.stringify(body),
  });
const chat = { model: 'gemini-x', messages: [{ role: 'user', content: 'hi' }] };

describe('agy gateway', () => {
  test('refuses to start without a token', () => {
    assert.throws(() => createGateway({ pool: fakePool() }), /AGY_GATEWAY_TOKEN/);
  });

  test('lists the pool models', () =>
    withGateway(fakePool(), async (base) => {
      const r = await fetch(`${base}/v1/models`, { headers: { authorization: `Bearer ${TOKEN}` } });
      assert.deepStrictEqual(
        (await r.json()).data.map((m) => m.id),
        ['gemini-x', 'gemini-y']
      );
    }));

  test('plain chat returns content', () =>
    withGateway(fakePool({ out: 'hi there' }), async (base) => {
      const j = await (await call(base, chat)).json();
      assert.strictEqual(j.choices[0].message.content, 'hi there');
      assert.strictEqual(j.choices[0].finish_reason, 'stop');
    }));

  test('tool calls are emulated from JSON output', () => {
    const out =
      '{"tool_calls":[{"name":"read","arguments":{"p":"a"}},{"name":"nope","arguments":{}}]}';
    return withGateway(fakePool({ out }), async (base) => {
      const tools = [{ type: 'function', function: { name: 'read', parameters: {} } }];
      const j = await (await call(base, { ...chat, tools })).json();
      const m = j.choices[0].message;
      assert.strictEqual(j.choices[0].finish_reason, 'tool_calls');
      assert.strictEqual(m.tool_calls.length, 1);
      assert.strictEqual(m.tool_calls[0].function.name, 'read');
      assert.strictEqual(m.tool_calls[0].function.arguments, '{"p":"a"}');
    });
  });

  test('prompt carries tool results and tool schema', () => {
    let seen;
    const pool = fakePool({
      out: (job) => ((seen = job.prompt), '{"content":"ok"}'),
    });
    return withGateway(pool, async (base) => {
      const body = {
        ...chat,
        tools: [{ type: 'function', function: { name: 'read', parameters: {} } }],
        messages: [
          { role: 'user', content: 'q' },
          { role: 'tool', tool_call_id: 'c1', content: 'R' },
        ],
      };
      const j = await (await call(base, body)).json();
      assert.strictEqual(j.choices[0].message.content, 'ok');
      assert.match(seen, /TOOL RESULT \(call c1\)/);
      assert.match(seen, /AVAILABLE TOOLS/);
    });
  });

  test('429 when no account has quota', () =>
    withGateway(fakePool({ quota: { agy01: ROW(0), agy02: ROW(0) } }), async (base) => {
      const r = await call(base, chat);
      assert.strictEqual(r.status, 429);
      assert.ok((await r.json()).error.message);
    }));

  test('401 for missing or wrong bearer', () =>
    withGateway(fakePool(), async (base) => {
      assert.strictEqual((await call(base, chat, 'wrong')).status, 401);
      const r = await fetch(`${base}/v1/models`);
      assert.strictEqual(r.status, 401);
    }));

  test('pool failures map to 429 / 401 / 504', async () => {
    for (const [result, status] of [
      [{ state: 'quota', exitCode: 1 }, 429],
      [{ state: 'login-required', exitCode: 1 }, 401],
      [{ state: 'error', exitCode: 1, reason: 'POOL_TIMEOUT' }, 504],
    ]) {
      await withGateway(fakePool({ result }), async (base) => {
        assert.strictEqual((await call(base, chat)).status, status);
      });
    }
  });

  test('concurrent requests use different accounts', () => {
    const pool = fakePool({ delayMs: 50 });
    return withGateway(pool, async (base) => {
      const rs = await Promise.all([call(base, chat), call(base, chat), call(base, chat)]);
      const codes = rs.map((r) => r.status).sort();
      assert.deepStrictEqual(codes, [200, 200, 429]);
      assert.deepStrictEqual([...new Set(pool.used)].sort(), ['agy01', 'agy02']);
    });
  });

  test('stream returns SSE ending with [DONE]', () =>
    withGateway(fakePool({ out: 'streamed' }), async (base) => {
      const r = await call(base, { ...chat, stream: true });
      assert.match(r.headers.get('content-type'), /event-stream/);
      const text = await r.text();
      assert.match(text, /"content":"streamed"/);
      assert.ok(text.trim().endsWith('data: [DONE]'));
    }));
});
