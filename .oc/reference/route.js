#!/usr/bin/env node
// Single entry point for handing work to a writer. Every dispatch goes:
//   Controller ranking -> live check -> family exclusion -> Jev -> launch -> log.
// Usage:
//   node route.js --item FEAT-COM-05 --cwd <worktree> --task <task.md>
//                 [--role author.foundation] [--exclude-family gpt,gemini]
//                 [--dry-run]
// Nothing about models is hardcoded here: candidates come from the Controller
// (`cli.js dispatch --dry-run`) and from the latest live probe of scored models
// (probe-priors-out.txt, produced by probe-priors.js over model-priors.json).
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

const SCRATCH = __dirname;
const REPO = 'C:/Users/gumac/AI/shipde-platform';
const MAIN_TREE = REPO + '/.worktrees/p-run-main'; // detached at origin/main
const LOGS = REPO + '/.worktrees/logs/night';
const AGY = 'C:/Tools/agy-runs';
const PROBE_OUT = path.join(SCRATCH, 'probe-priors-out.txt');
const AR_MODELS = ['deepseek-v4-flash', 'gpt-6-astra', 'gpt-6.1-sol'];
const PROBE_MAX_AGE_MIN = 90;
const MIN_WEEKLY = 0.05;
const MIN_SCORE = 65; // operator 30/10: never hand work to weak models
const RISK_FLOOR = 80; // high-risk items prefer writers at or above this score
const MAX_PER_MODEL = 2; // per model per 20 min, across items
const CODEX_SANDBOX_NOTE = '\n\n' + fs.readFileSync(path.join(SCRATCH, 'note.txt'), 'utf8');
let recentLaunchesCache = null;

function args() {
  const a = {};
  const v = process.argv.slice(2);
  for (let i = 0; i < v.length; i++) {
    if (!v[i].startsWith('--')) continue;
    const k = v[i].slice(2);
    a[k] = v[i + 1] && !v[i + 1].startsWith('--') ? v[++i] : true;
  }
  return a;
}

// Scoreboard lookup (priors-now.json: BenchLM coding index, AA Intelligence Index mapped where no coding score).
let PRIORS;
function priorScore(model) {
  if (!PRIORS) {
    try {
      PRIORS = JSON.parse(
        fs.readFileSync(path.join(SCRATCH, 'priors-now.json'), 'utf8')
      ).ranking.filter((x) => x.score);
    } catch {
      PRIORS = [];
    }
  }
  const n = String(model)
    .toLowerCase()
    .split('/')
    .pop()
    .replace(/:.*$/, '')
    .replace(/-(low|medium|high|xhigh|max|thinking)$/, '')
    .replace(/[._ ]/g, '-');
  let best = null;
  for (const x of PRIORS) {
    const c = x.canonical;
    if (n === c || n.startsWith(c + '-')) {
      if (!best || c.length > best.canonical.length) best = x;
    }
  }
  return best ? best.score : null;
}
function family(model) {
  const m = String(model).toLowerCase();
  for (const [f, rx] of [
    ['gemini', /gemini/],
    ['gpt', /gpt|o[0-9]-|codex|astra|terra|sol\b|luna/],
    ['claude', /claude|opus|sonnet|haiku/],
    ['grok', /grok/],
    ['qwen', /qwen/],
    ['glm', /glm/],
    ['kimi', /kimi/],
    ['deepseek', /deepseek/],
    ['minimax', /minimax/],
  ])
    if (rx.test(m)) return f;
  return 'other';
}

