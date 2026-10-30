'use strict';

/**
 * Worker-side verification runs only checks that need no external services.
 * Scripts that need PostgreSQL, Redis or object storage are listed in
 * sources.json (dispatch.verification.infraDependentScripts) and are deferred
 * to GitHub CI, which is the final verification for the exact head SHA.
 * Nothing here weakens a gate: a deferred script still has to be green in CI
 * before the item is complete (see ci-gate.js).
 */

const fs = require('fs');
const path = require('path');

function verificationConfig(dispatch) {
  const d = dispatch || require('./sources.json').dispatch || {};
  const v = d.verification || {};
  const list = (x) => (Array.isArray(x) ? x.map(String) : []);
  return {
    infraDependentScripts: list(v.infraDependentScripts),
    infraFreeSupplements: list(v.infraFreeSupplements),
  };
}

function packageScripts(cwd) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
    return pkg && pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
  } catch (_) {
    return {};
  }
}

const SEGMENT = /^\s*pnpm\s+(?:run\s+)?([A-Za-z0-9:_.-]+)\s*$/;

/**
 * @returns { command, deferred: string[], added: string[] }
 */
function deriveInfraFreeCommand(command, options) {
  const o = options || {};
  const cfg = o.config || verificationConfig(o.dispatch);
  const scripts = o.scripts || packageScripts(o.cwd || process.cwd());
  const deferredSet = new Set(cfg.infraDependentScripts);
  const kept = [];
  const deferred = [];
  const present = new Set();
  for (const segment of String(command || '').split('&&')) {
    const m = SEGMENT.exec(segment);
    if (m && deferredSet.has(m[1])) {
      deferred.push(m[1]);
      continue;
    }
    if (m) present.add(m[1]);
    if (segment.trim()) kept.push(segment.trim());
  }
  const added = [];
  if (deferred.length > 0) {
    for (const name of cfg.infraFreeSupplements) {
      if (scripts[name] && !present.has(name) && !deferredSet.has(name)) {
        kept.push('pnpm ' + name);
        added.push(name);
      }
    }
  }
  return { command: kept.join(' && '), deferred, added };
}

module.exports = { verificationConfig, deriveInfraFreeCommand };
