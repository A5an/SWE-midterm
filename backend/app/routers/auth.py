from __future__ import annotations

import json
from typing import Optional, TypeVar

from fastapi import APIRouter, Depends, Header, Request, status
from pydantic import BaseModel, ValidationError

from backend.app.errors import ApiApplicationError, error_message_from_validation
from backend.app.models import (
    ApiErrorEnvelope,
    AuthResponse,
    CurrentUserResponse,
    LoginRequest,
    RefreshTokenRequest,
    RegisterUserRequest,
    TokenBundleResponse,
    UserProfileResponse,
)
from backend.app.security import (
    AuthSettings,
    IssuedToken,
    TokenExpiredError,
    TokenValidationError,
    create_access_token,
    create_refresh_token,
    decode_access_token,
    decode_refresh_token,
    hash_password,
    verify_password,
)
from backend.app.services.auth_store import AuthStore, SessionNotFoundError, StoredUser, UserAlreadyExistsError

router = APIRouter(prefix="/v1", tags=["auth"])
ModelT = TypeVar("ModelT", bound=BaseModel)


def _get_auth_store(request: Request) -> AuthStore:
    return request.app.state.auth_store


def _get_auth_settings(request: Request) -> AuthSettings:
    return request.app.state.auth_settings


async def _parse_request_model(request: Request, model_type: type[ModelT]) -> ModelT:
    try:
        payload = json.loads(await request.body())
    except json.JSONDecodeError as exc:
        raise ApiApplicationError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="MALFORMED_REQUEST",
            message="Malformed JSON body.",
        ) from exc

    try:
        return model_type.model_validate(payload)
    except ValidationError as exc:
        raise ApiApplicationError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="VALIDATION_ERROR",
            message=error_message_from_validation(exc),
        ) from exc


def _build_auth_response(
    *,
    user: StoredUser,
    access_token: IssuedToken,
    refresh_token: IssuedToken,
) -> AuthResponse:
    return AuthResponse(
        user=UserProfileResponse(
            userId=user.user_id,
            email=user.email,
            displayName=user.display_name,
            workspaceRole=user.workspace_role,
            createdAt=user.created_at,
        ),
        tokens=TokenBundleResponse(
            tokenType="bearer",
            accessToken=access_token.value,
            accessTokenExpiresAt=access_token.expires_at,
            refreshToken=refresh_token.value,
            refreshTokenExpiresAt=refresh_token.expires_at,
        ),
    )


def _build_tokens_for_user(
    *,
    user: StoredUser,
    store: AuthStore,
    settings: AuthSettings,
    refresh_session_id: Optional[str] = None,
) -> AuthResponse:
    refresh_session = (
        store.rotate_refresh_session(
            session_id=refresh_session_id,
            user_id=user.user_id,
            ttl_seconds=settings.refresh_ttl_seconds,
        )
        if refresh_session_id is not None
        else store.create_refresh_session(user_id=user.user_id, ttl_seconds=settings.refresh_ttl_seconds)
    )
    access_token = create_access_token(user_id=user.user_id, session_id=refresh_session.session_id, settings=settings)
    refresh_token = create_refresh_token(
        user_id=user.user_id,
        session_id=refresh_session.session_id,
        settings=settings,
    )
    return _build_auth_response(user=user, access_token=access_token, refresh_token=refresh_token)


def _extract_bearer_token(authorization: Optional[str]) -> str:
    if authorization is None or not authorization.strip():
        raise ApiApplicationError(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTHN_REQUIRED",
            message="Bearer access token is required.",
        )

    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise ApiApplicationError(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTHN_INVALID_TOKEN",
            message="Authorization header must use Bearer token format.",
        )
    return token.strip()


def get_current_user(request: Request, authorization: Optional[str] = Header(default=None)) -> StoredUser:
    token = _extract_bearer_token(authorization)
    settings = _get_auth_settings(request)
    store = _get_auth_store(request)
    try:
        claims = decode_access_token(token, settings)
        store.assert_refresh_session_active(session_id=claims.session_id, user_id=claims.subject)
    except TokenExpiredError as exc:
        raise ApiApplicationError(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTHN_TOKEN_EXPIRED",
            message="Access token has expired.",
        ) from exc
    except (SessionNotFoundError, TokenValidationError) as exc:
        raise ApiApplicationError(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTHN_INVALID_TOKEN",
            message="Access token is invalid.",
        ) from exc

    user = store.get_user_by_id(claims.subject)
    if user is None:
        raise ApiApplicationError(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTHN_INVALID_TOKEN",
            message="Access token subject no longer exists.",
        )
    return user


