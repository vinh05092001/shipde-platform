#!/usr/bin/env node
'use strict';

/**
 * Ship Dễ — Read-only Work Item Handoff Validator (TASK-AI-227 Pilot)
 *
 * Usage:
 *   node tools/ai-brain/validate-work-item.js --wi <ID> --file <WI_MD_PATH> --register <CSV_PATH>
 *
 * Strictly read-only: checks handoff metadata readiness of one Work Item
 * against its corresponding FEATURE-DELIVERY-REGISTER.csv row.
 */

const fs = require('node:fs');
const path = require('node:path');
const { parseCsvRecords } = require('./reconcile');

const ALLOWED_FLAGS = new Set(['wi', 'file', 'register', 'json', 'strict']);
const PLACEHOLDER_PATTERN = /^(?:tbd|todo|none|n\/a|<[^>]+>|-+)$/i;
const DIFFICULTY_PATTERN = /^L[1-4]$/;

function parseCliArgs(argv) {
  const out = {};
  const unknown = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      unknown.push(token);
      continue;
    }
    const key = token.slice(2);
    if (!ALLOWED_FLAGS.has(key)) {
      unknown.push(token);
      continue;
    }
    if (key === 'json' || key === 'strict') {
      out[key] = true;
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      return { error: { code: 'MISSING_FLAG_VALUE', message: `Missing value for --${key}` } };
    }
    out[key] = next;
    i += 1;
  }
  if (unknown.length > 0) {
    return {
      error: {
        code: 'UNKNOWN_ARGUMENTS',
        message: `Unknown CLI arguments: ${unknown.join(', ')}`,
      },
    };
  }
  return { args: out };
}

function stripBackticks(value) {
  return String(value || '')
    .trim()
    .replace(/^`+|`+$/g, '')
    .trim();
}

function parseControlTable(markdown) {
  const fields = {};
  const lines = String(markdown || '').split(/\r?\n/);
  let inControl = false;
  for (const line of lines) {
    if (/^##\s+Control\b/i.test(line)) {
      inControl = true;
      continue;
    }
    if (inControl && /^##\s+/.test(line)) {
      break;
    }
    if (!inControl) continue;
    const match = line.match(/^\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|/);
    if (!match) continue;
    const rawKey = match[1].trim();
    const rawVal = match[2].trim();
    if (/^field$/i.test(rawKey) || /^-+$/.test(rawKey.replace(/\s+/g, ''))) continue;
    fields[rawKey.toLowerCase()] = rawVal;
  }
  return fields;
}

function extractSectionBody(markdown, headingRegex) {
  const lines = String(markdown || '').split(/\r?\n/);
  let collecting = false;
  const collected = [];
  for (const line of lines) {
    if (headingRegex.test(line)) {
      collecting = true;
      continue;
    }
    if (collecting && /^##\s+/.test(line)) {
      break;
    }
    if (collecting) {
      collected.push(line);
    }
  }
  return {
    present: collecting,
    body: collected.join('\n').trim(),
  };
}

