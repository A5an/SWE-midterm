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


def register_user(
    client: TestClient,
    *,
    email: str,
    display_name: str,
) -> dict[str, str]:
    response = client.post(
        "/v1/auth/register",
        json={
            "email": email,
            "password": "Sup3rSecure!",
            "displayName": display_name,
        },
    )
    assert response.status_code == 201
    access_token = response.json()["tokens"]["accessToken"]
    return {"Authorization": f"Bearer {access_token}"}


def create_document(client: TestClient, headers: dict[str, str]) -> dict[str, str]:
    response = client.post(
        "/v1/documents",
        json={
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
        },
        headers=headers,
    )
    assert response.status_code == 201
    return response.json()


def test_document_crud_requires_authentication() -> None:
    client = make_client()
    created = create_document(
        client,
        register_user(
            client,
            email="owner@example.com",
            display_name="Owner",
        ),
    )

    unauthenticated_list = client.get("/v1/documents")
    assert unauthenticated_list.status_code == 401
    assert unauthenticated_list.json()["error"]["code"] == "AUTHN_REQUIRED"

    unauthenticated_load = client.get(f"/v1/documents/{created['documentId']}")
    assert unauthenticated_load.status_code == 401
    assert unauthenticated_load.json()["error"]["code"] == "AUTHN_REQUIRED"

    unauthenticated_patch = client.patch(
        f"/v1/documents/{created['documentId']}",
        json={
            "title": "Blocked",
            "content": {"type": "doc", "content": []},
        },
    )
    assert unauthenticated_patch.status_code == 401
    assert unauthenticated_patch.json()["error"]["code"] == "AUTHN_REQUIRED"

    unauthenticated_delete = client.delete(f"/v1/documents/{created['documentId']}")
    assert unauthenticated_delete.status_code == 401
    assert unauthenticated_delete.json()["error"]["code"] == "AUTHN_REQUIRED"


def test_authenticated_owner_can_list_load_update_and_delete_documents() -> None:
    client = make_client()
    headers = register_user(
        client,
        email="documents@example.com",
        display_name="Document Tester",
    )

    created = create_document(client, headers)

    list_response = client.get("/v1/documents", headers=headers)
    assert list_response.status_code == 200
    list_body = list_response.json()
    assert len(list_body["documents"]) == 1
    assert list_body["documents"][0]["documentId"] == created["documentId"]
    assert list_body["documents"][0]["effectiveRole"] == "owner"

    load_response = client.get(f"/v1/documents/{created['documentId']}", headers=headers)
    assert load_response.status_code == 200
    assert load_response.json()["content"]["content"][0]["text"] == "Initial content from FastAPI."

    patch_response = client.patch(
        f"/v1/documents/{created['documentId']}",
        json={
            "title": "Q3 Product Brief (Edited)",
            "content": {
                "type": "doc",
                "content": [
                    {
                        "type": "paragraph",
                        "text": "Updated content from FastAPI.",
                    }
                ],
            },
        },
        headers=headers,
    )
    assert patch_response.status_code == 200
    patched = patch_response.json()
    assert patched["title"] == "Q3 Product Brief (Edited)"
    assert patched["currentVersionId"] == "ver_002"
    assert patched["content"]["content"][0]["text"] == "Updated content from FastAPI."

    delete_response = client.delete(f"/v1/documents/{created['documentId']}", headers=headers)
    assert delete_response.status_code == 204
    assert delete_response.text == ""

    missing_after_delete = client.get(f"/v1/documents/{created['documentId']}", headers=headers)
    assert missing_after_delete.status_code == 404
    assert missing_after_delete.json()["error"]["code"] == "DOCUMENT_NOT_FOUND"

    list_after_delete = client.get("/v1/documents", headers=headers)
    assert list_after_delete.status_code == 200
    assert list_after_delete.json()["documents"] == []


def test_documents_alias_routes_remain_compatible() -> None:
    client = make_client()
    headers = register_user(
        client,
        email="compat@example.com",
        display_name="Compat Tester",
    )

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

    list_response = client.get("/documents", headers=headers)
    assert list_response.status_code == 200
    assert list_response.json()["documents"][0]["documentId"] == document_id

    patch_response = client.patch(
        f"/documents/{document_id}",
        json={
            "title": "Compatibility Route Updated",
            "content": {
                "type": "doc",
                "content": [],
            },
        },
        headers=headers,
    )
    assert patch_response.status_code == 200
    assert patch_response.json()["title"] == "Compatibility Route Updated"

    delete_response = client.delete(f"/documents/{document_id}", headers=headers)
    assert delete_response.status_code == 204


def test_non_owner_is_forbidden_from_fastapi_document_crud() -> None:
    client = make_client()
    owner_headers = register_user(
        client,
        email="owner-only@example.com",
        display_name="Owner",
    )
    other_headers = register_user(
        client,
        email="other@example.com",
        display_name="Other User",
    )
    created = create_document(client, owner_headers)

    forbidden_load = client.get(f"/v1/documents/{created['documentId']}", headers=other_headers)
    assert forbidden_load.status_code == 403
    assert forbidden_load.json()["error"]["code"] == "AUTHZ_FORBIDDEN"

    forbidden_patch = client.patch(
        f"/v1/documents/{created['documentId']}",
        json={
            "title": "Intrusion",
            "content": {"type": "doc", "content": []},
        },
        headers=other_headers,
    )
    assert forbidden_patch.status_code == 403
    assert forbidden_patch.json()["error"]["code"] == "AUTHZ_FORBIDDEN"

    forbidden_delete = client.delete(f"/v1/documents/{created['documentId']}", headers=other_headers)
    assert forbidden_delete.status_code == 403
    assert forbidden_delete.json()["error"]["code"] == "AUTHZ_FORBIDDEN"


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
        headers=register_user(
            client,
            email="validation@example.com",
            display_name="Validation Tester",
        ),
    )

    assert response.status_code == 400
    body = response.json()
    assert body["error"]["code"] == "VALIDATION_ERROR"
    assert body["error"]["retryable"] is False
    assert body["error"]["requestId"].startswith("req_")


def test_missing_document_uses_standard_error_envelope() -> None:
    client = make_client()
    headers = register_user(
        client,
        email="missing@example.com",
        display_name="Missing Tester",
    )

    response = client.get("/v1/documents/doc_missing", headers=headers)

    assert response.status_code == 404
    body = response.json()
    assert body["error"]["code"] == "DOCUMENT_NOT_FOUND"
    assert body["error"]["retryable"] is False
    assert body["error"]["requestId"].startswith("req_")


def test_unknown_route_uses_route_not_found_envelope() -> None:
    client = make_client()

    response = client.get("/not-a-route")

    assert response.status_code == 404
    body = response.json()
    assert body["error"]["code"] == "ROUTE_NOT_FOUND"
    assert body["error"]["message"] == "No route for GET /not-a-route."
