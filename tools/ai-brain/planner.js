'use strict';

/**
 * Ship Dễ — Goal planner (TASK-AI-60, dry-run level).
 *
 * Turns a user goal plus work-item specs into a validated plan. The plan is a
 * DAG of work items; every item carries a capability requirement, never a
 * model, provider or account. The Controller (TASK-AI-58) remains the only
 * component that selects a candidate; this module never does.
 *
 * Validation, fail-closed:
 *   - a dependency on an unknown id is an error;
 *   - a dependency cycle is an error (DFS over the dependency edges);
 *   - two work items claiming the same file is an error (one writer per file).
 */

const ROLE_CAPABILITIES = Object.freeze({
  'planner.default': { jsonSchema: true, tools: false, minContext: 128000 },
  'author.foundation': { jsonSchema: true, tools: true, minContext: 200000 },
  'author.lowrisk': { jsonSchema: true, tools: true, minContext: 64000 },
  'reviewer.primary': { jsonSchema: true, tools: true, minContext: 200000 },
  'analyst.default': { jsonSchema: false, tools: true, minContext: 128000 },
});

function roleRequirementFor(spec) {
  const role = spec && spec.role ? spec.role : 'author.foundation';
  const base = ROLE_CAPABILITIES[role] || ROLE_CAPABILITIES['author.foundation'];
  return {
    role,
    requires: Object.assign({}, base),
    riskDomains: Array.isArray(spec.riskDomains) ? spec.riskDomains.slice() : [],
  };
}

/** Returns the first dependency cycle as an array of ids, or null. */
function findCycle(specs) {
  const byId = new Map((specs || []).map((s) => [s.id, s]));
  const state = new Map(); // 0=unvisited 1=visiting 2=done
  const path = [];

  function dfs(id) {
    const st = state.get(id);
    if (st === 1) {
      // id is already on the current path -> cycle; trim to the cycle tail.
      const idx = path.indexOf(id);
      return path.slice(idx).concat(id);
    }
    if (st === 2) return null;
    state.set(id, 1);
    path.push(id);
    const spec = byId.get(id);
    for (const dep of (spec && spec.dependencies) || []) {
      if (!byId.has(dep)) continue;
      const c = dfs(dep);
      if (c) return c;
    }
    path.pop();
    state.set(id, 2);
    return null;
  }

  for (const spec of specs || []) {
    if (state.get(spec.id) === undefined) {
      const c = dfs(spec.id);
      if (c) return c;
    }
  }
  return null;
}

/**
 * @param goal  the user goal (text or null)
 * @param opts  { specs: [{id, role?, dependencies?, files?, allowedPaths?,
 *                 acceptanceCriteria?, verification?, riskDomains?,
 *                 checkpointPolicy?, rollback?}] }
 * @returns { goal, workItems, errors }
 */
function plan(goal, opts) {
  const o = opts || {};
  const specs = Array.isArray(o.specs) ? o.specs : Array.isArray(o.workItems) ? o.workItems : [];
  const errors = [];
  const ids = new Set(specs.map((s) => s && s.id));

  for (const spec of specs) {
    for (const dep of (spec && spec.dependencies) || []) {
      if (!ids.has(dep)) errors.push('UNKNOWN_DEPENDENCY: ' + spec.id + ' -> ' + dep);
    }
  }

  const cycle = findCycle(specs);
  if (cycle) errors.push('DEPENDENCY_CYCLE: ' + cycle.join(' -> '));

  const owner = new Map();
  for (const spec of specs) {
    for (const file of (spec && spec.files) || []) {
      if (owner.has(file) && owner.get(file) !== spec.id) {
        errors.push('FILE_OWNED_TWICE: ' + file + ' (' + owner.get(file) + ', ' + spec.id + ')');
      }
      owner.set(file, spec.id);
    }
  }

  const workItems = [];
  if (errors.length === 0) {
    for (const spec of specs) {
      workItems.push({
        id: spec.id,
        title: spec.title || null,
        businessOutcome: spec.businessOutcome || spec.outcome || null,
        roleRequirement: roleRequirementFor(spec),
        dependencies: (spec.dependencies || []).slice(),
        allowedPaths: (spec.allowedPaths || spec.files || []).slice(),
        fileOwnership: (spec.files || []).slice(),
        acceptanceCriteria: (spec.acceptanceCriteria || []).slice(),
        // AI-64-R06: a plan states the command that proves the item and the
        // result it must produce. There is no default here: a work item with no
        // verification command is not dispatchable, and assuming `node --test`
        // would let a live run "verify" an item with a command nobody chose.
        verification: spec.verification || null,
        riskDomains: (spec.riskDomains || []).slice(),
        checkpointPolicy: spec.checkpointPolicy || 'resume-by-work-item',
        rollback: spec.rollback || 'discard-branch',
      });
    }
  }

  return { goal: goal || null, workItems, errors };
}

module.exports = { plan, findCycle, ROLE_CAPABILITIES };
