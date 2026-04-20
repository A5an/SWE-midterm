from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Literal


PBKDF2_ALGORITHM = "sha256"
PBKDF2_ITERATIONS = 600_000
PBKDF2_SALT_BYTES = 16


class TokenValidationError(Exception):
    """Raised when a JWT cannot be validated."""


class TokenExpiredError(TokenValidationError):
    """Raised when a JWT is structurally valid but expired."""


@dataclass(frozen=True)
class AuthSettings:
    access_secret: str
    refresh_secret: str
    access_ttl_seconds: int
    refresh_ttl_seconds: int
    issuer: str

    @classmethod
    def from_env(cls) -> "AuthSettings":
        return cls(
            access_secret=_env_string("JWT_ACCESS_SECRET", "dev-access-secret-change-me"),
            refresh_secret=_env_string("JWT_REFRESH_SECRET", "dev-refresh-secret-change-me"),
            access_ttl_seconds=_env_int("JWT_ACCESS_TTL_SECONDS", 900),
            refresh_ttl_seconds=_env_int("JWT_REFRESH_TTL_SECONDS", 604800),
            issuer=_env_string("JWT_ISSUER", "swe-midterm-fastapi"),
        )


def _env_string(name: str, default: str) -> str:
    value = os.getenv(name)
    if value is None or not value.strip():
        return default
    return value


def _env_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None or not value.strip():
        return default
    return int(value)


@dataclass(frozen=True)
class IssuedToken:
    value: str
    expires_at: datetime


@dataclass(frozen=True)
class TokenClaims:
    subject: str
    token_type: Literal["access", "refresh"]
    session_id: str
    issued_at: datetime
    expires_at: datetime
    name: str | None = None
    email: str | None = None
    workspace_ids: list[str] | None = None


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(PBKDF2_SALT_BYTES)
    digest = hashlib.pbkdf2_hmac(
        PBKDF2_ALGORITHM,
        password.encode("utf-8"),
        salt,
        PBKDF2_ITERATIONS,
    )
    return (
        f"pbkdf2_{PBKDF2_ALGORITHM}"
        f"${PBKDF2_ITERATIONS}"
        f"${_b64url_encode(salt)}"
        f"${_b64url_encode(digest)}"
    )


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        scheme, raw_iterations, encoded_salt, encoded_digest = stored_hash.split("$", maxsplit=3)
    except ValueError:
        return False

    if scheme != f"pbkdf2_{PBKDF2_ALGORITHM}":
        return False

    try:
        iterations = int(raw_iterations)
        salt = _b64url_decode(encoded_salt)
        expected_digest = _b64url_decode(encoded_digest)
    except (TypeError, ValueError):
        return False

    actual_digest = hashlib.pbkdf2_hmac(
        PBKDF2_ALGORITHM,
        password.encode("utf-8"),
        salt,
        iterations,
    )
    return hmac.compare_digest(actual_digest, expected_digest)


def create_access_token(
    *,
    user_id: str,
    session_id: str,
    display_name: str,
    email: str,
    workspace_ids: list[str],
    settings: AuthSettings,
    now: datetime | None = None,
) -> IssuedToken:
    issued_at = now or datetime.now(timezone.utc)
    expires_at = issued_at + timedelta(seconds=settings.access_ttl_seconds)
    return IssuedToken(
        value=_encode_jwt(
            {
                "sub": user_id,
                "sid": session_id,
                "typ": "access",
                "iss": settings.issuer,
                "name": display_name,
                "email": email,
                "workspaceIds": workspace_ids,
                "iat": int(issued_at.timestamp()),
                "exp": int(expires_at.timestamp()),
            },
            settings.access_secret,
        ),
        expires_at=expires_at,
    )


