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
    } else if (install === INSTALL_KINDS.PIP) {
      present = has(BINARY_ALIASES[id] || id);
      how = 'lệnh pip';
    } else if (install === INSTALL_KINDS.WORKSPACE) {
      present = fs.existsSync(path.join(rootDir, 'package.json'));
      how = 'workspace';
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
        finding('error', 'DECLARED_INSTALLED_BUT_ABSENT', entry,
          'Khai là ' + state + ' nhưng không tìm thấy trên máy (' + how + ').')
      );
    } else if (state === 'ADOPTED' && present === false) {
      // ADOPTED means accepted for use. A quality gate accepted but absent is
      // the dangerous case: the pipeline believes it is being checked.
      const isGate = /scan|leak|trivy|lefthook|axe|lint|audit/i.test(id + ' ' + (entry.role || ''));
      findings.push(
        finding(isGate ? 'error' : 'warn',
          isGate ? 'QUALITY_GATE_MISSING' : 'DECLARED_ADOPTED_BUT_ABSENT',
          entry,
          'Khai ADOPTED nhưng không có trên máy (' + how + ')' +
            (isGate ? ' — đây là cổng chất lượng, nên đường dẫn tin là đang được kiểm.' : '.'))
      );
    }

    // --- A pin that cannot point anywhere ---------------------------------
    const pin = String(entry.pinned_version_or_commit || '');
    if (SHA_RE.test(pin)) {
      const exists = repoExists(entry.repository);
      if (exists === false) {
        findings.push(
          finding('error', 'PINNED_COMMIT_FOR_MISSING_REPO', entry,
            'Pin ở commit ' + pin.slice(0, 12) + '… nhưng repository không tồn tại.',
            { repository: entry.repository, pin })
        );
      } else if (exists === null) {
        findings.push(
          finding('info', 'REPO_UNVERIFIED', entry,
            'Chưa xác minh được repository (cần mạng).', { repository: entry.repository })
        );
      }
    }

    // --- Incomplete records ----------------------------------------------
    if (!entry.repository) {
      findings.push(finding('error', 'NO_REPOSITORY', entry, 'Không khai repository.'));
    }
    if (!pin) {
      findings.push(
        finding('warn', 'NOT_PINNED', entry,
          'Không pin phiên bản hay commit; bản cài có thể trôi mà không ai biết.')
      );
    }
    if (!entry.role) {
      findings.push(finding('info', 'NO_ROLE', entry, 'Không mô tả vai trò.'));
    }
    if (entry.blocking_policy === undefined) {
      findings.push(
        finding('info', 'NO_BLOCKING_POLICY', entry,
          'Không khai blocking_policy, nên không rõ vắng mặt có chặn dây chuyền hay không.')
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
