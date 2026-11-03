"""Attach shared code-context MCP servers (jcodemunch, serena) to writer/reviewer lanes."""
import argparse
import copy
from datetime import datetime
import json
import os
from pathlib import Path
import sys
import tomllib


def load_servers(config_dir: Path, ctx_tools_root: str) -> dict:
    """Load and render MCP servers from toolkit.json or fallback to mcp-entries.template.json."""
    normalized_root = str(Path(ctx_tools_root).resolve()).replace("\\", "/")
    toolkit_path = config_dir / "toolkit.json"
    template_path = config_dir / "mcp-entries.template.json"

    if toolkit_path.exists():
        data = json.loads(toolkit_path.read_text(encoding="utf-8"))
        tools = data.get("tools", [])
        servers = {}
        for tool in tools:
            if tool.get("type") == "mcp":
                cmd = tool.get("command", "").replace("${CTX_TOOLS_ROOT}", normalized_root)
                args = [a.replace("${CTX_TOOLS_ROOT}", normalized_root) for a in tool.get("args", [])]
                env = {k: v.replace("${CTX_TOOLS_ROOT}", normalized_root) for k, v in tool.get("env", {}).items()}
                servers[tool["id"]] = {"command": cmd, "args": args, "env": env}
        if servers:
            return servers

    if template_path.exists():
        template_text = template_path.read_text(encoding="utf-8")
        rendered = template_text.replace("${CTX_TOOLS_ROOT}", normalized_root)
        return json.loads(rendered)

    raise FileNotFoundError(f"Neither toolkit.json nor mcp-entries.template.json found in {config_dir}")


def save_verified(path: Path, original: bytes, updated: bytes, parser, backup_date: str) -> None:
    """Safely back up and write verified updated configuration without leaking secrets."""
    parser(updated.decode("utf-8-sig"))
    if original:
        backup = path.with_name(f"{path.name}.bak-{backup_date}")
        if backup.exists():
            if backup.read_bytes() != original:
                raise RuntimeError("Existing dated backup differs; preserved without overwrite")
        else:
            backup.write_bytes(original)
    if path.exists() and path.read_bytes() != original:
        raise RuntimeError("Configuration changed concurrently; no write performed")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(updated)
    assert path.read_bytes() == updated
    parser(path.read_bytes().decode("utf-8-sig"))
    print(f"PASS: backed up and updated {path}", flush=True)


def attach_json_mcp(client_name: str, path: Path, key_name: str, entries: dict, apply: bool, backup_date: str) -> bool:
    """Attach MCP entries to a JSON configuration (agy, claude, opencode) preserving all other keys."""
    original = path.read_bytes() if path.exists() else b"{}"
    content_str = original.decode("utf-8-sig").strip()
    before = json.loads(content_str) if content_str else {}
    existing = before.get(key_name, {})
    if all(existing.get(name) == entry for name, entry in entries.items()):
        print(f"PASS: {client_name} entries already match; no write", flush=True)
        return False

    expected = copy.deepcopy(before)
    expected.setdefault(key_name, {}).update(entries)
    updated = (json.dumps(expected, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    after = json.loads(updated.decode("utf-8-sig"))

    # Verify existing non-target keys remain untouched
    restored = copy.deepcopy(after)
    for name in entries:
        if name in restored.get(key_name, {}):
            del restored[key_name][name]
    if key_name in restored and not restored[key_name] and key_name not in before:
        del restored[key_name]
    assert restored == before, f"Unrelated {client_name} keys changed"

    if not apply:
        print(f"[DRY-RUN] {client_name}: would update {path}", flush=True)
        return True

    save_verified(path, original, updated, json.loads, backup_date)
    return True


def attach_codex(path: Path, servers: dict, apply: bool, backup_date: str) -> bool:
    """Attach MCP servers to Codex config.toml preserving existing sections and keys."""
    original = path.read_bytes() if path.exists() else b""
    before = tomllib.loads(original.decode("utf-8-sig")) if original else {}
    existing = before.get("mcp_servers", {})
    if all(existing.get(name) == entry for name, entry in servers.items()):
        print("PASS: codex entries already match; no write", flush=True)
        return False

    blocks = []
    for name, entry in servers.items():
        if existing.get(name) == entry:
            continue
        blocks.extend([
            f"[mcp_servers.{name}]",
            f"command = {json.dumps(entry['command'])}",
            f"args = {json.dumps(entry['args'])}",
            "",
            f"[mcp_servers.{name}.env]",
        ])
        blocks.extend(f"{k} = {json.dumps(v)}" for k, v in entry["env"].items())
        blocks.append("")

    newline = "\r\n" if b"\r\n" in original else "\n"
    if original:
        separator = newline * 2 if not original.endswith(newline.encode("utf-8")) else newline
        updated = original + separator.encode("utf-8") + newline.join(blocks).encode("utf-8")
    else:
        updated = newline.join(blocks).encode("utf-8")

    after = tomllib.loads(updated.decode("utf-8-sig"))
    expected = copy.deepcopy(before)
    expected.setdefault("mcp_servers", {}).update(servers)
    assert after == expected, "Unrelated codex values changed"
    if original:
        assert updated.startswith(original), "Original codex bytes changed"

    if not apply:
        print(f"[DRY-RUN] codex: would update {path}", flush=True)
        return True

    save_verified(path, original, updated, tomllib.loads, backup_date)
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("client", nargs="?", default="all", choices=["all", "agy", "opencode", "codex", "claude"])
    parser.add_argument("--dry-run", action="store_true", default=True, help="Preview changes without modifying files (default)")
    parser.add_argument("--apply", action="store_true", default=False, help="Apply configuration changes and create backups")
    parser.add_argument("--ctx-tools-root", default=os.environ.get("CTX_TOOLS_ROOT", "C:/Tools/ctx-tools"))
    parser.add_argument("--backup-date", default=datetime.now().strftime("%Y%m%d"))
    parser.add_argument("--agy-config", type=Path, default=Path.home() / ".gemini/config/mcp_config.json")
    parser.add_argument("--opencode-config", type=Path, default=Path.home() / ".config/opencode/opencode.json")
    parser.add_argument("--codex-config", type=Path, default=Path.home() / ".codex/config.toml")
    parser.add_argument("--claude-config", type=Path, default=Path(".mcp.json"))
    args = parser.parse_args()

    apply = args.apply
    config_dir = Path(__file__).resolve().parent
    try:
        servers = load_servers(config_dir, args.ctx_tools_root)
    except Exception as err:
        print(f"Error loading MCP servers: {err}", file=sys.stderr)
        return 1

    opencode_entries = {
        name: {
            "type": "local",
            "command": [server["command"], *server["args"]],
            "environment": server["env"],
            "enabled": True,
        }
        for name, server in servers.items()
    }

    clients = ["agy", "opencode", "codex", "claude"] if args.client == "all" else [args.client]
    failed = False
    for client in clients:
        try:
            if client == "agy":
                attach_json_mcp("agy", args.agy_config, "mcpServers", servers, apply, args.backup_date)
            elif client == "claude":
                attach_json_mcp("claude", args.claude_config, "mcpServers", servers, apply, args.backup_date)
            elif client == "opencode":
                attach_json_mcp("opencode", args.opencode_config, "mcp", opencode_entries, apply, args.backup_date)
            elif client == "codex":
                attach_codex(args.codex_config, servers, apply, args.backup_date)
        except Exception as error:
            failed = True
            print(f"{client} attachment failed: {type(error).__name__}: {error}", file=sys.stderr)

    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
