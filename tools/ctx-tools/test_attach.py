"""Unit tests for tools/ctx-tools/attach.py: dry-run, apply, backups, and idempotency."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import tomllib
import unittest

ATTACH_SCRIPT = Path(__file__).resolve().parent / "attach.py"
MOCK_ROOT = "C:/TestTools/ctx-tools"


class TestAttach(unittest.TestCase):
    def setUp(self):
        self.temp_dir_obj = tempfile.TemporaryDirectory()
        self.tmp = Path(self.temp_dir_obj.name)
        self.backup_date = "20261103"

        self.agy_path = self.tmp / "mcp_config.json"
        self.opencode_path = self.tmp / "opencode.json"
        self.codex_path = self.tmp / "config.toml"
        self.claude_path = self.tmp / ".mcp.json"

        self.initial_agy = json.dumps({
            "agy_version": "1.0",
            "mcpServers": {
                "custom_agy_tool": {"command": "echo", "args": ["hello"]}
            }
        }, indent=2) + "\n"

        self.initial_opencode = json.dumps({
            "theme": "dark",
            "mcp": {
                "existing_tool": {"type": "local", "command": ["run"], "enabled": True}
            }
        }, indent=2) + "\n"

        self.initial_codex = (
            'model = "o3-mini"\n\n'
            '[mcp_servers.existing_codex]\n'
            'command = "echo"\n'
            'args = ["codex"]\n\n'
            '[mcp_servers.existing_codex.env]\n'
            'TEST_ENV = "1"\n'
        )

        self.initial_claude = json.dumps({
            "user_pref": 42,
            "mcpServers": {
                "existing_claude": {"command": "claude_tool", "args": []}
            }
        }, indent=2) + "\n"

        self.agy_path.write_text(self.initial_agy, encoding="utf-8")
        self.opencode_path.write_text(self.initial_opencode, encoding="utf-8")
        self.codex_path.write_text(self.initial_codex, encoding="utf-8")
        self.claude_path.write_text(self.initial_claude, encoding="utf-8")

    def tearDown(self):
        self.temp_dir_obj.cleanup()

    def run_attach(self, *extra_args):
        cmd = [
            sys.executable,
            str(ATTACH_SCRIPT),
            "all",
            "--ctx-tools-root", MOCK_ROOT,
            "--backup-date", self.backup_date,
            "--agy-config", str(self.agy_path),
            "--opencode-config", str(self.opencode_path),
            "--codex-config", str(self.codex_path),
            "--claude-config", str(self.claude_path),
            *extra_args,
        ]
        return subprocess.run(cmd, capture_output=True, text=True, check=True)

    def test_dry_run_leaves_configs_unmodified_and_creates_no_backups(self):
        res = self.run_attach("--dry-run")
        self.assertIn("[DRY-RUN] agy:", res.stdout)
        self.assertIn("[DRY-RUN] opencode:", res.stdout)
        self.assertIn("[DRY-RUN] codex:", res.stdout)
        self.assertIn("[DRY-RUN] claude:", res.stdout)

        # Files must remain completely untouched
        self.assertEqual(self.agy_path.read_text(encoding="utf-8"), self.initial_agy)
        self.assertEqual(self.opencode_path.read_text(encoding="utf-8"), self.initial_opencode)
        self.assertEqual(self.codex_path.read_text(encoding="utf-8"), self.initial_codex)
        self.assertEqual(self.claude_path.read_text(encoding="utf-8"), self.initial_claude)

        # No backup files should exist
        backups = list(self.tmp.glob("*.bak-*"))
        self.assertEqual(backups, [])

    def test_apply_adds_entries_preserves_old_keys_and_creates_backups(self):
        res = self.run_attach("--apply")
        self.assertIn("PASS: backed up and updated", res.stdout)

        # 1. agy checks
        agy_backup = self.tmp / f"mcp_config.json.bak-{self.backup_date}"
        self.assertTrue(agy_backup.exists())
        self.assertEqual(agy_backup.read_text(encoding="utf-8"), self.initial_agy)
        agy_data = json.loads(self.agy_path.read_text(encoding="utf-8"))
        self.assertEqual(agy_data.get("agy_version"), "1.0")
        self.assertIn("custom_agy_tool", agy_data["mcpServers"])
        self.assertIn("jcodemunch", agy_data["mcpServers"])
        self.assertIn("serena", agy_data["mcpServers"])
        self.assertIn(MOCK_ROOT, agy_data["mcpServers"]["jcodemunch"]["command"])

        # 2. opencode checks
        opencode_backup = self.tmp / f"opencode.json.bak-{self.backup_date}"
        self.assertTrue(opencode_backup.exists())
        self.assertEqual(opencode_backup.read_text(encoding="utf-8"), self.initial_opencode)
        opencode_data = json.loads(self.opencode_path.read_text(encoding="utf-8"))
        self.assertEqual(opencode_data.get("theme"), "dark")
        self.assertIn("existing_tool", opencode_data["mcp"])
        self.assertIn("jcodemunch", opencode_data["mcp"])
        self.assertIn("serena", opencode_data["mcp"])
        self.assertEqual(opencode_data["mcp"]["jcodemunch"]["type"], "local")
        self.assertTrue(opencode_data["mcp"]["jcodemunch"]["enabled"])
        self.assertIn(MOCK_ROOT, opencode_data["mcp"]["jcodemunch"]["command"][0])

        # 3. codex checks
        codex_backup = self.tmp / f"config.toml.bak-{self.backup_date}"
        self.assertTrue(codex_backup.exists())
        self.assertEqual(codex_backup.read_text(encoding="utf-8"), self.initial_codex)
        codex_data = tomllib.loads(self.codex_path.read_text(encoding="utf-8"))
        self.assertEqual(codex_data.get("model"), "o3-mini")
        self.assertIn("existing_codex", codex_data["mcp_servers"])
        self.assertIn("jcodemunch", codex_data["mcp_servers"])
        self.assertIn("serena", codex_data["mcp_servers"])
        self.assertIn(MOCK_ROOT, codex_data["mcp_servers"]["jcodemunch"]["command"])

        # 4. claude checks
        claude_backup = self.tmp / f".mcp.json.bak-{self.backup_date}"
        self.assertTrue(claude_backup.exists())
        self.assertEqual(claude_backup.read_text(encoding="utf-8"), self.initial_claude)
        claude_data = json.loads(self.claude_path.read_text(encoding="utf-8"))
        self.assertEqual(claude_data.get("user_pref"), 42)
        self.assertIn("existing_claude", claude_data["mcpServers"])
        self.assertIn("jcodemunch", claude_data["mcpServers"])
        self.assertIn("serena", claude_data["mcpServers"])
        self.assertIn(MOCK_ROOT, claude_data["mcpServers"]["serena"]["command"])

    def test_apply_is_idempotent_when_run_twice(self):
        # First run: applies changes
        self.run_attach("--apply")

        # Capture file bytes after first apply
        agy_after_first = self.agy_path.read_bytes()
        opencode_after_first = self.opencode_path.read_bytes()
        codex_after_first = self.codex_path.read_bytes()
        claude_after_first = self.claude_path.read_bytes()

        # Second run: should be a clean no-op
        res = self.run_attach("--apply")
        self.assertIn("PASS: agy entries already match; no write", res.stdout)
        self.assertIn("PASS: opencode entries already match; no write", res.stdout)
        self.assertIn("PASS: codex entries already match; no write", res.stdout)
        self.assertIn("PASS: claude entries already match; no write", res.stdout)

        # File contents must remain byte-for-byte identical
        self.assertEqual(self.agy_path.read_bytes(), agy_after_first)
        self.assertEqual(self.opencode_path.read_bytes(), opencode_after_first)
        self.assertEqual(self.codex_path.read_bytes(), codex_after_first)
        self.assertEqual(self.claude_path.read_bytes(), claude_after_first)

    def test_apply_creates_new_configs_if_not_present(self):
        new_tmp = self.tmp / "empty_dir"
        new_tmp.mkdir()
        agy = new_tmp / "mcp_config.json"
        opencode = new_tmp / "opencode.json"
        codex = new_tmp / "config.toml"
        claude = new_tmp / ".mcp.json"

        cmd = [
            sys.executable,
            str(ATTACH_SCRIPT),
            "all",
            "--ctx-tools-root", MOCK_ROOT,
            "--backup-date", self.backup_date,
            "--agy-config", str(agy),
            "--opencode-config", str(opencode),
            "--codex-config", str(codex),
            "--claude-config", str(claude),
            "--apply",
        ]
        res = subprocess.run(cmd, capture_output=True, text=True, check=True)
        self.assertIn("PASS: backed up and updated", res.stdout)
        self.assertTrue(agy.exists())
        self.assertTrue(opencode.exists())
        self.assertTrue(codex.exists())
        self.assertTrue(claude.exists())


if __name__ == "__main__":

    unittest.main()
