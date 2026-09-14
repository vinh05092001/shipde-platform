'use strict';

/**
 * Ship Dễ — Ecosystem Manifest Audit
 *
 * The manifest calls itself the machine-readable source of truth for 37
 * repositories. Nothing had ever checked it, and reading it is cheaper than
 * verifying it, which is exactly the condition under which a record drifts.
 *
 * Three drifts are already known and this exists so they stop being discovered
 * by accident: entries declared INSTALLED with nothing on disk, an entry whose
 * described role does not match the repository, and an entry pinned to a
 * 40-character commit for a repository that does not exist.
 *
 * Same severity rule as the register reconciler. Overstatement is an error
 * because a gate believed to be running and absent is worse than one openly
 * missing; understatement is a warning; an incomplete record is a note.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

/**
 * Command names that differ from the manifest id. Without this the audit
 * reports false absences, which would train the operator to ignore it.
 */
const BINARY_ALIASES = {
  'nine-router': '9router',
  'claude-code': 'claude',
  'codex-cli': 'codex',
  'gemini-cli': 'gemini',
  'deepseek-harness': 'dsh',
  context7: 'ctx7',
  promptfoo: 'pf',
  'docker-compose': 'docker',
  'antigravity-cli': 'agy',
  'playwright-cli': 'playwright-cli',
  'renovate-config-validator': 'renovate',
};

/** npm package names for entries installed as dev dependencies. */
const PACKAGE_ALIASES = {
  'lighthouse-ci': '@lhci/cli',
  'opentelemetry-js': '@opentelemetry/api',
  'openapi-typescript': 'openapi-typescript',
  'axe-core': 'axe-core',
  'token-tracker': 'tokentracker',
  msw: 'msw',
  storybook: 'storybook',
  lefthook: 'lefthook',
};

const INSTALL_KINDS = {
  WORKSPACE: 'workspace',
  NPM_GLOBAL: 'npm-global',
  NPM_DEV: 'npm-dev',
  SYSTEM: 'system',
  CI: 'ci-provisioned',
  PIP: 'pip',
  NPX: 'npx-on-demand',
  SNAPSHOT: 'pinned-snapshot',
};

function onPath(name) {
  try {
    execFileSync(process.platform === 'win32' ? 'where' : 'which', [name], {
      stdio: 'ignore',
      timeout: 5000,
    });
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Whether a CI workflow installs this tool.
 *
 * `where`/`which` asks one machine — this one — and a tool provisioned by the
 * CI runner is invisible to it. That is not a hypothetical: gitleaks is
 * installed at the pinned version by two workflows and enforced as a blocking
 * gate on every Pull Request, while the local probe reported it missing. The
 * audit then raised QUALITY_GATE_MISSING against a gate that was, at that
 * moment, running.
 *
 * Worse than the false positive was where it pointed. A record that disagrees
 * with a check is normally the record's fault, so the finding invited someone
 * to downgrade a live blocking gate to PENDING — which is exactly what
 * happened, and it made the manifest understate reality in the one direction
 * this audit exists to prevent.
 *
 * So a CI-provisioned tool is verified where it actually lives: in the
 * workflow that installs it.
 */
function inCiWorkflows(name, rootDir) {
  const dir = path.join(rootDir, '.github', 'workflows');
  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => /\.ya?ml$/i.test(f));
  } catch (e) {
    return null; // No workflows readable here; unverifiable, not absent.
  }
  // The id is escaped before it reaches the RegExp. Only gitleaks uses this
  // path today, but an id carrying a regex metacharacter would either misread
  // or throw -- and an exception here takes the whole audit run down with it.
  const safe = String(name).replace(/[-\/\^$*+?.()|[\]{}]/g, '\\$&');
  const pattern = new RegExp(
    '(install|download|setup|curl|apt-get|brew)[^\n]*\\b' + safe + '\\b',
    'i'
  );
  for (const f of files) {
    try {
      if (pattern.test(fs.readFileSync(path.join(dir, f), 'utf8'))) return true;
    } catch (e) {
      /* an unreadable workflow is not evidence of absence */
    }
  }
  return false;
}

