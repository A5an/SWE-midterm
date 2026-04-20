# LIN-TEA-24 Evidence Bundle

- Linear issue: `LIN-TEA-24`
- Branch used in this workspace: `feat/LIN-TEA-24-auth-compliance`
- Implementation commit: see `commit-hash.txt`
- PR: see `pr-link.txt`

## Issue
Rectify auth compliance across FastAPI and the Node auth bridge so the Assignment 2 baseline has protected document proof endpoints and a defensible short-lived JWT lifecycle without a backend rewrite.

## What Changed And Why
- Added Bearer-auth protection to the FastAPI document create/load proof routes so `/v1/documents` and `/v1/documents/{id}` now match the authenticated API expectations from the Assignment 2 baseline.
- Reused the existing FastAPI auth dependency so unauthenticated access returns the same standard 401 error envelope already used by `/v1/me`.
- Updated backend document tests to prove both unauthenticated rejection and authenticated create/load success flows.
- Removed the Node demo-login bridge's synthetic 8-hour access-token story by making it report the actual JWT `iat` and `exp` window, aligned with `JWT_ACCESS_TTL_SECONDS`.
- Updated `README.md` and `DEVIATIONS.md` so the final auth lifecycle is documented consistently for demo and oral-defense use.

## Acceptance Coverage
- FastAPI document endpoints reject requests without valid Bearer tokens: covered by `fastapi-auth-transcript.txt` and `backend-pytest.txt`.
- Backend tests cover unauthenticated and authenticated create/load flows: covered by `backend-pytest.txt`.
- Existing API tests still pass: covered by `api-contract-tests.txt`, `api-provider-test.txt`, `web-test.txt`, and `typecheck.txt`.
- Demo-login bridge token semantics match the short-lived JWT expectation: covered by `demo-login-bridge-transcript.txt` and `api-contract-tests.txt`.
- README and DEVIATIONS document the final behavior: covered by `changed-files.txt` plus the linked repository diffs.

## Evidence Files
- `backend-pytest.txt`: FastAPI pytest output.
- `api-contract-tests.txt`: Node API/WebSocket contract suite output.
- `api-provider-test.txt`: API provider test output.
- `web-test.txt`: frontend Vitest output.
- `typecheck.txt`: repo typecheck output.
- `fastapi-auth-transcript.txt`: concise protected-route transcript showing 401 without Bearer auth and success with auth.
- `demo-login-bridge-transcript.txt`: demo-login transcript plus decoded JWT `iat`/`exp` window.
- `changed-files.txt`: exact repo files changed for this issue.
- `commit-hash.txt`: current workspace base commit and branch note.
- `pr-link.txt`: PR placeholder to update when opened.
