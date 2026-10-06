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
 *
 * Lane D (UI roles): role ids containing "ui" or "frontend" run the vendored
 * pbakaus/impeccable texts from skills/impeccable/ instead of Superpowers.
 * Every UI pack starts with UI_AUTHORITY_HEADER — the approved screen
 * specification, DESIGN.md when approved, and the ShipDe UX rules are the
 * authority, Impeccable only helps implement them — then the same LOCK_HEADER
 * and line lock as lane A. Lines invoking `npx impeccable` or a live browser
 * are kept but tagged as install-and-Work-Item-gated tools.
 */

const fs = require('fs');
const path = require('path');

const SUPERPOWERS_ROOT = path.join(__dirname, 'skills', 'superpowers');
const IMPECCABLE_ROOT = path.join(__dirname, 'skills', 'impeccable');

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
 * Pure data: UI roles -> vendored Impeccable texts. `file` is the sub-path
 * kept from the upstream pbakaus/impeccable repo, relative to
 * skills/impeccable/.
 */
const UI_ROLE_SKILLS = Object.freeze([
  Object.freeze({ name: 'impeccable', file: '.agent/skills/impeccable/SKILL.md' }),
  Object.freeze({
    name: 'impeccable-audit',
    file: '.agent/skills/impeccable/reference/audit.md',
  }),
  Object.freeze({
    name: 'impeccable-critique',
    file: '.agent/skills/impeccable/reference/critique.md',
  }),
  Object.freeze({
    name: 'impeccable-craft',
    file: '.agent/skills/impeccable/reference/craft.md',
  }),
  Object.freeze({
    name: 'impeccable-craft-floor',
    file: '.agent/skills/impeccable/reference/craft-floor.md',
  }),
  Object.freeze({
    name: 'impeccable-component-review',
    file: '.agent/skills/impeccable/reference/component-review.md',
  }),
  Object.freeze({
    name: 'impeccable-clarify',
    file: '.agent/skills/impeccable/reference/clarify.md',
  }),
]);

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

/**
 * ShipDe UI authority paragraph. UI packs always start with it, before
 * LOCK_HEADER and before any Impeccable text: the approved screen
 * specification rules the UI, Impeccable only helps implement it.
 */
const UI_AUTHORITY_HEADER = [
  'ShipDe UI authority. Read this before any Impeccable text below.',
  '- The approved screen specification is the authority for every UI decision: DESIGN.md when it is approved, and docs/product-spec/docs/03-ux/DESIGN-SYSTEM-UX-RULES.md until then.',
  '- Impeccable guidance only helps implement that authority and never overrides the layout, copy, states or flows defined there.',
  '- Every UI state required by the specification must be implemented: loading, empty, validation, error, forbidden, partial, success, recovery.',
].join('\n');

/**
 * Impeccable tool lines survive the lock, but only as install-and-Work-Item
 * gated tools. The tag is inserted directly after the tool phrase so table
 * rows and command lists keep their shape.
 */
const UI_TOOL_TAG = '[tool: run only if installed and allowed by the Work Item]';
const UI_TOOL_ANCHORS = Object.freeze([
  'Bash(npx impeccable *)',
  'in the live browser; no manual picking',
]);

const textCache = new Map();

function readSkillText(root, file) {
  const key = root + '::' + file;
  if (!textCache.has(key)) {
    textCache.set(key, fs.readFileSync(path.join(root, file), 'utf8'));
  }
  return textCache.get(key);
}

/**
 * UI roles are role ids containing "ui" or "frontend", for example author.ui
 * or reviewer.ui.
 */
function isUiRole(role) {
  const r = typeof role === 'string' ? role.toLowerCase() : '';
  return r.includes('ui') || r.includes('frontend');
}

function entriesFor(role) {
  const r = typeof role === 'string' ? role : '';
  if (isUiRole(r)) return UI_ROLE_SKILLS;
  if (r === 'author' || r.startsWith('author.')) return ROLE_SKILLS['author.*'];
  if (r === 'reviewer') return ROLE_SKILLS.reviewer;
  if (r === 'security-review') return ROLE_SKILLS['security-review'];
  return [];
}

/**
 * @param role e.g. 'author.foundation', 'reviewer', 'security-review', 'author.ui'
 * @returns [{ name, file, text }] in pack order, [] when the role has no pack
 */
function skillsFor(role) {
  const root = isUiRole(role) ? IMPECCABLE_ROOT : SUPERPOWERS_ROOT;
  return entriesFor(role).map((entry) => ({
    name: entry.name,
    file: entry.file,
    text: readSkillText(root, entry.file),
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

function tagToolLine(line) {
  const lo = line.toLowerCase();
  if (!lo.includes('npx impeccable') && !lo.includes('in the live browser')) return line;
  for (const anchor of UI_TOOL_ANCHORS) {
    const at = line.indexOf(anchor);
    if (at >= 0) {
      return line.slice(0, at + anchor.length) + ' ' + UI_TOOL_TAG + line.slice(at + anchor.length);
    }
  }
  return line + ' ' + UI_TOOL_TAG;
}

function applyUiLock(text) {
  return applyLock(text).split('\n').map(tagToolLine).join('\n');
}

function packDisabled() {
  return process.env.SHIPDE_SKILL_PACK === 'off';
}

/**
 * @param role e.g. 'author.foundation', 'reviewer', 'security-review', 'author.ui'
 * @returns UI_AUTHORITY_HEADER + LOCK_HEADER + the locked skill texts for UI
 * roles, LOCK_HEADER + the locked skill texts otherwise, or '' when the role
 * has no pack or SHIPDE_SKILL_PACK=off.
 */
function lockedPack(role) {
  if (packDisabled()) return '';
  const skills = skillsFor(role);
  if (skills.length === 0) return '';
  const ui = isUiRole(role);
  const parts = [];
  if (ui) parts.push(UI_AUTHORITY_HEADER);
  parts.push(LOCK_HEADER);
  for (const skill of skills) {
    parts.push('## Skill: ' + skill.name + ' (' + skill.file + ')');
    parts.push(ui ? applyUiLock(skill.text) : applyLock(skill.text));
  }
  return parts.join('\n');
}

module.exports = {
  ROLE_SKILLS,
  UI_ROLE_SKILLS,
  FORBIDDEN_PATTERNS,
  LOCK_HEADER,
  UI_AUTHORITY_HEADER,
  UI_TOOL_TAG,
  skillsFor,
  lockLine,
  lockedPack,
};