// 1. Controller ranking (refreshes main first so the ranking code is current).
function controllerRanking(item, role) {
  try {
    execFileSync('git', ['-C', MAIN_TREE, 'fetch', '-q', 'origin']);
    execFileSync('git', ['-C', MAIN_TREE, 'checkout', '-q', '--detach', 'origin/main']);
  } catch {}
  let out = '';
  try {
    out = execFileSync(
      'node',
      ['tools/ai-brain/cli.js', 'dispatch', '--dry-run', '--item', item, '--role', role],
      { cwd: MAIN_TREE, encoding: 'utf8', timeout: 400000, stdio: ['ignore', 'pipe', 'pipe'] }
    );
  } catch (e) {
    out = String(e.stdout || '');
  }
  const rows = [];
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/^\s+\d+\.\s+(\S+)\s+\(score:\s*(\d+|QUALITY_UNKNOWN)\)/);
    if (!m) continue;
    const parts = m[1].split('::');
    const kind = parts[0];
    const model = parts[parts.length - 1];
    const lane = kind === 'agy-pool' ? (parts[1].match(/agy\d+/) || [null])[0] : null;
    // Controller has no grade for this model: use the scoreboard's, or skip it.
    const score = m[2] === 'QUALITY_UNKNOWN' ? priorScore(model) : Number(m[2]);
    if (score == null) continue;
    rows.push({
      origin: m[2] === 'QUALITY_UNKNOWN' ? 'controller+scoreboard' : 'controller',
      kind,
      lane,
      model,
      score,
      key: m[1],
    });
  }
  return rows;
}

// 2a. Scored models that answered the latest live probe (non-Controller routes).
function probedRoutes() {
  if (!fs.existsSync(PROBE_OUT)) return { rows: [], ageMin: Infinity };
  const ageMin = (Date.now() - fs.statSync(PROBE_OUT).mtimeMs) / 60000;
  const rows = [];
  for (const line of fs.readFileSync(PROBE_OUT, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^OK\s+([\d.]+)\s+(\S+)\s+(\S+)\s+200\s+(\S+)/);
    if (!m) continue;
    const route = m[4];
    if (/nano|lite|mini\b/i.test(route)) continue; // probe maps these onto the full model's prior
    // opencode refuses models its config does not list ("Model not found"), even if the provider serves them.
    if (!opencodeHas(route)) continue;
    rows.push({
      origin: 'probe',
      kind: 'opencode',
      lane: null,
      model: route,
      score: Number(m[1]),
      tier: m[2],
      key: route,
    });
  }
  // agentrouter (via codex CLI) serves models the opencode probe cannot reach; reuse the best prior score of the same model family from the probe file.
  for (const m of AR_MODELS) {
    const base = m.replace(/[^a-z0-9]/gi, '').toLowerCase();
    let best = null;
    for (const line of fs.readFileSync(PROBE_OUT, 'utf8').split(/\r?\n/)) {
      const x = line.match(/^\w+\s+([\d.]+)\s+\S+\s+(\S+)/);
      if (!x) continue;
      if (
        x[2]
          .replace(/[^a-z0-9]/gi, '')
          .toLowerCase()
          .startsWith(base) &&
        (best == null || Number(x[1]) > best)
      )
        best = Number(x[1]);
    }
    if (best != null)
      rows.push({
        origin: 'agentrouter',
        kind: 'codex-ar',
        lane: null,
        model: m,
        score: best,
        key: `codex-ar::${m}`,
      });
  }
  return { rows, ageMin };
}

