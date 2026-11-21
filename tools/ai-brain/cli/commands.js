'use strict';

const path = require('path');
const { toPositiveInteger } = require('../source-discovery');
const { atomicRenameSync } = require('../atomic-rename');
const { pick } = require('./reconcile-manifest');
const { mergeEvidenceAccounts } = require('./dispatch-helpers');

/**
 * `discovery import` and `discovery candidates` (TASK-AI-70).
 *
 * The Controller ranked one candidate at a time because the sources and models
 * that work today were never visible to it as data. `import` turns a reviewed
 * model audit into the two stores dispatch already reads, with the proof
 * carried exactly as the audit stated it; `candidates` prints what the two
 * production readers produce, so "what does the Controller see" is inspectable
 * without dispatching anything.
 *
 * `import` is the only writer here and it writes only where it is told: the
 * discovery ledger and import file under `--discovery-dir`, and the evidence
 * store under `--evidence-dir`. It performs no network call, reads no
 * credential, and never fabricates or promotes a proof.
 */
/**
 * evidence import-work (TASK-AI-75): turn real merged, independently reviewed
 * work into WORK_ITEM_PASS evidence. Never fabricates.
 *
 *   node tools/ai-brain/cli.js evidence import-work \
 *     --sha <40-hex> \
 *     --manifest <path to review-manifest.json> \
 *     --writer <7-part candidateKey harness::accessPath::gateway::upstream::account::quotaScope::modelId> \
 *     --review <path to review md> \
 *     --reviewer <reviewer identity string> \
 *     --work-item <id> \
 *     [--pr-head <40-hex>] \
 *     [--main-ref origin/main] \
 *     [--evidence-dir <dir>] \
 *     [--json]
 *
 * TASK-AI-77: --manifest is what authorises the import. It is refused as
 * MANIFEST_REQUIRED (exit 1) rather than as bad argv, so a caller that forgot it
 * sees why instead of a usage error.
 */
/**
 * review manifest validate (TASK-AI-77): check a structured review manifest
 * against git and against the markdown review it accompanies, before anything is
 * published or promoted on the strength of it.
 *
 *   node tools/ai-brain/cli.js review manifest validate \
 *     --manifest <path to review-manifest.json> --artifact <path to the review> \
 *     --work-item <id> --sha <40-hex reviewed commit> [--json]
 *
 * Exit 0 when the manifest is a faithful binding, 1 when it is refused (the
 * refusal code is printed), 2 on bad argv.
 */
function reviewCommand(args, deps) {
  const d = deps || {};
  const log = d.log || console.log;
  const error = d.error || console.error;
  const exit = d.exit || process.exit;
  const rootDir = args.root || d.rootDir || process.cwd();
  const sub = args._[1];
  const action = args._[2];

  if (sub === 'pr') return reviewPrCommand(args, d);

  if (sub !== 'manifest' || action !== 'validate') {
    error('Lệnh không rõ: review ' + [sub, action].filter(Boolean).join(' '));
    error(
      'Dùng: review manifest validate --manifest <file> --artifact <file.md> --work-item <id> --sha <40-hex> [--json]'
    );
    error(
      'Hoặc: review pr --pr <n> --sha <40-hex> [--work-item <id>] [--writer <candidateKey>] [--json]'
    );
    if (exit === process.exit) process.exitCode = 2;
    else exit(2);
    return { exitCode: 2 };
  }

  const manifest = args.manifest;
  const artifact = args.artifact;
  const workItem = args['work-item'] || args.workItem;
  const sha = args.sha;
  const missing = [manifest, artifact, workItem, sha].some(
    (value) => typeof value !== 'string' || value.trim() === ''
  );
  if (missing) {
    error('review manifest validate requires --manifest, --artifact, --work-item, --sha');
    if (exit === process.exit) process.exitCode = 2;
    else exit(2);
    return { exitCode: 2 };
  }

  const { validateManifestFile } = require('../review-manifest');
  const resolveArg = (value) => (path.isAbsolute(value) ? value : path.resolve(rootDir, value));
  const result = validateManifestFile(resolveArg(manifest), {
    repoCwd: rootDir,
    expected: { workItemId: workItem, commit: sha },
    artifactPath: resolveArg(artifact),
  });

  if (args.json) {
    log(JSON.stringify(result, null, 2));
  } else if (!result.ok) {
    error('REFUSED: ' + result.code + (result.reason ? ' - ' + result.reason : ''));
  } else {
    log(
      'OK: ' +
        result.workItemId +
        ' ' +
        result.reviewedCommit +
        ' verdict ' +
        result.verdict +
        ' (' +
        result.openFindings +
        ' open finding(s))'
    );
  }

  const code = result.ok ? 0 : 1;
  if (exit === process.exit) process.exitCode = code;
  else exit(code);
  return { exitCode: code, result };
}

