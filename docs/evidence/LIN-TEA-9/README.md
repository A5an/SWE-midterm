# LIN-TEA-9 Evidence Bundle

- Linear issue: `LIN-TEA-9`
- Branch used in this workspace: `feat/LIN-TEA-9-JWT-auth-lifecycle`
- Current PR: `https://github.com/A5an/SWE-midterm/pull/4`

## What changed and why

- Bound access-token authorization on `GET /v1/me` to the active refresh-session state so stale pre-refresh access tokens are denied after refresh rotation, satisfying the TEA-9 `FR-UM-03` blocker.
- Replaced the temporary auth role value `member` with the documented repository role vocabulary by returning `workspaceRole: "owner"` in the TEA-9 auth proof payloads.
- Synced `feat/LIN-TEA-9-JWT-auth-lifecycle` with the current `main` branch before re-running the auth evidence.
- Refreshed the TEA-9 transcripts, screenshots, pytest log, and startup log so the evidence bundle matches the final reviewable PR state.

## Artifacts

- `pytest.txt`: backend pytest run covering auth lifecycle plus existing document endpoints.
- `api-transcript.txt`: live register/login/refresh/protected-route transcript captured against the local FastAPI server, including stale-access rejection after refresh rotation.
- `api-auth-lifecycle.txt`: compact response summary used to produce the auth lifecycle screenshot.
- `api-auth-lifecycle.png`: screenshot-style evidence image showing refresh rotation, stale-access rejection, and the documented role vocabulary in the protected response.
- `api-protected-route.txt`: compact response summary used to produce the protected-route screenshot.
- `api-protected-route.png`: screenshot-style evidence image showing `401` without a token, `401` with a stale pre-refresh token, and `200` with the rotated valid access token.
- `startup.log`: uvicorn startup plus request log from the evidence run.