// 2b. Live checks per launch kind.
function lanes() {
  let txt = '';
  try {
    txt = execFileSync('schtasks', ['/Query', '/FO', 'CSV'], { encoding: 'utf8' });
  } catch {}
  const running = new Set();
  for (const l of txt.split(/\r?\n/)) {
    const m = l.match(/ShipDe-(agy\d+)","[^"]*","Running"/);
    if (m) running.add(m[1]);
  }
  // schtasks may report Ready while agy still works: treat a lane as busy for 90 min after launch unless its worktree already committed.
  try {
    for (const l of fs.readFileSync(`${LOGS}/route-log.jsonl`, 'utf8').trim().split(/\r?\n/)) {
      const r = JSON.parse(l);
      const m = r.choice && /^(agy\d+):/.exec(r.choice.label);
      if (!m || !r.launch) continue;
      if (Date.now() - Date.parse(r.at) > 90 * 60000) continue;
      let c = '';
      try {
        c = execFileSync('git', ['-C', r.cwd, 'log', '-1', `--since=${r.at}`, '--format=%h'], {
          encoding: 'utf8',
        }).trim();
      } catch {}
      if (!c) running.add(m[1]);
    }
  } catch {}
  return running;
}
function agyQuota(lane, model) {
  try {
    const q = JSON.parse(fs.readFileSync(`${AGY}/${lane}/quota.json`, 'utf8').replace(/^﻿/, ''));
    const a = Array.isArray(q) ? q : q.groups || Object.values(q);
    const g = a.find(
      (x) =>
        x.id ===
        (/argon/.test(model || '')
          ? 'argon'
          : model && !/^gemini/.test(model)
            ? 'external'
            : 'gemini')
    );
    const reset = g && g.weekly && g.weekly.resetAt && Date.parse(g.weekly.resetAt) < Date.now();
    const wk = g && g.weekly ? g.weekly.remaining : null;
    if (wk == null) return null;
    return {
      weekly: reset ? 1 : wk,
      five: g.fiveHour ? g.fiveHour.remaining : null,
      stale: !!reset,
    };
  } catch {
    return null;
  }
}
function agyLoggedIn(lane) {
  try {
    return !/authentication (timed out|failed)/i.test(
      fs.readFileSync(`${AGY}/${lane}/err.txt`, 'utf8').slice(-2000)
    );
  } catch {
    return true;
  }
}
let codexAlive;
function codexOk() {
  if (codexAlive !== undefined) return codexAlive;
  try {
    const o = execFileSync(
      'codex',
      ['exec', '--skip-git-repo-check', '-s', 'read-only', 'Reply with exactly: OK'],
      { encoding: 'utf8', timeout: 90000, input: '' }
    );
    codexAlive = /\bOK\b/.test(o) && !/usage limit/i.test(o);
  } catch (e) {
    const o = String(e.stdout || '') + String(e.stderr || '');
    codexAlive = /\bOK\b/.test(String(e.stdout || '')) && !/usage limit/i.test(o);
  } // codex often answers then lingers past the timeout
  return codexAlive;
}

function liveCheck(c, running) {
  if (c.kind === 'agy-pool') {
    if (!c.lane) return 'no lane id';
    if (running.has(c.lane)) return 'lane busy';
    if (!agyLoggedIn(c.lane)) return 'lane not logged in';
    const q = agyQuota(c.lane, c.model);
    if (!q) return 'no quota data';
    if (q.weekly < MIN_WEEKLY) return `weekly quota ${q.weekly.toFixed(2)}`;
    return null;
  }
  if (c.kind === 'codex-ar') return null; // agentrouter answered our reviews today
  if (c.kind === 'codex') return codexOk() ? null : 'codex usage-limited or unreachable';
  if (c.kind === 'opencode') return null; // answered the live probe
  return `kind ${c.kind} not launchable from coordinator`;
}

// Models whose real runs recently hit a usage/quota wall stay excluded for a while,
// because a tiny probe can still succeed after the real budget is gone.
const COOLDOWN_H = 3;
function recentlyExhausted() {
  const out = new Set();
  let lines = [];
  try {
    lines = fs.readFileSync(`${LOGS}/route-log.jsonl`, 'utf8').trim().split(/\r?\n/);
  } catch {
    return out;
  }
  for (const l of lines.slice(-200)) {
    let r;
    try {
      r = JSON.parse(l);
    } catch {
      continue;
    }
    if (!r.launch || !r.launch.log || !r.choice) continue;
    const age = Date.now() - Date.parse(r.at);
    if (age > 24 * 3600000) continue;
    let t = '';
    try {
      t = fs.readFileSync(r.launch.log, 'utf8');
    } catch {}
    if (/agy-runs\/agy\d+\/result\.json$/.test(r.launch.log)) {
      try {
        t += fs.readFileSync(r.launch.log.replace('result.json', 'err.txt'), 'utf8').slice(-3000);
      } catch {}
      if (age <= 5 * 3600000 && /Individual quota reached|RESOURCE_EXHAUSTED/.test(t)) {
        out.add(r.choice.label);
        continue;
      }
    }
    if (/rolling 24-hour|free-usage-exhausted/i.test(t)) {
      out.add(r.choice.label);
      continue;
    }
    if (age <= 3600000 && /concurrency limit|concurrency_rate_limit/i.test(t)) {
      out.add(r.choice.label);
      continue;
    }
    if (
      age <= COOLDOWN_H * 3600000 &&
      /Tool execution aborted|usage limit|quota.*exhausted|\[429\]|Unavailable \(reset after/i.test(
        t
      )
    )
      out.add(r.choice.label);
  }
  return out;
}

// Spread load: count opencode runs already in flight per provider.
const MAX_PER_PROVIDER = 3;
function providerLoad() {
  const load = {};
  try {
    const o = execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'opencode.exe' -and $_.CommandLine -like '*run -m*' } | ForEach-Object { $_.CommandLine }",
      ],
      { encoding: 'utf8', timeout: 60000 }
    );
    for (const line of o.split(/\r?\n/).filter(Boolean)) {
      const m = line.match(/run -m "?([^"\s/]+)\//);
      if (m) load[m[1]] = (load[m[1]] || 0) + 1;
    }
  } catch {}
  return load;
}

