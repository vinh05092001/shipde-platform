'use strict';

/**
 * Ship Dễ — TASK-AI-78 (Gate C): output virtualization. Matrix: test/task-ai-78.test.js.
 * Tool output is the largest and least useful thing an agent pays for: under a threshold it comes back
 * verbatim, above it the raw text is parked as one redacted artifact plus a bounded summary and handle.
 *
 * O-R01 virtualize(text, {thresholdBytes=8192, dir}) returns the text unchanged under the threshold;
 *   above it stores the redacted text as <sha256>.txt and returns {summary, sha256, handle}, where the
 *   summary is head 40 lines + tail 40 lines + byte and line counts.
 * O-R02 Redaction happens before storage and reuses scrubText from ./decisions, the scrubber evidence.js
 *   uses, so no second secret regex set lives here; read() re-scrubs defensively.
 * O-R03 read(handle, {grep?, startLine?, endLine?, maxBytes=4096}) returns a bounded slice: a grep or
 *   line-range window. Whole lines are kept; a first line that alone exceeds maxBytes is clipped to it
 *   and truncated is reported, so maxBytes is a hard ceiling.
 * O-R04 rotate({dir, maxAgeMs, maxBytes}) deletes the oldest artifacts past the limits, inside dir only.
 */

const CRYPTO = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { scrubText } = require('./decisions');

const DEFAULT_THRESHOLD_BYTES = 8192;
const DEFAULT_MAX_BYTES = 4096;
const SUMMARY_LINES = 40;
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_STORE_BYTES = 5 * 1024 * 1024;
const ARTIFACT_RE = /^[0-9a-f]{64}\.txt$/;
const HANDLE_RE = /^[0-9a-f]{64}$/;

/** handle -> absolute artifact path, for this process only. Never persisted, never a daemon. */
const handles = new Map();
const isName = (value) => typeof value === 'string' && value.trim() !== '';
const positive = (value, fallback) => (Number.isFinite(value) && value > 0 ? value : fallback);
const defaultDir = () => path.join(os.tmpdir(), 'shipde-output-store');
const lines = (text) => (text.endsWith('\n') ? text.slice(0, -1) : text).split('\n');
const inside = (dir, target) => !path.relative(dir, target).startsWith('..');

/** Clip one line to a byte room, dropping characters so a multi-byte sequence is never split. */
function clipToBytes(line, room) {
  let cut = Math.min(line.length, room);
  while (cut > 0 && Buffer.byteLength(line.slice(0, cut), 'utf8') + 1 > room) cut -= 1;
  return line.slice(0, cut);
}

function summarise(text) {
  const all = lines(text);
  const head = all.slice(0, SUMMARY_LINES);
  const tail = all.slice(Math.max(0, all.length - SUMMARY_LINES));
  return {
    head: head.join('\n'),
    tail: tail.join('\n'),
    lines: all.length,
    omittedLines: Math.max(0, all.length - head.length - tail.length),
    bytes: Buffer.byteLength(text, 'utf8'),
  };
}

/** O-R01/O-R02 park oversized output as one redacted artifact; hand back a summary and a handle. */
function virtualize(text, options) {
  const opts = options || {};
  const raw = typeof text === 'string' ? text : String(text == null ? '' : text);
  const threshold = positive(opts.thresholdBytes, DEFAULT_THRESHOLD_BYTES);
  if (Buffer.byteLength(raw, 'utf8') <= threshold) return raw;

  const redacted = scrubText(raw);
  const sha256 = CRYPTO.createHash('sha256').update(redacted, 'utf8').digest('hex');
  const dir = path.resolve(isName(opts.dir) ? opts.dir : defaultDir());
  const file = path.join(dir, `${sha256}.txt`);
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, redacted, 'utf8');
  handles.set(sha256, file);
  return { summary: summarise(redacted), sha256, handle: sha256, path: file };
}

