from __future__ import annotations

import json

from fastapi import APIRouter, Request, status
from pydantic import ValidationError

from backend.app.errors import ApiApplicationError, error_message_from_validation
from backend.app.models import (
    ApiErrorEnvelope,
    CreateDocumentRequest,
    DocumentDetailResponse,
    DocumentMetadataResponse,
)
from backend.app.services.document_store import DocumentStore

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


async def _create_document(request: Request) -> DocumentMetadataResponse:
    payload = await _parse_create_document_request(request)
    store = _get_store(request)
    return store.create(payload)


def _load_document(document_id: str, request: Request) -> DocumentDetailResponse:
    store = _get_store(request)
    found = store.get(document_id)
    if found is None:
        raise ApiApplicationError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="DOCUMENT_NOT_FOUND",
            message=f"Document '{document_id}' does not exist.",
        )
    return found


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
    "/documents",
    status_code=status.HTTP_201_CREATED,
    response_model=DocumentMetadataResponse,
    responses={400: {"model": ApiErrorEnvelope}},
    summary="Create a document",
    description="Creates a document in the in-memory PoC store and returns document metadata.",
)
async def create_document(request: Request) -> DocumentMetadataResponse:
    return await _create_document(request)


@router.post(
    "/v1/documents",
    status_code=status.HTTP_201_CREATED,
    response_model=DocumentMetadataResponse,
    responses={400: {"model": ApiErrorEnvelope}},
    include_in_schema=False,
)
async def create_document_v1(request: Request) -> DocumentMetadataResponse:
    return await _create_document(request)


@router.get(
    "/documents/{document_id}",
    response_model=DocumentDetailResponse,
    responses={404: {"model": ApiErrorEnvelope}},
    summary="Load a document",
    description="Returns document metadata plus the current content snapshot.",
)
async def load_document(document_id: str, request: Request) -> DocumentDetailResponse:
    return _load_document(document_id, request)


@router.get(
    "/v1/documents/{document_id}",
    response_model=DocumentDetailResponse,
    responses={404: {"model": ApiErrorEnvelope}},
    include_in_schema=False,
)
async def load_document_v1(document_id: str, request: Request) -> DocumentDetailResponse:
    return _load_document(document_id, request)