// A run that finished without producing a commit in its worktree counts as a
// failure for that item: don't hand the same item to the same model again.
function modelKey(x) {
  return String(x)
    .toLowerCase()
    .split(/[/:]/)
    .pop()
    .replace(/[^a-z0-9.]+/g, '-');
}
function unproductive(item) {
  const out = new Set();
  let lines = [];
  try {
    lines = fs.readFileSync(`${LOGS}/route-log.jsonl`, 'utf8').trim().split(/\r?\n/);
  } catch {
    return out;
  }
  for (const l of lines.slice(-300)) {
    let r;
    try {
      r = JSON.parse(l);
    } catch {
      continue;
    }
    if (r.item !== item || !r.launch || !r.choice) continue;
    const started = Date.parse(r.at);
    if (Date.now() - started < 20 * 60000) continue; // may still be running
    if (Date.now() - started > 12 * 3600000) continue; // old failures expire (lane overwrites, outages)
    let last = 0;
    try {
      last =
        Number(
          execFileSync(
            'git',
            ['-c', 'safe.directory=*', '-C', r.cwd, 'log', '-1', '--format=%ct'],
            { encoding: 'utf8' }
          ).trim()
        ) * 1000;
    } catch {}
    // A run that died on quota/rate limit says nothing about the model's ability.
    let t = '';
    try {
      t = fs.readFileSync(r.launch.log, 'utf8').slice(-4000);
      if (/result\.json$/.test(r.launch.log))
        t += fs.readFileSync(r.launch.log.replace('result.json', 'err.txt'), 'utf8').slice(-3000);
    } catch {}
    if (
      /"state":\s*"quota"|RESOURCE_EXHAUSTED|usage limit|rolling 24-hour|free-usage-exhausted|concurrency limit|\[429\]/i.test(
        t
      )
    )
      continue;
    if (last < started) out.add(modelKey(r.choice.label));
  }
  return out;
}

// Models whose run on this item produced a commit (a full round) in the last 48h: the item coming back means that round failed review.
function roundsUsed(item) {
  const out = new Set();
  let lines = [];
  try {
    lines = fs.readFileSync(`${LOGS}/route-log.jsonl`, 'utf8').trim().split(/\r?\n/);
  } catch {
    return out;
  }
  const runs = [];
  for (const l of lines.slice(-400)) {
    let r;
    try {
      r = JSON.parse(l);
    } catch {
      continue;
    }
    if (r.item === item && r.launch && r.choice && Date.now() - Date.parse(r.at) < 48 * 3600000)
      runs.push(r);
  }
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i],
      end = i + 1 < runs.length ? Date.parse(runs[i + 1].at) : Date.now();
    let n = 0;
    try {
      n = Number(
        execFileSync(
          'git',
          [
            '-c',
            'safe.directory=*',
            '-C',
            r.cwd,
            'rev-list',
            '--count',
            `--since=${r.at}`,
            `--until=${new Date(end).toISOString()}`,
            '--no-merges',
            'HEAD',
          ],
          { encoding: 'utf8' }
        ).trim()
      );
    } catch {}
    if (n > 0) out.add(modelKey(r.choice.label));
  }
  return out;
}

// 3. Jev.
function askJev(question, options, evidence) {
  try {
    const out = execFileSync('node', [path.join(SCRATCH, 'ask-jev.js'), question, ...options], {
      cwd: REPO + '/.worktrees/p-agy-lane',
      encoding: 'utf8',
      timeout: 300000,
      env: { ...process.env, JEV_EVIDENCE: evidence },
    });
    const line = out.trim().split(/\r?\n/).pop();
    return JSON.parse(line);
  } catch (e) {
    return { outcome: 'ERROR', reason: String(e.message).slice(0, 120) };
  }
}

