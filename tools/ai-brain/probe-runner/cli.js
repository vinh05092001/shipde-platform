#!/usr/bin/env node
'use strict';

/**
 * Ship Dễ — 9Router Catalogue Deterministic Batch Runner CLI
 *
 * Runs deterministic batch probing against the 9Router gateway.
 *
 * Usage:
 *   node tools/ai-brain/probe-runner/cli.js [options]
 *
 * Options:
 *   --gateway <url>           Gateway URL (default: http://127.0.0.1:20128)
 *   --catalogue <path>        Path to catalogue JSONL or JSON file
 *   --out <path>              Output JSONL results file (default: tools/ai-brain/data/probe-results.jsonl)
 *   --max-requests <N>        Maximum probe requests to initiate before stopping (0 = unlimited)
 *   --max-minutes <M>         Maximum runtime in minutes before stopping (0 = unlimited)
 *   --concurrency <N>         Initial worker concurrency (default: 2)
 *   --max-concurrency <N>     Maximum worker concurrency ceiling (default: 6)
 *   --connect-timeout <ms>    Connect timeout in ms (default: 1000)
 *   --read-timeout <ms>       Read timeout in ms (default: 15000)
 *   --help, -h                Show this help message
 */

const path = require('path');
const { runProbeBatch } = require('./runner');

function parseArgs(argv) {
  const args = argv.slice(2);
  const options = {
    gatewayUrl: 'http://127.0.0.1:20128',
    outPath: path.join(process.cwd(), 'tools', 'ai-brain', 'data', 'probe-results.jsonl'),
    catalogue: null,
    maxRequests: 0,
    maxMinutes: 0,
    concurrency: 2,
    maxConcurrency: 6,
    connectTimeoutMs: 1000,
    readTimeoutMs: 15000,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      return options;
    }
    if (arg === '--gateway' && i + 1 < args.length) {
      options.gatewayUrl = args[++i];
    } else if (arg === '--catalogue' && i + 1 < args.length) {
      options.catalogue = args[++i];
    } else if (arg === '--out' && i + 1 < args.length) {
      options.outPath = args[++i];
    } else if (arg === '--max-requests' && i + 1 < args.length) {
      options.maxRequests = parseInt(args[++i], 10);
    } else if (arg === '--max-minutes' && i + 1 < args.length) {
      options.maxMinutes = parseFloat(args[++i]);
    } else if (arg === '--concurrency' && i + 1 < args.length) {
      options.concurrency = parseInt(args[++i], 10);
    } else if (arg === '--max-concurrency' && i + 1 < args.length) {
      options.maxConcurrency = parseInt(args[++i], 10);
    } else if (arg === '--connect-timeout' && i + 1 < args.length) {
      options.connectTimeoutMs = parseInt(args[++i], 10);
    } else if (arg === '--read-timeout' && i + 1 < args.length) {
      options.readTimeoutMs = parseInt(args[++i], 10);
    }
  }

  return options;
}

function showHelp() {
  console.log(`Ship Dễ — 9Router Catalogue Deterministic Batch Runner

Usage:
  node tools/ai-brain/probe-runner/cli.js [options]

Options:
  --gateway <url>           Gateway URL (default: http://127.0.0.1:20128)
  --catalogue <path>        Path to catalogue JSONL or JSON file
  --out <path>              Output JSONL results file (default: tools/ai-brain/data/probe-results.jsonl)
  --max-requests <N>        Maximum probe requests to initiate before stopping (0 = unlimited)
  --max-minutes <M>         Maximum runtime in minutes before stopping (0 = unlimited)
  --concurrency <N>         Initial worker concurrency (default: 2)
  --max-concurrency <N>     Maximum worker concurrency ceiling (default: 6)
  --connect-timeout <ms>    Connect timeout in ms (default: 1000)
  --read-timeout <ms>       Read timeout in ms (default: 15000)
  --help, -h                Show this help message

Environment:
  NINEROUTER_API_KEY        Required bearer token for gateway completions.
`);
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    showHelp();
    process.exit(0);
  }

  console.log('Starting 9Router deterministic batch probe runner...');
  console.log(`Gateway:       ${options.gatewayUrl}`);
  console.log(`Output:        ${options.outPath}`);
  console.log(`Concurrency:   initial ${options.concurrency}, max ${options.maxConcurrency}`);
  if (options.maxRequests > 0) {
    console.log(`Budget reqs:   ${options.maxRequests}`);
  }
  if (options.maxMinutes > 0) {
    console.log(`Budget time:   ${options.maxMinutes} min`);
  }

  try {
    const summary = await runProbeBatch(options);
    console.log('\n--- Batch Completed ---');
    console.log(`Total catalogue models: ${summary.totalCatalogueModels}`);
    console.log(`Already completed:      ${summary.alreadyCompleted}`);
    console.log(`Probed in this batch:   ${summary.probedCount}`);
    console.log(`Passed:                 ${summary.passedCount}`);
    console.log(`Failed:                 ${summary.failedCount}`);
    console.log(`Deferred:               ${summary.deferredCount}`);
    console.log(`Duration:               ${(summary.durationMs / 1000).toFixed(1)}s`);
    if (summary.stoppedDueToBudget) {
      console.log(`Stopped due to budget:  ${summary.budgetReason}`);
      console.log('Run the batch runner again to resume the remaining models.');
    }
  } catch (err) {
    console.error(`\nBatch Aborted: ${err.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  parseArgs,
  main,
};
