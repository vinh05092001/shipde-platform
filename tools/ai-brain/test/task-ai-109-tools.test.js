'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const TOOL_MANIFEST_JSON = path.join(__dirname, '..', 'data', 'tool-manifest.json');
const TOOL_MANIFEST_JS = path.join(__dirname, '..', 'tool-manifest.js');

const REQUIRED_FIELDS = ['id', 'repo', 'purpose', 'roles', 'triggers', 'gate', 'command', 'installed', 'evidenceRef'];
const VALID_ROLES = ['author', 'reviewer', 'security-review', 'ui', 'analyst'];
const REPO_SCRIPTS = ['test', 'lint', 'typecheck', 'security:secrets'];

describe('TM-R01: tool-manifest.json schema', () => {
  test('tool-manifest.json exists', () => {
    const fs = require('node:fs');
    assert.ok(fs.existsSync(TOOL_MANIFEST_JSON), 'tool-manifest.json must exist');
  });

  test('tool-manifest.json is valid JSON', () => {
    const fs = require('node:fs');
    const content = fs.readFileSync(TOOL_MANIFEST_JSON, 'utf8');
    let parsed;
    assert.doesNotThrow(() => { parsed = JSON.parse(content); }, 'must be valid JSON');
    assert.ok(Array.isArray(parsed), 'must be an array');
  });

  test('every entry has all required fields (TM-R01)', () => {
    const fs = require('node:fs');
    const manifest = JSON.parse(fs.readFileSync(TOOL_MANIFEST_JSON, 'utf8'));
    assert.ok(manifest.length > 0, 'manifest must have at least one entry');
    manifest.forEach((entry, i) => {
      REQUIRED_FIELDS.forEach(field => {
        assert.ok(entry[field] !== undefined, `entry[${i}] missing required field: ${field}`);
      });
    });
  });

  test('every entry has valid roles array (TM-R01)', () => {
    const fs = require('node:fs');
    const manifest = JSON.parse(fs.readFileSync(TOOL_MANIFEST_JSON, 'utf8'));
    manifest.forEach((entry, i) => {
      assert.ok(Array.isArray(entry.roles), `entry[${i}].roles must be an array`);
      entry.roles.forEach(role => {
        assert.ok(VALID_ROLES.includes(role), `entry[${i}] has invalid role: ${role}`);
      });
    });
  });

  test('gate is boolean true for gate-required tools (TM-R01)', () => {
    const fs = require('node:fs');
    const manifest = JSON.parse(fs.readFileSync(TOOL_MANIFEST_JSON, 'utf8'));
    manifest.forEach((entry, i) => {
      assert.strictEqual(typeof entry.gate, 'boolean', `entry[${i}].gate must be boolean`);
    });
  });

  test('installed is boolean or UNKNOWN (TM-R01)', () => {
    const fs = require('node:fs');
    const manifest = JSON.parse(fs.readFileSync(TOOL_MANIFEST_JSON, 'utf8'));
    const validInstalled = [true, false, 'UNKNOWN'];
    manifest.forEach((entry, i) => {
      assert.ok(validInstalled.includes(entry.installed), `entry[${i}].installed must be true/false/UNKNOWN`);
    });
  });

  test('no entry claims installed:true without evidenceRef pointing to package.json or REPO-DECISIONS.md (TM-R01)', () => {
    const fs = require('node:fs');
    const manifest = JSON.parse(fs.readFileSync(TOOL_MANIFEST_JSON, 'utf8'));
    manifest.forEach((entry, i) => {
      if (entry.installed === true) {
        assert.ok(
          entry.evidenceRef && (entry.evidenceRef.includes('package.json') || entry.evidenceRef.includes('REPO-DECISIONS')),
          `entry[${i}] (${entry.id}) claims installed:true but lacks evidenceRef pointing to package.json or REPO-DECISIONS.md`
        );
      }
    });
  });
});

