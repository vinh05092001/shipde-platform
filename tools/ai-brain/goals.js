'use strict';

/**
 * Ship Dễ — Goal Store and Controller Contract (TASK-AI-142 Part H1)
 *
 * Implements the goal store under data/goals/<goalId>/goal.json and the
 * controller contract for Hermes goal management:
 *   - goal start --text "<goal>"
 *   - goal amend <goalId> --text "<extra>"
 *   - goal plan <goalId> --file <plan.md>
 *   - goal run <goalId>
 *   - goal status <goalId>
 *   - goal stop <goalId>
 *   - goal resume <goalId>
 *
 * All output is JSON on stdout. Exit code != 0 on refusal.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { atomicRenameSync } = require('./atomic-rename');

const planAdapter = require('./plan-adapter');
const planner = require('./planner');
const decisions = require('./decisions');

const REGISTER_REL = path.join(
  'docs',
  'product-spec',
  'docs',
  '10-ai-collaboration',
  'FEATURE-DELIVERY-REGISTER.csv'
);
const WORK_ITEMS_REL = path.join('docs', 'product-spec', 'work-items');

function resolveRootDir(options) {
  if (options && (options.rootDir || options.root)) {
    return path.resolve(options.rootDir || options.root);
  }
  return process.cwd();
}

function resolveGoalsDir(rootDir, options) {
  if (options && (options.goalsDir || options['goals-dir'])) {
    return path.resolve(options.goalsDir || options['goals-dir']);
  }
  return path.join(rootDir, 'data', 'goals');
}

const VALID_GOAL_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function isValidGoalId(goalId) {
  if (typeof goalId !== 'string') return false;
  if (!VALID_GOAL_ID_PATTERN.test(goalId)) return false;
  if (goalId.includes('..') || goalId.includes('/') || goalId.includes('\\')) return false;
  return true;
}

function invalidGoalIdRefusal(goalId) {
  return {
    error: 'INVALID_GOAL_ID',
    message: `Invalid goalId: "${goalId}". Goal ID must contain only alphanumeric characters, underscores, and hyphens [A-Za-z0-9_-], and cannot contain path separators or "..".`,
    refusal: true,
  };
}

function resolveGoalDir(goalsDir, goalId) {
  if (!isValidGoalId(goalId)) {
    throw new Error(
      `Invalid goalId: "${goalId}". Goal ID must contain only [A-Za-z0-9_-] and cannot contain path separators or "..".`
    );
  }
  return path.join(goalsDir, String(goalId));
}

function resolveGoalFile(goalsDir, goalId) {
  return path.join(resolveGoalDir(goalsDir, goalId), 'goal.json');
}

function resolveLockFile(goalsDir, goalId) {
  return path.join(resolveGoalDir(goalsDir, goalId), 'run.lock');
}

function resolveStopFile(goalsDir, goalId) {
  return path.join(resolveGoalDir(goalsDir, goalId), '.stop');
}

function resolveGoalRegisterFile(goalsDir, goalId) {
  return path.join(resolveGoalDir(goalsDir, goalId), 'register.csv');
}

function isPidAlive(pid) {
  if (!pid || typeof pid !== 'number') return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err && err.code === 'EPERM';
  }
}

function writeJsonAtomic(filePath, data, options) {
  const fsApi = (options && options.fs) || fs;
  fsApi.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = filePath + '.tmp';
  fsApi.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  atomicRenameSync(tmp, filePath, Object.assign({}, options, { fs: fsApi }));
}

function readJsonSafe(filePath, fsApi = fs) {
  try {
    if (!fsApi.existsSync(filePath)) return null;
    return JSON.parse(fsApi.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function serializeCsvField(value) {
  const s = String(value === undefined || value === null ? '' : value);
  return '"' + s.replace(/"/g, '""') + '"';
}

function serializeCsvRow(fields) {
  return fields.map(serializeCsvField).join(',');
}

const REGISTER_COLUMNS = [
  'delivery_order',
  'slice',
  'group',
  'work_item_id',
  'feature_id',
  'feature_name',
  'key_behavior',
  'status',
  'dependencies',
  'work_item_path',
  'branch',
  'pr',
  'codex_verdict',
  'merge_commit',
];

/**
 * List all existing goals in goalsDir
 */
function listGoals(goalsDir) {
  if (!fs.existsSync(goalsDir)) return [];
  const entries = fs.readdirSync(goalsDir, { withFileTypes: true });
  const goals = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const gf = path.join(goalsDir, entry.name, 'goal.json');
      const g = readJsonSafe(gf);
      if (g && g.goalId) goals.push(g);
    }
  }
  return goals;
}

/**
 * goal start --text "<goal>"
 * Creates data/goals/<goalId>/goal.json {goalId, text, constraints[], status: OPEN, createdAt}.
 * Idempotent per identical open text.
 */
function startGoal(options, deps) {
  const opts = options || {};
  const d = deps || {};
  const rootDir = resolveRootDir(opts);
  const goalsDir = resolveGoalsDir(rootDir, opts);

  const rawText = opts.text !== undefined ? opts.text : opts._text;
  if (typeof rawText !== 'string' || !rawText.trim()) {
    return {
      error: 'MISSING_GOAL_TEXT',
      message: 'Goal start requires non-empty --text "<goal>"',
      refusal: true,
    };
  }
  const text = rawText.trim();

  // Idempotent per identical open text
  const existingGoals = listGoals(goalsDir);
  const match = existingGoals.find(
    (g) => g.status === 'OPEN' && typeof g.text === 'string' && g.text.trim() === text
  );
  if (match) {
    return {
      ...match,
      idempotent: true,
    };
  }

  let goalId = opts.id || opts.goalId;
  if (goalId !== undefined && goalId !== null) {
    if (typeof goalId !== 'string' || !isValidGoalId(goalId)) {
      return invalidGoalIdRefusal(goalId);
    }
  } else {
    // Generate clean unique goal ID
    const hash = crypto
      .createHash('sha256')
      .update(text + Date.now())
      .digest('hex')
      .slice(0, 8);
    goalId = `G-${hash.toUpperCase()}`;
  }

  const nowIso = (d.now ? new Date(d.now()) : new Date()).toISOString();
  const constraints = Array.isArray(opts.constraints) ? opts.constraints.slice() : [];

  const goal = {
    goalId,
    text,
    constraints,
    status: 'OPEN',
    createdAt: nowIso,
    updatedAt: nowIso,
    items: [],
  };

  const goalFile = resolveGoalFile(goalsDir, goalId);
  writeJsonAtomic(goalFile, goal);

  return goal;
}

