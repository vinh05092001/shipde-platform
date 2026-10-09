'use strict';

/**
 * Ship Dễ — Prompt compiler (TASK-AI-60, dry-run level).
 *
 * One prompt per work item. The prompt carries the full scope and the publisher
 * boundary (workers never push, never open a Pull Request, never merge), and it
 * pins the candidateKey the Controller chose. It never invents a model, provider
 * or account; those come only from the pinned candidate.
 */

const skillPack = require('./skill-pack');

const PUBLISHER_BOUNDARY =
  'Publisher boundary: you are a worker. Never push, never open a Pull Request, ' +
  'never merge. Submit your evidence and stop.';

const CLEAN_TREE_RULES =
  'Clean tree requirement: work only inside the allowed paths, do not create scratch/backup/test files outside them, delete any temporary file before finishing, finish with exactly one local commit and a clean git status (no untracked files).';

// WD-R04: isolated workers share a provisioned dependency tree, so their
// prompt must name the verification commands they can now run and the
// supertest caveat. One constant for every prompt path — compilePrompt
// (orchestrate author and repair rounds) and executor defaultPrompt /
// resumePrompt (cli dispatch) — so the sentence cannot drift or be dropped
// at one call site again.
const ISOLATED_WORKER_VERIFICATION_NOTE =
  'You can now run pnpm lint, pnpm typecheck, pnpm format:check, prettier --write on your own files, and the focused tests. API supertests skip without a database (CI is the evidence).';

/**
 * The item's role, resolved the same way orchestrate.js resolves it: the
 * roleRequirement the plan pinned, else the item role, else the default
 * author lane. prompt-compiler.js keeps its own copy so it never imports the
 * orchestration loop (which imports this module back).
 */
function roleOf(item) {
  return (
    (item && item.roleRequirement && item.roleRequirement.role) ||
    (item && item.role) ||
    'author.foundation'
  );
}

/**
 * TM-R01: the "Tools for this item" section, built from the tool manifest.
 *
 * Returns { tools } for the matched tools (at most 8), or { error } when the
 * manifest is missing or unreadable — in which case the prompt must stay
 * unchanged and a warning is recorded instead of crashing.
 */
function toolsForPrompt(item, role, files, riskDomains) {
  let toolsFor;
  try {
    toolsFor = require('./tool-manifest').toolsFor;
  } catch (err) {
    return { error: err };
  }
  const wanted = files && files.length > 0 ? files : (item && item.allowedPaths) || [];
  let matched;
  try {
    matched = toolsFor({ role, files: wanted, riskDomains: riskDomains || [] });
  } catch (err) {
    return { error: err };
  }
  return { tools: (Array.isArray(matched) ? matched : []).slice(0, 8) };
}

/** The section body: tool id, purpose, and the command only when one is known. */
function toolsSectionLines(tools) {
  const lines = ['Tools for this item:'];
  for (const t of tools) {
    lines.push('- ' + t.id + ': ' + t.purpose + (t.command ? ' (command: ' + t.command + ')' : ''));
  }
  return lines.join('\n');
}

/**
 * A missing or unreadable manifest is a warning, never a crash and never a
 * silent divergence: it is printed and recorded in the decision log
 * (WORKER_DEPS_UNAVAILABLE's WARNING stage) when the caller supplies a log.
 */
function warnToolManifest(err, item, role, logOpts) {
  console.warn(
    'WARN: tool manifest missing or unreadable; the prompt carries no Tools section:',
    (err && err.message) || err
  );
  if (!logOpts) return;
  try {
    const decisions = require('./decisions');
    decisions.recordDecision(
      {
        stage: decisions.Stage.WARNING,
        warning: 'TOOL_MANIFEST_UNAVAILABLE',
        workItemId: (item && item.id) || 'item',
        role,
        detail: 'tool manifest missing or unreadable; the prompt is unchanged',
      },
      logOpts
    );
  } catch (_) {
    // A broken decision log must not break prompt compilation either.
  }
}

/** TM-R04: which tools the prompt offered, tool ids only, in the decision log. */
function recordPromptTools(item, role, tools, logOpts) {
  if (!logOpts) return;
  try {
    const decisions = require('./decisions');
    decisions.recordDecision(
      {
        stage: decisions.Stage.PROMPT_TOOLS,
        workItemId: (item && item.id) || 'item',
        role,
        tools: tools.map((t) => t.id),
      },
      logOpts
    );
  } catch (_) {
    // A broken decision log must not break prompt compilation.
  }
}

