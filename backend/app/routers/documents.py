from __future__ import annotations

import json

from fastapi import APIRouter, Depends, Request, status
from pydantic import ValidationError

from backend.app.errors import ApiApplicationError, error_message_from_validation
from backend.app.models import (
    ApiErrorEnvelope,
    CreateDocumentRequest,
    DocumentDetailResponse,
    DocumentListResponse,
    DocumentMetadataResponse,
    UpdateDocumentRequest,
)
from backend.app.routers.auth import get_current_user
from backend.app.services.auth_store import StoredUser
from backend.app.services.document_store import DocumentStore, StoredDocument

router = APIRouter(tags=["documents"])


def _get_store(request: Request) -> DocumentStore:
    return request.app.state.document_store


async def _parse_create_document_request(request: Request) -> CreateDocumentRequest:
    try:
        raw_payload = await request.body()
        payload = json.loads(raw_payload)
    except json.JSONDecodeError as exc:
        raise ApiApplicationError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="MALFORMED_REQUEST",
            message="Malformed JSON body.",
        ) from exc

    try:
        return CreateDocumentRequest.model_validate(payload)
    except ValidationError as exc:
        raise ApiApplicationError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="VALIDATION_ERROR",
            message=error_message_from_validation(exc),
        ) from exc


async def _create_document(request: Request, user: StoredUser) -> DocumentMetadataResponse:
    payload = await _parse_create_document_request(request)
    store = _get_store(request)
    return store.create(payload, user.user_id)


async def _parse_update_document_request(request: Request) -> UpdateDocumentRequest:
    try:
        raw_payload = await request.body()
        payload = json.loads(raw_payload)
    except json.JSONDecodeError as exc:
        raise ApiApplicationError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="MALFORMED_REQUEST",
            message="Malformed JSON body.",
        ) from exc

    try:
        return UpdateDocumentRequest.model_validate(payload)
    except ValidationError as exc:
        raise ApiApplicationError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="VALIDATION_ERROR",
            message=error_message_from_validation(exc),
        ) from exc


def _require_owned_document(document_id: str, request: Request, user: StoredUser) -> StoredDocument:
    store = _get_store(request)
    found = store.get_stored(document_id)
    if found is None:
        raise ApiApplicationError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="DOCUMENT_NOT_FOUND",
            message=f"Document '{document_id}' does not exist.",
        )
    if found.owner_user_id != user.user_id:
        raise ApiApplicationError(
            status_code=status.HTTP_403_FORBIDDEN,
            code="AUTHZ_FORBIDDEN",
            message=f"User '{user.user_id}' does not have access to document '{document_id}'.",
        )
    return found


def _to_detail(stored: StoredDocument, store: DocumentStore) -> DocumentDetailResponse:
    detail = store.get(stored.metadata.documentId)
    if detail is None:
        raise ApiApplicationError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="DOCUMENT_NOT_FOUND",
            message=f"Document '{stored.metadata.documentId}' does not exist.",
        )
    return detail


@router.get(
    "/health",
    summary="Health check",
    description="Returns a minimal status payload so startup can be verified quickly.",
)
async def health(request: Request) -> dict[str, str]:
    return {
        "status": "ok",
        "requestId": request.state.request_id,
    }


@router.post(
    "/v1/documents",
    status_code=status.HTTP_201_CREATED,
    response_model=DocumentMetadataResponse,
    responses={400: {"model": ApiErrorEnvelope}, 401: {"model": ApiErrorEnvelope}},
    summary="Create a document",
    description="Creates a document in the in-memory PoC store and returns document metadata for an authenticated user.",
)
async def create_document(
    request: Request,
    user: StoredUser = Depends(get_current_user),
) -> DocumentMetadataResponse:
    return await _create_document(request, user)


@router.post(
    "/documents",
    status_code=status.HTTP_201_CREATED,
    response_model=DocumentMetadataResponse,
    responses={400: {"model": ApiErrorEnvelope}, 401: {"model": ApiErrorEnvelope}},
    include_in_schema=False,
)
async def create_document_compat(
    request: Request,
    user: StoredUser = Depends(get_current_user),
) -> DocumentMetadataResponse:
    return await _create_document(request, user)


