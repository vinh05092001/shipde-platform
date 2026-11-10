'use strict';
const path = require('node:path');
const { deriveRiskDomains } = require('./intake');

const sec = (text, re) => (re.exec(text) || [])[1]?.trim() || '';

function parsePaths(text) {
  if (!text) return [];
  const paths = [];
  for (const part of text.split(/[,\n;]/)) {
    const trimmed = part.trim();
    const m =
      /`([^`]+)`/.exec(trimmed) ||
      /([a-zA-Z0-9_\-./\\]+\.[a-zA-Z0-9_-]+|[a-zA-Z0-9_\-./\\]+[\\/][a-zA-Z0-9_\-./\\]*)/.exec(
        trimmed
      );
    if (m) paths.push(m[1].trim());
  }
  return [...new Set(paths)];
}

function parseForbidden(text) {
  if (!text) return [];
  return [
    ...new Set(
      text
        .split(/[,\n;]/)
        .map((p) =>
          p
            .replace(/^[-*]\s*/, '')
            .replace(/[.`]/g, '')
            .trim()
        )
        .filter(Boolean)
    ),
  ];
}

function parseAcceptance(content) {
  const ac = [];
  const goalAc = sec(content, /^GOAL\s*\((?:AC)\)\s*:\s*(.+)$/im);
  if (goalAc) ac.push(goalAc);
  const verify = sec(content, /^VERIFY\s*:\s*(.+)$/im);
  if (verify) ac.push(verify);
  const re = /^Item\s+\S+\s*[:—–-]\s*(.+)$/gim;
  let m;
  while ((m = re.exec(content)) !== null) if (m[1]?.trim()) ac.push(m[1].trim());
  return [...new Set(ac)];
}

function parseRiskDomains(text) {
  if (!text) return [];
  const raw =
    sec(text, /^RISK(?:\s*DOMAINS?)?\s*:\s*(.+)$/im) ||
    sec(text, /^##\s+(?:Risk\s+Domains?|Risks?)\s*\n+([^#]+)/im);
  const explicit = raw
    ? raw
        .split(/[,;\n|]/)
        .map((s) =>
          s
            .replace(/^[-*]\s*/, '')
            .replace(/[`.]/g, '')
            .toLowerCase()
            .trim()
        )
        .filter(Boolean)
    : [];
  return [...new Set([...explicit, ...deriveRiskDomains(text)])];
}

function parseTicket(content, filePath = null) {
  const text = String(content || '');
  const heading = sec(text, /^#\s+(.+)$/m);
  const idMatch = /^([A-Za-z0-9_-]+)\s*[:—–-]\s*/.exec(heading);
  const id = idMatch
    ? idMatch[1].trim()
    : filePath && path.basename(filePath, path.extname(filePath)) !== 'task'
      ? path.basename(filePath, path.extname(filePath))
      : 'TASK-TICKET';
  const goal =
    sec(text, /^GOAL(?:\s*\(AC\))?\s*:\s*(.+)$/im) ||
    sec(text, /^##\s+(?:Business\s+Outcome|Outcome|Goal)\s*\n+([^#]+)/im) ||
    heading ||
    id;
  const allowed = parsePaths(
    sec(text, /^ALLOWED\s*(?:FILES|PATHS)\s*:\s*(.+)$/im) ||
      sec(text, /^##\s+(?:Allowed\s+(?:Files|Paths)|Files)\s*\n+([^#]+)/im)
  );
  const forbidden = parseForbidden(
    sec(text, /^FORBIDDEN(?:\s*FAILURE\s*DOMAINS)?\s*:\s*(.+)$/im) ||
      sec(text, /^##\s+(?:Prohibitions|Forbidden)\s*\n+([^#]+)/im)
  );
  const riskDomains = parseRiskDomains(text);
  const ac = parseAcceptance(text);
  const explicitComplexity = sec(text, /^COMPLEXITY\s*:\s*(.+)$/im);

  return {
    id,
    workItemId: id,
    title: heading || id,
    goal,
    acceptanceCriteria: ac,
    allowedFiles: allowed,
    files: allowed,
    forbiddenAreas: forbidden,
    forbiddenFailureDomains: forbidden,
    riskDomains,
    rawText: text,
    ticketText: text,
    ticketPath: filePath,
    ...(explicitComplexity ? { complexity: explicitComplexity.toLowerCase().trim() } : {}),
  };
}

module.exports = { parseTicket };
