/**
 * Ship Dễ — Delivery Register CSV Adapter
 * TASK-AI-15: AI15-R01, AI15-R02, AI15-AC01
 * Parses canonical FEATURE-DELIVERY-REGISTER.csv on disk with RFC 4180
 * quotation and multiline support, derives counts, active work item, and gate states.
 */

const fs = require('fs');
const path = require('path');

// AI15-R06: bounded file reads. Real Work Item documents are a few KB;
// anything far larger is refused rather than read, and each resolved path
// is only re-parsed when its mtime actually changes.
const MAX_WORK_ITEM_FILE_BYTES = 200 * 1024;
const workItemAuthorCache = new Map(); // resolvedPath -> { mtimeMs, author }

/**
 * Reads the Work Item markdown referenced by `work_item_path` and parses
 * its explicit `| Assigned author | \`VALUE\` |` control-table row. Never
 * infers anything from the work_item_id. Every failure mode (missing file,
 * oversized file, path escaping rootDir, unparseable content) safely
 * returns null so the caller can fall back to UNKNOWN.
 */
function resolveAssignedAuthorFromWorkItem(workItemPath, rootDir) {
  if (!workItemPath || typeof workItemPath !== 'string' || !rootDir) return null;

  const safeRoot = path.resolve(rootDir);
  const resolved = path.resolve(safeRoot, workItemPath.replace(/^[\\/]+/, ''));

  // Defense in depth: never read outside the repository root, even though
  // work_item_path comes from the register file rather than a client request.
  if (resolved !== safeRoot && !resolved.startsWith(safeRoot + path.sep)) {
    return null;
  }

  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch {
    return null;
  }
  if (!stat.isFile() || stat.size > MAX_WORK_ITEM_FILE_BYTES) {
    return null;
  }

  const cached = workItemAuthorCache.get(resolved);
  if (cached && cached.mtimeMs === stat.mtimeMs) {
    return cached.author;
  }

  let content;
  try {
    content = fs.readFileSync(resolved, 'utf-8');
  } catch {
    return null;
  }

  const match = content.match(/\|\s*Assigned author\s*\|\s*`([^`]+)`/i);
  const author = match ? match[1].trim() : null;

  workItemAuthorCache.set(resolved, { mtimeMs: stat.mtimeMs, author });
  return author;
}

function resetWorkItemAuthorCacheForTest() {
  workItemAuthorCache.clear();
}

// Authoritative author derivation per AGENTS.md: an explicit assigned_author
// field on the register row wins; otherwise the Work Item's own markdown
// document (`| Assigned author | \`VALUE\` |`) is the source of truth when a
// rootDir is available to read it from. The author is never inferred from a
// work_item_id prefix or naming convention — with neither source available,
// the item is honestly UNKNOWN (AI15-R01: evidence before status).
function deriveAuthor(item, rootDir) {
  if (item.assigned_author && item.assigned_author.trim()) {
    return item.assigned_author.trim();
  }
  if (rootDir && item.work_item_path) {
    const fromDoc = resolveAssignedAuthorFromWorkItem(item.work_item_path, rootDir);
    if (fromDoc) return fromDoc;
  }
  return 'UNKNOWN';
}

/**
 * RFC 4180 compliant CSV parser
 * Supports:
 * - Embedded commas in quoted values
 * - Escaped double quotes ("")
 * - Embedded newlines inside quotes
 * - Windows CRLF and Unix LF line endings
 */
function parseRegisterCsv(text, rootDir) {
  if (typeof text !== 'string' || !text.trim()) return [];

  const rows = [];
  let currentRow = [];
  let currentField = '';
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  while (i < len) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        // Check for escaped quote ("")
        if (i + 1 < len && text[i + 1] === '"') {
          currentField += '"';
          i += 2;
          continue;
        } else {
          // Closing quote
          inQuotes = false;
          i++;
          continue;
        }
      } else {
        currentField += char;
        i++;
        continue;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
        i++;
        continue;
      } else if (char === ',') {
        currentRow.push(currentField.trim());
        currentField = '';
        i++;
        continue;
      } else if (char === '\r') {
        if (i + 1 < len && text[i + 1] === '\n') {
          i++; // Skip \n in CRLF
        }
        currentRow.push(currentField.trim());
        currentField = '';
        if (currentRow.length > 0 && currentRow.some((f) => f.length > 0)) {
          rows.push(currentRow);
        }
        currentRow = [];
        i++;
        continue;
      } else if (char === '\n') {
        currentRow.push(currentField.trim());
        currentField = '';
        if (currentRow.length > 0 && currentRow.some((f) => f.length > 0)) {
          rows.push(currentRow);
        }
        currentRow = [];
        i++;
        continue;
      } else {
        currentField += char;
        i++;
        continue;
      }
    }
  }

  // Flush remaining field/row
  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.length > 0 && currentRow.some((f) => f.length > 0)) {
      rows.push(currentRow);
    }
  }

  if (rows.length < 2) return [];

  const headers = rows[0].map((h) => h.toLowerCase().trim());
  const items = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.length === 0 || (row.length === 1 && !row[0])) continue;

    const item = {};
    headers.forEach((h, idx) => {
      item[h] = row[idx] !== undefined ? row[idx] : '';
    });

    item.assigned_author = deriveAuthor(item, rootDir);
    items.push(item);
  }

  return items;
}

