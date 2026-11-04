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
import {
  extractWorkItemMeta,
  evaluateWorkItemScope,
  formatFinding,
  formatFindings,
} from './render-task-scope.mjs';

export {
  extractWorkItemMeta,
  evaluateWorkItemScope,
  formatFinding,
  formatFindings,
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const TEMPLATES_DIR = path.join(__dirname, 'templates');
const WORK_ITEMS_DIR = path.join(REPO_ROOT, 'docs', 'product-spec', 'work-items');

/**
 * Replaces {{PLACEHOLDERS}} with provided key-value replacements.
 */
export function renderTemplate(templateText, replacements = {}) {
  let result = typeof templateText === 'string' ? templateText.replace(/\r\n/g, '\n') : '';
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
    return fs.readFileSync(workItemRef, 'utf8').replace(/\r\n/g, '\n');
  }
  const resolvedPath = path.join(WORK_ITEMS_DIR, workItemRef.endsWith('.md') ? workItemRef : `${workItemRef}.md`);
  if (fs.existsSync(resolvedPath)) {
    return fs.readFileSync(resolvedPath, 'utf8').replace(/\r\n/g, '\n');
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
    return fs.readFileSync(directPath, 'utf8').replace(/\r\n/g, '\n');
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

  let rendered = renderTemplate(templateContent, replacements);

  if (!scopeEval.touchesTenantAuth) {
    rendered = rendered.replace(/tenant scope,\s*RBAC\/empty-scope deny,\s*/gi, '');
  }

  return rendered;
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
