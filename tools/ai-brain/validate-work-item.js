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

const ALLOWED_FLAGS = new Set(['wi', 'file', 'register', 'json']);
const PLACEHOLDER_PATTERN = /^(?:tbd|todo|none|n\/a|<[^>]+>|-+)$/i;

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
    if (key === 'json') {
      out.json = true;
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

function validateWorkItem({ workItemId, filePath, registerPath }) {
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
      hasAllowedPaths: Boolean(
        mdAllowedPaths && !PLACEHOLDER_PATTERN.test(stripBackticks(mdAllowedPaths))
      ),
      hasAcceptanceSection: Boolean(acceptance.present && acceptance.body),
      hasVerificationSection: Boolean(verification.present && verification.body),
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
  const { wi, file, register } = parsed.args;
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
  });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  return result.ok ? 0 : 1;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { validateWorkItem, parseCliArgs, main };
