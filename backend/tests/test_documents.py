from __future__ import annotations

from fastapi.testclient import TestClient

from backend.app.main import create_app


def make_client() -> TestClient:
    return TestClient(create_app())


def test_create_document_returns_metadata_contract() -> None:
    client = make_client()

    response = client.post(
        "/documents",
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
    )

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

    created = client.post(
        "/documents",
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
    ).json()

    response = client.get(f"/documents/{created['documentId']}")

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


def test_v1_routes_remain_compatible_for_existing_frontend() -> None:
    client = make_client()

    create_response = client.post(
        "/v1/documents",
        json={
            "workspaceId": "ws_123",
            "title": "Compatibility Route",
            "templateId": None,
            "initialContent": {
                "type": "doc",
                "content": [],
            },
        },
    )

    assert create_response.status_code == 201
    document_id = create_response.json()["documentId"]

    load_response = client.get(f"/v1/documents/{document_id}")
    assert load_response.status_code == 200
    assert load_response.json()["documentId"] == document_id


def test_missing_document_uses_standard_error_envelope() -> None:
    client = make_client()

    response = client.get("/documents/doc_missing")

    assert response.status_code == 404
    body = response.json()
    assert body["error"]["code"] == "DOCUMENT_NOT_FOUND"
    assert body["error"]["retryable"] is False
    assert body["error"]["requestId"].startswith("req_")


def test_invalid_document_payload_uses_standard_error_envelope() -> None:
    client = make_client()

    response = client.post(
        "/documents",
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
