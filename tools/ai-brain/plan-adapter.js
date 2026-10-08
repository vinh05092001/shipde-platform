'use strict';

/**
 * Ship Dễ — Plan adapter (TASK-AI-109, lane B).
 *
 * Turns a writing-plans style markdown plan (Goal; Context; Approach; tasks
 * with exact file paths, tests and commands; Risks) into ShipDe Work Item
 * specs in the shape planner.plan accepts.
 *
 * Pure: no I/O, no network, no model calls. Input is never mutated.
 *
 * Fail-closed:
 *   - PLAN_PARSE_ERROR      a plan with no tasks, or a duplicate task number;
 *   - MISSING_IDS           neither opts.ids nor opts.idPrefix was given;
 *   - ID_COUNT_MISMATCH     opts.ids does not name every task exactly once;
 *   - UNKNOWN_DEPENDENCY    "Depends on: Task N" names a task not in the plan;
 *   - OWNERSHIP_CONFLICT    two tasks claim one file and neither depends on the other;
 *   - MISSING_VERIFICATION  a task has no command that can prove it (TDD gate).
 */

const SHIPDE_FORBIDDEN = Object.freeze([
  'no push',
  'no merge',
  'no branch or worktree deletion',
  'no model selection',
  'no deleting uncommitted work',
]);

const DEFAULT_REPAIR_BUDGET = 2;
const DEFAULT_ROLE = 'author.foundation';

