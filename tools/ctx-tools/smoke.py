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
    from ._sanitize import (
        KEEP_ENV,
        SENSITIVE_WORDS,
        _WORD_ALT,
        _KEY_SEPARATORS,
        _CAMEL_BOUNDARY_RE,
        _PART_RE,
        _ASSIGNMENT_KEY_RE,
        _TEXT_ASSIGNMENT_RE,
        _TEXT_SPACE_ASSIGNMENT_RE,
        _AUTH_HEADER_RE,
        _BASIC_RE,
        _BEARER_RE,
        _CANARY_RE,
        _SK_RE,
        REDACTED,
        _split_parts,
        is_sensitive_key,
        JSONRPC_ERROR_CATEGORIES,
        error_category_from_code,
        JsonRpcError,
        sanitize_secret_payload,
        count_tokens,
    )
    from ._mcp import MCP, functions_in
except ImportError:
    from _sanitize import (
        KEEP_ENV,
        SENSITIVE_WORDS,
        _WORD_ALT,
        _KEY_SEPARATORS,
        _CAMEL_BOUNDARY_RE,
        _PART_RE,
        _ASSIGNMENT_KEY_RE,
        _TEXT_ASSIGNMENT_RE,
        _TEXT_SPACE_ASSIGNMENT_RE,
        _AUTH_HEADER_RE,
        _BASIC_RE,
        _BEARER_RE,
        _CANARY_RE,
        _SK_RE,
        REDACTED,
        _split_parts,
        is_sensitive_key,
        JSONRPC_ERROR_CATEGORIES,
        error_category_from_code,
        JsonRpcError,
        sanitize_secret_payload,
        count_tokens,
    )
    from _mcp import MCP, functions_in

__all__ = [
    "KEEP_ENV",
    "SENSITIVE_WORDS",
    "REDACTED",
    "is_sensitive_key",
    "JSONRPC_ERROR_CATEGORIES",
    "error_category_from_code",
    "JsonRpcError",
    "sanitize_secret_payload",
    "count_tokens",
    "MCP",
    "functions_in",
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

    all_passed = True
    for name, entry in entries.items():
        server = MCP(name, entry, project_dir, ctx_tools_root)
        result = {"status": "FAIL"}
        try:
            server.start()
            result["tool_count"] = len(server.tools)
            if name == "jcodemunch":
                brain_path = (project_dir / "tools" / "ai-brain").as_posix()
                indexed = server.call("index_folder", {"path": brain_path, "use_ai_summaries": False})
                repo = indexed.get("repo", project_dir.as_posix()) if isinstance(indexed, dict) else project_dir.as_posix()
                outline = server.call("get_file_outline", {"repo": repo, "file_path": args.target})
                resp_text = outline if isinstance(outline, str) else json.dumps(outline)
            else:
                find_res = server.call("find_symbol", {"name_path_pattern": "loadPriors", "relative_path": args.target})
                outline = server.call("get_symbols_overview", {"relative_path": args.target, "depth": 0, "max_answer_chars": 20000})
                resp_text = outline if isinstance(outline, str) else json.dumps(outline)
                result["find_symbol_tokens"] = count_tokens(json.dumps(find_res) if isinstance(find_res, (dict, list)) else str(find_res))

            resp_tokens = count_tokens(resp_text)
            found = functions_in(outline)
            if not expected.issubset(found):
                raise RuntimeError(f"Missing functions: {sorted(expected - found)}")

            reduction_pct = round((1 - resp_tokens / whole_file_tokens) * 100, 1)
            result.update({
                "status": "PASS",
                "tool_names": sorted(server.tools.keys()),
                "tool_count": len(server.tools),
                "function_count": len(found),
                "response_tokens": resp_tokens,
                "whole_file_tokens": whole_file_tokens,
                "token_savings_pct": reduction_pct,
                "token_comparison": f"{resp_tokens} MCP tokens vs {whole_file_tokens} whole file tokens ({reduction_pct}% reduction)",
            })
            print(f"{name}: PASS; tools={len(server.tools)}; functions={len(found)}; {resp_tokens} tokens vs {whole_file_tokens} whole-file ({reduction_pct}% reduction)", flush=True)
        except JsonRpcError as error:
            all_passed = False
            safe_err = f"JSON-RPC error: code={error.code}, category={error.category}"
            result.update({
                "status": "FAIL",
                "error": {
                    "code": error.code,
                    "category": error.category,
                },
                "diagnostics": sorted(server.diagnostics),
            })
            print(f"{name}: FAIL; {safe_err}", file=sys.stderr, flush=True)
        except Exception as error:
            all_passed = False
            safe_err = f"{type(error).__name__}"
            result.update({
                "status": "FAIL",
                "error": {
                    "code": -32603,
                    "category": "Internal error",
                },
                "diagnostics": sorted(server.diagnostics),
            })
            print(f"{name}: FAIL; {safe_err}", file=sys.stderr, flush=True)
        finally:
            result["shutdown"] = server.close()
            results["servers"][name] = result

    results_path.write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")
    print(f"Results written to temporary path: {results_path}", flush=True)
    return 0 if all_passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