/**
 * review pr: an independent review of an EXISTING Pull Request at its exact head.
 *
 *   node tools/ai-brain/cli.js review pr --pr <n> --sha <40-hex>
 *     [--work-item <id>] [--writer <candidateKey>] [--external-workers <list>] [--json]
 *
 * The Controller selects the reviewer outside the author's candidate and failure
 * domain, the verdict is bound to --sha (a PR whose head moved is refused), and the
 * verdict lands in the decision log and in the review manifest the merge
 * preflight reads. Exit 0 on PASS, 1 on CHANGES_REQUIRED / BLOCKED, 2 on bad argv.
 */
async function reviewPrCommand(args, deps) {
  const d = deps || {};
  const log = d.log || console.log;
  const error = d.error || console.error;
  const exit = d.exit || process.exit;
  const finish = (code, result) => {
    if (exit === process.exit) process.exitCode = code;
    else exit(code);
    return { exitCode: code, result };
  };
  const pr = args.pr;
  const sha = args.sha;
  if (
    !/^\d+$/.test(String(pr === undefined ? '' : pr)) ||
    typeof sha !== 'string' ||
    !/^[0-9a-f]{40}$/i.test(sha.trim())
  ) {
    error('review pr requires --pr <number> and --sha <40-character commit>');
    return finish(2);
  }
  const rootDir = args.root || d.rootDir || process.cwd();
  const services = d.planningServices
    ? d.planningServices
    : require('../planning-services').createPlanningServices(
        Object.assign({ rootDir }, d.servicesContext || {}, {
          externalWorkers: args['external-workers'] || args.externalWorkers,
          decisionDir: args['decision-dir'] || args.decisionDir,
          repo: args.repo,
          base: args.base,
        })
      );
  let result;
  try {
    result = await services.reviewPullRequest({
      pr: String(pr),
      sha: sha.trim().toLowerCase(),
      workItemId: args['work-item'] || args.workItem,
      authorKey: args.writer,
    });
  } catch (err) {
    result = { verdict: 'BLOCKED', reason: (err && err.message) || String(err) };
  }
  if (args.json) log(JSON.stringify(result, null, 2));
  else if (result.verdict === 'PASS')
    log('PASS: PR #' + pr + ' at ' + result.sha + ' by ' + result.reviewer);
  else error(result.verdict + ': ' + (result.reason || 'review did not pass'));
  return finish(result.verdict === 'PASS' ? 0 : 1, result);
}

/**
 * orchestrate (TASK-AI-64, TASK-AI-85): the live autonomous loop —
 *   node tools/ai-brain/cli.js orchestrate --goal <text|file> --specs <file>
 *     [--isolated-worker --base-sha <40-hex>] [--checkpoint <file>] [--out <file>]
 *     [--evidence-dir <dir>] [--worker-timeout-min <1..240>]
 */
