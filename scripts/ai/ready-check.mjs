#!/usr/bin/env node
/**
 * Ready-check: Definition-of-ready validator for Work Items.
 * Reference: github.com/DavidAnson/markdownlint — rule MD043 (required heading structure)
 * and its token-based Markdown analysis approach using markdown-it.
 * Licensed under the MIT License (David Anson).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lint as markdownlintSync } from 'markdownlint/sync';
import { md, CLARIFICATION } from './ready-check-helpers.mjs';
import { customRules } from './ready-check-rules.mjs';

const config = {
  default: false,
  MD043: {
    headings: [
      '% .+',
      '*',
      '%% (source references|source documents)',
      '*',
      '%% unchanged behavio[u]?r',
      '*',
      '%% acceptance.*',
      '*',
    ],
  },
  'source-link': true,
  'acceptance-proof': true,
  'open-questions': true,
  'unchanged-behaviour': true,
};

export function checkWorkItemReady(content) {
  const text = content.replace(/\r\n?/g, '\n');
  const problems = [];

  // Markers are checked in the original text, including comments and code blocks.
  for (const match of text.matchAll(CLARIFICATION)) {
    const lineIndex = text.slice(0, match.index).split('\n').length;
    problems.push(`line ${lineIndex}: unresolved NEEDS CLARIFICATION marker`);
  }

  const res = markdownlintSync({
    strings: { content: text },
    config,
    customRules,
    markdownItFactory: () => md,
  });

  const rawErrors = res.content || [];
  const seen = new Set();

  for (const err of rawErrors) {
    if (err.ruleNames.includes('MD043')) {
      const detail = err.errorDetail || '';
      if (/unchanged behavio/i.test(detail)) {
        const msg = 'line 1: missing Unchanged behaviour section';
        if (!seen.has('Unchanged behaviour')) {
          problems.push(msg);
          seen.add('Unchanged behaviour');
        }
      } else if (/acceptance/i.test(detail)) {
        const msg = 'line 1: missing Acceptance matrix with rows and a Proof column';
        if (!seen.has('Acceptance matrix')) {
          problems.push(msg);
          seen.add('Acceptance matrix');
        }
      } else if (/source (references|documents)/i.test(detail)) {
        const msg = 'line 1: missing source-document link in Source references';
        if (!seen.has('source-document')) {
          problems.push(msg);
          seen.add('source-document');
        }
      }
      continue;
    }

    const detail = err.errorDetail || err.ruleDescription;
    const msg = `line ${err.lineNumber}: ${detail}`;
    if (!problems.includes(msg)) {
      problems.push(msg);
      if (detail.includes('Unchanged behaviour')) seen.add('Unchanged behaviour');
      if (detail.includes('Acceptance matrix')) seen.add('Acceptance matrix');
      if (detail.includes('source-document')) seen.add('source-document');
    }
  }

  problems.sort((a, b) => {
    const numA = parseInt(a.match(/^line (\d+):/)?.[1] || '0', 10);
    const numB = parseInt(b.match(/^line (\d+):/)?.[1] || '0', 10);
    return numA - numB;
  });

  return { ok: problems.length === 0, problems };
}

function runCli(args) {
  if (args.length !== 1) {
    console.error('Usage: pnpm ai:ready <work-item>');
    return 1;
  }
  let content;
  try {
    content = readFileSync(args[0], 'utf8');
  } catch (error) {
    console.error(
      `Cannot read Work Item (${error.code ?? 'ERROR'}): check the path and permissions`
    );
    return 1;
  }
  const result = checkWorkItemReady(content);
  if (!result.ok) {
    for (const problem of result.problems) console.error(problem);
    return 1;
  }
  console.log('[ready-check] PASS: Work Item is ready for authoring');
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runCli(process.argv.slice(2));
}