describe('TM-R02: tool-manifest.js exports', () => {
  test('tool-manifest.js exists', () => {
    const fs = require('node:fs');
    assert.ok(fs.existsSync(TOOL_MANIFEST_JS), 'tool-manifest.js must exist');
  });

  test('exports load() function', () => {
    const { load } = require(TOOL_MANIFEST_JS);
    assert.strictEqual(typeof load, 'function', 'load must be a function');
  });

  test('exports toolsFor() function', () => {
    const { toolsFor } = require(TOOL_MANIFEST_JS);
    assert.strictEqual(typeof toolsFor, 'function', 'toolsFor must be a function');
  });

  test('exports gatesFor() function', () => {
    const { gatesFor } = require(TOOL_MANIFEST_JS);
    assert.strictEqual(typeof gatesFor, 'function', 'gatesFor must be a function');
  });

  test('load() returns the manifest array', () => {
    const { load } = require(TOOL_MANIFEST_JS);
    const manifest = load();
    assert.ok(Array.isArray(manifest), 'load() must return an array');
    assert.ok(manifest.length > 0, 'load() must return non-empty array');
  });

  test('load() is pure (no I/O after first call)', () => {
    const { load } = require(TOOL_MANIFEST_JS);
    const first = load();
    const second = load();
    assert.deepStrictEqual(first, second, 'load() must be pure - same result every call');
  });
});

describe('TM-R03: toolsFor() routing logic', () => {
  test('UI change (.tsx file) includes playwright and axe-core', () => {
    const { toolsFor } = require(TOOL_MANIFEST_JS);
    const tools = toolsFor({ files: ['src/components/Button.tsx'] });
    const ids = tools.map(t => t.id);
    assert.ok(ids.includes('playwright'), 'UI change should include playwright');
    assert.ok(ids.includes('axe-core'), 'UI change should include axe-core');
  });

  test('secrets risk domain includes gitleaks', () => {
    const { toolsFor } = require(TOOL_MANIFEST_JS);
    const tools = toolsFor({ riskDomains: ['secrets'] });
    const ids = tools.map(t => t.id);
    assert.ok(ids.includes('gitleaks'), 'secrets risk should include gitleaks');
  });

  test('docs-only change returns no UI tools', () => {
    const { toolsFor } = require(TOOL_MANIFEST_JS);
    const tools = toolsFor({ files: ['docs/README.md', 'docs/api/spec.md'] });
    const uiTools = tools.filter(t => t.roles.includes('ui'));
    assert.strictEqual(uiTools.length, 0, 'docs-only change should have no UI tools');
  });

  test('toolsFor accepts role filter', () => {
    const { toolsFor } = require(TOOL_MANIFEST_JS);
    const securityTools = toolsFor({ role: 'security-review' });
    assert.ok(securityTools.length > 0, 'should have security-review tools');
    securityTools.forEach(t => {
      assert.ok(t.roles.includes('security-review'), 'all returned tools should have security-review role');
    });
  });
});

describe('TM-R03: gatesFor() returns gate tools', () => {
  test('gatesFor returns tools where gate === true', () => {
    const { gatesFor } = require(TOOL_MANIFEST_JS);
    const gates = gatesFor();
    gates.forEach(tool => {
      assert.strictEqual(tool.gate, true, `${tool.id} should have gate === true`);
    });
  });

  test('gatesFor includes repo test/lint/typecheck/security:secrets commands', () => {
    const { gatesFor } = require(TOOL_MANIFEST_JS);
    const gates = gatesFor();
    const commands = gates.map(t => t.command).filter(Boolean);
    REPO_SCRIPTS.forEach(script => {
      assert.ok(commands.some(c => c.includes(script)), `gates should include '${script}' command`);
    });
  });
});

describe('TM-R04: completeness', () => {
  test('manifest includes USE_AS_TOOL repos from REPO-DECISIONS.md', () => {
    const { load } = require(TOOL_MANIFEST_JS);
    const manifest = load();
    const repos = manifest.map(e => e.repo);

    const expectedRepos = [
      'anchore/syft',
      'anthropic-ai/claude-code',
      'aquasecurity/trivy',
      'ast-grep/ast-grep',
      'dequelabs/axe-core',
      'gitleaks/gitleaks',
      'microsoft/playwright',
      'snyk/agent-scan',
      'yamadashy/repomix',
    ];

    expectedRepos.forEach(repo => {
      assert.ok(repos.includes(repo), `manifest should include ${repo}`);
    });
  });

  test('tool-manifest.js does no I/O except reading JSON', () => {
    const fs = require('node:fs');
    const content = fs.readFileSync(TOOL_MANIFEST_JS, 'utf8');
    const disallowed = ['http://', 'https://', 'spawn(', 'exec(', 'execSync(', 'writeFile(', 'appendFile(', 'fetch(', 'axios(', 'node-fetch'];
    disallowed.forEach(pattern => {
      assert.ok(!content.includes(pattern), `tool-manifest.js should not contain '${pattern}' (forbidden I/O)`);
    });
  });
});
