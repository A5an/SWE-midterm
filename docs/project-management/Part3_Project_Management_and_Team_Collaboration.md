# Part 3: Project Management & Team Collaboration

## Project
Collaborative Document Editor with AI Writing Assistant

## Scope and Team Assumption
- Team size: 3 engineers
- Tooling: Linear for issue tracking, GitHub for code + PRs, group chat + Google Meet for coordination
- This document covers Assignment Part 3 (`3.1` to `3.5`)
- This document distinguishes **midterm PoC reality** (lightweight process) from the **final project target process** (more structured).

## 3.1 Team Structure & Ownership

### Ownership Model Decision

For a 3-person team, both extremes are risky:

- `Everyone owns everything equally` (no explicit owner) is weak for accountability and slows delivery.
- `Hard silo ownership` (one person only frontend, one only backend, one only AI) creates bus-factor risk and hurts oral defense readiness.

Chosen model: **Primary owner + secondary owner per area**, with cross-training every week.

| Area | Primary Owner | Secondary Owner | Main responsibilities |
|---|---|---|---|
| Frontend editor + UX (`apps/web`) | Alaa Mohamed Elsayed Abdelghany Alam | Assanali Aukenov | Editor UI, API wiring in client, AI suggestion panel behavior, accessibility checks |
| API + contracts (`apps/api`, `packages/contracts`) | Dachi Tchotashvili | Alaa Mohamed Elsayed Abdelghany Alam | Route handlers, validation, error envelopes, shared contract updates |
| Collaboration + AI services (`apps/collab`, `apps/ai-worker`) | Assanali Aukenov | Dachi Tchotashvili | Session flow, sync rules, AI job lifecycle, status events |
| Infra + quality (`infrastructure/*`, `tests/*`, CI) | Shared ownership | Shared ownership | Test setup, scripts, environment config, release readiness |

Why this is better:

- Clear accountability for each deliverable.
- No single point of failure because each area has a backup.
- Everyone still understands all major components for oral assessment.

### Cross-Owner Feature Process

Features spanning multiple areas (example: AI suggestion accept flow touching frontend + API + worker) follow this process:

1. Create one Linear parent ticket with linked subtasks per ownership area.
2. Define API/data contract first in `packages/contracts` before implementation.
3. Primary owner of affected area drives their subtask; secondary reviews.
4. Integrate behind one acceptance checklist before marking Done.

### Technical Decision Process

When team members disagree:

1. Timebox discussion to 30 minutes.
2. Compare options against fixed criteria: correctness, latency impact, complexity, implementation effort, and risk.
3. If still blocked, rotating weekly tech lead decides and records rationale in a short ADR note in Linear.
4. Revisit only if new evidence appears (failed tests, benchmark regressions, or changed requirements).

## 3.2 Development Workflow

### Branching Strategy

Midterm PoC reality (what we actually did):

- We did not use strict branching for every tiny change.
- Because the PoC scope was small and fast-moving, some changes were integrated directly after quick team checks.

Final-project policy (what we will enforce after):

- Protected `main` branch
- Short-lived feature branches per Linear task
- Naming convention:
  - `feat/LIN-123-document-create-ui`
  - `fix/LIN-231-error-envelope`
  - `chore/LIN-310-readme-demo`
- Merge policy: squash-merge after review and passing checks
- Direct pushes to `main`: avoided except emergency hotfix with team agreement

Why this split is reasonable:

- For the midterm PoC, full process overhead on every tiny change was overkill relative to scope.
- For the final system (collab + AI + infra), strict branching and review become necessary due to higher complexity and risk.

### Code Review Process

Midterm PoC reality:

- Review was mostly synchronous and lightweight (pair checks, quick team validation in chat/meet).
- For small PoC changes, we prioritized speed and integration testing over formal PR ceremony.

Final-project policy:

- Minimum 1 reviewer, not the author.
- Any contract change (`packages/contracts`) requires review from both frontend and backend owners.
- Reviewer checklist:
  - Requirements alignment (which FR/NFR or user story is covered)
  - API contract compatibility
  - Error handling and edge cases
  - Tests added/updated
  - Docs updated if behavior changed
- PR size target: <= 300 net lines when possible.
- Review SLA: within 24 hours on weekdays.

### Issue Tracking and Task Assignment (Linear)

Linear workflow states:

1. Backlog
2. Ready
3. In Progress
4. In Review
5. Done

Task rules:

- Every task must include acceptance criteria and owner.
- Cross-cutting features must include linked subtasks by area.
- "Done" requires merged PR + updated docs/tests (or explicit justification if not applicable).

### Communication and Documentation