/**
 * goal amend <goalId> --text "<extra>"
 * Appends to constraints; never creates a new run; running items read updated constraints.
 */
function amendGoal(goalId, options, deps) {
  const opts = options || {};
  const d = deps || {};
  const rootDir = resolveRootDir(opts);
  const goalsDir = resolveGoalsDir(rootDir, opts);

  if (!goalId || typeof goalId !== 'string') {
    return {
      error: 'MISSING_GOAL_ID',
      message: 'Goal amend requires <goalId>',
      refusal: true,
    };
  }
  if (!isValidGoalId(goalId)) {
    return invalidGoalIdRefusal(goalId);
  }

  const rawText = opts.text !== undefined ? opts.text : opts._text;
  if (typeof rawText !== 'string' || !rawText.trim()) {
    return {
      error: 'MISSING_AMEND_TEXT',
      message: 'Goal amend requires non-empty --text "<extra>"',
      refusal: true,
    };
  }
  const extra = rawText.trim();

  const goalFile = resolveGoalFile(goalsDir, goalId);
  const goal = readJsonSafe(goalFile);
  if (!goal) {
    return {
      error: 'GOAL_NOT_FOUND',
      message: `Goal ${goalId} was not found`,
      refusal: true,
    };
  }

  if (!Array.isArray(goal.constraints)) {
    goal.constraints = [];
  }
  goal.constraints.push(extra);
  goal.updatedAt = (d.now ? new Date(d.now()) : new Date()).toISOString();

  writeJsonAtomic(goalFile, goal);
  return goal;
}

/**
 * Extract task details and source references from markdown lines
 */
function extractTaskSections(markdown) {
  const lines = String(markdown || '').split(/\r?\n/);
  const tasks = [];
  let current = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const m = /^#{2,3}\s+Task\s+(\d+)\b\s*[:.\-–—]?\s*(.*)$/i.exec(line);
    if (m) {
      if (current) tasks.push(current);
      current = {
        number: Number(m[1]),
        headingTitle: m[2].trim(),
        lines: [],
      };
      continue;
    }
    if (/^#{1,3}\s+/.test(line)) {
      if (current) {
        tasks.push(current);
        current = null;
      }
      continue;
    }
    if (current) {
      current.lines.push(line);
    }
  }
  if (current) tasks.push(current);
  return tasks;
}

function extractSourcesFromLines(lines) {
  const sources = [];
  for (const line of lines) {
    const m =
      /^\s*(?:[-*]\s+)?(?:\*\*)?(?:sources?|source refs?|references?|ref)(?:\*\*)?\s*:\s*(.*)$/i.exec(
        line
      );
    if (m) {
      const rest = m[1].trim();
      const tokens = rest.match(/`([^`]+)`/g) || rest.split(/[,;\s]+/);
      for (const t of tokens) {
        const clean = t.replace(/[`"']/g, '').trim();
        if (clean && !sources.includes(clean)) sources.push(clean);
      }
      continue;
    }
    // Also catch backticked paths that reference docs
    for (const b of line.matchAll(/`([^`]+)`/g)) {
      const token = b[1].trim();
      if (
        (token.startsWith('docs/') || token.includes('product-spec') || token.endsWith('.md')) &&
        !sources.includes(token)
      ) {
        sources.push(token);
      }
    }
  }
  return sources;
}

function extractObjectiveFromLines(lines, headingTitle) {
  for (const line of lines) {
    const m = /^\s*(?:[-*]\s+)?(?:\*\*)?(?:objective|goal|outcome)(?:\*\*)?\s*:\s*(.*)$/i.exec(
      line
    );
    if (m) {
      const obj = m[1].replace(/^\*\*|\*\*$/g, '').trim();
      if (obj) return obj;
    }
  }
  return headingTitle || null;
}

/**
 * Generate Work Item markdown document following WORK-ITEM-TEMPLATE.md
 */
function generateWorkItemDoc(spec, goalId, goalText) {
  if (!spec.acceptanceCriteria || spec.acceptanceCriteria.length === 0) {
    throw new Error(
      `Work item spec ${spec.id} is missing acceptance criteria; never default values.`
    );
  }
  if (!spec.sourceRefs || spec.sourceRefs.length === 0) {
    throw new Error(
      `Work item spec ${spec.id} is missing source references; never default values.`
    );
  }
  if (!spec.allowedPaths || spec.allowedPaths.length === 0) {
    throw new Error(`Work item spec ${spec.id} is missing allowed paths; never default values.`);
  }
  if (!spec.verification || !spec.verification.command) {
    throw new Error(
      `Work item spec ${spec.id} is missing verification command; never default values.`
    );
  }

  const criteriaRows = spec.acceptanceCriteria.map((crit, idx) => {
    return `| AC-${idx + 1} | ${crit} | Passes automated verification | Automated check passes |`;
  });

  const sourcesList = spec.sourceRefs.map((s) => `- \`${s}\``).join('\n');
  const allowedPathsList = spec.allowedPaths.map((p) => '`' + p + '`').join(', ');
  const depList =
    spec.dependencies && spec.dependencies.length > 0 ? spec.dependencies.join(', ') : 'None';
  const verifyCmd = spec.verification.command;

  return [
    `# ${spec.id} — ${spec.title || 'Goal task'}`,
    '',
    '## Control',
    '',
    '| Field | Value |',
    '|---|---|',
    `| Work Item ID | \`${spec.id}\` |`,
    `| Feature ID | \`GOAL-${goalId}\` |`,
    `| Status | \`${spec.initialStatus || 'READY_FOR_AUTHOR'}\` |`,
    `| Delivery order | \`${spec.deliveryOrder || 0}\` |`,
    `| Dependencies | \`${depList}\` |`,
    `| Assigned author | \`GEMINI\` |`,
    `| Risk | \`${(spec.riskDomains && spec.riskDomains[0]) || 'LOW'}\` |`,
    `| Allowed paths | ${allowedPathsList} |`,
    '| Reviewer | `Codex — fresh independent task` |',
    `| Branch | \`feat/${spec.id.toLowerCase()}-impl\` |`,
    '| Pull Request | `Pending` |',
    '',
    '## Business outcome',
    '',
    `> ${spec.businessOutcome || spec.title || goalText}`,
    '',
    '## Source references',
    '',
    sourcesList,
    '',
    '## Preconditions and dependencies',
    '',
    `- Preconditions: ${depList}.`,
    '',
    '## Author boundary',
    '',
    '- Author: GEMINI. Follow AGENTS.md operating contract.',
    '- Allowed paths: ' + allowedPathsList + '.',
    '- Prohibited: no push, no merge, no deleting uncommitted work, no model selection.',
    '',
    '## In scope',
    '',
    `- ${spec.title || 'Task implementation'}.`,
    '- Unit and integration verification commands matching acceptance criteria.',
    '',
    '## Out of scope',
    '',
    '- Modifying unallowed paths or inventing business rules.',
    '',
    '## Business rules and edge cases',
    '',
    '- Strict adherence to repository baseline and source specifications.',
    '',
    '## UI states',
    '',
    '- Full state coverage where UI is affected; N/A for pure backend.',
    '',
    '## API, event and data impact',
    '',
    '- Safe contract and schema handling within allowed paths.',
    '',
    '## Acceptance matrix',
    '',
    '| AC/Test ID | Scenario | Expected result | Evidence required |',
    '|---|---|---|---|',
    ...criteriaRows,
    '',
    '## Verification commands',
    '',
    `- \`${verifyCmd}\``,
    '',
    '## Codex review record',
    '',
    '| Review round | Commit | Verdict | Findings resolved |',
    '|---|---|---|---|',
    '| 1 | `Pending` | `Pending` | `Pending` |',
    '',
    '## Residual limitations',
    '',
    'None.',
    '',
  ].join('\n');
}

