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

  test('P1 Review 1: SWE-bench parser takes ONLY Verified split, ignores Lite in Lite-first, and fails closed when Verified is absent', () => {
    // 1. Lite-first fixture: must extract ONLY the Verified split and ignore Lite
    const liteFirstHtml = fs.readFileSync(
      path.join(FIXTURES_DIR, 'swebench-lite-first.html'),
      'utf8'
    );
    const liteFirstRows = sweBenchRows(liteFirstHtml, testConfig);
    assert.equal(liteFirstRows.length, 1);
    assert.ok(liteFirstRows[0].modelId.includes('claude-opus-4-5'));
    assert.equal(liteFirstRows[0].benchmarks.sweBenchVerified, 79.2);
    assert.equal(
      liteFirstRows.some((r) => r.modelId.includes('fake-lite')),
      false,
      'Lite board results must never be emitted as verified scores'
    );

    // 2. Missing-Verified fixture: must throw PRIORS_SWEBENCH_SCHEMA_CHANGED and record no score (fail closed)
    const missingVerifiedHtml = fs.readFileSync(
      path.join(FIXTURES_DIR, 'swebench-missing-verified.html'),
      'utf8'
    );
    assert.throws(
      () => sweBenchRows(missingVerifiedHtml, testConfig),
      /PRIORS_SWEBENCH_SCHEMA_CHANGED/,
      'must throw when Verified split is absent'
    );
  });

  test('P1 Review 2: priorFor enforces provisional precedence so higher-scoring provisional candidates never outrank official candidates', () => {
    const priors = {
      label: 'EXTERNAL_PRIOR',
      roleWeights: testConfig.roleWeights,
      ranking: [
        {
          canonical: 'official-low',
          score: 60.0,
          codingTier: 'T3',
          reviewTier: 'T3',
          benchmarks: [{ name: 'sweBenchVerified', score: 60.0, provisional: false }],
        },
        {
          canonical: 'provisional-high',
          provisional: true,
          score: 59.9,
          codingTier: 'T4',
          reviewTier: 'T4',
          benchmarks: [{ name: 'sweBenchVerified', score: 95.0, provisional: true }],
        },
      ],
    };

    const offPrior = priorFor({ modelId: 'official-low' }, 'coding', priors);
    const provPrior = priorFor({ modelId: 'provisional-high' }, 'coding', priors);

    assert.ok(offPrior, 'official prior must exist');
    assert.ok(provPrior, 'provisional prior must exist');
    assert.equal(provPrior.provisional, true, 'provisional prior must flag provisional: true');
    assert.ok(
      offPrior.score > provPrior.score,
      `Official routing score (${offPrior.score}) must strictly exceed provisional routing score (${provPrior.score})`
    );
  });

  test('P1 Review 2: Official score of zero produces strictly lower provisional routing score, never equality', () => {
    // Official model has score of 0
    const docs = [
      {
        sources: [{ id: 'benchlm', url: 'https://benchlm.ai/data/models.json' }],
        models: [
          {
            modelId: 'official-zero',
            benchmarks: { benchlm: 0.0 },
            rankingEligible: true,
          },
          {
            modelId: 'provisional-model',
            benchmarks: { benchlm: 90.0 },
            rankingEligible: false,
            provisional: true,
          },
        ],
      },
    ];

    const minMaxConfig = {
      ...testConfig,
      normalization: { method: 'min-max' },
      normalizationMethod: 'min-max',
    };
    const merged = mergePriorDocuments(docs, undefined, { config: minMaxConfig });
    const mOfficial = merged.ranking.find((r) => r.canonical === 'official-zero');
    const mProv = merged.ranking.find((r) => r.canonical === 'provisional-model');

    assert.ok(mOfficial, 'official model must exist');
    assert.ok(mProv, 'provisional model must exist');
    assert.equal(mOfficial.score, 0.0, 'official score is 0');
    assert.ok(
      mProv.score < 0,
      `Provisional score (${mProv.score}) must be strictly lower than 0 when official score is 0`
    );
    assert.equal(mProv.score, -0.1);
    assert.ok(
      mOfficial.score > mProv.score,
      `Official score (${mOfficial.score}) must be strictly greater than provisional score (${mProv.score})`
    );

    // priorFor routing score must also be strictly lower than 0
    const offPrior = priorFor({ modelId: 'official-zero' }, 'coding', merged);
    const provPrior = priorFor({ modelId: 'provisional-model' }, 'coding', merged);

    assert.equal(offPrior.score, 0);
    assert.ok(
      provPrior.score < 0,
      `Provisional routing score (${provPrior.score}) must be strictly lower than 0`
    );
    assert.equal(provPrior.score, -0.1);
    assert.ok(offPrior.score > provPrior.score);
  });

  test('P1 Review 2: Provisional precedence applies across every score path: per-row benchmarks, effort aggregates, and ranking ordering', () => {
    const docs = [
      {
        sources: [{ id: 'benchlm', url: 'https://benchlm.ai/data/models.json' }],
        models: [
          {
            modelId: 'official-baseline',
            benchmarks: { benchlm: 70.0 },
            rankingEligible: true,
          },
          {
            modelId: 'prov-base',
            benchmarks: { benchlm: 98.0 },
            rankingEligible: false,
            provisional: true,
          },
          {
            modelId: 'prov-with-effort (high)',
            benchmarks: { benchlm: 99.0 },
            rankingEligible: false,
            provisional: true,
          },
        ],
      },
    ];

    const merged = mergePriorDocuments(docs, undefined, { config: testConfig });
    const mOfficial = merged.ranking.find((r) => r.canonical === 'official-baseline');
    const mProvBase = merged.ranking.find((r) => r.canonical === 'prov-base');
    const mProvEff = merged.ranking.find((r) => r.canonical.includes('prov-with-effort'));

    assert.ok(mOfficial);
    assert.ok(mProvBase);
    assert.ok(mProvEff);

    // 1. Per-row score and rawScore
    assert.ok(mProvBase.score < mOfficial.score, 'row.score must be strictly less than official');
    assert.ok(
      mProvBase.rawScore < mOfficial.score,
      'row.rawScore must be strictly less than official'
    );

    // 2. Per-row individual benchmarks
    for (const b of mProvBase.benchmarks) {
      assert.ok(
        b.score < mOfficial.score,
        `benchmark ${b.name} score (${b.score}) must be < official (${mOfficial.score})`
      );
      assert.ok(
        b.normalizedScore < mOfficial.score,
        `benchmark ${b.name} normalizedScore (${b.normalizedScore}) must be < official (${mOfficial.score})`
      );
    }

    // 3. Effort aggregates and effort benchmarks
    assert.ok(mProvEff.efforts && mProvEff.efforts.high, 'high effort must exist');
    const highEffort = mProvEff.efforts.high;
    assert.ok(highEffort.score < mOfficial.score, 'effort aggregate score must be < official');
    assert.ok(
      highEffort.rawScore < mOfficial.score,
      'effort aggregate rawScore must be < official'
    );
    for (const eb of highEffort.benchmarks) {
      assert.ok(eb.score < mOfficial.score, `effort benchmark ${eb.name} score must be < official`);
      assert.ok(
        eb.normalizedScore < mOfficial.score,
        `effort benchmark ${eb.name} normalizedScore must be < official`
      );
    }

    // 4. Final ranking ordering: all official models strictly precede all provisional models
    const lastOfficialIdx = merged.ranking.findLastIndex((r) => !r.provisional);
    const firstProvIdx = merged.ranking.findIndex((r) => r.provisional);
    assert.ok(lastOfficialIdx !== -1, 'must have official model');
    assert.ok(firstProvIdx !== -1, 'must have provisional model');
    assert.ok(
      lastOfficialIdx < firstProvIdx,
      'all official models must precede all provisional models in ranking'
    );

    // 5. priorFor on base and effort candidates enforces strict precedence
    const pOfficial = priorFor({ modelId: 'official-baseline' }, 'coding', merged);
    const pProvBase = priorFor({ modelId: 'prov-base' }, 'coding', merged);
    const pProvEff = priorFor({ modelId: 'prov-with-effort (high)' }, 'coding', merged);

    assert.ok(pOfficial, 'official prior must exist');
    assert.ok(pProvBase, 'provisional base prior must exist');
    assert.ok(pProvEff, 'provisional effort prior must exist');
    assert.equal(pProvBase.provisional, true, 'provisional base must be marked provisional');
    assert.equal(pProvEff.provisional, true, 'provisional effort must be marked provisional');
    assert.ok(
      pOfficial.score > pProvBase.score,
      `Official prior (${pOfficial.score}) must exceed provisional base prior (${pProvBase.score})`
    );
    assert.ok(
      pOfficial.score > pProvEff.score,
      `Official prior (${pOfficial.score}) must exceed provisional effort prior (${pProvEff.score})`
    );
  });

  test('P1 Review 2: priorFor enforces provisional precedence when official candidate has fallback-only benchmark and missing aggregate score', () => {
    // Official model has NO role-weighted benchmarks and NO row.score aggregate, only fallback benchmark
    const priors = {
      label: 'EXTERNAL_PRIOR',
      roleWeights: testConfig.roleWeights,
      ranking: [
        {
          canonical: 'official-fallback-only',
          provisional: false,
          codingTier: 'T3',
          reviewTier: 'T3',
          // score is deliberately undefined / missing
          benchmarks: [{ name: 'benchlm', score: 65.0, provisional: false }],
        },
        {
          canonical: 'prov-candidate',
          provisional: true,
          codingTier: 'T4',
          reviewTier: 'T4',
          // Provisional model has high role benchmark (weighted score 100)
          benchmarks: [{ name: 'sweBenchVerified', score: 95.0, provisional: true }],
        },
      ],
    };

    const offPrior = priorFor({ modelId: 'official-fallback-only' }, 'coding', priors);
    const provPrior = priorFor({ modelId: 'prov-candidate' }, 'coding', priors);

    assert.ok(offPrior, 'official prior must exist');
    assert.ok(provPrior, 'provisional prior must exist');
    assert.ok(Number.isFinite(offPrior.score), 'official fallback score must be computed');
    assert.ok(Number.isFinite(provPrior.score), 'provisional score must be computed');
    assert.equal(provPrior.provisional, true, 'provisional candidate must be marked provisional');
    assert.ok(
      offPrior.score > provPrior.score,
      `Official computed fallback score (${offPrior.score}) must strictly exceed provisional score (${provPrior.score})`
    );
    assert.equal(
      provPrior.score,
      Math.round((offPrior.score - 0.1) * 10) / 10,
      'Provisional score must be capped strictly below official fallback score'
    );
  });

  test('P1 Review 2: priorFor enforces provisional precedence on effort candidates when official candidate has missing aggregate score', () => {
    const priors = {
      label: 'EXTERNAL_PRIOR',
      roleWeights: testConfig.roleWeights,
      ranking: [
        {
          canonical: 'official-model',
          provisional: false,
          codingTier: 'T3',
          reviewTier: 'T3',
          // score is deliberately missing
          benchmarks: [{ name: 'benchlm', score: 70.0, provisional: false }],
        },
        {
          canonical: 'prov-model',
          provisional: true,
          codingTier: 'T4',
          reviewTier: 'T4',
          benchmarks: [{ name: 'sweBenchVerified', score: 98.0, provisional: true }],
          efforts: {
            high: {
              provisional: true,
              benchmarks: [{ name: 'sweBenchVerified', score: 99.0, provisional: true }],
            },
          },
        },
      ],
    };

    const offPrior = priorFor({ modelId: 'official-model' }, 'coding', priors);
    const provEffPrior = priorFor({ modelId: 'prov-model (high)' }, 'coding', priors);

    assert.ok(offPrior, 'official prior must exist');
    assert.ok(provEffPrior, 'provisional effort prior must exist');
    assert.equal(provEffPrior.provisional, true);
    assert.ok(
      offPrior.score > provEffPrior.score,
      `Official score (${offPrior.score}) must strictly exceed provisional effort score (${provEffPrior.score})`
    );
  });

  test('P1 Review 3: Default publicDocuments ingestion (no descriptor) ingests every configured benchmark source', async () => {
    const sweHtml = fs.readFileSync(path.join(FIXTURES_DIR, 'swebench.html'), 'utf8');
    const tbenchHtml = fs.readFileSync(path.join(FIXTURES_DIR, 'terminalbench.html'), 'utf8');
    const aiderYaml = fs.readFileSync(path.join(FIXTURES_DIR, 'aider.yml'), 'utf8');
    const liveCsv = fs.readFileSync(path.join(FIXTURES_DIR, 'livebench.csv'), 'utf8');
    const benchJson = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'benchlm.json'), 'utf8'));

    const calledUrls = [];
    const mockFetch = async (url) => {
      calledUrls.push(url);
      if (url.includes('swebench')) return { ok: true, text: async () => sweHtml };
      if (url.includes('tbench')) return { ok: true, text: async () => tbenchHtml };
      if (url.includes('aider')) return { ok: true, text: async () => aiderYaml };
      if (url.includes('livebench')) return { ok: true, text: async () => liveCsv };
      if (url.includes('benchlm')) return { ok: true, json: async () => benchJson };
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
      fetch: mockFetch,
      now: Date.parse('2026-10-29T00:00:00Z'),
    });

    assert.equal(
      docs.length,
      testConfig.sources.length,
      'must ingest all configured sources by default'
    );
    assert.deepEqual(
      docs.map((d) => d.sources[0].id),
      testConfig.sources.map((s) => s.id),
      'must preserve configured order of source IDs'
    );
  });

  test('P1 Review 4: One provisional source does not poison whole model; official scores are tracked per-source and never capped below weakest official', () => {
    const now = Date.parse('2026-10-29T00:00:00Z');
    const docAA = {
      sources: [
        { id: 'artificial-analysis', url: 'https://artificialanalysis.ai/leaderboards/models' },
      ],
      models: [
        {
          modelId: 'canonical-alpha',
          benchmarks: { intelligenceIndex: 90.0 },
          source: {
            id: 'artificial-analysis',
            url: 'https://artificialanalysis.ai/leaderboards/models',
          },
        },
        {
          modelId: 'canonical-beta',
          benchmarks: { intelligenceIndex: 40.0 },
          source: {
            id: 'artificial-analysis',
            url: 'https://artificialanalysis.ai/leaderboards/models',
          },
        },
      ],
    };
    const docSWE = {
      sources: [{ id: 'swe-bench', url: 'https://www.swebench.com' }],
      models: [
        {
          modelId: 'canonical-alpha',
          benchmarks: { sweBenchVerified: 85.0 },
          source: { id: 'swe-bench', url: 'https://www.swebench.com' },
        },
        {
          modelId: 'canonical-beta',
          benchmarks: { sweBenchVerified: 45.0 },
          source: { id: 'swe-bench', url: 'https://www.swebench.com' },
        },
      ],
    };
    // BenchLM provides a provisional score for canonical-alpha along with non-provisional aaCodingIndex,
    // plus a purely provisional model canonical-gamma.
    const docBenchLM = {
      sources: [{ id: 'benchlm', url: 'https://benchlm.ai/data/models.json' }],
      models: [
        {
          modelId: 'canonical-alpha',
          provisional: true,
          benchmarks: {
            benchlm: { score: 70.0, provisional: true },
            aaCodingIndex: 88.0,
          },
          source: { id: 'benchlm', url: 'https://benchlm.ai/data/models.json' },
        },
        {
          modelId: 'canonical-gamma',
          provisional: true,
          benchmarks: {
            benchlm: { score: 95.0, provisional: true },
          },
          source: { id: 'benchlm', url: 'https://benchlm.ai/data/models.json' },
        },
      ],
    };

    const merged = mergePriorDocuments([docAA, docSWE, docBenchLM], now, {
      config: testConfig,
    });

    const alpha = merged.ranking.find((r) => r.canonical === 'canonical-alpha');
    const beta = merged.ranking.find((r) => r.canonical === 'canonical-beta');
    const gamma = merged.ranking.find((r) => r.canonical === 'canonical-gamma');

    assert.ok(alpha, 'alpha must exist in ranking');
    assert.ok(beta, 'beta must exist in ranking');
    assert.ok(gamma, 'gamma must exist in ranking');

    // Model alpha carries official AA and SWE benchmarks, so it must NOT be marked provisional
    assert.equal(
      alpha.provisional,
      false,
      'Model with official metrics must not be marked provisional overall'
    );
    assert.equal(beta.provisional, false, 'Official model beta must not be provisional');
    assert.equal(
      gamma.provisional,
      true,
      'Pure provisional model gamma must be marked provisional'
    );

    // Official metrics on alpha must not be capped below beta's weakest official aggregate
    const alphaSwe = alpha.benchmarks.find((b) => b.name === 'sweBenchVerified');
    const alphaIntel = alpha.benchmarks.find((b) => b.name === 'intelligenceIndex');
    const alphaCoding = alpha.benchmarks.find((b) => b.name === 'aaCodingIndex');
    const alphaBench = alpha.benchmarks.find((b) => b.name === 'benchlm');

    assert.ok(alphaSwe, 'sweBenchVerified benchmark must exist on alpha');
    assert.equal(alphaSwe.provisional, undefined, 'official SWE benchmark must not be provisional');
    assert.ok(
      alphaSwe.score > beta.score,
      `Official SWE score (${alphaSwe.score}) must exceed beta score (${beta.score})`
    );

    assert.ok(alphaIntel, 'intelligenceIndex benchmark must exist on alpha');
    assert.equal(
      alphaIntel.provisional,
      undefined,
      'official intelligenceIndex benchmark must not be provisional'
    );
    assert.ok(
      alphaIntel.score > beta.score,
      `Official intelligenceIndex (${alphaIntel.score}) must exceed beta score (${beta.score})`
    );

    assert.ok(alphaCoding, 'aaCodingIndex benchmark must exist on alpha');
    assert.equal(
      alphaCoding.provisional,
      undefined,
      'non-provisional aaCodingIndex must not be provisional'
    );
    assert.ok(
      alphaCoding.score > beta.score,
      `Official aaCodingIndex (${alphaCoding.score}) must exceed beta score (${beta.score})`
    );

    // Alpha's provisional benchmark IS tracked as provisional
    assert.ok(alphaBench, 'benchlm benchmark must exist on alpha');
    assert.equal(alphaBench.provisional, true, 'provisional benchlm must be marked provisional');

    // Alpha's overall score must reflect official strength and not be capped below beta
    assert.ok(
      alpha.score > beta.score,
      `Alpha overall score (${alpha.score}) must strictly exceed beta score (${beta.score})`
    );

    // Ranking ordering: alpha > beta > gamma
    const idxAlpha = merged.ranking.indexOf(alpha);
    const idxBeta = merged.ranking.indexOf(beta);
    const idxGamma = merged.ranking.indexOf(gamma);

    assert.ok(idxAlpha < idxBeta, `Alpha (index ${idxAlpha}) must outrank beta (index ${idxBeta})`);
    assert.ok(
      idxBeta < idxGamma,
      `Official beta (index ${idxBeta}) must outrank pure provisional gamma (index ${idxGamma})`
    );

    // priorFor verification
    const priorAlpha = priorFor({ modelId: 'canonical-alpha' }, 'coding', merged);
    const priorBeta = priorFor({ modelId: 'canonical-beta' }, 'coding', merged);
    const priorGamma = priorFor({ modelId: 'canonical-gamma' }, 'coding', merged);

    assert.equal(priorAlpha.provisional, undefined, 'priorFor alpha must not be provisional');
    assert.equal(priorGamma.provisional, true, 'priorFor gamma must be provisional');
    assert.ok(
      priorAlpha.score > priorBeta.score,
      `priorFor alpha (${priorAlpha.score}) must exceed beta (${priorBeta.score})`
    );
    assert.ok(
      priorBeta.score > priorGamma.score,
      `priorFor beta (${priorBeta.score}) must exceed provisional gamma (${priorGamma.score})`
    );
  });
});
