'use strict';

/**
 * Ship Dễ — Memory Promotion Gate (TASK-AI-22)
 *
 * Implements the promotion gate for proposed agent memory:
 *   - Propose: an agent writes a lesson in status "proposed", approved_by: null.
 *   - Approve: only human review moves status to "approved"; refuses self-approval
 *     (AI-22-R02) and agent approval (AI-22-R03).
 *   - Reject: moves proposed to "rejected" (approved_by stays null).
 *   - Supersede: moves a lesson to "superseded", requiring replacing lesson to be approved (AI-22-R06).
 *   - Authenticated approver from environment / GitHub CLI, never from input (AI-22-R04).
 *   - Promotion record: append-only JSONL log of transitions (AI-22-R08).
 *   - Schema validation: validated against lesson-schema.json before write (AI-22-R07).
 *   - No PII or credentials (AI-22-R09).
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { isAgentIdentity, AGENT_IDENTITIES } = require('../acceptance/lib/lesson-promotion');
const { matchesViolations } = require('../acceptance/lib/lesson-schema');

const DEFAULT_LESSONS_DIR = null;
const DEFAULT_SCHEMA_PATH = path.resolve(__dirname, 'lesson-schema.json');
const DEFAULT_RECORD_FILE = 'promotion-record.jsonl';

const REFUSAL_CODES = {
  SELF_APPROVAL: 'SELF_APPROVAL',
  AGENT_APPROVAL: 'AGENT_APPROVAL',
  INVALID_STATE: 'INVALID_STATE',
  UNAUTHENTICATED_APPROVER: 'UNAUTHENTICATED_APPROVER',
  SUPERSEDING_LESSON_MISSING: 'SUPERSEDING_LESSON_MISSING',
  SUPERSEDING_LESSON_NOT_APPROVED: 'SUPERSEDING_LESSON_NOT_APPROVED',
  SCHEMA_VIOLATION: 'SCHEMA_VIOLATION',
  CREDENTIALS_OR_PII_DETECTED: 'CREDENTIALS_OR_PII_DETECTED',
  LESSON_NOT_FOUND: 'LESSON_NOT_FOUND',
  LESSON_ALREADY_EXISTS: 'LESSON_ALREADY_EXISTS',
  MISSING_SUPERSEDING_ID: 'MISSING_SUPERSEDING_ID',
};

class PromotionError extends Error {
  constructor(code, detail) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'PromotionError';
    this.code = code;
    this.detail = detail || '';
  }
}

const CREDENTIAL_PATTERNS = [
  /-----BEGIN [A-Z ]+PRIVATE KEY-----/,
  /gh[pousr]_[A-Za-z0-9_]{20,}/,
  /sk-ant-[A-Za-z0-9_-]{10,}/,
  /sk-[A-Za-z0-9]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /(?:api[_-]?key|password|secret|auth_token)\s*[:=]\s*['"][^'"]+['"]/i,
];

const PII_PATTERNS = [
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/,
  /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/,
];

function detectCredentialsOrPii(value) {
  if (!value) return null;
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  for (const pattern of CREDENTIAL_PATTERNS) {
    if (pattern.test(text)) return 'CREDENTIAL_DETECTED';
  }
  for (const pattern of PII_PATTERNS) {
    if (pattern.test(text)) return 'PII_DETECTED';
  }
  return null;
}

function resolveLessonsDir(options = {}) {
  const dir = options.dir || options.lessonsDir || process.env.BRAIN_LESSONS_DIR;
  if (dir) return dir;
  throw new PromotionError(
    REFUSAL_CODES.LESSON_NOT_FOUND,
    'lessons directory must be specified via --dir or BRAIN_LESSONS_DIR; defaulting to the platform repository is not permitted'
  );
}

function resolveRecordPath(options = {}) {
  if (options.recordPath) return options.recordPath;
  const dir = resolveLessonsDir(options);
  const file = options.recordFile || DEFAULT_RECORD_FILE;
  return path.join(dir, file);
}

function loadSchema(schemaPath) {
  const p = schemaPath || DEFAULT_SCHEMA_PATH;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function validateLesson(lesson, schemaPath) {
  const schema = loadSchema(schemaPath);
  return matchesViolations(schema, lesson);
}

function getAuthenticatedApprover(options = {}) {
  const envUser = process.env.GITHUB_USER || process.env.GITHUB_ACTOR || process.env.GH_USER;
  if (envUser && typeof envUser === 'string' && envUser.trim()) {
    return envUser.trim();
  }
  try {
    const stdout = execFileSync('gh', ['api', 'user', '--jq', '.login'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10000,
    });
    const login = stdout.trim();
    if (login) return login;
  } catch (_) {
    // GitHub CLI query unavailable or unauthenticated
  }
  return null;
}

function resolveHeadSha(cwd) {
  try {
    const stdout = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: cwd || process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    });
    const sha = stdout.trim();
    if (/^[0-9a-f]{40}$/.test(sha)) return sha;
  } catch (_) {
    // git rev-parse failed
  }
  return null;
}

function readLesson(id, options = {}) {
  const dir = resolveLessonsDir(options);

  if (options.file && fs.existsSync(options.file)) {
    try {
      const raw = JSON.parse(fs.readFileSync(options.file, 'utf8'));
      if (raw.id === id) {
        return { lesson: raw, sourceFile: options.file, isCollection: false };
      }
      if (Array.isArray(raw.lessons)) {
        const found = raw.lessons.find((l) => l.id === id);
        if (found) {
          return { lesson: found, sourceFile: options.file, isCollection: true, collection: raw };
        }
      }
    } catch (_) {}
  }

  // Check <dir>/<id>.json
  const directFile = path.join(dir, `${id}.json`);
  if (fs.existsSync(directFile)) {
    try {
      const raw = JSON.parse(fs.readFileSync(directFile, 'utf8'));
      return { lesson: raw, sourceFile: directFile, isCollection: false };
    } catch (_) {}
  }

  // Check <dir>/store/<id>.json
  const storeFile = path.join(dir, 'store', `${id}.json`);
  if (fs.existsSync(storeFile)) {
    try {
      const raw = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
      return { lesson: raw, sourceFile: storeFile, isCollection: false };
    } catch (_) {}
  }

  // Check collection files in dir
  for (const collName of ['lessons.json', 'lesson-seed.json']) {
    const collPath = path.join(dir, collName);
    if (fs.existsSync(collPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(collPath, 'utf8'));
        if (Array.isArray(raw.lessons)) {
          const found = raw.lessons.find((l) => l.id === id);
          if (found) {
            return { lesson: found, sourceFile: collPath, isCollection: true, collection: raw };
          }
        }
      } catch (_) {}
    }
  }

  return null;
}

function writeLesson(lesson, meta, options = {}) {
  if (meta && meta.isCollection && meta.sourceFile && meta.collection) {
    const idx = meta.collection.lessons.findIndex((l) => l.id === lesson.id);
    if (idx >= 0) {
      meta.collection.lessons[idx] = lesson;
    } else {
      meta.collection.lessons.push(lesson);
    }
    fs.writeFileSync(meta.sourceFile, JSON.stringify(meta.collection, null, 2) + '\n', 'utf8');
    return meta.sourceFile;
  }

  const targetFile =
    (meta && meta.sourceFile) ||
    options.file ||
    path.join(resolveLessonsDir(options), `${lesson.id}.json`);
  fs.mkdirSync(path.dirname(targetFile), { recursive: true });
  fs.writeFileSync(targetFile, JSON.stringify(lesson, null, 2) + '\n', 'utf8');
  return targetFile;
}

function appendPromotionRecord(entry, options = {}) {
  const recordPath = resolveRecordPath(options);
  fs.mkdirSync(path.dirname(recordPath), { recursive: true });
  const payload = {
    lesson_id: entry.lesson_id,
    from_state: entry.from_state !== undefined ? entry.from_state : null,
    to_state: entry.to_state,
    approver: entry.approver !== undefined ? entry.approver : null,
    proposer: entry.proposer,
    source_commit: entry.source_commit,
    instant: entry.instant || new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  };
  if (entry.superseded_by) {
    payload.superseded_by = entry.superseded_by;
  }
  fs.appendFileSync(recordPath, JSON.stringify(payload) + '\n', 'utf8');
  return payload;
}

function readPromotionRecords(options = {}) {
  const recordPath = resolveRecordPath(options);
  if (!fs.existsSync(recordPath)) return [];
  const content = fs.readFileSync(recordPath, 'utf8');
  return content
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

/**
 * AI-22-R01: An agent may propose.
 * AI-22-R04: approved_by in input is ignored and set to null.
 * AI-22-R07: Validates against schema before writing.
 * AI-22-R08: Transition is recorded.
 * AI-22-R09: No PII or credentials.
 */
