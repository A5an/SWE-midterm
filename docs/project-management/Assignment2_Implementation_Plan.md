# Assignment 2 Implementation Plan (Rebaseline)

Last updated: 2026-04-14

## Purpose
This plan is the execution baseline for Assignment 2 (submission target: 2026-04-19).
It replaces the older milestone dates in Part 3 where those dates are no longer realistic.

Primary objective: deliver a complete and defensible Assignment 2 baseline first, then implement bonus features only if baseline acceptance gates are stable.

## Rules
- Baseline rubric requirements come before bonus features.
- No silent scope changes: every change is logged in `DEVIATIONS.md` on the same day.
- No task is marked complete without evidence.
- Evidence must be attached to Linear and linked in PR descriptions.

## Ownership (from Part 3)

| Workstream | Primary | Secondary | Required outputs by deadline |
|---|---|---|---|
| Backend core (FastAPI, JWT, RBAC, CRUD) | Dachi | Alaa | Auth + protected APIs + permission checks + backend tests |
| Frontend core (React UI, auth flow, editor shell) | Alaa | Assanali | Login/register flow, dashboard/editor shell, autosave/status UX |
| Collaboration + AI streaming | Assanali | Dachi | Authenticated WebSocket, presence, reconnect, AI streaming + cancel |
| Quality/docs/demo integration | Shared | Shared | Run script, `.env.example`, README, deviations log, demo readiness |

## Day-by-Day Recovery Plan

### 2026-04-14 (Today): Foundation Lock
- Backend starts FastAPI project structure and auth model (register/login/refresh).
- Frontend migrates to React baseline app shell and auth state plumbing.
- Collaboration/AI workstream defines message/event contracts used by frontend+backend.
- Shared: create `run.sh` or `Makefile`, add `.env.example`, update README run instructions.

Acceptance criteria:
- FastAPI app runs locally.
- React app runs locally.
- One protected endpoint returns 401 without token and 200 with valid token.
- Single-command local run exists and is documented.

### 2026-04-15: Core App Completion
- Complete JWT lifecycle with short-lived access + refresh.
- Implement document CRUD with owner metadata and dashboard listing.
- Enforce owner/editor/viewer permissions server-side.
- Implement rich-text editor baseline + autosave indicator + version history/restore baseline.

Acceptance criteria:
- Core App demo path works end-to-end.
- Viewer direct API edit attempt is blocked by backend (not only UI).
- Backend tests cover auth + permissions + CRUD happy/forbidden paths.

### 2026-04-16: Real-Time + AI Streaming Baseline
- Authenticated WebSocket session setup.
- Presence list and concurrent edit propagation baseline.
- Reconnect flow with state reconciliation baseline.
- AI features: at least two (for example summarize + rewrite) with token streaming.
- Cancel in-progress generation and clear mid-stream error handling.

Acceptance criteria:
- Two browser windows show live collaboration and presence.
- AI output streams progressively and can be canceled.
- Partial-output behavior on failure is consistent and documented.

### 2026-04-17: Suggestion UX + History + Sharing Hardening
- AI suggestion compare UX (original vs suggestion), accept/reject/edit, undo after apply.
- AI interaction history per document.
- Sharing by username/email with role assignment.
- Deviation log updated with real implementation evidence.

Acceptance criteria:
- Suggestion lifecycle is demonstrable in UI.
- History view shows request, prompt type, model, output status.
- Sharing and role enforcement validated with test cases.

### 2026-04-18: Quality Gate + Demo Rehearsal
- Complete backend and frontend baseline tests.
- Ensure API docs are available and meaningful.
- Finalize README, runbook, and architecture deviation report.
- Rehearse 5-minute live demo in required sequence.

Acceptance criteria:
- Clean clone setup works using documented steps.
- Tests run and pass locally.
- Demo script executes without manual patching during rehearsal.

### 2026-04-19: Submission and Live Demo
- Freeze scope to bug fixes only.
- Submit final repo state and verify all required artifacts are present.

## Linear Task Structure (Required)
Create one project and four parent issue groups:
- `A2-CORE`: Auth, JWT lifecycle, protected CRUD, roles, sharing.
- `A2-COLLAB`: WebSocket auth, presence, concurrent edits, reconnect.
- `A2-AI`: Streaming, cancel, suggestion UX, AI history.
- `A2-QUALITY`: Tests, run script, env docs, README, API docs, demo prep.

Each Linear ticket must contain:
- Owner
- Acceptance criteria (testable)
- PR link
- Test evidence (screenshot/log)
- Demo evidence (if user-facing flow)
- Deviation reference (if behavior differs from A1 design)

## Proof Package (for oral defense and grading)
For each completed requirement, keep:
- Linear ticket link
- PR link
- Commit hash
- Test output artifact
- Short note: "what changed and why"

This makes it easy to prove that the team followed its documented process, even when dates/scope changed.
