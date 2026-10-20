'use strict';
// GOAL-AUTOCLAW-REPOS-6 — Vercel guidance is vendored at pinned bytes and
// reaches UI roles only, behind the ShipDe UI authority and lock headers.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const pack = require('../skill-pack');

const ROOT = path.join(__dirname, '..', 'skills', 'vercel');

test('vendored Vercel files equal the bytes recorded in NOTICE.md', () => {
  const notice = fs.readFileSync(path.join(ROOT, 'NOTICE.md'), 'utf8');
  const recorded = [...notice.matchAll(/^- `([^`]+)` sha256:`([0-9a-f]{64})`$/gm)];
  assert.equal(recorded.length, 3);
  for (const [, file, sha] of recorded) {
    const bytes = fs.readFileSync(path.join(ROOT, file));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), sha, file);
  }
});

test('UI roles carry both Vercel texts after the authority and lock headers', () => {
  const names = pack.skillsFor('author.ui').map((s) => s.name);
  assert.ok(names.includes('vercel-react-best-practices'));
  assert.ok(names.includes('vercel-web-interface-guidelines'));
  const prev = process.env.SHIPDE_SKILL_PACK;
  try {
    delete process.env.SHIPDE_SKILL_PACK;
    const text = pack.lockedPack('reviewer.ui');
    assert.ok(text.startsWith(pack.UI_AUTHORITY_HEADER));
    const at = text.indexOf('## Skill: vercel-web-interface-guidelines');
    assert.ok(at > text.indexOf(pack.LOCK_HEADER));
    assert.ok(text.includes('Icon-only buttons need `aria-label`'));
  } finally {
    if (prev === undefined) delete process.env.SHIPDE_SKILL_PACK;
    else process.env.SHIPDE_SKILL_PACK = prev;
  }
});

test('non-UI roles never receive Vercel texts', () => {
  for (const role of ['author', 'author.foundation', 'reviewer', 'security-review']) {
    assert.ok(!pack.skillsFor(role).some((s) => s.name.startsWith('vercel-')), role);
  }
});
