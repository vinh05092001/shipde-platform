'use strict';

/** Source-bound Work Item drafting and governed planning execution (TASK-AI-141 G). */

const fs = require('fs');
const path = require('path');

const REGISTER_REL = path.join(
  'docs',
  'product-spec',
  'docs',
  '10-ai-collaboration',
  'FEATURE-DELIVERY-REGISTER.csv'
);
const TEMPLATE_REL = path.join(
  'docs',
  'product-spec',
  'docs',
  '10-ai-collaboration',
  'WORK-ITEM-TEMPLATE.md'
);
const CATALOG_REL = path.join(
  'docs',
  'product-spec',
  'docs',
  '01-product',
  'MASTER-FEATURE-CATALOG.md'
);
const APPROVED_SOURCES = [
  path.join('docs', 'product-spec', 'docs', '00-control', 'BASELINE-AND-DECISIONS.md'),
  path.join('docs', 'product-spec', 'docs', '01-product', 'PRODUCT-VISION-SCOPE.md'),
  CATALOG_REL,
];
const APPROVED_SPEC_DIRS = [
  path.join('docs', 'product-spec', 'docs', '02-business'),
  path.join('docs', 'product-spec', 'docs', '02-business', 'state-machines'),
  path.join('docs', 'product-spec', 'docs', '03-ux'),
  path.join('docs', 'product-spec', 'docs', '04-data'),
  path.join('docs', 'product-spec', 'docs', '05-api-integrations'),
  path.join('docs', 'product-spec', 'docs', '08-testing'),
  path.join('docs', 'product-spec', 'docs', '08-testing', 'acceptance'),
];

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function sourceLine(text, id) {
  return (
    String(text)
      .split(/\r?\n/)
      .find((line) => line.includes(id)) || null
  );
}

function sourceSection(text, id, terms) {
  const lines = String(text).split(/\r?\n/);
  const needles = [id, ...(terms || [])]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());
  const index = lines.findIndex((line) =>
    needles.some((needle) => line.toLowerCase().includes(needle))
  );
  if (index < 0) return null;
  for (let i = index; i >= 0; i -= 1) {
    const heading = lines[i].match(/^#{1,6}\s+(.+?)\s*#*$/);
    if (heading) return heading[1];
  }
  return `line ${index + 1}`;
}

function getRegisterItem(rootDir, id, deps) {
  const rows =
    deps && Array.isArray(deps.items)
      ? deps.items
      : require('../ai-dashboard/register-adapter').parseRegisterCsv(
          fs.readFileSync(path.join(rootDir, REGISTER_REL), 'utf8'),
          rootDir
        );
  return rows.find((row) => row.work_item_id === id) || null;
}

function listApprovedSpecSources(rootDir, deps) {
  if (deps && Array.isArray(deps.approvedSpecSources)) return deps.approvedSpecSources;
  const found = [];
  for (const relDir of APPROVED_SPEC_DIRS) {
    const absoluteDir = path.join(rootDir, relDir);
    if (!fs.existsSync(absoluteDir)) continue;
    for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        found.push(path.join(relDir, entry.name));
      }
    }
  }
  return found.sort();
}

