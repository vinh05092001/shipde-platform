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


if __name__ == "__main__":
    unittest.main()
