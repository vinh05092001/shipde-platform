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
  const primarySources = APPROVED_SOURCES.map((rel) => ({ path: rel, text: docs(rel) }));
  const approvedRefs = primarySources
    .filter(({ path: rel, text }) => sourceLine(text, id) || rel === CATALOG_REL)
    .map(({ path: rel }) => rel + (rel === CATALOG_REL && catalogLine ? ' — ' + id : ''));
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
  const blocking = !keyBehavior || !hasDetailedFeatureSource || !d.completeSources;
  const status = blocking ? 'BLOCKED' : 'READY_FOR_AUTHOR';
  const reason = blocking
    ? 'Approved sources do not provide enough feature-specific behavior and acceptance detail to write a complete Work Item without inventing product meaning.'
    : 'Draft is limited to the catalog outcome; feature-specific rules, contracts, screens and acceptance evidence require source verification.';
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
    '| Assigned author | `GEMINI` |',
    '| Risk | `UNASSESSED` |',
    '| Allowed paths | `To be determined from approved feature specifications` |',
    '| Reviewer | `Codex — fresh independent task` |',
    '| Branch | `feat/' + id.toLowerCase() + '-implementation` |',
    '| Pull Request | `Pending` |',
    '',
    '## Business outcome',
    '',
    keyBehavior ? '> ' + keyBehavior : '> Not specified in the approved sources.',
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
    '- `GEMINI` is assigned by default because the feature scope and risk have not been fully established.',
    '- Do not implement behavior beyond the cited approved sources.',
    '',
    '## In scope',
    '',
    '- The catalog outcome above, subject to approval of detailed requirements.',
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
    '- ' + reason,
    '',
    ...(blocking ? ['- Status remains `BLOCKED` until approved sources resolve this gap.'] : []),
    '',
  ].join('\n');

  if (d.writeFile) d.writeFile(target, text);
  else {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text, 'utf8');
  }
  return { id, target, status, blocking, reason, approvedRefs };
}

async function planWorkItem(id, options, deps) {
  const opts = options || {};
  const d = deps || {};
  if (!opts.run) return draftWorkItem(id, opts, d);
  if (typeof d.runPlanning !== 'function') {
    if (opts.allowDraftOnMissingExecutor) {
      return draftWorkItem(id, opts, d);
    }
    fail(
      'PLAN_EXECUTOR_REQUIRED',
      'plan --run requires the isolated planner, independent reviewer, and governed docs-only merge executor'
    );
  }
  return d.runPlanning({
    workItemId: id,
    role: 'planner.default',
    isolatedWorker: true,
    independentReviewer: true,
    docsOnly: true,
    governedMerge: true,
  });
}

module.exports = { draftWorkItem, planWorkItem, APPROVED_SOURCES, TEMPLATE_REL };
