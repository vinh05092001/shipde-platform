"""Smoke test shared MCP servers (jcodemunch, serena) and report token savings."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import queue
import re
import subprocess
import sys
import tempfile
import threading
import time

KEEP_ENV = {
    "SYSTEMROOT", "WINDIR", "PATH", "PATHEXT", "COMSPEC", "TEMP", "TMP",
    "USERPROFILE", "APPDATA", "LOCALAPPDATA", "PROCESSOR_ARCHITECTURE", "NUMBER_OF_PROCESSORS"
}


def sanitize_secret_payload(val):
    if isinstance(val, str):
        s = val
        s = re.sub(
            r"(?i)\b(password|token|secret|api[_-]?key|auth(?:orization)?|credential)\b\s*([=:]\s*|\s+)[^\s,\"\'}\]]+",
            r"\1\2[REDACTED]",
            s,
        )
        s = re.sub(r"(?i)\bBearer\s+[^\s,\"\'}\]]+", "Bearer [REDACTED]", s)
        s = re.sub(r"(?i)\bCANARY_SECRET\w*", "[REDACTED]", s)
        s = re.sub(r"(?i)\bsk-[A-Za-z0-9_-]+", "[REDACTED]", s)
        return s
    elif isinstance(val, dict):
        sanitized = {}
        for k, v in val.items():
            if re.search(r"(?i)\b(password|token|secret|api[_-]?key|auth(?:orization)?|credential)\b", str(k)):
                sanitized[k] = "[REDACTED]"
            else:
                sanitized[k] = sanitize_secret_payload(v)
        return sanitized
    elif isinstance(val, list):
        return [sanitize_secret_payload(item) for item in val]
    else:
        return val


def count_tokens(text: str) -> int:
    try:
        import tiktoken
        enc = tiktoken.get_encoding("cl100k_base")
        return len(enc.encode(text))
    except Exception:
        return max(1, len(text.encode("utf-8")) // 4)


class MCP:
    def __init__(self, name: str, entry: dict, project_dir: Path, ctx_tools_root: Path):
        self.name = name
        self.messages = queue.Queue()
        self.counter = 0
        self.diagnostics = set()
        self.project_dir = project_dir
        self.tools = {}

        env = {k: v for k, v in os.environ.items() if k.upper() in KEEP_ENV}
        env.update(entry.get("env", {}))
        env["PYTHONIOENCODING"] = "utf-8"
        env["PYTHONUTF8"] = "1"
        env["npm_config_cache"] = str(ctx_tools_root / "npm-cache")
        env["JCODEMUNCH_CONTEXT_PROVIDERS"] = "0"

        self.process = subprocess.Popen(
            [entry["command"], *entry.get("args", [])],
            cwd=project_dir,
            env=env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
        )
        threading.Thread(target=self.read_stdout, daemon=True).start()
        threading.Thread(target=self.drain_stderr, daemon=True).start()

    def read_stdout(self):
        for line in self.process.stdout:
            try:
                self.messages.put(json.loads(line))
            except json.JSONDecodeError:
                self.diagnostics.add("non-json stdout")
        self.messages.put(None)

    def drain_stderr(self):
        for line in self.process.stderr:
            self.classify(line)

    def classify(self, text: str):
        for token in ("PermissionError", "Access is denied", "FileNotFoundError", "ModuleNotFoundError", "TimeoutError", "No active project"):
            if token.lower() in text.lower():
                self.diagnostics.add(token)

    def send(self, message: dict):
        self.process.stdin.write(json.dumps({"jsonrpc": "2.0", **message}) + "\n")
        self.process.stdin.flush()

    def request(self, method: str, params: dict, timeout: int = 180):
        self.counter += 1
        request_id = self.counter
        self.send({"id": request_id, "method": method, "params": params})
        deadline = time.monotonic() + timeout
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError(method)
            try:
                message = self.messages.get(timeout=min(5, remaining))
            except queue.Empty:
                continue
            if message is None:
                raise RuntimeError("Server ended before reply")
            if message.get("id") == request_id and ("result" in message or "error" in message):
                if "error" in message:
                    sanitized_err = sanitize_secret_payload(message["error"])
                    err_json = sanitize_secret_payload(json.dumps(sanitized_err))
                    self.classify(err_json)
                    raise RuntimeError(f"JSON-RPC error: {err_json}")
                return message["result"]
            if "method" in message and "id" in message:
                if message["method"] == "roots/list":
                    self.send({"id": message["id"], "result": {"roots": [{"uri": self.project_dir.as_uri(), "name": self.project_dir.name}]}})
                elif message["method"] == "ping":
                    self.send({"id": message["id"], "result": {}})
                else:
                    self.send({"id": message["id"], "error": {"code": -32601, "message": "Unsupported client method"}})

    def start(self):
        self.request("initialize", {"protocolVersion": "2025-06-18", "capabilities": {"roots": {"listChanged": False}}, "clientInfo": {"name": "ctx-smoke", "version": "1.0"}})
        self.send({"method": "notifications/initialized"})
        tools = self.request("tools/list", {}).get("tools", [])
        self.tools = {tool["name"]: tool for tool in tools}

    def call(self, name: str, arguments: dict):
        if name not in self.tools:
            if self.name == "jcodemunch" and "order" in self.tools:
                result = self.call("order", {"action": name, "args": arguments, "allow_state_change": name in ("index_folder", "index_repo")})
                return result.get("result", result) if isinstance(result, dict) else result
            raise RuntimeError(f"Required tool unavailable: {name}")
        schema = self.tools[name].get("inputSchema", {})
        allowed = schema.get("properties", {})
        args = {k: v for k, v in arguments.items() if k in allowed}
        result = self.request("tools/call", {"name": name, "arguments": args})
        if result.get("isError"):
            self.classify(json.dumps(result))
            raise RuntimeError("MCP tool returned error")
        if result.get("structuredContent") is not None:
            sc = result["structuredContent"]
            if isinstance(sc, dict) and "result" in sc and isinstance(sc["result"], str):
                try:
                    return json.loads(sc["result"])
                except json.JSONDecodeError:
                    pass
            return sc
        texts = [item["text"] for item in result.get("content", []) if item.get("type") == "text"]
        for text in texts:
            try:
                return json.loads(text)
            except json.JSONDecodeError:
                if text.startswith("#MUNCH"):
                    return text
                self.classify(text)
        if texts:
            return texts[0]
        raise RuntimeError("No structured symbol result")

    def close(self) -> str:
        try:
            self.process.stdin.close()
            self.process.wait(timeout=10)
            return "exited"
        except Exception:
            subprocess.run(["taskkill", "/PID", str(self.process.pid), "/T", "/F"], capture_output=True)
            return "terminated"


def functions_in(value, group=None) -> set:
    found = set()
    if isinstance(value, str):
        if value.startswith("#MUNCH"):
            for line in value.splitlines():
                if line.startswith("s,"):
                    parts = line.split(",")
                    if len(parts) >= 4 and parts[3].lower() in ("function",):
                        found.add(parts[2])
        else:
            try:
                found.update(functions_in(json.loads(value), group))
            except json.JSONDecodeError:
                if group in ("Function", "function") and re.fullmatch(r"[A-Za-z_$][\w$]*", value):
                    found.add(value)
    elif isinstance(value, list):
        for item in value:
            found.update(functions_in(item, group))
    elif isinstance(value, dict):
        if "result" in value and len(value) == 1:
            found.update(functions_in(value["result"], group))
        kind = value.get("kind", group)
        if kind in (12, "Function", "function"):
            name = value.get("name") or value.get("name_path")
            if isinstance(name, str):
                found.add(re.sub(r"\[\d+\]$", "", name.split("/")[-1]))
        for key, item in value.items():
            if key != "result":
                found.update(functions_in(item, key if key in ("Function", "function") else group))
    return found


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
                "function_count": len(found),
                "response_tokens": resp_tokens,
                "whole_file_tokens": whole_file_tokens,
                "token_savings_pct": reduction_pct,
                "token_comparison": f"{resp_tokens} MCP tokens vs {whole_file_tokens} whole file tokens ({reduction_pct}% reduction)",
            })
            print(f"{name}: PASS; tools={len(server.tools)}; functions={len(found)}; {resp_tokens} tokens vs {whole_file_tokens} whole-file ({reduction_pct}% reduction)", flush=True)
        except Exception as error:
            all_passed = False
            safe_err = sanitize_secret_payload(f"{type(error).__name__}: {error}")
            result.update({"error": safe_err, "diagnostics": sorted(server.diagnostics)})
            print(f"{name}: FAIL; {safe_err}", file=sys.stderr, flush=True)
        finally:
            result["shutdown"] = server.close()
            results["servers"][name] = result

    results_path.write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")
    print(f"Results written to temporary path: {results_path}", flush=True)
    return 0 if all_passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
