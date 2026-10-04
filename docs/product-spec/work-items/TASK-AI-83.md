# TASK-AI-83 — The live loop writes a review manifest and hands it to the publisher

## Control

- Work Item ID: TASK-AI-83
- Status: READY_FOR_CODEX
- Assigned author: BOOTSTRAP_SELECTION agy-pool agy07 (google)
- Dependencies: TASK-AI-77, TASK-AI-80

## Business Outcome

After TASK-AI-77 the publisher refuses any publish without a validated manifest; the live loop now writes the manifest and markdown artifact for the reviewed SHA from the reviewer's structured outcome, so a reviewed commit can reach a draft PR.

## Acceptance Matrix

- L-R01 add buildManifest({repoCwd, workItemId, baseSha, reviewedSha, writerCandidateKey, reviewerCandidateKey, verdict, findings, tests, artifactPath}) in review-manifest.js that fills schema v1 using computeReviewedTree/computePatchId/sha256File and the canonical failure domain from publisher.failureDomainFromCandidateKey; it never invents a verdict or findings: they come only from the reviewer's structured outcome.
- L-R02 after each review round the loop writes the human markdown artifact and the JSON manifest next to the decision log (data dir of the run), and the manifest validates with validateManifest against the exact reviewed SHA.
- L-R03 the publish call passes reviewManifest and reviewArtifact for the reviewed SHA; a manifest for a different SHA, a PASS with open findings, or a CHANGES_REQUIRED verdict makes the loop refuse to publish with the validator's code.
- L-R04 test: end-to-end in a temp repo with a fake reviewer returning PASS and zero findings -> manifest written, validates, publisher (testMode or fake) receives both paths; with an open finding -> PUBLISH refused with PASS_WITH_OPEN_FINDINGS.

## Verification Commands

- node --test tools/ai-brain/test/task-ai-83.test.js
- node --test "tools/ai-brain/test/*.test.js"

## Residual Limitations

None recorded by the author; see review.
