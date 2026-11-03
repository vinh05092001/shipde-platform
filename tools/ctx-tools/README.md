# Shared Code-Context MCP Setup (`jcodemunch`, `serena`)

Versioned configuration and automation scripts to attach local code-context MCP servers (`jcodemunch-mcp 1.108.401` and `oraios/serena v2.1.0`) across all author and reviewer lanes: Antigravity (`agy`), OpenCode, Codex, and Claude Code.

---

## Architecture & Requirements

- **Root Location**: Configured via the `CTX_TOOLS_ROOT` environment variable (defaults to `C:/Tools/ctx-tools`).
- **Python Virtual Environments**:
  - `jcodemunch-mcp 1.108.401`: `${CTX_TOOLS_ROOT}/.venv/Scripts/python.exe`
  - `serena-agent 2.1.0`: `${CTX_TOOLS_ROOT}/.venv-serena/Scripts/serena.exe`
- **Server Flags & Safety**:
  - `JCODEMUNCH_USE_AI_SUMMARIES=false`, `--watcher=false`
  - Serena web dashboard, browser opening, and GUI log windows disabled (`--enable-web-dashboard false`, `--enable-gui-log-window false`, `--open-web-dashboard false`)
  - No secret tokens or credentials printed or stored.

---

## Attaching to Client Lanes

Use `tools/ctx-tools/attach.py` to attach MCP server definitions to client configuration files.

### 1. Preview changes (Dry-Run — Default)

```bash
python tools/ctx-tools/attach.py
# or explicitly
python tools/ctx-tools/attach.py --dry-run
```

### 2. Apply configuration

```bash
python tools/ctx-tools/attach.py --apply
```

Target configuration files:

- **agy**: `~/.gemini/config/mcp_config.json` (`mcpServers`)
- **opencode**: `~/.config/opencode/opencode.json` (`mcp`)
- **codex**: `~/.codex/config.toml` (`[mcp_servers]`)
- **claude**: `.mcp.json` (`mcpServers`)

### 3. Safety Guarantees

- **Backups**: Automatically saves a copy as `<config-file>.bak-<YYYYMMDD>` before writing.
- **Key Preservation**: All existing settings, preferences, and non-target MCP entries are strictly preserved.
- **Idempotent**: Re-running `--apply` detects existing matching entries and performs no write.
- **Secret Protection**: Existing configuration contents and secrets are never printed to stdout/stderr.

---

## Verification & Smoke Testing

Run `tools/ctx-tools/smoke.py` to test stdio MCP connectivity and measure token efficiency:

```bash
python tools/ctx-tools/smoke.py
```

- Results are written to the temporary directory (`%TEMP%/ctx-tools-smoke/smoke-results.json`).
- Compares token usage of reading whole files versus fetching structured symbols via MCP.

---

## Usage Guidelines (Token Savings)

- **Symbol Lookup**: Use `jcodemunch` (file outline, index) and `serena` (`find_symbol`, `get_symbols_overview`) to look up function signatures, classes, and types instead of ingesting full source files into model context. This typically yields a **75% to 95% token reduction**.
- **Raw Error Logs (Strict Rule)**: Never compress, truncate, or summarize failing test outputs, compiler errors, or verification evidence. Raw logs are required for auditability.
