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
      return section ? `${rel}#${section}` : null;
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

function validateDraftAgainstSources(draftText, id, rootDir, deps) {
  const d = deps || {};
  if (!draftText || typeof draftText !== 'string' || !draftText.trim()) {
    return { valid: false, reason: 'Worker draft is empty or missing.' };
  }

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
  const missing = requiredSections.filter((h) => !draftText.includes('## ' + h));
  if (missing.length > 0) {
    return {
      valid: false,
      reason: 'Worker draft is missing required sections: ' + missing.join(', '),
    };
  }

  const sourceSectionMatch = draftText.match(/## Source references\r?\n([\s\S]*?)(?=\r?\n## |$)/);
  if (!sourceSectionMatch) {
    return { valid: false, reason: 'Worker draft is missing Source references section.' };
  }
  const refLines = sourceSectionMatch[1]
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('- '));
  if (refLines.length === 0) {
    return { valid: false, reason: 'Worker draft has no source references.' };
  }

  const docReader = d.readSource || ((rel) => fs.readFileSync(path.join(rootDir, rel), 'utf8'));
  const specSources = listApprovedSpecSources(rootDir, d);
  const approvedNorm = APPROVED_SOURCES.map((p) => p.replace(/\\/g, '/'));
  const specNorm = specSources.map((p) => p.replace(/\\/g, '/'));
  const approvedDirsNorm = APPROVED_SPEC_DIRS.map((dir) => dir.replace(/\\/g, '/'));

  function resolveApprovedRef(refPath) {
    const portable = refPath.replace(/\\/g, '/');
    const segments = portable.split('/');
    if (segments.some((segment) => segment === '..' || segment === '.' || !segment)) return null;
    const normalized = path.posix.normalize(portable);
    if (
      normalized.startsWith('../') ||
      normalized === '..' ||
      normalized.startsWith('/') ||
      /^[a-z]:\//i.test(normalized)
    ) {
      return null;
    }
    const isApproved =
      approvedNorm.includes(normalized) ||
      specNorm.includes(normalized) ||
      approvedDirsNorm.some((dir) => normalized.startsWith(dir + '/'));
    return isApproved ? normalized : null;
  }

  const citedSources = [];
  for (const line of refLines) {
    const m = line.match(/`([^`]+)`/) || line.match(/^-\s+(.+)$/);
    if (!m) continue;
    const rawRef = m[1].trim();
    const refPath = rawRef.split('#')[0].trim().replace(/\\/g, '/');
    const approvedRef = resolveApprovedRef(refPath);
    if (!approvedRef) {
      return { valid: false, reason: 'Worker draft cites unapproved source: ' + rawRef };
    }
    try {
      citedSources.push(String(docReader(approvedRef)));
    } catch {
      try {
        citedSources.push(String(docReader(path.normalize(approvedRef))));
      } catch {
        return { valid: false, reason: 'Worker draft cites missing source file: ' + approvedRef };
      }
    }
  }

  const outcomeMatch = draftText.match(/## Business outcome\r?\n\r?\n> (.*)/);
  if (!outcomeMatch || !outcomeMatch[1].trim()) {
    return { valid: false, reason: 'Worker draft business outcome is missing.' };
  }
  const outcomeText = outcomeMatch[1].trim().replace(/^> /, '');
  if (outcomeText.includes('Not specified in the approved sources')) {
    return {
      valid: false,
      reason: 'Worker draft business outcome is not specified in approved sources.',
    };
  }

  const sourceBacked = citedSources.some((content) => content.includes(outcomeText));
  if (!sourceBacked) {
    return {
      valid: false,
      reason: 'Worker draft business outcome is not present in approved sources: ' + outcomeText,
    };
  }

  const standardStatements = new Set([
    'none',
    'none recorded',
    'dependency merge status and feature-specific prerequisites require verification before authoring.',
    'author and implementation boundary require assignment after source-backed scope and risk review.',
    'do not implement behavior beyond the cited approved sources.',
    'the catalog outcome above, subject to approval of detailed requirements.',
    'any behavior not explicitly established by approved source sections.',
    'no feature-specific rules were inferred. add only rules found in approved source sections.',
    'no screen behavior inferred; cite the applicable screen specification before authoring.',
    'no api, event, entity or persistence impact inferred; cite the applicable approved contracts.',
    'determine from the repository baseline and feature implementation scope.',
    'feature detail is incomplete pending the decisions below.',
  ]);
  const citedText = citedSources.join('\n').toLowerCase();
  const citedTokens = new Set(citedText.match(/[a-z0-9]+(?:['’-][a-z0-9]+)*/g) || []);
  let currentSection = '';
  for (const line of draftText.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) {
      currentSection = heading[1].trim().toLowerCase();
      continue;
    }
    if (
      !line.startsWith('- ') ||
      currentSection === 'source references' ||
      currentSection === 'open decisions'
    ) {
      continue;
    }
    const claim = line.slice(2).trim().replace(/[`*_]/g, '').toLowerCase();
    if (standardStatements.has(claim) || claim.startsWith('register dependencies:')) continue;
    const claimTokens = claim.match(/[a-z0-9]+(?:['’-][a-z0-9]+)*/g) || [];
    if (claimTokens.some((token) => !citedTokens.has(token))) {
      return {
        valid: false,
        reason:
          'Worker draft contains a statement not supported by its cited approved sources: ' +
          line.slice(2).trim(),
      };
    }
  }

  if (/\|\s*Status\s*\|\s*`BLOCKED`\s*\|/.test(draftText)) {
    return { valid: false, reason: 'Worker draft status is marked BLOCKED.' };
  }

  const openDecisionsMatch = draftText.match(/## Open decisions\r?\n([\s\S]*?)(?=\r?\n## |$)/);
  if (openDecisionsMatch) {
    const decLines = openDecisionsMatch[1]
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.startsWith('- '));
    const hasBlockingDecisions = decLines.some(
      (l) =>
        !l.startsWith('- None.') &&
        !l.startsWith('- Status remains a draft') &&
        !l.includes('No matching cited section found in approved source:')
    );
    if (hasBlockingDecisions) {
      return { valid: false, reason: 'Worker draft contains unresolved open decisions.' };
    }
  }

  return { valid: true };
}

async function planWorkItem(id, options, deps) {
  const opts = options || {};
  const d = deps || {};
  // Validate register membership and target availability before either drafting
  // locally or starting the external isolated planning pipeline.
  const rootDir = path.resolve(opts.rootDir || process.cwd());
  const hasRegisterSource =
    Array.isArray(d.items) || fs.existsSync(path.join(rootDir, REGISTER_REL));
  if (hasRegisterSource) {
    const item = getRegisterItem(rootDir, id, d);
    if (!item) fail('PLAN_NOT_IN_REGISTER', 'No register item found for ' + id);
  }
  const target = path.join(rootDir, 'docs', 'product-spec', 'work-items', id + '.md');
  const existingTarget = fs.existsSync(target);
  if (existingTarget && !opts.reviewExisting) {
    fail('PLAN_ALREADY_EXISTS', 'Work Item already exists: ' + target);
  }

  if (opts.run) {
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
  }

  const draftFn = typeof d.draftWorkItem === 'function' ? d.draftWorkItem : draftWorkItem;
  let draft;
  let draftCreated = false;
  try {
    if (existingTarget && opts.reviewExisting) {
      draft = {
        id,
        target,
        status: 'DRAFT',
        blocking: false,
        text: d.readFile ? d.readFile(target) : fs.readFileSync(target, 'utf8'),
        existing: true,
      };
    } else {
      draft = await draftFn(id, opts, d);
      draftCreated = true;
    }
  } catch (err) {
    throw err;
  }

  if (!opts.run) return draft;

  function cleanupUngovernedDraft() {
    if (draftCreated && fs.existsSync(target) && !d.writeFile) {
      try {
        fs.unlinkSync(target);
      } catch {}
    }
  }

  if (!draft || draft.status === 'BLOCKED' || draft.blocking) {
    cleanupUngovernedDraft();
    return {
      id,
      status: 'BLOCKED',
      reason: (draft && draft.reason) || 'Draft has open decisions or lacks source backing.',
      draft,
    };
  }

  const ranked = await d.rankPlanner({ workItemId: id, role: 'planner.default' });
  if (!ranked || ranked.eligible !== true) {
    cleanupUngovernedDraft();
    return {
      id,
      status: 'BLOCKED',
      reason: (ranked && ranked.reason) || 'No eligible planner candidate was ranked.',
      draft,
    };
  }

  const isolated = await d.runIsolatedPlanner({
    workItemId: id,
    role: 'planner.default',
    candidate: ranked,
    docsOnly: true,
    draft,
  });
  if (!isolated || isolated.success !== true) {
    cleanupUngovernedDraft();
    return {
      id,
      status: 'BLOCKED',
      reason: (isolated && isolated.reason) || 'The isolated planner did not complete.',
      draft,
    };
  }

  let workerDraftText = isolated && (isolated.draftText || isolated.content || isolated.text);
  if (!workerDraftText && d.readFile) workerDraftText = d.readFile(target);
  if (!workerDraftText && fs.existsSync(target)) workerDraftText = fs.readFileSync(target, 'utf8');
  if (!workerDraftText) workerDraftText = (draft && draft.text) || null;

  const validation = validateDraftAgainstSources(workerDraftText, id, rootDir, d);
  if (!validation.valid) {
    cleanupUngovernedDraft();
    return {
      id,
      status: 'BLOCKED',
      reason: validation.reason,
      draft,
      validation,
    };
  }

  const review = await d.reviewPlan({
    workItemId: id,
    candidate: ranked,
    plan: isolated,
    draft: workerDraftText,
  });
  if (!review || review.verdict !== 'PASS') {
    cleanupUngovernedDraft();
    return {
      id,
      status: 'BLOCKED',
      reason: (review && review.reason) || 'Independent planning review did not PASS.',
      independentReview: review && review.verdict,
      draft,
    };
  }

  const merged = await d.mergePlan({
    workItemId: id,
    candidate: ranked,
    plan: isolated,
    review,
    docsOnly: true,
    draft: workerDraftText,
  });
  if (!merged || merged.success === false || merged.merged !== true) {
    cleanupUngovernedDraft();
    return {
      id,
      status: 'BLOCKED',
      reason: (merged && merged.reason) || 'Governed docs-only merge did not complete.',
      draft,
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
    draft: workerDraftText,
  });
  if (
    !result ||
    result.status !== 'READY_FOR_AUTHOR' ||
    result.governed !== true ||
    result.independentReview !== 'PASS' ||
    result.merged !== true
  ) {
    cleanupUngovernedDraft();
    return {
      ...(result || {}),
      id,
      status: 'BLOCKED',
      reason:
        (result && result.reason) ||
        'Planning requires an exact independent PASS and completed governed docs-only merge.',
      draft,
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
        qualityFloor: 80,
        proofFloor: 'WORK_ITEM_PASS',
        contextSize: 0,
        costCeiling: 5000,
        currentWorkload: 0,
        resourceCeiling: 100,
        forbiddenFailureDomains: [],
        requiredCapabilities: [],
      };
      const result = (d.rankForProfile || routing.rankForProfile)(
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
    (async (context) => {
      if (
        context &&
        context.rankedPlanner &&
        context.rankedPlanner.eligible &&
        context.isolatedPlan &&
        context.isolatedPlan.success &&
        context.independentPlanReview &&
        context.independentPlanReview.verdict === 'PASS' &&
        context.governedPlanMerge &&
        context.governedPlanMerge.merged === true
      ) {
        return {
          status: 'READY_FOR_AUTHOR',
          governed: true,
          independentReview: 'PASS',
          merged: true,
        };
      }
      return {
        status: 'BLOCKED',
        reason:
          (context && context.independentPlanReview && context.independentPlanReview.reason) ||
          (context && context.governedPlanMerge && context.governedPlanMerge.reason) ||
          'Planning cannot become author-ready without independent review and governed merge.',
      };
    });
  return d;
}

module.exports = {
  draftWorkItem,
  planWorkItem,
  defaultPlanningDeps,
  validateDraftAgainstSources,
  APPROVED_SOURCES,
  APPROVED_SPEC_DIRS,
  TEMPLATE_REL,
};
