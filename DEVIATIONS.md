# Assignment 1 to Assignment 2 Deviations

Last updated: 2026-04-16

## Why this file exists
Assignment 2 explicitly requires documenting all differences between the Assignment 1 design and final implementation.

Rule: no silent deviations.

## Status Legend
- `planned`: decided, not implemented yet.
- `in_progress`: implementation started.
- `implemented`: merged in code and verifiable.

## Deviation Log

| ID | Status | Assignment 1 Plan | Assignment 2 Reality | Why It Changed | Improvement or Compromise | Requirement Impact | Owner | Target Date | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| D-001 | implemented | A1 architecture specifies API container as `NestJS + TypeScript` | A2 implementation now introduces a FastAPI + Python backend skeleton in `backend/` and migrates document create/load endpoints while keeping the PoC response contract stable for the frontend | Hard technology constraint in Assignment 2 | Improvement (required compliance change) | FastAPI migration preserves the baseline document contract and creates a clear path for later JWT/auth work | Dachi | 2026-04-15 | `backend/app/main.py:1`; `backend/app/routers/documents.py:1`; `backend/tests/test_documents.py:1`; `README.md:7` |
| D-002 | planned | A1 role model includes `owner/editor/commenter/viewer` | A2 baseline sequencing prioritizes mandatory `owner/editor/viewer` enforcement first; `commenter` deferred until baseline completion | Deadline pressure and baseline-first strategy | Compromise (scope sequencing) | Server-side RBAC for required roles must be complete before optional role expansion | Dachi, Alaa | 2026-04-17 | `packages/contracts/src/index.ts:1`; `README.md:14`; `apps/api/src/server.ts:101-174` |
| D-003 | planned | Part 3 timeline targets final quality gate on 2026-04-24 | Team execution is re-baselined to 2026-04-19 submission window | Actual Assignment 2 deadline is earlier than Part 3 milestone assumptions | Improvement (realistic planning) | Requires strict baseline-first delivery and earlier quality freeze | Team lead | 2026-04-14 | `docs/project-management/Part3_Project_Management_and_Team_Collaboration.md:169-174`; `docs/project-management/Assignment2_Implementation_Plan.md:5-88` |
| D-004 | implemented | Part 3 planned F1 by 2026-04-10 and F2 by 2026-04-14 | Repository remained PoC-level beyond those milestone dates | Delivery slip from original schedule | Compromise (schedule slip) | Raises rubric risk unless recovered with explicit replan and evidence discipline | Team lead | 2026-04-14 | `docs/project-management/Part3_Project_Management_and_Team_Collaboration.md:169-171`; `README.md:11-14` |
| D-005 | implemented | A1 architecture models full collaboration + AI containers and flows | Current codebase still has PoC-only endpoints with placeholder collaboration and AI services | A1 Part 4 PoC intentionally focused on API contract skeleton | Neutral for A1; high risk for A2 if not closed quickly | Direct impact on Core/Collab/AI rubric bands until implementation catches up | Assanali, Dachi | 2026-04-16 | `README.md:11-14`; `apps/collab/README.md:3-8`; `apps/ai-worker/README.md:3-8` |
| D-006 | implemented | A1 architecture assumes external IdP / OIDC-style authentication boundary | A2 baseline currently uses local email/password registration plus in-memory JWT access/refresh sessions in FastAPI | Assignment 2 baseline explicitly requires register/login/refresh before full identity-provider integration is justified | Compromise for milestone sequencing, but still aligned with baseline security requirements | Delivers `FR-UM-01` and part of `FR-UM-03` now; full protected CRUD and RBAC still follow in later issues | Dachi | 2026-04-16 | `backend/app/routers/auth.py:1`; `backend/app/security.py:1`; `backend/tests/test_auth.py:1`; `README.md:136`; `docs/evidence/LIN-TEA-9/api-transcript.txt` |

## Schedule Deviation Details (Rebaseline on 2026-04-14)

| Original Plan Milestone (Part 3) | Original Target Date | Re-baselined Target Window | Notes |
|---|---|---|---|
| F1 - Collaboration MVP | 2026-04-10 | 2026-04-16 | Moved to align with baseline-first execution and current repo status |
| F2 - Auth, Roles, Sharing | 2026-04-14 | 2026-04-15 to 2026-04-17 | Core security and RBAC remain top priority due high rubric impact |
| F3 - AI Async Flow | 2026-04-18 | 2026-04-16 to 2026-04-17 | Streaming AI is a hard requirement and cannot slip |
| F4 - Versioning, Revert, Export | 2026-04-21 | 2026-04-17 | Must reach baseline level before quality freeze |
| F5 - Final Quality Gate | 2026-04-24 | 2026-04-18 | Quality freeze is pulled earlier to protect live demo day |
| Assignment 2 Submission | N/A in original table | 2026-04-19 | Fixed external deadline |

## Update Protocol
- Update this file on every merged change that alters architecture, scope, timeline, or behavior.
- Each deviation row must include owner, target date, and concrete evidence (`file:line`, PR URL, or commit hash).
- If a deviation is unresolved at submission, mark it clearly and explain user-visible impact.
