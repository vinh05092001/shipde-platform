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

// Token discipline for writer and repair prompts (TASK-AI-142 H3).
const TOKEN_DISCIPLINE =
  'Token discipline: before reading a file over about 300 lines (manifests, specs, logs), search it first (grep tool or rg -n) and read only the matching range (read tool with offset and limit, about 80 lines). ' +
  'Run only the named test files and keep only their summary and failure lines (ℹ pass, ℹ fail, ✖, AssertionError, actual:, expected:); the Controller runs the full suite host-side. ' +
  'Do not re-read files or repeat commands; never start a background job and wait on it; stop when the acceptance criteria are met.';

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

function deriveNarrowTestCommands(failures, options) {
  if (!Array.isArray(failures) || failures.length === 0) return [];
  const opts = typeof options === 'string' ? { gateOutput: options } : options || {};
  const gateOutput = opts.gateOutput ? String(opts.gateOutput) : '';
  const gateSummary = Array.isArray(opts.gateSummary)
    ? opts.gateSummary.join('\n')
    : opts.gateSummary
      ? String(opts.gateSummary)
      : '';
  const combinedOutput = (gateOutput + '\n' + gateSummary).trim();
  const allowedPaths = Array.isArray(opts.allowedPaths) ? opts.allowedPaths : [];

  const commands = [];
  for (const failure of failures) {
    if (!failure) continue;
    const raw =
      typeof failure === 'string'
        ? failure.trim()
        : String(failure.command || failure.test || '').trim();
    if (!raw) continue;
    if (raw === 'UNPARSED_FAILURE' || raw === 'NO_BRAIN_TEST_FILES') continue;
    if (/^(?:node|pnpm|npm|npx|yarn|bun|sh|bash)\s/.test(raw)) continue;

    let testFile = null;
    let testName = '';

    const fileMatch = raw.match(/([a-zA-Z0-9_\-./\\]+\.test\.[cm]?js)/);
    if (fileMatch) {
      testFile = fileMatch[1].replace(/\\/g, '/');
      const patternMatch = raw.match(/--test-name-pattern=["']?([^"'\r\n]+)["']?/);
      if (patternMatch) {
        testName = patternMatch[1].trim();
      } else {
        const afterFile = raw
          .slice(raw.indexOf(fileMatch[1]) + fileMatch[1].length)
          .replace(/^[\s>:]+/, '')
          .trim();
        const nameMatch = afterFile.match(/^([^(\r\n]+)/);
        testName = nameMatch ? nameMatch[1].trim() : '';
      }
    } else {
      const cleanName = raw
        .replace(/^(?:not ok \d+\s*-\s*|✖\s*)/, '')
        .replace(/\s*\([\d.]+m?s\)$/, '')
        .trim();
      if (!cleanName || cleanName === 'UNPARSED_FAILURE' || cleanName === 'NO_BRAIN_TEST_FILES') {
        continue;
      }
      testName = cleanName;

      if (combinedOutput) {
        const idx = combinedOutput.indexOf(cleanName);
        if (idx !== -1) {
          const beforeSlice = combinedOutput.slice(Math.max(0, idx - 5000), idx);
          const backwardMatches = [
            ...beforeSlice.matchAll(
              /(?:# Subtest:\s*|▶\s*|✖\s*|\b)([a-zA-Z0-9_\-./\\]+\.test\.[cm]?js)/g
            ),
          ];
          if (backwardMatches.length > 0) {
            testFile = backwardMatches[backwardMatches.length - 1][1].replace(/\\/g, '/');
          }
          if (!testFile) {
            const afterSlice = combinedOutput.slice(idx, idx + 2000);
            const forwardMatch = afterSlice.match(/([a-zA-Z0-9_\-./\\]+\.test\.[cm]?js)/);
            if (forwardMatch) {
              testFile = forwardMatch[1].replace(/\\/g, '/');
            }
          }
        }
      }

      if (!testFile && allowedPaths.length > 0) {
        const allowedTests = allowedPaths.filter((p) => /\.test\.[cm]?js$/.test(p));
        if (allowedTests.length === 1) {
          testFile = allowedTests[0].replace(/\\/g, '/');
        }
      }
    }

    if (!testFile) continue;

    const safeName = testName.replace(/["`$\\;&|<>\r\n]/g, '').trim();
    if (safeName) {
      commands.push(`node --test ${testFile} --test-name-pattern="${safeName}"`);
    } else {
      commands.push(`node --test ${testFile}`);
    }
  }
  return [...new Set(commands)];
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

  // Pinpointed brief with exact file:line targets
  if (c.pinpoint !== false) {
    try {
      const { pinpointTarget } = require('./pinpoint');
      const pp = pinpointTarget(i, { rootDir: c.rootDir });
      if (pp && pp.promptHeader) {
        lines.push(pp.promptHeader);
      }
    } catch (_) {}
  }

  lines.push('Work Item: ' + (i.id || ''));
  lines.push('Goal: ' + (c.goal || ''));
  if (c.specText) lines.push('Source spec: ' + String(c.specText));
  lines.push('Role requirement: ' + JSON.stringify(i.roleRequirement || {}));

  const isGoalItem = typeof i.id === 'string' && i.id.toUpperCase().startsWith('GOAL-');
  const allowed = (i.allowedPaths || []).slice();
  if (isGoalItem) {
    const regRel = 'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv';
    const specRel = `docs/product-spec/work-items/${i.id}.md`;
    if (!allowed.includes(regRel)) allowed.push(regRel);
    if (!allowed.includes(specRel)) allowed.push(specRel);
  }
  lines.push('Allowed files: ' + allowed.join(', '));
  lines.push('Forbidden files: everything outside the allowed paths.');
  lines.push('Dependencies: ' + (i.dependencies || []).join(', '));
  lines.push('Acceptance criteria:');
  for (const ac of i.acceptanceCriteria || []) lines.push('- ' + ac);

  const command = i.verification && i.verification.command;
  const isHostGateRepair = Array.isArray(c.hostGateFailures) && c.hostGateFailures.length > 0;
  let testCommand = null;
  if (isHostGateRepair) {
    const narrowCommands = deriveNarrowTestCommands(c.hostGateFailures, {
      gateOutput: c.hostGateOutput || c.commandOutput,
      gateSummary: c.hostGateSummary,
      allowedPaths: allowed,
    });
    if (narrowCommands.length > 0) {
      testCommand = narrowCommands.join(' && ');
    }
  } else {
    testCommand = command;
  }

  if (testCommand) {
    lines.push('Tests: ' + testCommand);
    lines.push('Expected result: ' + (i.verification?.expect || '(exit code 0)'));
  } else if (!isHostGateRepair) {
    lines.push(
      'Tests: (none declared: a work item with no verification command is not dispatchable)'
    );
  }
  if (c.focusedTestsOnly) {
    lines.push(
      "Run only focused tests for this change. Print concise test output only: node --test ... 2>&1 | grep -E '^ℹ (pass|fail)|^✖ ' (or an equivalent concise reporter). Do not run or print the full brain suite; the Controller runs that host-side gate and returns failing test names only."
    );
  }
  lines.push(TOKEN_DISCIPLINE);
  if (Array.isArray(c.hostGateFailures) && c.hostGateFailures.length > 0) {
    lines.push('Host-side verification failures to repair (failing test names only):');
    for (const failure of c.hostGateFailures) lines.push('- ' + String(failure));

    const gateOutput =
      c.hostGateOutput ||
      c.commandOutput ||
      (Array.isArray(c.hostGateSummary) && c.hostGateSummary.length > 0
        ? c.hostGateSummary.join('\n')
        : null);
    if (gateOutput) {
      let maxOutputChars = c.maxPromptCommandOutputChars;
      if (maxOutputChars === undefined) {
        try {
          const sourcesApi = require('./sources');
          maxOutputChars = sourcesApi.getDispatchConfig().maxPromptCommandOutputChars;
        } catch (_) {}
      }
      if (typeof maxOutputChars === 'number' && maxOutputChars > 0) {
        const rawText = String(gateOutput).trim();
        if (rawText) {
          const isTruncated = rawText.length > maxOutputChars;
          const truncated = isTruncated
            ? rawText.slice(0, maxOutputChars) + '\n... (truncated)'
            : rawText;
          lines.push('Host gate output:');
          lines.push(truncated);
        }
      }
    }
  }
  if (c.contextPack) {
    lines.push('Focused context pack: read ' + c.contextPack + ' before exploring files.');
    lines.push('Use the pack for orientation and read only additional files under Allowed files.');
  }
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
  if (isGoalItem) {
    lines.push(
      'Registration requirement: you must stage and commit docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv and docs/product-spec/work-items/' +
        i.id +
        '.md alongside your changes.'
    );
  }
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
  let offeredTools = [];
  if (selected.error) {
    warnToolManifest(selected.error, i, role, c.logOpts);
  } else if (selected.tools.length > 0) {
    offeredTools = selected.tools;
    lines.push(toolsSectionLines(selected.tools));
    if (c.logOpts && c.recordTools !== false) recordPromptTools(i, role, selected.tools, c.logOpts);
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
  const prompt = lines.join('\n');
  if (c.returnTools) return { prompt, tools: offeredTools.map((tool) => tool.id) };
  return prompt;
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
  deriveNarrowTestCommands,
  PUBLISHER_BOUNDARY,
  CLEAN_TREE_RULES,
  ISOLATED_WORKER_VERIFICATION_NOTE,
};