function draftWorkItem(id, options, deps) {
  const opts = options || {};
  const d = deps || {};
  const rootDir = path.resolve(opts.rootDir || process.cwd());
  if (!/^(FEAT|TASK)-(?:[A-Z]+-)?[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(id || '')) {
    fail('PLAN_INVALID_ID', 'plan requires a valid --work-item ID');
  }
  const item = getRegisterItem(rootDir, id, d);
  if (!item) fail('PLAN_NOT_IN_REGISTER', 'No register item found for ' + id);
  const target = path.join(rootDir, 'docs', 'product-spec', 'work-items', id + '.md');
  if (fs.existsSync(target)) fail('PLAN_ALREADY_EXISTS', 'Work Item already exists: ' + target);

  const docs = d.readSource || ((rel) => fs.readFileSync(path.join(rootDir, rel), 'utf8'));
  const template = docs(TEMPLATE_REL);
  const catalog = docs(CATALOG_REL);
  const catalogLine = sourceLine(catalog, id);
  const specSources = listApprovedSpecSources(rootDir, d);
  const primarySources = [...new Set([...APPROVED_SOURCES, ...specSources])].map((rel) => ({
    path: rel,
    text: docs(rel),
  }));
  const terms = [item.feature_name, item.feature_id, item.key_behavior].filter(Boolean);
  const approvedRefs = primarySources
    .map(({ path: rel, text }) => {
      const section = sourceSection(text, id, terms);
      return section ? `\`${rel}#${section}\`` : null;
    })
    .filter(Boolean);
  const requiredSections = [
    'Business outcome',
    'Source references',
    'Preconditions and dependencies',
    'Author boundary',
    'In scope',
    'Out of scope',
    'Business rules and edge cases',
    'UI states',
    'API, event and data impact',
    'Acceptance matrix',
    'Verification commands',
    'Codex review record',
    'Residual limitations',
  ];
  const missingTemplateSections = requiredSections.filter(
    (heading) => !template.includes('## ' + heading)
  );
  if (missingTemplateSections.length) {
    fail(
      'PLAN_TEMPLATE_INVALID',
      'Work Item template is missing: ' + missingTemplateSections.join(', ')
    );
  }

  const keyBehavior = String(item.key_behavior || '').trim();
  const featureName = String(item.feature_name || item.feature_id || id).trim();
  const hasDetailedFeatureSource = Boolean(catalogLine && catalogLine.includes('|'));
  // A local draft is never an approval gate. Only a separately reviewed and
  // governed docs-only merge may make the register item author-ready.
  const openDecisions = [];
  const sourceBackedOutcome = primarySources.some(({ text }) =>
    String(text)
      .split(/\r?\n/)
      .some((line) => line.includes(keyBehavior) && keyBehavior.length > 0)
  );
  if (!keyBehavior || !hasDetailedFeatureSource || !sourceBackedOutcome) {
    openDecisions.push(
      !sourceBackedOutcome && keyBehavior
        ? 'The register business outcome is not present in approved sources and cannot be stated as product meaning.'
        : 'Approved sources do not provide enough feature-specific behavior and acceptance detail to write a complete Work Item without inventing product meaning.'
    );
  }
  if (!approvedRefs.length) {
    openDecisions.push('No matching feature-specific section was found in the approved sources.');
  }
  const status = openDecisions.length ? 'BLOCKED' : 'DRAFT';
  const reason = openDecisions.join(' ');
  const text = [
    '# ' + id + ' — ' + featureName,
    '',
    '## Control',
    '',
    '| Field | Value |',
    '| --- | --- |',
    '| Work Item ID | `' + id + '` |',
    '| Feature ID | `' + (item.feature_id || 'N/A') + '` |',
    '| Status | `' + status + '` |',
    '| Delivery order | `' + (item.delivery_order || '') + '` |',
    '| Dependencies | `' + (item.dependencies || 'None') + '` |',
    '| Assigned author | `Pending planner and author routing` |',
    '| Risk | `Pending source-backed assessment` |',
    '| Allowed paths | `To be determined from approved feature specifications` |',
    '| Reviewer | `Codex — fresh independent task` |',
    '| Branch | `Pending author assignment` |',
    '| Pull Request | `Pending` |',
    '',
    '## Business outcome',
    '',
    sourceBackedOutcome ? '> ' + keyBehavior : '> Not specified in the approved sources.',
    '',
    '## Source references',
    '',
    ...approvedRefs.map((ref) => '- `' + ref + '`'),
    '',
    '## Preconditions and dependencies',
    '',
    '- Register dependencies: ' + (item.dependencies || 'none recorded') + '.',
    '- Dependency merge status and feature-specific prerequisites require verification before authoring.',
    '',
    '## Author boundary',
    '',
    '- Author and implementation boundary require assignment after source-backed scope and risk review.',
    '- Do not implement behavior beyond the cited approved sources.',
    '',
    '## In scope',
    '',
    sourceBackedOutcome
      ? '- The catalog outcome above, subject to approval of detailed requirements.'
      : '- No feature-specific product behavior is stated because approved sources do not establish it.',
    '',
    '## Out of scope',
    '',
    '- Any behavior not explicitly established by approved source sections.',
    '',
    '## Business rules and edge cases',
    '',
    '- No feature-specific rules were inferred. Add only rules found in approved source sections.',
    '',
    '## UI states',
    '',
    '- No screen behavior inferred; cite the applicable screen specification before authoring.',
    '',
    '## API, event and data impact',
    '',
    '- No API, event, entity or persistence impact inferred; cite the applicable approved contracts.',
    '',
    '## Acceptance matrix',
    '',
    '| AC/Test ID | Scenario | Expected result | Evidence required |',
    '| --- | --- | --- | --- |',
    '| TBD | Add approved acceptance criteria before authoring | TBD | Source-backed test evidence |',
    '',
    '## Verification commands',
    '',
    '- Determine from the repository baseline and feature implementation scope.',
    '',
    '## Codex review record',
    '',
    '| Review round | Commit | Verdict | Findings resolved |',
    '| --- | --- | --- | --- |',
    '| 1 | `Pending` | `Pending` | `Pending` |',
    '',
    '## Residual limitations',
    '',
    '- Feature detail is incomplete pending the decisions below.',
    '',
    '## Open decisions',
    '',
    ...(openDecisions.length ? openDecisions.map((decision) => '- ' + decision) : ['- None.']),
    ...APPROVED_SOURCES.filter((rel) => !approvedRefs.some((ref) => ref.includes(rel))).map(
      (rel) => `- No matching cited section found in approved source: \`${rel}\`.`
    ),
    '',
    '- Status remains a draft until the independent planning and governed merge gates complete.',
    '',
  ].join('\n');

  if (d.writeFile) d.writeFile(target, text);
  else {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text, 'utf8');
  }
  return { id, target, status, blocking: openDecisions.length > 0, reason, approvedRefs };
}

