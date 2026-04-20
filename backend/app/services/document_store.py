from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional
from uuid import uuid4

from backend.app.models import (
    CreateDocumentRequest,
    DocumentContent,
    DocumentDetailResponse,
    DocumentListItemResponse,
    DocumentListResponse,
    DocumentMetadataResponse,
    UpdateDocumentRequest,
)


@dataclass
class StoredDocument:
    metadata: DocumentMetadataResponse
    owner_user_id: str
    content: DocumentContent
    updated_at: datetime
    version_number: int


class DocumentStore:
    def __init__(self) -> None:
        self._documents: dict[str, StoredDocument] = {}

    def create(self, payload: CreateDocumentRequest, owner_user_id: str) -> DocumentMetadataResponse:
        now = datetime.now(timezone.utc)
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
            owner_user_id=owner_user_id,
            content=payload.initialContent,
            updated_at=now,
            version_number=1,
        )
        return metadata

    def get_stored(self, document_id: str) -> Optional[StoredDocument]:
        return self._documents.get(document_id)

    def _to_detail(self, found: StoredDocument) -> DocumentDetailResponse:
        return DocumentDetailResponse(
            **found.metadata.model_dump(),
            content=found.content,
            updatedAt=found.updated_at,
        )

    def get(self, document_id: str) -> Optional[DocumentDetailResponse]:
        found = self.get_stored(document_id)
        if found is None:
            return None

        return self._to_detail(found)

    def list_for_owner(self, owner_user_id: str) -> DocumentListResponse:
        documents = [
            DocumentListItemResponse(
                documentId=stored.metadata.documentId,
                workspaceId=stored.metadata.workspaceId,
                title=stored.metadata.title,
                effectiveRole="owner",
                createdAt=stored.metadata.createdAt,
                updatedAt=stored.updated_at,
                preview=self._preview(stored.content),
            )
            for stored in self._documents.values()
            if stored.owner_user_id == owner_user_id
        ]
        documents.sort(key=lambda document: (document.updatedAt, document.title), reverse=True)
        return DocumentListResponse(documents=documents)

    def update(self, document_id: str, payload: UpdateDocumentRequest) -> Optional[DocumentDetailResponse]:
        found = self.get_stored(document_id)
        if found is None:
            return None

        found.content = payload.content
        if payload.title is not None:
            found.metadata.title = payload.title
        found.updated_at = datetime.now(timezone.utc)
        found.version_number += 1
        found.metadata.currentVersionId = f"ver_{found.version_number:03d}"
        return self._to_detail(found)

    def delete(self, document_id: str) -> bool:
        if document_id not in self._documents:
            return False
        del self._documents[document_id]
        return True

    def _preview(self, content: DocumentContent, max_length: int = 140) -> str:
        preview = " ".join(block.text.strip() for block in content.content if block.text.strip()).strip()
        if len(preview) <= max_length:
            return preview
        return f"{preview[: max_length - 1].rstrip()}…"