/**
 * Derives comprehensive statistics, active item, and gate status from parsed items
 */
function deriveRegisterState(items, preferredBranch = null) {
  const total = items.length;
  const byStatus = {};
  const bySlice = {};
  let mergedCount = 0;

  for (const item of items) {
    const status = item.status || 'UNKNOWN';
    byStatus[status] = (byStatus[status] || 0) + 1;

    const slice = item.slice || 'UNKNOWN';
    bySlice[slice] = (bySlice[slice] || 0) + 1;

    if (status === 'MERGED') {
      mergedCount++;
    }
  }

  const completionPercent = total > 0 ? ((mergedCount / total) * 100).toFixed(1) : '0.0';

  // Active work item priority:
  // 1. Current worktree branch match (if not merged)
  // 2. IN_PROGRESS
  // 3. READY_FOR_CODEX
  // 4. READY_FOR_AUTHOR
  // 5. First non-merged item
  let activeItem = null;
  if (preferredBranch) {
    activeItem = items.find((it) => it.branch === preferredBranch && it.status !== 'MERGED');
  }
  if (!activeItem) {
    activeItem = items.find((it) => it.status === 'IN_PROGRESS');
  }
  if (!activeItem) {
    activeItem = items.find((it) => it.status === 'READY_FOR_CODEX');
  }
  if (!activeItem) {
    activeItem = items.find((it) => it.status === 'READY_FOR_AUTHOR');
  }
  if (!activeItem) {
    activeItem = items.find((it) => it.status && it.status !== 'MERGED');
  }

  // Derive delivery gate pipeline for the active item
  const gatePipeline = deriveGatePipeline(activeItem);

  return {
    total,
    mergedCount,
    completionPercent,
    byStatus,
    bySlice,
    activeItem: activeItem || null,
    gatePipeline,
    items,
  };
}

/**
 * Derives the delivery gate pipeline for the active item.
 *
 * AI15-R03 (gate integrity): the register's own `status`/`codex_verdict`
 * fields are register evidence only. They can legitimately drive the
 * SPEC_READY/AUTHORING gates (the register is authoritative for its own
 * authoring state), but CODEX_REVIEW, CI_GATES and HUMAN_MERGE can never be
 * shown as passed/ready from register data alone — those require live,
 * exact-HEAD GitHub PR evidence, passed in as `githubEvidence`.
 *
 * @param {object|null} activeItem
 * @param {{available:boolean, headMatches:boolean, ciPassed:boolean, codexPass:boolean}|null} githubEvidence
 *   Pass null (the default) when no live GitHub cross-check was performed —
 *   e.g. a standalone/offline register read. In that case downstream gates
 *   are reported UNAVAILABLE rather than inferred PASSED.
 */
