# TASK-AI-77 — Structured review manifest; evidence bound to Work Item, SHA, tree, patch and merge

## Control

- Work Item ID: TASK-AI-77
- Status: READY_FOR_CODEX
- Assigned author: Controller-selected paseo::http://127.0.0.1:20128/v1::9router::ocz::xkiro::xkiro::ocz/big-pickle (JEV UNDECIDED low confidence; exploration budget 1)
- Dependencies: TASK-AI-75, TASK-AI-76
- Scope amendments: additive edits to task-ai-75.test.js (M-R07 requires manifests); diff budget raised from 900 to 1600 lines (most are tests; repair F1 added 89)

## Business Outcome

A markdown review can no longer promote evidence or authorize publishing. The machine-checked manifest binds the Work Item, reviewed commit, tree and patch, reviewer independence and the merge result; markdown is for humans only.

## Acceptance Matrix

- M-R01 validateManifest(manifest, {repoCwd, expected:{workItemId, commit}}) returns {ok:true} or {ok:false, code}. Codes: SCHEMA_INVALID, WORK_ITEM_MISMATCH, SHA_MISMATCH, TREE_MISMATCH, PATCH_MISMATCH, PASS_WITH_OPEN_FINDINGS, REVIEWER_NOT_INDEPENDENT, ARTIFACT_HASH_MISMATCH.
- M-R02 tree/patch are recomputed from git in repoCwd, never trusted from the manifest.
- M-R03 PASS with any finding status open is refused.
- M-R04 reviewer key equal to writer key, or reviewerFailureDomain equal to writerFailureDomain, or same upstream or same modelId is refused (reuse failureDomainFromCandidateKey from publisher.js, exporting it if needed; do not duplicate the rule).
- M-R05 artifactSha256 must equal sha256 of the markdown file passed as artifactPath.
- M-R06 publisher.publish requires options.reviewManifest (path); it validates it against reviewedSha and workItemId before any push; missing or invalid -> PUBLISH_REFUSED: <code>. Existing publisher tests must keep passing (update their fixtures only by adding a valid manifest, never by weakening assertions).
- M-R07 work-evidence importWorkItemPass takes --manifest instead of parsing markdown for the verdict; markdown alone is refused (MANIFEST_REQUIRED).
- M-R08 merge binding: ancestor path requires the merged commit to be reachable from main AND a main commit whose message contains [<workItemId>] whose tree diff equals the reviewed patch (patch-id of mergeCommit^..mergeCommit equals reviewedPatchId). Squash path requires the same patch-id equality; commit message alone is never enough (SQUASH_PATCH_MISMATCH). Optional --pr-head <sha> must equal reviewedCommit (PR_HEAD_MISMATCH).
- M-R09 evidence item records workItemId, reviewedCommit, reviewedTree, reviewedPatchId, mergeCommit, manifest sha256; still written only through evidence.recordProbe into the existing store (no second store).
- M-R10 CLI: node tools/ai-brain/cli.js review manifest validate --manifest <p> --artifact <md> --work-item <id> --sha <sha> [--json]; exit 0 ok, 1 refused, 2 bad argv.

## Verification Commands

- node --test tools/ai-brain/test/task-ai-77.test.js
- node --test "tools/ai-brain/test/*.test.js"

## Residual Limitations

- The manifest is unsigned JSON; its integrity rests on recomputing tree and patch from git and on the artifact hash.
