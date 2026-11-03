#!/usr/bin/env node
'use strict';

/**
 * Ship Dễ — TASK-AI-170: Task Prompt & Template Renderer
 *
 * Renders author and review prompt templates based on Work Item specifications.
 * Enforces scope-tailored requirements:
 * - Only includes tenant/RBAC testing requirements when Work Item touches tenant/auth.
 * - Does not forbid .github/ when Work Item scope explicitly permits it.
 * - Injects structured review findings in WHERE/WRONG/GOAL/VERIFY format.
 *
 * Conforms to no-hardcode policy: zero hardcoded model/account names or magic caps.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const TEMPLATES_DIR = path.join(__dirname, 'templates');
const WORK_ITEMS_DIR = path.join(REPO_ROOT, 'docs', 'product-spec', 'work-items');

/**
 * Parses markdown table and headings from a Work Item document.
 */
export function extractWorkItemMeta(markdownText = '') {
  const meta = {
    workItemId: 'UNKNOWN',
    featureId: 'UNKNOWN',
    status: 'UNKNOWN',
    deliveryOrder: 'UNKNOWN',
    dependencies: 'UNKNOWN',
    assignedAuthor: 'UNKNOWN',
    risk: 'UNKNOWN',
    allowedPaths: 'UNKNOWN',
    reviewer: 'UNKNOWN',
    branch: 'UNKNOWN',
    pullRequest: 'UNKNOWN',
    businessOutcome: '',
    inScope: '',
    outOfScope: '',
    constitutionCheck: '',
    title: '',
  };

  const titleMatch = markdownText.match(/^#\s+([^\r\n]+)/m);
  if (titleMatch) {
    meta.title = titleMatch[1].trim();
    const idInTitle = meta.title.match(/\b(TASK-[A-Z0-9-]+|FEAT-[A-Z0-9-]+|GOAL-[A-Z0-9-]+)\b/);
    if (idInTitle) meta.workItemId = idInTitle[1];
  }

  // Parse control table rows: | Field | Value |
  const rowRegex = /\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/g;
  let match;
  while ((match = rowRegex.exec(markdownText)) !== null) {
    const rawKey = match[1].trim().toLowerCase();
    const rawVal = match[2].trim().replace(/^`|`$/g, '');
    if (rawKey === 'work item id') meta.workItemId = rawVal;
    else if (rawKey === 'feature id') meta.featureId = rawVal;
    else if (rawKey === 'status') meta.status = rawVal;
    else if (rawKey === 'delivery order') meta.deliveryOrder = rawVal;
    else if (rawKey === 'dependencies') meta.dependencies = rawVal;
    else if (rawKey === 'assigned author') meta.assignedAuthor = rawVal;
    else if (rawKey === 'risk') meta.risk = rawVal;
    else if (rawKey === 'allowed paths') meta.allowedPaths = rawVal;
    else if (rawKey === 'reviewer') meta.reviewer = rawVal;
    else if (rawKey === 'branch') meta.branch = rawVal;
    else if (rawKey === 'pull request') meta.pullRequest = rawVal;
  }

  // Parse major sections
  const section = (heading) => {
    const re = new RegExp(`##\\s+${heading}[\\r\\n]+([\\s\\S]*?)(?=(?:##\\s+|$))`, 'i');
    const m = markdownText.match(re);
    return m ? m[1].trim() : '';
  };

  meta.businessOutcome = section('Business outcome');
  meta.inScope = section('In scope');
  meta.outOfScope = section('Out of scope');
  meta.constitutionCheck = section('Constitution check');

  return meta;
}

/**
 * Evaluates tenant/auth and .github scope boundaries for a Work Item.
 */
export function evaluateWorkItemScope(meta = {}) {
  const allowed = meta.allowedPaths || '';
  const inScope = meta.inScope || '';
  const constitution = meta.constitutionCheck || '';
  const combined = [meta.title || '', meta.businessOutcome || '', inScope, allowed].join(' ');

  // 1. .github scope permission check
  const permitsGithub = /\.github/i.test(allowed) || /\.github/i.test(inScope);

  // 2. Tenant / RBAC scope check
  let touchesTenantAuth = false;
  const tenantMatch = constitution.match(/tenant\s+scope\s+and\s+rbac:\s*([^\r\n]+)/i);
  if (tenantMatch) {
    const note = tenantMatch[1].toLowerCase();
    if (
      note.includes('not applicable') ||
      note.includes('n/a') ||
      note.includes('no product routes') ||
      note.includes('test not applicable')
    ) {
      touchesTenantAuth = false;
    } else if (
      note.includes('enforced') ||
      note.includes('required') ||
      note.includes('tested') ||
      note.includes('negative test') ||
      note.includes('covered') ||
      note.includes('pass')
    ) {
      touchesTenantAuth = true;
    }
  } else {
    touchesTenantAuth = /\b(cross-tenant|multi-tenant|tenant-id|tenancy|rbac|user-role|auth-guard)\b/i.test(combined);
  }

  const githubScopeRule = permitsGithub
    ? 'Do not touch gate configs, allowlists, baselines, or semgrep rules.'
    : 'Do not touch gate configs, allowlists, baselines, semgrep rules or .github/.';

  const tenantRbacRequirement = touchesTenantAuth
    ? 'Each fix needs a negative test proving it (HTTP-level where the finding says so). Empty scopes must deny; audit metadata always masked; cross-tenant access must be denied.'
    : '';

  return {
    permitsGithub,
    touchesTenantAuth,
    githubScopeRule,
    tenantRbacRequirement,
  };
}

/**
 * Normalizes a single finding into WHERE/WRONG/GOAL/VERIFY format.
 */
export function formatFinding(f) {
  if (!f) return '';
  if (typeof f === 'string') {
    const trimmed = f.trim();
    if (!trimmed) return '';
    if (trimmed.includes('WHERE:') && trimmed.includes('WRONG:')) {
      return trimmed;
    }
    return `WHERE: UNKNOWN\nWRONG: ${trimmed}\nGOAL: Correct the issue\nVERIFY: Add negative test proving the fix`;
  }
  const where =
    f.where ||
    (f.file
      ? `${f.file}${f.line ? `:${f.line}` : ''}${f.function ? ` (${f.function})` : ''}`
      : 'UNKNOWN');
  const wrong = f.wrong || f.summary || f.description || 'UNKNOWN';
  const goal = f.goal || f.expected || 'UNKNOWN';
  const verify = f.verify || f.test || 'UNKNOWN';

  return `WHERE: ${where}\nWRONG: ${wrong}\nGOAL: ${goal}\nVERIFY: ${verify}`;
}

/**
 * Formats findings array or raw block into standardized WHERE/WRONG/GOAL/VERIFY entries.
 */
export function formatFindings(findings) {
  if (!findings) return '(No open findings)';
  if (Array.isArray(findings)) {
    if (findings.length === 0) return '(No open findings)';
    return findings.map(formatFinding).filter(Boolean).join('\n\n');
  }
  if (typeof findings === 'string') {
    const trimmed = findings.trim();
    return trimmed.length > 0 ? trimmed : '(No open findings)';
  }
  return formatFinding(findings);
}

/**
 * Replaces {{PLACEHOLDERS}} with provided key-value replacements.
 */
export function renderTemplate(templateText, replacements = {}) {
  let result = templateText;
  for (const [key, value] of Object.entries(replacements)) {
    const re = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    result = result.replace(re, value !== undefined && value !== null ? String(value) : 'UNKNOWN');
  }
  return result;
}

/**
 * Reads a Work Item file by ID or path.
 */
export function loadWorkItem(workItemRef) {
  if (!workItemRef) return '';
  if (fs.existsSync(workItemRef)) {
    return fs.readFileSync(workItemRef, 'utf8');
  }
  const resolvedPath = path.join(WORK_ITEMS_DIR, workItemRef.endsWith('.md') ? workItemRef : `${workItemRef}.md`);
  if (fs.existsSync(resolvedPath)) {
    return fs.readFileSync(resolvedPath, 'utf8');
  }
  return '';
}

/**
 * Reads a template by name or path.
 */
export function loadTemplate(templateName) {
  const fileName = templateName.endsWith('.md') ? templateName : `${templateName}.md`;
  const directPath = path.isAbsolute(templateName) ? templateName : path.join(TEMPLATES_DIR, fileName);
  if (fs.existsSync(directPath)) {
    return fs.readFileSync(directPath, 'utf8');
  }
  throw new Error(`Template not found: ${templateName} (searched at ${directPath})`);
}

/**
 * Renders a task prompt for the specified template and Work Item.
 */
export function renderTask(templateName, workItemRef, options = {}) {
  const templateContent = options.templateContent || loadTemplate(templateName);
  const workItemContent = options.workItemContent || loadWorkItem(workItemRef);
  const meta = extractWorkItemMeta(workItemContent);
  const scopeEval = evaluateWorkItemScope(meta);

  const findingsText = formatFindings(options.findings);

  const replacements = {
    WORK_ITEM: meta.workItemId !== 'UNKNOWN' ? meta.workItemId : workItemRef || 'UNKNOWN',
    PR: options.pr || meta.pullRequest || 'UNKNOWN',
    FILES: options.files || meta.allowedPaths || 'UNKNOWN',
    TEST_CMD: options.testCmd || 'pnpm test',
    FINDINGS: findingsText,
    TENANT_RBAC_REQUIREMENT: scopeEval.tenantRbacRequirement,
    GITHUB_SCOPE_RULE: scopeEval.githubScopeRule,
    AUTHOR: options.author || meta.assignedAuthor || 'UNKNOWN',
    FEATURE_ID: meta.featureId || 'N/A',
    BUSINESS_OUTCOME: meta.businessOutcome || 'UNKNOWN',
  };

  return renderTemplate(templateContent, replacements);
}

// CLI invocation handling
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    process.stderr.write('Usage: node render-task.mjs <template-name> <work-item-id> [--pr <PR>] [--test-cmd <cmd>]\n');
    process.exit(1);
  }
  const [templateName, workItemRef] = args;
  const rendered = renderTask(templateName, workItemRef);
  process.stdout.write(rendered + '\n');
}
