# LIN-TEA-15 Evidence Bundle

- Linear issue: `LIN-TEA-15`
- Branch used in this workspace: `feat/LIN-TEA-15-sharing-role-version-ui`
- Base HEAD before commit/PR creation: see `commit-hash.txt`
- PR: pending branch push and PR creation. Placeholder recorded in `pr-link.txt`.

## What changed and why

- Added a role-aware document access panel in `apps/web` so the UI distinguishes owner/editor/viewer capabilities instead of exposing a single generic document view.
- Added owner-only sharing controls in the web app so the owner can assign or update `editor`/`viewer` roles using the existing `/permissions` and `/shares` backend contracts.
- Added version history browsing and restore actions in the web app so the frontend now triggers the existing backend restore flow instead of relying on API-only evidence.
- Kept the backend contracts unchanged for this issue and reused the existing API baseline, which keeps the UI change narrow and defensible for oral Q&A.

## Acceptance coverage

- Owner can assign role: covered by your manual UI demo clip, `viewer-read-only.png`, and `backend-contract-tests.txt`.
- Viewer is read-only: covered by your manual UI demo clip, `viewer-read-only.png`, and `backend-contract-tests.txt`.
- Version restore UI triggers backend restore: covered by your manual UI demo clip, `frontend-test-log.txt`, and `backend-contract-tests.txt`.

## Artifacts

- Manual UI demo clip: record this into `docs/evidence/LIN-TEA-15/` and update this README with the final filename.
- `viewer-read-only.png`: still proof of the viewer-denied collaboration flow after the owner share.
- `frontend-test-log.txt`: frontend helper tests for role inference, permissions, version ordering, AI helpers, and auth persistence.
- `typecheck.txt`: repo typecheck output.
- `build.txt`: production web build output.
- `backend-contract-tests.txt`: existing API/WebSocket contract suite proving sharing/version behavior remained intact.
- `api-dev.log`: local API dev server log captured during the UI recording run.
- `web-dev.log`: local web dev server log captured during the UI recording run.
- `commit-hash.txt`: current base HEAD reference plus a note that a fresh implementation commit is still pending.
- `pr-link.txt`: placeholder for the future PR URL.

## Manual recording script

1. Sign in as `usr_assanali`.
2. Create or load a document and show `Effective Access: Owner`.
3. In `Access & Sharing`, assign `viewer` to `usr_viewer` or `viewer@demo.local`.
4. In `Version History`, refresh and restore an older version as the new head.
5. Sign out, sign in as `usr_viewer`, load the same document, and show that joining the collaboration session is denied and the UI shows `Viewer`.
