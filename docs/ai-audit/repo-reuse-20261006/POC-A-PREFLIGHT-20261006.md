# POC A preflight — 2026-10-06 (read-only; no run started)

Code: origin/main eaa569f. Hermes: installed v0.21.4 (2026-09-21) at %APPDATA%\npm\node_modules\hermes-agent\runtime\hermes-agent.

## Result
A2 is BLOCKED_ISOLATION. A1 was not started, because a one-armed run cannot answer the comparison.

## Evidence
1. The isolated launcher supports only the opencode harness.
   - `tools/ai-brain/isolation-launcher.js:1026`: only `adapter.id === 'opencode-direct'` gets a generated worker config (9router base URL, pinned model id).
   - `isolation-launcher.js:250-267`: the worker env allow-list adds NINEROUTER_API_KEY only for `opencode-direct`. Every other harness reaches the worker without a model credential.
2. The Hermes harness has no isolated path.
   - `tools/ai-brain/harness.js` (`id: 'hermes'`) builds `-m <model> --ignore-user-config [--provider] --in <cwd> -z <prompt>`.
   - Unlike `paseo` (harness.js:47-51) and opencode-direct (harness.js:191), it has no `isolatedWorker` branch.
3. File access is not the blocker. ShipDeWorker has ReadAndExecute on %APPDATA%\npm (Get-Acl), so the binary is reachable. The missing pieces are config, credential and HERMES_HOME for the worker, and these need launcher code.
4. Pinning risks found in Hermes source; each must be proven before A2 could count as pinned:
   - `--ignore-user-config` skips config.yaml but ".env still loads" (`hermes_cli/cli_config_load.py:262`), so each agent needs its own empty HERMES_HOME. Otherwise keys or fallbacks from the operator home can leak in.
   - `fallback_model` (config.py:1037) and `hermes fallback` are disabled only while the user config is ignored; this must be proven on a run.
   - The planner path `kanban_decompose` calls an auxiliary LLM through `_call_aux` (`kanban_specify.py:145`). That is a second model route the Controller does not pick unless it is pinned too.
   - The kanban dispatcher spawns `hermes -p <profile> chat -q …` (`kanban_db_dispatch.py:2831`). The candidate identity therefore lives in a profile under HERMES_HOME. Whether a profile can carry account and quotaScope beyond provider + base_url + model is unknown (UNKNOWN until a run's usage file and the gateway log show it).
   - Custom gateway pinning is possible in principle via `--provider custom` with CUSTOM_BASE_URL (`runtime_provider.py:863-871`). Not executed.

## What unblocking needs (operator decision; not done)
- Option 1: a small launcher adapter, written by a worker in a POC worktree and never merged:
  - a Hermes branch in isolation-launcher;
  - a per-agent HERMES_HOME inside the worker root;
  - the pinned provider/base_url/model passed as config;
  - the key passed through the env allow-list;
  - the aux model pinned to the same candidate.
  Its file and line count becomes the "adapter lines" metric.
- Option 2: run A2 outside isolation in a separate worktree as the operator user. This is a weaker boundary than A1, so the two arms are no longer equal. The operator must approve it explicitly.
