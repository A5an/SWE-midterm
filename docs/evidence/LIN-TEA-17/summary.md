# LIN-TEA-17 Evidence Summary

Issue: `LIN-TEA-17`
Branch: `feat/LIN-TEA-17-ai-streaming`
Rebased onto: `origin/main` at `682772f667e41662ffab99a9fa1a8c6ff679b344`

## What Changed
- Added authenticated AI job creation in `apps/api` for `rewrite` and `summarize`.
- Added progressive SSE streaming, cancel support, and per-document AI history with final decision persistence.
- Added frontend AI compare/apply/reject/edit/undo UX in `apps/web`.
- Extended shared contracts in `packages/contracts` so API and frontend use the same AI request/history/stream types.
- Tightened AI history integrity so only the requesting user can cancel or record a final decision, and decisions are only accepted after job completion.
- Made `accepted`, `rejected`, `edited`, and `undone` terminal history states, with only a single `accepted/edited -> undone` transition allowed.
- Switched the request payload to selection-first scope with limited nearby context instead of sending the full document body by default.
- Required an active collaboration session before starting AI so accepted/edited suggestions always persist through the shared document mutation path.
- Enforced server-side AI invocation permissions so `owner` and `editor` can create AI jobs while `viewer` now receives `403 AUTHZ_FORBIDDEN` before any AI job is created.
- Rebased the branch onto current `origin/main`, kept frontend ownership recovery as `D-009`, renumbered the TEA-17 AI SSE deviation to `D-010`, and reran the verification suite.

## Why It Changed
- `LIN-TEA-17` requires baseline AI rewrite + summarize flows with progressive streaming, cancel, user-controlled suggestion handling, and saved per-document history.
- The current baseline keeps AI inside `apps/api` so the team can demonstrate the mandatory workflow without adding a separate worker/queue before submission, while still enforcing the documented owner/editor-only AI permission model on the backend.

## Evidence Files
- `backend-test-log.txt`: backend contract test log covering stream progress, cancel, and history persistence.
- `frontend-test-log.txt`: frontend helper test log covering selection normalization and suggestion apply logic.
- `typecheck-log.txt`: repo typecheck output.
- `build-log.txt`: repo build output.
- `ai-flow-transcript.md`: short user-flow transcript for the AI suggestion lifecycle.
- `video-note.md`: final UI recording link for the AI flow demo.
- `commit-hash.txt`: latest implementation-anchor commit hash captured for this evidence bundle.
- `pr-link.txt`: current GitHub PR URL and status note.
