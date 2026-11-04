"""Sanitization and token counting functions for secret payloads."""

import json
import re

KEEP_ENV = {
    "SYSTEMROOT", "WINDIR", "PATH", "PATHEXT", "COMSPEC", "TEMP", "TMP",
    "USERPROFILE", "APPDATA", "LOCALAPPDATA", "PROCESSOR_ARCHITECTURE", "NUMBER_OF_PROCESSORS"
}

SENSITIVE_WORDS = ("token", "secret", "key", "password", "authorization", "cookie", "credential")
_WORD_ALT = "|".join(SENSITIVE_WORDS)
_KEY_SEPARATORS = r"[_\-\s.]"
_CAMEL_BOUNDARY_RE = re.compile(r"(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])")
_PART_RE = re.compile(r"[A-Z]+(?![a-z])|[A-Z]?[a-z0-9]+|[0-9]+")

_ASSIGNMENT_KEY_RE = re.compile(
    rf"(?<![A-Za-z0-9])(?:{_WORD_ALT})s?(?![A-Za-z0-9])",
    re.IGNORECASE,
)

_TEXT_ASSIGNMENT_RE = re.compile(
    rf"([\"']?(?:[A-Za-z0-9_.\-]*{_KEY_SEPARATORS})?(?:{_WORD_ALT})s?[\"']?\s*[=:]\s*[\"']?)(?![\[\"']?REDACTED)[^\s,\"'}}\]\]\\\\]+",
    re.IGNORECASE,
)
_TEXT_SPACE_ASSIGNMENT_RE = re.compile(
    rf"([\"']?(?:[A-Za-z0-9_.\-]*{_KEY_SEPARATORS})?(?:{_WORD_ALT})s?[\"']?\s+)(?![\[\"']?REDACTED)[^\s,\"'}}\]\]\\\\]+",
    re.IGNORECASE,
)
_AUTH_HEADER_RE = re.compile(
    r"(?i)([\"']?\bAuthorization[\"']?\s*(?:[:=]|\s)\s*[\"']?)(?!\s*\[?REDACTED)(?:[A-Za-z0-9_-]+\s+)?[^\s,\"'}\]:]+([\"']?)",
    re.IGNORECASE,
)
_BASIC_RE = re.compile(r"(?i)\bBasic\s+(?!\s*\[?REDACTED)[A-Za-z0-9+/=]{8,}")
_BEARER_RE = re.compile(r"(?i)\bBearer\s+[^\s,\"'}\]]+")
_CANARY_RE = re.compile(r"(?i)\bCANARY_SECRET\w*")
_SK_RE = re.compile(r"(?i)\bsk-[A-Za-z0-9_-]+")

REDACTED = "[REDACTED]"


def _split_parts(name: str):
    """Split an underscore/hyphen/dot/whitespace/camelCase separated key into parts."""
    parts = []
    for chunk in re.split(rf"{_KEY_SEPARATORS}+", _CAMEL_BOUNDARY_RE.sub("_", str(name))):
        parts.extend(_PART_RE.findall(chunk))
    return parts


def is_sensitive_key(name: str) -> bool:
    """True when a `_`/`-`/`.`/camelCase-separated part of the key is a sensitive word (or its plural)."""
    for part in _split_parts(name):
        low = part.lower()
        if low in SENSITIVE_WORDS or (low.endswith("s") and low[:-1] in SENSITIVE_WORDS):
            return True
    return False


JSONRPC_ERROR_CATEGORIES = {
    -32700: "Parse error",
    -32600: "Invalid Request",
    -32601: "Method not found",
    -32602: "Invalid params",
    -32603: "Internal error",
}


def error_category_from_code(code: int) -> str:
    """Return fixed category string chosen strictly from error code."""
    if not isinstance(code, int):
        return "Unknown error"
    if code in JSONRPC_ERROR_CATEGORIES:
        return JSONRPC_ERROR_CATEGORIES[code]
    if -32099 <= code <= -32000:
        return "Server error"
    return "Application error"


class JsonRpcError(RuntimeError):
    def __init__(self, code: int, category: str):
        super().__init__(f"JSON-RPC error: code={code}, category={category}")
        self.code = code
        self.category = category


def sanitize_secret_payload(val):
    """Allowlist output: for JSON-RPC error, record ONLY code (int) and fixed category string."""
    if isinstance(val, dict):
        if "code" in val and isinstance(val.get("code"), int):
            code = val["code"]
            return {"code": code, "category": error_category_from_code(code)}
        return {
            k: REDACTED if is_sensitive_key(k) else sanitize_secret_payload(v)
            for k, v in val.items()
        }
    if isinstance(val, str):
        s = _AUTH_HEADER_RE.sub("Authorization: " + REDACTED, val)
        s = _BASIC_RE.sub("Basic " + REDACTED, s)
        s = _BEARER_RE.sub("Bearer " + REDACTED, s)
        s = _CANARY_RE.sub(REDACTED, s)
        s = _SK_RE.sub(REDACTED, s)
        for pattern in (_TEXT_ASSIGNMENT_RE, _TEXT_SPACE_ASSIGNMENT_RE):
            s = pattern.sub(
                lambda m: m.group(1) + REDACTED
                if _ASSIGNMENT_KEY_RE.search(m.group(1))
                else m.group(0),
                s,
            )
        return s
    if isinstance(val, (list, tuple)):
        return [sanitize_secret_payload(item) for item in val]
    return val


def count_tokens(text: str) -> int:
    try:
        import tiktoken
        enc = tiktoken.get_encoding("cl100k_base")
        return len(enc.encode(text))
    except Exception:
        return max(1, len(text.encode("utf-8")) // 4)