function proposeLesson(data, options = {}) {
  const warnings = [];
  if (data.approved_by !== undefined && data.approved_by !== null) {
    warnings.push(
      `AI-22-R04: declared approved_by '${data.approved_by}' in input ignored for proposal; set to null`
    );
  }

  const existing = readLesson(data.id, options);
  if (existing) {
    throw new PromotionError(
      REFUSAL_CODES.LESSON_ALREADY_EXISTS,
      `lesson '${data.id}' already exists as ${existing.lesson.status}; propose refuses to overwrite an existing lesson`
    );
  }

  const piiFinding = detectCredentialsOrPii(data);
  if (piiFinding) {
    throw new PromotionError(
      REFUSAL_CODES.CREDENTIALS_OR_PII_DETECTED,
      `AI-22-R09: credentials or personal information detected (${piiFinding})`
    );
  }

  const sourceCommit = data.source_commit || options.sourceCommit || resolveHeadSha(options.cwd);

  const lesson = {
    id: data.id,
    title: data.title,
    status: 'proposed',
    scope: data.scope,
    source_commit: sourceCommit,
    expiry: data.expiry !== undefined ? data.expiry : null,
    superseded_by: data.superseded_by !== undefined ? data.superseded_by : null,
    evidence: data.evidence,
    created_at: data.created_at || new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    proposed_by: data.proposed_by || options.proposer || 'agent',
    approved_by: null,
  };

  const violations = validateLesson(lesson, options.schemaPath);
  if (violations.length > 0) {
    throw new PromotionError(
      REFUSAL_CODES.SCHEMA_VIOLATION,
      `AI-22-R07: lesson violates schema: ${violations.join('; ')}`
    );
  }

  const writtenTo = writeLesson(lesson, null, options);

  const record = appendPromotionRecord(
    {
      lesson_id: lesson.id,
      from_state: null,
      to_state: 'proposed',
      approver: null,
      proposer: lesson.proposed_by,
      source_commit: lesson.source_commit,
      instant: lesson.created_at,
    },
    options
  );

  return {
    ok: true,
    outcome: 'proposed',
    lesson,
    writtenTo,
    record,
    warnings,
  };
}

