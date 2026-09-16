# TASK-AI-16 — Root cause of the Codex launch flag rejection

## Summary

`ao doctor` reports that Codex rejects AO's launch flags and concludes that
"a codex CLI update likely changed its flag/config surface", implying the hooks
are the problem. That conclusion is wrong on both counts.

**The hooks are accepted. The `projects` override is what fails, and it fails
because of Windows path backslashes, not because of a CLI version change.**

## How it was isolated

Each `-c` override from the failing command was run on its own against
`codex-cli 0.154.0`:

| Override | Result |
|---|---|
| `-c check_for_update_on_startup=false` | accepted |
| `-c notice.hide_rate_limit_model_nudge=true` | accepted |
| `-c hooks.SessionStart=[...]` | accepted |
| `-c hooks.UserPromptSubmit=[...]` | accepted |
| `-c hooks.PermissionRequest=[...]` | accepted |
| `-c hooks.Stop=[...]` | accepted |
| `-c projects={'C:\Users\...'={trust_level="trusted"}}` | **rejected** |

All four hook overrides parse. Only the last one fails.

## The error

```
Error: failed to load bootstrap configuration

Caused by:
    invalid type: string "{\"C:\\Users\\gumac\\AppData\\Local\\Temp\"={trust_level=\"trusted\"}}",
    expected a map
```

The parser received a *string* where it expected a *map*. The backslashes in
the Windows path are consumed as escape sequences before the value is parsed,
so the whole `{...}` never becomes a table.

## Confirmation

Holding everything else constant and varying only the path separator:

| Path form | Result |
|---|---|
| `projects={"C:\Users\gumac\AppData\Local\Temp"={trust_level="trusted"}}` | rejected |
| `projects={"C:/Users/gumac/AppData/Local/Temp"={trust_level="trusted"}}` | **accepted** |
| `projects."C:/Users/gumac/AppData/Local/Temp"={trust_level="trusted"}` | **accepted** |
| `projects={"/tmp"={trust_level="trusted"}}` | accepted |
| `projects={"C:\\Users\\gumac"={trust_level="trusted"}}` | accepted when the argument reaches the CLI intact; rejected through `cmd.exe` quoting — see the correction below |

A path with no backslash always parses.

**Correction (measured 2026-09-16).** The row above originally read "rejected",
and the conclusion drawn from it — "doubling the backslashes does not help,
which rules out a simple escaping fix at the call site" — does not survive
measurement. Handing the doubled form to `codex-cli 0.154.0` as a single argv
element (`node @openai/codex/bin/codex.js features list -c 'projects={"C:\\Users\\…"=…}'`)
exits `0`: after TOML unescaping the path is `C:\Users\…`, which parses. The
same text routed through `cmd.exe` is rejected, because the shell consumes the
doubling before Codex sees it. The original probe took the shell route, so its
"rejected" reading was a property of the shell, not of the CLI. An escaping fix
at the call site is therefore not ruled out by this evidence; the fix still
belongs upstream because AO ships as a closed binary. The measurement is
reproducible with `tools/ai-brain/acceptance/ac-16-03-codex-flag-refusal.js`.

The complete flag set, with the single change of forward slashes in the
project path, is accepted:

```
codex features list \
  -c check_for_update_on_startup=false \
  -c notice.hide_rate_limit_model_nudge=true \
  -c 'hooks.SessionStart=[...]' \
  -c 'hooks.UserPromptSubmit=[...]' \
  -c 'hooks.PermissionRequest=[...]' \
  -c 'hooks.Stop=[...]' \
  -c 'projects={"C:/Users/gumac/AppData/Local/Temp"={trust_level="trusted"}}'
  → exit 0
```

## What this changes about the Work Item

Two things, and both make it smaller and safer.

The fix is a path normalisation at the point AO builds the `projects`
override, not a rework of the hook configuration. No hook needs to change, so
the `AI-16-R05` prohibition on dropping a hook is not in tension with anything.

The diagnosis in `ao doctor` needs correcting as much as the flag does. It
currently blames a version change and points at the hooks, which sends the
next person to the wrong place. `AI-16-R02` already requires the rejected flag
to be quoted with the CLI version; it should also stop asserting a cause it
did not establish.

## Caveat

AO is a closed binary at `C:\Program Files\agent-orchestrator`. The fix
belongs upstream in whatever builds this command line. What is verifiable from
this repository is the root cause above and a `doctor.ps1` check that reports
it accurately, including which override was refused rather than the whole
command line as one opaque failure.

Whether AO can be configured to emit a forward-slash path — through its own
settings, a data-directory override, or an environment variable — is the open
question for the author of this Work Item.
