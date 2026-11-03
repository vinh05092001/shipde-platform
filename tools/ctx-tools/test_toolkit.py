"""Unit tests for tools/ctx-tools: toolkit.json registry, prompt-block.js, and the shipped MCP template."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

TOOLS_DIR = Path(__file__).resolve().parent
REPO_ROOT = TOOLS_DIR.parents[1]
TOOLKIT_PATH = TOOLS_DIR / "toolkit.json"
PROMPT_BLOCK_SCRIPT = TOOLS_DIR / "prompt-block.js"
MCP_TEMPLATE_PATH = TOOLS_DIR / "mcp-entries.template.json"
TEST_SUITE_SCRIPT = TOOLS_DIR / "test_toolkit.py"

FORBIDDEN_APP_LIBRARIES = {
    "nestjs", "nest", "@nestjs/core", "prisma", "@prisma/client",
    "vitest", "storybook", "@storybook/react", "next", "react",
    "bullmq", "supertest", "msw", "openapi-typescript", "lighthouse"
}


class TestToolkitRegistry(unittest.TestCase):
    def setUp(self):
        self.assertTrue(TOOLKIT_PATH.exists(), f"Missing {TOOLKIT_PATH}")
        self.raw = TOOLKIT_PATH.read_text(encoding="utf-8")
        self.data = json.loads(self.raw)
        self.tools = self.data.get("tools", [])

    def test_toolkit_json_structure_and_allowed_types(self):
        self.assertIsInstance(self.tools, list)
        self.assertGreaterEqual(len(self.tools), 5, "toolkit.json should register agent tools")

        tool_ids = set()
        for tool in self.tools:
            self.assertIn("id", tool)
            self.assertIn("version", tool)
            self.assertIn("caller", tool)
            self.assertIn("type", tool)
            self.assertIn("when_to_use", tool)
            self.assertIn("when_not_to_use", tool)

            self.assertIn(
                tool["type"],
                {"mcp", "cli", "node-module"},
                f"Tool {tool['id']} has invalid type: {tool['type']}"
            )

            # Application runtime libraries must not be registered here
            self.assertNotIn(
                tool["id"].lower(),
                FORBIDDEN_APP_LIBRARIES,
                f"Application library {tool['id']} must not be in agent toolkit"
            )

            tool_ids.add(tool["id"])

        self.assertEqual(len(tool_ids), len(self.tools), "Duplicate tool IDs found")

    def test_all_callers_exist_in_repository(self):
        for tool in self.tools:
            caller_rel = tool["caller"]
            caller_path = REPO_ROOT / caller_rel
            self.assertTrue(
                caller_path.exists(),
                f"Caller '{caller_rel}' for tool '{tool['id']}' does not exist in repository"
            )

    def test_prompt_block_line_count_and_contains_all_ids(self):
        res = subprocess.run(
            ["node", str(PROMPT_BLOCK_SCRIPT)],
            capture_output=True,
            text=True,
            check=True,
            cwd=str(REPO_ROOT),
        )
        output = res.stdout.strip()
        lines = [line for line in output.splitlines() if line.strip()]

        # Requirement: output must be concise (<= 25 lines)
        self.assertLessEqual(len(lines), 25, f"Prompt block exceeds 25 lines: {len(lines)}")
        self.assertIn("CÔNG CỤ CÓ SẴN:", output)

        # Output must contain every registered tool id
        for tool in self.tools:
            self.assertIn(
                tool["id"],
                output,
                f"Prompt block missing registered tool ID: {tool['id']}"
            )

    def test_mcp_tools_match_versioned_template(self):
        """Every MCP tool in toolkit.json is defined by the shipped versioned entries template."""
        self.assertTrue(MCP_TEMPLATE_PATH.exists(), f"Missing {MCP_TEMPLATE_PATH}")
        template = json.loads(MCP_TEMPLATE_PATH.read_text(encoding="utf-8"))

        mcp_tools = [t for t in self.tools if t.get("type") == "mcp"]
        self.assertGreaterEqual(len(mcp_tools), 2, "Expected at least jcodemunch and serena MCP servers")

        for mcp in mcp_tools:
            self.assertIn(mcp["id"], template, f"MCP template does not define tool: {mcp['id']}")
            entry = template[mcp["id"]]
            self.assertIn("command", entry)
            self.assertIn("args", entry)
            self.assertIn("env", entry)
            self.assertTrue(entry["command"].startswith("${CTX_TOOLS_ROOT}"), "Template must keep a portable safe root")
            self.assertIn("${CTX_TOOLS_ROOT}", entry["env"].get("CODE_INDEX_PATH", entry["env"].get("SERENA_HOME", "${CTX_TOOLS_ROOT}")))

    def test_toolkit_suite_without_attach(self):
        """The toolkit suite passes in a checkout without an obsolete `attach` module."""
        if os.environ.get("CTX_TOOLS_NO_ATTACH_CHILD") == "1":
            return  # child re-execution already proves the suite passes without attach
        with tempfile.TemporaryDirectory() as tmp_dir:
            env = dict(os.environ)
            env["CTX_TOOLS_NO_ATTACH_CHILD"] = "1"
            env["PYTHONPATH"] = tmp_dir
            res = subprocess.run(
                [sys.executable, str(TEST_SUITE_SCRIPT)],
                capture_output=True,
                text=True,
                cwd=tmp_dir,
                env=env,
            )
        self.assertEqual(res.returncode, 0, f"test_toolkit.py failed without attach: {res.stdout}\n{res.stderr}")


if __name__ == "__main__":
    unittest.main()
