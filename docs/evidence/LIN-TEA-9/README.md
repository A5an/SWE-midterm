# LIN-TEA-9 Evidence Bundle

- Linear issue: `LIN-TEA-9`
- Branch used in this workspace: `feat/LIN-TEA-9-JWT-auth-lifecycle`
- Base commit at start of local changes: `fe7ec85d4568295eccbd5ec25aa103d2ca0e965e`
- PR link note: PR not opened from this workspace yet. Add the final PR URL here when the branch is pushed and the PR is created.

## Artifacts

- `pytest.txt`: backend pytest run covering auth lifecycle plus existing document endpoints.
- `api-transcript.txt`: live register/login/refresh/protected-route transcript captured against the local FastAPI server.
- `api-auth-lifecycle.txt`: compact response summary used to produce the auth lifecycle screenshot.
- `api-auth-lifecycle.png`: screenshot-style evidence image showing register/login/refresh responses.
- `api-protected-route.txt`: compact response summary used to produce the protected-route screenshot.
- `api-protected-route.png`: screenshot-style evidence image showing `401` without a token and `200` with a valid access token.
- `startup.log`: uvicorn startup plus request log from the evidence run.
