'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  publicDocuments,
  sweBenchRows,
  terminalBenchRows,
  aiderRows,
  liveBenchRows,
  benchlmRows,
  resolveCreatorModelAlias,
  validatePublicDocuments,
} = require('../priors-public');

const {
  mergePriorDocuments,
  matchModelPrior,
  priorFor,
  roleBenchmarkProfile,
} = require('../priors');

const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'benchmark-sources');
const testConfig = require('../priors-sources/public.json');

describe('TASK-AI-146: Coding-agent benchmark sources and provisional weighting', () => {
  test('Requirement 2 & 6: SWE-bench parser extracts verified leaderboard scores and model tags from fixture', () => {
    const html = fs.readFileSync(path.join(FIXTURES_DIR, 'swebench.html'), 'utf8');
    const rows = sweBenchRows(html, testConfig);

    assert.ok(Array.isArray(rows), 'rows must be an array');
    assert.equal(rows.length, 2, 'fixture has 2 verified entries');

    const opus = rows.find((r) => r.modelId.includes('claude-opus-4-5'));
    assert.ok(opus, 'must extract model from Model: tag');
    assert.equal(opus.benchmarks.sweBenchVerified, 79.2);
    assert.equal(opus.creator, 'Anthropic');

    const gemini = rows.find((r) => r.modelId.includes('gemini-3-flash'));
    assert.ok(gemini, 'must extract gemini model');
    assert.equal(gemini.benchmarks.sweBenchVerified, 68.4);
    assert.ok(gemini.modelId.includes('high'), 'must preserve reasoning effort in modelId');
  });

  test('Requirement 2 & 6: Terminal-Bench parser extracts accuracy and reasoning effort from Next.js payload fixture', () => {
    const html = fs.readFileSync(path.join(FIXTURES_DIR, 'terminalbench.html'), 'utf8');
    const rows = terminalBenchRows(html, testConfig);

    assert.ok(Array.isArray(rows), 'rows must be an array');
    assert.equal(rows.length, 2);

    const opus = rows.find((r) => r.modelId.includes('Opus 5.5'));
    assert.ok(opus);
    assert.equal(opus.benchmarks.terminalBenchAccuracy, 64.9);
    assert.equal(opus.creator, 'Anthropic');
    assert.ok(opus.modelId.includes('max'), 'must append reasoning effort max');

    const astra = rows.find((r) => r.modelId.includes('GPT-6 Astra'));
    assert.ok(astra);
    assert.equal(astra.benchmarks.terminalBenchAccuracy, 62.1);
  });

  test('Requirement 2 & 6: Aider polyglot parser extracts pass rates without external dependencies from fixture', () => {
    const yaml = fs.readFileSync(path.join(FIXTURES_DIR, 'aider.yml'), 'utf8');
    const rows = aiderRows(yaml, testConfig);

    assert.ok(Array.isArray(rows), 'rows must be an array');
    assert.equal(rows.length, 2);

    const gemini = rows.find((r) => r.modelId.includes('Gemini 2.0 Pro'));
    assert.ok(gemini);
    assert.equal(gemini.benchmarks.aiderPolyglot, 35.6, 'uses pass_rate_2');

    const gpt4 = rows.find((r) => r.modelId.includes('gpt-4o-mini'));
    assert.ok(gpt4);
    assert.equal(gpt4.benchmarks.aiderPolyglot, 3.6);
  });

  test('Requirement 2 & 6: LiveBench parser extracts coding, reasoning, and agentic scores from CSV fixture', () => {
    const csv = fs.readFileSync(path.join(FIXTURES_DIR, 'livebench.csv'), 'utf8');
    const rows = liveBenchRows(csv, testConfig);

    assert.ok(Array.isArray(rows), 'rows must be an array');
    assert.equal(rows.length, 3);

    const fable = rows.find((r) => r.modelId === 'claude-fable-5.1');
    assert.ok(fable);
    assert.equal(fable.benchmarks.liveBenchCoding, 97.7);
    assert.equal(fable.benchmarks.liveBenchReasoning, 91.7);
    assert.equal(fable.benchmarks.liveBenchAgentic, 77.9);
  });

  test('Requirement 3: Role weights live in configuration, weighting coding-agent benchmarks heavily for coding/review', () => {
    const codingProfile = roleBenchmarkProfile('coding', testConfig);
    const reviewProfile = roleBenchmarkProfile('review', testConfig);

    assert.ok(codingProfile, 'coding profile must exist');
    assert.ok(reviewProfile, 'review profile must exist');

    // Artificial Analysis is primary
    assert.ok(codingProfile.aaCodingIndex >= 0.25, 'aaCodingIndex is primary in coding');
    assert.ok(reviewProfile.intelligenceIndex >= 0.25, 'intelligenceIndex is primary in review');

    // Coding-agent sources are weighted for coding/review
    assert.ok(codingProfile.sweBenchVerified >= 0.2, 'SWE-bench weighted heavily for coding');
    assert.ok(codingProfile.terminalBenchAccuracy >= 0.15, 'Terminal-Bench weighted for coding');
    assert.ok(codingProfile.aiderPolyglot >= 0.1, 'Aider weighted for coding');
    assert.ok(codingProfile.liveBenchCoding >= 0.1, 'LiveBench weighted for coding');

    // benchlm only fills gaps with lower weight
    assert.equal(codingProfile.benchlm, 0.05, 'benchlm has low weight 0.05 in coding');
    assert.equal(reviewProfile.benchlm, 0.05, 'benchlm has low weight 0.05 in review');
  });

  test('Requirement 4: Provisional scores are marked provisional: true, down-weighted by config, and cannot outrank official scores', () => {
    const benchJson = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'benchlm.json'), 'utf8'));
    const rows = benchlmRows(benchJson, testConfig);

    // Official row: gpt-6-astra
    const astra = rows.find((r) => r.modelId === 'gpt-6-astra');
    assert.ok(astra);
    assert.equal(astra.benchmarks.benchlm.provisional, false);
    assert.equal(astra.provisional, undefined);

    // Provisional row: flint (Recursive)
    const flint = rows.find((r) => r.modelId.includes('flint'));
    assert.ok(flint);
    assert.equal(flint.benchmarks.benchlm.score, 88.0);
    assert.equal(flint.benchmarks.benchlm.provisional, true);
    assert.equal(flint.provisional, true);

    // Experimental model with raw score 95.0 (higher than astra 86.08)
    const exp = rows.find((r) => r.modelId === 'experimental-model');
    assert.ok(exp);
    assert.equal(exp.benchmarks.benchlm.score, 95.0);
    assert.equal(exp.benchmarks.benchlm.provisional, true);
    assert.equal(exp.provisional, true);

    // Merge into priors document
    const docs = [
      {
        sources: [{ id: 'benchlm', url: 'https://benchlm.ai/data/models.json' }],
        retrievedAt: new Date().toISOString(),
        models: rows,
      },
    ];

    const merged = mergePriorDocuments(docs, undefined, { config: testConfig });

    const mOfficial = merged.ranking.find((r) => r.canonical === 'gpt-6-astra');
    const mProv = merged.ranking.find((r) => r.canonical === 'experimental-model');

    assert.ok(mOfficial, 'official model must exist');
    assert.ok(mProv, 'provisional model must exist');
    assert.equal(mProv.provisional, true, 'provisional model must be marked provisional: true');

    // Provisional model can NEVER outrank an official model
    assert.ok(
      mOfficial.score > mProv.score,
      `Official score (${mOfficial.score}) must be strictly higher than provisional score (${mProv.score})`
    );

    // In ranking array, official models strictly precede provisional models
    const astraIdx = merged.ranking.findIndex((r) => r.canonical === 'gpt-6-astra');
    const expIdx = merged.ranking.findIndex((r) => r.canonical === 'experimental-model');
    assert.ok(astraIdx < expIdx, 'official model must rank ahead of provisional model');
  });

  test('Requirement 5: Aliases from source data map creator + model to router IDs via config rules; unknown stays unmatched', () => {
    // 1. Configured rule: Creator "Recursive", Model "Flint" -> recursive/flint-v1.0:free
    const routerId = resolveCreatorModelAlias('Recursive', 'Flint', testConfig);
    assert.equal(routerId, 'recursive/flint-v1.0:free');

    // 2. benchlm ingestion resolves the alias
    const benchJson = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'benchlm.json'), 'utf8'));
    const rows = benchlmRows(benchJson, testConfig);
    const flintRow = rows.find((r) => r.model === 'Flint');
    assert.ok(flintRow);
    assert.equal(flintRow.modelId, 'recursive/flint-v1.0:free');
    assert.deepEqual(flintRow.aliases, ['recursive/flint-v1.0:free']);

    // 3. Merging preserves alias and canonicalizes base
    const docs = [
      {
        sources: [{ id: 'benchlm', url: 'https://benchlm.ai/data/models.json' }],
        models: [flintRow],
      },
    ];
    const merged = mergePriorDocuments(docs, undefined, { config: testConfig });
    const match = matchModelPrior('recursive/flint-v1.0:free', merged.ranking, {
      config: testConfig,
    });
    assert.ok(match, 'router ID recursive/flint-v1.0:free must match canonical entry');
    assert.equal(match.entry.canonical, 'flint-v1-0');

    // 4. Unknown creator + model stays unmatched (fail closed)
    const unknownAlias = resolveCreatorModelAlias('UnknownCreator', 'UnknownModel', testConfig);
    assert.equal(unknownAlias, null, 'unknown creator/model must return null');

    const unknownMatch = matchModelPrior('unknowncompany/unknownmodel-v1:free', merged.ranking, {
      config: testConfig,
    });
    assert.equal(unknownMatch, null, 'unknown router ID must stay unmatched');
  });

  test('End-to-end: publicDocuments and mergePriorDocuments with all benchmark fixtures', async () => {
    const sweHtml = fs.readFileSync(path.join(FIXTURES_DIR, 'swebench.html'), 'utf8');
    const tbenchHtml = fs.readFileSync(path.join(FIXTURES_DIR, 'terminalbench.html'), 'utf8');
    const aiderYaml = fs.readFileSync(path.join(FIXTURES_DIR, 'aider.yml'), 'utf8');
    const liveCsv = fs.readFileSync(path.join(FIXTURES_DIR, 'livebench.csv'), 'utf8');
    const benchJson = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'benchlm.json'), 'utf8'));

    const mockFetch = async (url) => {
      if (url.includes('swebench')) {
        return { ok: true, text: async () => sweHtml };
      }
      if (url.includes('tbench')) {
        return { ok: true, text: async () => tbenchHtml };
      }
      if (url.includes('aider')) {
        return { ok: true, text: async () => aiderYaml };
      }
      if (url.includes('livebench')) {
        return { ok: true, text: async () => liveCsv };
      }
      if (url.includes('benchlm')) {
        return { ok: true, json: async () => benchJson };
      }
      if (url.includes('artificialanalysis')) {
        const aaHtml = `<script>self.__next_f.push(${JSON.stringify([
          1,
          '1:' +
            JSON.stringify({ models: [{ name: 'GPT-6 Astra', intelligenceIndex: 90.5 }] }) +
            '\n',
        ])})</script>`;
        return { ok: true, text: async () => aaHtml };
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const docs = await publicDocuments({
      descriptor: testConfig,
      fetch: mockFetch,
      now: Date.parse('2026-10-29T00:00:00Z'),
    });

    assert.equal(docs.length, 6, 'must ingest all 6 configured sources');
    validatePublicDocuments(docs);

    const merged = mergePriorDocuments(docs, Date.parse('2026-10-29T00:00:00Z'), {
      config: testConfig,
    });
    assert.ok(Array.isArray(merged.ranking));
    assert.ok(merged.ranking.length > 0);

    // Astra has both AA and SWE/Terminal/LiveBench/benchlm coverage
    const astra = merged.ranking.find((r) => r.canonical === 'gpt-6-astra');
    assert.ok(astra, 'gpt-6-astra must exist in ranking');
    assert.ok(astra.benchmarks.some((b) => b.name === 'intelligenceIndex'));
    assert.ok(astra.benchmarks.some((b) => b.name === 'terminalBenchAccuracy'));

    // Scoring with coding role produces positive score
    const priorCoding = priorFor({ modelId: 'gpt-6-astra' }, 'coding', merged);
    assert.ok(priorCoding.score > 0, 'prior score must be positive');
  });
});
