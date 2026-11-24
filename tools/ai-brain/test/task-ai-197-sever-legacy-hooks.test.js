'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const BRAIN_DIR = path.join(__dirname, '..');

test('TASK-AI-197 AC1: live runtime callers no longer require route-health.js or quota-scan.js', () => {
  const files = [
    path.join(BRAIN_DIR, 'cli', 'commands.js'),
    path.join(BRAIN_DIR, 'planning-services.js'),
    path.join(BRAIN_DIR, 'next-runner.js'),
    path.join(BRAIN_DIR, 'catalogue-refresh.js'),
  ];
  const forbidden = /require\(['"](\.\.?\/)?(route-health|quota-scan)(\.js)?['"]\)/;
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    assert.equal(
      forbidden.test(src),
      false,
      `${path.relative(BRAIN_DIR, file)} must not require legacy route-health or quota-scan`
    );
  }
});

test('TASK-AI-197 AC2: catalogue-refresh loads cleanly without quota-scan dependency', () => {
  const mod = require('../catalogue-refresh');
  assert.equal(typeof mod.refreshCatalogue, 'function');
});