async function planWorkItem(id, options, deps) {
  const opts = options || {};
  const d = deps || {};
  if (!opts.run) return draftWorkItem(id, opts, d);
  if (typeof d.runPlanning !== 'function') {
    fail(
      'PLAN_EXECUTOR_REQUIRED',
      'plan --run requires the isolated planner, independent reviewer, and governed docs-only merge executor'
    );
  }
  if (
    typeof d.rankPlanner !== 'function' ||
    typeof d.runIsolatedPlanner !== 'function' ||
    typeof d.reviewPlan !== 'function' ||
    typeof d.mergePlan !== 'function'
  ) {
    fail(
      'PLAN_EXECUTOR_INCOMPLETE',
      'plan --run requires planner ranking, isolated execution, independent review, and governed merge services'
    );
  }
  const ranked = await d.rankPlanner({ workItemId: id, role: 'planner.default' });
  if (!ranked || ranked.eligible === false) {
    return {
      id,
      status: 'BLOCKED',
      reason: (ranked && ranked.reason) || 'No eligible planner candidate was ranked.',
    };
  }
  const isolated = await d.runIsolatedPlanner({
    workItemId: id,
    role: 'planner.default',
    candidate: ranked,
    docsOnly: true,
  });
  if (!isolated || isolated.success === false) {
    return {
      id,
      status: 'BLOCKED',
      reason: (isolated && isolated.reason) || 'The isolated planner did not complete.',
    };
  }
  const review = await d.reviewPlan({ workItemId: id, candidate: ranked, plan: isolated });
  if (!review || review.verdict !== 'PASS') {
    return {
      id,
      status: 'BLOCKED',
      reason: (review && review.reason) || 'Independent planning review did not PASS.',
      independentReview: review && review.verdict,
    };
  }
  const merged = await d.mergePlan({
    workItemId: id,
    candidate: ranked,
    plan: isolated,
    review,
    docsOnly: true,
  });
  if (!merged || merged.success === false || merged.merged !== true) {
    return {
      id,
      status: 'BLOCKED',
      reason: (merged && merged.reason) || 'Governed docs-only merge did not complete.',
    };
  }
  const result = await d.runPlanning({
    workItemId: id,
    role: 'planner.default',
    isolatedWorker: true,
    independentReviewer: true,
    docsOnly: true,
    governedMerge: true,
    rankedPlanner: ranked,
    isolatedPlan: isolated,
    independentPlanReview: review,
    governedPlanMerge: merged,
  });
  if (
    !result ||
    result.status !== 'READY_FOR_AUTHOR' ||
    result.governed !== true ||
    result.independentReview !== 'PASS' ||
    result.merged !== true
  ) {
    return {
      ...(result || {}),
      id,
      status: 'BLOCKED',
      reason:
        (result && result.reason) ||
        'Planning requires an exact independent PASS and completed governed docs-only merge.',
    };
  }
  return result;
}