def create_refresh_token(
    *,
    user_id: str,
    session_id: str,
    settings: AuthSettings,
    now: datetime | None = None,
) -> IssuedToken:
    issued_at = now or datetime.now(timezone.utc)
    expires_at = issued_at + timedelta(seconds=settings.refresh_ttl_seconds)
    return IssuedToken(
        value=_encode_jwt(
            {
                "sub": user_id,
                "sid": session_id,
                "typ": "refresh",
                "iss": settings.issuer,
                "iat": int(issued_at.timestamp()),
                "exp": int(expires_at.timestamp()),
            },
            settings.refresh_secret,
        ),
        expires_at=expires_at,
    )


def decode_access_token(token: str, settings: AuthSettings) -> TokenClaims:
    return _decode_jwt(token, settings.access_secret, settings=settings, expected_type="access")


def decode_refresh_token(token: str, settings: AuthSettings) -> TokenClaims:
    return _decode_jwt(token, settings.refresh_secret, settings=settings, expected_type="refresh")


def _encode_jwt(payload: dict[str, Any], secret: str) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    encoded_header = _b64url_encode(_to_json_bytes(header))
    encoded_payload = _b64url_encode(_to_json_bytes(payload))
    signing_input = f"{encoded_header}.{encoded_payload}".encode("ascii")
    signature = hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
    encoded_signature = _b64url_encode(signature)
    return f"{encoded_header}.{encoded_payload}.{encoded_signature}"


def _decode_jwt(
    token: str,
    secret: str,
    *,
    settings: AuthSettings,
    expected_type: Literal["access", "refresh"],
) -> TokenClaims:
    parts = token.split(".")
    if len(parts) != 3:
        raise TokenValidationError("Token must have three segments.")

    encoded_header, encoded_payload, encoded_signature = parts
    signing_input = f"{encoded_header}.{encoded_payload}".encode("ascii")
    try:
        actual_signature = _b64url_decode(encoded_signature)
    except ValueError as exc:
        raise TokenValidationError("Token signature is malformed.") from exc
    expected_signature = hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()

    if not hmac.compare_digest(actual_signature, expected_signature):
        raise TokenValidationError("Token signature is invalid.")

    try:
        header = json.loads(_b64url_decode(encoded_header))
        payload = json.loads(_b64url_decode(encoded_payload))
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
        raise TokenValidationError("Token payload is invalid JSON.") from exc

    if header.get("alg") != "HS256" or header.get("typ") != "JWT":
        raise TokenValidationError("Token header is invalid.")
    if payload.get("iss") != settings.issuer:
        raise TokenValidationError("Token issuer is invalid.")
    if payload.get("typ") != expected_type:
        raise TokenValidationError("Token type is invalid.")

    subject = payload.get("sub")
    session_id = payload.get("sid")
    issued_at = payload.get("iat")
    expires_at = payload.get("exp")
    if not isinstance(subject, str) or not subject:
        raise TokenValidationError("Token subject is missing.")
    if not isinstance(session_id, str) or not session_id:
        raise TokenValidationError("Token session ID is missing.")
    if not isinstance(issued_at, int) or not isinstance(expires_at, int):
        raise TokenValidationError("Token timestamps are invalid.")

    now_ts = int(datetime.now(timezone.utc).timestamp())
    if expires_at <= now_ts:
        raise TokenExpiredError("Token has expired.")

    return TokenClaims(
        subject=subject,
        session_id=session_id,
        token_type=expected_type,
        issued_at=datetime.fromtimestamp(issued_at, tz=timezone.utc),
        expires_at=datetime.fromtimestamp(expires_at, tz=timezone.utc),
        name=payload.get("name") if isinstance(payload.get("name"), str) else None,
        email=payload.get("email") if isinstance(payload.get("email"), str) else None,
        workspace_ids=payload.get("workspaceIds") if isinstance(payload.get("workspaceIds"), list) else None,
    )


def _to_json_bytes(value: dict[str, Any]) -> bytes:
    return json.dumps(value, separators=(",", ":"), sort_keys=True).encode("utf-8")


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64url_decode(raw: str) -> bytes:
    padding = "=" * (-len(raw) % 4)
    try:
        return base64.urlsafe_b64decode(raw + padding)
    except Exception as exc:  # pragma: no cover - defensive decode guard
        raise ValueError("Invalid base64url payload.") from exc
