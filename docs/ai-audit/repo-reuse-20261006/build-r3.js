// Builds A-88-repo-requirements-r3.md from the inventory plus this audit's annotations. Read-only inputs.
const fs = require('fs');
const inv = require('./REPO-INVENTORY-CANONICAL-20261004.json');
const ws2 = new Set(['agentgateway/agentgateway','automazeio/ccpm','berriai/litellm','cline/cline','dicklesworthstone/ntm','e2b-dev/e2b','generalaction/emdash','langchain-ai/deepagents','langchain-ai/langgraph','langchain-ai/open-swe','microsoft/agent-framework','nvidia/openshell','openai/openai-agents-python','openhands/openhands','openhands/software-agent-sdk','raine/workmux','ruvnet/ruflo','smtg-ai/claude-squad','swe-agent/swe-rex','temporalio/sdk-typescript']);
const readToday = new Set(['nousresearch/hermes-agent','oraios/serena','untrivial-ai/agent-orchestrator','openhands/software-agent-sdk','gastownhall/beads','fission-ai/openspec','github/spec-kit','getnao/sylph','xiufengsun/tokentracker','vercel-labs/agent-skills','snyk/agent-scan','i-trytoohard/codex-startup-factory','bostonvex/claude-codex-orchestrator','vinh05092001/shipde-brain','deepseek-ai/deepseek-harness','microsoft/llmlingua']);
const installedLocal = new Set(['nousresearch/hermes-agent','decolua/9router','yamadashy/repomix','deepseek-ai/deepseek-harness','nodejs/node','pnpm/pnpm','prettier/prettier','cli/cli','git-for-windows/git','anthropic-ai/claude-code','openai/codex','google-gemini/gemini-cli','google/antigravity','docker/compose','gitleaks/gitleaks','evilmartians/lefthook','eslint/eslint','prisma/orm','vercel/turborepo']);
const runtime = new Set(['decolua/9router','nousresearch/hermes-agent','cli/cli','vinh05092001/shipde-platform']);
const req = {
  'nousresearch/hermes-agent': 'PLAN ORCH MEM CTX SKILL RECOVER RES ONBOARD',
  'untrivial-ai/agent-orchestrator': 'PLAN ORCH REVIEW',
  'i-trytoohard/codex-startup-factory': 'PLAN ORCH REVIEW (fork of ComposioHQ/agent-orchestrator)',
  'openhands/software-agent-sdk': 'ORCH MEM CTX SKILL REVIEW',
  'openhands/openhands': 'ORCH CTX',
  'microsoft/agent-framework': 'ORCH RECOVER',
  'openai/openai-agents-python': 'ORCH ROLE',
  'langchain-ai/open-swe': 'REVIEW',
  'langchain-ai/deepagents': 'ORCH',
  'langchain-ai/langgraph': 'RECOVER',
  'langchain-ai/langgraph-supervisor-py': 'ORCH',
  'gastownhall/beads': 'MEM PLAN',
  'fission-ai/openspec': 'PLAN ROLE',
  'github/spec-kit': 'PLAN ROLE',
  'getnao/sylph': 'MEM SKILL',
  'vercel-labs/agent-skills': 'SKILL UI',
  'snyk/agent-scan': 'SKILL (security scan of skills/MCP)',
  'bostonvex/claude-codex-orchestrator': 'ORCH',
  'vinh05092001/shipde-brain': 'MEM ROLE (lessons, prompts)',
  'deepseek-ai/deepseek-harness': 'ORCH (harness)',
  'microsoft/llmlingua': 'CTX',
  'oraios/serena': 'CTX',
  'yamadashy/repomix': 'CTX',
  'upstash/context7': 'CTX',
  'ast-grep/ast-grep': 'CTX REVIEW',
  'xiufengsun/tokentracker': 'CTX (token telemetry)',
  'decolua/9router': 'ONBOARD ORCH',
  'agentgateway/agentgateway': 'ONBOARD',
  'berriai/litellm': 'ONBOARD RECOVER',
  'promptfoo/promptfoo': 'QUAL',
  'swe-agent/swe-agent': 'REVIEW',
  'swe-agent/swe-rex': 'RECOVER ISO',
  'e2b-dev/e2b': 'RECOVER ISO',
  'temporalio/sdk-typescript': 'RECOVER',
  'raine/workmux': 'ISO ORCH',
  'generalaction/emdash': 'ISO ORCH',
  'ruvnet/ruflo': 'ORCH ISO',
  'cline/cline': 'RECOVER ORCH',
  'nvidia/openshell': 'ISO',
  'daytonaio/daytona': 'ISO',
  'dicklesworthstone/ntm': 'RES ORCH',
  'manaflow-ai/cmux': 'ORCH',
  'smtg-ai/claude-squad': 'ORCH',
  'automazeio/ccpm': 'PLAN ORCH',
  'taskforcesh/bullmq': 'ORCH (queue)',
  'semgrep/semgrep': 'REVIEW',
  'gitleaks/gitleaks': 'REVIEW',
  'aquasecurity/trivy': 'REVIEW',
  'anchore/syft': 'REVIEW',
  'open-policy-agent/opa': 'ROLE (policy)',
  'cli/cli': 'PUBLISH',
  'storybookjs/storybook': 'UI',
  'storybookjs/addon-a11y': 'UI',
  'dequelabs/axe-core': 'UI',
  'googlechrome/lighthouse-ci': 'UI',
  'microsoft/playwright': 'UI REVIEW',
  'microsoft/playwright-mcp': 'UI',
  'microsoft/playwright-cli': 'UI',
  'chromedevtools/chrome-devtools-mcp': 'UI',
  'open-telemetry/opentelemetry-js': 'RES (telemetry)',
  'vinh05092001/shipde-platform': 'all (this repo)',
};
const extra = [
  ['rtk-ai/rtk', 'df39e33d7e59', 'Apache-2.0', 'CTX', 'AUDIT_ONLY', 'README'],
  ['anthropics/skills', '683bc88e56f3', 'Apache-2.0 per skill; docx/pdf/pptx/xlsx source-available', 'SKILL UI ROLE', 'AUDIT_ONLY', 'per-skill LICENSE'],
  ['muratcankoylan/Agent-Skills-for-Context-Engineering', '58b55a892175', 'MIT', 'CTX MEM SKILL', 'AUDIT_ONLY', 'tree'],
  ['nextlevelbuilder/ui-ux-pro-max-skill', '477bcb28c981', 'MIT', 'UI SKILL', 'AUDIT_ONLY', 'skill.json, LICENSE'],
  ['ComposioHQ/agent-orchestrator (via fork)', 'not pinned', 'see fork (MIT)', 'PLAN ORCH REVIEW', 'MANUALLY_USED until 2026-09-17 (memory), not installed now', 'README of fork'],
];
function status(n, d) {
  if (runtime.has(n)) return 'RUNTIME_INTEGRATED';
  if (n === 'oraios/serena') return 'POC_ONLY';
  if (n === 'raine/workmux') return 'PATTERN_APPLIED';
  if (d === 'REJECT') return 'REJECTED';
  if (d === 'PILOT') return 'POC_ONLY';
  if (installedLocal.has(n)) return 'INSTALLED';
  return 'AUDIT_ONLY';
}
let out =
  '# A. 88 repos against operator requirements (r3, 2026-10-06, read-only)\n\n' +
  'Requirement keys: PLAN planner, ORCH orchestration/delegation, MEM shared memory/handoff, ROLE role/prompt, CTX context/token, SKILL skills, UI UI-by-spec, REVIEW code-test-review-repair, ONBOARD source onboarding, QUAL model qualification, RECOVER recovery, RES resource, PUBLISH publisher, ISO isolation. "-" = toolchain/app stack with no AI-workflow requirement.\n\n' +
  'Evidence level: WS2_FILE (file:symbol audited 2026-10-04), READ_TODAY (README/tree/code read 2026-10-06), INVENTORY (inventory metadata only).\n\n' +
  'Status: RUNTIME_INTEGRATED needs call site + config + execution evidence; INSTALLED = binary present on this machine (checked 2026-10-06); otherwise AUDIT_ONLY / POC_ONLY / PATTERN_APPLIED / REJECTED.\n\n' +
  '| repo | pinned | license | WS2 decision | status r3 | requirements | evidence level |\n|---|---|---|---|---|---|---|\n';