const TASK_HEADING = /^#{2,3}\s+Task\s+(\d+)\b\s*[:.\-–—]?\s*(.*)$/i;
const ANY_HEADING = /^#{1,3}\s+(.*)$/;
const FENCE = /^\s*(`{3,}|~{3,})\s*([\w-]*)\s*$/;
const SHELL_FENCES = new Set([
  '',
  'bash',
  'sh',
  'shell',
  'zsh',
  'console',
  'powershell',
  'pwsh',
  'cmd',
]);
const LABEL = /^\s*(?:[-*]\s+)?(?:\*\*)?([A-Za-z ]+?)(?:\*\*)?\s*:(?:\*\*)?\s*(.*)$/;
const BULLET = /^\s*(?:[-*+]|\d+[.)])\s+(.+)$/;
const BACKTICK = /`([^`]+)`/g;
const PATH_TOKEN = /^[\w@.\-/\\[\]()]+$/;
const TEST_FILE = /(\.(test|spec)\.[A-Za-z0-9]+$)|((^|\/)(test|tests|__tests__|e2e)\/)/;
const TEST_COMMAND =
  /\b(test|tests|vitest|jest|mocha|playwright|pytest|spec)\b|--test\b|\.(test|spec)\./i;

function fail(code, message) {
  const err = new Error(code + ': ' + message);
  err.name = code;
  err.code = code;
  return err;
}

function backticked(text) {
  return [...String(text).matchAll(BACKTICK)].map((m) => m[1].trim()).filter(Boolean);
}

function looksLikePath(token) {
  if (!PATH_TOKEN.test(token) || token.startsWith('-')) return false;
  return token.includes('/') || /\.[A-Za-z0-9]+$/.test(token);
}

function pushUnique(list, value) {
  if (!list.includes(value)) list.push(value);
}

function labelOf(line) {
  const m = LABEL.exec(line);
  if (!m) return null;
  return { label: m[1].trim().toLowerCase(), rest: m[2] };
}

function stripBold(text) {
  return String(text)
    .replace(/^\*\*|\*\*$/g, '')
    .trim();
}

function parseTaskBody(lines) {
  const task = { files: [], tests: [], commands: [], dependsOn: [], criteria: [], riskDomains: [] };
  let fence = null;
  for (const line of lines) {
    const f = FENCE.exec(line);
    if (fence) {
      if (f && f[1][0] === fence.marker[0] && f[1].length >= fence.marker.length && !f[2]) {
        fence = null;
        continue;
      }
      if (fence.shell) {
        const cmd = line.trim().replace(/^\$\s+/, '');
        if (cmd && !cmd.startsWith('#')) pushUnique(task.commands, cmd);
      }
      continue;
    }
    if (f) {
      fence = { marker: f[1], shell: SHELL_FENCES.has(f[2].toLowerCase()) };
      continue;
    }

    const labelled = labelOf(line);
    const label = labelled && labelled.label;
    if (label === 'run' || label === 'command' || label === 'commands' || label === 'verify') {
      for (const cmd of backticked(labelled.rest)) pushUnique(task.commands, cmd);
      continue;
    }
    if (label === 'depends on' || label === 'depends' || label === 'dependencies') {
      for (const m of labelled.rest.matchAll(/Task\s+(\d+)/gi)) {
        const n = Number(m[1]);
        if (!task.dependsOn.includes(n)) task.dependsOn.push(n);
      }
      continue;
    }
    if (label === 'risk' || label === 'risks') {
      for (const d of labelled.rest.split(/[,;]/)) {
        const domain = stripBold(d.replace(/`/g, ''));
        if (domain) pushUnique(task.riskDomains, domain);
      }
      continue;
    }

    for (const token of backticked(line)) {
      if (looksLikePath(token)) pushUnique(task.files, token.replace(/\\/g, '/'));
    }

    if (label === 'files' || label === 'file') continue;
    const bullet = BULLET.exec(line);
    if (bullet) pushUnique(task.criteria, bullet[1].trim());
  }
  for (const file of task.files) {
    if (TEST_FILE.test(file)) task.tests.push(file);
  }
  return task;
}

function sectionBullets(lines) {
  const out = [];
  for (const line of lines) {
    const b = BULLET.exec(line);
    if (b) out.push(b[1].trim());
  }
  return out;
}

/**
 * @param markdown  a writing-plans style plan
 * @returns {goal, tasks:[{number, title, files[], tests[], commands[], dependsOn[],
 *           criteria[], riskDomains[]}], risks[]}
 */
function parsePlan(markdown) {
  if (typeof markdown !== 'string' || !markdown.trim()) {
    throw fail('PLAN_PARSE_ERROR', 'the plan is empty');
  }
  const lines = markdown.split(/\r?\n/);
  const sections = [];
  let current = { kind: 'preamble', heading: '', lines: [] };
  let fenced = false;
  for (const line of lines) {
    if (FENCE.test(line)) fenced = !fenced;
    const heading = !fenced && ANY_HEADING.exec(line);
    if (heading) {
      sections.push(current);
      const t = TASK_HEADING.exec(line);
      current = t
        ? { kind: 'task', number: Number(t[1]), title: t[2].trim(), lines: [] }
        : { kind: 'section', heading: heading[1].trim().toLowerCase(), lines: [] };
      continue;
    }
    current.lines.push(line);
  }
  sections.push(current);

  let goal = null;
  for (const line of lines) {
    const m = /^\s*(?:[-*]\s+)?(?:\*\*)?Goal(?:\*\*)?\s*:(?:\*\*)?\s*(.+)$/i.exec(line);
    if (m) {
      goal = stripBold(m[1]);
      break;
    }
  }
  if (!goal) {
    const s = sections.find((x) => x.kind === 'section' && x.heading === 'goal');
    const first = s && s.lines.find((l) => l.trim());
    if (first) goal = first.trim();
  }

  const tasks = [];
  const seen = new Set();
  for (const s of sections) {
    if (s.kind !== 'task') continue;
    if (seen.has(s.number)) throw fail('PLAN_PARSE_ERROR', 'duplicate Task ' + s.number);
    seen.add(s.number);
    const body = parseTaskBody(s.lines);
    tasks.push(Object.assign({ number: s.number, title: s.title || 'Task ' + s.number }, body));
  }
  if (tasks.length === 0) {
    throw fail('PLAN_PARSE_ERROR', 'no "## Task N" or "### Task N" heading found');
  }

  const risks = [];
  for (const s of sections) {
    if (s.kind === 'section' && /^risks?\b/.test(s.heading)) risks.push(...sectionBullets(s.lines));
  }

  return { goal, tasks, risks };
}

function assignIds(tasks, o) {
  if (Array.isArray(o.ids) && o.ids.length > 0) {
    const unique = new Set(o.ids);
    if (o.ids.length !== tasks.length || unique.size !== o.ids.length) {
      throw fail(
        'ID_COUNT_MISMATCH',
        tasks.length + ' tasks need ' + tasks.length + ' distinct ids, got ' + o.ids.length
      );
    }
    return o.ids.slice();
  }
  if (typeof o.idPrefix === 'string' && o.idPrefix) {
    return tasks.map((t) => o.idPrefix + '-' + t.number);
  }
  throw fail('MISSING_IDS', 'pass opts.ids or opts.idPrefix; ids are never invented');
}

function ancestorsOf(number, byNumber) {
  const out = new Set();
  const stack = [...(byNumber.get(number).dependsOn || [])];
  while (stack.length) {
    const n = stack.pop();
    if (out.has(n) || !byNumber.has(n)) continue;
    out.add(n);
    stack.push(...byNumber.get(n).dependsOn);
  }
  return out;
}

function chooseVerification(task) {
  const command = task.commands.find((c) => TEST_COMMAND.test(c)) || task.commands[0] || null;
  return command ? { command } : null;
}

/**
 * @param plan  the result of parsePlan
 * @param opts  { ids?: string[], idPrefix?: string, role?, repairBudget?, forbidden?: string[] }
 * @returns specs for planner.plan
 */
function toWorkItemSpecs(plan, opts) {
  const o = opts || {};
  const tasks = (plan && Array.isArray(plan.tasks) && plan.tasks) || [];
  if (tasks.length === 0) throw fail('PLAN_PARSE_ERROR', 'the plan has no tasks');

  const ids = assignIds(tasks, o);
  const idOf = new Map(tasks.map((t, i) => [t.number, ids[i]]));
  const byNumber = new Map(tasks.map((t) => [t.number, t]));

  for (const t of tasks) {
    for (const dep of t.dependsOn || []) {
      if (!byNumber.has(dep)) {
        throw fail('UNKNOWN_DEPENDENCY', 'Task ' + t.number + ' depends on missing Task ' + dep);
      }
    }
    if (!chooseVerification(t)) {
      throw fail(
        'MISSING_VERIFICATION',
        'Task ' + t.number + ' (' + t.title + ') declares no test or verification command'
      );
    }
  }

  const ancestors = new Map(tasks.map((t) => [t.number, ancestorsOf(t.number, byNumber)]));
  const claimants = new Map();
  for (const t of tasks) {
    for (const file of t.files || []) {
      if (!claimants.has(file)) claimants.set(file, []);
      claimants.get(file).push(t.number);
    }
  }
  const owner = new Map();
  for (const [file, numbers] of claimants) {
    for (let i = 0; i < numbers.length; i++) {
      for (let j = i + 1; j < numbers.length; j++) {
        const a = numbers[i];
        const b = numbers[j];
        if (!ancestors.get(a).has(b) && !ancestors.get(b).has(a)) {
          throw fail(
            'OWNERSHIP_CONFLICT',
            file +
              ' is claimed by Task ' +
              a +
              ' and Task ' +
              b +
              ' and neither depends on the other'
          );
        }
      }
    }
    const root = numbers.find((n) => numbers.every((m) => m === n || ancestors.get(m).has(n)));
    owner.set(file, root);
  }

  const forbidden = [];
  for (const f of [].concat(o.forbidden || [], SHIPDE_FORBIDDEN)) pushUnique(forbidden, f);
  const repairBudget =
    Number.isInteger(o.repairBudget) && o.repairBudget >= 0
      ? o.repairBudget
      : DEFAULT_REPAIR_BUDGET;
  const role = o.role || DEFAULT_ROLE;

  return tasks.map((t) => {
    const acceptanceCriteria = (t.criteria || []).slice();
    for (const test of t.tests || []) acceptanceCriteria.push('Test passes: ' + test);
    return {
      id: idOf.get(t.number),
      title: t.title,
      businessOutcome: (plan && plan.goal) || null,
      role,
      dependencies: (t.dependsOn || []).map((n) => idOf.get(n)),
      files: (t.files || []).filter((f) => owner.get(f) === t.number),
      allowedPaths: (t.files || []).slice(),
      acceptanceCriteria,
      verification: chooseVerification(t),
      riskDomains: (t.riskDomains || []).slice(),
      repairBudget,
      forbidden: forbidden.slice(),
    };
  });
}

module.exports = { parsePlan, toWorkItemSpecs, SHIPDE_FORBIDDEN };
