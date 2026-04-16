from __future__ import annotations

from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from backend.app.errors import ApiApplicationError, build_error_envelope, error_message_from_validation
from backend.app.routers.auth import router as auth_router
from backend.app.routers.documents import router as documents_router
from backend.app.security import AuthSettings
from backend.app.services.auth_store import AuthStore
from backend.app.services.document_store import DocumentStore


def create_app(
    store: DocumentStore | None = None,
    auth_store: AuthStore | None = None,
    auth_settings: AuthSettings | None = None,
) -> FastAPI:
    app = FastAPI(
        title="SWE Midterm FastAPI Backend",
        summary="Assignment 2 FastAPI baseline for auth lifecycle and document create/load flows.",
        version="0.1.0",
        description=(
            "Minimal FastAPI backend used for the Assignment 2 baseline. "
            "It currently provides JWT-based register/login/refresh endpoints, a protected "
            "proof route, and the existing in-memory document create/load PoC endpoints "
            "while keeping the JSON response shape stable for the frontend."
        ),
    )

    app.state.document_store = store or DocumentStore()
    app.state.auth_store = auth_store or AuthStore()
    app.state.auth_settings = auth_settings or AuthSettings.from_env()

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization"],
    )

    @app.middleware("http")
    async def attach_request_id(request: Request, call_next):
        request_id = f"req_{uuid4().hex[:12]}"
        request.state.request_id = request_id
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        return response

    @app.exception_handler(ApiApplicationError)
    async def handle_api_error(request: Request, exc: ApiApplicationError) -> JSONResponse:
        request_id = getattr(request.state, "request_id", f"req_{uuid4().hex[:12]}")
        return JSONResponse(
            status_code=exc.status_code,
            content=build_error_envelope(
                request_id,
                code=exc.code,
                message=exc.message,
                retryable=exc.retryable,
                details=exc.details,
            ),
        )

    @app.exception_handler(RequestValidationError)
    async def handle_request_validation_error(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        request_id = getattr(request.state, "request_id", f"req_{uuid4().hex[:12]}")
        return JSONResponse(
            status_code=400,
            content=build_error_envelope(
                request_id,
                code="VALIDATION_ERROR",
                message=error_message_from_validation(exc),
                retryable=False,
            ),
        )

    @app.exception_handler(StarletteHTTPException)
    async def handle_http_exception(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        request_id = getattr(request.state, "request_id", f"req_{uuid4().hex[:12]}")
        if exc.status_code == 404:
            return JSONResponse(
                status_code=404,
                content=build_error_envelope(
                    request_id,
                    code="ROUTE_NOT_FOUND",
                    message=f"No route for {request.method} {request.url.path}.",
                    retryable=False,
                ),
            )

        return JSONResponse(
            status_code=exc.status_code,
            content=build_error_envelope(
                request_id,
                code="HTTP_ERROR",
                message=exc.detail if isinstance(exc.detail, str) else "HTTP error.",
                retryable=False,
            ),
        )

    app.include_router(auth_router)
    app.include_router(documents_router)

    return app


app = create_app()
