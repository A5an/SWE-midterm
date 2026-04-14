from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import uuid4

from backend.app.models import (
    CreateDocumentRequest,
    DocumentContent,
    DocumentDetailResponse,
    DocumentMetadataResponse,
)


@dataclass(slots=True)
class StoredDocument:
    metadata: DocumentMetadataResponse
    content: DocumentContent
    updated_at: datetime


class DocumentStore:
    def __init__(self) -> None:
        self._documents: dict[str, StoredDocument] = {}

    def create(self, payload: CreateDocumentRequest) -> DocumentMetadataResponse:
        now = datetime.now(UTC)
        metadata = DocumentMetadataResponse(
            documentId=f"doc_{uuid4().hex[:8]}",
            workspaceId=payload.workspaceId,
            title=payload.title,
            ownerRole="owner",
            currentVersionId="ver_001",
            createdAt=now,
        )
        self._documents[metadata.documentId] = StoredDocument(
            metadata=metadata,
            content=payload.initialContent,
            updated_at=now,
        )
        return metadata

    def get(self, document_id: str) -> DocumentDetailResponse | None:
        found = self._documents.get(document_id)
        if found is None:
            return None

        return DocumentDetailResponse(
            **found.metadata.model_dump(),
            content=found.content,
            updatedAt=found.updated_at,
        )
