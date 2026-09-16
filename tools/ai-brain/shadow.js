'use strict';

/**
 * Ship Dễ — Dependency Graph Shadow (TASK-AI-33)
 *
 * Projects the delivery register's dependency graph into a local shadow store
 * and compares the two. The register decides; the shadow observes. Nothing in
 * this file writes the register, and every pass proves that by hashing the
 * register's bytes before and after.
 *
 * The projection and comparison are not defined here. They live in
 * acceptance/lib/dependency-graph.js, which re-exports the reconciler's own
 * `parseDependencies`, so the CLI, its tests and the acceptance rows all run
 * one rule (AI-33-R02). A second copy here would be the defect this Work Item
 * exists to prevent.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const graph = require('./acceptance/lib/dependency-graph');

const DEFAULT_SHADOW_PATH = path.join('.ai-local', 'shadow', 'dependency-graph.json');

class ShadowError extends Error {}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Reads a file or refuses. An unreadable source is never an empty graph: an
 * empty graph agrees with an empty shadow, and that agreement would be a lie
 * (AI-33-R05).
 */
function readOrRefuse(filePath, label) {
  try {
    return fs.readFileSync(filePath);
  } catch (err) {
    throw new ShadowError(label + ' cannot be read: ' + filePath + ' (' + err.code + ')');
  }
}

function registerGraph(registerBytes, registerPath) {
  const rows = graph.registerRows(registerBytes.toString('utf8'));
  if (rows.length === 0) {
    throw new ShadowError('register has no rows: ' + registerPath);
  }
  return graph.graphFromRows(rows);
}

function readShadow(shadowPath) {
  const bytes = readOrRefuse(shadowPath, 'shadow store');
  try {
    return graph.fromShadowJson(bytes.toString('utf8'));
  } catch (err) {
    throw new ShadowError(
      'shadow store is not valid JSON: ' + shadowPath + ' (' + err.message + ')'
    );
  }
}

/**
 * Runs a pass and proves the register was not touched.
 *
 * The check is on bytes, not on the graph: a writer that rewrote the register
 * into an equivalent graph would still have taken authority it does not have.
 */
function withRegisterUnchanged(registerPath, fn) {
  const before = readOrRefuse(registerPath, 'register');
  const beforeHash = sha256(before);
  const result = fn(before);
  const afterHash = sha256(readOrRefuse(registerPath, 'register'));
  if (afterHash !== beforeHash) {
    throw new ShadowError('register bytes changed during a shadow pass; the shadow owns no state');
  }
  return { ...result, registerSha256: beforeHash };
}

/**
 * Canonical identity of a path for the alias check. Symlinks and junctions are
 * followed when the target exists; Windows and macOS compare case-insensitively.
 */
function canonical(filePath) {
  let resolved = path.resolve(filePath);
  try {
    resolved = fs.realpathSync.native(resolved);
  } catch {
    // Not there yet: the resolved path is the best identity available.
  }
  return process.platform === 'linux' ? resolved : resolved.toLowerCase();
}

/**
 * Refuses a shadow path that names the register. The after-hash in
 * withRegisterUnchanged would only detect the overwrite after the register was
 * already destroyed; this check runs before any write can happen.
 */
function refuseRegisterAlias(registerPath, shadowPath) {
  if (canonical(registerPath) === canonical(shadowPath)) {
    throw new ShadowError(
      'shadow path is the register itself: ' + shadowPath + '; the shadow owns no state'
    );
  }
}

/** Writes the projection. With `dryRun` nothing is written, only reported. */
function project({ registerPath, shadowPath, dryRun }) {
  refuseRegisterAlias(registerPath, shadowPath);
  return withRegisterUnchanged(registerPath, (bytes) => {
    const g = registerGraph(bytes, registerPath);
    const text = graph.toShadowJson(g);
    let existing = null;
    try {
      existing = fs.readFileSync(shadowPath, 'utf8');
    } catch {
      existing = null;
    }
    const unchanged = existing === text;
    if (!dryRun && !unchanged) {
      try {
        fs.mkdirSync(path.dirname(shadowPath), { recursive: true });
        fs.writeFileSync(shadowPath, text);
      } catch (err) {
        throw new ShadowError(
          'shadow store cannot be written: ' + shadowPath + ' (' + (err.code || err.message) + ')'
        );
      }
    }
    return {
      mode: 'project',
      nodes: g.nodes.length,
      edges: g.edges.length,
      shadowPath,
      written: !dryRun && !unchanged,
      unchanged,
    };
  });
}

/** Compares the register's graph with a shadow store. */
function compare({ registerPath, shadowPath }) {
  refuseRegisterAlias(registerPath, shadowPath);
  return withRegisterUnchanged(registerPath, (bytes) => {
    const expected = registerGraph(bytes, registerPath);
    const actual = readShadow(shadowPath);
    const divergences = graph.diffGraphs(expected, actual);
    return {
      mode: 'compare',
      nodes: expected.nodes.length,
      edges: expected.edges.length,
      shadowPath,
      divergences,
    };
  });
}

module.exports = {
  DEFAULT_SHADOW_PATH,
  ShadowError,
  project,
  compare,
  sha256,
  EDGE_TYPE: graph.EDGE_TYPE,
};
