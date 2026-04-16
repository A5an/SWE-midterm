from __future__ import annotations

from fastapi.testclient import TestClient

from backend.app.main import create_app
from backend.app.security import AuthSettings, verify_password


def make_client() -> TestClient:
    settings = AuthSettings(
        access_secret="test-access-secret",
        refresh_secret="test-refresh-secret",
        access_ttl_seconds=900,
        refresh_ttl_seconds=60 * 60 * 24,
        issuer="pytest-suite",
    )
    return TestClient(create_app(auth_settings=settings))


def register_user(client: TestClient) -> dict[str, object]:
    response = client.post(
        "/v1/auth/register",
        json={
            "email": "user@example.com",
            "password": "Sup3rSecure!",
            "displayName": "JWT Tester",
        },
    )
    assert response.status_code == 201
    return response.json()


def test_register_hashes_password_and_returns_token_pair() -> None:
    client = make_client()

    response = client.post(
        "/v1/auth/register",
        json={
            "email": "user@example.com",
            "password": "Sup3rSecure!",
            "displayName": "JWT Tester",
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["user"]["email"] == "user@example.com"
    assert body["tokens"]["tokenType"] == "bearer"
    assert body["tokens"]["accessToken"]
    assert body["tokens"]["refreshToken"]

    stored_user = client.app.state.auth_store.get_user_by_email("user@example.com")
    assert stored_user is not None
    assert stored_user.password_hash != "Sup3rSecure!"
    assert verify_password("Sup3rSecure!", stored_user.password_hash)


def test_login_returns_fresh_access_and_refresh_tokens() -> None:
    client = make_client()
    registered = register_user(client)

    response = client.post(
        "/v1/auth/login",
        json={
            "email": "user@example.com",
            "password": "Sup3rSecure!",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["user"]["userId"] == registered["user"]["userId"]
    assert body["tokens"]["accessToken"] != registered["tokens"]["accessToken"]
    assert body["tokens"]["refreshToken"] != registered["tokens"]["refreshToken"]


def test_refresh_rotates_refresh_token_and_revokes_old_one() -> None:
    client = make_client()
    registered = register_user(client)
    original_refresh = registered["tokens"]["refreshToken"]

    refreshed = client.post(
        "/v1/auth/refresh",
        json={"refreshToken": original_refresh},
    )

    assert refreshed.status_code == 200
    refreshed_body = refreshed.json()
    assert refreshed_body["tokens"]["refreshToken"] != original_refresh
    assert refreshed_body["tokens"]["accessToken"] != registered["tokens"]["accessToken"]

    replay = client.post(
        "/v1/auth/refresh",
        json={"refreshToken": original_refresh},
    )

    assert replay.status_code == 401
    assert replay.json()["error"]["code"] == "AUTHN_INVALID_TOKEN"


def test_protected_route_returns_401_without_token_and_200_with_valid_token() -> None:
    client = make_client()

    unauthenticated = client.get("/v1/me")
    assert unauthenticated.status_code == 401
    assert unauthenticated.json()["error"]["code"] == "AUTHN_REQUIRED"

    registered = register_user(client)
    access_token = registered["tokens"]["accessToken"]

    authenticated = client.get(
        "/v1/me",
        headers={"Authorization": f"Bearer {access_token}"},
    )

    assert authenticated.status_code == 200
    body = authenticated.json()
    assert body["email"] == "user@example.com"
    assert body["displayName"] == "JWT Tester"


def test_login_rejects_invalid_credentials() -> None:
    client = make_client()
    register_user(client)

    response = client.post(
        "/v1/auth/login",
        json={
            "email": "user@example.com",
            "password": "wrong-password",
        },
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AUTHN_INVALID_CREDENTIALS"