/**
 * @param item  a plan work item (from planner.js)
 * @param ctx   { goal, specText, candidateKey, branch, usageFile, dirtyPaths, headSha, baseSha }
 * @returns a single prompt string
 */
function compilePrompt(item, ctx) {
  const c = ctx || {};
  const i = item || {};
  const lines = [];
  lines.push('Work Item: ' + (i.id || ''));
  lines.push('Goal: ' + (c.goal || ''));
  if (c.specText) lines.push('Source spec: ' + String(c.specText));
  lines.push('Role requirement: ' + JSON.stringify(i.roleRequirement || {}));
  lines.push('Allowed files: ' + (i.allowedPaths || []).join(', '));
  lines.push('Forbidden files: everything outside the allowed paths.');
  lines.push('Dependencies: ' + (i.dependencies || []).join(', '));
  lines.push('Acceptance criteria:');
  for (const ac of i.acceptanceCriteria || []) lines.push('- ' + ac);
  const command = i.verification && i.verification.command;
  lines.push(
    'Tests: ' +
      (command || '(none declared: a work item with no verification command is not dispatchable)')
  );
  if (command) lines.push('Expected result: ' + (i.verification.expect || '(exit code 0)'));
  if (c.isolatedWorker) lines.push(ISOLATED_WORKER_VERIFICATION_NOTE);
  lines.push('Evidence to submit: test output, the diff, and the acceptance matrix.');
  lines.push('Checkpoint: ' + (i.checkpointPolicy || 'resume-by-work-item'));
  lines.push(
    'Stop conditions: fail closed on a denied operation, a dependency cycle, or a missing dependency.'
  );
  lines.push(PUBLISHER_BOUNDARY);
  const branch = c.branch || (i.id ? 'feat/' + String(i.id).toLowerCase() : 'exercise');
  lines.push(
    'Commit requirement: you must create exactly one local commit on the exercise branch (' +
      branch +
      ') containing all your changes (no push).'
  );
  lines.push(CLEAN_TREE_RULES);

  let dirtyPaths = [];
  if (Array.isArray(c.dirtyPaths) && c.dirtyPaths.length > 0) {
    dirtyPaths = c.dirtyPaths.slice();
  } else if (Array.isArray(i.dirtyPaths) && i.dirtyPaths.length > 0) {
    dirtyPaths = i.dirtyPaths.slice();
  } else if (Array.isArray(i.acceptanceCriteria)) {
    for (const ac of i.acceptanceCriteria) {
      const match = typeof ac === 'string' && ac.match(/offending paths:\s*([^;.]+)/i);
      if (match) {
        const extracted = match[1]
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        if (extracted.length > 0) {
          dirtyPaths.push(...extracted);
        }
      }
    }
  }
  dirtyPaths = [...new Set(dirtyPaths)];

  let headSha = c.headSha || i.headSha || null;
  if (!headSha && Array.isArray(i.acceptanceCriteria)) {
    for (const ac of i.acceptanceCriteria) {
      const match = typeof ac === 'string' && ac.match(/HEAD SHA:\s*([a-f0-9]+)/i);
      if (match) {
        headSha = match[1];
        break;
      }
    }
  }

  let baseSha = c.baseSha || i.baseSha || null;
  if (!baseSha && Array.isArray(i.acceptanceCriteria)) {
    for (const ac of i.acceptanceCriteria) {
      const match = typeof ac === 'string' && ac.match(/base SHA:\s*([a-f0-9]+)/i);
      if (match) {
        baseSha = match[1];
        break;
      }
    }
  }

  if (dirtyPaths.length > 0) {
    lines.push('Offending paths: ' + dirtyPaths.join(', '));
  }
  if (headSha && headSha !== 'none') {
    lines.push('HEAD SHA: ' + headSha);
  }
  if (baseSha && baseSha !== 'none') {
    lines.push('Base SHA: ' + baseSha);
  }

  // TM-R01: the tools this item can use (author and repair prompts share this
  // compiler), from the manifest and only when the manifest is readable.
  const role = roleOf(i);
  const selected = toolsForPrompt(i, role, dirtyPaths, i.riskDomains || []);
  if (selected.error) {
    warnToolManifest(selected.error, i, role, c.logOpts);
  } else if (selected.tools.length > 0) {
    lines.push(toolsSectionLines(selected.tools));
    recordPromptTools(i, role, selected.tools, c.logOpts);
  }

  if (c.usageFile) {
    lines.push(
      'Usage report: write your session usage report to ' +
        c.usageFile +
        ' (or it will be collected from harness result).'
    );
  }
  if (c.candidateKey) lines.push('Pinned candidateKey: ' + c.candidateKey);
  // ShipDe rules (publisher boundary, clean tree) stay first; the locked
  // skill pack comes last. Roles without a pack, or SHIPDE_SKILL_PACK=off,
  // leave the prompt byte-identical to before.
  const pack = skillPack.lockedPack(roleOf(i));
  if (pack) lines.push(pack);
  return lines.join('\n');
}

