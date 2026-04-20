# LIN-TEA-25 Evidence

## What Changed And Why

This issue closes four rubric-sensitive baseline gaps without rewriting the platform:

1. The main editor app now silently refreshes the shared FastAPI JWT session once and retries protected document, sharing, version, collaboration-session bootstrap, and AI requests.
2. The Node API now exposes owner-only `DELETE /v1/documents/{id}`, and the web dashboard removes deleted documents immediately after a successful delete.
3. AI prompt assembly now includes the frontend-provided `before` / `after` context, and AI history retains the exact prompt and context used for each job.
4. The FastAPI proof service now supports authenticated in-memory list/create/load/update/delete document CRUD instead of only create/load.

## Evidence Files

- `web-test-log.txt`: Vitest coverage including silent refresh and delete UI flows.
- `api-contract-test-log.txt`: Node API + websocket contract coverage, including owner-only delete and AI history assertions.
- `api-provider-test-log.txt`: AI provider prompt/context coverage.
- `fastapi-pytest-log.txt`: FastAPI CRUD pytest coverage.
- `typecheck-log.txt`: repository typecheck output.
- `api-ws-transcript.md`: short transcript of the key protected/document/AI/session behaviors validated for this issue.
- `commit-and-pr-note.txt`: branch, base HEAD, and PR placeholder.
- `manual-ui-evidence-note.md`: note about headless CLI limitations for screenshots/video.
