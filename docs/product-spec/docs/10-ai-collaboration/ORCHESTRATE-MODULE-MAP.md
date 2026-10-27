# Orchestrate Module Architecture & Function Map

> Task: TASK-AI-142 (Pure move refactor of `tools/ai-brain/orchestrate.js`)
> Source baseline: `tools/ai-brain/orchestrate.js` (9,402 lines, 104 top-level functions, 36 exports)
> Operating contract: PURE MOVE REFACTOR — zero behavior change, zero renames, zero logic edits outside moved code.

## 1. Executive Summary & Module Architecture

`tools/ai-brain/orchestrate.js` is the central autonomous execution loop in Ship Dễ. Over iterative delivery, it grew to 9,402 lines covering multiple distinct architectural concerns. This document maps every single top-level function (104 functions total) to its target module, cataloguing its line range, callers across `tools/ai-brain` (including tests, production tools, and `cli.js`), and identifies shared mutable state.

### Target Module Decomposition

| Target Module | Purpose | Functions | Approx Lines |
|---|---|---|---|
| `orchestrate/decisions-log.js` | Decision and warning emission helpers, error scrubbing, failure detail formatting, run refusal. | 5 | 42 |
| `orchestrate/route-probe.js` | Writer route probe execution, launch route resolution, model prefix stripping, probe ordering glue. | 3 | 70 |
| `orchestrate/candidates.js` | Candidate combination building, task profile extraction, role resolution, RTK policy, evidence accounts merging and filtering. | 10 | 245 |
| `orchestrate/ranking.js` | Realtime candidate selection for profile, scoring, JEV direct weighting, attempt tracking, failure evidence logging. | 4 | 470 |
| `orchestrate/checkpoint.js` | Checkpoint reading/writing, resume validation, cryptographic receipt generation, review normalization, test evidence compaction. | 21 | 520 |
| `orchestrate/publication.js` | Draft PR title generation, publish cwd resolution, hardened git cherry-pick/commit import, approval selection, PR publication. | 13 | 508 |
| `orchestrate/writer-loop.js` | Writer launch execution, worker root and commit verification, harness selection, fail-before capture, usage reporting, tree dirty checks. | 17 | 755 |
| `orchestrate/review-loop.js` | Review lane execution, host brain gate, detached worktree checkout, prettier/tool gates, reviewItem lifecycle, repair rounds. | 25 | 2818 |
| `orchestrate.js (core runner)` | Default options builder, dependency top-sort, main orchestration loop (runOrchestration), and final finish/reconciliation coordinator. | 6 | 3124 |

## 2. Shared Mutable State & Cross-Module State Boundaries

A clean modular split requires identifying all module-level mutable variables, caches, and globals that cannot be trivially duplicated:

### A. `baseGateCache` (Line 1856)
- **Type**: `Map<string, object>` (in-memory test failure and timing cache)
- **Location**: Declared at line 1856 of `orchestrate.js` (`const baseGateCache = new Map();`)
- **Used By**: `runHostBrainGate` (Line 2019: `const cache = options.baseCache || baseGateCache;`)
- **Exported**: Exported in `module.exports` (`baseGateCache`)
- **External Tests Touching It**: `task-ai-142-host-gate-baseline.test.js`, `task-ai-142-hostgate-repair.test.js` inspect and call `.clear()` on `require('./orchestrate').baseGateCache` to ensure isolated gate assertions.
- **Target Module**: `orchestrate/review-loop.js` (which owns `runHostBrainGate`).
- **Refactor Strategy**: `review-loop.js` instantiates and exports `baseGateCache`. `orchestrate.js` re-exports it directly (`baseGateCache: reviewLoop.baseGateCache`) so tests keep object identity. Callers can also explicitly inject `options.baseCache`.

### B. Constants and Enums (Immutable Module State)
- `PROBE_BUDGET_MS = 60000;` (Line 77) -> Target: `orchestrate/route-probe.js` (re-exported by `orchestrate.js` for `capability-probe.js`).
- `ItemStatus`, `RunStatus`, `PublicationStatus` (Lines 86-104) -> Target: `orchestrate.js` core or shared constants module; referenced by `finish` and `runOrchestration`.
- `DEFAULT_REVIEW_BUDGET = 120000;`, `SHA_40`, `ACCEPTED_VERDICTS` (Lines 110-112) -> Target: `orchestrate/review-loop.js` and `orchestrate/checkpoint.js`.
- `WORK_ITEM_ID`, `DRAFT_TITLE_LIMIT` (Lines 2474-2475) -> Target: `orchestrate/publication.js`.
- `FormatGate`, `ToolGate`, `PRETTIER_FILE` (Lines 6894-6907) -> Target: `orchestrate/review-loop.js`.