/**
 * Compile prompt for the independent review stage.
 * @param item a plan work item
 * @param ctx  { goal, headSha, baseSha, diffText, verdictFile, usageFile, candidateKey, exercise }
 * @returns a single review prompt string
 */
function compileReviewPrompt(item, ctx) {
  const c = ctx || {};
  const i = item || {};
  const lines = [];
  lines.push('Work Item: ' + (i.id || ''));
  lines.push('Goal: ' + (c.goal || ''));
  lines.push('Role requirement: reviewer');
  lines.push('Review target commit (exact SHA): ' + (c.headSha || ''));
  lines.push('Base SHA: ' + (c.baseSha || ''));
  lines.push('Allowed files: ' + ((i.allowedPaths || []).join(', ') || '(unspecified)'));
  lines.push('Acceptance criteria:');
  for (const ac of i.acceptanceCriteria || []) lines.push('- ' + ac);
  const exerciseCommand =
    (i.verification && i.verification.command) ||
    (c.exercise && c.exercise.command) ||
    '(none declared)';
  lines.push('Exercise command: ' + exerciseCommand);
  if (i.verification && i.verification.expect) {
    lines.push('Expected test result: ' + i.verification.expect);
  }
  lines.push('Diff (' + (c.baseSha || 'base') + '..' + (c.headSha || 'head') + '):');
  lines.push(c.diffText || '(empty diff)');

  // TM-R01: the review lane gets its own tool list — the security tools show
  // up for the security-review lane exactly as the author lanes get theirs.
  const revRole = roleOf(i).includes('review') ? roleOf(i) : 'reviewer';
  const revSelected = toolsForPrompt(i, revRole, i.allowedPaths || [], i.riskDomains || []);
  if (revSelected.error) {
    warnToolManifest(revSelected.error, i, revRole, c.logOpts);
  } else if (revSelected.tools.length > 0) {
    lines.push(toolsSectionLines(revSelected.tools));
    recordPromptTools(i, revRole, revSelected.tools, c.logOpts);
  }

  lines.push(PUBLISHER_BOUNDARY);
  lines.push(
    'Review instructions: You are an independent reviewer operating in a separate read-only root. ' +
      'Inspect the diff and verify all acceptance criteria and exercise tests. ' +
      'Do NOT modify any code in the writer root.'
  );
  lines.push(
    'Verdict file requirement: Write your review verdict as a JSON file to ' +
      (c.verdictFile || 'verdict.json') +
      ' containing:\n' +
      JSON.stringify(
        {
          sha: c.headSha || '<exact-40-char-sha>',
          verdict: 'PASS | CHANGES_REQUIRED',
          findings: [
            {
              id: 'ISSUE_ID',
              open: true,
              detail: 'description of finding',
            },
          ],
        },
        null,
        2
      )
  );
  lines.push(
    'If all acceptance criteria are met and tests pass, verdict must be "PASS" and findings must be []. ' +
      'If any criterion is unmet or tests fail, verdict must be "CHANGES_REQUIRED" and findings must list open issues. ' +
      'Never return PASS with open findings.'
  );
  if (c.usageFile) {
    lines.push('Usage report: write your session usage report to ' + c.usageFile);
  }
  if (c.candidateKey) {
    lines.push('Pinned candidateKey: ' + c.candidateKey);
  }
  // The review lane always runs the reviewer pack, after the ShipDe rules.
  const reviewPack = skillPack.lockedPack('reviewer');
  if (reviewPack) lines.push(reviewPack);
  return lines.join('\n');
}

module.exports = {
  compilePrompt,
  compileReviewPrompt,
  PUBLISHER_BOUNDARY,
  CLEAN_TREE_RULES,
  ISOLATED_WORKER_VERIFICATION_NOTE,
};
