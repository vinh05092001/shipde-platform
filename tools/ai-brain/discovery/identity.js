'use strict';

/**
 * Ship Dễ — Model discovery: candidate identity (Work Item W2)
 *
 * A model catalogue is not a set of model names. The same model reached by two
 * different routes is two *candidates*, because each route carries its own
 * credential, its own account, its own quota and its own naming. A flat
 * catalogue that collapses them is how a chooser ends up believing a model is
 * available with the route that 403s while the route that answers is ignored.
 *
 * THE IDENTITY OF A CANDIDATE
 *
 *   harness + accessPath + gateway + upstream + account or quotaScope
 *   + the modelId exactly as that specific path names it
 *
 * Real example from this machine:
 *
 *   HTTP   -> 9Router  -> gh -> gh/gpt-4.1-2025-04-14        (answers)
 *   Paseo  -> OpenCode -> ninerouter -> gh/gpt-4.1             (fails 403)
 *
 * Different accessPath, different modelId string -> two candidates. Nothing in
 * this module ever merges two identities; a model that looks the same through
 * two paths is recorded per path, and the two routes only meet in the alias
 * and shared-quota records.
 *
 * A candidate key carries no credential, no secret and no environment value on
 * purpose: keys are written to snapshots and to the evidence store, and a key
 * that could leak a secret would make the whole store radioactive.
 */

const GATEWAY_PREFIX_SEPARATOR = '\u241f'; // U+241F SYMBOL FOR UNIT SEPARATOR

/**
 * A composite, stable, human-readable key for one candidate.
 *
 * Fields are joined with the unit separator. Model ids are arbitrary strings
 * chosen by the router, not by us, so a separator that cannot appear in an id
 * is preferred over punctuation an id might legitimately contain.
 */
function candidateKey(identity) {
  const i = identity || {};
  return [
    i.harness || '',
    i.accessPath || '',
    i.gateway || '',
    i.upstream || '',
    i.account || '',
    i.quotaScope || '',
    i.modelId || '',
  ].join(GATEWAY_PREFIX_SEPARATOR);
}

/**
 * Parse a candidate key back into its identity attributes.
 * Supports both 7-field format and legacy 6-field format (defaulting quotaScope to '').
 */
function parseCandidateKey(key) {
  if (typeof key !== 'string') return null;
  const parts = key.split(GATEWAY_PREFIX_SEPARATOR);
  if (parts.length === 7) {
    return {
      harness: parts[0],
      accessPath: parts[1],
      gateway: parts[2],
      upstream: parts[3],
      account: parts[4],
      quotaScope: parts[5],
      modelId: parts[6],
    };
  }
  if (parts.length === 6) {
    return {
      harness: parts[0],
      accessPath: parts[1],
      gateway: parts[2],
      upstream: parts[3],
      account: parts[4],
      quotaScope: '',
      modelId: parts[5],
    };
  }
  return null;
}

/**
 * The prefixes each path may carry in front of a model id.
 *
 * 9Router's models are named `ninerouter/gh/gpt-4.1` on the OpenCode path and
 * `gh/gpt-4.1-2025-04-14` on the HTTP path. The prefix is data: sources.json
 * declares `modelPrefix` on sources and in the dispatch table, and the router's
 * own catalogue starts its ids with the raw upstream name, so the only prefixes
 * that may be stripped are the ones the registry declares.
 */
function registryPrefixes(registry) {
  const seen = new Set();
  for (const source of (registry && registry.sources) || []) {
    if (source.modelPrefix) seen.add(String(source.modelPrefix));
  }
  const dispatch = ((registry && registry.dispatch) || {}).providers || {};
  for (const key of Object.keys(dispatch)) {
    const prefix = dispatch[key].modelPrefix;
    if (prefix) seen.add(String(prefix));
    if (key === 'oc' && dispatch[key].modelPrefix) seen.add(String(dispatch[key].modelPrefix));
  }
  // Longest first, so `ninerouter/ag` is tried before `ninerouter/`.
  return [...seen].sort((a, b) => b.length - a.length);
}

const DATE_SUFFIX = /-\d{4}-\d{2}-\d{2}$/;

/**
 * The base model name used for alias and shared-quota detection.
 *
 * This is deliberately NOT the identity. Identity keeps the raw modelId as the
 * path names it; base is a normalisation that exists only to ask "are these two
 * paths talking about the same model family?" Stripping registry-declared
 * routing prefixes and a trailing version-date turns `ninerouter/gh/gpt-4.1`
 * and `gh/gpt-4.1-2025-04-14` into the same base. A date suffix is stripped
 * eagerly because the dominant source of duplicate families here — 9Router's
 * HTTP path — appends the version date to ids its paseo path omits; what the
 * route really named is preserved in the candidate's raw modelId, so a dated
 * id is never lost, it is only candidate for matching against an undated twin.
 */
function modelBase(modelId, prefixes) {
  let name = String(modelId || '')
    .trim()
    .replace(/\r$/, '');
  for (const prefix of prefixes || []) {
    if (name.startsWith(prefix)) {
      name = name.slice(prefix.length);
      break;
    }
  }
  return name.replace(DATE_SUFFIX, '');
}

module.exports = {
  GATEWAY_PREFIX_SEPARATOR,
  candidateKey,
  parseCandidateKey,
  registryPrefixes,
  modelBase,
  DATE_SUFFIX,
};
