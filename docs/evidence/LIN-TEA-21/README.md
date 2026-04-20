# LIN-TEA-21 Evidence

## What Changed
- Added real React runtime dependencies to `apps/web` via `react` and `react-dom`, plus React type packages for TypeScript.
- Replaced the imperative `src/main.ts` entrypoint with `src/main.tsx`, so Vite now boots the app through a React root.
- Kept the existing imperative application logic intact by wrapping `mountApp(rootElement)` in a minimal React component that mounts once with `useEffect`.
- Updated web TypeScript config and a targeted test so the React shell is typechecked and covered without rewriting the large imperative renderer.

## Why
- The assignment baseline and repo docs describe the frontend as React-based.
- LIN-TEA-21 asked for the smallest defensible change that makes this statement true without risking a broad UI rewrite.
- This approach keeps current behavior and test coverage while moving ownership of the entrypoint to React.

## Acceptance Criteria Summary
- `apps/web` has real React dependencies.
- The app still starts and behaves as before because the existing `mountApp` renderer remains the implementation core.
- Validation gates pass:
  - `npm --workspace @swe-midterm/web run test`
  - `npm run build`
  - `npm run typecheck`
- The frontend can now be defended as React-based because React owns the app bootstrap and mounts the existing UI into a managed container.

## Evidence Files
- `web-test.log`: workspace web test run
- `build.log`: root production build run
- `typecheck.log`: root typecheck run
- `changed-files.txt`: scoped file list for this issue
- `commit-hash.txt`: implementation commit for this issue
- `pr-link.txt`: GitHub pull request URL
- `notes.txt`: non-applicable evidence notes

## Notes
- The assignment PDF is present in the repo, but text extraction was not available in this environment. Acceptance criteria were therefore derived from the repository source-of-truth docs plus the explicit LIN-TEA-21 issue description.
- No API or WebSocket transcript was required for this issue because it only changes the frontend bootstrap mechanism.
- No `DEVIATIONS.md` update was needed because this task aligns the implementation with the existing documented React frontend direction rather than changing scope, architecture, or process.
- Pull request: `https://github.com/A5an/SWE-midterm/pull/15`
