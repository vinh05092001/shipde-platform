#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HEADING = /^ {0,3}(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/;
const CLARIFICATION = /\[NEEDS\s+CLARIFICATION(?:\s*:[^\]]*)?\s*\]/gi;

function getIndent(str) {
  let count = 0;
  for (const ch of str) {
    if (ch === ' ') count += 1;
    else if (ch === '\t') count += 4;
    else break;
  }
  return count;
}

// Keep line numbers stable; comment tokens inside fenced examples stay literal.
function documentLines(text) {
  let fence;
  let fenceQuotePrefix;
  let fenceListIndent;
  let currentListIndent = 0;
  let comment = false;
  const uncommented = [];
  const lines = text.split('\n').map((raw) => {
    // Extract blockquote prefix (sequence of > markers) from the current line.
    const quoteMatch = raw.match(/^((?:[ \t]*>)*)/);
    const lineQuotePrefix = quoteMatch ? quoteMatch[1].replace(/[ \t]/g, '') : '';
    const afterQuote = raw.slice(quoteMatch ? quoteMatch[0].length : 0);

    // If inside a fence, check whether its container context still holds.
    // Exiting the opener's blockquote or list context ends the fence implicitly.
    if (fence) {
      if (fenceQuotePrefix && !lineQuotePrefix.startsWith(fenceQuotePrefix)) {
        fence = undefined;
        fenceQuotePrefix = undefined;
        fenceListIndent = undefined;
      } else if (fenceListIndent !== undefined && afterQuote.trim()) {
        const lineIndent = getIndent(afterQuote.match(/^[ \t]*/)[0]);
        if (HEADING.test(afterQuote) || lineIndent < fenceListIndent) {
          fence = undefined;
          fenceQuotePrefix = undefined;
          fenceListIndent = undefined;
        }
      }
    }

    const listMatch = afterQuote.match(/^([ \t]*)([-*+]|\d+[.)])([ \t]+)/);
    if (!fence) {
      if (listMatch) {
        currentListIndent =
          getIndent(listMatch[1]) + listMatch[2].length + getIndent(listMatch[3]);
      } else if (afterQuote.trim()) {
        const lineIndent = getIndent(afterQuote.match(/^[ \t]*/)[0]);
        if (HEADING.test(afterQuote) || lineIndent < currentListIndent) {
          currentListIndent = 0;
        }
      }
    }

    let line = raw;
    if (!fence) {
      line = '';
      let cursor = 0;
      while (cursor < raw.length) {
        const boundary = raw.indexOf(comment ? '-->' : '<!--', cursor);
        if (boundary < 0) {
          if (!comment) line += raw.slice(cursor);
          break;
        }
        if (!comment) line += raw.slice(cursor, boundary);
        cursor = boundary + (comment ? 3 : 4);
        comment = !comment;
      }
    }
    uncommented.push(line);

    const marker = line.match(/^(?:[ \t]*(?:>|[-*+]|\d+[.)]))*[ \t]*(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (
        marker &&
        marker[1][0] === fence[0] &&
        marker[1].length >= fence.length &&
        !marker[2].trim()
      ) {
        fence = undefined;
        fenceQuotePrefix = undefined;
        fenceListIndent = undefined;
      }
      return '';
    }
    if (marker) {
      fence = marker[1];
      fenceQuotePrefix = lineQuotePrefix || undefined;
      if (listMatch) {
        fenceListIndent =
          getIndent(listMatch[1]) + listMatch[2].length + getIndent(listMatch[3]);
      } else if (currentListIndent > 0) {
        fenceListIndent = Math.max(
          currentListIndent,
          getIndent(afterQuote.match(/^[ \t]*/)[0])
        );
      } else {
        fenceListIndent = undefined;
      }
      return '';
    }
    return line;
  });
  return { lines, uncommented };
}

function sections(lines) {
  const headings = lines.flatMap((line, index) => {
    const match = line.match(HEADING);
    return match ? [{ index, level: match[1].length, title: match[2].toLowerCase() }] : [];
  });
  return headings.map((heading, index) => ({
    ...heading,
    end:
      headings.slice(index + 1).find((next) => next.level <= heading.level)?.index ?? lines.length,
  }));
}

