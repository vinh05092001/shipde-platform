#!/usr/bin/env python3
"""AccountFailoverController: bounded failover for user-owned AI accounts.

Secrets are resolved at runtime and never persisted by this program.  The
controller deliberately does not know undocumented Antigravity command-line
flags; process arguments and Windows scheduled tasks are operator supplied.
"""

from __future__ import annotations

import argparse
import dataclasses
import datetime as dt
import json
import logging
import os
import pathlib
import re
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Iterable


ACCOUNT_TYPES = {"api_key", "oauth_token", "antigravity_profile", "windows_user"}
STRATEGIES = {"priority_failover", "round_robin", "least_recently_used"}
SENSITIVE_KEY = re.compile(r"(secret|token|password|api.?key|credential)", re.I)


class ControllerError(RuntimeError):
    """Base controller error with an operator-safe message."""


class ConfigError(ControllerError):
    pass


class NoAccountAvailable(ControllerError):
    pass


@dataclasses.dataclass
class ClassifiedError(Exception):
    category: str
    message: str
    retry_same_account: bool = False
    cooldown: bool = False
    disable: bool = False
    status_code: int | None = None

    def __str__(self) -> str:
        return self.message


def utc_now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def iso(value: dt.datetime | None = None) -> str:
    return (value or utc_now()).isoformat().replace("+00:00", "Z")