@router.get(
    "/v1/documents",
    response_model=DocumentListResponse,
    responses={401: {"model": ApiErrorEnvelope}},
    summary="List documents",
    description="Returns the current authenticated user's in-memory document list.",
)
async def list_documents(
    request: Request,
    user: StoredUser = Depends(get_current_user),
) -> DocumentListResponse:
    return _get_store(request).list_for_owner(user.user_id)


@router.get(
    "/documents",
    response_model=DocumentListResponse,
    responses={401: {"model": ApiErrorEnvelope}},
    include_in_schema=False,
)
async def list_documents_compat(
    request: Request,
    user: StoredUser = Depends(get_current_user),
) -> DocumentListResponse:
    return _get_store(request).list_for_owner(user.user_id)


@router.get(
    "/v1/documents/{document_id}",
    response_model=DocumentDetailResponse,
    responses={401: {"model": ApiErrorEnvelope}, 404: {"model": ApiErrorEnvelope}},
    summary="Load a document",
    description="Returns document metadata plus the current content snapshot for an authenticated user.",
)
async def load_document(
    document_id: str,
    request: Request,
    user: StoredUser = Depends(get_current_user),
) -> DocumentDetailResponse:
    store = _get_store(request)
    stored = _require_owned_document(document_id, request, user)
    return _to_detail(stored, store)


@router.get(
    "/documents/{document_id}",
    response_model=DocumentDetailResponse,
    responses={401: {"model": ApiErrorEnvelope}, 404: {"model": ApiErrorEnvelope}},
    include_in_schema=False,
)
async def load_document_compat(
    document_id: str,
    request: Request,
    user: StoredUser = Depends(get_current_user),
) -> DocumentDetailResponse:
    store = _get_store(request)
    stored = _require_owned_document(document_id, request, user)
    return _to_detail(stored, store)


@router.patch(
    "/v1/documents/{document_id}",
    response_model=DocumentDetailResponse,
    responses={400: {"model": ApiErrorEnvelope}, 401: {"model": ApiErrorEnvelope}, 403: {"model": ApiErrorEnvelope}, 404: {"model": ApiErrorEnvelope}},
    summary="Update a document",
    description="Updates document title/content in the in-memory store for the authenticated owner.",
)
async def update_document(
    document_id: str,
    request: Request,
    user: StoredUser = Depends(get_current_user),
) -> DocumentDetailResponse:
    _require_owned_document(document_id, request, user)
    payload = await _parse_update_document_request(request)
    updated = _get_store(request).update(document_id, payload)
    if updated is None:
        raise ApiApplicationError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="DOCUMENT_NOT_FOUND",
            message=f"Document '{document_id}' does not exist.",
        )
    return updated


@router.patch(
    "/documents/{document_id}",
    response_model=DocumentDetailResponse,
    responses={400: {"model": ApiErrorEnvelope}, 401: {"model": ApiErrorEnvelope}, 403: {"model": ApiErrorEnvelope}, 404: {"model": ApiErrorEnvelope}},
    include_in_schema=False,
)
async def update_document_compat(
    document_id: str,
    request: Request,
    user: StoredUser = Depends(get_current_user),
) -> DocumentDetailResponse:
    _require_owned_document(document_id, request, user)
    payload = await _parse_update_document_request(request)
    updated = _get_store(request).update(document_id, payload)
    if updated is None:
        raise ApiApplicationError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="DOCUMENT_NOT_FOUND",
            message=f"Document '{document_id}' does not exist.",
        )
    return updated


@router.delete(
    "/v1/documents/{document_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={401: {"model": ApiErrorEnvelope}, 403: {"model": ApiErrorEnvelope}, 404: {"model": ApiErrorEnvelope}},
    summary="Delete a document",
    description="Deletes a document from the in-memory store for the authenticated owner.",
)
async def delete_document(
    document_id: str,
    request: Request,
    user: StoredUser = Depends(get_current_user),
) -> None:
    _require_owned_document(document_id, request, user)
    _get_store(request).delete(document_id)


@router.delete(
    "/documents/{document_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={401: {"model": ApiErrorEnvelope}, 403: {"model": ApiErrorEnvelope}, 404: {"model": ApiErrorEnvelope}},
    include_in_schema=False,
)
async def delete_document_compat(
    document_id: str,
    request: Request,
    user: StoredUser = Depends(get_current_user),
) -> None:
    _require_owned_document(document_id, request, user)
    _get_store(request).delete(document_id)
