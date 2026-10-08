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

module.exports = { compilePrompt, compileReviewPrompt, PUBLISHER_BOUNDARY, CLEAN_TREE_RULES };
