from __future__ import annotations

from typing import Any, Optional, Union

from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError

from backend.app.models import ApiError, ApiErrorEnvelope


class ApiApplicationError(Exception):
    def __init__(
        self,
        *,
        status_code: int,
        code: str,
        message: str,
        retryable: bool = False,
        details: Optional[dict[str, Any]] = None,
    ) -> None:
        self.status_code = status_code
        self.code = code
        self.message = message
        self.retryable = retryable
        self.details = details
        super().__init__(message)


def error_message_from_validation(exc: Union[ValidationError, RequestValidationError]) -> str:
    first_error = exc.errors()[0] if exc.errors() else {}
    message = first_error.get("msg")
    if isinstance(message, str) and message:
        return message
    return "Request body failed validation."


def build_error_envelope(
    request_id: str,
    *,
    code: str,
    message: str,
    retryable: bool,
    details: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    envelope = ApiErrorEnvelope(
        error=ApiError(
            code=code,
            message=message,
            retryable=retryable,
            requestId=request_id,
            details=details,
        )
    )
    return envelope.model_dump(mode="json")
