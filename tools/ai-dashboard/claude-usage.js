'use strict';

/**
 * Reads Claude Code's own usage records.
 *
 * Every assistant turn is appended to a JSONL transcript under
 * ~/.claude/projects/<project>/<session>.jsonl, and each carries the token
 * counts the API reported for that turn. That is the authoritative local
 * record of what this machine has consumed, independent of the 9router
 * gateway, which only sees traffic that was actually routed through it.
 *
 * Only token counters and timestamps are read. Message content is never
 * touched, so this cannot leak transcript text into the dashboard.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

/** Cheap public pricing table, USD per million tokens. */
const PRICING = {
  'claude-opus-5': { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
  'claude-opus-4-5': { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
  'claude-sonnet-5': { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  'claude-sonnet-4-5': { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
};

function priceFor(model) {
  const key = Object.keys(PRICING).find((k) => model.startsWith(k));
  return key ? PRICING[key] : null;
}

function listTranscripts(dir) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push.apply(out, listTranscripts(full));
    } else if (entry.name.endsWith('.jsonl')) {
      out.push(full);
    }
  }
  return out;
}

function emptyBucket() {
  return { messages: 0, input: 0, output: 0, cacheWrite: 0, cacheRead: 0, cost: 0 };
}

function addInto(bucket, rec) {
  bucket.messages += 1;
  bucket.input += rec.input;
  bucket.output += rec.output;
  bucket.cacheWrite += rec.cacheWrite;
  bucket.cacheRead += rec.cacheRead;
  bucket.cost += rec.cost;
}

function readClaudeUsage(options) {
  const opts = options || {};
  const dir = opts.dir || PROJECTS_DIR;

  if (!fs.existsSync(dir)) {
    return { available: false, reason: 'Không tìm thấy thư mục ~/.claude/projects' };
  }

  const files = listTranscripts(dir);
  if (files.length === 0) {
    return { available: false, reason: 'Chưa có phiên Claude Code nào được ghi lại' };
  }

  const byModel = {};
  const byDay = {};
  const totals = emptyBucket();
  // The same assistant message can appear in more than one transcript when a
  // session is resumed or forked, so count each message id at most once.
  const seen = new Set();
  let unpriced = 0;

  for (const file of files) {
    let content;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch (e) {
      continue;
    }
    for (const line of content.split('\n')) {
      if (!line) continue;
      let row;
      try {
        row = JSON.parse(line);
      } catch (e) {
        continue;
      }
      const message = row && row.message;
      const usage = message && message.usage;
      if (!usage) continue;

      const model = message.model || 'unknown';
      // Synthetic turns carry zeroed counters and are not real API calls.
      if (model === '<synthetic>') continue;

      if (message.id) {
        if (seen.has(message.id)) continue;
        seen.add(message.id);
      }

      const rec = {
        input: usage.input_tokens || 0,
        output: usage.output_tokens || 0,
        cacheWrite: usage.cache_creation_input_tokens || 0,
        cacheRead: usage.cache_read_input_tokens || 0,
        cost: 0,
      };

      const price = priceFor(model);
      if (price) {
        rec.cost =
          (rec.input * price.input +
            rec.output * price.output +
            rec.cacheWrite * price.cacheWrite +
            rec.cacheRead * price.cacheRead) /
          1_000_000;
      } else {
        unpriced += 1;
      }

      if (!byModel[model]) byModel[model] = emptyBucket();
      addInto(byModel[model], rec);
      addInto(totals, rec);

      const day = typeof row.timestamp === 'string' ? row.timestamp.slice(0, 10) : null;
      if (day) {
        if (!byDay[day]) byDay[day] = emptyBucket();
        addInto(byDay[day], rec);
      }
    }
  }

  if (totals.messages === 0) {
    return { available: false, reason: 'Các transcript không chứa số liệu token' };
  }

  const models = Object.keys(byModel)
    .map((name) => Object.assign({ model: name, priced: priceFor(name) !== null }, byModel[name]))
    .sort((a, b) => b.input + b.cacheRead - (a.input + a.cacheRead));

  const days = Object.keys(byDay)
    .sort()
    .map((day) => Object.assign({ day }, byDay[day]));

  const billable = totals.input + totals.output + totals.cacheWrite;
  const readTotal = totals.cacheRead + totals.input;

  return {
    available: true,
    sessions: files.length,
    totals,
    models,
    days,
    // Share of prompt tokens served from cache. High is good: cache reads are
    // roughly a tenth the price of fresh input.
    cacheHitRate: readTotal > 0 ? totals.cacheRead / readTotal : 0,
    billableTokens: billable,
    unpricedMessages: unpriced,
    costIsEstimate: true,
  };
}

module.exports = { readClaudeUsage, PROJECTS_DIR };
