"""MCP smoke test runner - runs a single server and returns result dict."""

import json
import sys

try:
    from ._sanitize import count_tokens, JsonRpcError
    from ._mcp import MCP, functions_in
except ImportError:
    from _sanitize import count_tokens, JsonRpcError
    from _mcp import MCP, functions_in


def run_single_server(name, entry, project_dir, ctx_tools_root, args, expected, whole_file_tokens):
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
            outline = server.call(
                "get_symbols_overview",
                {"relative_path": args.target, "depth": 0, "max_answer_chars": 20000},
            )
            resp_text = outline if isinstance(outline, str) else json.dumps(outline)
            result["find_symbol_tokens"] = count_tokens(
                json.dumps(find_res) if isinstance(find_res, (dict, list)) else str(find_res)
            )

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
            "token_comparison": (
                f"{resp_tokens} MCP tokens vs {whole_file_tokens} whole file tokens ({reduction_pct}% reduction)"
            ),
        })
        msg = f"{name}: PASS; tools={len(server.tools)}; functions={len(found)}; "
        msg += f"{resp_tokens} tokens vs {whole_file_tokens} whole-file ({reduction_pct}% reduction)"
        print(msg, flush=True)
    except JsonRpcError as error:
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
    return result