## 3. Detailed Function Inventory & Target Module Mapping

Below is the exhaustive inventory of all 104 top-level functions in `orchestrate.js` grouped by their target module.

### orchestrate/decisions-log.js

> **Purpose**: Decision and warning emission helpers, error scrubbing, failure detail formatting, run refusal.

| # | Function Name | Line Range | Lines | Exported | Internal Callers in `orchestrate.js` | External Callers (`cli.js`, prod, tests) |
|---|---|---|---|---|---|---|
| 1 | `launchFailureText` | L364–L366 | 3 | No | `failureMessageOf`, `recordWriterResult`, `markIsolationVerdictStop`, `runOrchestration` | None (internal only) |
| 2 | `failureMessageOf` | L374–L376 | 3 | No | `failedDecisionDetail`, `markIsolationVerdictStop`, `runOrchestration` | None (internal only) |
| 3 | `failedDecisionDetail` | L405–L409 | 5 | No | `runOrchestration`, `reviewItem`, `repairRound` | None (internal only) |
| 4 | `markIsolationVerdictStop` | L416–L428 | 13 | No | `runOrchestration`, `reviewItem`, `repairRound` | None (internal only) |
| 5 | `refuseRun` | L9255–L9272 | 18 | No | `runOrchestration` | None (internal only) |

### orchestrate/route-probe.js

> **Purpose**: Writer route probe execution, launch route resolution, model prefix stripping, probe ordering glue.

| # | Function Name | Line Range | Lines | Exported | Internal Callers in `orchestrate.js` | External Callers (`cli.js`, prod, tests) |
|---|---|---|---|---|---|---|
| 1 | `resolveLaunchRoute` | L430–L441 | 12 | No | `reviewLane`, `selectCandidateForProfile`, `runOrchestration`, `repairRound` | None (internal only) |
| 2 | `stripOpencodeProviderPrefix` | L444–L449 | 6 | No | `routeProbeCandidate` | None (internal only) |
| 3 | `routeProbeCandidate` | L451–L502 | 52 | YES | `reviewLane`, `selectCandidateForProfile`, `runOrchestration` | **prod**: capability-probe.js (1), rolling-onboard.js (1)<br>**tests** (5 files: task-ai-142-direct-writer-harness.test.js (2), task-ai-142-native-writer-lanes.test.js (3), task-ai-142-opencode-writers.test.js (2)...) |

### orchestrate/candidates.js

> **Purpose**: Candidate combination building, task profile extraction, role resolution, RTK policy, evidence accounts merging and filtering.

| # | Function Name | Line Range | Lines | Exported | Internal Callers in `orchestrate.js` | External Callers (`cli.js`, prod, tests) |
|---|---|---|---|---|---|---|
| 1 | `roleOf` | L150–L156 | 7 | No | `routingRoleOf`, `repairSpec`, `selectCandidateForProfile`, `runOrchestration`, `runToolGates`, `runFormatGate`, `reviewItem`, `repairRound` | **prod**: prompt-compiler.js (5)<br>**tests**: repo-integration-group-2.test.js (1) |
| 2 | `routingRoleOf` | L158–L166 | 9 | No | `buildProfile` | None (internal only) |
| 3 | `buildProfile` | L3045–L3148 | 104 | No | `buildTaskProfile`, `selectCandidateForProfile` | None (internal only) |
| 4 | `buildTaskProfile` | L3150–L3153 | 4 | YES | None | **cli**: cli.js (1)<br>**tests** (7 files: task-ai-142-capability-probe.test.js (2), task-ai-142-dryrun-priors.test.js (2), task-ai-142-goal-sources-review.test.js (1)...) |
| 5 | `rtkPolicyForItem` | L3155–L3173 | 19 | YES | `runOrchestration` | **tests**: task-ai-141.test.js (4) |
| 6 | `expandForbiddenDomains` | L3175–L3186 | 12 | No | `buildProfile` | None (internal only) |
| 7 | `hasQuotaAccountReadings` | L3188–L3201 | 14 | No | `selectCandidateForProfile` | **prod**: routing.js (2) |
| 8 | `mergeEvidenceAccounts` | L3203–L3231 | 29 | No | `resolveEvidenceAccounts` | **cli**: cli.js (4) |
| 9 | `resolveEvidenceAccounts` | L3233–L3242 | 10 | No | `buildCandidates`, `selectCandidateForProfile` | None (internal only) |
| 10 | `buildCandidates` | L3244–L3280 | 37 | YES | `runOrchestration` | **cli**: cli.js (5)<br>**prod**: qualification-auto.js (2), source-onboarding.js (2)<br>**tests** (7 files: task-ai-141b.test.js (5), task-ai-142-codex-writer-autobind.test.js (3), task-ai-142-goal-sources-review.test.js (1)...) |

