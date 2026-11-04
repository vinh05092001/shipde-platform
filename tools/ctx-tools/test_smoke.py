"""Unit tests for tools/ctx-tools acceptance criteria (AC-AI-158-ctx-01..03)."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

PYTHON_EXE = sys.executable
THIS_DIR = Path(__file__).resolve().parent
REPO_ROOT = THIS_DIR.parents[1]
SMOKE_SCRIPT = THIS_DIR / "smoke.py"
TEMPLATE_PATH = THIS_DIR / "mcp-entries.template.json"
CANARY = "CANARY_SECRET_158"


class TestCtxSmokeAcceptance(unittest.TestCase):
    def test_ac_ai_158_ctx_01_versioned_mcp_entries_template(self):
        """AC-AI-158-ctx-01: Versioned template with jcodemunch and serena definitions and safe roots."""
        self.assertTrue(TEMPLATE_PATH.exists(), f"Missing template: {TEMPLATE_PATH}")
        raw = TEMPLATE_PATH.read_text(encoding="utf-8")
        data = json.loads(raw)
        self.assertIn("jcodemunch", data)
        self.assertIn("serena", data)
        for name in ("jcodemunch", "serena"):
            entry = data[name]
            self.assertIn("command", entry)
            self.assertIn("args", entry)
            self.assertIsInstance(entry["args"], list)
        self.assertIn("${CTX_TOOLS_ROOT}", raw)

    def test_ac_ai_158_ctx_02_attach_dry_run_or_scope(self):
        """AC-AI-158-ctx-02: attach.py installer is absent from repo to keep pure dry-run smoke scope."""
        forbidden_installer = THIS_DIR / "attach.py"
        self.assertFalse(forbidden_installer.exists(), f"{forbidden_installer} must not be present in repository")

    def test_ac_ai_158_ctx_03_smoke_never_prints_credential_values(self):
        """AC-AI-158-ctx-03: Sensitive keys and error payloads are sanitized recursively and allowlisted."""
        sys.path.insert(0, str(THIS_DIR))
        try:
            from smoke import sanitize_secret_payload, JsonRpcError
        finally:
            sys.path.pop(0)

        # 1. In-memory recursive sanitization
        payload = {
            "access_token": "secret-access-token",
            "Authorization": "Bearer not-real",
            "nested": {
                "client_secret": "nested-secret",
                "items": [{"cookie": "sess-cookie"}],
            },
            "message": "Auth failure: password=my_password",
            "harmless": "ok",
        }
        sanitized = sanitize_secret_payload(payload)
        serialized = json.dumps(sanitized)
        self.assertNotIn("secret-access-token", serialized)
        self.assertNotIn("nested-secret", serialized)
        self.assertNotIn("sess-cookie", serialized)
        self.assertNotIn("my_password", serialized)
        self.assertEqual(sanitized["harmless"], "ok")

        # 2. Strict allowlisting on JSON-RPC error dictionaries: code (int) and category only
        err_payload = {"code": -32603, "message": "Canary message with password=supersecret", "data": {"token": "xyz"}}
        err_sanitized = sanitize_secret_payload(err_payload)
        self.assertEqual(err_sanitized, {"code": -32603, "category": "Internal error"})
        self.assertNotIn("supersecret", json.dumps(err_sanitized))
        self.assertNotIn("xyz", json.dumps(err_sanitized))

        # 3. Subprocess verification: smoke.py run against failing server never leaks CANARY
        tmp_base = REPO_ROOT / ".oc" / "tmp"
        tmp_base.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=tmp_base) as tmp_dir:
            tmp_path = Path(tmp_dir)
            fake_server = tmp_path / "fake_server.py"
            fake_server.write_text(
                'import sys, json\n'
                'for line in sys.stdin:\n'
                '    try:\n'
                '        req = json.loads(line)\n'
                '        rid = req.get("id")\n'
                '        if rid is not None:\n'
                '            err = {"jsonrpc": "2.0", "id": rid, "error": {"code": -32000, "message": "Auth failure CANARY_SECRET_158"}}\n'
                '            sys.stdout.write(json.dumps(err) + "\\n")\n'
                '            sys.stdout.flush()\n'
                '    except Exception:\n'
                '        pass\n',
                encoding="utf-8",
            )
            entries_file = tmp_path / "entries.json"
            entries_file.write_text(
                json.dumps({"fake": {"command": PYTHON_EXE, "args": [str(fake_server)]}}),
                encoding="utf-8",
            )
            out_dir = tmp_path / "out"
            out_dir.mkdir(parents=True, exist_ok=True)

            proc = subprocess.run(
                [PYTHON_EXE, str(SMOKE_SCRIPT), "--entries", str(entries_file), "--out-dir", str(out_dir), "--project", str(REPO_ROOT)],
                capture_output=True,
                text=True,
                encoding="utf-8",
            )
            self.assertNotEqual(proc.returncode, 0)
            self.assertNotIn(CANARY, proc.stdout)
            self.assertNotIn(CANARY, proc.stderr)
            res_file = out_dir / "smoke-results.json"
            if res_file.exists():
                self.assertNotIn(CANARY, res_file.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