async function orchestrateCommand(args, deps = {}) {
  const d = deps || {};
  const { runOrchestration } = d.runOrchestration ? d : require('../orchestrate');
  const sourcesApi = require('../sources');
  const decisionsApi = require('../decisions');
  const fsx = require('fs');
  const log = d.log || console.log;
  const exit = d.exit || process.exit;
  let goal = typeof args.goal === 'string' ? args.goal : null;
  if (!goal) {
    console.error('orchestrate requires --goal <text|file>');
    exit(2);
    return Promise.resolve({ exitCode: 2 });
  }
  if (fsx.existsSync(goal)) goal = fsx.readFileSync(goal, 'utf8');
  if (typeof args.specs !== 'string') {
    console.error('orchestrate requires --specs <file>: the real work-item specs, as a JSON array');
    exit(2);
    return Promise.resolve({ exitCode: 2 });
  }
  const specDoc = JSON.parse(fsx.readFileSync(args.specs, 'utf8'));
  const specs = Array.isArray(specDoc) ? specDoc : specDoc.specs;
  if (!Array.isArray(specs) || specs.length === 0) {
    console.error('orchestrate: --specs carried no work items');
    exit(2);
    return Promise.resolve({ exitCode: 2 });
  }
  const out = typeof args.out === 'string' ? args.out : null;
  // TASK-AI-121 LF-R03: --worker-timeout-min N (1..240, default 30) is the
  // worker timeout every isolated launch (writer, reviewer, repair) uses.
  // A value outside the range is a typo, and a typo is refused rather than
  // clamped into a timeout nobody asked for.
  const workerTimeoutMinRaw = args['worker-timeout-min'];
  let workerTimeoutMs = 30 * 60 * 1000;
  if (workerTimeoutMinRaw !== undefined) {
    const minutes = Number(workerTimeoutMinRaw);
    if (
      workerTimeoutMinRaw === true ||
      workerTimeoutMinRaw === '' ||
      !Number.isInteger(minutes) ||
      minutes < 1 ||
      minutes > 240
    ) {
      console.error('orchestrate: --worker-timeout-min must be an integer between 1 and 240');
      exit(2);
      return Promise.resolve({ exitCode: 2 });
    }
    workerTimeoutMs = minutes * 60 * 1000;
  }
  const registry = (d && d.registry) || sourcesApi.loadSources();
  const readJsonArg = (value) =>
    typeof value === 'string' && value ? JSON.parse(fsx.readFileSync(value, 'utf8')) : null;
  const inputAccounts = readJsonArg(args.accounts) || (Array.isArray(d.accounts) ? d.accounts : []);
  const poolEnabled =
    typeof args['external-workers'] === 'string' &&
    args['external-workers']
      .split(',')
      .map((s) => s.trim())
      .includes('agy-pool');
  const catSourcesPath =
    args['catalogue-sources'] ||
    (typeof args.catalogue === 'string' &&
    fsx.existsSync(path.join(path.dirname(args.catalogue), 'catalogue-sources.json'))
      ? path.join(path.dirname(args.catalogue), 'catalogue-sources.json')
      : null);
  const sourceModels = readJsonArg(catSourcesPath) || undefined;
  const discDir =
    (d && d.discoveryDataDir) ||
    args['discovery-dir'] ||
    path.join(__dirname, '..', 'data', 'discovery');
  let discoveryCatalogue = null;
  if (fsx.existsSync(discDir)) {
    try {
      const { readDiscoveryCatalogue } = require('../discovery/read');
      discoveryCatalogue = readDiscoveryCatalogue({ dataDir: discDir });
    } catch {}
  }
  // Combo-only (TASK-AI-171): the live Controller writer is the single 9router
  // combo. Tests may inject a candidate list to exercise selection; production
  // never generates, ranks or probes individual model routes.
  let candidates;
  if (Array.isArray(d.candidates)) {
    candidates = d.candidates;
  } else {
    const comboResult = require('../combo').comboCandidate({ registry, env: d.env });
    if (!comboResult.candidate) {
      console.error('orchestrate: ' + (comboResult.error || 'combo route unavailable'));
      exit(2);
      return Promise.resolve({ exitCode: 2 });
    }
    candidates = [comboResult.candidate];
  }
  const pool = require('../agy-pool-runtime');
  const discoveryWarning = poolEnabled ? pool.getLastDiscoveryWarning() : null;
  if (discoveryWarning && typeof console !== 'undefined' && console.warn) {
    console.warn(`[agy-pool] discovery warning: ${discoveryWarning}`);
  }
  const evidenceDir =
    typeof args['evidence-dir'] === 'string' && args['evidence-dir']
      ? args['evidence-dir']
      : path.join(__dirname, '..', 'data', 'evidence');
  const registryAccounts = Array.isArray(d.registryAccounts)
    ? d.registryAccounts
    : typeof d.listAccounts === 'function'
      ? d.listAccounts()
      : require('../accounts').listAccounts();
  const evidenceAccounts = mergeEvidenceAccounts(inputAccounts, registryAccounts);
  if (d.refreshRoutes === true) {
    const healthFile =
      args['route-health'] ||
      args.routeHealthFile ||
      d.routeHealthFile ||
      d['route-health'] ||
      (args.root
        ? path.join(args.root, 'tools', 'ai-brain', 'data', 'model-route-health.json')
        : null) ||
      path.join(__dirname, '..', 'data', 'model-route-health.json');
    const healthStore = require('../route-health').loadStore(healthFile, { allowMissing: true });
    const routeHealthApi = require('../route-health');
    const probeRoute =
      d.probeRoute ||
      ((model, route, probeOptions) =>
        routeHealthApi.probeGatewayModel(model, route, Object.assign({ registry }, probeOptions)));
    await routeHealthApi.recheckBeforeSelection(healthStore, probeRoute, {
      now: d.now,
      cap: d.probeCap,
      timeoutMs: d.probeTimeoutMs,
      catalogue: readJsonArg(args.catalogue) || [],
      registry,
      accounts: inputAccounts,
    });
    routeHealthApi.saveStore(healthFile, healthStore);
    d.refreshRoutes = false;
  }
  let tokenBudgets = null;
  if (typeof args['token-budgets'] === 'string') {
    try {
      tokenBudgets = JSON.parse(fsx.readFileSync(args['token-budgets'], 'utf8'));
    } catch (err) {
      console.error(
        `orchestrate: failed to parse token budgets from ${args['token-budgets']}: ${err.message}`
      );
      exit(2);
      return Promise.resolve({ exitCode: 2 });
    }
  } else if (args['isolated-worker']) {
    tokenBudgets = require('../intake').DEFAULT_TOKEN_BUDGETS;
  }
  // The live loop is async (TASK-AI-65): the JEV assessment behind every
  // Controller selection returns a promise. An unhandled rejection would crash
  // silently, so it is caught here and turned into a non-zero exit instead.
  return runOrchestration(goal, {
    specs,
    // Combo-only (TASK-AI-171): nothing to refresh; 9router owns the member list.
    refreshWriterModels: false,
    fetchModels: d.fetchModels,
    env: d.env,
    specText: typeof args['spec-text'] === 'string' ? args['spec-text'] : null,
    candidates,
    accounts: evidenceAccounts,
    registryAccounts,
    registry,
    catalogue: readJsonArg(args.catalogue) || [],
    sourceModels,
    discoveryCatalogue,
    evidenceDir,
    run: d.run,
    tests: d.tests,
    reviewer: d.reviewer || args.reviewer,
    measureFailBefore: d.measureFailBefore,
    home: typeof args.home === 'string' ? args.home : undefined,
    enforceProofFloors: true,
    isolatedWorker: Boolean(args['isolated-worker']),
    externalWorkers: args['external-workers'],
    routeHealthFile: args['route-health'] || d.routeHealthFile,
    workerTimeoutMs,
    ...(args.rtk ? { rtk: args.rtk } : {}),
    ...(tokenBudgets ? { tokenBudgets } : {}),
    ...(typeof args['context-manifest'] === 'string'
      ? { contextManifest: args['context-manifest'] }
      : {}),
    ...(args['isolated-worker'] || args['context-manifest'] ? { enableContextPack: true } : {}),
    ...(typeof d.run === 'function' ? { injectedRun: true } : {}),
    decisionDir: args['decision-dir'] || decisionsApi.DEFAULT_DIR,
    checkpointFile: typeof args.checkpoint === 'string' ? args.checkpoint : null,
    usageDir: typeof args['usage-dir'] === 'string' ? args['usage-dir'] : null,
    sha: typeof args.sha === 'string' ? args.sha : (d && d.sha) || null,
    baseSha: typeof args['base-sha'] === 'string' ? args['base-sha'] : (d && d.baseSha) || null,
    branch: typeof args.branch === 'string' ? args.branch : null,
    cwd: typeof args.cwd === 'string' ? args.cwd : undefined,
    workerRoot: typeof args['worker-root'] === 'string' ? args['worker-root'] : null,
    exercise: typeof args.exercise === 'string' ? args.exercise : null,
    reviewBudget: args['review-budget'],
    // TASK-AI-122 PI-R02: --approval accepts several comma-separated ids, one
    // per reviewed commit. PI-R03: the draft title comes from each item's own
    // spec at publish time, never from specs[0] or the run-level goal.
    publication: args.publish
      ? {
          approvalIds: String(args.approval || '')
            .split(',')
            .map((id) => id.trim())
            .filter(Boolean),
          expiry: args['approval-expiry'] ? Date.parse(args['approval-expiry']) : undefined,
          remoteUrl: args['remote-url'],
          branch: typeof args.branch === 'string' ? args.branch : null,
          draft: {},
        }
      : null,
    autoMerge: Boolean(args['auto-merge'] || args.merge),
    mergeConfig: args['merge-config'] || args.config,
    out,
    ...(d && d.now !== undefined ? { now: d.now } : {}),
  })
    .then((result) => {
      if (result.status !== 'COMPLETED' && result.status !== 'PUBLISHED_DRAFT') {
        for (const entry of result.outcomes || []) {
          if (entry.reason)
            console.error(decisionsApi.scrubText(`${entry.workItemId}: ${entry.reason}`));
        }
      }
      log(
        JSON.stringify(
          {
            goal,
            status: result.status,
            plan: result.plan,
            refusal: result.refusal || null,
            reconciliation: result.reconciliation,
            publication: result.publication,
          },
          null,
          2
        )
      );
      if (out) log('Wrote run log to ' + out);
      const exitCode = result.status === 'COMPLETED' || result.status === 'PUBLISHED_DRAFT' ? 0 : 1;
      exit(exitCode);
      return Object.assign({ exitCode }, result);
    })
    .catch((err) => {
      console.error(
        'Orchestrate lỗi: ' +
          (err && err.name ? err.name + ': ' : '') +
          (err && err.message ? err.message : err)
      );
      exit(1);
      return { exitCode: 1, error: err };
    });
}