/**
 * Read the current register CSV rows
 */
function readRegisterCsvRows(registerPath) {
  if (!fs.existsSync(registerPath)) return [];
  const text = fs.readFileSync(registerPath, 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length <= 1) return [];
  // Parse rows simply or via adapter if available
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    // Simple split preserving quotes
    const fields = [];
    let field = '';
    let inQuotes = false;
    for (let c = 0; c < line.length; c += 1) {
      const ch = line[c];
      if (inQuotes) {
        if (ch === '"') {
          if (c + 1 < line.length && line[c + 1] === '"') {
            field += '"';
            c += 1;
          } else inQuotes = false;
        } else field += ch;
      } else {
        if (ch === '"') inQuotes = true;
        else if (ch === ',') {
          fields.push(field);
          field = '';
        } else field += ch;
      }
    }
    fields.push(field);
    rows.push(fields);
  }
  return rows;
}

/**
 * Append rows to register CSV atomically
 */
function appendRegisterRows(registerPath, newRows) {
  fs.mkdirSync(path.dirname(registerPath), { recursive: true });
  let content = '';
  if (fs.existsSync(registerPath)) {
    content = fs.readFileSync(registerPath, 'utf8');
  } else {
    content = serializeCsvRow(REGISTER_COLUMNS) + '\n';
  }
  if (content.length > 0 && !content.endsWith('\n')) {
    content += '\n';
  }
  for (const row of newRows) {
    content += serializeCsvRow(row) + '\n';
  }
  const tmp = registerPath + '.tmp';
  fs.writeFileSync(tmp, content, 'utf8');
  atomicRenameSync(tmp, registerPath);
}

/**
 * goal plan <goalId> --file <plan.md>
 * Parse with plan-adapter;
 * Validate each task has objective, source refs, dependencies, allowed paths, acceptance criteria, verification commands;
 * Run planner cycle check;
 * On success write Work Item docs and register rows;
 * On failure status BLOCKED with questions[].
 */
