'use strict';
// Log and file utilities for coordinator runtime.
const fs = require('fs');
const { safeText } = require('./coordinator-text');

const MAX_LOG_BYTES = 2 * 1024 * 1024; // 2MB bounded log retention
const MAX_LOG_LINE_BYTES = 64 * 1024;
const TRUNCATION = '[TRUNCATED: LOG_SIZE_LIMIT_EXCEEDED]\n';

function readLog(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(MAX_LOG_BYTES + 1);
    let count = 0;
    while (count < buffer.length) {
      const size = fs.readSync(fd, buffer, count, buffer.length - count, null);
      if (!size) break;
      count += size;
    }
    const truncated = count > MAX_LOG_BYTES;
    const end = truncated
      ? Math.max(0, buffer.lastIndexOf(10, MAX_LOG_BYTES - Buffer.byteLength(TRUNCATION) - 1))
      : count;
    return buffer.subarray(0, end).toString('utf8') + (truncated ? '\n' + TRUNCATION : '');
  } finally {
    fs.closeSync(fd);
  }
}

function readLines(file) {
  let malformedRowsSkipped = 0;
  try {
    const rows = fs
      .readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .flatMap((line) => {
        try {
          const parsed = JSON.parse(line);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return [parsed];
          malformedRowsSkipped++;
          return [];
        } catch {
          malformedRowsSkipped++;
          return [];
        }
      });
    Object.defineProperty(rows, 'malformedRowsSkipped', { value: malformedRowsSkipped });
    return rows;
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error('READ_FAILED: ' + safeText(error.message));
  }
}

function parseReview(text, tokens = null) {
  if (/\[TRUNCATED:/.test(text))
    return { verdict: 'BLOCKED', reason: 'REVIEW_OUTPUT_TRUNCATED', tokens, text: safeText(text) };
  const verdict = text.match(/^VERDICT:\s*(PASS|CHANGES_REQUIRED|BLOCKED)\s*$/m)?.[1];
  const sha = text.match(/^Reviewed SHA:\s*([a-f0-9]{40})\s*$/im)?.[1];
  const findings = text
    .split(/\n(?=\s*(?:\d+\.|-)\s+)/)
    .filter((block) => /\bP[012]\b/.test(block))
    .map((block) => ({
      severity: [...block.matchAll(/\bP[012]\b/g)].map((match) => match[0]).sort()[0],
      closed:
        /^\s*(?:\d+\.|-)\s*P[012]\s+FIXED:\s*\S/i.test(block) &&
        [...block.matchAll(/\bP[012]\b/g)].length === 1 &&
        !/\b(?:NOT\s+FIXED|OPEN|UNRESOLVED)\b/i.test(block),
      files: [
        ...new Set(
          [
            ...block.matchAll(
              /(?:`|\s)((?:apps|packages|docs|scripts|tools|prisma)\/[\w./\-\[\]]+)(?::\d+)?/g
            ),
          ].map((match) => match[1])
        ),
      ],
      text: safeText(block),
    }));
  return { verdict, sha, findings, tokens, text: safeText(text) };
}

function reviewUsage(log) {
  if (/\[TRUNCATED:/.test(log)) return { text: log, tokens: null };
  let text = '',
    tokens = null;
  for (const line of log.split(/\r?\n/)) {
    try {
      const event = JSON.parse(line);
      if (event.type === 'text' && typeof event.part?.text === 'string')
        text += event.part.text + '\n';
      if (typeof event.result === 'string') text += event.result + '\n';
      const usage = event.part?.tokens || event.usage;
      if (usage) {
        const total =
          usage.total_tokens ??
          usage.total ??
          Number(usage.input ?? usage.input_tokens ?? 0) +
            Number(usage.output ?? usage.output_tokens ?? 0) +
            Number(usage.reasoning ?? 0) +
            Number(usage.cache?.read ?? usage.cache_read_input_tokens ?? 0) +
            Number(usage.cache?.write ?? usage.cache_creation_input_tokens ?? 0);
        if (Number.isFinite(total) && total >= 0) tokens = (tokens ?? 0) + total;
      }
    } catch {
      /* CLI text is read below, never interpreted as a usage record. */
    }
  }
  const match = log.match(/tokens used\s*\n([\d,]+)/i);
  if (match) tokens = Number(match[1].replace(/,/g, ''));
  return { text: text || log, tokens };
}

module.exports = {
  readLog,
  readLines,
  parseReview,
  reviewUsage,
  safeText,
  MAX_LOG_BYTES,
  MAX_LOG_LINE_BYTES,
  TRUNCATION,
};
