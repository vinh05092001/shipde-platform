#!/usr/bin/env node
'use strict';

/**
 * Ship Dễ — TASK-AI-170: Work Item Scope & Findings Parser
 *
 * Parses Work Item metadata, evaluates tenant/auth and .github scope rules,
 * and formats structured review findings (WHERE/WRONG/GOAL/VERIFY).
 */

/**
 * Parses markdown table and headings from a Work Item document.
 */
export function extractWorkItemMeta(markdownText = '') {
  if (typeof markdownText === 'string') {
    markdownText = markdownText.replace(/\r\n/g, '\n');
  }

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
  // Normalize negation: strip whitespace following '!' (e.g. '! .github/**' -> '!.github/**')
  const allowed = String(meta.allowedPaths || '').replace(/!\s+/g, '!');
  const inScope = String(meta.inScope || '').replace(/!\s+/g, '!');
  const constitution = meta.constitutionCheck || '';
  const combined = [meta.title || '', meta.businessOutcome || '', inScope, allowed].join(' ');

  // 1. .github scope permission check
  // Must be non-negated in allowedPaths or inScope
  const allowedTokens = allowed
    .split(/[\s,]+/)
    .map((s) => s.trim().replace(/^[`'"]+|[`'"]+$/g, ''))
    .filter(Boolean);

  const hasAllowedGithub = allowedTokens.some(
    (token) =>
      /\.github/i.test(token) &&
      !token.startsWith('!') &&
      !/!\s*[`'"]*\.github/i.test(token)
  );
  const hasInScopeGithub =
    /\.github/i.test(inScope) &&
    !/\b(?:no|not|never|excluding|exclude|except|without|do\s+not(?:\s+touch)?)\b[^.\n;]*\.github/i.test(inScope) &&
    !/(?:^|[\s,`'"])!\s*[`'"]*[^,\n;]*\.github/i.test(inScope);
  const permitsGithub = Boolean(hasAllowedGithub || hasInScopeGithub);

  // 2. Tenant / RBAC scope check
  let touchesTenantAuth = false;
  const tenantMatch =
    constitution.match(/tenant\s+scope(?:\s+and\s+rbac)?:\s*([^\r\n]+)/i) ||
    constitution.match(/\*\*tenant\s+scope\*\*:\s*([^\r\n]+)/i);

  if (tenantMatch) {
    const rawNote = tenantMatch[1].trim();
    const note = rawNote.toLowerCase();
    if (
      note.includes('not applicable') ||
      note.includes('n/a') ||
      note.includes('no product routes') ||
      note.includes('test not applicable') ||
      note.includes('no tenant logic')
    ) {
      touchesTenantAuth = false;
    } else if (
      note.includes('enforced') ||
      note.includes('required') ||
      note.includes('tested') ||
      note.includes('negative test') ||
      note.includes('covered') ||
      note.includes('preserved') ||
      /\bPASS\b/.test(rawNote) // Only uppercase PASS denotes check verdict; lowercase 'pass' must not falsely match
    ) {
      touchesTenantAuth = true;
    } else {
      touchesTenantAuth = /\b(cross-tenant|multi-tenant|tenant-id|tenancy|rbac|user-role|auth-guard|authentication|authorization)\b/i.test(combined);
    }
  } else {
    // Only detect tenant/auth from specific domain keywords (do not match common words like 'author')
    touchesTenantAuth = /\b(cross-tenant|multi-tenant|tenant-id|tenancy|rbac|user-role|auth-guard|authentication|authorization)\b/i.test(combined);
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
    f = f.replace(/\r\n/g, '\n');
    const trimmed = f.trim();
    if (!trimmed) return '';

    const hasWhere = /(?:^|\n)WHERE:\s*/i.test(trimmed);
    const hasWrong = /(?:^|\n)WRONG:\s*/i.test(trimmed);
    const hasGoal = /(?:^|\n)GOAL:\s*/i.test(trimmed);
    const hasVerify = /(?:^|\n)VERIFY:\s*/i.test(trimmed);

    if (hasWhere || hasWrong || hasGoal || hasVerify) {
      const lines = trimmed.split('\n');
      const fields = { WHERE: '', WRONG: '', GOAL: '', VERIFY: '' };
      let currentField = null;

      for (const line of lines) {
        const headerMatch = line.match(/^(WHERE|WRONG|GOAL|VERIFY):\s*(.*)$/i);
        if (headerMatch) {
          currentField = headerMatch[1].toUpperCase();
          fields[currentField] = headerMatch[2] ? headerMatch[2].trim() : '';
        } else if (currentField) {
          if (fields[currentField].length > 0) {
            fields[currentField] += '\n' + line;
          } else {
            fields[currentField] = line.trim();
          }
        }
      }

      const where = fields.WHERE ? fields.WHERE.trim() : 'UNKNOWN';
      const wrong = fields.WRONG ? fields.WRONG.trim() : 'UNKNOWN';
      const goal = fields.GOAL ? fields.GOAL.trim() : 'UNKNOWN';
      const verify = fields.VERIFY ? fields.VERIFY.trim() : 'UNKNOWN';

      return `WHERE: ${where || 'UNKNOWN'}\nWRONG: ${wrong || 'UNKNOWN'}\nGOAL: ${goal || 'UNKNOWN'}\nVERIFY: ${verify || 'UNKNOWN'}`;
    }

    return `WHERE: UNKNOWN\nWRONG: ${trimmed}\nGOAL: UNKNOWN\nVERIFY: UNKNOWN`;
  }
  const normStr = (val) => (typeof val === 'string' ? val.replace(/\r\n/g, '\n').trim() : '');
  const where =
    normStr(f.where) ||
    (f.file
      ? `${f.file}${f.line ? `:${f.line}` : ''}${f.function ? ` (${f.function})` : ''}`
      : 'UNKNOWN');
  const wrong = normStr(f.wrong) || normStr(f.summary) || normStr(f.description) || 'UNKNOWN';
  const goal = normStr(f.goal) || normStr(f.expected) || 'UNKNOWN';
  const verify = normStr(f.verify) || normStr(f.test) || 'UNKNOWN';

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
    findings = findings.replace(/\r\n/g, '\n');
    const trimmed = findings.trim();
    if (!trimmed) return '(No open findings)';
    if (trimmed.includes('\n\n')) {
      const blocks = trimmed.split(/\n\s*\n/);
      return blocks.map(formatFinding).filter(Boolean).join('\n\n');
    }
    return formatFinding(trimmed);
  }
  return formatFinding(findings);
}