function planGoal(goalId, options, deps) {
  const opts = options || {};
  const d = deps || {};
  const rootDir = resolveRootDir(opts);
  const goalsDir = resolveGoalsDir(rootDir, opts);

  if (!goalId || typeof goalId !== 'string') {
    return {
      error: 'MISSING_GOAL_ID',
      message: 'Goal plan requires <goalId>',
      refusal: true,
    };
  }
  if (!isValidGoalId(goalId)) {
    return invalidGoalIdRefusal(goalId);
  }

  const goalFile = resolveGoalFile(goalsDir, goalId);
  const goal = readJsonSafe(goalFile);
  if (!goal) {
    return {
      error: 'GOAL_NOT_FOUND',
      message: `Goal ${goalId} was not found`,
      refusal: true,
    };
  }

  const planFilePath = opts.file || opts.planFile;
  if (!planFilePath || typeof planFilePath !== 'string') {
    return {
      error: 'MISSING_PLAN_FILE',
      message: 'Goal plan requires --file <plan.md>',
      refusal: true,
    };
  }

  const resolvedPlanFile = path.resolve(rootDir, planFilePath);
  if (!fs.existsSync(resolvedPlanFile)) {
    return {
      error: 'PLAN_FILE_NOT_FOUND',
      message: `Plan file not found: ${resolvedPlanFile}`,
      refusal: true,
    };
  }

  let markdown;
  try {
    markdown = fs.readFileSync(resolvedPlanFile, 'utf8');
  } catch (err) {
    return {
      error: 'PLAN_READ_ERROR',
      message: `Cannot read plan file: ${err.message}`,
      refusal: true,
    };
  }

  const questions = [];

  // Parse using plan-adapter
  let parsedPlan = null;
  try {
    parsedPlan = planAdapter.parsePlan(markdown);
  } catch (err) {
    questions.push(err.message || 'Plan parse error');
  }

  const taskSections = extractTaskSections(markdown);
  const taskSectionMap = new Map(taskSections.map((ts) => [ts.number, ts]));

  if (parsedPlan && Array.isArray(parsedPlan.tasks)) {
    for (const t of parsedPlan.tasks) {
      const ts = taskSectionMap.get(t.number);
      const lines = (ts && ts.lines) || [];

      // 1. Validate objective
      const objective = extractObjectiveFromLines(lines, t.title);
      if (!objective || objective === `Task ${t.number}`) {
        questions.push(
          `Task ${t.number} is missing a clear objective. What is the business outcome or objective of this task?`
        );
      } else {
        t.objective = objective;
      }

      // 2. Validate source refs
      const sourceRefs = extractSourcesFromLines(lines);
      if (sourceRefs.length === 0) {
        questions.push(
          `Task ${t.number} ('${t.title}') is missing source references. Which approved source specifies this task?`
        );
      } else {
        t.sourceRefs = sourceRefs;
      }

      // 3. Validate allowed paths
      if (!t.files || t.files.length === 0) {
        questions.push(
          `Task ${t.number} ('${t.title}') has no allowed paths or files. Which files are owned or modified by this task?`
        );
      }

      // 4. Validate acceptance criteria
      if (!t.criteria || t.criteria.length === 0) {
        questions.push(
          `Task ${t.number} ('${t.title}') declares no acceptance criteria. What are the acceptance criteria for this task?`
        );
      }

      // 5. Validate verification commands
      if (!t.commands || t.commands.length === 0) {
        questions.push(
          `Task ${t.number} ('${t.title}') declares no test or verification command. What command proves this task?`
        );
      }

      // 6. Validate dependencies (if dependsOn has invalid task number)
      for (const dep of t.dependsOn || []) {
        if (!parsedPlan.tasks.some((pt) => pt.number === dep)) {
          questions.push(`Task ${t.number} depends on missing Task ${dep} in the plan.`);
        }
      }
    }
  }

  // If initial task validation failed: status BLOCKED immediately
  if (questions.length > 0) {
    goal.status = 'BLOCKED';
    goal.questions = questions;
    goal.updatedAt = (d.now ? new Date(d.now()) : new Date()).toISOString();
    writeJsonAtomic(goalFile, goal);
    return {
      status: 'BLOCKED',
      goalId,
      questions,
      refusal: true,
    };
  }

  // Run planner cycle check and convert to work item specs
  let specs = [];
  const idPrefix = `GOAL-${goalId.toUpperCase()}`;
  if (parsedPlan && parsedPlan.tasks && parsedPlan.tasks.length > 0) {
    try {
      specs = planAdapter.toWorkItemSpecs(parsedPlan, {
        idPrefix,
        role: opts.role || 'author.foundation',
      });
      // Copy validated files/criteria/commands onto the spec
      for (const s of specs) {
        const matchingTask = parsedPlan.tasks.find((t) => s.id === `${idPrefix}-${t.number}`);
        if (matchingTask) {
          s.sourceRefs = (matchingTask.sourceRefs || []).slice();
          s.businessOutcome = matchingTask.objective || matchingTask.title;
          s.allowedPaths = (matchingTask.files || []).slice();
          if (!Array.isArray(s.files)) {
            s.files = (matchingTask.files || []).slice();
          }
          s.criteria = (matchingTask.criteria || []).slice();
          s.acceptanceCriteria = (matchingTask.criteria || []).slice();
          if (matchingTask.tests && matchingTask.tests.length > 0) {
            for (const test of matchingTask.tests) {
              const tc = 'Test passes: ' + test;
              if (!s.acceptanceCriteria.includes(tc)) s.acceptanceCriteria.push(tc);
            }
          }
          s.commands = (matchingTask.commands || []).slice();
          if (matchingTask.commands && matchingTask.commands.length > 0) {
            s.verification = { command: matchingTask.commands[0] };
          }
        }

        // Fail-closed checks on spec fields (never default values)
        if (!s.sourceRefs || s.sourceRefs.length === 0) {
          questions.push(
            `Task ${s.id} is missing source references. Which approved source specifies this task?`
          );
        }
        if (!s.allowedPaths || s.allowedPaths.length === 0) {
          questions.push(
            `Task ${s.id} has no allowed paths or files. Which files are owned or modified by this task?`
          );
        }
        if (!s.acceptanceCriteria || s.acceptanceCriteria.length === 0) {
          questions.push(
            `Task ${s.id} declares no acceptance criteria. What are the acceptance criteria for this task?`
          );
        }
        if (!s.verification || !s.verification.command) {
          questions.push(
            `Task ${s.id} declares no test or verification command. What command proves this task?`
          );
        }
      }
    } catch (err) {
      questions.push(err.message || 'Error converting plan to Work Item specs');
    }

    if (specs.length > 0) {
      const cycleCheck = planner.plan(parsedPlan.goal || goal.text, { specs });
      if (cycleCheck.errors && cycleCheck.errors.length > 0) {
        for (const e of cycleCheck.errors) {
          questions.push(e);
        }
      }
    }
  }

  // If validation failed or questions exist: status BLOCKED
  if (questions.length > 0) {
    goal.status = 'BLOCKED';
    goal.questions = questions;
    goal.updatedAt = (d.now ? new Date(d.now()) : new Date()).toISOString();
    writeJsonAtomic(goalFile, goal);
    return {
      status: 'BLOCKED',
      goalId,
      questions,
      refusal: true,
    };
  }

  // On success: write Work Item docs and register rows
  const registerPath = opts.registerPath
    ? path.resolve(rootDir, opts.registerPath)
    : path.join(rootDir, REGISTER_REL);
  const goalRegisterPath = resolveGoalRegisterFile(goalsDir, goalId);

  const existingRegisterRows = readRegisterCsvRows(registerPath);
  let maxDeliveryOrder = 0;
  for (const r of existingRegisterRows) {
    const num = Number(r[0]);
    if (!isNaN(num) && num > maxDeliveryOrder) maxDeliveryOrder = num;
  }

  const workItemsDir = path.join(rootDir, WORK_ITEMS_REL);
  fs.mkdirSync(workItemsDir, { recursive: true });

  const newRegisterRows = [];
  const goalItemIds = [];

  for (let idx = 0; idx < specs.length; idx += 1) {
    const spec = specs[idx];
    goalItemIds.push(spec.id);
    const hasUnmergedDeps = spec.dependencies && spec.dependencies.length > 0;
    const initialStatus = hasUnmergedDeps ? 'BACKLOG' : 'READY_FOR_AUTHOR';
    spec.initialStatus = initialStatus;
    const deliveryOrder = maxDeliveryOrder + idx + 1;
    spec.deliveryOrder = deliveryOrder;

    // 1. Write Work Item markdown doc
    const docPath = path.join(workItemsDir, `${spec.id}.md`);
    const docContent = generateWorkItemDoc(spec, goalId, goal.text);
    fs.writeFileSync(docPath, docContent, 'utf8');

    // 2. Build register row
    // Columns: delivery_order, slice, group, work_item_id, feature_id, feature_name,
    // key_behavior, status, dependencies, work_item_path, branch, pr, codex_verdict, merge_commit
    const row = [
      String(deliveryOrder),
      'GOAL',
      `Goal: ${goalId}`,
      spec.id,
      spec.featureId || `GOAL-${goalId.toUpperCase()}`,
      spec.title || `Task ${idx + 1}`,
      spec.businessOutcome || spec.title || goal.text,
      initialStatus,
      (spec.dependencies || []).join(';'),
      `docs/product-spec/work-items/${spec.id}.md`,
      '',
      '',
      '',
      '',
    ];
    newRegisterRows.push(row);
  }

  // Write register rows to both main register and goal-scoped register
  appendRegisterRows(registerPath, newRegisterRows);
  // Write goal-specific register (clean header + only goal rows)
  fs.mkdirSync(path.dirname(goalRegisterPath), { recursive: true });
  let goalCsv = serializeCsvRow(REGISTER_COLUMNS) + '\n';
  for (const row of newRegisterRows) {
    goalCsv += serializeCsvRow(row) + '\n';
  }
  fs.writeFileSync(goalRegisterPath, goalCsv, 'utf8');

  // Update goal.json
  goal.status = 'PLANNED';
  goal.items = goalItemIds;
  goal.planFile = resolvedPlanFile;
  goal.questions = [];
  goal.updatedAt = (d.now ? new Date(d.now()) : new Date()).toISOString();
  writeJsonAtomic(goalFile, goal);

  return {
    status: 'PLANNED',
    goalId,
    items: goalItemIds,
    workItems: specs.map((s) => ({ id: s.id, title: s.title, status: s.initialStatus })),
  };
}

