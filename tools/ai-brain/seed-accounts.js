'use strict';

/**
 * Ship Dễ — Register the model sources that exist on this machine.
 *
 * The ladder is the operator's, not an inference from cost or locality:
 *
 *   tier 0  Docker worker, Antigravity account B  — the primary author
 *   tier 1  agy CLI on the host, account A        — first fallback
 *   tier 2  9router, local gateway                — second fallback
 *
 * Account A and account B are separate Google logins with separate quotas.
 * The container keeps its OAuth in its own volume, which is the whole point of
 * running it: the same CLI, a different account, a budget that drains on its
 * own clock. More Google accounts mean more containers at the same tier, and
 * the scheduler spreads across them rather than stacking.
 *
 * Model lists are what `agy models` and 9router's /v1/models actually return
 * today, not what any document claims. Two separate outages this week traced
 * to a configured model name the provider did not have.
 *
 * Coding grades below are PROVISIONAL declarations, explicitly marked with
 * gradeProvenance: 'provisional' so a placeholder cannot read as a
 * measurement. Nothing here has been measured. resolveGrade (fitness.js)
 * reports a declared grade as graded: true with source: 'declared', an absent
 * grade as graded: false with source: 'assumed' (STANDARD), and a value
 * outside the ladder as an error naming the model and the value. TASK-AI-30
 * replaces these provisional numbers with grades derived from recorded
 * qualification outcomes; TASK-AI-41 adds review grading.
 */

const { addAccount, listAccounts, updateAccount } = require('./accounts');
const { Difficulty } = require('./fitness');

const D = Difficulty;

/** The 14 models both Antigravity accounts expose. */
const ANTIGRAVITY_MODELS = [
  { model: 'gemini-3.8-flash-high', codingGrade: D.COMPLEX, reviewGrade: D.STANDARD, quality: 84 },
  { model: 'gemini-3.8-flash-medium', codingGrade: D.STANDARD, quality: 76 },
  { model: 'gemini-3.8-flash-low', codingGrade: D.MECHANICAL, quality: 62 },
  { model: 'gemini-3.7-flash-high', codingGrade: D.STANDARD, quality: 78 },
  { model: 'gemini-3.7-flash-medium', codingGrade: D.STANDARD, quality: 72 },
  { model: 'gemini-3.7-flash-low', codingGrade: D.MECHANICAL, quality: 58 },
  { model: 'gemini-3.6-flash-high', codingGrade: D.STANDARD, quality: 74 },
  { model: 'gemini-3.6-flash-medium', codingGrade: D.STANDARD, quality: 68 },
  { model: 'gemini-3.6-flash-low', codingGrade: D.MECHANICAL, quality: 54 },
  // Pro carries the architectural work on this provider.
  {
    model: 'gemini-3.1-pro-high',
    codingGrade: D.ARCHITECTURAL,
    reviewGrade: D.COMPLEX,
    quality: 90,
  },
  { model: 'gemini-3.1-pro-low', codingGrade: D.COMPLEX, reviewGrade: D.STANDARD, quality: 82 },
  // A thinking model is the one worth reserving for review.
  {
    model: 'claude-opus-4-6-thinking',
    codingGrade: D.ARCHITECTURAL,
    reviewGrade: D.ARCHITECTURAL,
    quality: 94,
  },
  { model: 'claude-sonnet-4-6', codingGrade: D.COMPLEX, reviewGrade: D.COMPLEX, quality: 86 },
  { model: 'gpt-oss-120b-medium', codingGrade: D.STANDARD, quality: 70 },
];

/**
 * 9router exposes 104 models across five prefixes. Only the ones worth
 * dispatching to are registered: listing all of them would imply a judgement
 * about 104 models nobody has made.
 */
