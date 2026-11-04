"""Unit test proving smoke_redacts_jsonrpc_error_payload for tools/ctx-tools/smoke.py."""
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
CANARY = "CANARY_SECRET_158"


class TestSmokeRedaction(unittest.TestCase):
    def test_smoke_redacts_jsonrpc_error_payload(self):
        """Asserts nonzero exit and complete absence of CANARY_SECRET_158 from stdout, stderr, and results JSON."""
        tmp_base = REPO_ROOT / ".oc" / "tmp"
        tmp_base.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=tmp_base) as tmp_dir:
            tmp_path = Path(tmp_dir)

            # 1. Create a fake stdio MCP server script that responds with a secret-bearing error
            fake_server_script = tmp_path / "fake_mcp_server.py"
            fake_server_script.write_text(
                'import sys, json\n'
                'for line in sys.stdin:\n'
                '    try:\n'
                '        req = json.loads(line)\n'
                '        req_id = req.get("id")\n'
                '        if req_id is not None:\n'
                '            err_resp = {\n'
                '                "jsonrpc": "2.0",\n'
                '                "id": req_id,\n'
                f'               "error": {{"code": -32000, "message": "Auth failure: password={CANARY}"}}\n'
                '            }\n'
                '            sys.stdout.write(json.dumps(err_resp) + "\\n")\n'
                '            sys.stdout.flush()\n'
                '    except Exception:\n'
                '        pass\n',
                encoding="utf-8",
            )

            # 2. Create custom entries config pointing to this fake server
            entries_file = tmp_path / "entries.json"
            entries_file.write_text(
                json.dumps({
                    "fake_server": {
                        "command": PYTHON_EXE,
                        "args": [str(fake_server_script)],
                    }
                }),
                encoding="utf-8",
            )

            out_dir = tmp_path / "out"
            out_dir.mkdir(parents=True, exist_ok=True)

            # 3. Run smoke.py CLI
            proc = subprocess.run(
                [
                    PYTHON_EXE,
                    str(SMOKE_SCRIPT),
                    "--entries", str(entries_file),
                    "--out-dir", str(out_dir),
                    "--project", str(REPO_ROOT),
                ],
                capture_output=True,
                text=True,
                encoding="utf-8",
            )

            stdout = proc.stdout
            stderr = proc.stderr

            results_json = ""
            results_file = out_dir / "smoke-results.json"
            if results_file.exists():
                results_json = results_file.read_text(encoding="utf-8")

            # Must exit non-zero on failure
            self.assertNotEqual(proc.returncode, 0, "smoke.py must exit non-zero when server fails")

            # CANARY_SECRET_158 must NOT leak in stdout
            self.assertNotIn(
                CANARY,
                stdout,
                f"Secret {CANARY} leaked in smoke.py stdout: {stdout}",
            )

            # CANARY_SECRET_158 must NOT leak in stderr
            self.assertNotIn(
                CANARY,
                stderr,
                f"Secret {CANARY} leaked in smoke.py stderr: {stderr}",
            )

            # CANARY_SECRET_158 must NOT leak in results JSON
            if results_json:
                self.assertNotIn(
                    CANARY,
                    results_json,
                    f"Secret {CANARY} leaked in smoke-results.json: {results_json}",
                )

    def test_rpc_error_credentials_never_reach_diagnostics(self):
        """Credential shapes (camelCase keys, quoted password) must never reach stderr or smoke-results.json."""
        credential = "opaque-credential-158"
        password = "smoke-test-password-158"
        cases = {
            "camel_case_access_token": (
                '{"code": -32603, "message": "request failed", '
                '"data": {"accessToken": "%s"}}' % credential
            ),
            "quoted_password_in_message": (
                '{"code": -32603, '
                '"message": "Auth failure: \\"password\\": \\"%s\\""}' % password
            ),
        }
        tmp_base = REPO_ROOT / ".oc" / "tmp"
        tmp_base.mkdir(parents=True, exist_ok=True)
        for case_name, error_body in cases.items():
            with self.subTest(case=case_name):
                with tempfile.TemporaryDirectory(dir=tmp_base) as tmp_dir:
                    tmp_path = Path(tmp_dir)

                    fake_server_script = tmp_path / "fake_mcp_server.py"
                    fake_server_script.write_text(
                        'import sys, json\n'
                        'for line in sys.stdin:\n'
                        '    try:\n'
                        '        req = json.loads(line)\n'
                        '        req_id = req.get("id")\n'
                        '        if req_id is not None:\n'
                        '            err_resp = {\n'
                        '                "jsonrpc": "2.0",\n'
                        '                "id": req_id,\n'
                        f'                "error": {error_body},\n'
                        '            }\n'
                        '            sys.stdout.write(json.dumps(err_resp) + "\\n")\n'
                        '            sys.stdout.flush()\n'
                        '    except Exception:\n'
                        '        pass\n',
                        encoding="utf-8",
                    )

                    entries_file = tmp_path / "entries.json"
                    entries_file.write_text(
                        json.dumps({
                            "fake_server": {
                                "command": PYTHON_EXE,
                                "args": [str(fake_server_script)],
                            }
                        }),
                        encoding="utf-8",
                    )

                    out_dir = tmp_path / "out"
                    out_dir.mkdir(parents=True, exist_ok=True)

                    proc = subprocess.run(
                        [
                            PYTHON_EXE,
                            str(SMOKE_SCRIPT),
                            "--entries", str(entries_file),
                            "--out-dir", str(out_dir),
                            "--project", str(REPO_ROOT),
                        ],
                        capture_output=True,
                        text=True,
                        encoding="utf-8",
                    )

                    results_json = ""
                    results_file = out_dir / "smoke-results.json"
                    if results_file.exists():
                        results_json = results_file.read_text(encoding="utf-8")

                    self.assertNotEqual(proc.returncode, 0, "smoke.py must exit non-zero when server fails")
                    self.assertIn("Internal error", proc.stderr, f"category missing: {proc.stderr}")
                    self.assertIn("Internal error", results_json, f"category missing: {results_json}")
                    secret = credential if case_name == "camel_case_access_token" else password
                    self.assertNotIn(secret, proc.stderr, "credential value leaked in stderr")
                    self.assertNotIn(secret, results_json, "credential value leaked in smoke-results.json")

    def test_rpc_access_token_never_reaches_diagnostics(self):
        """Underscore-joined secret keys in JSON-RPC error data must be redacted before printing."""
        tmp_base = REPO_ROOT / ".oc" / "tmp"
        tmp_base.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=tmp_base) as tmp_dir:
            tmp_path = Path(tmp_dir)

            fake_server_script = tmp_path / "fake_mcp_server.py"
            fake_server_script.write_text(
                'import sys, json\n'
                'for line in sys.stdin:\n'
                '    try:\n'
                '        req = json.loads(line)\n'
                '        req_id = req.get("id")\n'
                '        if req_id is not None:\n'
                '            err_resp = {\n'
                '                "jsonrpc": "2.0",\n'
                '                "id": req_id,\n'
                '                "error": {"code": -32603, "message": "request failed",\n'
                '                          "data": {"access_token": "smoke-test-value",\n'
                '                                   "nested": {"client_secret": "x"}}},\n'
                '            }\n'
                '            sys.stdout.write(json.dumps(err_resp) + "\\n")\n'
                '            sys.stdout.flush()\n'
                '    except Exception:\n'
                '        pass\n',
                encoding="utf-8",
            )

            entries_file = tmp_path / "entries.json"
            entries_file.write_text(
                json.dumps({
                    "fake_server": {
                        "command": PYTHON_EXE,
                        "args": [str(fake_server_script)],
                    }
                }),
                encoding="utf-8",
            )

            out_dir = tmp_path / "out"
            out_dir.mkdir(parents=True, exist_ok=True)

            proc = subprocess.run(
                [
                    PYTHON_EXE,
                    str(SMOKE_SCRIPT),
                    "--entries", str(entries_file),
                    "--out-dir", str(out_dir),
                    "--project", str(REPO_ROOT),
                ],
                capture_output=True,
                text=True,
                encoding="utf-8",
            )

            results_json = ""
            results_file = out_dir / "smoke-results.json"
            if results_file.exists():
                results_json = results_file.read_text(encoding="utf-8")

            self.assertNotEqual(proc.returncode, 0, "smoke.py must exit non-zero when server fails")
            self.assertIn("JSON-RPC error", proc.stderr, f"secret-bearing response must be exercised: {proc.stderr}")
            self.assertNotIn("smoke-test-value", proc.stderr, "access_token value leaked in stderr")
            self.assertNotIn("smoke-test-value", results_json, "access_token value leaked in smoke-results.json")
            self.assertNotIn("test-not-a-secret", proc.stderr, "client_secret value leaked in stderr")
            self.assertNotIn("test-not-a-secret", results_json, "client_secret value leaked in smoke-results.json")
            self.assertNotIn('"client_secret": "x"', proc.stderr, "client_secret value leaked in stderr")
            self.assertNotIn('"client_secret": "x"', results_json, "client_secret value leaked in smoke-results.json")
            self.assertNotIn('"x"', proc.stderr, "client_secret value leaked in stderr")

    def test_sanitize_redacts_nested_sensitive_keys_in_memory(self):
        """AC-AI-158-ctx-03: the sanitizer itself redacts nested dict/list keys before any print path."""
        sys.path.insert(0, str(THIS_DIR))
        try:
            from smoke import sanitize_secret_payload
        finally:
            sys.path.pop(0)

        payload = {
            "access_token": "smoke-test-value",
            "refresh_token": "refresh-not-real",
            "api_key": "not-a-key",
            "API-KEY": "not-a-key",
            "clientSecret": "smoke-test-camel",
            "nested": {
                "client_secret": "x",
                "items": [{"Authorization": "Bearer not-real"}, {"cookie": "session-not-real"}],
            },
            "message": "Auth failure: password smoke-test-password",
            "tool_count": 7,
            "author": "tester",
            "monkey": "harmless",
            "s": 1,
        }
        sanitized = sanitize_secret_payload(payload)

        self.assertNotIn("smoke-test-value", json.dumps(sanitized))
        self.assertNotIn("refresh-not-real", json.dumps(sanitized))
        self.assertNotIn("not-a-key", json.dumps(sanitized))
        self.assertNotIn("smoke-test-camel", json.dumps(sanitized))
        self.assertNotIn('"x"', json.dumps(sanitized))
        self.assertNotIn("not-real", json.dumps(sanitized))
        self.assertEqual(sanitized["tool_count"], 7)
        self.assertEqual(sanitized["author"], "tester")
        self.assertEqual(sanitized["monkey"], "harmless")
        self.assertEqual(sanitized["s"], 1)

    def test_smoke_end_to_end_nested_credentials_never_printed(self):
        """AC-AI-158-ctx-03: nested credential keys in JSON-RPC error data never reach stderr or results JSON."""
        tmp_base = REPO_ROOT / ".oc" / "tmp"
        tmp_base.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=tmp_base) as tmp_dir:
            tmp_path = Path(tmp_dir)

            fake_server_script = tmp_path / "fake_mcp_server.py"
            fake_server_script.write_text(
                'import sys, json\n'
                'for line in sys.stdin:\n'
                '    try:\n'
                '        req = json.loads(line)\n'
                '        req_id = req.get("id")\n'
                '        if req_id is not None:\n'
                '            err_resp = {\n'
                '                "jsonrpc": "2.0",\n'
                '                "id": req_id,\n'
                '                "error": {"code": -32603, "message": "request failed",\n'
                '                          "data": {"refresh_token": "refresh-not-real",\n'
                '                                   "api_key": "not-a-key",\n'
                '                                   "clientSecret": "camel-not-real",\n'
                '                                   "nested": {"client_secret": "x", "items": [{"credential": "cred-not-real"}]},\n'
                '                                   "access_token": "smoke-test-value"}},\n'
                '            }\n'
                '            sys.stdout.write(json.dumps(err_resp) + "\\n")\n'
                '            sys.stdout.flush()\n'
                '    except Exception:\n'
                '        pass\n',
                encoding="utf-8",
            )

            entries_file = tmp_path / "entries.json"
            entries_file.write_text(
                json.dumps({
                    "fake_server": {
                        "command": PYTHON_EXE,
                        "args": [str(fake_server_script)],
                    }
                }),
                encoding="utf-8",
            )

            out_dir = tmp_path / "out"
            out_dir.mkdir(parents=True, exist_ok=True)

            proc = subprocess.run(
                [
                    PYTHON_EXE,
                    str(SMOKE_SCRIPT),
                    "--entries", str(entries_file),
                    "--out-dir", str(out_dir),
                    "--project", str(REPO_ROOT),
                ],
                capture_output=True,
                text=True,
                encoding="utf-8",
            )

            results_json = ""
            results_file = out_dir / "smoke-results.json"
            if results_file.exists():
                results_json = results_file.read_text(encoding="utf-8")

            self.assertNotEqual(proc.returncode, 0, "smoke.py must exit non-zero when server fails")
            self.assertIn("JSON-RPC error", proc.stderr, f"secret-bearing response must be exercised: {proc.stderr}")
            combined = proc.stdout + proc.stderr + results_json
            for leaked in ("smoke-test-value", "refresh-not-real", "not-a-key", "camel-not-real", "cred-not-real"):
                self.assertNotIn(leaked, combined, f"credential value {leaked} leaked")
            self.assertNotIn('"x"', combined, "client_secret value x leaked")
            self.assertIn("Internal error", combined, "category missing")

    def test_basic_authorization_error_is_fully_redacted(self):
        """Review 2: Basic authorization error payload must be fully redacted."""
        sys.path.insert(0, str(THIS_DIR))
        try:
            from smoke import sanitize_secret_payload
        finally:
            sys.path.pop(0)

        raw_auth = "Authorization: Basic dXNlcjpwYXNz"
        sanitized = sanitize_secret_payload(raw_auth)
        self.assertEqual(sanitized, "Authorization: [REDACTED]")

        tmp_base = REPO_ROOT / ".oc" / "tmp"
        tmp_base.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=tmp_base) as tmp_dir:
            tmp_path = Path(tmp_dir)

            fake_server_script = tmp_path / "fake_mcp_server.py"
            fake_server_script.write_text(
                'import sys, json\n'
                'for line in sys.stdin:\n'
                '    try:\n'
                '        req = json.loads(line)\n'
                '        req_id = req.get("id")\n'
                '        if req_id is not None:\n'
                '            err_resp = {\n'
                '                "jsonrpc": "2.0",\n'
                '                "id": req_id,\n'
                '                "error": {"code": -32603, "message": "Authorization: Basic dXNlcjpwYXNz", "data": {"access_token": "smoke-test-token"}}\n'
                '            }\n'
                '            sys.stdout.write(json.dumps(err_resp) + "\\n")\n'
                '            sys.stdout.flush()\n'
                '    except Exception:\n'
                '        pass\n',
                encoding="utf-8",
            )

            entries_file = tmp_path / "entries.json"
            entries_file.write_text(
                json.dumps({
                    "fake_server": {
                        "command": PYTHON_EXE,
                        "args": [str(fake_server_script)],
                    }
                }),
                encoding="utf-8",
            )

            out_dir = tmp_path / "out"
            out_dir.mkdir(parents=True, exist_ok=True)

            proc = subprocess.run(
                [
                    PYTHON_EXE,
                    str(SMOKE_SCRIPT),
                    "--entries", str(entries_file),
                    "--out-dir", str(out_dir),
                    "--project", str(REPO_ROOT),
                ],
                capture_output=True,
                text=True,
                encoding="utf-8",
            )

            results_json = ""
            results_file = out_dir / "smoke-results.json"
            if results_file.exists():
                results_json = results_file.read_text(encoding="utf-8")

            self.assertNotEqual(proc.returncode, 0, "smoke.py must exit non-zero when server fails")
            self.assertNotIn("dXNlcjpwYXNz", proc.stderr, "encoded credential leaked in stderr")
            self.assertNotIn("smoke-test-token", proc.stderr, "access_token leaked in stderr")
            self.assertNotIn("dXNlcjpwYXNz", results_json, "encoded credential leaked in smoke-results.json")
            self.assertNotIn("smoke-test-token", results_json, "access_token leaked in smoke-results.json")
            self.assertIn("Internal error", proc.stderr, "category missing from stderr")
            if results_json:
                self.assertIn("Internal error", results_json, "category missing from smoke-results.json")

    def test_rpc_error_allowlist_records_only_code_and_category(self):
        """Root cause #2: error payload is allowlisted to code and category only; message/data never stored/printed."""
        tmp_base = REPO_ROOT / ".oc" / "tmp"
        tmp_base.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=tmp_base) as tmp_dir:
            tmp_path = Path(tmp_dir)

            fake_server_script = tmp_path / "fake_mcp_server.py"
            fake_server_script.write_text(
                'import sys, json\n'
                'for line in sys.stdin:\n'
                '    try:\n'
                '        req = json.loads(line)\n'
                '        req_id = req.get("id")\n'
                '        if req_id is not None:\n'
                '            err_resp = {\n'
                '                "jsonrpc": "2.0",\n'
                '                "id": req_id,\n'
                '                "error": {"code": -32603, "message": "Authorization: Basic dXNlcjpwYXNz", "data": {"access_token": "t"}}\n'
                '            }\n'
                '            sys.stdout.write(json.dumps(err_resp) + "\\n")\n'
                '            sys.stdout.flush()\n'
                '    except Exception:\n'
                '        pass\n',
                encoding="utf-8",
            )

            entries_file = tmp_path / "entries.json"
            entries_file.write_text(
                json.dumps({
                    "fake_server": {
                        "command": PYTHON_EXE,
                        "args": [str(fake_server_script)],
                    }
                }),
                encoding="utf-8",
            )

            out_dir = tmp_path / "out"
            out_dir.mkdir(parents=True, exist_ok=True)

            proc = subprocess.run(
                [
                    PYTHON_EXE,
                    str(SMOKE_SCRIPT),
                    "--entries", str(entries_file),
                    "--out-dir", str(out_dir),
                    "--project", str(REPO_ROOT),
                ],
                capture_output=True,
                text=True,
                encoding="utf-8",
            )

            results_json = ""
            results_file = out_dir / "smoke-results.json"
            if results_file.exists():
                results_json = results_file.read_text(encoding="utf-8")

            self.assertNotEqual(proc.returncode, 0, "smoke.py must exit non-zero when server fails")
            self.assertNotIn("dXNlcjpwYXNz", proc.stderr, "dXNlcjpwYXNz leaked in stderr")
            self.assertNotIn("dXNlcjpwYXNz", results_json, "dXNlcjpwYXNz leaked in smoke-results.json")
            self.assertNotIn('"t"', proc.stderr, 't" leaked in stderr')
            self.assertNotIn('"t"', results_json, 't" leaked in smoke-results.json')
            self.assertIn("-32603", proc.stderr, "code must be in stderr")
            self.assertIn("Internal error", proc.stderr, "category must be in stderr")
            if results_json:
                data = json.loads(results_json)
                server_err = data["servers"]["fake_server"]["error"]
                self.assertEqual(server_err, {"code": -32603, "category": "Internal error"})

    def test_rpc_error_redacts_entire_quoted_password(self):
        """Review 3 finding 1 symptom check: quoted password with spaces must never reach stderr or smoke-results.json."""
        tmp_base = REPO_ROOT / ".oc" / "tmp"
        tmp_base.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=tmp_base) as tmp_dir:
            tmp_path = Path(tmp_dir)

            fake_server_script = tmp_path / "fake_mcp_server.py"
            fake_server_script.write_text(
                'import sys, json\n'
                'for line in sys.stdin:\n'
                '    try:\n'
                '        req = json.loads(line)\n'
                '        req_id = req.get("id")\n'
                '        if req_id is not None:\n'
                '            err_resp = {\n'
                '                "jsonrpc": "2.0",\n'
                '                "id": req_id,\n'
                '                "error": {"code": -32603, "message": \'password="alpha beta gamma"\'}\n'
                '            }\n'
                '            sys.stdout.write(json.dumps(err_resp) + "\\n")\n'
                '            sys.stdout.flush()\n'
                '    except Exception:\n'
                '        pass\n',
                encoding="utf-8",
            )

            entries_file = tmp_path / "entries.json"
            entries_file.write_text(
                json.dumps({
                    "fake_server": {
                        "command": PYTHON_EXE,
                        "args": [str(fake_server_script)],
                    }
                }),
                encoding="utf-8",
            )

            out_dir = tmp_path / "out"
            out_dir.mkdir(parents=True, exist_ok=True)

            proc = subprocess.run(
                [
                    PYTHON_EXE,
                    str(SMOKE_SCRIPT),
                    "--entries", str(entries_file),
                    "--out-dir", str(out_dir),
                    "--project", str(REPO_ROOT),
                ],
                capture_output=True,
                text=True,
                encoding="utf-8",
            )

            results_json = ""
            results_file = out_dir / "smoke-results.json"
            if results_file.exists():
                results_json = results_file.read_text(encoding="utf-8")

            self.assertNotEqual(proc.returncode, 0, "smoke.py must exit non-zero when server fails")
            self.assertNotIn("alpha", proc.stderr, "alpha leaked in stderr")
            self.assertNotIn("beta", proc.stderr, "beta leaked in stderr")
            self.assertNotIn("gamma", proc.stderr, "gamma leaked in stderr")
            self.assertNotIn("alpha", results_json, "alpha leaked in smoke-results.json")
            self.assertNotIn("beta", results_json, "beta leaked in smoke-results.json")
            self.assertNotIn("gamma", results_json, "gamma leaked in smoke-results.json")
            self.assertIn("Internal error", proc.stderr, "category must be in stderr")



if __name__ == "__main__":
    unittest.main()