/**
 * goal run <goalId>
 * Starts existing next --loop restricted to that goal's items (detached, single instance per goal via lock file).
 * A second call reports running pid, never starts a duplicate.
 */
function runGoal(goalId, options, deps) {
  const opts = options || {};
  const d = deps || {};
  const rootDir = resolveRootDir(opts);
  const goalsDir = resolveGoalsDir(rootDir, opts);

  if (!goalId || typeof goalId !== 'string') {
    return {
      error: 'MISSING_GOAL_ID',
      message: 'Goal run requires <goalId>',
      refusal: true,
    };
  }
  if (!isValidGoalId(goalId)) {
    return invalidGoalIdRefusal(goalId);
  }

  const goalFile = resolveGoalFile(goalsDir, goalId);
  const goal = readJsonSafe(goalFile);
  if (!goal) {
    return {
      error: 'GOAL_NOT_FOUND',
      message: `Goal ${goalId} was not found`,
      refusal: true,
    };
  }

  const lockFile = resolveLockFile(goalsDir, goalId);
  const checkAlive = d.isPidAlive || isPidAlive;

  // Single instance per goal via lock file
  if (fs.existsSync(lockFile)) {
    const lock = readJsonSafe(lockFile);
    if (lock && lock.pid && checkAlive(lock.pid)) {
      return {
        status: 'ALREADY_RUNNING',
        goalId,
        pid: lock.pid,
        running: true,
        message: `Goal ${goalId} is already running on pid ${lock.pid}`,
      };
    }
    // Stale lock file
    try {
      fs.unlinkSync(lockFile);
    } catch {}
  }

  if (!goal.items || goal.items.length === 0) {
    return {
      error: 'GOAL_NOT_PLANNED',
      message: `Goal ${goalId} has no planned items to run. Run "goal plan" first.`,
      refusal: true,
    };
  }

  // Ensure goal register is prepared
  const goalRegisterPath = resolveGoalRegisterFile(goalsDir, goalId);
  if (!fs.existsSync(goalRegisterPath)) {
    // Build goal register from canonical register matching goal.items
    const mainRegPath = opts.registerPath
      ? path.resolve(rootDir, opts.registerPath)
      : path.join(rootDir, REGISTER_REL);
    const mainRows = readRegisterCsvRows(mainRegPath);
    const goalItemSet = new Set(goal.items);
    const matchedRows = mainRows.filter((r) => goalItemSet.has(r[3]));
    let csvContent = serializeCsvRow(REGISTER_COLUMNS) + '\n';
    for (const row of matchedRows) {
      csvContent += serializeCsvRow(row) + '\n';
    }
    fs.mkdirSync(path.dirname(goalRegisterPath), { recursive: true });
    fs.writeFileSync(goalRegisterPath, csvContent, 'utf8');
  }

  const stopFilePath = resolveStopFile(goalsDir, goalId);
  if (fs.existsSync(stopFilePath)) {
    try {
      fs.unlinkSync(stopFilePath);
    } catch {}
  }

  const cliPath = path.resolve(__dirname, 'cli.js');
  const spawnFn = d.spawn || spawn;

  let childPid = null;
  if (d.mockRun) {
    childPid = typeof d.mockPid === 'number' ? d.mockPid : 99999;
  } else {
    const logPath = path.join(resolveGoalDir(goalsDir, goalId), 'run.log');
    const outLog = fs.openSync(logPath, 'a');
    const child = spawnFn(
      process.execPath,
      [
        cliPath,
        'next',
        '--loop',
        '--run',
        '--register',
        goalRegisterPath,
        '--root',
        rootDir,
        '--stop-file',
        stopFilePath,
        ...(opts.externalWorkers || opts['external-workers']
          ? ['--external-workers', String(opts.externalWorkers || opts['external-workers'])]
          : []),
      ],
      {
        detached: true,
        stdio: ['ignore', outLog, outLog],
        cwd: rootDir,
        env: process.env,
      }
    );
    if (child && child.pid) {
      childPid = child.pid;
      if (typeof child.unref === 'function') child.unref();
    } else {
      return {
        error: 'SPAWN_FAILED',
        message: 'Failed to start runner process',
        refusal: true,
      };
    }
  }

  // Record lock file
  const lockData = {
    pid: childPid,
    goalId,
    startedAt: (d.now ? new Date(d.now()) : new Date()).toISOString(),
  };
  writeJsonAtomic(lockFile, lockData);

  goal.status = 'RUNNING';
  goal.updatedAt = (d.now ? new Date(d.now()) : new Date()).toISOString();
  writeJsonAtomic(goalFile, goal);

  return {
    status: 'STARTED',
    goalId,
    pid: childPid,
  };
}