def parse_time(value: str | None) -> dt.datetime | None:
    if not value:
        return None
    try:
        return dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def atomic_json_write(path: pathlib.Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def safe_details(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: "[REDACTED]" if SENSITIVE_KEY.search(str(key)) else safe_details(item)
                for key, item in value.items()}
    if isinstance(value, list):
        return [safe_details(item) for item in value]
    return value


def create_logger(log_path: pathlib.Path) -> logging.Logger:
    logger = logging.getLogger(f"account-failover:{log_path.resolve()}")
    logger.setLevel(logging.INFO)
    logger.propagate = False
    if not logger.handlers:
        log_path.parent.mkdir(parents=True, exist_ok=True)
        formatter = logging.Formatter("%(asctime)sZ %(levelname)s %(message)s", "%Y-%m-%dT%H:%M:%S")
        for handler in (logging.StreamHandler(sys.stderr), logging.FileHandler(log_path, encoding="utf-8")):
            handler.setFormatter(formatter)
            logger.addHandler(handler)
    return logger


def validate_config(raw: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(raw, dict) or not isinstance(raw.get("accounts"), list):
        raise ConfigError("accounts.json must contain an 'accounts' array")
    strategy = raw.get("strategy", "priority_failover")
    if strategy not in STRATEGIES:
        raise ConfigError(f"unsupported strategy: {strategy}")
    names: set[str] = set()
    for index, account in enumerate(raw["accounts"]):
        if not isinstance(account, dict):
            raise ConfigError(f"accounts[{index}] must be an object")
        missing = [key for key in ("name", "type", "priority", "enabled", "cooldown_seconds") if key not in account]
        if missing:
            raise ConfigError(f"accounts[{index}] missing: {', '.join(missing)}")
        name = account["name"]
        if not isinstance(name, str) or not name.strip() or name in names:
            raise ConfigError(f"accounts[{index}].name must be unique and non-empty")
        names.add(name)
        if account["type"] not in ACCOUNT_TYPES:
            raise ConfigError(f"account {name} has unsupported type: {account['type']}")
        if not isinstance(account["enabled"], bool):
            raise ConfigError(f"account {name}.enabled must be boolean")
        if not isinstance(account["priority"], int) or account["priority"] < 0:
            raise ConfigError(f"account {name}.priority must be a non-negative integer")
        if not isinstance(account["cooldown_seconds"], int) or account["cooldown_seconds"] < 0:
            raise ConfigError(f"account {name}.cooldown_seconds must be a non-negative integer")
        account.setdefault("metadata", {})
        if not isinstance(account["metadata"], dict):
            raise ConfigError(f"account {name}.metadata must be an object")
        if account["type"] in {"api_key", "oauth_token"} and not account.get("credential_ref"):
            raise ConfigError(f"account {name} requires credential_ref")
        if account["type"] == "windows_user" and not account.get("scheduled_task_name"):
            raise ConfigError(f"account {name} requires scheduled_task_name; runtime passwords are not accepted")
    return raw


class StateStore:
    def __init__(self, path: pathlib.Path):
        self.path = path
        self.lock = threading.RLock()
        self.data = self._load()

    def _load(self) -> dict[str, Any]:
        if not self.path.exists():
            return {"last_used_account": None, "last_success_at": None, "last_failure_at": None,
                    "accounts": {}}
        try:
            value = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ConfigError(f"cannot read state file {self.path}: {exc}") from exc
        if not isinstance(value, dict):
            raise ConfigError("state.json root must be an object")
        value.setdefault("accounts", {})
        return value

    def account(self, name: str) -> dict[str, Any]:
        return self.data.setdefault("accounts", {}).setdefault(name, {
            "last_used_at": None, "last_success_at": None, "last_failure_at": None,
            "failure_count": 0, "cooldown_until": None, "disabled_reason": None,
            "credential_check_required": False,
        })

    def save(self) -> None:
        with self.lock:
            atomic_json_write(self.path, self.data)

    def reset(self) -> None:
        with self.lock:
            self.data = {"last_used_account": None, "last_success_at": None,
                         "last_failure_at": None, "accounts": {}}
            self.save()


def classify_http(code: int, message: str) -> ClassifiedError:
    if code in (401, 403):
        return ClassifiedError("authentication", f"HTTP {code}: authentication or permission refused",
                               disable=True, status_code=code)
    if code == 429 or "RESOURCE_EXHAUSTED" in message.upper():
        return ClassifiedError("quota", "provider quota or rate limit exhausted", cooldown=True, status_code=code)
    if code in (500, 503):
        return ClassifiedError("server", f"provider server error HTTP {code}", cooldown=True, status_code=code)
    return ClassifiedError("http", f"provider HTTP error {code}", cooldown=True, status_code=code)


def run_process(args: list[str], timeout: int, env: dict[str, str] | None = None) -> str:
    creationflags = subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
    try:
        process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                   encoding="utf-8", errors="replace", env=env, shell=False,
                                   creationflags=creationflags)
        stdout, stderr = process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired as exc:
        if os.name == "nt":
            subprocess.run(["taskkill.exe", "/PID", str(process.pid), "/T", "/F"],
                           capture_output=True, shell=False)
        else:  # pragma: no cover - Windows is the primary target
            process.kill()
        process.communicate()
        raise ClassifiedError("timeout", f"process timed out after {timeout}s", retry_same_account=True) from exc
    except (OSError, subprocess.SubprocessError) as exc:
        raise ClassifiedError("network", f"process launch failed: {type(exc).__name__}", retry_same_account=True) from exc
    combined = (stdout or "") + "\n" + (stderr or "")
    if process.returncode != 0:
        upper = combined.upper()
        if "401" in upper or "403" in upper or "UNAUTHENTICATED" in upper or "PERMISSION_DENIED" in upper:
            raise ClassifiedError("authentication", f"CLI authentication failed (exit {process.returncode})", disable=True)
        if "429" in upper or "RESOURCE_EXHAUSTED" in upper or "QUOTA" in upper or "RATE LIMIT" in upper:
            raise ClassifiedError("quota", f"CLI quota refused (exit {process.returncode})", cooldown=True)
        raise ClassifiedError("process_exit", f"CLI exited with code {process.returncode}", cooldown=True)
    return stdout.strip()


class AccountFailoverController:
    def __init__(self, config_path: pathlib.Path):
        self.config_path = config_path.resolve()
        try:
            self.config = validate_config(json.loads(self.config_path.read_text(encoding="utf-8")))
        except FileNotFoundError as exc:
            raise ConfigError(f"configuration not found: {self.config_path}") from exc
        except json.JSONDecodeError as exc:
            raise ConfigError(f"invalid JSON in {self.config_path}: {exc}") from exc
        base = self.config_path.parent
        self.state = StateStore((base / self.config.get("state_path", "state.json")).resolve())
        self.logger = create_logger((base / self.config.get("log_path", "logs/controller.log")).resolve())
        self.forced_account: str | None = self.state.data.get("forced_account")

    def _log(self, level: int, account: str, category: str, action: str, **details: Any) -> None:
        payload = {"account": account, "error_type": category, "action": action, **safe_details(details)}
        self.logger.log(level, json.dumps(payload, ensure_ascii=False, separators=(",", ":")))

    def _account_by_name(self, name: str) -> dict[str, Any]:
        for account in self.config["accounts"]:
            if account["name"] == name:
                return account
        raise ConfigError(f"unknown account: {name}")

    def _eligible(self, excluded: set[str] | None = None) -> list[dict[str, Any]]:
        now = utc_now()
        result = []
        for account in self.config["accounts"]:
            state = self.state.account(account["name"])
            cooldown = parse_time(state.get("cooldown_until"))
            if account["name"] in (excluded or set()) or not account["enabled"]:
                continue
            if state.get("credential_check_required") or state.get("disabled_reason"):
                continue
            if cooldown and cooldown > now:
                continue
            result.append(account)
        return result

    def _ordered(self, accounts: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
        items = list(accounts)
        if self.forced_account:
            forced = [item for item in items if item["name"] == self.forced_account]
            if forced:
                return forced + [item for item in items if item["name"] != self.forced_account]
        strategy = self.config.get("strategy", "priority_failover")
        if strategy == "least_recently_used":
            return sorted(items, key=lambda item: (self.state.account(item["name"]).get("last_used_at") or "", item["priority"], item["name"]))
        ordered = sorted(items, key=lambda item: (item["priority"], item["name"]))
        if strategy == "round_robin" and ordered:
            previous = self.state.data.get("last_used_account")
            names = [item["name"] for item in ordered]
            if previous in names:
                offset = (names.index(previous) + 1) % len(ordered)
                ordered = ordered[offset:] + ordered[:offset]
        return ordered

    def _secret(self, account: dict[str, Any]) -> str:
        ref = account.get("credential_ref")
        value = os.environ.get(ref, "") if ref else ""
        if not value:
            raise ClassifiedError("authentication", f"credential environment reference is unavailable: {ref}", disable=True)
        return value

    def _http_request(self, account: dict[str, Any], prompt: str, options: dict[str, Any]) -> str:
        metadata = account["metadata"]
        endpoint = metadata.get("endpoint")
        if not endpoint or not str(endpoint).startswith(("http://", "https://")):
            raise ConfigError(f"account {account['name']} requires metadata.endpoint")
        secret = self._secret(account)
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        header_name = metadata.get("credential_header", "x-goog-api-key" if account["type"] == "api_key" else "Authorization")
        headers[header_name] = secret if header_name.lower() != "authorization" else f"Bearer {secret}"
        headers.update({str(k): str(v) for k, v in metadata.get("headers", {}).items() if not SENSITIVE_KEY.search(str(k))})
        body_style = metadata.get("body_style", "gemini_generate_content")
        if body_style == "gemini_generate_content":
            body: dict[str, Any] = {"contents": [{"parts": [{"text": prompt}]}]}
            if options:
                body["generationConfig"] = options
        elif body_style == "prompt":
            body = {"prompt": prompt, "options": options}
        else:
            raise ConfigError(f"account {account['name']} has unsupported metadata.body_style")
        request = urllib.request.Request(endpoint, data=json.dumps(body).encode("utf-8"), headers=headers, method="POST")
        timeout = int(metadata.get("timeout_seconds", self.config.get("request_timeout_seconds", 120)))
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                raw = response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            error_text = exc.read(4096).decode("utf-8", errors="replace")
            raise classify_http(exc.code, error_text) from exc
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise ClassifiedError("network", f"network request failed: {type(exc).__name__}", retry_same_account=True) from exc
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            return raw
        if body_style == "gemini_generate_content":
            try:
                return parsed["candidates"][0]["content"]["parts"][0]["text"]
            except (KeyError, IndexError, TypeError):
                raise ClassifiedError("response", "provider response has no generated text", cooldown=True)
        return parsed.get("text", raw) if isinstance(parsed, dict) else raw

    def _process_request(self, account: dict[str, Any], prompt: str, options: dict[str, Any]) -> str:
        executable = account.get("executable_path")
        template = account.get("args_template")
        if not executable or not isinstance(template, list):
            raise ConfigError(f"account {account['name']} requires executable_path and args_template array")
        path = pathlib.Path(os.path.expandvars(executable))
        if not path.is_file():
            raise ClassifiedError("configuration", f"configured executable does not exist: {path}", disable=True)
        replacements = {"prompt": prompt, "profile_path": os.path.expandvars(account.get("profile_path", "")),
                        "options_json": json.dumps(options, separators=(",", ":"))}
        args = [str(path)] + [str(value).format_map(replacements) for value in template]
        environment = os.environ.copy()
        if replacements["profile_path"]:
            environment["JETSKI_APP_DATA_DIR"] = replacements["profile_path"]
        timeout = int(account["metadata"].get("timeout_seconds", self.config.get("request_timeout_seconds", 120)))
        return run_process(args, timeout, environment)

    def _scheduled_task_request(self, account: dict[str, Any], prompt: str, options: dict[str, Any]) -> str:
        if os.name != "nt":
            raise ConfigError("windows_user accounts require Windows")
        task_name = account["scheduled_task_name"]
        request_value = account.get("task_request_path")
        response_value = account.get("task_response_path")
        if not request_value or not response_value:
            raise ConfigError(f"account {account['name']} requires task_request_path and task_response_path")
        request_path = pathlib.Path(os.path.expandvars(request_value))
        response_path = pathlib.Path(os.path.expandvars(response_value))
        request_id = str(uuid.uuid4())
        atomic_json_write(request_path, {"request_id": request_id, "prompt": prompt, "options": options, "created_at": iso()})
        query = subprocess.run(["schtasks.exe", "/Query", "/TN", task_name], capture_output=True, text=True, shell=False)
        if query.returncode != 0:
            raise ClassifiedError("configuration", f"scheduled task is unavailable: {task_name}", disable=True)
        launched = subprocess.run(["schtasks.exe", "/Run", "/TN", task_name], capture_output=True, text=True, shell=False)
        if launched.returncode != 0:
            raise ClassifiedError("process_exit", f"scheduled task failed to start: {task_name}", cooldown=True)
        timeout = int(account["metadata"].get("timeout_seconds", self.config.get("request_timeout_seconds", 120)))
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if response_path.exists():
                try:
                    response = json.loads(response_path.read_text(encoding="utf-8"))
                except (OSError, json.JSONDecodeError):
                    time.sleep(0.25)
                    continue
                if response.get("request_id") == request_id:
                    if response.get("ok") is True:
                        return str(response.get("result", ""))
                    code = int(response.get("status_code", 0) or 0)
                    if code:
                        raise classify_http(code, str(response.get("error", "")))
                    raise ClassifiedError(str(response.get("error_type", "process_exit")),
                                          "scheduled task worker reported failure", cooldown=True)
            time.sleep(0.25)
        subprocess.run(["schtasks.exe", "/End", "/TN", task_name], capture_output=True, shell=False)
        raise ClassifiedError("timeout", f"scheduled task timed out after {timeout}s", retry_same_account=True)

    def _send_with(self, account: dict[str, Any], prompt: str, options: dict[str, Any]) -> str:
        if account["type"] in {"api_key", "oauth_token"}:
            return self._http_request(account, prompt, options)
        if account["type"] == "windows_user":
            return self._scheduled_task_request(account, prompt, options)
        return self._process_request(account, prompt, options)

    def _mark_attempt(self, account: dict[str, Any]) -> None:
        now = iso()
        state = self.state.account(account["name"])
        state["last_used_at"] = now
        self.state.data["last_used_account"] = account["name"]
        self.state.save()

    def _mark_success(self, account: dict[str, Any]) -> None:
        now = iso()
        state = self.state.account(account["name"])
        state.update({"last_success_at": now, "failure_count": 0, "cooldown_until": None})
        self.state.data["last_success_at"] = now
        self.state.save()
        self._log(logging.INFO, account["name"], "success", "return_result")

    def _mark_failure(self, account: dict[str, Any], error: ClassifiedError) -> None:
        now = utc_now()
        state = self.state.account(account["name"])
        state["last_failure_at"] = iso(now)
        state["failure_count"] = int(state.get("failure_count", 0)) + 1
        self.state.data["last_failure_at"] = iso(now)
        action = "try_next_account"
        if error.disable:
            state["credential_check_required"] = True
            state["disabled_reason"] = error.category
            action = "disable_until_operator_enable"
        elif error.cooldown:
            state["cooldown_until"] = iso(now + dt.timedelta(seconds=account["cooldown_seconds"]))
            action = "cooldown_and_try_next"
        self.state.save()
        self._log(logging.WARNING, account["name"], error.category, action,
                  status_code=error.status_code, message=error.message)

    def send_prompt(self, prompt: str, options: dict[str, Any] | None = None) -> dict[str, Any]:
        if not isinstance(prompt, str) or not prompt.strip():
            raise ConfigError("prompt must be non-empty")
        excluded: set[str] = set()
        while True:
            ordered = self._ordered(self._eligible(excluded))
            if not ordered:
                raise NoAccountAvailable("no usable account remains; inspect status and re-enable credentials after correction")
            account = ordered[0]
            self._mark_attempt(account)
            same_account_attempts = 0
            while True:
                try:
                    result = self._send_with(account, prompt, options or {})
                    self._mark_success(account)
                    return {"account": account["name"], "result": result}
                except ConfigError:
                    raise
                except ClassifiedError as error:
                    same_account_attempts += 1
                    if error.retry_same_account and same_account_attempts == 1:
                        self._log(logging.WARNING, account["name"], error.category, "retry_same_account_once")
                        continue
                    self._mark_failure(account, error)
                    excluded.add(account["name"])
                    break

    def health_check(self, account_name: str) -> dict[str, Any]:
        account = self._account_by_name(account_name)
        state = self.state.account(account_name)
        configured = True
        detail = "configured"
        if account["type"] in {"api_key", "oauth_token"}:
            configured = bool(account.get("credential_ref") and os.environ.get(account["credential_ref"]))
            detail = "credential reference resolved" if configured else "credential reference unavailable"
        elif account["type"] == "antigravity_profile":
            configured = bool(account.get("executable_path") and pathlib.Path(os.path.expandvars(account["executable_path"])).is_file())
            detail = "executable exists" if configured else "executable unavailable"
        elif account["type"] == "windows_user":
            configured = bool(account.get("scheduled_task_name"))
            detail = "scheduled task configured" if configured else "scheduled task missing"
        return {"name": account_name, "enabled": account["enabled"], "configured": configured,
                "detail": detail, "cooldown_until": state.get("cooldown_until"),
                "credential_check_required": state.get("credential_check_required", False)}

    def get_status(self) -> dict[str, Any]:
        return {"strategy": self.config.get("strategy", "priority_failover"),
                "forced_account": self.forced_account, "last_used_account": self.state.data.get("last_used_account"),
                "last_success_at": self.state.data.get("last_success_at"),
                "last_failure_at": self.state.data.get("last_failure_at"),
                "accounts": [self.health_check(account["name"]) | self.state.account(account["name"])
                             for account in self.config["accounts"]]}

    def force_switch_account(self, name: str) -> None:
        account = self._account_by_name(name)
        if not account["enabled"]:
            raise ConfigError(f"account is disabled in configuration: {name}")
        self.forced_account = name
        self.state.data["forced_account"] = name
        self.state.save()
        self._log(logging.INFO, name, "operator", "force_switch")

    def set_enabled(self, name: str, enabled: bool) -> None:
        account = self._account_by_name(name)
        account["enabled"] = enabled
        if enabled:
            state = self.state.account(name)
            state["disabled_reason"] = None
            state["credential_check_required"] = False
            state["cooldown_until"] = None
            self.state.save()
        atomic_json_write(self.config_path, self.config)
        self._log(logging.INFO, name, "operator", "enable" if enabled else "disable")


def make_handler(controller: AccountFailoverController):
    class Handler(BaseHTTPRequestHandler):
        server_version = "AccountFailoverController/1.0"

        def _reply(self, status: int, value: Any) -> None:
            data = json.dumps(value, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def _body(self) -> dict[str, Any]:
            length = int(self.headers.get("Content-Length", "0"))
            return json.loads(self.rfile.read(length).decode("utf-8")) if length else {}

        def do_GET(self) -> None:  # noqa: N802
            if self.path == "/status":
                self._reply(200, controller.get_status())
            else:
                self._reply(404, {"error": "not_found"})

        def do_POST(self) -> None:  # noqa: N802
            try:
                if self.path == "/generate":
                    body = self._body()
                    self._reply(200, controller.send_prompt(body.get("prompt", ""), body.get("options", {})))
                    return
                match = re.fullmatch(r"/accounts/([^/]+)/(enable|disable)", self.path)
                if match:
                    controller.set_enabled(match.group(1), match.group(2) == "enable")
                    self._reply(200, {"ok": True})
                    return
                self._reply(404, {"error": "not_found"})
            except (ControllerError, ValueError, json.JSONDecodeError) as exc:
                self._reply(400, {"error": type(exc).__name__, "message": str(exc)})

        def log_message(self, format_: str, *args: Any) -> None:
            controller.logger.info("http " + format_, *args)

    return Handler


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(prog="controller", description="Fail over between user-owned Gemini/Antigravity accounts")
    result.add_argument("--config", default=str(pathlib.Path(__file__).with_name("accounts.json")))
    commands = result.add_subparsers(dest="command", required=True)
    run = commands.add_parser("run")
    run.add_argument("--prompt", required=True)
    run.add_argument("--options-json", default="{}")
    commands.add_parser("status")
    commands.add_parser("list-accounts")
    accounts = commands.add_parser("accounts")
    account_commands = accounts.add_subparsers(dest="accounts_command", required=True)
    account_commands.add_parser("list")
    for command in ("enable", "disable"):
        item = account_commands.add_parser(command)
        item.add_argument("--name", required=True)
    switch = commands.add_parser("switch-account")
    switch.add_argument("--name", required=True)
    for command in ("enable-account", "disable-account"):
        item = commands.add_parser(command)
        item.add_argument("--name", required=True)
    commands.add_parser("reset-state")
    serve = commands.add_parser("serve")
    serve.add_argument("--port", type=int, default=8765)
    return result


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        controller = AccountFailoverController(pathlib.Path(args.config))
        if args.command == "run":
            print(json.dumps(controller.send_prompt(args.prompt, json.loads(args.options_json)), ensure_ascii=False, indent=2))
        elif args.command == "status":
            print(json.dumps(controller.get_status(), ensure_ascii=False, indent=2))
        elif args.command == "list-accounts" or (args.command == "accounts" and args.accounts_command == "list"):
            print(json.dumps([controller.health_check(a["name"]) for a in controller.config["accounts"]], ensure_ascii=False, indent=2))
        elif args.command == "switch-account":
            controller.force_switch_account(args.name)
            print(f"switched to {args.name}")
        elif args.command in {"enable-account", "disable-account"}:
            controller.set_enabled(args.name, args.command == "enable-account")
            print(f"{args.command.replace('-account', 'd')}: {args.name}")
        elif args.command == "accounts":
            controller.set_enabled(args.name, args.accounts_command == "enable")
            print(f"{args.accounts_command}d: {args.name}")
        elif args.command == "reset-state":
            controller.state.reset()
            print("state reset")
        elif args.command == "serve":
            if not (1 <= args.port <= 65535):
                raise ConfigError("port must be between 1 and 65535")
            server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(controller))
            print(f"listening on http://127.0.0.1:{args.port}", file=sys.stderr)
            server.serve_forever()
        return 0
    except (ControllerError, OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"ERROR {type(exc).__name__}: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