function tokenReportCommand(args, deps = {}) {
  const fsx = (deps && deps.fs) || require('fs');
  const dir = typeof args.dir === 'string' ? args.dir : path.join(__dirname, '..', 'data', 'usage');
  const records = [];
  const decisionsDir = typeof args['decision-dir'] === 'string' ? args['decision-dir'] : null;
  if (decisionsDir && fsx.existsSync(decisionsDir)) {
    const decisionLog = require('../decisions');
    for (const name of decisionLog.decisionFiles(decisionsDir)) {
      for (const { line } of decisionLog.decisionLines(path.join(decisionsDir, name), fsx)) {
        try {
          const row = JSON.parse(line);
          if (!row.tokenUsage) continue;
          records.push({
            workItem: row.workItemId || 'unknown',
            model: row.model || 'unknown',
            input: Number(row.tokenUsage.input || 0),
            cacheRead: Number(row.tokenUsage.cacheRead || 0),
            output: Number(row.tokenUsage.output || 0),
          });
        } catch (_) {
          /* Ignore a truncated final line. */
        }
      }
    }
  }
  function visit(folder) {
    if (!fsx.existsSync(folder)) return;
    for (const name of fsx.readdirSync(folder)) {
      const file = path.join(folder, name);
      let stat;
      try {
        stat = fsx.statSync(file);
      } catch (_) {
        continue;
      }
      if (stat.isDirectory()) visit(file);
      else if (name.endsWith('.json')) {
        try {
          const row = JSON.parse(fsx.readFileSync(file, 'utf8'));
          const usage = row.usage || row;
          records.push({
            workItem: row.workItemId || row.work_item_id || name.replace(/-\\d+.*$/, ''),
            model: row.model || row.modelId || 'unknown',
            input: Number(usage.input_tokens ?? usage.input ?? 0) || 0,
            cacheRead:
              Number(usage.cache_read_tokens ?? usage.cacheRead ?? usage.cache_read ?? 0) || 0,
            output: Number(usage.output_tokens ?? usage.output ?? 0) || 0,
          });
        } catch (_) {
          /* Ignore incomplete session exports. */
        }
      }
    }
  }
  visit(dir);
  const totals = new Map();
  for (const row of records) {
    for (const group of ['model', 'workItem']) {
      const key = row[group];
      const current = totals.get(group + ':' + key) || {
        group,
        key,
        input: 0,
        cacheRead: 0,
        output: 0,
        sessions: 0,
      };
      current.input += row.input;
      current.cacheRead += row.cacheRead;
      current.output += row.output;
      current.sessions += 1;
      totals.set(group + ':' + key, current);
    }
  }
  const report = { records: records.length, totals: [...totals.values()] };
  if (args.json) (deps.log || console.log)(JSON.stringify(report, null, 2));
  else {
    (deps.log || console.log)('Token usage (' + records.length + ' sessions)');
    for (const row of report.totals)
      (deps.log || console.log)(
        row.group +
          ' ' +
          row.key +
          ': input=' +
          row.input +
          ' cache-read=' +
          row.cacheRead +
          ' output=' +
          row.output +
          ' sessions=' +
          row.sessions
      );
  }
  return report;
}

