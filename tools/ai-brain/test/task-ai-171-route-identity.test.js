'use strict';

/**
 * TASK-AI-171 Slice A: route identity (AC-AI-171-06, AC-AI-171-07 first half), offline.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  createRouteIdentity,
  resolveModelPrefix,
  expandComboIdentity,
} = require('../route-identity');

const identity = (overrides) => createRouteIdentity({ harness: 'direct-http', ...overrides });

test('Criterion 6: Model IDs with several slashes and mixed casing are preserved verbatim', () => {
  const p1 = resolveModelPrefix('cf/@cf/meta/llama-3.3-70b-instruct-fp8-fast');
  assert.equal(p1.prefix, 'cf');
  assert.equal(p1.upstreamProviderId, 'cloudflare-ai');
  assert.equal(p1.outboundModelId, '@cf/meta/llama-3.3-70b-instruct-fp8-fast');

  const p2 = resolveModelPrefix('cl/dots-studio/dots-3-note-preview:free');
  assert.equal(p2.prefix, 'cl');
  assert.equal(p2.upstreamProviderId, 'cline');
  assert.equal(p2.outboundModelId, 'dots-studio/dots-3-note-preview:free');
});

test('Criterion 7 (Slice A): Combo keeps its branches with their outbound ids', () => {
  const combo = identity({
    sourceId: '9router',
    gatewayId: '9router',
    configuredModelId: 'shipde-writer',
  });
  const expanded = expandComboIdentity(
    combo,
    ['ag/gemini-3.8-flash', 'ag/claude-opus-4-6-thinking'],
    { antigravity: [{ connectionId: 'ag1', accountRef: 'vi***07@gmail.com', priority: 1 }] }
  );

  assert.equal(expanded.isCombo, true);
  assert.equal(expanded.comboBranches.length, 2);
  assert.equal(expanded.comboBranches[0].outboundModelId, 'gemini-3.8-flash');

  // Role-policy rejection of a combo branch is the selector's job: Slice C (AC-AI-171-07 second half).
});
