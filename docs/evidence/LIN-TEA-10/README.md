# LIN-TEA-10 Evidence Bundle

- Linear issue: `LIN-TEA-10`
- Branch used in this workspace: `feat/LIN-TEA-10-RBAC+sharing-API`
- Evidence generated from commit: `8d05a7f092c427dc276b2b08b7b81db0c576daa3`
- PR link note: use `docs/evidence/LIN-TEA-10/pr-link.txt` for the compare/open-PR URL. This evidence is intentionally anchored to the evidence-producing commit instead of the moving branch head.

## What changed and why

- Added document-level RBAC to the Node PoC backend with `owner`, `editor`, and `viewer` enforcement on create/load/update/session/share routes.
- Added sharing endpoints that resolve principals by username or email, keeping workspace membership as the baseline editor grant while explicit shares can narrow or expand document access.
- Added a direct document update API and blocked `viewer` edits server-side with `403 AUTHZ_FORBIDDEN`, so read-only access cannot be bypassed with a crafted API request.
- Kept the existing collaboration baseline intact by allowing owners and editors into collaboration sessions while denying viewers from the mutable session bootstrap route.
- Updated shared contracts, frontend auth-backed document loads, the root README, and `DEVIATIONS.md` so the documented baseline matches the TEA-10 implementation.

## Acceptance coverage

- Share by username/email: covered by `role-matrix-tests.txt` and `forbidden-request-proof.txt`.
- Viewer cannot edit via direct API call (`403`): covered by `role-matrix-tests.txt` and `forbidden-request-proof.txt`.
- Required evidence artifacts:
  - role-matrix tests: `role-matrix-tests.txt`
  - forbidden-request proof: `forbidden-request-proof.txt`

## Artifacts

- `role-matrix-tests.txt`: full `npm test` log covering unshared-user denial, username/email share grants, owner/editor/viewer role matrix, viewer direct-edit denial, viewer session denial, and collaboration reconnect behavior.
- `forbidden-request-proof.txt`: live API transcript showing owner login, viewer login, owner share by email, viewer successful read, and viewer `PATCH /v1/documents/{id}` rejection with `403 AUTHZ_FORBIDDEN`.
- `typecheck.txt`: `npm run typecheck` output for contracts, API, and web packages.
- `build.txt`: `npm run build` output confirming the frontend still builds after the auth-backed document-load change.
- `startup.log`: local API startup log captured during the forbidden-request proof run.
- `commit-hash.txt`: stable evidence commit reference with commit subject.
- `pr-link.txt`: compare/open-PR URL for this branch.