async function mergeCommand(args) {
  const workItemId = args['work-item'] || args.workItem || args.w;
  if (!workItemId || typeof workItemId !== 'string') {
    console.error('Lỗi: merge yêu cầu cờ --work-item <ID>');
    process.exitCode = 2;
    return { exitCode: 2, error: 'Thiếu --work-item' };
  }

  const { governedMerge } = require('../governed-merge');
  const repoCwd = args['repo-cwd'] || args.root || process.cwd();
  const decisionDir = args['decision-dir'] || args.decisionDir;
  const configPath = args.config || args['config-path'];
  const manifestPath = args.manifest || args['manifest-path'];
  const artifactPath = args.artifact || args['artifact-path'];
  const repo = args.repo;

  try {
    const res = await governedMerge({
      workItemId,
      repoCwd,
      decisionDir,
      configPath,
      manifestPath,
      artifactPath,
      repo,
    });

    if (args.json) {
      console.log(JSON.stringify(res, null, 2));
    } else if (res.ok) {
      console.log(
        `Đã merge thành công ${workItemId} tại exact HEAD ${res.headSha} (merge commit: ${res.mergeCommitOid || 'squash'})`
      );
    } else {
      console.error(`Từ chối merge ${workItemId}: ${res.refusal} (${res.reason})`);
    }

    if (!res.ok) {
      process.exitCode = 1;
    }
    return { exitCode: res.ok ? 0 : 1, result: res };
  } catch (err) {
    console.error('Lỗi khi merge: ' + (err && err.message ? err.message : err));
    process.exitCode = 1;
    return { exitCode: 1, error: err };
  }
}

