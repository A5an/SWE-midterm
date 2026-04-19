# LIN-TEA-13 Evidence Summary

Assumption: this frontend auth task maps to `LIN-TEA-13` based on the assignment prompt placeholder. If the actual Linear key differs, rename this folder and the suggested branch/PR metadata before opening the PR.

## What changed and why

- Added a dedicated FastAPI auth workspace inside `apps/web` with hash-based routes for `#auth/login`, `#auth/register`, and protected `#auth/workspace`.
- Added persisted JWT session storage plus restore-on-refresh behavior so the protected workspace can survive a page reload without forcing a new sign-in.
- Added graceful expired-token handling by retrying the protected `/v1/me` fetch through `/v1/auth/refresh` before clearing the session and sending the user back to sign-in.
- Kept the existing collaboration and AI demo flow intact because the Node PoC API still owns that baseline; the new auth workspace is an explicit temporary bridge until FastAPI reaches parity.
- Added frontend auth helper tests covering persistence, route parsing, refresh recovery, and invalid-session cleanup.
- Updated `README.md` and `DEVIATIONS.md` so the temporary dual-mode frontend behavior is documented for review and oral defense.

## Acceptance coverage

- Login/register works: implemented in the FastAPI auth workspace UI and wired to `/v1/auth/login` and `/v1/auth/register`.
- Session persists after refresh: covered by persisted-session restore logic and the protected `#auth/workspace` route flow.
- Expired token handled gracefully: covered by refresh-on-expiry fallback before forced sign-out.
- Required evidence:
  - frontend test log: `frontend-test-log.txt`
  - UI recording note / capture placeholder: `video-note.md`

## Artifacts

- `frontend-test-log.txt`: `npm --workspace @swe-midterm/web run test`
- `typecheck-log.txt`: `npm --workspace @swe-midterm/contracts run build` and `npm --workspace @swe-midterm/web run typecheck`
- `build-log.txt`: `npm --workspace @swe-midterm/web run build`
- `video-note.md`: recording checklist and what to capture in the browser
- `commit-hash.txt`: current workspace base commit hash plus note that the auth UI changes are still uncommitted in this workspace
- `pr-link.txt`: placeholder until the PR exists
