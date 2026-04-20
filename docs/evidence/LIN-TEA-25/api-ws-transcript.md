# API / WS Transcript

## Main App Auth Recovery

- Request: protected `GET /v1/documents` from the main editor app with an expired FastAPI-backed access token.
- Result: first response returned `401 AUTH_INVALID_TOKEN`, the app called `POST /v1/auth/refresh`, updated the stored session, retried once, and recovered the dashboard list successfully.
- Evidence source: `apps/web/src/App.test.ts`, `web-test-log.txt`.

## Document Delete

- Request: owner `DELETE /v1/documents/{documentId}` in `apps/api`.
- Result: returned `204 No Content`, the document disappeared from subsequent dashboard list responses, and later document load returned `404 DOCUMENT_NOT_FOUND`.
- Evidence source: `apps/api/src/contract-test.ts`, `web-test-log.txt`, `api-contract-test-log.txt`.

## AI Prompt / History

- Request: `POST /v1/documents/{documentId}/ai/jobs` with selection context `{ before, after }`.
- Result: provider prompt includes both context fields, and per-document AI history retains `promptSystem`, `promptUser`, `contextBefore`, and `contextAfter`.
- Evidence source: `apps/api/src/provider-test.ts`, `apps/api/src/contract-test.ts`, `api-provider-test-log.txt`, `api-contract-test-log.txt`.

## FastAPI CRUD Proof

- Requests: authenticated `GET /v1/documents`, `POST /v1/documents`, `GET /v1/documents/{id}`, `PATCH /v1/documents/{id}`, `DELETE /v1/documents/{id}`.
- Result: owner-scoped CRUD succeeds, unauthenticated requests return `401 AUTHN_REQUIRED`, and non-owner access returns `403 AUTHZ_FORBIDDEN`.
- Evidence source: `backend/tests/test_documents.py`, `fastapi-pytest-log.txt`.
