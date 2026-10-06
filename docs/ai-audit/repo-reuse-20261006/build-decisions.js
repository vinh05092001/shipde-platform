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
  'untrivial-ai/agent-orchestrator': ['DROP', 'AO stopped working ~18/9 (memory note); runs a background daemon and its own model choice, which conflicts with the Controller. RAM not measured'],
  'i-trytoohard/codex-startup-factory': ['REPLACED_BY:obra/superpowers', 'AO fork; workflow covered by superpowers skills'],
  'bostonvex/claude-codex-orchestrator': ['REPLACED_BY:obra/superpowers', 'issue-driven loop covered by superpowers + ShipDe loop'],
  'automazeio/ccpm': ['REPLACED_BY:obra/superpowers', 'PM workflow via commands; superpowers covers plan/execute/review'],
  'fission-ai/openspec': ['DEFERRED', 'change/spec/validation management is not covered by superpowers (workflow only); revisit for spec governance'],
  'github/spec-kit': ['PATTERN_ONLY', 'constitution + artifact templates; not covered by superpowers'],
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
  'openhands/openhands': ['DROP', 'full platform with a server and Docker workspaces; overlaps the Controller. RAM not measured on this machine'],
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
  'getnao/sylph': ['DROP', 'no LICENSE file at d31a9c05f19d (GitHub reports none); inventory license column was wrong'],
  'vercel-labs/agent-skills': ['DROP', 'no LICENSE file at 063bee94c3f4 (GitHub reports none); inventory license column was wrong'],
  'snyk/agent-scan': ['USE_AS_TOOL', 'scan installed skills/MCP before enabling them (security gate for superpowers/impeccable)'],
  'vinh05092001/shipde-brain': ['KEEP (data)', 'lessons/prompts store; no runtime reader yet'],
  'deepseek-ai/deepseek-harness': ['DROP', 'developer preview harness; opencode/hermes already cover'],
  'oraios/serena': ['PATTERN_ONLY', 'POC exists (serena.js); not adopted until measured; RTK first'],
  'yamadashy/repomix': ['USE_AS_TOOL', 'installed; repo packing for reviewers/analysts'],
  'microsoft/llmlingua': ['DROP', 'Python prompt compression; RTK covers the shell-output part with no Python runtime. Savings not measured'],
  'upstash/context7': ['USE_AS_TOOL', 'library docs lookup for workers'],
  'ast-grep/ast-grep': ['USE_AS_TOOL', 'structural search for reviewers (optional)'],
  'xiufengsun/tokentracker': ['USE_AS_TOOL (measure)', 'token telemetry for the before/after measurements'],
  'promptfoo/promptfoo': ['DEFERRED_QUALIFICATION_TOOL', 'dataset/regression evals of prompt-model-provider; different from Work Item evidence. Not installed. pinned a65fe81a676e'],
  'open-policy-agent/opa': ['DROP', 'policy engine not needed; ShipDe gates are code'],
  'taskforcesh/bullmq': ['DROP', 'Redis queue; would be a second scheduler'],
  'open-telemetry/opentelemetry-js': ['USE_AS_TOOL', 'app observability (product), not brain'],
};
const NEW = [
  ['obra/superpowers', '8ca22dba9a94', 'MIT', 'USE (locked adapter)', 'workflow/prompt pack: plan → subagent dev → review → repair. Must be adapted before use: its own model tiering/selection, a 5-round fix loop, push/merge/discard guidance and delete-code-before-test TDD conflict with the Controller, the repair budget, the publisher and recovery policy; only prompts/workflow are used, the Controller keeps model choice, repair budget and publish rights. Architecture has no background service; RAM not measured'],
  ['rtk-ai/rtk', 'df39e33d7e59', 'Apache-2.0', 'USE (measure first)', 'shell-output compaction for low-risk worker runs; single binary run per command; savings on ShipDe not measured; AGENTS.md limits it to low-risk work'],
  ['pbakaus/impeccable', '4e8504f10106', 'Apache-2.0', 'USE', 'UI role skill + 60 detector rules; replaces ui-ux-pro-max/frontend-design; under screen spec'],
  ['affaan-m/ECC', 'ef648e01899b', 'MIT', 'PATTERN_ONLY / PILOT_WINDOWS (memory)', 'orchestration/skills overlap superpowers and are not used; memory format/handoff kept as pattern or a Windows pilot; not enabled at runtime (Windows-native memory issues reported)'],
  ['bmad-code-org/BMAD-METHOD', '8f2c13dd0e00', 'MIT', 'ALTERNATIVE_WORKFLOW', 'product brief, architecture, UX, story context and adjustable planning depth that superpowers does not cover; benchmark against superpowers; never install both'],
  ['open-gsd/gsd-core', '1b362a1f688c (operator verified 13d37238ba08)', 'MIT', 'DROP runtime / PATTERN_ONLY', 'own state and model selection conflict with the Controller; patterns STATE.md, context budgeting and resume may be reused'],
  ['mksglu/context-mode', 'e5fcca6802d4', 'ELv2 (source-available)', 'DROP (fallback)', 'MCP + SQLite process, license; RTK first'],
  ['earendil-works/pi', '9ad083102aa9', 'MIT', 'DROP', 'harness only (no planner/subagent); OpenCode and Hermes one-shot already serve as harnesses'],
  ['anthropics/skills', '683bc88e56f3', 'Apache-2.0 per skill (docx/pdf/pptx/xlsx source-available)', 'PATTERN_ONLY', 'skill-creator format as reference; UI covered by impeccable'],
  ['muratcankoylan/Agent-Skills-for-Context-Engineering', '58b55a892175', 'MIT', 'PATTERN_ONLY', 'context patterns text'],
  ['nextlevelbuilder/ui-ux-pro-max-skill', '477bcb28c981', 'MIT', 'REPLACED_BY:pbakaus/impeccable', 'design checklist covered'],
];
const PIN = {
  'decolua/9router': 'a99cf57239ff (installed 0.5.95)', 'cli/cli': '17142e08db2e', 'nousresearch/hermes-agent': '4787e4d56fc8 (installed v0.21.4)',
  'gitleaks/gitleaks': 'b58d3f102cf3', 'promptfoo/promptfoo': 'a65fe81a676e', 'snyk/agent-scan': '69ce32c6e5ae', 'yamadashy/repomix': '8d6429121e98 (installed 0.3.3)',
  'upstash/context7': 'f2eef4f49da7', 'ast-grep/ast-grep': '029430eac791', 'xiufengsun/tokentracker': '17247d9d0c9e', 'microsoft/llmlingua': '5a4c78ae18ab',
  'open-policy-agent/opa': 'd179cdae4073', 'taskforcesh/bullmq': '71c9ca72f321', 'deepseek-ai/deepseek-harness': '5badb15009ae (installed dsh 0.1.1-rc.2)',
  'aquasecurity/trivy': '8f815546c7b5', 'semgrep/semgrep': '93eeef68950a', 'getnao/sylph': 'd31a9c05f19d', 'vercel-labs/agent-skills': '063bee94c3f4',
  'gastownhall/beads': 'e72cd8b3153c', 'fission-ai/openspec': '9111a7654d78', 'github/spec-kit': '2dda047809dd', 'untrivial-ai/agent-orchestrator': '9a1cb73134ac', 'oraios/serena': '3155fd67e9b7',
};
const LIC = { 'getnao/sylph': 'none (no LICENSE at d31a9c05f19d)', 'vercel-labs/agent-skills': 'none (no LICENSE at 063bee94c3f4)', 'oraios/serena': 'SolidLSP MIT / app GPL-3.0-or-later' };
const NEW_RUNTIME = [
  ['anomalyco/opencode', 'f03046d9f558 (installed 1.18.31)', 'MIT', 'KEEP_RUNTIME', 'main worker harness: isolated opencode-direct launches and reviewer runs; missing from the 88 inventory'],
  ['getpaseo/paseo', '81a5e5bc61d6 (installed 0.8.0)', 'mixed per component (LICENSE: portions licensed separately)', 'KEEP_RUNTIME', 'harness/daemon used by Controller candidates (paseo::...); missing from the 88 inventory'],
];
const toolchain = (r) =>
  /node|pnpm|prettier|eslint|prisma|turborepo|docker|git-for-windows|lefthook|gitleaks|trivy|syft|semgrep|renovate|playwright|msw|storybook|axe|lighthouse|vitest|supertest|nock|pact|toxiproxy|prism|openapi|nest|k6|hoverfly|vietnamese|chrome-devtools|claude-code|codex|gemini-cli|antigravity/i.test(r);
