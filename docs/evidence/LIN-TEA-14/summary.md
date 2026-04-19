# LIN-TEA-14 Summary

## What changed
- Added an authenticated dashboard list endpoint and frontend document list so users can open accessible documents without manually pasting document IDs.
- Replaced the plain-text editing surface with a rich-text editor that supports headings, bold, italic, bullet lists, numbered lists, and code blocks.
- Added autosave status UX for the loaded document, with `Unsaved changes`, `Saving…`, `Saved`, and failure messaging.
- Kept the existing collaboration session and AI suggestion flows attached to the same loaded document so the issue stays baseline-first without introducing a parallel editor.
- Added frontend component tests for the dashboard/autosave flow and helper coverage for document serialization.

## Why this design
- The list endpoint is intentionally small and contract-checked because the dashboard only needs metadata, role, and preview text.
- Rich text is implemented in the existing web shell instead of building a second editor flow, which keeps the user path defensible for oral Q&A and avoids split document state.
- Autosave uses the existing authenticated `PATCH /v1/documents/{id}` route so persistence behavior remains explicit and testable.

## Evidence in this folder
- `dashboard-editor-autosave.png`: full-page screenshot showing the dashboard list, rich-text editor, and saved autosave state.
- `dashboard-list-view.png`: cropped screenshot focused on the editor/autosave area.
- `frontend-component-test-log.txt`: Vitest component/helper test run for the frontend.
- `api-contract-test-log.txt`: backend contract test run, including the new document-list coverage.
- `typecheck-log.txt`: workspace typecheck output.
- `build-log.txt`: production web build output.