const counts = {};
const reqCount = {};
for (const r of inv) {
  const n = (r.owner + '/' + r.repo).toLowerCase();
  const st = status(n, r.currentDecision);
  counts[st] = (counts[st] || 0) + 1;
  const ev = ws2.has(n) ? 'WS2_FILE' : readToday.has(n) ? 'READ_TODAY' : 'INVENTORY';
  const rq = req[n] || '-';
  for (const k of rq.split(' ')) if (/^[A-Z]+$/.test(k)) reqCount[k] = (reqCount[k] || 0) + 1;
  out += `| ${r.owner}/${r.repo} | ${r.pinnedCommit || 'unpinned'} | ${r.license || 'none'} | ${r.currentDecision} | ${st} | ${rq} | ${ev} |\n`;
}
out += '\n## Candidates outside the inventory\n\n| repo | pinned | license | requirements | status | evidence |\n|---|---|---|---|---|---|\n';
for (const e of extra) out += '| ' + e.join(' | ') + ' |\n';
out +=
  '\n## Inventory corrections from the local check\n' +
  '- promptfoo: inventory ADOPTED; `promptfoo` is not on PATH.\n' +
  '- untrivial-ai/agent-orchestrator: inventory INSTALLED (node daemon); `ao` is not on PATH and upstream is now a Go desktop app. The AO used until 17/9 is most likely ComposioHQ/agent-orchestrator (`@aoagents/ao`), the base of i-trytoohard/codex-startup-factory.\n' +
  '- serena: no `serena` on PATH; the pilot ran through serena.js.\n' +
  '- hermes-agent: inventory PENDING, actually RUNTIME_INTEGRATED as a one-shot harness.\n';
fs.writeFileSync('A-88-repo-requirements-r3.md', out);
console.log(JSON.stringify(counts));
console.log(JSON.stringify(reqCount));