### orchestrate/ranking.js

> **Purpose**: Realtime candidate selection for profile, scoring, JEV direct weighting, attempt tracking, failure evidence logging.

| # | Function Name | Line Range | Lines | Exported | Internal Callers in `orchestrate.js` | External Callers (`cli.js`, prod, tests) |
|---|---|---|---|---|---|---|
| 1 | `recordLaunchFailureEvidence` | L3282–L3342 | 61 | No | `runOrchestration`, `reviewItem`, `repairRound` | None (internal only) |
| 2 | `resolveDomainAttempts` | L3344–L3355 | 12 | No | `selectCandidateForProfile`, `reviewItem`, `repairRound` | None (internal only) |
| 3 | `resolveEvidenceDir` | L3357–L3363 | 7 | No | `reviewItem`, `repairRound` | None (internal only) |
| 4 | `selectCandidateForProfile` | L3365–L3754 | 390 | YES | `runOrchestration`, `reviewItem`, `repairRound` | **prod**: source-onboarding.js (2)<br>**tests** (12 files: task-ai-141b.test.js (1), task-ai-142-capability-probe.test.js (2), task-ai-142-direct-http-writer.test.js (5)...) |

### orchestrate/checkpoint.js

> **Purpose**: Checkpoint reading/writing, resume validation, cryptographic receipt generation, review normalization, test evidence compaction.

| # | Function Name | Line Range | Lines | Exported | Internal Callers in `orchestrate.js` | External Callers (`cli.js`, prod, tests) |
|---|---|---|---|---|---|---|
| 1 | `receiptCount` | L2270–L2274 | 5 | No | `extractCheckpointReview` | None (internal only) |
| 2 | `extractCheckpointReview` | L2280–L2355 | 76 | No | `runOrchestration` | None (internal only) |
| 3 | `stableJson` | L2357–L2368 | 12 | No | `digestObject` | **tests**: task-ai-64.test.js (5) |
| 4 | `sha256Text` | L2370–L2375 | 6 | No | `digestObject` | **tests**: task-ai-109-ui.test.js (3) |
| 5 | `digestObject` | L2377–L2379 | 3 | No | `attachReceiptIntegrity`, `compactTestEvidence`, `decisionLogEvidenceFor`, `verifyReceiptIntegrity`, `verifyReceiptDecisionLog` | None (internal only) |
| 6 | `receiptIntegrityPayload` | L2381–L2387 | 7 | No | `attachReceiptIntegrity`, `verifyReceiptIntegrity` | None (internal only) |
| 7 | `attachReceiptIntegrity` | L2389–L2396 | 8 | No | `normalizeReviewForCheckpoint` | None (internal only) |
| 8 | `countOpenFindings` | L2409–L2418 | 10 | No | `validateCheckpointReceipt`, `normalizeReviewForCheckpoint` | None (internal only) |
| 9 | `compactTestEvidence` | L2420–L2451 | 32 | No | `normalizeReviewForCheckpoint`, `reviewItem` | None (internal only) |
| 10 | `normalizedReceiptTests` | L2453–L2463 | 11 | No | `decisionLogEvidenceFor`, `verifyReceiptDecisionLog` | None (internal only) |
| 11 | `receiptFailureDomain` | L2500–L2506 | 7 | No | `verifyReceiptReviewerSeparation` | None (internal only) |
| 12 | `normalizeAccount` | L2508–L2510 | 3 | No | `reviewLane`, `selectCandidateForProfile`, `runOrchestration`, `repairRound` | None (internal only) |
| 13 | `decisionLogEvidenceFor` | L2696–L2750 | 55 | No | `verifyReceiptDecisionLog`, `normalizeReviewForCheckpoint`, `runOrchestration` | None (internal only) |
| 14 | `verifyReceiptIntegrity` | L2752–L2761 | 10 | No | `validateCheckpointReceipt` | None (internal only) |
| 15 | `verifyReceiptCommit` | L2763–L2825 | 63 | No | `validateCheckpointReceipt` | None (internal only) |
| 16 | `verifyReceiptTests` | L2827–L2843 | 17 | No | `validateCheckpointReceipt` | None (internal only) |
| 17 | `verifyReceiptReviewerSeparation` | L2845–L2856 | 12 | No | `validateCheckpointReceipt` | None (internal only) |
| 18 | `verifyReceiptDecisionLog` | L2858–L2905 | 48 | No | `validateCheckpointReceipt` | None (internal only) |
| 19 | `validateCheckpointReceipt` | L2907–L2937 | 31 | No | `runOrchestration` | None (internal only) |
| 20 | `normalizeReviewForCheckpoint` | L2939–L3007 | 69 | YES | `buildCheckpointReviews` | None (internal only) |
| 21 | `buildCheckpointReviews` | L3009–L3043 | 35 | No | `finish` | None (internal only) |