// 4. Launch.
function launch(c, cwd, taskFile, item) {
  const prompt = fs.readFileSync(taskFile, 'utf8');
  const tag = `${item}-${Date.now()}`;
  if (c.kind === 'agy-pool') {
    fs.writeFileSync(
      `${AGY}/${c.lane}/job.json`,
      JSON.stringify({ cwd, model: c.model, accountId: c.lane, printTimeoutSec: 3600, prompt })
    );
    execFileSync('schtasks', ['/Run', '/TN', `\\ShipDe\\ShipDe-${c.lane}`]);
    return { how: `schtasks ShipDe-${c.lane}`, log: `${AGY}/${c.lane}/result.json` };
  }
  const log = `${LOGS}/route-${tag}.log`;
  const fd = fs.openSync(log, 'w');
  let child;
  if (c.kind === 'codex-ar') {
    fs.writeFileSync(path.join(cwd, '.oc-codex-task.md'), prompt + CODEX_SANDBOX_NOTE);
    child = spawn(
      'bash',
      [
        '-lc',
        `codex exec --skip-git-repo-check -c 'model_providers.ar={name="agentrouter",base_url="https://agentrouter.org/v1",env_key="AGENTROUTER_API_KEY",wire_api="responses"}' -c model_provider=ar -c disable_response_storage=true -m "${c.model}" -s workspace-write "$(cat .oc-codex-task.md)" < /dev/null; rm -f .oc-codex-task.md`,
      ],
      { cwd, detached: true, stdio: ['ignore', fd, fd] }
    );
  } else if (c.kind === 'codex') {
    fs.writeFileSync(path.join(cwd, '.oc-codex-task.md'), prompt + CODEX_SANDBOX_NOTE);
    child = spawn(
      'bash',
      [
        '-lc',
        `codex exec -m "${c.model}" -c model_reasoning_effort=medium -s workspace-write "$(cat .oc-codex-task.md)" < /dev/null; rm -f .oc-codex-task.md`,
      ],
      { cwd, detached: true, stdio: ['ignore', fd, fd] }
    );
  } else {
    const local = path.join(cwd, '.oc');
    fs.mkdirSync(local, { recursive: true });
    fs.writeFileSync(path.join(local, 'task.md'), prompt);
    child = spawn(
      'bash',
      [
        '-lc',
        `opencode run -m "${c.model}" "Do the task in .oc/task.md. Work in the current directory." -f .oc/task.md < /dev/null`,
      ],
      { cwd, detached: true, stdio: ['ignore', fd, fd] }
    );
  }
  child.unref();
  return { how: `${c.kind} pid ${child.pid}`, log };
}

