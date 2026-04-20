from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Literal, Optional
from uuid import uuid4


class UserAlreadyExistsError(Exception):
    """Raised when a registration email already exists."""


class SessionNotFoundError(Exception):
    """Raised when a refresh session is missing or invalid."""


@dataclass
class StoredUser:
    user_id: str
    email: str
    display_name: str
    password_hash: str
    created_at: datetime
    workspace_role: Literal["owner", "editor", "commenter", "viewer"] = "owner"
    workspace_ids: list[str] | None = None


@dataclass
class RefreshSession:
    session_id: str
    user_id: str
    created_at: datetime
    expires_at: datetime
    revoked_at: Optional[datetime] = None


class AuthStore:
    def __init__(self) -> None:
        self._users_by_id: dict[str, StoredUser] = {}
        self._users_by_email: dict[str, StoredUser] = {}
        self._refresh_sessions: dict[str, RefreshSession] = {}

    def register_user(
        self,
        *,
        email: str,
        display_name: str,
        password_hash: str,
        user_id: str | None = None,
        workspace_role: Literal["owner", "editor", "commenter", "viewer"] = "owner",
        workspace_ids: list[str] | None = None,
    ) -> StoredUser:
        normalized_email = email.strip().lower()
        if normalized_email in self._users_by_email:
            raise UserAlreadyExistsError(f"User '{normalized_email}' already exists.")

        now = datetime.now(timezone.utc)
        user = StoredUser(
            user_id=user_id or f"usr_{uuid4().hex[:8]}",
            email=normalized_email,
            display_name=display_name.strip(),
            password_hash=password_hash,
            created_at=now,
            workspace_role=workspace_role,
            workspace_ids=list(workspace_ids or ["ws_123"]),
        )
        self._users_by_id[user.user_id] = user
        self._users_by_email[user.email] = user
        return user

    def get_user_by_email(self, email: str) -> Optional[StoredUser]:
        return self._users_by_email.get(email.strip().lower())

    def get_user_by_id(self, user_id: str) -> Optional[StoredUser]:
        return self._users_by_id.get(user_id)

    def list_users(self) -> list[StoredUser]:
        return list(self._users_by_id.values())

    def list_users_for_workspace(self, workspace_id: str) -> list[StoredUser]:
        normalized_workspace_id = workspace_id.strip()
        return [
            user
            for user in self._users_by_id.values()
            if normalized_workspace_id in (user.workspace_ids or [])
        ]

    def resolve_principal(self, principal: str) -> Optional[StoredUser]:
        normalized = principal.strip().lower()
        if normalized in self._users_by_email:
            return self._users_by_email[normalized]

        for user in self._users_by_id.values():
            if user.user_id.lower() == normalized:
                return user

        return None

    def create_refresh_session(self, *, user_id: str, ttl_seconds: int) -> RefreshSession:
        now = datetime.now(timezone.utc)
        session = RefreshSession(
            session_id=f"ses_{uuid4().hex[:10]}",
            user_id=user_id,
            created_at=now,
            expires_at=now + timedelta(seconds=ttl_seconds),
        )
        self._refresh_sessions[session.session_id] = session
        return session

    def get_refresh_session(self, session_id: str) -> Optional[RefreshSession]:
        return self._refresh_sessions.get(session_id)

    def assert_refresh_session_active(self, *, session_id: str, user_id: str) -> RefreshSession:
        session = self._refresh_sessions.get(session_id)
        now = datetime.now(timezone.utc)
        if session is None or session.user_id != user_id:
            raise SessionNotFoundError("Refresh session does not exist.")
        if session.revoked_at is not None:
            raise SessionNotFoundError("Refresh session has been revoked.")
        if session.expires_at <= now:
            raise SessionNotFoundError("Refresh session has expired.")
        return session

    def rotate_refresh_session(self, *, session_id: str, user_id: str, ttl_seconds: int) -> RefreshSession:
        session = self.assert_refresh_session_active(session_id=session_id, user_id=user_id)
        session.revoked_at = datetime.now(timezone.utc)
        return self.create_refresh_session(user_id=user_id, ttl_seconds=ttl_seconds)
