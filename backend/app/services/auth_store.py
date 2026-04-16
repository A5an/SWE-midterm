from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import uuid4


class UserAlreadyExistsError(Exception):
    """Raised when a registration email already exists."""


class SessionNotFoundError(Exception):
    """Raised when a refresh session is missing or invalid."""


@dataclass(slots=True)
class StoredUser:
    user_id: str
    email: str
    display_name: str
    password_hash: str
    created_at: datetime
    workspace_role: str = "member"


@dataclass(slots=True)
class RefreshSession:
    session_id: str
    user_id: str
    created_at: datetime
    expires_at: datetime
    revoked_at: datetime | None = None


class AuthStore:
    def __init__(self) -> None:
        self._users_by_id: dict[str, StoredUser] = {}
        self._users_by_email: dict[str, StoredUser] = {}
        self._refresh_sessions: dict[str, RefreshSession] = {}

    def register_user(self, *, email: str, display_name: str, password_hash: str) -> StoredUser:
        normalized_email = email.strip().lower()
        if normalized_email in self._users_by_email:
            raise UserAlreadyExistsError(f"User '{normalized_email}' already exists.")

        now = datetime.now(UTC)
        user = StoredUser(
            user_id=f"usr_{uuid4().hex[:8]}",
            email=normalized_email,
            display_name=display_name.strip(),
            password_hash=password_hash,
            created_at=now,
        )
        self._users_by_id[user.user_id] = user
        self._users_by_email[user.email] = user
        return user

    def get_user_by_email(self, email: str) -> StoredUser | None:
        return self._users_by_email.get(email.strip().lower())

    def get_user_by_id(self, user_id: str) -> StoredUser | None:
        return self._users_by_id.get(user_id)

    def create_refresh_session(self, *, user_id: str, ttl_seconds: int) -> RefreshSession:
        now = datetime.now(UTC)
        session = RefreshSession(
            session_id=f"ses_{uuid4().hex[:10]}",
            user_id=user_id,
            created_at=now,
            expires_at=now + timedelta(seconds=ttl_seconds),
        )
        self._refresh_sessions[session.session_id] = session
        return session

    def get_refresh_session(self, session_id: str) -> RefreshSession | None:
        return self._refresh_sessions.get(session_id)

    def assert_refresh_session_active(self, *, session_id: str, user_id: str) -> RefreshSession:
        session = self._refresh_sessions.get(session_id)
        now = datetime.now(UTC)
        if session is None or session.user_id != user_id:
            raise SessionNotFoundError("Refresh session does not exist.")
        if session.revoked_at is not None:
            raise SessionNotFoundError("Refresh session has been revoked.")
        if session.expires_at <= now:
            raise SessionNotFoundError("Refresh session has expired.")
        return session

    def rotate_refresh_session(self, *, session_id: str, user_id: str, ttl_seconds: int) -> RefreshSession:
        session = self.assert_refresh_session_active(session_id=session_id, user_id=user_id)
        session.revoked_at = datetime.now(UTC)
        return self.create_refresh_session(user_id=user_id, ttl_seconds=ttl_seconds)