### orchestrate/publication.js

> **Purpose**: Draft PR title generation, publish cwd resolution, hardened git cherry-pick/commit import, approval selection, PR publication.

| # | Function Name | Line Range | Lines | Exported | Internal Callers in `orchestrate.js` | External Callers (`cli.js`, prod, tests) |
|---|---|---|---|---|---|---|
| 1 | `draftTitleFor` | L2477–L2487 | 11 | No | `draftTitleForItem`, `publication` | None (internal only) |
| 2 | `draftTitleForItem` | L2489–L2498 | 10 | YES | `normalizeReviewForCheckpoint`, `reviewItem` | **tests**: task-ai-123.test.js (3), task-ai-124.test.js (1) |
| 3 | `publishCwdForReceipt` | L2526–L2531 | 6 | YES | `reviewItem` | **tests**: task-ai-64.test.js (6) |
| 4 | `resolvePublishCwd` | L2540–L2549 | 10 | YES | `importReviewedCommitForPublish`, `validateCheckpointReceipt` | None (internal only) |
| 5 | `hardenedGitEnv` | L2551–L2558 | 8 | No | `runHardenedGit`, `autoFormatWorkerFiles` | None (internal only) |
| 6 | `hardenedGitArgs` | L2560–L2580 | 21 | No | `runHardenedGit`, `autoFormatWorkerFiles` | None (internal only) |
| 7 | `runHardenedGit` | L2582–L2591 | 10 | No | `importReviewedCommitForPublish`, `runFormatGate` | None (internal only) |
| 8 | `assertGitOk` | L2593–L2599 | 7 | No | `importReviewedCommitForPublish` | None (internal only) |
| 9 | `reviewedPublishBranch` | L2601–L2605 | 5 | No | `importReviewedCommitForPublish` | None (internal only) |
| 10 | `importReviewedCommitForPublish` | L2607–L2694 | 88 | No | `publication` | None (internal only) |
| 11 | `approvalIdsOf` | L8887–L8894 | 8 | No | `selectApprovalId` | None (internal only) |
| 12 | `selectApprovalId` | L8909–L8939 | 31 | No | `publication` | None (internal only) |
| 13 | `publication` | L8960–L9252 | 293 | No | `buildDefaults`, `resolvePublishCwd`, `runOrchestration`, `finish` | **cli**: cli.js (3)<br>**prod**: intake.js (1), publisher.js (2), skill-pack.js (4)<br>**tests** (14 files: controller-canary.test.js (4), task-ai-102.test.js (4), task-ai-105.test.js (17)...) |

### orchestrate/writer-loop.js

> **Purpose**: Writer launch execution, worker root and commit verification, harness selection, fail-before capture, usage reporting, tree dirty checks.