/**
 * intake (TASK-AI-131): one command turns a Work Item ID into a full Controller
 * run with no hand-written inputs —
 *   node tools/ai-brain/cli.js intake --work-item <ID> [--run] [--publish]
 *
 * Every orchestrate input (goal, specs, catalogue, accounts) is built from
 * repository sources only and written to tools/ai-brain/data/intake/<ID>-<ts>/.
 * The orchestrate command comes from policy. Without --run it prints the exact
 * command and the inputs dir; with --run it checks the isolation pre-flight and
 * starts orchestrate. It never invents product meaning: a missing or ambiguous
 * source refuses with INTAKE_INCOMPLETE naming what is missing.
 */
function intakeCommand(args, deps = {}) {
  const d = deps || {};
  const log = d.log || console.log;
  const error = d.error || console.error;
  const exit = d.exit || process.exit;
  const { runIntake } = d.runIntake ? d : require('../intake');

  const workItem = typeof args['work-item'] === 'string' ? args['work-item'] : null;
  const run = Boolean(args.run);
  const publish = Boolean(args.publish);
  const wait = Boolean(args.wait);
  const externalWorkers = args['external-workers'] || args.externalWorkers;

  return Promise.resolve()
    .then(() =>
      runIntake({ workItem, run, publish, wait, externalWorkers }, { liveDiscovery: true, ...d })
    )
    .then((result) => {
      for (const warning of result.warnings || []) {
        log('CẢNH catalogue source ' + warning.source + ': ' + warning.error);
      }
      if (run) {
        log('Inputs dir: ' + result.runDir);
        log('Started orchestrate with ' + result.command);
        if (wait && typeof result.exitCode === 'number' && result.exitCode !== 0) {
          if (result.stderrTail) error(result.stderrTail);
          if (exit === process.exit) process.exitCode = result.exitCode;
          else exit(result.exitCode);
        }
        return result;
      }
      log('Inputs dir: ' + result.runDir);
      log('Command: ' + result.command);
      return result;
    })
    .catch((err) => {
      error((err && err.code ? err.code + ': ' : '') + ((err && err.message) || err));
      const code = err && err.code === 'INTAKE_INCOMPLETE' ? 2 : 1;
      if (exit === process.exit) process.exitCode = code;
      else exit(code);
      return { exitCode: code, error: err };
    });
}

function planCommand(args, deps = {}) {
  const id = args['work-item'] || args.workItem;
  if (typeof id !== 'string' || !id.trim()) {
    const error = new Error('plan requires --work-item <ID>');
    error.code = 'PLAN_INVALID_ID';
    return Promise.reject(error);
  }
  const planner = require('../work-item-planner');
  const rootDir = args.root || process.cwd();
  const planningDeps = deps.__planningDepsReady
    ? deps
    : planner.defaultPlanningDeps(rootDir, deps.planningDeps || deps);
  return Promise.resolve(
    planner.planWorkItem(
      id.trim(),
      {
        rootDir,
        run: Boolean(args.run),
      },
      planningDeps
    )
  );
}

module.exports = {
  reviewCommand,
  reviewPrCommand,
  orchestrateCommand,
  tokenReportCommand,
  mergeCommand,
  intakeCommand,
  planCommand,
};
