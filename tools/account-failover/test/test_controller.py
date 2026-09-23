import importlib.util
import io
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


def account(name, priority=1, account_type="api_key"):
    value = {
        "name": name,
        "type": account_type,
        "credential_ref": f"KEY_{name.upper()}",
        "priority": priority,
        "enabled": True,
        "cooldown_seconds": 60,
        "metadata": {"endpoint": "http://127.0.0.1.invalid/generate"},
    }
    if account_type == "windows_user":
        value["scheduled_task_name"] = f"Task-{name}"
    return value


class ControllerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.temp.name)
        self.config_path = self.root / "accounts.json"
        self.write_config([account("a", 1), account("b", 2)])
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

    def test_rejects_duplicate_names_and_windows_user_without_task(self):
        self.write_config([account("a"), account("a")])
        with self.assertRaises(controller_module.ConfigError):
            self.build()
        self.write_config([account("win", account_type="windows_user") | {"scheduled_task_name": ""}])
        with self.assertRaises(controller_module.ConfigError):
            self.build()

    def test_priority_failover_and_state(self):
        ctl = self.build()
        with mock.patch.object(ctl, "_send_with", side_effect=[
            controller_module.ClassifiedError("quota", "429", cooldown=True), "ok"
        ]) as send:
            result = ctl.send_prompt("hello")
        self.assertEqual(result, {"account": "b", "result": "ok"})
        self.assertEqual([call.args[0]["name"] for call in send.call_args_list], ["a", "b"])
        self.assertIsNotNone(ctl.state.account("a")["cooldown_until"])

    def test_network_retries_once_then_fails_over(self):
        ctl = self.build()
        error = controller_module.ClassifiedError("network", "offline", retry_same_account=True)
        with mock.patch.object(ctl, "_send_with", side_effect=[error, error, "ok"]) as send:
            result = ctl.send_prompt("hello")
        self.assertEqual(result["account"], "b")
        self.assertEqual([call.args[0]["name"] for call in send.call_args_list], ["a", "a", "b"])

    def test_authentication_requires_operator_enable(self):
        ctl = self.build()
        auth = controller_module.ClassifiedError("authentication", "401", disable=True)
        with mock.patch.object(ctl, "_send_with", side_effect=[auth, "ok"]):
            ctl.send_prompt("hello")
        state = ctl.state.account("a")
        self.assertTrue(state["credential_check_required"])
        ctl.set_enabled("a", True)
        self.assertFalse(state["credential_check_required"])

    def test_round_robin_and_lru(self):
        self.write_config([account("a", 1), account("b", 2)], "round_robin")
        ctl = self.build()
        ctl.state.data["last_used_account"] = "a"
        self.assertEqual(ctl._ordered(ctl._eligible())[0]["name"], "b")
        self.write_config([account("a", 1), account("b", 2)], "least_recently_used")
        ctl = self.build()
        ctl.state.account("a")["last_used_at"] = "2026-01-02T00:00:00Z"
        ctl.state.account("b")["last_used_at"] = "2026-01-01T00:00:00Z"
        self.assertEqual(ctl._ordered(ctl._eligible())[0]["name"], "b")

    def test_force_switch_persists(self):
        ctl = self.build()
        ctl.force_switch_account("b")
        self.assertEqual(ctl._ordered(ctl._eligible())[0]["name"], "b")
        self.assertEqual(self.build().forced_account, "b")

    def test_log_redacts_sensitive_fields(self):
        ctl = self.build()
        stream = io.StringIO()
        handler = logging.StreamHandler(stream)
        ctl.logger.addHandler(handler)
        try:
            ctl._log(logging.INFO, "a", "test", "test", api_key="do-not-print", nested={"token": "no"})
        finally:
            ctl.logger.removeHandler(handler)
        self.assertNotIn("do-not-print", stream.getvalue())
        self.assertNotIn('"no"', stream.getvalue())
        self.assertIn("[REDACTED]", stream.getvalue())

    def test_http_error_classification(self):
        self.assertTrue(controller_module.classify_http(401, "").disable)
        self.assertTrue(controller_module.classify_http(429, "").cooldown)
        self.assertEqual(controller_module.classify_http(503, "").category, "server")
        self.assertEqual(controller_module.classify_http(400, "RESOURCE_EXHAUSTED").category, "quota")

    def test_no_account_is_clear(self):
        self.write_config([account("a") | {"enabled": False}])
        with self.assertRaisesRegex(controller_module.NoAccountAvailable, "no usable account"):
            self.build().send_prompt("hello")


if __name__ == "__main__":
    unittest.main()
