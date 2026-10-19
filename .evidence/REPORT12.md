# Verification Report — TASK-AI-142 Direct Model Prefix Defect

## Overview

Fixed the OpenCode launch defect where workers configured for direct HTTP OpenAI-compatible sources (`opencode-direct`) registered the provider under `providerId` (derived from `selectedSource.opencodeProvider || selectedSource.id`), but launch arguments passed the bare pinned model name (e.g. `claude-opus-5`) without the `providerId/` prefix required by OpenCode. This caused OpenCode to fail to resolve the provider and exit 1 with 0 tokens, classifying the failure as `launch_config`.

### Changes Made

1. **`tools/ai-brain/isolation-launcher.js`**:
   - Declared `directModelRewrite` variable scoped for `opencode-direct` launches.
   - For direct sources (`!isRouter`), once `providerId` is resolved, if `pinnedModel` does not start with `providerId + '/'`, computed `directModelRewrite = providerId + '/' + pinnedModel`.
   - Preserved already-prefixed models and router (`isRouter`) models without modification.
   - Rewrote the `--model` argument in `launchArgs` to `directModelRewrite` before serializing to `launch-args-*.json`.
   - Kept `modelsMap` keys holding the relative model ID so OpenCode can resolve `providerId/relativeId`.

2. **`tools/ai-brain/test/task-ai-142-direct-model-prefix.test.js`**:
   - Added regression test suite verifying:
     - Direct source with a bare pinned model rewrites launch args `--model` to `<providerId>/<model>`.
     - Direct source with an already-prefixed model leaves launch args `--model` unchanged.
     - Router source leaves launch args `--model` unchanged.

3. **`docs/product-spec/work-items/TASK-AI-142.md`**:
   - Added an H3 entry documenting the root cause, repair, and semantics for direct source model prefixing in OpenCode launch arguments.

## Verification

- Pre-fix regression test: RED (failed with `AssertionError: bare model must be prefixed with providerId/`).
- Post-fix regression test: GREEN (3/3 passed).
- Narrow test suite: `node --test tools/ai-brain/test/task-ai-142-direct-model-prefix.test.js tools/ai-brain/test/isolation*.test.js` passed (43/43 passed).
- `git diff --check` and `prettier --check` passed cleanly.