const NINEROUTER_MODELS = [
  {
    model: 'cc/claude-opus-5',
    codingGrade: D.ARCHITECTURAL,
    reviewGrade: D.ARCHITECTURAL,
    quality: 96,
  },
  { model: 'cc/claude-sonnet-5', codingGrade: D.COMPLEX, reviewGrade: D.COMPLEX, quality: 88 },
  { model: 'cc/claude-haiku-4-5-20251001', codingGrade: D.MECHANICAL, quality: 60 },
  { model: 'kimchi/glm-5.3', codingGrade: D.STANDARD, quality: 72 },
  { model: 'kimchi/glm-5.3-flash', codingGrade: D.MECHANICAL, quality: 58 },
  { model: 'kimchi/deepseek-v4-flash-0731', codingGrade: D.STANDARD, quality: 74 },
  { model: 'kimchi/minimax-m3', codingGrade: D.STANDARD, quality: 70 },
  { model: 'gh/gpt-5.3-codex', codingGrade: D.COMPLEX, quality: 84 },
];

const ACCOUNTS = [
  {
    id: 'agy-docker-b',
    provider: 'antigravity',
    tier: 0,
    // How to reach it, recorded so the executor does not have to rediscover
    // that the default CMD opens a TUI and exits 255 without a terminal.
    launch: {
      kind: 'docker-compose',
      dir: 'scripts/ai/docker-worker',
      service: 'gemini-worker',
      command:
        'docker compose run --rm --no-TTY gemini-worker agy --print-timeout 120s --print <prompt> --output-format text --model <model>',
      note: 'OAuth account B, isolated in the gemini_worker_data volume',
    },
    capabilities: { jsonSchema: true, tools: true, contextWindow: 1000000 },
    cost: { inputPerMillion: 0, outputPerMillion: 0 },
    limits: {},
    models: ANTIGRAVITY_MODELS,
  },
  {
    id: 'agy-native-a',
    provider: 'antigravity',
    tier: 1,
    launch: {
      kind: 'cli',
      command: 'agy --print-timeout 120s --print <prompt> --output-format text --model <model>',
      note: 'OAuth account A, the host login in ~/.agy',
    },
    capabilities: { jsonSchema: true, tools: true, contextWindow: 1000000 },
    cost: { inputPerMillion: 0, outputPerMillion: 0 },
    limits: {},
    models: ANTIGRAVITY_MODELS,
  },
  {
    id: 'ninerouter',
    provider: 'oc',
    tier: 2,
    launch: {
      kind: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:20128/v1',
      note: 'Local gateway. Credential lives in the router, not here.',
    },
    capabilities: { jsonSchema: true, tools: true, contextWindow: 200000 },
    cost: { inputPerMillion: 0, outputPerMillion: 0 },
    limits: {},
    models: NINEROUTER_MODELS,
  },
];

function main() {
  const existing = new Set(listAccounts().map((a) => a.id));
  const added = [];
  const updated = [];

  for (const account of ACCOUNTS) {
    if (existing.has(account.id)) {
      updateAccount(account.id, account);
      updated.push(account.id);
    } else {
      addAccount(account);
      added.push(account.id);
    }
  }

  const all = listAccounts().sort((a, b) => a.tier - b.tier);
  console.log('');
  console.log('  Thêm  : ' + (added.join(', ') || '(không)'));
  console.log('  Cập nhật: ' + (updated.join(', ') || '(không)'));
  console.log('');
  console.log('  Bậc thang dự phòng:');
  for (const a of all) {
    console.log(
      '    tier ' +
        a.tier +
        '  ' +
        a.id.padEnd(14) +
        String((a.models || []).length).padStart(3) +
        ' model  ' +
        (a.limits && Object.keys(a.limits).length ? 'có hạn mức' : 'CHƯA khai hạn mức')
    );
  }
  console.log('');
  console.log('  Cấp độ model hiện là TẠM TÍNH, chưa đo. TASK-AI-27 và 41 thay bằng số thật.');
  console.log('');
}

if (require.main === module) main();

// Every grade declared above is a PROVISIONAL starting point, explicitly
// marked so a placeholder cannot read as a measurement. TASK-AI-30 replaces
// these with grades derived from recorded qualification outcomes; until then
// resolveGrade reports the class together with this provenance.
const GRADE_PROVENANCE = 'provisional';
for (const list of [ANTIGRAVITY_MODELS, NINEROUTER_MODELS]) {
  for (const model of list) model.gradeProvenance = GRADE_PROVENANCE;
}

module.exports = { ACCOUNTS, ANTIGRAVITY_MODELS, NINEROUTER_MODELS, GRADE_PROVENANCE };