@router.post(
    "/auth/register",
    status_code=status.HTTP_201_CREATED,
    response_model=AuthResponse,
    responses={400: {"model": ApiErrorEnvelope}, 409: {"model": ApiErrorEnvelope}},
    summary="Register a user account",
    description="Creates an in-memory user with a hashed password and returns access and refresh tokens.",
)
async def register_user(request: Request) -> AuthResponse:
    payload = await _parse_request_model(request, RegisterUserRequest)
    settings = _get_auth_settings(request)
    store = _get_auth_store(request)

    try:
        user = store.register_user(
            email=payload.email,
            display_name=payload.displayName,
            password_hash=hash_password(payload.password),
        )
    except UserAlreadyExistsError as exc:
        raise ApiApplicationError(
            status_code=status.HTTP_409_CONFLICT,
            code="AUTHN_USER_EXISTS",
            message=f"User '{payload.email}' already exists.",
        ) from exc

    return _build_tokens_for_user(user=user, store=store, settings=settings)


@router.post(
    "/auth/login",
    response_model=AuthResponse,
    responses={400: {"model": ApiErrorEnvelope}, 401: {"model": ApiErrorEnvelope}},
    summary="Log in with email and password",
    description="Validates user credentials and returns a fresh access and refresh token pair.",
)
async def login_user(request: Request) -> AuthResponse:
    payload = await _parse_request_model(request, LoginRequest)
    settings = _get_auth_settings(request)
    store = _get_auth_store(request)
    user = store.get_user_by_email(payload.email)
    if user is None or not verify_password(payload.password, user.password_hash):
        raise ApiApplicationError(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTHN_INVALID_CREDENTIALS",
            message="Email or password is incorrect.",
        )

    return _build_tokens_for_user(user=user, store=store, settings=settings)


@router.post(
    "/auth/refresh",
    response_model=AuthResponse,
    responses={400: {"model": ApiErrorEnvelope}, 401: {"model": ApiErrorEnvelope}},
    summary="Refresh access and refresh tokens",
    description="Rotates the refresh token session and returns a new token pair.",
)
async def refresh_tokens(request: Request) -> AuthResponse:
    payload = await _parse_request_model(request, RefreshTokenRequest)
    settings = _get_auth_settings(request)
    store = _get_auth_store(request)
    try:
        claims = decode_refresh_token(payload.refreshToken, settings)
        store.assert_refresh_session_active(session_id=claims.session_id, user_id=claims.subject)
    except TokenExpiredError as exc:
        raise ApiApplicationError(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTHN_TOKEN_EXPIRED",
            message="Refresh token has expired.",
        ) from exc
    except (SessionNotFoundError, TokenValidationError) as exc:
        raise ApiApplicationError(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTHN_INVALID_TOKEN",
            message="Refresh token is invalid.",
        ) from exc

    user = store.get_user_by_id(claims.subject)
    if user is None:
        raise ApiApplicationError(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="AUTHN_INVALID_TOKEN",
            message="Refresh token subject no longer exists.",
        )

    return _build_tokens_for_user(
        user=user,
        store=store,
        settings=settings,
        refresh_session_id=claims.session_id,
    )


@router.get(
    "/me",
    response_model=CurrentUserResponse,
    responses={401: {"model": ApiErrorEnvelope}},
    summary="Get the current authenticated user",
    description="Proof endpoint for the JWT lifecycle that returns 401 without a valid access token and 200 when authenticated.",
)
async def get_me(current_user: StoredUser = Depends(get_current_user)) -> CurrentUserResponse:
    user = current_user
    return CurrentUserResponse(
        userId=user.user_id,
        email=user.email,
        displayName=user.display_name,
        workspaceRole=user.workspace_role,
        createdAt=user.created_at,
    )
