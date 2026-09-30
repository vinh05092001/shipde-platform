'use strict';

/**
 * Ship Dễ — Prompt compiler (TASK-AI-60, dry-run level).
 *
 * One prompt per work item. The prompt carries the full scope and the publisher
 * boundary (workers never push, never open a Pull Request, never merge), and it
 * pins the candidateKey the Controller chose. It never invents a model, provider
 * or account; those come only from the pinned candidate.
 */

const PUBLISHER_BOUNDARY =
  'Publisher boundary: you are a worker. Never push, never open a Pull Request, ' +
  'never merge. Submit your evidence and stop.';

/**
 * @param item  a plan work item (from planner.js)
 * @param ctx   { goal, specText, candidateKey }
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
  if (c.candidateKey) lines.push('Pinned candidateKey: ' + c.candidateKey);
  return lines.join('\n');
}

module.exports = { compilePrompt, PUBLISHER_BOUNDARY };
