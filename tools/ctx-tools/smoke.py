"""Smoke test shared MCP servers (jcodemunch, serena) and report token savings.

Reference: MCP Python SDK client stdio session (modelcontextprotocol/python-sdk, MIT License)
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sys

try:
    from ._sanitize import KEEP_ENV, JsonRpcError, sanitize_secret_payload, count_tokens
    from ._mcp import MCP
    from ._smoke_run import run_single_server
except ImportError:
    from _sanitize import KEEP_ENV, JsonRpcError, sanitize_secret_payload, count_tokens
    from _mcp import MCP
    from _smoke_run import run_single_server

__all__ = [
    "KEEP_ENV",
    "JsonRpcError",
    "sanitize_secret_payload",
    "count_tokens",
    "MCP",
    "run_single_server",
    "main",
]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ctx-tools-root", default=os.environ.get("CTX_TOOLS_ROOT", "C:/Tools/ctx-tools"))
    parser.add_argument("--project", default=str(Path(__file__).resolve().parents[2]))
    parser.add_argument("--target", default="tools/ai-brain/priors.js")
    default_out = str(Path(__file__).resolve().parents[2] / ".oc" / "tmp" / "ctx-tools-smoke")
    parser.add_argument("--out-dir", default=default_out)
    parser.add_argument("--entries", default=None)
    args = parser.parse_args()

    project_dir = Path(args.project).resolve()
    target_path = project_dir / args.target
    ctx_tools_root = Path(args.ctx_tools_root).resolve()
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    results_path = out_dir / "smoke-results.json"

    if not target_path.exists():
        print(f"Error: Target file {target_path} not found", file=sys.stderr)
        return 1

    original = target_path.read_bytes()
    expected = set(re.findall(r"^(?:export\s+)?(?:async\s+)?function\s+([\w$]+)\s*\(", original.decode("utf-8"), re.MULTILINE))
    whole_file_tokens = count_tokens(original.decode("utf-8"))

    if args.entries:
        entries = json.loads(Path(args.entries).read_text(encoding="utf-8"))
    else:
        template_file = Path(__file__).resolve().parent / "mcp-entries.template.json"
        template_str = template_file.read_text(encoding="utf-8")
        entries = json.loads(template_str.replace("${CTX_TOOLS_ROOT}", ctx_tools_root.as_posix()))

    results = {
        "target": str(target_path),
        "sha256": hashlib.sha256(original).hexdigest(),
        "expected_function_count": len(expected),
        "whole_file_tokens": whole_file_tokens,
        "servers": {},
    }

    for name, entry in entries.items():
        result = run_single_server(name, entry, project_dir, ctx_tools_root, args, expected, whole_file_tokens)
        results["servers"][name] = result

    all_passed = all(r["status"] == "PASS" for r in results["servers"].values())
    results_path.write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")
    print(f"Results written to temporary path: {results_path}", flush=True)
    return 0 if all_passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