| # | Function Name | Line Range | Lines | Exported | Internal Callers in `orchestrate.js` | External Callers (`cli.js`, prod, tests) |
|---|---|---|---|---|---|---|
| 1 | `providerFailureBodyMatches` | L79–L84 | 6 | No | `runOrchestration` | None (internal only) |
| 2 | `resolveLauncher` | L187–L349 | 163 | YES | `selectCandidateForProfile`, `runOrchestration` | **tests** (8 files: task-ai-121.test.js (2), task-ai-126.test.js (6), task-ai-141.test.js (2)...) |
| 3 | `harnessFor` | L351–L357 | 7 | No | `recordWriterResult`, `reviewLane`, `runOrchestration`, `repairRound` | **prod**: executor.js (4) |
| 4 | `recordWriterResult` | L380–L403 | 24 | No | `runOrchestration`, `repairRound` | None (internal only) |
| 5 | `runVerificationCommand` | L513–L595 | 83 | YES | `reviewItem` | **tests**: task-ai-64.test.js (6) |
| 6 | `headShaOf` | L1390–L1406 | 17 | YES | `verifyWorkerCommit`, `runOrchestration`, `reviewItem`, `repairRound` | **tests**: task-ai-142-post-launch.test.js (2), task-ai-64.test.js (3) |
| 7 | `verifyCommitSha` | L1408–L1433 | 26 | YES | `runOrchestration` | **tests**: task-ai-142-post-launch.test.js (2) |
| 8 | `resolveIsolatedWorkerRoot` | L1435–L1444 | 10 | No | `reviewLane`, `selectCandidateForProfile`, `runOrchestration`, `reviewItem`, `repairRound` | None (internal only) |
| 9 | `isTestFilePath` | L1446–L1448 | 3 | No | `measureFailBefore` | None (internal only) |
| 10 | `measureFailBefore` | L1450–L1558 | 109 | YES | `runOrchestration` | **cli**: cli.js (2)<br>**tests** (14 files: task-ai-102.test.js (1), task-ai-105.test.js (3), task-ai-114.test.js (1)...) |
| 11 | `getTreeStatus` | L1560–L1615 | 56 | YES | `isTreeDirty`, `verifyWorkerCommit` | **tests**: task-ai-64.test.js (1) |
| 12 | `isTreeDirty` | L1617–L1619 | 3 | YES | `repairRound` | **prod**: isolation-launcher.js (5)<br>**tests**: task-ai-64.test.js (12) |
| 13 | `verifyWorkerCommit` | L1621–L1747 | 127 | YES | `runVerificationCommand` | **tests**: task-ai-64.test.js (25) |
| 14 | `writeUsageReportFromHarnessResult` | L1749–L1846 | 98 | YES | `reviewLane`, `runOrchestration`, `repairRound` | **prod**: isolation-launcher.js (2)<br>**tests** (4 files: task-ai-141.test.js (5), task-ai-142-isolated-usage.test.js (1), task-ai-142-launch-failure-not-quality.test.js (1)...) |
| 15 | `readUsageReport` | L1848–L1854 | 7 | No | `runOrchestration` | None (internal only) |
| 16 | `progressOf` | L2234–L2239 | 6 | No | `runOrchestration` | None (internal only) |
| 17 | `prepareUsageReport` | L2249–L2258 | 10 | No | `reviewLane`, `runOrchestration`, `repairRound` | None (internal only) |

### orchestrate/review-loop.js

> **Purpose**: Review lane execution, host brain gate, detached worktree checkout, prettier/tool gates, reviewItem lifecycle, repair rounds.

