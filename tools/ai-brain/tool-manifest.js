'use strict';

const path = require('node:path');

const MANIFEST_PATH = path.join(__dirname, 'data', 'tool-manifest.json');

let _cache = null;

function load() {
  if (_cache) return _cache;
  const fs = require('node:fs');
  const content = fs.readFileSync(MANIFEST_PATH, 'utf8');
  _cache = JSON.parse(content);
  return _cache;
}

function _isGlobPattern(pattern) {
  return pattern.includes('*');
}

function _isFileExtension(pattern) {
  return pattern.startsWith('.');
}

function _endsWithExtension(filePath, ext) {
  return filePath.endsWith(ext) || filePath.endsWith(ext.slice(1));
}

function _matchesFilePatterns(filePath, patterns) {
  if (!patterns || patterns.length === 0) return false;
  return patterns.some((pattern) => {
    if (pattern.startsWith('**/')) {
      const ext = pattern.slice(3);
      return _endsWithExtension(filePath, ext);
    }
    if (_isGlobPattern(pattern)) {
      const regex = new RegExp('^' + pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*') + '$');
      return regex.test(filePath);
    }
    if (_isFileExtension(pattern)) {
      return filePath.endsWith(pattern);
    }
    return false;
  });
}

function _matchesRiskDomain(riskDomain, triggers) {
  if (!triggers || triggers.length === 0) return false;
  return triggers.some((t) => t === riskDomain || t === riskDomain.toLowerCase());
}

function toolsFor({ role, files, riskDomains } = {}) {
  const manifest = load();
  return manifest.filter((tool) => {
    if (role) {
      const roleParts = role.split('.');
      const hasRole = roleParts.some((r) => tool.roles.includes(r));
      if (!hasRole) return false;
    }
    let matches = false;
    if (!files || files.length === 0) {
      if (!riskDomains || riskDomains.length === 0) {
        matches = true;
      } else {
        matches = riskDomains.some((r) => _matchesRiskDomain(r, tool.triggers));
      }
    } else {
      const fileMatches = files.some((f) => _matchesFilePatterns(f, tool.triggers));
      let riskMatches = false;
      if (riskDomains && riskDomains.length > 0) {
        riskMatches = riskDomains.some((r) => _matchesRiskDomain(r, tool.triggers));
      }
      matches = fileMatches || riskMatches;
    }
    if (!matches) return false;
    return true;
  });
}

function gatesFor() {
  const manifest = load();
  const gateTools = manifest.filter((t) => t.gate === true);
  const repoCommands = [
    {
      id: 'repo-test',
      repo: 'vinh05092001/shipde-platform',
      purpose: 'Run all tests',
      roles: ['author', 'reviewer'],
      triggers: [],
      gate: true,
      command: 'test',
      installed: true,
      evidenceRef: null,
    },
    {
      id: 'repo-lint',
      repo: 'vinh05092001/shipde-platform',
      purpose: 'Run linting',
      roles: ['author', 'reviewer'],
      triggers: [],
      gate: true,
      command: 'lint',
      installed: true,
      evidenceRef: null,
    },
    {
      id: 'repo-typecheck',
      repo: 'vinh05092001/shipde-platform',
      purpose: 'Run type checking',
      roles: ['author', 'reviewer'],
      triggers: [],
      gate: true,
      command: 'typecheck',
      installed: true,
      evidenceRef: null,
    },
    {
      id: 'repo-security-secrets',
      repo: 'vinh05092001/shipde-platform',
      purpose: 'Scan for secrets',
      roles: ['security-review'],
      triggers: [],
      gate: true,
      command: 'security:secrets',
      installed: true,
      evidenceRef: null,
    },
  ];
  return [...gateTools, ...repoCommands];
}

/**
 * Gate applicability (TM-R03): a gate covers a change when one of its
 * file-pattern triggers matches a changed file, or one of its risk-word
 * triggers matches a risk domain the Work Item declared. A tool with no
 * triggers at all covers nothing (e.g. the synthetic repo commands from
 * gatesFor() are never run as pre-review gates).
 */
function appliesTo(tool, files, riskDomains) {
  if (!tool || !Array.isArray(tool.triggers) || tool.triggers.length === 0) return false;
  const list = Array.isArray(files) ? files : [];
  if (list.some((f) => _matchesFilePatterns(f, tool.triggers))) return true;
  const domains = Array.isArray(riskDomains) ? riskDomains : [];
  return domains.some((r) => _matchesRiskDomain(r, tool.triggers));
}

module.exports = { load, toolsFor, gatesFor, appliesTo };
