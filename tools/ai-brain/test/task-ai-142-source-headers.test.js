'use strict';

/**
 * TASK-AI-142 H3 live: request headers declared on a source reach the run-time
 * requests (route probe, orchestrator route candidate, opencode provider config,
 * Hermes probe config). Headers are data from the source entry.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const { probeRoute } = require('../route-probe');
const { routeProbeCandidate } = require('../orchestrate');
const { writeProvidersConfig } = require('../hermes-session');

const HDR = { 'User-Agent': 'x-cli/1' };

function registry(headers) {
  return {
    version: 2,
    sources: [
      {
        id: 'hsrc',
        kind: 'direct',
        harness: 'opencode-direct',
        endpoint: 'https://hsrc.example/v1',
        accessPath: 'https://hsrc.example/v1',
        credential: { type: 'api-key', env: 'HSRC_API_KEY' },
        servesModels: true,
        ...(headers ? { headers } : {}),
      },
    ],
  };
}

async function probeHeaders(candidate) {
  let init;
  await probeRoute(
    candidate,
    'K',
    { K: 'secret' },
    {
      fetch: async (_url, i) => {
        init = i;
        return { ok: true, status: 200, text: async () => 'OK' };
      },
    }
  );
  return init.headers;
}

describe('declared source headers reach run-time requests', () => {
  test('probeRoute sends candidate.headers and keeps auth', async () => {
    const h = await probeHeaders({
      accessPath: 'https://g.example/v1',
      modelId: 'm',
      headers: HDR,
    });
    assert.equal(h['User-Agent'], 'x-cli/1');
    assert.equal(h.authorization, 'Bearer secret');
  });

  test('probeRoute without headers is unchanged', async () => {
    const h = await probeHeaders({ accessPath: 'https://g.example/v1', modelId: 'm' });
    assert.deepEqual(Object.keys(h).sort(), ['authorization', 'content-type']);
  });

  test('routeProbeCandidate carries the source headers (and omits when absent)', () => {
    const cand = { gateway: 'hsrc', model: 'hsrc/m1' };
    const route = { gateway: 'hsrc' };
    const withH = routeProbeCandidate(cand, route, registry(HDR));
    const without = routeProbeCandidate(cand, route, registry(null));
    if (withH) assert.deepEqual(withH.headers, HDR);
    else assert.fail('candidate not resolved');
    assert.equal(without && 'headers' in without, false);
  });

  test('writeProvidersConfig exposes source headers for the Hermes probe', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'srchdr-'));
    try {
      const cand = {
        gateway: 'hsrc',
        model: 'hsrc/m1',
        modelId: 'm1',
        accessPath: 'https://hsrc.example/v1',
      };
      const a = writeProvidersConfig(cand, { rootDir: root }, { registry: registry(HDR) });
      const b = writeProvidersConfig(cand, { rootDir: root }, { registry: registry(null) });
      assert.deepEqual(a.headers, HDR);
      assert.equal('headers' in b, false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('opencode.json provider options carry the source headers', () => {
    const sourcesJson = require('../sources.json');
    const src = sourcesJson.sources.find((s) => s.id === '9router');
    const before = src.headers;
    try {
      src.headers = HDR;
      assert.deepEqual(opencodeOptions().headers, HDR);
      delete src.headers;
      assert.equal('headers' in opencodeOptions(), false);
    } finally {
      if (before === undefined) delete src.headers;
      else src.headers = before;
    }
  });
});

function opencodeOptions() {
  const isoMod = require('../isolation-launcher');
  const { getHarness } = require('../harness');
  const adapter = getHarness('opencode-direct');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'srchdr-oc-'));
  const host = path.join(tmp, 'host');
  const worker = path.join(tmp, 'worker');
  fs.mkdirSync(path.join(host, 'scripts/ai/isolation'), { recursive: true });
  fs.mkdirSync(worker, { recursive: true });
  const verdictPath = path.join(host, 'verdict.json');
  fs.writeFileSync(
    verdictPath,
    JSON.stringify({
      verdict: 'CLOSED',
      worktree: host,
      timestamp: Date.now() - 1000,
      policyHash: isoMod.getFolderHash(path.join(host, 'scripts/ai/isolation')),
      sid: 'T',
      details: {},
    })
  );
  const realSpawn = cp.spawnSync;
  try {
    cp.spawnSync = (cmd, a, o) => {
      if (cmd === 'git') {
        if (a && a[0] === 'clone')
          fs.mkdirSync(path.join(a[a.length - 1], '.git', 'info'), { recursive: true });
        if (a && a.includes('rev-parse'))
          return { status: 0, stdout: '0123456789012345678901234567890123456789\n' };
        return { status: 0 };
      }
      if (cmd === 'powershell.exe') return { status: 0, stdout: '' };
      return realSpawn(cmd, a, o);
    };
    const args = adapter.launch({
      isolatedWorker: true,
      model: 'ninerouter/ag/gemini-3.1-pro-low',
      cwd: worker,
      prompt: 'p',
    });
    try {
      isoMod.getIsolatedLauncher()(adapter, args, {
        cwd: host,
        workerRoot: worker,
        verdictPath,
        getWorkerSid: () => 'T',
        verifyBoundary: () => true,
        baseSha: '0123456789012345678901234567890123456789',
        workerTimeoutMs: 1000,
      });
    } catch (_) {
      // only the generated config matters
    }
    const cfg = JSON.parse(fs.readFileSync(path.join(worker, 'opencode.json'), 'utf8'));
    return Object.values(cfg.provider)[0].options;
  } finally {
    cp.spawnSync = realSpawn;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
