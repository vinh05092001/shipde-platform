"""Unit tests for tools/ctx-tools: toolkit.json registry, prompt-block.js, and MCP attachment."""
import json
from pathlib import Path
import subprocess
import sys
import unittest

TOOLS_DIR = Path(__file__).resolve().parent
REPO_ROOT = TOOLS_DIR.parents[1]
TOOLKIT_PATH = TOOLS_DIR / "toolkit.json"
PROMPT_BLOCK_SCRIPT = TOOLS_DIR / "prompt-block.js"
ATTACH_SCRIPT = TOOLS_DIR / "attach.py"

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

    def test_attach_dry_run_covers_all_mcp_tools_for_all_clients(self):
        from attach import load_servers
        servers = load_servers(TOOLS_DIR, "C:/Tools/ctx-tools")

        mcp_tools = [t for t in self.tools if t.get("type") == "mcp"]
        self.assertGreaterEqual(len(mcp_tools), 2, "Expected at least jcodemunch and serena MCP servers")

        for mcp in mcp_tools:
            self.assertIn(mcp["id"], servers, f"load_servers did not load MCP tool: {mcp['id']}")
            entry = servers[mcp["id"]]
            self.assertIn("command", entry)
            self.assertIn("args", entry)
            self.assertIn("env", entry)


if __name__ == "__main__":
    unittest.main()
