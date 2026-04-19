# LIN-TEA-8 Evidence Bundle

- Linear issue: `LIN-TEA-8`
- Branch used in this workspace: `feat/LIN-TEA-8-fastapi-skeleton`
- Current PR: `https://github.com/A5an/SWE-midterm/pull/3`
- Evidence generated from commit: `6636166c8ac78485a1b35d8bc67c83f37c3e9f44`

## What changed and why

- Switched the canonical FastAPI document routes to `/v1/documents` and `/v1/documents/{documentId}` so the implementation matches the Part 2 architecture and current frontend contract.
- Kept `/documents` and `/documents/{documentId}` as hidden compatibility aliases so existing callers still work during migration.
- Kept the repo-level runtime, test gate, and demo baseline unchanged so TEA-8 stays limited to the backend skeleton, migrated create/load endpoints, backend tests, and this evidence bundle.
- Re-ran the backend-only create/load proof against the canonical `/v1/*` routes and refreshed the captured server/test logs.
- Recorded a stable evidence commit reference instead of the moving PR head so follow-up metadata commits do not stale the proof package.

## Artifacts

- `startup.log`: FastAPI server startup and successful request log.
- `curl-create-load.txt`: `POST /v1/documents` and `GET /v1/documents/{id}` transcript.
- `pytest.txt`: `python3 -m pytest backend/tests` for the canonical `/v1/documents` flow plus compatibility aliases.
