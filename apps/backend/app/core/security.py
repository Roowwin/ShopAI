import hashlib
import secrets
import uuid as uuidlib
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
import pyotp
from argon2 import PasswordHasher

from app.core.config import get_settings

_ph = PasswordHasher()
_HS = "HS256"

def hash_password(pw: str) -> str:
    return _ph.hash(pw)

def verify_password(pw_hash: str, pw: str) -> bool:
    try:
        return _ph.verify(pw_hash, pw)
    except Exception:
        return False

def generate_totp_secret() -> str:
    return pyotp.random_base32()

def totp_uri(secret: str, email: str) -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=email, issuer_name="RFO Staff")

def verify_totp(secret: str, code: str) -> bool:
    return pyotp.TOTP(secret).verify(code, valid_window=1)

def _encode(payload: dict[str, Any]) -> str:
    return jwt.encode(payload, get_settings().JWT_SECRET, algorithm=_HS)

def create_access(typ: str, sub: str, role: str | None = None, ttl_minutes: int | None = None) -> str:
    s = get_settings()
    exp = datetime.now(timezone.utc) + timedelta(minutes=ttl_minutes or s.JWT_ACCESS_TTL_MINUTES)
    payload: dict[str, Any] = {"sub": sub, "typ": typ, "jti": uuidlib.uuid4().hex,
                               "iat": int(datetime.now(timezone.utc).timestamp()),
                               "exp": exp, "iss": "rfo"}
    if role:
        payload["role"] = role
    return _encode(payload)

def decode_access(token: str, expected_typ: str) -> dict[str, Any]:
    payload = jwt.decode(token, get_settings().JWT_SECRET, algorithms=[_HS],
                         options={"require": ["exp", "sub", "typ"]})
    if payload.get("typ") != expected_typ:
        raise ValueError("wrong token type for this zone")
    return payload

def create_refresh() -> tuple[str, str]:
    token = secrets.token_urlsafe(48)
    return token, hashlib.sha256(token.encode()).hexdigest()