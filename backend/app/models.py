from __future__ import annotations

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
