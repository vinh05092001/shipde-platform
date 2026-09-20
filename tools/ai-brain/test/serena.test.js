'use strict';

// TASK-AI-32 — unit tests for the Serena code retrieval pilot.
// Tests symbol extraction, reference finding, read-only guards, and token efficiency.

const { describe, test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const {
  estimateTokens,
  extractSymbolsFromFile,
  lookupSymbols,
  lookupReferences,
  measureTokenEfficiency,
  checkHealth,
  runSerenaCli,
  TOKENS_PER_MERGED_CEILING,
} = require('../serena');

describe('Serena Token Estimation', () => {
  test('returns 0 for empty or null strings', () => {
    assert.strictEqual(estimateTokens(''), 0);
    assert.strictEqual(estimateTokens(null), 0);
    assert.strictEqual(estimateTokens(undefined), 0);
  });

  test('estimates tokens at approximately 4 characters per token', () => {
    assert.strictEqual(estimateTokens('1234'), 1);
    assert.strictEqual(estimateTokens('12345678'), 2);
    assert.strictEqual(estimateTokens('a'.repeat(400)), 100);
  });
});

describe('Serena Read-Only Invariant & Mutation Refusal', () => {
  test('lookupSymbols throws MUTATION_REFUSED when write: true', () => {
    assert.throws(
      () => lookupSymbols({ symbol: 'foo', write: true }),
      (err) => err.code === 'MUTATION_REFUSED'
    );
  });

  test('lookupReferences throws MUTATION_REFUSED when mutate: true', () => {
    assert.throws(
      () => lookupReferences({ symbol: 'foo', mutate: true }),
      (err) => err.code === 'MUTATION_REFUSED'
    );
  });

  test('measureTokenEfficiency throws MUTATION_REFUSED when edit: true', () => {
    assert.throws(
      () => measureTokenEfficiency({ symbol: 'foo', edit: true }),
      (err) => err.code === 'MUTATION_REFUSED'
    );
  });

  test('runSerenaCli exits 1 when --write is passed', () => {
    const code = runSerenaCli(['lookup', '--symbol', 'foo', '--write']);
    assert.strictEqual(code, 1);
  });
});

describe('Serena Symbol Extraction & Lookup', () => {
  test('extracts function and class definitions from JS source', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'serena-test-'));
    const testFile = path.join(tmpDir, 'sample.js');
    const source = [
      '// Sample file',
      'function computeSum(a, b) {',
      '  return a + b;',
      '}',
      '',
      'class Calculator {',
      '  multiply(x, y) {',
      '    return x * y;',
      '  }',
      '}',
      '',
      'const helper = (val) => {',
      '  return val * 2;',
      '};',
    ].join('\n');
    fs.writeFileSync(testFile, source);

    try {
      const symbols = extractSymbolsFromFile(testFile, tmpDir);
      assert.strictEqual(symbols.length, 4);

      const sumFn = symbols.find((s) => s.name === 'computeSum');
      assert.ok(sumFn);
      assert.strictEqual(sumFn.kind, 'function');
      assert.strictEqual(sumFn.startLine, 2);
      assert.strictEqual(sumFn.endLine, 4);
      assert.ok(sumFn.declaration.includes('function computeSum'));

      const calcClass = symbols.find((s) => s.name === 'Calculator');
      assert.ok(calcClass);
      assert.strictEqual(calcClass.kind, 'class');
      assert.strictEqual(calcClass.startLine, 6);
      assert.strictEqual(calcClass.endLine, 10);

      const multMethod = symbols.find((s) => s.name === 'multiply');
      assert.ok(multMethod);
      assert.strictEqual(multMethod.kind, 'method');
      assert.strictEqual(multMethod.startLine, 7);
      assert.strictEqual(multMethod.endLine, 9);

      const lookup = lookupSymbols({ symbol: 'computeSum', root: tmpDir });
      assert.strictEqual(lookup.count, 1);
      assert.strictEqual(lookup.definitions[0].name, 'computeSum');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('throws SOURCE_MISSING on non-existent file or missing symbol', () => {
    assert.throws(
      () => extractSymbolsFromFile('non/existent/path.js'),
      (err) => err.code === 'SOURCE_MISSING'
    );

    assert.throws(
      () => lookupSymbols({ symbol: '' }),
      (err) => err.code === 'SOURCE_MISSING'
    );
  });
});

describe('Serena Reference Lookup', () => {
  test('finds symbol references and definitions across files', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'serena-ref-'));
    const f1 = path.join(tmpDir, 'defs.js');
    const f2 = path.join(tmpDir, 'consumer.js');
    fs.writeFileSync(f1, 'function doWork() {\n  return 42;\n}\n');
    fs.writeFileSync(f2, 'const x = doWork();\nconsole.log(doWork);\n');

    try {
      const refs = lookupReferences({ symbol: 'doWork', root: tmpDir });
      assert.strictEqual(refs.count, 3);
      const defRef = refs.references.find((r) => r.isDefinition);
      assert.ok(defRef);
      assert.strictEqual(defRef.file, 'defs.js');
      assert.strictEqual(defRef.line, 1);

      const usages = refs.references.filter((r) => !r.isDefinition);
      assert.strictEqual(usages.length, 2);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('Serena Token Efficiency Measurement', () => {
  test('measures savings of focused retrieval vs full file ingestion', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'serena-eff-'));
    const f1 = path.join(tmpDir, 'large.js');
    const padding = '// Padding line to increase file size\n'.repeat(100);
    const code = 'function targetFn() {\n  return 100;\n}\n' + padding;
    fs.writeFileSync(f1, code);

    try {
      const res = measureTokenEfficiency({ symbol: 'targetFn', root: tmpDir });
      assert.strictEqual(res.definitionCount, 1);
      assert.ok(res.fullFilesTokens > res.focusedTokens);
      assert.ok(res.tokensSaved > 0);
      assert.ok(res.savingsPercent > 50);
      assert.strictEqual(res.withinCeiling, true);
      assert.strictEqual(res.tokenCeiling, TOKENS_PER_MERGED_CEILING);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('Serena Health & CLI Interface', () => {
  test('checkHealth returns healthy on present snapshot and manifest entry', () => {
    const h = checkHealth();
    assert.strictEqual(h.healthy, true);
    assert.strictEqual(h.snapshotPresent, true);
    assert.strictEqual(h.manifestEntryPresent, true);
    assert.strictEqual(h.permissions, 'ast-index-read');
    assert.ok(h.profiles.includes('RESEARCH_ONLY'));
  });

  test('runSerenaCli handles help and missing argument errors cleanly', () => {
    assert.strictEqual(runSerenaCli(['--help']), 0);
    assert.strictEqual(runSerenaCli(['health']), 0);
    assert.strictEqual(runSerenaCli(['lookup']), 2); // missing --symbol
    assert.strictEqual(runSerenaCli(['unknown_sub']), 2);
  });
});
