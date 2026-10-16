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

describe('agy pool cross-process lock', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { spawn } = require('child_process');
  const rt = require('../agy-pool-runtime');

  const setup = () => {
    const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agylock-'));
    fs.mkdirSync(path.join(runsDir, 'agy01'));
    return runsDir;
  };

  test('a lock held by another live process makes submitJob busy and leaves job.json alone', async () => {
    const runsDir = setup();
    const dir = path.join(runsDir, 'agy01');
    fs.writeFileSync(path.join(dir, 'job.json'), '{"keep":true}');
    const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
    try {
      fs.writeFileSync(
        path.join(dir, 'job.lock'),
        JSON.stringify({ pid: child.pid, startedAt: Date.now() })
      );
      const r = rt.submitJob('agy01', { x: 1 }, { runsDir });
      assert.deepStrictEqual(r, { state: 'busy', exitCode: 1, reason: 'POOL_ACCOUNT_BUSY' });
      assert.strictEqual(fs.readFileSync(path.join(dir, 'job.json'), 'utf8'), '{"keep":true}');
      assert.ok(fs.existsSync(path.join(dir, 'job.lock')));
    } finally {
      child.kill();
    }
  });

  test('a lock whose pid is dead is taken over and released afterwards', async () => {
    const runsDir = setup();
    const dir = path.join(runsDir, 'agy01');
    const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
    await new Promise((r) => child.on('close', r));
    fs.writeFileSync(
      path.join(dir, 'job.lock'),
      JSON.stringify({ pid: child.pid, startedAt: Date.now() })
    );
    const adapterScript = path.join(runsDir, 'noop.js');
    fs.writeFileSync(adapterScript, '');
    const r = rt.submitJob('agy01', { x: 1 }, { runsDir, timeoutMs: 100, adapterScript });
    assert.notStrictEqual(r.state, 'busy');
    assert.ok(fs.existsSync(path.join(dir, 'job.json')));
    assert.ok(!fs.existsSync(path.join(dir, 'job.lock')));
  });
});

describe('agy gateway quota source', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');

  test('persisted store wins over out.txt and exhausted accounts are skipped', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agyq-'));
    const rows = (p) => [{ family: 'gemini', window: 'weekly', remainingPercent: p, known: true }];
    const file = path.join(dir, 'q.json');
    fs.writeFileSync(
      file,
      JSON.stringify({ accounts: { agy01: { rows: rows(0) }, agy02: { rows: rows(40) } } })
    );
    for (const id of ['agy01', 'agy02']) fs.mkdirSync(path.join(dir, id));
    const { createGateway: make } = require('../agy-gateway');
    const gw = make({
      token: TOKEN,
      poolOptions: { runsDir: dir, quotaStore: { path: file }, models: ['gemini-x'] },
    });
    const picked = [];
    gw.pool.submit = async (id) => (picked.push(id), { state: 'busy', exitCode: 1 });
    const r = await gw.complete(chat);
    assert.strictEqual(r.status, 429);
    assert.deepStrictEqual(picked, ['agy02']); // agy01 is at 0% in the store
  });

  test('busy from another process makes the gateway try the next account', async () => {
    const pool = fakePool();
    const submit = pool.submit;
    pool.submit = async (id, job, o) =>
      id === 'agy01' ? { state: 'busy', exitCode: 1 } : submit(id, job, o);
    const gw = createGateway({ token: TOKEN, pool });
    const r = await gw.complete(chat);
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(pool.used, ['agy02']);
  });
});