function defaultPlanningDeps(rootDir, overrides) {
  const d = Object.assign({}, overrides || {});
  const root = path.resolve(rootDir || process.cwd());
  if (!d.rankPlanner) {
    d.rankPlanner = async ({ workItemId, role }) => {
      const sources = require('./sources');
      const evidence = require('./evidence');
      const candidatesApi = require('./candidates');
      const routing = require('./routing');
      const { readDiscoveryCatalogue } = require('./discovery/read');
      const registry = sources.loadSources();
      const accounts = require('./accounts').listAccounts() || [];
      let discovery = { candidates: [] };
      try {
        discovery = readDiscoveryCatalogue({ dataDir: path.join(__dirname, 'data', 'discovery') });
      } catch {}
      const evidenceData = evidence.loadEvidence(path.join(__dirname, 'data', 'evidence'));
      const candidates = require('./cli').assembleForDispatch(discovery, accounts, registry, {
        evidenceData,
      });
      const annotated = candidatesApi.annotateCandidates(candidates, evidenceData, {
        now: Date.now(),
      });
      const profile = {
        taskId: workItemId,
        role,
        complexity: 'complex',
        riskDomains: ['documentation'],
        qualityFloor: 0,
        proofFloor: 'NONE',
        contextSize: 0,
        costCeiling: Number.MAX_SAFE_INTEGER,
        currentWorkload: 0,
        resourceCeiling: 100,
        forbiddenFailureDomains: [],
        requiredCapabilities: [],
      };
      const result = routing.rankForProfile(
        annotated,
        profile,
        { weightProfile: 'QUALITY_FIRST' },
        {
          now: Date.now(),
          evidenceData,
          accounts,
          useStoredQuota: true,
        }
      );
      const chosen = result.ranking.find((candidate) => candidate.candidateKey === result.chosen);
      return chosen
        ? Object.assign({ eligible: true }, chosen)
        : {
            eligible: false,
            reason: result.reason || 'No eligible planner candidate was ranked.',
          };
    };
  }
  if (!d.runIsolatedPlanner) {
    d.runIsolatedPlanner = async ({ workItemId, candidate }) => {
      if (typeof d.launchPlanner !== 'function') {
        return { success: false, reason: 'No isolated planner launcher is configured.' };
      }
      return d.launchPlanner({
        rootDir: root,
        workItemId,
        candidate,
        role: 'planner.default',
        docsOnly: true,
        isolationLauncher: require('./isolation-launcher').getIsolatedLauncher(),
      });
    };
  }
  d.reviewPlan =
    d.reviewPlan ||
    (async () => ({
      verdict: 'BLOCKED',
      reason: 'Independent planner review service is not configured.',
    }));
  d.mergePlan =
    d.mergePlan ||
    (async () => ({
      merged: false,
      reason: 'Governed docs-only merge service is not configured.',
    }));
  d.runPlanning =
    d.runPlanning ||
    (async () => ({
      status: 'BLOCKED',
      reason: 'Planning cannot become author-ready without independent review and governed merge.',
    }));
  return d;
}

module.exports = {
  draftWorkItem,
  planWorkItem,
  defaultPlanningDeps,
  APPROVED_SOURCES,
  APPROVED_SPEC_DIRS,
  TEMPLATE_REL,
};