function concrete(value) {
  if (/<[^>]*>/.test(value)) return false;
  const text = value
    .replace(/[`*_~]/g, '')
    .trim();
  const stripped = text
    .replace(/^[-—:;~#/*[({<"'`\s]+/, '')
    .replace(/[-—:;~#/*\])}>'"`;?!,\s]+$/, '');
  return (
    /[\p{L}\p{N}]/u.test(text) &&
    !/^(?:n\/a|none|todo|tbd|tbc|tba|wip|fixme|pending|placeholder|not applicable)(?![\p{L}\p{N}])/iu.test(
      stripped
    )
  );
}

const REGRESSION_SPLIT =
  /(?:[;:,]\s*|\s+[-—]\s*|\s*[[(]\s*|\n\s*)\bregression[\s-]+(?:tests?|proofs?|commands?)\b\s*[:=-]?\s*|\bregression(?:[\s-]+(?:tests?|proofs?|commands?))?\b\s*[:=]\s*/i;

function isValidBehaviourPair(entry) {
  const text = entry.replace(/[`*_~]/g, '');
  const match = text.match(REGRESSION_SPLIT);
  if (!match || match.index === undefined) return false;
  const behaviour = text.slice(0, match.index).trim();
  const proof = text
    .slice(match.index + match[0].length)
    .replace(/[\])]\s*$/, '')
    .trim();
  return concrete(behaviour) && concrete(proof);
}

function hasBehaviour(lines) {
  let foundTable = false;
  const listLines = [...lines];
  for (let i = 0; i < lines.length - 1; i++) {
    const header = tableCells(lines[i]);
    const separator = tableCells(lines[i + 1]);
    if (!header?.length || separator?.length !== header.length || !isTableSeparator(separator)) {
      continue;
    }
    foundTable = true;
    let bCol = header.findIndex((c) => /behavio[u]?r/i.test(c));
    let pCol = header.findIndex((c) => /regression|proof|test/i.test(c));
    if (bCol === -1 && header.length >= 2) bCol = 0;
    if (pCol === -1 && header.length >= 2) pCol = 1;
    if (bCol === -1 || pCol === -1 || bCol === pCol) return false;

    let rows = 0;
    let cursor = i + 2;
    for (; cursor < lines.length; cursor++) {
      const row = tableCells(lines[cursor]);
      if (!row) break;
      rows++;
      const behaviour = row[bCol] ?? '';
      const proof = row[pCol] ?? '';
      if (row.length !== header.length || !concrete(behaviour) || !concrete(proof)) return false;
    }
    if (rows === 0) return false;
    listLines.fill('', i, cursor);
    i = cursor - 1;
  }
  // A proved table cannot supply proof for unrelated list or paragraph entries.
  const hasListEntries = listLines.some((line) => line.trim() && !HEADING.test(line));
  return hasListEntries ? checkListBehaviours(listLines) : foundTable;
}

function checkListBehaviours(lines) {
  const entries = [];
  let current = '';
  let currentIndent = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || HEADING.test(rawLine)) {
      if (current) {
        entries.push(current);
        current = '';
      }
      continue;
    }
    const bullet = rawLine.match(/^(\s*)(?:[-*+]|\d+[.)])\s+(.+)$/);
    const isNestedProof =
      bullet &&
      current &&
      bullet[1].length > currentIndent &&
      /^regression(?:[\s-]+(?:tests?|proofs?|commands?)\b|\s*[:=])/i.test(
        bullet[2].replace(/[`*_~]/g, '')
      );
    if (bullet && !isNestedProof) {
      if (current) entries.push(current);
      current = bullet[2].trim();
      currentIndent = bullet[1].length;
    } else if (current) {
      current += '\n' + (isNestedProof ? bullet[2] : line);
    } else {
      current = line;
      currentIndent = rawLine.length - rawLine.trimStart().length;
    }
  }
  if (current) entries.push(current);

  if (entries.length === 0) return false;
  return entries.every((entry) => isValidBehaviourPair(entry));
}

function isTableSeparator(cells) {
  return cells?.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell));
}