/**
 * AI-22-R02: No one approves their own lesson (SELF_APPROVAL).
 * AI-22-R03: No agent approves (AGENT_APPROVAL).
 * AI-22-R04: Approver identity from authenticated environment.
 * AI-22-R05: Only proposed can be approved.
 * AI-22-R07: Validates against schema before writing.
 * AI-22-R08: Promotion record appended.
 */
function approveLesson(id, options = {}) {
  const existing = readLesson(id, options);
  if (!existing) {
    throw new PromotionError(REFUSAL_CODES.LESSON_NOT_FOUND, `lesson '${id}' not found`);
  }

  const lesson = existing.lesson;
  if (lesson.status !== 'proposed') {
    throw new PromotionError(
      REFUSAL_CODES.INVALID_STATE,
      `AI-22-R05: lesson '${id}' is in status '${lesson.status}', only proposed lessons can be approved`
    );
  }

  const approver = getAuthenticatedApprover(options);
  if (!approver) {
    throw new PromotionError(
      REFUSAL_CODES.UNAUTHENTICATED_APPROVER,
      'AI-22-R04: could not determine authenticated GitHub login for operator'
    );
  }

  const piiFinding = detectCredentialsOrPii(approver);
  if (piiFinding) {
    throw new PromotionError(
      REFUSAL_CODES.CREDENTIALS_OR_PII_DETECTED,
      `AI-22-R09: credentials or PII in approver login (${piiFinding})`
    );
  }

  // AI-22-R02: SELF_APPROVAL check
  const proposerNormalized = String(lesson.proposed_by || '')
    .trim()
    .toLowerCase();
  const approverNormalized = String(approver).trim().toLowerCase();
  if (approverNormalized === proposerNormalized) {
    throw new PromotionError(
      REFUSAL_CODES.SELF_APPROVAL,
      `AI-22-R02: lesson '${id}' proposed by '${lesson.proposed_by}' cannot be approved by its proposer '${approver}'`
    );
  }

  // AI-22-R03: AGENT_APPROVAL check
  if (isAgentIdentity(approver)) {
    throw new PromotionError(
      REFUSAL_CODES.AGENT_APPROVAL,
      `AI-22-R03: approver '${approver}' is an agent identity, agent approval is prohibited`
    );
  }

  const fromState = lesson.status;
  lesson.status = 'approved';
  lesson.approved_by = approver;

  const violations = validateLesson(lesson, options.schemaPath);
  if (violations.length > 0) {
    throw new PromotionError(
      REFUSAL_CODES.SCHEMA_VIOLATION,
      `AI-22-R07: approved lesson violates schema: ${violations.join('; ')}`
    );
  }

  const record = appendPromotionRecord(
    {
      lesson_id: lesson.id,
      from_state: fromState,
      to_state: 'approved',
      approver: approver,
      proposer: lesson.proposed_by,
      source_commit: lesson.source_commit,
      instant: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    },
    options
  );

  const writtenTo = writeLesson(lesson, existing, options);

  return {
    ok: true,
    outcome: 'approved',
    lesson,
    writtenTo,
    record,
  };
}

