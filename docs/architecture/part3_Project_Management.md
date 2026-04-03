# Part 3: Project Management & Team Collaboration
 
## Project
Collaborative Document Editor with AI Writing Assistant
 
## Scope and Team Assumption
- Team size: 3 engineers
- Tooling: Linear for issue tracking, GitHub for code + PRs, group chat + Google Meet for coordination
- This document covers Assignment Part 3 (`3.1` to `3.5`)
 
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
 
Even for a PoC, branching is recommended. Reason: it protects `main`, keeps history reviewable, and gives visible collaboration evidence for grading.
 
Strategy:
 
- Protected `main` branch
- Short-lived feature branches per Linear task
- Naming convention:
  - `feat/LIN-123-document-create-ui`
  - `fix/LIN-231-error-envelope`
  - `chore/LIN-310-readme-demo`
- Merge policy: squash-merge after review and passing checks
- Direct pushes to `main`: not allowed except emergency hotfix with team agreement
 
Why "no branching for PoC" is risky:
 
- Increases chance of breaking the only runnable demo path.
- Makes code review harder or impossible.
- Reduces evidence of team collaboration in git history.
 
### Code Review Process
 
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
 
- Group chat: quick async questions, blockers, handoffs.
- Google Meet: weekly planning + technical deep-dive sessions.
- Linear is the source of truth for decisions and status:
  - Decision summary comment on each important ticket
  - Links to PRs, test evidence, and demo notes
 
This avoids losing key decisions in chat history.
 
## 3.3 Development Methodology
 
Chosen approach: **Scrum-lite with 1-week iterations**.
 
Why this fits:
 
- Team is small (3 people), so overhead must stay low.
- Requirements and architecture are defined, but implementation details will still change.
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
 
Timeline starts from **April 3, 2026** and runs through the end-of-semester delivery window.
 
| Milestone | Target Date | Scope | Verifiable acceptance criteria |
|---|---|---|---|
| M1 - Part 3 + PoC Hardening | April 10, 2026 | Finalize Part 3, ensure PoC demo path is stable | Part 3 document complete; root README added; `npm test` passes; demo script rehearsed |
| M2 - Auth + Permissions Baseline | April 24, 2026 | Add auth stub and role checks for protected document actions | Unauthorized requests return expected `401/403`; role matrix tests exist; policy errors use standard envelope |
| M3 - Collaboration MVP | May 8, 2026 | Two-user real-time editing + presence prototype | Two browser sessions sync edits in near real time; join/leave presence visible; reconnect scenario demonstrated |
| M4 - AI Async Workflow MVP | May 22, 2026 | AI request lifecycle with queued/in-progress/completed states | AI request endpoint returns `202`; status updates reachable (SSE or polling fallback); accept/reject path works with stubbed model |
| M5 - Versioning + Export + Risk Burn-Down | June 5, 2026 | Version history, revert-as-new-head, export skeleton, risk controls | Version list + revert endpoint functional; export job stub returns tracked status; top 3 risks reduced with evidence |
| M6 - Final Stabilization + Defense Prep | June 12, 2026 | Documentation lock, demo rehearsal, oral defense preparation | All docs consistent with code; critical tests pass; each member can explain architecture decisions and change impact |
 
Milestone governance rules:
 
1. No milestone is closed without evidence links in Linear (PR, tests, demo clip/screenshots).
2. If a milestone slips, scope is reduced explicitly rather than silently carrying unfinished work.
3. A short retro note is required after each milestone to improve the next cycle.