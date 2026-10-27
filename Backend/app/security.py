"""Short-lived scoped tokens (HMAC). The master API key never goes to the browser."""
from __future__ import annotations
import base64
import hashlib
import hmac
import json
import secrets
import time
from .config import settings

_SECRET = (settings.api_key or secrets.token_hex(32)).encode()


def _b64(b: bytes) -> str: return base64.urlsafe_b64encode(b).decode().rstrip("=")
def _unb64(s: str) -> bytes: return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def make_token(scope: str, ttl: int | None = None) -> str:
    body = _b64(json.dumps({"s": scope, "e": int(time.time()) + (ttl or settings.token_ttl)}).encode())
    return body + "." + _b64(hmac.new(_SECRET, body.encode(), hashlib.sha256).digest())


def check_token(token: str | None):
    """Returns the scope ('read' | 'admin') or None."""
    if not token or "." not in token:
        return None
    body, sig = token.split(".", 1)
    good = _b64(hmac.new(_SECRET, body.encode(), hashlib.sha256).digest())
    if not hmac.compare_digest(sig, good):
        return None
    try:
        d = json.loads(_unb64(body))
    except Exception:
        return None
    return d["s"] if d.get("e", 0) > time.time() else None


def scope_for(master_key: str | None, token: str | None):
    """Auth disabled (no API_KEY configured) -> everyone is admin. Otherwise master key or a valid token."""
    if not settings.api_key:
        return "admin"
    if master_key and hmac.compare_digest(master_key, settings.api_key):
        return "admin"
    return check_token(token)


def allows(scope: str | None, need: str) -> bool:
    return scope == "admin" or (scope == "read" and need == "read")
