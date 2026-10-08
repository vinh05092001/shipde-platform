'use strict';

/**
 * Ship Dễ — TASK-AI-109 Superpowers skills as a ShipDe-locked prompt pack.
 *
 * The six upstream skills are vendored verbatim under
 * tools/ai-brain/skills/superpowers/ and reach worker/reviewer prompts only
 * through skill-pack.js, which prepends LOCK_HEADER (ShipDe Controller and
 * publisher rules first) and replaces every Controller-owned skill line with
 * a removal marker. No network, no agents; only the vendored bytes on disk.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SUPERPOWERS_ROOT = path.join(__dirname, '..', 'skills', 'superpowers');
const skillPack = require('../skill-pack');
const promptCompiler = require('../prompt-compiler');

const EXPECTED_FILES = [
  'LICENSE',
  'skills/writing-plans/SKILL.md',
  'skills/test-driven-development/SKILL.md',
  'skills/systematic-debugging/SKILL.md',
  'skills/verification-before-completion/SKILL.md',
  'skills/requesting-code-review/SKILL.md',
  'skills/receiving-code-review/SKILL.md',
];

const EXPECTED_SKILL_DIRS = [
  'writing-plans',
  'test-driven-development',
  'systematic-debugging',
  'verification-before-completion',
  'requesting-code-review',
  'receiving-code-review',
];

const EXCLUDED_SKILL_DIRS = [
  'subagent-driven-development',
  'dispatching-parallel-agents',
  'finishing-a-development-branch',
  'using-git-worktrees',
  'brainstorming',
];

// Mirrors FORBIDDEN_PATTERNS in skill-pack.js: a locked body line must never
// carry one of these Controller-owned instructions.
const FORBIDDEN_SUBSTRINGS = [
  'more capable model',
  'push',
  'merge',
  'discard',
  "delete this plan's workspace",
  'fix round',
  'capable model',
  'mid-tier',
  'model tier',
  'subagent',
  'dispatch',
  'worktree',
  'brainstorming',
  'dispatching-parallel-agents',
  'finishing-a-development-branch',
  'executing-plans',
  'execution method',
  'execution approach',
  'delete it. start over',
  'delete means delete',
  'delete code',
  'start over',
  'throw away',
  'if ≥',
  'if <',
  'fix #',
  'gh api',
  'pulls/',
  'github',
];

// Exact upstream lines (pinned commit) that carry Controller- or
// publisher-owned instructions. Each must leave the pack as a lock marker.
const LOCKED_UPSTREAM_LINES = [
  {
    finding: 'P1-1 model choice',
    file: 'skills/writing-plans/SKILL.md',
    line: '- **Native** - I implement every task myself in this session, the way this harness runs work, then one fresh reviewer on the most capable model checks the whole branch. Cheapest and fastest; no independent review until the end. Runs well with a mid-tier session model, since the plan carries the design.',
    reason: /model choice/,
  },
  {
    finding: 'P1-2 excluded skill',
    file: 'skills/writing-plans/SKILL.md',
    line: '> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.',
    reason: /Controller/,
  },
  {
    finding: 'P1-2 excluded skill',
    file: 'skills/writing-plans/SKILL.md',
    line: '- **REQUIRED SUB-SKILL:** Use superpowers:subagent-driven-development',
    reason: /Controller/,
  },
  {
    finding: 'P1-2 excluded skill',
    file: 'skills/writing-plans/SKILL.md',
    line: '- **REQUIRED SUB-SKILL:** Use superpowers:executing-plans',
    reason: /Controller/,
  },
  {
    finding: 'P1-2 worktree creation',
    file: 'skills/writing-plans/SKILL.md',
    line: '**Context:** If working in an isolated worktree, it should have been created via the `superpowers:using-git-worktrees` skill at execution time.',
    reason: /Controller/,
  },
  {
    finding: 'P1-2 execution mode choice',
    file: 'skills/writing-plans/SKILL.md',
    line: '**"Plan complete and saved to `docs/superpowers/plans/<filename>.md`. Please review the plan. Which execution approach would you prefer?**',
    reason: /Controller/,
  },
  {
    finding: 'P1-2 execution mode choice',
    file: 'skills/writing-plans/SKILL.md',
    line: '- **Subagent-driven** - A fresh subagent implements each task and a fresh reviewer checks it before the next one starts, then a whole-branch review at the end. Most thorough; costs a fresh context per task and per review.',
    reason: /Controller/,
  },
  {
    finding: 'P1-2 execution mode choice',
    file: 'skills/writing-plans/SKILL.md',
    line: '**For this plan I recommend <one of the two>, because <one sentence from the plan: how much the tasks depend on each other\'s interfaces, how many there are, what a shipped mistake would cost>. Does the plan capture what you want, and which approach should we use?"**',
    reason: /Controller/,
  },
  {
    finding: 'P1-2 execution mode choice',
    file: 'skills/writing-plans/SKILL.md',
    line: 'them to review the plan and choose an execution method before implementation.',
    reason: /Controller/,
  },
  {
    finding: 'P1-2 execution mode choice',
    file: 'skills/writing-plans/SKILL.md',
    line: '**If Native chosen:**',
    reason: /Controller/,
  },
  {
    finding: 'P1-2 dispatch a subagent',
    file: 'skills/requesting-code-review/SKILL.md',
    line: 'Dispatch a `general-purpose` subagent, filling the template at [code-reviewer.md](code-reviewer.md)',
    reason: /Controller/,
  },
  {
    finding: 'P1-2 dispatch a subagent',
    file: 'skills/requesting-code-review/SKILL.md',
    line: "Dispatch a code reviewer subagent to catch issues before they cascade. The reviewer gets precisely crafted context for evaluation — never your session's history.",
    reason: /Controller/,
  },
  {
    finding: 'P1-3 delete code',
    file: 'skills/test-driven-development/SKILL.md',
    line: 'Write code before the test? Delete it. Start over.',
    reason: /recovery patch/,
  },
  {
    finding: 'P1-3 delete code',
    file: 'skills/test-driven-development/SKILL.md',
    line: '- Delete means delete',
    reason: /recovery patch/,
  },
  {
    finding: 'P1-3 delete code',
    file: 'skills/test-driven-development/SKILL.md',
    line: '| "Keep as reference, write tests first" | You\'ll adapt it. That\'s testing after. Delete means delete. |',
    reason: /recovery patch/,
  },
  {
    finding: 'P1-3 delete code',
    file: 'skills/test-driven-development/SKILL.md',
    line: '| "Need to explore first" | Fine. Throw away exploration, start with TDD. |',
    reason: /recovery patch/,
  },
  {
    finding: 'P1-3 delete code',
    file: 'skills/test-driven-development/SKILL.md',
    line: '**All of these mean: Delete code. Start over with TDD.**',
    reason: /recovery patch/,
  },
  {
    finding: 'P1-3 start over',
    file: 'skills/test-driven-development/SKILL.md',
    line: "Can't check all boxes? You skipped TDD. Start over.",
    reason: /recovery patch/,
  },
  {
    finding: 'P1-3 delete code',
    file: 'skills/test-driven-development/SKILL.md',
    line: '- Don\'t keep it as "reference"',
    reason: /recovery patch/,
  },
  {
    finding: 'P1-3 delete code',
    file: 'skills/test-driven-development/SKILL.md',
    line: 'Implement fresh from tests. Period.',
    reason: /recovery patch/,
  },
  {
    finding: 'P2-4 skill-owned retry count',
    file: 'skills/systematic-debugging/SKILL.md',
    line: '   - If < 3: Return to Phase 1, re-analyze with new information',
    reason: /review budget/,
  },
  {
    finding: 'P2-4 skill-owned retry count',
    file: 'skills/systematic-debugging/SKILL.md',
    line: '   - **If ≥ 3: STOP and question the architecture (step 5 below)**',
    reason: /review budget/,
  },
  {
    finding: 'P2-4 skill-owned retry count',
    file: 'skills/systematic-debugging/SKILL.md',
    line: "   - DON'T attempt Fix #4 without architectural discussion",
    reason: /review budget/,
  },
  {
    finding: 'P2-4 skill-owned retry count',
    file: 'skills/systematic-debugging/SKILL.md',
    line: '5. **If 3+ Fixes Failed: Question Architecture**',
    reason: /review budget/,
  },
  {
    finding: 'P2-4 skill-owned retry count',
    file: 'skills/systematic-debugging/SKILL.md',
    line: '**If 3+ fixes failed:** Question the architecture (see Phase 4.5)',
    reason: /review budget/,
  },
  {
    finding: 'P2-5 GitHub posting',
    file: 'skills/receiving-code-review/SKILL.md',
    line: 'When replying to inline review comments on GitHub, reply in the comment thread (`gh api repos/{owner}/{repo}/pulls/{pr}/comments/{id}/replies`), not as a top-level PR comment.',
    reason: /publisher-owned/,
  },
  {
    finding: 'P2-5 GitHub posting',
    file: 'skills/receiving-code-review/SKILL.md',
    line: '## GitHub Thread Replies',
    reason: /publisher-owned/,
  },
];

function sha256File(absPath) {
  return crypto.createHash('sha256').update(fs.readFileSync(absPath)).digest('hex');
}

function parseNoticeHashes() {
  const text = fs.readFileSync(path.join(SUPERPOWERS_ROOT, 'NOTICE.md'), 'utf8');
  const entries = {};
  for (const line of text.split('\n')) {
    const match = line.match(/^-\s+`([^`]+)`\s+sha256:`([0-9a-f]{64})`$/);
    if (match) entries[match[1]] = match[2];
  }
  return { text, entries };
}

function bodyLinesAfterHeader(locked) {
  assert.ok(locked.startsWith(skillPack.LOCK_HEADER), 'locked pack must start with LOCK_HEADER');
  return locked.slice(skillPack.LOCK_HEADER.length).split('\n');
}

function authorItem(over) {
  return Object.assign(
    {
      id: 'TASK-AI-109',
      roleRequirement: { role: 'author.foundation' },
      allowedPaths: ['tools/ai-brain/skill-pack.js'],
      dependencies: [],
      acceptanceCriteria: ['locked pack'],
      verification: { command: 'node --test tools/ai-brain/test/task-ai-109.test.js' },
    },
    over || {}
  );
}

describe('TASK-AI-109 vendored Superpowers bytes (SP-R01)', () => {
  test('vendored files equal the upstream bytes recorded in NOTICE.md', () => {
    const { text, entries } = parseNoticeHashes();
    assert.deepEqual(Object.keys(entries).sort(), EXPECTED_FILES.slice().sort());
    assert.ok(text.includes('obra/superpowers'), 'NOTICE.md names the source repo');
    assert.ok(
      text.includes('8ca22dba9a94f28898bbce59f2537ff4d87c747d'),
      'NOTICE.md names the pinned commit'
    );
    assert.ok(text.includes('MIT'), 'NOTICE.md names the license');
    assert.ok(text.includes('2026-10-06'), 'NOTICE.md names the vendoring date');
    for (const rel of EXPECTED_FILES) {
      assert.equal(sha256File(path.join(SUPERPOWERS_ROOT, rel)), entries[rel], rel);
    }
  });

  test('only the six allowed skills are vendored', () => {
    const dirs = fs
      .readdirSync(path.join(SUPERPOWERS_ROOT, 'skills'), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    assert.deepEqual(dirs, EXPECTED_SKILL_DIRS.slice().sort());
    for (const excluded of EXCLUDED_SKILL_DIRS) {
      assert.ok(
        !fs.existsSync(path.join(SUPERPOWERS_ROOT, 'skills', excluded)),
        excluded +
          ' must not be vendored: its model/push/merge/workspace rules belong to the Controller'
      );
    }
  });
});

describe('TASK-AI-109 locked pack (SP-R02)', () => {
  test('lockedPack starts with LOCK_HEADER and the body keeps no forbidden line', () => {
    for (const role of ['author.foundation', 'reviewer', 'security-review']) {
      const locked = skillPack.lockedPack(role);
      assert.ok(locked.length > skillPack.LOCK_HEADER.length, role + ' pack must not be empty');
      const body = bodyLinesAfterHeader(locked);
      for (const line of body) {
        for (const forbidden of FORBIDDEN_SUBSTRINGS) {
          assert.ok(
            !line.toLowerCase().includes(forbidden),
            role +
              ' body line still carries ' +
              JSON.stringify(forbidden) +
              ': ' +
              line.slice(0, 120)
          );
        }
      }
    }
  });

  test('the lock fires: Controller-owned skill lines become removal markers', () => {
    // Upstream systematic-debugging ("emergencies"/"Emergency") and
    // verification-before-completion ("commit/push/PR") both carry locked
    // lines, so the author pack must show markers, not silent passthrough.
    const authorPack = skillPack.lockedPack('author.foundation');
    assert.ok(
      authorPack.includes('[removed by ShipDe lock:'),
      'author pack must show lock markers'
    );
    const reviewerPack = skillPack.lockedPack('reviewer');
    assert.ok(
      reviewerPack.includes('[removed by ShipDe lock:'),
      'reviewer pack must show lock markers'
    );
    for (const line of reviewerPack.split('\n')) {
      if (line.includes('[removed by ShipDe lock:')) {
        for (const forbidden of FORBIDDEN_SUBSTRINGS) {
          assert.ok(
            !line.toLowerCase().includes(forbidden),
            'marker line must not reintroduce ' + JSON.stringify(forbidden)
          );
        }
      }
    }
  });

  test('exact upstream Controller-owned lines leave the pack as lock markers (review round 0)', () => {
    const packs = {
      author: skillPack.lockedPack('author.foundation').split('\n'),
      reviewer: skillPack.lockedPack('reviewer').split('\n'),
    };
    for (const { finding, file, line, reason } of LOCKED_UPSTREAM_LINES) {
      const upstream = fs.readFileSync(path.join(SUPERPOWERS_ROOT, file), 'utf8').split('\n');
      assert.ok(upstream.includes(line), finding + ': line is copied verbatim from ' + file);
      const locked = skillPack.lockLine(line);
      assert.match(
        locked,
        /^\[removed by ShipDe lock: [^\]]+\]$/,
        finding + ': ' + line.slice(0, 80)
      );
      assert.match(locked, reason, finding + ' reason: ' + locked);
      assert.ok(!packs.author.includes(line), finding + ': line absent from author pack');
      assert.ok(!packs.reviewer.includes(line), finding + ': line absent from reviewer pack');
    }
  });

  test('the delete/start-over marker states the ShipDe recovery rule', () => {
    const locked = skillPack.lockLine('Write code before the test? Delete it. Start over.');
    assert.match(locked, /set it aside as a recovery patch/);
    assert.match(locked, /report/);
    assert.match(locked, /never remove/);
  });

  test('code examples and neutral lines pass through unlocked', () => {
    for (const line of [
      "    if (attempts < 3) throw new Error('fail');",
      '- Throwaway prototypes',
      '## Red Flags - STOP and Follow Process',
      '**Architecture:** [2-3 sentences about approach]',
    ]) {
      assert.equal(skillPack.lockLine(line), line);
    }
  });

  test('LOCK_HEADER states the ShipDe overrides', () => {
    const header = skillPack.LOCK_HEADER;
    assert.ok(header.includes('ShipDe Controller'), 'model choice belongs to the Controller');
    assert.ok(/never pick or switch models/i.test(header), 'no model switching');
    assert.ok(header.includes('publisher'), 'publication belongs to the publisher');
    assert.ok(/review budget/i.test(header), 'repair budget is the ShipDe review budget');
    assert.ok(/never delete existing/i.test(header), 'existing work is set aside, never deleted');
    assert.ok(/Work Item.*override/i.test(header), 'Work Item and specs override skill text');
  });

  test('roles without a pack stay empty', () => {
    assert.equal(skillPack.lockedPack('writer'), '');
    assert.equal(skillPack.lockedPack('researcher'), '');
    assert.equal(skillPack.lockedPack('unknown-role'), '');
    assert.equal(skillPack.lockedPack(undefined), '');
    assert.deepEqual(skillPack.skillsFor('writer'), []);
  });

  test('role to skill map covers author and reviewer lanes', () => {
    const authorNames = skillPack.skillsFor('author.foundation').map((s) => s.name);
    assert.deepEqual(authorNames, [
      'writing-plans',
      'test-driven-development',
      'systematic-debugging',
      'verification-before-completion',
    ]);
    const reviewerNames = skillPack.skillsFor('reviewer').map((s) => s.name);
    assert.deepEqual(reviewerNames, [
      'requesting-code-review',
      'receiving-code-review',
      'verification-before-completion',
    ]);
    const securityNames = skillPack.skillsFor('security-review').map((s) => s.name);
    assert.deepEqual(securityNames, reviewerNames);
  });
});

describe('TASK-AI-109 prompt wiring (SP-R03, SP-R04)', () => {
  test('author prompt appends the locked author pack after the ShipDe rules', () => {
    const prompt = promptCompiler.compilePrompt(authorItem(), { goal: 'locked pack' });
    assert.ok(prompt.includes(skillPack.LOCK_HEADER), 'author prompt carries the lock header');
    for (const heading of [
      '# Writing Plans',
      '# Test-Driven Development (TDD)',
      '# Systematic Debugging',
      '# Verification Before Completion',
    ]) {
      assert.ok(prompt.includes(heading), 'author prompt includes ' + heading);
    }
    assert.ok(
      prompt.indexOf(promptCompiler.PUBLISHER_BOUNDARY) < prompt.indexOf(skillPack.LOCK_HEADER),
      'publisher boundary stays before the pack'
    );
    assert.ok(
      prompt.indexOf(promptCompiler.CLEAN_TREE_RULES) < prompt.indexOf(skillPack.LOCK_HEADER),
      'clean-tree rules stay before the pack'
    );
  });

  test('review prompt appends the locked reviewer pack after the publisher boundary', () => {
    const prompt = promptCompiler.compileReviewPrompt(authorItem(), {
      goal: 'locked pack',
      headSha: 'b'.repeat(40),
      baseSha: 'a'.repeat(40),
      diffText: 'diff',
    });
    assert.ok(prompt.includes(skillPack.LOCK_HEADER), 'review prompt carries the lock header');
    for (const heading of [
      '# Requesting Code Review',
      '# Code Review Reception',
      '# Verification Before Completion',
    ]) {
      assert.ok(prompt.includes(heading), 'review prompt includes ' + heading);
    }
    assert.ok(
      prompt.indexOf(promptCompiler.PUBLISHER_BOUNDARY) < prompt.indexOf(skillPack.LOCK_HEADER),
      'publisher boundary stays before the pack'
    );
  });

  test('roles without a pack keep the prompt unchanged', () => {
    const prompt = promptCompiler.compilePrompt(
      authorItem({ roleRequirement: { role: 'writer' } }),
      { goal: 'locked pack' }
    );
    assert.ok(!prompt.includes(skillPack.LOCK_HEADER), 'writer prompt carries no pack');
  });

  test('SHIPDE_SKILL_PACK=off removes the pack (SP-R04)', () => {
    const previous = process.env.SHIPDE_SKILL_PACK;
    try {
      process.env.SHIPDE_SKILL_PACK = 'off';
      assert.equal(skillPack.lockedPack('author.foundation'), '');
      assert.equal(skillPack.lockedPack('reviewer'), '');
      const prompt = promptCompiler.compilePrompt(authorItem(), { goal: 'locked pack' });
      assert.ok(!prompt.includes(skillPack.LOCK_HEADER), 'author prompt carries no pack when off');
      const reviewPrompt = promptCompiler.compileReviewPrompt(authorItem(), {
        goal: 'locked pack',
        headSha: 'b'.repeat(40),
        baseSha: 'a'.repeat(40),
        diffText: 'diff',
      });
      assert.ok(
        !reviewPrompt.includes(skillPack.LOCK_HEADER),
        'review prompt carries no pack when off'
      );
    } finally {
      if (previous === undefined) delete process.env.SHIPDE_SKILL_PACK;
      else process.env.SHIPDE_SKILL_PACK = previous;
    }
  });
});