- Teams group chat: quick async questions, blockers, handoffs.
- Google Meet: weekly planning + technical deep-dive sessions.
- Linear is the source of truth for decisions and status:
  - Decision summary comment on each important ticket
  - Links to PRs, test evidence, and demo notes

This avoids losing key decisions in chat history.

## 3.3 Development Methodology

Chosen approach:

- Midterm PoC phase: lightweight iterative testing with reduced ceremony.
- Final implementation phase: **Scrum-lite with 1-week iterations**.

Why this fits:

- Team is small (3 people), so overhead must stay low.
- During midterm, we were validating assumptions quickly, so strict process on every step was unnecessary.
- During final implementation, requirements and architecture are larger and more coupled, so more structure is justified.
- Weekly cadence is fast enough for course timelines and demos.

Iteration structure:

1. Monday planning: select tasks for the week from Linear Ready state.
2. Mid-week checkpoint: validate progress, unblock dependencies, adjust scope.
3. Friday review/retro: demo completed items, record lessons learned, re-prioritize backlog.

Backlog prioritization policy:

1. Milestone blockers first
2. High-risk technical items second
3. User-visible enhancements third

Handling non-user-visible work:

- Reserve at least 25% of weekly capacity for enabling work:
  - test coverage
  - CI and tooling
  - schema/contracts hardening
  - observability and error handling
- At least one quality-focused task is mandatory in each iteration.

## 3.4 Risk Assessment

| Risk ID | Description + Likelihood | Impact if materialized | Mitigation strategy | Contingency plan |
|---|---|---|---|---|
| R-01 | **AI provider latency/outage** (Medium) during suggestion generation | AI features appear broken; poor UX; deadline risk for AI milestone | Queue-based async design, retries with backoff, clear timeout/error states | Switch to mock/stub provider for demo mode; degrade gracefully while core editing remains available |
| R-02 | **AI cost overrun** (Medium) from long-context requests | Budget exhaustion; feature throttling; inability to test reliably | Selection-first prompts, token caps, per-user/workspace quotas, usage monitoring | Temporarily restrict expensive features (e.g., full restructure), enforce stricter limits, use cheaper model tier |
| R-03 | **Collaboration merge defects** (Medium-High) in concurrent edits/reconnect | Data divergence or lost edits; severe trust and grading impact | Deterministic merge model, scripted concurrency tests, replay/idempotency checks | Disable risky advanced merge paths, fallback to simpler conflict suggestion flow, manual restore via versions |
| R-04 | **Contract drift between frontend and backend** (Medium) | Runtime failures despite compiling; integration delays | Shared `packages/contracts`, contract tests in CI, contract-first change policy | Freeze contract for milestone, add adapter layer for backward compatibility, prioritize integration bugfix sprint |
| R-05 | **Weak ownership and coordination** (Medium) when everyone touches everything without accountable owners | Duplicate work, unreviewed changes, blocked milestones | Primary+secondary ownership, mandatory reviewers, Linear subtask split | Emergency reallocation by weekly lead; pause new features until ownership and task map is corrected |
| R-06 | **Secrets/config leakage** (Low-Medium) via accidental commits | Security and compliance risk; potential credential rotation overhead | `.env.example` only, secret scanning in CI, least-privilege dev keys | Immediate key rotation, audit exposed scope, remove leaked material and force credential reset |

## 3.5 Timeline and Milestones

Midterm timeline starts on **April 3, 2026** and ends on **April 24, 2026** (last day before exams).

| Milestone | Target Date | Scope | Verifiable acceptance criteria |
|---|---|---|---|
| M1 - PoC Skeleton Ready | April 10, 2026 | Stable frontend-backend PoC path + core docs baseline | PoC runs locally; create/load flow demonstrated; Part 1-2 drafts aligned with code |
| M2 - Midterm Packaging and Evidence | April 17, 2026 | Submission package hardening | Root README complete; diagrams and sources organized; demo script finalized |
| M3 - Midterm Freeze | April 24, 2026 | Final pre-exam lock for midterm submission | All midterm deliverables consistent; no blocking contract mismatch; team oral walkthrough rehearsed |

Final-phase plan (post-midterm period):

- After midterm, we switch to stricter branching + review workflow for larger feature delivery.
- Final milestones (collaboration MVP, AI async flow, versioning/export hardening) will be scheduled in the final-project planning update rather than fixed in this midterm document.

Milestone governance rules:

1. No milestone is closed without evidence links in Linear (PR, tests, demo clip/screenshots).
2. If a milestone slips, scope is reduced explicitly rather than silently carrying unfinished work.
3. A short retro note is required after each milestone to improve the next cycle.