/** Every dependency declared anywhere in the workspace. */
function workspaceDependencies(rootDir) {
  const files = [
    'package.json',
    'apps/api/package.json',
    'apps/worker/package.json',
    'apps/web/package.json',
    'packages/config/package.json',
    'packages/contracts/package.json',
    'packages/testkit/package.json',
    'packages/ui/package.json',
  ];
  const deps = new Set();
  for (const rel of files) {
    try {
      const json = JSON.parse(fs.readFileSync(path.join(rootDir, rel), 'utf8'));
      for (const key of ['dependencies', 'devDependencies']) {
        for (const name of Object.keys(json[key] || {})) deps.add(name);
      }
    } catch (e) {
      /* a workspace without that package is not an audit finding */
    }
  }
  return deps;
}

function pinString(entry) {
  return String((entry && entry.pinned_version_or_commit) || '').trim();
}

function finding(severity, code, entry, message, evidence) {
  return {
    severity,
    code,
    id: entry.id,
    lifecycle: entry.lifecycle_state,
    install: entry.install_method,
    message,
    evidence: evidence || null,
  };
}

const SHA_RE = /^[0-9a-f]{40}$/i;

/**
 * @param manifest parsed ecosystem-manifest.json
 * @param deps     { rootDir, onPath, dependencies, repoExists }
 */
