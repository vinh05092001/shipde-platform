// Per-repo decision table (supervisor analysis, read-only inputs). One decision per repo:
// KEEP_RUNTIME (already running for the AI workflow), USE (adopt/integrate into the brain),
// USE_AS_TOOL (app/dev toolchain, not brain), PATTERN_ONLY (copy an idea, no code/dependency),
// REPLACED_BY:<x> (covered by another chosen repo), DROP (no need / conflict / license / platform).
const fs = require('fs');
const inv = require('./REPO-INVENTORY-CANONICAL-20261004.json');
const D = {
  // running today
  'decolua/9router': ['KEEP_RUNTIME', 'gateway for most sources; call site sources.js/isolation-launcher'],
  'nousresearch/hermes-agent': ['KEEP_RUNTIME', 'one-shot harness (harness.js); kanban/delegate stay candidates for planner later'],
  'cli/cli': ['KEEP_RUNTIME', 'publisher gh calls'],
  'vinh05092001/shipde-platform': ['KEEP_RUNTIME', 'this repo'],
  'untrivial-ai/agent-orchestrator': ['REPLACED_BY:obra/superpowers + ShipDe Controller', 'AO broke 18/9, heavy daemon, own model choice'],
  'i-trytoohard/codex-startup-factory': ['REPLACED_BY:obra/superpowers', 'AO fork; workflow covered by superpowers skills'],
  'bostonvex/claude-codex-orchestrator': ['REPLACED_BY:obra/superpowers', 'issue-driven loop covered by superpowers + ShipDe loop'],
  'automazeio/ccpm': ['REPLACED_BY:obra/superpowers', 'PM workflow via commands; superpowers covers plan/execute/review'],
  'fission-ai/openspec': ['REPLACED_BY:obra/superpowers', 'planner; ShipDe already has specs/Work Items; revisit only if superpowers planning fails measurement'],
  'github/spec-kit': ['REPLACED_BY:obra/superpowers', 'same as openspec'],
  'langchain-ai/deepagents': ['PATTERN_ONLY', 'planner/subagent pattern; Python LLM-graph, not CLI workers'],
  'langchain-ai/langgraph-supervisor-py': ['PATTERN_ONLY', 'supervisor/handoff pattern'],
  'langchain-ai/langgraph': ['PATTERN_ONLY', 'retry classifier default_retry_on: cross-check failure-classifier.js'],
  'temporalio/sdk-typescript': ['PATTERN_ONLY', 'RetryPolicy spec: cross-check failure-classifier.js cooldowns'],
  'e2b-dev/e2b': ['PATTERN_ONLY', 'withRetry REPLAYABLE_OPERATIONS guard'],
  'berriai/litellm': ['PATTERN_ONLY', 'retry budget by exception; no gateway swap (9router stays)'],
  'agentgateway/agentgateway': ['PATTERN_ONLY', 'model pricing catalogue schema for future cost data'],
  'microsoft/agent-framework': ['PATTERN_ONLY', 'ShellPolicy / revision-checked checkpoint ideas'],
  'openai/openai-agents-python': ['PATTERN_ONLY', 'handoff schema + guardrails'],
  'langchain-ai/open-swe': ['PATTERN_ONLY', 'review-repair state machine (ShipDe already has one)'],
  'openhands/openhands': ['DROP', 'full platform, daemon + Docker, ~300MB; overlaps Controller'],
  'openhands/software-agent-sdk': ['PATTERN_ONLY', 'risk levels / critic ideas; not adopted as runtime'],
  'swe-agent/swe-agent': ['DROP', 'single-agent harness; no unmet need'],
  'swe-agent/swe-rex': ['PATTERN_ONLY', 'liveness _wait_until_alive (ShipDe supervisor has its own)'],
  'raine/workmux': ['PATTERN_ONLY', 'git env scrubbing already applied in publisher'],
  'generalaction/emdash': ['PATTERN_ONLY', 'collision-proof worktree payload'],
  'ruvnet/ruflo': ['PATTERN_ONLY', 'safe-git wrapper idea; do not vendor'],
  'cline/cline': ['DROP', 'atomic-file POC measured slower (REJECT); Cline stays only as a 9router upstream'],
  'nvidia/openshell': ['DROP', 'Rust/k8s sandbox; Windows WorkerUser isolation stays'],
  'daytonaio/daytona': ['DROP', 'container sandbox; not Windows host isolation'],
  'dicklesworthstone/ntm': ['DROP', 'tmux-based; not native on Windows'],
  'manaflow-ai/cmux': ['DROP', 'tmux-based'],
  'smtg-ai/claude-squad': ['DROP', 'tmux + AGPL'],
  'gastownhall/beads': ['DROP (defer)', 'shared task memory; use superpowers plan files + ShipDe checkpoint first; revisit if handoff fails'],
  'getnao/sylph': ['DROP', 'no license'],
  'vercel-labs/agent-skills': ['DROP', 'no license'],
  'snyk/agent-scan': ['USE_AS_TOOL', 'scan installed skills/MCP before enabling them (security gate for superpowers/impeccable)'],
  'vinh05092001/shipde-brain': ['KEEP (data)', 'lessons/prompts store; no runtime reader yet'],
  'deepseek-ai/deepseek-harness': ['DROP', 'developer preview harness; opencode/hermes already cover'],
  'oraios/serena': ['PATTERN_ONLY', 'POC exists (serena.js); not adopted until measured; RTK first'],
  'yamadashy/repomix': ['USE_AS_TOOL', 'installed; repo packing for reviewers/analysts'],
  'microsoft/llmlingua': ['DROP', 'Python prompt compression; RTK cheaper'],
  'upstash/context7': ['USE_AS_TOOL', 'library docs lookup for workers'],
  'ast-grep/ast-grep': ['USE_AS_TOOL', 'structural search for reviewers (optional)'],
  'xiufengsun/tokentracker': ['USE_AS_TOOL (measure)', 'token telemetry for the before/after measurements'],
  'promptfoo/promptfoo': ['DROP', 'not installed; Work Item evidence replaces eval harness'],
  'open-policy-agent/opa': ['DROP', 'policy engine not needed; ShipDe gates are code'],
  'taskforcesh/bullmq': ['DROP', 'Redis queue; would be a second scheduler'],
  'open-telemetry/opentelemetry-js': ['USE_AS_TOOL', 'app observability (product), not brain'],
};
const NEW = [
  ['obra/superpowers', '8ca22dba9a94', 'MIT', 'USE', 'workflow skills: plan → subagent dev → review → repair; replaces ccpm/openspec/spec-kit/AO/startup-factory/claude-codex-orchestrator; no daemon'],
  ['rtk-ai/rtk', 'df39e33d7e59', 'Apache-2.0', 'USE', 'shell-output compaction for low-risk worker runs; single binary; measure before default-on'],
  ['pbakaus/impeccable', '4e8504f10106', 'Apache-2.0', 'USE', 'UI role skill + 60 detector rules; replaces ui-ux-pro-max/frontend-design; under screen spec'],
  ['affaan-m/ECC', 'ef648e01899b', 'MIT', 'REPLACED_BY:obra/superpowers', 'overlaps; memory issues reported on Windows native; cherry-pick rules only if a gap appears'],
  ['bmad-code-org/BMAD-METHOD', '8f2c13dd0e00', 'MIT', 'REPLACED_BY:obra/superpowers', 'heavier methodology; one workflow only'],
  ['open-gsd/gsd-core', 'n/a', 'MIT', 'DROP', 'own state + model selection conflicts with the Controller'],
  ['mksglu/context-mode', 'e5fcca6802d4', 'ELv2 (source-available)', 'DROP (fallback)', 'MCP + SQLite process, license; RTK first'],
  ['earendil-works/pi', '9ad083102aa9', 'MIT', 'DROP', 'harness only; opencode/hermes already'],
  ['anthropics/skills', '683bc88e56f3', 'Apache-2.0 per skill', 'REPLACED_BY:pbakaus/impeccable + obra/superpowers', 'skill-creator format only as reference'],
  ['muratcankoylan/Agent-Skills-for-Context-Engineering', '58b55a892175', 'MIT', 'PATTERN_ONLY', 'context patterns text'],
  ['nextlevelbuilder/ui-ux-pro-max-skill', '477bcb28c981', 'MIT', 'REPLACED_BY:pbakaus/impeccable', 'design checklist covered'],
];
const toolchain = (r) =>
  /node|pnpm|prettier|eslint|prisma|turborepo|docker|git-for-windows|lefthook|gitleaks|trivy|syft|semgrep|renovate|playwright|msw|storybook|axe|lighthouse|vitest|supertest|nock|pact|toxiproxy|prism|openapi|nest|k6|hoverfly|vietnamese|chrome-devtools|claude-code|codex|gemini-cli|antigravity/i.test(r);
