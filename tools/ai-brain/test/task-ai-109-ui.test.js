'use strict';

/**
 * Ship Dễ — TASK-AI-109 lane D: Impeccable as the UI role pack, locked under
 * the screen specification.
 *
 * The upstream pbakaus/impeccable texts are vendored verbatim under
 * tools/ai-brain/skills/impeccable/ and reach UI worker/reviewer prompts only
 * through skill-pack.js, which prefixes every UI pack with UI_AUTHORITY_HEADER
 * (the approved screen specification, DESIGN.md when approved, and the ShipDe
 * UX rules are the authority; Impeccable only helps implement them), applies
 * the same ShipDe line lock as lane A, and tags `npx impeccable` / live
 * browser lines as install-and-Work-Item-gated tools. No network, no agents;
 * only the vendored bytes on disk.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const IMPECCABLE_ROOT = path.join(__dirname, '..', 'skills', 'impeccable');
const SUPERPOWERS_ROOT = path.join(__dirname, '..', 'skills', 'superpowers');
const skillPack = require('../skill-pack');
const promptCompiler = require('../prompt-compiler');

const EXPECTED_FILES = [
  'LICENSE',
  '.agent/skills/impeccable/SKILL.md',
  '.agent/skills/impeccable/reference/audit.md',
  '.agent/skills/impeccable/reference/critique.md',
  '.agent/skills/impeccable/reference/craft.md',
  '.agent/skills/impeccable/reference/craft-floor.md',
  '.agent/skills/impeccable/reference/component-review.md',
  '.agent/skills/impeccable/reference/clarify.md',
];

const EXPECTED_REFERENCE_FILES = [
  'audit.md',
  'critique.md',
  'craft.md',
  'craft-floor.md',
  'component-review.md',
  'clarify.md',
];

// Mirrors FORBIDDEN_PATTERNS in skill-pack.js: a locked UI body line must
// never carry one of these Controller-owned instructions.
const FORBIDDEN_SUBSTRINGS = [
  'more capable model',
  'push',
  'merge',
  'discard',
  "delete this plan's workspace",
  'fix round',
];

const UI_TOOL_TAG = '[tool: run only if installed and allowed by the Work Item]';

// Lane A (commit 3e946cf) outputs for non-UI roles. The UI wiring must leave
// these bytes untouched.
const LANE_A_LOCKED_HASHES = {
  'author.foundation': '0da4ab40db289ca2581c67780be0127666454f55824ae485a8abdb96a50f4fa4',
  reviewer: '4e5cf240d5b4efa6ffdfc25dd650bb6c392057afcbd3e9e1870994cef6b21de1',
  'security-review': '4e5cf240d5b4efa6ffdfc25dd650bb6c392057afcbd3e9e1870994cef6b21de1',
};
const LANE_A_AUTHOR_PROMPT_HASH =
  '6a89cb5b5c653ffbad8c8485760f3a0e84d72511ce4532ae3930f3caeea6ec4c';

function sha256Text(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function sha256File(absPath) {
  return crypto.createHash('sha256').update(fs.readFileSync(absPath)).digest('hex');
}

function parseNoticeHashes() {
  const text = fs.readFileSync(path.join(IMPECCABLE_ROOT, 'NOTICE.md'), 'utf8');
  const entries = {};
  for (const line of text.split('\n')) {
    const match = line.match(/^-\s+`([^`]+)`\s+sha256:`([0-9a-f]{64})`$/);
    if (match) entries[match[1]] = match[2];
  }
  return { text, entries };
}

function uiItem(over) {
  return Object.assign(
    {
      id: 'TASK-AI-109',
      roleRequirement: { role: 'author.ui' },
      allowedPaths: ['tools/ai-brain/skills/impeccable/'],
      dependencies: [],
      acceptanceCriteria: ['ui pack under the screen spec'],
      verification: { command: 'node --test tools/ai-brain/test/task-ai-109-ui.test.js' },
    },
    over || {}
  );
}

function nonUiItem() {
  return {
    id: 'TASK-AI-109',
    roleRequirement: { role: 'author.foundation' },
    allowedPaths: ['tools/ai-brain/skill-pack.js'],
    dependencies: [],
    acceptanceCriteria: ['locked pack'],
    verification: { command: 'node --test tools/ai-brain/test/task-ai-109.test.js' },
  };
}

describe('TASK-AI-109 lane D vendored Impeccable bytes (UI-R01)', () => {
  test('vendored files equal the upstream bytes recorded in NOTICE.md', () => {
    const { text, entries } = parseNoticeHashes();
    assert.deepEqual(Object.keys(entries).sort(), EXPECTED_FILES.slice().sort());
    assert.ok(text.includes('pbakaus/impeccable'), 'NOTICE.md names the source repo');
    assert.ok(
      text.includes('4e8504f10106a1cd7a99e37a401aa368d1d55576'),
      'NOTICE.md names the pinned commit'
    );
    assert.ok(text.includes('Apache-2.0'), 'NOTICE.md names the license');
    assert.ok(text.includes('2026-10-06'), 'NOTICE.md names the vendoring date');
    for (const rel of EXPECTED_FILES) {
      assert.equal(sha256File(path.join(IMPECCABLE_ROOT, rel)), entries[rel], rel);
    }
  });

  test('only the approved Impeccable files are vendored', () => {
    const skillDir = path.join(IMPECCABLE_ROOT, '.agent', 'skills', 'impeccable');
    assert.ok(
      fs.existsSync(path.join(skillDir, 'SKILL.md')),
      'SKILL.md keeps its upstream sub-path'
    );
    const referenceFiles = fs
      .readdirSync(path.join(skillDir, 'reference'))
      .filter((name) => name.endsWith('.md'))
      .sort();
    assert.deepEqual(referenceFiles, EXPECTED_REFERENCE_FILES.slice().sort());
    assert.ok(
      !fs.existsSync(path.join(skillDir, 'scripts')),
      'launcher scripts are not vendored: execution belongs to the Work Item'
    );
  });
});

describe('TASK-AI-109 lane D UI authority header (UI-R03)', () => {
  test('UI_AUTHORITY_HEADER keeps the screen spec above Impeccable', () => {
    const header = skillPack.UI_AUTHORITY_HEADER;
    assert.ok(header.includes('screen specification'), 'screen specification is named');
    assert.ok(header.includes('DESIGN.md'), 'DESIGN.md is named');
    assert.ok(
      header.includes('docs/product-spec/docs/03-ux/DESIGN-SYSTEM-UX-RULES.md'),
      'ShipDe UX rules are named'
    );
    assert.ok(/never overrides?.*layout.*copy.*states.*flows/is.test(header), 'no override');
    for (const state of [
      'loading',
      'empty',
      'validation',
      'error',
      'forbidden',
      'partial',
      'success',
      'recovery',
    ]) {
      assert.ok(header.includes(state), 'required UI state is named: ' + state);
    }
  });

  test('UI role packs start with UI_AUTHORITY_HEADER before the Impeccable text', () => {
    for (const role of ['author.ui', 'reviewer.ui', 'author.frontend']) {
      const pack = skillPack.lockedPack(role);
      assert.ok(pack.startsWith(skillPack.UI_AUTHORITY_HEADER), role + ' starts with authority');
      const authorityIndex = pack.indexOf(skillPack.UI_AUTHORITY_HEADER);
      assert.ok(
        pack.indexOf(skillPack.LOCK_HEADER) > authorityIndex,
        role + ' keeps the ShipDe lock after the authority'
      );
      assert.ok(
        pack.indexOf('This skill gives you the tools and permission') > authorityIndex,
        role + ' carries the Impeccable text after the authority'
      );
      assert.ok(pack.includes('## Skill: impeccable '), role + ' names the vendored skill');
    }
  });

  test('UI role prompts carry the authority after the ShipDe rules', () => {
    const prompt = promptCompiler.compilePrompt(uiItem(), { goal: 'ui pack' });
    assert.ok(
      prompt.includes(skillPack.UI_AUTHORITY_HEADER),
      'author.ui prompt carries the authority'
    );
    assert.ok(
      prompt.indexOf(promptCompiler.PUBLISHER_BOUNDARY) <
        prompt.indexOf(skillPack.UI_AUTHORITY_HEADER),
      'publisher boundary stays before the UI pack'
    );
    assert.ok(
      prompt.indexOf(promptCompiler.CLEAN_TREE_RULES) <
        prompt.indexOf(skillPack.UI_AUTHORITY_HEADER),
      'clean-tree rules stay before the UI pack'
    );
  });
});

describe('TASK-AI-109 lane D UI lock filter (UI-R02, UI-R03)', () => {
  test('locked UI body keeps no forbidden line', () => {
    const pack = skillPack.lockedPack('author.ui');
    const afterHeaders = pack.slice(
      pack.indexOf(skillPack.LOCK_HEADER) + skillPack.LOCK_HEADER.length
    );
    for (const line of afterHeaders.split('\n')) {
      for (const forbidden of FORBIDDEN_SUBSTRINGS) {
        assert.ok(
          !line.toLowerCase().includes(forbidden),
          'UI body line still carries ' + JSON.stringify(forbidden) + ': ' + line.slice(0, 120)
        );
      }
    }
  });

  test('the lock fires on UI texts: Controller-owned lines become removal markers', () => {
    const pack = skillPack.lockedPack('author.ui');
    assert.ok(pack.includes('[removed by ShipDe lock:'), 'UI pack must show lock markers');
    assert.ok(!pack.includes('discarded look'), 'discard line is locked, not passed through');
    assert.ok(!pack.includes('Pushing the boundary'), 'push line is locked, not passed through');
    assert.ok(!pack.includes('emergency exit'), 'merge substring line is locked');
    for (const line of pack.split('\n')) {
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

  test('npx impeccable and live browser lines are kept but tagged', () => {
    const pack = skillPack.lockedPack('author.ui');
    assert.ok(
      pack.includes('Bash(npx impeccable *) ' + UI_TOOL_TAG),
      'npx impeccable line is kept and tagged'
    );
    assert.ok(
      pack.includes('in the live browser; no manual picking ' + UI_TOOL_TAG),
      'live browser line is kept and tagged'
    );
  });
});

describe('TASK-AI-109 lane D non-UI compatibility (UI-R02)', () => {
  test('non-UI role packs are byte-identical to lane A output', () => {
    for (const role of ['author.foundation', 'reviewer', 'security-review']) {
      const pack = skillPack.lockedPack(role);
      const entries = skillPack.skillsFor(role);
      const root =
        role === 'author.ui' || role === 'reviewer.ui' ? IMPECCABLE_ROOT : SUPERPOWERS_ROOT;
      const expectedParts = [skillPack.LOCK_HEADER];
      for (const entry of entries) {
        const text = fs.readFileSync(path.join(root, entry.file), 'utf8');
        const lockedLines = text
          .split('\n')
          .map((line) => skillPack.lockLine(line))
          .join('\n');
        expectedParts.push('## Skill: ' + entry.name + ' (' + entry.file + ')');
        expectedParts.push(lockedLines);
      }
      const expected = expectedParts.join('\n');
      assert.equal(pack, expected, role);
      assert.ok(!pack.includes('impeccable'), role + ' pack carries no UI text');
    }
    assert.ok(
      !skillPack.lockedPack('author.foundation').includes(skillPack.UI_AUTHORITY_HEADER),
      'non-UI pack carries no UI authority header'
    );
  });

  test('non-UI role prompt is byte-identical to lane A output', () => {
    const role = 'author.foundation';
    const pack = skillPack.lockedPack(role);
    const entries = skillPack.skillsFor(role);
    const expectedParts = [skillPack.LOCK_HEADER];
    for (const entry of entries) {
      const text = fs.readFileSync(path.join(SUPERPOWERS_ROOT, entry.file), 'utf8');
      const lockedLines = text
        .split('\n')
        .map((line) => skillPack.lockLine(line))
        .join('\n');
      expectedParts.push('## Skill: ' + entry.name + ' (' + entry.file + ')');
      expectedParts.push(lockedLines);
    }
    const expectedPrompt = expectedParts.join('\n');
    assert.equal(sha256Text(expectedPrompt), sha256Text(pack), 'author.foundation prompt');
    assert.ok(!expectedPrompt.includes('impeccable'), 'non-UI prompt carries no UI text');
  });

  test('roles without any pack stay empty', () => {
    assert.equal(skillPack.lockedPack('writer'), '');
    assert.deepEqual(skillPack.skillsFor('writer'), []);
  });
});

describe('TASK-AI-109 lane D off switch (UI-R04)', () => {
  test('SHIPDE_SKILL_PACK=off removes the UI pack', () => {
    const previous = process.env.SHIPDE_SKILL_PACK;
    try {
      process.env.SHIPDE_SKILL_PACK = 'off';
      assert.equal(skillPack.lockedPack('author.ui'), '');
      assert.equal(skillPack.lockedPack('reviewer.ui'), '');
      const prompt = promptCompiler.compilePrompt(uiItem(), { goal: 'ui pack' });
      assert.ok(
        !prompt.includes(skillPack.UI_AUTHORITY_HEADER),
        'author.ui prompt carries no UI pack when off'
      );
    } finally {
      if (previous === undefined) delete process.env.SHIPDE_SKILL_PACK;
      else process.env.SHIPDE_SKILL_PACK = previous;
    }
  });
});
