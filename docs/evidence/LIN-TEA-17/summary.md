# LIN-TEA-17 Evidence Summary

Issue: `LIN-TEA-17`
Branch: `feat/LIN-TEA-17-ai-streaming`

## What Changed
- Added authenticated AI job creation in `apps/api` for `rewrite` and `summarize`.
- Added progressive SSE streaming, cancel support, and per-document AI history with final decision persistence.
- Added frontend AI compare/apply/reject/edit/undo UX in `apps/web`.
- Extended shared contracts in `packages/contracts` so API and frontend use the same AI request/history/stream types.

## Why It Changed
- `LIN-TEA-17` requires baseline AI rewrite + summarize flows with progressive streaming, cancel, user-controlled suggestion handling, and saved per-document history.
- The current baseline keeps AI inside `apps/api` so the team can demonstrate the mandatory workflow without adding a separate worker/queue before submission.

## Evidence Files
- `backend-test-log.txt`: backend contract test log covering stream progress, cancel, and history persistence.
- `frontend-test-log.txt`: frontend helper test log covering selection normalization and suggestion apply logic.
- `typecheck-log.txt`: repo typecheck output.
- `build-log.txt`: repo build output.
- `ai-flow-transcript.md`: short user-flow transcript for the AI suggestion lifecycle.
- `video-note.md`: final UI recording link for the AI flow demo.
- `commit-hash.txt`: current repository commit hash.
- `pr-link.txt`: current GitHub PR URL and status note.
