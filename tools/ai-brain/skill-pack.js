'use strict';

/**
 * Ship Dễ — Superpowers skills as a ShipDe-locked prompt pack (TASK-AI-109).
 *
 * The upstream obra/superpowers skills are vendored verbatim under
 * skills/superpowers/ and never reach a worker or reviewer directly. They go
 * out only through lockedPack(role), which always prepends LOCK_HEADER — the
 * ShipDe Controller and publisher rules — and replaces every skill line that
 * instructs model selection/switching, publication (push/merge), discard or
 * workspace deletion with a removal marker. The subagent/push/merge/worktree
 * skills are not vendored at all: those rules belong to the Controller and
 * the publisher. On any conflict, the Work Item and the ShipDe specs override
 * every skill text.
 *
 * Rollback without a code change: SHIPDE_SKILL_PACK=off disables the pack
 * (lockedPack returns '' and prompts are byte-identical to before).
 */

const fs = require('fs');
const path = require('path');

const SUPERPOWERS_ROOT = path.join(__dirname, 'skills', 'superpowers');

/**
 * Pure data: role -> vendored skills. `file` is the sub-path kept from the
 * upstream repo, relative to skills/superpowers/.
 */
const ROLE_SKILLS = Object.freeze({
  'author.*': Object.freeze([
    Object.freeze({ name: 'writing-plans', file: 'skills/writing-plans/SKILL.md' }),
    Object.freeze({
      name: 'test-driven-development',
      file: 'skills/test-driven-development/SKILL.md',
    }),
    Object.freeze({
      name: 'systematic-debugging',
      file: 'skills/systematic-debugging/SKILL.md',
    }),
    Object.freeze({
      name: 'verification-before-completion',
      file: 'skills/verification-before-completion/SKILL.md',
    }),
  ]),
  reviewer: Object.freeze([
    Object.freeze({
      name: 'requesting-code-review',
      file: 'skills/requesting-code-review/SKILL.md',
    }),
    Object.freeze({
      name: 'receiving-code-review',
      file: 'skills/receiving-code-review/SKILL.md',
    }),
    Object.freeze({
      name: 'verification-before-completion',
      file: 'skills/verification-before-completion/SKILL.md',
    }),
  ]),
  'security-review': Object.freeze([
    Object.freeze({
      name: 'requesting-code-review',
      file: 'skills/requesting-code-review/SKILL.md',
    }),
    Object.freeze({
      name: 'receiving-code-review',
      file: 'skills/receiving-code-review/SKILL.md',
    }),
    Object.freeze({
      name: 'verification-before-completion',
      file: 'skills/verification-before-completion/SKILL.md',
    }),
  ]),
});

/**
 * ShipDe override paragraph. It always comes first, before any skill text.
 * The prohibitions below ("never push", "never merge", ...) are ShipDe
 * orders, not skill instructions, so the line lock applies to skill texts,
 * never to this header.
 */
const LOCK_HEADER = [
  'ShipDe skill-pack lock. Read this before any skill text below.',
  '- Model, provider and account choice belong to the ShipDe Controller; never pick or switch models.',
  '- Publication belongs to the publisher, never to you: never push, never merge, never open or close Pull Requests, and never delete branches, worktrees or workspaces.',
  '- Repair work is bounded by the ShipDe review budget; no round count stated in a skill changes that budget.',
  '- Never delete existing uncommitted or committed work; set it aside and report it instead. New code starts with a failing test first.',
  '- On any conflict, the Work Item and the ShipDe specs override every skill text below.',
].join('\n');

/**
 * Explicit pattern list for Controller-owned lines. Each reason is worded so
 * the replacement marker itself carries none of the forbidden substrings.
 */
const FORBIDDEN_PATTERNS = Object.freeze([
  Object.freeze({
    pattern:
      /capable model|mid-tier|model tier|(cheaper|faster|stronger|smaller|larger) model|model (choice|selection|switch)/i,
    reason: 'ShipDe Controller owns model choice',
  }),
  Object.freeze({
    pattern:
      /subagent|worktree|dispatching-parallel-agents|finishing-a-development-branch|brainstorming|executing-plans|dispatch (a|the) |execution (method|approach|mode)|which approach should we use|if native chosen|preserved method/i,
    reason: 'execution mode, agents and work areas are ShipDe Controller-owned',
  }),
  Object.freeze({ pattern: /push/i, reason: 'publication is publisher-owned' }),
  Object.freeze({ pattern: /merge/i, reason: 'publication is publisher-owned' }),
  Object.freeze({
    pattern: /gh api|pulls\/|github|pr comment|reply in the comment thread/i,
    reason: 'publication is publisher-owned',
  }),
  Object.freeze({ pattern: /discard/i, reason: 'branch lifecycle is publisher-owned' }),
  Object.freeze({
    pattern: /delete this plan's workspace/i,
    reason: 'work areas are Controller-managed',
  }),
  Object.freeze({
    pattern:
      /delete (it\. start|means delete|code)|start over|throw away|deleting (x hours|is wasteful)|don't keep it as "reference"|don't look at it|implement fresh from tests/i,
    reason:
      'ShipDe recovery rule: never remove existing work; set it aside as a recovery patch, report it, then add the failing test first',
  }),
  Object.freeze({
    pattern:
      /fix round|\bif\s*(<|≥|>=|>)\s*\d|\b\d\+\s*(fix|fixes|failures)\b|fix #\d|fix attempt/i,
    reason: 'repair budget is the ShipDe review budget',
  }),
]);

const textCache = new Map();

function readSkillText(file) {
  if (!textCache.has(file)) {
    textCache.set(file, fs.readFileSync(path.join(SUPERPOWERS_ROOT, file), 'utf8'));
  }
  return textCache.get(file);
}

function entriesFor(role) {
  const r = typeof role === 'string' ? role : '';
  if (r === 'author' || r.startsWith('author.')) return ROLE_SKILLS['author.*'];
  if (r === 'reviewer') return ROLE_SKILLS.reviewer;
  if (r === 'security-review') return ROLE_SKILLS['security-review'];
  return [];
}

/**
 * @param role e.g. 'author.foundation', 'reviewer', 'security-review'
 * @returns [{ name, file, text }] in pack order, [] when the role has no pack
 */
function skillsFor(role) {
  return entriesFor(role).map((entry) => ({
    name: entry.name,
    file: entry.file,
    text: readSkillText(entry.file),
  }));
}

function lockLine(line) {
  for (const { pattern, reason } of FORBIDDEN_PATTERNS) {
    if (pattern.test(line)) {
      return '[removed by ShipDe lock: ' + reason + ']';
    }
  }
  return line;
}

function applyLock(text) {
  return String(text || '')
    .split('\n')
    .map(lockLine)
    .join('\n');
}

function packDisabled() {
  return process.env.SHIPDE_SKILL_PACK === 'off';
}

/**
 * @param role e.g. 'author.foundation', 'reviewer', 'security-review'
 * @returns LOCK_HEADER + the locked skill texts, or '' when the role has no
 * pack or SHIPDE_SKILL_PACK=off.
 */
function lockedPack(role) {
  if (packDisabled()) return '';
  const skills = skillsFor(role);
  if (skills.length === 0) return '';
  const parts = [LOCK_HEADER];
  for (const skill of skills) {
    parts.push('## Skill: ' + skill.name + ' (' + skill.file + ')');
    parts.push(applyLock(skill.text));
  }
  return parts.join('\n');
}

module.exports = {
  ROLE_SKILLS,
  FORBIDDEN_PATTERNS,
  LOCK_HEADER,
  skillsFor,
  lockLine,
  lockedPack,
};
