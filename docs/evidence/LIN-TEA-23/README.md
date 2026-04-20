# LIN-TEA-23 Evidence Bundle

## Issue
Rectify frontend and AI compliance by adding a minimal React shell and wiring a real LM Studio-backed AI provider without rewriting the existing flows. The implementation also included the minimum auth/startup integration required to make the corrected frontend and AI path runnable end-to-end in the current dual-runtime repo.

## What Changed And Why
- Added an explicit React shell lifecycle around the existing imperative `apps/web` UI so the frontend is defensibly React-based without a large late-stage rewrite.
- Added an env-driven AI provider boundary in `apps/api` so rewrite/summarize can stream from LM Studio's OpenAI-compatible API with `nvidia.nemotron-mini-4b-instruct`.
- Preserved the existing user-facing AI flow: SSE/progressive output, cancel, compare/apply/reject/edit/undo, and per-document history.
- Bridged FastAPI auth into the Node-backed app path and updated `run.sh` so the canonical auth flow, collaboration runtime, and AI runtime can be started together for local verification.
- Updated `.env.example`, `README.md`, and `DEVIATIONS.md` so the rectification is documented honestly.

## Acceptance Criteria Summary
- `apps/web` must be React-based in a defensible way while preserving current web behavior.
- AI rewrite and summarize must work through a real LM Studio-backed provider instead of only hardcoded demo logic.
- The existing SSE-based AI flow, cancel path, suggestion controls, and history must keep working.
- README must document LM Studio setup and usage.
- The deviation log must describe the rectification honestly.
- Local startup and auth flow must be coherent enough to exercise the corrected frontend + AI path without manual patching.
- Build, typecheck, and tests must pass after the change.

Relevant assignment/rubric mapping:
- Assignment PDF Part 1 / Technology Constraints: frontend must be React-based.
- Assignment PDF Part 3.2: AI responses must stream progressively and support cancel.
- Assignment PDF Part 3.3: compare/apply/reject/edit/undo suggestion UX must remain intact.
- Assignment PDF Part 3.4: prompts/provider must be abstracted so swapping providers changes one place.
- Assignment PDF Part 3.5: AI history must be retained per document.
- Assignment PDF Part 4.2 / 4.3: frontend tests and honest setup/docs updates are required.

## Evidence Files
- `typecheck.txt`: repo typecheck run
- `build.txt`: repo production build run
- `npm-test.txt`: root API/WebSocket contract test run
- `web-test.txt`: frontend Vitest run including React shell mount/unmount coverage
- `api-provider-test.txt`: provider adapter test run with demo fallback + OpenAI-compatible stub
- `backend-pytest.txt`: FastAPI auth/document backend pytest run
- `lm-studio-smoke.txt`: real local LM Studio smoke transcript using `nvidia.nemotron-mini-4b-instruct`
- `commit.txt`: branch/commit note
- `pr-link.txt`: PR placeholder to update when opened
- `video-note.txt`: visual evidence note