(function main() {
  const a = args();
  if (!a.item || !a.cwd || !a.task) {
    console.error('need --item --cwd --task');
    process.exit(2);
  }
  const role = a.role || 'author.foundation';
  const exclude = String(a['exclude-family'] || '')
    .split(',')
    .filter(Boolean)
    .concat(a['allow-gpt'] ? [] : ['gpt']); // reviewer is Codex (gpt family): writer must differ
  const running = lanes();

  const ctl = controllerRanking(a.item, role);
  const notes = [];
  let probe = probedRoutes();
  if (probe.ageMin > PROBE_MAX_AGE_MIN) {
    // Paced probing takes ~1h: refresh it in the background (one at a time) and route on the last result now.
    const lock = path.join(SCRATCH, 'probe.lock');
    let fresh = false;
    try {
      fresh = Date.now() - fs.statSync(lock).mtimeMs < 2 * 3600000;
    } catch {}
    if (!fresh) {
      fs.writeFileSync(lock, String(Date.now()));
      spawn(
        'bash',
        [
          '-lc',
          `cd "${SCRATCH}" && node probe-priors.js > probe-priors-new.txt 2> probe-priors-err.txt && [ -s probe-priors-new.txt ] && mv probe-priors-new.txt probe-priors-out.txt; rm -f probe.lock`,
        ],
        { detached: true, stdio: 'ignore' }
      ).unref();
    }
    notes.push(
      `probe is ${Math.round(probe.ageMin)} min old — background refresh ${fresh ? 'already running' : 'started'}`
    );
  }

  // Controller candidates first (its score), then probed routes the Controller
  // does not rank (prior score). One row per (kind, lane, model).
  // Every model an agy lane lists that the scoreboard scores is a candidate there, even when the Controller does not list it (e.g. Argon, Opus 5.5).
  for (const lane of fs.readdirSync(AGY).filter((d) => /^agy\d+$/.test(d))) {
    let m = '';
    try {
      m = fs.readFileSync(`${AGY}/${lane}/models-out.txt`, 'utf8');
    } catch {}
    for (const id of m
      .split(/\r?\n/)
      .map((l) => l.split('\t')[0])
      .filter(Boolean)) {
      if (/-(low|medium)$/.test(id)) continue; // scores are published for high/max effort; low/medium variants score far lower
      const s = priorScore(id);
      if (s != null)
        ctl.push({
          origin: 'scoreboard',
          kind: 'agy-pool',
          lane,
          model: id,
          score: s,
          key: `agy-pool::${lane}::${id}`,
        });
    }
  }
  // Controller 'paseo' rows name agy models without a lane: offer them on every agy lane whose models-out lists them.
  for (const p of ctl.filter((c) => c.kind === 'paseo')) {
    for (const lane of fs.readdirSync(AGY).filter((d) => /^agy\d+$/.test(d))) {
      let m = '';
      try {
        m = fs.readFileSync(`${AGY}/${lane}/models-out.txt`, 'utf8');
      } catch {}
      if (m.split(/\r?\n/).some((l) => l.split('\t')[0] === p.model))
        ctl.push({ ...p, kind: 'agy-pool', lane, origin: 'controller-paseo' });
    }
  }
  const seen = new Set();
  const all = [...ctl, ...probe.rows].filter((c) => {
    const k = `${c.kind}|${c.lane}|${c.model}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  all.sort((x, y) => y.score - x.score);

  const cooled = recentlyExhausted();
  const badModels = unproductive(a.item);
  const pload = providerLoad();
  const eligible = [];
  const rejected = [];
  for (const c of all) {
    if (badModels.has(modelKey(c.model))) {
      rejected.push([c, 'same model produced no commit for this item']);
      continue;
    }
    if (cooled.has(c.lane ? `${c.lane}:${c.model}` : `${c.kind}:${c.model}`)) {
      rejected.push([c, `hit usage limit in a run < ${COOLDOWN_H}h ago`]);
      continue;
    }
    if (exclude.includes(family(c.model))) {
      rejected.push([c, `family ${family(c.model)} excluded`]);
      continue;
    }
    if (c.score < MIN_SCORE) {
      rejected.push([c, `score ${c.score} < ${MIN_SCORE}`]);
      continue;
    }
    const prov = c.kind === 'opencode' ? c.model.split('/')[0] : null;
    if (prov && (pload[prov] || 0) >= MAX_PER_PROVIDER) {
      rejected.push([c, `provider ${prov} already runs ${pload[prov]} jobs`]);
      continue;
    }
    if (
      (recentLaunchesCache = recentLaunchesCache || recentModelLaunches())[modelKey(c.model)] >=
      MAX_PER_MODEL
    ) {
      rejected.push([c, `model already launched ${MAX_PER_MODEL}x in the last 20 min`]);
      continue;
    }
    const why = liveCheck(c, running);
    if (why) {
      rejected.push([c, why]);
      continue;
    }
    eligible.push(c);
  }
  // Escalate early: a model that already ran a full round on this item (committed, yet the item is back here)
  // only gets it again when nothing stronger is eligible. High-risk items (tenant/auth/money/carrier) prefer
  // models scoring >= RISK_FLOOR. Both rules fall back to the plain ranking rather than starving the item.
  const failedRound = roundsUsed(a.item);
  let pool = eligible.filter((c) => !failedRound.has(modelKey(c.model)));
  for (const c of eligible)
    if (failedRound.has(modelKey(c.model)))
      rejected.push([c, 'already used a full round on this item (escalating)']);
  if (!pool.length) pool = eligible;
  let taskText = '';
  try {
    taskText = fs.readFileSync(a.task, 'utf8');
  } catch {}
  const risky = /tenant|RLS|auth|RBAC|money|VND|carrier|payment|settlement/i.test(
    taskText + ' ' + a.item
  );
  if (risky && pool.some((c) => c.score >= RISK_FLOOR)) {
    for (const c of pool)
      if (c.score < RISK_FLOOR) rejected.push([c, `high-risk item prefers score >= ${RISK_FLOOR}`]);
    pool = pool.filter((c) => c.score >= RISK_FLOOR);
  }
  const top = pool.slice(0, 6);
  const label = (c) => (c.lane ? `${c.lane}:${c.model}` : `${c.kind}:${c.model}`);

  let choice = null;
  let jev = { outcome: 'SKIPPED' };
  if (top.length) {
    const evidence =
      top
        .map((c) => `${label(c)} score=${c.score} origin=${c.origin} family=${family(c.model)}`)
        .join('; ') +
      `. Rejected: ${rejected
        .slice(0, 8)
        .map(([c, w]) => `${label(c)} (${w})`)
        .join('; ')}`;
    jev = askJev(`Pick the writer for ${a.item} (${role})`, top.map(label), evidence);
    if (jev.outcome === 'DECIDED') choice = top.find((c) => label(c) === jev.choice) || null;
    if (!choice) choice = top[0];
  }

  const record = {
    at: new Date().toISOString(),
    item: a.item,
    role,
    cwd: a.cwd,
    exclude,
    controllerCandidates: ctl.length,
    probeRoutes: probe.rows.length,
    notes,
    top: top.map((c) => ({ label: label(c), score: c.score, origin: c.origin })),
    rejected: rejected.slice(0, 12).map(([c, w]) => ({ label: label(c), score: c.score, why: w })),
    jev,
    choice: choice ? { label: label(choice), score: choice.score, kind: choice.kind } : null,
  };
  if (choice && !a['dry-run']) record.launch = launch(choice, a.cwd, a.task, a.item);
  fs.appendFileSync(`${LOGS}/route-log.jsonl`, JSON.stringify(record) + '\n');

  console.log(
    `${a.item}: ${choice ? label(choice) + ' (score ' + choice.score + ')' : 'NO ELIGIBLE WRITER'} | jev=${jev.outcome}${jev.choice ? ':' + jev.choice : ''}${record.launch ? ' | ' + record.launch.how : a['dry-run'] ? ' | dry-run' : ''}`
  );
  console.log('  top: ' + top.map((c) => `${label(c)}=${c.score}`).join(', '));
  console.log(
    '  rejected: ' +
      rejected
        .filter(([c]) => c.kind !== 'paseo')
        .slice(0, 40)
        .map(([c, w]) => `${label(c)}=${c.score}(${w})`)
        .join(', ') +
      ` [+${rejected.filter(([c]) => c.kind === 'paseo').length} paseo not launchable]`
  );
  if (a['dry-run'])
    console.log(
      '  paseo: ' +
        rejected
          .filter(([c]) => c.kind === 'paseo')
          .map(([c]) => `${label(c)}=${c.score}`)
          .join(', ')
    );
  if (notes.length) console.log('  notes: ' + notes.join('; '));
})();

function opencodeHas(route) {
  if (!opencodeHas.cfg) {
    try {
      opencodeHas.cfg =
        JSON.parse(
          fs.readFileSync(
            path.join(
              process.env.USERPROFILE || process.env.HOME,
              '.config/opencode/opencode.json'
            ),
            'utf8'
          )
        ).provider || {};
    } catch {
      opencodeHas.cfg = {};
    }
  }
  const i = route.indexOf('/');
  const p = opencodeHas.cfg[route.slice(0, i)];
  return !!(p && p.models && Object.prototype.hasOwnProperty.call(p.models, route.slice(i + 1)));
}

// Launches of the same model in the last 20 min (any item). Free-tier models burn an account per long run,
// so spreading work across models beats stacking it on one that then exhausts everywhere at once.
function recentModelLaunches() {
  const n = {};
  let lines = [];
  try {
    lines = fs.readFileSync(`${LOGS}/route-log.jsonl`, 'utf8').trim().split(/\r?\n/).slice(-200);
  } catch {
    return n;
  }
  for (const l of lines) {
    let r;
    try {
      r = JSON.parse(l);
    } catch {
      continue;
    }
    if (!r.launch || !r.choice) continue;
    if (Date.now() - Date.parse(r.at) < 20 * 60000) {
      const k = modelKey(r.choice.label);
      n[k] = (n[k] || 0) + 1;
    }
  }
  return n;
}
