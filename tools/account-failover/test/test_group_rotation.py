import importlib.util
import json
import logging
import os
import pathlib
import sys
import tempfile
import unittest
from unittest import mock


MODULE_PATH = pathlib.Path(__file__).parents[1] / "controller.py"
SPEC = importlib.util.spec_from_file_location("account_failover_controller", MODULE_PATH)
controller_module = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
sys.modules[SPEC.name] = controller_module
SPEC.loader.exec_module(controller_module)


def make_group(name, models, cooldown=60):
    return {"name": name, "models": models, "cooldown_seconds": cooldown}


def account_with_groups(name, priority=1, groups=None):
    """Account fixture with quota_groups."""
    if groups is None:
        groups = [
            make_group("gemini", ["gemini-3.1-pro-high", "gemini-3.8-flash-high"]),
            make_group("external", ["claude-opus-4-6-thinking", "gpt-oss-120b-medium"]),
        ]
    return {
        "name": name,
        "type": "api_key",
        "credential_ref": f"KEY_{name.upper()}",
        "priority": priority,
        "enabled": True,
        "cooldown_seconds": 60,
        "quota_groups": groups,
        "metadata": {"endpoint": "http://127.0.0.1.invalid/generate"},
    }


def legacy_account(name, priority=1):
    """Account fixture without quota_groups (legacy behaviour)."""
    return {
        "name": name,
        "type": "api_key",
        "credential_ref": f"KEY_{name.upper()}",
        "priority": priority,
        "enabled": True,
        "cooldown_seconds": 60,
        "metadata": {"endpoint": "http://127.0.0.1.invalid/generate"},
    }


class GroupRotationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.temp.name)
        self.config_path = self.root / "accounts.json"
        os.environ["KEY_A"] = "secret-a"
        os.environ["KEY_B"] = "secret-b"

    def tearDown(self):
        os.environ.pop("KEY_A", None)
        os.environ.pop("KEY_B", None)
        for logger in list(logging.Logger.manager.loggerDict.values()):
            if not isinstance(logger, logging.Logger):
                continue
            for handler in list(logger.handlers):
                if str(getattr(handler, "baseFilename", "")).startswith(str(self.root)):
                    logger.removeHandler(handler)
                    handler.close()
        self.temp.cleanup()

    def write_config(self, accounts, strategy="priority_failover"):
        self.config_path.write_text(json.dumps({
            "strategy": strategy, "state_path": "state.json",
            "log_path": "controller.log", "accounts": accounts,
        }), encoding="utf-8")

    def build(self):
        return controller_module.AccountFailoverController(self.config_path)

    # ── Group exhaustion order ──────────────────────────────────────────

    def test_exhausts_gemini_then_external_before_next_account(self):
        """Quota on gemini group -> try external group on SAME account."""
        self.write_config([account_with_groups("a"), account_with_groups("b", 2)])
        ctl = self.build()
        quota = controller_module.ClassifiedError("quota", "429", cooldown=True)
        # gemini quota -> external succeeds
        with mock.patch.object(ctl, "_send_with", side_effect=[quota, "ok"]) as send:
            result = ctl.send_prompt("hello")
        self.assertEqual(result["account"], "a")
        self.assertEqual(result["group"], "external")
        # Both calls were to account "a" — never moved to "b"
        self.assertEqual([c.args[0]["name"] for c in send.call_args_list], ["a", "a"])

    def test_moves_to_next_account_only_when_all_groups_spent(self):
        """Both groups on account a get quota -> try account b."""
        self.write_config([account_with_groups("a"), account_with_groups("b", 2)])
        ctl = self.build()
        quota = controller_module.ClassifiedError("quota", "429", cooldown=True)
        # a-gemini quota, a-external quota, b-gemini ok
        with mock.patch.object(ctl, "_send_with", side_effect=[quota, quota, "ok"]) as send:
            result = ctl.send_prompt("hello")
        self.assertEqual(result["account"], "b")
        self.assertEqual(result["group"], "gemini")
        accounts_tried = [c.args[0]["name"] for c in send.call_args_list]
        self.assertEqual(accounts_tried, ["a", "a", "b"])

    # ── Group cooldown is per-group, not per-account ────────────────────

    def test_group_cooldown_is_per_group(self):
        """Quota error cooldowns the specific group, not the whole account."""
        self.write_config([account_with_groups("a")])
        ctl = self.build()
        quota = controller_module.ClassifiedError("quota", "429", cooldown=True)
        with mock.patch.object(ctl, "_send_with", side_effect=[quota, "ok"]):
            ctl.send_prompt("hello")
        # gemini group should be on cooldown
        gs = ctl.state.group_state("a", "gemini")
        self.assertIsNotNone(gs["cooldown_until"])
        # account itself should NOT be on cooldown
        self.assertIsNone(ctl.state.account("a")["cooldown_until"])

    # ── Authentication disables the whole account ───────────────────────

    def test_auth_error_in_group_disables_account(self):
        """A 401 on gemini group disables the whole account, moves to next."""
        self.write_config([account_with_groups("a"), account_with_groups("b", 2)])
        ctl = self.build()
        auth = controller_module.ClassifiedError("authentication", "401", disable=True)
        with mock.patch.object(ctl, "_send_with", side_effect=[auth, "ok"]):
            result = ctl.send_prompt("hello")
        self.assertEqual(result["account"], "b")
        self.assertTrue(ctl.state.account("a")["credential_check_required"])

    # ── Network retry within a group ────────────────────────────────────

    def test_network_retries_once_within_group(self):
        """Network error retries once on same group, then moves to next group."""
        self.write_config([account_with_groups("a")])
        ctl = self.build()
        net = controller_module.ClassifiedError("network", "offline", retry_same_account=True)
        # retry once, then cooldown group, then next group succeeds
        with mock.patch.object(ctl, "_send_with", side_effect=[net, net, "ok"]) as send:
            result = ctl.send_prompt("hello")
        self.assertEqual(result["account"], "a")
        self.assertEqual(result["group"], "external")
        self.assertEqual(len(send.call_args_list), 3)

    # ── Legacy accounts without groups ──────────────────────────────────

    def test_legacy_account_works_unchanged(self):
        """Accounts without quota_groups follow the original single-level path."""
        self.write_config([legacy_account("a"), legacy_account("b", 2)])
        ctl = self.build()
        quota = controller_module.ClassifiedError("quota", "429", cooldown=True)
        with mock.patch.object(ctl, "_send_with", side_effect=[quota, "ok"]):
            result = ctl.send_prompt("hello")
        self.assertEqual(result["account"], "b")
        # Legacy: no group key in result
        self.assertNotIn("group", result)

    # ── NoAccountAvailable ──────────────────────────────────────────────

    def test_all_groups_all_accounts_spent_raises(self):
        """When every group on every account is spent -> NoAccountAvailable."""
        self.write_config([account_with_groups("a")])
        ctl = self.build()
        quota = controller_module.ClassifiedError("quota", "429", cooldown=True)
        with mock.patch.object(ctl, "_send_with", side_effect=[quota, quota]):
            with self.assertRaises(controller_module.NoAccountAvailable):
                ctl.send_prompt("hello")

    # ── Config validation ───────────────────────────────────────────────

    def test_validates_quota_groups_structure(self):
        """Config validation rejects malformed quota_groups."""
        # empty groups array
        self.write_config([account_with_groups("a", groups=[])])
        with self.assertRaises(controller_module.ConfigError):
            self.build()

        # missing models
        bad_group = {"name": "bad"}
        self.write_config([account_with_groups("a", groups=[bad_group])])
        with self.assertRaises(controller_module.ConfigError):
            self.build()

        # duplicate group names
        dup = [make_group("gemini", ["m1"]), make_group("gemini", ["m2"])]
        self.write_config([account_with_groups("a", groups=dup)])
        with self.assertRaises(controller_module.ConfigError):
            self.build()

    # ── Result includes group and model ─────────────────────────────────

    def test_result_includes_group_and_model(self):
        """Successful result includes group name and model for traceability."""
        self.write_config([account_with_groups("a")])
        ctl = self.build()
        with mock.patch.object(ctl, "_send_with", return_value="ok"):
            result = ctl.send_prompt("hello")
        self.assertEqual(result["group"], "gemini")
        self.assertEqual(result["model"], "gemini-3.1-pro-high")
        self.assertEqual(result["result"], "ok")

    # ── Health check shows group state ──────────────────────────────────

    def test_health_check_includes_group_status(self):
        """health_check returns group cooldown info."""
        self.write_config([account_with_groups("a")])
        ctl = self.build()
        info = ctl.health_check("a")
        self.assertIn("groups", info)
        self.assertEqual(len(info["groups"]), 2)
        self.assertEqual(info["groups"][0]["name"], "gemini")
        self.assertIsNone(info["groups"][0]["cooldown_until"])

    # ── Mixed accounts: groups and legacy ───────────────────────────────

    def test_mixed_group_and_legacy_accounts(self):
        """First account has groups, second is legacy. Both work."""
        self.write_config([
            account_with_groups("a"),
            legacy_account("b", 2),
        ])
        ctl = self.build()
        quota = controller_module.ClassifiedError("quota", "429", cooldown=True)
        # a-gemini quota, a-external quota, then b (legacy) succeeds
        with mock.patch.object(ctl, "_send_with", side_effect=[quota, quota, "ok"]):
            result = ctl.send_prompt("hello")
        self.assertEqual(result["account"], "b")
        self.assertNotIn("group", result)


if __name__ == "__main__":
    unittest.main()