let rows = [];
for (const r of inv) {
  const n = (r.owner + '/' + r.repo).toLowerCase();
  let d = D[n];
  if (!d) d = toolchain(n) ? ['USE_AS_TOOL', 'app/dev/CI toolchain or agent CLI; not part of the brain'] : ['DROP', 'no AI-workflow requirement found'];
  rows.push([r.owner + '/' + r.repo, PIN[n] || r.pinnedCommit || 'unpinned (toolchain, not read)', LIC[n] || r.license || 'none', r.currentDecision, d[0], d[1]]);
}
const count = {};
for (const x of rows) count[x[4].split(':')[0]] = (count[x[4].split(':')[0]] || 0) + 1;
let md = '# Per-repo decisions r2 (88 inventory + 13 outside: 11 named candidates + 2 runtimes missing from the inventory), 2026-10-06\n\nOne decision per repo. KEEP_RUNTIME = already running for the AI workflow; USE = to integrate into the brain (measured before default-on); USE_AS_TOOL = app/dev toolchain or helper, not the brain; PATTERN_ONLY = copy an idea, no dependency; REPLACED_BY = covered by a chosen repo; DROP = no need, conflict, license or platform.\n\n';
md += '| repo | pinned | license | old WS2 | decision | reason |\n|---|---|---|---|---|---|\n';
for (const x of rows) md += '| ' + x.join(' | ') + ' |\n';
md += '\n## Named candidates outside the inventory\n\n| repo | pinned | license | decision | reason |\n|---|---|---|---|---|\n';
for (const x of NEW_RUNTIME) NEW.push(x);
for (const x of NEW) {
  md += '| ' + x.join(' | ') + ' |\n';
  count[x[3].split(':')[0]] = (count[x[3].split(':')[0]] || 0) + 1;
}
md += '\n## Totals\n\n' + Object.entries(count).map(([k, v]) => '- ' + k + ': ' + v).join('\n') + '\n';
fs.writeFileSync(__dirname + '/REPO-DECISIONS-20261006.md', md);
console.log(JSON.stringify(count));