/**
 * Helper to inspect item status from register, checkpoints, and decision records
 */
function inspectItemStatus(itemId, goalId, rootDir, goalsDir, d, options) {
  let state = 'BACKLOG';
  let candidateKey = null;
  let branch = null;
  let commitSha = null;
  let testResult = null;
  let reviewVerdict = null;
  let lastDecisionId = null;

  // 1. Check register row
  const regPath =
    options && options.registerPath
      ? path.resolve(rootDir, options.registerPath)
      : d && d.registerPath
        ? path.resolve(rootDir, d.registerPath)
        : path.join(rootDir, REGISTER_REL);
  const rows = readRegisterCsvRows(regPath);
  const row = rows.find((r) => r[3] === itemId);
  if (row) {
    state = row[7] || state;
    branch = row[10] || branch;
    reviewVerdict = row[12] || reviewVerdict;
    commitSha = row[13] || commitSha;
  }

  // 1b. Check goal-scoped register row
  try {
    const goalRegPath = resolveGoalRegisterFile(goalsDir, goalId);
    if (fs.existsSync(goalRegPath)) {
      const goalRows = readRegisterCsvRows(goalRegPath);
      const grow = goalRows.find((r) => r[3] === itemId);
      if (grow) {
        const isDone = (s) => s === 'MERGED' || s === 'PASSED' || s === 'COMPLETED';
        if (isDone(grow[7]) || !isDone(state)) {
          state = grow[7] || state;
        }
        if (grow[10]) branch = grow[10] || branch;
        if (grow[12]) reviewVerdict = grow[12] || reviewVerdict;
        if (grow[13]) commitSha = grow[13] || commitSha;
      }
    }
  } catch {}

  // 2. Check decision records
  const decisionDir = (d && d.decisionDir) || decisions.DEFAULT_DIR;
  try {
    const detail = decisions.readDecisionsDetailed({ dir: decisionDir, days: 7 });
    const records = (detail && detail.records) || [];
    const itemRecords = records.filter(
      (r) => r.workItemId === itemId || (r.goalId === goalId && r.workItemId === itemId)
    );
    if (itemRecords.length > 0) {
      const last = itemRecords[itemRecords.length - 1];
      candidateKey =
        last.candidateKey ||
        last.chosen ||
        (last.candidates && last.candidates[0] && last.candidates[0].key) ||
        candidateKey;
      branch = last.branch || branch;
      commitSha = last.commit || last.mergeCommit || last.head || commitSha;
      reviewVerdict = last.review || last.verdict || last.codexVerdict || reviewVerdict;
      lastDecisionId = last.id || last.at || null;
      if (last.stage === decisions.Stage.COMPLETED) {
        state = 'COMPLETED';
      }
    }
  } catch {}

  // 3. Check checkpoints under intake or goal dir
  try {
    const goalDir = resolveGoalDir(goalsDir, goalId);
    const ckptPath = path.join(goalDir, 'checkpoint.json');
    const ckpt = readJsonSafe(ckptPath);
    if (ckpt && ckpt.items && ckpt.items[itemId]) {
      const it = ckpt.items[itemId];
      testResult = it.testResult || testResult;
      reviewVerdict = it.reviewVerdict || reviewVerdict;
      commitSha = it.commitSha || commitSha;
      if (it.state) state = it.state;
    }
  } catch {}

  return {
    workItemId: itemId,
    state,
    candidateKey,
    branch,
    commitSha,
    testResult,
    reviewVerdict,
    lastDecisionId,
  };
}

/**
 * goal status <goalId>
 * per item: state, candidate key, branch, commit SHA, test result, review verdict, last decision id.
 */
function statusGoal(goalId, options, deps) {
  const opts = options || {};
  const d = deps || {};
  const rootDir = resolveRootDir(opts);
  const goalsDir = resolveGoalsDir(rootDir, opts);

  if (!goalId || typeof goalId !== 'string') {
    return {
      error: 'MISSING_GOAL_ID',
      message: 'Goal status requires <goalId>',
      refusal: true,
    };
  }
  if (!isValidGoalId(goalId)) {
    return invalidGoalIdRefusal(goalId);
  }

  const goalFile = resolveGoalFile(goalsDir, goalId);
  const goal = readJsonSafe(goalFile);
  if (!goal) {
    return {
      error: 'GOAL_NOT_FOUND',
      message: `Goal ${goalId} was not found`,
      refusal: true,
    };
  }

  const lockFile = resolveLockFile(goalsDir, goalId);
  const checkAlive = d.isPidAlive || isPidAlive;
  let running = false;
  let pid = null;
  if (fs.existsSync(lockFile)) {
    const lock = readJsonSafe(lockFile);
    if (lock && lock.pid && checkAlive(lock.pid)) {
      running = true;
      pid = lock.pid;
    }
  }

  const items = (goal.items || []).map((itemId) =>
    inspectItemStatus(itemId, goalId, rootDir, goalsDir, d, opts)
  );

  return {
    goalId,
    status: goal.status,
    running,
    pid,
    items,
  };
}

