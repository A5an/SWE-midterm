# LIN-TEA-11 Evidence Bundle

- Linear issue: `LIN-TEA-11`
- Branch used in this workspace: `feat/LIN-TEA-11-Version-history+restore-API`
- Evidence generated from commit: `eb25abc5fb9841b937ee8132660f0fe08da31ece`
- PR: pending push/PR creation for this branch. See `docs/evidence/LIN-TEA-11/pr-link.txt`. This evidence is intentionally anchored to the implementation commit instead of the moving branch head.

## What changed and why

- Added immutable in-memory version snapshots to the Node PoC backend for document create, direct document update, collaboration mutations, and restore-as-new-head flows.
- Added `GET /v1/documents/{documentId}/versions` and `GET /v1/documents/{documentId}/versions/{versionId}` so version list/fetch work through shared API contracts.
- Added `POST /v1/documents/{documentId}/versions/{versionId}:revert` so restore creates a new head version instead of mutating historical snapshots in place.
- Restricted restore to document owners and broadcast a collaboration reload event when restore changes the live head state.
- Added integration coverage and API proof samples so the TEA-11 behavior is verifiable without relying on UI-only demonstration.

## Acceptance coverage

- Version list works: covered by `integration-test-log.txt` and `api-response-samples.txt`.
- Version fetch works: covered by `integration-test-log.txt` and `api-response-samples.txt`.
- Restore creates a new head state: covered by `integration-test-log.txt` and `api-response-samples.txt`.

## Artifacts

- `integration-test-log.txt`: full `npm test` log including the TEA-11 version list/fetch/restore integration flow and active-session reload event.
- `api-response-samples.txt`: live API transcript showing create, list versions, fetch version, patch to create a new version, restore a historical version as a new head, and load-after-restore verification.
- `startup.log`: local API startup log captured during the response-sample run.
- `commit-hash.txt`: stable implementation commit reference with commit subject.
- `pr-link.txt`: PR link note for this branch until the branch is pushed and reviewed.