| # | Function Name | Line Range | Lines | Exported | Internal Callers in `orchestrate.js` | External Callers (`cli.js`, prod, tests) |
|---|---|---|---|---|---|---|
| 1 | `provisionReviewRoot` | L602–L764 | 163 | YES | `reviewLane` | **tests**: task-ai-142-post-launch.test.js (2) |
| 2 | `reviewLane` | L774–L1334 | 561 | YES | `reviewItem` | **tests**: task-ai-128.test.js (1), task-ai-133.test.js (2), task-ai-142-route-probe.test.js (3) |
| 3 | `formatFindingDetail` | L1346–L1360 | 15 | No | `repairSpec` | None (internal only) |
| 4 | `repairSpec` | L1362–L1388 | 27 | YES | `repairRound` | **tests**: task-ai-64.test.js (4) |
| 5 | `resolveSuiteFiles` | L1858–L1877 | 20 | No | None | None (internal only) |
| 6 | `parseFailedTestNames` | L1881–L1889 | 9 | No | None | None (internal only) |
| 7 | `checkoutCleanCommit` | L1893–L1893 | 1 | No | None | None (internal only) |
| 8 | `runHostBrainGate` | L1935–L1935 | 1 | YES | `runOrchestration` | **tests** (6 files: controller-canary.test.js (1), task-ai-141.test.js (4), task-ai-142-host-gate-baseline.test.js (11)...) |
| 9 | `formatHostGateDiagnostics` | L2219–L2219 | 1 | YES | `runOrchestration` | **tests**: task-ai-142-hostgate-repair.test.js (2) |
| 10 | `writeReviewManifestAndArtifact` | L6779–L6891 | 113 | No | `reviewItem` | None (internal only) |
| 11 | `stripAnsi` | L6909–L6911 | 3 | No | `changedPrettierFiles`, `prettierCheck`, `changedFileNames` | None (internal only) |
| 12 | `prettierEntry` | L6918–L6923 | 6 | No | `prettierCheck`, `runFormatGate` | None (internal only) |
| 13 | `changedPrettierFiles` | L6929–L6948 | 20 | No | `runFormatGate` | None (internal only) |
| 14 | `toRepoRelative` | L6951–L6955 | 5 | No | `autoFormatWorkerFiles`, `runFormatGate` | None (internal only) |
| 15 | `prettierCheck` | L6958–L7011 | 54 | No | `autoFormatWorkerFiles`, `runFormatGate` | None (internal only) |
| 16 | `autoFormatWorkerFiles` | L7014–L7171 | 158 | No | `runFormatGate` | None (internal only) |
| 17 | `changedFileNames` | L7178–L7194 | 17 | No | `runToolGates`, `runFormatGate` | **tests**: repo-integration-group-2.test.js (1) |
| 18 | `runGateCommand` | L7202–L7211 | 10 | No | `runToolGates` | **tests**: repo-integration-group-2.test.js (1) |
| 19 | `gateUnavailableReason` | L7214–L7221 | 8 | No | `runToolGates` | **tests**: repo-integration-group-2.test.js (1) |
| 20 | `gateOutput` | L7224–L7228 | 5 | No | `runToolGates` | **prod**: prompt-compiler.js (9)<br>**tests**: repo-integration-group-2.test.js (1), task-ai-142-hostgate-repair.test.js (2) |
| 21 | `runToolGates` | L7243–L7394 | 152 | No | `reviewItem` | **tests**: repo-integration-group-2.test.js (3) |
| 22 | `runFormatGate` | L7406–L7579 | 174 | No | `runFormatGateForTest`, `reviewItem` | None (internal only) |
| 23 | `runFormatGateForTest` | L7582–L7603 | 22 | YES | None | **tests**: task-ai-140.test.js (2) |
| 24 | `reviewItem` | L7606–L8580 | 975 | YES | `runOrchestration` | **tests**: task-ai-128.test.js (1), task-ai-64.test.js (1), task-ai-94.test.js (3) |
| 25 | `repairRound` | L8587–L8884 | 298 | YES | `reviewItem` | **tests** (6 files: task-ai-127.test.js (1), task-ai-128.test.js (1), task-ai-142-review-repair-result.test.js (2)...) |

### orchestrate.js (core runner)

> **Purpose**: Default options builder, dependency top-sort, main orchestration loop (runOrchestration), and final finish/reconciliation coordinator.