function deriveGatePipeline(activeItem, githubEvidence = null) {
  if (!activeItem) {
    return {
      currentGate: 'IDLE',
      gates: [
        { name: 'SPEC_READY', label: '1. Specification', status: 'IDLE' },
        { name: 'AUTHORING', label: '2. Implementation Author', status: 'IDLE' },
        { name: 'CODEX_REVIEW', label: '3. Independent Codex Review', status: 'IDLE' },
        { name: 'CI_GATES', label: '4. Exact-HEAD CI', status: 'IDLE' },
        { name: 'HUMAN_MERGE', label: '5. Merge Owner Gate', status: 'IDLE' },
      ],
    };
  }

  const status = activeItem.status || '';
  let currentGate = 'AUTHORING';

  const gates = [
    { name: 'SPEC_READY', label: '1. Specification', status: 'PASSED' },
    { name: 'AUTHORING', label: '2. Implementation Author', status: 'PENDING' },
    { name: 'CODEX_REVIEW', label: '3. Independent Codex Review', status: 'PENDING' },
    { name: 'CI_GATES', label: '4. Exact-HEAD CI', status: 'PENDING' },
    { name: 'HUMAN_MERGE', label: '5. Merge Owner Gate', status: 'PENDING' },
  ];

  const evidenceAvailable = Boolean(githubEvidence && githubEvidence.available);
  const headMatches = evidenceAvailable && githubEvidence.headMatches === true;
  const ciPassed = headMatches && githubEvidence.ciPassed === true;
  const codexPass = headMatches && githubEvidence.codexPass === true;

  if (status === 'READY_FOR_AUTHOR') {
    gates[1].status = 'READY';
    currentGate = 'AUTHORING';
  } else if (status === 'IN_PROGRESS') {
    gates[1].status = 'IN_PROGRESS';
    currentGate = 'AUTHORING';
  } else if (status === 'CHANGES_REQUIRED') {
    gates[1].status = 'FAILED';
    gates[2].status = 'FAILED';
    currentGate = 'AUTHORING';
  } else if (status === 'MERGED') {
    gates.forEach((g) => (g.status = 'PASSED'));
    currentGate = 'MERGED';
  } else if (status.startsWith('BLOCKED')) {
    gates[0].status = 'BLOCKED';
    currentGate = 'BLOCKED';
  } else if (status === 'READY_FOR_CODEX' || status === 'READY_FOR_HUMAN_MERGE') {
    // Authoring is done per the register. Every downstream gate is proven
    // solely by live, exact-HEAD GitHub PR evidence — never by the register
    // status or codex_verdict fields themselves.
    gates[1].status = 'PASSED';

    if (!evidenceAvailable || !headMatches) {
      gates[2].status = 'UNAVAILABLE';
      gates[3].status = 'UNAVAILABLE';
      gates[4].status = 'UNAVAILABLE';
      currentGate = 'EVIDENCE_UNAVAILABLE';
    } else {
      gates[2].status = codexPass ? 'PASSED' : 'IN_PROGRESS';
      gates[3].status = ciPassed ? 'PASSED' : 'IN_PROGRESS';

      const isPreflightReady =
        githubEvidence && typeof githubEvidence.readyForMerge === 'boolean'
          ? githubEvidence.readyForMerge
          : codexPass &&
            ciPassed &&
            githubEvidence.mergeable !== false &&
            githubEvidence.unresolvedThreadsVerified !== false;

      if (isPreflightReady) {
        gates[4].status = 'READY';
        currentGate = 'HUMAN_MERGE';
      } else if (codexPass && ciPassed) {
        gates[4].status = 'PENDING';
        currentGate = 'PREFLIGHT_PENDING';
      } else {
        currentGate = 'CODEX_REVIEW';
      }
    }
  }

  return { currentGate, gates };
}

/**
 * Loads and parses canonical CSV from disk with error capture.
 * `rootDir`, when given, is the repository root used to resolve each row's
 * work_item_path for the Assigned author lookup (AI15-R01/R06); omitting it
 * simply skips that lookup and falls back to UNKNOWN — it never crashes.
 */
function loadRegister(filePath, preferredBranch = null, rootDir = null) {
  const startTime = Date.now();
  try {
    if (!fs.existsSync(filePath)) {
      return {
        health: {
          name: 'register',
          status: 'unavailable',
          observedAt: new Date().toISOString(),
          latencyMs: Date.now() - startTime,
          provenance: filePath,
          impact: 'Delivery register file does not exist on disk',
          error: `File not found: ${filePath}`,
        },
        data: deriveRegisterState([]),
      };
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const items = parseRegisterCsv(content, rootDir);
    const derived = deriveRegisterState(items, preferredBranch);

    return {
      health: {
        name: 'register',
        status: 'live',
        observedAt: new Date().toISOString(),
        latencyMs: Date.now() - startTime,
        provenance: filePath,
        impact: 'None — canonical delivery register healthy',
        error: null,
      },
      data: derived,
    };
  } catch (err) {
    return {
      health: {
        name: 'register',
        status: 'unavailable',
        observedAt: new Date().toISOString(),
        latencyMs: Date.now() - startTime,
        provenance: filePath,
        impact: 'Cannot read delivery queue',
        error: err.message,
      },
      data: deriveRegisterState([]),
    };
  }
}

module.exports = {
  parseRegisterCsv,
  deriveAuthor,
  deriveRegisterState,
  deriveGatePipeline,
  loadRegister,
  resolveAssignedAuthorFromWorkItem,
  resetWorkItemAuthorCacheForTest,
};