/**
 * AI-22-R05: Only proposed can be rejected.
 * AI-22-R08: Promotion record appended.
 */
function rejectLesson(id, options = {}) {
  const existing = readLesson(id, options);
  if (!existing) {
    throw new PromotionError(REFUSAL_CODES.LESSON_NOT_FOUND, `lesson '${id}' not found`);
  }

  const lesson = existing.lesson;
  if (lesson.status !== 'proposed') {
    throw new PromotionError(
      REFUSAL_CODES.INVALID_STATE,
      `AI-22-R05: lesson '${id}' is in status '${lesson.status}', only proposed lessons can be rejected`
    );
  }

  const fromState = lesson.status;
  lesson.status = 'rejected';
  lesson.approved_by = null;

  const violations = validateLesson(lesson, options.schemaPath);
  if (violations.length > 0) {
    throw new PromotionError(
      REFUSAL_CODES.SCHEMA_VIOLATION,
      `AI-22-R07: rejected lesson violates schema: ${violations.join('; ')}`
    );
  }

  const record = appendPromotionRecord(
    {
      lesson_id: lesson.id,
      from_state: fromState,
      to_state: 'rejected',
      approver: null,
      proposer: lesson.proposed_by,
      source_commit: lesson.source_commit,
      instant: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    },
    options
  );

  const writtenTo = writeLesson(lesson, existing, options);

  return {
    ok: true,
    outcome: 'rejected',
    lesson,
    writtenTo,
    record,
  };
}

/**
 * AI-22-R06: A superseding lesson must itself be approved.
 * AI-22-R08: Promotion record appended.
 */