/**
 * goal stop <goalId>
 * Uses existing checkpoints; stops running loop via process kill and stop file.
 */
function stopGoal(goalId, options, deps) {
  const opts = options || {};
  const d = deps || {};
  const fsApi = d.fs || fs;
  const rootDir = resolveRootDir(opts);
  const goalsDir = resolveGoalsDir(rootDir, opts);

  if (!goalId || typeof goalId !== 'string') {
    return {
      error: 'MISSING_GOAL_ID',
      message: 'Goal stop requires <goalId>',
      refusal: true,
    };
  }
  if (!isValidGoalId(goalId)) {
    return invalidGoalIdRefusal(goalId);
  }

  const goalFile = resolveGoalFile(goalsDir, goalId);
  const goal = readJsonSafe(goalFile, fsApi);
  if (!goal) {
    return {
      error: 'GOAL_NOT_FOUND',
      message: `Goal ${goalId} was not found`,
      refusal: true,
    };
  }

  const lockFile = resolveLockFile(goalsDir, goalId);
  const checkAlive = d.isPidAlive || isPidAlive;
  const now = d.now ? Number(new Date(d.now())) : Date.now();
  const env = d.env || process.env;
  // Operator inactivity policy, configurable rather than an attempt/probe cap.
  const configuredStaleMin = Number(env.SHIPDE_GOAL_STALE_MIN);
  const staleMin =
    configuredStaleMin > 0 && Number.isFinite(configuredStaleMin) ? configuredStaleMin : 90;
  const staleMs = staleMin * 60 * 1000;
  const lock = readJsonSafe(lockFile, fsApi);
  const checkpointFiles = [path.join(resolveGoalDir(goalsDir, goalId), 'checkpoint.json')];
  const intakeDir =
    opts.intakeDir || d.intakeDir || path.join(rootDir, 'tools', 'ai-brain', 'data', 'intake');
  if (fsApi.existsSync(intakeDir)) {
    for (const entry of fsApi.readdirSync(intakeDir)) {
      checkpointFiles.push(path.join(intakeDir, entry, 'checkpoint.json'));
    }
  }
  const recentActivity = checkpointFiles.some((file, index) => {
    const checkpoint = readJsonSafe(file, fsApi);
    return Object.entries((checkpoint && checkpoint.liveSteps) || {}).some(([itemId, step]) => {
      if (index !== 0 && !(goal.items || []).includes(itemId)) return false;
      const updatedAt = Date.parse(step && step.updatedAt);
      return Number.isFinite(updatedAt) && now - updatedAt < staleMs;
    });
  });
  if (opts.operator !== true && ((lock && checkAlive(lock.pid)) || recentActivity)) {
    recordGoalDecision(
      { goalId, stage: decisions.Stage.REFUSED, reasonCode: 'GOAL_RUN_ACTIVE' },
      {
        dir: opts.decisionDir || opts['decision-dir'] || d.decisionDir || decisions.DEFAULT_DIR,
        now,
      }
    );
    return {
      goalId,
      error: 'GOAL_RUN_ACTIVE',
      refusal: true,
      message: 'Goal run is active; report its status and wait.',
    };
  }
  const killFn =
    d.killPid ||
    ((p) => {
      try {
        process.kill(p, 'SIGTERM');
      } catch {}
    });

  // Write stop file
  const stopFilePath = resolveStopFile(goalsDir, goalId);
  fsApi.writeFileSync(stopFilePath, 'STOP\n', 'utf8');

  let stoppedPid = null;
  if (fsApi.existsSync(lockFile)) {
    const lock = readJsonSafe(lockFile, fsApi);
    if (lock && lock.pid) {
      stoppedPid = lock.pid;
      if (checkAlive(lock.pid)) {
        killFn(lock.pid);
      }
    }
    try {
      fsApi.unlinkSync(lockFile);
    } catch {}
  }

  goal.status = 'STOPPED';
  goal.updatedAt = (d.now ? new Date(d.now()) : new Date()).toISOString();
  writeJsonAtomic(goalFile, goal, { fs: fsApi });

  return {
    status: 'STOPPED',
    goalId,
    pid: stoppedPid,
  };
}

function isItemDone(info) {
  if (!info) return false;
  // A review verdict is evidence, not a lifecycle transition. It may belong
  // to an earlier attempt whose item is now blocked or awaiting another gate.
  return info.state === 'PASSED' || info.state === 'MERGED' || info.state === 'COMPLETED';
}

/**
 * goal resume <goalId>
 * Uses existing checkpoints; resume skips items already PASSED/MERGED.
 */
