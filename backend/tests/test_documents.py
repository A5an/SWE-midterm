from __future__ import annotations

from fastapi.testclient import TestClient

from backend.app.main import create_app
from backend.app.security import AuthSettings


def make_client() -> TestClient:
    settings = AuthSettings(
        access_secret="test-access-secret",
        refresh_secret="test-refresh-secret",
        access_ttl_seconds=900,
        refresh_ttl_seconds=60 * 60 * 24,
        issuer="pytest-suite",
    )
    return TestClient(create_app(auth_settings=settings))


def auth_headers(client: TestClient) -> dict[str, str]:
    response = client.post(
        "/v1/auth/register",
        json={
            "email": "documents@example.com",
            "password": "Sup3rSecure!",
            "displayName": "Document Tester",
        },
    )
    assert response.status_code == 201
    access_token = response.json()["tokens"]["accessToken"]
    return {"Authorization": f"Bearer {access_token}"}


def test_create_document_returns_metadata_contract() -> None:
    client = make_client()
    create_payload = {
        "workspaceId": "ws_123",
        "title": "Q3 Product Brief",
        "templateId": None,
        "initialContent": {
            "type": "doc",
            "content": [
                {
                    "type": "paragraph",
                    "text": "Initial content from FastAPI.",
                }
            ],
        },
    }

    unauthenticated = client.post(
        "/v1/documents",
        json=create_payload,
    )
    assert unauthenticated.status_code == 401
    assert unauthenticated.json()["error"]["code"] == "AUTHN_REQUIRED"

    response = client.post("/v1/documents", json=create_payload, headers=auth_headers(client))

    assert response.status_code == 201
    body = response.json()
    assert body["documentId"].startswith("doc_")
    assert body["workspaceId"] == "ws_123"
    assert body["title"] == "Q3 Product Brief"
    assert body["ownerRole"] == "owner"
    assert body["currentVersionId"] == "ver_001"
    assert "createdAt" in body


def test_load_document_returns_content_contract() -> None:
    client = make_client()
    headers = auth_headers(client)

    created = client.post(
        "/v1/documents",
        json={
            "workspaceId": "ws_123",
            "title": "Load Test",
            "templateId": None,
            "initialContent": {
                "type": "doc",
                "content": [
                    {
                        "type": "paragraph",
                        "text": "Load me back.",
                    }
                ],
            },
        },
        headers=headers,
    ).json()

    unauthenticated = client.get(f"/v1/documents/{created['documentId']}")
    assert unauthenticated.status_code == 401
    assert unauthenticated.json()["error"]["code"] == "AUTHN_REQUIRED"

    response = client.get(f"/v1/documents/{created['documentId']}", headers=headers)

    assert response.status_code == 200
    body = response.json()
    assert body["documentId"] == created["documentId"]
    assert body["workspaceId"] == "ws_123"
    assert body["content"] == {
        "type": "doc",
        "content": [
            {
                "type": "paragraph",
                "text": "Load me back.",
            }
        ],
    }
    assert "updatedAt" in body


def test_documents_alias_remains_compatible() -> None:
    client = make_client()
    headers = auth_headers(client)

    create_response = client.post(
        "/documents",
        json={
            "workspaceId": "ws_123",
            "title": "Compatibility Route",
            "templateId": None,
            "initialContent": {
                "type": "doc",
                "content": [],
            },
        },
        headers=headers,
    )

    assert create_response.status_code == 201
    document_id = create_response.json()["documentId"]

    load_response = client.get(f"/documents/{document_id}", headers=headers)
    assert load_response.status_code == 200
    assert load_response.json()["documentId"] == document_id


def test_missing_document_uses_standard_error_envelope() -> None:
    client = make_client()
    headers = auth_headers(client)

    response = client.get("/v1/documents/doc_missing", headers=headers)

    assert response.status_code == 404
    body = response.json()
    assert body["error"]["code"] == "DOCUMENT_NOT_FOUND"
    assert body["error"]["retryable"] is False
    assert body["error"]["requestId"].startswith("req_")


def test_invalid_document_payload_uses_standard_error_envelope() -> None:
    client = make_client()

    response = client.post(
        "/v1/documents",
        json={
            "workspaceId": "ws_123",
            "title": "Invalid",
            "templateId": None,
            "initialContent": {
                "type": "doc",
                "content": [
                    {
                        "type": "paragraph",
                        "text": 42,
                    }
                ],
            },
        },
        headers=auth_headers(client),
    )

    assert response.status_code == 400
    body = response.json()
    assert body["error"]["code"] == "VALIDATION_ERROR"
    assert body["error"]["retryable"] is False
    assert body["error"]["requestId"].startswith("req_")


def test_unknown_route_uses_route_not_found_envelope() -> None:
    client = make_client()

    response = client.get("/not-a-route")

    assert response.status_code == 404
    body = response.json()
    assert body["error"]["code"] == "ROUTE_NOT_FOUND"
    assert body["error"]["message"] == "No route for GET /not-a-route."