function auditManifest(manifest, deps) {
  const opts = deps || {};
  const rootDir = opts.rootDir || process.cwd();
  const has = opts.onPath || onPath;
  const dependencies = opts.dependencies || workspaceDependencies(rootDir);
  // Repository existence needs the network, so it is injected: the audit stays
  // useful offline and reports "unverified" rather than guessing.
  const repoExists = opts.repoExists || (() => null);

  const findings = [];
  const rows = [];

  for (const entry of manifest.adopted || []) {
    const id = entry.id;
    const state = entry.lifecycle_state;
    const install = entry.install_method;
    let present = null;
    let how = '';

    if (install === INSTALL_KINDS.NPM_GLOBAL || install === INSTALL_KINDS.SYSTEM) {
      const alias = BINARY_ALIASES[id] || id;
      present = has(alias);
      how = 'lệnh "' + alias + '"';
    } else if (install === INSTALL_KINDS.NPM_DEV) {
      const pkg = PACKAGE_ALIASES[id] || id;
      present = [...dependencies].some((d) => d === pkg || d.startsWith(pkg + '/'));
      how = 'dependency "' + pkg + '"';
    } else if (install === INSTALL_KINDS.CI) {
      const alias = BINARY_ALIASES[id] || id;
      present = inCiWorkflows(alias, rootDir);
      how = 'workflow CI cài "' + alias + '"';
    } else if (install === INSTALL_KINDS.PIP) {
      present = has(BINARY_ALIASES[id] || id);
      how = 'lệnh pip';
    } else if (install === INSTALL_KINDS.WORKSPACE) {
      // This used to test for rootDir/package.json, which is true whenever the
      // audit runs at all — so every workspace entry read as present, whether
      // it existed or not. shipde-brain has never been created (TASK-AI-21
      // creates it) and still reported present.
      //
      // A workspace entry names a checkout: this repository, or a sibling of
      // it. Look for that, which is what the entries' own health_check strings
      // already say ("Test-Path ../shipde-brain").
      // Identify this checkout by its manifest name rather than its directory
      // name: a git worktree lives under a generated path, so the directory
      // name is not the repository's name.
      let here = false;
      try {
        here = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8')).name === id;
      } catch (e) {
        /* no readable manifest here; fall back to the sibling check */
      }
      const sibling = fs.existsSync(path.join(rootDir, '..', id));
      present = here || sibling;
      how = 'thư mục làm việc "' + id + '"';
    } else {
      // npx-on-demand and pinned-snapshot are fetched when used; absence is
      // the designed state, not a finding.
      present = null;
      how = install;
    }

    rows.push({ id, state, install, present, how });

    // --- Overstatement: declared in use, absent in fact -------------------
    if ((state === 'INSTALLED' || state === 'INTEGRATED') && present === false) {
      findings.push(
        finding(
          'error',
          'DECLARED_INSTALLED_BUT_ABSENT',
          entry,
          'Khai là ' + state + ' nhưng không tìm thấy trên máy (' + how + ').'
        )
      );
    } else if (state === 'ADOPTED' && present === false) {
      // ADOPTED means accepted for use. A quality gate accepted but absent is
      // the dangerous case: the pipeline believes it is being checked.
      const isGate = /scan|leak|trivy|lefthook|axe|lint|audit/i.test(id + ' ' + (entry.role || ''));
      findings.push(
        finding(
          isGate ? 'error' : 'warn',
          isGate ? 'QUALITY_GATE_MISSING' : 'DECLARED_ADOPTED_BUT_ABSENT',
          entry,
          'Khai ADOPTED nhưng không có trên máy (' +
            how +
            ')' +
            (isGate ? ' — đây là cổng chất lượng, nên đường dẫn tin là đang được kiểm.' : '.')
        )
      );
    }

    // --- A pin that no longer matches what is installed --------------------
    //
    // `observed_version_or_commit` was free text: someone wrote down what they
    // saw, and nothing ever compared it to the pin again. A hand-written note
    // drifts silently, which is the exact failure class this audit exists to
    // close — so the field is read rather than admired.
    //
    // It is a warning, not an error. Drift is a decision for the upgrade rule
    // to settle, and the audit's job is to make sure nobody has to notice it
    // by accident.
    const observed = String(entry.observed_version_or_commit || '').trim();
    if (observed && observed !== pinString(entry)) {
      findings.push(
        finding(
          'warn',
          'PINNED_VERSION_DRIFT',
          entry,
          'Pin là ' + pinString(entry) + ' nhưng bản quan sát được là ' + observed + '.',
          { pinned: pinString(entry), observed }
        )
      );
    }

    // --- Understatement: declared not in use, present in fact -------------
    //
    // Every rule above catches the manifest claiming more than is true. This
    // one catches the opposite, and it had no rule at all: PENDING produced no
    // finding under any condition, so moving an entry to PENDING removed it
    // from the audit's reach entirely. A run could therefore reach zero
    // findings by demoting records rather than by matching them to reality,
    // which is the failure this module exists to prevent, running backwards.
    //
    // It is a warning rather than an error because a tool present while
    // declared PENDING is not dangerous the way a missing gate is — nothing
    // trusts it yet. It is still wrong, and it hides a gate that is already
    // enforcing.
    if (state === 'PENDING' && present === true) {
      findings.push(
        finding(
          'warn',
          'DECLARED_PENDING_BUT_PRESENT',
          entry,
          'Khai PENDING nhưng thực tế đã có (' +
            how +
            ') — manifest đang khai thấp hơn thực tế; nâng lại trạng thái hoặc nói rõ vì sao chưa dùng.'
        )
      );
    }

    // --- A pin that cannot point anywhere ---------------------------------
    const pin = String(entry.pinned_version_or_commit || '');
    if (SHA_RE.test(pin)) {
      const exists = repoExists(entry.repository);
      if (exists === false) {
        findings.push(
          finding(
            'error',
            'PINNED_COMMIT_FOR_MISSING_REPO',
            entry,
            'Pin ở commit ' + pin.slice(0, 12) + '… nhưng repository không tồn tại.',
            { repository: entry.repository, pin }
          )
        );
      } else if (exists === null) {
        findings.push(
          finding('info', 'REPO_UNVERIFIED', entry, 'Chưa xác minh được repository (cần mạng).', {
            repository: entry.repository,
          })
        );
      }
    }

    // --- Incomplete records ----------------------------------------------
    if (!entry.repository) {
      findings.push(finding('error', 'NO_REPOSITORY', entry, 'Không khai repository.'));
    }
    if (!pin) {
      findings.push(
        finding(
          'warn',
          'NOT_PINNED',
          entry,
          'Không pin phiên bản hay commit; bản cài có thể trôi mà không ai biết.'
        )
      );
    }
    if (!entry.role) {
      findings.push(finding('info', 'NO_ROLE', entry, 'Không mô tả vai trò.'));
    }
    if (entry.blocking_policy === undefined) {
      findings.push(
        finding(
          'info',
          'NO_BLOCKING_POLICY',
          entry,
          'Không khai blocking_policy, nên không rõ vắng mặt có chặn dây chuyền hay không.'
        )
      );
    }
  }

  const counted = rows.filter((r) => r.present !== null);
  return {
    total: (manifest.adopted || []).length,
    checkable: counted.length,
    present: counted.filter((r) => r.present).length,
    absent: counted.filter((r) => !r.present).length,
    onDemand: rows.length - counted.length,
    rows,
    findings,
    summary: {
      error: findings.filter((f) => f.severity === 'error').length,
      warn: findings.filter((f) => f.severity === 'warn').length,
      info: findings.filter((f) => f.severity === 'info').length,
    },
    trustworthy: findings.every((f) => f.severity !== 'error'),
  };
}

module.exports = { auditManifest, workspaceDependencies, BINARY_ALIASES, PACKAGE_ALIASES };