function scanTopLevelSection(markdown, headingRegex) {
  const lines = String(markdown || '').split(/\r?\n/);
  let fenceChar = null;
  let fenceLen = 0;
  let matchCount = 0;
  let collecting = false;
  const collected = [];

  for (const line of lines) {
    const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      const ch = marker[0];
      if (!fenceChar) {
        fenceChar = ch;
        fenceLen = marker.length;
      } else if (
        ch === fenceChar &&
        marker.length >= fenceLen &&
        /^\s{0,3}(?:`{3,}|~{3,})\s*$/.test(line)
      ) {
        fenceChar = null;
        fenceLen = 0;
      }
      if (collecting) {
        collected.push(line);
      }
      continue;
    }

    if (!fenceChar) {
      if (headingRegex.test(line)) {
        matchCount += 1;
        if (matchCount === 1) {
          collecting = true;
          continue;
        }
        if (collecting) {
          collecting = false;
        }
        continue;
      }
      if (collecting && /^##\s+/.test(line)) {
        collecting = false;
        continue;
      }
    }

    if (collecting) {
      collected.push(line);
    }
  }

  return {
    present: matchCount > 0,
    count: matchCount,
    body: collected.join('\n').trim(),
  };
}

const EXTERNAL_OSS_ANCHORED_PATTERN =
  /^EXTERNAL_OSS\s+(https?:\/\/\S+)\s+pin:([^\s,;)]+)\s+SPDX:([^\s,;)]+)(?:$|\s)/i;
const CONCRETE_PIN_PATTERN = /^(?:v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?|[0-9a-f]{7,40})$/i;
const KNOWN_SPDX_EXACT_PATTERN =
  /^(?:MIT|Apache-2\.0|BSD-2-Clause|BSD-3-Clause|ISC|MPL-2\.0|Unlicense|CC0-1\.0|0BSD|BSL-1\.0|Zlib|PSF-2\.0|Artistic-2\.0)$/;
const COMMAND_RUNNER_PATTERN =
  /^(?:pnpm|npm|npx|node|python|python3|pytest|pwsh|powershell|git|bash|sh|vitest|jest|playwright)\s+\S+/i;

function validateReuseDecisionValue(raw) {
  const value = stripBackticks(raw);
  if (!value || PLACEHOLDER_PATTERN.test(value)) {
    return {
      valid: false,
      reason: 'Control Reuse Decision must be non-empty and not a placeholder',
    };
  }
  if (/^(?:IN_REPO|APPROVED_DEP)(?:$|\s|[:—(-])/.test(value)) {
    return { valid: true, value };
  }
  if (/^EXTERNAL_OSS(?:$|\s|[:—(-])/.test(value)) {
    const match = value.match(EXTERNAL_OSS_ANCHORED_PATTERN);
    if (!match) {
      return {
        valid: false,
        reason:
          'EXTERNAL_OSS Reuse Decision must follow exact format: EXTERNAL_OSS https://<url> pin:<semver|commit> SPDX:<id>',
      };
    }
    const [, , pinValue, spdxValue] = match;
    if (!CONCRETE_PIN_PATTERN.test(pinValue) || !KNOWN_SPDX_EXACT_PATTERN.test(spdxValue)) {
      return {
        valid: false,
        reason:
          'EXTERNAL_OSS Reuse Decision requires a concrete pinned semver or 7-40 hex commit in pin:<...> and a recognized SPDX ID in SPDX:<...> (subject to repository license review)',
      };
    }
    return { valid: true, value };
  }
  return {
    valid: false,
    reason: `Control Reuse Decision "${value}" must start with IN_REPO, APPROVED_DEP, or EXTERNAL_OSS`,
  };
}

function hasWherePathLineAnchor(body) {
  return /(?:[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+|[A-Za-z0-9_.-]+\.[A-Za-z0-9]+):\d+(?:-\d+)?\b/.test(
    String(body || '')
  );
}

function hasVerifyRedEvidence(body) {
  const text = String(body || '').trim();
  if (!text || PLACEHOLDER_PATTERN.test(text)) {
    return false;
  }
  const lines = text.split(/\r?\n/);
  let inFence = false;
  let fenceChar = null;
  let fenceLen = 0;

  for (const rawLine of lines) {
    const fenceMatch = rawLine.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      const ch = marker[0];
      if (!inFence) {
        inFence = true;
        fenceChar = ch;
        fenceLen = marker.length;
      } else if (
        ch === fenceChar &&
        marker.length >= fenceLen &&
        /^\s{0,3}(?:`{3,}|~{3,})\s*$/.test(rawLine)
      ) {
        inFence = false;
        fenceChar = null;
        fenceLen = 0;
      }
      continue;
    }

    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    if (!inFence && /^[-*]?\s*test not applicable\s*:\s*(\S.+)$/i.test(trimmed)) {
      const justMatch = trimmed.match(/^[-*]?\s*test not applicable\s*:\s*(.+)$/i);
      if (justMatch && !PLACEHOLDER_PATTERN.test(justMatch[1].trim())) {
        return true;
      }
    }

    const candidateLine = inFence ? trimmed : trimmed.replace(/^[-*]\s+/, '').trim();
    if (COMMAND_RUNNER_PATTERN.test(candidateLine)) {
      return true;
    }

    if (!inFence) {
      const inlineCodeMatches = trimmed.match(/`([^`\n]+)`/g) || [];
      for (const token of inlineCodeMatches) {
        const inner = token.slice(1, -1).trim();
        if (COMMAND_RUNNER_PATTERN.test(inner)) {
          return true;
        }
      }
    }
  }
  return false;
}

function validateWorkItem({ workItemId, filePath, registerPath, strict = false }) {
  const errors = [];
  const warnings = [];

  if (!fs.existsSync(filePath)) {
    return {
      ok: false,
      ready: false,
      workItemId,
      errors: [
        { code: 'WORK_ITEM_FILE_MISSING', message: `Work Item file not found: ${filePath}` },
      ],
      warnings,
    };
  }
  if (!fs.existsSync(registerPath)) {
    return {
      ok: false,
      ready: false,
      workItemId,
      errors: [
        { code: 'REGISTER_FILE_MISSING', message: `Register CSV not found: ${registerPath}` },
      ],
      warnings,
    };
  }

  const mdText = fs.readFileSync(filePath, 'utf8');
  const csvText = fs.readFileSync(registerPath, 'utf8');
  const records = parseCsvRecords(csvText);

  if (records.length < 2) {
    errors.push({ code: 'REGISTER_MALFORMED', message: 'Register CSV has no data rows' });
    return { ok: false, ready: false, workItemId, errors, warnings };
  }

  const headers = records[0].fields.map((h) => String(h || '').trim());
  const col = {
    id: headers.indexOf('work_item_id'),
    status: headers.indexOf('status'),
    branch: headers.indexOf('branch'),
    path: headers.indexOf('work_item_path'),
  };
  if (col.id < 0 || col.status < 0 || col.branch < 0) {
    errors.push({
      code: 'REGISTER_MISSING_COLUMNS',
      message: 'Register CSV is missing required columns (work_item_id, status, branch)',
    });
    return { ok: false, ready: false, workItemId, errors, warnings };
  }

  const matches = [];
  for (let i = 1; i < records.length; i += 1) {
    const f = records[i].fields;
    if (f[col.id] === workItemId) {
      matches.push({
        rowNumber: i + 1,
        workItemId: String(f[col.id] || '').trim(),
        status: String(f[col.status] || '').trim(),
        branch: String(f[col.branch] || '').trim(),
        workItemPath: col.path >= 0 ? String(f[col.path] || '').trim() : '',
      });
    }
  }

  let regRow = null;
  if (matches.length === 0) {
    errors.push({
      code: 'REGISTER_ROW_MISSING',
      message: `No register row found for ${workItemId}`,
    });
  } else if (matches.length > 1) {
    errors.push({
      code: 'REGISTER_DUPLICATE_ROW',
      message: `Duplicate register rows (${matches.length}) found for ${workItemId}`,
    });
    regRow = matches[0];
  } else {
    regRow = matches[0];
  }

  const control = parseControlTable(mdText);
  const mdId = stripBackticks(control['work item id']);
  const mdStatus = stripBackticks(control.status)
    .split(/\s+—\s+/)[0]
    .trim();
  const mdBranch = stripBackticks(control.branch)
    .split(/\s+—\s+/)[0]
    .trim();
  const mdAllowedPaths = String(control['allowed paths'] || '').trim();

  if (!mdId) {
    errors.push({ code: 'WORK_ITEM_ID_MISSING', message: 'Control table missing Work Item ID' });
  } else if (mdId !== workItemId) {
    errors.push({
      code: 'IDENTITY_MISMATCH',
      message: `Control Work Item ID "${mdId}" does not match requested "${workItemId}"`,
    });
  }

  if (!mdStatus) {
    errors.push({ code: 'STATUS_MISSING', message: 'Control table missing Status' });
  } else if (regRow && regRow.status && mdStatus !== regRow.status) {
    errors.push({
      code: 'STATUS_MISMATCH',
      message: `Control Status "${mdStatus}" does not match register status "${regRow.status}"`,
    });
  }

  if (!mdBranch || PLACEHOLDER_PATTERN.test(mdBranch)) {
    errors.push({ code: 'BRANCH_MISSING', message: 'Control table missing Branch' });
  } else if (regRow && regRow.branch && mdBranch !== regRow.branch) {
    errors.push({
      code: 'BRANCH_MISMATCH',
      message: `Control Branch "${mdBranch}" does not match register branch "${regRow.branch}"`,
    });
  }

  if (!mdAllowedPaths || PLACEHOLDER_PATTERN.test(stripBackticks(mdAllowedPaths))) {
    errors.push({
      code: 'ALLOWED_PATHS_MISSING',
      message: 'Control table missing non-empty Allowed paths',
    });
  }

  const acceptance = extractSectionBody(
    mdText,
    /^##\s+(?:Acceptance|Scope and acceptance|Acceptance matrix)\b/i
  );
  if (!acceptance.present || !acceptance.body) {
    errors.push({
      code: 'ACCEPTANCE_SECTION_MISSING',
      message: 'Work Item missing non-empty Acceptance section',
    });
  }

  const verification = extractSectionBody(
    mdText,
    /^##\s+(?:Verification|Verification commands)\b/i
  );
  if (!verification.present || !verification.body) {
    errors.push({
      code: 'VERIFICATION_SECTION_MISSING',
      message: 'Work Item missing non-empty Verification section',
    });
  }

  const targetList = strict ? errors : warnings;
  const hasDifficultyKey = Object.prototype.hasOwnProperty.call(control, 'difficulty');
  const mdDifficulty = stripBackticks(control.difficulty);
  if (!hasDifficultyKey) {
    targetList.push({
      code: 'DIFFICULTY_MISSING',
      message: 'Control table missing Difficulty (L1-L4)',
    });
  } else if (
    !mdDifficulty ||
    PLACEHOLDER_PATTERN.test(mdDifficulty) ||
    !DIFFICULTY_PATTERN.test(mdDifficulty)
  ) {
    errors.push({
      code: 'DIFFICULTY_INVALID',
      message: `Control Difficulty "${mdDifficulty}" must be one of L1, L2, L3, L4`,
    });
  }

  const hasReuseKey = Object.prototype.hasOwnProperty.call(control, 'reuse decision');
  const reuseCheck = hasReuseKey ? validateReuseDecisionValue(control['reuse decision']) : null;
  if (!hasReuseKey) {
    targetList.push({
      code: 'REUSE_DECISION_MISSING',
      message: 'Control table missing Reuse Decision',
    });
  } else if (!reuseCheck.valid) {
    errors.push({
      code: 'REUSE_DECISION_INVALID',
      message: reuseCheck.reason,
    });
  }

  const whereSection = scanTopLevelSection(mdText, /^##\s+WHERE\b/i);
  if (whereSection.count > 1) {
    errors.push({
      code: 'DUPLICATE_HEADING',
      message: 'Duplicate ## WHERE heading found',
    });
  }
  if (!whereSection.present) {
    targetList.push({
      code: 'WHERE_SECTION_MISSING',
      message: 'Work Item missing ## WHERE section',
    });
  } else if (!whereSection.body || PLACEHOLDER_PATTERN.test(whereSection.body)) {
    errors.push({
      code: 'WHERE_SECTION_EMPTY',
      message: 'Work Item ## WHERE section is declared but empty',
    });
  } else if (!hasWherePathLineAnchor(whereSection.body)) {
    errors.push({
      code: 'WHERE_ANCHOR_MISSING',
      message: 'Work Item ## WHERE section must include at least one path:line anchor',
    });
  }

  const verifyRedSection = scanTopLevelSection(mdText, /^##\s+Verify\s*&\s*RED\b/i);
  if (verifyRedSection.count > 1) {
    errors.push({
      code: 'DUPLICATE_HEADING',
      message: 'Duplicate ## Verify & RED heading found',
    });
  }
  if (!verifyRedSection.present) {
    targetList.push({
      code: 'VERIFY_RED_SECTION_MISSING',
      message: 'Work Item missing ## Verify & RED section',
    });
  } else if (!verifyRedSection.body || PLACEHOLDER_PATTERN.test(verifyRedSection.body)) {
    errors.push({
      code: 'VERIFY_RED_SECTION_EMPTY',
      message: 'Work Item ## Verify & RED section is declared but empty',
    });
  } else if (!hasVerifyRedEvidence(verifyRedSection.body)) {
    errors.push({
      code: 'VERIFY_RED_INVALID',
      message:
        'Work Item ## Verify & RED section must include an executable test command or "test not applicable: <justification>"',
    });
  }

  const ready = errors.length === 0;
  return {
    ok: ready,
    ready,
    workItemId,
    metadata: {
      filePath: path.resolve(filePath),
      registerPath: path.resolve(registerPath),
      controlId: mdId || null,
      status: mdStatus || null,
      registerStatus: regRow ? regRow.status : null,
      branch: mdBranch || null,
      registerBranch: regRow ? regRow.branch : null,
      difficulty: DIFFICULTY_PATTERN.test(mdDifficulty) ? mdDifficulty : null,
      reuseDecision: reuseCheck && reuseCheck.valid ? reuseCheck.value : null,
      strict: Boolean(strict),
      hasAllowedPaths: Boolean(
        mdAllowedPaths && !PLACEHOLDER_PATTERN.test(stripBackticks(mdAllowedPaths))
      ),
      hasAcceptanceSection: Boolean(acceptance.present && acceptance.body),
      hasVerificationSection: Boolean(verification.present && verification.body),
      hasWhereSection: Boolean(
        whereSection.present && whereSection.body && hasWherePathLineAnchor(whereSection.body)
      ),
      hasVerifyRedSection: Boolean(
        verifyRedSection.present &&
        verifyRedSection.body &&
        hasVerifyRedEvidence(verifyRedSection.body)
      ),
    },
    errors,
    warnings,
  };
}

function main(argv) {
  const parsed = parseCliArgs(argv);
  if (parsed.error) {
    process.stdout.write(JSON.stringify({ ok: false, ...parsed.error }, null, 2) + '\n');
    return 1;
  }
  const { wi, file, register, strict } = parsed.args;
  if (!wi || !file || !register) {
    process.stdout.write(
      JSON.stringify(
        {
          ok: false,
          code: 'MISSING_REQUIRED_ARGS',
          message: 'Required flags: --wi <ID> --file <WI_MD_PATH> --register <CSV_PATH>',
        },
        null,
        2
      ) + '\n'
    );
    return 1;
  }

  const result = validateWorkItem({
    workItemId: wi.trim(),
    filePath: file,
    registerPath: register,
    strict: Boolean(strict),
  });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  return result.ok ? 0 : 1;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { validateWorkItem, parseCliArgs, main };