/** O-R03 bounded slice of a parked artifact: grep, line range or head, always clipped to maxBytes. */
function read(handle, options) {
  const opts = options || {};
  const asked = isName(handle) && handle.startsWith('sha256:') ? handle.slice(7) : handle;
  if (!isName(asked) || !HANDLE_RE.test(asked.trim())) return { ok: false, code: 'HANDLE_INVALID' };
  const id = asked.trim();
  const file = isName(opts.dir) ? path.join(path.resolve(opts.dir), `${id}.txt`) : handles.get(id);
  if (!file || !inside(path.dirname(file), file) || !fs.existsSync(file)) {
    return { ok: false, code: 'ARTIFACT_NOT_FOUND', handle: id };
  }

  const all = lines(scrubText(fs.readFileSync(file, 'utf8')));
  const maxBytes = positive(opts.maxBytes, DEFAULT_MAX_BYTES);
  const start = Number.isInteger(opts.startLine) && opts.startLine > 0 ? opts.startLine : 1;
  const end = Number.isInteger(opts.endLine) && opts.endLine >= start ? opts.endLine : all.length;
  const window = all.slice(Math.min(start - 1, all.length), Math.min(end, all.length));

  const matches = isName(opts.grep)
    ? window
        .map((text, at) => ({ line: start + at, text }))
        .filter((hit) => hit.text.includes(opts.grep))
    : null;
  const wanted = matches ? matches.map((hit) => hit.text) : window;

  // Whole lines are preserved; a first line that alone busts maxBytes is clipped to it, never returned
  // whole and never over the ceiling.
  const kept = [];
  let bytes = 0;
  let truncated = false;
  for (const line of wanted) {
    const room = maxBytes - bytes;
    if (Buffer.byteLength(line, 'utf8') + 1 > room) {
      if (kept.length === 0 && room > 1) {
        const clipped = clipToBytes(line, room);
        kept.push(clipped);
        bytes += Buffer.byteLength(clipped, 'utf8') + 1;
      }
      truncated = true;
      break;
    }
    kept.push(line);
    bytes += Buffer.byteLength(line, 'utf8') + 1;
  }
  if (kept.length < wanted.length) truncated = true;
  const text = kept.join('\n');
  const hits = { matched: matches ? matches.length : null, matches, lines: kept, text };
  return Object.assign({ ok: true, handle: id, bytes, truncated, totalLines: all.length }, hits);
}

/** O-R04 drop the oldest artifacts past maxAgeMs, then past maxBytes. Never leaves dir. */
function rotate(options) {
  const opts = options || {};
  const dir = path.resolve(isName(opts.dir) ? opts.dir : defaultDir());
  const maxAgeMs = positive(opts.maxAgeMs, DEFAULT_MAX_AGE_MS);
  const maxBytes = positive(opts.maxBytes, DEFAULT_STORE_BYTES);
  if (!fs.existsSync(dir)) return { ok: true, dir, scanned: 0, deleted: [], kept: 0, bytes: 0 };

  const found = [];
  for (const name of fs.readdirSync(dir)) {
    if (!ARTIFACT_RE.test(name)) continue;
    const full = path.join(dir, name);
    if (!inside(dir, full)) continue;
    const stat = fs.lstatSync(full, { throwIfNoEntry: false });
    if (stat && stat.isFile()) found.push({ name, full, size: stat.size, mtimeMs: stat.mtimeMs });
  }
  // Newest first: the survivors are the newest artifacts that still fit, so what goes is the oldest.
  found.sort((a, b) => b.mtimeMs - a.mtimeMs || (a.name < b.name ? 1 : -1));
  const keep = new Set();
  const cutoff = Date.now() - maxAgeMs;
  let bytes = 0;
  for (const file of found) {
    if (file.mtimeMs < cutoff) break;
    if (bytes + file.size > maxBytes) continue;
    keep.add(file.name);
    bytes += file.size;
  }

  const deleted = [];
  const stuck = [];
  for (const file of found) {
    if (keep.has(file.name)) continue;
    try {
      fs.rmSync(file.full, { force: true });
      deleted.push(file.name);
      handles.delete(file.name.replace('.txt', ''));
    } catch {
      stuck.push(file.size);
    }
  }
  const keptBytes = bytes + stuck.reduce((sum, size) => sum + size, 0);
  const keptCount = keep.size + stuck.length;
  const outcome = { dir, scanned: found.length, deleted: deleted.sort() };
  return Object.assign({ ok: true, kept: keptCount, bytes: keptBytes }, outcome);
}

module.exports = { virtualize, read, rotate, summarise, DEFAULT_THRESHOLD_BYTES };