function resumeGoal(goalId, options, deps) {
  const opts = options || {};
  const d = deps || {};
  const rootDir = resolveRootDir(opts);
  const goalsDir = resolveGoalsDir(rootDir, opts);

  if (!goalId || typeof goalId !== 'string') {
    return {
      error: 'MISSING_GOAL_ID',
      message: 'Goal resume requires <goalId>',
      refusal: true,
    };
  }
  if (!isValidGoalId(goalId)) {
    return invalidGoalIdRefusal(goalId);
  }

  const goalFile = resolveGoalFile(goalsDir, goalId);
  const goal = readJsonSafe(goalFile);
  if (!goal) {
    return {
      error: 'GOAL_NOT_FOUND',
      message: `Goal ${goalId} was not found`,
      refusal: true,
    };
  }

  const lockFile = resolveLockFile(goalsDir, goalId);
  const checkAlive = d.isPidAlive || isPidAlive;
  if (fs.existsSync(lockFile)) {
    const lock = readJsonSafe(lockFile);
    if (lock && lock.pid && checkAlive(lock.pid)) {
      return {
        status: 'ALREADY_RUNNING',
        goalId,
        pid: lock.pid,
        message: `Goal ${goalId} is already running on pid ${lock.pid}`,
      };
    }
    try {
      fs.unlinkSync(lockFile);
    } catch {}
  }

  // Remove stop file
  const stopFilePath = resolveStopFile(goalsDir, goalId);
  if (fs.existsSync(stopFilePath)) {
    try {
      fs.unlinkSync(stopFilePath);
    } catch {}
  }

  const items = goal.items || [];
  const skipped = [];
  const remaining = [];
  const itemStatusMap = new Map();

  for (const itemId of items) {
    const info = inspectItemStatus(itemId, goalId, rootDir, goalsDir, d, opts);
    itemStatusMap.set(itemId, info);
    if (isItemDone(info)) {
      skipped.push(itemId);
    } else {
      remaining.push(itemId);
    }
  }

  // Update goal register so PASSED/MERGED/COMPLETED items are not runnable
  const goalRegisterPath = resolveGoalRegisterFile(goalsDir, goalId);
  let goalRows = [];
  if (fs.existsSync(goalRegisterPath)) {
    goalRows = readRegisterCsvRows(goalRegisterPath);
  } else {
    const mainRegPath = opts.registerPath
      ? path.resolve(rootDir, opts.registerPath)
      : path.join(rootDir, REGISTER_REL);
    const mainRows = readRegisterCsvRows(mainRegPath);
    const goalItemSet = new Set(items);
    goalRows = mainRows.filter((r) => goalItemSet.has(r[3]));
  }

  for (const row of goalRows) {
    const itemId = row[3];
    if (skipped.includes(itemId)) {
      const info = itemStatusMap.get(itemId) || {};
      row[7] = info.state;
      if (info.reviewVerdict) row[12] = info.reviewVerdict;
      if (info.commitSha) row[13] = info.commitSha;
    }
  }

  fs.mkdirSync(path.dirname(goalRegisterPath), { recursive: true });
  let updatedCsv = serializeCsvRow(REGISTER_COLUMNS) + '\n';
  for (const row of goalRows) {
    updatedCsv += serializeCsvRow(row) + '\n';
  }
  fs.writeFileSync(goalRegisterPath, updatedCsv, 'utf8');

  if (remaining.length === 0) {
    goal.status = 'COMPLETED';
    goal.updatedAt = (d.now ? new Date(d.now()) : new Date()).toISOString();
    writeJsonAtomic(goalFile, goal);
    return {
      status: 'COMPLETED',
      goalId,
      message: 'All items are already PASSED/MERGED',
      skipped,
      remaining: [],
    };
  }

  // Launch runner for remaining items
  const runResult = runGoal(goalId, options, deps);

  if (runResult && (runResult.error || runResult.refusal || runResult.status === 'BLOCKED')) {
    return {
      status: 'RESUME_FAILED',
      goalId,
      error: runResult.error || 'RESUME_FAILED',
      message: runResult.message || 'Failed to resume goal runner',
      refusal: true,
      skipped,
      remaining,
      runResult,
    };
  }

  if (runResult && runResult.status === 'ALREADY_RUNNING') {
    return {
      status: 'ALREADY_RUNNING',
      goalId,
      pid: runResult.pid,
      running: true,
      message: runResult.message,
      skipped,
      remaining,
    };
  }

  return {
    status: 'RESUMED',
    goalId,
    pid: runResult.pid || null,
    skipped,
    remaining,
  };
}

/**
 * Record a decision linked to a goal
 * Decision log entries link goalId -> workItemId -> candidateKey -> session -> commit -> review
 */
function recordGoalDecision(entry, options) {
  const e = Object.assign(
    {
      goalId: entry.goalId || null,
      workItemId: entry.workItemId || null,
      candidateKey: entry.candidateKey || null,
      sessionId: entry.sessionId || null,
      commit: entry.commit || null,
      review: entry.review || null,
    },
    entry
  );
  return decisions.recordDecision(e, options);
}

/**
 * CLI command runner for `goal <sub>`
 * All output is JSON on stdout. Exit code != 0 on refusal.
 */
function runGoalCli(args, deps) {
  const subcommand = args._[1];
  const goalId = args._[2] || args.id || args.goalId;

  let result = null;

  if (subcommand === 'start') {
    result = startGoal(args, deps);
  } else if (subcommand === 'amend') {
    result = amendGoal(goalId, args, deps);
  } else if (subcommand === 'plan') {
    result = planGoal(goalId, args, deps);
  } else if (subcommand === 'run') {
    result = runGoal(goalId, args, deps);
  } else if (subcommand === 'status') {
    result = statusGoal(goalId, args, deps);
  } else if (subcommand === 'stop') {
    result = stopGoal(goalId, args, deps);
  } else if (subcommand === 'resume') {
    result = resumeGoal(goalId, args, deps);
  } else {
    result = {
      error: 'UNKNOWN_GOAL_SUBCOMMAND',
      message: `Unknown goal subcommand: ${subcommand || '(none)'}. Usage: goal start | amend | plan | run | status | stop | resume`,
      refusal: true,
    };
  }

  console.log(JSON.stringify(result, null, 2));

  if (result && (result.refusal || result.error || result.status === 'BLOCKED')) {
    process.exitCode = 1;
    return 1;
  }

  process.exitCode = 0;
  return 0;
}

module.exports = {
  startGoal,
  amendGoal,
  planGoal,
  runGoal,
  statusGoal,
  stopGoal,
  resumeGoal,
  recordGoalDecision,
  runGoalCli,
  listGoals,
  resolveRootDir,
  resolveGoalsDir,
  resolveGoalFile,
  resolveLockFile,
  resolveStopFile,
  isPidAlive,
  generateWorkItemDoc,
  isValidGoalId,
};