function tableCells(line) {
  const text = line.trim();
  const cells = [''];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\' && i + 1 < text.length) {
      cells[cells.length - 1] += text[i] + text[++i];
    } else if (text[i] === '|') {
      cells.push('');
    } else {
      cells[cells.length - 1] += text[i];
    }
  }
  if (cells.length === 1) return null;
  if (text.startsWith('|')) cells.shift();
  if (text.endsWith('|') && cells.at(-1) === '') cells.pop();
  return cells.map((cell) => cell.trim());
}

function hasSourceLink(text) {
  for (const match of text.matchAll(/\bhttps?:\/\/[^\s<>()`]+/gi)) {
    try {
      if (new URL(match[0]).hostname) return true;
    } catch {
      // An incomplete URL is not a source reference.
    }
  }
  return /(?:^|[\s`[(])(?:\.{1,2}\/)?(?:[\w.-]+\/)*[\w.-]+\.(?:md|mdx|rst|adoc|txt|pdf|ya?ml|json|html?)(?:#[^\s`)\]]*)?(?=$|[\s`)\],.;])/im.test(
    text
  );
}

export function checkWorkItemReady(content) {
  const text = content.replace(/\r\n?/g, '\n');
  const problems = [];
  const report = (index, message) => problems.push(`line ${index + 1}: ${message}`);

  // Markers are checked in the original text, including comments and code blocks.
  for (const match of text.matchAll(CLARIFICATION)) {
    report(
      text.slice(0, match.index).split('\n').length - 1,
      'unresolved NEEDS CLARIFICATION marker'
    );
  }

  const { lines, uncommented } = documentLines(text);
  const allSections = sections(lines);
  const body = (section, view = lines) => view.slice(section.index + 1, section.end);

  for (const section of allSections.filter((entry) => entry.title === 'open questions')) {
    if (body(section, uncommented).some((line) => line.trim())) {
      report(section.index, 'Open questions must be empty before authoring');
    }
  }

  const unchanged = allSections.filter((section) => /^unchanged behavio[u]?r$/.test(section.title));
  if (!unchanged.length) report(0, 'missing Unchanged behaviour section');
  for (const section of unchanged) {
    if (!hasBehaviour(body(section))) {
      report(
        section.index,
        'Unchanged behaviour must name preserved behaviour and regression tests'
      );
    }
  }

  const sources = allSections.filter((section) =>
    /^source (references|documents)$/.test(section.title)
  );
  if (!sources.some((section) => hasSourceLink(body(section).join('\n')))) {
    report(sources[0]?.index ?? 0, 'missing source-document link in Source references');
  }

  const acceptance = allSections.filter((section) => /^acceptance\b/.test(section.title));
  const inAcceptance = (index) =>
    acceptance.some((section) => index > section.index && index < section.end);
  let tables = 0;
  for (let i = 0; i < lines.length - 1; i++) {
    if (!inAcceptance(i)) continue;
    const header = tableCells(lines[i]);
    const separator = tableCells(lines[i + 1]);
    if (!header?.length || separator?.length !== header.length || !isTableSeparator(separator)) {
      continue;
    }
    tables++;
    const proofColumns = header.flatMap((cell, index) =>
      cell.replace(/[`*_]/g, '').toLowerCase() === 'proof' ? [index] : []
    );
    if (proofColumns.length !== 1) report(i, 'acceptance table must have exactly one Proof column');
    let cursor = i + 2;
    for (; cursor < lines.length && inAcceptance(cursor); cursor++) {
      const row = tableCells(lines[cursor]);
      if (!row) break;
      if (
        proofColumns.length === 1 &&
        (row.length !== header.length || !concrete(row[proofColumns[0]] ?? ''))
      ) {
        report(cursor, 'acceptance row needs concrete Proof and cells matching its header');
      }
    }
    if (cursor === i + 2) report(i, 'acceptance table must contain at least one row with Proof');
    i = cursor - 1;
  }
  if (!tables) report(0, 'missing Acceptance matrix with rows and a Proof column');

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
