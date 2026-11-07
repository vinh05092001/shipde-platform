'use strict';

const { safeText } = require('./coordinator-text');
const { stripVTControlCharacters } = require('node:util');

function normalizedText(value) {
  return safeText(stripVTControlCharacters(String(value ?? '')));
}

// Port of .oc/ci-failure.js parseReview/buildStep: keep the PR-body-only
// boundary without making the tracked module depend on ignored scratch files.
function parseReview(text) {
  const missingSections = [];
  const uncheckedItems = [];
  const lines = text.split('\n').map((line) => line.trim().replace(/^-\s+/, ''));
  for (const line of lines) {
    const section = line.match(/^missing PR section: ##\s*(.+)$/);
    const unchecked = line.match(/^unchecked checklist item:\s*(.+)$/i);
    if (section && !missingSections.includes(section[1].trim())) {
      missingSections.push(section[1].trim());
    }
    if (unchecked && !uncheckedItems.includes(unchecked[1].trim())) {
      uncheckedItems.push(unchecked[1].trim());
    }
    if (line === 'PR contains unchecked mandatory checklist items') {
      uncheckedItems.push('unchecked mandatory checklist items (names absent from check output)');
    }
  }
  return {
    missingSections,
    uncheckedItems,
    notReady: lines.includes('PR is not marked READY_FOR_CODEX'),
    truncated: lines.includes('--'),
  };
}

function buildStep(parsed) {
  const lines = ['Edit only the PR body.'];
  if (parsed.missingSections.length) {
    lines.push('Missing sections:', ...parsed.missingSections.map((s) => `- ${s}`));
  }
  if (parsed.uncheckedItems.length) {
    lines.push(
      'Resolve reported unchecked checklist items:',
      ...parsed.uncheckedItems.map((s) => `- ${s}`)
    );
  }
  if (parsed.notReady) lines.push('Set READY_FOR_CODEX on the PR.');
  if (parsed.truncated) lines.push('The extract is incomplete; obtain the full check output.');
  return lines.join('\n');
}

// Only diagnostic lines inside a declared failed check may become evidence.
// A TAP failure heading is a fallback; prefer the first concrete error beneath it.
function isError(line) {
  return /^(?:##\[error\]\s*)?(?:(?:[\w.]*Error|error(?:\s+TS\d+)?):|Error response from daemon:)/i.test(
    line
  );
}

function isInfra(line) {
  return /^(?:##\[error\]\s*)?(?:Error response from daemon:|(?:error:\s*)?(?:failed|unable) to pull (?:image|container)|(?:ErrImagePull|ImagePullBackOff)\b|(?:docker:\s*)?Error:.*(?:pull access denied|manifest.*not found|failed to pull image))/i.test(
    line
  );
}

function unknown(check = '') {
  return { kind: 'unknown', check, codeChange: false };
}

/** Pure, offline builder. Input is failed-check output, never specification text.
 * Returns redacted evidence and a task; performs no dispatch or repository writes.
 */
function buildCheckFailureTask(log, { check = '' } = {}) {
  const failures = [];
  let block = check ? { kind: 'ci', check: normalizedText(check), lines: [] } : null;
  function finish() {
    if (!block) return;
    if (block.kind === 'contract') {
      const parsed = parseReview(block.lines.join('\n'));
      failures.push(
        parsed.missingSections.length || parsed.uncheckedItems.length || parsed.notReady
          ? { kind: 'contract', check: block.check, codeChange: false, ...parsed }
          : unknown(block.check)
      );
    } else {
      let fallback;
      let current;
      let failedTest;
      let passingTestIndent;
      for (let index = 0; index < block.lines.length; index++) {
        const raw = block.lines[index];
        const line = raw.trim();
        const indent = raw.length - raw.trimStart().length;
        if (/^(?:not )?ok\b/.test(line)) {
          passingTestIndent = /^ok\b/.test(line) ? indent : undefined;
        }
        // Passing TAP YAML is expected diagnostic output, not failure evidence.
        if (passingTestIndent !== undefined && line === '---' && indent > passingTestIndent) {
          while (index + 1 < block.lines.length) {
            const next = block.lines[index + 1];
            const nextIndent = next.length - next.trimStart().length;
            if (next.trim() && nextIndent < indent) break;
            index++;
            if (next.trim() === '...' && nextIndent === indent) break;
          }
          passingTestIndent = undefined;
          continue;
        }
        if (/^(?:##\[error\]\s*)?Process completed with exit code\b/i.test(line)) continue;
        const infra = isInfra(line);
        let firstError = line;
        if (/^error:\s*[|>][-+]?$/i.test(line)) {
          const diagnostic = [];
          while (index + 1 < block.lines.length) {
            const next = block.lines[index + 1];
            if (next.trim() && next.length - next.trimStart().length <= indent) break;
            diagnostic.push(next);
            index++;
          }
          if (!diagnostic.some((entry) => entry.trim())) continue;
          firstError = [...(failedTest ? [failedTest] : []), ...diagnostic].join('\n');
        }
        if (infra || isError(line)) {
          const kind = infra ? 'infra' : 'test';
          // Different failure classes in one check must remain separate tasks.
          if (!current || current.kind !== kind) {
            current = { kind, check: block.check, firstError, codeChange: !infra };
            failures.push(current);
          }
        } else if (/^(?:not ok\b|FAIL(?:ED)?\b|✖)/.test(line)) {
          if (/^not ok\b/.test(line)) failedTest = line;
          fallback ||= line;
        }
      }
      if (!current) {
        failures.push(
          fallback
            ? { kind: 'test', check: block.check, firstError: fallback, codeChange: true }
            : unknown(block.check)
        );
      }
    }
  }

  const lines = normalizedText(log).split(/\r?\n/);
  for (const raw of lines) {
    // GitHub Actions timestamps precede diagnostics in downloaded check logs.
    const content = raw.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z[ \t]/, '').trimEnd();
    const line = content.trim();
    const ci = line.match(/^P1 — CI failing:\s*(?:\*\*(.+?)\*\*|(.+?))\.?$/);
    if (/^Pull Request contract validation failed:?$/.test(line) || ci) {
      const nestedContract = !ci && block?.kind === 'ci';
      // A check heading followed directly by validator output is one failure.
      if (
        !nestedContract ||
        block.lines.some((entry) => isError(entry.trim()) || isInfra(entry.trim()))
      )
        finish();
      block = {
        kind: ci ? 'ci' : 'contract',
        check: ci ? (ci[1] || ci[2]).trim() : block?.check || '',
        lines: [],
      };
    } else if (block) {
      block.lines.push(content);
    }
  }
  finish();
  if (!failures.length) failures.push(unknown());
  const task = failures
    .map((failure) => {
      if (failure.kind === 'contract') return buildStep(failure);
      if (failure.kind === 'infra') {
        return `Infrastructure failure in check "${failure.check}": ${failure.firstError}\nRestore infrastructure and rerun the check. No code change assigned.`;
      }
      if (failure.kind === 'test') {
        return `Fix failing check "${failure.check}".\nFirst error: ${failure.firstError}`;
      }
      return `Failure cause unknown${failure.check ? ` for check "${failure.check}"` : ''}; obtain the failing check output before assigning a change.`;
    })
    .join('\n\n');
  return { failures, task };
}

module.exports = { buildCheckFailureTask };