function supersedeLesson(id, replacingId, options = {}) {
  if (!replacingId || typeof replacingId !== 'string' || !replacingId.trim()) {
    throw new PromotionError(
      REFUSAL_CODES.MISSING_SUPERSEDING_ID,
      'supersede requires a replacing lesson identifier'
    );
  }
  const cleanReplacingId = replacingId.trim();

  const target = readLesson(id, options);
  if (!target) {
    throw new PromotionError(REFUSAL_CODES.LESSON_NOT_FOUND, `lesson '${id}' not found`);
  }

  const lesson = target.lesson;
  if (
    lesson.status === 'proposed' ||
    lesson.status === 'rejected' ||
    lesson.status === 'superseded'
  ) {
    throw new PromotionError(
      REFUSAL_CODES.INVALID_STATE,
      `cannot supersede lesson '${id}' currently in status '${lesson.status}'`
    );
  }

  // AI-22-R06: check replacing lesson exists and is approved
  const replacing = readLesson(cleanReplacingId, options);
  if (!replacing) {
    throw new PromotionError(
      REFUSAL_CODES.SUPERSEDING_LESSON_MISSING,
      `AI-22-R06: replacing lesson '${cleanReplacingId}' does not exist`
    );
  }
  if (replacing.lesson.status !== 'approved') {
    throw new PromotionError(
      REFUSAL_CODES.SUPERSEDING_LESSON_NOT_APPROVED,
      `AI-22-R06: replacing lesson '${cleanReplacingId}' is in status '${replacing.lesson.status}', must be approved`
    );
  }

  const approver = getAuthenticatedApprover(options);
  if (!approver) {
    throw new PromotionError(
      REFUSAL_CODES.UNAUTHENTICATED_APPROVER,
      'AI-22-R04: could not determine authenticated GitHub login for operator'
    );
  }
  const piiFinding = detectCredentialsOrPii(approver);
  if (piiFinding) {
    throw new PromotionError(
      REFUSAL_CODES.CREDENTIALS_OR_PII_DETECTED,
      `AI-22-R09: credentials or PII in approver login (${piiFinding})`
    );
  }
  const proposerNormalized = String(lesson.proposed_by || '')
    .trim()
    .toLowerCase();
  const approverNormalized = String(approver).trim().toLowerCase();
  if (approverNormalized === proposerNormalized) {
    throw new PromotionError(
      REFUSAL_CODES.SELF_APPROVAL,
      `AI-22-R02: lesson '${id}' proposed by '${lesson.proposed_by}' cannot be approved by its proposer '${approver}'`
    );
  }
  if (isAgentIdentity(approver)) {
    throw new PromotionError(
      REFUSAL_CODES.AGENT_APPROVAL,
      `AI-22-R03: approver '${approver}' is an agent identity, agent approval is prohibited`
    );
  }
  const fromState = lesson.status;
  lesson.status = 'superseded';
  lesson.superseded_by = cleanReplacingId;

  const violations = validateLesson(lesson, options.schemaPath);
  if (violations.length > 0) {
    throw new PromotionError(
      REFUSAL_CODES.SCHEMA_VIOLATION,
      `AI-22-R07: superseded lesson violates schema: ${violations.join('; ')}`
    );
  }

  const record = appendPromotionRecord(
    {
      lesson_id: lesson.id,
      from_state: fromState,
      to_state: 'superseded',
      approver,
      proposer: lesson.proposed_by,
      source_commit: lesson.source_commit,
      superseded_by: cleanReplacingId,
      instant: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    },
    options
  );

  const writtenTo = writeLesson(lesson, target, options);

  return {
    ok: true,
    outcome: 'superseded',
    lesson,
    writtenTo,
    record,
  };
}

module.exports = {
  DEFAULT_LESSONS_DIR,
  DEFAULT_SCHEMA_PATH,
  DEFAULT_RECORD_FILE,
  REFUSAL_CODES,
  PromotionError,
  detectCredentialsOrPii,
  getAuthenticatedApprover,
  resolveLessonsDir,
  resolveRecordPath,
  loadSchema,
  validateLesson,
  readLesson,
  writeLesson,
  appendPromotionRecord,
  readPromotionRecords,
  proposeLesson,
  approveLesson,
  rejectLesson,
  supersedeLesson,
};