| # | Function Name | Line Range | Lines | Exported | Internal Callers in `orchestrate.js` | External Callers (`cli.js`, prod, tests) |
|---|---|---|---|---|---|---|
| 1 | `buildDefaults` | L114–L148 | 35 | YES | `runOrchestration` | **tests**: task-ai-130.test.js (1) |
| 2 | `controller` | L169–L174 | 6 | No | `runOrchestration`, `refuseRun` | **cli**: cli.js (4)<br>**prod**: agy-pool-runtime.js (1), capability-probe.js (3), executor.js (1), goals.js (1), governed-merge.js (4), harness.js (1), hermes-acp.js (1), hermes-session.js (9), intake.js (2), isolation-launcher.js (2), jev.js (4), publisher.js (5), quota-scan.js (10), rolling-onboard.js (11), route-health.js (3), route-probe.js (12), routing.js (3), serena-mcp.js (1), sources.js (1)<br>**tests** (20 files: controller-canary.test.js (3), isolation-launch-host.test.js (1), isolation.test.js (1)...) |
| 3 | `unique` | L2260–L2262 | 3 | No | `finish` | **prod**: benchmarks.js (1), goals.js (1), intake.js (3), plan-adapter.js (2)<br>**tests**: discovery.test.js (1), task-ai-82.test.js (1) |
| 4 | `orderDependenciesFirst` | L3762–L3783 | 22 | No | `runOrchestration` | None (internal only) |
| 5 | `runOrchestration` | L3797–L6773 | 2977 | YES | None | **cli**: cli.js (4)<br>**prod**: intake.js (3)<br>**tests** (35 files: controller-canary.test.js (1), task-ai-102.test.js (1), task-ai-105.test.js (16)...) |
| 6 | `finish` | L9282–L9362 | 81 | No | `runOrchestration`, `refuseRun` | **cli**: cli.js (1)<br>**prod**: agy-gateway.js (2), agy-pool-runtime.js (4), context-pack.js (4), executor.js (1), fitness.js (5), hermes-acp.js (9), offerings.js (1), prompt-compiler.js (1), qualification.js (9), scheduler.js (1)<br>**tests** (4 files: fitness.test.js (4), review-lane.test.js (1), task-ai-142-writer-probe.test.js (1)...) |

## 4. Extraction Plan & Recommended Order

The refactoring is executed iteratively, extracting one module at a time from lowest-dependency/least-coupled to highest-coupled:

1. **Step 1 (Current)**: Architecture & Mapping documentation (`ORCHESTRATE-MODULE-MAP.md`).
2. **Step 2 (Current Task)**: `orchestrate/decisions-log.js`
   - **Functions**: `launchFailureText`, `failureMessageOf`, `failedDecisionDetail`, `markIsolationVerdictStop`, `refuseRun`.
   - **Rationale**: 5 functions, 42 lines, 0 shared mutable state, 0 external callers outside `orchestrate.js`, completely clean leaf dependency.
3. **Step 3 (Next)**: `orchestrate/route-probe.js`
   - **Functions**: `routeProbeCandidate`, `resolveLaunchRoute`, `stripOpencodeProviderPrefix`, plus `PROBE_BUDGET_MS`.
   - **Rationale**: 3 functions, 70 lines, self-contained probe resolution logic consumed by `capability-probe.js` and `rolling-onboard.js`.
4. **Step 4**: `orchestrate/candidates.js`
   - **Functions**: `buildCandidates`, `buildProfile`, `buildTaskProfile`, `rtkPolicyForItem`, `roleOf`, `routingRoleOf`, `expandForbiddenDomains`, `hasQuotaAccountReadings`, `mergeEvidenceAccounts`, `resolveEvidenceAccounts`.
   - **Rationale**: 10 functions, 245 lines, deterministic profile and candidate construction.
5. **Step 5**: `orchestrate/ranking.js`
   - **Functions**: `selectCandidateForProfile`, `recordLaunchFailureEvidence`, `resolveDomainAttempts`, `resolveEvidenceDir`.
   - **Rationale**: 4 functions, 470 lines, pure scoring and selection logic.
6. **Step 6**: `orchestrate/checkpoint.js`
   - **Functions**: 21 receipt integrity, resume verification, and review normalization functions (520 lines).
   - **Rationale**: Zero mutable state, pure cryptographic receipt checking and review serialization.
7. **Step 7**: `orchestrate/publication.js`
   - **Functions**: 13 functions (508 lines) handling draft PR creation, git import, approval binding, and publication.
8. **Step 8**: `orchestrate/writer-loop.js`
   - **Functions**: 17 functions (755 lines) covering worker launch, harness binding, git tree status, verifyWorkerCommit, and usage reports.
9. **Step 9**: `orchestrate/review-loop.js`
   - **Functions**: 25 functions (2,818 lines) covering review lanes, host brain gate, prettier/tool gates, and repair rounds.
10. **Step 10**: `orchestrate.js` (Core runner cleanup)
   - Contains top-level coordinator `runOrchestration`, `finish`, `buildDefaults`, and exports.
