from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class DocumentParagraph(BaseModel):
    type: Literal["paragraph"]
    text: str


class DocumentContent(BaseModel):
    type: Literal["doc"]
    content: list[DocumentParagraph]


class CreateDocumentRequest(BaseModel):
    workspaceId: str
    title: str
    templateId: str | None = None
    initialContent: DocumentContent

    @field_validator("workspaceId")
    @classmethod
    def validate_workspace_id(cls, value: str) -> str:
        if not isinstance(value, str) or not value.strip():
            raise ValueError("workspaceId must be a non-empty string.")
        return value.strip()

    @field_validator("title")
    @classmethod
    def validate_title(cls, value: str) -> str:
        if not isinstance(value, str) or not value.strip():
            raise ValueError("title must be a non-empty string.")
        return value.strip()


class DocumentMetadataResponse(BaseModel):
    model_config = ConfigDict(json_schema_extra={"example": {
        "documentId": "doc_456",
        "workspaceId": "ws_123",
        "title": "Q3 Product Brief",
        "ownerRole": "owner",
        "currentVersionId": "ver_001",
        "createdAt": "2026-03-16T11:25:00Z",
    }})

    documentId: str
    workspaceId: str
    title: str
    ownerRole: Literal["owner"] = "owner"
    currentVersionId: str = "ver_001"
    createdAt: datetime


class DocumentDetailResponse(DocumentMetadataResponse):
    model_config = ConfigDict(json_schema_extra={"example": {
        "documentId": "doc_456",
        "workspaceId": "ws_123",
        "title": "Q3 Product Brief",
        "ownerRole": "owner",
        "currentVersionId": "ver_001",
        "createdAt": "2026-03-16T11:25:00Z",
        "content": {
            "type": "doc",
            "content": [
                {
                    "type": "paragraph",
                    "text": "Initial PoC content"
                }
            ]
        },
        "updatedAt": "2026-03-16T11:25:00Z",
    }})

    content: DocumentContent
    updatedAt: datetime


class ApiError(BaseModel):
    code: str
    message: str
    retryable: bool
    requestId: str
    details: dict[str, Any] | None = None


class ApiErrorEnvelope(BaseModel):
    error: ApiError


EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class RegisterUserRequest(BaseModel):
    email: str
    password: str
    displayName: str

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        normalized = value.strip().lower()
        if not EMAIL_PATTERN.match(normalized):
            raise ValueError("email must be a valid email address.")
        return normalized

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        if len(value) < 8:
            raise ValueError("password must be at least 8 characters long.")
        if len(value) > 128:
            raise ValueError("password must be at most 128 characters long.")
        return value

    @field_validator("displayName")
    @classmethod
    def validate_display_name(cls, value: str) -> str:
        if not isinstance(value, str) or not value.strip():
            raise ValueError("displayName must be a non-empty string.")
        return value.strip()


class LoginRequest(BaseModel):
    email: str
    password: str

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        normalized = value.strip().lower()
        if not EMAIL_PATTERN.match(normalized):
            raise ValueError("email must be a valid email address.")
        return normalized

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        if not isinstance(value, str) or not value:
            raise ValueError("password must be a non-empty string.")
        return value


class RefreshTokenRequest(BaseModel):
    refreshToken: str

    @field_validator("refreshToken")
    @classmethod
    def validate_refresh_token(cls, value: str) -> str:
        if not isinstance(value, str) or not value.strip():
            raise ValueError("refreshToken must be a non-empty string.")
        return value.strip()


class UserProfileResponse(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "userId": "usr_123",
                "email": "user@example.com",
                "displayName": "Dachi",
                "workspaceRole": "member",
                "createdAt": "2026-04-16T10:20:00Z",
            }
        }
    )

    userId: str
    email: str
    displayName: str
    workspaceRole: Literal["member"] = "member"
    createdAt: datetime


class TokenBundleResponse(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "tokenType": "bearer",
                "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
                "accessTokenExpiresAt": "2026-04-16T10:35:00Z",
                "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
                "refreshTokenExpiresAt": "2026-04-23T10:20:00Z",
            }
        }
    )

    tokenType: Literal["bearer"] = "bearer"
    accessToken: str
    accessTokenExpiresAt: datetime
    refreshToken: str
    refreshTokenExpiresAt: datetime


class AuthResponse(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "user": {
                    "userId": "usr_123",
                    "email": "user@example.com",
                    "displayName": "Dachi",
                    "workspaceRole": "member",
                    "createdAt": "2026-04-16T10:20:00Z",
                },
                "tokens": {
                    "tokenType": "bearer",
                    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
                    "accessTokenExpiresAt": "2026-04-16T10:35:00Z",
                    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
                    "refreshTokenExpiresAt": "2026-04-23T10:20:00Z",
                },
            }
        }
    )

    user: UserProfileResponse
    tokens: TokenBundleResponse


class CurrentUserResponse(UserProfileResponse):
    pass