let rows = [];
for (const r of inv) {
  const n = (r.owner + '/' + r.repo).toLowerCase();
  let d = D[n];
  if (!d) d = toolchain(n) ? ['USE_AS_TOOL', 'app/dev/CI toolchain or agent CLI; not part of the brain'] : ['DROP', 'no AI-workflow requirement found'];
  rows.push([r.owner + '/' + r.repo, r.pinnedCommit || 'unpinned', r.license || 'none', r.currentDecision, d[0], d[1]]);
}
const count = {};
for (const x of rows) count[x[4].split(':')[0]] = (count[x[4].split(':')[0]] || 0) + 1;
let md = '# Per-repo decisions (88 inventory + 11 named candidates), 2026-10-06\n\nOne decision per repo. KEEP_RUNTIME = already running for the AI workflow; USE = to integrate into the brain (measured before default-on); USE_AS_TOOL = app/dev toolchain or helper, not the brain; PATTERN_ONLY = copy an idea, no dependency; REPLACED_BY = covered by a chosen repo; DROP = no need, conflict, license or platform.\n\n';
md += '| repo | pinned | license | old WS2 | decision | reason |\n|---|---|---|---|---|---|\n';
for (const x of rows) md += '| ' + x.join(' | ') + ' |\n';
md += '\n## Named candidates outside the inventory\n\n| repo | pinned | license | decision | reason |\n|---|---|---|---|---|\n';
for (const x of NEW) {
  md += '| ' + x.join(' | ') + ' |\n';
  count[x[3].split(':')[0]] = (count[x[3].split(':')[0]] || 0) + 1;
}
md += '\n## Totals\n\n' + Object.entries(count).map(([k, v]) => '- ' + k + ': ' + v).join('\n') + '\n';
fs.writeFileSync(__dirname + '/REPO-DECISIONS-20261006.md', md);
console.log(JSON.stringify(count));
