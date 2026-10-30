'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ctx7Command, lookupDocs, CTX7_VERSION } = require('../context7');

const library = [
  { id: '/acme/lib', title: 'Acme' },
  { id: '/other/lib', title: 'Other' },
];
const docs = {
  codeSnippets: [
    { codeTitle: 'With source', codeId: 'https://acme.dev/a', codeList: [{ code: 'x()' }] },
    { codeTitle: 'No source', codeList: [{ code: 'y()' }] },
  ],
};

function fakeRun(responses) {
  const calls = [];
  const run = async (args) => {
    calls.push(args);
    return responses[args[0]];
  };
  return { run, calls };
}

test('ctx7 runs pinned through npx unless SHIPDE_CTX7_BIN is set', () => {
  assert.deepEqual(ctx7Command({}).prefix, ['--yes', 'ctx7@' + CTX7_VERSION]);
  assert.equal(ctx7Command({ SHIPDE_CTX7_BIN: '/bin/ctx7' }).cmd, '/bin/ctx7');
});

test('lookup takes Context7 first-ranked library and keeps only cited snippets', async () => {
  const { run, calls } = fakeRun({
    library: { code: 0, stdout: JSON.stringify(library), stderr: '' },
    docs: { code: 0, stdout: JSON.stringify(docs), stderr: '' },
  });
  const result = await lookupDocs('acme', 'how to x', { run });
  assert.equal(result.ok, true);
  assert.equal(result.library.id, '/acme/lib');
  assert.deepEqual(calls[1].slice(0, 2), ['docs', '/acme/lib']);
  assert.deepEqual(
    result.snippets.map((s) => s.source),
    ['https://acme.dev/a']
  );
});

test('failure modes stay distinct and never pass', async () => {
  const down = fakeRun({ library: { code: 1, stdout: '', stderr: 'fetch failed' } });
  assert.equal((await lookupDocs('acme', 'q', { run: down.run })).error, 'CONTEXT7_UNAVAILABLE');
  const none = fakeRun({ library: { code: 0, stdout: '[]', stderr: '' } });
  assert.equal(
    (await lookupDocs('acme', 'q', { run: none.run })).error,
    'CONTEXT7_LIBRARY_NOT_FOUND'
  );
  const uncited = fakeRun({
    docs: { code: 0, stdout: JSON.stringify({ codeSnippets: [docs.codeSnippets[1]] }), stderr: '' },
  });
  const r = await lookupDocs('acme', 'q', { libraryId: '/acme/lib', run: uncited.run });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'CONTEXT7_NO_CITED_DOCS');
});
